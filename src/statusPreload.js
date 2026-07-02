const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('statusApi', {
  load: () => ipcRenderer.invoke('status:load'),
  retry: () => ipcRenderer.invoke('status:retry'),
  openLogFile: () => ipcRenderer.invoke('status:open-log')
});
