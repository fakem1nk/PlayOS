import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { Game, Settings } from '@shared/types'
import { api } from '../lib/api'
import { media } from '../lib/format'
import { useInputLayer } from '../lib/input'
import { useSpatialNav } from '../lib/nav'
import { play } from '../lib/sound'
import { rumble } from '../lib/haptics'
import { clearNotices, dismissToast, markNoticesRead, openNotice, toast, useNoticeHistory, useToasts, type Notice } from '../lib/state'
import { Cycler, Toggle } from './Controls'
import { Hint } from './Glyph'
import { IconBell, IconDownload, IconSettings, IconTrash, IconTrophy } from './Icons'
import { installNow } from './UpdateNotice'
import { useUpdate } from '../lib/update'
import { Cover } from './Tile'
import { locale, t } from '@shared/i18n'

const easeOut = [0.23, 1, 0.32, 1] as const


/**
 * Экран запуска: обложка «всплывает», фон медленно наезжает, пока игра грузится.
 * Пока он открыт, меню под ним не управляется: работает только «назад» — отмена запуска.
 */
/** syncing — ждём свежие сохранения из облака: ✕ запускает игру, не дожидаясь (onSkip) */
export function LaunchScreen({ game, syncing, onSkip, onCancel }: { game: Game; syncing?: boolean; onSkip?: () => void; onCancel: () => void }) {
  useInputLayer((a) => {
    if (a === 'back') onCancel()
    else if (a === 'confirm' && syncing) onSkip?.()
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
        <div className="launch-status">{syncing ? t('Синхронизация сохранений') : t('Запуск игры')}</div>
        <div className="launch-bar">
          <span />
        </div>
      </motion.div>
      <footer className="launch-hints">
        {syncing && <Hint glyph="confirm" label={t('Играть без ожидания')} />}
        <Hint glyph="back" label={t('Отменить запуск')} />
      </footer>
    </motion.div>
  )
}

/** Уведомления в правом верхнем углу, как на PS5. Размер — из настроек в центре уведомлений */
export function Toasts({ size = 'normal' }: { size?: Settings['noticeSize'] }) {
  const toasts = useToasts()
  return (
    <div className={`toasts is-${size}`} role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((item) => (
          <motion.div
            key={item.id}
            layout
            className={`toast toast-${item.tone ?? 'info'} ${item.kind === 'trophy' ? `toast-trophy trophy-${item.tier}` : ''} ${item.open ? 'is-link' : ''}`}
            initial={{ opacity: 0, transform: 'translateX(110%)' }}
            animate={{ opacity: 1, transform: 'translateX(0%)' }}
            exit={{ opacity: 0, transform: 'translateX(40%)', transition: { duration: 0.2 } }}
            transition={{ duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
            onClick={() => {
              dismissToast(item.id)
              if (item.open) openNotice(item)
            }}
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
 * Центр уведомлений: шторка справа со всем, что всплывало, — ошибки, трофеи, обновления.
 * Открыли — всё прочитано; ▢ или кнопка с корзиной очищает историю, △ или шестерёнка — настройки уведомлений
 */
export function NoticeCenter({ settings, onClose }: { settings: Settings; onClose: () => void }) {
  const { items } = useNoticeHistory()
  const ref = useRef<HTMLDivElement>(null)
  // Настройки открываются в той же шторке вместо списка; ○ возвращает к списку, фокус — обратно на шестерёнку
  const [tuning, setTuning] = useState(false)
  const fromTuning = useRef(false)
  const tune = (on: boolean) => {
    fromTuning.current = !on
    setTuning(on)
  }
  useEffect(() => markNoticesRead(), [items.length])
  useEffect(() => rumble('open'), [])
  const clear = () => {
    if (!items.length) return play('bump')
    play('back')
    clearNotices()
  }
  const toggleTuning = () => {
    play(tuning ? 'back' : 'select')
    tune(!tuning)
  }
  useSpatialNav(ref, {
    priority: 30,
    onBack: tuning ? () => tune(false) : onClose,
    autoFocus: tuning ? '.notice-prefs [data-nav]' : items.length && !fromTuning.current ? '.notice-item' : '.notice-tune',
    focusKey: tuning,
    onAction: (a) => {
      // Та же кнопка, что открыла центр, его и закрывает
      if (a === 'view') {
        play('back')
        return onClose()
      }
      if (a === 'menu') return toggleTuning()
      if (a !== 'search' || tuning) return false
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
          <h2 className="side-title">{tuning ? t('Настройки уведомлений') : t('Уведомления')}</h2>
          <span className="notice-tools">
            {!tuning && items.length > 0 && (
              <button data-nav className="btn btn-round notice-clear" onClick={clear} aria-label={t('Очистить')} title={t('Очистить')}>
                <IconTrash />
              </button>
            )}
            <button
              data-nav
              className="btn btn-round notice-tune"
              onClick={toggleTuning}
              aria-pressed={tuning}
              aria-label={t('Настройки уведомлений')}
              title={t('Настройки уведомлений')}
            >
              <IconSettings />
            </button>
          </span>
        </div>
        {tuning ? (
          <NoticePrefs s={settings} />
        ) : items.length ? (
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
          {!tuning && items.length > 0 && <Hint glyph="search" label={t('Очистить')} />}
          {!tuning && <Hint glyph="menu" label={t('Настройки')} />}
          <Hint glyph="back" label={tuning ? t('Назад') : t('Закрыть')} />
        </footer>
      </motion.aside>
    </>
  )
}

/**
 * Настройки уведомлений — прямо в шторке. Новый размер сразу показываем на примере: окошко всплывает слева от шторки.
 * Ошибки и ответы на действия всплывают всегда — иначе нажатие выглядело бы так, будто ничего не произошло
 */
function NoticePrefs({ s }: { s: Settings }) {
  const sample = useRef(0)
  useEffect(() => () => dismissToast(sample.current), [])
  const save = (patch: Partial<Settings>) => void api.saveSettings(patch)
  const showSample = () => {
    dismissToast(sample.current)
    sample.current = toast({ title: t('Пример уведомления'), message: t('Так уведомления выглядят на экране'), history: false })
  }
  const popups = s.noticePopups !== false
  return (
    <div className="menu-list notice-prefs">
      <Toggle
        label={t('Показывать на экране')}
        hint={t('Выключено — уведомления не всплывают, а тихо собираются здесь. Ошибки и ответы на ваши действия видны всегда.')}
        value={popups}
        onChange={(v) => save({ noticePopups: v })}
      />
      {popups && (
        <Toggle
          label={t('Трофеи')}
          hint={t('Новые трофеи, пока открыт PlayOS. Поверх игры — в разделе «Трофеи».')}
          value={s.noticeTrophies !== false}
          onChange={(v) => save({ noticeTrophies: v })}
        />
      )}
      <Cycler
        label={t('Размер')}
        value={s.noticeSize ?? 'normal'}
        options={[
          { id: 'small', label: t('Маленький') },
          { id: 'normal', label: t('Обычный') },
          { id: 'large', label: t('Крупный') }
        ]}
        onChange={(v) => {
          save({ noticeSize: v })
          showSample()
        }}
      />
      <Cycler
        label={t('Время на экране')}
        hint={t('Ошибки держатся на пару секунд дольше')}
        value={s.noticeTime ?? 'normal'}
        options={[
          { id: 'short', label: t('Коротко') },
          { id: 'normal', label: t('Обычно') },
          { id: 'long', label: t('Долго') }
        ]}
        onChange={(v) => save({ noticeTime: v })}
      />
    </div>
  )
}

function NoticeRow({ n }: { n: Notice }) {
  const update = useUpdate()
  // Кнопка «Обновить» — пока эта версия скачана и ждёт установки
  const installable = n.kind === 'update' && update.phase === 'ready' && update.version === n.version
  return (
    <div
      data-nav
      tabIndex={-1}
      className={`notice-item is-${n.tone ?? 'info'} ${n.kind === 'trophy' ? `trophy-${n.tier}` : ''} ${n.open ? 'is-link' : ''}`}
      onClick={n.open ? () => (play('select'), openNotice(n)) : undefined}
    >
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
