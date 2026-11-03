import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { DownloadControl, DownloadJob } from '@shared/types'
import { api } from '../lib/api'
import { fraction, jobLine, timeLeft } from '../lib/downloads'
import { bytes, media } from '../lib/format'
import { rumble } from '../lib/haptics'
import { useSpatialNav } from '../lib/nav'
import { release } from '../lib/release'
import { play } from '../lib/sound'
import { DotText } from './DotText'
import { Hint } from './Glyph'
import { ConfirmDialog, PromptDialog } from './Menus'
import { IconArrowUp, IconClose, IconDownload, IconEdit, IconFolder, IconInstall, IconKey, IconPause, IconPlay, IconRestart, IconTrash } from './Icons'
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

/**
 * Раздел «Загрузки» на весь экран, как страница игры (кнопка в верхней панели рядом с уведомлениями).
 * Вверху — то, что качается сейчас: обложка, крупные проценты, скорость, остаток и кнопки с подписями.
 * Ниже две колонки: очередь (ждут, на паузе, остановились) и готовое. Действия — кнопками на месте, без меню;
 * ✕ нажимает кнопку в фокусе, □ убирает готовые, ○ закрывает раздел
 */
export function DownloadsPage({ jobs, onClose, onPlay, onPickFile }: { jobs: DownloadJob[]; onClose: () => void; onPlay: (gameId: string) => void; onPickFile: (gameId: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [asking, setAsking] = useState<Action | null>(null)
  // Архив просит пароль: вводим прямо здесь, распаковка продолжается с ним
  const [passwordFor, setPasswordFor] = useState<DownloadJob | null>(null)
  const [hint, setHint] = useState('')
  const main = jobs.find((j) => j.status === 'active') ?? jobs.find((j) => j.status !== 'done')
  const waiting = jobs.filter((j) => j.status !== 'done' && j !== main)
  const done = jobs.filter((j) => j.status === 'done')
  // □ убирает только законченные: ждущие установки или файла игры остаются
  const clearable = done.filter((j) => !j.install || j.install === 'installed').length
  // «Выше в очереди» — только у тех, перед кем ждёт другая загрузка
  const firstQueued = waiting.find((j) => j.status === 'queued')
  const ctx: Ctx = { askPassword: setPasswordFor, play: onPlay, pickFile: onPickFile }
  useEffect(() => rumble('open'), [])

  useSpatialNav(ref, {
    priority: 30,
    active: !asking && !passwordFor,
    onBack: onClose,
    autoFocus: '.dl-now .btn, .dl-act, .gp-close',
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

  const active = jobs.find((j) => j.status === 'active')
  const chips = [
    active?.speed ? t('{v}/с', { v: bytes(active.speed) }) : '',
    waiting.length ? t('в очереди: {n}', { n: waiting.length }) : '',
    done.length ? t('готово: {n}', { n: done.length }) : ''
  ].filter(Boolean)
  const bg = main?.hero ?? main?.cover ?? done[0]?.hero ?? done[0]?.cover

  const row = (j: DownloadJob) => (
    <div key={j.id} className={`dl-job is-${j.status} ${j.installError ? 'has-error' : ''}`}>
      {j.cover ? (
        <img className="dl-job-cover" src={media(j.cover, 'tile')} alt="" />
      ) : (
        <span className="dl-job-cover dl-job-blank">
          <IconDownload />
        </span>
      )}
      <span className="dl-job-main">
        <span className="dl-job-top">
          <span className="dl-job-name">{j.title}</span>
          {j.status !== 'done' && !j.downloaded && j.received > 0 && j.size > 0 && <span className="dl-job-pct">{Math.floor(fraction(j) * 100)}%</span>}
        </span>
        {tagsOf(j).length > 0 && <span className="dl-job-tags">{tagsOf(j).join(' · ')}</span>}
        {j.status !== 'done' && (
          <span className="dl-job-bar">
            <span style={{ transform: `scaleX(${fraction(j)})` }} />
          </span>
        )}
        <span className="dl-job-line">{jobLine(j)}</span>
      </span>
      <span className="dl-job-acts">
        {actionsFor(j, j.status === 'queued' && j !== firstQueued, ctx).map((a) => (
          <button
            key={a.id}
            data-nav
            className={a.main ? 'btn btn-primary dl-act-main' : `btn btn-round dl-act ${a.danger ? 'is-danger' : ''}`}
            aria-label={a.label}
            title={a.label}
            onFocus={focusHint(a)}
            onClick={() => press(a)}
          >
            {a.icon}
            {a.main && a.label}
          </button>
        ))}
      </span>
    </div>
  )

  return (
    <motion.div
      className="sheet game-page dl-page"
      initial={{ transform: 'translateY(100%)' }}
      animate={{ transform: 'translateY(0%)' }}
      exit={{ transform: 'translateY(100%)', transition: { duration: 0.24, ease: [0.32, 0.72, 0, 1] } }}
      transition={{ duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
    >
      {bg && <img className={`gp-hero ${main?.hero ? '' : 'is-blur'}`} src={media(bg, main?.hero ? 'screen' : 'tile')} alt="" />}
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
          <button data-nav className="btn btn-round gp-close" onClick={onClose} onFocus={() => setHint(t('Закрыть'))} aria-label={t('Закрыть')}>
            <IconClose />
          </button>
        </header>

        <div className="dl-page-body">
          {main && <NowCard job={main} onPress={press} onHint={focusHint} ctx={ctx} />}

          {(waiting.length > 0 || done.length > 0) && (
            <div className="dl-cols">
              <section className="gp-card dl-col">
                <h2 className="gp-card-title">
                  {t('Очередь')}
                  <span className="gp-card-sub">{waiting.length || ''}</span>
                </h2>
                {waiting.length ? <div className="dl-jobs">{waiting.map(row)}</div> : <p className="dl-col-empty">{t('Больше ничего не ждёт')}</p>}
              </section>
              <section className="gp-card dl-col">
                <h2 className="gp-card-title">
                  {t('Готово')}
                  <span className="gp-card-sub">{done.length || ''}</span>
                </h2>
                {done.length ? <div className="dl-jobs">{done.map(row)}</div> : <p className="dl-col-empty">{t('Скачанное появится здесь')}</p>}
              </section>
            </div>
          )}

          {!jobs.length && (
            <div className="notice-empty dl-page-empty">
              <IconDownload />
              <p>{t('Загрузок нет')}</p>
              <p className="notice-empty-hint">{t('Скачать игру можно из магазина или из библиотеки — кнопкой «Скачать»')}</p>
            </div>
          )}
        </div>

        <footer className="sheet-hints">
          <Hint glyph="confirm" label={hint || t('Выбрать')} />
          {clearable > 0 && <Hint glyph="search" label={t('Убрать готовые')} />}
          <Hint glyph="back" label={t('Назад')} />
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

/** То, что качается сейчас: крупно, с понятными числами и кнопками с подписями */
function NowCard({ job, onPress, onHint, ctx }: { job: DownloadJob; onPress: (a: Action) => void; onHint: (a: Action) => () => void; ctx: Ctx }) {
  const pct = Math.floor(fraction(job) * 100)
  const tags = tagsOf(job)
  const actions = actionsFor(job, false, ctx)
  const u = job.phase === 'extracting' ? job.unpack : undefined
  const stats: [string, string][] =
    job.status === 'error'
      ? []
      : u
        ? [
            [t('Распаковано'), t('{a} из {b}', { a: bytes(u.done), b: bytes(u.total) })],
            [t('Скорость'), job.speed ? t('{v}/с', { v: bytes(job.speed) }) : '—'],
            [t('Осталось'), job.speed ? timeLeft((u.total - u.done) / job.speed) : '—']
          ]
        : ([
          [t('Скачано'), job.size ? t('{a} из {b}', { a: bytes(job.received), b: bytes(job.size) }) : job.received ? bytes(job.received) : '—'],
          [t('Скорость'), job.status === 'active' && job.speed ? t('{v}/с', { v: bytes(job.speed) }) : '—'],
          [t('Осталось'), job.status === 'active' && job.speed && job.size ? timeLeft((job.size - job.received) / job.speed) : '—']
        ] as [string, string][])
  return (
    <section className={`gp-card dl-now is-${job.status}`}>
      {job.cover ? (
        <img className="dl-now-cover" src={media(job.cover, 'tile')} alt="" />
      ) : (
        <span className="dl-now-cover dl-job-blank">
          <IconDownload />
        </span>
      )}
      <div className="dl-now-main">
        <div className="dl-now-top">
          <div className="dl-now-titles">
            <h2 className="dl-now-title">{job.title}</h2>
            {tags.length > 0 && (
              <span className="dl-chips">
                {tags.map((x) => (
                  <span key={x} className="dl-chip">
                    {x}
                  </span>
                ))}
              </span>
            )}
          </div>
          <DotText className="dl-now-pct" text={`${pct}%`} />
        </div>
        <span className="dl-now-bar">
          <span style={{ transform: `scaleX(${fraction(job)})` }} />
        </span>
        {/* Пока качается, числа — ниже; строка — для очереди, паузы, ошибки и стадий торрента */}
        {(job.status !== 'active' || job.phase) && <p className="dl-now-state">{jobLine(job)}</p>}
        {stats.length > 0 && (
          <dl className="gp-stats dl-now-stats">
            {stats.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="dl-now-actions">
          {actions.map((a, i) => (
            <button key={a.id} data-nav className={`btn ${i === 0 ? 'btn-primary' : 'btn-glass'} ${a.danger ? 'is-danger' : ''}`} onFocus={onHint(a)} onClick={() => onPress(a)}>
              {a.icon} {a.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
