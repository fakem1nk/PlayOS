import { useId, type ReactNode } from 'react'
import type { FigureId } from '../lib/shelf'

/**
 * Коллекционные фигурки Тиви для полки профиля — как настоящие виниловые статуэтки: глянцевый корпус с объёмом,
 * уши-капсулы со своим цветом «жидкости», картинка на экране и реквизит, которых больше нигде у Тиви нет
 * (не его сценки и не лица из эмоций), круглая подставка с номером. Рисунок статичный — это фигурка, а не живой Тиви.
 * Закрытая фигурка — силуэт (CSS: .tfig.is-locked), реквизит угадывается по контуру.
 */

/** Сетка экрана 15×8, как у Тиви; цвета точек — свои, у фигурок */
const DOT: Record<string, string> = {
  '#': '#ffffff',
  s: '#c3cad8',
  y: '#ffd35c',
  o: '#ffa23a',
  r: '#ff4b5c',
  c: '#5ee6ff',
  v: '#a891ff',
  p: '#ff8ac6',
  b: '#5aa9ff',
  n: '#4be3a0'
}

interface Material {
  /** Корпус: свет сверху → тень снизу */
  body: [string, string]
  /** Торец корпуса — объём снизу */
  side: string
  /** Блик по краю */
  rim: number
  /** Сила глянцевого пятна */
  gloss: number
}

const VINYL: Material = { body: ['#3a4256', '#141821'], side: '#0a0c12', rim: 0.45, gloss: 0.2 }
const WHITE: Material = { body: ['#ffffff', '#b8c0cf'], side: '#868ea0', rim: 0.95, gloss: 0.55 }
const GOLD: Material = { body: ['#fff0b3', '#b98424'], side: '#6e4c10', rim: 0.95, gloss: 0.55 }
const STEEL: Material = { body: ['#f0f3f8', '#76808f'], side: '#454c58', rim: 0.95, gloss: 0.55 }
const HOLO: Material = { body: ['#f3f1ff', '#9aa6c8'], side: '#5f6683', rim: 1, gloss: 0.6 }

interface Look {
  mat: Material
  ears: [string, string]
  screen: string[]
  /** Номер на подставке */
  no: string
  /** Фигурка стоит выше подставки (на стопке коробок), в единицах рисунка */
  lift?: number
}

const LOOKS: Record<FigureId, Look> = {
  // Финишер — за первую игру на полке: клетчатый флаг на экране и настоящий флаг, воткнутый в подставку
  finisher: {
    mat: VINYL,
    ears: ['#ffffff', '#ffffff'],
    no: '01',
    screen: ['...............', '...s#.#.#.#.#..', '...s.#.#.#.#.#.', '...s#.#.#.#.#..', '...s.#.#.#.#.#.', '...s...........', '...s...........', '..sss..........']
  },
  // Перфекционист — первая игра на 100 %: весь золотой, «100» на экране, лавровый венок вокруг подставки
  perfect: {
    mat: GOLD,
    ears: ['#fff6d6', '#fff6d6'],
    no: '02',
    screen: ['...............', '...y..yyy.yyy..', '..yy..y.y.y.y..', '...y..y.y.y.y..', '...y..y.y.y.y..', '..yyy.yyy.yyy..', '...............', '...............']
  },
  // Исследователь — 5 игр: пробковый шлем, компас на экране, свёрнутая карта у ног
  explorer: {
    mat: VINYL,
    ears: ['#ffb547', '#4be3a0'],
    no: '03',
    screen: ['......sss......', '....ss.r.ss....', '...s...r...s...', '...s..rrr..s...', '...s...#...s...', '...s...#...s...', '....ss...ss....', '......sss......']
  },
  // Космонавт — 10 игр: белый корпус, стеклянный шлем-пузырь, планета с кольцом на экране
  astro: {
    mat: WHITE,
    ears: ['#5ee6ff', '#5ee6ff'],
    no: '04',
    screen: ['.#.............', '......ccc...#..', '.....ccccc.....', '.vv..ccccc..vv.', '..vvvvvvvvvvv..', '.....ccccc.....', '......ccc......', '.............#.']
  },
  // Рыцарь — 15 игр: сталь, плюмаж, забрало с горящей щелью, меч в подставке и щит
  knight: {
    mat: STEEL,
    ears: ['#ff4b5c', '#ff4b5c'],
    no: '05',
    screen: ['...............', '..sssssssssss..', '..srrrrrrrrrs..', '..sssssssssss..', '..ss.s.s.s.ss..', '..sssssssssss..', '...sssssssss...', '.....sssss.....']
  },
  // Коллекционер — 25 игр: стоит на стопке коробок, на экране — стопка игр
  collector: {
    mat: VINYL,
    ears: ['#a891ff', '#ff8ac6'],
    no: '06',
    lift: 27,
    screen: ['...............', '...ppp###ppp...', '...ppppppppp...', '..bbbb###bbbb..', '..bbbbbbbbbbb..', '...yyy###yyy...', '...yyyyyyyyy...', '...............']
  },
  // Легенда — 50 игр: перламутровый корпус, корона и алый плащ, звезда на экране
  legend: {
    mat: HOLO,
    ears: ['#ffd35c', '#ffd35c'],
    no: '07',
    screen: ['.......y.......', '......yyy......', '.yyyyyyyyyyyyy.', '...yyyyyyyyy...', '....yyyyyyy....', '...yyyy.yyyy...', '..yyy.....yyy..', '.yy.........yy.']
  }
}

/** Масштаб Тиви на подставке и его место: ножки встают на верх подставки */
const S = 0.62
const BASE_Y = 216
/** Низ ножек в координатах Тиви (корпус кончается на 224, его объём — на 231) */
const FEET_BOT = 240

export function TiviFigure({ id, locked = false, className = '' }: { id: FigureId; locked?: boolean; className?: string }) {
  const p = `f${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const look = LOOKS[id]
  const ty = BASE_Y - 2 - FEET_BOT * S - (look.lift ?? 0)
  const tx = 100 - 128 * S
  return (
    <svg className={`tfig tfig-${id} ${locked ? 'is-locked' : ''} ${className}`} viewBox="0 0 200 250" aria-hidden>
      <defs>
        <linearGradient id={`${p}body`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={look.mat.body[0]} />
          <stop offset="1" stopColor={look.mat.body[1]} />
        </linearGradient>
        {id === 'legend' && (
          <linearGradient id={`${p}holo`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffd9f3" stopOpacity=".55" />
            <stop offset=".35" stopColor="#d4e4ff" stopOpacity=".1" />
            <stop offset=".6" stopColor="#d2fff1" stopOpacity=".45" />
            <stop offset="1" stopColor="#fff4c9" stopOpacity=".2" />
          </linearGradient>
        )}
        <linearGradient id={`${p}rim`} gradientUnits="userSpaceOnUse" x1="22" y1="76" x2="234" y2="224">
          <stop offset="0" stopColor="#fff" stopOpacity={look.mat.rim} />
          <stop offset=".35" stopColor="#fff" stopOpacity=".08" />
          <stop offset=".75" stopColor="#fff" stopOpacity=".02" />
          <stop offset="1" stopColor="#fff" stopOpacity={look.mat.rim * 0.35} />
        </linearGradient>
        <radialGradient id={`${p}gloss`} cx=".3" cy=".18" r=".55">
          <stop offset="0" stopColor="#fff" stopOpacity={look.mat.gloss} />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${p}baseTop`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={id === 'perfect' ? '#5a4214' : '#232836'} />
          <stop offset="1" stopColor={id === 'perfect' ? '#2e210a' : '#11141c'} />
        </linearGradient>
        <linearGradient id={`${p}baseSide`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#07090e" />
          <stop offset=".3" stopColor={id === 'perfect' ? '#4b3610' : '#1a1e29'} />
          <stop offset=".7" stopColor={id === 'perfect' ? '#3a2a0c' : '#141820'} />
          <stop offset="1" stopColor="#07090e" />
        </linearGradient>
        <linearGradient id={`${p}metal`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8e97a6" />
          <stop offset=".45" stopColor="#f4f6fa" />
          <stop offset="1" stopColor="#7c8494" />
        </linearGradient>
        <linearGradient id={`${p}gold`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff1b8" />
          <stop offset=".5" stopColor="#f2c54e" />
          <stop offset="1" stopColor="#a8761a" />
        </linearGradient>
        {[0, 1].map((i) => (
          <clipPath key={i} id={`${p}win${i}`}>
            <rect x={(i ? 192 : 64) - 11} y={46} width={22} height={30} rx={11} />
          </clipPath>
        ))}
        <filter id={`${p}glow`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id={`${p}soft`} x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
        {id === 'finisher' && (
          <pattern id={`${p}chk`} width="8" height="8" patternUnits="userSpaceOnUse">
            <rect width="8" height="8" fill="#f4f6fb" />
            <rect width="4" height="4" fill="#151820" />
            <rect x="4" y="4" width="4" height="4" fill="#151820" />
          </pattern>
        )}
        {id === 'astro' && (
          <radialGradient id={`${p}bubble`} cx=".5" cy=".5" r=".5">
            <stop offset=".72" stopColor="#bfe3ff" stopOpacity=".04" />
            <stop offset="1" stopColor="#bfe3ff" stopOpacity=".26" />
          </radialGradient>
        )}
        {id === 'legend' && (
          <linearGradient id={`${p}cape`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#e3324f" />
            <stop offset="1" stopColor="#5c0b18" />
          </linearGradient>
        )}
      </defs>

      <Base p={p} id={id} no={look.no} />
      {/* Тень фигурки на подставке */}
      <ellipse cx="100" cy={BASE_Y - (look.lift ?? 0)} rx="58" ry="7" fill="#000" opacity=".5" filter={`url(#${p}soft)`} />

      <g className="tfig-body">
        {id === 'collector' && <CaseStack />}
        {id === 'finisher' && <Flag p={p} />}
        {id === 'knight' && <Sword p={p} />}
        {id === 'perfect' && <Laurel p={p} />}
        {id === 'explorer' && <MapScroll />}
        <g transform={`translate(${tx} ${ty}) scale(${S})`}>
          {id === 'legend' && <Cape p={p} />}
          <Ear p={p} side={0} color={look.ears[0]} mat={look.mat} />
          <Ear p={p} side={1} color={look.ears[1]} mat={look.mat} />
          <Foot p={p} x={64} mat={look.mat} />
          <Foot p={p} x={158} mat={look.mat} />
          {/* Объём корпуса снизу и сам корпус */}
          <rect x="22" y="83" width="212" height="148" rx="38" fill={look.mat.side} />
          <rect x="22" y="76" width="212" height="148" rx="38" fill={`url(#${p}body)`} />
          {id === 'legend' && <rect x="22" y="76" width="212" height="148" rx="38" fill={`url(#${p}holo)`} />}
          <rect x="22" y="76" width="212" height="148" rx="38" fill={`url(#${p}gloss)`} />
          <rect x="23.5" y="77.5" width="209" height="145" rx="36.5" fill="none" stroke={`url(#${p}rim)`} strokeWidth="3" />
          {/* Блик по верхнему краю — глянцевый винил */}
          <path d="M46 92Q50 82 72 81L150 81" fill="none" stroke="#fff" strokeOpacity={look.mat.gloss * 1.1} strokeWidth="4" strokeLinecap="round" />
          <Screen p={p} grid={look.screen} />
          {id === 'explorer' && <PithHelmet />}
          {id === 'knight' && <Plume />}
          {id === 'legend' && <Crown p={p} />}
          {id === 'astro' && <Bubble p={p} />}
        </g>
        {id === 'knight' && <Shield p={p} />}
      </g>
    </svg>
  )
}

/** Круглая подставка с табличкой номера */
function Base({ p, id, no }: { p: string; id: FigureId; no: string }) {
  return (
    <g className="tfig-base">
      <ellipse cx="100" cy="234" rx="74" ry="13" fill="#05070b" />
      <rect x="26" y={BASE_Y} width="148" height="18" fill={`url(#${p}baseSide)`} />
      <ellipse cx="100" cy={BASE_Y} rx="74" ry="13" fill={`url(#${p}baseTop)`} />
      <ellipse cx="100" cy={BASE_Y} rx="73.5" ry="12.5" fill="none" stroke={id === 'perfect' ? '#ffe08a' : '#fff'} strokeOpacity={id === 'perfect' ? 0.7 : 0.22} strokeWidth="1" />
      <rect x="86" y="222" width="28" height="9" rx="2" fill="#fff" fillOpacity=".07" stroke="#fff" strokeOpacity=".12" strokeWidth=".6" />
      <text x="100" y="229" textAnchor="middle" fontSize="6.5" fontWeight="600" letterSpacing=".8" fill="#fff" fillOpacity=".6">
        № {no}
      </text>
    </g>
  )
}

/** Ухо — короткая толстая капсула с «жидкостью» своего цвета, наклонено наружу, как у Тиви */
function Ear({ p, side, color, mat }: { p: string; side: 0 | 1; color: string; mat: Material }) {
  const x = side ? 192 : 64
  return (
    <g transform={`rotate(${side ? 20 : -20} ${x} 90)`}>
      <rect x={x - 19} y="43" width="38" height="50" rx="19" fill={mat.side} />
      <rect x={x - 19} y="40" width="38" height="50" rx="19" fill={`url(#${p}body)`} />
      <rect x={x - 18} y="41" width="36" height="48" rx="18" fill="none" stroke="#fff" strokeOpacity={mat.rim * 0.5} strokeWidth="1.5" />
      <rect x={x - 11} y="46" width="22" height="30" rx="11" fill="#05070c" />
      <g clipPath={`url(#${p}win${side})`}>
        <rect x={x - 11} y="50" width="22" height="26" fill={color} />
        <rect x={x - 11} y="50" width="22" height="3" fill="#fff" opacity=".45" />
      </g>
    </g>
  )
}

/** Ножка: короткая опора под корпусом, того же материала */
function Foot({ p, x, mat }: { p: string; x: number; mat: Material }) {
  return (
    <>
      <rect x={x} y="219" width="34" height="21" rx="9" fill={mat.side} />
      <rect x={x} y="214" width="34" height="21" rx="9" fill={`url(#${p}body)`} />
      <rect x={x + 1} y="215" width="32" height="19" rx="8" fill="none" stroke="#fff" strokeOpacity={mat.rim * 0.4} strokeWidth="1.5" />
    </>
  )
}

/** Экран: картинка точками с лёгким свечением */
function Screen({ p, grid }: { p: string; grid: string[] }) {
  const dots: ReactNode[] = []
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 15; x++) {
      const ch = grid[y]?.[x] ?? '.'
      const on = ch !== '.'
      dots.push(<circle key={`${x}.${y}`} cx={128 + (x - 7) * 11.5} cy={150 + (y - 3.5) * 11.5} r="4.4" fill={on ? DOT[ch] : '#fff'} opacity={on ? 1 : 0.05} />)
    }
  return (
    <>
      <rect x="34" y="88" width="188" height="124" rx="26" fill="#05070c" />
      <g filter={`url(#${p}glow)`}>{dots}</g>
      <rect x="34.75" y="88.75" width="186.5" height="122.5" rx="25.25" fill="none" stroke="#fff" strokeOpacity=".1" strokeWidth="1.5" />
    </>
  )
}

/** Клетчатый флаг финиша, воткнутый в подставку */
function Flag({ p }: { p: string }) {
  return (
    <g>
      <ellipse cx="164" cy="219" rx="4" ry="1.6" fill="#000" opacity=".6" />
      {/* Сплошной цвет: градиент по рамке объекта у линии нулевой ширины не рисуется */}
      <line x1="164" y1="219" x2="164" y2="58" stroke="#cfd5df" strokeWidth="3.2" strokeLinecap="round" />
      <line x1="163.2" y1="214" x2="163.2" y2="62" stroke="#fff" strokeOpacity=".7" strokeWidth="1" />
      <circle cx="164" cy="56" r="3.6" fill="#eef1f6" />
      <path d="M165.5 60C176 54 186 66 197 60L197 88C186 94 176 82 165.5 88Z" fill={`url(#${p}chk)`} />
      <path d="M165.5 60C176 54 186 66 197 60L197 88C186 94 176 82 165.5 88Z" fill="#000" opacity=".12" />
      <path d="M176 57C181 58 184 63 188 64L188 92C184 91 181 86 176 85Z" fill="#000" opacity=".14" />
    </g>
  )
}

/** Лавровый венок из золотых листьев по краю подставки */
function Laurel({ p }: { p: string }) {
  const leaves: ReactNode[] = []
  for (const side of [-1, 1])
    for (let i = 0; i < 7; i++) {
      const t = i / 6
      // Квадратичная кривая от низа подставки вверх и наружу: (74,230) → (26,226) → (30,176)
      const bx = (1 - t) ** 2 * 74 + 2 * (1 - t) * t * 26 + t * t * 30
      const by = (1 - t) ** 2 * 230 + 2 * (1 - t) * t * 226 + t * t * 176
      const dx = 2 * (1 - t) * (26 - 74) + 2 * t * (30 - 26)
      const dy = 2 * (1 - t) * (226 - 230) + 2 * t * (176 - 226)
      const a = (Math.atan2(dy, dx) * 180) / Math.PI
      const x = side < 0 ? bx : 200 - bx
      const ang = side < 0 ? a : 180 - a
      for (const k of [-1, 1])
        leaves.push(<ellipse key={`${side}.${i}.${k}`} cx={x} cy={by} rx="6.5" ry="2.6" transform={`rotate(${ang + k * 38} ${x} ${by})`} fill={`url(#${p}gold)`} />)
    }
  return <g>{leaves}</g>
}

/** Пробковый шлем исследователя между ушами */
function PithHelmet() {
  return (
    <g>
      <ellipse cx="128" cy="80" rx="80" ry="11" fill="#8f7444" />
      <path d="M66 78C66 26 190 26 190 78Z" fill="#dcc596" />
      <path d="M78 54C90 34 120 30 132 31" fill="none" stroke="#fff" strokeOpacity=".45" strokeWidth="5" strokeLinecap="round" />
      <rect x="67" y="66" width="122" height="10" fill="#7a5f35" />
      <ellipse cx="128" cy="78" rx="80" ry="8" fill="#c9b07c" />
      <circle cx="128" cy="33" r="5" fill="#a88b55" />
    </g>
  )
}

/** Свёрнутая карта у ног */
function MapScroll() {
  return (
    <g transform="rotate(-10 46 210)">
      <rect x="22" y="202" width="50" height="13" rx="6.5" fill="#ece0c2" />
      <rect x="22" y="202" width="50" height="3" rx="1.5" fill="#fff" opacity=".5" />
      <rect x="40" y="202" width="2.5" height="13" fill="#c0392b" opacity=".85" />
      <ellipse cx="72" cy="208.5" rx="3.6" ry="6.5" fill="#cdbd94" />
      <ellipse cx="72" cy="208.5" rx="1.4" ry="2.8" fill="#8f7c52" />
    </g>
  )
}

/** Стеклянный шлем-пузырь космонавта и воротник на подставке */
function Bubble({ p }: { p: string }) {
  return (
    <g>
      <circle cx="128" cy="128" r="114" fill={`url(#${p}bubble)`} stroke="#fff" strokeOpacity=".55" strokeWidth="2.4" />
      <path d="M44 92A100 100 0 0 1 104 26" fill="none" stroke="#fff" strokeOpacity=".75" strokeWidth="7" strokeLinecap="round" />
      <circle cx="198" cy="64" r="6" fill="#fff" opacity=".5" />
      <ellipse cx="128" cy="236" rx="96" ry="13" fill={`url(#${p}metal)`} />
      <ellipse cx="128" cy="233" rx="96" ry="8" fill="none" stroke="#fff" strokeOpacity=".6" strokeWidth="1.5" />
    </g>
  )
}

/** Плюмаж рыцаря */
function Plume() {
  return (
    <g>
      <path d="M118 80C106 40 134 10 176 18C150 26 140 48 140 80Z" fill="#e2394d" />
      <path d="M126 76C120 46 140 26 164 22" fill="none" stroke="#ff8b97" strokeWidth="4" strokeLinecap="round" />
      <path d="M134 78C132 54 146 36 168 26" fill="none" stroke="#a3162a" strokeWidth="3" strokeLinecap="round" />
      <rect x="114" y="70" width="30" height="10" rx="3" fill="#b9c1ce" />
    </g>
  )
}

/** Меч, воткнутый в подставку */
function Sword({ p }: { p: string }) {
  return (
    <g>
      <ellipse cx="40" cy="219" rx="5" ry="1.8" fill="#000" opacity=".6" />
      <path d="M36.5 219L43.5 219L43.5 124L40 112L36.5 124Z" fill={`url(#${p}metal)`} />
      <line x1="40" y1="120" x2="40" y2="216" stroke="#5f6878" strokeWidth=".9" />
      <rect x="28" y="116" width="24" height="5" rx="2.5" fill={`url(#${p}gold)`} />
      <rect x="37.5" y="96" width="5" height="20" rx="2" fill="#6b4524" />
      <circle cx="40" cy="94" r="4" fill={`url(#${p}gold)`} />
    </g>
  )
}

/** Щит, прислонённый к фигурке */
function Shield({ p }: { p: string }) {
  return (
    <g transform="rotate(9 168 218)">
      <path d="M150 176L184 176L184 196C184 210 167 220 167 220C167 220 150 210 150 196Z" fill="#2d58d0" stroke={`url(#${p}metal)`} strokeWidth="3" />
      <path d="M167 182L174 194L167 206L160 194Z" fill="#a891ff" />
      <path d="M154 180L166 180" stroke="#fff" strokeOpacity=".45" strokeWidth="2" strokeLinecap="round" />
    </g>
  )
}

/** Стопка из трёх коробок под коллекционером */
function CaseStack() {
  const cases = [
    { x: 40, y: 206, w: 120, c: '#ff6fae', r: -1.5 },
    { x: 46, y: 197, w: 108, c: '#3a7bff', r: 1.2 },
    { x: 38, y: 188, w: 124, c: '#ffc94d', r: -0.8 }
  ]
  return (
    <g>
      {cases.map((k, i) => (
        <g key={i} transform={`rotate(${k.r} 100 ${k.y + 4})`}>
          <rect x={k.x} y={k.y} width={k.w} height="9" rx="1.6" fill={k.c} />
          <rect x={k.x} y={k.y} width={k.w} height="2" rx="1" fill="#fff" opacity=".45" />
          <rect x={k.x + 10} y={k.y + 4} width={k.w * 0.32} height="2" rx="1" fill="#fff" opacity=".7" />
          <rect x={k.x} y={k.y + 7} width={k.w} height="2" rx="1" fill="#000" opacity=".25" />
        </g>
      ))}
    </g>
  )
}

/** Алый плащ за спиной легенды */
function Cape({ p }: { p: string }) {
  return (
    <g>
      <path d="M46 98C24 150 10 200 0 238L256 238C246 200 232 150 210 98Z" fill={`url(#${p}cape)`} />
      <path d="M70 120C60 160 52 200 46 236M128 110L128 236M186 120C196 160 204 200 210 236" fill="none" stroke="#000" strokeOpacity=".22" strokeWidth="5" />
    </g>
  )
}

/** Корона с камнями */
function Crown({ p }: { p: string }) {
  return (
    <g>
      <path d="M86 78L94 36L112 58L128 26L144 58L162 36L170 78Z" fill={`url(#${p}gold)`} />
      <rect x="86" y="66" width="84" height="12" rx="3" fill={`url(#${p}gold)`} />
      <path d="M90 68L166 68" stroke="#fff" strokeOpacity=".6" strokeWidth="2" />
      <circle cx="94" cy="36" r="4.5" fill="#ff4b5c" />
      <circle cx="128" cy="26" r="5.5" fill="#5ee6ff" />
      <circle cx="162" cy="36" r="4.5" fill="#4be3a0" />
      <circle cx="112" cy="72" r="3" fill="#a891ff" />
      <circle cx="144" cy="72" r="3" fill="#a891ff" />
    </g>
  )
}
