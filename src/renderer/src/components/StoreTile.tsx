import { useMemo } from 'react'
import type { StoreItem } from '@shared/types'
import { useLastDevice } from '../lib/input'
import { storeGame, tileNote } from '../lib/shop'
import { Glyph } from './Glyph'
import { IconCheck, IconDownload, IconPlus } from './Icons'
import { Cover } from './Tile'
import { t } from '@shared/i18n'

/**
 * Плитка игры магазина: обложка, отметки «можно скачать» и «в библиотеке», подпись с названием и оценкой.
 * «+» в углу обложки (при наведении и в фокусе) — сразу в библиотеку, без страницы игры
 */
export function StoreTile({
  item,
  focused,
  inLibrary,
  adding,
  caption,
  onAdd,
  onClick
}: {
  item: StoreItem
  focused: boolean
  inLibrary: boolean
  adding: boolean
  caption?: boolean
  onAdd: () => void
  onClick: () => void
}) {
  const game = useMemo(() => storeGame(item), [item])
  const tile = (
    <div className={`tile store-tile ${focused ? 'is-focused' : ''}`} role="button" aria-label={item.title} onClick={onClick}>
      <div className="tile-art">
        <Cover game={game} />
        {!inLibrary && (
          <button
            tabIndex={-1}
            className={`store-quick ${adding ? 'is-busy' : ''}`}
            aria-label={t('Добавить в библиотеку')}
            title={t('Добавить в библиотеку')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation()
              onAdd()
            }}
          >
            {adding ? <span className="spinner" /> : focused ? <QuickGlyph /> : <IconPlus />}
          </button>
        )}
        {(inLibrary || !!item.options || item.store === 'gog') && (
          <span className="store-badges">
            {item.store === 'gog' && <span className="store-badge is-text">GOG</span>}
            {!!item.options && (
              <span className="store-badge is-dl" title={t('Можно скачать')}>
                <IconDownload />
              </span>
            )}
            {inLibrary && (
              <span className="store-badge" title={t('Уже в библиотеке')}>
                <IconCheck />
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  )
  if (!caption) return tile
  return (
    <div className={`store-cell ${focused ? 'is-current' : ''}`}>
      {tile}
      <div className="store-cap">
        <span className="store-cap-title">{item.title}</span>
        <span className="store-cap-note">{tileNote(item)}</span>
      </div>
    </div>
  )
}

/** На геймпаде «+» в фокусе показывает кнопку, которой добавляют (△), с клавиатуры и мышью — плюс */
export function QuickGlyph() {
  const device = useLastDevice()
  return device === 'pad' ? <Glyph name="menu" /> : <IconPlus />
}
