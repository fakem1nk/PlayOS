import path from 'node:path'
import type { GameDetails, StoreBlock, StoreHome, StoreItem, StorePage, StoreRow, StoreRowId, StoreUpcoming } from '@shared/types'
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

// Сортировки IStoreQueryService/Query (подобраны по ответам Steam): 20 — новое и популярное, 13 — самые ожидаемые
const SORT_NEW_TRENDING = 20
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

/**
 * Вызов сервиса Steam Web API (input_json). Обычно ответ за секунду, но через прокси запрос иногда
 * повисает насовсем — поэтому короткий таймаут и до трёх попыток, а не одно долгое ожидание
 */
async function call<T>(iface: string, input: unknown, timeout = 8000): Promise<T> {
  const url = `${API}/${iface}/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`
  let last: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await httpFetch(url, { signal: AbortSignal.timeout(timeout) })
      if (!r.ok) throw new Error(`Steam ${r.status}`)
      const j = (await r.json()) as { response?: T }
      if (!j.response) throw new Error('Steam: пустой ответ')
      return j.response
    } catch (e) {
      last = e
    }
  }
  throw last
}

// ───────────────────────── Метки ─────────────────────────

let tagNames: { lang: string; names: Map<number, string> } | null = null

/** Названия меток Steam на языке интерфейса: список целиком, раз в неделю */
async function tags(): Promise<Map<number, string>> {
  const lang = steamLang()
  if (tagNames?.lang === lang) return tagNames.names
  const file = path.join(cacheDir(), `tags-${lang}.json`)
  const disk = readJson<{ at: number; list: { tagid: number; name: string }[] }>(file)
  let list = disk?.list
  if (!disk || Date.now() - disk.at > TAGS_TTL) {
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
  }
  const names = new Map((list ?? []).map((t) => [t.tagid, t.name]))
  if (names.size) tagNames = { lang, names }
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

async function query(filters: object, sort: number): Promise<RawItem[]> {
  const res = await call<{ store_items?: RawItem[] }>('IStoreQueryService/Query', {
    query: { start: 0, count: ROW_SIZE + 6, sort, filters: { ...filters, type_filters: { include_games: true } } },
    context: context(),
    data_request: TILE_REQUEST
  })
  return res.store_items ?? []
}

/** Ряды из Steam; «Новинки и свежие обновления» собирает sources.ts */
type SteamRow = Exclude<StoreRowId, 'sources'>

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
const ROW_ORDER: SteamRow[] = ['top', 'new', 'played', 'soon']

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
    const [names, results] = await Promise.all([tags(), Promise.allSettled(ROW_ORDER.map((id) => ROWS[id]()))])
    const rows: StoreRow[] = []
    results.forEach((r, i) => {
      const id = ROW_ORDER[i]
      const items = r.status === 'fulfilled' ? r.value.map((raw) => toItem(raw, names)).filter((x): x is StoreItem => !!x).slice(0, ROW_SIZE) : []
      const fallback = prev?.rows.find((row) => row.id === id)?.items ?? []
      const use = items.length ? items : fallback
      if (use.length) rows.push({ id, items: use })
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
  if (refresh || Date.now() - home.fetchedAt > HOME_TTL) {
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

export async function storePage(appId: number): Promise<StorePage | null> {
  const file = pageFile(appId)
  const disk = readJson<StorePage & { at: number; v?: number }>(file)
  if (disk && disk.v === ITEM_V && Date.now() - disk.at < PAGE_TTL) return disk
  try {
    const [names, raws] = await Promise.all([tags(), itemsByIds([appId], PAGE_REQUEST)])
    const raw = raws[0]
    const item = raw ? toItem({ ...raw, type: 0 }, names, 12) : null
    if (!raw || !item) return disk
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
    writeJson(file, { ...page, at: Date.now(), v: ITEM_V })
    return page
  } catch {
    // Без сети — пусть и старая, но страница
    return disk
  }
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
