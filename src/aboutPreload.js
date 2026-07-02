const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('about', {
  load: () => ipcRenderer.invoke('about:load'),
  openWebsite: () => ipcRenderer.invoke('about:open-website')
});
