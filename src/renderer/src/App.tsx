import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useState } from 'react'
import type { AchievementSummaryItem, Game, PowerAction } from '@shared/types'
import { Background } from './components/Background'
import { GameEditor } from './components/GameEditor'
import { GamePage } from './components/GamePage'
import { GlyphStyleContext, Hint } from './components/Glyph'
import { Home } from './components/Home'
import { Library } from './components/Library'
import { GameMenu, PowerMenu } from './components/Menus'
import { Intro } from './components/Intro'
import { Onboarding } from './components/Onboarding'
import { OnScreenKeyboard } from './components/OnScreenKeyboard'
import { Outro } from './components/Outro'
import { LaunchScreen, Toasts } from './components/Overlays'
import { Profile } from './components/Profile'
import { Screensaver } from './components/Screensaver'
import { Settings } from './components/Settings'
import { SteamImport } from './components/SteamImport'
import { AnimatedCoversContext } from './components/Tile'
import { TrophyList } from './components/TrophyList'
import { TABS, TopBar, type Tab } from './components/TopBar'
import { api } from './lib/api'
import { accentOf, DEFAULT_ACCENT, playtime } from './lib/format'
import { useInputLayer } from './lib/input'
import { pressFx } from './lib/nav'
import { toast, useAppState } from './lib/state'
import { holdMusic, play, setMusic } from './lib/sound'
import { useTrophyWatcher } from './lib/trophies'

/** Цвета обложек последних игр — для сияния в интро */
function introColors(games: Game[]) {
  const recent = [...games].filter((g) => g.accent).sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
  return [...new Set(recent.map((g) => g.accent!))].slice(0, 3)
}

export function App() {
  const state = useAppState()
  const [booting, setBooting] = useState(true)
  const [tab, setTab] = useState<Tab>('home')
  const [tabFocus, setTabFocus] = useState<number | null>(null)
  const [bgGame, setBgGame] = useState<Game | null>(null)
  const [editor, setEditor] = useState<{ game?: Game } | null>(null)
  const [menuGameId, setMenuGameId] = useState<string | null>(null)
  const [trophyGameId, setTrophyGameId] = useState<string | null>(null)
  const [pageGameId, setPageGameId] = useState<string | null>(null)
  const [steamImport, setSteamImport] = useState(false)
  const [saver, setSaver] = useState(false)
  const [outro, setOutro] = useState<PowerAction | null>(null)
  const [trophySummary, setTrophySummary] = useState<Record<string, AchievementSummaryItem>>({})
  const [settingsSection, setSettingsSection] = useState<string | undefined>()
  const [power, setPower] = useState(false)
  const [launching, setLaunching] = useState<string | null>(null)
  const [focusRequest, setFocusRequest] = useState<string | null>(null)

  const games = state?.games ?? []
  const running = state?.running ?? null
  const runningGame = running ? games.find((g) => g.id === running.gameId) : undefined
  const menuGame = menuGameId ? games.find((g) => g.id === menuGameId) : undefined
  const trophyGame = trophyGameId ? games.find((g) => g.id === trophyGameId) : undefined
  const pageGame = pageGameId ? games.find((g) => g.id === pageGameId) : undefined
  const wizard = !!state && !booting && !state.settings.onboarded
  const modal = !!editor || !!menuGame || power || booting || !!trophyGame || !!pageGame || steamImport || !!outro || wizard
  const contentActive = !modal && tabFocus === null

  useEffect(
    () =>
      api.onSessionEnd(({ gameId, duration }) => {
        setLaunching(null)
        const g = (state?.games ?? []).find((x) => x.id === gameId)
        play('select')
        toast({ title: g?.title ?? 'Игра закрыта', message: duration ? `Сессия: ${playtime(duration).toLowerCase()}` : 'Игра закрыта', image: g?.cover, tone: 'success' })
      }),
    [state?.games]
  )

  useEffect(() => api.onToast((t) => toast({ ...t })), [])
  // Новая версия скачалась — говорим один раз, поставится она сама при выходе
  useEffect(() => {
    let shown = ''
    return api.onUpdateState((u) => {
      if (u.phase !== 'ready' || !u.version || shown === u.version) return
      shown = u.version
      play('trophy')
      toast({ title: `Доступна PlayOS ${u.version}`, message: 'Установится при выходе. Или сразу: Настройки → Система → Обновления', tone: 'success' })
    })
  }, [])
  // Окно закрывают (Alt+F4) — main ждёт, пока доиграет аутро выхода
  useEffect(() => api.onOutro(() => setOutro((cur) => cur ?? 'quit')), [])

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
  // Музыка молчит во время интро и пока запущена игра
  useEffect(() => holdMusic(booting || !!running || !!outro), [booting, running, outro])

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

  const launch = async (g: Game) => {
    if (running) {
      if (running.gameId === g.id) return api.resumeGame()
      play('error')
      return toast({ title: 'Уже запущена другая игра', message: `Сначала закройте «${runningGame?.title}».`, tone: 'error' })
    }
    play('launch')
    setLaunching(g.id)
    setFocusRequest(g.id)
    const res = await api.launch(g.id)
    if (!res.ok) {
      setLaunching(null)
      play('error')
      toast({ title: 'Не удалось запустить игру', message: res.error, tone: 'error' })
    }
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
        const next = Math.max(0, Math.min(TABS.length, tabFocus + (a === 'left' ? -1 : 1)))
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
          pressFx(document.querySelector('.power-btn'))
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
  const hints =
    calm ? (
      <>
        <Hint glyph="confirm" label="Выбрать" />
        <Hint glyph="back" label="Назад" />
      </>
    ) : (
      <>
        <Hint glyph="confirm" label="Играть" />
        <Hint glyph="menu" label="Параметры" />
        <Hint glyph="search" label="Добавить игру" />
        {tab === 'library' && <Hint glyph="r2" label="Фильтр" />}
      </>
    )

  return (
    <GlyphStyleContext.Provider value={state.settings.glyphs}>
      <AnimatedCoversContext.Provider value={state.settings.animatedCovers}>
      <div className={`app tinted ${tabFocus !== null && !modal ? 'is-tabs-zone' : ''}`} style={{ '--game-accent': accent } as React.CSSProperties}>
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
              : { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' }
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
            onTab={(t) => {
              goTab(t)
              setTabFocus(null)
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
                    onFocusGame={setBgGame}
                    onExitTop={exitTop}
                    onLaunch={launch}
                    onMenu={(g) => setMenuGameId(g.id)}
                    onAdd={() => setEditor({})}
                  />
                )}
                {tab === 'profile' && (
                  <Profile
                    state={state}
                    active={contentActive}
                    onExitTop={exitTop}
                    onOpenGame={focusGame}
                    trophies={trophySummary}
                    onOpenTrophies={(g) => setTrophyGameId(g.id)}
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
        </motion.div>

        <AnimatePresence>
          {editor && (
            <GameEditor
              key="editor"
              game={editor.game}
              settings={state.settings}
              onClose={() => {
                play('back')
                setEditor(null)
              }}
              onSaved={(g) => {
                toast({ title: editor.game ? 'Изменения сохранены' : 'Игра добавлена', message: g.title, image: g.cover, tone: 'success' })
                setEditor(null)
                focusGame(g)
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
                setTrophyGameId(g.id)
              }}
              onInfo={(g) => {
                setMenuGameId(null)
                setPageGameId(g.id)
              }}
            />
          )}
          {power && <PowerMenu key="power" onClose={() => setPower(false)} onPower={setOutro} />}
        </AnimatePresence>

        <AnimatePresence>
          {pageGame && (
            <GamePage
              key="page"
              game={pageGame}
              running={running}
              trophies={trophySummary[pageGame.id]}
              onClose={() => setPageGameId(null)}
              onLaunch={(g) => {
                setPageGameId(null)
                void launch(g)
              }}
              onTrophies={(g) => {
                play('select')
                setPageGameId(null)
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
          {wizard && <Onboarding key="wizard" state={state} paused={steamImport} onSteamImport={() => setSteamImport(true)} />}
        </AnimatePresence>

        <AnimatePresence>{steamImport && <SteamImport key="steam" onClose={() => setSteamImport(false)} />}</AnimatePresence>

        <AnimatePresence>
          {trophyGame && (
            <TrophyList
              key="trophies"
              game={trophyGame}
              onClose={() => {
                play('back')
                setTrophyGameId(null)
                void api.achievementSummary().then(setTrophySummary)
              }}
              onOpenSettings={() => {
                setTrophyGameId(null)
                setSettingsSection('trophies')
                setTab('settings')
                setTabFocus(null)
              }}
              onEdit={(g) => {
                setTrophyGameId(null)
                setEditor({ game: g })
              }}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>{launchingGame && <LaunchScreen key="launch" game={launchingGame} />}</AnimatePresence>

        <OnScreenKeyboard />
        <Toasts />
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
          {booting && (
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
  )
}
