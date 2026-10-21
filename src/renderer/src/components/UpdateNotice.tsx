import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { useSpatialNav } from '../lib/nav'
import { play } from '../lib/sound'
import { downloadText, updateHighlights, useUpdate } from '../lib/update'
import { Hint } from './Glyph'
import { IconDownload } from './Icons'
import { LogoMark } from './Logo'

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
  const ask = u.phase === 'ready' && !!u.version && !blocked && postponed !== u.version
  const downloading = u.phase === 'downloading' && !booting

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
              <div className="upd-card-title">Скачивается PlayOS {u.version}</div>
              <div className="upd-card-meta">
                {downloadText(u)}
                <span>можно играть дальше</span>
              </div>
              <div className="upd-bar">
                <span style={{ transform: `scaleX(${(u.percent ?? 0) / 100})` }} />
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

function ReadyDialog({ version, current, notes, onLater }: { version: string; current: string; notes?: string; onLater: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const items = updateHighlights(notes)
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
            <h2 id="upd-title">PlayOS {version} готова</h2>
            <p>Обновление скачано. Сейчас у вас {current}</p>
          </div>
        </header>
        {items.length > 0 && (
          <ul className="upd-list">
            {items.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        )}
        <p className="upd-note">Перезапуск займёт около минуты. Если отложить, обновление установится само, когда вы выйдете из PlayOS.</p>
        <footer className="upd-actions">
          <Hint glyph="back" label="Позже" />
          <span className="upd-buttons">
            <button data-nav className="btn btn-glass" onClick={onLater}>
              Позже
            </button>
            <button data-nav className="btn btn-primary upd-now" onClick={installNow}>
              Обновить сейчас
            </button>
          </span>
        </footer>
      </motion.div>
    </motion.div>
  )
}
