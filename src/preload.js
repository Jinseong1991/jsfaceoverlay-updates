'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('get-state'),
  setSettings: (patch) => ipcRenderer.invoke('set-settings', patch),
  refresh: () => ipcRenderer.invoke('refresh'),
  openSettings: () => ipcRenderer.invoke('open-settings'),
  hideOverlay: () => ipcRenderer.invoke('hide-overlay'),
  closeSettings: () => ipcRenderer.invoke('close-settings'),
  minimizeSettings: () => ipcRenderer.invoke('minimize-settings'),
  quit: () => ipcRenderer.invoke('quit'),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  openBluetoothSettings: () => ipcRenderer.invoke('open-bluetooth-settings'),
  copyDiagnostics: () => ipcRenderer.invoke('copy-diagnostics'),
  overlayResize: (h) => ipcRenderer.invoke('overlay-resize', h),
  onState: (cb) => {
    const handler = (_e, state) => cb(state);
    ipcRenderer.on('state', handler);
    return () => ipcRenderer.removeListener('state', handler);
  },
});
