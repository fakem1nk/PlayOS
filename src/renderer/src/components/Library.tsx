import { AnimatePresence, motion } from 'motion/react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Game, GameCollection, LibrarySort, Platform, RunningGame } from '@shared/types'
import { api } from '../lib/api'
import { createCollection } from '../lib/collections'
import { gamesCount, playtime } from '../lib/format'
import { lastInputDevice, useConfirmHold, useInputLayer } from '../lib/input'
import { useSpatialNav } from '../lib/nav'
import { beginEdit, isEditing, openKeyboard } from '../lib/osk'
import { play } from '../lib/sound'
import { Hint } from './Glyph'
import { IconCaret, IconCheck, IconClose, IconList, IconPlus, IconSearch, IconSort, IconStar } from './Icons'
import { CollectionMenu, PromptDialog } from './Menus'
import { Tile } from './Tile'
import { locale, t } from '@shared/i18n'

/** Фильтр: платформа, избранное или своя подборка (c:<id>) */
type Filter = 'all' | Platform | 'vr' | 'favorite' | `c:${string}`

const BASE_FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: t('Все') },
  { id: 'pc', label: 'PC' },
  { id: 'ps2', label: 'PS2' },
  { id: 'ps3', label: 'PS3' },
  { id: 'vr', label: 'VR' },
  { id: 'favorite', label: t('Избранное') }
]
const SORTS: { id: LibrarySort; label: string }[] = [
  { id: 'recent', label: t('Недавние') },
  { id: 'name', label: t('По названию') },
  { id: 'time', label: t('По времени в игре') },
  { id: 'added', label: t('Дата добавления') },
  { id: 'manual', label: t('Порядок подборки') }
]

/** Что сейчас в фокусе библиотеки — по нему App подбирает подсказки кнопок внизу */
export type LibraryFocus = 'grid' | 'search' | 'filter' | 'collections' | 'sort'

/** Фишки шапки: поиск, платформы и избранное одной группой, выпадающий список подборок, сортировка */
type Chip = { kind: 'search' } | { kind: 'filter'; id: Filter; label: string } | { kind: 'collections' } | { kind: 'sort' }

const norm = (s: string) => s.toLocaleLowerCase().replace(/ё/g, 'е')
/** Без пробелов и знаков: «halflife» находит «Half-Life» */
const compact = (s: string) => norm(s).replace(/[^\p{L}\p{N}]/gu, '')

/** Поиск по названию: часть названия или первые буквы слов — «gta» находит Grand Theft Auto */
function matches(title: string, query: string) {
  const q = compact(query)
  if (!q) return true
  if (compact(title).includes(q)) return true
  const initials = norm(title)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
  return q.length > 1 && initials.startsWith(q)
}

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

/**
 * Какие ряды сетки рисовать: видимые и по два ряда запаса. Остальные плитки — пустые места той же высоты:
 * большая библиотека не держит в памяти сотни обложек и не нагружает стекло, а прокрутка и раскладка те же.
 */
function useVisibleRows(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  gridRef: React.RefObject<HTMLDivElement | null>,
  cols: number,
  count: number
) {
  const [rows, setRows] = useState<[number, number]>([0, 5])
  useEffect(() => {
    const box = scrollRef.current
    const grid = gridRef.current
    if (!box || !grid) return
    const update = () => {
      const first = grid.children[0] as HTMLElement | undefined
      if (!first) return
      const next = grid.children[cols] as HTMLElement | undefined
      // Соседний ряд мог ещё не появиться или колонки только что пересчитались — тогда берём высоту плитки
      const rowH = next && next.offsetTop > first.offsetTop ? next.offsetTop - first.offsetTop : first.offsetHeight
      if (!rowH) return
      const top = box.scrollTop - first.offsetTop
      const from = Math.max(0, Math.floor(top / rowH) - 2)
      const to = Math.ceil((top + box.clientHeight) / rowH) + 2
      setRows((r) => (r[0] === from && r[1] === to ? r : [from, to]))
    }
    update()
    box.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(box)
    return () => {
      box.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [scrollRef, gridRef, cols, count])
  return rows
}

interface Props {
  games: Game[]
  running: RunningGame | null
  active: boolean
  collections: GameCollection[]
  sort: LibrarySort
  onFocusGame: (g: Game | null) => void
  onFocusKind: (k: LibraryFocus) => void
  onExitTop: () => void
  onLaunch: (g: Game) => void
  onMenu: (g: Game) => void
  onAdd: () => void
}

/**
 * Библиотека: сверху поиск, фильтры со своими подборками и сортировка, ниже сетка.
 * Стрелки по фишкам только двигают фокус — фильтр включает ✕, чтобы по дороге к поиску ничего не переключалось.
 */
export function Library(props: Props) {
  const { games, running, active, collections, sort, onFocusGame, onFocusKind, onExitTop, onLaunch, onMenu, onAdd } = props
  const [filter, setFilter] = useState<Filter>('all')
  const [zone, setZone] = useState<'chips' | 'grid'>('grid')
  const [chip, setChip] = useState(0)
  const [index, setIndex] = useState(0)
  const [query, setQuery] = useState('')
  // pick — открыт список подборок, new — название новой, menu — изменить подборку
  const [dialog, setDialog] = useState<{ kind: 'pick' } | { kind: 'new' } | { kind: 'menu'; id: string } | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const collectionsRef = useRef<HTMLButtonElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  const collection = filter.startsWith('c:') ? collections.find((c) => `c:${c.id}` === filter) : undefined
  // Подборку удалили — возвращаемся ко «Всем»
  useEffect(() => {
    if (filter.startsWith('c:') && !collection) setFilter('all')
  }, [filter, collection])

  // Фильтр «VR» — только когда в библиотеке есть VR-игры
  const hasVr = games.some((g) => g.vr)
  const chips = useMemo<Chip[]>(
    () => [
      { kind: 'search' },
      ...BASE_FILTERS.filter((f) => f.id !== 'vr' || hasVr).map((f) => ({ kind: 'filter' as const, ...f })),
      { kind: 'collections' },
      { kind: 'sort' }
    ],
    [hasVr]
  )
  // L2/R2 перебирают все фильтры подряд, и подборки тоже
  const cycleIds = useMemo<Filter[]>(
    () => [...chips.flatMap((c) => (c.kind === 'filter' ? [c.id] : [])), ...collections.map((c) => `c:${c.id}` as Filter)],
    [chips, collections]
  )
  const collectionsChip = chips.findIndex((c) => c.kind === 'collections')

  // «Порядок подборки» — только внутри подборки, в остальных фильтрах вместо него недавние
  const sorts = collection ? SORTS : SORTS.filter((s) => s.id !== 'manual')
  const sortId = sorts.some((s) => s.id === sort) ? sort : 'recent'

  const searching = query.trim().length > 0
  const list = useMemo(() => {
    let pool: Game[]
    // Поиск — по всей библиотеке: выбранный фильтр на время поиска не действует
    if (searching) pool = games.filter((g) => matches(g.title, query))
    else if (collection) {
      const byId = new Map(games.map((g) => [g.id, g]))
      pool = collection.games.map((id) => byId.get(id)).filter((g): g is Game => !!g)
    } else pool = games.filter((g) => (filter === 'all' ? true : filter === 'favorite' ? g.favorite : filter === 'vr' ? !!g.vr : g.platform === filter))
    if (sortId === 'manual' && !searching) return pool
    const collator = new Intl.Collator(locale())
    return [...pool].sort((a, b) =>
      sortId === 'name'
        ? collator.compare(a.title, b.title)
        : sortId === 'time'
          ? b.playtime - a.playtime
          : sortId === 'added'
            ? b.addedAt - a.addedAt
            : (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || b.addedAt - a.addedAt
    )
  }, [games, filter, collection, sortId, query, searching])

  // Сетка пропадает, когда показывать нечего (пустой поиск или фильтр), и появляется заново — тогда меряем новую
  const COLS = useGridColumns(gridRef, list.length > 0)
  const idx = Math.min(index, Math.max(0, list.length - 1))
  const focused = list[idx] ?? null
  const chipIdx = Math.min(chip, chips.length - 1)
  // Удержание ✕ на игре — её параметры
  useConfirmHold(active && !dialog && zone === 'grid' && !!focused)
  const cur = chips[chipIdx]

  useEffect(() => {
    if (active) onFocusGame(zone === 'grid' ? focused : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused?.id, zone, active])

  const focusKind: LibraryFocus = zone === 'grid' ? 'grid' : cur.kind
  useEffect(() => {
    if (active) onFocusKind(focusKind)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKind, active])

  // Выбранный ряд держим в верхней трети: видно и его, и следующий ряд — понятно, куда листать дальше
  const scrollRef = useRef<HTMLDivElement>(null)
  const [fromRow, toRow] = useVisibleRows(scrollRef, gridRef, COLS, list.length)
  useEffect(() => {
    if (zone !== 'grid') return
    const el = gridRef.current?.children[idx] as HTMLElement | undefined
    const box = scrollRef.current
    if (!el || !box) return
    const top = el.offsetTop - box.clientHeight * 0.18
    if (Math.abs(box.scrollTop - top) > 4) box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  }, [idx, zone])

  // Ушли из строки поиска к играм — поле закрывается, стрелки снова листают сетку
  useEffect(() => {
    if (zone === 'grid') searchRef.current?.blur()
  }, [zone])

  /** Ввод названия: с клавиатуры — прямо в поле, с геймпада — экранная клавиатура */
  const openSearch = () => {
    const el = searchRef.current
    if (!el) return
    play('select')
    setZone('chips')
    setChip(0)
    el.focus({ preventScroll: true })
    if (lastInputDevice() === 'keyboard') beginEdit(el)
    else openKeyboard(el)
  }

  const clearSearch = () => {
    play('back')
    setQuery('')
    setIndex(0)
  }

  /** Включить фильтр; выбор фильтра заканчивает поиск */
  const applyFilter = (id: Filter) => {
    setFilter(id)
    setQuery('')
    setIndex(0)
  }

  /** Фишка включённого фильтра: подборка живёт в выпадающем списке */
  const chipOf = (id: Filter) => (id.startsWith('c:') ? collectionsChip : Math.max(0, chips.findIndex((c) => c.kind === 'filter' && c.id === id)))

  /** Выбор фильтра; повторный выбор включённого фильтра сбрасывает его ко «Всем» */
  const pickFilter = (id: Filter) => {
    const next = id === filter && id !== 'all' && !searching ? 'all' : id
    play(next === 'all' && id !== 'all' ? 'back' : 'select')
    applyFilter(next)
    if (next !== id) setChip(chipOf('all'))
  }

  const cycleFilter = (d: number) => {
    const i = cycleIds.indexOf(filter)
    const next = cycleIds[(i + d + cycleIds.length) % cycleIds.length]
    play('move')
    applyFilter(next)
    if (zone === 'chips') setChip(chipOf(next))
  }

  const cycleSort = () => {
    play('toggle')
    const next = sorts[(sorts.findIndex((s) => s.id === sortId) + 1) % sorts.length].id
    void api.saveSettings({ librarySort: next })
  }

  /** Вверх из сетки: к поиску, если он идёт, иначе к включённому фильтру */
  const toChips = () => {
    play('move')
    setChip(searching ? 0 : chipOf(filter))
    setZone('chips')
  }

  // Клавиатура: «/» или Ctrl+F — сразу в поиск
  useEffect(() => {
    if (!active || dialog) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el instanceof HTMLInputElement && isEditing(el)) return
      if (e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f')) {
        // Раньше общего обработчика клавиш: там F — «Добавить игру»
        e.preventDefault()
        e.stopPropagation()
        openSearch()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  useInputLayer(
    (a) => {
      // Открыто своё окно (название подборки, меню подборки) — оно и отвечает
      if (dialog) return
      if (a === 'l2') return cycleFilter(-1)
      if (a === 'r2') return cycleFilter(1)
      if (a === 'search') {
        play('select')
        return onAdd()
      }
      if (zone === 'chips') {
        if (a === 'left' || a === 'right') {
          const next = chipIdx + (a === 'left' ? -1 : 1)
          if (next < 0 || next >= chips.length) return play('bump')
          play('move')
          setChip(next)
        } else if (a === 'confirm') {
          if (cur.kind === 'search') openSearch()
          else if (cur.kind === 'collections') {
            play('select')
            setDialog({ kind: 'pick' })
          } else if (cur.kind === 'sort') cycleSort()
          else if (cur.id === 'all' && filter === 'all' && !searching && list.length) {
            // ✕ на уже включённых «Всех» — к играм
            play('move')
            setZone('grid')
          } else pickFilter(cur.id)
        } else if ((a === 'menu' || a === 'options') && cur.kind === 'collections' && collection) {
          play('select')
          setDialog({ kind: 'menu', id: collection.id })
        } else if (a === 'down' && list.length) {
          play('move')
          setZone('grid')
        } else if (a === 'back' && searching) clearSearch()
        else if (a === 'up' || a === 'back') onExitTop()
        else return false
        return
      }
      // Влево/вправо — только внутри ряда: у края ряда фокус не перескакивает на соседний ряд
      if (a === 'left') idx % COLS > 0 ? move(idx - 1) : play('bump')
      else if (a === 'right') idx % COLS < COLS - 1 && idx + 1 < list.length ? move(idx + 1) : play('bump')
      else if (a === 'down' && idx + COLS < list.length) move(idx + COLS)
      else if (a === 'down' && Math.floor(idx / COLS) < Math.floor((list.length - 1) / COLS)) move(list.length - 1)
      else if (a === 'down') play('bump')
      else if (a === 'up') idx >= COLS ? move(idx - COLS) : toChips()
      else if (a === 'confirm') {
        if (focused) onLaunch(focused)
        else {
          play('select')
          onAdd()
        }
      } else if ((a === 'menu' || a === 'options') && focused) {
        play('select')
        onMenu(focused)
      } else if (a === 'back' && searching) clearSearch()
      else if (a === 'back') onExitTop()
      else return false
    },
    0,
    active
  )

  function move(i: number) {
    play('move')
    setIndex(i)
  }

  const chipsZone = zone === 'chips' && active
  // Мышь и геймпад — один фокус: кнопка не берёт фокус браузера (второе кольцо), а клик переносит фокус фишек
  const noFocus = (e: React.MouseEvent) => e.preventDefault()
  const pointTo = (i: number) => {
    setZone('chips')
    setChip(i)
  }
  const sortLabel = sorts.find((s) => s.id === sortId)!.label
  // Платформы и избранное — одна группа: включён всегда один фильтр, повторное нажатие — «Все»
  const segment = (
    <div className="seg" role="group" aria-label={t('Фильтр')}>
      {chips.map((c, i) =>
        c.kind !== 'filter' ? null : (
          <button
            key={c.id}
            tabIndex={-1}
            className={`seg-item ${filter === c.id && !searching ? 'is-active' : ''} ${chipsZone && chipIdx === i ? 'is-focused' : ''}`}
            title={c.label}
            aria-label={c.label}
            onMouseDown={noFocus}
            onClick={() => (pointTo(i), pickFilter(c.id))}
          >
            {c.id === 'favorite' ? <IconStar filled={filter === c.id && !searching} /> : c.label}
          </button>
        )
      )}
    </div>
  )
  const menuCollection = dialog?.kind === 'menu' ? collections.find((c) => c.id === dialog.id) : undefined

  return (
    <div className="library">
      <div className="library-head">
        <div className={`chips ${searching ? 'is-searching' : ''}`}>
          {chips.map((c, i) => {
            const focusCls = chipsZone && chipIdx === i ? 'is-focused' : ''
            if (c.kind === 'search')
              return (
                <label
                  key="search"
                  className={`chip lib-search ${searching ? 'has-query' : ''} ${focusCls}`}
                  onMouseDown={() => pointTo(i)}
                >
                  <IconSearch />
                  <input
                    ref={searchRef}
                    tabIndex={-1}
                    value={query}
                    placeholder={t('Поиск')}
                    aria-label={t('Поиск по названию')}
                    spellCheck={false}
                    onChange={(e) => {
                      setQuery(e.target.value)
                      setIndex(0)
                    }}
                    // Enter или «Готово» на экранной клавиатуре — сразу к найденному
                    onKeyDown={(e) => e.key === 'Enter' && searching && list.length > 0 && setZone('grid')}
                  />
                  {query && (
                    <button
                      tabIndex={-1}
                      className="lib-search-clear"
                      aria-label={t('Сбросить поиск')}
                      onMouseDown={noFocus}
                      onClick={clearSearch}
                    >
                      <IconClose />
                    </button>
                  )}
                </label>
              )
            if (c.kind === 'collections')
              return (
                <Fragment key="collections">
                  {segment}
                  <button
                    ref={collectionsRef}
                    tabIndex={-1}
                    className={`chip chip-pick ${collection && !searching ? 'is-active' : ''} ${focusCls}`}
                    onMouseDown={noFocus}
                    onClick={() => (pointTo(i), setDialog({ kind: 'pick' }))}
                  >
                    <IconList />
                    <span className="chip-pick-name">{collection?.name ?? t('Подборки')}</span>
                    <IconCaret className="chip-caret" />
                  </button>
                </Fragment>
              )
            if (c.kind === 'sort')
              return (
                <button
                  key="sort"
                  tabIndex={-1}
                  className={`chip chip-pick ${focusCls}`}
                  title={t('Сортировка')}
                  onMouseDown={noFocus}
                  onClick={() => (pointTo(i), cycleSort())}
                >
                  <IconSort />
                  {sortLabel}
                </button>
              )
            return null
          })}
        </div>
        <div className="library-meta">
          {searching
            ? t('Найдено: {n} из {m}', { n: list.length, m: games.length })
            : focused && zone === 'grid'
              ? `${focused.title}: ${playtime(focused.playtime).toLowerCase()}`
              : gamesCount(list.length)}
        </div>
      </div>

      {list.length ? (
        <div className="grid-scroll" ref={scrollRef}>
          <div className="grid" ref={gridRef}>
            {list.map((g, i) => {
              const row = Math.floor(i / COLS)
              if (row < fromRow || row > toRow) return <div key={g.id} className="grid-tile" aria-hidden />
              return (
                <Tile
                  key={g.id}
                  game={g}
                  focused={zone === 'grid' && active && i === idx}
                  animate={active && i === idx}
                  running={running?.gameId === g.id}
                  className="grid-tile"
                  onClick={() => (i === idx ? onLaunch(g) : (setIndex(i), setZone('grid')))}
                />
              )
            })}
          </div>
        </div>
      ) : (
        <div className="empty">
          {searching ? (
            <>
              <p className="empty-title">{t('Ничего не нашлось')}</p>
              <p className="empty-text">{t('Игр с названием «{q}» нет. Попробуйте написать иначе.', { q: query })}</p>
              <button className="btn btn-glass" onClick={clearSearch} tabIndex={-1}>
                <IconClose /> {t('Сбросить поиск')}
              </button>
            </>
          ) : collection ? (
            <>
              <p className="empty-title">{t('В подборке пока нет игр')}</p>
              <p className="empty-text">{t('Откройте параметры игры кнопкой △ и выберите «Добавить в подборку».')}</p>
            </>
          ) : (
            <>
              <p className="empty-title">{games.length ? t('В этом разделе пока пусто') : t('Библиотека пуста')}</p>
              <p className="empty-text">
                {games.length ? t('Выберите другой фильтр или добавьте игру.') : t('Добавьте первую игру: EXE, образ PS2 или игру PS3.')}
              </p>
              <button className="btn btn-primary" onClick={onAdd} tabIndex={-1}>
                <IconPlus /> {t('Добавить игру')}
              </button>
            </>
          )}
        </div>
      )}

      {createPortal(
        <AnimatePresence>
          {dialog?.kind === 'pick' && (
            <CollectionsPopover
              key="pick"
              anchor={collectionsRef.current}
              collections={collections}
              games={games}
              active={collection?.id}
              onClose={() => setDialog(null)}
              onPick={(id) => {
                setDialog(null)
                pickFilter(`c:${id}`)
                setChip(collectionsChip)
              }}
              onNew={() => setDialog({ kind: 'new' })}
              onEdit={(id) => setDialog({ kind: 'menu', id })}
            />
          )}
          {dialog?.kind === 'new' && (
            <PromptDialog
              key="new"
              title={t('Новая подборка')}
              placeholder={t('Например, «Кооператив»')}
              button={t('Создать')}
              onCancel={() => setDialog(null)}
              onSubmit={(name) => {
                const c = createCollection(collections, name)
                setDialog(null)
                applyFilter(`c:${c.id}`)
                setChip(collectionsChip)
                setZone('chips')
              }}
            />
          )}
          {menuCollection && <CollectionMenu key="menu" collection={menuCollection} all={collections} onClose={() => setDialog(null)} />}
        </AnimatePresence>,
        document.querySelector('.app') ?? document.body
      )}
    </div>
  )
}

/**
 * Выпадающий список подборок под фишкой «Подборки»: выбрать (повторно — снять), △ — переименовать или удалить,
 * внизу «Новая подборка». Своих подборок может быть сколько угодно — шапка библиотеки от этого не растёт.
 */
function CollectionsPopover(props: {
  anchor: HTMLElement | null
  collections: GameCollection[]
  games: Game[]
  active?: string
  onClose: () => void
  onPick: (id: string) => void
  onNew: () => void
  onEdit: (id: string) => void
}) {
  const { anchor, collections, games, active, onClose, onPick, onNew, onEdit } = props
  const ref = useRef<HTMLDivElement>(null)
  const [pos] = useState(() => {
    const r = anchor?.getBoundingClientRect()
    return r ? { left: r.left, top: r.bottom + 10 } : { left: 80, top: 200 }
  })
  const ids = useMemo(() => new Set(games.map((g) => g.id)), [games])
  useSpatialNav(ref, {
    priority: 35,
    onBack: onClose,
    autoFocus: active ? `[data-id="${active}"]` : '.pop-item',
    onAction: (a) => {
      if (a !== 'menu' && a !== 'options') return false
      const id = (document.activeElement as HTMLElement | null)?.dataset.id
      if (!id || id === 'new') return false
      play('select')
      onEdit(id)
    }
  })
  return (
    <>
      <motion.div className="pop-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div
        className="pop"
        ref={ref}
        style={{ left: pos.left, top: pos.top }}
        initial={{ opacity: 0, transform: 'translateY(-0.8rem) scale(0.98)' }}
        animate={{ opacity: 1, transform: 'translateY(0rem) scale(1)' }}
        exit={{ opacity: 0, transform: 'translateY(-0.4rem) scale(0.99)', transition: { duration: 0.12 } }}
        transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
      >
        <div className="pop-title">{t('Подборки')}</div>
        {collections.length === 0 && <p className="pop-empty">{t('Свои списки игр: «Кооператив», «Пройти», «Для гостей». Создайте первый.')}</p>}
        <div className="pop-list">
          {collections.map((c) => (
            <button key={c.id} data-nav data-id={c.id} className={`pop-item ${active === c.id ? 'is-active' : ''}`} onClick={() => onPick(c.id)}>
              <span className="pop-name">{c.name}</span>
              <span className="pop-count">{c.games.filter((id) => ids.has(id)).length}</span>
              <span className="pop-check">{active === c.id && <IconCheck />}</span>
            </button>
          ))}
        </div>
        <button data-nav data-id="new" className="pop-item is-new" onClick={onNew}>
          <IconPlus />
          <span className="pop-name">{t('Новая подборка')}</span>
        </button>
        <footer className="pop-hints">
          <Hint glyph="confirm" label={t('Выбрать')} />
          {collections.length > 0 && <Hint glyph="menu" label={t('Изменить')} />}
          <Hint glyph="back" label={t('Закрыть')} />
        </footer>
      </motion.div>
    </>
  )
}
