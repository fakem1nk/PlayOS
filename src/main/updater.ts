import { app } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateState, UpdateSummary } from '@shared/types'
import { httpFetch } from './http'
import { log } from './log'
import { t } from '@shared/i18n'

/**
 * Обновления PlayOS из релизов GitHub (fakem1nk/PlayOS, см. build.publish в package.json).
 * Проверяем сразу при запуске, после выхода из сна и раз в 6 часов, новая версия качается в фоне
 * и ставится при выходе из PlayOS — или сразу, по кнопке «Перезапустить и обновить».
 */

const { autoUpdater } = electronUpdater

let state: UpdateState = { phase: 'idle', current: '' }
let notify: (s: UpdateState) => void = () => {}

function set(patch: Partial<UpdateState>) {
  state = { ...state, ...patch }
  notify(state)
}

/** Заметки к релизу приходят HTML-кусками — превращаем в обычный текст */
function notesOf(n: unknown) {
  const raw = Array.isArray(n) ? n.map((x: { note?: string }) => x.note ?? '').join('\n') : typeof n === 'string' ? n : ''
  return (
    raw
      .replace(/<br\s*\/?>|<\/p>|<\/li>/gi, '\n')
      .replace(/<li>/gi, '• ')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\n{3,}/g, '\n\n')
      .trim() || undefined
  )
}

/** Сводка для окна обновления лежит файлом в самом релизе; нет файла или сети — окно покажет заметки к релизу */
async function loadSummary(version: string) {
  try {
    const res = await httpFetch(`https://github.com/fakem1nk/PlayOS/releases/download/v${version}/update-summary.json`, {
      signal: AbortSignal.timeout(15_000)
    })
    if (!res.ok) return
    const s = (await res.json()) as UpdateSummary
    if (state.version === version) set({ summary: s })
  } catch (e) {
    log('WARN', '[обновления] нет сводки:', (e as Error)?.message ?? e)
  }
}

export const updateState = () => state

/** Бета-версия: 1.1.0-beta.2 */
const isBeta = (v: string) => v.includes('-')

/** Сравнение только номеров версий: 1.0.4 < 1.1.0 = 1.1.0-beta.2 */
function cmpBase(a: string, b: string) {
  const pa = a.split('-')[0].split('.').map(Number)
  const pb = b.split('-')[0].split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  return 0
}

/** Скачанная версия старше установленной — это возврат с беты на стабильную */
const isRollback = (v: string) => isBeta(state.current) && !isBeta(v) && cmpBase(v, state.current) < 0

/**
 * Бета-тест выключен, а стоит бета — разрешаем «обновиться назад» до последней стабильной версии.
 * Данные и настройки остаются в %APPDATA%\PlayOS, установщик просто ставит другую версию поверх.
 */
function applyChannel(beta: boolean) {
  autoUpdater.allowPrerelease = beta
  autoUpdater.allowDowngrade = !beta && isBeta(state.current)
}

export function startUpdater(onChange: (s: UpdateState) => void, beta: boolean) {
  notify = onChange
  state = { phase: app.isPackaged ? 'idle' : 'dev', current: app.getVersion() }
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  // Ранние версии (pre-release на GitHub) — только тем, кто участвует в бета-тесте
  applyChannel(beta)
  autoUpdater.logger = {
    info: (m: unknown) => log('INFO', '[обновления]', m),
    warn: (m: unknown) => log('WARN', '[обновления]', m),
    error: (m: unknown) => log('ERROR', '[обновления]', m),
    debug: () => {}
  }

  autoUpdater.on('checking-for-update', () => set({ phase: 'checking', error: undefined }))
  autoUpdater.on('update-not-available', () => set({ phase: 'latest', checkedAt: Date.now() }))
  autoUpdater.on('update-available', (i) => {
    set({ phase: 'downloading', version: i.version, rollback: isRollback(i.version), notes: notesOf(i.releaseNotes), summary: undefined, percent: 0, checkedAt: Date.now() })
    void loadSummary(i.version)
  })
  autoUpdater.on('download-progress', (p) => set({ phase: 'downloading', percent: Math.round(p.percent), transferred: p.transferred, total: p.total }))
  autoUpdater.on('update-downloaded', (i) => {
    autoUpdater.autoInstallOnAppQuit = true
    set({ phase: 'ready', version: i.version, rollback: isRollback(i.version), notes: notesOf(i.releaseNotes) ?? state.notes, percent: 100 })
  })
  autoUpdater.on('error', (e) => {
    // Нет сети или нет ни одного релиза — не ошибка для пользователя, просто «не удалось проверить»
    log('WARN', '[обновления] ошибка:', e?.message ?? e)
    set({ phase: 'error', error: friendly(e?.message ?? '') })
  })

  // Пара секунд на запуск окна и сети — и проверяем, пока идёт интро
  setTimeout(() => void checkForUpdates(), 3_000)
  setInterval(() => void checkForUpdates(), 6 * 3600_000)
}

function friendly(msg: string) {
  if (/ENOTFOUND|ECONN|ETIMEDOUT|net::|network/i.test(msg)) return t('Нет соединения с GitHub')
  // Стабильных версий ещё нет, а бета-тест выключен — GitHub отвечает, что «latest» не найден
  if (/production release|Unable to find latest/i.test(msg) && !autoUpdater.allowPrerelease)
    return t('Стабильных версий пока нет. Ранние версии приходят, если включить бета-тест')
  if (/404|Cannot find latest|No published versions/i.test(msg)) return t('На GitHub пока нет опубликованных версий')
  return t('Не удалось проверить обновления')
}

/** Включили или выключили бета-тест — сразу проверяем заново с новым правилом */
export function setBetaUpdates(on: boolean) {
  if (!app.isPackaged || autoUpdater.allowPrerelease === on) return
  applyChannel(on)
  log('INFO', `[обновления] бета-тест ${on ? 'включён' : 'выключен'}${autoUpdater.allowDowngrade ? ', возврат на стабильную версию' : ''}`)
  // Передумали возвращаться: скачанная стабильная версия не должна поставиться при выходе
  if (on && state.rollback) {
    autoUpdater.autoInstallOnAppQuit = false
    set({ phase: 'idle', version: undefined, rollback: false, notes: undefined, summary: undefined })
  }
  // Уже скачанная бета не должна ждать выхода — проверяем заново, стабильная версия её заменит
  void checkForUpdates(autoUpdater.allowDowngrade)
}

export async function checkForUpdates(force = false) {
  if (!app.isPackaged) return state
  // Уже качаем или скачали — повторная проверка не нужна (кроме возврата на стабильную поверх скачанной беты)
  if (state.phase === 'downloading' || state.phase === 'checking' || (state.phase === 'ready' && !force)) return state
  try {
    await autoUpdater.checkForUpdates()
  } catch {
    /* событие 'error' уже обновило состояние */
  }
  return state
}

/** Закрыть PlayOS и поставить скачанную версию; после установки PlayOS запустится сам */
export function installUpdate() {
  if (state.phase !== 'ready') return false
  log('INFO', `[обновления] установка ${state.version}`)
  setImmediate(() => autoUpdater.quitAndInstall(true, true))
  return true
}
