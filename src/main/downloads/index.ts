import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { powerSaveBlocker, shell } from 'electron'
import type { DownloadControl, DownloadDrive, DownloadFolder, DownloadJob, DownloadKind, DownloadRequest, Settings, TorrentFile } from '@shared/types'
import { t } from '@shared/i18n'
import { stamp } from '../cloud/library'
import { log } from '../log'
import { dataDir, getDb, saveDb } from '../store'
import { diskSpace, freeSpace, httpDownload, parseSize, safeName, setHttpLimit, Stop, type Progress } from './http'
import { extractAll, NeedPassword, removeArchives } from './extract'
import { findImage, findInstalled, findInstaller, findPortable, installPlaces, isInstallerName, rootsOf, runInstaller, uninstallSnapshot } from './install'
import {
  onTorrentFiles,
  quitTorrents,
  removeTorrent,
  resumeSeed,
  setTorrentHold,
  setTorrentLimits,
  setTorrentSeed,
  setTorrentSkip,
  stopSeed,
  torrentDownload,
  torrentFiles,
  torrentReady,
  watchSeed,
  type TorrentStatus
} from './torrent'

/**
 * Очередь загрузок PlayOS. Качается одна загрузка, остальные ждут; очередь лежит в downloads.json и после
 * перезапуска продолжается с того же места. Интерфейс получает очередь целиком: при смене состояния сразу,
 * прогресс — не чаще раза в полсекунды. Пока что-то качается, Windows не уходит в сон.
 * Каждая загрузка — в своей папке «папка пользователя\название игры»; удаляются только файлы, которые она скачала.
 * Прямые ссылки качает http.ts, торренты — свой клиент на libtorrent (torrent.ts). Скачанные архивы распаковываются
 * сразу, в той же очереди (extract.ts): загрузка готова, когда игра лежит на диске как есть. Потом install.ts ищет
 * в скачанном игру: готовая сразу прописывается в библиотеку, установщик ждёт кнопку «Установить».
 * Пока идёт игра, очередь стоит (настройка downloadPauseInGame): текущая загрузка уступает и продолжается после игры.
 * Скорость ограничивается настройками downloadLimit / uploadLimit. Торрент после загрузки может остаться раздавать
 * (seed), пока не отдано seedRatio × размер; архивы такой раздачи удаляются только после неё.
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
/**
 * Что делает главный процесс: library — библиотека изменилась; away/back — уступить экран установщику и вернуться;
 * game — идёт ли игра (на это время очередь стоит)
 */
interface Hooks {
  library: () => void
  away: () => void
  back: () => void
  game: () => boolean
}
let hooks: Hooks = { library: () => {}, away: () => {}, back: () => {}, game: () => false }
/** Очередь поднята: до этого нельзя ни сохранять (затрём downloads.json пустым списком), ни ставить на паузу */
let started = false
/** Пауза на время игры сейчас действует */
let holding = false
/** Во время этой игры пользователь сам попросил качать («Качать сейчас») — пауза снята до её конца */
let override = false

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
    j.upSpeed = undefined
    if (j.status === 'active') j.status = 'queued'
    // PlayOS закрыли, пока шла установка: установщик можно запустить снова
    if (j.install === 'running') j.install = 'ready'
  }
  started = true
  applyLimits()
  holding = held()
  setTorrentHold(holding)
  onTorrentFiles(filesArrived)
  if (dropOldDone()) save(true)
  setInterval(() => dropOldDone() && changed(), DONE_CHECK_MS)
  pump()
  // Раздача, прерванная выходом из PlayOS, продолжается — без спешки: запуск PlayOS важнее
  setTimeout(resumeSeeding, 8000)
}

export const listDownloads = () => jobs

/**
 * Убрать из списка готовые старше DONE_KEEP_MS и сверх DONE_MAX; true — что-то убрали. Те, что ждут установки
 * или файла игры, остаются: без них кнопку «Установить» не найти
 */
function dropOldDone(): boolean {
  const since = Date.now() - DONE_KEEP_MS
  const at = (j: DownloadJob) => j.doneAt ?? j.addedAt
  // Раздающиеся остаются, пока раздача не закончится
  const finished = (j: DownloadJob) => j.status === 'done' && !j.seeding && (!j.install || j.install === 'installed')
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
      fs.writeFileSync(tmp, JSON.stringify(jobs.map(({ speed: _s, upSpeed: _u, held: _h, ...j }) => j)), 'utf8')
      fs.renameSync(tmp, file())
    } catch (e) {
      log('WARN', '[загрузки] не удалось записать очередь:', (e as Error).message)
    }
  }
  if (now) write()
  else saveTimer = setTimeout(write, SAVE_MS)
}

/** Очередь в интерфейс; ждущие своей очереди во время игры помечены held */
function publish() {
  for (const j of jobs) j.held = holding && j.status === 'queued' ? true : undefined
  notify(jobs)
}

let emitTimer: ReturnType<typeof setTimeout> | null = null
function emit(now = false) {
  if (now) {
    if (emitTimer) clearTimeout(emitTimer)
    emitTimer = null
    publish()
  } else {
    emitTimer ??= setTimeout(() => {
      emitTimer = null
      publish()
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

/** Следующая из очереди, если ничего не качается и не идёт игра */
function pump() {
  if (current) return
  const next = holding ? undefined : jobs.find((j) => j.status === 'queued')
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
      job.file = isTorrent(job)
        ? await torrentDownload(job, abort.signal, progress, () => save(true), seedOn())
        : await httpDownload(job, abort.signal, progress, () => save(true))
      job.downloaded = true
      job.received = job.size || job.received
      log('INFO', '[загрузки] скачано:', job.title, '→', job.file)
      if (isTorrent(job)) {
        // Настройку проверяем ещё раз: её могли поменять, пока качалось (клиенту об этом уже сказали)
        if (seedOn()) startSeed(job)
        else await dropSkipped(job)
      }
    }
    const unpackSpeed = meter()
    const unpack = (done: number, total: number) => {
      job.phase = 'extracting'
      job.unpack = { done, total }
      job.speed = unpackSpeed(done)
      emit()
    }
    // Пока раздаётся, архивы нужны раздаче: удалятся, когда она закончится
    await extractAll(job, abort.signal, unpack, () => save(true), getDb().settings.keepArchives === true ? true : job.seeding ? 'seed' : false)
    await locate(job)
    job.status = 'done'
    job.doneAt = Date.now()
    // Раздача закончилась, пока шла распаковка, — оставленные ради неё архивы больше не нужны
    if (!job.seeding) dropKeptArchives(job)
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
    // Те, что ждут установки или файла игры, и те, что раздаются, остаются — это ещё не конец
    jobs = jobs.filter((j) => j.status !== 'done' || j.seeding || (j.install && j.install !== 'installed'))
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
    case 'up':
    case 'down': {
      // Место среди ждущих (то, что качается, всегда первое): меняемся с соседом
      const line = jobs.filter((j) => j.status !== 'done' && j.status !== 'active')
      const i = line.indexOf(job)
      const k = action === 'up' ? i - 1 : i + 1
      if (i < 0 || k < 0 || k >= line.length) return
      const a = jobs.indexOf(job)
      const b = jobs.indexOf(line[k])
      jobs[a] = line[k]
      jobs[b] = job
      break
    }
    case 'now': {
      if (job.status === 'done' || job.status === 'active' || job.needPassword) return
      // Идёт игра, а качать просят сейчас — пауза на время игры снимается до конца этой игры
      if (holding) {
        override = true
        holding = false
        setTorrentHold(false)
      }
      job.status = 'queued'
      job.error = undefined
      jobs = jobs.filter((j) => j !== job)
      const first = jobs.findIndex((j) => j.status !== 'done')
      jobs.splice(first < 0 ? jobs.length : first, 0, job)
      // Текущая уступает и встаёт следом. Распаковку не прерываем: она недолгая, а начатый архив пришлось бы начинать заново
      const cur = current && jobs.find((j) => j.id === current?.id)
      if (current && cur && cur.phase !== 'extracting') {
        cur.status = 'queued'
        current.abort.abort(new Error('yield'))
      }
      break
    }
    case 'stopSeed':
      endSeed(job, true)
      return
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
  const gone = jobs.filter((j) => j.gameId === id && j.status === 'done' && j.install === 'installed')
  if (!gone.length) return
  jobs = jobs.filter((j) => !gone.includes(j))
  for (const j of gone) if (isTorrent(j)) removeTorrent(j, false)
  changed()
}

// ───────────────────────── Игра, скорость, раздача ─────────────────────────

/** Пауза на время игры: игра идёт, настройка не выключена и качать несмотря на игру не просили */
const held = () => hooks.game() && !override && getDb().settings.downloadPauseInGame !== false

/** Игра запустилась или закрылась, поменялась настройка: на время игры загрузки, распаковка и раздача стоят */
export function syncHold() {
  if (!started) return
  if (!hooks.game()) override = false
  const h = held()
  if (h === holding) return
  holding = h
  setTorrentHold(h)
  log('INFO', h ? '[загрузки] пауза на время игры' : '[загрузки] пауза на время игры снята')
  // Текущая загрузка уступает и после игры продолжается с того же места
  const cur = current && jobs.find((j) => j.id === current?.id)
  if (h && current && cur) {
    cur.status = 'queued'
    current.abort.abort(new Error('held'))
  }
  changed()
}

function applyLimits() {
  const s = getDb().settings
  setHttpLimit(s.downloadLimit ?? 0)
  setTorrentLimits(s.downloadLimit ?? 0, s.uploadLimit ?? 0)
}

/** Настройки поменялись: ограничения скорости, пауза на время игры, раздача */
export function downloadSettings(prev: Settings, next: Settings) {
  if (!started) return
  if (prev.downloadLimit !== next.downloadLimit || prev.uploadLimit !== next.uploadLimit) applyLimits()
  if (prev.downloadPauseInGame !== next.downloadPauseInGame) syncHold()
  if (!!prev.seed !== !!next.seed) {
    const cur = current && jobs.find((j) => j.id === current?.id)
    if (cur && isTorrent(cur)) setTorrentSeed(cur.id, !!next.seed)
    if (!next.seed) for (const j of jobs) endSeed(j, true)
  }
  if (prev.seedRatio !== next.seedRatio) for (const j of jobs) if (reached(j)) endSeed(j, true)
}

const seedOn = () => getDb().settings.seed === true
/** Отдано столько, сколько просили: seedRatio × размер (0 — раздаётся, пока не остановят) */
const reached = (j: DownloadJob) => {
  const r = getDb().settings.seedRatio ?? 1
  return r > 0 && !!j.size && (j.uploaded ?? 0) >= j.size * r
}

/** Торрент скачан и остаётся раздавать */
function startSeed(job: DownloadJob) {
  job.seeding = true
  watchSeed(job.id, (s) => seedStatus(job, s), () => endSeed(job, false))
  if (reached(job)) endSeed(job, true)
  else log('INFO', '[раздача] началась:', job.title)
}

function seedStatus(job: DownloadJob, s: TorrentStatus) {
  if (!job.seeding) return
  // Раздача, скачанная быстрее первого отчёта клиента, осталась без размера — а без него рейтинг не считается и раздача не кончается
  if (s.total && !job.size) job.size = s.total
  job.uploaded = s.up
  job.upSpeed = s.uprate || undefined
  if (reached(job)) return endSeed(job, true)
  emit()
  save()
}

/** Раздача закончилась: отдали сколько нужно, её остановили или клиент закрылся (stop = false — убирать уже нечего) */
function endSeed(job: DownloadJob, stop: boolean) {
  if (!job.seeding) return
  if (stop) stopSeed(job.id)
  job.seeding = undefined
  job.upSpeed = undefined
  log('INFO', '[раздача] закончилась:', job.title, `отдано ${gb(job.uploaded ?? 0)}`)
  // Клиенту нужно мгновение, чтобы отпустить файлы раздачи
  if (job.status === 'done') setTimeout(() => dropKeptArchives(job) && (save(true), emit(true)), 2000)
  changed()
}

/** Архивы, оставленные ради раздачи, — с диска (если архивы не просили оставлять); true — что-то удалили */
function dropKeptArchives(job: DownloadJob): boolean {
  const list = job.keptArchives
  if (!list?.length) return false
  job.keptArchives = undefined
  if (getDb().settings.keepArchives !== true) removeArchives(list)
  return true
}

/** После перезапуска PlayOS — раздача продолжается; продолжить нельзя или раздавать уже не нужно — заканчиваем */
function resumeSeeding() {
  for (const j of jobs) {
    if (!j.seeding) continue
    if (seedOn() && !reached(j) && resumeSeed(j, (s) => seedStatus(j, s), () => endSeed(j, false))) continue
    endSeed(j, true)
  }
}

// ───────────────────────── Файлы торрента ─────────────────────────

/** Пришёл список файлов раздачи: сколько их (для кнопки «Файлы»), выбор — только из настоящих номеров */
function filesArrived(id: string, files: TorrentFile[]) {
  const job = jobs.find((j) => j.id === id)
  if (!job) return
  job.fileCount = files.length
  if (job.skip) {
    const known = new Set(files.map((f) => f.i))
    job.skip = job.skip.filter((i) => known.has(i))
  }
  save(true)
  emit(true)
}

/** Файлы торрента и выбор; null — списка ещё нет */
export function downloadFiles(id: string): { files: TorrentFile[]; skip: number[] } | null {
  const files = torrentFiles(id)
  return files ? { files, skip: jobs.find((j) => j.id === id)?.skip ?? [] } : null
}

/** Какие файлы не качать — пока торрент не скачан; хоть один файл должен остаться */
export function setFiles(id: string, skip: number[]) {
  const job = jobs.find((j) => j.id === id)
  const files = job ? torrentFiles(id) : null
  if (!job || !files || job.downloaded || job.status === 'done') return
  const known = new Set(files.map((f) => f.i))
  const list = [...new Set(skip.filter((i) => known.has(i)))].sort((a, b) => a - b)
  if (list.length >= files.length) return
  job.skip = list.length ? list : undefined
  // Размер — сразу по выбору: на паузе клиент его не пришлёт
  const off = new Set(list)
  job.size = files.reduce((sum, f) => sum + (off.has(f.i) ? 0 : f.s), 0)
  setTorrentSkip(id, list)
  log('INFO', '[загрузки] выбор файлов:', job.title, `не качать ${list.length} из ${files.length}`)
  save(true)
  emit(true)
}

/**
 * Торрент скачан без раздачи: файлы, от которых отказались на полпути, — недокачанные куски. Убираем их и служебный
 * файл libtorrent с кусками пропущенных файлов, чтобы распаковка и установщик их не тронули
 */
async function dropSkipped(job: DownloadJob) {
  let parts: string[] = []
  try {
    parts = fs
      .readdirSync(job.dir)
      .filter((n) => /^\.[0-9a-f]{40,64}\.parts$/i.test(n))
      .map((n) => path.join(job.dir, n))
  } catch {
    /* папки нет */
  }
  const files = job.skip?.length ? torrentFiles(job.id) : null
  const off = new Set(job.skip ?? [])
  const doomed = [...(files ?? []).filter((f) => off.has(f.i)).map((f) => path.join(job.dir, f.p)), ...parts].filter((f) => inside(f, job.dir) && fs.existsSync(f))
  if (!doomed.length) return
  // Клиент только что отпустил торрент — даём ему закрыть файлы
  await new Promise((r) => setTimeout(r, 1500))
  for (const f of doomed) {
    try {
      fs.rmSync(f, { force: true })
    } catch (e) {
      log('WARN', '[загрузки] не удалось удалить пропущенный файл:', f, (e as Error).message)
    }
  }
}

const inside = (f: string, dir: string) => path.resolve(f).toLowerCase().startsWith(path.resolve(dir).toLowerCase() + path.sep)

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
