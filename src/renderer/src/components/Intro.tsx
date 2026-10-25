import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useInputLayer } from '../lib/input'
import { play } from '../lib/sound'
import { Avatar } from './Avatar'
import { CrtScreen } from './CrtScreen'
import { t } from '@shared/i18n'

const easeOut = [0.23, 1, 0.32, 1] as const

/**
 * Хореография (мс от старта). Звук 'boot' синхронизирован с моментом POWER.
 * Тайминги названия и искр заданы в CSS теми же числами — см. styles-intro.css.
 */
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
 * Включается кинескоп: светящаяся линия раскрывается в экран из символов, по которому текут полосы света
 * в цветах ваших игр → символы мельтешат и застывают в название «playos» → со звуком включения от центра
 * расходится волна → логотип уходит вверх, появляется приветствие.
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
      <CrtScreen colors={palette} phase={phase} pulseAt={POWER} />
      {/* Название рисует сам экран; для экранных дикторов — текстом */}
      <h1 className="sr-only">PlayOS</h1>

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
