import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { DownloadJob } from '@shared/types'
import { t } from '@shared/i18n'
import { log } from '../log'
import { freeSpace, Stop } from './http'

/**
 * Распаковка скачанного своим 7-Zip (resources/7zip: zip, 7z, rar, архивы из частей). Каждый архив распаковывается
 * рядом с собой, как «Распаковать здесь». Сначала список файлов: сколько нужно места и не зашифрован ли архив.
 * Пароль — только от пользователя: архив его просит или введённый не подошёл → загрузка ждёт «Ввести пароль».
 * Архив удаляется только после успешной распаковки (если пользователь не попросил оставлять архивы).
 */

export const sevenZipPath = () =>
  app.isPackaged ? path.join(process.resourcesPath, '7zip', '7z.exe') : path.join(app.getAppPath(), 'resources', '7zip', '7z.exe')

/** Архиву нужен пароль: его нет или он не подошёл */
export class NeedPassword extends Stop {}

/** Первая часть архива — с неё 7-Zip читает остальные части; остальные части и не архивы — false */
function firstPart(name: string): boolean {
  const n = name.toLowerCase()
  const part = n.match(/\.part(\d+)\.rar$/)
  if (part) return Number(part[1]) === 1
  if (/\.(zip|7z|rar)$/.test(n)) return true
  // Разбитый на куски файл: game.7z.001, game.iso.001
  const split = n.match(/\.[a-z0-9]+\.(\d{3})$/)
  return !!split && Number(split[1]) === 1
}

/** Все части архива — удаляются вместе после распаковки */
function volumes(file: string): string[] {
  const dir = path.dirname(file)
  const name = path.basename(file)
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let m: RegExpMatchArray | null
  let re: RegExp
  if ((m = name.match(/^(.*)\.part\d+\.rar$/i))) re = new RegExp(`^${esc(m[1])}\\.part\\d+\\.rar$`, 'i')
  else if ((m = name.match(/^(.*\.[a-z0-9]+)\.\d{3}$/i))) re = new RegExp(`^${esc(m[1])}\\.\\d{3}$`, 'i')
  else if ((m = name.match(/^(.*)\.rar$/i))) re = new RegExp(`^${esc(m[1])}\\.(rar|r\\d{2})$`, 'i')
  else if ((m = name.match(/^(.*)\.zip$/i))) re = new RegExp(`^${esc(m[1])}\\.(zip|z\\d{2})$`, 'i')
  else return [file]
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => re.test(f))
      .map((f) => path.join(dir, f))
  } catch {
    return [file]
  }
}

/**
 * Что распаковать. Скачанный файл — если это архив. Папка раздачи — архивы в ней самой (или в её единственной
 * вложенной папке), но только когда рядом нет программ: архивы внутри готовой игры или рядом с установщиком — это её
 * данные, их не трогаем
 */
export function findArchives(root: string): string[] {
  let dir = root
  for (let depth = 0; depth < 3; depth++) {
    let st: fs.Stats
    try {
      st = fs.statSync(dir)
    } catch {
      return []
    }
    if (st.isFile()) return firstPart(path.basename(dir)) ? [dir] : []
    if (!st.isDirectory()) return []
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return []
    }
    const files = entries.filter((e) => e.isFile()).map((e) => e.name)
    const dirs = entries.filter((e) => e.isDirectory())
    if (!files.length && dirs.length === 1) {
      dir = path.join(dir, dirs[0].name)
      continue
    }
    if (files.some((n) => /\.(exe|msi|bat|cmd)$/i.test(n))) return []
    return files
      .filter(firstPart)
      .sort()
      .map((n) => path.join(dir, n))
  }
  return []
}

/** Запуск 7-Zip. onData вернул true — дальше не ждём (например, пароль не подошёл): процесс закрывается */
function sevenZip(args: string[], signal: AbortSignal, onData?: (chunk: string) => boolean | void): Promise<{ code: number; out: string }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const p = spawn(sevenZipPath(), args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let stopped = false
    const take = (d: Buffer) => {
      const s = d.toString('utf8')
      out += s
      // Распаковке нужен только хвост вывода (там ошибки); списку — весь
      if (onData && out.length > 1_000_000) out = out.slice(-100_000)
      if (onData?.(s) && !stopped) {
        stopped = true
        p.kill()
      }
    }
    p.stdout.on('data', take)
    p.stderr.on('data', take)
    const onAbort = () => p.kill()
    signal.addEventListener('abort', onAbort, { once: true })
    p.on('error', (e) => {
      signal.removeEventListener('abort', onAbort)
      reject(new Stop(t('Не получилось запустить 7-Zip: {e}', { e: e.message })))
    })
    p.on('close', (code) => {
      signal.removeEventListener('abort', onAbort)
      if (signal.aborted) reject(signal.reason)
      else resolve({ code: code ?? -1, out })
    })
  })
}

/** Пароль для 7-Zip: свой или случайный — чтобы 7-Zip не ждал ввода, а сразу сказал, что пароль нужен */
const passArg = (job: DownloadJob) => '-p' + (job.password || crypto.randomUUID())

interface Listing {
  /** Сколько займут файлы после распаковки */
  size: number
  encrypted: boolean
  /** Что окажется на верхнем уровне папки распаковки */
  top: string[]
}

async function list(job: DownloadJob, archive: string, signal: AbortSignal): Promise<Listing> {
  const name = path.basename(archive)
  const { code, out } = await sevenZip(['l', '-slt', '-sccUTF-8', passArg(job), archive], signal)
  if (/Cannot open encrypted archive|Wrong password/i.test(out)) {
    throw new NeedPassword(job.password ? t('Пароль не подошёл') : t('Архив защищён паролем'))
  }
  if (code !== 0) {
    log('WARN', '[распаковка] список не открылся:', archive, out.slice(-600))
    throw new Stop(/Missing volume|Unexpected end/i.test(out) ? cutShort(archive) : t('Не получилось открыть архив {name}', { name }))
  }
  // Файлы — после последней черты «----------»; выше описание самого архива (у архива из частей их два)
  const line = out.lastIndexOf('\n----------')
  const body = line < 0 ? '' : out.slice(line + 1)
  let size = 0
  let encrypted = false
  const top = new Set<string>()
  for (const block of body.split(/\r?\n\r?\n/)) {
    const field = (k: string) => block.match(new RegExp(`^${k} = (.*)$`, 'm'))?.[1]?.trim() ?? ''
    const p = field('Path')
    if (!p) continue
    if (!field('Attributes').includes('D')) size += Number(field('Size')) || 0
    if (field('Encrypted') === '+') encrypted = true
    const first = p.split(/[\\/]/).find((x) => x && x !== '.' && x !== '..')
    if (first) top.add(first)
  }
  return { size, encrypted, top: [...top] }
}

/** Архив обрывается: у архива из частей не хватает части, цельный скачан не до конца */
function cutShort(archive: string) {
  const name = path.basename(archive)
  return volumes(archive).length > 1 || /\.\d{3}$/.test(archive)
    ? t('Не хватает части архива {name}', { name })
    : t('Архив {name} повреждён или скачан не целиком', { name })
}

/** Что 7-Zip сказал при ошибке — понятным текстом */
function extractError(out: string, archive: string, hasPassword: boolean): Error {
  const name = path.basename(archive)
  if (/Wrong password/i.test(out)) return new NeedPassword(hasPassword ? t('Пароль не подошёл') : t('Архив защищён паролем'))
  if (/not enough space|no space left/i.test(out)) return new Stop(t('Не хватает места на диске для распаковки'))
  if (/Missing volume|Unexpected end of (archive|data)/i.test(out)) return new Stop(cutShort(archive))
  if (/CRC Failed|Data Error|Headers Error/i.test(out)) return new Stop(t('Архив {name} повреждён', { name }))
  return new Stop(t('Не получилось распаковать {name}', { name }))
}

const gb = (n: number) => t('{v} ГБ', { v: (n / 2 ** 30).toFixed(1) })

/**
 * Распаковать архивы загрузки по очереди; прогресс — байты всех архивов вместе. Распакованный архив сразу уходит
 * из job.archives (и с диска, если не keep), так что повтор после ошибки продолжает со следующего
 */
export async function extractAll(job: DownloadJob, signal: AbortSignal, progress: (done: number, total: number) => void, persist: () => void, keep: boolean) {
  if (!job.archives) {
    job.archives = findArchives(job.file ?? job.dir)
    persist()
  }
  const pending = job.archives.filter((a) => fs.existsSync(a))
  if (!pending.length) return
  log('INFO', '[распаковка] архивы:', job.title, pending.map((a) => path.basename(a)).join(', '))
  // Сначала списки всех архивов: общий размер для прогресса и пароль — до того, как что-то распаковано
  const lists: Listing[] = []
  for (const a of pending) {
    const l = await list(job, a, signal)
    if (l.encrypted && !job.password) throw new NeedPassword(t('Архив защищён паролем'))
    lists.push(l)
  }
  const total = lists.reduce((s, l) => s + l.size, 0)
  let base = 0
  progress(0, total)
  for (let i = 0; i < pending.length; i++) {
    const archive = pending[i]
    const name = path.basename(archive)
    const { size, top } = lists[i]
    const dir = path.dirname(archive)
    const free = await freeSpace(dir)
    if (free !== null && size > free) throw new Stop(t('Не хватает места для распаковки: нужно {need}, свободно {free}', { need: gb(size), free: gb(free) }))
    // Запоминаем только то, чего в папке ещё не было: удаление загрузки не заденет чужое
    const fresh = top.map((x) => path.join(dir, x)).filter((p) => !fs.existsSync(p))
    job.unpacked = [...new Set([...(job.unpacked ?? []), ...fresh])]
    persist()
    let wrong = false
    const { code, out } = await sevenZip(['x', '-y', '-bso0', '-bse1', '-bsp1', '-sccUTF-8', passArg(job), '-o' + dir, archive], signal, (s) => {
      if (/Wrong password/i.test(s)) return (wrong = true)
      const pct = [...s.matchAll(/(\d{1,3})%/g)].pop()
      if (pct) progress(base + (size * Math.min(100, Number(pct[1]))) / 100, total)
    })
    if (wrong || code !== 0) {
      log('WARN', '[распаковка] ошибка:', archive, 'код', code, out.slice(-800))
      throw extractError(out, archive, !!job.password)
    }
    base += size
    progress(base, total)
    job.archives = job.archives.filter((a) => a !== archive)
    if (!keep) for (const v of volumes(archive)) fs.rmSync(v, { force: true })
    persist()
    log('INFO', '[распаковка] готово:', name, '→', dir)
  }
}
