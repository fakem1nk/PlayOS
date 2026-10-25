import { useSyncExternalStore } from 'react'

/**
 * Экранная клавиатура: поле ввода, для которого её открыли (✕ на поле с геймпада).
 * Клавиатура редактирует черновик и по «Готово» записывает его в поле так, будто текст набрали руками.
 */

export type OskTarget = HTMLInputElement | HTMLTextAreaElement

let target: OskTarget | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function openKeyboard(el: OskTarget) {
  target = el
  emit()
}

export function closeKeyboard() {
  target = null
  emit()
}

export function useKeyboardTarget() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => target
  )
}

/** Записать значение в поле React: через нативный сеттер и событие input, чтобы сработал onChange */
export function writeValue(el: OskTarget, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Поле, которое имеет смысл набирать экранной клавиатурой */
export const isTextInput = (el: Element): el is OskTarget =>
  el instanceof HTMLTextAreaElement ||
  (el instanceof HTMLInputElement && ['text', 'search', 'url', 'email', 'number', 'password', ''].includes(el.type))
