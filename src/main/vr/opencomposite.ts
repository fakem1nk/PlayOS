import fs from 'node:fs'
import path from 'node:path'
import type { VrResult } from '@shared/types'
import { t } from '@shared/i18n'
import { httpFetch } from '../http'
import { runtimeDir } from './runtime'

/**
 * Сборки OpenComposite (ветка openxr). Один и тот же DLL работает и как openvr_api.dll внутри игры,
 * и как vrclient системного рантайма — для второго просто кладём его под именем клиента OpenVR.
 */
const BASE = 'https://opencomposite.znix.xyz/builds/download_latest?branch=openxr&artefact_name='
export const OC_FILES = [
  { artefact: 'x64/openvr_api.dll', name: 'vrclient_x64.dll' },
  { artefact: 'Win32/openvr_api.dll', name: 'vrclient.dll' }
]

interface OcFile {
  name: string
  size: number
  /** Заголовки сервера на момент загрузки — по ним ищем обновление */
  lastModified?: string
  etag?: string
}

export const binDir = () => path.join(runtimeDir(), 'bin')
export const metaFile = () => path.join(runtimeDir(), 'opencomposite.json')

function readMeta(): { installedAt: number; files: OcFile[] } | null {
  try {
    return JSON.parse(fs.readFileSync(metaFile(), 'utf8'))
  } catch {
    return null
  }
}

export function ocState() {
  const installed = OC_FILES.every((f) => fs.existsSync(path.join(binDir(), f.name)))
  const meta = readMeta()
  return { installed, installedAt: meta?.installedAt, size: meta?.files.reduce((a, f) => a + f.size, 0) }
}

const headersOf = (r: Response) => ({
  lastModified: r.headers.get('last-modified') ?? undefined,
  etag: r.headers.get('etag') ?? undefined
})

async function download(f: (typeof OC_FILES)[number], onBytes: (n: number, total: number) => void): Promise<{ file: OcFile; buf: Buffer }> {
  const res = await httpFetch(BASE + encodeURIComponent(f.artefact))
  if (!res.ok || !res.body) throw new Error(t('{name}: сервер ответил {status}', { name: f.name, status: res.status }))
  const total = Number(res.headers.get('content-length')) || 0
  const chunks: Uint8Array[] = []
  let received = 0
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    onBytes(received, total)
  }
  const buf = Buffer.concat(chunks)
  // Защита от HTML-страницы ошибки вместо DLL: у PE-файла первые байты «MZ»
  if (buf.length < 1024 || buf[0] !== 0x4d || buf[1] !== 0x5a) throw new Error(t('{name}: скачан не DLL', { name: f.name }))
  return { file: { name: f.name, size: buf.length, ...headersOf(res) }, buf }
}

/** Скачивает обе DLL и подменяет их разом: сначала всё во временные файлы, потом переименование */
export async function installOc(onProgress: (p: number) => void): Promise<VrResult> {
  try {
    const got = []
    for (const [i, f] of OC_FILES.entries())
      got.push(await download(f, (n, total) => onProgress((i + (total ? n / total : 0.5)) / OC_FILES.length)))
    fs.mkdirSync(binDir(), { recursive: true })
    for (const g of got) fs.writeFileSync(path.join(binDir(), `${g.file.name}.tmp`), g.buf)
    for (const g of got) {
      const dst = path.join(binDir(), g.file.name)
      try {
        fs.renameSync(`${dst}.tmp`, dst)
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code
        if (code === 'EBUSY' || code === 'EPERM') throw new Error(t('DLL занята — закройте VR-игры и попробуйте снова'))
        throw e
      }
    }
    fs.writeFileSync(metaFile(), JSON.stringify({ installedAt: Date.now(), files: got.map((g) => g.file) }, null, 2))
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Есть ли сборка новее: сравниваем заголовки сервера с сохранёнными при загрузке */
export async function checkOcUpdate(): Promise<{ update: boolean; error?: string }> {
  const meta = readMeta()
  if (!ocState().installed || !meta) return { update: true }
  try {
    for (const f of OC_FILES) {
      const res = await httpFetch(BASE + encodeURIComponent(f.artefact), { method: 'HEAD' })
      if (!res.ok) return { update: false, error: t('сервер ответил {status}', { status: res.status }) }
      const known = meta.files.find((k) => k.name === f.name)
      const now = { size: Number(res.headers.get('content-length')) || 0, ...headersOf(res) }
      if (!known) return { update: true }
      if (now.etag && known.etag ? now.etag !== known.etag : now.size !== known.size || now.lastModified !== known.lastModified)
        return { update: true }
    }
    return { update: false }
  } catch (e) {
    return { update: false, error: (e as Error).message }
  }
}
