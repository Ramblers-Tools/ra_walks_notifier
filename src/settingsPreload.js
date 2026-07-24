const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appSettings', {
  load: () => ipcRenderer.invoke('app:settings-load'),
  toggleBetaUpdates: () => ipcRenderer.invoke('app:toggle-beta-updates'),
  checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('app:install-update'),
  openLogs: () => ipcRenderer.invoke('app:open-logs'),
  resetSettings: () => ipcRenderer.invoke('app:reset-settings')
});
