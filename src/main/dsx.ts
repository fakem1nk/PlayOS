import dgram from 'node:dgram'
import type { BatteryLevel } from '@shared/types'

/**
 * DSX (DualSenseX) держит DualSense у себя и отдаёт его состояние по UDP (127.0.0.1:6969).
 * Пакет с пустой командой ничего не меняет на геймпаде, а в ответ приходит статус:
 * подключён ли контроллер, заряд в процентах и список устройств.
 */

const PORT = 6969
// GetDSXStatus — ничего не меняет на геймпаде, DSX отвечает статусом
const PROBE = Buffer.from(JSON.stringify({ instructions: [{ type: 0, parameters: [0] }] }))

export interface DsxStatus {
  connected: boolean
  battery: BatteryLevel | null
  percent?: number
  connection?: string
}

type Json = Record<string, unknown>
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

function levelOf(percent: number, charging: boolean): BatteryLevel {
  if (charging) return 'wired'
  return percent >= 70 ? 'full' : percent >= 35 ? 'medium' : percent >= 10 ? 'low' : 'empty'
}

function parse(text: string): DsxStatus | null {
  let j: Json
  try {
    j = JSON.parse(text) as Json
  } catch {
    return null
  }
  const devices = Array.isArray(j.Devices) ? (j.Devices as Json[]) : []
  const dev = devices[0] ?? {}
  const connected = j.isControllerConnected === true || devices.length > 0
  if (!connected) return { connected: false, battery: null }
  const percent = num(dev.BatteryLevel) ?? num(j.BatteryLevel)
  const connection = String(dev.ConnectionType ?? dev.Connection ?? '')
  const charging = dev.IsCharging === true || dev.Charging === true || /usb/i.test(connection)
  return {
    connected,
    percent,
    connection: connection || undefined,
    battery: percent === undefined ? (charging ? 'wired' : null) : levelOf(percent, charging)
  }
}

let status: DsxStatus | null = null
let answeredAt = 0
let sock: dgram.Socket | null = null

function socket() {
  if (sock) return sock
  sock = dgram.createSocket('udp4')
  sock.on('message', (m) => {
    answeredAt = Date.now()
    const wasConnected = !!status?.connected
    status = parse(m.toString())
    // Геймпад только что подключился — сразу возвращаем ему цвет игры
    if (!wasConnected && status?.connected) reassert()
  })
  sock.on('error', () => {
    sock?.close()
    sock = null
  })
  return sock
}

function poll() {
  const sentAt = Date.now()
  socket().send(PROBE, PORT, '127.0.0.1', () => {})
  reassert()
  // Не ответил за секунду — DSX не запущен
  setTimeout(() => {
    if (answeredAt < sentAt) status = null
  }, 1000)
}

export function startDsx() {
  poll()
  setInterval(poll, 5000)
}

/** Статус от DSX или null, если DSX не запущен */
export const dsxStatus = () => status

// ───────────────────────── Подсветка DualSense ─────────────────────────
//
// Формат команд взят из DSX v3 (DSX.ModificationSystem): { instructions: [{ type, parameters }] },
// у RGBUpdate параметры [индекс геймпада, R, G, B, яркость 0–255]. DSX хранит цвет мода, пока
// не придёт ResetToUserSettings или минуту не будет пакетов, — опрос раз в 5 с держит его живым.

type RGB = [number, number, number]

const RGB_UPDATE = 2
const RESET_TO_USER = 7

/** Цвет, который держим, пока идёт игра (null — подсветкой управляет DSX) */
let held: RGB | null = null
/** Идёт эффект (вспышка, пульсация) — периодическое обновление его не перебивает */
let effectToken = 0
let effectActive = false

function sendInstructions(instructions: { type: number; parameters: number[] }[]) {
  socket().send(Buffer.from(JSON.stringify({ instructions })), PORT, '127.0.0.1', () => {})
}

function writeColor([r, g, b]: RGB, alpha = 255) {
  sendInstructions([{ type: RGB_UPDATE, parameters: [0, r, g, b, Math.round(Math.max(0, Math.min(255, alpha)))] }])
}

/** Есть ли кому отправлять команды подсветки */
export const lightbarReady = () => !!status?.connected

/** Держать цвет световой панели (через DSX); null — вернуть настройки пользователя DSX */
export function holdLightbar(color: RGB | null) {
  held = color
  if (effectActive || !status?.connected) return
  if (color) writeColor(color)
  else sendInstructions([{ type: RESET_TO_USER, parameters: [0] }])
}

/** Повторяем удерживаемый цвет: DSX мог сбросить его при смене профиля или переподключении геймпада */
function reassert() {
  if (held && !effectActive && status?.connected) writeColor(held)
}

function restore() {
  effectActive = false
  if (held) writeColor(held)
  else sendInstructions([{ type: RESET_TO_USER, parameters: [0] }])
}

/** Запускает эффект: шаги [цвет, яркость, мс]; новый эффект прерывает предыдущий */
async function runEffect(steps: [RGB, number, number][]) {
  if (!status?.connected) return false
  const token = ++effectToken
  effectActive = true
  for (const [color, alpha, ms] of steps) {
    if (token !== effectToken) return true
    writeColor(color, alpha)
    await new Promise((r) => setTimeout(r, ms))
  }
  if (token === effectToken) restore()
  return true
}

/** Короткая вспышка подсветки (при новом трофее), затем возврат цвета игры */
export function flashLightbar(color: RGB) {
  const white: RGB = [255, 255, 255]
  return runEffect([
    [white, 255, 140],
    [color, 255, 140],
    [white, 255, 140],
    [color, 255, 400]
  ])
}

/** Плавная пульсация цветом (предупреждение о разряде): cycles вдохов по period мс */
export function pulseLightbar(color: RGB, cycles = 4, period = 1100) {
  const steps: [RGB, number, number][] = []
  const frames = 14
  for (let c = 0; c < cycles; c++) {
    for (let f = 0; f < frames; f++) {
      // Синусоида от тусклого к яркому и обратно
      const k = (1 - Math.cos((f / frames) * Math.PI * 2)) / 2
      steps.push([color, 25 + k * 230, period / frames])
    }
  }
  return runEffect(steps)
}

/** Проверка подсветки из настроек: красный → зелёный → синий → белый */
export function testLightbar() {
  return runEffect([
    [[255, 0, 0], 255, 450],
    [[0, 255, 0], 255, 450],
    [[0, 60, 255], 255, 450],
    [[255, 255, 255], 255, 450]
  ])
}
