// Создаёт черновик релиза v<версия> на GitHub до загрузки файлов.
// Иначе electron-builder грузит файлы параллельно и может создать два черновика вместо одного.
// Описание берётся из scripts/notes/<версия>.md, версии до 1.0.0 помечаются как pre-release.
import { existsSync, readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const token = process.env.GH_TOKEN
if (!token) {
  console.error('Нет GH_TOKEN: сохраните токен командой setx GH_TOKEN "…" и откройте новый терминал')
  process.exit(1)
}
const api = 'https://api.github.com/repos/fakem1nk/PlayOS/releases'
const headers = { Authorization: `Bearer ${token}`, 'User-Agent': 'PlayOS-release', Accept: 'application/vnd.github+json' }
const tag = `v${version}`
const notesFile = new URL(`./notes/${version}.md`, import.meta.url)
const body = existsSync(notesFile) ? readFileSync(notesFile, 'utf8') : ''
const prerelease = Number(version.split('.')[0]) < 1

const list = await (await fetch(`${api}?per_page=50`, { headers })).json()
if (!Array.isArray(list)) {
  console.error('GitHub не отдал список релизов:', list.message ?? list)
  process.exit(1)
}
const existing = list.find((r) => r.tag_name === tag)
if (existing && !existing.draft) {
  console.error(`Релиз ${tag} уже опубликован — поднимите версию в package.json`)
  process.exit(1)
}
if (existing) {
  // Пересборка того же черновика: старые файлы удаляем, иначе загрузка новых упадёт
  for (const a of existing.assets) await fetch(`${api}/assets/${a.id}`, { method: 'DELETE', headers })
  if (body) await fetch(`${api}/${existing.id}`, { method: 'PATCH', headers, body: JSON.stringify({ body }) })
  console.log(`Черновик ${tag} уже есть — файлы будут заменены`)
} else {
  const res = await fetch(api, {
    method: 'POST',
    headers,
    body: JSON.stringify({ tag_name: tag, target_commitish: process.env.GITHUB_SHA ?? 'main', name: `PlayOS ${version}`, body, draft: true, prerelease })
  })
  if (!res.ok) {
    console.error('Не удалось создать черновик:', res.status, await res.text())
    process.exit(1)
  }
  console.log(`Создан черновик ${tag}${prerelease ? ' (pre-release)' : ''}`)
}
