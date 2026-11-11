import { app, safeStorage } from 'electron'
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
  musicVolume: 'mid',
  glyphs: 'auto',
  fullscreen: true,
  launchOnStartup: false,
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

/** Сколько последних сессий хранить у игры: хватает на год календаря активности в профиле */
export const MAX_SESSIONS = 600

/** Копия library.json с прошлого удачного запуска: из неё библиотека восстанавливается, если основной файл повреждён */
const lastGoodFile = () => path.join(dataDir(), 'library.last-good.json')

/**
 * Ключи API на диске шифруются средствами Windows (safeStorage → DPAPI), как токены облака в cloud.json:
 * в library.json остаётся только зашифрованный блок secrets, прочитать который может лишь этот пользователь Windows.
 * В памяти они лежат в настройках, как раньше
 */
const SECRET_KEYS = ['steamKey', 'raKey', 'steamGridDbKey'] as const
type FileDb = Partial<DB> & { secrets?: string }

function readSecrets(sealed: string | undefined): Partial<Settings> {
  if (!sealed) return {}
  try {
    const raw = JSON.parse(safeStorage.decryptString(Buffer.from(sealed, 'base64'))) as Record<string, unknown>
    return Object.fromEntries(SECRET_KEYS.filter((k) => typeof raw[k] === 'string').map((k) => [k, raw[k]]))
  } catch {
    // Файл принесли с другого ПК или из-под другого пользователя Windows — ключи придётся ввести заново
    return {}
  }
}

/** Содержимое library.json. plain — с ключами открытым текстом: для копии данных, которую переносят на другой ПК */
export function dbJson(plain = false) {
  const secrets = Object.fromEntries(SECRET_KEYS.filter((k) => db.settings[k]).map((k) => [k, db.settings[k]]))
  if (plain || !Object.keys(secrets).length || !safeStorage.isEncryptionAvailable()) return JSON.stringify(db, null, 2)
  const out: FileDb = { ...db, settings: { ...db.settings, ...Object.fromEntries(SECRET_KEYS.map((k) => [k, ''])) }, secrets: safeStorage.encryptString(JSON.stringify(secrets)).toString('base64') }
  return JSON.stringify(out, null, 2)
}

function parseDb(text: string): DB {
  const raw = JSON.parse(text) as FileDb | null
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || (raw.games !== undefined && !Array.isArray(raw.games))) throw new Error('не библиотека PlayOS')
  return {
    games: (raw.games ?? []).map((g) => ({ ...g, sessions: g.sessions ?? [], playtime: g.playtime ?? 0 })),
    // Кто пользовался PlayOS до появления мастера первого запуска, его не увидит
    settings: { ...defaultSettings(), onboarded: true, ...raw.settings, ...readSecrets(raw.secrets) },
    activeSession: raw.activeSession,
    deleted: raw.deleted,
    settingsAt: raw.settingsAt
  }
}

/** Что случилось с библиотекой при запуске: восстановлена из копии (at — её время) или начата заново; broken — куда отложен повреждённый файл */
export interface LoadIssue {
  restored: boolean
  at?: number
  broken: string
}
let issue: LoadIssue | null = null
export const loadIssue = () => issue

export function loadDb(): DB {
  issue = null
  let text: string | null = null
  try {
    text = fs.readFileSync(dbFile(), 'utf8')
  } catch (e) {
    // Файла нет — первый запуск. Есть, но не читается — разбираемся ниже, как с повреждённым
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') text = ''
  }
  if (text === null) {
    db = { games: [], settings: defaultSettings() }
    return db
  }
  try {
    db = parseDb(text)
    // Файл цел — он и становится копией на случай порчи (раз за запуск)
    try {
      fs.copyFileSync(dbFile(), lastGoodFile())
    } catch {
      // Без копии работаем как раньше
    }
    return db
  } catch {
    // Повреждённый файл не затираем пустой библиотекой: откладываем его и берём копию с прошлого запуска
    const broken = path.join(dataDir(), `library.broken-${Date.now()}.json`)
    try {
      fs.copyFileSync(dbFile(), broken)
    } catch {
      // Не скопировался — восстановление всё равно пробуем
    }
    try {
      db = parseDb(fs.readFileSync(lastGoodFile(), 'utf8'))
      issue = { restored: true, at: fs.statSync(lastGoodFile()).mtimeMs, broken }
    } catch {
      db = { games: [], settings: defaultSettings() }
      issue = { restored: false, broken }
    }
    return db
  }
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
  fs.writeFileSync(tmp, dbJson(), 'utf8')
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
    game.sessions = [...game.sessions, { start, duration }].slice(-MAX_SESSIONS)
  }
  db.activeSession = undefined
  saveDbNow()
  return duration
}
