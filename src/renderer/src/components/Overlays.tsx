import { AnimatePresence, motion } from 'motion/react'
import type { Game } from '@shared/types'
import { media } from '../lib/format'
import { dismissToast, useToasts } from '../lib/state'
import { IconTrophy } from './Icons'
import { Cover } from './Tile'

const easeOut = [0.23, 1, 0.32, 1] as const


/** Экран запуска: обложка «всплывает», фон медленно наезжает, пока игра грузится. */
export function LaunchScreen({ game }: { game: Game }) {
  return (
    <motion.div
      className="launch"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.4 } }}
      transition={{ duration: 0.35 }}
    >
      {(game.hero || game.cover) && <img className={`launch-bg ${game.hero ? '' : 'is-blur'}`} src={media(game.hero ?? game.cover)} alt="" />}
      <div className="launch-shade" />
      <motion.div
        className="launch-card"
        initial={{ opacity: 0, transform: 'scale(0.9) translateY(2rem)' }}
        animate={{ opacity: 1, transform: 'scale(1) translateY(0rem)' }}
        transition={{ duration: 0.7, ease: easeOut, delay: 0.05 }}
      >
        <div className="launch-cover">
          <Cover game={game} />
        </div>
        <div className="launch-title">{game.title}</div>
        <div className="launch-status">Запуск игры</div>
        <div className="launch-bar">
          <span />
        </div>
      </motion.div>
    </motion.div>
  )
}

/** Уведомления в правом верхнем углу, как на PS5. */
export function Toasts() {
  const toasts = useToasts()
  return (
    <div className="toasts">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            className={`toast toast-${t.tone ?? 'info'} ${t.kind === 'trophy' ? `toast-trophy trophy-${t.tier}` : ''}`}
            initial={{ opacity: 0, transform: 'translateX(110%)' }}
            animate={{ opacity: 1, transform: 'translateX(0%)' }}
            exit={{ opacity: 0, transform: 'translateX(40%)', transition: { duration: 0.2 } }}
            transition={{ duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
            onClick={() => dismissToast(t.id)}
          >
            {t.kind === 'trophy' ? (
              <span className="toast-trophy-icon">
                <IconTrophy />
              </span>
            ) : (
              t.image && <img className="toast-img" src={media(t.image)} alt="" />
            )}
            <div className="toast-body">
              {t.kind === 'trophy' && <div className="toast-eyebrow">Трофей получен</div>}
              <div className="toast-title">{t.title}</div>
              {t.message && <div className="toast-text">{t.message}</div>}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

