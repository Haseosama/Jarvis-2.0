import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createRemoteServer, createReplyCollector, makeSelfSignedCert, decryptCommand, encryptCommand, lanAddress, wsFrame, wsParse,
} = require('../electron/remoteServer.cjs');

function request(port, method, pathName, { body, token } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      host: '127.0.0.1', port, method, path: pathName, rejectUnauthorized: false, agent: false,
      headers: { ...(data ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const item = (html, name) => html.match(new RegExp(`setItem\\('${name}','([^']+)'\\)`))?.[1];

describe('contrôle à distance depuis Jarvis Android', () => {
  it('fabrique un certificat auto-signé valide pour les IP données', () => {
    const { key, cert } = makeSelfSignedCert(['192.168.1.20']);
    const x = new crypto.X509Certificate(cert);
    assert.ok(x.verify(crypto.createPublicKey(key)));
    assert.match(x.subjectAltName, /IP Address:192\.168\.1\.20/);
    assert.match(x.subject, /CN=Jarvis 2\.0/);
    assert.ok(new Date(x.validTo) > new Date(Date.now() + 9 * 365 * 24 * 3600 * 1000));
  });

  it('déchiffre les ordres comme les chiffre le téléphone', () => {
    // vecteur du test Android (PcLinkTest) : openssl, IV 00..0f, code AB12CD
    assert.equal(decryptCommand('AB12CD', 'AAECAwQFBgcICQoLDA0ODw6ymuLVrDwcOoUFVrdeUR7qWdT1MzQeJTXLr8IxPzkd'), 'ouvre Chrome sur le PC é');
    assert.equal(decryptCommand('XPMJJR', encryptCommand('XPMJJR', 'monte le son')), 'monte le son');
    assert.throws(() => decryptCommand('AUTRE1', encryptCommand('XPMJJR', 'monte le son')));
  });

  it('lit des trames WebSocket masquées et coupées', () => {
    const mask = Buffer.from([1, 2, 3, 4]);
    const text = Buffer.from('{"type":"command","text":"x"}');
    const masked = Buffer.from(text.map((b, i) => b ^ mask[i & 3]));
    const frame = Buffer.concat([Buffer.from([0x81, 0x80 | text.length]), mask, masked]);
    assert.deepEqual(wsParse(frame.subarray(0, 5)).frames, []);
    const { frames, rest } = wsParse(Buffer.concat([frame, Buffer.from([0x88])]));
    assert.equal(frames[0].payload.toString(), text.toString());
    assert.equal(rest.length, 1);
    const big = 'é'.repeat(200);
    assert.equal(wsParse(wsFrame(big)).frames[0].payload.toString(), big);
  });

  it('choisit l’adresse du réseau local, pas une carte virtuelle', () => {
    assert.equal(lanAddress({
      'vEthernet (WSL)': [{ family: 'IPv4', internal: false, address: '172.20.0.1' }],
      Loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
      'Wi-Fi': [{ family: 'IPv4', internal: false, address: '192.168.1.20' }],
    }), '192.168.1.20');
    assert.equal(lanAddress({}), '127.0.0.1');
  });

  it('regroupe les morceaux d’une réplique en une seule phrase', async () => {
    const out = [];
    const collect = createReplyCollector((m) => out.push(m.text), 30);
    collect({ id: 'a', role: 'assistant', text: 'Chrome ', append: true });
    collect({ id: 'a', role: 'assistant', text: 'est ouvert.', append: true });
    collect({ id: 'u', role: 'user', text: 'ouvre Chrome' });
    await new Promise((r) => setTimeout(r, 80));
    assert.deepEqual(out, ['Chrome est ouvert.']);
  });

  it('appaire un téléphone, reçoit ses ordres et le reconnaît après un redémarrage', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-remote-'));
    const port = 18000 + Math.floor(Math.random() * 1000);
    const received = [];
    let srv = createRemoteServer({ dataDir, port, onCommand: (t) => received.push(t) });
    try {
      await srv.start();
      const { key, url } = srv.newKey();
      assert.match(key, /^[A-HJKMNP-Z2-9]{6}$/);
      assert.ok(url.endsWith(`:${port}/auto-login?key=${key}`));

      const page = await request(port, 'GET', `/auto-login?key=${key}`);
      const token = item(page.text, 'jarvis_token');
      const device = item(page.text, 'jarvis_device_token');
      assert.equal(item(page.text, 'jarvis_key'), key);
      assert.match((await request(port, 'GET', `/auto-login?key=${key}`)).text, /Link Expired/);

      assert.equal((await request(port, 'GET', '/api/files', { token: 'faux' })).status, 401);
      assert.equal((await request(port, 'GET', '/api/files', { token })).status, 200);
      assert.equal((await request(port, 'POST', '/api/command', { token, body: { enc: encryptCommand(key, 'ouvre Chrome') } })).status, 200);
      assert.deepEqual(received, ['ouvre Chrome']);

      await srv.stop();
      srv = createRemoteServer({ dataDir, port, onCommand: (t) => received.push(t) });
      await srv.start();
      assert.equal((await request(port, 'GET', '/api/files', { token })).status, 401);
      const relog = await request(port, 'POST', '/api/device-login', { body: { device_token: device } });
      assert.equal(relog.status, 200);
      assert.equal(JSON.parse(relog.text).key, key);
      assert.equal((await request(port, 'GET', '/api/files', { token: JSON.parse(relog.text).token })).status, 200);
      assert.ok(!fs.readFileSync(path.join(dataDir, 'remote', 'devices.json'), 'utf8').includes(device));

      srv.revokeAll();
      assert.equal((await request(port, 'POST', '/api/device-login', { body: { device_token: device } })).status, 401);
    } finally {
      await srv.stop();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
