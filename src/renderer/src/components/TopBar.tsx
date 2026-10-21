import { motion } from 'motion/react'
import type { Game } from '@shared/types'
import { clock, timer } from '../lib/format'
import { usePadInfo } from '../lib/input'
import { useNow, usePadStatus } from '../lib/state'
import { Avatar } from './Avatar'
import { Glyph } from './Glyph'
import { IconBattery, IconGamepad, IconPlug, IconPower } from './Icons'
import { t } from '@shared/i18n'

export type Tab = 'home' | 'library' | 'profile' | 'settings'
export const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: t('Игры') },
  { id: 'library', label: t('Библиотека') },
  { id: 'profile', label: t('Профиль') },
  { id: 'settings', label: t('Настройки') }
]

const BATTERY_LEVEL = { empty: 0, low: 1, medium: 2, full: 3 } as const
const BATTERY_TEXT = { empty: t('Геймпад разряжен'), low: t('Низкий заряд геймпада'), medium: t('Заряд геймпада: средний'), full: t('Геймпад заряжен') }

interface Props {
  tab: Tab
  /** Индекс фокуса в зоне вкладок (TABS.length = кнопка питания) или null, если фокус в контенте */
  tabFocus: number | null
  userName: string
  avatar?: string
  runningGame?: Game
  runningSince?: number
  /** Скачано обновление — точка на кнопке питания */
  updateReady?: boolean
  onTab: (t: Tab) => void
  onPower: () => void
}

export function TopBar({ tab, tabFocus, userName, avatar, runningGame, runningSince, updateReady, onTab, onPower }: Props) {
  const now = useNow(1000)
  const pad = usePadInfo()
  const status = usePadStatus()
  const connected = pad !== 'none' || status.connected > 0
  const battery = status.battery

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
        <span className="clock">{clock(new Date(now))}</span>
        <button
          className={`power-btn ${tabFocus === TABS.length ? 'is-focused' : ''}`}
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
