import { AnimatePresence, motion } from 'motion/react'
import { useRef, useState } from 'react'
import { useInputLayer } from '../lib/input'
import type { ArtCandidate, Game, GameDraft, Platform, SaveProgress, Settings } from '@shared/types'
import { api } from '../lib/api'
import { hueOf, media } from '../lib/format'
import { useSpatialNav } from '../lib/nav'
import { toast } from '../lib/state'
import { play } from '../lib/sound'
import { ArtSearch } from './ArtSearch'
import { Field, Toggle } from './Controls'
import { Glyph, Hint } from './Glyph'
import { IconClose, IconDisc, IconFolder, IconImage, IconMonitor, IconSearch } from './Icons'
import { t, locale } from '@shared/i18n'

const PLATFORMS: { id: Platform; title: string; text: string; icon: React.ReactNode }[] = [
  { id: 'pc', title: t('Игра для PC'), text: t('EXE, ярлык .lnk или .bat с компьютера'), icon: <IconMonitor /> },
  { id: 'ps2', title: 'PlayStation 2', text: t('Образ ISO, CHD или CSO — запуск через PCSX2'), icon: <IconDisc /> },
  { id: 'ps3', title: 'PlayStation 3', text: t('EBOOT.BIN или папка игры — запуск через RPCS3'), icon: <IconDisc /> }
]

type ArtField = 'cover' | 'hero' | 'logo'

const emptyDraft = (platform: Platform): GameDraft => ({ title: '', platform, path: '' })

/** Длинный путь сокращаем с начала — важнее видеть папку и имя файла. */
const shortPath = (p: string, max = 64) => (p.length > max ? '…' + p.slice(p.length - max + 1) : p)

interface Props {
  game?: Game
  settings: Settings
  onClose: () => void
  onSaved: (g: Game) => void
}

export function GameEditor({ game, settings, onClose, onSaved }: Props) {
  const [step, setStep] = useState<'platform' | 'form'>(game ? 'form' : 'platform')
  const [draft, setDraft] = useState<GameDraft>(() =>
    game
      ? {
          id: game.id,
          title: game.title,
          platform: game.platform,
          path: game.path,
          args: game.args ?? '',
          workDir: game.workDir,
          customCommand: game.customCommand ?? '',
          trackProcess: game.trackProcess ?? '',
          serial: game.serial,
          steamAppId: game.steamAppId,
          launcher: game.launcher,
          raGameId: game.raGameId,
          cover: game.cover,
          coverAnimated: game.coverAnimated,
          hero: game.hero,
          logo: game.logo,
          icon: game.icon,
          favorite: game.favorite,
          overlay: game.overlay,
          saveDirs: game.saveDirs,
          cloudSaves: game.cloudSaves
        }
      : emptyDraft('pc')
  )
  const [busy, setBusy] = useState<{ label: string; kind: 'inspect' | 'save' } | null>(null)
  const [progress, setProgress] = useState<SaveProgress | null>(null)
  const [slow, setSlow] = useState(false)
  // Номер текущего чтения файла: отменённое чтение просто игнорируется
  const inspectToken = useRef(0)
  const [searching, setSearching] = useState(false)
  const [searchedOnce, setSearchedOnce] = useState(false)
  const autoTitle = useRef<string | undefined>(undefined)
  const ref = useRef<HTMLDivElement>(null)

  const set = (patch: Partial<GameDraft>) => setDraft((d) => ({ ...d, ...patch }))

  useSpatialNav(ref, {
    priority: 10,
    active: !searching,
    onBack: () => (step === 'form' && !game ? setStep('platform') : onClose()),
    autoFocus:
      step === 'platform' ? '.platform-card' : searchedOnce ? '.art-search-btn' : draft.path ? '.editor-form input' : '[data-autofocus]',
    focusKey: step,
    onAction: (a) => {
      if (a === 'search' && step === 'form') openSearch()
      else if (a !== 'home') return false
    }
  })

  const choosePlatform = (p: Platform) => {
    play('select')
    setDraft(emptyDraft(p))
    setStep('form')
    // Сразу предлагаем выбрать файл — самый частый сценарий
    setTimeout(() => pickGameFile(p), 260)
  }

  const pickGameFile = async (platform = draft.platform, folder = false) => {
    const kind = platform === 'pc' ? 'exe' : platform === 'ps2' ? 'ps2' : folder ? 'ps3folder' : 'ps3'
    const file = await api.pickFile(kind)
    if (!file) return
    const token = ++inspectToken.current
    setBusy({ label: t('Читаем файл игры…'), kind: 'inspect' })
    try {
      const info = await api.inspect(platform, file)
      if (token !== inspectToken.current) return
      setDraft((d) => {
        const titleWasAuto = !d.title || d.title === autoTitle.current
        autoTitle.current = info.title
        return {
          ...d,
          // Выбрали EXE — дальше запускаем его напрямую, а не через Steam
          launcher: undefined,
          path: info.path ?? file,
          title: titleWasAuto && info.title ? info.title : d.title,
          serial: info.serial ?? d.serial,
          args: info.args ?? d.args,
          workDir: info.workDir ?? d.workDir,
          cover: d.cover || info.cover,
          hero: d.hero || info.hero,
          icon: info.icon ?? d.icon
        }
      })
    } finally {
      if (token === inspectToken.current) setBusy(null)
    }
  }

  /** ○ во время ожидания: отменяем загрузку арта или чтение файла */
  const cancelBusy = () => {
    if (!busy) return
    play('back')
    if (busy.kind === 'save') void api.cancelSave()
    else {
      inspectToken.current++
      setBusy(null)
    }
  }

  useInputLayer(
    (a) => {
      if (a === 'back') cancelBusy()
      // Остальные кнопки во время ожидания ничего не делают
    },
    25,
    !!busy
  )

  const pickImage = async (field: ArtField) => {
    const file = await api.pickFile('image')
    if (!file) return
    // GIF на месте обложки — анимированная обложка: статичная остаётся для плиток вне фокуса
    if (field === 'cover' && /\.gif$/i.test(file)) set({ coverAnimated: file })
    else set({ [field]: file })
  }

  const pickSaveDir = async () => {
    const dir = await api.pickFile('folder')
    if (dir) set({ saveDirs: [dir] })
  }

  const openSearch = () => {
    play('select')
    setSearchedOnce(true)
    setSearching(true)
  }

  const applyCandidate = (c: ArtCandidate) => {
    setSearching(false)
    play('select')
    // Новая обложка — старая анимация от другого арта больше не подходит
    if (c.source === 'disc') set({ cover: c.cover, coverAnimated: undefined })
    else {
      // Название из Steam в приоритете: оно аккуратнее, чем имя файла или папки
      const title = c.title.replace(/[™®©]/g, '').replace(/\s+/g, ' ').trim()
      const appId = c.source === 'steam' ? Number(c.key.replace(/^steam-/, '')) || undefined : undefined
      set({
        title: title || draft.title,
        cover: c.cover ?? draft.cover,
        coverAnimated: c.coverAnimated,
        hero: c.hero ?? draft.hero,
        logo: c.logo,
        ...(appId && draft.platform === 'pc' ? { steamAppId: appId } : {})
      })
      if (title && title !== draft.title) toast({ title: t('Название взято из Steam'), message: title })
    }
  }

  const save = async () => {
    if (!draft.path.trim()) {
      play('error')
      toast({ title: t('Не выбран файл игры'), message: t('Нажмите «Выбрать файл» и укажите игру.'), tone: 'error' })
      return
    }
    if (!draft.title.trim()) {
      play('error')
      toast({ title: t('Введите название игры'), tone: 'error' })
      return
    }
    const downloading = [draft.cover, draft.hero, draft.logo].some((v) => v?.startsWith('http'))
    setBusy({ label: downloading ? t('Скачиваем арт…') : t('Сохраняем…'), kind: 'save' })
    setProgress(null)
    setSlow(false)
    const off = api.onSaveProgress(setProgress)
    // Если сервер долго не отдаёт файл — подсказываем, что можно отменить
    const slowTimer = window.setTimeout(() => setSlow(true), 8000)
    try {
      const saved = await api.saveGame({ ...draft, title: draft.title.trim() })
      play('select')
      onSaved(saved)
    } catch (e) {
      const msg = (e as Error).message
      if (/cancelled/.test(msg)) {
        toast({ title: t('Загрузка арта отменена'), message: t('Игра не сохранена. Можно выбрать другой арт или попробовать ещё раз.') })
      } else {
        play('error')
        toast({ title: t('Не удалось сохранить'), message: msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), tone: 'error' })
      }
    } finally {
      off()
      clearTimeout(slowTimer)
      setBusy(null)
      setProgress(null)
    }
  }

  const template =
    draft.platform === 'ps2'
      ? `"${settings.pcsx2Path}" ${settings.pcsx2Args}`
      : `"${settings.rpcs3Path || 'rpcs3.exe'}" ${settings.rpcs3Args}`

  return (
    <motion.div
      className="sheet"
      initial={{ transform: 'translateY(100%)' }}
      animate={{ transform: 'translateY(0%)' }}
      exit={{ transform: 'translateY(100%)', transition: { duration: 0.24, ease: [0.32, 0.72, 0, 1] } }}
      transition={{ duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
    >
      <div className="sheet-inner" ref={ref}>
        <header className="sheet-head">
          <h1 className="sheet-title">{game ? t('Изменить игру') : step === 'platform' ? t('Добавить игру') : PLATFORMS.find((p) => p.id === draft.platform)!.title}</h1>
          <button data-nav className="btn btn-round" onClick={onClose} aria-label={t('Закрыть')}>
            <IconClose />
          </button>
        </header>

        <AnimatePresence mode="wait" initial={false}>
          {step === 'platform' ? (
            <motion.div
              key="platform"
              className="platforms"
              initial={{ opacity: 0, transform: 'translateY(1rem)' }}
              animate={{ opacity: 1, transform: 'translateY(0rem)' }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
              transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
            >
              {PLATFORMS.map((p) => (
                <button key={p.id} data-nav className={`platform-card platform-${p.id}`} onClick={() => choosePlatform(p.id)}>
                  <span className="platform-icon">{p.icon}</span>
                  <span className="platform-title">{p.title}</span>
                  <span className="platform-text">{p.text}</span>
                </button>
              ))}
            </motion.div>
          ) : (
            <motion.div
              key="form"
              className="editor"
              initial={{ opacity: 0, transform: 'translateY(1rem)' }}
              animate={{ opacity: 1, transform: 'translateY(0rem)' }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
              transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
            >
              <div className="editor-form">
                <div className="field">
                  <span className="field-label">
                    {draft.launcher === 'steam' ? t('Папка игры в Steam') : draft.platform === 'pc' ? t('Файл игры') : draft.platform === 'ps2' ? t('Образ диска') : t('EBOOT.BIN или образ')}
                  </span>
                  <div className="field-row">
                    <div className={`path-display ${draft.path ? '' : 'is-empty'}`} title={draft.path}>
                      {draft.path ? shortPath(draft.path) : t('Файл не выбран')}
                    </div>
                    <button data-nav data-autofocus={!draft.path || undefined} className="btn btn-glass btn-sm" onClick={() => pickGameFile()}>
                      <IconFolder /> {t('Выбрать файл')}
                    </button>
                    {draft.platform === 'ps3' && (
                      <button data-nav className="btn btn-glass btn-sm" onClick={() => pickGameFile('ps3', true)}>
                        {t('Папка')}
                      </button>
                    )}
                  </div>
                  {draft.serial && <span className="field-hint">{t('Серийный номер диска: {serial}', { serial: draft.serial })}</span>}
                  {draft.launcher === 'steam' && (
                    <span className="field-hint">
                      {t('Игра запускается через Steam, время считается по процессам в этой папке. Выберите EXE, чтобы запускать её напрямую.')}
                    </span>
                  )}
                </div>

                <Field label={t('Название')} value={draft.title} onChange={(v) => set({ title: v })} placeholder={t('Как игра будет называться в библиотеке')} />

                {draft.platform === 'pc' ? (
                  <>
                    <Field label={t('Параметры запуска')} value={draft.args ?? ''} onChange={(v) => set({ args: v })} placeholder={t('Необязательно, например -windowed')} mono />
                    <Field
                      label={t('Процесс игры')}
                      value={draft.trackProcess ?? ''}
                      onChange={(v) => set({ trackProcess: v })}
                      placeholder={t('Необязательно, например Game-Win64-Shipping.exe')}
                      hint={t('Если выбранный EXE — лаунчер, укажите процесс самой игры, чтобы время считалось точно.')}
                      mono
                    />
                    <Field
                      label="Steam AppID"
                      value={draft.steamAppId ? String(draft.steamAppId) : ''}
                      onChange={(v) => set({ steamAppId: Number(v.replace(/\D/g, '')) || undefined })}
                      placeholder={t('Определится сам — для трофеев Steam')}
                      mono
                    />
                  </>
                ) : (
                  <>
                    <Field
                      label={t('Параметры запуска')}
                      value={draft.args ?? ''}
                      onChange={(v) => set({ args: v })}
                      placeholder={draft.platform === 'ps2' ? t('Необязательно, например -nogui') : t('Необязательно, например --no-gui')}
                      hint={t('Добавятся к команде эмулятора из настроек: на место {args} или перед путём к игре.')}
                      mono
                    />
                    <Field
                      label={t('Своя команда запуска')}
                      value={draft.customCommand ?? ''}
                      onChange={(v) => set({ customCommand: v })}
                      placeholder={template}
                      hint={t('Оставьте пустым — будет использован эмулятор из настроек. {rom} подставит путь к игре.')}
                      mono
                    />
                  </>
                )}
                {draft.platform === 'ps2' && (
                  <Field
                    label={t('ID в RetroAchievements')}
                    value={draft.raGameId ? String(draft.raGameId) : ''}
                    onChange={(v) => set({ raGameId: Number(v.replace(/\D/g, '')) || undefined })}
                    placeholder={t('Определится по образу — для трофеев PS2')}
                    mono
                  />
                )}

                <Toggle
                  label={t('Оверлей в этой игре')}
                  hint={
                    settings.overlayEnabled === false
                      ? t('Оверлей выключен в настройках для всех игр.')
                      : t('Выключите, если кнопка PS/Guide нужна самой игре: PlayOS не будет открывать оверлей и показывать уведомления поверх неё.')
                  }
                  value={draft.overlay !== false}
                  onChange={(v) => set({ overlay: v ? undefined : false })}
                />

                {draft.launcher !== 'steam' && (
                  <>
                    <div className="setting setting-static">
                      <span className="setting-text">
                        <span className="setting-label">{t('Папка сохранений')}</span>
                        <span className="setting-hint" title={draft.saveDirs?.[0]}>
                          {draft.saveDirs?.length ? shortPath(draft.saveDirs[0]) : t('Определяется сама: по манифесту Ludusavi, Steam AppID и папкам эмуляторов')}
                        </span>
                      </span>
                      <span className="avatar-buttons">
                        <button data-nav className="btn btn-glass btn-sm" onClick={pickSaveDir}>
                          <IconFolder /> {t('Указать')}
                        </button>
                        {draft.saveDirs?.length ? (
                          <button data-nav className="btn btn-glass btn-sm" onClick={() => set({ saveDirs: undefined })}>
                            {t('Авто')}
                          </button>
                        ) : null}
                      </span>
                    </div>
                    <Toggle
                      label={t('Сохранения в облаке')}
                      hint={t('Работает, когда облако подключено в настройках. Выключите для игр со своим облаком.')}
                      value={draft.cloudSaves !== false}
                      onChange={(v) => set({ cloudSaves: v ? undefined : false })}
                    />
                  </>
                )}

                <div className="editor-actions">
                  <button data-nav className="btn btn-primary" onClick={save}>
                    {game ? t('Сохранить') : t('Добавить в библиотеку')}
                  </button>
                  <button data-nav className="btn btn-glass" onClick={onClose}>
                    {t('Отмена')}
                  </button>
                </div>
              </div>

              <div className="editor-art">
                <button data-nav className="btn btn-glass art-search-btn" onClick={openSearch}>
                  <IconSearch /> {t('Найти обложку и фон онлайн')}
                </button>
                <div className="art-grid">
                  <ArtSlot
                    label={t('Обложка')}
                    field="cover"
                    draft={draft}
                    onPick={pickImage}
                    onClear={() => set({ cover: undefined, coverAnimated: undefined })}
                    onClearAnimation={() => set({ coverAnimated: undefined })}
                  />
                  <div className="art-col">
                    <ArtSlot label={t('Фон')} field="hero" draft={draft} onPick={pickImage} onClear={() => set({ hero: undefined })} />
                    <ArtSlot label={t('Логотип')} field="logo" draft={draft} onPick={pickImage} onClear={() => set({ logo: undefined })} />
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <footer className="sheet-hints">
          <Hint glyph="confirm" label={t('Выбрать')} />
          <Hint glyph="back" label={step === 'form' && !game ? t('Назад') : t('Закрыть')} />
          {step === 'form' && <Hint glyph="search" label={t('Найти арт')} />}
        </footer>

        <AnimatePresence>
          {busy && <BusyOverlay label={busy.label} progress={progress} slow={slow} onCancel={cancelBusy} />}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {searching && (
          <ArtSearch
            initialQuery={draft.title}
            platform={draft.platform}
            serial={draft.serial}
            onPick={applyCandidate}
            onClose={() => setSearching(false)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function ArtSlot({
  label,
  field,
  draft,
  onPick,
  onClear,
  onClearAnimation
}: {
  label: string
  field: ArtField
  draft: GameDraft
  onPick: (f: ArtField) => void
  onClear: () => void
  /** Для обложки: убрать только анимацию */
  onClearAnimation?: () => void
}) {
  // У обложки в превью показываем анимацию, если она есть
  const animated = field === 'cover' ? media(draft.coverAnimated) : undefined
  const src = animated ?? media(draft[field])
  return (
    <div className={`art-slot art-${field}`}>
      <div className="art-preview" style={{ '--hue': hueOf(draft) } as React.CSSProperties}>
        {src ? <img src={src} alt="" /> : <IconImage />}
        {animated && <span className="art-anim-badge">{t('Анимация')}</span>}
      </div>
      <div className="art-meta">
        <span className="art-label">{label}</span>
        <span className="art-buttons">
          <button data-nav className="btn btn-glass btn-xs" onClick={() => onPick(field)}>
            {t('Файл…')}
          </button>
          {animated && onClearAnimation && (
            <button data-nav className="btn btn-glass btn-xs" onClick={onClearAnimation}>
              {t('Без анимации')}
            </button>
          )}
          {src && (
            <button data-nav className="btn btn-glass btn-xs" onClick={onClear}>
              {t('Убрать')}
            </button>
          )}
        </span>
      </div>
    </div>
  )
}

const ART_WORD: Record<SaveProgress['field'], string> = {
  cover: t('обложку'),
  coverAnimated: t('анимированную обложку'),
  hero: t('фон'),
  logo: t('логотип'),
  icon: t('иконку')
}

function size(bytes: number) {
  return bytes >= 1048576 ? t('{v} МБ', { v: (bytes / 1048576).toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }) : t('{v} КБ', { v: Math.max(1, Math.round(bytes / 1024)) })
}

/** Экран ожидания: что качаем, прогресс и отмена по ○ */
function BusyOverlay({ label, progress, slow, onCancel }: { label: string; progress: SaveProgress | null; slow: boolean; onCancel: () => void }) {
  const ratio = progress?.size ? Math.min(1, progress.received / progress.size) : null
  const title = progress
    ? t('Скачиваем {what}', { what: ART_WORD[progress.field] }) + (progress.total > 1 ? ` ${t('({step} из {total})', { step: progress.step, total: progress.total })}` : '')
    : label
  return (
    <motion.div className="busy" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }}>
      <div className="busy-card">
        <div className="busy-title">
          <span className="spinner" />
          {title}
        </div>
        {progress && (
          <>
            <div className={`busy-bar ${ratio === null ? 'is-indeterminate' : ''}`}>
              <span style={ratio === null ? undefined : { width: `${Math.round(ratio * 100)}%` }} />
            </div>
            <div className="busy-meta">
              {progress.received ? (progress.size ? t('{v} из {v2}', { v: size(progress.received), v2: size(progress.size) }) : size(progress.received)) : t('Подключаемся к серверу…')}
            </div>
          </>
        )}
        {slow && <div className="busy-slow">{t('Сервер отвечает медленно. Можно отменить и выбрать другой источник арта.')}</div>}
        <button className="btn btn-glass btn-sm busy-cancel" onClick={onCancel}>
          <Glyph name="back" /> {t('Отменить')}
        </button>
      </div>
    </motion.div>
  )
}
