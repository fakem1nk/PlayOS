import { useIsPresent } from 'motion/react'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { PadAction, PadDir, PadInput, PadMaps } from '@shared/types'
import { api } from './api'
import { noteAction } from './sound'
import { beginEdit, endEdit, isEditing, isTextInput } from './osk'

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

// ───────────── Удержание ✕ ─────────────

/**
 * Удержание ✕ (Enter) на игре открывает её параметры — как △. Пока хоть один экран это включил,
 * ✕ срабатывает на отпускании, а удержание дольше HOLD_MS вместо него отправляет 'menu'.
 */
let holdZones = 0
const HOLD_MS = 500
export function useConfirmHold(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    holdZones++
    return () => {
      holdZones--
    }
  }, [enabled])
}

/** Нажатый ✕, который ждёт отпускания или конца удержания: ключ кнопки → время нажатия */
const pendingHold = new Map<string, number>()

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

// ───────────── Тип кнопок по подключённому геймпаду и последнее устройство ввода ─────────────

/** Раскладка значков: PlayStation (✕ ○), Xbox (A B), Nintendo и 8BitDo (подписи B A — наоборот) */
export type PadKind = 'playstation' | 'xbox' | 'nintendo'
let padKind: PadKind = 'playstation'
let padConnected = false
/** Главный процесс запретил геймпад: идёт игра, а PlayOS не на переднем плане */
let padBlocked = false
/** Чем человек управляет прямо сейчас — подсказки внизу показывают клавиши, если клавиатурой */
let lastDevice: 'pad' | 'keyboard' = 'pad'
const padListeners = new Set<() => void>()
const emitPad = () => padListeners.forEach((l) => l())

export function detectKind(id: string): PadKind {
  if (/054c|dualsense|dualshock|wireless controller|playstation/i.test(id)) return 'playstation'
  // 8BitDo (2dc8) и Nintendo (057e) — подписи кнопок как на Switch, кроме режима XInput
  if (/057e|2dc8|nintendo|pro controller|joy-con|8bitdo/i.test(id) && !/xinput/i.test(id)) return 'nintendo'
  return 'xbox'
}

function subscribePad(cb: () => void) {
  padListeners.add(cb)
  return () => {
    padListeners.delete(cb)
  }
}

export function usePadInfo() {
  return useSyncExternalStore(subscribePad, () => (padConnected ? padKind : 'none') as PadKind | 'none')
}

/** Чем управляли последним: клавиатура открывает поле для ввода на месте, геймпад — экранную клавиатуру */
export const lastInputDevice = () => lastDevice

export function useLastDevice() {
  return useSyncExternalStore(subscribePad, () => lastDevice)
}

function setDevice(d: 'pad' | 'keyboard') {
  if (d === lastDevice) return
  lastDevice = d
  emitPad()
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
  z: 'l2',
  c: 'r2',
  Home: 'home'
}

function onKey(e: KeyboardEvent) {
  // Enter, который «нажала» экранная клавиатура, — не навигация
  if (!e.isTrusted) return
  markActivity()
  const t = e.target as HTMLElement
  // Поле в режиме ввода; не открытое поле ведёт себя как обычная кнопка (Enter его открывает)
  const typing = isTextInput(t) && isEditing(t)
  let a: PadAction | undefined = KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key]
  if (typing) {
    // Enter или Esc — сохранить и закрыть поле (Enter сначала получает само поле: поиск, сохранение)
    if (e.key === 'Enter' || e.key === 'Escape') {
      if (e.key === 'Escape') t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
      endEdit(t)
      e.preventDefault()
      return
    }
    // Стрелки влево/вправо и буквы двигают курсор и печатают; вверх/вниз уводят из поля
    if (!['ArrowUp', 'ArrowDown'].includes(e.key)) a = undefined
  }
  if (a === 'confirm' && holdZones > 0) {
    e.preventDefault()
    setDevice('keyboard')
    // Автоповтор клавиши — то же удержание
    if (e.repeat || keyHold) return
    const hold = { key: e.key, fired: false, timer: setTimeout(() => {
      hold.fired = true
      dispatch('menu')
    }, HOLD_MS) }
    keyHold = hold
    return
  }
  if (a) {
    e.preventDefault()
    setDevice('keyboard')
    dispatch(a)
  }
}

/** Enter/пробел, нажатые там, где включено удержание: срабатывают на отпускании */
let keyHold: { key: string; fired: boolean; timer: ReturnType<typeof setTimeout> } | null = null

function onKeyUp(e: KeyboardEvent) {
  if (!keyHold || e.key !== keyHold.key) return
  const hold = keyHold
  keyHold = null
  clearTimeout(hold.timer)
  if (!hold.fired) dispatch('confirm')
}

// ───────────── Gamepad API ─────────────

/** Стандартная раскладка Chromium: Xbox, DualSense, 8BitDo и всё, что Windows узнаёт */
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
/** Крестовина DirectInput (POV) приходит одной осью: −1…1 по кругу от «вверх», в покое больше 1 */
const HAT_AXIS = 9
const HAT_DIRS: Record<PadDir, number[]> = { up: [7, 0, 1], right: [1, 2, 3], down: [3, 4, 5], left: [5, 6, 7] }
const hatPos = (v: number) => (v > 1.05 || v < -1.05 ? -1 : Math.round(((v + 1) * 7) / 2))

/** Кнопки, назначенные вручную для геймпадов DirectInput: id геймпада → действие → вход */
let padMaps: PadMaps = {}
export function setPadMaps(m: PadMaps | undefined) {
  padMaps = m ?? {}
}

function inputDown(p: Gamepad, inp: PadInput) {
  if ('b' in inp) {
    const btn = p.buttons[inp.b]
    return !!btn && (btn.pressed || btn.value > 0.5)
  }
  if ('h' in inp) {
    const pos = hatPos(p.axes[inp.h] ?? 9)
    return pos >= 0 && HAT_DIRS[inp.dir].includes(pos)
  }
  const v = p.axes[inp.a] ?? 0
  return inp.d > 0 ? v > 0.5 : v < -0.5
}

function actionDown(p: Gamepad, action: PadAction, index: number) {
  const map = padMaps[p.id]
  const mapped = map?.[action]
  let down = mapped ? inputDown(p, mapped) : !map ? inputDown(p, { b: index }) : false
  if (!DIRS.has(action)) return down
  // Левый стик и крестовина-«шапка» работают всегда, даже без настройки
  const ax = p.axes[0] ?? 0
  const ay = p.axes[1] ?? 0
  if (action === 'up') down ||= ay < -0.55
  if (action === 'down') down ||= ay > 0.55
  if (action === 'left') down ||= ax < -0.55
  if (action === 'right') down ||= ax > 0.55
  if (p.mapping !== 'standard' && !mapped) down ||= inputDown(p, { h: HAT_AXIS, dir: action as PadDir })
  return down
}

// ── Настройка кнопок: опрос идёт, но нажатия уходят не в интерфейс, а в мастер ──

type Capture = (padId: string, input: PadInput) => void
let capture: Capture | null = null
const rest = new Map<string, number[]>()
const captured = new Set<string>()

/** Пока мастер настройки открыт, нажатия геймпада не управляют интерфейсом */
export function startCapture(cb: Capture) {
  capture = cb
  rest.clear()
  captured.clear()
  return () => {
    if (capture === cb) capture = null
  }
}

function pollCapture(p: Gamepad) {
  let base = rest.get(p.id)
  if (!base) rest.set(p.id, (base = [...p.axes]))
  p.buttons.forEach((btn, i) => {
    const key = `${p.id}|b${i}`
    const down = btn.pressed || btn.value > 0.5
    if (down && !captured.has(key)) {
      captured.add(key)
      capture?.(p.id, { b: i })
    } else if (!down) captured.delete(key)
  })
  p.axes.forEach((v, i) => {
    const key = `${p.id}|a${i}`
    const r = base![i] ?? 0
    let input: PadInput | null = null
    if (r > 1.05) {
      // Ось-«шапка»: в покое за пределами −1…1
      const pos = hatPos(v)
      const dir = (Object.keys(HAT_DIRS) as PadDir[]).find((d) => HAT_DIRS[d][1] === pos)
      if (dir) input = { h: i, dir }
    } else if (Math.abs(v - r) > 0.6 && Math.abs(v) > 0.5) input = { a: i, d: v > 0 ? 1 : -1 }
    if (input && !captured.has(key)) {
      captured.add(key)
      capture?.(p.id, input)
    } else if (!input) captured.delete(key)
  })
}

const prev = new Map<string, boolean>()
const holdStart = new Map<string, number>()
const lastFire = new Map<string, number>()
const announced = new Set<string>()
let onUnknownPad: (p: Gamepad) => void = () => {}
/** Подключили геймпад без стандартной раскладки (DirectInput) — сообщаем один раз за запуск */
export function setUnknownPadHandler(cb: (p: Gamepad) => void) {
  onUnknownPad = cb
}

function pollPads() {
  requestAnimationFrame(pollPads)
  const pads = navigator.getGamepads?.() ?? []
  const any = pads.some(Boolean)
  if (any !== padConnected) {
    padConnected = any
    emitPad()
  }
  // Без фокуса нажатия только запоминаем: удержанная кнопка не сработает, когда окно вернёт фокус
  const muted = padBlocked || !document.hasFocus()
  const now = performance.now()
  for (const p of pads) {
    if (!p) continue
    if (p.mapping !== 'standard' && !padMaps[p.id] && !announced.has(p.id)) {
      announced.add(p.id)
      onUnknownPad(p)
    }
    if (muted) {
      for (const [index, action] of BUTTONS) prev.set(`${p.index}:${index}`, actionDown(p, action, index))
      pendingHold.clear()
      continue
    }
    if (capture) {
      pollCapture(p)
      continue
    }
    for (const [index, action] of BUTTONS) {
      const down = actionDown(p, action, index)
      const key = `${p.index}:${index}`
      const was = prev.get(key) ?? false
      prev.set(key, down)
      if (down && !was) {
        const kind = detectKind(p.id)
        if (kind !== padKind) {
          padKind = kind
          emitPad()
        }
        setDevice('pad')
        holdStart.set(key, now)
        lastFire.set(key, now)
        if (action === 'confirm' && holdZones > 0) pendingHold.set(key, now)
        else dispatch(action)
      } else if (pendingHold.has(key)) {
        // ✕ ждёт: отпустили быстро — обычное нажатие, держат дольше HOLD_MS — параметры
        if (!down) {
          pendingHold.delete(key)
          dispatch('confirm')
        } else if (now - pendingHold.get(key)! >= HOLD_MS) {
          pendingHold.delete(key)
          dispatch('menu')
        }
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
  window.addEventListener('keyup', onKeyUp)
  // Не даём пробелу «кликать» кнопку повторно на keyup — клик уже сделан через dispatch
  window.addEventListener('keyup', (e) => {
    const t = e.target as HTMLElement
    if (e.key === ' ' && t.tagName !== 'INPUT') e.preventDefault()
  })
  // Текстовые поля открываются для ввода только явно: при фокусе — только чтение, клик мышью открывает
  window.addEventListener('focusin', (e) => {
    const t = e.target as HTMLElement
    if (isTextInput(t) && !isEditing(t)) t.readOnly = true
  })
  window.addEventListener('focusout', (e) => {
    const t = e.target as HTMLElement
    if (isTextInput(t) && isEditing(t)) endEdit(t)
  })
  window.addEventListener('mousedown', (e) => {
    const t = e.target as HTMLElement
    if (isTextInput(t) && !t.disabled) beginEdit(t)
  })
  requestAnimationFrame(pollPads)
  for (const ev of ['mousemove', 'mousedown', 'wheel'] as const) window.addEventListener(ev, markActivity, { passive: true })
  api.onPadBlock((b) => {
    padBlocked = b
  })
  api.onPad((a) => {
    if (a === 'home' || !document.hasFocus()) {
      setDevice('pad')
      dispatch(a)
    }
  })
}
