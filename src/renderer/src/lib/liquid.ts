/**
 * Жидкое стекло, как у Apple: элемент полностью прозрачный, но у кромки фон за ним преломляется — изгибается,
 * как в толстой линзе со скруглёнными краями. Делается SVG-фильтром смещения внутри backdrop-filter.
 *
 * Для каждого размера элемента рисуем свою карту смещения (с учётом скругления углов) и кэшируем фильтр.
 * Элементы находятся сами: по селектору GLASS, при появлении в DOM и при изменении размера.
 */

/** Что считается стеклом — тот же список, что в styles-glass.css */
const GLASS = [
  '.dialog', '.si', '.upd-dialog', '.pm', '.sheet', '.art-search', '.side-menu', '.steam-import', '.gp-card',
  '.profile-block', '.si-card', '.cc-card', '.busy-card', '.osk', '.toast', '.upd-card', '.special-art',
  '.ov-card:not(.is-primary):not(.is-danger)', '.ov-notice', '.ov-trophy',
  '.setting', '.btn-glass', '.btn-round', '.chip', '.menu-item', '.trophy-row', '.steam-row', '.hltb-item',
  '.top-item', '.ra-result', '.input', '.osk-key', '.power-btn', '.running-pill', '.section-pill', '.tab-pill'
].join(',')

/** Дополнительно к преломлению — чуть ярче и сочнее, как настоящее стекло */
const TAIL = 'saturate(1.6) brightness(1.06)'
const MAX_FILTERS = 120
/** Карта считается в половинном разрешении — она плавная, растягивание незаметно */
const MAP_SCALE = 0.5

let defs: SVGSVGElement | null = null
const filters = new Map<string, string>()
const applied = new WeakMap<Element, string>()
let counter = 0

function ensureDefs() {
  if (defs) return defs
  defs = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  defs.setAttribute('width', '0')
  defs.setAttribute('height', '0')
  defs.setAttribute('aria-hidden', 'true')
  defs.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none'
  document.body.appendChild(defs)
  return defs
}

/** Карта смещения скруглённого прямоугольника: внутри — нейтрально, у кромки — плавный изгиб по нормали */
function displacementMap(w: number, h: number, r: number, bezel: number) {
  const mw = Math.max(2, Math.round(w * MAP_SCALE))
  const mh = Math.max(2, Math.round(h * MAP_SCALE))
  const s = mw / w
  const R = r * s
  const B = Math.max(1, bezel * s)
  const canvas = document.createElement('canvas')
  canvas.width = mw
  canvas.height = mh
  const g = canvas.getContext('2d')!
  const img = g.createImageData(mw, mh)
  const d = img.data
  const hw = mw / 2
  const hh = mh / 2
  for (let y = 0; y < mh; y++) {
    const py = y + 0.5 - hh
    for (let x = 0; x < mw; x++) {
      const px = x + 0.5 - hw
      const qx = Math.abs(px) - (hw - R)
      const qy = Math.abs(py) - (hh - R)
      let dist: number
      let nx = 0
      let ny = 0
      if (qx > 0 && qy > 0) {
        const l = Math.hypot(qx, qy) || 1
        dist = R - l
        nx = (qx / l) * Math.sign(px)
        ny = (qy / l) * Math.sign(py)
      } else if (qx > qy) {
        dist = hw - Math.abs(px)
        nx = Math.sign(px)
      } else {
        dist = hh - Math.abs(py)
        ny = Math.sign(py)
      }
      // Чем ближе к кромке, тем сильнее изгиб; к центру — плавно в ноль
      const t = Math.min(1, Math.max(0, 1 - dist / B))
      const k = t * t * (3 - 2 * t)
      const i = (y * mw + x) * 4
      d[i] = 128 + nx * k * 127
      d[i + 1] = 128 + ny * k * 127
      d[i + 2] = 128
      d[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  return canvas.toDataURL()
}

function filterFor(w: number, h: number, r: number) {
  const key = `${w}x${h}r${r}`
  let id = filters.get(key)
  if (id) return id
  if (filters.size >= MAX_FILTERS) {
    // Самый старый фильтр — вон: размеры редко повторяются после ухода с экрана
    const [oldKey, oldId] = filters.entries().next().value as [string, string]
    filters.delete(oldKey)
    defs?.querySelector(`#${oldId}`)?.remove()
  }
  id = `lg${counter++}`
  const bezel = Math.min(Math.min(w, h) * 0.3, 64)
  // Отрицательный масштаб: у кромки берём картинку изнутри элемента и растягиваем её к краю —
  // так стекло изгибает только то, что под ним, и не затягивает соседний текст
  const scale = -Math.round(bezel * 0.85)
  const ns = 'http://www.w3.org/2000/svg'
  const f = document.createElementNS(ns, 'filter')
  f.setAttribute('id', id)
  f.setAttribute('x', '0')
  f.setAttribute('y', '0')
  f.setAttribute('width', String(w))
  f.setAttribute('height', String(h))
  f.setAttribute('filterUnits', 'userSpaceOnUse')
  f.setAttribute('primitiveUnits', 'userSpaceOnUse')
  f.setAttribute('color-interpolation-filters', 'sRGB')
  const im = document.createElementNS(ns, 'feImage')
  im.setAttribute('x', '0')
  im.setAttribute('y', '0')
  im.setAttribute('width', String(w))
  im.setAttribute('height', String(h))
  im.setAttribute('preserveAspectRatio', 'none')
  im.setAttribute('result', 'map')
  im.setAttribute('href', displacementMap(w, h, r, bezel))
  const dm = document.createElementNS(ns, 'feDisplacementMap')
  dm.setAttribute('in', 'SourceGraphic')
  dm.setAttribute('in2', 'map')
  dm.setAttribute('scale', String(scale))
  dm.setAttribute('xChannelSelector', 'R')
  dm.setAttribute('yChannelSelector', 'G')
  f.append(im, dm)
  ensureDefs().appendChild(f)
  filters.set(key, id)
  return id
}

function apply(el: HTMLElement) {
  const w = Math.round(el.offsetWidth / 2) * 2
  const h = Math.round(el.offsetHeight / 2) * 2
  if (w < 8 || h < 8) return
  const r = Math.min(Math.round(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0), w / 2, h / 2)
  const key = `${w}x${h}r${r}`
  if (applied.get(el) === key) return
  applied.set(el, key)
  const value = `url(#${filterFor(w, h, r)}) ${TAIL}`
  el.style.setProperty('backdrop-filter', value)
  el.style.setProperty('-webkit-backdrop-filter', value)
}

let resize: ResizeObserver | null = null
const watched = new WeakSet<Element>()

function scan(root: ParentNode) {
  const list: Element[] = root instanceof Element && root.matches(GLASS) ? [root] : []
  list.push(...root.querySelectorAll(GLASS))
  for (const el of list) {
    if (!(el instanceof HTMLElement)) continue
    if (!watched.has(el)) {
      watched.add(el)
      resize?.observe(el)
    }
    apply(el)
  }
}

/** Включить жидкое стекло во всём окне. Без поддержки (или при «уменьшить прозрачность») остаётся обычный стиль */
export function startLiquidGlass() {
  if (!CSS.supports('backdrop-filter', 'url(#x)')) return
  if (window.matchMedia('(prefers-reduced-transparency: reduce)').matches) return
  document.documentElement.classList.add('liquid')
  resize = new ResizeObserver((entries) => entries.forEach((e) => apply(e.target as HTMLElement)))
  let queue: Element[] = []
  const mo = new MutationObserver((records) => {
    const first = queue.length === 0
    for (const r of records) r.addedNodes.forEach((n) => n instanceof Element && queue.push(n))
    if (!first || queue.length === 0) return
    // Новые элементы обрабатываем пачкой в следующем кадре — после того как React их отрисовал
    requestAnimationFrame(() => {
      const batch = queue
      queue = []
      batch.forEach((n) => n.isConnected && scan(n))
    })
  })
  mo.observe(document.body, { childList: true, subtree: true })
  scan(document.body)
}
