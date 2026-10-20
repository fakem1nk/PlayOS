import { useIsPresent } from 'motion/react'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { PadAction } from '@shared/types'
import { api } from './api'
import { noteAction } from './sound'

/**
 * Единая система ввода: клавиатура, Gamepad API (когда окно в фокусе) и XInput из main-процесса
 * (когда меню открыто поверх игры без фокуса). Экраны подписываются «слоями» с приоритетом —
 * действие получает верхний активный слой; если он вернул false, действие уходит ниже.
 */

type Handler = (a: PadAction) => boolean | void
interface Layer {
  id: number
  priority: number
  handler: { current: Handler }
}

const layers: Layer[] = []
let nextId = 1

// ───────────── Активность пользователя (для заставки) ─────────────

let lastActivity = performance.now()
const activityListeners = new Set<() => void>()

/** Пользователь что-то нажал или подвигал мышью */
export function markActivity() {
  lastActivity = performance.now()
  activityListeners.forEach((l) => l())
}

export const idleFor = () => performance.now() - lastActivity

export function onActivity(cb: () => void) {
  activityListeners.add(cb)
  return () => {
    activityListeners.delete(cb)
  }
}

export function dispatch(a: PadAction) {
  markActivity()
  noteAction(a)
  const sorted = [...layers].sort((x, y) => y.priority - x.priority || y.id - x.id)
  for (const l of sorted) if (l.handler.current(a) !== false) return
}

export function useInputLayer(handler: Handler, priority: number, enabled = true) {
  const ref = useRef(handler)
  ref.current = handler
  // Компонент в фазе исчезающей анимации больше не должен перехватывать ввод
  const present = useIsPresent()
  const active = enabled && present
  useEffect(() => {
    if (!active) return
    const layer = { id: nextId++, priority, handler: ref }
    layers.push(layer)
    return () => {
      const i = layers.indexOf(layer)
      if (i >= 0) layers.splice(i, 1)
    }
  }, [active, priority])
}

// ───────────── Тип кнопок (PlayStation / Xbox) по подключённому геймпаду ─────────────

export type PadKind = 'playstation' | 'xbox'
let padKind: PadKind = 'playstation'
let padConnected = false
const padListeners = new Set<() => void>()
const emitPad = () => padListeners.forEach((l) => l())

function detectKind(id: string): PadKind {
  return /054c|dualsense|dualshock|wireless controller|playstation/i.test(id) ? 'playstation' : 'xbox'
}

export function usePadInfo() {
  return useSyncExternalStore(
    (cb) => {
      padListeners.add(cb)
      return () => padListeners.delete(cb)
    },
    () => (padConnected ? padKind : 'none') as PadKind | 'none'
  )
}

// ───────────── Клавиатура ─────────────

const KEYS: Record<string, PadAction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Enter: 'confirm',
  ' ': 'confirm',
  Escape: 'back',
  Backspace: 'back',
  q: 'l1',
  e: 'r1',
  PageUp: 'l1',
  PageDown: 'r1',
  m: 'menu',
  ContextMenu: 'menu',
  o: 'options',
  f: 'search',
  Home: 'home'
}

function onKey(e: KeyboardEvent) {
  // Enter, который «нажала» экранная клавиатура, — не навигация
  if (!e.isTrusted) return
  markActivity()
  const t = e.target as HTMLElement
  const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'
  let a: PadAction | undefined = KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key]
  if (typing) {
    // В текстовом поле стрелки влево/вправо и буквы двигают курсор и печатают
    if (e.key === 'Enter') a = 'down'
    else if (e.key === 'Escape') t.blur()
    else if (!['ArrowUp', 'ArrowDown'].includes(e.key)) a = undefined
  }
  if (a) {
    e.preventDefault()
    dispatch(a)
  }
}

// ───────────── Gamepad API ─────────────

const BUTTONS: [number, PadAction][] = [
  [0, 'confirm'],
  [1, 'back'],
  [2, 'search'],
  [3, 'menu'],
  [4, 'l1'],
  [5, 'r1'],
  [6, 'l2'],
  [7, 'r2'],
  [9, 'options'],
  [12, 'up'],
  [13, 'down'],
  [14, 'left'],
  [15, 'right']
]
const DIRS = new Set<PadAction>(['up', 'down', 'left', 'right'])
const REPEAT_DELAY = 380
const repeatRate = (held: number) => (held > 1500 ? 55 : 105)

const prev = new Map<string, boolean>()
const holdStart = new Map<string, number>()
const lastFire = new Map<string, number>()

function pollPads() {
  requestAnimationFrame(pollPads)
  const pads = navigator.getGamepads?.() ?? []
  const any = pads.some(Boolean)
  if (any !== padConnected) {
    padConnected = any
    emitPad()
  }
  if (!document.hasFocus()) return
  const now = performance.now()
  for (const p of pads) {
    if (!p) continue
    const ax = p.axes[0] ?? 0
    const ay = p.axes[1] ?? 0
    for (const [index, action] of BUTTONS) {
      const btn = p.buttons[index]
      let down = !!btn && (btn.pressed || btn.value > 0.5)
      if (action === 'up') down ||= ay < -0.55
      if (action === 'down') down ||= ay > 0.55
      if (action === 'left') down ||= ax < -0.55
      if (action === 'right') down ||= ax > 0.55
      const key = `${p.index}:${index}`
      const was = prev.get(key) ?? false
      prev.set(key, down)
      if (down && !was) {
        const kind = detectKind(p.id)
        if (kind !== padKind) {
          padKind = kind
          emitPad()
        }
        holdStart.set(key, now)
        lastFire.set(key, now)
        dispatch(action)
      } else if (down && DIRS.has(action)) {
        const held = now - (holdStart.get(key) ?? now)
        if (held > REPEAT_DELAY && now - (lastFire.get(key) ?? 0) > repeatRate(held)) {
          lastFire.set(key, now)
          dispatch(action)
        }
      }
    }
  }
}

let started = false
export function startInput() {
  if (started) return
  started = true
  window.addEventListener('keydown', onKey)
  // Не даём пробелу «кликать» кнопку повторно на keyup — клик уже сделан через dispatch
  window.addEventListener('keyup', (e) => {
    const t = e.target as HTMLElement
    if (e.key === ' ' && t.tagName !== 'INPUT') e.preventDefault()
  })
  requestAnimationFrame(pollPads)
  for (const ev of ['mousemove', 'mousedown', 'wheel'] as const) window.addEventListener(ev, markActivity, { passive: true })
  api.onPad((a) => {
    if (a === 'home' || !document.hasFocus()) dispatch(a)
  })
}
