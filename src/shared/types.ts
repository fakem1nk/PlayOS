export type Platform = 'pc' | 'ps2' | 'ps3'

export const PLATFORM_NAMES: Record<Platform, string> = {
  pc: 'PC',
  ps2: 'PlayStation 2',
  ps3: 'PlayStation 3'
}

export interface Session {
  start: number
  duration: number // секунды
}

export interface Game {
  id: string
  title: string
  platform: Platform
  /** EXE для PC, образ/EBOOT.BIN для эмуляторов */
  path: string
  /** Дополнительные аргументы (PC) */
  args?: string
  workDir?: string
  /** Полная команда запуска вместо шаблона эмулятора */
  customCommand?: string
  /** Имя процесса для отслеживания, если EXE — это лаунчер */
  trackProcess?: string
  serial?: string
  /** Steam AppID — для достижений Steam */
  steamAppId?: number
  /** Запуск через клиент Steam (steam://rungameid); path — папка установки, по ней отслеживается игра */
  launcher?: 'steam'
  /** ID игры в RetroAchievements — для трофеев PS2 */
  raGameId?: number
  cover?: string
  /** Анимированная обложка (WebP/APNG/GIF) — проигрывается на плитке в фокусе */
  coverAnimated?: string
  hero?: string
  logo?: string
  icon?: string
  /** Цвет обложки (#rrggbb): подсветка DualSense и акценты интерфейса */
  accent?: string
  favorite?: boolean
  playtime: number // секунды
  lastPlayed?: number
  addedAt: number
  sessions: Session[]
}

/** Черновик из редактора. Поля арта могут быть http-ссылками — main скачает их при сохранении. */
export type GameDraft = Omit<Game, 'id' | 'playtime' | 'addedAt' | 'sessions'> & { id?: string }

export type GlyphStyle = 'auto' | 'playstation' | 'xbox'
export type SoundVolume = 'low' | 'mid' | 'high'

export interface Settings {
  userName: string
  /** Путь к картинке аватара (копия в папке данных) */
  avatar?: string
  pcsx2Path: string
  pcsx2Args: string
  rpcs3Path: string
  rpcs3Args: string
  sounds: boolean
  volume: SoundVolume
  /** Фоновая эмбиент-музыка на главном экране */
  music: boolean
  glyphs: GlyphStyle
  fullscreen: boolean
  launchOnStartup: boolean
  /** Напоминание о перерыве: каждые N часов, 0 — выключено */
  breakReminder: number
  /** Полученные трофеи PlayOS: id → время получения */
  trophies: Record<string, number>
  /** Горячая клавиша сохранения состояния в RPCS3 (например, Ctrl+S) */
  rpcs3SaveKey: string
  /** Пауза игры, пока открыт оверлей: заморозка процесса */
  pauseOnOverlay: 'all' | 'emulators' | 'off'
  /** Масштаб интерфейса (1 — по умолчанию) */
  uiScale: number
  /** Ключ API SteamGridDB для альтернативного поиска обложек */
  steamGridDbKey: string
  /** RetroAchievements: логин и Web API ключ */
  raUser: string
  raKey: string
  /** Steam: Web API ключ и SteamID64 / имя профиля */
  steamKey: string
  steamId: string
  /** Показывать новые трофеи поверх игры */
  trophyPopups: boolean
  /** DSX: подсветка DualSense в цвет игры */
  dsxLightbar: boolean
  /** Вибрация геймпада при новом трофее */
  trophyRumble: boolean
  /** Проигрывать анимированные обложки на плитке в фокусе */
  animatedCovers: boolean
  /** Живой фон: беззвучный трейлер или анимированный фон игры, если задержаться на ней */
  liveBackground: boolean
  /** Заставка при бездействии через N минут, 0 — выключена */
  screensaver: number
  /** Предупреждать о разряде геймпада (10%) поверх игры */
  lowBatteryWarning: boolean
  /** Акценты и свечение интерфейса в цвет обложки выбранной игры */
  gameTint: boolean
  /** Экран, на котором открывается PlayOS: id дисплея (0 — основной) и его имя на случай смены id */
  displayId: number
  displayLabel: string
  /** Мастер первого запуска пройден */
  onboarded: boolean
}

/** Состояние обновлений PlayOS */
export interface UpdateState {
  /** dev — запущено из исходников, обновлять нечего */
  phase: 'idle' | 'dev' | 'checking' | 'latest' | 'downloading' | 'ready' | 'error'
  current: string
  version?: string
  percent?: number
  notes?: string
  error?: string
  checkedAt?: number
}

/** Сведения для окна «О системе» */
export interface SystemInfo {
  app: { version: string; electron: string; chrome: string; installDir: string; dataDir: string; packaged: boolean }
  os: { name: string; build: string; uptimeMin: number }
  cpu: { model: string; threads: number }
  gpu: string
  memory: { total: number; free: number }
  displays: { name: string; width: number; height: number; hz: number; primary: boolean; current: boolean }[]
  pads: { name: string; kind: 'dualsense' | 'ds4' | 'xbox'; via?: string; percent?: number; battery: BatteryLevel | null }[]
  library: { games: number; hours: number; artBytes: number; videoBytes: number; totalBytes: number }
}

export interface DisplayInfo {
  id: number
  name: string
  /** Физическое разрешение */
  width: number
  height: number
  primary: boolean
}

export interface SaveSlot {
  slot: number
  /** Время сохранения (мс) или undefined, если слот пуст */
  time?: number
  /** Скриншот из сохранения */
  thumb?: string
}

export interface EmuState {
  /** pine — точные слоты через PINE, keys — горячими клавишами эмулятора, none — сохранения недоступны */
  mode: 'pine' | 'keys' | 'none'
  platform?: Platform
  slots: SaveSlot[]
  /** Текущий слот (для режима горячих клавиш) */
  current: number
  canLoad: boolean
  /** Эмулятор поставлен на паузу, пока открыт оверлей */
  paused: boolean
  hint?: string
}

export interface EmuActionResult {
  ok: boolean
  message: string
  /** Оверлей закрылся и игра снова в фокусе */
  resumed?: boolean
}

export interface Pcsx2Info {
  found: boolean
  dataDir?: string
  pine: 'enabled' | 'disabled' | 'unknown'
  saveKey?: string
  loadKey?: string
}

export type BatteryLevel = 'empty' | 'low' | 'medium' | 'full' | 'wired'

export interface PadStatus {
  connected: number
  battery: BatteryLevel | null
  /** Заряд в процентах, если источник его отдаёт (DSX, HID DualSense) */
  percent?: number
  /** Откуда данные: DSX или прямое чтение */
  source?: 'dsx' | 'hid' | 'xinput'
}

export interface RunningGame {
  gameId: string
  startedAt: number
  phase: 'launching' | 'running'
}

export interface AppState {
  games: Game[]
  settings: Settings
  running: RunningGame | null
  dataDir: string
  version: string
}

export interface InspectResult {
  title?: string
  serial?: string
  cover?: string
  hero?: string
  logo?: string
  icon?: string
  path?: string
  args?: string
  workDir?: string
}

export interface ArtCandidate {
  key: string
  source: ArtSource | 'disc'
  title: string
  cover?: string
  /** Анимированная обложка и её лёгкое превью (видео) для окна поиска */
  coverAnimated?: string
  coverAnimatedPreview?: string
  hero?: string
  logo?: string
  /** Резервное превью, если cover не загрузится */
  thumb?: string
}

export type ArtSource = 'steam' | 'steamgriddb' | 'wiki'

export interface OverlayEvent {
  open: boolean
  /** Снимок экрана с игрой для размытого фона */
  backdrop?: string
}

export type PickKind = 'exe' | 'ps2' | 'ps3' | 'ps3folder' | 'image' | 'emulator' | 'folder' | 'backup'

export type PadAction =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'confirm'
  | 'back'
  | 'menu'
  | 'options'
  | 'search'
  | 'l1'
  | 'r1'
  | 'l2'
  | 'r2'
  | 'home'

export interface SaveProgress {
  field: 'cover' | 'coverAnimated' | 'hero' | 'logo' | 'icon'
  /** Какой по счёту файл и сколько всего */
  step: number
  total: number
  received: number
  /** 0 — сервер не сообщил размер */
  size: number
}

export interface SessionEndEvent {
  gameId: string
  duration: number
}

export type PowerAction = 'shutdown' | 'restart' | 'sleep' | 'quit'

export interface PcsApi {
  getState(): Promise<AppState>
  saveGame(draft: GameDraft): Promise<Game>
  deleteGame(id: string): Promise<void>
  setFavorite(id: string, value: boolean): Promise<void>
  resetPlaytime(id: string): Promise<void>
  saveSettings(patch: Partial<Settings>): Promise<Settings>
  launch(id: string): Promise<{ ok: boolean; error?: string }>
  closeGame(): Promise<void>
  resumeGame(): Promise<void>
  hideOverlay(): Promise<void>
  pickFile(kind: PickKind): Promise<string | null>
  inspect(platform: Platform, path: string): Promise<InspectResult>
  searchArt(query: string, platform: Platform, serial?: string, source?: ArtSource): Promise<ArtCandidate[]>
  scanPs2Folder(): Promise<number>
  importRpcs3(): Promise<number>
  openFolder(path: string): Promise<void>
  power(action: PowerAction): Promise<void>
  onState(cb: (s: AppState) => void): () => void
  onPad(cb: (a: PadAction) => void): () => void
  onOverlay(cb: (e: OverlayEvent) => void): () => void
  onSessionEnd(cb: (e: SessionEndEvent) => void): () => void
  onToast(cb: (t: { title: string; message: string }) => void): () => void
  onPadStatus(cb: (s: PadStatus) => void): () => void
  getPadStatus(): Promise<PadStatus>
  // ── Оверлей поверх игры ──
  emuState(): Promise<EmuState>
  saveState(slot: number): Promise<EmuActionResult>
  loadState(slot: number): Promise<EmuActionResult>
  overlayHome(): Promise<void>
  pcsx2Info(): Promise<Pcsx2Info>
  enablePine(): Promise<{ ok: boolean; message: string }>
  // ── Пункт управления ──
  systemState(withBrightness?: boolean): Promise<SystemState | null>
  setVolume(v: number): Promise<SystemState | null>
  setMute(m: boolean): Promise<SystemState | null>
  setAudioDevice(id: string): Promise<SystemState | null>
  setBrightness(v: number): Promise<SystemState | null>
  controllers(): Promise<ControllerInfo[]>
  // ── Трофеи игр ──
  achievements(gameId: string, refresh?: boolean): Promise<AchievementResult>
  achievementSummary(): Promise<Record<string, AchievementSummaryItem>>
  findRaGames(query: string): Promise<RaGame[]>
  linkRaGame(gameId: string, raId: number): Promise<AchievementResult>
  testTrophyAccounts(): Promise<{ ra: string; steam: string }>
  onAchievements(cb: (n: AchievementNotice) => void): () => void
  onAchievementSummary(cb: () => void): () => void
  onOverlayToast(cb: (n: AchievementNotice) => void): () => void
  // ── Загрузка арта при сохранении ──
  cancelSave(): Promise<void>
  onSaveProgress(cb: (p: SaveProgress) => void): () => void
  // ── DualSense ──
  testLightbar(): Promise<'ok' | 'no-dsx' | 'no-pad'>
  // ── Выход и питание ──
  /** main просит проиграть аутро (окно закрывают, например Alt+F4) */
  onOutro(cb: (kind: 'quit') => void): () => void
  onPowerResume(cb: () => void): () => void
  // ── О системе ──
  systemInfo(): Promise<SystemInfo>
  // ── Обновления ──
  updateState(): Promise<UpdateState>
  checkUpdates(): Promise<UpdateState>
  installUpdate(): Promise<boolean>
  onUpdateState(cb: (s: UpdateState) => void): () => void
  /** Есть ли файл (проверка путей к эмуляторам в мастере) */
  pathExists(p: string): Promise<boolean>
  // ── Журнал ──
  /** Сохраняет отчёт об ошибках на рабочий стол, возвращает путь к файлу */
  saveReport(): Promise<string>
  /** Копия данных для переноса на другой ПК: путь к файлу .playos на рабочем столе */
  exportData(): Promise<string>
  inspectBackup(file: string): Promise<BackupInfo>
  /** Восстанавливает данные из копии и перезапускает PlayOS */
  importData(file: string): Promise<boolean>
  // ── Экран ──
  displays(): Promise<{ list: DisplayInfo[]; current: number }>
  onOverlayNotice(cb: (n: SystemNotice) => void): () => void
  // ── Страница игры и живой фон ──
  gameDetails(gameId: string, refresh?: boolean): Promise<GameDetails>
  liveBackground(gameId: string): Promise<LiveBackground | null>
  // ── Импорт Steam ──
  scanSteam(): Promise<SteamLibraryGame[]>
  importSteam(appIds: number[]): Promise<number>
  onImportProgress(cb: (p: ImportProgress) => void): () => void
}

// ───────────── Пункт управления ─────────────

export interface AudioDevice {
  id: string
  name: string
  default: boolean
}

export interface SystemState {
  volume: number | null
  muted: boolean
  devices: AudioDevice[]
  /** null — экран не поддерживает управление яркостью */
  brightness?: number | null
}

export interface ControllerInfo {
  id: string
  name: string
  kind: 'dualsense' | 'ds4' | 'xbox'
  /** Как подключён: DSX, USB, Bluetooth… */
  via?: string
  battery: BatteryLevel | null
  percent?: number
}

// ───────────── Трофеи игр (RetroAchievements и Steam) ─────────────

export type TrophyTier = 'bronze' | 'silver' | 'gold' | 'platinum'

export interface Achievement {
  id: string
  title: string
  description: string
  icon?: string
  iconLocked?: string
  earnedAt?: number
  /** Процент игроков, получивших трофей */
  rarity?: number
  points?: number
  tier: TrophyTier
  hidden?: boolean
}

export interface AchievementSet {
  source: 'ra' | 'steam'
  gameTitle?: string
  total: number
  earned: number
  items: Achievement[]
  fetchedAt: number
  url?: string
}

export interface AchievementResult {
  set?: AchievementSet
  error?: string
  /** Чего не хватает: аккаунта, привязки игры или платформа не поддерживается */
  needs?: 'ra-account' | 'steam-account' | 'link' | 'unsupported'
}

export interface AchievementSummaryItem {
  source: 'ra' | 'steam'
  earned: number
  total: number
}

export interface RaGame {
  id: number
  title: string
  icon?: string
  achievements: number
}

/** Системное уведомление поверх игры (например, разряд геймпада) */
export interface SystemNotice {
  kind: 'battery'
  title: string
  message: string
}

/** Сведения об игре для её страницы */
export interface GameDetails {
  description?: string
  developer?: string
  publisher?: string
  released?: string
  genres?: string[]
  /** Откуда описание */
  source?: 'steam' | 'wiki'
  /** Время прохождения HowLongToBeat, секунды */
  hltb?: { main?: number; plus?: number; full?: number; title: string } | null
}

/** Живой фон игры: локальный видеофайл и где его зациклить */
export interface LiveBackground {
  src: string
  /** Длительность фрагмента, сек (у обрезанного трейлера браузер её не знает) */
  loopAt?: number
}

/** Игра из библиотеки Steam, найденная на диске */
export interface SteamLibraryGame {
  appId: number
  name: string
  dir: string
  sizeOnDisk: number
  lastPlayed?: number
  /** Уже есть в PlayOS */
  added: boolean
  /** Программа, а не игра (DSX, Wallpaper Engine, Blender) — по умолчанию не отмечается */
  software?: boolean
}

export interface ImportProgress {
  done: number
  total: number
  title: string
}

export interface AchievementNotice {
  gameId: string
  gameTitle: string
  items: Achievement[]
}

export interface BackupInfo {
  version: string
  createdAt: number
  games: number
}
