import { app } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Achievement, AchievementResult, AchievementSet, AchievementSummaryItem, Game, RaGame, Settings, TrophyAccounts, TrophyTier } from '@shared/types'
import { httpFetch } from './http'
import { artDir, findGame, getDb, saveDb } from './store'
import { steamRoot } from './steam'
import { detectAppId, pcGameDirs } from './cloud/locate'
import { t } from '@shared/i18n'

/**
 * Настоящие трофеи игр: RetroAchievements (PS2 через PCSX2) и достижения Steam (PC).
 * У пиратских и DRM-free сборок открытые достижения читаются из файлов эмулятора Steam, названия и значки — из Steam.
 * Результаты кешируются в achievements.json — список открывается мгновенно и работает без сети.
 */

const UA = { 'User-Agent': 'PlayOS/0.7 (local game launcher)' }
const CACHE_TTL = 10 * 60_000

// ───────────────────────── Кеш ─────────────────────────

const cacheFile = () => path.join(app.getPath('userData'), 'achievements.json')
let cache: Record<string, AchievementSet> | null = null
let saveTimer: NodeJS.Timeout | null = null

function store() {
  if (!cache) {
    try {
      cache = JSON.parse(fs.readFileSync(cacheFile(), 'utf8')) as Record<string, AchievementSet>
    } catch {
      cache = {}
    }
  }
  return cache
}

function persist() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const tmp = cacheFile() + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(cache))
    fs.renameSync(tmp, cacheFile())
  }, 300)
}

export function summary(): Record<string, AchievementSummaryItem> {
  const out: Record<string, AchievementSummaryItem> = {}
  for (const [id, set] of Object.entries(store())) out[id] = { source: set.source, earned: set.earned, total: set.total }
  return out
}

export function forget(gameId: string) {
  delete store()[gameId]
  persist()
}

/** Редкость → уровень трофея, как на PlayStation: чем меньше игроков получили, тем ценнее */
function tierOf(rarity?: number, points?: number): TrophyTier {
  if (rarity !== undefined) return rarity < 10 ? 'gold' : rarity < 30 ? 'silver' : 'bronze'
  if (points !== undefined) return points >= 25 ? 'gold' : points >= 10 ? 'silver' : 'bronze'
  return 'bronze'
}

function finalize(source: AchievementSet['source'], items: Achievement[], extra: Partial<AchievementSet>): AchievementSet {
  const earned = items.filter((i) => i.earnedAt).length
  return { source, items, total: items.length, earned, fetchedAt: Date.now(), ...extra }
}

// ───────────────────────── RetroAchievements ─────────────────────────

const RA = 'https://retroachievements.org'
const RA_MEDIA = 'https://media.retroachievements.org'

async function raApi<T>(endpoint: string, params: Record<string, string | number>, s: Settings): Promise<T> {
  const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), y: s.raKey.trim() })
  const r = await httpFetch(`${RA}/API/${endpoint}.php?${q}`, { headers: UA, signal: AbortSignal.timeout(15000) })
  if (r.status === 401 || r.status === 403) throw new Error(t('RetroAchievements не принял ключ API. Проверьте логин и ключ в настройках.'))
  if (!r.ok) throw new Error(t('RetroAchievements ответил ошибкой {status}', { status: r.status }))
  return (await r.json()) as T
}

/**
 * Хеш образа PS2 по правилам RetroAchievements: md5(имя загрузочного файла из SYSTEM.CNF + его содержимое).
 * По нему RA узнаёт конкретный дамп диска. Работает для .iso и «сырых» .bin.
 */
export function ps2RaHash(file: string): string | null {
  if (!/\.(iso|bin|img)$/i.test(file)) return null
  let fd: number | undefined
  try {
    fd = fs.openSync(file, 'r')
    const read = (pos: number, len: number) => {
      const b = Buffer.alloc(len)
      fs.readSync(fd!, b, 0, len, pos)
      return b
    }
    const layout = [
      { size: 2048, offset: 0 },
      { size: 2352, offset: 24 },
      { size: 2352, offset: 16 }
    ].find((l) => read(16 * l.size + l.offset + 1, 5).toString('ascii') === 'CD001')
    if (!layout) return null
    const sector = (lba: number, count: number) => {
      const out = Buffer.alloc(count * 2048)
      for (let i = 0; i < count; i++) read((lba + i) * layout.size + layout.offset, 2048).copy(out, i * 2048)
      return out
    }
    const pvd = sector(16, 1)
    const root = sector(pvd.readUInt32LE(158), Math.min(32, Math.ceil(pvd.readUInt32LE(166) / 2048)))
    const entries = new Map<string, { lba: number; size: number }>()
    for (let pos = 0; pos < root.length; ) {
      const len = root[pos]
      if (!len) {
        pos = (Math.floor(pos / 2048) + 1) * 2048
        continue
      }
      const name = root.toString('ascii', pos + 33, pos + 33 + root[pos + 32]).replace(/;1$/, '').toUpperCase()
      entries.set(name, { lba: root.readUInt32LE(pos + 2), size: root.readUInt32LE(pos + 10) })
      pos += len
    }
    const cnf = entries.get('SYSTEM.CNF')
    if (!cnf) return null
    const text = sector(cnf.lba, Math.ceil(cnf.size / 2048)).toString('ascii', 0, cnf.size)
    const exe = text.match(/BOOT2\s*=\s*(?:cdrom0:)?\\*([^\s;]+)/i)?.[1]
    const ent = exe ? entries.get(exe.toUpperCase()) : undefined
    if (!exe || !ent) return null
    const md5 = crypto.createHash('md5').update(exe)
    md5.update(sector(ent.lba, Math.ceil(ent.size / 2048)).subarray(0, ent.size))
    return md5.digest('hex')
  } catch {
    return null
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

async function raIdByHash(hash: string): Promise<number> {
  const r = await httpFetch(`${RA}/dorequest.php?r=gameid&m=${hash}`, { headers: UA, signal: AbortSignal.timeout(10000) })
  const j = (await r.json()) as { GameID?: number }
  return j.GameID ?? 0
}

let raList: RaGame[] | null = null
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, ' ')
    .trim()

/** Поиск игры PS2 в RetroAchievements по названию (когда образ не опознан по хешу) */
export async function findRaGames(query: string): Promise<RaGame[]> {
  const s = getDb().settings
  if (!s.raKey.trim()) throw new Error(t('Добавьте логин и ключ RetroAchievements в настройках (раздел «Трофеи»)'))
  if (!raList) {
    type Row = { ID: number; Title: string; ImageIcon?: string; NumAchievements?: number }
    const rows = await raApi<Row[]>('API_GetGameList', { i: 21, f: 1 }, s)
    raList = rows.map((r) => ({ id: r.ID, title: r.Title, icon: r.ImageIcon ? RA_MEDIA + r.ImageIcon : undefined, achievements: r.NumAchievements ?? 0 }))
  }
  const words = norm(query).split(' ').filter(Boolean)
  return raList
    .map((g) => {
      const t = norm(g.title)
      const hits = words.filter((w) => t.includes(w)).length
      return { g, score: hits / Math.max(1, words.length) + (t === norm(query) ? 1 : 0) }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.g.title.length - b.g.title.length)
    .slice(0, 20)
    .map((x) => x.g)
}

async function fetchRa(raId: number, s: Settings): Promise<AchievementSet> {
  type Ach = {
    ID: number
    Title: string
    Description: string
    Points: number
    BadgeName: string
    DisplayOrder: number
    NumAwarded?: number
    DateEarned?: string
    DateEarnedHardcore?: string
  }
  type Info = { Title: string; ImageIcon?: string; NumDistinctPlayers?: number; NumDistinctPlayersCasual?: number; Achievements?: Record<string, Ach> }
  const j = await raApi<Info>('API_GetGameInfoAndUserProgress', { g: raId, u: s.raUser.trim() }, s)
  const players = j.NumDistinctPlayers || j.NumDistinctPlayersCasual || 0
  const date = (v?: string) => (v ? Date.parse(v.replace(' ', 'T') + 'Z') || undefined : undefined)
  const items = Object.values(j.Achievements ?? {})
    .sort((a, b) => a.DisplayOrder - b.DisplayOrder || a.ID - b.ID)
    .map((a): Achievement => {
      const rarity = players && a.NumAwarded !== undefined ? (a.NumAwarded / players) * 100 : undefined
      return {
        id: String(a.ID),
        title: a.Title,
        description: a.Description,
        points: a.Points,
        icon: `${RA_MEDIA}/Badge/${a.BadgeName}.png`,
        iconLocked: `${RA_MEDIA}/Badge/${a.BadgeName}_lock.png`,
        earnedAt: date(a.DateEarnedHardcore) ?? date(a.DateEarned),
        rarity,
        tier: tierOf(rarity, a.Points)
      }
    })
  return finalize('ra', items, { gameTitle: j.Title, url: `${RA}/game/${raId}` })
}

// ───────────────────────── Steam ─────────────────────────

const STEAM = 'https://api.steampowered.com'
let resolvedId: { input: string; id: string } | null = null

async function steamId64(s: Settings): Promise<string> {
  const input = s.steamId.trim()
  const direct = input.match(/(7656\d{13})/)?.[1]
  if (direct) return direct
  if (resolvedId?.input === input) return resolvedId.id
  const vanity = input.match(/steamcommunity\.com\/id\/([^/]+)/)?.[1] ?? input
  const r = await httpFetch(`${STEAM}/ISteamUser/ResolveVanityURL/v1/?key=${s.steamKey.trim()}&vanityurl=${encodeURIComponent(vanity)}`, {
    signal: AbortSignal.timeout(10000)
  }).then((x) => x.json() as Promise<{ response?: { success: number; steamid?: string } }>)
  if (r.response?.success !== 1 || !r.response.steamid) throw new Error(t('Не удалось найти профиль Steam. Укажите SteamID64 или ссылку на профиль.'))
  resolvedId = { input, id: r.response.steamid }
  return r.response.steamid
}

/** Steam AppID игры по файлам рядом с EXE: steam_appid.txt или манифест библиотеки Steam */
export function detectSteamAppId(game: Game): number | undefined {
  if (game.platform !== 'pc') return undefined
  // steam_emu.ini, cream_api.ini, steam_settings — рядом с EXE и в папке игры
  for (const d of [path.dirname(game.path), game.installDir]) {
    const id = d ? detectAppId(d) : undefined
    if (id) return id
  }
  let dir = path.dirname(game.path)
  for (let i = 0; i < 4 && dir !== path.dirname(dir); i++) {
    try {
      const id = Number(fs.readFileSync(path.join(dir, 'steam_appid.txt'), 'utf8').trim())
      if (id > 0) return id
    } catch {
      /* нет файла */
    }
    dir = path.dirname(dir)
  }
  const m = game.path.match(/^(.*\\steamapps)\\common\\([^\\]+)/i)
  if (m) {
    try {
      for (const f of fs.readdirSync(m[1])) {
        if (!/^appmanifest_\d+\.acf$/i.test(f)) continue
        const text = fs.readFileSync(path.join(m[1], f), 'utf8')
        if (text.match(/"installdir"\s+"([^"]+)"/i)?.[1]?.toLowerCase() === m[2].toLowerCase()) {
          return Number(text.match(/"appid"\s+"(\d+)"/i)?.[1]) || undefined
        }
      }
    } catch {
      /* библиотека недоступна */
    }
  }
  return undefined
}

type SteamSchemaItem = { name: string; displayName: string; description?: string; icon: string; icongray: string; hidden: number }
type SteamSchema = { game?: { gameName?: string; availableGameStats?: { achievements?: SteamSchemaItem[] } } }

// ───────────────────────── Файлы эмуляторов Steam ─────────────────────────

/** Где эмуляторы Steam хранят открытые достижения; {id} — AppID, {game} — папка игры */
const EMU_FILES: { name: string; file: string }[] = [
  { name: 'RUNE', file: '%PUBLIC%/Documents/Steam/RUNE/{id}/achievements.ini' },
  { name: 'CODEX', file: '%PUBLIC%/Documents/Steam/CODEX/{id}/achievements.ini' },
  { name: 'CODEX', file: '%APPDATA%/Steam/CODEX/{id}/achievements.ini' },
  { name: 'EMPRESS', file: '%APPDATA%/EMPRESS/{id}/remote/{id}/achievements.json' },
  { name: 'EMPRESS', file: '%PUBLIC%/Documents/EMPRESS/{id}/remote/{id}/achievements.json' },
  { name: 'OnlineFix', file: '%PUBLIC%/Documents/OnlineFix/{id}/Stats/Achievements.ini' },
  { name: 'Goldberg', file: '%APPDATA%/GSE Saves/{id}/achievements.json' },
  { name: 'Goldberg', file: '%APPDATA%/Goldberg SteamEmu Saves/{id}/achievements.json' },
  { name: 'Goldberg', file: '{game}/steam_settings/saves/{id}/achievements.json' },
  { name: 'RLD!', file: '%PROGRAMDATA%/RLD!/{id}/achievements.ini' },
  { name: 'RLD!', file: '%PROGRAMDATA%/Steam/RLD!/{id}/achievements.ini' }
]

const ENV: Record<string, string | undefined> = {
  '%APPDATA%': process.env.APPDATA,
  '%PUBLIC%': process.env.PUBLIC,
  '%PROGRAMDATA%': process.env.PROGRAMDATA
}

/** Время из файла: секунды Unix, иначе неизвестно */
const unixMs = (v: unknown) => {
  const n = Number(v)
  return n > 1e9 ? n * 1000 : undefined
}
const truthy = (v: unknown) => v === true || v === 1 || /^(1|true|yes)$/i.test(String(v ?? '').trim())

/**
 * Открытые достижения из файла эмулятора: apiname → время получения (0 — время неизвестно).
 * INI (CODEX, RUNE, OnlineFix, RLD!): секция на достижение с Achieved и UnlockTime/timestamp
 * или одна секция со строками ИМЯ=1. JSON (Goldberg, EMPRESS): { ИМЯ: { earned, earned_time } }.
 */
export function parseEmuAchievements(text: string, json: boolean): Map<string, number> {
  const out = new Map<string, number>()
  if (json) {
    const data = JSON.parse(text) as unknown
    const entries: [string, unknown][] = Array.isArray(data)
      ? data.map((a: Record<string, unknown>) => [String(a?.name ?? a?.apiname ?? ''), a])
      : Object.entries((data ?? {}) as Record<string, unknown>)
    for (const [name, raw] of entries) {
      if (!name || !raw || typeof raw !== 'object') continue
      const a = raw as Record<string, unknown>
      if (truthy(a.earned ?? a.achieved ?? a.unlocked)) out.set(name, unixMs(a.earned_time ?? a.unlock_time ?? a.time) ?? 0)
    }
    return out
  }
  const sections = new Map<string, Map<string, string>>()
  let cur = new Map<string, string>()
  sections.set('', cur)
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith(';') || line.startsWith('#')) continue
    const sec = /^\[(.+)\]$/.exec(line)
    if (sec) {
      sections.set(sec[1], (cur = new Map()))
      continue
    }
    const eq = line.indexOf('=')
    if (eq > 0) cur.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim())
  }
  for (const [name, kv] of sections) {
    if (!name || /^steamachievements$/i.test(name)) continue
    const get = (...keys: string[]) => {
      for (const [k, v] of kv) if (keys.includes(k.toLowerCase())) return v
      return undefined
    }
    const state = get('achieved', 'unlocked', 'state')
    if (state !== undefined) {
      if (truthy(state)) out.set(name, unixMs(get('unlocktime', 'timestamp', 'time')) ?? 0)
      continue
    }
    // Плоский список: [Achievements] ИМЯ=1
    for (const [k, v] of kv) if (truthy(v)) out.set(k, 0)
  }
  return out
}

/** Все места, где эмуляторы Steam хранят достижения этой игры (файлов может и не быть) */
function emuCandidates(appid: number, game: Game): { name: string; file: string }[] {
  // steam_settings бывает и в папке игры, и рядом с EXE (bin/x64) — смотрим обе
  const gameDirs = pcGameDirs(game)
  const out: { name: string; file: string }[] = []
  for (const e of EMU_FILES) {
    const file = e.file.replaceAll('{id}', String(appid))
    if (file.startsWith('{game}')) {
      for (const d of gameDirs) out.push({ name: e.name, file: path.join(d, file.slice(7)) })
      continue
    }
    const token = file.slice(0, file.indexOf('%', 1) + 1)
    const root = ENV[token]
    if (root) out.push({ name: e.name, file: path.join(root, file.slice(token.length)) })
  }
  return out
}

/** Файл эмулятора с достижениями этой игры, если он есть на ПК */
function findEmuFile(appid: number, game: Game): { name: string; file: string } | null {
  return emuCandidates(appid, game).find((e) => fs.existsSync(e.file)) ?? null
}

// Схема и редкость нужны и уведомлениям во время игры (проверка раз в минуту) — держим их в памяти
const schemaCache = new Map<number, { at: number; schema: SteamSchema; pct: Map<string, number> }>()

async function steamSchema(appid: number, s: Settings) {
  const hit = schemaCache.get(appid)
  if (hit && Date.now() - hit.at < 6 * 60 * 60_000) return hit
  const get = <T,>(url: string) => httpFetch(url, { signal: AbortSignal.timeout(15000) }).then((r) => r.json() as Promise<T>)
  type Global = { achievementpercentages?: { achievements?: { name: string; percent: string | number }[] } }
  const key = s.steamKey.trim()
  const [schema, global] = await Promise.all([
    key ? get<SteamSchema>(`${STEAM}/ISteamUserStats/GetSchemaForGame/v2/?key=${key}&appid=${appid}&l=russian`).catch(() => ({}) as SteamSchema) : ({} as SteamSchema),
    get<Global>(`${STEAM}/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${appid}`).catch(() => ({}) as Global)
  ])
  const entry = { at: Date.now(), schema, pct: new Map((global.achievementpercentages?.achievements ?? []).map((a) => [a.name, Number(a.percent)])) }
  if (schema.game?.availableGameStats?.achievements?.length) schemaCache.set(appid, entry)
  return entry
}

async function fetchLocal(appid: number, emu: { name: string; file: string }, s: Settings, before?: AchievementSet): Promise<AchievementSet> {
  const unlocked = parseEmuAchievements(fs.readFileSync(emu.file, 'utf8').replace(/^\uFEFF/, ''), emu.file.endsWith('.json'))
  const { schema, pct } = await steamSchema(appid, s)
  const list = schema.game?.availableGameStats?.achievements
  // Без ключа Steam Web API схемы нет: показываем внутренние имена достижений
  const source: SteamSchemaItem[] = list?.length
    ? list
    : [...new Set([...pct.keys(), ...unlocked.keys()])].map((name) => ({ name, displayName: name, icon: '', icongray: '', hidden: 0 }))
  const byLower = new Map([...unlocked].map(([k, v]) => [k.toLowerCase(), v]))
  const prev = new Map((before?.items ?? []).map((i) => [i.id, i.earnedAt]))
  const items = source.map((a): Achievement => {
    const at = unlocked.get(a.name) ?? byLower.get(a.name.toLowerCase())
    const rarity = pct.get(a.name)
    return {
      id: a.name,
      title: a.displayName,
      description: a.description ?? '',
      icon: a.icon || undefined,
      iconLocked: a.icongray || undefined,
      hidden: a.hidden === 1,
      // Время в файле не записано — берём момент, когда PlayOS впервые увидел достижение
      earnedAt: at === undefined ? undefined : at || prev.get(a.name) || Date.now(),
      rarity,
      tier: tierOf(rarity)
    }
  })
  if (!items.length) throw new Error(t('У этой игры нет достижений Steam.'))
  return finalize('local', items, { emulator: emu.name, gameTitle: schema.game?.gameName, url: `https://steamcommunity.com/stats/${appid}/achievements` })
}

/** Профиль открыт, но игры на аккаунте Steam нет */
class NotOwnedError extends Error {
  constructor() {
    super(t('Этой игры нет в вашей библиотеке Steam. Достижения Steam показываются только для игр на аккаунте.'))
  }
}

/** Загрузчик Ubisoft Connect рядом с игрой: у такой сборки достижения в Ubisoft Connect, а не в Steam */
function hasUbisoftLoader(game: Game) {
  const names = ['uplay_r1_loader64.dll', 'uplay_r1_loader.dll', 'upc_r1_loader64.dll', 'upc_r2_loader64.dll', 'uplay_r2_loader64.dll']
  return [path.dirname(game.path), game.installDir].some((d) => d && names.some((n) => fs.existsSync(path.join(d, n))))
}

async function fetchSteam(appid: number, s: Settings): Promise<AchievementSet> {
  const key = s.steamKey.trim()
  const sid = await steamId64(s)
  type Schema = { game?: { gameName?: string; availableGameStats?: { achievements?: { name: string; displayName: string; description?: string; icon: string; icongray: string; hidden: number }[] } } }
  type Player = { playerstats?: { success: boolean; error?: string; gameName?: string; achievements?: { apiname: string; achieved: number; unlocktime: number }[] } }
  type Global = { achievementpercentages?: { achievements?: { name: string; percent: string | number }[] } }
  const get = <T,>(url: string) => httpFetch(url, { signal: AbortSignal.timeout(15000) }).then((r) => r.json() as Promise<T>)
  const [schema, player, global] = await Promise.all([
    get<Schema>(`${STEAM}/ISteamUserStats/GetSchemaForGame/v2/?key=${key}&appid=${appid}&l=russian`),
    get<Player>(`${STEAM}/ISteamUserStats/GetPlayerAchievements/v1/?key=${key}&steamid=${sid}&appid=${appid}&l=russian`),
    get<Global>(`${STEAM}/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${appid}`).catch(() => ({}) as Global)
  ])
  const stats = player.playerstats
  if (!stats?.success) {
    const err = stats?.error ?? ''
    if (/not public/i.test(err)) {
      // Steam отвечает «not public» и тогда, когда игры просто нет в библиотеке аккаунта — проверяем сам профиль
      type Summary = { response?: { players?: { communityvisibilitystate?: number }[] } }
      const summary = await get<Summary>(`${STEAM}/ISteamUser/GetPlayerSummaries/v2/?key=${key}&steamids=${sid}`).catch(() => null)
      if (summary?.response?.players?.[0]?.communityvisibilitystate === 3) throw new NotOwnedError()
      throw new Error(t('Профиль Steam скрыт. Откройте «Сведения об играх» в настройках приватности Steam.'))
    }
    if (/no stats/i.test(err)) throw new Error(t('У этой игры нет достижений Steam.'))
    throw new Error(err || t('Steam не отдал достижения'))
  }
  const unlocked = new Map((stats.achievements ?? []).map((a) => [a.apiname, a]))
  const pct = new Map((global.achievementpercentages?.achievements ?? []).map((a) => [a.name, Number(a.percent)]))
  const items = (schema.game?.availableGameStats?.achievements ?? []).map((a): Achievement => {
    const u = unlocked.get(a.name)
    const rarity = pct.get(a.name)
    return {
      id: a.name,
      title: a.displayName,
      description: a.description ?? '',
      icon: a.icon,
      iconLocked: a.icongray,
      hidden: a.hidden === 1,
      earnedAt: u?.achieved ? u.unlocktime * 1000 : undefined,
      rarity,
      tier: tierOf(rarity)
    }
  })
  if (!items.length) throw new Error(t('У этой игры нет достижений Steam.'))
  return finalize('steam', items, { gameTitle: stats.gameName ?? schema.game?.gameName, url: `https://steamcommunity.com/stats/${appid}/achievements` })
}

// ───────────────────────── Общий вход ─────────────────────────

export async function getAchievements(gameId: string, refresh = false): Promise<AchievementResult> {
  return withShots(gameId, await loadAchievements(gameId, refresh))
}

async function loadAchievements(gameId: string, refresh: boolean): Promise<AchievementResult> {
  const game = findGame(gameId)
  if (!game) return { error: t('Игра не найдена') }
  const s = getDb().settings
  const cached = store()[gameId]
  if (cached && !refresh && Date.now() - cached.fetchedAt < CACHE_TTL) return { set: cached }

  try {
    let set: AchievementSet
    if (game.platform === 'ps2') {
      if (!s.raUser.trim() || !s.raKey.trim()) return { set: cached, needs: 'ra-account', error: t('Добавьте логин и ключ RetroAchievements в настройках') }
      if (!game.raGameId) {
        const hash = ps2RaHash(game.path)
        const id = hash ? await raIdByHash(hash) : 0
        if (!id) {
          return {
            needs: 'link',
            error: hash
              ? t('Этот образ не опознан RetroAchievements (возможно, это модифицированная сборка). Выберите игру вручную.')
              : t('Не получилось прочитать образ. Выберите игру в RetroAchievements вручную.')
          }
        }
        game.raGameId = id
        saveDb()
      }
      set = await fetchRa(game.raGameId, s)
    } else if (game.platform === 'pc') {
      if (!game.steamAppId) {
        const id = detectSteamAppId(game)
        if (!id) return { needs: 'link', error: t('Не удалось определить Steam AppID. Укажите его в редакторе игры или выберите арт из Steam.') }
        game.steamAppId = id
        saveDb()
      }
      // Игра не из клиента Steam и рядом есть файл эмулятора — достижения из него, аккаунт Steam не нужен
      const emu = game.launcher === 'steam' ? null : findEmuFile(game.steamAppId, game)
      if (emu) set = await fetchLocal(game.steamAppId, emu, s, cached?.source === 'local' ? cached : undefined)
      else {
        if (!s.steamKey.trim() || !s.steamId.trim()) return { set: cached, needs: 'steam-account', error: t('Добавьте ключ Steam Web API и профиль Steam в настройках') }
        try {
          set = await fetchSteam(game.steamAppId, s)
        } catch (e) {
          if (!(e instanceof NotOwnedError) || game.launcher === 'steam') throw e
          // Игры нет на аккаунте и файла эмулятора Steam не нашлось — объясняем, почему достижений нет
          throw new Error(
            hasUbisoftLoader(game)
              ? t('Игры нет в вашей библиотеке Steam, а сборка работает через эмулятор Ubisoft Connect: он не записывает достижения, поэтому показать их не из чего.')
              : t('Игры нет в вашей библиотеке Steam, а файлов эмулятора Steam с достижениями рядом не нашлось. Обычно они появляются после первого полученного достижения.')
          )
        }
      }
    } else {
      return { needs: 'unsupported', error: t('Для игр PS3 трофеи пока недоступны: RetroAchievements не поддерживает PS3.') }
    }
    store()[gameId] = set
    persist()
    return { set }
  } catch (e) {
    return { set: cached, error: (e as Error).message }
  }
}

export async function linkRaGame(gameId: string, raId: number) {
  const game = findGame(gameId)
  if (!game) return { error: t('Игра не найдена') }
  game.raGameId = raId
  saveDb()
  return getAchievements(gameId, true)
}

// ───────────────────────── Мгновенные трофеи и снимки ─────────────────────────

/** У игры есть файл эмулятора Steam: трофеи читаются локально, ключ Steam не нужен */
export const hasLocalTrophies = (game: Game) => game.platform === 'pc' && game.launcher !== 'steam' && !!game.steamAppId && !!findEmuFile(game.steamAppId, game)

/**
 * Следим за файлами, которые меняются в момент получения достижения: файл эмулятора Steam у сборок не из Steam
 * или статистика клиента Steam (appcache/stats/UserGameStats_<аккаунт>_<appid>.bin). У RetroAchievements
 * локального файла нет — PS2 по-прежнему проверяется раз в минуту.
 */
export async function watchTrophies(gameId: string, onChange: () => void): Promise<() => void> {
  const game = findGame(gameId)
  const appid = game?.platform === 'pc' ? game.steamAppId || detectSteamAppId(game) : undefined
  if (!game || !appid) return () => {}
  const stops: (() => void)[] = []
  if (game.launcher === 'steam') {
    const root = await steamRoot()
    const dir = root ? path.join(root, 'appcache', 'stats') : ''
    const name = new RegExp(`^UserGameStats_\\d+_${appid}\\.bin$`, 'i')
    if (dir && fs.existsSync(dir)) {
      try {
        const w = fs.watch(dir, { persistent: false }, (_e, f) => f && name.test(String(f)) && onChange())
        w.on('error', () => w.close())
        stops.push(() => w.close())
      } catch {
        /* папку не дали отслеживать — останется проверка раз в минуту */
      }
    }
  } else {
    // Файла может ещё не быть (он появляется с первым достижением) — watchFile замечает и его создание
    for (const { file } of emuCandidates(appid, game)) {
      const fn = (cur: fs.Stats, prev: fs.Stats) => {
        if (cur.mtimeMs > 0 && cur.mtimeMs !== prev.mtimeMs) onChange()
      }
      fs.watchFile(file, { interval: 1000, persistent: false }, fn)
      stops.push(() => fs.unwatchFile(file, fn))
    }
  }
  return () => stops.forEach((stop) => stop())
}

const shotDir = (gameId: string) => path.join(artDir(gameId), 'trophies')
const shotFile = (gameId: string, id: string) => path.join(shotDir(gameId), id.replace(/[^\w.-]/g, '_') + '.jpg')

/** Кадр момента получения: один снимок на все трофеи, полученные разом */
export function saveShots(gameId: string, items: Achievement[], jpeg: Buffer) {
  try {
    fs.mkdirSync(shotDir(gameId), { recursive: true })
    for (const a of items) {
      const file = shotFile(gameId, a.id)
      fs.writeFileSync(file, jpeg)
      a.shot = file
    }
  } catch {
    /* диск занят или полон — трофей покажем без снимка */
  }
}

/** Подставляем сохранённые снимки (в кеше их нет: файлы — источник правды) */
function withShots(gameId: string, res: AchievementResult): AchievementResult {
  if (!res.set) return res
  let names: Set<string>
  try {
    names = new Set(fs.readdirSync(shotDir(gameId)))
  } catch {
    return res
  }
  const items = res.set.items.map((a) => {
    const file = shotFile(gameId, a.id)
    return a.earnedAt && names.has(path.basename(file)) ? { ...a, shot: file } : a
  })
  return { ...res, set: { ...res.set, items } }
}

/** Свежие трофеи, полученные с прошлой проверки (для уведомлений во время игры) */
export async function newSince(gameId: string): Promise<Achievement[]> {
  const before = store()[gameId]
  const res = await getAchievements(gameId, true)
  if (!before || !res.set || res.error) return []
  const had = new Set(before.items.filter((i) => i.earnedAt).map((i) => i.id))
  return res.set.items.filter((i) => i.earnedAt && !had.has(i.id))
}

export async function testAccounts(): Promise<TrophyAccounts> {
  const s = getDb().settings
  const out: TrophyAccounts = { ra: { state: 'off', text: t('Не настроено') }, steam: { state: 'off', text: t('Не настроено') } }
  if (s.raUser.trim() && s.raKey.trim()) {
    try {
      const j = await raApi<{ User?: string; TotalPoints?: number }>('API_GetUserProfile', { u: s.raUser.trim() }, s)
      out.ra = j.User
        ? { state: 'ok', text: t('Подключено: {User}, {v} очков', { User: j.User, v: j.TotalPoints ?? 0 }) }
        : { state: 'error', text: t('Пользователь не найден') }
    } catch (e) {
      out.ra = { state: 'error', text: (e as Error).message }
    }
  }
  if (s.steamKey.trim() && s.steamId.trim()) {
    try {
      const sid = await steamId64(s)
      const r = await httpFetch(`${STEAM}/ISteamUser/GetPlayerSummaries/v2/?key=${s.steamKey.trim()}&steamids=${sid}`, {
        signal: AbortSignal.timeout(10000)
      })
      if (r.status === 403 || r.status === 401) throw new Error(t('Steam не принял ключ API'))
      const j = (await r.json()) as { response?: { players?: { personaname: string }[] } }
      const name = j.response?.players?.[0]?.personaname
      out.steam = name ? { state: 'ok', text: t('Подключено: {name}', { name }) } : { state: 'error', text: t('Профиль не найден') }
    } catch (e) {
      out.steam = { state: 'error', text: (e as Error).message }
    }
  }
  return out
}
