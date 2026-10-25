/**
 * Тема интерфейса: тёмная (по умолчанию), светлая или как в Windows. Выбранная тема — атрибут
 * html[data-theme]; светлые стили собираются из тёмных при сборке (scripts/light-theme.mjs).
 * Смена темы — плавный кросс-фейд через View Transitions, первая отрисовка — сразу.
 */

import type { ThemeMode } from '@shared/types'
import { t } from '@shared/i18n'

export const THEMES: ThemeMode[] = ['dark', 'light', 'system']

const system = window.matchMedia('(prefers-color-scheme: dark)')
let mode: ThemeMode = 'dark'
let painted = false

function paint() {
  const dark = mode === 'dark' || (mode === 'system' && system.matches)
  const next = dark ? 'dark' : 'light'
  const root = document.documentElement
  if (root.dataset.theme === next) return
  const swap = () => {
    root.dataset.theme = next
  }
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown }
  if (painted && !reduce && doc.startViewTransition) doc.startViewTransition(swap)
  else swap()
  painted = true
}

system.addEventListener('change', () => mode === 'system' && paint())

export function setTheme(m: ThemeMode | undefined) {
  mode = m ?? 'dark'
  paint()
}

export const themeMode = () => mode
export const nextTheme = (m: ThemeMode) => THEMES[(THEMES.indexOf(m) + 1) % THEMES.length]

export function themeName(m: ThemeMode) {
  return m === 'light' ? t('Светлая') : m === 'system' ? t('Как в системе') : t('Тёмная')
}
