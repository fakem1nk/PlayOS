import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { CloudRestoreOffer, Game, Session, Settings } from '@shared/types'
import { log } from '../log'
import { artDir, dataDir, getDb, saveDb } from '../store'
import { normTitle } from './ludusavi'
import { OfflineError, type Remote } from './remote'

/**
 * Профиль и библиотека в облаке:
 *   profile/profile.json + profile/avatar.<ext> — имя, аватар, трофеи PlayOS и настройки, не привязанные к ПК
 *   library/library.json — игры без путей к файлам, время, сессии и ссылки на арт (сам арт в облако не идёт:
 *   другой ПК скачает его по ссылкам, а свой арт с диска заменит найденным в сети)
 * Слияние автоматическое: поля игры — от более свежей записи, сессии — объединение,
 * время — счётчики по ПК (каждый ПК наращивает свой, поэтому сложение не задваивает),
 * удаление — «надгробие» с временем. Пути к играм у каждого ПК свои и в облако не попадают.
 */

const ART = ['cover', 'coverAnimated', 'hero', 'logo', 'icon'] as const
type ArtField = (typeof ART)[number]
const MAX_ART = 20 * 2 ** 20

/** Настройки этого ПК: пути, экраны, автозапуск — их облако не трогает */
const DEVICE_KEYS = new Set<keyof Settings>([
  'avatar',
  'trophies',
  'pcsx2Path',
  'pcsx2Args',
  'rpcs3Path',
  'rpcs3Args',
  'rpcs3SaveKey',
  'fullscreen',
  'launchOnStartup',
  'uiScale',
  'displayId',
  'displayLabel',
  'gameDisplay',
  'gameDisplayLabel',
  'onboarded',
  'betaUpdates',
  'collections',
  'cloud'
])
export const isPortableSetting = (k: string) => !DEVICE_KEYS.has(k as keyof Settings)

export interface CloudGame {
  key: string
  title: string
  platform: Game['platform']
  launcher?: Game['launcher']
  serial?: string
  steamAppId?: number
  raGameId?: number
  args?: string
  trackProcess?: string
  favorite?: boolean
  overlay?: boolean
  cloudSaves?: boolean
  accent?: string
  accentV?: number
  addedAt: number
  updatedAt: number
  lastPlayed?: number
  resetAt?: number
  playtimeBase: number
  playtimeBy: Record<string, number>
  sessions: Session[]
  /** Поле арта → ссылка, откуда он скачан */
  art: Partial<Record<ArtField, string>>
}

export interface CloudLibrary {
  version: 1
  games: CloudGame[]
  deleted: { key: string; at: number }[]
}

export interface Seen {
  library?: number
  profile?: number
  /** Что мы последний раз записали — без изменений не пишем */
  libraryJson?: string
  profileJson?: string
}

export interface CloudProfile {
  version: 1
  updatedAt: number
  device: string
  settings: Partial<Settings>
  trophies: Record<string, number>
  avatar?: string
}

/** Ключ игры, одинаковый на всех ПК */
export function libraryKey(g: Pick<Game, 'platform' | 'launcher' | 'steamAppId' | 'serial' | 'title'>) {
  if (g.launcher === 'steam' && g.steamAppId) return `steam:${g.steamAppId}`
  if (g.platform !== 'pc' && g.serial) return `${g.platform}:${g.serial}`
  if (g.platform === 'pc' && g.steamAppId) return `pc:${g.steamAppId}`
  return `${g.platform}:t:${normTitle(g.title)}`
}

const LWW = ['title', 'launcher', 'serial', 'steamAppId', 'raGameId', 'args', 'trackProcess', 'favorite', 'overlay', 'cloudSaves', 'accent', 'accentV'] as const
const sum = (by: Record<string, number>) => Object.values(by).reduce((a, b) => a + b, 0)
const baseOf = (g: Game) => g.playtimeBase ?? Math.max(0, g.playtime - sum(g.playtimeBy ?? {}))
const changedAt = (g: Game) => g.updatedAt ?? g.addedAt

const sigCache = new Map<string, { size: number; mtime: number; sig: string }>()
/** Подпись файла арта: хэш содержимого + расширение. null — файла нет или он слишком большой */
function artSig(file?: string): string | null {
  if (!file || /^https?:/.test(file)) return null
  try {
    const st = fs.statSync(file)
    if (st.size > MAX_ART) return null
    const hit = sigCache.get(file)
    if (hit && hit.size === st.size && hit.mtime === st.mtimeMs) return hit.sig
    const sig = createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 16) + path.extname(file).toLowerCase()
    sigCache.set(file, { size: st.size, mtime: st.mtimeMs, sig })
    return sig
  } catch {
    return null
  }
}

function toCloud(g: Game, key: string): CloudGame {
  const art: CloudGame['art'] = { ...(g.artSrc ?? {}) }
  const out: CloudGame = {
    key,
    title: g.title,
    platform: g.platform,
    addedAt: g.addedAt,
    updatedAt: changedAt(g),
    lastPlayed: g.lastPlayed,
    resetAt: g.resetAt,
    playtimeBase: baseOf(g),
    playtimeBy: g.playtimeBy ?? {},
    sessions: g.sessions,
    art
  }
  for (const f of LWW) if (g[f] !== undefined) (out as unknown as Record<string, unknown>)[f] = g[f]
  return out
}

/**
 * Слияние локальной библиотеки с облачной. Меняет локальные игры на месте и возвращает игры,
 * которым нужен арт (новые с другого ПК или с новыми ссылками). Чистая логика без сети.
 */
export function mergeLibrary(games: Game[], deletedLocal: { key: string; at: number }[], remote: CloudLibrary | null) {
  const deleted = new Map<string, number>()
  for (const d of [...deletedLocal, ...(remote?.deleted ?? [])]) deleted.set(d.key, Math.max(deleted.get(d.key) ?? 0, d.at))
  const remoteByKey = new Map((remote?.games ?? []).map((g) => [g.key, g]))
  const kept: Game[] = []
  const removed: Game[] = []
  const cloud: CloudGame[] = []
  const needArt: Game[] = []
  const seen = new Set<string>()

  for (const g of games) {
    // Ключ запоминается при первой синхронизации: потом название или Steam AppID могут поменяться (выбрали арт из Steam),
    // а игра должна остаться той же — иначе старая запись в облаке вернулась бы второй игрой
    const key = g.cloudKey ?? libraryKey(g)
    g.cloudKey = key
    // Две локальные записи одной игры — в облако уходит одна
    if (seen.has(key)) {
      kept.push(g)
      continue
    }
    seen.add(key)
    const r = remoteByKey.get(key)
    remoteByKey.delete(key)
    const tomb = deleted.get(key)
    if (tomb && tomb > Math.max(changedAt(g), g.lastPlayed ?? 0, r?.updatedAt ?? 0, r?.lastPlayed ?? 0)) {
      removed.push(g)
      continue
    }
    if (tomb) deleted.delete(key)
    kept.push(g)
    if (!r) {
      cloud.push(toCloud(g, key))
      continue
    }
    const localNewer = changedAt(g) >= r.updatedAt
    if (!localNewer) {
      for (const f of LWW) (g as unknown as Record<string, unknown>)[f] = r[f]
      g.updatedAt = r.updatedAt
    }
    // Время: сброс побеждает всё, что было до него; иначе — счётчики по ПК (максимум) и объединение сессий
    const rl = g.resetAt ?? 0
    const rr = r.resetAt ?? 0
    if (rr > rl) {
      g.playtimeBase = r.playtimeBase
      g.playtimeBy = { ...r.playtimeBy }
      g.sessions = [...r.sessions]
      g.resetAt = rr
    } else if (rl === rr) {
      const by = { ...(g.playtimeBy ?? {}) }
      for (const [d, v] of Object.entries(r.playtimeBy)) by[d] = Math.max(by[d] ?? 0, v)
      g.playtimeBase = Math.max(baseOf(g), r.playtimeBase)
      g.playtimeBy = by
      const starts = new Map(g.sessions.map((s) => [s.start, s]))
      for (const s of r.sessions) if (!starts.has(s.start)) starts.set(s.start, s)
      g.sessions = [...starts.values()].sort((a, b) => a.start - b.start).slice(-100)
    }
    g.playtime = (g.playtimeBase ?? 0) + sum(g.playtimeBy ?? {})
    g.lastPlayed = Math.max(g.lastPlayed ?? 0, r.lastPlayed ?? 0) || undefined
    // Арт следует за более свежей записью: новые ссылки — скачать заново
    if (!localNewer && JSON.stringify(r.art) !== JSON.stringify(g.artSrc ?? {})) {
      g.artSrc = { ...r.art }
      needArt.push(g)
    }
    const c = toCloud(g, key)
    cloud.push(c)
  }

  // Игры, которых на этом ПК нет: добавляем как «не установленные»
  for (const r of remoteByKey.values()) {
    const tomb = deleted.get(r.key)
    if (tomb && tomb > Math.max(r.updatedAt, r.lastPlayed ?? 0)) continue
    const g: Game = {
      id: randomUUID(),
      cloudKey: r.key,
      title: r.title,
      platform: r.platform,
      path: '',
      addedAt: r.addedAt,
      updatedAt: r.updatedAt,
      lastPlayed: r.lastPlayed,
      resetAt: r.resetAt,
      playtimeBase: r.playtimeBase,
      playtimeBy: { ...r.playtimeBy },
      playtime: r.playtimeBase + sum(r.playtimeBy),
      sessions: [...r.sessions]
    }
    for (const f of LWW) if (r[f] !== undefined) (g as unknown as Record<string, unknown>)[f] = r[f]
    if (Object.keys(r.art).length) g.artSrc = { ...r.art }
    kept.push(g)
    cloud.push(r)
    needArt.push(g)
  }

  return {
    games: kept,
    removed,
    deleted: [...deleted].map(([key, at]) => ({ key, at })),
    cloud: { version: 1, games: cloud.sort((a, b) => a.key.localeCompare(b.key)), deleted: [...deleted].map(([key, at]) => ({ key, at })) } as CloudLibrary,
    needArt
  }
}

/** Профиль: свежие настройки побеждают целиком, трофеи PlayOS объединяются */
export function mergeProfile(settings: Settings, settingsAt: number, remote: CloudProfile | null) {
  const trophies = { ...settings.trophies }
  for (const [id, at] of Object.entries(remote?.trophies ?? {})) trophies[id] = trophies[id] ? Math.min(trophies[id], at) : at
  const remoteWins = !!remote && remote.updatedAt > settingsAt
  const portable = Object.fromEntries(Object.entries(settings).filter(([k]) => isPortableSetting(k))) as Partial<Settings>
  return {
    remoteWins,
    patch: { ...(remoteWins ? remote!.settings : {}), trophies } as Partial<Settings>,
    cloud: {
      version: 1,
      updatedAt: remoteWins ? remote!.updatedAt : settingsAt,
      device: remoteWins ? remote!.device : '',
      settings: remoteWins ? remote!.settings : portable,
      trophies,
      avatar: remoteWins ? remote!.avatar : (artSig(settings.avatar) ?? undefined)
    } as CloudProfile
  }
}

// ── Сеть ──

async function readJson<T>(r: Remote, dir: string, name: string, seen: number | undefined): Promise<{ data: T | null; modified?: number; unchanged: boolean }> {
  const entry = (await r.list(dir)).find((e) => e.name === name)
  if (!entry) return { data: null, unchanged: false }
  if (seen && entry.modified === seen) return { data: null, modified: entry.modified, unchanged: true }
  return { data: JSON.parse((await r.read(`${dir}/${name}`)).toString('utf8')) as T, modified: entry.modified, unchanged: false }
}

/** Есть ли в облаке профиль — для предложения восстановить его */
export async function cloudOffer(r: Remote): Promise<CloudRestoreOffer | null> {
  const prof = await readJson<CloudProfile>(r, 'profile', 'profile.json', undefined)
  const lib = await readJson<CloudLibrary>(r, 'library', 'library.json', undefined)
  if (!prof.data && !lib.data) return null
  return {
    name: prof.data?.settings.userName ?? '',
    device: prof.data?.device ?? '',
    at: prof.data?.updatedAt ?? lib.modified ?? 0,
    games: lib.data?.games.length ?? 0,
    merge: getDb().games.length > 0
  }
}

export interface Hooks {
  deviceName: string
  applySettings: (patch: Partial<Settings>) => void
  changed: () => void
  /** Игры из облака без файла: ищем, где они установлены на этом ПК */
  locate: (games: Game[]) => Promise<void>
  /** Скачать арт по ссылкам из облака, а если их нет — найти похожий в сети */
  fillArt: (game: Game) => Promise<void>
}

export async function syncLibrary(r: Remote, seen: Seen, hooks: Hooks) {
  const db = getDb()
  const remote = await readJson<CloudLibrary>(r, 'library', 'library.json', seen.library)
  // Облако не менялось с прошлого раза — сравниваем только со своим прошлым снимком
  const base: CloudLibrary | null = remote.unchanged ? (seen.libraryJson ? (JSON.parse(seen.libraryJson) as CloudLibrary) : null) : remote.data
  const before = db.games.length
  const m = mergeLibrary(db.games, db.deleted ?? [], base)
  const added = m.games.filter((g) => !g.path && !db.games.includes(g))
  db.games = m.games
  db.deleted = m.deleted
  for (const g of m.removed) fs.rmSync(artDir(g.id), { recursive: true, force: true })
  if (added.length) await hooks.locate(added)
  for (const g of m.needArt) await hooks.fillArt(g).catch((e) => log('WARN', `Облако: арт для «${g.title}» не скачался`, (e as Error).message))
  saveDb()
  hooks.changed()
  const json = JSON.stringify(m.cloud)
  if (json !== JSON.stringify(base)) {
    await r.write('library/library.json', Buffer.from(json))
    seen.library = (await r.list('library')).find((e) => e.name === 'library.json')?.modified
  } else if (remote.modified) seen.library = remote.modified
  seen.libraryJson = json
  if (m.games.length !== before || m.removed.length) log('INFO', `Облако: библиотека ${before} → ${m.games.length} игр`)
}

export async function syncProfile(r: Remote, seen: Seen, hooks: Hooks) {
  const db = getDb()
  const remote = await readJson<CloudProfile>(r, 'profile', 'profile.json', seen.profile)
  const base = remote.unchanged ? (seen.profileJson ? (JSON.parse(seen.profileJson) as CloudProfile) : null) : remote.data
  const m = mergeProfile(db.settings, db.settingsAt ?? 0, base)
  if (m.remoteWins) {
    db.settingsAt = m.cloud.updatedAt
    if (m.cloud.avatar && m.cloud.avatar !== artSig(db.settings.avatar)) {
      try {
        const data = await r.read(`profile/avatar${path.extname(m.cloud.avatar)}`)
        // Имя с подписью: новый аватар — новый файл, без старой картинки из кэша
        const file = path.join(dataDir(), `avatar-cloud-${m.cloud.avatar}`)
        fs.writeFileSync(file, data)
        m.patch.avatar = file
      } catch (e) {
        if (e instanceof OfflineError) throw e
      }
    }
  }
  hooks.applySettings(m.patch)
  if (!m.remoteWins) {
    if (!m.cloud.updatedAt) m.cloud.updatedAt = db.settingsAt = Date.now()
    m.cloud.device = hooks.deviceName
    if (m.cloud.avatar && m.cloud.avatar !== base?.avatar && db.settings.avatar) {
      await r.write(`profile/avatar${path.extname(m.cloud.avatar)}`, fs.readFileSync(db.settings.avatar))
    }
  }
  const json = JSON.stringify(m.cloud)
  if (json !== JSON.stringify(base)) {
    await r.write('profile/profile.json', Buffer.from(json))
    seen.profile = (await r.list('profile')).find((e) => e.name === 'profile.json')?.modified
  } else if (remote.modified) seen.profile = remote.modified
  seen.profileJson = json
}
