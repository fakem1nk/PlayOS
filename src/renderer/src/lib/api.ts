import type { AchievementSet, AppState, ArtCandidate, CloudStatus, Game, ImportProgress, PcsApi, SaveProgress, SteamLibraryGame, SystemState } from '@shared/types'
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
      betaUpdates: false
    },
    running: null,
    dataDir: 'C:\\Users\\demo\\AppData\\Roaming\\PlayOS',
    version: '1.0.1'
  }
  const subs = { state: new Set<(s: AppState) => void>(), end: new Set<(e: { gameId: string; duration: number }) => void>() }
  const set = (patch: Partial<AppState>) => {
    state = { ...state, ...patch }
    subs.state.forEach((cb) => cb(state))
  }
  const noop = () => () => {}
  // Облако в демо: вход проходит сразу, сохранения «синхронизированы» несколько минут назад
  let cloud: CloudStatus = { account: null, state: 'off', available: ['yandex', 'google', 'folder'] }
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
    pickFile: async (kind) => (kind === 'image' ? null : kind === 'backup' ? 'C:\\Users\\demo\\Desktop\\PlayOS-копия.playos' : 'C:\\Games\\Demo Game\\DemoGame.exe'),
    inspect: async () => ({ title: 'Demo Game' }),
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
    onWindowMode: () => () => {},
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
    testTrophyAccounts: async () => ({ ra: { state: 'off', text: 'Не настроено' }, steam: { state: 'off', text: 'Не настроено' } }),
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
    onOutro: (cb) => {
      // Для превью в браузере: window.__pcsOutro('quit')
      ;(window as unknown as { __pcsOutro: typeof cb }).__pcsOutro = cb
      return () => {}
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
    installUpdate: async () => true,
    // ?update в адресе — показать скачивание и окно «готово» на демо-данных
    onUpdateState: (cb) => {
      if (!location.search.includes('update')) return () => {}
      const notes = '• Копия данных одним файлом\n• Восстановление на другом компьютере\n• Окно «О системе» помещается на 1080p'
      let p = 0
      const t = setInterval(() => {
        p = Math.min(100, p + 9)
        const total = 118 * 2 ** 20
        cb(p < 100
          ? { phase: 'downloading', current: '1.0.1', version: '1.0.2', percent: p, transferred: (total * p) / 100, total }
          : { phase: 'ready', current: '1.0.1', version: '1.0.2', percent: 100, notes })
        if (p >= 100) clearInterval(t)
      }, 700)
      return () => clearInterval(t)
    },
    saveReport: async () => 'C:\\Users\\demo\\Desktop\\PlayOS-отчёт.txt',
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
      if (!g) return null
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
    }
  }
}

export const api: PcsApi = window.pcs ?? createMockApi()
// Для превью в браузере: window.__pcsApi.launch('2'), затем window.__pcsMock.overlay({ open: true })
if (!window.pcs) (window as unknown as { __pcsApi: PcsApi }).__pcsApi = api
export const isMock = !window.pcs
