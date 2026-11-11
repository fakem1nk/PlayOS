import type {
  AchievementSet,
  ApiKeyKind,
  AppState,
  ArtCandidate,
  CloudStatus,
  LaunchStage,
  DownloadJob,
  DownloadOption,
  Game,
  GameDone,
  GameMood,
  ImportProgress,
  PcsApi,
  SaveProgress,
  SteamLibraryGame,
  StoreHome,
  StoreItem,
  StoreSource,
  SystemState,
  WindowMode, TorrentFile } from '@shared/types'
import { SRC_BASE } from '@shared/types'
import { getLang } from '@shared/i18n'
import { libraryMatch } from '@shared/match'

declare global {
  interface Window {
    pcs?: PcsApi
  }
}

/**
 * Мок для запуска интерфейса в обычном браузере (npm run dev без Electron):
 * позволяет проверять вёрстку и анимации с демо-библиотекой.
 */
function createMockApi(): PcsApi {
  let saveCancelled = false
  const progressSubs = new Set<(p: SaveProgress) => void>()
  const importSubs = new Set<(p: ImportProgress) => void>()
  const keySubs = new Set<(e: { kind: ApiKeyKind; key: string }) => void>()
  let keyTimer: ReturnType<typeof setTimeout> | undefined
  let keyPageOpened = false
  let demoWindow: WindowMode = { fullscreen: false, maximized: false }
  let windowModeCb: ((m: WindowMode) => void) | null = null
  let sys: SystemState = {
    volume: 0.65,
    muted: false,
    brightness: 80,
    devices: [
      { id: 'a', name: 'MONITOR L/R (Volt 1)', default: true },
      { id: 'b', name: 'Q27B3MA (NVIDIA High Definition Audio)', default: false },
      { id: 'c', name: 'Наушники (Oculus Virtual Audio Device)', default: false }
    ]
  }
  const demoTrophies = (): AchievementSet => {
    const tiers = ['bronze', 'bronze', 'silver', 'bronze', 'gold', 'bronze', 'silver', 'gold'] as const
    const items = tiers.map((tier, i) => ({
      id: String(i),
      title: ['Первый день в школе', 'Хулиган', 'Отличник', 'Велосипедист', 'Король Буллворта', 'Коллекционер', 'Мастер рогатки', 'Легенда'][i],
      description: 'Описание трофея из RetroAchievements или Steam',
      tier,
      rarity: [72, 55, 24, 61, 6, 40, 18, 3][i],
      earnedAt: i < 4 ? Date.now() - i * 86400000 : undefined,
      // Снимок момента получения — у первых двух
      shot: i < 2 ? steam(12200, ['library_hero.jpg', 'header.jpg'][i]) : undefined
    }))
    return { source: 'ra', gameTitle: 'Bully', items, total: items.length, earned: 4, fetchedAt: Date.now() }
  }
  const steam = (id: number, file: string) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/${file}`
  // Цвета обложек посчитаны тем же алгоритмом, что main/color.ts: в браузере main-процесса нет
  const DEMO_ACCENT: Record<string, string> = { '1': '#40c6ff', '2': '#0b96ff', '3': '#ff0e15', '4': '#ffce40', '5': '#4087ff', '6': '#ffe840', '7': '#409bff', '8': '#40afff', '10': '#ff9640' }
  const demo = (id: string, title: string, platform: Game['platform'], appid: number, hours: number, daysAgo?: number): Game => ({
    id,
    accent: DEMO_ACCENT[id],
    title,
    platform,
    path: `C:\\Games\\${title}\\game.exe`,
    cover: steam(appid, 'library_600x900_2x.jpg'),
    hero: steam(appid, 'library_hero.jpg'),
    logo: steam(appid, 'logo.png'),
    playtime: Math.round(hours * 3600),
    lastPlayed: daysAgo === undefined ? undefined : Date.now() - daysAgo * 86400000,
    addedAt: Date.now() - 30 * 86400000,
    // Демо-сессии за последние две недели для графика активности
    sessions: hours > 1 ? Array.from({ length: 4 }, (_, i) => ({ start: Date.now() - ((i * 3 + Number(id)) % 14) * 86400000, duration: 1800 + ((Number(id) * 977 * (i + 1)) % 7200) })) : []
  })
  // Полка и стопка профиля: пройденные за три года, три сборки и игры для них (их нет на главной — в них не играли)
  const yr = new Date().getFullYear()
  const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 21, 30).getTime()
  const done = (at: number, hours: number, days: number, mood: GameMood, full?: boolean): GameDone => ({ at, playtime: Math.round(hours * 3600), days, mood, full })
  const extra = (id: string, title: string, platform: Game['platform'], appid: number | null, hours: number, more: Partial<Game> = {}): Game => ({
    ...demo(id, title, platform, appid ?? 0, hours),
    ...(appid ? {} : { cover: undefined, hero: undefined, logo: undefined }),
    lastPlayed: undefined,
    addedAt: Date.now() - 400 * 86400000,
    sessions: [],
    ...more
  })
  const PILES: Record<string, Record<string, number>> = {
    '5': { main: 1, souls: 3 },
    '4': { main: 2 },
    '1': { main: 3 },
    'hk': { main: 4 },
    '7': { main: 5 },
    'er': { main: 6, souls: 4 },
    '9': { main: 7, souls: 1 },
    'de': { main: 8 },
    'ds3': { souls: 2 },
    'sh2': { ps2: 1 },
    'ok': { ps2: 2 },
    'ico': { ps2: 3 },
    'sotc': { ps2: 4 }
  }
  const DONE: Record<string, GameDone> = {
    '2': done(day(yr - 1, 12, 20), 14.5, 11, 'happy'),
    '3': done(day(yr, 3, 29), 86.3, 63, 'love'),
    '6': done(day(yr - 1, 6, 7), 120, 58, 'happy', true),
    '8': done(day(yr, 1, 24), 31, 19, 'love')
  }
  const shelfDemo: Game[] = [
    extra('p2', 'Portal 2', 'pc', 620, 9, { done: done(day(yr - 2, 3, 14), 9, 5, 'love') }),
    extra('ins', 'Inside', 'pc', 304430, 4, { done: done(day(yr - 2, 6, 2), 4, 1, 'happy') }),
    extra('cel', 'Celeste', 'pc', 504230, 31, { done: done(day(yr - 2, 9, 21), 31, 40, 'love', true) }),
    extra('hl2', 'Half-Life 2', 'pc', 220, 14, { done: done(day(yr - 2, 11, 30), 14, 12, 'happy') }),
    extra('w3', 'The Witcher 3: Wild Hunt', 'pc', 292030, 104, { done: done(day(yr - 1, 2, 9), 104, 71, 'love') }),
    extra('had', 'Hades', 'pc', 1145360, 61, { done: done(day(yr - 1, 4, 18), 61, 33, 'love', true) }),
    extra('ow', 'Outer Wilds', 'pc', 753640, 19, { done: done(day(yr - 1, 8, 3), 19, 9, 'love') }),
    extra('cp', 'Cyberpunk 2077', 'pc', 1091500, 58, { done: done(day(yr - 1, 10, 26), 58, 44, 'ok') }),
    extra('bg3', 'Baldur’s Gate 3', 'pc', 1086940, 132, { done: done(day(yr, 6, 14), 132, 77, 'happy') }),
    extra('str', 'Stray', 'pc', 1332010, 6, { done: done(day(yr, 9, 6), 6, 2, 'meh') }),
    extra('er', 'Elden Ring', 'pc', 1245620, 0),
    extra('hk', 'Hollow Knight', 'pc', 367520, 3.5),
    extra('de', 'Disco Elysium', 'pc', 632470, 0),
    extra('ds3', 'Dark Souls III', 'pc', 374320, 0),
    extra('ok', 'Okami', 'ps2', 587620, 0),
    extra('sh2', 'Silent Hill 2', 'ps2', 2124490, 1.2),
    extra('ico', 'ICO', 'ps2', null, 0),
    extra('sotc', 'Shadow of the Colossus', 'ps2', null, 0)
  ]
  // Сюжет по HowLongToBeat, часов — демо для стопки и страницы игры
  const DEMO_HLTB: Record<string, number> = {
    'Death Stranding': 42, Bully: 17, 'Red Dead Redemption 2': 50, 'Ghost of Tsushima': 25, 'Sekiro: Shadows Die Twice': 30,
    'Grand Theft Auto: San Andreas': 32, 'Hellblade: Senua’s Sacrifice': 8, 'God of War': 21, 'The Last of Us': 15, 'Demon’s Souls': 16,
    'Elden Ring': 59, 'Hollow Knight': 27, 'Disco Elysium': 22, 'Dark Souls III': 32, Okami: 33, 'Silent Hill 2': 16, ICO: 7, 'Shadow of the Colossus': 8
  }
  const demoHltb = (g?: Game) => {
    const h = (g && DEMO_HLTB[g.title]) || 14.6
    return { main: h * 3600, plus: h * 5040, full: h * 7200, title: g?.title ?? 'Bully' }
  }
  let state: AppState = {
    games: [
      demo('1', 'Death Stranding', 'pc', 1190460, 2.02, 0),
      demo('2', 'Bully', 'ps2', 12200, 14.5, 1),
      demo('3', 'Red Dead Redemption 2', 'pc', 1174180, 86.3, 3),
      demo('4', 'Ghost of Tsushima', 'pc', 2215430, 41, 9),
      demo('5', 'Sekiro: Shadows Die Twice', 'pc', 814380, 23.4, 20),
      demo('6', 'Grand Theft Auto: San Andreas', 'ps2', 12120, 120, 40),
      demo('7', 'Hellblade: Senua’s Sacrifice', 'pc', 414340, 0),
      demo('8', 'God of War', 'pc', 1593500, 31, 60),
      // PS3 с обложкой — чтобы в превью был виден логотип PS3 на плитке
      demo('10', 'The Last of Us', 'ps3', 1888930, 18.2, 12),
      { ...demo('9', 'Demon’s Souls', 'ps3', 0, 7, 100), cover: undefined, hero: undefined, logo: undefined },
      ...shelfDemo
    ].map((g) => ({ ...g, ...(DONE[g.id] ? { done: DONE[g.id] } : {}), ...(PILES[g.id] ? { pile: PILES[g.id] } : {}) })),
    settings: {
      userName: getLang() === 'en' ? 'Player' : 'Игрок',
      pcsx2Path: 'C:\\Program Files\\PCSX2\\pcsx2-qt.exe',
      pcsx2Args: '-fullscreen -batch -- "{rom}"',
      rpcs3Path: '',
      rpcs3Args: '--no-gui --fullscreen "{rom}"',
      sounds: true,
      volume: 'mid',
      music: false,
      musicVolume: 'mid',
      glyphs: 'auto',
      fullscreen: true,
      launchOnStartup: false,
      trophies: {},
      rpcs3SaveKey: 'Ctrl+S',
      pauseOnOverlay: 'all',
      overlayEnabled: true,
      uiScale: 1,
      steamGridDbKey: '',
      raUser: '',
      raKey: '',
      steamKey: '',
      steamId: '',
      trophyPopups: true,
      dsxLightbar: true,
      trophyRumble: true,
      trophyShots: true,
      animatedCovers: true,
      liveBackground: true,
      screensaver: 5,
      lowBatteryWarning: true,
      gameTint: true,
      displayId: 0,
      displayLabel: '',
      onboarded: new URLSearchParams(location.search).has('welcome') ? false : true,
      betaUpdates: location.search.includes('beta'),
      builds: [
        { id: 'main', name: getLang() === 'en' ? 'Main' : 'Основная' },
        { id: 'souls', name: getLang() === 'en' ? 'Souls marathon' : 'Souls-марафон' },
        { id: 'ps2', name: getLang() === 'en' ? 'Retro PS2' : 'Ретро PS2' }
      ],
      build: 'main',
      figuresSeen: ['finisher', 'perfect', 'explorer', 'astro']
    },
    running: null,
    dataDir: 'C:\\Users\\demo\\AppData\\Roaming\\PlayOS',
    // ?beta — демо на бета-версии: выключение бета-теста предлагает вернуться на стабильную
    version: /[?&](beta|update=rollback)/.test(location.search) ? '1.1.0-beta.2' : '1.0.1'
  }
  const subs = { state: new Set<(s: AppState) => void>(), end: new Set<(e: { gameId: string; duration: number }) => void>() }
  const set = (patch: Partial<AppState>) => {
    state = { ...state, ...patch }
    subs.state.forEach((cb) => cb(state))
  }
  const noop = () => () => {}
  // Облако в демо: вход проходит сразу, сохранения «синхронизированы» несколько минут назад
  let cloud: CloudStatus = { account: null, state: 'off', available: ['yandex', 'google', 'folder'] }
  // Демо состояний облака: ?cloud=full|signin|offline — уже вошли в Яндекс
  const cloudDemo = new URLSearchParams(location.search).get('cloud') as CloudStatus['state'] | null
  if (cloudDemo) cloud = { ...cloud, account: { provider: 'yandex', name: 'Игрок', used: 200 * 2 ** 30, total: 200 * 2 ** 30 }, state: cloudDemo, lastSync: Date.now() - 3600_000 }
  const cloudSubs = new Set<(s: CloudStatus) => void>()
  const stageSubs = new Set<(s: LaunchStage) => void>()
  let skipSync: () => void = () => {}
  const setCloud = (patch: Partial<CloudStatus>) => {
    cloud = { ...cloud, ...patch }
    cloudSubs.forEach((cb) => cb(cloud))
  }
  return {
    getState: async () => state,
    saveGame: async (draft) => {
      // Имитация медленной загрузки арта: прогресс и отмена по ○
      const remote = (['cover', 'hero', 'logo'] as const).filter((f) => draft[f]?.startsWith('http'))
      saveCancelled = false
      for (let step = 1; step <= remote.length; step++) {
        for (let k = 0; k <= 10; k++) {
          if (saveCancelled) throw new Error('cancelled')
          progressSubs.forEach((cb) => cb({ field: remote[step - 1], step, total: remote.length, received: k * 120000, size: 1200000 }))
          await new Promise((r) => setTimeout(r, 250))
        }
      }
      const existing = state.games.find((g) => g.id === draft.id)
      const game: Game = { ...(existing ?? { playtime: 0, addedAt: Date.now(), sessions: [] }), ...draft, id: draft.id ?? String(Date.now()) } as Game
      set({ games: existing ? state.games.map((g) => (g.id === game.id ? game : g)) : [...state.games, game] })
      return game
    },
    deleteGame: async (id) => set({ games: state.games.filter((g) => g.id !== id) }),
    uninstallInfo: async (id) => {
      await new Promise((r) => setTimeout(r, 500))
      const g = state.games.find((x) => x.id === id)
      if (!g) return null
      const files = await api.gameFiles(id)
      // Демо: игры Steam удаляет Steam, PC — программа удаления, образы — в корзину
      const method = g.launcher === 'steam' ? 'steam' : g.platform === 'pc' ? 'uninstaller' : 'files'
      return { method, path: g.platform === 'pc' ? g.path.replace(/\\[^\\]+$/, '') : g.path, isFile: g.platform !== 'pc', size: files?.size ?? null }
    },
    uninstallGame: async (id, opts) => {
      await new Promise((r) => setTimeout(r, 900))
      const g = state.games.find((x) => x.id === id)
      if (!g) return { ok: false }
      if (g.platform === 'pc' && g.launcher !== 'steam') return { ok: true, started: 'uninstaller' }
      if (g.launcher === 'steam') return { ok: true, started: 'steam' }
      // Демо: образ PS3 «не влезает» в корзину — видно второй вопрос
      if (g.platform === 'ps3' && !opts.permanent) return { ok: false, noTrash: true }
      set({ games: opts.keep ? state.games.map((x) => (x.id === id ? { ...x, path: '' } : x)) : state.games.filter((x) => x.id !== id) })
      return { ok: true }
    },
    setFavorite: async (id, value) => set({ games: state.games.map((g) => (g.id === id ? { ...g, favorite: value } : g)) }),
    shelfPatch: async (changes) =>
      set({
        games: state.games.map((g) => {
          const c = changes.find((x) => x.id === g.id)
          if (!c) return g
          const next = { ...g }
          if (c.done !== undefined) {
            if (c.done) next.done = c.done
            else delete next.done
          }
          if (c.pile !== undefined) {
            if (c.pile) next.pile = c.pile
            else delete next.pile
          }
          return next
        })
      }),
    resetPlaytime: async (id) => set({ games: state.games.map((g) => (g.id === id ? { ...g, playtime: 0 } : g)) }),
    saveSettings: async (patch) => {
      set({ settings: { ...state.settings, ...patch } })
      return state.settings
    },
    launch: async (id) => {
      // ?launchsync — запуск ждёт облако, пока не нажмут «Играть без ожидания» (или 8 с)
      if (new URLSearchParams(location.search).has('launchsync')) {
        stageSubs.forEach((cb) => cb({ id, stage: 'sync' }))
        await new Promise<void>((r) => {
          skipSync = r
          setTimeout(r, 8000)
        })
        stageSubs.forEach((cb) => cb({ id, stage: 'start' }))
      }
      set({ running: { gameId: id, startedAt: Date.now(), phase: 'launching' } })
      setTimeout(() => state.running && set({ running: { ...state.running, phase: 'running' } }), 2500)
      return { ok: true }
    },
    cancelLaunch: async () => {
      skipSync()
      set({ running: null })
    },
    skipLaunchSync: async () => skipSync(),
    onLaunchStage: (cb) => {
      stageSubs.add(cb)
      return () => stageSubs.delete(cb)
    },
    closeGame: async () => {
      const r = state.running
      if (!r) return
      const duration = Math.round((Date.now() - r.startedAt) / 1000)
      set({
        running: null,
        games: state.games.map((g) => (g.id === r.gameId ? { ...g, playtime: g.playtime + duration, lastPlayed: Date.now() } : g))
      })
      subs.end.forEach((cb) => cb({ gameId: r.gameId, duration }))
    },
    resumeGame: async () => {},
    hideOverlay: async () => {},
    pickFile: async (kind) =>
      kind === 'image'
        ? null
        : kind === 'backup'
          ? 'C:\\Users\\demo\\Desktop\\PlayOS-копия.playos'
          : kind === 'gamefolder' || kind === 'folder'
            ? 'C:\\Games\\Demo Game'
            : 'C:\\Games\\Demo Game\\DemoGame.exe',
    inspect: async () => ({ title: 'Demo Game' }),
    findGameExe: async (dir) => {
      await new Promise((r) => setTimeout(r, 600))
      return `${dir}\\bin\\x64\\DemoGame.exe`
    },
    searchArt: async (query) => {
      await new Promise((r) => setTimeout(r, 700))
      const ids: [number, string][] = [
        [12200, 'Bully: Scholarship Edition'],
        [1174180, 'Red Dead Redemption 2'],
        [1190460, 'Death Stranding'],
        [814380, 'Sekiro']
      ]
      return ids
        .filter(([, t]) => !query || t.toLowerCase().includes(query.toLowerCase().slice(0, 3)) || true)
        .map(
          ([id, title]): ArtCandidate => ({
            key: String(id),
            source: 'steam',
            title,
            cover: steam(id, 'library_600x900_2x.jpg'),
            hero: steam(id, 'library_hero.jpg'),
            logo: steam(id, 'logo.png')
          })
        )
    },
    scanPs2Folder: async () => 0,
    importRpcs3: async () => 0,
    openFolder: async () => {},
    power: async () => {},
    onState: (cb) => {
      subs.state.add(cb)
      return () => subs.state.delete(cb)
    },
    onPad: noop,
    onOverlay: (cb) => {
      // Для превью в браузере: window.__pcsMock.overlay({ open: true })
      ;(window as unknown as { __pcsMock: object }).__pcsMock = { overlay: cb }
      return () => {}
    },
    onSessionEnd: (cb) => {
      subs.end.add(cb)
      return () => subs.end.delete(cb)
    },
    onToast: noop,
    onPadStatus: () => () => {},
    onPadBlock: () => () => {},
    padRumble: noop,
    // ?windowed — показать окно вне полного экрана с рамкой и кнопками
    onWindowMode: (cb) => {
      if (!/[?&]windowed/.test(location.search)) return () => {}
      windowModeCb = cb
      setTimeout(() => cb(demoWindow))
      return () => (windowModeCb = null)
    },
    windowControl: async (action) => {
      if (action === 'maximize') demoWindow = { ...demoWindow, maximized: !demoWindow.maximized }
      else if (action === 'fullscreen') demoWindow = { ...demoWindow, fullscreen: true }
      else return
      windowModeCb?.(demoWindow)
    },
    getPadStatus: async () => ({ connected: 1, battery: 'medium' }),
    emuState: async () => ({
      mode: 'pine',
      platform: 'ps2',
      current: 1,
      canLoad: true,
      paused: true,
      slots: Array.from({ length: 10 }, (_, i) => ({
        slot: i + 1,
        time: i < 3 ? Date.now() - i * 5400000 : undefined,
        thumb: i < 3 ? steam(12200, ['header.jpg', 'library_hero.jpg', 'capsule_616x353.jpg'][i]) : undefined
      }))
    }),
    saveState: async (slot) => ({ ok: true, message: `Сохранено в слот ${slot}` }),
    loadState: async (slot) => ({ ok: true, message: `Загружен слот ${slot}`, resumed: true }),
    overlayHome: async () => {},
    pcsx2Info: async () => ({ found: true, dataDir: 'E:\\Users\\demo\\Documents\\PCSX2', pine: 'disabled', saveKey: 'F1', loadKey: 'F3' }),
    enablePine: async () => ({ ok: true, message: 'PINE включён' }),
    systemState: async () => sys,
    setVolume: async (v) => ((sys = { ...sys, volume: v, muted: false }), sys),
    setMute: async (m) => ((sys = { ...sys, muted: m }), sys),
    setAudioDevice: async (id) => ((sys = { ...sys, devices: sys.devices.map((d) => ({ ...d, default: d.id === id })) }), sys),
    setBrightness: async (v) => ((sys = { ...sys, brightness: v }), sys),
    controllers: async () => [
      { id: 'dsx', name: 'DualSense', kind: 'dualsense', via: 'DSX, Bluetooth', battery: 'full', percent: 90 },
      { id: 'x1', name: 'Геймпад Xbox 2', kind: 'xbox', via: 'XInput', battery: 'low' }
    ],
    achievements: async (gameId) => {
      await new Promise((r) => setTimeout(r, 400))
      if (gameId === '9') return { needs: 'unsupported', error: 'Для игр PS3 трофеи пока недоступны: RetroAchievements не поддерживает PS3.' }
      return { set: demoTrophies() }
    },
    achievementSummary: async () => ({ '1': { source: 'steam', earned: 18, total: 59 }, '2': { source: 'ra', earned: 7, total: 50 } }),
    findRaGames: async () => [{ id: 2768, title: 'Bully', achievements: 50 }, { id: 2770, title: 'Canis Canem Edit', achievements: 50 }],
    linkRaGame: async () => ({ set: demoTrophies() }),
    testTrophyAccounts: async () => {
      await new Promise((r) => setTimeout(r, 600))
      const s = state.settings
      return {
        ra: s.raUser && s.raKey ? { state: 'ok', text: `Подключено: ${s.raUser}, 1250 очков` } : { state: 'off', text: 'Не настроено' },
        steam: s.steamKey && s.steamId ? { state: 'ok', text: 'Подключено: Player' } : { state: 'off', text: 'Не настроено' }
      }
    },
    // Демо: «открыли страницу» — через 3 секунды будто скопировали ключ
    openKeyPage: async () => {
      keyPageOpened = true
    },
    watchKeyClipboard: async (kind) => {
      clearTimeout(keyTimer)
      if (!kind) return
      keyTimer = setTimeout(function tick() {
        if (!keyPageOpened) return void (keyTimer = setTimeout(tick, 500))
        keyPageOpened = false
        keySubs.forEach((cb) => cb({ kind, key: kind === 'ra' ? 'aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY' : '0F1E2D3C4B5A69788796A5B4C3D2E1F0' }))
      }, 3000)
    },
    keyFromClipboard: async () => null,
    onKeyFound: (cb) => {
      keySubs.add(cb)
      return () => keySubs.delete(cb)
    },
    localAccounts: async () => ({ steam: { id: '76561198012345678', name: 'Player' }, raUser: 'Player' }),
    onAchievements: noop,
    onAchievementSummary: noop,
    onOverlayToast: (cb) => {
      ;(window as unknown as { __pcsToast: typeof cb }).__pcsToast = cb
      return () => {}
    },
    cancelSave: async () => {
      saveCancelled = true
    },
    onSaveProgress: (cb) => {
      progressSubs.add(cb)
      return () => progressSubs.delete(cb)
    },
    onPowerResume: noop,
    systemInfo: async () => ({
      app: { version: '1.0.1', electron: '44.9.3', chrome: '152.0', installDir: 'E:\\PlayOS', dataDir: 'C:\\Users\\demo\\AppData\\Roaming\\PlayOS', packaged: true },
      os: { name: 'Windows 11 Pro', build: '10.0.26300', uptimeMin: 446 },
      cpu: { model: 'AMD Ryzen 5 5600X 6-Core Processor', threads: 12 },
      gpu: 'NVIDIA GeForce RTX 3060 Ti',
      memory: { total: 17_062_000_000, free: 3_900_000_000 },
      disks: [
        { name: 'C:', total: 500_000_000_000, free: 118_000_000_000 },
        { name: 'D:', total: 1_000_000_000_000, free: 412_000_000_000 },
        { name: 'E:', total: 2_000_000_000_000, free: 1_310_000_000_000 }
      ],
      displays: [
        { name: 'AF24H1', width: 1920, height: 1080, hz: 144, primary: true, current: true },
        { name: 'Q27B3MA', width: 2560, height: 1440, hz: 60, primary: false, current: false }
      ],
      pads: [{ name: 'DualSense', kind: 'dualsense', via: 'DSX, Bluetooth', percent: 90, battery: 'full' }],
      library: { games: 10, hours: 343.4, artBytes: 48_000_000, videoBytes: 31_000_000, totalBytes: 142_000_000 }
    }),
    pathExists: async (p) => /pcsx2/i.test(p),
    updateState: async () => ({ phase: 'idle', current: '1.0.1' }),
    checkUpdates: async () => {
      await new Promise((r) => setTimeout(r, 1200))
      return { phase: 'ready', current: '1.0.1', version: '1.0.2', percent: 100, notes: 'Быстрее запуск\nИсправлена прокрутка профиля' }
    },
    // Демо: «установка» идёт несколько секунд, потом страница перезапускается, как PlayOS после обновления
    installUpdate: async () => {
      setTimeout(() => {
        try {
          sessionStorage.setItem('playos-demo-updated', '1.0.2')
        } catch {
          /* без хранилища перезапуск пройдёт без экрана «готово» */
        }
        location.reload()
      }, 6000)
      return true
    },
    updateShown: () => {},
    // ?update в адресе — показать скачивание и окно «готово» на демо-данных;
    // ?update=minor | critical — обновление только с исправлениями, ?update=old — релиз без сводки,
    // ?update=rollback — возврат с беты на стабильную
    onUpdateState: (cb) => {
      const mode = new URLSearchParams(location.search).get('update')
      if (mode === null) return () => {}
      const notes = '• Копия данных одним файлом\n• Восстановление на другом компьютере\n• Окно «О системе» помещается на 1080p'
      const fixes = {
        ru: { fixed: ['Прокрутка профиля доходит до конца', 'Геймпад не теряется после сна'] },
        en: { fixed: ['Profile scrolling reaches the end', 'The gamepad stays connected after sleep'] }
      }
      const vr = {
        importance: 'normal' as const,
        ru: {
          new: [
            'VR-игры для Meta Quest по кабелю Link и по Air Link: отметьте игру как VR, остальное PlayOS подготовит сам',
            'Свои настройки VR у каждой игры: чёткость, руки, вибрация, режим совместимости',
            'Заряд шлема и контроллеров в верхней панели',
            'Раздел VR в настройках и фильтр VR в библиотеке'
          ],
          fixed: ['Half-Life: Alyx и другие игры на Source 2 добавляются с правильным файлом запуска']
        },
        en: {
          new: [
            'VR games for Meta Quest over Link cable and Air Link: mark a game as VR and PlayOS prepares the rest',
            'Per-game VR settings: sharpness, hands, vibration, compatibility mode',
            'Headset and controller battery in the top bar',
            'VR section in Settings and a VR filter in the Library'
          ],
          fixed: ['Half-Life: Alyx and other Source 2 games are added with the right launch file']
        }
      }
      const small = mode === 'minor' || mode === 'critical'
      const summary = mode === 'old' ? undefined : small ? { importance: mode as 'minor' | 'critical', ...fixes } : vr
      const rollback = mode === 'rollback'
      const version = rollback ? '1.0.4' : small ? '1.0.5' : '1.1.0-beta.1'
      const current = rollback ? '1.1.0-beta.2' : '1.0.4'
      let p = 0
      const t = setInterval(() => {
        p = Math.min(100, p + 9)
        const total = 118 * 2 ** 20
        cb(p < 100
          ? { phase: 'downloading', current, version, rollback, percent: p, transferred: (total * p) / 100, total }
          : { phase: 'ready', current, version, rollback, percent: 100, notes, summary })
        if (p >= 100) clearInterval(t)
      }, 700)
      return () => clearInterval(t)
    },
    saveReport: async () => 'C:\\Users\\demo\\AppData\\Roaming\\PlayOS\\reports\\PlayOS-отчёт.txt',
    exportData: async () => 'C:\\Users\\demo\\Desktop\\PlayOS-копия-2026-10-21_12-00.playos',
    inspectBackup: async () => ({ version: '1.0.1', createdAt: Date.now() - 86400_000, games: 9 }),
    importData: async () => true,
    displays: async () => ({
      list: [
        { id: 1, name: 'Q27B3MA', width: 2560, height: 1440, primary: true },
        { id: 2, name: 'Samsung TV', width: 3840, height: 2160, primary: false }
      ],
      current: 1
    }),
    onOverlayNotice: (cb) => {
      ;(window as unknown as { __pcsNotice: typeof cb }).__pcsNotice = cb
      return () => {}
    },
    cloudStatus: async () => cloud,
    onCloudStatus: (cb) => {
      cloudSubs.add(cb)
      return () => cloudSubs.delete(cb)
    },
    cloudSignIn: async (provider, folder) => {
      if (provider !== 'folder') {
        setCloud({ pending: { url: provider === 'google' ? 'https://www.google.com/device' : 'https://ya.ru/device', code: provider === 'google' ? 'QWRT-XYZP' : 'KQ7-PX2', expiresAt: Date.now() + 300_000 } })
        setTimeout(
          () =>
            setCloud({
              pending: undefined,
              account: { provider, name: 'Игрок', used: 41 * 2 ** 30, total: 200 * 2 ** 30 },
              state: 'synced',
              lastSync: Date.now(),
              // В облаке уже есть профиль с другого ПК — демо предложения восстановить
              restore: { name: 'Игрок', device: 'DESKTOP-LIVING', at: Date.now() - 2 * 86_400_000, games: 14, merge: true }
            }),
          4000
        )
      } else setCloud({ account: { provider, name: folder ?? 'D:\OneDrive', used: 120 * 2 ** 30, total: 1024 * 2 ** 30 }, state: 'synced', lastSync: Date.now() })
      return cloud
    },
    cloudCancelSignIn: async () => setCloud({ pending: undefined }),
    cloudSignOut: async () => setCloud({ account: null, state: 'off', lastSync: undefined }),
    // ?cloudbusy — перед выходом есть что дождаться (3 с)
    cloudPending: async () => new URLSearchParams(location.search).has('cloudbusy'),
    cloudFlush: () => new Promise<void>((r) => setTimeout(r, 3000)),
    cloudSyncNow: async () => {
      setCloud({ state: 'syncing' })
      await new Promise((r) => setTimeout(r, 1200))
      setCloud({ state: 'synced', lastSync: Date.now() })
      return cloud
    },
    gameCloud: async (gameId) => {
      const g = state.games.find((x) => x.id === gameId)
      if (!cloud.account || !state.settings.cloud?.saves) return { state: 'off' }
      if (!g) return { state: 'nosaves' }
      if (g.launcher === 'steam') return { state: 'steam' }
      return { state: 'synced', lastSync: Date.now() - 6 * 60_000, size: (Number(g.id) % 5) * 3.1 * 2 ** 20 + 180 * 2 ** 10 }
    },
    cloudResolve: async () => {},
    cloudVersions: async () => {
      const now = Date.now()
      return [0, 1, 2].map((i) => ({ name: `v${i}`, at: now - (i * 26 + 1) * 3600_000, device: i === 1 ? 'DESKTOP-LIVING' : 'GAMING-PC', size: (2.4 - i * 0.3) * 2 ** 20, hash: `${i}`.repeat(16) }))
    },
    cloudRestore: async () => {},
    cloudRestoreChoice: async () => setCloud({ restore: undefined }),
    gameFiles: async (gameId) => {
      const g = state.games.find((x) => x.id === gameId)
      // Как в main: у игры без файла на этом ПК локальных файлов нет
      if (!g?.path) return null
      // Демо: правдоподобный вес — PC-игры десятки ГБ, образы PS2 несколько ГБ
      const gb = g.platform === 'pc' ? 20 + (Number(g.id) * 7.3) % 90 : g.platform === 'ps2' ? 2 + (Number(g.id) % 3) * 1.4 : 12 + Number(g.id) % 9
      return { path: g.path, isFile: g.platform === 'ps2', size: Math.round(gb * 2 ** 30) }
    },
    savePreview: async (draft) => {
      if (draft.launcher === 'steam') return { files: 0, registry: false, skipped: 'steam' }
      if (draft.cloudSaves === false) return { files: 0, registry: false, skipped: 'off' }
      if (draft.platform === 'ps2') return { dir: 'C:\\Users\\Player\\Documents\\PCSX2\\memcards', files: 1, registry: false }
      return { dir: `C:\\Users\\Player\\Documents\\${draft.title}\\Saves`, files: 6, registry: false, appId: draft.steamAppId ? undefined : 1174180 }
    },
    gameDetails: async (gameId) => {
      await new Promise((r) => setTimeout(r, 500))
      const g = state.games.find((x) => x.id === gameId)
      // Демо-описания на языке интерфейса, как у настоящего Steam
      const en = getLang() === 'en'
      if (g?.title === 'Red Dead Redemption 2' && en) {
        return {
          description:
            'America, 1899. The end of the Wild West era has begun. After a robbery goes badly wrong, Arthur Morgan and the Van der Linde gang are forced to flee, with federal agents and the best bounty hunters in the nation on their heels.',
          developer: 'Rockstar Games',
          publisher: 'Rockstar Games',
          released: 'Dec 5, 2019',
          genres: ['Action', 'Adventure'],
          source: 'steam',
          hltb: { main: 181800, plus: 295200, full: 633600, title: 'Red Dead Redemption 2' }
        }
      }
      if (g?.title === 'Red Dead Redemption 2') {
        return {
          description:
            'Америка, 1899 год. Эпоха Дикого Запада подходит к концу. После неудачного ограбления Артур Морган и банда Датча ван дер Линде вынуждены бежать: по их следу идут федеральные агенты и лучшие охотники за головами.',
          developer: 'Rockstar Games',
          publisher: 'Rockstar Games',
          released: '5 дек. 2019 г.',
          genres: ['Экшены', 'Приключенческие игры'],
          source: 'steam',
          hltb: { main: 181800, plus: 295200, full: 633600, title: 'Red Dead Redemption 2' }
        }
      }
      if (en) {
        return {
          description:
            'Fifteen-year-old troublemaker Jimmy Hopkins is dumped at Bullworth Academy, the most rotten school around. To survive, he has to stand up to bullies, jocks, nerds and preppies, and deal with the teachers too.',
          developer: 'Rockstar Vancouver',
          publisher: 'Rockstar Games',
          released: 'Oct 24, 2008',
          genres: ['Action', 'Adventure'],
          source: 'steam',
          hltb: demoHltb(g)
        }
      }
      return {
        description:
          'Джимми Хопкинс, 15-летний бунтарь, попадает в академию Буллворт — самую неблагополучную школу в стране. Чтобы выжить, ему предстоит постоять за себя перед хулиганами, качками, зубрилами и мажорами, а заодно разобраться с учителями.',
        developer: 'Rockstar Vancouver',
        publisher: 'Rockstar Games',
        released: '24 окт. 2008 г.',
        genres: ['Экшены', 'Приключенческие игры'],
        source: 'steam',
        hltb: demoHltb(g)
      }
    },
    liveBackground: async () => null,
    scanSteam: async () => {
      await new Promise((r) => setTimeout(r, 600))
      const lib = (dir: string) => `E:\\SteamLibrary\\steamapps\\common\\${dir}`
      const list: SteamLibraryGame[] = [
        { appId: 730, name: 'Counter-Strike 2', dir: lib('Counter-Strike Global Offensive'), sizeOnDisk: 73918888730, lastPlayed: Date.now() - 86400000, added: false },
        { appId: 284160, name: 'BeamNG.drive', dir: lib('BeamNG.drive'), sizeOnDisk: 53633513758, lastPlayed: Date.now() - 5 * 86400000, added: false },
        { appId: 1100990, name: 'Hellblade: Senua’s Sacrifice', dir: lib('Hellblade'), sizeOnDisk: 3317636264, added: true },
        { appId: 431960, name: 'Wallpaper Engine', dir: lib('wallpaper_engine'), sizeOnDisk: 826275581, added: false, software: true },
        { appId: 892970, name: 'Valheim', dir: lib('Valheim'), sizeOnDisk: 4542501427, added: false }
      ]
      return list
    },
    importSteam: async (appIds) => {
      for (let i = 0; i < appIds.length; i++) {
        importSubs.forEach((cb) => cb({ done: i, total: appIds.length, title: `Игра ${appIds[i]}` }))
        await new Promise((r) => setTimeout(r, 700))
      }
      importSubs.forEach((cb) => cb({ done: appIds.length, total: appIds.length, title: '' }))
      return appIds.length
    },
    onImportProgress: (cb) => {
      importSubs.add(cb)
      return () => importSubs.delete(cb)
    },
    // Магазин: витрина из известных игр Steam (арт по старым путям CDN), ?store=offline — Steam не ответил
    storeHome: async () => {
      await new Promise((r) => setTimeout(r, 400))
      if (new URLSearchParams(location.search).get('store') === 'offline') throw new Error('offline')
      return demoStoreHome()
    },
    onStoreHome: noop,
    // Демо каталога: игры Steam из витрины; метки в демо не сужают, год, отзывы и «Можно скачать» — по-настоящему
    storeBrowse: async (q) => {
      await new Promise((r) => setTimeout(r, q.year || q.decade ? 900 : 400))
      const seen = new Set<number>()
      let list = demoStoreHome()
        .rows.flatMap((r) => r.items)
        .filter((i) => i.appId > 0 && !i.upcoming && !seen.has(i.appId) && !!seen.add(i.appId))
      const yearOf = (i: StoreItem) => (i.released ? new Date(i.released).getUTCFullYear() : 0)
      if (q.year) list = list.filter((i) => yearOf(i) === q.year)
      else if (q.decade) list = list.filter((i) => yearOf(i) >= q.decade! && yearOf(i) <= q.decade! + 9)
      if (q.reviews) list = list.filter((i) => (i.reviews?.percent ?? 0) >= q.reviews!)
      if (q.minReviews) list = list.filter((i) => (i.reviews?.count ?? 0) >= q.minReviews!)
      if (q.downloadable) list = list.filter((i) => i.options)
      const by = q.year || q.decade ? 'date' : q.sort
      if (by === 'name') list.sort((a, b) => a.title.localeCompare(b.title))
      else if (by === 'reviews') list.sort((a, b) => (b.reviews?.percent ?? 0) - (a.reviews?.percent ?? 0))
      else if (by === 'new' || by === 'date') list.sort((a, b) => (b.released ?? 0) - (a.released ?? 0))
      const page = list.slice(q.start, q.start + 48)
      const exact = !q.reviews && !q.minReviews && !q.downloadable && !q.ruText && !q.ruVoice
      return { items: page, ...(exact ? { total: list.length } : {}), ...(q.start + 48 < list.length ? { next: q.start + 48 } : {}) }
    },
    storeTagInfo: async (ids) => {
      const en = getLang() === 'en'
      return Object.fromEntries(ids.map((id) => [id, { name: DEMO_TAGS[id]?.[en ? 1 : 0] ?? String(id), count: 300 + ((id * 7919) % 24000) }]))
    },
    storeSearch: async (q) => {
      await new Promise((r) => setTimeout(r, 300))
      const all = [...demoStoreHome().rows.flatMap((r) => r.items), ...demoDecorate(DEMO_SRC)]
      const seen = new Set<number>()
      return demoDecorate(all.filter((i) => i.title.toLowerCase().includes(q.trim().toLowerCase()) && !seen.has(i.appId) && seen.add(i.appId)))
    },
    storePage: async (appId) => {
      await new Promise((r) => setTimeout(r, 500))
      const item = [...demoStoreHome().rows.flatMap((r) => r.items), ...demoDecorate(DEMO_SRC)].find((i) => i.appId === appId)
      if (!item) return null
      const en = getLang() === 'en'
      // Игра GOG — описание из GOG, игра только из источников — из Википедии (в демо придуманное)
      if (item.store) {
        const text =
          item.store === 'gog'
            ? en
              ? 'A demo description: for GOG games PlayOS shows the text from the GOG page.'
              : 'Демо-описание: у игр GOG PlayOS показывает текст со страницы GOG.'
            : en
              ? 'A demo description: for games that only your sources know, PlayOS takes the summary from Wikipedia.'
              : 'Демо-описание: у игр, о которых знают только ваши источники, PlayOS берёт краткое описание из Википедии.'
        return {
          ...item,
          about: [{ kind: 'p', text }],
          developers: item.store === 'gog' ? ['Demo Studio'] : [],
          publishers: item.store === 'gog' ? ['Demo Publisher'] : [],
          screenshots: item.hero ? [{ thumb: item.hero, full: item.hero }] : []
        }
      }
      // Демо: превью — маленькая шапка, полный размер — широкий арт, чтобы было видно ленивую подгрузку
      const shots = ['library_hero.jpg', 'header.jpg', 'capsule_616x353.jpg', 'page_bg_generated_v6b.jpg', 'library_hero.jpg', 'header.jpg'].map((f, i) => ({
        thumb: steam(appId, i % 2 ? f : 'capsule_231x87.jpg'),
        full: steam(appId, f)
      }))
      return {
        ...demoDecorate([item])[0],
        about: en
          ? [
              { kind: 'p', text: 'A demo description: in PlayOS the store shows the full text from the Steam page, split into headings, paragraphs and lists.' },
              { kind: 'h', text: 'A huge world' },
              { kind: 'p', text: 'Explore dozens of places, meet characters and choose how the story goes.' },
              { kind: 'h', text: 'Your way to play' },
              { kind: 'li', text: 'Story campaign for one player' },
              { kind: 'li', text: 'Co-op with friends' },
              { kind: 'li', text: 'Photo mode' },
              { kind: 'p', text: 'Read on with the pad: every paragraph gets focus, the page scrolls by itself.' }
            ]
          : [
              { kind: 'p', text: 'Демо-описание: в PlayOS магазин показывает полный текст со страницы Steam — с заголовками, абзацами и списками.' },
              { kind: 'h', text: 'Огромный мир' },
              { kind: 'p', text: 'Исследуйте десятки мест, знакомьтесь с персонажами и решайте, как пойдёт история.' },
              { kind: 'h', text: 'Играйте по-своему' },
              { kind: 'li', text: 'Сюжетная кампания для одного игрока' },
              { kind: 'li', text: 'Кооператив с друзьями' },
              { kind: 'li', text: 'Фоторежим' },
              { kind: 'p', text: 'Дальше читается геймпадом: каждый абзац получает фокус, страница прокручивается сама.' }
            ],
        developers: ['Demo Studio'],
        publishers: ['Demo Publisher'],
        franchise: item.title.split(/[:\s]/)[0],
        screenshots: shots
      }
    },
    storeOptionCount: async (appId) => {
      await new Promise((r) => setTimeout(r, 900))
      return demoOptionsFor(appId).length
    },
    storeHltb: async (_appId, title) => {
      await new Promise((r) => setTimeout(r, 700))
      return { main: 52718, plus: 69031, full: 99768, title }
    },
    // Demo: Steam стоит, Counter-Strike 2 уже на диске (можно добавить в библиотеку)
    storeSteam: async () => ({ client: true, installed: [730] }),
    storeOpen: async () => {},
    // Демо: игра магазина в библиотеку без файлов — арт прямо ссылками
    storeAddToLibrary: async (appId, title) => {
      await new Promise((r) => setTimeout(r, 600))
      // Как main: своя игра с тем же названием — та же игра, привязываем к странице магазина
      const have = libraryMatch(state.games, appId, title)
      if (have) {
        if (!have.steamAppId && appId > 0) set({ games: state.games.map((g) => (g.id === have.id ? { ...g, steamAppId: appId } : g)) })
        return have.id
      }
      const it = [...demoStoreRows().rows.flatMap((r) => r.items), ...DEMO_SRC].find((i) => i.appId === appId)
      // Игра GOG или только из источников — без Steam AppID
      const game: Game = { id: `store-${appId}`, title: it?.title ?? title, platform: 'pc', path: '', ...(appId > 0 ? { steamAppId: appId } : {}), cover: it?.cover, hero: it?.hero, logo: it?.logo, playtime: 0, addedAt: Date.now(), sessions: [] }
      set({ games: [...state.games, game] })
      return game.id
    },
    storeSources: async () => demoSources,
    // Демо: любая ссылка становится источником с бесплатными играми; настоящие файлы не скачиваются
    storeSourceAdd: async (url) => {
      await new Promise((r) => setTimeout(r, 900))
      if (!/^https?:\/\//i.test(url)) return { error: 'Нужна ссылка, которая начинается с http:// или https://' }
      if (demoSources.some((s) => s.url === url)) return { error: 'Этот источник уже добавлен' }
      const source: StoreSource = { id: String(Date.now()), url, name: new URL(url).hostname, addedAt: Date.now(), updatedAt: Date.now(), count: DEMO_FREE.length, games: 4 }
      demoSources = [...demoSources, source]
      return { source }
    },
    // Демо: «выбранный» или перетащенный файл — тоже источник с бесплатными играми
    storeSourceAddFile: async () => demoFileSource('gog.json'),
    storeSourceAddPath: async (file) => demoFileSource(file),
    // В браузере у файла нет пути на диске — берём имя
    pathForFile: (file) => file.name,
    storeSourceRefresh: async (id) => {
      await new Promise((r) => setTimeout(r, 700))
      demoSources = demoSources.map((s) => (s.id === id ? { ...s, updatedAt: Date.now(), error: undefined } : s))
      return demoSources
    },
    storeClipboardUrl: async () => 'https://example.invalid/my-source.json',
    storeSourceRemove: async (id) => {
      demoSources = demoSources.filter((s) => s.id !== id)
    },
    storeSourcesRefresh: async () => {
      await new Promise((r) => setTimeout(r, 900))
      demoSources = demoSources.map((s) => ({ ...s, updatedAt: Date.now() }))
      return demoSources
    },
    storeOptions: async (appId, title, platform) => {
      await new Promise((r) => setTimeout(r, 250))
      return platform === 'ps2' || platform === 'ps3' ? demoEmuOptions(title, platform) : demoOptionsFor(appId)
    },
    storeUnbind: async (appId, key) => {
      demoUnbound.add(`${appId}:${key}`)
    },
    storeLink: async () => {},
    // Загрузки в демо: прогресс идёт сам, прямые ссылки «качаются» за полминуты, торренты — как в PlayOS, пока нельзя
    downloads: async () => demoJobs,
    downloadKinds: async () => ['http', 'magnet', 'torrent'],
    onDownloads: (cb) => {
      jobSubs.add(cb)
      return () => void jobSubs.delete(cb)
    },
    downloadStart: async (req) => {
      await new Promise((r) => setTimeout(r, 300))
      if (!demoFolders.includes(req.folder)) return { error: 'Этой папки нет в списке папок для загрузок' }
      const job: DownloadJob = { id: String(Date.now()), gameId: req.gameId, title: req.title, name: req.name, cover: req.cover, hero: req.hero, kind: req.kind, uris: req.uris, dir: `${req.folder}\\${req.title}`, status: 'queued', received: 0, size: 6 * 2 ** 30, addedAt: Date.now() }
      demoJobs = [...demoJobs, job]
      demoFolders = [req.folder, ...demoFolders.filter((f) => f !== req.folder)]
      set({ settings: { ...state.settings, downloadDirs: demoFolders } })
      demoPump()
      return { job }
    },
    downloadControl: async (id, action) => {
      const job = demoJobs.find((j) => j.id === id)
      if (action === 'clearDone') demoJobs = demoJobs.filter((j) => j.status !== 'done' || (j.install && j.install !== 'installed'))
      else if (!job || action === 'folder') return
      else if (action === 'pause') job.status = 'paused'
      else if (action === 'resume') job.status = 'queued'
      else if (action === 'install') {
        // Демо-установщик: три секунды, потом игра в библиотеке
        job.install = 'running'
        setTimeout(() => {
          Object.assign(job, { install: 'installed' })
          demoJobs = [...demoJobs]
          jobSubs.forEach((cb) => cb(demoJobs))
        }, 3000)
      }
      else if (action === 'up' || action === 'down') {
        // Как в PlayOS: меняемся с соседом среди ждущих
        const line = demoJobs.filter((j) => j.status !== 'done' && j.status !== 'active')
        const k = line.indexOf(job) + (action === 'up' ? -1 : 1)
        if (k >= 0 && k < line.length) {
          const a = demoJobs.indexOf(job)
          const b = demoJobs.indexOf(line[k])
          demoJobs[a] = line[k]
          demoJobs[b] = job
        }
      } else if (action === 'now') {
        // Первой в очереди, текущая уступает
        const cur = demoJobs.find((j) => j.status === 'active')
        if (cur) Object.assign(cur, { status: 'queued', speed: undefined })
        job.status = 'active'
        job.error = undefined
        demoJobs = [job, ...demoJobs.filter((j) => j !== job)]
      } else if (action === 'stopSeed') Object.assign(job, { seeding: undefined, upSpeed: undefined })
      else demoJobs = demoJobs.filter((j) => j !== job)
      if (job) job.speed = undefined
      demoPump()
    },
    // Демо: файлы раздачи как у репаков — установщик, части данных и необязательные озвучки с бонусами
    downloadFiles: async (id) => {
      const job = demoJobs.find((j) => j.id === id)
      if (!job?.fileCount) return null
      return { files: demoTorrentFiles(job.title), skip: job.skip ?? [] }
    },
    downloadSetFiles: async (id, skip) => {
      const job = demoJobs.find((j) => j.id === id)
      if (!job) return
      const off = new Set(skip)
      job.skip = skip.length ? skip : undefined
      job.size = demoTorrentFiles(job.title).reduce((n, f) => n + (off.has(f.i) ? 0 : f.s), 0)
      demoJobs = [...demoJobs]
      jobSubs.forEach((cb) => cb(demoJobs))
    },
    // Демо: любой пароль подходит
    downloadPassword: async (id) => {
      const job = demoJobs.find((j) => j.id === id)
      if (!job || job.status !== 'error') return
      Object.assign(job, { status: 'queued', needPassword: undefined, error: undefined })
      demoPump()
    },
    downloadFolders: async () => demoFolders.map((path, i) => ({ path, free: (812 - i * 300) * 2 ** 30, total: 931 * 2 ** 30, ok: true })),
    downloadDrives: async () => [
      { root: 'C:\\', free: 100 * 2 ** 30, total: 465 * 2 ** 30 },
      { root: 'D:\\', free: 812 * 2 ** 30, total: 931 * 2 ** 30 }
    ],
    downloadFolderAdd: async (path) => {
      await new Promise((r) => setTimeout(r, 300))
      demoFolders = [path, ...demoFolders.filter((f) => f !== path)]
      set({ settings: { ...state.settings, downloadDirs: demoFolders } })
      return { folder: { path, free: 812 * 2 ** 30, total: 931 * 2 ** 30, ok: true } }
    },
    downloadFolderBrowse: async () => 'D:\\Games',
    downloadFolderRemove: async (path) => {
      demoFolders = demoFolders.filter((f) => f !== path)
      set({ settings: { ...state.settings, downloadDirs: demoFolders } })
    },
    // VR: Quest 3S по Air Link, VR-компонент скачан
    vrStatus: async () => ({
      oc: { installed: true, installedAt: Date.now() - 3 * 86400000 },
      meta: true,
      quest: { found: true, connected: true, model: 'Quest 3S', link: 'air', battery: 82, left: 70, right: 64 }
    }),
    vrQuest: async () => ({ found: true, connected: true, model: 'Quest 3S', link: 'air', battery: 82, left: 70, right: 18, rightIdle: true }),
    onVrQuest: () => () => {},
    vrInstallOc: async () => ({ ok: true }),
    vrCheckOc: async () => ({ update: false }),
    onVrProgress: () => () => {}
  }
}

/**
 * Демо-источник загрузок: только бесплатные игры и ссылки-заглушки example.invalid. Настоящих источников
 * в репозитории нет и не будет — PlayOS читает только те, что добавил пользователь
 */
let demoSources: StoreSource[] = new URLSearchParams(location.search).has('sources')
  ? [{ id: 'demo', url: 'https://example.invalid/demo-source.json', name: 'Demo', addedAt: Date.now() - 86400000 * 9, updatedAt: Date.now() - 3600000 * 3, count: 5, games: 4 }]
  : []
const demoUnbound = new Set<string>()

/** Название демо-раздачи в формате источников: по кругу Portable, Лицензия, GOG */
function demoRelease(title: string, i: number) {
  const tail = ['PC | Portable', 'PC | Лицензия', '[GOG]'][i % 3]
  return `${title} [v 1.${i}.${(i * 7) % 10}${i % 2 ? ' + DLC' : ''}] [RUS + ENG] (2024) ${tail}`
}

// ── Загрузки в демо: ?downloads — очередь из нескольких игр, ?folders — уже есть папка для загрузок ──
const demoQuery = new URLSearchParams(location.search)
let demoFolders: string[] = demoQuery.has('folders') || demoQuery.has('downloads') ? ['D:\\PlayOS Games'] : []
const demoCover = (id: number) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900.jpg`
const demoHero = (id: number) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/library_hero.jpg`
let demoJobs: DownloadJob[] = demoQuery.has('downloads')
  ? [
      { id: 'd1', title: 'Counter-Strike 2', name: demoRelease('Counter-Strike 2', 1), cover: demoCover(730), hero: demoHero(730), kind: 'http', uris: ['https://example.invalid/demo/730.zip'], dir: 'D:\\PlayOS Games\\Counter-Strike 2', status: 'active', received: 21.4 * 2 ** 30, size: 33.6 * 2 ** 30, speed: 38 * 2 ** 20, addedAt: Date.now() - 600000 },
      { id: 'd2', title: 'Dota 2', name: demoRelease('Dota 2', 2), cover: demoCover(570), kind: 'magnet', uris: ['magnet:?xt=urn:btih:demo2'], dir: 'D:\\PlayOS Games\\Dota 2', status: 'queued', received: 0, size: 41 * 2 ** 30, fileCount: 12, addedAt: Date.now() - 500000 },
      { id: 'd3', title: 'Team Fortress 2', name: demoRelease('Team Fortress 2', 4), cover: demoCover(440), kind: 'http', uris: ['https://example.invalid/demo/440.zip'], dir: 'D:\\PlayOS Games\\Team Fortress 2', status: 'paused', received: 9.1 * 2 ** 30, size: 27 * 2 ** 30, addedAt: Date.now() - 400000 },
      { id: 'd4', title: 'Warframe', name: demoRelease('Warframe', 5), cover: demoCover(230410), kind: 'http', uris: ['https://example.invalid/demo/230410.zip'], dir: 'D:\\PlayOS Games\\Warframe', status: 'error', error: 'Сервер перестал отдавать данные', received: 3.2 * 2 ** 30, size: 50 * 2 ** 30, addedAt: Date.now() - 300000 },
      { id: 'd6', title: 'Portal 2', name: demoRelease('Portal 2', 7), cover: demoCover(620), kind: 'magnet', uris: ['magnet:?xt=urn:btih:demo'], dir: 'D:\\PlayOS Games\\Portal 2', status: 'error', error: 'Архив защищён паролем', needPassword: true, downloaded: true, received: 11.8 * 2 ** 30, size: 11.8 * 2 ** 30, addedAt: Date.now() - 250000 },
      { id: 'd5', title: 'Path of Exile', name: demoRelease('Path of Exile', 6), cover: demoCover(238960), kind: 'http', uris: ['https://example.invalid/demo/238960.zip'], dir: 'D:\\PlayOS Games\\Path of Exile', file: 'D:\\PlayOS Games\\Path of Exile\\poe.zip', status: 'done', received: 40 * 2 ** 30, size: 40 * 2 ** 30, addedAt: Date.now() - 900000, doneAt: Date.now() - 200000, install: 'ready', installer: 'D:\\PlayOS Games\\Path of Exile\\setup.exe' },
      // Готовая игра без установщика — сразу в библиотеке, «Играть» запускает демо-игру
      { id: 'd7', gameId: '1', title: 'Death Stranding', name: demoRelease('Death Stranding', 8), cover: demoCover(1190460), kind: 'magnet', uris: ['magnet:?xt=urn:btih:demo7'], dir: 'D:\\PlayOS Games\\Death Stranding', status: 'done', received: 72 * 2 ** 30, size: 72 * 2 ** 30, addedAt: Date.now() - 2000000, doneAt: Date.now() - 1500000, install: 'installed', seeding: true, uploaded: 31.4 * 2 ** 30, upSpeed: 3.2 * 2 ** 20 }
    ]
  : []
const jobSubs = new Set<(jobs: DownloadJob[]) => void>()

/** Файлы демо-раздачи: установщик, части данных и необязательные части (озвучки, бонусы); 12 штук на 41 ГБ */
function demoTorrentFiles(title: string): TorrentFile[] {
  const names = [
    ['setup.exe', 0.01],
    ['data-01.bin', 6],
    ['data-02.bin', 6],
    ['data-03.bin', 6],
    ['data-04.bin', 6],
    ['data-05.bin', 5.2],
    ['optional-voice-english.bin', 3.1],
    ['optional-voice-russian.bin', 3.2],
    ['optional-voice-german.bin', 2.9],
    ['optional-soundtrack.bin', 1.4],
    ['optional-artbook.bin', 1.1],
    ['MD5\\checksums.md5', 0.001]
  ] as const
  return names.map(([n, gb], i) => ({ i, p: `${title}\\${n}`, s: Math.round(gb * 2 ** 30) }))
}
let demoJobTimer: ReturnType<typeof setInterval> | null = null
// ?downloads=unpack — первая загрузка уже скачана и распаковывается
if (demoQuery.get('downloads') === 'unpack' && demoJobs[0]) Object.assign(demoJobs[0], { received: demoJobs[0].size, downloaded: true, phase: 'extracting', unpack: { done: 14.2 * 2 ** 30, total: 52.4 * 2 ** 30 } })

/** Демо-очередь: одна качается, скорость 30–45 МБ/с, остальные ждут */
function demoPump() {
  if (!demoJobs.some((j) => j.status === 'active')) {
    const next = demoJobs.find((j) => j.status === 'queued')
    if (next) next.status = 'active'
  }
  demoJobTimer ??= setInterval(() => {
    const job = demoJobs.find((j) => j.status === 'active')
    const fast = demoQuery.has('fast') ? 2 ** 30 : 0
    if (job?.phase === 'extracting' && job.unpack) {
      // Распаковка: 180–240 МБ/с, потом готово
      job.speed = Math.round((180 + Math.random() * 60) * 2 ** 20)
      job.unpack = { ...job.unpack, done: Math.min(job.unpack.total, job.unpack.done + job.speed / 2 + fast) }
      if (job.unpack.done >= job.unpack.total) {
        // Распаковано — нашёлся установщик
        Object.assign(job, { status: 'done', speed: undefined, phase: undefined, unpack: undefined, doneAt: Date.now(), install: 'ready', installer: job.dir + '\\setup.exe' })
        demoPump()
      }
    } else if (job) {
      job.speed = Math.round((30 + Math.random() * 15) * 2 ** 20)
      job.received = Math.min(job.size, job.received + job.speed / 2 + fast)
      // Скачано — дальше распаковка архива
      if (job.received >= job.size) Object.assign(job, { downloaded: true, phase: 'extracting', unpack: { done: 0, total: Math.round(job.size * 1.5) } })
    }
    demoJobs = [...demoJobs]
    jobSubs.forEach((cb) => cb(demoJobs))
  }, 500)
  demoJobs = [...demoJobs]
  jobSubs.forEach((cb) => cb(demoJobs))
}
if (demoJobs.length) setTimeout(demoPump, 0)

async function demoFileSource(file: string): Promise<{ source?: StoreSource; error?: string }> {
  await new Promise((r) => setTimeout(r, 700))
  const name = file.split(/[\\/]/).pop() ?? file
  const url = `file:///C:/Users/Demo/Downloads/${encodeURIComponent(name)}`
  if (demoSources.some((s) => s.url === url)) return { error: 'Этот источник уже добавлен' }
  const source: StoreSource = { id: String(Date.now()), url, name: name.replace(/\.json$/i, ''), addedAt: Date.now(), updatedAt: Date.now(), count: DEMO_FREE.length, games: 4 }
  demoSources = [...demoSources, source]
  return { source }
}
/** Демо: названия меток каталога, как их отдаёт Steam (по-русски и по-английски) */
const DEMO_TAGS: Record<number, [string, string]> = {
  19: ['Экшен', 'Action'],
  122: ['Ролевая игра', 'RPG'],
  21: ['Приключение', 'Adventure'],
  9: ['Стратегия', 'Strategy'],
  599: ['Симулятор', 'Simulation'],
  1774: ['Шутер', 'Shooter'],
  1667: ['Хоррор', 'Horror'],
  1664: ['Головоломка', 'Puzzle'],
  1625: ['Платформер', 'Platformer'],
  699: ['Гонки', 'Racing'],
  701: ['Спорт', 'Sports'],
  1743: ['Файтинг', 'Fighting'],
  3810: ['Песочница', 'Sandbox'],
  3799: ['Визуальная новелла', 'Visual Novel'],
  1773: ['Аркада', 'Arcade'],
  1695: ['Открытый мир', 'Open World'],
  1662: ['Выживание', 'Survival'],
  4231: ['Ролевой экшен', 'Action RPG'],
  4434: ['Японская ролевая игра', 'JRPG'],
  1663: ['Шутер от первого лица', 'FPS'],
  3814: ['Шутер от третьего лица', 'Third-Person Shooter'],
  1716: ['Рогалик', 'Roguelike'],
  3959: ['Упрощённый рогалик', 'Roguelite'],
  29482: ['Похожа на Dark Souls', 'Souls-like'],
  1628: ['Метроидвания', 'Metroidvania'],
  1741: ['Пошаговая стратегия', 'Turn-Based Strategy'],
  1676: ['Стратегия в реальном времени', 'RTS'],
  4364: ['Глобальная стратегия', 'Grand Strategy'],
  4328: ['Градостроение', 'City Builder'],
  10235: ['Симулятор жизни', 'Life Sim'],
  87918: ['Симулятор фермы', 'Farming Sim'],
  1646: ['Слэшер', 'Hack and Slash'],
  1720: ['Подземелья', 'Dungeon Crawler'],
  1698: ['Point & Click', 'Point & Click'],
  5900: ['Симулятор ходьбы', 'Walking Simulator'],
  1666: ['Карточная игра', 'Card Game'],
  32322: ['Построение колоды', 'Deckbuilding'],
  1645: ['Башенная защита', 'Tower Defense'],
  1687: ['Стелс', 'Stealth'],
  176981: ['Королевская битва', 'Battle Royale'],
  1754: ['MMORPG', 'MMORPG'],
  9204: ['Иммерсивный симулятор', 'Immersive Sim'],
  21725: ['Тактическая ролевая игра', 'Tactical RPG'],
  10695: ['Партийная ролевая игра', 'Party-Based RPG'],
  4474: ['Компьютерная ролевая игра', 'CRPG'],
  3978: ['Хоррор на выживание', 'Survival Horror'],
  1721: ['Психологический хоррор', 'Psychological Horror'],
  5613: ['Детектив', 'Detective'],
  12472: ['Менеджмент', 'Management'],
  255534: ['Автоматизация', 'Automation'],
  220585: ['Симулятор колонии', 'Colony Sim'],
  7332: ['Строительство базы', 'Base Building'],
  1702: ['Крафтинг', 'Crafting'],
  1752: ['Ритм-игра', 'Rhythm'],
  1738: ['Поиск предметов', 'Hidden Object'],
  5537: ['Головоломка-платформер', 'Puzzle Platformer'],
  4885: ['Пулевой ад', 'Bullet Hell'],
  4158: ["Beat 'em up", "Beat 'em up"],
  1023537: ['Бумерский шутер', 'Boomer Shooter'],
  353880: ['Лутер-шутер', 'Looter Shooter'],
  1199779: ['Шутер с эвакуацией', 'Extraction Shooter'],
  492: ['Инди', 'Indie'],
  597: ['Казуальная игра', 'Casual'],
  3839: ['От первого лица', 'First-Person'],
  1697: ['От третьего лица', 'Third Person'],
  4791: ['Вид сверху', 'Top-Down'],
  5851: ['Изометрия', 'Isometric'],
  3798: ['Вид сбоку', 'Side Scroller'],
  3871: ['2D', '2D'],
  4191: ['3D', '3D'],
  4975: ['2.5D', '2.5D'],
  4182: ['Для одного игрока', 'Singleplayer'],
  3859: ['Для нескольких игроков', 'Multiplayer'],
  1685: ['Кооператив', 'Co-op'],
  3843: ['Сетевой кооператив', 'Online Co-Op'],
  3841: ['Локальный кооператив', 'Local Co-Op'],
  10816: ['Разделение экрана', 'Split Screen'],
  1775: ['Игрок против игрока', 'PvP'],
  6730: ['Игрок против ИИ', 'PvE'],
  128: ['ММО', 'Massively Multiplayer'],
  3964: ['Пиксельная графика', 'Pixel Graphics'],
  4085: ['Аниме', 'Anime'],
  4195: ['Мультипликация', 'Cartoony'],
  4175: ['Реализм', 'Realistic'],
  4252: ['Стилизация', 'Stylized'],
  6815: ['Рисованная графика', 'Hand-drawn'],
  4004: ['Ретро', 'Retro'],
  4305: ['Цветастая', 'Colorful'],
  4094: ['Минимализм', 'Minimalist'],
  5411: ['Красивая', 'Beautiful'],
  4145: ['Кинематографичная', 'Cinematic'],
  1742: ['Глубокий сюжет', 'Story Rich'],
  6426: ['Решения с последствиями', 'Choices Matter'],
  6971: ['Несколько концовок', 'Multiple Endings'],
  7208: ['Протагонистка', 'Female Protagonist'],
  7250: ['Линейная', 'Linear'],
  6869: ['Нелинейная', 'Nonlinear'],
  1756: ['Отличный саундтрек', 'Great Soundtrack'],
  4234: ['Короткая', 'Short'],
  4711: ['Реиграбельность', 'Replay Value'],
  3854: ['Проработанная вселенная', 'Lore-Rich'],
  3942: ['Научная фантастика', 'Sci-fi'],
  1684: ['Фэнтези', 'Fantasy'],
  4604: ['Тёмное фэнтези', 'Dark Fantasy'],
  3835: ['Постапокалипсис', 'Post-apocalyptic'],
  4172: ['Средневековье', 'Medieval'],
  4115: ['Киберпанк', 'Cyberpunk'],
  1755: ['Космос', 'Space'],
  3987: ['Историческая', 'Historical'],
  1659: ['Зомби', 'Zombies'],
  4150: ['Вторая мировая война', 'World War II'],
  4168: ['Военные действия', 'Military'],
  1647: ['Вестерн', 'Western'],
  7432: ['Лавкрафт', 'Lovecraftian'],
  16094: ['Мифология', 'Mythology'],
  1681: ['Пираты', 'Pirates'],
  1777: ['Стимпанк', 'Steampunk'],
  4166: ['Атмосферная', 'Atmospheric'],
  4342: ['Мрачная', 'Dark'],
  1654: ['Расслабляющая', 'Relaxing'],
  4136: ['Смешная', 'Funny'],
  4726: ['Милая', 'Cute'],
  4026: ['Сложная', 'Difficult'],
  5716: ['Тайна', 'Mystery'],
  5608: ['Эмоциональная', 'Emotional'],
  552282: ['Душевная', 'Wholesome'],
  97376: ['Уютная', 'Cozy'],
  1710: ['Сюрреалистичная', 'Surreal'],
  1719: ['Юмор', 'Comedy'],
  5923: ['Чёрный юмор', 'Dark Humor'],
  4345: ['Кровь', 'Gore'],
  4667: ['Насилие', 'Violent']
}

/** Демо: придуманная игра, о которой знает только источник — ни Steam, ни GOG (арта нет, как без ключа SteamGridDB) */
const DEMO_SRC_ID = -(SRC_BASE + 4242)
const DEMO_SRC: StoreItem[] = [{ appId: DEMO_SRC_ID, store: 'sources', title: 'Brasswick Murmurs' }]

const DEMO_FREE: [number, string, string, string][] = [
  [DEMO_SRC_ID, 'brasswick murmurs', '1.8 GB', 'http'],
  [730, 'counter-strike 2', '33.5 GB', 'magnet'],
  [730, 'counter-strike 2', '33.6 GB', 'http'],
  [570, 'dota 2', '41.2 GB', 'magnet'],
  [578080, 'pubg battlegrounds', '38.9 GB', 'torrent'],
  [1172470, 'apex legends', '75 GB', 'http']
]

function demoOptionsFor(appId: number): DownloadOption[] {
  const src = demoSources[0]
  if (!src) return []
  return DEMO_FREE.flatMap(([id, key, size, kind], i) =>
    id !== appId || demoUnbound.has(`${id}:${key}`)
      ? []
      : [
          {
            key,
            sourceId: src.id,
            source: src.name,
            // Как в настоящих источниках: версия, языки, кто собрал — только без настоящих раздач
            title: demoRelease(key.replace(/(^|\s)\w/g, (c) => c.toUpperCase()), i),
            uris: [kind === 'magnet' ? `magnet:?xt=urn:btih:${'0'.repeat(40)}&dn=demo` : `https://example.invalid/demo/${id}-${i}.${kind === 'torrent' ? 'torrent' : 'zip'}`],
            kind: kind as DownloadOption['kind'],
            size,
            date: Date.now() - 86400000 * (i * 3 + 1)
          }
        ]
  )
}

/** Демо: у игр эмуляторов без файла — одна раздача для их платформы, если источник добавлен */
function demoEmuOptions(title: string, platform: 'ps2' | 'ps3'): DownloadOption[] {
  const src = demoSources[0]
  if (!src) return []
  return [
    {
      key: title.toLowerCase(),
      sourceId: src.id,
      source: src.name,
      title: `${title} (demo) ${platform.toUpperCase()}`,
      uris: [`magnet:?xt=urn:btih:${'0'.repeat(40)}&dn=demo`],
      kind: 'magnet',
      size: platform === 'ps2' ? '4.3 GB' : '11.2 GB',
      date: Date.now() - 86400000 * 5
    }
  ]
}

const demoDecorate = (items: StoreItem[]) =>
  items.map((it) => {
    const n = demoOptionsFor(it.appId).length
    return n ? { ...it, options: n } : it
  })

/** Демо-витрина магазина: настоящие игры Steam, арт по старым путям CDN, метки и оценки — для вида */
function demoStoreHome(): StoreHome {
  const home = demoStoreRows()
  const rows = home.rows.map((r) => ({ ...r, items: demoDecorate(r.items) }))
  const known = [...rows.flatMap((r) => r.items), ...demoDecorate(DEMO_SRC)]
  const fresh = [...new Set(DEMO_FREE.map(([id]) => id))].flatMap((id) => known.find((i) => i.appId === id && i.options) ?? [])
  return { ...home, rows: fresh.length ? [{ id: 'sources', items: fresh }, ...rows] : rows }
}

function demoStoreRows(): StoreHome {
  const en = getLang() === 'en'
  const cdn = (id: number, file: string) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/${file}`
  const review = (percent: number, count: number): StoreItem['reviews'] => ({
    percent,
    count,
    label: percent >= 95 ? (en ? 'Overwhelmingly Positive' : 'Крайне положительные') : percent >= 80 ? (en ? 'Very Positive' : 'Очень положительные') : en ? 'Mostly Positive' : 'В основном положительные'
  })
  const tags = (ru: string[], eng: string[]) => (en ? eng : ru)
  const item = (appId: number, title: string, year: number, extra: Partial<StoreItem> = {}): StoreItem => ({
    appId,
    title,
    cover: cdn(appId, 'library_600x900.jpg'),
    hero: cdn(appId, 'library_hero.jpg'),
    logo: cdn(appId, 'logo.png'),
    header: cdn(appId, 'header.jpg'),
    released: Date.UTC(year, (appId % 12), 1 + (appId % 27)),
    short: en
      ? 'A demo store entry. In PlayOS this is the short description from the Steam page.'
      : 'Демо-карточка магазина. В PlayOS здесь краткое описание со страницы Steam.',
    tags: tags(['Экшен', 'Приключение', 'Открытый мир', 'Сюжетная'], ['Action', 'Adventure', 'Open World', 'Story Rich']),
    reviews: review(70 + (appId % 29), 1000 + (appId % 900) * 311),
    ...extra
  })
  const soon = (appId: number, title: string, upcoming: StoreItem['upcoming'], date?: number): StoreItem =>
    item(appId, title, 2027, { upcoming, released: date, reviews: undefined })
  const gogImg = (hash: string, ext = 'jpg') => `https://images.gog-statics.com/${hash}.${ext}`
  const gog = (id: number, title: string, year: number, rating: number, count: number, ru: string[], eng: string[], cover: string, hero: string, logo: string, slug: string): StoreItem => ({
    appId: -id,
    store: 'gog',
    title,
    cover: gogImg(cover),
    hero: gogImg(hero),
    logo: logo ? gogImg(logo, 'png') : undefined,
    link: `https://www.gog.com/en/game/${slug}`,
    released: Date.UTC(year, 5, 1),
    tags: tags(ru, eng),
    reviews: { percent: rating * 2, count, label: '' }
  })
  return {
    fetchedAt: Date.now(),
    rows: [
      {
        id: 'top',
        items: [
          item(1091500, 'Cyberpunk 2077', 2020),
          item(1086940, 'Baldur’s Gate 3', 2023),
          item(1245620, 'ELDEN RING', 2022),
          item(1174180, 'Red Dead Redemption 2', 2019),
          item(990080, 'Hogwarts Legacy', 2023),
          item(1551360, 'Forza Horizon 5', 2021),
          item(814380, 'Sekiro: Shadows Die Twice', 2019),
          item(1145360, 'Hades', 2020),
          item(413150, 'Stardew Valley', 2016),
          item(292030, 'The Witcher 3: Wild Hunt', 2015)
        ]
      },
      {
        id: 'new',
        items: [
          item(2358720, 'Black Myth: Wukong', 2024),
          item(553850, 'HELLDIVERS 2', 2024),
          item(1627720, 'Lies of P', 2023),
          item(1888160, 'ARMORED CORE VI FIRES OF RUBICON', 2023),
          item(1868140, 'DAVE THE DIVER', 2023),
          item(1244090, 'Sea of Stars', 2023),
          item(2215430, 'Ghost of Tsushima DIRECTOR’S CUT', 2024),
          item(1593500, 'God of War', 2022)
        ]
      },
      {
        id: 'played',
        items: [
          item(730, 'Counter-Strike 2', 2012),
          item(570, 'Dota 2', 2013),
          item(578080, 'PUBG: BATTLEGROUNDS', 2017),
          item(1172470, 'Apex Legends', 2020),
          item(252490, 'Rust', 2018),
          item(271590, 'Grand Theft Auto V', 2015),
          item(892970, 'Valheim', 2021),
          item(105600, 'Terraria', 2011)
        ]
      },
      // Ряд жанра: в конце — «Все игры жанра»
      {
        id: 'tag-19',
        tag: 19,
        title: DEMO_TAGS[19][getLang() === 'en' ? 1 : 0],
        items: [
          item(1245620, 'ELDEN RING', 2022),
          item(1091500, 'Cyberpunk 2077', 2020),
          item(814380, 'Sekiro: Shadows Die Twice', 2019),
          item(1145360, 'Hades', 2020),
          item(1593500, 'God of War', 2022),
          item(2358720, 'Black Myth: Wukong', 2024)
        ]
      },
      // Игры GOG, которых нет в Steam (проверено сверкой 2026-11-09): картинки с CDN GOG
      {
        id: 'gog',
        items: [
          gog(1412601690, 'Diablo + Hellfire', 1996, 46, 4873, ['Ролевая игра', 'Экшн'], ['Role-playing', 'Action'], '271f23dcffc02293cc3b34e5289d8e24bfc97742dae752b809884bcf6e0f9b67', '334a689a896068732499d7ed61564b07fadc6e369a581a53f810916ee425b7c0', '86419818d059039da76927bb2a882028b0867c50cb38e6f9e83671212e0fee54', 'diablo'),
          gog(1409964317, 'SWAT 4: Gold Edition', 2005, 48, 2246, ['Экшн', 'Тактическая'], ['Action', 'Tactical'], '87f7dda5ee51f4fe11e0ef1bbb24187599e0d1ced645c293f99894f7431c1d7c', 'beb36f717e0865b22fd269432e29d5940994e96125c6c04f96cf7c9baaa9c029', 'e057718314f895dfa8ef3f132888174fd02d7d7f1564d82968c1eff2438cd69b', 'swat_4_gold_edition'),
          gog(1141086411, 'Silent Hill 4: The Room', 2004, 45, 1829, ['Приключение', 'Хоррор'], ['Adventure', 'Horror'], '9c695817623e63cea34d9b78af20e6a079516682917a37a90b1515b0c23762ed', '1c54b439f5a25006ae702611247dfe557bf408f67005a607bd835bce479136cc', '06ad5885682ddcd7a11a519a67ff04286241f289c850704687d9cd9e4849186b', 'silent_hill_4_the_room'),
          gog(1207658916, 'Might and Magic 7: For Blood and Honor', 1999, 46, 2095, ['Ролевая игра', 'Фэнтези'], ['Role-playing', 'Fantasy'], '77caefb63a55de57aa6bbc8a3bc9d1ac9cd1957a02835bd5a46b984050ff71aa', '6c718ed08707deb6b9f8d0329085c6c247b15439a793347d0440d4d9976d7f91', '0034c28d4056a458ca94adb50a741e7f5e0afeac365eced8368c5f7b29255c3f', 'might_and_magic_7_for_blood_and_honor'),
          gog(1207658891, 'Icewind Dale 2 Complete', 2002, 45, 3043, ['Ролевая игра', 'Фэнтези'], ['Role-playing', 'Fantasy'], '6ad21da40f0679b31ee546d475b1719f6ad486570035f3b76bf8f4694fba4cdf', '321fb9d887deeac44abe1149db1b4b343219ed33ec1b15315f4dab24eb0d40c0', '619e57735dec8e159bd91b3de08af4844b5b656f147b0fafc0bacb519ba4ff06', 'icewind_dale_2'),
          gog(1752794474, 'Mortal Kombat 4', 1997, 43, 270, ['Экшн', 'Файтинг'], ['Action', 'Fighting'], '1697f571cf54643e4150a444bb902663743034cb94fac4046cb5476a97e40c91', 'd7eb4568599f848ad7fcf4b3209c1ad4d7eb7376ad1ae4599e061aec0e81e982', '0e8ddfe01c1a6c5291e7b00132108c21be49673308de3e74064bf09ca6e1a461', 'mortal_kombat_4'),
          gog(1174788223, 'Star Trek: Armada II', 2001, 42, 680, ['Стратегия', 'Фантастика'], ['Strategy', 'Sci-fi'], '9f36b73e5c3ec7f4fd4066fa3520cfabf758209c49964e7051177a3bad40e6cf', 'ea357d163383583b70083183c5ad73f413d211797732921fb6542ac8ff587534', 'ee85459d4363bf8d168cbd51361c986c925422032e2786a4fc7f2ad9ea334965', 'star_trek_armada_ii'),
          gog(1207659104, 'Worms 2', 1997, 36, 449, ['Стратегия', 'Пошаговая'], ['Strategy', 'Turn-based'], '11e06eb407d4f03644627ea67471bcd588014d12ea83fae5882cc000a86dcf8c', 'a99a5a96d62ecf3cfc35f41302c831d9453363bf176062915013c28b03705534', '9a4fac37079a391d1f57f90cfb1c8a7f523844fef2ea149193a82a9955d84abe', 'worms_2'),
          gog(1176929400, 'Medal of Honor: Pacific Assault', 2004, 37, 431, ['Шутер', 'Историческая'], ['Shooter', 'Historical'], '7327c7ed6895493e6aad5e8a49f6b59a8cfceaf5693b54edcd156eb55e2e234d', 'abdf1f2193bae18b675b8e61d06224275486230c63848f291dc1c4cca30f6c4c', '', 'medal_of_honor_pacific_assault')
        ]
      },
      {
        id: 'soon',
        items: [
          soon(1030300, 'Hollow Knight: Silksong', 'date', Date.UTC(2027, 1, 12)),
          soon(1716740, 'Starfield', 'quarter', Date.UTC(2027, 3, 1)),
          soon(1190460, 'DEATH STRANDING DIRECTOR’S CUT', 'year', Date.UTC(2027, 0, 1)),
          soon(1817070, 'Marvel’s Spider-Man Remastered', 'soon'),
          soon(1888930, 'The Last of Us Part I', 'tba')
        ]
      }
    ]
  }
}

export const api: PcsApi = window.pcs ?? createMockApi()
// Для превью в браузере: window.__pcsApi.launch('2'), затем window.__pcsMock.overlay({ open: true })
if (!window.pcs) (window as unknown as { __pcsApi: PcsApi }).__pcsApi = api
export const isMock = !window.pcs
