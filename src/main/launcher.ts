import { execFile, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { shell } from 'electron'
import type { Game, RunningGame, Settings } from '@shared/types'
import { commitSession, getDb, saveDb } from './store'
import { listProcesses } from './win32'
import { t } from '@shared/i18n'

/** Разбивает командную строку на аргументы с учётом кавычек (как cmd.exe). */
export function parseCommand(cmd: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  let has = false
  for (const ch of cmd) {
    if (ch === '"') {
      quoted = !quoted
      has = true
    } else if (/\s/.test(ch) && !quoted) {
      if (has) out.push(cur)
      cur = ''
      has = false
    } else {
      cur += ch
      has = true
    }
  }
  if (has) out.push(cur)
  return out
}

const expand = (tpl: string, game: Game) =>
  tpl.replace(/\{(rom|path)\}/g, game.path).replace(/\{dir\}/g, path.dirname(game.path))

// Папки, по которым нельзя отслеживать игру — в них живёт слишком много чужих процессов
function trackableDir(dir: string) {
  const d = dir.toLowerCase().replace(/\\+$/, '')
  if (/^[a-z]:$/.test(d)) return false
  if (/^[a-z]:\\windows(\\|$)/.test(d)) return false
  if (/^[a-z]:\\(program files( \(x86\))?|users|games|programdata)$/.test(d)) return false
  if (/\\(desktop|downloads|documents|steamapps\\common)$/.test(d)) return false
  return true
}

interface Tracker {
  gameId: string
  startedAt: number
  lastAlive: number
  pid?: number
  exeDir?: string
  trackName?: string
  misses: number
  /** Сколько ждать первого процесса игры (Steam может сначала обновляться) */
  grace: number
  timer: NodeJS.Timeout
  checkpoint: NodeJS.Timeout
  phase: RunningGame['phase']
}

let tracker: Tracker | null = null
export const events = new EventEmitter()

export function running(): RunningGame | null {
  return tracker ? { gameId: tracker.gameId, startedAt: tracker.startedAt, phase: tracker.phase } : null
}

export function setPhase(phase: RunningGame['phase']) {
  if (tracker && tracker.phase !== phase) {
    tracker.phase = phase
    events.emit('change')
  }
}

interface LaunchSpec {
  exe: string
  args: string[]
  cwd: string
  viaShell?: boolean
  /** Открыть ссылку (steam://rungameid/…) вместо запуска файла */
  url?: string
}

function buildSpec(game: Game, settings: Settings): LaunchSpec | string {
  if (game.customCommand?.trim()) {
    const [exe, ...args] = parseCommand(expand(game.customCommand, game))
    if (!exe) return t('Пустая команда запуска')
    return { exe, args, cwd: game.workDir || path.dirname(exe) }
  }
  if (game.launcher === 'steam' && game.steamAppId) {
    if (!fs.existsSync(game.path)) return t('Папка игры не найдена — возможно, игра удалена из Steam:\n{path}', { path: game.path })
    return { exe: '', args: [], cwd: game.path, url: `steam://rungameid/${game.steamAppId}` }
  }
  if (!fs.existsSync(game.path)) return t('Файл игры не найден:\n{path}', { path: game.path })

  if (game.platform === 'pc') {
    const ext = path.extname(game.path).toLowerCase()
    const cwd = game.workDir || path.dirname(game.path)
    const args = parseCommand(game.args ?? '')
    if (ext === '.url' || ext === '.lnk') return { exe: game.path, args: [], cwd, viaShell: true }
    if (ext === '.bat' || ext === '.cmd') return { exe: 'cmd.exe', args: ['/c', game.path, ...args], cwd }
    return { exe: game.path, args, cwd }
  }

  const emu = game.platform === 'ps2' ? settings.pcsx2Path : settings.rpcs3Path
  const tpl = game.platform === 'ps2' ? settings.pcsx2Args : settings.rpcs3Args
  const name = game.platform === 'ps2' ? 'PCSX2' : 'RPCS3'
  if (!emu || !fs.existsSync(emu)) return t('Не найден эмулятор {name}. Укажите путь к нему в настройках.', { name })
  return { exe: emu, args: parseCommand(expand(tpl, game)), cwd: path.dirname(emu) }
}

export async function launchGame(game: Game, settings: Settings): Promise<{ ok: boolean; error?: string }> {
  if (tracker) return { ok: false, error: t('Сначала закройте запущенную игру') }
  const spec = buildSpec(game, settings)
  if (typeof spec === 'string') return { ok: false, error: spec }

  let pid: number | undefined
  if (spec.url) {
    try {
      await shell.openExternal(spec.url)
    } catch (e) {
      return { ok: false, error: t('Не удалось открыть Steam: {v}', { v: (e as Error).message }) }
    }
  } else if (spec.viaShell) {
    const err = await shell.openPath(spec.exe)
    if (err) return { ok: false, error: err }
  } else {
    try {
      pid = await new Promise<number | undefined>((resolve, reject) => {
        const child = spawn(spec.exe, spec.args, { cwd: spec.cwd, detached: true, stdio: 'ignore', windowsHide: false })
        child.once('error', reject)
        child.once('spawn', () => {
          child.unref()
          resolve(child.pid)
        })
      })
    } catch (e) {
      return { ok: false, error: t('Не удалось запустить: {v}', { v: (e as Error).message }) }
    }
  }

  const now = Date.now()
  let exeDir: string | undefined
  const viaSteam = !!spec.url
  if (game.platform === 'pc' && !game.customCommand) {
    // У игр Steam path — уже папка установки
    const dir = viaSteam ? game.path : path.dirname(game.path)
    if (trackableDir(dir)) exeDir = dir.toLowerCase().replace(/\\+$/, '') + path.sep
  }
  tracker = {
    gameId: game.id,
    startedAt: now,
    lastAlive: now,
    pid,
    exeDir,
    trackName: game.trackProcess?.trim().toLowerCase() || undefined,
    misses: 0,
    grace: viaSteam ? 60000 : 12000,
    phase: 'launching',
    timer: setInterval(poll, 2000),
    checkpoint: setInterval(checkpoint, 30000)
  }
  getDb().activeSession = { gameId: game.id, start: now, lastSeen: now }
  saveDb()
  events.emit('change')
  return { ok: true }
}

export function trackedPids(): number[] {
  if (!tracker) return []
  const t = tracker
  return listProcesses()
    .filter(
      (p) =>
        p.pid !== process.pid &&
        (p.pid === t.pid ||
          (t.trackName && path.basename(p.path).toLowerCase() === t.trackName) ||
          (t.exeDir && p.path.toLowerCase().startsWith(t.exeDir)))
    )
    .map((p) => p.pid)
}

function poll() {
  if (!tracker) return
  const now = Date.now()
  if (trackedPids().length > 0) {
    tracker.lastAlive = now
    tracker.misses = 0
    return
  }
  // Первые секунды лаунчеры передают управление дочерним процессам — не считаем это выходом
  if (now - tracker.startedAt < tracker.grace) return
  if (++tracker.misses >= 2) endSession()
}

function checkpoint() {
  if (!tracker) return
  getDb().activeSession = { gameId: tracker.gameId, start: tracker.startedAt, lastSeen: tracker.lastAlive }
  saveDb()
}

export function endSession() {
  if (!tracker) return
  const t = tracker
  tracker = null
  clearInterval(t.timer)
  clearInterval(t.checkpoint)
  const duration = commitSession(t.gameId, t.startedAt, t.lastAlive)
  events.emit('change')
  events.emit('end', { gameId: t.gameId, duration })
}

const taskkill = (pid: number, force: boolean) =>
  new Promise<void>((resolve) =>
    execFile('taskkill', ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])], { windowsHide: true }, () => resolve())
  )

/** Сначала просим игру закрыться (WM_CLOSE), через пару секунд завершаем принудительно. */
export async function closeGame() {
  if (!tracker) return
  const pids = trackedPids()
  await Promise.all(pids.map((p) => taskkill(p, false)))
  await new Promise((r) => setTimeout(r, 2500))
  const left = trackedPids()
  await Promise.all(left.map((p) => taskkill(p, true)))
  if (tracker) {
    tracker.lastAlive = Date.now()
    endSession()
  }
}

/** Если прошлый запуск лаунчера упал во время игры — засчитываем время до последней отметки. */
export function recoverSession() {
  const s = getDb().activeSession
  if (s) commitSession(s.gameId, s.start, s.lastSeen)
}
