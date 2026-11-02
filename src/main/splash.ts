import { app, screen, type BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { UpdateSplash } from '@shared/types'
import { log } from './log'
import { helperPath } from './system'

/**
 * Заставка на время установки обновления. PlayOS закрывается, установщик работает молча — без заставки экран
 * просто гас бы на полминуты. Помощник (native/UpdateSplash.cs) держит снимок экрана установки и крутит поверх него
 * сценку Тиви, пока новая версия не покажет окно. Запускается копия из временной папки: свой PlayOSHelper.exe
 * установщик заменяет. Пока в папке лежит файл wait, заставка ждёт; новая версия его удаляет (endUpdateSplash).
 */

const dir = () => path.join(app.getPath('temp'), 'PlayOS-update')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function showUpdateSplash(win: BrowserWindow, s: UpdateSplash, version?: string) {
  const root = dir()
  fs.rmSync(root, { recursive: true, force: true })
  fs.mkdirSync(root, { recursive: true })
  const shot = await win.webContents.capturePage()
  fs.writeFileSync(path.join(root, 'screen.png'), shot.toPNG())
  s.frames.forEach((png, i) => fs.writeFileSync(path.join(root, `frame${i}.png`), png))
  fs.writeFileSync(path.join(root, 'timeline.txt'), s.steps.map(([k, ms]) => `${k} ${Math.round(ms)}`).join('\n'))
  const exe = path.join(root, 'PlayOSHelper.exe')
  fs.copyFileSync(helperPath(), exe)
  // По ней новая версия узнает, что запустилась из установщика, и начнёт с экрана «готово»
  if (version) fs.writeFileSync(path.join(root, 'version.txt'), version)
  fs.writeFileSync(path.join(root, 'wait'), '')

  // Координаты для заставки — в настоящих пикселях экрана
  const area = win.getContentBounds()
  const b = screen.dipToScreenRect(win, area)
  const k = b.width / area.width
  const r = s.rect
  const spot = [b.x + r.x * k, b.y + r.y * k, r.width * k, r.height * k].map(Math.round)
  const args = ['splash', root, b.x, b.y, b.width, b.height, ...spot, s.t0, process.pid, process.execPath]
  // Без windowsHide: он прячет первое показанное окно процесса, то есть саму заставку
  spawn(exe, args.map(String), { detached: true, stdio: 'ignore' }).unref()

  // Закрываемся, только когда заставка уже встала поверх окна — иначе между ними мелькнёт рабочий стол
  const ready = path.join(root, 'ready')
  for (let t = 0; t < 3000 && !fs.existsSync(ready); t += 50) await sleep(50)
  log('INFO', `[обновления] заставка ${fs.existsSync(ready) ? 'на экране' : 'не успела появиться'}`)
}

/**
 * Запустились из установщика: заставка ещё ждёт, и обновлялись именно до этой версии — тогда версия, иначе null.
 * Старую папку (заставка упала, установка сорвалась давно) не считаем
 */
export function updateFinished(): string | null {
  const root = dir()
  try {
    if (Date.now() - fs.statSync(path.join(root, 'wait')).mtimeMs > 15 * 60_000) return null
    const v = fs.readFileSync(path.join(root, 'version.txt'), 'utf8').trim()
    return v === app.getVersion() ? v : null
  } catch {
    return null
  }
}

/** Новая версия показала окно — заставка закрывается; папку убираем, когда помощник уже вышел */
export function endUpdateSplash() {
  const root = dir()
  if (!fs.existsSync(root)) return
  fs.rmSync(path.join(root, 'wait'), { force: true })
  setTimeout(() => fs.rm(root, { recursive: true, force: true }, () => {}), 10_000)
}
