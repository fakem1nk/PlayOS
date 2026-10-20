/**
 * Знак PlayOS: кольцо с разрывом сверху, как у кнопки питания, и треугольник «Play» внутри —
 * «включить» и «играть» одним символом. Рисуется в сетке 48×48.
 */

/** Кольцо r=18 с разрывом 64° сверху; путь начинается справа от разрыва и идёт по часовой */
export const LOGO_RING = 'M33.54 8.74A18 18 0 1 1 14.46 8.74'
/** Треугольник чуть сдвинут вправо — так он оптически по центру кольца */
export const LOGO_PLAY = 'M19.6 15.4v17.2L33.6 24Z'

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden>
      <path d={LOGO_RING} fill="none" stroke="currentColor" strokeWidth={3.4} strokeLinecap="round" />
      <path d={LOGO_PLAY} fill="currentColor" stroke="currentColor" strokeWidth={2.6} strokeLinejoin="round" />
    </svg>
  )
}

/** Название: «Play» плотнее, «OS» светлее и тоньше */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`wordmark ${className}`}>
      Play<span className="wordmark-os">OS</span>
    </span>
  )
}
