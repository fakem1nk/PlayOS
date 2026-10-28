export type Platform = 'pc' | 'ps2' | 'ps3'

export const PLATFORM_NAMES: Record<Platform, string> = {
  pc: 'PC',
  ps2: 'PlayStation 2',
  ps3: 'PlayStation 3'
}

/** Платформа для подписей: у VR-игр — «PC · VR» */
export const platformName = (g: { platform: Platform; vr?: unknown }) => PLATFORM_NAMES[g.platform] + (g.vr ? ' · VR' : '')

export interface Session {
  start: number
  duration: number // секунды
}

export interface Game {
  id: string
  /** Ключ игры в облачной библиотеке — запоминается при первой синхронизации и больше не меняется */
  cloudKey?: string
  title: string
  platform: Platform
  /** EXE для PC, образ/EBOOT.BIN для эмуляторов */
  path: string
  /** Папка установки PC-игры: размер, локальные файлы, поиск сохранений и процессов игры. Своя на каждом ПК */
  installDir?: string
  /** Параметры запуска: аргументы EXE (PC) или добавка к команде эмулятора ({args} в шаблоне) */
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
  /** Какой версией алгоритма посчитан accent (main/color.ts) */
  accentV?: number
  favorite?: boolean
  playtime: number // секунды
  lastPlayed?: number
  addedAt: number
  sessions: Session[]
  /** false — оверлей в этой игре выключен: кнопка PS/Guide остаётся игре */
  overlay?: boolean
  /** Свои папки сохранений — важнее найденных автоматически */
  saveDirs?: string[]
  /** false — сохранения этой игры не синхронизируются с облаком */
  cloudSaves?: boolean
  /** Когда игру меняли в редакторе (или избранное) — для слияния библиотеки между ПК */
  updatedAt?: number
  /** Время сыграно по ПК (короткий id → секунды) поверх playtimeBase: каждый ПК наращивает только свой счётчик */
  playtimeBy?: Record<string, number>
  /** Время до облака (импорт, старые версии PlayOS) */
  playtimeBase?: number
  /** Время игры сбрасывали: сессии и счётчики раньше этого момента не возвращаются из облака */
  resetAt?: number
  /** Откуда скачан арт (ссылки): в облако уходят только они, другой ПК скачает арт сам */
  artSrc?: Partial<Record<'cover' | 'coverAnimated' | 'hero' | 'logo' | 'icon', string>>
  /** Есть — это VR-игра: перед запуском PlayOS ставит рантайм и пишет opencomposite.ini */
  vr?: GameVr
}

// ── VR ──

/** VR-API, найденные в папке игры по их DLL */
export type VrApiKind = 'openvr' | 'openxr' | 'oculus'

/** Настройки игры в шлеме — пишутся в opencomposite.ini в рабочей папке игры */
export interface OcSettings {
  /** Чёткость: множитель разрешения рендера, 1.0 = 100% */
  supersampleRatio: number
  renderCustomHands: boolean
  haptics: boolean
}

export const OC_DEFAULTS: OcSettings = {
  supersampleRatio: 1,
  renderCustomHands: true,
  haptics: true
}

export interface GameVr {
  /** undefined — ещё не проверяли */
  apis?: VrApiKind[]
  /** Режим совместимости: игра, которая не идёт через OpenComposite, запускается через SteamVR */
  compat?: boolean
  /** Свои настройки; нет — значения по умолчанию */
  oc?: OcSettings
  /** Игра упала в первые секунды через OpenComposite: время сбоя и код выхода */
  crash?: { at: number; code: number | null }
}

export interface QuestStatus {
  /** Шлем хоть раз подключался к этому ПК */
  found: boolean
  connected: boolean
  model?: string
  /** Кабель (Link) или Wi-Fi (Air Link) */
  link?: 'cable' | 'air'
  /** Заряд в процентах */
  battery?: number
  left?: number
  right?: number
  /** Контроллер уснул без движения: заряд — последний известный */
  leftIdle?: boolean
  rightIdle?: boolean
}

export interface VrStatus {
  /** VR-компонент (OpenComposite) */
  oc: { installed: boolean; installedAt?: number }
  /** Активный OpenXR-рантайм — Meta Horizon Link: без него шлем через Link не заработает */
  meta: boolean
  quest: QuestStatus
}

export interface VrResult {
  ok: boolean
  error?: string
}

/** Черновик из редактора. Поля арта могут быть http-ссылками — main скачает их при сохранении. */
/** Что облако нашло для игры: показывается в редакторе, чтобы было видно, откуда берутся сохранения */
export interface SavePreview {
  /** Общая папка найденных файлов сохранений */
  dir?: string
  files: number
  /** Часть сохранений лежит в реестре (HKCU) */
  registry: boolean
  /** AppID, найденный рядом с игрой (steam_appid.txt и подобные) */
  appId?: number
  /** Почему искать не стали: steam — их хранит Steam Cloud, off — облако для игры выключено */
  skipped?: 'steam' | 'off'
}

export type GameDraft = Omit<Game, 'id' | 'playtime' | 'addedAt' | 'sessions'> & { id?: string }

export type GlyphStyle = 'auto' | 'playstation' | 'xbox' | 'nintendo' | 'keyboard'

export type PadDir = 'up' | 'down' | 'left' | 'right'
/** Вход геймпада: кнопка, ось с направлением или крестовина-«шапка» DirectInput */
export type PadInput = { b: number } | { a: number; d: 1 | -1 } | { h: number; dir: PadDir }
/** Ручная раскладка: id геймпада из Gamepad API → действие → вход */
export type PadMaps = Record<string, Partial<Record<PadAction, PadInput>>>
export type SoundVolume = 'low' | 'mid' | 'high'

/** Проверка аккаунтов трофеев: off — не заполнено, ok — подключено, error — ключ или профиль не подошли */
export interface AccountStatus {
  state: 'off' | 'ok' | 'error'
  text: string
}
export interface TrophyAccounts {
  ra: AccountStatus
  steam: AccountStatus
}

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
  /** Громкость фоновой музыки (не зависит от громкости звуков интерфейса); нет — средне */
  musicVolume?: SoundVolume
  glyphs: GlyphStyle
  fullscreen: boolean
  launchOnStartup: boolean
  /** Полученные трофеи PlayOS: id → время получения */
  trophies: Record<string, number>
  /** Горячая клавиша сохранения состояния в RPCS3 (например, Ctrl+S) */
  rpcs3SaveKey: string
  /** Пауза игры, пока открыт оверлей: заморозка процесса */
  pauseOnOverlay: 'all' | 'emulators' | 'off'
  /** Выгружать интерфейс на время игры (остаётся только оверлей); undefined — включено */
  freeMemoryInGame?: boolean
  /** Оверлей поверх игр: false — кнопка PS/Guide в игре не вызывает PlayOS */
  overlayEnabled: boolean
  /** Облачные сохранения и профиль; без входа и с выключенными переключателями всё остаётся локальным */
  cloud?: CloudSettings
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
  /** Сохранять кадр игры в момент получения трофея */
  trophyShots: boolean
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
  /** Экран для игр эмуляторов: 0 или нет — где откроет сам эмулятор, -1 — там же, где PlayOS, иначе id дисплея */
  gameDisplay?: number
  gameDisplayLabel?: string
  /** Мастер первого запуска пройден */
  onboarded: boolean
  /** Бета-тест: получать и ранние версии (pre-release на GitHub) */
  betaUpdates: boolean
  /** Кнопки, назначенные вручную для геймпадов без стандартной раскладки */
  padMaps?: PadMaps
  /** Язык интерфейса; по умолчанию — по языку Windows */
  language?: 'ru' | 'en'
  /** Тема интерфейса; по умолчанию тёмная */
  theme?: ThemeMode
  /** Свои подборки игр в библиотеке («плейлисты»); у каждого ПК свои — id игр на разных ПК не совпадают */
  collections?: GameCollection[]
  /** Сортировка библиотеки; по умолчанию — недавние */
  librarySort?: LibrarySort
}

/** Подборка: название и игры в порядке добавления */
export interface GameCollection {
  id: string
  name: string
  games: string[]
}

/** manual — порядок подборки, имеет смысл только внутри подборки */
export type LibrarySort = 'recent' | 'name' | 'time' | 'added' | 'manual'

/** dark — тёмная, light — светлая, system — как в Windows */
export type ThemeMode = 'dark' | 'light' | 'system'

/** Состояние обновлений PlayOS */
export interface UpdateState {
  /** dev — запущено из исходников, обновлять нечего */
  phase: 'idle' | 'dev' | 'checking' | 'latest' | 'downloading' | 'ready' | 'error'
  current: string
  version?: string
  /** Скачанная версия — возврат с беты на стабильную (выключили бета-тест) */
  rollback?: boolean
  percent?: number
  /** Скачано и всего, в байтах */
  transferred?: number
  total?: number
  notes?: string
  /** Короткая сводка для окна обновления (update-summary.json в релизе); у старых релизов её нет */
  summary?: UpdateSummary
  error?: string
  checkedAt?: number
}

/** Пункты сводки на одном языке */
export interface UpdateSummaryText {
  new?: string[]
  fixed?: string[]
}

/**
 * Сводка обновления: scripts/notes/<версия>.app.json → update-summary.json в релизе.
 * importance решает, как показать обновление без новых функций: critical — окно с советом обновиться сейчас,
 * normal — обычное окно, minor — без окна, только короткая карточка «установится при выходе».
 */
export interface UpdateSummary {
  importance?: 'critical' | 'normal' | 'minor'
  ru?: UpdateSummaryText
  en?: UpdateSummaryText
}

/** Сведения для окна «О системе» */
export interface SystemInfo {
  app: { version: string; electron: string; chrome: string; installDir: string; dataDir: string; packaged: boolean }
  os: { name: string; build: string; uptimeMin: number }
  cpu: { model: string; threads: number }
  gpu: string
  memory: { total: number; free: number }
  /** Локальные диски: буква («C:»), объём и свободное место в байтах */
  disks: { name: string; total: number; free: number }[]
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
  /** Папка установки, угаданная по EXE (без bin, x64, Binaries…) */
  installDir?: string
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
  /** Запуск отменили — сессии не было */
  aborted?: boolean
}

/** Где лежит игра: папка установки или файл образа; size — null, если папку не посчитать (корень диска и т.п.) */
export interface GameFiles {
  path: string
  isFile: boolean
  size: number | null
}

/** Что поправить, чтобы игра запустилась: файл игры в редакторе или путь к эмулятору в настройках */
export type LaunchFix = 'game' | 'emulator'

export interface LaunchResult {
  ok: boolean
  error?: string
  fix?: LaunchFix
  /** Сохранения разошлись с облаком — игра не запущена, нужен выбор пользователя */
  conflict?: SaveConflict
  /** Запуск отменили, пока он готовился — игра не запущена или уже остановлена */
  cancelled?: boolean
}

// ── Облачные сохранения ──

export type CloudProviderId = 'yandex' | 'google' | 'folder'

export interface CloudSettings {
  provider?: CloudProviderId
  /** Папка для провайдера folder (OneDrive, Syncthing, сетевой диск) */
  folder?: string
  /** Синхронизировать сохранения игр */
  saves: boolean
  /** Сколько версий каждого сохранения хранить в облаке */
  keepVersions: number
  /** Синхронизировать и быстрые сохранения PCSX2 (sstates) — они большие */
  ps2States?: boolean
  /** Имя, аватар, трофеи и настройки, не привязанные к этому ПК */
  profile?: boolean
  /** Список игр, время, сессии, избранное и арт */
  library?: boolean
}

/** В облаке уже есть профиль: PlayOS предлагает его подтянуть (после переустановки или на новом ПК) */
export interface CloudRestoreOffer {
  name: string
  device: string
  at: number
  games: number
  /** На этом ПК уже есть игры — данные объединятся */
  merge: boolean
}

export interface CloudRestoreChoice {
  profile: boolean
  library: boolean
  saves: boolean
}

export interface CloudAccount {
  provider: CloudProviderId
  name: string
  /** Место в облаке, байты */
  used?: number
  total?: number
}

/** Вход по коду: пользователь открывает адрес на телефоне и вводит код */
export interface CloudDeviceCode {
  url: string
  code: string
  expiresAt: number
}

/** pending — с запуска PlayOS ещё не проверялось; playing — игра запущена, файлы заняты; steam — сохранения хранит Steam Cloud */
export type CloudSyncState = 'off' | 'synced' | 'syncing' | 'pending' | 'playing' | 'steam' | 'conflict' | 'offline' | 'error' | 'nosaves'

export interface SaveVersion {
  name: string
  at: number
  device: string
  size: number
  hash: string
}

export interface SaveConflict {
  gameId: string
  key: string
  local: { at: number; size: number }
  cloud: SaveVersion
}

export interface GameCloudStatus {
  state: CloudSyncState
  lastSync?: number
  /** Размер сохранений на этом ПК */
  size?: number
  error?: string
  conflict?: SaveConflict
  /** Где искали и нашли сохранения — для подсказки в редакторе */
  dirs?: string[]
}

export interface CloudStatus {
  account: CloudAccount | null
  /** Вход в процессе: показать код */
  pending?: CloudDeviceCode
  state: CloudSyncState
  lastSync?: number
  error?: string
  /** Провайдеры, для которых в сборке есть ключи приложения */
  available: CloudProviderId[]
  restore?: CloudRestoreOffer
}

export type PowerAction = 'shutdown' | 'restart' | 'sleep' | 'quit'

export interface PcsApi {
  getState(): Promise<AppState>
  saveGame(draft: GameDraft): Promise<Game>
  deleteGame(id: string): Promise<void>
  setFavorite(id: string, value: boolean): Promise<void>
  resetPlaytime(id: string): Promise<void>
  saveSettings(patch: Partial<Settings>): Promise<Settings>
  /** skipSync — запустить без проверки облака (после «Позже» в диалоге конфликта) */
  launch(id: string, opts?: { skipSync?: boolean }): Promise<LaunchResult>
  closeGame(): Promise<void>
  /** Отменить запуск: игра не стартует, а если уже стартовала — закрывается, время не идёт */
  cancelLaunch(id: string): Promise<void>
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
  /** Идёт игра, и PlayOS не на переднем плане: геймпад принадлежит игре */
  onPadBlock(cb: (blocked: boolean) => void): () => void
  /** Окно перешло в полный экран или вышло из него */
  onWindowMode(cb: (fullscreen: boolean) => void): () => void
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
  testTrophyAccounts(): Promise<TrophyAccounts>
  onAchievements(cb: (n: AchievementNotice) => void): () => void
  onAchievementSummary(cb: () => void): () => void
  onOverlayToast(cb: (n: AchievementNotice) => void): () => void
  // ── Загрузка арта при сохранении ──
  cancelSave(): Promise<void>
  onSaveProgress(cb: (p: SaveProgress) => void): () => void
  // ── DualSense ──
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
  /** Папка (или файл образа) игры на диске и её размер */
  gameFiles(gameId: string): Promise<GameFiles | null>
  /** Где облако найдёт сохранения игры из черновика редактора */
  savePreview(draft: GameDraft): Promise<SavePreview | null>
  // ── Облако ──
  cloudStatus(): Promise<CloudStatus>
  onCloudStatus(cb: (s: CloudStatus) => void): () => void
  cloudSignIn(provider: CloudProviderId, folder?: string): Promise<CloudStatus>
  cloudCancelSignIn(): Promise<void>
  cloudSignOut(): Promise<void>
  cloudSyncNow(): Promise<CloudStatus>
  gameCloud(gameId: string): Promise<GameCloudStatus>
  cloudResolve(gameId: string, choice: 'local' | 'cloud'): Promise<void>
  cloudVersions(gameId: string): Promise<SaveVersion[]>
  cloudRestore(gameId: string, name: string): Promise<void>
  /** Ответ на предложение подтянуть профиль из облака; null — «Не сейчас» */
  cloudRestoreChoice(choice: CloudRestoreChoice | null): Promise<void>
  liveBackground(gameId: string): Promise<LiveBackground | null>
  // ── Импорт Steam ──
  scanSteam(): Promise<SteamLibraryGame[]>
  importSteam(appIds: number[]): Promise<number>
  onImportProgress(cb: (p: ImportProgress) => void): () => void
  // ── VR ──
  vrStatus(): Promise<VrStatus>
  /** Шлем для верхней панели; дальше изменения приходят в onVrQuest */
  vrQuest(): Promise<QuestStatus>
  onVrQuest(cb: (q: QuestStatus) => void): () => void
  /** Скачать или обновить VR-компонент; прогресс — 0..1 */
  vrInstallOc(): Promise<VrResult>
  vrCheckOc(): Promise<{ update: boolean; error?: string }>
  onVrProgress(cb: (p: number) => void): () => void
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
  /** Кадр игры в момент получения (файл в папке арта игры) */
  shot?: string
}

export interface AchievementSet {
  /** local — файлы эмулятора Steam у пиратской или DRM-free сборки, названия и значки из Steam */
  source: 'ra' | 'steam' | 'local'
  /** Чей файл прочитан: RUNE, CODEX, Goldberg… */
  emulator?: string
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
  source: 'ra' | 'steam' | 'local'
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
