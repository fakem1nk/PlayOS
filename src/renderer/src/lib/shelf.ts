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
    return api.shelfPatch([{ id: game.id, done: doneNow(game, mood, full), pile: null }])
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

export type FigureId =
  | 'finisher'
  | 'explorer'
  | 'astro'
  | 'knight'
  | 'collector'
  | 'legend'
  | 'titan'
  | 'perfect'
  | 'master'
  | 'sprinter'
  | 'marathon'
  | 'retro'
  | 'owl'
  | 'hattrick'

/**
 * За что даётся фигурка: count — столько игр на полке; full — столько игр на 100 %; fast — игра, пройденная за 3 дня
 * от первого запуска; long — игра, в которую наиграно 100 часов; retro — игры для PS2 и PS3; night — игра, отмеченная
 * пройденной ночью (0–5 ч); month — столько игр за любые 30 дней подряд
 */
export type FigureRule = 'count' | 'full' | 'fast' | 'long' | 'retro' | 'night' | 'month'

/** Коллекционные фигурки Тиви. tier — редкость: 1 обычная, 2 редкая, 3 эпическая, 4 легендарная */
export interface FigureDef {
  id: FigureId
  rule: FigureRule
  n: number
  tier: 1 | 2 | 3 | 4
}

/** Первые семь — за число игр на полке (верхний ряд), остальные — за особые прохождения (нижний ряд) */
export const FIGURES: FigureDef[] = [
  { id: 'finisher', rule: 'count', n: 1, tier: 1 },
  { id: 'explorer', rule: 'count', n: 5, tier: 1 },
  { id: 'astro', rule: 'count', n: 10, tier: 2 },
  { id: 'knight', rule: 'count', n: 15, tier: 2 },
  { id: 'collector', rule: 'count', n: 25, tier: 3 },
  { id: 'legend', rule: 'count', n: 50, tier: 4 },
  { id: 'titan', rule: 'count', n: 100, tier: 4 },
  { id: 'perfect', rule: 'full', n: 1, tier: 2 },
  { id: 'master', rule: 'full', n: 5, tier: 3 },
  { id: 'sprinter', rule: 'fast', n: 1, tier: 2 },
  { id: 'marathon', rule: 'long', n: 1, tier: 3 },
  { id: 'retro', rule: 'retro', n: 3, tier: 2 },
  { id: 'owl', rule: 'night', n: 1, tier: 1 },
  { id: 'hattrick', rule: 'month', n: 3, tier: 2 }
]
export const FIGURE_ROW = 7

export const figureName = (id: FigureId) =>
  ({
    finisher: t('Финишер'),
    perfect: t('Перфекционист'),
    explorer: t('Исследователь'),
    astro: t('Космонавт'),
    knight: t('Рыцарь'),
    collector: t('Коллекционер'),
    legend: t('Легенда'),
    titan: t('Титан'),
    master: t('Мастер'),
    sprinter: t('Спринтер'),
    marathon: t('Марафонец'),
    retro: t('Ретро'),
    owl: t('Сова'),
    hattrick: t('Хет-трик')
  })[id]

export const tierName = (tier: FigureDef['tier']) => [t('Обычная'), t('Редкая'), t('Эпическая'), t('Легендарная')][tier - 1]

export const FAST_DAYS = 3
export const LONG_HOURS = 100
const MONTH_MS = 30 * 86_400_000

/** Игры с полки (по порядку попадания на неё), которые идут в счёт фигурки */
function counted(f: FigureDef, shelfGames: Game[]) {
  switch (f.rule) {
    case 'full':
      return shelfGames.filter((g) => g.done?.full)
    case 'fast':
      return shelfGames.filter((g) => (g.done?.days ?? 99) <= FAST_DAYS)
    case 'long':
      return shelfGames.filter((g) => (g.done?.playtime ?? 0) >= LONG_HOURS * 3600)
    case 'retro':
      return shelfGames.filter((g) => g.platform === 'ps2' || g.platform === 'ps3')
    case 'night':
      return shelfGames.filter((g) => g.done && new Date(g.done.at).getHours() < 5)
    default:
      return shelfGames
  }
}

/** Когда фигурка заработана: время той игры на полке, что её принесла; null — ещё нет */
export function figureEarnedAt(f: FigureDef, shelfGames: Game[]) {
  if (f.rule === 'month') {
    // Первая игра, с которой в любые 30 дней подряд набралось n
    for (let i = f.n - 1; i < shelfGames.length; i++) if (shelfGames[i].done!.at - shelfGames[i - f.n + 1].done!.at <= MONTH_MS) return shelfGames[i].done!.at
    return null
  }
  return counted(f, shelfGames)[f.n - 1]?.done?.at ?? null
}

/** Сколько уже набрано к фигурке из нужного */
export function figureProgress(f: FigureDef, shelfGames: Game[]): [number, number] {
  const have = f.rule === 'month' ? shelfGames.filter((g) => Date.now() - g.done!.at <= MONTH_MS).length : counted(f, shelfGames).length
  return [Math.min(f.n, have), f.n]
}

/** Отметка «пройдено» для игры прямо сейчас */
export function doneNow(game: Game, mood: GameMood | undefined, full: boolean): GameDone {
  const first = game.sessions.length ? Math.min(...game.sessions.map((s) => s.start)) : game.lastPlayed ?? Date.now()
  return { at: Date.now(), mood, full: full || undefined, playtime: game.playtime, days: Math.max(1, Math.round((Date.now() - first) / 86_400_000)) }
}

/** Какие фигурки появятся, если поставить на полку эту игру (full — на 100 %) */
export function newFigures(shelfGames: Game[], game: Game, full: boolean): FigureDef[] {
  const after = [...shelfGames.filter((g) => g.id !== game.id), { ...game, done: doneNow(game, undefined, full) }]
  return FIGURES.filter((f) => figureEarnedAt(f, shelfGames) === null && figureEarnedAt(f, after) !== null)
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
