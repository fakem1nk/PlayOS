import { useEffect, useRef, useState, type ReactNode } from 'react'
import { play } from '../lib/sound'
import { IconChevron, IconFolder } from './Icons'
import { t } from '@shared/i18n'

/** Подписка на влево/вправо от пространственной навигации (атрибут data-adjust). */
function useAdjust<T extends HTMLElement>(cb: (d: number) => void) {
  const ref = useRef<T>(null)
  const cbRef = useRef(cb)
  cbRef.current = cb
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const h = (e: Event) => cbRef.current((e as CustomEvent<number>).detail)
    el.addEventListener('nav-adjust', h)
    return () => el.removeEventListener('nav-adjust', h)
  }, [])
  return ref
}

export function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  const set = (v: boolean) => {
    if (v === value) return
    play(v ? 'toggleOn' : 'toggleOff')
    onChange(v)
  }
  // Только ✕: влево/вправо на переключателе — обычная навигация, а не смена значения
  return (
    <button data-nav className="setting" onClick={() => set(!value)} role="switch" aria-checked={value}>
      <span className="setting-text">
        <span className="setting-label">{label}</span>
        {hint && <span className="setting-hint">{hint}</span>}
      </span>
      <span className={`switch ${value ? 'is-on' : ''}`}>
        <span className="switch-knob" />
      </span>
    </button>
  )
}

export function Cycler<T extends string>({
  label,
  hint,
  value,
  options,
  onChange
}: {
  label: string
  hint?: string
  value: T
  options: { id: T; label: string }[]
  onChange: (v: T) => void
}) {
  const i = Math.max(0, options.findIndex((o) => o.id === value))
  // Направление последнего шага — новое значение выезжает с той же стороны
  const [dir, setDir] = useState(1)
  const step = (d: number) => {
    setDir(d)
    play('adjust')
    onChange(options[(i + d + options.length) % options.length].id)
  }
  const ref = useAdjust<HTMLButtonElement>(step)
  return (
    <button ref={ref} data-nav data-adjust className="setting" onClick={() => step(1)}>
      <span className="setting-text">
        <span className="setting-label">{label}</span>
        {hint && <span className="setting-hint">{hint}</span>}
      </span>
      <span className="cycler">
        <IconChevron dir="left" />
        <span className="cycler-value">
          <span key={options[i].id} className={`cycler-text ${dir < 0 ? 'from-left' : 'from-right'}`}>
            {options[i].label}
          </span>
        </span>
        <IconChevron />
      </span>
    </button>
  )
}

/** Текстовое поле: сохраняет значение по Enter / при уходе фокуса. */
export function Field({
  label,
  hint,
  value,
  placeholder,
  onCommit,
  onChange,
  mono,
  children
}: {
  label: string
  hint?: string
  value: string
  placeholder?: string
  onCommit?: (v: string) => void
  onChange?: (v: string) => void
  mono?: boolean
  children?: ReactNode
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    if (draft !== value) onCommit?.(draft)
  }
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="field-row">
        <input
          data-nav
          className={`input ${mono ? 'is-mono' : ''}`}
          aria-label={label}
          value={onChange ? value : draft}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(e) => (onChange ? onChange(e.target.value) : setDraft(e.target.value))}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
        {children}
      </div>
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  )
}

export function BrowseButton({ onClick, label = t('Обзор') }: { onClick: () => void; label?: string }) {
  return (
    <button data-nav className="btn btn-glass btn-sm" onClick={onClick}>
      <IconFolder /> {label}
    </button>
  )
}

export function ActionRow({ label, hint, button, onClick, icon }: { label: string; hint?: string; button: string; onClick: () => void; icon?: ReactNode }) {
  return (
    <div className="setting setting-static">
      <span className="setting-text">
        <span className="setting-label">{label}</span>
        {hint && <span className="setting-hint">{hint}</span>}
      </span>
      <button data-nav className="btn btn-glass btn-sm" onClick={onClick}>
        {icon}
        {button}
      </button>
    </div>
  )
}
