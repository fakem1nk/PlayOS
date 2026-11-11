// Профиль и библиотека на двух «ПК» с общей папкой облака: каждый запуск — один шаг одного ПК
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

app.whenReady().then(async () => {
  const store = await import('@main/store')
  const account = await import('@main/cloud/account')
  const sync = await import('@main/cloud/sync')
  const { libraryKey } = await import('@main/cloud/library')
  const out: Record<string, unknown> = { role: ROLE, step: STEP }
  try {
    const db = store.loadDb()
    store.setDevice(account.deviceId().replace(/-/g, '').slice(0, 8))
    db.settings.cloud ??= { saves: false, keepVersions: 3 }
    fs.mkdirSync(path.join(ROOT, 'cloud'), { recursive: true })
    if (!account.remote()) await account.signInFolder(path.join(ROOT, 'cloud'))
    sync.initSync({
      games: () => db.games,
      settings: () => db.settings,
      runningGame: () => undefined,
      onChange: () => {},
      hooks: { applySettings: (p) => Object.assign(db.settings, p), changed: () => {}, locate: async () => {}, fillArt: async (g) => { g.cover = 'found-online' } },
      setCloudSettings: (p, reset) => {
        db.settings.cloud = { saves: false, keepVersions: 3, ...db.settings.cloud, ...p }
        if (reset) db.settingsAt = 0
      }
    })
    const [action, value] = STEP.split(':')
    if (action === 'add') {
      // Игра с обложкой и 100 с времени до облака
      const cover = path.join(dev, 'cover.png')
      fs.writeFileSync(cover, 'PNGDATA-' + value)
      db.games.push({ id: 'g-' + value, title: value, platform: 'pc', path: 'C:\\Games\\x.exe', cover, playtime: 100, addedAt: 1, sessions: [] } as never)
      db.settings.userName = 'Alice'
      db.settingsAt = Date.now()
    }
    if (action === 'play') {
      const g = db.games.find((x) => x.title === value)!
      store.commitSession(g.id, Date.now() - Number(process.env.T_SEC) * 1000, Date.now())
    }
    if (action === 'delete') {
      const g = db.games.find((x) => x.title === value)!
      db.deleted = [...(db.deleted ?? []), { key: libraryKey(g), at: Date.now() }]
      db.games = db.games.filter((x) => x !== g)
    }
    if (action === 'rename') {
      db.settings.userName = value
      db.settingsAt = Date.now()
    }
    // Профиль от старой версии PlayOS: в облаке оказались настройки этого ПК (масштаб, размер уведомлений)
    const profFile = path.join(ROOT, 'cloud', 'PlayOS', 'profile', 'profile.json')
    if (action === 'legacy') {
      const prof = JSON.parse(fs.readFileSync(profFile, 'utf8'))
      prof.updatedAt = Date.now() + 1000
      prof.settings = { ...prof.settings, userName: value, uiScale: 1.7, noticeSize: 'large' }
      fs.writeFileSync(profFile, JSON.stringify(prof))
    }
    if (action !== 'choose') await sync.syncAll()
    if (action === 'legacy') {
      out.uiScale = db.settings.uiScale ?? null
      out.noticeSize = db.settings.noticeSize ?? null
      const cloudSettings = JSON.parse(fs.readFileSync(profFile, 'utf8')).settings
      out.cloudDeviceKeys = ['uiScale', 'noticeSize', 'cloud', 'trophies'].filter((k) => k in cloudSettings)
    }
    out.offer = !!sync.status().restore
    if (action === 'choose') {
      sync.restoreChoice({ profile: true, library: true, saves: false })
      await sync.syncAll()
    }
    store.saveDbNow()
    out.user = db.settings.userName
    out.games = db.games.map((g) => `${g.title}:${g.playtime}s:${g.path ? 'installed' : 'missing'}:${g.cover === 'found-online' ? 'found-online' : g.cover && fs.existsSync(g.cover) ? 'own-file' : 'nocover'}`)
  } catch (e) {
    out.error = (e as Error).stack
  }
  console.log('RESULT ' + JSON.stringify(out))
  app.exit(0)
})
