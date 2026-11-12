import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { motion } from 'motion/react'
import type { Game, GameMood } from '@shared/types'
import { getLang, locale, plural, t } from '@shared/i18n'
import { useSpatialNav } from '../lib/nav'
import { play } from '../lib/sound'
import { tivi } from '../lib/tivi'
import { SPIN, type Frame, type Sprite } from '../lib/tivi-faces'
import { FACES, figureEarnedAt, figureName, figureProgress, FIGURES, hoursLeft, MOODS, moodOf, tierName, type FigureDef } from '../lib/shelf'
import { DotText } from './DotText'
import { Cover } from './Tile'
import { TiviArt } from './Tivi'
import { Toggle } from './Controls'
import { IconDice, IconPlay } from './Icons'
import { AppPortal, DotWord, PixelSprite, useFrames } from './ShelfBits'
import { Box3D } from './Box3D'
import { TiviFigure } from './TiviFigure'
import { hrs } from './ProfilePile'
import { daysW, figureGoal } from './ProfileShelf'
import '../styles-shelf.css'

const ddmm = (d: Date) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`
const dayMonth = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long' })
const longDate = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long', year: 'numeric' })

const backdrop = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0, transition: { duration: 0.18 } } }
const panel = {
  initial: { opacity: 0, transform: 'scale(0.96)' },
  animate: { opacity: 1, transform: 'scale(1)' },
  exit: { opacity: 0, transform: 'scale(0.98)', transition: { duration: 0.12 } },
  transition: { duration: 0.24, ease: [0.23, 1, 0.32, 1] as const }
}

// ───────────── «Пройдено»: момент во весь экран ─────────────

/** Искры вокруг коробки: где стоят (% от области коробки) и когда мигают */
const SPARKS: { s: Sprite; x: number; y: number; d: number }[] = [
  { s: 'spark', x: 12, y: 14, d: 900 },
  { s: 'sparkS', x: 82, y: 9, d: 1100 },
  { s: 'spark', x: 86, y: 50, d: 1350 },
  { s: 'sparkS', x: 10, y: 64, d: 1500 },
  { s: 'heartS', x: 80, y: 84, d: 1700 },
  { s: 'sparkS', x: 48, y: 3, d: 1250 }
]

/**
 * Отметка «Пройдено»: коробка влетает с оборотом, табло зажигается по буквам, статистика, оценка лицами Тиви, 100 %.
 * flying — коробка уже улетела на полку (её копия), здесь её больше не показываем
 */
export function CompletedDialog({ game, flying = false, onCancel, onConfirm }: { game: Game; flying?: boolean; onCancel: () => void; onConfirm: (mood: GameMood, full: boolean, from: DOMRect | null) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const anchor = useRef<HTMLSpanElement>(null)
  const [mood, setMood] = useState<GameMood | null>(null)
  const [full, setFull] = useState(false)
  useSpatialNav(ref, { priority: 45, active: !flying, onBack: onCancel, autoFocus: '.cer-mood' })
  useEffect(() => play('trophy'), [])
  const first = game.sessions.length ? Math.min(...game.sessions.map((s) => s.start)) : (game.lastPlayed ?? Date.now())
  const days = Math.max(1, Math.round((Date.now() - first) / 86_400_000))
  const en = getLang() === 'en'

  return (
    <AppPortal>
      <motion.div className="cer" {...backdrop} exit={{ opacity: 0, transition: { duration: 0.3 } }}>
        <div className="cer-stage" ref={ref}>
          <div className={`cer-box-wrap ${flying ? 'is-gone' : ''}`}>
            <span className="cer-glow" />
            <span className="cer-anchor" ref={anchor}>
              <Box3D game={game} w={22} h={33} d={3.4} className="cer-box" />
            </span>
            <span className="cer-floor" />
            {SPARKS.map((k, i) => (
              <PixelSprite key={i} s={k.s} className="cer-spark" style={{ left: `${k.x}%`, top: `${k.y}%`, animationDelay: `${k.d}ms` } as CSSProperties} />
            ))}
          </div>
          <div className="cer-body">
            <DotWord text={en ? 'CLEARED' : 'ПРОЙДЕНО'} className={`cer-word ${full ? 'is-full' : ''}`} delay={420} step={80} />
            <div className="cer-full-line">{full && <DotWord key="f" text={en ? '100%' : 'НА 100%'} className="cer-word is-full is-small" step={50} />}</div>
            <h2 className="cer-title">{game.title}</h2>
            <dl className="cer-stats">
              <div>
                <dt>{t('наиграно')}</dt>
                <dd>
                  <DotText text={hrs(game.playtime / 3600)} /> {t('ч')}
                </dd>
              </div>
              <div>
                <dt>{t('в пути')}</dt>
                <dd>
                  <DotText text={String(days)} /> {plural(days, ['день', 'дня', 'дней'], ['day', 'days'])}
                </dd>
              </div>
              <div>
                <dt>{t('финал')}</dt>
                <dd>
                  <DotText text={ddmm(new Date())} />
                </dd>
              </div>
            </dl>
            <h3 className="cer-q">{t('Как вам игра?')}</h3>
            <div className="cer-moods">
              {MOODS.map((m) => (
                <MoodButton key={m.id} id={m.id} active={mood === m.id} dim={!!mood && mood !== m.id} onPick={() => (play('select'), setMood(m.id))} />
              ))}
            </div>
            <Toggle label={t('Пройдено на 100%')} hint={t('Все трофеи и всё побочное — на корешке будет значок')} value={full} onChange={setFull} />
            <div className="cer-actions">
              <button data-nav className="btn btn-glass" onClick={onCancel}>
                {t('Не сейчас')}
              </button>
              <button data-nav className="btn btn-primary" onClick={() => onConfirm(mood ?? 'happy', full, anchor.current?.getBoundingClientRect() ?? null)}>
                {t('Поставить на полку')}
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </AppPortal>
  )
}

function MoodButton({ id, active, dim, onPick }: { id: GameMood; active: boolean; dim: boolean; onPick: () => void }) {
  const m = moodOf(id)!
  const [hot, setHot] = useState(false)
  const fr = useFrames(m.frames, active || hot)
  return (
    <button data-nav className={`cer-mood pp-ring ${active ? 'is-active' : ''} ${dim ? 'is-dim' : ''}`} onClick={onPick} onFocus={() => setHot(true)} onBlur={() => setHot(false)} aria-pressed={active}>
      <TiviArt face={fr?.face ?? m.face} fx={fr?.fx} className="cer-mood-tivi" />
      <span className="cer-mood-label">{m.label()}</span>
    </button>
  )
}

// ───────────── Перелёт коробки на полку ─────────────

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Копия коробки летит из окна «Пройдено» на её место на полке, по дороге делает оборот и встаёт корешком к тебе.
 * Толщина копии = ширина места на полке, поэтому подмена на настоящий корешок незаметна; to — место корешка на экране
 */
export function Flyer({ game, from, to, onDone }: { game: Game; from: DOMRect; to: Rect; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10
  useEffect(() => {
    const el = ref.current?.firstElementChild as HTMLElement | null
    if (!el) return
    const s = from.height / to.height
    const dx = from.left + from.width / 2 - (to.left + to.width / 2)
    const dy = from.top + from.height / 2 - (to.top + to.height / 2)
    const a = el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${s}) rotateY(24deg)`, offset: 0 },
        { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 10 * rem}px) scale(${1 + (s - 1) * 0.5}) rotateY(240deg)`, offset: 0.5 },
        { transform: 'translate(0px, 0px) scale(1) rotateY(450deg)', offset: 1 }
      ],
      { duration: 1000, easing: 'cubic-bezier(0.45, 0, 0.2, 1)', fill: 'forwards' }
    )
    a.onfinish = onDone
    return () => a.cancel()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Коробка размером с обложку для этой высоты, толщиной — с корешок на полке; центр — над местом корешка
  const w = (to.height * 2) / 3
  return (
    <AppPortal>
      <div className="flyer" ref={ref} style={{ left: to.left + to.width / 2 - w / 2, top: to.top, width: w, height: to.height }}>
        <Box3D game={game} w={w / rem} h={to.height / rem} d={to.width / rem} />
      </div>
    </AppPortal>
  )
}

// ───────────── Итоги года — по табличке года на полке ─────────────

export function YearRecap({ year, games, onClose }: { year: number; games: Game[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useSpatialNav(ref, { priority: 40, onBack: onClose, autoFocus: '.btn-primary' })
  const hours = games.reduce((a, g) => a + (g.done?.playtime ?? 0), 0) / 3600
  const full = games.filter((g) => g.done?.full).length
  const best = games.filter((g) => g.done?.mood === 'love')
  const longest = [...games].sort((a, b) => b.done!.playtime - a.done!.playtime)[0]
  const fastest = [...games].sort((a, b) => a.done!.days - b.done!.days)[0]
  // Лицо года — самая частая оценка
  const counts = new Map<GameMood, number>()
  for (const g of games) if (g.done?.mood) counts.set(g.done.mood, (counts.get(g.done.mood) ?? 0) + 1)
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  return (
    <AppPortal>
      <motion.div className="modal-backdrop" {...backdrop}>
        <motion.div className="dialog recap" ref={ref} {...panel}>
          <div className="recap-head">
            <TiviArt face={moodOf(top)?.face ?? FACES.idle} className="recap-tivi" />
            <div>
              <span className="recap-kicker">{t('Итоги года')}</span>
              <DotText className="recap-year" text={String(year)} />
            </div>
          </div>
          {games.length ? (
            <>
              <dl className="recap-stats">
                <div>
                  <dt>{t('пройдено')}</dt>
                  <dd>
                    <DotText text={String(games.length)} />
                  </dd>
                </div>
                <div>
                  <dt>{t('часов')}</dt>
                  <dd>
                    <DotText text={hrs(hours)} />
                  </dd>
                </div>
                <div>
                  <dt>{t('на 100%')}</dt>
                  <dd>
                    <DotText text={String(full)} />
                  </dd>
                </div>
              </dl>
              {best.length > 0 && (
                <div className="recap-best">
                  <span className="recap-label">{t('Шедевры года')}</span>
                  <div className="recap-covers">
                    {best.slice(0, 5).map((g) => (
                      <span key={g.id} className="recap-cover">
                        <Cover game={g} />
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <ul className="recap-facts">
                <li>
                  <span>{t('Дольше всех')}</span>
                  <b>{longest.title}</b>
                  <em>
                    <DotText text={hrs(longest.done!.playtime / 3600)} /> {t('ч')}
                  </em>
                </li>
                <li>
                  <span>{t('Быстрее всех')}</span>
                  <b>{fastest.title}</b>
                  <em>{daysW(fastest.done!.days)}</em>
                </li>
                <li>
                  <span>{t('Первая в году')}</span>
                  <b>{games[0].title}</b>
                  <em>{dayMonth.format(games[0].done!.at)}</em>
                </li>
              </ul>
            </>
          ) : (
            <p className="dialog-text">{t('В этом году на полку ещё ничего не встало. Первая пройденная игра откроет год.')}</p>
          )}
          <div className="dialog-actions">
            <button data-nav className="btn btn-primary" onClick={onClose}>
              {t('Закрыть')}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AppPortal>
  )
}

// ───────────── Фигурка крупно ─────────────

/**
 * Фигурка крупно. Открытая появляется сценкой: загорается свет, фигурка падает на подставку и пружинит, на экране
 * строка за строкой загорается картинка, уши наливаются, разлетаются искры цвета её редкости; дальше по корпусу
 * время от времени пробегает блик. Закрытая — силуэт, который покачивается, как запертая; под ним — сколько осталось
 */
const BURST = Array.from({ length: 14 }, (_, i) => {
  const a = (i / 14) * Math.PI * 2 + (i % 2 ? 0.2 : -0.1)
  const r = 13 + (i % 3) * 3.2
  return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.82 - 3, d: (i % 5) * 28, s: 0.7 + (i % 4) * 0.2 }
})

export function FigureDialog({ figure, shelfGames, onClose }: { figure: FigureDef; shelfGames: Game[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useSpatialNav(ref, { priority: 40, onBack: onClose, autoFocus: '.btn-primary' })
  const at = figureEarnedAt(figure, shelfGames)
  const no = FIGURES.indexOf(figure) + 1
  const [have, need] = figureProgress(figure, shelfGames)
  // Звук — когда фигурка встала на подставку
  useEffect(() => {
    if (at === null) return
    const timer = window.setTimeout(() => play('figure'), 520)
    return () => clearTimeout(timer)
  }, [at])
  return (
    <AppPortal>
      <motion.div className="modal-backdrop" {...backdrop}>
        <motion.div className={`dialog figd figd-tier${figure.tier} ${at === null ? 'is-locked' : 'is-earned'}`} ref={ref} {...panel}>
          <div className="figd-stage">
            <span className="figd-rays" />
            <span className="figd-light" />
            <TiviFigure id={figure.id} locked={at === null} live className="figd-art" />
            {at !== null && (
              <span className="figd-burst" aria-hidden>
                {BURST.map((b, i) => (
                  <i key={i} style={{ '--x': `${b.x}rem`, '--y': `${b.y}rem`, '--d': `${b.d}ms`, '--s': b.s } as CSSProperties} />
                ))}
              </span>
            )}
          </div>
          <div className="figd-body">
            <span className="recap-kicker">
              <b className="figd-tier">{tierName(figure.tier)}</b> · {t('Фигурка Тиви № {no} из {n}', { no, n: FIGURES.length })}
            </span>
            <h2 className="dialog-title">{at === null ? t('Закрытая фигурка') : figureName(figure.id)}</h2>
            <p className="dialog-text">
              {at === null ? t('Откроется: {goal}', { goal: figureGoal(figure) }) : t('Получена {date} — {goal}', { date: longDate.format(at), goal: figureGoal(figure) })}
            </p>
            {at === null && need > 1 && (
              <div className="figd-progress">
                <span className="figd-bar">
                  <i style={{ width: `${(have / need) * 100}%` }} />
                </span>
                <DotText text={`${have}`} /> {t('из {n}', { n: need })}
              </div>
            )}
            <div className="dialog-actions">
              <button data-nav className="btn btn-primary" onClick={onClose}>
                {t('Закрыть')}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AppPortal>
  )
}

// ───────────── Положить в стопку ─────────────

export function PilePicker({ games, buildName, onClose, onAdd }: { games: Game[]; buildName: string; onClose: () => void; onAdd: (ids: string[]) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [sel, setSel] = useState<string[]>([])
  useSpatialNav(ref, { priority: 40, onBack: onClose, autoFocus: '.pick-item' })
  const toggle = (id: string) => {
    play(sel.includes(id) ? 'toggleOff' : 'toggleOn')
    setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }
  return (
    <AppPortal>
      <motion.div className="modal-backdrop" {...backdrop}>
        <motion.div className="dialog pick-dialog" ref={ref} {...panel}>
          <h2 className="dialog-title">{t('В стопку «{name}»', { name: buildName })}</h2>
          <p className="dialog-text">{t('Непройденные игры из библиотеки. Лягут вниз стопки в том порядке, как отметите.')}</p>
          {games.length ? (
            <div className="pick-grid">
              {games.map((g) => {
                const n = sel.indexOf(g.id)
                return (
                  <button key={g.id} data-nav className={`pick-item pp-ring ${n >= 0 ? 'is-on' : ''}`} onClick={() => toggle(g.id)}>
                    <span className="pick-art">
                      <Cover game={g} />
                      {n >= 0 && (
                        <span className="pick-check">
                          <DotText text={String(n + 1)} />
                        </span>
                      )}
                    </span>
                    <span className="pick-title">{g.title}</span>
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="dialog-text">{t('Все непройденные игры уже в этой стопке.')}</p>
          )}
          <div className="dialog-actions">
            <button data-nav className="btn btn-glass" onClick={onClose}>
              {t('Отмена')}
            </button>
            <button data-nav className="btn btn-primary" disabled={!sel.length} onClick={() => onAdd(sel)}>
              {sel.length ? t('Положить {n}', { n: sel.length }) : t('Положить')}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AppPortal>
  )
}

// ───────────── «Тиви выбирает»: барабан по стопке ─────────────

const SPIN_FRAMES: Frame[] = SPIN.map((face) => ({ face, ms: 55 }))

export function TiviPick({ list, hltb, onClose, onChoose }: { list: Game[]; hltb: (g: Game) => number | null; onClose: () => void; onChoose: (g: Game, now: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [round, setRound] = useState(0)
  const [idx, setIdx] = useState(0)
  const [done, setDone] = useState(false)
  useSpatialNav(ref, { priority: 40, onBack: onClose, autoFocus: '.btn-primary', focusKey: done })

  useEffect(() => {
    setDone(false)
    play('shuffle')
    let i = Math.floor(Math.random() * list.length)
    const steps = 18 + Math.floor(Math.random() * list.length)
    let k = 0
    let id = 0
    const tick = () => {
      k++
      i = (i + 1) % list.length
      setIdx(i)
      if (k >= steps) {
        setDone(true)
        play('select')
        tivi({ act: 'wow', priority: 3 })
        return
      }
      // Барабан замедляется к концу
      id = window.setTimeout(tick, 55 + (k / steps) ** 2.4 * 380)
    }
    id = window.setTimeout(tick, 80)
    return () => clearTimeout(id)
  }, [round, list.length])

  const spin = useFrames(SPIN_FRAMES, !done)
  const happy = useMemo(() => [{ face: FACES.wow, ms: 600 }, { face: FACES.happy, ms: 2400 }], [])
  const after = useFrames(happy, done)
  const g = list[idx]
  const left = hoursLeft(g, hltb(g))
  return (
    <AppPortal>
      <motion.div className="modal-backdrop" {...backdrop}>
        <motion.div className="dialog tpick" ref={ref} {...panel}>
          <div className="tpick-stage">
            <TiviArt face={done ? (after?.face ?? FACES.happy) : (spin?.face ?? FACES.idle)} className="tpick-tivi" />
            <div className={`tpick-window ${done ? 'is-done' : ''}`}>
              <Cover key={g.id} game={g} />
            </div>
          </div>
          <h2 className="dialog-title tpick-title">{done ? g.title : t('Тиви выбирает…')}</h2>
          <p className="dialog-text tpick-text">{done ? (left !== null ? t('≈ {v} ч до финала', { v: hrs(left) }) : ' ') : t('Перебирает стопку')}</p>
          <div className="dialog-actions">
            <button data-nav className="btn btn-glass" disabled={!done} onClick={() => setRound((r) => r + 1)}>
              <IconDice /> {t('Ещё раз')}
            </button>
            <button data-nav className="btn btn-glass" disabled={!done} onClick={() => onChoose(g, false)}>
              {t('Наверх стопки')}
            </button>
            <button data-nav className="btn btn-primary" disabled={!done} onClick={() => onChoose(g, true)}>
              <IconPlay /> {t('Взять сейчас')}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AppPortal>
  )
}
