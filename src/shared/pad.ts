import type { PadDir } from './types'

/**
 * Левый стик как крестовина — одинаково в интерфейсе (Gamepad API) и в main (XInput, HID поверх игры).
 * Направление одно — по главной оси, поэтому наклон по диагонали не делает два шага сразу.
 * Нажатие с 0.5, отпускание ниже 0.35: стик у порога не «дребезжит» повторными нажатиями.
 */
const PRESS = 0.5
const RELEASE = 0.35
/** Текущее направление держится, пока боковая составляющая не перевесит заметно (наклон дальше ~55°) */
const KEEP = 1.4

/** x и y от −1 до 1, вниз — положительный y (как в Gamepad API). was — направление в прошлом опросе */
export function stickDir(x: number, y: number, was: PadDir | null): PadDir | null {
  if (was) {
    const along = was === 'right' ? x : was === 'left' ? -x : was === 'down' ? y : -y
    const across = was === 'left' || was === 'right' ? Math.abs(y) : Math.abs(x)
    if (along > RELEASE && across < along * KEEP) return was
  }
  if (Math.hypot(x, y) < PRESS) return null
  return Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : y > 0 ? 'down' : 'up'
}

/** Повтор при удержании: пауза, потом шаги плавно ускоряются от 140 до 45 мс за 1,2 секунды — без ступеньки */
export const REPEAT_DELAY = 300
const REPEAT_SLOW = 140
const REPEAT_FAST = 45
const REPEAT_RAMP = 1200
/** held — сколько кнопку держат с момента нажатия */
export function repeatInterval(held: number) {
  const k = Math.min(1, Math.max(0, (held - REPEAT_DELAY) / REPEAT_RAMP))
  // Плавный разгон: медленно в начале (легко остановиться на нужном пункте), быстро к концу
  return REPEAT_SLOW - (REPEAT_SLOW - REPEAT_FAST) * k * k * (3 - 2 * k)
}
