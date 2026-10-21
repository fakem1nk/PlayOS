import type { Game } from '@shared/types'
import { locale, plural, t } from '@shared/i18n'

export function playtime(sec: number) {
  if (!sec) return t('Ещё не играли')
  const m = Math.floor(sec / 60)
  const h = Math.floor(m / 60)
  if (h === 0) return m === 0 ? t('Меньше минуты') : t('{m} мин', { m })
  return m % 60 ? t('{h} ч {m} мин', { h, m: m % 60 }) : t('{h} ч', { h })
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
