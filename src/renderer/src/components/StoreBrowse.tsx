import { useEffect, useMemo, useRef, useState } from 'react'
import type { StoreFilters, StoreItem, StoreSort, StoreTagInfo } from '@shared/types'
import { STORE_DECADES, STORE_FILTER_GROUPS } from '@shared/types'
import { api } from '../lib/api'
import { useInputLayer } from '../lib/input'
import { nudge, useSpatialNav } from '../lib/nav'
import { play } from '../lib/sound'
import { toast } from '../lib/state'
import { IconCaret, IconCheck, IconChevron, IconDownload, IconFilter, IconRestart } from './Icons'
import { StoreTile } from './StoreTile'
import { locale, plural, t } from '@shared/i18n'

/** Что в фокусе каталога — для подсказок App */
export interface BrowseFocus {
  zone: 'browse' | 'browse-grid' | 'browse-panel'
  owned: boolean
}

interface Props {
  /** Жанр, с которым открыли: «Все игры жанра» в конце ряда витрины */
  tag?: number
  active: boolean
  owned: (item: StoreItem) => boolean
  adding: ReadonlySet<number>
  onQuickAdd: (item: StoreItem) => void
  onOpen: (item: StoreItem) => void
  onClose: () => void
  onFocusItem: (item: StoreItem | null) => void
  onFocusKind: (f: BrowseFocus) => void
}

const SORTS: { id: StoreSort; label: string }[] = [
  { id: 'popular', label: t('Популярные') },
  { id: 'new', label: t('Новинки') },
  { id: 'reviews', label: t('По отзывам') },
  { id: 'name', label: t('А–Я') }
]
const REVIEW_SHARE = [70, 80, 95]
const REVIEW_COUNT = [500, 2000, 10000]
/** Фильтры применяются после паузы: несколько отметок подряд — один запрос */
const APPLY_DELAY = 350

const num = (n: number) => n.toLocaleString(locale())
const gamesCount = (n: number) => `${num(n)} ${plural(n, ['игра', 'игры', 'игр'], ['game', 'games'])}`
const ALL_TAGS = STORE_FILTER_GROUPS.flatMap((g) => g.tags)

/** Сколько фильтров отмечено — для шапки панели */
function activeCount(f: StoreFilters) {
  return (f.tags?.length ?? 0) + (f.year || f.decade ? 1 : 0) + (f.reviews ? 1 : 0) + (f.minReviews ? 1 : 0) + [f.ruText, f.ruVoice, f.noEarly, f.downloadable].filter(Boolean).length
}

/**
 * Каталог игр Steam: сетка слева, панель фильтров справа — жанры и поджанры галочками (у игры должна быть каждая
 * отмеченная метка), год или десятилетие, русский язык, ранний доступ, отзывы, группы меток (камера, режимы, стиль,
 * сюжет, мир, настроение). Сетка догружается по 48 игр, когда фокус или прокрутка подходят к концу.
 * Геймпад: вверх из сетки — сортировка, вправо от края сетки или ☰ — фильтры, влево или ○ из фильтров — обратно к играм.
 */
export function StoreBrowse({ tag: initTag, active, owned, adding, onQuickAdd, onOpen, onClose, onFocusItem, onFocusKind }: Props) {
  const [sort, setSort] = useState<StoreSort>('popular')
  const [filters, setFilters] = useState<StoreFilters>(initTag ? { tags: [initTag] } : {})
  // Запрос идёт с паузой после последнего изменения фильтров
  const [applied, setApplied] = useState<StoreFilters>(filters)
  useEffect(() => {
    if (filters === applied) return
    const id = setTimeout(() => setApplied(filters), APPLY_DELAY)
    return () => clearTimeout(id)
  }, [filters, applied])
  const [hasSources, setHasSources] = useState(false)
  const [tagInfo, setTagInfo] = useState<Record<number, StoreTagInfo>>({})

  const [items, setItems] = useState<StoreItem[]>([])
  const [next, setNext] = useState<number | undefined>(0)
  const [total, setTotal] = useState<number | undefined>()
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const [zone, setZone] = useState<'head' | 'grid' | 'panel'>('grid')
  const [chip, setChip] = useState(1)
  const [idx, setIdx] = useState(0)

  const gridRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Источники (для «Можно скачать») и названия меток со счётчиками; счётчики считаются в фоне — заберём ещё раз
  useEffect(() => {
    let alive = true
    api
      .storeSources()
      .then((l) => alive && setHasSources(l.length > 0))
      .catch(() => {})
    const loadTags = () =>
      api
        .storeTagInfo(ALL_TAGS)
        .then((info) => {
          if (!alive) return
          setTagInfo(info)
          if (ALL_TAGS.some((id) => info[id]?.count === undefined)) setTimeout(loadTags, 15_000)
        })
        .catch(() => {})
    void loadTags()
    return () => {
      alive = false
    }
  }, [])

  // ── Загрузка страниц ──
  const query = JSON.stringify([sort, applied])
  const gen = useRef(0)
  const load = (start: number, reset: boolean) => {
    const my = ++gen.current
    setLoading(true)
    setFailed(false)
    api
      .storeBrowse({ sort, start, ...applied })
      .then((p) => {
        if (my !== gen.current) return
        setItems((prev) => {
          const base = reset ? [] : prev
          const seen = new Set(base.map((i) => i.appId))
          return [...base, ...p.items.filter((i) => !seen.has(i.appId))]
        })
        setNext(p.next)
        setTotal(p.total)
      })
      .catch(() => my === gen.current && setFailed(true))
      .finally(() => my === gen.current && setLoading(false))
  }
  useEffect(() => {
    setItems([])
    setIdx(0)
    setNext(0)
    setTotal(undefined)
    scrollRef.current?.scrollTo({ top: 0 })
    load(0, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])
  const more = () => {
    if (!loading && !failed && next !== undefined && next > 0) load(next, false)
  }

  const cols = () => {
    const g = gridRef.current
    return g ? Math.max(1, getComputedStyle(g).gridTemplateColumns.split(' ').filter(Boolean).length) : 5
  }
  const i = Math.min(idx, Math.max(0, items.length - 1))
  const focused = zone === 'grid' ? (items[i] ?? null) : null

  useEffect(() => {
    if (items.length && i >= items.length - cols() * 2) more()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, items.length, next])

  useEffect(() => {
    if (zone !== 'grid') return
    const el = gridRef.current?.children[i] as HTMLElement | undefined
    const box = scrollRef.current
    if (!el || !box) return
    const top = el.offsetTop - box.clientHeight * 0.18
    if (Math.abs(box.scrollTop - top) > 4) box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  }, [i, zone])

  useEffect(() => {
    if (active) onFocusItem(focused)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused?.appId, active])
  const focusOwned = !focused || owned(focused)
  useEffect(() => {
    if (active) onFocusKind({ zone: zone === 'grid' ? 'browse-grid' : zone === 'panel' ? 'browse-panel' : 'browse', owned: focusOwned })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone, active, focusOwned])

  // ── Действия ──
  const bump = (dir: 'left' | 'right' | 'up' | 'down') => {
    play('bump')
    nudge(document.querySelector('.store-browse .is-focused'), dir)
  }
  const dated = !!(applied.year || applied.decade)
  const pickSort = (id: StoreSort) => {
    // С годом порядок один — по дате выхода
    if (filters.year || filters.decade) {
      play('bump')
      toast({ title: t('С выбранным годом игры идут по дате выхода'), message: t('Сбросьте год, чтобы выбрать порядок'), history: false })
      return
    }
    play(id === sort ? 'move' : 'select')
    setSort(id)
  }
  const toPanel = () => {
    play('move')
    setZone('panel')
  }
  const toGrid = () => {
    if (!items.length) {
      if (zone === 'panel') return
      return bump('down')
    }
    play('move')
    setZone('grid')
  }

  // Шапка (назад и сортировка) и сетка; у панели фильтров своя пространственная навигация
  useInputLayer(
    (a) => {
      if (a === 'options') return toPanel()
      if (zone === 'head') {
        if (a === 'left' || a === 'right') {
          const n = chip + (a === 'left' ? -1 : 1)
          if (n < 0) return bump(a)
          if (n > SORTS.length) return toPanel()
          play('move')
          return setChip(n)
        }
        if (a === 'confirm') {
          if (chip === 0) {
            play('back')
            return onClose()
          }
          return pickSort(SORTS[chip - 1].id)
        }
        if (a === 'down') return toGrid()
        if (a === 'up' || a === 'back') {
          play('back')
          return onClose()
        }
        return false
      }
      const c = cols()
      const n = items.length
      const move = (k: number) => {
        play('move')
        setIdx(k)
      }
      if (a === 'left') return i % c > 0 ? move(i - 1) : bump('left')
      if (a === 'right') return i % c < c - 1 && i + 1 < n ? move(i + 1) : toPanel()
      if (a === 'down') return i + c < n ? move(i + c) : Math.floor(i / c) < Math.floor((n - 1) / c) ? move(n - 1) : (more(), bump('down'))
      if (a === 'up') {
        if (i >= c) return move(i - c)
        play('move')
        setChip(SORTS.findIndex((s) => s.id === sort) + 1)
        return setZone('head')
      }
      if (a === 'confirm' && focused) {
        play('select')
        return onOpen(focused)
      }
      if (a === 'menu' && focused) return onQuickAdd(focused)
      // ○ далеко внизу — к первому ряду, ещё раз — из каталога
      if (a === 'back') {
        if (i >= c) {
          play('back')
          return setIdx(i % c)
        }
        play('back')
        return onClose()
      }
      return false
    },
    0,
    active && zone !== 'panel'
  )

  const noFocus = (e: React.MouseEvent) => e.preventDefault()
  const headZone = zone === 'head' && active
  const n = activeCount(filters)
  const sub =
    loading && !items.length
      ? filters.year
        ? t('Ищем игры {y} года…', { y: filters.year })
        : filters.decade
          ? t('Ищем игры {y}-х…', { y: filters.decade })
          : t('Загружаем…')
      : total !== undefined
        ? t('Подходит: {v}', { v: gamesCount(total) })
        : t('Найдено: {n}', { n: items.length }) + (next !== undefined ? '+' : '')

  return (
    <div className="store-browse">
      <div className="library-head store-browse-head">
        <button tabIndex={-1} className={`chip chip-add store-browse-back ${headZone && chip === 0 ? 'is-focused' : ''}`} aria-label={t('Магазин')} title={t('Магазин')} onMouseDown={noFocus} onClick={onClose}>
          <IconChevron dir="left" />
        </button>
        <div className="cat-title">
          <h2>{t('Каталог игр')}</h2>
          <span className="cat-sub">
            {loading && !items.length && <span className="spinner" />}
            {focused ? focused.title : sub}
          </span>
        </div>
        <div className={`seg ${dated ? 'is-muted' : ''}`} role="group" aria-label={t('Сортировка')}>
          {SORTS.map((s, k) => (
            <button
              key={s.id}
              tabIndex={-1}
              className={`seg-item ${sort === s.id && !dated ? 'is-active' : ''} ${headZone && chip === k + 1 ? 'is-focused' : ''}`}
              onMouseDown={noFocus}
              onClick={() => (setZone('head'), setChip(k + 1), pickSort(s.id))}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="cat-body">
        {items.length ? (
          <div
            className="grid-scroll"
            ref={scrollRef}
            onScroll={(e) => {
              const el = e.currentTarget
              if (el.scrollTop + el.clientHeight > el.scrollHeight - el.clientHeight * 0.6) more()
            }}
          >
            <div className="grid store-grid" ref={gridRef}>
              {items.map((item, k) => (
                <StoreTile
                  key={item.appId}
                  item={item}
                  caption
                  focused={active && zone === 'grid' && k === i}
                  inLibrary={owned(item)}
                  adding={adding.has(item.appId)}
                  onAdd={() => onQuickAdd(item)}
                  onClick={() => (zone === 'grid' && k === i ? (play('select'), onOpen(item)) : (setIdx(k), setZone('grid')))}
                />
              ))}
            </div>
            {next !== undefined && (
              <div className="store-browse-more">
                {failed ? (
                  <button className="btn btn-glass" tabIndex={-1} onClick={() => load(next, false)}>
                    {t('Повторить')}
                  </button>
                ) : (
                  <span className="spinner" />
                )}
              </div>
            )}
          </div>
        ) : loading ? (
          <BrowseSkeleton />
        ) : (
          <div className="empty">
            <p className="empty-title">{failed ? t('Steam не ответил') : t('Ничего не нашлось')}</p>
            <p className="empty-text">{failed ? t('Проверьте интернет и попробуйте ещё раз.') : t('Снимите часть фильтров: игр со всеми отметками сразу нет.')}</p>
            {failed ? (
              <button className="btn btn-glass" tabIndex={-1} onClick={() => load(0, true)}>
                <IconRestart /> {t('Повторить')}
              </button>
            ) : (
              n > 0 && (
                <button className="btn btn-glass" tabIndex={-1} onClick={() => (play('back'), setFilters({}))}>
                  {t('Сбросить фильтры')}
                </button>
              )
            )}
          </div>
        )}

        <FilterPanel
          value={filters}
          onChange={setFilters}
          tagInfo={tagInfo}
          hasSources={hasSources}
          active={active && zone === 'panel'}
          onLeave={toGrid}
          onFocusPanel={() => setZone('panel')}
        />
      </div>
    </div>
  )
}

/**
 * Панель фильтров справа, как на сайтах подбора игр: секции сворачиваются, жанры — галочками со счётчиками игр,
 * год — десятилетие и годы, переключатели, отзывы — ступенями. Все пункты — data-nav, ходит своя навигация
 */
function FilterPanel({
  value,
  onChange,
  tagInfo,
  hasSources,
  active,
  onLeave,
  onFocusPanel
}: {
  value: StoreFilters
  onChange: (f: StoreFilters) => void
  tagInfo: Record<number, StoreTagInfo>
  hasSources: boolean
  active: boolean
  onLeave: () => void
  onFocusPanel: () => void
}) {
  const ref = useRef<HTMLElement>(null)
  // Жанры, поджанры, год и отзывы раскрыты сразу; группы меток — по нажатию
  const [open, setOpen] = useState<Record<string, boolean>>(() => ({ ...Object.fromEntries(STORE_FILTER_GROUPS.map((g) => [g.id, !!g.open])), year: true, reviews: true }))
  const [more, setMore] = useState<Record<string, boolean>>({})
  const [decadeView, setDecadeView] = useState(() => (value.year ? value.year - (value.year % 10) : (value.decade ?? STORE_DECADES[0])))
  useSpatialNav(ref, { priority: 1, active, onBack: onLeave, onEdge: (dir) => dir === 'left' && onLeave(), autoFocus: '.cat-panel [data-nav]' })

  const tags = value.tags ?? []
  const set = (patch: Partial<StoreFilters>) => onChange({ ...value, ...patch })
  const toggleTag = (id: number) => {
    const on = tags.includes(id)
    play(on ? 'back' : 'select')
    set({ tags: on ? tags.filter((x) => x !== id) : [...tags, id] })
  }
  const flip = (key: 'ruText' | 'ruVoice' | 'noEarly' | 'downloadable') => {
    play('toggle')
    set({ [key]: !value[key] || undefined })
  }
  const step = (key: 'reviews' | 'minReviews', v: number | undefined) => {
    play(value[key] === v ? 'move' : 'select')
    set({ [key]: v })
  }
  const pickYear = (y: number | undefined, decade?: number) => {
    play('select')
    set({ year: y, decade: y ? undefined : decade })
  }
  const n = activeCount(value)
  const thisYear = new Date().getFullYear()
  const years = Array.from({ length: 10 }, (_, k) => decadeView + 9 - k).filter((y) => y <= thisYear)

  const section = (id: string, title: string, body: React.ReactNode, count?: number) => (
    <section key={id} className={`cat-sec ${open[id] ? 'is-open' : ''}`}>
      <button data-nav className="cat-sec-head" onClick={() => (play('move'), setOpen((o) => ({ ...o, [id]: !o[id] })))}>
        <span>{title}</span>
        {!!count && <span className="cat-badge">{count}</span>}
        <IconCaret className="cat-caret" />
      </button>
      {open[id] && <div className="cat-sec-body">{body}</div>}
    </section>
  )
  const check = (id: number) => {
    const info = tagInfo[id]
    const on = tags.includes(id)
    return (
      <button key={id} data-nav className={`cat-row ${on ? 'is-on' : ''}`} onClick={() => toggleTag(id)}>
        <span className="cat-box">{on && <IconCheck />}</span>
        <span className="cat-name">{info?.name ?? '…'}</span>
        {info?.count !== undefined && <span className="cat-count">{num(info.count)}</span>}
      </button>
    )
  }
  const sw = (key: 'ruText' | 'ruVoice' | 'noEarly' | 'downloadable', label: string, icon?: React.ReactNode) => (
    <button key={key} data-nav className={`cat-row cat-switch ${value[key] ? 'is-on' : ''}`} onClick={() => flip(key)}>
      {icon && <span className="cat-row-icon">{icon}</span>}
      <span className="cat-name">{label}</span>
      <span className="cat-toggle" />
    </button>
  )
  const steps = (key: 'reviews' | 'minReviews', list: number[], label: (v: number) => string, any: string) => (
    <div className="cat-steps">
      {[undefined, ...list].map((v) => (
        <button key={v ?? 0} data-nav className={`cat-step ${value[key] === v ? 'is-on' : ''}`} onClick={() => step(key, v)}>
          {v === undefined ? any : label(v)}
        </button>
      ))}
    </div>
  )

  return (
    <aside className="cat-panel" ref={ref} onMouseDown={onFocusPanel}>
      <header className="cat-panel-head">
        <IconFilter />
        <span className="cat-panel-title">{t('Фильтры')}</span>
        {n > 0 && <span className="cat-badge">{n}</span>}
        {n > 0 && (
          <button data-nav className="cat-reset" onClick={() => (play('back'), onChange({}))}>
            {t('Сбросить')}
          </button>
        )}
      </header>
      <div className="cat-panel-scroll">
        {STORE_FILTER_GROUPS.slice(0, 2).map((g) => {
          const shown = g.show && !more[g.id] ? g.tags.slice(0, g.show) : g.tags
          // Отмеченные из свёрнутой части — тоже на виду
          const extra = g.show && !more[g.id] ? g.tags.slice(g.show).filter((id) => tags.includes(id)) : []
          return section(
            g.id,
            t(g.title),
            <>
              {[...shown, ...extra].map(check)}
              {g.show && g.tags.length > g.show && (
                <button data-nav className="cat-more" onClick={() => (play('move'), setMore((m) => ({ ...m, [g.id]: !m[g.id] })))}>
                  <IconCaret className={more[g.id] ? 'is-up' : ''} />
                  {more[g.id] ? t('Свернуть') : t('Ещё {n}', { n: g.tags.length - g.show })}
                </button>
              )}
            </>,
            g.tags.filter((id) => tags.includes(id)).length
          )
        })}

        {section(
          'year',
          t('Год выхода'),
          <>
            <div className="cat-steps">
              {STORE_DECADES.map((d) => (
                <button key={d} data-nav className={`cat-step ${decadeView === d ? 'is-on' : ''}`} onClick={() => (play('move'), setDecadeView(d))}>
                  {t('{y}-е', { y: d })}
                </button>
              ))}
            </div>
            <div className="cat-years">
              <button data-nav className={`cat-year is-wide ${value.decade === decadeView ? 'is-on' : ''}`} onClick={() => pickYear(undefined, value.decade === decadeView ? undefined : decadeView)}>
                {t('Все {y}-е', { y: decadeView })}
              </button>
              {years.map((y) => (
                <button key={y} data-nav className={`cat-year ${value.year === y ? 'is-on' : ''}`} onClick={() => pickYear(value.year === y ? undefined : y)}>
                  {y}
                </button>
              ))}
            </div>
          </>,
          value.year || value.decade ? 1 : 0
        )}

        <section className="cat-sec is-open is-plain">
          <div className="cat-sec-body">
            {hasSources && sw('downloadable', t('Можно скачать'), <IconDownload />)}
            {sw('ruText', t('Интерфейс на русском'))}
            {sw('ruVoice', t('Озвучка на русском'))}
            {sw('noEarly', t('Без раннего доступа'))}
          </div>
        </section>

        {section(
          'reviews',
          t('Отзывы в Steam'),
          <>
            <p className="cat-label">{t('Доля положительных')}</p>
            {steps('reviews', REVIEW_SHARE, (v) => `${v}%+`, t('любая'))}
            <p className="cat-label">{t('Количество отзывов')}</p>
            {steps('minReviews', REVIEW_COUNT, (v) => `${num(v)}+`, t('любое'))}
          </>,
          (value.reviews ? 1 : 0) + (value.minReviews ? 1 : 0)
        )}

        {STORE_FILTER_GROUPS.slice(2).map((g) =>
          section(
            g.id,
            t(g.title),
            g.tags.map(check),
            g.tags.filter((id) => tags.includes(id)).length
          )
        )}
      </div>
    </aside>
  )
}

/** Пока первая страница не пришла — пустые плитки той же формы */
function BrowseSkeleton() {
  const cells = useMemo(() => Array.from({ length: 10 }, (_, k) => k), [])
  return (
    <div className="grid-scroll store-search-wait" aria-hidden>
      <div className="grid store-grid">
        {cells.map((k) => (
          <div key={k} className="store-cell" style={{ '--i': k } as React.CSSProperties}>
            <div className="tile store-tile">
              <div className="tile-art" />
            </div>
            <div className="store-cap">
              <span className="store-wait-line" />
              <span className="store-wait-line is-short" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
