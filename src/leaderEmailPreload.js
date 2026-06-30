const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('leaderEmailSettings', {
  load: () => ipcRenderer.invoke('leader-email:load'),
  save: (settings) => ipcRenderer.invoke('leader-email:save', settings)
});
