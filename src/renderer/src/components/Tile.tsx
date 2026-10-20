import { createContext, useContext, useEffect, useState } from 'react'
import { PLATFORM_NAMES, type Game } from '@shared/types'
import { hueOf, media } from '../lib/format'

export const PLATFORM_SHORT: Record<Game['platform'], string> = { pc: 'PC', ps2: 'PS2', ps3: 'PS3' }

/** Разрешены ли анимированные обложки (настройка «Анимированные обложки») */
export const AnimatedCoversContext = createContext(true)

// Анимация стартует не сразу: при быстрой прокрутке ряда тяжёлые файлы не грузятся
const ANIMATION_DELAY = 350

/**
 * Обложка игры. Если арта нет — аккуратная заглушка с иконкой EXE и названием.
 * animate — плитка в фокусе: поверх статичной обложки плавно проявляется анимированная.
 */
export function Cover({ game, animate = false }: { game: Game; animate?: boolean }) {
  const allowed = useContext(AnimatedCoversContext)
  const [failed, setFailed] = useState(false)
  const [armed, setArmed] = useState(false)
  const [ready, setReady] = useState(false)
  const wantAnim = animate && allowed && !!game.coverAnimated

  useEffect(() => {
    setReady(false)
    if (!wantAnim) {
      setArmed(false)
      return
    }
    const t = setTimeout(() => setArmed(true), ANIMATION_DELAY)
    return () => clearTimeout(t)
  }, [wantAnim, game.coverAnimated])

  const still =
    game.cover && !failed ? (
      <img className="cover-img" src={media(game.cover)} alt="" draggable={false} onError={() => setFailed(true)} />
    ) : (
      <div className="cover-fallback" style={{ '--hue': hueOf(game) } as React.CSSProperties}>
        {game.icon && <img className="cover-icon" src={media(game.icon)} alt="" />}
        <span className="cover-title">{game.title}</span>
        <span className="cover-platform">{PLATFORM_NAMES[game.platform]}</span>
      </div>
    )

  return (
    <>
      {still}
      {wantAnim && armed && (
        <img
          className={`cover-anim ${ready ? 'is-ready' : ''}`}
          src={media(game.coverAnimated)}
          alt=""
          draggable={false}
          onLoad={() => setReady(true)}
        />
      )}
    </>
  )
}

interface TileProps {
  game: Game
  focused?: boolean
  /** Проигрывать анимированную обложку (по умолчанию — когда плитка в фокусе) */
  animate?: boolean
  running?: boolean
  onClick?: () => void
  className?: string
  style?: React.CSSProperties
}

export function Tile({ game, focused, animate, running, onClick, className = '', style }: TileProps) {
  return (
    <div
      className={`tile ${focused ? 'is-focused' : ''} ${className}`}
      style={style}
      onClick={onClick}
      role="button"
      aria-label={game.title}
    >
      <div className="tile-art">
        <Cover game={game} animate={animate ?? focused} />
        <span className="tile-platform">{PLATFORM_SHORT[game.platform]}</span>
        {running && <span className="tile-live" title="Запущена" />}
      </div>
    </div>
  )
}
