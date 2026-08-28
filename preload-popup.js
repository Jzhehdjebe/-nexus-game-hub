const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('popup', {
  openNexus:  () => ipcRenderer.invoke('open-nexus'),
  closePopup: () => ipcRenderer.invoke('close-popup'),
  resetTimer: () => ipcRenderer.invoke('reset-timer'),
});