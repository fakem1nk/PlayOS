import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { DownloadDrive, DownloadFolder } from '@shared/types'
import { api } from '../lib/api'
import { bytes } from '../lib/format'
import { useSpatialNav } from '../lib/nav'
import { play } from '../lib/sound'
import { toast } from '../lib/state'
import { PromptDialog } from './Menus'
import { IconEdit, IconFolder, IconPlus, IconSearch } from './Icons'
import { t } from '@shared/i18n'

/** Полоска диска: занято, сколько займёт загрузка (светлее) и свободно */
export function Capacity({ free, total, need = 0 }: { free: number; total: number; need?: number }) {
  if (!total) return null
  const used = Math.min(1, (total - free) / total)
  const add = Math.min(1 - used, need / total)
  return (
    <span className={`dl-cap ${need > free ? 'is-short' : ''}`}>
      <span className="dl-cap-used" style={{ width: `${used * 100}%` }} />
      {add > 0 && <span className="dl-cap-need" style={{ left: `${used * 100}%`, width: `${Math.max(add * 100, 1.5)}%` }} />}
    </span>
  )
}

/**
 * Куда скачать — всё на одном экране, без вложенных меню: свои папки карточками, ниже — диски для новой папки
 * (одно нажатие создаёт «Диск:\Название» и сразу выбирает её). Название новой папки меняется тут же,
 * мышью можно выбрать папку и окном Windows. need — сколько займёт загрузка: где не хватит места, карточка неактивна.
 * add — только добавить папку (из настроек): своих папок не показываем
 */
export function WhereTo({ need = 0, add = false, onPick }: { need?: number; add?: boolean; onPick: (path: string) => void }) {
  const [folders, setFolders] = useState<DownloadFolder[] | null>(null)
  const [drives, setDrives] = useState<DownloadDrive[] | null>(null)
  const [name, setName] = useState(t('PlayOS Games'))
  const [naming, setNaming] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api.downloadFolders().then(setFolders)
    void api.downloadDrives().then(setDrives)
  }, [])

  const create = async (path: string) => {
    if (busy) return
    setBusy(true)
    const r = await api.downloadFolderAdd(path)
    setBusy(false)
    if (r.folder) return onPick(r.folder.path)
    play('error')
    toast({ title: t('Папка не добавлена'), message: r.error, tone: 'error', history: false })
  }
  const browse = async () => {
    play('select')
    const path = await api.downloadFolderBrowse()
    if (path) void create(path)
  }
  const short = (free: number) => need > 0 && need > free

  if (!folders || !drives) return <div className="dl-where is-loading" />
  const mine = add ? [] : folders

  return (
    <div className="dl-where">
      {mine.length > 0 && (
        <div className="dl-places">
          {mine.map((f) => (
            <button
              key={f.path}
              data-nav
              className="dl-place"
              disabled={!f.ok || short(f.free)}
              onClick={() => (play('select'), onPick(f.path))}
            >
              <span className="dl-place-icon">
                <IconFolder />
              </span>
              <span className="dl-place-text">
                <span className="dl-place-path">{f.path}</span>
                <Capacity free={f.free} total={f.total} need={need} />
                <span className="dl-place-free">
                  {!f.ok ? t('Недоступна') : short(f.free) ? t('Не хватит места · свободно {v}', { v: bytes(f.free) }) : t('свободно {v}', { v: bytes(f.free) })}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="dl-new">
        <span className="dl-new-label">{mine.length ? t('Или новая папка') : t('Новая папка')}</span>
        <button data-nav className="dl-new-name" onClick={() => (play('select'), setNaming(true))}>
          {name}
          <IconEdit />
        </button>
      </div>
      <div className="dl-drives">
        {drives.map((d) => (
          <button key={d.root} data-nav className="dl-drive" disabled={busy || short(d.free)} onClick={() => (play('select'), void create(d.root + name))}>
            <span className="dl-drive-letter">
              <IconPlus /> {d.root.slice(0, 2)}
            </span>
            <Capacity free={d.free} total={d.total} need={need} />
            <span className="dl-drive-free">{short(d.free) ? t('Не хватит места') : t('свободно {v}', { v: bytes(d.free) })}</span>
          </button>
        ))}
        <button data-nav className="dl-drive dl-browse" disabled={busy} onClick={() => void browse()}>
          <span className="dl-drive-letter">
            <IconSearch />
          </span>
          <span className="dl-drive-free">{t('Другая папка…')}</span>
        </button>
      </div>

      <AnimatePresence>
        {naming && (
          <PromptDialog
            key="name"
            title={t('Название новой папки')}
            value={name}
            button={t('Готово')}
            maxLength={80}
            priority={50}
            onCancel={() => setNaming(false)}
            onSubmit={(v) => {
              setName(v.replace(/[<>:"/\\|?*]/g, ' ').trim() || t('PlayOS Games'))
              setNaming(false)
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

/** Новая папка из настроек: тот же выбор диска в отдельном окне */
function FolderAddDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useSpatialNav(ref, { priority: 45, onBack: onClose, autoFocus: '.dl-drive' })
  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }}>
      <motion.div
        className="dialog dl-dialog"
        ref={ref}
        initial={{ opacity: 0, transform: 'scale(0.96)' }}
        animate={{ opacity: 1, transform: 'scale(1)' }}
        exit={{ opacity: 0, transform: 'scale(0.98)', transition: { duration: 0.12 } }}
        transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
      >
        <h2 className="dialog-title">{t('Новая папка для загрузок')}</h2>
        <WhereTo add onPick={onAdded} />
      </motion.div>
    </motion.div>
  )
}

/** Настройки → Магазин: папки для загрузок — список со свободным местом, убрать, добавить */
export function DownloadFoldersPanel() {
  const [list, setList] = useState<DownloadFolder[] | null>(null)
  const [adding, setAdding] = useState(false)
  const reload = () => void api.downloadFolders().then(setList)
  useEffect(reload, [])
  if (!list) return null
  return (
    <>
      <h2 className="panel-title">
        <IconFolder /> {t('Папки для загрузок')}
      </h2>
      {list.map((f) => (
        <div key={f.path} className="setting setting-static">
          <span className="setting-text">
            <span className="setting-label">{f.path}</span>
            <span className={`setting-hint ${f.ok ? '' : 'src-error'}`}>{f.ok ? t('свободно {v}', { v: bytes(f.free) }) : t('Недоступна: диск отключён или в папку нельзя писать')}</span>
          </span>
          <button
            data-nav
            className="btn btn-glass btn-sm"
            onClick={() => {
              play('select')
              void api.downloadFolderRemove(f.path).then(reload)
            }}
          >
            {t('Убрать')}
          </button>
        </div>
      ))}
      <div className="setting setting-static">
        <span className="setting-text">
          <span className="setting-label">{list.length ? t('Добавить папку') : t('Папок пока нет')}</span>
          <span className="setting-hint">{t('Перед каждой загрузкой PlayOS спросит, в какую из них скачивать. Файлы в папке остаются, если убрать её из списка')}</span>
        </span>
        <button
          data-nav
          className="btn btn-glass btn-sm"
          onClick={() => {
            play('select')
            setAdding(true)
          }}
        >
          <IconPlus /> {t('Добавить')}
        </button>
      </div>
      <AnimatePresence>
        {adding && (
          <FolderAddDialog
            key="add"
            onClose={() => setAdding(false)}
            onAdded={() => {
              setAdding(false)
              reload()
            }}
          />
        )}
      </AnimatePresence>
    </>
  )
}
