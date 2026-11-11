import { app, screen, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { t } from '@shared/i18n'
import type { ControllerInfo, SystemInfo } from '@shared/types'
import { dataDir, getDb } from './store'

/** Сколько занимает папка данных: арт, видео живого фона и всё вместе */
function dataUsage() {
  let art = 0
  let video = 0
  let total = 0
  const walk = (dir: string, inArt: boolean) => {
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p, inArt || (dir === dataDir() && e.name === 'art'))
      else {
        let size = 0
        try {
          size = fs.statSync(p).size
        } catch {
          continue
        }
        total += size
        if (inArt && /\.(mp4|webm)$/i.test(e.name)) video += size
        else if (inArt) art += size
      }
    }
  }
  walk(dataDir(), false)
  return { art, video, total }
}

/** Диски C:–Z: с объёмом и свободным местом. Сетевой или уснувший диск, который не ответил за 1,5 с, пропускаем */
async function disks(): Promise<SystemInfo['disks']> {
  const letters = Array.from({ length: 24 }, (_, i) => `${String.fromCharCode(67 + i)}:`)
  const found = await Promise.all(
    letters.map((name) =>
      Promise.race([
        fs.promises
          .statfs(`${name}\\`)
          .then((s) => ({ name, total: s.blocks * s.bsize, free: s.bavail * s.bsize }))
          .catch(() => null),
        new Promise<null>((r) => setTimeout(() => r(null), 1500))
      ])
    )
  )
  return found.filter((d): d is SystemInfo['disks'][number] => !!d && d.total > 0)
}

/** Сведения для окна «О системе». win — окно PlayOS (на каком оно экране), pads — подключённые геймпады */
export async function systemInfo(win: BrowserWindow | null, pads: ControllerInfo[]): Promise<SystemInfo> {
  let gpu = t('Не удалось определить')
  try {
    const info = (await app.getGPUInfo('complete')) as { auxAttributes?: { glRenderer?: string } }
    // «ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)» → «NVIDIA GeForce RTX 3070»
    const raw = info.auxAttributes?.glRenderer ?? ''
    const m = /ANGLE \([^,]+,\s*(.+?)(?:\s+Direct3D|\s*\(0x|,)/.exec(raw)
    gpu = (m?.[1] ?? raw) || gpu
  } catch {
    /* оставим «не удалось» */
  }
  const cpus = os.cpus()
  const primary = screen.getPrimaryDisplay().id
  const here = win ? screen.getDisplayMatching(win.getBounds()).id : primary
  const db = getDb()
  const usage = dataUsage()
  const name = os.version().replace(/^Microsoft\s+/, '')
  return {
    app: {
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      installDir: path.dirname(process.execPath),
      dataDir: dataDir(),
      packaged: app.isPackaged
    },
    os: { name, build: os.release(), uptimeMin: Math.floor(os.uptime() / 60) },
    cpu: { model: cpus[0]?.model.trim() ?? '—', threads: cpus.length },
    gpu,
    memory: { total: os.totalmem(), free: os.freemem() },
    disks: await disks(),
    displays: screen.getAllDisplays().map((d, i) => ({
      name: d.label || t('Экран {v}', { v: i + 1 }),
      width: Math.round(d.size.width * d.scaleFactor),
      height: Math.round(d.size.height * d.scaleFactor),
      hz: Math.round(d.displayFrequency),
      primary: d.id === primary,
      current: d.id === here
    })),
    pads: pads.map((c) => ({ name: c.name, kind: c.kind, via: c.via, percent: c.percent, battery: c.battery })),
    library: {
      games: db.games.length,
      hours: Math.round(db.games.reduce((a, g) => a + g.playtime, 0) / 360) / 10,
      artBytes: usage.art,
      videoBytes: usage.video,
      totalBytes: usage.total
    }
  }
}
