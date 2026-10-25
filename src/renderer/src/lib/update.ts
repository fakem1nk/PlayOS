import { useSyncExternalStore } from 'react'
import type { UpdateState } from '@shared/types'
import { api } from './api'
import { t } from '@shared/i18n'

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

const mb = (b: number) => t('{v} МБ', { v: Math.round(b / 2 ** 20) })

export function downloadText(u: UpdateState) {
  return u.total ? t('{v} из {v2}', { v: mb(u.transferred ?? 0), v2: mb(u.total) }) : `${u.percent ?? 0}%`
}
