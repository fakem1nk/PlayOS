import { AnimatePresence } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { StoreSource } from '@shared/types'
import { api } from '../lib/api'
import { play } from '../lib/sound'
import { toast } from '../lib/state'
import { ConfirmDialog, PromptDialog } from './Menus'
import { IconDownload, IconEdit, IconFolder, IconPlus, IconRestart, IconSync, IconTrash } from './Icons'
import { locale, plural, t } from '@shared/i18n'
import '../styles-store.css'

const num = (n: number) => n.toLocaleString(locale())
const gamesText = (n: number) => `${num(n)} ${plural(n, ['игра', 'игры', 'игр'], ['game', 'games'])}`
const sourcesText = (n: number) => `${num(n)} ${plural(n, ['источник', 'источника', 'источников'], ['source', 'sources'])}`
const downloadsText = (n: number) => `${num(n)} ${plural(n, ['загрузка', 'загрузки', 'загрузок'], ['download', 'downloads'])}`
const whenText = (ms: number) => new Date(ms).toLocaleString(locale(), { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
/** Откуда источник: сайт или имя файла на диске */
const placeOf = (url: string) => {
  try {
    const u = new URL(url)
    return u.protocol === 'file:' ? decodeURIComponent(u.pathname.split('/').pop() ?? '') : u.host
  } catch {
    return url
  }
}

/**
 * Раздел настроек «Магазин»: источники загрузок. Источник — ссылка на JSON со списком загрузок, его добавляет
 * сам пользователь; PlayOS источников не поставляет. Ссылку удобнее всего вставить из буфера обмена — с геймпада
 * её не набрать; ввести вручную тоже можно. Сайт с проверкой браузера (Cloudflare) отдаёт файл только браузеру —
 * такой источник добавляют из скачанного файла: кнопкой или перетащив его в окно (ссылку из браузера — тоже)
 */
export function SourcesPanel() {
  const [list, setList] = useState<StoreSource[] | null>(null)
  const [typing, setTyping] = useState<string | null>(null)
  const [busy, setBusy] = useState<'add' | 'all' | string | null>(null)
  const [removing, setRemoving] = useState<StoreSource | null>(null)
  const [dragging, setDragging] = useState(false)
  // Свежий обработчик для слушателей окна — они вешаются один раз
  const onDrop = useRef<(d: DataTransfer) => void>(() => {})

  useEffect(() => {
    void api.storeSources().then(setList)
  }, [])

  // Перетаскивание в окно: скачанные JSON-файлы или ссылка прямо из браузера. Строка добавления подсвечивается
  useEffect(() => {
    let depth = 0
    const wanted = (e: DragEvent) => !!e.dataTransfer && ['Files', 'text/uri-list', 'text/plain'].some((k) => e.dataTransfer!.types.includes(k))
    const enter = (e: DragEvent) => {
      if (wanted(e) && ++depth === 1) setDragging(true)
    }
    const leave = (e: DragEvent) => {
      if (wanted(e) && --depth <= 0) {
        depth = 0
        setDragging(false)
      }
    }
    const over = (e: DragEvent) => {
      if (wanted(e)) e.dataTransfer!.dropEffect = 'copy'
    }
    const drop = (e: DragEvent) => {
      depth = 0
      setDragging(false)
      if (wanted(e)) onDrop.current(e.dataTransfer!)
    }
    const on = { dragenter: enter, dragleave: leave, dragover: over, drop } as const
    for (const [type, fn] of Object.entries(on)) window.addEventListener(type, fn as EventListener)
    return () => {
      for (const [type, fn] of Object.entries(on)) window.removeEventListener(type, fn as EventListener)
    }
  }, [])

  const add = (url: string) => {
    setTyping(null)
    void finish(api.storeSourceAdd(url))
  }

  const finish = async (p: Promise<{ source?: StoreSource; error?: string }>) => {
    setBusy('add')
    const r = await p
    setBusy(null)
    if (r.source) {
      play('select')
      toast({ title: t('Источник добавлен'), message: `${r.source.name} · ${gamesText(r.source.games ?? r.source.count)}`, tone: 'success', history: false })
    } else if (r.error) {
      play('error')
      toast({ title: t('Источник не добавлен'), message: r.error, tone: 'error', history: false })
    }
    setList(await api.storeSources())
  }

  onDrop.current = (d) => {
    if (busy) return
    // Пути берём сразу: после события список файлов уже пуст
    const paths = [...d.files].map((f) => api.pathForFile(f))
    if (paths.length) {
      play('select')
      void (async () => {
        for (const p of paths) await finish(api.storeSourceAddPath(p))
      })()
      return
    }
    const url = (d.getData('text/uri-list').split(/\r?\n/).find((l) => l && !l.startsWith('#')) ?? d.getData('text/plain')).trim()
    if (/^https?:\/\/\S+$/i.test(url)) {
      play('select')
      return add(url)
    }
    play('error')
    toast({ title: t('Источник не добавлен'), message: t('Перетащите JSON-файл или ссылку на него'), tone: 'error', history: false })
  }

  const fromFile = () => {
    if (busy) return
    play('select')
    void finish(api.storeSourceAddFile())
  }

  const paste = async () => {
    if (busy) return
    const url = await api.storeClipboardUrl()
    if (url) return void add(url)
    play('error')
    toast({ title: t('В буфере обмена нет ссылки'), message: t('Скопируйте ссылку на JSON-файл источника и нажмите ещё раз.'), tone: 'error', history: false })
  }

  // Ввести вручную: если в буфере уже ссылка — она сразу в поле
  const type = async () => {
    if (busy) return
    play('select')
    setTyping(await api.storeClipboardUrl())
  }

  const refresh = async (id: string | 'all') => {
    if (busy) return
    play('select')
    setBusy(id)
    const l = id === 'all' ? await api.storeSourcesRefresh() : await api.storeSourceRefresh(id)
    setBusy(null)
    setList(l)
    const failed = l.filter((s) => (id === 'all' || s.id === id) && s.error)
    if (failed.length) toast({ title: t('Не обновилось источников: {n}', { n: failed.length }), message: failed[0].error, tone: 'error', history: false })
    else toast({ title: id === 'all' ? t('Источники обновлены') : t('Источник обновлён'), tone: 'success', history: false })
  }

  if (!list) return null
  const total = list.reduce((n, s) => n + (s.games ?? 0), 0)
  const last = Math.max(0, ...list.map((s) => s.updatedAt ?? 0))

  return (
    <>
      <h2 className="panel-title">
        <IconDownload /> {t('Источники загрузок')}
        {list.length > 0 && <span className="panel-sub">{`${sourcesText(list.length)} · ${gamesText(total)}`}</span>}
      </h2>
      <div className="note">{t('Источник — ссылка на JSON-файл со списком загрузок (формат Hydra). PlayOS не поставляет источники, а только читает те, что добавили вы.')}</div>

      <div className={`setting setting-static src-add ${list.length ? '' : 'is-empty'} ${dragging ? 'is-drop' : ''}`}>
        <span className="setting-text">
          <span className="setting-label">{dragging ? t('Отпустите, чтобы добавить') : list.length ? t('Добавить источник') : t('Источников пока нет')}</span>
          <span className="setting-hint">
            {dragging
              ? t('JSON-файл или ссылка на него')
              : busy === 'add'
                ? t('Скачиваем и проверяем…')
                : list.length
                  ? t('Вставьте ссылку на JSON-файл или перетащите сюда файл')
                  : t('Скопируйте ссылку на JSON-файл и вставьте её — у игр из него появится «Скачать». Файл или ссылку можно просто перетащить сюда.')}
          </span>
        </span>
        <span className="src-actions">
          <button data-nav className={`btn btn-sm ${list.length ? 'btn-glass' : 'btn-primary'}`} disabled={!!busy} onClick={paste}>
            <IconPlus /> {t('Вставить ссылку')}
          </button>
          <button data-nav className="btn btn-glass btn-sm" disabled={!!busy} onClick={type}>
            <IconEdit /> {t('Ввести')}
          </button>
          <button data-nav className="btn btn-glass btn-sm" disabled={!!busy} onClick={fromFile}>
            <IconFolder /> {t('Из файла')}
          </button>
        </span>
      </div>

      {list.map((s) => (
        <div key={s.id} className="setting setting-static src-row">
          <span className="setting-text">
            <span className="setting-label">
              {s.name}
              {placeOf(s.url) !== s.name && <span className="src-host">{placeOf(s.url)}</span>}
            </span>
            <span className="setting-hint">
              {busy === s.id || busy === 'all'
                ? t('Обновляем…')
                : [
                    s.games !== undefined ? gamesText(s.games) : '',
                    downloadsText(s.count),
                    s.updatedAt ? t('обновлён {when}', { when: whenText(s.updatedAt) }) : '',
                    // Файл с диска сам не обновится: «Обновить» перечитает его, когда вы скачаете новый поверх
                    s.url.startsWith('file:') ? t('из файла') : ''
                  ]
                    .filter(Boolean)
                    .join(' · ')}
            </span>
            {s.error && busy !== s.id && busy !== 'all' && <span className="setting-hint src-error">{t('Не обновился: {e}', { e: s.error })}</span>}
          </span>
          <span className="src-actions">
            <button data-nav className="btn btn-glass btn-sm" disabled={!!busy} onClick={() => refresh(s.id)} aria-label={t('Обновить')}>
              {busy === s.id ? <IconSync className="is-spinning" /> : <IconRestart />} {t('Обновить')}
            </button>
            <button data-nav className="btn btn-glass btn-sm" disabled={!!busy} onClick={() => (play('select'), setRemoving(s))}>
              <IconTrash /> {t('Удалить')}
            </button>
          </span>
        </div>
      ))}

      {list.length > 1 && (
        <div className="setting setting-static">
          <span className="setting-text">
            <span className="setting-label">{t('Обновить все')}</span>
            <span className="setting-hint">
              {busy === 'all' ? t('Обновляем…') : [t('По ссылкам обновляются сами, когда вы заходите в магазин, раз в 12 часов'), last ? t('последнее {when}', { when: whenText(last) }) : ''].filter(Boolean).join(' · ')}
            </span>
          </span>
          <button data-nav className="btn btn-glass btn-sm" disabled={!!busy} onClick={() => refresh('all')}>
            {busy === 'all' ? <IconSync className="is-spinning" /> : <IconRestart />} {t('Обновить все')}
          </button>
        </div>
      )}

      <AnimatePresence>
        {typing !== null && (
          <PromptDialog
            title={t('Ссылка на источник')}
            value={typing}
            placeholder="https://…/source.json"
            button={t('Добавить')}
            maxLength={2000}
            onCancel={() => setTyping(null)}
            onSubmit={(url) => void add(url)}
          />
        )}
        {removing && (
          <ConfirmDialog
            title={t('Удалить источник «{name}»?', { name: removing.name })}
            text={t('Его загрузки пропадут из магазина. Добавить его снова можно по той же ссылке или из того же файла.')}
            button={t('Удалить')}
            onCancel={() => setRemoving(null)}
            onConfirm={() => {
              const id = removing.id
              setRemoving(null)
              void api.storeSourceRemove(id).then(() => api.storeSources().then(setList))
            }}
          />
        )}
      </AnimatePresence>
    </>
  )
}
