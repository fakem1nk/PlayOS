/**
 * Название раздачи — коротко, метками вместо строки: кто собрал (имя сборщика, Лицензия, GOG, Portable), версия,
 * DLC, русский язык. «Game: Ultimate Edition [v 2.5 + DLCs] (2020) PC | Лицензия» → Лицензия · 2.5 · Ultimate · DLC
 */
export interface Release {
  /** Кто собрал или что это: имя репакера, «Лицензия», «GOG», «Portable» */
  by?: string
  version?: string
  dlc: boolean
  rus: boolean
  /** Издание: Ultimate, Deluxe, GOTY… */
  edition?: string
}

const EDITION = /\b(ultimate|deluxe|complete|gold|definitive|goty|game of the year|anniversary|director'?s cut|remastered)\b/i

export function release(title: string): Release {
  const by =
    title.match(/(?:re-?pack|rip)\s+(?:от|by)\s+([^|[\]()]+?)\s*(?:[|[\](]|$)/i)?.[1].trim() ??
    (/\bportable\b/i.test(title) ? 'Portable' : /\[GOG\]|\bGOG\b/.test(title) ? 'GOG' : /лицензия|\[L\]/i.test(title) ? 'Лицензия' : /steam-?rip/i.test(title) ? 'Steam-Rip' : undefined)
  const version = title.match(/\bv\.?\s?(\d+(?:\.\d+)+[a-z]?)/i)?.[1] ?? title.match(/\((\d+(?:\.\d+)+)\b/)?.[1]
  const edition = title.match(EDITION)?.[1]
  return {
    by,
    version,
    dlc: /\bdlc/i.test(title),
    rus: /\bRUS\b|русск|рус\./i.test(title),
    edition: edition && edition.replace(/game of the year/i, 'GOTY').replace(/^./, (c) => c.toUpperCase())
  }
}

const UNITS: Record<string, number> = { b: 1, kb: 2 ** 10, mb: 2 ** 20, gb: 2 ** 30, tb: 2 ** 40, б: 1, кб: 2 ** 10, мб: 2 ** 20, гб: 2 ** 30, тб: 2 ** 40 }

/** Размер из источника («141.61 GB», «4,7 ГБ») в байтах; не понять — 0 */
export function sizeBytes(s?: string): number {
  const m = s?.trim().match(/^([\d.,]+)\s*([a-zа-я]+)/i)
  if (!m) return 0
  const n = Number(m[1].replace(',', '.'))
  const k = UNITS[m[2].toLowerCase().replace(/ib$/, 'b')] ?? 0
  return Number.isFinite(n) ? Math.round(n * k) : 0
}
