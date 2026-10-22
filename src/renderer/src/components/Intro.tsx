import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useInputLayer } from '../lib/input'
import { play } from '../lib/sound'
import { Avatar } from './Avatar'
import { CrtField } from './CrtField'
import { WORDMARK_PATH, WORDMARK_SPARKS, WORDMARK_VIEWBOX } from './Logo'
import { t } from '@shared/i18n'

const easeOut = [0.23, 1, 0.32, 1] as const

/**
 * Хореография (мс от старта). Звук 'boot' синхронизирован с моментом POWER.
 * Тайминги названия и искр заданы в CSS теми же числами — см. styles-intro.css.
 */
const OPEN = 80 // кинескоп включается: линия по центру раскрывается на весь экран
const POWER = 1120 // волна по точкам от центра, вспыхивают искры
const WELCOME = 2950 // логотип уходит вверх, приветствие
const DONE = 4500

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
  /** Цвета обложек последних игр — ими светится фон */
  colors?: string[]
  onDone: () => void
}

type Phase = 'logo' | 'welcome'

/**
 * Заставка при старте PlayOS — единственный большой «момент» анимации в приложении.
 * Включается «кинескоп»: светящаяся линия раскрывается в экран из чётких круглых точек, по которым
 * текут полосы света в цветах ваших игр → из-под маски проявляется название → со звуком включения
 * от центра расходится волна и вспыхивают искры → логотип уходит вверх, появляется приветствие.
 * Любая кнопка пропускает.
 */
export function Intro({ userName, avatar, lastGame, colors, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>('logo')
  // Окно создаётся скрытым и показывается после первой отрисовки: стартуем, только когда его видно,
  // иначе включение проиграется «за кадром», а звук разойдётся с картинкой
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
    const timers = [setTimeout(() => setPhase('welcome'), WELCOME), setTimeout(() => done.current(), DONE)]
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
      <CrtField colors={palette} openAt={OPEN} openMs={640} pulseAt={POWER} intensity={phase === 'welcome' ? 0.55 : 1} />
      <div className="intro-vignette" />

      <motion.div
        className="intro-lockup"
        initial={false}
        animate={
          phase === 'welcome'
            ? { transform: 'translateY(-23rem) scale(0.42)', opacity: 0.95 }
            : { transform: 'translateY(0rem) scale(1)', opacity: 1 }
        }
        transition={{ duration: 0.75, ease: [0.5, 0, 0.15, 1] }}
      >
        <svg className="intro-word" viewBox={WORDMARK_VIEWBOX} role="img" aria-label="PlayOS">
          <path className="intro-word-fill" d={WORDMARK_PATH} />
          {WORDMARK_SPARKS.map((d, i) => (
            <path key={d} className={`intro-spark ${i ? 'is-small' : ''}`} d={d} />
          ))}
        </svg>
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
