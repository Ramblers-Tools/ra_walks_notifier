const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('statusApi', {
  load: () => ipcRenderer.invoke('status:load'),
  openLogFile: () => ipcRenderer.invoke('status:open-log')
});
