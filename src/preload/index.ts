import { contextBridge, ipcRenderer } from 'electron'
import type { PcsApi } from '@shared/types'

const listen =
  <T>(channel: string) =>
  (cb: (payload: T) => void) => {
    const handler = (_e: unknown, payload: T) => cb(payload)
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  }

const api: PcsApi = {
  getState: () => ipcRenderer.invoke('state:get'),
  saveGame: (draft) => ipcRenderer.invoke('game:save', draft),
  deleteGame: (id) => ipcRenderer.invoke('game:delete', id),
  setFavorite: (id, value) => ipcRenderer.invoke('game:favorite', id, value),
  resetPlaytime: (id) => ipcRenderer.invoke('game:resetPlaytime', id),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  launch: (id, opts) => ipcRenderer.invoke('game:launch', id, opts),
  closeGame: () => ipcRenderer.invoke('game:close'),
  resumeGame: () => ipcRenderer.invoke('game:resume'),
  hideOverlay: () => ipcRenderer.invoke('overlay:home'),
  pickFile: (kind) => ipcRenderer.invoke('dialog:pick', kind),
  inspect: (platform, path) => ipcRenderer.invoke('game:inspect', platform, path),
  searchArt: (query, platform, serial, source) => ipcRenderer.invoke('art:search', query, platform, serial, source),
  scanPs2Folder: () => ipcRenderer.invoke('scan:ps2'),
  importRpcs3: () => ipcRenderer.invoke('scan:rpcs3'),
  openFolder: (path) => ipcRenderer.invoke('shell:openFolder', path),
  power: (action) => ipcRenderer.invoke('power', action),
  onState: listen('state'),
  onPad: listen('pad'),
  onOverlay: listen('overlay'),
  onSessionEnd: listen('session-end'),
  onToast: listen('toast'),
  onPadStatus: listen('pad-status'),
  onPadBlock: listen('pad-block'),
  onWindowMode: listen('window-mode'),
  getPadStatus: () => ipcRenderer.invoke('pad:status'),
  emuState: () => ipcRenderer.invoke('emu:state'),
  saveState: (slot) => ipcRenderer.invoke('emu:save', slot),
  loadState: (slot) => ipcRenderer.invoke('emu:load', slot),
  overlayHome: () => ipcRenderer.invoke('overlay:home'),
  pcsx2Info: () => ipcRenderer.invoke('pcsx2:info'),
  enablePine: () => ipcRenderer.invoke('pcsx2:enablePine'),
  systemState: (withBrightness) => ipcRenderer.invoke('sys:state', withBrightness),
  setVolume: (v) => ipcRenderer.invoke('sys:volume', v),
  setMute: (m) => ipcRenderer.invoke('sys:mute', m),
  setAudioDevice: (id) => ipcRenderer.invoke('sys:device', id),
  setBrightness: (v) => ipcRenderer.invoke('sys:brightness', v),
  controllers: () => ipcRenderer.invoke('sys:controllers'),
  achievements: (gameId, refresh) => ipcRenderer.invoke('ach:get', gameId, refresh),
  achievementSummary: () => ipcRenderer.invoke('ach:summary'),
  findRaGames: (q) => ipcRenderer.invoke('ach:findRa', q),
  linkRaGame: (gameId, raId) => ipcRenderer.invoke('ach:linkRa', gameId, raId),
  testTrophyAccounts: () => ipcRenderer.invoke('ach:test'),
  onAchievements: listen('ach-new'),
  onAchievementSummary: listen('ach-summary'),
  onOverlayToast: listen('overlay-toast'),
  cancelSave: () => ipcRenderer.invoke('game:cancelSave'),
  onSaveProgress: listen('save-progress'),
  displays: () => ipcRenderer.invoke('sys:displays'),
  saveReport: () => ipcRenderer.invoke('log:report'),
  exportData: () => ipcRenderer.invoke('data:export'),
  inspectBackup: (file) => ipcRenderer.invoke('data:inspect', file),
  importData: (file) => ipcRenderer.invoke('data:import', file),
  systemInfo: () => ipcRenderer.invoke('sys:info'),
  pathExists: (p) => ipcRenderer.invoke('fs:exists', p),
  updateState: () => ipcRenderer.invoke('update:state'),
  checkUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateState: listen('update-state'),
  onOutro: listen('outro'),
  onPowerResume: listen('power-resume'),
  onOverlayNotice: listen('overlay-notice'),
  gameDetails: (gameId, refresh) => ipcRenderer.invoke('details:get', gameId, refresh),
  gameFiles: (gameId) => ipcRenderer.invoke('game:files', gameId),
  savePreview: (draft) => ipcRenderer.invoke('game:save-preview', draft),
  cloudStatus: () => ipcRenderer.invoke('cloud:status'),
  onCloudStatus: listen('cloud-status'),
  cloudSignIn: (provider, folder) => ipcRenderer.invoke('cloud:signIn', provider, folder),
  cloudCancelSignIn: () => ipcRenderer.invoke('cloud:cancelSignIn'),
  cloudSignOut: () => ipcRenderer.invoke('cloud:signOut'),
  cloudSyncNow: () => ipcRenderer.invoke('cloud:syncNow'),
  gameCloud: (gameId) => ipcRenderer.invoke('cloud:game', gameId),
  cloudResolve: (gameId, choice) => ipcRenderer.invoke('cloud:resolve', gameId, choice),
  cloudVersions: (gameId) => ipcRenderer.invoke('cloud:versions', gameId),
  cloudRestore: (gameId, name) => ipcRenderer.invoke('cloud:restore', gameId, name),
  cloudRestoreChoice: (choice) => ipcRenderer.invoke('cloud:restoreChoice', choice),
  liveBackground: (gameId) => ipcRenderer.invoke('live:get', gameId),
  scanSteam: () => ipcRenderer.invoke('steam:scan'),
  importSteam: (appIds) => ipcRenderer.invoke('steam:import', appIds),
  onImportProgress: listen('import-progress'),
  vrStatus: () => ipcRenderer.invoke('vr:status'),
  vrQuest: () => ipcRenderer.invoke('vr:quest'),
  onVrQuest: listen('vr-quest'),
  vrInstallOc: () => ipcRenderer.invoke('vr:installOc'),
  vrCheckOc: () => ipcRenderer.invoke('vr:checkOc'),
  onVrProgress: listen('vr-progress')
}

contextBridge.exposeInMainWorld('pcs', api)
// Язык нужен до загрузки интерфейса — иначе тексты в константах модулей останутся на старом языке
contextBridge.exposeInMainWorld('pcsLang', ipcRenderer.sendSync('lang:get'))
// Тема — тоже до первой отрисовки, чтобы светлая не мигала тёмной
contextBridge.exposeInMainWorld('pcsTheme', ipcRenderer.sendSync('theme:get'))
