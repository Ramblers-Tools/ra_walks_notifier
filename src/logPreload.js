const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('logs', {
  load: () => ipcRenderer.invoke('logs:load')
});
