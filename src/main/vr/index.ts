import fs from 'node:fs'
import path from 'node:path'
import type { Game, VrResult, VrStatus } from '@shared/types'
import { t } from '@shared/i18n'
import { log } from '../log'
import { removeGameIni, writeGameIni } from './gameconfig'
import { OC_FILES, binDir, installOc, metaFile, ocState } from './opencomposite'
import { questStatus } from './quest'
import { replaceRuntimePath, runtimeDir, runtimeStatus, switchRuntime } from './runtime'
import { closeSteamVr, openXrStatus, vrProcesses } from './system'

export { checkOcUpdate, installOc } from './opencomposite'
export { questLive } from './quest'
export { detectApis } from './detect'

/** Упала раньше этого срока с ненулевым кодом — считаем сбоем на старте */
const CRASH_WINDOW_MS = 30_000

export async function vrStatus(): Promise<VrStatus> {
  const [openxr, proc] = await Promise.all([openXrStatus(), vrProcesses()])
  const { installed, installedAt } = ocState()
  return { oc: { installed, installedAt }, meta: openxr.meta, quest: questStatus(proc.metaLink) }
}

/** Рабочая папка запуска — там OpenComposite ищет игровой opencomposite.ini (как в launcher.buildSpec) */
const workDir = (g: Game) => (g.launcher === 'steam' ? g.path : g.workDir || path.dirname(g.path))

/** Нужен ли игре рантайм OpenVR: если API ещё не проверяли — на всякий случай да */
const usesOpenVr = (g: Game) => !g.vr?.apis || g.vr.apis.includes('openvr')

/**
 * Перед запуском VR-игры всё готовим сами: VR-компонент (скачиваем при первом запуске), наш рантайм первым
 * в vrpath, SteamVR закрыт (иначе перехватит шлем), opencomposite.ini игры. OpenXR- и Oculus-игры vrpath не читают —
 * их не трогаем. Режим совместимости — игра идёт через SteamVR. viaOc — запуск идёт через OpenComposite.
 */
export async function prepareLaunch(g: Game, onStep: (text: string) => void): Promise<VrResult & { viaOc?: boolean }> {
  if (!g.vr || !usesOpenVr(g)) return { ok: true }
  if (g.vr.compat) return runtimeStatus().active === 'steamvr' ? { ok: true } : switchRuntime('steamvr')

  if (!ocState().installed) {
    onStep(t('Готовим VR к первому запуску…'))
    const r = await installOc(() => {})
    if (!r.ok) return { ok: false, error: t('Не удалось скачать VR-компонент: {v}', { v: r.error }) }
  }
  if ((await vrProcesses()).steamvr) {
    const r = await closeSteamVr()
    if (!r.ok) return r
  }
  if (runtimeStatus().active !== 'playos') {
    const r = switchRuntime('playos')
    if (!r.ok) return r
  }
  // Пишем перед каждым запуском: ini могли удалить вместе с обновлением игры.
  // Без своих настроек ошибка записи не мешает — OpenComposite возьмёт значения по умолчанию
  const ini = writeGameIni(workDir(g), g.vr.oc)
  if (!ini.ok && g.vr.oc) return ini
  if (!ini.ok) log('WARN', `opencomposite.ini для «${g.title}»: ${ini.error}`)
  return { ok: true, viaOc: true }
}

/**
 * Процесс игры завершился. Быстрый выход с ошибкой через OpenComposite — сбой на старте:
 * запоминаем, чтобы предложить режим совместимости. Долгая нормальная игра снимает старую отметку. true — что-то поменялось
 */
export function recordExit(g: Game, code: number | null, ms: number, viaOc: boolean): boolean {
  if (!g.vr) return false
  const quick = ms < CRASH_WINDOW_MS
  if (viaOc && quick && code !== 0) {
    g.vr.crash = { at: Date.now(), code }
    log('WARN', `«${g.title}» закрылась через ${Math.round(ms / 1000)} с с кодом ${code} (OpenComposite)`)
    return true
  }
  if (!quick && g.vr.crash) {
    delete g.vr.crash
    return true
  }
  return false
}

/** Игра перестала быть VR — убираем наш ini из её папки */
export function forgetVr(g: Game) {
  if (g.path) removeGameIni(workDir(g))
}

/**
 * Переезд из отдельного PlayOS VR: его OpenComposite уже скачан, а vrpath может указывать на его папку.
 * Копируем DLL к себе и подменяем путь — пользователю не нужно качать заново.
 */
export function migrateStandalone() {
  const old = path.join(process.env.APPDATA ?? '', 'PlayOS VR', 'runtime')
  try {
    if (ocState().installed || !OC_FILES.every((f) => fs.existsSync(path.join(old, 'bin', f.name)))) return
    fs.mkdirSync(binDir(), { recursive: true })
    for (const f of OC_FILES) fs.copyFileSync(path.join(old, 'bin', f.name), path.join(binDir(), f.name))
    if (fs.existsSync(path.join(old, 'opencomposite.json'))) fs.copyFileSync(path.join(old, 'opencomposite.json'), metaFile())
    replaceRuntimePath(old, runtimeDir())
    log('INFO', 'OpenComposite перенесён из отдельного PlayOS VR')
  } catch (e) {
    log('WARN', `Перенос OpenComposite из PlayOS VR: ${(e as Error).message}`)
  }
}
