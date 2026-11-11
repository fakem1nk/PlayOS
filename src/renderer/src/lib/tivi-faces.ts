/**
 * Кадры Тиви: лица на светодиодной матрице 15×8 и пиксельные значки вокруг корпуса (zZ, «?», сердечки, искры),
 * а ещё уши — капсулы со светящейся «жидкостью» (программы ушей ниже, у каждой сценки своя).
 * Символы: # белый, h притушенный (сон), d тусклый, p розовый, b голубой, r красный, y жёлтый, v фиолетовый (как искра логотипа), w он же тусклый,
 * g серый металл.
 * Строки 0–3 — глаза, 5–7 — рот. Движений-переходов нет: экран просто сменяет кадры.
 */

/** Рывок всем телом: вздрогнуть, подпрыгнуть, потянуться вверх, помахать левым ухом */
export type TiviMove = 'shake' | 'hop' | 'stretch' | 'wave'
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
 * сдвиг корпуса в единицах образца
 */
export interface Pose {
  x?: number
  y?: number
}
/**
 * Ухо — окошко капсулы с «жидкостью»: v — уровень снизу (0…1), c — цвет, o — яркость; tilt — наклон поверхности (−1…1),
 * wave — рябь, over — второй слой поверх (румянец снизу вверх), bands — светящиеся полоски [низ, верх, цвет],
 * bubbles — пузырьки, drops — капли (x — сдвиг от середины, −1…1);
 * a — поворот самого уха в градусах сверх обычного наклона (плюс — в сторону и вниз, минус — торчком)
 */
export interface Ear {
  v: number
  c: string
  o: number
  tilt?: number
  wave?: number
  over?: { v: number; c: string }
  bands?: [number, number, string?][]
  bubbles?: { x: number; y: number; r: number }[]
  drops?: { x?: number; y: number; r?: number; c?: string }[]
  a?: number
}
export interface Ears {
  l: Ear
  r: Ear
  /** Ножки: на сколько единиц образца поднята каждая */
  feet?: { l: number; r: number }
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
  /** Уши прямо в кадре — у экранов обновления, которые рисуются в картинки; у остальных уши ведёт программа сценки */
  ears?: Ears
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
  // Установка: шестерёнки крутятся — зубцы то прямо, то наискось
  gearA: ['..g..', '.ggg.', 'gg.gg', '.ggg.', '..g..'],
  gearB: ['g...g', '.ggg.', '.g.g.', '.ggg.', 'g...g'],
  // Ночной колпак между антеннами: кончик с помпоном свисает вправо
  cap: ['......##', '.....v##', '....vv..', '...vvv..', '..vvvv..', '..vvvv..', '.######.']
} satisfies Record<string, string[]>
export type Sprite = keyof typeof SPRITES

/** Общая сетка времени: кадры лица, шаг взгляда, такт ушей и ножек, рывки тела — всё кратно 40 мс и попадает в один такт */
export const GRID_MS = 40
const onGrid = (ms: number) => (Number.isFinite(ms) ? Math.max(GRID_MS, Math.round(ms / GRID_MS) * GRID_MS) : ms)
const f = (face: Grid, ms: number, more?: Omit<Frame, 'face' | 'ms'>): Frame => ({ face, ms: onGrid(ms), ...more })
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
  wink: { intro: [f(winkHalf, 40), f(wink, 320), f(winkHalf, 40)] },
  laugh: { intro: [f(laugh, 140, { move: 'hop' }), f(laughShut, 110), f(laugh, 140), f(laughShut, 110), f(laugh, 180)] },
  tongue: { intro: [f(laugh, 80), f(tongue, 260), f(tongueR, 150), f(tongue, 150), f(tongueR, 150), f(tongue, 320)] },
  blush: { intro: [f(happy, 120)], loop: [f(blush, 1300)] },
  heart: { intro: [f(love, 120)], loop: hearts(love) },
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
  love: { intro: [f(lovePink, 150)], loop: hearts(lovePink) },
  sad: { intro: [f(sad, 300)], loop: [f(tear(4), 200), f(tear(5), 200), f(tear(6), 200), f(tear(7), 200), f(sad, 500)] },
  cry: { intro: [f(cry, 100, { move: 'shake' })], loop: [f(stream(4), 170), f(stream(5), 170)] },
  gloom: {
    intro: [f(gloom, 150, { fx: [fx('gloomS', 226, 56)] })],
    loop: [f(gloom, 1600, { fx: [fx('gloom', 226, 46)] })]
  },
  vr: { intro: [f(coolHalf, 80), f(cool, 1600)], outro: [f(coolHalf, 80)] },
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
  // Смотрит на правое ухо: там поднимается пузырь и вспыхивает
  antenna: { intro: [f(idle, 450, { gaze: { x: 2, y: -1 } }), f(idle, 1000, { gaze: { x: 2, y: -1 } }), f(happy, 650)] },
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
  drool: { intro: [f(drool, 700), f(dots(drool, [[6, 6, 'b']]), 500), f(dots(drool, [[6, 6, 'b'], [6, 7, 'b']]), 1500), f(wow, 220)] },
  // Переливает из уха в ухо и смотрит, куда течёт; газировка в ушах
  pour: { intro: [f(idle, 900, { gaze: { x: -2, y: 0 } }), f(idle, 900, { gaze: { x: 2, y: 0 } }), f(idle, 900, { gaze: { x: -2, y: 0 } }), f(idle, 500, { gaze: AHEAD })] },
  fizz: { intro: [f(happy, 2600)] },
  // Пришло уведомление: глянул вверх, уши мигнули; у геймпада садится заряд
  notice: { intro: [f(idle, 1000, { gaze: { x: 2, y: -1 } }), f(happy, 500)] },
  // Дёрнул правым ухом и покосился на него; навострил оба уха; потоптался на месте
  twitch: { intro: [f(idle, 420, { gaze: AHEAD }), f(idle, 700, { gaze: { x: 2, y: -1 } }), f(idle, 400, { gaze: AHEAD })] },
  perk: { intro: [f(idle, 500, { gaze: { x: 0, y: -1 } }), f(wow, 700), f(idle, 300)] },
  shuffle: { intro: [f(happy, 1500), f(idle, 200)] },
  lowbat: { intro: [f(sad, 300)], loop: [f(sad, 1200, { fx: [fx('gloomS', 226, 56)] })] }
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
  ['twitch', 5],
  ['perk', 3],
  ['shuffle', 3],
  ['antenna', 3],
  ['hum', 3],
  ['think', 2],
  ['wonder', 2],
  ['shades', 2],
  ['yawn', 2],
  ['tongue', 1],
  ['pong', 2],
  ['glitch', 1],
  ['pour', 2],
  ['fizz', 2]
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

// ---------- Уши: программы по сценкам ----------
const W = '#ffffff'
const V = '#a891ff'
const PINK = '#ff8ac6'
const BLUE = '#5aa9ff'
const RED = '#ff4b5c'
const YEL = '#ffd35c'
/** Такт ушей; плеск после рывка тела длится столько тактов */
export const EAR_TICK_MS = 80
export const SLOSH_TICKS = 9

const E = (v: number, c: string, more: Partial<Ear> = {}): Ear => ({ v, c, o: 1, ...more })
/** Покой: оба уха залиты полностью — левое белое (как был шарик антенны), правое фиолетовое (как искра) */
export const EARS_IDLE: Ears = { l: E(1, W), r: E(1, V) }
const both = (e: Ear): Ears => ({ l: e, r: { ...e } })
const lr = (v: number, more: Partial<Ear> = {}): Ears => ({ l: E(v, W, more), r: E(v, V, more) })
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const band = (pos: number, h = 0.2, c?: string): [number, number, string?] => [clamp01(pos), clamp01(pos + h), c]
const at = (list: number[], t: number) => list[Math.min(t, list.length - 1)]
/** 0…1 по косинусу: подъём и спад за period тактов */
const osc = (t: number, period: number) => 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / period)
const ripple = (t: number, a = 1.5) => (t % 2 ? a : -a)
// Сердцебиение: покой, удар, провал, второй удар, затухание (14 тактов)
const BEAT = [0.62, 1, 0.82, 0.97, 0.86, 0.78, 0.72, 0.68, 0.65, 0.63, 0.62, 0.62, 0.62, 0.62]
const beat = (t: number): Ears => both(E(BEAT[t % BEAT.length], PINK, { wave: t % BEAT.length < 5 ? ripple(t, 1.6) : 0 }))
/** Пузырьки поднимаются со дна, каждый по своей дорожке */
const bubbles = (t: number, n = 5, speed = 0.035) =>
  Array.from({ length: n }, (_, k) => ({ x: [-0.5, 0.35, -0.1, 0.55, -0.4, 0.15][k], y: (t * speed + k / n) % 1, r: [1.5, 2.1, 1.3, 1.8, 2.3, 1.6][k] }))
/** Загрузка через оба уха: сначала наливается левое, потом правое, поверхность рябит */
function progress(p: number, t: number): Ears {
  const a = Math.min(1, p / 50)
  const b = clamp01((p - 50) / 50)
  return { l: E(a, W, { wave: a < 1 ? ripple(t, 1.2) : 0 }), r: E(b, V, { wave: b > 0 && b < 1 ? ripple(t, 1.2) : 0 }) }
}
/** Очки: уши тонированы, раз в 2,4 с снизу вверх пробегает блик */
const glint = (t: number) => {
  const k = t % 40
  return lr(1, { c: V, o: 0.22, bands: k < 12 ? [band(-0.12 + (k / 12) * 1.05, 0.16, W)] : [] })
}
/** Жидкость перекатывается из уха в ухо */
const sway = (t: number, c1 = W, c2 = V): Ears => {
  const s = Math.sin(t * 0.5)
  return { l: E(0.62 + 0.38 * s, c1, { tilt: s * 0.8, wave: 1.2 }), r: E(0.62 - 0.38 * s, c2, { tilt: s * 0.8, wave: 1.2 }) }
}
const sleepy = (t: number) => lr(0.36 + 0.1 * osc(t, 50), { o: 0.7, wave: 0.5 })
const asleep = (t: number) => lr(0.22 + 0.1 * osc(t, 70), { o: 0.35 })

type EarProgram = (t: number, ctx: { loading: number | null }) => Ears
/** Уши каждой сценки; t — такт EAR_TICK_MS с начала сценки. Без своей программы — покой */
const EAR_PROGRAMS: Partial<Record<ScriptName | 'idle' | 'sleepy' | 'sleep' | 'load', EarProgram>> = {
  idle: () => EARS_IDLE,
  wink: (t) => ({ l: E(1, W), r: E(at([1, 0.7, 0.4, 0.15, 0.15, 0.15, 0.15, 0.4, 0.7, 1], t), V, { wave: t > 6 && t < 10 ? ripple(t) : 0 }) }),
  laugh: (t) => ({ l: E(0.8 + 0.12 * Math.sin(t * 0.9), W, { wave: ripple(t, 2.5) }), r: E(0.8 - 0.12 * Math.sin(t * 0.9), V, { wave: ripple(t + 1, 2.5) }) }),
  tongue: (t) => ({ l: E(1, W), r: E(1, V, { over: { v: 0.3 + 0.7 * osc(t, 12), c: PINK } }) }),
  blush: (t) => {
    const p = Math.min(1, t / 16)
    const more = { over: { v: p, c: PINK }, wave: p < 1 ? ripple(t, 1) : 0 }
    return { l: E(1, W, more), r: E(1, V, more) }
  },
  heart: beat,
  love: beat,
  pet: beat,
  cool: glint,
  vr: glint,
  shades: glint,
  wow: (t) => (t < 8 ? lr(t % 4 < 2 ? 1 : 0) : t < 14 ? lr(at([0.7, 0.85, 1], t - 8), { wave: ripple(t, 2) }) : EARS_IDLE),
  news: (t) => both(E(1, V, { bubbles: bubbles(t, 6, 0.045) })),
  sparkle: (t) => {
    const k = t % 16
    return k < 12 ? both(E((k + 1) / 12, YEL, { wave: ripple(k, 1.6) })) : both(E(1, k === 12 ? W : YEL))
  },
  dizzy: (t) => {
    const swap = Math.floor(t / 8) % 2
    const s = Math.sin(t * 0.7)
    return { l: E(0.7, swap ? V : W, { tilt: s, wave: 2 }), r: E(0.7, swap ? W : V, { tilt: -s, wave: 2 }) }
  },
  angry: (t) => both(E(0.86, RED, { o: t % 6 < 3 ? 1 : 0.65, wave: ripple(t, 3), bubbles: bubbles(t, 5, 0.08) })),
  frustrated: (t) => both(E(0.9, RED, { o: t % 4 < 2 ? 1 : 0.5, wave: ripple(t, 3.5), bubbles: bubbles(t, 6, 0.1) })),
  ko: (t) => {
    if (t < 10) return both(E(Math.max(0, 1 - t / 8), RED, { wave: ripple(t, 2) }))
    const p = (((t - 10) % 16) / 16) * 0.8
    return { l: E(0, V, { bands: [band(p)] }), r: E(0, V, { bands: [band(0.8 - p)] }) }
  },
  happy: (t) => {
    const v = at([0.7, 0.8, 0.92, 1, 1, 0.9, 0.84, 0.9, 1], t)
    return { l: E(v, W, { wave: t < 9 ? ripple(t, 2) : 0 }), r: E(v, V, { wave: t < 9 ? ripple(t + 1, 2) : 0 }) }
  },
  sad: (t) => both(E(Math.max(0.28, 1 - t / 28), BLUE, { wave: t % 4 < 2 ? 0.8 : -0.8 })),
  // Слёзы капают сверху и понемногу наполняют уши
  cry: (t) => {
    const lvl = Math.min(0.8, 0.2 + t / 90)
    const k = t % 12
    const y = 1 - (k / 12) * (1 - lvl)
    return both(E(lvl, BLUE, { wave: k === 0 ? 2 : k === 1 ? -1.5 : 0.6, drops: y > lvl + 0.05 ? [{ y }] : [] }))
  },
  gloom: (t) => ({ l: E(0.16, t % 20 < 10 ? RED : W, { o: 0.85 }), r: E(0.16, t % 20 < 10 ? RED : V, { o: 0.85 }) }),
  lowbat: (t) => {
    const c = t % 12 < 6 ? RED : '#4a1a20'
    return { l: E(0, W, { bands: [band(0, 0.15, c)] }), r: E(0, V, { bands: [band(0, 0.15, c)] }) }
  },
  wake: (t) => lr(at([0.15, 0.35, 0.6, 0.85, 1], t), { wave: t < 7 ? ripple(t, 2) : 0 }),
  wave: (t) => sway(t),
  morning: (t) => (t < 24 ? lr(Math.min(1, (t + 1) / 22), { wave: ripple(t, 1.2) }) : sway(t - 24)),
  missed: (t) => (t < 24 ? sway(t, PINK, PINK) : beat(t)),
  off: (t) => lr(Math.max(0, 1 - t / 5), { wave: ripple(t, 1.5) }),
  // Пузырь поднимается в правом ухе и вспыхивает
  antenna: (t) => ({ l: E(1, W), r: E(1, V, { bubbles: t < 20 ? [{ x: 0, y: t / 20, r: 3 }] : [], bands: t >= 20 && t < 24 ? [band(0, 1, W)] : [] }) }),
  hum: (t) => ({
    l: E(clamp01(0.55 + 0.25 * Math.sin(t * 0.55) + 0.18 * Math.sin(t * 1.3)), W, { wave: ripple(t) }),
    r: E(clamp01(0.55 + 0.25 * Math.sin(t * 0.55 + 2) + 0.18 * Math.sin(t * 1.1 + 1)), V, { wave: ripple(t + 1) })
  }),
  think: (t) => {
    const p = osc(t, 24) * 0.82
    return { l: E(0, W, { bands: [band(p, 0.18)] }), r: E(0, V, { bands: [band(0.82 - p, 0.18)] }) }
  },
  wonder: (t) => ({ l: E(0.15, W), r: E(t % 16 < 8 ? 1 : 0.15, V, { wave: t % 8 === 0 ? 2 : 0 }) }),
  yawn: (t) => lr(1 - 0.6 * Math.sin(Math.min(Math.PI, (t / 28) * Math.PI)), { wave: 0.6 }),
  stretch: (t) => lr(Math.min(1, 0.2 + t / 24), { wave: ripple(t, 1) }),
  pong: () => lr(1, { o: 0.35 }),
  glitch: (t) => {
    const k = t % 8
    return {
      l: k % 3 === 0 ? E(0, W, { bands: [band(0.4, 0.3)] }) : E(1, k % 2 ? V : W),
      r: k % 3 === 1 ? E(0, V, { bands: [band(0.1, 0.4)] }) : E(1, k % 2 ? W : V)
    }
  },
  nod: sleepy,
  sleepy,
  sleep: asleep,
  drool: (t) => {
    const ears = asleep(t)
    const k = t % 30
    ears.r.drops = k < 20 ? [{ y: 1 - (k / 20) * 0.7, r: 2.2, c: BLUE }] : []
    return ears
  },
  load: (t, ctx) => progress(ctx.loading ?? 0, t),
  pour: (t) => {
    const l = 0.5 + 0.5 * Math.cos((Math.PI * t) / 15)
    const tilt = Math.sin((Math.PI * t) / 15) * 0.9
    return { l: E(l, W, { tilt, wave: 1 }), r: E(1 - l, V, { tilt, wave: 1 }) }
  },
  fizz: (t) => ({ l: E(1, W, { bubbles: bubbles(t, 5, 0.04) }), r: E(1, V, { bubbles: bubbles(t + 7, 5, 0.04) }) }),
  notice: (t) => lr(1, { o: 0.3, bands: t < 16 && t % 8 < 3 ? [band(0.78, 0.22, W)] : [] }),
  twitch: () => EARS_IDLE,
  perk: () => EARS_IDLE,
  shuffle: () => EARS_IDLE
}
export type EarProgramName = keyof typeof EAR_PROGRAMS
/** Программы, которым такт не нужен — уши стоят */
export const STATIC_EARS = new Set<EarProgramName>(['idle', 'glance', 'pong'])

/** Какая программа ушей идёт: у сценки своя (если есть), иначе по состоянию — загрузка, дрёма, сон или покой */
export function earProgramOf(act: ScriptName | null, stage: 'awake' | 'drowsy' | 'sleep', loading: number | null): EarProgramName {
  if (act) return act in EAR_PROGRAMS ? act : 'idle'
  if (loading !== null) return 'load'
  return stage === 'sleep' ? 'sleep' : stage === 'drowsy' ? 'sleepy' : 'idle'
}

// ---------- Уши и ножки: движения по сценкам ----------
/** Куда повёрнуты уши (градусы сверх обычного наклона: плюс — в стороны и вниз, минус — торчком) и насколько подняты ножки */
interface Motion {
  l?: number
  r?: number
  fl?: number
  fr?: number
}
/** Значение из списка держится step тактов: движение идёт ступенями, как и всё у Тиви, — без плавных переходов */
const hold = (list: number[], t: number, step = 2, loop = true) => {
  const i = Math.floor(t / step)
  return loop ? list[i % list.length] : list[Math.min(i, list.length - 1)]
}
const ears2 = (a: number, b = a): Motion => ({ l: a, r: b })
/** Перетаптывается: ножки поднимаются по очереди */
const stomp = (t: number, h = 5, step = 3): Motion => ({ fl: hold([h, 0, 0, 0], t, step), fr: hold([0, 0, h, 0], t, step) })
/** Притопывает одной ножкой */
const tap = (t: number, h = 4, step = 3): Motion => ({ fr: hold([h, 0, h, 0, 0, 0], t, step) })
const DROOP = [5, 10, 15, 19, 22]
const MOTIONS: Partial<Record<EarProgramName, (t: number) => Motion>> = {
  // На клик
  wink: (t) => ({ r: hold([0, 12, 16, 16, 12, 0], t, 2, false) }),
  laugh: (t) => ({ ...ears2(hold([-6, 4], t)), fl: hold([4, 0], t, 2), fr: hold([4, 0], t, 2) }),
  tongue: (t) => ears2(hold([6, 0, -4, 0], t, 3), hold([-4, 0, 6, 0], t, 3)),
  blush: (t) => ears2(hold([4, 8, 12, 14], t, 3, false)),
  heart: (t) => ears2(hold([-5, 3, 0, 0], t, 3), hold([0, 0, -5, 3], t, 3)),
  cool: (t) => ears2(hold([-10, -6], t, 3, false)),
  wow: (t) => ears2(hold([-14, -14, -10, -6, 0], t, 3, false)),
  sparkle: (t) => ({ ...ears2(hold([-8, 4], t), hold([4, -8], t)), ...stomp(t, 5, 2) }),
  dizzy: (t) => ({ ...ears2(hold([10, 4, -6, 4], t, 3), hold([-6, 4, 10, 4], t, 3)), ...stomp(t, 3, 4) }),
  angry: (t) => ({ ...ears2(hold([-10, -8], t)), fr: hold([6, 0, 0], t, 2) }),
  frustrated: (t) => ({ ...ears2(hold([-12, -9], t, 1)), fl: hold([6, 0, 0, 0], t, 2), fr: hold([0, 0, 6, 0], t, 2) }),
  ko: (t) => ears2(hold([8, 16, 24, 30], t, 2, false)),
  // Система
  happy: (t) => (t < 16 ? { ...ears2(hold([-8, 4], t)), ...stomp(t, 5, 2) } : {}),
  news: (t) => (t < 8 ? ears2(-12) : ears2(hold([-6, 3], t, 3), hold([3, -6], t, 3))),
  love: (t) => ears2(hold([-5, 3, 0, 0], t, 3), hold([0, 0, -5, 3], t, 3)),
  pet: (t) => ears2(hold([14, 18], t, 4)),
  sad: (t) => ears2(hold(DROOP, t, 4, false)),
  cry: (t) => ears2(22 + hold([0, 3], t, 2)),
  gloom: () => ears2(24),
  lowbat: () => ears2(18),
  vr: () => ears2(-8),
  wake: (t) => ears2(hold([22, 10, -12, -8, 0], t, 3, false)),
  wave: (t) => ({ r: hold([-6, 0], t, 4) }),
  morning: (t) => (t < 24 ? ears2(hold([6, 12, 16, 16, 10, 0], t, 4, false)) : { r: hold([-6, 0], t, 4) }),
  missed: (t) => ({ ...ears2(hold([-8, 4], t), hold([4, -8], t)), ...stomp(t, 5, 2) }),
  off: (t) => ears2(hold([6, 14, 22, 28], t, 2, false)),
  // Сам по себе
  antenna: (t) => ({ r: t < 20 ? hold([0, 0, 0, 3], t, 2) : hold([-14, -8, 0], t - 20, 2, false) }),
  hum: (t) => ({ ...ears2(hold([6, 0, -6, 0], t, 4), hold([-6, 0, 6, 0], t, 4)), ...tap(t, 4, 4) }),
  shades: () => ears2(-8),
  think: (t) => ({ l: -10, r: 8, ...tap(t, 3, 5) }),
  wonder: (t) => ears2(hold([-12, 6], t, 8), hold([6, -12], t, 8)),
  yawn: (t) => ears2(hold([0, -6, -12, -12, -12, -6, 6, 10], t, 4, false)),
  stretch: (t) => ears2(hold([6, 12, 16, 16, 10, 0], t, 4, false)),
  glitch: (t) => ears2(hold([0, 14, -10, 6, 0], t, 2, false), hold([-10, 0, 14, -6, 0], t, 2, false)),
  nod: (t) => ears2(12 + hold([0, 2], t, 12)),
  sleepy: (t) => ears2(12 + hold([0, 2], t, 12)),
  sleep: (t) => ears2(24 + hold([0, 2], t, 18)),
  drool: (t) => ears2(24 + hold([0, 2], t, 18)),
  load: (t) => tap(t, 4, 5),
  pour: (t) => {
    const k = Math.round(Math.sin((Math.PI * t) / 15) * 3) * 4
    return { l: -k, r: k }
  },
  fizz: (t) => ears2(hold([0, -3, 0, 3], t, 2), hold([3, 0, -3, 0], t, 2)),
  notice: (t) => ears2(hold([-12, -12, -8, 0], t, 3, false)),
  // Свои маленькие дела: дёрнул ухом, навострил оба, потоптался
  twitch: (t) => ({ r: hold([0, 0, 0, -14, 4, -10, 0, 0, 0, 0, -12, 0], t, 2, false) }),
  perk: (t) => ears2(hold([-6, -12, -14, -14, -14, -14, -8, 0], t, 3, false)),
  shuffle: (t) => ({ ...stomp(t, 5, 3), ...ears2(hold([3, 0, -3, 0], t, 3)) })
}
const moved = (e: Ears, m?: Motion): Ears =>
  m ? { l: m.l ? { ...e.l, a: m.l } : e.l, r: m.r ? { ...e.r, a: m.r } : e.r, ...(m.fl || m.fr ? { feet: { l: m.fl ?? 0, r: m.fr ?? 0 } } : {}) } : e
/** Уши и ножки прямо в кадре — для экранов обновления, где программы не идут */
const posed = (e: Ears, m: Motion): Ears => moved({ l: { ...e.l }, r: { ...e.r } }, m)
export const earsOf = (name: EarProgramName, t: number, ctx: { loading: number | null }) =>
  moved((EAR_PROGRAMS[name] ?? EAR_PROGRAMS.idle!)(t, ctx), MOTIONS[name]?.(t))

/** Встряхнули (прыжок, рывок, потягивание, взмах): жидкость плещется и успокаивается; k — такт с рывка */
export function sloshed(ears: Ears, k: number, kind: TiviMove): Ears {
  const amp = 1 - k / SLOSH_TICKS
  const sgn = k % 2 ? 1 : -1
  const s = kind === 'shake' ? 1 : 0.6
  const wob = (e: Ear): Ear =>
    e.v > 0 && !e.bands?.length ? { ...e, v: Math.min(e.v, 1 - 0.16 * amp), tilt: (e.tilt ?? 0) + sgn * amp * s, wave: (e.wave ?? 0) + sgn * amp * 2 } : e
  const flap = kind === 'hop' ? hold([-12, -12, -12, 8, 8, 4, 0], k, 1, false) : kind === 'shake' ? Math.round(sgn * amp * 8) : kind === 'stretch' ? hold([-6, -10, -10, -10, -10, -10, -10, -6, 0], k, 1, false) : 0
  const tuck = kind === 'hop' ? hold([6, 9, 9, 6, 6, 0], k, 1, false) : 0
  const ear = (e: Ear, own: number): Ear => (flap ? { ...wob(e), a: (e.a ?? 0) + own } : wob(e))
  const feet = tuck ? { l: tuck, r: tuck } : ears.feet
  return { l: ear(ears.l, flap), r: ear(ears.r, kind === 'shake' ? -flap : flap), ...(feet ? { feet } : {}) }
}

// Экран прорисовывается заново: сверху вниз бежит тусклая строка развёртки, за ней — спокойное лицо; уши наливаются вместе с ней
const SCAN_IN = Array.from({ length: ROWS }, (_, k) =>
  f(idle.map((r, y) => (y < k ? r : y === k ? 'd'.repeat(COLS) : BLANK[0])), 45, { ears: lr((k + 1) / ROWS) })
)
const BLINK_IDLE = [f(rows(idle, { 1: BLANK[0] }), 40), f(rows(idle, { 1: BLANK[0], 2: BLANK[0] }), 90), f(rows(idle, { 1: BLANK[0] }), 40)]
/** Перезагрузка: по ушам бегает светлая полоска — в левом вверх, в правом вниз */
const spinEars = (k: number): Ears => ({ l: E(0, V, { bands: [band((k % 5) / 5)] }), r: E(0, V, { bands: [band((4 - (k % 5)) / 5)] }) })
const withEars = (frames: Frame[], ears: Ears) => frames.map((fr) => ({ ...fr, ears }))

/** Удивился и подпрыгнул: прыжок как в tivi-hop (для экранов обновления) */
const HOORAY: Frame[] = [
  f(wow, 80, { pose: { y: -2.2 } }),
  f(wow, 120, { pose: { y: -4.4 } }),
  f(wow, 80, { pose: { y: -2.2 } }),
  f(wow, 80, { pose: { y: 0.65 } }),
  f(wow, 160)
]

/** Прыжок от радости по кадрам HOORAY: уши торчком, ножки поджаты, на приземлении уши хлопают */
const HOORAY_MOVES: Motion[] = [{ l: -12, r: -12, fl: 6, fr: 6 }, { l: -12, r: -12, fl: 9, fr: 9 }, { l: -6, r: -6, fl: 6, fr: 6 }, { l: 8, r: 8 }, { l: 3, r: 3 }]
/** Пляшет: уши машут по очереди, ножки перебирают */
const DANCE: Motion[] = [{ l: -8, r: 4, fl: 5 }, { l: 4, r: -8, fr: 5 }]

/**
 * Экран установки обновления — сценка по кругу (~8 с), всё движение задано в кадрах (уши тоже):
 * по правому уху сверху сползает светлая полоска, и полоска во рту вместе с ушами наливается фиолетовым;
 * потом Тиви, зажмурившись и дрожа, втягивает её, уши пустеют, крутятся шестерёнки, капает пот — хлоп! — подпрыгивает от радости;
 * перезагружается спиннером, экран прорисовывается строка за строкой, моргает — и ловит следующий кусок
 */
const INSTALL_PULL: Frame[] = (() => {
  const EYE = '...##.....##...'
  /** Глаза-столбики, сдвинутые на dx, dy (вверх — минус), и рот — полоска из 11 клеток в строках 5–6 */
  const face = (dx: number, dy: number, n: number, lit = 0): Grid => {
    const bar = '..' + Array.from({ length: 11 }, (_, i) => (i < n - lit ? 'v' : i < n ? '#' : 'd')).join('') + '..'
    const top = shift(BLANK.slice(0, 5).map((r, y) => (y >= 1 + dy && y <= 3 + dy ? EYE : r)), dx)
    return [...top, bar, bar, BLANK[0]]
  }
  const level = (n: number) => E(n / 11, V)
  // Кусочек сползает по правому уху, левое держит то, что уже набралось
  const part = (from: number, to: number): Frame[] => [
    ...[4, 3, 2, 1].map((k, i) => f(face(1, i < 3 ? -1 : 0, from), 90, { ears: posed({ l: level(from), r: E(0, V, { bands: [band(k / 5)] }) }, { r: [-12, -8, -4, 0][i] }) })),
    f(face(0, 0, to, to - from), 110, { ears: both(level(to)) }),
    f(face(0, 0, to), 300, { ears: both(level(to)) })
  ]
  // Втягивает полоску к середине — уши пустеют; пот стекает по краю экрана, корпус дрожит, шестерёнки крутятся навстречу
  const squeeze = (w: number, sweat: number): Grid => {
    const pad = '.'.repeat((COLS - w) / 2)
    const row = pad + 'v'.repeat(w) + pad
    return dots([...SQUINT_EYES, BLANK[0], row, row, BLANK[0]], sweat < 4 ? [[14, sweat, 'b']] : [])
  }
  const work = [11, 9, 7, 5, 3, 1].flatMap((w, i) =>
    [0, 1].map((j) =>
      f(squeeze(w, i), 80, {
        pose: { x: j ? 1.5 : -1.5 },
        ears: posed(both(E(w / 11, W)), { l: j ? 8 : -4, r: j ? -4 : 8, fl: j ? 5 : 0, fr: j ? 0 : 5 }),
        fx: [fx(j ? 'gearB' : 'gearA', 40, 48), fx(j ? 'gearA' : 'gearB', 230, 54)]
      })
    )
  )
  const flare = dots([...SQUINT_EYES, ...BLANK.slice(4)], [[7, 5, '#'], [7, 6, '#']])
  // Хлоп: от рта расходится кольцо, уши вспыхивают
  const burst = (r: number): Grid =>
    BLANK.map((row, y) =>
      [...row]
        .map((_, x) => {
          const d = Math.round(Math.hypot(x - 7, (y - 5.5) * 1.4))
          return d === r ? '#' : d === r - 1 ? 'v' : '.'
        })
        .join('')
    )
  return [
    ...part(0, 4),
    ...part(4, 8),
    ...part(8, 11).slice(0, -1),
    f(face(0, 0, 11, 11), 120, { ears: both(level(11)) }),
    f(face(0, 0, 11), 220, { ears: both(level(11)) }),
    ...work,
    f(flare, 120, { ears: both(E(0, W)) }),
    ...[1, 2, 3, 4].map((r) => f(burst(r), 50, { ears: both(E(1, W)) })),
    ...HOORAY.map((h, i) => ({ ...h, ears: posed(EARS_IDLE, HOORAY_MOVES[i]) })),
    ...SPARKLE.map((fr, i) => ({ ...fr, ears: posed(both(E(1, YEL)), DANCE[i % DANCE.length]) })),
    f(happy, 300, { ears: EARS_IDLE }),
    f(STATIC[0], 50, { ears: lr(0.5) }),
    f(STATIC[2], 50, { ears: lr(0) }),
    f(BLANK, 160, { ears: lr(0) }),
    ...[1, 2].flatMap(() => SPIN.map((s, k) => f(s, SPIN_MS, { ears: spinEars(k) }))),
    ...SPIN_END.map((fr) => ({ ...fr, ears: lr(fr.face === BLANK ? 0 : 1) })),
    ...SCAN_IN,
    f(idle, 350, { ears: EARS_IDLE }),
    ...withEars(BLINK_IDLE, EARS_IDLE),
    f(idle, 600, { ears: EARS_IDLE })
  ]
})()

/**
 * Вторая сценка установки, идёт в очередь с первой, чтобы круг не повторялся подряд: из правого уха в экран падают
 * кусочки и складываются в нижний ряд — глаза следят за каждым, ножка притопывает, ухо пустеет; ряд собран — вспыхивает,
 * Тиви подпрыгивает, и ухо наливается заново
 */
const INSTALL_STACK: Frame[] = (() => {
  const EYE = '...##.....##...'
  const PIECES = 5
  const W3 = COLS / PIECES
  /** done — сколько кусочков уже лежит; падающий — в строке row (или нет, если row < 0); глаза смотрят на него */
  const face = (done: number, k: number, row: number, lit = false): Grid => {
    const look = k < 2 ? -1 : k > 2 ? 1 : 0
    const top = shift(BLANK.slice(0, 4).map((r, y) => (y < 3 ? EYE : r)), look)
    const cells: [number, number, string][] = []
    for (let i = 0; i < done; i++) for (let x = 0; x < W3; x++) cells.push([i * W3 + x, 7, lit ? '#' : 'v'])
    if (row >= 0) for (let x = 0; x < W3; x++) cells.push([k * W3 + x, row, '#'])
    return dots([...top, ...BLANK.slice(4)], cells)
  }
  const ears = (done: number, more: Motion = {}): Ears => posed({ l: E(1, W), r: E(1 - done / PIECES, V, { wave: 1 }) }, more)
  const drop = (k: number): Frame[] => [
    f(face(k, k, 4), 120, { ears: ears(k + 1, { r: -12, fr: 5 }) }),
    f(face(k, k, 5), 120, { ears: ears(k + 1, { r: -6 }) }),
    f(face(k, k, 6), 120, { ears: ears(k + 1, { fr: 5 }) }),
    f(face(k + 1, k, -1, false), 160, { ears: ears(k + 1) })
  ]
  return [
    f(face(0, 2, -1), 240, { ears: ears(0) }),
    ...Array.from({ length: PIECES }, (_, k) => drop(k)).flat(),
    ...[0, 1, 2, 3].map((i) => f(face(PIECES, 2, -1, i % 2 === 0), 80, { ears: posed(both(E(i % 2 ? 0 : 1, YEL)), { l: -10, r: -10 }) })),
    ...HOORAY.map((h, i) => ({ ...h, ears: posed(lr([0.25, 0.5, 0.75, 1, 1][i]), HOORAY_MOVES[i]) })),
    f(happy, 320, { ears: EARS_IDLE }),
    ...withEars(BLINK_IDLE, EARS_IDLE),
    f(idle, 400, { ears: EARS_IDLE })
  ]
})()
export const INSTALL: Frame[] = [...INSTALL_PULL, ...INSTALL_STACK]

/**
 * Первый запуск после обновления, до интро: тот же экран, что держала заставка установки. Помеха — бублик доделывает
 * круг и мигает, экран спокойно прорисовывает лицо, Тиви моргает, улыбается (тут надпись сменяется на «установлен»),
 * радостно подпрыгивает, жмурится и гаснет, как кинескоп, — уши пустеют вместе с экраном, дальше интро.
 * INSTALLED_AT — с какого кадра «готово»
 */
const happyShut = rows(happy, { 1: BLANK[0], 2: BLANK[0] })
export const INSTALLED: Frame[] = [
  f(STATIC[0], 50, { ears: lr(0.5) }),
  f(STATIC[2], 50, { ears: lr(0) }),
  ...SPIN.map((s, k) => f(s, SPIN_MS, { ears: spinEars(k) })),
  ...SPIN_END.map((fr) => ({ ...fr, ears: lr(fr.face === BLANK ? 0 : 1) })),
  ...SCAN_IN,
  f(idle, 450, { ears: EARS_IDLE }),
  ...withEars(BLINK_IDLE, EARS_IDLE),
  f(idle, 250, { ears: EARS_IDLE }),
  f(happy, 500, { ears: EARS_IDLE }),
  ...HOORAY.map((h, i) => ({ ...h, face: happyOpen, ears: posed(EARS_IDLE, HOORAY_MOVES[i]) })),
  ...[...SPARKLE, ...SPARKLE].map((fr, i) => ({ ...fr, ears: posed(both(E(1, YEL)), DANCE[i % DANCE.length]) })),
  f(happy, 600, { ears: EARS_IDLE }),
  f(happyShut, 400, { ears: posed(EARS_IDLE, { l: 8, r: 8 }) }),
  ...CRT.map((c, i) => f(c, i ? 70 : 60, { ears: posed(lr([0.7, 0.4, 0.15, 0][i]), { l: [12, 18, 24, 28][i], r: [12, 18, 24, 28][i] }) })),
  f(BLANK, 350, { ears: posed(lr(0), { l: 28, r: 28 }) })
]
export const INSTALLED_AT = INSTALLED.findIndex((fr) => fr.face === happy)

/**
 * Конец интро (TiviCameo): пока корпус прорисовывается, экран пуст; потом на нём загораются точки лица — туда
 * слетаются символы названия, — уши наливаются, Тиви моргает и подпрыгивает. Последний кадр держится, пока под ним
 * не покажется настоящий Тиви
 */
export const ARRIVE: Frame[] = (() => {
  const lit: [number, number, string][] = []
  idle.forEach((row, y) => [...row].forEach((ch, x) => ch !== '.' && lit.push([x, y, ch])))
  // Порядок загорания — вперемешку, но одинаковый при каждом запуске
  lit.sort((a, b) => ((a[0] * 7 + a[1] * 13) % 11) - ((b[0] * 7 + b[1] * 13) % 11))
  const STEPS = 6
  return [
    f(BLANK, 480, { ears: lr(0) }),
    ...Array.from({ length: STEPS }, (_, k) => f(dots(BLANK, lit.slice(0, Math.ceil((lit.length * (k + 1)) / STEPS))), 80, { ears: lr(0) })),
    ...[0.25, 0.5, 0.75, 1].map((v) => f(idle, 80, { ears: posed(lr(v, { wave: 1.2 }), { l: -8, r: -8 }) })),
    f(idle, 160, { ears: EARS_IDLE }),
    ...withEars(BLINK_IDLE, EARS_IDLE),
    f(happy, 160, { ears: EARS_IDLE }),
    ...HOORAY.map((h, i) => ({ ...h, face: happyOpen, ears: posed(EARS_IDLE, HOORAY_MOVES[i]) })),
    f(happy, 400, { ears: EARS_IDLE }),
    f(idle, 60_000, { ears: EARS_IDLE })
  ]
})()

/** Начало аутро (TiviCameo): зевает, уши опускаются и пустеют, экран гаснет, как кинескоп, — раньше, чем весь экран */
export const LEAVE: Frame[] = [
  f(idle, 120, { ears: EARS_IDLE }),
  f(yawn2, 200, { ears: posed(EARS_IDLE, { l: -8, r: -8 }) }),
  f(yawn3, 360, { ears: posed(EARS_IDLE, { l: -12, r: -12 }) }),
  f(yawn2, 120, { ears: posed(lr(0.8), { l: 6, r: 6 }) }),
  f(drowsy, 160, { ears: posed(lr(0.6), { l: 12, r: 12 }) }),
  ...CRT.map((c, i) => f(c, 80, { ears: posed(lr([0.45, 0.3, 0.15, 0][i] ?? 0), { l: [16, 20, 24, 28][i] ?? 28, r: [16, 20, 24, 28][i] ?? 28 }) })),
  f(BLANK, 60_000, { ears: posed(lr(0), { l: 28, r: 28 }) })
]
