import path from 'node:path'
import type { StoreHome, StoreItem, StorePage } from '@shared/types'
import { getLang } from '@shared/i18n'
import { titleKey } from '@shared/match'
import { gogIdOf, gogStoreId } from '@shared/types'
import { httpFetch } from '../http'
import { dataDir } from '../store'
import { parseAbout } from './catalog'
import { readJson, writeJson } from './disk'

/**
 * Игры GOG, которых нет в Steam. Публичный каталог catalog.gog.com и карточки api.gog.com — без ключей, регион US.
 * Игра, которая есть и в Steam, показывается как игра Steam (там больше картинок и роликов), поэтому всё, что отдаёт
 * GOG, сверяется со Steam. Сверяет resolver из sources.ts: он помнит поиски в Steam (match-cache.json).
 * Плитки GOG живут под номером «минус id GOG»; по нему страница и «В библиотеку» находят игру в памяти и на диске.
 */

const CATALOG = 'https://catalog.gog.com/v1/catalog'
const GAMES = 'https://api.gog.com/v2/games/'
const HOUR = 3_600_000
const PAGE_TTL = 24 * HOUR
const ROW_TTL = 24 * HOUR
/** Не нашли игру в GOG — спросим снова через неделю */
const MISS_TTL = 7 * 24 * HOUR
const ROW_SIZE = 20
/** Ряд «Только в GOG» — если набралась хотя бы полка */
const ROW_MIN = 6
/** Сколько трендов GOG перебирать для ряда: большая часть есть и в Steam */
const ROW_POOL = 100
/** Сколько плиток GOG помнить на диске */
const KNOWN_MAX = 3000
/** Версия плиток и страниц на диске */
const ITEM_V = 1

/**
 * Каталог — всегда по-английски: с русской локалью GOG переводит и названия («Ведьмак 2: Убийцы королей»), а по ним
 * игру не сверить ни со Steam, ни с раздачами. Жанры переводим сами, описание страницы — на языке интерфейса
 */
const pageLocale = () => (getLang() === 'en' ? 'en-US' : 'ru-RU')

/** Жанры GOG по-русски — как их называет сам GOG */
const GENRES_RU: Record<string, string> = {
  action: 'Экшн',
  adventure: 'Приключение',
  rpg: 'Ролевая игра',
  'role-playing': 'Ролевая игра',
  simulation: 'Симулятор',
  strategy: 'Стратегия',
  shooter: 'Шутер',
  racing: 'Гонки',
  sports: 'Спорт',
  survival: 'Выживание',
  arcade: 'Аркада',
  realtime: 'В реальном времени',
  'real-time': 'В реальном времени',
  'visual-novel': 'Визуальная новелла',
  puzzle: 'Головоломка',
  'card-game': 'Карточная игра',
  pointandclick: 'Квест',
  'point-and-click': 'Квест',
  tpp: 'От третьего лица',
  fpp: 'От первого лица',
  turnbased: 'Пошаговая',
  'turn-based': 'Пошаговая',
  building: 'Строительство',
  economic: 'Экономика',
  'open-world': 'Открытый мир',
  exploration: 'Исследование',
  detective: 'Детектив',
  narrative: 'Драма',
  historical: 'Историческая',
  comedy: 'Комедия',
  managerial: 'Менеджмент',
  mystery: 'Мистика',
  platformer: 'Платформер',
  stealth: 'Стелс',
  tactical: 'Тактическая',
  fighting: 'Файтинг',
  scifi: 'Фантастика',
  'sci-fi': 'Фантастика',
  fantasy: 'Фэнтези',
  horror: 'Хоррор',
  combat: 'Сражения',
  modern: 'Современность',
  espionage: 'Шпионаж',
  sandbox: 'Песочница',
  rougelike: 'Рогалик',
  roguelike: 'Рогалик',
  metroidvania: 'Метроидвания',
  jrpg: 'JRPG',
  'shoot-em-up': 'Шмап',
  virtuallife: 'Виртуальная жизнь',
  naval: 'Про море',
  'hidden-object': 'Поиск предметов',
  educational: 'Обучающая',
  chess: 'Шахматы',
  pinball: 'Пинбол',
  rally: 'Ралли',
  offroad: 'Внедорожники',
  teamsport: 'Командный спорт',
  soccer: 'Футбол'
}
const dir = () => path.join(dataDir(), 'shop', 'gog')
const knownFile = () => path.join(dir(), 'items.json')
const matchFile = () => path.join(dir(), 'match.json')
const rowFile = () => path.join(dir(), `row-${getLang()}.json`)
const pageFile = (id: number) => path.join(dir(), 'pages', `${id}-${getLang()}.json`)

// ───────────────────────── Ответы GOG ─────────────────────────

interface RawProduct {
  id: string | number
  slug?: string
  title?: string
  productType?: string
  coverVertical?: string
  coverHorizontal?: string
  logo?: string
  galaxyBackgroundImage?: string
  screenshots?: string[]
  releaseDate?: string
  genres?: { name: string; slug?: string }[]
  tags?: { slug?: string }[]
  reviewsRating?: number
  reviewsCount?: number
  storeLink?: string
}

interface RawGame {
  description?: string
  _embedded?: {
    product?: { title?: string; globalReleaseDate?: string }
    developers?: { name: string }[]
    publisher?: { name: string }
    publishers?: { name: string }[]
    tags?: { name: string }[]
    series?: { name?: string } | null
    screenshots?: { _links?: { self?: { href?: string } } }[]
  }
}

/** Ответ сверки со Steam: AppID, 0 — в Steam такой игры нет; ошибка — Steam не ответил */
type SteamResolver = (title: string) => Promise<number>

let steamIdFor: SteamResolver | null = null
let onRow: (() => void) | null = null

/** Кто знает, есть ли игра в Steam (sources.ts) */
export function setSteamResolver(fn: SteamResolver) {
  steamIdFor = fn
}

/** Что делать, когда пересобрался ряд «Только в GOG» */
export function setGogRowListener(cb: () => void) {
  onRow = cb
}

async function getJson<T>(url: string, timeout = 10_000): Promise<T> {
  let last: unknown
  for (let i = 0; i < 2; i++) {
    try {
      const r = await httpFetch(url, { signal: AbortSignal.timeout(timeout) })
      if (!r.ok) throw new Error(`GOG ${r.status}`)
      return (await r.json()) as T
    } catch (e) {
      last = e
    }
  }
  throw last
}

const ADULT_TAGS = new Set(['sexual-content', 'nudity', 'nsfw', 'hentai'])

/**
 * Название для сверки со Steam без хвоста издания GOG: «Saints Row: The Third - The Full Package» в Steam —
 * «Saints Row: The Third». Хвосты отдельных игр (Remastered, Director's Cut) не трогаем
 */
const EDITION = /^(.*\S)(?:\s[-–—]\s|:\s)(?:the\s)?(full package|complete pack|complete edition|complete|gold edition|gold|platinum edition|platinum|game of the year edition|goty edition|goty|ultimate edition|deluxe edition|collection|anthology)$/i
const steamName = (title: string) => title.match(EDITION)?.[1] ?? title

/** Картинка GOG нужного размера: у шаблона вместо {formatter} — имя размера */
const sized = (url: string | undefined, formatter: string) => (url ? url.replace('{formatter}', formatter) : undefined)
const clean = (s: string) => s.replace(/[™®©]/g, '').replace(/\s{2,}/g, ' ').trim()

function toItem(p: RawProduct): StoreItem | null {
  const id = Number(p.id)
  // Демоверсии в каталоге тоже «игры» — в магазине они не нужны
  if (!id || !p.title || (p.productType && p.productType !== 'game') || /demo/i.test(p.title)) return null
  const item: StoreItem = {
    appId: gogStoreId(id),
    store: 'gog',
    title: clean(p.title),
    cover: p.coverVertical,
    hero: p.galaxyBackgroundImage ?? sized(p.screenshots?.[0], '1600'),
    logo: p.logo,
    header: p.coverHorizontal
  }
  const link = p.storeLink ?? (p.slug ? `https://www.gog.com/game/${p.slug}` : undefined)
  if (link && /^https:\/\/www\.gog\.com\//.test(link)) item.link = link
  const at = p.releaseDate ? Date.parse(p.releaseDate.replace(/\./g, '-')) : NaN
  if (Number.isFinite(at)) item.released = at
  const ru = getLang() !== 'en'
  const tags = [...new Set((p.genres ?? []).map((g) => (ru && g.slug && GENRES_RU[g.slug]) || g.name).filter(Boolean))].slice(0, 3)
  if (tags.length) item.tags = tags
  // Оценка GOG — до 50 (3,7 звезды = 37); в процентах как у Steam, без словесной подписи
  // Откровенный контент — как метки Steam 3 и 4: без settings.storeAdult такие игры не показываются
  if (p.tags?.some((t) => t.slug && ADULT_TAGS.has(t.slug))) item.adult = true
  if (p.reviewsCount && p.reviewsRating) item.reviews = { percent: Math.round(p.reviewsRating * 2), count: p.reviewsCount, label: '' }
  return item
}

// ───────────────────────── Плитки, которые мы видели ─────────────────────────

let known: Map<number, StoreItem> | null = null
let knownTimer: ReturnType<typeof setTimeout> | null = null

function knownMap(): Map<number, StoreItem> {
  if (!known) {
    const disk = readJson<{ v?: number; list?: StoreItem[] }>(knownFile())
    known = new Map(disk?.v === ITEM_V ? (disk.list ?? []).map((i) => [i.appId, i]) : [])
  }
  return known
}

function remember(items: StoreItem[]) {
  const map = knownMap()
  for (const it of items) {
    map.delete(it.appId)
    map.set(it.appId, it)
  }
  while (map.size > KNOWN_MAX) map.delete(map.keys().next().value!)
  knownTimer ??= setTimeout(() => {
    knownTimer = null
    writeJson(knownFile(), { v: ITEM_V, list: [...knownMap().values()] })
  }, 2000)
}

/** Плитка GOG по номеру магазина — для страницы и «В библиотеку» */
export function gogItemOf(appId: number): StoreItem | null {
  return gogIdOf(appId) ? (knownMap().get(appId) ?? null) : null
}

async function catalog(params: Record<string, string>): Promise<StoreItem[]> {
  const q = new URLSearchParams({ limit: '48', productType: 'in:game', countryCode: 'US', locale: 'en-US', currencyCode: 'USD', ...params })
  const j = await getJson<{ products?: RawProduct[] }>(`${CATALOG}?${q}`)
  const items = (j.products ?? []).map(toItem).filter((x): x is StoreItem => !!x)
  remember(items)
  return items
}

// ───────────────────────── Поиск и сверка ─────────────────────────

const searches = new Map<string, StoreItem[]>()

/**
 * Игры GOG по запросу, самые подходящие первыми. Поиск GOG нечёткий («witcher» находит «Tiny Witch»), поэтому
 * оставляем только игры, в названии которых каждое слово запроса — начало какого-то слова
 */
export async function gogSearch(term: string, limit = 24): Promise<StoreItem[]> {
  const q = term.trim()
  if (q.length < 2) return []
  const memo = `${getLang()}:${limit}:${q.toLowerCase()}`
  const hit = searches.get(memo)
  if (hit) return hit
  const key = titleKey(q).full
  const want = key.split(' ').filter((w) => w.length >= 2)
  const squash = (s: string) => s.replace(/\s/g, '')
  // «fear» в «F.E.A.R.» — слова «f e a r»: такое название сравниваем без пробелов
  const items = (await catalog({ query: `like:${q}`, limit: String(limit), order: 'desc:score' })).filter((it) => {
    const full = titleKey(it.title).full
    const words = full.split(' ')
    return want.every((w) => words.some((x) => x.startsWith(w))) || (key.length >= 3 && squash(full).includes(squash(key)))
  })
  if (searches.size > 60) searches.delete(searches.keys().next().value!)
  searches.set(memo, items)
  return items
}

/** Базовый ключ → [id GOG или 0, когда спрашивали] */
let matches: Record<string, [number, number]> | null = null
let matchTimer: ReturnType<typeof setTimeout> | null = null
const finding = new Map<string, Promise<StoreItem | null>>()

/** Игра GOG ровно с этим названием (ключи совпадают) — для раздач, которых нет в Steam. Ответ запоминается */
export function gogFind(title: string): Promise<StoreItem | null> {
  const k = titleKey(title)
  if (!k.full) return Promise.resolve(null)
  matches ??= readJson<Record<string, [number, number]>>(matchFile()) ?? {}
  const m = matches[k.base]
  if (m?.[0]) {
    const item = knownMap().get(gogStoreId(m[0]))
    if (item) return Promise.resolve(item)
  } else if (m && Date.now() - m[1] < MISS_TTL) return Promise.resolve(null)
  let p = finding.get(k.base)
  if (!p) {
    p = gogSearch(title, 10)
      .then((list) => {
        const same = list.find((it) => {
          const ik = titleKey(it.title)
          return ik.full === k.full || ik.base === k.base
        })
        matches![k.base] = [same ? -same.appId : 0, Date.now()]
        matchTimer ??= setTimeout(() => {
          matchTimer = null
          writeJson(matchFile(), matches)
        }, 2000)
        return same ?? null
      })
      .finally(() => finding.delete(k.base))
    finding.set(k.base, p)
  }
  return p
}

/**
 * Только игры, которых нет в Steam: та же игра в выдаче Steam (по ключу названия) или найденная поиском в Steam
 * отбрасывается. budget — сколько ждать Steam; кого не успели проверить или если Steam не ответил — unknown решает
 * (в поиске показываем, в ряд не берём, сверка доходит в фоне и запоминается)
 */
export async function gogOnly(items: StoreItem[], against: StoreItem[] = [], budget = Infinity, unknown = true): Promise<StoreItem[]> {
  const steamKeys = new Set(against.flatMap((s) => [titleKey(s.title).full, titleKey(s.title).base]))
  const list = items.filter((it) => {
    const k = titleKey(steamName(it.title))
    return !steamKeys.has(k.full) && !steamKeys.has(k.base)
  })
  if (!steamIdFor || !list.length) return list
  const verdict = new Map<number, boolean>()
  let next = 0
  const worker = async () => {
    while (next < list.length) {
      const it = list[next++]
      await steamIdFor!(steamName(it.title)).then(
        (id) => verdict.set(it.appId, id > 0),
        () => {
          /* Steam не ответил — решит unknown */
        }
      )
    }
  }
  const all = Promise.all(Array.from({ length: 4 }, worker))
  await (Number.isFinite(budget) ? Promise.race([all, new Promise((r) => setTimeout(r, budget))]) : all)
  return list.filter((it) => {
    const onSteam = verdict.get(it.appId)
    return onSteam === undefined ? unknown : !onSteam
  })
}

// ───────────────────────── Ряд «Только в GOG» ─────────────────────────

let row: { lang: string; at: number; v?: number; items: StoreItem[] } | null = null
let rowLoading: Promise<void> | null = null

function refreshRow() {
  rowLoading ??= (async () => {
    const trending = await catalog({ order: 'desc:trending', limit: String(ROW_POOL) })
    const only = await gogOnly(trending, [], Infinity, false)
    // Steam почти не отвечал — проверенных мало: оставляем прошлый ряд и пробуем снова через час
    if (only.length < ROW_MIN) {
      const prev = row?.lang === getLang() ? row.items : []
      row = { lang: getLang(), at: Date.now() - ROW_TTL + HOUR, v: ITEM_V, items: prev.length > only.length ? prev : only }
      return
    }
    row = { lang: getLang(), at: Date.now(), v: ITEM_V, items: only.slice(0, ROW_SIZE) }
    writeJson(rowFile(), row)
    onRow?.()
  })()
    .catch(() => {
      /* без сети — прошлый ряд */
    })
    .finally(() => (rowLoading = null))
}

/** Витрина с рядом «Только в GOG» перед «Скоро выйдут». Устаревший ряд пересобирается в фоне */
export function withGogRow(h: StoreHome): StoreHome {
  if (row?.lang !== getLang()) {
    const disk = readJson<NonNullable<typeof row>>(rowFile())
    row = disk?.v === ITEM_V ? disk : null
  }
  if (!row || Date.now() - row.at > ROW_TTL) refreshRow()
  const items = row?.items ?? []
  if (items.length < ROW_MIN || h.rows.some((r) => r.id === 'gog')) return h
  const at = h.rows.findIndex((r) => r.id === 'soon')
  const rows = [...h.rows]
  rows.splice(at < 0 ? rows.length : at, 0, { id: 'gog', items })
  return { ...h, rows }
}

// ───────────────────────── Страница игры ─────────────────────────

/** Описание GOG — HTML; в BBCode магазина, чтобы его разобрал тот же parseAbout */
const htmlToBb = (html: string) =>
  html
    .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, '[h2]$1[/h2]')
    .replace(/<li[^>]*>/gi, '[*]')
    .replace(/<\/?(p|div|ul|ol|li|section|hr)\b[^>]*>/gi, '\n')
    .replace(/<img[^>]*>/gi, '\n')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))

async function fetchPage(appId: number): Promise<StorePage | null> {
  const id = gogIdOf(appId)
  const j = await getJson<RawGame>(`${GAMES}${id}?locale=${pageLocale()}`)
  const e = j._embedded
  const base = knownMap().get(appId)
  const title = base?.title ?? (e?.product?.title ? clean(e.product.title) : '')
  if (!title) return null
  const shots = (e?.screenshots ?? []).flatMap((s) => {
    const href = s._links?.self?.href
    return href ? [{ thumb: sized(href, 'product_card_screenshot_748')!, full: sized(href, '1600')! }] : []
  })
  const at = e?.product?.globalReleaseDate ? Date.parse(e.product.globalReleaseDate) : NaN
  const tags = (e?.tags ?? []).map((t) => t.name).filter(Boolean)
  const page: StorePage = {
    appId,
    store: 'gog',
    title,
    ...base,
    ...(tags.length ? { tags: tags.slice(0, 12) } : {}),
    ...(!base?.released && Number.isFinite(at) ? { released: at } : {}),
    hero: base?.hero ?? shots[0]?.full,
    about: j.description ? parseAbout(htmlToBb(j.description)) : [],
    developers: (e?.developers ?? []).map((d) => d.name),
    publishers: (e?.publishers ?? (e?.publisher ? [e.publisher] : [])).map((p) => p.name),
    franchise: e?.series?.name || undefined,
    screenshots: shots.slice(0, 16)
  }
  writeJson(pageFile(id), { ...page, at: Date.now(), v: ITEM_V })
  return page
}

const pageLoading = new Map<number, Promise<StorePage | null>>()

function loadPage(appId: number): Promise<StorePage | null> {
  let p = pageLoading.get(appId)
  if (!p) {
    p = fetchPage(appId).finally(() => pageLoading.delete(appId))
    pageLoading.set(appId, p)
  }
  return p
}

/** Страница игры GOG: с диска сразу, устаревшая обновляется в фоне; без кэша ждём GOG */
export async function gogPage(appId: number): Promise<StorePage | null> {
  const disk = readJson<StorePage & { at: number; v?: number }>(pageFile(gogIdOf(appId)))
  if (disk?.v === ITEM_V) {
    if (Date.now() - disk.at > PAGE_TTL)
      void loadPage(appId).catch(() => {
        /* без сети остаёмся на кэше */
      })
    return disk
  }
  return loadPage(appId).catch(() => null)
}
