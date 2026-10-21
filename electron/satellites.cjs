'use strict';
// Satellites audio (ESP32-S3, par exemple la Waveshare ESP32-S3-AUDIO-Board) : micro et haut-parleur dans une autre pièce.
//
// Protocole version 1 de Cornelius (lfpoulain/Cornelius, docs/developpement/satellites-protocole.md, PolyForm Noncommercial 1.0.0),
// réimplémenté ici côté serveur pour Jarvis. Un satellite ne parle qu'à Jarvis, jamais à un service tiers : le son reste sur le PC,
// qui le transcrit puis répond (voir src/core/SatelliteBridge.js).
//
// Ce module ne décide de rien : il transporte (WSS + jeton, appairage), découpe la parole en phrases (détection d'énergie), cadence la
// voix de retour en temps réel (silences compris) et arbitre « une seule conversation dans la maison ». Le moteur reçoit chaque phrase
// par `onUtterance` et répond { wake?, reply?, close?, unavailable? }.

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { makeSelfSignedCert, lanAddress, wsFrame, wsParse } = require('./remoteServer.cjs');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const PROTOCOL = 1;
const PORT = 3443;
const FRAME_BYTES = 2560; // 80 ms de PCM 16 bits mono 16 kHz
const OUT_CHUNK = 3200; // 100 ms
const HELLO_TIMEOUT_MS = 5000;
const PING_MS = 15000;
const SILENT_MS = 30000;
const MAX_PENDING = 8;
const DEFAULTS = { endSilenceMs: 20000, volume: 70, led: { color: '#00ffb4', brightness: 6, nightLight: false } };

// détection de parole
const VAD = { threshold: 600, hangFrames: 9, minVoicedFrames: 4, preRollFrames: 7, maxFrames: 190 };

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const safeEqual = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

function wsBinary(payload) {
  const n = payload.length;
  let head;
  if (n < 126) head = Buffer.from([0x82, n]);
  else if (n < 65536) { head = Buffer.alloc(4); head[0] = 0x82; head[1] = 126; head.writeUInt16BE(n, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x82; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
  return Buffer.concat([head, payload]);
}

/** Énergie efficace (RMS) d'une trame PCM 16 bits little-endian. */
function rmsS16(buf) {
  const n = buf.length >> 1;
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) { const s = buf.readInt16LE(i * 2); sum += s * s; }
  return Math.sqrt(sum / n);
}

/** Découpe la parole en phrases : renvoie un objet avec push(frame) → Buffer de phrase complète, ou null. */
function createSegmenter(opts = {}) {
  const o = { ...VAD, ...opts };
  let preRoll = [];
  let utter = null; // { frames, voiced, quiet }
  return {
    reset() { preRoll = []; utter = null; },
    push(frame) {
      const loud = rmsS16(frame) > o.threshold;
      if (!utter) {
        if (!loud) { preRoll.push(frame); if (preRoll.length > o.preRollFrames) preRoll.shift(); return null; }
        utter = { frames: [...preRoll, frame], voiced: 1, quiet: 0 };
        preRoll = [];
        return null;
      }
      utter.frames.push(frame);
      if (loud) { utter.voiced++; utter.quiet = 0; } else utter.quiet++;
      if (utter.quiet >= o.hangFrames || utter.frames.length >= o.maxFrames) {
        const done = utter;
        utter = null;
        return done.voiced >= o.minVoicedFrames ? Buffer.concat(done.frames) : null;
      }
      return null;
    },
  };
}

function createSatelliteServer({
  dataDir, onUtterance = async () => ({}), onEvent = () => {}, port = PORT, now = () => Date.now(), interfaces = () => os.networkInterfaces(),
  vad = {}, pingMs = PING_MS, silentMs = SILENT_MS, helloTimeoutMs = HELLO_TIMEOUT_MS, tickMs = 100,
} = {}) {
  const dir = path.join(dataDir, 'satellites');
  const file = path.join(dir, 'satellites.json');
  const conns = new Map(); // id → connexion
  const pending = new Map(); // device → { socket, device, firmware, since }
  const pendingSockets = new Set();
  let server = null;
  let active = null; // { id, lastActivity }
  let wakeAvailable = false;
  let sweeper = null;
  let c_timer = null;

  // ── stockage ──
  const read = () => {
    try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); return { satellites: d.satellites || [], settings: { enabled: false, endSilenceMs: DEFAULTS.endSilenceMs, ...(d.settings || {}) } }; } catch { return { satellites: [], settings: { enabled: false, endSilenceMs: DEFAULTS.endSilenceMs } }; }
  };
  const write = (d) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(d, null, 2), { encoding: 'utf8', mode: 0o600 }); };
  const update = (fn) => { const d = read(); fn(d); write(d); return d; };

  function certificate() {
    const keyPath = path.join(dir, 'satellites.key');
    const certPath = path.join(dir, 'satellites.crt');
    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) return { key: fs.readFileSync(keyPath, 'utf8'), cert: fs.readFileSync(certPath, 'utf8') };
    const ips = Object.values(interfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
    const pair = makeSelfSignedCert(ips);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(keyPath, pair.key, { encoding: 'utf8', mode: 0o600 });
    fs.writeFileSync(certPath, pair.cert, 'utf8');
    return pair;
  }

  /** Empreinte SHA-256 de la clé publique (SubjectPublicKeyInfo) : celle que le satellite épingle. */
  function keyFingerprint() {
    try {
      const x = new crypto.X509Certificate(certificate().cert);
      return crypto.createHash('sha256').update(x.publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
    } catch { return ''; }
  }

  // ── envoi ──
  const sendJson = (socket, obj) => { try { if (!socket.destroyed) socket.write(wsFrame(JSON.stringify(obj))); } catch { /* socket fermé */ } };
  const sendClose = (socket, code = 1008) => {
    try { const b = Buffer.alloc(2); b.writeUInt16BE(code); socket.end(Buffer.concat([Buffer.from([0x88, 2]), b])); } catch { /* déjà fermé */ }
  };

  function settingsOf(sat) {
    return { type: 'settings', volume: sat.volume ?? DEFAULTS.volume, led: sat.led || DEFAULTS.led, attentive: Boolean(sat.attentive) };
  }

  function refreshListen() {
    for (const c of conns.values()) {
      const enable = (wakeAvailable || c.session) && !c.muted && (!active || active.id === c.id);
      if (enable !== c.listening) { c.listening = enable; c.seg.reset(); sendJson(c.socket, { type: 'listen', enabled: enable }); }
    }
  }

  // ── conversation ──
  function openConversation(c) {
    active = { id: c.id, lastActivity: now() };
    sendJson(c.socket, { type: 'wake', score: 1 });
    sendJson(c.socket, { type: 'session', state: 'connecting' });
    refreshListen();
    c.session = true;
    c.queue = [];
    sendJson(c.socket, { type: 'session', state: 'ready' });
    onEvent({ type: 'conversation', id: c.id, state: 'open' });
  }

  function closeConversation(c, reason = 'closed') {
    if (!c.session) return;
    c.session = false;
    c.queue = [];
    if (active?.id === c.id) active = null;
    sendJson(c.socket, { type: 'session', state: 'closed' });
    refreshListen();
    onEvent({ type: 'conversation', id: c.id, state: reason });
  }

  function enqueueReply(c, pcm) {
    for (let i = 0; i < pcm.length; i += OUT_CHUNK) {
      const chunk = pcm.subarray(i, i + OUT_CHUNK);
      c.queue.push(chunk.length === OUT_CHUNK ? chunk : Buffer.concat([chunk, Buffer.alloc(OUT_CHUNK - chunk.length)]));
    }
  }

  /** Une phrase complète est arrivée du satellite. */
  async function handleUtterance(c, pcm) {
    c.processing = true;
    try {
      const result = (await onUtterance({ satelliteId: c.id, name: c.sat.name, pcm, conversation: c.session })) || {};
      if (result.unavailable) { if (!c.session) { wakeAvailable = false; refreshListen(); } return; }
      if (!c.session) {
        if (!result.wake) return;
        if (active && active.id !== c.id) { sendJson(c.socket, { type: 'busy' }); return; }
        openConversation(c);
      }
      if (active) active.lastActivity = now();
      if (result.reply && result.reply.length) enqueueReply(c, Buffer.from(result.reply));
      if (result.close) c.closeAfterReply = true;
    } catch (err) {
      onEvent({ type: 'error', id: c.id, message: String(err?.message || err) });
    } finally {
      c.processing = false;
    }
  }

  function onAudio(c, frame) {
    if (frame.length !== FRAME_BYTES) { sendClose(c.socket, 1008); return; }
    if (!c.listening || c.muted || c.processing) return;
    // Semi-duplex : sans annulation d'écho, le micro est sourd pendant que Jarvis parle et 600 ms après.
    const speaking = c.queue.length > 0 || now() < c.mutedUntil;
    if (speaking && !(c.aec && c.sat.attentive)) return;
    const utter = c.seg.push(frame);
    if (utter) handleUtterance(c, utter);
  }

  /** Cadence 100 ms : voix de retour ou silence, pendant toute la conversation ; fin après le silence réglé. */
  function tick() {
    const t = now();
    for (const c of conns.values()) {
      if (!c.session) continue;
      const next = c.queue.shift();
      try { c.socket.write(wsBinary(next || Buffer.alloc(OUT_CHUNK))); } catch { /* fermé */ }
      if (next) {
        c.mutedUntil = t + 600;
        if (active) active.lastActivity = t;
      } else if (!c.processing) {
        if (c.closeAfterReply && t >= c.mutedUntil) { c.closeAfterReply = false; closeConversation(c); }
        else if (active && t - active.lastActivity > read().settings.endSilenceMs) closeConversation(c, 'timeout');
      }
    }
  }

  // ── connexions ──
  function handshake(req, socket) {
    const wsKey = req.headers['sec-websocket-key'];
    if (!wsKey || req.headers.origin) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return false; }
    const accept = crypto.createHash('sha1').update(wsKey + WS_GUID).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    return true;
  }

  function reader(socket, onText, onBinary, onClose) {
    let buf = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length > 64 * 1024) { socket.destroy(); return; }
      const { frames, rest } = wsParse(buf);
      buf = rest;
      for (const f of frames) {
        if (f.opcode === 0x8) { try { socket.end(); } catch { /* fermé */ } return; }
        if (f.opcode === 0x9) { try { socket.write(Buffer.concat([Buffer.from([0x8a, f.payload.length]), f.payload])); } catch { /* fermé */ } continue; }
        if (f.opcode === 0xa) { onText(null, 'pong'); continue; }
        if (f.opcode === 0x1) { let msg; try { msg = JSON.parse(f.payload.toString('utf8')); } catch { continue; } if (msg && typeof msg === 'object') onText(msg); }
        if (f.opcode === 0x2) onBinary(f.payload);
      }
    });
    socket.on('close', onClose);
    socket.on('error', onClose);
  }

  function acceptSatellite(req, socket, sat) {
    if (!handshake(req, socket)) return;
    const prior = conns.get(sat.id);
    if (prior) sendClose(prior.socket, 1008); // reconnecté ailleurs
    const c = { id: sat.id, sat, socket, aec: false, firmware: '', muted: false, listening: false, session: false, processing: false, queue: [], mutedUntil: 0, lastRx: now(), seg: createSegmenter(vad), hello: false, closeAfterReply: false, lastLog: 0 };
    conns.set(sat.id, c);
    const helloTimer = setTimeout(() => { if (!c.hello) sendClose(socket, 1008); }, helloTimeoutMs);
    reader(socket, (msg, kind) => {
      c.lastRx = now();
      if (kind === 'pong' || !msg) return;
      if (!c.hello) {
        if (msg.type !== 'hello' || msg.protocol !== PROTOCOL || typeof msg.firmware !== 'string' || msg.firmware.length < 1 || msg.firmware.length > 32) { sendClose(socket, 1008); return; }
        c.hello = true; c.firmware = msg.firmware; c.aec = msg.aec === true;
        clearTimeout(helloTimer);
        sendJson(socket, { type: 'welcome', protocol: PROTOCOL, id: sat.id, name: sat.name, volume: sat.volume ?? DEFAULTS.volume });
        sendJson(socket, settingsOf(sat));
        update((d) => { const s = d.satellites.find((x) => x.id === sat.id); if (s) s.lastSeenAt = now(); });
        refreshListen();
        onEvent({ type: 'online', id: sat.id });
        return;
      }
      if (msg.type === 'mic') { c.muted = msg.muted === true; c.seg.reset(); refreshListen(); }
      if (msg.type === 'log' && typeof msg.message === 'string' && now() - c.lastLog >= 1000) { c.lastLog = now(); onEvent({ type: 'log', id: sat.id, message: msg.message.slice(0, 200) }); }
    }, (payload) => { c.lastRx = now(); if (c.hello) onAudio(c, payload); }, () => {
      clearTimeout(helloTimer);
      if (conns.get(sat.id) === c) { closeConversation(c, 'disconnected'); conns.delete(sat.id); refreshListen(); onEvent({ type: 'offline', id: sat.id }); }
    });
  }

  function acceptPairing(req, socket) {
    if (!handshake(req, socket)) return;
    let device = '';
    const timer = setTimeout(() => { if (!device) sendClose(socket, 1008); }, helloTimeoutMs);
    reader(socket, (msg) => {
      if (!msg || device) return;
      if (msg.type !== 'pair' || msg.protocol !== PROTOCOL || !/^[a-z0-9-]{3,48}$/.test(String(msg.device || ''))) { sendClose(socket, 1008); return; }
      if (pending.size >= MAX_PENDING && !pending.has(msg.device)) { sendClose(socket, 1008); return; }
      device = msg.device;
      pending.get(device)?.socket && sendClose(pending.get(device).socket, 1008);
      pending.set(device, { socket, device, firmware: String(msg.firmware || '').slice(0, 32), since: now() });
      pendingSockets.add(socket);
      clearTimeout(timer);
      sendJson(socket, { type: 'waiting' });
    }, () => {}, () => {
      clearTimeout(timer);
      pendingSockets.delete(socket);
      if (device && pending.get(device)?.socket === socket) pending.delete(device);
    });
  }

  function upgrade(req, socket) {
    const url = new URL(req.url, 'https://localhost');
    if (url.pathname === '/satellite/pair') return acceptPairing(req, socket);
    if (url.pathname === '/satellite') {
      const m = /^Bearer\s+([\w.-]{16,128})$/.exec(req.headers.authorization || '');
      const hash = m ? sha256(m[1]) : '';
      const sat = hash && read().satellites.find((s) => safeEqual(s.tokenHash, hash));
      if (!sat) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return undefined; }
      return acceptSatellite(req, socket, sat);
    }
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    return undefined;
  }

  // ── API ──
  function start() {
    if (server) return Promise.resolve(info());
    return new Promise((resolve, reject) => {
      const { key, cert } = certificate();
      server = https.createServer({ key, cert }, (_req, res) => { res.writeHead(404); res.end(); });
      server.on('upgrade', upgrade);
      server.once('error', (err) => { server = null; reject(err); });
      server.listen(port, '0.0.0.0', () => {
        sweeper = setInterval(() => {
          const t = now();
          for (const c of conns.values()) {
            if (t - c.lastRx > silentMs) { try { c.socket.destroy(); } catch { /* fermé */ } }
            else if (!c.pinged || t - c.pinged >= pingMs) { c.pinged = t; try { c.socket.write(Buffer.from([0x89, 0])); } catch { /* fermé */ } }
          }
        }, Math.min(pingMs, 1000));
        c_timer = setInterval(tick, tickMs);
        resolve(info());
      });
    });
  }

  function stop() {
    clearInterval(sweeper); clearInterval(c_timer);
    for (const c of conns.values()) { try { c.socket.destroy(); } catch { /* fermé */ } }
    for (const sock of pendingSockets) { try { sock.destroy(); } catch { /* fermé */ } }
    pendingSockets.clear();
    conns.clear(); pending.clear(); active = null;
    if (!server) return Promise.resolve();
    const s = server; server = null;
    return new Promise((resolve) => { s.close(() => resolve()); s.closeAllConnections?.(); });
  }

  function info() {
    const d = read();
    const here = lanAddress(interfaces());
    return {
      running: Boolean(server), port, address: here ? `${here}:${port}` : '', fingerprint: server ? keyFingerprint() : '', wakeAvailable,
      settings: d.settings,
      satellites: d.satellites.map((s) => { const c = conns.get(s.id); return { id: s.id, name: s.name, volume: s.volume ?? DEFAULTS.volume, led: s.led || DEFAULTS.led, attentive: Boolean(s.attentive), online: Boolean(c?.hello), firmware: c?.firmware || '', aec: Boolean(c?.aec), inConversation: active?.id === s.id, lastSeenAt: s.lastSeenAt || 0 }; }),
      pending: [...pending.values()].map((p) => ({ device: p.device, firmware: p.firmware, since: p.since })),
    };
  }

  function newToken() { return crypto.randomBytes(24).toString('hex'); }

  /** Crée un satellite (sans appairage) et rend son jeton, montré une seule fois. */
  function create(name) {
    const clean = String(name || '').trim().slice(0, 40);
    if (!clean) throw new Error('Nom manquant.');
    const token = newToken();
    const sat = { id: crypto.randomBytes(6).toString('hex'), name: clean, tokenHash: sha256(token), volume: DEFAULTS.volume, led: { ...DEFAULTS.led }, attentive: false, createdAt: now() };
    update((d) => { d.satellites.push(sat); });
    return { id: sat.id, token };
  }

  /** Associe un satellite en attente : il reçoit son jeton par la connexion d'appairage. */
  function pair(device, name) {
    const p = pending.get(device);
    if (!p) throw new Error('Ce satellite n’est plus en attente.');
    const { id, token } = create(name);
    sendJson(p.socket, { type: 'paired', name: String(name).trim().slice(0, 40), token });
    pending.delete(device);
    sendClose(p.socket, 1000); // le satellite redémarre puis se connecte à /satellite avec son jeton
    return { id };
  }

  const identify = (device) => { const p = pending.get(device); if (p) sendJson(p.socket, { type: 'identify' }); return Boolean(p); };

  function updateSatellite(id, patch) {
    const clamp = (v, lo, hi, dflt) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : dflt);
    update((d) => {
      const s = d.satellites.find((x) => x.id === id);
      if (!s) return;
      if (patch.name !== undefined) s.name = String(patch.name).trim().slice(0, 40) || s.name;
      if (patch.volume !== undefined) s.volume = clamp(patch.volume, 0, 100, s.volume);
      if (patch.attentive !== undefined) s.attentive = patch.attentive === true;
      if (patch.led) {
        const led = { ...(s.led || DEFAULTS.led) };
        if (/^#[0-9a-f]{6}$/i.test(String(patch.led.color || ''))) led.color = patch.led.color;
        if (patch.led.brightness !== undefined) led.brightness = clamp(patch.led.brightness, 0, 10, led.brightness);
        if (patch.led.nightLight !== undefined) led.nightLight = patch.led.nightLight === true;
        s.led = led;
      }
    });
    const c = conns.get(id);
    const sat = read().satellites.find((x) => x.id === id);
    if (c && sat) { c.sat = sat; sendJson(c.socket, settingsOf(sat)); }
  }

  function remove(id) {
    update((d) => { d.satellites = d.satellites.filter((s) => s.id !== id); });
    const c = conns.get(id);
    if (c) sendClose(c.socket, 1008);
  }

  const setSettings = (patch) => update((d) => {
    if (patch.enabled !== undefined) d.settings.enabled = patch.enabled === true;
    if (patch.endSilenceMs !== undefined) d.settings.endSilenceMs = Math.min(120000, Math.max(5000, Math.round(Number(patch.endSilenceMs)) || DEFAULTS.endSilenceMs));
  }).settings;

  /** Le moteur dit si la détection du mot d'éveil est possible (reconnaissance locale configurée). */
  function setWakeAvailable(v) { wakeAvailable = Boolean(v); refreshListen(); }

  return { start, stop, info, create, pair, identify, updateSatellite, remove, setSettings, setWakeAvailable, _conns: conns, _tick: tick };
}

module.exports = { createSatelliteServer, createSegmenter, rmsS16, wsBinary, FRAME_BYTES, OUT_CHUNK, PROTOCOL, PORT, VAD };
