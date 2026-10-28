import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { ImportProgress, SteamLibraryGame } from '@shared/types'
import { api } from '../lib/api'
import { gamesCount } from '../lib/format'
import { useSpatialNav } from '../lib/nav'
import { toast } from '../lib/state'
import { play } from '../lib/sound'
import { Hint } from './Glyph'
import { IconCheck } from './Icons'
import { t, locale } from '@shared/i18n'

const header = (appId: number) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/capsule_231x87.jpg`
const size = (bytes: number) =>
  bytes >= 1e9 ? t('{v} ГБ', { v: (bytes / 1e9).toLocaleString(locale(), { maximumFractionDigits: 1 }) }) : t('{v} МБ', { v: Math.max(1, Math.round(bytes / 1e6)) })

/** Импорт установленных игр Steam: список с галочками, затем добавление с артом из Steam. */
export function SteamImport({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [list, setList] = useState<SteamLibraryGame[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [progress, setProgress] = useState<ImportProgress | null>(null)

  useEffect(() => {
    api
      .scanSteam()
      .then((l) => {
        setList(l)
        // По умолчанию отмечено всё, чего ещё нет в библиотеке
        setPicked(new Set(l.filter((g) => !g.added && !g.software).map((g) => g.appId)))
      })
      .catch((e: Error) => setError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
  }, [])

  useEffect(() => api.onImportProgress(setProgress), [])

  const busy = !!progress && progress.done < progress.total
  const fresh = list?.filter((g) => !g.added) ?? []

  useSpatialNav(ref, {
    priority: 25,
    onBack: () => !busy && onClose(),
    autoFocus: '.steam-row:not([disabled]), .dialog-actions .btn',
    focusKey: list?.length ?? -1,
    onAction: (a) => {
      // △ — выбрать всё / снять выбор
      if (a !== 'menu' || busy || !fresh.length) return false
      play('select')
      setPicked((p) => (p.size === fresh.length ? new Set() : new Set(fresh.map((g) => g.appId))))
    }
  })

  const toggle = (id: number) => {
    play('move')
    setPicked((p) => {
      const n = new Set(p)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const run = async () => {
    if (!picked.size || busy) return
    play('select')
    setProgress({ done: 0, total: picked.size, title: '' })
    try {
      const n = await api.importSteam([...picked])
      play('launch')
      toast({ title: t('Импорт Steam'), message: n ? t('Добавлено: {v}', { v: gamesCount(n) }) : t('Ничего не добавлено'), tone: n ? 'success' : 'info', history: false })
      onClose()
    } catch (e) {
      setProgress(null)
      toast({ title: t('Импорт Steam'), message: (e as Error).message, tone: 'error' })
    }
  }

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }}>
      <motion.div
        className="steam-import"
        ref={ref}
        initial={{ opacity: 0, transform: 'scale(0.97)' }}
        animate={{ opacity: 1, transform: 'scale(1)' }}
        exit={{ opacity: 0, transform: 'scale(0.98)', transition: { duration: 0.15 } }}
        transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1] }}
      >
        <header className="steam-import-head">
          <h2 className="sheet-title">{t('Импорт из Steam')}</h2>
          <p className="steam-import-sub">
            {error
              ? error
              : !list
                ? t('Ищем установленные игры…')
                : list.length
                  ? t('Найдено {v} на дисках. Игры запускаются через Steam, обложки подтянутся из магазина.', { v: gamesCount(list.length) })
                  : t('Установленных игр Steam не нашлось.')}
          </p>
        </header>

        {busy ? (
          <div className="steam-progress">
            <div className="busy-title">{t('Добавляем игры: {done} из {total}', { done: progress.done, total: progress.total })}</div>
            <div className="busy-bar">
              <span style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
            <div className="busy-meta">{progress.title ? t('Скачиваем арт: {title}', { title: progress.title }) : t('Готовим…')}</div>
          </div>
        ) : (
          <div className="steam-list">
            {!list &&
              !error &&
              Array.from({ length: 5 }, (_, i) => <div key={i} className="steam-row is-skeleton" style={{ animationDelay: `${i * 50}ms` }} />)}
            {list?.map((g) => {
              const on = picked.has(g.appId)
              return (
                <button
                  key={g.appId}
                  data-nav
                  disabled={g.added}
                  className={`steam-row ${on ? 'is-on' : ''} ${g.added ? 'is-added' : ''}`}
                  onClick={() => toggle(g.appId)}
                >
                  <span className="steam-check">{(on || g.added) && <IconCheck />}</span>
                  <img className="steam-capsule" src={header(g.appId)} alt="" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                  <span className="steam-name">{g.name}</span>
                  <span className="steam-size">{g.added ? t('Уже в библиотеке') : g.software ? t('Программа, {v}', { v: size(g.sizeOnDisk) }) : size(g.sizeOnDisk)}</span>
                </button>
              )
            })}
          </div>
        )}

        <div className="dialog-actions">
          <button data-nav className="btn btn-glass" disabled={busy} onClick={onClose}>
            {list?.length ? t('Отмена') : t('Закрыть')}
          </button>
          {!!fresh.length && (
            <button data-nav className="btn btn-primary" disabled={busy || !picked.size} onClick={run}>
              {picked.size ? t('Добавить {v}', { v: gamesCount(picked.size) }) : t('Ничего не выбрано')}
            </button>
          )}
        </div>
        <footer className="sheet-hints">
          <Hint glyph="confirm" label={t('Отметить')} />
          {!!fresh.length && <Hint glyph="menu" label={picked.size === fresh.length ? t('Снять все') : t('Выбрать все')} />}
          <Hint glyph="back" label={t('Назад')} />
        </footer>
      </motion.div>
    </motion.div>
  )
}
