const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appSettings', {
  load: () => ipcRenderer.invoke('app:settings-load'),
  toggleBetaUpdates: () => ipcRenderer.invoke('app:toggle-beta-updates'),
  checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
  openLogs: () => ipcRenderer.invoke('app:open-logs'),
  openDevTools: () => ipcRenderer.invoke('app:open-devtools'),
  resetSettings: () => ipcRenderer.invoke('app:reset-settings')
});
