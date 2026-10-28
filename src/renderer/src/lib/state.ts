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
  kind?: 'trophy' | 'update'
  /** Для kind 'update': какая версия скачана — в центре уведомлений у неё кнопка «Обновить» */
  version?: string
  tier?: 'bronze' | 'silver' | 'gold' | 'platinum'
  /** false — только всплывающее окошко, без записи в центр уведомлений (мелкие подтверждения, итоги импорта) */
  history?: false
}

let toasts: Toast[] = []
let toastId = 1
const toastSubs = new Set<() => void>()

export function toast(t: Omit<Toast, 'id'>) {
  const item = { ...t, id: toastId++ }
  toasts = [item, ...toasts].slice(0, 4)
  toastSubs.forEach((s) => s())
  setTimeout(() => dismissToast(item.id), t.tone === 'error' ? 7000 : 4800)
  if (t.history === false) return
  remember(item)
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

// ───────────── Центр уведомлений ─────────────

/** Уведомление в истории: то же, что всплывало, и когда */
export interface Notice extends Toast {
  at: number
}

const HISTORY_KEY = 'playos-notifications'
const HISTORY_MAX = 50

/**
 * Всплывающие уведомления исчезают через 5–7 секунд — история хранит последние 50, чтобы к ошибке или трофею
 * можно было вернуться. Живёт в localStorage: переживает перезагрузку окна (смена языка, выгрузка интерфейса в игре)
 */
let history: { items: Notice[]; unread: number } = loadHistory()
const historySubs = new Set<() => void>()

function loadHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? 'null')
    if (raw && Array.isArray(raw.items)) return { items: raw.items as Notice[], unread: Number(raw.unread) || 0 }
  } catch {
    /* хранилище недоступно или испорчено — начинаем с пустой истории */
  }
  return { items: [], unread: 0 }
}

function setHistory(next: typeof history) {
  history = next
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
  } catch {
    /* без хранилища история живёт до перезагрузки окна */
  }
  historySubs.forEach((s) => s())
}

function remember(item: Toast) {
  const at = Date.now()
  setHistory({ items: [{ ...item, id: at * 100 + (item.id % 100), at }, ...history.items].slice(0, HISTORY_MAX), unread: history.unread + 1 })
}

/** Только в историю, без всплывающего окошка: о скачанном обновлении и так говорит своё окно */
export function addNotice(item: Omit<Toast, 'id'>) {
  remember({ ...item, id: toastId++ })
}

/** Центр открыли — всё прочитано */
export function markNoticesRead() {
  if (history.unread) setHistory({ ...history, unread: 0 })
}

export function clearNotices() {
  setHistory({ items: [], unread: 0 })
}

export function useNoticeHistory() {
  return useSyncExternalStore(
    (cb) => {
      historySubs.add(cb)
      return () => historySubs.delete(cb)
    },
    () => history
  )
}
