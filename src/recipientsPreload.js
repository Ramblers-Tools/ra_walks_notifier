const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('recipients', {
  load: () => ipcRenderer.invoke('recipients:load'),
  save: (text) => ipcRenderer.invoke('recipients:save', text)
});
