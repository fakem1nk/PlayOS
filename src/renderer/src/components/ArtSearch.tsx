import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { ArtCandidate, ArtSource, Platform } from '@shared/types'
import { api } from '../lib/api'
import { useSpatialNav } from '../lib/nav'
import { play } from '../lib/sound'
import { Hint } from './Glyph'
import { IconSearch } from './Icons'

const SOURCES: { id: ArtSource; label: string; note: string }[] = [
  { id: 'steam', label: 'Steam', note: 'Обложка, фон и логотип из Steam. Подходит и для PS2/PS3 игр, у которых есть PC-версия.' },
  { id: 'steamgriddb', label: 'SteamGridDB', note: 'Большая база арта от сообщества, в том числе для игр без PC-версии. Нужен ключ API в настройках.' },
  { id: 'wiki', label: 'Википедия', note: 'Обложка из статьи об игре. Только обложка, без фона и логотипа.' }
]

interface Props {
  initialQuery: string
  platform: Platform
  serial?: string
  onPick: (c: ArtCandidate) => void
  onClose: () => void
}

export function ArtSearch({ initialQuery, platform, serial, onPick, onClose }: Props) {
  const [query, setQuery] = useState(initialQuery)
  const [source, setSource] = useState<ArtSource>('steam')
  const [results, setResults] = useState<ArtCandidate[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const reqId = useRef(0)

  const search = async (q = query, src = source) => {
    const id = ++reqId.current
    setLoading(true)
    setError(null)
    try {
      const res = await api.searchArt(q, platform, serial, src)
      if (id === reqId.current) setResults(res)
    } catch (e) {
      const msg = (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      if (id === reqId.current) {
        setResults([])
        setError(/fetch|network|timeout/i.test(msg) ? 'Нет соединения с интернетом или сервис не ответил. Попробуйте ещё раз.' : msg)
      }
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }

  useEffect(() => {
    if (initialQuery.trim() || serial) search(initialQuery)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const switchSource = (src: ArtSource) => {
    if (src === source) return
    play('move')
    setSource(src)
    void search(query, src)
  }

  useSpatialNav(ref, {
    priority: 20,
    onBack: onClose,
    // L1/R1 — переключить источник
    onAction: (a) => {
      if (a !== 'l1' && a !== 'r1') return false
      const i = SOURCES.findIndex((s) => s.id === source)
      switchSource(SOURCES[(i + (a === 'l1' ? -1 : 1) + SOURCES.length) % SOURCES.length].id)
    },
    autoFocus: initialQuery ? 'button.result' : 'input',
    focusKey: results?.length ?? 0
  })

  return (
    <motion.div
      className="modal-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="art-search"
        ref={ref}
        initial={{ opacity: 0, transform: 'scale(0.97)' }}
        animate={{ opacity: 1, transform: 'scale(1)' }}
        exit={{ opacity: 0, transform: 'scale(0.98)', transition: { duration: 0.15 } }}
        transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1] }}
      >
        <header className="art-search-head">
          <h2 className="sheet-title">Обложка и фон</h2>
          <form
            className="search-box"
            onSubmit={(e) => {
              e.preventDefault()
              search()
            }}
          >
            <IconSearch />
            <input
              data-nav
              className="input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()}
              placeholder="Название игры на английском"
              spellCheck={false}
            />
            <button data-nav type="submit" className="btn btn-primary btn-sm">
              Найти
            </button>
          </form>
        </header>

        <div className="art-sources">
          {SOURCES.map((s) => (
            <button key={s.id} data-nav className={`chip ${source === s.id ? 'is-active' : ''}`} onClick={() => switchSource(s.id)}>
              {s.label}
            </button>
          ))}
        </div>

        <div className="results">
          {loading &&
            Array.from({ length: 10 }, (_, i) => (
              <div key={i} className="result is-skeleton" style={{ animationDelay: `${i * 40}ms` }} />
            ))}
          {!loading &&
            results?.map((r) => <Result key={r.key} candidate={r} onPick={onPick} />)}
          {!loading && !error && results?.length === 0 && (
            <p className="results-empty">Ничего не нашлось. Попробуйте английское название игры без подзаголовка.</p>
          )}
          {!loading && error && <p className="results-empty">{error}</p>}
        </div>
        <p className="art-search-note">{SOURCES.find((s) => s.id === source)!.note}</p>
        <footer className="sheet-hints">
          <Hint glyph="confirm" label="Применить" />
          <Hint glyph="r1" label="Источник" />
          <Hint glyph="back" label="Назад" />
        </footer>
      </motion.div>
    </motion.div>
  )
}

function Result({ candidate, onPick }: { candidate: ArtCandidate; onPick: (c: ArtCandidate) => void }) {
  // Анимация проигрывается только у варианта в фокусе — десяток видео разом ни к чему
  const [active, setActive] = useState(false)
  return (
    <button
      data-nav
      className="result"
      onClick={() => onPick(candidate)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
    >
      <ResultImage candidate={candidate} active={active} />
      <span className="result-title">{candidate.title}</span>
      {candidate.source === 'disc' && <span className="result-badge">Обложка диска</span>}
      {candidate.coverAnimated && <span className="result-badge is-anim">Анимированная</span>}
    </button>
  )
}

function ResultImage({ candidate, active }: { candidate: ArtCandidate; active: boolean }) {
  const [src, setSrc] = useState(candidate.cover ?? candidate.thumb)
  const preview = candidate.coverAnimatedPreview ?? candidate.coverAnimated
  const isVideo = !!preview && /\.(webm|mp4)(\?|$)/i.test(preview)
  return (
    <span className="result-art">
      {src && <img src={src} alt="" onError={() => setSrc(src === candidate.thumb ? undefined : candidate.thumb)} />}
      {active &&
        preview &&
        (isVideo ? (
          <video className="result-anim" src={preview} autoPlay muted loop playsInline />
        ) : (
          <img className="result-anim" src={preview} alt="" />
        ))}
    </span>
  )
}
