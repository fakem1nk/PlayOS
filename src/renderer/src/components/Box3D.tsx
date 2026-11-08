import { useState, type CSSProperties, type ReactNode } from 'react'
import type { Game } from '@shared/types'
import { hueOf, media } from '../lib/format'
import { Cover } from './Tile'

/**
 * Коробка игры в 3D: лицевая сторона — обложка, слева корешок (повёрнутый баннер, как на полке), сверху крышка, справа торец.
 * Размеры в rem: w×h — обложка, d — толщина. Как повернуть коробку, решает родитель (CSS transform на .box3d).
 * Анимировать у звеньев цепочки preserve-3d можно только transform и visibility: opacity или filter сплющат коробку в картинку
 */
export function Box3D({ game, w, h, d, front, className = '', style }: { game: Game; w: number; h: number; d: number; front?: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <span className={`box3d ${className}`} style={{ '--w': `${w}rem`, '--h': `${h}rem`, '--d': `${d}rem`, ...style } as CSSProperties}>
      <span className="box3d-face box3d-front">
        <Cover game={game} />
        {front}
      </span>
      <span className="box3d-face box3d-spine">
        <ArtSpine game={game} />
      </span>
      <span className="box3d-face box3d-side" />
      <span className="box3d-face box3d-top" />
    </span>
  )
}

/**
 * Широкая карточка игры для стопки: арт библиотеки Steam (hero) с логотипом, как в библиотеке Steam и на PS5.
 * Нет арта — обложка; нет логотипа (или не загрузился) — название текстом. children — в строку снизу (часы, дата)
 */
export function Banner({ game, children }: { game: Game; children?: ReactNode }) {
  const [art, setArt] = useState<'hero' | 'cover' | 'none'>(game.hero ? 'hero' : game.cover ? 'cover' : 'none')
  const [logo, setLogo] = useState(!!game.logo)
  const src = art === 'hero' ? game.hero : art === 'cover' ? game.cover : undefined
  return (
    <>
      {src ? (
        <img
          className={`deck-art ${art === 'cover' ? 'is-cover' : ''}`}
          src={media(src, art === 'hero' ? 'screen' : 'tile')}
          alt=""
          draggable={false}
          onError={() => setArt(art === 'hero' && game.cover ? 'cover' : 'none')}
        />
      ) : (
        <span className="deck-art is-hue" style={{ '--hue': hueOf(game) } as CSSProperties} />
      )}
      <span className="deck-scrim" />
      {/* Логотип — крупно у верхней карточки и у раскрытой; в узкой полоске он был бы с ноготь, там название текстом */}
      {logo && game.logo && <img className="deck-logo" src={media(game.logo, 'logo')} alt="" draggable={false} onError={() => setLogo(false)} />}
      <span className={`deck-row ${logo && game.logo ? 'has-logo' : ''}`}>
        <span className="deck-name">{game.title}</span>
        {game.platform !== 'pc' && <span className="deck-plat">{game.platform.toUpperCase()}</span>}
        {children}
      </span>
    </>
  )
}

/**
 * Корешок из баннера: широкий арт (hero) с логотипом, повёрнутый на 90° — снизу вверх, как надпись на корешке книги.
 * У hero пропорции ≈ 3:1, у корешка полки столько же — арт виден целиком. Размер берётся от контейнера (cqw/cqh).
 * Нет hero — вертикальный срез обложки с названием; нет и обложки — цвет игры
 */
export function ArtSpine({ game }: { game: Game }) {
  const [art, setArt] = useState<'hero' | 'cover' | 'none'>(game.hero ? 'hero' : game.cover ? 'cover' : 'none')
  const [logo, setLogo] = useState(!!game.logo)
  if (art === 'cover')
    return (
      <span className="aspine">
        <img className="aspine-cover" src={media(game.cover, 'tile')} alt="" draggable={false} onError={() => setArt('none')} />
        <span className="aspine-shade" />
        <span className="aspine-vname">{game.title}</span>
        {game.platform !== 'pc' && <span className="aspine-plat">{game.platform.toUpperCase()}</span>}
      </span>
    )
  return (
    <span className="aspine">
      <span className="aspine-banner">
        {art === 'hero' ? (
          <img className="aspine-art" src={media(game.hero, 'screen')} alt="" draggable={false} onError={() => setArt(game.cover ? 'cover' : 'none')} />
        ) : (
          <span className="aspine-art is-hue" style={{ '--hue': hueOf(game) } as CSSProperties} />
        )}
        <span className="aspine-scrim" />
        {art === 'hero' && logo && game.logo ? (
          <img className="aspine-logo" src={media(game.logo, 'logo')} alt="" draggable={false} onError={() => setLogo(false)} />
        ) : (
          <span className="aspine-name">{game.title}</span>
        )}
        {game.platform !== 'pc' && <span className="aspine-tag">{game.platform.toUpperCase()}</span>}
      </span>
    </span>
  )
}
