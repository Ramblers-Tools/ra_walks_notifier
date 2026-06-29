const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('setup', {
  load: () => ipcRenderer.invoke('setup:load'),
  save: (settings) => ipcRenderer.invoke('setup:save', settings),
  chooseLogo: () => ipcRenderer.invoke('setup:choose-logo'),
  login: () => ipcRenderer.invoke('setup:login'),
  testEmail: () => ipcRenderer.invoke('setup:test-email')
});
