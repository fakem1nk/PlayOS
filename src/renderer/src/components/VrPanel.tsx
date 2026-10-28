import { useEffect, useState } from 'react'
import type { QuestStatus, VrStatus } from '@shared/types'
import { api } from '../lib/api'
import { toast } from '../lib/state'
import { play } from '../lib/sound'
import { ActionRow } from './Controls'
import { IconDownload, IconVr } from './Icons'
import { locale, t } from '@shared/i18n'

function questHint(q: QuestStatus) {
  if (!q.found) return t('Подключите шлем через Meta Horizon Link — кабелем или Air Link')
  if (!q.connected) return t('Не подключён')
  const pct = (v?: number) => (v === undefined ? '—' : `${v}%`)
  return [
    q.link === 'air' ? t('Air Link · Wi-Fi') : t('Link · кабель'),
    t('шлем {v}', { v: pct(q.battery) }),
    t('левый {v}', { v: pct(q.left) }),
    t('правый {v}', { v: pct(q.right) })
  ].join(' · ')
}

/** Последнее известное состояние: при повторном открытии раздел показывается сразу, свежие данные догоняют */
let lastStatus: VrStatus | null = null

/** Раздел настроек «VR»: шлем и VR-компонент. Всё остальное PlayOS делает сам при запуске VR-игры */
export function VrPanel() {
  const [s, setStatus] = useState<VrStatus | null>(lastStatus)
  const setS = (v: VrStatus) => {
    lastStatus = v
    setStatus(v)
  }
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [update, setUpdate] = useState(false)

  useEffect(() => {
    let live = true
    const refresh = () => api.vrStatus().then((v) => live && setS(v))
    refresh()
    // Обновление компонента проверяем сами, без отдельной кнопки
    api.vrCheckOc().then((r) => live && setUpdate(r.update && !r.error))
    // Шлем и его заряд меняются без событий — опрашиваем, пока раздел открыт
    const timer = setInterval(() => !document.hidden && refresh(), 4000)
    const off = api.onVrProgress(setProgress)
    return () => {
      live = false
      clearInterval(timer)
      off()
    }
  }, [])

  const install = async () => {
    if (busy) return
    setBusy(true)
    const r = await api.vrInstallOc()
    setBusy(false)
    setProgress(null)
    play(r.ok ? 'select' : 'error')
    if (r.ok) setUpdate(false)
    toast(r.ok ? { title: t('VR готов'), tone: 'success' } : { title: t('Не удалось скачать VR-компонент'), message: r.error, tone: 'error' })
    setS(await api.vrStatus())
  }

  if (!s) return null
  const date = s.oc.installedAt ? new Date(s.oc.installedAt).toLocaleDateString(locale(), { day: 'numeric', month: 'long' }) : ''
  const ocHint =
    busy && progress !== null
      ? t('Загрузка… {v}%', { v: Math.round(progress * 100) })
      : !s.oc.installed
        ? t('Скачается сам при первом запуске VR-игры, около 4.5 МБ')
        : update
          ? t('Вышла новая версия')
          : t('Готов · обновлён {date}', { date })

  return (
    <>
      <h2 className="panel-title">
        <IconVr /> {t('Шлем')}
      </h2>
      <div className="setting setting-static">
        <span className="setting-text">
          <span className="setting-label">{s.quest.model ?? t('Quest не найден')}</span>
          <span className="setting-hint">{questHint(s.quest)}</span>
        </span>
        <span className={`vr-dot ${s.quest.connected ? 'is-on' : ''}`} />
      </div>
      {!s.meta && (
        <div className="note">
          {t('Чтобы шлем заработал, включите Meta Horizon Link как рантайм OpenXR: Meta Horizon Link → Настройки → Общие → OpenXR Runtime.')}
        </div>
      )}

      <h2 className="panel-title">
        <IconDownload /> {t('VR-компонент')}
      </h2>
      {s.oc.installed && !update && !busy ? (
        <div className="setting setting-static">
          <span className="setting-text">
            <span className="setting-label">OpenComposite</span>
            <span className="setting-hint">{ocHint}</span>
          </span>
        </div>
      ) : (
        <ActionRow
          label="OpenComposite"
          hint={ocHint}
          button={busy ? t('Загрузка…') : update ? t('Обновить') : t('Скачать сейчас')}
          icon={<IconDownload />}
          onClick={install}
        />
      )}
    </>
  )
}
