import type { Settings } from '@shared/types'
import { MAX_SESSIONS } from '../store'
import type { CloudGame, CloudLibrary, CloudProfile } from './library'

/**
 * Профиль и библиотека из облака — чужие данные: файл мог записать кто угодно с доступом к папке или аккаунту,
 * а клиент облака — докачать его наполовину. Отсюда выходят только поля известных типов и разумного размера.
 * Порядок ключей сохраняется как в облаке: слияние сравнивает JSON до и после, и другой порядок
 * заставил бы два ПК бесконечно перезаписывать файл друг за другом.
 */

type Check = (v: unknown) => unknown

const DAY = 86_400_000
const MAX_GAMES = 50_000

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max ? v : undefined)
const text =
  (max: number): Check =>
  (v) =>
    str(v, max)
const num: Check = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const count: Check = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)
const bool: Check = (v) => (typeof v === 'boolean' ? v : undefined)
const oneOf =
  (...list: string[]): Check =>
  (v) =>
    list.includes(v as string) ? v : undefined
/** Время не из будущего: иначе запись с «вечной» датой побеждала бы любую правку на всех ПК */
const time: Check = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(v, Date.now() + DAY) : undefined)

/** Известные поля нужного типа, в порядке исходного объекта; rest — пропускать ли незнакомые ключи как есть */
function pick(raw: unknown, checks: Map<string, Check>, rest = false): Record<string, unknown> | undefined {
  if (!isObj(raw)) return undefined
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (k === '__proto__') continue
    const check = checks.get(k)
    const x = check ? check(v) : rest ? v : undefined
    if (x !== undefined) out[k] = x
  }
  return out
}

const record =
  (value: Check, max = 2000): Check =>
  (v) => {
    if (!isObj(v)) return undefined
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v).slice(0, max)) {
      const y = k === '__proto__' || k.length > 128 ? undefined : value(x)
      if (y !== undefined) out[k] = y
    }
    return out
  }

const list =
  (item: Check, max: number): Check =>
  (v) =>
    Array.isArray(v)
      ? v
          .slice(0, max)
          .map(item)
          .filter((x) => x !== undefined)
      : undefined

/** Ссылка на арт: только http(s) и не адрес этого ПК или домашней сети — по ней PlayOS сам делает запрос */
export const webUrl: Check = (v) => {
  const s = str(v, 2048)
  if (!s) return undefined
  try {
    const u = new URL(s)
    const h = u.hostname.toLowerCase()
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined
    if (u.username || u.password || h.startsWith('[') || !h.includes('.') || /\.(localhost|local|lan|internal)$/.test(h)) return undefined
    if (/^(0|10|127)\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^\d+$/.test(h)) return undefined
    return s
  } catch {
    return undefined
  }
}

const SESSION = new Map<string, Check>([
  ['start', time],
  ['duration', count]
])
const session: Check = (v) => {
  const s = pick(v, SESSION)
  return s && s.start !== undefined && s.duration !== undefined ? s : undefined
}

const DONE = new Map<string, Check>([
  ['at', time],
  ['full', bool],
  ['mood', oneOf('love', 'happy', 'ok', 'meh', 'bad')],
  ['playtime', count],
  ['days', count]
])
const done: Check = (v) => {
  const d = pick(v, DONE)
  return d && d.at !== undefined && d.playtime !== undefined && d.days !== undefined ? d : undefined
}

const ART = new Map<string, Check>(['cover', 'coverAnimated', 'hero', 'logo', 'icon'].map((f) => [f, webUrl]))

const GAME = new Map<string, Check>([
  ['key', text(400)],
  ['title', text(400)],
  ['platform', oneOf('pc', 'ps2', 'ps3')],
  ['launcher', oneOf('steam')],
  ['serial', text(64)],
  ['steamAppId', num],
  ['raGameId', num],
  ['favorite', bool],
  ['overlay', bool],
  ['cloudSaves', bool],
  ['accent', (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : undefined)],
  ['accentV', num],
  ['done', done],
  ['pile', record(num, 200)],
  ['fieldAt', record(time, 32)],
  ['addedAt', time],
  ['updatedAt', time],
  ['lastPlayed', time],
  ['resetAt', time],
  ['playtimeBase', count],
  ['playtimeBy', record(count)],
  ['sessions', (v) => (Array.isArray(v) ? v.map(session).filter((s) => s !== undefined).slice(-MAX_SESSIONS) : undefined)],
  ['art', (v) => pick(v, ART)]
])

function game(raw: unknown): CloudGame | undefined {
  const g = pick(raw, GAME)
  if (!g || !g.key || !g.title || !g.platform) return undefined
  g.addedAt ??= 0
  g.updatedAt ??= g.addedAt
  g.playtimeBase ??= 0
  g.playtimeBy ??= {}
  g.sessions ??= []
  g.art ??= {}
  return g as unknown as CloudGame
}

/** library.json из облака. Не объект с играми — ошибка, а не «облако пустое»: пустое мы бы перезаписали своим */
export function cleanLibrary(raw: unknown): CloudLibrary {
  if (!isObj(raw) || !Array.isArray(raw.games)) throw new Error('library.json в облаке повреждён')
  const soon = Date.now() + DAY
  const games = raw.games
    .slice(0, MAX_GAMES)
    .map(game)
    .filter((g) => g !== undefined)
  const deleted = (Array.isArray(raw.deleted) ? raw.deleted : [])
    .filter((d): d is { key: string; at: number } => isObj(d) && typeof d.key === 'string' && d.key.length <= 400 && typeof d.at === 'number' && d.at >= 0 && d.at <= soon)
    .map((d) => ({ key: d.key, at: d.at }))
  return { version: 1, games, deleted }
}

const volume = oneOf('low', 'mid', 'high')
const padMap = record(record((v) => (isObj(v) ? v : undefined), 64), 64)
const build: Check = (v) => {
  const b = pick(
    v,
    new Map<string, Check>([
      ['id', text(64)],
      ['name', text(128)]
    ])
  )
  return b && b.id !== undefined && b.name !== undefined ? b : undefined
}

/** Настройки, которые ходят между ПК: значение не того типа отбрасывается, а не ломает интерфейс */
const SETTINGS = new Map<string, Check>([
  ['userName', text(128)],
  ['sounds', bool],
  ['volume', volume],
  ['menuRumble', bool],
  ['music', bool],
  ['musicVolume', volume],
  ['glyphs', oneOf('auto', 'playstation', 'xbox', 'nintendo', 'keyboard')],
  ['pauseOnOverlay', oneOf('all', 'emulators', 'off')],
  ['freeMemoryInGame', bool],
  ['overlayEnabled', bool],
  ['steamGridDbKey', text(256)],
  ['raUser', text(256)],
  ['raKey', text(256)],
  ['steamKey', text(256)],
  ['steamId', text(256)],
  ['trophyPopups', bool],
  ['dsxLightbar', bool],
  ['trophyRumble', bool],
  ['trophyShots', bool],
  ['animatedCovers', bool],
  ['liveBackground', bool],
  ['screensaver', count],
  ['tivi', bool],
  ['storeAdult', bool],
  ['lowBatteryWarning', bool],
  ['keepArchives', bool],
  ['downloadPauseInGame', bool],
  ['noticePopups', bool],
  ['noticeTime', oneOf('short', 'normal', 'long')],
  ['noticeTrophies', bool],
  ['gameTint', bool],
  ['padMaps', padMap],
  ['language', oneOf('ru', 'en')],
  ['theme', oneOf('dark', 'light', 'system')],
  ['librarySort', oneOf('recent', 'name', 'time', 'added', 'manual')],
  ['builds', list(build, 64)],
  ['build', text(64)],
  ['figuresSeen', list(text(64), 200)]
])

/** Подпись аватара: 16 знаков хэша и расширение. Из неё собирается имя файла на диске — ничего, кроме букв и цифр */
export const AVATAR_SIG = /^[0-9a-f]{16}\.[a-z0-9]{1,8}$/

/** profile.json из облака. Незнакомые настройки (от более новой версии PlayOS) остаются как есть */
export function cleanProfile(raw: unknown): CloudProfile {
  if (!isObj(raw)) throw new Error('profile.json в облаке повреждён')
  return {
    version: 1,
    updatedAt: (time(raw.updatedAt) as number | undefined) ?? 0,
    device: str(raw.device, 128) ?? '',
    settings: (pick(raw.settings, SETTINGS, true) ?? {}) as Partial<Settings>,
    trophies: (record(time)(raw.trophies) ?? {}) as Record<string, number>,
    avatar: typeof raw.avatar === 'string' && AVATAR_SIG.test(raw.avatar) ? raw.avatar : undefined
  }
}
