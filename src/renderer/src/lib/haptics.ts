import { api } from './api'

/**
 * Лёгкая вибрация в меню — подтверждение для руки, что нажатие сработало (Gamepad API: Xbox, DualSense, DS4).
 * Включается настройкой «Вибрация в меню». Вибрирует только геймпад, которым сейчас управляют:
 * с клавиатуры и мыши вибрации нет.
 */

type Kind = 'bump' | 'hold' | 'open'

/** Короткие, но ощутимые: упёрся в край — дрожь, удержание ✕ — толчок, открылось меню — щелчок */
const EFFECTS: Record<Kind, GamepadEffectParameters> = {
  bump: { duration: 60, strongMagnitude: 0.1, weakMagnitude: 1 },
  hold: { duration: 90, strongMagnitude: 0.65, weakMagnitude: 0.4 },
  open: { duration: 45, strongMagnitude: 0.15, weakMagnitude: 0.55 }
}

let enabled = false
/** Индекс геймпада, нажатого последним; null — управляют клавиатурой */
let padIndex: number | null = null
let lastHold = 0

export function setHaptics(v: boolean) {
  enabled = v
}

export function setRumblePad(index: number | null) {
  padIndex = index
}

export function rumble(kind: Kind, force = false) {
  if ((!enabled && !force) || padIndex === null) return
  const now = performance.now()
  // Удержание ✕ само открывает меню — второй толчок следом не нужен
  if (kind === 'open' && now - lastHold < 250) return
  if (kind === 'hold') lastHold = now
  send(EFFECTS[kind])
}

/** Нагнетание при удержании ✕: начинается не сразу — быстрое нажатие (запуск игры) не жужжит */
const RAMP_WAIT = 50
const RAMP_STEP = 50
let ramp: ReturnType<typeof setInterval> | null = null
let rampPlaying = false

/**
 * Удержание ✕ на игре: вибрация нарастает вместе с кольцом вокруг кнопки и кончается толчком,
 * когда открываются параметры. Отпустили раньше — сразу тишина.
 */
export function holdRumble(phase: 'start' | 'cancel' | 'done', holdMs = 0) {
  if (ramp) clearInterval(ramp)
  ramp = null
  if (phase === 'done') return rumble('hold')
  if (phase === 'cancel') {
    // Моторы останавливаем, только если нагнетание уже успело начаться
    if (rampPlaying) send(null)
    rampPlaying = false
    return
  }
  rampPlaying = false
  if (!enabled || padIndex === null) return
  const t0 = performance.now()
  ramp = setInterval(() => {
    const t = performance.now() - t0
    if (t < RAMP_WAIT) return
    rampPlaying = true
    const k = Math.min(1, (t - RAMP_WAIT) / (holdMs - RAMP_WAIT))
    // Малый мотор — ровно растущая дрожь, большой подключается к концу: гул нарастает к толчку
    send({ duration: RAMP_STEP + 40, strongMagnitude: 0.5 * k * k, weakMagnitude: 0.1 + 0.4 * k })
  }, RAMP_STEP)
}

/** null — остановить моторы */
function send(fx: GamepadEffectParameters | null) {
  if (padIndex === null) return
  // DualSense вибрирует через main по HID: Chromium его моторы не умеет. Main сам проверит, что управляют именно им, —
  // так работает и когда Steam или DSX показывают его системе как геймпад Xbox
  api.padRumble(fx ? { duration: fx.duration ?? 0, strong: fx.strongMagnitude ?? 0, weak: fx.weakMagnitude ?? 0 } : { duration: 0, strong: 0, weak: 0 })
  const pad = navigator.getGamepads?.()[padIndex]
  if (!pad || isDualSense(pad.id)) return
  if (fx) pad.vibrationActuator?.playEffect('dual-rumble', fx).catch(() => {})
  else pad.vibrationActuator?.reset().catch(() => {})
}

const isDualSense = (id: string) => /054c/i.test(id) && /0ce6|0df2|dualsense/i.test(id)
