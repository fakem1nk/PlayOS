import type { ScriptName } from './tivi-faces'

/**
 * Тиви — маскот в правом нижнем углу. Шина реакций: звуки интерфейса и уведомления
 * сообщают сюда, что произошло, компонент `Tivi` проигрывает сценку. Подписчиков нет (окно оверлея) — ничего не делает.
 * Убрать маскота: удалить этот файл, `tivi-faces.ts`, `components/Tivi.tsx`, `styles-tivi.css` и строки с `tivi` в sound.ts, state.ts, App.tsx.
 */

export interface TiviReaction {
  act: ScriptName
  /** Сколько крутить петлю сценки (у сценок без петли не нужно) */
  ms?: number
  /** Важная реакция (трофей, ошибка) не перебивается мелкой; 0 — Тиви занят сам собой */
  priority?: number
}

type Listener = (r: TiviReaction) => void
const listeners = new Set<Listener>()

export function onTivi(cb: Listener) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function tivi(r: TiviReaction) {
  listeners.forEach((l) => l(r))
}

let errorAt = -Infinity
/** Ошибка: грустит, а если они сыплются одна за другой — плачет. Звук и уведомление одной ошибки считаются за одну */
function sorrow(ms: number) {
  const since = performance.now() - errorAt
  if (since < 600) return
  errorAt = performance.now()
  tivi(since < 15_000 ? { act: 'cry', ms: ms + 600, priority: 4 } : { act: 'sad', ms, priority: 4 })
}

/** Реакция на звук интерфейса — только на события системы; на шаги и нажатия Тиви отвечает взглядом за фокусом */
export function tiviSound(kind: string) {
  if (!listeners.size) return
  switch (kind) {
    case 'launch':
      return tivi({ act: 'sparkle', ms: 1400, priority: 3 })
    case 'error':
      return sorrow(2200)
    case 'trophy':
      return tivi({ act: 'love', ms: 3200, priority: 4 })
    case 'farewell':
    case 'shutdown':
      return tivi({ act: 'off', priority: 5 })
  }
}

/**
 * Реакция на уведомление: ошибки, успехи, трофеи и обновления приходят и из main. Обычное уведомление, которое
 * попадёт в центр уведомлений, — уши мигают; ответы на действия пользователя (history: false) он пропускает
 */
export function tiviToast(n: { tone?: string; kind?: string; history?: false }) {
  if (!listeners.size) return
  if (n.kind === 'trophy') return tivi({ act: 'love', ms: 3200, priority: 4 })
  if (n.kind === 'update') return tivi({ act: 'news', ms: 1600, priority: 3 })
  if (n.tone === 'error') return sorrow(2200)
  if (n.tone === 'success') return tivi({ act: 'happy', priority: 2 })
  if (n.history !== false) tivi({ act: 'notice', priority: 2 })
}
