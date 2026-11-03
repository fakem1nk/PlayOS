import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

/** get — качается, unpack — распаковка (фиолетовый, как искра Тиви), pause — стоит, error — ошибка, disk — занятое место */
export type PixelTone = 'get' | 'unpack' | 'pause' | 'error' | 'disk'

/** Промежуток между клетками, rem */
const GAP = 0.3

/** Сколько клеток помещается в ширину: полоса тянется на всё место, а клетки остаются квадратными */
function useCells(ref: React.RefObject<HTMLElement | null>, size: number) {
  const [n, setN] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10
      setN(Math.max(4, Math.floor((el.clientWidth + GAP * rem) / ((size + GAP) * rem))))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, size])
  return n
}

/**
 * Полоса из пикселей, как экран Тиви: заполненные клетки горят, следующая мигает, пока идёт загрузка, а по горящим
 * пробегает волна. Кадры переключаются ступенькой, без плавных переходов — как настоящий пиксельный экран
 */
export function PixelBar({ value, tone = 'get', live = false, size = 1, className = '' }: { value: number; tone?: PixelTone; live?: boolean; size?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const n = useCells(ref, size)
  const lit = Math.min(n, Math.floor(Math.max(0, Math.min(1, value)) * n))
  return (
    <span
      ref={ref}
      className={`px-bar is-${tone} ${live ? 'is-live' : ''} ${className}`}
      style={{ '--px': `${size}rem` } as CSSProperties}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
    >
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={i < lit ? 'is-on' : live && i === lit ? 'is-next' : undefined} style={i < lit ? ({ '--i': i } as CSSProperties) : undefined} />
      ))}
    </span>
  )
}
