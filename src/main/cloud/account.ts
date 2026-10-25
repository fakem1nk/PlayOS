import { safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CloudAccount, CloudDeviceCode, CloudProviderId } from '@shared/types'
import { httpFetch } from '../http'
import { log } from '../log'
import { dataDir } from '../store'
import { folderRemote, googleRemote, OfflineError, yandexRemote, type Remote } from './remote'

/**
 * Вход в облако и его токены. Своего сервера у PlayOS нет: аккаунт — это вход в Яндекс Диск или Google Drive
 * (или папка синхронизации). Токены шифруются средствами Windows (safeStorage → DPAPI) и лежат
 * в cloud.json — отдельно от library.json, поэтому не попадают в копии данных и на другие ПК.
 * Там же deviceId: копия library.json на другом ПК не должна делать его «тем же устройством».
 */

interface Tokens {
  access: string
  refresh?: string
  expiresAt: number
}

interface CloudFile {
  deviceId: string
  provider?: CloudProviderId
  folder?: string
  tokens?: string
  account?: CloudAccount
}

/** OAuth-приложения облаков: вход по коду (device flow) — удобно с геймпадом, пароль вводится на телефоне */
interface OAuthApp {
  id: string
  secret: string
  codeUrl: string
  tokenUrl: string
  /** Параметры запроса кода, кроме client_id */
  codeParams: () => Record<string, string>
  /** Как опрашивать: grant_type и имя параметра с device_code */
  grant: string
  codeParam: string
  /** Запас до истечения токена, после которого обновляем */
  refreshMargin: number
}

const OAUTH: Record<'yandex' | 'google', OAuthApp> = {
  yandex: {
    id: import.meta.env.MAIN_VITE_YANDEX_CLIENT_ID ?? '',
    secret: import.meta.env.MAIN_VITE_YANDEX_CLIENT_SECRET ?? '',
    codeUrl: 'https://oauth.yandex.ru/device/code',
    tokenUrl: 'https://oauth.yandex.ru/token',
    codeParams: () => ({ device_id: deviceId().replace(/-/g, ''), device_name: `PlayOS ${deviceName()}` }),
    grant: 'device_code',
    codeParam: 'code',
    refreshMargin: 7 * 86_400_000
  },
  google: {
    id: import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID ?? '',
    secret: import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET ?? '',
    codeUrl: 'https://oauth2.googleapis.com/device/code',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    // Только файлы, созданные самим PlayOS (папка PlayOS на Диске): остальной Диск недоступен.
    // drive.appdata (скрытая папка) вход по коду не принимает — invalid_scope
    codeParams: () => ({ scope: 'https://www.googleapis.com/auth/drive.file' }),
    grant: 'urn:ietf:params:oauth:grant-type:device_code',
    codeParam: 'device_code',
    refreshMargin: 5 * 60_000
  }
}

const file = () => path.join(dataDir(), 'cloud.json')
let state: CloudFile | null = null
let pending: (CloudDeviceCode & { cancel: () => void }) | null = null

function load(): CloudFile {
  if (state) return state
  try {
    state = JSON.parse(fs.readFileSync(file(), 'utf8')) as CloudFile
  } catch {
    state = { deviceId: randomUUID() }
  }
  if (!state.deviceId) state.deviceId = randomUUID()
  save()
  return state
}

function save() {
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  fs.writeFileSync(file(), JSON.stringify(state, null, 2))
}

const seal = (t: Tokens) =>
  safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(JSON.stringify(t)).toString('base64') : 'plain:' + Buffer.from(JSON.stringify(t)).toString('base64')

function unseal(s?: string): Tokens | null {
  if (!s) return null
  try {
    if (s.startsWith('plain:')) return JSON.parse(Buffer.from(s.slice(6), 'base64').toString('utf8')) as Tokens
    return JSON.parse(safeStorage.decryptString(Buffer.from(s, 'base64'))) as Tokens
  } catch {
    return null
  }
}

export const deviceId = () => load().deviceId
export const deviceName = () => os.hostname()
export const available = (): CloudProviderId[] => [...(['yandex', 'google'] as const).filter((p) => OAUTH[p].id && OAUTH[p].secret), 'folder']
export const pendingCode = (): CloudDeviceCode | undefined => (pending ? { url: pending.url, code: pending.code, expiresAt: pending.expiresAt } : undefined)
export const cachedAccount = () => load().account ?? null

async function oauthToken(app: OAuthApp, params: Record<string, string>) {
  let res: Response
  try {
    res = await httpFetch(app.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...params, client_id: app.id, client_secret: app.secret }).toString()
    })
  } catch (e) {
    throw new OfflineError((e as Error).message)
  }
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string }
  return { ok: res.ok, body }
}

/** Действующий токен облака: при необходимости обновляется по refresh_token */
async function accessToken(): Promise<string> {
  const s = load()
  const t = unseal(s.tokens)
  if (!t || (s.provider !== 'yandex' && s.provider !== 'google')) throw new Error('Нет входа в облако')
  const app = OAUTH[s.provider]
  if (Date.now() < t.expiresAt - app.refreshMargin || !t.refresh) return t.access
  const { ok, body } = await oauthToken(app, { grant_type: 'refresh_token', refresh_token: t.refresh })
  if (!ok || !body.access_token) throw new Error('Вход в облако устарел — войдите снова')
  const next = { access: body.access_token, refresh: body.refresh_token ?? t.refresh, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 }
  s.tokens = seal(next)
  save()
  return next.access
}

/** Хранилище текущего аккаунта; null — облако не подключено */
export function remote(): Remote | null {
  const s = load()
  if (s.provider === 'folder' && s.folder) return folderRemote(s.folder)
  if (s.provider === 'yandex' && s.tokens) return yandexRemote(accessToken)
  if (s.provider === 'google' && s.tokens) return googleRemote(accessToken)
  return null
}

async function finish(provider: CloudProviderId) {
  const r = remote()
  if (!r) throw new Error('Облако не подключено')
  const s = load()
  s.account = await r.account()
  s.provider = provider
  save()
  log('INFO', `Облако подключено: ${provider}`)
  return s.account
}

export function signInFolder(folder: string) {
  const s = load()
  s.provider = 'folder'
  s.folder = folder
  delete s.tokens
  save()
  return finish('folder')
}

/**
 * Вход по коду (Яндекс или Google): показываем код и адрес, пользователь подтверждает вход на телефоне,
 * а мы опрашиваем сервер. onChange вызывается, когда код появился и когда вход завершён (или отменён).
 */
export async function signInDevice(provider: 'yandex' | 'google', onChange: () => void): Promise<void> {
  pending?.cancel()
  const app = OAUTH[provider]
  let res: Response
  try {
    res = await httpFetch(app.codeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: app.id, ...app.codeParams() }).toString()
    })
  } catch (e) {
    throw new OfflineError((e as Error).message)
  }
  const code = (await res.json()) as { device_code: string; user_code: string; verification_url: string; interval?: number; expires_in?: number }
  if (!res.ok || !code.device_code) throw new Error('Облако не выдало код входа')
  let cancelled = false
  let interval = Math.max(5, code.interval ?? 5)
  pending = {
    url: code.verification_url,
    code: code.user_code,
    expiresAt: Date.now() + (code.expires_in ?? 300) * 1000,
    cancel: () => (cancelled = true)
  }
  onChange()
  const current = pending
  void (async () => {
    try {
      while (!cancelled && Date.now() < current.expiresAt) {
        await new Promise((r) => setTimeout(r, interval * 1000))
        if (cancelled) return
        const { ok, body } = await oauthToken(app, { grant_type: app.grant, [app.codeParam]: code.device_code }).catch(() => ({
          ok: false,
          body: { error: 'authorization_pending' } as { error?: string; access_token?: string; refresh_token?: string; expires_in?: number }
        }))
        if (ok && body.access_token) {
          const s = load()
          s.provider = provider
          s.tokens = seal({ access: body.access_token, refresh: body.refresh_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 })
          delete s.folder
          save()
          await finish(provider)
          return
        }
        if (body.error === 'slow_down') interval += 5
        else if (body.error !== 'authorization_pending') return
      }
    } catch (e) {
      log('WARN', 'Вход в облако не удался:', (e as Error).message)
    } finally {
      if (pending === current) pending = null
      onChange()
    }
  })()
}

export function cancelSignIn() {
  pending?.cancel()
  pending = null
}

export function signOut() {
  const s = load()
  cancelSignIn()
  delete s.provider
  delete s.folder
  delete s.tokens
  delete s.account
  save()
}

/** Обновить имя и место на диске (после синхронизации) */
export async function refreshAccount() {
  const r = remote()
  if (!r) return null
  const s = load()
  s.account = await r.account()
  save()
  return s.account
}
