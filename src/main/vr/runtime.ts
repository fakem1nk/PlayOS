import fs from 'node:fs'
import path from 'node:path'
import type { VrResult } from '@shared/types'

/** Кто сейчас обслуживает OpenVR-игры (первый путь в openvrpaths.vrpath) */
type VrActiveRuntime = 'playos' | 'steamvr' | 'other' | 'none'
import { t } from '@shared/i18n'
import { dataDir } from '../store'

/**
 * Реестр путей OpenVR. Игра (openvr_api.dll) берёт первый путь из runtime[] и грузит оттуда bin\vrclient_x64.dll.
 * Поставить свою папку первой = подменить SteamVR для всех OpenVR-игр, ничего не трогая в самих играх.
 */
export const VRPATH = path.join(process.env.LOCALAPPDATA ?? '', 'openvr', 'openvrpaths.vrpath')

interface VrPaths {
  config?: string[]
  external_drivers?: string[] | null
  jsonid?: string
  log?: string[]
  runtime?: string[]
  version?: number
}

/** Наша папка рантайма: в bin\ лежат DLL OpenComposite под именами клиента OpenVR */
export const runtimeDir = () => path.join(dataDir(), 'vr', 'runtime')
const backupFile = () => path.join(dataDir(), 'vr', 'openvrpaths.vrpath.bak')

const norm = (p: string) => path.resolve(p).replace(/\\+$/, '').toLowerCase()
export const samePath = (a: string, b: string) => norm(a) === norm(b)
export const hasClient = (dir: string) => fs.existsSync(path.join(dir, 'bin', 'vrclient_x64.dll'))
const isSteamVr = (dir: string) => /steamvr/i.test(path.basename(dir)) || fs.existsSync(path.join(dir, 'bin', 'win64', 'vrserver.exe'))

function readPaths(): VrPaths | null {
  try {
    return JSON.parse(fs.readFileSync(VRPATH, 'utf8'))
  } catch {
    return null
  }
}

function writePaths(p: VrPaths) {
  // Оригинал сохраняем один раз, до первого нашего изменения
  const bak = backupFile()
  if (!fs.existsSync(bak) && fs.existsSync(VRPATH)) {
    fs.mkdirSync(path.dirname(bak), { recursive: true })
    fs.copyFileSync(VRPATH, bak)
  }
  fs.mkdirSync(path.dirname(VRPATH), { recursive: true })
  // Файл могли пометить «только чтение», чтобы SteamVR его не переписывал
  try {
    fs.chmodSync(VRPATH, 0o666)
  } catch {}
  const tmp = `${VRPATH}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(p, null, '\t') + '\n')
  fs.renameSync(tmp, VRPATH)
}

/** Пути SteamVR и прочих рантаймов: из vrpath, а если там только наш — из бэкапа оригинала */
function otherPaths(p: VrPaths | null): string[] {
  const mine = runtimeDir()
  const fromFile = (p?.runtime ?? []).filter((d) => !samePath(d, mine))
  if (fromFile.length) return fromFile
  try {
    const bak: VrPaths = JSON.parse(fs.readFileSync(backupFile(), 'utf8'))
    return (bak.runtime ?? []).filter((d) => !samePath(d, mine))
  } catch {
    return []
  }
}

export function runtimeStatus(): { active: VrActiveRuntime; activePath?: string; steamvrPath?: string } {
  const p = readPaths()
  const first = p?.runtime?.[0]
  const steamvrPath = otherPaths(p).find((d) => hasClient(d) && isSteamVr(d))
  if (!first) return { active: 'none', steamvrPath }
  const active: VrActiveRuntime = samePath(first, runtimeDir()) ? 'playos' : isSteamVr(first) ? 'steamvr' : 'other'
  return { active, activePath: first, steamvrPath }
}

export function switchRuntime(target: 'playos' | 'steamvr'): VrResult {
  try {
    const mine = runtimeDir()
    const p: VrPaths = readPaths() ?? { jsonid: 'vrpathreg', version: 1 }
    const others = otherPaths(p)
    if (target === 'playos') {
      if (!hasClient(mine)) return { ok: false, error: t('Сначала скачайте OpenComposite') }
      // Остальные пути оставляем следом: SteamVR остаётся зарегистрированным, вернуть его можно в один шаг
      p.runtime = [mine, ...others]
    } else {
      // Без SteamVR в списке вернуть некуда
      const steam = others.filter(isSteamVr)
      if (!steam.length) return { ok: false, error: t('SteamVR не найден в реестре OpenVR') }
      p.runtime = [...steam, ...others.filter((d) => !isSteamVr(d))]
    }
    writePaths(p)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** В vrpath наш путь заменяется другим (переезд рантайма из отдельного PlayOS VR) — активный рантайм не меняется */
export function replaceRuntimePath(from: string, to: string) {
  const p = readPaths()
  if (!p?.runtime?.some((d) => samePath(d, from))) return
  p.runtime = p.runtime.map((d) => (samePath(d, from) ? to : d))
  writePaths(p)
}
