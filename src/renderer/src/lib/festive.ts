/**
 * Праздничное оформление: под Новый год, Хэллоуин и 14 февраля интерфейс украшается (SeasonDecor), а Тиви празднует
 * (шапка и свои сценки). По умолчанию включается само по календарю; в настройках можно выключить или выбрать праздник
 * вручную. Даты праздников — в одном месте, seasonsOf (tivi-faces.ts).
 */

import type { FestiveMode } from '@shared/types'
import { t } from '@shared/i18n'
import { seasonsOf, type Season } from './tivi-faces'

export type Holiday = Exclude<FestiveMode, 'auto' | 'off'>
export const FESTIVE: FestiveMode[] = ['auto', 'off', 'newyear', 'halloween', 'valentine']
const HOLIDAYS = new Set<string>(['newyear', 'halloween', 'valentine'])

let mode: FestiveMode = 'auto'
export const setFestive = (m: FestiveMode | undefined) => {
  mode = m ?? 'auto'
}

/** В демо можно задать прямо в адресе: ?festive=newyear */
const asked = () => {
  const q = new URLSearchParams(location.search).get('festive')
  return q && (HOLIDAYS.has(q) || q === 'off') ? (q as FestiveMode) : null
}

/** Какой праздник сейчас оформлен; null — никакой */
export function holidayOf(m: FestiveMode | undefined, now = new Date()): Holiday | null {
  const want = asked() ?? m ?? 'auto'
  if (want === 'off') return null
  if (want !== 'auto') return want
  return (seasonsOf(now).find((x) => HOLIDAYS.has(x)) as Holiday | undefined) ?? null
}

/** Времена года и праздники для Тиви: праздник, выбранный вручную, заменяет календарный */
export function seasonsFor(now = new Date()): Season[] {
  const want = asked() ?? mode
  const list = seasonsOf(now)
  if (want === 'auto' || want === 'off') return list
  return [...list.filter((x) => !HOLIDAYS.has(x)), want]
}

export const festiveName = (m: FestiveMode) =>
  ({ auto: t('По календарю'), off: t('Выключено'), newyear: t('Новый год'), halloween: t('Хэллоуин'), valentine: t('День влюблённых') })[m]
