const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('credentialsUpgrade', {
  status: () => ipcRenderer.invoke('credentials:status'),
  save: (credentials) => ipcRenderer.invoke('credentials:save', credentials)
});
