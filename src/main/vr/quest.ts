import fs from 'node:fs'
import path from 'node:path'
import type { QuestStatus } from '@shared/types'
import { listProcesses, processAlive } from '../win32'

/**
 * Meta Horizon Link сам ведёт кэш устройств: подключение, Air Link, заряд шлема и контроллеров.
 * Файл маленький и обновляется сервисом на лету — читаем его вместо ADB и режима разработчика.
 */
const DEVICE_CACHE = path.join(process.env.LOCALAPPDATA ?? '', 'Oculus', 'DeviceCache.json')

/** Кодовые имена шлемов → названия */
const MODELS: Record<string, string> = {
  panther: 'Quest 3S',
  eureka: 'Quest 3',
  seacliff: 'Quest Pro',
  hollywood: 'Quest 2',
  monterey: 'Quest'
}

interface Device {
  type?: string
  subtype?: string
  id?: string
  serialNumber?: string
  connectionState?: string
  isUsingAirLink?: boolean
  batteryState?: number | string
  primaryState?: string
  pairedTo?: string
  lastSeenAt?: number
}

const battery = (d?: Device) => (typeof d?.batteryState === 'number' ? d.batteryState : undefined)

/** Последний удачно прочитанный список: сервис переписывает файл раз в секунду и можно попасть на недописанный */
let lastDevices: Device[] | null = null

function readDevices(): Device[] | null {
  try {
    lastDevices = JSON.parse(fs.readFileSync(DEVICE_CACHE, 'utf8')).devices ?? []
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') lastDevices = null
  }
  return lastDevices
}

/** Найденный процесс сервиса Meta Link (OVRServer_x64.exe) */
let link: { pid: number; exe: string } | null = null
let linkSearchedAt = 0

/**
 * Работает ли Meta Link. Сервис пишет кэш устройств только при изменениях (паузы бывают больше минуты),
 * поэтому по свежести файла судить нельзя — проверяем сам процесс: найденный pid проверяется дёшево,
 * полный перебор процессов — только когда сервис не найден, и не чаще раза в 15 с
 */
function linkAlive() {
  if (link && processAlive(link.pid, link.exe)) return true
  link = null
  if (Date.now() - linkSearchedAt < 15_000) return false
  linkSearchedAt = Date.now()
  const p = listProcesses().find((x) => /\\ovrserver_x64\.exe$/i.test(x.path))
  if (p) link = { pid: p.pid, exe: p.path }
  return !!link
}

/** Статус для верхней панели. Дёшево — можно звать раз в несколько секунд */
export const questLive = (): QuestStatus => questStatus(linkAlive())

/** linkRunning — работает ли OVRServer: без него кэш устаревший, шлем считаем отключённым */
export function questStatus(linkRunning: boolean): QuestStatus {
  const devices = readDevices()
  if (!devices) return { found: false, connected: false }
  // Основной шлем, а если такого нет — тот, что видели последним
  const headsets = devices.filter((d) => d.type === 'headset')
  const hmd = headsets.find((d) => d.primaryState === 'primary') ?? headsets.sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0))[0]
  if (!hmd) return { found: false, connected: false }

  const connected = linkRunning && hmd.connectionState === 'connected'
  const model = MODELS[hmd.subtype ?? ''] ?? hmd.subtype ?? 'Quest'
  if (!connected) {
    // Шлем отключили — запомненный заряд контроллеров больше не актуален
    padMemory.l = padMemory.r = undefined
    return { found: true, connected, model }
  }
  const id = hmd.id ?? hmd.serialNumber
  const pad = (side: 'l' | 'r') => {
    const d = devices.find((x) => x.type === 'controller' && x.pairedTo === id && x.subtype?.startsWith(side))
    const value = battery(d)
    if (d?.connectionState === 'connected' && value !== undefined) padMemory[side] = value
    else if (value !== undefined && padMemory[side] === undefined) padMemory[side] = value
    // Контроллер без движения засыпает и пропадает из кэша — показываем последний заряд и помечаем «спит»
    return { value: padMemory[side], idle: d?.connectionState !== 'connected' }
  }
  const l = pad('l')
  const r = pad('r')

  return {
    found: true,
    connected,
    model,
    link: hmd.isUsingAirLink ? 'air' : 'cable',
    battery: battery(hmd),
    left: l.value,
    right: r.value,
    leftIdle: l.idle,
    rightIdle: r.idle
  }
}

/** Последний известный заряд контроллеров, пока шлем подключён */
const padMemory: { l?: number; r?: number } = {}
