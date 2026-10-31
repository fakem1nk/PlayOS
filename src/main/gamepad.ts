import type { PadAction, PadDir } from '@shared/types'
import { REPEAT_DELAY, repeatInterval, stickDir } from '@shared/pad'
import { HID_L2, HID_R2, hidPads } from './hid'
import { readPad, XI } from './win32'

/**
 * Фоновый опрос геймпадов в main-процессе: XInput (Xbox и всё, что им притворяется)
 * плюс DualSense/DualShock 4 по HID. Работает, даже когда окно лаунчера не в фокусе:
 * ловит вызов оверлея (PS / Guide / удержание Select+Start) и при необходимости
 * пересылает навигацию в интерфейс.
 */

const COMBO_MS = 600
// Один и тот же DualSense может прийти и по HID, и через Steam Input как XInput —
// не даём одному нажатию открыть и тут же закрыть оверлей
const HOTKEY_DEBOUNCE = 450

const BUTTON_ACTIONS: [number, PadAction][] = [
  [XI.UP, 'up'],
  [XI.DOWN, 'down'],
  [XI.LEFT, 'left'],
  [XI.RIGHT, 'right'],
  [XI.A, 'confirm'],
  [XI.B, 'back'],
  [XI.Y, 'menu'],
  [XI.X, 'search'],
  [XI.START, 'options'],
  [XI.LB, 'l1'],
  [XI.RB, 'r1'],
  [HID_L2, 'l2'],
  [HID_R2, 'r2']
]
const DIRECTIONS = XI.UP | XI.DOWN | XI.LEFT | XI.RIGHT
const STICK_BITS: Record<PadDir, number> = { up: XI.UP, down: XI.DOWN, left: XI.LEFT, right: XI.RIGHT }

interface Options {
  /** PS / Guide или удержание View+Menu (Select+Start) */
  onHotkey: () => void
  onNav: (a: PadAction) => void
  shouldForward: () => boolean
}

interface SlotState {
  prev: number
  comboSince: number
  comboFired: boolean
  stick: PadDir | null
}

export function startGamepad({ onHotkey, onNav, shouldForward }: Options) {
  const slots = new Map<string, SlotState>()
  const held = new Map<string, { since: number; last: number }>()
  let lastHotkey = 0

  const hotkey = (now: number) => {
    if (now - lastHotkey < HOTKEY_DEBOUNCE) return
    lastHotkey = now
    onHotkey()
  }

  /** x, y — левый стик от −1 до 1 (вниз — плюс): направление считается так же, как в интерфейсе */
  const handle = (key: string, b: number, x: number, y: number, now: number) => {
    let s = slots.get(key)
    if (!s) slots.set(key, (s = { prev: 0, comboSince: 0, comboFired: false, stick: null }))
    s.stick = stickDir(x, y, s.stick)
    if (s.stick) b |= STICK_BITS[s.stick]
    const pressed = b & ~s.prev
    s.prev = b

    if (pressed & XI.GUIDE) hotkey(now)

    const combo = (b & XI.BACK) !== 0 && (b & XI.START) !== 0
    if (combo) {
      if (!s.comboSince) s.comboSince = now
      if (!s.comboFired && now - s.comboSince > COMBO_MS) {
        s.comboFired = true
        hotkey(now)
      }
      return
    }
    s.comboSince = 0
    s.comboFired = false

    if (!shouldForward()) return
    for (const [bit, action] of BUTTON_ACTIONS) {
      const id = `${key}:${bit}`
      if (pressed & bit) {
        onNav(action)
        held.set(id, { since: now, last: now })
      } else if (b & bit & DIRECTIONS) {
        const h = held.get(id)
        if (h && now - h.since > REPEAT_DELAY && now - h.last > repeatInterval(now - h.since)) {
          h.last = now
          onNav(action)
        }
      } else {
        held.delete(id)
      }
    }
  }

  return setInterval(() => {
    const now = Date.now()
    for (let i = 0; i < 4; i++) {
      const st = readPad(i)
      if (!st) {
        slots.delete(`x${i}`)
        continue
      }
      let b = st.buttons
      if (st.lt > 128) b |= HID_L2
      if (st.rt > 128) b |= HID_R2
      // У XInput вверх — плюс: переворачиваем, как в Gamepad API
      handle(`x${i}`, b, st.lx / 32768, -st.ly / 32768, now)
    }
    for (const p of hidPads()) handle(p.key, p.bits, p.x, p.y, now)
  }, 16)
}
