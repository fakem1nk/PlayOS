import { nativeImage } from 'electron'

/**
 * Яркий цвет игры по обложке — для подсветки DualSense.
 * Берём насыщенные пиксели уменьшенной обложки и доводим цвет до сочного (светодиоду нужна яркость).
 */
export function accentFromImage(file: string | undefined): [number, number, number] | null {
  if (!file) return null
  try {
    const img = nativeImage.createFromPath(file)
    if (img.isEmpty()) return null
    const small = img.resize({ width: 24 })
    const { width, height } = small.getSize()
    const px = small.toBitmap() // BGRA
    let r = 0
    let g = 0
    let b = 0
    let weight = 0
    for (let i = 0; i < width * height; i++) {
      const B = px[i * 4]
      const G = px[i * 4 + 1]
      const R = px[i * 4 + 2]
      const max = Math.max(R, G, B)
      const min = Math.min(R, G, B)
      const sat = max ? (max - min) / max : 0
      const val = max / 255
      // Серые, тёмные и пересвеченные пиксели почти не влияют на цвет
      const w = sat * sat * (val > 0.15 && val < 0.98 ? 1 : 0.1)
      r += R * w
      g += G * w
      b += B * w
      weight += w
    }
    if (weight < 0.5) return null
    return vivid(r / weight, g / weight, b / weight)
  } catch {
    return null
  }
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
