'use strict';
// Contrôle à distance depuis Jarvis Android.
//
// Un petit serveur HTTPS sur le réseau local (port 8000) qui parle exactement le protocole du tableau de bord de
// Mark-LIV (dashboard/server.py), celui que l'app Android sait déjà utiliser (pc/PcRemote.kt) :
//  - le PC affiche un code à usage unique de 6 caractères (valable 10 minutes) et un QR code de
//    https://<ip>:8000/auto-login?key=<code> ; cette page rend un jeton de session, le code, et un jeton d'appareil ;
//  - le jeton d'appareil redonne un jeton de session sans nouveau code (POST /api/device-login). Ici il est conservé sur
//    le disque (empreinte seulement), donc le téléphone reste appairé après un redémarrage de Jarvis ;
//  - un ordre : POST /api/command {"enc": base64(IV ‖ AES-256-CBC(texte))}, clé AES = SHA-256(code ‖ "JARVIS-DASHBOARD-v1") ;
//  - les réponses de Jarvis repartent sur le WebSocket /ws?token= en {"type":"log","speaker":"jarvis","text":…}.
// Le certificat est fabriqué ici une fois (aucune dépendance) ; le téléphone l'épingle à l'appairage.

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 8000;
const AES_SALT = 'JARVIS-DASHBOARD-v1';
const KEY_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans O, I, L, 0, 1
const KEY_TTL_MS = 10 * 60 * 1000;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_HISTORY = 300;
const REPLAYED = 50;

// ── DER minimal pour un certificat X.509 auto-signé ─────────────────────────────

function derLength(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  while (n > 0) { bytes.unshift(n & 0xff); n >>= 8; }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
function der(tag, ...parts) {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), derLength(body.length), body]);
}
const seq = (...p) => der(0x30, ...p);
const set = (...p) => der(0x31, ...p);
function oid(text) {
  const n = text.split('.').map(Number);
  const out = [40 * n[0] + n[1]];
  for (const v of n.slice(2)) {
    const b = [v & 0x7f];
    for (let x = v >>> 7; x > 0; x >>>= 7) b.unshift((x & 0x7f) | 0x80);
    out.push(...b);
  }
  return der(0x06, Buffer.from(out));
}
function derInt(buf) {
  let b = Buffer.from(buf);
  while (b.length > 1 && b[0] === 0 && !(b[1] & 0x80)) b = b.subarray(1);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return der(0x02, b);
}
function utcTime(d) {
  const p = (v) => String(v).padStart(2, '0');
  const s = `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  return der(0x17, Buffer.from(s, 'ascii'));
}
function ipBytes(ip) {
  return Buffer.from(ip.split('.').map(Number));
}

/** Un certificat auto-signé RSA 2048 / SHA-256, valable 10 ans, pour localhost et les IP données. Renvoie { key, cert } en PEM. */
function makeSelfSignedCert(ips = [], now = new Date()) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const name = seq(set(seq(oid('2.5.4.3'), der(0x0c, Buffer.from('Jarvis 2.0', 'utf8')))));
  const sha256Rsa = seq(oid('1.2.840.113549.1.1.11'), Buffer.from([0x05, 0x00]));
  const notBefore = new Date(now.getTime() - 24 * 3600 * 1000);
  const notAfter = new Date(now.getTime() + 3650 * 24 * 3600 * 1000);
  const altNames = [der(0x82, Buffer.from('localhost', 'ascii')), der(0x87, ipBytes('127.0.0.1'))];
  for (const ip of ips) if (/^\d+\.\d+\.\d+\.\d+$/.test(ip) && ip !== '127.0.0.1') altNames.push(der(0x87, ipBytes(ip)));
  const extensions = der(0xa3, seq(
    seq(oid('2.5.29.17'), der(0x04, seq(...altNames))),
    seq(oid('2.5.29.19'), Buffer.from([0x01, 0x01, 0xff]), der(0x04, seq())),
  ));
  const serial = crypto.randomBytes(16);
  serial[0] &= 0x7f;
  const tbs = seq(
    der(0xa0, derInt(Buffer.from([2]))),
    derInt(serial),
    sha256Rsa,
    name,
    seq(utcTime(notBefore), utcTime(notAfter)),
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
    extensions,
  );
  const signature = crypto.sign('sha256', tbs, privateKey);
  const certDer = seq(tbs, sha256Rsa, der(0x03, Buffer.concat([Buffer.from([0]), signature])));
  const pem = (label, buf) => `-----BEGIN ${label}-----\n${buf.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;
  return { key: privateKey.export({ type: 'pkcs8', format: 'pem' }), cert: pem('CERTIFICATE', certDer) };
}

// ── Chiffrement des ordres (identique au tableau de bord Mark-LIV) ─────────────

function aesKey(sessionKey) {
  return crypto.createHash('sha256').update(Buffer.from(sessionKey + AES_SALT, 'utf8')).digest();
}
function decryptCommand(sessionKey, encB64) {
  const raw = Buffer.from(String(encB64 || ''), 'base64');
  if (raw.length < 32) throw new Error('trop court');
  const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey(sessionKey), raw.subarray(0, 16));
  return Buffer.concat([decipher.update(raw.subarray(16)), decipher.final()]).toString('utf8');
}
function encryptCommand(sessionKey, text, iv = crypto.randomBytes(16)) {
  const cipher = crypto.createCipheriv('aes-256-cbc', aesKey(sessionKey), iv);
  return Buffer.concat([iv, cipher.update(text, 'utf8'), cipher.final()]).toString('base64');
}
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/** L'adresse IPv4 du PC sur le réseau local (Wi-Fi ou Ethernet), celle que le téléphone peut joindre. */
function lanAddress(interfaces = os.networkInterfaces()) {
  const all = [];
  for (const [name, list] of Object.entries(interfaces || {})) {
    for (const a of list || []) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal && !a.address.startsWith('169.254.')) all.push({ name, address: a.address });
    }
  }
  const virtual = /vEthernet|VirtualBox|VMware|WSL|Hyper-V|docker|vbox|Loopback|tailscale|ZeroTier/i;
  const privateNet = (ip) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  const score = (a) => (privateNet(a.address) ? 2 : 0) + (virtual.test(a.name) ? -3 : 0) + (a.address.startsWith('192.168.') ? 1 : 0);
  all.sort((a, b) => score(b) - score(a));
  return all[0]?.address || '127.0.0.1';
}

// ── WebSocket minimal (RFC 6455, côté serveur) ─────────────────────────────────

function wsFrame(text, opcode = 0x1) {
  const payload = Buffer.from(text, 'utf8');
  const n = payload.length;
  let head;
  if (n < 126) head = Buffer.from([0x80 | opcode, n]);
  else if (n < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(n, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
  return Buffer.concat([head, payload]);
}

/** Lit les trames complètes au début de buf : { frames: [{opcode, payload}], rest }. */
function wsParse(buf) {
  const frames = [];
  let off = 0;
  while (buf.length - off >= 2) {
    const b0 = buf[off];
    const b1 = buf[off + 1];
    let len = b1 & 0x7f;
    let p = off + 2;
    if (len === 126) { if (buf.length < p + 2) break; len = buf.readUInt16BE(p); p += 2; }
    else if (len === 127) { if (buf.length < p + 8) break; len = Number(buf.readBigUInt64BE(p)); p += 8; }
    const masked = (b1 & 0x80) !== 0;
    const mask = masked ? buf.subarray(p, p + 4) : null;
    if (masked) p += 4;
    if (buf.length < p + len) break;
    const payload = Buffer.from(buf.subarray(p, p + len));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    frames.push({ opcode: b0 & 0x0f, payload });
    off = p + len;
  }
  return { frames, rest: buf.subarray(off) };
}

// ── Serveur ────────────────────────────────────────────────────────────────────

function createRemoteServer({ dataDir, onCommand = () => {}, onEvent = () => {}, port = PORT, now = () => Date.now() } = {}) {
  const certDir = path.join(dataDir, 'remote');
  const devicesFile = path.join(certDir, 'devices.json');
  const pending = new Map(); // code → expiration
  const tokens = new Map(); // jeton de session → code de session
  const clients = new Set();
  let history = [];
  let server = null;
  let address = lanAddress();

  const readDevices = () => {
    try { return JSON.parse(fs.readFileSync(devicesFile, 'utf8')); } catch { return []; }
  };
  const writeDevices = (list) => {
    fs.mkdirSync(certDir, { recursive: true });
    fs.writeFileSync(devicesFile, JSON.stringify(list, null, 2), 'utf8');
  };

  function certificate() {
    const keyPath = path.join(certDir, 'jarvis.key');
    const certPath = path.join(certDir, 'jarvis.crt');
    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
      return { key: fs.readFileSync(keyPath, 'utf8'), cert: fs.readFileSync(certPath, 'utf8') };
    }
    const pair = makeSelfSignedCert([address]);
    fs.mkdirSync(certDir, { recursive: true });
    fs.writeFileSync(keyPath, pair.key, { encoding: 'utf8', mode: 0o600 });
    fs.writeFileSync(certPath, pair.cert, 'utf8');
    return pair;
  }

  function newKey() {
    const t = now();
    for (const [k, exp] of pending) if (exp <= t) pending.delete(k);
    let key = '';
    for (let i = 0; i < 6; i++) key += KEY_CHARS[crypto.randomInt(KEY_CHARS.length)];
    pending.set(key, t + KEY_TTL_MS);
    address = lanAddress();
    return { key, expiresAt: t + KEY_TTL_MS, url: `https://${address}:${port}/auto-login?key=${key}`, address: `${address}:${port}` };
  }

  function takeKey(raw) {
    const key = String(raw || '').trim().toUpperCase();
    const exp = pending.get(key);
    if (!exp || exp <= now()) return null;
    pending.delete(key); // une seule fois
    return key;
  }

  function issueToken(sessionKey) {
    const tok = crypto.randomBytes(32).toString('base64url');
    tokens.set(tok, sessionKey);
    return tok;
  }

  function broadcast(msg) {
    history.push(msg);
    if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
    const frame = wsFrame(JSON.stringify(msg));
    for (const sock of clients) {
      try { sock.write(frame); } catch { clients.delete(sock); }
    }
  }

  function bearer(req) {
    const tok = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    return tok && tokens.has(tok) ? tok : null;
  }

  function readJson(req) {
    return new Promise((resolve) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > 64 * 1024) req.destroy(); else chunks.push(c); });
      req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { resolve({}); } });
      req.on('error', () => resolve({}));
    });
  }

  function send(res, code, body, type = 'application/json; charset=utf-8') {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  }

  function runCommand(text) {
    const clean = String(text || '').trim().slice(0, 4000);
    if (!clean) return;
    onEvent({ type: 'command', text: clean });
    onCommand(clean);
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'https://localhost');
    const route = `${req.method} ${url.pathname}`;
    if (route === 'GET /auto-login') {
      const key = takeKey(url.searchParams.get('key'));
      if (!key) return send(res, 200, '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><h2>Link Expired</h2><p>Lien expiré : rouvrez « Contrôle à distance » dans Jarvis 2.0 pour un nouveau code.</p></body></html>', 'text/html; charset=utf-8');
      const tok = issueToken(key);
      const devTok = crypto.randomBytes(32).toString('base64url');
      const devices = readDevices().filter((d) => d.deviceHash !== sha256(devTok));
      devices.push({ deviceHash: sha256(devTok), sessionKey: key, pairedAt: new Date(now()).toISOString(), agent: String(req.headers['user-agent'] || '').slice(0, 120) });
      writeDevices(devices);
      onEvent({ type: 'paired' });
      broadcast({ type: 'sys', text: 'Remote connection established via QR code.' });
      return send(res, 200, `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><script>
  sessionStorage.setItem('jarvis_token','${tok}');
  sessionStorage.setItem('jarvis_key','${key}');
  localStorage.setItem('jarvis_device_token','${devTok}');
</script><p>Téléphone appairé à Jarvis 2.0.</p></body></html>`, 'text/html; charset=utf-8');
    }
    if (route === 'POST /login') {
      const body = await readJson(req);
      const key = takeKey(body.pin);
      if (!key) return send(res, 401, { ok: false, error: 'Invalid or expired key' });
      onEvent({ type: 'paired' });
      return send(res, 200, { ok: true, token: issueToken(key) });
    }
    if (route === 'POST /api/device-login') {
      const body = await readJson(req);
      const dev = readDevices().find((d) => d.deviceHash === sha256(String(body.device_token || '').trim()));
      if (!dev) return send(res, 401, { ok: false });
      onEvent({ type: 'reconnected' });
      return send(res, 200, { ok: true, token: issueToken(dev.sessionKey), key: dev.sessionKey });
    }
    if (route === 'GET /api/files') {
      if (!bearer(req)) return send(res, 401, { error: 'Unauthorized' });
      return send(res, 200, { files: [] });
    }
    if (route === 'POST /api/command') {
      const tok = bearer(req);
      if (!tok) return send(res, 401, { error: 'Unauthorized' });
      const body = await readJson(req);
      let text = '';
      if (body.enc) {
        try { text = decryptCommand(tokens.get(tok), body.enc); } catch { return send(res, 400, { error: 'Decryption failed' }); }
      } else text = String(body.text || '');
      runCommand(text);
      return send(res, 200, { ok: true });
    }
    if (route === 'POST /api/wake') {
      if (!bearer(req)) return send(res, 401, { error: 'Unauthorized' });
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: 'Not found' });
  }

  function upgrade(req, socket) {
    const url = new URL(req.url, 'https://localhost');
    const tok = url.searchParams.get('token') || '';
    const wsKey = req.headers['sec-websocket-key'];
    if (url.pathname !== '/ws' || !tokens.has(tok) || !wsKey) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    const accept = crypto.createHash('sha1').update(wsKey + WS_GUID).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    clients.add(socket);
    for (const m of history.slice(-REPLAYED)) socket.write(wsFrame(JSON.stringify(m)));
    let buf = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length > 1024 * 1024) { socket.destroy(); return; }
      const { frames, rest } = wsParse(buf);
      buf = rest;
      for (const f of frames) {
        if (f.opcode === 0x8) { try { socket.end(wsFrame('', 0x8)); } catch {} clients.delete(socket); return; }
        if (f.opcode === 0x9) socket.write(wsFrame(f.payload.toString('utf8'), 0xa));
        if (f.opcode === 0x1) {
          try {
            const data = JSON.parse(f.payload.toString('utf8'));
            if (data.type === 'command') runCommand(data.enc ? decryptCommand(tokens.get(tok), data.enc) : data.text);
          } catch {}
        }
      }
    });
    const drop = () => clients.delete(socket);
    socket.on('close', drop);
    socket.on('error', drop);
  }

  function start() {
    if (server) return Promise.resolve(info());
    return new Promise((resolve, reject) => {
      const { key, cert } = certificate();
      server = https.createServer({ key, cert }, (req, res) => { handle(req, res).catch(() => { try { send(res, 500, { error: 'Erreur' }); } catch {} }); });
      server.on('upgrade', upgrade);
      server.once('error', (err) => { server = null; reject(err); });
      server.listen(port, '0.0.0.0', () => resolve(info()));
    });
  }

  function stop() {
    for (const s of clients) { try { s.destroy(); } catch {} }
    clients.clear();
    tokens.clear();
    if (!server) return Promise.resolve();
    const s = server;
    server = null;
    return new Promise((resolve) => {
      s.close(() => resolve());
      s.closeAllConnections?.(); // les connexions gardées ouvertes du téléphone, sinon close() attend
    });
  }

  function fingerprint() {
    try { return new crypto.X509Certificate(certificate().cert).fingerprint256; } catch { return ''; }
  }

  function info() {
    return { running: Boolean(server), address: `${address}:${port}`, devices: readDevices().length, fingerprint: server ? fingerprint() : '' };
  }

  function revokeAll() {
    writeDevices([]);
    tokens.clear();
    for (const s of clients) { try { s.destroy(); } catch {} }
    clients.clear();
  }

  return { start, stop, newKey, info, broadcast, revokeAll };
}

/**
 * Ce que Jarvis dit arrive par morceaux (transcription de Gemini Live) : chaque réplique est envoyée au téléphone quand elle
 * n'a plus bougé depuis quietMs, en une seule phrase.
 */
function createReplyCollector(emit, quietMs = 1200) {
  const turns = new Map();
  return function collect(msg) {
    if (!msg || msg.role !== 'assistant' || !msg.text) return;
    const id = String(msg.id || `a_${Date.now()}`);
    const turn = turns.get(id) || { text: '', timer: null };
    turn.text = msg.append ? turn.text + msg.text : msg.text;
    clearTimeout(turn.timer);
    turn.timer = setTimeout(() => {
      turns.delete(id);
      const text = turn.text.trim();
      if (text) emit({ type: 'log', speaker: 'jarvis', text, ts: new Date().toISOString() });
    }, quietMs);
    turns.set(id, turn);
  };
}

module.exports = {
  PORT,
  createRemoteServer,
  createReplyCollector,
  makeSelfSignedCert,
  decryptCommand,
  encryptCommand,
  lanAddress,
  wsFrame,
  wsParse,
};
