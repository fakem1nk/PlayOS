import { app } from 'electron'
import os from 'node:os'
import path from 'node:path'

/**
 * Переносимые пути сохранений: начало пути заменяется меткой (%DOCUMENTS%/Rockstar Games/…),
 * поэтому снимок из облака ложится на своё место на другом ПК и под другим именем пользователя.
 * Файлы вне известных папок в облако не попадают — и из облака не пишутся (защита от «../» в чужом архиве).
 */

export interface PathContext {
  /** Папка установки игры (<base> в манифесте) */
  game?: string
  /** Папка данных PCSX2 и dev_hdd0 RPCS3 */
  pcsx2?: string
  rpcs3?: string
}

const env = (name: string, fallback: string) => process.env[name] || fallback

function roots(ctx: PathContext): [string, string][] {
  const home = os.homedir()
  const local = env('LOCALAPPDATA', path.join(home, 'AppData', 'Local'))
  const list: [string, string | undefined][] = [
    ['%GAME%', ctx.game],
    ['%PCSX2%', ctx.pcsx2],
    ['%RPCS3%', ctx.rpcs3],
    ['%LOCALLOW%', path.join(path.dirname(local), 'LocalLow')],
    ['%LOCALAPPDATA%', local],
    ['%APPDATA%', env('APPDATA', path.join(home, 'AppData', 'Roaming'))],
    ['%SAVEDGAMES%', path.join(home, 'Saved Games')],
    ['%DOCUMENTS%', app.getPath('documents')],
    ['%PUBLIC%', env('PUBLIC', 'C:\\Users\\Public')],
    ['%PROGRAMDATA%', env('PROGRAMDATA', 'C:\\ProgramData')],
    ['%HOME%', home]
  ]
  // Самая длинная (вложенная) папка — первой: %LOCALLOW% важнее %HOME%
  return (list.filter(([, p]) => p) as [string, string][]).sort((a, b) => b[1].length - a[1].length)
}

const norm = (p: string) => path.resolve(p).toLowerCase()

/** C:\Users\me\Documents\X\a.sav → %DOCUMENTS%/X/a.sav; null — путь вне известных папок */
export function toPortable(abs: string, ctx: PathContext): string | null {
  const full = norm(abs)
  for (const [token, dir] of roots(ctx)) {
    const base = norm(dir)
    if (full === base || full.startsWith(base + path.sep)) {
      const rest = path.resolve(abs).slice(path.resolve(dir).length).replace(/\\/g, '/')
      return token + rest
    }
  }
  return null
}

/** Обратно в абсолютный путь этого ПК; null — неизвестная метка или выход за пределы папки */
export function fromPortable(p: string, ctx: PathContext): string | null {
  const m = /^(%[A-Z0-9]+%)(\/.*)?$/.exec(p)
  if (!m) return null
  const dir = roots(ctx).find(([token]) => token === m[1])?.[1]
  if (!dir) return null
  const abs = path.resolve(dir, '.' + (m[2] ?? ''))
  return norm(abs) === norm(dir) || norm(abs).startsWith(norm(dir) + path.sep) ? abs : null
}

/** Метки манифеста Ludusavi → путь этого ПК (маски остаются). null — путь не для Windows или нет папки игры */
export function expandManifestPath(p: string, base: string | undefined, appId?: number): string | null {
  if (/<xdg|<home>\/Library|<home>\/\./i.test(p)) return null
  if (/<(base|root|game)>/.test(p) && !base) return null
  const home = os.homedir()
  const local = env('LOCALAPPDATA', path.join(home, 'AppData', 'Local'))
  const map: Record<string, string> = {
    base: base ?? '',
    root: base ? path.dirname(base) : '',
    game: base ? path.basename(base) : '',
    home,
    winAppData: env('APPDATA', path.join(home, 'AppData', 'Roaming')),
    winLocalAppData: local,
    winLocalAppDataLow: path.join(path.dirname(local), 'LocalLow'),
    winDocuments: app.getPath('documents'),
    winPublic: env('PUBLIC', 'C:\\Users\\Public'),
    winProgramData: env('PROGRAMDATA', 'C:\\ProgramData'),
    winDir: env('WINDIR', 'C:\\Windows'),
    osUserName: os.userInfo().username,
    storeUserId: '*',
    storeGameId: appId ? String(appId) : '*'
  }
  let unknown = false
  const out = p.replace(/<([a-zA-Z]+)>/g, (_m, k: string) => {
    if (!(k in map)) unknown = true
    return map[k] ?? ''
  })
  return unknown ? null : path.normalize(out)
}
