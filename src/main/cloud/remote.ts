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

// ── Папка синхронизации: OneDrive, Google Drive для ПК, Dropbox, Syncthing, сетевой диск ──

export function folderRemote(root: string): Remote {
  const abs = (p: string) => path.join(root, 'PlayOS', ...p.split('/'))
  const ensureRoot = () => {
    if (!fs.existsSync(root)) throw new OfflineError(`Папка недоступна: ${root}`)
  }
  return {
    id: 'folder',
    async list(dir) {
      ensureRoot()
      try {
        return fs
          .readdirSync(abs(dir), { withFileTypes: true })
          .filter((e) => e.isFile() && !e.name.endsWith('.tmp'))
          .map((e) => {
            const st = fs.statSync(path.join(abs(dir), e.name))
            return { name: e.name, size: st.size, modified: st.mtimeMs }
          })
      } catch {
        return []
      }
    },
    async read(file) {
      ensureRoot()
      return fs.readFileSync(abs(file))
    },
    async write(file, data) {
      ensureRoot()
      const target = abs(file)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      // Временное имя и переименование: клиент облака не заберёт файл наполовину
      fs.writeFileSync(target + '.tmp', data)
      fs.renameSync(target + '.tmp', target)
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

export function yandexRemote(token: () => Promise<string>): Remote {
  const call = async (url: string, init: RequestInit = {}) => {
    let res: Response
    try {
      res = await httpFetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `OAuth ${await token()}` } })
    } catch (e) {
      throw new OfflineError((e as Error).message)
    }
    if (res.status >= 500 || res.status === 429) throw new OfflineError(`Яндекс.Диск: HTTP ${res.status}`)
    return res
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
      if (!res.ok && res.status !== 409) throw new Error(`Яндекс.Диск: не создать папку ${d} (HTTP ${res.status})`)
      made.add(d)
    }
  }
  return {
    id: 'yandex',
    async list(dir) {
      const out: RemoteEntry[] = []
      for (let offset = 0; ; offset += 1000) {
        const res = await call(`${YA}/resources?path=${q(dir)}&limit=1000&offset=${offset}&fields=_embedded.items.name,_embedded.items.size,_embedded.items.modified,_embedded.items.type,_embedded.total`)
        if (res.status === 404) return out
        if (!res.ok) throw new Error(`Яндекс.Диск: HTTP ${res.status}`)
        const body = (await res.json()) as { _embedded?: { items: { name: string; size?: number; modified: string; type: string }[]; total: number } }
        const items = body._embedded?.items ?? []
        for (const it of items) if (it.type === 'file') out.push({ name: it.name, size: it.size ?? 0, modified: Date.parse(it.modified) })
        if (items.length < 1000) return out
      }
    },
    async read(file) {
      const res = await call(`${YA}/resources/download?path=${q(file)}`)
      if (!res.ok) throw new Error(`Яндекс.Диск: не скачать ${file} (HTTP ${res.status})`)
      const { href } = (await res.json()) as { href: string }
      let data: Response
      try {
        data = await httpFetch(href)
      } catch (e) {
        throw new OfflineError((e as Error).message)
      }
      if (!data.ok) throw new OfflineError(`Яндекс.Диск: HTTP ${data.status}`)
      return Buffer.from(await data.arrayBuffer())
    },
    async write(file, data) {
      await mkdirs(file.split('/').slice(0, -1).join('/'))
      const res = await call(`${YA}/resources/upload?path=${q(file)}&overwrite=true`)
      if (!res.ok) throw new Error(`Яндекс.Диск: не загрузить ${file} (HTTP ${res.status})`)
      const { href } = (await res.json()) as { href: string }
      let put: Response
      try {
        put = await httpFetch(href, { method: 'PUT', body: new Uint8Array(data) })
      } catch (e) {
        throw new OfflineError((e as Error).message)
      }
      if (!put.ok) throw new Error(`Яндекс.Диск: загрузка не удалась (HTTP ${put.status})`)
    },
    async remove(file) {
      const res = await call(`${YA}/resources?path=${q(file)}&permanently=true`, { method: 'DELETE' })
      if (!res.ok && res.status !== 404) throw new Error(`Яндекс.Диск: не удалить ${file} (HTTP ${res.status})`)
    },
    async account() {
      const res = await call(`${YA}/?fields=user.display_name,user.login,total_space,used_space`)
      if (!res.ok) throw new Error(`Яндекс.Диск: HTTP ${res.status}`)
      const d = (await res.json()) as { user?: { display_name?: string; login?: string }; total_space?: number; used_space?: number }
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

export function googleRemote(token: () => Promise<string>): Remote {
  const call = async (url: string, init: RequestInit = {}) => {
    let res: Response
    try {
      res = await httpFetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${await token()}` } })
    } catch (e) {
      throw new OfflineError((e as Error).message)
    }
    if (res.status >= 500 || res.status === 429) throw new OfflineError(`Google Drive: HTTP ${res.status}`)
    return res
  }
  // В Drive нет путей — только id и родители. Папки ищем по имени и запоминаем id
  const ids = new Map<string, string>()
  const quote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  const find = async (parent: string, name: string, folder: boolean) => {
    const q = `name = ${quote(name)} and ${quote(parent)} in parents and trashed = false and mimeType ${folder ? '=' : '!='} '${FOLDER}'`
    const res = await call(`${GD}/files?spaces=drive&q=${encodeURIComponent(q)}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc&pageSize=10`)
    if (!res.ok) throw new Error(`Google Drive: HTTP ${res.status}`)
    return ((await res.json()) as { files: { id: string }[] }).files[0]?.id
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
          if (!res.ok) throw new Error(`Google Drive: не создать папку ${p} (HTTP ${res.status})`)
          id = ((await res.json()) as { id: string }).id
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
        if (!res.ok) throw new Error(`Google Drive: HTTP ${res.status}`)
        const body = (await res.json()) as { nextPageToken?: string; files: { name: string; size?: string; modifiedTime: string }[] }
        for (const f of body.files) out.push({ name: f.name, size: Number(f.size ?? 0), modified: Date.parse(f.modifiedTime) })
        page = body.nextPageToken ?? ''
      } while (page)
      return out
    },
    async read(file) {
      const id = await fileId(file)
      if (!id) throw new Error(`Google Drive: нет файла ${file}`)
      const res = await call(`${GD}/files/${id}?alt=media`)
      if (!res.ok) throw new Error(`Google Drive: не скачать ${file} (HTTP ${res.status})`)
      return Buffer.from(await res.arrayBuffer())
    },
    async write(file, data) {
      const [dir, name] = split(file)
      const parent = (await dirId(dir, true))!
      const existing = await find(parent, name, false)
      if (existing) {
        // Тот же файл — новое содержимое, id и история остаются
        const res = await call(`${GD_UP}/files/${existing}?uploadType=media`, { method: 'PATCH', body: new Uint8Array(data) })
        if (!res.ok) throw new Error(`Google Drive: загрузка не удалась (HTTP ${res.status})`)
        return
      }
      const boundary = `playos${Date.now()}`
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parent] })}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
        data,
        Buffer.from(`\r\n--${boundary}--`)
      ])
      const res = await call(`${GD_UP}/files?uploadType=multipart&fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body: new Uint8Array(body)
      })
      if (!res.ok) throw new Error(`Google Drive: загрузка не удалась (HTTP ${res.status})`)
    },
    async remove(file) {
      const id = await fileId(file)
      if (!id) return
      const res = await call(`${GD}/files/${id}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 404) throw new Error(`Google Drive: не удалить ${file} (HTTP ${res.status})`)
    },
    async account() {
      const res = await call(`${GD}/about?fields=user(displayName,emailAddress),storageQuota(limit,usage)`)
      if (!res.ok) throw new Error(`Google Drive: HTTP ${res.status}`)
      const d = (await res.json()) as { user?: { displayName?: string; emailAddress?: string }; storageQuota?: { limit?: string; usage?: string } }
      return {
        provider: 'google',
        name: d.user?.displayName || d.user?.emailAddress || 'Google',
        used: d.storageQuota?.usage ? Number(d.storageQuota.usage) : undefined,
        total: d.storageQuota?.limit ? Number(d.storageQuota.limit) : undefined
      }
    }
  }
}
