import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import zlib from 'node:zlib'
import { t } from '@shared/i18n'
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
/** Распакованный снимок из облака: лимит набора (512 МБ) с запасом на реестр и служебный файл */
const MAX_UNPACKED = 576 * 2 ** 20
/**
 * Программы, скрипты и ярлыки — не сохранения: в облако не идут и из облака не пишутся.
 * Иначе тот, кто получил доступ к облаку, подложил бы в папку игры свой DLL или скрипт
 */
const UNSAFE_EXT = /\.(exe|dll|com|scr|pif|cpl|sys|msi|msp|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|jar|lnk|url|reg|inf)$/i
/** Имя из чужого архива: без потоков NTFS («a.sav:x»), управляющих символов и частей с точкой или пробелом на конце */
const safeName = (name: string) => !/[\0-\x1f:*?"<>|\\]/.test(name.replace(/^%[A-Z0-9]+%/, '')) && !name.split('/').some((s) => /[. ]$/.test(s))

const REG_EXE = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe')
/** Ветки HKCU, где лежит не игра, а Windows: автозапуск, ассоциации файлов, политики */
const REG_DENY = [
  'software\\classes',
  'software\\policies',
  'software\\microsoft\\windows',
  'software\\microsoft\\windows nt',
  'software\\microsoft\\command processor',
  'software\\microsoft\\internet explorer',
  'software\\microsoft\\office',
  'software\\wow6432node\\classes',
  'software\\wow6432node\\policies',
  'software\\wow6432node\\microsoft\\windows',
  'software\\wow6432node\\microsoft\\windows nt'
]
const regPath = (k: string) => k.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()

/** Ключ реестра игры: только HKEY_CURRENT_USER\Software\<…>, не системная ветка и не её родитель */
export function safeRegistryKey(key: string) {
  const sub = /^hkey_current_user\\(software\\.+)$/.exec(regPath(key))?.[1]
  if (!sub || /[*?\0-\x1f]/.test(sub)) return false
  return !REG_DENY.some((d) => sub === d || sub.startsWith(d + '\\') || d.startsWith(sub + '\\'))
}

/**
 * .reg из облака импортируется, только если это экспорт reg.exe и каждый его раздел лежит в ключах этой игры.
 * Иначе снимок записал бы что угодно в реестр — например, программу в автозапуск
 */
export function regFileAllowed(data: Buffer, keys: string[]) {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xfe) return false
  const text = data.subarray(2).toString('utf16le')
  if (text.includes('\0')) return false
  const lines = text.split(/[\r\n\v\f\u0085\u2028\u2029]+/).map((l) => l.trim())
  if (lines[0] !== 'Windows Registry Editor Version 5.00') return false
  const allowed = keys.filter(safeRegistryKey).map(regPath)
  for (const l of lines) {
    if (!l.startsWith('[')) continue
    // «[-Ключ]» — удаление ключа: экспорт таких строк не пишет
    const key = /^\[([^-].*)\]$/.exec(l)?.[1].toLowerCase()
    if (!key || !allowed.some((a) => key === a || key.startsWith(a + '\\'))) return false
  }
  return true
}

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

/**
 * Путь лежит в папках сохранений набора (те же правила, что у matchPattern, но без обхода диска).
 * Снимок из облака пишется только туда: метки вроде %APPDATA% или %HOME% сами по себе покрывают
 * весь профиль пользователя, включая автозагрузку и данные других программ
 */
export function covers(set: SaveSet, abs: string) {
  const full = path.resolve(abs)
  const low = full.toLowerCase()
  return [...set.patterns, ...(set.accept ?? [])].some((pattern) => {
    const parts = path.normalize(pattern).split(/[\\/]+/)
    const first = parts.findIndex((p) => /[*?]/.test(p))
    const base = path.resolve(first < 0 ? pattern : parts.slice(0, first).join(path.sep) + path.sep).toLowerCase().replace(/\\+$/, '')
    if (first < 0) return low === base || low.startsWith(base + path.sep)
    if (!low.startsWith(base + path.sep)) return false
    return globRe(parts.slice(first)).test(full.slice(base.length + 1).replace(/\\/g, '/'))
  })
}

export function collect(set: SaveSet): LocalFile[] {
  const seen = new Map<string, LocalFile>()
  for (const pattern of set.patterns) {
    for (const abs of matchPattern(pattern)) {
      if (UNSAFE_EXT.test(abs)) continue
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

const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex')

async function fileHash(f: LocalFile) {
  const hit = fileHashes.get(f.abs)
  if (hit && hit.size === f.size && hit.mtime === f.mtime) return hit.hash
  const hash = sha(await fs.promises.readFile(f.abs))
  fileHashes.set(f.abs, { size: f.size, mtime: f.mtime, hash })
  return hash
}

/** Хэш снимка: имена файлов (без регистра) с хэшами содержимого по порядку, затем ключи реестра */
function snapshotHash(files: { name: string; hash: string }[], registry: { name: string; hash: string }[]) {
  const h = createHash('sha256')
  for (const f of files) h.update(`${f.name.toLowerCase()}\0${f.hash}\n`)
  for (const r of registry) h.update(`${r.name}\0${r.hash}\n`)
  return h.digest('hex').slice(0, 16)
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
      await run(REG_EXE, ['export', regKey(key), tmp, '/y'])
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
  const hashes: { name: string; hash: string }[] = []
  for (const f of files) hashes.push({ name: f.name, hash: await fileHash(f) })
  return {
    files,
    registry,
    hash: snapshotHash(
      hashes,
      registry.map((r) => ({ name: r.name, hash: sha(r.data) }))
    ),
    size: files.reduce((a, f) => a + f.size, 0) + registry.reduce((a, r) => a + r.data.length, 0),
    at: files.reduce((a, f) => Math.max(a, f.mtime), 0)
  }
}

const deflate = promisify(zlib.deflateRaw)

/**
 * ZIP с deflate: сохранения хорошо сжимаются (карта памяти PS2 — 8 МБ почти пустых блоков). Сжатие — в пуле потоков, не в главном.
 * Файлы добавляются по одному: в памяти остаётся только сжатое, а не весь набор целиком рядом с архивом
 */
function zipWriter() {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  let count = 0
  return {
    async add(entryName: string, data: Buffer) {
      const name = Buffer.from(entryName, 'utf8')
      const packed = await deflate(data)
      const deflated = packed.length < data.length
      const body = deflated ? packed : data
      const crc = crc32(data)
      const local = Buffer.alloc(30)
      local.writeUInt32LE(0x04034b50, 0)
      local.writeUInt16LE(20, 4)
      local.writeUInt16LE(0x0800, 6)
      local.writeUInt16LE(deflated ? 8 : 0, 8)
      local.writeUInt32LE(crc, 14)
      local.writeUInt32LE(body.length, 18)
      local.writeUInt32LE(data.length, 22)
      local.writeUInt16LE(name.length, 26)
      const cd = Buffer.alloc(46)
      cd.writeUInt32LE(0x02014b50, 0)
      cd.writeUInt16LE(20, 4)
      cd.writeUInt16LE(20, 6)
      cd.writeUInt16LE(0x0800, 8)
      cd.writeUInt16LE(deflated ? 8 : 0, 10)
      cd.writeUInt32LE(crc, 16)
      cd.writeUInt32LE(body.length, 20)
      cd.writeUInt32LE(data.length, 24)
      cd.writeUInt16LE(name.length, 28)
      cd.writeUInt32LE(offset, 42)
      parts.push(local, name, body)
      central.push(cd, name)
      offset += 30 + name.length + body.length
      count++
    },
    end() {
      const cdSize = central.reduce((a, b) => a + b.length, 0)
      const end = Buffer.alloc(22)
      end.writeUInt32LE(0x06054b50, 0)
      end.writeUInt16LE(count, 8)
      end.writeUInt16LE(count, 10)
      end.writeUInt32LE(cdSize, 12)
      end.writeUInt32LE(offset, 16)
      return Buffer.concat([...parts, ...central, end])
    }
  }
}

/**
 * ZIP снимка и его хэш — по тем же байтам, что легли в архив: файл мог измениться после localState,
 * а хэш в имени снимка должен точно описывать содержимое (по нему другой ПК проверяет скачанное)
 */
export async function pack(state: LocalState): Promise<{ data: Buffer; hash: string }> {
  const z = zipWriter()
  await z.add(META, Buffer.from(JSON.stringify({ version: 1, files: Object.fromEntries(state.files.map((f) => [f.name, f.mtime])) })))
  const hashes: { name: string; hash: string }[] = []
  for (const f of state.files) {
    const data = await fs.promises.readFile(f.abs)
    hashes.push({ name: f.name, hash: sha(data) })
    await z.add(f.name, data)
  }
  for (const r of state.registry) await z.add(r.name, r.data)
  return {
    data: z.end(),
    hash: snapshotHash(
      hashes,
      state.registry.map((r) => ({ name: r.name, hash: sha(r.data) }))
    )
  }
}

/** Хэш содержимого архива — тот же, что у снимка при упаковке */
function zipHash(files: Map<string, Buffer>) {
  const all = [...files].filter(([name]) => name !== META).map(([name, data]) => ({ name, hash: sha(data) }))
  return snapshotHash(
    all.filter((f) => !f.name.startsWith(REG)),
    all.filter((f) => f.name.startsWith(REG))
  )
}

const backupDir = (key: string) => path.join(dataDir(), 'backups', 'saves', key.replace(/[^\w.-]+/g, '_'))
const KEEP_BACKUPS = 5

/** Копия текущих сохранений перед перезаписью из облака: backups/saves/<ключ>/<время>.zip, последние 5. Возвращает архив копии */
async function backupLocal(set: SaveSet, state: LocalState): Promise<Buffer | null> {
  if (!state.hash) return null
  const dir = backupDir(set.key)
  fs.mkdirSync(dir, { recursive: true })
  const data = (await pack(state)).data
  fs.writeFileSync(path.join(dir, `${Date.now()}-${state.hash}.zip`), data)
  const old = fs.readdirSync(dir).sort().slice(0, -KEEP_BACKUPS)
  for (const f of old) fs.rmSync(path.join(dir, f), { force: true })
  return data
}

const fileTimes = (files: Map<string, Buffer>) => {
  try {
    const meta = JSON.parse(files.get(META)?.toString('utf8') ?? '{}') as { files?: unknown }
    return meta.files && typeof meta.files === 'object' ? (meta.files as Record<string, unknown>) : {}
  } catch {
    // Без времени файлов снимок всё равно ложится
    return {}
  }
}

function setTime(abs: string, at: unknown) {
  if (typeof at === 'number' && at > 0 && at < 8.64e15) fs.utimesSync(abs, new Date(at), new Date(at))
}

/** Снимок лёг не целиком: уже заменённые файлы возвращаются из копии, новые — убираются */
function rollback(set: SaveSet, backup: Buffer | null, placed: string[]) {
  const touched = new Set(placed.map((p) => p.toLowerCase()))
  try {
    const old = backup ? readZipBuffer(backup) : new Map<string, Buffer>()
    const times = fileTimes(old)
    for (const [name, buf] of old) {
      const abs = name === META || name.startsWith(REG) ? null : fromPortable(name, set.ctx)
      if (!abs || !touched.delete(abs.toLowerCase())) continue
      fs.writeFileSync(abs, buf)
      setTime(abs, times[name])
    }
    for (const abs of placed) if (touched.has(abs.toLowerCase())) fs.rmSync(abs, { force: true })
  } catch {
    // Копия осталась в backups/saves — вернуть можно вручную
  }
}

/**
 * Кладёт снимок на место: сначала проверка, что скачан он целиком и без порчи (хэш содержимого = хэш в имени),
 * затем копия текущих файлов, запись файлов снимка с их временем и удаление локальных файлов набора,
 * которых в снимке нет (их удалили в игре на другом ПК).
 */
export async function apply(set: SaveSet, data: Buffer, current: LocalState, expect?: string) {
  let files: Map<string, Buffer>
  try {
    files = readZipBuffer(data, { files: MAX_FILES + 64, bytes: MAX_UNPACKED })
  } catch {
    files = new Map()
  }
  if (!files.size || (expect && zipHash(files) !== expect)) throw new Error(t('Снимок в облаке повреждён — сохранения на этом ПК не тронуты'))
  const times = fileTimes(files)
  // Сначала проверяем снимок целиком и только потом трогаем диск: содержимое облака — чужие данные.
  // Хэш в имени говорит лишь о целости, а не о том, что снимок собрал PlayOS
  const foreign = new Error(t('В снимке из облака есть файлы не из папок сохранений этой игры — сохранения на этом ПК не тронуты'))
  const write: { name: string; abs: string; buf: Buffer }[] = []
  const reg: Buffer[] = []
  for (const [name, buf] of files) {
    if (name === META) continue
    if (name.startsWith(REG)) {
      if (!regFileAllowed(buf, set.registry)) throw foreign
      reg.push(buf)
      continue
    }
    const abs = safeName(name) ? fromPortable(name, set.ctx) : null
    if (!abs || UNSAFE_EXT.test(abs) || !covers(set, abs)) throw foreign
    write.push({ name, abs, buf })
  }
  const backup = await backupLocal(set, current)
  // Всё или ничего. Шаг 1: файлы снимка пишутся рядом под временным именем — нет места или папка недоступна
  // выясняется здесь, пока сохранения не тронуты. Шаг 2: быстрые переименования; сбой посередине — откат из копии
  const TMP = '.playos-tmp'
  const staged: string[] = []
  const placed: string[] = []
  const keep = new Set<string>()
  try {
    for (const { abs, buf } of write) {
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      staged.push(abs + TMP)
      await fs.promises.writeFile(abs + TMP, buf)
    }
    for (const { name, abs } of write) {
      fs.renameSync(abs + TMP, abs)
      placed.push(abs)
      keep.add(name.toLowerCase())
      setTime(abs, times[name])
    }
    for (const buf of reg) {
      const tmp = path.join(os.tmpdir(), `playos-reg-import-${process.pid}.reg`)
      fs.writeFileSync(tmp, buf)
      try {
        await run(REG_EXE, ['import', tmp])
      } finally {
        fs.rmSync(tmp, { force: true })
      }
    }
  } catch (e) {
    for (const f of staged) fs.rmSync(f, { force: true })
    if (placed.length) rollback(set, backup, placed)
    throw e
  }
  for (const f of current.files) if (!keep.has(f.name.toLowerCase())) fs.rmSync(f.abs, { force: true })
}
