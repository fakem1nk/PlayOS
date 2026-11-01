import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ApiKeyKind, Settings } from '@shared/types'
import { api } from '../lib/api'
import { focusEl, useSpatialNav } from '../lib/nav'
import { play } from '../lib/sound'
import { IconKey } from './Icons'
import { t } from '@shared/i18n'

type Save = (patch: Partial<Settings>) => Promise<unknown>

const FIELD = { steam: 'steamKey', ra: 'raKey', sgdb: 'steamGridDbKey' } as const

interface Guide {
  title: string
  why: string
  url: string
  steps: string[]
  /** Дополнительный шаг со своей кнопкой (приватность профиля Steam) */
  extra?: { text: string; button: string; url: string }
}

function guide(kind: ApiKeyKind): Guide {
  if (kind === 'steam')
    return {
      title: t('Ключ Steam Web API'),
      why: t('Нужен, чтобы PlayOS показывал трофеи Steam для игр на PC. Это бесплатно и займёт пару минут.'),
      url: 'https://steamcommunity.com/dev/apikey',
      steps: [
        t('Нажмите «Открыть страницу» — в браузере откроется сайт Steam. Если попросит, войдите в свой аккаунт.'),
        t('В поле «Domain Name» впишите любое слово, например playos. Поставьте галочку «I agree» и нажмите «Register».'),
        t('Если Steam попросит подтверждение, подтвердите его в мобильном приложении Steam.'),
        t('На странице появится строка «Key» — 32 буквы и цифры. Выделите её и скопируйте (Ctrl+C).')
      ],
      extra: {
        text: t('Чтобы трофеи было видно, в настройках приватности Steam у «Сведений об играх» должно стоять «Открытые».'),
        button: t('Настройки приватности'),
        url: 'https://steamcommunity.com/my/edit/settings'
      }
    }
  if (kind === 'ra')
    return {
      title: t('Ключ RetroAchievements'),
      why: t('Нужен, чтобы PlayOS показывал трофеи игр PS2 — те же, что выдаёт PCSX2. Это бесплатно.'),
      url: 'https://retroachievements.org/settings',
      steps: [
        t('Нажмите «Открыть страницу» и войдите на retroachievements.org под тем же логином, что и в PCSX2. Аккаунта нет — зарегистрируйтесь, это бесплатно.'),
        t('В настройках найдите раздел «Keys» и строку «Web API Key».'),
        t('Скопируйте ключ — кнопкой рядом с ним или Ctrl+C.')
      ]
    }
  return {
    title: t('Ключ SteamGridDB'),
    why: t('Нужен, чтобы находить обложки и фоны для игр PS2, PS3 и редких игр, которых нет в Steam. Это бесплатно.'),
    url: 'https://www.steamgriddb.com/profile/preferences/api',
    steps: [
      t('Нажмите «Открыть страницу» и войдите на SteamGridDB через Steam — кнопка «Login». Если после входа открылась главная страница, нажмите «Открыть страницу» ещё раз.'),
      t('Нажмите «Generate API Key». Если ключ уже был, он сразу виден на странице.'),
      t('Скопируйте ключ (Ctrl+C).')
    ]
  }
}

/** Названия кнопок и полей сайта в кавычках выделяем — их ищут глазами на странице */
const emph = (text: string): ReactNode[] =>
  text.split(/(«[^»]+»|“[^”]+”)/).map((part, i) => (i % 2 ? <strong key={i}>{part.slice(1, -1)}</strong> : part))

type Status = { state: 'wait' | 'checking' | 'ok' | 'error'; text: string }

/**
 * Пошаговая инструкция для ключа API простыми словами. Кнопка открывает нужную страницу (PlayOS сворачивается),
 * а скопированный там ключ PlayOS замечает в буфере обмена сам: сохраняет, проверяет и возвращается на экран.
 */
export function KeyGuide({ kind, save, onClose }: { kind: ApiKeyKind; save: Save; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const g = guide(kind)
  const wait: Status = { state: 'wait', text: t('Ждём ключ: как только вы его скопируете, PlayOS вставит его сам и вернётся на экран.') }
  const [status, setStatus] = useState<Status>(wait)
  const done = status.state === 'ok'
  useSpatialNav(ref, { priority: 40, onBack: onClose, autoFocus: '.btn-primary' })

  const apply = async (key: string) => {
    play('toggleOn')
    await save({ [FIELD[kind]]: key })
    if (kind === 'sgdb') return setStatus({ state: 'ok', text: t('Ключ сохранён — обложки теперь ищутся и в SteamGridDB.') })
    setStatus({ state: 'checking', text: t('Ключ сохранён. Проверяем подключение…') })
    const res = (await api.testTrophyAccounts().catch(() => null))?.[kind]
    if (!res) return setStatus({ state: 'error', text: t('Ключ сохранён, но проверить подключение не удалось.') })
    if (res.state === 'off')
      return setStatus({
        state: 'error',
        text: kind === 'ra' ? t('Ключ сохранён. Осталось вписать логин RetroAchievements в настройках.') : t('Ключ сохранён. Осталось указать профиль Steam в настройках.')
      })
    if (res.state === 'error') play('error')
    setStatus({ state: res.state, text: res.text })
  }

  useEffect(() => {
    void api.watchKeyClipboard(kind)
    const off = api.onKeyFound((e) => e.kind === kind && void apply(e.key))
    return () => {
      off()
      void api.watchKeyClipboard(null)
    }
  }, [kind])

  // Ключ сохранён — фокус на «Готово» (кнопки сменились, прежняя в фокусе исчезла)
  useEffect(() => {
    if (done) focusEl(ref.current?.querySelector<HTMLElement>('.btn-primary'))
  }, [done])

  const paste = async () => {
    const key = await api.keyFromClipboard(kind).catch(() => null)
    if (key) return void apply(key)
    play('error')
    setStatus({ state: 'error', text: t('В буфере обмена нет ключа — скопируйте его на странице ещё раз.') })
  }

  const open = (url: string) => {
    if (status.state === 'error') setStatus(wait)
    void api.openKeyPage(url)
  }

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }}>
      <motion.div
        className="dialog key-guide"
        ref={ref}
        initial={{ opacity: 0, transform: 'scale(0.96)' }}
        animate={{ opacity: 1, transform: 'scale(1)' }}
        exit={{ opacity: 0, transform: 'scale(0.98)', transition: { duration: 0.12 } }}
        transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
      >
        <h2 className="dialog-title">{g.title}</h2>
        <p className="dialog-text">{g.why}</p>
        <ol className="key-steps">
          {g.steps.map((s, i) => (
            <li key={i}>
              <span>{emph(s)}</span>
            </li>
          ))}
        </ol>
        {g.extra && (
          <div className="key-extra">
            <span>{emph(g.extra.text)}</span>
            <button data-nav className="btn btn-glass btn-sm" onClick={() => open(g.extra!.url)}>
              {g.extra.button}
            </button>
          </div>
        )}
        <p className={`account-state is-${status.state}`} role="status" aria-live="polite">
          <span className="account-dot" />
          {status.text}
        </p>
        <div className="dialog-actions">
          {done ? (
            <button data-nav className="btn btn-primary" onClick={onClose}>
              {t('Готово')}
            </button>
          ) : (
            <>
              <button data-nav className="btn btn-glass" onClick={onClose}>
                {t('Закрыть')}
              </button>
              <button data-nav className="btn btn-glass" onClick={() => void paste()}>
                {t('Вставить из буфера')}
              </button>
              <button data-nav className="btn btn-primary" onClick={() => open(g.url)}>
                {t('Открыть страницу')}
              </button>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}

/** Кнопка рядом с полем ключа в настройках: открывает инструкцию */
export function KeyGuideButton({ kind, save }: { kind: ApiKeyKind; save: Save }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button data-nav className="btn btn-glass btn-sm" onClick={() => setOpen(true)}>
        <IconKey /> {t('Получить ключ')}
      </button>
      {createPortal(
        <AnimatePresence>{open && <KeyGuide key={kind} kind={kind} save={save} onClose={() => setOpen(false)} />}</AnimatePresence>,
        document.querySelector('.app') ?? document.body
      )}
    </>
  )
}
