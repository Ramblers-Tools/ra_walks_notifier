const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('setup', {
  load: () => ipcRenderer.invoke('setup:load'),
  save: (settings) => ipcRenderer.invoke('setup:save', settings),
  chooseLogo: () => ipcRenderer.invoke('setup:choose-logo'),
  login: () => ipcRenderer.invoke('setup:login'),
  loginWithCredentials: (credentials) => ipcRenderer.invoke('setup:login-with-credentials', credentials),
  testEmail: () => ipcRenderer.invoke('setup:test-email')
});
