import { motion } from 'motion/react'
import type { Game, QuestStatus } from '@shared/types'
import { clock, timer } from '../lib/format'
import { DotText } from './DotText'
import { usePadInfo } from '../lib/input'
import { useNoticeHistory, useNow, usePadStatus, useVrQuest } from '../lib/state'
import { Avatar } from './Avatar'
import { Glyph } from './Glyph'
import { IconBattery, IconBell, IconGamepad, IconPlug, IconPower, IconVr, IconVrController, IconWifi } from './Icons'
import { t } from '@shared/i18n'

/** Цвет заряда: жёлтый — пора заряжать, красный — вот-вот сядет */
const chargeClass = (v?: number) => (v === undefined ? '' : v <= 10 ? 'is-empty' : v <= 25 ? 'is-low' : '')

/** Одно устройство: иконка и заряд. Уснувший контроллер — приглушён, заряд последний известный */
function VrDevice({ icon, value, idle, label }: { icon: React.ReactNode; value?: number; idle?: boolean; label: string }) {
  const pct = value === undefined ? '—' : `${value}%`
  return (
    <span className={`vr-device ${idle ? 'is-idle' : ''} ${chargeClass(value)}`} title={idle ? t('{name}: {v}, спит', { name: label, v: pct }) : `${label}: ${pct}`}>
      {icon}
      <span className="vr-charge">{pct}</span>
    </span>
  )
}

/** VR-шлем в верхней панели: способ связи, заряд шлема и обоих контроллеров */
function VrStatus({ q }: { q: QuestStatus }) {
  const link = q.link === 'air' ? 'Air Link' : t('Link по кабелю')
  const pads = q.left !== undefined || q.right !== undefined
  return (
    <span className="vr-status">
      <VrDevice
        label={`${q.model} · ${link}`}
        value={q.battery}
        icon={
          <>
            <span className="vr-headset">
              <IconVr />
            </span>
            <span className="vr-link">{q.link === 'air' ? <IconWifi /> : <IconPlug />}</span>
          </>
        }
      />
      {pads && (
        <>
          <VrDevice label={t('Левый контроллер')} value={q.left} idle={q.leftIdle} icon={<IconVrController side="left" />} />
          <VrDevice label={t('Правый контроллер')} value={q.right} idle={q.rightIdle} icon={<IconVrController side="right" />} />
        </>
      )}
    </span>
  )
}

export type Tab = 'home' | 'library' | 'profile' | 'settings'
export const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: t('Недавние') },
  { id: 'library', label: t('Библиотека') },
  { id: 'profile', label: t('Профиль') },
  { id: 'settings', label: t('Настройки') }
]

const BATTERY_LEVEL = { empty: 0, low: 1, medium: 2, full: 3 } as const
const BATTERY_TEXT = { empty: t('Геймпад разряжен'), low: t('Низкий заряд геймпада'), medium: t('Заряд геймпада: средний'), full: t('Геймпад заряжен') }

interface Props {
  tab: Tab
  /** Индекс фокуса в зоне вкладок (TABS.length — уведомления, TABS.length + 1 — питание) или null, если фокус в контенте */
  tabFocus: number | null
  userName: string
  avatar?: string
  runningGame?: Game
  runningSince?: number
  /** Скачано обновление — точка на кнопке питания */
  updateReady?: boolean
  onTab: (t: Tab) => void
  onNotices: () => void
  onPower: () => void
}

export function TopBar({ tab, tabFocus, userName, avatar, runningGame, runningSince, updateReady, onTab, onNotices, onPower }: Props) {
  const now = useNow(1000)
  const pad = usePadInfo()
  const status = usePadStatus()
  const connected = pad !== 'none' || status.connected > 0
  const battery = status.battery
  const quest = useVrQuest()
  const notices = useNoticeHistory()

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="profile" onClick={() => onTab('profile')} tabIndex={-1}>
          <Avatar name={userName} src={avatar} />
          <span className="profile-name">{userName}</span>
        </button>
        <nav className={`tabs ${tabFocus !== null ? 'is-zone' : ''}`}>
          <span className="tabs-shoulder">
            <Glyph name="l1" />
          </span>
          {TABS.map((tb, i) => (
            <button
              key={tb.id}
              className={`tab ${tab === tb.id ? 'is-active' : ''} ${tabFocus === i ? 'is-focused' : ''}`}
              onClick={() => onTab(tb.id)}
              tabIndex={-1}
            >
              {tab === tb.id && <motion.span layoutId="tab-pill" className="tab-pill" transition={{ type: 'spring', duration: 0.4, bounce: 0.12 }} />}
              <span className="tab-label">{tb.label}</span>
            </button>
          ))}
          <span className="tabs-shoulder">
            <Glyph name="r1" />
          </span>
        </nav>
      </div>

      <div className="topbar-right">
        {runningGame && runningSince && (
          <div className="running-pill">
            <span className="live-dot" />
            <span className="running-title">{runningGame.title}</span>
            <span className="running-time">{timer(now - runningSince)}</span>
          </div>
        )}
        <span className={`status-icon ${connected ? '' : 'is-off'}`} title={connected ? t('Геймпад подключён') : t('Геймпад не подключён')}>
          <IconGamepad />
          {connected && battery === 'wired' && (
            <span className="battery" title={t('Проводной геймпад')}>
              <IconPlug />
            </span>
          )}
          {connected && battery && battery !== 'wired' && (
            <span className={`battery battery-${battery}`} title={BATTERY_TEXT[battery] + (status.source === 'dsx' ? ' (DSX)' : '')}>
              <IconBattery level={BATTERY_LEVEL[battery]} />
            </span>
          )}
          {connected && status.percent !== undefined && battery !== 'wired' && <span className="battery-percent">{status.percent}%</span>}
        </span>
        {quest?.connected && <VrStatus q={quest} />}
        <DotText className="clock" text={clock(new Date(now))} />
        <button
          className={`power-btn notice-btn ${tabFocus === TABS.length ? 'is-focused' : ''}`}
          onClick={onNotices}
          tabIndex={-1}
          aria-label={notices.unread ? t('Уведомления: новых {n}', { n: notices.unread }) : t('Уведомления')}
        >
          <IconBell />
          {notices.unread > 0 && <span className="power-dot" />}
        </button>
        <button
          className={`power-btn ${tabFocus === TABS.length + 1 ? 'is-focused' : ''}`}
          onClick={onPower}
          tabIndex={-1}
          aria-label={updateReady ? t('Питание. Готово обновление PlayOS') : t('Питание')}
        >
          <IconPower />
          {updateReady && <span className="power-dot" />}
        </button>
      </div>
    </header>
  )
}
