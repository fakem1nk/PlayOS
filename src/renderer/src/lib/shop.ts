import { useEffect, useState } from 'react'
import type { DownloadKind, Game, StoreHome, StoreItem, StoreRowId, StoreSteam } from '@shared/types'
import { locale, plural, t } from '@shared/i18n'
import { api } from './api'
import { DEFAULT_ACCENT } from './format'

/** Магазин: общие данные вкладки и страницы игры. Витрина живёт дольше вкладки — переключение не мигает пустотой */

export const ROW_TITLES: Record<StoreRowId, string> = {
  sources: t('Вышедшие новинки'),
  top: t('Лидеры продаж'),
  new: t('Новое и популярное'),
  played: t('Самые популярные'),
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

/** Игра магазина уже в библиотеке PlayOS — по Steam AppID */
export function libraryGameFor(games: Game[], appId: number) {
  return games.find((g) => g.steamAppId === appId)
}
