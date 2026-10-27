// Прикладывает к релизу v<версия> файл update-summary.json — короткую сводку для окна обновления в PlayOS.
// Источник — scripts/notes/<версия>.app.json: { importance, ru: { new, fixed }, en: { new, fixed } }.
// Версия — из package.json или первым аргументом: node scripts/release-summary.mjs 1.1.0-beta.1
// Работает и с черновиком, и с опубликованным релизом: старый файл сводки заменяется.
import { existsSync, readFileSync } from 'node:fs'

const version = process.argv[2] ?? JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
const file = new URL(`./notes/${version}.app.json`, import.meta.url)
if (!existsSync(file)) {
  console.log(`Нет scripts/notes/${version}.app.json — PlayOS покажет заметки к релизу`)
  process.exit(0)
}

const summary = JSON.parse(readFileSync(file, 'utf8'))
const lists = ['ru', 'en'].flatMap((l) => ['new', 'fixed'].map((k) => summary[l]?.[k] ?? []))
if (!lists.every(Array.isArray) || !lists.some((l) => l.length)) {
  console.error('В сводке нет пунктов: нужны ru/en { new: [...], fixed: [...] }')
  process.exit(1)
}
if (summary.importance && !['critical', 'normal', 'minor'].includes(summary.importance)) {
  console.error('importance: critical | normal | minor')
  process.exit(1)
}

const token = process.env.GH_TOKEN
if (!token) {
  console.error('Нет GH_TOKEN')
  process.exit(1)
}
const api = 'https://api.github.com/repos/fakem1nk/PlayOS/releases'
const headers = { Authorization: `Bearer ${token}`, 'User-Agent': 'PlayOS-release', Accept: 'application/vnd.github+json' }
const tag = `v${version}`
const name = 'update-summary.json'

const list = await (await fetch(`${api}?per_page=50`, { headers })).json()
const release = Array.isArray(list) && list.find((r) => r.tag_name === tag)
if (!release) {
  console.error(`Релиз ${tag} не найден`)
  process.exit(1)
}
for (const a of release.assets.filter((a) => a.name === name)) await fetch(`${api}/assets/${a.id}`, { method: 'DELETE', headers })

const res = await fetch(`https://uploads.github.com/repos/fakem1nk/PlayOS/releases/${release.id}/assets?name=${name}`, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify(summary)
})
if (!res.ok) {
  console.error('Не удалось загрузить сводку:', res.status, await res.text())
  process.exit(1)
}
console.log(`Сводка приложена к ${tag}`)
