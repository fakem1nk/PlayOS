import { useEffect, useMemo, useRef, useState } from 'react'
import type { Game, Platform, RunningGame } from '@shared/types'
import { gamesCount, playtime } from '../lib/format'
import { useInputLayer } from '../lib/input'
import { play } from '../lib/sound'
import { IconPlus } from './Icons'
import { Tile } from './Tile'
import { t } from '@shared/i18n'

type Filter = 'all' | Platform | 'favorite'
type Sort = 'recent' | 'name' | 'time'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: t('Все') },
  { id: 'pc', label: 'PC' },
  { id: 'ps2', label: 'PS2' },
  { id: 'ps3', label: 'PS3' },
  { id: 'favorite', label: t('Избранное') }
]
const SORTS: { id: Sort; label: string }[] = [
  { id: 'recent', label: t('Недавние') },
  { id: 'name', label: t('По названию') },
  { id: 'time', label: t('По времени в игре') }
]
/** Сколько колонок сейчас в адаптивной сетке (зависит от ширины экрана) */
function useGridColumns(ref: React.RefObject<HTMLDivElement | null>, deps: unknown) {
  const [cols, setCols] = useState(8)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setCols(Math.max(1, getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, deps])
  return cols
}

interface Props {
  games: Game[]
  running: RunningGame | null
  active: boolean
  onFocusGame: (g: Game | null) => void
  onExitTop: () => void
  onLaunch: (g: Game) => void
  onMenu: (g: Game) => void
  onAdd: () => void
}

export function Library({ games, running, active, onFocusGame, onExitTop, onLaunch, onMenu, onAdd }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('recent')
  const [zone, setZone] = useState<'chips' | 'grid'>('grid')
  const [chip, setChip] = useState(0)
  const [index, setIndex] = useState(0)
  const gridRef = useRef<HTMLDivElement>(null)
  const COLS = useGridColumns(gridRef, games.length > 0)

  const list = useMemo(() => {
    const filtered = games.filter((g) =>
      filter === 'all' ? true : filter === 'favorite' ? g.favorite : g.platform === filter
    )
    const collator = new Intl.Collator('ru')
    return filtered.sort((a, b) =>
      sort === 'name'
        ? collator.compare(a.title, b.title)
        : sort === 'time'
          ? b.playtime - a.playtime
          : (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || b.addedAt - a.addedAt
    )
  }, [games, filter, sort])

  const idx = Math.min(index, Math.max(0, list.length - 1))
  const focused = list[idx] ?? null
  const chipCount = FILTERS.length + 1

  useEffect(() => {
    if (active) onFocusGame(zone === 'grid' ? focused : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused?.id, zone, active])

  // Выбранный ряд держим в верхней трети: видно и его, и следующий ряд — понятно, куда листать дальше
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (zone !== 'grid') return
    const el = gridRef.current?.children[idx] as HTMLElement | undefined
    const box = scrollRef.current
    if (!el || !box) return
    const top = el.offsetTop - box.clientHeight * 0.18
    if (Math.abs(box.scrollTop - top) > 4) box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  }, [idx, zone])

  const cycleFilter = (d: number) => {
    const i = FILTERS.findIndex((f) => f.id === filter)
    const next = FILTERS[(i + d + FILTERS.length) % FILTERS.length]
    play('move')
    setFilter(next.id)
    setIndex(0)
  }

  useInputLayer(
    (a) => {
      if (a === 'l2') return cycleFilter(-1)
      if (a === 'r2') return cycleFilter(1)
      if (a === 'search') {
        play('select')
        return onAdd()
      }
      if (zone === 'chips') {
        if (a === 'left' || a === 'right') {
          const next = Math.max(0, Math.min(chipCount - 1, chip + (a === 'left' ? -1 : 1)))
          if (next === chip) return
          play('move')
          setChip(next)
          if (next < FILTERS.length) {
            setFilter(FILTERS[next].id)
            setIndex(0)
          }
        } else if (a === 'confirm' && chip === FILTERS.length) {
          play('toggle')
          setSort(SORTS[(SORTS.findIndex((s) => s.id === sort) + 1) % SORTS.length].id)
        } else if (a === 'down' && list.length) {
          play('move')
          setZone('grid')
        } else if (a === 'up' || a === 'back') onExitTop()
        else return false
        return
      }
      // Влево/вправо идут сквозь ряды, как на PS5: всю библиотеку можно пролистать одной кнопкой
      if (a === 'left') idx > 0 ? move(idx - 1) : play('bump')
      else if (a === 'right') idx + 1 < list.length ? move(idx + 1) : play('bump')
      else if (a === 'down' && idx + COLS < list.length) move(idx + COLS)
      else if (a === 'down' && Math.floor(idx / COLS) < Math.floor((list.length - 1) / COLS)) move(list.length - 1)
      else if (a === 'down') play('bump')
      else if (a === 'up') {
        if (idx >= COLS) move(idx - COLS)
        else {
          play('move')
          setChip(FILTERS.findIndex((f) => f.id === filter))
          setZone('chips')
        }
      } else if (a === 'confirm') {
        if (focused) onLaunch(focused)
        else {
          play('select')
          onAdd()
        }
      }
      else if ((a === 'menu' || a === 'options') && focused) {
        play('select')
        onMenu(focused)
      } else if (a === 'back') onExitTop()
      else return false
    },
    0,
    active
  )

  function move(i: number) {
    play('move')
    setIndex(i)
  }

  const sortLabel = SORTS.find((s) => s.id === sort)!.label
  const chipsZone = zone === 'chips' && active

  return (
    <div className="library">
      <div className="library-head">
        <div className="chips">
          {FILTERS.map((f, i) => (
            <button
              key={f.id}
              tabIndex={-1}
              className={`chip ${filter === f.id ? 'is-active' : ''} ${chipsZone && chip === i ? 'is-focused' : ''}`}
              onClick={() => {
                setFilter(f.id)
                setIndex(0)
              }}
            >
              {f.label}
            </button>
          ))}
          <span className="chips-sep" />
          <button
            tabIndex={-1}
            className={`chip chip-sort ${chipsZone && chip === FILTERS.length ? 'is-focused' : ''}`}
            onClick={() => setSort(SORTS[(SORTS.findIndex((s) => s.id === sort) + 1) % SORTS.length].id)}
          >
            {t('Сортировка: {sort}', { sort: sortLabel })}
          </button>
        </div>
        <div className="library-meta">
          {focused && zone === 'grid' ? `${focused.title}: ${playtime(focused.playtime).toLowerCase()}` : gamesCount(list.length)}
        </div>
      </div>

      {list.length ? (
        <div className="grid-scroll" ref={scrollRef}>
          <div className="grid" ref={gridRef}>
            {list.map((g, i) => (
              <Tile
                key={g.id}
                game={g}
                focused={zone === 'grid' && active && i === idx}
                animate={active && i === idx}
                running={running?.gameId === g.id}
                className="grid-tile"
                onClick={() => (i === idx ? onLaunch(g) : (setIndex(i), setZone('grid')))}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="empty">
          <p className="empty-title">{games.length ? t('В этом разделе пока пусто') : t('Библиотека пуста')}</p>
          <p className="empty-text">
            {games.length ? t('Выберите другой фильтр или добавьте игру.') : t('Добавьте первую игру: EXE, образ PS2 или игру PS3.')}
          </p>
          <button className="btn btn-primary" onClick={onAdd} tabIndex={-1}>
            <IconPlus /> {t('Добавить игру')}
          </button>
        </div>
      )}
    </div>
  )
}
