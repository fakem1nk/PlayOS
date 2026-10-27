import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { VrResult } from '@shared/types'
import { t } from '@shared/i18n'

const run = (file: string, args: string[]) =>
  new Promise<string>((resolve) => execFile(file, args, { windowsHide: true, encoding: 'utf8' }, (_err, stdout) => resolve(stdout ?? '')))

/** Активный OpenXR-рантайм из реестра Khronos: имя из его манифеста (runtime.name) */
export async function openXrStatus() {
  const out = await run('reg', ['query', 'HKLM\\SOFTWARE\\Khronos\\OpenXR\\1', '/v', 'ActiveRuntime'])
  const manifest = /ActiveRuntime\s+REG_\w+\s+(.+)/.exec(out)?.[1]?.trim()
  if (!manifest) return { meta: false }
  let name = path.basename(manifest, '.json')
  try {
    name = JSON.parse(fs.readFileSync(manifest, 'utf8'))?.runtime?.name || name
  } catch {}
  return { name, meta: /oculus|meta/i.test(manifest) }
}

/** Процессы SteamVR: монитор, сервер, композитор, дашборд и их помощники */
const STEAMVR_EXES = ['vrmonitor.exe', 'vrserver.exe', 'vrcompositor.exe', 'vrdashboard.exe', 'vrwebhelper.exe', 'vrstartup.exe']

/** Запущенные VR-сервисы — одним вызовом tasklist */
export async function vrProcesses() {
  const out = (await run('tasklist', ['/FO', 'CSV', '/NH'])).toLowerCase()
  return {
    metaLink: out.includes('"ovrserver_x64.exe"'),
    steamvr: out.includes('"vrserver.exe"') || out.includes('"vrmonitor.exe"')
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Закрывает SteamVR: сначала вежливо (WM_CLOSE), через 5 с — принудительно вместе с дочерними процессами */
export async function closeSteamVr(): Promise<VrResult> {
  const names = STEAMVR_EXES.flatMap((n) => ['/IM', n])
  await run('taskkill', names)
  for (let i = 0; i < 10; i++) {
    await sleep(500)
    if (!(await vrProcesses()).steamvr) return { ok: true }
  }
  await run('taskkill', ['/F', '/T', ...names])
  await sleep(800)
  return (await vrProcesses()).steamvr ? { ok: false, error: t('SteamVR не закрылся — возможно, нужны права администратора') } : { ok: true }
}
