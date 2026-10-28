import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef } from 'react'
import type { Game } from '@shared/types'
import { media } from '../lib/format'
import { useInputLayer } from '../lib/input'
import { useSpatialNav } from '../lib/nav'
import { play } from '../lib/sound'
import { clearNotices, dismissToast, markNoticesRead, useNoticeHistory, useToasts, type Notice } from '../lib/state'
import { Hint } from './Glyph'
import { IconBell, IconDownload, IconTrash, IconTrophy } from './Icons'
import { installNow } from './UpdateNotice'
import { useUpdate } from '../lib/update'
import { Cover } from './Tile'
import { locale, t } from '@shared/i18n'

const easeOut = [0.23, 1, 0.32, 1] as const


/**
 * Экран запуска: обложка «всплывает», фон медленно наезжает, пока игра грузится.
 * Пока он открыт, меню под ним не управляется: работает только «назад» — отмена запуска.
 */
export function LaunchScreen({ game, onCancel }: { game: Game; onCancel: () => void }) {
  useInputLayer((a) => {
    if (a === 'back') onCancel()
  }, 90)
  return (
    <motion.div
      className="launch"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.4 } }}
      transition={{ duration: 0.35 }}
    >
      {(game.hero || game.cover) && <img className={`launch-bg ${game.hero ? '' : 'is-blur'}`} src={game.hero ? media(game.hero, 'screen') : media(game.cover, 'tile')} alt="" />}
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
        <div className="launch-status">{t('Запуск игры')}</div>
        <div className="launch-bar">
          <span />
        </div>
      </motion.div>
      <footer className="launch-hints">
        <Hint glyph="back" label={t('Отменить запуск')} />
      </footer>
    </motion.div>
  )
}

/** Уведомления в правом верхнем углу, как на PS5. */
export function Toasts() {
  const toasts = useToasts()
  return (
    <div className="toasts" role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((item) => (
          <motion.div
            key={item.id}
            layout
            className={`toast toast-${item.tone ?? 'info'} ${item.kind === 'trophy' ? `toast-trophy trophy-${item.tier}` : ''}`}
            initial={{ opacity: 0, transform: 'translateX(110%)' }}
            animate={{ opacity: 1, transform: 'translateX(0%)' }}
            exit={{ opacity: 0, transform: 'translateX(40%)', transition: { duration: 0.2 } }}
            transition={{ duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
            onClick={() => dismissToast(item.id)}
          >
            {item.kind === 'trophy' ? (
              <span className="toast-trophy-icon">
                <IconTrophy />
              </span>
            ) : (
              item.image && <img className="toast-img" src={media(item.image, 'tile')} alt="" />
            )}
            <div className="toast-body">
              {item.kind === 'trophy' && <div className="toast-eyebrow">{t('Трофей получен')}</div>}
              <div className="toast-title">{item.title}</div>
              {item.message && <div className="toast-text">{item.message}</div>}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

const timeFmt = new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' })
const dayFmt = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long' })

/** Когда пришло: «14:05» сегодня, «Вчера, 14:05», дальше — дата */
function noticeTime(ts: number) {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return timeFmt.format(d)
  if (d.toDateString() === yesterday.toDateString()) return t('Вчера, {time}', { time: timeFmt.format(d) })
  return `${dayFmt.format(d)}, ${timeFmt.format(d)}`
}

/**
 * Центр уведомлений: шторка справа со всем, что всплывало, — ошибки, итоги сессий, трофеи.
 * Открыли — всё прочитано; ▢ или кнопка с корзиной очищает историю.
 */
export function NoticeCenter({ onClose }: { onClose: () => void }) {
  const { items } = useNoticeHistory()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => markNoticesRead(), [items.length])
  const clear = () => {
    if (!items.length) return play('bump')
    play('back')
    clearNotices()
  }
  useSpatialNav(ref, {
    priority: 30,
    onBack: onClose,
    autoFocus: '.notice-item, .notice-clear',
    onAction: (a) => {
      if (a !== 'search') return false
      clear()
    }
  })
  return (
    <>
      <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.18 } }} onClick={onClose} />
      <motion.aside
        className="side-menu notice-center"
        ref={ref}
        initial={{ transform: 'translateX(100%)' }}
        animate={{ transform: 'translateX(0%)' }}
        exit={{ transform: 'translateX(100%)', transition: { duration: 0.2, ease: [0.32, 0.72, 0, 1] } }}
        transition={{ duration: 0.36, ease: [0.32, 0.72, 0, 1] }}
      >
        <div className="side-title-row">
          <h2 className="side-title">{t('Уведомления')}</h2>
          {items.length > 0 && (
            <button data-nav className="btn btn-round notice-clear" onClick={clear} aria-label={t('Очистить')} title={t('Очистить')}>
              <IconTrash />
            </button>
          )}
        </div>
        {items.length ? (
          <div className="menu-list notice-list">
            {items.map((n) => (
              <NoticeRow key={n.id} n={n} />
            ))}
          </div>
        ) : (
          <div className="notice-empty">
            <IconBell />
            <p>{t('Уведомлений нет')}</p>
          </div>
        )}
        <footer className="sheet-hints">
          {items.length > 0 && <Hint glyph="search" label={t('Очистить')} />}
          <Hint glyph="back" label={t('Закрыть')} />
        </footer>
      </motion.aside>
    </>
  )
}

function NoticeRow({ n }: { n: Notice }) {
  const update = useUpdate()
  // Кнопка «Обновить» — пока эта версия скачана и ждёт установки
  const installable = n.kind === 'update' && update.phase === 'ready' && update.version === n.version
  return (
    <div data-nav tabIndex={-1} className={`notice-item is-${n.tone ?? 'info'} ${n.kind === 'trophy' ? `trophy-${n.tier}` : ''}`}>
      {n.kind === 'trophy' || n.kind === 'update' ? (
        <span className="notice-icon">{n.kind === 'trophy' ? <IconTrophy /> : <IconDownload />}</span>
      ) : n.image ? (
        <img className="notice-img" src={media(n.image, 'tile')} alt="" />
      ) : (
        <span className="notice-icon">
          <IconBell />
        </span>
      )}
      <span className="notice-body">
        <span className="notice-title">
          {n.kind === 'trophy' ? t('Трофей: {title}', { title: n.title }) : n.title}
        </span>
        {n.message && <span className="notice-text">{n.message}</span>}
        {installable && (
          <button data-nav className="btn btn-primary btn-sm notice-action" onClick={installNow}>
            {t('Перезапустить и обновить')}
          </button>
        )}
      </span>
      <span className="notice-time">{noticeTime(n.at)}</span>
    </div>
  )
}
