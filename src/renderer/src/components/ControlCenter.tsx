import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { ControllerInfo, PadAction, SystemState } from '@shared/types'
import { api } from '../lib/api'
import { play } from '../lib/sound'
import { IconBattery, IconGamepad, IconHeadphones, IconPlug, IconSun, IconVolume } from './Icons'

/**
 * Пункт управления в оверлее: громкость, звуковой выход, яркость экрана и список геймпадов.
 * Влево/вправо меняют громкость и яркость, ✕ открывает список (выход звука, геймпады) или выключает звук.
 */

type ItemId = 'volume' | 'output' | 'brightness' | 'pads'
const BATTERY_LEVEL = { empty: 0, low: 1, medium: 2, full: 3 } as const
const BATTERY_TEXT = { empty: 'разряжен', low: 'мало заряда', medium: 'средний заряд', full: 'заряжен', wired: 'от кабеля' } as const

// «Динамики (Realtek High Definition Audio)» → «Динамики»: подробности уходят во вторую строку
const shortName = (name: string) => name.replace(/\s*\(.*\)\s*$/, '') || name
const detail = (name: string) => name.match(/\((.*)\)\s*$/)?.[1]

function batteryText(p: ControllerInfo) {
  if (p.percent !== undefined && p.battery !== 'wired') return `${p.percent}%`
  return p.battery ? BATTERY_TEXT[p.battery] : 'нет данных'
}

export function useControlCenter(open: boolean) {
  const [sys, setSys] = useState<SystemState | null>(null)
  const [pads, setPads] = useState<ControllerInfo[]>([])
  const [idx, setIdx] = useState(0)
  const [pop, setPop] = useState<{ kind: 'output' | 'pads'; idx: number } | null>(null)
  // Режим регулировки громкости или яркости: влево/вправо меняют значение
  const [adjusting, setAdjusting] = useState<ItemId | null>(null)
  const brightTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!open) {
      setPop(null)
      setAdjusting(null)
      return
    }
    void api.systemState(true).then(setSys)
    void api.controllers().then(setPads)
  }, [open])

  const items: ItemId[] = ['volume', 'output', ...(sys?.brightness != null ? (['brightness'] as const) : []), 'pads']
  const current = items[Math.min(idx, items.length - 1)]

  const changeVolume = (d: number) => {
    if (!sys || sys.volume === null) return
    const v = Math.max(0, Math.min(1, Math.round((sys.volume + d) * 100) / 100))
    setSys({ ...sys, volume: v, muted: false })
    play('adjust')
    void api.setVolume(v)
  }

  const changeBrightness = (d: number) => {
    if (!sys || sys.brightness == null) return
    const v = Math.max(0, Math.min(100, sys.brightness + d))
    setSys({ ...sys, brightness: v })
    play('adjust')
    // DDC/CI медленный — отправляем, когда пользователь перестал нажимать
    clearTimeout(brightTimer.current)
    brightTimer.current = window.setTimeout(() => void api.setBrightness(v), 250)
  }

  const activate = (id: ItemId) => {
    if (id === 'volume' && sys) {
      play('toggle')
      setSys({ ...sys, muted: !sys.muted })
      void api.setMute(!sys.muted)
    } else if (id === 'output' && sys?.devices.length) {
      play('select')
      setPop({ kind: 'output', idx: Math.max(0, sys.devices.findIndex((d) => d.default)) })
    } else if (id === 'pads') {
      play('select')
      void api.controllers().then(setPads)
      setPop({ kind: 'pads', idx: 0 })
    }
  }

  const chooseOutput = async (i: number) => {
    const dev = sys?.devices[i]
    if (!sys || !dev) return
    play('select')
    setPop(null)
    setSys({ ...sys, devices: sys.devices.map((d) => ({ ...d, default: d.id === dev.id })) })
    const next = await api.setAudioDevice(dev.id)
    if (next) setSys((s) => ({ ...next, brightness: s?.brightness }))
  }

  /** Кнопки, когда фокус в ряду пункта управления. false — действие не наше (например, «вверх» в другой ряд). */
  const handle = (a: PadAction): boolean => {
    if (pop) {
      const len = pop.kind === 'output' ? (sys?.devices.length ?? 0) : pads.length
      if (a === 'up' || a === 'down') {
        const next = Math.max(0, Math.min(len - 1, pop.idx + (a === 'up' ? -1 : 1)))
        if (next !== pop.idx) {
          play('move')
          setPop({ ...pop, idx: next })
        }
      } else if (a === 'confirm' && pop.kind === 'output') void chooseOutput(pop.idx)
      else if (a === 'back' || a === 'confirm') {
        play('back')
        setPop(null)
      }
      return true
    }
    if (adjusting) {
      if (a === 'left' || a === 'right') {
        const d = a === 'left' ? -1 : 1
        if (adjusting === 'volume') changeVolume(d * 0.05)
        else changeBrightness(d * 10)
        return true
      }
      setAdjusting(null)
      if (a === 'confirm' || a === 'back') {
        play('toggle')
        return true
      }
      return false
    }
    if (a === 'menu' && current === 'volume') {
      activate('volume')
      return true
    }
    if (a === 'l1' || a === 'r1' || a === 'left' || a === 'right') {
      const next = Math.max(0, Math.min(items.length - 1, idx + (a === 'l1' || a === 'left' ? -1 : 1)))
      if (next !== idx) {
        play('move')
        setIdx(next)
      }
      return true
    }
    if (a === 'confirm') {
      if (current === 'volume' || current === 'brightness') {
        play('select')
        setAdjusting(current)
      } else activate(current)
      return true
    }
    return false
  }

  return { sys, pads, items, current, idx, pop, adjusting, handle, activate, setIdx, chooseOutput }
}

export type ControlCenterState = ReturnType<typeof useControlCenter>

export function ControlCenterRow({ cc, zone }: { cc: ControlCenterState; zone: boolean }) {
  const { sys, pads } = cc
  const defaultDevice = sys?.devices.find((d) => d.default)
  const firstPad = pads[0]

  const card = (id: ItemId, i: number) => {
    const focused = zone && cc.current === id
    let icon: React.ReactNode
    let label: string
    let value: string
    let level: number | null = null
    if (id === 'volume') {
      const muted = !!sys?.muted
      icon = <IconVolume muted={muted || sys?.volume === 0} />
      label = 'Громкость'
      value = sys?.volume == null ? '—' : muted ? 'Без звука' : `${Math.round(sys.volume * 100)}%`
      level = muted ? 0 : (sys?.volume ?? 0)
    } else if (id === 'output') {
      icon = <IconHeadphones />
      label = 'Звук'
      value = defaultDevice ? shortName(defaultDevice.name) : '—'
    } else if (id === 'brightness') {
      icon = <IconSun />
      label = 'Яркость'
      value = `${sys?.brightness ?? 0}%`
      level = (sys?.brightness ?? 0) / 100
    } else {
      icon = <IconGamepad />
      label = pads.length > 1 ? `Геймпады: ${pads.length}` : 'Геймпад'
      value = firstPad ? `${firstPad.name}, ${batteryText(firstPad)}` : 'Не подключены'
    }
    const popHere = focused && cc.pop && ((cc.pop.kind === 'output' && id === 'output') || (cc.pop.kind === 'pads' && id === 'pads'))
    return (
      <div key={id} className="cc-slot">
        <button
          tabIndex={-1}
          className={`cc-card ${focused ? 'is-focused' : ''} ${focused && cc.adjusting === id ? 'is-adjusting' : ''}`}
          onClick={() => {
            cc.setIdx(i)
            cc.activate(id)
          }}
        >
          <span className="cc-icon">{icon}</span>
          <span className="cc-text">
            <span className="cc-label">{label}</span>
            <span className="cc-value">{value}</span>
          </span>
          {level !== null && (
            <span className="cc-bar">
              <span style={{ width: `${Math.round(level * 100)}%` }} />
            </span>
          )}
        </button>
        {popHere && <Popover cc={cc} />}
      </div>
    )
  }

  return (
    <section className={`cc ${zone ? 'is-zone' : ''}`}>
      <div className="ov-slots-head">
        <span className="ov-slots-title">Пункт управления</span>
      </div>
      <div className="cc-row">{cc.items.map((id, i) => card(id, i))}</div>
    </section>
  )
}

function Popover({ cc }: { cc: ControlCenterState }) {
  const pop = cc.pop!
  return (
    <motion.div
      className="cc-pop"
      initial={{ opacity: 0, transform: 'translateY(0.8rem) scale(0.98)' }}
      animate={{ opacity: 1, transform: 'translateY(0rem) scale(1)' }}
      transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
    >
      {pop.kind === 'output' &&
        cc.sys?.devices.map((d, i) => (
          <div
            key={d.id}
            className={`cc-option ${i === pop.idx ? 'is-focused' : ''} ${d.default ? 'is-current' : ''}`}
            onClick={() => cc.chooseOutput(i)}
          >
            <span className="cc-option-name">{shortName(d.name)}</span>
            {detail(d.name) && <span className="cc-option-detail">{detail(d.name)}</span>}
          </div>
        ))}
      {pop.kind === 'pads' &&
        (cc.pads.length ? (
          cc.pads.map((p, i) => (
            <div key={p.id} className={`cc-option ${i === pop.idx ? 'is-focused' : ''}`}>
              <span className="cc-option-name">
                {p.battery === 'wired' ? <IconPlug /> : p.battery ? <IconBattery level={BATTERY_LEVEL[p.battery]} /> : <IconGamepad />} {p.name}
              </span>
              <span className="cc-option-detail">{[p.via, batteryText(p)].filter(Boolean).join(', ')}</span>
            </div>
          ))
        ) : (
          <div className="cc-option">Геймпады не найдены</div>
        ))}
    </motion.div>
  )
}
