import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { Game, LiveBackground } from '@shared/types'
import { api } from '../lib/api'
import { hueOf, media } from '../lib/format'

interface Art {
  key: string
  gameId?: string
  src?: string
  mode: 'hero' | 'blur' | 'none'
  hue: number
}

function artOf(game: Game | null): Art {
  if (!game) return { key: 'empty', mode: 'none', hue: 220 }
  const hue = hueOf(game)
  if (game.hero) return { key: game.hero, gameId: game.id, src: media(game.hero), mode: 'hero', hue }
  if (game.cover) return { key: game.cover, gameId: game.id, src: media(game.cover), mode: 'blur', hue }
  return { key: `hue-${hue}`, gameId: game.id, mode: 'none', hue }
}

const loaded = new Set<string>()
function preload(src: string) {
  if (loaded.has(src)) return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    const img = new Image()
    const done = (ok: boolean) => {
      if (ok) loaded.add(src)
      resolve(ok)
    }
    img.onload = () => done(true)
    img.onerror = () => done(false)
    img.src = src
    setTimeout(() => resolve(false), 2500)
  })
}

// Живой фон включается, если задержаться на игре
const LIVE_DELAY = 2200

interface Props {
  game: Game | null
  dim?: boolean
  /** Можно ли оживлять фон (настройка включена, экран не занят окнами) */
  live?: boolean
}

/**
 * Полноэкранный фон с артом выбранной игры. Смена фона ждёт, пока навигация «успокоится»,
 * и пока картинка загрузится — поэтому кросс-фейд всегда чистый, без мигания пустоты.
 * Если задержаться на игре, поверх арта проявляется беззвучный трейлер или анимированный фон.
 */
export function Background({ game, dim = false, live = false }: Props) {
  const target = artOf(game)
  const [art, setArt] = useState<Art>(target)
  const [video, setVideo] = useState<{ key: string; bg: LiveBackground } | null>(null)

  useEffect(() => {
    if (target.key === art.key) return
    let cancelled = false
    const t = setTimeout(async () => {
      const ok = target.src ? await preload(target.src) : true
      if (!cancelled) setArt(ok ? target : { ...target, src: undefined, mode: 'none' })
    }, 140)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.key])

  // Задержались на игре — просим живой фон (main скачает фрагмент трейлера один раз)
  useEffect(() => {
    if (!live || !art.gameId) return
    let cancelled = false
    const key = art.key
    const t = setTimeout(async () => {
      const bg = await api.liveBackground(art.gameId!).catch(() => null)
      if (!cancelled && bg) setVideo({ key, bg })
    }, LIVE_DELAY)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [live, art.key, art.gameId])

  const playing = live && video?.key === art.key ? video.bg : null

  return (
    <div className={`bg ${dim ? 'is-dim' : ''}`}>
      <AnimatePresence initial={false}>
        <motion.div
          key={art.key}
          className={`bg-art bg-${art.mode}`}
          style={{ '--hue': art.hue } as React.CSSProperties}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.75, ease: [0.23, 1, 0.32, 1] }}
        >
          {art.src && <img src={art.src} alt="" draggable={false} />}
          <AnimatePresence>{playing && <LiveVideo key={playing.src} bg={playing} />}</AnimatePresence>
        </motion.div>
      </AnimatePresence>
      <div className="bg-shade" />
      <div className="bg-glow" />
    </div>
  )
}

/** Беззвучное видео поверх арта: проявляется, когда пошли кадры, зацикливается на обрезанном фрагменте */
function LiveVideo({ bg }: { bg: LiveBackground }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [ready, setReady] = useState(false)
  const restart = () => {
    const v = ref.current
    if (!v) return
    v.currentTime = 0
    void v.play().catch(() => {})
  }
  return (
    <motion.video
      ref={ref}
      className={`bg-video ${ready ? 'is-ready' : ''}`}
      src={media(bg.src)}
      muted
      autoPlay
      playsInline
      loop={!bg.loopAt}
      onPlaying={() => setReady(true)}
      onTimeUpdate={(e) => {
        if (bg.loopAt && e.currentTarget.currentTime >= bg.loopAt - 0.35) restart()
      }}
      // У склеенного фрагмента браузер может «ждать» данные после последнего куска — начинаем сначала
      onWaiting={(e) => {
        if (bg.loopAt && e.currentTarget.currentTime >= bg.loopAt - 2) restart()
      }}
      onEnded={restart}
      exit={{ opacity: 0, transition: { duration: 0.4 } }}
    />
  )
}
