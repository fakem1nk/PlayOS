import HID from 'node-hid'
import type { BatteryLevel } from '@shared/types'
import { XI } from './win32'

/**
 * DualSense и DualShock 4 не видны через XInput, поэтому читаем их напрямую по HID.
 * Чтение идёт в фоне и не мешает играм (устройство открывается в общем режиме),
 * так кнопка PS работает, даже когда в фокусе игра.
 */

export const HID_L2 = 0x10000
export const HID_R2 = 0x20000

type Kind = 'dualsense' | 'ds4'
const SONY = 0x054c
const MODELS: Record<number, Kind> = {
  0x0ce6: 'dualsense',
  0x0df2: 'dualsense', // DualSense Edge
  0x05c4: 'ds4',
  0x09cc: 'ds4',
  0x0ba0: 'ds4' // беспроводной адаптер DS4
}

interface Pad {
  dev: HID.HIDAsync
  kind: Kind
  bits: number
  battery: BatteryLevel | null
  percent?: number
  bt: boolean
}

const pads = new Map<string, Pad>()
let scanning = false

// Направление крестовины (hat): 0 — вверх, по часовой стрелке, 8 — не нажата
const HAT = [XI.UP, XI.UP | XI.RIGHT, XI.RIGHT, XI.DOWN | XI.RIGHT, XI.DOWN, XI.DOWN | XI.LEFT, XI.LEFT, XI.UP | XI.LEFT]

/** Где в отчёте стики, кнопки и батарея — зависит от модели и способа подключения. */
function layout(kind: Kind, b: Buffer) {
  if (kind === 'dualsense') {
    if (b[0] === 0x01 && b.length >= 54) return { stick: 1, btn: 8, battery: 53 } // USB
    if (b[0] === 0x31 && b.length >= 55) return { stick: 2, btn: 9, battery: 54 } // Bluetooth (полный отчёт)
    if (b[0] === 0x01) return { stick: 1, btn: 5, battery: -1 } // Bluetooth (упрощённый отчёт)
  } else {
    if (b[0] === 0x01 && b.length >= 31) return { stick: 1, btn: 5, battery: 30 } // USB
    if (b[0] === 0x11 && b.length >= 33) return { stick: 3, btn: 7, battery: 32 } // Bluetooth
    if (b[0] === 0x01) return { stick: 1, btn: 5, battery: -1 }
  }
  return null
}

function parse(pad: Pad, b: Buffer) {
  const l = layout(pad.kind, b)
  if (!l) return
  pad.bt = l.battery < 0 || b[0] === 0x31 || b[0] === 0x11
  const b0 = b[l.btn]
  const b1 = b[l.btn + 1]
  const b2 = b[l.btn + 2]
  let bits = HAT[b0 & 0x0f] ?? 0
  if (b0 & 0x10) bits |= XI.X // квадрат
  if (b0 & 0x20) bits |= XI.A // крест
  if (b0 & 0x40) bits |= XI.B // круг
  if (b0 & 0x80) bits |= XI.Y // треугольник
  if (b1 & 0x01) bits |= XI.LB
  if (b1 & 0x02) bits |= XI.RB
  if (b1 & 0x04) bits |= HID_L2
  if (b1 & 0x08) bits |= HID_R2
  if (b1 & 0x10) bits |= XI.BACK // Create / Share
  if (b1 & 0x20) bits |= XI.START // Options
  if (b2 & 0x01) bits |= XI.GUIDE // кнопка PS
  const lx = b[l.stick] - 128
  const ly = b[l.stick + 1] - 128
  if (ly < -64) bits |= XI.UP
  if (ly > 64) bits |= XI.DOWN
  if (lx < -64) bits |= XI.LEFT
  if (lx > 64) bits |= XI.RIGHT
  pad.bits = bits

  if (l.battery > 0) {
    const raw = b[l.battery]
    if (pad.kind === 'dualsense') {
      const level = raw & 0x0f // 0..10
      const status = raw >> 4 // 0 — разряжается, 1 — заряжается, 2 — полный
      pad.battery = status === 1 || status === 2 ? 'wired' : level >= 7 ? 'full' : level >= 4 ? 'medium' : level >= 1 ? 'low' : 'empty'
      pad.percent = Math.min(100, level * 10)
    } else {
      const level = raw & 0x0f
      pad.battery = raw & 0x10 ? 'wired' : level >= 7 ? 'full' : level >= 4 ? 'medium' : level >= 1 ? 'low' : 'empty'
      pad.percent = Math.min(100, level * 10)
    }
  }
}

async function scan() {
  if (scanning) return
  scanning = true
  try {
    const devices = await HID.devicesAsync()
    for (const d of devices) {
      const kind = d.vendorId === SONY ? MODELS[d.productId] : undefined
      if (!kind || !d.path || d.usagePage !== 1 || d.usage !== 5 || pads.has(d.path)) continue
      try {
        const dev = await HID.HIDAsync.open(d.path, { nonExclusive: true })
        const pad: Pad = { dev, kind, bits: 0, battery: null, bt: false }
        const path = d.path
        pads.set(path, pad)
        dev.on('data', (buf: Buffer) => parse(pad, buf))
        dev.on('error', () => {
          pads.delete(path)
          dev.close().catch(() => {})
        })
      } catch {
        /* устройство занято или отключилось — попробуем при следующем сканировании */
      }
    }
  } catch {
    /* HID недоступен */
  } finally {
    scanning = false
  }
}

/**
 * Перебор HID-устройств дорогой: в некоторых играх он даёт микрофризы. Поэтому сканируем по событию
 * Windows «устройства изменились» (rescanHid), а по таймеру — редко и только когда игра не запущена.
 */
export function startHid(gameRunning: () => boolean) {
  void scan()
  setInterval(() => !gameRunning() && void scan(), 30_000)
}

let rescanTimer: NodeJS.Timeout | null = null
/** Подключили или отключили устройство: Windows шлёт пачку событий, сканируем один раз после неё */
export function rescanHid() {
  if (rescanTimer) clearTimeout(rescanTimer)
  rescanTimer = setTimeout(() => {
    rescanTimer = null
    void scan()
  }, 700)
}

export function hidPads(): { key: string; bits: number }[] {
  return [...pads.entries()].map(([key, p]) => ({ key, bits: p.bits }))
}

export function hidStatus(): { connected: number; battery: BatteryLevel | null; percent?: number } {
  const p = [...pads.values()].find((x) => x.battery)
  return { connected: pads.size, battery: p?.battery ?? null, percent: p?.percent }
}

/** Подробно по каждому геймпаду — для списка в пункте управления */
export function hidControllers() {
  return [...pads.entries()].map(([key, p]) => ({ key, kind: p.kind, battery: p.battery, percent: p.percent, bt: p.bt }))
}
