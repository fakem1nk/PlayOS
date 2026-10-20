// Создаёт черновик релиза v<версия> на GitHub до загрузки файлов.
// Иначе electron-builder грузит файлы параллельно и может создать два черновика вместо одного.
import { readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const token = process.env.GH_TOKEN
if (!token) {
  console.error('Нет GH_TOKEN: сохраните токен командой setx GH_TOKEN "…" и откройте новый терминал')
  process.exit(1)
}
const api = 'https://api.github.com/repos/fakem1nk/PlayOS/releases'
const headers = { Authorization: `Bearer ${token}`, 'User-Agent': 'PlayOS-release', Accept: 'application/vnd.github+json' }
const tag = `v${version}`
const list = await (await fetch(`${api}?per_page=50`, { headers })).json()
if (!Array.isArray(list)) {
  console.error('GitHub не отдал список релизов:', list.message ?? list)
  process.exit(1)
}
if (list.some((r) => r.tag_name === tag)) {
  console.log(`Релиз ${tag} уже есть — файлы загрузятся в него`)
} else {
  const res = await fetch(api, { method: 'POST', headers, body: JSON.stringify({ tag_name: tag, name: version, draft: true }) })
  if (!res.ok) {
    console.error('Не удалось создать черновик:', res.status, await res.text())
    process.exit(1)
  }
  console.log(`Создан черновик ${tag}`)
}
