import { useSyncExternalStore } from 'react'
import type { UpdateState, UpdateSummary, UpdateSummaryText } from '@shared/types'
import { api } from './api'
import { locale, t } from '@shared/i18n'

/** Состояние обновления PlayOS — одно на всё окно: уведомление, меню питания и настройки */
let state: UpdateState = { phase: 'idle', current: '' }
const subs = new Set<() => void>()
let started = false

function set(s: UpdateState) {
  state = s
  subs.forEach((f) => f())
}

function start() {
  if (started) return
  started = true
  void api.updateState().then(set)
  api.onUpdateState(set)
}

export function useUpdate() {
  start()
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => state
  )
}

/** Главное из заметок к релизу: пункты списка, без заголовков и ссылок */
export function updateHighlights(notes?: string, max = 4) {
  if (!notes) return []
  const lines = notes
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const bullets = lines.filter((l) => /^[•\-*]\s/.test(l)).map((l) => l.replace(/^[•\-*]\s+/, ''))
  return (bullets.length ? bullets : lines.filter((l) => !/^(#|full changelog|\*\*full)/i.test(l)).slice(0, 2)).slice(0, max)
}

/** Сводка на языке интерфейса; нет русских пунктов — английские */
export function summaryText(s?: UpdateSummary) {
  if (!s) return
  const own: UpdateSummaryText = (locale().startsWith('en') ? s.en : s.ru) ?? {}
  const src = own.new?.length || own.fixed?.length ? own : (s.en ?? {})
  const text = { new: src.new ?? [], fixed: src.fixed ?? [] }
  return text.new.length || text.fixed.length ? text : undefined
}

/** Мелкое обновление без новых функций — без окна, хватит короткой карточки */
export const isMinor = (s?: UpdateSummary) => s?.importance === 'minor' && !summaryText(s)?.new.length

/** 1.1.0-beta.1 → номер «1.1.0» и признак беты */
export function splitVersion(v: string) {
  const [num, pre] = v.split('-')
  return { num, beta: !!pre }
}

const mb =(b: number) => t('{v} МБ', { v: Math.round(b / 2 ** 20) })

export function downloadText(u: UpdateState) {
  return u.total ? t('{v} из {v2}', { v: mb(u.transferred ?? 0), v2: mb(u.total) }) : `${u.percent ?? 0}%`
}
