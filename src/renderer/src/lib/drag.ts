import { useEffect, useRef, type RefObject } from 'react'

/**
 * Перелистывание мышью: зажать левую кнопку и вести. Ряд едет за курсором и после отпускания докатывается
 * по инерции, баннер и скриншоты листаются рывком. Клик, которым закончилось перетаскивание, до плитки
 * не доходит — иначе отпускание открыло бы игру под курсором.
 */

/** Сдвиг, после которого нажатие считается перетаскиванием, а не кликом */
const THRESHOLD = 6
/** Сдвиг для одного листа в баннере и просмотре */
const SWIPE = 60
/** Затухание инерции за кадр (60 Гц) */
const FRICTION = 0.94

/** Один жест — одно действие: ряд и страница не тянут курсор одновременно */
let claimed = false

/** Гасим клик после перетаскивания один раз, на фазе захвата — раньше обработчиков плиток */
function swallowClick() {
  const stop = (e: MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
  }
  window.addEventListener('click', stop, { capture: true, once: true })
  // Клика могло не быть (отпустили за окном) — перехватчик не должен съесть следующий настоящий
  setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 60)
}

interface Gesture {
  id: number
  x: number
  y: number
  dragging: boolean
}

/** Общая часть: нажатие левой кнопкой, порог, захват указателя, отпускание */
function track(
  el: HTMLElement,
  on: { start?: () => void; move: (dx: number, e: PointerEvent) => void; end: (dx: number, e: PointerEvent) => void }
) {
  let g: Gesture | null = null
  const down = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return
    g = { id: e.pointerId, x: e.clientX, y: e.clientY, dragging: false }
    on.start?.()
  }
  const move = (e: PointerEvent) => {
    if (!g || e.pointerId !== g.id) return
    const dx = e.clientX - g.x
    if (!g.dragging) {
      // Только по горизонтали и только если жест ещё ничей
      if (claimed || Math.abs(dx) < THRESHOLD || Math.abs(dx) < Math.abs(e.clientY - g.y)) return
      g.dragging = true
      claimed = true
      el.setPointerCapture(e.pointerId)
      el.classList.add('is-dragging')
    }
    on.move(dx, e)
  }
  const up = (e: PointerEvent) => {
    if (!g || e.pointerId !== g.id) return
    const was = g.dragging
    const dx = e.clientX - g.x
    g = null
    if (!was) return
    claimed = false
    el.classList.remove('is-dragging')
    if (e.type === 'pointerup') swallowClick()
    on.end(dx, e)
  }
  el.addEventListener('pointerdown', down)
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
  el.addEventListener('pointercancel', up)
  return () => {
    el.removeEventListener('pointerdown', down)
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
    el.removeEventListener('pointercancel', up)
    if (g?.dragging) claimed = false
  }
}

/** Горизонтальная прокрутка перетаскиванием с инерцией (ряды магазина) */
export function useDragScroll(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let left = 0
    let raf = 0
    let samples: { t: number; x: number }[] = []
    const stopInertia = () => {
      cancelAnimationFrame(raf)
      el.style.scrollBehavior = ''
    }
    const off = track(el, {
      start: () => {
        stopInertia()
        left = el.scrollLeft
        samples = []
      },
      move: (dx, e) => {
        // Плавная прокрутка из CSS отстаёт от курсора — пока тянем, двигаем сразу
        el.style.scrollBehavior = 'auto'
        el.scrollLeft = left - dx
        samples.push({ t: e.timeStamp, x: e.clientX })
        while (samples.length > 2 && e.timeStamp - samples[0].t > 100) samples.shift()
      },
      end: (_dx, e) => {
        const first = samples[0]
        const dt = first ? e.timeStamp - first.t : 0
        // Скорость за последние ~100 мс, в пикселях за кадр; отпустили, остановив мышь, — без инерции
        let v = first && dt > 0 && e.timeStamp - samples[samples.length - 1].t < 60 ? ((e.clientX - first.x) / dt) * 16 : 0
        const step = () => {
          if (Math.abs(v) < 0.4) return stopInertia()
          el.scrollLeft -= v
          v *= FRICTION
          raf = requestAnimationFrame(step)
        }
        raf = requestAnimationFrame(step)
      }
    })
    // Колесо или стрелки во время инерции — инерция уступает
    el.addEventListener('wheel', stopInertia, { passive: true })
    return () => {
      off()
      stopInertia()
      el.removeEventListener('wheel', stopInertia)
    }
  }, [ref])
}

/** Листание рывком: провели мышью на SWIPE пикселей — один лист влево или вправо (баннер, скриншоты) */
export function useSwipe(ref: RefObject<HTMLElement | null>, onSwipe: (dir: -1 | 1) => void) {
  const cb = useRef(onSwipe)
  cb.current = onSwipe
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let done = false
    return track(el, {
      start: () => {
        done = false
      },
      move: (dx) => {
        // Лист перелистывается сразу, как только набрали сдвиг, — не ждём отпускания
        if (done || Math.abs(dx) < SWIPE) return
        done = true
        cb.current(dx < 0 ? 1 : -1)
      },
      end: () => {}
    })
  }, [ref])
}
