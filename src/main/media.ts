import { app, shell } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { ArtCandidate, InspectResult, Platform } from '@shared/types'
import { httpFetch } from './http'
import { trackableDir } from './launcher'
import { t } from '@shared/i18n'

// ───────────────────────── Общие утилиты ─────────────────────────

export const isRemote = (p?: string) => !!p && /^https?:\/\//i.test(p)

export function cleanTitle(file: string) {
  return path
    .basename(file, path.extname(file))
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .replace(/[_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function exists(url: string) {
  try {
    const r = await httpFetch(url, { method: 'HEAD', signal: AbortSignal.timeout(6000) })
    return r.ok && (r.headers.get('content-type') ?? '').startsWith('image/')
  } catch {
    return false
  }
}

export interface DownloadOptions {
  /** Отмена пользователем (○ в редакторе) */
  signal?: AbortSignal
  /** Сколько байт пришло и сколько всего (0 — сервер не сообщил размер) */
  onProgress?: (received: number, total: number) => void
}

export type DownloadResult = { file: string } | { error: 'cancelled' | 'stalled' | 'failed' }

const STALL_MS = 15000 // ни одного байта за это время — считаем, что загрузка зависла
const MAX_MS = 90000 // и в любом случае не дольше полутора минут на файл

/**
 * Скачивает картинку в папку арта игры потоком: видно прогресс, зависшая загрузка
 * обрывается сама, а пользователь может отменить её в любой момент.
 */
export async function downloadArt(url: string, dir: string, name: string, opts: DownloadOptions = {}): Promise<DownloadResult> {
  const ctrl = new AbortController()
  let reason: 'cancelled' | 'stalled' | null = null
  const cancel = () => {
    reason ??= 'cancelled'
    ctrl.abort()
  }
  if (opts.signal?.aborted) return { error: 'cancelled' }
  opts.signal?.addEventListener('abort', cancel)
  let stall: NodeJS.Timeout | undefined
  const kick = () => {
    clearTimeout(stall)
    stall = setTimeout(() => {
      reason ??= 'stalled'
      ctrl.abort()
    }, STALL_MS)
  }
  const cap = setTimeout(() => {
    reason ??= 'stalled'
    ctrl.abort()
  }, MAX_MS)
  try {
    kick()
    const r = await httpFetch(url, { signal: ctrl.signal })
    if (!r.ok || !r.body) return { error: 'failed' }
    const type = r.headers.get('content-type') ?? ''
    if (!type.startsWith('image/')) return { error: 'failed' }
    const total = Number(r.headers.get('content-length')) || 0
    const chunks: Uint8Array[] = []
    let received = 0
    let lastReport = 0
    const reader = r.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      received += value.length
      kick()
      const now = Date.now()
      if (now - lastReport > 100) {
        lastReport = now
        opts.onProgress?.(received, total)
      }
    }
    opts.onProgress?.(received, total || received)
    const ext = type.includes('png') ? '.png' : type.includes('webp') ? '.webp' : '.jpg'
    fs.mkdirSync(dir, { recursive: true })
    // Уникальное имя, чтобы кеш изображений в интерфейсе не показывал старую картинку
    const file = path.join(dir, `${name}-${Date.now().toString(36)}${ext}`)
    fs.writeFileSync(file, Buffer.concat(chunks))
    return { file }
  } catch {
    return { error: reason ?? 'failed' }
  } finally {
    clearTimeout(stall)
    clearTimeout(cap)
    opts.signal?.removeEventListener('abort', cancel)
  }
}

/** Копирует локальную картинку в папку арта (чтобы библиотека не зависела от исходного файла). */
export function copyArt(src: string, dir: string, name: string) {
  try {
    if (src.startsWith(dir)) return src
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `${name}-${Date.now().toString(36)}${path.extname(src) || '.png'}`)
    fs.copyFileSync(src, file)
    return file
  } catch {
    return src
  }
}

// ───────────────────────── Steam ─────────────────────────

const STEAM_ASSETS = 'https://shared.cloudflare.steamstatic.com/store_item_assets/'

interface SteamAssets {
  asset_url_format?: string
  library_capsule_2x?: string
  library_capsule?: string
  library_hero?: string
  library_hero_2x?: string
  library_logo?: string
  library_logo_2x?: string
  header?: string
}

/** Пути к библиотечному арту по AppID: GetItems отдаёт точные (с хешами) ссылки, включая новые игры */
async function steamAssetMap(ids: number[]) {
  try {
    const input = {
      ids: ids.map((appid) => ({ appid })),
      context: { language: 'english', country_code: 'US' },
      data_request: { include_assets: true }
    }
    const res = await httpFetch(
      'https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=' + encodeURIComponent(JSON.stringify(input)),
      { signal: AbortSignal.timeout(10000) }
    ).then((r) => r.json() as Promise<{ response?: { store_items?: { appid: number; assets?: SteamAssets }[] } }>)
    return new Map((res.response?.store_items ?? []).map((i) => [i.appid, i.assets ?? {}]))
  } catch {
    // обойдёмся классическими путями
    return new Map<number, SteamAssets>()
  }
}

function steamCandidate(id: number, title: string, a: SteamAssets | undefined): ArtCandidate {
  const classic = (file: string) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/${file}`
  const url = (file?: string) => (a?.asset_url_format && file ? STEAM_ASSETS + a.asset_url_format.replace('${FILENAME}', file) : undefined)
  return {
    key: `steam-${id}`,
    source: 'steam' as const,
    title,
    cover: url(a?.library_capsule_2x ?? a?.library_capsule) ?? classic('library_600x900_2x.jpg'),
    hero: url(a?.library_hero_2x ?? a?.library_hero) ?? classic('library_hero.jpg'),
    logo: url(a?.library_logo_2x ?? a?.library_logo) ?? classic('logo.png'),
    thumb: url(a?.header) ?? classic('header.jpg')
  }
}

/** Арт сразу для нескольких игр Steam (импорт библиотеки) */
export async function steamArtFor(apps: { appId: number; name: string }[]) {
  const assets = await steamAssetMap(apps.map((a) => a.appId))
  return new Map(apps.map((a) => [a.appId, steamCandidate(a.appId, a.name, assets.get(a.appId))]))
}

export async function searchSteam(query: string): Promise<ArtCandidate[]> {
  const q = query.trim()
  if (!q) return []
  const search = await httpFetch(
    `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(q)}&l=english&cc=US`,
    { signal: AbortSignal.timeout(10000) }
  ).then((r) => r.json() as Promise<{ items?: { type: string; id: number; name: string; tiny_image?: string }[] }>)

  const items = (search.items ?? []).filter((i) => i.type === 'app').slice(0, 10)
  if (!items.length) return []
  const assets = await steamAssetMap(items.map((i) => i.id))
  return items.map((item) => steamCandidate(item.id, item.name, assets.get(item.id)))
}

export async function verifyCandidate(c: ArtCandidate): Promise<ArtCandidate> {
  const [cover, hero, logo] = await Promise.all([
    c.cover && isRemote(c.cover) ? exists(c.cover) : Promise.resolve(true),
    c.hero && isRemote(c.hero) ? exists(c.hero) : Promise.resolve(true),
    c.logo && isRemote(c.logo) ? exists(c.logo) : Promise.resolve(true)
  ])
  return {
    ...c,
    cover: cover ? c.cover : c.thumb,
    hero: hero ? c.hero : undefined,
    logo: logo ? c.logo : undefined
  }
}

// ───────────────────────── PlayStation 2 ─────────────────────────

const PS2_COVER = (serial: string) =>
  `https://raw.githubusercontent.com/xlenore/ps2-covers/main/covers/default/${serial}.jpg`

/** Читает серийный номер (SLUS-21269) из SYSTEM.CNF внутри ISO9660 образа (.iso и raw .bin). */
export function readPs2Serial(file: string): string | undefined {
  const ext = path.extname(file).toLowerCase()
  if (!['.iso', '.bin', '.img'].includes(ext)) return undefined
  let fd: number | undefined
  try {
    fd = fs.openSync(file, 'r')
    const read = (pos: number, len: number) => {
      const b = Buffer.alloc(len)
      fs.readSync(fd!, b, 0, len, pos)
      return b
    }
    // Ищем формат сектора: обычный 2048 или «сырые» 2352 (mode1 / mode2 form1)
    const layouts = [
      { size: 2048, offset: 0 },
      { size: 2352, offset: 24 },
      { size: 2352, offset: 16 }
    ]
    const layout = layouts.find((l) => read(16 * l.size + l.offset + 1, 5).toString('ascii') === 'CD001')
    if (!layout) return undefined
    const sector = (lba: number, count = 1) => {
      const out = Buffer.alloc(count * 2048)
      for (let i = 0; i < count; i++) read((lba + i) * layout.size + layout.offset, 2048).copy(out, i * 2048)
      return out
    }
    const pvd = sector(16)
    const rootLba = pvd.readUInt32LE(156 + 2)
    const rootLen = pvd.readUInt32LE(156 + 10)
    const root = sector(rootLba, Math.min(16, Math.ceil(rootLen / 2048)))
    let pos = 0
    while (pos < root.length) {
      const len = root[pos]
      if (len === 0) {
        pos = (Math.floor(pos / 2048) + 1) * 2048
        continue
      }
      const nameLen = root[pos + 32]
      const name = root.toString('ascii', pos + 33, pos + 33 + nameLen)
      if (name.toUpperCase().startsWith('SYSTEM.CNF')) {
        const lba = root.readUInt32LE(pos + 2)
        const size = Math.min(root.readUInt32LE(pos + 10), 4096)
        const text = sector(lba, Math.ceil(size / 2048)).toString('ascii', 0, size)
        const m = text.match(/BOOT2?\s*=\s*cdrom0?:\\?([A-Z]{4})[_-](\d{3})\.?(\d{2})/i)
        return m ? `${m[1].toUpperCase()}-${m[2]}${m[3]}` : undefined
      }
      pos += len
    }
  } catch {
    /* не ISO или битый образ */
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
  return undefined
}

let gameIndex: { file: string; text: string } | undefined

/** Название игры по серийнику из GameIndex.yaml, который поставляется с PCSX2. */
export function lookupPs2Title(serial: string, pcsx2Path: string): string | undefined {
  const file = path.join(path.dirname(pcsx2Path), 'resources', 'GameIndex.yaml')
  try {
    if (gameIndex?.file !== file) gameIndex = { file, text: fs.readFileSync(file, 'utf8') }
    const i = gameIndex.text.indexOf(`\n${serial}:`)
    if (i < 0) return undefined
    const block = gameIndex.text.slice(i + 1, i + 600).split(/\n(?=\S)/)[0]
    const en = block.match(/^\s+name-en:\s*"?(.+?)"?\s*$/m)
    const name = block.match(/^\s+name:\s*"?(.+?)"?\s*$/m)
    return (en ?? name)?.[1]
  } catch {
    return undefined
  }
}

export async function inspectPs2(file: string, pcsx2Path: string): Promise<InspectResult> {
  const serial = readPs2Serial(file)
  const title = (serial && lookupPs2Title(serial, pcsx2Path)) || cleanTitle(file)
  const cover = serial && (await exists(PS2_COVER(serial))) ? PS2_COVER(serial) : undefined
  return { title, serial, cover }
}

export const PS2_EXTENSIONS = ['.iso', '.chd', '.cso', '.zso', '.gz', '.bin', '.img', '.mdf', '.nrg', '.elf', '.m3u']

// ───────────────────────── PlayStation 3 ─────────────────────────

/** Разбор PARAM.SFO: TITLE, TITLE_ID, CATEGORY. */
export function readSfo(file: string): Record<string, string> {
  const b = fs.readFileSync(file)
  if (b.toString('latin1', 1, 4) !== 'PSF') return {}
  const keyTable = b.readUInt32LE(8)
  const dataTable = b.readUInt32LE(12)
  const count = b.readUInt32LE(16)
  const out: Record<string, string> = {}
  for (let i = 0; i < count; i++) {
    const e = 20 + i * 16
    const keyOff = b.readUInt16LE(e)
    const fmt = b.readUInt16LE(e + 2)
    const len = b.readUInt32LE(e + 4)
    const dataOff = b.readUInt32LE(e + 12)
    const keyEnd = b.indexOf(0, keyTable + keyOff)
    const key = b.toString('utf8', keyTable + keyOff, keyEnd)
    if (fmt === 0x0204 || fmt === 0x0004) {
      out[key] = b
        .toString('utf8', dataTable + dataOff, dataTable + dataOff + len)
        .replace(/\0+$/, '')
        .replace(/\s+/g, ' ')
        .trim()
    }
  }
  return out
}

/** Находит EBOOT.BIN и PARAM.SFO для выбранного файла или папки игры. */
export function resolvePs3(target: string) {
  let eboot: string | undefined
  const stat = fs.statSync(target)
  if (stat.isDirectory()) {
    for (const rel of ['PS3_GAME/USRDIR/EBOOT.BIN', 'USRDIR/EBOOT.BIN', 'EBOOT.BIN']) {
      const p = path.join(target, rel)
      if (fs.existsSync(p)) {
        eboot = p
        break
      }
    }
  } else {
    eboot = target
  }
  let sfoDir: string | undefined
  if (eboot) {
    let dir = path.dirname(eboot)
    for (let i = 0; i < 3; i++) {
      if (fs.existsSync(path.join(dir, 'PARAM.SFO'))) {
        sfoDir = dir
        break
      }
      const nested = path.join(dir, 'PS3_GAME')
      if (fs.existsSync(path.join(nested, 'PARAM.SFO'))) {
        sfoDir = nested
        break
      }
      dir = path.dirname(dir)
    }
  }
  return { eboot, sfoDir }
}

export async function inspectPs3(target: string): Promise<InspectResult> {
  const { eboot, sfoDir } = resolvePs3(target)
  const res: InspectResult = { path: eboot ?? target }
  if (sfoDir) {
    const sfo = readSfo(path.join(sfoDir, 'PARAM.SFO'))
    res.title = sfo.TITLE
    res.serial = sfo.TITLE_ID
    const icon = path.join(sfoDir, 'ICON0.PNG')
    const pic = path.join(sfoDir, 'PIC1.PNG')
    if (fs.existsSync(icon)) res.cover = icon
    if (fs.existsSync(pic)) res.hero = pic
  }
  res.title ??= cleanTitle(target)
  return res
}

// ───────────────────────── PC ─────────────────────────

export const GENERIC_DIRS = /^(bin|bin32|bin64|x64|x86|win64|win32|binaries|game|retail|release|shipping|_retail_)$/i

function productName(exe: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `(Get-Item -LiteralPath '${exe.replace(/'/g, "''")}').VersionInfo.ProductName`],
      { timeout: 5000, windowsHide: true },
      (err, stdout) => resolve(err ? undefined : stdout.trim() || undefined)
    )
  })
}

export async function inspectPc(file: string, artTmpDir: string): Promise<InspectResult> {
  const res: InspectResult = { path: file }
  let exe = file
  // Ярлык .lnk → разворачиваем в настоящий EXE с аргументами
  if (path.extname(file).toLowerCase() === '.lnk') {
    try {
      const link = shell.readShortcutLink(file)
      exe = link.target
      res.path = link.target
      res.args = link.args || undefined
      res.workDir = link.cwd || undefined
    } catch {
      /* оставим как есть */
    }
  }
  let dir = path.dirname(exe)
  while (GENERIC_DIRS.test(path.basename(dir)) && path.dirname(dir) !== dir) dir = path.dirname(dir)
  const fromDir = path.basename(dir)
  if (trackableDir(dir)) res.installDir = dir
  const product = path.extname(exe).toLowerCase() === '.exe' ? await productName(exe) : undefined
  const generic = !product || /unreal|unity|launcher|microsoft|bootstrap|^ue\d/i.test(product)
  res.title = generic ? fromDir || cleanTitle(exe) : product

  try {
    const icon = await app.getFileIcon(exe, { size: 'large' })
    if (!icon.isEmpty()) {
      fs.mkdirSync(artTmpDir, { recursive: true })
      const p = path.join(artTmpDir, `icon-${Date.now().toString(36)}.png`)
      fs.writeFileSync(p, icon.toPNG())
      res.icon = p
    }
  } catch {
    /* без иконки */
  }
  return res
}

export async function inspect(platform: Platform, file: string, pcsx2Path: string, artTmpDir: string) {
  if (platform === 'ps2') return inspectPs2(file, pcsx2Path)
  if (platform === 'ps3') return inspectPs3(file)
  return inspectPc(file, artTmpDir)
}

/** Обложка диска по серийному номеру: PS2 — база xlenore, PS3 — GameTDB. */
export async function discCandidate(platform: Platform, serial?: string): Promise<ArtCandidate | undefined> {
  if (!serial) return undefined
  if (platform === 'ps2') {
    const url = PS2_COVER(serial)
    return (await exists(url)) ? { key: `disc-${serial}`, source: 'disc', title: t('Обложка диска {serial}', { serial }), cover: url } : undefined
  }
  if (platform === 'ps3') {
    const id = serial.replace(/[^A-Z0-9]/gi, '').toUpperCase()
    // Регион по префиксу: BLUS/BCUS/NPUB — США, BLES/BCES/NPEB — Европа, BLJM/BCJS/NPJB — Япония
    const region = /^(B[LC]US|NPU)/.test(id) ? ['US', 'EN'] : /^(B[LC]ES|NPE)/.test(id) ? ['EN', 'US'] : /^(B[LC]J|NPJ)/.test(id) ? ['JA', 'US'] : ['US', 'EN', 'JA']
    for (const r of region) {
      for (const kind of ['coverHQ', 'cover']) {
        const url = `https://art.gametdb.com/ps3/${kind}/${r}/${id}.jpg`
        if (await exists(url)) return { key: `disc-${id}`, source: 'disc', title: t('Обложка диска {id}', { id }), cover: url }
      }
    }
  }
  return undefined
}

// ───────────────────────── Альтернативные источники арта ─────────────────────────

/**
 * SteamGridDB — самая большая база арта, в том числе для игр без Steam-версии (PS2/PS3, эмуляторы).
 * Нужен бесплатный ключ API: steamgriddb.com → Preferences → API.
 */
export async function searchSteamGridDB(query: string, key: string): Promise<ArtCandidate[]> {
  if (!key.trim()) throw new Error(t('Добавьте ключ SteamGridDB в настройках (раздел «Обложки»)'))
  const api = async (p: string) => {
    const r = await httpFetch(`https://www.steamgriddb.com/api/v2${p}`, {
      headers: { Authorization: `Bearer ${key.trim()}` },
      signal: AbortSignal.timeout(10000)
    })
    if (r.status === 401) throw new Error(t('SteamGridDB не принял ключ API. Проверьте его в настройках.'))
    const j = (await r.json()) as { success: boolean; data?: unknown }
    return j.success ? j.data : null
  }
  type Img = { url: string; thumb: string }
  const games = ((await api(`/search/autocomplete/${encodeURIComponent(query.trim())}`)) as { id: number; name: string }[] | null) ?? []
  return Promise.all(
    games.slice(0, 8).map(async (g): Promise<ArtCandidate> => {
      const [grids, animated, heroes, logos] = await Promise.all([
        api(`/grids/game/${g.id}?dimensions=600x900,342x482,660x930&types=static`).catch(() => null),
        // Анимированные вертикальные обложки (WebP/APNG); видео-форматы не берём
        api(`/grids/game/${g.id}?dimensions=600x900,342x482,660x930&types=animated`).catch(() => null),
        api(`/heroes/game/${g.id}?types=static`).catch(() => null),
        api(`/logos/game/${g.id}?types=static`).catch(() => null)
      ])
      const first = (v: unknown) => (Array.isArray(v) ? (v[0] as Img | undefined) : undefined)
      const anim = Array.isArray(animated) ? (animated as (Img & { mime?: string })[]).find((a) => a.mime !== 'video/webm') : undefined
      return {
        key: `sgdb-${g.id}`,
        source: 'steamgriddb',
        title: g.name,
        cover: first(grids)?.url,
        coverAnimated: anim?.url,
        // Превью анимации у SteamGridDB — лёгкое видео, само изображение весит мегабайты
        coverAnimatedPreview: anim?.thumb,
        hero: first(heroes)?.url,
        logo: first(logos)?.url,
        thumb: first(grids)?.thumb ?? first(heroes)?.thumb
      }
    })
  ).then((list) => list.filter((c) => c.cover || c.hero || c.coverAnimated))
}

const WIKI_UA = { 'User-Agent': 'PlayOS/0.7 (local game launcher)' }

/** Википедия: картинка из карточки статьи об игре — обычно это обложка. Без ключей. */
export async function searchWikipedia(query: string): Promise<ArtCandidate[]> {
  const host = /[а-яё]/i.test(query) ? 'ru.wikipedia.org' : 'en.wikipedia.org'
  const call = (params: Record<string, string>) =>
    httpFetch(`https://${host}/w/api.php?format=json&formatversion=2&` + new URLSearchParams(params), {
      headers: WIKI_UA,
      signal: AbortSignal.timeout(10000)
    }).then((r) => r.json() as Promise<{ query?: Record<string, unknown> }>)

  const found = await call({
    action: 'query',
    generator: 'search',
    gsrsearch: `${query} ${host.startsWith('ru') ? 'игра' : 'video game'}`,
    gsrlimit: '10',
    prop: 'pageprops',
    ppprop: 'page_image'
  })
  type Page = { title: string; index: number; pageprops?: { page_image?: string } }
  const pages = ((found.query?.pages as Page[]) ?? []).filter((p) => p.pageprops?.page_image).sort((a, b) => a.index - b.index)
  if (!pages.length) return []

  const files = pages.map((p) => `File:${p.pageprops!.page_image}`)
  const info = await call({ action: 'query', titles: files.join('|'), prop: 'imageinfo', iiprop: 'url', iiurlwidth: '600' })
  // API нормализует имена файлов (подчёркивания → пробелы) — строим соответствие
  const norm = new Map(((info.query?.normalized as { from: string; to: string }[]) ?? []).map((n) => [n.from, n.to]))
  type FilePage = { title: string; imageinfo?: { url: string; thumburl?: string }[] }
  const urls = new Map(((info.query?.pages as FilePage[]) ?? []).map((p) => [p.title, p.imageinfo?.[0]?.thumburl ?? p.imageinfo?.[0]?.url]))
  return pages
    .map((p, i): ArtCandidate => {
      const file = files[i]
      return { key: `wiki-${p.title}`, source: 'wiki', title: p.title, cover: urls.get(norm.get(file) ?? file) }
    })
    .filter((c) => c.cover && !/\.svg/i.test(c.cover))
}
