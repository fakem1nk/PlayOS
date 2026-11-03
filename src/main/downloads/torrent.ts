import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import type { DownloadJob } from '@shared/types'
import { t } from '@shared/i18n'
import { httpFetch } from '../http'
import { log } from '../log'
import { dataDir } from '../store'
import { freeSpace, Stop, type Progress } from './http'

/**
 * Торренты — свой клиент PlayOSTorrent.exe на libtorrent (native/torrent). Он запускается, когда очередь дошла
 * до торрента, и закрывается, когда торрентов в работе нет. Команды и события — строками через stdin/stdout.
 * Файлы докачки и состояние DHT — в %APPDATA%\PlayOS\torrents; после перезапуска торрент продолжается с того же места.
 */

export const torrentPath = () =>
  app.isPackaged ? path.join(process.resourcesPath, 'PlayOSTorrent.exe') : path.join(app.getAppPath(), 'resources', 'PlayOSTorrent.exe')
/** Клиент на месте — PlayOS качает торренты сам */
export const torrentReady = () => fs.existsSync(torrentPath())
const stateDir = () => path.join(dataDir(), 'torrents')

interface Status {
  state: 'metadata' | 'checking' | 'downloading' | 'finished'
  done: number
  total: number
  rate: number
  peers: number
  seeds: number
  paused: boolean
  name: string
}

interface Watch {
  status: (s: Status) => void
  finished: (path: string) => void
  error: (message: string) => void
}

/** Клиент закрывается не сразу, а через столько простоя: пауза и «Продолжить» не перезапускают его каждый раз */
const IDLE_QUIT_MS = 20_000

let child: ChildProcess | null = null
/** Прежний клиент ещё сохраняет докачку и выходит — новый запускаем только после него: файлы общие */
let closing: Promise<void> | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
const watching = new Map<string, Watch>()

function helper(): ChildProcess {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  if (child && child.exitCode === null && !child.killed) return child
  fs.mkdirSync(stateDir(), { recursive: true })
  const c = spawn(torrentPath(), ['--state', stateDir()], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  child = c
  readline.createInterface({ input: c.stdout! }).on('line', (line) => {
    let ev: { ev: string; id?: string; message?: string; path?: string } & Partial<Status>
    try {
      ev = JSON.parse(line)
    } catch {
      return
    }
    const w = ev.id ? watching.get(ev.id) : undefined
    if (ev.ev === 'status') w?.status(ev as unknown as Status)
    else if (ev.ev === 'finished') w?.finished(ev.path ?? '')
    else if (ev.ev === 'error') {
      log('WARN', '[торрент]', ev.id, ev.message)
      w?.error(ev.message ?? '')
    }
  })
  c.stderr?.on('data', (d: Buffer) => log('WARN', '[торрент]', d.toString().trim()))
  c.on('error', (e) => log('WARN', '[торрент] не запустился:', e.message))
  c.on('exit', (code) => {
    if (code) log('WARN', '[торрент] клиент завершился с кодом', code)
    // Закрылся тот, что сам отпустили по простою, — ждать его некому
    if (child !== c) return
    child = null
    // Упал рабочий клиент: загрузки остановились; очередь покажет ошибку, «Продолжить» запустит клиент заново
    for (const w of [...watching.values()]) w.error(t('Торрент-клиент PlayOS закрылся'))
    watching.clear()
  })
  return c
}

/** Команда клиенту: поля через табуляцию, поэтому табуляций и переводов строк в полях быть не должно */
function send(...fields: string[]) {
  helper().stdin?.write(fields.map((f) => f.replace(/[\t\r\n]/g, ' ')).join('\t') + '\n')
}

/** То же, но только если клиент уже запущен: ради паузы его не поднимаем */
function tell(...fields: string[]) {
  if (child && child.exitCode === null) send(...fields)
}

/** Торрентов в работе нет — через IDLE_QUIT_MS клиент сохраняет докачку и выходит (закрытый stdin) */
export function quitTorrents() {
  if (!child || watching.size || idleTimer) return
  idleTimer = setTimeout(() => {
    idleTimer = null
    const c = child
    if (!c || watching.size) return
    child = null
    closing = new Promise<void>((resolve) => c.once('exit', () => resolve())).finally(() => (closing = null))
    c.stdin?.end()
  }, IDLE_QUIT_MS)
}

/** Убрать торрент: из клиента (вместе с файлами, если deleteFiles) и его файлы докачки */
export function removeTorrent(job: DownloadJob, deleteFiles: boolean) {
  watching.delete(job.id)
  tell('remove', job.id, deleteFiles ? '1' : '0')
  for (const f of [`${job.id}.resume`, `${job.id}.torrent`]) fs.rmSync(path.join(stateDir(), f), { force: true })
}

/** .torrent по ссылке — сначала сам файл торрента */
async function torrentFile(job: DownloadJob, signal: AbortSignal): Promise<string> {
  const file = path.join(stateDir(), `${job.id}.torrent`)
  if (fs.existsSync(file)) return file
  const url = job.uris.find((u) => /^https?:\/\//i.test(u))
  if (!url) throw new Stop(t('У варианта нет ссылки на торрент'))
  const r = await httpFetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]) })
  if (!r.ok) throw new Stop(t('Сервер ответил {code}', { code: r.status }))
  const buf = Buffer.from(await r.arrayBuffer())
  // Торрент-файл — bencode-словарь: начинается с «d»
  if (buf[0] !== 0x64) throw new Stop(t('По ссылке не торрент-файл'))
  fs.mkdirSync(stateDir(), { recursive: true })
  fs.writeFileSync(file, buf)
  return file
}

/**
 * Скачать торрент варианта в папку загрузки. Пауза (signal) — клиент ставит торрент на паузу и сохраняет докачку.
 * Возвращает путь к скачанному (папка раздачи или файл)
 */
export async function torrentDownload(job: DownloadJob, signal: AbortSignal, progress: Progress, persist: () => void): Promise<string> {
  if (!torrentReady()) throw new Stop(t('Торрент-клиента PlayOS нет — переустановите PlayOS'))
  await fs.promises.mkdir(job.dir, { recursive: true }).catch((e) => {
    throw new Stop(t('Не получилось создать папку {dir}: {e}', { dir: job.dir, e: (e as Error).message }))
  })
  const source = job.uris.find((u) => /^magnet:/i.test(u)) ?? (await torrentFile(job, signal))
  if (closing) await closing
  if (signal.aborted) throw signal.reason
  return new Promise<string>((resolve, reject) => {
    let spaceChecked = false
    const end = (fn: () => void) => {
      watching.delete(job.id)
      signal.removeEventListener('abort', onAbort)
      job.phase = undefined
      fn()
    }
    const onAbort = () => {
      tell('pause', job.id)
      end(() => reject(signal.reason))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    watching.set(job.id, {
      status: (s) => {
        if (s.paused) return
        job.phase = s.state === 'metadata' ? 'metadata' : s.state === 'checking' ? 'checking' : undefined
        job.peers = s.peers
        let changed = false
        if (s.total && job.size !== s.total) {
          job.size = s.total
          changed = true
        }
        if (s.name && !job.file) {
          job.file = path.join(job.dir, s.name)
          changed = true
        }
        if (changed) persist()
        // Размер раздачи узнали — хватит ли места на всё, что осталось
        if (s.total && !spaceChecked) {
          spaceChecked = true
          void freeSpace(job.dir).then((free) => {
            const need = s.total - s.done
            if (free === null || need <= free || !watching.has(job.id)) return
            tell('pause', job.id)
            end(() => reject(new Stop(t('Не хватает места на диске: нужно ещё {need}, свободно {free}', { need: gbText(need), free: gbText(free) }))))
          })
        }
        progress(s.done, s.total)
      },
      finished: (p) => {
        if (p) job.file = p
        end(() => resolve(job.file ?? job.dir))
      },
      error: (message) => {
        tell('pause', job.id)
        end(() => reject(new Error(message || t('Торрент остановился'))))
      }
    })
    send('add', job.id, job.dir, source)
  })
}

const gbText = (n: number) => t('{v} ГБ', { v: (n / 2 ** 30).toFixed(1) })
