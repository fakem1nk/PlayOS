/**
 * Сопоставление названий из источников с играми магазина. В названиях загрузок много лишнего: версии, сборки,
 * «+ все DLC», теги в скобках, издания, платформа. От названия остаются два ключа:
 *  - full — само название без мусора и знаков препинания;
 *  - base — то же без слов «мягких» изданий (Deluxe, GOTY, Complete…): такие издания — та же игра в Steam.
 * Слова, за которыми в Steam обычно стоит отдельная игра (Remastered, Definitive, Director's Cut…), остаются
 * в обоих ключах. Цифры и римские номера тоже: продолжение никогда не совпадёт с оригиналом (Dark Souls ≠ Dark Souls III).
 * Общий для main (источники) и интерфейса (есть ли игра магазина в библиотеке).
 */

export interface TitleKey {
  full: string
  base: string
}

/** Платформа раздачи. Остальные (Android, PSP, Xbox, Mac, Linux…) PlayOS не запускает — такие загрузки отбрасываются */
export type SourcePlatform = 'pc' | 'ps2' | 'ps3' | 'other'

/** Разобранное название загрузки */
export interface TitleInfo {
  /** Ключи всех вариантов названия: «GTA 5 / Grand Theft Auto V» — оба. Первый — главный (по нему ищем в Steam) */
  keys: TitleKey[]
  platform: SourcePlatform
  /** Год из скобок: «(2008)», «(2026, RTS)». У раздач это то год выхода, то год раздачи */
  year?: number
}

const ROMAN: Record<string, string> = {
  ii: '2',
  iii: '3',
  iv: '4',
  v: '5',
  vi: '6',
  vii: '7',
  viii: '8',
  ix: '9',
  x: '10',
  xi: '11',
  xii: '12',
  xiii: '13'
}

/** Издания, которые в Steam — та же страница игры. CE — Collector's Edition у казуальных игр */
const SOFT = /\b(game of the year|goty|digital deluxe|super deluxe|deluxe|ultimate|complete|gold|premium|digital|standard|special|collectors?|ce|bundle|edition|season pass|day one|launch|all dlcs?|dlcs?)\b/g

/** Слова, за которыми в Steam обычно отдельная игра: такое издание после двоеточия не отбрасывается */
const HARD = /\b(remaster(ed)?|definitive|legendary|enhanced|redux|directors cut|final cut|remake|anniversary|royal)\b/

/** Хвост после двоеточия или тире, который просто называет издание: «: Apex Predator Edition», «- GOTY», «— Полное издание» */
const EDITION_TAIL = /(?:^|\s)(edition|goty|game of the year|издание)$/

/** Слова раздач, а не названия: упаковка, языки, разрядность */
const NOISE = /\b(repack|multi\d*|x64|x86|pc|portable|proper|cracked|crack|steamrip|steam rip|gog|rus|eng|eu|usa|incl|including|bonus content|bonus|ost)\b/g

const VERSION = /\b(v\s?\d[\w.-]*|\d+(\.\d+){2,}\w*|(build|update|patch|rev|hotfix)\s?\d[\w.-]*)\b/g

const CYRILLIC = /[а-яё]/i

/** Платформы раздач. PC бывает набрано кириллицей — «РС» */
const PLATFORM_WORD = '[PР][CС]|PS ?[1-5]|PSX|PSP|PS ?Vita|Xbox(?: ?360| One| Series [XS])?|X360|Switch|NSW|Android|iOS|Mac(?:OS)?|OS ?X|Linux'
/** Платформа сразу за скобками: «… (2013) PS3 | RePack», «… (2001) PS2», «… [Early Access] РС | Лицензия» */
const PLATFORM_AFTER = new RegExp(`[)\\]]\\s*(${PLATFORM_WORD})\\s*(?:\\||$)`, 'iu')
/** Она же в конце названия без скобок — вместе со всем, что после неё */
const PLATFORM_TAIL = new RegExp(`\\s(${PLATFORM_WORD})\\s*(?:\\|.*)?$`, 'iu')

function platformOf(word: string): SourcePlatform {
  const w = word.toUpperCase().replace(/\s/g, '').replace('Р', 'P').replace('С', 'C')
  if (w === 'PC') return 'pc'
  if (w === 'PS2') return 'ps2'
  if (w === 'PS3') return 'ps3'
  return 'other'
}

/** Название без обвеса раздачи: скобки, «PC | RePack от …», платформа, «+ DLC». Варианты через « / » и « | » — списком */
function split(title: string): { parts: string[]; platform: SourcePlatform } {
  // ™ и ® — до NFKD: он превращает ™ в буквы TM
  let s = title.replace(/[™®©]/g, '')
  // Сценовые названия без пробелов: Game.Name.v1.0-GROUP — версия и группа после дефиса не нужны, точки в пробелы
  if (!/\s/.test(s) && /[._]/.test(s)) {
    s = s
      .replace(/[._-]v?\d+([._]\d+)+/gi, ' ')
      .replace(/[._]/g, ' ')
      .replace(/-[A-Za-z0-9]+$/, '')
  }
  // Платформу ищем только сразу за скобками: игра может и называться «… Switch»
  const pm = s.match(PLATFORM_AFTER)
  const platform = pm ? platformOf(pm[1]) : 'pc'
  // Всё в скобках — версии, языки, год, жанр, состав сборки
  s = s
    .replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(pm ? PLATFORM_TAIL : /\s[PР][CС]\s*(\|.*)?$/iu, ' ')
    // Хвост раздачи без платформы: «… | Лицензия», «… RePack от FitGirl»
    .replace(/\s\|\s*(re-?pack|лицензия|portable|steam-?rip).*$/iu, ' ')
    .replace(/\s(re-?pack|portable|steam-?rip|rip)\s+(от|by)\s.*$/iu, ' ')
  // «+ 5 DLCs», «+ Update 3», «+ The Reckoning» — дальше название игры уже не продолжается
  const parts = s
    .split(/\s[/|]\s/)
    .map((p) => p.replace(/\s\+\s.*$/, ' ').replace(/\+\s?\d+\s?dlcs?/gi, ' ').trim())
    .filter(Boolean)
  return { parts: parts.length ? parts : [s.trim()], platform }
}

/** Слова названия: строчные, без версий, знаков и мусора, римские номера цифрами */
function words(s: string): string {
  const list = s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(VERSION, ' ')
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(NOISE, ' ')
    .split(' ')
    .filter((w) => w && w !== 'лицензия')
    .map((w) => ROMAN[w] ?? w)
  if (list[0] === 'the' && list.length > 1) list.shift()
  return list.join(' ')
}

const soft = (s: string) => s.replace(SOFT, ' ').replace(/\s+/g, ' ').trim()

function keyOf(s: string): TitleKey {
  const full = words(s)
  let base = soft(full)
  // «Игра: Какое-то Edition» — то же, что «Игра», если в хвосте нет слов отдельного издания
  const m = s.match(/^(.*\S)(?::\s|\s[-–—]\s)(.+)$/)
  if (m) {
    const tail = words(m[2])
    const head = soft(words(m[1]))
    if (head && EDITION_TAIL.test(tail) && !HARD.test(tail)) base = head
  }
  return { full, base: base || full }
}

/** Ключ названия игры магазина или библиотеки */
export function titleKey(title: string): TitleKey {
  const { parts } = split(title)
  return keyOf(parts.find((p) => !CYRILLIC.test(p)) ?? parts[0])
}

/**
 * Название загрузки целиком: ключи всех вариантов, платформа и год. Главный ключ — самое длинное латинское название
 * («Grand Theft Auto V», а не «GTA 5»); без латиницы — первое (русские игры Steam тоже знает)
 */
export function parseTitle(title: string): TitleInfo {
  const { parts, platform } = split(title)
  const latin = parts.filter((p) => !CYRILLIC.test(p)).sort((a, b) => b.length - a.length)
  const ordered = [...latin, ...parts.filter((p) => CYRILLIC.test(p))]
  const keys: TitleKey[] = []
  for (const p of ordered) {
    const k = keyOf(p)
    if (k.full && !keys.some((x) => x.full === k.full)) keys.push(k)
  }
  const y = title.match(/\(((?:19|20)\d\d)\b/)
  return { keys: keys.length ? keys : [{ full: '', base: '' }], platform, ...(y ? { year: Number(y[1]) } : {}) }
}

/**
 * Название раздачи для витрины: главный вариант (тот же, что даёт главный ключ) без версий и обвеса —
 * «Hollow Knight v1.5.78 + All DLCs (FitGirl Repack)» → «Hollow Knight». Его ключ совпадает с ключом раздачи
 */
export function displayTitle(title: string): string {
  const { parts } = split(title)
  const latin = parts.filter((p) => !CYRILLIC.test(p)).sort((a, b) => b.length - a.length)
  const main = latin[0] ?? parts[0] ?? title
  const clean = main
    .replace(new RegExp(VERSION.source, 'gi'), ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\s\-–—:,.]+$/, '')
    .trim()
  return clean || main.trim()
}

/**
 * Игра магазина в библиотеке: по Steam AppID, а среди PC-игр без AppID (добавлены вручную, арт не из Steam) —
 * по названию, чтобы магазин не добавил её второй раз
 */
export function libraryMatch<G extends { platform: string; steamAppId?: number; title: string }>(games: G[], appId: number, title: string): G | undefined {
  const byId = games.find((g) => g.steamAppId === appId)
  if (byId || !title) return byId
  const k = titleKey(title)
  if (!k.full) return undefined
  return games.find((g) => {
    if (g.platform !== 'pc' || g.steamAppId) return false
    const gk = titleKey(g.title)
    return gk.full === k.full || gk.base === k.base
  })
}

/** Индекс записей источников по всем ключам */
export class TitleIndex<T extends { keys: TitleKey[] }> {
  private byFull = new Map<string, T[]>()
  private byBase = new Map<string, T[]>()

  constructor(items: T[] = []) {
    for (const it of items) this.add(it)
  }

  add(it: T) {
    for (const k of it.keys) {
      push(this.byFull, k.full, it)
      push(this.byBase, k.base, it)
    }
  }

  /** Записи для игры с этим названием: то же название или то же без «мягкого» издания */
  find(key: TitleKey): T[] {
    const a = this.byFull.get(key.full) ?? []
    const b = this.byBase.get(key.base) ?? []
    if (!b.length) return a
    if (!a.length) return b
    return [...new Set([...a, ...b])]
  }

  /** Записи с этим базовым ключом */
  group(base: string): T[] {
    return this.byBase.get(base) ?? []
  }
}

function push<T>(map: Map<string, T[]>, k: string, v: T) {
  if (!k) return
  const list = map.get(k)
  if (!list) map.set(k, [v])
  else if (list[list.length - 1] !== v) list.push(v)
}
