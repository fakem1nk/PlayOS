import { useEffect, useRef } from 'react'
import type { AppState, Game } from '@shared/types'
import { api } from './api'
import { play } from './sound'
import { toast } from './state'

/** Трофеи PlayOS — локальные достижения по статистике библиотеки. */

export type Tier = 'bronze' | 'silver' | 'gold' | 'platinum'

interface Ctx {
  games: Game[]
  sessions: { game: Game; start: number; duration: number }[]
  avatar: boolean
}

export interface Trophy {
  id: string
  title: string
  desc: string
  tier: Tier
  check: (c: Ctx) => boolean
}

const dayKey = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function longestStreak(sessions: Ctx['sessions']) {
  const days = new Set(sessions.map((s) => dayKey(s.start)))
  let best = 0
  for (const s of sessions) {
    let run = 0
    const d = new Date(s.start)
    d.setHours(12, 0, 0, 0)
    while (days.has(dayKey(d.getTime()))) {
      run++
      d.setDate(d.getDate() + 1)
    }
    best = Math.max(best, run)
  }
  return best
}

const playedOn = (c: Ctx, p: Game['platform']) => c.sessions.some((s) => s.game.platform === p)

const BASE: Trophy[] = [
  { id: 'first-launch', title: 'Первый запуск', desc: 'Запустите любую игру через PlayOS', tier: 'bronze', check: (c) => c.sessions.length > 0 },
  { id: 'collector', title: 'Коллекционер', desc: 'Соберите 10 игр в библиотеке', tier: 'bronze', check: (c) => c.games.length >= 10 },
  { id: 'curator', title: 'Хранитель полки', desc: 'Соберите 25 игр в библиотеке', tier: 'silver', check: (c) => c.games.length >= 25 },
  { id: 'retro', title: 'Ретро-вечер', desc: 'Сыграйте в игру с PlayStation 2', tier: 'bronze', check: (c) => playedOn(c, 'ps2') },
  { id: 'cell', title: 'Мощь Cell', desc: 'Сыграйте в игру с PlayStation 3', tier: 'bronze', check: (c) => playedOn(c, 'ps3') },
  {
    id: 'generations',
    title: 'Три поколения',
    desc: 'Сыграйте в игры для PC, PS2 и PS3',
    tier: 'silver',
    check: (c) => playedOn(c, 'pc') && playedOn(c, 'ps2') && playedOn(c, 'ps3')
  },
  { id: 'marathon', title: 'Марафон', desc: 'Проведите в игре 3 часа без перерыва', tier: 'silver', check: (c) => c.sessions.some((s) => s.duration >= 3 * 3600) },
  { id: 'night-owl', title: 'Ночная сова', desc: 'Начните игру между 2 и 5 часами ночи', tier: 'bronze', check: (c) => c.sessions.some((s) => {
    const h = new Date(s.start).getHours()
    return h >= 2 && h < 5
  }) },
  { id: 'streak', title: 'Без пропусков', desc: 'Играйте 7 дней подряд', tier: 'silver', check: (c) => longestStreak(c.sessions) >= 7 },
  { id: 'devoted', title: 'Преданность', desc: 'Наиграйте 50 часов в одной игре', tier: 'gold', check: (c) => c.games.some((g) => g.playtime >= 50 * 3600) },
  { id: 'century', title: 'Сотня', desc: 'Наиграйте 100 часов суммарно', tier: 'gold', check: (c) => c.games.reduce((a, g) => a + g.playtime, 0) >= 100 * 3600 },
  { id: 'favorite', title: 'Любимчик', desc: 'Добавьте игру в избранное', tier: 'bronze', check: (c) => c.games.some((g) => g.favorite) },
  { id: 'avatar', title: 'Своё лицо', desc: 'Поставьте свой аватар в профиле', tier: 'bronze', check: (c) => c.avatar }
]

export const TROPHIES: Trophy[] = [
  ...BASE,
  {
    id: 'platinum',
    title: 'Платина PlayOS',
    desc: 'Получите все остальные трофеи',
    tier: 'platinum',
    check: () => false // вычисляется отдельно
  }
]

export const TIER_NAMES: Record<Tier, string> = { bronze: 'Бронза', silver: 'Серебро', gold: 'Золото', platinum: 'Платина' }

export function trophyCtx(state: AppState): Ctx {
  const sessions = state.games.flatMap((game) => game.sessions.map((s) => ({ game, ...s })))
  return { games: state.games, sessions, avatar: !!state.settings.avatar }
}

export function earnedNow(state: AppState): Set<string> {
  const c = trophyCtx(state)
  const ids = new Set(BASE.filter((t) => t.check(c)).map((t) => t.id))
  // Трофеи, полученные раньше, не «отзываются», даже если условие перестало выполняться
  for (const id of Object.keys(state.settings.trophies ?? {})) ids.add(id)
  if (BASE.every((t) => ids.has(t.id))) ids.add('platinum')
  return ids
}

/** Следит за выполнением условий и показывает уведомление о новом трофее. */
export function useTrophyWatcher(state: AppState | null, paused: boolean) {
  const saving = useRef(false)
  useEffect(() => {
    if (!state || paused || saving.current) return
    const known = state.settings.trophies ?? {}
    const fresh = [...earnedNow(state)].filter((id) => !known[id])
    if (!fresh.length) return
    saving.current = true
    const now = Date.now()
    const next = { ...known }
    for (const id of fresh) next[id] = now
    api.saveSettings({ trophies: next }).finally(() => (saving.current = false))
    // Если трофеев сразу много (первый запуск с большой библиотекой) — показываем первые три
    fresh.slice(0, 3).forEach((id, i) => {
      const t = TROPHIES.find((x) => x.id === id)
      if (!t) return
      setTimeout(() => {
        play('trophy')
        toast({ title: t.title, message: t.desc, kind: 'trophy', tier: t.tier })
      }, 600 + i * 1600)
    })
  }, [state, paused])
}
