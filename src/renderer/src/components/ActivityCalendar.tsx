import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { Game } from '@shared/types'
import { hueOf, playtime } from '../lib/format'
import { play } from '../lib/sound'
import { locale, plural, t } from '@shared/i18n'
import { DotText } from './DotText'

/** Год по неделям: последняя колонка — текущая неделя */
const WEEKS = 53
const DAY = 86_400_000
/** Границы уровней клетки: до часа, до двух, до четырёх часов за день и больше */
const LEVELS = [3600, 7200, 14400]
/** Сколько колонок занимает подпись месяца — ближе следующую не ставим */
const MONTH_SPAN = 3

const level = (sec: number) => (sec <= 0 ? 0 : sec < LEVELS[0] ? 1 : sec < LEVELS[1] ? 2 : sec < LEVELS[2] ? 3 : 4)
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
const monthFmt = new Intl.DateTimeFormat(locale(), { month: 'short' })
const weekdayFmt = new Intl.DateTimeFormat(locale(), { weekday: 'short' })
const dateFmt = new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'long' })
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const days = (n: number) => plural(n, ['день', 'дня', 'дней'], ['day', 'days'])

interface Day {
  date: number
  seconds: number
  /** Игры этого дня, сначала те, в которые играли дольше */
  games: { game: Game; seconds: number }[]
}

/** Дни года по сессиям (сессия засчитывается в день начала), серия дней подряд и рекорд */
function useCalendar(games: Game[]) {
  return useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    // Недели с понедельника
    const first = new Date(today)
    first.setDate(today.getDate() - ((today.getDay() + 6) % 7) - (WEEKS - 1) * 7)

    const byDay = new Map<string, Map<string, number>>()
    for (const g of games) {
      for (const s of g.sessions) {
        if (s.duration <= 0) continue
        const k = dayKey(new Date(s.start))
        let m = byDay.get(k)
        if (!m) byDay.set(k, (m = new Map()))
        m.set(g.id, (m.get(g.id) ?? 0) + s.duration)
      }
    }
    const byId = new Map(games.map((g) => [g.id, g]))

    // Индекс — неделя × 7 + день недели; null — дни после сегодняшнего в текущей неделе
    const list: (Day | null)[] = []
    let total = 0
    let todayIdx = 0
    for (let i = 0; i < WEEKS * 7; i++) {
      const d = new Date(first)
      d.setDate(first.getDate() + i)
      if (d > today) {
        list.push(null)
        continue
      }
      if (d.getTime() === today.getTime()) todayIdx = i
      const m = byDay.get(dayKey(d))
      const played = m
        ? [...m]
            .map(([id, seconds]) => ({ game: byId.get(id)!, seconds }))
            .filter((x) => x.game)
            .sort((a, b) => b.seconds - a.seconds)
        : []
      const seconds = played.reduce((a, x) => a + x.seconds, 0)
      total += seconds
      list.push({ date: d.getTime(), seconds, games: played })
    }

    // Подписи месяцев — над первой неделей месяца, не теснее MONTH_SPAN колонок
    const months: { col: number; label: string }[] = []
    let prevMonth = -1
    for (let w = 0; w < WEEKS; w++) {
      const d = new Date(first)
      d.setDate(first.getDate() + w * 7)
      if (d.getMonth() === prevMonth) continue
      prevMonth = d.getMonth()
      const last = months[months.length - 1]
      if (last && w - last.col < MONTH_SPAN) months.pop()
      months.push({ col: w, label: monthFmt.format(d).replace('.', '') })
    }
    // Первая колонка обычно — хвост прошлого месяца: её подпись наезжает на следующую
    if (months.length > 1 && months[1].col - months[0].col < MONTH_SPAN) months.shift()

    // Серия: дни подряд до сегодня (сегодня ещё не играли — до вчера). Рекорд — по всем сессиям
    const played = new Set(byDay.keys())
    let streak = 0
    const cur = new Date(today)
    if (!played.has(dayKey(cur))) cur.setDate(cur.getDate() - 1)
    while (played.has(dayKey(cur))) {
      streak++
      cur.setDate(cur.getDate() - 1)
    }
    const stamps = [...byDay.keys()]
      .map((k) => {
        const [y, mo, d] = k.split('-').map(Number)
        return new Date(y, mo, d).getTime()
      })
      .sort((a, b) => a - b)
    let best = 0
    let run = 0
    let prev = 0
    for (const s of stamps) {
      // Округление: дни перехода на летнее время короче или длиннее на час
      run = prev && Math.round((s - prev) / DAY) === 1 ? run + 1 : 1
      best = Math.max(best, run)
      prev = s
    }
    return { list, months, total, todayIdx, streak, best }
  }, [games])
}

/** Подписи дней недели слева: понедельник, среда, пятница — как у календаря вкладов GitHub */
function weekdayLabels() {
  const monday = new Date(2024, 0, 1)
  return [0, 2, 4].map((offset) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + offset)
    return { row: offset, label: cap(weekdayFmt.format(d).replace('.', '')) }
  })
}

/**
 * Активность за год: каждая клетка — день, ярче — дольше играли. Клетки как пиксели экрана Тиви и при открытии
 * загораются волной слева направо. Наведение или выбор геймпадом (влево-вправо по дням) — подпись: сколько
 * и во что играли в этот день
 */
export function ActivityCalendar({ games }: { games: Game[] }) {
  const cal = useCalendar(games)
  const ref = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [cursor, setCursor] = useState<number | null>(null)
  const [focused, setFocused] = useState(false)
  const labels = useMemo(weekdayLabels, [])
  const firstIdx = cal.list.findIndex((d) => d)

  // Геймпад и стрелки: влево-вправо — на день назад или вперёд
  const pos = cursor ?? cal.todayIdx
  const posRef = useRef(pos)
  posRef.current = pos
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onAdjust = (e: Event) => {
      // Стрелки приходят только выбранному элементу: событие focus в фоновом окне могло и не дойти
      setFocused(true)
      const next = posRef.current + (e as CustomEvent<number>).detail
      if (next < firstIdx || next > cal.todayIdx) return play('bump')
      play('move')
      setCursor(next)
    }
    el.addEventListener('nav-adjust', onAdjust)
    return () => el.removeEventListener('nav-adjust', onAdjust)
  }, [firstIdx, cal.todayIdx])

  const sel = hover ?? (focused ? pos : null)
  const shown = cal.list[sel ?? cal.todayIdx]!
  const ago = Math.round((cal.list[cal.todayIdx]!.date - shown.date) / DAY)
  const when = ago === 0 ? t('Сегодня') : ago === 1 ? t('Вчера') : cap(dateFmt.format(shown.date))

  return (
    <section className="profile-block">
      <header className="block-head">
        <h2 className="block-title">{t('Активность')}</h2>
        <span className="block-meta cal-meta">
          {cal.total ? (
            <>
              {cal.streak > 0 && (
                <span>
                  {t('Подряд')} <DotText text={`${cal.streak} ${days(cal.streak)}`} />
                </span>
              )}
              {cal.best > 1 && (
                <span>
                  {t('Рекорд')} <DotText text={`${cal.best} ${days(cal.best)}`} />
                </span>
              )}
              <span>
                {t('За год')} <DotText text={playtime(cal.total).toLowerCase()} />
              </span>
            </>
          ) : (
            t('Пока без игр')
          )}
        </span>
      </header>
      <div
        ref={ref}
        className={`cal ${focused ? 'is-focused-cal' : ''}`}
        data-nav
        data-adjust
        tabIndex={-1}
        role="img"
        aria-label={t('Часы игры по дням за последний год')}
        style={{ '--weeks': WEEKS } as CSSProperties}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          setCursor(null)
        }}
        onMouseLeave={() => setHover(null)}
      >
        {cal.months.map((m) => (
          <span key={m.col} className="cal-month" style={{ gridRow: 1, gridColumn: `${m.col + 2} / span ${MONTH_SPAN}` }}>
            {m.label}
          </span>
        ))}
        {labels.map((l) => (
          <span key={l.row} className="cal-wday" style={{ gridColumn: 1, gridRow: l.row + 2 }}>
            {l.label}
          </span>
        ))}
        {cal.list.map((d, i) =>
          d ? (
            <span
              key={i}
              className={`cal-cell is-l${level(d.seconds)} ${i === cal.todayIdx ? 'is-today' : ''} ${i === sel ? 'is-sel' : ''}`}
              style={{ gridColumn: Math.floor(i / 7) + 2, gridRow: (i % 7) + 2, '--w': Math.floor(i / 7) } as CSSProperties}
              onMouseEnter={() => setHover(i)}
            />
          ) : null
        )}
      </div>
      <footer className="cal-foot">
        <p className="activity-caption cal-caption">
          <span>
            {when}: <strong>{shown.seconds ? playtime(shown.seconds).toLowerCase() : t('не играли')}</strong>
          </span>
          {shown.games.slice(0, 3).map(({ game, seconds }) => (
            <span key={game.id} className="cal-game">
              <i style={{ background: game.accent ?? `hsl(${hueOf(game)} 65% 60%)` }} />
              {game.title}
              {shown.games.length > 1 && <span className="cal-game-time">{playtime(seconds).toLowerCase()}</span>}
            </span>
          ))}
          {shown.games.length > 3 && <span className="cal-game-more">{t('и ещё {n}', { n: shown.games.length - 3 })}</span>}
        </p>
        <span className="cal-legend" aria-hidden>
          {t('Меньше')}
          {[0, 1, 2, 3, 4].map((l) => (
            <i key={l} className={`cal-cell is-l${l}`} title={[t('Не играли'), t('До часа'), t('1–2 ч'), t('2–4 ч'), t('4 ч и больше')][l]} />
          ))}
          {t('Больше')}
        </span>
      </footer>
    </section>
  )
}
