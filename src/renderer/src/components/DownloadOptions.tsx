import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { DownloadOption, Platform } from '@shared/types'
import { api } from '../lib/api'
import { useInputLayer } from '../lib/input'
import { focusEl, useSpatialNav } from '../lib/nav'
import { canDownload } from '../lib/downloads'
import { bytes } from '../lib/format'
import { release, sizeBytes } from '../lib/release'
import { KIND_LABELS, optionsCount } from '../lib/shop'
import { play } from '../lib/sound'
import { toast } from '../lib/state'
import { Hint } from './Glyph'
import { WhereTo } from './DownloadFolders'
import { ConfirmDialog } from './Menus'
import { IconCopy, IconExternal, IconGlobe, IconMagnet, IconPlus, IconUnlink } from './Icons'
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

  const reload = () => void api.storeOptions(appId, title, platform).then((l) => (l.length ? setList(l) : onClose()))

  if (list?.length === 0) return <NoOptions title={title} sources={sources} onClose={onClose} onOpenSources={onOpenSources} />
  if (!list && !slow) return null
  return <OptionsList appId={appId} title={title} gameId={gameId} cover={cover} hero={hero} list={list} onClose={onClose} onReload={reload} />
}

/** Каркас окна: затемнение и стеклянная панель; over — вопрос поверх панели */
function Dialog({ className = '', children, over, dref }: { className?: string; children: ReactNode; over?: ReactNode; dref: React.RefObject<HTMLDivElement | null> }) {
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
      {over}
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

/**
 * Варианты загрузки: свежие сверху, каждый — коротко: кто собрал, версия, DLC, русский, размер.
 * ✕ — скачать в PlayOS (вторым шагом в этом же окне — куда), △ — открыть ссылку в другой программе,
 * □ — «Не та игра?». Мышью то же — кнопками-значками у строки
 */
function OptionsList({ appId, title, gameId, cover, hero, list, onClose, onReload }: {
  appId: number
  title: string
  gameId?: string
  cover?: string
  hero?: string
  list: DownloadOption[] | null
  onClose: () => void
  onReload: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [cur, setCur] = useState(0)
  const [unbinding, setUnbinding] = useState<DownloadOption | null>(null)
  // Второй шаг: куда скачать выбранный вариант
  const [target, setTarget] = useState<DownloadOption | null>(null)
  const quiet = !unbinding
  const manySources = new Set(list?.map((o) => o.source)).size > 1

  const back = () => {
    play('back')
    setTarget(null)
  }
  useSpatialNav(ref, {
    priority: 40,
    active: quiet,
    onBack: target ? back : onClose,
    autoFocus: target ? '.dl-where [data-nav]:not(:disabled)' : '.dl-option',
    focusKey: target ? 'where' : 'list'
  })
  // Список приходит позже открытия окна, а после «Не та игра» строка в фокусе пропадает — фокус на ближайшую
  useEffect(() => {
    if (target || !list?.length || ref.current?.contains(document.activeElement)) return
    const rows = ref.current?.querySelectorAll<HTMLElement>('.dl-option')
    focusEl(rows?.[Math.min(cur, list.length - 1)])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, target])

  const copy = (o: DownloadOption) => {
    play('select')
    void api.storeLink(o.uris, 'copy')
    toast({ title: o.uris.length > 1 ? t('Ссылки скопированы: {n}', { n: o.uris.length }) : t('Ссылка скопирована'), message: o.title, tone: 'success', history: false })
  }
  const open = (o: DownloadOption) => {
    play('select')
    void api.storeLink(o.uris, 'open')
  }
  const choose = (o: DownloadOption) => {
    if (!canDownload(o.kind)) return copy(o)
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
    toast({ title: t('Загрузка началась'), message: title, image: cover, tone: 'success', history: false })
    onClose()
  }

  // △ и □ — к варианту в фокусе
  useInputLayer(
    (a) => {
      const o = list?.[cur]
      if (!o || target) return false
      if (a === 'menu') return open(o)
      if (a === 'search') {
        play('select')
        return setUnbinding(o)
      }
      return false
    },
    41,
    quiet
  )

  const over = (
    <AnimatePresence>
      {unbinding && (
        <ConfirmDialog
          title={t('Не та игра?')}
          text={t('Загрузки «{title}» больше не будут показываться у «{game}».', { title: unbinding.title, game: title })}
          button={t('Убрать')}
          onCancel={() => setUnbinding(null)}
          onConfirm={() => {
            const key = unbinding.key
            setUnbinding(null)
            void api.storeUnbind(appId, key).then(onReload)
          }}
        />
      )}
    </AnimatePresence>
  )

  if (target) {
    const need = sizeBytes(target.size)
    return (
      <Dialog className="dl-dialog" dref={ref} over={over}>
        <h2 className="dialog-title">{t('Куда скачать?')}</h2>
        <p className="dl-sub">{[title, release(target.title).by, need ? bytes(need) : ''].filter(Boolean).join(' · ')}</p>
        <WhereTo need={need} onPick={(folder) => void start(target, folder)} />
        <footer className="dl-hints">
          <Hint glyph="confirm" label={t('Выбрать')} />
          <Hint glyph="back" label={t('Назад')} />
        </footer>
      </Dialog>
    )
  }

  return (
    <Dialog className="dl-dialog" dref={ref} over={over}>
      <h2 className="dialog-title">{t('Скачать «{title}»', { title })}</h2>
      <p className="dl-sub">{list ? optionsCount(list.length) : ''}</p>
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
            return (
              <div key={`${o.sourceId}:${o.title}:${i}`} className={`dl-row ${i === cur ? 'is-current' : ''}`} onMouseEnter={() => setCur(i)} title={o.title}>
                <button data-nav className="dl-option" onFocus={() => setCur(i)} onClick={() => choose(o)}>
                  <span className="dl-kind" title={KIND_LABELS[o.kind]}>
                    {o.kind === 'http' ? <IconGlobe /> : <IconMagnet />}
                  </span>
                  <span className="dl-text">
                    <span className="dl-by">{r.by ?? plainTitle(o.title)}</span>
                    <span className="dl-chips">
                      {r.version && <span className="dl-chip">{r.version}</span>}
                      {r.edition && <span className="dl-chip">{r.edition}</span>}
                      {r.dlc && <span className="dl-chip">DLC</span>}
                      {r.rus && <span className="dl-chip">RUS</span>}
                      <span className="dl-when">{[o.date ? dateText(o.date) : '', manySources ? o.source : ''].filter(Boolean).join(' · ')}</span>
                    </span>
                  </span>
                  <span className="dl-size">{size ? bytes(size) : (o.size ?? '')}</span>
                </button>
                {/* Мышью — то же, что △ и □ */}
                <span className="dl-tools">
                  <button tabIndex={-1} className="btn btn-round dl-tool" onClick={() => copy(o)} aria-label={t('Скопировать ссылку')} title={t('Скопировать ссылку')}>
                    <IconCopy />
                  </button>
                  <button tabIndex={-1} className="btn btn-round dl-tool" onClick={() => open(o)} aria-label={t('Открыть в другой программе')} title={t('Открыть в другой программе')}>
                    <IconExternal />
                  </button>
                  <button tabIndex={-1} className="btn btn-round dl-tool" onClick={() => (play('select'), setUnbinding(o))} aria-label={t('Не та игра?')} title={t('Не та игра?')}>
                    <IconUnlink />
                  </button>
                </span>
              </div>
            )
          })
        )}
      </div>
      <footer className="dl-hints">
        <Hint glyph="confirm" label={list?.[cur] && canDownload(list[cur].kind) ? t('Скачать') : t('Скопировать ссылку')} />
        <Hint glyph="menu" label={t('Открыть в другой программе')} />
        <Hint glyph="search" label={t('Не та игра?')} />
        <Hint glyph="back" label={t('Закрыть')} />
      </footer>
    </Dialog>
  )
}

/** Название раздачи без скобок и хвоста «| RePack…» — когда не понять, кто её собрал */
const plainTitle = (s: string) =>
  s
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\s\|.*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
