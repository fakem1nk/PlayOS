import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { DownloadOption, Platform } from '@shared/types'
import { api } from '../lib/api'
import { useInputLayer } from '../lib/input'
import { focusEl, useSpatialNav } from '../lib/nav'
import { KIND_LABELS, optionsCount } from '../lib/shop'
import { play } from '../lib/sound'
import { toast } from '../lib/state'
import { Hint } from './Glyph'
import { ConfirmDialog } from './Menus'
import { IconDownload, IconGlobe, IconPlus } from './Icons'
import { locale, t } from '@shared/i18n'

interface Props {
  /** Steam AppID игры; 0 — неизвестен, ищем только по названию */
  appId: number
  title: string
  /** Платформа игры: у игр PS2 и PS3 — раздачи для эмулятора */
  platform: Platform
  onClose: () => void
  /** Настройки → Магазин: источники загрузок */
  onOpenSources: () => void
}

const dateText = (ms: number) => new Date(ms).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * «Скачать» у игры библиотеки, которой нет на этом ПК. Есть варианты в источниках — список вариантов;
 * нет ни одного источника или игры в них нет — объясняем, что сделать
 */
export function DownloadFlow({ appId, title, platform, onClose, onOpenSources }: Props) {
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
  return <OptionsList appId={appId} title={title} list={list} onClose={onClose} onReload={reload} />
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

/** Варианты загрузки: свежие сверху. ✕ — скопировать ссылку, △ — открыть её (торрент-клиент, браузер), □ — «Не та игра?» */
function OptionsList({ appId, title, list, onClose, onReload }: { appId: number; title: string; list: DownloadOption[] | null; onClose: () => void; onReload: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [cur, setCur] = useState(0)
  const [unbinding, setUnbinding] = useState<DownloadOption | null>(null)

  useSpatialNav(ref, { priority: 40, active: !unbinding, onBack: onClose, autoFocus: '.dl-option' })
  // Список приходит позже открытия окна, а после «Не та игра» строка в фокусе пропадает — фокус на ближайшую
  useEffect(() => {
    if (!list?.length || ref.current?.contains(document.activeElement)) return
    const rows = ref.current?.querySelectorAll<HTMLElement>('.dl-option')
    focusEl(rows?.[Math.min(cur, list.length - 1)])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list])

  const copy = (o: DownloadOption) => {
    play('select')
    void api.storeLink(o.uris, 'copy')
    toast({ title: o.uris.length > 1 ? t('Ссылки скопированы: {n}', { n: o.uris.length }) : t('Ссылка скопирована'), message: o.title, tone: 'success', history: false })
  }
  const open = (o: DownloadOption) => {
    play('select')
    void api.storeLink(o.uris, 'open')
  }

  // △ и □ — к варианту в фокусе; остальное — навигации окна
  useInputLayer(
    (a) => {
      const o = list?.[cur]
      if (!o) return false
      if (a === 'menu') return open(o)
      if (a === 'search') {
        play('select')
        return setUnbinding(o)
      }
      return false
    },
    41,
    !unbinding
  )

  return (
    <Dialog
      className="dl-dialog"
      dref={ref}
      over={
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
      }
    >
      <h2 className="dialog-title">{t('Варианты загрузки')}</h2>
      <p className="dl-sub">
        {title}
        {list ? ` · ${optionsCount(list.length)}` : ''}
      </p>
      <div className="dl-list">
        {list === null ? (
          <div className="gp-skeleton">
            <span />
            <span />
          </div>
        ) : (
          list.map((o, i) => (
            <div key={`${o.sourceId}:${o.title}:${i}`} className={`dl-row ${i === cur ? 'is-current' : ''}`} onMouseEnter={() => setCur(i)}>
              <button data-nav className="menu-item dl-option" onFocus={() => setCur(i)} onClick={() => copy(o)}>
                <span className="dl-kind">{o.kind === 'http' ? <IconGlobe /> : <IconDownload />}</span>
                <span className="dl-text">
                  <span className="dl-title">{o.title}</span>
                  <span className="dl-meta">{[o.source, o.size, o.date ? dateText(o.date) : '', KIND_LABELS[o.kind]].filter(Boolean).join(' · ')}</span>
                </span>
              </button>
              {/* Для мыши: те же действия, что △ и □ */}
              <span className="dl-tools">
                <button tabIndex={-1} className="btn btn-glass btn-sm" onClick={() => open(o)}>
                  {t('Открыть')}
                </button>
                <button tabIndex={-1} className="btn btn-glass btn-sm" onClick={() => setUnbinding(o)}>
                  {t('Не та игра?')}
                </button>
              </span>
            </div>
          ))
        )}
      </div>
      <footer className="dl-hints">
        <Hint glyph="confirm" label={t('Скопировать ссылку')} />
        <Hint glyph="menu" label={t('Открыть')} />
        <Hint glyph="search" label={t('Не та игра?')} />
        <Hint glyph="back" label={t('Закрыть')} />
      </footer>
    </Dialog>
  )
}
