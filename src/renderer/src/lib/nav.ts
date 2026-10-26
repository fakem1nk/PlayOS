import { useEffect, useRef, type RefObject } from 'react'
import type { PadAction } from '@shared/types'
import { lastInputDevice, useInputLayer } from './input'
import { beginEdit, isTextInput, openKeyboard } from './osk'
import { play } from './sound'

/**
 * Пространственная навигация для форм и меню: элементы с атрибутом data-nav,
 * следующий выбирается по геометрии в направлении нажатия.
 * Элемент с data-adjust получает влево/вправо как событие nav-adjust (переключатели, списки).
 */

type Dir = 'up' | 'down' | 'left' | 'right'

function navItems(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-nav]')).filter(
    (el) => !el.hasAttribute('disabled') && el.getClientRects().length > 0
  )
}

function findNext(cur: HTMLElement, items: HTMLElement[], dir: Dir) {
  const r = cur.getBoundingClientRect()
  let best: HTMLElement | null = null
  let bestScore = Infinity
  for (const el of items) {
    if (el === cur) continue
    const b = el.getBoundingClientRect()
    let primary: number
    let secondary: number
    if (dir === 'up' || dir === 'down') {
      primary = dir === 'up' ? r.top - b.bottom : b.top - r.bottom
      if ((dir === 'up' ? b.top + b.height / 2 >= r.top + r.height / 2 : b.top + b.height / 2 <= r.top + r.height / 2)) continue
      const overlap = Math.min(r.right, b.right) - Math.max(r.left, b.left)
      secondary = overlap > 0 ? 0 : -overlap
    } else {
      primary = dir === 'left' ? r.left - b.right : b.left - r.right
      if ((dir === 'left' ? b.left + b.width / 2 >= r.left + r.width / 2 : b.left + b.width / 2 <= r.left + r.width / 2)) continue
      const overlap = Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top)
      secondary = overlap > 0 ? 0 : -overlap
    }
    // Только в сторону нажатия: элемент, который смещён вбок сильнее, чем вперёд (дальше 45°), — не сосед.
    // Иначе «вправо» без кнопки справа уезжало на кнопку ниже
    if (secondary > Math.max(primary, 0)) continue
    const score = Math.max(primary, -20) + secondary * 3
    if (score < bestScore) {
      bestScore = score
      best = el
    }
  }
  return best
}

/** Ближайший предок с собственной прокруткой (overflow auto/scroll). */
function scrollParent(el: HTMLElement) {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p)
    if (overflowY === 'auto' || overflowY === 'scroll') return p
  }
  return null
}

/**
 * Докручивает только ближайший список, чтобы элемент (вместе с фокус-рамкой) был виден целиком.
 * Стандартный scrollIntoView нельзя: он двигает и корневые контейнеры — если элемент ещё
 * выезжает из-за края (анимация шторки), весь интерфейс съезжает вбок.
 */
export function revealEl(el: HTMLElement, smooth = true) {
  const parent = scrollParent(el)
  if (!parent) return
  const pad = parseFloat(getComputedStyle(document.documentElement).fontSize) * 2.4
  const pr = parent.getBoundingClientRect()
  const er = revealBox(el, pr.height - pad * 2)
  let dy = 0
  if (er.top - pad < pr.top) dy = er.top - pad - pr.top
  else if (er.bottom + pad > pr.bottom) dy = Math.min(er.bottom + pad - pr.bottom, er.top - pad - pr.top)
  if (Math.abs(dy) > 1) parent.scrollBy({ top: dy, behavior: smooth ? 'smooth' : 'auto' })
}

/**
 * Что показать вместе с элементом: всё поле (подпись и подсказку), справку и заголовок группы над ним,
 * а целый блок (data-reveal) — если он помещается. Так при листании геймпадом не теряются пояснения.
 */
function revealBox(el: HTMLElement, room: number) {
  const r = el.getBoundingClientRect()
  let top = r.top
  let bottom = r.bottom
  const fit = (t: number, b: number) => b - t <= room
  const block = el.closest<HTMLElement>('[data-reveal]')
  if (block) {
    const br = block.getBoundingClientRect()
    if (fit(br.top, br.bottom)) return { top: br.top, bottom: br.bottom }
  }
  const field = el.closest<HTMLElement>('.field') ?? el.closest<HTMLElement>('.setting') ?? el
  const fr = field.getBoundingClientRect()
  if (fit(Math.min(top, fr.top), Math.max(bottom, fr.bottom))) {
    top = Math.min(top, fr.top)
    bottom = Math.max(bottom, fr.bottom)
  }
  // Справки и заголовки прямо над пунктом
  for (let p = field.previousElementSibling as HTMLElement | null; p && p.matches('.note, .panel-title'); p = p.previousElementSibling as HTMLElement | null) {
    const pr = p.getBoundingClientRect()
    if (!fit(pr.top, bottom)) break
    top = pr.top
  }
  // Справка сразу под пунктом (последний элемент раздела) — тоже показываем
  const after = field.nextElementSibling as HTMLElement | null
  if (after?.matches('.note')) {
    const ar = after.getBoundingClientRect()
    if (fit(top, ar.bottom)) bottom = ar.bottom
  }
  return { top, bottom }
}

/** Отклик на нажатие ✕ с геймпада: короткое «вдавливание», как у кнопки под пальцем */
export function pressFx(el: Element | null | undefined) {
  if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  // Желейное нажатие: сплющивается, отпружинивает чуть вытянутым и возвращается — как жидкое стекло
  el.animate(
    [
      { transform: 'scale(1, 1)' },
      { transform: 'scale(1.04, 0.93)', offset: 0.28 },
      { transform: 'scale(0.985, 1.025)', offset: 0.6 },
      { transform: 'scale(1, 1)' }
    ],
    { duration: 460, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', composite: 'add' }
  )
}

export function focusEl(el: HTMLElement | null | undefined) {
  if (!el) return
  el.focus({ preventScroll: true })
  revealEl(el)
}

interface Options {
  priority: number
  active?: boolean
  onBack?: () => void
  /** Остальные кнопки (меню, L1/R1…). Верните false, чтобы передать ниже. */
  onAction?: (a: PadAction) => boolean | void
  /** Упёрлись в край — например, подняться к вкладкам */
  onEdge?: (dir: Dir) => void
  /** Селектор элемента, который получит фокус при активации */
  autoFocus?: string
  /** Смена значения заново ставит автофокус (например, при переходе между шагами) */
  focusKey?: unknown
  /** Подменить найденный элемент (например, переход между колонками всегда на «главный» элемент) */
  remap?: (next: HTMLElement, cur: HTMLElement, dir: Dir) => HTMLElement | null
}

export function useSpatialNav(ref: RefObject<HTMLElement | null>, opts: Options) {
  const active = opts.active ?? true

  useInputLayer(
    (a) => {
      const root = ref.current
      if (!root) return false
      if (a === 'back') {
        if (!opts.onBack) return false
        play('back')
        opts.onBack()
        return
      }
      const items = navItems(root)
      const activeEl = document.activeElement as HTMLElement | null
      const cur = activeEl && root.contains(activeEl) && activeEl.matches('[data-nav]') ? activeEl : null
      if (a === 'up' || a === 'down' || a === 'left' || a === 'right') {
        if (!cur) {
          focusEl(items[0])
          return
        }
        if ((a === 'left' || a === 'right') && cur.hasAttribute('data-adjust')) {
          cur.dispatchEvent(new CustomEvent('nav-adjust', { detail: a === 'left' ? -1 : 1 }))
          return
        }
        // Отклонённый remap-ом кандидат (например, пункт соседней колонки) — не тупик: пробуем следующего по близости
        let pool = items
        let next: HTMLElement | null = null
        for (let tries = 0; tries < 8 && !next; tries++) {
          const found = findNext(cur, pool, a)
          if (!found) break
          next = opts.remap ? opts.remap(found, cur, a) : found
          pool = pool.filter((el) => el !== found)
        }
        if (next) {
          play('move')
          focusEl(next)
        } else if (opts.onEdge) opts.onEdge(a)
        else play('bump')
        return
      }
      if (a === 'confirm') {
        if (!cur) return
        // Текстовое поле: с клавиатуры — открываем для ввода на месте, с геймпада — экранная клавиатура
        if (isTextInput(cur)) {
          play('select')
          if (lastInputDevice() === 'keyboard') beginEdit(cur)
          else openKeyboard(cur)
        } else {
          pressFx(cur)
          cur.click()
        }
        return
      }
      return opts.onAction ? opts.onAction(a) : false
    },
    opts.priority,
    active
  )

  // При активации (и смене focusKey) ставим фокус на нужный элемент. Ждём несколько кадров —
  // содержимое может ещё доанимировать выход предыдущего шага.
  const lastKey = useRef(opts.focusKey)
  useEffect(() => {
    if (!active) return
    // Сменился шаг — фокус надо перенести, даже если он ещё на элементе уходящего шага
    const force = lastKey.current !== opts.focusKey
    lastKey.current = opts.focusKey
    let id = 0
    let tries = 0
    const attempt = () => {
      const root = ref.current
      const activeEl = document.activeElement
      if (!force && root && activeEl && activeEl !== document.body && root.contains(activeEl)) return
      const target = root && opts.autoFocus ? root.querySelector<HTMLElement>(opts.autoFocus) : null
      const el = target ?? (root && tries > 20 ? navItems(root)[0] : null)
      if (el) focusEl(el)
      else if (tries++ < 40) id = window.setTimeout(attempt, 16)
    }
    id = window.setTimeout(attempt, 16)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, opts.focusKey])
}
