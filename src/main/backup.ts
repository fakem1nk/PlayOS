import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

/**
 * Копия данных PlayOS одним файлом .playos (обычный ZIP без сжатия: обложки и так сжаты).
 * Внутри: library.json (игры, время, сессии, настройки и ключи API), achievements.json, details-cache.json,
 * аватар и папка art без видео живого фона — его PlayOS перекачает сам.
 * Пути внутри JSON записаны абсолютными, поэтому папка данных заменяется меткой %PLAYOS_DATA%
 * и при восстановлении подставляется новая — копию можно перенести на другой компьютер.
 */

const TOKEN = '%PLAYOS_DATA%'
const JSON_FILES = ['library.json', 'achievements.json', 'details-cache.json']
const SKIP = /\.(mp4|webm|tmp)$/i

// ── CRC32 для заголовков ZIP ──
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf: Buffer) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Путь в JSON-тексте: обратные слэши удвоены */
const inJson = (p: string) => JSON.stringify(p).slice(1, -1)
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Пишет ZIP (метод store) потоково в файл */
function writeZip(out: string, entries: { name: string; data: Buffer }[]) {
  const fd = fs.openSync(out, 'w')
  const central: Buffer[] = []
  let offset = 0
  // Дата и время в формате DOS — чтобы архиватор показывал день создания копии
  const now = new Date()
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
  const write = (b: Buffer) => {
    fs.writeSync(fd, b)
    offset += b.length
  }
  for (const e of entries) {
    const name = Buffer.from(e.name.replace(/\\/g, '/'), 'utf8')
    const crc = crc32(e.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // имена в UTF-8
    local.writeUInt16LE(0, 8) // без сжатия
    local.writeUInt16LE(dosTime, 10)
    local.writeUInt16LE(dosDate, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(e.data.length, 18)
    local.writeUInt32LE(e.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    const at = offset
    write(local)
    write(name)
    write(e.data)
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0x0800, 8)
    cd.writeUInt16LE(dosTime, 12)
    cd.writeUInt16LE(dosDate, 14)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(e.data.length, 20)
    cd.writeUInt32LE(e.data.length, 24)
    cd.writeUInt16LE(name.length, 28)
    cd.writeUInt32LE(at, 42)
    central.push(cd, name)
  }
  const cdStart = offset
  for (const b of central) write(b)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(offset - cdStart, 12)
  end.writeUInt32LE(cdStart, 16)
  fs.writeSync(fd, end)
  fs.closeSync(fd)
}

/** Читает все файлы ZIP (store и deflate) */
function readZip(file: string) {
  const buf = fs.readFileSync(file)
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Файл повреждён или это не копия PlayOS')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const out = new Map<string, Buffer>()
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Файл повреждён')
    const method = buf.readUInt16LE(p + 10)
    const csize = buf.readUInt32LE(p + 20)
    const nlen = buf.readUInt16LE(p + 28)
    const xlen = buf.readUInt16LE(p + 30)
    const clen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nlen)
    const lnlen = buf.readUInt16LE(local + 26)
    const lxlen = buf.readUInt16LE(local + 28)
    const start = local + 30 + lnlen + lxlen
    const raw = buf.subarray(start, start + csize)
    out.set(name, method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw))
    p += 46 + nlen + xlen + clen
  }
  return out
}

function walk(dir: string, base: string, list: { name: string; data: Buffer }[]) {
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name !== '_tmp') walk(full, base, list)
    } else if (!SKIP.test(e.name)) {
      list.push({ name: path.relative(base, full), data: fs.readFileSync(full) })
    }
  }
}

const stamp = () => {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`
}

/** Создаёт копию данных; по умолчанию — на рабочем столе. Возвращает путь к файлу. */
export function exportData(dataDir: string, gamesCount: number, out = path.join(app.getPath('desktop'), `PlayOS-копия-${stamp()}.playos`)) {
  const from = new RegExp(escapeRe(inJson(dataDir)), 'gi')
  const entries: { name: string; data: Buffer }[] = []
  entries.push({
    name: 'manifest.json',
    data: Buffer.from(JSON.stringify({ app: 'PlayOS', version: app.getVersion(), createdAt: Date.now(), games: gamesCount }, null, 2))
  })
  for (const f of JSON_FILES) {
    const file = path.join(dataDir, f)
    if (!fs.existsSync(file)) continue
    const text = fs.readFileSync(file, 'utf8').replace(from, TOKEN)
    entries.push({ name: f, data: Buffer.from(text, 'utf8') })
  }
  // Аватар лежит в корне папки данных
  for (const f of fs.readdirSync(dataDir)) if (/^avatar-/.test(f)) entries.push({ name: f, data: fs.readFileSync(path.join(dataDir, f)) })
  walk(path.join(dataDir, 'art'), dataDir, entries)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  writeZip(out, entries)
  return out
}

/** Сведения о копии без восстановления — для подтверждения */
export function inspectBackup(file: string) {
  const files = readZip(file)
  const manifest = files.get('manifest.json')
  if (!manifest) throw new Error('Это не копия данных PlayOS')
  const m = JSON.parse(manifest.toString('utf8')) as { app?: string; version?: string; createdAt?: number; games?: number }
  if (m.app !== 'PlayOS' || !files.has('library.json')) throw new Error('Это не копия данных PlayOS')
  return { version: m.version ?? '?', createdAt: m.createdAt ?? 0, games: m.games ?? 0 }
}

/**
 * Восстанавливает данные из копии. Текущие данные сначала сохраняются в backups/.
 * Возвращает путь к сохранённой копии прежних данных.
 */
export function importData(file: string, dataDir: string, currentGames: number) {
  const files = readZip(file)
  inspectBackup(file)
  const safety = exportData(dataDir, currentGames, path.join(dataDir, 'backups', `до-восстановления-${stamp()}.playos`))
  fs.rmSync(path.join(dataDir, 'art'), { recursive: true, force: true })
  for (const f of fs.readdirSync(dataDir)) if (/^avatar-/.test(f)) fs.rmSync(path.join(dataDir, f), { force: true })
  const to = inJson(dataDir)
  for (const [name, data] of files) {
    if (name === 'manifest.json') continue
    // Защита от путей вида ../ в чужом архиве
    const target = path.resolve(dataDir, name)
    if (!target.startsWith(path.resolve(dataDir) + path.sep)) continue
    fs.mkdirSync(path.dirname(target), { recursive: true })
    if (JSON_FILES.includes(name)) fs.writeFileSync(target, data.toString('utf8').split(TOKEN).join(to), 'utf8')
    else fs.writeFileSync(target, data)
  }
  return safety
}
