/**
 * Наборы звуков интерфейса. «Стекло» — исходный набор, он живёт в sound.ts; здесь — остальные и основной (`main`),
 * собранный из них по одному звуку.
 * Каждый звук — функция от набора инструментов (Kit), который sound.ts собирает из своего синтезатора:
 * так все наборы звучат через одни и те же громкость, «комнату» и «зал».
 *
 *  • crt  «Кинескоп» — сухие тики и щелчки реле, гул и треск включения, дождь из капель; под новое интро и Тиви;
 *  • soft «Мягкий»   — низкие округлые тоны без щелчков и высоких колокольчиков, для игры ночью;
 *  • chip «8 бит»    — короткие квадратные и треугольные ноты, как у старой приставки;
 *  • drop «Капля»    — ханг и капли воды: меню «играет» по одной гамме, а у Тиви с жидкостью в ушах голос — бульк.
 */

export type Dir = 'up' | 'down' | 'left' | 'right' | null

export interface ToneOpts {
  gain: number
  dur: number
  attack?: number
  pan?: number
  room?: number
  space?: number
  /** Тон плавно уходит к этой частоте за время звука */
  to?: number
  /** Срез высоких, Гц */
  lp?: number
}
export interface BurstOpts {
  gain: number
  dur: number
  type?: BiquadFilterType
  freq: number
  /** Фильтр едет к этой частоте */
  to?: number
  q?: number
  attack?: number
  pan?: number
  room?: number
  space?: number
}
export interface StrikePart {
  f: number
  gain: number
  dur: number
}
export interface StrikeOpts {
  pan?: number
  room?: number
  space?: number
  attack?: number
}
export interface Kit {
  dir: Dir
  /** Панорама по направлению шага: влево — левее */
  pan: number
  /** Нота по полутонам от ля первой октавы */
  n: (semitones: number) => number
  tone: (type: OscillatorType, freq: number, start: number, o: ToneOpts) => void
  burst: (start: number, o: BurstOpts) => void
  /** Несколько обертонов с общим выходом */
  strike: (parts: StrikePart[], start: number, o: StrikeOpts) => void
  bell: (freq: number, start: number, o: { gain: number; dur: number; space?: number; room?: number; pan?: number; ratio?: number; index?: number }) => void
  pad: (freqs: number[], start: number, dur: number, gain: number, cutoff?: number, space?: number, attack?: number) => void
  air: (start: number, dur: number, gain: number, from: number, to: number, space?: number, pan?: number) => void
}

export type SetName = 'main' | 'glass' | 'crt' | 'soft' | 'chip' | 'drop'
export const SET_NAMES: SetName[] = ['main', 'glass', 'crt', 'soft', 'chip', 'drop']
type Sound = (k: Kit) => void
type SoundSet = Partial<Record<string, Sound>>

// Одинаковая «случайность» при каждом запуске: капли дождя не должны каждый раз складываться в новую мелодию
const rnd = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}
const byDir = (k: Kit, up: number, mid: number, down: number) => (k.dir === 'up' ? up : k.dir === 'down' ? down : mid)

// ───────────────────────── «Кинескоп» ─────────────────────────

/** Щелчок реле: короткий сухой шум и низкий «ток» под ним */
const tick = (k: Kit, start: number, freq: number, gain: number, pan = 0) => {
  k.burst(start, { gain: gain * 0.7, dur: 0.012, type: 'highpass', freq: 2600, pan, attack: 0.0006 })
  k.tone('sine', freq, start, { gain, dur: 0.055, to: freq * 0.86, pan, room: 0.12, attack: 0.001 })
}
/** Капли дождя: count коротких нот сверху вниз за span секунд, разбросаны по стерео */
const rain = (k: Kit, start: number, span: number, count: number, gain: number, hi = 2100, lo = 700) => {
  for (let i = 0; i < count; i++) {
    const p = i / (count - 1)
    const f = hi * Math.pow(lo / hi, p) * (0.92 + rnd(i) * 0.16)
    k.tone('triangle', f, start + p * span + rnd(i + 40) * 0.03, { gain: gain * (0.6 + rnd(i + 9) * 0.4), dur: 0.07, to: f * 0.8, pan: rnd(i + 20) * 1.4 - 0.7, room: 0.3, lp: 4200, attack: 0.001 })
  }
}
/** Голос Тиви: две короткие мягкие ноты */
const chirp = (k: Kit, start: number, a: number, b: number, gain = 0.03, pan = 0.5) => {
  k.tone('square', a, start, { gain, dur: 0.07, lp: 2400, pan, room: 0.25 })
  k.tone('square', b, start + 0.075, { gain, dur: 0.13, lp: 2400, pan, room: 0.3 })
}

const crt: SoundSet = {
  move: (k) => tick(k, 0, byDir(k, 470, 420, 372) * (0.99 + Math.random() * 0.02), 0.05, k.pan),
  bump: (k) => {
    k.tone('sine', 120, 0, { gain: 0.075, dur: 0.16, to: 62, pan: k.pan * 1.6, room: 0.15, attack: 0.002 })
    k.burst(0, { gain: 0.03, dur: 0.05, type: 'bandpass', freq: 1100, q: 0.8, pan: k.pan * 1.6 })
  },
  tab: (k) => {
    const right = k.dir !== 'left'
    k.burst(0, { gain: 0.03, dur: 0.13, type: 'bandpass', freq: right ? 700 : 3000, to: right ? 3000 : 700, q: 1.4, pan: right ? 0.4 : -0.4, room: 0.2, attack: 0.03 })
    tick(k, 0.05, right ? 560 : 500, 0.045, right ? 0.3 : -0.3)
  },
  adjust: (k) => tick(k, 0, k.dir === 'left' ? 500 : 600, 0.045, k.pan),
  toggle: (k) => crt.toggleOn!(k),
  toggleOn: (k) => {
    tick(k, 0, 440, 0.045, 0.1)
    tick(k, 0.055, 660, 0.045, 0.15)
  },
  toggleOff: (k) => {
    tick(k, 0, 587, 0.04, -0.1)
    tick(k, 0.055, 392, 0.04, -0.15)
  },
  select: (k) => {
    k.burst(0, { gain: 0.025, dur: 0.012, type: 'highpass', freq: 3000 })
    k.tone('triangle', 660, 0, { gain: 0.05, dur: 0.1, lp: 3000, room: 0.2 })
    k.tone('triangle', 990, 0.055, { gain: 0.045, dur: 0.24, lp: 3400, room: 0.25, space: 0.2 })
  },
  back: (k) => {
    k.tone('triangle', 523, 0, { gain: 0.045, dur: 0.09, lp: 2600, room: 0.2 })
    k.tone('triangle', 392, 0.055, { gain: 0.04, dur: 0.18, lp: 2200, room: 0.25 })
  },
  error: (k) => {
    for (const s of [0, 0.15]) {
      k.tone('sawtooth', 146, s, { gain: 0.085, dur: 0.11, lp: 520, room: 0.15 })
      k.burst(s, { gain: 0.02, dur: 0.09, type: 'bandpass', freq: 900, q: 0.7 })
    }
  },
  shuffle: (k) => {
    rain(k, 0, 0.28, 7, 0.045, 900, 1900)
    k.tone('triangle', 1175, 0.36, { gain: 0.05, dur: 0.5, lp: 3600, space: 0.4 })
  },
  launch: (k) => {
    // Прогрев: низкий тон набирает высоту, шум раскрывается, сверху сыплются капли и встаёт аккорд
    k.tone('sawtooth', 70, 0, { gain: 0.05, dur: 1.2, to: 280, lp: 700, space: 0.3, attack: 0.25 })
    k.air(0, 1.2, 0.04, 240, 5600, 0.5)
    rain(k, 0.35, 0.7, 10, 0.03, 900, 2400)
    k.pad([k.n(-21), k.n(-14), k.n(-9), k.n(-2)], 0.3, 2.3, 0.038, 1700, 0.8, 0.5)
    k.tone('triangle', k.n(15), 1.1, { gain: 0.04, dur: 1.2, lp: 3600, space: 0.6 })
  },
  trophy: (k) => {
    ;[15, 19, 22, 27].forEach((s, i) => k.tone('triangle', k.n(s), i * 0.07, { gain: 0.07, dur: 0.5, lp: 4200, space: 0.4, pan: i * 0.2 - 0.3 }))
    k.bell(k.n(27), 0.3, { gain: 0.065, dur: 1.6, space: 0.7, ratio: 3, index: 0.8 })
    k.air(0.25, 0.8, 0.012, 5000, 9000, 0.8, 0.2)
  },
  boot: (k) => {
    // Под интро: 0,08 с — щелчок питания и гул; 0,65–1,55 с — название проявляется дождём;
    // 1,12 с — волна мельтешения и низкий удар; дальше тёплый аккорд до приветствия
    k.burst(0.08, { gain: 0.03, dur: 0.02, type: 'highpass', freq: 1800 })
    k.tone('sine', 50, 0.08, { gain: 0.03, dur: 2.6, to: 55, space: 0.3, attack: 0.4 })
    k.air(0.1, 0.7, 0.03, 300, 4200, 0.8)
    rain(k, 0.65, 0.9, 16, 0.035)
    k.burst(1.12, { gain: 0.026, dur: 0.7, type: 'bandpass', freq: 700, to: 5200, q: 2.2, space: 0.5, attack: 0.08 })
    k.bell(k.n(-33), 1.12, { gain: 0.06, dur: 1.9, space: 0.5, ratio: 1, index: 0.25 })
    k.pad([k.n(-33), k.n(-26), k.n(-21), k.n(-17), k.n(-14)], 0.9, 3.2, 0.036, 1200, 0.85, 0.9)
    k.tone('triangle', k.n(15), 1.3, { gain: 0.03, dur: 1.6, lp: 3200, space: 0.7, pan: -0.2 })
    k.tone('triangle', k.n(22), 2.95, { gain: 0.028, dur: 1.8, lp: 3600, space: 0.8, pan: 0.2 })
  },
  farewell: (k) => {
    k.pad([k.n(-26), k.n(-21), k.n(-17), k.n(-14)], 0, 2.0, 0.046, 1100, 0.8, 0.25)
    rain(k, 0.1, 0.8, 8, 0.036, 1600, 500)
    // Кинескоп схлопывается: тон падает, остаётся щелчок-точка
    k.tone('sine', 900, 1.1, { gain: 0.04, dur: 0.4, to: 60, space: 0.3 })
    k.burst(1.5, { gain: 0.03, dur: 0.015, type: 'highpass', freq: 2400 })
  },
  shutdown: (k) => {
    k.pad([k.n(-29), k.n(-24), k.n(-21), k.n(-17)], 0, 2.6, 0.04, 900, 0.85, 0.3)
    rain(k, 0.15, 1.2, 9, 0.03, 1400, 400)
    k.tone('sine', 1000, 1.6, { gain: 0.045, dur: 0.45, to: 45, space: 0.3 })
    k.bell(k.n(-38), 1.78, { gain: 0.08, dur: 1.6, space: 0.4, ratio: 1, index: 0.15 })
    k.burst(2.1, { gain: 0.03, dur: 0.015, type: 'highpass', freq: 2400 })
  },
  installed: (k) => {
    k.pad([k.n(-21), k.n(-14), k.n(-9), k.n(-5)], 0, 1.9, 0.03, 1600, 0.75, 0.25)
    chirp(k, 0.02, k.n(10), k.n(15), 0.03, 0)
    chirp(k, 0.3, k.n(15), k.n(22), 0.03, 0)
    k.bell(k.n(27), 0.5, { gain: 0.035, dur: 1.6, space: 0.8, ratio: 3, index: 0.6 })
  },
  // Тиви собрался в углу: искры слетаются (ноты вверх, слева направо), потом его «привет»
  arrive: (k) => {
    for (let i = 0; i < 9; i++) k.tone('triangle', 700 * Math.pow(1.13, i), i * 0.07, { gain: 0.022, dur: 0.06, lp: 4500, pan: -0.2 + i * 0.1, room: 0.3 })
    chirp(k, 1.55, k.n(7), k.n(14), 0.028, 0.6)
  },
  // Тиви зевает перед выключением
  yawn: (k) => {
    k.tone('square', 620, 0.15, { gain: 0.022, dur: 0.5, to: 300, lp: 1500, pan: 0.6, room: 0.3, attack: 0.08 })
  }
}

// ───────────────────────── «Мягкий» ─────────────────────────

/** Округлая нота без щелчка: синус с мягкой атакой и срезом верха */
const soft1 = (k: Kit, freq: number, start: number, gain: number, dur = 0.14, pan = 0, space = 0) =>
  k.tone('sine', freq, start, { gain, dur, attack: 0.006, lp: 1800, pan, room: 0.3, space })

const soft: SoundSet = {
  move: (k) => soft1(k, byDir(k, 587, 523, 466) * (0.995 + Math.random() * 0.01), 0, 0.06, 0.1, k.pan),
  bump: (k) => k.tone('sine', 130, 0, { gain: 0.08, dur: 0.2, to: 80, pan: k.pan * 1.6, room: 0.2, attack: 0.004 }),
  tab: (k) => {
    const right = k.dir !== 'left'
    k.air(0, 0.25, 0.014, right ? 500 : 1400, right ? 1400 : 500, 0.3, right ? 0.4 : -0.4)
    soft1(k, right ? 659 : 587, 0.04, 0.05, 0.16, right ? 0.3 : -0.3)
  },
  adjust: (k) => soft1(k, k.dir === 'left' ? 587 : 698, 0, 0.055, 0.1, k.pan),
  toggle: (k) => soft.toggleOn!(k),
  toggleOn: (k) => {
    soft1(k, 392, 0, 0.055, 0.14, 0.1)
    soft1(k, 587, 0.07, 0.05, 0.22, 0.15)
  },
  toggleOff: (k) => {
    soft1(k, 523, 0, 0.05, 0.14, -0.1)
    soft1(k, 349, 0.07, 0.045, 0.22, -0.15)
  },
  select: (k) => {
    soft1(k, 659, 0, 0.06, 0.3, -0.08, 0.25)
    soft1(k, 988, 0.06, 0.04, 0.45, 0.1, 0.35)
  },
  back: (k) => {
    soft1(k, 494, 0, 0.05, 0.22, 0.06, 0.2)
    soft1(k, 330, 0.06, 0.045, 0.32, -0.06, 0.2)
  },
  error: (k) => {
    soft1(k, 196, 0, 0.06, 0.26)
    soft1(k, 198.5, 0, 0.034, 0.26)
    soft1(k, 165, 0.15, 0.06, 0.36)
  },
  shuffle: (k) => {
    ;[0, 0.07, 0.13, 0.18, 0.22].forEach((t, i) => soft1(k, 392 + i * 66, t, 0.045, 0.1, (i % 2 ? 0.3 : -0.3) * (1 - i / 5)))
    soft1(k, 784, 0.32, 0.055, 0.7, 0, 0.5)
  },
  launch: (k) => {
    k.air(0, 1.3, 0.03, 200, 2600, 0.5)
    k.pad([k.n(-21), k.n(-14), k.n(-9), k.n(-2)], 0.05, 2.8, 0.036, 1200, 0.85, 0.6)
    ;[3, 7, 10, 15].forEach((s, i) => soft1(k, k.n(s), 0.2 + i * 0.11, 0.045, 1.2, i * 0.25 - 0.4, 0.6))
  },
  trophy: (k) => {
    ;[3, 7, 10, 15].forEach((s, i) => soft1(k, k.n(s), i * 0.08, 0.06, 0.8, i * 0.2 - 0.3, 0.5))
    k.bell(k.n(15), 0.36, { gain: 0.04, dur: 1.8, space: 0.7, ratio: 2, index: 0.4 })
  },
  boot: (k) => {
    k.pad([k.n(-33), k.n(-26), k.n(-21), k.n(-17), k.n(-14)], 0, 3.8, 0.048, 900, 0.9, 1.3)
    k.air(0.2, 1.0, 0.02, 200, 1800, 0.9)
    k.bell(k.n(-33), 1.1, { gain: 0.07, dur: 2.0, space: 0.5, ratio: 1, index: 0.2 })
    ;[-2, 3, 7, 10].forEach((s, i) => soft1(k, k.n(s), 1.12 + i * 0.09, 0.045, 1.8, i * 0.3 - 0.45, 0.7))
    soft1(k, k.n(15), 2.95, 0.035, 2.0, 0.2, 0.8)
  },
  farewell: (k) => {
    k.pad([k.n(-26), k.n(-21), k.n(-17), k.n(-14)], 0, 2.2, 0.038, 900, 0.85, 0.25)
    ;[10, 7, 3, -2].forEach((s, i) => soft1(k, k.n(s), 0.05 + i * 0.15, 0.045, 1.5, 0.4 - i * 0.25, 0.7))
    k.bell(k.n(-33), 1.25, { gain: 0.05, dur: 1.4, space: 0.5, ratio: 1, index: 0.2 })
  },
  shutdown: (k) => {
    k.pad([k.n(-29), k.n(-24), k.n(-21), k.n(-17)], 0, 2.6, 0.042, 800, 0.85, 0.3)
    ;[3, -2, -5, -9].forEach((s, i) => soft1(k, k.n(s), 0.1 + i * 0.24, 0.045, 1.8, 0.3 - i * 0.2, 0.75))
    k.bell(k.n(-38), 1.75, { gain: 0.08, dur: 1.6, space: 0.4, ratio: 1, index: 0.15 })
  },
  installed: (k) => {
    k.pad([k.n(-21), k.n(-14), k.n(-9), k.n(-5)], 0, 1.9, 0.032, 1300, 0.8, 0.25)
    ;[-2, 3, 7, 10].forEach((s, i) => soft1(k, k.n(s), 0.02 + i * 0.09, 0.05, 1.2, i * 0.25 - 0.35, 0.6))
  },
  arrive: (k) => {
    ;[3, 7, 10].forEach((s, i) => soft1(k, k.n(s), i * 0.16, 0.03, 0.5, 0.1 + i * 0.2, 0.5))
    soft1(k, k.n(15), 1.55, 0.04, 0.6, 0.6, 0.5)
  },
  yawn: (k) => k.tone('sine', 520, 0.15, { gain: 0.035, dur: 0.55, to: 300, lp: 1400, pan: 0.6, room: 0.3, attack: 0.1 })
}

// ───────────────────────── «8 бит» ─────────────────────────

/** Нота приставки: квадрат через срез верха, короткая и ровная */
const sq = (k: Kit, freq: number, start: number, dur: number, gain = 0.022, pan = 0, room = 0.15) => k.tone('square', freq, start, { gain, dur, lp: 3200, pan, room, attack: 0.001 })
const tri = (k: Kit, freq: number, start: number, dur: number, gain = 0.06, pan = 0) => k.tone('triangle', freq, start, { gain, dur, pan, room: 0.15, attack: 0.002 })
/** Мелодия подряд: ноты по полутонам от ля, шаг в секундах */
const tune = (k: Kit, notes: number[], start: number, step: number, dur: number, gain = 0.022, spread = 0) =>
  notes.forEach((s, i) => sq(k, k.n(s), start + i * step, dur, gain, spread ? (i / Math.max(1, notes.length - 1) - 0.5) * spread : 0))

const chip: SoundSet = {
  move: (k) => sq(k, byDir(k, 988, 880, 784), 0, 0.03, 0.02, k.pan),
  bump: (k) => {
    tri(k, 110, 0, 0.09, 0.08, k.pan * 1.6)
    k.burst(0, { gain: 0.02, dur: 0.04, type: 'lowpass', freq: 900, pan: k.pan * 1.6 })
  },
  tab: (k) => tune(k, k.dir !== 'left' ? [3, 7, 10] : [10, 7, 3], 0, 0.035, 0.04, 0.02, k.dir !== 'left' ? 0.6 : -0.6),
  adjust: (k) => sq(k, k.dir === 'left' ? 784 : 1047, 0, 0.035, 0.02, k.pan),
  toggle: (k) => chip.toggleOn!(k),
  toggleOn: (k) => tune(k, [3, 10], 0, 0.05, 0.06),
  toggleOff: (k) => tune(k, [10, 3], 0, 0.05, 0.06, 0.02),
  select: (k) => {
    sq(k, k.n(19), 0, 0.05, 0.024)
    sq(k, k.n(24), 0.05, 0.12, 0.022, 0, 0.25)
  },
  back: (k) => {
    sq(k, k.n(12), 0, 0.05, 0.022)
    sq(k, k.n(7), 0.05, 0.1, 0.02, 0, 0.2)
  },
  error: (k) => {
    sq(k, 147, 0, 0.09, 0.03)
    sq(k, 147, 0.13, 0.14, 0.03)
  },
  shuffle: (k) => {
    tune(k, [3, 12, 7, 15, 10, 19], 0, 0.045, 0.04, 0.02, 0.8)
    sq(k, k.n(22), 0.3, 0.3, 0.024, 0, 0.3)
  },
  launch: (k) => {
    tri(k, k.n(-21), 0, 0.5, 0.07)
    tri(k, k.n(-14), 0.5, 0.9, 0.07)
    tune(k, [3, 7, 10, 15, 19, 22, 27, 31], 0.1, 0.07, 0.09, 0.02, 0.9)
    k.burst(0.66, { gain: 0.02, dur: 0.25, type: 'highpass', freq: 5000, space: 0.3 })
    sq(k, k.n(27), 0.74, 0.6, 0.022, 0, 0.4)
  },
  trophy: (k) => {
    tune(k, [15, 15, 15, 19, 22], 0, 0.085, 0.07, 0.024)
    sq(k, k.n(27), 0.43, 0.6, 0.026, 0, 0.4)
    sq(k, k.n(31), 0.43, 0.6, 0.012, 0.3, 0.4)
  },
  boot: (k) => {
    tri(k, k.n(-33), 0.08, 0.5, 0.08)
    tune(k, [3, 10, 15, 3, 10, 15, 7, 12], 0.65, 0.1, 0.06, 0.016, 1)
    k.burst(1.12, { gain: 0.025, dur: 0.3, type: 'highpass', freq: 4500, space: 0.3 })
    tri(k, k.n(-21), 1.12, 1.2, 0.08)
    tune(k, [10, 15, 19, 22], 1.12, 0.07, 0.16, 0.022, 0.7)
    sq(k, k.n(27), 1.45, 0.9, 0.02, 0.1, 0.5)
    tune(k, [22, 27], 2.95, 0.09, 0.3, 0.016, 0.3)
  },
  farewell: (k) => {
    tune(k, [22, 19, 15, 10], 0.05, 0.13, 0.12, 0.02, -0.6)
    tri(k, k.n(-21), 0.05, 0.9, 0.07)
    tri(k, k.n(-33), 1.1, 0.5, 0.08)
    k.tone('square', 600, 1.1, { gain: 0.016, dur: 0.3, to: 80, lp: 2000 })
  },
  shutdown: (k) => {
    tune(k, [15, 10, 7, 3], 0.1, 0.22, 0.2, 0.02, -0.5)
    tri(k, k.n(-24), 0.1, 1.4, 0.07)
    k.tone('square', 700, 1.6, { gain: 0.018, dur: 0.4, to: 60, lp: 2000 })
    tri(k, k.n(-38), 1.78, 0.8, 0.09)
  },
  installed: (k) => {
    tri(k, k.n(-21), 0, 0.6, 0.07)
    tune(k, [10, 15, 19, 22, 19, 22, 27], 0.02, 0.075, 0.07, 0.022, 0.6)
    sq(k, k.n(27), 0.55, 0.5, 0.022, 0, 0.4)
  },
  arrive: (k) => {
    tune(k, [3, 5, 7, 10, 12, 15, 17, 19, 22], 0, 0.07, 0.04, 0.014, 0.8)
    tune(k, [15, 22], 1.55, 0.08, 0.12, 0.022)
  },
  yawn: (k) => k.tone('square', 700, 0.15, { gain: 0.018, dur: 0.5, to: 330, lp: 1800, pan: 0.6, attack: 0.06 })
}

// ───────────────────────── «Капля» ─────────────────────────
// Два физических образа. Нота меню — ханг: три обертона 1:2:3 (основной тон, октава, квинта над ней), у каждого
// пара с лёгкой расстройкой даёт мерцание, верхние гаснут быстрее; удар — глухой шумок пальца. Капля — пузырёк в воде:
// затухающий синус, высота которого за время звука растёт. Все ноты — из одной пентатоники, поэтому любая
// последовательность шагов складывается в мелодию и не бывает фальшивой.

/** До-мажорная пентатоника в полутонах от ля: C5 D5 E5 G5 A5 C6 D6 E6 */
const SCALE = [3, 5, 7, 10, 12, 15, 17, 19]
const HOME = 3
const walk = { i: HOME, at: 0, run: 0 }
/** Шаг по гамме: вверх и вправо — выше, вниз и влево — ниже; у краёв разворачивается, после паузы возвращается к середине */
function step(k: Kit) {
  const now = performance.now()
  const gap = now - walk.at
  walk.at = now
  if (gap > 1400) walk.i = HOME
  // Быстрая прокрутка: подряд идущие шаги тише и короче, чтобы не сливались в трель
  walk.run = gap < 140 ? Math.min(4, walk.run + 1) : 0
  const d = k.dir === 'up' || k.dir === 'right' ? 1 : k.dir === 'down' || k.dir === 'left' ? -1 : 0
  walk.i += d
  if (walk.i < 0 || walk.i >= SCALE.length) walk.i = Math.max(1, Math.min(SCALE.length - 2, walk.i - 2 * d))
  return walk.i
}
const deg = (k: Kit, i: number) => k.n(SCALE[Math.max(0, Math.min(SCALE.length - 1, i))])

/**
 * Нота ханга. mute — приглушённая ладонью: только основной тон, коротко; lite — облегчённая (для россыпей и эха):
 * три обертона без шума удара
 */
function pan1(k: Kit, f: number, start: number, gain: number, o: { dur?: number; pan?: number; space?: number; room?: number; mute?: boolean; lite?: boolean } = {}) {
  const dur = o.dur ?? 0.5
  const io = { pan: o.pan, room: o.room ?? 0.25, space: o.space }
  if (!o.lite) k.burst(start, { gain: gain * (o.mute ? 0.5 : 0.3), dur: 0.016, type: 'lowpass', freq: Math.min(2600, f * 2.2), pan: o.pan, attack: 0.0008 })
  if (o.mute) return k.tone('sine', f, start, { pan: o.pan, room: io.room, attack: 0.002, gain, dur: Math.min(dur, 0.09), lp: f * 3 })
  const parts = [
    { f, gain, dur },
    { f: f * 1.003, gain: gain * 0.45, dur: dur * 0.9 },
    { f: f * 2, gain: gain * 0.42, dur: dur * 0.55 }
  ]
  if (!o.lite) parts.push({ f: f * 2.006, gain: gain * 0.18, dur: dur * 0.5 }, { f: f * 3, gain: gain * 0.2, dur: dur * 0.3 })
  k.strike(parts, start, io)
}
/** Капля: тон растёт в rise раз и гаснет; rise меньше единицы — «бульк» вниз */
const bloop = (k: Kit, f: number, start: number, gain: number, rise = 1.55, dur = 0.085, pan = 0, space = 0.15) =>
  k.tone('sine', f, start, { gain, dur, to: f * rise, pan, room: 0.3, space, attack: 0.004 })
/** Голос Тиви: два булька, второй выше */
const blub = (k: Kit, start: number, f: number, gain = 0.05, pan = 0.6) => {
  bloop(k, f, start, gain, 1.5, 0.08, pan, 0.25)
  bloop(k, f * 1.5, start + 0.11, gain * 0.9, 1.45, 0.1, pan, 0.3)
}
/** Эхо: повторы тише и по очереди слева и справа */
const echo = (times: number, gap: number, fn: (start: number, gain: number, pan: number, lite: boolean) => void) => {
  for (let i = 0; i < times; i++) fn(i * gap, Math.pow(0.42, i), i === 0 ? 0 : i % 2 ? 0.55 : -0.55, i > 0)
}
/** Дождь по гамме: ноты ханга сверху вниз, россыпью по стерео */
const drizzle = (k: Kit, start: number, span: number, count: number, gain: number, top = 7) => {
  for (let i = 0; i < count; i++) {
    const p = i / (count - 1)
    const d = Math.round(top - p * top + (rnd(i + 3) - 0.5) * 2.2)
    pan1(k, deg(k, d) * (rnd(i) > 0.75 ? 2 : 1), start + p * span + rnd(i + 40) * 0.035, gain * (0.55 + rnd(i + 9) * 0.45), { dur: 0.45, pan: rnd(i + 20) * 1.5 - 0.75, space: 0.5, lite: true })
  }
}

const drop: SoundSet = {
  move: (k) => {
    const i = step(k)
    pan1(k, deg(k, i), 0, 0.036 * Math.pow(0.86, walk.run), { dur: walk.run ? 0.2 : 0.34, pan: k.pan })
  },
  bump: (k) => {
    pan1(k, k.n(-19), 0, 0.06, { mute: true, pan: k.pan * 1.6 })
    k.tone('sine', 95, 0, { gain: 0.04, dur: 0.14, to: 60, pan: k.pan * 1.6, room: 0.15 })
  },
  tab: (k) => {
    const right = k.dir !== 'left'
    k.air(0, 0.22, 0.014, right ? 700 : 2200, right ? 2200 : 700, 0.3, right ? 0.4 : -0.4)
    pan1(k, deg(k, right ? 2 : 4), 0.02, 0.026, { dur: 0.3, pan: right ? 0.15 : -0.15 })
    pan1(k, deg(k, right ? 4 : 2), 0.09, 0.03, { dur: 0.45, pan: right ? 0.4 : -0.4, space: 0.2 })
    walk.i = HOME
  },
  adjust: (k) => bloop(k, k.dir === 'left' ? 520 : 700, 0, 0.06, k.dir === 'left' ? 0.72 : 1.45, 0.07, k.pan),
  toggle: (k) => drop.toggleOn!(k),
  // Включить — капля вверх, выключить — бульк вниз
  toggleOn: (k) => {
    bloop(k, 440, 0, 0.065, 1.9, 0.11, 0.1, 0.25)
    pan1(k, deg(k, 5), 0.09, 0.03, { dur: 0.4, pan: 0.15, space: 0.3 })
  },
  toggleOff: (k) => {
    bloop(k, 760, 0, 0.06, 0.5, 0.12, -0.1, 0.2)
    pan1(k, deg(k, 1), 0.1, 0.026, { dur: 0.3, pan: -0.15, space: 0.2 })
  },
  // Выбор: текущая нота и квинтовый шаг над ней, с эхом
  select: (k) => {
    const i = Math.min(walk.i, 4)
    pan1(k, deg(k, i), 0, 0.04, { dur: 0.6, space: 0.3 })
    echo(3, 0.13, (t, g, p, lite) => pan1(k, deg(k, i + 3), 0.06 + t, 0.034 * g, { dur: 0.75, pan: p, space: 0.45, lite }))
  },
  back: (k) => {
    const i = Math.max(walk.i, 3)
    pan1(k, deg(k, i), 0, 0.034, { dur: 0.3, pan: 0.06, space: 0.2 })
    pan1(k, deg(k, i - 3), 0.07, 0.034, { dur: 0.45, pan: -0.06, space: 0.25 })
  },
  // Ошибка — не гудок, а тот же инструмент, прижатый ладонью: два глухих стука
  error: (k) => {
    pan1(k, k.n(-12), 0, 0.09, { mute: true })
    pan1(k, k.n(-14), 0.14, 0.09, { mute: true })
    k.tone('sine', k.n(-26), 0.14, { gain: 0.06, dur: 0.22, room: 0.2 })
  },
  shuffle: (k) => {
    ;[2, 6, 1, 5, 3, 7, 4].forEach((d, i) => bloop(k, deg(k, d), i * 0.05, 0.04, 1.4, 0.06, (i % 2 ? 0.4 : -0.4) * (1 - i / 7)))
    echo(3, 0.15, (t, g, p, lite) => pan1(k, deg(k, 5), 0.4 + t, 0.042 * g, { dur: 0.9, pan: p, space: 0.5, lite }))
  },
  launch: (k) => {
    // Вода набирается: низкий гул растёт, ханг разгоняется вверх по гамме, наверху — большая капля и аккорд
    k.tone('sine', 55, 0, { gain: 0.05, dur: 1.3, to: 110, space: 0.3, attack: 0.5 })
    k.air(0, 1.2, 0.03, 220, 4200, 0.5)
    ;[0, 0.2, 0.37, 0.51, 0.63, 0.73, 0.82, 0.9].forEach((t, i) => pan1(k, deg(k, i), 0.1 + t, 0.026 + i * 0.003, { dur: 0.9, pan: i * 0.2 - 0.7, space: 0.5, lite: true }))
    bloop(k, 300, 1.08, 0.05, 3, 0.2, 0, 0.5)
    k.pad([k.n(-21), k.n(-14), k.n(-9), k.n(-2)], 0.6, 2.4, 0.034, 1700, 0.85, 0.6)
    echo(3, 0.17, (t, g, p, lite) => pan1(k, k.n(15), 1.22 + t, 0.036 * g, { dur: 1.4, pan: p, space: 0.7, lite }))
  },
  trophy: (k) => {
    ;[3, 4, 5, 7].forEach((d, i) => pan1(k, deg(k, d), i * 0.075, 0.055, { dur: 0.8, pan: i * 0.2 - 0.3, space: 0.4 }))
    // Наверху — «поющая чаша»: три близких тона бьются друг о друга
    for (const [m, g] of [[1, 0.035], [1.004, 0.03], [2.002, 0.014]]) k.tone('sine', k.n(27) * m, 0.34, { gain: g, dur: 2.0, attack: 0.03, space: 0.8, room: 0.2 })
    ;[0.5, 0.68, 0.84, 1.02, 1.3].forEach((t, i) => bloop(k, k.n([31, 27, 34, 29, 31][i]), t, 0.018, 1.25, 0.07, i % 2 ? 0.6 : -0.6, 0.7))
  },
  boot: (k) => {
    // Под интро: 0,08 с — глухой удар включения и нарастающий гул; 0,65–1,55 с — название проявляется дождём:
    // сверху вниз по гамме сыплются ноты; 1,12 с — волна мельтешения: рой мелких капель и низкая тоника;
    // дальше аккорд и две ноты приветствия
    k.tone('sine', 82, 0.08, { gain: 0.07, dur: 0.5, to: 41, room: 0.2 })
    k.tone('sine', 55, 0.1, { gain: 0.04, dur: 1.1, attack: 0.95, space: 0.4 })
    k.air(0.15, 0.9, 0.024, 260, 3200, 0.9)
    drizzle(k, 0.65, 0.9, 15, 0.04)
    for (let i = 0; i < 16; i++) bloop(k, deg(k, 4 + Math.floor(rnd(i + 70) * 4)) * 2, 1.12 + rnd(i + 80) * 0.55, 0.012, 1.3, 0.045, rnd(i + 90) * 1.6 - 0.8, 0.6)
    k.bell(k.n(-33), 1.12, { gain: 0.07, dur: 1.9, space: 0.5, ratio: 1, index: 0.25 })
    k.pad([k.n(-33), k.n(-26), k.n(-21), k.n(-17), k.n(-14)], 0.9, 3.3, 0.04, 1300, 0.85, 0.9)
    echo(3, 0.19, (t, g, p, lite) => pan1(k, k.n(10), 1.36 + t, 0.045 * g, { dur: 1.6, pan: p, space: 0.7, lite }))
    pan1(k, k.n(15), 2.95, 0.04, { dur: 1.6, pan: -0.15, space: 0.8 })
    pan1(k, k.n(22), 3.13, 0.034, { dur: 1.9, pan: 0.2, space: 0.8 })
  },
  farewell: (k) => {
    k.pad([k.n(-26), k.n(-21), k.n(-17), k.n(-14)], 0, 2.1, 0.04, 1100, 0.8, 0.25)
    ;[7, 5, 3, 2, 0].forEach((d, i) => pan1(k, deg(k, d), 0.05 + i * 0.16, 0.034, { dur: 1.2, pan: 0.5 - i * 0.25, space: 0.7 }))
    // Экран сжимается в точку — последняя капля падает вниз
    bloop(k, 700, 1.15, 0.045, 0.12, 0.4, 0, 0.5)
    k.tone('sine', k.n(-33), 1.3, { gain: 0.06, dur: 1.2, space: 0.5 })
  },
  shutdown: (k) => {
    k.pad([k.n(-29), k.n(-24), k.n(-21), k.n(-17)], 0, 2.6, 0.042, 900, 0.85, 0.3)
    ;[5, 3, 2, 0].forEach((d, i) => pan1(k, deg(k, d) / 2, 0.1 + i * 0.24, 0.038, { dur: 1.5, pan: 0.4 - i * 0.25, space: 0.75 }))
    bloop(k, 800, 1.6, 0.06, 0.08, 0.45, 0, 0.5)
    k.bell(k.n(-38), 1.78, { gain: 0.08, dur: 1.6, space: 0.4, ratio: 1, index: 0.15 })
  },
  installed: (k) => {
    k.pad([k.n(-21), k.n(-14), k.n(-9), k.n(-5)], 0, 1.9, 0.032, 1600, 0.75, 0.25)
    ;[1, 3, 4, 5].forEach((d, i) => pan1(k, deg(k, d), 0.02 + i * 0.08, 0.036, { dur: 1.0, pan: i * 0.25 - 0.35, space: 0.5 }))
    blub(k, 0.42, 620, 0.036, 0)
    echo(3, 0.16, (t, g, p, lite) => pan1(k, k.n(27), 0.7 + t, 0.035 * g, { dur: 1.3, pan: p, space: 0.8, lite }))
  },
  // Искры слетаются в угол — мелкие капли всё выше и правее; Тиви собрался и сказал «буль-буль»
  arrive: (k) => {
    for (let i = 0; i < 10; i++) bloop(k, deg(k, i % 8) * (i > 7 ? 2 : 1) * 1.5, i * 0.065, 0.016, 1.3, 0.05, -0.3 + i * 0.1, 0.5)
    blub(k, 1.55, 560, 0.05, 0.6)
  },
  // Зевок: один долгий бульк вниз
  yawn: (k) => {
    k.tone('sine', 640, 0.15, { gain: 0.034, dur: 0.55, to: 260, pan: 0.6, room: 0.3, space: 0.2, attack: 0.09 })
    bloop(k, 300, 0.72, 0.03, 0.7, 0.12, 0.6)
  }
}

/**
 * Основной набор PlayOS — собран по звуку из разных наборов (выбор пользователя, 2026-11-12): почти всё «мягкое»,
 * упор остался стеклянным (его здесь нет — играет исходный из sound.ts), подстройка и появление Тиви — «8 бит»,
 * трофей — «Капля», зевок Тиви — «Кинескоп»
 */
const { bump: _softBump, ...softRest } = soft
const main: SoundSet = { ...softRest, adjust: chip.adjust, arrive: chip.arrive, trophy: drop.trophy, yawn: crt.yawn }

export const SETS: Record<SetName, SoundSet> = { main, glass: {}, crt, soft, chip, drop }
