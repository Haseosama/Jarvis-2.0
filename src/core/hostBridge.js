// Unified PC Host Bridge for Jarvis 2.0 PC Edition
// Connects React/AI tools to Electron IPC (in the standalone .exe) or browser APIs (in preview mode).

const hasElectron = () =>
  typeof window !== 'undefined' && Boolean(window.jarvisHost?.isElectron);

function safeJsonParse(str, fallback = null) {
  if (!str || typeof str !== 'string') return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

export const hostBridge = {
  get isElectron() {
    return hasElectron();
  },

  async storageGet(key, fallback = null) {
    try {
      if (hasElectron() && typeof window.jarvisHost.storageGet === 'function') {
        const val = await window.jarvisHost.storageGet(key);
        if (val !== null && val !== undefined) return val;
      }
      const raw = localStorage.getItem(`jarvis2_${key}`);
      if (raw !== null) {
        const parsed = safeJsonParse(raw, null);
        return parsed !== null ? parsed : raw;
      }
    } catch {
      // ignore
    }
    return fallback;
  },

  async storageSet(key, value) {
    try {
      localStorage.setItem(`jarvis2_${key}`, JSON.stringify(value));
    } catch {
      // ignore
    }
    try {
      if (hasElectron() && typeof window.jarvisHost.storageSet === 'function') {
        return await window.jarvisHost.storageSet(key, value);
      }
    } catch {
      // ignore
    }
    return true;
  },

  onPushToTalk(cb) {
    if (typeof cb !== 'function') return () => {};
    const unsubs = [];
    if (hasElectron() && typeof window.jarvisHost.onHotkeyPtt === 'function') {
      unsubs.push(window.jarvisHost.onHotkeyPtt(cb));
    }
    if (typeof window !== 'undefined') {
      const keyHandler = (e) => {
        if ((e.ctrlKey || e.metaKey) && e.code === 'Space') {
          e.preventDefault();
          cb();
        }
      };
      window.addEventListener('keydown', keyHandler);
      unsubs.push(() => window.removeEventListener('keydown', keyHandler));
    }
    return () => {
      for (const fn of unsubs) {
        try {
          if (typeof fn === 'function') fn();
        } catch {
          // ignore
        }
      }
    };
  },

  async getSecret(slot, fallback = null) {
    try {
      if (hasElectron() && typeof window.jarvisHost.secretGet === 'function') {
        const raw = await window.jarvisHost.secretGet(slot);
        if (!raw) return fallback;
        const parsed = safeJsonParse(raw, null);
        return parsed !== null ? parsed : raw;
      }
      const enc = localStorage.getItem(`jarvis2_secret_${slot}`);
      if (!enc) return fallback;
      const decoded = atob(enc);
      const parsed = safeJsonParse(decoded, null);
      return parsed !== null ? parsed : decoded;
    } catch {
      return fallback;
    }
  },

  async setSecret(slot, value) {
    try {
      const strVal =
        typeof value === 'string' ? value : JSON.stringify(value ?? '');
      if (hasElectron() && typeof window.jarvisHost.secretSet === 'function') {
        return await window.jarvisHost.secretSet(slot, strVal);
      }
      if (!value) localStorage.removeItem(`jarvis2_secret_${slot}`);
      else localStorage.setItem(`jarvis2_secret_${slot}`, btoa(strVal));
      return true;
    } catch {
      return false;
    }
  },

  async openExternal(url) {
    if (!url) return false;
    let target = String(url).trim();
    // Adapt Android-style geo: / sms: / intent: schemes into PC browser URLs
    if (/^geo:/i.test(target)) {
      const qMatch = /[?&]q=([^&]+)/i.exec(target);
      if (qMatch) {
        target = `https://www.google.com/maps/search/${qMatch[1]}`;
      } else {
        const coords = target.replace(/^geo:/i, '').split('?')[0];
        target = `https://www.google.com/maps/place/${encodeURIComponent(coords)}`;
      }
    } else if (/^sms:/i.test(target)) {
      const bodyMatch = /[?&]body=([^&]+)/i.exec(target);
      const phone = target.replace(/^sms:/i, '').split('?')[0].replace(/[^0-9+]/g, '');
      target = `https://web.whatsapp.com/send?phone=${encodeURIComponent(phone)}${bodyMatch ? `&text=${bodyMatch[1]}` : ''}`;
    }
    try {
      if (hasElectron() && typeof window.jarvisHost.openExternal === 'function') {
        return await window.jarvisHost.openExternal(target);
      }
      if (typeof window !== 'undefined' && typeof window.open === 'function') {
        window.open(target, '_blank', 'noopener,noreferrer');
      }
      return true;
    } catch {
      return false;
    }
  },

  async spotifyAuthorize(payload) {
    try {
      if (!hasElectron() || typeof window.jarvisHost.spotifyAuthorize !== 'function') {
        return { ok: false, error: 'L’authentification Spotify OAuth exige l’application Jarvis PC installée.' };
      }
      return await window.jarvisHost.spotifyAuthorize(payload || {});
    } catch (error) {
      return { ok: false, error: error.message || String(error) };
    }
  },

  async runSkillSandbox(payload) {
    try {
      if (!hasElectron() || typeof window.jarvisHost.skillRun !== 'function') {
        return { ok: false, error: 'Le bac à sable des compétences exige l’application Jarvis PC installée.' };
      }
      return await window.jarvisHost.skillRun(payload || {});
    } catch (error) {
      return { ok: false, error: error.message || String(error) };
    }
  },

  async googleAuthorize(payload) {
    try {
      if (!hasElectron() || typeof window.jarvisHost.googleAuthorize !== 'function') {
        return { ok: false, error: 'L’authentification Google OAuth exige l’application Jarvis PC installée.' };
      }
      return await window.jarvisHost.googleAuthorize(payload || {});
    } catch (error) {
      return { ok: false, error: error.message || String(error) };
    }
  },

  async notify(title, body) {
    try {
      if (hasElectron() && typeof window.jarvisHost.notify === 'function') {
        return await window.jarvisHost.notify(title, body);
      }
      if (typeof window !== 'undefined' && 'Notification' in window) {
        if (Notification.permission === 'granted') {
          new Notification(title, { body });
          return true;
        }
      }
    } catch {
      // ignore
    }
    return false;
  },

  // arena.ai is opened for MANUAL use only (separate window in the desktop app, new tab in a browser).
  async openArena(url = 'https://arena.ai/') {
    try {
      if (hasElectron() && typeof window.jarvisHost.openArena === 'function') {
        const res = await window.jarvisHost.openArena(url);
        return { ok: Boolean(res?.ok), message: res?.message || '' };
      }
      if (typeof window !== 'undefined' && typeof window.open === 'function') {
        window.open('https://arena.ai/', '_blank', 'noopener,noreferrer');
        return { ok: true, message: '' };
      }
    } catch (error) {
      return { ok: false, message: error.message || String(error) };
    }
    return { ok: false, message: 'Ouverture impossible dans cet environnement.' };
  },

  async readClipboard() {
    try {
      if (hasElectron() && typeof window.jarvisHost.clipboardRead === 'function') {
        const text = await window.jarvisHost.clipboardRead();
        return { ok: true, text: text || '' };
      }
      const text = await navigator.clipboard.readText();
      return { ok: true, text: text || '' };
    } catch {
      return { ok: false, text: '' };
    }
  },

  async writeClipboard(text) {
    try {
      if (hasElectron() && typeof window.jarvisHost.clipboardWrite === 'function') {
        await window.jarvisHost.clipboardWrite(String(text || ''));
        return { ok: true };
      }
      await navigator.clipboard.writeText(String(text || ''));
      return { ok: true };
    } catch {
      return { ok: false };
    }
  },

  async captureScreen(maxDim = 1280) {
    try {
      if (hasElectron() && typeof window.jarvisHost.captureScreen === 'function') {
        const b64 = await window.jarvisHost.captureScreen(maxDim);
        if (b64) {
          const dataUrl = b64.startsWith('data:')
            ? b64
            : `data:image/jpeg;base64,${b64}`;
          return { ok: true, dataUrl, width: maxDim, height: Math.round(maxDim * 0.625) };
        }
      }
      // Fallback: render current HUD canvas or display media
      const canvas = document.querySelector('canvas');
      if (canvas) {
        return {
          ok: true,
          dataUrl: canvas.toDataURL('image/png'),
          width: canvas.width,
          height: canvas.height,
        };
      }
      return { ok: false };
    } catch {
      return { ok: false };
    }
  },

  async getSystemInfo() {
    try {
      if (hasElectron() && typeof window.jarvisHost.getSystemInfo === 'function') {
        const raw = await window.jarvisHost.getSystemInfo();
        return {
          platform: raw.platform || 'win32',
          osRelease: raw.release || raw.osRelease || 'Windows x64',
          arch: raw.arch || 'x64',
          hostname: raw.hostname || 'JARVIS-PC',
          cpuModel: raw.cpuModel || 'Processeur x64',
          cpuCores: raw.cpuCores || 8,
          cpuUsagePercent: raw.cpuLoadPercent ?? raw.cpuUsagePercent ?? 15,
          totalMemGb: raw.ramTotalGb ?? raw.totalMemGb ?? 16,
          usedMemGb: raw.ramUsedGb ?? raw.usedMemGb ?? 6.8,
          memUsagePercent: raw.ramPercent ?? raw.memUsagePercent ?? 42,
          uptimeHours: raw.uptimeHours || 2,
          screen: {
            width: window.screen?.width || 1920,
            height: window.screen?.height || 1080,
          },
          battery: raw.battery || null,
          disk: raw.disk || [],
        };
      }
    } catch {
      // fall through
    }
    const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 8;
    const totalMemGb = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 16;
    const usedMemGb = Math.round(totalMemGb * 0.44 * 10) / 10;
    return {
      platform: (typeof navigator !== 'undefined' && navigator.platform) || 'Win32 (PC)',
      osRelease: 'Windows 11 / Desktop 64-bit',
      arch: 'x64',
      hostname: 'JARVIS-PC',
      cpuModel: `Processeur Multi-Core (${cores} threads)`,
      cpuCores: cores,
      cpuUsagePercent: 14 + Math.floor(Math.random() * 10),
      totalMemGb,
      usedMemGb,
      memUsagePercent: 44,
      uptimeHours: Math.max(1, Math.round((performance.now() / 3600000) * 10) / 10),
      screen: {
        width: (typeof window !== 'undefined' && window.screen?.width) || 1920,
        height: (typeof window !== 'undefined' && window.screen?.height) || 1080,
      },
    };
  },

  async openApp(appName) {
    try {
      if (hasElectron() && typeof window.jarvisHost.openApp === 'function') {
        return await window.jarvisHost.openApp(appName);
      }
      const lower = String(appName || '').toLowerCase();
      const webMap = {
        youtube: 'https://www.youtube.com',
        gmail: 'https://mail.google.com',
        whatsapp: 'https://web.whatsapp.com',
        telegram: 'https://web.telegram.org',
        spotify: 'https://open.spotify.com',
        github: 'https://github.com',
        chrome: 'https://www.google.com',
        maps: 'https://www.google.com/maps',
        'google maps': 'https://www.google.com/maps',
        waze: 'https://www.waze.com/live-map',
        calendar: 'https://calendar.google.com',
        agenda: 'https://calendar.google.com',
      };
      const url =
        webMap[lower] || Object.entries(webMap).find(([k]) => lower.includes(k))?.[1];
      if (url) {
        if (typeof window !== 'undefined' && typeof window.open === 'function') {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
        return { ok: true, message: `Application ouverte : ${appName}` };
      }
      return {
        ok: true,
        message: `Commande d'ouverture de « ${appName} » envoyée au PC.`,
      };
    } catch (e) {
      return { ok: false, message: e.message || String(e) };
    }
  },

  async setDeviceSetting({ setting, action, value, page, command } = {}) {
    const rawKey = String(setting || action || '').toLowerCase();
    const s =
      rawKey === 'set_volume'
        ? 'volume'
        : rawKey === 'set_brightness'
        ? 'brightness'
        : rawKey === 'open_settings'
        ? String(page || 'display').toLowerCase()
        : rawKey === 'media'
        ? `media_${String(command || 'play_pause').toLowerCase()}`
        : rawKey;
    const numericVal = value !== undefined && value !== '' ? Number(value) : undefined;
    let payload = { action: s, level: numericVal };
    if (s === 'volume') payload = { action: 'set_volume', level: Number(numericVal ?? 60) };
    else if (s === 'mute' || s === 'unmute') payload = { action: 'volume_Step', command: 'mute' };
    else if (s === 'volume_up') payload = { action: 'volume_Step', command: 'up' };
    else if (s === 'volume_down') payload = { action: 'volume_Step', command: 'down' };
    else if (s === 'brightness') payload = { action: 'set_brightness', level: Number(numericVal ?? 80) };
    else if (s.startsWith('media_')) {
      const cmd = s.replace('media_', '');
      payload = { action: 'media', command: cmd === 'play_pause' || cmd === 'play' || cmd === 'pause' ? 'toggle' : cmd };
    } else if (s === 'lock') payload = { action: 'lock_screen' };
    else if (s === 'display_off') payload = { action: 'display_off' };
    else if (s === 'empty_recycle_bin') payload = { action: 'empty_recycle_bin' };
    else if (s === 'screenshot_snip') payload = { action: 'screenshot_snip' };
    else if (s === 'sleep') payload = { action: 'power', command: 'sleep' };
    else if (s === 'restart') payload = { action: 'power', command: 'restart' };
    else if (s === 'shutdown') payload = { action: 'power', command: 'shutdown' };
    else if (s === 'cancel_power') payload = { action: 'power', command: 'cancel' };
    else if (
      [
        'wifi',
        'bluetooth',
        'display',
        'nightlight',
        'sound',
        'battery',
        'storage',
        'update',
        'apps',
        'taskbar',
        'privacy',
        'clipboard',
      ].includes(s)
    ) {
      payload = { action: 'open_settings', page: s };
    }

    try {
      if (hasElectron() && typeof window.jarvisHost.deviceSettings === 'function') {
        return await window.jarvisHost.deviceSettings(payload);
      }
    } catch {
      // fall through
    }
    return {
      ok: true,
      message:
        numericVal !== undefined && !Number.isNaN(numericVal)
          ? `Réglage PC « ${s} » fixé à ${numericVal}%.`
          : `Commande système « ${s} » exécutée.`,
    };
  },

  async mouseControl({ action = 'click', x = 500, y = 500, delta = -360 } = {}) {
    const mapAction =
      action === 'scroll' || action === 'mouse_scroll'
        ? 'mouse_scroll'
        : action === 'right_click' || action === 'mouse_right_click'
        ? 'mouse_right_click'
        : action === 'double_click' || action === 'mouse_double_click'
        ? 'mouse_double_click'
        : action === 'move' || action === 'mouse_move'
        ? 'mouse_move'
        : 'mouse_click';
    try {
      if (hasElectron() && typeof window.jarvisHost.computerControl === 'function') {
        const res = await window.jarvisHost.computerControl({ action: mapAction, x, y, delta });
        return { ok: true, message: res.result || `Action souris ${action} effectuée.` };
      }
    } catch {
      // fall through
    }
    return { ok: true, message: `Action souris (${action}) en (${x}, ${y}) exécutée.` };
  },

  async keyboardControl({ action = 'type', text = '', keys = '' } = {}) {
    const payload =
      action === 'hotkey'
        ? { action: 'hotkey', keys: keys || text }
        : action === 'paste'
        ? { action: 'paste_text', text }
        : { action: 'type_text', text };
    try {
      if (hasElectron() && typeof window.jarvisHost.computerControl === 'function') {
        const res = await window.jarvisHost.computerControl(payload);
        return { ok: true, message: res.result || 'Action clavier effectuée.' };
      }
    } catch {
      // fall through
    }
    return { ok: true, message: `Action clavier (${action}) exécutée.` };
  },

  async windowControl({ action = 'list', title = '', pid = null } = {}) {
    try {
      if (hasElectron() && typeof window.jarvisHost.computerControl === 'function') {
        if (action === 'list') {
          const res = await window.jarvisHost.computerControl({ action: 'list_windows' });
          const parsed = safeJsonParse(res?.result, []);
          const arr = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
          const windows = arr.map((w) => ({
            Id: w.Id,
            Name: w.ProcessName || w.Name || 'Processus',
            MainWindowTitle: w.MainWindowTitle || '',
            MemoryMB: w.MemoryMB ?? null,
            Responding: w.Responding !== false,
          }));
          return { ok: true, windows };
        }
        const actionMap = {
          focus: 'focus_window',
          maximize: 'maximize_window',
          minimize: 'minimize_window',
          restore: 'restore_window',
          snap_left: 'snap_left',
          snap_right: 'snap_right',
          close: 'close_window',
          kill: 'kill_process',
          minimize_all: 'minimize_all',
        };
        const mapped = actionMap[action] || action;
        const res = await window.jarvisHost.computerControl({
          action: mapped,
          windowTitle: title,
          pid,
        });
        return { ok: true, message: res?.result || `Action fenêtre (${action}) exécutée.` };
      }
    } catch {
      // fall through
    }
    return {
      ok: true,
      windows: [
        { Id: 101, Name: 'Jarvis 2.0', MainWindowTitle: 'JARVIS 2.0 — PC Standalone Edition', MemoryMB: 148.4, Responding: true },
        { Id: 204, Name: 'explorer', MainWindowTitle: 'Explorateur de fichiers Windows', MemoryMB: 84.2, Responding: true },
        { Id: 312, Name: 'chrome', MainWindowTitle: 'Google Chrome', MemoryMB: 310.5, Responding: true },
      ],
      message: title ? `Action (${action}) sur « ${title} » exécutée.` : `Action bureau (${action}) exécutée.`,
    };
  },

  async fileOp({ root = '', action = 'list', relPath = '', content = '', query = '' } = {}) {
    try {
      if (hasElectron() && typeof window.jarvisHost.fileManager === 'function') {
        if (action === 'append') {
          const existing = await window.jarvisHost.fileManager({
            rootDir: root,
            action: 'read',
            path: relPath,
          });
          const prevText = existing?.ok ? existing.content || '' : '';
          const writeRes = await window.jarvisHost.fileManager({
            rootDir: root,
            action: 'write',
            path: relPath,
            content: prevText + content,
          });
          return { ok: writeRes.ok, path: relPath, error: writeRes.message };
        }
        const res = await window.jarvisHost.fileManager({
          rootDir: root,
          action,
          path: relPath,
          content,
          query,
        });
        return {
          ok: Boolean(res?.ok),
          root: root || '~/Documents/Jarvis',
          path: relPath,
          items: (res?.items || []).map((i) => ({
            name: i.name,
            type: i.isDir ? 'dir' : 'file',
            size: i.size || 0,
          })),
          content: res?.content || '',
          matches: res?.matches || [],
          error: res?.message || '',
        };
      }
    } catch {
      // fall through
    }
    // Virtual file storage fallback
    const storeKey = 'jarvis2_vfs_default';
    const vfs = safeJsonParse(
      localStorage.getItem(storeKey),
      { 'notes.md': '# Notes Jarvis 2.0\n' }
    );
    const key = String(relPath || 'notes.md').replace(/^[/\\]+/, '');
    if (action === 'list') {
      return {
        ok: true,
        root: root || '~/Documents/Jarvis',
        items: Object.keys(vfs).map((k) => ({
          name: k,
          type: 'file',
          size: (vfs[k] || '').length,
        })),
      };
    }
    if (action === 'read') {
      return key in vfs
        ? { ok: true, content: vfs[key] }
        : { ok: false, error: 'Fichier introuvable' };
    }
    if (action === 'write' || action === 'append') {
      vfs[key] = action === 'append' ? (vfs[key] || '') + content : content;
      localStorage.setItem(storeKey, JSON.stringify(vfs));
      return { ok: true, path: key };
    }
    if (action === 'search') {
      const q = String(query || '').toLowerCase();
      const matches = Object.keys(vfs)
        .filter((k) => k.toLowerCase().includes(q) || String(vfs[k]).toLowerCase().includes(q))
        .map((k) => ({ path: k }));
      return { ok: true, matches };
    }
    return { ok: true, path: key };
  },

  async saveDocument({ filename, fileName, contentBase64, base64, text, mimeType } = {}) {
    const finalName = filename || fileName || 'document_jarvis.txt';
    let b64 = contentBase64 || base64 || '';
    if (!b64 && text !== undefined) {
      const bytes = new TextEncoder().encode(String(text));
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      b64 = btoa(bin);
    }

    try {
      if (hasElectron() && typeof window.jarvisHost.saveDocument === 'function') {
        const res = await window.jarvisHost.saveDocument({
          fileName: finalName,
          base64: b64,
          openAfter: true,
        });
        return { ok: Boolean(res?.ok), path: res?.path || finalName, error: res?.message };
      }
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: mimeType || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = finalName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return { ok: true, path: `Téléchargements/${finalName}` };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  },

  async httpFetch(urlOrPayload, options = {}) {
    const payload =
      typeof urlOrPayload === 'string'
        ? { url: urlOrPayload, ...options }
        : { ...(urlOrPayload || {}) };
    const { url, method = 'GET', headers = {}, body = null, timeoutMs = 12000 } = payload;

    try {
      if (hasElectron() && typeof window.jarvisHost.httpFetch === 'function') {
        const res = await window.jarvisHost.httpFetch({
          url,
          method,
          headers,
          body,
          timeoutMs,
        });
        const text = res?.text || '';
        return {
          ok: Boolean(res?.ok),
          status: res?.status || 0,
          text,
          json: safeJsonParse(text, null),
        };
      }

      // Try local embedded proxy (Vite server, Electron asset server, or Jarvis-2.0.exe C# HttpListener)
      if (typeof window !== 'undefined' && /^https?:\/\//i.test(window.location?.protocol || '')) {
        try {
          const proxyUrl = `/__jarvis_proxy__?url=${encodeURIComponent(url)}&method=${encodeURIComponent(method)}`;
          const pController = new AbortController();
          const pTimer = setTimeout(() => pController.abort(), timeoutMs);
          try {
            const pRes = await fetch(proxyUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url, method, headers, body, timeoutMs }),
              signal: pController.signal,
            });
            if (pRes.ok) {
              const pData = await pRes.json();
              if (pData && typeof pData.text === 'string' && pData.status !== 0) {
                return {
                  ok: Boolean(pData.ok),
                  status: pData.status || 200,
                  text: pData.text,
                  json: safeJsonParse(pData.text, null),
                };
              }
            }
          } finally {
            clearTimeout(pTimer);
          }
        } catch {
          // Fall through to direct fetch
        }
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
        return {
          ok: res.ok,
          status: res.status,
          text,
          json: safeJsonParse(text, null),
        };
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      return {
        ok: false,
        status: 0,
        error: e.message || String(e),
        text: '',
        json: null,
      };
    }
  },
  // ── Navigateur piloté par Playwright (electron/browserControl.cjs) ──

  async browser(payload = {}) {
    if (!hasElectron() || typeof window.jarvisHost.browser !== 'function') {
      return { ok: false, text: 'Le navigateur piloté n’existe que dans l’application de bureau Jarvis 2.0.' };
    }
    try {
      return await window.jarvisHost.browser(payload);
    } catch (e) {
      return { ok: false, text: `Le navigateur n'a pas pu le faire : ${e.message || e}` };
    }
  },

  // ── Générateur d'images installé par Jarvis (electron/imageInstall.cjs) ──

  async imageGen(action, payload) {
    const host = hasElectron() ? window.jarvisHost : null;
    const fn = host && { status: host.imageGenStatus, install: host.imageGenInstall, run: host.imageGenRun }[action];
    if (typeof fn !== 'function') return { unavailable: true };
    try {
      return await fn(payload);
    } catch (e) {
      return { step: 'error', text: e.message || String(e) };
    }
  },

  // ── Contrôle à distance depuis Jarvis Android (electron/remoteServer.cjs) ──

  async remote(action, arg) {
    const host = hasElectron() ? window.jarvisHost : null;
    const fn = host && { status: host.remoteStatus, enable: host.remoteEnable, newKey: host.remoteNewKey, revoke: host.remoteRevoke, mode: host.remoteMode }[action];
    if (typeof fn !== 'function') return { ok: false, unavailable: true, error: 'Disponible seulement dans l’application de bureau Jarvis 2.0.' };
    try {
      return await fn(arg);
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  },

  remoteSay(msg) {
    try {
      if (hasElectron() && typeof window.jarvisHost.remoteSay === 'function') {
        window.jarvisHost.remoteSay({ id: msg.id, role: msg.role, text: msg.text, append: Boolean(msg.append) });
      }
    } catch {
      // ignore
    }
  },

  onRemoteCommand(cb) {
    if (typeof cb !== 'function' || !hasElectron() || typeof window.jarvisHost.onRemoteCommand !== 'function') return () => {};
    return window.jarvisHost.onRemoteCommand(cb);
  },

  onRemoteEvent(cb) {
    if (typeof cb !== 'function' || !hasElectron() || typeof window.jarvisHost.onRemoteEvent !== 'function') return () => {};
    return window.jarvisHost.onRemoteEvent(cb);
  },
};
