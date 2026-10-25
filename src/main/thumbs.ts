import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { app, nativeImage } from 'electron'

/**
 * Уменьшенные копии арта для интерфейса. Арт из SteamGridDB бывает огромным: фон 3840×1240 — это 7 МБ PNG
 * и ~19 МБ в памяти, а на экране 1080p он занимает вдвое меньше. Копии делает Windows (миниатюры проводника,
 * не в главном потоке), кладём их в %APPDATA%\PlayOS\thumbs и отдаём вместо оригинала.
 */

const dir = () => path.join(app.getPath('userData'), 'thumbs')
const pending = new Map<string, Promise<string>>()

/** Размер и прозрачность PNG/JPEG по заголовку — не распаковывая картинку */
function imageInfo(file: string): { width: number; height: number; alpha: boolean } | null {
  const fd = fs.openSync(file, 'r')
  try {
    const b = Buffer.alloc(256 * 1024)
    const n = fs.readSync(fd, b, 0, b.length, 0)
    if (b.readUInt32BE(0) === 0x89504e47) {
      const type = b[25]
      // Прозрачность: альфа-канал или палитра с таблицей прозрачности (tRNS)
      const alpha = type === 4 || type === 6 || b.subarray(0, n).includes('tRNS')
      return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), alpha }
    }
    if (b[0] === 0xff && b[1] === 0xd8) {
      // Ищем заголовок кадра SOFn среди маркеров JPEG
      let i = 2
      while (i + 9 < n) {
        if (b[i] !== 0xff) return null
        const marker = b[i + 1]
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5), alpha: false }
        }
        i += 2 + b.readUInt16BE(i + 2)
      }
    }
    return null
  } finally {
    fs.closeSync(fd)
  }
}

/** Готовые ответы за этот запуск: путь|ширина → файл */
const done = new Map<string, string>()

async function makeThumb(file: string, width: number): Promise<string> {
  const st = fs.statSync(file)
  const key = createHash('sha1').update(`${file}|${st.size}|${st.mtimeMs}|${width}`).digest('hex').slice(0, 20)
  // Копия уже есть с прошлого раза — заголовок картинки не читаем
  for (const ext of ['.jpg', '.png']) if (fs.existsSync(path.join(dir(), key + ext))) return path.join(dir(), key + ext)
  const info = imageInfo(file)
  // Картинка и так небольшая — уменьшать нечего
  if (!info || info.width <= width * 1.15) return file
  const out = path.join(dir(), key + (info.alpha ? '.png' : '.jpg'))
  const height = Math.round((width * info.height) / info.width)
  const img = await nativeImage.createThumbnailFromPath(file, { width, height })
  if (img.isEmpty()) return file
  fs.mkdirSync(dir(), { recursive: true })
  fs.writeFileSync(out + '.tmp', info.alpha ? img.toPNG() : img.toJPEG(88))
  fs.renameSync(out + '.tmp', out)
  return out
}

/** Путь к копии шириной до width; если сделать не вышло — оригинал */
export function thumbFile(file: string, width: number): Promise<string> {
  const id = `${file}|${width}`
  const ready = done.get(id)
  if (ready && fs.existsSync(ready)) return Promise.resolve(ready)
  let job = pending.get(id)
  if (!job) {
    job = makeThumb(file, width)
      .catch(() => file)
      .then((f) => (done.set(id, f), f))
      .finally(() => pending.delete(id))
    pending.set(id, job)
  }
  return job
}

/** Копии сменённого арта и удалённых игр копятся — удаляем всё старше месяца, нужное сделается заново */
export function pruneThumbs() {
  try {
    const month = Date.now() - 30 * 24 * 3600_000
    for (const f of fs.readdirSync(dir())) {
      const p = path.join(dir(), f)
      if (fs.statSync(p).mtimeMs < month) fs.rmSync(p, { force: true })
    }
  } catch {
    /* кэша ещё нет */
  }
}
