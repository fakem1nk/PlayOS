import { app } from 'electron'
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { SystemState } from '@shared/types'

/**
 * Обёртка над PlayOSHelper.exe (native/SystemHelper.cs): громкость, звуковые выходы, яркость.
 * Помощник живёт постоянно и отвечает на команды по одной JSON-строке — без задержки на запуск.
 */

const helperPath = () =>
  app.isPackaged ? path.join(process.resourcesPath, 'PlayOSHelper.exe') : path.join(app.getAppPath(), 'resources', 'PlayOSHelper.exe')

let proc: ChildProcessWithoutNullStreams | null = null
let buffer = ''
const waiting: ((line: string) => void)[] = []
let queue = Promise.resolve()

function helper() {
  if (proc && !proc.killed && proc.exitCode === null) return proc
  const exe = helperPath()
  if (!fs.existsSync(exe)) return null
  proc = spawn(exe, [], { windowsHide: true })
  proc.stdout.setEncoding('utf8')
  proc.stdout.on('data', (chunk: string) => {
    buffer += chunk
    let i: number
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim()
      buffer = buffer.slice(i + 1)
      if (line) waiting.shift()?.(line)
    }
  })
  proc.on('exit', () => {
    proc = null
    while (waiting.length) waiting.shift()?.('{"error":"helper exited"}')
  })
  return proc
}

/** Команды выполняются строго по очереди: один ответ на одну команду. */
function command(cmd: string, timeout = 4000): Promise<SystemState | null> {
  const run = () =>
    new Promise<SystemState | null>((resolve) => {
      const p = helper()
      if (!p) return resolve(null)
      const timer = setTimeout(() => {
        const idx = waiting.indexOf(onLine)
        if (idx >= 0) waiting.splice(idx, 1)
        resolve(null)
      }, timeout)
      function onLine(line: string) {
        clearTimeout(timer)
        try {
          const j = JSON.parse(line) as SystemState & { error?: string }
          resolve(j.error ? null : j)
        } catch {
          resolve(null)
        }
      }
      waiting.push(onLine)
      p.stdin.write(cmd + '\n')
    })
  const result = queue.then(run)
  queue = result.then(() => undefined)
  return result
}

/** Полное состояние; яркость запрашивается только по желанию — DDC/CI медленный */
export const systemState = (withBrightness = true) => command(withBrightness ? 'state' : 'audio')
export const setVolume = (v: number) => command(`volume ${Math.max(0, Math.min(1, v)).toFixed(3)}`)
export const setMute = (m: boolean) => command(`mute ${m ? 1 : 0}`)
export const setAudioDevice = (id: string) => command(`device ${id}`)
export const setBrightness = (v: number) => command(`brightness ${Math.round(Math.max(0, Math.min(100, v)))}`, 8000)

export function stopHelper() {
  proc?.kill()
  proc = null
}
