import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { t } from '@shared/i18n'
import type { CloudRestoreOffer, Game, GameDone, Session, Settings } from '@shared/types'
import { log } from '../log'
import { artDir, dataDir, getDb, MAX_SESSIONS, saveDb } from '../store'
import { normTitle } from './ludusavi'
import { OfflineError, type Remote } from './remote'
import { AVATAR_SIG, cleanLibrary, cleanProfile, webUrl } from './untrusted'

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
  'trayHintShown',
  'launchOnStartup',
  'startInTray',
  'uiScale',
  'noticeSize',
  'tiviSize',
  'downloadDirs',
  'downloadLimit',
  'uploadLimit',
  'seed',
  'seedRatio',
  'displayId',
  'displayLabel',
  'gameDisplay',
  'gameDisplayLabel',
  'onboarded',
  'betaUpdates',
  // Ключи API — секреты: в облаке они лежали бы открытым текстом. На каждом ПК вводятся свои (есть «Получить ключ»)
  'steamKey',
  'raKey',
  'steamGridDbKey',
  'collections',
  'cloud'
])
export const isPortableSetting = (k: string) => !DEVICE_KEYS.has(k as keyof Settings)
/**
 * Время правки для слияния между ПК: не раньше того, что этот ПК уже видел (+1 мс).
 * Иначе на ПК с отстающими часами свежая правка проиграла бы старой
 */
export const stamp = (...seen: (number | undefined)[]) => Math.max(Date.now(), ...seen.map((t) => (t ?? 0) + 1))
const portableOf = (s: Partial<Settings>) => Object.fromEntries(Object.entries(s).filter(([k]) => isPortableSetting(k))) as Partial<Settings>

export interface CloudGame {
  key: string
  title: string
  platform: Game['platform']
  launcher?: Game['launcher']
  serial?: string
  steamAppId?: number
  raGameId?: number
  favorite?: boolean
  overlay?: boolean
  cloudSaves?: boolean
  accent?: string
  accentV?: number
  /** Полка и стопка профиля */
  done?: GameDone
  pile?: Record<string, number>
  /** Время правки отдельных полей (см. Game.fieldAt); нет — все поля менялись в updatedAt */
  fieldAt?: Record<string, number>
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

// Параметры запуска и имя процесса (args, trackProcess) — у каждого ПК свои и в облако не идут:
// параметр командной строки, пришедший из облака, мог бы запустить на этом ПК чужую программу
const LWW = ['title', 'launcher', 'serial', 'steamAppId', 'raGameId', 'favorite', 'overlay', 'cloudSaves', 'accent', 'accentV', 'done', 'pile'] as const
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
    // Подпись становится именем файла на другом ПК: необычное расширение туда не уходит
    if (!AVATAR_SIG.test(sig)) return null
    sigCache.set(file, { size: st.size, mtime: st.mtimeMs, sig })
    return sig
  } catch {
    return null
  }
}

function toCloud(g: Game, key: string): CloudGame {
  // Те же правила, что при чтении из облака: ссылку, которую другой ПК отбросит, не отправляем
  const art: CloudGame['art'] = {}
  for (const [f, url] of Object.entries(g.artSrc ?? {}) as [ArtField, string][]) if (ART.includes(f) && webUrl(url)) art[f] = url
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
  if (g.fieldAt) out.fieldAt = g.fieldAt
  return out
}

const json = (v: unknown) => String(JSON.stringify(v))
/** Времена полей хранятся, только когда они разные: запись, где всё менялось разом, остаётся как у прошлых версий PlayOS */
function setFieldAt(g: Game, at: Record<string, number>) {
  g.updatedAt = Math.max(changedAt(g), ...LWW.map((f) => at[f] ?? 0))
  if (LWW.every((f) => at[f] === g.updatedAt)) delete g.fieldAt
  else g.fieldAt = Object.fromEntries(LWW.map((f) => [f, at[f]]))
}

/**
 * Слияние локальной библиотеки с облачной. Меняет локальные игры на месте и возвращает игры,
 * которым нужен арт (новые с другого ПК или с новыми ссылками). Чистая логика без сети.
 */
export function mergeLibrary(games: Game[], deletedLocal: { key: string; at: number }[], remote: CloudLibrary | null, prev: CloudLibrary | null = null) {
  // prev — библиотека на момент прошлой синхронизации: по ней видно, какие поля с тех пор поменяли на этом ПК
  const prevByKey = new Map((prev?.games ?? []).map((g) => [g.key, g]))
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
    const fields = g as unknown as Record<string, unknown>
    // Время каждого поля на этом ПК: изменилось с прошлой синхронизации — время правки игры, нет — прежнее
    const at: Record<string, number> = {}
    const p = prevByKey.get(key)
    for (const f of LWW) {
      const was = g.fieldAt?.[f] ?? p?.fieldAt?.[f] ?? p?.updatedAt
      at[f] = was === undefined ? changedAt(g) : json(g[f]) !== json(p?.[f]) ? Math.max(changedAt(g), was + 1) : was
    }
    const localNewer = changedAt(g) >= (r?.updatedAt ?? 0)
    if (!r) {
      setFieldAt(g, at)
      cloud.push(toCloud(g, key))
      continue
    }
    // Каждое поле — от того, кто менял его позже; в то же мгновение — одно и то же значение на обоих ПК
    for (const f of LWW) {
      const theirs = r.fieldAt?.[f] ?? r.updatedAt
      if (theirs > at[f] || (theirs === at[f] && json(r[f]) > json(g[f]))) fields[f] = r[f]
      at[f] = Math.max(at[f], theirs)
    }
    g.updatedAt = Math.max(changedAt(g), r.updatedAt)
    setFieldAt(g, at)
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
      g.sessions = [...starts.values()].sort((a, b) => a.start - b.start).slice(-MAX_SESSIONS)
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
    if (r.fieldAt) g.fieldAt = { ...r.fieldAt }
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

/**
 * Профиль: свежие настройки побеждают целиком, трофеи PlayOS объединяются.
 * Настройки этого ПК не берутся из облака, даже если они там есть: их мог записать PlayOS старой версии,
 * в которой ключа ещё не было в DEVICE_KEYS
 */
export function mergeProfile(settings: Settings, settingsAt: number, remote: CloudProfile | null) {
  const trophies = { ...settings.trophies }
  for (const [id, at] of Object.entries(remote?.trophies ?? {})) trophies[id] = trophies[id] ? Math.min(trophies[id], at) : at
  const remoteWins = !!remote && remote.updatedAt > settingsAt
  const remoteSettings = portableOf(remote?.settings ?? {})
  return {
    remoteWins,
    patch: { ...(remoteWins ? remoteSettings : {}), trophies } as Partial<Settings>,
    cloud: {
      version: 1,
      updatedAt: remoteWins ? remote!.updatedAt : settingsAt,
      device: remoteWins ? remote!.device : '',
      settings: remoteWins ? remoteSettings : portableOf(settings),
      trophies,
      avatar: remoteWins ? remote!.avatar : (artSig(settings.avatar) ?? undefined)
    } as CloudProfile
  }
}

// ── Сеть ──

/** clean — проверка содержимого: файл в облаке мог записать не PlayOS */
async function readJson<T>(r: Remote, dir: string, name: string, seen: number | undefined, clean: (raw: unknown) => T): Promise<{ data: T | null; modified?: number; unchanged: boolean }> {
  const entry = (await r.list(dir)).find((e) => e.name === name)
  if (!entry) return { data: null, unchanged: false }
  if (seen && entry.modified === seen) return { data: null, modified: entry.modified, unchanged: true }
  return { data: clean(JSON.parse((await r.read(`${dir}/${name}`)).toString('utf8'))), modified: entry.modified, unchanged: false }
}

/** Есть ли в облаке профиль — для предложения восстановить его */
export async function cloudOffer(r: Remote): Promise<CloudRestoreOffer | null> {
  const prof = await readJson(r, 'profile', 'profile.json', undefined, cleanProfile)
  const lib = await readJson(r, 'library', 'library.json', undefined, cleanLibrary)
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

/** Копия library.json перед тем, как слияние с облаком уберёт игры: backups/library/, последние 5 */
function backupLibrary() {
  try {
    const dir = path.join(dataDir(), 'backups', 'library')
    fs.mkdirSync(dir, { recursive: true })
    fs.copyFileSync(path.join(dataDir(), 'library.json'), path.join(dir, `before-cloud-${Date.now()}.json`))
    for (const f of fs.readdirSync(dir).sort().slice(0, -5)) fs.rmSync(path.join(dir, f), { force: true })
  } catch (e) {
    log('WARN', 'Облако: копия библиотеки не сохранилась', (e as Error).message)
  }
}

/** Столько удалений за одно слияние — уже не «удалил пару игр на другом ПК»: без подтверждения не применяем */
const massDelete = (removed: number, total: number) => removed >= 5 && removed > total * 0.3

/** confirmDeletes — пользователь сам нажал «Синхронизировать»: массовое удаление из облака применяется */
export async function syncLibrary(r: Remote, seen: Seen, hooks: Hooks, confirmDeletes = false) {
  const db = getDb()
  const remote = await readJson(r, 'library', 'library.json', seen.library, cleanLibrary)
  // Облако не менялось с прошлого раза — сравниваем только со своим прошлым снимком
  const base: CloudLibrary | null = remote.unchanged ? (seen.libraryJson ? (JSON.parse(seen.libraryJson) as CloudLibrary) : null) : remote.data
  const before = db.games.length
  const m = mergeLibrary(db.games, db.deleted ?? [], base, seen.libraryJson ? (JSON.parse(seen.libraryJson) as CloudLibrary) : null)
  if (!confirmDeletes && massDelete(m.removed.length, before)) {
    throw new Error(t('В облаке отмечено удаление {n} игр из {total}. Если вы удалили их на другом ПК, нажмите «Синхронизировать» — иначе библиотека на этом ПК останется как есть.', { n: m.removed.length, total: before }))
  }
  if (m.removed.length) backupLibrary()
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

/** Прошлые аватары из облака: каждый новый — новый файл, старые больше не нужны */
function dropOldAvatars(keep: string) {
  try {
    for (const name of fs.readdirSync(dataDir())) {
      const file = path.join(dataDir(), name)
      if (name.startsWith('avatar-cloud-') && file !== keep) fs.rmSync(file, { force: true })
    }
  } catch {
    // Не мешает синхронизации
  }
}

export async function syncProfile(r: Remote, seen: Seen, hooks: Hooks) {
  const db = getDb()
  const remote = await readJson(r, 'profile', 'profile.json', seen.profile, cleanProfile)
  const base = remote.unchanged ? (seen.profileJson ? (JSON.parse(seen.profileJson) as CloudProfile) : null) : remote.data
  const m = mergeProfile(db.settings, db.settingsAt ?? 0, base)
  if (m.remoteWins) {
    db.settingsAt = m.cloud.updatedAt
    if (m.cloud.avatar && m.cloud.avatar !== artSig(db.settings.avatar)) {
      try {
        // Подпись проверена (AVATAR_SIG): в имени файла только буквы, цифры и точка — путь из папки данных не выйдет
        const data = await r.read(`profile/avatar${path.extname(m.cloud.avatar)}`, MAX_ART)
        // Это та самая картинка, а не подменённый файл: хэш содержимого совпадает с подписью в профиле
        if (createHash('sha1').update(data).digest('hex').slice(0, 16) === m.cloud.avatar.slice(0, 16)) {
          // Имя с подписью: новый аватар — новый файл, без старой картинки из кэша
          const file = path.join(dataDir(), `avatar-cloud-${m.cloud.avatar}`)
          fs.writeFileSync(file, data)
          m.patch.avatar = file
          dropOldAvatars(file)
        }
      } catch (e) {
        if (e instanceof OfflineError) throw e
      }
    }
  }
  hooks.applySettings(m.patch)
  if (!m.remoteWins) {
    if (!m.cloud.updatedAt) m.cloud.updatedAt = db.settingsAt = Date.now()
    m.cloud.device = hooks.deviceName
    if (m.cloud.avatar && m.cloud.avatar !== base?.avatar && db.settings.avatar && fs.existsSync(db.settings.avatar)) {
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
