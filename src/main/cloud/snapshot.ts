import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { crc32, readZipBuffer } from '../backup'
import { dataDir } from '../store'
import type { SaveSet } from './locate'
import { fromPortable, toPortable } from './paths'

/**
 * Снимок сохранений: ZIP (deflate) с переносимыми именами файлов (%DOCUMENTS%/…) и _playos.json
 * с временем изменения каждого файла. Хэш снимка считается по содержимому, а не по времени —
 * одинаковые сохранения на двух ПК дают одинаковый хэш.
 */

export interface LocalFile {
  /** Переносимое имя: %APPDATA%/Game/save1.sav */
  name: string
  abs: string
  size: number
  mtime: number
}

const META = '_playos.json'
const REG = '%REG%/'
const MAX_FILES = 20_000
const MAX_DEPTH = 12

// Хэш файла пересчитывается, только если поменялись размер или время — опрос раз в несколько минут почти бесплатный
const fileHashes = new Map<string, { size: number; mtime: number; hash: string }>()

function globRe(segments: string[]) {
  const body = segments
    .map((s) => (s === '**' ? '.*' : s.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')))
    .join('/')
  // Совпала папка — берём её целиком
  return new RegExp(`^${body}(/.*)?$`, 'i')
}

function walk(dir: string, rel: string, depth: number, out: { abs: string; rel: string }[]) {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name)
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) walk(abs, r, depth + 1, out)
    else if (e.isFile()) out.push({ abs, rel: r })
  }
}

/** Файлы по маске: C:\Users\me\Documents\Game\*.sav, …\savedata\BLUS30001* */
function matchPattern(pattern: string): string[] {
  const parts = path.normalize(pattern).split(/[\\/]+/)
  const first = parts.findIndex((p) => /[*?]/.test(p))
  if (first < 0) {
    try {
      const st = fs.statSync(pattern)
      if (st.isFile()) return [pattern]
      const all: { abs: string; rel: string }[] = []
      walk(pattern, '', 0, all)
      return all.map((f) => f.abs)
    } catch {
      return []
    }
  }
  const baseDir = parts.slice(0, first).join(path.sep) + path.sep
  const re = globRe(parts.slice(first))
  const all: { abs: string; rel: string }[] = []
  walk(baseDir, '', 0, all)
  return all.filter((f) => re.test(f.rel)).map((f) => f.abs)
}

export function collect(set: SaveSet): LocalFile[] {
  const seen = new Map<string, LocalFile>()
  for (const pattern of set.patterns) {
    for (const abs of matchPattern(pattern)) {
      const name = toPortable(abs, set.ctx)
      if (!name || seen.has(name.toLowerCase())) continue
      try {
        const st = fs.statSync(abs)
        seen.set(name.toLowerCase(), { name, abs, size: st.size, mtime: st.mtimeMs })
      } catch {
        // Файл исчез между обходом и stat
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
}

function fileHash(f: LocalFile) {
  const hit = fileHashes.get(f.abs)
  if (hit && hit.size === f.size && hit.mtime === f.mtime) return hit.hash
  const hash = createHash('sha256').update(fs.readFileSync(f.abs)).digest('hex')
  fileHashes.set(f.abs, { size: f.size, mtime: f.mtime, hash })
  return hash
}

const run = (cmd: string, args: string[]) =>
  new Promise<void>((resolve, reject) => execFile(cmd, args, { windowsHide: true }, (err) => (err ? reject(err) : resolve())))

const regKey = (k: string) => k.replace(/\//g, '\\').replace(/^HKEY_CURRENT_USER\\/i, 'HKCU\\')

/** Ключи реестра игры как .reg-файлы (только HKCU). Несуществующие ключи пропускаются */
async function exportRegistry(set: SaveSet): Promise<{ name: string; data: Buffer }[]> {
  const out: { name: string; data: Buffer }[] = []
  for (const [i, key] of set.registry.entries()) {
    const tmp = path.join(os.tmpdir(), `playos-reg-${process.pid}-${i}.reg`)
    try {
      await run('reg', ['export', regKey(key), tmp, '/y'])
      out.push({ name: `${REG}${i}-${key.replace(/[^\w.-]+/g, '_').slice(-80)}.reg`, data: fs.readFileSync(tmp) })
    } catch {
      // Ключа нет — игра ещё не сохраняла в реестр
    } finally {
      fs.rmSync(tmp, { force: true })
    }
  }
  return out
}

export interface LocalState {
  files: LocalFile[]
  registry: { name: string; data: Buffer }[]
  /** null — сохранений нет */
  hash: string | null
  size: number
  /** Время самого нового файла */
  at: number
}

export async function localState(set: SaveSet): Promise<LocalState> {
  const files = collect(set)
  const registry = set.registry.length ? await exportRegistry(set) : []
  if (!files.length && !registry.length) return { files, registry, hash: null, size: 0, at: 0 }
  const h = createHash('sha256')
  for (const f of files) h.update(`${f.name.toLowerCase()}\0${fileHash(f)}\n`)
  for (const r of registry) h.update(`${r.name}\0${createHash('sha256').update(r.data).digest('hex')}\n`)
  return {
    files,
    registry,
    hash: h.digest('hex').slice(0, 16),
    size: files.reduce((a, f) => a + f.size, 0) + registry.reduce((a, r) => a + r.data.length, 0),
    at: files.reduce((a, f) => Math.max(a, f.mtime), 0)
  }
}

/** ZIP с deflate: сохранения хорошо сжимаются (карта памяти PS2 — 8 МБ почти пустых блоков) */
function zip(entries: { name: string; data: Buffer }[]) {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8')
    const packed = zlib.deflateRawSync(e.data)
    const deflated = packed.length < e.data.length
    const body = deflated ? packed : e.data
    const crc = crc32(e.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(deflated ? 8 : 0, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(e.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0x0800, 8)
    cd.writeUInt16LE(deflated ? 8 : 0, 10)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(body.length, 20)
    cd.writeUInt32LE(e.data.length, 24)
    cd.writeUInt16LE(name.length, 28)
    cd.writeUInt32LE(offset, 42)
    parts.push(local, name, body)
    central.push(cd, name)
    offset += 30 + name.length + body.length
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cdSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, ...central, end])
}

export function pack(state: LocalState): Buffer {
  const entries = state.files.map((f) => ({ name: f.name, data: fs.readFileSync(f.abs) }))
  const meta = { version: 1, files: Object.fromEntries(state.files.map((f) => [f.name, f.mtime])) }
  return zip([{ name: META, data: Buffer.from(JSON.stringify(meta)) }, ...entries, ...state.registry])
}

const backupDir = (key: string) => path.join(dataDir(), 'backups', 'saves', key.replace(/[^\w.-]+/g, '_'))
const KEEP_BACKUPS = 5

/** Копия текущих сохранений перед перезаписью из облака: backups/saves/<ключ>/<время>.zip, последние 5 */
function backupLocal(set: SaveSet, state: LocalState) {
  if (!state.hash) return
  const dir = backupDir(set.key)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${Date.now()}-${state.hash}.zip`), pack(state))
  const old = fs.readdirSync(dir).sort().slice(0, -KEEP_BACKUPS)
  for (const f of old) fs.rmSync(path.join(dir, f), { force: true })
}

/**
 * Кладёт снимок на место: сначала копия текущих файлов, затем запись файлов снимка с их временем,
 * затем удаление локальных файлов набора, которых в снимке нет (их удалили в игре на другом ПК).
 */
export async function apply(set: SaveSet, data: Buffer, current: LocalState) {
  const files = readZipBuffer(data)
  const meta = JSON.parse(files.get(META)?.toString('utf8') ?? '{"files":{}}') as { files: Record<string, number> }
  backupLocal(set, current)
  const keep = new Set<string>()
  for (const [name, buf] of files) {
    if (name === META) continue
    if (name.startsWith(REG)) {
      const tmp = path.join(os.tmpdir(), `playos-reg-import-${process.pid}.reg`)
      fs.writeFileSync(tmp, buf)
      try {
        await run('reg', ['import', tmp])
      } finally {
        fs.rmSync(tmp, { force: true })
      }
      continue
    }
    const abs = fromPortable(name, set.ctx)
    if (!abs) continue
    keep.add(name.toLowerCase())
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    const tmp = abs + '.playos-tmp'
    fs.writeFileSync(tmp, buf)
    fs.renameSync(tmp, abs)
    const t = meta.files[name]
    if (t) fs.utimesSync(abs, new Date(t), new Date(t))
  }
  for (const f of current.files) if (!keep.has(f.name.toLowerCase())) fs.rmSync(f.abs, { force: true })
}
