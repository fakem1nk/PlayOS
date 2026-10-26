import fs from 'node:fs'
import path from 'node:path'
import type { Game, SavePreview, Settings } from '@shared/types'
import { trackableDir } from '../launcher'
import { pcsx2Config } from '../pcsx2'
import { manifestFor, normTitle } from './ludusavi'
import { expandManifestPath, type PathContext } from './paths'
import { collect } from './snapshot'

/**
 * Что синхронизировать для игры. Единица синхронизации — «набор сохранений» (SaveSet) со своим ключом:
 * у игры обычно один набор, но обычная (не папочная) карта памяти PS2 общая для всех игр — это отдельный набор.
 */
export interface SaveSet {
  /** Одинаковый на всех ПК: ps2:SLUS-20312, ps3:BLUS30001, pc:1174180, ps2card:Mcd001.ps2 */
  key: string
  title: string
  /** Абсолютные пути этого ПК, можно с масками * ** ? (папка — вместе со всем содержимым) */
  patterns: string[]
  /** Ключи реестра HKEY_CURRENT_USER/… */
  registry: string[]
  ctx: PathContext
}

/**
 * Куда сохраняют взломанные и «эмулированные» Steam-версии: по AppID игры.
 * Список легко дополнять — путь берётся, только если папка существует.
 */
const EMU_ROOTS = [
  '%APPDATA%/Goldberg SteamEmu Saves/{id}',
  '%APPDATA%/GSE Saves/{id}',
  '%APPDATA%/Steam/CODEX/{id}',
  '%PUBLIC%/Documents/Steam/CODEX/{id}',
  '%PUBLIC%/Documents/Steam/RUNE/{id}',
  '%PUBLIC%/Documents/EMPRESS/{id}',
  '%PUBLIC%/Documents/OnlineFix/{id}',
  '%LOCALAPPDATA%/SKIDROW/{id}',
  '%PROGRAMDATA%/RLD!/{id}',
  '%PROGRAMDATA%/Steam/RLD!/{id}',
  '%APPDATA%/SmartSteamEmu/{id}',
  '{game}/steam_settings/saves'
]

const envDir = (token: string) =>
  ({
    '%APPDATA%': process.env.APPDATA,
    '%LOCALAPPDATA%': process.env.LOCALAPPDATA,
    '%PUBLIC%': process.env.PUBLIC,
    '%PROGRAMDATA%': process.env.PROGRAMDATA
  })[token]

const isDir = (p: string) => {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** Папка с EXE игры (у игр Steam path — уже папка); ярлыки .url и .lnk не в счёт */
function exeDir(game: Game): string | undefined {
  if (!game.path || /\.(url|lnk)$/i.test(game.path)) return undefined
  if (isDir(game.path)) return game.path
  return fs.existsSync(game.path) ? path.dirname(game.path) : undefined
}

/** Папка установки PC-игры. Указанную папку игры перенесли или удалили — берём папку EXE */
export function pcInstallDir(game: Game): string | undefined {
  if (game.installDir && isDir(game.installDir)) return game.installDir
  if (game.workDir && isDir(game.workDir)) return game.workDir
  return exeDir(game)
}

/**
 * Где искать файлы эмулятора Steam и steam_appid.txt: папка игры и папка EXE. Они часто разные
 * (EXE в bin/x64, а steam_settings рядом с ним), поэтому проверяем обе.
 */
export function pcGameDirs(game: Game): string[] {
  return [...new Set([pcInstallDir(game), exeDir(game)].filter((d): d is string => !!d && trackableDir(d)))]
}

/** AppID из файлов игры: сначала рядом с EXE, потом в папке игры и выше */
export function pcAppId(game: Game): number | undefined {
  for (const d of pcGameDirs(game).reverse()) {
    const id = detectAppId(d)
    if (id) return id
  }
  return undefined
}

/** AppID пиратской или DRM-free сборки: steam_appid.txt, steam_emu.ini, steam_settings — рядом с EXE и уровнем выше */
export function detectAppId(dir: string): number | undefined {
  const candidates = ['steam_appid.txt', 'steam_settings/steam_appid.txt', 'steam_emu.ini', 'cream_api.ini', 'ColdClientLoader.ini']
  for (let d = dir, i = 0; i < 3; i++) {
    for (const c of candidates) {
      try {
        const text = fs.readFileSync(path.join(d, c), 'utf8')
        const m = /^\s*(\d{2,9})\s*$/m.exec(text) ?? /^\s*app_?id\s*=\s*(\d{2,9})/im.exec(text)
        if (m) return Number(m[1])
      } catch {
        // Файла нет — смотрим дальше
      }
    }
    const up = path.dirname(d)
    if (up === d) break
    d = up
  }
  return undefined
}

/** Корень dev_hdd0 RPCS3: из config/vfs.yml, иначе рядом с rpcs3.exe */
function rpcs3Hdd(settings: Settings): string | undefined {
  if (!settings.rpcs3Path) return undefined
  const root = path.dirname(settings.rpcs3Path)
  for (const f of [path.join(root, 'config', 'vfs.yml'), path.join(root, 'vfs.yml')]) {
    try {
      const m = /^\/dev_hdd0\/:\s*"?(.+?)"?\s*$/m.exec(fs.readFileSync(f, 'utf8'))
      if (m) return path.normalize(m[1].replace('$(EmulatorDir)', root + path.sep))
    } catch {
      // Нет файла — значение по умолчанию
    }
  }
  return path.join(root, 'dev_hdd0')
}

const safe = (s: string) => s.replace(/[[\]{}()]/g, '?')

/** Наборы сохранений игры. Пусто — сохранения не найдены (или игра из Steam: у неё своё облако) */
export function saveSetsFor(game: Game, settings: Settings): SaveSet[] {
  if (game.launcher === 'steam' || game.cloudSaves === false) return []

  if (game.platform === 'ps2') {
    const cfg = settings.pcsx2Path ? pcsx2Config(settings.pcsx2Path) : null
    if (!cfg || !game.serial) return []
    const ctx = { pcsx2: cfg.dataDir }
    const own: SaveSet = { key: `ps2:${game.serial}`, title: game.title, patterns: [], registry: [], ctx }
    const sets = [own]
    if (settings.cloud?.ps2States) own.patterns.push(path.join(cfg.sstates, `${safe(game.serial)} (*).p2s`))
    for (const card of cfg.cards) {
      let isDir = false
      try {
        isDir = fs.statSync(card).isDirectory()
      } catch {
        continue
      }
      // Папочная карта: у каждого сохранения своя папка с серийным номером в имени (BASLUS-20312…)
      if (isDir) own.patterns.push(path.join(card, `*${safe(game.serial)}*`))
      else sets.push({ key: `ps2card:${path.basename(card)}`, title: path.basename(card), patterns: [card], registry: [], ctx })
    }
    if (game.saveDirs?.length) own.patterns = [...game.saveDirs]
    return sets.filter((s) => s.patterns.length)
  }

  if (game.platform === 'ps3') {
    const hdd = rpcs3Hdd(settings)
    if (!hdd || !game.serial) return []
    const patterns = game.saveDirs?.length ? [...game.saveDirs] : [path.join(hdd, 'home', '00000001', 'savedata', `${game.serial}*`)]
    return [{ key: `ps3:${game.serial}`, title: game.title, patterns, registry: [], ctx: { rpcs3: hdd } }]
  }

  // PC: свои папки → манифест Ludusavi → папки эмуляторов Steam по AppID
  const dir = pcInstallDir(game)
  const appId = game.steamAppId ?? pcAppId(game)
  const found = manifestFor(game, dir)
  const base = found?.base ?? dir
  const ctx: PathContext = { game: base && trackableDir(base) ? base : undefined }
  const key = appId ? `pc:${appId}` : found ? `pc:m:${normTitle(found.entry.name)}` : `pc:t:${normTitle(game.title)}`
  const set: SaveSet = { key, title: game.title, patterns: [], registry: [], ctx }
  if (game.saveDirs?.length) {
    set.patterns = [...game.saveDirs]
    return [set]
  }
  if (found) {
    for (const f of found.entry.files) {
      const p = expandManifestPath(f, ctx.game, appId)
      if (p) set.patterns.push(p)
    }
    set.registry = found.entry.registry.filter((r) => /^HKEY_CURRENT_USER\//i.test(r))
  }
  if (appId) {
    for (const tpl of EMU_ROOTS) {
      const paths = tpl.startsWith('{game}')
        ? [...new Set([ctx.game, ...pcGameDirs(game)])].filter((d): d is string => !!d).map((d) => path.join(d, tpl.slice(7)))
        : (() => {
            const token = tpl.slice(0, tpl.indexOf('%', 1) + 1)
            const root = envDir(token)
            return root ? [path.join(root, tpl.slice(token.length).replace('{id}', String(appId)))] : []
          })()
      for (const p of paths) if (fs.existsSync(p) && !set.patterns.includes(p)) set.patterns.push(p)
    }
  }
  return set.patterns.length || set.registry.length ? [set] : []
}

/**
 * Слишком общие папки: если сохранения лежат и в «Документах», и в AppData, их общая папка — профиль
 * пользователя, и показывать её как «папку сохранений» бессмысленно
 */
function tooBroad(dir: string) {
  const home = process.env.USERPROFILE ?? ''
  const roots = [home, path.dirname(home), path.join(home, 'AppData'), process.env.APPDATA, process.env.LOCALAPPDATA, process.env.PUBLIC, process.env.PROGRAMDATA]
  const d = dir.toLowerCase().replace(/[\\/]+$/, '')
  return /^[a-z]:$/.test(d) || roots.some((r) => r && r.toLowerCase() === d) || /[\\/]documents$/.test(d)
}

/** Общая папка нескольких путей */
function commonDir(dirs: string[]): string | undefined {
  if (!dirs.length) return undefined
  let parts = dirs[0].split(path.sep)
  for (const d of dirs.slice(1)) {
    const other = d.split(path.sep)
    let i = 0
    while (i < parts.length && i < other.length && parts[i].toLowerCase() === other[i].toLowerCase()) i++
    parts = parts.slice(0, i)
  }
  const common = parts.length > 1 ? parts.join(path.sep) : undefined
  return common && !tooBroad(common) ? common : undefined
}

/** Что найдено для игры прямо сейчас: папка сохранений и AppID — для подсказок в редакторе */
export function savePreview(game: Game, settings: Settings): SavePreview {
  const appId = game.platform === 'pc' && !game.steamAppId ? pcAppId(game) : undefined
  if (game.launcher === 'steam') return { files: 0, registry: false, appId, skipped: 'steam' }
  if (game.cloudSaves === false) return { files: 0, registry: false, appId, skipped: 'off' }
  const all = saveSetsFor(game, settings)
  // Файловая карта памяти PS2 общая для всех игр — показываем её, только если своих файлов у игры нет
  const own = all.filter((s) => !s.key.startsWith('ps2card:')).flatMap((s) => collect(s))
  const files = own.length ? own : all.flatMap((s) => collect(s))
  const dirs = files.map((f) => path.dirname(f.abs))
  // Папки на разных дисках (сохранения в «Документах», папка эмулятора Steam на C:) общей не имеют,
  // а у папок в разных частях профиля она слишком общая — тогда показываем ту, где больше всего файлов
  const busiest = [...new Set(dirs)].sort((a, b) => dirs.filter((d) => d === b).length - dirs.filter((d) => d === a).length)[0]
  return {
    dir: commonDir([...new Set(dirs)]) ?? busiest,
    files: files.length,
    registry: all.some((s) => s.registry.length > 0),
    appId
  }
}
