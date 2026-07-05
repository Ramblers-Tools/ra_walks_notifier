const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('connect', {
  status: () => ipcRenderer.invoke('connect:status'),
  saveApiKey: (apiKey) => ipcRenderer.invoke('connect:save-api-key', apiKey),
  login: (credentials) => ipcRenderer.invoke('connect:login', credentials),
  saveGroups: (groups) => ipcRenderer.invoke('connect:save-groups', groups),
  redetectGroups: () => ipcRenderer.invoke('connect:redetect-groups'),
  loadRecipients: () => ipcRenderer.invoke('recipients:load'),
  saveRecipients: (text) => ipcRenderer.invoke('recipients:save', text)
});
