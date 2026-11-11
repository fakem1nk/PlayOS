import { memo, useEffect, useRef, useState } from 'react'
import { idleFor, onActivity, usePadInfo } from '../lib/input'
import { play } from '../lib/sound'
import { usePadStatus, useVrQuest } from '../lib/state'
import { onTivi, tivi, type TiviReaction } from '../lib/tivi'
import {
  BASE,
  CLICK_ACTS,
  COLORS,
  COLS,
  DROWSY_ACTS,
  EAR_TICK_MS,
  EARS_IDLE,
  FREE,
  IDLE_ACTS,
  MORNING_ACTS,
  ROWS,
  SCRIPTS,
  SLOSH_TICKS,
  SPRITES,
  STATIC_EARS,
  earProgramOf,
  earsOf,
  loadFace,
  sloshed,
  type Ear,
  type EarProgramName,
  type Ears,
  type Frame,
  type Fx,
  type Gaze,
  type Grid,
  type Pose,
  type Script,
  type ScriptName,
  type Sprite,
  type TiviMove
} from '../lib/tivi-faces'
import { useUpdate } from '../lib/update'
import type { Settings } from '@shared/types'
import { t } from '@shared/i18n'
import '../styles-tivi.css'

/**
 * Тиви — маскот PlayOS в правом нижнем углу.
 * Лицо — светодиодная матрица 15×8, как цифры часов: кадры сменяются мгновенно, без плавных переходов.
 * Над и под матрицей — полосы по 14 точек со сдвигом на полшага: нижняя показывает загрузку обновления.
 * Вместо антенн — уши-капсулы со светящейся «жидкостью»: у каждой сценки своя программа (tivi-faces.ts),
 * в покое оба уха залиты полностью, от прыжков и рывков жидкость плещется.
 * Следит глазами за фокусом, а пока двигается мышь — за ней; моргает; в покое сам себя развлекает (сценки в tivi-faces.ts).
 * На клик подмигивает и каждый раз отвечает по-новому, если кликать без конца — ему становится дурно.
 * Радуется запуску игры, грустит от ошибок, влюбляется в трофеи, засыпает при бездействии.
 * Здоровается в первый запуск за день, утром потягивается, после полуночи надевает колпак и чаще зевает,
 * любит, когда его гладят (зажать на нём и водить), пока качается обновление — показывает полоску загрузки.
 */

const PITCH = 11.5
const DOT = 4.4
// Центр экрана в координатах образца 256 (корпус 22,76 212×148, экран с рамкой 12)
const CX = 128
const CY = 150
/** Пиксель значков вокруг корпуса (zZ, сердечки) */
const PX = 7
const BODY = '#1a1e27'
const INSET = '#05070c'
/** Ухо — короткая толстая капсула 38×50 (до поворота), окошко с жидкостью 22×30, от y 46 до 76 */
const EAR_W = 38
const EAR_TOP = 40
const EAR_TILT = 20
const WIN_W = 22
const WIN_TOP = 46
const WIN_H = 30
const WIN_BOT = WIN_TOP + WIN_H
/** Полосы над и под матрицей: на 0,9 шага от крайних рядов, по 14 точек */
const STRIP_GAP = PITCH * 0.9
const STRIP_DOTS = COLS - 1

const DROWSY_MS = 75_000
const SLEEP_MS = 240_000
// Столько после последнего движения мыши Тиви ещё смотрит на неё, потом возвращается к фокусу
const MOUSE_MS = 1600
/** Взгляд переводится по клетке за кадр, а не прыжком */
const GAZE_STEP_MS = 40
/** Своими делами Тиви занимается, только когда его давно не трогали */
const CALM_MS = 4000
const AHEAD: Gaze = { x: 0, y: 0 }
/** Когда Тиви последний раз видели: по нему он скучает или здоровается за день */
const SEEN_KEY = 'playos-tivi-seen'
const MISSED_MS = 3 * 86_400_000
/** Сколько надо провести курсором с зажатой кнопкой, чтобы это считалось поглаживанием */
const PET_PX = 24
// Моргание по кадрам: прикрыл, закрыл, прикрыл, открыл (состояние, сколько держать)
const BLINK: [number, number][] = [
  [1, 40],
  [2, 90],
  [1, 40],
  [0, 0]
]

type Stage = 'awake' | 'drowsy' | 'sleep'
type Part = 'intro' | 'loop' | 'outro'

/** Ночь — с полуночи до пяти, утро — с пяти до одиннадцати */
const isNight = (h: number) => h < 5
const isMorning = (h: number) => h >= 5 && h < 11

const readSeen = () => {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0
  } catch {
    return 0
  }
}
const markSeen = () => {
  try {
    localStorage.setItem(SEEN_KEY, String(Date.now()))
  } catch {
    /* без хранилища просто поздоровается ещё раз */
  }
}

/** Пиксельный значок в единицах образца 256 с центром в x, y */
function sprite(s: Sprite, x: number, y: number, key: string) {
  const rows = SPRITES[s]
  const x0 = x - (rows[0].length * PX) / 2
  const y0 = y - (rows.length * PX) / 2
  // Клетки одного цвета — одним контуром: отдельные квадраты на дробных пикселях расходятся щёлками (видно на картинках заставки)
  const paths = new Map<string, string>()
  rows.forEach((row, j) =>
    [...row].forEach((ch, i) => {
      if (ch !== '.') paths.set(ch, `${paths.get(ch) ?? ''}M${x0 + i * PX} ${y0 + j * PX}h${PX}v${PX}h${-PX}z`)
    })
  )
  return [...paths].map(([ch, d]) => <path key={`${key}.${ch}`} d={d} fill={COLORS[ch][0]} />)
}

/**
 * Горящие точки лица: номер точки → цвет. У простых лиц взгляд сдвигает лицо целиком: по вертикали глаза и рот вместе
 * (не наезжают друг на друга), по горизонтали рот вдвое меньше глаз — будто голова поворачивается.
 * Моргание: 1 — гаснет верхний ряд глаз, 2 — от глаз остаётся полоска внизу
 */
function paint(face: Grid, gaze: Gaze, blink: number) {
  const lit = new Map<number, string>()
  const eyes: [number, number, string][] = []
  face.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return
      const eye = y < 4
      const nx = x + (eye ? gaze.x : Math.trunc(gaze.x / 2))
      const ny = y + gaze.y
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) return
      if (eye) eyes.push([nx, ny, ch])
      else lit.set(ny * COLS + nx, ch)
    })
  )
  const top = Math.min(...eyes.map(([, y]) => y))
  const low = Math.max(...eyes.map(([, y]) => y))
  for (const [x, y, ch] of eyes) {
    if (blink === 1 && y === top && top !== low) continue
    lit.set((blink === 2 ? low : y) * COLS + x, ch)
  }
  return lit
}

/**
 * Элемент в фокусе: плитки, кнопки и вкладки подсвечиваются классом, строки настроек и окна — настоящим фокусом.
 * Активна одна зона: верхняя панель, иначе последний в документе (окна идут после экранов)
 */
function focused() {
  const bar = document.querySelector<HTMLElement>('.topbar .is-focused')
  if (bar) return bar
  const all = [...document.querySelectorAll<HTMLElement>('.is-focused')]
  const dom = document.activeElement
  if (dom instanceof HTMLElement && dom !== document.body) all.push(dom)
  let last: HTMLElement | null = null
  for (const el of all)
    if (el.getClientRects().length && (!last || last.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) last = el
  return last
}

function pick(pool: [ScriptName, number][]) {
  let r = Math.random() * pool.reduce((sum, [, w]) => sum + w, 0)
  for (const [name, w] of pool) if ((r -= w) < 0) return name
  return pool[0][0]
}

/**
 * Проигрыватель сценок: кадр за кадром по таймеру. Вступление, петля (крутится, пока не выйдет срок, хотя бы раз)
 * и концовка; без сценки — покой текущей стадии (во сне это всплывающие zZ)
 */
function createPlayer(show: (frame: Frame, act: ScriptName | null) => void) {
  let playing: { name: ScriptName; part: Part; i: number; until: number; priority: number } | null = null
  let stage: Stage = 'awake'
  let restI = 0
  let timer = 0
  const script = (name: ScriptName): Script => SCRIPTS[name]

  const render = () => {
    clearTimeout(timer)
    const rest = BASE[stage].loop!
    const frame = playing ? script(playing.name)[playing.part]![playing.i] : rest[restI % rest.length]
    show(frame, playing?.name ?? null)
    if (Number.isFinite(frame.ms)) timer = window.setTimeout(next, frame.ms)
  }
  const finish = () => {
    playing = null
    restI = 0
    render()
  }
  const next = () => {
    if (!playing) {
      restI++
      return render()
    }
    const p = playing
    const s = script(p.name)
    if (++p.i < s[p.part]!.length) return render()
    p.i = 0
    if (p.part === 'intro' && s.loop?.length) p.part = 'loop'
    else if (p.part === 'loop' && performance.now() < p.until) p.part = 'loop'
    else if (p.part !== 'outro' && s.outro?.length) p.part = 'outro'
    else return finish()
    render()
  }

  render()
  return {
    busy: () => !!playing,
    /** Насколько важна идущая сценка; -1 — ничего не идёт */
    level: () => playing?.priority ?? -1,
    /** Важная сценка не перебивается мелкой; та же самая не начинается заново, а тянется дольше */
    play(r: TiviReaction) {
      const priority = r.priority ?? 1
      const until = performance.now() + (r.ms ?? 0)
      if (playing && playing.priority > priority) return
      if (playing?.name === r.act && playing.part !== 'outro') {
        playing.until = Math.max(playing.until, until)
        return
      }
      const s = script(r.act)
      const part: Part | undefined = s.intro?.length ? 'intro' : s.loop?.length ? 'loop' : undefined
      if (!part) return
      playing = { name: r.act, part, i: 0, until, priority }
      render()
    },
    /** Тиви тронули — свои дела бросает (сценки с концовкой доигрывают её) */
    calm() {
      if (!playing || playing.priority > 0 || playing.part === 'outro') return
      if (!script(playing.name).outro?.length) return finish()
      playing.part = 'outro'
      playing.i = 0
      render()
    },
    setStage(next: Stage) {
      if (next === stage) return
      stage = next
      restI = 0
      if (!playing) render()
    },
    stop: () => clearTimeout(timer)
  }
}

/** Уши с точностью до пикселя окошка: соседние такты с одинаковой картинкой не перерисовываются */
const earKey = (e: Ears) => JSON.stringify(e, (_, v) => (typeof v === 'number' ? Math.round(v * WIN_H) : v))

/**
 * Уши живут своим тактом: программа сценки по номеру такта (сначала — с её началом) плюс плеск после рывка тела.
 * В покое и в свёрнутом окне таймер не идёт
 */
function useEars(prog: EarProgramName, loading: number | null, move: { kind: TiviMove | null; n: number }): Ears {
  const [ears, setEars] = useState<Ears>(EARS_IDLE)
  const loadingRef = useRef(loading)
  loadingRef.current = loading
  const st = useRef({ t: 0, k: SLOSH_TICKS, kind: 'hop' as TiviMove, last: '', timer: 0 })
  const draw = useRef(() => {})
  const start = useRef(() => {})

  useEffect(() => {
    const s = st.current
    s.t = 0
    const animated = () => !STATIC_EARS.has(prog) || s.k < SLOSH_TICKS
    draw.current = () => {
      let e = earsOf(prog, s.t, { loading: loadingRef.current })
      if (s.k < SLOSH_TICKS) e = sloshed(e, s.k, s.kind)
      const key = earKey(e)
      if (key === s.last) return
      s.last = key
      setEars(e)
    }
    start.current = () => {
      if (s.timer || !animated()) return
      s.timer = window.setInterval(() => {
        if (document.hidden) return
        s.t++
        if (s.k < SLOSH_TICKS) s.k++
        draw.current()
        if (!animated()) {
          clearInterval(s.timer)
          s.timer = 0
        }
      }, EAR_TICK_MS)
    }
    draw.current()
    start.current()
    return () => {
      clearInterval(s.timer)
      s.timer = 0
    }
  }, [prog])

  // Рывок тела — жидкость в ушах плещется
  useEffect(() => {
    if (!move.kind) return
    st.current.k = 0
    st.current.kind = move.kind
    draw.current()
    start.current()
  }, [move])

  return ears
}

interface Props {
  /** Идёт игра — когда она закончится, Тиви обрадуется возвращению */
  playing: boolean
  /** Интро закончилось — можно здороваться (после перезагрузки окна его видели только что, и он промолчит) */
  greet: boolean
  /** Крупнее только во вкладке «Недавние» (настройка «Размер Тиви») */
  size?: Settings['tiviSize']
}

export const Tivi = memo(function Tivi({ playing, greet, size = 'small' }: Props) {
  const update = useUpdate()
  const loading = update.phase === 'downloading' ? (update.percent ?? 0) : null
  const loadingRef = useRef(loading)
  loadingRef.current = loading
  const [tick, setTick] = useState(false)
  const [hour, setHour] = useState(() => new Date().getHours())
  const hourRef = useRef(hour)
  hourRef.current = hour
  const night = isNight(hour)
  const [cap, setCap] = useState<'off' | 'drop' | 'on'>('off')
  const padKind = usePadInfo()
  const padStatus = usePadStatus()
  const pad = padKind !== 'none' || padStatus.connected > 0
  const vr = !!useVrQuest()?.connected
  const [view, setView] = useState<{ frame: Frame; act: ScriptName | null }>({ frame: BASE.awake.loop![0], act: null })
  const [stage, setStage] = useState<Stage>('awake')
  const [gaze, setGaze] = useState<Gaze>(AHEAD)
  const [blink, setBlink] = useState(0)
  const [move, setMove] = useState<{ kind: TiviMove | null; n: number }>({ kind: null, n: 0 })
  const ref = useRef<HTMLButtonElement>(null)
  const player = useRef<ReturnType<typeof createPlayer> | null>(null)
  const stageRef = useRef(stage)
  stageRef.current = stage
  const mouseAt = useRef(-Infinity)
  // Куда смотреть: на фокус или курсор, а сценка может увести взгляд в сторону
  const aim = useRef<Gaze>(AHEAD)
  const actGaze = useRef<Gaze | null>(null)
  const steer = useRef(() => {})
  const blinkNow = useRef(() => {})
  const clicks = useRef<{ n: number; at: number; last: ScriptName | null }>({ n: 0, at: -Infinity, last: null })
  const hover = useRef(0)
  const pet = useRef<{ x: number; y: number; dir: number; turns: number; path: number; on: boolean } | null>(null)
  // Гладили — отпущенная кнопка не считается кликом
  const petted = useRef(false)

  // Взгляд догоняет цель по клетке за кадр; через весь экран — моргнёт на ходу
  useEffect(() => {
    let timer = 0
    let cur = AHEAD
    const step = () => {
      const goal = actGaze.current ?? aim.current
      const dx = Math.sign(goal.x - cur.x)
      const dy = Math.sign(goal.y - cur.y)
      if (!dx && !dy) {
        timer = 0
        return
      }
      cur = { x: cur.x + dx, y: cur.y + dy }
      setGaze(cur)
      timer = window.setTimeout(step, GAZE_STEP_MS)
    }
    steer.current = () => {
      const goal = actGaze.current ?? aim.current
      if (Math.abs(goal.x - cur.x) >= 3) blinkNow.current()
      if (!timer) step()
    }
    return () => clearTimeout(timer)
  }, [])

  // Сценки: свои и пришедшие из системы
  useEffect(() => {
    const p = createPlayer((frame, act) => {
      setView({ frame, act })
      actGaze.current = frame.gaze ?? null
      steer.current()
      if (frame.move) setMove((m) => ({ kind: frame.move!, n: m.n + 1 }))
    })
    player.current = p
    const off = onTivi((r) => p.play(r))
    return () => {
      off()
      p.stop()
      player.current = null
    }
  }, [])

  // Бездействие: сначала клюёт носом, потом засыпает; любое действие будит — удивлённо
  useEffect(() => {
    let timer = 0
    const quiet = () => Math.min(idleFor(), performance.now() - mouseAt.current)
    const set = (next: Stage) => {
      stageRef.current = next
      setStage(next)
      player.current?.setStage(next)
    }
    const check = () => {
      const idle = quiet()
      const next = idle >= SLEEP_MS ? 'sleep' : idle >= DROWSY_MS ? 'drowsy' : 'awake'
      set(next)
      if (next !== 'sleep') timer = window.setTimeout(check, (next === 'awake' ? DROWSY_MS : SLEEP_MS) - idle + 50)
    }
    const wake = () => {
      player.current?.calm()
      if (stageRef.current === 'awake') return
      set('awake')
      tivi({ act: 'wake', priority: 2 })
      clearTimeout(timer)
      timer = window.setTimeout(check, DROWSY_MS)
    }
    check()
    const offActivity = onActivity(wake)
    window.addEventListener('pointermove', wake, { passive: true })
    return () => {
      offActivity()
      window.removeEventListener('pointermove', wake)
      clearTimeout(timer)
    }
  }, [])

  // Взгляд: на элемент в фокусе, а пока двигается мышь — на курсор
  useEffect(() => {
    let box: DOMRect | null = null
    let boxAt = 0
    const timers: number[] = []
    const look = (g: Gaze) => {
      if (g.x === aim.current.x && g.y === aim.current.y) return
      aim.current = g
      steer.current()
    }
    const aimAt = (x: number, y: number) => {
      const el = ref.current
      if (!el) return
      const now = performance.now()
      if (!box || now - boxAt > 1000) {
        box = el.getBoundingClientRect()
        boxAt = now
      }
      const dx = x - (box.left + box.width / 2)
      const dy = y - (box.top + box.height / 2)
      // Тиви стоит в углу, поэтому вверх смотрит только на верхнюю часть экрана, иначе он почти всегда глядел бы вверх
      const far = window.innerHeight * 0.4
      look({ x: Math.round(2 * Math.max(-1, Math.min(1, dx / (window.innerWidth * 0.8)))) || 0, y: dy < -far ? -1 : dy > far ? 1 : 0 })
    }
    const lookAtFocus = () => {
      if (performance.now() - mouseAt.current < MOUSE_MS) return
      const el = focused()
      if (!el) return look(AHEAD)
      const r = el.getBoundingClientRect()
      aimAt(r.left + r.width / 2, r.top + r.height / 2)
    }
    // Фокус переходит после нажатия, а ряд игр ещё доезжает прокруткой — смотрим сразу и когда всё встало
    const follow = () => {
      timers.forEach(clearTimeout)
      timers.length = 0
      timers.push(window.setTimeout(lookAtFocus, 40), window.setTimeout(lookAtFocus, 450))
    }
    const onMouse = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      mouseAt.current = performance.now()
      aimAt(e.clientX, e.clientY)
      timers.forEach(clearTimeout)
      timers.length = 0
      timers.push(window.setTimeout(lookAtFocus, MOUSE_MS + 20))
    }
    follow()
    const offActivity = onActivity(follow)
    document.addEventListener('focusin', follow)
    window.addEventListener('pointermove', onMouse, { passive: true })
    return () => {
      offActivity()
      document.removeEventListener('focusin', follow)
      window.removeEventListener('pointermove', onMouse)
      timers.forEach(clearTimeout)
    }
  }, [])

  // Редкое моргание, иногда двойное
  useEffect(() => {
    let timer = 0
    let plan = 0
    let queue: [number, number][] = []
    const run = () => {
      const s = queue.shift()
      if (!s) return
      setBlink(s[0])
      if (queue.length) timer = window.setTimeout(run, s[1])
    }
    const once = (twice = false) => {
      if (queue.length) return
      queue = twice ? [...BLINK.slice(0, 3), [0, 140], ...BLINK] : [...BLINK]
      run()
    }
    blinkNow.current = () => once()
    const next = () => {
      plan = window.setTimeout(
        () => {
          once(Math.random() < 0.2)
          next()
        },
        2600 + Math.random() * 4200
      )
    }
    next()
    return () => {
      clearTimeout(timer)
      clearTimeout(plan)
    }
  }, [])

  // Своя жизнь: когда его не трогают, раз в 6–16 с что-нибудь делает, не повторяясь; сонный — клюёт носом
  useEffect(() => {
    let timer = 0
    let last: ScriptName | null = null
    const plan = () => {
      timer = window.setTimeout(act, 6000 + Math.random() * 10_000)
    }
    const act = () => {
      const p = player.current
      const stage = stageRef.current
      const quiet = Math.min(idleFor(), performance.now() - mouseAt.current)
      if (!p || document.hidden || stage === 'sleep' || p.busy() || quiet < CALM_MS || loadingRef.current !== null) return plan()
      // Утром ещё и потягивается, ночью зевает втрое чаще и не ждёт для этого полминуты тишины
      const h = hourRef.current
      const base = stage === 'drowsy' ? DROWSY_ACTS : isMorning(h) ? [...IDLE_ACTS, ...MORNING_ACTS] : IDLE_ACTS
      const pool = base
        .map(([name, w]): [ScriptName, number] => [name, name === 'yawn' && isNight(h) ? w * 3 : w])
        .filter(([name]) => name !== last && (name !== 'yawn' || isNight(h) || quiet >= 30_000))
      last = pick(pool)
      p.play({ act: last, ms: last === 'hum' ? 1800 + Math.random() * 2400 : 0, priority: 0 })
      plan()
    }
    plan()
    return () => clearTimeout(timer)
  }, [])

  // Система: геймпад и шлем подключили или отключили, у геймпада садится заряд, игра закончилась, обновление докачалось
  const downloaded = update.phase === 'ready'
  const lowBattery = padStatus.connected > 0 && (padStatus.battery === 'low' || padStatus.battery === 'empty')
  const prev = useRef({ playing, pad, vr, loading, downloaded, lowBattery })
  useEffect(() => {
    const was = prev.current
    prev.current = { playing, pad, vr, loading, downloaded, lowBattery }
    if (pad && !was.pad) tivi({ act: 'happy', priority: 2 })
    else if (!pad && was.pad) tivi({ act: 'gloom', ms: 1800, priority: 2 })
    if (lowBattery && !was.lowBattery) tivi({ act: 'lowbat', ms: 1800, priority: 2 })
    if (vr && !was.vr) tivi({ act: 'vr', priority: 2 })
    if (!playing && was.playing) tivi({ act: Math.random() < 0.5 ? 'blush' : 'happy', ms: 1400, priority: 2 })
    if (downloaded && was.loading !== null) tivi({ act: 'news', ms: 1600, priority: 3 })
  }, [playing, pad, vr, loading, downloaded, lowBattery])

  // Пока качается обновление, следующая клетка полоски мигает
  const isLoading = loading !== null
  useEffect(() => {
    if (!isLoading) return
    const timer = window.setInterval(() => setTick((v) => !v), 400)
    return () => clearInterval(timer)
  }, [isLoading])

  // Часы: утро и ночь меняют его привычки; ночью он сперва надевает колпак (кадр сверху, потом на место)
  useEffect(() => {
    const timer = window.setInterval(() => setHour(new Date().getHours()), 60_000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    if (!night) return setCap('off')
    setCap('drop')
    const timer = window.setTimeout(() => setCap('on'), 160)
    return () => clearTimeout(timer)
  }, [night])

  // Приветствие: когда интро закончилось и когда окно снова показали (из трея, после игры).
  // Смотрит, когда его видели до этого показа; пока окно на виду, время «видели» обновляется
  const seenBefore = useRef(0)
  if (!seenBefore.current) seenBefore.current = readSeen() || -1
  useEffect(() => {
    if (!greet) return
    let timer = 0
    const hello = (tries = 0) => {
      if (document.hidden) return
      // Сперва пусть доиграет то, что пришло из системы (трофей, геймпад, шлем), — потом поздоровается
      if ((player.current?.level() ?? -1) >= 2 && tries < 20) {
        timer = window.setTimeout(() => hello(tries + 1), 500)
        return
      }
      const seen = seenBefore.current
      seenBefore.current = Date.now()
      markSeen()
      const now = new Date()
      if (seen > 0 && now.getTime() - seen >= MISSED_MS) return tivi({ act: 'missed', ms: 4200, priority: 3 })
      if (seen > 0 && new Date(seen).toDateString() === now.toDateString()) return
      tivi({ act: isMorning(now.getHours()) ? 'morning' : 'wave', priority: 3 })
    }
    timer = window.setTimeout(hello, 700)
    const every = window.setInterval(() => !document.hidden && markSeen(), 60_000)
    const onShow = () => {
      clearTimeout(timer)
      if (!document.hidden) return hello()
      seenBefore.current = Date.now()
      markSeen()
    }
    document.addEventListener('visibilitychange', onShow)
    return () => {
      clearTimeout(timer)
      clearInterval(every)
      document.removeEventListener('visibilitychange', onShow)
    }
  }, [greet])

  // Клик: после перерыва подмигивает, дальше каждый раз по-новому; закликали — кружится голова, злится, падает и перезагружается
  const onClick = () => {
    if (petted.current) {
      petted.current = false
      return
    }
    play('select')
    const c = clicks.current
    const now = performance.now()
    const since = now - c.at
    c.n = since < 1200 ? c.n + 1 : 1
    c.at = now
    if (c.n >= 8) {
      c.n = 0
      return tivi({ act: 'ko', ms: 1400, priority: 3 })
    }
    if (c.n >= 6) return tivi({ act: 'frustrated', ms: 1200, priority: 2 })
    if (c.n >= 4) return tivi({ act: 'dizzy', ms: 1200, priority: 2 })
    const pool = CLICK_ACTS.filter((a) => a !== c.last)
    const act = since > 8000 ? 'wink' : pool[Math.floor(Math.random() * pool.length)]
    c.last = act
    tivi({ act, ms: 1200, priority: 2 })
  }

  // Зажали кнопку на нём и водят туда-сюда — гладят; пока водят, сценка тянется
  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    clearTimeout(hover.current)
    pet.current = { x: e.clientX, y: e.clientY, dir: 0, turns: 0, path: 0, on: false }
    petted.current = false
  }
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    // Гладят только по нему, а кнопку можно зажать и не на нём: курсор ушёл с Тиви — не считается,
    // вернётся с зажатой кнопкой — счёт начнётся заново
    const r = e.currentTarget.getBoundingClientRect()
    const over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
    if (!(e.buttons & 1) || !over) {
      pet.current = null
      return
    }
    if (!pet.current) pet.current = { x: e.clientX, y: e.clientY, dir: 0, turns: 0, path: 0, on: false }
    const p = pet.current
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    if (Math.abs(dx) + Math.abs(dy) < 2) return
    // Туда-сюда по любой оси: считаем развороты вдоль той, по которой ведут
    const dir = Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) : 2 * Math.sign(dy)
    if (p.dir && dir !== p.dir) p.turns++
    p.dir = dir
    p.path += Math.abs(dx) + Math.abs(dy)
    p.x = e.clientX
    p.y = e.clientY
    if (!p.on && p.turns >= 1 && p.path >= PET_PX) p.on = petted.current = true
    if (p.on) tivi({ act: 'pet', ms: 700, priority: 2 })
  }
  const onPointerUp = () => {
    pet.current = null
  }

  const { frame, act } = view
  // Полоска загрузки заменяет покой; сценки (клик, ошибка) показываются поверх неё
  const face = loading !== null && !act ? loadFace(loading, tick) : frame.face
  const free = FREE.has(face)
  const ears = useEars(earProgramOf(act, stage, loading), loading, move)
  const strips = loading !== null && !act ? { bottom: Math.round((loading / 100) * STRIP_DOTS) } : undefined

  return (
    <button
      ref={ref}
      className={`tivi is-${stage} is-${size}`}
      data-act={act ?? undefined}
      tabIndex={-1}
      aria-label={t('Тиви')}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      // Мышь задержалась на нём — смущается
      onPointerEnter={() => {
        clearTimeout(hover.current)
        hover.current = window.setTimeout(() => tivi({ act: 'blush', ms: 1200, priority: 1 }), 1200)
      }}
      onPointerLeave={() => {
        clearTimeout(hover.current)
        pet.current = null
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <TiviArt
        key={move.n}
        face={face}
        gaze={free ? gaze : AHEAD}
        blink={free || face !== frame.face ? blink : 0}
        fx={face === frame.face ? frame.fx : undefined}
        cap={cap}
        ears={ears}
        strips={strips}
        className={move.kind ? `is-${move.kind}` : ''}
      />
    </button>
  )
})

/**
 * Матрица экрана и полосы над и под ней (по 14 точек, каждая посередине между двумя точками сетки; горят слева направо).
 * Отдельно от ушей: на такт ушей матрица не перерисовывается
 */
const Matrix = memo(function Matrix({ face, gaze, blink, top, bottom }: { face: Grid; gaze: Gaze; blink: number; top: number; bottom: number }) {
  const lit = paint(face, gaze, blink)
  const dots: React.ReactNode[] = []
  const dot = (key: string, x: number, y: number, fill: string, alpha: number) => <circle key={key} cx={x} cy={y} r={DOT} fill={fill} opacity={alpha} />
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const ch = lit.get(y * COLS + x)
      const [fill, alpha] = ch ? COLORS[ch] : ['#ffffff', 0.045]
      dots.push(dot(String(y * COLS + x), CX + (x - (COLS - 1) / 2) * PITCH, CY + (y - (ROWS - 1) / 2) * PITCH, fill, alpha))
    }
  for (const side of [-1, 1]) {
    const y = CY + side * (((ROWS - 1) / 2) * PITCH + STRIP_GAP)
    const n = side < 0 ? top : bottom
    for (let x = 0; x < STRIP_DOTS; x++) dots.push(dot(`s${side}.${x}`, CX + (x - (STRIP_DOTS - 1) / 2) * PITCH, y, '#ffffff', x < n ? 1 : 0.045))
  }
  return <g filter="url(#tivi-glow)">{dots}</g>
})

/** Заливка окошка уха: жидкость с наклонённой или рябящей поверхностью, второй слой, полоски, пузырьки и капли (лишнее срезает маска окошка) */
function EarFill({ e, x }: { e: Ear; x: number }) {
  const x0 = x - WIN_W / 2
  const x1 = x + WIN_W / 2
  const y = (v: number) => WIN_BOT - v * WIN_H
  const liquid = (v: number, c: string, op: number, key: string) => {
    if (v <= 0) return null
    const top = y(v)
    const dy = (e.tilt ?? 0) * 5
    const w = e.wave ?? 0
    const edge = w
      ? `L${x0} ${top + dy}Q${x - WIN_W / 4} ${top + dy / 2 + w} ${x} ${top}Q${x + WIN_W / 4} ${top - dy / 2 - w} ${x1} ${top - dy}`
      : `L${x0} ${top + dy}L${x1} ${top - dy}`
    return <path key={key} d={`M${x0} ${WIN_BOT + 2}${edge}L${x1} ${WIN_BOT + 2}Z`} fill={c} opacity={op} />
  }
  return (
    <>
      {liquid(e.v, e.c, e.o, 'v')}
      {e.over && liquid(e.over.v, e.over.c, 1, 'over')}
      {e.bands?.map(([a, b, c], i) => b > a && <rect key={`b${i}`} x={x0} y={y(b)} width={WIN_W} height={(b - a) * WIN_H} fill={c ?? e.c} />)}
      {e.bubbles?.map((b, i) => b.y < e.v && <circle key={`u${i}`} cx={x + b.x * 7} cy={y(b.y)} r={b.r} fill={INSET} opacity={0.5} />)}
      {e.drops?.map((d, i) => <circle key={`d${i}`} cx={x + (d.x ?? 0) * 5.5} cy={y(d.y)} r={d.r ?? 2.6} fill={d.c ?? e.c} />)}
    </>
  )
}

/** Ухо-капсула за корпусом, наклонено наружу; левое машет при приветствии (tivi-wave в styles-tivi.css) */
function EarArt({ side, e }: { side: 'l' | 'r'; e: Ear }) {
  const x = side === 'l' ? 64 : 192
  return (
    <g className={`tivi-ear-${side}`}>
      <g transform={`rotate(${(side === 'l' ? -1 : 1) * (EAR_TILT + (e.a ?? 0))} ${x} 90)`}>
        <rect x={x - EAR_W / 2} y={EAR_TOP} width={EAR_W} height={90 - EAR_TOP} rx={EAR_W / 2} fill={BODY} stroke="url(#tivi-ear-rim)" strokeWidth={1.5} />
        <rect x={x - WIN_W / 2} y={WIN_TOP} width={WIN_W} height={WIN_H} rx={WIN_W / 2} fill={INSET} />
        <g clipPath={`url(#tivi-win-${side})`}>
          <EarFill e={e} x={x} />
        </g>
      </g>
    </g>
  )
}

/**
 * Рисунок Тиви без поведения: уши, корпус с рамкой, экран с лицом и полосами, значки вокруг и колпак.
 * pose двигает тело атрибутами, а не CSS — так рисунок можно сохранить картинкой (экран установки); значки вокруг остаются на месте
 */
export function TiviArt({
  face,
  gaze = AHEAD,
  blink = 0,
  fx,
  cap = 'off',
  pose,
  ears = EARS_IDLE,
  strips,
  className
}: {
  face: Grid
  gaze?: Gaze
  blink?: number
  fx?: Fx[]
  cap?: 'off' | 'drop' | 'on'
  pose?: Pose
  ears?: Ears
  /** Сколько точек горит в полосах над и под матрицей */
  strips?: { top?: number; bottom?: number }
  className?: string
}) {
  return (
    <svg viewBox="8 0 240 236" className={className} aria-hidden>
      <defs>
        {/* Ободок корпуса светится на двух дугах: сверху слева и снизу справа */}
        <linearGradient id="tivi-rim" gradientUnits="userSpaceOnUse" x1="22" y1="76" x2="234" y2="224">
          <stop offset="0" stopColor="#fff" stopOpacity=".55" />
          <stop offset=".3" stopColor="#fff" stopOpacity=".07" />
          <stop offset=".7" stopColor="#fff" stopOpacity=".03" />
          <stop offset="1" stopColor="#fff" stopOpacity=".22" />
        </linearGradient>
        <linearGradient id="tivi-lip" gradientUnits="userSpaceOnUse" x1="0" y1="88" x2="0" y2="212">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset=".6" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#fff" stopOpacity=".16" />
        </linearGradient>
        <linearGradient id="tivi-ear-rim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".32" />
          <stop offset=".5" stopColor="#fff" stopOpacity=".08" />
          <stop offset="1" stopColor="#fff" stopOpacity=".04" />
        </linearGradient>
        {(['l', 'r'] as const).map((side) => (
          <clipPath key={side} id={`tivi-win-${side}`}>
            <rect x={(side === 'l' ? 64 : 192) - WIN_W / 2} y={WIN_TOP} width={WIN_W} height={WIN_H} rx={WIN_W / 2} />
          </clipPath>
        ))}
        <filter id="tivi-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3.2" result="b" />
          <feComponentTransfer in="b" result="b2">
            <feFuncA type="linear" slope=".55" />
          </feComponentTransfer>
          <feMerge>
            <feMergeNode in="b2" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g transform={pose?.x || pose?.y ? `translate(${pose.x ?? 0} ${pose.y ?? 0})` : undefined}>
        <EarArt side="l" e={ears.l} />
        <EarArt side="r" e={ears.r} />
        {/* Ножки: две короткие опоры, выглядывают из-под корпуса и двигаются вместе с ним */}
        <rect x="64" y={212 - (ears.feet?.l ?? 0)} width="34" height="23" rx="9" fill={BODY} stroke="url(#tivi-ear-rim)" strokeWidth={1.5} />
        <rect x="158" y={212 - (ears.feet?.r ?? 0)} width="34" height="23" rx="9" fill={BODY} stroke="url(#tivi-ear-rim)" strokeWidth={1.5} />
        <rect x="22" y="76" width="212" height="148" rx="38" fill={BODY} />
        <rect x="22.75" y="76.75" width="210.5" height="146.5" rx="37.25" fill="none" stroke="url(#tivi-rim)" strokeWidth="1.5" />
        {cap !== 'off' && (
          <g className="tivi-cap" shapeRendering="crispEdges">
            {sprite('cap', 128, cap === 'drop' ? 40 : 51.5, 'cap')}
          </g>
        )}
        <rect x="34" y="88" width="188" height="124" rx="26" fill={INSET} />
        <rect x="34.75" y="88.75" width="186.5" height="122.5" rx="25.25" fill="none" stroke="url(#tivi-lip)" strokeWidth="1.5" />
        <Matrix face={face} gaze={gaze} blink={blink} top={strips?.top ?? 0} bottom={strips?.bottom ?? 0} />
      </g>
      <g className="tivi-fx" shapeRendering="crispEdges">
        {fx?.flatMap(({ s, x, y }, k) => sprite(s, x, y, String(k)))}
      </g>
    </svg>
  )
}
