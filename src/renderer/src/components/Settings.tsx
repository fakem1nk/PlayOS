import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AppState, BackupInfo, DisplayInfo, Pcsx2Info, Settings as SettingsT, UpdateState } from '@shared/types'
import { api } from '../lib/api'
import { focusEl, useSpatialNav } from '../lib/nav'
import { toast } from '../lib/state'
import { play, previewVolume } from '../lib/sound'
import { Avatar } from './Avatar'
import { ActionRow, BrowseButton, Cycler, Field, Toggle } from './Controls'
import { SystemInfoDialog } from './SystemInfoDialog'
import { PadMapper, padName } from './PadMapper'
import { ConfirmDialog } from './Menus'
import { gamesCount } from '../lib/format'
import { IconDisc, IconDownload, IconFolder, IconGamepad, IconImage, IconInfo, IconMonitor, IconTrophy, IconVolume } from './Icons'

type Section = 'profile' | 'library' | 'emulators' | 'display' | 'sound' | 'gamepad' | 'trophies' | 'system'
const SECTIONS: { id: Section; label: string; hint: string }[] = [
  { id: 'profile', label: 'Профиль', hint: 'Имя и аватар' },
  { id: 'library', label: 'Библиотека', hint: 'Импорт игр и обложки' },
  { id: 'emulators', label: 'Эмуляторы', hint: 'PCSX2 и RPCS3' },
  { id: 'display', label: 'Экран', hint: 'Монитор, масштаб, оформление' },
  { id: 'sound', label: 'Звук', hint: 'Звуки и музыка' },
  { id: 'gamepad', label: 'Геймпад', hint: 'Кнопки, оверлей, DualSense' },
  { id: 'trophies', label: 'Трофеи', hint: 'RetroAchievements и Steam' },
  { id: 'system', label: 'Система', hint: 'Запуск, данные, отчёты' }
]

interface Props {
  state: AppState
  active: boolean
  onExitTop: () => void
  /** Раздел, который открыть сразу (например, из списка трофеев) */
  initialSection?: string
  onSteamImport: () => void
}

export function Settings({ state, active, onExitTop, initialSection, onSteamImport }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  // Где сейчас фокус: в списке разделов или внутри раздела
  const zone = useRef<'sections' | 'panel'>('sections')
  const [section, setSection] = useState<Section>(((SECTIONS.some((x) => x.id === initialSection) && initialSection) || 'profile') as Section)
  const s = state.settings
  const save = (patch: Partial<SettingsT>) => api.saveSettings(patch)

  // Запоминаем, в какой колонке последний фокус (нативный focusin надёжнее onFocus у анимированной панели)
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const onFocusIn = (e: FocusEvent) => {
      zone.current = panelRef.current?.contains(e.target as Node) ? 'panel' : 'sections'
    }
    root.addEventListener('focusin', onFocusIn)
    return () => root.removeEventListener('focusin', onFocusIn)
  }, [])

  /** Фокус внутри раздела? Смотрим на фактический фокус; если поле ввода уже потеряло его (Esc) — на последнюю колонку */
  const focusInPanel = () => {
    const el = document.activeElement
    const known = el && el !== document.body && ref.current?.contains(el)
    return known ? !!panelRef.current?.contains(el) : zone.current === 'panel'
  }

  const focusSections = () => {
    zone.current = 'sections'
    focusEl(ref.current?.querySelector<HTMLElement>('.section-btn.is-active'))
  }

  /** ✕ на разделе — заходим внутрь: фокус на первый элемент панели (ждём, пока она отрисуется). */
  const enterPanel = (id: Section) => {
    setSection(id)
    play('select')
    let tries = 0
    const attempt = () => {
      const panel = panelRef.current
      const first = panel?.dataset.section === id ? panel.querySelector<HTMLElement>('[data-nav]') : null
      if (first) {
        zone.current = 'panel'
        focusEl(first)
      } else if (tries++ < 30) setTimeout(attempt, 16)
    }
    attempt()
  }

  useSpatialNav(ref, {
    priority: 0,
    active,
    // ○ / B: из раздела — назад к списку разделов, из списка — к вкладкам
    onBack: () => (focusInPanel() ? focusSections() : onExitTop()),
    onEdge: (dir) => dir === 'up' && !focusInPanel() && onExitTop(),
    // Между колонками ходим только «через вход»: из раздела — на активный пункт списка,
    // из списка — на первый элемент раздела (иначе ближайший по геометрии пункт сменил бы раздел)
    remap: (next, cur, dir) => {
      const inPanel = (el: Element) => !!panelRef.current?.contains(el)
      // Вверх/вниз колонку не покидаем
      if ((dir === 'up' || dir === 'down') && inPanel(cur) !== inPanel(next)) return null
      const active = () => ref.current?.querySelector<HTMLElement>('.section-btn.is-active') ?? next
      if (inPanel(cur) && !inPanel(next)) return active()
      // Влево из раздела — сразу в меню разделов. Исключение — сосед в той же строке (поле пути ← «Обзор»)
      if (dir === 'left' && inPanel(cur)) {
        const a = cur.getBoundingClientRect()
        const b = next.getBoundingClientRect()
        const sameRow = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > Math.min(a.height, b.height) * 0.5
        return sameRow ? next : active()
      }
      if (!inPanel(cur) && inPanel(next)) return panelRef.current?.querySelector<HTMLElement>('[data-nav]') ?? next
      return next
    },
    autoFocus: '.section-btn.is-active'
  })

  const browse = async (key: 'pcsx2Path' | 'rpcs3Path') => {
    const p = await api.pickFile('emulator')
    if (p) save({ [key]: p })
  }

  const pickAvatar = async () => {
    const p = await api.pickFile('image')
    if (!p) return
    await save({ avatar: p })
    toast({ title: 'Аватар обновлён', image: p, tone: 'success' })
  }

  const run = async (fn: () => Promise<number>, what: string) => {
    try {
      const n = await fn()
      toast({ title: what, message: n ? `Добавлено игр: ${n}` : 'Новых игр не найдено', tone: n ? 'success' : 'info' })
    } catch (e) {
      toast({ title: what, message: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), tone: 'error' })
    }
  }

  return (
    <div className="settings" ref={ref}>
      <aside className="sections">
        {SECTIONS.map((sec) => (
          <button
            key={sec.id}
            data-nav
            className={`section-btn ${section === sec.id ? 'is-active' : ''}`}
            onFocus={() => setSection(sec.id)}
            onClick={() => enterPanel(sec.id)}
          >
            {/* Подложка активного раздела переезжает между пунктами, а не мигает */}
            {section === sec.id && (
              <motion.span className="section-pill" layoutId="settings-section-pill" transition={{ type: 'spring', duration: 0.38, bounce: 0.12 }} />
            )}
            <span className="section-label">{sec.label}</span>
            <span className="section-hint">{sec.hint}</span>
          </button>
        ))}
      </aside>

        <motion.section
          key={section}
          ref={panelRef}
          data-section={section}
          className="panel"
          // Быстрое листание разделов не должно мигать: панель не исчезает целиком, а мягко проявляется
          initial={{ opacity: 0.35, transform: 'translateY(0.8rem)' }}
          animate={{ opacity: 1, transform: 'translateY(0rem)' }}
          transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
        >
          {section === 'profile' && (
            <>
              <h2 className="panel-title">Профиль</h2>
              <div className="setting setting-static avatar-setting">
                <Avatar name={s.userName} src={s.avatar} className="avatar-lg" />
                <span className="setting-text">
                  <span className="setting-label">Аватар</span>
                  <span className="setting-hint">PNG, JPG, WEBP или GIF. Картинка обрежется по кругу.</span>
                </span>
                <span className="avatar-buttons">
                  <button data-nav className="btn btn-glass btn-sm" onClick={pickAvatar}>
                    <IconImage /> Выбрать картинку
                  </button>
                  {s.avatar && (
                    <button data-nav className="btn btn-glass btn-sm" onClick={() => save({ avatar: undefined })}>
                      Убрать
                    </button>
                  )}
                </span>
              </div>
              <Field label="Имя пользователя" value={s.userName} onCommit={(v) => save({ userName: v.trim() || 'Игрок' })} />
            </>
          )}

          {section === 'library' && (
            <>
              <h2 className="panel-title">
                <IconDownload /> Добавить игры
              </h2>
              <ActionRow
                label="Импорт игр из Steam"
                hint="Найдёт установленные игры во всех библиотеках Steam. Они будут запускаться через Steam, а обложки, фоны и логотипы подтянутся из магазина."
                button="Выбрать игры"
                icon={<IconDownload />}
                onClick={onSteamImport}
              />
              <ActionRow
                label="Сканировать папку с образами PS2"
                hint="ISO, CHD, CSO и другие образы: названия и обложки подберутся по серийному номеру диска"
                button="Выбрать папку"
                icon={<IconFolder />}
                onClick={() => run(api.scanPs2Folder, 'Сканирование PS2')}
              />
              <ActionRow
                label="Импорт игр из RPCS3"
                hint="Игры из списка RPCS3 и папки dev_hdd0 с названиями и артом из PARAM.SFO"
                button="Импортировать"
                onClick={() => run(api.importRpcs3, 'Импорт RPCS3')}
              />
              <h2 className="panel-title">
                <IconImage /> Обложки и фоны
              </h2>
              <div className="note">
                Арт ищется в трёх местах: <strong>Steam</strong> (обложка, фон и логотип), <strong>SteamGridDB</strong> (огромная база, в том
                числе для игр PS2 и PS3 без PC-версии) и <strong>Википедия</strong>. Для PS2 и PS3 обложка диска подбирается по серийному номеру.
              </div>
              <Field
                label="Ключ API SteamGridDB"
                value={s.steamGridDbKey}
                placeholder="Не указан"
                onCommit={(v) => save({ steamGridDbKey: v.trim() })}
                hint="Бесплатно: зарегистрируйтесь на steamgriddb.com, затем Preferences → API → Generate API Key."
                mono
              />
            </>
          )}

          {section === 'emulators' && (
            <>
              <h2 className="panel-title">
                <IconDisc /> PlayStation 2 <span className="panel-sub">PCSX2</span>
              </h2>
              <Field label="Путь к pcsx2-qt.exe" value={s.pcsx2Path} onCommit={(v) => save({ pcsx2Path: v })} mono>
                <BrowseButton onClick={() => browse('pcsx2Path')} />
              </Field>
              <Field
                label="Аргументы запуска"
                value={s.pcsx2Args}
                onCommit={(v) => save({ pcsx2Args: v })}
                hint="{rom} — путь к образу. -batch закрывает PCSX2 вместе с игрой, -fullscreen открывает на весь экран."
                mono
              />
              <Pcsx2Pine />

              <h2 className="panel-title">
                <IconDisc /> PlayStation 3 <span className="panel-sub">RPCS3</span>
              </h2>
              <Field label="Путь к rpcs3.exe" value={s.rpcs3Path} placeholder="Не указан" onCommit={(v) => save({ rpcs3Path: v })} mono>
                <BrowseButton onClick={() => browse('rpcs3Path')} />
              </Field>
              <Field
                label="Аргументы запуска"
                value={s.rpcs3Args}
                onCommit={(v) => save({ rpcs3Args: v })}
                hint="{rom} — путь к EBOOT.BIN. --no-gui запускает игру без окна RPCS3."
                mono
              />
              <Field
                label="Клавиша сохранения состояния"
                value={s.rpcs3SaveKey}
                onCommit={(v) => save({ rpcs3SaveKey: v.trim() })}
                hint="Оверлей нажмёт её в окне RPCS3 (по умолчанию Ctrl+S). Сохранения состояний должны быть включены в RPCS3, загружаются они из его списка игр."
                mono
              />
            </>
          )}

          {section === 'display' && (
            <>
              <h2 className="panel-title">
                <IconMonitor /> Экран
              </h2>
              <DisplayPicker s={s} save={save} />
              <Cycler
                label="Масштаб интерфейса"
                hint="Крупнее — удобнее на телевизоре издалека"
                value={String(s.uiScale)}
                options={[
                  { id: '0.9', label: '90%' },
                  { id: '1', label: '100%' },
                  { id: '1.1', label: '110%' },
                  { id: '1.2', label: '120%' },
                  { id: '1.25', label: '125%' }
                ]}
                onChange={(v) => save({ uiScale: Number(v) })}
              />
              <Toggle label="Полноэкранный режим" hint="Также переключается клавишей F11" value={s.fullscreen} onChange={(v) => save({ fullscreen: v })} />
              <h2 className="panel-title">
                <IconImage /> Оформление
              </h2>
              <Toggle
                label="Цвет интерфейса под игру"
                hint="Акценты, свечение и фокус-рамка принимают цвет обложки выбранной игры"
                value={s.gameTint}
                onChange={(v) => save({ gameTint: v })}
              />
              <Toggle
                label="Живой фон"
                hint="Если задержаться на игре пару секунд, фон оживает: беззвучный трейлер из Steam или анимированный фон из SteamGridDB. Скачивается один раз."
                value={s.liveBackground}
                onChange={(v) => save({ liveBackground: v })}
              />
              <Toggle
                label="Анимированные обложки"
                hint="Обложка в фокусе оживает, если у игры есть анимированная версия (SteamGridDB, GIF, анимированный WebP)"
                value={s.animatedCovers}
                onChange={(v) => save({ animatedCovers: v })}
              />
              <Cycler
                label="Заставка при бездействии"
                hint="Медленное слайд-шоу фонов ваших игр с часами. Бережёт OLED-экраны."
                value={String(s.screensaver)}
                options={[
                  { id: '0', label: 'Выключена' },
                  { id: '2', label: 'Через 2 мин' },
                  { id: '5', label: 'Через 5 мин' },
                  { id: '10', label: 'Через 10 мин' },
                  { id: '20', label: 'Через 20 мин' }
                ]}
                onChange={(v) => save({ screensaver: Number(v) })}
              />
            </>
          )}

          {section === 'sound' && (
            <>
              <h2 className="panel-title">
                <IconVolume /> Звук
              </h2>
              <Toggle label="Звуки интерфейса" hint="Щелчки навигации, запуск игр, трофеи, интро и выключение" value={s.sounds} onChange={(v) => save({ sounds: v })} />
              <Cycler
                label="Громкость звуков"
                value={s.volume}
                options={[
                  { id: 'low', label: 'Тихо' },
                  { id: 'mid', label: 'Средне' },
                  { id: 'high', label: 'Громко' }
                ]}
                onChange={(v) => {
                  save({ volume: v })
                  previewVolume(v)
                }}
              />
              <Toggle
                label="Фоновая музыка"
                hint="Спокойный эмбиент на главном экране, затихает, когда запущена игра"
                value={s.music}
                onChange={(v) => save({ music: v })}
              />
            </>
          )}

          {section === 'gamepad' && (
            <>
              <h2 className="panel-title">
                <IconGamepad /> Управление
              </h2>
              <Cycler
                label="Значки кнопок"
                hint="Авто — по подключённому геймпаду"
                value={s.glyphs}
                options={[
                  { id: 'auto', label: 'Авто' },
                  { id: 'playstation', label: 'PlayStation' },
                  { id: 'xbox', label: 'Xbox' },
                  { id: 'nintendo', label: 'Nintendo и 8BitDo' },
                  { id: 'keyboard', label: 'Клавиатура' }
                ]}
                onChange={(v) => save({ glyphs: v })}
              />
              <PadMapRow s={s} save={save} />
              <h2 className="panel-title">
                <IconGamepad /> Оверлей поверх игры
              </h2>
              <div className="note">
                <strong>Как открыть:</strong> кнопка PS на DualSense или DualShock 4, Guide на Xbox, удержание Select + Start или Ctrl + Alt + H.
                Если кнопку перехватывает Steam или Xbox Game Bar, отключите это в их настройках.
              </div>
              <Cycler
                label="Пауза игры в оверлее"
                hint="Игра замораживается и не реагирует на геймпад, пока открыт оверлей. Для онлайн-игр лучше выключить."
                value={s.pauseOnOverlay}
                options={[
                  { id: 'all', label: 'Все игры' },
                  { id: 'emulators', label: 'Только эмуляторы' },
                  { id: 'off', label: 'Не ставить' }
                ]}
                onChange={(v) => save({ pauseOnOverlay: v })}
              />
              <h2 className="panel-title">
                <IconGamepad /> DualSense и DSX
              </h2>
              <Toggle
                label="Подсветка в цвет игры"
                hint="Световая панель DualSense принимает цвет обложки запущенной игры. Нужен запущенный DSX."
                value={s.dsxLightbar}
                onChange={(v) => save({ dsxLightbar: v })}
              />
              <LightbarTest />
              <Toggle
                label="Предупреждать о разряде"
                hint="При 10% заряда — уведомление поверх игры и красная пульсация световой панели DualSense"
                value={s.lowBatteryWarning}
                onChange={(v) => save({ lowBatteryWarning: v })}
              />
              <Toggle
                label="Вибрация при новом трофее"
                hint="Два коротких импульса. Через DSX работает и на DualSense."
                value={s.trophyRumble}
                onChange={(v) => save({ trophyRumble: v })}
              />
            </>
          )}

          {section === 'trophies' && <TrophySettings s={s} save={save} />}

          {section === 'system' && (
            <>
              <h2 className="panel-title">
                <IconMonitor /> Запуск
              </h2>
              <Toggle
                label="Запускать вместе с Windows"
                hint="Удобно для ТВ-режима и стриминга через Moonlight"
                value={s.launchOnStartup}
                onChange={(v) => save({ launchOnStartup: v })}
              />
              <Cycler
                label="Напоминать о перерыве"
                hint="Уведомление Windows поверх игры"
                value={String(s.breakReminder)}
                options={[
                  { id: '0', label: 'Выключено' },
                  { id: '1', label: 'Каждый час' },
                  { id: '2', label: 'Каждые 2 часа' },
                  { id: '3', label: 'Каждые 3 часа' }
                ]}
                onChange={(v) => save({ breakReminder: Number(v) })}
              />
              <h2 className="panel-title">
                <IconFolder /> Данные и отчёты
              </h2>
              <ActionRow label="Папка с данными" hint={state.dataDir} button="Открыть" icon={<IconFolder />} onClick={() => api.openFolder(state.dataDir)} />
              <ReportRow />
              <h2 className="panel-title">
                <IconDownload /> Перенос на другой компьютер
              </h2>
              <BackupRows />
              <h2 className="panel-title">
                <IconInfo /> О PlayOS
              </h2>
              <SystemInfoRow version={state.version} />
              <UpdateRow version={state.version} />
              <Toggle
                label="Участвовать в бета-тесте"
                hint="Получать ранние версии PlayOS раньше всех. В них больше нового, но возможны ошибки. Если выключить, обновления будут приходить только со стабильными версиями."
                value={s.betaUpdates}
                onChange={(v) => save({ betaUpdates: v })}
              />
            </>
          )}
        </motion.section>
    </div>
  )
}

/** «О системе»: окно со сведениями о PlayOS, компьютере, экранах и геймпадах */
function SystemInfoRow({ version }: { version: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <ActionRow
        label="О системе"
        hint={`PlayOS ${version}, Windows, процессор, видеокарта, экраны и геймпады`}
        button="Подробнее"
        icon={<IconInfo />}
        onClick={() => {
          play('select')
          setOpen(true)
        }}
      />
      <AnimatePresence>{open && <SystemInfoDialog key="sysinfo" onClose={() => setOpen(false)} />}</AnimatePresence>
    </>
  )
}

/** Обновления из релизов GitHub: проверка, фоновое скачивание с процентом и установка */
function UpdateRow({ version }: { version: string }) {
  const [st, setSt] = useState<UpdateState | null>(null)
  useEffect(() => {
    api.updateState().then(setSt)
    return api.onUpdateState(setSt)
  }, [])

  const phase = st?.phase ?? 'idle'
  const firstNote = st?.notes?.split('\n').find((l) => l.trim())
  const hint =
    phase === 'dev'
      ? `Версия ${version} запущена из исходников — обновления приходят только в установленную PlayOS`
      : phase === 'checking'
        ? 'Проверяем новую версию на GitHub…'
        : phase === 'downloading'
          ? `Скачивается PlayOS ${st?.version}: ${st?.percent ?? 0}%`
          : phase === 'ready'
            ? `PlayOS ${st?.version} скачана и установится при выходе${firstNote ? `. Нового: ${firstNote.replace(/^[•\-*]\s*/, '')}` : ''}`
            : phase === 'latest'
              ? `Установлена последняя версия ${version}`
              : phase === 'error'
                ? `${st?.error ?? 'Не удалось проверить обновления'}. Установлена версия ${version}`
                : `Установлена версия ${version}. PlayOS проверяет обновления сам после запуска`

  const act = async () => {
    if (phase === 'ready') {
      play('launch')
      await api.installUpdate()
      return
    }
    if (phase === 'checking' || phase === 'downloading') return
    if (phase === 'dev') {
      toast({ title: 'Обновления', message: 'В версии из исходников обновления не проверяются', tone: 'info' })
      return
    }
    play('select')
    setSt((cur) => (cur ? { ...cur, phase: 'checking' } : cur))
    setSt(await api.checkUpdates())
  }

  const button =
    phase === 'ready' ? 'Перезапустить и обновить' : phase === 'checking' ? 'Проверяем…' : phase === 'downloading' ? `Скачивается ${st?.percent ?? 0}%` : 'Проверить обновления'
  return <ActionRow label="Обновления" hint={hint} button={button} icon={<IconDownload />} onClick={act} />
}

/** Отчёт об ошибках: журнал, сведения о системе и об аварийных завершениях — одним файлом на рабочий стол */
function ReportRow() {
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState('Журнал работы, сведения о системе и об ошибках — одним файлом на рабочий стол. Ключи API в отчёт не попадают.')
  const make = async () => {
    if (busy) return
    setBusy(true)
    try {
      const file = await api.saveReport()
      setHint(`Сохранено: ${file}`)
      toast({ title: 'Отчёт сохранён', message: file, tone: 'success' })
    } catch (e) {
      toast({ title: 'Не удалось сохранить отчёт', message: (e as Error).message, tone: 'error' })
    } finally {
      setBusy(false)
    }
  }
  return <ActionRow label="Сохранить отчёт об ошибках" hint={hint} button={busy ? 'Сохраняем…' : 'Сохранить'} onClick={make} />
}

/**
 * Копия данных одним файлом .playos: библиотека, время и сессии, трофеи, настройки с ключами API, аватар и обложки.
 * На новом компьютере — «Восстановить из копии», PlayOS перезапустится уже со всем этим.
 */
function BackupRows() {
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState('')
  const [pending, setPending] = useState<{ file: string; info: BackupInfo } | null>(null)

  const save = async () => {
    if (busy) return
    setBusy(true)
    try {
      const file = await api.exportData()
      setSaved(file)
      play('select')
      toast({ title: 'Копия сохранена', message: file, tone: 'success' })
    } catch (e) {
      toast({ title: 'Не удалось сохранить копию', message: (e as Error).message, tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const pick = async () => {
    const file = await api.pickFile('backup')
    if (!file) return
    try {
      setPending({ file, info: await api.inspectBackup(file) })
    } catch (e) {
      play('error')
      toast({ title: 'Не получилось открыть копию', message: (e as Error).message, tone: 'error' })
    }
  }

  const restore = async () => {
    if (!pending) return
    const { file } = pending
    setPending(null)
    try {
      play('launch')
      await api.importData(file)
    } catch (e) {
      toast({ title: 'Не удалось восстановить данные', message: (e as Error).message, tone: 'error' })
    }
  }

  const date = (t: number) => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
  return (
    <>
      <ActionRow
        label="Сохранить копию данных"
        hint={
          saved
            ? `Сохранено: ${saved}`
            : 'Библиотека, время в играх, трофеи, настройки и обложки — одним файлом на рабочий стол. В файле есть ключи API, не публикуйте его.'
        }
        button={busy ? 'Сохраняем…' : 'Сохранить'}
        icon={<IconDownload />}
        onClick={save}
      />
      <ActionRow
        label="Восстановить из копии"
        hint="Выберите файл .playos с другого компьютера. Текущие данные PlayOS заменятся, но сначала сохранятся в папку backups."
        button="Выбрать файл"
        icon={<IconFolder />}
        onClick={pick}
      />
      {createPortal(
        <AnimatePresence>
          {pending && (
            <ConfirmDialog
              key="restore"
              title="Восстановить из копии?"
              text={`Копия от ${date(pending.info.createdAt)}, PlayOS ${pending.info.version}, ${gamesCount(pending.info.games)}. Текущие данные заменятся, и PlayOS перезапустится.`}
              button="Восстановить"
              onCancel={() => setPending(null)}
              onConfirm={restore}
            />
          )}
        </AnimatePresence>,
        document.querySelector('.app') ?? document.body
      )}
    </>
  )
}

/** Геймпады DirectInput (без стандартной раскладки): назначить кнопки вручную или сбросить */
function PadMapRow({ s, save }: { s: SettingsT; save: (p: Partial<SettingsT>) => Promise<unknown> }) {
  const [open, setOpen] = useState(false)
  const maps = s.padMaps ?? {}
  const names = Object.keys(maps).map(padName)
  return (
    <>
      <ActionRow
        label="Настроить кнопки геймпада"
        hint={
          names.length
            ? `Настроено вручную: ${names.join(', ')}`
            : 'Для геймпадов в режиме DirectInput и старых USB-геймпадов, у которых кнопки перепутаны. Xbox, DualSense и 8BitDo в режиме XInput настраивать не нужно.'
        }
        button="Настроить"
        icon={<IconGamepad />}
        onClick={() => {
          play('select')
          setOpen(true)
        }}
      />
      {names.length > 0 && (
        <ActionRow
          label="Сбросить раскладку"
          hint="Вернуть стандартные кнопки для всех настроенных геймпадов"
          button="Сбросить"
          onClick={() => {
            play('back')
            void save({ padMaps: {} })
            toast({ title: 'Раскладка сброшена', tone: 'info' })
          }}
        />
      )}
      <AnimatePresence>
        {open && (
          <PadMapper
            key="pm"
            maps={maps}
            onSave={(m) => void save({ padMaps: m })}
            onClose={() => {
              play('back')
              setOpen(false)
            }}
          />
        )}
      </AnimatePresence>
    </>
  )
}

/** Экран для PlayOS: окно сразу переезжает, выбор запоминается и для следующих запусков */
export function DisplayPicker({ s, save }: { s: SettingsT; save: (p: Partial<SettingsT>) => Promise<unknown> }) {
  const [list, setList] = useState<DisplayInfo[]>([])
  useEffect(() => {
    api.displays().then((d) => setList(d.list))
  }, [])
  if (list.length < 2 && !s.displayId) return null
  const label = (d: DisplayInfo) => `${d.name}, ${d.width}×${d.height}`
  const options = [
    { id: '0', label: 'Основной экран' },
    ...list.map((d) => ({ id: String(d.id), label: d.primary ? `${label(d)} (основной)` : label(d) }))
  ]
  // Выбранный экран сейчас отключён — всё равно показываем его, чтобы выбор не «прыгал»
  if (s.displayId && !list.some((d) => d.id === s.displayId)) options.push({ id: String(s.displayId), label: `${s.displayLabel || 'Экран'} (не подключён)` })
  return (
    <Cycler
      label="Экран для PlayOS"
      hint="Где открывается PlayOS. Если выбранный экран выключен, PlayOS откроется на основном и сам переедет, когда его включат."
      value={String(s.displayId || 0)}
      options={options}
      onChange={(v) => {
        const d = list.find((x) => String(x.id) === v)
        save({ displayId: Number(v), displayLabel: d?.name ?? '' })
      }}
    />
  )
}

/** Проверка подсветки: DSX переливает панель красным, зелёным, синим и белым */
function LightbarTest() {
  const [result, setResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const test = async () => {
    if (busy) return
    setBusy(true)
    const r = await api.testLightbar()
    setBusy(false)
    setResult(
      r === 'ok'
        ? 'Команды отправлены: панель должна была мигнуть красным, зелёным, синим и белым. Если цвет не менялся, проверьте в DSX, что включён UDP (Настройки → Система модов).'
        : r === 'no-pad'
          ? 'DSX запущен, но не видит геймпад. Подключите DualSense и попробуйте ещё раз.'
          : 'DSX не отвечает на 127.0.0.1:6969. Запустите DSX и включите в нём UDP-сервер.'
    )
  }
  return (
    <ActionRow
      label="Проверить подсветку"
      hint={result ?? 'Покажет, доходят ли команды до DualSense через DSX'}
      button={busy ? 'Проверяем…' : 'Проверить'}
      onClick={test}
    />
  )
}

/** Статус PINE в PCSX2 и кнопка его включения */
function Pcsx2Pine() {
  const [info, setInfo] = useState<Pcsx2Info | null>(null)
  useEffect(() => {
    api.pcsx2Info().then(setInfo)
  }, [])
  const enable = async () => {
    const r = await api.enablePine()
    toast({ title: r.ok ? 'PINE включён' : 'Не получилось', message: r.message, tone: r.ok ? 'success' : 'error' })
    if (r.ok) setInfo(await api.pcsx2Info())
  }
  if (!info) return null
  const keys = info.saveKey ? `Горячие клавиши PCSX2: сохранить ${info.saveKey}, загрузить ${info.loadKey}.` : ''
  if (!info.found) {
    return <div className="note">Папка данных PCSX2 не найдена. Запустите PCSX2 хотя бы раз, чтобы заработали быстрые сохранения.</div>
  }
  if (info.pine === 'enabled') {
    return (
      <div className="note">
        <strong>Быстрые сохранения через PINE включены:</strong> оверлей сохраняет и загружает нужный слот, не переключая окна, и ставит игру на паузу. {keys}
      </div>
    )
  }
  return (
    <ActionRow
      label="Быстрые сохранения через PINE"
      hint={`Сейчас оверлей переключается в игру и нажимает горячие клавиши. С PINE — точные слоты и пауза игры. ${keys} PCSX2 должен быть закрыт.`}
      button="Включить PINE"
      onClick={enable}
    />
  )
}

/** Аккаунты для настоящих трофеев: RetroAchievements (PS2) и Steam (PC) */
function TrophySettings({ s, save }: { s: SettingsT; save: (p: Partial<SettingsT>) => Promise<unknown> }) {
  const [test, setTest] = useState<{ ra: string; steam: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const check = async () => {
    setTesting(true)
    setTest(await api.testTrophyAccounts())
    setTesting(false)
  }
  return (
    <>
      <h2 className="panel-title">
        <IconTrophy /> RetroAchievements <span className="panel-sub">PS2</span>
      </h2>
      <div className="note">
        Те же трофеи, что выдаёт PCSX2 после входа в RetroAchievements. Ключ: retroachievements.org → Settings → Keys → Web API Key. Игра
        определяется по образу диска; если образ модифицирован — её можно выбрать вручную в списке трофеев.
      </div>
      <Field label="Логин RetroAchievements" value={s.raUser} placeholder="Не указан" onCommit={(v) => save({ raUser: v.trim() })} />
      <Field label="Web API Key" value={s.raKey} placeholder="Не указан" onCommit={(v) => save({ raKey: v.trim() })} mono />

      <h2 className="panel-title">
        <IconTrophy /> Steam <span className="panel-sub">PC</span>
      </h2>
      <div className="note">
        Ключ: steamcommunity.com/dev/apikey (бесплатно, домен можно указать любой). В настройках приватности Steam откройте «Сведения об играх».
        Steam AppID игры подхватывается сам по файлам игры или при выборе арта из Steam.
      </div>
      <Field label="Ключ Steam Web API" value={s.steamKey} placeholder="Не указан" onCommit={(v) => save({ steamKey: v.trim() })} mono />
      <Field
        label="Профиль Steam"
        value={s.steamId}
        placeholder="SteamID64, имя профиля или ссылка"
        onCommit={(v) => save({ steamId: v.trim() })}
        mono
      />

      <h2 className="panel-title">Во время игры</h2>
      <Toggle
        label="Показывать новые трофеи поверх игры"
        hint="PlayOS проверяет трофеи раз в минуту и показывает уведомление в углу экрана"
        value={s.trophyPopups}
        onChange={(v) => save({ trophyPopups: v })}
      />
      <ActionRow
        label="Проверить подключение"
        hint={test ? `RetroAchievements: ${test.ra}. Steam: ${test.steam}.` : 'Проверим ключи и профили'}
        button={testing ? 'Проверяем…' : 'Проверить'}
        onClick={check}
      />
    </>
  )
}
