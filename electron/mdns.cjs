'use strict';
// Annonce mDNS (Bonjour) du serveur des satellites : service « _cornelius._tcp » (le nom attendu par le firmware des satellites,
// protocole de Cornelius, lfpoulain/Cornelius) sur le port du serveur, avec path=/satellite, protocol=1 et key=<début de l'empreinte>.
// Un satellite trouve ainsi le PC sans qu'on lui donne d'adresse. Responder minimal (PTR, SRV, TXT, A), sans dépendance.
// Désactivable avec JARVIS_MDNS=0. Échec silencieux (port 5353 pris, réseau absent) : l'adresse fixe reste possible.

const dgram = require('dgram');
const os = require('os');

const MDNS_ADDR = '224.0.0.251';
const MDNS_PORT = 5353;
const TTL = 120;
const T = { A: 1, PTR: 12, TXT: 16, SRV: 33, ANY: 255 };

function encodeName(name) {
  const parts = String(name).replace(/\.$/, '').split('.');
  const bufs = parts.map((p) => { const b = Buffer.from(p, 'utf8'); if (b.length > 63) throw new Error('étiquette DNS trop longue'); return Buffer.concat([Buffer.from([b.length]), b]); });
  return Buffer.concat([...bufs, Buffer.from([0])]);
}

function record(name, type, data, ttl = TTL, cacheFlush = false) {
  const head = Buffer.alloc(10);
  head.writeUInt16BE(type, 0);
  head.writeUInt16BE(0x0001 | (cacheFlush ? 0x8000 : 0), 2);
  head.writeUInt32BE(ttl, 4);
  head.writeUInt16BE(data.length, 8);
  return Buffer.concat([encodeName(name), head, data]);
}

function txtData(entries) {
  return Buffer.concat(entries.map((e) => { const b = Buffer.from(e, 'utf8'); return Buffer.concat([Buffer.from([b.length]), b]); }));
}

/** Les enregistrements annoncés pour un service. */
function buildRecords({ instance, service = '_cornelius._tcp', host, port, addresses, txt, ttl = TTL }) {
  const svc = `${service}.local`;
  const inst = `${instance}.${svc}`;
  const hostName = `${host}.local`;
  const srv = Buffer.alloc(6);
  srv.writeUInt16BE(0, 0); srv.writeUInt16BE(0, 2); srv.writeUInt16BE(port, 4);
  return {
    ptr: record(svc, T.PTR, encodeName(inst), ttl),
    srv: record(inst, T.SRV, Buffer.concat([srv, encodeName(hostName)]), ttl, true),
    txt: record(inst, T.TXT, txtData(txt), ttl, true),
    a: addresses.map((ip) => record(hostName, T.A, Buffer.from(ip.split('.').map(Number)), ttl, true)),
    names: { svc, inst, hostName },
  };
}

function message(answers, additionals = []) {
  const head = Buffer.alloc(12);
  head.writeUInt16BE(0x8400, 2);
  head.writeUInt16BE(answers.length, 6);
  head.writeUInt16BE(additionals.length, 10);
  return Buffer.concat([head, ...answers, ...additionals]);
}

/** Lit un nom DNS (avec pointeurs de compression). Retourne { name, next }. */
function readName(buf, offset, depth = 0) {
  const labels = [];
  let pos = offset;
  let next = -1;
  for (let guard = 0; guard < 64; guard++) {
    if (pos >= buf.length) throw new Error('nom tronqué');
    const len = buf[pos];
    if (len === 0) { pos += 1; break; }
    if ((len & 0xc0) === 0xc0) {
      if (depth > 8) throw new Error('compression circulaire');
      const ptr = ((len & 0x3f) << 8) | buf[pos + 1];
      if (next < 0) next = pos + 2;
      const sub = readName(buf, ptr, depth + 1);
      labels.push(sub.name);
      pos = -1;
      break;
    }
    labels.push(buf.subarray(pos + 1, pos + 1 + len).toString('utf8'));
    pos += 1 + len;
  }
  return { name: labels.filter(Boolean).join('.'), next: next >= 0 ? next : pos };
}

/** Questions d'un paquet mDNS : [{ name, type }] (les réponses reçues sont ignorées). */
function parseQuestions(buf) {
  if (buf.length < 12) return [];
  const flags = buf.readUInt16BE(2);
  if (flags & 0x8000) return [];
  const qd = buf.readUInt16BE(4);
  const out = [];
  let pos = 12;
  try {
    for (let i = 0; i < qd; i++) {
      const { name, next } = readName(buf, pos);
      out.push({ name: name.toLowerCase(), type: buf.readUInt16BE(next) });
      pos = next + 4;
    }
  } catch { /* paquet invalide : ignoré */ }
  return out;
}

/** Enregistrements de réponse pour ces questions (ou null). */
function answerFor(questions, rec) {
  const { svc, inst, hostName } = rec.names;
  const answers = [];
  const extra = [];
  for (const q of questions) {
    const name = q.name.toLowerCase();
    if (name === svc.toLowerCase() && (q.type === T.PTR || q.type === T.ANY)) { answers.push(rec.ptr); extra.push(rec.srv, rec.txt, ...rec.a); }
    else if (name === inst.toLowerCase()) {
      if (q.type === T.SRV || q.type === T.ANY) answers.push(rec.srv);
      if (q.type === T.TXT || q.type === T.ANY) answers.push(rec.txt);
      if (answers.length) extra.push(...rec.a);
    } else if (name === hostName.toLowerCase() && (q.type === T.A || q.type === T.ANY)) answers.push(...rec.a);
  }
  return answers.length ? message([...new Set(answers)], [...new Set(extra.filter((e) => !answers.includes(e)))]) : null;
}

function ipv4Addresses(interfaces = os.networkInterfaces()) {
  return Object.values(interfaces).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
}

function createMdnsAnnouncer({ instance = 'Jarvis', service = '_cornelius._tcp', port, fingerprint = '', hostname = os.hostname(), interfaces = () => os.networkInterfaces(), onError = () => {} } = {}) {
  let socket = null;
  let timer = null;
  const host = String(hostname).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'jarvis-pc';
  const make = (ttl) => buildRecords({ instance, service, host, port, addresses: ipv4Addresses(interfaces()), txt: ['path=/satellite', 'protocol=1', `key=${String(fingerprint).slice(0, 16)}`], ttl });

  function announce(ttl = TTL) {
    const rec = make(ttl);
    if (!socket || !rec.a.length) return;
    const pkt = message([rec.ptr, rec.srv, rec.txt, ...rec.a]);
    socket.send(pkt, MDNS_PORT, MDNS_ADDR, () => {});
  }

  function start() {
    if (process.env.JARVIS_MDNS === '0' || socket) return false;
    try {
      socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      socket.on('error', (e) => { onError(e); stop(); });
      socket.on('message', (msg) => {
        const rec = make(TTL);
        const reply = answerFor(parseQuestions(msg), rec);
        if (reply && rec.a.length) socket.send(reply, MDNS_PORT, MDNS_ADDR, () => {});
      });
      socket.bind(MDNS_PORT, () => {
        try {
          for (const ip of ipv4Addresses(interfaces())) { try { socket.addMembership(MDNS_ADDR, ip); } catch { /* interface sans multicast */ } }
          socket.setMulticastTTL(255);
          announce();
          setTimeout(() => announce(), 1000).unref?.();
          timer = setInterval(() => announce(), (TTL / 2) * 1000);
          timer.unref?.();
        } catch (e) { onError(e); stop(); }
      });
      return true;
    } catch (e) { onError(e); socket = null; return false; }
  }

  function stop() {
    clearInterval(timer);
    timer = null;
    if (!socket) return;
    const s = socket;
    socket = null;
    try { const rec = buildRecords({ instance, service, host, port, addresses: ipv4Addresses(interfaces()), txt: ['path=/satellite', 'protocol=1'], ttl: 0 }); s.send(message([rec.ptr]), MDNS_PORT, MDNS_ADDR, () => { try { s.close(); } catch { /* fermé */ } }); } catch { try { s.close(); } catch { /* fermé */ } }
  }

  return { start, stop };
}

module.exports = { createMdnsAnnouncer, buildRecords, message, parseQuestions, answerFor, readName, encodeName, T };
