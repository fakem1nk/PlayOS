import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState, type ReactNode } from 'react'
import { useInputLayer } from '../lib/input'
import { closeKeyboard, useKeyboardTarget, writeValue, type OskTarget } from '../lib/osk'
import { play } from '../lib/sound'
import { Hint } from './Glyph'
import { IconBackspace } from './Icons'
import { t } from '@shared/i18n'

type Layout = 'ru' | 'en' | 'sym'

const LAYOUTS: Record<Layout, string[]> = {
  ru: ['1234567890', 'йцукенгшщзхъ', 'фывапролджэ', 'ячсмитьбю.-'],
  en: ['1234567890', 'qwertyuiop', "asdfghjkl'", 'zxcvbnm,.-'],
  sym: ['1234567890', '!@#$%^&*()', '-_=+[]{};:', '"\'/\\|?<>~`']
}

interface Key {
  id: string
  label: ReactNode
  /** Ширина в долях обычной клавиши */
  w: number
  char?: string
}

/** Экранная клавиатура в духе PS5: крестовина ходит по клавишам, ✕ печатает, □ стирает, △ пробел. */
export function OnScreenKeyboard() {
  const target = useKeyboardTarget()
  return <AnimatePresence>{target && <Keyboard key="osk" el={target} />}</AnimatePresence>
}

function Keyboard({ el }: { el: OskTarget }) {
  const [text, setText] = useState(el.value)
  const [caret, setCaret] = useState(el.value.length)
  const [layout, setLayout] = useState<Layout>(/[а-яё]/i.test(el.value) ? 'ru' : 'en')
  const [shift, setShift] = useState(false)
  const [pos, setPos] = useState({ r: 1, c: 0 })

  const rows = useMemo<Key[][]>(() => {
    const chars = LAYOUTS[layout].map((row) =>
      [...row].map((ch): Key => {
        const c = shift ? ch.toLocaleUpperCase('ru-RU') : ch
        return { id: `ch-${ch}`, label: c, char: c, w: 1 }
      })
    )
    const bottom: Key[] = [
      { id: 'shift', label: '⇧', w: 1.5 },
      { id: 'lang', label: layout === 'ru' ? 'EN' : 'RU', w: 1.5 },
      { id: 'sym', label: layout === 'sym' ? t('АБВ') : '#+=', w: 1.5 },
      { id: 'space', label: t('Пробел'), w: 5 },
      { id: 'back', label: <IconBackspace />, w: 1.5 },
      { id: 'done', label: t('Готово'), w: 2.5 }
    ]
    return [...chars, bottom]
  }, [layout, shift])

  const r = Math.min(pos.r, rows.length - 1)
  const c = Math.min(pos.c, rows[r].length - 1)

  const insert = (s: string) => {
    setText((t) => t.slice(0, caret) + s + t.slice(caret))
    setCaret((k) => k + s.length)
  }
  const erase = () => {
    if (!caret) return
    setText((t) => t.slice(0, caret - 1) + t.slice(caret))
    setCaret((k) => k - 1)
  }

  /** Закрыть: текст в поле; «Готово» ещё и подтверждает ввод (Enter — поиск или сохранение поля) */
  const finish = (submit: boolean) => {
    play(submit ? 'select' : 'back')
    if (text !== el.value) writeValue(el, text)
    closeKeyboard()
    el.focus({ preventScroll: true })
    if (submit) {
      // Ждём, пока React применит новое значение, и только потом «нажимаем» Enter
      setTimeout(() => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })), 0)
    }
  }

  const press = (key: Key) => {
    if (key.char) {
      play('move')
      insert(key.char)
      if (shift) setShift(false)
      return
    }
    play('toggle')
    switch (key.id) {
      case 'shift':
        return setShift((s) => !s)
      case 'lang':
        return setLayout((l) => (l === 'ru' ? 'en' : 'ru'))
      case 'sym':
        return setLayout((l) => (l === 'sym' ? 'en' : 'sym'))
      case 'space':
        return insert(' ')
      case 'back':
        return erase()
      case 'done':
        return finish(true)
    }
  }

  /** Переход между рядами разной длины: ближайшая клавиша по горизонтали */
  const moveRow = (d: number) => {
    const nr = Math.max(0, Math.min(rows.length - 1, r + d))
    if (nr === r) return
    const center = (row: Key[], i: number) => {
      const total = row.reduce((a, k) => a + k.w, 0)
      const before = row.slice(0, i).reduce((a, k) => a + k.w, 0)
      return (before + row[i].w / 2) / total
    }
    const x = center(rows[r], c)
    let best = 0
    for (let i = 1; i < rows[nr].length; i++) if (Math.abs(center(rows[nr], i) - x) < Math.abs(center(rows[nr], best) - x)) best = i
    play('move')
    setPos({ r: nr, c: best })
  }

  useInputLayer(
    (a) => {
      switch (a) {
        case 'up':
          return moveRow(-1)
        case 'down':
          return moveRow(1)
        case 'left':
        case 'right': {
          const nc = (c + (a === 'left' ? -1 : 1) + rows[r].length) % rows[r].length
          play('move')
          return setPos({ r, c: nc })
        }
        case 'confirm':
          return press(rows[r][c])
        case 'search':
          play('toggle')
          return erase()
        case 'menu':
          play('toggle')
          return insert(' ')
        case 'l1':
          return setCaret((k) => Math.max(0, k - 1))
        case 'r1':
          return setCaret((k) => Math.min(text.length, k + 1))
        case 'l2':
          play('toggle')
          return setShift((s) => !s)
        case 'r2':
        case 'options':
          return finish(true)
        case 'back':
          return finish(false)
      }
    },
    60
  )

  const label = el.getAttribute('aria-label') || el.placeholder || t('Ввод текста')

  return (
    <motion.div
      className="osk"
      initial={{ opacity: 0, transform: 'translateY(4rem)' }}
      animate={{ opacity: 1, transform: 'translateY(0rem)' }}
      exit={{ opacity: 0, transform: 'translateY(3rem)', transition: { duration: 0.16 } }}
      transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
    >
      <div className="osk-field">
        <span className="osk-label">{label}</span>
        <span className="osk-text">
          {text.slice(0, caret)}
          <span className="osk-caret" />
          {text.slice(caret)}
          {!text && <span className="osk-placeholder">{t('Начните набирать')}</span>}
        </span>
      </div>
      <div className="osk-keys">
        {rows.map((row, ri) => (
          <div key={ri} className="osk-row">
            {row.map((k, ci) => (
              <button
                key={k.id}
                tabIndex={-1}
                className={`osk-key ${ri === r && ci === c ? 'is-focused' : ''} ${k.id === 'done' ? 'is-done' : ''} ${k.id === 'shift' && shift ? 'is-on' : ''}`}
                style={{ flexGrow: k.w }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setPos({ r: ri, c: ci })
                  press(k)
                }}
              >
                {k.label}
              </button>
            ))}
          </div>
        ))}
      </div>
      <footer className="osk-hints">
        <Hint glyph="confirm" label={t('Ввод')} />
        <Hint glyph="search" label={t('Стереть')} />
        <Hint glyph="menu" label={t('Пробел')} />
        <Hint glyph="l1" label={t('Курсор')} />
        <Hint glyph="options" label={t('Готово')} />
        <Hint glyph="back" label={t('Закрыть')} />
      </footer>
    </motion.div>
  )
}
