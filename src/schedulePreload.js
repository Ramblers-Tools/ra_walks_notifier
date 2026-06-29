const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('scheduleSettings', {
  load: () => ipcRenderer.invoke('schedule:load'),
  save: (settings) => ipcRenderer.invoke('schedule:save', settings)
});
