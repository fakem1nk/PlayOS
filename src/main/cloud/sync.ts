import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { t } from '@shared/i18n'
import type { CloudRestoreChoice, CloudRestoreOffer, CloudStatus, CloudSyncState, Game, GameCloudStatus, SaveConflict, SaveVersion, Settings } from '@shared/types'
import { log } from '../log'
import { dataDir } from '../store'
import * as account from './account'
import { cloudOffer, syncLibrary, syncProfile, type Hooks, type Seen } from './library'
import { updateManifest } from './ludusavi'
import { saveSetsFor, type SaveSet } from './locate'
import { AuthError, OfflineError, QuotaError, type Remote } from './remote'
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
  /** Время изменения и размер чужих devices/*.json при прошлом опросе */
  devices: Record<string, { modified: number; size?: number; file: DeviceFile }>
  /** Свои головы: что лежит на этом ПК по каждому ключу (копия devices/<свой id>.json) */
  mine: Record<string, string>
  /** Когда этот ПК последний раз записал свой файл устройства */
  mineAt?: number
  /** Отметка формата из облака: время изменения файла и число в нём */
  format?: { modified: number; value: number }
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

const SNAP = /^(\d{1,15})_([0-9a-f]{8})_([0-9a-f]{16})\.zip$/
/**
 * Файл устройства — <uuid>.json, внутри тот же id. Копии-конфликты клиентов синхронизации
 * (OneDrive «<id>-ИМЯПК.json», Dropbox «(conflicted copy)», Syncthing «.sync-conflict-…») — не устройства:
 * их устаревшие головы навсегда защищали бы старые снимки от удаления
 */
const DEVICE_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/i
const POLL_MS = 10 * 60_000
/** Запуск игры ждёт облако, пока пользователь не нажмёт «Играть без ожидания»; это — предел на случай зависшей сети */
const LAUNCH_TIMEOUT = 120_000
const DAY = 86_400_000
/** ПК, который не появлялся в облаке дольше, списан: его «голова» больше не защищает старые снимки от удаления */
const DEVICE_ALIVE_MS = 90 * DAY
/** Свой файл устройства обновляется хотя бы раз в неделю, даже если сохранения не менялись, — иначе живой ПК выглядел бы списанным */
const HEARTBEAT_MS = 7 * DAY
/** Сколько места в облаке могут занять снимки «по одному за день и за неделю» сверх последних версий — на один набор */
const HISTORY_BYTES = 2 ** 30
/**
 * Формат данных в облаке (meta/format.json). Версия PlayOS, которая меняет его несовместимо, поднимает число —
 * и более старые версии перестают синхронизироваться вместо того, чтобы затирать поля, которых не понимают
 */
const FORMAT = 1
const FORMAT_CHECK_MS = 3600_000
/** Нет связи — повторяем раньше обычного опроса: через минуту, потом через три */
const RETRY_MS = [60_000, 3 * 60_000]
/** Имя аккаунта и место в облаке — раз в 6 часов (для полосы занятого места) */
const ACCOUNT_MS = 6 * 3600_000
/** Больше — в облако не загружаем: снимок целиком в памяти, а у облаков лимиты на файл */
const MAX_SET_BYTES = 512 * 2 ** 20
/** Архив снимка из облака: больше набора он быть не может (несжимаемые файлы + заголовки ZIP) */
const MAX_SNAP_BYTES = MAX_SET_BYTES + 64 * 2 ** 20
const MAX_DEVICE_BYTES = 4 * 2 ** 20
const MAX_HEADS = 50_000

/** devices/<id>.json — чужие данные: берём только поля нужных типов, а из голов — только имена снимков */
function readDevice(raw: unknown, id: string): DeviceFile | null {
  const d = raw as Partial<DeviceFile> | null
  if (!d || typeof d !== 'object' || typeof d.id !== 'string' || d.id.toLowerCase() !== id) return null
  const heads: Record<string, string> = {}
  if (d.heads && typeof d.heads === 'object') {
    for (const [folder, name] of Object.entries(d.heads).slice(0, MAX_HEADS)) {
      if (typeof name === 'string' && SNAP.test(name) && folder === folderOf(folder)) heads[folder] = name
    }
  }
  return {
    id,
    name: typeof d.name === 'string' ? d.name.slice(0, 64) : '',
    seen: typeof d.seen === 'number' ? d.seen : 0,
    version: typeof d.version === 'string' ? d.version.slice(0, 32) : '',
    heads
  }
}

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
/** Меняется при выходе из облака: начатая до выхода синхронизация не пишет в состояние нового входа */
let generation = 0
let retries = 0
let retryTimer: ReturnType<typeof setTimeout> | undefined
let accountAt = 0
let changeTimer: ReturnType<typeof setTimeout> | undefined
let formatAt = 0
/** «Синхронизировать» нажал сам пользователь: следующая синхронизация применит и массовое удаление игр из облака */
let confirmDeletes = false
/** Запуск игры не ждёт конца общей синхронизации: её наборы идут вне очереди, между наборами других игр */
const urgent: { run: (r: Remote) => Promise<void>; skip: () => void }[] = []
/** Состояние наборов сохранений: по ключу */
const setStatus = new Map<string, { state: CloudSyncState; size?: number; error?: string; conflict?: SaveConflict; dirs?: string[] }>()

const dev8 = () => account.deviceId().replace(/-/g, '').slice(0, 8)

/** Временный файл и переименование: оборванная запись не стирает базы (иначе — конфликт по каждой игре) */
function saveState() {
  fs.writeFileSync(stateFile() + '.tmp', JSON.stringify(file))
  fs.renameSync(stateFile() + '.tmp', stateFile())
}

/** Окну — не чаще раза в 150 мс: за синхронизацию статус меняется дважды на каждый набор */
function changed() {
  changeTimer ??= setTimeout(() => {
    changeTimer = undefined
    deps.onChange()
  }, 150)
}

const cloudOn = () => !!account.remote() && !!deps.settings().cloud
export const enabled = () => cloudOn() && deps.settings().cloud?.saves !== false && file.linked === true

/** Последовательно: два действия над одним облаком одновременно не идут */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task)
  queue = next.catch(() => undefined)
  return next
}

/** Состояние по ошибке: нет сети, нет места, нужен вход — или просто ошибка */
const stateOf = (e: unknown): CloudSyncState =>
  e instanceof OfflineError ? 'offline' : e instanceof QuotaError ? 'full' : e instanceof AuthError ? 'signin' : 'error'

/** Читает devices/ и собирает самые свежие снимки по каждому ключу */
async function refreshHeads(r: Remote) {
  const list = await r.list('devices')
  // Копии-конфликты, запомненные прошлыми версиями PlayOS
  for (const id of Object.keys(file.devices)) if (!DEVICE_FILE.test(`${id}.json`)) delete file.devices[id]
  for (const e of list) {
    const id = DEVICE_FILE.exec(e.name)?.[1].toLowerCase()
    if (!id || id === account.deviceId()) continue
    const known = file.devices[id]
    // Время и размер: у Яндекса время с точностью до секунды
    if (known && known.modified === e.modified && (known.size ?? e.size) === e.size) continue
    try {
      const dev = readDevice(JSON.parse((await r.read(`devices/${e.name}`, MAX_DEVICE_BYTES)).toString('utf8')), id)
      if (!dev) continue
      file.devices[id] = { modified: e.modified, size: e.size, file: dev }
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
  if (!myDirty && Date.now() - (file.mineAt ?? 0) < HEARTBEAT_MS) return
  const body: DeviceFile = { id: account.deviceId(), name: account.deviceName(), seen: Date.now(), version: app.getVersion(), heads: file.mine }
  await r.write(`devices/${account.deviceId()}.json`, Buffer.from(JSON.stringify(body, null, 2)))
  myDirty = false
  file.mineAt = Date.now()
}

function deviceLabel(short: string) {
  if (short === dev8()) return account.deviceName()
  const d = Object.values(file.devices).find((x) => x.file.id.replace(/-/g, '').startsWith(short))
  return d?.file.name || short
}

/**
 * Какие снимки остаются в истории (snaps — от новых к старым): последние keep и ещё по одному за каждый из 7 дней
 * и за каждую из 5 недель. Одни «последние N» вытеснялись за вечер: пять коротких заходов в игру —
 * и хорошего сохранения до поломки уже нет. Дополнительные — пока укладываются в HISTORY_BYTES
 */
export function retained(snaps: { name: string; at: number; size: number }[], keep: number, now: number) {
  const out = new Set(snaps.slice(0, keep).map((s) => s.name))
  const buckets = new Set<string>()
  let budget = HISTORY_BYTES
  for (const s of snaps) {
    const age = now - s.at
    const bucket = age < 7 * DAY ? `d${Math.floor(s.at / DAY)}` : age < 35 * DAY ? `w${Math.floor(s.at / (7 * DAY))}` : null
    if (!bucket || buckets.has(bucket)) continue
    buckets.add(bucket)
    if (out.has(s.name) || s.size > budget) continue
    budget -= s.size
    out.add(s.name)
  }
  return out
}

/** Лишние снимки удаляются; «головы» этого ПК и всех живых ПК остаются всегда */
async function prune(r: Remote, folder: string) {
  const keep = Math.max(1, deps.settings().cloud?.keepVersions ?? 5)
  const alive = Object.values(file.devices).filter((d) => Date.now() - d.modified < DEVICE_ALIVE_MS)
  const protectedNames = new Set([file.mine[folder], ...alive.map((d) => d.file.heads?.[folder])])
  const snaps = (await r.list(`saves/${folder}`))
    .map((e) => {
      const s = parseSnap(e.name)
      return s && { ...s, size: e.size }
    })
    .filter((s) => !!s)
    .sort((a, b) => b.at - a.at)
  const stay = retained(snaps, keep, Date.now())
  for (const s of snaps) if (!stay.has(s.name) && !protectedNames.has(s.name)) await r.remove(`saves/${folder}/${s.name}`)
}

/** Отметка формата: облако записала более новая версия PlayOS — эта версия его не трогает */
async function checkFormat(r: Remote) {
  if (Date.now() - formatAt < FORMAT_CHECK_MS && file.format) return
  const entry = (await r.list('meta')).find((e) => e.name === 'format.json')
  if (!entry) {
    await r.write('meta/format.json', Buffer.from(JSON.stringify({ format: FORMAT })))
    file.format = { modified: 0, value: FORMAT }
  } else if (file.format?.modified !== entry.modified) {
    let value = FORMAT
    try {
      value = Number((JSON.parse((await r.read('meta/format.json', 65_536)).toString('utf8')) as { format?: unknown } | null)?.format) || FORMAT
    } catch (e) {
      if (e instanceof OfflineError) throw e
    }
    file.format = { modified: entry.modified, value }
  }
  formatAt = Date.now()
}

const formatError = () => new Error(t('Облако уже использует более новая версия PlayOS. Обновите PlayOS на этом ПК — до тех пор синхронизация здесь остановлена.'))

const tooBig = (local: LocalState) => local.size > MAX_SET_BYTES

/** Загружает снимок; возвращает его хэш — по байтам, которые легли в архив */
async function upload(r: Remote, set: SaveSet, local: LocalState) {
  if (tooBig(local)) throw new Error(t('Сохранения больше 512 МБ — в облако не загружаются'))
  const folder = folderOf(set.key)
  const packed = await pack(local)
  // Время снимка не меньше времени головы, на которой он основан: ПК с отстающими часами не загрузит «старую» новую версию
  const at = Math.max(Date.now(), (heads.get(folder)?.at ?? 0) + 1)
  const name = `${at}_${dev8()}_${packed.hash}.zip`
  await r.write(`saves/${folder}/${name}`, packed.data)
  file.mine[folder] = name
  myDirty = true
  heads.set(folder, parseSnap(name)!)
  await prune(r, folder).catch((e) => log('WARN', 'Облако: не удалось убрать старые версии', (e as Error).message))
  log('INFO', `Облако: загружены сохранения ${set.key} (${local.size} байт)`)
  return packed.hash
}

/**
 * Выбрали облачную версию в конфликте: версия этого ПК остаётся в истории облака, как обещает диалог.
 * Время — до облачной версии: в истории она ниже выбранной, головой этого ПК не становится
 */
async function park(r: Remote, set: SaveSet, local: LocalState, head: Head) {
  if (tooBig(local)) return
  const packed = await pack(local)
  if (packed.hash === head.hash) return
  const at = Math.max(1, Math.min(local.at || head.at - 1, head.at - 1))
  await r.write(`saves/${folderOf(set.key)}/${at}_${dev8()}_${packed.hash}.zip`, packed.data)
}

/** false — пока снимок качался, запустили игру этого набора: файлы не трогаем */
async function download(r: Remote, set: SaveSet, local: LocalState, head: Head) {
  const folder = folderOf(set.key)
  const data = await r.read(`saves/${folder}/${head.name}`, MAX_SNAP_BYTES)
  if (blocked(set)) return false
  await apply(set, data, local, head.hash)
  file.mine[folder] = head.name
  myDirty = true
  log('INFO', `Облако: скачаны сохранения ${set.key} с ${deviceLabel(head.device)}`)
  return true
}

function blocked(set: SaveSet) {
  const run = deps.runningGame()
  if (!run) return false
  // Обычная карта памяти PS2 общая: пока идёт любая игра PS2, её не трогаем
  return saveSetsFor(run, deps.settings()).some((s) => s.key === set.key) || (set.key.startsWith('ps2card:') && run.platform === 'ps2')
}

async function syncSet(r: Remote, game: Game, set: SaveSet, force?: 'local' | 'cloud'): Promise<SaveConflict | null> {
  const st = (file.sets[set.key] ??= {})
  const folder = folderOf(set.key)
  const status = { state: 'syncing' as CloudSyncState, dirs: set.patterns }
  setStatus.set(set.key, status)
  changed()
  const playing = () => {
    setStatus.set(set.key, { ...status, state: 'playing' })
    return null
  }
  try {
    if (blocked(set)) return playing()
    const local = await localState(set)
    let head = heads.get(folder) ?? null
    let action: Action = force === 'local' ? (local.hash ? 'upload' : 'none') : force === 'cloud' ? (head ? 'download' : 'none') : decide(local.hash, st.base, head?.hash ?? null)
    if (action === 'upload' && !force) {
      // Пока мы считали, другой ПК мог загрузить своё: перечитываем головы перед записью и решаем заново
      await refreshHeads(r)
      head = heads.get(folder) ?? null
      action = decide(local.hash, st.base, head?.hash ?? null)
    }
    // Пока шли сеть и подсчёт хэшей, игру могли запустить: запуск ждёт синхронизацию не дольше 10 с
    if ((action === 'upload' || action === 'download') && blocked(set)) return playing()
    let base = local.hash
    if (action === 'upload') base = await upload(r, set, local)
    else if (action === 'download' && head) {
      if (force === 'cloud' && local.hash && local.hash !== head.hash) {
        await park(r, set, local, head).catch((e) => {
          if (!(e instanceof Error) || e instanceof OfflineError) throw e
          log('WARN', `Облако: версия этого ПК не попала в историю ${set.key}:`, e.message)
        })
      }
      if (!(await download(r, set, local, head))) return playing()
      base = head.hash
    }
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
      st.base = base ?? undefined
      st.lastSync = Date.now()
    }
    setStatus.set(set.key, { state: action === 'none' ? 'nosaves' : 'synced', size: local.size, dirs: set.patterns })
    return null
  } catch (e) {
    const state = stateOf(e)
    if (state === 'error') log('WARN', `Облако: ${set.key}:`, (e as Error).message)
    setStatus.set(set.key, { state, error: (e as Error).message, dirs: set.patterns })
    // Нет сети или входа — остальные наборы тоже не пройдут. Нет места — скачать чужие сохранения ещё можно
    if (state === 'offline' || state === 'signin') throw e
    return null
  } finally {
    changed()
  }
}

/** Нет связи: повторяем раньше обычного опроса, но не во время игры */
function retryLater() {
  if (retryTimer || retries >= RETRY_MS.length) return
  retryTimer = setTimeout(() => {
    retryTimer = undefined
    if (!deps.runningGame()) void syncAll()
  }, RETRY_MS[retries++])
}

/** Наборы сохранений одной игры; done — наборы, уже пройденные в этой синхронизации (общая карта памяти PS2) */
async function syncSets(r: Remote, game: Game, force?: 'local' | 'cloud', done?: Set<string>) {
  let first: SaveConflict | null = null
  for (const set of saveSetsFor(game, deps.settings())) {
    if (done?.has(set.key)) continue
    done?.add(set.key)
    first ??= await syncSet(r, game, set, force)
  }
  return first
}

async function runUrgent(r: Remote) {
  while (urgent.length) await urgent.shift()!.run(r)
}

/** Синхронизирует игры; возвращает первый конфликт (для запуска игры) */
function syncGames(games: Game[], force?: 'local' | 'cloud'): Promise<SaveConflict | null> {
  return enqueue(async () => {
    const r = account.remote()
    if (!r || !cloudOn()) return null
    const gen = generation
    const deletes = confirmDeletes
    confirmDeletes = false
    busy++
    globalState = 'syncing'
    changed()
    let first: SaveConflict | null = null
    try {
      await checkFormat(r)
      if ((file.format?.value ?? FORMAT) > FORMAT) throw formatError()
      // Новый ПК или переустановка: если в облаке уже есть профиль — сначала спрашиваем, что подтянуть
      if (!file.linked) {
        offer = await cloudOffer(r)
        if (offer) {
          globalState = 'pending'
          return null
        }
        file.linked = true
      }
      const cloud = deps.settings().cloud
      const hooks = { ...deps.hooks, deviceName: account.deviceName() }
      // Испорченный profile.json или library.json (папку синхронизации докачали не до конца) не останавливает сохранения
      let partError: string | undefined
      const part = async (what: string, run: () => Promise<void>) => {
        try {
          await run()
        } catch (e) {
          if (stateOf(e) !== 'error') throw e
          log('WARN', `Облако: ${what}:`, (e as Error).message)
          partError ??= (e as Error).message
        }
      }
      if (cloud?.profile !== false) await part('профиль', () => syncProfile(r, file.seen, hooks))
      if (cloud?.library !== false) await part('библиотека', () => syncLibrary(r, file.seen, hooks, deletes))
      if (!enabled()) {
        globalState = partError ? 'error' : 'synced'
        globalError = partError
        lastRun = Date.now()
        return null
      }
      await refreshHeads(r)
      const done = new Set<string>()
      for (const game of games) {
        for (const set of saveSetsFor(game, deps.settings())) {
          if (done.has(set.key)) continue
          await runUrgent(r)
          if (gen !== generation) return null
          done.add(set.key)
          const c = await syncSet(r, game, set, force)
          first ??= c
        }
      }
      await runUrgent(r)
      await writeMyDevice(r)
      globalError = partError
      const states = [...setStatus.values()].map((s) => s.state)
      globalState = states.includes('conflict') ? 'conflict' : states.includes('full') ? 'full' : partError ? 'error' : 'synced'
      lastRun = Date.now()
      retries = 0
      if (Date.now() - accountAt > ACCOUNT_MS) {
        accountAt = Date.now()
        void account.refreshAccount().then(changed, () => undefined)
      }
    } catch (e) {
      if (gen !== generation) return null
      globalState = stateOf(e)
      globalError = (e as Error).message
      if (globalState === 'offline') retryLater()
    } finally {
      // Синхронизация оборвалась (нет сети, вход устарел) — ждущий запуск игры идёт с локальными сохранениями
      for (const u of urgent.splice(0)) u.skip()
      busy--
      if (gen === generation) saveState()
      changed()
    }
    return first
  })
}

export function syncAll() {
  return syncGames(deps.games())
}

/** «Синхронизировать» в настройках: заодно подтверждает массовое удаление игр, отмеченное в облаке */
export function syncNow() {
  confirmDeletes = true
  return syncAll()
}

/**
 * Перед запуском: свежие сохранения из облака. Нет сети — запускаем с локальными.
 * stop — пользователь не стал ждать («Играть без ожидания») или отменил запуск.
 * Если уже идёт общая синхронизация, наборы этой игры проходят вне очереди, а не после всех остальных
 */
export async function beforeLaunch(game: Game, stop?: Promise<unknown>): Promise<SaveConflict | null> {
  if (!enabled() || !saveSetsFor(game, deps.settings()).length) return null
  const run = busy
    ? new Promise<SaveConflict | null>((resolve) =>
        urgent.push({
          skip: () => resolve(null),
          run: async (r) => resolve(await syncSets(r, game).catch(() => null))
        })
      )
    : syncGames([game]).catch(() => null)
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), LAUNCH_TIMEOUT))
  return Promise.race([run, timeout, ...(stop ? [stop.then(() => null)] : [])])
}

/** Есть ли что ждать перед запуском: облако включено и у игры есть сохранения */
export const syncsBeforeLaunch = (game: Game) => enabled() && saveSetsFor(game, deps.settings()).length > 0

/** Игру изменили в редакторе (папка игры, папка сохранений, AppID) — проверяем сразу, а не через 10 минут */
export function syncGame(game: Game) {
  if (enabled()) void syncGames([game])
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
  if (game.launcher === 'steam') return { state: 'steam' }
  const sets = saveSetsFor(game, deps.settings())
  if (!sets.length) return { state: 'nosaves' }
  const list = sets.map((s) => setStatus.get(s.key)).filter((s) => !!s)
  const order: CloudSyncState[] = ['conflict', 'signin', 'full', 'error', 'offline', 'syncing', 'playing', 'pending', 'synced', 'nosaves']
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
  changed()
  void syncAll()
}

/** Вышли из облака: следующий вход (может, в другой аккаунт) снова спросит про профиль и начнёт с чистого листа */
export function forget() {
  generation++
  offer = null
  file = { sets: {}, devices: {}, mine: {}, seen: {} }
  heads = new Map()
  setStatus.clear()
  myDirty = false
  globalState = 'off'
  globalError = undefined
  lastRun = undefined
  retries = 0
  accountAt = 0
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = undefined
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
    const snap = parseSnap(name)
    if (!r || !set || !snap) return
    if (blocked(set)) throw new Error(t('Сначала закройте игру.'))
    await refreshHeads(r)
    if (!(await download(r, set, await localState(set), snap))) throw new Error(t('Сначала закройте игру.'))
    const local = await localState(set)
    const hash = local.hash ? await upload(r, set, local) : undefined
    file.sets[set.key] = { base: hash ?? undefined, lastSync: Date.now() }
    await writeMyDevice(r)
    saveState()
    changed()
  })
}

export function initSync(d: Deps) {
  deps = d
  try {
    file = { sets: {}, devices: {}, mine: {}, seen: {}, ...(JSON.parse(fs.readFileSync(stateFile(), 'utf8')) as Partial<SyncStateFile>) }
  } catch {
    // Первый запуск
  }
  // Файлы устройств, запомненные прошлыми версиями без проверки содержимого
  for (const [id, d] of Object.entries(file.devices)) {
    const dev = readDevice(d?.file, id)
    if (dev) d.file = dev
    else delete file.devices[id]
  }
  setTimeout(() => {
    void updateManifest().finally(() => void syncAll())
  }, 8000)
  // Во время игры опрос пропускается: обход папок и хэши ни к чему, а сама игра синхронизируется после выхода
  setInterval(() => {
    if (!deps.runningGame()) void syncAll()
  }, POLL_MS)
}

/** После входа в облако или смены настроек — сразу полная синхронизация */
export function kick() {
  retries = 0
  void updateManifest().finally(() => void syncAll())
}

/** ПК проснулся: сеть поднимается не сразу — синхронизируемся чуть позже, а не через 10 минут */
export function wake() {
  retries = 0
  setTimeout(() => {
    if (cloudOn() && !deps.runningGame()) void syncAll()
  }, 20_000)
}
