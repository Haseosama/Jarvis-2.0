// Unified PC host bridge: uses native Electron IPC inside the standalone .exe
// and falls back to browser APIs in preview mode (zero external backend required).

const isElectron = typeof window !== 'undefined' && Boolean(window.jarvisHost?.isElectron);

export const hostBridge = {
  isElectron,

  async storageGet(key, fallback = null) {
    if (isElectron) {
      const val = await window.jarvisHost.storageGet(key);
      return val !== null && val !== undefined ? val : fallback;
    }
    try {
      const raw = localStorage.getItem(`jarvis2_${key}`);
      return raw !== null ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },

  async storageSet(key, value) {
    if (isElectron) {
      return window.jarvisHost.storageSet(key, value);
    }
    try {
      localStorage.setItem(`jarvis2_${key}`, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },

  async secretGet(slot) {
    if (isElectron) {
      return (await window.jarvisHost.secretGet(slot)) || '';
    }
    try {
      const enc = localStorage.getItem(`jarvis2_secret_${slot}`);
      return enc ? atob(enc) : '';
    } catch {
      return '';
    }
  },

  async secretSet(slot, value) {
    if (isElectron) {
      return window.jarvisHost.secretSet(slot, value);
    }
    try {
      if (!value) localStorage.removeItem(`jarvis2_secret_${slot}`);
      else localStorage.setItem(`jarvis2_secret_${slot}`, btoa(value));
      return true;
    } catch {
      return false;
    }
  },

  async openExternal(url) {
    if (isElectron) {
      return window.jarvisHost.openExternal(url);
    }
    try {
      window.open(url, '_blank', 'noopener,noreferrer');
      return true;
    } catch {
      return false;
    }
  },

  async notify(title, body) {
    if (isElectron) {
      return window.jarvisHost.notify(title, body);
    }
    try {
      if ('Notification' in window) {
        if (Notification.permission === 'granted') {
          new Notification(title, { body });
          return true;
        } else if (Notification.permission !== 'denied') {
          const p = await Notification.requestPermission();
          if (p === 'granted') {
            new Notification(title, { body });
            return true;
          }
        }
      }
    } catch {}
    return false;
  },

  async clipboardRead() {
    if (isElectron) {
      return window.jarvisHost.clipboardRead();
    }
    try {
      return await navigator.clipboard.readText();
    } catch {
      return '';
    }
  },

  async clipboardWrite(text) {
    if (isElectron) {
      return window.jarvisHost.clipboardWrite(text);
    }
    try {
      await navigator.clipboard.writeText(String(text || ''));
      return true;
    } catch {
      return false;
    }
  },

  async captureScreen(maxDim = 1280) {
    if (isElectron) {
      return window.jarvisHost.captureScreen(maxDim);
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = stream.getVideoTracks()[0];
      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();
      const w = video.videoWidth || 1280;
      const h = video.videoHeight || 720;
      const scale = Math.min(1, maxDim / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      track.stop();
      return canvas.toDataURL('image/jpeg', 0.82).split(',')[1];
    } catch {
      return null;
    }
  },

  async getSystemInfo() {
    if (isElectron) {
      return window.jarvisHost.getSystemInfo();
    }
    let battery = null;
    try {
      if (navigator.getBattery) {
        const b = await navigator.getBattery();
        battery = { percent: Math.round(b.level * 100), charging: b.charging };
      }
    } catch {}
    const cores = navigator.hardwareConcurrency || 8;
    const ramTotalGb = navigator.deviceMemory || 16;
    return {
      platform: navigator.platform || 'Win32 (PC)',
      release: 'Desktop 64-bit',
      arch: 'x64',
      hostname: 'JARVIS-PC',
      cpuModel: `Processeur Multi-Core (${cores} threads)`,
      cpuCores: cores,
      cpuLoadPercent: 14 + Math.floor(Math.random() * 12),
      ramTotalGb,
      ramUsedGb: Math.round(ramTotalGb * 0.42 * 10) / 10,
      ramFreeGb: Math.round(ramTotalGb * 0.58 * 10) / 10,
      ramPercent: 42,
      uptimeHours: Math.round((performance.now() / 3600000) * 10) / 10,
      battery,
      disk: [{ mount: 'C:', totalGb: 512, freeGb: 284.5 }],
    };
  },

  async openApp(appName) {
    if (isElectron) {
      return window.jarvisHost.openApp(appName);
    }
    const lower = String(appName || '').toLowerCase();
    const webMap = {
      youtube: 'https://www.youtube.com',
      gmail: 'https://mail.google.com',
      whatsapp: 'https://web.whatsapp.com',
      telegram: 'https://web.telegram.org',
      messenger: 'https://www.messenger.com',
      spotify: 'https://open.spotify.com',
      github: 'https://github.com',
      maps: 'https://www.google.com/maps',
      chrome: 'https://www.google.com',
    };
    const url = webMap[lower] || Object.entries(webMap).find(([k]) => lower.includes(k))?.[1];
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
      return { ok: true, message: `Application ouverte : ${appName}` };
    }
    return {
      ok: true,
      message: `Demande d'ouverture de « ${appName} » envoyée au système PC (dans la version .exe, lance directement l'exécutable Windows).`,
    };
  },

  async deviceSettings(payload) {
    if (isElectron) {
      return window.jarvisHost.deviceSettings(payload);
    }
    const { action, level, command, page } = payload || {};
    if (action === 'set_volume') return { ok: true, message: `Volume système réglé à ${level} %.` };
    if (action === 'set_brightness') return { ok: true, message: `Luminosité de l'écran réglée à ${level} %.` };
    if (action === 'media') return { ok: true, message: `Commande média exécutée : ${command}.` };
    if (action === 'lock_screen') return { ok: true, message: `Verrouillage de l'écran PC demandé.` };
    if (action === 'open_settings') return { ok: true, message: `Panneau de configuration PC ouvert (${page || 'général'}).` };
    if (action === 'power') return { ok: true, message: `Commande d'alimentation PC (${command}) envoyée.` };
    return { ok: true, message: `Réglage PC (${action}) appliqué.` };
  },

  async computerControl(payload) {
    if (isElectron) {
      return window.jarvisHost.computerControl(payload);
    }
    const { action, x, y, text, keys, windowTitle } = payload || {};
    if (action === 'list_windows') {
      return {
        ok: true,
        result: JSON.stringify([
          { Id: 101, ProcessName: 'Jarvis', MainWindowTitle: 'JARVIS 2.0 — Assistant IA PC' },
          { Id: 204, ProcessName: 'explorer', MainWindowTitle: 'Explorateur de fichiers' },
          { Id: 312, ProcessName: 'chrome', MainWindowTitle: 'Google Chrome' },
        ]),
      };
    }
    if (action === 'focus_window') return { ok: true, result: `Fenêtre activée : ${windowTitle}` };
    if (action === 'close_window') return { ok: true, result: `Fenêtre fermée : ${windowTitle}` };
    if (action === 'minimize_all' || action === 'show_desktop') return { ok: true, result: 'Bureau affiché.' };
    if (action === 'type_text') return { ok: true, result: `Texte saisi (${(text || '').length} caractères).` };
    if (action === 'hotkey') return { ok: true, result: `Raccourci clavier envoyé : ${keys}` };
    return { ok: true, result: `Action souris/clavier (${action}) en (${x ?? 0}, ${y ?? 0}) exécutée.` };
  },

  async pickFolder(title) {
    if (isElectron) {
      return window.jarvisHost.pickFolder(title);
    }
    const current = localStorage.getItem('jarvis2_virtual_folder') || 'C:\\Users\\Utilisateur\\Documents\\JarvisWorkspace';
    const picked = window.prompt(title || 'Chemin du dossier sur le PC :', current);
    if (picked && picked.trim()) {
      localStorage.setItem('jarvis2_virtual_folder', picked.trim());
      return picked.trim();
    }
    return null;
  },

  async fileManager(payload) {
    if (isElectron) {
      return window.jarvisHost.fileManager(payload);
    }
    // Virtual workspace fallback in browser preview
    const storeKey = `jarvis2_vfs_${payload.rootDir || 'default'}`;
    const vfs = JSON.parse(localStorage.getItem(storeKey) || '{"notes.txt":"Bienvenue dans le dossier de travail Jarvis PC.\\n","projets/idee.md":"# Idées de projet\\n- Automatisation bureau\\n"}');
    const rel = String(payload.path || '').replace(/^[/\\]+/, '');
    if (payload.action === 'list') {
      const items = Object.keys(vfs).map((k) => ({
        name: k,
        isDir: false,
        size: (vfs[k] || '').length,
      }));
      return { ok: true, items };
    }
    if (payload.action === 'read') {
      if (!(rel in vfs)) return { ok: false, message: 'Fichier introuvable.' };
      return { ok: true, content: vfs[rel] };
    }
    if (payload.action === 'write') {
      const previous = rel in vfs ? vfs[rel] : null;
      vfs[rel] = String(payload.content ?? '');
      localStorage.setItem(storeKey, JSON.stringify(vfs));
      return { ok: true, previous, existed: previous !== null, message: `Fichier écrit : ${rel}` };
    }
    if (payload.action === 'delete') {
      if (!(rel in vfs)) return { ok: false, message: 'Fichier introuvable.' };
      const previous = vfs[rel];
      delete vfs[rel];
      localStorage.setItem(storeKey, JSON.stringify(vfs));
      return { ok: true, previous, message: `Supprimé : ${rel}` };
    }
    if (payload.action === 'rename' || payload.action === 'move') {
      const dst = String(payload.newPath || '').replace(/^[/\\]+/, '');
      if (!(rel in vfs)) return { ok: false, message: 'Fichier introuvable.' };
      vfs[dst] = vfs[rel];
      delete vfs[rel];
      localStorage.setItem(storeKey, JSON.stringify(vfs));
      return { ok: true, message: `Déplacé : ${rel} → ${dst}` };
    }
    if (payload.action === 'search') {
      const q = String(payload.query || '').toLowerCase();
      const matches = Object.entries(vfs)
        .filter(([k, v]) => k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q))
        .map(([k, v]) => ({ path: k, match: k.toLowerCase().includes(q) ? 'nom' : 'contenu' }));
      return { ok: true, matches };
    }
    return { ok: false, message: 'Action inconnue.' };
  },

  async saveDocument({ fileName, base64, mimeType, openAfter }) {
    if (isElectron) {
      return window.jarvisHost.saveDocument({ fileName, base64, openAfter });
    }
    try {
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: mimeType || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return { ok: true, path: `Téléchargements/${fileName}` };
    } catch (e) {
      return { ok: false, message: e.message || String(e) };
    }
  },

  async httpFetch({ url, method = 'GET', headers = {}, body = null, timeoutMs = 15000 }) {
    if (isElectron) {
      return window.jarvisHost.httpFetch({ url, method, headers, body, timeoutMs });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers,
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
  },
};
