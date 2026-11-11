// Проверка синхронизации сохранений на двух «ПК» с общей папкой облака: каждый запуск — один шаг одного ПК
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
const game = {
  id: 'g1',
  title: 'Test Game',
  platform: 'pc',
  path: path.join(dev, 'Games', 'TestGame', 'game.exe'),
  saveDirs: [path.join(process.env.APPDATA, 'TestGame')],
  sessions: [],
  playtime: 0,
  addedAt: 0
} as never
const settings = { trophies: {}, cloud: { saves: true, keepVersions: 3, profile: false, library: false } } as never

app.whenReady().then(async () => {
  const account = await import('@main/cloud/account')
  const sync = await import('@main/cloud/sync')
  const out: Record<string, unknown> = { role: ROLE, step: STEP }
  try {
    if (STEP === 'decide') {
      const d = sync.decide
      out.table = [
        d(null, undefined, null) === 'none',
        d('a', undefined, null) === 'upload',
        d(null, undefined, 'a') === 'download',
        d('a', 'x', 'a') === 'synced',
        d('a', 'a', 'b') === 'download',
        d('b', 'a', 'a') === 'upload',
        d('b', 'a', 'c') === 'conflict'
      ]
    } else {
      fs.mkdirSync(path.join(ROOT, 'cloud'), { recursive: true })
      if (!account.remote()) await account.signInFolder(path.join(ROOT, 'cloud'))
      sync.initSync({
        games: () => [game],
        settings: () => settings,
        runningGame: () => (process.env.T_RUNNING ? game : undefined),
        onChange: () => {},
        hooks: { applySettings: () => {}, changed: () => {}, locate: async () => {} },
        setCloudSettings: () => {}
      })
      const write = (v: string) => {
        fs.mkdirSync(saveDir, { recursive: true })
        fs.writeFileSync(saveFile, v)
      }
      const [action, value] = STEP.split(':')
      if (action === 'write') write(value)
      if (action === 'sync' || action === 'write') await sync.syncAll()
      if (action === 'writeonly') write(value)
      if (action === 'choose') {
        sync.restoreChoice({ profile: false, library: false, saves: true })
        await sync.syncAll()
      }
      if (action === 'resolve') await sync.resolve(game, value as 'local' | 'cloud')
      const cloudDir = path.join(ROOT, 'cloud', 'PlayOS')
      const setDir = () => path.join(cloudDir, 'saves', fs.readdirSync(path.join(cloudDir, 'saves'))[0])
      const snaps = () => fs.readdirSync(setDir()).sort()
      // Обрезанный самый свежий снимок: другой ПК не должен положить его на сохранения
      if (action === 'corrupt') {
        const last = snaps().at(-1)!
        const f = path.join(setDir(), last)
        fs.writeFileSync(f, fs.readFileSync(f).subarray(0, 40))
        out.corrupted = last
      }
      // Копия-конфликт файла устройства с «головой» на несуществующий новый снимок — должна игнорироваться
      if (action === 'conflictcopy') {
        const id = '11111111-2222-3333-4444-555555555555'
        const fake = { id, name: 'GHOST', seen: Date.now(), version: '0', heads: { [path.basename(setDir())]: `${Date.now() + 1e9}_11111111_0123456789abcdef.zip` } }
        fs.writeFileSync(path.join(cloudDir, 'devices', `${id}-GHOSTPC.json`), JSON.stringify(fake))
        await sync.syncAll()
      }
      if (action === 'snaps') out.snaps = snaps()
      if (action === 'versions') out.versions = (await sync.versions(game)).map((v) => `${v.device}:${v.hash.slice(0, 6)}`)
      if (action === 'restore') {
        const list = await sync.versions(game)
        await sync.restoreVersion(game, list[list.length - 1].name)
      }
      const st = sync.gameStatus(game)
      out.state = st.state
      out.conflict = !!st.conflict
      if (st.error) out.reason = st.error
      out.file = fs.existsSync(saveFile) ? fs.readFileSync(saveFile, 'utf8') : null
    }
  } catch (e) {
    out.error = (e as Error).stack
  }
  console.log('RESULT ' + JSON.stringify(out))
  app.exit(0)
})
