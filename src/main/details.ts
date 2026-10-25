import fs from 'node:fs'
import path from 'node:path'
import type { Game, GameDetails, LiveBackground } from '@shared/types'
import { getLang } from '@shared/i18n'
import { httpFetch } from './http'
import { artDir, dataDir, getDb } from './store'

/**
 * Сведения для страницы игры (описание, разработчик, время прохождения) и живой фон —
 * беззвучный фрагмент трейлера из Steam или анимированный фон из SteamGridDB.
 * Всё кэшируется в details-cache.json, видео — в папке арта игры.
 */

interface CacheEntry {
  details?: GameDetails
  detailsAt?: number
  /** На каком языке собраны сведения — сменили язык PlayOS, собираем заново */
  detailsLang?: string
  /** Найденный по названию AppID в Steam (null — не нашли) */
  appId?: number | null
  live?: { file: string; loopAt?: number } | null
  liveAt?: number
}

const DAY = 86_400_000
const DETAILS_TTL = 14 * DAY
const LIVE_RETRY = 7 * DAY
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'

let cache: Record<string, CacheEntry> | null = null
const cacheFile = () => path.join(dataDir(), 'details-cache.json')

function load() {
  if (cache) return cache
  try {
    cache = JSON.parse(fs.readFileSync(cacheFile(), 'utf8')) as Record<string, CacheEntry>
  } catch {
    cache = {}
  }
  return cache
}

let saveTimer: NodeJS.Timeout | null = null
function save() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    fs.mkdirSync(dataDir(), { recursive: true })
    fs.writeFileSync(cacheFile(), JSON.stringify(cache), 'utf8')
  }, 300)
}

const entry = (gameId: string) => (load()[gameId] ??= {})

/** Забыть всё про игру (её удалили) */
export function forgetDetails(gameId: string) {
  if (load()[gameId]) {
    delete cache![gameId]
    save()
  }
}

// ───────────────────────── Steam ─────────────────────────

interface SteamMovie {
  name?: string
  highlight?: boolean
  dash_h264?: string
}

interface SteamApp {
  name: string
  short_description?: string
  developers?: string[]
  publishers?: string[]
  release_date?: { date?: string }
  genres?: { description: string }[]
  movies?: SteamMovie[]
}

const appCache = new Map<string, Promise<SteamApp | null>>()

/** Карточка игры в магазине Steam. Без cc магазин иногда отвечает success:false — повторяем с регионом US. */
function steamApp(appId: number) {
  // Описание из Steam — на языке интерфейса
  const key = `${appId}:${getLang()}`
  let p = appCache.get(key)
  if (!p) {
    p = (async () => {
      for (const cc of ['', '&cc=us']) {
        try {
          const r = await httpFetch(`https://store.steampowered.com/api/appdetails?appids=${appId}&l=${getLang() === 'en' ? 'english' : 'russian'}${cc}`, {
            signal: AbortSignal.timeout(12000)
          })
          const j = (await r.json()) as Record<string, { success: boolean; data?: SteamApp }>
          const e = j[String(appId)]
          if (e?.success && e.data) return e.data
        } catch {
          /* следующая попытка */
        }
      }
      return null
    })()
    appCache.set(key, p)
    // Неудачу не запоминаем навсегда — вдруг просто не было сети
    void p.then((v) => v ?? appCache.delete(key))
  }
  return p
}

/** Название без регистра, знаков и «™/®» — для сравнения с результатами поиска */
export const normTitle = (s: string) =>
  s
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9а-яё]+/g, '')

/** AppID игры: из карточки, а если его нет — точное совпадение названия в поиске Steam */
async function findAppId(game: Game): Promise<number | null> {
  if (game.steamAppId) return game.steamAppId
  const e = entry(game.id)
  if (e.appId !== undefined) return e.appId
  try {
    const r = await httpFetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(game.title)}&l=english&cc=US`, {
      signal: AbortSignal.timeout(10000)
    })
    const j = (await r.json()) as { items?: { id: number; name: string; type: string }[] }
    const want = normTitle(game.title)
    const hit = (j.items ?? []).find((i) => i.type === 'app' && normTitle(i.name) === want)
    e.appId = hit?.id ?? null
    save()
    return e.appId
  } catch {
    return null
  }
}

const decodeEntities = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim()

// ───────────────────────── Википедия ─────────────────────────

const WIKI_HEADERS = { 'User-Agent': 'PlayOS/0.7 (local game launcher)' }

/** Краткое описание из статьи об игре: сначала Википедия на языке интерфейса, потом другая */
async function wikiSummary(title: string, onlyRussian = false): Promise<string | undefined> {
  const ru = ['ru.wikipedia.org', 'компьютерная игра', /игр/i] as const
  const en = ['en.wikipedia.org', 'video game', /game/i] as const
  const sources = onlyRussian ? [ru] : getLang() === 'en' ? [en, ru] : [ru, en]
  for (const [host, hint, marker] of sources) {
    try {
      const q = new URLSearchParams({ action: 'query', list: 'search', srsearch: `${title} ${hint}`, srlimit: '3', format: 'json', formatversion: '2' })
      const found = (await httpFetch(`https://${host}/w/api.php?${q}`, { headers: WIKI_HEADERS, signal: AbortSignal.timeout(10000) }).then((r) =>
        r.json()
      )) as { query?: { search?: { title: string }[] } }
      for (const hit of found.query?.search ?? []) {
        const sum = (await httpFetch(`https://${host}/api/rest_v1/page/summary/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`, {
          headers: WIKI_HEADERS,
          signal: AbortSignal.timeout(10000)
        }).then((r) => r.json())) as { extract?: string; type?: string }
        // Берём только статью про игру, а не про фильм или серию книг
        // Википедия вырезает из выдержки транскрипции, оставляя «Bully ; также…» — подчищаем
        if (sum.type === 'standard' && sum.extract && marker.test(sum.extract)) return sum.extract.replace(/\s+([;,.])/g, '$1').replace(/\(\s*\)/g, '')
      }
    } catch {
      /* следующая Википедия */
    }
  }
  return undefined
}

// ───────────────────────── HowLongToBeat ─────────────────────────

/** Запрос к HLTB: из main через net (системный прокси); если сеть Electron отказала — обычным fetch */
async function hltbFetch(url: string, init: RequestInit = {}) {
  const headers = { 'User-Agent': UA, Referer: 'https://howlongtobeat.com/', ...(init.headers as Record<string, string>) }
  try {
    const r = await httpFetch(url, { ...init, headers, signal: AbortSignal.timeout(12000) })
    if (r.status !== 403) return r
  } catch {
    /* попробуем напрямую */
  }
  return fetch(url, { ...init, headers, signal: AbortSignal.timeout(12000) })
}

interface HltbGame {
  game_name: string
  game_alias?: string
  comp_main: number
  comp_plus: number
  comp_100: number
}

async function howLongToBeat(title: string): Promise<GameDetails['hltb']> {
  // Поиск HLTB путается в подзаголовках вроде «Remastered» и в знаках препинания
  const clean = title.replace(/[™®©]/g, '').replace(/[:–—-]/g, ' ').replace(/\s+/g, ' ').trim()
  const init = (await hltbFetch(`https://howlongtobeat.com/api/search/site/init?t=${Date.now()}`).then((r) => r.json())) as { token?: string }
  if (!init.token) return null
  const body = {
    searchType: 'games',
    searchTerms: clean.split(' '),
    searchPage: 1,
    size: 10,
    searchOptions: {
      games: {
        userId: 0,
        platform: '',
        sortCategory: 'popular',
        rangeCategory: 'main',
        rangeTime: { min: null, max: null },
        gameplay: { perspective: '', flow: '', genre: '', difficulty: '' },
        rangeYear: { min: '', max: '' },
        modifier: ''
      },
      users: { sortCategory: 'postcount' },
      lists: { sortCategory: 'follows' },
      filter: '',
      sort: 0,
      randomizer: 0
    },
    useCache: true
  }
  const res = (await hltbFetch('https://howlongtobeat.com/api/search/site', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-auth-token': init.token },
    body: JSON.stringify(body)
  }).then((r) => r.json())) as { data?: HltbGame[] }
  const list = res.data ?? []
  if (!list.length) return null
  const want = normTitle(title)
  const best =
    list.find((g) => normTitle(g.game_name) === want || (g.game_alias && normTitle(g.game_alias) === want)) ??
    list.find((g) => want.startsWith(normTitle(g.game_name)) || normTitle(g.game_name).startsWith(want)) ??
    list[0]
  const val = (n: number) => (n > 0 ? n : undefined)
  return { main: val(best.comp_main), plus: val(best.comp_plus), full: val(best.comp_100), title: best.game_name }
}

// ───────────────────────── Сведения для страницы игры ─────────────────────────

const inflight = new Map<string, Promise<GameDetails>>()

export function gameDetails(game: Game, refresh = false): Promise<GameDetails> {
  const e = entry(game.id)
  if (!refresh && e.details && e.detailsAt && (e.detailsLang ?? 'ru') === getLang() && Date.now() - e.detailsAt < DETAILS_TTL) return Promise.resolve(e.details)
  let p = inflight.get(game.id)
  if (p) return p
  p = (async () => {
    const d: GameDetails = {}
    const appId = await findAppId(game)
    const app = appId ? await steamApp(appId) : null
    if (app) {
      if (app.short_description) {
        d.description = decodeEntities(app.short_description)
        d.source = 'steam'
      }
      d.developer = app.developers?.join(', ')
      d.publisher = app.publishers?.join(', ')
      d.released = app.release_date?.date
      d.genres = app.genres?.map((g) => g.description)
    }
    // В Steam у старых игр часто нет русского описания — тогда предпочитаем русскую Википедию
    if (getLang() === 'ru' && d.description && !/[а-яё]/i.test(d.description)) {
      const ru = await wikiSummary(game.title, true)
      if (ru) {
        d.description = ru
        d.source = 'wiki'
      }
    }
    if (!d.description) {
      const wiki = await wikiSummary(game.title)
      if (wiki) {
        d.description = wiki
        d.source = 'wiki'
      }
    }
    d.hltb = await howLongToBeat(game.title).catch(() => null)
    // Ничего не нашли из-за сети — не кэшируем пустоту надолго
    if (d.description || d.hltb) {
      e.details = d
      e.detailsAt = Date.now()
      e.detailsLang = getLang()
      save()
    }
    return d
  })().finally(() => inflight.delete(game.id))
  inflight.set(game.id, p)
  return p
}

// ───────────────────────── Живой фон ─────────────────────────

/** Сколько секунд трейлера сохраняем: начало ролика, без звука, в 720p */
const TRAILER_SECONDS = 45

/** Одна загрузка за раз: перешли к другой игре — прошлая отменяется */
let downloading: { gameId: string; ctrl: AbortController; promise: Promise<LiveBackground | null> } | null = null

async function fetchBuffer(url: string, signal: AbortSignal) {
  const r = await httpFetch(url, { signal })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return Buffer.from(await r.arrayBuffer())
}

/** Начало трейлера из DASH-манифеста Steam: init-сегмент + первые куски видео склеиваются в один fMP4 */
async function steamTrailer(appId: number, file: string, signal: AbortSignal): Promise<{ loopAt?: number } | null> {
  const app = await steamApp(appId)
  const movies = app?.movies ?? []
  const movie = movies.find((m) => m.highlight && m.dash_h264) ?? movies.find((m) => m.dash_h264)
  if (!movie?.dash_h264) return null
  const mpdUrl = movie.dash_h264
  const mpd = await httpFetch(mpdUrl, { signal }).then((r) => r.text())

  const total = /mediaPresentationDuration="PT(?:(\d+)H)?(?:(\d+)M)?([\d.]+)S"/.exec(mpd)
  const totalSec = total ? Number(total[1] ?? 0) * 3600 + Number(total[2] ?? 0) * 60 + Number(total[3]) : 0
  const video = /<AdaptationSet[^>]*contentType="video"[\s\S]*?<\/AdaptationSet>/.exec(mpd)?.[0] ?? ''
  const reps = [
    ...video.matchAll(
      /<Representation[^>]*\bid="(\w+)"[^>]*\bheight="(\d+)"[^>]*>\s*<SegmentTemplate[^>]*\btimescale="(\d+)"[^>]*\bduration="(\d+)"[^>]*\binitialization="([^"]+)"[^>]*\bmedia="([^"]+)"[^>]*\bstartNumber="(\d+)"/g
    )
  ].map((m) => ({ id: m[1], height: Number(m[2]), seg: Number(m[4]) / Number(m[3]), init: m[5], media: m[6], start: Number(m[7]) }))
  if (!reps.length) return null
  // 720p — достаточно для фона под затемнением; если такого нет — ближайшее снизу
  const rep = reps.filter((r) => r.height <= 720).sort((a, b) => b.height - a.height)[0] ?? reps.sort((a, b) => a.height - b.height)[0]

  const url = (tpl: string, n?: number) =>
    new URL(
      tpl
        .replace(/\$RepresentationID\$/g, rep.id)
        .replace(/\$Number%0(\d+)d\$/g, (_, w: string) => String(n).padStart(Number(w), '0'))
        .replace(/\$Number\$/g, String(n)),
      mpdUrl
    ).toString()

  const allSegments = totalSec ? Math.ceil(totalSec / rep.seg) : Math.ceil(TRAILER_SECONDS / rep.seg)
  const count = Math.min(allSegments, Math.ceil(TRAILER_SECONDS / rep.seg))
  const parts = [await fetchBuffer(url(rep.init), signal)]
  for (let i = 0; i < count; i++) parts.push(await fetchBuffer(url(rep.media, rep.start + i), signal))
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, Buffer.concat(parts))
  return { loopAt: count < allSegments ? count * rep.seg : undefined }
}

/** Анимированный фон из SteamGridDB (WebM), если трейлера нет */
async function sgdbAnimatedHero(game: Game, appId: number | null, key: string, file: string, signal: AbortSignal) {
  const api = async (p: string) => {
    const r = await httpFetch(`https://www.steamgriddb.com/api/v2${p}`, { headers: { Authorization: `Bearer ${key}` }, signal })
    const j = (await r.json()) as { success: boolean; data?: unknown }
    return j.success ? j.data : null
  }
  let sgdbId: number | undefined
  if (appId) sgdbId = ((await api(`/games/steam/${appId}`).catch(() => null)) as { id: number } | null)?.id
  if (!sgdbId) {
    const found = ((await api(`/search/autocomplete/${encodeURIComponent(game.title)}`)) as { id: number; name: string }[] | null) ?? []
    sgdbId = (found.find((g) => normTitle(g.name) === normTitle(game.title)) ?? found[0])?.id
  }
  if (!sgdbId) return false
  const heroes = ((await api(`/heroes/game/${sgdbId}?types=animated`)) as { url: string; mime: string }[] | null) ?? []
  const webm = heroes.find((h) => h.mime === 'video/webm')
  if (!webm) return false
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, await fetchBuffer(webm.url, signal))
  return true
}

/** Живой фон игры: из кэша сразу, иначе скачиваем (трейлер Steam → анимированный фон SteamGridDB) */
export function liveBackground(game: Game): Promise<LiveBackground | null> {
  const e = entry(game.id)
  if (e.live && fs.existsSync(e.live.file)) return Promise.resolve({ src: e.live.file, loopAt: e.live.loopAt })
  if (e.live === null && e.liveAt && Date.now() - e.liveAt < LIVE_RETRY) return Promise.resolve(null)
  if (downloading?.gameId === game.id) return downloading.promise
  downloading?.ctrl.abort()

  const ctrl = new AbortController()
  const dir = artDir(game.id)
  const promise = (async (): Promise<LiveBackground | null> => {
    const appId = await findAppId(game)
    try {
      if (appId) {
        const file = path.join(dir, 'live.mp4')
        const got = await steamTrailer(appId, file, ctrl.signal)
        if (got) {
          e.live = { file, loopAt: got.loopAt }
          e.liveAt = Date.now()
          save()
          return { src: file, loopAt: got.loopAt }
        }
      }
      const key = getDb().settings.steamGridDbKey.trim()
      if (key) {
        const file = path.join(dir, 'live.webm')
        if (await sgdbAnimatedHero(game, appId, key, file, ctrl.signal)) {
          e.live = { file }
          e.liveAt = Date.now()
          save()
          return { src: file }
        }
      }
      e.live = null
      e.liveAt = Date.now()
      save()
      return null
    } catch {
      // Отменили или пропала сеть — попробуем в следующий раз
      return null
    } finally {
      if (downloading?.ctrl === ctrl) downloading = null
    }
  })()
  downloading = { gameId: game.id, ctrl, promise }
  return promise
}
