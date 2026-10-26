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
import { CloudPanel } from './Cloud'
import { PadMapper, padName } from './PadMapper'
import { ConfirmDialog } from './Menus'
import { gamesCount } from '../lib/format'
import { THEMES, themeName } from '../lib/theme'
import { IconDisc, IconDownload, IconFolder, IconGamepad, IconImage, IconInfo, IconMonitor, IconTrophy, IconVolume } from './Icons'
import { getLang, locale, t } from '@shared/i18n'

type Section = 'profile' | 'cloud' | 'library' | 'emulators' | 'display' | 'sound' | 'gamepad' | 'trophies' | 'system'
const SECTIONS: { id: Section; label: string; hint: string }[] = [
  { id: 'profile', label: t('Профиль'), hint: t('Имя и аватар') },
  { id: 'cloud', label: t('Облако'), hint: t('Сохранения игр') },
  { id: 'library', label: t('Библиотека'), hint: t('Импорт игр и обложки') },
  { id: 'emulators', label: t('Эмуляторы'), hint: t('PCSX2 и RPCS3') },
  { id: 'display', label: t('Экран'), hint: t('Монитор, масштаб, оформление') },
  { id: 'sound', label: t('Звук'), hint: t('Звуки и музыка') },
  { id: 'gamepad', label: t('Геймпад'), hint: t('Кнопки, оверлей, DualSense') },
  { id: 'trophies', label: t('Трофеи'), hint: t('RetroAchievements и Steam') },
  { id: 'system', label: t('Система'), hint: t('Запуск, данные, отчёты') }
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
    toast({ title: t('Аватар обновлён'), image: p, tone: 'success' })
  }

  const run = async (fn: () => Promise<number>, what: string) => {
    try {
      const n = await fn()
      toast({ title: what, message: n ? t('Добавлено игр: {n}', { n }) : t('Новых игр не найдено'), tone: n ? 'success' : 'info' })
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
              <h2 className="panel-title">{t('Профиль')}</h2>
              <LanguageRow s={s} save={save} />
              <div className="setting setting-static avatar-setting">
                <Avatar name={s.userName} src={s.avatar} className="avatar-lg" />
                <span className="setting-text">
                  <span className="setting-label">{t('Аватар')}</span>
                  <span className="setting-hint">{t('PNG, JPG, WEBP или GIF. Картинка обрежется по кругу.')}</span>
                </span>
                <span className="avatar-buttons">
                  <button data-nav className="btn btn-glass btn-sm" onClick={pickAvatar}>
                    <IconImage /> {t('Выбрать картинку')}
                  </button>
                  {s.avatar && (
                    <button data-nav className="btn btn-glass btn-sm" onClick={() => save({ avatar: undefined })}>
                      {t('Убрать')}
                    </button>
                  )}
                </span>
              </div>
              <Field label={t('Имя пользователя')} value={s.userName} onCommit={(v) => save({ userName: v.trim() || t('Игрок') })} />
            </>
          )}

          {section === 'cloud' && <CloudPanel s={s} save={save} />}

          {section === 'library' && (
            <>
              <h2 className="panel-title">
                <IconDownload /> {t('Добавить игры')}
              </h2>
              <ActionRow
                label={t('Импорт игр из Steam')}
                hint={t('Найдёт установленные игры во всех библиотеках Steam. Они будут запускаться через Steam, а обложки, фоны и логотипы подтянутся из магазина.')}
                button={t('Выбрать игры')}
                icon={<IconDownload />}
                onClick={onSteamImport}
              />
              <ActionRow
                label={t('Сканировать папку с образами PS2')}
                hint={t('ISO, CHD, CSO и другие образы: названия и обложки подберутся по серийному номеру диска')}
                button={t('Выбрать папку')}
                icon={<IconFolder />}
                onClick={() => run(api.scanPs2Folder, t('Сканирование PS2'))}
              />
              <ActionRow
                label={t('Импорт игр из RPCS3')}
                hint={t('Игры из списка RPCS3 и папки dev_hdd0 с названиями и артом из PARAM.SFO')}
                button={t('Импортировать')}
                onClick={() => run(api.importRpcs3, t('Импорт RPCS3'))}
              />
              <h2 className="panel-title">
                <IconImage /> {t('Обложки и фоны')}
              </h2>
              <div className="note">
                {t('Арт ищется в трёх местах: Steam (обложка, фон и логотип), SteamGridDB (огромная база, в том числе для игр PS2 и PS3 без PC-версии) и Википедия. Для PS2 и PS3 обложка диска подбирается по серийному номеру.')}
              </div>
              <Field
                label={t('Ключ API SteamGridDB')}
                value={s.steamGridDbKey}
                placeholder={t('Не указан')}
                onCommit={(v) => save({ steamGridDbKey: v.trim() })}
                hint={t('Бесплатно: зарегистрируйтесь на steamgriddb.com, затем Preferences → API → Generate API Key.')}
                mono
              />
            </>
          )}

          {section === 'emulators' && (
            <>
              <h2 className="panel-title">
                <IconDisc /> PlayStation 2 <span className="panel-sub">PCSX2</span>
              </h2>
              <Field label={t('Путь к pcsx2-qt.exe')} value={s.pcsx2Path} onCommit={(v) => save({ pcsx2Path: v })} mono>
                <BrowseButton onClick={() => browse('pcsx2Path')} />
              </Field>
              <Field
                label={t('Аргументы запуска')}
                value={s.pcsx2Args}
                onCommit={(v) => save({ pcsx2Args: v })}
                hint={t('{rom} — путь к образу. -batch закрывает PCSX2 вместе с игрой, -fullscreen открывает на весь экран.')}
                mono
              />
              <Pcsx2Pine />

              <h2 className="panel-title">
                <IconDisc /> PlayStation 3 <span className="panel-sub">RPCS3</span>
              </h2>
              <Field label={t('Путь к rpcs3.exe')} value={s.rpcs3Path} placeholder={t('Не указан')} onCommit={(v) => save({ rpcs3Path: v })} mono>
                <BrowseButton onClick={() => browse('rpcs3Path')} />
              </Field>
              <Field
                label={t('Аргументы запуска')}
                value={s.rpcs3Args}
                onCommit={(v) => save({ rpcs3Args: v })}
                hint={t('{rom} — путь к EBOOT.BIN. --no-gui запускает игру без окна RPCS3.')}
                mono
              />
              <Field
                label={t('Клавиша сохранения состояния')}
                value={s.rpcs3SaveKey}
                onCommit={(v) => save({ rpcs3SaveKey: v.trim() })}
                hint={t('Оверлей нажмёт её в окне RPCS3 (по умолчанию Ctrl+S). Сохранения состояний должны быть включены в RPCS3, загружаются они из его списка игр.')}
                mono
              />

              <h2 className="panel-title">
                <IconMonitor /> {t('Экран для игр')}
              </h2>
              <GameDisplayPicker s={s} save={save} />
            </>
          )}

          {section === 'display' && (
            <>
              <h2 className="panel-title">
                <IconMonitor /> {t('Экран')}
              </h2>
              <DisplayPicker s={s} save={save} />
              <Cycler
                label={t('Масштаб интерфейса')}
                hint={t('Крупнее — удобнее на телевизоре издалека')}
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
              <Toggle label={t('Полноэкранный режим')} hint={t('Также переключается клавишей F11')} value={s.fullscreen} onChange={(v) => save({ fullscreen: v })} />
              <h2 className="panel-title">
                <IconImage /> {t('Оформление')}
              </h2>
              <Cycler
                label={t('Тема')}
                hint={t('Тёмная, светлая или как в Windows. Быстро переключить — в меню питания.')}
                value={s.theme ?? 'dark'}
                options={THEMES.map((id) => ({ id, label: themeName(id) }))}
                onChange={(v) => save({ theme: v })}
              />
              <Toggle
                label={t('Цвет интерфейса под игру')}
                hint={t('Акценты, свечение и фокус-рамка принимают цвет обложки выбранной игры')}
                value={s.gameTint}
                onChange={(v) => save({ gameTint: v })}
              />
              <Toggle
                label={t('Живой фон')}
                hint={t('Если задержаться на игре пару секунд, фон оживает: беззвучный трейлер из Steam или анимированный фон из SteamGridDB. Скачивается один раз.')}
                value={s.liveBackground}
                onChange={(v) => save({ liveBackground: v })}
              />
              <Toggle
                label={t('Анимированные обложки')}
                hint={t('Обложка в фокусе оживает, если у игры есть анимированная версия (SteamGridDB, GIF, анимированный WebP)')}
                value={s.animatedCovers}
                onChange={(v) => save({ animatedCovers: v })}
              />
              <Cycler
                label={t('Заставка при бездействии')}
                hint={t('Медленное слайд-шоу фонов ваших игр с часами. Бережёт OLED-экраны.')}
                value={String(s.screensaver)}
                options={[
                  { id: '0', label: t('Выключена') },
                  { id: '2', label: t('Через 2 мин') },
                  { id: '5', label: t('Через 5 мин') },
                  { id: '10', label: t('Через 10 мин') },
                  { id: '20', label: t('Через 20 мин') }
                ]}
                onChange={(v) => save({ screensaver: Number(v) })}
              />
            </>
          )}

          {section === 'sound' && (
            <>
              <h2 className="panel-title">
                <IconVolume /> {t('Звук')}
              </h2>
              <Toggle label={t('Звуки интерфейса')} hint={t('Щелчки навигации, запуск игр, трофеи, интро и выключение')} value={s.sounds} onChange={(v) => save({ sounds: v })} />
              <Cycler
                label={t('Громкость звуков')}
                value={s.volume}
                options={[
                  { id: 'low', label: t('Тихо') },
                  { id: 'mid', label: t('Средне') },
                  { id: 'high', label: t('Громко') }
                ]}
                onChange={(v) => {
                  save({ volume: v })
                  previewVolume(v)
                }}
              />
              <Toggle
                label={t('Фоновая музыка')}
                hint={t('Спокойный эмбиент на главном экране, затихает, когда запущена игра')}
                value={s.music}
                onChange={(v) => save({ music: v })}
              />
            </>
          )}

          {section === 'gamepad' && (
            <>
              <h2 className="panel-title">
                <IconGamepad /> {t('Управление')}
              </h2>
              <Cycler
                label={t('Значки кнопок')}
                hint={t('Авто — по подключённому геймпаду')}
                value={s.glyphs}
                options={[
                  { id: 'auto', label: t('Авто') },
                  { id: 'playstation', label: 'PlayStation' },
                  { id: 'xbox', label: 'Xbox' },
                  { id: 'nintendo', label: t('Nintendo и 8BitDo') },
                  { id: 'keyboard', label: t('Клавиатура') }
                ]}
                onChange={(v) => save({ glyphs: v })}
              />
              <PadMapRow s={s} save={save} />
              <h2 className="panel-title">
                <IconGamepad /> {t('Оверлей поверх игры')}
              </h2>
              <div className="note">
                <strong>{t('Как открыть:')}</strong> {t('кнопка PS на DualSense или DualShock 4, Guide на Xbox, удержание Select + Start или Ctrl + Alt + H.')}
                {t('Если кнопку перехватывает Steam или Xbox Game Bar, отключите это в их настройках.')}
              </div>
              <Toggle
                label={t('Оверлей в играх')}
                hint={t('Выключено — кнопка PS/Guide остаётся игре, уведомления о трофеях поверх игры не показываются. Оверлей можно выключить и для одной игры в её настройках.')}
                value={s.overlayEnabled !== false}
                onChange={(v) => save({ overlayEnabled: v })}
              />
              <Cycler
                label={t('Пауза игры в оверлее')}
                hint={t('Игра замораживается и не реагирует на геймпад, пока открыт оверлей. Для онлайн-игр лучше выключить.')}
                value={s.pauseOnOverlay}
                options={[
                  { id: 'all', label: t('Все игры') },
                  { id: 'emulators', label: t('Только эмуляторы') },
                  { id: 'off', label: t('Не ставить') }
                ]}
                onChange={(v) => save({ pauseOnOverlay: v })}
              />
              <h2 className="panel-title">
                <IconGamepad /> {t('DualSense и DSX')}
              </h2>
              <Toggle
                label={t('Подсветка в цвет игры')}
                hint={t('Световая панель DualSense принимает цвет обложки запущенной игры. Нужен запущенный DSX.')}
                value={s.dsxLightbar}
                onChange={(v) => save({ dsxLightbar: v })}
              />
              <LightbarTest />
              <Toggle
                label={t('Предупреждать о разряде')}
                hint={t('При 10% заряда — уведомление поверх игры и красная пульсация световой панели DualSense')}
                value={s.lowBatteryWarning}
                onChange={(v) => save({ lowBatteryWarning: v })}
              />
              <Toggle
                label={t('Вибрация при новом трофее')}
                hint={t('Два коротких импульса. Через DSX работает и на DualSense.')}
                value={s.trophyRumble}
                onChange={(v) => save({ trophyRumble: v })}
              />
            </>
          )}

          {section === 'trophies' && <TrophySettings s={s} save={save} />}

          {section === 'system' && (
            <>
              <h2 className="panel-title">
                <IconMonitor /> {t('Запуск')}
              </h2>
              <Toggle
                label={t('Запускать вместе с Windows')}
                hint={t('Удобно для ТВ-режима и стриминга через Moonlight')}
                value={s.launchOnStartup}
                onChange={(v) => save({ launchOnStartup: v })}
              />
              <Cycler
                label={t('Напоминать о перерыве')}
                hint={t('Уведомление Windows поверх игры')}
                value={String(s.breakReminder)}
                options={[
                  { id: '0', label: t('Выключено') },
                  { id: '1', label: t('Каждый час') },
                  { id: '2', label: t('Каждые 2 часа') },
                  { id: '3', label: t('Каждые 3 часа') }
                ]}
                onChange={(v) => save({ breakReminder: Number(v) })}
              />
              <h2 className="panel-title">
                <IconGamepad /> {t('Во время игры')}
              </h2>
              <Toggle
                label={t('Освобождать память')}
                hint={t('Пока идёт игра, интерфейс PlayOS выгружается — работает только оверлей, а процессор и память достаются игре. Возвращение в PlayOS займёт пару секунд.')}
                value={s.freeMemoryInGame !== false}
                onChange={(v) => save({ freeMemoryInGame: v })}
              />
              <h2 className="panel-title">
                <IconFolder /> {t('Данные и отчёты')}
              </h2>
              <ActionRow label={t('Папка с данными')} hint={state.dataDir} button={t('Открыть')} icon={<IconFolder />} onClick={() => api.openFolder(state.dataDir)} />
              <ReportRow />
              <h2 className="panel-title">
                <IconDownload /> {t('Перенос на другой компьютер')}
              </h2>
              <BackupRows />
              <h2 className="panel-title">
                <IconInfo /> {t('О PlayOS')}
              </h2>
              <SystemInfoRow version={state.version} />
              <UpdateRow version={state.version} />
              <Toggle
                label={t('Участвовать в бета-тесте')}
                hint={t('Получать ранние версии PlayOS раньше всех. В них больше нового, но возможны ошибки. Если выключить, обновления будут приходить только со стабильными версиями.')}
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
        label={t('О системе')}
        hint={t('PlayOS {version}, Windows, процессор, видеокарта, экраны и геймпады', { version })}
        button={t('Подробнее')}
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
      ? t('Версия {version} запущена из исходников — обновления приходят только в установленную PlayOS', { version })
      : phase === 'checking'
        ? t('Проверяем новую версию на GitHub…')
        : phase === 'downloading'
          ? t('Скачивается PlayOS {version}: {v}%', { version: st?.version, v: st?.percent ?? 0 })
          : phase === 'ready'
            ? t('PlayOS {v} скачана и установится при выходе', { v: st?.version }) + (firstNote ? `. ${t('Нового: {note}', { note: firstNote.replace(/^[•\-*]\s*/, '') })}` : '')
            : phase === 'latest'
              ? t('Установлена последняя версия {version}', { version })
              : phase === 'error'
                ? `${st?.error ?? t('Не удалось проверить обновления')}. ${t('Установлена версия {v}', { v: version })}`
                : t('Установлена версия {version}. PlayOS проверяет обновления сам после запуска', { version })

  const act = async () => {
    if (phase === 'ready') {
      play('launch')
      await api.installUpdate()
      return
    }
    if (phase === 'checking' || phase === 'downloading') return
    if (phase === 'dev') {
      toast({ title: t('Обновления'), message: t('В версии из исходников обновления не проверяются'), tone: 'info' })
      return
    }
    play('select')
    setSt((cur) => (cur ? { ...cur, phase: 'checking' } : cur))
    setSt(await api.checkUpdates())
  }

  const button =
    phase === 'ready' ? t('Перезапустить и обновить') : phase === 'checking' ? t('Проверяем…') : phase === 'downloading' ? t('Скачивается {v}%', { v: st?.percent ?? 0 }) : t('Проверить обновления')
  return <ActionRow label={t('Обновления')} hint={hint} button={button} icon={<IconDownload />} onClick={act} />
}

/** Отчёт об ошибках: журнал, сведения о системе и об аварийных завершениях — одним файлом на рабочий стол */
function ReportRow() {
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState(t('Журнал работы, сведения о системе и об ошибках — одним файлом на рабочий стол. Ключи API в отчёт не попадают.'))
  const make = async () => {
    if (busy) return
    setBusy(true)
    try {
      const file = await api.saveReport()
      setHint(t('Сохранено: {file}', { file }))
      toast({ title: t('Отчёт сохранён'), message: file, tone: 'success' })
    } catch (e) {
      toast({ title: t('Не удалось сохранить отчёт'), message: (e as Error).message, tone: 'error' })
    } finally {
      setBusy(false)
    }
  }
  return <ActionRow label={t('Сохранить отчёт об ошибках')} hint={hint} button={busy ? t('Сохраняем…') : t('Сохранить')} onClick={make} />
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
      toast({ title: t('Копия сохранена'), message: file, tone: 'success' })
    } catch (e) {
      toast({ title: t('Не удалось сохранить копию'), message: (e as Error).message, tone: 'error' })
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
      toast({ title: t('Не получилось открыть копию'), message: (e as Error).message, tone: 'error' })
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
      toast({ title: t('Не удалось восстановить данные'), message: (e as Error).message, tone: 'error' })
    }
  }

  const date = (ts: number) => new Date(ts).toLocaleString(locale(), { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
  return (
    <>
      <ActionRow
        label={t('Сохранить копию данных')}
        hint={
          saved
            ? t('Сохранено: {saved}', { saved })
            : t('Библиотека, время в играх, трофеи, настройки и обложки — одним файлом на рабочий стол. В файле есть ключи API, не публикуйте его.')
        }
        button={busy ? t('Сохраняем…') : t('Сохранить')}
        icon={<IconDownload />}
        onClick={save}
      />
      <ActionRow
        label={t('Восстановить из копии')}
        hint={t('Выберите файл .playos с другого компьютера. Текущие данные PlayOS заменятся, но сначала сохранятся в папку backups.')}
        button={t('Выбрать файл')}
        icon={<IconFolder />}
        onClick={pick}
      />
      {createPortal(
        <AnimatePresence>
          {pending && (
            <ConfirmDialog
              key="restore"
              title={t('Восстановить из копии?')}
              text={t('Копия от {v}, PlayOS {version}, {v2}. Текущие данные заменятся, и PlayOS перезапустится.', { v: date(pending.info.createdAt), version: pending.info.version, v2: gamesCount(pending.info.games) })}
              button={t('Восстановить')}
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

/** Язык интерфейса. Подпись на двух языках — чтобы найти пункт, даже если язык выбран не тот */
function LanguageRow({ s, save }: { s: SettingsT; save: (p: Partial<SettingsT>) => Promise<unknown> }) {
  return (
    <Cycler
      label={t('Язык · Language')}
      hint={t('Язык интерфейса PlayOS. Окно перезагрузится, библиотека и настройки останутся на месте.')}
      value={s.language ?? getLang()}
      options={[
        { id: 'ru', label: t('Русский') },
        { id: 'en', label: 'English' }
      ]}
      onChange={(v) => {
        try {
          sessionStorage.setItem('playos-skip-intro', '1')
          sessionStorage.setItem('playos-open-settings', '1')
        } catch {
          /* без хранилища просто покажем интро ещё раз */
        }
        void save({ language: v }).then(() => {
          // В браузерном превью окно перезагружаем сами, в PlayOS это делает main-процесс
          if (!('pcsLang' in window)) location.search = `?lang=${v}`
        })
      }}
    />
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
        label={t('Настроить кнопки геймпада')}
        hint={
          names.length
            ? t('Настроено вручную: {v}', { v: names.join(', ') })
            : t('Для геймпадов в режиме DirectInput и старых USB-геймпадов, у которых кнопки перепутаны. Xbox, DualSense и 8BitDo в режиме XInput настраивать не нужно.')
        }
        button={t('Настроить')}
        icon={<IconGamepad />}
        onClick={() => {
          play('select')
          setOpen(true)
        }}
      />
      {names.length > 0 && (
        <ActionRow
          label={t('Сбросить раскладку')}
          hint={t('Вернуть стандартные кнопки для всех настроенных геймпадов')}
          button={t('Сбросить')}
          onClick={() => {
            play('back')
            void save({ padMaps: {} })
            toast({ title: t('Раскладка сброшена'), tone: 'info' })
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
    { id: '0', label: t('Основной экран') },
    ...list.map((d) => ({ id: String(d.id), label: d.primary ? t('{v} (основной)', { v: label(d) }) : label(d) }))
  ]
  // Выбранный экран сейчас отключён — всё равно показываем его, чтобы выбор не «прыгал»
  if (s.displayId && !list.some((d) => d.id === s.displayId)) options.push({ id: String(s.displayId), label: `${s.displayLabel || t('Экран')} ${t('(не подключён)')}` })
  return (
    <Cycler
      label={t('Экран для PlayOS')}
      hint={t('Где открывается PlayOS. Если выбранный экран выключен, PlayOS откроется на основном и сам переедет, когда его включат.')}
      value={String(s.displayId || 0)}
      options={options}
      onChange={(v) => {
        const d = list.find((x) => String(x.id) === v)
        save({ displayId: Number(v), displayLabel: d?.name ?? '' })
      }}
    />
  )
}

/** Экран для игр PCSX2 и RPCS3: PlayOS переносит окно эмулятора после запуска */
function GameDisplayPicker({ s, save }: { s: SettingsT; save: (p: Partial<SettingsT>) => Promise<unknown> }) {
  const [list, setList] = useState<DisplayInfo[]>([])
  useEffect(() => {
    api.displays().then((d) => setList(d.list))
  }, [])
  const label = (d: DisplayInfo) => `${d.name}, ${d.width}×${d.height}`
  const options = [
    { id: '0', label: t('Где откроет эмулятор') },
    { id: '-1', label: t('Там же, где PlayOS') },
    ...list.map((d) => ({ id: String(d.id), label: d.primary ? t('{v} (основной)', { v: label(d) }) : label(d) }))
  ]
  const id = s.gameDisplay ?? 0
  if (id > 0 && !list.some((d) => d.id === id)) options.push({ id: String(id), label: `${s.gameDisplayLabel || t('Экран')} ${t('(не подключён)')}` })
  return (
    <Cycler
      label={t('Монитор для игр эмуляторов')}
      hint={t('PCSX2 и RPCS3 не умеют выбирать монитор параметром запуска, поэтому PlayOS сам переносит окно игры на выбранный экран — и в полноэкранном режиме тоже. Игры для PC запускаются как обычно.')}
      value={String(id)}
      options={options}
      onChange={(v) => {
        const d = list.find((x) => String(x.id) === v)
        save({ gameDisplay: Number(v), gameDisplayLabel: d?.name ?? '' })
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
        ? t('Команды отправлены: панель должна была мигнуть красным, зелёным, синим и белым. Если цвет не менялся, проверьте в DSX, что включён UDP (Настройки → Система модов).')
        : r === 'no-pad'
          ? t('DSX запущен, но не видит геймпад. Подключите DualSense и попробуйте ещё раз.')
          : t('DSX не отвечает на 127.0.0.1:6969. Запустите DSX и включите в нём UDP-сервер.')
    )
  }
  return (
    <ActionRow
      label={t('Проверить подсветку')}
      hint={result ?? t('Покажет, доходят ли команды до DualSense через DSX')}
      button={busy ? t('Проверяем…') : t('Проверить')}
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
    toast({ title: r.ok ? t('PINE включён') : t('Не получилось'), message: r.message, tone: r.ok ? 'success' : 'error' })
    if (r.ok) setInfo(await api.pcsx2Info())
  }
  if (!info) return null
  const keys = info.saveKey ? t('Горячие клавиши PCSX2: сохранить {saveKey}, загрузить {loadKey}.', { saveKey: info.saveKey, loadKey: info.loadKey }) : ''
  if (!info.found) {
    return <div className="note">{t('Папка данных PCSX2 не найдена. Запустите PCSX2 хотя бы раз, чтобы заработали быстрые сохранения.')}</div>
  }
  if (info.pine === 'enabled') {
    return (
      <div className="note">
        <strong>{t('Быстрые сохранения через PINE включены:')}</strong> {t('оверлей сохраняет и загружает нужный слот, не переключая окна, и ставит игру на паузу.')} {keys}
      </div>
    )
  }
  return (
    <ActionRow
      label={t('Быстрые сохранения через PINE')}
      hint={t('Сейчас оверлей переключается в игру и нажимает горячие клавиши. С PINE — точные слоты и пауза игры. {keys} PCSX2 должен быть закрыт.', { keys })}
      button={t('Включить PINE')}
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
        {t('Те же трофеи, что выдаёт PCSX2 после входа в RetroAchievements. Ключ: retroachievements.org → Settings → Keys → Web API Key. Игра определяется по образу диска; если образ модифицирован — её можно выбрать вручную в списке трофеев.')}
      </div>
      <Field label={t('Логин RetroAchievements')} value={s.raUser} placeholder={t('Не указан')} onCommit={(v) => save({ raUser: v.trim() })} />
      <Field label="Web API Key" value={s.raKey} placeholder={t('Не указан')} onCommit={(v) => save({ raKey: v.trim() })} mono />

      <h2 className="panel-title">
        <IconTrophy /> Steam <span className="panel-sub">PC</span>
      </h2>
      <div className="note">
        {t('Ключ: steamcommunity.com/dev/apikey (бесплатно, домен можно указать любой). В настройках приватности Steam откройте «Сведения об играх».')}
        {t('Steam AppID игры подхватывается сам по файлам игры или при выборе арта из Steam.')}
      </div>
      <Field label={t('Ключ Steam Web API')} value={s.steamKey} placeholder={t('Не указан')} onCommit={(v) => save({ steamKey: v.trim() })} mono />
      <Field
        label={t('Профиль Steam')}
        value={s.steamId}
        placeholder={t('SteamID64, имя профиля или ссылка')}
        onCommit={(v) => save({ steamId: v.trim() })}
        mono
      />

      <h2 className="panel-title">{t('Во время игры')}</h2>
      <Toggle
        label={t('Показывать новые трофеи поверх игры')}
        hint={t('Steam и файлы эмуляторов Steam — сразу после получения, RetroAchievements — раз в минуту')}
        value={s.trophyPopups}
        onChange={(v) => save({ trophyPopups: v })}
      />
      <Toggle
        label={t('Снимок момента получения')}
        hint={t('Кадр игры сохраняется рядом с трофеем — его видно в списке трофеев')}
        value={s.trophyShots}
        onChange={(v) => save({ trophyShots: v })}
      />
      <ActionRow
        label={t('Проверить подключение')}
        hint={test ? `RetroAchievements: ${test.ra}. Steam: ${test.steam}.` : t('Проверим ключи и профили')}
        button={testing ? t('Проверяем…') : t('Проверить')}
        onClick={check}
      />
    </>
  )
}
