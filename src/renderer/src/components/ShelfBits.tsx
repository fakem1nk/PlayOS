import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { COLORS, COLS, ROWS, SPRITES, type Frame, type Grid, type Sprite } from '../lib/tivi-faces'

/** Окна профиля рисуются там же, где окна приложения (внутри .app), а не внутри сдвигаемой вкладки */
export function AppPortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.querySelector('.app') ?? document.body)
}

/** Кадры сценки Тиви по кругу, ступенькой — как его экран, пока on */
export function useFrames(frames: readonly Frame[] | undefined, on: boolean) {
  const [i, setI] = useState(0)
  useEffect(() => {
    setI(0)
    if (!on || !frames?.length) return
    let k = 0
    let id = 0
    const next = () => {
      id = window.setTimeout(() => {
        k = (k + 1) % frames.length
        setI(k)
        next()
      }, frames[k].ms)
    }
    next()
    return () => clearTimeout(id)
  }, [frames, on])
  return on && frames?.length ? frames[Math.min(i, frames.length - 1)] : undefined
}

/** Лицо Тиви одной светодиодной матрицей 15×8, без корпуса — для подписи на полке */
export function LedFace({ face, className = '' }: { face: Grid; className?: string }) {
  const dots: ReactNode[] = []
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const ch = face[y]?.[x]
      const on = ch && ch !== '.'
      const [fill, alpha] = on ? (COLORS[ch] ?? ['#fff', 1]) : ['#ffffff', 0.08]
      dots.push(<circle key={y * COLS + x} cx={x + 0.5} cy={y + 0.5} r={0.4} fill={fill} opacity={alpha} />)
    }
  return (
    <svg className={`led-face ${className}`} viewBox={`0 0 ${COLS} ${ROWS}`} aria-hidden>
      {dots}
    </svg>
  )
}

/** Буквы 5×7 для табло «ПРОЙДЕНО» — тем же шрифтом, что цифры DotText */
const LETTERS: Record<string, string[]> = {
  П: ['11111', '10001', '10001', '10001', '10001', '10001', '10001'],
  Р: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  О: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  Й: ['01010', '10001', '10011', '10101', '11001', '10001', '10001'],
  Д: ['00110', '01010', '01010', '01010', '01010', '11111', '10001'],
  Е: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  Н: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  А: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  D: ['11100', '10010', '10001', '10001', '10001', '10010', '11100'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'],
  ' ': ['000', '000', '000', '000', '000', '000', '000']
}

/** Слово светодиодами; буквы зажигаются по одной, ступенькой — без плавных переходов */
export function DotWord({ text, step = 70, delay = 0, className = '' }: { text: string; step?: number; delay?: number; className?: string }) {
  return (
    <span className={`dot-word ${className}`} role="img" aria-label={text}>
      {[...text].map((ch, i) => {
        const rows = LETTERS[ch] ?? LETTERS[' ']
        const w = rows[0].length
        return (
          <svg key={i} className="dot-word-ch" viewBox={`0 0 ${w} 7`} style={{ width: `${w / 7}em`, animationDelay: `${delay + i * step}ms` } as CSSProperties} aria-hidden>
            {rows.flatMap((row, y) => [...row].map((bit, x) => <circle key={`${x}-${y}`} cx={x + 0.5} cy={y + 0.5} r={0.42} className={bit === '1' ? 'dot-on' : 'dot-off'} />))}
          </svg>
        )
      })}
    </span>
  )
}

/** Пиксельный значок Тиви (искра, сердце) — салют вокруг коробки в окне «Пройдено» */
export function PixelSprite({ s, px = 0.55, className = '', style }: { s: Sprite; px?: number; className?: string; style?: CSSProperties }) {
  const rows = SPRITES[s]
  const w = rows[0].length
  return (
    <svg className={`px-sprite ${className}`} viewBox={`0 0 ${w} ${rows.length}`} style={{ width: `${w * px}rem`, ...style }} shapeRendering="crispEdges" aria-hidden>
      {rows.flatMap((row, y) => [...row].map((ch, x) => (ch === '.' ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill={COLORS[ch]?.[0] ?? '#fff'} />)))}
    </svg>
  )
}
