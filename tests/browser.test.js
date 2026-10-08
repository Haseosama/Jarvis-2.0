import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createBrowserControl, normalizeAction, normalizeUrl, parseTarget, formatSnapshot, launchCandidates } = require('../electron/browserControl.cjs');
const { createRemoteServer, encryptCommand } = require('../electron/remoteServer.cjs');

describe('navigateur : actions et cibles', () => {
  it('reconnaît les actions en anglais et en français', () => {
    assert.equal(normalizeAction(''), 'read');
    assert.equal(normalizeAction('click'), 'click');
    assert.equal(normalizeAction('Cliquer'), 'click');
    assert.equal(normalizeAction('remplir'), 'fill');
    assert.equal(normalizeAction('défiler'), 'scroll');
    assert.equal(normalizeAction('regarder'), 'look');
    assert.equal(normalizeAction('danser'), null);
  });

  it('transforme un site ou des mots en adresse, et refuse les autres protocoles', () => {
    assert.equal(normalizeUrl('https://example.com/a'), 'https://example.com/a');
    assert.equal(normalizeUrl('leboncoin.fr'), 'https://leboncoin.fr');
    assert.equal(normalizeUrl('example.com:8080/x'), 'https://example.com:8080/x');
    assert.equal(normalizeUrl('localhost:3000'), 'http://localhost:3000');
    assert.equal(normalizeUrl('météo à Lyon'), 'https://www.google.com/search?q=m%C3%A9t%C3%A9o%20%C3%A0%20Lyon');
    assert.equal(normalizeUrl('file:///C:/Windows'), null);
    assert.equal(normalizeUrl('javascript:alert(1)'), null);
    assert.equal(normalizeUrl(''), null);
  });

  it('lit une cible comme un numéro, un sélecteur ou un texte', () => {
    assert.deepEqual(parseTarget(3), { ref: 3 });
    assert.deepEqual(parseTarget('[12]'), { ref: 12 });
    assert.deepEqual(parseTarget('css: #login'), { css: '#login' });
    assert.deepEqual(parseTarget('Se connecter'), { text: 'Se connecter' });
    assert.equal(parseTarget('  '), null);
    assert.equal(parseTarget(undefined), null);
  });

  it('présente la page avec ses éléments numérotés', () => {
    const out = formatSnapshot({
      title: 'Connexion', url: 'https://x.fr', text: 'Bonjour\n\n\n\nmonde',
      elements: [{ ref: 1, kind: 'champ', label: 'E-mail', value: 'a@b.fr' }, { ref: 2, kind: 'bouton', label: 'Entrer', value: '' }],
      more: 4,
    });
    assert.match(out, /^Page : Connexion — https:\/\/x\.fr/);
    assert.match(out, /Bonjour\n\nmonde/);
    assert.match(out, /\[1\] champ « E-mail » = « a@b\.fr »/);
    assert.match(out, /\[2\] bouton « Entrer »/);
    assert.match(out, /\+4 autres éléments/);
  });

  it('essaie le navigateur demandé, puis Edge, puis Chrome', () => {
    assert.deepEqual(launchCandidates({}), [{ channel: 'msedge' }, { channel: 'chrome' }]);
    assert.deepEqual(launchCandidates({ JARVIS_BROWSER: '/x/chrome' })[0], { executablePath: '/x/chrome' });
  });

  it('dit quoi faire quand aucun navigateur ne se lance', async () => {
    const fake = { chromium: { launchPersistentContext: async () => { throw new Error('Chromium distribution "msedge" is not found'); } } };
    const ctl = createBrowserControl({ profileDir: fs.mkdtempSync(path.join(os.tmpdir(), 'jb-')), loadPlaywright: () => fake, env: {} });
    const r = await ctl.run({ action: 'open', url: 'example.com' });
    assert.equal(r.ok, false);
    assert.match(r.text, /Edge ou Chrome/);
  });

  it('refuse une action inconnue ou une adresse vide sans lancer de navigateur', async () => {
    const ctl = createBrowserControl({ loadPlaywright: () => { throw new Error('ne doit pas être chargé'); } });
    assert.equal((await ctl.run({ action: 'voler' })).ok, false);
    assert.match((await ctl.run({ action: 'open', url: 'javascript:alert(1)' })).text, /Quelle adresse/);
  });
});

// Un vrai navigateur, quand la machine en a un (JARVIS_TEST_BROWSER, ou celui de Playwright dans /opt/pw-browsers).
function testBrowser() {
  if (process.env.JARVIS_TEST_BROWSER) return process.env.JARVIS_TEST_BROWSER;
  const root = '/opt/pw-browsers';
  try {
    for (const d of fs.readdirSync(root)) {
      const exe = path.join(root, d, 'chrome-linux', 'chrome');
      if (d.startsWith('chromium-') && fs.existsSync(exe)) return exe;
    }
  } catch {}
  return null;
}
const exe = testBrowser();

describe('navigateur : une vraie page', { skip: exe ? false : 'aucun navigateur sur cette machine' }, () => {
  let site;
  let base;
  let ctl;
  const PAGE = `<!DOCTYPE html><html><head><title>Boutique</title></head><body>
    <h1>Bienvenue</h1><p>Prix du jour : 42 €</p>
    <label for="q">Recherche</label><input id="q" name="q">
    <select id="taille" aria-label="Taille"><option>S</option><option>M</option></select>
    <button onclick="document.getElementById('out').textContent='Panier : ' + document.getElementById('q').value">Ajouter au panier</button>
    <p id="out"></p><a href="/page2">Suite</a></body></html>`;

  before(async () => {
    site = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(req.url === '/page2' ? '<title>Deux</title><p>Deuxième page</p>' : PAGE);
    });
    await new Promise((r) => site.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${site.address().port}`;
    ctl = createBrowserControl({
      profileDir: fs.mkdtempSync(path.join(os.tmpdir(), 'jb-')), headless: true, env: { JARVIS_BROWSER: exe },
    });
  });
  after(async () => {
    await ctl?.close();
    site?.close();
  });

  it('ouvre, lit, remplit, clique, suit un lien et revient', async () => {
    const opened = await ctl.run({ action: 'open', url: base });
    assert.equal(opened.ok, true, opened.text);
    assert.match(opened.text, /Page : Boutique/);
    assert.match(opened.text, /Prix du jour : 42 €/);
    const field = opened.text.match(/\[(\d+)\] champ « Recherche »/);
    assert.ok(field, opened.text);

    const filled = await ctl.run({ action: 'fill', target: field[1], value: 'chaussettes' });
    assert.match(filled.text, /champ « Recherche » = « chaussettes »/);

    const picked = await ctl.run({ action: 'fill', target: 'Taille', value: 'M' });
    assert.match(picked.text, /liste « Taille » = « M »/);

    const clicked = await ctl.run({ action: 'click', target: 'Ajouter au panier' });
    assert.match(clicked.text, /Panier : chaussettes/);

    const next = await ctl.run({ action: 'click', target: 'Suite' });
    assert.match(next.text, /Deuxième page/);
    const back = await ctl.run({ action: 'back' });
    assert.match(back.text, /Page : Boutique/);

    const look = await ctl.run({ action: 'look' });
    assert.ok(Buffer.from(look.jpegBase64, 'base64').subarray(0, 2).equals(Buffer.from([0xff, 0xd8])));

    const missing = await ctl.run({ action: 'click', target: 'Payer maintenant' });
    assert.equal(missing.ok, false);
    assert.match(missing.text, /^Rien trouvé/);

    assert.match((await ctl.run({ action: 'tabs' })).text, /\[1\] Boutique/);
    assert.equal((await ctl.run({ action: 'close' })).ok, true);
    assert.equal(ctl.isOpen(), false);
  });
});

describe('navigateur depuis le téléphone (POST /api/browser)', () => {
  it('déchiffre l’action, la passe au navigateur et renvoie sa réponse', async () => {
    const seen = [];
    const free = await new Promise((r) => { const s = http.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
    const srv = createRemoteServer({ mode: () => 'local',
      dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'jr-')), port: free,
      onBrowser: async (input) => { seen.push(input); return { ok: true, text: 'Page : Test' }; },
    });
    await srv.start();
    try {
      const pin = srv.newKey().key;
      const login = await call(free, 'POST', '/login', { body: { pin } });
      const { token } = JSON.parse(login.text);
      const enc = encryptCommand(pin, JSON.stringify({ action: 'open', url: 'example.com' }));
      const r = await call(free, 'POST', '/api/browser', { body: { enc }, token });
      assert.equal(r.status, 200);
      assert.deepEqual(JSON.parse(r.text), { ok: true, text: 'Page : Test' });
      assert.deepEqual(seen.at(-1), { action: 'open', url: 'example.com' });
      assert.equal((await call(free, 'POST', '/api/browser', { body: { action: 'read' } })).status, 401);
      assert.equal((await call(free, 'POST', '/api/browser', { body: { enc: 'AAAA' }, token })).status, 400);
    } finally {
      await srv.stop();
    }
  });
});

function call(port, method, pathName, { body, token } = {}) {
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
