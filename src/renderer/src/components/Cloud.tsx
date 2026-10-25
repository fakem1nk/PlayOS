import { motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CloudProviderId, CloudRestoreChoice, CloudRestoreOffer, CloudStatus, CloudSyncState, Game, GameCloudStatus, SaveConflict, SaveVersion, Settings } from '@shared/types'
import { api } from '../lib/api'
import { ago, bytes, lastPlayed } from '../lib/format'
import { useSpatialNav } from '../lib/nav'
import { toast } from '../lib/state'
import { play } from '../lib/sound'
import { ActionRow, Cycler, Toggle } from './Controls'
import { IconCloud, IconFolder, IconSync } from './Icons'
import { qrMatrix } from '../lib/qr'
import { locale, t } from '@shared/i18n'

const DEFAULTS = { saves: true, keepVersions: 5 }
/** Сколько версий можно хранить: любое число от 1 до 30 */
const VERSION_OPTIONS = Array.from({ length: 30 }, (_, i) => ({ id: String(i + 1), label: String(i + 1) }))
const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const timeFmt = new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' })
const when = (ts: number) => `${lastPlayed(ts)}, ${timeFmt.format(ts)}`

export function stateLabel(state: CloudSyncState, lastSync?: number) {
  switch (state) {
    case 'synced':
      return lastSync ? t('Синхронизировано {v}', { v: ago(lastSync) }) : t('Синхронизировано')
    case 'syncing':
      return t('Синхронизация…')
    case 'pending':
      return t('Ещё не синхронизировано')
    case 'playing':
      return t('Синхронизируется после игры')
    case 'conflict':
      return t('Сохранения разошлись')
    case 'offline':
      return t('Нет связи с облаком')
    case 'error':
      return t('Ошибка синхронизации')
    case 'steam':
      return t('Синхронизируется через Steam')
    case 'nosaves':
      return t('Сохранения не найдены')
    default:
      return t('Облако выключено')
  }
}

export function useCloudStatus() {
  const [status, setStatus] = useState<CloudStatus | null>(null)
  useEffect(() => {
    void api.cloudStatus().then(setStatus)
    return api.onCloudStatus(setStatus)
  }, [])
  return status
}

/** Раздел настроек «Облако»: вход, переключатели, статус */
/** compact — для стартового окна: только вход и состояние, тонкие настройки остаются в «Настройках» */
export function CloudPanel({ s, save, compact }: { s: Settings; save: (patch: Partial<Settings>) => Promise<unknown>; compact?: boolean }) {
  const status = useCloudStatus()
  const cloud = { ...DEFAULTS, ...s.cloud }
  const setCloud = (patch: Partial<typeof cloud>) => save({ cloud: { ...cloud, ...patch } })

  const signIn = async (provider: CloudProviderId) => {
    try {
      let folder: string | undefined
      if (provider === 'folder') {
        folder = (await api.pickFile('folder')) ?? undefined
        if (!folder) return
      }
      // Первый вход включает синхронизацию сохранений
      if (!s.cloud) await save({ cloud: DEFAULTS })
      await api.cloudSignIn(provider, folder)
      play('select')
    } catch (e) {
      play('error')
      toast({ title: t('Не удалось подключить облако'), message: clean(e), tone: 'error' })
    }
  }

  const syncNow = async () => {
    play('select')
    const st = await api.cloudSyncNow().catch((e) => (toast({ title: t('Синхронизация не удалась'), message: clean(e), tone: 'error' }), null))
    if (st?.state === 'conflict') toast({ title: t('Сохранения разошлись'), message: t('Откройте игру — PlayOS спросит, какую версию оставить.') })
  }

  if (!status) return null
  const account = status.account
  return (
    <>
      {!compact && (
        <h2 className="panel-title">
          <IconCloud /> {t('Облачные сохранения')}
        </h2>
      )}
      {!compact && (
        <div className="note">
          {account
            ? t('Сохранения PS2, PS3 и PC-игр не из Steam хранятся в вашем облаке и одинаковы на всех ваших ПК. У игр из Steam работает Steam Cloud.')
            : t('Сохранения PS2, PS3 и PC-игр не из Steam хранятся в вашем облаке и одинаковы на всех ваших ПК. У игр из Steam работает Steam Cloud. Пока облако не подключено, сохранения остаются только на этом ПК.')}
        </div>
      )}

      {status.pending ? (
        <div className="setting setting-static cloud-code">
          <span className="setting-text">
            <span className="setting-label">{t('Подтвердите вход на телефоне')}</span>
            <span className="setting-hint">{t('Наведите камеру телефона на QR-код или откройте {url} и введите код:', { url: status.pending.url.replace(/^https?:\/\//, '') })}</span>
            <span className="cloud-code-value">{status.pending.code}</span>
          </span>
          <QrCode text={status.pending.url} label={t('QR-код: {url}', { url: status.pending.url })} />
          <button data-nav className="btn btn-glass btn-sm" onClick={() => void api.cloudCancelSignIn()}>
            {t('Отмена')}
          </button>
        </div>
      ) : !account ? (
        <>
          {status.available.includes('yandex') ? (
            <ActionRow
              label={t('Яндекс Диск')}
              hint={t('Вход по коду с телефона. Сохранения лягут в папку «Приложения/PlayOS» на вашем Диске.')}
              button={t('Войти')}
              icon={<IconCloud />}
              onClick={() => void signIn('yandex')}
            />
          ) : (
            <div className="setting setting-static">
              <span className="setting-text">
                <span className="setting-label">{t('Яндекс Диск')}</span>
                <span className="setting-hint">{t('В этой сборке нет ключей приложения Яндекса — используйте папку синхронизации.')}</span>
              </span>
            </div>
          )}
          {status.available.includes('google') && (
            <ActionRow
              label="Google Drive"
              hint={t('Вход по коду с телефона. Сохранения лягут в папку PlayOS на вашем Диске — остальные файлы PlayOS не видит.')}
              button={t('Войти')}
              icon={<IconCloud />}
              onClick={() => void signIn('google')}
            />
          )}
          <ActionRow
            label={t('Папка синхронизации')}
            hint={t('OneDrive, Google Диск для ПК, Dropbox или Syncthing: PlayOS положит сохранения в папку PlayOS внутри, а клиент облака разнесёт их по ПК.')}
            button={t('Выбрать папку')}
            icon={<IconFolder />}
            onClick={() => void signIn('folder')}
          />
        </>
      ) : (
        <>
          <div className="setting setting-static cloud-account">
            <span className="setting-text">
              <span className="setting-label">{account.provider === 'yandex'
                  ? t('Яндекс Диск — {name}', { name: account.name })
                  : account.provider === 'google'
                    ? t('Google Drive — {name}', { name: account.name })
                    : t('Папка {name}', { name: account.name })}</span>
              <span className={`setting-hint cloud-state is-${status.state}`}>
                {status.state === 'syncing' && <IconSync className="is-spinning" />}
                {stateLabel(status.state, status.lastSync)}
                {status.error && status.state !== 'synced' ? ` · ${status.error}` : ''}
              </span>
              {account.total ? (
                <span className="cloud-quota">
                  <span className="cloud-quota-fill" style={{ width: `${Math.min(100, ((account.used ?? 0) / account.total) * 100)}%` }} />
                </span>
              ) : null}
              {account.total ? <span className="setting-hint">{t('Занято {used} из {total}', { used: bytes(account.used ?? 0), total: bytes(account.total) })}</span> : null}
            </span>
            <button data-nav className="btn btn-glass btn-sm" disabled={status.state === 'syncing'} onClick={() => void syncNow()}>
              <IconSync className={status.state === 'syncing' ? 'is-spinning' : undefined} />
              {t('Синхронизировать')}
            </button>
          </div>
          {!compact && (
            <>
              <Toggle
                label={t('Профиль и настройки')}
                hint={t('Имя, аватар, трофеи PlayOS и настройки, кроме путей к эмуляторам и выбора экрана.')}
                value={cloud.profile !== false}
                onChange={(v) => void setCloud({ profile: v })}
              />
              <Toggle
                label={t('Библиотека и время игры')}
                hint={t('Список игр, наигранное время, сессии, избранное и обложки. Игры с другого ПК появятся с пометкой «не установлена».')}
                value={cloud.library !== false}
                onChange={(v) => void setCloud({ library: v })}
              />
              <Toggle
                label={t('Сохранения игр')}
                hint={t('Сверяются при запуске PlayOS, перед игрой, после неё и каждые 10 минут.')}
                value={cloud.saves}
                onChange={(v) => void setCloud({ saves: v })}
              />
              <Toggle
                label={t('Быстрые сохранения PS2')}
                hint={t('Слоты PCSX2 весят десятки мегабайт. Карты памяти синхронизируются всегда.')}
                value={!!cloud.ps2States}
                onChange={(v) => void setCloud({ ps2States: v })}
              />
              <Cycler
                label={t('Версий в истории')}
                hint={t('Столько прошлых версий каждого сохранения хранится в облаке, к любой можно вернуться. От 1 до 30, по умолчанию 5.')}
                value={String(cloud.keepVersions)}
                options={VERSION_OPTIONS}
                onChange={(v) => void setCloud({ keepVersions: Number(v) })}
              />
              <ActionRow
                label={t('Выйти из облака')}
                hint={t('Сохранения на этом ПК останутся, синхронизация остановится.')}
                button={t('Выйти')}
                onClick={() => void api.cloudSignOut()}
              />
            </>
          )}
        </>
      )}
    </>
  )
}

/** QR-код ссылки: тёмные модули на белом с полями в 4 модуля — так его читает любая камера */
function QrCode({ text, label }: { text: string; label: string }) {
  const m = useMemo(() => qrMatrix(text), [text])
  const n = m.length + 8
  const d = m.flatMap((row, y) => row.map((v, x) => (v ? `M${x + 4} ${y + 4}h1v1h-1z` : ''))).join('')
  return (
    <svg className="cloud-qr" viewBox={`0 0 ${n} ${n}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  )
}

/** Состояние сохранений игры для её страницы; обновляется вместе с облаком */
export function useGameCloud(game: Game) {
  const [st, setSt] = useState<GameCloudStatus | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => void api.gameCloud(game.id).then((s) => alive && setSt(s))
    load()
    const off = api.onCloudStatus(load)
    return () => {
      alive = false
      off()
    }
  }, [game.id])
  return st
}

/** Диалог «Сохранения разошлись»: как на PS5 — две карточки, выбирается одна, другая остаётся в истории */
export function SaveConflictDialog({ conflict, title, onDone, onLater, onCancel }: { conflict: SaveConflict; title: string; onDone: () => void; onLater: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  useSpatialNav(ref, { priority: 45, onBack: onCancel, autoFocus: '.save-card' })
  const choose = async (choice: 'local' | 'cloud') => {
    setBusy(true)
    play('select')
    try {
      await api.cloudResolve(conflict.gameId, choice)
      onDone()
    } catch (e) {
      play('error')
      toast({ title: t('Не удалось синхронизировать'), message: clean(e), tone: 'error' })
      setBusy(false)
    }
  }
  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }}>
      <motion.div
        className="dialog save-conflict"
        ref={ref}
        initial={{ opacity: 0, transform: 'scale(0.96)' }}
        animate={{ opacity: 1, transform: 'scale(1)' }}
        exit={{ opacity: 0, transform: 'scale(0.98)', transition: { duration: 0.12 } }}
        transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
      >
        <h2 className="dialog-title">{t('Сохранения разошлись')}</h2>
        <p className="dialog-text">{t('«{title}» сохранялась и на этом ПК, и на другом. Выберите, с какими сохранениями играть, — вторые останутся в истории версий.', { title })}</p>
        <div className="save-cards">
          <button data-nav className="save-card" disabled={busy} onClick={() => void choose('local')}>
            <span className="save-card-label">{t('Этот ПК')}</span>
            <span className="save-card-time">{conflict.local.at ? when(conflict.local.at) : '—'}</span>
            <span className="save-card-meta">{bytes(conflict.local.size)}</span>
          </button>
          <button data-nav className="save-card" disabled={busy} onClick={() => void choose('cloud')}>
            <span className="save-card-label">{t('Облако')}</span>
            <span className="save-card-time">{when(conflict.cloud.at)}</span>
            <span className="save-card-meta">{conflict.cloud.device}</span>
          </button>
        </div>
        <div className="dialog-actions">
          <button data-nav className="btn btn-glass" disabled={busy} onClick={onLater}>
            {t('Играть без синхронизации')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

/** История версий сохранений игры в облаке */
export function SaveVersionsDialog({ game, onClose }: { game: Game; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [list, setList] = useState<SaveVersion[] | null>(null)
  const [busy, setBusy] = useState(false)
  useSpatialNav(ref, { priority: 45, onBack: onClose, autoFocus: '.save-version, .btn-glass' })
  useEffect(() => {
    api
      .cloudVersions(game.id)
      .then(setList)
      .catch(() => setList([]))
  }, [game.id])
  const restore = async (v: SaveVersion) => {
    setBusy(true)
    try {
      await api.cloudRestore(game.id, v.name)
      play('select')
      toast({ title: t('Сохранения возвращены'), message: t('Версия от {v} теперь на этом ПК и в облаке.', { v: when(v.at) }), tone: 'success' })
      onClose()
    } catch (e) {
      play('error')
      toast({ title: t('Не удалось вернуть версию'), message: clean(e), tone: 'error' })
      setBusy(false)
    }
  }
  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }}>
      <motion.div
        className="dialog save-versions"
        ref={ref}
        initial={{ opacity: 0, transform: 'scale(0.96)' }}
        animate={{ opacity: 1, transform: 'scale(1)' }}
        exit={{ opacity: 0, transform: 'scale(0.98)', transition: { duration: 0.12 } }}
        transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
      >
        <h2 className="dialog-title">{t('История сохранений')}</h2>
        <p className="dialog-text">{t('Выберите версию, чтобы вернуться к ней. Текущие сохранения останутся в истории.')}</p>
        {!list ? (
          <div className="gp-skeleton">
            <span />
            <span />
          </div>
        ) : list.length ? (
          <ol className="save-version-list">
            {list.map((v, i) => (
              <li key={v.name}>
                <button data-nav className="save-version" disabled={busy || i === 0} onClick={() => void restore(v)}>
                  <span className="save-version-time">{when(v.at)}</span>
                  <span className="save-version-meta">
                    {i === 0 ? t('текущая · ') : ''}
                    {v.device} · {bytes(v.size)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="gp-empty">{t('В облаке пока нет сохранений этой игры.')}</p>
        )}
        <div className="dialog-actions">
          <button data-nav className="btn btn-glass" onClick={onClose}>
            {t('Закрыть')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

/**
 * В облаке уже есть профиль (переустановка или новый ПК): что подтянуть.
 * Пока ответа нет, облако с этим ПК ничего не синхронизирует — свежая установка не перезапишет профиль.
 */
export function RestoreDialog({ offer }: { offer: CloudRestoreOffer }) {
  const ref = useRef<HTMLDivElement>(null)
  const [choice, setChoice] = useState<CloudRestoreChoice>({ profile: true, library: true, saves: true })
  const [busy, setBusy] = useState(false)
  const answer = async (c: CloudRestoreChoice | null) => {
    setBusy(true)
    play(c ? 'select' : 'back')
    await api.cloudRestoreChoice(c).catch((e) => toast({ title: t('Не удалось синхронизировать'), message: clean(e), tone: 'error' }))
    if (c) toast({ title: offer.merge ? t('Данные объединяются') : t('Профиль восстанавливается'), message: t('Игры, время и сохранения появятся через минуту.'), tone: 'success' })
  }
  useSpatialNav(ref, { priority: 50, onBack: () => void answer(null), autoFocus: '.btn-primary' })
  const set = (patch: Partial<CloudRestoreChoice>) => setChoice((c) => ({ ...c, ...patch }))
  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }}>
      <motion.div
        className="dialog cloud-restore"
        ref={ref}
        initial={{ opacity: 0, transform: 'scale(0.96)' }}
        animate={{ opacity: 1, transform: 'scale(1)' }}
        exit={{ opacity: 0, transform: 'scale(0.98)', transition: { duration: 0.12 } }}
        transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
      >
        <h2 className="dialog-title">{offer.name ? t('Найден профиль «{name}»', { name: offer.name }) : t('В облаке уже есть данные PlayOS')}</h2>
        <p className="dialog-text">
          {[
            offer.device && t('Последний раз с {device}', { device: offer.device }),
            offer.at && ago(offer.at),
            offer.games && t('игр в библиотеке: {n}', { n: offer.games })
          ]
            .filter(Boolean)
            .join(' · ')}
          {'. '}
          {offer.merge ? t('Выбранное объединится с данными этого ПК — ничего не пропадёт.') : t('Выберите, что перенести на этот ПК.')}
        </p>
        <div className="cloud-restore-options">
          <Toggle label={t('Профиль и настройки')} hint={t('Имя, аватар, трофеи PlayOS, тема и язык')} value={choice.profile} onChange={(v) => set({ profile: v })} />
          <Toggle label={t('Библиотека и время игры')} hint={t('Игры, наигранное время, сессии и обложки')} value={choice.library} onChange={(v) => set({ library: v })} />
          <Toggle label={t('Сохранения игр')} hint={t('Скачаются для игр, которые есть на этом ПК')} value={choice.saves} onChange={(v) => set({ saves: v })} />
        </div>
        <div className="dialog-actions">
          <button data-nav className="btn btn-glass" disabled={busy} onClick={() => void answer(null)}>
            {t('Не сейчас')}
          </button>
          <button data-nav className="btn btn-primary" disabled={busy || !(choice.profile || choice.library || choice.saves)} onClick={() => void answer(choice)}>
            {offer.merge ? t('Объединить') : t('Восстановить')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
