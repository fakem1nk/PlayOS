import { AnimatePresence } from 'motion/react'
import { useEffect, useState } from 'react'
import type { StoreSource } from '@shared/types'
import { api } from '../lib/api'
import { play } from '../lib/sound'
import { toast } from '../lib/state'
import { ConfirmDialog, PromptDialog } from './Menus'
import { IconDownload, IconEdit, IconPlus, IconRestart, IconSync, IconTrash } from './Icons'
import { locale, plural, t } from '@shared/i18n'
import '../styles-store.css'

const num = (n: number) => n.toLocaleString(locale())
const gamesText = (n: number) => `${num(n)} ${plural(n, ['игра', 'игры', 'игр'], ['game', 'games'])}`
const sourcesText = (n: number) => `${num(n)} ${plural(n, ['источник', 'источника', 'источников'], ['source', 'sources'])}`
const downloadsText = (n: number) => `${num(n)} ${plural(n, ['загрузка', 'загрузки', 'загрузок'], ['download', 'downloads'])}`
const whenText = (ms: number) => new Date(ms).toLocaleString(locale(), { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/**
 * Раздел настроек «Магазин»: источники загрузок. Источник — ссылка на JSON со списком загрузок, его добавляет
 * сам пользователь; PlayOS источников не поставляет. Ссылку удобнее всего вставить из буфера обмена — с геймпада
 * её не набрать; ввести вручную тоже можно
 */
export function SourcesPanel() {
  const [list, setList] = useState<StoreSource[] | null>(null)
  const [typing, setTyping] = useState<string | null>(null)
  const [busy, setBusy] = useState<'add' | 'all' | string | null>(null)
  const [removing, setRemoving] = useState<StoreSource | null>(null)

  useEffect(() => {
    void api.storeSources().then(setList)
  }, [])

  const add = async (url: string) => {
    setTyping(null)
    setBusy('add')
    const r = await api.storeSourceAdd(url)
    setBusy(null)
    if (r.source) {
      play('select')
      toast({ title: t('Источник добавлен'), message: `${r.source.name} · ${gamesText(r.source.games ?? r.source.count)}`, tone: 'success', history: false })
    } else {
      play('error')
      toast({ title: t('Источник не добавлен'), message: r.error, tone: 'error', history: false })
    }
    setList(await api.storeSources())
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

      <div className={`setting setting-static src-add ${list.length ? '' : 'is-empty'}`}>
        <span className="setting-text">
          <span className="setting-label">{list.length ? t('Добавить источник') : t('Источников пока нет')}</span>
          <span className="setting-hint">
            {busy === 'add'
              ? t('Скачиваем и проверяем…')
              : list.length
                ? t('Скопируйте ссылку на JSON-файл и вставьте её сюда')
                : t('Скопируйте ссылку на JSON-файл и вставьте её — у игр из него появится «Скачать».')}
          </span>
        </span>
        <span className="src-actions">
          <button data-nav className={`btn btn-sm ${list.length ? 'btn-glass' : 'btn-primary'}`} disabled={!!busy} onClick={paste}>
            <IconPlus /> {t('Вставить ссылку')}
          </button>
          <button data-nav className="btn btn-glass btn-sm" disabled={!!busy} onClick={type}>
            <IconEdit /> {t('Ввести')}
          </button>
        </span>
      </div>

      {list.map((s) => (
        <div key={s.id} className="setting setting-static src-row">
          <span className="setting-text">
            <span className="setting-label">
              {s.name}
              {hostOf(s.url) !== s.name && <span className="src-host">{hostOf(s.url)}</span>}
            </span>
            <span className="setting-hint">
              {busy === s.id || busy === 'all'
                ? t('Обновляем…')
                : [s.games !== undefined ? gamesText(s.games) : '', downloadsText(s.count), s.updatedAt ? t('обновлён {when}', { when: whenText(s.updatedAt) }) : ''].filter(Boolean).join(' · ')}
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
              {busy === 'all' ? t('Обновляем…') : [t('Сами обновляются раз в 12 часов'), last ? t('последнее {when}', { when: whenText(last) }) : ''].filter(Boolean).join(' · ')}
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
            text={t('Его загрузки пропадут из магазина. Добавить его снова можно по той же ссылке.')}
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
