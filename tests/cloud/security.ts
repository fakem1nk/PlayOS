// Атаки через облако: чужие снимки, профиль и библиотека не должны писать за пределы папок сохранений игры.
// Каждый запуск — один шаг одного «ПК» (как saves.ts). Реестр не трогается: проверяются только отказы.
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

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

const reg = (key: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`Windows Registry Editor Version 5.00\r\n\r\n[${key}]\r\n"x"="y"\r\n`, 'utf16le')])

app.whenReady().then(async () => {
  const account = await import('@main/cloud/account')
  const sync = await import('@main/cloud/sync')
  const snap = await import('@main/cloud/snapshot')
  const out: Record<string, unknown> = { role: ROLE, step: STEP }
  try {
    if (STEP === 'unit') {
      const { cleanLibrary, cleanProfile, webUrl } = await import('@main/cloud/untrusted')
      const { mergeLibrary, mergeProfile } = await import('@main/cloud/library')
      const { readZipBuffer } = await import('@main/backup')
      const A = process.env.APPDATA!
      const set = { key: 'pc:t', title: 't', patterns: [path.join(A, 'TestGame'), path.join(A, 'Glob', '*.sav')], accept: [path.join(A, 'Emu', '123')], registry: ['HKEY_CURRENT_USER/Software/TestGame'], ctx: {} }
      const c = (p: string) => snap.covers(set, path.join(A, p))
      out.covers = [c('TestGame/a.sav'), c('TestGame/deep/b.sav'), c('Glob/x.sav'), c('Emu/123/s.bin'), !c('TestGame2/a.sav'), !c('Glob/x.txt'), !c('Glob/sub/x.sav'), !c('Microsoft/Windows/Start Menu/Programs/Startup/a.txt'), !c('Emu/1234/s.bin'), !c('TestGame/../Other/a.sav')]
      const k = snap.safeRegistryKey
      out.regKeys = [
        k('HKEY_CURRENT_USER/Software/TestGame'),
        k('HKEY_CURRENT_USER/Software/Microsoft/Microsoft Games/Halo'),
        !k('HKEY_CURRENT_USER/Software/Microsoft/Windows/CurrentVersion/Run'),
        !k('HKEY_CURRENT_USER/Software/Microsoft'),
        !k('HKEY_CURRENT_USER/Software'),
        !k('HKEY_CURRENT_USER/Software/Classes/exefile'),
        !k('HKEY_CURRENT_USER/Environment'),
        !k('HKEY_LOCAL_MACHINE/Software/TestGame')
      ]
      const keys = ['HKEY_CURRENT_USER/Software/TestGame']
      const r = (b: Buffer) => snap.regFileAllowed(b, keys)
      const two = Buffer.concat([reg('HKEY_CURRENT_USER\\Software\\TestGame\\Sub'), Buffer.from('[HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run]\r\n"a"="calc"\r\n', 'utf16le')])
      out.regFiles = [
        r(reg('HKEY_CURRENT_USER\\Software\\TestGame')),
        r(reg('HKEY_CURRENT_USER\\Software\\TestGame\\Slots')),
        !r(reg('HKEY_CURRENT_USER\\Software\\TestGameX')),
        !r(reg('HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run')),
        !r(reg('-HKEY_CURRENT_USER\\Software\\TestGame')),
        !r(two),
        !r(Buffer.from('REGEDIT4\r\n[HKEY_CURRENT_USER\\Software\\TestGame]\r\n')),
        !snap.regFileAllowed(reg('HKEY_CURRENT_USER\\Software\\TestGame'), [])
      ]
      // Zip-бомба: 8 МБ нулей в паре килобайт — распаковка обрывается на лимите
      const bombState = { files: [{ name: '%APPDATA%/TestGame/big.sav', abs: path.join(dev, 'big.bin'), size: 8 << 20, mtime: 1 }], registry: [], hash: 'x', size: 8 << 20, at: 1 }
      fs.mkdirSync(dev, { recursive: true })
      fs.writeFileSync(bombState.files[0].abs, Buffer.alloc(8 << 20))
      const bomb = (await snap.pack(bombState)).data
      let bombErr = false
      try {
        readZipBuffer(bomb, { files: 10, bytes: 1 << 20 })
      } catch {
        bombErr = true
      }
      out.bomb = [bomb.length < 100_000, bombErr, readZipBuffer(bomb, { files: 10, bytes: 16 << 20 }).size === 2, zlib.inflateRawSync(zlib.deflateRawSync(Buffer.alloc(10))).length === 10]
      out.urls = [
        !!webUrl('https://cdn.cloudflare.steamstatic.com/steam/apps/1/header.jpg'),
        !webUrl('file:///C:/Windows/win.ini'),
        !webUrl('http://localhost:8080/x.png'),
        !webUrl('http://127.0.0.1/x.png'),
        !webUrl('http://192.168.1.1/x.png'),
        !webUrl('http://[::1]/x.png'),
        !webUrl('https://user:pw@example.com/x.png'),
        !webUrl('http://2130706433/x.png')
      ]
      // Библиотека и профиль, собранные самим PlayOS, проходят проверку без единого изменения (иначе два ПК перезаписывали бы файл по кругу)
      const games = [
        { id: 'a', title: 'Alpha', platform: 'pc', path: 'C:\\g\\a.exe', addedAt: 5, updatedAt: 9, lastPlayed: 8, playtime: 30, playtimeBy: { ab12cd34: 30 }, sessions: [{ start: 7, duration: 30 }], args: '-windowed', favorite: true, accent: '#aabbcc', accentV: 3, steamAppId: 620, done: { at: 8, full: true, mood: 'love', playtime: 30, days: 2 }, pile: { main: 1.5 }, artSrc: { hero: 'https://example.com/h.jpg', cover: 'https://example.com/c.jpg' } },
        { id: 'b', title: 'Beta', platform: 'ps2', serial: 'SLUS-20312', path: '', addedAt: 1, playtime: 0, sessions: [], raGameId: 77 }
      ] as never[]
      const lib = JSON.stringify(mergeLibrary(games, [{ key: 'pc:t:gone', at: 3 }], null).cloud)
      const st = { userName: 'Alice', sounds: true, volume: 'mid', glyphs: 'auto', language: 'en', theme: 'dark', padMaps: { 'pad-1': { confirm: { b: 0 }, scroll: { a: 1, d: 1 } } }, builds: [{ id: 'main', name: 'Main' }], figuresSeen: ['finisher'], screensaver: 5, futureKey: { any: [1, 2] }, uiScale: 1.5, trophies: { first: 4 } }
      const prof = JSON.stringify(mergeProfile(st as never, 10, null).cloud)
      out.roundtrip = [JSON.stringify(cleanLibrary(JSON.parse(lib))) === lib, JSON.stringify(cleanProfile(JSON.parse(prof))) === prof, lib.includes('"hero"') && lib.indexOf('"hero"') < lib.indexOf('"cover"')]
      const evilLib = cleanLibrary({
        games: [
          { key: 'k1', title: 'X', platform: 'ps9' },
          { key: 'k2', title: 'Y', platform: 'pc', sessions: 'boom', playtimeBy: [1], art: { cover: 'file:///c:/x.png', hero: 'https://ok.example.com/h.jpg', evil: 'https://a.example.com' }, updatedAt: 9e15, launcher: 'cmd', args: 5, done: { at: 'x' }, pile: { a: 'b', c: 2 } },
          'junk',
          { key: 'k3', title: 'Z'.repeat(5000), platform: 'pc' }
        ],
        deleted: [{ key: 'pc:t:alpha', at: 9e15 }, { key: 'ok', at: 5 }, 7]
      })
      const y = evilLib.games[0]
      out.evilLib = [evilLib.games.length === 1, y.key === 'k2', y.sessions.length === 0, Object.keys(y.playtimeBy).length === 0, JSON.stringify(y.art) === '{"hero":"https://ok.example.com/h.jpg"}', y.updatedAt < Date.now() + 2 * 86_400_000, y.launcher === undefined, y.args === undefined, y.done === undefined, JSON.stringify(y.pile) === '{"c":2}', evilLib.deleted.length === 1]
      const evilProf = cleanProfile({ updatedAt: 9e15, device: 5, avatar: '../../../Start Menu/Programs/Startup/x.bat', trophies: { a: 'x', b: 9e15, c: 3 }, settings: { userName: 'M', language: 5, padMaps: 'x', theme: 'neon', builds: [{ id: 1 }, { id: 'ok', name: 'Ok' }], sounds: 'yes', newThing: 1, __proto__: { polluted: true } } })
      out.evilProf = [evilProf.avatar === undefined, evilProf.device === '', evilProf.updatedAt < Date.now() + 2 * 86_400_000, JSON.stringify(Object.keys(evilProf.settings)) === '["userName","builds","newThing"]', (evilProf.settings.builds ?? []).length === 1, Object.keys(evilProf.trophies).join() === 'b,c', ({} as { polluted?: boolean }).polluted === undefined]
      // Параметры запуска — свои у каждого ПК: более свежая запись из облака их не меняет, и в облако они не уходят
      const mine = [{ id: 'm', title: 'Alpha', platform: 'pc', path: 'C:\\g\\a.exe', addedAt: 1, updatedAt: 2, playtime: 0, sessions: [], args: '-local', trackProcess: 'a.exe' }] as never[]
      const theirs = cleanLibrary({ games: [{ key: 'pc:t:alpha', title: 'Alpha 2', platform: 'pc', addedAt: 1, updatedAt: 50, playtimeBase: 0, playtimeBy: {}, sessions: [], art: {}, args: '--gpu-launcher=calc.exe', trackProcess: 'explorer.exe' }], deleted: [] })
      const merged = mergeLibrary(mine, [], theirs)
      const mg = merged.games[0] as { title: string; args?: string; trackProcess?: string }
      out.args = [mg.title === 'Alpha 2', mg.args === '-local', mg.trackProcess === 'a.exe', !/args|trackProcess/.test(JSON.stringify(merged.cloud)), !/args|trackProcess/.test(JSON.stringify(theirs))]
      let threw = 0
      for (const bad of [null, [], 'x', { games: 5 }]) {
        try {
          cleanLibrary(bad)
        } catch {
          threw++
        }
      }
      out.badShape = threw === 4
    } else {
      fs.mkdirSync(path.join(ROOT, 'cloud'), { recursive: true })
      if (!account.remote()) await account.signInFolder(path.join(ROOT, 'cloud'))
      sync.initSync({
        games: () => [game],
        settings: () => settings,
        runningGame: () => undefined,
        onChange: () => {},
        hooks: { applySettings: () => {}, changed: () => {}, locate: async () => {}, fillArt: async () => {} },
        setCloudSettings: () => {}
      })
      const [action, value] = STEP.split(':')
      if (action === 'write') {
        fs.mkdirSync(saveDir, { recursive: true })
        fs.writeFileSync(saveFile, value)
      }
      const cloudDir = path.join(ROOT, 'cloud', 'PlayOS')
      const A = process.env.APPDATA!
      // Что атакующий пытается записать: имя в архиве → файл на диске, которого появиться не должно
      const attacks: Record<string, { name: string; target?: string; data?: Buffer }> = {
        startup: { name: '%APPDATA%/Microsoft/Windows/Start Menu/Programs/Startup/evil.txt', target: path.join(A, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'evil.txt') },
        home: { name: '%HOME%/playos-security-test-should-not-exist.txt', target: path.join(app.getPath('home'), 'playos-security-test-should-not-exist.txt') },
        dll: { name: '%APPDATA%/TestGame/Saves/version.dll', target: path.join(saveDir, 'version.dll') },
        traversal: { name: '%APPDATA%/TestGame/../Evil/a.sav', target: path.join(A, 'Evil', 'a.sav') },
        stream: { name: '%APPDATA%/TestGame/Saves/slot1.sav:hidden', target: path.join(saveDir, 'slot1.sav:hidden') },
        registry: { name: '%REG%/0-run.reg', data: reg('HKEY_CURRENT_USER\\Software\\PlayOSSecurityTest') },
        good: { name: '%APPDATA%/TestGame/Saves/slot1.sav', data: Buffer.from('from-cloud') }
      }
      if (action === 'evil') {
        const atk = attacks[value]
        const src = path.join(dev, 'payload.bin')
        fs.writeFileSync(src, atk.data ?? Buffer.from('payload'))
        const isReg = atk.name.startsWith('%REG%')
        // Снимок собран настоящим упаковщиком: хэш в имени верный, проверка целости его пропускает
        const packed = await snap.pack({
          files: [{ name: '%APPDATA%/TestGame/Saves/slot1.sav', abs: saveFile, size: 1, mtime: 1 }, ...(isReg || value === 'good' ? [] : [{ name: atk.name, abs: src, size: 1, mtime: 1 }])].map((f) => (value === 'good' ? { ...f, abs: src } : f)),
          registry: isReg ? [{ name: atk.name, data: atk.data! }] : [],
          hash: 'x',
          size: 1,
          at: 1
        })
        const folder = fs.readdirSync(path.join(cloudDir, 'saves'))[0]
        const id = '11111111-2222-4333-8444-555555555555'
        const name = `${Date.now() + 60_000 + Number(process.env.T_N ?? 0) * 1000}_11111111_${packed.hash}.zip`
        fs.writeFileSync(path.join(cloudDir, 'saves', folder, name), packed.data)
        fs.writeFileSync(path.join(cloudDir, 'devices', `${id}.json`), JSON.stringify({ id, name: { evil: true }, seen: 'x', version: 1, heads: { [folder]: name, '../escape': name, other: '../../x.zip' } }))
        await sync.syncAll()
        out.planted = atk.target ? fs.existsSync(atk.target) : null
      } else await sync.syncAll()
      const st = sync.gameStatus(game)
      out.state = st.state
      if (st.error) out.reason = st.error
      out.file = fs.existsSync(saveFile) ? fs.readFileSync(saveFile, 'utf8') : null
    }
  } catch (e) {
    out.error = (e as Error).stack
  }
  console.log('RESULT ' + JSON.stringify(out))
  app.exit(0)
})
