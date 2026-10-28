import { motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { platformName, type AchievementSummaryItem, type Game, type RunningGame } from '@shared/types'
import { gamesCount, lastPlayed, media, notInstalled, playtime, timer } from '../lib/format'
import { useConfirmHold, useInputLayer } from '../lib/input'
import { useNow } from '../lib/state'
import { play } from '../lib/sound'
import { IconDice, IconDots, IconFolder, IconGrid, IconInfo, IconPlay, IconPlus } from './Icons'
import { Tile } from './Tile'
import { t } from '@shared/i18n'

type RowItem = { kind: 'game'; game: Game } | { kind: 'library' } | { kind: 'random' } | { kind: 'add' }
type SpecialKind = Exclude<RowItem['kind'], 'game'>

/** Что в фокусе главного экрана — по нему App подбирает подсказки кнопок внизу */
export type HomeFocus = { zone: 'row' | 'actions'; item: 'game' | 'running' | 'missing' | SpecialKind }

export const SPECIAL: Record<SpecialKind, { label: string; title: string; sub: string; action: string }> = {
  library: { label: t('Библиотека'), title: t('Библиотека игр'), sub: '', action: t('Открыть библиотеку') },
  random: { label: t('Случайная'), title: t('Случайная игра'), sub: t('Не можете выбрать? PlayOS выберет за вас'), action: t('Выбрать случайно') },
  add: { label: t('Добавить'), title: t('Добавить игру'), sub: t('EXE с компьютера, образ PS2 для PCSX2 или игра PS3 для RPCS3'), action: t('Добавить игру') }
}

// Размеры в rem (1rem = 1/108 высоты экрана)
const BASE_W = 16.4
const FOCUS_W = 20.8
const GAP = 1.5
const SCALE = BASE_W / FOCUS_W
const PAD_X = 6.4 // боковой отступ страницы (--pad-x)
/** Сколько недавних игр стоит в ряду главного экрана */
const RECENT_MAX = 15
/** Сколько пикселей прокрутки колеса — один шаг по ряду */
const WHEEL_STEP = 40

/** Ширина окна в rem — чтобы понимать, какие плитки помещаются целиком */
function useViewportRem(scale: number) {
  const measure = () => window.innerWidth / parseFloat(getComputedStyle(document.documentElement).fontSize)
  const [width, setWidth] = useState(measure)
  useEffect(() => {
    const onResize = () => setWidth(measure())
    window.addEventListener('resize', onResize)
    // Масштаб интерфейса меняет размер rem — пересчитываем после применения стиля
    const t = setTimeout(onResize, 0)
    return () => {
      clearTimeout(t)
      window.removeEventListener('resize', onResize)
    }
  }, [scale])
  return width
}

interface Props {
  games: Game[]
  running: RunningGame | null
  active: boolean
  focusRequest: string | null
  uiScale: number
  trophies: Record<string, AchievementSummaryItem>
  onFocusGame: (g: Game | null) => void
  onFocusKind: (f: HomeFocus) => void
  onExitTop: () => void
  onLaunch: (g: Game) => void
  onResume: () => void
  onCloseGame: () => void
  onMenu: (g: Game) => void
  onInfo: (g: Game) => void
  onAdd: () => void
  onLibrary: () => void
}

export function Home(props: Props) {
  const { games, running, active } = props
  const items = useMemo<RowItem[]>(() => {
    // Как на консоли: в ряду только недавние игры, вся коллекция — в «Библиотеке» в конце ряда
    const sorted = [...games].sort((a, b) => (b.lastPlayed ?? b.addedAt / 1e3) - (a.lastPlayed ?? a.addedAt / 1e3)).slice(0, RECENT_MAX)
    const special: RowItem[] = [{ kind: 'library' }, ...(games.length > 1 ? [{ kind: 'random' } as const] : []), { kind: 'add' }]
    return [...sorted.map((game) => ({ kind: 'game' as const, game })), ...special]
  }, [games])

  const [index, setIndex] = useState(0)
  const [zone, setZone] = useState<'row' | 'actions'>('row')
  const [action, setAction] = useState(0)
  const [shuffling, setShuffling] = useState(false)
  const viewport = useViewportRem(props.uiScale)
  const idx = Math.min(index, items.length - 1)
  const item = items[idx]
  const focusedGame = item.kind === 'game' ? item.game : null
  const isRunning = !!focusedGame && running?.gameId === focusedGame.id
  // Удержание ✕ на плитке игры — её параметры
  useConfirmHold(active && zone === 'row' && !!focusedGame)

  // Внешний запрос сфокусировать игру (после добавления или запуска)
  useEffect(() => {
    if (!props.focusRequest) return
    const i = items.findIndex((it) => it.kind === 'game' && it.game.id === props.focusRequest)
    if (i >= 0) {
      setIndex(i)
      setZone('row')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.focusRequest])

  useEffect(() => {
    if (active) props.onFocusGame(focusedGame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedGame?.id, focusedGame?.hero, focusedGame?.cover, active])

  const focusItem: HomeFocus['item'] = item.kind !== 'game' ? item.kind : isRunning ? 'running' : notInstalled(item.game) ? 'missing' : 'game'
  useEffect(() => {
    if (active) props.onFocusKind({ zone, item: focusItem })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone, focusItem, active])

  const actions = useMemo(() => {
    if (item.kind !== 'game') return [{ id: item.kind, label: SPECIAL[item.kind].action }]
    if (isRunning)
      return [
        { id: 'resume', label: t('Вернуться в игру') },
        { id: 'close', label: t('Закрыть игру') },
        { id: 'info', label: '' },
        { id: 'menu', label: '' }
      ]
    return [
      { id: 'play', label: focusedGame && notInstalled(focusedGame) ? t('Указать файл игры') : t('Играть') },
      { id: 'info', label: '' },
      { id: 'menu', label: '' }
    ]
  }, [item.kind, isRunning, focusedGame])

  const activate = (id: string) => {
    if (!focusedGame && !['library', 'add', 'random'].includes(id)) return
    switch (id) {
      case 'play':
        return props.onLaunch(focusedGame!)
      case 'resume':
        return props.onResume()
      case 'close':
        return props.onCloseGame()
      case 'menu':
        play('select')
        return props.onMenu(focusedGame!)
      case 'info':
        return props.onInfo(focusedGame!)
      case 'library':
        play('select')
        return props.onLibrary()
      case 'add':
        play('select')
        return props.onAdd()
      case 'random':
        return shuffle()
    }
  }

  /** «Барабан»: ряд пролистывается по случайным играм с замедлением и останавливается на одной. */
  const shuffle = () => {
    const pool = items.flatMap((it, i) => (it.kind === 'game' ? [i] : []))
    if (pool.length < 2) return
    const pick = () => pool[Math.floor(Math.random() * pool.length)]
    const target = pick()
    play('shuffle')
    setShuffling(true)
    setZone('row')
    const steps = [0, 70, 130, 180, 220, 260, 340]
    steps.forEach((delay, k) =>
      setTimeout(() => {
        const last = k === steps.length - 1
        setIndex(last ? target : pick())
        if (last) setShuffling(false)
      }, delay)
    )
  }

  const activateTile = () => {
    if (item.kind !== 'game') activate(item.kind)
    else activate(isRunning ? 'resume' : 'play')
  }

  const move = (d: number) => {
    const next = Math.max(0, Math.min(items.length - 1, idx + d))
    if (next !== idx) {
      play('move')
      setIndex(next)
      setAction(0)
    } else play('bump')
  }

  // Колесо мыши (и тачпад) листает ряд: шаг на каждые WHEEL_STEP пикселей прокрутки, не чаще раза в 70 мс
  const wheel = useRef({ acc: 0, at: 0 })
  const onWheel = (e: React.WheelEvent) => {
    if (!active || shuffling) return
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
    const w = wheel.current
    // Сменили направление — копим заново
    if (Math.sign(d) !== Math.sign(w.acc)) w.acc = 0
    w.acc += d
    const now = performance.now()
    if (Math.abs(w.acc) < WHEEL_STEP || now - w.at < 70) return
    const step = Math.sign(w.acc)
    w.acc = 0
    w.at = now
    const next = Math.max(0, Math.min(items.length - 1, idx + step))
    if (next === idx) return
    play('move')
    setIndex(next)
    setAction(0)
    setZone('row')
  }

  useInputLayer(
    (a) => {
      if (shuffling) return
      if (zone === 'row') {
        if (a === 'left') move(-1)
        else if (a === 'right') move(1)
        else if (a === 'up') props.onExitTop()
        else if (a === 'down') {
          play('move')
          setZone('actions')
          setAction(0)
        } else if (a === 'confirm') activateTile()
        // △ — страница игры, ☰ и удержание ✕ — параметры
        else if (a === 'menu' && focusedGame) activate('info')
        else if (a === 'options' && focusedGame) activate('menu')
        else if (a === 'search') activate('add')
        else return false
        return
      }
      if (a === 'left' || a === 'right') {
        const next = Math.max(0, Math.min(actions.length - 1, action + (a === 'left' ? -1 : 1)))
        if (next !== action) {
          play('move')
          setAction(next)
        }
      } else if (a === 'up' || a === 'back') {
        play('move')
        setZone('row')
      } else if (a === 'confirm') activate(actions[Math.min(action, actions.length - 1)].id)
      else if (a === 'menu' && focusedGame) activate('info')
      else if (a === 'options' && focusedGame) activate('menu')
      else if (a === 'search') activate('add')
      else return false
    },
    0,
    active
  )

  // Позиции плиток: выбранная стоит на якоре слева, предыдущие уезжают за край
  const tileX = (i: number) => {
    if (i < idx) return -(idx - i) * (BASE_W + GAP)
    if (i === idx) return 0
    return FOCUS_W + GAP + (i - idx - 1) * (BASE_W + GAP)
  }
  const from = Math.max(0, idx - 3)
  const to = Math.min(items.length, idx + 13)

  return (
    <div className="home" onWheel={onWheel}>
      <div className="row" aria-label={t('Игры')}>
        {items.slice(from, to).map((it, k) => {
          const i = from + k
          const focused = i === idx
          // Показываем только плитки, которые помещаются целиком: предыдущие уходят влево, обрезанные справа скрыты
          const right = tileX(i) + (focused ? FOCUS_W : BASE_W)
          const visible = i >= idx && right <= viewport - PAD_X * 1.5
          const style: React.CSSProperties = {
            transform: `translate3d(${tileX(i)}rem, -50%, 0) scale(${focused ? 1 : SCALE})`,
            opacity: visible ? 1 : 0,
            pointerEvents: visible ? undefined : 'none',
            zIndex: focused ? 2 : 1
          }
          const ringed = focused && zone === 'row' && active
          const onClick = () => (focused ? activateTile() : (setIndex(i), play('move')))
          if (it.kind === 'game') {
            return (
              <Tile
                key={it.game.id}
                game={it.game}
                focused={ringed}
                animate={focused && active}
                running={running?.gameId === it.game.id}
                className="row-tile"
                style={style}
                onClick={onClick}
                onMenu={() => {
                  play('select')
                  props.onMenu(it.game)
                }}
              />
            )
          }
          return (
            <div key={it.kind} className={`tile row-tile tile-special ${ringed ? 'is-focused' : ''}`} style={style} onClick={onClick} role="button">
              <div className="tile-art special-art">
                {it.kind === 'library' ? <IconGrid /> : it.kind === 'random' ? <IconDice /> : <IconPlus />}
                <span>{SPECIAL[it.kind].label}</span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="info">
        <motion.div
          key={item.kind === 'game' ? item.game.id : item.kind}
          className="info-inner"
          initial={{ opacity: 0, transform: 'translateY(0.6rem)' }}
          animate={{ opacity: 1, transform: 'translateY(0rem)' }}
          transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
        >
          {item.kind === 'game' ? (
            <GameInfo game={item.game} running={isRunning ? running : null} trophies={props.trophies[item.game.id]} />
          ) : (
            <div className="info-head">
              <h1 className="info-title">{SPECIAL[item.kind].title}</h1>
              <p className="info-sub">
                {item.kind === 'library' ? t('{v}: PC, PlayStation 2 и PlayStation 3', { v: gamesCount(games.length) }) : SPECIAL[item.kind].sub}
              </p>
            </div>
          )}
        </motion.div>

        <div className={`actions ${zone === 'actions' && active ? 'is-zone' : ''}`}>
          {actions.map((a, i) => {
            const focused = zone === 'actions' && active && i === Math.min(action, actions.length - 1)
            const primary = i === 0
            return (
              <button
                key={a.id}
                className={`btn ${primary ? 'btn-primary' : a.label ? 'btn-glass' : 'btn-round'} ${focused ? 'is-focused' : ''}`}
                onClick={() => activate(a.id)}
                tabIndex={-1}
                aria-label={a.label || (a.id === 'info' ? t('Об игре') : t('Параметры игры'))}
              >
                {a.id === 'play' && (focusedGame && notInstalled(focusedGame) ? <IconFolder /> : <IconPlay />)}
                {a.label || (a.id === 'info' ? <IconInfo /> : <IconDots />)}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function GameInfo({ game, running, trophies }: { game: Game; running: RunningGame | null; trophies?: AchievementSummaryItem }) {
  const now = useNow(1000, !!running)
  const [logoOk, setLogoOk] = useState(true)
  useEffect(() => setLogoOk(true), [game.logo])
  const sessions = game.sessions.length

  return (
    <>
      <div className="info-head">
        {game.logo && logoOk ? (
          <img className="info-logo" src={media(game.logo, 'logo')} alt={game.title} onError={() => setLogoOk(false)} />
        ) : (
          <h1 className="info-title">{game.title}</h1>
        )}
      </div>
      <dl className="stats">
        <div className="stat">
          <dt>{t('Наиграно')}</dt>
          <dd>{playtime(game.playtime + (running ? Math.floor((now - running.startedAt) / 1000) : 0))}</dd>
        </div>
        <div className="stat">
          <dt>{running ? t('Текущая сессия') : t('Последний запуск')}</dt>
          <dd>{running ? <span className="live-text">{timer(now - running.startedAt)}</span> : lastPlayed(game.lastPlayed)}</dd>
        </div>
        <div className="stat">
          <dt>{t('Платформа')}</dt>
          <dd>{platformName(game)}</dd>
        </div>
        {notInstalled(game) && (
          <div className="stat">
            <dt>{t('На этом ПК')}</dt>
            <dd>{t('Не установлена')}</dd>
          </div>
        )}
        {trophies && trophies.total > 0 && (
          <div className="stat">
            <dt>{t('Трофеи')}</dt>
            <dd>
              {t('{earned} из {total}', { earned: trophies.earned, total: trophies.total })}
            </dd>
          </div>
        )}
        {sessions > 0 && !running && !trophies && (
          <div className="stat">
            <dt>{t('Сессий')}</dt>
            <dd>{sessions}</dd>
          </div>
        )}
      </dl>
    </>
  )
}
