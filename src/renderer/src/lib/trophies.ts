import { useEffect, useRef } from 'react'
import type { AppState, Game } from '@shared/types'
import { api } from './api'
import { play } from './sound'
import { toast } from './state'
import { t } from '@shared/i18n'

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
  { id: 'first-launch', title: t('Первый запуск'), desc: t('Запустите любую игру через PlayOS'), tier: 'bronze', check: (c) => c.sessions.length > 0 },
  { id: 'collector', title: t('Коллекционер'), desc: t('Соберите 10 игр в библиотеке'), tier: 'bronze', check: (c) => c.games.length >= 10 },
  { id: 'curator', title: t('Хранитель полки'), desc: t('Соберите 25 игр в библиотеке'), tier: 'silver', check: (c) => c.games.length >= 25 },
  { id: 'retro', title: t('Ретро-вечер'), desc: t('Сыграйте в игру с PlayStation 2'), tier: 'bronze', check: (c) => playedOn(c, 'ps2') },
  { id: 'cell', title: t('Мощь Cell'), desc: t('Сыграйте в игру с PlayStation 3'), tier: 'bronze', check: (c) => playedOn(c, 'ps3') },
  {
    id: 'generations',
    title: t('Три поколения'),
    desc: t('Сыграйте в игры для PC, PS2 и PS3'),
    tier: 'silver',
    check: (c) => playedOn(c, 'pc') && playedOn(c, 'ps2') && playedOn(c, 'ps3')
  },
  { id: 'marathon', title: t('Марафон'), desc: t('Проведите в игре 3 часа без перерыва'), tier: 'silver', check: (c) => c.sessions.some((s) => s.duration >= 3 * 3600) },
  { id: 'night-owl', title: t('Ночная сова'), desc: t('Начните игру между 2 и 5 часами ночи'), tier: 'bronze', check: (c) => c.sessions.some((s) => {
    const h = new Date(s.start).getHours()
    return h >= 2 && h < 5
  }) },
  { id: 'streak', title: t('Без пропусков'), desc: t('Играйте 7 дней подряд'), tier: 'silver', check: (c) => longestStreak(c.sessions) >= 7 },
  { id: 'devoted', title: t('Преданность'), desc: t('Наиграйте 50 часов в одной игре'), tier: 'gold', check: (c) => c.games.some((g) => g.playtime >= 50 * 3600) },
  { id: 'century', title: t('Сотня'), desc: t('Наиграйте 100 часов суммарно'), tier: 'gold', check: (c) => c.games.reduce((a, g) => a + g.playtime, 0) >= 100 * 3600 },
  { id: 'favorite', title: t('Любимчик'), desc: t('Добавьте игру в избранное'), tier: 'bronze', check: (c) => c.games.some((g) => g.favorite) },
  { id: 'avatar', title: t('Своё лицо'), desc: t('Поставьте свой аватар в профиле'), tier: 'bronze', check: (c) => c.avatar }
]

export const TROPHIES: Trophy[] = [
  ...BASE,
  {
    id: 'platinum',
    title: t('Платина PlayOS'),
    desc: t('Получите все остальные трофеи'),
    tier: 'platinum',
    check: () => false // вычисляется отдельно
  }
]

export const TIER_NAMES: Record<Tier, string> = { bronze: t('Бронза'), silver: t('Серебро'), gold: t('Золото'), platinum: t('Платина') }

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
      const tr = TROPHIES.find((x) => x.id === id)
      if (!tr) return
      setTimeout(() => {
        play('trophy')
        toast({ title: tr.title, message: tr.desc, kind: 'trophy', tier: tr.tier })
      }, 600 + i * 1600)
    })
  }, [state, paused])
}
