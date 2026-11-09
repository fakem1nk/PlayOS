import path from 'node:path'
import type { GameDetails, StoreBlock, StoreBrowsePage, StoreBrowseQuery, StoreHome, StoreItem, StorePage, StoreRow, StoreRowId, StoreSort, StoreTagInfo, StoreUpcoming } from '@shared/types'
import { STORE_EARLY_ACCESS, STORE_GENRE_ROWS } from '@shared/types'
import { getLang } from '@shared/i18n'
import { howLongToBeat } from '../details'
import { httpFetch } from '../http'
import { dataDir, getDb } from '../store'
import { readJson, writeJson } from './disk'

/**
 * Каталог магазина из Steam. Только api.steampowered.com: он отвечает за секунду, а store.steampowered.com
 * из России бывает по 25 секунд. Регион всегда US — так видны и игры, которых нет в российском Steam.
 * Витрина и страницы игр лежат на диске: магазин открывается сразу и работает без сети.
 */

const API = 'https://api.steampowered.com'
const ASSETS = 'https://shared.akamai.steamstatic.com/store_item_assets/'
const VIDEO = 'https://video.akamai.steamstatic.com/store_trailers/'
const HOUR = 3_600_000
const HOME_TTL = HOUR
const PAGE_TTL = 24 * HOUR
const TAGS_TTL = 7 * 24 * HOUR
const ROW_SIZE = 20
/** Версия плиток в кэше: витрина и страницы старее не читаются (в версии 2 появилась метка adult) */
export const ITEM_V = 2
/** Метки Steam «Только для взрослых: сексуальный контент» и «Частая нагота или сексуальный контент» */
const ADULT = new Set([3, 4])

// Сортировки IStoreQueryService/Query (подобраны по ответам Steam, 2026-11-09): 10 — популярные, 20 — новое и
// популярное, 23 — лучшие по отзывам, 1 — по названию, 40 — по дате выхода (свежие первыми), 13 — самые ожидаемые
const SORT_POPULAR = 10
const SORT_NEW_TRENDING = 20
const SORT_TOP_RATED = 23
const SORT_NAME = 1
const SORT_BY_DATE = 40
const SORT_WISHLISTED = 13

const steamLang = () => (getLang() === 'en' ? 'english' : 'russian')
const context = () => ({ language: steamLang(), country_code: 'US' })
const cacheDir = () => path.join(dataDir(), 'shop')

// ───────────────────────── Ответы Steam ─────────────────────────

interface RawAssets {
  asset_url_format?: string
  library_capsule?: string
  library_capsule_2x?: string
  library_hero?: string
  library_hero_2x?: string
  library_logo?: string
  library_logo_2x?: string
  header?: string
}

interface RawTrailer {
  microtrailer?: { filename: string; type: string }[]
}

interface RawItem {
  id: number
  appid?: number
  success?: number
  type?: number
  name?: string
  tags?: { tagid: number; weight: number }[]
  reviews?: { summary_filtered?: { review_count?: number; percent_positive?: number; review_score_label?: string } }
  basic_info?: {
    short_description?: string
    developers?: { name: string }[]
    publishers?: { name: string }[]
    franchises?: { name: string }[]
  }
  assets?: RawAssets
  release?: { steam_release_date?: number; original_release_date?: number; coming_soon_display?: string }
  screenshots?: { all_ages_screenshots?: { filename: string }[]; mature_content_screenshots?: { filename: string }[] }
  trailers?: { highlights?: RawTrailer[]; other_trailers?: RawTrailer[] }
  full_description_bbcode?: string
  content_descriptorids?: number[]
}

/** Что просить у Steam для плитки витрины */
const TILE_REQUEST = { include_assets: true, include_release: true, include_reviews: true, include_basic_info: true, include_tag_count: 5 }
const PAGE_REQUEST = {
  ...TILE_REQUEST,
  include_tag_count: 12,
  include_screenshots: true,
  include_trailers: true,
  include_full_description: true
}

/** Попыток на один вызов Steam и через сколько, не дождавшись ответа, отправлять следующую параллельно */
const ATTEMPTS = 3
const HEDGE_MS = 2500

/**
 * Вызов сервиса Steam Web API (input_json). Обычно ответ за секунду, но через прокси и у части провайдеров
 * соединение с серверами Steam повисает насовсем. Поэтому повисший запрос не ждём до таймаута: через HEDGE_MS
 * рядом уходит следующая попытка (новое соединение), берём первый ответ. Упала сразу — следующая без паузы
 */
function call<T>(iface: string, input: unknown, timeout = 8000): Promise<T> {
  const url = `${API}/${iface}/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`
  const once = async () => {
    const r = await httpFetch(url, { signal: AbortSignal.timeout(timeout) })
    if (!r.ok) throw new Error(`Steam ${r.status}`)
    const j = (await r.json()) as { response?: T }
    if (!j.response) throw new Error('Steam: пустой ответ')
    return j.response
  }
  return new Promise<T>((resolve, reject) => {
    let started = 0
    let failed = 0
    let done = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const start = () => {
      if (done || started >= ATTEMPTS) return
      started++
      clearTimeout(timer)
      if (started < ATTEMPTS) timer = setTimeout(start, HEDGE_MS)
      once().then(
        (v) => {
          if (done) return
          done = true
          clearTimeout(timer)
          resolve(v)
        },
        (e) => {
          if (done) return
          failed++
          if (failed >= ATTEMPTS) {
            done = true
            reject(e)
          } else if (failed >= started) start()
        }
      )
    }
    start()
  })
}

// ───────────────────────── Метки ─────────────────────────

let tagNames: { lang: string; names: Map<number, string> } | null = null
let tagsLoading: Promise<Map<number, string>> | null = null

/** Свежий список меток из Steam (на диск); не вышло — то, что было */
function fetchTags(lang: string, file: string, prev?: { tagid: number; name: string }[]): Promise<Map<number, string>> {
  tagsLoading ??= (async () => {
    let list = prev
    try {
      const r = await httpFetch(`${API}/IStoreService/GetTagList/v1/?language=${lang}`, { signal: AbortSignal.timeout(8000) })
      const j = (await r.json()) as { response?: { tags?: { tagid: number; name: string }[] } }
      if (j.response?.tags?.length) {
        list = j.response.tags
        writeJson(file, { at: Date.now(), list })
      }
    } catch {
      /* обойдёмся тем, что на диске */
    }
    const names = new Map((list ?? []).map((t) => [t.tagid, t.name]))
    if (names.size) tagNames = { lang, names }
    return names
  })().finally(() => (tagsLoading = null))
  return tagsLoading
}

/**
 * Названия меток Steam на языке интерфейса: список целиком, раз в неделю. Устаревший список с диска отдаётся
 * сразу и обновляется в фоне — страница игры не ждёт из-за меток медленную сеть
 */
async function tags(): Promise<Map<number, string>> {
  const lang = steamLang()
  if (tagNames?.lang === lang) return tagNames.names
  const file = path.join(cacheDir(), `tags-${lang}.json`)
  const disk = readJson<{ at: number; list: { tagid: number; name: string }[] }>(file)
  if (!disk?.list?.length) return fetchTags(lang, file)
  const names = new Map(disk.list.map((t) => [t.tagid, t.name]))
  tagNames = { lang, names }
  if (Date.now() - disk.at > TAGS_TTL) void fetchTags(lang, file, disk.list)
  return names
}

// ───────────────────────── Разбор ─────────────────────────

function art(a: RawAssets | undefined, file?: string) {
  return a?.asset_url_format && file ? ASSETS + a.asset_url_format.replace('${FILENAME}', file) : undefined
}

const UPCOMING: Record<string, StoreUpcoming> = {
  date_full: 'date',
  date_month: 'month',
  date_quarter: 'quarter',
  date_year: 'year',
  text_comingsoon: 'soon',
  text_tba: 'tba'
}

function toItem(raw: RawItem, names: Map<number, string>, tagCount = 5): StoreItem | null {
  const appId = raw.appid ?? raw.id
  // Только игры: в «самых популярных» встречаются программы (Wallpaper Engine) и пустые записи
  if (!appId || !raw.name || (raw.success !== undefined && raw.success !== 1) || (raw.type !== undefined && raw.type !== 0)) return null
  const a = raw.assets
  const rel = raw.release
  const display = rel?.coming_soon_display
  const date = rel?.steam_release_date ?? rel?.original_release_date
  const sum = raw.reviews?.summary_filtered
  const item: StoreItem = {
    appId,
    title: raw.name.trim(),
    // Одинарный размер: на витрине сотня обложек, двойные весят вчетверо больше
    cover: art(a, a?.library_capsule ?? a?.library_capsule_2x),
    hero: art(a, a?.library_hero ?? a?.library_hero_2x),
    // Логотипа в ответе Steam обычно нет, но у большинства игр он лежит по старому пути без хеша
    logo: art(a, a?.library_logo_2x ?? a?.library_logo) ?? `${ASSETS}steam/apps/${appId}/logo.png`,
    header: art(a, a?.header)
  }
  if (raw.content_descriptorids?.some((d) => ADULT.has(d))) item.adult = true
  if (display) item.upcoming = UPCOMING[display] ?? 'soon'
  if (date && item.upcoming !== 'soon' && item.upcoming !== 'tba') item.released = date * 1000
  if (raw.basic_info?.short_description) item.short = decode(raw.basic_info.short_description)
  const tagList = [...(raw.tags ?? [])]
    .sort((x, y) => y.weight - x.weight)
    .map((t) => names.get(t.tagid))
    .filter((n): n is string => !!n)
    .slice(0, tagCount)
  if (tagList.length) item.tags = tagList
  if (sum?.review_count && sum.percent_positive !== undefined) {
    item.reviews = { percent: sum.percent_positive, count: sum.review_count, label: sum.review_score_label ?? '' }
  }
  return item
}

const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()

/**
 * Описание из BBCode магазина: заголовки, абзацы и пункты списков, без картинок и роликов.
 * Многие игры пишут заголовки простой короткой строкой — такую строку перед абзацем тоже считаем заголовком.
 */
export function parseAbout(bb: string): StoreBlock[] {
  const H = '\u0001h'
  const L = '\u0001l'
  const text = bb
    .replace(/\r/g, '')
    .replace(/\[(img|video|previewyoutube|carousel)\b[^\]]*\][\s\S]*?\[\/\1\]/gi, '\n')
    .replace(/\[(img|video|previewyoutube)\b[^\]]*\]/gi, '\n')
    .replace(/\[h[1-6]\]([\s\S]*?)\[\/h[1-6]\]/gi, (_, h: string) => `\n${H}${h.replace(/\n+/g, ' ')}\n`)
    .replace(/\[\*\]/g, `\n${L}`)
    .replace(/\[\/?(p|list|olist|ul|ol|br|hr|table|tr|td|th)\b[^\]]*\]/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\[\/?[a-z*]+[^\]]*\]/gi, '')
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && l !== H && l !== L)
  const blocks: StoreBlock[] = lines.map((l) =>
    l.startsWith(H) ? { kind: 'h', text: decode(l.slice(2)) } : l.startsWith(L) ? { kind: 'li', text: decode(l.slice(2)) } : { kind: 'p', text: decode(l) }
  )
  // Короткая строка без точки в конце, за которой идёт абзац, — заголовок
  for (let i = 0; i < blocks.length - 1; i++) {
    const b = blocks[i]
    if (b.kind === 'p' && b.text.length <= 60 && !/[.!?:;,…»"]$/.test(b.text) && blocks[i + 1].kind === 'p' && blocks[i + 1].text.length > b.text.length) b.kind = 'h'
  }
  return blocks.filter((b) => b.text).slice(0, 80)
}

// ───────────────────────── Витрина ─────────────────────────

async function itemsByIds(ids: number[], request: object): Promise<RawItem[]> {
  if (!ids.length) return []
  const res = await call<{ store_items?: RawItem[] }>('IStoreBrowseService/GetItems', { ids: ids.map((appid) => ({ appid })), context: context(), data_request: request })
  return res.store_items ?? []
}

async function query(filters: object, sort: number, count = ROW_SIZE + 6): Promise<RawItem[]> {
  const res = await call<{ store_items?: RawItem[] }>('IStoreQueryService/Query', {
    query: { start: 0, count, sort, filters: { ...filters, type_filters: { include_games: true } } },
    context: context(),
    data_request: TILE_REQUEST
  })
  return res.store_items ?? []
}

/** Ряды из Steam; «Новинки и свежие обновления» собирает sources.ts, «Только в GOG» — gog.ts */
type SteamRow = Exclude<StoreRowId, 'sources' | 'gog'>

const ROWS: Record<SteamRow, () => Promise<RawItem[]>> = {
  top: async () => {
    const res = await call<{ ranks?: { item?: RawItem }[] }>('IStoreTopSellersService/GetWeeklyTopSellers', {
      country_code: 'US',
      context: context(),
      data_request: TILE_REQUEST,
      page_start: 0,
      page_count: ROW_SIZE + 6
    })
    return (res.ranks ?? []).flatMap((r) => (r.item ? [r.item] : []))
  },
  new: () => query({ released_only: true }, SORT_NEW_TRENDING),
  played: async () => {
    const res = await call<{ ranks?: { appid: number }[] }>('ISteamChartsService/GetMostPlayedGames', {})
    return itemsByIds((res.ranks ?? []).slice(0, ROW_SIZE + 10).map((r) => r.appid), TILE_REQUEST)
  },
  soon: () => query({ coming_soon_only: true }, SORT_WISHLISTED)
}
/**
 * Порядок витрины: свои ряды, после «Самых популярных» — жанры. В ряд жанра берём игры, которых нет в рядах выше:
 * иначе «Экшен» повторял бы «Лидеров продаж», а «Ролевая игра» — «Экшен»
 */
interface RowSpec {
  id: StoreRow['id']
  tag?: number
  load: () => Promise<RawItem[]>
}
const rowSpecs = (): RowSpec[] => [
  ...(['top', 'new', 'played'] as const).map((id) => ({ id, load: ROWS[id] })),
  ...STORE_GENRE_ROWS.map((tag) => ({ id: `tag-${tag}` as const, tag, load: () => query({ released_only: true, tagids_must_match: [{ tagids: [tag] }] }, SORT_POPULAR, 48) })),
  { id: 'soon', load: ROWS.soon }
]

let home: (StoreHome & { lang: string }) | null = null
let homeLoading: Promise<StoreHome> | null = null
let onHome: ((h: StoreHome) => void) | null = null

/** Куда отправлять витрину, обновлённую в фоне */
export function setHomeListener(cb: (h: StoreHome) => void) {
  onHome = cb
}

const homeFile = () => path.join(cacheDir(), `home-${steamLang()}.json`)

/** Свежая витрина из Steam. Ряд, который не загрузился, берём из прошлой витрины */
function loadHome(prev: StoreHome | null): Promise<StoreHome> {
  homeLoading ??= (async () => {
    // Метки — параллельно с рядами: их список почти всегда уже на диске
    const specs = rowSpecs()
    const [names, results] = await Promise.all([tags(), Promise.allSettled(specs.map((r) => r.load()))])
    const rows: StoreRow[] = []
    const shown = new Set<number>()
    results.forEach((r, i) => {
      const { id, tag } = specs[i]
      const all = r.status === 'fulfilled' ? r.value.map((raw) => toItem(raw, names)).filter((x): x is StoreItem => !!x) : []
      const items = (tag ? all.filter((it) => !shown.has(it.appId)) : all).slice(0, ROW_SIZE)
      const fallback = prev?.rows.find((row) => row.id === id)?.items ?? []
      const use = items.length ? items : fallback
      if (!use.length) return
      // Каждая игра — в одном ряду: «Ролевая игра» не повторяет ни «Лидеров продаж», ни «Экшен» выше
      if (id !== 'soon') for (const it of use) shown.add(it.appId)
      // Название ряда жанра — метка Steam на языке интерфейса
      rows.push(tag ? { id, items: use, tag, title: names.get(tag) ?? '' } : { id, items: use })
    })
    if (!rows.length) throw new Error('Steam не ответил')
    const fresh: StoreHome = { rows, fetchedAt: Date.now() }
    home = { ...fresh, lang: steamLang() }
    writeJson(homeFile(), { ...fresh, v: ITEM_V })
    return fresh
  })().finally(() => (homeLoading = null))
  return homeLoading
}

/**
 * Витрина магазина. Есть кэш — отдаём сразу, а устаревший обновляем в фоне (новая придёт в слушатель).
 * Кэша нет — ждём Steam. refresh — обновить сейчас, даже если кэш свежий.
 */
export async function storeHome(refresh = false): Promise<StoreHome> {
  if (home?.lang !== steamLang()) {
    const disk = readJson<StoreHome & { v?: number }>(homeFile())
    home = disk?.rows?.length && disk.v === ITEM_V ? { rows: disk.rows, fetchedAt: disk.fetchedAt, lang: steamLang() } : null
  }
  if (!home) return loadHome(null)
  const cached: StoreHome = { rows: home.rows, fetchedAt: home.fetchedAt }
  // Витрина из версии без рядов жанров — обновить сразу, не дожидаясь часа
  if (refresh || Date.now() - home.fetchedAt > HOME_TTL || !home.rows.some((r) => r.tag)) {
    void loadHome(cached)
      .then((h) => onHome?.(h))
      .catch(() => {
        /* без сети остаёмся на кэше */
      })
  }
  return cached
}

/** Игры для взрослых — только если их разрешили в настройках. Кэш хранит их с меткой, прячем при выдаче */
const adultAllowed = () => getDb().settings.storeAdult === true

export function viewerItems(items: StoreItem[]): StoreItem[] {
  return adultAllowed() ? items : items.filter((i) => !i.adult)
}

export function viewerHome(h: StoreHome): StoreHome {
  if (adultAllowed()) return h
  return { ...h, rows: h.rows.map((r) => ({ ...r, items: viewerItems(r.items) })).filter((r) => r.items.length) }
}

// ───────────────────────── Каталог игр ─────────────────────────

const BROWSE_SORT: Record<StoreSort, number> = { popular: SORT_POPULAR, new: SORT_NEW_TRENDING, reviews: SORT_TOP_RATED, name: SORT_NAME }
const BROWSE_PAGE = 48
/** С фильтрами, которых нет у Steam (отзывы, язык), — листаем дальше, пока не наберётся экран, но не больше 8 страниц */
const FILL = 24
const FILL_PAGES = 8
/** Страницы каталога в памяти: назад к уже открытому — сразу */
const BROWSE_TTL = 10 * 60_000
/** Границы года в списке по дате меняются медленно: новые игры добавляются только сверху */
const YEAR_TTL = 6 * HOUR
const TAG_COUNTS_TTL = 24 * HOUR
/** Язык Steam «русский» в supported_languages */
const RUSSIAN = 8

/** То, что Steam фильтрует сам: метки (у игры — каждая) и «без раннего доступа» */
interface ServerFilter {
  tags: number[]
  noEarly: boolean
}

const browseFilters = (f: ServerFilter) => ({
  released_only: true,
  type_filters: { include_games: true },
  ...(f.tags.length ? { tagids_must_match: f.tags.map((tag) => ({ tagids: [tag] })) } : {}),
  ...(f.noEarly ? { tagids_exclude: [STORE_EARLY_ACCESS] } : {})
})

interface LangRaw {
  supported_languages?: { elanguage: number; supported?: boolean; full_audio?: boolean }[]
}

async function queryAt(start: number, count: number, sort: number, f: ServerFilter, request: object) {
  const res = await call<{ store_items?: (RawItem & LangRaw)[]; metadata?: { total_matching_records?: number } }>('IStoreQueryService/Query', {
    query: { start, count, sort, filters: browseFilters(f) },
    context: context(),
    data_request: request
  })
  return { raws: res.store_items ?? [], total: res.metadata?.total_matching_records ?? 0 }
}

/** Год выхода игры на месте i в списке по дате выхода (свежие первыми) и сколько игр в списке */
async function yearAt(i: number, f: ServerFilter): Promise<{ year: number; total: number }> {
  const { raws, total } = await queryAt(i, 1, SORT_BY_DATE, f, { include_release: true })
  const rel = raws[0]?.release
  const at = rel?.steam_release_date ?? rel?.original_release_date
  return { year: at ? new Date(at * 1000).getUTCFullYear() : 0, total }
}

/**
 * Первое место, начиная с которого pred истинно (до него ложно) — поиск по четыре пробы сразу: у Steam нет фильтра
 * по году, но в списке по дате выхода игры одного года идут подряд. Около семи кругов запросов на весь каталог
 */
async function firstWhere(total: number, pred: (i: number) => Promise<boolean>): Promise<number> {
  let lo = 0
  let hi = total
  while (lo < hi) {
    const span = hi - lo
    const probes = span <= 4 ? Array.from({ length: span }, (_, k) => lo + k) : [1, 2, 3, 4].map((k) => lo + Math.floor((span * k) / 5))
    const hits = await Promise.all(probes.map(pred))
    const k = hits.indexOf(true)
    if (k < 0) lo = probes[probes.length - 1] + 1
    else {
      hi = probes[k]
      if (k > 0) lo = probes[k - 1] + 1
    }
  }
  return lo
}

const yearRanges = new Map<string, { at: number; range: Promise<{ from: number; to: number }> }>()

/** Где в списке по дате выхода игры с fromYear по toYear включительно */
function yearRange(fromYear: number, toYear: number, f: ServerFilter): Promise<{ from: number; to: number }> {
  const key = `${f.tags.join(',')}:${f.noEarly}:${fromYear}-${toYear}`
  const hit = yearRanges.get(key)
  if (hit && Date.now() - hit.at < YEAR_TTL) return hit.range
  const range = (async () => {
    const { total } = await yearAt(0, f)
    const before = (y: number) => (i: number) => yearAt(i, f).then((r) => r.year < y)
    const [from, to] = await Promise.all([firstWhere(total, before(toYear + 1)), firstWhere(total, before(fromYear))])
    return { from, to }
  })()
  yearRanges.set(key, { at: Date.now(), range })
  // Неудачу не запоминаем: возможно, Steam просто не ответил
  range.catch(() => yearRanges.delete(key))
  return range
}

/** Фильтры, которых у Steam нет: отзывы и русский язык — по ответу на каждую игру */
function rawFilter(q: StoreBrowseQuery): ((r: RawItem & LangRaw) => boolean) | null {
  const checks: ((r: RawItem & LangRaw) => boolean)[] = []
  if (q.reviews) checks.push((r) => (r.reviews?.summary_filtered?.percent_positive ?? 0) >= q.reviews!)
  if (q.minReviews) checks.push((r) => (r.reviews?.summary_filtered?.review_count ?? 0) >= q.minReviews!)
  const ru = (r: LangRaw) => r.supported_languages?.find((l) => l.elanguage === RUSSIAN)
  if (q.ruText) checks.push((r) => !!ru(r)?.supported)
  if (q.ruVoice) checks.push((r) => !!ru(r)?.full_audio)
  return checks.length ? (r) => checks.every((c) => c(r)) : null
}

const browsed = new Map<string, { at: number; page: Promise<StoreBrowsePage> }>()

/**
 * Страница каталога игр Steam. Метки и ранний доступ фильтрует Steam; год и десятилетие — отрезок списка по дате
 * выхода (так что с годом порядок — по дате: другой Steam не умеет); отзывы и русский язык — мы, по ответу Steam
 */
export function storeBrowse(q: StoreBrowseQuery): Promise<StoreBrowsePage> {
  const f: ServerFilter = { tags: [...new Set(q.tags ?? [])].sort((a, b) => a - b), noEarly: !!q.noEarly }
  const key = JSON.stringify([steamLang(), q.sort, f, q.year, q.decade, q.reviews, q.minReviews, q.ruText, q.ruVoice, q.start])
  const hit = browsed.get(key)
  if (hit && Date.now() - hit.at < BROWSE_TTL) return hit.page
  const page = (async (): Promise<StoreBrowsePage> => {
    const names = await tags()
    const keep = rawFilter(q)
    const request = q.ruText || q.ruVoice ? { ...TILE_REQUEST, include_supported_languages: true } : TILE_REQUEST
    const years = q.year ? [q.year, q.year] : q.decade ? [q.decade, q.decade + 9] : null
    const range = years ? await yearRange(years[0], years[1], f) : null
    const sort = range ? SORT_BY_DATE : (BROWSE_SORT[q.sort] ?? SORT_POPULAR)
    const items: StoreItem[] = []
    let start = q.start
    let end = range ? range.to - range.from : Infinity
    for (let n = 0; n < (keep ? FILL_PAGES : 1) && start < end; n++) {
      const count = Math.min(BROWSE_PAGE, end - start)
      const res = await queryAt((range?.from ?? 0) + start, count, sort, f, request)
      if (!range) end = res.total
      for (const raw of keep ? res.raws.filter(keep) : res.raws) {
        const it = toItem(raw, names)
        if (it) items.push(it)
      }
      start += count
      if (items.length >= FILL) break
    }
    return { items, ...(keep ? {} : { total: end }), ...(start < end ? { next: start } : {}) }
  })()
  if (browsed.size > 120) browsed.delete(browsed.keys().next().value!)
  browsed.set(key, { at: Date.now(), page })
  page.catch(() => browsed.delete(key))
  return page
}

// Счётчики меток для панели фильтров: по одному запросу на метку, раз в сутки, в фоне
const tagCountsFile = () => path.join(cacheDir(), 'tag-counts.json')
let tagCounts: { at: number; counts: Record<number, number> } | null = null
let countsLoading: Promise<void> | null = null

function refreshTagCounts(ids: number[]) {
  countsLoading ??= (async () => {
    const counts = { ...(tagCounts?.counts ?? {}) }
    const fresh = Date.now() - (tagCounts?.at ?? 0) < TAG_COUNTS_TTL
    const due = fresh ? ids.filter((id) => counts[id] === undefined) : ids
    let next = 0
    let changed = 0
    const worker = async () => {
      while (next < due.length) {
        const id = due[next++]
        const res = await queryAt(0, 1, SORT_POPULAR, { tags: [id], noEarly: false }, {}).catch(() => null)
        if (!res) continue
        counts[id] = res.total
        // На диск — порциями: следующее открытие панели увидит то, что уже посчитано
        if (++changed % 12 === 0) writeJson(tagCountsFile(), (tagCounts = { at: tagCounts?.at ?? Date.now(), counts }))
      }
    }
    await Promise.all(Array.from({ length: 4 }, worker))
    tagCounts = { at: fresh ? tagCounts!.at : Date.now(), counts }
    writeJson(tagCountsFile(), tagCounts)
  })().finally(() => (countsLoading = null))
}

/** Названия меток на языке интерфейса и сколько игр с каждой; чего не хватает — посчитается в фоне */
export async function storeTagInfo(ids: number[]): Promise<Record<number, StoreTagInfo>> {
  const names = await tags()
  tagCounts ??= readJson<{ at: number; counts: Record<number, number> }>(tagCountsFile())
  const counts = tagCounts?.counts ?? {}
  if (!tagCounts || Date.now() - tagCounts.at > TAG_COUNTS_TTL || ids.some((id) => counts[id] === undefined)) refreshTagCounts(ids)
  return Object.fromEntries(ids.map((id) => [id, { name: names.get(id) ?? String(id), ...(counts[id] !== undefined ? { count: counts[id] } : {}) }]))
}

// ───────────────────────── Поиск ─────────────────────────

const searches = new Map<string, StoreItem[]>()

export async function storeSearch(q: string): Promise<StoreItem[]> {
  const term = q.trim()
  if (!term) return []
  const key = `${steamLang()}:${term.toLowerCase()}`
  const hit = searches.get(key)
  if (hit) return hit
  const [names, res] = await Promise.all([
    tags(),
    call<{ store_items?: RawItem[] }>('IStoreQueryService/SearchSuggestions', {
      search_term: term,
      max_results: 30,
      context: context(),
      filters: { type_filters: { include_games: true } },
      data_request: TILE_REQUEST
    })
  ])
  const items = (res.store_items ?? []).map((raw) => toItem(raw, names)).filter((x): x is StoreItem => !!x)
  if (searches.size > 60) searches.delete(searches.keys().next().value!)
  searches.set(key, items)
  return items
}

/** Плитки по списку AppID в том же порядке; то, что не игра, пропускается */
export async function storeItems(ids: number[]): Promise<StoreItem[]> {
  const [names, raws] = await Promise.all([tags(), itemsByIds(ids, TILE_REQUEST)])
  const byId = new Map(raws.map((r) => [r.appid ?? r.id, r]))
  return ids.flatMap((id) => {
    const raw = byId.get(id)
    const item = raw ? toItem(raw, names) : null
    return item ? [item] : []
  })
}

/**
 * Игры Steam по запросу: AppID, название и год выхода — для сопоставления с источниками. Русский запрос ищется
 * по-русски: так находятся локализованные названия («Ведьмак 3»), английский поиск их не знает
 */
export async function searchTitles(term: string, language: 'english' | 'russian' = 'english'): Promise<{ appId: number; title: string; year?: number }[]> {
  const res = await call<{ store_items?: RawItem[] }>('IStoreQueryService/SearchSuggestions', {
    search_term: term,
    max_results: 8,
    context: { language, country_code: 'US' },
    filters: { type_filters: { include_games: true } },
    data_request: { include_release: true }
  })
  return (res.store_items ?? []).flatMap((r) => {
    const appId = r.appid ?? r.id
    const at = r.release?.original_release_date || r.release?.steam_release_date
    return appId && r.name ? [{ appId, title: r.name, ...(at ? { year: new Date(at * 1000).getUTCFullYear() } : {}) }] : []
  })
}

// ───────────────────────── Страница игры ─────────────────────────

const pageFile = (appId: number) => path.join(cacheDir(), 'apps', `${appId}-${steamLang()}.json`)

/** Скриншот поменьше для ленты: у Steam рядом лежит копия 600×338 */
const thumbOf = (url: string) => url.replace(/\.jpg(\?|$)/, '.600x338.jpg$1')

/** Страница прямо из Steam (и на диск); null — Steam не знает такую игру */
async function fetchPage(appId: number): Promise<StorePage | null> {
  const [names, raws] = await Promise.all([tags(), itemsByIds([appId], PAGE_REQUEST)])
  const raw = raws[0]
  const item = raw ? toItem({ ...raw, type: 0 }, names, 12) : null
  if (!raw || !item) return null
  const shots = [...(raw.screenshots?.all_ages_screenshots ?? [])].map((s) => ASSETS + s.filename)
  const trailers = [...(raw.trailers?.highlights ?? []), ...(raw.trailers?.other_trailers ?? [])]
  const micro = trailers.flatMap((t) => t.microtrailer ?? []).find((m) => m.type === 'video/mp4')
  const info = raw.basic_info
  const page: StorePage = {
    ...item,
    about: raw.full_description_bbcode ? parseAbout(raw.full_description_bbcode) : [],
    developers: info?.developers?.map((d) => d.name) ?? [],
    publishers: info?.publishers?.map((p) => p.name) ?? [],
    franchise: info?.franchises?.[0]?.name,
    screenshots: shots.slice(0, 16).map((full) => ({ full, thumb: thumbOf(full) })),
    trailer: micro ? VIDEO + micro.filename : undefined
  }
  writeJson(pageFile(appId), { ...page, at: Date.now(), v: ITEM_V })
  return page
}

/** Запросы страниц, которые уже идут: открытие карточки подхватывает запрос, начатый предзагрузкой */
const pageLoading = new Map<string, Promise<StorePage | null>>()

function loadPage(appId: number): Promise<StorePage | null> {
  const key = `${appId}-${steamLang()}`
  let p = pageLoading.get(key)
  if (!p) {
    p = fetchPage(appId).finally(() => pageLoading.delete(key))
    pageLoading.set(key, p)
  }
  return p
}

/**
 * Страница игры в магазине. С диска — сразу, даже устаревшая: описание и скриншоты за сутки почти не меняются,
 * а свежая догружается в фоне к следующему открытию. Без кэша ждём Steam
 */
export async function storePage(appId: number): Promise<StorePage | null> {
  const disk = readJson<StorePage & { at: number; v?: number }>(pageFile(appId))
  if (disk && disk.v === ITEM_V) {
    if (Date.now() - disk.at > PAGE_TTL)
      void loadPage(appId).catch(() => {
        /* без сети остаёмся на кэше */
      })
    return disk
  }
  // Без сети — пусть и старого формата, но страница
  return loadPage(appId)
    .then((p) => p ?? disk)
    .catch(() => disk)
}

const hltbCache = new Map<number, Promise<GameDetails['hltb']>>()

export function storeHltb(appId: number, title: string): Promise<GameDetails['hltb']> {
  let p = hltbCache.get(appId)
  if (!p) {
    p = howLongToBeat(title).catch(() => null)
    hltbCache.set(appId, p)
    // Неудачу не запоминаем: возможно, просто не было сети
    void p.then((v) => v ?? hltbCache.delete(appId))
  }
  return p
}
