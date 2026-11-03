import { motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { DownloadOption, Platform } from '@shared/types'
import { api } from '../lib/api'
import { useInputLayer } from '../lib/input'
import { focusEl, useSpatialNav } from '../lib/nav'
import { canDownload } from '../lib/downloads'
import { bytes, media } from '../lib/format'
import { release, sizeBytes } from '../lib/release'
import { KIND_LABELS, optionsCount } from '../lib/shop'
import { play } from '../lib/sound'
import { toast } from '../lib/state'
import { Hint } from './Glyph'
import { WhereTo } from './DownloadFolders'
import { IconClose, IconDownload, IconGlobe, IconMagnet, IconPlus } from './Icons'
import { locale, t } from '@shared/i18n'

interface Props {
  /** Steam AppID игры; 0 — неизвестен, ищем только по названию */
  appId: number
  title: string
  /** Платформа игры: у игр PS2 и PS3 — раздачи для эмулятора */
  platform: Platform
  /** Игра библиотеки и её обложка — для очереди загрузок */
  gameId?: string
  cover?: string
  hero?: string
  onClose: () => void
  /** Настройки → Магазин: источники загрузок */
  onOpenSources: () => void
}

/** Дата раздачи: в этом году — без года */
const dateText = (ms: number) => {
  const d = new Date(ms)
  return d.toLocaleDateString(locale(), d.getFullYear() === new Date().getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * «Скачать» у игры библиотеки, которой нет на этом ПК. Есть варианты в источниках — список вариантов;
 * нет ни одного источника или игры в них нет — объясняем, что сделать
 */
export function DownloadFlow({ appId, title, platform, gameId, cover, hero, onClose, onOpenSources }: Props) {
  const [list, setList] = useState<DownloadOption[] | null>(null)
  const [sources, setSources] = useState(0)
  // Обычно ответ мгновенный — окно-заглушку показываем, только если источники ещё читаются с диска
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    let alive = true
    const id = setTimeout(() => setSlow(true), 300)
    Promise.all([api.storeOptions(appId, title, platform).catch(() => []), api.storeSources().catch(() => [])]).then(([l, s]) => {
      if (!alive) return
      setSources(s.length)
      setList(l)
    })
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [appId, title, platform])

  if (list?.length === 0) return <NoOptions title={title} sources={sources} onClose={onClose} onOpenSources={onOpenSources} />
  if (!list && !slow) return null
  return <OptionsList title={title} gameId={gameId} cover={cover} hero={hero} list={list} onClose={onClose} />
}

/** Каркас окна: затемнение и стеклянная панель */
function Dialog({ className = '', children, dref }: { className?: string; children: ReactNode; dref: React.RefObject<HTMLDivElement | null> }) {
  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }}>
      <motion.div
        className={`dialog ${className}`}
        ref={dref}
        initial={{ opacity: 0, transform: 'scale(0.96)' }}
        animate={{ opacity: 1, transform: 'scale(1)' }}
        exit={{ opacity: 0, transform: 'scale(0.98)', transition: { duration: 0.12 } }}
        transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
      >
        {children}
      </motion.div>
    </motion.div>
  )
}

/** Вариантов нет: источников не добавлено вовсе — просим добавить; источники есть, но игры в них нет — так и говорим */
function NoOptions({ title, sources, onClose, onOpenSources }: { title: string; sources: number; onClose: () => void; onOpenSources: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useSpatialNav(ref, { priority: 40, onBack: onClose, autoFocus: '.btn-primary' })
  return (
    <Dialog className="dl-empty" dref={ref}>
      <h2 className="dialog-title">{sources ? t('Этой игры нет в ваших источниках') : t('Не найдено источников JSON')}</h2>
      <p className="dialog-text">
        {sources
          ? t('Ни в одном из добавленных источников ({n}) нет загрузок «{title}». Добавьте ещё источник или загляните позже: источники по ссылкам обновляются сами раз в 12 часов.', { n: sources, title })
          : t('Чтобы скачать «{title}», нужен источник загрузок — JSON-файл со списком игр. Пожалуйста, добавьте его: Настройки → Магазин → «Добавить источник».', { title })}
      </p>
      <div className="dialog-actions dl-actions-even">
        <button data-nav className="btn btn-glass" onClick={() => (play('back'), onClose())}>
          {t('Закрыть')}
        </button>
        <button data-nav className="btn btn-primary" onClick={() => (play('select'), onOpenSources())}>
          <IconPlus /> {sources ? t('Открыть источники') : t('Добавить источник')}
        </button>
      </div>
    </Dialog>
  )
}

/** Шапка окна: обложка игры, заголовок и строка под ним; справа крестик — закрыть мышью */
function Head({ cover, title, sub, onClose }: { cover?: string; title: string; sub: string; onClose: () => void }) {
  return (
    <header className="dl-head">
      {cover && <img className="dl-head-cover" src={media(cover, 'tile')} alt="" />}
      <div className="dl-head-text">
        <h2 className="dialog-title">{title}</h2>
        <p className="dl-sub">{sub}</p>
      </div>
      <button tabIndex={-1} className="btn btn-round dl-head-close" onClick={onClose} aria-label={t('Закрыть')} title={t('Закрыть')}>
        <IconClose />
      </button>
    </header>
  )
}

/**
 * Варианты загрузки: свежие сверху, каждый — коротко: кто собрал, версия, DLC, русский; ниже дата и источник, справа
 * размер. ✕ или клик — скачать в PlayOS (вторым шагом в этом же окне — куда), △ — открыть ссылку в другой программе
 */
function OptionsList({ title, gameId, cover, hero, list, onClose }: {
  title: string
  gameId?: string
  cover?: string
  hero?: string
  list: DownloadOption[] | null
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [cur, setCur] = useState(0)
  // Второй шаг: куда скачать выбранный вариант
  const [target, setTarget] = useState<DownloadOption | null>(null)
  const manySources = new Set(list?.map((o) => o.source)).size > 1

  const back = () => {
    play('back')
    setTarget(null)
  }
  const close = () => {
    play('back')
    onClose()
  }
  useSpatialNav(ref, {
    priority: 40,
    onBack: target ? back : onClose,
    autoFocus: target ? '.dl-where [data-nav]:not(:disabled)' : '.dl-option',
    focusKey: target ? 'where' : 'list'
  })
  // Список приходит позже открытия окна — фокус на строку, как только он появился
  useEffect(() => {
    if (target || !list?.length || ref.current?.contains(document.activeElement)) return
    const rows = ref.current?.querySelectorAll<HTMLElement>('.dl-option')
    focusEl(rows?.[Math.min(cur, list.length - 1)])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, target])

  const open = (o: DownloadOption | undefined) => {
    if (!o) return play('bump')
    play('select')
    void api.storeLink(o.uris, 'open')
  }
  // Такие ссылки PlayOS сам пока не качает — сразу в другую программу
  const choose = (o: DownloadOption) => {
    if (!canDownload(o.kind)) return open(o)
    play('select')
    setTarget(o)
  }
  // Папка выбрана — в очередь; окно вариантов больше не нужно, загрузка видна в «Загрузках»
  const start = async (o: DownloadOption, folder: string) => {
    const r = await api.downloadStart({ gameId, title, name: o.title, cover, hero, kind: o.kind, uris: o.uris, size: o.size, folder })
    if (r.error) {
      play('error')
      return toast({ title: t('Загрузка не началась'), message: r.error, tone: 'error', history: false })
    }
    play('select')
    toast({ title: t('Загрузка началась'), message: title, image: cover, tone: 'success', history: false, open: 'downloads' })
    onClose()
  }

  // △ — к варианту в фокусе
  useInputLayer((a) => (a === 'menu' && !target && list?.[cur] ? open(list[cur]) : false), 41)

  if (target) {
    const need = sizeBytes(target.size)
    return (
      <Dialog className="dl-dialog" dref={ref}>
        <Head cover={cover} onClose={close} title={t('Куда скачать?')} sub={[title, release(target.title).by, need ? bytes(need) : ''].filter(Boolean).join(' · ')} />
        <WhereTo need={need} onPick={(folder) => void start(target, folder)} />
        <footer className="dl-hints">
          <Hint glyph="confirm" label={t('Выбрать')} />
          <Hint glyph="back" label={t('Назад')} onClick={back} />
        </footer>
      </Dialog>
    )
  }

  return (
    <Dialog className="dl-dialog" dref={ref}>
      <Head cover={cover} onClose={close} title={t('Скачать «{title}»', { title })} sub={list ? optionsCount(list.length) : t('Ищем варианты…')} />
      <div className="dl-list">
        {list === null ? (
          <div className="gp-skeleton">
            <span />
            <span />
          </div>
        ) : (
          list.map((o, i) => {
            const r = release(o.title)
            const size = sizeBytes(o.size)
            const name = r.by ?? (plainTitle(o.title, title) || o.source)
            return (
              <button
                key={`${o.sourceId}:${o.title}:${i}`}
                data-nav
                className="dl-option"
                title={o.title}
                onFocus={() => setCur(i)}
                onMouseEnter={() => setCur(i)}
                onClick={() => choose(o)}
              >
                <span className="dl-text">
                  <span className="dl-line">
                    <span className="dl-by">{name}</span>
                    {r.version && <span className="dl-chip">{r.version}</span>}
                    {r.edition && <span className="dl-chip">{r.edition}</span>}
                    {r.dlc && <span className="dl-chip">DLC</span>}
                    {r.rus && <span className="dl-chip">RUS</span>}
                  </span>
                  <span className="dl-when">
                    <span className="dl-kind" title={KIND_LABELS[o.kind]}>
                      {o.kind === 'http' ? <IconGlobe /> : <IconMagnet />}
                    </span>
                    {[o.date ? dateText(o.date) : '', manySources ? o.source : ''].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="dl-size">{size ? bytes(size) : (o.size ?? '')}</span>
                <span className="dl-go" aria-hidden>
                  <IconDownload />
                </span>
              </button>
            )
          })
        )}
      </div>
      <footer className="dl-hints">
        <Hint glyph="confirm" label={list?.[cur] && !canDownload(list[cur].kind) ? t('Открыть в другой программе') : t('Скачать')} />
        <Hint glyph="menu" label={t('Открыть в другой программе')} onClick={() => open(list?.[cur])} />
        <Hint glyph="back" label={t('Закрыть')} onClick={close} />
      </footer>
    </Dialog>
  )
}

/**
 * Название раздачи без скобок, хвоста «| RePack…» и названия самой игры — когда не понять, кто её собрал.
 * «Subnautica Build 03102025» у Subnautica → «Build 03102025»; ничего не осталось — пусто
 */
const plainTitle = (s: string, game: string) => {
  const plain = s
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\s\|.*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  const rest = plain.toLowerCase().startsWith(game.toLowerCase()) ? plain.slice(game.length).replace(/^[\s:\-–—.,]+/, '') : plain
  return rest
}
