import { once } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import type { DownloadJob } from '@shared/types'
import { t } from '@shared/i18n'
import { httpFetch } from '../http'

/**
 * Загрузка по прямой ссылке через сетевой стек Chromium (системный прокси и VPN, как у браузера).
 * Файл пишется рядом с суффиксом .part и переименовывается в конце. Докачка — заголовком Range с того места,
 * где остановились: после паузы, обрыва или перезапуска PlayOS. Ссылки варианта — зеркала, пробуются по очереди.
 */

/** Нет данных столько времени — соединение повисло, переподключаемся с того же места */
const STALL_MS = 30_000
/** Паузы между попытками после обрыва */
const BACKOFF = [3000, 10_000, 30_000, 60_000]

/** С этой ссылкой дальше пробовать бесполезно — к следующему зеркалу */
class BadLink extends Error {}
/** Дальше не пробовать вовсе: не хватает места, нельзя писать на диск */
export class Stop extends Error {}

export type Progress = (received: number, size: number) => void

const units: Record<string, number> = { b: 1, kb: 2 ** 10, mb: 2 ** 20, gb: 2 ** 30, tb: 2 ** 40, б: 1, кб: 2 ** 10, мб: 2 ** 20, гб: 2 ** 30, тб: 2 ** 40 }

/** Размер из источника: «33.5 GB», «4,7 ГБ», «850 MB». Не понятно — 0 */
export function parseSize(s?: string): number {
  const m = s?.trim().match(/^([\d.,]+)\s*([a-zа-я]+)/i)
  if (!m) return 0
  const n = Number(m[1].replace(',', '.'))
  // GiB и GB для раздач одно и то же
  const k = units[m[2].toLowerCase().replace(/ib$/, 'b')] ?? 0
  return Number.isFinite(n) ? Math.round(n * k) : 0
}

/** Место на диске этой папки (или ближайшей существующей выше), байт; null — не узнать */
export async function diskSpace(dir: string): Promise<{ free: number; total: number } | null> {
  let d = path.resolve(dir)
  for (;;) {
    try {
      const s = await fs.promises.statfs(d)
      return { free: s.bavail * s.bsize, total: s.blocks * s.bsize }
    } catch {
      const up = path.dirname(d)
      if (up === d) return null
      d = up
    }
  }
}

export const freeSpace = async (dir: string) => (await diskSpace(dir))?.free ?? null

/** Ограничение скорости, байт/с; 0 — без ограничения. Задаёт очередь из настроек */
let limit = 0
export const setHttpLimit = (bps: number) => (limit = bps > 0 ? Math.round(bps) : 0)

/**
 * Ведро токенов: limit байт в секунду, запас — не больше полсекунды. Обогнали — ждём, пока ведро снова наполнится;
 * пока ждём, данные не читаются, и сервер сам сбавляет скорость
 */
let budget = 0
let budgetAt = 0
async function throttle(n: number, signal: AbortSignal) {
  const now = Date.now()
  budget = Math.min(limit / 2, budget + ((now - budgetAt) * limit) / 1000) - n
  budgetAt = now
  if (budget < 0) await sleep(Math.min(5000, (-budget * 1000) / limit), signal)
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(id), reject(signal.reason)), { once: true })
  })

const sizeOf = (file: string) =>
  fs.promises
    .stat(file)
    .then((s) => s.size)
    .catch(() => 0)

/** Имя файла: из заголовка Content-Disposition, иначе из ссылки. Без символов, запрещённых в Windows */
function fileName(r: Response, uri: string, job: DownloadJob): string {
  const cd = r.headers.get('content-disposition') ?? ''
  let name = cd.match(/filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/)?.[1] ?? cd.match(/filename\s*=\s*"?([^";]+)"?/)?.[1] ?? ''
  if (!name) {
    try {
      name = new URL(r.url || uri).pathname.split('/').pop() ?? ''
    } catch {
      /* битая ссылка — имя по игре */
    }
  }
  try {
    name = decodeURIComponent(name)
  } catch {
    /* оставляем как есть */
  }
  name = safeName(name)
  return name || `${safeName(job.title) || 'download'}.bin`
}

/** Имя файла или папки без символов, запрещённых в Windows, и без точек и пробелов в конце */
export function safeName(s: string): string {
  return s
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 150)
}

/** Такой файл уже лежит в папке (не наш) — добавляем « (2)», « (3)»… */
function freeName(dir: string, name: string): string {
  const ext = path.extname(name)
  const stem = name.slice(0, name.length - ext.length)
  for (let i = 1; ; i++) {
    const file = path.join(dir, i === 1 ? name : `${stem} (${i})${ext}`)
    if (!fs.existsSync(file) && !fs.existsSync(file + '.part')) return file
  }
}

const sizeText = (n: number) => (n >= 2 ** 30 ? t('{v} ГБ', { v: (n / 2 ** 30).toFixed(1) }) : t('{v} МБ', { v: Math.max(1, Math.round(n / 2 ** 20)) }))

/**
 * Скачать файл варианта. persist — job поменялся так, что это надо сохранить сразу (узнали имя файла и размер).
 * Возвращает путь к готовому файлу
 */
export async function httpDownload(job: DownloadJob, signal: AbortSignal, progress: Progress, persist: () => void): Promise<string> {
  const links = job.uris.filter((u) => /^https?:\/\//i.test(u))
  if (!links.length) throw new Stop(t('У варианта нет прямой ссылки на файл'))
  let last: unknown
  for (const uri of links) {
    for (let attempt = 0; ; attempt++) {
      if (signal.aborted) throw signal.reason
      try {
        return await fetchOnce(job, uri, signal, progress, persist)
      } catch (e) {
        if (signal.aborted || e instanceof Stop) throw e
        last = e
        if (e instanceof BadLink || attempt >= BACKOFF.length) break
        await sleep(BACKOFF[attempt], signal)
      }
    }
  }
  throw last
}

async function fetchOnce(job: DownloadJob, uri: string, signal: AbortSignal, progress: Progress, persist: () => void): Promise<string> {
  await fs.promises.mkdir(job.dir, { recursive: true }).catch((e) => {
    throw new Stop(t('Не получилось создать папку {dir}: {e}', { dir: job.dir, e: (e as Error).message }))
  })
  let offset = job.file ? await sizeOf(job.file + '.part') : 0
  // Своё прерывание: пауза снаружи или зависшее соединение
  const ctl = new AbortController()
  const onAbort = () => ctl.abort(signal.reason)
  signal.addEventListener('abort', onAbort, { once: true })
  let stall: ReturnType<typeof setTimeout> | undefined
  const arm = () => {
    clearTimeout(stall)
    stall = setTimeout(() => ctl.abort(new Error(t('Сервер перестал отдавать данные'))), STALL_MS)
  }
  try {
    arm()
    const r = await httpFetch(uri, { signal: ctl.signal, headers: offset ? { Range: `bytes=${offset}-` } : {} })
    // Всё уже скачано: сервер отвечает, что докачивать нечего
    if (r.status === 416 && job.file && job.size && offset >= job.size) return await finish(job)
    if (!r.ok) {
      const text = r.status === 404 || r.status === 410 ? t('Файла по ссылке нет (ошибка {code})', { code: r.status }) : t('Сервер ответил {code}', { code: r.status })
      if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) throw new BadLink(text)
      throw new Error(text)
    }
    // Файлообменники отдают страницу со своей кнопкой «Скачать» — такую ссылку прямой не считаем
    if (/text\/html/i.test(r.headers.get('content-type') ?? '')) throw new BadLink(t('По ссылке страница сайта, а не файл: откройте её в браузере'))
    const resumed = r.status === 206 && offset > 0
    if (!resumed) offset = 0
    const total = resumed ? Number(r.headers.get('content-range')?.split('/')[1]) || 0 : Number(r.headers.get('content-length')) || 0
    if (!job.file) job.file = freeName(job.dir, fileName(r, uri, job))
    if (total) job.size = total
    persist()
    const need = (job.size || 0) - offset
    const free = await freeSpace(job.dir)
    if (need > 0 && free !== null && need > free) throw new Stop(t('Не хватает места на диске: нужно ещё {need}, свободно {free}', { need: sizeText(need), free: sizeText(free) }))
    if (!r.body) throw new Error(t('Сервер не прислал файл'))
    const out = fs.createWriteStream(job.file + '.part', { flags: resumed ? 'a' : 'w' })
    const failed = new Promise<never>((_, reject) => out.once('error', (e) => reject(new Stop(t('Не получилось записать файл: {e}', { e: e.message })))))
    failed.catch(() => {})
    let received = offset
    const reader = r.body.getReader()
    try {
      for (;;) {
        const { done, value } = await Promise.race([reader.read(), failed])
        if (done) break
        arm()
        received += value.byteLength
        if (!out.write(value)) await Promise.race([once(out, 'drain'), failed])
        progress(received, job.size)
        if (limit) await throttle(value.byteLength, ctl.signal)
      }
    } finally {
      await new Promise<void>((resolve) => out.end(resolve))
    }
    // Соединение закрылось раньше конца файла — следующая попытка докачает
    if (job.size && received < job.size) throw new Error(t('Соединение оборвалось'))
    if (!job.size) job.size = received
    return await finish(job)
  } finally {
    clearTimeout(stall)
    signal.removeEventListener('abort', onAbort)
  }
}

async function finish(job: DownloadJob): Promise<string> {
  await fs.promises.rename(job.file + '.part', job.file!)
  return job.file!
}
