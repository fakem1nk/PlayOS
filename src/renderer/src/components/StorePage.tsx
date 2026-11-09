import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Game, GameDetails, StoreItem, StorePage as StorePageData } from '@shared/types'
import { api } from '../lib/api'
import { useSwipe } from '../lib/drag'
import { useInputLayer } from '../lib/input'
import { useSpatialNav } from '../lib/nav'
import { notInstalled } from '../lib/format'
import { addStoreGame, libraryGameFor, optionsCount, releaseText, useStoreSteam } from '../lib/shop'
import { play } from '../lib/sound'
import { DotText } from './DotText'
import { Hint } from './Glyph'
import { IconChevron, IconClock, IconClose, IconDownload, IconGlobe, IconGrid, IconImage, IconPlus } from './Icons'
import { locale, t } from '@shared/i18n'

/** Абзацев описания до «Читать полностью» */
const ABOUT_PREVIEW = 5
/** Скриншотов в карточке: один большой и два поменьше, на последнем — «+N» с остальными */
const SHOT_PREVIEW = 3

/** Часы с одним знаком после запятой: 14,6 ч */
const hours = (sec: number) => t('{v} ч', { v: (sec / 3600).toLocaleString(locale(), { maximumFractionDigits: sec < 36000 ? 1 : 0 }) })

interface Props {
  item: StoreItem
  games: Game[]
  onClose: () => void
  /** Игра уже в библиотеке — открыть её страницу */
  onOpenGame: (g: Game) => void
  /** Скачать игру библиотеки, которой нет на этом ПК */
  onDownload: (g: Game) => void
}

/** Страница игры в магазине: шапка с роликом, что делать с игрой, описание, скриншоты и время прохождения */
export function StorePage({ item, games, onClose, onOpenGame, onDownload }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [page, setPage] = useState<StorePageData | null | undefined>(undefined)
  const [hltb, setHltb] = useState<GameDetails['hltb'] | undefined>(undefined)
  const [expanded, setExpanded] = useState(false)
  const [shot, setShot] = useState<number | null>(null)
  const [trailerOn, setTrailerOn] = useState(false)
  const [logoOk, setLogoOk] = useState(true)
  const [adding, setAdding] = useState(false)
  // Варианты загрузки с уточнением одноимённых игр у Steam — приходят отдельно и позже страницы
  const [exactOptions, setExactOptions] = useState<number | undefined>(undefined)
  const steam = useStoreSteam()
  const libGame = libraryGameFor(games, item.appId, item.title)

  // Страница, варианты загрузки и время прохождения грузятся независимо: что пришло — то сразу на экране
  useEffect(() => {
    let alive = true
    api
      .storePage(item.appId)
      .then((p) => alive && setPage(p))
      .catch(() => alive && setPage(null))
    api
      .storeOptionCount(item.appId, item.title)
      .then((n) => alive && setExactOptions(n))
      .catch(() => {
        /* остаются варианты из страницы */
      })
    api
      .storeHltb(item.appId, item.title)
      .then((h) => alive && setHltb(h ?? null))
      .catch(() => alive && setHltb(null))
    return () => {
      alive = false
    }
  }, [item.appId, item.title])

  useSpatialNav(ref, { priority: 15, active: shot === null, onBack: onClose, autoFocus: '.gp-actions .btn' })

  const data: StoreItem = page ?? item
  const quiet = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // В библиотеку — первым делом: оттуда игру скачивают и запускают. Стоит в Steam на этом ПК — main добавит её сразу с папкой
  const addToLibrary = async () => {
    if (adding) return
    play('select')
    setAdding(true)
    try {
      await addStoreGame(item)
    } finally {
      setAdding(false)
    }
  }
  const openSteam = (how: 'store' | 'web') => {
    play('select')
    void api.storeOpen(item.appId, how)
  }

  // Сначала игра попадает в библиотеку, потом её можно скачать. Steam — всегда второстепенная кнопка
  const options = exactOptions ?? page?.options ?? item.options ?? 0
  const primary = libGame
    ? { label: t('Открыть в библиотеке'), icon: <IconGrid />, run: () => (play('select'), onOpenGame(libGame)) }
    : { label: adding ? t('Добавляем…') : t('Добавить в библиотеку'), icon: <IconPlus />, run: addToLibrary }
  const download =
    libGame && notInstalled(libGame) && !data.upcoming
      ? { label: options ? `${t('Скачать')} · ${optionsCount(options)}` : t('Скачать'), icon: <IconDownload />, run: () => (play('select'), onDownload(libGame)) }
      : null

  const reviews = data.reviews
  const facts = [
    [data.upcoming ? t('Выход') : t('Дата выхода'), releaseText(data)],
    [t('Разработчик'), page?.developers.join(', ')],
    [t('Издатель'), page?.publishers.join(', ')],
    [t('Серия'), page?.franchise],
    [t('Отзывы в Steam'), reviews ? t('{label}: {p}% из {n}', { label: reviews.label, p: reviews.percent, n: reviews.count.toLocaleString(locale()) }) : undefined]
  ].filter(([, v]) => v) as [string, string][]
  const about = page?.about ?? []
  const shown = expanded ? about : about.slice(0, ABOUT_PREVIEW)
  const shots = page?.screenshots ?? []

  return (
    <motion.div
      className="sheet game-page store-page"
      initial={{ transform: 'translateY(100%)' }}
      animate={{ transform: 'translateY(0%)' }}
      exit={{ transform: 'translateY(100%)', transition: { duration: 0.24, ease: [0.32, 0.72, 0, 1] } }}
      transition={{ duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
    >
      {(data.hero || data.cover) && <CdnImg className={`gp-hero ${data.hero ? '' : 'is-blur'}`} src={(data.hero ?? data.cover)!} stallMs={12000} />}
      {page?.trailer && !quiet && (
        <video
          className={`gp-hero store-trailer ${trailerOn ? 'is-on' : ''}`}
          src={page.trailer}
          muted
          loop
          autoPlay
          playsInline
          onPlaying={() => setTrailerOn(true)}
        />
      )}
      <div className="gp-shade" />
      <div className="gp-inner" ref={ref}>
        <header className="gp-head">
          <div className="gp-title-wrap">
            {data.logo && logoOk ? (
              <img className="gp-logo" src={data.logo} alt={data.title} onError={() => setLogoOk(false)} />
            ) : (
              <h1 className="gp-title">{data.title}</h1>
            )}
            <div className="gp-meta">
              {releaseText(data) && <span>{data.upcoming ? t('Выход: {v}', { v: releaseText(data) }) : releaseText(data)}</span>}
              {reviews?.label && <span>{t('{label} · {p}%', { label: reviews.label, p: reviews.percent })}</span>}
              {libGame && <span className="store-owned">{t('Уже в библиотеке')}</span>}
            </div>
          </div>
          <button data-nav className="btn btn-round gp-close" onClick={onClose} aria-label={t('Закрыть')}>
            <IconClose />
          </button>
        </header>

        <div className="gp-actions">
          {primary && (
            <button data-nav className="btn btn-primary" disabled={adding} onClick={primary.run}>
              {primary.icon} {primary.label}
            </button>
          )}
          {download && (
            <button data-nav className="btn btn-glass" onClick={download.run}>
              {download.icon} {download.label}
            </button>
          )}
          {steam && (
            <button data-nav className="btn btn-glass" onClick={() => openSteam(steam.client ? 'store' : 'web')}>
              <IconGlobe /> {steam.client ? t('Открыть в Steam') : t('Открыть в браузере')}
            </button>
          )}
        </div>

        <div className="gp-body">
          <section className="gp-col">
            <div className="gp-card" data-nav tabIndex={-1}>
              <h2 className="gp-card-title">{t('Об игре')}</h2>
              {page === undefined ? (
                // Краткое описание уже есть в плитке витрины — показываем его сразу, полный текст догружается
                <>
                  {item.short && <p className="gp-desc store-lead">{item.short}</p>}
                  <div className="gp-skeleton">
                    <span />
                    <span />
                    <span />
                  </div>
                </>
              ) : data.short || about.length ? (
                <>
                  {data.short && <p className="gp-desc store-lead">{data.short}</p>}
                  <div className="store-about">
                    {shown.map((b, i) =>
                      b.kind === 'h' ? (
                        <h3 key={i} className="store-about-h" data-nav={expanded || undefined} tabIndex={-1}>
                          {b.text}
                        </h3>
                      ) : (
                        <p key={i} className={b.kind === 'li' ? 'store-about-li' : 'store-about-p'} data-nav={expanded || undefined} tabIndex={-1}>
                          {b.text}
                        </p>
                      )
                    )}
                  </div>
                  {!expanded && about.length > ABOUT_PREVIEW && (
                    <button
                      data-nav
                      className="btn btn-glass store-more"
                      onClick={() => {
                        play('select')
                        setExpanded(true)
                      }}
                    >
                      {t('Читать полностью')}
                    </button>
                  )}
                </>
              ) : (
                <p className="gp-empty">{page === null ? t('Описание не загрузилось: Steam не ответил.') : t('У этой игры нет описания в Steam.')}</p>
              )}
            </div>

            {facts.length > 0 && (
              <div className="gp-card" data-nav tabIndex={-1}>
                <h2 className="gp-card-title">{t('Подробности')}</h2>
                <dl className="gp-facts">
                  {facts.map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
                {data.tags && data.tags.length > 0 && (
                  <div className="store-pills store-tags">
                    {data.tags.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="gp-col">
            {(page === undefined || shots.length > 0) && (
              <div className="gp-card">
                <h2 className="gp-card-title">
                  <IconImage /> {t('Скриншоты')}
                  {shots.length > 0 && <span className="gp-card-sub">{shots.length}</span>}
                </h2>
                {page === undefined ? (
                  <div className="store-shots is-wait" aria-hidden>
                    <span className="store-shot is-main" />
                    <span className="store-shot" />
                    <span className="store-shot" />
                  </div>
                ) : (
                  <div className="store-shots">
                  {shots.slice(0, SHOT_PREVIEW).map((s, i) => {
                    const more = i === SHOT_PREVIEW - 1 ? shots.length - SHOT_PREVIEW : 0
                    return (
                      <button
                        key={s.full}
                        data-nav
                        className={`store-shot ${i === 0 ? 'is-main' : ''}`}
                        aria-label={more > 0 ? t('Все скриншоты: {n}', { n: shots.length }) : t('Скриншот {n}', { n: i + 1 })}
                        onClick={() => {
                          play('select')
                          setShot(i)
                        }}
                      >
                        {/* Большой — сначала превью, полный размер подгружается следом; маленьким хватает превью */}
                        <ProgressiveShot shot={s} thumbOnly={i > 0} />
                        {more > 0 && <span className="store-shot-more">+{more}</span>}
                      </button>
                    )
                  })}
                  </div>
                )}
              </div>
            )}

            <div className="gp-card" data-nav tabIndex={-1}>
              <h2 className="gp-card-title">
                <IconClock /> {t('Время прохождения')}
              </h2>
              {hltb === undefined ? (
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
                  <p className="gp-source">{hltb.title !== item.title ? t('По данным HowLongToBeat для «{title}»', { title: hltb.title }) : t('По данным HowLongToBeat')}</p>
                </>
              ) : (
                <p className="gp-empty">{t('HowLongToBeat ничего не знает об этой игре — или сайт сейчас недоступен.')}</p>
              )}
            </div>
          </section>
        </div>

        <footer className="sheet-hints">
          <Hint glyph="confirm" label={t('Выбрать')} />
          <Hint glyph="back" label={t('Назад')} />
        </footer>
      </div>
      <AnimatePresence>{shot !== null && shots.length > 0 && <ShotViewer key="shot" shots={shots} index={shot} onIndex={setShot} onClose={() => setShot(null)} />}</AnimatePresence>
    </motion.div>
  )
}

type Shot = StorePageData['screenshots'][number]

/** Адреса CDN Steam, отдающие одни и те же картинки */
const CDN_HOSTS = ['shared.akamai.steamstatic.com', 'shared.fastly.steamstatic.com', 'shared.steamstatic.com']

/** Куда идти за картинкой по очереди: её адрес, зеркала и напоследок снова первый, в обход кэша */
function mirrors(url: string): string[] {
  const m = /^https:\/\/([^/]+)(\/.*)$/.exec(url)
  const list = m && CDN_HOSTS.includes(m[1]) ? [m[1], ...CDN_HOSTS.filter((h) => h !== m[1])].map((h) => `https://${h}${m[2]}`) : [url]
  return [...list, `${list[0]}${list[0].includes('?') ? '&' : '?'}retry=1`]
}

interface CdnImgProps {
  src: string
  className?: string
  /** Сколько ждать картинку, прежде чем попросить её с другого адреса */
  stallMs: number
  onLoad?: () => void
  /** Не загрузилась ни с одного адреса */
  onFail?: () => void
}

/**
 * Картинка с CDN Steam, которая не остаётся пустой. Akamai у части провайдеров отвечает через раз, а повисшее
 * соединение само не обрывается: при ошибке или долгом молчании та же картинка берётся с зеркала
 */
function CdnImg(props: CdnImgProps) {
  return <CdnImgInner key={props.src} {...props} />
}

function CdnImgInner({ src, className, stallMs, onLoad, onFail }: CdnImgProps) {
  const urls = useMemo(() => mirrors(src), [src])
  const [n, setN] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const failed = n >= urls.length
  useEffect(() => {
    if (loaded || failed) return
    const id = setTimeout(() => setN((x) => x + 1), stallMs)
    return () => clearTimeout(id)
  }, [n, loaded, failed, stallMs])
  useEffect(() => {
    if (failed) onFail?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failed])
  if (failed) return null
  return (
    <img
      className={className}
      src={urls[n]}
      alt=""
      draggable={false}
      onLoad={() => {
        setLoaded(true)
        onLoad?.()
      }}
      onError={() => setN((x) => x + 1)}
    />
  )
}

type LoadState = 'wait' | 'ok' | 'fail'

/**
 * Скриншот с ленивой загрузкой: сразу видно превью 600×338, полный размер грузится поверх и проявляется,
 * когда готов. Пока нет ничего — мерцающая заглушка, не загрузилось совсем — значок картинки
 */
function ProgressiveShot({ shot, thumbOnly = false }: { shot: Shot; thumbOnly?: boolean }) {
  const [thumb, setThumb] = useState<LoadState>('wait')
  const [full, setFull] = useState<LoadState>(thumbOnly ? 'fail' : 'wait')
  const state =
    full === 'ok' ? 'is-ready' : thumb === 'ok' ? (full === 'fail' ? 'is-thumb-only' : '') : thumb === 'fail' && full === 'fail' ? 'is-failed' : 'is-loading'
  return (
    <span className={`shot-prog ${state}`}>
      <CdnImg className="shot-thumb" src={shot.thumb} stallMs={8000} onLoad={() => setThumb('ok')} onFail={() => setThumb('fail')} />
      {!thumbOnly && <CdnImg className="shot-full" src={shot.full} stallMs={20000} onLoad={() => setFull('ok')} onFail={() => setFull('fail')} />}
      {state === 'is-failed' && <IconImage className="shot-broken" />}
    </span>
  )
}

/** Скриншот во весь экран: влево-вправо листают, ○ закрывает. Соседние полноразмерные подгружаются заранее */
function ShotViewer({ shots, index, onIndex, onClose }: { shots: Shot[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  useEffect(() => {
    // Текущий важнее: соседей просим чуть позже
    const id = setTimeout(() => {
      for (const i of [index + 1, index - 1]) if (shots[i]) new Image().src = shots[i].full
    }, 400)
    return () => clearTimeout(id)
  }, [index, shots])
  const step = (dir: -1 | 1) => {
    const next = index + dir
    if (next < 0 || next >= shots.length) return play('bump')
    play('move')
    onIndex(next)
  }
  // Мышью — зажать и провести влево или вправо; такое отпускание просмотр не закрывает
  const ref = useRef<HTMLDivElement>(null)
  useSwipe(ref, step)
  useInputLayer(
    (a) => {
      if (a === 'left' || a === 'right') return step(a === 'left' ? -1 : 1)
      if (a === 'back' || a === 'confirm') {
        play('back')
        return onClose()
      }
      // Остальное до страницы под просмотром не доходит
    },
    30
  )
  return (
    <motion.div ref={ref} className="store-viewer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={onClose}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.div
          key={shots[index].full}
          className="store-viewer-img"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          <ProgressiveShot shot={shots[index]} />
        </motion.div>
      </AnimatePresence>
      {/* Стрелки для мыши: клик мимо картинки по-прежнему закрывает просмотр */}
      {([-1, 1] as const).map((dir) => {
        const off = index + dir < 0 || index + dir >= shots.length
        return (
          <button
            key={dir}
            className={`btn btn-round store-viewer-arrow ${dir < 0 ? 'is-prev' : 'is-next'} ${off ? 'is-off' : ''}`}
            tabIndex={-1}
            aria-label={dir < 0 ? t('Предыдущий скриншот') : t('Следующий скриншот')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation()
              if (!off) step(dir)
            }}
          >
            <IconChevron dir={dir < 0 ? 'left' : 'right'} />
          </button>
        )
      })}
      <div className="store-viewer-bar">
        <DotText text={`${index + 1} / ${shots.length}`} />
        <Hint glyph="adjust" label={t('Листать')} />
        <Hint glyph="back" label={t('Закрыть')} />
      </div>
    </motion.div>
  )
}
