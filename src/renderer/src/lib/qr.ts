/**
 * QR-код без зависимостей: байтовый режим, уровень коррекции M, версии 1–10 (до ~200 байт — хватает для ссылок).
 * Алгоритм по стандарту ISO/IEC 18004, как в qrcodegen Nayuki: данные → Рид — Соломон → раскладка змейкой → маска.
 * Возвращает квадратную матрицу: true — тёмный модуль.
 */

// Уровень M: кодовых слов коррекции на блок и число блоков, по версиям (индекс 0 не используется)
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26]
const BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5]

function rawModules(ver: number) {
  let n = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2
    n -= (25 * align - 10) * align - 55
    if (ver >= 7) n -= 36
  }
  return n
}

const dataCodewords = (ver: number) => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver] * BLOCKS[ver]

// Умножение в поле GF(256) с образующим многочленом 0x11D
function gfMul(x: number, y: number) {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z & 0xff
}

function rsDivisor(degree: number) {
  const r = new Array<number>(degree).fill(0)
  r[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = gfMul(r[j], root)
      if (j + 1 < r.length) r[j] ^= r[j + 1]
    }
    root = gfMul(root, 0x02)
  }
  return r
}

function rsRemainder(data: number[], divisor: number[]) {
  const r = divisor.map(() => 0)
  for (const b of data) {
    const factor = b ^ (r.shift() as number)
    r.push(0)
    divisor.forEach((c, i) => (r[i] ^= gfMul(c, factor)))
  }
  return r
}

function alignmentPositions(ver: number) {
  if (ver === 1) return []
  const n = Math.floor(ver / 7) + 2
  const step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2
  const out = [6]
  for (let pos = ver * 4 + 17 - 7; out.length < n; pos -= step) out.splice(1, 0, pos)
  return out
}

function maskHit(mask: number, x: number, y: number) {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0
    case 1:
      return y % 2 === 0
    case 2:
      return x % 3 === 0
    case 3:
      return (x + y) % 3 === 0
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
  }
}

/** Упрощённая оценка маски (правила 1, 2 и 4 стандарта): меньше — читается легче */
function penalty(m: boolean[][]) {
  const n = m.length
  let score = 0
  for (let a = 0; a < n; a++) {
    for (const horizontal of [true, false]) {
      let run = 1
      for (let b = 1; b <= n; b++) {
        const same = b < n && (horizontal ? m[a][b] === m[a][b - 1] : m[b][a] === m[b - 1][a])
        if (same) run++
        else {
          if (run >= 5) score += run - 2
          run = 1
        }
      }
    }
  }
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3
  const dark = m.flat().filter(Boolean).length
  score += Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10
  return score
}

export function qrMatrix(text: string, forceMask?: number): boolean[][] {
  const bytes = [...new TextEncoder().encode(text)]
  let ver = 1
  const bitsFor = (v: number) => 4 + (v <= 9 ? 8 : 16) + bytes.length * 8
  while (ver <= 10 && bitsFor(ver) > dataCodewords(ver) * 8) ver++
  if (ver > 10) throw new Error('QR: слишком длинный текст')

  // Биты данных: режим «байты», длина, сами байты, терминатор и заполнители 0xEC/0x11
  const bits: number[] = []
  const put = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1)
  }
  put(0b0100, 4)
  put(bytes.length, ver <= 9 ? 8 : 16)
  for (const b of bytes) put(b, 8)
  const capacity = dataCodewords(ver) * 8
  put(0, Math.min(4, capacity - bits.length))
  put(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0))

  // Коррекция ошибок по блокам и перемежение
  const numBlocks = BLOCKS[ver]
  const eccLen = ECC_PER_BLOCK[ver]
  const raw = Math.floor(rawModules(ver) / 8)
  const shortBlocks = numBlocks - (raw % numBlocks)
  const shortLen = Math.floor(raw / numBlocks)
  const divisor = rsDivisor(eccLen)
  const blocks: number[][] = []
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1))
    k += dat.length
    const ecc = rsRemainder(dat, divisor)
    if (i < shortBlocks) dat.push(0)
    blocks.push([...dat, ...ecc])
  }
  const codewords: number[] = []
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => (i !== shortLen - eccLen || j >= shortBlocks) && codewords.push(b[i]))

  // Служебные узоры
  const size = ver * 4 + 17
  const mods = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const fixed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const setF = (x: number, y: number, dark: boolean) => {
    mods[y][x] = dark
    fixed[y][x] = true
  }
  for (let i = 0; i < size; i++) {
    setF(6, i, i % 2 === 0)
    setF(i, 6, i % 2 === 0)
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4]
  ]) {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx
        const y = cy + dy
        const d = Math.max(Math.abs(dx), Math.abs(dy))
        if (x >= 0 && x < size && y >= 0 && y < size) setF(x, y, d !== 2 && d !== 4)
      }
  }
  const al = alignmentPositions(ver)
  al.forEach((ax, i) =>
    al.forEach((ay, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setF(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    })
  )
  const formatBits = (mask: number) => {
    const d = (0 << 3) | mask // уровень M кодируется как 00
    let rem = d
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const b = ((d << 10) | rem) ^ 0x5412
    const bit = (i: number) => ((b >>> i) & 1) === 1
    for (let i = 0; i <= 5; i++) setF(8, i, bit(i))
    setF(8, 7, bit(6))
    setF(8, 8, bit(7))
    setF(7, 8, bit(8))
    for (let i = 9; i < 15; i++) setF(14 - i, 8, bit(i))
    for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, bit(i))
    for (let i = 8; i < 15; i++) setF(8, size - 15 + i, bit(i))
    setF(8, size - 8, true)
  }
  formatBits(0)
  if (ver >= 7) {
    let rem = ver
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const b = (ver << 12) | rem
    for (let i = 0; i < 18; i++) {
      const dark = ((b >>> i) & 1) === 1
      const a = size - 11 + (i % 3)
      const c = Math.floor(i / 3)
      setF(a, c, dark)
      setF(c, a, dark)
    }
  }

  // Данные змейкой снизу вверх по парам столбцов
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const up = ((right + 1) & 2) === 0
        const y = up ? size - 1 - vert : vert
        if (!fixed[y][x] && i < codewords.length * 8) {
          mods[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1
          i++
        }
      }
    }
  }

  const masked = (mask: number) => {
    const m = mods.map((row, y) => row.map((v, x) => (!fixed[y][x] && maskHit(mask, x, y) ? !v : v)))
    // Формат с номером маски пишем прямо в копию
    const saved = mods.map((r) => [...r])
    formatBits(mask)
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (fixed[y][x]) m[y][x] = mods[y][x]
    for (let y = 0; y < size; y++) mods[y] = saved[y]
    return m
  }
  if (forceMask !== undefined) return masked(forceMask)
  let best: boolean[][] | null = null
  let bestScore = Infinity
  for (let mask = 0; mask < 8; mask++) {
    const m = masked(mask)
    const s = penalty(m)
    if (s < bestScore) {
      bestScore = s
      best = m
    }
  }
  return best!
}
