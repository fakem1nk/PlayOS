import { useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type ReactNode } from 'react'
import type { Game } from '@shared/types'
import { locale, plural, t } from '@shared/i18n'
import { FAST_DAYS, FIGURE_ROW, figureEarnedAt, figureName, FIGURES, LONG_HOURS, moodOf, type FigureDef } from '../lib/shelf'
import { DotText } from './DotText'
import { Cover } from './Tile'
import { IconTrophy } from './Icons'
import { ArtSpine } from './Box3D'
import { LedFace } from './ShelfBits'
import { TiviFigure } from './TiviFigure'
import { hrs } from './ProfilePile'

const ddmmyyyy = (at: number) => {
  const d = new Date(at)
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
}
const monthFmt = new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric' })
export const gamesW = (n: number) => `${n} ${plural(n, ['игра', 'игры', 'игр'], ['game', 'games'])}`
export const daysW = (n: number) => `${n} ${plural(n, ['день', 'дня', 'дней'], ['day', 'days'])}`

/** Место корешка на полке с промежутком, rem; запас — под корешок, развёрнутый обложкой; табличка года */
const SLOT = 5.3
const TURN_ROOM = 5.6
const YEAR_SLOT = 4.2

type ShelfItem = { kind: 'game'; g: Game } | { kind: 'year'; year: number; count: number; hours: number }

function useWidthRem(ref: React.RefObject<HTMLElement | null>) {
  const [w, setW] = useState(110)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setW(el.clientWidth / (parseFloat(getComputedStyle(document.documentElement).fontSize) || 10))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return w
}

interface ShelfProps {
  /** Пройденные по порядку прохождения */
  shelfGames: Game[]
  /** Игра, которая сейчас летит на полку: её место уже есть, но пустое */
  arriving: string | null
  landed: string | null
  onMenu: (g: Game) => void
  onYear: (year: number) => void
}

/**
 * Полка пройденного — одна сплошная, как книжный шкаф: новое слева, годы разделены узкими табличками.
 * Игры стоят корешками-баннерами на тонкой линии; в фокусе корешок выдвигается и разворачивается обложкой, подпись — под линией
 */
export function ProfileShelf({ shelfGames, arriving, landed, onMenu, onYear }: ShelfProps) {
  const body = useRef<HTMLDivElement>(null)
  const width = useWidthRem(body)
  const [focus, setFocus] = useState<{ row: number; x: number; item: ShelfItem } | null>(null)
  const hours = shelfGames.reduce((a, g) => a + (g.done?.playtime ?? 0), 0) / 3600
  const full = shelfGames.filter((g) => g.done?.full).length

  const items = useMemo(() => {
    const map = new Map<number, Game[]>()
    for (const g of shelfGames) {
      const y = new Date(g.done!.at).getFullYear()
      map.set(y, [g, ...(map.get(y) ?? [])])
    }
    const now = new Date().getFullYear()
    if (!map.has(now)) map.set(now, [])
    const out: ShelfItem[] = []
    for (const [year, games] of [...map.entries()].sort((a, b) => b[0] - a[0])) {
      out.push({ kind: 'year', year, count: games.length, hours: games.reduce((a, g) => a + (g.done?.playtime ?? 0), 0) / 3600 })
      out.push(...games.map((g) => ({ kind: 'game' as const, g })))
    }
    return out
  }, [shelfGames])

  // Ряды по ширине; запас — под корешок, развёрнутый обложкой
  const rows = useMemo(() => {
    const room = width - 1.2 - TURN_ROOM
    const out: ShelfItem[][] = [[]]
    let used = 0
    for (const it of items) {
      const w = it.kind === 'year' ? YEAR_SLOT : SLOT
      if (used + w > room && out[out.length - 1].length) {
        out.push([])
        used = 0
      }
      out[out.length - 1].push(it)
      used += w
    }
    return out
  }, [items, width])

  const onSlotFocus = (row: number, item: ShelfItem) => (e: FocusEvent<HTMLElement>) => {
    const el = e.currentTarget
    const rowEl = el.closest('.shelf-row') as HTMLElement | null
    if (!rowEl) return
    setFocus({ row, x: el.getBoundingClientRect().left - rowEl.getBoundingClientRect().left, item })
  }

  return (
    <section className="shelf">
      <header className="shelf-head">
        <h2 className="shelf-title">{t('Полка')}</h2>
        <span className="shelf-sum">
          <DotText text={String(shelfGames.length)} /> {t('пройдено')}
          <span className="pile-sep" />
          <DotText text={hrs(hours)} /> {t('ч')}
          <span className="pile-sep" />
          <DotText text={String(full)} /> {t('на 100%')}
        </span>
      </header>
      <div ref={body} onBlur={(e) => !body.current?.contains(e.relatedTarget as Node | null) && setFocus(null)}>
        {rows.map((row, ri) => (
          <div className="shelf-row" data-reveal key={ri}>
            <div className="shelf-items">
              {row.map((it) =>
                it.kind === 'year' ? (
                  <button
                    key={`y${it.year}`}
                    data-nav
                    data-year={it.year}
                    className="ydiv pp-ring"
                    onFocus={onSlotFocus(ri, it)}
                    onClick={() => onYear(it.year)}
                    aria-label={t('{year}: итоги года', { year: it.year })}
                  >
                    <DotText className="ydiv-year" text={String(it.year)} />
                  </button>
                ) : (
                  <button
                    key={it.g.id}
                    data-nav
                    data-shelf-id={it.g.id}
                    className={`spn pp-ring ${arriving === it.g.id ? 'is-arriving' : ''} ${landed === it.g.id ? 'is-landed' : ''}`}
                    onFocus={onSlotFocus(ri, it)}
                    onClick={() => onMenu(it.g)}
                    onContextMenu={(e) => (e.preventDefault(), onMenu(it.g))}
                    aria-label={t('{title}, пройдено {date}', { title: it.g.title, date: monthFmt.format(it.g.done!.at) })}
                  >
                    <span className="spn-face spn-spine">
                      <ArtSpine game={it.g} />
                    </span>
                    <span className="spn-face spn-cover">
                      <Cover game={it.g} />
                    </span>
                    {it.g.done?.full && (
                      <span className="spn-full" aria-label="100%">
                        <IconTrophy />
                      </span>
                    )}
                  </button>
                )
              )}
            </div>
            <span className="shelf-line" />
            <div className="shelf-cap">
              {focus?.row === ri && (
                <Caption x={focus.x} key={focus.item.kind === 'game' ? focus.item.g.id : `y${focus.item.year}`}>
                  {focus.item.kind === 'game' ? (
                    <GameInfo g={focus.item.g} />
                  ) : (
                    <>
                      <DotText className="cap-dots" text={String(focus.item.year)} />
                      <span className="cap-title">{focus.item.count ? `${gamesW(focus.item.count)} · ${hrs(focus.item.hours)} ${t('ч')}` : t('пока пусто')}</span>
                      <span className="cap-meta">{t('✕ — итоги года')}</span>
                    </>
                  )}
                </Caption>
              )}
            </div>
          </div>
        ))}
        {!shelfGames.length && <p className="shelf-empty">{t('Пройденные игры встанут сюда корешками — отметьте «Пройдено» у текущей игры или в меню любой игры.')}</p>}
      </div>
    </section>
  )
}

/** Подпись под полкой: начинается под тем, что в фокусе, и не вылезает за край */
function Caption({ x, children }: { x: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    const box = el?.parentElement
    if (!el || !box) return
    el.style.left = `${Math.max(0, Math.min(box.clientWidth - el.offsetWidth, x))}px`
  }, [x])
  return (
    <div className="shelf-caption" ref={ref}>
      {children}
    </div>
  )
}

function GameInfo({ g }: { g: Game }) {
  const d = g.done!
  const mood = moodOf(d.mood)
  return (
    <>
      {mood && <LedFace face={mood.face} className="cap-face" />}
      <span className="cap-title">{g.title}</span>
      <DotText className="cap-dots" text={ddmmyyyy(d.at)} />
      <span className="cap-meta">
        <DotText className="cap-dots" text={hrs(d.playtime / 3600)} /> {t('ч за {days}', { days: daysW(d.days) })}
      </span>
      {mood && <span className="cap-meta">{mood.label()}</span>}
      {d.full && <span className="cap-full">100%</span>}
    </>
  )
}

// ───────────── Фигурки Тиви — своя полка ─────────────

/** Чем заработать фигурку — полной фразой, для окна фигурки */
export const figureGoal = (f: FigureDef) =>
  ({
    count: t('{games} на полке', { games: gamesW(f.n) }),
    full: f.n === 1 ? t('первая игра на 100%') : t('{games} на 100%', { games: gamesW(f.n) }),
    fast: t('игра, пройденная за {days}', { days: daysW(FAST_DAYS) }),
    long: t('игра, в которую наиграно {n} часов', { n: LONG_HOURS }),
    retro: t('{games} для PS2 или PS3 на полке', { games: gamesW(f.n) }),
    night: t('игра, пройденная ночью'),
    month: t('{games} за 30 дней', { games: gamesW(f.n) })
  })[f.rule]

/** То же коротко — подпись под закрытой фигуркой на полке */
const figureHint = (f: FigureDef) =>
  ({
    count: t('{games} на полке', { games: gamesW(f.n) }),
    full: f.n === 1 ? t('первая на 100%') : t('{n} на 100%', { n: f.n }),
    fast: t('игра за {days}', { days: daysW(FAST_DAYS) }),
    long: t('{n} часов в игре', { n: LONG_HOURS }),
    retro: t('{n} ретро-игры', { n: f.n }),
    night: t('пройти ночью'),
    month: t('{n} за месяц', { n: f.n })
  })[f.rule]

export function FigureShelf({ shelfGames, fresh, onOpen }: { shelfGames: Game[]; fresh: string | null; onOpen: (f: FigureDef) => void }) {
  const earned = FIGURES.filter((f) => figureEarnedAt(f, shelfGames) !== null)
  const next = FIGURES.find((f) => f.rule === 'count' && figureEarnedAt(f, shelfGames) === null)
  const rows = Array.from({ length: Math.ceil(FIGURES.length / FIGURE_ROW) }, (_, i) => FIGURES.slice(i * FIGURE_ROW, (i + 1) * FIGURE_ROW))
  return (
    <section className="figs">
      <header className="shelf-head">
        <h2 className="shelf-title">{t('Фигурки Тиви')}</h2>
        <span className="shelf-sum">
          <DotText text={String(earned.length)} /> {t('из {n}', { n: FIGURES.length })}
        </span>
      </header>
      {/* Верхняя полка — за число игр, нижняя — за особые прохождения */}
      {rows.map((row, r) => (
        <div key={r} className="figs-row">
          <div className="figs-grid">
            {row.map((f) => {
              const got = earned.includes(f)
              return (
                <button
                  key={f.id}
                  data-nav
                  data-figure={f.id}
                  className={`fig pp-ring ${got ? '' : 'is-locked'} ${next === f ? 'is-next' : ''} ${fresh === f.id ? 'is-new' : ''}`}
                  onClick={() => onOpen(f)}
                  aria-label={got ? figureName(f.id) : t('Закрытая фигурка')}
                >
                  <TiviFigure id={f.id} locked={!got} className="fig-art" />
                </button>
              )
            })}
          </div>
          <span className="shelf-line" />
          <div className="figs-grid figs-labels">
            {row.map((f) => {
              const got = earned.includes(f)
              return (
                <span key={f.id} className={`fig-label ${got ? 'is-earned' : ''}`}>
                  {got ? figureName(f.id) : next === f ? t('ещё {games}', { games: gamesW(f.n - shelfGames.length) }) : figureHint(f)}
                </span>
              )
            })}
          </div>
        </div>
      ))}
    </section>
  )
}
