import { useEffect, useState, useSyncExternalStore } from 'react'
import type { AppState, PadStatus, QuestStatus } from '@shared/types'
import { api } from './api'
import { setSoundEnabled, setVolume } from './sound'
import { setTheme } from './theme'

export function useAppState() {
  const [state, setState] = useState<AppState | null>(null)
  useEffect(() => {
    let alive = true
    api.getState().then((s) => alive && setState(s))
    const off = api.onState(setState)
    return () => {
      alive = false
      off()
    }
  }, [])
  useEffect(() => {
    if (!state) return
    setSoundEnabled(state.settings.sounds)
    setVolume(state.settings.volume)
  }, [state?.settings.sounds, state?.settings.volume])
  // Масштаб интерфейса: множитель для базового размера rem
  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', String(state?.settings.uiScale ?? 1))
  }, [state?.settings.uiScale])
  useEffect(() => {
    if (state) setTheme(state.settings.theme)
  }, [state?.settings.theme])
  return state
}

export function usePadStatus() {
  const [status, setStatus] = useState<PadStatus>({ connected: 0, battery: null })
  useEffect(() => {
    api.getPadStatus().then(setStatus)
    return api.onPadStatus(setStatus)
  }, [])
  return status
}

/** VR-шлем для верхней панели: подключение, способ связи и заряд */
export function useVrQuest() {
  const [quest, setQuest] = useState<QuestStatus | null>(null)
  useEffect(() => {
    api.vrQuest().then(setQuest)
    return api.onVrQuest(setQuest)
  }, [])
  return quest
}

export function useNow(interval: number, enabled = true) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!enabled) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), interval)
    return () => clearInterval(t)
  }, [interval, enabled])
  return now
}

// ───────────── Уведомления ─────────────

export interface Toast {
  id: number
  title: string
  message?: string
  image?: string
  tone?: 'info' | 'error' | 'success'
  kind?: 'trophy'
  tier?: 'bronze' | 'silver' | 'gold' | 'platinum'
}

let toasts: Toast[] = []
let toastId = 1
const toastSubs = new Set<() => void>()

export function toast(t: Omit<Toast, 'id'>) {
  const item = { ...t, id: toastId++ }
  toasts = [item, ...toasts].slice(0, 4)
  toastSubs.forEach((s) => s())
  setTimeout(() => dismissToast(item.id), t.tone === 'error' ? 7000 : 4800)
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id)
  toastSubs.forEach((s) => s())
}

export function useToasts() {
  return useSyncExternalStore(
    (cb) => {
      toastSubs.add(cb)
      return () => toastSubs.delete(cb)
    },
    () => toasts
  )
}
