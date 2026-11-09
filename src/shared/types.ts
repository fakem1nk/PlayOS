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
  /** Пройдена — стоит на полке профиля */
  done?: GameDone
  /**
   * Место в стопках прохождения: id сборки → ранг (меньше — выше). Ранг дробный — вставка между соседями без
   * перенумерации, поэтому порядок живёт в самих играх и синхронизируется между ПК вместе с ними
   */
  pile?: Record<string, number>
}

/** Оценка пройденной игры — лицом Тиви: шедевр, понравилось, нормально, так себе, не моё */
export type GameMood = 'love' | 'happy' | 'ok' | 'meh' | 'bad'

/** Игра пройдена: когда, на 100 % ли и как понравилась; наиграно и дней в пути — на момент отметки */
export interface GameDone {
  at: number
  full?: boolean
  mood?: GameMood
  /** Наиграно к финалу, секунды */
  playtime: number
  /** Дней от первой сессии до финала */
  days: number
}

/** Сборка стопки прохождения (например, марафон): название; порядок игр — в самих играх (Game.pile) */
export interface PileBuild {
  id: string
  name: string
}

/** Правка полки и стопки одной игры: null — убрать поле */
export interface ShelfChange {
  id: string
  done?: GameDone | null
  pile?: Record<string, number> | null
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

/** Короткий толчок геймпада: длительность в мс, сила моторов 0…1 */
export interface RumbleEffect {
  duration: number
  strong: number
  weak: number
}
/** Вход геймпада: кнопка, ось с направлением или крестовина-«шапка» DirectInput */
export type PadInput = { b: number } | { a: number; d: 1 | -1 } | { h: number; dir: PadDir }
/** Ручная раскладка: id геймпада из Gamepad API → действие → вход */
/** scroll — ось правого стика для прокрутки (вниз — d) */
export type PadMaps = Record<string, Partial<Record<PadAction | 'scroll', PadInput>>>
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

/** Состояние окна PlayOS: вне полного экрана у него своя рамка с кнопками */
export interface WindowMode {
  fullscreen: boolean
  maximized: boolean
}

export type WindowAction = 'fullscreen' | 'minimize' | 'maximize' | 'close'

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
  /** Лёгкая вибрация геймпада в меню: край списка, удержание ✕, открытие меню. Нет — выключена */
  menuRumble?: boolean
  /** Фоновая эмбиент-музыка на главном экране */
  music: boolean
  /** Громкость фоновой музыки (не зависит от громкости звуков интерфейса); нет — средне */
  musicVolume?: SoundVolume
  glyphs: GlyphStyle
  fullscreen: boolean
  /** Подсказку «PlayOS работает в трее» уже показали: при первом закрытии окна */
  trayHintShown?: boolean
  launchOnStartup: boolean
  /** При запуске вместе с Windows — без окна и интро, сразу в трей (открыть значком или кнопкой PS) */
  startInTray?: boolean
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
  /** Маскот Тиви в правом нижнем углу; нет — показывается */
  tivi?: boolean
  /** Магазин показывает игры для взрослых (откровенный сексуальный контент); нет — скрывает */
  storeAdult?: boolean
  /** Размер Тиви во вкладке «Недавние» (на остальных он всегда маленький); у каждого ПК свой, как и экран */
  tiviSize?: 'small' | 'medium' | 'large'
  /** Предупреждать о разряде геймпада (10%) поверх игры */
  lowBatteryWarning: boolean
  /** Папки для загрузок, которые задал пользователь; последняя выбранная — первой */
  downloadDirs?: string[]
  /** Оставлять архивы после распаковки; нет — удаляются, когда всё распаковалось */
  keepArchives?: boolean
  /** Пока идёт игра, загрузки, распаковка и раздача стоят; нет — так и есть (false — качать и во время игры) */
  downloadPauseInGame?: boolean
  /** Ограничение скорости загрузки, байт/с; нет или 0 — без ограничения. У каждого ПК своё: у них разный интернет */
  downloadLimit?: number
  /** Ограничение скорости отдачи торрентов, байт/с; нет или 0 — без ограничения */
  uploadLimit?: number
  /** Раздавать торрент после загрузки, пока не отдано seedRatio × размер; нет — раздача сразу останавливается */
  seed?: boolean
  /** До какого рейтинга раздавать (отдано / размер); нет — 1, 0 — пока раздачу не остановят */
  seedRatio?: number
  /** Всплывающие уведомления; false — тихо копятся в центре уведомлений (ошибки и ответы на действия видны всегда) */
  noticePopups?: boolean
  /** Сколько уведомление держится на экране и какого оно размера; нет — обычно */
  noticeTime?: 'short' | 'normal' | 'long'
  noticeSize?: 'small' | 'normal' | 'large'
  /** Всплывающие трофеи в PlayOS; нет — показываются */
  noticeTrophies?: boolean
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
  /** Сборки стопки прохождения в профиле; нет — одна «Основная» */
  builds?: PileBuild[]
  /** Какая сборка открыта в профиле */
  build?: string
  /** Фигурки Тиви, о которых уже сказали уведомлением */
  figuresSeen?: string[]
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

/**
 * Заставка на время установки: PlayOS закрывается, а помощник держит снимок окна и крутит поверх него
 * сценку Тиви, пока новая версия не откроется. Кадры — PNG куска вокруг Тиви вместе с фоном, rect — где он в окне
 * (CSS-пиксели), steps — номер кадра и сколько он держится (мс), по кругу
 */
export interface UpdateSplash {
  frames: Uint8Array[]
  steps: [number, number][]
  rect: { x: number; y: number; width: number; height: number }
  /** От какого момента (Date.now()) идёт счёт — заставка продолжит с того же кадра */
  t0: number
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

export type PickKind = 'exe' | 'ps2' | 'ps3' | 'ps3folder' | 'image' | 'emulator' | 'folder' | 'gamefolder' | 'backup'

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
  /** Share / View / Create — центр уведомлений */
  | 'view'
  /** Боковая кнопка мыши «вперёд»: обратное к «назад» — следующий шаг мастера, снова открыть закрытую страницу игры */
  | 'forward'
  /** Удержание ✕ на игре (там, где включён useConfirmHold) — страница игры */
  | 'hold'

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

/** Ключ API, который помогает получить инструкция: Steam Web API, RetroAchievements, SteamGridDB */
export type ApiKeyKind = 'steam' | 'ra' | 'sgdb'

/** Аккаунты, уже известные на этом ПК: последний вход в клиент Steam и логин RetroAchievements из PCSX2 */
export interface LocalAccounts {
  steam?: { id: string; name: string }
  raUser?: string
}

/** Как PlayOS удалит игру с компьютера */
export interface UninstallInfo {
  /** steam — окно удаления Steam, uninstaller — программа удаления игры, files — папка или образ в корзину */
  method: 'steam' | 'uninstaller' | 'files'
  path: string
  isFile: boolean
  /** Сколько места освободится; null — не посчитать */
  size: number | null
  /** Удалить нельзя — причина для пользователя */
  blocked?: string
}

export interface UninstallResult {
  ok: boolean
  error?: string
  /** Удаление продолжается в Steam или программе удаления игры */
  started?: 'steam' | 'uninstaller'
  /** Корзина не приняла игру (больше корзины или диск без неё) — можно удалить насовсем */
  noTrash?: boolean
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

/**
 * pending — с запуска PlayOS ещё не проверялось; playing — игра запущена, файлы заняты; steam — сохранения хранит Steam Cloud;
 * full — в облаке нет места; signin — вход отозван или устарел, нужно войти снова
 */
export type CloudSyncState = 'off' | 'synced' | 'syncing' | 'pending' | 'playing' | 'steam' | 'conflict' | 'offline' | 'full' | 'signin' | 'error' | 'nosaves'

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
  /** Как удалить игру с компьютера: способ, папка и размер */
  uninstallInfo(id: string): Promise<UninstallInfo | null>
  /** Удалить игру с компьютера. keep — оставить в библиотеке неустановленной; permanent — мимо корзины */
  uninstallGame(id: string, opts: { keep: boolean; permanent?: boolean }): Promise<UninstallResult>
  setFavorite(id: string, value: boolean): Promise<void>
  /** Полка и стопка: отметка «Пройдено» и место в сборках, сразу у нескольких игр */
  shelfPatch(changes: ShelfChange[]): Promise<void>
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
  /** EXE игры в папке: самый похожий на игру файл; null — ничего подходящего */
  findGameExe(dir: string): Promise<string | null>
  searchArt(query: string, platform: Platform, serial?: string, source?: ArtSource): Promise<ArtCandidate[]>
  scanPs2Folder(): Promise<number>
  importRpcs3(): Promise<number>
  openFolder(path: string): Promise<void>
  power(action: PowerAction): Promise<void>
  onState(cb: (s: AppState) => void): () => void
  onPad(cb: (a: PadAction) => void): () => void
  onOverlay(cb: (e: OverlayEvent) => void): () => void
  onSessionEnd(cb: (e: SessionEndEvent) => void): () => void
  onToast(cb: (t: { title: string; message: string; history?: false }) => void): () => void
  onPadStatus(cb: (s: PadStatus) => void): () => void
  /** Идёт игра, и PlayOS не на переднем плане: геймпад принадлежит игре */
  onPadBlock(cb: (blocked: boolean) => void): () => void
  /** Вибрация DualSense по HID (Gamepad API её не умеет) */
  padRumble(fx: RumbleEffect): void
  /** Окно перешло в полный экран или вышло из него, развернулось или вернулось к прежнему размеру */
  onWindowMode(cb: (mode: WindowMode) => void): () => void
  /** Кнопки рамки окна: полный экран, свернуть, развернуть, закрыть (в трей) */
  windowControl(action: WindowAction): Promise<void>
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
  /** Открыть страницу ключа или настроек в браузере; PlayOS свернётся, чтобы браузер был виден */
  openKeyPage(url: string): Promise<void>
  /** Следить за буфером обмена: скопировали ключ — придёт onKeyFound, и PlayOS вернётся на экран. null — перестать */
  watchKeyClipboard(kind: ApiKeyKind | null): Promise<void>
  /** Ключ из буфера обмена прямо сейчас; null — там не ключ */
  keyFromClipboard(kind: ApiKeyKind): Promise<string | null>
  onKeyFound(cb: (e: { kind: ApiKeyKind; key: string }) => void): () => void
  localAccounts(): Promise<LocalAccounts>
  onAchievements(cb: (n: AchievementNotice) => void): () => void
  onAchievementSummary(cb: () => void): () => void
  onOverlayToast(cb: (n: AchievementNotice) => void): () => void
  // ── Загрузка арта при сохранении ──
  cancelSave(): Promise<void>
  onSaveProgress(cb: (p: SaveProgress) => void): () => void
  // ── DualSense ──
  // ── Выход и питание ──
  onPowerResume(cb: () => void): () => void
  // ── О системе ──
  systemInfo(): Promise<SystemInfo>
  // ── Обновления ──
  updateState(): Promise<UpdateState>
  checkUpdates(): Promise<UpdateState>
  installUpdate(splash?: UpdateSplash): Promise<boolean>
  /** Экран «готово» после обновления нарисован — можно показать окно и убрать заставку установки */
  updateShown(): void
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
  // ── Магазин ──
  /** Витрина: из кэша сразу, свежая версия потом приходит в onStoreHome */
  storeHome(refresh?: boolean): Promise<StoreHome>
  onStoreHome(cb: (h: StoreHome) => void): () => void
  storeSearch(query: string): Promise<StoreItem[]>
  /** Каталог игр Steam: страница с сортировкой и фильтрами */
  storeBrowse(query: StoreBrowseQuery): Promise<StoreBrowsePage>
  /** Названия меток Steam на языке интерфейса и сколько с ними игр (счётчики догружаются в фоне) */
  storeTagInfo(ids: number[]): Promise<Record<number, StoreTagInfo>>
  storePage(appId: number): Promise<StorePage | null>
  /** Сколько вариантов загрузки у игры, с уточнением одноимённых у Steam (дольше, чем страница) */
  storeOptionCount(appId: number, title: string): Promise<number>
  /** Время прохождения по HowLongToBeat */
  storeHltb(appId: number, title: string): Promise<GameDetails['hltb']>
  storeSteam(): Promise<StoreSteam>
  /** Страница игры в клиенте Steam или в браузере */
  storeOpen(appId: number, how: 'store' | 'web'): Promise<void>
  /** Добавить игру магазина в библиотеку (без файлов — её потом скачивают). Возвращает id игры или null */
  storeAddToLibrary(appId: number, title: string): Promise<string | null>
  storeSources(): Promise<StoreSource[]>
  /** Добавить источник: скачивается и проверяется сразу; что не так — в error */
  storeSourceAdd(url: string): Promise<{ source?: StoreSource; error?: string }>
  /** Источник из JSON-файла на диске (окно выбора файла); выбор отменили — пустой ответ */
  storeSourceAddFile(): Promise<{ source?: StoreSource; error?: string }>
  /** Источник из файла, который перетащили в окно */
  storeSourceAddPath(file: string): Promise<{ source?: StoreSource; error?: string }>
  /** Путь на диске у перетащенного файла (пусто — файл не с диска) */
  pathForFile(file: File): string
  storeSourceRemove(id: string): Promise<void>
  storeSourcesRefresh(): Promise<StoreSource[]>
  storeSourceRefresh(id: string): Promise<StoreSource[]>
  /** Ссылка из буфера обмена, если там ссылка http(s); иначе пустая строка */
  storeClipboardUrl(): Promise<string>
  /** Варианты загрузки игры из всех источников, свежие первыми */
  /** Варианты загрузки игры; platform — для игр эмуляторов (PS2, PS3), по умолчанию PC */
  storeOptions(appId: number, title: string, platform?: Platform): Promise<DownloadOption[]>
  /** «Не та игра»: варианты с этим ключом больше не показываются у этой игры */
  storeUnbind(appId: number, key: string): Promise<void>
  /** Ссылка варианта: скопировать (несколько — строками) или открыть в программе, которая её понимает */
  storeLink(uris: string[], how: 'copy' | 'open'): Promise<void>
  // ── Загрузки ──
  downloads(): Promise<DownloadJob[]>
  /** Какие ссылки PlayOS качает сам: прямые всегда, торренты — если на месте его торрент-клиент */
  downloadKinds(): Promise<DownloadKind[]>
  /** Очередь целиком при каждом изменении; пока качается — не чаще пары раз в секунду */
  onDownloads(cb: (jobs: DownloadJob[]) => void): () => void
  downloadStart(req: DownloadRequest): Promise<{ job?: DownloadJob; error?: string }>
  /** Пауза, продолжить, отменить, убрать из списка, удалить файлы, порядок очереди, открыть папку, убрать готовые */
  downloadControl(id: string, action: DownloadControl): Promise<void>
  /** Файлы торрента и какие из них не качать; null — список ещё не известен */
  downloadFiles(id: string): Promise<{ files: TorrentFile[]; skip: number[] } | null>
  /** Какие файлы торрента не качать (номера из списка файлов) */
  downloadSetFiles(id: string, skip: number[]): Promise<void>
  /** Пароль от архива загрузки — распаковка продолжается с ним */
  downloadPassword(id: string, password: string): Promise<void>
  /** Папки загрузок пользователя со свободным местом */
  downloadFolders(): Promise<DownloadFolder[]>
  /** Диски этого ПК для новой папки */
  downloadDrives(): Promise<DownloadDrive[]>
  /** Создать папку (если её нет) и добавить в список */
  downloadFolderAdd(path: string): Promise<{ folder?: DownloadFolder; error?: string }>
  /** Выбрать папку окном Windows (для мыши); null — отменили */
  downloadFolderBrowse(): Promise<string | null>
  downloadFolderRemove(path: string): Promise<void>
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

// ───────────────────────── Магазин ─────────────────────────

/** Когда выходит игра, которой ещё нет: точная дата, месяц, квартал, год, «скоро» или «не объявлена» */
export type StoreUpcoming = 'date' | 'month' | 'quarter' | 'year' | 'soon' | 'tba'

/** Игра в магазине (каталог Steam, всегда регион US — региональные запреты ничего не прячут) */
export interface StoreItem {
  /** Номер игры в магазине: Steam AppID; у игр не из Steam — отрицательный (gogStoreId, SRC_BASE) */
  appId: number
  title: string
  /** Игра не из Steam: из каталога GOG или есть только в источниках пользователя */
  store?: 'gog' | 'sources'
  /** Страница игры в GOG */
  link?: string
  /** Вертикальная обложка 600×900 */
  cover?: string
  /** Широкий арт для фона и баннера */
  hero?: string
  logo?: string
  /** Горизонтальная шапка 460×215 — запасная картинка, если обложки нет */
  header?: string
  /** Дата выхода, мс */
  released?: number
  /** Ещё не вышла — насколько известна дата */
  upcoming?: StoreUpcoming
  short?: string
  tags?: string[]
  reviews?: { percent: number; count: number; label: string }
  /** Сколько вариантов загрузки нашлось в источниках пользователя */
  options?: number
  /** Откровенный сексуальный контент (метки Steam 3 и 4): без settings.storeAdult магазин такие игры не показывает */
  adult?: boolean
}

/**
 * Игры не из Steam живут в магазине под отрицательными номерами — так их не спутать с AppID: игра GOG — минус её id
 * в GOG (до двух миллиардов), игра только из источников — ниже −SRC_BASE
 */
export const SRC_BASE = 1e10
export const gogStoreId = (gogId: number) => -gogId
export const gogIdOf = (appId: number) => (appId < 0 && -appId < SRC_BASE ? -appId : 0)
export const isSteamItem = (appId: number) => appId > 0

/** sources — «Новинки и свежие обновления»: свежие загрузки, по одной на игру; gog — игры GOG, которых нет в Steam */
export type StoreRowId = 'sources' | 'top' | 'new' | 'played' | 'gog' | 'soon'

export interface StoreRow {
  /** Свои ряды витрины или ряд жанра: tag-<id метки Steam> */
  id: StoreRowId | `tag-${number}`
  items: StoreItem[]
  /** Название ряда жанра (у своих рядов название в интерфейсе) */
  title?: string
  /** Метка Steam ряда жанра: в конце ряда — «Все игры жанра» */
  tag?: number
}

/** Сортировка каталога: популярные, новинки, лучшие по отзывам, по названию */
export type StoreSort = 'popular' | 'new' | 'reviews' | 'name'

/** Фильтры каталога игр Steam (как в подборе игр на сайтах раздач: жанры, год, отзывы, русский язык) */
export interface StoreFilters {
  /** Отмеченные метки Steam: у игры должна быть каждая */
  tags?: number[]
  /** Один год выхода или десятилетие (2010 — 2010–2019) */
  year?: number
  decade?: number
  /** Доля положительных отзывов не ниже, % */
  reviews?: number
  /** Отзывов не меньше */
  minReviews?: number
  ruText?: boolean
  ruVoice?: boolean
  /** Без раннего доступа */
  noEarly?: boolean
  /** Только игры, у которых есть варианты загрузки в источниках */
  downloadable?: boolean
}

/** Страница каталога игр Steam */
export interface StoreBrowseQuery extends StoreFilters {
  sort: StoreSort
  start: number
}

export interface StoreBrowsePage {
  items: StoreItem[]
  /** Сколько игр подходит; с фильтрами, которые Steam не умеет (отзывы, язык, «Можно скачать»), неизвестно */
  total?: number
  /** start следующей страницы; нет — это последняя */
  next?: number
}

/** Название метки Steam на языке интерфейса и сколько с ней игр в каталоге */
export interface StoreTagInfo {
  name: string
  count?: number
}

/** Десятилетия в фильтре года: даты Steam начинаются с 2003, игры старше — с датой выхода в Steam */
export const STORE_DECADES = [2020, 2010, 2000]

/** Метка Steam «Ранний доступ» — для «Без раннего доступа» */
export const STORE_EARLY_ACCESS = 493

/**
 * Группы фильтров каталога — метки Steam (id; названия — от Steam на языке интерфейса). title — ключ перевода.
 * open — раскрыта сразу, show — сколько меток видно до «Ещё»
 */
export const STORE_FILTER_GROUPS: { id: string; title: string; tags: number[]; open?: boolean; show?: number }[] = [
  { id: 'genres', title: 'Жанры', open: true, tags: [19, 122, 21, 9, 599, 1774, 1667, 1664, 1625, 699, 701, 1743, 3810, 3799, 1773] },
  {
    id: 'sub',
    title: 'Поджанры и форматы',
    open: true,
    show: 10,
    tags: [
      1695, 1662, 4231, 4434, 1663, 3814, 1716, 3959, 29482, 1628, 1741, 1676, 4364, 4328, 10235, 87918, 1646, 1720, 1698, 5900, 1666, 32322,
      1645, 1687, 176981, 1754, 9204, 21725, 10695, 4474, 3978, 1721, 5613, 12472, 255534, 220585, 7332, 1702, 1752, 1738, 5537, 4885, 4158,
      1023537, 353880, 1199779, 492, 597
    ]
  },
  { id: 'camera', title: 'Вид камеры', tags: [3839, 1697, 4791, 5851, 3798, 3871, 4191, 4975] },
  { id: 'modes', title: 'Режимы игры', tags: [4182, 3859, 1685, 3843, 3841, 10816, 1775, 6730, 128] },
  { id: 'style', title: 'Визуальный стиль', tags: [3964, 4085, 4195, 4175, 4252, 6815, 4004, 4305, 4094, 5411, 4145] },
  { id: 'story', title: 'Сюжет и прохождение', tags: [1742, 6426, 6971, 7208, 7250, 6869, 1756, 4234, 4711, 3854] },
  { id: 'world', title: 'Мир и эпоха', tags: [3942, 1684, 4604, 3835, 4172, 4115, 1755, 3987, 1659, 4150, 4168, 1647, 7432, 16094, 1681, 1777] },
  { id: 'mood', title: 'Настроение и атмосфера', tags: [4166, 4342, 1654, 4136, 4726, 4026, 5716, 5608, 552282, 97376, 1710, 1719, 5923, 4345, 4667] }
]

/** Ряды жанров на витрине — после «Самых популярных» */
export const STORE_GENRE_ROWS = [19, 122, 9, 21, 599]

export interface StoreHome {
  rows: StoreRow[]
  fetchedAt: number
}

/** Кусок описания: заголовок, абзац или пункт списка */
export interface StoreBlock {
  kind: 'h' | 'p' | 'li'
  text: string
}

/** Страница игры в магазине */
export interface StorePage extends StoreItem {
  about: StoreBlock[]
  developers: string[]
  publishers: string[]
  franchise?: string
  /** Скриншоты: превью и полный размер */
  screenshots: { thumb: string; full: string }[]
  /** Короткий беззвучный ролик для шапки */
  trailer?: string
}

/** Steam на этом ПК: стоит ли клиент и какие игры установлены */
export interface StoreSteam {
  client: boolean
  installed: number[]
}

/** Источник загрузок: JSON по ссылке, которую добавил сам пользователь. PlayOS источников не поставляет */
export interface StoreSource {
  id: string
  url: string
  name: string
  addedAt: number
  /** Когда последний раз удалось скачать */
  updatedAt?: number
  /** Загрузок со ссылками */
  count: number
  /** Разных игр среди загрузок */
  games?: number
  /** Почему не обновился в последний раз */
  error?: string
}

/** Ссылка загрузки: магнет, .torrent-файл или обычная ссылка (файл или страница файлообменника) */
export type DownloadKind = 'magnet' | 'torrent' | 'http'

/** Вариант загрузки игры из источника */
export interface DownloadOption {
  /** Ключ названия: по нему «Не та игра?» отвязывает вариант от игры */
  key: string
  sourceId: string
  source: string
  /** Название загрузки как в источнике */
  title: string
  uris: string[]
  kind: DownloadKind
  /** Размер как в источнике: «12.4 GB» */
  size?: string
  /** Дата публикации, мс */
  date?: number
}

/** queued — ждёт очереди, active — качается, paused — на паузе, error — остановилась, done — скачана */
export type DownloadStatus = 'queued' | 'active' | 'paused' | 'error' | 'done'

/** Загрузка в очереди PlayOS */
export interface DownloadJob {
  id: string
  /** Игра библиотеки, ради которой качаем */
  gameId?: string
  /** Название игры */
  title: string
  /** Название раздачи из источника */
  name: string
  cover?: string
  /** Широкий арт игры — фон раздела «Загрузки» */
  hero?: string
  kind: DownloadKind
  /** Ссылки варианта: зеркала, пробуются по очереди */
  uris: string[]
  /** Папка загрузки: папка пользователя\название игры */
  dir: string
  /** Файл загрузки, когда его имя уже известно (пока качается — рядом с суффиксом .part) */
  file?: string
  status: DownloadStatus
  received: number
  /** Полный размер, байт; 0 — пока неизвестен */
  size: number
  /** Скорость, байт/с — только пока качается */
  speed?: number
  /** Торрент: ищет список файлов или проверяет уже скачанное; extracting — скачано, распаковываются архивы */
  phase?: 'metadata' | 'checking' | 'extracting'
  /** Скачано целиком: повтор после ошибки распаковки не качает заново */
  downloaded?: boolean
  /** Архивы, которые ещё надо распаковать (первые части); нет — ещё не искали */
  archives?: string[]
  /** Распаковка: сколько байт распаковано из скольких */
  unpack?: { done: number; total: number }
  /** Что распаковка положила на диск (верхний уровень) — удаляется вместе с загрузкой */
  unpacked?: string[]
  /** Архиву нужен пароль (или введённый не подошёл): «Ввести пароль» вместо «Повторить» */
  needPassword?: boolean
  /** Пароль от архива, который ввёл пользователь */
  password?: string
  /**
   * После загрузки: ready — нашёлся установщик, ждёт «Установить»; running — установщик открыт; installed — игра
   * в библиотеке, можно играть; manual — игру не нашли, файл указывает пользователь
   */
  install?: 'ready' | 'running' | 'installed' | 'manual'
  /** Установщик, который запускает «Установить» */
  installer?: string
  /** Почему установка не завершилась */
  installError?: string
  /** Торрент: с кем соединён */
  peers?: number
  /** Торрент: сколько файлов в раздаче (без служебных); больше одного — можно выбрать, какие качать */
  fileCount?: number
  /** Торрент: номера файлов, которые не качаем */
  skip?: number[]
  /** Торрент скачан и раздаётся, пока не отдано seedRatio × размер */
  seeding?: boolean
  /** Торрент: сколько отдано за всё время, байт */
  uploaded?: number
  /** Скорость отдачи, байт/с — только пока раздаётся */
  upSpeed?: number
  /** Ждёт своей очереди, потому что идёт игра (пауза на время игры) — только в интерфейсе, не сохраняется */
  held?: boolean
  /** Распакованные архивы (первые части), оставленные только ради раздачи: удаляются, когда она закончится */
  keptArchives?: string[]
  error?: string
  addedAt: number
  doneAt?: number
}

/** Файл торрента: номер в раздаче, путь внутри неё, размер */
export interface TorrentFile {
  i: number
  p: string
  s: number
}

/** Что скачать и куда */
export interface DownloadRequest {
  gameId?: string
  title: string
  name: string
  cover?: string
  hero?: string
  kind: DownloadKind
  uris: string[]
  /** Размер из источника («12.4 GB») — для проверки места, пока сервер не назвал точный */
  size?: string
  /** Папка пользователя из списка папок загрузок */
  folder: string
}

/** Папка для загрузок, которую задал пользователь */
export interface DownloadFolder {
  path: string
  /** Свободно на диске, байт */
  free: number
  /** Весь диск, байт — для полоски заполненности */
  total: number
  /** Папка есть и в неё можно писать */
  ok: boolean
}

/** Диск для новой папки загрузок */
export interface DownloadDrive {
  root: string
  free: number
  total: number
}

/**
 * up/down — на место выше или ниже в очереди; now — качать сейчас: первой в очереди, текущая загрузка уступает
 * (и во время игры — несмотря на паузу на время игры); stopSeed — остановить раздачу
 */
export type DownloadControl = 'pause' | 'resume' | 'cancel' | 'remove' | 'deleteFiles' | 'up' | 'down' | 'now' | 'stopSeed' | 'folder' | 'clearDone' | 'install'

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
