import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useInputLayer } from '../lib/input'
import { play } from '../lib/sound'
import { Avatar } from './Avatar'
import { LOGO_PLAY, LOGO_RING } from './Logo'
import { t } from '@shared/i18n'

const easeOut = [0.23, 1, 0.32, 1] as const

/**
 * Хореография (мс от старта). Звук 'boot' синхронизирован с моментом POWER.
 * Тайминги знака заданы в CSS теми же числами — см. styles-intro.css.
 */
const POWER = 1120 // треугольник «включается», вспышка, волны, частицы разлетаются
const WORD = 1650 // знак отъезжает, проявляется название
const WELCOME = 2950 // логотип уходит вверх, приветствие
const DONE = 4500

const WORD_LETTERS = ['P', 'l', 'a', 'y', 'O', 'S']
const FALLBACK_COLORS = ['#3d8bff', '#8a5cff', '#3fd0ff']

function greeting(d = new Date()) {
  const h = d.getHours()
  if (h >= 5 && h < 12) return t('Доброе утро')
  if (h >= 12 && h < 17) return t('Добрый день')
  if (h >= 17 && h < 23) return t('Добрый вечер')
  return t('Доброй ночи')
}

interface Props {
  userName: string
  avatar?: string
  lastGame?: string
  /** Цвета обложек последних игр — ими светится фон и частицы */
  colors?: string[]
  onDone: () => void
}

type Phase = 'mark' | 'word' | 'welcome'

/**
 * Заставка при старте PlayOS — единственный большой «момент» анимации в приложении:
 * искра → кольцо питания прорисовывается кометой → внутри включается Play со вспышкой и волнами,
 * частицы разлетаются из центра, загорается сияние в цветах ваших игр → название поднимается из-под маски,
 * по нему проходит блик → логотип уходит вверх, появляется приветствие. Любая кнопка пропускает.
 */
export function Intro({ userName, avatar, lastGame, colors, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>('mark')
  // Окно создаётся скрытым и показывается после первой отрисовки: стартуем, только когда его видно,
  // иначе искра и комета проиграются «за кадром», а звук разойдётся с картинкой
  const [ready, setReady] = useState(false)
  const done = useRef(onDone)
  done.current = onDone
  const palette = [...(colors ?? []), ...FALLBACK_COLORS].slice(0, 3)

  useEffect(() => {
    let raf = 0
    const go = () => {
      if (document.visibilityState !== 'visible') return
      // Два кадра — чтобы окно точно успело появиться на экране
      raf = requestAnimationFrame(() => (raf = requestAnimationFrame(() => setReady(true))))
    }
    go()
    document.addEventListener('visibilitychange', go)
    // Подстраховка: если окно так и не сообщило о видимости
    const t = setTimeout(() => setReady(true), 1500)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(t)
      document.removeEventListener('visibilitychange', go)
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    play('boot')
    const timers = [setTimeout(() => setPhase('word'), WORD), setTimeout(() => setPhase('welcome'), WELCOME), setTimeout(() => done.current(), DONE)]
    return () => timers.forEach(clearTimeout)
  }, [ready])
  useInputLayer(() => done.current(), 100)

  const style = { '--a1': palette[0], '--a2': palette[1], '--a3': palette[2] } as React.CSSProperties

  if (!ready) return <motion.div className="intro" exit={{ opacity: 0 }} />

  return (
    <motion.div
      className="intro"
      style={style}
      exit={{ opacity: 0, transform: 'scale(1.06)', filter: 'blur(10px)', transition: { duration: 0.7, ease: easeOut } }}
    >
      <div className="intro-aurora" aria-hidden>
        <i />
        <i />
        <i />
      </div>
      <Particles colors={palette} burstAt={POWER} />
      <div className="intro-vignette" />

      <motion.div
        className="intro-lockup"
        initial={false}
        animate={
          phase === 'welcome'
            ? { transform: 'translateY(-21rem) scale(0.46)', opacity: 0.92 }
            : { transform: 'translateY(0rem) scale(1)', opacity: 1 }
        }
        transition={{ duration: 0.75, ease: [0.5, 0, 0.15, 1] }}
      >
        <div className="intro-mark-wrap">
          <span className="intro-flash" />
          <span className="intro-wave" />
          <span className="intro-wave is-second" />
          <svg className="intro-mark" viewBox="0 0 48 48" aria-hidden>
            <circle className="intro-spark" cx="33.54" cy="8.74" r="1.9" />
            <path className="intro-ring" d={LOGO_RING} pathLength={1} />
            <path className="intro-comet" d={LOGO_RING} pathLength={1} />
            <path className="intro-play" d={LOGO_PLAY} />
          </svg>
        </div>
        <motion.div
          className="intro-word-clip"
          initial={{ width: 0 }}
          animate={{ width: phase === 'mark' ? 0 : 'auto' }}
          transition={{ duration: 0.75, ease: [0.65, 0, 0.35, 1] }}
        >
          <span className={`intro-word ${phase !== 'mark' ? 'is-on' : ''}`} aria-label="PlayOS">
            {WORD_LETTERS.map((ch, i) => (
              <span key={i} className={`intro-letter ${i >= 4 ? 'is-os' : ''}`} style={{ animationDelay: `${120 + i * 55}ms` }}>
                {ch}
              </span>
            ))}
          </span>
        </motion.div>
      </motion.div>

      <AnimatePresence>
        {phase === 'welcome' && (
          <motion.div
            key="welcome"
            className="intro-welcome"
            // Приветствие поднимается, когда логотип уже освободил центр
            initial={{ opacity: 0, transform: 'translateY(4rem)', filter: 'blur(10px)' }}
            animate={{ opacity: 1, transform: 'translateY(0rem)', filter: 'blur(0px)' }}
            transition={{ duration: 0.8, ease: easeOut, delay: 0.42 }}
          >
            <div className="intro-avatar">
              <span className="intro-avatar-ring" />
              <Avatar name={userName} src={avatar} className="avatar-xl" />
            </div>
            <div className="intro-greet">{greeting()}</div>
            <div className="intro-name">{userName}</div>
            {lastGame && <div className="intro-sub">{t('Вы остановились на «{game}»', { game: lastGame })}</div>}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

const rgb = (hex: string) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [140, 175, 255]
}

/**
 * Частицы: до «включения» их нет, в момент POWER они вылетают из центра со следами (как прыжок в гиперпространство),
 * быстро тормозят и дальше медленно всплывают, мерцая. Цвета — от обложек игр, светлее к центру.
 */
function Particles({ colors, burstAt }: { colors: string[]; burstAt: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let w = 0
    let h = 0
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)
    const tones = colors.map(rgb)
    // Светящаяся точка рисуется один раз на тон, дальше только копируется — без градиентов на каждый кадр
    const sprites = tones.map(([R, G, B]) => {
      const sp = document.createElement('canvas')
      sp.width = sp.height = 64
      const s = sp.getContext('2d')!
      const g = s.createRadialGradient(32, 32, 0, 32, 32, 32)
      g.addColorStop(0, `rgba(${Math.min(255, R + 90)}, ${Math.min(255, G + 90)}, ${Math.min(255, B + 90)}, 1)`)
      g.addColorStop(0.35, `rgba(${R}, ${G}, ${B}, 0.45)`)
      g.addColorStop(1, `rgba(${R}, ${G}, ${B}, 0)`)
      s.fillStyle = g
      s.fillRect(0, 0, 64, 64)
      return sp
    })
    const parts = Array.from({ length: 140 }, () => {
      const a = Math.random() * Math.PI * 2
      // Конечное место — по всему экрану, но реже в самом центре, где логотип
      const dist = 0.18 + Math.pow(Math.random(), 0.7) * 0.75
      return {
        tx: 0.5 + Math.cos(a) * dist * 0.62,
        ty: 0.5 + Math.sin(a) * dist * 0.62,
        z: Math.random(),
        phase: Math.random() * Math.PI * 2,
        speed: 0.4 + Math.random() * 0.6,
        tone: Math.floor(Math.random() * tones.length),
        kick: 2.6 + Math.random() * 2.2
      }
    })
    let raf = 0
    const start = performance.now()
    const frame = (now: number) => {
      const t = (now - start) / 1000
      const tb = t - burstAt / 1000
      ctx.clearRect(0, 0, w, h)
      if (tb > 0) {
        ctx.globalCompositeOperation = 'lighter'
        for (const p of parts) {
          const depth = 0.3 + p.z * 0.7
          // Вылет из центра: быстрый старт, плавное торможение
          const k = reduce ? 1 : 1 - Math.exp(-tb * p.kick)
          const kPrev = reduce ? 1 : 1 - Math.exp(-(tb - 0.045) * p.kick)
          const drift = reduce ? 0 : tb * 0.012 * p.speed * depth
          const sway = Math.sin(t * 0.5 * p.speed + p.phase) * 0.006 * depth
          const x = (0.5 + (p.tx - 0.5) * k + sway) * w
          const y = (0.5 + (p.ty - 0.5) * k - drift) * h
          const px = (0.5 + (p.tx - 0.5) * Math.max(0, kPrev) + sway) * w
          const py = (0.5 + (p.ty - 0.5) * Math.max(0, kPrev) - drift) * h
          const r = (0.7 + depth * 2.4) * Math.max(0.6, h / 1080)
          const twinkle = 0.6 + 0.4 * Math.sin(t * 1.7 * p.speed + p.phase)
          const appear = Math.min(1, tb / 0.12)
          const alpha = appear * twinkle * depth * 0.7
          const [R, G, B] = tones[p.tone]
          // След, пока частица летит быстро
          const trail = Math.hypot(x - px, y - py)
          if (trail > 2) {
            ctx.strokeStyle = `rgba(${R}, ${G}, ${B}, ${alpha * 0.55})`
            ctx.lineWidth = r * 0.9
            ctx.lineCap = 'round'
            ctx.beginPath()
            ctx.moveTo(px, py)
            ctx.lineTo(x, y)
            ctx.stroke()
          }
          ctx.globalAlpha = Math.min(1, alpha)
          ctx.drawImage(sprites[p.tone], x - r * 4, y - r * 4, r * 8, r * 8)
          ctx.globalAlpha = 1
        }
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <canvas className="intro-particles" ref={ref} aria-hidden />
}
