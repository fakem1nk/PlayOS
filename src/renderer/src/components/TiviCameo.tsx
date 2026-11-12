import { useEffect, useMemo, useRef, useState } from 'react'
import type { Settings } from '@shared/types'
import { ARRIVE, ARRIVE_SCAN_MS, LEAVE } from '../lib/tivi-faces'
import { play } from '../lib/sound'
import { TiviArt } from './Tivi'

/**
 * Тиви поверх интро и аутро, на своём обычном месте в углу (сам он в это время скрыт вместе с оболочкой):
 *  • arrive — конец интро. Название рассыпается на символы: они потоком летят по дуге в угол, на лету меняясь,
 *    и складываются там в большого Тиви из символов — корпус, уши, ножки, тёмный экран. Символы ещё мельтешат,
 *    когда сверху вниз проходит строка развёртки и превращает их в настоящий корпус. На экране загораются точки,
 *    уши наливаются, он сжимается до своего размера, моргает и подпрыгивает; дальше под ним уже настоящий Тиви;
 *  • leave — начало аутро: зевает, уши опускаются, экран гаснет, как кинескоп, — раньше, чем погаснет весь экран.
 * Всё идёт ступенями по такту 40 мс, без плавных переходов, как и у самого Тиви.
 */

const GLYPHS = '01ABCDEFXYZ$&?/<>[]{}()!^#%@=+*'
const TICK_MS = 40
/** Сетка Тиви из символов поверх его рисунка (поле рисунка 240×236 от точки 8, 0) */
const COLS = 19
const ROWS = 17
const SPARKS = 140
/** Символы летят 11 тактов, вылетают в течение первых 12 */
const FLIGHT = 11
const LAUNCH = 12
/** Когда начинается развёртка, такт; до неё символы мельтешат на месте */
const SCAN_AT = Math.round(ARRIVE_SCAN_MS / TICK_MS)
const SCAN_STEPS = 8
/** Собирается большим, потом сжимается до своего размера: четыре шага по 80 мс, с перелётом — как пружина */
const BIG = [16, 15.75]
const OWN = { small: 6.3, medium: 10, large: 16 }
const SHRINK = [0.45, 0.88, 1.12, 1]
const SHRINK_MS = ARRIVE_SCAN_MS + SCAN_STEPS * TICK_MS + 880

// Одинаковые при каждом запуске
const rnd = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}
const glyph = (n: number) => GLYPHS[Math.floor(rnd(n) * GLYPHS.length)]

type Part = 'body' | 'screen' | 'eye' | 'earL' | 'earR' | 'foot'
/** Его обычное лицо: клетки экрана, где у него глаза и рот, горят ярко — у фигуры из символов уже есть взгляд */
const FACE = ARRIVE[ARRIVE.length - 1].face
interface Cell {
  c: number
  r: number
  part: Part
  /** Такт, на котором клетка загорается (к ней долетел символ) */
  on: number
}

/** Какие клетки сетки заняты Тиви и чем: по его рисунку (корпус 22…234 × 76…224, скругление 38) */
function mask(): Cell[] {
  const out: Cell[] = []
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const x = 8 + ((c + 0.5) * 240) / COLS
      const y = ((r + 0.5) * 236) / ROWS
      let part: Part | null = null
      if (x > 22 && x < 234 && y > 76 && y < 224) {
        const cx = Math.max(60, Math.min(196, x))
        const cy = Math.max(114, Math.min(186, y))
        if (Math.hypot(x - cx, y - cy) <= 40) {
          part = x > 40 && x < 216 && y > 94 && y < 206 ? 'screen' : 'body'
          const dot = FACE[Math.floor(((y - 88) / 124) * 8)]?.[Math.floor(((x - 34) / 188) * 15)]
          if (part === 'screen' && dot && dot !== '.') part = 'eye'
        }
      }
      if (!part && ((x - 54) / 24) ** 2 + ((y - 60) / 30) ** 2 <= 1) part = 'earL'
      if (!part && ((x - 202) / 24) ** 2 + ((y - 60) / 30) ** 2 <= 1) part = 'earR'
      if (!part && y >= 224 && ((x > 62 && x < 100) || (x > 156 && x < 194))) part = 'foot'
      if (part) out.push({ c, r, part, on: 0 })
    }
  // Загораются снизу вверх с разбросом — фигура «набирается», а не появляется разом
  out.forEach((cell, i) => (cell.on = FLIGHT + Math.round((1 - cell.r / ROWS) * 7 + rnd(i + 400) * 5)))
  return out
}

export function TiviCameo({ kind, size = 'small' }: { kind: 'arrive' | 'leave'; size?: Settings['tiviSize'] }) {
  const frames = kind === 'arrive' ? ARRIVE : LEAVE
  const [i, setI] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const ascii = useRef<HTMLDivElement>(null)
  const still = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])
  const cells = useMemo(mask, [])
  /** Собирается большим: 0 — большой, дальше шаги SHRINK; последний — свой размер */
  const [step, setStep] = useState(kind === 'arrive' && !still && size !== 'large' ? 0 : SHRINK.length)

  // Его звук: искры и «привет» в интро, зевок в аутро (play сам молчит, если звуки выключены)
  useEffect(() => play(kind === 'arrive' ? 'arrive' : 'yawn'), [kind])

  useEffect(() => {
    let k = 0
    let timer = 0
    const next = () => {
      if (k >= frames.length - 1) return
      timer = window.setTimeout(() => {
        k++
        setI(k)
        next()
      }, frames[k].ms)
    }
    next()
    return () => clearTimeout(timer)
  }, [frames])

  // Сжимается до своего размера, когда уши налились
  useEffect(() => {
    if (step === SHRINK.length) return
    const timers = SHRINK.map((_, k) => window.setTimeout(() => setStep(k + 1), SHRINK_MS + k * 80))
    return () => timers.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Поток символов от названия и Тиви из символов. Один таймер на всё: положение и сам символ меняются по такту
  useEffect(() => {
    const box = root.current
    const tv = body.current
    const grid = ascii.current
    if (kind !== 'arrive' || still || !box || !tv || !grid) return
    const area = box.getBoundingClientRect()
    const to = tv.getBoundingClientRect()
    const spots = [...grid.children] as HTMLElement[]
    const sparks = Array.from({ length: SPARKS }, (_, n) => {
      const el = document.createElement('span')
      el.className = 'tivi-spark'
      box.appendChild(el)
      // Старт — из названия (в приветствии оно наверху по центру), финиш — своя клетка фигуры
      const cell = cells[n % cells.length]
      const x0 = area.width * (0.32 + 0.36 * rnd(n + 50))
      const y0 = area.height * (0.18 + 0.1 * rnd(n + 90))
      const x1 = to.left - area.left + ((cell.c + 0.5) / COLS) * to.width
      const y1 = to.top - area.top + ((cell.r + 0.5) / ROWS) * to.height
      // Дуга: сперва вниз и в сторону, потом заворачивает к углу — поток закручивается, а не летит по прямой
      const bend = (rnd(n + 7) - 0.3) * area.height * 0.34
      // Долетев, символ принимает цвет своей части: левое ухо белое, правое и экран — фиолетовые
      const tint = cell.part === 'earR' || cell.part === 'screen' ? '#a891ff' : cell.part === 'earL' || cell.part === 'eye' ? '#fff' : '#cfd6e4'
      return { el, x0, y0, x1, y1, tint, px: x0, py: y0, ppx: x0, ppy: y0, cx: x0 + (x1 - x0) * 0.35 - bend * 0.6, cy: y0 + (y1 - y0) * 0.75 + bend, from: Math.round(rnd(n + 31) * LAUNCH) }
    })
    let tick = 0
    const timer = window.setInterval(() => {
      tick++
      for (let n = 0; n < sparks.length; n++) {
        const s = sparks[n]
        const k = tick - s.from
        if (k < 0 || k > FLIGHT) {
          if (k > FLIGHT) s.el.style.opacity = '0'
          continue
        }
        const p = (k / FLIGHT) ** 1.7
        const q = 1 - p
        const x = q * q * s.x0 + 2 * q * p * s.cx + p * p * s.x1
        const y = q * q * s.y0 + 2 * q * p * s.cy + p * p * s.y1
        s.el.style.opacity = '1'
        s.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) scale(${(1 - p * 0.35).toFixed(2)})`
        s.el.style.color = p > 0.55 ? s.tint : '#fff'
        // Хвост: тот же символ на двух прошлых местах — тенью, без лишних элементов
        s.el.style.textShadow = `0 0 0.5rem currentColor, ${Math.round(s.px - x)}px ${Math.round(s.py - y)}px 0 rgba(168, 145, 255, 0.5), ${Math.round(s.ppx - x)}px ${Math.round(s.ppy - y)}px 0 rgba(168, 145, 255, 0.22)`
        s.ppx = s.px
        s.ppy = s.py
        s.px = x
        s.py = y
        s.el.textContent = glyph(n * 13 + tick)
      }
      // Клетки фигуры: загораются, когда до них долетели, и мельтешат до конца развёртки
      const scanRow = tick >= SCAN_AT ? Math.floor(((tick - SCAN_AT) / SCAN_STEPS) * ROWS) : -1
      for (let n = 0; n < cells.length; n++) {
        const cell = cells[n]
        const el = spots[n]
        if (tick < cell.on) continue
        // Строка развёртки прошла: символ не гаснет на месте, а осыпается в сторону и вверх — три такта
        const gone = scanRow - cell.r
        if (gone > 0) {
          const side = cell.c < COLS / 2 ? -1 : 1
          el.style.opacity = gone > 3 ? '0' : ['0.6', '0.32', '0.14'][gone - 1]
          el.style.transform = `translate(${side * gone * (0.5 + rnd(n) * 0.7)}em, ${-gone * (0.3 + rnd(n + 9) * 0.5)}em)`
          el.style.color = '#a891ff'
          continue
        }
        // Строка развёртки: клетки под ней на миг вспыхивают белым
        const hot = cell.r === scanRow || tick - cell.on < 2
        el.style.opacity = hot || cell.part === 'eye' ? '1' : cell.part === 'screen' ? '0.22' : '0.85'
        el.style.color = hot ? '#fff' : ''
        if ((tick + n) % 2 === 0) el.textContent = glyph(n * 7 + tick * 3)
      }
      if (tick > SCAN_AT + SCAN_STEPS + 5) clearInterval(timer)
    }, TICK_MS)
    return () => {
      clearInterval(timer)
      sparks.forEach((s) => s.el.remove())
    }
  }, [kind, still, cells])

  const fr = frames[i]
  const own = OWN[size ?? 'small']
  const w = step === 0 ? BIG[0] : step < SHRINK.length ? BIG[0] + (own - BIG[0]) * SHRINK[step - 1] : 0
  const dims = w ? [w, (w * BIG[1]) / BIG[0]] : null
  return (
    <div ref={root} className={`tivi-cameo is-${kind} ${still ? 'is-still' : ''}`} aria-hidden>
      <div ref={body} className={`tivi is-${size}`} style={dims ? { width: `${dims[0]}rem`, height: `${dims[1]}rem` } : undefined}>
        <TiviArt face={fr.face} fx={fr.fx} pose={fr.pose} ears={fr.ears} />
        {kind === 'arrive' && !still && (
          <div ref={ascii} className="tivi-ascii" style={{ fontSize: `${(BIG[1] / ROWS) * 0.98}rem` }}>
            {cells.map((cell, n) => (
              <span key={n} className={`is-${cell.part}`} style={{ left: `${(cell.c / COLS) * 100}%`, top: `${(cell.r / ROWS) * 100}%`, width: `${100 / COLS}%`, height: `${100 / ROWS}%` }} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
