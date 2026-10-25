import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { CloudRestoreChoice, CloudRestoreOffer, CloudStatus, CloudSyncState, Game, GameCloudStatus, SaveConflict, SaveVersion, Settings } from '@shared/types'
import { log } from '../log'
import { dataDir } from '../store'
import * as account from './account'
import { cloudOffer, syncLibrary, syncProfile, type Hooks, type Seen } from './library'
import { updateManifest } from './ludusavi'
import { saveSetsFor, type SaveSet } from './locate'
import { OfflineError, type Remote } from './remote'
import { apply, localState, pack, type LocalState } from './snapshot'

/**
 * Синхронизация сохранений. В облаке:
 *   saves/<ключ>/<время>_<устройство>_<хэш>.zip — неизменяемые снимки (история версий)
 *   devices/<id>.json — имя ПК и «головы»: какой снимок у этого ПК сейчас по каждому ключу
 * Каждый ПК пишет только свой файл devices/, поэтому одновременная работа двух ПК ничего не перезаписывает.
 * Опрос облака — один список devices/: если чужой файл изменился, значит у кого-то новые сохранения.
 *
 * Решение по набору сохранений — сравнение трёх хэшей: локального, облачного и базы (на чём сошлись в прошлый раз).
 */

export type Action = 'none' | 'synced' | 'upload' | 'download' | 'conflict'

/** Чистая логика сравнения — её же проверяет скрипт в .claude/tools */
export function decide(local: string | null, base: string | undefined, cloud: string | null): Action {
  if (!local && !cloud) return 'none'
  if (!cloud) return 'upload'
  if (!local) return 'download'
  if (local === cloud) return 'synced'
  if (local === base) return 'download'
  if (cloud === base) return 'upload'
  return 'conflict'
}

interface Head {
  name: string
  at: number
  device: string
  hash: string
}

interface DeviceFile {
  id: string
  name: string
  seen: number
  version: string
  heads: Record<string, string>
}

interface SyncStateFile {
  sets: Record<string, { base?: string; lastSync?: number }>
  /** Время изменения чужих devices/*.json при прошлом опросе */
  devices: Record<string, { modified: number; file: DeviceFile }>
  /** Свои головы: что лежит на этом ПК по каждому ключу (копия devices/<свой id>.json) */
  mine: Record<string, string>
  /** Пользователь ответил на предложение подтянуть профиль из облака (или облако было пустым) */
  linked?: boolean
  seen: Seen
}

interface Deps {
  games: () => Game[]
  settings: () => Settings
  /** Игра, которая сейчас запущена: её сохранения трогать нельзя */
  runningGame: () => Game | undefined
  onChange: () => void
  /** Профиль и библиотека: применить настройки из облака, показать изменения, найти установленные игры */
  hooks: Omit<Hooks, 'deviceName'>
  /** Включить или выключить части синхронизации (ответ на предложение восстановить) */
  setCloudSettings: (patch: Partial<NonNullable<Settings['cloud']>>, resetSettingsAt: boolean) => void
}

const SNAP = /^(\d+)_([0-9a-f]{8})_([0-9a-f]{16})\.zip$/
const POLL_MS = 10 * 60_000
const LAUNCH_TIMEOUT = 10_000

const folderOf = (key: string) => key.replace(/[^\w.-]+/g, '_')
const parseSnap = (name: string): Head | null => {
  const m = SNAP.exec(name)
  return m ? { name, at: Number(m[1]), device: m[2], hash: m[3] } : null
}

let deps: Deps
let file: SyncStateFile = { sets: {}, devices: {}, mine: {}, seen: {} }
const stateFile = () => path.join(dataDir(), 'sync-state.json')
let heads = new Map<string, Head>()
let myDirty = false
let queue: Promise<unknown> = Promise.resolve()
let busy = 0
let globalError: string | undefined
let globalState: CloudSyncState = 'off'
let lastRun: number | undefined
let offer: CloudRestoreOffer | null = null
/** Состояние наборов сохранений: по ключу */
const setStatus = new Map<string, { state: CloudSyncState; size?: number; error?: string; conflict?: SaveConflict; dirs?: string[] }>()

const dev8 = () => account.deviceId().replace(/-/g, '').slice(0, 8)

function saveState() {
  fs.writeFileSync(stateFile(), JSON.stringify(file))
}

const cloudOn = () => !!account.remote() && !!deps.settings().cloud
export const enabled = () => cloudOn() && deps.settings().cloud?.saves !== false && file.linked === true

/** Последовательно: два действия над одним облаком одновременно не идут */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task)
  queue = next.catch(() => undefined)
  return next
}

/** Читает devices/ и собирает самые свежие снимки по каждому ключу */
async function refreshHeads(r: Remote) {
  const list = await r.list('devices')
  for (const e of list) {
    const id = e.name.replace(/\.json$/, '')
    if (!e.name.endsWith('.json') || id === account.deviceId()) continue
    const known = file.devices[id]
    if (known && known.modified === e.modified) continue
    try {
      file.devices[id] = { modified: e.modified, file: JSON.parse((await r.read(`devices/${e.name}`)).toString('utf8')) as DeviceFile }
    } catch (err) {
      if (err instanceof OfflineError) throw err
    }
  }
  const all: Record<string, string>[] = [file.mine, ...Object.values(file.devices).map((d) => d.file.heads ?? {})]
  heads = new Map()
  for (const h of all) {
    for (const [folder, name] of Object.entries(h)) {
      const snap = parseSnap(name)
      const cur = heads.get(folder)
      if (snap && (!cur || snap.at > cur.at)) heads.set(folder, snap)
    }
  }
}

async function writeMyDevice(r: Remote) {
  if (!myDirty) return
  const body: DeviceFile = { id: account.deviceId(), name: account.deviceName(), seen: Date.now(), version: app.getVersion(), heads: file.mine }
  await r.write(`devices/${account.deviceId()}.json`, Buffer.from(JSON.stringify(body, null, 2)))
  myDirty = false
}

function deviceLabel(short: string) {
  if (short === dev8()) return account.deviceName()
  const d = Object.values(file.devices).find((x) => x.file.id.replace(/-/g, '').startsWith(short))
  return d?.file.name ?? short
}

/** Старые снимки сверх лимита удаляются; «головы» всех ПК остаются всегда */
async function prune(r: Remote, folder: string) {
  const keep = Math.max(1, deps.settings().cloud?.keepVersions ?? 5)
  const protectedNames = new Set([file.mine[folder], ...Object.values(file.devices).map((d) => d.file.heads?.[folder])])
  const snaps = (await r.list(`saves/${folder}`))
    .map((e) => parseSnap(e.name))
    .filter((s): s is Head => !!s)
    .sort((a, b) => b.at - a.at)
  for (const s of snaps.slice(keep)) if (!protectedNames.has(s.name)) await r.remove(`saves/${folder}/${s.name}`)
}

async function upload(r: Remote, set: SaveSet, local: LocalState) {
  const folder = folderOf(set.key)
  const name = `${Date.now()}_${dev8()}_${local.hash}.zip`
  await r.write(`saves/${folder}/${name}`, pack(local))
  file.mine[folder] = name
  myDirty = true
  heads.set(folder, parseSnap(name)!)
  await prune(r, folder).catch((e) => log('WARN', 'Облако: не удалось убрать старые версии', (e as Error).message))
  log('INFO', `Облако: загружены сохранения ${set.key} (${local.size} байт)`)
}

async function download(r: Remote, set: SaveSet, local: LocalState, head: Head) {
  const folder = folderOf(set.key)
  const data = await r.read(`saves/${folder}/${head.name}`)
  await apply(set, data, local)
  file.mine[folder] = head.name
  myDirty = true
  log('INFO', `Облако: скачаны сохранения ${set.key} с ${deviceLabel(head.device)}`)
}

function blocked(set: SaveSet) {
  const run = deps.runningGame()
  if (!run) return false
  // Обычная карта памяти PS2 общая: пока идёт любая игра PS2, её не трогаем
  return saveSetsFor(run, deps.settings()).some((s) => s.key === set.key) || (set.key.startsWith('ps2card:') && run.platform === 'ps2')
}

async function syncSet(r: Remote, game: Game, set: SaveSet, force?: 'local' | 'cloud'): Promise<SaveConflict | null> {
  const st = (file.sets[set.key] ??= {})
  const status = { state: 'syncing' as CloudSyncState, dirs: set.patterns }
  setStatus.set(set.key, status)
  deps.onChange()
  try {
    if (blocked(set)) {
      setStatus.set(set.key, { ...status, state: 'pending' })
      return null
    }
    const local = await localState(set)
    const head = heads.get(folderOf(set.key)) ?? null
    let action: Action = force === 'local' ? (local.hash ? 'upload' : 'none') : force === 'cloud' ? (head ? 'download' : 'none') : decide(local.hash, st.base, head?.hash ?? null)
    if (action === 'upload' && !force) {
      // Пока мы считали, другой ПК мог загрузить своё: перечитываем головы перед записью
      await refreshHeads(r)
      const fresh = heads.get(folderOf(set.key))
      if (fresh && fresh.hash !== st.base && fresh.hash !== local.hash) action = 'conflict'
    }
    if (action === 'upload') await upload(r, set, local)
    else if (action === 'download' && head) await download(r, set, local, head)
    if (action === 'conflict' && head) {
      const conflict: SaveConflict = {
        gameId: game.id,
        key: set.key,
        local: { at: local.at, size: local.size },
        cloud: { name: head.name, at: head.at, device: deviceLabel(head.device), size: 0, hash: head.hash }
      }
      setStatus.set(set.key, { state: 'conflict', size: local.size, conflict, dirs: set.patterns })
      return conflict
    }
    if (action !== 'none') {
      st.base = action === 'download' && head ? head.hash : local.hash ?? undefined
      st.lastSync = Date.now()
    }
    setStatus.set(set.key, { state: action === 'none' ? 'nosaves' : 'synced', size: local.size, dirs: set.patterns })
    return null
  } catch (e) {
    const offline = e instanceof OfflineError
    if (!offline) log('WARN', `Облако: ${set.key}:`, (e as Error).message)
    setStatus.set(set.key, { state: offline ? 'offline' : 'error', error: (e as Error).message, dirs: set.patterns })
    if (offline) throw e
    return null
  } finally {
    deps.onChange()
  }
}

/** Синхронизирует игры; возвращает первый конфликт (для запуска игры) */
function syncGames(games: Game[], force?: 'local' | 'cloud'): Promise<SaveConflict | null> {
  return enqueue(async () => {
    const r = account.remote()
    if (!r || !cloudOn()) return null
    busy++
    globalState = 'syncing'
    deps.onChange()
    let first: SaveConflict | null = null
    try {
      // Новый ПК или переустановка: если в облаке уже есть профиль — сначала спрашиваем, что подтянуть
      if (!file.linked) {
        offer = await cloudOffer(r)
        if (offer) return null
        file.linked = true
      }
      const cloud = deps.settings().cloud
      const hooks = { ...deps.hooks, deviceName: account.deviceName() }
      if (cloud?.profile !== false) await syncProfile(r, file.seen, hooks)
      if (cloud?.library !== false) await syncLibrary(r, file.seen, hooks)
      if (!enabled()) return null
      await refreshHeads(r)
      const done = new Set<string>()
      for (const game of games) {
        for (const set of saveSetsFor(game, deps.settings())) {
          if (done.has(set.key)) continue
          done.add(set.key)
          const c = await syncSet(r, game, set, force)
          first ??= c
        }
      }
      await writeMyDevice(r)
      globalError = undefined
      globalState = [...setStatus.values()].some((s) => s.state === 'conflict') ? 'conflict' : 'synced'
      lastRun = Date.now()
    } catch (e) {
      globalState = e instanceof OfflineError ? 'offline' : 'error'
      globalError = (e as Error).message
    } finally {
      busy--
      saveState()
      deps.onChange()
    }
    return first
  })
}

export function syncAll() {
  return syncGames(deps.games())
}

/** Перед запуском: свежие сохранения из облака. Нет сети или долго — запускаем с локальными */
export async function beforeLaunch(game: Game): Promise<SaveConflict | null> {
  if (!enabled() || !saveSetsFor(game, deps.settings()).length) return null
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), LAUNCH_TIMEOUT))
  return Promise.race([syncGames([game]).catch(() => null), timeout])
}

/** После выхода из игры: процессы закрылись, но игра могла дописывать файлы — ждём пару секунд */
export function afterExit(game: Game) {
  if (!enabled()) return
  setTimeout(() => void syncGames([game]), 4000)
}

export function resolve(game: Game, choice: 'local' | 'cloud') {
  return syncGames([game], choice)
}

export function gameStatus(game: Game): GameCloudStatus {
  if (!enabled()) return { state: 'off' }
  const sets = saveSetsFor(game, deps.settings())
  if (!sets.length) return { state: 'nosaves' }
  const list = sets.map((s) => setStatus.get(s.key)).filter((s) => !!s)
  const order: CloudSyncState[] = ['conflict', 'error', 'offline', 'syncing', 'pending', 'synced', 'nosaves']
  const worst = order.find((o) => list.some((s) => s.state === o)) ?? 'pending'
  const lastSync = Math.max(0, ...sets.map((s) => file.sets[s.key]?.lastSync ?? 0)) || undefined
  return {
    state: worst,
    lastSync,
    size: list.reduce((a, s) => a + (s.size ?? 0), 0),
    error: list.find((s) => s.error)?.error,
    conflict: list.find((s) => s.conflict)?.conflict,
    dirs: sets.flatMap((s) => s.patterns)
  }
}

export function status(): CloudStatus {
  return {
    account: account.cachedAccount(),
    pending: account.pendingCode(),
    state: !account.remote() ? 'off' : busy ? 'syncing' : globalState,
    lastSync: lastRun,
    error: globalError,
    available: account.available(),
    restore: offer ?? undefined
  }
}

/** Ответ на предложение: что подтянуть из облака. null — «Не сейчас»: этот ПК остаётся со своими данными */
export function restoreChoice(choice: CloudRestoreChoice | null) {
  offer = null
  file.linked = true
  file.seen = {}
  if (choice) deps.setCloudSettings({ profile: choice.profile, library: choice.library, saves: choice.saves }, choice.profile)
  else deps.setCloudSettings({ profile: false, library: false }, false)
  saveState()
  deps.onChange()
  void syncAll()
}

/** Вышли из облака: следующий вход (может, в другой аккаунт) снова спросит про профиль */
export function forget() {
  offer = null
  file = { sets: {}, devices: {}, mine: {}, seen: {} }
  saveState()
}

/** История версий сохранений игры (основной набор) */
export async function versions(game: Game): Promise<SaveVersion[]> {
  const r = account.remote()
  const set = saveSetsFor(game, deps.settings())[0]
  if (!r || !set) return []
  const list = await r.list(`saves/${folderOf(set.key)}`)
  return list
    .map((e) => {
      const s = parseSnap(e.name)
      return s && { name: s.name, at: s.at, device: deviceLabel(s.device), size: e.size, hash: s.hash }
    })
    .filter((v): v is SaveVersion => !!v)
    .sort((a, b) => b.at - a.at)
}

/** Вернуть старую версию: она ложится на ПК и загружается в облако как самая новая */
export function restoreVersion(game: Game, name: string) {
  return enqueue(async () => {
    const r = account.remote()
    const set = saveSetsFor(game, deps.settings())[0]
    const head = parseSnap(name)
    if (!r || !set || !head) return
    if (blocked(set)) throw new Error('Сначала закройте игру')
    await download(r, set, await localState(set), head)
    const local = await localState(set)
    if (local.hash) await upload(r, set, local)
    file.sets[set.key] = { base: local.hash ?? undefined, lastSync: Date.now() }
    await writeMyDevice(r)
    saveState()
    deps.onChange()
  })
}

export function initSync(d: Deps) {
  deps = d
  try {
    file = { sets: {}, devices: {}, mine: {}, seen: {}, ...(JSON.parse(fs.readFileSync(stateFile(), 'utf8')) as Partial<SyncStateFile>) }
  } catch {
    // Первый запуск
  }
  setTimeout(() => {
    void updateManifest().finally(() => void syncAll())
  }, 8000)
  setInterval(() => void syncAll(), POLL_MS)
}

/** После входа в облако или смены настроек — сразу полная синхронизация */
export function kick() {
  void updateManifest().finally(() => void syncAll())
}
