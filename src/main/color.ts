import { nativeImage } from 'electron'

/** Версия алгоритма: поменялась — цвета уже добавленных игр пересчитываются при запуске */
export const ACCENT_VERSION = 2

const BINS = 24

/**
 * Цвет игры по обложке — для акцентов интерфейса и подсветки DualSense.
 * Берём не средний цвет (среднее красного и синего — фиолетовый, которого на обложке нет), а преобладающий
 * оттенок: пиксели раскладываются по 24 корзинам тона, побеждает самая весомая вместе с соседями.
 * Вес — площадь с поправкой на насыщенность и яркость; телесные тона приглушены, чтобы лица на обложке
 * не делали оранжевой игру в серо-синих тонах. Результат доводится до сочного (светодиоду нужна яркость).
 */
export function accentFromImage(file: string | undefined): [number, number, number] | null {
  if (!file) return null
  try {
    const img = nativeImage.createFromPath(file)
    if (img.isEmpty()) return null
    const small = img.resize({ width: 48 })
    const { width, height } = small.getSize()
    const px = small.toBitmap() // BGRA
    const weight = new Float64Array(BINS)
    const sum = [new Float64Array(BINS), new Float64Array(BINS), new Float64Array(BINS)]
    for (let i = 0; i < width * height; i++) {
      const B = px[i * 4]
      const G = px[i * 4 + 1]
      const R = px[i * 4 + 2]
      const { h, s, v } = hsv(R, G, B)
      // Серое и почти чёрное оттенка не задаёт
      if (s < 0.1 || v < 0.18) continue
      const skin = h >= 12 && h <= 45 && s < 0.65
      const w = Math.sqrt(s) * v * (skin ? 0.3 : 1)
      const bin = Math.floor(h / (360 / BINS)) % BINS
      weight[bin] += w
      sum[0][bin] += R * w
      sum[1][bin] += G * w
      sum[2][bin] += B * w
    }
    const around = (i: number) => [(i + BINS - 1) % BINS, i, (i + 1) % BINS]
    let best = -1
    let score = 0
    for (let i = 0; i < BINS; i++) {
      const [a, , c] = around(i)
      const sc = weight[i] + 0.5 * (weight[a] + weight[c])
      if (sc > score) {
        score = sc
        best = i
      }
    }
    if (best < 0 || score < 0.05) return null
    let r = 0
    let g = 0
    let b = 0
    let w = 0
    for (const i of around(best)) {
      r += sum[0][i]
      g += sum[1][i]
      b += sum[2][i]
      w += weight[i]
    }
    return vivid(r / w, g / w, b / w)
  } catch {
    return null
  }
}

function hsv(r: number, g: number, b: number) {
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
  }
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max / 255 }
}

/** Тот же оттенок, но насыщеннее и на полной яркости */
function vivid(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
  }
  h = (h * 60 + 360) % 360
  const s = Math.max(0.75, max ? d / max : 0)
  const c = s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = 1 - c
  const [R, G, B] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [Math.round((R + m) * 255), Math.round((G + m) * 255), Math.round((B + m) * 255)]
}

/** Цвет по платформе, если у игры нет обложки */
export const PLATFORM_COLOR: Record<string, [number, number, number]> = {
  pc: [61, 139, 255],
  ps2: [40, 70, 255],
  ps3: [220, 225, 235]
}

export const toHex = ([r, g, b]: [number, number, number]) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')

export function fromHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null
}

/** Цвет игры по арту: обложка, если её нельзя прочитать (WebP) — фон или иконка */
export function gameAccent(game: { cover?: string; hero?: string; icon?: string }) {
  const rgb = accentFromImage(game.cover) ?? accentFromImage(game.hero) ?? accentFromImage(game.icon)
  return rgb ? toHex(rgb) : undefined
}
