const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  clipboard,
  dialog,
  desktopCapturer,
  globalShortcut,
  safeStorage,
  Notification,
  session,
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { exec, execFile } = require('child_process');

let mainWindow = null;
let localAssetServer = null;
let spotifyAuthServer = null;
let spotifyAuthTimer = null;
let googleAuthServer = null;
let googleAuthTimer = null;
let remoteServer = null;
let browserControl = null;
let imageGen = null;
let remoteCollect = null;

const MIME_MAP = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bin': 'application/octet-stream',
};

function startEmbeddedAssetServer() {
  return new Promise((resolve) => {
    if (localAssetServer) {
      const addr = localAssetServer.address();
      if (addr && addr.port) return resolve(`http://127.0.0.1:${addr.port}`);
    }
    const distRoot = path.join(__dirname, '../dist');
    const server = http.createServer((req, res) => {
      try {
        if ((req.url || '').startsWith('/__jarvis_proxy__')) {
          let rawBody = '';
          req.on('data', (chunk) => {
            rawBody += chunk;
          });
          req.on('end', async () => {
            try {
              const payload = rawBody ? JSON.parse(rawBody) : {};
              const { url, method = 'GET', headers = {}, body = null, timeoutMs = 15000 } = payload;
              const controller = new AbortController();
              const timer = setTimeout(() => controller.abort(), timeoutMs);
              try {
                const upstream = await fetch(url, {
                  method,
                  headers: { 'User-Agent': 'Jarvis-PC/2.0', ...headers },
                  body: method !== 'GET' && method !== 'HEAD' ? body : undefined,
                  signal: controller.signal,
                });
                const text = await upstream.text();
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ ok: upstream.ok, status: upstream.status, text }));
              } finally {
                clearTimeout(timer);
              }
            } catch (err) {
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ ok: false, status: 0, error: String(err), text: '' }));
            }
          });
          return;
        }
        const rawUrl = decodeURIComponent((req.url || '/').split('?')[0]);
        const relPath = rawUrl === '/' ? 'index.html' : rawUrl.replace(/^\/+/, '');
        const filePath = path.join(distRoot, relPath);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const ext = path.extname(filePath).toLowerCase();
          const data = fs.readFileSync(filePath);
          res.writeHead(200, {
            'Content-Type': MIME_MAP[ext] || 'application/octet-stream',
            'Cache-Control': 'no-cache',
          });
          res.end(data);
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      } catch (e) {
        res.writeHead(500);
        res.end(String(e));
      }
    });
    server.on('error', () => {
      server.listen(0, '127.0.0.1', () => {
        localAssetServer = server;
        const addr = server.address();
        resolve(`http://127.0.0.1:${addr.port}`);
      });
    });
    server.listen(17531, '127.0.0.1', () => {
      localAssetServer = server;
      const addr = server.address();
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

// Path to local JSON store inside %APPDATA%/jarvis-pc
function getStorePath() {
  return path.join(app.getPath('userData'), 'jarvis-store.json');
}

function readStore() {
  try {
    const p = getStorePath();
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

function writeStore(data) {
  try {
    const p = getStorePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}

function encryptSecret(plainText) {
  if (!plainText) return '';
  try {
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      return 'safe:' + safeStorage.encryptString(plainText).toString('base64');
    }
  } catch {}
  const key = crypto.createHash('sha256').update(os.hostname() + ':' + os.userInfo().username + ':jarvis2').digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return 'aes:' + Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptSecret(payload) {
  if (!payload) return '';
  try {
    if (payload.startsWith('safe:') && safeStorage && safeStorage.isEncryptionAvailable()) {
      const buf = Buffer.from(payload.slice(5), 'base64');
      return safeStorage.decryptString(buf);
    }
    if (payload.startsWith('aes:')) {
      const raw = Buffer.from(payload.slice(4), 'base64');
      const iv = raw.subarray(0, 12);
      const tag = raw.subarray(12, 28);
      const enc = raw.subarray(28);
      const key = crypto.createHash('sha256').update(os.hostname() + ':' + os.userInfo().username + ':jarvis2').digest();
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
    }
    return payload;
  } catch {
    return '';
  }
}

function runCmd(cmd, timeout = 10000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        stdout: (stdout || '').toString().trim(),
        stderr: (stderr || (err ? err.message : '')).toString().trim(),
      });
    });
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1340,
    height: 860,
    minWidth: 940,
    minHeight: 640,
    backgroundColor: '#060e14',
    title: 'JARVIS 2.0',
    icon: path.join(__dirname, '../dist/icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  // Grant microphone, camera, and screen capture permissions automatically inside the desktop app
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['media', 'microphone', 'camera', 'display-capture', 'notifications', 'geolocation', 'clipboard-read', 'clipboard-sanitized-write'];
    callback(allowed.includes(permission));
  });

  const startUrl = process.env.ELECTRON_START_URL;
  if (startUrl) {
    await mainWindow.loadURL(startUrl);
  } else {
    const embeddedUrl = await startEmbeddedAssetServer();
    await mainWindow.loadURL(embeddedUrl);
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('mailto:') || url.startsWith('steam:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
}

// ── Navigateur piloté par Playwright (electron/browserControl.cjs) ──────────────

function getBrowserControl() {
  if (browserControl) return browserControl;
  const { createBrowserControl } = require('./browserControl.cjs');
  browserControl = createBrowserControl({ profileDir: path.join(app.getPath('userData'), 'navigateur') });
  return browserControl;
}

ipcMain.handle('jarvis:browser', (_e, payload) => getBrowserControl().run(payload || {}));

// ── Images créées par Fooocus, ComfyUI ou Forge sur ce PC (electron/imageGen.cjs), pour Jarvis Android ──

function getImageGen() {
  if (imageGen) return imageGen;
  const { createImageGen } = require('./imageGen.cjs');
  imageGen = createImageGen({
    baseUrl: () => process.env.JARVIS_SD_URL || readStore().imageServerUrl || '',
    comfyModel: () => process.env.JARVIS_COMFY_MODEL || readStore().comfyModel || '',
  });
  return imageGen;
}

// ── Contrôle à distance depuis Jarvis Android (electron/remoteServer.cjs) ──────

function getRemoteServer() {
  if (remoteServer) return remoteServer;
  const { createRemoteServer, createReplyCollector } = require('./remoteServer.cjs');
  remoteServer = createRemoteServer({
    dataDir: app.getPath('userData'),
    onCommand: (text) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('jarvis:remote-command', text);
    },
    onEvent: (event) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('jarvis:remote-event', event);
    },
    onBrowser: (input) => getBrowserControl().run(input),
    onImage: (input) => getImageGen().run(input),
  });
  remoteCollect = createReplyCollector((msg) => remoteServer.broadcast(msg));
  return remoteServer;
}

async function setRemoteEnabled(enabled) {
  const store = readStore();
  store.remoteEnabled = Boolean(enabled);
  writeStore(store);
  const srv = getRemoteServer();
  if (!enabled) {
    await srv.stop();
    return { ok: true, ...srv.info() };
  }
  try {
    return { ok: true, ...(await srv.start()) };
  } catch (err) {
    const busy = err && err.code === 'EADDRINUSE';
    return { ok: false, error: busy ? 'Le port 8000 est déjà utilisé par un autre programme.' : String(err.message || err), ...srv.info() };
  }
}

ipcMain.handle('jarvis:remote-status', () => ({ enabled: Boolean(readStore().remoteEnabled), ...getRemoteServer().info() }));
ipcMain.handle('jarvis:remote-enable', (_e, enabled) => setRemoteEnabled(enabled));
ipcMain.handle('jarvis:remote-new-key', async () => {
  const srv = getRemoteServer();
  if (!srv.info().running) {
    const started = await setRemoteEnabled(true);
    if (!started.ok) return started;
  }
  return { ok: true, ...srv.newKey() };
});
ipcMain.handle('jarvis:remote-revoke', () => {
  getRemoteServer().revokeAll();
  return { ok: true };
});
ipcMain.on('jarvis:remote-say', (_e, msg) => {
  if (remoteServer && remoteCollect) remoteCollect(msg);
});

app.whenReady().then(() => {
  createWindow();
  if (readStore().remoteEnabled) setRemoteEnabled(true).catch(() => {});

  // Register global Push-to-Talk shortcut (Ctrl+Space)
  try {
    globalShortcut.register('CommandOrControl+Space', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('jarvis:hotkey-ptt');
      }
    });
  } catch {}

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  try {
    globalShortcut.unregisterAll();
  } catch {}
  try {
    remoteServer?.stop();
  } catch {}
  try {
    browserControl?.close();
  } catch {}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── IPC Handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('jarvis:storage-get', (_e, key) => {
  const store = readStore();
  return store[key] ?? null;
});

ipcMain.handle('jarvis:storage-set', (_e, key, value) => {
  const store = readStore();
  store[key] = value;
  return writeStore(store);
});

ipcMain.handle('jarvis:secret-get', (_e, slot) => {
  const store = readStore();
  const enc = store[`secret_${slot}`];
  return enc ? decryptSecret(enc) : '';
});

ipcMain.handle('jarvis:secret-set', (_e, slot, value) => {
  const store = readStore();
  if (!value) {
    delete store[`secret_${slot}`];
  } else {
    store[`secret_${slot}`] = encryptSecret(value);
  }
  return writeStore(store);
});

ipcMain.handle('jarvis:open-external', async (_e, url) => {
  try {
    await shell.openExternal(url);
    return true;
  } catch {
    return false;
  }
});

// arena.ai: manual browsing only. Separate window with its own persistent profile (the user signs in
// themselves), no privileged bridge, every permission denied. Jarvis never reads this profile or drives
// the page: arena.ai's terms of use forbid automated access.
const ARENA_PARTITION = 'persist:jarvis-arena';
let arenaWindow = null;

function isArenaUrl(raw) {
  try {
    const u = new URL(String(raw));
    return u.protocol === 'https:' && (u.hostname === 'arena.ai' || u.hostname.endsWith('.arena.ai'));
  } catch {
    return false;
  }
}

ipcMain.handle('jarvis:open-arena', async (_e, rawUrl) => {
  const target = rawUrl && isArenaUrl(rawUrl) ? String(rawUrl) : 'https://arena.ai/';
  if (arenaWindow && !arenaWindow.isDestroyed()) {
    arenaWindow.show();
    arenaWindow.focus();
    if (!isArenaUrl(arenaWindow.webContents.getURL())) await arenaWindow.loadURL(target).catch(() => {});
    return { ok: true, reused: true };
  }
  const arenaSession = session.fromPartition(ARENA_PARTITION);
  arenaSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  arenaWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    title: 'arena.ai — session manuelle',
    backgroundColor: '#0b0b0f',
    autoHideMenuBar: true,
    webPreferences: {
      partition: ARENA_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  arenaWindow.on('closed', () => { arenaWindow = null; });
  arenaWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // Stay on https pages (login providers included); anything else leaves for the system browser.
  arenaWindow.webContents.on('will-navigate', (event, url) => {
    if (!/^https:\/\//i.test(url)) {
      event.preventDefault();
    }
  });
  try {
    await arenaWindow.loadURL(target);
    return { ok: true, reused: false };
  } catch (error) {
    return { ok: false, message: error.message || String(error) };
  }
});

ipcMain.handle('jarvis:notify', (_e, title, body) => {
  try {
    if (Notification.isSupported()) {
      new Notification({ title: title || 'JARVIS', body: body || '' }).show();
      return true;
    }
  } catch {}
  return false;
});

ipcMain.handle('jarvis:clipboard-read', () => {
  try {
    return clipboard.readText() || '';
  } catch {
    return '';
  }
});

ipcMain.handle('jarvis:clipboard-write', (_e, text) => {
  try {
    clipboard.writeText(String(text || ''));
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('jarvis:capture-screen', async (_e, maxDim = 1280) => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: maxDim, height: Math.round(maxDim * 0.625) },
    });
    if (!sources || sources.length === 0) return null;
    const jpeg = sources[0].thumbnail.toJPEG(82);
    return jpeg.toString('base64');
  } catch {
    return null;
  }
});

ipcMain.handle('jarvis:system-info', async () => {
  const cpus = os.cpus() || [];
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  let cpuLoad = 0;
  if (cpus.length > 0) {
    const totals = cpus.reduce(
      (acc, c) => {
        const total = Object.values(c.times).reduce((a, b) => a + b, 0);
        return { idle: acc.idle + c.times.idle, total: acc.total + total };
      },
      { idle: 0, total: 0 }
    );
    cpuLoad = Math.round((1 - totals.idle / Math.max(1, totals.total)) * 100);
  }

  let battery = null;
  let disk = null;
  if (process.platform === 'win32') {
    const batRes = await runCmd(
      'powershell -NoProfile -Command "Get-CimInstance -ClassName Win32_Battery | Select-Object EstimatedChargeRemaining, BatteryStatus | ConvertTo-Json -Compress"',
      4000
    );
    if (batRes.ok && batRes.stdout) {
      try {
        const b = JSON.parse(batRes.stdout);
        const item = Array.isArray(b) ? b[0] : b;
        if (item && item.EstimatedChargeRemaining != null) {
          battery = {
            percent: item.EstimatedChargeRemaining,
            charging: item.BatteryStatus === 2 || item.BatteryStatus === 6,
          };
        }
      } catch {}
    }
    const diskRes = await runCmd(
      'powershell -NoProfile -Command "Get-CimInstance Win32_LogicalDisk -Filter \\"DriveType=3\\" | Select-Object DeviceID,Size,FreeSpace | ConvertTo-Json -Compress"',
      4000
    );
    if (diskRes.ok && diskRes.stdout) {
      try {
        const d = JSON.parse(diskRes.stdout);
        const list = Array.isArray(d) ? d : [d];
        disk = list.map((x) => ({
          mount: x.DeviceID,
          totalGb: Math.round((Number(x.Size || 0) / 1e9) * 10) / 10,
          freeGb: Math.round((Number(x.FreeSpace || 0) / 1e9) * 10) / 10,
        }));
      } catch {}
    }
  } else {
    const dfRes = await runCmd('df -BG / | tail -1', 3000);
    if (dfRes.ok && dfRes.stdout) {
      const parts = dfRes.stdout.split(/\s+/);
      if (parts.length >= 4) {
        disk = [
          {
            mount: '/',
            totalGb: parseFloat(parts[1]) || 0,
            freeGb: parseFloat(parts[3]) || 0,
          },
        ];
      }
    }
  }

  return {
    platform: process.platform,
    release: os.release(),
    arch: os.arch(),
    hostname: os.hostname(),
    cpuModel: cpus[0]?.model || 'CPU',
    cpuCores: cpus.length,
    cpuLoadPercent: cpuLoad,
    ramTotalGb: Math.round((totalMem / 1073741824) * 10) / 10,
    ramUsedGb: Math.round((usedMem / 1073741824) * 10) / 10,
    ramFreeGb: Math.round((freeMem / 1073741824) * 10) / 10,
    ramPercent: Math.round((usedMem / Math.max(1, totalMem)) * 100),
    uptimeHours: Math.round((os.uptime() / 3600) * 10) / 10,
    battery,
    disk,
  };
});

// Launch PC application, system folder, or URL
ipcMain.handle('jarvis:open-app', async (_e, appName) => {
  const raw = String(appName || '').trim();
  if (!raw) return { ok: false, message: "Nom d'application manquant." };
  const lower = raw.toLowerCase();

  // Direct URL support
  if (/^(https?:\/\/|mailto:|steam:|spotify:|discord:|obsidian:)/i.test(raw)) {
    await shell.openExternal(raw);
    return { ok: true, message: `Lien ouvert : ${raw}` };
  }

  // System folders (Documents, Downloads, Desktop, Pictures, Music, Videos, Jarvis)
  const folderMap = {
    documents: 'documents',
    'mes documents': 'documents',
    telechargements: 'downloads',
    téléchargements: 'downloads',
    downloads: 'downloads',
    bureau: 'desktop',
    desktop: 'desktop',
    images: 'pictures',
    photos: 'pictures',
    pictures: 'pictures',
    musique: 'music',
    music: 'music',
    videos: 'videos',
    vidéos: 'videos',
    accueil: 'home',
    home: 'home',
  };
  if (lower === 'dossier jarvis' || lower === 'jarvis') {
    const jarvisDir = path.join(app.getPath('documents'), 'Jarvis');
    fs.mkdirSync(jarvisDir, { recursive: true });
    await shell.openPath(jarvisDir);
    return { ok: true, message: `Dossier Jarvis ouvert : ${jarvisDir}` };
  }
  if (folderMap[lower]) {
    const dir = app.getPath(folderMap[lower]);
    await shell.openPath(dir);
    return { ok: true, message: `Dossier ouvert : ${dir}` };
  }

  const webFallbacks = {
    youtube: 'https://www.youtube.com',
    gmail: 'https://mail.google.com',
    whatsapp: 'https://web.whatsapp.com',
    telegram: 'https://web.telegram.org',
    messenger: 'https://www.messenger.com',
    netflix: 'https://www.netflix.com',
    chatgpt: 'https://chatgpt.com',
    github: 'https://github.com',
    maps: 'https://www.google.com/maps',
    drive: 'https://drive.google.com',
    calendar: 'https://calendar.google.com',
    agenda: 'https://calendar.google.com',
  };

  if (process.platform === 'win32') {
    const winMap = {
      bloc: 'notepad.exe',
      'bloc-notes': 'notepad.exe',
      notepad: 'notepad.exe',
      calculatrice: 'calc.exe',
      calc: 'calc.exe',
      calculator: 'calc.exe',
      explorateur: 'explorer.exe',
      explorer: 'explorer.exe',
      fichiers: 'explorer.exe',
      paint: 'mspaint.exe',
      cmd: 'cmd.exe',
      terminal: 'wt.exe',
      powershell: 'powershell.exe',
      gestionnaire: 'taskmgr.exe',
      'gestionnaire des tâches': 'taskmgr.exe',
      taskmgr: 'taskmgr.exe',
      capture: 'ms-screenclip:',
      snippingtool: 'snippingtool.exe',
      parametres: 'ms-settings:',
      réglages: 'ms-settings:',
      reglages: 'ms-settings:',
      settings: 'ms-settings:',
      panneau: 'control.exe',
      'panneau de configuration': 'control.exe',
      regedit: 'regedit.exe',
      services: 'services.msc',
      dxdiag: 'dxdiag.exe',
      cleanmgr: 'cleanmgr.exe',
      chrome: 'chrome',
      'google chrome': 'chrome',
      edge: 'msedge',
      'microsoft edge': 'msedge',
      firefox: 'firefox',
      brave: 'brave',
      opera: 'opera',
      vscode: 'code',
      'visual studio code': 'code',
      code: 'code',
      spotify: 'spotify:',
      discord: 'discord:',
      steam: 'steam://open/main',
      obsidian: 'obsidian://open',
      word: 'winword',
      excel: 'excel',
      powerpoint: 'powerpnt',
      outlook: 'outlook',
      teams: 'msteams:',
      vlc: 'vlc',
      obs: 'obs64',
      blender: 'blender',
      gimp: 'gimp',
      audacity: 'audacity',
      horloge: 'ms-clock:',
      alarme: 'ms-clock:',
      meteo: 'bingweather:',
      cartes: 'bingmaps:',
      store: 'ms-windows-store:',
      xbox: 'xbox:',
    };
    const mapped = winMap[lower] || Object.entries(winMap).find(([k]) => lower.includes(k))?.[1];
    if (mapped) {
      if (mapped.includes(':')) {
        await shell.openExternal(mapped);
        return { ok: true, message: `Application ouverte : ${raw}` };
      }
      const res = await runCmd(`start "" "${mapped}"`);
      if (res.ok) return { ok: true, message: `Application lancée : ${raw}` };
    }
    // Search Start Menu shortcuts via PowerShell
    const safe = raw.replace(/["'`$&|;<>]/g, '');
    const ps = `powershell -NoProfile -Command "$app = Get-StartApps | Where-Object { $_.Name -like '*${safe}*' } | Select-Object -First 1; if ($app) { Start-Process explorer.exe ('shell:AppsFolder\\' + $app.AppID); Write-Output $app.Name } else { exit 1 }"`;
    const found = await runCmd(ps, 6000);
    if (found.ok && found.stdout) {
      return { ok: true, message: `Application lancée : ${found.stdout}` };
    }
  } else {
    const linuxMap = {
      chrome: 'google-chrome',
      firefox: 'firefox',
      code: 'code',
      vscode: 'code',
      terminal: 'x-terminal-emulator',
      explorateur: 'xdg-open ~',
      fichiers: 'xdg-open ~',
      calculatrice: 'gnome-calculator',
      vlc: 'vlc',
    };
    const cmd = linuxMap[lower] || raw.replace(/[^a-zA-Z0-9_-]/g, '');
    if (cmd) {
      const res = await runCmd(`nohup ${cmd} >/dev/null 2>&1 &`);
      if (res.ok) return { ok: true, message: `Commande lancée : ${raw}` };
    }
  }

  const webUrl = webFallbacks[lower] || Object.entries(webFallbacks).find(([k]) => lower.includes(k))?.[1];
  if (webUrl) {
    await shell.openExternal(webUrl);
    return { ok: true, message: `Ouvert dans le navigateur : ${raw}` };
  }

  return { ok: false, message: `Aucune application correspondant à « ${raw} » n'a été trouvée.` };
});

// PC Device Settings (Volume, Brightness, Media keys, Settings pages, Lock, Power)
ipcMain.handle('jarvis:device-settings', async (_e, payload) => {
  const { action, level, command, page } = payload || {};
  if (process.platform === 'win32') {
    if (action === 'set_volume' && typeof level === 'number') {
      const target = Math.max(0, Math.min(100, Math.round(level)));
      const steps = Math.round(target / 2);
      const ps = `powershell -NoProfile -Command "$w = New-Object -ComObject WScript.Shell; 1..50 | ForEach-Object { $w.SendKeys([char]174) }; 1..${steps} | ForEach-Object { $w.SendKeys([char]175) }"`;
      await runCmd(ps, 6000);
      return { ok: true, message: `Volume du PC réglé à ${target} %.` };
    }
    if (action === 'volume_Step') {
      const charCode = command === 'down' ? 174 : command === 'mute' ? 173 : 175;
      const count = command === 'mute' ? 1 : 5;
      await runCmd(`powershell -NoProfile -Command "$w = New-Object -ComObject WScript.Shell; 1..${count} | ForEach-Object { $w.SendKeys([char]${charCode}) }"`, 4000);
      return { ok: true, message: `Volume ajusté (${command}).` };
    }
    if (action === 'set_brightness' && typeof level === 'number') {
      const target = Math.max(0, Math.min(100, Math.round(level)));
      const res = await runCmd(
        `powershell -NoProfile -Command "(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,${target})"`,
        5000
      );
      return {
        ok: true,
        message: res.ok
          ? `Luminosité de l'écran réglée à ${target} %.`
          : `Demande de luminosité (${target} %) envoyée (certains écrans externes de bureau ne supportent pas WMI).`,
      };
    }
    if (action === 'media') {
      const keyMap = { play: 179, pause: 179, toggle: 179, next: 176, previous: 177, stop: 178 };
      const code = keyMap[command] || 179;
      await runCmd(`powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]${code})"`, 3000);
      return { ok: true, message: `Touche média envoyée : ${command}.` };
    }
    if (action === 'lock_screen') {
      await runCmd('rundll32.exe user32.dll,LockWorkStation');
      return { ok: true, message: 'Session Windows verrouillée.' };
    }
    if (action === 'display_off') {
      await runCmd(
        'powershell -NoProfile -Command "Add-Type -MemberDefinition \'[DllImport(\\"user32.dll\\")] public static extern int SendMessage(int hWnd, int hMsg, int wParam, int lParam);\' -Name M -Namespace W; [W.M]::SendMessage(0xFFFF, 0x0112, 0xF170, 2)"',
        4000
      );
      return { ok: true, message: 'Écran du PC mis en veille.' };
    }
    if (action === 'empty_recycle_bin') {
      await runCmd('powershell -NoProfile -Command "Clear-RecycleBin -Force -ErrorAction SilentlyContinue"', 6000);
      return { ok: true, message: 'Corbeille Windows vidée.' };
    }
    if (action === 'screenshot_snip') {
      await shell.openExternal('ms-screenclip:');
      return { ok: true, message: 'Outil Capture Windows lancé.' };
    }
    if (action === 'open_settings') {
      const map = {
        wifi: 'ms-settings:network-wifi',
        bluetooth: 'ms-settings:bluetooth',
        display: 'ms-settings:display',
        nightlight: 'ms-settings:nightlight',
        sound: 'ms-settings:sound',
        battery: 'ms-settings:batterysaver',
        storage: 'ms-settings:storagesense',
        update: 'ms-settings:windowsupdate',
        apps: 'ms-settings:appsfeatures',
        taskbar: 'ms-settings:taskbar',
        privacy: 'ms-settings:privacy',
        clipboard: 'ms-settings:clipboard',
      };
      await shell.openExternal(map[page] || 'ms-settings:');
      return { ok: true, message: `Paramètres Windows ouverts (${page || 'général'}).` };
    }
    if (action === 'power') {
      if (command === 'sleep') {
        await runCmd('rundll32.exe powrprof.dll,SetSuspendState 0,1,0');
        return { ok: true, message: 'Mise en veille du PC lancée.' };
      }
      if (command === 'restart') {
        await runCmd('shutdown /r /t 5');
        return { ok: true, message: 'Redémarrage du PC programmé dans 5 secondes.' };
      }
      if (command === 'shutdown') {
        await runCmd('shutdown /s /t 5');
        return { ok: true, message: 'Arrêt du PC programmé dans 5 secondes.' };
      }
      if (command === 'cancel') {
        await runCmd('shutdown /a');
        return { ok: true, message: 'Arrêt/redémarrage programmé annulé.' };
      }
    }
  }
  return { ok: true, message: `Action système exécutée : ${action}${command ? ' (' + command + ')' : ''}.` };
});

// PC Desktop / Mouse / Keyboard / Windows automation
ipcMain.handle('jarvis:computer-control', async (_e, payload) => {
  const { action, x, y, delta, text, keys, windowTitle, pid } = payload || {};
  if (process.platform === 'win32') {
    if (action === 'list_windows') {
      const res = await runCmd(
        'powershell -NoProfile -Command "Get-Process | Where-Object { $_.MainWindowTitle } | Sort-Object WorkingSet64 -Descending | Select-Object Id, ProcessName, MainWindowTitle, Responding, @{Name=\'MemoryMB\';Expression={[math]::Round($_.WorkingSet64 / 1MB, 1)}} | ConvertTo-Json -Compress"',
        5000
      );
      if (res.ok && res.stdout) {
        return { ok: true, result: res.stdout };
      }
      return { ok: true, result: '[]' };
    }
    if (action === 'focus_window' && (windowTitle || pid)) {
      const safe = String(windowTitle || '').replace(/["'`]/g, '');
      const filter = pid ? `$_.Id -eq ${Number(pid)}` : `$_.MainWindowTitle -like '*${safe}*' -or $_.ProcessName -like '*${safe}*'`;
      const ps = `powershell -NoProfile -Command "Add-Type -MemberDefinition '[DllImport(\\"user32.dll\\")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow); [DllImport(\\"user32.dll\\")] public static extern bool SetForegroundWindow(IntPtr hWnd);' -Name W -Namespace U; $p = Get-Process | Where-Object { ${filter} } | Select-Object -First 1; if ($p -and $p.MainWindowHandle) { [U.W]::ShowWindowAsync($p.MainWindowHandle, 9) | Out-Null; [U.W]::SetForegroundWindow($p.MainWindowHandle) | Out-Null; Write-Output $p.MainWindowTitle }"`;
      const res = await runCmd(ps, 4000);
      return { ok: true, result: res.stdout ? `Fenêtre au premier plan : ${res.stdout}` : `Aucune fenêtre trouvée pour « ${safe || pid} ».` };
    }
    if ((action === 'maximize_window' || action === 'minimize_window' || action === 'restore_window') && (windowTitle || pid)) {
      const safe = String(windowTitle || '').replace(/["'`]/g, '');
      const cmdShow = action === 'maximize_window' ? 3 : action === 'minimize_window' ? 6 : 9;
      const filter = pid ? `$_.Id -eq ${Number(pid)}` : `$_.MainWindowTitle -like '*${safe}*' -or $_.ProcessName -like '*${safe}*'`;
      const ps = `powershell -NoProfile -Command "Add-Type -MemberDefinition '[DllImport(\\"user32.dll\\")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow); [DllImport(\\"user32.dll\\")] public static extern bool SetForegroundWindow(IntPtr hWnd);' -Name W -Namespace U; $p = Get-Process | Where-Object { ${filter} } | Select-Object -First 1; if ($p -and $p.MainWindowHandle) { [U.W]::ShowWindowAsync($p.MainWindowHandle, ${cmdShow}) | Out-Null; if (${cmdShow} -ne 6) { [U.W]::SetForegroundWindow($p.MainWindowHandle) | Out-Null }; Write-Output $p.MainWindowTitle }"`;
      const res = await runCmd(ps, 4000);
      return { ok: true, result: res.stdout ? `Action (${action}) sur : ${res.stdout}` : `Fenêtre introuvable.` };
    }
    if (action === 'snap_left' || action === 'snap_right') {
      const safe = String(windowTitle || '').replace(/["'`]/g, '');
      const rightSide = action === 'snap_right' ? '$sw / 2' : '0';
      const filter = pid
        ? `$p = Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue; $h = $p.MainWindowHandle`
        : safe
        ? `$p = Get-Process | Where-Object { $_.MainWindowTitle -like '*${safe}*' -or $_.ProcessName -like '*${safe}*' } | Select-Object -First 1; $h = $p.MainWindowHandle`
        : `$h = [U.S]::GetForegroundWindow()`;
      const ps = `powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; Add-Type -MemberDefinition '[DllImport(\\"user32.dll\\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\\"user32.dll\\")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow); [DllImport(\\"user32.dll\\")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int W, int H, bool bRepaint);' -Name S -Namespace U; ${filter}; if ($h) { $wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea; $sw = $wa.Width; $sh = $wa.Height; [U.S]::ShowWindowAsync($h, 9) | Out-Null; [U.S]::MoveWindow($h, [int](${rightSide}), $wa.Top, [int]($sw / 2), $sh, $true) | Out-Null; Write-Output 'OK' }"`;
      await runCmd(ps, 4000);
      return { ok: true, result: `Fenêtre ancrée à ${action === 'snap_right' ? 'droite' : 'gauche'} de l'écran.` };
    }
    if (action === 'close_window' && (windowTitle || pid)) {
      const safe = String(windowTitle || '').replace(/["'`]/g, '');
      const filter = pid ? `$_.Id -eq ${Number(pid)}` : `$_.MainWindowTitle -like '*${safe}*' -or $_.ProcessName -like '*${safe}*'`;
      const ps = `powershell -NoProfile -Command "$p = Get-Process | Where-Object { ${filter} } | Select-Object -First 1; if ($p) { $p.CloseMainWindow() | Out-Null; Write-Output $p.MainWindowTitle }"`;
      const res = await runCmd(ps, 4000);
      return { ok: true, result: res.stdout ? `Fenêtre fermée : ${res.stdout}` : `Aucune fenêtre trouvée pour « ${safe || pid} ».` };
    }
    if (action === 'kill_process' && (windowTitle || pid)) {
      const safe = String(windowTitle || '').replace(/["'`]/g, '');
      const ps = pid
        ? `powershell -NoProfile -Command "Stop-Process -Id ${Number(pid)} -Force -ErrorAction SilentlyContinue; Write-Output 'PID ${Number(pid)}'"`
        : `powershell -NoProfile -Command "$p = Get-Process | Where-Object { $_.MainWindowTitle -like '*${safe}*' -or $_.ProcessName -like '*${safe}*' } | Select-Object -First 1; if ($p) { Stop-Process -Id $p.Id -Force; Write-Output $p.ProcessName }"`;
      const res = await runCmd(ps, 4000);
      return { ok: true, result: res.stdout ? `Processus terminé : ${res.stdout}` : `Processus introuvable.` };
    }
    if (action === 'minimize_all' || action === 'show_desktop') {
      await runCmd('powershell -NoProfile -Command "(New-Object -ComObject Shell.Application).ToggleDesktop()"', 3000);
      return { ok: true, result: 'Bureau affiché (fenêtres basculées).' };
    }
    if (action === 'paste_text' && text) {
      clipboard.writeText(String(text));
      await runCmd('powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).SendKeys(\'^v\')"', 3000);
      return { ok: true, result: `Texte collé instantanément (${text.length} caractères).` };
    }
    if (action === 'type_text' && text) {
      const escaped = String(text).replace(/[+^%~(){}[\]]/g, '{$&}').replace(/"/g, '""');
      await runCmd(`powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).SendKeys(\\"${escaped}\\")"`, 4000);
      return { ok: true, result: `Texte saisi au clavier (${text.length} caractères).` };
    }
    if (action === 'hotkey' && keys) {
      const lowerKey = String(keys).toLowerCase().trim();
      if (lowerKey === 'win+d') {
        await runCmd('powershell -NoProfile -Command "(New-Object -ComObject Shell.Application).ToggleDesktop()"', 3000);
        return { ok: true, result: 'Raccourci Win+D exécuté (Bureau).' };
      }
      if (lowerKey === 'win+e') {
        await runCmd('explorer.exe');
        return { ok: true, result: 'Raccourci Win+E exécuté (Explorateur).' };
      }
      if (lowerKey === 'win+shift+s') {
        await shell.openExternal('ms-screenclip:');
        return { ok: true, result: 'Outil Capture Windows lancé.' };
      }
      if (lowerKey === 'ctrl+shift+esc') {
        await runCmd('start "" taskmgr.exe');
        return { ok: true, result: 'Gestionnaire des tâches ouvert.' };
      }
      const mapSendKeys = lowerKey
        .replace(/ctrl\+/g, '^')
        .replace(/alt\+/g, '%')
        .replace(/shift\+/g, '+')
        .replace(/\benter\b|\bentrée\b|\bentree\b/g, '{ENTER}')
        .replace(/\btab\b/g, '{TAB}')
        .replace(/\besc\b|\béchap\b|\bechap\b/g, '{ESC}')
        .replace(/\bspace\b|\bespace\b/g, ' ')
        .replace(/\bbackspace\b/g, '{BS}')
        .replace(/\bdelete\b|\bsuppr\b/g, '{DEL}')
        .replace(/\bup\b|\bhaut\b/g, '{UP}')
        .replace(/\bdown\b|\bbas\b/g, '{DOWN}')
        .replace(/\bleft\b|\bgauche\b/g, '{LEFT}')
        .replace(/\bright\b|\bdroite\b/g, '{RIGHT}')
        .replace(/\bpageup\b/g, '{PGUP}')
        .replace(/\bpagedown\b/g, '{PGDN}')
        .replace(/\bhome\b/g, '{HOME}')
        .replace(/\bend\b/g, '{END}')
        .replace(/\bf(\d{1,2})\b/g, '{F$1}');
      await runCmd(`powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).SendKeys('${mapSendKeys}')"`, 4000);
      return { ok: true, result: `Raccourci clavier envoyé : ${keys}` };
    }
    if (action === 'mouse_scroll') {
      const wheelDelta = Math.round(Number(delta ?? -360));
      const ps = `powershell -NoProfile -Command "Add-Type -MemberDefinition '[DllImport(\\"user32.dll\\")] public static extern void mouse_event(int f, int dx, int dy, int d, int i);' -Name U -Namespace W; [W.U]::mouse_event(0x0800, 0, 0, ${wheelDelta}, 0)"`;
      await runCmd(ps, 3000);
      return { ok: true, result: `Défilement souris (${wheelDelta > 0 ? 'haut' : 'bas'}) effectué.` };
    }
    if ((action === 'mouse_move' || action === 'mouse_click' || action === 'mouse_double_click' || action === 'mouse_right_click') && x != null && y != null) {
      const ix = Math.round(Number(x));
      const iy = Math.round(Number(y));
      const clickFlag =
        action === 'mouse_right_click'
          ? '[W.U]::mouse_event(0x08,0,0,0,0); [W.U]::mouse_event(0x10,0,0,0,0);'
          : action === 'mouse_double_click'
          ? '[W.U]::mouse_event(0x02,0,0,0,0); [W.U]::mouse_event(0x04,0,0,0,0); Start-Sleep -Milliseconds 70; [W.U]::mouse_event(0x02,0,0,0,0); [W.U]::mouse_event(0x04,0,0,0,0);'
          : action === 'mouse_click'
          ? '[W.U]::mouse_event(0x02,0,0,0,0); [W.U]::mouse_event(0x04,0,0,0,0);'
          : '';
      const ps = `powershell -NoProfile -Command "Add-Type -MemberDefinition '[DllImport(\\"user32.dll\\")] public static extern bool SetCursorPos(int X, int Y); [DllImport(\\"user32.dll\\")] public static extern void mouse_event(int f, int dx, int dy, int d, int i);' -Name U -Namespace W; [W.U]::SetCursorPos(${ix},${iy}); ${clickFlag}"`;
      await runCmd(ps, 4000);
      return { ok: true, result: `Action souris (${action}) effectuée en (${ix}, ${iy}).` };
    }
  }
  return { ok: true, result: `Action bureau (${action}) prise en compte.` };
});

// Folder Picker
ipcMain.handle('jarvis:pick-folder', async (_e, title) => {
  if (!mainWindow) return null;
  const res = await dialog.showOpenDialog(mainWindow, {
    title: title || 'Choisir un dossier',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (res.canceled || !res.filePaths || res.filePaths.length === 0) return null;
  return res.filePaths[0];
});

// Safe File Manager inside a user-selected root folder
function resolveInside(rootDir, relPath) {
  if (!rootDir) return null;
  const rootResolved = path.resolve(rootDir);
  const target = path.resolve(rootResolved, String(relPath || '').replace(/^[/\\]+/, ''));
  if (target !== rootResolved && !target.startsWith(rootResolved + path.sep)) {
    return null;
  }
  return target;
}

ipcMain.handle('jarvis:file-manager', async (_e, payload) => {
  const { rootDir, action, path: relPath, newPath, content, query } = payload || {};
  if (!rootDir || !fs.existsSync(rootDir)) {
    return { ok: false, message: "Aucun dossier de travail valide n'est configuré dans Paramètres > Dossier de travail." };
  }
  const target = resolveInside(rootDir, relPath || '.');
  if (!target) {
    return { ok: false, message: 'Chemin refusé : hors du dossier de travail autorisé.' };
  }
  try {
    if (action === 'list') {
      const entries = fs.readdirSync(target, { withFileTypes: true });
      const items = entries.slice(0, 100).map((e) => {
        const full = path.join(target, e.name);
        let size = 0;
        try {
          if (e.isFile()) size = fs.statSync(full).size;
        } catch {}
        return { name: e.name, isDir: e.isDirectory(), size };
      });
      return { ok: true, items };
    }
    if (action === 'read') {
      if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        return { ok: false, message: 'Fichier introuvable.' };
      }
      const text = fs.readFileSync(target, 'utf8').slice(0, 25000);
      return { ok: true, content: text };
    }
    if (action === 'write') {
      const previous = fs.existsSync(target) && fs.statSync(target).isFile() ? fs.readFileSync(target, 'utf8') : null;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, String(content ?? ''), 'utf8');
      return { ok: true, previous, existed: previous !== null, message: `Fichier écrit : ${relPath}` };
    }
    if (action === 'delete') {
      if (!fs.existsSync(target)) return { ok: false, message: 'Fichier introuvable.' };
      const previous = fs.statSync(target).isFile() ? fs.readFileSync(target, 'utf8') : null;
      fs.rmSync(target, { recursive: true, force: true });
      return { ok: true, previous, message: `Supprimé : ${relPath}` };
    }
    if (action === 'rename' || action === 'move') {
      const dest = resolveInside(rootDir, newPath);
      if (!dest) return { ok: false, message: 'Destination hors du dossier de travail.' };
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(target, dest);
      return { ok: true, message: `Déplacé : ${relPath} → ${newPath}` };
    }
    if (action === 'search') {
      const q = String(query || '').toLowerCase();
      const matches = [];
      function walk(dir, depth = 0) {
        if (depth > 4 || matches.length >= 30) return;
        let list = [];
        try {
          list = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of list) {
          if (matches.length >= 30) break;
          const full = path.join(dir, e.name);
          const rel = path.relative(rootDir, full);
          if (e.name.toLowerCase().includes(q)) {
            matches.push({ path: rel, match: 'nom' });
          } else if (e.isFile() && /\.(txt|md|json|csv|py|js|ts|kt|html|css|xml|log)$/i.test(e.name)) {
            try {
              const stat = fs.statSync(full);
              if (stat.size < 500000) {
                const body = fs.readFileSync(full, 'utf8');
                if (body.toLowerCase().includes(q)) matches.push({ path: rel, match: 'contenu' });
              }
            } catch {}
          }
          if (e.isDirectory() && !e.name.startsWith('.')) walk(full, depth + 1);
        }
      }
      walk(rootDir, 0);
      return { ok: true, matches };
    }
    return { ok: false, message: `Action fichier inconnue : ${action}` };
  } catch (e) {
    return { ok: false, message: e.message || String(e) };
  }
});

// Skill Crucible: runs generated skill code in the isolated worker sandbox (no network, no filesystem).
ipcMain.handle('jarvis:skill-run', async (_e, input = {}) => {
  const { runInSandbox } = require('./skillSandbox.cjs');
  return runInSandbox({
    code: typeof input.code === 'string' ? input.code : '',
    args: input.args && typeof input.args === 'object' ? input.args : {},
    mode: input.mode === 'check' ? 'check' : 'run',
    timeoutMs: Number(input.timeoutMs) || 1500,
  });
});

// Google OAuth 2.0 (installed app) + PKCE: loopback callback only, minimal read/write scopes.
const GOOGLE_REDIRECT_PORT = 43822;
const GOOGLE_REDIRECT_URI = `http://127.0.0.1:${GOOGLE_REDIRECT_PORT}/google/callback`;
ipcMain.handle('jarvis:google-authorize', async (_e, input = {}) => {
  const clientId = String(input.clientId || '').trim();
  const codeChallenge = String(input.codeChallenge || '').trim();
  const state = String(input.state || '').trim();
  const scopes = Array.isArray(input.scopes) ? input.scopes.map(String) : [];
  if (!/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(clientId)) return { ok: false, error: 'Client ID Google invalide (format : …apps.googleusercontent.com).' };
  if (!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge) || !/^[a-f0-9]{48}$/.test(state)) return { ok: false, error: 'Paramètres PKCE invalides.' };
  if (!scopes.length || scopes.length > 10 || !scopes.every((scope) => /^https:\/\/www\.googleapis\.com\/auth\/[a-z0-9._-]+$/i.test(scope))) {
    return { ok: false, error: 'Scopes Google invalides.' };
  }
  if (googleAuthServer) return { ok: false, error: 'Une authentification Google est déjà en cours.' };

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (googleAuthTimer) clearTimeout(googleAuthTimer);
      googleAuthTimer = null;
      const activeServer = googleAuthServer;
      googleAuthServer = null;
      if (activeServer?.listening) activeServer.close();
      resolve(result);
    };
    const server = http.createServer((req, res) => {
      let callbackUrl;
      try {
        callbackUrl = new URL(req.url || '/', GOOGLE_REDIRECT_URI);
      } catch {
        res.writeHead(400);
        res.end('Requête OAuth invalide.');
        return;
      }
      if (callbackUrl.pathname !== '/google/callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      });
      res.end('<!doctype html><html lang="fr"><meta charset="utf-8"><title>Google connecté</title><body style="font:16px system-ui;max-width:560px;margin:12vh auto;padding:24px;color:#163"><h1>Retour à Jarvis</h1><p>Vous pouvez fermer cette page et revenir à l’application Jarvis PC.</p></body></html>');
      finish({
        ok: !callbackUrl.searchParams.get('error'),
        code: callbackUrl.searchParams.get('code') || '',
        state: callbackUrl.searchParams.get('state') || '',
        error: callbackUrl.searchParams.get('error') || '',
      });
    });
    googleAuthServer = server;
    server.once('error', (error) => {
      finish({ ok: false, error: error.code === 'EADDRINUSE' ? `Le port de retour Google ${GOOGLE_REDIRECT_PORT} est déjà utilisé.` : (error.message || 'Impossible de démarrer le retour OAuth local.') });
    });
    googleAuthTimer = setTimeout(() => finish({ ok: false, error: 'Délai de connexion Google dépassé.' }), 4 * 60 * 1000);
    server.listen(GOOGLE_REDIRECT_PORT, '127.0.0.1', async () => {
      const authorizeUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authorizeUrl.search = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: GOOGLE_REDIRECT_URI,
        scope: scopes.join(' '),
        state,
        code_challenge_method: 'S256',
        code_challenge: codeChallenge,
        access_type: 'offline',
        prompt: 'consent',
      }).toString();
      try {
        await shell.openExternal(authorizeUrl.toString());
      } catch (error) {
        finish({ ok: false, error: error.message || 'Impossible d’ouvrir la page Google.' });
      }
    });
  });
});

// Save generated document to Documents/Jarvis
ipcMain.handle('jarvis:save-document', async (_e, { fileName, base64, openAfter }) => {
  try {
    const docsDir = path.join(app.getPath('documents'), 'Jarvis');
    fs.mkdirSync(docsDir, { recursive: true });
    const safeName = path.basename(String(fileName || 'document_jarvis.txt'));
    const allowed = new Set(['.pdf', '.docx', '.xlsx', '.pptx', '.csv', '.md', '.txt']);
    if (!allowed.has(path.extname(safeName).toLowerCase())) {
      return { ok: false, message: 'Type de document non autorisé.' };
    }
    // Never overwrite an existing document: add a numeric suffix instead.
    const parsedName = path.parse(safeName);
    let fullPath = path.join(docsDir, safeName);
    for (let n = 2; fs.existsSync(fullPath) && n < 1000; n++) {
      fullPath = path.join(docsDir, `${parsedName.name}_${n}${parsedName.ext}`);
    }
    fs.writeFileSync(fullPath, Buffer.from(base64, 'base64'));
    if (openAfter) {
      await shell.openPath(fullPath);
    }
    return { ok: true, path: fullPath };
  } catch (e) {
    return { ok: false, message: e.message || String(e) };
  }
});

// CORS-free HTTP fetch from Electron main process
ipcMain.handle('jarvis:http-fetch', async (_e, { url, method = 'GET', headers = {}, body = null, timeoutMs = 15000 }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { 'User-Agent': 'Jarvis-PC/2.0', ...headers },
      body: method !== 'GET' && method !== 'HEAD' ? body : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (e) {
    return { ok: false, status: 0, error: e.message || String(e), text: '' };
  } finally {
    clearTimeout(timer);
  }
});

// Spotify Authorization Code + PKCE callback: loopback only, no client secret is used.
ipcMain.handle('jarvis:spotify-authorize', async (_e, input = {}) => {
  const clientId = String(input.clientId || '').trim();
  const codeChallenge = String(input.codeChallenge || '').trim();
  const state = String(input.state || '').trim();
  const scope = String(input.scope || '').trim();
  if (!/^[A-Za-z0-9_-]{10,128}$/.test(clientId)) return { ok: false, error: 'Client ID Spotify invalide.' };
  if (!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge) || !/^[a-f0-9]{48}$/.test(state)) {
    return { ok: false, error: 'Paramètres PKCE invalides.' };
  }
  if (!scope || scope.length > 1000 || !/^[a-z0-9_ -]+$/i.test(scope)) {
    return { ok: false, error: 'Scopes Spotify invalides.' };
  }
  if (spotifyAuthServer) return { ok: false, error: 'Une authentification Spotify est déjà en cours.' };

  return new Promise((resolve) => {
    let settled = false;
    const redirectUri = 'http://127.0.0.1:43821/spotify/callback';
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (spotifyAuthTimer) clearTimeout(spotifyAuthTimer);
      spotifyAuthTimer = null;
      const activeServer = spotifyAuthServer;
      spotifyAuthServer = null;
      if (activeServer?.listening) activeServer.close();
      resolve(result);
    };

    const server = http.createServer((req, res) => {
      let callbackUrl;
      try {
        callbackUrl = new URL(req.url || '/', redirectUri);
      } catch {
        res.writeHead(400);
        res.end('Requête OAuth invalide.');
        return;
      }
      if (callbackUrl.pathname !== '/spotify/callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      });
      res.end('<!doctype html><html lang="fr"><meta charset="utf-8"><title>Spotify connecté</title><body style="font:16px system-ui;max-width:560px;margin:12vh auto;padding:24px;color:#163"><h1>Retour à Jarvis</h1><p>Vous pouvez fermer cette page et revenir à l’application Jarvis PC.</p></body></html>');
      finish({
        ok: !callbackUrl.searchParams.get('error'),
        code: callbackUrl.searchParams.get('code') || '',
        state: callbackUrl.searchParams.get('state') || '',
        error: callbackUrl.searchParams.get('error') || '',
      });
    });
    spotifyAuthServer = server;
    server.once('error', (error) => {
      finish({ ok: false, error: error.code === 'EADDRINUSE' ? 'Le port de retour Spotify 43821 est déjà utilisé.' : (error.message || 'Impossible de démarrer le retour OAuth local.') });
    });
    spotifyAuthTimer = setTimeout(() => finish({ ok: false, error: 'Délai de connexion Spotify dépassé.' }), 4 * 60 * 1000);
    server.listen(43821, '127.0.0.1', async () => {
      const authorizeUrl = new URL('https://accounts.spotify.com/authorize');
      authorizeUrl.search = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope,
        state,
        code_challenge_method: 'S256',
        code_challenge: codeChallenge,
      }).toString();
      try {
        await shell.openExternal(authorizeUrl.toString());
      } catch (error) {
        finish({ ok: false, error: error.message || 'Impossible d’ouvrir la page Spotify.' });
      }
    });
  });
});
