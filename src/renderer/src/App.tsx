import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ComponentType } from 'react'
import type { AchievementSummaryItem, Game, LaunchFix, PowerAction, SaveConflict, StoreItem, WindowMode } from '@shared/types'
import { Background } from './components/Background'
import { RestoreDialog, SaveConflictDialog, useCloudStatus } from './components/Cloud'
import { GamePage } from './components/GamePage'
import { GlyphStyleContext, Hint, HoldHint } from './components/Glyph'
import { Home, SPECIAL, type HomeFocus } from './components/Home'
import { Library, type LibraryHintState } from './components/Library'
import { ConfirmDialog, GameMenu, PowerMenu } from './components/Menus'
import { OnScreenKeyboard } from './components/OnScreenKeyboard'
import { padName } from './components/PadMapper'
import { LaunchScreen, NoticeCenter, Toasts } from './components/Overlays'
import { Screensaver } from './components/Screensaver'
import type { StoreFocus } from './components/Store'
import { AnimatedCoversContext } from './components/Tile'
import { UpdateInstall } from './components/UpdateInstall'
import { UpdateNotice } from './components/UpdateNotice'
import { Tivi } from './components/Tivi'
import { TABS, TopBar, type Tab } from './components/TopBar'
import { WindowFrame } from './components/WindowFrame'
import { api } from './lib/api'
import { accentOf, DEFAULT_ACCENT, notInstalled } from './lib/format'
import { useDownloadNotices, useDownloads } from './lib/downloads'
import { setPadMaps, setUnknownPadHandler, useInputLayer } from './lib/input'
import { pressFx } from './lib/nav'
import { setNoticeOpener, toast, useAppState } from './lib/state'
import { holdMusic, play, setMusic, setMusicVolume } from './lib/sound'
import { useTrophyWatcher } from './lib/trophies'
import { setInstalling, useFinished, useInstalling, useUpdate } from './lib/update'
import { storeGame } from './lib/shop'
import { activeBuild, figureName, moodOf, newFigures, pileOf, shelf, shelfOf } from './lib/shelf'
import { tivi } from './lib/tivi'
import { t } from '@shared/i18n'

/** Редко нужные части грузятся отдельным файлом при первом показе: старт быстрее, памяти меньше */
function deferred<P extends object>(load: () => Promise<ComponentType<P>>) {
  const Part = lazy(() => load().then((C) => ({ default: C })))
  return (props: P) => (
    <Suspense fallback={null}>
      <Part {...props} />
    </Suspense>
  )
}

const GameEditor = deferred(() => import('./components/GameEditor').then((m) => m.GameEditor))
const Intro = deferred(() => import('./components/Intro').then((m) => m.Intro))
const Onboarding = deferred(() => import('./components/Onboarding').then((m) => m.Onboarding))
const Outro = deferred(() => import('./components/Outro').then((m) => m.Outro))
const Profile = deferred(() => import('./components/Profile').then((m) => m.Profile))
const Settings = deferred(() => import('./components/Settings').then((m) => m.Settings))
const SteamImport = deferred(() => import('./components/SteamImport').then((m) => m.SteamImport))
const Store = deferred(() => import('./components/Store').then((m) => m.Store))
const StorePage = deferred(() => import('./components/StorePage').then((m) => m.StorePage))
const DownloadFlow = deferred(() => import('./components/DownloadOptions').then((m) => m.DownloadFlow))
const DownloadsPage = deferred(() => import('./components/Downloads').then((m) => m.DownloadsPage))
const CompletedDialog = deferred(() => import('./components/ShelfDialogs').then((m) => m.CompletedDialog))
const TrophyList = deferred(() => import('./components/TrophyList').then((m) => m.TrophyList))

/** Цвета обложек последних игр — для сияния в интро */
function introColors(games: Game[]) {
  const recent = [...games].filter((g) => g.accent).sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
  return [...new Set(recent.map((g) => g.accent!))].slice(0, 3)
}

/** Интерфейс выгружали на время игры и загрузили снова (#resume/<id игры>): без интро, сразу на странице игры */
const RESUME = (() => {
  const m = location.hash.match(/^#resume(?:\/([^/]+))?/)
  if (!m) return null
  history.replaceState(null, '', location.pathname + location.search)
  return { gameId: m[1] }
})()

/** После смены языка окно перезагружается — возвращаемся в настройки, в раздел, где язык меняли */
const REOPEN_SETTINGS = (() => {
  try {
    const v = sessionStorage.getItem('playos-open-settings')
    sessionStorage.removeItem('playos-open-settings')
    return v
  } catch {
    return null // хранилище недоступно
  }
})()

export function App() {
  const state = useAppState()
  const update = useUpdate()
  const installing = useInstalling()
  // Только что обновились — интро ждёт, пока доиграет экран «готово»
  const finished = useFinished()
  // После смены языка окно перезагружается — интро второй раз не показываем
  const [booting, setBooting] = useState(() => {
    if (RESUME) return false
    // Запустились вместе с Windows сразу в трей: окно откроют позже — сразу главный экран
    if ((window as { pcsHidden?: boolean }).pcsHidden) return false
    try {
      if (sessionStorage.getItem('playos-skip-intro')) {
        sessionStorage.removeItem('playos-skip-intro')
        return false
      }
    } catch {
      /* хранилище недоступно — просто покажем интро */
    }
    return true
  })
  // После смены языка возвращаемся в настройки, где его и меняли
  const [tab, setTab] = useState<Tab>(() => (REOPEN_SETTINGS ? 'settings' : 'home'))
  const [tabFocus, setTabFocus] = useState<number | null>(null)
  const [bgGame, setBgGame] = useState<Game | null>(null)
  const [libFocus, setLibFocus] = useState<LibraryHintState>({ focus: 'grid', searching: false, running: false, missing: false, empty: false })
  const [homeFocus, setHomeFocus] = useState<HomeFocus>({ zone: 'row', item: 'game' })
  const [storeFocus, setStoreFocus] = useState<StoreFocus>({ zone: 'hero', searching: false })
  // Открытая страница игры из магазина
  const [storeItem, setStoreItem] = useState<StoreItem | null>(null)
  /** Игра библиотеки без файлов, которую хотят скачать: варианты из источников или подсказка, что делать */
  const [downloadFor, setDownloadFor] = useState<Game | null>(null)
  // В фокусе переключатель значений (data-adjust) — подсказываем, что его листают влево/вправо
  const [adjustFocus, setAdjustFocus] = useState(false)
  // Игра не запустилась, и понятно, что поправить: файл игры или путь к эмулятору
  const [launchError, setLaunchError] = useState<{ game: Game; error: string; fix: LaunchFix } | null>(null)
  const [editor, setEditor] = useState<{ game?: Game; pickFile?: boolean } | null>(null)
  const [menuGameId, setMenuGameId] = useState<string | null>(null)
  // Окно «Пройдено» из меню игры (в профиле у него своё — с перелётом коробки на полку)
  const [doneGameId, setDoneGameId] = useState<string | null>(null)
  const [trophyGameId, setTrophyGameId] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{ conflict: SaveConflict; game: Game } | null>(null)
  const cloudOffer = useCloudStatus()?.restore
  // Трофеи открыты со страницы игры — «Назад» возвращает на неё, а не на главную
  const trophyFromPage = useRef(false)
  const [pageGameId, setPageGameId] = useState<string | null>(RESUME?.gameId ?? null)
  const [steamImport, setSteamImport] = useState(false)
  const [saver, setSaver] = useState(false)
  const [outro, setOutro] = useState<PowerAction | null>(null)
  const [trophySummary, setTrophySummary] = useState<Record<string, AchievementSummaryItem>>({})
  const [settingsSection, setSettingsSection] = useState<string | undefined>(REOPEN_SETTINGS || undefined)
  const [power, setPower] = useState(false)
  const [notices, setNotices] = useState(false)
  // Нажатие на уведомление о загрузке — раздел «Загрузки»
  useEffect(
    () =>
      setNoticeOpener((n) => {
        if (n.open !== 'downloads') return
        setNotices(false)
        setDownloadsOpen(true)
      }),
    []
  )
  const [downloadsOpen, setDownloadsOpen] = useState(false)
  const downloads = useDownloads()
  useDownloadNotices(downloads)
  const [launching, setLaunching] = useState<string | null>(null)
  // Запуск ждёт сохранения из облака: id игры
  const [launchSync, setLaunchSync] = useState<string | null>(null)
  useEffect(() => api.onLaunchStage((s) => setLaunchSync(s.stage === 'sync' ? s.id : null)), [])
  // Игра, чей запуск ещё ждёт ответа main, и отменённая на экране запуска: её закрываем, как только она стартует
  const launchPending = useRef<string | null>(null)
  const launchCancelled = useRef<string | null>(null)
  const [focusRequest, setFocusRequest] = useState<string | null>(null)
  // Страница игры, закрытая «назад», — кнопка мыши «вперёд» открывает её снова, пока не ушли на другую вкладку
  const closedPage = useRef<{ id: string; tab: Tab } | null>(null)
  useEffect(() => {
    if (pageGameId) closedPage.current = null
  }, [pageGameId])

  const games = state?.games ?? []
  const running = state?.running ?? null
  const runningGame = running ? games.find((g) => g.id === running.gameId) : undefined
  const menuGame = menuGameId ? games.find((g) => g.id === menuGameId) : undefined
  const doneGame = doneGameId ? games.find((g) => g.id === doneGameId) : undefined
  const trophyGame = trophyGameId ? games.find((g) => g.id === trophyGameId) : undefined
  const pageGame = pageGameId ? games.find((g) => g.id === pageGameId) : undefined
  const wizard = !!state && !booting && !state.settings.onboarded
  const modal =
    !!editor || !!menuGame || !!doneGame || power || booting || !!trophyGame || !!pageGame || !!storeItem || !!downloadFor || steamImport || !!outro || wizard || !!conflict || !!cloudOffer || !!launchError || notices || downloadsOpen || installing
  const contentActive = !modal && tabFocus === null

  // Итог сессии не показываем: время игры и так видно на странице игры и в профиле
  useEffect(() => api.onSessionEnd(() => setLaunching(null)), [])

  useEffect(() => api.onToast((n) => toast({ ...n })), [])
  useEffect(() => {
    const onFocus = (e: FocusEvent) => setAdjustFocus(!!(e.target as Element | null)?.hasAttribute?.('data-adjust'))
    document.addEventListener('focusin', onFocus)
    return () => document.removeEventListener('focusin', onFocus)
  }, [])
  const [windowMode, setWindowMode] = useState<WindowMode>({ fullscreen: true, maximized: false })
  useEffect(
    () =>
      api.onWindowMode((m) => {
        setWindowMode(m)
        document.documentElement.classList.toggle('is-windowed', !m.fullscreen)
      }),
    []
  )
  useEffect(() => setPadMaps(state?.settings.padMaps), [state?.settings.padMaps])
  // Геймпад без стандартной раскладки: подсказываем, где назначить кнопки
  useEffect(
    () =>
      setUnknownPadHandler((p) =>
        toast({ title: padName(p.id), message: t('Если кнопки перепутаны: Настройки → Геймпад → «Настроить кнопки геймпада»'), tone: 'info', history: false })
      ),
    []
  )

  // Трофеи игр: сводка для профиля и главного экрана, уведомления о новых
  useEffect(() => {
    const load = () => api.achievementSummary().then(setTrophySummary)
    void load()
    const offSummary = api.onAchievementSummary(load)
    const offNew = api.onAchievements((n) => {
      play('trophy')
      for (const a of n.items.slice(0, 3)) toast({ title: a.title, message: n.gameTitle, kind: 'trophy', tier: a.tier })
    })
    return () => {
      offSummary()
      offNew()
    }
  }, [])

  useTrophyWatcher(state, booting)
  useEffect(() => setMusic(!!state?.settings.music), [state?.settings.music])
  useEffect(() => setMusicVolume(state?.settings.musicVolume ?? 'mid'), [state?.settings.musicVolume])
  // Музыка молчит во время интро и пока запущена игра
  useEffect(() => holdMusic(booting || !!running || !!outro || installing), [booting, running, outro, installing])

  // Экран запуска убираем, когда игра забрала фокус
  useEffect(() => {
    if (!running || running.phase === 'running') setLaunching(null)
  }, [running?.phase, running])

  const goTab = useCallback((t: Tab) => {
    setTab((cur) => {
      if (cur !== t) play('tab')
      return t
    })
  }, [])

  const launch = async (g: Game, opts?: { skipSync?: boolean }) => {
    // Игры нет на этом ПК: PC-игру предлагаем скачать («Указать файл игры» — на её странице и в меню), эмуляторам — сразу выбрать файл
    if (notInstalled(g)) {
      play('select')
      // Игра уже качается или ждёт установки — показываем её загрузку, а не варианты заново
      if (downloads.some((j) => j.gameId === g.id && (j.status !== 'done' || (j.install && j.install !== 'installed')))) return setDownloadsOpen(true)
      return g.platform === 'pc' ? setDownloadFor(g) : setEditor({ game: g, pickFile: true })
    }
    if (running) {
      if (running.gameId === g.id) return api.resumeGame()
      play('error')
      return toast({ title: t('Уже запущена другая игра'), message: t('Сначала закройте «{title}».', { title: runningGame?.title }), tone: 'error', history: false })
    }
    play('launch')
    setLaunching(g.id)
    setFocusRequest(g.id)
    launchPending.current = g.id
    const res = await api.launch(g.id, opts).finally(() => (launchPending.current = null))
    // Отменили, пока main запускал: игру он уже остановил сам
    if (launchCancelled.current === g.id || res.cancelled) {
      launchCancelled.current = null
      return
    }
    if (res.conflict) {
      // Сохранения разошлись с облаком — сначала выбор, потом запуск
      setLaunching(null)
      setConflict({ conflict: res.conflict, game: g })
    } else if (!res.ok) {
      setLaunching(null)
      play('error')
      // Известно, что поправить — сразу ведём туда, а не оставляем подсказку в исчезающем уведомлении
      if (res.fix) setLaunchError({ game: g, error: res.error ?? '', fix: res.fix })
      else toast({ title: t('Не удалось запустить игру'), message: res.error, tone: 'error' })
    }
  }

  /** ○ на экране запуска: игра не стартует, а если уже стартовала (или ещё стартует через Steam) — закрывается */
  const cancelLaunch = () => {
    if (!launching) return
    play('back')
    if (launchPending.current === launching) launchCancelled.current = launching
    void api.cancelLaunch(launching)
    setLaunching(null)
  }

  /** Перейти на главный экран и поставить фокус на игру */
  const focusGame = (g: Game) => {
    setTab('home')
    setTabFocus(null)
    setFocusRequest(g.id + ':' + Date.now())
    setTimeout(() => setFocusRequest(g.id), 0)
  }

  const closeGame = () => {
    play('back')
    api.closeGame()
  }

  // Глобальные кнопки: L1/R1 — вкладки, Home — на главную
  useInputLayer(
    (a) => {
      if (a === 'l1' || a === 'r1') {
        const i = TABS.findIndex((t) => t.id === tab)
        const next = TABS[Math.max(0, Math.min(TABS.length - 1, i + (a === 'l1' ? -1 : 1)))]
        goTab(next.id)
        if (tabFocus !== null) setTabFocus(TABS.findIndex((t) => t.id === next.id))
      } else if (a === 'home') {
        goTab('home')
        setTabFocus(null)
      } else if (a === 'view') {
        play('select')
        setNotices(true)
      } else if (a === 'forward') {
        const c = closedPage.current
        if (!c || c.tab !== tab || !games.some((g) => g.id === c.id)) return play('bump')
        play('select')
        setPageGameId(c.id)
      } else return false
    },
    -1,
    !modal
  )

  // Зона вкладок (верхняя панель)
  useInputLayer(
    (a) => {
      if (tabFocus === null) return false
      if (a === 'left' || a === 'right') {
        const next = Math.max(0, Math.min(TABS.length + 2, tabFocus + (a === 'left' ? -1 : 1)))
        if (next === tabFocus) return
        setTabFocus(next)
        if (next < TABS.length) goTab(TABS[next].id)
        else play('move')
      } else if (a === 'down' || a === 'back') {
        play('move')
        setTabFocus(null)
      } else if (a === 'confirm') {
        if (tabFocus === TABS.length) {
          play('select')
          pressFx(document.querySelector('.dl-btn'))
          setDownloadsOpen(true)
        } else if (tabFocus === TABS.length + 1) {
          play('select')
          pressFx(document.querySelector('.notice-btn'))
          setNotices(true)
        } else if (tabFocus === TABS.length + 2) {
          play('select')
          pressFx(document.querySelector('.power-btn:not(.notice-btn):not(.dl-btn)'))
          setPower(true)
        } else setTabFocus(null)
      } else return false
    },
    1,
    !modal && tabFocus !== null
  )

  const exitTop = () => {
    play('move')
    setTabFocus(TABS.findIndex((t) => t.id === tab))
  }

  if (!state) return <div className="app" />

  const launchingGame = launching ? games.find((g) => g.id === launching) : undefined
  const lastGame = [...games].filter((g) => g.lastPlayed).sort((a, b) => b.lastPlayed! - a.lastPlayed!)[0]
  const calm = tab === 'settings' || tab === 'profile'
  const bgTarget = tab === 'settings' ? null : tab === 'profile' ? (lastGame ?? null) : (bgGame ?? null)
  // Акценты и свечение интерфейса — в цвет обложки игры в фокусе
  const accent = state.settings.gameTint && tab !== 'settings' ? accentOf(bgTarget) : DEFAULT_ACCENT
  const hints = calm ? (
    <>
      <Hint glyph="confirm" label={t('Выбрать')} />
      {tab === 'settings' && adjustFocus && <Hint glyph="adjust" label={t('Изменить')} />}
      <Hint glyph="back" label={t('Назад')} />
    </>
  ) : tab === 'library' ? (
    libFocus.focus !== 'grid' ? (
      // Фишки библиотеки: подсказки под то, что в фокусе
      <>
        <Hint
          glyph="confirm"
          label={
            libFocus.focus === 'search'
              ? t('Ввести название')
              : libFocus.focus === 'collections'
                ? t('Выбрать подборку')
                : libFocus.focus === 'sort'
                  ? t('Сменить сортировку')
                  : libFocus.focus === 'add'
                    ? t('Добавить игру')
                    : t('Показать')
          }
        />
        <Hint glyph="back" label={libFocus.searching ? t('Сбросить поиск') : t('Назад')} />
        <Hint glyph="r2" label={t('Фильтр')} />
      </>
    ) : libFocus.empty ? (
      <>
        <Hint glyph="confirm" label={libFocus.searching ? t('Сбросить поиск') : t('Добавить игру')} />
        <Hint glyph="back" label={libFocus.searching ? t('Сбросить поиск') : t('Назад')} />
        <Hint glyph="r2" label={t('Фильтр')} />
      </>
    ) : (
      <>
        {!libFocus.missing && <Hint glyph="confirm" label={libFocus.running ? t('Вернуться в игру') : t('Играть')} />}
        <Hint glyph="menu" label={t('Параметры')} />
        <HoldHint label={t('Об игре')} />
        {libFocus.searching ? <Hint glyph="back" label={t('Сбросить поиск')} /> : <Hint glyph="search" label={t('Добавить игру')} />}
        <Hint glyph="r2" label={t('Фильтр')} />
      </>
    )
  ) : tab === 'store' ? (
    storeFocus.zone === 'search' ? (
      <>
        <Hint glyph="confirm" label={t('Ввести название')} />
        <Hint glyph="back" label={storeFocus.searching ? t('Сбросить поиск') : t('Назад')} />
      </>
    ) : storeFocus.zone === 'all' || storeFocus.zone === 'browse' ? (
      <>
        <Hint glyph="confirm" label={storeFocus.zone === 'all' ? t('Каталог игр') : t('Выбрать')} />
        {storeFocus.zone === 'browse' && <Hint glyph="options" label={t('Фильтры')} />}
        <Hint glyph="back" label={t('Назад')} />
      </>
    ) : storeFocus.zone === 'browse-grid' ? (
      <>
        <Hint glyph="confirm" label={t('Подробнее')} />
        {!storeFocus.owned && <Hint glyph="menu" label={t('В библиотеку')} />}
        <Hint glyph="options" label={t('Фильтры')} />
        <Hint glyph="back" label={t('Назад')} />
      </>
    ) : storeFocus.zone === 'browse-panel' ? (
      <>
        <Hint glyph="confirm" label={t('Выбрать')} />
        <Hint glyph="back" label={t('К играм')} />
      </>
    ) : storeFocus.zone === 'retry' ? (
      <>
        <Hint glyph="confirm" label={t('Повторить')} />
        <Hint glyph="back" label={t('Назад')} />
      </>
    ) : (
      <>
        <Hint glyph="confirm" label={t('Подробнее')} />
        {!storeFocus.owned && <Hint glyph="menu" label={t('В библиотеку')} />}
        {storeFocus.zone === 'hero' && <Hint glyph="adjust" label={t('Листать')} />}
        <Hint glyph="back" label={storeFocus.searching ? t('Сбросить поиск') : t('Назад')} />
        <Hint glyph="search" label={t('Поиск')} />
      </>
    )
  ) : homeFocus.zone === 'actions' ? (
    <>
      <Hint glyph="confirm" label={t('Выбрать')} />
      {(homeFocus.item === 'game' || homeFocus.item === 'running' || homeFocus.item === 'missing' || homeFocus.item === 'download') && <Hint glyph="menu" label={t('Параметры')} />}
      <Hint glyph="back" label={t('Назад')} />
    </>
  ) : homeFocus.item === 'game' || homeFocus.item === 'running' || homeFocus.item === 'missing' || homeFocus.item === 'download' ? (
    <>
      <Hint
        glyph="confirm"
        label={homeFocus.item === 'running' ? t('Вернуться в игру') : homeFocus.item === 'download' ? t('Скачать') : homeFocus.item === 'missing' ? t('Указать файл игры') : t('Играть')}
      />
      <Hint glyph="menu" label={t('Параметры')} />
      <HoldHint label={t('Об игре')} />
      <Hint glyph="search" label={t('Добавить игру')} />
    </>
  ) : (
    // Плитки «Библиотека», «Случайная», «Добавить» в конце ряда
    <>
      <Hint glyph="confirm" label={SPECIAL[homeFocus.item].action} />
      {homeFocus.item !== 'add' && <Hint glyph="search" label={t('Добавить игру')} />}
    </>
  )

  return (
    // Системное «Уменьшить движение»: Motion оставляет только плавное появление, без сдвигов и масштаба
    <MotionConfig reducedMotion="user">
    <GlyphStyleContext.Provider value={state.settings.glyphs}>
      <AnimatedCoversContext.Provider value={state.settings.animatedCovers}>
      <div className={`app tinted ${tabFocus !== null && !modal ? 'is-tabs-zone' : ''}`} data-tab={tab} style={{ '--game-accent': accent } as React.CSSProperties}>
        <WindowFrame mode={windowMode} />
        <Background
          game={bgTarget}
          dim={calm}
          // Живой фон — только на главной и в библиотеке, когда ничего не открыто и не идёт игра
          live={state.settings.liveBackground && !calm && !modal && !saver && !running}
        />

        <motion.div
          className="shell"
          initial={false}
          animate={
            booting || outro
              ? { opacity: 0, transform: booting ? 'scale(1.04)' : 'scale(0.97)', filter: 'blur(8px)' }
              : // В покое filter снимается совсем: даже blur(0px) делает оболочку границей для backdrop-filter,
                // и стекло внутри перестаёт размывать фон за ней
                { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)', transitionEnd: { filter: 'none' } }
          }
          transition={{ duration: 0.9, ease: [0.23, 1, 0.32, 1] }}
        >
          <TopBar
            tab={tab}
            tabFocus={modal ? null : tabFocus}
            userName={state.settings.userName}
            avatar={state.settings.avatar}
            runningGame={runningGame}
            runningSince={running?.startedAt}
            onTab={(next) => {
              goTab(next)
              setTabFocus(null)
            }}
            updateReady={update.phase === 'ready'}
            downloads={downloads}
            onDownloads={() => {
              play('select')
              setDownloadsOpen(true)
            }}
            onNotices={() => {
              play('select')
              setNotices(true)
            }}
            onPower={() => setPower(true)}
          />

          <main className="content">
            <AnimatePresence initial={false}>
              <motion.div
                key={tab}
                className="tab-page"
                initial={{ opacity: 0, transform: 'translateY(1.2rem)' }}
                animate={{ opacity: 1, transform: 'translateY(0rem)' }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
                transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
              >
                {tab === 'home' && (
                  <Home
                    games={games}
                    running={running}
                    active={contentActive}
                    focusRequest={focusRequest}
                    uiScale={state.settings.uiScale}
                    trophies={trophySummary}
                    onFocusGame={setBgGame}
                    onFocusKind={setHomeFocus}
                    onExitTop={exitTop}
                    onLaunch={launch}
                    onResume={() => api.resumeGame()}
                    onCloseGame={closeGame}
                    onMenu={(g) => setMenuGameId(g.id)}
                    onInfo={(g) => {
                      play('select')
                      setPageGameId(g.id)
                    }}
                    onAdd={() => setEditor({})}
                    onLibrary={() => goTab('library')}
                  />
                )}
                {tab === 'library' && (
                  <Library
                    games={games}
                    running={running}
                    active={contentActive}
                    collections={state.settings.collections ?? []}
                    sort={state.settings.librarySort ?? 'recent'}
                    onFocusGame={setBgGame}
                    onFocusKind={setLibFocus}
                    onExitTop={exitTop}
                    onLaunch={launch}
                    onMenu={(g) => setMenuGameId(g.id)}
                    onInfo={(g) => setPageGameId(g.id)}
                    onAdd={() => setEditor({})}
                  />
                )}
                {tab === 'store' && (
                  <Store
                    games={games}
                    active={contentActive}
                    onFocusItem={(item) => setBgGame(item ? storeGame(item) : null)}
                    onFocusKind={setStoreFocus}
                    onExitTop={exitTop}
                    onOpen={setStoreItem}
                  />
                )}
                {tab === 'profile' && (
                  <Profile
                    state={state}
                    active={contentActive}
                    onExitTop={exitTop}
                    onLaunch={launch}
                  />
                )}
                {tab === 'settings' && (
                  <Settings
                    state={state}
                    active={contentActive}
                    onExitTop={exitTop}
                    initialSection={settingsSection}
                    onSteamImport={() => {
                      play('select')
                      setSteamImport(true)
                    }}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </main>

          <footer className="hints">{hints}</footer>
          {state.settings.tivi !== false && <Tivi playing={!!runningGame} greet={!booting} size={tab === 'home' ? state.settings.tiviSize : 'small'} />}
        </motion.div>

        <AnimatePresence>
          {editor && (
            <GameEditor
              key="editor"
              game={editor.game}
              pickFile={editor.pickFile}
              settings={state.settings}
              onSteamImport={() => {
                setEditor(null)
                setSteamImport(true)
              }}
              onClose={() => {
                play('back')
                setEditor(null)
              }}
              onSaved={(g) => {
                // Правка видна сразу на плитке, а новая игра может оказаться не там, куда смотрели
                if (!editor.game) toast({ title: t('Игра добавлена'), message: g.title, image: g.cover, tone: 'success', history: false })
                setEditor(null)
                // В «Недавних» только игры, в которые уже играли: новую показываем её страницей
                if (g.lastPlayed) focusGame(g)
                else if (!editor.game) setPageGameId(g.id)
              }}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {menuGame && (
            <GameMenu
              key="menu"
              game={menuGame}
              running={running}
              onClose={() => setMenuGameId(null)}
              onLaunch={launch}
              onCloseGame={closeGame}
              onEdit={(g) => setEditor({ game: g })}
              onTrophies={(g) => {
                setMenuGameId(null)
                trophyFromPage.current = false
                setTrophyGameId(g.id)
              }}
              onInfo={(g) => {
                setMenuGameId(null)
                setPageGameId(g.id)
              }}
              onDownload={(g) => {
                setMenuGameId(null)
                setDownloadFor(g)
              }}
              onDone={(g) => {
                setMenuGameId(null)
                setDoneGameId(g.id)
              }}
              collections={state.settings.collections ?? []}
              pile={{ build: activeBuild(state.settings), list: pileOf(games, activeBuild(state.settings).id) }}
            />
          )}
          {notices && <NoticeCenter key="notices" settings={state.settings} onClose={() => setNotices(false)} />}
          {power && <PowerMenu key="power" update={update.phase === 'ready' ? update.version : undefined} onClose={() => setPower(false)} onPower={setOutro} />}
        </AnimatePresence>

        <AnimatePresence>
          {doneGame && (
            <CompletedDialog
              key="done"
              game={doneGame}
              onCancel={() => {
                play('back')
                setDoneGameId(null)
              }}
              onConfirm={(mood, full) => {
                // Не в профиле полки не видно — коротко скажем, куда делась игра, и про новую фигурку
                const figures = newFigures(shelfOf(games), full).filter((f) => !state.settings.figuresSeen?.includes(f.id))
                void shelf.complete(doneGame, mood, full)
                setDoneGameId(null)
                play('toggleOn')
                tivi({ act: moodOf(mood)?.act ?? 'happy', ms: 2600, priority: 5 })
                toast({ title: t('На полке'), message: doneGame.title, image: doneGame.cover, tone: 'success', history: false })
                if (figures.length) {
                  toast({ title: t('Новая фигурка Тиви'), message: figures.map((f) => figureName(f.id)).join(', '), tone: 'success' })
                  void api.saveSettings({ figuresSeen: [...(state.settings.figuresSeen ?? []), ...figures.map((f) => f.id)] })
                }
              }}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {downloadsOpen && (
            <DownloadsPage
              key="downloads"
              jobs={downloads}
              onClose={() => setDownloadsOpen(false)}
              onPlay={(id) => {
                const g = games.find((x) => x.id === id)
                if (!g) return play('bump')
                setDownloadsOpen(false)
                void launch(g)
              }}
              onPickFile={(id) => {
                const g = games.find((x) => x.id === id)
                if (!g) return play('bump')
                setDownloadsOpen(false)
                setEditor({ game: g, pickFile: true })
              }}
              onGo={(to) => {
                setDownloadsOpen(false)
                goTab(to)
              }}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {pageGame && (
            <GamePage
              key="page"
              game={pageGame}
              running={running}
              trophies={trophySummary[pageGame.id]}
              onClose={() => {
                closedPage.current = { id: pageGame.id, tab }
                setPageGameId(null)
              }}
              onLaunch={(g) => {
                setPageGameId(null)
                void launch(g)
              }}
              onDownload={(g) => {
                play('select')
                setDownloadFor(g)
              }}
              onPickFile={(g) => {
                play('select')
                setPageGameId(null)
                setEditor({ game: g, pickFile: true })
              }}
              onTrophies={(g) => {
                play('select')
                setPageGameId(null)
                trophyFromPage.current = true
                setTrophyGameId(g.id)
              }}
              onEdit={(g) => {
                play('select')
                setPageGameId(null)
                setEditor({ game: g })
              }}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {storeItem && (
            <StorePage
              key={`store-${storeItem.appId}`}
              item={storeItem}
              games={games}
              onClose={() => setStoreItem(null)}
              onOpenGame={(g) => {
                setStoreItem(null)
                setPageGameId(g.id)
              }}
              onDownload={setDownloadFor}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {downloadFor && (
            <DownloadFlow
              key={`dl-${downloadFor.id}`}
              appId={downloadFor.platform === 'pc' ? (downloadFor.steamAppId ?? 0) : 0}
              title={downloadFor.title}
              platform={downloadFor.platform}
              gameId={downloadFor.id}
              cover={downloadFor.cover}
              hero={downloadFor.hero}
              onClose={() => setDownloadFor(null)}
              onOpenSources={() => {
                setDownloadFor(null)
                setStoreItem(null)
                setPageGameId(null)
                setSettingsSection('store')
                setTab('settings')
                setTabFocus(null)
              }}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {wizard && <Onboarding key="wizard" state={state} paused={steamImport} onSteamImport={() => setSteamImport(true)} />}
        </AnimatePresence>

        <AnimatePresence>{steamImport && <SteamImport key="steam" onClose={() => setSteamImport(false)} />}</AnimatePresence>

        <AnimatePresence>{cloudOffer && <RestoreDialog key="restore" offer={cloudOffer} />}</AnimatePresence>

        <AnimatePresence>
          {conflict && (
            <SaveConflictDialog
              key="conflict"
              conflict={conflict.conflict}
              title={conflict.game.title}
              onDone={() => {
                setConflict(null)
                void launch(conflict.game)
              }}
              onLater={() => {
                setConflict(null)
                void launch(conflict.game, { skipSync: true })
              }}
              onCancel={() => {
                play('back')
                setConflict(null)
              }}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {trophyGame && (
            <TrophyList
              key="trophies"
              game={trophyGame}
              onClose={() => {
                play('back')
                if (trophyFromPage.current) setPageGameId(trophyGame.id)
                trophyFromPage.current = false
                setTrophyGameId(null)
                void api.achievementSummary().then(setTrophySummary)
              }}
              onOpenSettings={() => {
                trophyFromPage.current = false
                setTrophyGameId(null)
                setSettingsSection('trophies')
                setTab('settings')
                setTabFocus(null)
              }}
              onEdit={(g) => {
                trophyFromPage.current = false
                setTrophyGameId(null)
                setEditor({ game: g })
              }}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {launchError && (
            <ConfirmDialog
              key="launch-error"
              title={t('Не удалось запустить «{title}»', { title: launchError.game.title })}
              text={launchError.error}
              button={launchError.fix === 'game' ? t('Указать файл игры') : t('Открыть настройки эмуляторов')}
              cancel={t('Закрыть')}
              tone="primary"
              onCancel={() => setLaunchError(null)}
              onConfirm={() => {
                const { game, fix } = launchError
                setLaunchError(null)
                play('select')
                if (fix === 'game') setEditor({ game })
                else {
                  setSettingsSection('emulators')
                  setTab('settings')
                  setTabFocus(null)
                }
              }}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>{launchingGame && <LaunchScreen key="launch" game={launchingGame} syncing={launchSync === launchingGame.id} onSkip={() => void api.skipLaunchSync(launchingGame.id)} onCancel={cancelLaunch} />}</AnimatePresence>

        {/* Окно об обновлении — только когда вы не в игре и ничего другого не открыто */}
        <UpdateNotice blocked={modal || !!running || !!launching || saver} booting={booting || !!outro} />
        <OnScreenKeyboard />
        <Toasts size={state.settings.noticeSize} />
        <Screensaver games={games} minutes={state.settings.screensaver} allowed={!booting && !outro} onChange={setSaver} />
        <AnimatePresence>
          {outro && (
            <Outro
              key="outro"
              kind={outro}
              userName={state.settings.userName}
              games={games}
              running={running}
              colors={introColors(games)}
              onCancel={() => setOutro(null)}
            />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {installing && (
            <UpdateInstall
              key="install"
              version={update.version}
              onFail={() => {
                setInstalling(false)
                toast({ title: t('Не удалось установить обновление'), message: t('PlayOS попробует ещё раз при выходе'), tone: 'error' })
              }}
            />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {booting && !finished && (
            <Intro
              key="intro"
              userName={state.settings.userName}
              avatar={state.settings.avatar}
              lastGame={lastGame?.title}
              colors={introColors(games)}
              onDone={() => setBooting(false)}
            />
          )}
        </AnimatePresence>
      </div>
      </AnimatedCoversContext.Provider>
    </GlyphStyleContext.Provider>
    </MotionConfig>
  )
}
