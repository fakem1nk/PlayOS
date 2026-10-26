import { useEffect, useMemo, useRef, useState } from 'react'
import type { AchievementSummaryItem, AppState, Game } from '@shared/types'
import { api } from '../lib/api'
import { gamesCount, playtime } from '../lib/format'
import { focusEl, useSpatialNav } from '../lib/nav'
import { play } from '../lib/sound'
import { toast } from '../lib/state'
import { earnedNow, TIER_NAMES, TROPHIES, type Tier } from '../lib/trophies'
import { Avatar } from './Avatar'
import { IconImage, IconTrophy } from './Icons'
import { Cover } from './Tile'
import { locale, t } from '@shared/i18n'
import { DotText } from './DotText'

const DAYS = 14
const weekday = new Intl.DateTimeFormat(locale(), { weekday: 'short' })
const dayMonth = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long' })

interface Props {
  state: AppState
  active: boolean
  onExitTop: () => void
  onOpenGame: (g: Game) => void
  trophies: Record<string, AchievementSummaryItem>
  onOpenTrophies: (g: Game) => void
}

export function Profile({ state, active, onExitTop, onOpenGame, trophies, onOpenTrophies }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const { games, settings } = state
  const [focusedTrophy, setFocusedTrophy] = useState<string | null>(null)
  const [hoverDay, setHoverDay] = useState<number | null>(null)

  useSpatialNav(ref, {
    priority: 0,
    active,
    onBack: onExitTop,
    onEdge: (dir) => {
      if (dir === 'up') return onExitTop()
      // Колонки разной высоты: из левой вправо — к первому пункту справа, обратно — к аватару
      const root = ref.current
      const inMain = !!root?.querySelector('.profile-main')?.contains(document.activeElement)
      const target =
        dir === 'right' && !inMain
          ? root?.querySelector<HTMLElement>('.profile-main [data-nav]')
          : dir === 'left' && inMain
            ? root?.querySelector<HTMLElement>('.profile-avatar-btn')
            : null
      if (!target) return play('bump')
      play('move')
      focusEl(target)
    },
    autoFocus: '.profile-avatar-btn'
  })

  const stats = useMemo(() => {
    const total = games.reduce((a, g) => a + g.playtime, 0)
    const sessions = games.reduce((a, g) => a + g.sessions.length, 0)
    const since = games.length ? Math.min(...games.map((g) => g.addedAt)) : Date.now()
    // Часы по дням за последние две недели (сессия засчитывается в день начала)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const days = Array.from({ length: DAYS }, (_, i) => {
      const d = new Date(today)
      d.setDate(d.getDate() - (DAYS - 1 - i))
      return { date: d.getTime(), seconds: 0 }
    })
    for (const g of games) {
      for (const s of g.sessions) {
        const d = new Date(s.start)
        d.setHours(0, 0, 0, 0)
        const slot = days.find((x) => x.date === d.getTime())
        if (slot) slot.seconds += s.duration
      }
    }
    const top = [...games].filter((g) => g.playtime > 0).sort((a, b) => b.playtime - a.playtime).slice(0, 5)
    return { total, sessions, since, days, top }
  }, [games])

  const earned = earnedNow(state)
  const maxDay = Math.max(3600, ...stats.days.map((d) => d.seconds))
  const twoWeeks = stats.days.reduce((a, d) => a + d.seconds, 0)
  const shownDay = stats.days[hoverDay ?? DAYS - 1]
  // Три последних полученных трофея PlayOS — под статистикой в левой колонке
  const recent = TROPHIES.filter((tr) => earned.has(tr.id) && settings.trophies[tr.id])
    .sort((a, b) => settings.trophies[b.id] - settings.trophies[a.id])
    .slice(0, 3)
  const trophy = TROPHIES.find((t) => t.id === focusedTrophy)

  const pickAvatar = async () => {
    const p = await api.pickFile('image')
    if (!p) return
    await api.saveSettings({ avatar: p })
    toast({ title: t('Аватар обновлён'), image: p, tone: 'success' })
  }

  return (
    <div className="profile-page" ref={ref}>
      <section className="profile-card">
        <button data-nav className="profile-avatar-btn" onClick={pickAvatar} aria-label={t('Сменить аватар')}>
          <Avatar name={settings.userName} src={settings.avatar} className="avatar-xl" />
          <span className="profile-avatar-edit">
            <IconImage />
          </span>
        </button>
        <NameField name={settings.userName} />
        <p className="profile-since">{t('В PlayOS с {date}', { date: dayMonth.format(stats.since) })}</p>

        <div className="profile-hero">
          <DotText className="profile-hero-value" text={stats.total ? playtime(stats.total) : t('0 мин')} />
          <span className="profile-hero-label">{t('наиграно всего')}</span>
        </div>
        <dl className="profile-stats">
          <div>
            <dt>{t('Библиотека')}</dt>
            <dd>{gamesCount(games.length)}</dd>
          </div>
          <div>
            <dt>{t('Сессий')}</dt>
            <dd>{stats.sessions}</dd>
          </div>
          <div>
            <dt>{t('Трофеи')}</dt>
            <dd>
              {t('{earned} из {total}', { earned: earned.size, total: TROPHIES.length })}
            </dd>
          </div>
        </dl>

        {recent.length > 0 && (
          <div className="profile-recent">
            <h2 className="profile-recent-title">{t('Последние трофеи')}</h2>
            <ul>
              {recent.map((tr) => (
                <li key={tr.id} className={`profile-recent-item trophy-${tr.tier}`}>
                  <IconTrophy />
                  <span className="profile-recent-text">
                    <span className="profile-recent-name">{tr.title}</span>
                    <span className="profile-recent-date">{dayMonth.format(settings.trophies[tr.id])}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <div className="profile-main">
        <section className="profile-block">
          <header className="block-head">
            <h2 className="block-title">{t('Активность за две недели')}</h2>
            <span className="block-meta">{twoWeeks ? t('Всего {v}', { v: playtime(twoWeeks).toLowerCase() }) : t('Пока без игр')}</span>
          </header>
          <div className="activity" onMouseLeave={() => setHoverDay(null)}>
            <div className="activity-bars" role="img" aria-label={t('Часы игры по дням за последние 14 дней')}>
              {stats.days.map((d, i) => {
                const isToday = i === DAYS - 1
                const h = d.seconds ? Math.max(4, (d.seconds / maxDay) * 100) : 0
                return (
                  <div
                    key={d.date}
                    className={`activity-col ${hoverDay === i ? 'is-hover' : ''} ${isToday ? 'is-today' : ''}`}
                    onMouseEnter={() => setHoverDay(i)}
                  >
                    <div className="activity-track">
                      {h > 0 ? <span className="activity-bar" style={{ height: `${h}%` }} /> : <span className="activity-empty" />}
                    </div>
                    <span className="activity-day">{weekday.format(d.date)}</span>
                  </div>
                )
              })}
            </div>
            <p className="activity-caption">
              {hoverDay === null || hoverDay === DAYS - 1 ? t('Сегодня') : dayMonth.format(shownDay.date)}:{' '}
              <strong>{shownDay.seconds ? playtime(shownDay.seconds).toLowerCase() : t('не играли')}</strong>
            </p>
          </div>
        </section>

        <section className="profile-block" data-reveal>
          <header className="block-head">
            <h2 className="block-title">{t('Больше всего играли')}</h2>
          </header>
          {stats.top.length ? (
            <div className="top-list">
              {stats.top.map((g) => (
                <button key={g.id} data-nav className="top-item" onClick={() => onOpenGame(g)}>
                  <span className="top-cover">
                    <Cover game={g} />
                  </span>
                  <span className="top-body">
                    <span className="top-title">{g.title}</span>
                    <span className="top-track">
                      <span className="top-fill" style={{ width: `${(g.playtime / stats.top[0].playtime) * 100}%` }} />
                    </span>
                  </span>
                  <span className="top-time">{playtime(g.playtime)}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="block-empty">{t('Здесь появятся игры, в которые вы играете чаще всего.')}</p>
          )}
        </section>

        <GameTrophies games={games} trophies={trophies} onOpen={onOpenTrophies} />

        <section className="profile-block" data-reveal>
          <header className="block-head">
            <h2 className="block-title">{t('Трофеи PlayOS')}</h2>
            <span className="block-meta">
              {t('{earned} из {total}', { earned: earned.size, total: TROPHIES.length })}
            </span>
          </header>
          <div className="trophies">
            {TROPHIES.map((tr) => {
              const got = earned.has(tr.id)
              return (
                <button
                  key={tr.id}
                  data-nav
                  className={`trophy trophy-${tr.tier} ${got ? 'is-earned' : ''}`}
                  onFocus={() => setFocusedTrophy(tr.id)}
                  onMouseEnter={() => setFocusedTrophy(tr.id)}
                  aria-label={`${tr.title}: ${tr.desc}`}
                >
                  <IconTrophy />
                </button>
              )
            })}
          </div>
          <p className="trophy-detail">
            {trophy ? (
              <>
                <strong>{trophy.title}</strong> <TierBadge tier={trophy.tier} /> {trophy.desc}
                {earned.has(trophy.id) && settings.trophies[trophy.id] && <span className="trophy-date">{t(', получен {date}', { date: dayMonth.format(settings.trophies[trophy.id]) })}</span>}
              </>
            ) : (
              t('Выберите трофей, чтобы узнать условие')
            )}
          </p>
        </section>
      </div>
    </div>
  )
}

/** Имя — само поле ввода в виде заголовка: ✕ на нём открывает клавиатуру, Enter или уход фокуса сохраняет */
function NameField({ name }: { name: string }) {
  const [draft, setDraft] = useState(name)
  useEffect(() => setDraft(name), [name])
  const commit = () => {
    const v = draft.trim() || t('Игрок')
    setDraft(v)
    if (v !== name) {
      void api.saveSettings({ userName: v })
      toast({ title: t('Имя изменено'), message: v, tone: 'success' })
    }
  }
  return (
    <h1 className="profile-title">
      <input
        data-nav
        className="profile-name-input"
        aria-label={t('Имя пользователя')}
        value={draft}
        maxLength={32}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
    </h1>
  )
}

function TierBadge({ tier }: { tier: Tier }) {
  return <span className={`tier-badge tier-${tier}`}>{TIER_NAMES[tier]}</span>
}

/** Трофеи настоящих игр (RetroAchievements и Steam): прогресс по каждой */
function GameTrophies({ games, trophies, onOpen }: { games: Game[]; trophies: Record<string, AchievementSummaryItem>; onOpen: (g: Game) => void }) {
  const list = games
    .filter((g) => trophies[g.id]?.total)
    .map((g) => ({ g, t: trophies[g.id] }))
    .sort((a, b) => b.t.earned / b.t.total - a.t.earned / a.t.total)
  const earned = list.reduce((s, x) => s + x.t.earned, 0)
  return (
    <section className="profile-block" data-reveal>
      <header className="block-head">
        <h2 className="block-title">{t('Трофеи игр')}</h2>
        {list.length > 0 && <span className="block-meta">{t('Получено {n}', { n: earned })}</span>}
      </header>
      {list.length ? (
        <div className="top-list">
          {list.map(({ g, t: set }) => (
            <button key={g.id} data-nav className="top-item" onClick={() => onOpen(g)}>
              <span className="top-cover">
                <Cover game={g} />
              </span>
              <span className="top-body">
                <span className="top-title">{g.title}</span>
                <span className="top-track">
                  <span className="top-fill" style={{ width: `${(set.earned / set.total) * 100}%` }} />
                </span>
              </span>
              <span className="top-time">
                {t('{earned} из {total}', { earned: set.earned, total: set.total })}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="block-empty">
          {t('Подключите RetroAchievements (PS2) и Steam в настройках, затем откройте трофеи игры через △ — прогресс появится здесь.')}
        </p>
      )}
    </section>
  )
}
