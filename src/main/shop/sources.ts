import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { setImmediate as breath } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { DownloadKind, DownloadOption, StoreHome, StoreItem, StoreSource } from '@shared/types'
import { getLang, t } from '@shared/i18n'
import { displayTitle, parseTitle, TitleIndex, titleKey, type TitleKey } from '@shared/match'
import { httpFetch } from '../http'
import { log } from '../log'
import { dataDir } from '../store'
import { ITEM_V, searchTitles, storeItems } from './catalog'
import { readJson, writeJson } from './disk'
import { gogFind } from './gog'
import { srcItem, withArt } from './srconly'

/**
 * Источники загрузок — JSON-файлы по ссылкам или с диска, которые добавил сам пользователь (формат Hydra:
 * { name, downloads: [{ title, uris, uploadDate, fileSize }] }). PlayOS их не поставляет и не ищет, только читает.
 * Сопоставление локальное: название загрузки → ключи (shared/match.ts) → игра магазина. Названия, которые не совпали
 * ни с одной игрой по имени, ищутся в Steam по одному разу, ответ запоминается. Источники живут на этом ПК.
 *
 * Main не должен замирать: здесь же опрос геймпада и кнопка оверлея. Поэтому названия разбираются один раз при
 * скачивании (ключи лежат на диске рядом с загрузками) и порциями, индекс поднимается, только когда магазином
 * пользуются, и выгружается после 10 минут без дела. Обновляются источники тоже по событию, а не по таймеру.
 */

const HOUR = 3_600_000
/** Источник по ссылке старше 12 часов обновляется сам, когда им пользуются: магазин, «Скачать», настройки */
const STALE = 12 * HOUR
/** Устаревшие проверяем не чаще раза в 10 минут: неудачная попытка не повторяется на каждом шаге */
const STALE_CHECK = 10 * 60_000
/** Индекс загрузок живёт в памяти, пока магазином пользуются (большой источник — около 40 МБ) */
const IDLE = 10 * 60_000
/** Большие источники весят десятки мегабайт (около 70 тысяч загрузок — 37 МБ) */
const MAX_BYTES = 100 * 1024 * 1024
/** Не нашли игру в Steam — спросим снова через неделю: она могла там появиться */
const MISS_TTL = 7 * 24 * HOUR
const ROW_SIZE = 20
/** Сколько свежих игр из источников ищем в Steam для ряда: часть не найдётся */
const ROW_GROUPS = 60
const SEARCH_GROUPS = 12
/** Версия разбора названий: ключи лежат на диске и пересчитываются, если разбор поменялся */
const MATCH_V = 2
/** Сколько названий разбирать между передышками */
const CHUNK = 1000
/** Дольше ждать Steam перед списком вариантов не стоит: покажем то, что известно */
const SETTLE_MS = 4000

const dir = () => path.join(dataDir(), 'shop')
const listFile = () => path.join(dir(), 'sources.json')
const entriesFile = (id: string) => path.join(dir(), 'sources', `${id}.json`)
const cacheFile = () => path.join(dir(), 'match-cache.json')
const overridesFile = () => path.join(dir(), 'match-overrides.json')
const rowFile = () => path.join(dir(), 'sources-row.json')

type Platform = 'pc' | 'ps2' | 'ps3'

/** Загрузка на диске — коротко: в источнике бывают десятки тысяч строк. k — ключи подряд: full, base, full, base… */
interface RawEntry {
  t: string
  u: string[]
  d?: number
  s?: string
  k: string[]
  /** Платформа, если это не PC */
  p?: 'ps2' | 'ps3'
  /** Год из скобок названия */
  y?: number
}

type BareEntry = Omit<RawEntry, 'k' | 'p' | 'y'>

interface Entry {
  keys: TitleKey[]
  sourceId: string
  title: string
  uris: string[]
  platform: Platform
  date?: number
  size?: string
  year?: number
}

/**
 * Ответ Steam на ключ: [AppID или 0, когда спрашивали]. Если игр с таким названием в Steam несколько (Dead Space 2008
 * и ремейк), третьим — все они с годом выхода: загрузку к нужной разведёт год из её названия
 */
type Hit = [number, number] | [number, number, [number, number][]]

interface Row {
  sig: string
  lang: string
  v?: number
  items: StoreItem[]
}

let sources: StoreSource[] | null = null
/** null — индекс сейчас не в памяти */
let entries: Entry[] | null = null
let index = new TitleIndex<Entry>()
let indexing: Promise<void> | null = null
/** Растёт при каждой смене источников: индекс, собранный по старым, не применяется */
let generation = 0
let idleTimer: ReturnType<typeof setTimeout> | null = null
let cache: Record<string, Hit> = {}
/** Обратно: AppID → базовые ключи, найденные через Steam */
let byApp = new Map<number, string[]>()
/** «Не та игра»: AppID → ключи, которые у неё не показывать */
let unbound: Record<string, string[]> = {}
let row: Row | null = null
let onChange: (() => void) | null = null

/** Что делать, когда поменялись источники или ряд «Новинки и свежие обновления» */
export function setSourcesListener(cb: () => void) {
  onChange = cb
}

/** Список источников и ответы Steam — маленькие файлы, читаются сразу */
function loadList(): StoreSource[] {
  if (sources) return sources
  sources = readJson<StoreSource[]>(listFile()) ?? []
  cache = readJson<typeof cache>(cacheFile()) ?? {}
  unbound = readJson<typeof unbound>(overridesFile()) ?? {}
  row = readJson<Row>(rowFile())
  byApp = new Map()
  for (const [base, hit] of Object.entries(cache)) for (const id of appsOf(hit)) remember(id, base)
  return sources
}

const appsOf = (hit: Hit) => (hit[2] ? hit[2].map(([id]) => id) : hit[0] ? [hit[0]] : [])

function remember(appId: number, base: string) {
  const list = byApp.get(appId)
  if (!list) byApp.set(appId, [base])
  else if (!list.includes(base)) list.push(base)
}

/** Индекс загрузок всех источников: поднимается с диска при первой надобности */
function ensureIndex(): Promise<void> {
  touch()
  if (entries) return Promise.resolve()
  indexing ??= (async () => {
    const gen = generation
    const all: Entry[] = []
    let dirty = false
    for (const s of loadList()) {
      const list = await readEntries(s)
      const games = gamesIn(list)
      if (s.games !== games || s.count !== list.length) {
        Object.assign(s, { games, count: list.length })
        dirty = true
      }
      for (const e of list) all.push(toEntry(e, s.id))
      await breath()
    }
    if (dirty) saveList()
    // Свежие первыми — ряд и поиск идут по порядку, без сортировки каждый раз
    all.sort((a, b) => (b.date ?? 0) - (a.date ?? 0))
    const idx = new TitleIndex<Entry>()
    for (let i = 0; i < all.length; i++) {
      if (i && i % (CHUNK * 5) === 0) await breath()
      idx.add(all[i])
    }
    if (gen !== generation) return
    entries = all
    index = idx
  })().finally(() => (indexing = null))
  // Источники поменялись, пока индекс собирался, — собираем заново
  return indexing.then(() => (entries ? undefined : ensureIndex()))
}

/** 10 минут без магазина — индекс из памяти долой, в следующий раз поднимется с диска */
function touch() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    idleTimer = null
    entries = null
    index = new TitleIndex()
  }, IDLE)
}

/** Загрузки источника с диска. Файл от прошлой версии разбора — ключи пересчитываются один раз и записываются */
async function readEntries(s: StoreSource): Promise<RawEntry[]> {
  const text = await fs.promises.readFile(entriesFile(s.id), 'utf8').catch(() => null)
  if (!text) return []
  let file: { v?: number; list?: RawEntry[] } | BareEntry[]
  try {
    file = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(file) && file.v === MATCH_V && file.list) return file.list
  const list = await withKeys(Array.isArray(file) ? file : (file.list ?? []))
  saveEntries(s.id, list)
  return list
}

/** Разобрать названия: ключи, платформа, год. Загрузки для других платформ (Android, PSP, Xbox…) отбрасываются */
async function withKeys(list: BareEntry[]): Promise<RawEntry[]> {
  const out: RawEntry[] = []
  for (let i = 0; i < list.length; i++) {
    if (i && i % CHUNK === 0) await breath()
    const e = list[i]
    const info = parseTitle(e.t)
    if (info.platform === 'other' || !info.keys[0].full) continue
    const r: RawEntry = { t: e.t, u: e.u, k: info.keys.flatMap((k) => [k.full, k.base]) }
    if (e.d !== undefined) r.d = e.d
    if (e.s) r.s = e.s
    if (info.platform !== 'pc') r.p = info.platform
    if (info.year) r.y = info.year
    out.push(r)
  }
  return out
}

/**
 * Название без битых букв: некоторые источники отдают «�» вместо кириллицы (её испортили ещё при сборке файла).
 * Вычищаем их вместе с повисшими разделителями, чтобы в вариантах не было мусора
 */
const cleanTitle = (t: string) =>
  t.includes('�')
    ? t
        .replace(/�+/g, ' ')
        .replace(/[\s|/\-–—:,.]+$/, '')
        .replace(/\s{2,}/g, ' ')
        .trim()
    : t

function toEntry(e: RawEntry, sourceId: string): Entry {
  const keys: TitleKey[] = []
  for (let i = 0; i + 1 < e.k.length; i += 2) keys.push({ full: e.k[i], base: e.k[i + 1] })
  return { keys, sourceId, title: cleanTitle(e.t), uris: e.u, platform: e.p ?? 'pc', date: e.d, size: e.s, year: e.y }
}

/** Разных игр в источнике — по главному ключу */
const gamesIn = (list: RawEntry[]) => new Set(list.map((e) => e.k[1])).size

const signature = () => (sources ?? []).map((s) => `${s.id}:${s.updatedAt ?? 0}`).join('|')
const idOf = (url: string) => crypto.createHash('sha1').update(url).digest('hex').slice(0, 12)

function saveList() {
  if (!writeJson(listFile(), sources)) log('WARN', '[магазин] не удалось записать список источников')
}

const saveEntries = (id: string, list: RawEntry[]) => writeJson(entriesFile(id), { v: MATCH_V, list })

let cacheTimer: ReturnType<typeof setTimeout> | null = null
function saveCache() {
  cacheTimer ??= setTimeout(() => {
    cacheTimer = null
    writeJson(cacheFile(), cache)
  }, 2000)
}

// ───────────────────────── Сопоставление ─────────────────────────

/** Какой игре Steam принадлежит загрузка: undefined — Steam ещё не спрашивали, 0 — Steam её не знает */
function appOf(e: Entry): number | undefined {
  let asked = false
  for (const k of e.keys) {
    const hit = cache[k.base]
    if (!hit) continue
    asked = true
    if (!hit[0]) continue
    const alts = hit[2]
    if (alts && e.year) {
      const near = alts.find(([, y]) => y && Math.abs(y - e.year!) <= 1)
      if (near) return near[0]
    }
    return hit[0]
  }
  return asked ? 0 : undefined
}

/** Загрузка по названию подходит игре, если Steam не отдал её другой игре (оригинал и ремейк с одним названием) */
function fits(e: Entry, appId: number) {
  if (!appId) return true
  const owner = appOf(e)
  return !owner || owner === appId
}

/** Загрузки игры: совпадение по названию и то, что Steam раньше назвал этой игрой. Только для её платформы */
function entriesFor(appId: number, title: string, platform: Platform): Entry[] {
  if (!entries?.length) return []
  const found = new Set(index.find(titleKey(title)).filter((e) => e.platform === platform && fits(e, appId)))
  if (appId) {
    for (const base of byApp.get(appId) ?? []) for (const e of index.group(base)) if (e.platform === platform && appOf(e) === appId) found.add(e)
  }
  const hidden = appId ? unbound[appId] : undefined
  return hidden ? [...found].filter((e) => !hidden.includes(e.keys[0].base)) : [...found]
}

const kindOf = (uri: string): DownloadKind => (/^magnet:/i.test(uri) ? 'magnet' : /\.torrent(\?|#|$)/i.test(uri) ? 'torrent' : 'http')

/**
 * Варианты загрузки игры. Steam AppID нет (игра эмулятора, своя PC-игра) — только по названию.
 * Одноимённые загрузки, о которых Steam ещё не спрашивали, сначала уточняются у него — недолго
 */
export async function optionsFor(appId: number, title: string, platform: Platform = 'pc'): Promise<DownloadOption[]> {
  if (!loadList().length) return []
  await ensureIndex()
  refreshStale()
  if (appId) await settle(index.find(titleKey(title)).filter((e) => e.platform === platform))
  const names = new Map(loadList().map((s) => [s.id, s.name]))
  return entriesFor(appId, title, platform)
    .sort((a, b) => (b.date ?? 0) - (a.date ?? 0))
    .map((e) => ({
      key: e.keys[0].base,
      sourceId: e.sourceId,
      source: names.get(e.sourceId) ?? '',
      title: e.title,
      uris: e.uris,
      kind: kindOf(e.uris[0]),
      size: e.size,
      date: e.date
    }))
}

/** Спросить Steam о загрузках, о которых ещё не спрашивали; не дольше SETTLE_MS */
async function settle(list: Entry[]) {
  const unknown = [...new Map(list.filter((e) => appOf(e) === undefined).map((e) => [e.keys[0].base, e])).values()].slice(0, 6)
  if (!unknown.length) return
  await Promise.race([resolveMany(unknown).catch(() => []), new Promise((r) => setTimeout(r, SETTLE_MS))])
}

function decorate(items: StoreItem[]): StoreItem[] {
  return items.map((it) => {
    const n = entriesFor(it.appId, it.title, 'pc').length
    return n ? { ...it, options: n } : it
  })
}

/** Отметить у игр, сколько у них вариантов загрузки. exact — сначала уточнить одноимённые у Steam (страница игры) */
export async function decorateItems(items: StoreItem[], exact = false): Promise<StoreItem[]> {
  if (!loadList().length) return items
  await ensureIndex()
  if (exact) for (const it of items) await settle(index.find(titleKey(it.title)).filter((e) => e.platform === 'pc'))
  return decorate(items)
}

/** Витрина с вариантами загрузки и рядом «Новинки и свежие обновления» первым */
export async function decorateHome(h: StoreHome): Promise<StoreHome> {
  if (!loadList().length) return h
  await ensureIndex()
  refreshStale()
  if (!row || row.sig !== signature() || row.lang !== getLang() || row.v !== ITEM_V) refreshRow()
  const rows = h.rows.map((r) => ({ ...r, items: decorate(r.items) }))
  // Пока ряд пересобирается, показываем прошлый — без игр, у которых варианты пропали
  const fresh = row ? decorate(row.items).filter((i) => i.options) : []
  return { ...h, rows: fresh.length ? [{ id: 'sources', items: fresh }, ...rows] : rows }
}

const resolving = new Map<string, Promise<number>>()
const CYRILLIC = /[а-яё]/i

/**
 * AppID игры с этим ключом: из памяти или по одному поиску в Steam. Русские названия ищутся по-русски — так Steam
 * находит и русские игры, и локализованные названия («Ведьмак 3»)
 */
function resolve(base: string, terms: string[] = [base], also: string[] = []): Promise<number> {
  const hit = cache[base]
  if (hit && (hit[0] || Date.now() - hit[1] < MISS_TTL)) return Promise.resolve(hit[0])
  let p = resolving.get(base)
  if (!p) {
    const want = new Set([base, ...also])
    // Запросы по очереди, пока Steam не вернёт игру с этим названием
    const search = async () => {
      let list: Awaited<ReturnType<typeof searchTitles>> = []
      for (const term of [...new Set(terms)]) {
        list = await searchTitles(term, CYRILLIC.test(term) ? 'russian' : 'english')
        if (list.some((c) => want.has(titleKey(c.title).full) || want.has(titleKey(c.title).base))) break
      }
      return list
    }
    p = search()
      .then((list) => {
        // Все игры Steam с этим названием — у одноимённых загрузку разведёт год
        const same = list.filter((c) => {
          const k = titleKey(c.title)
          return want.has(k.full) || want.has(k.base)
        })
        const appId = same[0]?.appId ?? 0
        cache[base] = same.length > 1 ? [appId, Date.now(), same.map((c) => [c.appId, c.year ?? 0])] : [appId, Date.now()]
        for (const c of same) remember(c.appId, base)
        saveCache()
        return appId
      })
      .finally(() => resolving.delete(base))
    resolving.set(base, p)
  }
  return p
}

/**
 * Есть ли игра с таким названием в Steam: AppID или 0. Ответы общие с источниками (match-cache.json) — так GOG
 * сверяется со Steam один раз на название. Ошибка — Steam не ответил
 */
export function steamIdFor(title: string): Promise<number> {
  loadList()
  const k = titleKey(title)
  // Сначала по самому названию без скобок: по ключу Steam не находит «F.E.A.R.» («f e a r»), а «DOOM (2016)» —
  // по названию со скобками. Не нашлось — по ключу без издания («Tomb Raider GOTY» → «tomb raider»).
  // Совпасть может и полный ключ: «Painkiller Black Edition» и «Painkiller: Black Edition» — одна игра
  const name = title
    .replace(/[™®©]/g, '')
    .replace(/\s*[([{][^)\]}]*[)\]}]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return k.base ? resolve(k.base, [name || k.base, k.base], [k.full]) : Promise.resolve(0)
}

/** AppID загрузки: ключи по очереди («Grand Theft Auto V», потом «GTA 5»), с учётом года у одноимённых */
async function resolveEntry(e: Entry): Promise<number> {
  for (const k of e.keys) if (await resolve(k.base)) break
  return appOf(e) ?? 0
}

/**
 * Несколько загрузок, по четыре запроса сразу: AppID, 0 — Steam такой игры не знает, −1 — Steam не ответил
 * на этот запрос. Не ответил ни на один — Steam недоступен
 */
async function resolveMany(list: Entry[]): Promise<number[]> {
  const out = list.map(() => 0)
  let next = 0
  let failed = 0
  const worker = async () => {
    while (next < list.length) {
      const i = next++
      out[i] = await resolveEntry(list[i]).catch(() => (failed++, -1))
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker))
  if (failed && failed === list.length) throw new Error('Steam не ответил')
  return out
}

/** Свежие загрузки для PC, по одной на игру, от новых к старым */
function freshEntries(limit: number, filter?: (e: Entry) => boolean): Entry[] {
  const seen = new Set<string>()
  const out: Entry[] = []
  for (const e of entries ?? []) {
    const base = e.keys[0].base
    if (e.platform !== 'pc' || seen.has(base) || (filter && !filter(e))) continue
    seen.add(base)
    out.push(e)
    if (out.length >= limit) break
  }
  return out
}

let rowLoading: Promise<void> | null = null

/**
 * Плитки для загрузок по порядку: игра Steam, иначе та же игра в GOG, иначе игра только из источников (арт из
 * SteamGridDB). Steam не ответил на запрос (−1) — загрузку пропускаем: не выдаём игру Steam за игру без магазина
 */
async function itemsFor(list: Entry[], ids: number[], limit: number, budget = Infinity): Promise<StoreItem[]> {
  const steamIds = [...new Set(ids.filter((id) => id > 0))]
  const late = <T>(p: Promise<T>, fallback: T) => (Number.isFinite(budget) ? Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), budget))]) : p)
  // Steam и GOG — параллельно: GOG спрашиваем только о том, чего нет в Steam
  const [steamList, gogList] = await Promise.all([
    steamIds.length ? storeItems(steamIds).catch(() => []) : Promise.resolve([]),
    Promise.all(list.map((e, i) => (ids[i] === 0 ? late(gogFind(displayTitle(e.title)).catch(() => null), null) : Promise.resolve(null))))
  ])
  const steam = new Map(steamList.map((i) => [i.appId, i]))
  const out: StoreItem[] = []
  const seen = new Set<number>()
  for (let i = 0; i < list.length && out.length < limit; i++) {
    const id = ids[i]
    const item = id > 0 ? steam.get(id) : id === 0 ? (gogList[i] ?? srcItem(list[i].title, list[i].year)) : null
    if (item && !seen.has(item.appId)) {
      seen.add(item.appId)
      out.push(item)
    }
  }
  return withArt(out, budget)
}

function refreshRow() {
  rowLoading ??= (async () => {
    await ensureIndex()
    const sig = signature()
    const fresh = freshEntries(ROW_GROUPS)
    const items = await itemsFor(fresh, await resolveMany(fresh), ROW_SIZE)
    row = { sig, lang: getLang(), v: ITEM_V, items }
    writeJson(rowFile(), row)
    onChange?.()
  })()
    .catch(() => {
      /* без сети — прошлый ряд */
    })
    .finally(() => (rowLoading = null))
}

/**
 * Поиск: найденное в Steam, игры GOG, которых нет в Steam, и игры из источников с этим словом в названии — те, что
 * Steam не вернул, и те, которых нет ни в Steam, ни в GOG
 */
export async function mergeSearch(q: string, steam: StoreItem[], gog: StoreItem[] = []): Promise<StoreItem[]> {
  if (!loadList().length) return [...steam, ...gog]
  await ensureIndex()
  const words = titleKey(q).full
  if (words.length < 2) return decorate([...steam, ...gog])
  const list = freshEntries(SEARCH_GROUPS, (e) => e.keys.some((k) => k.full.includes(words)))
  const found = await resolveMany(list).catch(() => list.map(() => -1))
  // Игра GOG из выдачи — та же, что раздача с её названием: второй плиткой раздачу не показываем
  const gogKeys = new Set(gog.map((g) => titleKey(g.title).base))
  const have = new Set([...steam, ...gog].map((i) => i.appId))
  const rest = list.flatMap((e, i) => (have.has(found[i]) || (found[i] === 0 && e.keys.some((k) => gogKeys.has(k.base))) ? [] : [{ e, id: found[i] }]))
  const extra = await itemsFor(
    rest.map((r) => r.e),
    rest.map((r) => r.id),
    SEARCH_GROUPS,
    3000
  )
  const seen = new Set<number>()
  // Сначала Steam (что нашёл он и что нашлось по раздачам), потом GOG, потом игры только из источников
  return decorate([...steam, ...extra.filter((i) => !i.store), ...gog, ...extra.filter((i) => i.store)].filter((i) => !seen.has(i.appId) && !!seen.add(i.appId)))
}

/** «Не та игра»: ключ больше не показывается у этой игры, а если его нашёл Steam — забываем и это */
export function unbind(appId: number, key: string) {
  loadList()
  const list = unbound[appId] ?? []
  if (!list.includes(key)) unbound[appId] = [...list, key]
  if (!writeJson(overridesFile(), unbound)) log('WARN', '[магазин] не удалось записать «Не та игра»')
  const hit = cache[key]
  if (hit && appsOf(hit).includes(appId)) {
    const rest = (hit[2] ?? []).filter(([id]) => id !== appId)
    cache[key] = rest.length > 1 ? [rest[0][0], hit[1], rest] : [rest[0]?.[0] ?? 0, Date.now()]
    byApp.set(
      appId,
      (byApp.get(appId) ?? []).filter((b) => b !== key)
    )
    saveCache()
  }
  onChange?.()
}

// ───────────────────────── Источники ─────────────────────────

/** Список для настроек. Заодно повод обновить устаревшие */
export function listSources(): StoreSource[] {
  const list = loadList()
  refreshStale()
  return list
}

const isFile = (url: string) => /^file:/i.test(url)
/** Сами обновляются только источники по ссылке: файл с диска меняется, только когда его скачают заново */
const isStale = (s: StoreSource) => !isFile(s.url) && Date.now() - (s.updatedAt ?? 0) > STALE

let staleCheckedAt = 0

/** Устаревшие источники — в фоне, по событию (открыли магазин, «Скачать», настройки), не по таймеру */
function refreshStale() {
  if (Date.now() - staleCheckedAt < STALE_CHECK) return
  staleCheckedAt = Date.now()
  if (loadList().some(isStale)) void refreshSources('stale')
}

function errText(e: unknown): string {
  const name = (e as Error)?.name
  const msg = (e as Error)?.message ?? String(e)
  if (name === 'TimeoutError' || name === 'AbortError') return t('Источник не ответил за минуту')
  if (/net::ERR_/.test(msg)) return t('Нет связи с источником')
  return msg
}

/** Имя без названия в самом файле: сайт или имя файла */
const placeName = (url: string) => (isFile(url) ? path.basename(fileURLToPath(url)).replace(/\.json$/i, '') : new URL(url).hostname)

/** Байты источника: файл на диске (добавлен из файла — перечитывается при обновлении) или ссылка */
async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const tooBig = t('Файл больше 100 МБ — это не источник')
  if (isFile(url)) {
    const file = fileURLToPath(url)
    const st = await fs.promises.stat(file).catch(() => null)
    if (!st?.isFile()) throw new Error(t('Файл источника не найден: {file}', { file }))
    if (st.size > MAX_BYTES) throw new Error(tooBig)
    const b = await fs.promises.readFile(file)
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
  }
  const r = await httpFetch(url, { signal: AbortSignal.timeout(60_000) })
  if (!r.ok) {
    // Страница проверки браузера вместо файла: скачать его может только браузер
    const body = r.status === 403 || r.status === 503 ? await r.text().catch(() => '') : ''
    if (/just a moment|cloudflare|cf-chl/i.test(body)) throw new Error(t('Сайт пускает только браузеры (проверка Cloudflare). Скачайте файл в браузере и перетащите его сюда или добавьте кнопкой «Из файла»'))
    if (r.status === 404 || r.status === 410) throw new Error(t('Файла по ссылке нет (ошибка {code}): его удалили или в ссылке опечатка', { code: r.status }))
    if (r.status === 401 || r.status === 403) throw new Error(t('Доступ к файлу закрыт (ошибка {code})', { code: r.status }))
    throw new Error(t('Сервер ответил {code}', { code: r.status }))
  }
  if (Number(r.headers.get('content-length') ?? 0) > MAX_BYTES) throw new Error(tooBig)
  const buf = await r.arrayBuffer()
  if (buf.byteLength > MAX_BYTES) throw new Error(tooBig)
  return buf
}

/** Скачать и проверить источник, разобрать названия. Загрузки без ссылок и для чужих платформ отбрасываются */
async function fetchSource(url: string): Promise<{ name: string; list: RawEntry[]; games: number }> {
  const buf = await fetchBytes(url)
  let j: { name?: unknown; downloads?: unknown }
  const text = new TextDecoder().decode(buf).replace(/^﻿/, '')
  await breath()
  try {
    j = JSON.parse(text)
  } catch {
    throw new Error(isFile(url) ? t('Это не JSON-файл') : t('По ссылке не JSON'))
  }
  if (!j || typeof j !== 'object' || !Array.isArray(j.downloads)) throw new Error(t('В файле нет списка downloads — это не источник'))
  const bare: BareEntry[] = []
  for (const d of j.downloads as { title?: unknown; uris?: unknown; uploadDate?: unknown; fileSize?: unknown }[]) {
    if (typeof d?.title !== 'string' || !d.title.trim()) continue
    const uris = (Array.isArray(d.uris) ? d.uris : [])
      .filter((u): u is string => typeof u === 'string' && /^(magnet:|https?:\/\/)/i.test(u.trim()))
      .map((u) => u.trim())
      .slice(0, 20)
    if (!uris.length) continue
    const date = typeof d.uploadDate === 'string' ? Date.parse(d.uploadDate) : NaN
    const e: BareEntry = { t: cleanTitle(d.title.trim()).slice(0, 300), u: uris }
    if (Number.isFinite(date)) e.d = date
    if (typeof d.fileSize === 'string' && d.fileSize.trim()) e.s = d.fileSize.trim().slice(0, 40)
    bare.push(e)
  }
  if (!bare.length) throw new Error(t('В источнике нет ни одной ссылки'))
  const list = await withKeys(bare)
  if (!list.length) throw new Error(t('В источнике нет игр для PC, PS2 или PS3'))
  const name = typeof j.name === 'string' && j.name.trim() ? j.name.trim().slice(0, 60) : placeName(url)
  return { name, list, games: gamesIn(list) }
}

/** Источники поменялись: индекс соберётся заново при следующей надобности, витрина узнает через слушатель */
function changed() {
  generation++
  entries = null
  index = new TitleIndex()
  saveList()
  onChange?.()
}

export function addSource(url: string): Promise<{ source?: StoreSource; error?: string }> {
  const u = url.trim()
  if (!/^https?:\/\/\S+$/i.test(u)) return Promise.resolve({ error: t('Нужна ссылка, которая начинается с http:// или https://') })
  return addBy(u)
}

/** Источник из файла — когда сайт отдаёт его только браузеру. Путь запоминается, «Обновить» перечитывает файл */
export function addSourceFile(file: string): Promise<{ source?: StoreSource; error?: string }> {
  return addBy(pathToFileURL(path.resolve(file)).href)
}

async function addBy(u: string): Promise<{ source?: StoreSource; error?: string }> {
  const id = idOf(u)
  if (loadList().some((s) => s.id === id)) return { error: t('Этот источник уже добавлен') }
  try {
    const { name, list, games } = await fetchSource(u)
    if (!saveEntries(id, list)) return { error: t('Не удалось записать источник на диск') }
    const source: StoreSource = { id, url: u, name, addedAt: Date.now(), updatedAt: Date.now(), count: list.length, games }
    sources = [...loadList(), source]
    changed()
    return { source }
  } catch (e) {
    return { error: errText(e) }
  }
}

export function removeSource(id: string) {
  sources = loadList().filter((s) => s.id !== id)
  fs.rmSync(entriesFile(id), { force: true })
  changed()
}

/** Обновления идут по очереди: фоновое (устаревшие) не подменяет то, что попросили кнопкой */
let refreshQueue: Promise<unknown> = Promise.resolve()

/**
 * Обновить источники: все (кнопка), один по id или только устаревшие по ссылке (stale — в фоне по событию).
 * Неудача не стирает прошлые загрузки
 */
export function refreshSources(which: 'all' | 'stale' | string = 'all'): Promise<StoreSource[]> {
  const run = refreshQueue.then(async () => {
    const due = loadList().filter((s) => (which === 'all' ? true : which === 'stale' ? isStale(s) : s.id === which))
    for (const s of due) {
      try {
        const { name, list, games } = await fetchSource(s.url)
        if (!saveEntries(s.id, list)) throw new Error(t('Не удалось записать источник на диск'))
        Object.assign(s, { name, count: list.length, games, updatedAt: Date.now(), error: undefined })
      } catch (e) {
        s.error = errText(e)
      }
    }
    if (due.length) changed()
    return loadList()
  })
  refreshQueue = run.catch(() => {})
  return run
}
