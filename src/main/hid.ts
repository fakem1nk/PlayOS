import HID from 'node-hid'
import { crc32 } from 'node:zlib'
import type { BatteryLevel, RumbleEffect } from '@shared/types'
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
  x: number
  y: number
  battery: BatteryLevel | null
  percent?: number
  bt: boolean
  /** DualSense по Bluetooth шлёт полный отчёт 0x31 (режим включили Steam или DSX) */
  full: boolean
  /** Когда последний раз нажимали кнопки — вибрирует тот, которым управляют */
  lastInput: number
  /** Вибрация v2 (прошивка 2.21+): null — ещё не узнали */
  v2: boolean | null
  seq: number
  stopTimer?: NodeJS.Timeout
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
  pad.full = b[0] === 0x31
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
  // Левый стик: −1…1, вниз — плюс. В направление его превращает gamepad.ts — так же, как в интерфейсе
  pad.x = (b[l.stick] - 128) / 128
  pad.y = (b[l.stick + 1] - 128) / 128
  if (bits !== pad.bits || Math.abs(pad.x) > 0.5 || Math.abs(pad.y) > 0.5) pad.lastInput = Date.now()
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
        const pad: Pad = { dev, kind, bits: 0, x: 0, y: 0, battery: null, bt: false, full: false, lastInput: 0, v2: null, seq: 0 }
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

/**
 * Вибрация DualSense. Chromium её не умеет (Gamepad API вибрирует только Xbox и DualShock 4), поэтому отчёт пишем сами:
 * моторы в режиме совместимости, как у DualShock 4. Флаги подсветки и звука не ставим — их не трогаем (DSX тоже).
 * По Bluetooth — только в полном режиме (его включают Steam или DSX): наш отчёт сам переключил бы геймпад туда,
 * и Windows с Chromium перестали бы видеть его кнопки.
 */
export function rumbleDualSense(fx: RumbleEffect) {
  const now = Date.now()
  // Тот DualSense, которым управляют прямо сейчас; если играют на Xbox, DualSense на столе не дрожит
  const pad = [...pads.values()]
    .filter((p) => p.kind === 'dualsense' && (!p.bt || p.full) && now - p.lastInput < 3000)
    .sort((a, b) => b.lastInput - a.lastInput)[0]
  if (!pad) return
  void (async () => {
    if (pad.v2 === null) pad.v2 = await vibrationV2(pad)
    write(pad, fx.strong, fx.weak)
    clearTimeout(pad.stopTimer)
    // Моторы в режиме совместимости крутятся, пока их не остановят
    pad.stopTimer = setTimeout(() => write(pad, 0, 0), fx.duration)
  })()
}

/** Версия прошивки из отчёта 0x20: с 2.21 вибрация совместимости включается другим флагом */
async function vibrationV2(pad: Pad) {
  try {
    const f = await pad.dev.getFeatureReport(0x20, 64)
    return (f[44] | (f[45] << 8)) >= 0x0215
  } catch {
    return true
  }
}

function write(pad: Pad, strong: number, weak: number) {
  // Общая часть отчёта (47 байт): флаги, правый (слабый) и левый (сильный) моторы, остальное не трогаем
  const common = Buffer.alloc(47)
  common[0] = 0x02 // моторы вместо звуковой вибрации
  if (pad.v2) common[38] = 0x04
  else common[0] |= 0x01
  common[2] = Math.round(Math.min(1, weak) * 255)
  common[3] = Math.round(Math.min(1, strong) * 255)
  let buf: Buffer
  if (!pad.bt) buf = Buffer.concat([Buffer.from([0x02]), common, Buffer.alloc(15)])
  else {
    buf = Buffer.alloc(78)
    buf[0] = 0x31
    buf[1] = pad.seq << 4
    pad.seq = (pad.seq + 1) & 0x0f
    buf[2] = 0x10
    common.copy(buf, 3)
    buf.writeUInt32LE(crc32(Buffer.concat([Buffer.from([0xa2]), buf.subarray(0, 74)])), 74)
  }
  pad.dev.write(buf).catch(() => {})
}

export function hidPads(): { key: string; bits: number; x: number; y: number }[] {
  return [...pads.entries()].map(([key, p]) => ({ key, bits: p.bits, x: p.x, y: p.y }))
}

export function hidStatus(): { connected: number; battery: BatteryLevel | null; percent?: number } {
  const p = [...pads.values()].find((x) => x.battery)
  return { connected: pads.size, battery: p?.battery ?? null, percent: p?.percent }
}

/** Подробно по каждому геймпаду — для списка в пункте управления */
export function hidControllers() {
  return [...pads.entries()].map(([key, p]) => ({ key, kind: p.kind, battery: p.battery, percent: p.percent, bt: p.bt }))
}
