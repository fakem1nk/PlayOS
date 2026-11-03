import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { DownloadJob, Platform } from '@shared/types'
import { trackableDir } from '../launcher'
import { log } from '../log'
import { findGameExe } from '../media'
import { exeOf, iconFile, registryEntries, type RegEntry } from '../uninstall'

/**
 * Что делать со скачанным: найти установщик (его запускает пользователь кнопкой «Установить»), готовую игру
 * (EXE для PC, образ или EBOOT.BIN для эмуляторов) или ничего. После установщика — где он поставил игру:
 * новая запись в «Программах и компонентах», иначе новая папка в обычных местах установки.
 */

const exists = (p: string) => {
  try {
    return fs.existsSync(p)
  } catch {
    return false
  }
}
const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
/** Насколько имя похоже на название игры: 2 — совпадает, 1 — одно содержит другое */
function likeness(name: string, title: string) {
  const a = squash(name)
  const b = squash(title)
  if (!a || !b) return 0
  if (a === b) return 2
  return a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a)) ? 1 : 0
}

/** Где искать: распакованное, затем сам скачанный файл или папка раздачи */
export function rootsOf(job: DownloadJob): string[] {
  const roots = [...(job.unpacked ?? []), ...(job.file ? [job.file] : [])].filter(exists)
  return [...new Set(roots.map((r) => path.resolve(r)))]
}

/** Файлы в ширину: в корне — глубина 0, во вложенных папках не глубже depth; служебные папки пропускаются */
function walk(root: string, depth: number, skipDir?: RegExp): { file: string; depth: number; size: number }[] {
  const out: { file: string; depth: number; size: number }[] = []
  const size = (p: string) => {
    try {
      return fs.statSync(p).size
    } catch {
      return 0
    }
  }
  if (isFileSafe(root)) return [{ file: root, depth: 0, size: size(root) }]
  const queue = [{ p: root, d: 0 }]
  let seen = 0
  while (queue.length && seen < 20000) {
    const cur = queue.shift()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(cur.p, { withFileTypes: true })
    } catch {
      continue
    }
    seen += entries.length
    for (const e of entries) {
      const full = path.join(cur.p, e.name)
      if (e.isFile()) out.push({ file: full, depth: cur.d, size: size(full) })
      else if (e.isDirectory() && cur.d < depth && !skipDir?.test(e.name)) queue.push({ p: full, d: cur.d + 1 })
    }
  }
  return out
}
const isFileSafe = (p: string) => {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

/** Установщик игры: setup.exe, install.exe, setup_игра.exe, Игра_Setup.exe — не глубже двух папок */
const INSTALLER = /(^|[ _.-])(setup|install|installer)([ _.-][^\\]*)?\.exe$/i
/** Имя как у установщика (setup.exe, Игра_Setup.exe) — такой EXE игрой не считаем */
export const isInstallerName = (file: string) => INSTALLER.test(path.basename(file))
/** Не установщик самой игры: редистрибутивы, DLC, патчи, языки */
const NOT_GAME_INSTALLER = /redist|vcredist|directx|dxsetup|dotnet|physx|openal|oalinst|vc_?\d{4}|dlc|patch|update|language|lang_/i
/** Папки, где установщика игры не бывает */
const SKIP_DIR = /^(_?commonredist|redist\w*|directx|vcredist|_?redist|prerequisites?|_?support|dlc\w*|patch\w*|updates?|crack\w*|fix\w*|bonus\w*|extras?|soundtrack|ost)$/i

export function findInstaller(roots: string[]): string | null {
  const found = roots
    .flatMap((r) => walk(r, 2, SKIP_DIR))
    .filter((f) => INSTALLER.test(path.basename(f.file)) && !NOT_GAME_INSTALLER.test(path.basename(f.file)))
  if (!found.length) return null
  // Ближе к корню, затем ровно setup.exe, затем самый большой
  found.sort((a, b) => a.depth - b.depth || Number(/^setup\.exe$/i.test(path.basename(b.file))) - Number(/^setup\.exe$/i.test(path.basename(a.file))) || b.size - a.size)
  return found[0].file
}

/** Готовая PC-игра без установщика: EXE в распакованном; сначала папки с похожим на игру названием */
export async function findPortable(roots: string[], title: string): Promise<{ path: string; dir: string } | null> {
  const ordered = [...roots].sort((a, b) => likeness(path.basename(b), title) - likeness(path.basename(a), title))
  for (const r of ordered) {
    if (isFileSafe(r)) continue
    const exe = await findGameExe(r)
    if (exe) return { path: exe, dir: gameDir(exe, r) }
  }
  return null
}

/** Папка игры: корень, в котором нашёлся EXE (а не bin\x64 внутри) */
function gameDir(exe: string, root: string) {
  const rel = path.relative(root, exe).split(path.sep)
  return rel.length > 1 ? root : path.dirname(exe)
}

/** Игра для эмулятора: PS2 — образ (.cue важнее .bin), PS3 — папка с PS3_GAME → EBOOT.BIN */
export function findImage(roots: string[], platform: Platform): string | null {
  const files = roots.flatMap((r) => walk(r, 4))
  if (platform === 'ps3') {
    const eboot = files.find((f) => /[\\/](PS3_GAME[\\/])?USRDIR[\\/]EBOOT\.BIN$/i.test(f.file))
    return eboot?.file ?? null
  }
  const rank = (f: string) => (/\.cue$/i.test(f) ? 3 : /\.(iso|chd|cso|zso|gz|mdf|nrg|img)$/i.test(f) ? 2 : /\.bin$/i.test(f) ? 1 : 0)
  const best = files.filter((f) => rank(f.file) > 0).sort((a, b) => rank(b.file) - rank(a.file) || b.size - a.size)[0]
  return best?.file ?? null
}

// ───────────────────────── Установщик ─────────────────────────

export interface InstallerRun {
  /** Код выхода установщика */
  code?: number
  /** Права администратора не дали (UAC «Нет») */
  cancelled?: boolean
  error?: string
}

/**
 * Запуск установщика через ShellExecute (PowerShell Start-Process): права администратора Windows спросит сама,
 * если они нужны установщику. Ждём, пока он закроется — установка идёт столько, сколько нужно
 */
export function runInstaller(file: string, onStart: (pid: number) => void): Promise<InstallerRun> {
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`
  const ps =
    "$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.Encoding]::UTF8;" +
    `try { $p = Start-Process -FilePath ${q(file)} -WorkingDirectory ${q(path.dirname(file))} -PassThru } ` +
    'catch { $c = $_.Exception.InnerException.NativeErrorCode; if (-not $c) { $c = $_.Exception.NativeErrorCode }; [Console]::Out.WriteLine("fail $c " + $_.Exception.Message); exit } ' +
    "[Console]::Out.WriteLine('pid ' + $p.Id); $p.WaitForExit(); [Console]::Out.WriteLine('exit ' + $p.ExitCode)"
  return new Promise((resolve) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let buf = ''
    let res: InstallerRun = { error: 'no result' }
    p.stdout.on('data', (d) => {
      buf += d.toString('utf8')
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        let m: RegExpMatchArray | null
        if ((m = line.match(/^pid (\d+)/))) onStart(Number(m[1]))
        else if ((m = line.match(/^exit (-?\d+)/))) res = { code: Number(m[1]) }
        else if ((m = line.match(/^fail (\d*)\s*(.*)$/))) res = m[1] === '1223' || /cancel|отмен/i.test(m[2]) ? { cancelled: true } : { error: m[2] }
      }
    })
    p.on('error', (e) => resolve({ error: e.message }))
    p.on('close', () => resolve(res))
  })
}

/** Снимок «Программ и компонентов» до установки: по нему видно, что установщик добавил */
export async function uninstallSnapshot(): Promise<Map<string, RegEntry>> {
  return new Map((await registryEntries()).map((e) => [e.k ?? '', e]))
}

/** Записи, которые ставят вместе с игрой: их пропускаем */
const NOT_GAME_ENTRY = /visual c\+\+|redistributable|directx|\.net|runtime|physx|openal|vulkan|microsoft|nvidia|amd |intel/i

/**
 * Где установщик поставил игру. Сначала новые записи «Программ и компонентов» (папка установки, значок —
 * обычно EXE игры). Потом, если установщик закончил успешно (folders), — папки, созданные после его запуска, в Program
 * Files, в папках загрузок и в X:\Games; папки самих загрузок и уже известных игр (skip) не в счёт. EXE — самый похожий на игру
 */
export async function findInstalled(
  before: Map<string, RegEntry>,
  title: string,
  since: number,
  opts: { places: string[]; skip: string[]; folders: boolean }
): Promise<{ path: string; dir: string } | null> {
  const fresh = (await registryEntries())
    .filter((e) => {
      const old = before.get(e.k ?? '')
      return (!old || (old.l ?? '') !== (e.l ?? '') || (old.i ?? '') !== (e.i ?? '')) && !NOT_GAME_ENTRY.test(e.n ?? '')
    })
    .sort((a, b) => likeness(b.n ?? '', title) - likeness(a.n ?? '', title))
  for (const e of fresh) {
    const icon = iconFile(e.i)
    const dirs = [e.l?.replace(/"/g, '').trim(), /\.exe$/i.test(icon) ? path.dirname(icon) : '', e.u ? path.dirname(exeOf(e.u)) : ''].filter((d): d is string => !!d && exists(d) && trackableDir(d))
    for (const dir of dirs) {
      const exe = /\.exe$/i.test(icon) && exists(icon) && !/unins|uninst|setup|install/i.test(path.basename(icon)) && icon.toLowerCase().startsWith(dir.toLowerCase()) ? icon : await findGameExe(dir)
      if (exe) {
        log('INFO', '[установка] нашли по записи', e.n, '→', exe)
        return { path: exe, dir }
      }
    }
  }
  if (!opts.folders) return null
  // Новые папки: сама папка игры или папка издателя с новой папкой игры внутри
  const norm = (p: string) => path.resolve(p).toLowerCase()
  const own = (p: string) => opts.skip.some((s) => norm(p) === norm(s) || norm(p).startsWith(norm(s) + path.sep) || norm(s).startsWith(norm(p) + path.sep))
  const born = (p: string) => {
    try {
      const st = fs.statSync(p)
      return st.isDirectory() && st.birthtimeMs >= since - 1000 && !own(p)
    } catch {
      return false
    }
  }
  const touched = (p: string) => {
    try {
      return fs.statSync(p).mtimeMs >= since - 1000
    } catch {
      return false
    }
  }
  const candidates: string[] = []
  for (const place of opts.places) {
    let names: string[] = []
    try {
      names = fs.readdirSync(place)
    } catch {
      continue
    }
    for (const n of names) {
      const full = path.join(place, n)
      if (born(full)) candidates.push(full)
      else if (touched(full)) {
        try {
          for (const m of fs.readdirSync(full)) if (born(path.join(full, m))) candidates.push(path.join(full, m))
        } catch {
          /* нет доступа */
        }
      }
    }
  }
  candidates.sort((a, b) => likeness(path.basename(b), title) - likeness(path.basename(a), title))
  for (const dir of candidates) {
    if (!trackableDir(dir)) continue
    const exe = await findGameExe(dir)
    if (exe) {
      log('INFO', '[установка] нашли новую папку', dir, '→', exe)
      return { path: exe, dir }
    }
  }
  return null
}

/** Обычные места установки: Program Files, X:\Games на всех дисках */
export function installPlaces(): string[] {
  const out = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter((p): p is string => !!p)
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') for (const n of ['Games', 'Игры']) if (exists(`${letter}:\\${n}`)) out.push(`${letter}:\\${n}`)
  return out
}
