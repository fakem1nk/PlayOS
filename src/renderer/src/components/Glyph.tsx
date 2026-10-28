import { createContext, useContext } from 'react'
import type { GlyphStyle } from '@shared/types'
import { HOLD_DURATION, useHolding, useLastDevice, usePadInfo } from '../lib/input'

/**
 * Значки кнопок: PlayStation (✕ ○ △ ▢), Xbox (A B Y X), Nintendo и 8BitDo (B A X Y) или клавиши —
 * по настройке, а в режиме «Авто» по подключённому геймпаду и тому, чем сейчас управляют.
 */

export type GlyphName = 'confirm' | 'back' | 'menu' | 'search' | 'options' | 'l1' | 'r1' | 'l2' | 'r2' | 'guide' | 'adjust'
export type GlyphKind = Exclude<GlyphStyle, 'auto'>

export const GlyphStyleContext = createContext<GlyphStyle>('auto')

export function useGlyphKind(): GlyphKind {
  const setting = useContext(GlyphStyleContext)
  const pad = usePadInfo()
  const device = useLastDevice()
  if (setting !== 'auto') return setting
  if (device === 'keyboard' || pad === 'none') return pad === 'none' && device === 'pad' ? 'playstation' : 'keyboard'
  return pad
}

/** Подписи буквами и «таблетками»; пустая строка — рисуем символ PlayStation */
const LABELS: Record<Exclude<GlyphKind, 'playstation'>, Record<GlyphName, string>> = {
  xbox: { confirm: 'A', back: 'B', menu: 'Y', search: 'X', options: '', l1: 'LB', r1: 'RB', l2: 'LT', r2: 'RT', guide: 'Xbox', adjust: '◀ ▶' },
  // Нижняя кнопка на Switch и 8BitDo подписана B, правая — A
  nintendo: { confirm: 'B', back: 'A', menu: 'X', search: 'Y', options: '+', l1: 'L', r1: 'R', l2: 'ZL', r2: 'ZR', guide: 'Home', adjust: '◀ ▶' },
  keyboard: { confirm: 'Enter', back: 'Esc', menu: 'M', search: 'F', options: 'O', l1: 'Q', r1: 'E', l2: 'Z', r2: 'C', guide: 'Ctrl+Alt+H', adjust: '← →' }
}
const PS_SHOULDER: Partial<Record<GlyphName, string>> = { l1: 'L1', r1: 'R1', l2: 'L2', r2: 'R2', guide: 'PS', adjust: '◀ ▶' }
const SHOULDERS = new Set<GlyphName>(['l1', 'r1', 'l2', 'r2', 'guide', 'adjust'])

function PsSymbol({ name }: { name: GlyphName }) {
  const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const }
  switch (name) {
    case 'confirm':
      return <path d="M8 8l8 8M16 8l-8 8" {...s} />
    case 'back':
      return <circle cx="12" cy="12" r="4.6" {...s} />
    case 'menu':
      return <path d="M12 7.2 16.6 15H7.4Z" {...s} strokeLinejoin="round" />
    case 'search':
      return <rect x="7.6" y="7.6" width="8.8" height="8.8" rx=".8" {...s} />
    case 'options':
      return <path d="M7.5 8.5h9M7.5 12h9M7.5 15.5h9" {...s} strokeWidth={1.8} />
    default:
      return null
  }
}

export function Glyph({ name, className = '' }: { name: GlyphName; className?: string }) {
  const kind = useGlyphKind()
  if (kind === 'playstation') {
    if (PS_SHOULDER[name]) return <span className={`glyph glyph-pill ${className}`}>{PS_SHOULDER[name]}</span>
  } else {
    const label = LABELS[kind][name]
    // Клавиши и плечевые кнопки — «таблетка», буквы кнопок — кружок
    if (label && (kind === 'keyboard' || SHOULDERS.has(name) || label.length > 1))
      return <span className={`glyph glyph-pill ${kind === 'keyboard' ? 'glyph-key' : ''} ${className}`}>{label}</span>
    if (label) return <span className={`glyph glyph-letter ${className}`}>{label}</span>
  }
  return (
    <span className={`glyph ${className}`}>
      <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden>
        <PsSymbol name={name} />
      </svg>
    </span>
  )
}

export function Hint({ glyph, label }: { glyph: GlyphName; label: string }) {
  return (
    <span className="hint">
      <Glyph name={glyph} />
      {label}
    </span>
  )
}

/**
 * Подсказка «удержать ✕ — параметры». Значок ✕ обведён пунктирным контуром удержания:
 * пока кнопку держат, контур заполняется — то же время, что и до открытия параметров.
 * Контур повторяет форму значка: круг у кнопки геймпада, таблетка у клавиши Enter.
 */
export function HoldHint({ label }: { label: string }) {
  const holding = useHolding()
  return (
    <span className="hint">
      <span className={`hold-glyph ${holding ? 'is-holding' : ''}`} style={{ '--hold-ms': `${HOLD_DURATION}ms` } as React.CSSProperties}>
        <Glyph name="confirm" />
        <svg className="hold-ring" aria-hidden>
          <rect className="hold-track" />
          <rect className="hold-fill" pathLength={1} />
        </svg>
      </span>
      {label}
    </span>
  )
}

const GLYPH_SLOT = /\{(confirm|back|menu|search|options|l1|r1|l2|r2|guide|adjust)\}/

/** Текст со значками кнопок: «кнопкой {menu}» — значок под текущий геймпад или клавиатуру, а не всегда △ */
export function GlyphText({ text }: { text: string }) {
  const parts = text.split(GLYPH_SLOT)
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <Glyph key={i} name={p as GlyphName} className="glyph-inline" /> : p))}
    </>
  )
}
