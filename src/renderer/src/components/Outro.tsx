import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { Game, PowerAction, RunningGame } from '@shared/types'
import { api } from '../lib/api'
import { playtime } from '../lib/format'
import { useInputLayer } from '../lib/input'
import { play } from '../lib/sound'
import { Hint } from './Glyph'
import { IconMoon } from './Icons'
import { CrtScreen } from './CrtScreen'
import { t } from '@shared/i18n'

/**
 * Аутро — зеркало интро, на том же экране кинескопа из символов:
 *  • выход из PlayOS и выключение / перезагрузка ПК: прощание, затем название рассыпается на знаки,
 *    поле тускнеет, и кинескоп гаснет — схлопывается в линию и в точку;
 *  • сон: экран мягко темнеет.
 * Пока идёт показ, ○ отменяет, любая другая кнопка — сразу дальше.
 */

type Kind = PowerAction
type Phase = 'show' | 'off' | 'done'

const TIMING: Record<Kind, { off: number; done: number }> = {
  quit: { off: 1150, done: 2050 },
  shutdown: { off: 1650, done: 2700 },
  restart: { off: 1650, done: 2700 },
  sleep: { off: 700, done: 1300 }
}

const FALLBACK_COLORS = ['#3d8bff', '#8a5cff', '#3fd0ff']

function farewell(name: string, d = new Date()) {
  const h = d.getHours()
  return h >= 23 || h < 5 ? t('Спокойной ночи, {name}', { name }) : t('До встречи, {name}', { name })
}

/** Итог дня: сколько сыграно сегодня и во что больше всего */
function today(games: Game[], running: RunningGame | null) {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  let total = 0
  let top: { title: string; sec: number } | null = null
  for (const g of games) {
    let sec = g.sessions.filter((s) => s.start >= start.getTime()).reduce((a, s) => a + s.duration, 0)
    if (running?.gameId === g.id) sec += Math.max(0, Math.floor((Date.now() - Math.max(running.startedAt, start.getTime())) / 1000))
    total += sec
    if (sec > 0 && (!top || sec > top.sec)) top = { title: g.title, sec }
  }
  if (!total || !top) return null
  return t('Сегодня вы играли {v}, больше всего — в «{title}»', { v: playtime(total).toLowerCase(), title: top.title })
}

interface Props {
  kind: Kind
  userName: string
  games: Game[]
  running: RunningGame | null
  colors: string[]
  /** Отмена (○) или возврат после сна / неудачного выключения */
  onCancel: () => void
}

export function Outro({ kind, userName, games, running, colors, onCancel }: Props) {
  const [phase, setPhase] = useState<Phase>('show')
  const cancel = useRef(onCancel)
  cancel.current = onCancel
  const palette = [...colors, ...FALLBACK_COLORS].slice(0, 3)
  const summary = useRef(kind === 'quit' ? today(games, running) : null).current
  const pc = kind === 'shutdown' || kind === 'restart'

  // Экран «гаснет»: весь интерфейс схлопывается как кинескоп (класс на <html>, см. styles-outro.css)
  const powerOff = (on: boolean) => document.documentElement.classList.toggle('is-powering-off', on)

  const finished = useRef(false)
  const finish = () => {
    if (finished.current) return
    finished.current = true
    setPhase('done')
    if (pc) powerOff(true)
    void api.power(kind)
  }

  useEffect(() => {
    play(pc ? 'shutdown' : kind === 'quit' ? 'farewell' : 'back')
    const t = TIMING[kind]
    const timers = [
      setTimeout(() => {
        setPhase('off')
        if (pc) powerOff(true)
      }, t.off),
      setTimeout(finish, t.done)
    ]
    return () => {
      timers.forEach(clearTimeout)
      powerOff(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // После сна или если Windows не выключилась — вернуть интерфейс
  useEffect(() => {
    if (phase !== 'done' || kind === 'quit') return
    const off = api.onPowerResume(() => cancel.current())
    const t = setTimeout(() => cancel.current(), kind === 'sleep' ? 60_000 : 20_000)
    return () => {
      off()
      clearTimeout(t)
    }
  }, [phase, kind])

  useInputLayer((a) => {
    if (phase === 'show') {
      if (a === 'back') {
        play('back')
        cancel.current()
      } else finish()
    } else if (phase === 'done' && kind !== 'quit') cancel.current()
    return true
  }, 110)

  const style = { '--a1': palette[0], '--a2': palette[1], '--a3': palette[2] } as React.CSSProperties

  return (
    <motion.div
      className={`outro outro-${kind} is-${phase}`}
      style={style}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.3 } }}
      transition={{ duration: kind === 'sleep' ? 0.6 : 0.4, ease: [0.23, 1, 0.32, 1] }}
    >
      {kind !== 'sleep' && <CrtScreen colors={palette} phase={phase === 'show' ? 'show' : phase === 'off' ? 'dissolve' : 'off'} className="outro-field" />}

      {kind === 'sleep' ? (
        <div className="outro-moon">
          <IconMoon />
          <span>{t('Спящий режим')}</span>
        </div>
      ) : (
        <div className="outro-center">
          <div className="outro-text">
            {pc ? (
              <>
                <div className="outro-title">{kind === 'shutdown' ? t('Выключение компьютера') : t('Перезагрузка компьютера')}</div>
                <div className="outro-sub">{farewell(userName)}</div>
              </>
            ) : (
              <>
                <div className="outro-title">{farewell(userName)}</div>
                {summary && <div className="outro-sub">{summary}</div>}
              </>
            )}
          </div>
        </div>
      )}

      {phase === 'show' && kind !== 'sleep' && (
        <footer className="outro-hints">
          <Hint glyph="back" label={t('Отмена')} />
        </footer>
      )}
    </motion.div>
  )
}
