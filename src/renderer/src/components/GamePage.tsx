import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { PLATFORM_NAMES, type AchievementSummaryItem, type Game, type GameDetails, type GameFiles, type RunningGame } from '@shared/types'
import { api } from '../lib/api'
import { accentOf, bytes, lastPlayed, media, playtime } from '../lib/format'
import { useSpatialNav } from '../lib/nav'
import { useNow } from '../lib/state'
import { Hint } from './Glyph'
import { IconClock, IconClose, IconCloud, IconEdit, IconFolder, IconPlay, IconSync, IconTrophy } from './Icons'
import { SaveVersionsDialog, stateLabel, useGameCloud } from './Cloud'
import { locale, plural, t } from '@shared/i18n'
import { DotText } from './DotText'

const dayFmt = new Intl.DateTimeFormat(locale(), { weekday: 'short' })
const dateFmt = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long' })
const timeFmt = new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' })
const DAYS = 14

/** Часы с одним знаком после запятой: 14,6 ч */
const hours = (sec: number) => t('{v} ч', { v: (sec / 3600).toLocaleString(locale(), { maximumFractionDigits: sec < 36000 ? 1 : 0 }) })

interface Props {
  game: Game
  running: RunningGame | null
  trophies?: AchievementSummaryItem
  onClose: () => void
  onLaunch: (g: Game) => void
  onTrophies: (g: Game) => void
  onEdit: (g: Game) => void
}

/** Страница игры: описание, время прохождения (HowLongToBeat), активность и история сессий. */
export function GamePage({ game, running, trophies, onClose, onLaunch, onTrophies, onEdit }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [details, setDetails] = useState<GameDetails | null>(null)
  const [logoOk, setLogoOk] = useState(true)
  const isRunning = running?.gameId === game.id
  const now = useNow(1000, isRunning)
  const played = game.playtime + (isRunning && running ? Math.floor((now - running.startedAt) / 1000) : 0)

  useEffect(() => {
    let alive = true
    setDetails(null)
    api
      .gameDetails(game.id)
      .then((d) => alive && setDetails(d))
      .catch(() => alive && setDetails({}))
    return () => {
      alive = false
    }
  }, [game.id])

  // Папка игры и её вес: размер считается в main, пока он не готов — кнопка без цифры
  const [files, setFiles] = useState<GameFiles | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    setFiles(undefined)
    api
      .gameFiles(game.id)
      .then((f) => alive && setFiles(f))
      .catch(() => alive && setFiles(null))
    return () => {
      alive = false
    }
  }, [game.id, game.path])

  const cloud = useGameCloud(game)
  const [versions, setVersions] = useState(false)

  useSpatialNav(ref, { priority: 15, onBack: onClose, autoFocus: '.gp-actions .btn-primary' })

  // Активность за две недели: сумма сессий по дням начала
  const activity = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const days = Array.from({ length: DAYS }, (_, i) => {
      const d = new Date(today)
      d.setDate(d.getDate() - (DAYS - 1 - i))
      return { start: d.getTime(), sec: 0 }
    })
    for (const s of game.sessions) {
      const i = Math.floor((s.start - days[0].start) / 86_400_000)
      if (i >= 0 && i < DAYS) days[i].sec += s.duration
    }
    return days
  }, [game.sessions])
  const maxDay = Math.max(...activity.map((d) => d.sec), 1)
  const busiest = activity.reduce((a, b) => (b.sec > a.sec ? b : a), activity[0])
  const fortnight = activity.reduce((a, d) => a + d.sec, 0)

  const sessions = useMemo(() => [...game.sessions].sort((a, b) => b.start - a.start), [game.sessions])
  const longest = sessions.reduce((m, s) => Math.max(m, s.duration), 0)
  const average = sessions.length ? Math.round(sessions.reduce((a, s) => a + s.duration, 0) / sessions.length) : 0

  const hltb = details?.hltb
  const facts = [
    [t('Разработчик'), details?.developer],
    [t('Издатель'), details?.publisher],
    [t('Дата выхода'), details?.released],
    [t('Жанр'), details?.genres?.join(', ')]
  ].filter(([, v]) => v) as [string, string][]

  return (
    <motion.div
      className="sheet game-page tinted"
      style={{ '--game-accent': accentOf(game) } as React.CSSProperties}
      initial={{ transform: 'translateY(100%)' }}
      animate={{ transform: 'translateY(0%)' }}
      exit={{ transform: 'translateY(100%)', transition: { duration: 0.24, ease: [0.32, 0.72, 0, 1] } }}
      transition={{ duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
    >
      {(game.hero || game.cover) && <img className={`gp-hero ${game.hero ? '' : 'is-blur'}`} src={game.hero ? media(game.hero, 'screen') : media(game.cover, 'tile')} alt="" />}
      <div className="gp-shade" />
      <div className="gp-inner" ref={ref}>
        <header className="gp-head">
          <div className="gp-title-wrap">
            {game.logo && logoOk ? (
              <img className="gp-logo" src={media(game.logo, 'logo')} alt={game.title} onError={() => setLogoOk(false)} />
            ) : (
              <h1 className="gp-title">{game.title}</h1>
            )}
            <div className="gp-meta">
              <span>{PLATFORM_NAMES[game.platform]}</span>
              <span>{playtime(played)}</span>
              <span>{isRunning ? t('Запущена сейчас') : t('Последний запуск: {v}', { v: lastPlayed(game.lastPlayed).toLowerCase() })}</span>
              {!game.path && <span className="gp-missing">{t('Не установлена на этом ПК')}</span>}
            </div>
          </div>
          <button data-nav className="btn btn-round gp-close" onClick={onClose} aria-label={t('Закрыть')}>
            <IconClose />
          </button>
        </header>

        <div className="gp-actions">
          <button data-nav className="btn btn-primary" onClick={() => onLaunch(game)}>
            <IconPlay /> {isRunning ? t('Вернуться в игру') : t('Играть')}
          </button>
          <button data-nav className="btn btn-glass" onClick={() => onTrophies(game)}>
            <IconTrophy /> {trophies?.total ? t('Трофеи {earned} из {total}', { earned: trophies.earned, total: trophies.total }) : t('Трофеи')}
          </button>
          <button data-nav className="btn btn-glass" onClick={() => onEdit(game)}>
            <IconEdit /> {t('Изменить')}
          </button>
          {files !== null && (
            <button data-nav className="btn btn-glass" disabled={!files} onClick={() => files && api.openFolder(files.path)}>
              <IconFolder /> {t('Локальные файлы')}
              {files?.size != null && <span className="gp-files-size">{bytes(files.size)}</span>}
            </button>
          )}
          {cloud && cloud.state !== 'off' && (
            <button data-nav className={`btn btn-glass gp-cloud is-${cloud.state}`} onClick={() => cloud.state !== 'steam' && setVersions(true)} title={cloud.error}>
              {cloud.state === 'syncing' ? <IconSync className="is-spinning" /> : <IconCloud />} {stateLabel(cloud.state, cloud.lastSync)}
            </button>
          )}
        </div>

        <div className="gp-body">
          <section className="gp-col">
            <div className="gp-card" data-nav tabIndex={-1}>
              <h2 className="gp-card-title">{t('Об игре')}</h2>
              {!details ? (
                <div className="gp-skeleton">
                  <span />
                  <span />
                  <span />
                </div>
              ) : details.description ? (
                <>
                  <p className="gp-desc">{details.description}</p>
                  {facts.length > 0 && (
                    <dl className="gp-facts">
                      {facts.map(([k, v]) => (
                        <div key={k}>
                          <dt>{k}</dt>
                          <dd>{v}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  <p className="gp-source">{details.source === 'wiki' ? t('Описание из Википедии') : t('Описание из Steam')}</p>
                </>
              ) : (
                <p className="gp-empty">{t('Описание не нашлось. Если у игры есть страница в Steam, укажите её Steam AppID в редакторе игры.')}</p>
              )}
            </div>

            <div className="gp-card" data-nav tabIndex={-1}>
              <h2 className="gp-card-title">
                <IconClock /> {t('Время прохождения')}
              </h2>
              {!details ? (
                <div className="gp-skeleton">
                  <span />
                </div>
              ) : hltb && (hltb.main || hltb.plus || hltb.full) ? (
                <>
                  <div className="hltb">
                    {(
                      [
                        [t('Сюжет'), hltb.main],
                        [t('Сюжет и побочное'), hltb.plus],
                        [t('На 100%'), hltb.full]
                      ] as const
                    ).map(([label, sec]) => (
                      <div key={label} className="hltb-item">
                        <span className="hltb-value">{sec ? <DotText text={hours(sec)} /> : '—'}</span>
                        <span className="hltb-label">{label}</span>
                      </div>
                    ))}
                  </div>
                  {hltb.main ? <HltbProgress played={played} main={hltb.main} full={hltb.full} /> : null}
                  <p className="gp-source">{hltb.title !== game.title ? t('По данным HowLongToBeat для «{title}»', { title: hltb.title }) : t('По данным HowLongToBeat')}</p>
                </>
              ) : (
                <p className="gp-empty">{t('HowLongToBeat ничего не знает об этой игре — или сайт сейчас недоступен.')}</p>
              )}
            </div>
          </section>

          <section className="gp-col">
            <div className="gp-card" data-nav tabIndex={-1}>
              <h2 className="gp-card-title">{t('Активность за две недели')}</h2>
              <div className="gp-chart" role="img" aria-label={t('Сыграно за две недели: {v}', { v: playtime(fortnight) })}>
                {activity.map((d, i) => {
                  const isToday = i === DAYS - 1
                  const label = d === busiest && d.sec > 0
                  return (
                    <div key={d.start} className={`gp-bar ${isToday ? 'is-today' : ''}`} title={`${dateFmt.format(d.start)}: ${playtime(d.sec)}`}>
                      <div className="gp-bar-track">
                        {label && <span className="gp-bar-value">{hours(d.sec)}</span>}
                        <span className="gp-bar-fill" style={{ height: d.sec ? `${Math.max(4, (d.sec / maxDay) * 100)}%` : 0 }} />
                      </div>
                      <span className="gp-bar-day">{dayFmt.format(d.start)}</span>
                    </div>
                  )
                })}
              </div>
              <dl className="gp-stats">
                <div>
                  <dt>{t('За две недели')}</dt>
                  <dd>{fortnight ? playtime(fortnight) : '—'}</dd>
                </div>
                <div>
                  <dt>{t('Средняя сессия')}</dt>
                  <dd>{average ? playtime(average) : '—'}</dd>
                </div>
                <div>
                  <dt>{t('Самая долгая')}</dt>
                  <dd>{longest ? playtime(longest) : '—'}</dd>
                </div>
              </dl>
            </div>

            <div className="gp-card gp-sessions-card">
              <h2 className="gp-card-title">
                {t('История сессий')}
                {sessions.length > 0 && (
                  <span className="gp-card-sub">
                    {sessions.length} {plural(sessions.length, ['сессия', 'сессии', 'сессий'], ['session', 'sessions'])}
                  </span>
                )}
              </h2>
              {sessions.length ? (
                <ol className="gp-sessions">
                  {sessions.slice(0, 30).map((s) => (
                    <li key={s.start} className="gp-session" data-nav tabIndex={-1}>
                      <span className="gp-session-date">{lastPlayed(s.start)}</span>
                      <span className="gp-session-time">
                        {timeFmt.format(s.start)} – {timeFmt.format(s.start + s.duration * 1000)}
                      </span>
                      <span className="gp-session-len">{playtime(s.duration)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="gp-empty">{t('Сессий пока нет — PlayOS начнёт записывать их с первого запуска.')}</p>
              )}
            </div>
          </section>
        </div>

        <footer className="sheet-hints">
          <Hint glyph="confirm" label={t('Выбрать')} />
          <Hint glyph="back" label={t('Назад')} />
        </footer>
      </div>
      <AnimatePresence>{versions && <SaveVersionsDialog key="versions" game={game} onClose={() => setVersions(false)} />}</AnimatePresence>
    </motion.div>
  )
}

/** Сколько пройдено относительно HLTB: шкала до «на 100%», отметка «сюжет» */
function HltbProgress({ played, main, full }: { played: number; main: number; full?: number }) {
  const scale = Math.max(full ?? main * 1.6, played, 1)
  const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`
  const ratio = played / main
  const verdict =
    played === 0
      ? t('Сюжет занимает около {v}.', { v: hours(main) })
      : ratio >= 1
        ? t('Вы наиграли {v} — больше, чем нужно на сюжет.', { v: hours(played) })
        : t('Вы наиграли {v} — примерно {v2}% от времени на сюжет.', { v: hours(played), v2: Math.round(ratio * 100) })
  return (
    <div className="hltb-progress">
      <div className="hltb-track">
        <span className="hltb-fill" style={{ width: pct(played) }} />
        <span className="hltb-mark" style={{ left: pct(main) }} />
      </div>
      <p className="hltb-verdict">{verdict}</p>
    </div>
  )
}
