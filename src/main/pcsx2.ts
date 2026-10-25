import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import type { SaveSlot } from '@shared/types'

/**
 * Всё про PCSX2 вне самого эмулятора: где лежат его данные, какие у него горячие клавиши,
 * какие слоты сохранений заняты (со скриншотами из файлов .p2s) и включён ли PINE.
 */

type Ini = Record<string, Record<string, string[]>>

export function pcsx2DataDir(exe: string): string | null {
  const exeDir = path.dirname(exe)
  if (['portable.ini', 'portable.txt'].some((f) => fs.existsSync(path.join(exeDir, f)))) return exeDir
  const docs = path.join(app.getPath('documents'), 'PCSX2')
  return fs.existsSync(docs) ? docs : null
}

const iniPath = (dataDir: string) => path.join(dataDir, 'inis', 'PCSX2.ini')

function readIni(dataDir: string): Ini | null {
  try {
    const ini: Ini = {}
    let section = ''
    for (const raw of fs.readFileSync(iniPath(dataDir), 'utf8').split(/\r?\n/)) {
      const line = raw.trim()
      const sec = line.match(/^\[(.+)\]$/)
      if (sec) {
        section = sec[1]
        continue
      }
      const kv = line.match(/^([^=;#]+?)\s*=\s*(.*)$/)
      if (kv) ((ini[section] ??= {})[kv[1]] ??= []).push(kv[2])
    }
    return ini
  } catch {
    return null
  }
}

/** «Keyboard/Shift & Keyboard/F2» → «Shift+F2». Привязки к геймпаду пропускаем. */
function keyboardBinding(values: string[] | undefined): string | undefined {
  for (const v of values ?? []) {
    const parts = v.split('&').map((p) => p.trim())
    if (parts.length && parts.every((p) => p.startsWith('Keyboard/'))) return parts.map((p) => p.slice(9)).join('+')
  }
  return undefined
}

export interface Pcsx2Config {
  dataDir: string
  pineEnabled: boolean
  pinePort: number
  keys: { save?: string; load?: string; next?: string; prev?: string; pause?: string }
  sstates: string
  /** Папка карт памяти и включённые карты (файл .ps2 или папка — «папочная» карта) */
  memcards: string
  cards: string[]
}

export function pcsx2Config(exe: string): Pcsx2Config | null {
  const dataDir = pcsx2DataDir(exe)
  if (!dataDir) return null
  const ini = readIni(dataDir)
  const core = ini?.EmuCore ?? {}
  const hk = ini?.Hotkeys ?? {}
  const folder = ini?.Folders?.Savestates?.[0] ?? 'sstates'
  const cardsFolder = ini?.Folders?.MemoryCards?.[0] ?? 'memcards'
  const memcards = path.isAbsolute(cardsFolder) ? cardsFolder : path.join(dataDir, cardsFolder)
  const mc = ini?.MemoryCards ?? {}
  const cards = [1, 2]
    .filter((n) => (mc[`Slot${n}_Enable`]?.[0] ?? 'true').toLowerCase() === 'true')
    .map((n) => path.join(memcards, mc[`Slot${n}_Filename`]?.[0] ?? `Mcd00${n}.ps2`))
  return {
    dataDir,
    pineEnabled: core.EnablePINE?.[0]?.toLowerCase() === 'true',
    pinePort: Number(core.PINESlot?.[0]) || 28011,
    keys: {
      // Если пользователь ничего не менял, в ini может не быть строк — берём значения по умолчанию PCSX2
      save: keyboardBinding(hk.SaveStateToSlot) ?? 'F1',
      load: keyboardBinding(hk.LoadStateFromSlot) ?? 'F3',
      next: keyboardBinding(hk.NextSaveStateSlot) ?? 'F2',
      prev: keyboardBinding(hk.PreviousSaveStateSlot) ?? 'Shift+F2',
      pause: keyboardBinding(hk.TogglePause) ?? 'Space'
    },
    sstates: path.isAbsolute(folder) ? folder : path.join(dataDir, folder),
    memcards,
    cards
  }
}

/** Включает PINE в PCSX2.ini (с резервной копией). PCSX2 при этом должен быть закрыт — он перезаписывает ini при выходе. */
export function enablePineInIni(dataDir: string) {
  const file = iniPath(dataDir)
  const text = fs.readFileSync(file, 'utf8')
  const backup = file + '.pcstation.bak'
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, text)
  let next: string
  if (/^EnablePINE\s*=.*$/m.test(text)) next = text.replace(/^EnablePINE\s*=.*$/m, 'EnablePINE = true')
  else if (/^\[EmuCore\]\s*$/m.test(text)) next = text.replace(/^\[EmuCore\]\s*$/m, (m) => `${m}\nEnablePINE = true`)
  else next = `${text.trimEnd()}\n\n[EmuCore]\nEnablePINE = true\n`
  fs.writeFileSync(file, next)
}

// ───────────────────────── Слоты сохранений ─────────────────────────

const SLOT_COUNT = 10

/** Достаёт один файл из zip (только нужный кусок, без чтения всего сохранения). */
function zipEntry(file: string, match: (name: string) => boolean): Buffer | null {
  let fd: number | undefined
  try {
    fd = fs.openSync(file, 'r')
    const size = fs.fstatSync(fd).size
    const read = (pos: number, len: number) => {
      const b = Buffer.alloc(len)
      fs.readSync(fd!, b, 0, len, pos)
      return b
    }
    const tailLen = Math.min(size, 65557)
    const tail = read(size - tailLen, tailLen)
    let eocd = -1
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i
        break
      }
    }
    if (eocd < 0) return null
    const cdSize = tail.readUInt32LE(eocd + 12)
    const cdOffset = tail.readUInt32LE(eocd + 16)
    if (cdOffset === 0xffffffff) return null
    const cd = read(cdOffset, cdSize)
    for (let p = 0; p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50; ) {
      const method = cd.readUInt16LE(p + 10)
      const compSize = cd.readUInt32LE(p + 20)
      const nameLen = cd.readUInt16LE(p + 28)
      const extraLen = cd.readUInt16LE(p + 30)
      const commentLen = cd.readUInt16LE(p + 32)
      const local = cd.readUInt32LE(p + 42)
      const name = cd.toString('utf8', p + 46, p + 46 + nameLen)
      if (match(name)) {
        const lh = read(local, 30)
        const start = local + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28)
        const data = read(start, compSize)
        if (method === 0) return data
        if (method === 8) return zlib.inflateRawSync(data)
        const zstd = (zlib as unknown as { zstdDecompressSync?: (b: Buffer) => Buffer }).zstdDecompressSync
        if (method === 93 && zstd) return zstd(data)
        return null
      }
      p += 46 + nameLen + extraLen + commentLen
    }
    return null
  } catch {
    return null
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

function thumbFor(file: string, mtime: number): string | undefined {
  const dir = path.join(app.getPath('userData'), 'cache', 'sstates')
  const out = path.join(dir, `${path.basename(file).replace(/[^\w.-]+/g, '_')}-${Math.round(mtime)}.png`)
  if (fs.existsSync(out)) return out
  const png = zipEntry(file, (n) => /screenshot\.png$/i.test(n)) ?? zipEntry(file, (n) => n.toLowerCase().endsWith('.png'))
  if (!png) return undefined
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(out, png)
  return out
}

/** Слоты 1–10 для игры с данным серийным номером. */
export function listSlots(sstates: string, serial: string | undefined): SaveSlot[] {
  const slots: SaveSlot[] = Array.from({ length: SLOT_COUNT }, (_, i) => ({ slot: i + 1 }))
  if (!serial) return slots
  let files: string[] = []
  try {
    files = fs.readdirSync(sstates)
  } catch {
    return slots
  }
  const prefix = `${serial} (`
  for (const f of files) {
    if (!f.startsWith(prefix)) continue
    const m = f.match(/\.(\d{2})\.p2s$/)
    if (!m) continue
    const slot = slots[Number(m[1]) - 1]
    if (!slot) continue
    const full = path.join(sstates, f)
    const mtime = fs.statSync(full).mtimeMs
    if (!slot.time || mtime > slot.time) {
      slot.time = mtime
      slot.thumb = thumbFor(full, mtime)
    }
  }
  return slots
}

/** Время последней записи слота (для ожидания, пока PCSX2 допишет сохранение) */
export function slotTime(sstates: string, serial: string | undefined, slot: number): number | undefined {
  if (!serial) return undefined
  try {
    const suffix = `.${String(slot).padStart(2, '0')}.p2s`
    const f = fs.readdirSync(sstates).find((n) => n.startsWith(`${serial} (`) && n.endsWith(suffix))
    return f ? fs.statSync(path.join(sstates, f)).mtimeMs : undefined
  } catch {
    return undefined
  }
}
