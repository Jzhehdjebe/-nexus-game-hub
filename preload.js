const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('nexus', {
  loadLibrary:      ()       => ipcRenderer.invoke('load-library'),
  saveLibrary:      (data)   => ipcRenderer.invoke('save-library', data),
  launchGame:       (path)   => ipcRenderer.invoke('launch-game', path),
  browseExe:        ()       => ipcRenderer.invoke('browse-exe'),
  browseImage:      ()       => ipcRenderer.invoke('browse-image'),
  minimize:         ()       => ipcRenderer.invoke('window-minimize'),
  close:            ()       => ipcRenderer.invoke('window-close'),
  toggleFullscreen: ()       => ipcRenderer.invoke('toggle-fullscreen'),
});