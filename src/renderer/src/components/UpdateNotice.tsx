import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { UpdateSummary } from '@shared/types'
import { api } from '../lib/api'
import { useSpatialNav } from '../lib/nav'
import { play } from '../lib/sound'
import { downloadText, isMinor, splitVersion, summaryText, updateHighlights, useUpdate } from '../lib/update'
import { Hint } from './Glyph'
import { IconCheck, IconDownload } from './Icons'
import { LogoMark } from './Logo'
import { t } from '@shared/i18n'

/** Версия, которую отложили «на потом»: до перезапуска PlayOS больше не спрашиваем */
let postponed = ''

export function installNow() {
  play('launch')
  void api.installUpdate()
}

/**
 * Обновления без лишних слов: пока новая версия качается — тихая карточка с прогрессом внизу,
 * когда скачалась и вы не в игре — окно с тем, что нового, и выбором «сейчас или при выходе».
 */
export function UpdateNotice({ blocked, booting }: { blocked: boolean; booting: boolean }) {
  const u = useUpdate()
  const [, force] = useState(0)
  const ready = u.phase === 'ready' && !!u.version && !blocked && postponed !== u.version
  // Мелкие исправления не прерывают: короткая карточка «установится при выходе» вместо окна
  const quiet = ready && !u.rollback && isMinor(u.summary)
  const ask = ready && !quiet
  const downloading = u.phase === 'downloading' && !booting

  useEffect(() => {
    if (!quiet) return
    const id = setTimeout(() => {
      postponed = u.version!
      force((n) => n + 1)
    }, 7_000)
    return () => clearTimeout(id)
  }, [quiet, u.version])

  return (
    <>
      <AnimatePresence>
        {downloading && (
          <motion.div
            key="dl"
            className="upd-card"
            role="status"
            initial={{ opacity: 0, transform: 'translateY(1rem)' }}
            animate={{ opacity: 1, transform: 'translateY(0rem)' }}
            exit={{ opacity: 0, transform: 'translateY(0.6rem)', transition: { duration: 0.18 } }}
            transition={{ duration: 0.32, ease: [0.23, 1, 0.32, 1] }}
          >
            <span className="upd-card-icon">
              <IconDownload />
            </span>
            <div className="upd-card-body">
              <div className="upd-card-title">
                {u.rollback ? t('Скачивается стабильная PlayOS {v}', { v: u.version }) : t('Скачивается PlayOS {v}', { v: u.version })}
              </div>
              <div className="upd-card-meta">
                {downloadText(u)}
                <span>{t('можно играть дальше')}</span>
              </div>
              <div className="upd-bar">
                <span style={{ transform: `scaleX(${(u.percent ?? 0) / 100})` }} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {quiet && !booting && (
          <motion.div
            key="quiet"
            className="upd-card"
            role="status"
            initial={{ opacity: 0, transform: 'translateY(1rem)' }}
            animate={{ opacity: 1, transform: 'translateY(0rem)' }}
            exit={{ opacity: 0, transform: 'translateY(0.6rem)', transition: { duration: 0.18 } }}
            transition={{ duration: 0.32, ease: [0.23, 1, 0.32, 1] }}
          >
            <span className="upd-card-icon">
              <IconCheck />
            </span>
            <div className="upd-card-body">
              <div className="upd-card-title">{t('PlayOS {v} скачана', { v: u.version })}</div>
              <div className="upd-card-meta">
                <span>{t('Установится при выходе из PlayOS')}</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {ask && (
          <ReadyDialog
            key="ready"
            version={u.version!}
            current={u.current}
            notes={u.notes}
            summary={u.summary}
            rollback={!!u.rollback}
            onLater={() => {
              play('back')
              postponed = u.version!
              force((n) => n + 1)
            }}
          />
        )}
      </AnimatePresence>
    </>
  )
}

function ReadyDialog(props: { version: string; current: string; notes?: string; summary?: UpdateSummary; rollback: boolean; onLater: () => void }) {
  const { version, current, notes, summary, rollback, onLater } = props
  const ref = useRef<HTMLDivElement>(null)
  // Возврат на стабильную: что было в той версии, человек уже видел — список не нужен
  const text = rollback ? undefined : summaryText(summary)
  // Старые релизы без сводки — главное из заметок к релизу, одним списком
  const highlights = text || rollback ? [] : updateHighlights(notes)
  const critical = summary?.importance === 'critical'
  const { num, beta } = splitVersion(version)
  useSpatialNav(ref, { priority: 45, onBack: onLater, autoFocus: '.upd-now', onAction: () => {} })
  useEffect(() => play('trophy'), [])

  return (
    <motion.div className="modal-backdrop upd-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }}>
      <motion.div
        className="upd-dialog"
        ref={ref}
        role="dialog"
        aria-labelledby="upd-title"
        initial={{ opacity: 0, transform: 'scale(0.96) translateY(1.2rem)' }}
        animate={{ opacity: 1, transform: 'scale(1) translateY(0rem)' }}
        exit={{ opacity: 0, transform: 'scale(0.98)', transition: { duration: 0.12 } }}
        transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
      >
        <header className="upd-head">
          <LogoMark className="upd-logo" />
          <div>
            <h2 id="upd-title">
              PlayOS {num}
              {beta && <span className="upd-badge">{t('Бета')}</span>}
            </h2>
            <p>
              {rollback
                ? t('Стабильная версия скачана. Сейчас у вас бета {v}', { v: current })
                : t('Обновление скачано. Сейчас у вас {v}', { v: current })}
            </p>
          </div>
        </header>
        {text?.new.length ? <Section title={t('Новое')} items={text.new} /> : null}
        {text?.fixed.length ? <Section title={t('Исправлено')} items={text.fixed} fixed /> : null}
        {highlights.length > 0 && (
          <ul className="upd-list">
            {highlights.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        )}
        <p className={`upd-note${critical ? ' is-critical' : ''}`}>
          {rollback
            ? t('Вы выключили бета-тест, поэтому PlayOS вернётся на стабильную версию. Игры, настройки и прогресс сохранятся. Если отложить, версия сменится, когда вы выйдете из PlayOS.')
            : critical
            ? t('Важное исправление — лучше обновиться сейчас. Перезапуск займёт около минуты.')
            : t('Перезапуск займёт около минуты. Если отложить, обновление установится само, когда вы выйдете из PlayOS.')}
        </p>
        <footer className="upd-actions">
          <button className="upd-later" onClick={onLater}>
            <Hint glyph="back" label={t('Позже')} />
          </button>
          <button data-nav className="btn btn-primary upd-now" onClick={installNow}>
            {rollback ? t('Вернуться сейчас') : t('Обновить сейчас')}
          </button>
        </footer>
      </motion.div>
    </motion.div>
  )
}

function Section({ title, items, fixed }: { title: string; items: string[]; fixed?: boolean }) {
  return (
    <section className="upd-sec">
      <h3>{title}</h3>
      <ul className={`upd-list${fixed ? ' is-fixed' : ''}`}>
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </section>
  )
}
