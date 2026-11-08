import { useEffect, useState } from 'react'
import type { Game, GameDone, GameMood, PileBuild, Settings, ShelfChange } from '@shared/types'
import { t } from '@shared/i18n'
import { api } from './api'
import { SCRIPTS, type Frame, type Grid, type ScriptName } from './tivi-faces'

/**
 * Полка и стопка профиля. «Пройдено» (Game.done) и место в стопках (Game.pile: сборка → ранг) хранятся в самих играх,
 * поэтому синхронизируются облаком вместе с ними. Сборки (марафоны) — в настройках. Здесь — чтение и все правки.
 */

export const MAIN_BUILD = 'main'

/** Сборки стопки; нет ни одной — одна «Основная» */
export function buildsOf(settings: Settings): PileBuild[] {
  return settings.builds?.length ? settings.builds : [{ id: MAIN_BUILD, name: t('Основная') }]
}

export function activeBuild(settings: Settings): PileBuild {
  const all = buildsOf(settings)
  return all.find((b) => b.id === settings.build) ?? all[0]
}

/** Стопка сборки сверху вниз; пройденные в стопке не лежат */
export function pileOf(games: Game[], build: string) {
  return games.filter((g) => !g.done && g.pile?.[build] !== undefined).sort((a, b) => a.pile![build] - b.pile![build])
}

/** Полка — пройденные по порядку прохождения */
export function shelfOf(games: Game[]) {
  return games.filter((g) => g.done).sort((a, b) => a.done!.at - b.done!.at)
}

const withRank = (g: Game, build: string, rank: number | null): Record<string, number> | null => {
  const pile = { ...(g.pile ?? {}) }
  if (rank === null) delete pile[build]
  else pile[build] = rank
  return Object.keys(pile).length ? pile : null
}

/** Ранг для места at в стопке без игры id: между соседями, выше первой или ниже последней */
function rankAt(list: Game[], build: string, at: number, id?: string) {
  const rest = list.filter((g) => g.id !== id)
  const before = rest[at - 1]?.pile?.[build]
  const after = rest[at]?.pile?.[build]
  if (before === undefined && after === undefined) return 1
  if (before === undefined) return after! - 1
  if (after === undefined) return before + 1
  return (before + after) / 2
}

export const shelf = {
  /** Положить игры вниз стопки в этом порядке */
  add(list: Game[], build: string, games: Game[]) {
    const last = list[list.length - 1]?.pile?.[build] ?? 0
    return api.shelfPatch(games.filter((g) => !list.includes(g)).map((g, i) => ({ id: g.id, pile: withRank(g, build, last + 1 + i) })))
  },
  remove(game: Game, build: string) {
    return api.shelfPatch([{ id: game.id, pile: withRank(game, build, null) }])
  },
  /** Поставить игру на место at (0 — текущая, 1 — верх стопки) */
  place(list: Game[], build: string, game: Game, at: number) {
    return api.shelfPatch([{ id: game.id, pile: withRank(game, build, rankAt(list, build, at, game.id)) }])
  },
  /** На шаг вверх или вниз */
  move(list: Game[], build: string, game: Game, dir: -1 | 1) {
    const i = list.indexOf(game)
    const j = i + dir
    if (i < 0 || j < 0 || j >= list.length) return false
    void shelf.place(list, build, game, j)
    return true
  },
  /** Новый порядок после перетаскивания: переставленной игре — ранг между новыми соседями */
  reorder(list: Game[], build: string, ids: string[]) {
    const moved = ids.reduce<{ id: string; d: number } | null>((best, id, i) => {
      const d = Math.abs(i - list.findIndex((g) => g.id === id))
      return !best || d > best.d ? { id, d } : best
    }, null)
    if (!moved || !moved.d) return
    const game = list.find((g) => g.id === moved.id)!
    return shelf.place(list, build, game, ids.indexOf(moved.id))
  },
  /** Пройдено: на полку, из всех стопок */
  complete(game: Game, mood: GameMood, full: boolean) {
    const first = game.sessions.length ? Math.min(...game.sessions.map((s) => s.start)) : game.lastPlayed ?? Date.now()
    const done: GameDone = { at: Date.now(), mood, full: full || undefined, playtime: game.playtime, days: Math.max(1, Math.round((Date.now() - first) / 86_400_000)) }
    return api.shelfPatch([{ id: game.id, done, pile: null }])
  },
  /** Снять с полки; replay — сразу текущей в открытой сборке, пройти заново */
  uncomplete(game: Game, replay?: { list: Game[]; build: string }) {
    const change: ShelfChange = { id: game.id, done: null }
    if (replay) change.pile = withRank(game, replay.build, rankAt(replay.list, replay.build, 0))
    return api.shelfPatch([change])
  }
}

// ───────────── Часы до финала: HowLongToBeat из сведений об игре ─────────────

/** Сюжет по HLTB, часов: null — не нашли; нет ключа — ещё не спрашивали */
const hltbCache = new Map<string, number | null>()
let hltbQueue: Promise<unknown> = Promise.resolve()

/** Спрашивает сведения об играх по одной (там HLTB, кэш в main-процессе) и перерисовывает, когда приходят часы */
export function useHltb(games: Game[]) {
  const [, setTick] = useState(0)
  const key = games.map((g) => g.id).join()
  useEffect(() => {
    let alive = true
    for (const g of games) {
      if (hltbCache.has(g.id)) continue
      hltbCache.set(g.id, null)
      hltbQueue = hltbQueue.then(() =>
        api
          .gameDetails(g.id)
          .then((d) => {
            const main = d.hltb?.main
            hltbCache.set(g.id, main ? main / 3600 : null)
            if (alive) setTick((n) => n + 1)
          })
          .catch(() => hltbCache.delete(g.id))
      )
    }
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return (g: Game) => hltbCache.get(g.id) ?? null
}

/** Часов до конца сюжета; null — длина игры неизвестна */
export const hoursLeft = (g: Game, hltb: number | null) => (hltb === null ? null : Math.max(0, hltb - g.playtime / 3600))

/** Наиграно больше сюжета — может, уже пройдено */
export const looksDone = (g: Game, hltb: number | null) => hltb !== null && g.playtime / 3600 >= hltb * 0.95

/** Часов в неделю по сессиям за последние 4 недели — по ним прогноз «закончишь к…» */
export function weeklyPace(games: Game[]) {
  const since = Date.now() - 28 * 86_400_000
  let sec = 0
  for (const g of games) for (const s of g.sessions) if (s.start >= since) sec += s.duration
  return Math.max(3, sec / 3600 / 4)
}

/** Часы и даты «дойдёшь к…» для стопки в нынешнем темпе; игры без HLTB в сумму не входят */
export function pileEta(list: Game[], all: Game[], hltb: (g: Game) => number | null) {
  const perDay = weeklyPace(all) / 7
  let acc = 0
  const at = list.map((g) => {
    acc += hoursLeft(g, hltb(g)) ?? 0
    return Date.now() + (acc / perDay) * 86_400_000
  })
  return { total: acc, end: at[at.length - 1] ?? Date.now(), at, week: perDay * 7, known: list.some((g) => hltb(g) !== null) }
}

// ───────────── Фигурки Тиви ─────────────

export type FigureId = 'finisher' | 'perfect' | 'explorer' | 'astro' | 'knight' | 'collector' | 'legend'

/** Коллекционные фигурки Тиви: за число игр на полке или за первую игру на 100 % */
export interface FigureDef {
  id: FigureId
  n: number
  full?: boolean
}

export const FIGURES: FigureDef[] = [
  { id: 'finisher', n: 1 },
  { id: 'perfect', n: 1, full: true },
  { id: 'explorer', n: 5 },
  { id: 'astro', n: 10 },
  { id: 'knight', n: 15 },
  { id: 'collector', n: 25 },
  { id: 'legend', n: 50 }
]

export const figureName = (id: FigureId) =>
  ({
    finisher: t('Финишер'),
    perfect: t('Перфекционист'),
    explorer: t('Исследователь'),
    astro: t('Космонавт'),
    knight: t('Рыцарь'),
    collector: t('Коллекционер'),
    legend: t('Легенда')
  })[id]

/** Когда фигурка заработана: время той игры на полке, что её принесла; null — ещё нет */
export function figureEarnedAt(f: FigureDef, shelfGames: Game[]) {
  const list = f.full ? shelfGames.filter((g) => g.done?.full) : shelfGames
  return list[f.n - 1]?.done?.at ?? null
}

/** Какие фигурки появятся, если поставить на полку ещё одну игру (full — на 100 %) */
export function newFigures(shelfGames: Game[], full: boolean): FigureDef[] {
  const n = shelfGames.length + 1
  const fulls = shelfGames.filter((g) => g.done?.full).length + (full ? 1 : 0)
  return FIGURES.filter((f) => (f.full ? full && fulls === f.n : f.n === n))
}

// ───────────── Оценки лицами Тиви ─────────────

const script = (name: ScriptName) => SCRIPTS[name] as { intro?: Frame[]; loop?: Frame[] }
const faceOf = (name: ScriptName, part: 'intro' | 'loop' = 'intro', i = 0): Grid => (script(name)[part] ?? script(name).intro ?? [])[i].face
const loopOf = (name: ScriptName): Frame[] => script(name).loop ?? script(name).intro ?? []

export const FACES = {
  idle: faceOf('wake', 'intro', 1),
  neutral: faceOf('think'),
  happy: faceOf('happy'),
  love: faceOf('love'),
  wow: faceOf('wow'),
  sad: faceOf('sad'),
  confused: faceOf('wonder')
}

export interface MoodDef {
  id: GameMood
  label: () => string
  face: Grid
  /** Пока оценка выбрана, Тиви в окне «Пройдено» проигрывает эти кадры */
  frames: Frame[]
  /** Что делает Тиви в углу, когда игру поставили на полку */
  act: ScriptName
}

export const MOODS: MoodDef[] = [
  { id: 'love', label: () => t('Шедевр'), face: FACES.love, frames: loopOf('love'), act: 'love' },
  { id: 'happy', label: () => t('Понравилось'), face: FACES.happy, frames: loopOf('sparkle'), act: 'sparkle' },
  { id: 'ok', label: () => t('Нормально'), face: FACES.idle, frames: [{ face: FACES.idle, ms: 1800 }, { face: FACES.neutral, ms: 900 }], act: 'happy' },
  { id: 'meh', label: () => t('Так себе'), face: FACES.confused, frames: loopOf('wonder'), act: 'wonder' },
  { id: 'bad', label: () => t('Не моё'), face: FACES.sad, frames: loopOf('sad'), act: 'gloom' }
]
export const moodOf = (m?: GameMood) => MOODS.find((x) => x.id === m)
