import { app, crashReporter, screen, shell, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { inspect } from 'node:util'
import { getLang } from '@shared/i18n'

/**
 * Журнал PlayOS: %APPDATA%\PlayOS\logs\playos.log (при 2 МБ старый уходит в playos.old.log).
 * Пишем ошибки и предупреждения main-процесса, сообщения окон уровня warning/error, падения рендерера и GPU,
 * аварийные дампы Chromium. Файл-маркер running.lock показывает, что прошлый запуск закончился аварийно.
 * «Сохранить отчёт» собирает всё это в один текстовый файл на рабочем столе — без ключей API.
 */

const MAX_SIZE = 2 * 1024 * 1024
let file = ''
let lockFile = ''
let previousCrashed = false

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 23)
const fmt = (args: unknown[]) => args.map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.stack ?? a.message : inspect(a, { depth: 4 }))).join(' ')

export function log(level: 'INFO' | 'WARN' | 'ERROR' | 'FATAL', ...args: unknown[]) {
  if (!file) return
  try {
    fs.appendFileSync(file, `${stamp()} ${level.padEnd(5)} ${fmt(args)}\n`)
  } catch {
    /* диск недоступен — журнал не должен ронять приложение */
  }
}

/** Вызывать после того, как выбрана папка данных (userData) */
export function initLog() {
  const dir = path.join(app.getPath('userData'), 'logs')
  fs.mkdirSync(dir, { recursive: true })
  file = path.join(dir, 'playos.log')
  try {
    if (fs.statSync(file).size > MAX_SIZE) fs.renameSync(file, path.join(dir, 'playos.old.log'))
  } catch {
    /* файла ещё нет */
  }

  // Аварийные дампы Chromium остаются локально — в отчёт попадает только их список
  crashReporter.start({ uploadToServer: false, compress: true })

  lockFile = path.join(app.getPath('userData'), 'running.lock')
  previousCrashed = fs.existsSync(lockFile)
  fs.writeFileSync(lockFile, String(process.pid))
  app.on('will-quit', () => fs.rmSync(lockFile, { force: true }))

  log('INFO', `PlayOS ${app.getVersion()} запущен (Electron ${process.versions.electron}, ${os.version()} ${os.release()})`)
  if (previousCrashed) log('WARN', 'Прошлый запуск завершился аварийно (остался running.lock)')

  // Всё, что main пишет в консоль как предупреждение или ошибку, попадает и в журнал
  const origWarn = console.warn.bind(console)
  const origError = console.error.bind(console)
  console.warn = (...a: unknown[]) => (log('WARN', ...a), origWarn(...a))
  console.error = (...a: unknown[]) => (log('ERROR', ...a), origError(...a))

  process.on('uncaughtException', (e) => log('FATAL', 'Необработанное исключение в main:', e))
  process.on('unhandledRejection', (e) => log('ERROR', 'Необработанный отказ Promise в main:', e))
  app.on('child-process-gone', (_e, d) => log('ERROR', `Процесс ${d.type}${d.name ? ` (${d.name})` : ''} завершился: ${d.reason}, код ${d.exitCode}`))
}

export const lastRunCrashed = () => previousCrashed

/** Ошибки и падения окна — в журнал */
export function watchWindow(win: BrowserWindow, name: string) {
  const wc = win.webContents
  wc.on('console-message', (e) => {
    // Предупреждения безопасности Electron бывают только при запуске из исходников — в журнале это шум
    if (e.message.includes('Electron Security Warning')) return
    if (e.level === 'error' || e.level === 'warning') log(e.level === 'error' ? 'ERROR' : 'WARN', `[${name}] ${e.message} (${path.basename(e.sourceId || '')}:${e.lineNumber})`)
  })
  wc.on('render-process-gone', (_e, d) => log('FATAL', `[${name}] процесс окна завершился: ${d.reason}, код ${d.exitCode}`))
  wc.on('preload-error', (_e, p, err) => log('ERROR', `[${name}] ошибка preload ${p}:`, err))
  wc.on('did-fail-load', (_e, code, desc, url) => log('ERROR', `[${name}] не загрузилось ${url}: ${desc} (${code})`))
  win.on('unresponsive', () => log('WARN', `[${name}] окно не отвечает`))
  win.on('responsive', () => log('INFO', `[${name}] окно снова отвечает`))
}

const tail = (f: string, lines: number) => {
  try {
    return fs.readFileSync(f, 'utf8').split('\n').slice(-lines).join('\n')
  } catch {
    return ''
  }
}

// Ключи и токены в отчёт не попадают
const SECRET = /key|token|secret|password/i

/** Собирает отчёт в один файл на рабочем столе и показывает его в проводнике */
export function saveReport(settings: Record<string, unknown>, gamesCount: number) {
  const safe = Object.fromEntries(
    Object.entries(settings)
      .filter(([k]) => k !== 'trophies')
      .map(([k, v]) => [k, SECRET.test(k) ? (v ? '(задан)' : '(пусто)') : v])
  )
  const dumpsDir = app.getPath('crashDumps')
  const dumps: string[] = []
  const walk = (d: string) => {
    for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.dmp$/i.test(e.name)) {
        const st = fs.statSync(p)
        dumps.push(`${st.mtime.toISOString()}  ${Math.round(st.size / 1024)} КБ  ${path.relative(dumpsDir, p)}`)
      }
    }
  }
  walk(dumpsDir)
  const displays = screen
    .getAllDisplays()
    .map((d) => `${d.label || 'экран'} ${Math.round(d.size.width * d.scaleFactor)}×${Math.round(d.size.height * d.scaleFactor)} @${d.scaleFactor}`)
    .join('; ')

  const text = [
    `Отчёт PlayOS — ${new Date().toLocaleString('ru-RU')}`,
    '',
    '── Система ──',
    `PlayOS ${app.getVersion()}${app.isPackaged ? '' : ' (из исходников)'}`,
    `Electron ${process.versions.electron}, Chromium ${process.versions.chrome}, Node ${process.versions.node}`,
    `${os.version()} ${os.release()} ${os.arch()}, ${os.cpus()[0]?.model ?? ''} ×${os.cpus().length}, ОЗУ ${Math.round(os.totalmem() / 2 ** 30)} ГБ`,
    `Экраны: ${displays}`,
    `Прошлый запуск завершился аварийно: ${previousCrashed ? 'да' : 'нет'}`,
    `Игр в библиотеке: ${gamesCount}`,
    '',
    '── Настройки (ключи скрыты) ──',
    JSON.stringify(safe, null, 2),
    '',
    `── Аварийные дампы (${dumps.length}) в ${dumpsDir} ──`,
    dumps.slice(-20).join('\n') || 'нет',
    '',
    '── Журнал (предыдущий файл, конец) ──',
    tail(path.join(path.dirname(file), 'playos.old.log'), 300) || 'нет',
    '',
    '── Журнал ──',
    tail(file, 3000)
  ].join('\n')

  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const name = `${getLang() === 'en' ? 'PlayOS-report' : 'PlayOS-отчёт'}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}.txt`
  // Отчёты — своей папкой в данных PlayOS (рядом с logs и backups), а не россыпью на рабочем столе.
  // Не в папке установки: обновление переустанавливает её целиком
  const dir = path.join(app.getPath('userData'), 'reports')
  fs.mkdirSync(dir, { recursive: true })
  const out = path.join(dir, name)
  fs.writeFileSync(out, text, 'utf8')
  log('INFO', `Сохранён отчёт ${out}`)
  shell.showItemInFolder(out)
  return out
}

export const logsDir = () => path.dirname(file)
