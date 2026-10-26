import type { PadAction, SoundVolume } from '@shared/types'

/**
 * Звуковой дизайн PlayOS: всё синтезируется на лету через WebAudio, без файлов.
 *
 * Палитра: «стеклянные» тапы (синус с неоднородным обертоном, как у маримбы, и коротким
 * воздушным транзиентом), FM-колокольчики, мягкие пэды и шумовые «вздохи».
 * Пространство: короткая «комната» для навигации и длинный «зал» для колокольчиков —
 * так быстрые щелчки остаются сухими и чёткими, а важные моменты звучат объёмно.
 * Навигация пространственная: шаг влево слышен левее, вверх — выше по тону.
 */

export type SoundKind =
  | 'move'
  | 'bump'
  | 'tab'
  | 'select'
  | 'back'
  | 'toggleOn'
  | 'toggleOff'
  | 'adjust'
  | 'launch'
  | 'error'
  | 'boot'
  | 'toggle'
  | 'trophy'
  | 'shuffle'
  | 'farewell'
  | 'shutdown'

const VOLUME: Record<SoundVolume, number> = { low: 0.45, mid: 0.8, high: 1.25 }

let ctx: AudioContext | null = null
let master: GainNode | null = null
/** Выход после мастер-громкости: музыка идёт сюда, мимо громкости звуков интерфейса */
let post: AudioNode | null = null
let dry: GainNode | null = null
let room: GainNode | null = null
let wet: GainNode | null = null
let enabled = true
let volume: SoundVolume = 'mid'
let lastMove = 0
/** Последнее направление навигации — для панорамы и высоты тапа */
let lastDir: 'up' | 'down' | 'left' | 'right' | null = null

/** Ввод сообщает, какое действие сейчас обрабатывается (см. input.ts) */
export function noteAction(a: PadAction) {
  lastDir = a === 'up' || a === 'down' || a === 'left' || a === 'right' ? a : null
}

const dirPan = () => (lastDir === 'left' ? -0.32 : lastDir === 'right' ? 0.32 : 0)

/**
 * Импульс пространства: стереошум с затуханием, а высокие частоты гаснут быстрее низких —
 * хвост звучит тёпло, как настоящий зал, а не «шипит».
 */
function impulse(c: AudioContext, seconds: number, decay: number, damping: number) {
  const len = Math.floor(c.sampleRate * seconds)
  const buf = c.createBuffer(2, len, c.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch)
    let lp = 0
    for (let i = 0; i < len; i++) {
      const p = i / len
      // Сглаживание усиливается к концу хвоста — эквивалент затухания высоких
      const k = Math.min(0.97, damping + p * (0.97 - damping))
      lp = lp * k + (Math.random() * 2 - 1) * (1 - k)
      data[i] = lp * Math.pow(1 - p, decay) * (1 + 3 * (1 - k))
    }
  }
  return buf
}

function audio() {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'interactive' })
    master = ctx.createGain()
    master.gain.value = VOLUME[volume]
    // Мягкая «полировка»: чуть приглушаем самый верх и сглаживаем пики
    const shelf = ctx.createBiquadFilter()
    shelf.type = 'highshelf'
    shelf.frequency.value = 7500
    shelf.gain.value = -3
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -16
    comp.knee.value = 12
    comp.ratio.value = 3
    comp.attack.value = 0.004
    comp.release.value = 0.18
    master.connect(shelf).connect(comp).connect(ctx.destination)
    post = shelf
    dry = ctx.createGain()
    dry.connect(master)
    const roomVerb = ctx.createConvolver()
    roomVerb.buffer = impulse(ctx, 0.9, 4.5, 0.5)
    room = ctx.createGain()
    room.gain.value = 0.7
    room.connect(roomVerb).connect(master)
    const hall = ctx.createConvolver()
    hall.buffer = impulse(ctx, 3.2, 3, 0.35)
    wet = ctx.createGain()
    wet.gain.value = 0.85
    wet.connect(hall).connect(master)
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return { c: ctx, dry: dry!, wet: wet! }
}

export function setSoundEnabled(v: boolean) {
  enabled = v
}

export function setVolume(v: SoundVolume) {
  volume = v
  if (master && ctx) master.gain.setTargetAtTime(VOLUME[v], ctx.currentTime, 0.05)
}

export function previewVolume(v: SoundVolume) {
  setVolume(v)
  play('select')
}

interface VoiceOpts {
  gain: number
  dur: number
  /** Доля в «зал» */
  space?: number
  /** Доля в «комнату» */
  room?: number
  attack?: number
  /** Панорама −1…1 */
  pan?: number
}

function out(c: AudioContext, node: AudioNode, t: number, o: VoiceOpts) {
  const env = c.createGain()
  env.gain.setValueAtTime(0.0001, t)
  env.gain.exponentialRampToValueAtTime(o.gain, t + (o.attack ?? 0.005))
  env.gain.exponentialRampToValueAtTime(0.0001, t + o.dur)
  node.connect(env)
  let tail: AudioNode = env
  if (o.pan) {
    const p = c.createStereoPanner()
    p.pan.value = Math.max(-1, Math.min(1, o.pan))
    env.connect(p)
    tail = p
  }
  tail.connect(dry!)
  if (o.space) {
    const send = c.createGain()
    send.gain.value = o.space
    tail.connect(send).connect(wet!)
  }
  if (o.room) {
    const send = c.createGain()
    send.gain.value = o.room
    tail.connect(send).connect(room!)
  }
}

/** FM-колокольчик: модулятор с затухающим индексом даёт «стеклянный» тембр. */
function bell(freq: number, start: number, o: VoiceOpts & { ratio?: number; index?: number }) {
  const { c } = audio()
  const t = c.currentTime + start
  const car = c.createOscillator()
  const mod = c.createOscillator()
  const modGain = c.createGain()
  car.frequency.value = freq
  mod.frequency.value = freq * (o.ratio ?? 3.5)
  const index = freq * (o.index ?? 1.2)
  modGain.gain.setValueAtTime(index, t)
  modGain.gain.exponentialRampToValueAtTime(Math.max(1, index * 0.04), t + o.dur * 0.6)
  mod.connect(modGain).connect(car.frequency)
  out(c, car, t, { attack: 0.003, ...o })
  car.start(t)
  mod.start(t)
  car.stop(t + o.dur + 0.05)
  mod.stop(t + o.dur + 0.05)
}

let noiseBuf: AudioBuffer | null = null
function noise(c: AudioContext) {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate)
    const d = noiseBuf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  }
  return noiseBuf
}

/**
 * «Стеклянный» тап для навигации: основной тон с лёгким «подъездом» высоты,
 * неоднородный обертон (×2.76, как у маримбы), гаснущий за 40 мс, и воздушный щелчок.
 */
function tap(freq: number, start: number, gain: number, pan = 0, room = 0.22) {
  const { c } = audio()
  const t = c.currentTime + start
  const body = c.createOscillator()
  body.type = 'sine'
  body.frequency.setValueAtTime(freq * 1.025, t)
  body.frequency.exponentialRampToValueAtTime(freq, t + 0.018)
  out(c, body, t, { gain, dur: 0.11, room, attack: 0.0015, pan })
  body.start(t)
  body.stop(t + 0.13)
  const partial = c.createOscillator()
  partial.type = 'sine'
  partial.frequency.value = freq * 2.76
  out(c, partial, t, { gain: gain * 0.28, dur: 0.04, attack: 0.001, pan })
  partial.start(t)
  partial.stop(t + 0.06)
  const click = c.createBufferSource()
  click.buffer = noise(c)
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 5200
  bp.Q.value = 0.9
  click.connect(bp)
  out(c, bp, t, { gain: gain * 0.35, dur: 0.012, attack: 0.0008, pan })
  click.start(t, Math.random() * 0.5)
  click.stop(t + 0.02)
}

/** Мягкий низкий «упор» — дальше двигаться некуда */
function thud(start: number, gain: number, pan = 0) {
  const { c } = audio()
  const t = c.currentTime + start
  const o = c.createOscillator()
  o.type = 'sine'
  o.frequency.setValueAtTime(150, t)
  o.frequency.exponentialRampToValueAtTime(70, t + 0.12)
  out(c, o, t, { gain, dur: 0.16, room: 0.15, attack: 0.002, pan })
  o.start(t)
  o.stop(t + 0.18)
}

/** Шумовой «вздох»: полосовой фильтр едет от from к to */
function air(start: number, dur: number, gain: number, from: number, to: number, space = 0.6, pan = 0) {
  const { c } = audio()
  const t = c.currentTime + start
  const src = c.createBufferSource()
  src.buffer = noise(c)
  src.loop = true
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.Q.value = 1.1
  bp.frequency.setValueAtTime(from, t)
  bp.frequency.exponentialRampToValueAtTime(to, t + dur)
  src.connect(bp)
  out(c, bp, t, { gain, dur, space, attack: dur * 0.45, pan })
  src.start(t, Math.random() * 0.5)
  src.stop(t + dur + 0.05)
}

/** Тёплый пэд: пары слегка расстроенных треугольных волн через фильтр. */
function pad(freqs: number[], start: number, dur: number, gain: number, cutoff = 1400, space = 0.7, attack = 0.6) {
  const { c } = audio()
  const t = c.currentTime + start
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(cutoff * 0.5, t)
  lp.frequency.exponentialRampToValueAtTime(cutoff, t + attack * 1.5)
  out(c, lp, t, { gain, dur, space, attack })
  freqs.forEach((f, i) => {
    for (const detune of [-7, 7]) {
      const osc = c.createOscillator()
      osc.type = 'triangle'
      osc.frequency.value = f
      osc.detune.value = detune
      // Голоса аккорда слегка разнесены по стерео — пэд звучит шире
      const p = c.createStereoPanner()
      p.pan.value = (i / Math.max(1, freqs.length - 1) - 0.5) * 0.6 * Math.sign(detune)
      osc.connect(p).connect(lp)
      osc.start(t)
      osc.stop(t + dur + 0.1)
    }
  })
}

const n = (semitonesFromA4: number) => 440 * Math.pow(2, semitonesFromA4 / 12)
// Ноты, которые используются чаще всего
const C5 = n(3)
const E5 = n(7)
const G5 = n(10)
const B5 = n(14)
const C6 = n(15)
const D6 = n(17)
const E6 = n(19)
const G6 = n(22)
const A6 = n(24)
const B6 = n(26)
const C7 = n(27)
const E7 = n(31)

/** Арпеджио колокольчиков, разложенное по стерео слева направо */
function arp(notes: number[], start: number, step: number, o: VoiceOpts & { ratio?: number; index?: number }, spread = 0.5) {
  notes.forEach((f, i) => bell(f, start + i * step, { ...o, pan: (i / Math.max(1, notes.length - 1) - 0.5) * spread }))
}

export function play(kind: SoundKind) {
  if (!enabled) return
  try {
    switch (kind) {
      case 'move': {
        const now = performance.now()
        if (now - lastMove < 32) return
        lastMove = now
        // Вверх чуть выше, вниз чуть ниже, разброс ±1% — серия шагов звучит живо, а не как метроном
        const base = lastDir === 'up' ? 1290 : lastDir === 'down' ? 1080 : 1180
        tap(base * (1 + (Math.random() - 0.5) * 0.02), 0, 0.05, dirPan())
        break
      }
      case 'bump':
        thud(0, 0.07, dirPan() * 1.6)
        tap(620, 0.005, 0.018, dirPan() * 1.6, 0.1)
        break
      case 'tab': {
        const right = lastDir !== 'left'
        air(0, 0.22, 0.022, right ? 900 : 2600, right ? 2600 : 900, 0.2, right ? 0.4 : -0.4)
        tap(right ? 1480 : 1320, 0.03, 0.04, right ? 0.3 : -0.3)
        break
      }
      case 'adjust':
        tap(lastDir === 'left' ? 1420 : 1640, 0, 0.045, dirPan(), 0.12)
        break
      case 'toggle':
      case 'toggleOn':
        // Включение: два тапа вверх
        tap(1320, 0, 0.045, 0.1)
        tap(1980, 0.05, 0.04, 0.15)
        break
      case 'toggleOff':
        // Выключение: два тапа вниз, тише
        tap(1760, 0, 0.04, -0.1)
        tap(1180, 0.05, 0.035, -0.15)
        break
      case 'select':
        tap(1580, 0, 0.035, 0, 0.1)
        bell(E6, 0.008, { gain: 0.055, dur: 0.6, space: 0.3, room: 0.2, ratio: 2, index: 0.7, pan: -0.08 })
        bell(B6, 0.05, { gain: 0.042, dur: 0.75, space: 0.4, ratio: 2, index: 0.55, pan: 0.1 })
        break
      case 'back':
        tap(1100, 0, 0.03, 0, 0.1)
        bell(B5, 0.005, { gain: 0.042, dur: 0.32, space: 0.22, room: 0.2, ratio: 2, index: 0.6, pan: 0.06 })
        bell(E5, 0.055, { gain: 0.04, dur: 0.42, space: 0.25, ratio: 2, index: 0.5, pan: -0.06 })
        break
      case 'error':
        // Глухое «нет»: два мягких низких тона с лёгким биением, без резкости
        bell(n(-9), 0, { gain: 0.07, dur: 0.24, space: 0.15, room: 0.2, ratio: 1.0, index: 0.9 })
        bell(n(-9) * 1.012, 0, { gain: 0.04, dur: 0.24, ratio: 1.0, index: 0.9 })
        bell(n(-13), 0.13, { gain: 0.07, dur: 0.34, space: 0.2, room: 0.2, ratio: 1.0, index: 0.9 })
        break
      case 'shuffle':
        ;[0, 0.065, 0.12, 0.17, 0.21, 0.25].forEach((t, i) => tap(900 + i * 150, t, 0.04, (i % 2 ? 0.3 : -0.3) * (1 - i / 6)))
        bell(G6, 0.33, { gain: 0.06, dur: 0.9, space: 0.5, ratio: 2 })
        bell(D6, 0.35, { gain: 0.03, dur: 0.9, space: 0.5, ratio: 2, pan: -0.2 })
        break
      case 'launch':
        // Взлёт: шумовой подъём, раскрывающийся аккорд и арпеджио слева направо
        air(0, 1.3, 0.045, 260, 6500, 0.5)
        pad([n(-21), n(-14), n(-9), n(-2)], 0.05, 2.6, 0.032, 1900, 0.8, 0.45)
        arp([C5, E5, G5, B5, D6, G6], 0.12, 0.065, { gain: 0.042, dur: 1.5, space: 0.6, ratio: 2, index: 0.65 }, 0.8)
        break
      case 'trophy':
        // Трофей: яркое восходящее трезвучие, затем высокий «блеск» с мерцанием
        arp([C6, E6, G6], 0, 0.06, { gain: 0.058, dur: 0.7, space: 0.4, ratio: 3, index: 0.85 }, 0.5)
        bell(C7, 0.2, { gain: 0.07, dur: 1.8, space: 0.65, ratio: 3, index: 1 })
        bell(E7, 0.32, { gain: 0.022, dur: 1.4, space: 0.8, ratio: 1.5, index: 0.4, pan: 0.35 })
        air(0.18, 0.9, 0.012, 5000, 9000, 0.8, 0.2)
        break
      case 'farewell':
        // Выход из PlayOS: зеркало интро — колокольчики вниз справа налево, пэд гаснет вместе с кольцом логотипа
        pad([n(-26), n(-21), n(-17), n(-14)], 0, 2.2, 0.035, 1100, 0.8, 0.25)
        arp([G6, E6, C6, G5], 0.05, 0.13, { gain: 0.04, dur: 1.8, space: 0.75, ratio: 2, index: 0.5 }, -0.6)
        air(1.0, 0.45, 0.02, 2800, 400, 0.5)
        bell(n(-33), 1.25, { gain: 0.05, dur: 1.4, space: 0.5, ratio: 1, index: 0.2 })
        break
      case 'shutdown':
        // Выключение ПК: медленный спуск, затем низкий удар, когда экран схлопывается в линию (≈1,75 с)
        pad([n(-29), n(-24), n(-21), n(-17)], 0, 2.6, 0.04, 900, 0.85, 0.3)
        arp([C6, G5, E5, C5], 0.1, 0.22, { gain: 0.035, dur: 2, space: 0.8, ratio: 2, index: 0.45 }, -0.5)
        air(1.55, 0.35, 0.03, 4200, 300, 0.5)
        bell(n(-38), 1.75, { gain: 0.08, dur: 1.6, space: 0.4, ratio: 1, index: 0.15 })
        bell(E7, 1.78, { gain: 0.012, dur: 0.5, space: 0.6, ratio: 1, index: 0.1 })
        break
      case 'boot':
        // Синхронизировано с интро: искра (0,12 с) → кольцо рисуется на подъёме пэда и шумового «вдоха»
        // → в 1,12 с «включение»: низкий удар, аккорд слева направо → в 2,35 с блик по названию
        bell(E7, 0.12, { gain: 0.016, dur: 0.6, space: 0.9, ratio: 1, index: 0.2, pan: 0.3 })
        pad([n(-33), n(-26), n(-21), n(-17), n(-14)], 0, 3.8, 0.045, 1200, 0.85, 1.2)
        air(0.2, 0.95, 0.03, 250, 3600, 0.9)
        bell(n(-33), 1.1, { gain: 0.075, dur: 1.9, space: 0.5, ratio: 1, index: 0.25 })
        arp([G5, C6, E6, G6], 1.12, 0.06, { gain: 0.04, dur: 2.2, space: 0.75, ratio: 2, index: 0.5 }, 0.7)
        bell(A6, 1.4, { gain: 0.014, dur: 2, space: 0.9, ratio: 2, index: 0.3, pan: -0.3 })
        bell(C7, 2.35, { gain: 0.03, dur: 2.4, space: 0.9, ratio: 3, index: 0.6, pan: 0.25 })
        break
    }
  } catch {
    /* аудио недоступно — тихо работаем дальше */
  }
}

// ───────────────────────── Фоновая музыка ─────────────────────────

/**
 * Генеративный эмбиент: медленная смена мягких аккордов и редкие колокольчики
 * из пентатоники. Каждый раз звучит немного по-разному.
 */

const CHORDS = [
  [-19, -12, -7, -3, 2], // Dmaj9
  [-22, -15, -10, -5, -1], // Bm9
  [-26, -19, -14, -10, -5], // Gmaj9
  [-24, -17, -12, -8, -3] // A6/9
]
const SPARKLE = [17, 19, 21, 24, 26, 29, 31] // D6 E6 F#6 A6 B6 D7 E7

// Уровень музыки на выходе; «средне» — как было, пока музыка шла через мастер-громкость
const MUSIC: Record<SoundVolume, number> = { low: 0.22, mid: 0.44, high: 0.7 }
let musicLevel: SoundVolume = 'mid'
let musicOn = false
let musicHold = false
let musicGain: GainNode | null = null
let chordTimer: number | undefined
let sparkleTimer: number | undefined
let chordIndex = 0

function musicBus() {
  const { c, wet: w } = audio()
  if (!musicGain) {
    musicGain = c.createGain()
    musicGain.gain.value = 0.0001
    const lp = c.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 2200
    musicGain.connect(lp).connect(post!)
    const send = c.createGain()
    send.gain.value = 0.9
    lp.connect(send).connect(w)
  }
  return { c, bus: musicGain }
}

function musicChord() {
  const { c, bus } = musicBus()
  const t = c.currentTime + 0.05
  const notes = CHORDS[chordIndex++ % CHORDS.length]
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 700
  // Медленное «дыхание» фильтра
  const lfo = c.createOscillator()
  const lfoGain = c.createGain()
  lfo.frequency.value = 0.06 + Math.random() * 0.04
  lfoGain.gain.value = 320
  lfo.connect(lfoGain).connect(lp.frequency)
  const env = c.createGain()
  env.gain.setValueAtTime(0.0001, t)
  env.gain.exponentialRampToValueAtTime(0.05, t + 3.5)
  env.gain.setValueAtTime(0.05, t + 8)
  env.gain.exponentialRampToValueAtTime(0.0001, t + 13)
  lp.connect(env).connect(bus)
  for (const s of notes) {
    for (const detune of [-6, 6]) {
      const osc = c.createOscillator()
      osc.type = s < -20 ? 'sine' : 'triangle'
      osc.frequency.value = n(s)
      osc.detune.value = detune + (Math.random() - 0.5) * 4
      osc.connect(lp)
      osc.start(t)
      osc.stop(t + 13.2)
    }
  }
  lfo.start(t)
  lfo.stop(t + 13.2)
  chordTimer = window.setTimeout(musicChord, 9000)
}

function musicSparkle() {
  const { c, bus } = musicBus()
  const t = c.currentTime + 0.05
  const f = n(SPARKLE[Math.floor(Math.random() * SPARKLE.length)])
  const car = c.createOscillator()
  const mod = c.createOscillator()
  const mg = c.createGain()
  car.frequency.value = f
  mod.frequency.value = f * 2
  mg.gain.setValueAtTime(f * 0.5, t)
  mg.gain.exponentialRampToValueAtTime(1, t + 2)
  mod.connect(mg).connect(car.frequency)
  const env = c.createGain()
  env.gain.setValueAtTime(0.0001, t)
  env.gain.exponentialRampToValueAtTime(0.018, t + 0.01)
  env.gain.exponentialRampToValueAtTime(0.0001, t + 3)
  car.connect(env).connect(bus)
  car.start(t)
  mod.start(t)
  car.stop(t + 3.1)
  mod.stop(t + 3.1)
  sparkleTimer = window.setTimeout(musicSparkle, 2500 + Math.random() * 4500)
}

function updateMusic() {
  const shouldPlay = musicOn && !musicHold && document.visibilityState === 'visible'
  try {
    if (shouldPlay && chordTimer === undefined) {
      const { c, bus } = musicBus()
      bus.gain.cancelScheduledValues(c.currentTime)
      bus.gain.setTargetAtTime(MUSIC[musicLevel], c.currentTime, 1.2)
      musicChord()
      sparkleTimer = window.setTimeout(musicSparkle, 3000)
    } else if (!shouldPlay && chordTimer !== undefined) {
      clearTimeout(chordTimer)
      clearTimeout(sparkleTimer)
      chordTimer = sparkleTimer = undefined
      if (musicGain && ctx) musicGain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.6)
    }
  } catch {
    /* аудио недоступно */
  }
}

document.addEventListener('visibilitychange', updateMusic)

export function setMusic(on: boolean) {
  musicOn = on
  updateMusic()
}

export function setMusicVolume(v: SoundVolume) {
  musicLevel = v
  if (musicGain && ctx && chordTimer !== undefined) musicGain.gain.setTargetAtTime(MUSIC[v], ctx.currentTime, 0.3)
}

/** Приглушить музыку (запущена игра, открыт экран запуска) */
export function holdMusic(hold: boolean) {
  musicHold = hold
  updateMusic()
}
