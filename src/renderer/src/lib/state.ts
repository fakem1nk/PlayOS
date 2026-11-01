import { useEffect, useState, useSyncExternalStore } from 'react'
import type { AppState, PadStatus, QuestStatus, Settings } from '@shared/types'
import { api } from './api'
import { setSoundEnabled, setVolume } from './sound'
import { setHaptics } from './haptics'
import { setTheme } from './theme'
import { t } from '@shared/i18n'

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
  useEffect(() => setHaptics(!!state?.settings.menuRumble), [state?.settings.menuRumble])
  // Масштаб интерфейса: множитель для базового размера rem
  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', String(state?.settings.uiScale ?? 1))
  }, [state?.settings.uiScale])
  useEffect(() => {
    if (state) setTheme(state.settings.theme)
  }, [state?.settings.theme])
  const s = state?.settings
  useEffect(
    () => setNoticePrefs({ noticePopups: s?.noticePopups, noticeTime: s?.noticeTime, noticeTrophies: s?.noticeTrophies }),
    [s?.noticePopups, s?.noticeTime, s?.noticeTrophies]
  )
  useEffect(() => {
    if (state?.version) tidyNotices(state.version)
  }, [state?.version])
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
  /**
   * false — ответ на действие (подтверждения, проверки, итоги импорта): только всплывающее окошко, в центр уведомлений
   * не попадает и видно даже с выключенными всплывающими уведомлениями
   */
  history?: false
}

type NoticePrefs = Pick<Settings, 'noticePopups' | 'noticeTime' | 'noticeTrophies'>

/** Настройки уведомлений — сюда их передаёт useAppState, как звук и тему */
let prefs: NoticePrefs = {}
function setNoticePrefs(p: NoticePrefs) {
  prefs = p
}

const SHOWN_MS = { short: 3000, normal: 4800, long: 8000 }

/** Всплывать ли окошку. Трофеи — по своему переключателю; ошибки и ответы на действия видны всегда */
function popsUp(n: Omit<Toast, 'id'>) {
  const on = prefs.noticePopups !== false
  if (n.kind === 'trophy') return on && prefs.noticeTrophies !== false
  return on || n.tone === 'error' || n.history === false
}

let toasts: Toast[] = []
let toastId = 1
const toastSubs = new Set<() => void>()

/** Возвращает id окошка — его можно убрать раньше времени (dismissToast) */
export function toast(t: Omit<Toast, 'id'>) {
  const item = { ...t, id: toastId++ }
  if (popsUp(t)) {
    toasts = [item, ...toasts].slice(0, 4)
    toastSubs.forEach((s) => s())
    setTimeout(() => dismissToast(item.id), SHOWN_MS[prefs.noticeTime ?? 'normal'] + (t.tone === 'error' ? 2200 : 0))
  }
  if (t.history !== false) remember(item)
  return item.id
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
 * Всплывающие уведомления исчезают через несколько секунд — история хранит последние 50, чтобы к ошибке или трофею
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

/** Повторы не копятся: из одинаковых уведомлений остаётся самое свежее, из записей об обновлениях — последняя */
function dedupe(items: Notice[]) {
  const seen = new Set<string>()
  return items.filter((n) => {
    const key = n.kind === 'update' ? 'update' : `${n.kind}|${n.title}|${n.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function remember(item: Toast) {
  const at = Date.now()
  const items = dedupe([{ ...item, id: at * 100 + (item.id % 100), at }, ...history.items]).slice(0, HISTORY_MAX)
  setHistory({ items, unread: Math.min(history.unread + 1, items.length) })
}

/**
 * Уборка при запуске: запись об обновлении уходит, когда оно установлено, повторы склеиваются,
 * а мусор, который копили прошлые версии (итоги сессий, ответы на действия), удаляется
 */
function tidyNotices(current: string) {
  const session = t('Сессия: {v}', { v: '' })
  const junk = (n: Notice) =>
    (n.tone === 'success' && !n.kind && (n.message?.startsWith(session) || n.message === t('Игра закрыта'))) ||
    n.message === t('В версии из исходников обновления не проверяются')
  const items = dedupe(history.items).filter((n) => !(n.kind === 'update' && n.version === current) && !junk(n))
  if (items.length !== history.items.length) setHistory({ items, unread: Math.min(history.unread, items.length) })
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
