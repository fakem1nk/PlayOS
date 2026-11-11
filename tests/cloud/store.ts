// library.json: повреждённый файл не превращается в пустую библиотеку, ключи API на диске зашифрованы
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

const dev = path.join(process.env.T_ROOT!, process.env.T_ROLE!)
const data = path.join(dev, 'userData')
app.setPath('userData', data)

app.whenReady().then(async () => {
  const store = await import('@main/store')
  const out: Record<string, unknown> = {}
  const checks: boolean[] = []
  try {
    const file = path.join(data, 'library.json')
    const KEY = 'STEAMKEY0123456789ABCDEF01234567'
    // Первый запуск: файла нет — пустая библиотека, это не повреждение
    let db = store.loadDb()
    checks.push(db.games.length === 0 && store.loadIssue() === null)
    db.games.push({ id: 'g1', title: 'Foo', platform: 'pc', path: 'C:\\g\\foo.exe', playtime: 5, addedAt: 1, sessions: [] } as never)
    db.settings.steamKey = KEY
    db.settings.raKey = 'RAKEY-SECRET'
    store.saveDbNow()
    // На диске ключей открытым текстом нет, в памяти и в копии для переноса — есть
    const text = fs.readFileSync(file, 'utf8')
    checks.push(!text.includes(KEY) && !text.includes('RAKEY-SECRET') && text.includes('"secrets"'))
    checks.push(store.dbJson(true).includes(KEY) && !store.dbJson(true).includes('"secrets"'))
    db = store.loadDb()
    checks.push(db.settings.steamKey === KEY && db.settings.raKey === 'RAKEY-SECRET' && db.games.length === 1 && store.loadIssue() === null)
    // Файл повреждён: библиотека берётся из копии с прошлого запуска, повреждённый файл отложен
    fs.writeFileSync(file, '{"games":[{"id":"g1","tit')
    db = store.loadDb()
    const issue = store.loadIssue()
    checks.push(!!issue?.restored && db.games.length === 1 && db.games[0].title === 'Foo' && db.settings.steamKey === KEY)
    checks.push(!!issue && fs.readFileSync(issue.broken, 'utf8') === '{"games":[{"id":"g1","tit')
    // Следующее сохранение пишет восстановленную библиотеку, а не пустую
    store.saveDbNow()
    checks.push(store.loadDb().games.length === 1 && store.loadIssue() === null)
    // Не объект библиотеки — тоже повреждение
    fs.writeFileSync(file, '[1,2,3]')
    checks.push(store.loadDb().games.length === 1 && !!store.loadIssue()?.restored)
    // Копии нет: библиотека пустая, но повреждённый файл сохранён
    fs.writeFileSync(file, 'мусор')
    fs.rmSync(path.join(data, 'library.last-good.json'))
    db = store.loadDb()
    checks.push(db.games.length === 0 && store.loadIssue()?.restored === false && fs.existsSync(store.loadIssue()!.broken))
    // Файл прошлых версий с ключами открытым текстом читается как раньше
    fs.writeFileSync(file, JSON.stringify({ games: [], settings: { steamKey: KEY } }))
    checks.push(store.loadDb().settings.steamKey === KEY)
    // Блок ключей с другого ПК не расшифровывается — ключи пустые, остальное на месте
    fs.writeFileSync(file, JSON.stringify({ games: [{ id: 'x', title: 'X', platform: 'pc', path: '' }], settings: { steamKey: '', userName: 'Bob' }, secrets: 'AAAA' }))
    db = store.loadDb()
    checks.push(db.settings.steamKey === '' && db.settings.userName === 'Bob' && db.games.length === 1)
  } catch (e) {
    out.error = (e as Error).stack
  }
  out.checks = checks
  console.log('RESULT ' + JSON.stringify(out))
  app.exit(0)
})
