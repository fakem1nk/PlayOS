import fs from 'node:fs'
import path from 'node:path'
import type { CloudAccount, CloudProviderId } from '@shared/types'
import { httpFetch } from '../http'

/**
 * Облако как простое файловое хранилище: список папки, чтение, запись, удаление.
 * Пути — относительные, через «/»: devices/abc.json, saves/ps2_SLUS-20312/….zip
 */
export interface Remote {
  id: CloudProviderId
  list(dir: string): Promise<RemoteEntry[]>
  read(file: string): Promise<Buffer>
  write(file: string, data: Buffer): Promise<void>
  remove(file: string): Promise<void>
  account(): Promise<CloudAccount>
}

export interface RemoteEntry {
  name: string
  size: number
  modified: number
}

/** Нет сети или облако недоступно — синхронизация подождёт, это не ошибка пользователя */
export class OfflineError extends Error {}
/** В облаке закончилось место: загрузки ждут, пока пользователь его не освободит */
export class QuotaError extends Error {}
/** Вход отозван или устарел: без нового входа синхронизация не пойдёт */
export class AuthError extends Error {}

/** Токен облака; force — обновить, даже если срок ещё не вышел (облако ответило 401) */
export type TokenSource = (force?: boolean) => Promise<string>

const API_MS = 30_000
/** Загрузка файла: минута плюс время на медленном канале (~50 КБ/с); целое — AbortSignal.timeout дробь не принимает */
const uploadMs = (bytes: number) => 60_000 + Math.ceil(bytes / 50)

/** Запрос с таймаутом: без него один подвисший запрос навсегда останавливал бы очередь синхронизации */
async function request(url: string, init: RequestInit, ms: number, who: string) {
  try {
    return await httpFetch(url, { ...init, signal: AbortSignal.timeout(ms) })
  } catch (e) {
    throw new OfflineError(`${who}: ${(e as Error).message}`)
  }
}

/** Тело ответа: оборвалось или истёк таймаут — тоже «нет связи» */
async function readBody<T>(res: Response, who: string): Promise<T> {
  try {
    return (await res.json()) as T
  } catch (e) {
    throw new OfflineError(`${who}: ${(e as Error).message}`)
  }
}

/** Скачивание файла: таймаут не на весь файл, а на паузу в передаче — медленный канал не обрывает большое сохранение */
async function download(url: string, headers: Record<string, string>, who: string): Promise<{ res: Response; data?: Buffer }> {
  const ctl = new AbortController()
  let timer = setTimeout(() => ctl.abort(), API_MS)
  try {
    const res = await httpFetch(url, { headers, signal: ctl.signal })
    if (!res.ok || !res.body) return { res }
    const chunks: Buffer[] = []
    const reader = res.body.getReader()
    for (;;) {
      clearTimeout(timer)
      timer = setTimeout(() => ctl.abort(), API_MS)
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(Buffer.from(value))
    }
    return { res, data: Buffer.concat(chunks) }
  } catch (e) {
    throw new OfflineError(`${who}: ${(e as Error).message}`)
  } finally {
    clearTimeout(timer)
  }
}

// ── Папка синхронизации: OneDrive, Google Drive для ПК, Dropbox, Syncthing, сетевой диск ──

export function folderRemote(root: string): Remote {
  const abs = (p: string) => path.join(root, 'PlayOS', ...p.split('/'))
  const ensureRoot = () => {
    if (!fs.existsSync(root)) throw new OfflineError(`Папка недоступна: ${root}`)
  }
  // Файла нет — настоящая ошибка; остальное временно: файл «только в облаке» у OneDrive без сети, файл занят клиентом облака
  const fsError = (e: unknown) => {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ENOSPC' || code === 'EDQUOT') return new QuotaError(`Нет места: ${root}`)
    return code === 'ENOENT' ? (e as Error) : new OfflineError((e as Error).message)
  }
  return {
    id: 'folder',
    async list(dir) {
      ensureRoot()
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(abs(dir), { withFileTypes: true })
      } catch (e) {
        // Папки ещё нет — пусто; не прочиталась — ждём, а не считаем, что в облаке ничего нет
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw fsError(e)
      }
      const out: RemoteEntry[] = []
      for (const e of entries) {
        if (!e.isFile() || e.name.endsWith('.tmp')) continue
        try {
          const st = fs.statSync(path.join(abs(dir), e.name))
          out.push({ name: e.name, size: st.size, modified: st.mtimeMs })
        } catch {
          // Файл исчез между чтением папки и stat
        }
      }
      return out
    },
    async read(file) {
      ensureRoot()
      try {
        return await fs.promises.readFile(abs(file))
      } catch (e) {
        throw fsError(e)
      }
    },
    async write(file, data) {
      ensureRoot()
      const target = abs(file)
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true })
        // Временное имя и переименование: клиент облака не заберёт файл наполовину
        await fs.promises.writeFile(target + '.tmp', data)
        fs.renameSync(target + '.tmp', target)
      } catch (e) {
        fs.rmSync(target + '.tmp', { force: true })
        throw fsError(e)
      }
    },
    async remove(file) {
      fs.rmSync(abs(file), { force: true })
    },
    async account() {
      let free: number | undefined
      let total: number | undefined
      try {
        const st = fs.statfsSync(root)
        free = st.bavail * st.bsize
        total = st.blocks * st.bsize
      } catch {
        // Сетевой диск может не отдать размер
      }
      return { provider: 'folder', name: root, total, used: total != null && free != null ? total - free : undefined }
    }
  }
}

// ── Яндекс.Диск: REST API, папка приложения app:/ («Приложения/PlayOS») ──

const YA = 'https://cloud-api.yandex.net/v1/disk'

export function yandexRemote(token: TokenSource): Remote {
  const who = 'Яндекс.Диск'
  const call = async (url: string, init: RequestInit = {}) => {
    for (let retry = false; ; retry = true) {
      const res = await request(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `OAuth ${await token(retry)}` } }, API_MS, who)
      // 401 — токен отозвали или он истёк раньше срока: один раз обновляем и повторяем
      if (res.status === 401 && !retry) continue
      if (res.status === 401) throw new AuthError(`${who}: вход устарел`)
      if (res.status === 507) throw new QuotaError(`${who}: нет места`)
      if (res.status >= 500 || res.status === 429) throw new OfflineError(`${who}: HTTP ${res.status}`)
      return res
    }
  }
  const q = (p: string) => encodeURIComponent(`app:/${p}`)
  const made = new Set<string>()
  const mkdirs = async (dir: string) => {
    const parts = dir.split('/').filter(Boolean)
    for (let i = 1; i <= parts.length; i++) {
      const d = parts.slice(0, i).join('/')
      if (made.has(d)) continue
      const res = await call(`${YA}/resources?path=${q(d)}`, { method: 'PUT' })
      // 409 — папка уже есть
      if (!res.ok && res.status !== 409) throw new Error(`${who}: не создать папку ${d} (HTTP ${res.status})`)
      made.add(d)
    }
  }
  const uploadUrl = (file: string) => call(`${YA}/resources/upload?path=${q(file)}&overwrite=true`)
  return {
    id: 'yandex',
    async list(dir) {
      const out: RemoteEntry[] = []
      for (let offset = 0; ; offset += 1000) {
        const res = await call(`${YA}/resources?path=${q(dir)}&limit=1000&offset=${offset}&fields=_embedded.items.name,_embedded.items.size,_embedded.items.modified,_embedded.items.type,_embedded.total`)
        if (res.status === 404) return out
        if (!res.ok) throw new Error(`${who}: HTTP ${res.status}`)
        const body = await readBody<{ _embedded?: { items: { name: string; size?: number; modified: string; type: string }[]; total: number } }>(res, who)
        const items = body._embedded?.items ?? []
        for (const it of items) if (it.type === 'file') out.push({ name: it.name, size: it.size ?? 0, modified: Date.parse(it.modified) })
        if (items.length < 1000) return out
      }
    },
    async read(file) {
      const res = await call(`${YA}/resources/download?path=${q(file)}`)
      if (!res.ok) throw new Error(`${who}: не скачать ${file} (HTTP ${res.status})`)
      const { href } = await readBody<{ href: string }>(res, who)
      const got = await download(href, {}, who)
      if (!got.data) throw new OfflineError(`${who}: HTTP ${got.res.status}`)
      return got.data
    },
    async write(file, data) {
      const dir = file.split('/').slice(0, -1).join('/')
      await mkdirs(dir)
      let res = await uploadUrl(file)
      // 409 — папки нет: её удалили на Диске, пока PlayOS работал
      if (res.status === 409) {
        made.clear()
        await mkdirs(dir)
        res = await uploadUrl(file)
      }
      if (!res.ok) throw new Error(`${who}: не загрузить ${file} (HTTP ${res.status})`)
      const { href } = await readBody<{ href: string }>(res, who)
      const put = await request(href, { method: 'PUT', body: new Uint8Array(data) }, uploadMs(data.length), who)
      if (put.status === 507 || put.status === 413) throw new QuotaError(`${who}: нет места`)
      if (put.status >= 500) throw new OfflineError(`${who}: HTTP ${put.status}`)
      if (!put.ok) throw new Error(`${who}: загрузка не удалась (HTTP ${put.status})`)
    },
    async remove(file) {
      const res = await call(`${YA}/resources?path=${q(file)}&permanently=true`, { method: 'DELETE' })
      if (!res.ok && res.status !== 404) throw new Error(`${who}: не удалить ${file} (HTTP ${res.status})`)
    },
    async account() {
      const res = await call(`${YA}/?fields=user.display_name,user.login,total_space,used_space`)
      if (!res.ok) throw new Error(`${who}: HTTP ${res.status}`)
      const d = await readBody<{ user?: { display_name?: string; login?: string }; total_space?: number; used_space?: number }>(res, who)
      return { provider: 'yandex', name: d.user?.display_name || d.user?.login || 'Яндекс', used: d.used_space, total: d.total_space }
    }
  }
}

// ── Google Drive: папка «PlayOS» в корне Диска (область drive.file) ──
// Вход по коду у Google не принимает drive.appdata (скрытую папку), а drive.file принимает:
// PlayOS видит только файлы, которые создал сам, — остальной Диск ему недоступен

const GD = 'https://www.googleapis.com/drive/v3'
const GD_UP = 'https://www.googleapis.com/upload/drive/v3'
const FOLDER = 'application/vnd.google-apps.folder'

export function googleRemote(token: TokenSource): Remote {
  const who = 'Google Drive'
  const call = async (url: string, init: RequestInit = {}, ms = API_MS) => {
    for (let retry = false; ; retry = true) {
      const res = await request(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${await token(retry)}` } }, ms, who)
      if (res.status === 401 && !retry) continue
      if (res.status === 401) throw new AuthError(`${who}: вход устарел`)
      if (res.status === 403) {
        // 403 у Google — и «нет места», и превышение лимита запросов (временно), и запрет доступа
        const text = await res.text().catch(() => '')
        if (/storageQuotaExceeded/.test(text)) throw new QuotaError(`${who}: нет места`)
        if (/rateLimitExceeded|dailyLimitExceeded/i.test(text)) throw new OfflineError(`${who}: лимит запросов`)
        throw new Error(`${who}: HTTP 403`)
      }
      if (res.status >= 500 || res.status === 429) throw new OfflineError(`${who}: HTTP ${res.status}`)
      return res
    }
  }
  // В Drive нет путей — только id и родители. Папки ищем по имени и запоминаем id
  const ids = new Map<string, string>()
  const quote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  // Два ПК могли одновременно создать одну папку — берём самую раннюю: выбор одинаковый на всех ПК и не меняется
  const find = async (parent: string, name: string, folder: boolean) => {
    const q = `name = ${quote(name)} and ${quote(parent)} in parents and trashed = false and mimeType ${folder ? '=' : '!='} '${FOLDER}'`
    const res = await call(`${GD}/files?spaces=drive&q=${encodeURIComponent(q)}&fields=files(id)&orderBy=createdTime&pageSize=10`)
    if (!res.ok) throw new Error(`${who}: HTTP ${res.status}`)
    return (await readBody<{ files: { id: string }[] }>(res, who)).files[0]?.id
  }
  const dirId = async (dir: string, create: boolean): Promise<string | undefined> => {
    const parts = ['PlayOS', ...dir.split('/').filter(Boolean)]
    let parent = 'root'
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join('/')
      let id = ids.get(p)
      if (!id) {
        id = await find(parent, parts[i - 1], true)
        if (!id && !create) return undefined
        if (!id) {
          const res = await call(`${GD}/files?fields=id`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: parts[i - 1], mimeType: FOLDER, parents: [parent] })
          })
          if (!res.ok) throw new Error(`${who}: не создать папку ${p} (HTTP ${res.status})`)
          id = (await readBody<{ id: string }>(res, who)).id
        }
        ids.set(p, id)
      }
      parent = id
    }
    return parent
  }
  const split = (file: string) => {
    const i = file.lastIndexOf('/')
    return [file.slice(0, Math.max(0, i)), file.slice(i + 1)] as const
  }
  const fileId = async (file: string) => {
    const [dir, name] = split(file)
    const parent = await dirId(dir, false)
    return parent ? find(parent, name, false) : undefined
  }
  const upload = async (file: string, data: Buffer) => {
    const [dir, name] = split(file)
    const parent = (await dirId(dir, true))!
    const existing = await find(parent, name, false)
    if (existing) {
      // Тот же файл — новое содержимое, id и история остаются
      return call(`${GD_UP}/files/${existing}?uploadType=media`, { method: 'PATCH', body: new Uint8Array(data) }, uploadMs(data.length))
    }
    const boundary = `playos${Date.now()}`
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parent] })}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
      data,
      Buffer.from(`\r\n--${boundary}--`)
    ])
    return call(
      `${GD_UP}/files?uploadType=multipart&fields=id`,
      { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: new Uint8Array(body) },
      uploadMs(body.length)
    )
  }
  return {
    id: 'google',
    async list(dir) {
      const parent = await dirId(dir, false)
      if (!parent) return []
      const out: RemoteEntry[] = []
      let page = ''
      do {
        const q = `${quote(parent)} in parents and trashed = false and mimeType != '${FOLDER}'`
        const res = await call(`${GD}/files?spaces=drive&q=${encodeURIComponent(q)}&fields=nextPageToken,files(name,size,modifiedTime)&pageSize=1000${page ? `&pageToken=${page}` : ''}`)
        if (!res.ok) throw new Error(`${who}: HTTP ${res.status}`)
        const body = await readBody<{ nextPageToken?: string; files: { name: string; size?: string; modifiedTime: string }[] }>(res, who)
        for (const f of body.files) out.push({ name: f.name, size: Number(f.size ?? 0), modified: Date.parse(f.modifiedTime) })
        page = body.nextPageToken ?? ''
      } while (page)
      return out
    },
    async read(file) {
      const id = await fileId(file)
      if (!id) throw new Error(`${who}: нет файла ${file}`)
      const headers = { Authorization: `Bearer ${await token()}` }
      let got = await download(`${GD}/files/${id}?alt=media`, headers, who)
      if (got.res.status === 401) got = await download(`${GD}/files/${id}?alt=media`, { Authorization: `Bearer ${await token(true)}` }, who)
      if (got.res.status === 401) throw new AuthError(`${who}: вход устарел`)
      if (got.res.status >= 500 || got.res.status === 429 || got.res.status === 403) throw new OfflineError(`${who}: HTTP ${got.res.status}`)
      if (!got.data) throw new Error(`${who}: не скачать ${file} (HTTP ${got.res.status})`)
      return got.data
    },
    async write(file, data) {
      let res = await upload(file, data)
      // 404 — папку удалили на Диске, пока PlayOS работал: забываем id папок и создаём заново
      if (res.status === 404) {
        ids.clear()
        res = await upload(file, data)
      }
      if (!res.ok) throw new Error(`${who}: загрузка не удалась (HTTP ${res.status})`)
    },
    async remove(file) {
      const id = await fileId(file)
      if (!id) return
      const res = await call(`${GD}/files/${id}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 404) throw new Error(`${who}: не удалить ${file} (HTTP ${res.status})`)
    },
    async account() {
      const res = await call(`${GD}/about?fields=user(displayName,emailAddress),storageQuota(limit,usage)`)
      if (!res.ok) throw new Error(`${who}: HTTP ${res.status}`)
      const d = await readBody<{ user?: { displayName?: string; emailAddress?: string }; storageQuota?: { limit?: string; usage?: string } }>(res, who)
      return {
        provider: 'google',
        name: d.user?.displayName || d.user?.emailAddress || 'Google',
        used: d.storageQuota?.usage ? Number(d.storageQuota.usage) : undefined,
        total: d.storageQuota?.limit ? Number(d.storageQuota.limit) : undefined
      }
    }
  }
}
