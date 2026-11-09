import { useIsPresent } from 'motion/react'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { PadAction, PadDir, PadInput, PadMaps } from '@shared/types'
import { REPEAT_DELAY, repeatInterval, stickDir } from '@shared/pad'
import { api } from './api'
import { noteAction } from './sound'
import { holdRumble, setRumblePad } from './haptics'
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
  opts: { current: LayerOptions }
}

export interface LayerOptions {
  /** Слой снова стал верхним после закрытия окна над ним — вернуть фокус */
  onResume?: () => void
  /** Кнопки, которые повторяются при удержании, пока слой верхний (стрелки повторяются всегда) */
  repeat?: PadAction[]
  /** Корень экрана: наведение мыши на его пункт переносит туда фокус, правый стик крутит его содержимое */
  root?: () => HTMLElement | null
}

const layers: Layer[] = []
let nextId = 1
const sortedLayers = () => [...layers].sort((x, y) => y.priority - x.priority || y.id - x.id)

/** Повторять ли действие при удержании кнопки */
const repeats = (a: PadAction) => DIRS.has(a) || !!sortedLayers()[0]?.opts.current.repeat?.includes(a)

/**
 * Слой ушёл (закрылось окно или меню) — верхний из слоёв, которые умеют возвращать фокус, возвращает его.
 * После всех эффектов кадра: экран под окном к этому времени уже снова включён
 */
let resumeQueued = false
function queueResume() {
  if (resumeQueued) return
  resumeQueued = true
  queueMicrotask(() => {
    resumeQueued = false
    sortedLayers()
      .find((l) => l.opts.current.onResume)
      ?.opts.current.onResume?.()
  })
}

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
  pointerTravel = 0
  clearTimeout(hoverTimer)
  markActivity()
  noteAction(a)
  for (const l of sortedLayers()) if (l.handler.current(a) !== false) return
}

// ───────────── Удержание ✕ ─────────────

/**
 * Удержание ✕ (Enter) на игре открывает её страницу. Пока хоть один экран это включил,
 * ✕ срабатывает на отпускании, а удержание дольше HOLD_MS вместо него отправляет 'hold'.
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

/** ✕ сейчас удерживают в зоне удержания — плитка в фокусе показывает, что скоро откроются параметры */
let holding = false
const holdListeners = new Set<() => void>()
function setHolding(v: boolean) {
  if (v === holding) return
  holding = v
  holdListeners.forEach((l) => l())
}
const syncHolding = () => setHolding(pendingHold.size > 0 || !!(keyHold && !keyHold.fired))

/** Длительность удержания ✕ до параметров — для анимации */
export const HOLD_DURATION = HOLD_MS

export function useHolding() {
  return useSyncExternalStore(
    (cb) => {
      holdListeners.add(cb)
      return () => holdListeners.delete(cb)
    },
    () => holding
  )
}

export function useInputLayer(handler: Handler, priority: number, enabled = true, options: LayerOptions = {}) {
  const ref = useRef(handler)
  ref.current = handler
  const opts = useRef(options)
  opts.current = options
  // Компонент в фазе исчезающей анимации больше не должен перехватывать ввод
  const present = useIsPresent()
  const active = enabled && present
  useEffect(() => {
    if (!active) return
    const layer = { id: nextId++, priority, handler: ref, opts }
    layers.push(layer)
    return () => {
      const i = layers.indexOf(layer)
      if (i >= 0) layers.splice(i, 1)
      queueResume()
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
/** Чем человек управляет прямо сейчас — подсказки внизу показывают клавиши, если клавиатурой или мышью */
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
  if (d === 'keyboard') setRumblePad(null)
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
  PageUp: 'l1',
  PageDown: 'r1',
  ContextMenu: 'menu',
  Home: 'home'
}

/** Буквы — по физической клавише: на русской раскладке Q печатает «й», а команда должна остаться той же */
const LETTERS: Record<string, PadAction> = {
  KeyQ: 'l1',
  KeyE: 'r1',
  KeyM: 'menu',
  KeyO: 'options',
  KeyF: 'search',
  KeyZ: 'l2',
  KeyC: 'r2',
  KeyN: 'view'
}

/** Действие клавиши. С Ctrl/Alt/Win буквы не команды: Ctrl+C не должен листать фильтры */
const keyAction = (e: KeyboardEvent): PadAction | undefined =>
  KEYS[e.key] ?? (e.ctrlKey || e.altKey || e.metaKey ? undefined : LETTERS[e.code])

function onKey(e: KeyboardEvent) {
  // Enter, который «нажала» экранная клавиатура, — не навигация
  if (!e.isTrusted) return
  markActivity()
  // Свой Tab у браузера уводит фокус куда угодно, даже на кнопки под открытым окном — навигация только своя
  if (e.key === 'Tab') {
    e.preventDefault()
    return
  }
  const t = e.target as HTMLElement
  // Поле в режиме ввода; не открытое поле ведёт себя как обычная кнопка (Enter его открывает)
  const typing = isTextInput(t) && isEditing(t)
  let a = keyAction(e)
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
  // Зажатый Enter/пробел: автоповтор — не новые нажатия. Иначе после удержания открылись параметры,
  // зона удержания пропала, и следующий повтор «нажимал» первый пункт меню — «Играть»
  if (a === 'confirm' && (e.repeat || (keyHold && e.key === keyHold.key))) {
    e.preventDefault()
    return
  }
  // Автоповтор системы — только для того, что и на геймпаде повторяется: зажатый Backspace не закрывает окно за окном
  if (a && e.repeat && !repeats(a)) {
    e.preventDefault()
    return
  }
  if (a === 'confirm' && holdZones > 0) {
    e.preventDefault()
    setDevice('keyboard')
    const hold = { key: e.key, fired: false, timer: setTimeout(() => {
      hold.fired = true
      syncHolding()
      dispatch('hold')
    }, HOLD_MS) }
    keyHold = hold
    syncHolding()
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
  syncHolding()
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
  [8, 'view'],
  [9, 'options'],
  [12, 'up'],
  [13, 'down'],
  [14, 'left'],
  [15, 'right']
]
const DIRS = new Set<PadAction>(['up', 'down', 'left', 'right'])
/** Направление левого стика по геймпадам (индекс → направление прошлого опроса) */
const sticks = new Map<number, PadDir | null>()
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

function actionDown(p: Gamepad, action: PadAction, index: number, stick: PadDir | null) {
  const map = padMaps[p.id]
  const mapped = map?.[action]
  let down = mapped ? inputDown(p, mapped) : !map ? inputDown(p, { b: index }) : false
  if (!DIRS.has(action)) return down
  // Левый стик и крестовина-«шапка» работают всегда, даже без настройки
  down ||= stick === action
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

/**
 * View / Share срабатывает на отпускании и только как одиночное нажатие: View+Menu — сочетание для оверлея,
 * и центр уведомлений не должен открываться в начале этого сочетания
 */
const VIEW_TAP_MS = 600
const viewHeld = new Map<number, { at: number; spoiled: boolean }>()

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
  /** Отклонение правого стика: самое сильное среди геймпадов, крутим один раз за кадр */
  let scroll = 0
  for (const p of pads) {
    if (!p) continue
    if (p.mapping !== 'standard' && !padMaps[p.id] && !announced.has(p.id)) {
      announced.add(p.id)
      onUnknownPad(p)
    }
    const stick = stickDir(p.axes[0] ?? 0, p.axes[1] ?? 0, sticks.get(p.index) ?? null)
    sticks.set(p.index, stick)
    if (muted) {
      for (const [index, action] of BUTTONS) prev.set(`${p.index}:${index}`, actionDown(p, action, index, stick))
      viewHeld.delete(p.index)
      if (pendingHold.size) holdRumble('cancel')
      pendingHold.clear()
      syncHolding()
      continue
    }
    if (capture) {
      pollCapture(p)
      continue
    }
    const v = stickScroll(p)
    if (Math.abs(v) > Math.abs(scroll)) scroll = v
    for (const [index, action] of BUTTONS) {
      const down = actionDown(p, action, index, stick)
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
        setRumblePad(p.index)
        holdStart.set(key, now)
        lastFire.set(key, now)
        const view = viewHeld.get(p.index)
        // Другая кнопка при зажатом View — это сочетание, а не нажатие View
        if (view && action !== 'view') view.spoiled = true
        if (action === 'view') viewHeld.set(p.index, { at: now, spoiled: false })
        else if (action === 'confirm' && holdZones > 0) {
          pendingHold.set(key, now)
          syncHolding()
          holdRumble('start', HOLD_MS)
        } else dispatch(action)
      } else if (action === 'view' && !down && was) {
        const view = viewHeld.get(p.index)
        viewHeld.delete(p.index)
        if (view && !view.spoiled && now - view.at < VIEW_TAP_MS) dispatch('view')
      } else if (pendingHold.has(key)) {
        // ✕ ждёт: отпустили быстро — обычное нажатие, держат дольше HOLD_MS — страница игры
        if (!down) {
          pendingHold.delete(key)
          syncHolding()
          holdRumble('cancel')
          dispatch('confirm')
        } else if (now - pendingHold.get(key)! >= HOLD_MS) {
          pendingHold.delete(key)
          syncHolding()
          holdRumble('done')
          dispatch('hold')
        }
      } else if (down && repeats(action)) {
        const held = now - (holdStart.get(key) ?? now)
        if (held > REPEAT_DELAY && now - (lastFire.get(key) ?? 0) > repeatInterval(held)) {
          lastFire.set(key, now)
          dispatch(action)
        }
      }
    }
  }
  scrollByStick(scroll, now)
}

/**
 * Вертикаль правого стика (вниз — плюс). У стандартной раскладки это ось 3; у DirectInput оси бывают любыми,
 * а ось курка в покое стоит на −1 и крутила бы без остановки — поэтому там только ось, назначенная в мастере
 */
function stickScroll(p: Gamepad) {
  const mapped = padMaps[p.id]?.scroll
  if (mapped && 'a' in mapped) return (p.axes[mapped.a] ?? 0) * mapped.d
  return p.mapping === 'standard' ? (p.axes[3] ?? 0) : 0
}

const SCROLL_DEAD = 0.2
/** rem в секунду при полном отклонении (экран — 108 rem): чуть больше экрана в секунду */
const SCROLL_SPEED = 130
/** Что крутим, пока стик отклонён: ищем один раз за отклонение, а не каждый кадр (поиск трогает стили всего экрана) */
let scrollBox: HTMLElement | null | undefined
let scrollAt = 0

/** Правый стик: плавная прокрутка длинного содержимого — описание, трофеи, раздел настроек */
function scrollByStick(v: number, now: number) {
  if (Math.abs(v) < SCROLL_DEAD) {
    scrollBox = undefined
    scrollAt = 0
    return
  }
  if (scrollBox === undefined || (scrollBox && !scrollBox.isConnected)) scrollBox = scrollTarget()
  // По времени кадра, а не по кадрам: на мониторе 144 Гц скорость та же, что на 60 Гц
  const dt = scrollAt ? Math.min(50, now - scrollAt) : 16
  scrollAt = now
  if (!scrollBox) return
  const k = (Math.abs(v) - SCROLL_DEAD) / (1 - SCROLL_DEAD)
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize)
  // instant: плавная прокрутка из CSS начинала бы анимацию заново каждый кадр и отставала
  scrollBox.scrollBy({ top: (Math.sign(v) * k * k * rem * SCROLL_SPEED * dt) / 1000, behavior: 'instant' })
}

const scrollable = (el: HTMLElement) => {
  const { overflowY } = getComputedStyle(el)
  return (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1
}

/** Что крутить: ближайший прокручиваемый блок вокруг фокуса, иначе первый такой в верхнем экране */
function scrollTarget() {
  for (let p = document.activeElement as HTMLElement | null; p && p !== document.body; p = p.parentElement) if (scrollable(p)) return p
  const root = sortedLayers()[0]?.opts.current.root?.()
  if (!root) return null
  if (scrollable(root)) return root
  return [...root.querySelectorAll<HTMLElement>('*')].find(scrollable) ?? null
}

/**
 * Мышь и геймпад — один фокус: курсор, остановившийся на пункте верхнего экрана, переносит на него фокус.
 * С задержкой: пока мышь едет через список разделов к панели, разделы не переключаются на каждом пункте по пути.
 * И только после заметного движения мышью: случайно задетая мышь не уводит фокус, пока играют геймпадом
 */
const HOVER_MS = 90
const HOVER_TRAVEL = 8
let pointerTravel = 0
let hoverTimer: ReturnType<typeof setTimeout> | undefined
let pointerAt: { x: number; y: number } | null = null

function onPointerMove(e: PointerEvent) {
  if (e.pointerType !== 'mouse') return
  // Сдвиг считаем по координатам курсора: при прокрутке под неподвижным курсором они не меняются — это не наведение.
  // movementX ненадёжен: в удалённом рабочем столе и виртуальных машинах бывает нулевым и при настоящем движении
  const moved = pointerAt ? Math.abs(e.clientX - pointerAt.x) + Math.abs(e.clientY - pointerAt.y) : 0
  pointerAt = { x: e.clientX, y: e.clientY }
  if (!moved) return
  pointerTravel += moved
  if (pointerTravel < HOVER_TRAVEL) return
  // Мышь в деле — значки клавиатуры, как и при нажатии клавиш
  setDevice('keyboard')
  clearTimeout(hoverTimer)
  const target = e.target as HTMLElement
  hoverTimer = setTimeout(() => focusHovered(target), HOVER_MS)
}

function focusHovered(target: HTMLElement) {
  const el = target.closest?.<HTMLElement>('[data-nav]')
  const cur = document.activeElement as HTMLElement | null
  // data-no-hover — пункт, у которого фокус что-то переключает (разделы настроек): мышь выбирает его только кликом
  if (!el || el === cur || !el.isConnected || el.hasAttribute('disabled') || el.hasAttribute('data-no-hover')) return
  if (cur && isTextInput(cur) && isEditing(cur)) return
  const root = sortedLayers()[0]?.opts.current.root?.()
  if (root?.contains(el)) el.focus({ preventScroll: true })
}

// ───────────── Боковые кнопки мыши ─────────────

/** «Назад» — как ○, «вперёд» — 'forward'. В поле ввода «назад» — как Esc: сохранить и закрыть поле */
function onMouseSide(e: MouseEvent) {
  if (e.button !== 3 && e.button !== 4) return
  // Сам Chromium листал бы по ним историю окна, а в ней бывает пустая страница интерфейса, выгруженного на время игры
  e.preventDefault()
  if (e.type !== 'mouseup') return
  const t = document.activeElement as HTMLElement | null
  if (t && isTextInput(t) && isEditing(t)) {
    if (e.button === 3) {
      t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
      endEdit(t)
    }
    return
  }
  dispatch(e.button === 3 ? 'back' : 'forward')
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
  window.addEventListener('mousedown', onMouseSide)
  window.addEventListener('mouseup', onMouseSide)
  requestAnimationFrame(pollPads)
  window.addEventListener('pointermove', onPointerMove, { passive: true })
  // Клик и колесо — тоже мышь: значки клавиатуры (касание экрана не в счёт)
  window.addEventListener('pointerdown', (e) => e.pointerType === 'mouse' && setDevice('keyboard'), { passive: true })
  window.addEventListener('wheel', () => setDevice('keyboard'), { passive: true })
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
