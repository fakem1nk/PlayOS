/**
 * Кадры Тиви: лица на светодиодной матрице 15×8 и пиксельные значки вокруг корпуса (zZ, «?», сердечки, искры).
 * Символы: # белый, h притушенный (сон), d тусклый, p розовый, b голубой, r красный, y жёлтый, v фиолетовый (как искра логотипа), w он же тусклый,
 * g серый металл (как антенны).
 * Строки 0–3 — глаза, 5–7 — рот. Движений-переходов нет: экран просто сменяет кадры.
 */

/** Рывок всем телом: вздрогнуть, подпрыгнуть, потянуться вверх, искра на антенне блеснёт, помахать антенной с шариком */
export type TiviMove = 'shake' | 'hop' | 'stretch' | 'twinkle' | 'wave'
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
/**
 * Положение тела прямо в кадре — для экрана установки, который потом рисуется в картинки (CSS-движения туда не попадут):
 * сдвиг корпуса в единицах образца, шаг вспышки искры (как в tivi-twinkle) и наклон левой антенны в градусах
 */
export interface Pose {
  x?: number
  y?: number
  spark?: number
  ant?: number
}
export interface Frame {
  face: Grid
  ms: number
  /** Значки вокруг корпуса, координаты в единицах образца 256 */
  fx?: Fx[]
  /** Куда смотреть в этом кадре (только у простых лиц) */
  gaze?: Gaze
  move?: TiviMove
  pose?: Pose
}
/** Сценка: вступление, петля (повторяется до срока) и концовка */
export interface Script {
  intro?: Frame[]
  loop?: Frame[]
  outro?: Frame[]
}

export const COLORS: Record<string, [string, number]> = {
  '#': ['#ffffff', 1],
  g: ['#c3cad8', 1],
  d: ['#ffffff', 0.32],
  w: ['#a891ff', 0.45],
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
// Потягивается: зажмурился, рот зевком
const stretchFace: Grid = [...SQUINT_EYES, '...............', '......###......', '......#.#......', '......###......']
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
/**
 * Загрузка (перезагрузка после нокаута и экран установки обновления): толстый бублик 8×8 на весь экран, по нему
 * бежит дуга — белая голова, фиолетовый хвост гаснет; внутренний ряд чуть обгоняет внешний, и дуга закручивается.
 * Круг за 16 кадров. Под конец весь бублик дважды мигает (SPIN_END)
 */
const DONUT: [number, number][] = ['..####..', '.######.', '###..###', '##....##', '##....##', '###..###', '.######.', '..####..'].flatMap((r, y) =>
  [...r].flatMap((c, x): [number, number][] => (c === '#' ? [[3 + x, y]] : []))
)
export const SPIN = Array.from({ length: 16 }, (_, k) =>
  dots(
    BLANK,
    DONUT.map(([x, y]): [number, number, string] => {
      const turn = Math.atan2(x - 6.5, 3.5 - y) / (2 * Math.PI)
      const inner = Math.hypot(x - 6.5, y - 3.5) < 2.9
      // На сколько шестнадцатых круга клетка отстала от головы дуги
      const back = Math.floor((((k + (inner ? 2 : 0)) / 16 - turn) % 1 + 2) % 1 * 16)
      return [x, y, '#vvww'[back] ?? 'd']
    })
  )
)
const SPIN_MS = 55
const DONUT_ON = dots(BLANK, DONUT.map(([x, y]) => [x, y, '#']))
const DONUT_V = dots(BLANK, DONUT.map(([x, y]) => [x, y, 'v']))

/**
 * Понг сам с собой: ракетки по краям ходят за мячом, посередине пунктир сетки. Пара отбоев, потом правая
 * ракетка зевает и пропускает — розыгрыш одинаковый при каждом запуске
 */
const PONG = (() => {
  const H = 3
  const out: Grid[] = []
  let bx = 7
  let by = 2
  let vx = 1
  let vy = 1
  let ly = 2
  let ry = 3
  let lazy = false
  const covers = (top: number, y: number) => y >= top && y < top + H
  const toward = (top: number, y: number) => Math.max(0, Math.min(ROWS - H, top + Math.sign(y - 1 - top)))
  const draw = (ball: boolean) => {
    const g = BLANK.map((r) => [...r])
    for (let y = 1; y < ROWS; y += 2) g[y][7] = 'd'
    for (let i = 0; i < H; i++) {
      g[ly + i][0] = '#'
      g[ry + i][COLS - 1] = '#'
    }
    if (ball) g[by][bx] = '#'
    return g.map((r) => r.join(''))
  }
  for (let k = 0; k < 80; k++) {
    out.push(draw(true))
    if (bx === 0 || bx === COLS - 1) break
    let ny = by + vy
    if (ny < 0 || ny >= ROWS) {
      vy = -vy
      ny = by + vy
    }
    let nx = bx + vx
    if (nx === 0 && covers(ly, ny)) {
      vx = 1
      nx = 2
      if (k > 20) lazy = true
    } else if (nx === COLS - 1 && covers(ry, ny)) {
      vx = -1
      nx = COLS - 3
    }
    if (vx < 0) ly = toward(ly, ny)
    else if (!lazy) ry = toward(ry, ny)
    bx = nx
    by = ny
  }
  return { frames: out, missed: draw(false) }
})()

/**
 * Полоска загрузки обновления вместо рта: глаза следят за её краем, а следующая клетка мигает — значит, идёт.
 * tick — фаза мигания
 */
export function loadFace(percent: number, tick: boolean): Grid {
  const n = Math.round((Math.max(0, Math.min(100, percent)) / 100) * 11)
  const bar = '..' + Array.from({ length: 11 }, (_, i) => (i < n || (i === n && tick) ? '#' : 'd')).join('') + '..'
  const eyes = shift(['...##.....##...', '...##.....##...'], Math.round((n / 11) * 4) - 2)
  return ['...............', '...............', ...eyes, '...............', bar, bar, '...............']
}

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
  note: ['..v.', '..vv', '..v.', 'vvv.', 'vv..'],
  // Установка: кусочек обновления ползёт по антенне, шестерёнки крутятся — зубцы то прямо, то наискось
  bit: ['vv', 'vv'],
  gearA: ['..g..', '.ggg.', 'gg.gg', '.ggg.', '..g..'],
  gearB: ['g...g', '.ggg.', '.g.g.', '.ggg.', 'g...g'],
  // Ночной колпак между антеннами: кончик с помпоном свисает вправо
  cap: ['......##', '.....v##', '....vv..', '...vvv..', '..vvvv..', '..vvvv..', '.######.']
} satisfies Record<string, string[]>
export type Sprite = keyof typeof SPRITES

const f = (face: Grid, ms: number, more?: Omit<Frame, 'face' | 'ms'>): Frame => ({ face, ms, ...more })
const fx = (s: Sprite, x: number, y: number): Fx => ({ s, x, y })
/** Конец загрузки: весь бублик дважды мигает — белый, фиолетовый, погас */
const SPIN_END: Frame[] = [1, 2].flatMap(() => [f(DONUT_ON, 90), f(DONUT_V, 90), f(BLANK, 110)])
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
const STRETCH: Frame[] = [f(drowsy, 300), f(stretchFace, 900, { move: 'stretch' }), f(happy, 600)]
const WAVE: Frame[] = [f(happyOpen, 450, { move: 'wave' }), f(happy, 600)]
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
    loop: SPIN.map((s) => f(s, SPIN_MS)),
    outro: [...SPIN_END, f(wow, 380)]
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
  // Приветствие: первый запуск за день — машет антенной, утром сперва потягивается; не виделись три дня — бурно радуется
  wave: { intro: WAVE },
  morning: { intro: [...STRETCH, ...WAVE] },
  missed: {
    intro: [f(wow, 450, { move: 'hop' }), f(laugh, 240, { move: 'hop' }), f(laughShut, 240), f(laugh, 240, { move: 'hop' }), f(laughShut, 240), ...WAVE],
    loop: hearts(love),
    outro: [f(happy, 500)]
  },
  // Гладят: зажали на нём и водят — жмурится, краснеет, вылетают сердечки
  pet: { intro: [f(blush, 100)], loop: hearts(blush) },
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
  stretch: { intro: STRETCH },
  pong: {
    intro: [f(idle, 450, { gaze: { x: -1, y: 1 } }), f(STATIC[1], 50), ...PONG.frames.map((g) => f(g, 75)), f(PONG.missed, 320), f(STATIC[2], 50), f(laugh, 240, { move: 'hop' }), f(laughShut, 200), f(laugh, 400)],
    outro: [f(STATIC[0], 50)]
  },
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
  ['pong', 2],
  ['glitch', 1]
]
/** Утром к своим делам добавляется потягивание */
export const MORNING_ACTS: [ScriptName, number][] = [['stretch', 3]]
export const DROWSY_ACTS: [ScriptName, number][] = [
  ['nod', 3],
  ['drool', 2],
  ['yawn', 2]
]
/** На клик: каждый раз другое, без повторов подряд */
export const CLICK_ACTS: ScriptName[] = ['wink', 'laugh', 'tongue', 'blush', 'heart', 'cool', 'wow', 'sparkle']

// Экран прорисовывается заново: сверху вниз бежит тусклая строка развёртки, за ней — спокойное лицо
const SCAN_IN = Array.from({ length: ROWS }, (_, k) => f(idle.map((r, y) => (y < k ? r : y === k ? 'd'.repeat(COLS) : BLANK[0])), 45))
const BLINK_IDLE = [f(rows(idle, { 1: BLANK[0] }), 40), f(rows(idle, { 1: BLANK[0], 2: BLANK[0] }), 90), f(rows(idle, { 1: BLANK[0] }), 40)]

/** Удивился и подпрыгнул: прыжок как в tivi-hop, левая антенна машет как в tivi-wave (для экранов обновления) */
const HOORAY: Frame[] = [
  f(wow, 80, { pose: { y: -2.2, ant: -24 } }),
  f(wow, 120, { pose: { y: -4.4, ant: 10 } }),
  f(wow, 80, { pose: { y: -2.2, ant: -24 } }),
  f(wow, 80, { pose: { y: 0.65, ant: 10 } }),
  f(wow, 160)
]

/**
 * Экран установки обновления — сценка по кругу (~8 с), всё движение задано в кадрах:
 * искра на антенне вспыхивает, по антенне в корпус сползают фиолетовые кусочки, и полоска во рту заполняется;
 * потом Тиви, зажмурившись и дрожа, втягивает её, крутятся шестерёнки, капает пот — хлоп! — подпрыгивает от радости;
 * перезагружается спиннером, экран прорисовывается строка за строкой, моргает — и ловит следующий кусок
 */
export const INSTALL: Frame[] = (() => {
  const EYE = '...##.....##...'
  /** Глаза-столбики, сдвинутые на dx, dy (вверх — минус), и рот — полоска из 11 клеток в строках 5–6 */
  const face = (dx: number, dy: number, n: number, lit = 0): Grid => {
    const bar = '..' + Array.from({ length: 11 }, (_, i) => (i < n - lit ? 'v' : i < n ? '#' : 'd')).join('') + '..'
    const top = shift(BLANK.slice(0, 5).map((r, y) => (y >= 1 + dy && y <= 3 + dy ? EYE : r)), dx)
    return [...top, bar, bar, BLANK[0]]
  }
  // Кусочек сползает по правой антенне от искры к корпусу
  const DROP: [number, number][] = [
    [165, 47],
    [156, 58],
    [147, 68]
  ]
  const part = (from: number, to: number): Frame[] => [
    f(face(1, -1, from), 90, { pose: { spark: 1 } }),
    f(face(1, -1, from), 90, { pose: { spark: 2 }, fx: [fx('bit', ...DROP[0])] }),
    f(face(1, -1, from), 90, { pose: { spark: 3 }, fx: [fx('bit', ...DROP[1])] }),
    f(face(1, 0, from), 90, { fx: [fx('bit', ...DROP[2])] }),
    f(face(0, 0, to, to - from), 110),
    f(face(0, 0, to), 300)
  ]
  // Втягивает полоску к середине; пот стекает по краю экрана, корпус дрожит, шестерёнки крутятся навстречу
  const squeeze = (w: number, sweat: number): Grid => {
    const pad = '.'.repeat((COLS - w) / 2)
    const row = pad + 'v'.repeat(w) + pad
    return dots([...SQUINT_EYES, BLANK[0], row, row, BLANK[0]], sweat < 4 ? [[14, sweat, 'b']] : [])
  }
  const work = [11, 9, 7, 5, 3, 1].flatMap((w, i) =>
    [0, 1].map((j) =>
      f(squeeze(w, i), 80, {
        pose: { x: j ? 1.5 : -1.5 },
        fx: [fx(j ? 'gearB' : 'gearA', 40, 48), fx(j ? 'gearA' : 'gearB', 230, 54)]
      })
    )
  )
  const flare = dots([...SQUINT_EYES, ...BLANK.slice(4)], [[7, 5, '#'], [7, 6, '#']])
  // Хлоп: от рта расходится кольцо
  const burst = (r: number): Grid =>
    BLANK.map((row, y) =>
      [...row]
        .map((_, x) => {
          const d = Math.round(Math.hypot(x - 7, (y - 5.5) * 1.4))
          return d === r ? '#' : d === r - 1 ? 'v' : '.'
        })
        .join('')
    )
  // Экран прорисовывается заново: сверху вниз бежит тусклая строка развёртки
  return [
    ...part(0, 4),
    ...part(4, 8),
    ...part(8, 11).slice(0, -1),
    f(face(0, 0, 11, 11), 120),
    f(face(0, 0, 11), 220),
    ...work,
    f(flare, 120),
    ...[1, 2, 3, 4].map((r) => f(burst(r), 50)),
    ...HOORAY,
    ...SPARKLE,
    f(happy, 300),
    f(STATIC[0], 50),
    f(STATIC[2], 50),
    f(BLANK, 160),
    ...[1, 2].flatMap(() => SPIN.map((s) => f(s, SPIN_MS))),
    ...SPIN_END,
    ...SCAN_IN,
    f(idle, 350),
    ...BLINK_IDLE,
    f(idle, 600)
  ]
})()

/**
 * Первый запуск после обновления, до интро: тот же экран, что держала заставка установки. Помеха — бублик доделывает
 * круг и мигает, экран спокойно прорисовывает лицо, Тиви моргает, улыбается (тут надпись сменяется на «установлен»),
 * радостно подпрыгивает, жмурится и гаснет, как кинескоп, — дальше интро. INSTALLED_AT — с какого кадра «готово»
 */
const happyHop: Frame[] = HOORAY.map((h) => ({ ...h, face: happyOpen }))
const happyShut = rows(happy, { 1: BLANK[0], 2: BLANK[0] })
export const INSTALLED: Frame[] = [
  f(STATIC[0], 50),
  f(STATIC[2], 50),
  ...SPIN.map((s) => f(s, SPIN_MS)),
  ...SPIN_END,
  ...SCAN_IN,
  f(idle, 450),
  ...BLINK_IDLE,
  f(idle, 250),
  f(happy, 500),
  ...happyHop,
  ...SPARKLE,
  ...SPARKLE,
  f(happy, 600),
  f(happyShut, 400),
  ...CRT.map((c, i) => f(c, i ? 70 : 60)),
  f(BLANK, 350)
]
export const INSTALLED_AT = INSTALLED.findIndex((fr) => fr.face === happy)
