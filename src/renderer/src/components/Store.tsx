import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Game, StoreItem } from '@shared/types'
import { api } from '../lib/api'
import { lastInputDevice, useInputLayer } from '../lib/input'
import { nudge } from '../lib/nav'
import { beginEdit, isEditing, openKeyboard, setKeyboardStatus } from '../lib/osk'
import { ROW_TITLES, storeGame, tileNote, useStoreHome } from '../lib/shop'
import { play } from '../lib/sound'
import { Cover } from './Tile'
import { IconCheck, IconClose, IconDownload, IconRestart, IconSearch } from './Icons'
import { t } from '@shared/i18n'
import '../styles-store.css'

/** Что в фокусе магазина — по нему App подбирает подсказки кнопок */
export interface StoreFocus {
  zone: 'search' | 'hero' | 'row' | 'results' | 'retry'
  searching: boolean
}

type Zone = { kind: 'search' } | { kind: 'hero' } | { kind: 'row'; row: number } | { kind: 'results' } | { kind: 'retry' }

/** Сколько игр крутится в баннере и как часто он листается сам */
const HERO_COUNT = 5
const HERO_ROTATE = 9000
/** Поиск ждёт паузы в наборе */
const SEARCH_DELAY = 350

interface Props {
  games: Game[]
  active: boolean
  onFocusItem: (item: StoreItem | null) => void
  onFocusKind: (f: StoreFocus) => void
  onExitTop: () => void
  onOpen: (item: StoreItem) => void
}

/**
 * Магазин: баннер с новинками, ряды витрины Steam и поиск по всему каталогу.
 * Вверх-вниз — между баннером и рядами, влево-вправо — внутри ряда; у каждого ряда своя позиция.
 */
export function Store({ games, active, onFocusItem, onFocusKind, onExitTop, onOpen }: Props) {
  const { home, failed, retry } = useStoreHome()
  const rows = home?.rows ?? []
  const featured = useMemo(() => {
    const src = rows.find((r) => r.id === 'new')?.items ?? rows[0]?.items ?? []
    return src.filter((i) => i.hero).slice(0, HERO_COUNT)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home])
  const owned = useMemo(() => new Set(games.flatMap((g) => (g.steamAppId ? [g.steamAppId] : []))), [games])

  const [zone, setZone] = useState<Zone>({ kind: 'hero' })
  const [heroIdx, setHeroIdx] = useState(0)
  const [pos, setPos] = useState<Record<number, number>>({})
  const [resIdx, setResIdx] = useState(0)

  // ── Поиск ──
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<StoreItem[]>([])
  const [loading, setLoading] = useState(false)
  const [searchFailed, setSearchFailed] = useState(false)
  const searching = query.trim().length > 0
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!searching) {
      setResults([])
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    const id = setTimeout(() => {
      api
        .storeSearch(query)
        .then((r) => {
          if (!alive) return
          setResults(r)
          setSearchFailed(false)
        })
        .catch(() => alive && (setResults([]), setSearchFailed(true)))
        .finally(() => alive && setLoading(false))
    }, SEARCH_DELAY)
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [query, searching])
  useEffect(() => {
    setKeyboardStatus(searchRef.current, searching && !loading ? t('Найдено: {n}', { n: results.length }) : '')
  }, [searching, loading, results.length])
  useEffect(() => () => setKeyboardStatus(null, ''), [])

  // Витрина пришла без баннера или не пришла вовсе — фокус туда, где есть что выбрать. Пока она грузится, ждём на баннере
  const empty = !rows.length
  useEffect(() => {
    if (zone.kind === 'hero' && !featured.length && (home || failed)) setZone(rows.length ? { kind: 'row', row: 0 } : failed ? { kind: 'retry' } : { kind: 'search' })
    else if (zone.kind === 'row' && zone.row >= rows.length) setZone(rows.length ? { kind: 'row', row: rows.length - 1 } : { kind: 'search' })
    else if (zone.kind === 'retry' && !failed) setZone({ kind: 'hero' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featured.length, rows.length, failed, home])

  const hIdx = featured.length ? heroIdx % featured.length : 0
  const rowPos = (r: number) => Math.min(pos[r] ?? 0, Math.max(0, (rows[r]?.items.length ?? 1) - 1))
  const rIdx = Math.min(resIdx, Math.max(0, results.length - 1))
  const focusedItem: StoreItem | null =
    zone.kind === 'hero'
      ? (featured[hIdx] ?? null)
      : zone.kind === 'row'
        ? (rows[zone.row]?.items[rowPos(zone.row)] ?? null)
        : zone.kind === 'results' && searching
          ? (results[rIdx] ?? null)
          : null

  useEffect(() => {
    if (active) onFocusItem(focusedItem)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedItem?.appId, active])
  useEffect(() => {
    if (active) onFocusKind({ zone: zone.kind, searching })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone.kind, searching, active])

  // Баннер листается сам, пока фокус не на нём
  useEffect(() => {
    if (!active || zone.kind === 'hero' || searching || featured.length < 2) return
    const id = setInterval(() => setHeroIdx((i) => (i + 1) % featured.length), HERO_ROTATE)
    return () => clearInterval(id)
  }, [active, zone.kind, searching, featured.length])

  // ── Прокрутка ──
  const scrollRef = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef<(HTMLElement | null)[]>([])
  const stripRefs = useRef<(HTMLDivElement | null)[]>([])
  const gridRef = useRef<HTMLDivElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  // Ряд в фокусе — заголовком к верху, чтобы был виден и следующий, а от прошлого не торчали обрезки подписей
  useEffect(() => {
    const box = scrollRef.current
    if (!box) return
    if (zone.kind === 'row') {
      const el = sectionRefs.current[zone.row]
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize)
      if (el) box.scrollTo({ top: Math.max(0, el.offsetTop - rem * 1.6), behavior: 'smooth' })
    } else if (zone.kind === 'hero' || zone.kind === 'search') box.scrollTo({ top: 0, behavior: 'smooth' })
  }, [zone])

  // Плитка в фокусе не уходит за край ряда
  const focusRowPos = zone.kind === 'row' ? rowPos(zone.row) : -1
  useEffect(() => {
    if (zone.kind !== 'row') return
    const strip = stripRefs.current[zone.row]
    const cell = strip?.children[focusRowPos] as HTMLElement | undefined
    if (!strip || !cell) return
    const margin = strip.clientWidth * 0.08
    const left = cell.offsetLeft
    const right = left + cell.offsetWidth
    if (right > strip.scrollLeft + strip.clientWidth - margin) strip.scrollTo({ left: right - strip.clientWidth + margin, behavior: 'smooth' })
    else if (left < strip.scrollLeft + margin) strip.scrollTo({ left: Math.max(0, left - margin), behavior: 'smooth' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone, focusRowPos])

  // Найденное: выбранная плитка в верхней трети
  useEffect(() => {
    if (zone.kind !== 'results') return
    const el = gridRef.current?.children[rIdx] as HTMLElement | undefined
    const box = resultsRef.current
    if (!el || !box) return
    const top = el.offsetTop - box.clientHeight * 0.18
    if (Math.abs(box.scrollTop - top) > 4) box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  }, [rIdx, zone])

  const cols = () => {
    const g = gridRef.current
    return g ? Math.max(1, getComputedStyle(g).gridTemplateColumns.split(' ').filter(Boolean).length) : 6
  }

  // ── Действия ──
  const go = (z: Zone) => {
    play('move')
    setZone(z)
  }
  const bump = (dir: 'left' | 'right' | 'up' | 'down') => {
    play('bump')
    nudge(document.querySelector('.store .is-focused'), dir)
  }
  const open = (item: StoreItem | null | undefined) => {
    if (!item) return
    play('select')
    onOpen(item)
  }

  const openSearch = () => {
    const el = searchRef.current
    if (!el) return
    play('select')
    setZone({ kind: 'search' })
    el.focus({ preventScroll: true })
    if (lastInputDevice() === 'keyboard') beginEdit(el)
    else openKeyboard(el)
  }
  const clearSearch = () => {
    play('back')
    setQuery('')
    setResIdx(0)
    setZone({ kind: 'search' })
  }
  /** Вниз от поиска: к найденному, к баннеру или к первому ряду */
  const below = (): Zone | null => {
    if (searching) return results.length ? { kind: 'results' } : null
    if (featured.length) return { kind: 'hero' }
    if (rows.length) return { kind: 'row', row: 0 }
    return failed ? { kind: 'retry' } : null
  }

  // Ушли от строки поиска — поле закрывается, стрелки снова листают магазин
  useEffect(() => {
    if (zone.kind !== 'search') searchRef.current?.blur()
  }, [zone.kind])

  // Клавиатура: «/» или Ctrl+F — сразу в поиск
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el instanceof HTMLInputElement && isEditing(el)) return
      if (e.key === '/' || (e.code === 'Slash' && !e.shiftKey) || ((e.ctrlKey || e.metaKey) && e.code === 'KeyF')) {
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
      if (a === 'search') return openSearch()
      switch (zone.kind) {
        case 'search': {
          if (a === 'confirm') return openSearch()
          if (a === 'down') {
            const z = below()
            return z ? go(z) : bump('down')
          }
          if (a === 'back' && searching) return clearSearch()
          if (a === 'up' || a === 'back') return onExitTop()
          if (a === 'left' || a === 'right') return bump(a)
          return false
        }
        case 'retry': {
          if (a === 'confirm') {
            play('select')
            return retry()
          }
          if (a === 'up') return go({ kind: 'search' })
          if (a === 'back') return onExitTop()
          return false
        }
        case 'hero': {
          const n = featured.length
          if (a === 'left' || a === 'right') {
            if (n < 2) return bump(a)
            play('move')
            return setHeroIdx((hIdx + (a === 'left' ? -1 : 1) + n) % n)
          }
          if (a === 'up') return go({ kind: 'search' })
          if (a === 'down') return rows.length ? go({ kind: 'row', row: 0 }) : bump('down')
          if (a === 'confirm' || a === 'menu') return open(featured[hIdx])
          if (a === 'back') return onExitTop()
          return false
        }
        case 'row': {
          const r = zone.row
          const i = rowPos(r)
          const n = rows[r]?.items.length ?? 0
          if (a === 'left' || a === 'right') {
            const next = i + (a === 'left' ? -1 : 1)
            if (next < 0 || next >= n) return bump(a)
            play('move')
            return setPos((p) => ({ ...p, [r]: next }))
          }
          if (a === 'up') return go(r > 0 ? { kind: 'row', row: r - 1 } : featured.length ? { kind: 'hero' } : { kind: 'search' })
          if (a === 'down') return r < rows.length - 1 ? go({ kind: 'row', row: r + 1 }) : bump('down')
          if (a === 'confirm' || a === 'menu') return open(rows[r]?.items[i])
          // ○ в рядах — сначала к баннеру, второе ○ — к вкладкам
          if (a === 'back') {
            if (!featured.length) return onExitTop()
            play('back')
            return setZone({ kind: 'hero' })
          }
          return false
        }
        case 'results': {
          const c = cols()
          const n = results.length
          const move = (k: number) => {
            play('move')
            setResIdx(k)
          }
          if (a === 'left') return rIdx % c > 0 ? move(rIdx - 1) : bump('left')
          if (a === 'right') return rIdx % c < c - 1 && rIdx + 1 < n ? move(rIdx + 1) : bump('right')
          if (a === 'down') return rIdx + c < n ? move(rIdx + c) : Math.floor(rIdx / c) < Math.floor((n - 1) / c) ? move(n - 1) : bump('down')
          if (a === 'up') return rIdx >= c ? move(rIdx - c) : go({ kind: 'search' })
          if (a === 'confirm' || a === 'menu') return open(results[rIdx])
          if (a === 'back') return clearSearch()
          return false
        }
      }
    },
    0,
    active
  )

  const noFocus = (e: React.MouseEvent) => e.preventDefault()
  const searchZone = zone.kind === 'search' && active
  const meta = searching
    ? loading
      ? t('Ищем…')
      : t('Найдено: {n}', { n: results.length })
    : focusedItem
      ? [focusedItem.title, focusedItem.options ? t('Можно скачать') : '', tileNote(focusedItem)].filter(Boolean).join(' · ')
      : ''

  return (
    <div className="store">
      <div className="library-head store-head">
        <label className={`chip lib-search store-search ${searching ? 'has-query' : ''} ${searchZone ? 'is-focused' : ''}`} onMouseDown={() => setZone({ kind: 'search' })}>
          <IconSearch />
          <input
            ref={searchRef}
            data-osk-live="1"
            tabIndex={-1}
            value={query}
            placeholder={t('Поиск в магазине')}
            aria-label={t('Поиск в магазине')}
            spellCheck={false}
            onChange={(e) => {
              setQuery(e.target.value)
              setResIdx(0)
            }}
            // Enter или «Готово» на экранной клавиатуре — сразу к найденному
            onKeyDown={(e) => e.key === 'Enter' && searching && results.length > 0 && setZone({ kind: 'results' })}
          />
          {query && (
            <button tabIndex={-1} className="lib-search-clear" aria-label={t('Сбросить поиск')} onMouseDown={noFocus} onClick={clearSearch}>
              <IconClose />
            </button>
          )}
        </label>
        <div className="library-meta store-meta">
          {searching && loading ? (
            <span className="store-meta-wait">
              <span className="spinner" />
              {meta}
            </span>
          ) : (
            meta
          )}
        </div>
      </div>

      {searching ? (
        results.length ? (
          <div className="grid-scroll" ref={resultsRef}>
            <div className="grid store-grid" ref={gridRef}>
              {results.map((item, i) => (
                <StoreTile
                  key={item.appId}
                  item={item}
                  caption
                  focused={active && zone.kind === 'results' && i === rIdx}
                  inLibrary={owned.has(item.appId)}
                  onClick={() => (zone.kind === 'results' && i === rIdx ? open(item) : (setResIdx(i), setZone({ kind: 'results' })))}
                />
              ))}
            </div>
          </div>
        ) : loading ? (
          <SearchSkeleton />
        ) : (
          <div className="empty">
            <p className="empty-title">{searchFailed ? t('Steam не ответил') : t('Ничего не нашлось')}</p>
            <p className="empty-text">
              {searchFailed ? t('Проверьте интернет и попробуйте ещё раз.') : t('Игр с названием «{q}» в Steam нет. Попробуйте написать иначе.', { q: query })}
            </p>
          </div>
        )
      ) : empty ? (
        failed ? (
          <div className="empty">
            <p className="empty-title">{t('Магазин не загрузился')}</p>
            <p className="empty-text">{t('Steam не ответил. Проверьте интернет — без него витрина пока пуста.')}</p>
            <button className={`btn btn-glass ${zone.kind === 'retry' && active ? 'is-focused' : ''}`} tabIndex={-1} onClick={retry}>
              <IconRestart /> {t('Повторить')}
            </button>
          </div>
        ) : (
          <StoreSkeleton />
        )
      ) : (
        <div className="store-scroll" ref={scrollRef}>
          {featured.length > 0 && (
            <StoreHero
              items={featured}
              index={hIdx}
              focused={active && zone.kind === 'hero'}
              onPick={(i) => {
                setHeroIdx(i)
                setZone({ kind: 'hero' })
              }}
              onOpen={() => (zone.kind === 'hero' ? open(featured[hIdx]) : setZone({ kind: 'hero' }))}
            />
          )}
          {rows.map((row, r) => (
            <section key={row.id} className="store-row" ref={(el) => void (sectionRefs.current[r] = el)}>
              <h2 className="store-row-title">{ROW_TITLES[row.id]}</h2>
              <div className="store-strip" ref={(el) => void (stripRefs.current[r] = el)}>
                {row.items.map((item, i) => {
                  const focused = active && zone.kind === 'row' && zone.row === r && i === rowPos(r)
                  return (
                    <StoreTile
                      key={item.appId}
                      item={item}
                      caption
                      focused={focused}
                      inLibrary={owned.has(item.appId)}
                      onClick={() => (focused ? open(item) : (setPos((p) => ({ ...p, [r]: i })), setZone({ kind: 'row', row: r })))}
                    />
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

/** Плитка игры магазина: обложка, отметки «можно скачать» и «в библиотеке», подпись с названием и оценкой */
function StoreTile({
  item,
  focused,
  inLibrary,
  caption,
  onClick
}: {
  item: StoreItem
  focused: boolean
  inLibrary: boolean
  caption?: boolean
  onClick: () => void
}) {
  const game = useMemo(() => storeGame(item), [item])
  const tile = (
    <div className={`tile store-tile ${focused ? 'is-focused' : ''}`} role="button" aria-label={item.title} onClick={onClick}>
      <div className="tile-art">
        <Cover game={game} />
        {(inLibrary || !!item.options) && (
          <span className="store-badges">
            {!!item.options && (
              <span className="store-badge is-dl" title={t('Можно скачать')}>
                <IconDownload />
              </span>
            )}
            {inLibrary && (
              <span className="store-badge" title={t('Уже в библиотеке')}>
                <IconCheck />
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  )
  if (!caption) return tile
  return (
    <div className={`store-cell ${focused ? 'is-current' : ''}`}>
      {tile}
      <div className="store-cap">
        <span className="store-cap-title">{item.title}</span>
        <span className="store-cap-note">{tileNote(item)}</span>
      </div>
    </div>
  )
}

/** Баннер с новинками: широкий арт, логотип, описание и метки; точки внизу — какая из пяти */
function StoreHero({ items, index, focused, onPick, onOpen }: { items: StoreItem[]; index: number; focused: boolean; onPick: (i: number) => void; onOpen: () => void }) {
  const item = items[index]
  const [logoFailed, setLogoFailed] = useState<Record<number, boolean>>({})
  const pills = [...(item.tags ?? []).slice(0, 3), ...(item.reviews?.label ? [item.reviews.label] : [])]
  return (
    <div className={`store-hero ${focused ? 'is-focused' : ''}`} role="button" aria-label={item.title} onClick={onOpen}>
      <div className="store-hero-clip">
        <AnimatePresence initial={false}>
          <motion.img
            key={item.appId}
            className="store-hero-art"
            src={item.hero}
            alt=""
            draggable={false}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
        </AnimatePresence>
        <div className="store-hero-shade" />
      </div>
      <motion.div
        key={item.appId}
        className="store-hero-info"
        initial={{ opacity: 0, transform: 'translateY(0.8rem)' }}
        animate={{ opacity: 1, transform: 'translateY(0rem)' }}
        transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
      >
        {item.logo && !logoFailed[item.appId] ? (
          <img className="store-hero-logo" src={item.logo} alt={item.title} draggable={false} onError={() => setLogoFailed((f) => ({ ...f, [item.appId]: true }))} />
        ) : (
          <h1 className="store-hero-title">{item.title}</h1>
        )}
        {item.short && <p className="store-hero-desc">{item.short}</p>}
        {pills.length > 0 && (
          <div className="store-pills">
            {pills.map((p) => (
              <span key={p}>{p}</span>
            ))}
          </div>
        )}
      </motion.div>
      {items.length > 1 && (
        <div className="store-dots">
          {items.map((it, i) => (
            <button
              key={it.appId}
              tabIndex={-1}
              className={i === index ? 'is-active' : ''}
              aria-label={it.title}
              onClick={(e) => {
                e.stopPropagation()
                onPick(i)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Пока витрина грузится впервые — пустые места той же формы */
/** Steam ещё ищет: пустые плитки результатов дышат волной слева направо — видно, что поиск идёт, а не завис */
function SearchSkeleton() {
  return (
    <div className="grid-scroll store-search-wait" aria-hidden>
      <div className="grid store-grid">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="store-cell" style={{ '--i': i } as React.CSSProperties}>
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

function StoreSkeleton() {
  return (
    <div className="store-scroll store-skeleton" aria-hidden>
      <div className="store-hero" />
      {[0, 1].map((r) => (
        <section key={r} className="store-row">
          <h2 className="store-row-title">&nbsp;</h2>
          <div className="store-strip">
            {Array.from({ length: 9 }, (_, i) => (
              <div key={i} className="store-cell">
                <div className="tile store-tile">
                  <div className="tile-art" />
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
