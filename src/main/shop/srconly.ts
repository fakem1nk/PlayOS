import crypto from 'node:crypto'
import path from 'node:path'
import type { StoreItem, StorePage } from '@shared/types'
import { getLang } from '@shared/i18n'
import { displayTitle, titleKey } from '@shared/match'
import { SRC_BASE } from '@shared/types'
import { wikiSummary } from '../details'
import { sgdbArt } from '../media'
import { dataDir, getDb } from '../store'
import { readJson, writeJson } from './disk'

/**
 * Игры, которые есть только в источниках пользователя: их не знают ни Steam, ни GOG. Название — из раздачи без
 * обвеса, обложка, фон и логотип — из SteamGridDB (если в настройках есть ключ), описание — из Википедии.
 * Номер в магазине — ниже −SRC_BASE, из хеша ключа названия: одна игра — один номер на любом ПК и после перезапуска.
 */

const HOUR = 3_600_000
/** SteamGridDB не знает игру — спросим снова через неделю (или сразу, когда появится ключ) */
const MISS_TTL = 7 * 24 * HOUR
const PAGE_TTL = 7 * 24 * HOUR
/** Сколько игр помнить на диске */
const KNOWN_MAX = 2000

interface Known {
  title: string
  year?: number
  art?: { cover?: string; hero?: string; logo?: string }
  /** Когда искали арт (0 — ещё не искали) и с ключом ли */
  artAt?: number
  /** Описание из Википедии на языке интерфейса */
  about?: { lang: string; text: string; at: number }
}

const file = () => path.join(dataDir(), 'shop', 'src-items.json')
let known: Map<number, Known> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null

function knownMap(): Map<number, Known> {
  if (!known) known = new Map(Object.entries(readJson<Record<string, Known>>(file()) ?? {}).map(([k, v]) => [Number(k), v]))
  return known
}

function save() {
  saveTimer ??= setTimeout(() => {
    saveTimer = null
    const map = knownMap()
    while (map.size > KNOWN_MAX) map.delete(map.keys().next().value!)
    writeJson(file(), Object.fromEntries(map))
  }, 2000)
}

export const isSrcId = (appId: number) => appId <= -SRC_BASE

/** Номер игры в магазине по ключу её названия */
function idOf(key: string) {
  return -(SRC_BASE + parseInt(crypto.createHash('sha1').update(key).digest('hex').slice(0, 8), 16))
}

function toItem(appId: number, k: Known): StoreItem {
  return { appId, store: 'sources', title: k.title, ...k.art }
}

/** Плитка игры из раздачи: название без версий и обвеса, арт — если уже нашёлся */
export function srcItem(entryTitle: string, year?: number): StoreItem | null {
  const title = displayTitle(entryTitle)
  const k = titleKey(title)
  if (!k.full) return null
  const appId = idOf(k.full)
  const map = knownMap()
  let rec = map.get(appId)
  if (!rec) {
    rec = { title, ...(year ? { year } : {}) }
    map.set(appId, rec)
    save()
  }
  return toItem(appId, rec)
}

export function srcItemOf(appId: number): StoreItem | null {
  const rec = isSrcId(appId) ? knownMap().get(appId) : undefined
  return rec ? toItem(appId, rec) : null
}

const sgdbKey = () => getDb()?.settings.steamGridDbKey?.trim() ?? ''

/**
 * Арт из SteamGridDB для плиток без него — по три запроса на игру, не больше двух игр сразу. Без ключа — как есть.
 * budget — сколько ждать: что не успело, придёт к следующему показу
 */
export async function withArt(items: StoreItem[], budget = Infinity): Promise<StoreItem[]> {
  const key = sgdbKey()
  if (!key) return items
  const map = knownMap()
  const due = items.filter((it) => {
    const rec = map.get(it.appId)
    return rec && !rec.art && (!rec.artAt || Date.now() - rec.artAt > MISS_TTL)
  })
  if (due.length) {
    let next = 0
    const worker = async () => {
      while (next < due.length) {
        const it = due[next++]
        const rec = map.get(it.appId)!
        const k = titleKey(rec.title)
        const art = await sgdbArt(rec.title, key, (name) => {
          const nk = titleKey(name)
          return nk.full === k.full || nk.base === k.base
        }).catch(() => undefined)
        // Ошибка сети — не запоминаем, спросим в следующий раз
        if (art === undefined) continue
        rec.artAt = Date.now()
        if (art) rec.art = art
        save()
      }
    }
    const all = Promise.all([worker(), worker()])
    await (Number.isFinite(budget) ? Promise.race([all, new Promise((r) => setTimeout(r, budget))]) : all)
  }
  return items.map((it) => (isSrcId(it.appId) && map.get(it.appId)?.art ? { ...it, ...map.get(it.appId)!.art } : it))
}

/** Страница игры из источников: описание из Википедии (на языке интерфейса, потом другой), арт — из SteamGridDB */
export async function srcPage(appId: number): Promise<StorePage | null> {
  const rec = knownMap().get(appId)
  if (!rec) return null
  await withArt([toItem(appId, rec)], 8000)
  const lang = getLang()
  if (!rec.about || rec.about.lang !== lang || Date.now() - rec.about.at > PAGE_TTL) {
    const text = await wikiSummary(rec.title).catch(() => undefined)
    // Не нашлось (или не было сети) — пустое описание, спросим снова через несколько часов
    if (text || !rec.about) {
      rec.about = { lang, text: text ?? '', at: text ? Date.now() : Date.now() - PAGE_TTL + 6 * HOUR }
      save()
    }
  }
  return {
    ...toItem(appId, rec),
    about: rec.about?.text ? [{ kind: 'p', text: rec.about.text }] : [],
    developers: [],
    publishers: [],
    screenshots: []
  }
}
