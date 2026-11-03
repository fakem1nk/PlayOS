/**
 * Сопоставление названий из источников с играми магазина. В названиях загрузок много лишнего: версии, сборки,
 * «+ все DLC», теги в скобках, издания. От названия остаются два ключа:
 *  - full — само название без мусора и знаков препинания;
 *  - base — то же без слов «мягких» изданий (Deluxe, GOTY, Complete…): такие издания — та же игра в Steam.
 * Слова, за которыми в Steam обычно стоит отдельная игра (Remastered, Definitive, Director's Cut…), остаются
 * в обоих ключах. Цифры и римские номера тоже: продолжение никогда не совпадёт с оригиналом (Dark Souls ≠ Dark Souls III).
 */

export interface TitleKey {
  full: string
  base: string
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

/** Хвост после двоеточия или тире, который просто называет издание: «: Apex Predator Edition», «- GOTY» */
const EDITION_TAIL = /\b(edition|goty|game of the year)$/

/** Слова раздач, а не названия: упаковка, языки, разрядность */
const NOISE = /\b(repack|multi\d*|x64|x86|pc|portable|proper|cracked|crack|steamrip|steam rip|gog|rus|eng|eu|usa|incl|including|bonus content|bonus|ost|лицензия)\b/g

const VERSION = /\b(v\s?\d[\w.-]*|\d+(\.\d+){2,}\w*|(build|update|patch|rev|hotfix)\s?\d[\w.-]*)\b/g

const CYRILLIC = /[а-яё]/i

/** Название без обвеса раздачи: скобки, «PC | RePack от …», русский вариант названия, «+ DLC» */
function trim(title: string): string {
  // ™ и ® — до NFKD: он превращает ™ в буквы TM
  let s = title.replace(/[™®©]/g, '')
  // Сценовые названия без пробелов: Game.Name.v1.0-GROUP — версия и группа после дефиса не нужны, точки в пробелы
  if (!/\s/.test(s) && /[._]/.test(s)) {
    s = s
      .replace(/[._-]v?\d+([._]\d+)+/gi, ' ')
      .replace(/[._]/g, ' ')
      .replace(/-[A-Za-z0-9]+$/, '')
  }
  s = s
    // Всё в скобках — версии, языки, год, жанр, состав сборки
    .replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, ' ')
    // Хвост раздачи: «… (2026) PC | RePack от FitGirl», «… PC | Лицензия»
    .replace(/\s+pc\s*(\|.*)?$/i, ' ')
  // Два названия через « / » или « | » — английское и русское: берём то, что без кириллицы
  const parts = s.split(/\s[/|]\s/)
  s = parts.find((p) => p.trim() && !CYRILLIC.test(p)) ?? parts[0]
  // «+ 5 DLCs», «+ Update 3», «+ The Reckoning» — дальше название игры уже не продолжается
  return s.replace(/\s\+\s.*$/, ' ').replace(/\+\s?\d+\s?dlcs?/gi, ' ')
}

/** Слова названия: строчные, без версий, знаков и мусора, римские номера цифрами */
function words(s: string): string {
  const list = s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(VERSION, ' ')
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(NOISE, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => ROMAN[w] ?? w)
  if (list[0] === 'the' && list.length > 1) list.shift()
  return list.join(' ')
}

const soft = (s: string) => s.replace(SOFT, ' ').replace(/\s+/g, ' ').trim()

export function titleKey(title: string): TitleKey {
  const s = trim(title)
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

/** Индекс записей источников по обоим ключам */
export class TitleIndex<T extends { key: TitleKey }> {
  private byFull = new Map<string, T[]>()
  private byBase = new Map<string, T[]>()

  constructor(items: T[] = []) {
    for (const it of items) this.add(it)
  }

  add(it: T) {
    push(this.byFull, it.key.full, it)
    push(this.byBase, it.key.base, it)
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
  if (list) list.push(v)
  else map.set(k, [v])
}
