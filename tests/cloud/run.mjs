// Тесты облачной синхронизации: `npm test`.
// Каждый сценарий — два «ПК» (A и B) с отдельными папками данных и общей папкой облака во временном каталоге.
// Один шаг = один запуск Electron с настоящим кодом из src/main/cloud; настоящие данные PlayOS и реестр не трогаются.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, '../..')
const electron = require('electron')
const outDir = path.join(root, 'out', 'tests')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'playos-tests-'))
const only = process.argv[2]
let failed = 0
let count = 0
let passed = 0

function build(name) {
  const out = path.join(outDir, `${name}.cjs`)
  const res = spawnSync(process.execPath, [path.join(root, 'node_modules/rolldown/bin/cli.mjs'), '-c', path.join(import.meta.dirname, 'rolldown.config.mjs')], {
    cwd: root,
    env: { ...process.env, ENTRY: path.join(import.meta.dirname, `${name}.ts`), OUT: out },
    encoding: 'utf8'
  })
  if (res.status !== 0) throw new Error(`Сценарий ${name} не собрался:\n${res.stdout}\n${res.stderr}`)
  return out
}

/** Один шаг одного ПК; возвращает то, что сценарий напечатал после RESULT */
function step(bundle, dir, role, name, env = {}) {
  const res = spawnSync(electron, [bundle], {
    cwd: root,
    env: { ...process.env, ...env, T_ROOT: path.join(tmp, dir), T_ROLE: role, T_STEP: name },
    encoding: 'utf8',
    timeout: 120_000
  })
  const line = (res.stdout ?? '').split(/\r?\n/).find((l) => l.startsWith('RESULT '))
  if (!line) return { error: `нет результата (код ${res.status}): ${(res.stderr ?? '').slice(-400)}` }
  return JSON.parse(line.slice(7))
}

/** Сценарий: шаги [ПК, шаг, проверка результата, переменные окружения] */
function scenario(title, file, steps) {
  if (only && !title.includes(only) && file !== only) return
  console.log(`\n${title}`)
  const bundle = build(file)
  // У каждого сценария своя папка: названия русские, поэтому различаем по номеру
  const dir = `${file}-${++count}`
  for (const [role, name, check, env] of steps) {
    const out = step(bundle, dir, role, name, env)
    let ok = false
    try {
      ok = !out.error && check(out) === true
    } catch {
      ok = false
    }
    if (ok) passed++
    else failed++
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${role} ${name}${ok ? '' : `\n       ${JSON.stringify(out).slice(0, 900)}`}`)
  }
}

const all = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => x === true)
const file = (v) => (o) => o.state === 'synced' && o.file === v
const any = () => true

scenario('Сохранения: загрузка, конфликт, история версий', 'saves', [
  ['A', 'decide', (o) => all(o.table)],
  ['A', 'write:a1', file('a1')],
  ['B', 'sync', file('a1')],
  ['B', 'write:b2', file('b2')],
  ['A', 'sync', file('b2')],
  ['A', 'writeonly:x', (o) => o.file === 'x'],
  ['B', 'write:y', file('y')],
  ['A', 'sync', (o) => o.state === 'conflict' && o.conflict === true && o.file === 'x'],
  ['A', 'resolve:cloud', file('y')],
  // Версия этого ПК после выбора облачной остаётся в истории
  ['A', 'versions', (o) => o.versions.length >= 3],
  // Обрезанный снимок на место не ложится
  ['B', 'corrupt', any],
  ['A', 'write:z', file('z')],
  ['B', 'sync', file('z')],
  ['B', 'restore', (o) => o.file !== 'z' && !o.error],
  ['A', 'sync', (o) => o.state === 'synced' && o.file !== 'z']
])

scenario('Библиотека и профиль: два ПК', 'library', [
  ['A', 'add:Foo', (o) => o.user === 'Alice' && o.games.join() === 'Foo:100s:installed:own-file'],
  ['B', 'choose', (o) => o.user === 'Alice' && o.games.join() === 'Foo:100s:missing:found-online'],
  ['B', 'play:Foo', (o) => o.games.join() === 'Foo:150s:missing:found-online', { T_SEC: '50' }],
  ['A', 'sync', (o) => o.games.join() === 'Foo:150s:installed:own-file'],
  ['A', 'rename:Bob', (o) => o.user === 'Bob'],
  ['B', 'sync', (o) => o.user === 'Bob'],
  // Настройки этого ПК из профиля старой версии не применяются и из облака уходят
  ['A', 'legacy:Old', (o) => o.user === 'Old' && o.uiScale === 1 && o.noticeSize === null && o.cloudDeviceKeys.length === 0],
  ['B', 'sync', (o) => o.user === 'Old'],
  ['A', 'delete:Foo', (o) => o.games.length === 0],
  ['B', 'sync', (o) => o.games.length === 0]
])

const rejected = (o) => o.state === 'error' && o.planted !== true && o.file === 'v1'
scenario('Безопасность: чужие данные в облаке', 'security', [
  ['A', 'unit', (o) => ['covers', 'regKeys', 'regFiles', 'bomb', 'urls', 'roundtrip', 'evilLib', 'evilProf', 'args'].every((k) => all(o[k])) && o.badShape === true],
  ['A', 'write:v1', file('v1')],
  ['B', 'sync', file('v1')],
  // Снимок с верным хэшем, но с файлом вне папок сохранений игры, отклоняется целиком
  ['B', 'evil:startup', rejected, { T_N: '1' }],
  ['B', 'evil:dll', rejected, { T_N: '2' }],
  ['B', 'evil:traversal', rejected, { T_N: '3' }],
  ['B', 'evil:stream', rejected, { T_N: '4' }],
  ['B', 'evil:registry', rejected, { T_N: '5' }],
  ['B', 'evil:good', file('from-cloud'), { T_N: '6' }],
  ['A', 'sync', file('from-cloud')]
])

const games = (v) => (o) => o.state === 'synced' && o.games === v
let stamp = ''
scenario('Слияние по полям, массовое удаление, формат', 'merge', [
  ['A', 'unit', (o) => o.retainedOk === true && o.budget === true && all(o.rollback) && all(o.applied)],
  // Ключи API в облако не уходят
  ['A', 'add:8', (o) => o.secretInCloud === false && o.format === '{"format":1}' && o.fieldAt === 0],
  ['B', 'choose', games('G1,G2,G3,G4,G5,G6,G7,G8')],
  // Название поменяли на одном ПК, «избранное» — на другом: остаются обе правки
  ['A', 'edit:G1:title=Alpha', games('Alpha,G2,G3,G4,G5,G6,G7,G8')],
  ['B', 'edit:G1:favorite=true', games('Alpha*,G2,G3,G4,G5,G6,G7,G8')],
  ['A', 'sync', (o) => (stamp = o.stamp) && o.games === 'Alpha*,G2,G3,G4,G5,G6,G7,G8'],
  // Без изменений файлы в облаке не перезаписываются: иначе два ПК переписывали бы их по кругу
  ['B', 'sync', (o) => o.stamp === stamp],
  ['A', 'sync', (o) => o.stamp === stamp],
  ['B', 'sync', (o) => o.stamp === stamp && o.games === 'Alpha*,G2,G3,G4,G5,G6,G7,G8'],
  ['A', 'deleteall', games('')],
  // Массовое удаление ждёт «Синхронизировать»; перед удалением остаётся копия библиотеки
  ['B', 'sync', (o) => o.state === 'error' && o.games === 'Alpha*,G2,G3,G4,G5,G6,G7,G8' && o.libBackups === 0],
  ['B', 'syncnow', (o) => o.state === 'synced' && o.games === '' && o.libBackups === 1],
  ['A', 'format:9', (o) => o.state === 'error'],
  ['A', 'format:1', (o) => o.state === 'synced']
])

const shelf = (v) => (o) => o.state === 'synced' && o.shelf === v
scenario('Полка профиля: «пройдено» и стопка между двумя ПК', 'merge', [
  ['A', 'add:3', games('G1,G2,G3')],
  ['B', 'choose', games('G1,G2,G3')],
  // Одну игру отметили пройденной на одном ПК и положили в стопку на другом — остаётся и то, и другое
  ['A', 'shelf:G2:done', shelf('G2:love:')],
  ['B', 'shelf:G2:pile', shelf('G2:love:{"main":1.5}')],
  ['A', 'sync', shelf('G2:love:{"main":1.5}')],
  // Одно и то же поле поменяли на обоих ПК — побеждает более поздняя правка, одинаково на обоих
  ['A', 'shelf:G3:done', shelf('G2:love:{"main":1.5},G3:love:')],
  ['B', 'shelf:G3:donebad', shelf('G2:love:{"main":1.5},G3:bad:')],
  ['A', 'sync', shelf('G2:love:{"main":1.5},G3:bad:')],
  ['B', 'sync', shelf('G2:love:{"main":1.5},G3:bad:')]
])

scenario('Запуск игры: сохранения вне очереди', 'merge', [
  ['A', 'write:v1', (o) => o.file === 'v1', { T_SAVES: '1' }],
  ['B', 'choose', (o) => o.file === 'v1', { T_SAVES: '1' }],
  ['A', 'write:v2', (o) => o.file === 'v2', { T_SAVES: '1' }],
  ['B', 'launch', (o) => o.conflict === null && o.file === 'v2', { T_SAVES: '1' }],
  ['A', 'write:v3', (o) => o.file === 'v3', { T_SAVES: '1' }],
  // «Играть без ожидания»: запуск не ждёт облако, сохранения доезжают следом
  ['B', 'skip', (o) => o.conflict === null && o.launchMs < 2000 && o.file === 'v3', { T_SAVES: '1' }]
])

scenario('Google Drive: клиент против локальной копии API', 'gdrive', [
  ['A', 'all', (o) => o.binaryOk === true && o.quoteOk === true && o.overwrite === '{"a":2}' && o.devices === 1 && o.missingDir === 0 && o.afterRemove === 0 && o.account?.provider === 'google']
])

scenario('Файл библиотеки: повреждение и ключи API', 'store', [
  ['A', 'all', (o) => all(o.checks)]
])

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${passed} шагов прошло, ${failed} нет`)
process.exit(failed ? 1 : 0)
