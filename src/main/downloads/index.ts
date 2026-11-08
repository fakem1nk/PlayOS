import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { powerSaveBlocker, shell } from 'electron'
import type { DownloadControl, DownloadDrive, DownloadFolder, DownloadJob, DownloadKind, DownloadRequest } from '@shared/types'
import { t } from '@shared/i18n'
import { stamp } from '../cloud/library'
import { log } from '../log'
import { dataDir, getDb, saveDb } from '../store'
import { diskSpace, freeSpace, httpDownload, parseSize, safeName, Stop, type Progress } from './http'
import { extractAll, NeedPassword } from './extract'
import { findImage, findInstalled, findInstaller, findPortable, installPlaces, isInstallerName, rootsOf, runInstaller, uninstallSnapshot } from './install'
import { quitTorrents, removeTorrent, torrentDownload, torrentReady } from './torrent'

/**
 * Очередь загрузок PlayOS. Качается одна загрузка, остальные ждут; очередь лежит в downloads.json и после
 * перезапуска продолжается с того же места. Интерфейс получает очередь целиком: при смене состояния сразу,
 * прогресс — не чаще раза в полсекунды. Пока что-то качается, Windows не уходит в сон.
 * Каждая загрузка — в своей папке «папка пользователя\название игры»; удаляются только файлы, которые она скачала.
 * Прямые ссылки качает http.ts, торренты — свой клиент на libtorrent (torrent.ts). Скачанные архивы распаковываются
 * сразу, в той же очереди (extract.ts): загрузка готова, когда игра лежит на диске как есть. Потом install.ts ищет
 * в скачанном игру: готовая сразу прописывается в библиотеку, установщик ждёт кнопку «Установить».
 */

const file = () => path.join(dataDir(), 'downloads.json')
/** Прогресс в интерфейс — не чаще */
const EMIT_MS = 500
/** Прогресс на диск — не чаще: после сбоя докачка всё равно идёт от размера файла */
const SAVE_MS = 5000
/** Скорость — среднее за последние секунды */
const SPEED_WINDOW = 3000
/** Готовые видны в разделе 3 дня и не больше 10 последних — потом уходят из списка сами, файлы остаются */
const DONE_KEEP_MS = 3 * 86_400_000
const DONE_MAX = 10
/** Как часто проверять, не пора ли убрать готовые */
const DONE_CHECK_MS = 3_600_000

let jobs: DownloadJob[] = []
let current: { id: string; abort: AbortController } | null = null
let blocker = -1
let notify: (list: DownloadJob[]) => void = () => {}
/** Что делает главный процесс: library — библиотека изменилась; away/back — уступить экран установщику и вернуться */
interface Hooks {
  library: () => void
  away: () => void
  back: () => void
}
let hooks: Hooks = { library: () => {}, away: () => {}, back: () => {} }

/** Какие ссылки PlayOS качает сам: прямые — всегда, торренты — если на месте торрент-клиент */
export const canDownload = (kind: DownloadKind) => kind === 'http' || torrentReady()
const isTorrent = (j: DownloadJob) => j.kind !== 'http'

/** Поднять очередь после запуска: прерванная загрузка продолжается сама */
export function startDownloads(onChange: (list: DownloadJob[]) => void, h?: Hooks) {
  notify = onChange
  if (h) hooks = h
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8')) as DownloadJob[]
    jobs = Array.isArray(raw) ? raw : []
  } catch {
    jobs = []
  }
  for (const j of jobs) {
    j.speed = undefined
    if (j.status === 'active') j.status = 'queued'
    // PlayOS закрыли, пока шла установка: установщик можно запустить снова
    if (j.install === 'running') j.install = 'ready'
  }
  if (dropOldDone()) save(true)
  setInterval(() => dropOldDone() && changed(), DONE_CHECK_MS)
  pump()
}

export const listDownloads = () => jobs

/**
 * Убрать из списка готовые старше DONE_KEEP_MS и сверх DONE_MAX; true — что-то убрали. Те, что ждут установки
 * или файла игры, остаются: без них кнопку «Установить» не найти
 */
function dropOldDone(): boolean {
  const since = Date.now() - DONE_KEEP_MS
  const at = (j: DownloadJob) => j.doneAt ?? j.addedAt
  const finished = (j: DownloadJob) => j.status === 'done' && (!j.install || j.install === 'installed')
  const keep = new Set(
    jobs
      .filter((j) => finished(j) && at(j) > since)
      .sort((a, b) => at(b) - at(a))
      .slice(0, DONE_MAX)
  )
  const old = jobs.filter((j) => finished(j) && !keep.has(j))
  if (!old.length) return false
  jobs = jobs.filter((j) => !old.includes(j))
  for (const j of old) if (isTorrent(j)) removeTorrent(j, false)
  log('INFO', '[загрузки] убраны старые готовые:', old.length)
  return true
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function save(now = false) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  const write = () => {
    try {
      fs.mkdirSync(dataDir(), { recursive: true })
      const tmp = file() + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(jobs.map(({ speed: _, ...j }) => j)), 'utf8')
      fs.renameSync(tmp, file())
    } catch (e) {
      log('WARN', '[загрузки] не удалось записать очередь:', (e as Error).message)
    }
  }
  if (now) write()
  else saveTimer = setTimeout(write, SAVE_MS)
}

let emitTimer: ReturnType<typeof setTimeout> | null = null
function emit(now = false) {
  if (now) {
    if (emitTimer) clearTimeout(emitTimer)
    emitTimer = null
    notify(jobs)
  } else {
    emitTimer ??= setTimeout(() => {
      emitTimer = null
      notify(jobs)
    }, EMIT_MS)
  }
}

/** Не давать Windows уснуть, пока качается */
function holdAwake(on: boolean) {
  if (on && blocker < 0) blocker = powerSaveBlocker.start('prevent-app-suspension')
  if (!on && blocker >= 0) {
    powerSaveBlocker.stop(blocker)
    blocker = -1
  }
}

/** Следующая из очереди, если ничего не качается */
function pump() {
  if (current) return
  const next = jobs.find((j) => j.status === 'queued')
  if (!next) {
    quitTorrents()
    return holdAwake(false)
  }
  void run(next)
}

function errText(e: unknown): string {
  const msg = (e as Error)?.message ?? String(e)
  if ((e as Error)?.name === 'TimeoutError') return t('Сервер не ответил')
  if (/net::ERR_/.test(msg)) return t('Нет связи с сервером')
  return msg
}

/** Скорость по последним секундам: (сколько уже) → байт/с */
function meter() {
  const samples: [number, number][] = []
  return (value: number) => {
    const now = Date.now()
    samples.push([now, value])
    while (samples.length > 2 && now - samples[0][0] > SPEED_WINDOW) samples.shift()
    const [t0, v0] = samples[0]
    return now > t0 ? Math.round(((value - v0) * 1000) / (now - t0)) : 0
  }
}

async function run(job: DownloadJob) {
  const abort = new AbortController()
  current = { id: job.id, abort }
  job.status = 'active'
  job.error = undefined
  job.needPassword = undefined
  holdAwake(true)
  save(true)
  emit(true)
  const speed = meter()
  const progress: Progress = (received, size) => {
    job.received = received
    if (size) job.size = size
    job.speed = speed(received)
    emit()
    save()
  }
  try {
    // Уже скачано, остановилась распаковка — сразу к ней
    if (!job.downloaded || !job.file || !fs.existsSync(job.file)) {
      job.downloaded = false
      job.archives = undefined
      job.file = await (isTorrent(job) ? torrentDownload : httpDownload)(job, abort.signal, progress, () => save(true))
      job.downloaded = true
      job.received = job.size || job.received
      log('INFO', '[загрузки] скачано:', job.title, '→', job.file)
    }
    const unpackSpeed = meter()
    const unpack = (done: number, total: number) => {
      job.phase = 'extracting'
      job.unpack = { done, total }
      job.speed = unpackSpeed(done)
      emit()
    }
    await extractAll(job, abort.signal, unpack, () => save(true), getDb().settings.keepArchives === true)
    await locate(job)
    job.status = 'done'
    job.doneAt = Date.now()
    log('INFO', '[загрузки] готово:', job.title)
    dropOldDone()
  } catch (e) {
    // Пауза и отмена сами выставили состояние — это не ошибка
    if (!abort.signal.aborted) {
      job.status = 'error'
      job.error = errText(e)
      if (e instanceof NeedPassword) job.needPassword = true
      log('WARN', '[загрузки] остановилась:', job.title, job.error, e instanceof Stop ? '' : '(после повторов)')
    }
  } finally {
    job.speed = undefined
    job.phase = undefined
    job.unpack = undefined
    current = null
    save(true)
    emit(true)
    pump()
  }
}

// ───────────────────────── Действия ─────────────────────────

const sameLinks = (a: string[], b: string[]) => a.length === b.length && a.every((u, i) => u === b[i])

export async function startDownload(req: DownloadRequest): Promise<{ job?: DownloadJob; error?: string }> {
  const folder = path.resolve(String(req.folder ?? ''))
  if (!folders().some((f) => samePath(f, folder))) return { error: t('Этой папки нет в списке папок для загрузок') }
  if (!canDownload(req.kind)) return { error: t('Такие ссылки PlayOS скоро научится качать сам. Пока скопируйте ссылку') }
  const uris = (req.uris ?? []).filter((u) => typeof u === 'string' && /^(magnet:|https?:\/\/)/i.test(u)).slice(0, 20)
  if (!uris.length) return { error: t('У варианта нет ссылок') }
  // Тот же вариант уже в очереди — второй раз не ставим
  const same = jobs.find((j) => j.status !== 'done' && sameLinks(j.uris, uris))
  if (same) return { job: same }
  const size = parseSize(req.size)
  const free = await freeSpace(folder)
  if (size && free !== null && size > free) return { error: t('Не хватает места: нужно {need}, на диске свободно {free}', { need: gb(size), free: gb(free) }) }
  const job: DownloadJob = {
    id: crypto.randomUUID(),
    gameId: req.gameId,
    title: String(req.title ?? '').slice(0, 200),
    name: String(req.name ?? '').slice(0, 300),
    cover: req.cover,
    hero: req.hero,
    kind: req.kind,
    uris,
    dir: path.join(folder, safeName(String(req.title ?? '')) || 'PlayOS'),
    status: 'queued',
    received: 0,
    size,
    addedAt: Date.now()
  }
  jobs.push(job)
  useFolder(folder)
  save(true)
  emit(true)
  pump()
  return { job }
}

const gb = (n: number) => t('{v} ГБ', { v: (n / 2 ** 30).toFixed(1) })

export function controlDownload(id: string, action: DownloadControl) {
  if (action === 'clearDone') {
    // Те, что ждут установки или файла игры, остаются — это ещё не конец
    jobs = jobs.filter((j) => j.status !== 'done' || (j.install && j.install !== 'installed'))
    return changed()
  }
  const job = jobs.find((j) => j.id === id)
  if (!job) return
  const stop = () => {
    if (current?.id === job.id) current.abort.abort(new Error('stopped'))
  }
  switch (action) {
    case 'pause':
      if (job.status !== 'active' && job.status !== 'queued') return
      job.status = 'paused'
      stop()
      break
    case 'resume':
      if (job.status !== 'paused' && job.status !== 'error') return
      job.status = 'queued'
      job.error = undefined
      break
    case 'cancel':
      // Отмена — вместе с недокачанным
      stop()
      jobs = jobs.filter((j) => j !== job)
      deleteFiles(job)
      break
    case 'remove':
      // Убрать из списка, файлы остаются
      stop()
      jobs = jobs.filter((j) => j !== job)
      if (isTorrent(job)) removeTorrent(job, false)
      break
    case 'deleteFiles':
      stop()
      jobs = jobs.filter((j) => j !== job)
      deleteFiles(job)
      break
    case 'up': {
      const waiting = jobs.filter((j) => j.status !== 'done')
      const i = waiting.indexOf(job)
      if (i <= 0) return
      const before = waiting[i - 1]
      jobs = jobs.filter((j) => j !== job)
      jobs.splice(jobs.indexOf(before), 0, job)
      break
    }
    case 'install':
      void installDownload(job)
      return
    case 'folder':
      if (job.file && fs.existsSync(job.file)) shell.showItemInFolder(job.file)
      else if (fs.existsSync(job.dir)) void shell.openPath(job.dir)
      return
  }
  changed()
}

function changed() {
  save(true)
  emit(true)
  pump()
}

/** Пароль от архива: загрузка снова в очереди, распаковка продолжится с ним */
export function setPassword(id: string, password: string) {
  const job = jobs.find((j) => j.id === id)
  if (!job || job.status !== 'error' || !password) return
  job.password = password.slice(0, 256)
  job.needPassword = undefined
  job.error = undefined
  job.status = 'queued'
  changed()
}

/**
 * Только файлы этой загрузки, и только внутри её папки; пустая папка — тоже. Торрент удаляет свои файлы клиент,
 * а если клиент уже закрыт — PlayOS сам удаляет папку раздачи
 */
function deleteFiles(job: DownloadJob) {
  const inside = (f: string, dir: string) => path.resolve(f).toLowerCase().startsWith(path.resolve(dir).toLowerCase() + path.sep)
  const same = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
  // Установленную игру не трогаем, даже если она стоит внутри папки загрузки: удаляется только скачанное
  const g = job.install === 'installed' ? libraryGame(job) : undefined
  const game = g?.path ? (g.installDir ?? g.path) : ''
  const allowed = (f: string) => inside(f, job.dir) && !(game && (same(f, game) || inside(game, f)))
  if (isTorrent(job)) removeTorrent(job, !game)
  // Файл мог ещё держаться открытым после остановки — даём ему закрыться
  setTimeout(() => {
    for (const f of [...(job.file ? [job.file, job.file + '.part'] : []), ...(job.unpacked ?? [])]) if (allowed(f)) fs.rmSync(f, { force: true, recursive: true })
    try {
      fs.rmdirSync(job.dir)
    } catch {
      /* в папке есть что-то ещё */
    }
  }, isTorrent(job) ? 2000 : 300)
}

// ───────────────────────── Установка ─────────────────────────

const libraryGame = (job: DownloadJob) => (job.gameId ? getDb().games.find((g) => g.id === job.gameId) : undefined)

/** Игра найдена: путь в библиотеку, запуск напрямую (не через Steam) */
function bind(job: DownloadJob, found: { path: string; dir?: string }) {
  const g = libraryGame(job)
  if (!g) {
    job.install = 'manual'
    return
  }
  g.path = found.path
  if (found.dir) g.installDir = found.dir
  else delete g.installDir
  delete g.launcher
  g.updatedAt = stamp()
  saveDb()
  hooks.library()
  job.install = 'installed'
  job.installError = undefined
  log('INFO', '[установка] игра в библиотеке:', g.title, '→', found.path)
}

/** Скачано и распаковано: готовая игра сразу встаёт в библиотеку, установщик ждёт кнопку «Установить» */
async function locate(job: DownloadJob) {
  const game = libraryGame(job)
  if (!game) return
  try {
    const roots = rootsOf(job)
    if (game.platform !== 'pc') {
      const image = findImage(roots, game.platform)
      if (image) bind(job, { path: image })
      else job.install = 'manual'
      return
    }
    const installer = findInstaller(roots)
    const found = await findPortable(roots, job.title)
    // Готовая игра, а не установщик: так сказано в названии раздачи или EXE игры лежит рядом с Setup.exe —
    // тогда это программа настроек игры. У настоящего установщика рядом файлы данных, а EXE игры нет
    const portable =
      !!found &&
      !isInstallerName(found.path) &&
      (!installer || /portable/i.test(job.name) || path.dirname(found.path).toLowerCase() === path.dirname(installer).toLowerCase())
    if (portable) bind(job, found)
    else if (installer) {
      job.install = 'ready'
      job.installer = installer
    } else job.install = 'manual'
  } catch (e) {
    log('WARN', '[установка] не нашли игру:', job.title, (e as Error).message)
    job.install = 'manual'
  }
}

let installing: string | null = null

/**
 * «Установить»: PlayOS уходит в фон, установщик идёт сколько нужно. Потом — где он поставил игру: нашлась —
 * в библиотеку, не нашлась после успешной установки — пользователь укажет файл, отменили — снова «Установить»
 */
async function installDownload(job: DownloadJob) {
  if (job.install !== 'ready' || !job.installer) return
  if (installing) {
    job.installError = t('Сначала закончите другую установку')
    return emit(true)
  }
  if (!fs.existsSync(job.installer)) {
    job.install = 'manual'
    job.installError = t('Установщика больше нет на диске')
    return changed()
  }
  installing = job.id
  job.install = 'running'
  job.installError = undefined
  changed()
  const since = Date.now()
  try {
    const before = await uninstallSnapshot()
    const run = await runInstaller(job.installer, () => hooks.away())
    log('INFO', '[установка] установщик закрылся:', job.title, JSON.stringify(run))
    const ok = run.code === 0 || run.code === 3010 || run.code === 1641
    const found =
      run.cancelled || run.error ? null : await findInstalled(before, job.title, since, { places: [...installPlaces(), ...folders()], skip: [...jobs.map((j) => j.dir), ...getDb().games.flatMap((g) => (g.installDir ? [g.installDir] : []))], folders: ok })
    if (found) bind(job, found)
    else if (ok) job.install = 'manual'
    else {
      job.install = 'ready'
      job.installError = run.cancelled ? t('Установку не разрешили') : run.error ? t('Установщик не запустился') : t('Установка не завершилась')
    }
  } catch (e) {
    log('WARN', '[установка] ошибка:', job.title, (e as Error).message)
    job.install = 'ready'
    job.installError = t('Установка не завершилась')
  } finally {
    installing = null
    hooks.back()
    changed()
  }
}

/** Игру удалили с компьютера: её законченные загрузки уходят со списка — «Играть» там больше нечего */
export function gameGone(id: string) {
  const before = jobs.length
  jobs = jobs.filter((j) => !(j.gameId === id && j.status === 'done' && j.install === 'installed'))
  if (jobs.length !== before) changed()
}

/** Игру поправили в библиотеке (указали файл сами): загрузка этой игры больше не ждёт ни установки, ни файла */
export function gameUpdated(id: string, hasPath: boolean) {
  let hit = false
  for (const j of jobs) {
    if (j.gameId !== id || !hasPath || (j.install !== 'manual' && j.install !== 'ready')) continue
    j.install = 'installed'
    j.installError = undefined
    hit = true
  }
  if (hit) changed()
}

// ───────────────────────── Папки ─────────────────────────

const folders = () => getDb().settings.downloadDirs ?? []
const samePath = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()

/** Последняя выбранная папка — первой в списке */
function useFolder(folder: string) {
  const s = getDb().settings
  s.downloadDirs = [folder, ...folders().filter((f) => !samePath(f, folder))]
  saveDb()
}

async function writable(dir: string): Promise<boolean> {
  const probe = path.join(dir, `.playos-${process.pid}.tmp`)
  try {
    await fs.promises.writeFile(probe, '')
    await fs.promises.rm(probe, { force: true })
    return true
  } catch {
    return false
  }
}

export async function listFolders(): Promise<DownloadFolder[]> {
  return Promise.all(
    folders().map(async (p) => {
      const d = await diskSpace(p)
      return { path: p, free: d?.free ?? 0, total: d?.total ?? 0, ok: fs.existsSync(p) && (await writable(p)) }
    })
  )
}

/** Диски этого ПК — для новой папки с геймпада; совсем маленькие (флешки на пару гигабайт) не предлагаем */
export async function listDrives(): Promise<DownloadDrive[]> {
  const out: DownloadDrive[] = []
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const root = `${letter}:\\`
    try {
      const s = await fs.promises.statfs(root)
      const total = s.blocks * s.bsize
      if (total >= 8 * 2 ** 30) out.push({ root, free: s.bavail * s.bsize, total })
    } catch {
      /* диска нет */
    }
  }
  return out
}

export async function addFolder(p: string): Promise<{ folder?: DownloadFolder; error?: string }> {
  if (!p || !path.isAbsolute(p)) return { error: t('Нужен полный путь к папке') }
  const dir = path.resolve(p)
  try {
    await fs.promises.mkdir(dir, { recursive: true })
  } catch (e) {
    return { error: t('Не получилось создать папку: {e}', { e: (e as Error).message }) }
  }
  if (!(await writable(dir))) return { error: t('В эту папку нельзя записывать — выберите другую') }
  useFolder(dir)
  const d = await diskSpace(dir)
  return { folder: { path: dir, free: d?.free ?? 0, total: d?.total ?? 0, ok: true } }
}

export function removeFolder(p: string) {
  const s = getDb().settings
  s.downloadDirs = folders().filter((f) => !samePath(f, p))
  saveDb()
}
