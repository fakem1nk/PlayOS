import { app } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Game, Settings } from '@shared/types'

export interface ActiveSession {
  gameId: string
  start: number
  lastSeen: number
}

export interface DB {
  games: Game[]
  settings: Settings
  activeSession?: ActiveSession
  /** Удалённые игры (ключ библиотеки → когда) — чтобы удаление дошло до других ПК */
  deleted?: { key: string; at: number }[]
  /** Когда меняли настройки — побеждает более свежий профиль */
  settingsAt?: number
}

const defaultSettings = (): Settings => ({
  userName: os.userInfo().username,
  pcsx2Path: 'C:\\Program Files\\PCSX2\\pcsx2-qt.exe',
  pcsx2Args: '-fullscreen -batch -- "{rom}"',
  rpcs3Path: '',
  rpcs3Args: '--no-gui --fullscreen "{rom}"',
  sounds: true,
  volume: 'mid',
  music: false,
  glyphs: 'auto',
  fullscreen: true,
  launchOnStartup: false,
  breakReminder: 0,
  trophies: {},
  rpcs3SaveKey: 'Ctrl+S',
  pauseOnOverlay: 'all',
  overlayEnabled: true,
  uiScale: 1,
  steamGridDbKey: '',
  raUser: '',
  raKey: '',
  steamKey: '',
  steamId: '',
  trophyPopups: true,
  dsxLightbar: true,
  trophyRumble: true,
  trophyShots: true,
  animatedCovers: true,
  liveBackground: true,
  screensaver: 5,
  lowBatteryWarning: true,
  gameTint: true,
  displayId: 0,
  displayLabel: '',
  onboarded: false,
  betaUpdates: false
})

export const dataDir = () => app.getPath('userData')
export const artDir = (gameId: string) => path.join(dataDir(), 'art', gameId)
const dbFile = () => path.join(dataDir(), 'library.json')

let db: DB

export function loadDb(): DB {
  try {
    const raw = JSON.parse(fs.readFileSync(dbFile(), 'utf8')) as Partial<DB>
    db = {
      games: (raw.games ?? []).map((g) => ({ ...g, sessions: g.sessions ?? [], playtime: g.playtime ?? 0 })),
      // Кто пользовался PlayOS до появления мастера первого запуска, его не увидит
      settings: { ...defaultSettings(), onboarded: true, ...raw.settings },
      activeSession: raw.activeSession,
      deleted: raw.deleted,
      settingsAt: raw.settingsAt
    }
  } catch {
    db = { games: [], settings: defaultSettings() }
  }
  return db
}

export const getDb = () => db

let saveTimer: NodeJS.Timeout | null = null

/** Атомарная запись: сначала во временный файл, потом rename — библиотека не побьётся при сбое. */
export function saveDbNow() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  fs.mkdirSync(dataDir(), { recursive: true })
  const tmp = dbFile() + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8')
  fs.renameSync(tmp, dbFile())
}

export function saveDb() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveDbNow, 250)
}

export function findGame(id: string) {
  return db.games.find((g) => g.id === id)
}

/** Короткий id этого ПК для счётчиков времени (из cloud.json) */
let device = ''
export const setDevice = (id: string) => (device = id)

/** Записывает сыгранное время в игру. */
export function commitSession(gameId: string, start: number, end: number) {
  const game = findGame(gameId)
  const duration = Math.max(0, Math.round((end - start) / 1000))
  if (game && duration > 0) {
    game.playtime += duration
    if (device) {
      // Своё время — в свой счётчик; остальное время игры (до облака) уходит в базу
      const by = (game.playtimeBy ??= {})
      game.playtimeBase ??= game.playtime - duration - Object.values(by).reduce((a, b) => a + b, 0)
      by[device] = (by[device] ?? 0) + duration
    }
    game.lastPlayed = end
    game.sessions = [...game.sessions, { start, duration }].slice(-100)
  }
  db.activeSession = undefined
  saveDbNow()
  return duration
}
