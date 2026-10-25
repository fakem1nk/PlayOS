/**
 * Стекло как линза Apple: элементы прозрачные, фон за ними мягко размыт, по кромке — тонкий свет на двух дугах
 * (всё это — обычный CSS в styles-glass.css, класс html.liquid). Никакой симуляции на каждый кадр:
 * здесь только включение стиля и реакции элементов управления — фокус «перетекает» из прежнего
 * места и пружинит, а клик мышью даёт то же желейное нажатие, что и геймпад.
 */

import { pressFx } from './nav'

/** Элементы управления — реагируют на фокус */
const CLEAR = [
  '.special-art', '.ov-card:not(.is-primary):not(.is-danger)', '.setting', '.btn-glass', '.btn-round', '.chip',
  '.menu-item', '.trophy-row', '.steam-row', '.hltb-item', '.top-item', '.ra-result', '.input', '.osk-key',
  '.power-btn', '.running-pill', '.section-pill', '.tab-pill'
].join(',')

/** На сколько px элемент смещён к прежнему фокусу в начале перехода */
const KICK = 5

let lastFocus: { x: number; y: number } | null = null
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

function onFocusIn(e: FocusEvent) {
  const rect = (e.target as HTMLElement).getBoundingClientRect?.()
  if (!rect) return
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const el = (e.target as Element).closest?.(CLEAR) as HTMLElement | null
  if (el && !reduceMotion()) {
    // Элемент стартует чуть смещённым в сторону прежнего фокуса и пружинит на место — анимация на компоновщике
    const dx = lastFocus ? lastFocus.x - cx : 0
    const dy = lastFocus ? lastFocus.y - cy : 0
    const l = Math.hypot(dx, dy)
    const ux = l ? dx / l : 0
    const uy = l ? dy / l : 0
    const from = l ? `translate(${ux * KICK}px, ${uy * KICK}px)` : 'scale(0.975)'
    const over = l ? `translate(${-ux * 1.2}px, ${-uy * 1.2}px)` : 'scale(1.012)'
    el.animate([{ transform: from }, { transform: over, offset: 0.55 }, { transform: 'translate(0, 0)' }], {
      duration: 420,
      easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
      composite: 'add'
    })
  }
  lastFocus = { x: cx, y: cy }
}

/** Включить морозное стекло во всём окне. При «уменьшить прозрачность» остаётся обычный стиль */
export function startLiquidGlass() {
  if (window.matchMedia('(prefers-reduced-transparency: reduce)').matches) return
  document.documentElement.classList.add('liquid')
  document.addEventListener('focusin', onFocusIn)
  // Клик мышью — то же желейное нажатие, что и с геймпада
  document.addEventListener('pointerdown', (e) => pressFx((e.target as Element | null)?.closest?.('[data-nav]')), { passive: true })
}
