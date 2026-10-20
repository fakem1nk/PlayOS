import { createContext, useContext } from 'react'
import type { GlyphStyle } from '@shared/types'
import { usePadInfo, type PadKind } from '../lib/input'

/** Значки кнопок геймпада: PlayStation (✕ ○ △ ▢) или Xbox (A B Y X) — по настройке или подключённому геймпаду. */

export type GlyphName = 'confirm' | 'back' | 'menu' | 'search' | 'options' | 'l1' | 'r1' | 'l2' | 'r2'

export const GlyphStyleContext = createContext<GlyphStyle>('auto')

export function useGlyphKind(): PadKind {
  const setting = useContext(GlyphStyleContext)
  const pad = usePadInfo()
  if (setting !== 'auto') return setting
  return pad === 'xbox' ? 'xbox' : 'playstation'
}

const XBOX: Record<GlyphName, string> = {
  confirm: 'A',
  back: 'B',
  menu: 'Y',
  search: 'X',
  options: '',
  l1: 'LB',
  r1: 'RB',
  l2: 'LT',
  r2: 'RT'
}
const PS_SHOULDER: Partial<Record<GlyphName, string>> = { l1: 'L1', r1: 'R1', l2: 'L2', r2: 'R2' }

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

export function Glyph({ name }: { name: GlyphName }) {
  const kind = useGlyphKind()
  const shoulder = kind === 'xbox' ? (XBOX[name].length === 2 ? XBOX[name] : undefined) : PS_SHOULDER[name]
  if (shoulder) return <span className="glyph glyph-pill">{shoulder}</span>
  if (kind === 'xbox' && name !== 'options') return <span className="glyph glyph-letter">{XBOX[name]}</span>
  return (
    <span className="glyph">
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
