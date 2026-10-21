import { app } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateState } from '@shared/types'
import { log } from './log'

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

export const updateState = () => state

export function startUpdater(onChange: (s: UpdateState) => void, beta: boolean) {
  notify = onChange
  state = { phase: app.isPackaged ? 'idle' : 'dev', current: app.getVersion() }
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  // Ранние версии (pre-release на GitHub) — только тем, кто участвует в бета-тесте
  autoUpdater.allowPrerelease = beta
  autoUpdater.logger = {
    info: (m: unknown) => log('INFO', '[обновления]', m),
    warn: (m: unknown) => log('WARN', '[обновления]', m),
    error: (m: unknown) => log('ERROR', '[обновления]', m),
    debug: () => {}
  }

  autoUpdater.on('checking-for-update', () => set({ phase: 'checking', error: undefined }))
  autoUpdater.on('update-not-available', () => set({ phase: 'latest', checkedAt: Date.now() }))
  autoUpdater.on('update-available', (i) => set({ phase: 'downloading', version: i.version, notes: notesOf(i.releaseNotes), percent: 0, checkedAt: Date.now() }))
  autoUpdater.on('download-progress', (p) => set({ phase: 'downloading', percent: Math.round(p.percent), transferred: p.transferred, total: p.total }))
  autoUpdater.on('update-downloaded', (i) => set({ phase: 'ready', version: i.version, notes: notesOf(i.releaseNotes) ?? state.notes, percent: 100 }))
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
  if (/ENOTFOUND|ECONN|ETIMEDOUT|net::|network/i.test(msg)) return 'Нет соединения с GitHub'
  if (/404|Cannot find latest|No published versions/i.test(msg)) return 'На GitHub пока нет опубликованных версий'
  return 'Не удалось проверить обновления'
}

/** Включили или выключили бета-тест — сразу проверяем заново с новым правилом */
export function setBetaUpdates(on: boolean) {
  if (!app.isPackaged || autoUpdater.allowPrerelease === on) return
  autoUpdater.allowPrerelease = on
  log('INFO', `[обновления] бета-тест ${on ? 'включён' : 'выключен'}`)
  void checkForUpdates()
}

export async function checkForUpdates() {
  if (!app.isPackaged) return state
  // Уже качаем или скачали — повторная проверка не нужна
  if (state.phase === 'downloading' || state.phase === 'ready' || state.phase === 'checking') return state
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
