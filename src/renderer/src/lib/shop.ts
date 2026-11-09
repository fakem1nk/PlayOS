import { useEffect, useState } from 'react'
import type { DownloadKind, Game, StoreHome, StoreItem, StoreRowId, StoreSteam } from '@shared/types'
import { locale, plural, t } from '@shared/i18n'
import { libraryMatch } from '@shared/match'
import { api } from './api'
import { DEFAULT_ACCENT } from './format'
import { toast } from './state'

/** Магазин: общие данные вкладки и страницы игры. Витрина живёт дольше вкладки — переключение не мигает пустотой */

export const ROW_TITLES: Record<StoreRowId, string> = {
  sources: t('Новинки и свежие обновления'),
  top: t('Лидеры продаж'),
  new: t('Новое и популярное'),
  played: t('Самые популярные'),
  gog: t('Только в GOG'),
  soon: t('Скоро выйдут')
}

/** Игра магазина в виде игры библиотеки — для фона, обложки и заглушки без арта. Акцент нейтральный: цвета обложки мы не знаем */
export function storeGame(item: StoreItem): Game {
  return {
    id: `store:${item.appId}`,
    title: item.title,
    platform: 'pc',
    path: '',
    cover: item.cover,
    hero: item.hero,
    logo: item.logo,
    accent: DEFAULT_ACCENT,
    playtime: 0,
    addedAt: 0,
    sessions: []
  }
}

const fullDate = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long', year: 'numeric' })
const monthDate = new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric' })

/** Когда вышла или выйдет игра — с той точностью, которую знает Steam */
export function releaseText(item: StoreItem): string {
  const d = item.released ? new Date(item.released) : null
  switch (item.upcoming) {
    case 'soon':
      return t('Скоро')
    case 'tba':
      return t('Дата не объявлена')
    case 'year':
      return d ? String(d.getFullYear()) : t('Скоро')
    case 'quarter':
      return d ? t('{q} квартал {y}', { q: Math.floor(d.getMonth() / 3) + 1, y: d.getFullYear() }) : t('Скоро')
    case 'month':
      return d ? monthDate.format(d) : t('Скоро')
  }
  return d ? fullDate.format(d) : ''
}

/** Подпись под плиткой: дата для ещё не вышедших, иначе оценка или главная метка */
export function tileNote(item: StoreItem): string {
  if (item.upcoming) return releaseText(item)
  if (item.reviews?.label) return item.reviews.label
  // Игры нет ни в Steam, ни в GOG — о ней знают только источники пользователя
  if (item.store === 'sources') return t('Из ваших источников')
  return item.tags?.[0] ?? ''
}

/** «3 варианта» */
export const optionsCount = (n: number) => `${n} ${plural(n, ['вариант', 'варианта', 'вариантов'], ['option', 'options'])}`

export const KIND_LABELS: Record<DownloadKind, string> = {
  magnet: t('Торрент · магнет'),
  torrent: t('Торрент-файл'),
  http: t('Прямая ссылка')
}

let homeMemo: StoreHome | null = null

/** Витрина: сразу из памяти или кэша main, обновлённая приходит сама */
export function useStoreHome() {
  const [home, setHome] = useState<StoreHome | null>(homeMemo)
  const [failed, setFailed] = useState(false)
  const take = (h: StoreHome) => {
    homeMemo = h
    setHome(h)
  }
  const load = (refresh?: boolean) => {
    setFailed(false)
    api
      .storeHome(refresh)
      .then(take)
      .catch(() => setFailed(true))
  }
  useEffect(() => {
    load()
    return api.onStoreHome(take)
  }, [])
  return { home, failed, retry: () => load(true) }
}

let steamMemo: { at: number; value: StoreSteam } | null = null

/** Steam на этом ПК: установлен ли клиент и какие игры уже на диске (раз в минуту) */
export function useStoreSteam() {
  const [steam, setSteam] = useState<StoreSteam | null>(steamMemo?.value ?? null)
  useEffect(() => {
    if (steamMemo && Date.now() - steamMemo.at < 60_000) return
    let alive = true
    api
      .storeSteam()
      .then((value) => {
        steamMemo = { at: Date.now(), value }
        if (alive) setSteam(value)
      })
      .catch(() => alive && setSteam({ client: false, installed: [] }))
    return () => {
      alive = false
    }
  }, [])
  return steam
}

/**
 * Сколько раздач в источниках у игры эмулятора (PS2, PS3), которой нет на этом ПК. У таких игр главное — указать
 * файл, а «Скачать» появляется, только если что-то нашлось
 */
export function useEmuDownloads(game: Game | null): number {
  const [count, setCount] = useState(0)
  const want = !!game && !game.path && game.platform !== 'pc'
  const title = game?.title ?? ''
  const platform = game?.platform ?? 'pc'
  useEffect(() => {
    setCount(0)
    if (!want) return
    let alive = true
    api
      .storeOptions(0, title, platform)
      .then((l) => alive && setCount(l.length))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [want, title, platform])
  return count
}

/** Игра магазина уже в библиотеке PlayOS — по Steam AppID, а своя PC-игра без него — по названию */
export function libraryGameFor(games: Game[], appId: number, title: string) {
  return libraryMatch(games, appId, title)
}

/** Игры, которые сейчас добавляются: второе нажатие, пока main ищет арт, не добавит игру дважды */
const adding = new Set<number>()

/**
 * Игра магазина — в библиотеку, без файлов: оттуда её скачивают и запускают. Стоит в Steam на этом ПК — main добавит
 * её сразу с папкой. Итог — короткое уведомление; null — не добавилась или уже добавляется
 */
export async function addStoreGame(item: StoreItem): Promise<string | null> {
  if (adding.has(item.appId)) return null
  adding.add(item.appId)
  try {
    const id = await api.storeAddToLibrary(item.appId, item.title).catch(() => null)
    if (id) toast({ title: t('Игра в библиотеке'), message: item.title, image: item.cover, tone: 'success', history: false })
    else toast({ title: t('Не удалось добавить игру'), message: t('Steam не ответил. Проверьте интернет и попробуйте ещё раз.'), tone: 'error', history: false })
    return id
  } finally {
    adding.delete(item.appId)
  }
}
