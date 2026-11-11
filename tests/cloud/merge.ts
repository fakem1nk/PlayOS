// Слияние по полям, защита от массового удаления, отметка формата,
// история по времени, откат недописанного снимка, запуск игры вне очереди, ключи API вне облака.
// Каждый запуск — один шаг одного «ПК» (как saves.ts / library.ts).
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.env.T_ROOT!
const ROLE = process.env.T_ROLE!
const STEP = process.env.T_STEP!
const dev = path.join(ROOT, ROLE)
process.env.APPDATA = path.join(dev, 'Roaming')
process.env.LOCALAPPDATA = path.join(dev, 'Local')
app.setPath('userData', path.join(dev, 'userData'))
app.setPath('documents', path.join(dev, 'Docs'))

const saveDir = path.join(process.env.APPDATA, 'TestGame', 'Saves')
const saveFile = path.join(saveDir, 'slot1.sav')
const DAY = 86_400_000

app.whenReady().then(async () => {
  const store = await import('@main/store')
  const account = await import('@main/cloud/account')
  const sync = await import('@main/cloud/sync')
  const snap = await import('@main/cloud/snapshot')
  const { libraryKey } = await import('@main/cloud/library')
  const out: Record<string, unknown> = { role: ROLE, step: STEP }
  try {
    const db = store.loadDb()
    store.setDevice(account.deviceId().replace(/-/g, '').slice(0, 8))
    db.settings.cloud ??= { saves: true, keepVersions: 3 }
    const [action, a1, a2] = STEP.split(':')
    if (action === 'unit') {
      // История: 3 последних + по одному за день (7 дней) и за неделю (5 недель)
      const now = 100 * 7 * DAY + DAY / 2
      const mk = (ageDays: number, n = 0, size = 10) => ({ name: `s${ageDays}-${n}`, at: now - ageDays * DAY - n * 60_000, size })
      const snaps = [mk(0, 0), mk(0, 1), mk(0, 2), mk(0, 3), mk(0, 4), mk(1, 0), mk(1, 1), mk(2, 0), mk(6, 0), mk(10, 0), mk(11, 0), mk(20, 0), mk(40, 0)]
      const kept = [...sync.retained(snaps, 3, now)].sort()
      out.retained = kept.join(',')
      out.retainedOk = ['s0-0', 's0-1', 's0-2', 's1-0', 's2-0', 's6-0', 's20-0'].every((n) => kept.includes(n)) && !kept.includes('s0-3') && !kept.includes('s1-1') && !kept.includes('s40-0')
      // Большие снимки: дополнительные не выходят за бюджет
      const big = [mk(0, 0, 150 * 2 ** 20), mk(1, 0, 150 * 2 ** 20), mk(2, 0, 150 * 2 ** 20), mk(3, 0, 150 * 2 ** 20)]
      out.budget = sync.retained(big, 1, now).size === 2
      // Откат: второй файл снимка не ложится (на его месте папка) — первый возвращается к прежнему содержимому
      const dir = path.join(process.env.APPDATA!, 'RollGame')
      fs.mkdirSync(path.join(dir, 'c.sav'), { recursive: true })
      fs.writeFileSync(path.join(dir, 'a.sav'), 'A-old')
      const set = { key: 'pc:t:roll', title: 'r', patterns: [dir], registry: [], ctx: {} }
      const src = path.join(dev, 'new.bin')
      fs.writeFileSync(src, 'A-new')
      const packed = await snap.pack({ files: [{ name: '%APPDATA%/RollGame/a.sav', abs: src, size: 5, mtime: 1 }, { name: '%APPDATA%/RollGame/c.sav', abs: src, size: 5, mtime: 1 }], registry: [], hash: 'x', size: 10, at: 1 })
      let failed = false
      try {
        await snap.apply(set, packed.data, await snap.localState(set), packed.hash)
      } catch {
        failed = true
      }
      out.rollback = [failed, fs.readFileSync(path.join(dir, 'a.sav'), 'utf8') === 'A-old', fs.readdirSync(dir).sort().join() === 'a.sav,c.sav', fs.statSync(path.join(dir, 'c.sav')).isDirectory()]
      // А целый снимок ложится
      fs.rmSync(path.join(dir, 'c.sav'), { recursive: true })
      await snap.apply(set, packed.data, await snap.localState(set), packed.hash)
      out.applied = [fs.readFileSync(path.join(dir, 'a.sav'), 'utf8') === 'A-new', fs.readFileSync(path.join(dir, 'c.sav'), 'utf8') === 'A-new', fs.readdirSync(dir).length === 2]
    } else {
      const saveGame = { id: 'save1', title: 'Save Game', platform: 'pc', path: path.join(dev, 'Games', 'TestGame', 'game.exe'), saveDirs: [path.join(process.env.APPDATA!, 'TestGame')], sessions: [], playtime: 0, addedAt: 1 } as never
      fs.mkdirSync(path.join(ROOT, 'cloud'), { recursive: true })
      if (!account.remote()) await account.signInFolder(path.join(ROOT, 'cloud'))
      sync.initSync({
        games: () => [...db.games, ...(process.env.T_SAVES ? [saveGame] : [])],
        settings: () => db.settings,
        runningGame: () => undefined,
        onChange: () => {},
        hooks: { applySettings: (p) => Object.assign(db.settings, p), changed: () => {}, locate: async () => {}, fillArt: async () => {} },
        setCloudSettings: (p, reset) => {
          db.settings.cloud = { saves: true, keepVersions: 3, ...db.settings.cloud, ...p }
          if (reset) db.settingsAt = 0
        }
      })
      const cloudDir = path.join(ROOT, 'cloud', 'PlayOS')
      const find = (title: string) => db.games.find((g) => g.title === title || g.cloudKey === `pc:t:${title.toLowerCase()}`)!
      if (action === 'add') {
        for (let i = 1; i <= Number(a1); i++) db.games.push({ id: `${ROLE}-g${i}`, title: `G${i}`, platform: 'pc', path: `C:\\Games\\g${i}.exe`, playtime: 0, addedAt: 1, sessions: [] } as never)
        db.settings.userName = 'Alice'
        db.settings.steamKey = 'SECRETSTEAMKEY0123456789ABCDEF00'
        db.settings.raKey = 'SECRETRAKEY'
        db.settingsAt = Date.now()
      }
      if (action === 'edit') {
        const g = find(a1) as unknown as Record<string, unknown>
        const [field, value] = a2.split('=')
        g[field] = value === 'true' ? true : value
        g.updatedAt = Date.now()
      }
      // Полка профиля: «пройдено» (done, donebad — с другой оценкой) и стопка (pile)
      if (action === 'shelf') {
        const g = find(a1)
        if (a2 === 'pile') g.pile = { main: 1.5 }
        else g.done = { at: Date.now(), full: a2 === 'done', mood: a2 === 'done' ? 'love' : 'bad', playtime: 10, days: 2 }
        g.updatedAt = Date.now()
      }
      if (action === 'deleteall') {
        db.deleted = [...(db.deleted ?? []), ...db.games.map((g) => ({ key: g.cloudKey ?? libraryKey(g), at: Date.now() }))]
        db.games = []
      }
      if (action === 'format') {
        fs.mkdirSync(path.join(cloudDir, 'meta'), { recursive: true })
        fs.writeFileSync(path.join(cloudDir, 'meta', 'format.json'), JSON.stringify({ format: Number(a1) }))
      }
      if (action === 'write') {
        fs.mkdirSync(saveDir, { recursive: true })
        fs.writeFileSync(saveFile, a1)
      }
      if (action === 'choose') {
        await sync.syncAll()
        sync.restoreChoice({ profile: true, library: true, saves: true })
      }
      if (action === 'syncnow') await sync.syncNow()
      else if (action === 'launch') {
        // Идёт общая синхронизация — наборы игры проходят вне очереди
        const all = sync.syncAll()
        await new Promise((r) => setTimeout(r, 5))
        const t0 = Date.now()
        out.conflict = await sync.beforeLaunch(saveGame)
        out.launchMs = Date.now() - t0
        await all
      } else if (action === 'skip') {
        // «Играть без ожидания»: запуск не ждёт облако
        const t0 = Date.now()
        out.conflict = await sync.beforeLaunch(saveGame, Promise.resolve())
        out.launchMs = Date.now() - t0
        await sync.syncAll()
      } else await sync.syncAll()
      store.saveDbNow()
      const st = sync.status()
      out.state = st.state
      if (st.error) out.reason = st.error.slice(0, 90)
      out.games = db.games.map((g) => `${g.title}${g.favorite ? '*' : ''}`).join(',')
      out.shelf = db.games
        .filter((g) => g.done || g.pile)
        .map((g) => `${g.title}:${g.done?.mood ?? ''}:${g.pile ? JSON.stringify(g.pile) : ''}`)
        .join(',')
      if (process.env.T_SAVES) out.file = fs.existsSync(saveFile) ? fs.readFileSync(saveFile, 'utf8') : null
      const read = (f: string) => (fs.existsSync(path.join(cloudDir, f)) ? fs.readFileSync(path.join(cloudDir, f), 'utf8') : '')
      out.secretInCloud = /SECRET/.test(read('profile/profile.json'))
      out.fieldAt = (read('library/library.json').match(/"fieldAt"/g) ?? []).length
      out.format = read('meta/format.json')
      const backups = path.join(dev, 'userData', 'backups', 'library')
      out.libBackups = fs.existsSync(backups) ? fs.readdirSync(backups).length : 0
      out.stamp = ['library/library.json', 'profile/profile.json'].map((f) => (fs.existsSync(path.join(cloudDir, f)) ? Math.round(fs.statSync(path.join(cloudDir, f)).mtimeMs) : 0)).join('/')
    }
  } catch (e) {
    out.error = (e as Error).stack
  }
  console.log('RESULT ' + JSON.stringify(out))
  app.exit(0)
})
