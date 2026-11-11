import { ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { CloudProviderId, CloudRestoreChoice, Game, Settings } from '@shared/types'
import * as launcher from '../launcher'
import { scanSteam } from '../steam'
import { findGame, getDb, saveDb, setDevice } from '../store'
import * as account from './account'
import * as sync from './sync'

/** Что облаку нужно от главного модуля: отправка в окна, применение настроек с их побочными эффектами и арт для игр из облака */
export interface CloudDeps {
  send: (channel: string, payload?: unknown) => void
  broadcast: () => void
  applySettings: (prev: Settings, next: Settings) => void
  fillArt: (game: Game) => Promise<void>
}

/**
 * Игры из облака приходят без файлов: ищем, где они установлены на этом ПК.
 * Steam — по AppID в библиотеках Steam, PS3 — по ID игры в dev_hdd0 RPCS3. Остальным путь укажет пользователь.
 */
async function locateCloudGames(games: Game[]) {
  const steamGames = games.filter((g) => g.launcher === 'steam' && g.steamAppId)
  if (steamGames.length) {
    const installed = await scanSteam(getDb().games).catch(() => [])
    for (const g of steamGames) {
      const hit = installed.find((s) => s.appId === g.steamAppId)
      if (hit) g.path = hit.dir
    }
  }
  const { rpcs3Path } = getDb().settings
  if (rpcs3Path) {
    for (const g of games.filter((x) => x.platform === 'ps3' && x.serial)) {
      const eboot = path.join(path.dirname(rpcs3Path), 'dev_hdd0', 'game', g.serial!, 'USRDIR', 'EBOOT.BIN')
      if (fs.existsSync(eboot)) g.path = eboot
    }
  }
}

/** Обработчики cloud:* и запуск синхронизации */
export function registerCloud(deps: CloudDeps) {
  const cloudChanged = () => deps.send('cloud-status', sync.status())
  ipcMain.handle('cloud:status', () => sync.status())
  ipcMain.handle('cloud:signIn', async (_e, provider: CloudProviderId, folder?: string) => {
    const before = account.cachedAccount()
    if (provider === 'folder' && folder) await account.signInFolder(folder)
    else if (provider !== 'folder') await account.signInDevice(provider, () => {
      const now = account.cachedAccount()
      // «Войти снова» в другой аккаунт: базы и головы прошлого к нему не относятся
      if (before && now && (now.provider !== before.provider || now.name !== before.name)) sync.forget()
      cloudChanged()
      if (account.remote()) sync.kick()
    })
    if (provider === 'folder') sync.kick()
    cloudChanged()
    return sync.status()
  })
  ipcMain.handle('cloud:cancelSignIn', () => {
    account.cancelSignIn()
    cloudChanged()
  })
  ipcMain.handle('cloud:restoreChoice', (_e, choice: CloudRestoreChoice | null) => sync.restoreChoice(choice))
  ipcMain.handle('cloud:signOut', () => {
    account.signOut()
    sync.forget()
    cloudChanged()
  })
  ipcMain.handle('cloud:pending', () => sync.pending())
  ipcMain.handle('cloud:flush', () => sync.flush())
  ipcMain.handle('cloud:syncNow', async () => {
    await sync.syncNow()
    await account.refreshAccount().catch(() => null)
    cloudChanged()
    return sync.status()
  })
  ipcMain.handle('cloud:game', (_e, id: string) => {
    const game = findGame(id)
    return game ? sync.gameStatus(game) : { state: 'off' }
  })
  ipcMain.handle('cloud:resolve', async (_e, id: string, choice: 'local' | 'cloud') => {
    const game = findGame(id)
    if (game) await sync.resolve(game, choice)
  })
  ipcMain.handle('cloud:versions', (_e, id: string) => {
    const game = findGame(id)
    return game ? sync.versions(game) : []
  })
  ipcMain.handle('cloud:restore', async (_e, id: string, name: string) => {
    const game = findGame(id)
    if (game) await sync.restoreVersion(game, name)
  })
  sync.initSync({
    games: () => getDb().games,
    settings: () => getDb().settings,
    runningGame: () => {
      const run = launcher.running()
      return run ? findGame(run.gameId) : undefined
    },
    onChange: cloudChanged,
    hooks: {
      // Настройки из облака: те же побочные эффекты, что и при смене в интерфейсе (язык, тема, экран)
      applySettings: (patch) => {
        const db = getDb()
        const prev = db.settings
        db.settings = { ...prev, ...patch }
        deps.applySettings(prev, db.settings)
      },
      changed: deps.broadcast,
      locate: locateCloudGames,
      fillArt: deps.fillArt
    },
    setCloudSettings: (patch, resetSettingsAt) => {
      const db = getDb()
      db.settings = { ...db.settings, cloud: { saves: true, keepVersions: 5, ...db.settings.cloud, ...patch } }
      // «Профиль» при восстановлении — облако главнее настроек свежей установки
      if (resetSettingsAt) db.settingsAt = 0
      saveDb()
      deps.broadcast()
    }
  })
  setDevice(account.deviceId().replace(/-/g, '').slice(0, 8))
}
