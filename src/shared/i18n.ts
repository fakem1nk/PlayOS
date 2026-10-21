import { EN } from './i18n-en'

/**
 * Перевод интерфейса. Ключ — сама русская строка, так код остаётся читаемым:
 * t('Играть') → «Играть» или «Play». Подстановки — в фигурных скобках: t('Версия {v}', { v }).
 * Нет перевода — показываем русский текст и запоминаем ключ (missingKeys) для проверки.
 */

export type Lang = 'ru' | 'en'

/** Язык известен ещё до загрузки модулей интерфейса: его отдаёт preload (или ?lang= в браузерном превью) */
function initialLang(): Lang {
  if (typeof window === 'undefined') return 'ru'
  const w = window as unknown as { pcsLang?: string; location?: Location }
  const q = w.location?.search.match(/[?&]lang=(en|ru)/)?.[1]
  return (q ?? w.pcsLang) === 'en' ? 'en' : 'ru'
}

let lang: Lang = initialLang()
const listeners = new Set<() => void>()
const missing = new Set<string>()

export const getLang = () => lang

export function setLang(l: Lang | undefined) {
  const next = l === 'en' ? 'en' : 'ru'
  if (next === lang) return
  lang = next
  listeners.forEach((f) => f())
}

export function onLangChange(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Язык по умолчанию — по языку Windows */
export const langFromLocale = (locale: string): Lang => (/^(ru|be|uk|kk)/i.test(locale) ? 'ru' : 'en')

export function t(ru: string, vars?: Record<string, string | number | undefined>): string {
  let s = ru
  if (lang === 'en') {
    const en = EN[ru]
    if (en !== undefined) s = en
    else if (!missing.has(ru)) {
      missing.add(ru)
    }
  }
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k] ?? '') : m)) : s
}

/** Строки, которые показали по-английски без перевода, — для проверки полноты */
export const missingKeys = () => [...missing]

/** Русские формы: 1 игра, 2 игры, 5 игр. Английские: 1 game, 2 games */
export function plural(n: number, ru: [string, string, string], en: [string, string]) {
  if (lang === 'en') return n === 1 ? en[0] : en[1]
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return ru[0]
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return ru[1]
  return ru[2]
}

/** Локаль для чисел и дат */
export const locale = () => (lang === 'en' ? 'en-US' : 'ru-RU')
