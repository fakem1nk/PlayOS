import type { Game } from '@shared/types'
import { locale, plural, t } from '@shared/i18n'

export function playtime(sec: number) {
  if (!sec) return t('Ещё не играли')
  const m = Math.floor(sec / 60)
  const h = Math.floor(m / 60)
  if (h === 0) return m === 0 ? t('Меньше минуты') : t('{m} мин', { m })
  return m % 60 ? t('{h} ч {m} мин', { h, m: m % 60 }) : t('{h} ч', { h })
}

/** Размер на диске: 820 МБ, 42,3 ГБ, 1,2 ТБ */
export function bytes(b: number) {
  const n = (v: number, d = 1) => v.toLocaleString(locale(), { maximumFractionDigits: v >= 100 ? 0 : d })
  if (b >= 2 ** 40) return t('{v} ТБ', { v: n(b / 2 ** 40) })
  if (b >= 2 ** 30) return t('{v} ГБ', { v: n(b / 2 ** 30) })
  if (b >= 2 ** 20) return t('{v} МБ', { v: n(b / 2 ** 20, 0) })
  return t('{v} КБ', { v: n(Math.max(1, b / 2 ** 10), 0) })
}

const dateFmt = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long' })
const dateYearFmt = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long', year: 'numeric' })

export function lastPlayed(ts?: number) {
  if (!ts) return t('Не запускалась')
  const day = (t: number) => {
    const d = new Date(t)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  const days = Math.round((day(Date.now()) - day(ts)) / 86400000)
  if (days <= 0) return t('Сегодня')
  if (days === 1) return t('Вчера')
  if (days < 7) return t('{n} {days} назад', { n: days, days: plural(days, ['день', 'дня', 'дней'], ['day', 'days']) })
  return new Date(ts).getFullYear() === new Date().getFullYear() ? dateFmt.format(ts) : dateYearFmt.format(ts)
}

/** Давность для статусов: «только что», «5 мин назад», «3 ч назад», дальше — дата и время */
export function ago(ts?: number) {
  if (!ts) return ''
  const min = Math.floor((Date.now() - ts) / 60_000)
  if (min < 1) return t('только что')
  if (min < 60) return t('{n} мин назад', { n: min })
  if (min < 24 * 60) return t('{n} ч назад', { n: Math.floor(min / 60) })
  return `${lastPlayed(ts).toLowerCase()}, ${new Date(ts).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}`
}

export function timer(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export const clock = (d: Date) => d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })

export function gamesCount(n: number) {
  return `${n} ${plural(n, ['игра', 'игры', 'игр'], ['game', 'games'])}`
}

/** Стабильный оттенок из названия — для игр без обложки. */
export function hueOf(game: Pick<Game, 'title'>) {
  let h = 0
  for (const ch of game.title) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}

/** Локальный путь → URL нашего протокола pcs://, http-ссылки как есть. */
export function media(p?: string) {
  if (!p) return undefined
  if (/^(https?|data|blob|pcs):/i.test(p)) return p
  return `pcs://media/f?p=${encodeURIComponent(p)}`
}

/** Акцент интерфейса по умолчанию (не игра: библиотека, «добавить», настройки) */
export const DEFAULT_ACCENT = '#3d8bff'

/** Цвет игры для интерфейса: по обложке, а без арта — стабильный оттенок из названия */
export function accentOf(game: Game | null | undefined) {
  if (!game) return DEFAULT_ACCENT
  return game.accent ?? `hsl(${hueOf(game)} 70% 58%)`
}
