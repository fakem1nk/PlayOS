import type {
  AchievementSet,
  ApiKeyKind,
  AppState,
  ArtCandidate,
  CloudStatus,
  DownloadJob,
  DownloadOption,
  Game,
  ImportProgress,
  PcsApi,
  SaveProgress,
  SteamLibraryGame,
  StoreHome,
  StoreItem,
  StoreSource,
  SystemState,
  WindowMode
} from '@shared/types'
import { getLang } from '@shared/i18n'

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
      { ...demo('9', 'Demon’s Souls', 'ps3', 0, 7, 100), cover: undefined, hero: undefined, logo: undefined }
    ],
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
      betaUpdates: location.search.includes('beta')
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
    resetPlaytime: async (id) => set({ games: state.games.map((g) => (g.id === id ? { ...g, playtime: 0 } : g)) }),
    saveSettings: async (patch) => {
      set({ settings: { ...state.settings, ...patch } })
      return state.settings
    },
    launch: async (id) => {
      set({ running: { gameId: id, startedAt: Date.now(), phase: 'launching' } })
      setTimeout(() => state.running && set({ running: { ...state.running, phase: 'running' } }), 2500)
      return { ok: true }
    },
    cancelLaunch: async () => set({ running: null }),
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
          hltb: { main: 52718, plus: 69031, full: 99768, title: g?.title ?? 'Bully' }
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
        hltb: { main: 52718, plus: 69031, full: 99768, title: g?.title ?? 'Bully' }
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
    storeSearch: async (q) => {
      await new Promise((r) => setTimeout(r, 300))
      const all = demoStoreHome().rows.flatMap((r) => r.items)
      const seen = new Set<number>()
      return demoDecorate(all.filter((i) => i.title.toLowerCase().includes(q.trim().toLowerCase()) && !seen.has(i.appId) && seen.add(i.appId)))
    },
    storePage: async (appId) => {
      await new Promise((r) => setTimeout(r, 500))
      const item = demoStoreHome()
        .rows.flatMap((r) => r.items)
        .find((i) => i.appId === appId)
      if (!item) return null
      const en = getLang() === 'en'
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
      const have = state.games.find((g) => g.steamAppId === appId)
      if (have) return have.id
      const it = demoStoreRows()
        .rows.flatMap((r) => r.items)
        .find((i) => i.appId === appId)
      const game: Game = { id: `store-${appId}`, title: it?.title ?? title, platform: 'pc', path: '', steamAppId: appId, cover: it?.cover, hero: it?.hero, logo: it?.logo, playtime: 0, addedAt: Date.now(), sessions: [] }
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
      else if (action === 'up') {
        const i = demoJobs.indexOf(job)
        if (i > 0) demoJobs = [...demoJobs.slice(0, i - 1), job, demoJobs[i - 1], ...demoJobs.slice(i + 1)]
      } else demoJobs = demoJobs.filter((j) => j !== job)
      if (job) job.speed = undefined
      demoPump()
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
      { id: 'd2', title: 'Dota 2', name: demoRelease('Dota 2', 2), cover: demoCover(570), kind: 'http', uris: ['https://example.invalid/demo/570.zip'], dir: 'D:\\PlayOS Games\\Dota 2', status: 'queued', received: 0, size: 41 * 2 ** 30, addedAt: Date.now() - 500000 },
      { id: 'd3', title: 'Team Fortress 2', name: demoRelease('Team Fortress 2', 4), cover: demoCover(440), kind: 'http', uris: ['https://example.invalid/demo/440.zip'], dir: 'D:\\PlayOS Games\\Team Fortress 2', status: 'paused', received: 9.1 * 2 ** 30, size: 27 * 2 ** 30, addedAt: Date.now() - 400000 },
      { id: 'd4', title: 'Warframe', name: demoRelease('Warframe', 5), cover: demoCover(230410), kind: 'http', uris: ['https://example.invalid/demo/230410.zip'], dir: 'D:\\PlayOS Games\\Warframe', status: 'error', error: 'Сервер перестал отдавать данные', received: 3.2 * 2 ** 30, size: 50 * 2 ** 30, addedAt: Date.now() - 300000 },
      { id: 'd6', title: 'Portal 2', name: demoRelease('Portal 2', 7), cover: demoCover(620), kind: 'magnet', uris: ['magnet:?xt=urn:btih:demo'], dir: 'D:\\PlayOS Games\\Portal 2', status: 'error', error: 'Архив защищён паролем', needPassword: true, downloaded: true, received: 11.8 * 2 ** 30, size: 11.8 * 2 ** 30, addedAt: Date.now() - 250000 },
      { id: 'd5', title: 'Path of Exile', name: demoRelease('Path of Exile', 6), cover: demoCover(238960), kind: 'http', uris: ['https://example.invalid/demo/238960.zip'], dir: 'D:\\PlayOS Games\\Path of Exile', file: 'D:\\PlayOS Games\\Path of Exile\\poe.zip', status: 'done', received: 40 * 2 ** 30, size: 40 * 2 ** 30, addedAt: Date.now() - 900000, doneAt: Date.now() - 200000, install: 'ready', installer: 'D:\\PlayOS Games\\Path of Exile\\setup.exe' },
      // Готовая игра без установщика — сразу в библиотеке, «Играть» запускает демо-игру
      { id: 'd7', gameId: '1', title: 'Death Stranding', name: demoRelease('Death Stranding', 8), cover: demoCover(1190460), kind: 'http', uris: ['https://example.invalid/demo/1190460.zip'], dir: 'D:\\PlayOS Games\\Death Stranding', status: 'done', received: 72 * 2 ** 30, size: 72 * 2 ** 30, addedAt: Date.now() - 2000000, doneAt: Date.now() - 1500000, install: 'installed' }
    ]
  : []
const jobSubs = new Set<(jobs: DownloadJob[]) => void>()
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
const DEMO_FREE: [number, string, string, string][] = [
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
  const fresh = [...new Set(DEMO_FREE.map(([id]) => id))].flatMap((id) => rows.flatMap((r) => r.items).find((i) => i.appId === id && i.options) ?? [])
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
