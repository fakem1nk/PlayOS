import { app, BrowserWindow, desktopCapturer, dialog, globalShortcut, ipcMain, net, Notification, powerMonitor, protocol, screen, shell } from 'electron'
import { exec } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import type {
  AchievementNotice,
  AppState,
  ImportProgress,
  SystemNotice,
  SystemInfo,
  ControllerInfo,
  EmuActionResult,
  EmuState,
  Game,
  GameDraft,
  OverlayEvent,
  PadAction,
  PadStatus,
  Pcsx2Info,
  PickKind,
  Platform,
  PowerAction,
  SaveProgress,
  Settings,
  ArtSource
} from '@shared/types'
import { startGamepad } from './gamepad'
import * as ach from './achievements'
import { fromHex, gameAccent, PLATFORM_COLOR } from './color'
import { forgetDetails, gameDetails, liveBackground } from './details'
import { scanSteam } from './steam'
import { initLog, lastRunCrashed, log, saveReport, watchWindow } from './log'
import { checkForUpdates, installUpdate, startUpdater, updateState } from './updater'
import { exportData, importData, inspectBackup } from './backup'
import { dsxStatus, flashLightbar, holdLightbar, lightbarReady, pulseLightbar, startDsx, testLightbar } from './dsx'
import { hidControllers, hidStatus, startHid } from './hid'
import * as launcher from './launcher'
import * as media from './media'
import { enablePineInIni, listSlots, pcsx2Config, slotTime, type Pcsx2Config } from './pcsx2'
import { pineGameId, pineLoad, pineSave, pineStatus } from './pine'
import { artDir, dataDir, findGame, getDb, loadDb, saveDb, saveDbNow } from './store'
import { setAudioDevice, setBrightness, setMute, setVolume, stopHelper, systemState } from './system'
import {
  forceForeground,
  foregroundWindow,
  listProcesses,
  pressCombo,
  readBattery,
  readPad,
  resumeProcess,
  rumble,
  suspendProcess,
  windowPid,
  windowRect
} from './win32'

protocol.registerSchemesAsPrivileged([
  { scheme: 'pcs', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

const APP_ID = 'com.playos.app'
app.setName('PlayOS')
app.setAppUserModelId(APP_ID)
migrateLegacyData()
initLog()

/**
 * PCStation переименован в PlayOS: переносим папку данных %APPDATA%\PCStation → %APPDATA%\PlayOS.
 * Арт, аватар и трейлеры записаны в библиотеке абсолютными путями — переписываем их на новую папку.
 * Если старая версия ещё запущена и держит файлы, работаем со старой папкой и пробуем при следующем старте.
 */
function migrateLegacyData() {
  const appData = app.getPath('appData')
  const legacy = path.join(appData, 'PCStation')
  const current = path.join(appData, 'PlayOS')
  if (fs.existsSync(path.join(current, 'library.json')) || !fs.existsSync(path.join(legacy, 'library.json'))) {
    app.setPath('userData', current)
    return
  }
  try {
    fs.copyFileSync(path.join(legacy, 'library.json'), path.join(legacy, 'library.pre-playos.bak.json'))
    fs.renameSync(legacy, current)
  } catch {
    app.setPath('userData', legacy)
    return
  }
  app.setPath('userData', current)
  // В JSON обратные слэши удвоены — ищем путь в том же виде
  const inJson = (p: string) => JSON.stringify(p + path.sep).slice(1, -1)
  const from = new RegExp(inJson(legacy).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
  for (const f of ['library.json', 'details-cache.json', 'achievements.json']) {
    const file = path.join(current, f)
    if (!fs.existsSync(file)) continue
    const text = fs.readFileSync(file, 'utf8')
    fs.writeFileSync(file, text.replace(from, () => inJson(current)))
  }
}

if (!app.requestSingleInstanceLock()) app.quit()

let win: BrowserWindow | null = null
let overlay: BrowserWindow | null = null
let overlayOpen = false
let gameHwnd: bigint | null = null
let launchTimer: NodeJS.Timeout | null = null
/** Замороженные (поставленные на паузу) процессы игры */
let frozen: number[] = []
/** Текущий слот PCSX2 в режиме горячих клавиш (каждый запуск эмулятор начинает с первого) */
let keySlot = 1
let overlayOpenedAt = 0
/** Текущее сохранение из редактора — его можно отменить */
let editorSave: AbortController | null = null

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const alive = (w: BrowserWindow | null): w is BrowserWindow => !!w && !w.isDestroyed()
const sendTo = (w: BrowserWindow | null, channel: string, payload?: unknown) => {
  if (alive(w)) w.webContents.send(channel, payload)
}
const send = (channel: string, payload?: unknown) => {
  sendTo(win, channel, payload)
  sendTo(overlay, channel, payload)
}

const state = (): AppState => ({
  games: getDb().games,
  settings: getDb().settings,
  running: launcher.running(),
  dataDir: dataDir(),
  version: app.getVersion()
})

const broadcast = () => send('state', state())
const toast = (title: string, message: string) => sendTo(win, 'toast', { title, message })

// ───────────────────────── Окна ─────────────────────────

const hwndOf = (w: BrowserWindow | null) => (alive(w) ? w.getNativeWindowHandle().readBigUInt64LE(0) : null)

function loadRenderer(w: BrowserWindow, hash?: string) {
  if (process.env.ELECTRON_RENDERER_URL) w.loadURL(process.env.ELECTRON_RENDERER_URL + (hash ? `#${hash}` : ''))
  else w.loadFile(path.join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
}

function bringToFront() {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  if (getDb().settings.fullscreen && !win.isFullScreen()) win.setFullScreen(true)
  forceForeground(hwndOf(win))
  win.focus()
}

/** Прозрачное окно поверх игры. Создаётся заранее и прячется — открывается мгновенно. */
function createOverlayWindow() {
  overlay = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    title: 'PlayOS Overlay',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      // Звук интро и оверлея без предварительного нажатия
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false
    }
  })
  watchWindow(overlay, 'overlay')
  overlay.setAlwaysOnTop(true, 'screen-saver')
  overlay.on('closed', () => (overlay = null))
  // Alt+Tab или клик в другое окно — прячем панель и снимаем паузу, чтобы игра не «зависла» за спиной
  overlay.on('blur', () => {
    if (overlayOpen && Date.now() - overlayOpenedAt > 400) void closeOverlay('none')
  })
  loadRenderer(overlay, 'overlay')
}

/** Контекст запущенной игры для быстрых сохранений */
function emuContext() {
  const r = launcher.running()
  const game = r ? findGame(r.gameId) : undefined
  if (!game) return null
  const cfg = game.platform === 'ps2' ? pcsx2Config(getDb().settings.pcsx2Path) : null
  return { game, cfg }
}

/** Окно игры сейчас на переднем плане? (нажатия клавиш уйдут именно в него) */
function gameInForeground() {
  const fg = foregroundWindow()
  return !!fg && launcher.trackedPids().includes(windowPid(fg))
}

/** Ставить ли игру на паузу (заморозкой процесса), пока открыт оверлей */
function shouldFreeze() {
  const mode = getDb().settings.pauseOnOverlay
  const platform = emuContext()?.game.platform
  return mode === 'all' || (mode === 'emulators' && (platform === 'ps2' || platform === 'ps3'))
}

/**
 * Пауза игры: замораживаем её процессы. Игра не идёт и не читает геймпад —
 * управление полностью у оверлея и не «лазит» по меню игры.
 */
function freezeGame() {
  if (frozen.length || !shouldFreeze()) return
  frozen = launcher.trackedPids().filter((pid) => suspendProcess(pid))
}

function unfreezeGame() {
  for (const pid of frozen) resumeProcess(pid)
  frozen = []
}

/** Снимок монитора с игрой — размытый фон оверлея. Делается до показа окна, чтобы не попасть в кадр. */
async function captureBackdrop(display: Electron.Display): Promise<string | undefined> {
  try {
    const width = 960
    const height = Math.round((width * display.size.height) / display.size.width)
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } })
    const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
    if (!src || src.thumbnail.isEmpty()) return undefined
    return 'data:image/jpeg;base64,' + src.thumbnail.toJPEG(82).toString('base64')
  } catch {
    return undefined
  }
}

async function openOverlay() {
  if (!alive(overlay)) createOverlayWindow()
  if (toastTimer) clearTimeout(toastTimer)
  const fg = foregroundWindow()
  if (fg && fg !== hwndOf(win) && fg !== hwndOf(overlay)) gameHwnd = fg
  // Оверлей накрывает тот монитор, на котором сейчас игра
  const rect = windowRect(gameHwnd)
  const display = rect
    ? screen.getDisplayMatching(screen.screenToDipRect(null, rect))
    : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const backdrop = await captureBackdrop(display)
  overlayOpen = true
  overlayOpenedAt = Date.now()
  overlay!.setBounds(display.bounds)
  overlay!.setFocusable(true)
  overlay!.setIgnoreMouseEvents(false)
  sendTo(overlay, 'overlay', { open: true, backdrop } satisfies OverlayEvent)
  overlay!.show()
  forceForeground(hwndOf(overlay))
  overlay!.focus()
  // Замораживаем после показа: игре в эксклюзивном полноэкранном режиме нужно успеть свернуться
  setTimeout(() => overlayOpen && freezeGame(), 150)
}

type CloseTarget = 'game' | 'home' | 'none'

/**
 * Закрыть оверлей с растворением. Окно на время анимации перестаёт принимать фокус —
 * иначе при скрытии Windows отдаёт активность «случайному» окну, и геймпад теряется.
 * game — вернуться в игру; home — в главное меню (игра остаётся на паузе); none — просто скрыть.
 */
async function closeOverlay(target: CloseTarget) {
  if (!overlayOpen) return
  overlayOpen = false
  sendTo(overlay, 'overlay', { open: false } satisfies OverlayEvent)
  if (alive(overlay)) {
    overlay.setIgnoreMouseEvents(true)
    overlay.setFocusable(false)
  }
  if (target !== 'home') unfreezeGame()
  if (target === 'game') forceForeground(gameHwnd)
  if (target === 'home') bringToFront()
  setTimeout(() => {
    if (overlayOpen || !alive(overlay)) return
    overlay.hide()
    // Ещё раз закрепляем фокус: скрытие окна не должно его увести
    if (target === 'game') forceForeground(gameHwnd)
    if (target === 'home') forceForeground(hwndOf(win))
  }, 300)
}

/** Вернуться в игру из главного окна (оверлей уже закрыт) */
function resumeFromHome() {
  unfreezeGame()
  win?.minimize()
  forceForeground(gameHwnd)
}

/** PS / Guide / удержание Select+Start / Ctrl+Alt+H */
function onHotkey() {
  if (launcher.running()) {
    if (overlayOpen) void closeOverlay('game')
    else void openOverlay()
  } else if (!win) {
    return
  } else if (win.isMinimized() || !win.isVisible() || !win.isFocused()) {
    bringToFront()
  } else {
    sendTo(win, 'pad', 'home' satisfies PadAction)
  }
}

// ───────────────────────── Выход с аутро ─────────────────────────

/** Выход разрешён: аутро доиграло (или его пропустили) */
let allowQuit = false
let sessionEnding = false
let quitFallback: NodeJS.Timeout | null = null

function requestQuitOutro() {
  sendTo(win, 'outro', 'quit')
  // Интерфейс не ответил (завис) — выходим без анимации
  quitFallback ??= setTimeout(() => {
    allowQuit = true
    app.quit()
  }, 7000)
}

// ───────────────────────── Экран для PlayOS ─────────────────────────

/** Выбранный в настройках экран; если его нет (ТВ выключен) — основной */
function targetDisplay() {
  const { displayId, displayLabel } = getDb().settings
  const all = screen.getAllDisplays()
  return (
    (displayId && all.find((d) => d.id === displayId)) ||
    (displayLabel && all.find((d) => d.label === displayLabel)) ||
    screen.getPrimaryDisplay()
  )
}

/** Окно 1600×900 по центру экрана (меньше, если экран маленький) */
function boundsOn(d: Electron.Display) {
  const { x, y, width, height } = d.workArea
  const w = Math.min(1600, width)
  const h = Math.min(900, height)
  return { x: x + Math.round((width - w) / 2), y: y + Math.round((height - h) / 2), width: w, height: h }
}

/** Переносит окно на выбранный экран. Полноэкранное окно Windows не двигает — сначала выходим из полного экрана. */
function moveToTargetDisplay() {
  const w = win
  if (!w || w.isDestroyed()) return
  const d = targetDisplay()
  if (screen.getDisplayMatching(w.getBounds()).id === d.id) return
  const place = () => {
    w.setBounds(boundsOn(d))
    if (getDb().settings.fullscreen) setTimeout(() => !w.isDestroyed() && w.setFullScreen(true), 60)
  }
  if (w.isFullScreen()) {
    w.once('leave-full-screen', () => setTimeout(place, 60))
    w.setFullScreen(false)
  } else place()
}

function listDisplays() {
  const primary = screen.getPrimaryDisplay().id
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    name: d.label || `Экран ${i + 1}`,
    width: Math.round(d.size.width * d.scaleFactor),
    height: Math.round(d.size.height * d.scaleFactor),
    primary: d.id === primary
  }))
}

function createWindow() {
  const { fullscreen } = getDb().settings
  win = new BrowserWindow({
    ...boundsOn(targetDisplay()),
    minWidth: 1024,
    minHeight: 576,
    fullscreen,
    frame: false,
    show: false,
    backgroundColor: '#04060c',
    title: 'PlayOS',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      // Звук интро и оверлея без предварительного нажатия
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: true
    }
  })
  watchWindow(win, 'main')
  win.once('ready-to-show', () => win?.show())
  win.on('blur', () => {
    // Окно игры перехватило фокус — значит, она запустилась. Сворачиваемся.
    const r = launcher.running()
    if (r?.phase === 'launching') {
      launcher.setPhase('running')
      setTimeout(() => launcher.running() && !overlayOpen && win?.minimize(), 400)
    }
    // Из главного меню переключились (Alt+Tab) в замороженную игру — снимаем паузу, иначе она «зависнет»
    setTimeout(() => {
      if (frozen.length && !overlayOpen && gameInForeground()) unfreezeGame()
    }, 150)
  })
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') win?.setFullScreen(!win.isFullScreen())
    if (input.type === 'keyDown' && input.key === 'F12' && !app.isPackaged) win?.webContents.toggleDevTools()
  })
  // Закрытие окна (Alt+F4) — сначала аутро в интерфейсе, выход по его окончании
  win.on('close', (e) => {
    if (allowQuit || sessionEnding || !win || win.webContents.isLoading()) return
    e.preventDefault()
    requestQuitOutro()
  })
  // Windows завершает сеанс — не задерживаем выключение анимацией
  win.on('query-session-end', () => {
    sessionEnding = true
  })
  win.on('closed', () => {
    win = null
    overlay?.destroy()
  })
  loadRenderer(win)
}

// ───────────────────────── Быстрые сохранения ─────────────────────────

const NO_EMU: EmuState = { mode: 'none', slots: [], current: 1, canLoad: false, paused: false }

async function emuState(): Promise<EmuState> {
  const ctx = emuContext()
  if (!ctx || ctx.game.platform === 'pc') return NO_EMU
  if (ctx.game.platform === 'ps3') {
    const key = getDb().settings.rpcs3SaveKey
    return {
      ...NO_EMU,
      mode: key ? 'keys' : 'none',
      platform: 'ps3',
      hint: 'Сохранение состояния RPCS3. Загрузить его можно из списка игр RPCS3.'
    }
  }
  const cfg = ctx.cfg
  if (!cfg) return { ...NO_EMU, platform: 'ps2', hint: 'Не найдена папка данных PCSX2' }
  let serial = ctx.game.serial
  let mode: EmuState['mode'] = 'keys'
  if (cfg.pineEnabled) {
    // Замороженный PCSX2 не ответит по PINE — на мгновение размораживаем
    const id = await thawed(async () => ((await pineStatus(cfg.pinePort)) ? ((await pineGameId(cfg.pinePort)) ?? '') : null))
    if (id !== null) {
      mode = 'pine'
      serial = id || serial
    }
  }
  return {
    mode,
    platform: 'ps2',
    slots: listSlots(cfg.sstates, serial),
    current: keySlot,
    canLoad: true,
    paused: frozen.length > 0,
    hint: mode === 'keys' ? 'Включите PINE в настройках PlayOS — сохранения будут работать, не переключая окна' : undefined
  }
}

/** Выполнить действие с ненадолго размороженной игрой (PINE не отвечает, пока процесс заморожен) */
async function thawed<T>(fn: () => Promise<T>): Promise<T> {
  if (!frozen.length) return fn()
  unfreezeGame()
  try {
    return await fn()
  } finally {
    if (overlayOpen) freezeGame()
  }
}

/** Режим горячих клавиш: выбираем слот кнопками «следующий/предыдущий» кратчайшим путём. */
async function selectSlotByKeys(cfg: Pcsx2Config, slot: number) {
  const forward = (slot - keySlot + 10) % 10
  const backward = (keySlot - slot + 10) % 10
  const useNext = forward <= backward
  const combo = useNext ? cfg.keys.next : cfg.keys.prev
  for (let i = 0; i < Math.min(forward, backward) && combo; i++) {
    await pressCombo(combo)
    await sleep(70)
  }
  keySlot = slot
}

/** Вернуться в игру и нажать горячие клавиши эмулятора. */
async function viaKeys(action: (cfg: Pcsx2Config | null) => Promise<boolean>): Promise<boolean> {
  const cfg = emuContext()?.cfg ?? null
  await closeOverlay('game')
  await sleep(240)
  if (!gameInForeground()) return false
  return action(cfg)
}

async function saveState(slot: number): Promise<EmuActionResult> {
  const ctx = emuContext()
  if (!ctx) return { ok: false, message: 'Игра не запущена' }
  if (ctx.game.platform === 'ps3') {
    const key = getDb().settings.rpcs3SaveKey
    const ok = await viaKeys(async () => pressCombo(key))
    return { ok, message: ok ? 'Состояние сохраняется' : 'Окно RPCS3 не получило фокус', resumed: true }
  }
  const cfg = ctx.cfg
  if (!cfg) return { ok: false, message: 'Не найдена папка данных PCSX2' }
  if (cfg.pineEnabled) {
    const saved = await thawed(async () => {
      const serial = (await pineGameId(cfg.pinePort)) ?? ctx.game.serial
      const since = Date.now() - 500
      if (!(await pineSave(cfg.pinePort, slot))) return false
      // PCSX2 пишет файл в фоне — ждём его, прежде чем снова заморозить игру
      for (let i = 0; i < 40; i++) {
        await sleep(150)
        if ((slotTime(cfg.sstates, serial, slot) ?? 0) > since) break
      }
      return true
    })
    if (saved) return { ok: true, message: `Сохранено в слот ${slot}` }
  }
  const ok = await viaKeys(async (c) => {
    await selectSlotByKeys(c!, slot)
    return pressCombo(c!.keys.save!)
  })
  return { ok, message: ok ? `Сохранено в слот ${slot}` : 'Окно PCSX2 не получило фокус', resumed: true }
}

async function loadState(slot: number): Promise<EmuActionResult> {
  const cfg = emuContext()?.cfg
  if (!cfg) return { ok: false, message: 'Загрузка доступна только для PS2' }
  if (cfg.pineEnabled && (await thawed(() => pineLoad(cfg.pinePort, slot)))) {
    await closeOverlay('game')
    return { ok: true, message: `Загружен слот ${slot}`, resumed: true }
  }
  const ok = await viaKeys(async (c) => {
    await selectSlotByKeys(c!, slot)
    return pressCombo(c!.keys.load!)
  })
  return { ok, message: ok ? `Загружен слот ${slot}` : 'Окно PCSX2 не получило фокус', resumed: true }
}

function pcsx2Info(): Pcsx2Info {
  const cfg = pcsx2Config(getDb().settings.pcsx2Path)
  if (!cfg) return { found: false, pine: 'unknown' }
  return { found: true, dataDir: cfg.dataDir, pine: cfg.pineEnabled ? 'enabled' : 'disabled', saveKey: cfg.keys.save, loadKey: cfg.keys.load }
}

function enablePine() {
  const cfg = pcsx2Config(getDb().settings.pcsx2Path)
  if (!cfg) return { ok: false, message: 'Не найдена папка данных PCSX2. Запустите PCSX2 хотя бы раз.' }
  if (listProcesses().some((p) => path.basename(p.path).toLowerCase().startsWith('pcsx2'))) {
    return { ok: false, message: 'Закройте PCSX2 и попробуйте снова — он перезаписывает настройки при выходе.' }
  }
  try {
    enablePineInIni(cfg.dataDir)
    return { ok: true, message: 'PINE включён. Быстрые сохранения будут работать без переключения окон.' }
  } catch (e) {
    return { ok: false, message: `Не удалось изменить PCSX2.ini: ${(e as Error).message}` }
  }
}

// ───────────────────────── Библиотека ─────────────────────────

const ART_FIELDS = ['cover', 'coverAnimated', 'hero', 'logo', 'icon'] as const

const ART_NAMES: Record<(typeof ART_FIELDS)[number], string> = {
  cover: 'обложка',
  coverAnimated: 'анимированная обложка',
  hero: 'фон',
  logo: 'логотип',
  icon: 'иконка'
}

interface SaveOptions {
  signal?: AbortSignal
  onProgress?: (p: SaveProgress) => void
  /** Пакетное добавление (импорт): без отдельного уведомления о недокачанном арте */
  quiet?: boolean
}

async function saveGame(draft: GameDraft, opts: SaveOptions = {}): Promise<Game> {
  const db = getDb()
  const existing = draft.id ? findGame(draft.id) : undefined
  const id = existing?.id ?? randomUUID()
  const dir = artDir(id)
  const game: Game = {
    ...(existing ?? { playtime: 0, addedAt: Date.now(), sessions: [] }),
    ...draft,
    id
  } as Game

  const remote = ART_FIELDS.filter((f) => media.isRemote(draft[f]))
  const failed: string[] = []
  let step = 0
  for (const field of ART_FIELDS) {
    const value = draft[field]
    if (!value) {
      delete game[field]
    } else if (media.isRemote(value)) {
      step++
      const report = (received: number, size: number) => opts.onProgress?.({ field, step, total: remote.length, received, size })
      report(0, 0)
      const res = await media.downloadArt(value, dir, field, { signal: opts.signal, onProgress: report })
      if ('file' in res) {
        game[field] = res.file
      } else if (res.error === 'cancelled') {
        // Убираем то, что успели скачать за эту попытку, — игра остаётся как была
        if (existing) cleanupArt(existing)
        else fs.rmSync(dir, { recursive: true, force: true })
        throw new Error('cancelled')
      } else {
        // Сервер не ответил — сохраняем игру без этого файла (или со старым артом)
        failed.push(ART_NAMES[field])
        if (existing?.[field] && !media.isRemote(existing[field])) game[field] = existing[field]
        else delete game[field]
      }
    } else if (value !== existing?.[field] && fs.existsSync(value)) {
      game[field] = media.copyArt(value, dir, field)
    }
  }
  if (failed.length && !opts.quiet) {
    toast('Часть арта не скачалась', `${failed.join(', ')}: сервер не ответил. Попробуйте ещё раз в редакторе игры или выберите другой источник.`)
  }
  for (const key of ['args', 'workDir', 'customCommand', 'trackProcess', 'serial'] as const) {
    if (!game[key]?.trim()) delete game[key]
  }
  if (!game.steamAppId) delete game.steamAppId
  if (!game.raGameId) delete game.raGameId
  // Сменилась привязка к Steam / RetroAchievements — старые трофеи больше не относятся к игре
  if (existing && (existing.steamAppId !== game.steamAppId || existing.raGameId !== game.raGameId)) ach.forget(id)

  // Цвет обложки: подсветка DualSense и акценты интерфейса
  const accent = gameAccent(game)
  if (accent) game.accent = accent
  else {
    delete game.accent
    if (existing) delete existing.accent
  }

  if (existing) Object.assign(existing, game)
  else db.games.push(game)
  saveDbNow()
  cleanupArt(game)
  broadcast()
  return existing ?? game
}

/** Удаляет из папки арта файлы, на которые игра больше не ссылается. */
function cleanupArt(game: Game) {
  const dir = artDir(game.id)
  if (!fs.existsSync(dir)) return
  const used = new Set(ART_FIELDS.map((f) => game[f]).filter(Boolean))
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f)
    if (!used.has(p)) fs.rmSync(p, { force: true })
  }
}

const knownPaths = () => new Set(getDb().games.map((g) => g.path.toLowerCase()))

function walk(dir: string, exts: string[], depth = 3, out: string[] = []) {
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory() && depth > 0) walk(p, exts, depth - 1, out)
    else if (e.isFile() && exts.includes(path.extname(e.name).toLowerCase())) out.push(p)
  }
  return out
}

async function scanPs2Folder() {
  const res = await dialog.showOpenDialog(win!, { title: 'Папка с играми PS2', properties: ['openDirectory'] })
  if (res.canceled || !res.filePaths[0]) return 0
  const known = knownPaths()
  const files = walk(res.filePaths[0], media.PS2_EXTENSIONS).filter((f) => !known.has(f.toLowerCase()))
  toast('Сканирование', `Найдено новых образов: ${files.length}`)
  let added = 0
  // Небольшими пачками, чтобы не забивать сеть при загрузке обложек
  for (let i = 0; i < files.length; i += 4) {
    await Promise.all(
      files.slice(i, i + 4).map(async (file) => {
        const info = await media.inspectPs2(file, getDb().settings.pcsx2Path)
        await saveGame({ title: info.title ?? media.cleanTitle(file), platform: 'ps2', path: file, serial: info.serial, cover: info.cover })
        added++
      })
    )
  }
  return added
}

async function importRpcs3() {
  const { rpcs3Path } = getDb().settings
  if (!rpcs3Path || !fs.existsSync(rpcs3Path)) throw new Error('Сначала укажите путь к rpcs3.exe в настройках')
  const root = path.dirname(rpcs3Path)
  const targets = new Set<string>()
  for (const yml of [path.join(root, 'config', 'games.yml'), path.join(root, 'games.yml')]) {
    if (!fs.existsSync(yml)) continue
    for (const m of fs.readFileSync(yml, 'utf8').matchAll(/^[A-Z]{4}\d{5}:\s*"?(.+?)"?\s*$/gm)) targets.add(m[1])
  }
  const hdd = path.join(root, 'dev_hdd0', 'game')
  if (fs.existsSync(hdd)) {
    for (const d of fs.readdirSync(hdd)) {
      const sfo = path.join(hdd, d, 'PARAM.SFO')
      if (fs.existsSync(sfo) && media.readSfo(sfo).CATEGORY === 'HG') targets.add(path.join(hdd, d))
    }
  }
  const known = knownPaths()
  let added = 0
  for (const t of targets) {
    if (!fs.existsSync(t)) continue
    const info = await media.inspectPs3(t)
    if (!info.path || !fs.existsSync(info.path) || known.has(info.path.toLowerCase())) continue
    await saveGame({ title: info.title ?? t, platform: 'ps3', path: info.path, serial: info.serial, cover: info.cover, hero: info.hero })
    added++
  }
  return added
}

const PICK_FILTERS: Record<PickKind, Electron.OpenDialogOptions> = {
  exe: { title: 'Выберите игру', filters: [{ name: 'Игры и ярлыки', extensions: ['exe', 'lnk', 'bat', 'cmd', 'url'] }] },
  ps2: { title: 'Образ PS2', filters: [{ name: 'Образы PS2', extensions: media.PS2_EXTENSIONS.map((e) => e.slice(1)) }] },
  ps3: {
    title: 'EBOOT.BIN или образ PS3',
    filters: [
      { name: 'Игры PS3', extensions: ['bin', 'BIN', 'iso', 'self', 'elf'] },
      { name: 'Все файлы', extensions: ['*'] }
    ]
  },
  ps3folder: { title: 'Папка игры PS3', properties: ['openDirectory'] },
  image: { title: 'Изображение', filters: [{ name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] },
  emulator: { title: 'Исполняемый файл эмулятора', filters: [{ name: 'Программы', extensions: ['exe'] }] },
  folder: { title: 'Папка', properties: ['openDirectory'] },
  backup: { title: 'Копия данных PlayOS', filters: [{ name: 'Копия PlayOS', extensions: ['playos'] }] }
}

/** Видео для живого фона: отдаём кусками по Range, иначе <video> не умеет перематывать и зацикливать */
function serveVideo(file: string, range: string | null) {
  const size = fs.statSync(file).size
  const type = file.toLowerCase().endsWith('.webm') ? 'video/webm' : 'video/mp4'
  const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null
  const body = (start: number, end: number) => Readable.toWeb(fs.createReadStream(file, { start, end })) as unknown as ReadableStream
  if (!m || (!m[1] && !m[2])) {
    return new Response(body(0, size - 1), { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } })
  }
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]))
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
  return new Response(body(start, end), {
    status: 206,
    headers: {
      'Content-Type': type,
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes'
    }
  })
}

function applySettings(prev: Settings, next: Settings) {
  if (prev.fullscreen !== next.fullscreen) win?.setFullScreen(next.fullscreen)
  if (app.isPackaged && prev.launchOnStartup !== next.launchOnStartup) {
    app.setLoginItemSettings({ openAtLogin: next.launchOnStartup })
  }
  // Выбрали другой экран — переезжаем сразу
  if (prev.displayId !== next.displayId) moveToTargetDisplay()
  // Подсветку включили или выключили посреди игры
  if (prev.dsxLightbar !== next.dsxLightbar) {
    const r = launcher.running()
    if (next.dsxLightbar && r) applyGameLight(r.gameId)
    else if (!next.dsxLightbar && gameLight) {
      holdLightbar(null)
      gameLight = null
    }
  }
}

/** Копирует выбранный аватар в папку данных, старый файл удаляет. */
function storeAvatar(src: string | undefined, old: string | undefined) {
  const own = (p?: string) => !!p && path.dirname(p) === dataDir()
  if (src && src === old) return old
  if (own(old)) fs.rmSync(old!, { force: true })
  if (!src || !fs.existsSync(src)) return undefined
  const file = path.join(dataDir(), `avatar-${Date.now().toString(36)}${path.extname(src).toLowerCase() || '.png'}`)
  fs.copyFileSync(src, file)
  return file
}

// ───────────────────────── Статус геймпада и перерывы ─────────────────────────

let lastPadStatus = ''
function readPadStatus(): PadStatus {
  let connected = 0
  let battery: PadStatus['battery'] = null
  for (let i = 0; i < 4; i++) {
    if (!readPad(i)) continue
    connected++
    battery ??= readBattery(i)
  }
  // DSX знает о DualSense больше всех (точный процент заряда) — его данные в приоритете
  const dsx = dsxStatus()
  if (dsx?.connected) return { connected: Math.max(1, connected), battery: dsx.battery, percent: dsx.percent, source: 'dsx' }
  // DualSense / DualShock 4 по HID
  const hid = hidStatus()
  if (hid.connected && !battery) return { connected: connected + hid.connected, battery: hid.battery, percent: hid.percent, source: 'hid' }
  return { connected: connected + hid.connected, battery, source: 'xinput' }
}

function pollPadStatus() {
  const status = readPadStatus()
  const key = JSON.stringify(status)
  if (key !== lastPadStatus) {
    lastPadStatus = key
    send('pad-status', status)
  }
  checkBattery(status)
}

// Предупреждаем один раз за разряд: снова — только после зарядки выше 15%
let batteryWarned = false
const LOW_BATTERY = 10

function checkBattery(st: PadStatus) {
  const charging = st.battery === 'wired'
  // Процент есть у DSX и HID; у XInput только уровни — «пустой» примерно соответствует 10%
  const low = st.percent !== undefined ? st.percent <= LOW_BATTERY : st.battery === 'empty'
  const recovered = charging || !st.connected || (st.percent !== undefined ? st.percent > 15 : st.battery !== 'empty' && st.battery !== null)
  if (recovered) batteryWarned = false
  if (!low || charging || !st.connected || batteryWarned) return
  batteryWarned = true
  if (!getDb().settings.lowBatteryWarning) return
  const left = st.percent !== undefined ? `Осталось ${st.percent}%.` : 'Заряд почти закончился.'
  const notice: SystemNotice = { kind: 'battery', title: 'Геймпад разряжается', message: `${left} Подключите зарядку, чтобы не прерывать игру.` }
  if (launcher.running()) showOverlayNotice(notice)
  else toast(notice.title, notice.message)
  // Красная пульсация световой панели DualSense (через DSX)
  void pulseLightbar([255, 0, 0])
}

let remindersShown = 0
function checkBreakReminder() {
  const r = launcher.running()
  const hours = getDb().settings.breakReminder
  if (!r || !hours) {
    remindersShown = 0
    return
  }
  const due = Math.floor((Date.now() - r.startedAt) / (hours * 3600_000))
  if (due > remindersShown) {
    remindersShown = due
    const game = findGame(r.gameId)
    const played = due * hours
    new Notification({
      title: 'Время сделать перерыв',
      body: `Вы играете в «${game?.title ?? 'игру'}» уже ${played} ч. Разомнитесь и отдохните глазам.`
    }).show()
  }
}

// ───────────────────────── Трофеи во время игры и подсветка DualSense ─────────────────────────

let litGameId: string | null = null
let gameLight: [number, number, number] | null = null
let toastTimer: NodeJS.Timeout | null = null

/** Подсветка DualSense в цвет обложки игры (через DSX) */
function applyGameLight(gameId: string) {
  if (!getDb().settings.dsxLightbar) return
  const game = findGame(gameId)
  if (!game) return
  gameLight = (game.accent && fromHex(game.accent)) || PLATFORM_COLOR[game.platform]
  holdLightbar(gameLight)
}

/** Уведомление о трофее поверх игры */
function showOverlayToast(n: AchievementNotice) {
  if (!alive(overlay)) return
  sendTo(overlay, 'overlay-toast', n)
  showOverlayPassive()
}

/** Системное уведомление поверх игры (разряд геймпада) */
function showOverlayNotice(n: SystemNotice) {
  if (!alive(overlay)) return
  sendTo(overlay, 'overlay-notice', n)
  showOverlayPassive()
}

/** Оверлей показывается без фокуса и пропускает клики — только чтобы было видно уведомление */
function showOverlayPassive() {
  if (!alive(overlay) || overlayOpen) return
  const fg = foregroundWindow()
  const rect = windowRect(gameInForeground() ? fg : gameHwnd)
  const display = rect
    ? screen.getDisplayMatching(screen.screenToDipRect(null, rect))
    : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  overlay.setBounds(display.bounds)
  overlay.setIgnoreMouseEvents(true)
  overlay.setFocusable(false)
  overlay.showInactive()
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    if (!overlayOpen && alive(overlay)) overlay.hide()
  }, 6500)
}

function notifyTrophies(n: AchievementNotice) {
  const s = getDb().settings
  sendTo(win, 'ach-new', n)
  send('ach-summary')
  if (s.trophyPopups) showOverlayToast(n)
  if (s.trophyRumble) {
    // Два коротких импульса, как звук трофея
    void rumble([
      [22000, 42000, 110],
      [0, 0, 90],
      [16000, 52000, 200]
    ])
  }
  if (s.dsxLightbar) void flashLightbar([255, 214, 90])
}

let checking = false
/** Раз в минуту проверяем, не получен ли новый трофей в запущенной игре */
async function checkTrophies() {
  const r = launcher.running()
  if (!r || checking || r.phase !== 'running') return
  const game = findGame(r.gameId)
  const s = getDb().settings
  if (!game || (!s.trophyPopups && !s.trophyRumble)) return
  if (game.platform === 'ps2' ? !s.raKey : game.platform === 'pc' ? !s.steamKey : true) return
  checking = true
  try {
    const fresh = await ach.newSince(r.gameId)
    if (fresh.length) notifyTrophies({ gameId: r.gameId, gameTitle: game.title, items: fresh })
  } finally {
    checking = false
  }
}

/** Все геймпады для пункта управления (без дублей: DSX сам эмулирует Xbox-геймпад) */
function controllers(): ControllerInfo[] {
  const list: ControllerInfo[] = []
  const dsx = dsxStatus()
  let skipXinput = 0
  if (dsx?.connected) {
    list.push({ id: 'dsx', name: 'DualSense', kind: 'dualsense', via: ['DSX', dsx.connection].filter(Boolean).join(', '), battery: dsx.battery, percent: dsx.percent })
    skipXinput = 1
  }
  for (const p of hidControllers()) {
    if (dsx?.connected && p.kind === 'dualsense') continue
    list.push({
      id: p.key,
      name: p.kind === 'dualsense' ? 'DualSense' : 'DualShock 4',
      kind: p.kind,
      via: p.bt ? 'Bluetooth' : 'USB',
      battery: p.battery,
      percent: p.percent
    })
  }
  for (let i = 0; i < 4; i++) {
    if (!readPad(i)) continue
    if (skipXinput > 0) {
      skipXinput--
      continue
    }
    list.push({ id: `x${i}`, name: `Геймпад Xbox ${i + 1}`, kind: 'xbox', via: 'XInput', battery: readBattery(i) })
  }
  return list
}

// ───────────────────────── IPC ─────────────────────────

function registerIpc() {
  ipcMain.handle('state:get', () => state())
  ipcMain.handle('pad:status', () => readPadStatus())
  ipcMain.handle('game:save', async (_e, draft: GameDraft) => {
    // Сохранение из редактора: с прогрессом загрузки арта и отменой по ○
    editorSave?.abort()
    const ctrl = new AbortController()
    editorSave = ctrl
    try {
      return await saveGame(draft, { signal: ctrl.signal, onProgress: (p) => sendTo(win, 'save-progress', p) })
    } finally {
      if (editorSave === ctrl) editorSave = null
    }
  })
  ipcMain.handle('game:cancelSave', () => editorSave?.abort())
  ipcMain.handle('game:delete', (_e, id: string) => {
    const db = getDb()
    db.games = db.games.filter((g) => g.id !== id)
    fs.rmSync(artDir(id), { recursive: true, force: true })
    ach.forget(id)
    forgetDetails(id)
    saveDb()
    broadcast()
  })
  ipcMain.handle('game:favorite', (_e, id: string, value: boolean) => {
    const g = findGame(id)
    if (g) g.favorite = value
    saveDb()
    broadcast()
  })
  ipcMain.handle('game:resetPlaytime', (_e, id: string) => {
    const g = findGame(id)
    if (g) {
      g.playtime = 0
      g.sessions = []
    }
    saveDb()
    broadcast()
  })
  ipcMain.handle('settings:save', (_e, patch: Partial<Settings>) => {
    const db = getDb()
    const prev = db.settings
    db.settings = { ...prev, ...patch }
    if ('avatar' in patch) db.settings.avatar = storeAvatar(patch.avatar, prev.avatar)
    applySettings(prev, db.settings)
    saveDb()
    broadcast()
    return db.settings
  })
  ipcMain.handle('game:launch', async (_e, id: string) => {
    const game = findGame(id)
    if (!game) return { ok: false, error: 'Игра не найдена' }
    const res = await launcher.launchGame(game, getDb().settings)
    log(res.ok ? 'INFO' : 'WARN', `Запуск «${game.title}» (${game.platform})${res.ok ? '' : `: ${res.error}`}`)
    if (res.ok) {
      if (launchTimer) clearTimeout(launchTimer)
      // Если игра так и не забрала фокус (медленная загрузка) — всё равно уходим с экрана
      launchTimer = setTimeout(() => {
        if (launcher.running()?.phase === 'launching') {
          launcher.setPhase('running')
          if (!overlayOpen) win?.minimize()
        }
      }, 20000)
    }
    return res
  })
  ipcMain.handle('game:close', () => {
    // Размораживаем, чтобы игра могла корректно закрыться сама (сохранить настройки и т. п.)
    unfreezeGame()
    return launcher.closeGame()
  })
  ipcMain.handle('game:resume', () => (overlayOpen ? closeOverlay('game') : resumeFromHome()))
  ipcMain.handle('overlay:home', () => closeOverlay('home'))
  ipcMain.handle('emu:state', () => emuState())
  ipcMain.handle('emu:save', (_e, slot: number) => saveState(slot))
  ipcMain.handle('emu:load', (_e, slot: number) => loadState(slot))
  ipcMain.handle('pcsx2:info', () => pcsx2Info())
  ipcMain.handle('pcsx2:enablePine', () => enablePine())
  // Пункт управления
  ipcMain.handle('details:get', (_e, id: string, refresh?: boolean) => {
    const g = findGame(id)
    return g ? gameDetails(g, refresh) : {}
  })
  ipcMain.handle('live:get', (_e, id: string) => {
    const g = findGame(id)
    return g && getDb().settings.liveBackground ? liveBackground(g) : null
  })
  ipcMain.handle('steam:scan', () => scanSteam(getDb().games))
  ipcMain.handle('steam:import', async (_e, appIds: number[]) => {
    const picked = (await scanSteam(getDb().games)).filter((g) => appIds.includes(g.appId) && !g.added)
    const art = await media.steamArtFor(picked.map((g) => ({ appId: g.appId, name: g.name })))
    let done = 0
    const report = (title: string) => sendTo(win, 'import-progress', { done, total: picked.length, title } satisfies ImportProgress)
    for (const g of picked) {
      report(g.name)
      const a = art.get(g.appId)
      // Не у всех игр есть библиотечный арт — проверяем ссылки, чтобы не сохранять битые
      const v = a ? await media.verifyCandidate(a).catch(() => a) : undefined
      try {
        await saveGame(
          { title: g.name, platform: 'pc', path: g.dir, launcher: 'steam', steamAppId: g.appId, cover: v?.cover, hero: v?.hero, logo: v?.logo },
          { quiet: true }
        )
        done++
      } catch {
        /* игру без арта всё равно не теряем: saveGame бросает только при отмене */
      }
    }
    report('')
    return done
  })
  ipcMain.handle('update:state', () => updateState())
  ipcMain.handle('update:check', () => checkForUpdates())
  ipcMain.handle('update:install', () => {
    // Выход ради установки — без аутро и без перехвата закрытия окна
    allowQuit = true
    return installUpdate()
  })
  ipcMain.handle('sys:info', () => systemInfo())
  ipcMain.handle('fs:exists', (_e, p: string) => !!p && fs.existsSync(p))
  ipcMain.handle('log:report', () => saveReport(getDb().settings as unknown as Record<string, unknown>, getDb().games.length))
  // Перенос на другой компьютер: копия данных одним файлом и восстановление из неё
  ipcMain.handle('data:export', () => {
    saveDbNow()
    const file = exportData(dataDir(), getDb().games.length)
    log('INFO', 'Копия данных сохранена:', file)
    return file
  })
  ipcMain.handle('data:inspect', (_e, file: string) => inspectBackup(file))
  ipcMain.handle('data:import', (_e, file: string) => {
    if (launcher.running()) launcher.endSession()
    saveDbNow()
    const safety = importData(file, dataDir(), getDb().games.length)
    log('INFO', 'Данные восстановлены из', file, '— прежние сохранены в', safety)
    // Перезапуск без before-quit: иначе PlayOS записал бы старую библиотеку поверх восстановленной
    stopHelper()
    fs.rmSync(path.join(dataDir(), 'running.lock'), { force: true })
    app.relaunch()
    setTimeout(() => app.exit(0), 300)
    return true
  })
  ipcMain.handle('sys:displays', () => ({
    list: listDisplays(),
    current: win ? screen.getDisplayMatching(win.getBounds()).id : screen.getPrimaryDisplay().id
  }))
  ipcMain.handle('dsx:test', async () => {
    if (!dsxStatus()) return 'no-dsx'
    if (!lightbarReady()) return 'no-pad'
    await testLightbar()
    return 'ok'
  })
  ipcMain.handle('sys:state', (_e, withBrightness?: boolean) => systemState(withBrightness ?? true))
  ipcMain.handle('sys:volume', (_e, v: number) => setVolume(v))
  ipcMain.handle('sys:mute', (_e, m: boolean) => setMute(m))
  ipcMain.handle('sys:device', (_e, id: string) => setAudioDevice(id))
  ipcMain.handle('sys:brightness', (_e, v: number) => setBrightness(v))
  ipcMain.handle('sys:controllers', () => controllers())
  // Трофеи игр
  ipcMain.handle('ach:get', (_e, gameId: string, refresh?: boolean) => ach.getAchievements(gameId, refresh))
  ipcMain.handle('ach:summary', () => ach.summary())
  ipcMain.handle('ach:findRa', (_e, q: string) => ach.findRaGames(q))
  ipcMain.handle('ach:linkRa', async (_e, gameId: string, raId: number) => {
    const res = await ach.linkRaGame(gameId, raId)
    broadcast()
    send('ach-summary')
    return res
  })
  ipcMain.handle('ach:test', () => ach.testAccounts())
  ipcMain.handle('dialog:pick', async (_e, kind: PickKind) => {
    const opts = PICK_FILTERS[kind]
    const res = await dialog.showOpenDialog(win!, { properties: ['openFile'], ...opts })
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
  ipcMain.handle('game:inspect', (_e, platform: Platform, file: string) =>
    media.inspect(platform, file, getDb().settings.pcsx2Path, path.join(dataDir(), 'art', '_tmp'))
  )
  ipcMain.handle('art:search', async (_e, query: string, platform: Platform, serial?: string, source: ArtSource = 'steam') => {
    const search =
      source === 'steamgriddb'
        ? media.searchSteamGridDB(query, getDb().settings.steamGridDbKey)
        : source === 'wiki'
          ? media.searchWikipedia(query)
          : media.searchSteam(query).then((list) => Promise.all(list.map(media.verifyCandidate)))
    const [disc, found] = await Promise.all([media.discCandidate(platform, serial), search])
    return disc ? [disc, ...found] : found
  })
  ipcMain.handle('scan:ps2', () => scanPs2Folder())
  ipcMain.handle('scan:rpcs3', () => importRpcs3())
  ipcMain.handle('shell:openFolder', (_e, p: string) => {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) shell.showItemInFolder(p)
    else shell.openPath(p)
  })
  ipcMain.handle('power', (_e, action: PowerAction) => {
    if (action === 'quit') {
      allowQuit = true
      return app.quit()
    }
    // Windows закроет PlayOS вместе с системой — сохраняем всё заранее, время текущей игры тоже
    if (action !== 'sleep') {
      if (launcher.running()) launcher.endSession()
      saveDbNow()
    }
    const cmd = {
      shutdown: 'shutdown /s /t 0',
      restart: 'shutdown /r /t 0',
      sleep: 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0'
    }[action]
    exec(cmd)
  })
}

/** Сколько занимает папка данных: арт, видео живого фона и всё вместе */
function dataUsage() {
  let art = 0
  let video = 0
  let total = 0
  const walk = (dir: string, inArt: boolean) => {
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p, inArt || (dir === dataDir() && e.name === 'art'))
      else {
        let size = 0
        try {
          size = fs.statSync(p).size
        } catch {
          continue
        }
        total += size
        if (inArt && /\.(mp4|webm)$/i.test(e.name)) video += size
        else if (inArt) art += size
      }
    }
  }
  walk(dataDir(), false)
  return { art, video, total }
}

/** Сведения для окна «О системе» */
async function systemInfo(): Promise<SystemInfo> {
  let gpu = 'Не удалось определить'
  try {
    const info = (await app.getGPUInfo('complete')) as { auxAttributes?: { glRenderer?: string } }
    // «ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)» → «NVIDIA GeForce RTX 3070»
    const raw = info.auxAttributes?.glRenderer ?? ''
    const m = /ANGLE \([^,]+,\s*(.+?)(?:\s+Direct3D|\s*\(0x|,)/.exec(raw)
    gpu = (m?.[1] ?? raw) || gpu
  } catch {
    /* оставим «не удалось» */
  }
  const cpus = os.cpus()
  const primary = screen.getPrimaryDisplay().id
  const here = win ? screen.getDisplayMatching(win.getBounds()).id : primary
  const db = getDb()
  const usage = dataUsage()
  const name = os.version().replace(/^Microsoft\s+/, '')
  return {
    app: {
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      installDir: path.dirname(process.execPath),
      dataDir: dataDir(),
      packaged: app.isPackaged
    },
    os: { name, build: os.release(), uptimeMin: Math.floor(os.uptime() / 60) },
    cpu: { model: cpus[0]?.model.trim() ?? '—', threads: cpus.length },
    gpu,
    memory: { total: os.totalmem(), free: os.freemem() },
    displays: screen.getAllDisplays().map((d, i) => ({
      name: d.label || `Экран ${i + 1}`,
      width: Math.round(d.size.width * d.scaleFactor),
      height: Math.round(d.size.height * d.scaleFactor),
      hz: Math.round(d.displayFrequency),
      primary: d.id === primary,
      current: d.id === here
    })),
    pads: controllers().map((c) => ({ name: c.name, kind: c.kind, via: c.via, percent: c.percent, battery: c.battery })),
    library: {
      games: db.games.length,
      hours: Math.round(db.games.reduce((a, g) => a + g.playtime, 0) / 360) / 10,
      artBytes: usage.art,
      videoBytes: usage.video,
      totalBytes: usage.total
    }
  }
}

/** Ярлык в меню «Пуск» с AppUserModelId — без него Windows не подписывает уведомления именем PlayOS */
function ensureStartMenuShortcut() {
  const lnk = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'PlayOS.lnk')
  try {
    const cur = fs.existsSync(lnk) ? shell.readShortcutLink(lnk) : null
    if (cur && cur.target === process.execPath && cur.appUserModelId === APP_ID) return
    shell.writeShortcutLink(lnk, cur ? 'replace' : 'create', {
      target: process.execPath,
      cwd: path.dirname(process.execPath),
      appUserModelId: APP_ID,
      description: 'PlayOS — игровой лаунчер'
    })
  } catch {
    /* без ярлыка уведомления просто будут без имени */
  }
}

function backfillAccents() {
  let changed = false
  for (const g of getDb().games) {
    if (g.accent) continue
    const accent = gameAccent(g)
    if (accent) {
      g.accent = accent
      changed = true
    }
  }
  if (changed) {
    saveDb()
    broadcast()
  }
}

// ───────────────────────── Старт ─────────────────────────

app.on('second-instance', () => bringToFront())

app.whenReady().then(() => {
  loadDb()
  launcher.recoverSession()

  protocol.handle('pcs', (req) => {
    const p = new URL(req.url).searchParams.get('p')
    if (!p || !/\.(png|jpe?g|webp|gif|bmp|ico|mp4|webm)$/i.test(p)) return new Response(null, { status: 404 })
    if (!fs.existsSync(p)) return new Response(null, { status: 404 })
    if (/\.(mp4|webm)$/i.test(p)) return serveVideo(p, req.headers.get('range'))
    return net.fetch(pathToFileURL(p).toString()).catch(() => new Response(null, { status: 404 }))
  })

  registerIpc()
  createWindow()
  startUpdater((st) => send('update-state', st))
  // Проснулись после сна — интерфейс убирает затемнение «Спящий режим»
  powerMonitor.on('resume', () => sendTo(win, 'power-resume'))
  // Выбранный экран подключили позже (включили телевизор) — переезжаем на него
  screen.on('display-added', () => setTimeout(moveToTargetDisplay, 800))
  if (app.isPackaged) {
    // Путь к exe мог смениться (установка в новую папку) — обновляем автозапуск и ярлык в «Пуске»
    if (getDb().settings.launchOnStartup) app.setLoginItemSettings({ openAtLogin: true })
    ensureStartMenuShortcut()
  }
  // Игры, добавленные до 0.6.1, ещё без цвета обложки — считаем один раз, не задерживая старт
  setTimeout(backfillAccents, 1500)

  launcher.events.on('change', () => {
    const r = launcher.running()
    if (!r) keySlot = 1
    // Игра только что запустилась — подсветка DualSense в цвет игры
    if (r && r.gameId !== litGameId) {
      litGameId = r.gameId
      applyGameLight(r.gameId)
    }
    broadcast()
  })
  launcher.events.on('end', (e: { gameId: string; duration: number }) => {
    if (launchTimer) clearTimeout(launchTimer)
    frozen = []
    litGameId = null
    if (gameLight) holdLightbar(null)
    gameLight = null
    // Обновляем трофеи сыгранной игры для профиля и главного экрана
    void ach.getAchievements(e.gameId, true).then(() => send('ach-summary'))
    if (overlayOpen) void closeOverlay('none')
    bringToFront()
    send('session-end', e)
  })

  createOverlayWindow()
  startHid()
  startDsx()
  startGamepad({
    onHotkey,
    onNav: (a) => sendTo(overlay, 'pad', a),
    // Пересылаем навигацию, только когда оверлей открыт, но Windows не отдала ему фокус
    shouldForward: () => overlayOpen && alive(overlay) && !overlay.isFocused()
  })
  globalShortcut.register('Control+Alt+H', onHotkey)
  setInterval(pollPadStatus, 3000)
  setInterval(checkBreakReminder, 60_000)
  setInterval(checkTrophies, 60_000)
  win?.webContents.on('did-finish-load', () => {
    lastPadStatus = ''
    pollPadStatus()
  })
  // Прошлый запуск упал — подсказываем, где взять отчёт (после интро, один раз)
  if (lastRunCrashed()) {
    win?.webContents.once('did-finish-load', () =>
      setTimeout(() => toast('PlayOS в прошлый раз закрылся с ошибкой', 'Если это повторяется, сохраните отчёт: Настройки → Система → «Сохранить отчёт об ошибках».'), 6000)
    )
  }
})

app.on('before-quit', () => {
  stopHelper()
  if (gameLight) holdLightbar(null)
  // Никогда не оставляем игру замороженной
  unfreezeGame()
  if (launcher.running()) launcher.endSession()
  saveDbNow()
})
app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => app.quit())
