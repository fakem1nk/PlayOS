import { useEffect, useRef, useState } from 'react'
import type { Settings } from '@shared/types'
import { ARRIVE, LEAVE } from '../lib/tivi-faces'
import { play } from '../lib/sound'
import { TiviArt } from './Tivi'

/**
 * Тиви поверх интро и аутро, на своём обычном месте в углу (сам он в это время скрыт вместе с оболочкой):
 *  • arrive — конец интро: от названия в угол слетаются символы, корпус прорисовывается строкой сверху вниз,
 *    на экране загораются точки, уши наливаются, он моргает и подпрыгивает; дальше под ним уже настоящий Тиви;
 *  • leave — начало аутро: зевает, уши опускаются, экран гаснет, как кинескоп, — раньше, чем погаснет весь экран.
 * Кадры идут по своим длительностям, без плавных переходов, как и у самого Тиви.
 */

const GLYPHS = '01ABCDEFXYZ$&?/<>[]{}()!^#%@'
const SPARKS = 30
/** Точка экрана Тиви в долях его рамки (центр матрицы) */
const SCREEN = { x: 0.5, y: 0.64 }
// Одинаковые при каждом запуске
const rnd = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

export function TiviCameo({ kind, size = 'small' }: { kind: 'arrive' | 'leave'; size?: Settings['tiviSize'] }) {
  const frames = kind === 'arrive' ? ARRIVE : LEAVE
  const [i, setI] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)

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

  // Символы летят от названия (в приветствии оно наверху по центру) к экрану Тиви — ступенями, по дуге
  useEffect(() => {
    const box = root.current
    const tv = body.current
    if (kind !== 'arrive' || !box || !tv || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const area = box.getBoundingClientRect()
    const to = tv.getBoundingClientRect()
    const tx = to.left - area.left + to.width * SCREEN.x
    const ty = to.top - area.top + to.height * SCREEN.y
    const made: HTMLElement[] = []
    for (let n = 0; n < SPARKS; n++) {
      const el = document.createElement('span')
      el.className = 'tivi-spark'
      el.textContent = GLYPHS[Math.floor(rnd(n) * GLYPHS.length)]
      const x0 = area.width * (0.34 + 0.32 * rnd(n + 50))
      const y0 = area.height * (0.19 + 0.08 * rnd(n + 90))
      const dx = tx + (rnd(n + 7) - 0.5) * to.width * 0.5 - x0
      const dy = ty + (rnd(n + 13) - 0.5) * to.height * 0.3 - y0
      el.style.left = `${x0}px`
      el.style.top = `${y0}px`
      box.appendChild(el)
      made.push(el)
      const STEPS = 8
      el.animate(
        [
          { opacity: 0, transform: 'translate(0, 0)', easing: 'step-end' },
          ...Array.from({ length: STEPS }, (_, s) => {
            const p = (s + 1) / STEPS
            const e = p * p
            return { opacity: s === STEPS - 1 ? 0 : 1, transform: `translate(${dx * e}px, ${dy * e - Math.sin(p * Math.PI) * area.height * 0.07}px)`, easing: 'step-end' }
          })
        ],
        { duration: 640, delay: 40 * Math.round(rnd(n + 31) * 12), fill: 'both' }
      )
    }
    return () => made.forEach((el) => el.remove())
  }, [kind])

  const fr = frames[i]
  return (
    <div ref={root} className={`tivi-cameo is-${kind}`} aria-hidden>
      <div ref={body} className={`tivi is-${size}`}>
        <TiviArt face={fr.face} fx={fr.fx} pose={fr.pose} ears={fr.ears} />
      </div>
    </div>
  )
}
