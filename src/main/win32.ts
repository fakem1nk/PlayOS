import koffi from 'koffi'

/**
 * Привязки к WinAPI через FFI (без компиляции нативных модулей):
 * список процессов, XInput (геймпад работает и когда окно в фоне) и управление фокусом окон.
 */

const kernel32 = koffi.load('kernel32.dll')
const user32 = koffi.load('user32.dll')

const EnumProcesses = kernel32.func('int __stdcall K32EnumProcesses(void *pids, uint32_t cb, _Out_ uint32_t *needed)')
const OpenProcess = kernel32.func('void * __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)')
const QueryFullProcessImageNameW = kernel32.func(
  'int __stdcall QueryFullProcessImageNameW(void *h, uint32_t flags, void *buf, _Inout_ uint32_t *size)'
)
const CloseHandle = kernel32.func('int __stdcall CloseHandle(void *h)')

const GetForegroundWindow = user32.func('void * __stdcall GetForegroundWindow()')
const SetForegroundWindow = user32.func('int __stdcall SetForegroundWindow(void *hwnd)')
const ShowWindow = user32.func('int __stdcall ShowWindow(void *hwnd, int cmd)')
const IsWindow = user32.func('int __stdcall IsWindow(void *hwnd)')
const IsIconic = user32.func('int __stdcall IsIconic(void *hwnd)')
const GetWindowThreadProcessId = user32.func('uint32_t __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint32_t *pid)')
const keybd_event = user32.func('void __stdcall keybd_event(uint8_t vk, uint8_t scan, uint32_t flags, uintptr_t extra)')
const MapVirtualKeyW = user32.func('uint32_t __stdcall MapVirtualKeyW(uint32_t code, uint32_t mapType)')
const RECT = koffi.struct('RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' })
const GetWindowRect = user32.func('__stdcall', 'GetWindowRect', 'int', ['void *', koffi.out(koffi.pointer(RECT))])

export function windowRect(hwnd: bigint | null) {
  if (!hwnd || !IsWindow(hwnd)) return null
  const r: { left?: number; top?: number; right?: number; bottom?: number } = {}
  if (!GetWindowRect(hwnd, r)) return null
  return { x: r.left!, y: r.top!, width: r.right! - r.left!, height: r.bottom! - r.top! }
}

// ───────────────────────── Нажатие клавиш (горячие клавиши эмуляторов) ─────────────────────────

const NAMED_KEYS: Record<string, number> = {
  CTRL: 0x11,
  CONTROL: 0x11,
  SHIFT: 0x10,
  ALT: 0x12,
  SPACE: 0x20,
  ENTER: 0x0d,
  RETURN: 0x0d,
  ESC: 0x1b,
  ESCAPE: 0x1b,
  TAB: 0x09,
  BACKSPACE: 0x08,
  INSERT: 0x2d,
  DELETE: 0x2e,
  HOME: 0x24,
  END: 0x23,
  PAGEUP: 0x21,
  PAGEDOWN: 0x22,
  UP: 0x26,
  DOWN: 0x28,
  LEFT: 0x25,
  RIGHT: 0x27,
  PAUSE: 0x13
}
const EXTENDED = new Set([0x2d, 0x2e, 0x24, 0x23, 0x21, 0x22, 0x26, 0x28, 0x25, 0x27])

/** «Shift+F2», «Ctrl+S», «Space» → коды клавиш. */
export function parseCombo(combo: string): number[] | null {
  const parts = combo
    .split('+')
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean)
  if (!parts.length) return null
  const codes: number[] = []
  for (const p of parts) {
    if (NAMED_KEYS[p]) codes.push(NAMED_KEYS[p])
    else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(p)) codes.push(0x6f + Number(p.slice(1)))
    else if (/^[A-Z0-9]$/.test(p)) codes.push(p.charCodeAt(0))
    else return null
  }
  return codes
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function key(vk: number, up: boolean) {
  const scan = MapVirtualKeyW(vk, 0 /* MAPVK_VK_TO_VSC */)
  keybd_event(vk, scan, (up ? 2 : 0) | (EXTENDED.has(vk) ? 1 : 0), 0)
}

/** Нажимает сочетание клавиш в активном окне: модификаторы зажаты, последняя клавиша — нажатие. */
export async function pressCombo(combo: string) {
  const codes = parseCombo(combo)
  if (!codes) return false
  const main = codes[codes.length - 1]
  const mods = codes.slice(0, -1)
  for (const m of mods) key(m, false)
  if (mods.length) await sleep(25)
  key(main, false)
  await sleep(45)
  key(main, true)
  for (const m of mods.reverse()) key(m, true)
  await sleep(30)
  return true
}

export interface ProcInfo {
  pid: number
  path: string
}

const pidBuf = Buffer.alloc(4 * 8192)
const nameBuf = Buffer.alloc(2048)
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

export function listProcesses(): ProcInfo[] {
  const needed = [0]
  if (!EnumProcesses(pidBuf, pidBuf.length, needed)) return []
  const out: ProcInfo[] = []
  const count = needed[0] / 4
  for (let i = 0; i < count; i++) {
    const pid = pidBuf.readUInt32LE(i * 4)
    if (!pid) continue
    const h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid)
    if (!h) continue
    const size = [1000]
    if (QueryFullProcessImageNameW(h, 0, nameBuf, size)) {
      out.push({ pid, path: nameBuf.toString('utf16le', 0, size[0] * 2) })
    }
    CloseHandle(h)
  }
  return out
}

const GetExitCodeProcess = kernel32.func('int __stdcall GetExitCodeProcess(void *h, _Out_ uint32_t *code)')
const STILL_ACTIVE = 259

/** Процесс pid ещё работает и это тот же exe (номер мог достаться новому процессу). Без перебора всех процессов. */
export function processAlive(pid: number, exe: string) {
  const h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid)
  if (!h) return false
  try {
    const code = [0]
    if (!GetExitCodeProcess(h, code) || code[0] !== STILL_ACTIVE) return false
    const size = [1000]
    return !!QueryFullProcessImageNameW(h, 0, nameBuf, size) && nameBuf.toString('utf16le', 0, size[0] * 2) === exe
  } finally {
    CloseHandle(h)
  }
}

export const foregroundWindow = (): bigint | null => GetForegroundWindow() || null

/** Окно свёрнуто (полноэкранная игра сворачивается, потеряв фокус) */
export const isMinimized = (hwnd: bigint | null) => !!hwnd && !!IsWindow(hwnd) && !!IsIconic(hwnd)

export function windowPid(hwnd: bigint) {
  const pid = [0]
  GetWindowThreadProcessId(hwnd, pid)
  return pid[0]
}

// ───────────────────────── Окна процесса и перенос на другой экран ─────────────────────────

const EnumWindowsProc = koffi.proto('int __stdcall EnumWindowsProc(void *hwnd, intptr_t lparam)')
const EnumWindows = user32.func('__stdcall', 'EnumWindows', 'int', [koffi.pointer(EnumWindowsProc), 'intptr_t'])
const IsWindowVisible = user32.func('int __stdcall IsWindowVisible(void *hwnd)')
const GetWindow = user32.func('void * __stdcall GetWindow(void *hwnd, uint32_t cmd)')
const IsZoomed = user32.func('int __stdcall IsZoomed(void *hwnd)')
const SetWindowPos = user32.func('int __stdcall SetWindowPos(void *hwnd, void *after, int x, int y, int cx, int cy, uint32_t flags)')

/** Видимые окна верхнего уровня (не диалоги-«владельцы») процессов pids */
export function processWindows(pids: number[]): bigint[] {
  if (!pids.length) return []
  const wanted = new Set(pids)
  const out: bigint[] = []
  EnumWindows((hwnd: bigint) => {
    if (IsWindowVisible(hwnd) && !GetWindow(hwnd, 4 /* GW_OWNER */) && wanted.has(windowPid(hwnd))) out.push(hwnd)
    return 1
  }, 0)
  return out
}

/** Ставит окно в прямоугольник (физические пиксели). Развёрнутое окно сначала восстанавливаем, потом разворачиваем снова — уже на новом экране */
export function moveWindow(hwnd: bigint, r: { x: number; y: number; width: number; height: number }) {
  if (!IsWindow(hwnd)) return
  const zoomed = IsZoomed(hwnd)
  if (zoomed) ShowWindow(hwnd, 9 /* SW_RESTORE */)
  SetWindowPos(hwnd, null, r.x, r.y, r.width, r.height, 0x0004 /* NOZORDER */ | 0x0010 /* NOACTIVATE */)
  if (zoomed) ShowWindow(hwnd, 3 /* SW_MAXIMIZE */)
}

const GetCurrentThreadId = kernel32.func('uint32_t __stdcall GetCurrentThreadId()')
const AttachThreadInput = user32.func('int __stdcall AttachThreadInput(uint32_t idAttach, uint32_t idAttachTo, int attach)')
const BringWindowToTop = user32.func('int __stdcall BringWindowToTop(void *hwnd)')

/**
 * Делает окно активным — с фокусом клавиатуры и геймпада (Chromium и игры читают ввод
 * только в активном окне). Windows не даёт процессу просто так забрать фокус, поэтому:
 * 1) временно связываем очередь ввода с текущим активным окном (AttachThreadInput);
 * 2) если не помогло — короткое нажатие Alt снимает блокировку SetForegroundWindow.
 */
export function forceForeground(hwnd: bigint | null): boolean {
  if (!hwnd || !IsWindow(hwnd)) return false
  if (IsIconic(hwnd)) ShowWindow(hwnd, 9 /* SW_RESTORE */)
  const fg = GetForegroundWindow()
  if (fg === hwnd) return true
  const me = GetCurrentThreadId()
  const fgThread = fg ? GetWindowThreadProcessId(fg, [0]) : 0
  const attached = fgThread && fgThread !== me ? AttachThreadInput(me, fgThread, 1) : 0
  BringWindowToTop(hwnd)
  SetForegroundWindow(hwnd)
  if (attached) AttachThreadInput(me, fgThread, 0)
  if (GetForegroundWindow() !== hwnd) {
    keybd_event(0x12, 0, 0, 0)
    SetForegroundWindow(hwnd)
    keybd_event(0x12, 0, 2 /* KEYUP */, 0)
  }
  return GetForegroundWindow() === hwnd
}

// ───────────────────────── Пауза игры (заморозка процесса) ─────────────────────────

const ntdll = koffi.load('ntdll.dll')
const NtSuspendProcess = ntdll.func('int32_t __stdcall NtSuspendProcess(void *h)')
const NtResumeProcess = ntdll.func('int32_t __stdcall NtResumeProcess(void *h)')
const PROCESS_SUSPEND_RESUME = 0x0800

function withProcess(pid: number, fn: (h: unknown) => number) {
  const h = OpenProcess(PROCESS_SUSPEND_RESUME, 0, pid)
  if (!h) return false
  try {
    return fn(h) === 0
  } finally {
    CloseHandle(h)
  }
}

/** Замораживает все потоки процесса: игра встаёт на паузу и не читает ввод с геймпада. */
export const suspendProcess = (pid: number) => withProcess(pid, (h) => NtSuspendProcess(h))
export const resumeProcess = (pid: number) => withProcess(pid, (h) => NtResumeProcess(h))

// ───────────────────────── Фоновый режим процессов PlayOS во время игры ─────────────────────────

const SetPriorityClass = kernel32.func('int __stdcall SetPriorityClass(void *h, uint32_t cls)')
const SetProcessInformation = kernel32.func('int __stdcall SetProcessInformation(void *h, int cls, void *info, uint32_t size)')
const PROCESS_SET_INFORMATION = 0x0200
const NORMAL_PRIORITY = 0x20
const BELOW_NORMAL_PRIORITY = 0x4000

/**
 * Режим эффективности Windows 11 (EcoQoS: энергоэффективные ядра, низкие частоты) и, по желанию, пониженный
 * приоритет — процессор в первую очередь достаётся игре. На старых Windows EcoQoS молча не включится.
 */
export function setEfficiencyMode(pid: number, on: boolean, lowPriority: boolean) {
  const h = OpenProcess(PROCESS_SET_INFORMATION, 0, pid)
  if (!h) return false
  try {
    // PROCESS_POWER_THROTTLING_STATE: Version, ControlMask, StateMask — управляем только скоростью выполнения
    const st = Buffer.alloc(12)
    st.writeUInt32LE(1, 0)
    st.writeUInt32LE(1, 4)
    st.writeUInt32LE(on ? 1 : 0, 8)
    SetProcessInformation(h, 4 /* ProcessPowerThrottling */, st, st.length)
    if (lowPriority) SetPriorityClass(h, on ? BELOW_NORMAL_PRIORITY : NORMAL_PRIORITY)
    return true
  } finally {
    CloseHandle(h)
  }
}

// ───────────────────────── XInput ─────────────────────────

const XINPUT_GAMEPAD = koffi.struct('XINPUT_GAMEPAD', {
  wButtons: 'uint16',
  bLeftTrigger: 'uint8',
  bRightTrigger: 'uint8',
  sThumbLX: 'int16',
  sThumbLY: 'int16',
  sThumbRX: 'int16',
  sThumbRY: 'int16'
})
const XINPUT_STATE = koffi.struct('XINPUT_STATE', { dwPacketNumber: 'uint32', Gamepad: XINPUT_GAMEPAD })

export interface PadState {
  buttons: number
  lt: number
  rt: number
  lx: number
  ly: number
}

type GetState = (i: number, out: Record<string, unknown>) => number
let getState: GetState | null = null

try {
  const lib = koffi.load('xinput1_4.dll')
  try {
    // Недокументированный XInputGetStateEx (ординал 100) умеет читать кнопку Guide/Xbox
    getState = lib.func('__stdcall', 100, 'uint32', ['uint32', koffi.out(koffi.pointer(XINPUT_STATE))])
  } catch {
    getState = lib.func('__stdcall', 'XInputGetState', 'uint32', ['uint32', koffi.out(koffi.pointer(XINPUT_STATE))])
  }
} catch {
  getState = null
}

export const XI = {
  UP: 0x0001,
  DOWN: 0x0002,
  LEFT: 0x0004,
  RIGHT: 0x0008,
  START: 0x0010,
  BACK: 0x0020,
  LB: 0x0100,
  RB: 0x0200,
  GUIDE: 0x0400,
  A: 0x1000,
  B: 0x2000,
  X: 0x4000,
  Y: 0x8000
}

const XINPUT_BATTERY = koffi.struct('XINPUT_BATTERY_INFORMATION', { BatteryType: 'uint8', BatteryLevel: 'uint8' })
type GetBattery = (i: number, devType: number, out: Record<string, unknown>) => number
let getBattery: GetBattery | null = null
try {
  getBattery = koffi
    .load('xinput1_4.dll')
    .func('__stdcall', 'XInputGetBatteryInformation', 'uint32', ['uint32', 'uint8', koffi.out(koffi.pointer(XINPUT_BATTERY))])
} catch {
  getBattery = null
}

/** Заряд беспроводного геймпада. 'wired' — проводной, null — нет данных. */
export function readBattery(index: number): 'empty' | 'low' | 'medium' | 'full' | 'wired' | null {
  if (!getBattery) return null
  const info: { BatteryType?: number; BatteryLevel?: number } = {}
  if (getBattery(index, 0 /* BATTERY_DEVTYPE_GAMEPAD */, info) !== 0) return null
  if (info.BatteryType === 0 /* DISCONNECTED */) return null
  if (info.BatteryType === 1 /* WIRED */) return 'wired'
  return (['empty', 'low', 'medium', 'full'] as const)[info.BatteryLevel ?? 0] ?? null
}

export function readPad(index: number): PadState | null {
  if (!getState) return null
  const st: { Gamepad?: { wButtons: number; bLeftTrigger: number; bRightTrigger: number; sThumbLX: number; sThumbLY: number } } = {}
  if (getState(index, st) !== 0 || !st.Gamepad) return null
  const g = st.Gamepad
  return { buttons: g.wButtons, lt: g.bLeftTrigger, rt: g.bRightTrigger, lx: g.sThumbLX, ly: g.sThumbLY }
}

// ───────────────────────── Вибрация геймпада ─────────────────────────

const XINPUT_VIBRATION = koffi.struct('XINPUT_VIBRATION', { wLeftMotorSpeed: 'uint16', wRightMotorSpeed: 'uint16' })
type SetState = (i: number, v: Record<string, number>) => number
let setState: SetState | null = null
try {
  setState = koffi.load('xinput1_4.dll').func('__stdcall', 'XInputSetState', 'uint32', ['uint32', koffi.pointer(XINPUT_VIBRATION)])
} catch {
  setState = null
}

/**
 * Вибрация всех подключённых XInput-геймпадов по шаблону [левый мотор, правый мотор, мс].
 * DSX эмулирует Xbox-геймпад и передаёт вибрацию на DualSense.
 */
export async function rumble(pattern: [number, number, number][]) {
  if (!setState) return
  const slots = [0, 1, 2, 3].filter((i) => readPad(i))
  if (!slots.length) return
  for (const [left, right, ms] of pattern) {
    for (const i of slots) setState(i, { wLeftMotorSpeed: left, wRightMotorSpeed: right })
    await new Promise((r) => setTimeout(r, ms))
  }
  for (const i of slots) setState(i, { wLeftMotorSpeed: 0, wRightMotorSpeed: 0 })
}
