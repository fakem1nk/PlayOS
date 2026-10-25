import fs from 'node:fs'
import path from 'node:path'
import type { Game } from '@shared/types'
import { httpFetch } from '../http'
import { log } from '../log'
import { dataDir } from '../store'
import { parseYaml } from './yaml'

/**
 * Манифест Ludusavi (github.com/mtkennerly/ludusavi-manifest, MIT; данные из PCGamingWiki):
 * где каждая PC-игра хранит сохранения. Файл большой (~18 МБ YAML), поэтому раз в неделю скачиваем его
 * (с ETag — без изменений не качаем) и храним только нужное: сохранения под Windows и реестр.
 */

const URL = 'https://raw.githubusercontent.com/mtkennerly/ludusavi-manifest/master/data/manifest.yaml'
const REFRESH_MS = 7 * 86_400_000

export interface ManifestGame {
  name: string
  steam?: number[]
  installDirs: string[]
  /** Пути с метками <base>, <winAppData>… и масками */
  files: string[]
  /** HKEY_CURRENT_USER/… */
  registry: string[]
}

interface Index {
  etag?: string
  checkedAt: number
  games: ManifestGame[]
}

type Raw = Record<string, unknown>

const file = () => path.join(dataDir(), 'cache', 'ludusavi.json')
let index: Index | null = null
let lookup: { bySteam: Map<number, ManifestGame>; byDir: Map<string, ManifestGame>; byName: Map<string, ManifestGame> } | null = null
let updating: Promise<void> | null = null

/** Название для сравнения: без ™®, регистра, знаков и «Edition» в конце */
export const normTitle = (s: string) =>
  s
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/\b(game of the year|goty|definitive|complete|deluxe|remastered|enhanced|ultimate|gold)( edition)?\b/g, '')
    .replace(/\bedition\b/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')

const forWindows = (v: unknown) => {
  const when = (v as Raw | null)?.when as Raw[] | undefined
  return !when || when.some((w) => !w.os || w.os === 'windows')
}
const isSave = (v: unknown) => (((v as Raw | null)?.tags as string[] | undefined) ?? []).includes('save')

function build(yaml: string): ManifestGame[] {
  const raw = parseYaml(yaml) as Record<string, Raw>
  const out: ManifestGame[] = []
  for (const [name, g] of Object.entries(raw)) {
    if (!g || typeof g !== 'object') continue
    const files = Object.entries((g.files as Raw) ?? {})
      .filter(([, v]) => isSave(v) && forWindows(v))
      .map(([p]) => p)
    const registry = Object.entries((g.registry as Raw) ?? {})
      .filter(([, v]) => isSave(v))
      .map(([p]) => p)
    if (!files.length && !registry.length) continue
    const steamId = (g.steam as Raw | undefined)?.id as number | undefined
    const extra = ((g.id as Raw | undefined)?.steamExtra as number[] | undefined) ?? []
    out.push({
      name,
      steam: steamId || extra.length ? [...(steamId ? [steamId] : []), ...extra] : undefined,
      installDirs: Object.keys((g.installDir as Raw) ?? {}),
      files,
      registry
    })
  }
  return out
}

function load(): Index | null {
  if (index) return index
  try {
    index = JSON.parse(fs.readFileSync(file(), 'utf8')) as Index
  } catch {
    index = null
  }
  return index
}

function makeLookup() {
  const idx = load()
  if (!idx) return null
  if (lookup) return lookup
  lookup = { bySteam: new Map(), byDir: new Map(), byName: new Map() }
  for (const g of idx.games) {
    for (const id of g.steam ?? []) if (!lookup.bySteam.has(id)) lookup.bySteam.set(id, g)
    for (const d of g.installDirs) lookup.byDir.set(d.toLowerCase(), g)
    lookup.byName.set(normTitle(g.name), g)
  }
  return lookup
}

/** Скачивает манифест, если копия старше недели (или её нет) */
export function updateManifest(force = false): Promise<void> {
  const idx = load()
  if (!force && idx && Date.now() - idx.checkedAt < REFRESH_MS) return Promise.resolve()
  updating ??= (async () => {
    try {
      const res = await httpFetch(URL, { headers: idx?.etag ? { 'If-None-Match': idx.etag } : {} })
      if (res.status === 304 && idx) {
        idx.checkedAt = Date.now()
      } else if (res.ok) {
        const games = build(await res.text())
        index = { etag: res.headers.get('etag') ?? undefined, checkedAt: Date.now(), games }
        lookup = null
        log('INFO', `Манифест Ludusavi: ${games.length} игр с сохранениями`)
      } else throw new Error(`HTTP ${res.status}`)
      fs.mkdirSync(path.dirname(file()), { recursive: true })
      fs.writeFileSync(file(), JSON.stringify(index))
    } catch (e) {
      log('WARN', 'Манифест Ludusavi не обновился:', (e as Error).message)
    } finally {
      updating = null
    }
  })()
  return updating
}

/**
 * Запись манифеста для игры: по Steam AppID, папке установки, затем по названию.
 * base — папка установки для метки <base>: та, чьё имя совпало с installDir манифеста (EXE часто лежит в bin/ или Binaries/Win64)
 */
export function manifestFor(game: Game, installDir?: string): { entry: ManifestGame; base?: string } | undefined {
  const l = makeLookup()
  if (!l) return undefined
  const baseFor = (entry: ManifestGame) => {
    if (!installDir) return undefined
    const names = new Set(entry.installDirs.map((d) => d.toLowerCase()))
    for (let dir = installDir, i = 0; i < 4; i++) {
      if (names.has(path.basename(dir).toLowerCase())) return dir
      const up = path.dirname(dir)
      if (up === dir) break
      dir = up
    }
    return installDir
  }
  let entry = game.steamAppId ? l.bySteam.get(game.steamAppId) : undefined
  if (!entry && installDir) {
    for (let dir = installDir, i = 0; i < 4 && !entry; i++) {
      entry = l.byDir.get(path.basename(dir).toLowerCase())
      const up = path.dirname(dir)
      if (up === dir) break
      dir = up
    }
  }
  entry ??= l.byName.get(normTitle(game.title))
  return entry && { entry, base: baseFor(entry) }
}
