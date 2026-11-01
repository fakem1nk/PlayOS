import type { ReactNode } from 'react'
import type { WindowAction, WindowMode } from '@shared/types'
import { api } from '../lib/api'
import { t } from '@shared/i18n'

/** Рамка окна вне полного экрана: полоса, за которую окно тянут, и кнопки как у Windows.
 *  Только для мыши — геймпад до них не доходит, у него своё меню питания */
export function WindowFrame({ mode }: { mode: WindowMode }) {
  if (mode.fullscreen) return null
  const button = (action: WindowAction, label: string, glyph: ReactNode, cls = '') => (
    <button
      tabIndex={-1}
      className={`win-btn ${cls}`}
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => void api.windowControl(action)}
    >
      <svg viewBox="0 0 10 10" aria-hidden>
        {glyph}
      </svg>
    </button>
  )
  return (
    <div className="window-drag">
      <div className="win-controls">
        {button('fullscreen', t('Во весь экран (F11)'), <path d="M.5 3.5v-3h3M6.5.5h3v3M9.5 6.5v3h-3M3.5 9.5h-3v-3" />)}
        {button('minimize', t('Свернуть'), <path d="M0 5h10" />)}
        {mode.maximized
          ? button('maximize', t('Восстановить'), <path d="M2.5 2.5v-2h7v7h-2M.5 2.5h7v7h-7z" />)
          : button('maximize', t('Развернуть'), <rect x=".5" y=".5" width="9" height="9" />)}
        {button('close', t('Закрыть — PlayOS останется в трее'), <path d="m.5.5 9 9m0-9-9 9" />, 'is-close')}
      </div>
    </div>
  )
}
