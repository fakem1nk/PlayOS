import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { VrApiKind } from '@shared/types'

/** По каким DLL узнаём VR-API игры (Unity кладёт их в <Game>_Data\Plugins, Unreal — в Engine\Binaries\ThirdParty) */
const MARKERS: Record<string, VrApiKind> = {
  'openvr_api.dll': 'openvr',
  'openxr_loader.dll': 'openxr',
  'libovrrt64_1.dll': 'oculus',
  'ovrplugin.dll': 'oculus'
}

// Служебные папки движков — корень игры выше них (UE: Game\Binaries\Win64\Game-Win64-Shipping.exe)
const SERVICE_DIRS = /^(bin|bin64|binaries|win64|win32|x64|x86|release|shipping)$/i

// Папки, где VR-библиотек точно нет, а файлов много
const SKIP = /^(content|paks|movies|sounds?|audio|videos?|streamingassets|localization|shadercache|logs|saved|\..+)$/i

const MAX_DEPTH = 7
const MAX_DIRS = 4000

/** Корень игры: папка над служебными. У Unreal VR-плагины лежат в соседней Engine — тогда корень на уровень выше */
function gameRoot(exe: string) {
  let dir = path.dirname(exe)
  while (SERVICE_DIRS.test(path.basename(dir)) && path.dirname(dir) !== dir) dir = path.dirname(dir)
  const up = path.dirname(dir)
  return up !== dir && existsSync(path.join(up, 'Engine', 'Binaries')) ? up : dir
}

/** Обход папки игры в ширину с ограничениями по глубине и числу папок. installDir — папка игры из редактора, если указана */
export async function detectApis(exe: string, installDir?: string): Promise<VrApiKind[]> {
  const found = new Set<VrApiKind>()
  let queue = [installDir || gameRoot(exe)]
  let seen = 0
  for (let depth = 0; depth <= MAX_DEPTH && queue.length && seen < MAX_DIRS; depth++) {
    const next: string[] = []
    for (const dir of queue) {
      if (++seen > MAX_DIRS) break
      let entries
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const e of entries) {
        if (e.isDirectory()) {
          if (!SKIP.test(e.name)) next.push(path.join(dir, e.name))
        } else {
          const api = MARKERS[e.name.toLowerCase()]
          if (api) found.add(api)
        }
      }
    }
    queue = next
  }
  return (['openvr', 'openxr', 'oculus'] as const).filter((a) => found.has(a))
}
