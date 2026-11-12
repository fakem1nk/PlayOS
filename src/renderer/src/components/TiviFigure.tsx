import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react'
import { FIGURES, type FigureId } from '../lib/shelf'

/**
 * Коллекционные фигурки Тиви для полки профиля — как настоящие виниловые статуэтки. У каждой свой силуэт (поза, уши,
 * форма корпуса, крупный реквизит), своя картинка на экране и своя сценка: на полке фигурка стоит неподвижно, а в окне
 * фигурки (ShelfDialogs → FigureDialog, live) оживает — экран переключает кадры ступенями, как у Тиви (useSeq), реквизит
 * двигается по классам tfa-* (styles-shelf.css, только под .tfig.is-live).
 * Редкость видна по подставке: ободок своего цвета, у эпических и легендарных — второй ободок, у легендарных — искры.
 * Закрытая фигурка — силуэт (CSS: .tfig.is-locked), реквизит угадывается по контуру.
 * Движущийся элемент не должен иметь атрибута transform: CSS-анимация его перекрывает — оборачивайте в <g>.
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

const VINYL: Material = { body: ['#3f485e', '#141821'], side: '#0a0c12', rim: 0.5, gloss: 0.24 }
const WHITE: Material = { body: ['#ffffff', '#b8c0cf'], side: '#868ea0', rim: 0.95, gloss: 0.55 }
const GOLD: Material = { body: ['#fff0b3', '#b98424'], side: '#6e4c10', rim: 0.95, gloss: 0.55 }
const STEEL: Material = { body: ['#f0f3f8', '#76808f'], side: '#454c58', rim: 0.95, gloss: 0.55 }
const HOLO: Material = { body: ['#f3f1ff', '#9aa6c8'], side: '#5f6683', rim: 1, gloss: 0.6 }
const ORANGE: Material = { body: ['#ffb061', '#c2501a'], side: '#73290a', rim: 0.85, gloss: 0.45 }
const BLUE: Material = { body: ['#6f8dff', '#20308f'], side: '#111a55', rim: 0.8, gloss: 0.42 }
const BEIGE: Material = { body: ['#f4ecd6', '#b9ab86'], side: '#857a5c', rim: 0.9, gloss: 0.2 }
const NIGHT: Material = { body: ['#4a4290', '#16133a'], side: '#0a0920', rim: 0.6, gloss: 0.3 }
const FLAME: Material = { body: ['#ff7a6a', '#961a2a'], side: '#560a16', rim: 0.85, gloss: 0.45 }
const PLATINUM: Material = { body: ['#ffffff', '#93b3cc'], side: '#58707f', rim: 1, gloss: 0.65 }
const OBSIDIAN: Material = { body: ['#6e5868', '#1d1319'], side: '#000000', rim: 0.55, gloss: 0.2 }

interface Look {
  mat: Material
  /** Цвета «жидкости» в ушах; null — ушей-капсул нет (у фигурки свои: рога, антенна, перья) */
  ears: [string, string] | null
  /** Наклон ушей в градусах, если не обычный */
  earRot?: [number, number]
  /** Кадры экрана */
  frames: string[][]
  /** Порядок кадров в окне фигурки: [кадр, мс] */
  seq?: [number, number][]
  /** Цвет света на подставке (по умолчанию — правое ухо) */
  glow?: string
  /** Фигурка стоит выше подставки (на коробках, пьедестале, ветке), в единицах рисунка */
  lift?: number
  /** Скругление корпуса (обычное 38) */
  rx?: number
  scale?: number
  /** Сдвиг вбок на подставке */
  dx?: number
  /** Наклон всей фигурки вперёд, градусы */
  lean?: number
  /** false — обычных ножек нет, у фигурки свои */
  feet?: boolean
  /** Класс движения всей фигурки в окне */
  motion?: string
}

const EMPTY = Array.from({ length: 8 }, () => '...............')
/** Цифра 3×5 по центру экрана */
const big = (rows: string[]) => ['', ...rows.map((r) => `......${r}`), '', '']
/** Забрало рыцаря: по красной щели бежит белый огонёк */
const VISOR = Array.from({ length: 9 }, (_, k) => [
  '...............',
  '..sssssssssss..',
  `..s${'r'.repeat(k)}#${'r'.repeat(8 - k)}s..`,
  '..sssssssssss..',
  '..ss.s.s.s.ss..',
  '..sssssssssss..',
  '...sssssssss...',
  '.....sssss.....'
])
const every = (n: number, ms: number): [number, number][] => Array.from({ length: n }, (_, i) => [i, ms])

const LOOKS: Record<FigureId, Look> = {
  // Финишер — первая игра: клетчатый флаг на экране перещёлкивается, настоящий флаг в подставке полощется
  finisher: {
    mat: VINYL,
    ears: ['#ffffff', '#ffffff'],
    frames: [
      ['...............', '...s#.#.#.#.#..', '...s.#.#.#.#.#.', '...s#.#.#.#.#..', '...s.#.#.#.#.#.', '...s...........', '...s...........', '..sss..........'],
      ['...............', '...s.#.#.#.#.#.', '...s#.#.#.#.#..', '...s.#.#.#.#.#.', '...s#.#.#.#.#..', '...s...........', '...s...........', '..sss..........']
    ],
    seq: every(2, 360)
  },
  // Исследователь — 5 игр: пробковый шлем, компас на экране ищет север, свёрнутая карта у ног
  explorer: {
    mat: VINYL,
    ears: ['#ffb547', '#4be3a0'],
    frames: [
      ['......sss......', '....ss.r.ss....', '...s...r...s...', '...s..rrr..s...', '...s...#...s...', '...s...#...s...', '....ss...ss....', '......sss......'],
      ['......sss......', '....ss...ss....', '...s....r..s...', '...s...rr..s...', '...s..#....s...', '...s.......s...', '....ss...ss....', '......sss......'],
      ['......sss......', '....ss...ss....', '...s..r....s...', '...s..rr...s...', '...s....#..s...', '...s.......s...', '....ss...ss....', '......sss......']
    ],
    seq: [[0, 1100], [1, 200], [0, 160], [2, 200], [0, 160], [1, 160], [0, 700]]
  },
  // Космонавт — 10 игр: белый корпус, стеклянный шлем-пузырь; парит над подставкой, звёзды на экране мигают
  astro: {
    mat: WHITE,
    ears: ['#5ee6ff', '#5ee6ff'],
    lift: 8,
    motion: 'tfa-float',
    frames: [
      ['.#.............', '......ccc...#..', '.....ccccc.....', '.vv..ccccc..vv.', '..vvvvvvvvvvv..', '.....ccccc.....', '......ccc......', '.............#.'],
      ['.............#.', '.#....ccc......', '.....ccccc.....', '.vv..ccccc..vv.', '..vvvvvvvvvvv..', '.....ccccc.....', '......ccc......', '..#............']
    ],
    seq: every(2, 700)
  },
  // Рыцарь — 15 игр: сталь, плюмаж, по щели забрала бегает огонёк, меч в подставке и щит
  knight: {
    mat: STEEL,
    ears: ['#ff4b5c', '#ff4b5c'],
    frames: VISOR,
    seq: [...every(9, 80), ...every(7, 80).map(([i, ms]): [number, number] => [7 - i, ms])]
  },
  // Коллекционер — 25 игр: стоит на стопке коробок, на экране стопка растёт по одной
  collector: {
    mat: VINYL,
    ears: ['#a891ff', '#ff8ac6'],
    lift: 27,
    frames: [
      ['...............', '...............', '...............', '...............', '...............', '...yyy###yyy...', '...yyyyyyyyy...', '...............'],
      ['...............', '...............', '...............', '..bbbb###bbbb..', '..bbbbbbbbbbb..', '...yyy###yyy...', '...yyyyyyyyy...', '...............'],
      ['...............', '...ppp###ppp...', '...ppppppppp...', '..bbbb###bbbb..', '..bbbbbbbbbbb..', '...yyy###yyy...', '...yyyyyyyyy...', '...............']
    ],
    seq: [[2, 1800], [0, 420], [1, 420]]
  },
  // Легенда — 50 игр: перламутровый корпус, корона с мигающими камнями, плащ колышется, звезда вспыхивает
  legend: {
    mat: HOLO,
    ears: ['#ffd35c', '#ffd35c'],
    frames: [
      ['.......y.......', '......yyy......', '.yyyyyyyyyyyyy.', '...yyyyyyyyy...', '....yyyyyyy....', '...yyyy.yyyy...', '..yyy.....yyy..', '.yy.........yy.'],
      ['.......#.......', '......y#y......', '.yyyyy###yyyyy.', '...yyy###yyy...', '....yyy#yyy....', '...yyyy.yyyy...', '..yyy.....yyy..', '.yy.........yy.']
    ],
    seq: [[0, 1500], [1, 120], [0, 120], [1, 120]]
  },
  // Титан — 100 игр: каменная глыба с рогами вместо ушей, раскалённые трещины дышат, вокруг парят осколки, пламя живое
  titan: {
    mat: OBSIDIAN,
    ears: null,
    glow: '#ff7a2a',
    rx: 20,
    scale: 0.68,
    frames: [
      ['.......r.......', '......rr..r....', '.....rro.rr....', '....rrooorr....', '....rooyoor....', '....royyyor....', '.....oyyyo.....', '......ooo......'],
      ['......r........', '.....rr...r....', '....rror.rr....', '....rrooorr....', '....rooyoor....', '....royyyor....', '.....oyyyo.....', '......ooo......'],
      ['........r......', '....r..rr......', '....rr.orr.....', '....rrooorr....', '....rooyoor....', '....royyyor....', '.....oyyyo.....', '......ooo......']
    ],
    seq: every(3, 160)
  },
  // Перфекционист — первая игра на 100 %: весь золотой, счётчик добегает 98 → 99 → 100 и мигает, лавровый венок
  perfect: {
    mat: GOLD,
    ears: ['#fff6d6', '#fff6d6'],
    frames: [
      ['', '....yyy.yyy....', '....y.y.y.y....', '....yyy.yyy....', '......y.y.y....', '....yyy.yyy....'],
      ['', '....yyy.yyy....', '....y.y.y.y....', '....yyy.yyy....', '......y...y....', '....yyy.yyy....'],
      ['', '...y..yyy.yyy..', '..yy..y.y.y.y..', '...y..y.y.y.y..', '...y..y.y.y.y..', '..yyy.yyy.yyy..'],
      EMPTY
    ],
    seq: [[2, 2400], [0, 440], [1, 440], [2, 480], [3, 120], [2, 280], [3, 120]]
  },
  // Мастер — 5 игр на 100 %: стоит на пьедестале с огромным кубком на голове, сыплется конфетти
  master: {
    mat: PLATINUM,
    ears: ['#5ee6ff', '#ffd35c'],
    lift: 26,
    scale: 0.54,
    frames: [
      ['..y....y....y..', '...y.......y...', '......yy.......', '.....yyy.......', 'yy....yy.....yy', '......yy.......', '...y.yyyy..y...', '..y.........y..'],
      ['.......y.......', '.y...........y.', '......yy.......', '.....yyy.......', '......yy.......', '......yy.......', '.y...yyyy....y.', '...............']
    ],
    seq: every(2, 400)
  },
  // Спринтер — игра за три дня: бежит в наклоне, уши и повязка отброшены назад, ноги мелькают, молния бьёт
  sprinter: {
    mat: ORANGE,
    ears: ['#fff3c4', '#fff3c4'],
    earRot: [-52, -14],
    lean: 9,
    dx: 8,
    feet: false,
    motion: 'tfa-run',
    frames: [
      ['........yyy....', '.......yyy.....', '......yyy......', '.....yyyyyy....', '........yyy....', '.......yyy.....', '......yy.......', '.....y.........'],
      ['........###....', '.......###.....', '......###......', '.....######....', '........###....', '.......###.....', '......##.......', '.....#.........']
    ],
    seq: [[0, 520], [1, 80], [0, 80], [1, 80]]
  },
  // Марафонец — сто часов в одной игре: сидит, вытянув ноги, рядом с большими песочными часами — песок сыплется
  marathon: {
    mat: BLUE,
    ears: ['#ffffff', '#ffd35c'],
    earRot: [-34, 34],
    scale: 0.5,
    dx: -24,
    feet: false,
    frames: [
      ['....sssssss....', '.....syyys.....', '......sys......', '.......s.......', '......s.s......', '.....s...s.....', '....s.....s....', '....sssssss....'],
      ['....sssssss....', '.....s...s.....', '......sys......', '.......y.......', '......sys......', '.....s.y.s.....', '....s.yyy.s....', '....sssssss....'],
      ['....sssssss....', '.....s...s.....', '......s.s......', '.......s.......', '......s.s......', '.....syyys.....', '....syyyyys....', '....sssssss....']
    ],
    seq: [[0, 1000], [1, 1000], [2, 1600]]
  },
  // Ретро — три игры для PS2 и PS3: ламповый телевизор на ножках с ручками и комнатной антенной, по экрану шагает пришелец
  retro: {
    mat: BEIGE,
    ears: null,
    glow: '#4be3a0',
    rx: 14,
    feet: false,
    frames: [
      ['....n.....n....', '.....n...n.....', '....nnnnnnn....', '...nn.nnn.nn...', '..nnnnnnnnnnn..', '..n.nnnnnnn.n..', '..n.n.....n.n..', '.....nn.nn.....'],
      ['....n.....n....', '..n..n...n..n..', '..n.nnnnnnn.n..', '..nnn.nnn.nnn..', '..nnnnnnnnnnn..', '...nnnnnnnnn...', '....n.....n....', '...n.......n...']
    ],
    seq: every(2, 480)
  },
  // Сова — игра, пройденная ночью: перья-ушки, крылья, сидит на ветке перед луной, глаза на экране смотрят и моргают
  owl: {
    mat: NIGHT,
    ears: null,
    glow: '#ffe9a3',
    lift: 11,
    scale: 0.56,
    feet: false,
    frames: [
      ['.yyyyy...yyyyy.', '.y...y...y...y.', '.y.#.y...y.#.y.', '.y.#.y...y.#.y.', '.y...y...y...y.', '.yyyyy.o.yyyyy.', '.......o.......', '...............'],
      ['...............', '...............', '.yyyyy...yyyyy.', '.y.#.y...y.#.y.', '.y...y...y...y.', '.yyyyy.o.yyyyy.', '.......o.......', '...............'],
      ['...............', '...............', '...............', '.yyyyy...yyyyy.', '...............', '.......o.......', '.......o.......', '...............'],
      ['.yyyyy...yyyyy.', '.y...y...y...y.', '.y#..y...y#..y.', '.y#..y...y#..y.', '.y...y...y...y.', '.yyyyy.o.yyyyy.', '.......o.......', '...............'],
      ['.yyyyy...yyyyy.', '.y...y...y...y.', '.y..#y...y..#y.', '.y..#y...y..#y.', '.y...y...y...y.', '.yyyyy.o.yyyyy.', '.......o.......', '...............']
    ],
    seq: [[0, 1700], [3, 700], [0, 300], [4, 700], [0, 900], [1, 80], [2, 120], [1, 80]]
  },
  // Хет-трик — три игры за месяц: цилиндр фокусника, из которого одна за другой вылетают три звезды, счёт 1-2-3 на экране
  hattrick: {
    mat: FLAME,
    ears: ['#ffd35c', '#ffa23a'],
    scale: 0.58,
    frames: [
      big(['.y.', 'yy.', '.y.', '.y.', 'yyy']),
      big(['yyy', '..y', 'yyy', 'y..', 'yyy']),
      big(['yyy', '..y', 'yyy', '..y', 'yyy']),
      ['...............', '..y....y....y..', '.yyy..yyy..yyy.', '..y....y....y..', '...............', '.....ooooo.....', '......ooo......', '...............']
    ],
    seq: [[3, 1500], [0, 440], [1, 440], [2, 440]]
  }
}

/** Цвет редкости: обычная, редкая, эпическая, легендарная */
const TIER = ['#ffffff', '#7fc4ff', '#b79bff', '#ffd35c']

const BASE_Y = 216
/** Низ ножек в координатах Тиви (корпус кончается на 224, его объём — на 231) */
const FEET_BOT = 240

/** Переменные для классов tfa-* */
const vars = (o: Record<string, string | number>) => o as CSSProperties

/** Четырёхлучевая искра */
const spark = (cx: number, cy: number, r: number) => {
  const k = r * 0.22
  return `M${cx} ${cy - r}L${cx + k} ${cy - k}L${cx + r} ${cy}L${cx + k} ${cy + k}L${cx} ${cy + r}L${cx - k} ${cy + k}L${cx - r} ${cy}L${cx - k} ${cy - k}Z`
}

/** Пятиконечная звезда */
const star = (cx: number, cy: number, r: number) => {
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2
    const rr = i % 2 ? r * 0.45 : r
    pts.push(`${(cx + Math.cos(a) * rr).toFixed(1)} ${(cy + Math.sin(a) * rr).toFixed(1)}`)
  }
  return `M${pts.join('L')}Z`
}

/** Номер кадра экрана: в окне фигурки идёт по seq, на полке — первый кадр */
function useSeq(seq: [number, number][] | undefined, on: boolean) {
  const [i, setI] = useState(0)
  useEffect(() => {
    setI(0)
    if (!on || !seq) return
    let k = 0
    let timer = 0
    const next = () => {
      timer = window.setTimeout(() => {
        k = (k + 1) % seq.length
        setI(k)
        next()
      }, seq[k][1])
    }
    next()
    return () => clearTimeout(timer)
  }, [on, seq])
  return seq ? seq[i % seq.length][0] : 0
}

export function TiviFigure({ id, locked = false, live = false, className = '' }: { id: FigureId; locked?: boolean; live?: boolean; className?: string }) {
  const p = `f${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const look = LOOKS[id]
  const index = FIGURES.findIndex((f) => f.id === id)
  const tier = FIGURES[index]?.tier ?? 1
  const trim = TIER[tier - 1]
  const no = String(index + 1).padStart(2, '0')
  const alive = live && !locked
  const frame = useSeq(look.seq, alive)
  const S = look.scale ?? 0.62
  const lift = look.lift ?? 0
  const dx = look.dx ?? 0
  const rx = look.rx ?? 38
  const ty = BASE_Y - 2 - FEET_BOT * S - lift
  const tx = 100 - 128 * S + dx
  const mat = look.mat
  const glow = look.glow ?? look.ears?.[1] ?? '#fff'
  const body = { x: 22, y: 76, width: 212, height: 148, rx }
  return (
    <svg className={`tfig tfig-${id} tfig-tier${tier} ${locked ? 'is-locked' : ''} ${alive ? 'is-live' : ''} ${className}`} viewBox="0 0 200 250" aria-hidden>
      <defs>
        <linearGradient id={`${p}body`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mat.body[0]} />
          <stop offset="1" stopColor={mat.body[1]} />
        </linearGradient>
        {/* Тень к низу корпуса — он круглится, а не стоит плоской плашкой */}
        <linearGradient id={`${p}ao`} x1="0" y1="0" x2="0" y2="1">
          <stop offset=".5" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".38" />
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
          <stop offset="0" stopColor="#fff" stopOpacity={mat.rim} />
          <stop offset=".35" stopColor="#fff" stopOpacity=".08" />
          <stop offset=".75" stopColor="#fff" stopOpacity=".02" />
          <stop offset="1" stopColor="#fff" stopOpacity={mat.rim * 0.35} />
        </linearGradient>
        <radialGradient id={`${p}gloss`} cx=".3" cy=".18" r=".55">
          <stop offset="0" stopColor="#fff" stopOpacity={mat.gloss} />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${p}sweep`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset=".5" stopColor="#fff" stopOpacity=".5" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${p}baseTop`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={id === 'perfect' ? '#5a4214' : '#262b3a'} />
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
        <linearGradient id={`${p}wood`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9a6a3c" />
          <stop offset="1" stopColor="#4e3018" />
        </linearGradient>
        <clipPath id={`${p}bodyclip`}>
          <rect {...body} />
        </clipPath>
        <clipPath id={`${p}scr`}>
          <rect x="34" y="88" width="188" height="124" rx="26" />
        </clipPath>
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
        <filter id={`${p}haze`} x="-40%" y="-120%" width="180%" height="340%">
          <feGaussianBlur stdDeviation="7" />
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
        {id === 'owl' && (
          <radialGradient id={`${p}moon`} cx=".4" cy=".35" r=".7">
            <stop offset="0" stopColor="#fffbe6" />
            <stop offset="1" stopColor="#f2d98a" />
          </radialGradient>
        )}
      </defs>

      <Base p={p} id={id} no={no} tier={tier} trim={trim} />
      {/* Свет от ушей и экрана ложится на подставку; под ним — тень самой фигурки */}
      <ellipse className="tfig-haze" cx={100 + dx} cy={BASE_Y - lift + 2} rx="56" ry="9" fill={glow} opacity=".5" filter={`url(#${p}haze)`} />
      <ellipse cx={100 + dx} cy={BASE_Y - lift} rx={S * 94} ry="7" fill="#000" opacity=".5" filter={`url(#${p}soft)`} />

      <g className="tfig-body">
        {id === 'owl' && <Moon p={p} />}
        {id === 'collector' && <CaseStack />}
        {id === 'finisher' && <Flag p={p} />}
        {id === 'knight' && <Sword p={p} />}
        {id === 'perfect' && <Laurel p={p} />}
        {id === 'explorer' && <MapScroll />}
        {id === 'sprinter' && <SpeedLines />}
        {id === 'retro' && <Joystick />}
        {id === 'master' && <Podium p={p} />}
        {id === 'owl' && <Branch p={p} />}
        {id === 'titan' && <Shards />}
        <g transform={`translate(${tx} ${ty}) scale(${S})`}>
          <g transform={look.lean ? `rotate(${look.lean} 128 240)` : undefined}>
            <g className={look.motion}>
              {id === 'legend' && <Cape p={p} />}
              {id === 'retro' && <RabbitEars p={p} />}
              {id === 'retro' && <TvLegs p={p} />}
              {id === 'sprinter' && <BandTails />}
              {id === 'owl' && <OwlBack p={p} />}
              {id === 'titan' && <Horns p={p} />}
              {look.ears && (
                <>
                  <Ear p={p} side={0} color={look.ears[0]} mat={mat} rot={look.earRot?.[0]} />
                  <Ear p={p} side={1} color={look.ears[1]} mat={mat} rot={look.earRot?.[1]} />
                </>
              )}
              {look.feet !== false && (
                <>
                  <Foot p={p} x={64} mat={mat} />
                  <Foot p={p} x={158} mat={mat} />
                </>
              )}
              {id === 'sprinter' && <RunFeet p={p} mat={mat} />}
              {/* Объём корпуса снизу и сам корпус */}
              <rect {...body} y="83" fill={mat.side} />
              <rect {...body} fill={`url(#${p}body)`} />
              {id === 'legend' && <rect {...body} fill={`url(#${p}holo)`} />}
              {id === 'owl' && <NightSky p={p} />}
              {id === 'titan' && <Cracks p={p} />}
              {(id === 'sprinter' || id === 'marathon') && <rect x="22" y="94" width="212" height="15" fill={id === 'sprinter' ? '#e2394d' : '#f4f6fb'} clipPath={`url(#${p}bodyclip)`} />}
              <rect {...body} fill={`url(#${p}ao)`} />
              <rect {...body} fill={`url(#${p}gloss)`} />
              <rect x="23.5" y="77.5" width="209" height="145" rx={Math.max(2, rx - 1.5)} fill="none" stroke={`url(#${p}rim)`} strokeWidth="3" />
              {/* Блики глянцевого винила: дуга по верхнему краю и короткая полоска на правом боку */}
              {rx >= 30 && <path d="M46 92Q50 82 72 81L150 81" fill="none" stroke="#fff" strokeOpacity={mat.gloss * 1.1} strokeWidth="4" strokeLinecap="round" />}
              {rx >= 30 && <path d="M224 118Q228 150 223 186" fill="none" stroke="#fff" strokeOpacity={mat.gloss * 0.7} strokeWidth="3" strokeLinecap="round" />}
              {id === 'retro' ? (
                <>
                  {/* У лампового телевизора экран меньше и сдвинут влево — справа панель с ручками */}
                  <g transform="translate(36 150) scale(.8) translate(-34 -150)">
                    <Screen p={p} grid={look.frames[frame]} />
                    <g clipPath={`url(#${p}scr)`}>
                      <rect className="tfa-scan" x="34" y="84" width="188" height="12" fill="#fff" opacity=".08" />
                    </g>
                  </g>
                  <TvPanel />
                </>
              ) : (
                <Screen p={p} grid={look.frames[frame]} />
              )}
              {/* Блик, который пробегает по корпусу в окне фигурки */}
              <g clipPath={`url(#${p}bodyclip)`}>
                <rect className="tfig-sweep" x="-70" y="60" width="62" height="190" fill={`url(#${p}sweep)`} transform="skewX(-18)" opacity="0" />
              </g>
              {id === 'explorer' && <PithHelmet />}
              {id === 'knight' && <Plume />}
              {id === 'legend' && <Crown p={p} />}
              {id === 'astro' && <Bubble p={p} />}
              {id === 'owl' && <Talons />}
              {id === 'master' && <BigCup p={p} />}
              {id === 'hattrick' && <TopHat p={p} />}
              {id === 'marathon' && <SitFeet p={p} mat={mat} />}
              {id === 'marathon' && <Sweat />}
            </g>
          </g>
        </g>
        {id === 'knight' && <Shield p={p} />}
        {id === 'marathon' && <Hourglass p={p} />}
        {id === 'master' && <Confetti />}
        {id === 'hattrick' && <Wand />}
        {id === 'titan' && <Embers />}
        {id === 'owl' && <NightStars />}
        {/* Искры легендарной фигурки */}
        {tier === 4 && (
          <g className="tfig-sparks" fill={trim}>
            <path d={spark(22, 96, 7)} />
            <path d={spark(180, 44, 5)} />
            <path d={spark(186, 150, 4)} opacity=".8" />
            <path d={spark(14, 168, 3.5)} opacity=".7" />
          </g>
        )}
      </g>
    </svg>
  )
}

/** Круглая подставка: ободок цвета редкости (у эпических и легендарных — двойной) и табличка с номером */
function Base({ p, id, no, tier, trim }: { p: string; id: FigureId; no: string; tier: number; trim: string }) {
  return (
    <g className="tfig-base">
      <ellipse cx="100" cy="234" rx="74" ry="13" fill="#05070b" />
      <rect x="26" y={BASE_Y} width="148" height="18" fill={`url(#${p}baseSide)`} />
      {tier >= 3 && <path d={`M26 ${BASE_Y + 9}A74 13 0 0 0 174 ${BASE_Y + 9}`} fill="none" stroke={trim} strokeOpacity=".55" strokeWidth="1.2" />}
      <ellipse cx="100" cy={BASE_Y} rx="74" ry="13" fill={`url(#${p}baseTop)`} />
      {/* Глянец подставки: светлая дуга на дальнем крае */}
      <path d={`M40 ${BASE_Y - 6}A74 13 0 0 1 160 ${BASE_Y - 6}`} fill="none" stroke="#fff" strokeOpacity=".1" strokeWidth="3" />
      <ellipse cx="100" cy={BASE_Y} rx="73.5" ry="12.5" fill="none" stroke={id === 'perfect' ? '#ffe08a' : trim} strokeOpacity={tier === 1 && id !== 'perfect' ? 0.22 : 0.8} strokeWidth={tier === 1 ? 1 : 1.4} />
      <rect x="86" y="222" width="28" height="9" rx="2" fill={trim} fillOpacity={tier === 1 ? 0.07 : 0.16} stroke={trim} strokeOpacity={tier === 1 ? 0.12 : 0.5} strokeWidth=".6" />
      <text x="100" y="229" textAnchor="middle" fontSize="6.5" fontWeight="600" letterSpacing=".8" fill={tier === 1 ? '#fff' : trim} fillOpacity={tier === 1 ? 0.6 : 0.95}>
        № {no}
      </text>
    </g>
  )
}

/** Ухо — короткая толстая капсула с «жидкостью» своего цвета, наклонено наружу, как у Тиви; жидкость светится */
function Ear({ p, side, color, mat, rot }: { p: string; side: 0 | 1; color: string; mat: Material; rot?: number }) {
  const x = side ? 192 : 64
  return (
    <g transform={`rotate(${rot ?? (side ? 20 : -20)} ${x} 90)`}>
      <rect x={x - 19} y="43" width="38" height="50" rx="19" fill={mat.side} />
      <rect x={x - 19} y="40" width="38" height="50" rx="19" fill={`url(#${p}body)`} />
      <rect x={x - 18} y="41" width="36" height="48" rx="18" fill="none" stroke="#fff" strokeOpacity={mat.rim * 0.5} strokeWidth="1.5" />
      <rect x={x - 11} y="46" width="22" height="30" rx="11" fill="#05070c" />
      <g clipPath={`url(#${p}win${side})`} filter={`url(#${p}glow)`}>
        <g className="tfig-liquid">
          <rect x={x - 11} y="50" width="22" height="26" fill={color} />
          <rect x={x - 11} y="50" width="22" height="3" fill="#fff" opacity=".45" />
        </g>
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

/** Экран: картинка точками с лёгким свечением; утоплен в корпус — сверху на него падает тень рамки */
function Screen({ p, grid }: { p: string; grid: string[] }) {
  const dots: ReactNode[] = []
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 15; x++) {
      const ch = grid[y]?.[x] ?? '.'
      const on = ch !== '.'
      dots.push(<circle key={`${x}.${y}`} className={on ? 'tfig-dot' : undefined} cx={128 + (x - 7) * 11.5} cy={150 + (y - 3.5) * 11.5} r="4.4" fill={on ? DOT[ch] : '#fff'} opacity={on ? 1 : 0.05} />)
    }
  return (
    <>
      <rect x="34" y="88" width="188" height="124" rx="26" fill="#05070c" />
      <g filter={`url(#${p}glow)`}>
        <g className="tfig-dots">{dots}</g>
      </g>
      <path d="M40 112Q40 94 60 94L196 94Q216 94 216 112" fill="none" stroke="#000" strokeOpacity=".55" strokeWidth="5" />
      <rect x="34.75" y="88.75" width="186.5" height="122.5" rx="25.25" fill="none" stroke="#fff" strokeOpacity=".12" strokeWidth="1.5" />
    </>
  )
}

// ───────────── Спринтер ─────────────

/** Линии скорости за спринтером: штрихи бегут назад */
function SpeedLines() {
  return (
    <g stroke="#fff" strokeLinecap="round" strokeDasharray="14 10">
      <line className="tfa-dash" x1="0" y1="118" x2="34" y2="118" strokeWidth="2.6" strokeOpacity=".7" />
      <line className="tfa-dash" style={vars({ '--ms': '520ms' })} x1="2" y1="142" x2="30" y2="142" strokeWidth="2.2" strokeOpacity=".45" />
      <line className="tfa-dash" style={vars({ '--ms': '340ms' })} x1="0" y1="166" x2="32" y2="166" strokeWidth="2.6" strokeOpacity=".6" />
      <circle className="tfa-blink" style={vars({ '--ms': '320ms' })} cx="30" cy="210" r="5" fill="#fff" stroke="none" opacity=".35" />
      <circle className="tfa-blink" style={vars({ '--ms': '320ms', '--del': '-160ms' })} cx="18" cy="204" r="3.5" fill="#fff" stroke="none" opacity=".25" />
    </g>
  )
}

/** Концы красной повязки, развевающиеся за спиной (в координатах Тиви) */
function BandTails() {
  return (
    <g className="tfa-flag" style={vars({ '--o': '100% 50%', '--ms': '260ms', '--a': '7deg' })}>
      <path d="M26 98C2 92 -14 104 -44 94L-40 110C-12 116 4 106 26 112Z" fill="#e2394d" />
      <path d="M26 106C6 110 -8 122 -34 124L-28 136C-4 132 10 122 28 118Z" fill="#b81f33" />
    </g>
  )
}

/** Ноги бегуна: передняя на земле, задняя отброшена назад с крылышком; в окне они мелькают по очереди */
function RunFeet({ p, mat }: { p: string; mat: Material }) {
  return (
    <>
      <g className="tfa-kick" style={vars({ '--del': '-160ms' })}>
        <g transform="translate(-22 -14) rotate(-32 60 226)">
          <Foot p={p} x={44} mat={mat} />
          <path d="M40 216C24 210 18 198 20 190C28 196 36 200 46 204ZM42 222C26 222 16 214 14 206C24 210 34 212 44 212Z" fill="#fff" />
        </g>
      </g>
      <g className="tfa-kick">
        <Foot p={p} x={158} mat={mat} />
      </g>
    </>
  )
}

// ───────────── Марафонец ─────────────

/** Сидит: подошвы вытянутых вперёд ног смотрят на зрителя */
function SitFeet({ p, mat }: { p: string; mat: Material }) {
  return (
    <>
      {[70, 186].map((x) => (
        <g key={x}>
          <ellipse cx={x} cy="230" rx="27" ry="20" fill={mat.side} />
          <ellipse cx={x} cy="226" rx="27" ry="20" fill={`url(#${p}body)`} />
          <ellipse cx={x} cy="228" rx="17" ry="11" fill="#fff" opacity=".28" />
          <ellipse cx={x} cy="226" rx="26" ry="19" fill="none" stroke="#fff" strokeOpacity=".4" strokeWidth="1.5" />
        </g>
      ))}
    </>
  )
}

/** Капли пота разлетаются от повязки */
function Sweat() {
  const drop = (x: number, y: number) => `M${x} ${y - 9}C${x + 7} ${y} ${x + 6} ${y + 7} ${x} ${y + 7}C${x - 6} ${y + 7} ${x - 7} ${y} ${x} ${y - 9}Z`
  return (
    <g fill="#bfe8ff">
      <path className="tfa-blink" style={vars({ '--ms': '900ms' })} d={drop(8, 86)} />
      <path className="tfa-blink" style={vars({ '--ms': '900ms', '--del': '-450ms' })} d={drop(250, 110)} />
      <path className="tfa-blink" style={vars({ '--ms': '900ms', '--del': '-220ms' })} d={drop(-2, 128)} />
    </g>
  )
}

/** Большие песочные часы рядом: песок перетекает сверху вниз */
function Hourglass({ p }: { p: string }) {
  return (
    <g>
      <ellipse cx="160" cy="217" rx="24" ry="4" fill="#000" opacity=".5" />
      <line x1="143" y1="128" x2="143" y2="212" stroke={`url(#${p}wood)`} strokeWidth="3.4" />
      <line x1="177" y1="128" x2="177" y2="212" stroke={`url(#${p}wood)`} strokeWidth="3.4" />
      <path d="M146 130L174 130L163 167L163 173L174 210L146 210L157 173L157 167Z" fill="#bfe3ff" fillOpacity=".16" stroke="#fff" strokeOpacity=".7" strokeWidth="1.6" strokeLinejoin="round" />
      <path className="tfa-drain" d="M150 137L170 137L161.5 166L158.5 166Z" fill="#ffd35c" />
      <path className="tfa-pile" d="M149 208L171 208L160 184Z" fill="#ffd35c" />
      <line className="tfa-dash" style={vars({ '--ms': '300ms', '--len': '-8px' })} x1="160" y1="167" x2="160" y2="206" stroke="#ffe9a3" strokeWidth="1.6" strokeDasharray="3 5" />
      <path d="M150 134L156 134L153 148Z" fill="#fff" opacity=".5" />
      <rect x="138" y="122" width="44" height="8" rx="3" fill={`url(#${p}wood)`} />
      <rect x="138" y="122" width="44" height="2.4" rx="1.2" fill="#fff" opacity=".3" />
      <rect x="138" y="210" width="44" height="8" rx="3" fill={`url(#${p}wood)`} />
      <rect x="138" y="210" width="44" height="2.4" rx="1.2" fill="#fff" opacity=".3" />
    </g>
  )
}

// ───────────── Ретро ─────────────

/** Комнатная антенна «рожки» на старом телевизоре: рожки покачиваются, будто ловят сигнал */
function RabbitEars({ p }: { p: string }) {
  return (
    <g>
      <g className="tfa-sway" style={vars({ '--o': '100% 100%', '--a': '4deg', '--ms': '700ms' })}>
        <line x1="118" y1="80" x2="84" y2="4" stroke={`url(#${p}metal)`} strokeWidth="5" strokeLinecap="round" />
        <circle cx="84" cy="4" r="7" fill="#dfe4ee" />
      </g>
      <g className="tfa-sway" style={vars({ '--o': '0% 100%', '--a': '3deg', '--ms': '900ms' })}>
        <line x1="138" y1="80" x2="180" y2="10" stroke={`url(#${p}metal)`} strokeWidth="5" strokeLinecap="round" />
        <circle cx="180" cy="10" r="7" fill="#dfe4ee" />
      </g>
      <ellipse cx="128" cy="78" rx="30" ry="10" fill="#57503c" />
      <ellipse cx="128" cy="75" rx="30" ry="8" fill="#7a7156" />
    </g>
  )
}

/** Расставленные деревянные ножки лампового телевизора */
function TvLegs({ p }: { p: string }) {
  return (
    <g fill={`url(#${p}wood)`}>
      <path d="M44 216L74 216L50 240L36 240Z" />
      <path d="M212 216L182 216L206 240L220 240Z" />
      <path d="M100 216L120 216L116 236L104 236Z" opacity=".7" />
      <path d="M136 216L156 216L152 236L140 236Z" opacity=".7" />
    </g>
  )
}

/** Панель справа от экрана: две ручки (верхняя щёлкает по каналам) и решётка динамика */
function TvPanel() {
  return (
    <g>
      <rect x="194" y="92" width="32" height="118" rx="8" fill="#000" opacity=".16" />
      <circle cx="210" cy="112" r="11" fill="#3b3628" />
      <circle cx="210" cy="112" r="11" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="1.4" />
      <g className="tfa-spin" style={vars({ '--o': '50% 50%' })}>
        <circle cx="210" cy="112" r="10" fill="none" />
        <line x1="210" y1="112" x2="210" y2="103" stroke="#f4ecd6" strokeWidth="3" strokeLinecap="round" />
      </g>
      <circle cx="210" cy="140" r="9" fill="#3b3628" />
      <line x1="210" y1="140" x2="216" y2="135" stroke="#f4ecd6" strokeWidth="2.6" strokeLinecap="round" />
      {[160, 168, 176, 184, 192].map((y) => (
        <line key={y} x1="201" y1={y} x2="219" y2={y} stroke="#3b3628" strokeWidth="3" strokeLinecap="round" />
      ))}
      <circle className="tfa-blink" style={vars({ '--ms': '960ms' })} cx="210" cy="203" r="3" fill="#ff4b5c" />
    </g>
  )
}

/** Аркадный джойстик у ног: ручку дёргает туда-сюда */
function Joystick() {
  return (
    <g>
      <ellipse cx="30" cy="221" rx="17" ry="4" fill="#000" opacity=".5" />
      <rect x="14" y="206" width="32" height="14" rx="3" fill="#2a2e3a" />
      <rect x="14" y="206" width="32" height="3" rx="1.5" fill="#fff" opacity=".18" />
      <g className="tfa-sway" style={vars({ '--o': '50% 100%', '--a': '14deg', '--ms': '480ms' })}>
        <line x1="30" y1="207" x2="30" y2="186" stroke="#aab2c0" strokeWidth="3" strokeLinecap="round" />
        <circle cx="30" cy="183" r="7" fill="#e2394d" />
        <circle cx="27.6" cy="180.6" r="2.2" fill="#fff" opacity=".6" />
      </g>
      <circle className="tfa-blink" style={vars({ '--ms': '480ms' })} cx="41" cy="212" r="2.2" fill="#5aa9ff" />
    </g>
  )
}

// ───────────── Сова ─────────────

/** Большая луна за совой */
function Moon({ p }: { p: string }) {
  return (
    <g>
      <circle cx="128" cy="92" r="66" fill="#ffe9a3" opacity=".22" filter={`url(#${p}haze)`} />
      <circle cx="128" cy="92" r="58" fill={`url(#${p}moon)`} />
      <circle cx="96" cy="66" r="8" fill="#d9bf6c" opacity=".5" />
      <circle cx="160" cy="58" r="5" fill="#d9bf6c" opacity=".5" />
      <circle cx="166" cy="104" r="10" fill="#d9bf6c" opacity=".4" />
      <circle cx="84" cy="110" r="4" fill="#d9bf6c" opacity=".5" />
    </g>
  )
}

/** Ветка, на которой сидит сова, с листком */
function Branch({ p }: { p: string }) {
  return (
    <g>
      <path d="M10 206C50 198 150 198 192 204L192 213C150 208 50 208 10 216Z" fill={`url(#${p}wood)`} />
      <path d="M16 207C54 200 146 200 188 205" fill="none" stroke="#fff" strokeOpacity=".25" strokeWidth="1.6" />
      <path d="M164 203C170 192 178 188 184 182" fill="none" stroke="#6b4524" strokeWidth="3" strokeLinecap="round" />
      <g className="tfa-sway" style={vars({ '--o': '0% 100%', '--a': '9deg', '--ms': '1200ms' })}>
        <path d="M184 182C186 170 196 166 200 168C200 178 194 184 184 182Z" fill="#4be3a0" />
      </g>
    </g>
  )
}

/** Перья-ушки и сложенные крылья по бокам (за корпусом) */
function OwlBack({ p }: { p: string }) {
  return (
    <g>
      <path d="M36 104L26 30L100 78Z" fill={`url(#${p}body)`} stroke="#8f84e6" strokeWidth="2" strokeLinejoin="round" />
      <path d="M48 88L40 50L78 78Z" fill="#a891ff" />
      <path d="M220 104L230 30L156 78Z" fill={`url(#${p}body)`} stroke="#8f84e6" strokeWidth="2" strokeLinejoin="round" />
      <path d="M208 88L216 50L178 78Z" fill="#a891ff" />
      <g className="tfa-sway" style={vars({ '--o': '100% 0%', '--a': '5deg', '--ms': '1100ms' })}>
        <path d="M30 108C-18 124 -22 196 22 222C30 190 34 150 30 108Z" fill="#2c2666" stroke="#8f84e6" strokeWidth="2" />
        <path d="M14 140C6 160 6 184 14 204M2 150C-4 168 -2 186 6 200" fill="none" stroke="#8f84e6" strokeOpacity=".7" strokeWidth="2" />
      </g>
      <g className="tfa-sway" style={vars({ '--o': '0% 0%', '--a': '5deg', '--ms': '1100ms', '--del': '-1100ms' })}>
        <path d="M226 108C274 124 278 196 234 222C226 190 222 150 226 108Z" fill="#2c2666" stroke="#8f84e6" strokeWidth="2" />
        <path d="M242 140C250 160 250 184 242 204M254 150C260 168 258 186 250 200" fill="none" stroke="#8f84e6" strokeOpacity=".7" strokeWidth="2" />
      </g>
    </g>
  )
}

/** Когти, обхватившие ветку */
function Talons() {
  return (
    <g fill="#ffa23a" stroke="#a8590c" strokeWidth="1.2">
      {[66, 82, 98, 158, 174, 190].map((x) => (
        <rect key={x} x={x - 6} y="220" width="12" height="22" rx="6" />
      ))}
    </g>
  )
}

/** Звёзды ночного неба на корпусе совы */
function NightSky({ p }: { p: string }) {
  const stars = [
    [44, 98, 2.2],
    [222, 104, 1.8],
    [30, 150, 1.6],
    [228, 168, 2.2],
    [40, 206, 1.8],
    [210, 214, 1.5],
    [128, 82, 1.6]
  ]
  return (
    <g clipPath={`url(#${p}bodyclip)`} fill="#fff3c4">
      {stars.map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} opacity={0.5 + (i % 3) * 0.2} />
      ))}
    </g>
  )
}

/** Звёзды вокруг совы мигают по очереди */
function NightStars() {
  const at = [
    [18, 60, 5],
    [186, 34, 6],
    [30, 150, 3.5],
    [184, 150, 4],
    [60, 22, 3.5]
  ]
  return (
    <g fill="#fff3c4">
      {at.map(([x, y, r], i) => (
        <path key={i} className="tfa-blink" style={vars({ '--ms': '1400ms', '--del': `${-i * 280}ms` })} d={spark(x, y, r)} />
      ))}
    </g>
  )
}

// ───────────── Титан ─────────────

/** Раскалённые трещины в обсидиане: жар в них дышит */
function Cracks({ p }: { p: string }) {
  const d = 'M22 120L52 132L44 158L70 170M234 104L206 118L214 142L192 150M60 224L74 204L64 190M196 224L186 206L198 192M118 76L124 88M22 196L40 190'
  return (
    <g clipPath={`url(#${p}bodyclip)`} fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path className="tfa-pulse" d={d} stroke="#ff5a1a" strokeWidth="9" opacity=".45" filter={`url(#${p}soft)`} />
      <path d={d} stroke="#ffb347" strokeWidth="2.6" />
    </g>
  )
}

/** Рога вместо ушей: каменные, с раскалёнными кольцами */
function Horns({ p }: { p: string }) {
  const horn = (
    <>
      <path d="M36 100C-2 88 -14 36 18 -6C22 34 44 58 92 74Z" fill="#4a3a46" stroke="#ff7a2a" strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M6 50C14 52 20 50 26 44M10 22C16 26 22 26 26 22M22 76C30 74 36 70 40 64" fill="none" stroke="#ffb347" strokeWidth="2.4" strokeLinecap="round" />
    </>
  )
  return (
    <g>
      {horn}
      <g transform="translate(256 0) scale(-1 1)">{horn}</g>
      {/* Каменный гребень между рогами */}
      <path d="M96 78L108 54L122 78ZM118 78L130 46L142 78ZM138 78L150 58L160 78Z" fill="#4a3a46" stroke="#ff7a2a" strokeWidth="2" strokeLinejoin="round" />
    </g>
  )
}

/** Осколки породы парят вокруг титана */
function Shards() {
  const list: [string, number][] = [
    ['M8 150L20 140L24 156L12 162Z', 0],
    ['M176 118L190 112L192 128L180 132Z', -700],
    ['M180 178L192 174L190 190Z', -300],
    ['M10 96L20 92L18 106Z', -1100]
  ]
  return (
    <g>
      {list.map(([d, del], i) => (
        <path key={i} className="tfa-bob" style={vars({ '--y': '-7px', '--ms': '1500ms', '--del': `${del}ms` })} d={d} fill="#1c1622" stroke="#ff7a2a" strokeWidth="1.4" strokeLinejoin="round" />
      ))}
    </g>
  )
}

/** Искры от жара поднимаются вверх */
function Embers() {
  const at = [
    [40, 200, 0],
    [72, 206, -500],
    [128, 204, -900],
    [160, 200, -250],
    [100, 208, -1300]
  ]
  return (
    <g fill="#ffb347">
      {at.map(([x, y, del], i) => (
        <circle key={i} className="tfa-rise" style={vars({ '--del': `${del}ms`, '--y': `${-70 - (i % 3) * 20}px` })} cx={x} cy={y} r={1.6 + (i % 2) * 0.6} opacity="0" />
      ))}
    </g>
  )
}

// ───────────── Мастер ─────────────

/** Пьедестал почёта: фигурка стоит на первой ступени */
function Podium({ p }: { p: string }) {
  return (
    <g>
      <rect x="22" y="202" width="26" height="15" rx="2" fill="#aeb9c9" />
      <rect x="152" y="207" width="26" height="10" rx="2" fill="#c98b5a" />
      <rect x="44" y="190" width="112" height="27" rx="3" fill={`url(#${p}gold)`} />
      <rect x="44" y="190" width="112" height="4" rx="2" fill="#fff" opacity=".55" />
      <text x="100" y="212" textAnchor="middle" fontSize="18" fontWeight="800" fill="#7a5410">
        1
      </text>
      <text x="35" y="214" textAnchor="middle" fontSize="9" fontWeight="800" fill="#5b6676">
        2
      </text>
      <text x="165" y="215.5" textAnchor="middle" fontSize="7" fontWeight="800" fill="#6e4322">
        3
      </text>
    </g>
  )
}

/** Огромный кубок на голове между ушами; на нём играют блики */
function BigCup({ p }: { p: string }) {
  return (
    <g>
      <path d="M94 -26C60 -26 60 22 100 26M162 -26C196 -26 196 22 156 26" fill="none" stroke="#e0b340" strokeWidth="8" strokeLinecap="round" />
      <path d="M88 -40L168 -40C168 12 152 40 128 40C104 40 88 12 88 -40Z" fill={`url(#${p}gold)`} stroke="#8a5d10" strokeWidth="2" />
      <ellipse cx="128" cy="-40" rx="40" ry="7" fill="#fff6d0" stroke="#8a5d10" strokeWidth="2" />
      <path d="M100 -28C100 0 106 18 116 28" fill="none" stroke="#fff" strokeOpacity=".75" strokeWidth="5" strokeLinecap="round" />
      <path d={star(132, -4, 13)} fill="#fff6d0" stroke="#8a5d10" strokeWidth="1.4" />
      <rect x="120" y="40" width="16" height="20" fill="#c9972a" />
      <rect x="100" y="58" width="56" height="20" rx="5" fill={`url(#${p}gold)`} stroke="#8a5d10" strokeWidth="2" />
      <path className="tfa-blink" style={vars({ '--ms': '1100ms' })} d={spark(92, -36, 12)} fill="#fff" />
      <path className="tfa-blink" style={vars({ '--ms': '1100ms', '--del': '-550ms' })} d={spark(170, 6, 9)} fill="#fff" />
    </g>
  )
}

/** Конфетти сыплется сверху */
function Confetti() {
  const colors = ['#ff4b5c', '#5ee6ff', '#ffd35c', '#a891ff', '#4be3a0', '#ff8ac6']
  return (
    <g>
      {Array.from({ length: 12 }, (_, i) => (
        <rect
          key={i}
          className="tfa-fall"
          style={vars({ '--del': `${-i * 260}ms`, '--y': `${150 + (i % 3) * 16}px`, '--x': `${((i % 4) - 1.5) * 8}px` })}
          x={14 + ((i * 53) % 172)}
          y={22 + (i % 4) * 9}
          width={i % 2 ? 5 : 3.2}
          height={i % 2 ? 3.2 : 6}
          fill={colors[i % colors.length]}
          opacity="0"
        />
      ))}
    </g>
  )
}

// ───────────── Хет-трик ─────────────

/** Цилиндр фокусника набекрень; из него по очереди вылетают три звезды */
function TopHat({ p }: { p: string }) {
  const fly = [
    { cx: 56, cy: -52, x: 72, y: 34, del: 0 },
    { cx: 128, cy: -88, x: 0, y: 70, del: -700 },
    { cx: 200, cy: -52, x: -72, y: 34, del: -1400 }
  ]
  return (
    <g>
      <g transform="rotate(-9 128 78)">
        {fly.map((s, i) => (
          <g key={i} className="tfa-pop" style={vars({ '--x': `${s.x}px`, '--y': `${s.y}px`, '--del': `${s.del}ms` })}>
            <path d={star(s.cx, s.cy, 21)} fill={`url(#${p}gold)`} stroke="#8a5d10" strokeWidth="2" strokeLinejoin="round" />
          </g>
        ))}
        <path d="M82 76L76 -30C76 -44 180 -44 180 -30L174 76Z" fill="#12141b" />
        <ellipse cx="128" cy="-32" rx="52" ry="11" fill="#2a2e3a" />
        <ellipse cx="128" cy="-32" rx="40" ry="6.5" fill="#05070c" />
        <path d="M80 44L176 44L175 66L81 66Z" fill="#e2394d" />
        <path d="M92 -16C90 12 92 30 94 40" fill="none" stroke="#fff" strokeOpacity=".3" strokeWidth="6" strokeLinecap="round" />
        <ellipse cx="128" cy="76" rx="84" ry="14" fill="#12141b" />
        <ellipse cx="128" cy="72" rx="84" ry="11" fill="#2a2e3a" />
        <ellipse cx="128" cy="70" rx="48" ry="6" fill="#12141b" />
      </g>
    </g>
  )
}

/** Волшебная палочка у ног, на кончике мигает искра */
function Wand() {
  return (
    <g>
      <g transform="rotate(-24 170 214)">
        <rect x="167" y="166" width="5" height="50" rx="2" fill="#12141b" />
        <rect x="167" y="166" width="5" height="9" rx="2" fill="#f4f6fb" />
        <rect x="167" y="207" width="5" height="9" rx="2" fill="#f4f6fb" />
      </g>
      <path className="tfa-blink" style={vars({ '--ms': '700ms' })} d={spark(150, 164, 9)} fill="#ffd35c" />
      <path className="tfa-blink" style={vars({ '--ms': '700ms', '--del': '-350ms' })} d={spark(162, 150, 5)} fill="#fff" />
    </g>
  )
}

// ───────────── Первые шесть ─────────────

/** Клетчатый флаг финиша, воткнутый в подставку; полотнище полощется */
function Flag({ p }: { p: string }) {
  return (
    <g>
      <ellipse cx="164" cy="219" rx="4" ry="1.6" fill="#000" opacity=".6" />
      {/* Сплошной цвет: градиент по рамке объекта у линии нулевой ширины не рисуется */}
      <line x1="164" y1="219" x2="164" y2="58" stroke="#cfd5df" strokeWidth="3.2" strokeLinecap="round" />
      <line x1="163.2" y1="214" x2="163.2" y2="62" stroke="#fff" strokeOpacity=".7" strokeWidth="1" />
      <circle cx="164" cy="56" r="3.6" fill="#eef1f6" />
      <g className="tfa-flag" style={vars({ '--o': '0% 50%', '--ms': '360ms', '--a': '9deg' })}>
        <path d="M165.5 60C176 54 186 66 197 60L197 88C186 94 176 82 165.5 88Z" fill={`url(#${p}chk)`} />
        <path d="M165.5 60C176 54 186 66 197 60L197 88C186 94 176 82 165.5 88Z" fill="#000" opacity=".12" />
        <path d="M176 57C181 58 184 63 188 64L188 92C184 91 181 86 176 85Z" fill="#000" opacity=".14" />
      </g>
    </g>
  )
}

/** Лавровый венок из золотых листьев по краю подставки; листья поблёскивают волной */
function Laurel({ p }: { p: string }) {
  const leaves: ReactNode[] = []
  for (const side of [-1, 1])
    for (let i = 0; i < 7; i++) {
      const t = i / 6
      // Квадратичная кривая от низа подставки вверх и наружу: (74,230) → (26,226) → (30,176)
      const bx = (1 - t) ** 2 * 74 + 2 * (1 - t) * t * 26 + t * t * 30
      const by = (1 - t) ** 2 * 230 + 2 * (1 - t) * t * 226 + t * t * 176
      const ddx = 2 * (1 - t) * (26 - 74) + 2 * t * (30 - 26)
      const ddy = 2 * (1 - t) * (226 - 230) + 2 * t * (176 - 226)
      const a = (Math.atan2(ddy, ddx) * 180) / Math.PI
      const x = side < 0 ? bx : 200 - bx
      const ang = side < 0 ? a : 180 - a
      for (const k of [-1, 1])
        leaves.push(
          <g key={`${side}.${i}.${k}`} className="tfa-shine" style={vars({ '--del': `${-(6 - i) * 180}ms` })}>
            <ellipse cx={x} cy={by} rx="6.5" ry="2.6" transform={`rotate(${ang + k * 38} ${x} ${by})`} fill={`url(#${p}gold)`} />
          </g>
        )
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

/** Свёрнутая карта у ног: покачивается, будто вот-вот развернётся */
function MapScroll() {
  return (
    <g className="tfa-sway" style={vars({ '--o': '50% 100%', '--a': '4deg', '--ms': '1300ms' })}>
      <g transform="rotate(-10 46 210)">
        <rect x="22" y="202" width="50" height="13" rx="6.5" fill="#ece0c2" />
        <rect x="22" y="202" width="50" height="3" rx="1.5" fill="#fff" opacity=".5" />
        <rect x="40" y="202" width="2.5" height="13" fill="#c0392b" opacity=".85" />
        <ellipse cx="72" cy="208.5" rx="3.6" ry="6.5" fill="#cdbd94" />
        <ellipse cx="72" cy="208.5" rx="1.4" ry="2.8" fill="#8f7c52" />
      </g>
    </g>
  )
}

/** Стеклянный шлем-пузырь космонавта и воротник */
function Bubble({ p }: { p: string }) {
  return (
    <g>
      <circle cx="128" cy="128" r="114" fill={`url(#${p}bubble)`} stroke="#fff" strokeOpacity=".55" strokeWidth="2.4" />
      <path d="M44 92A100 100 0 0 1 104 26" fill="none" stroke="#fff" strokeOpacity=".75" strokeWidth="7" strokeLinecap="round" />
      <circle className="tfa-blink" style={vars({ '--ms': '1600ms' })} cx="198" cy="64" r="6" fill="#fff" opacity=".5" />
      <ellipse cx="128" cy="236" rx="96" ry="13" fill={`url(#${p}metal)`} />
      <ellipse cx="128" cy="233" rx="96" ry="8" fill="none" stroke="#fff" strokeOpacity=".6" strokeWidth="1.5" />
    </g>
  )
}

/** Плюмаж рыцаря колышется */
function Plume() {
  return (
    <g>
      <g className="tfa-sway" style={vars({ '--o': '20% 100%', '--a': '5deg', '--ms': '900ms' })}>
        <path d="M118 80C106 40 134 10 176 18C150 26 140 48 140 80Z" fill="#e2394d" />
        <path d="M126 76C120 46 140 26 164 22" fill="none" stroke="#ff8b97" strokeWidth="4" strokeLinecap="round" />
        <path d="M134 78C132 54 146 36 168 26" fill="none" stroke="#a3162a" strokeWidth="3" strokeLinecap="round" />
      </g>
      <rect x="114" y="70" width="30" height="10" rx="3" fill="#b9c1ce" />
    </g>
  )
}

/** Меч, воткнутый в подставку; по клинку пробегает искра */
function Sword({ p }: { p: string }) {
  return (
    <g>
      <ellipse cx="40" cy="219" rx="5" ry="1.8" fill="#000" opacity=".6" />
      <path d="M36.5 219L43.5 219L43.5 124L40 112L36.5 124Z" fill={`url(#${p}metal)`} />
      <line x1="40" y1="120" x2="40" y2="216" stroke="#5f6878" strokeWidth=".9" />
      <rect x="28" y="116" width="24" height="5" rx="2.5" fill={`url(#${p}gold)`} />
      <rect x="37.5" y="96" width="5" height="20" rx="2" fill="#6b4524" />
      <circle cx="40" cy="94" r="4" fill={`url(#${p}gold)`} />
      <path className="tfa-blink" style={vars({ '--ms': '1800ms' })} d={spark(40, 136, 7)} fill="#fff" />
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

/** Стопка из трёх коробок под коллекционером; верхняя то и дело выезжает */
function CaseStack() {
  const cases = [
    { x: 40, y: 206, w: 120, c: '#ff6fae', r: -1.5 },
    { x: 46, y: 197, w: 108, c: '#3a7bff', r: 1.2 },
    { x: 38, y: 188, w: 124, c: '#ffc94d', r: -0.8 }
  ]
  return (
    <g>
      {cases.map((k, i) => (
        <g key={i} className={i === 1 ? 'tfa-slide' : undefined}>
          <g transform={`rotate(${k.r} 100 ${k.y + 4})`}>
            <rect x={k.x} y={k.y} width={k.w} height="9" rx="1.6" fill={k.c} />
            <rect x={k.x} y={k.y} width={k.w} height="2" rx="1" fill="#fff" opacity=".45" />
            <rect x={k.x + 10} y={k.y + 4} width={k.w * 0.32} height="2" rx="1" fill="#fff" opacity=".7" />
            <rect x={k.x} y={k.y + 7} width={k.w} height="2" rx="1" fill="#000" opacity=".25" />
          </g>
        </g>
      ))}
    </g>
  )
}

/** Алый плащ за спиной легенды колышется */
function Cape({ p }: { p: string }) {
  return (
    <g className="tfa-flag" style={vars({ '--o': '50% 0%', '--ms': '1200ms', '--a': '3deg' })}>
      <path d="M46 98C24 150 10 200 0 238L256 238C246 200 232 150 210 98Z" fill={`url(#${p}cape)`} />
      <path d="M70 120C60 160 52 200 46 236M128 110L128 236M186 120C196 160 204 200 210 236" fill="none" stroke="#000" strokeOpacity=".22" strokeWidth="5" />
    </g>
  )
}

/** Корона с камнями: камни вспыхивают по очереди */
function Crown({ p }: { p: string }) {
  const gems: [number, number, number, string][] = [
    [94, 36, 4.5, '#ff4b5c'],
    [128, 26, 5.5, '#5ee6ff'],
    [162, 36, 4.5, '#4be3a0'],
    [112, 72, 3, '#a891ff'],
    [144, 72, 3, '#a891ff']
  ]
  return (
    <g>
      <path d="M86 78L94 36L112 58L128 26L144 58L162 36L170 78Z" fill={`url(#${p}gold)`} />
      <rect x="86" y="66" width="84" height="12" rx="3" fill={`url(#${p}gold)`} />
      <path d="M90 68L166 68" stroke="#fff" strokeOpacity=".6" strokeWidth="2" />
      {gems.map(([x, y, r, c], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r={r} fill={c} />
          <circle className="tfa-blink" style={vars({ '--ms': '1500ms', '--del': `${-i * 300}ms` })} cx={x} cy={y} r={r * 0.55} fill="#fff" />
        </g>
      ))}
    </g>
  )
}
