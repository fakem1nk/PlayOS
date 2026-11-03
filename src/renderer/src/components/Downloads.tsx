import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { DownloadControl, DownloadJob } from '@shared/types'
import { api } from '../lib/api'
import { finishedAt, fraction, jobLine, SPEED_SPAN, speedHistory, timeLeft } from '../lib/downloads'
import { bytes, media } from '../lib/format'
import { rumble } from '../lib/haptics'
import { useSpatialNav } from '../lib/nav'
import { release } from '../lib/release'
import { play } from '../lib/sound'
import { useNow } from '../lib/state'
import { DotText } from './DotText'
import { Hint } from './Glyph'
import { PixelBar, type PixelTone } from './PixelBar'
import { ConfirmDialog, PromptDialog } from './Menus'
import { IconArrowUp, IconClose, IconDownload, IconEdit, IconFolder, IconGrid, IconInstall, IconKey, IconPause, IconPlay, IconRestart, IconSearch, IconTrash } from './Icons'
import { t } from '@shared/i18n'
import '../styles-store.css'

interface Action {
  id: string
  label: string
  icon: ReactNode
  run: () => void
  danger?: boolean
  /** Главное действие строки (Установить, Играть) — кнопка с подписью, а не круглая */
  main?: boolean
  /** Спросить перед действием: файлы удалятся */
  confirm?: { title: string; text: string; button: string }
}

/** Что страница умеет сама: пароль от архива, запуск игры, выбор файла игры */
interface Ctx {
  askPassword: (j: DownloadJob) => void
  play: (gameId: string) => void
  pickFile: (gameId: string) => void
}

/** Что можно сделать с загрузкой в этом состоянии — кнопками прямо на месте, без меню */
function actionsFor(j: DownloadJob, canMoveUp: boolean, ctx: Ctx): Action[] {
  const go = (action: DownloadControl) => () => void api.downloadControl(j.id, action)
  const folder: Action = { id: 'folder', label: t('Открыть папку'), icon: <IconFolder />, run: go('folder') }
  if (j.status === 'done') {
    const remove: Action = { id: 'remove', label: t('Убрать из списка'), icon: <IconClose />, run: go('remove') }
    const del: Action = {
      id: 'delete',
      label: t('Удалить файлы'),
      icon: <IconTrash />,
      danger: true,
      run: go('deleteFiles'),
      confirm: { title: t('Удалить файлы «{title}»?', { title: j.title }), text: t('Скачанные файлы удалятся с диска.'), button: t('Удалить') }
    }
    const gameId = j.gameId ?? ''
    switch (j.install) {
      case 'running':
        return [folder]
      case 'ready':
        return [
          { id: 'install', label: t('Установить'), icon: <IconInstall />, run: go('install'), main: true },
          // PlayOS ошибся и это уже готовая игра — указать её EXE без установки
          { id: 'pick', label: t('Указать файл игры'), icon: <IconEdit />, run: () => ctx.pickFile(gameId) },
          folder,
          remove,
          del
        ]
      case 'manual':
        return [{ id: 'pick', label: t('Указать файл игры'), icon: <IconFolder />, run: () => ctx.pickFile(gameId), main: true }, folder, remove, del]
      case 'installed':
        return [
          { id: 'play', label: t('Играть'), icon: <IconPlay />, run: () => ctx.play(gameId), main: true },
          folder,
          remove,
          // Игра стоит отдельно от установщика — его можно убрать с диска; игру без установщика удаляют из её меню
          ...(j.installer
            ? [
                {
                  ...del,
                  label: t('Удалить установщик'),
                  confirm: { title: t('Удалить установщик «{title}»?', { title: j.title }), text: t('Скачанные файлы установщика удалятся с диска. Установленная игра останется.'), button: t('Удалить') }
                }
              ]
            : [])
        ]
    }
    return [folder, remove, del]
  }
  const going = j.status === 'active' || j.status === 'queued'
  return [
    going
      ? { id: 'pause', label: t('Пауза'), icon: <IconPause />, run: go('pause') }
      : j.needPassword
        ? { id: 'password', label: t('Ввести пароль'), icon: <IconKey />, run: () => ctx.askPassword(j) }
        : j.status === 'error'
          ? { id: 'resume', label: t('Повторить'), icon: <IconRestart />, run: go('resume') }
          : { id: 'resume', label: t('Продолжить'), icon: <IconPlay />, run: go('resume') },
    ...(canMoveUp ? [{ id: 'up', label: t('Выше в очереди'), icon: <IconArrowUp />, run: go('up') }] : []),
    folder,
    {
      id: 'cancel',
      label: t('Отменить загрузку'),
      icon: <IconTrash />,
      danger: true,
      run: go('cancel'),
      confirm: { title: t('Отменить загрузку «{title}»?', { title: j.title }), text: t('Уже скачанная часть удалится с диска.'), button: t('Отменить загрузку') }
    }
  ]
}

/** Кто собрал раздачу и версия — коротко, вместо длинного названия раздачи */
const tagsOf = (j: DownloadJob) => {
  const r = release(j.name)
  return [r.by, r.version, r.dlc ? 'DLC' : ''].filter(Boolean) as string[]
}

/** Сколько процентов — целым числом */
const pctOf = (j: DownloadJob) => Math.floor(fraction(j) * 100)

/**
 * Цвет пиксельной полосы: качается — белый, распаковка — фиолетовый, ошибка — красный, остальное — приглушённый.
 * Ждёт пароль — не ошибка: всё скачано, полоса спокойная, а о пароле говорит значок с ключом
 */
const toneOf = (j: DownloadJob): PixelTone =>
  j.status === 'error' && !j.needPassword ? 'error' : j.phase === 'extracting' ? 'unpack' : j.status === 'active' ? 'get' : 'pause'

/** Ряд обложек листается вбок: обложка в фокусе — целиком на экране, с запасом под соседнюю */
function revealTile(el: HTMLElement) {
  const shelf = el.closest<HTMLElement>('.dl-shelf')
  if (!shelf) return
  const pad = el.offsetWidth * 0.6
  const s = shelf.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  const dx = r.left - pad < s.left ? r.left - pad - s.left : r.right + pad > s.right ? r.right + pad - s.right : 0
  if (Math.abs(dx) > 1) shelf.scrollBy({ left: dx, behavior: 'smooth' })
}

/** Подпись под обложкой — одной строкой, коротко: что с загрузкой сейчас */
function tileNote(j: DownloadJob, place: number): string {
  if (j.status === 'done') {
    if (j.install === 'ready') return t('Можно установить')
    if (j.install === 'running') return t('Идёт установка')
    if (j.install === 'installed') return t('Можно играть')
    if (j.install === 'manual') return t('Укажите файл игры')
    return t('Скачано')
  }
  if (j.status === 'active') {
    if (j.phase === 'extracting') return t('Распаковка · {p}%', { p: pctOf(j) })
    if (j.phase === 'metadata') return t('Ищем раздающих…')
    if (j.phase === 'checking') return t('Проверяем скачанное…')
    return j.speed ? t('{p}% · {v}/с', { p: pctOf(j), v: bytes(j.speed) }) : `${pctOf(j)}%`
  }
  if (j.status === 'paused') return t('Пауза · {p}%', { p: pctOf(j) })
  if (j.status === 'error') return j.needPassword ? t('Нужен пароль') : t('Ошибка')
  if (j.downloaded) return t('Ждёт распаковки')
  return place > 0 ? t('№{n} в очереди', { n: place }) : t('В очереди')
}

/** Значок на обложке: то, что важно заметить сразу (пауза, ошибка, пароль, можно установить или играть) */
function tileBadge(j: DownloadJob): ReactNode {
  if (j.status === 'paused') return <IconPause />
  if (j.status === 'error') return j.needPassword ? <IconKey /> : <span className="dl-badge-mark">!</span>
  if (j.status !== 'done') return null
  if (j.install === 'ready') return <IconInstall />
  if (j.install === 'installed') return <IconPlay />
  if (j.install === 'running') return <span className="spinner" />
  if (j.install === 'manual') return <IconFolder />
  return null
}

/**
 * Раздел «Загрузки» на весь экран, как главный экран и страница игры (кнопка в верхней панели рядом с уведомлениями).
 * Вверху — ряд обложек всех загрузок: слева «Очередь» (то, что качается, — первой), справа «Готово»; под каждой —
 * пиксельная полоса и коротко, что с ней. Ниже — выбранная загрузка подробно: крупные проценты, полоса во всю ширину,
 * график скорости, числа и кнопки с подписями. ←/→ — по обложкам, ✕ на обложке — главное действие (пауза, установить,
 * играть), ↓ — к остальным кнопкам; □ убирает готовые, ○ закрывает раздел. Пусто — сразу в магазин или библиотеку
 */
export function DownloadsPage({ jobs, onClose, onPlay, onPickFile, onGo }: {
  jobs: DownloadJob[]
  onClose: () => void
  onPlay: (gameId: string) => void
  onPickFile: (gameId: string) => void
  /** Пустой раздел: перейти в магазин или библиотеку */
  onGo: (tab: 'store' | 'library') => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [asking, setAsking] = useState<Action | null>(null)
  // Архив просит пароль: вводим прямо здесь, распаковка продолжается с ним
  const [passwordFor, setPasswordFor] = useState<DownloadJob | null>(null)
  const [hint, setHint] = useState('')
  const [selId, setSelId] = useState<string | null>(null)
  const active = jobs.find((j) => j.status === 'active')
  const queue = [...(active ? [active] : []), ...jobs.filter((j) => j.status !== 'done' && j !== active)]
  const done = jobs.filter((j) => j.status === 'done').sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0))
  const all = [...queue, ...done]
  // Выбранная пропала (убрали, отменили) — на первую; так же при открытии: то, что качается
  const sel = all.find((j) => j.id === selId) ?? all[0]
  // □ убирает только законченные: ждущие установки или файла игры остаются
  const clearable = done.filter((j) => !j.install || j.install === 'installed').length
  const waitingQueue = queue.filter((j) => j.status === 'queued')
  // «Выше в очереди» — только у тех, перед кем ждёт другая загрузка
  const canUp = (j: DownloadJob) => j.status === 'queued' && j !== waitingQueue[0]
  const ctx: Ctx = { askPassword: setPasswordFor, play: onPlay, pickFile: onPickFile }
  useEffect(() => rumble('open'), [])

  useSpatialNav(ref, {
    priority: 30,
    active: !asking && !passwordFor,
    onBack: onClose,
    // Не крестик в шапке: фокус сразу на то, с чем здесь что-то делают
    autoFocus: all.length ? '.dl-tile' : '.dl-empty-actions .btn',
    // С обложки вниз — на главную кнопку карточки, из кнопок вверх — на выбранную обложку, а не на ближайшее по месту
    remap: (next, cur, dir) => {
      const root = ref.current
      if (dir === 'down' && cur.classList.contains('dl-tile') && next.closest('.dl-detail')) return root?.querySelector<HTMLElement>('.dl-detail-actions .btn') ?? next
      if (dir === 'up' && next.classList.contains('dl-tile') && cur.closest('.dl-detail')) return root?.querySelector<HTMLElement>('.dl-tile-cell.is-selected .dl-tile') ?? next
      return next
    },
    onAction: (a) => {
      if (a !== 'search') return false
      if (!clearable) return play('bump')
      play('back')
      void api.downloadControl('', 'clearDone')
    }
  })

  const press = (a: Action) => {
    play('select')
    if (a.confirm) return setAsking(a)
    a.run()
  }
  const focusHint = (a: Action) => () => setHint(a.label)

  const chips = [
    active?.speed ? t('{v}/с', { v: bytes(active.speed) }) : '',
    queue.length ? t('в очереди: {n}', { n: queue.length }) : '',
    done.length ? t('готово: {n}', { n: done.length }) : ''
  ].filter(Boolean)
  const bg = sel?.hero ?? sel?.cover

  const tile = (j: DownloadJob) => {
    const primary = actionsFor(j, canUp(j), ctx)[0]
    const badge = tileBadge(j)
    return (
      <div key={j.id} className={`dl-tile-cell ${j === sel ? 'is-selected' : ''}`}>
        <button
          data-nav
          className={`dl-tile is-${j.status}`}
          aria-label={j.title}
          title={j.title}
          // Мышью: первый клик выбирает, второй — главное действие; с геймпада ✕ сразу делает главное
          onMouseDown={(e) => e.preventDefault()}
          onFocus={(e) => {
            setSelId(j.id)
            setHint(primary?.label ?? '')
            revealTile(e.currentTarget)
          }}
          onClick={(e) => {
            if (j !== sel || document.activeElement !== e.currentTarget) return e.currentTarget.focus()
            if (primary) press(primary)
          }}
        >
          {j.cover ? (
            <img className="dl-tile-img" src={media(j.cover, 'tile')} alt="" />
          ) : (
            <span className="dl-tile-img dl-tile-blank">
              <IconDownload />
            </span>
          )}
          {badge && <span className={`dl-tile-badge is-${j.status === 'error' ? 'error' : 'info'}`}>{badge}</span>}
        </button>
        {j.status !== 'done' ? <PixelBar value={fraction(j)} tone={toneOf(j)} live={j.status === 'active'} size={0.7} /> : <span className="dl-tile-gap" />}
        <span className={`dl-tile-note ${j.status === 'error' ? 'is-error' : ''}`}>{tileNote(j, waitingQueue.indexOf(j) + 1)}</span>
      </div>
    )
  }

  return (
    <motion.div
      className="sheet game-page dl-page"
      initial={{ transform: 'translateY(100%)' }}
      animate={{ transform: 'translateY(0%)' }}
      exit={{ transform: 'translateY(100%)', transition: { duration: 0.24, ease: [0.32, 0.72, 0, 1] } }}
      transition={{ duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
    >
      {bg && <img key={bg} className={`gp-hero ${sel?.hero ? '' : 'is-blur'}`} src={media(bg, sel?.hero ? 'screen' : 'tile')} alt="" />}
      <div className="gp-shade" />
      <div className="gp-inner dl-page-inner" ref={ref}>
        <header className="gp-head dl-page-head">
          <div className="gp-title-wrap">
            <h1 className="gp-title">{t('Загрузки')}</h1>
            {chips.length > 0 && (
              <div className="gp-meta">
                {chips.map((c) => (
                  <span key={c}>{c}</span>
                ))}
              </div>
            )}
          </div>
          <Disks refresh={jobs.length + done.length} />
          <button data-nav className="btn btn-round gp-close" onClick={onClose} onFocus={() => setHint(t('Закрыть'))} aria-label={t('Закрыть')}>
            <IconClose />
          </button>
        </header>

        <div className="dl-page-body">
          {all.length > 0 && (
            <div className="dl-shelf">
              {queue.length > 0 && (
                <section className="dl-group">
                  <h2 className="dl-group-title">
                    {t('Очередь')}
                    <span>{queue.length}</span>
                  </h2>
                  <div className="dl-group-row">{queue.map(tile)}</div>
                </section>
              )}
              {done.length > 0 && (
                <section className="dl-group">
                  <h2 className="dl-group-title">
                    {t('Готово')}
                    <span>{done.length}</span>
                  </h2>
                  <div className="dl-group-row">{done.map(tile)}</div>
                </section>
              )}
            </div>
          )}

          {sel && <Detail key={sel.id} job={sel} canUp={canUp(sel)} ctx={ctx} onPress={press} onHint={focusHint} />}

          {!jobs.length && (
            <div className="dl-empty-page">
              <span className="dl-empty-icon">
                <IconDownload />
              </span>
              <h2 className="dl-empty-title">{t('Загрузок нет')}</h2>
              <p className="dl-empty-text">{t('Скачать игру можно из магазина или из библиотеки — кнопкой «Скачать»')}</p>
              <div className="dl-empty-actions">
                <button data-nav className="btn btn-primary" onFocus={() => setHint(t('Магазин'))} onClick={() => (play('select'), onGo('store'))}>
                  <IconSearch /> {t('Магазин')}
                </button>
                <button data-nav className="btn btn-glass" onFocus={() => setHint(t('Библиотека'))} onClick={() => (play('select'), onGo('library'))}>
                  <IconGrid /> {t('Библиотека')}
                </button>
              </div>
            </div>
          )}
        </div>

        <footer className="sheet-hints">
          <Hint glyph="confirm" label={hint || t('Выбрать')} />
          {clearable > 0 && <Hint glyph="search" label={t('Убрать готовые')} onClick={() => (play('back'), void api.downloadControl('', 'clearDone'))} />}
          <Hint glyph="back" label={t('Назад')} onClick={onClose} />
        </footer>
      </div>
      <AnimatePresence>
        {asking?.confirm && (
          <ConfirmDialog
            {...asking.confirm}
            onCancel={() => setAsking(null)}
            onConfirm={() => {
              const a = asking
              setAsking(null)
              a.run()
            }}
          />
        )}
        {passwordFor && (
          <PromptDialog
            title={t('Пароль от архива «{title}»', { title: passwordFor.title })}
            placeholder={t('Пароль')}
            button={t('Распаковать')}
            maxLength={128}
            onCancel={() => setPasswordFor(null)}
            onSubmit={(v) => {
              setPasswordFor(null)
              void api.downloadPassword(passwordFor.id, v)
            }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  )
}

/**
 * Выбранная загрузка подробно: название и метки, крупные проценты, пиксельная полоса во всю ширину, пока качается —
 * график скорости; числа (скачано, скорость, осталось или размер, когда завершено, где лежит) и кнопки с подписями
 */
function Detail({ job, canUp, ctx, onPress, onHint }: { job: DownloadJob; canUp: boolean; ctx: Ctx; onPress: (a: Action) => void; onHint: (a: Action) => () => void }) {
  const tags = tagsOf(job)
  const actions = actionsFor(job, canUp, ctx)
  const going = job.status !== 'done'
  const working = job.status === 'active' && job.phase !== 'metadata' && job.phase !== 'checking'
  const u = job.phase === 'extracting' ? job.unpack : undefined
  const size = job.size ? bytes(job.size) : '—'
  const stats: [string, string][] =
    job.status === 'done'
      ? [
          [t('Размер'), size],
          [t('Завершено'), job.doneAt ? finishedAt(job.doneAt) : '—'],
          [t('Папка'), job.dir]
        ]
      : u
        ? [
            [t('Распаковано'), t('{a} из {b}', { a: bytes(u.done), b: bytes(u.total) })],
            [t('Скорость'), job.speed ? t('{v}/с', { v: bytes(job.speed) }) : '—'],
            [t('Осталось'), job.speed ? timeLeft((u.total - u.done) / job.speed) : '—']
          ]
        : working
          ? [
              [t('Скачано'), job.size ? t('{a} из {b}', { a: bytes(job.received), b: bytes(job.size) }) : job.received ? bytes(job.received) : '—'],
              [t('Скорость'), job.speed ? t('{v}/с', { v: bytes(job.speed) }) : '—'],
              [t('Осталось'), job.speed && job.size ? timeLeft((job.size - job.received) / job.speed) : '—']
            ]
          : [
              [t('Скачано'), job.size ? t('{a} из {b}', { a: bytes(job.received), b: bytes(job.size) }) : job.received ? bytes(job.received) : '—'],
              [t('Папка'), job.dir]
            ]
  // Строка состояния — когда числа не говорят всего: очередь, пауза, ошибка, стадии торрента, установка
  const state = working && !u ? '' : jobLine(job)
  return (
    <section className={`gp-card dl-detail is-${job.status} ${job.installError ? 'has-error' : ''}`}>
      <div className="dl-detail-top">
        <div className="dl-detail-titles">
          <h2 className="dl-detail-title">{job.title}</h2>
          <span className="dl-detail-sub">
            {tags.map((x) => (
              <span key={x} className="dl-chip">
                {x}
              </span>
            ))}
            <span className="dl-detail-name" title={job.name}>
              {job.name}
            </span>
          </span>
        </div>
        {going && <DotText className="dl-detail-pct" text={`${pctOf(job)}%`} />}
      </div>
      {going && <PixelBar className="dl-detail-bar" value={fraction(job)} tone={toneOf(job)} live={job.status === 'active'} size={1.2} />}
      {working && <SpeedGraph job={job} />}
      {state && <p className="dl-detail-state">{state}</p>}
      <dl className="gp-stats dl-detail-stats">
        {stats.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd title={v}>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="dl-detail-actions">
        {actions.map((a, i) => (
          <button key={a.id} data-nav className={`btn ${i === 0 ? 'btn-primary' : 'btn-glass'} ${a.danger ? 'is-danger' : ''}`} onFocus={onHint(a)} onClick={() => onPress(a)}>
            {a.icon} {a.label}
          </button>
        ))}
      </div>
    </section>
  )
}

/**
 * Скорость за последние две минуты, как в Steam: линия с мягкой заливкой, точка — сейчас, справа пик.
 * Масштаб — от пика за это время, поэтому видно, ровно ли идёт загрузка. Пока двух минут не набралось,
 * график растянут на то, что есть: линия сразу во всю ширину, а не в углу
 */
function SpeedGraph({ job }: { job: DownloadJob }) {
  const now = useNow(1000)
  const log = speedHistory(job).filter(([at]) => at >= now - SPEED_SPAN)
  if (log.length < 2) return null
  const span = Math.max(now - log[0][0], 10_000)
  const from = now - span
  const peak = Math.max(...log.map(([, v]) => v), 1)
  const pts = log.map(([at, v]) => [((at - from) / span) * 100, 100 - (v / peak) * 86] as const)
  const [lx, ly] = pts[pts.length - 1]
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ')
  const area = `${line} L${lx.toFixed(2)} 100 L${pts[0][0].toFixed(2)} 100 Z`
  return (
    <div className="dl-graph">
      <span className="dl-graph-label">{job.phase === 'extracting' ? t('Скорость распаковки') : t('Скорость загрузки')}</span>
      <span className="dl-graph-peak">{t('пик {v}/с', { v: bytes(peak) })}</span>
      <div className="dl-graph-area">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id="dl-graph-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="currentColor" stopOpacity="0.2" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#dl-graph-fill)" />
          <path d={line} fill="none" stroke="currentColor" strokeOpacity="0.85" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="dl-graph-dot" style={{ left: `${lx}%`, top: `${ly}%` }} />
      </div>
    </div>
  )
}

/** Сколько места на дисках с папками загрузок — цифрами из точек и пиксельной полосой занятого, как всё в разделе */
function Disks({ refresh }: { refresh: number }) {
  const [disks, setDisks] = useState<{ root: string; free: number; total: number }[]>([])
  useEffect(() => {
    let alive = true
    api
      .downloadFolders()
      .then((list) => {
        if (!alive) return
        const by = new Map<string, { root: string; free: number; total: number }>()
        for (const f of list) {
          const root = /^[a-z]:/i.test(f.path) ? f.path.slice(0, 2).toUpperCase() : f.path
          if (f.total && !by.has(root)) by.set(root, { root, free: f.free, total: f.total })
        }
        setDisks([...by.values()].slice(0, 2))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [refresh])
  if (!disks.length) return null
  return (
    <div className="dl-disks">
      {disks.map((d) => (
        <div key={d.root} className="dl-disk" title={t('Занято {a} из {b}', { a: bytes(d.total - d.free), b: bytes(d.total) })}>
          <span className="dl-disk-label">{t('Свободно на {d}', { d: d.root })}</span>
          <DotText className="dl-disk-free" text={bytes(d.free)} />
          <PixelBar value={1 - d.free / d.total} tone="disk" size={0.55} />
        </div>
      ))}
    </div>
  )
}
