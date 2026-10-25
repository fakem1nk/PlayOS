import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import type { Game } from '@shared/types'
import { lastPlayed, media, playtime } from '../lib/format'
import { idleFor, onActivity, useInputLayer } from '../lib/input'
import { useNow } from '../lib/state'
import { locale, t } from '@shared/i18n'

const SLIDE_MS = 11000
const timeFmt = new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' })
const dateFmt = new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long' })

interface Props {
  games: Game[]
  /** Через сколько минут бездействия включаться, 0 — никогда */
  minutes: number
  /** Можно ли сейчас (не идёт интро, окно не занято игрой) */
  allowed: boolean
  onChange: (on: boolean) => void
}

/**
 * Заставка при бездействии: медленное слайд-шоу фонов игр с часами.
 * Подписи переезжают между углами от слайда к слайду — статичные элементы не выжигают OLED.
 * Любая кнопка или движение мыши закрывают заставку; первое нажатие никуда дальше не уходит.
 */
export function Screensaver({ games, minutes, allowed, onChange }: Props) {
  const [on, setOn] = useState(false)

  useEffect(() => {
    if (!allowed || !minutes) {
      setOn(false)
      return
    }
    const id = setInterval(() => {
      if (document.hasFocus() && idleFor() > minutes * 60_000) setOn(true)
    }, 3000)
    return () => clearInterval(id)
  }, [allowed, minutes])

  useEffect(() => onActivity(() => setOn(false)), [])
  useEffect(() => onChange(on), [on, onChange])

  // Нажатие, которое будит заставку, проглатываем
  useInputLayer(() => true, 100, on)

  const slides = useMemo(() => {
    const withArt = games.filter((g) => g.hero || g.cover)
    // Перемешиваем один раз за показ
    return withArt.map((g) => ({ g, k: Math.random() })).sort((a, b) => a.k - b.k).map((x) => x.g)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, games.length])

  return <AnimatePresence>{on && <Show key="saver" slides={slides} />}</AnimatePresence>
}

function Show({ slides }: { slides: Game[] }) {
  const [i, setI] = useState(0)
  const now = useNow(1000, true)
  useEffect(() => {
    if (slides.length < 2) return
    const id = setInterval(() => setI((x) => (x + 1) % slides.length), SLIDE_MS)
    return () => clearInterval(id)
  }, [slides.length])

  const game = slides[i % Math.max(1, slides.length)]
  // Подпись игры и часы меняются местами на каждом слайде
  const flip = i % 2 === 1

  return (
    <motion.div
      className="saver"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.35 } }}
      transition={{ duration: 1.6, ease: 'easeInOut' }}
    >
      <AnimatePresence initial={false}>
        {game && (
          <motion.div
            key={game.id + i}
            className={`saver-slide ${game.hero ? '' : 'is-blur'} ${i % 2 ? 'pan-left' : 'pan-right'}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 2.2, ease: 'easeInOut' }}
          >
            <img src={game.hero ? media(game.hero, 'screen') : media(game.cover, 'tile')} alt="" draggable={false} />
          </motion.div>
        )}
      </AnimatePresence>
      <div className="saver-shade" />

      <div className={`saver-clock ${flip ? 'is-left' : ''}`}>
        <span className="saver-time">{timeFmt.format(now)}</span>
        <span className="saver-date">{dateFmt.format(now)}</span>
      </div>

      <AnimatePresence mode="wait">
        {game && (
          <motion.div
            key={game.id + i}
            className={`saver-game ${flip ? 'is-right' : ''}`}
            initial={{ opacity: 0, transform: 'translateY(1rem)' }}
            animate={{ opacity: 1, transform: 'translateY(0rem)' }}
            exit={{ opacity: 0, transition: { duration: 0.6 } }}
            transition={{ duration: 1.2, ease: [0.23, 1, 0.32, 1], delay: 0.8 }}
          >
            {game.logo ? <img className="saver-logo" src={media(game.logo, 'logo')} alt={game.title} /> : <span className="saver-title">{game.title}</span>}
            <span className="saver-meta">
              {game.playtime ? t('Наиграно {v}', { v: playtime(game.playtime).toLowerCase() }) : t('Ещё не запускалась')}
              {game.lastPlayed ? t(', последний запуск {v}', { v: lastPlayed(game.lastPlayed).toLowerCase() }) : ''}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
