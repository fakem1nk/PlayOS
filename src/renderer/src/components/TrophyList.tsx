import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Achievement, AchievementResult, Game, RaGame, TrophyTier } from '@shared/types'
import { api } from '../lib/api'
import { media } from '../lib/format'
import { useSpatialNav } from '../lib/nav'
import { play } from '../lib/sound'
import { TIER_NAMES } from '../lib/trophies'
import { Hint } from './Glyph'
import { IconClose, IconReset, IconSearch, IconTrophy } from './Icons'
import { Cover } from './Tile'
import { locale, plural, t } from '@shared/i18n'

const dateFmt = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long', year: 'numeric' })
const TIERS: TrophyTier[] = ['platinum', 'gold', 'silver', 'bronze']
const SOURCE_NAME = { ra: 'RetroAchievements', steam: 'Steam', local: 'Steam' } as const

interface Props {
  game: Game
  onClose: () => void
  onOpenSettings: () => void
  onEdit: (g: Game) => void
}

/** Трофеи игры: прогресс, список с редкостью и датами получения. */
export function TrophyList({ game, onClose, onOpenSettings, onEdit }: Props) {
  const [res, setRes] = useState<AchievementResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [focused, setFocused] = useState<Achievement | null>(null)
  const [viewing, setViewing] = useState<Achievement | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const load = async (refresh = false) => {
    setLoading(true)
    const r = await api.achievements(game.id, refresh)
    setRes(r)
    setLoading(false)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id])

  useSpatialNav(ref, {
    priority: 15,
    active: !viewing,
    onBack: onClose,
    autoFocus: '.trophy-row, .ra-result, .sheet-inner .btn-primary',
    focusKey: `${loading}-${res?.set?.items.length ?? 0}-${res?.needs ?? ''}`,
    onAction: (a) => {
      if (a === 'search' && res?.set) {
        play('select')
        void load(true)
      } else return false
    }
  })

  const set = res?.set
  const items = useMemo(() => {
    if (!set) return []
    const earned = set.items.filter((i) => i.earnedAt).sort((a, b) => b.earnedAt! - a.earnedAt!)
    const locked = set.items.filter((i) => !i.earnedAt).sort((a, b) => (b.rarity ?? 0) - (a.rarity ?? 0))
    return [...earned, ...locked]
  }, [set])
  const byTier = useMemo(() => {
    const out: Record<TrophyTier, number> = { platinum: 0, gold: 0, silver: 0, bronze: 0 }
    for (const i of set?.items ?? []) if (i.earnedAt) out[i.tier]++
    if (set && set.total && set.earned === set.total) out.platinum = 1
    return out
  }, [set])
  const percent = set?.total ? Math.round((set.earned / set.total) * 100) : 0

  return (
    <motion.div
      className="sheet trophy-sheet"
      initial={{ transform: 'translateY(100%)' }}
      animate={{ transform: 'translateY(0%)' }}
      exit={{ transform: 'translateY(100%)', transition: { duration: 0.24, ease: [0.32, 0.72, 0, 1] } }}
      transition={{ duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
    >
      <div className="sheet-inner" ref={ref}>
        <header className="trophy-head">
          <div className="trophy-cover">
            <Cover game={game} />
          </div>
          <div className="trophy-head-text">
            <h1 className="sheet-title">{game.title}</h1>
            {set ? (
              <>
                <div className="trophy-progress">
                  <span className="trophy-percent">{percent}%</span>
                  <span className="trophy-bar">
                    <span style={{ width: `${percent}%` }} />
                  </span>
                  <span className="trophy-count">
                    {t('{earned} из {total}', { earned: set.earned, total: set.total })}
                  </span>
                </div>
                <div className="trophy-tiers">
                  {TIERS.map((tier) => (
                    <span key={tier} className={`tier-count tier-${tier}`} title={TIER_NAMES[tier]}>
                      <IconTrophy /> {byTier[tier]}
                    </span>
                  ))}
                  <span className="trophy-source" title={set.source === 'local' ? t('Прочитано из файлов эмулятора Steam на этом ПК') : undefined}>
                    {SOURCE_NAME[set.source]}
                    {set.emulator ? ` · ${set.emulator}` : ''}
                  </span>
                </div>
              </>
            ) : (
              <p className="trophy-sub">{loading ? t('Загружаем трофеи…') : ''}</p>
            )}
          </div>
          <button data-nav className="btn btn-round" onClick={onClose} aria-label={t('Закрыть')}>
            <IconClose />
          </button>
        </header>

        <div className="trophy-body">
          {loading && !set && (
            <div className="trophy-rows">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="trophy-row is-skeleton" />
              ))}
            </div>
          )}

          {!loading && res && !set && <TrophyProblem game={game} res={res} onOpenSettings={onOpenSettings} onEdit={onEdit} onLinked={setRes} />}

          {set && (
            <>
              {res?.error && <div className="note trophy-warn">{res.error}. {t('Показаны сохранённые данные.')}</div>}
              <div className="trophy-rows">
                {items.map((a) => (
                  <TrophyRow
                    key={a.id}
                    a={a}
                    onFocus={() => setFocused(a)}
                    onOpen={() => {
                      play('select')
                      setViewing(a)
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        <footer className="sheet-hints">
          {focused && set ? (
            <span className="trophy-detail-hint">
              {focused.earnedAt ? t('Получен {v}', { v: dateFmt.format(focused.earnedAt) }) : t('Ещё не получен')}
              {focused.rarity !== undefined && t(', у {v}% игроков', { v: focused.rarity.toLocaleString(locale(), { maximumFractionDigits: focused.rarity < 1 ? 1 : 0 }) })}
            </span>
          ) : (
            <Hint glyph="confirm" label={t('Выбрать')} />
          )}
          {focused?.shot && <Hint glyph="confirm" label={t('Снимок')} />}
          {set && <Hint glyph="search" label={t('Обновить')} />}
          <Hint glyph="back" label={t('Закрыть')} />
        </footer>
      </div>
      <AnimatePresence>{viewing?.shot && <ShotViewer a={viewing} onClose={() => setViewing(null)} />}</AnimatePresence>
    </motion.div>
  )
}

/** Снимок момента получения на весь экран */
function ShotViewer({ a, onClose }: { a: Achievement; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useSpatialNav(ref, { priority: 16, onBack: onClose, autoFocus: '.shot-close' })
  return (
    <motion.div
      ref={ref}
      className="shot-viewer"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onClose}
    >
      <motion.img
        src={media(a.shot, 'screen')}
        alt=""
        initial={{ transform: 'scale(0.96)' }}
        animate={{ transform: 'scale(1)' }}
        transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
      />
      <div className="shot-caption">
        <span className={`trophy-tier tier-${a.tier}`}>
          <IconTrophy />
        </span>
        <span className="trophy-text">
          <span className="trophy-name">{a.title}</span>
          {a.earnedAt && <span className="trophy-desc">{t('Получен {v}', { v: dateFmt.format(a.earnedAt) })}</span>}
        </span>
        <button data-nav className="btn btn-round shot-close" onClick={onClose} aria-label={t('Закрыть')}>
          <IconClose />
        </button>
      </div>
    </motion.div>
  )
}

function TrophyRow({ a, onFocus, onOpen }: { a: Achievement; onFocus: () => void; onOpen: () => void }) {
  const secret = a.hidden && !a.earnedAt
  const icon = a.earnedAt ? a.icon : (a.iconLocked ?? a.icon)
  // Картинка не загрузилась (нет сети, сервер не ответил) — кубок вместо значка битой картинки
  const [broken, setBroken] = useState(false)
  return (
    <button
      data-nav
      className={`trophy-row ${a.earnedAt ? 'is-earned' : ''} ${a.shot ? 'has-shot' : ''}`}
      onFocus={onFocus}
      onMouseEnter={onFocus}
      onClick={a.shot ? onOpen : undefined}
    >
      <span className={`trophy-icon tier-${a.tier}`}>
        {secret ? <span className="trophy-secret">?</span> : icon && !broken ? <img src={icon} alt="" loading="lazy" onError={() => setBroken(true)} /> : <IconTrophy className="trophy-icon-fallback" />}
      </span>
      <span className="trophy-text">
        <span className="trophy-name">{secret ? t('Скрытый трофей') : a.title}</span>
        <span className="trophy-desc">{secret ? t('Продолжайте играть, чтобы узнать, что это за трофей') : a.description}</span>
      </span>
      {a.shot && <img className="trophy-shot" src={media(a.shot, 'tile')} alt="" loading="lazy" />}
      <span className={`trophy-tier tier-${a.tier}`} title={TIER_NAMES[a.tier]}>
        <IconTrophy />
      </span>
    </button>
  )
}

/** Что делать, если трофеи не загрузились: нет аккаунта, игра не привязана или платформа не поддерживается */
function TrophyProblem({
  game,
  res,
  onOpenSettings,
  onEdit,
  onLinked
}: {
  game: Game
  res: AchievementResult
  onOpenSettings: () => void
  onEdit: (g: Game) => void
  onLinked: (r: AchievementResult) => void
}) {
  const [query, setQuery] = useState(game.title)
  const [found, setFound] = useState<RaGame[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const search = async () => {
    setBusy(true)
    setErr(null)
    try {
      setFound(await api.findRaGames(query))
    } catch (e) {
      setErr((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (res.needs === 'link' && game.platform === 'ps2') void search()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res.needs])

  const link = async (g: RaGame) => {
    setBusy(true)
    play('select')
    onLinked(await api.linkRaGame(game.id, g.id))
    setBusy(false)
  }

  return (
    <div className="trophy-problem">
      <p className="trophy-problem-text">{res.error}</p>
      {(res.needs === 'ra-account' || res.needs === 'steam-account') && (
        <button data-nav className="btn btn-primary" onClick={onOpenSettings}>
          {t('Открыть настройки трофеев')}
        </button>
      )}
      {res.needs === 'link' && game.platform === 'pc' && (
        <button data-nav className="btn btn-primary" onClick={() => onEdit(game)}>
          {t('Указать Steam AppID')}
        </button>
      )}
      {res.needs === 'link' && game.platform === 'ps2' && (
        <>
          <form
            className="search-box ra-search"
            onSubmit={(e) => {
              e.preventDefault()
              void search()
            }}
          >
            <IconSearch />
            <input data-nav className="input" value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false} />
            <button data-nav type="submit" className="btn btn-glass btn-sm">
              {busy ? <IconReset /> : t('Найти')}
            </button>
          </form>
          {err && <p className="trophy-problem-text">{err}</p>}
          <div className="ra-results">
            {found?.map((g) => (
              <button key={g.id} data-nav className="ra-result" onClick={() => link(g)} disabled={busy}>
                {g.icon && <img src={g.icon} alt="" />}
                <span className="ra-title">{g.title}</span>
                <span className="ra-count">
                  {g.achievements} {plural(g.achievements, ['трофей', 'трофея', 'трофеев'], ['trophy', 'trophies'])}
                </span>
              </button>
            ))}
            {found && !found.length && <p className="trophy-problem-text">{t('Ничего не нашлось. Попробуйте английское название.')}</p>}
          </div>
        </>
      )}
    </div>
  )
}
