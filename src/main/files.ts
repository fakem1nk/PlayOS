import { shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { Game, GameFiles } from '@shared/types'
import { trackableDir } from './launcher'

/** Больше файлов не считаем: папка явно не игровая, а подсчёт затянется */
const MAX_FILES = 300_000
const CACHE_MS = 10 * 60_000
const cache = new Map<string, { at: number; src: string; files: GameFiles }>()

/** Папка установки игры: PC — рядом с EXE, PS3 — корень игры над PS3_GAME/USRDIR, образы — сам файл */
function gameLocation(game: Game): { path: string; isFile: boolean } | null {
  const p = game.path
  if (!p || !fs.existsSync(p)) return null
  const stat = fs.statSync(p)
  if (stat.isDirectory()) return { path: p, isFile: false }
  if (game.platform === 'pc') {
    let target = p
    if (/\.lnk$/i.test(p)) {
      try {
        target = shell.readShortcutLink(p).target || p
      } catch {
        // Ярлык не читается — остаётся папка самого ярлыка
      }
    } else if (/\.url$/i.test(p)) return null
    return { path: game.workDir || path.dirname(target), isFile: false }
  }
  if (game.platform === 'ps3' && /eboot\.bin$/i.test(p)) {
    // …/<игра>/PS3_GAME/USRDIR/EBOOT.BIN или dev_hdd0/game/<ID>/USRDIR/EBOOT.BIN
    let dir = path.dirname(p)
    for (let i = 0; i < 3; i++) {
      if (path.basename(dir).toUpperCase() === 'PS3_GAME') return { path: path.dirname(dir), isFile: false }
      if (fs.existsSync(path.join(dir, 'PARAM.SFO'))) return { path: dir, isFile: false }
      dir = path.dirname(dir)
    }
    return { path: path.dirname(path.dirname(p)), isFile: false }
  }
  return { path: p, isFile: true }
}

async function folderSize(dir: string): Promise<number | null> {
  let total = 0
  let count = 0
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(cur, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (++count > MAX_FILES) return null
      const full = path.join(cur, e.name)
      if (e.isDirectory()) stack.push(full)
      else if (e.isFile()) {
        try {
          total += (await fs.promises.stat(full)).size
        } catch {
          // Файл заняли или удалили во время подсчёта
        }
      }
    }
  }
  return total
}

export async function gameFiles(game: Game): Promise<GameFiles | null> {
  const hit = cache.get(game.id)
  if (hit && hit.src === game.path && Date.now() - hit.at < CACHE_MS) return hit.files
  const loc = gameLocation(game)
  if (!loc) return null
  const size = loc.isFile ? fs.statSync(loc.path).size : trackableDir(loc.path) ? await folderSize(loc.path) : null
  const files = { ...loc, size }
  cache.set(game.id, { at: Date.now(), src: game.path, files })
  return files
}
