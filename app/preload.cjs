const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('snapOverLAN', Object.freeze({
  getServerState: () => ipcRenderer.invoke('server:get-state'),
  startServer: () => ipcRenderer.invoke('server:start'),
  stopServer: () => ipcRenderer.invoke('server:stop'),
  getBackgroundMode: () => ipcRenderer.invoke('background:get'),
  setBackgroundMode: (enabled) => ipcRenderer.invoke('background:set', Boolean(enabled)),
}));
