/**
 * Кадры Тиви: лица на светодиодной матрице 15×8 и пиксельные значки вокруг корпуса (zZ, «?», сердечки, искры).
 * Символы: # белый, h притушенный (сон), d тусклый, p розовый, b голубой, r красный, y жёлтый, v фиолетовый (как искра логотипа).
 * Строки 0–3 — глаза, 5–7 — рот. Движений-переходов нет: экран просто сменяет кадры.
 */

/** Рывок всем телом: вздрогнуть, подпрыгнуть, искра на антенне блеснёт */
export type TiviMove = 'shake' | 'hop' | 'twinkle'
export type Grid = readonly string[]
export interface Gaze {
  x: number
  y: number
}
export interface Fx {
  s: Sprite
  x: number
  y: number
}
export interface Frame {
  face: Grid
  ms: number
  /** Значки вокруг корпуса, координаты в единицах образца 256 */
  fx?: Fx[]
  /** Куда смотреть в этом кадре (только у простых лиц) */
  gaze?: Gaze
  move?: TiviMove
}
/** Сценка: вступление, петля (повторяется до срока) и концовка */
export interface Script {
  intro?: Frame[]
  loop?: Frame[]
  outro?: Frame[]
}

export const COLORS: Record<string, [string, number]> = {
  '#': ['#ffffff', 1],
  d: ['#ffffff', 0.32],
  h: ['#ffffff', 0.55],
  p: ['#ff8ac6', 1],
  b: ['#5aa9ff', 1],
  r: ['#ff4b5c', 1],
  y: ['#ffd35c', 1],
  v: ['#a891ff', 1]
}

export const COLS = 15
export const ROWS = 8

const BLANK: Grid = Array(ROWS).fill('.'.repeat(COLS))

/** Лицо с заменёнными строками */
const rows = (face: Grid, patch: Record<number, string>): Grid => face.map((r, y) => patch[y] ?? r)
/** Лицо с добавленными точками */
const dots = (face: Grid, list: [number, number, string][]): Grid => {
  const out = face.map((r) => [...r])
  for (const [x, y, c] of list) if (out[y] && x >= 0 && x < COLS) out[y][x] = c
  return out.map((r) => r.join(''))
}
/** Сдвиг лица вбок — помеха на экране */
const shift = (face: Grid, dx: number): Grid =>
  face.map((r) => (dx > 0 ? '.'.repeat(dx) + r.slice(0, COLS - dx) : r.slice(-dx) + '.'.repeat(-dx)))
/** Рябь: случайные точки, но одинаковые при каждом запуске */
const noise = (seed: number): Grid => {
  let s = seed
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647
  return Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => {
      const r = rnd()
      return r < 0.2 ? '#' : r < 0.45 ? 'd' : '.'
    }).join('')
  )
}

const idle: Grid = [
  '...............',
  '...##.....##...',
  '...##.....##...',
  '...##.....##...',
  '...............',
  '.....#...#.....',
  '......###......',
  '...............'
]
const neutral = rows(idle, { 5: '...............', 6: '.....#####.....' })
const drowsy: Grid = [
  '...............',
  '...............',
  '..####...####..',
  '...##.....##...',
  '...............',
  '...............',
  '......###......',
  '...............'
]
const HAPPY_EYES = ['...............', '....#.....#....', '...#.#...#.#...', '..#...#.#...#..']
const SQUINT_EYES = ['...............', '..#.........#..', '...##.....##...', '..#.........#..']
const happy: Grid = [...HAPPY_EYES, '...............', '.....#...#.....', '......###......', '...............']
const happyOpen: Grid = [...HAPPY_EYES, '...............', '.....#####.....', '.....#...#.....', '......###......']
const blush: Grid = rows(happy, { 4: '.pp.........pp.' })
const laugh: Grid = [...SQUINT_EYES, '...............', '.....#####.....', '.....#...#.....', '......###......']
const laughShut: Grid = [...SQUINT_EYES, '...............', '....#.....#....', '.....#####.....', '...............']
const tongue: Grid = [...SQUINT_EYES, '...............', '.....#####.....', '......ppp......', '.......p.......']
const tongueR = rows(tongue, { 6: '.......ppp.....', 7: '........p......' })
const frustrated: Grid = [...SQUINT_EYES, '...............', '.......#.......', '......#.#......', '.....#####.....']
const winkHalf = rows(idle, { 1: '...##..........' })
const wink: Grid = rows(idle, { 1: '...##..........', 3: '...##....#..#..', 5: '....#.....#....', 6: '.....#####.....' })
const wow: Grid = [
  '...##.....##...',
  '..#..#...#..#..',
  '..#..#...#..#..',
  '...##.....##...',
  '...............',
  '......###......',
  '......#.#......',
  '......###......'
]
const LOVE_EYES = ['.##.##...##.##.', '.#####...#####.', '..###.....###..', '...#.......#...']
const love: Grid = [...LOVE_EYES, '...............', '.....#...#.....', '......###......', '...............']
const lovePink = love.map((r, y) => (y < 4 ? r.replaceAll('#', 'p') : r))
const cool: Grid = rows(idle, { 1: '.#############.', 2: '..#d##...#d##..', 3: '...##.....##...' })
const coolHalf: Grid = rows(idle, { 0: '.#############.', 1: '..####...####..' })
const sad: Grid = [
  '...............',
  '...............',
  '...##.....##...',
  '...##.....##...',
  '...............',
  '......###......',
  '.....#...#.....',
  '...............'
]
const cry: Grid = [...SQUINT_EYES, '...............', '......###......', '.....#...#.....', '...............']
const angry: Grid = [
  '..#.........#..',
  '...##.....##...',
  '...............',
  '...##.....##...',
  '...............',
  '......###......',
  '.....#...#.....',
  '...............'
]
const gloom: Grid = [
  '..#.#.....#.#..',
  '..#.#.....#.#..',
  '..#.#.....#.#..',
  '..#.#.....#.#..',
  '...............',
  '...............',
  '......###......',
  '...............'
]
const confused: Grid = [
  '...............',
  '...##....####..',
  '...##..........',
  '...##.....##...',
  '...............',
  '........##.....',
  '......##.......',
  '...............'
]
const sleep: Grid = [
  '...............',
  '...............',
  '...............',
  '..hhh.....hhh..',
  '...............',
  '......hhh......',
  '...............',
  '...............'
]
const drool: Grid = rows(sleep, { 2: '..hhh.....hhh..', 3: '...h.......h...' })
const hum: Grid = [
  '...............',
  '...............',
  '....#.....#....',
  '...#.#...#.#...',
  '...............',
  '.......#.......',
  '......#.#......',
  '.......#.......'
]
const humShut = rows(hum, { 5: '...............', 6: '......###......', 7: '...............' })
const yawn1 = rows(drowsy, { 5: '.......#.......', 6: '......#.#......', 7: '.......#.......' })
const SHUT = rows(BLANK, { 3: '..###.....###..' })
const yawn2 = rows(SHUT, { 5: '......###......', 6: '......#.#......', 7: '......###......' })
const yawn3 = rows(SHUT, { 5: '.....#####.....', 6: '.....#...#.....', 7: '.....#####.....' })
const xx: Grid = [
  '...............',
  '..#.#.....#.#..',
  '...#.......#...',
  '..#.#.....#.#..',
  '...............',
  '...............',
  '......###......',
  '...............'
]
const DOTS = [4, 7, 10].map((_, i, all) => dots(BLANK, all.slice(0, i + 1).map((x) => [x, 4, '#'] as [number, number, string])))
const STATIC = [noise(7), noise(4242), noise(91)]
// Выключение как у кинескопа: полоса, потом точка
const CRT = [
  rows(BLANK, { 3: '#'.repeat(COLS), 4: '#'.repeat(COLS) }),
  rows(BLANK, { 3: '...#########...', 4: '...#########...' }),
  rows(BLANK, { 3: '......###......' }),
  rows(BLANK, { 3: '.......#.......' })
]

// Головокружение: в глазах-кольцах бежит пропуск, рот ходит волной
const RING: [number, number][] = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1]]
const DIZZY = Array.from({ length: 8 }, (_, k) => {
  const ring = (ox: number, gap: number) => RING.filter((_, i) => i !== gap).map(([x, y]) => [ox + x, 1 + y, '#'] as [number, number, string])
  const wave = k % 4 < 2 ? { 5: '......#.#......', 6: '.....#.#.#.....' } : { 5: '.....#.#.#.....', 6: '......#.#......' }
  return dots(rows(BLANK, wave), [...ring(2, k), ...ring(10, (8 - k) % 8)])
})
// Загрузка: по кругу бежит яркая точка с тусклым хвостом
const SPIN_AT: [number, number][] = [[7, 1], [9, 2], [10, 4], [9, 6], [7, 7], [5, 6], [4, 4], [5, 2]]
const SPIN = SPIN_AT.map((_, k) =>
  dots(BLANK, [
    [...SPIN_AT[(k + 6) % 8], 'd'],
    [...SPIN_AT[(k + 7) % 8], 'd'],
    [...SPIN_AT[k], '#']
  ])
)

/** Лица, которые поворачиваются за взглядом и моргают */
export const FREE = new Set<Grid>([idle, neutral, drowsy])

export const SPRITES = {
  z: ['vvvv', '..v.', '.v..', 'vvvv'],
  Z: ['vvvvv', '...v.', '..v..', '.v...', 'vvvvv'],
  ask: ['.vvv.', 'v...v', '...v.', '..v..', '.....', '..v..'],
  anger: ['rr.rr', 'r...r', '.....', 'r...r', 'rr.rr'],
  angerS: ['r.r', '...', 'r.r'],
  gloom: ['v.v.v', 'v.v.v', 'v.v.v', 'v.v.v', '..v.v', '....v'],
  gloomS: ['v.v.v', 'v.v.v', '..v.v'],
  heart: ['pp.pp', 'ppppp', '.ppp.', '..p..'],
  heartS: ['p.p', 'ppp', '.p.'],
  spark: ['..y..', '.yyy.', 'yyyyy', '.yyy.', '..y..'],
  sparkS: ['.y.', 'yyy', '.y.'],
  note: ['..v.', '..vv', '..v.', 'vvv.', 'vv..']
} satisfies Record<string, string[]>
export type Sprite = keyof typeof SPRITES

const f = (face: Grid, ms: number, more?: Omit<Frame, 'face' | 'ms'>): Frame => ({ face, ms, ...more })
const fx = (s: Sprite, x: number, y: number): Fx => ({ s, x, y })
const LEFT_UP: Gaze = { x: -2, y: -1 }
const AHEAD: Gaze = { x: 0, y: 0 }

const SPARKLE: Frame[] = [
  f(happyOpen, 200, { fx: [fx('spark', 230, 46), fx('sparkS', 30, 58)] }),
  f(happyOpen, 200, { fx: [fx('sparkS', 234, 40), fx('spark', 32, 50)] })
]
const hearts = (face: Grid): Frame[] => [
  f(face, 190, { fx: [fx('heart', 228, 56)] }),
  f(face, 190, { fx: [fx('heart', 232, 42), fx('heartS', 40, 58)] }),
  f(face, 190, { fx: [fx('heartS', 236, 28), fx('heart', 36, 44)] }),
  f(face, 190, { fx: [fx('heart', 32, 30)] }),
  f(face, 190, { fx: [fx('heartS', 30, 18)] })
]
const tear = (y: number) => dots(sad, [[11, y, 'b']])
const stream = (from: number) => dots(cry, [4, 5, 6, 7].filter((y) => (y - from) % 2 === 0).flatMap((y) => [[3, y, 'b'], [11, y, 'b']] as [number, number, string][]))
const notes = (face: Grid, faceB: Grid): Frame[] => [
  f(face, 320, { fx: [fx('note', 226, 54)] }),
  f(faceB, 320, { fx: [fx('note', 230, 40)] }),
  f(face, 320, { fx: [fx('note', 234, 26), fx('note', 220, 56)] }),
  f(faceB, 320, { fx: [fx('note', 224, 42)] }),
  f(face, 320, { fx: [fx('note', 228, 28)] }),
  f(faceB, 320)
]
const ask = (face: Grid): Frame[] => [
  f(face, 160, { fx: [fx('ask', 230, 42)] }),
  f(face, 160, { fx: [fx('ask', 230, 34)] }),
  f(face, 1100, { fx: [fx('ask', 230, 26)] })
]

export const SCRIPTS = {
  // Ответы на клик
  wink: { intro: [f(winkHalf, 40), f(wink, 320, { move: 'twinkle' }), f(winkHalf, 40)] },
  laugh: { intro: [f(laugh, 140, { move: 'hop' }), f(laughShut, 110), f(laugh, 140), f(laughShut, 110), f(laugh, 180)] },
  tongue: { intro: [f(laugh, 80), f(tongue, 260), f(tongueR, 150), f(tongue, 150), f(tongueR, 150), f(tongue, 320)] },
  blush: { intro: [f(happy, 120)], loop: [f(blush, 1300)] },
  heart: { intro: [f(love, 120, { move: 'twinkle' })], loop: hearts(love) },
  cool: { intro: [f(coolHalf, 70), f(cool, 1500)], outro: [f(coolHalf, 70)] },
  wow: { intro: [f(wow, 650, { move: 'hop' })] },
  sparkle: { intro: [f(happy, 80, { move: 'hop' })], loop: SPARKLE },
  dizzy: { loop: DIZZY.map((d) => f(d, 75)) },
  angry: { intro: [f(angry, 80, { move: 'shake' })], loop: [f(angry, 230, { fx: [fx('anger', 226, 48)] }), f(angry, 230, { fx: [fx('angerS', 229, 51)] })] },
  frustrated: { intro: [f(frustrated, 80, { move: 'shake' })], loop: [f(frustrated, 230, { fx: [fx('anger', 226, 48)] }), f(frustrated, 230, { fx: [fx('angerS', 229, 51)] })] },
  ko: {
    intro: [f(STATIC[0], 50), f(STATIC[1], 50), f(xx, 1100, { move: 'shake' }), f(STATIC[2], 50), f(BLANK, 260)],
    loop: SPIN.map((s) => f(s, 85)),
    outro: [f(wow, 380)]
  },
  // Система
  happy: { intro: [f(happy, 900, { move: 'hop' })] },
  news: { intro: [f(wow, 500, { move: 'hop' })], loop: SPARKLE },
  love: { intro: [f(lovePink, 150, { move: 'twinkle' })], loop: hearts(lovePink) },
  sad: { intro: [f(sad, 300)], loop: [f(tear(4), 200), f(tear(5), 200), f(tear(6), 200), f(tear(7), 200), f(sad, 500)] },
  cry: { intro: [f(cry, 100, { move: 'shake' })], loop: [f(stream(4), 170), f(stream(5), 170)] },
  gloom: {
    intro: [f(gloom, 150, { fx: [fx('gloomS', 226, 56)] })],
    loop: [f(gloom, 1600, { fx: [fx('gloom', 226, 46)] })]
  },
  vr: { intro: [f(coolHalf, 80), f(cool, 1600, { move: 'twinkle' })], outro: [f(coolHalf, 80)] },
  wake: { intro: [f(wow, 450), f(idle, 60)] },
  off: { intro: [f(idle, 80), ...CRT.map((c, i) => f(c, i ? 70 : 60))], loop: [f(BLANK, 8000)] },
  // Сам по себе
  glance: {
    intro: [f(idle, 800, { gaze: LEFT_UP }), f(idle, 450, { gaze: AHEAD }), f(idle, 800, { gaze: { x: 1, y: -1 } }), f(idle, 350, { gaze: AHEAD })]
  },
  antenna: { intro: [f(idle, 450, { gaze: { x: 2, y: -1 } }), f(idle, 700, { gaze: { x: 2, y: -1 }, move: 'twinkle' }), f(happy, 650)] },
  hum: { loop: notes(hum, humShut) },
  shades: { intro: [f(coolHalf, 80), f(cool, 2400)], outro: [f(coolHalf, 80)] },
  think: { intro: [f(neutral, 500, { gaze: LEFT_UP })], loop: [f(DOTS[0], 260), f(DOTS[1], 260), f(DOTS[2], 520)], outro: [f(idle, 80)] },
  wonder: { intro: ask(confused) },
  yawn: { intro: [f(yawn1, 260), f(yawn2, 240), f(yawn3, 950), f(yawn2, 200), f(drowsy, 350)] },
  glitch: { intro: [f(STATIC[0], 50), f(shift(idle, 2), 70), f(STATIC[2], 40), f(shift(idle, -1), 60), f(idle, 60)] },
  nod: { intro: [f(sleep, 1700), f(wow, 220, { move: 'shake' })] },
  drool: { intro: [f(drool, 700), f(dots(drool, [[6, 6, 'b']]), 500), f(dots(drool, [[6, 6, 'b'], [6, 7, 'b']]), 1500), f(wow, 220)] }
} satisfies Record<string, Script>
export type ScriptName = keyof typeof SCRIPTS

/** Покой по стадиям бодрствования; во сне над корпусом всплывают zZ */
export const BASE: Record<'awake' | 'drowsy' | 'sleep', Script> = {
  awake: { loop: [f(idle, Infinity)] },
  drowsy: { loop: [f(drowsy, Infinity)] },
  sleep: {
    loop: [
      f(sleep, 500),
      f(sleep, 450, { fx: [fx('z', 228, 56)] }),
      f(sleep, 450, { fx: [fx('z', 232, 44)] }),
      f(sleep, 450, { fx: [fx('z', 236, 32), fx('Z', 222, 52)] }),
      f(sleep, 450, { fx: [fx('Z', 226, 38)] }),
      f(sleep, 450, { fx: [fx('Z', 230, 24)] }),
      f(sleep, 900)
    ]
  }
}

/** Чем занять себя в покое (вес — как часто) */
export const IDLE_ACTS: [ScriptName, number][] = [
  ['glance', 5],
  ['antenna', 3],
  ['hum', 3],
  ['think', 2],
  ['wonder', 2],
  ['shades', 2],
  ['yawn', 2],
  ['tongue', 1],
  ['glitch', 1]
]
export const DROWSY_ACTS: [ScriptName, number][] = [
  ['nod', 3],
  ['drool', 2],
  ['yawn', 2]
]
/** На клик: каждый раз другое, без повторов подряд */
export const CLICK_ACTS: ScriptName[] = ['wink', 'laugh', 'tongue', 'blush', 'heart', 'cool', 'wow', 'sparkle']
