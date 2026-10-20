import { net } from 'electron'

/**
 * Все сетевые запросы — через сетевой стек Chromium, а не через fetch из Node.
 * Так учитываются системный прокси и VPN (как в браузере): например, CDN SteamGridDB
 * без прокси у части провайдеров отдаёт заголовки, а потом «зависает» на передаче картинки.
 */
export const httpFetch = (url: string, init?: RequestInit): Promise<Response> => net.fetch(url, init)
