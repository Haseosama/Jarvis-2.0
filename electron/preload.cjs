const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvisHost', {
  isElectron: true,
  storageGet: (key) => ipcRenderer.invoke('jarvis:storage-get', key),
  storageSet: (key, value) => ipcRenderer.invoke('jarvis:storage-set', key, value),
  secretGet: (slot) => ipcRenderer.invoke('jarvis:secret-get', slot),
  secretSet: (slot, value) => ipcRenderer.invoke('jarvis:secret-set', slot, value),
  openExternal: (url) => ipcRenderer.invoke('jarvis:open-external', url),
  openArena: (url) => ipcRenderer.invoke('jarvis:open-arena', url),
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
  spotifyAuthorize: (payload) => ipcRenderer.invoke('jarvis:spotify-authorize', payload),
  googleAuthorize: (payload) => ipcRenderer.invoke('jarvis:google-authorize', payload),
  skillRun: (payload) => ipcRenderer.invoke('jarvis:skill-run', payload),
  browser: (payload) => ipcRenderer.invoke('jarvis:browser', payload),
  imageGenStatus: () => ipcRenderer.invoke('jarvis:imagegen-status'),
  imageGenInstall: () => ipcRenderer.invoke('jarvis:imagegen-install'),
  imageGenRun: (payload) => ipcRenderer.invoke('jarvis:imagegen-run', payload),
  remoteStatus: () => ipcRenderer.invoke('jarvis:remote-status'),
  remoteEnable: (enabled) => ipcRenderer.invoke('jarvis:remote-enable', enabled),
  remoteNewKey: () => ipcRenderer.invoke('jarvis:remote-new-key'),
  remoteRevoke: () => ipcRenderer.invoke('jarvis:remote-revoke'),
  remoteMode: (mode) => ipcRenderer.invoke('jarvis:remote-mode', mode),
  remoteSay: (msg) => ipcRenderer.send('jarvis:remote-say', msg),
  onRemoteCommand: (cb) => {
    const handler = (_e, text) => cb(text);
    ipcRenderer.on('jarvis:remote-command', handler);
    return () => ipcRenderer.removeListener('jarvis:remote-command', handler);
  },
  onRemoteEvent: (cb) => {
    const handler = (_e, event) => cb(event);
    ipcRenderer.on('jarvis:remote-event', handler);
    return () => ipcRenderer.removeListener('jarvis:remote-event', handler);
  },
  onHotkeyPtt: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('jarvis:hotkey-ptt', handler);
    return () => ipcRenderer.removeListener('jarvis:hotkey-ptt', handler);
  },
});
