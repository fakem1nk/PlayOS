import { app } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Achievement, AchievementResult, AchievementSet, AchievementSummaryItem, Game, RaGame, Settings, TrophyTier } from '@shared/types'
import { httpFetch } from './http'
import { findGame, getDb, saveDb } from './store'
import { t } from '@shared/i18n'

/**
 * Настоящие трофеи игр: RetroAchievements (PS2 через PCSX2) и достижения Steam (PC).
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
    if (/not public/i.test(err)) throw new Error(t('Профиль Steam скрыт. Откройте «Сведения об играх» в настройках приватности Steam.'))
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
      if (!s.steamKey.trim() || !s.steamId.trim()) return { set: cached, needs: 'steam-account', error: t('Добавьте ключ Steam Web API и профиль Steam в настройках') }
      if (!game.steamAppId) {
        const id = detectSteamAppId(game)
        if (!id) return { needs: 'link', error: t('Не удалось определить Steam AppID. Укажите его в редакторе игры или выберите арт из Steam.') }
        game.steamAppId = id
        saveDb()
      }
      set = await fetchSteam(game.steamAppId, s)
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

/** Свежие трофеи, полученные с прошлой проверки (для уведомлений во время игры) */
export async function newSince(gameId: string): Promise<Achievement[]> {
  const before = store()[gameId]
  const res = await getAchievements(gameId, true)
  if (!before || !res.set || res.error) return []
  const had = new Set(before.items.filter((i) => i.earnedAt).map((i) => i.id))
  return res.set.items.filter((i) => i.earnedAt && !had.has(i.id))
}

export async function testAccounts(): Promise<{ ra: string; steam: string }> {
  const s = getDb().settings
  const out = { ra: t('Не настроено'), steam: t('Не настроено') }
  if (s.raUser.trim() && s.raKey.trim()) {
    try {
      const j = await raApi<{ User?: string; TotalPoints?: number }>('API_GetUserProfile', { u: s.raUser.trim() }, s)
      out.ra = j.User ? t('Подключено: {User}, {v} очков', { User: j.User, v: j.TotalPoints ?? 0 }) : t('Пользователь не найден')
    } catch (e) {
      out.ra = (e as Error).message
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
      out.steam = name ? t('Подключено: {name}', { name }) : t('Профиль не найден')
    } catch (e) {
      out.steam = (e as Error).message
    }
  }
  return out
}
