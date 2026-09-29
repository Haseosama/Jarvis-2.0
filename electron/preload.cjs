const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvisHost', {
  isElectron: true,
  storageGet: (key) => ipcRenderer.invoke('jarvis:storage-get', key),
  storageSet: (key, value) => ipcRenderer.invoke('jarvis:storage-set', key, value),
  secretGet: (slot) => ipcRenderer.invoke('jarvis:secret-get', slot),
  secretSet: (slot, value) => ipcRenderer.invoke('jarvis:secret-set', slot, value),
  openExternal: (url) => ipcRenderer.invoke('jarvis:open-external', url),
  notify: (title, body) => ipcRenderer.invoke('jarvis:notify', title, body),
  clipboardRead: () => ipcRenderer.invoke('jarvis:clipboard-read'),
  clipboardWrite: (text) => ipcRenderer.invoke('jarvis:clipboard-write', text),
  captureScreen: (maxDim) => ipcRenderer.invoke('jarvis:capture-screen', maxDim),
  getSystemInfo: () => ipcRenderer.invoke('jarvis:system-info'),
  openApp: (appName) => ipcRenderer.invoke('jarvis:open-app', appName),
  deviceSettings: (payload) => ipcRenderer.invoke('jarvis:device-settings', payload),
  computerControl: (payload) => ipcRenderer.invoke('jarvis:computer-control', payload),
  pickFolder: (title) => ipcRenderer.invoke('jarvis:pick-folder', title),
  fileManager: (payload) => ipcRenderer.invoke('jarvis:file-manager', payload),
  saveDocument: (payload) => ipcRenderer.invoke('jarvis:save-document', payload),
  httpFetch: (payload) => ipcRenderer.invoke('jarvis:http-fetch', payload),
  onHotkeyPtt: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('jarvis:hotkey-ptt', handler);
    return () => ipcRenderer.removeListener('jarvis:hotkey-ptt', handler);
  },
});
