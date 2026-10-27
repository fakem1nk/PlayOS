import fs from 'node:fs'
import path from 'node:path'
import { OC_DEFAULTS, type OcSettings, type VrResult } from '@shared/types'
import { t } from '@shared/i18n'

/**
 * OpenComposite читает два файла: общий рядом со своей DLL (наш vr\runtime\bin) и игровой в рабочей папке игры —
 * игровой перекрывает общий. Поэтому пишем в рабочую папку, с которой PlayOS запускает игру.
 * Важно: неизвестное имя опции роняет игру на старте — пишем только опции из OpenOVR/Misc/Config.cpp.
 */
const INI = 'opencomposite.ini'
// Метка нашего файла: чужой ini перед первой записью сохраняем в .bak и возвращаем при сбросе
const MARK = '; Written by PlayOS'

export const iniPath = (cwd: string) => path.join(cwd, INI)

const isOurs = (file: string) => {
  try {
    return fs.readFileSync(file, 'utf8').startsWith(MARK)
  } catch {
    return false
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const onOff = (v: boolean) => (v ? 'enabled' : 'disabled')

function render(s: OcSettings) {
  return [
    MARK,
    '; Changes here will be overwritten - edit the game in PlayOS instead',
    `supersampleRatio=${clamp(s.supersampleRatio, 0.3, 3).toFixed(2)}`,
    `renderCustomHands=${onOff(s.renderCustomHands)}`,
    `haptics=${onOff(s.haptics)}`,
    // Безопасные значения для Quest, пользователю их выбирать не нужно:
    // Vulkan на старте у части игр ломает запуск через Link, а неизвестные свойства шлема не должны ронять игру
    'initUsingVulkan=disabled',
    'admitUnknownProps=enabled',
    'enableHiddenMeshFix=enabled',
    ''
  ].join('\r\n')
}

const writeError = (e: unknown): VrResult => {
  const code = (e as NodeJS.ErrnoException).code
  if (code === 'EPERM' || code === 'EACCES')
    return { ok: false, error: t('Нет прав на запись в папку игры — перенесите игру из Program Files или запустите PlayOS от администратора') }
  return { ok: false, error: (e as Error).message }
}

/** Пишет ini игры (значения по умолчанию, если своих нет) */
export function writeGameIni(cwd: string, settings?: OcSettings): VrResult {
  const file = iniPath(cwd)
  try {
    if (fs.existsSync(file) && !isOurs(file) && !fs.existsSync(`${file}.bak`)) fs.copyFileSync(file, `${file}.bak`)
    fs.writeFileSync(file, render({ ...OC_DEFAULTS, ...settings }))
    return { ok: true }
  } catch (e) {
    return writeError(e)
  }
}

/** Убирает наш ini и возвращает чужой, если он был (игра перестала быть VR) */
export function removeGameIni(cwd: string): VrResult {
  const file = iniPath(cwd)
  try {
    if (isOurs(file)) fs.rmSync(file)
    if (fs.existsSync(`${file}.bak`) && !fs.existsSync(file)) fs.renameSync(`${file}.bak`, file)
    return { ok: true }
  } catch (e) {
    return writeError(e)
  }
}
