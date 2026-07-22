const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('connect', {
  status: () => ipcRenderer.invoke('connect:status'),
  saveApiKey: (apiKey) => ipcRenderer.invoke('connect:save-api-key', apiKey),
  login: (credentials) => ipcRenderer.invoke('connect:login', credentials),
  saveGroups: (groups) => ipcRenderer.invoke('connect:save-groups', groups),
  redetectGroups: () => ipcRenderer.invoke('connect:redetect-groups')
});

contextBridge.exposeInMainWorld('credentials', {
  status: () => ipcRenderer.invoke('credentials:status'),
  save: (credentials) => ipcRenderer.invoke('credentials:save', credentials)
});

contextBridge.exposeInMainWorld('recipients', {
  load: () => ipcRenderer.invoke('recipients:load'),
  save: (text) => ipcRenderer.invoke('recipients:save', text)
});

contextBridge.exposeInMainWorld('scheduleSettings', {
  load: () => ipcRenderer.invoke('schedule:load'),
  save: (settings) => ipcRenderer.invoke('schedule:save', settings)
});

contextBridge.exposeInMainWorld('leaderEmailSettings', {
  load: () => ipcRenderer.invoke('leader-email:load'),
  save: (settings) => ipcRenderer.invoke('leader-email:save', settings),
  testApi: (settings) => ipcRenderer.invoke('leader-email:test-api', settings)
});

contextBridge.exposeInMainWorld('statusApi', {
  load: () => ipcRenderer.invoke('status:load'),
  retry: () => ipcRenderer.invoke('status:retry'),
  checkNow: (force) => ipcRenderer.invoke('app:check-now', force),
  openReviewList: () => ipcRenderer.invoke('app:open-review-list')
});

contextBridge.exposeInMainWorld('logs', {
  load: () => ipcRenderer.invoke('logs:load')
});

contextBridge.exposeInMainWorld('about', {
  load: () => ipcRenderer.invoke('about:load'),
  openWebsite: () => ipcRenderer.invoke('about:open-website')
});

contextBridge.exposeInMainWorld('appSettings', {
  load: () => ipcRenderer.invoke('app:settings-load'),
  toggleStartAtBoot: () => ipcRenderer.invoke('app:toggle-start-at-boot'),
  toggleBetaUpdates: () => ipcRenderer.invoke('app:toggle-beta-updates'),
  checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
  chooseLogo: () => ipcRenderer.invoke('app:choose-logo'),
  resetLogo: () => ipcRenderer.invoke('app:reset-logo')
});
