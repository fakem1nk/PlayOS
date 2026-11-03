import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { app, shell } from 'electron'
import type { Game, UninstallInfo, UninstallResult } from '@shared/types'
import { t } from '@shared/i18n'
import { gameFiles, gameLocation } from './files'
import { parseCommand, running, trackableDir } from './launcher'
import { log } from './log'
import { parseVdf } from './steam'
import { getDb } from './store'

/**
 * Удаление игры с компьютера. По порядку: Steam сам (его окно удаления), программа удаления игры
 * (из реестра Windows или unins000.exe в папке), иначе папка игры или образ — в корзину.
 */

/** Папки-хранилища: в них лежат разные игры, целиком такую папку не удаляем */
const SHARED_DIR =
  /^(games?|игры|steamlibrary|steamapps|common|steam|epic games|gog games|gog galaxy|origin games|ea games|ubisoft( game launcher)?|xboxgames|downloads?|torrents?|roms?|isos?|images|ps2|ps3|emulators?|pcsx2|rpcs3|dev_hdd0|program files( \(x86\))?|desktop|documents)$/i
/** Программа удаления в корне папки игры: Inno Setup (GOG и многие сборки), NSIS и прочие */
const LOCAL_UNINSTALLER = /^(unins\d{3}|uninstall|uninst|uninstaller)\.exe$/i
/** Сколько ждать, пока Steam или программа удаления уберёт игру */
const WATCH_MS = 30 * 60_000

const norm = (p: string) => path.resolve(p).toLowerCase().replace(/\\+$/, '')
const inside = (p: string, dir: string) => norm(p).startsWith(norm(dir) + '\\')
const same = (a: string, b: string) => !!a && !!b && norm(a) === norm(b)
const exists = (p: string) => {
  try {
    return fs.existsSync(p)
  } catch {
    return false
  }
}

interface Plan {
  info: UninstallInfo
  /** Что запустить: ссылка steam:// или командная строка программы удаления */
  command?: string
  /** Пропал этот файл — игра удалена (манифест Steam или EXE игры) */
  marker?: string
  /** Что отправить в корзину: папка игры или образ вместе с его дорожками */
  items?: string[]
}

// ───────────────────────── Steam ─────────────────────────

/** Игра из steamapps\common\<папка>: appid и манифест, который Steam удаляет вместе с игрой */
function steamApp(game: Game): { appId: number; manifest: string; dir: string } | null {
  for (const p of [game.installDir, game.path]) {
    const m = p && /^(.*\\steamapps)\\common\\([^\\]+)/i.exec(path.resolve(p))
    if (!m) continue
    let files: string[] = []
    try {
      files = fs.readdirSync(m[1]).filter((f) => /^appmanifest_\d+\.acf$/i.test(f))
    } catch {
      continue
    }
    for (const f of files) {
      try {
        const st = parseVdf(fs.readFileSync(path.join(m[1], f), 'utf8')).AppState as Record<string, unknown>
        if (String(st.installdir ?? '').toLowerCase() !== m[2].toLowerCase()) continue
        return { appId: Number(st.appid), manifest: path.join(m[1], f), dir: path.join(m[1], 'common', m[2]) }
      } catch {
        /* битый манифест */
      }
    }
  }
  return null
}

// ───────────────────────── Программа удаления ─────────────────────────

export interface RegEntry {
  /** Ключ реестра, DisplayName, InstallLocation, UninstallString, DisplayIcon */
  k?: string
  n?: string
  l?: string
  u?: string
  i?: string
}

/** Записи «Программы и компоненты» из реестра (машина, 32-битные, пользователь) */
export function registryEntries(): Promise<RegEntry[]> {
  const keys = ['HKLM:\\Software', 'HKLM:\\Software\\WOW6432Node', 'HKCU:\\Software'].map((k) => `'${k}\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'`).join(',')
  const script =
    "$ErrorActionPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.Encoding]::UTF8;" +
    `ConvertTo-Json -Compress -InputObject @(Get-ItemProperty ${keys} | Where-Object { $_.UninstallString } | ForEach-Object { [pscustomobject]@{ k = $_.PSPath; n = $_.DisplayName; l = $_.InstallLocation; u = $_.UninstallString; i = $_.DisplayIcon } })`
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15000, maxBuffer: 8 << 20 }, (err, out) => {
      try {
        const list = JSON.parse(out) as RegEntry | RegEntry[]
        resolve(Array.isArray(list) ? list : [list])
      } catch {
        if (err) log('WARN', 'uninstall registry read failed', err.message)
        resolve([])
      }
    })
  })
}

/** EXE из командной строки: в кавычках или до «.exe» (в реестре пути с пробелами бывают без кавычек) */
export const exeOf = (cmd: string) => /^\s*"([^"]+)"/.exec(cmd)?.[1] ?? /^\s*(.+?\.exe)(\s|$)/i.exec(cmd)?.[1] ?? parseCommand(cmd)[0] ?? ''
export const iconFile = (s?: string) => (s ?? '').replace(/"/g, '').replace(/,\s*-?\d+$/, '').trim()

/**
 * Программа удаления именно этой игры: папка установки из реестра совпадает с папкой игры, программа удаления
 * лежит в её корне или значок записи — EXE игры. Записи глубже (античит, редистрибутивы в папке игры) не берём.
 */
async function findUninstaller(dir: string, exe: string): Promise<string | null> {
  const entries = await registryEntries()
  const loc = (e: RegEntry) => (e.l ? e.l.replace(/"/g, '').trim() : '')
  const hit =
    entries.find((e) => same(loc(e), dir)) ??
    entries.find((e) => !!e.u && same(path.dirname(exeOf(e.u)), dir)) ??
    entries.find((e) => same(iconFile(e.i), exe))
  if (hit?.u) return hit.u
  try {
    const own = fs.readdirSync(dir).find((f) => LOCAL_UNINSTALLER.test(f))
    if (own) return `"${path.join(dir, own)}"`
  } catch {
    /* папка недоступна */
  }
  return null
}

/**
 * Запуск программы удаления через ShellExecute (.NET Process.Start): так Windows сама спросит права администратора.
 * Не Start-Process: он читает [ ] в пути как шаблон и не находит «C:\Games\[Сборка] Игра\unins000.exe»
 */
function runUninstaller(cmd: string): Promise<boolean> {
  const exe = exeOf(cmd)
  const quoted = /^\s*"/.test(cmd)
  let args = cmd.trim().slice(quoted ? exe.length + 2 : exe.length).trim()
  // MSI в реестре иногда записан как «/I{GUID}» — это открывает изменение установки, а не удаление
  if (/msiexec(\.exe)?$/i.test(exe)) args = args.replace(/\/I\s*\{/i, '/X{')
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`
  const ps =
    `$ErrorActionPreference='Stop';$si = New-Object System.Diagnostics.ProcessStartInfo; $si.FileName = ${q(exe)}; $si.Arguments = ${q(args)}; ` +
    '$si.UseShellExecute = $true; [void][System.Diagnostics.Process]::Start($si)'
  return new Promise((resolve) =>
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 120000 }, (err) => {
      if (err) log('WARN', 'uninstaller start failed', exe, err.message)
      resolve(!err)
    })
  )
}

// ───────────────────────── Файлы ─────────────────────────

/** Образ с дорожками (.cue, .gdi, .m3u): удаляются и файлы, на которые он ссылается */
function imageParts(file: string): string[] {
  if (!/\.(cue|gdi|m3u)$/i.test(file)) return [file]
  const dir = path.dirname(file)
  try {
    const text = fs.readFileSync(file, 'utf8')
    const refs = [...text.matchAll(/^\s*FILE\s+"([^"]+)"/gim), ...text.matchAll(/^\s*\d+\s+\d+\s+\d+\s+\d+\s+"?([^"\r\n]+?\.(?:bin|raw))"?/gim)].map((m) => m[1])
    if (/\.m3u$/i.test(file)) refs.push(...text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#')))
    const parts = refs.map((r) => path.resolve(dir, r)).filter((p) => path.dirname(p).toLowerCase() === dir.toLowerCase() && exists(p))
    return [file, ...new Set(parts)]
  } catch {
    return [file]
  }
}

/** Почему папку нельзя удалить целиком; null — можно */
function unsafeDir(game: Game, dir: string): string | null {
  const name = path.basename(dir)
  if (!trackableDir(dir) || SHARED_DIR.test(name) || path.dirname(dir) === dir)
    return t('Папка «{dir}» общая — в ней может быть не только эта игра. Удалите игру вручную.', { dir })
  const others = getDb().games.filter((g) => g.id !== game.id && g.path && (norm(g.path) === norm(dir) || inside(g.path, dir)))
  if (others.length) return t('В папке «{dir}» есть и другие игры библиотеки ({title}). Удалите игру вручную.', { dir, title: others[0].title })
  const s = getDb().settings
  const keep = [app.getPath('exe'), app.getPath('userData'), s.pcsx2Path, s.rpcs3Path].filter(Boolean)
  if (keep.some((p) => norm(p) === norm(dir) || inside(p, dir))) return t('В папке «{dir}» лежит эмулятор или сам PlayOS. Удалите игру вручную.', { dir })
  return null
}

async function plan(game: Game): Promise<Plan> {
  const base = (loc: { path: string; isFile: boolean }, method: UninstallInfo['method']): UninstallInfo => ({ method, path: loc.path, isFile: loc.isFile, size: null })
  const blocked = (p: string, reason: string): Plan => ({ info: { method: 'files', path: p, isFile: false, size: null, blocked: reason } })
  if (running()?.gameId === game.id) return blocked(game.path, t('Сначала закройте игру.'))

  if (game.platform === 'pc') {
    const steam = steamApp(game)
    if (steam && exists(steam.manifest)) return { info: base({ path: steam.dir, isFile: false }, 'steam'), command: `steam://uninstall/${steam.appId}`, marker: steam.manifest }
  }
  const loc = gameLocation(game)
  if (!loc) return blocked(game.path, t('Файлы игры не найдены на диске — возможно, её уже удалили.'))

  // Общая папка (D:\Games, Загрузки) — ни программу удаления в ней не ищем, ни саму папку не удаляем
  const unsafe = loc.isFile ? null : unsafeDir(game, loc.path)
  if (unsafe) return blocked(loc.path, unsafe)

  if (game.platform === 'pc' && !loc.isFile) {
    // Пропал EXE игры — программа удаления закончила (папка с сохранениями и настройками может остаться)
    let marker = game.path
    if (/\.lnk$/i.test(marker)) {
      try {
        marker = shell.readShortcutLink(marker).target || marker
      } catch {
        /* остаётся сам ярлык */
      }
    }
    const cmd = await findUninstaller(loc.path, marker)
    if (cmd && exists(marker) && fs.statSync(marker).isFile()) return { info: base(loc, 'uninstaller'), command: cmd, marker }
    // Без программы удаления — только если EXE игры действительно в этой папке
    if (!inside(marker, loc.path)) return blocked(loc.path, t('EXE игры лежит вне её папки — PlayOS не может понять, что удалять. Удалите игру вручную.'))
  }

  if (loc.isFile) {
    if (getDb().games.some((g) => g.id !== game.id && g.path && norm(g.path) === norm(loc.path)))
      return blocked(loc.path, t('Этот образ использует и другая игра библиотеки. Удалите его вручную.'))
    return { info: base(loc, 'files'), items: imageParts(loc.path) }
  }
  return { info: base(loc, 'files'), items: [loc.path] }
}

/** Как PlayOS удалит игру: способ, что удаляется и сколько места освободится */
export async function uninstallInfo(game: Game): Promise<UninstallInfo> {
  const { info } = await plan(game)
  if (!info.blocked) info.size = (await gameFiles(game).catch(() => null))?.size ?? null
  return info
}

const watchers = new Map<string, NodeJS.Timeout>()

/**
 * Удаляет игру. Файлы — сразу (в корзину, permanent — насовсем), и тогда onGone вызывается до ответа.
 * Steam и программа удаления работают сами: started — запущены, onGone — когда игра пропала с диска.
 */
export async function uninstallGame(game: Game, opts: { permanent?: boolean }, onGone: () => void): Promise<UninstallResult> {
  const p = await plan(game)
  if (p.info.blocked) return { ok: false, error: p.info.blocked }

  if (p.command) {
    if (p.info.method === 'steam') {
      try {
        await shell.openExternal(p.command)
      } catch (e) {
        return { ok: false, error: t('Не удалось открыть Steam: {v}', { v: (e as Error).message }) }
      }
    } else if (!(await runUninstaller(p.command))) {
      return { ok: false, error: t('Программа удаления не запустилась — возможно, отменили запрос прав администратора.') }
    }
    const marker = p.marker!
    clearInterval(watchers.get(game.id))
    const until = Date.now() + WATCH_MS
    watchers.set(
      game.id,
      setInterval(() => {
        const gone = !exists(marker)
        if (!gone && Date.now() < until) return
        clearInterval(watchers.get(game.id))
        watchers.delete(game.id)
        if (gone) onGone()
      }, 3000)
    )
    return { ok: true, started: p.info.method === 'steam' ? 'steam' : 'uninstaller' }
  }

  for (const item of p.items ?? []) {
    try {
      if (opts.permanent) await fs.promises.rm(item, { recursive: true, force: true, maxRetries: 2 })
      else await shell.trashItem(item)
    } catch (e) {
      log('WARN', 'uninstall delete failed', item, (e as Error).message)
      // Корзина не принимает: папка больше её размера или диск без корзины — можно удалить насовсем
      if (!opts.permanent && item === p.items![0]) return { ok: false, noTrash: true }
      return { ok: false, error: t('Не удалось удалить «{v}»: файлы заняты другой программой или нет прав.', { v: item }) }
    }
  }
  onGone()
  return { ok: true }
}
