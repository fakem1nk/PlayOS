import { memo, useEffect, useRef } from 'react'
import type { Holiday } from '../lib/festive'

/**
 * Праздничное оформление поверх фона, под интерфейсом — в том же стиле, что экран Тиви: всё из светящихся точек на
 * сетке и двигается ступенями, по такту. Один холст, такт 80 мс; пока окно скрыто, не рисуется.
 * Новый год: снег и крупные снежинки, гирлянда вдоль верхнего края, сугроб по нижнему, мерцающие звёзды, салюты
 * и изредка комета. Хэллоуин: луна, тлеющие искры, стайка летучих мышей, паутина в углу с пауком на нитке,
 * тыквы с огоньком внутри и привидение. 14 февраля: всплывающие сердечки.
 */

const TICK_MS = 80
const HEART = ['pp.pp', 'ppppp', '.ppp.', '..p..']
const HEART_S = ['p.p', 'ppp', '.p.']
const FLAKE = ['.#.', '###', '.#.']
const CRYSTAL = ['..#..', '#.#.#', '.###.', '#.#.#', '..#..']
const BAT = [
  ['#.....#', '##.#.##', '.#####.', '..#.#..'],
  ['.......', '.##.##.', '#######', '#.#.#.#']
]
const PUMPKIN = ['....n....', '..ooooo..', '.ooooooo.', 'ooeoooeoo', 'ooooooooo', 'ooeeeeeoo', '.ooooooo.']
const SPIDER = ['#.#.#', '.###.', '#####', '#.#.#']
const GHOST = ['.###.', '#####', '#.#.#', '#####', '#####', '#.#.#']
const BULBS = ['#ff4b5c', '#ffd35c', '#5aa9ff', '#ff8ac6', '#4be3a0']
const RING: [number, number][] = [[0, -1], [0.7, -0.7], [1, 0], [0.7, 0.7], [0, 1], [-0.7, 0.7], [-1, 0], [-0.7, -0.7], [0.38, -0.92], [0.92, 0.38], [-0.38, 0.92], [-0.92, -0.38]]

interface Bit {
  x: number
  y: number
  /** Тактов на один шаг вниз или вверх */
  slow: number
  a: number
  kind: number
  sway: number
}

/** «Случай», одинаковый при каждом запуске: картинка не прыгает при перерисовке */
const rnd = (seed: number) => {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}
/** Число 0…1 по номеру — для того, что появляется раз за разом в новых местах */
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

export const SeasonDecor = memo(function SeasonDecor({ holiday }: { holiday: Holiday }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let cols = 0
    let rows = 0
    let cell = 1
    let bits: Bit[] = []
    let stars: Bit[] = []
    let tick = 0
    const r = rnd(holiday.length * 977)

    const layout = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      canvas.width = Math.round(window.innerWidth * dpr)
      canvas.height = Math.round(window.innerHeight * dpr)
      // Клетка сетки — 1 rem (1/108 высоты экрана): мельче украшения терялись на фоне обложек
      cell = canvas.height / 108
      cols = Math.ceil(canvas.width / cell)
      rows = Math.ceil(canvas.height / cell)
      const make = (n: number, top = 1): Bit[] =>
        Array.from({ length: n }, () => ({
          x: Math.floor(r() * cols),
          y: Math.floor(r() * rows * top),
          slow: 2 + Math.floor(r() * 4),
          a: 0.12 + r() * 0.3,
          kind: Math.floor(r() * 8),
          sway: Math.floor(r() * 40)
        }))
      bits = make(holiday === 'newyear' ? 70 : holiday === 'halloween' ? 44 : 20)
      stars = make(holiday === 'valentine' ? 0 : 22, 0.45)
    }

    const light = () => document.documentElement.dataset.theme === 'light'
    const dot = (x: number, y: number, color: string, a: number, k = 0.36) => {
      if (a <= 0) return
      // Яркость поднята вдвое против «честной»: точки лежат поверх пёстрого фона. Яркие ещё и светятся, как лампочки
      const lit = Math.min(1, a * 2)
      ctx.globalAlpha = lit
      ctx.fillStyle = color
      ctx.shadowColor = color
      ctx.shadowBlur = lit > 0.7 ? cell * 1.4 : 0
      ctx.beginPath()
      ctx.arc((x + 0.5) * cell, (y + 0.5) * cell, cell * (k + 0.06), 0, Math.PI * 2)
      ctx.fill()
    }
    /** Значок из точек; pal — цвета букв, остальное рисуется цветом color */
    const sprite = (rowsOf: string[], x: number, y: number, color: string, a: number, pal?: Record<string, [string, number]>) =>
      rowsOf.forEach((row, j) =>
        [...row].forEach((ch, i) => {
          if (ch === '.') return
          const own = pal?.[ch]
          dot(x + i, y + j, own ? own[0] : color, own ? own[1] : a)
        })
      )

    const newyear = (white: string) => {
      // Звёзды: стоят на месте, по очереди вспыхивают
      for (const s of stars) dot(s.x, s.y + 6, white, (tick + s.sway * 3) % 60 < 4 ? 0.7 : 0.14, 0.28)
      // Салют: точка взлетает и рассыпается кольцом, каждый раз в новом месте и другого цвета
      const lap = Math.floor(tick / 62)
      const k = tick % 62
      const fx = Math.floor(cols * (0.12 + hash(lap) * 0.76))
      const fy = Math.floor(rows * (0.16 + hash(lap + 50) * 0.26))
      const color = BULBS[lap % BULBS.length]
      if (k < 8) dot(fx, fy + (8 - k) * 2, white, 0.5, 0.26)
      else if (k < 26) {
        const rad = (k - 7) * 0.75
        const fade = 1 - (k - 8) / 18
        for (const [dx, dy] of RING) dot(Math.round(fx + dx * rad * 1.1), Math.round(fy + dy * rad + (k - 8) * 0.12), color, 0.75 * fade, k < 12 ? 0.44 : 0.34)
        if (k < 12) dot(fx, fy, white, 0.8)
      }
      // Комета с хвостом из искр — раз в двадцать с небольшим секунд
      const ck = tick % 270
      if (ck < 46) for (let j = 0; j < 7; j++) dot(Math.round(cols * 0.08 + (ck - j) * 2.4), Math.round(8 + (ck - j) * 0.55), j ? '#ffd35c' : white, j ? 0.5 - j * 0.07 : 0.9, j ? 0.3 : 0.44)
      // Снег: мелкий и крупные снежинки-кристаллы
      for (const b of bits) {
        const y = (b.y + Math.floor(tick / b.slow)) % (rows + 6)
        const x = (b.x + (Math.floor((tick + b.sway) / 14) % 2)) % cols
        if (b.kind === 0) sprite(CRYSTAL, x, y - 5, white, b.a * 0.7)
        else if (b.kind < 3) sprite(FLAKE, x, y - 1, white, b.a)
        else dot(x, y, white, b.a)
      }
      // Сугроб по нижнему краю: неровный, с редкими искорками
      for (let x = 0; x < cols; x++) {
        const h = Math.round(1.4 + 1.3 * Math.sin(x * 0.19) + 0.9 * Math.sin(x * 0.071 + 1.3))
        for (let j = 0; j < h; j++) dot(x, rows - 1 - j, white, j === h - 1 && (x * 7 + Math.floor(tick / 5)) % 23 === 0 ? 0.6 : 0.13)
      }
      // Гирлянда: провисает между «гвоздиками», лампочки горят через одну и меняются местами
      const span = 26
      const phase = Math.floor(tick / 6) % 2
      for (let x = 0; x < cols; x++) {
        const f = (x % span) / span
        const y = 1 + Math.round(Math.sin(Math.PI * f) ** 2 * 3 + (f > 0.5 ? 0.2 : 0))
        const n = Math.floor(x / 3)
        if (x % 3 === 1) {
          const on = n % 2 === phase
          dot(x, y + 1, BULBS[n % BULBS.length], on ? 0.95 : 0.22, on ? 0.46 : 0.36)
        } else dot(x, y, white, 0.16, 0.24)
      }
    }

    const halloween = (white: string) => {
      const violet = light() ? '#5a3fb8' : '#a891ff'
      // Луна из точек в правой верхней части — мыши пролетают на её фоне
      const mx = Math.floor(cols * 0.74)
      const my = 16
      for (let dy = -7; dy <= 7; dy++)
        for (let dx = -7; dx <= 7; dx++) {
          const d = Math.hypot(dx, dy)
          if (d <= 7.2) dot(mx + dx, my + dy, '#ffe9a3', Math.hypot(dx - 3, dy + 2) < 2.2 || Math.hypot(dx + 3, dy - 3) < 1.6 ? 0.1 : 0.2)
        }
      for (const s of stars) dot(s.x, s.y + 4, white, (tick + s.sway * 3) % 70 < 4 ? 0.5 : 0.1, 0.26)
      // Тлеющие искры поднимаются снизу
      for (const b of bits) {
        const y = rows - ((b.y + Math.floor(tick / (b.slow + 1))) % (rows + 2))
        const x = (b.x + (Math.floor((tick + b.sway) / 18) % 2)) % cols
        dot(x, y, b.kind < 5 ? '#ffa23a' : '#a891ff', (b.a + 0.2) * ((tick + b.sway) % 9 < 7 ? 1 : 0.4), b.kind === 0 ? 0.5 : 0.36)
      }
      // Паутина в левом верхнем углу: лучи и дуги между ними
      for (let i = 0; i < 5; i++) {
        const ang = (i / 4) * (Math.PI / 2)
        for (let d = 1; d <= 16; d++) dot(Math.round(Math.cos(ang) * d), Math.round(Math.sin(ang) * d), white, 0.16, 0.24)
      }
      for (const rad of [5, 10, 15]) for (let a = 0; a <= 30; a++) dot(Math.round(Math.cos((a / 30) * (Math.PI / 2)) * rad * 0.94), Math.round(Math.sin((a / 30) * (Math.PI / 2)) * rad * 0.94), white, 0.11, 0.22)
      // Паук спускается на нитке и поднимается обратно
      const sx = Math.floor(cols * 0.53)
      const drop = Math.round(6 + 9 * (0.5 - 0.5 * Math.cos((tick / 110) * Math.PI * 2)) + (tick % 14 < 2 ? 1 : 0))
      for (let y = 0; y < drop; y++) dot(sx + 2, y, white, 0.14, 0.2)
      sprite(SPIDER, sx, drop, violet, 0.55)
      // Тыквы у нижнего края: огонёк внутри подрагивает
      ;[0.44, 0.63, 0.8].forEach((f, i) => {
        const lit = (tick + i * 5) % 11 < 8
        sprite(PUMPKIN, Math.floor(cols * f), rows - 10, '#ffa23a', 0.5, { o: ['#e8791c', 0.2], n: ['#4be3a0', 0.3], e: [lit ? '#ffe27a' : '#ffa23a', lit ? 0.95 : 0.45] })
      })
      // Стайка летучих мышей пролетает раз в двенадцать секунд: машут крыльями и ныряют, каждая на своей высоте
      const period = 150
      const k = tick % period
      const lap = Math.floor(tick / period)
      for (let i = 0; i < 3; i++) {
        const kk = k - i * 9
        if (kk < 0 || kk >= 74) continue
        const x = lap % 2 ? cols - Math.floor((kk / 74) * (cols + 14)) + 6 : Math.floor((kk / 74) * (cols + 14)) - 8
        sprite(BAT[Math.floor((kk + i) / 3) % 2], x, 10 + ((lap + i) % 3) * 6 + i * 4 + Math.round(Math.sin(kk / 6 + i) * 2), violet, 0.62 - i * 0.1)
      }
      // Привидение всплывает из-за нижнего края, покачивается и тает
      const gk = (tick + 90) % 230
      if (gk < 90) {
        const glap = Math.floor((tick + 90) / 230)
        const gx = Math.floor(cols * (0.2 + hash(glap + 7) * 0.6)) + Math.round(Math.sin(gk / 9) * 2)
        sprite(GHOST, gx, rows - 4 - Math.floor(gk / 2.4), white, gk < 60 ? 0.34 : 0.34 * (1 - (gk - 60) / 30))
      }
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const white = light() ? '#5f76a8' : '#ffffff'
      if (holiday === 'newyear') newyear(white)
      else if (holiday === 'halloween') halloween(white)
      else
        for (const b of bits) {
          const y = rows + 4 - ((b.y + Math.floor(tick / (b.slow + 1))) % (rows + 8))
          const x = (b.x + (Math.floor((tick + b.sway) / 16) % 2)) % cols
          sprite(b.kind < 3 ? HEART : HEART_S, x, y, b.kind % 2 ? '#ff8ac6' : '#ff4b6e', b.a + 0.08)
        }
      ctx.globalAlpha = 1
      ctx.shadowBlur = 0
    }

    layout()
    draw()
    window.addEventListener('resize', layout)
    const timer = still
      ? 0
      : window.setInterval(() => {
          if (document.hidden) return
          tick++
          draw()
        }, TICK_MS)
    return () => {
      clearInterval(timer)
      window.removeEventListener('resize', layout)
    }
  }, [holiday])
  return <canvas ref={ref} className="season-decor" aria-hidden />
})
