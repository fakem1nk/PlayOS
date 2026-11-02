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
  FREE,
  IDLE_ACTS,
  ROWS,
  SCRIPTS,
  SPRITES,
  type Frame,
  type Gaze,
  type Grid,
  type Script,
  type ScriptName,
  type TiviMove
} from '../lib/tivi-faces'
import { t } from '@shared/i18n'
import '../styles-tivi.css'

/**
 * Тиви — маскот PlayOS (как на значке приложения) в правом нижнем углу.
 * Лицо — светодиодная матрица 15×8, как цифры часов: кадры сменяются мгновенно, без плавных переходов.
 * Следит глазами за фокусом, а пока двигается мышь — за ней; моргает; в покое сам себя развлекает (сценки в tivi-faces.ts).
 * На клик подмигивает и каждый раз отвечает по-новому, если кликать без конца — ему становится дурно.
 * Радуется запуску игры, грустит от ошибок, влюбляется в трофеи, засыпает при бездействии.
 */

const PITCH = 11.5
const DOT = 4.4
// Центр экрана в координатах образца 256 (корпус 16,70 224×160, экран с отступом 18)
const CX = 128
const CY = 150
/** Пиксель значков вокруг корпуса (zZ, сердечки) */
const PX = 7
const SPARK = 'M0 -20C3.25 -3.25 3.25 -3.25 20 0C3.25 3.25 3.25 3.25 0 20C-3.25 3.25 -3.25 3.25 -20 0C-3.25 -3.25 -3.25 -3.25 0 -20Z'

const DROWSY_MS = 75_000
const SLEEP_MS = 240_000
// Столько после последнего движения мыши Тиви ещё смотрит на неё, потом возвращается к фокусу
const MOUSE_MS = 1600
/** Взгляд переводится по клетке за кадр, а не прыжком */
const GAZE_STEP_MS = 45
/** Своими делами Тиви занимается, только когда его давно не трогали */
const CALM_MS = 4000
const AHEAD: Gaze = { x: 0, y: 0 }
// Моргание по кадрам: прикрыл, закрыл, прикрыл, открыл (состояние, сколько держать)
const BLINK: [number, number][] = [
  [1, 40],
  [2, 90],
  [1, 40],
  [0, 0]
]

type Stage = 'awake' | 'drowsy' | 'sleep'
type Part = 'intro' | 'loop' | 'outro'

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

interface Props {
  /** Идёт игра — когда она закончится, Тиви обрадуется возвращению */
  playing: boolean
}

export const Tivi = memo(function Tivi({ playing }: Props) {
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
      if (!p || document.hidden || stage === 'sleep' || p.busy() || quiet < CALM_MS) return plan()
      const pool = (stage === 'drowsy' ? DROWSY_ACTS : IDLE_ACTS).filter(([name]) => name !== last && (name !== 'yawn' || quiet >= 30_000))
      last = pick(pool)
      p.play({ act: last, ms: last === 'hum' ? 1800 + Math.random() * 2400 : 0, priority: 0 })
      plan()
    }
    plan()
    return () => clearTimeout(timer)
  }, [])

  // Система: геймпад и шлем подключили или отключили, игра закончилась
  const prev = useRef({ playing, pad, vr })
  useEffect(() => {
    const was = prev.current
    prev.current = { playing, pad, vr }
    if (pad && !was.pad) tivi({ act: 'happy', priority: 2 })
    else if (!pad && was.pad) tivi({ act: 'gloom', ms: 1800, priority: 2 })
    if (vr && !was.vr) tivi({ act: 'vr', priority: 2 })
    if (!playing && was.playing) tivi({ act: Math.random() < 0.5 ? 'blush' : 'happy', ms: 1400, priority: 2 })
  }, [playing, pad, vr])

  // Клик: после перерыва подмигивает, дальше каждый раз по-новому; закликали — кружится голова, злится, падает и перезагружается
  const onClick = () => {
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

  const { frame, act } = view
  const free = FREE.has(frame.face)
  const lit = paint(frame.face, free ? gaze : AHEAD, free ? blink : 0)

  const dots: React.ReactNode[] = []
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const ch = lit.get(y * COLS + x)
      const [fill, alpha] = ch ? COLORS[ch] : ['#ffffff', 0.045]
      dots.push(
        <circle
          key={y * COLS + x}
          cx={CX + (x - (COLS - 1) / 2) * PITCH}
          cy={CY + (y - (ROWS - 1) / 2) * PITCH}
          r={DOT}
          fill={fill}
          opacity={alpha}
        />
      )
    }
  const fx = frame.fx?.flatMap(({ s, x, y }, k) => {
    const rows = SPRITES[s]
    const x0 = x - (rows[0].length * PX) / 2
    const y0 = y - (rows.length * PX) / 2
    return rows.flatMap((row, j) =>
      [...row].flatMap((ch, i) =>
        ch === '.' ? [] : [<rect key={`${k}.${i}.${j}`} x={x0 + i * PX} y={y0 + j * PX} width={PX} height={PX} fill={COLORS[ch][0]} />]
      )
    )
  })

  return (
    <button
      ref={ref}
      className={`tivi is-${stage}`}
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
      onPointerLeave={() => clearTimeout(hover.current)}
    >
      <svg key={move.n} viewBox="8 0 240 236" className={move.kind ? `is-${move.kind}` : ''} aria-hidden>
        <defs>
          <linearGradient id="tivi-body" gradientUnits="userSpaceOnUse" x1="0" y1="70" x2="0" y2="230">
            <stop offset="0" stopColor="#2b3448" />
            <stop offset="1" stopColor="#0a0d15" />
          </linearGradient>
          <linearGradient id="tivi-rim" gradientUnits="userSpaceOnUse" x1="16" y1="70" x2="240" y2="230">
            <stop offset="0" stopColor="#fff" stopOpacity=".75" />
            <stop offset=".35" stopColor="#fff" stopOpacity=".14" />
            <stop offset=".65" stopColor="#fff" stopOpacity=".07" />
            <stop offset="1" stopColor="#fff" stopOpacity=".45" />
          </linearGradient>
          <linearGradient id="tivi-ant" gradientUnits="userSpaceOnUse" x1="0" y1="20" x2="0" y2="70">
            <stop offset="0" stopColor="#c3cad8" />
            <stop offset="1" stopColor="#7f889c" />
          </linearGradient>
          <linearGradient id="tivi-lip" gradientUnits="userSpaceOnUse" x1="0" y1="88" x2="0" y2="212">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset=".6" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#fff" stopOpacity=".16" />
          </linearGradient>
          <linearGradient id="tivi-spark" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#c2b4ff" />
            <stop offset="1" stopColor="#8f78ff" />
          </linearGradient>
          <radialGradient id="tivi-ball" cx=".35" cy=".3" r=".8">
            <stop offset="0" stopColor="#fff" />
            <stop offset=".55" stopColor="#eef1f7" />
            <stop offset="1" stopColor="#a3abbd" />
          </radialGradient>
          <clipPath id="tivi-clip">
            <rect x="16" y="70" width="224" height="160" rx="40" />
          </clipPath>
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
        <path d="M112 72L80 24M144 72L186 22" stroke="url(#tivi-ant)" strokeWidth="7" strokeLinecap="round" />
        <circle cx="80" cy="24" r="9" fill="url(#tivi-ball)" stroke="#6f7990" strokeOpacity=".4" strokeWidth="1.4" />
        <g transform="translate(188 22)">
          <path className="tivi-spark" d={SPARK} fill="url(#tivi-spark)" />
        </g>
        <rect x="16" y="70" width="224" height="160" rx="40" fill="url(#tivi-body)" />
        <g clipPath="url(#tivi-clip)">
          <rect x="16" y="70" width="224" height="160" rx="40" fill="none" stroke="url(#tivi-rim)" strokeWidth="5" />
        </g>
        <rect x="34" y="88" width="188" height="124" rx="26" fill="#05070c" />
        <rect x="34.75" y="88.75" width="186.5" height="122.5" rx="25.25" fill="none" stroke="url(#tivi-lip)" strokeWidth="1.5" />
        <g filter="url(#tivi-glow)">{dots}</g>
        <g className="tivi-fx" shapeRendering="crispEdges">
          {fx}
        </g>
      </svg>
    </button>
  )
})
