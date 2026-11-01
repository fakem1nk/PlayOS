import fs from 'node:fs'
import path from 'node:path'
import type { ApiKeyKind, LocalAccounts } from '@shared/types'
import { pcsx2Config } from './pcsx2'
import { parseVdf, steamRoot } from './steam'
import { getDb } from './store'

/**
 * Помощь с ключами API: страницы, где их выдают, ключ в скопированном тексте и аккаунты, которые уже есть на этом ПК
 * (Steam — по клиенту Steam, RetroAchievements — по входу в PCSX2), чтобы не вписывать их вручную.
 */

/** Страницы ключей и настроек — открываются в браузере только они */
const KEY_SITES = /^(www\.)?(steamcommunity\.com|retroachievements\.org|steamgriddb\.com)$/i

export const keyPageAllowed = (url: string) => {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && KEY_SITES.test(u.hostname)
  } catch {
    return false
  }
}

/** Ключ в тексте: сам ключ или строка «Key: …», скопированная со страницы целиком. Steam и SteamGridDB — 32 hex, RA — 32 буквы и цифры */
const KEY_RE: Record<ApiKeyKind, RegExp> = {
  steam: /(?:^|[^0-9a-z])([0-9a-f]{32})(?=$|[^0-9a-z])/i,
  sgdb: /(?:^|[^0-9a-z])([0-9a-f]{32})(?=$|[^0-9a-z])/i,
  ra: /(?:^|[^0-9a-z])([0-9a-z]{32})(?=$|[^0-9a-z])/i
}

export function keyIn(kind: ApiKeyKind, text: string): string | null {
  // Длинный текст — точно не ключ, а случайный хэш в нём подхватывать нельзя
  if (!text || text.length > 300) return null
  return KEY_RE[kind].exec(text.trim())?.[1] ?? null
}

export async function localAccounts(): Promise<LocalAccounts> {
  const out: LocalAccounts = {}
  const root = await steamRoot()
  if (root) {
    try {
      const vdf = parseVdf(fs.readFileSync(path.join(root, 'config', 'loginusers.vdf'), 'utf8')) as Record<string, Record<string, Record<string, string>>>
      const users = Object.entries(vdf.users ?? {}).filter(([id, u]) => /^7656\d{13}$/.test(id) && typeof u === 'object')
      // Последний, кто входил в клиент Steam на этом ПК
      const [id, u] = users.find(([, u]) => u.MostRecent === '1') ?? users[0] ?? []
      if (id && u) out.steam = { id, name: u.PersonaName || u.AccountName || id }
    } catch {
      /* Steam не установлен или ещё никто не входил */
    }
  }
  const exe = getDb().settings.pcsx2Path
  const raUser = exe ? pcsx2Config(exe)?.raUser : undefined
  if (raUser) out.raUser = raUser
  return out
}
