import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { DownloadKind, DownloadOption, StoreHome, StoreItem, StoreSource } from '@shared/types'
import { getLang, t } from '@shared/i18n'
import { httpFetch } from '../http'
import { dataDir } from '../store'
import { searchTitles, storeItems } from './catalog'
import { readJson, writeJson } from './disk'
import { TitleIndex, titleKey, type TitleKey } from './match'

/**
 * Источники загрузок — JSON-файлы по ссылкам, которые добавил сам пользователь (формат Hydra:
 * { name, downloads: [{ title, uris, uploadDate, fileSize }] }). PlayOS их не поставляет и не ищет, только читает.
 * Сопоставление локальное: название загрузки → ключи (match.ts) → игра магазина. Названия, которые не совпали
 * ни с одной игрой по имени, ищутся в Steam по одному разу, ответ запоминается. Источники живут на этом ПК.
 */

const HOUR = 3_600_000
/** Источники обновляются сами раз в 12 часов */
const STALE = 12 * HOUR
/** Большие источники весят десятки мегабайт (около 70 тысяч загрузок — 37 МБ) */
const MAX_BYTES = 100 * 1024 * 1024
/** Не нашли игру в Steam — спросим снова через неделю: она могла там появиться */
const MISS_TTL = 7 * 24 * HOUR
const ROW_SIZE = 20
/** Сколько свежих игр из источников ищем в Steam для ряда: часть не найдётся */
const ROW_GROUPS = 60
const SEARCH_GROUPS = 12

const dir = () => path.join(dataDir(), 'shop')
const listFile = () => path.join(dir(), 'sources.json')
const entriesFile = (id: string) => path.join(dir(), 'sources', `${id}.json`)
const cacheFile = () => path.join(dir(), 'match-cache.json')
const overridesFile = () => path.join(dir(), 'match-overrides.json')
const rowFile = () => path.join(dir(), 'sources-row.json')

/** Загрузка на диске — коротко: в источнике бывают десятки тысяч строк */
interface RawEntry {
  t: string
  u: string[]
  d?: number
  s?: string
}

interface Entry {
  key: TitleKey
  sourceId: string
  title: string
  uris: string[]
  date?: number
  size?: string
}

interface Row {
  sig: string
  lang: string
  items: StoreItem[]
}

let sources: StoreSource[] | null = null
let entries: Entry[] = []
let index = new TitleIndex<Entry>()
/** Базовый ключ → [AppID или 0, когда спрашивали Steam] */
let cache: Record<string, [number, number]> = {}
/** Обратно: AppID → базовые ключи, найденные через Steam */
let byApp = new Map<number, string[]>()
/** «Не та игра»: AppID → ключи, которые у неё не показывать */
let unbound: Record<string, string[]> = {}
let row: Row | null = null
let onChange: (() => void) | null = null

/** Что делать, когда поменялись источники или ряд «Вышедшие новинки» */
export function setSourcesListener(cb: () => void) {
  onChange = cb
}

function load(): StoreSource[] {
  if (sources) return sources
  sources = readJson<StoreSource[]>(listFile()) ?? []
  cache = readJson<typeof cache>(cacheFile()) ?? {}
  unbound = readJson<typeof unbound>(overridesFile()) ?? {}
  row = readJson<Row>(rowFile())
  rebuild()
  return sources
}

function rebuild() {
  entries = []
  for (const s of sources ?? []) {
    for (const e of readJson<RawEntry[]>(entriesFile(s.id)) ?? []) {
      entries.push({ key: titleKey(e.t), sourceId: s.id, title: e.t, uris: e.u, date: e.d, size: e.s })
    }
  }
  // Свежие первыми — ряд и поиск идут по порядку, без сортировки каждый раз
  entries.sort((a, b) => (b.date ?? 0) - (a.date ?? 0))
  // Сколько разных игр в каждом источнике — для настроек
  const games = new Map<string, Set<string>>()
  for (const e of entries) {
    const set = games.get(e.sourceId) ?? new Set<string>()
    set.add(e.key.base)
    games.set(e.sourceId, set)
  }
  for (const s of sources ?? []) s.games = games.get(s.id)?.size ?? 0
  index = new TitleIndex(entries)
  byApp = new Map()
  for (const [base, [appId]] of Object.entries(cache)) if (appId) remember(appId, base)
}

function remember(appId: number, base: string) {
  const list = byApp.get(appId)
  if (!list) byApp.set(appId, [base])
  else if (!list.includes(base)) list.push(base)
}

const signature = () => (sources ?? []).map((s) => `${s.id}:${s.updatedAt ?? 0}`).join('|')
const idOf = (url: string) => crypto.createHash('sha1').update(url).digest('hex').slice(0, 12)
const saveList = () => writeJson(listFile(), sources)

let cacheTimer: ReturnType<typeof setTimeout> | null = null
function saveCache() {
  cacheTimer ??= setTimeout(() => {
    cacheTimer = null
    writeJson(cacheFile(), cache)
  }, 2000)
}

// ───────────────────────── Сопоставление ─────────────────────────

/**
 * Загрузки игры: совпадение по названию и то, что Steam раньше назвал этой игрой. Если Steam отдал ключ
 * другой игре (две игры с одним названием — оригинал и ремейк), по одному имени не показываем
 */
function entriesFor(appId: number, title: string): Entry[] {
  load()
  if (!entries.length) return []
  const found = new Set(
    index.find(titleKey(title)).filter((e) => {
      const known = cache[e.key.base]?.[0]
      return !known || known === appId
    })
  )
  for (const base of byApp.get(appId) ?? []) for (const e of index.group(base)) found.add(e)
  const hidden = unbound[appId]
  return hidden ? [...found].filter((e) => !hidden.includes(e.key.base)) : [...found]
}

const kindOf = (uri: string): DownloadKind => (/^magnet:/i.test(uri) ? 'magnet' : /\.torrent(\?|#|$)/i.test(uri) ? 'torrent' : 'http')

export function optionsFor(appId: number, title: string): DownloadOption[] {
  const names = new Map(load().map((s) => [s.id, s.name]))
  return entriesFor(appId, title)
    .sort((a, b) => (b.date ?? 0) - (a.date ?? 0))
    .map((e) => ({
      key: e.key.base,
      sourceId: e.sourceId,
      source: names.get(e.sourceId) ?? '',
      title: e.title,
      uris: e.uris,
      kind: kindOf(e.uris[0]),
      size: e.size,
      date: e.date
    }))
}

/** Отметить у игр, сколько у них вариантов загрузки */
export function decorateItems(items: StoreItem[]): StoreItem[] {
  load()
  if (!entries.length) return items
  return items.map((it) => {
    const n = entriesFor(it.appId, it.title).length
    return n ? { ...it, options: n } : it
  })
}

/** Витрина с вариантами загрузки и рядом «Вышедшие новинки» первым */
export function decorateHome(h: StoreHome): StoreHome {
  load()
  if (!entries.length) return h
  if (!row || row.sig !== signature() || row.lang !== getLang()) refreshRow()
  const rows = h.rows.map((r) => ({ ...r, items: decorateItems(r.items) }))
  // Пока ряд пересобирается, показываем прошлый — без игр, у которых варианты пропали
  const fresh = row ? decorateItems(row.items).filter((i) => i.options) : []
  return { ...h, rows: fresh.length ? [{ id: 'sources', items: fresh }, ...rows] : rows }
}

const resolving = new Map<string, Promise<number>>()

/** AppID игры с этим ключом: из памяти или по одному поиску в Steam */
function resolve(base: string): Promise<number> {
  const hit = cache[base]
  if (hit && (hit[0] || Date.now() - hit[1] < MISS_TTL)) return Promise.resolve(hit[0])
  let p = resolving.get(base)
  if (!p) {
    p = searchTitles(base)
      .then((list) => {
        const found = list.find((c) => {
          const k = titleKey(c.title)
          return k.full === base || k.base === base
        })
        const appId = found?.appId ?? 0
        cache[base] = [appId, Date.now()]
        if (appId) remember(appId, base)
        saveCache()
        return appId
      })
      .finally(() => resolving.delete(base))
    resolving.set(base, p)
  }
  return p
}

/** Несколько ключей, по четыре запроса сразу. Отдельная ошибка сети — просто 0, все сразу — Steam недоступен */
async function resolveMany(bases: string[]): Promise<number[]> {
  const out = bases.map(() => 0)
  let next = 0
  let failed = 0
  const worker = async () => {
    while (next < bases.length) {
      const i = next++
      out[i] = await resolve(bases[i]).catch(() => (failed++, 0))
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker))
  if (failed && failed === bases.length) throw new Error('Steam не ответил')
  return out
}

/** Свежие загрузки, по одной на игру: базовые ключи от новых к старым */
function freshBases(limit: number, filter?: (e: Entry) => boolean): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const e of entries) {
    if (seen.has(e.key.base) || (filter && !filter(e))) continue
    seen.add(e.key.base)
    out.push(e.key.base)
    if (out.length >= limit) break
  }
  return out
}

let rowLoading: Promise<void> | null = null

function refreshRow() {
  rowLoading ??= (async () => {
    const sig = signature()
    const ids = [...new Set((await resolveMany(freshBases(ROW_GROUPS))).filter(Boolean))].slice(0, ROW_SIZE)
    const items = ids.length ? await storeItems(ids) : []
    row = { sig, lang: getLang(), items }
    writeJson(rowFile(), row)
    onChange?.()
  })()
    .catch(() => {
      /* без сети — прошлый ряд */
    })
    .finally(() => (rowLoading = null))
}

/** Поиск: к найденному в Steam добавляются игры из источников с этим словом в названии */
export async function mergeSearch(q: string, steam: StoreItem[]): Promise<StoreItem[]> {
  load()
  if (!entries.length) return steam
  const words = titleKey(q).full
  if (words.length < 2) return decorateItems(steam)
  const have = new Set(steam.map((i) => i.appId))
  const found = await resolveMany(freshBases(SEARCH_GROUPS, (e) => e.key.full.includes(words))).catch(() => [])
  const ids = [...new Set(found.filter((id) => id && !have.has(id)))]
  const extra = ids.length ? await storeItems(ids).catch(() => []) : []
  return decorateItems([...steam, ...extra])
}

/** «Не та игра»: ключ больше не показывается у этой игры, а если его нашёл Steam — забываем и это */
export function unbind(appId: number, key: string) {
  load()
  const list = unbound[appId] ?? []
  if (!list.includes(key)) unbound[appId] = [...list, key]
  writeJson(overridesFile(), unbound)
  if (cache[key]?.[0] === appId) {
    cache[key] = [0, Date.now()]
    byApp.set(appId, (byApp.get(appId) ?? []).filter((b) => b !== key))
    saveCache()
  }
  onChange?.()
}

// ───────────────────────── Источники ─────────────────────────

export function listSources(): StoreSource[] {
  return load()
}

function errText(e: unknown): string {
  const name = (e as Error)?.name
  const msg = (e as Error)?.message ?? String(e)
  if (name === 'TimeoutError' || name === 'AbortError') return t('Источник не ответил за минуту')
  if (/net::ERR_/.test(msg)) return t('Нет связи с источником')
  return msg
}

/** Скачать и проверить источник. Загрузки без ссылок отбрасываются */
async function download(url: string): Promise<{ name: string; list: RawEntry[] }> {
  const r = await httpFetch(url, { signal: AbortSignal.timeout(60_000) })
  if (!r.ok) {
    // Страница проверки браузера вместо файла: скачать его может только браузер
    const body = r.status === 403 || r.status === 503 ? await r.text().catch(() => '') : ''
    if (/just a moment|cloudflare|cf-chl/i.test(body)) throw new Error(t('Сайт источника пускает только браузеры (проверка Cloudflare), PlayOS не может скачать его сам'))
    throw new Error(t('Сервер ответил {code}', { code: r.status }))
  }
  const tooBig = t('Файл больше 100 МБ — это не источник')
  if (Number(r.headers.get('content-length') ?? 0) > MAX_BYTES) throw new Error(tooBig)
  const buf = await r.arrayBuffer()
  if (buf.byteLength > MAX_BYTES) throw new Error(tooBig)
  let j: { name?: unknown; downloads?: unknown }
  try {
    j = JSON.parse(new TextDecoder().decode(buf).replace(/^﻿/, ''))
  } catch {
    throw new Error(t('По ссылке не JSON'))
  }
  if (!j || typeof j !== 'object' || !Array.isArray(j.downloads)) throw new Error(t('В файле нет списка downloads — это не источник'))
  const list: RawEntry[] = []
  for (const d of j.downloads as { title?: unknown; uris?: unknown; uploadDate?: unknown; fileSize?: unknown }[]) {
    if (typeof d?.title !== 'string' || !d.title.trim()) continue
    const uris = (Array.isArray(d.uris) ? d.uris : [])
      .filter((u): u is string => typeof u === 'string' && /^(magnet:|https?:\/\/)/i.test(u.trim()))
      .map((u) => u.trim())
      .slice(0, 20)
    if (!uris.length) continue
    const date = typeof d.uploadDate === 'string' ? Date.parse(d.uploadDate) : NaN
    const e: RawEntry = { t: d.title.trim().slice(0, 300), u: uris }
    if (Number.isFinite(date)) e.d = date
    if (typeof d.fileSize === 'string' && d.fileSize.trim()) e.s = d.fileSize.trim().slice(0, 40)
    list.push(e)
  }
  if (!list.length) throw new Error(t('В источнике нет ни одной ссылки'))
  const name = typeof j.name === 'string' && j.name.trim() ? j.name.trim().slice(0, 60) : new URL(url).hostname
  return { name, list }
}

function changed() {
  rebuild()
  saveList()
  refreshRow()
  onChange?.()
}

export async function addSource(url: string): Promise<{ source?: StoreSource; error?: string }> {
  const list = load()
  const u = url.trim()
  if (!/^https?:\/\/\S+$/i.test(u)) return { error: t('Нужна ссылка, которая начинается с http:// или https://') }
  const id = idOf(u)
  if (list.some((s) => s.id === id)) return { error: t('Этот источник уже добавлен') }
  try {
    const { name, list: got } = await download(u)
    writeJson(entriesFile(id), got)
    const source: StoreSource = { id, url: u, name, addedAt: Date.now(), updatedAt: Date.now(), count: got.length }
    sources = [...list, source]
    changed()
    return { source }
  } catch (e) {
    return { error: errText(e) }
  }
}

export function removeSource(id: string) {
  sources = load().filter((s) => s.id !== id)
  fs.rmSync(entriesFile(id), { force: true })
  changed()
}

let refreshing: Promise<StoreSource[]> | null = null

/**
 * Обновить источники: все (кнопка), один по id или только устаревшие (stale — при запуске).
 * Неудача не стирает прошлые загрузки
 */
export function refreshSources(which: 'all' | 'stale' | string = 'all'): Promise<StoreSource[]> {
  refreshing ??= (async () => {
    const due = load().filter((s) => (which === 'all' ? true : which === 'stale' ? Date.now() - (s.updatedAt ?? 0) > STALE : s.id === which))
    for (const s of due) {
      try {
        const { name, list } = await download(s.url)
        writeJson(entriesFile(s.id), list)
        Object.assign(s, { name, count: list.length, updatedAt: Date.now(), error: undefined })
      } catch (e) {
        s.error = errText(e)
      }
    }
    if (due.length) changed()
    return load()
  })().finally(() => (refreshing = null))
  return refreshing
}

/** После запуска: устаревшие источники обновить, ряд досчитать. Без источников ничего не делает */
export function startSources() {
  setTimeout(() => {
    if (!load().length) return
    void refreshSources('stale').then(() => {
      if (!row || row.sig !== signature()) refreshRow()
    })
  }, 20_000)
}
