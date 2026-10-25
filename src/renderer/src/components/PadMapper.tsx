import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PadAction, PadInput, PadMaps } from '@shared/types'
import { t } from '@shared/i18n'
import { startCapture } from '../lib/input'
import { useSpatialNav } from '../lib/nav'
import { play } from '../lib/sound'
import { Hint } from './Glyph'
import { IconGamepad } from './Icons'

/** Порядок шагов: сначала то, без чего не обойтись в меню */
const STEPS: { action: PadAction; label: string; hint: string }[] = [
  { action: 'confirm', label: t('Выбрать'), hint: t('Нижняя кнопка справа: ✕ на PlayStation, A на Xbox') },
  { action: 'back', label: t('Назад'), hint: t('Правая кнопка: ○ на PlayStation, B на Xbox') },
  { action: 'up', label: t('Вверх'), hint: t('Крестовина') },
  { action: 'down', label: t('Вниз'), hint: t('Крестовина') },
  { action: 'left', label: t('Влево'), hint: t('Крестовина') },
  { action: 'right', label: t('Вправо'), hint: t('Крестовина') },
  { action: 'menu', label: t('Параметры игры'), hint: t('Верхняя кнопка справа: △ или Y') },
  { action: 'search', label: t('Добавить игру'), hint: t('Левая кнопка справа: ▢ или X') },
  { action: 'l1', label: t('Вкладка влево'), hint: t('Левый бампер: L1 или LB') },
  { action: 'r1', label: t('Вкладка вправо'), hint: t('Правый бампер: R1 или RB') },
  { action: 'l2', label: t('Фильтр назад'), hint: t('Левый курок: L2 или LT') },
  { action: 'r2', label: t('Фильтр вперёд'), hint: t('Правый курок: R2 или RT') },
  { action: 'options', label: t('Меню'), hint: t('Options, Start или Menu') }
]

const same = (a: PadInput, b: PadInput) => JSON.stringify(a) === JSON.stringify(b)

/** Имя геймпада без служебного хвоста «(Vendor: … Product: …)» */
export const padName = (id: string) => id.replace(/\s*\((STANDARD GAMEPAD\s*)?Vendor:.*\)\s*$/i, '').replace(/\s*\(.*?\)\s*$/, '').trim() || id

/**
 * Мастер «Настроить кнопки» для геймпадов DirectInput: по очереди нажимаете кнопку для каждого действия.
 * Уже назначенная кнопка пропускает шаг, Esc на клавиатуре — отмена.
 */
export function PadMapper({ maps, onSave, onClose }: { maps: PadMaps; onSave: (m: PadMaps) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [padId, setPadId] = useState<string | null>(null)
  const [step, setStep] = useState(0)
  const [map, setMap] = useState<Partial<Record<PadAction, PadInput>>>({})
  const state = useRef({ padId, step, map })
  state.current = { padId, step, map }

  const done = step >= STEPS.length
  const stage = !padId ? 'pick' : done ? 'done' : 'map'
  useSpatialNav(ref, { priority: 50, onBack: onClose, autoFocus: '.pm-main', focusKey: stage, onAction: () => {} })

  // Все шаги пройдены — сразу сохраняем, и геймпад начинает работать по новой схеме
  useEffect(() => {
    if (done && padId) onSave({ ...maps, [padId]: map })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done])

  useEffect(() => {
    if (done) return
    return startCapture((id, input) => {
        const cur = state.current
        if (!cur.padId) {
          // Первое нажатие выбирает геймпад, который настраиваем
          play('select')
          setPadId(id)
          return
        }
        if (id !== cur.padId || cur.step >= STEPS.length) return
        const taken = Object.values(cur.map).some((x) => x && same(x, input))
        if (!taken) {
          play('move')
          setMap({ ...cur.map, [STEPS[cur.step].action]: input })
        } else play('bump')
        setStep(cur.step + 1)
    })
  }, [done])

  const current = STEPS[Math.min(step, STEPS.length - 1)]

  return createPortal(
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }}>
      <motion.div
        className="pm"
        ref={ref}
        role="dialog"
        aria-labelledby="pm-title"
        initial={{ opacity: 0, transform: 'scale(0.96) translateY(1.2rem)' }}
        animate={{ opacity: 1, transform: 'scale(1) translateY(0rem)' }}
        exit={{ opacity: 0, transform: 'scale(0.98)', transition: { duration: 0.12 } }}
        transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
      >
        <h2 id="pm-title" className="dialog-title">
          {t('Настройка кнопок')}
        </h2>
        {!padId ? (
          <div className="pm-stage">
            <span className="pm-pad">
              <IconGamepad />
            </span>
            <p className="pm-ask">{t('Нажмите любую кнопку на геймпаде, который нужно настроить')}</p>
          </div>
        ) : !done ? (
          <div className="pm-stage">
            <div className="pm-device">{padName(padId)}</div>
            <div className="pm-count">{t('Шаг {n} из {total}', { n: step + 1, total: STEPS.length })}</div>
            <p className="pm-ask">{t('Нажмите кнопку «{label}»', { label: current.label })}</p>
            <p className="pm-hint">{current.hint}</p>
            <div className="pm-progress">
              <span style={{ transform: `scaleX(${step / STEPS.length})` }} />
            </div>
            <p className="pm-note">{t('Нет такой кнопки — нажмите уже назначенную, и шаг пропустится')}</p>
          </div>
        ) : (
          <div className="pm-stage">
            <div className="pm-device">{padName(padId)}</div>
            <p className="pm-ask">{t('Готово: назначено {n} из {total}', { n: Object.keys(map).length, total: STEPS.length })}</p>
            <p className="pm-hint">{t('Раскладка сохранена. Стик и крестовина работают и без настройки.')}</p>
          </div>
        )}
        <footer className="pm-actions">
          <Hint glyph="back" label={t('Отмена — Esc')} />
          <span className="pm-buttons">
            {padId && !done && (
              <button data-nav className="btn btn-glass pm-main" onClick={() => setStep((n) => n + 1)}>
                {t('Пропустить')}
              </button>
            )}
            {!padId && (
              <button data-nav className="btn btn-glass pm-main" onClick={onClose}>
                {t('Отмена')}
              </button>
            )}
            {done && (
              <>
                <button
                  data-nav
                  className="btn btn-glass"
                  onClick={() => {
                    setStep(0)
                    setMap({})
                  }}
                >
                  {t('Заново')}
                </button>
                <button data-nav className="btn btn-primary pm-main" onClick={onClose}>
                  {t('Готово')}
                </button>
              </>
            )}
          </span>
        </footer>
      </motion.div>
    </motion.div>,
    document.querySelector('.app') ?? document.body
  )
}
