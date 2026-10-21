import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { Game, SteamLibraryGame } from '@shared/types'
import { httpFetch } from './http'
import { t } from '@shared/i18n'

/**
 * Установленные игры Steam: папки библиотек из libraryfolders.vdf, игры — из appmanifest_*.acf.
 * Запускаются через клиент Steam (steam://rungameid), отслеживаются по папке установки.
 */

type Vdf = { [key: string]: string | Vdf }

/** Разбор текстового VDF/ACF: "ключ" "значение" и "ключ" { … } */
export function parseVdf(text: string): Vdf {
  const tokens: (string | { brace: '{' | '}' })[] = []
  const re = /"((?:[^"\\]|\\.)*)"|([{}])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) tokens.push(m[2] ? { brace: m[2] as '{' | '}' } : m[1].replace(/\\(.)/g, '$1'))
  let i = 0
  const obj = (): Vdf => {
    const out: Vdf = {}
    while (i < tokens.length) {
      const key = tokens[i++]
      if (typeof key !== 'string') break // закрывающая скобка
      const next = tokens[i]
      if (typeof next === 'string') {
        out[key] = next
        i++
      } else if (next?.brace === '{') {
        i++
        out[key] = obj()
      }
    }
    return out
  }
  return obj()
}

function steamRoot(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true }, (err, out) => {
      const fromReg = !err ? /SteamPath\s+REG_SZ\s+(.+)/i.exec(out)?.[1]?.trim() : undefined
      const candidates = [fromReg && path.normalize(fromReg), 'C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam'].filter(Boolean) as string[]
      resolve(candidates.find((c) => fs.existsSync(path.join(c, 'steamapps'))) ?? null)
    })
  })
}

// Служебные пакеты Steam — это не игры
const TOOL_IDS = new Set([228980, 1007, 250820, 1070560, 1391110, 1628350, 1493710, 2180100, 2348590, 2805730, 3658110, 961940, 1245040, 1420170, 1580130, 1887720, 2230260])
const TOOL_NAME = /redist|steamworks|proton|steam linux runtime|steamvr|dedicated server|\bsdk\b|soundtrack/i

/** Тип приложения по данным магазина: 6 — программа. Без сети просто ничего не помечаем. */
async function markSoftware(list: SteamLibraryGame[]) {
  if (!list.length) return
  try {
    const input = { ids: list.map((g) => ({ appid: g.appId })), context: { language: 'english', country_code: 'US' }, data_request: {} }
    const res = (await httpFetch('https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=' + encodeURIComponent(JSON.stringify(input)), {
      signal: AbortSignal.timeout(8000)
    }).then((r) => r.json())) as { response?: { store_items?: { appid: number; type?: number }[] } }
    const types = new Map((res.response?.store_items ?? []).map((i) => [i.appid, i.type]))
    for (const g of list) if (types.get(g.appId) === 6) g.software = true
  } catch {
    /* оставим всё как игры */
  }
}

export async function scanSteam(games: Game[]): Promise<SteamLibraryGame[]> {
  const root = await steamRoot()
  if (!root) throw new Error(t('Steam не найден. Установите клиент Steam или добавьте игры вручную.'))
  const folders = new Set<string>([root])
  try {
    const lib = parseVdf(fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8'))
    const list = (lib.libraryfolders ?? lib.LibraryFolders) as Vdf | undefined
    for (const v of Object.values(list ?? {})) {
      const p = typeof v === 'string' ? v : v.path
      if (typeof p === 'string' && fs.existsSync(p)) folders.add(path.normalize(p))
    }
  } catch {
    /* только основная папка */
  }

  const owned = new Set(games.map((g) => g.steamAppId).filter(Boolean))
  const found = new Map<number, SteamLibraryGame>()
  for (const folder of folders) {
    const apps = path.join(folder, 'steamapps')
    let files: string[] = []
    try {
      files = fs.readdirSync(apps).filter((f) => /^appmanifest_\d+\.acf$/i.test(f))
    } catch {
      continue
    }
    for (const f of files) {
      try {
        const st = parseVdf(fs.readFileSync(path.join(apps, f), 'utf8')).AppState as Vdf
        const appId = Number(st.appid)
        const name = String(st.name ?? '')
        if (!appId || TOOL_IDS.has(appId) || TOOL_NAME.test(name)) continue
        const dir = path.join(apps, 'common', String(st.installdir ?? ''))
        // Игра ещё качается или папку удалили вручную
        if (!st.installdir || !fs.existsSync(dir)) continue
        const lastPlayed = Number(st.LastPlayed) * 1000 || undefined
        found.set(appId, { appId, name, dir, sizeOnDisk: Number(st.SizeOnDisk) || 0, lastPlayed, added: owned.has(appId) })
      } catch {
        /* битый манифест — пропускаем */
      }
    }
  }
  await markSoftware([...found.values()])
  // Сначала то, во что играли недавно
  return [...found.values()].sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || a.name.localeCompare(b.name))
}
