import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { powerSaveBlocker, shell } from 'electron'
import type { DownloadControl, DownloadDrive, DownloadFolder, DownloadJob, DownloadKind, DownloadRequest } from '@shared/types'
import { t } from '@shared/i18n'
import { log } from '../log'
import { dataDir, getDb, saveDb } from '../store'
import { diskSpace, freeSpace, httpDownload, parseSize, safeName, Stop, type Progress } from './http'
import { quitTorrents, removeTorrent, torrentDownload, torrentReady } from './torrent'

/**
 * Очередь загрузок PlayOS. Качается одна загрузка, остальные ждут; очередь лежит в downloads.json и после
 * перезапуска продолжается с того же места. Интерфейс получает очередь целиком: при смене состояния сразу,
 * прогресс — не чаще раза в полсекунды. Пока что-то качается, Windows не уходит в сон.
 * Каждая загрузка — в своей папке «папка пользователя\название игры»; удаляются только файлы, которые она скачала.
 * Прямые ссылки качает http.ts, торренты — свой клиент на libtorrent (torrent.ts).
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

/** Какие ссылки PlayOS качает сам: прямые — всегда, торренты — если на месте торрент-клиент */
export const canDownload = (kind: DownloadKind) => kind === 'http' || torrentReady()
const isTorrent = (j: DownloadJob) => j.kind !== 'http'

/** Поднять очередь после запуска: прерванная загрузка продолжается сама */
export function startDownloads(onChange: (list: DownloadJob[]) => void) {
  notify = onChange
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8')) as DownloadJob[]
    jobs = Array.isArray(raw) ? raw : []
  } catch {
    jobs = []
  }
  for (const j of jobs) {
    j.speed = undefined
    if (j.status === 'active') j.status = 'queued'
  }
  if (dropOldDone()) save(true)
  setInterval(() => dropOldDone() && changed(), DONE_CHECK_MS)
  pump()
}

export const listDownloads = () => jobs

/** Убрать из списка готовые старше DONE_KEEP_MS и сверх DONE_MAX; true — что-то убрали */
function dropOldDone(): boolean {
  const since = Date.now() - DONE_KEEP_MS
  const at = (j: DownloadJob) => j.doneAt ?? j.addedAt
  const keep = new Set(
    jobs
      .filter((j) => j.status === 'done' && at(j) > since)
      .sort((a, b) => at(b) - at(a))
      .slice(0, DONE_MAX)
  )
  const old = jobs.filter((j) => j.status === 'done' && !keep.has(j))
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

async function run(job: DownloadJob) {
  const abort = new AbortController()
  current = { id: job.id, abort }
  job.status = 'active'
  job.error = undefined
  holdAwake(true)
  save(true)
  emit(true)
  const samples: [number, number][] = []
  const progress: Progress = (received, size) => {
    job.received = received
    if (size) job.size = size
    const now = Date.now()
    samples.push([now, received])
    while (samples.length > 2 && now - samples[0][0] > SPEED_WINDOW) samples.shift()
    const [t0, r0] = samples[0]
    job.speed = now > t0 ? Math.round(((received - r0) * 1000) / (now - t0)) : 0
    emit()
    save()
  }
  try {
    job.file = await (isTorrent(job) ? torrentDownload : httpDownload)(job, abort.signal, progress, () => save(true))
    job.status = 'done'
    job.doneAt = Date.now()
    job.received = job.size || job.received
    log('INFO', '[загрузки] готово:', job.title, '→', job.file)
    dropOldDone()
  } catch (e) {
    // Пауза и отмена сами выставили состояние — это не ошибка
    if (!abort.signal.aborted) {
      job.status = 'error'
      job.error = errText(e)
      log('WARN', '[загрузки] остановилась:', job.title, job.error, e instanceof Stop ? '' : '(после повторов)')
    }
  } finally {
    job.speed = undefined
    job.phase = undefined
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
    jobs = jobs.filter((j) => j.status !== 'done')
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

/**
 * Только файлы этой загрузки, и только внутри её папки; пустая папка — тоже. Торрент удаляет свои файлы клиент,
 * а если клиент уже закрыт — PlayOS сам удаляет папку раздачи
 */
function deleteFiles(job: DownloadJob) {
  const inside = (f: string) => path.resolve(f).startsWith(path.resolve(job.dir) + path.sep)
  if (isTorrent(job)) removeTorrent(job, true)
  // Файл мог ещё держаться открытым после остановки — даём ему закрыться
  setTimeout(() => {
    for (const f of job.file ? [job.file, job.file + '.part'] : []) if (inside(f)) fs.rmSync(f, { force: true, recursive: true })
    try {
      fs.rmdirSync(job.dir)
    } catch {
      /* в папке есть что-то ещё */
    }
  }, isTorrent(job) ? 2000 : 300)
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
