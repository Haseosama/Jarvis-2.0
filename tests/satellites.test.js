import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createSatelliteServer, createSegmenter, rmsS16, FRAME_BYTES, OUT_CHUNK } = require('../electron/satellites.cjs');
const { wsParse } = require('../electron/remoteServer.cjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-sat-'));
const frame = (loud) => {
  const b = Buffer.alloc(FRAME_BYTES);
  if (loud) for (let i = 0; i < FRAME_BYTES / 2; i++) b.writeInt16LE(Math.round(8000 * Math.sin(i / 5)), i * 2);
  return b;
};

/** Trame client (masquée, comme l'exige RFC 6455). */
function clientFrame(payload, opcode) {
  const n = payload.length;
  const mask = crypto.randomBytes(4);
  const head = n < 126 ? Buffer.from([0x80 | opcode, 0x80 | n]) : Buffer.from([0x80 | opcode, 0x80 | 126, n >> 8, n & 255]);
  const body = Buffer.from(payload);
  for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3];
  return Buffer.concat([head, mask, body]);
}

function connect(port, urlPath, headers = {}) {
  return new Promise((resolve) => {
    const req = https.request({ host: '127.0.0.1', port, path: urlPath, rejectUnauthorized: false, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'), ...headers } });
    req.on('upgrade', (_res, socket) => {
      const client = { socket, texts: [], bins: [], closed: false };
      let buf = Buffer.alloc(0);
      socket.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        const { frames, rest } = wsParse(buf);
        buf = rest;
        for (const f of frames) {
          if (f.opcode === 1) client.texts.push(JSON.parse(f.payload.toString()));
          else if (f.opcode === 2) client.bins.push(f.payload);
          else if (f.opcode === 8) client.closed = true;
        }
      });
      socket.on('close', () => { client.closed = true; });
      socket.on('error', () => {});
      client.json = (obj) => socket.write(clientFrame(Buffer.from(JSON.stringify(obj)), 1));
      client.audio = (buf2) => socket.write(clientFrame(buf2, 2));
      client.types = () => client.texts.map((t) => t.type + (t.state ? `:${t.state}` : ''));
      resolve({ client });
    });
    req.on('response', (res) => { resolve({ status: res.statusCode }); res.resume(); });
    req.on('error', () => resolve({ status: 0 }));
    req.end();
  });
}

const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error('délai dépassé');
};

describe('satellites audio : segmentation', () => {
  it('découpe une phrase et ignore un bruit bref', () => {
    const seg = createSegmenter();
    let out = null;
    for (let i = 0; i < 20; i++) seg.push(frame(false));
    for (let i = 0; i < 10; i++) seg.push(frame(true));
    for (let i = 0; i < 12 && !out; i++) out = seg.push(frame(false));
    assert.ok(out && out.length >= 10 * FRAME_BYTES, 'phrase avec avant-propos');
    const seg2 = createSegmenter();
    let bump = null;
    seg2.push(frame(true));
    for (let i = 0; i < 15 && !bump; i++) bump = seg2.push(frame(false));
    assert.equal(bump, null);
    assert.ok(rmsS16(frame(true)) > 600 && rmsS16(frame(false)) === 0);
  });
});

describe('satellites audio : serveur', () => {
  let srv;
  let port;
  const heard = [];
  let nextResult = {};
  before(async () => {
    port = 34000 + Math.floor(Math.random() * 2000);
    srv = createSatelliteServer({ dataDir: tmp, port, mdns: false, tickMs: 10, onUtterance: async (u) => { heard.push(u); return nextResult; } });
    await srv.start();
  });
  after(async () => { await srv.stop(); fs.rmSync(tmp, { recursive: true, force: true }); });

  it('refuse un jeton inconnu et un en-tête Origin (403)', async () => {
    assert.equal((await connect(port, '/satellite', { Authorization: 'Bearer ' + 'a'.repeat(48) })).status, 403);
    const { token } = srv.create('Salon');
    assert.equal((await connect(port, '/satellite', { Authorization: `Bearer ${token}`, Origin: 'https://evil.example' })).status, 403);
  });

  it('hello → welcome, settings, listen selon la disponibilité du mot d’éveil', async () => {
    const { id, token } = srv.create('Cuisine');
    const { client } = await connect(port, '/satellite', { Authorization: `Bearer ${token}` });
    client.json({ type: 'hello', protocol: 1, firmware: '0.1.0', aec: false });
    await until(() => client.texts.length >= 2);
    assert.deepEqual(client.texts.slice(0, 2).map((t) => t.type), ['welcome', 'settings']);
    assert.equal(client.texts[0].name, 'Cuisine');
    assert.equal(client.texts[0].id, id);
    assert.equal(client.types().includes('listen'), false);
    srv.setWakeAvailable(true);
    await until(() => client.texts.some((t) => t.type === 'listen' && t.enabled === true));
    assert.equal(srv.info().satellites.find((s) => s.id === id).online, true);
    client.socket.destroy();
  });

  it('conversation complète : mot d’éveil, réponse cadencée, silence, fin', async () => {
    heard.length = 0;
    srv.setWakeAvailable(true);
    const { token } = srv.create('Bureau');
    const { client } = await connect(port, '/satellite', { Authorization: `Bearer ${token}` });
    client.json({ type: 'hello', protocol: 1, firmware: '0.1.0' });
    await until(() => client.types().includes('listen:undefined') || client.texts.some((t) => t.type === 'listen'));
    nextResult = { wake: true, reply: Buffer.alloc(OUT_CHUNK * 2, 1), close: true };
    for (let i = 0; i < 12; i++) client.audio(frame(true));
    for (let i = 0; i < 12; i++) client.audio(frame(false));
    await until(() => client.types().includes('session:closed'));
    const order = client.types();
    assert.ok(order.indexOf('wake') < order.indexOf('session:connecting'));
    assert.ok(order.indexOf('session:connecting') < order.indexOf('session:ready'));
    assert.ok(order.indexOf('session:ready') < order.indexOf('session:closed'));
    assert.equal(heard.length, 1);
    assert.equal(heard[0].conversation, false);
    assert.ok(client.bins.length >= 2);
    assert.ok(client.bins.every((b) => b.length === OUT_CHUNK));
    assert.ok(client.bins.slice(0, 2).every((b) => b[0] === 1), 'la voix précède les silences');
    client.socket.destroy();
  });

  it('une seule conversation à la fois : le second reçoit busy', async () => {
    nextResult = { wake: true };
    srv.setWakeAvailable(true);
    const a = (await connect(port, '/satellite', { Authorization: `Bearer ${srv.create('A').token}` })).client;
    const b = (await connect(port, '/satellite', { Authorization: `Bearer ${srv.create('B').token}` })).client;
    for (const c of [a, b]) c.json({ type: 'hello', protocol: 1, firmware: '1' });
    await until(() => a.texts.some((t) => t.type === 'listen') && b.texts.some((t) => t.type === 'listen'));
    for (let i = 0; i < 12; i++) a.audio(frame(true));
    for (let i = 0; i < 12; i++) a.audio(frame(false));
    await until(() => a.types().includes('session:ready'));
    await until(() => b.texts.some((t) => t.type === 'listen' && t.enabled === false));
    a.socket.destroy();
    b.socket.destroy();
  });

  it('ferme sur une trame de mauvaise taille et sur un hello invalide', async () => {
    const { client } = await connect(port, '/satellite', { Authorization: `Bearer ${srv.create('C').token}` });
    client.json({ type: 'hello', protocol: 1, firmware: '1' });
    await until(() => client.texts.some((t) => t.type === 'welcome'));
    client.audio(Buffer.alloc(100));
    await until(() => client.closed);
    const bad = (await connect(port, '/satellite', { Authorization: `Bearer ${srv.create('D').token}` })).client;
    bad.json({ type: 'hello', protocol: 99, firmware: '1' });
    await until(() => bad.closed);
  });

  it('appairage : attente, clignotement, association, jeton utilisable', async () => {
    const { client } = await connect(port, '/satellite/pair');
    client.json({ type: 'pair', protocol: 1, device: 'cornelius-satellite-b0c6b4', firmware: '0.2.0' });
    await until(() => client.texts.some((t) => t.type === 'waiting'));
    assert.equal(srv.info().pending[0].device, 'cornelius-satellite-b0c6b4');
    srv.identify('cornelius-satellite-b0c6b4');
    await until(() => client.texts.some((t) => t.type === 'identify'));
    srv.pair('cornelius-satellite-b0c6b4', 'Chambre');
    const paired = await until(() => client.texts.find((t) => t.type === 'paired'));
    assert.equal(paired.name, 'Chambre');
    assert.equal(srv.info().pending.length, 0);
    const again = (await connect(port, '/satellite', { Authorization: `Bearer ${paired.token}` })).client;
    again.json({ type: 'hello', protocol: 1, firmware: '1' });
    await until(() => again.texts.some((t) => t.type === 'welcome' && t.name === 'Chambre'));
    again.socket.destroy();
    const raw = fs.readFileSync(path.join(tmp, 'satellites', 'satellites.json'), 'utf8');
    assert.equal(raw.includes(paired.token), false, 'seule l’empreinte du jeton est gardée');
  });

  it('réglages poussés au satellite connecté', async () => {
    const { id, token } = srv.create('E');
    const { client } = await connect(port, '/satellite', { Authorization: `Bearer ${token}` });
    client.json({ type: 'hello', protocol: 1, firmware: '1' });
    await until(() => client.texts.some((t) => t.type === 'settings'));
    srv.updateSatellite(id, { volume: 150, attentive: true, led: { color: '#ff0000', brightness: 3, nightLight: true } });
    const s = await until(() => client.texts.filter((t) => t.type === 'settings')[1]);
    assert.equal(s.volume, 100);
    assert.equal(s.attentive, true);
    assert.deepEqual(s.led, { color: '#ff0000', brightness: 3, nightLight: true });
    client.socket.destroy();
  });
});
