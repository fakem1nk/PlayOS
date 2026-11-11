import { dialog, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { t } from '@shared/i18n'
import type { Game, GameDraft } from '@shared/types'
import * as media from './media'
import { getDb } from './store'

/** Что нужно от главного модуля: окно для диалога, уведомление и сохранение игры с загрузкой арта */
export interface ScanDeps {
  win: BrowserWindow
  toast: (title: string, message: string, history?: false) => void
  saveGame: (draft: GameDraft) => Promise<Game>
}

const knownPaths = () => new Set(getDb().games.map((g) => g.path.toLowerCase()))

function walk(dir: string, exts: string[], depth = 3, out: string[] = []) {
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory() && depth > 0) walk(p, exts, depth - 1, out)
    else if (e.isFile() && exts.includes(path.extname(e.name).toLowerCase())) out.push(p)
  }
  return out
}

/** Папка с образами PS2: новые образы добавляются в библиотеку. Возвращает, сколько добавлено */
export async function scanPs2Folder({ win, toast, saveGame }: ScanDeps) {
  const res = await dialog.showOpenDialog(win, { title: t('Папка с играми PS2'), properties: ['openDirectory'] })
  if (res.canceled || !res.filePaths[0]) return 0
  const known = knownPaths()
  const files = walk(res.filePaths[0], media.PS2_EXTENSIONS).filter((f) => !known.has(f.toLowerCase()))
  toast(t('Сканирование'), t('Найдено новых образов: {length}', { length: files.length }), false)
  let added = 0
  // Небольшими пачками, чтобы не забивать сеть при загрузке обложек
  for (let i = 0; i < files.length; i += 4) {
    await Promise.all(
      files.slice(i, i + 4).map(async (file) => {
        const info = await media.inspectPs2(file, getDb().settings.pcsx2Path)
        await saveGame({ title: info.title ?? media.cleanTitle(file), platform: 'ps2', path: file, serial: info.serial, cover: info.cover })
        added++
      })
    )
  }
  return added
}

/** Игры из списка RPCS3 (games.yml) и установленные в dev_hdd0. Возвращает, сколько добавлено */
export async function importRpcs3({ saveGame }: Pick<ScanDeps, 'saveGame'>) {
  const { rpcs3Path } = getDb().settings
  if (!rpcs3Path || !fs.existsSync(rpcs3Path)) throw new Error(t('Сначала укажите путь к rpcs3.exe в настройках'))
  const root = path.dirname(rpcs3Path)
  const targets = new Set<string>()
  for (const yml of [path.join(root, 'config', 'games.yml'), path.join(root, 'games.yml')]) {
    if (!fs.existsSync(yml)) continue
    for (const m of fs.readFileSync(yml, 'utf8').matchAll(/^[A-Z]{4}\d{5}:\s*"?(.+?)"?\s*$/gm)) targets.add(m[1])
  }
  const hdd = path.join(root, 'dev_hdd0', 'game')
  if (fs.existsSync(hdd)) {
    for (const d of fs.readdirSync(hdd)) {
      const sfo = path.join(hdd, d, 'PARAM.SFO')
      if (fs.existsSync(sfo) && media.readSfo(sfo).CATEGORY === 'HG') targets.add(path.join(hdd, d))
    }
  }
  const known = knownPaths()
  let added = 0
  for (const t of targets) {
    if (!fs.existsSync(t)) continue
    const info = await media.inspectPs3(t)
    if (!info.path || !fs.existsSync(info.path) || known.has(info.path.toLowerCase())) continue
    await saveGame({ title: info.title ?? t, platform: 'ps3', path: info.path, serial: info.serial, cover: info.cover, hero: info.hero })
    added++
  }
  return added
}
