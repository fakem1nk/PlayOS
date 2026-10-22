import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { PLATFORM_NAMES, type Achievement, type EmuState, type SaveSlot, type SystemNotice } from '@shared/types'
import { ControlCenterRow, useControlCenter } from './components/ControlCenter'
import { GlyphStyleContext, Hint } from './components/Glyph'
import { IconBattery, IconCheck, IconClose, IconHome, IconPlay, IconPlug, IconTrophy } from './components/Icons'
import { Wordmark } from './components/Logo'
import { Cover } from './components/Tile'
import { api } from './lib/api'
import { accentOf, clock, DEFAULT_ACCENT, media, playtime, timer } from './lib/format'
import { setPadMaps, useInputLayer } from './lib/input'
import { useAppState, useNow, usePadStatus } from './lib/state'
import { play } from './lib/sound'
import { locale, t } from '@shared/i18n'

/**
 * Оверлей 2.0 — прозрачная панель поверх запущенной игры (отдельное окно).
 * Вызывается кнопкой PS на DualSense, Guide на Xbox, удержанием Select+Start или Ctrl+Alt+H.
 */

type Row = 'actions' | 'controls' | 'slots'
interface Action {
  id: 'resume' | 'home' | 'close' | 'save'
  label: string
  icon: React.ReactNode
}

const SLOT_W = 21 // ширина карточки слота в rem (вместе с отступом)
const BATTERY_LEVEL = { empty: 0, low: 1, medium: 2, full: 3 } as const
const timeFmt = new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' })
const dayFmt = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short' })

function slotTime(ts: number) {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  const day = d.toDateString() === today.toDateString() ? t('Сегодня') : d.toDateString() === yesterday.toDateString() ? t('Вчера') : dayFmt.format(d)
  return `${day}, ${timeFmt.format(d)}`
}

export function OverlayApp() {
  const state = useAppState()
  useEffect(() => setPadMaps(state?.settings.padMaps), [state?.settings.padMaps])
  const pad = usePadStatus()
  const [open, setOpen] = useState(false)
  const [backdrop, setBackdrop] = useState<string | undefined>()
  const [emu, setEmu] = useState<EmuState | null>(null)
  const [row, setRow] = useState<Row>('actions')
  const [actionIdx, setActionIdx] = useState(0)
  const [slotIdx, setSlotIdx] = useState(0)
  const [busy, setBusy] = useState<number | 'action' | null>(null)
  const [notice, setNotice] = useState<{ text: string; ok: boolean; id: number } | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [closing, setClosing] = useState(false)
  const now = useNow(1000, open)
  const cc = useControlCenter(open)
  // Трофеи, полученные во время игры: показываются даже когда оверлей закрыт (окно без фокуса)
  const [trophyToasts, setTrophyToasts] = useState<{ key: string; a: Achievement; game: string }[]>([])
  // Системные уведомления поверх игры (разряд геймпада)
  const [notices, setNotices] = useState<{ key: string; n: SystemNotice }[]>([])

  useEffect(
    () =>
      api.onOverlayNotice((n) => {
        play('error')
        const item = { key: `n-${Date.now()}`, n }
        setNotices((list) => [item, ...list].slice(0, 2))
        setTimeout(() => setNotices((list) => list.filter((x) => x !== item)), 6000)
      }),
    []
  )

  useEffect(
    () =>
      api.onOverlayToast((n) => {
        play('trophy')
        const fresh = n.items.slice(0, 3).map((a, i) => ({ key: `${Date.now()}-${i}`, a, game: n.gameTitle }))
        setTrophyToasts((t) => [...fresh, ...t].slice(0, 3))
        setTimeout(() => setTrophyToasts((t) => t.filter((x) => !fresh.includes(x))), 6000)
      }),
    []
  )
  const confirmTimer = useRef<number | undefined>(undefined)

  const running = state?.running ?? null
  const game = running ? state?.games.find((g) => g.id === running.gameId) : undefined

  const refresh = () => api.emuState().then(setEmu)

  useEffect(
    () =>
      api.onOverlay(({ open: o, backdrop: shot }) => {
        setOpen(o)
        if (!o) return
        setBackdrop(shot)
        // Игра замораживается через мгновение после показа — обновим статус паузы
        setTimeout(refresh, 450)
        play('select')
        setRow('actions')
        setActionIdx(0)
        setConfirmClose(false)
        setClosing(false)
        setBusy(null)
        void api.emuState().then((e) => {
          setEmu(e)
          // Фокус на последнем сохранении (или на текущем слоте эмулятора)
          const latest = e.slots.reduce((best, s, i) => ((s.time ?? 0) > (e.slots[best]?.time ?? 0) ? i : best), e.current - 1)
          setSlotIdx(Math.max(0, latest))
        })
      }),
    []
  )

  const showNotice = (text: string, ok: boolean) => {
    const id = Date.now()
    setNotice({ text, ok, id })
    setTimeout(() => setNotice((n) => (n?.id === id ? null : n)), 2600)
  }

  const hasSlots = !!emu && emu.mode !== 'none' && emu.platform === 'ps2'
  const actions: Action[] = [
    { id: 'resume', label: t('Вернуться в игру'), icon: <IconPlay /> },
    ...(emu?.mode !== 'none' && emu?.platform === 'ps3' ? [{ id: 'save' as const, label: t('Сохранить состояние'), icon: <IconCheck /> }] : []),
    { id: 'home', label: t('Главный экран'), icon: <IconHome /> },
    { id: 'close', label: closing ? t('Закрываем…') : confirmClose ? t('Нажмите ещё раз') : t('Закрыть игру'), icon: <IconClose /> }
  ]
  const slots: SaveSlot[] = emu?.slots ?? []
  const slot = slots[slotIdx]

  const resume = () => {
    play('select')
    void api.resumeGame()
  }

  const runAction = async (id: Action['id']) => {
    if (id === 'resume') return resume()
    if (id === 'home') {
      play('back')
      return api.overlayHome()
    }
    if (id === 'save') {
      setBusy('action')
      const r = await api.saveState(1)
      setBusy(null)
      if (!r.resumed) showNotice(r.message, r.ok)
      return
    }
    // Закрытие игры — с подтверждением повторным нажатием
    if (closing) return
    if (!confirmClose) {
      play('error')
      setConfirmClose(true)
      clearTimeout(confirmTimer.current)
      confirmTimer.current = window.setTimeout(() => setConfirmClose(false), 3000)
      return
    }
    play('back')
    setClosing(true)
    void api.closeGame()
  }

  const save = async (s: SaveSlot) => {
    setBusy(s.slot)
    const r = await api.saveState(s.slot)
    setBusy(null)
    if (r.resumed) return
    play(r.ok ? 'trophy' : 'error')
    showNotice(r.message, r.ok)
    // PCSX2 пишет файл асинхронно — обновляем миниатюры чуть позже
    setTimeout(refresh, 1200)
    setTimeout(refresh, 3000)
  }

  const load = async (s: SaveSlot) => {
    if (!s.time || !emu?.canLoad) {
      play('error')
      return showNotice(t('Слот {slot} пуст', { slot: s.slot }), false)
    }
    setBusy(s.slot)
    play('launch')
    const r = await api.loadState(s.slot)
    setBusy(null)
    if (!r.resumed) showNotice(r.message, r.ok)
  }

  useInputLayer(
    (a) => {
      if (!open || busy !== null) return
      // Открытый список в пункте управления сам обрабатывает «назад»
      if (row === 'controls' && (cc.pop || cc.adjusting) && cc.handle(a)) return
      if (a === 'back' || a === 'home') return resume()
      if (row === 'controls') {
        if (a === 'up') {
          play('move')
          setRow('actions')
        } else if (a === 'down' && hasSlots) {
          play('move')
          setRow('slots')
        } else cc.handle(a)
        return
      }
      if (row === 'actions') {
        if (a === 'left' || a === 'right') {
          const next = Math.max(0, Math.min(actions.length - 1, actionIdx + (a === 'left' ? -1 : 1)))
          if (next !== actionIdx) {
            play('move')
            setActionIdx(next)
            setConfirmClose(false)
          }
        } else if (a === 'down') {
          play('move')
          setRow('controls')
        } else if (a === 'confirm') void runAction(actions[actionIdx].id)
        return
      }
      if (a === 'left' || a === 'right') {
        const next = Math.max(0, Math.min(slots.length - 1, slotIdx + (a === 'left' ? -1 : 1)))
        if (next !== slotIdx) {
          play('move')
          setSlotIdx(next)
        }
      } else if (a === 'up') {
        play('move')
        setRow('controls')
      } else if (a === 'confirm' && slot) void save(slot)
      else if (a === 'menu' && slot) void load(slot)
    },
    50,
    open
  )

  if (!state) return null
  const visibleSlots = Math.max(1, Math.floor((window.innerWidth / parseFloat(getComputedStyle(document.documentElement).fontSize) - 12.8) / SLOT_W))
  const slotShift = Math.max(0, slotIdx - visibleSlots + 2) * SLOT_W
  const battery = pad.battery

  return (
    <GlyphStyleContext.Provider value={state.settings.glyphs}>
      <AnimatePresence>
        {open && game && running && (
          <motion.div
            className="ov tinted"
            style={{ '--game-accent': state.settings.gameTint ? accentOf(game) : DEFAULT_ACCENT } as React.CSSProperties}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            // Растворяется плавно: окно прячется только после этой анимации
            exit={{ opacity: 0, transition: { duration: 0.26, ease: [0.4, 0, 1, 1] } }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
          >
            {backdrop && (
              <motion.img
                className="ov-backdrop"
                src={backdrop}
                alt=""
                initial={{ filter: 'blur(0px)', transform: 'scale(1)' }}
                animate={{ filter: 'blur(8px)', transform: 'scale(1.03)' }}
                exit={{ filter: 'blur(0px)', transform: 'scale(1)', transition: { duration: 0.26 } }}
                transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
              />
            )}
            <div className="ov-scrim" />
            <div className="ov-glow" />

            <header className="ov-top">
              <div className="ov-brand">
                <Wordmark />
              </div>
              <div className="ov-status">
                {battery === 'wired' && <IconPlug />}
                {battery && battery !== 'wired' && (
                  <span className={`battery battery-${battery}`}>
                    <IconBattery level={BATTERY_LEVEL[battery]} />
                  </span>
                )}
                {pad.percent !== undefined && battery !== 'wired' && <span className="ov-percent">{pad.percent}%</span>}
                <span className="ov-clock">{clock(new Date(now))}</span>
              </div>
            </header>

            <motion.div
              className="ov-bottom"
              initial={{ opacity: 0, transform: 'translateY(2.4rem)' }}
              animate={{ opacity: 1, transform: 'translateY(0rem)' }}
              exit={{ opacity: 0, transform: 'translateY(1.6rem)', transition: { duration: 0.22 } }}
              transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
            >
              <div className="ov-game">
                <div className="ov-cover">
                  <Cover game={game} />
                </div>
                <div className="ov-game-text">
                  <div className="ov-title">{game.title}</div>
                  <div className="ov-meta">
                    <span>{PLATFORM_NAMES[game.platform]}</span>
                    <span>
                      {t('Сессия')} <b className="live-text">{timer(now - running.startedAt)}</b>
                    </span>
                    <span>{t('Всего {time}', { time: playtime(game.playtime + Math.floor((now - running.startedAt) / 1000)).toLowerCase() })}</span>
                    {emu?.paused && <span className="ov-chip">{t('Игра на паузе')}</span>}
                  </div>
                </div>
              </div>

              <div className="ov-actions">
                {actions.map((a, i) => (
                  <button
                    key={a.id}
                    tabIndex={-1}
                    className={`ov-card ${a.id === 'resume' ? 'is-primary' : ''} ${a.id === 'close' && confirmClose ? 'is-danger' : ''} ${
                      row === 'actions' && i === actionIdx ? 'is-focused' : ''
                    }`}
                    onClick={() => {
                      setRow('actions')
                      setActionIdx(i)
                      void runAction(a.id)
                    }}
                  >
                    {busy === 'action' && a.id === 'save' ? <span className="spinner" /> : a.icon}
                    <span>{a.label}</span>
                  </button>
                ))}
              </div>

              <ControlCenterRow cc={cc} zone={row === 'controls'} />

              {hasSlots && (
                <section className={`ov-slots ${row === 'slots' ? 'is-zone' : ''}`}>
                  <div className="ov-slots-head">
                    <span className="ov-slots-title">{t('Быстрые сохранения')}</span>
                    <span className="ov-slots-hint">
                      {emu?.mode === 'pine' ? t('Через PINE: без выхода из оверлея') : emu?.hint}
                    </span>
                  </div>
                  <div className="ov-slots-viewport">
                    <div className="ov-slots-track" style={{ transform: `translateX(-${slotShift}rem)` }}>
                      {slots.map((s, i) => (
                        <button
                          key={s.slot}
                          tabIndex={-1}
                          className={`ov-slot ${s.time ? '' : 'is-empty'} ${row === 'slots' && i === slotIdx ? 'is-focused' : ''}`}
                          onClick={() => {
                            setRow('slots')
                            setSlotIdx(i)
                          }}
                        >
                          <span className="ov-slot-art">
                            {s.thumb ? <img src={media(s.thumb)} alt="" /> : <span className="ov-slot-empty">{t('Пусто')}</span>}
                            {busy === s.slot && (
                              <span className="ov-slot-busy">
                                <span className="spinner" />
                              </span>
                            )}
                          </span>
                          <span className="ov-slot-label">{t('Слот {slot}', { slot: s.slot })}</span>
                          <span className="ov-slot-time">{s.time ? slotTime(s.time) : t('Свободен')}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </section>
              )}

              <footer className="ov-hints">
                {row === 'controls' ? (
                  <>
                    {cc.adjusting ? (
                      <>
                        <span className="hint">
                          <span className="glyph glyph-pill">◀ ▶</span>
                          {cc.adjusting === 'volume' ? t('Громкость') : t('Яркость')}
                        </span>
                        <Hint glyph="confirm" label={t('Готово')} />
                      </>
                    ) : (
                      <>
                        <Hint
                          glyph="confirm"
                          label={cc.pop ? t('Выбрать') : cc.current === 'volume' || cc.current === 'brightness' ? t('Регулировать') : t('Открыть')}
                        />
                        {cc.current === 'volume' && !cc.pop && <Hint glyph="menu" label={cc.sys?.muted ? t('Включить звук') : t('Без звука')} />}
                        <Hint glyph="back" label={cc.pop ? t('Закрыть список') : t('Вернуться в игру')} />
                      </>
                    )}
                  </>
                ) : row === 'slots' ? (
                  <>
                    <Hint glyph="confirm" label={t('Сохранить в слот {v}', { v: slot?.slot ?? '' })} />
                    {emu?.canLoad && <Hint glyph="menu" label={t('Загрузить')} />}
                    <Hint glyph="back" label={t('Вернуться в игру')} />
                  </>
                ) : (
                  <>
                    <Hint glyph="confirm" label={t('Выбрать')} />
                    <span className="hint">
                      <span className="glyph">
                        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="m7 10 5 5 5-5" />
                        </svg>
                      </span>
                      {hasSlots ? t('Пункт управления и сохранения') : t('Пункт управления')}
                    </span>
                    <Hint glyph="back" label={t('Вернуться в игру')} />
                  </>
                )}
                <span className="ov-hint-ps">{t('Кнопка PS — закрыть оверлей')}</span>
              </footer>
            </motion.div>

            <AnimatePresence>
              {notice && (
                <motion.div
                  key={notice.id}
                  className={`ov-notice ${notice.ok ? 'is-ok' : 'is-error'}`}
                  initial={{ opacity: 0, transform: 'translate(-50%, -1rem)' }}
                  animate={{ opacity: 1, transform: 'translate(-50%, 0rem)' }}
                  exit={{ opacity: 0, transition: { duration: 0.15 } }}
                  transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                >
                  {notice.ok ? <IconCheck /> : <IconClose />}
                  {notice.text}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="ov-trophies">
        <AnimatePresence>
          {notices.map(({ key, n }) => (
            <motion.div
              key={key}
              layout
              className="ov-trophy ov-notice"
              initial={{ opacity: 0, transform: 'translateX(110%)' }}
              animate={{ opacity: 1, transform: 'translateX(0%)' }}
              exit={{ opacity: 0, transform: 'translateX(30%)', transition: { duration: 0.25 } }}
              transition={{ duration: 0.45, ease: [0.32, 0.72, 0, 1] }}
            >
              <span className="ov-trophy-icon">
                <IconBattery level={0} />
              </span>
              <span className="ov-trophy-text">
                <span className="ov-trophy-title">{n.title}</span>
                <span className="ov-trophy-game">{n.message}</span>
              </span>
            </motion.div>
          ))}
          {trophyToasts.map(({ key, a, game: title }) => (
            <motion.div
              key={key}
              layout
              className={`ov-trophy tier-${a.tier}`}
              initial={{ opacity: 0, transform: 'translateX(110%)' }}
              animate={{ opacity: 1, transform: 'translateX(0%)' }}
              exit={{ opacity: 0, transform: 'translateX(30%)', transition: { duration: 0.25 } }}
              transition={{ duration: 0.45, ease: [0.32, 0.72, 0, 1] }}
            >
              <span className="ov-trophy-icon">{a.icon ? <img src={a.icon} alt="" /> : <IconTrophy />}</span>
              <span className="ov-trophy-text">
                <span className="ov-trophy-eyebrow">
                  <IconTrophy /> {t('Трофей получен')}
                </span>
                <span className="ov-trophy-title">{a.title}</span>
                <span className="ov-trophy-game">{title}</span>
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </GlyphStyleContext.Provider>
  )
}
