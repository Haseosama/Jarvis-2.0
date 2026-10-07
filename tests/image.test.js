import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createImageGen, refusal, txt2imgBody, comfyWorkflow, fooocusBody } = require('../electron/imageGen.cjs');
const { createRemoteServer, encryptCommand } = require('../electron/remoteServer.cjs');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString('base64');

/** Un faux fetch : `routes` associe « MÉTHODE url » à une fonction qui rend { status, json | bytes }. */
function fakeFetch(routes, calls = []) {
  return async (url, init = {}) => {
    const key = `${init.method || 'GET'} ${url.split('?')[0]}`;
    calls.push({ key, body: init.body ? JSON.parse(init.body) : null, url });
    const handler = routes[key];
    if (!handler) throw new TypeError('fetch failed');
    const r = await handler(init);
    return {
      ok: (r.status || 200) < 300, status: r.status || 200,
      json: async () => r.json,
      arrayBuffer: async () => r.bytes,
    };
  };
}

describe('images : ce qui est refusé', () => {
  it('refuse toute demande qui parle d’enfant ou de mineur, même en mode adulte', () => {
    for (const p of ['une adolescente à la plage', 'cute teen girl', 'Loli', 'schoolgirl outfit', 'femme de 16 ans', 'girl, 15yo', 'little girl']) {
      assert.match(refusal(p, true), /enfant ni de mineur/, p);
    }
  });

  it('refuse le contenu adulte quand il n’est pas activé, et le permet sinon', () => {
    assert.match(refusal('une femme nue sur un lit', false), /contenu adulte est désactivé/);
    assert.equal(refusal('une femme nue sur un lit', true), null);
    assert.equal(refusal('un château au coucher du soleil', false), null);
    assert.equal(refusal('une femme de 25 ans', true), null);
    assert.match(refusal('  ', true), /Décrivez/);
  });

  it('écarte toujours les corps juvéniles, et le contenu adulte hors mode adulte', () => {
    const safe = txt2imgBody({ prompt: 'chat', negative: 'flou' });
    assert.match(safe.negative_prompt, /^flou, child/);
    assert.match(safe.negative_prompt, /nsfw/);
    const adult = txt2imgBody({ prompt: 'chat', adult: true });
    assert.match(adult.negative_prompt, /underage/);
    assert.doesNotMatch(adult.negative_prompt, /nsfw/);
  });

  it('borne la taille et les étapes', () => {
    const b = txt2imgBody({ prompt: 'x', width: 5000, height: 100, steps: 999 });
    assert.deepEqual([b.width, b.height, b.steps, b.seed], [1536, 512, 50, -1]);
    assert.equal(fooocusBody(txt2imgBody({ prompt: 'x', width: 1536, height: 896 })).aspect_ratios_selection, '1344*768');
  });
});

describe('images : les trois générateurs', () => {
  it('Forge / AUTOMATIC1111 : /sdapi/v1/txt2img', async () => {
    const calls = [];
    const gen = createImageGen({
      baseUrl: '',
      fetchImpl: fakeFetch({
        'GET http://127.0.0.1:7860/sdapi/v1/sd-models': () => ({ json: [] }),
        'POST http://127.0.0.1:7860/sdapi/v1/txt2img': () => ({ json: { images: [PNG], info: '{"seed":42}' } }),
      }, calls),
    });
    const r = await gen.run({ prompt: 'un phare dans la tempête' });
    assert.equal(r.ok, true, r.text);
    assert.equal(r.png, PNG);
    assert.equal(r.engine, 'forge');
    assert.match(r.text, /Forge .*graine 42/);
    assert.equal(calls.at(-1).body.prompt, 'un phare dans la tempête');
  });

  it('ComfyUI : met le graphe en file, attend l’historique et lit l’image', async () => {
    const calls = [];
    let polls = 0;
    const gen = createImageGen({
      baseUrl: '', pollMs: 1,
      fetchImpl: fakeFetch({
        'GET http://127.0.0.1:8188/system_stats': () => ({ json: {} }),
        'GET http://127.0.0.1:8188/object_info/CheckpointLoaderSimple': () => ({
          json: { CheckpointLoaderSimple: { input: { required: { ckpt_name: [['juggernautXL.safetensors', 'b.safetensors']] } } } },
        }),
        'POST http://127.0.0.1:8188/prompt': () => ({ json: { prompt_id: 'abc' } }),
        'GET http://127.0.0.1:8188/history/abc': () => (++polls < 2 ? { json: {} } : {
          json: { abc: { status: { status_str: 'success' }, outputs: { 7: { images: [{ filename: 'p.png', subfolder: '', type: 'temp' }] } } } },
        }),
        'GET http://127.0.0.1:8188/view': () => ({ bytes: Buffer.from(PNG, 'base64') }),
      }, calls),
    });
    const r = await gen.run({ prompt: 'forêt', adult: true });
    assert.equal(r.ok, true, r.text);
    assert.equal(r.png, PNG);
    assert.equal(r.engine, 'comfy');
    const graph = calls.find((c) => c.key.endsWith('/prompt')).body.prompt;
    assert.equal(graph[1].inputs.ckpt_name, 'juggernautXL.safetensors');
    assert.equal(graph[2].inputs.text, 'forêt');
    assert.match(calls.find((c) => c.key.endsWith('/view')).url, /filename=p\.png.*type=temp/);
  });

  it('Fooocus (Fooocus-API) : /v1/generation/text-to-image', async () => {
    const gen = createImageGen({
      baseUrl: '',
      fetchImpl: fakeFetch({
        'GET http://127.0.0.1:8888/ping': () => ({ json: 'pong' }),
        'POST http://127.0.0.1:8888/v1/generation/text-to-image': () => ({ json: [{ base64: PNG, seed: '7', finish_reason: 'SUCCESS' }] }),
      }),
    });
    const r = await gen.run({ prompt: 'portrait d’une guerrière elfe' });
    assert.equal(r.ok, true, r.text);
    assert.equal(r.engine, 'fooocus');
  });

  it('dit quoi lancer quand aucun générateur ne répond, et ne l’appelle pas pour une demande refusée', async () => {
    const calls = [];
    const gen = createImageGen({ baseUrl: '', fetchImpl: fakeFetch({}, calls) });
    assert.match((await gen.run({ prompt: 'un chat' })).text, /Fooocus .*ComfyUI.*Forge/);
    calls.length = 0;
    assert.equal((await gen.run({ prompt: 'a kid playing' })).ok, false);
    assert.equal(calls.length, 0);
  });
});

describe('images depuis le téléphone (POST /api/image)', () => {
  it('déchiffre la demande et renvoie l’image', async () => {
    const seen = [];
    const free = await new Promise((r) => { const s = http.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
    const srv = createRemoteServer({
      dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'jr-')), port: free,
      onImage: async (input) => { seen.push(input); return { ok: true, text: 'Image créée.', png: PNG }; },
    });
    await srv.start();
    try {
      const pin = srv.newKey().key;
      const { token } = JSON.parse((await call(free, 'POST', '/login', { body: { pin } })).text);
      const enc = encryptCommand(pin, JSON.stringify({ prompt: 'un chat', adult: false }));
      const r = await call(free, 'POST', '/api/image', { body: { enc }, token });
      assert.equal(r.status, 200);
      assert.equal(JSON.parse(r.text).png, PNG);
      assert.deepEqual(seen.at(-1), { prompt: 'un chat', adult: false });
      assert.equal((await call(free, 'POST', '/api/image', { body: { prompt: 'x' } })).status, 401);
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

const { createImageInstaller, pickGpu } = require('../electron/imageInstall.cjs');
const { EventEmitter } = require('node:events');

describe('images : ComfyUI installé par Jarvis', () => {
  it('choisit la variante selon la carte graphique', () => {
    assert.equal(pickGpu(['Intel(R) UHD Graphics 770', 'NVIDIA GeForce RTX 4070']), 'nvidia');
    assert.equal(pickGpu(['AMD Radeon RX 7800 XT']), 'amd');
    assert.equal(pickGpu(['Intel(R) Arc(TM) A770 Graphics']), 'intel');
    assert.equal(pickGpu(['Intel(R) UHD Graphics 620']), null);
    assert.equal(pickGpu([]), null);
  });

  it('télécharge 7zr, ComfyUI et le modèle, décompresse, puis lance ComfyUI à la demande', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jr-img-'));
    const got = [];
    const spawned = [];
    let running = false;
    const fetchImpl = async (url) => {
      got.push(url);
      const bytes = Buffer.from(`contenu de ${url}`);
      return { ok: true, status: 200, headers: { get: () => String(bytes.length) }, body: (async function* () { yield bytes; })() };
    };
    const spawnImpl = (cmd, args, opts) => {
      spawned.push({ cmd: path.basename(cmd), args, cwd: opts.cwd });
      const p = new EventEmitter();
      p.kill = () => {};
      if (path.basename(cmd) === '7zr.exe') {
        const out = args.find((a) => a.startsWith('-o')).slice(2);
        const base = path.join(out, 'ComfyUI_windows_portable');
        fs.mkdirSync(path.join(base, 'python_embeded'), { recursive: true });
        fs.mkdirSync(path.join(base, 'ComfyUI'), { recursive: true });
        fs.writeFileSync(path.join(base, 'python_embeded', 'python.exe'), '');
        fs.writeFileSync(path.join(base, 'ComfyUI', 'main.py'), '');
        setImmediate(() => p.emit('exit', 0));
      } else {
        running = true;
      }
      return p;
    };
    const inst = createImageInstaller({
      dataDir, fetchImpl, spawnImpl, platform: 'win32', gpus: async () => ['NVIDIA GeForce RTX 3060'], isUp: async () => running,
    });
    assert.equal(inst.status().installed, false);
    assert.match(inst.install().text, /environ 9 Go/);
    while (inst.status().installing) await new Promise((r) => setTimeout(r, 5));
    assert.equal(inst.status().step, 'done', inst.status().text);
    assert.equal(inst.installed(), true);
    assert.deepEqual(got.map((u) => u.split('/').pop()), ['7zr.exe', 'ComfyUI_windows_portable_nvidia.7z', 'Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors']);
    assert.equal(fs.existsSync(path.join(dataDir, 'images-ia', 'ComfyUI_windows_portable_nvidia.7z')), false);

    assert.equal(await inst.ensureRunning(1000), true);
    const comfy = spawned.find((s) => s.cmd === 'python.exe');
    assert.ok(comfy.args.includes('--listen') && comfy.args.includes('127.0.0.1') && comfy.args.includes('8188'));
    assert.match(inst.install().text, /déjà installé/);
  });

  it('refuse sans carte graphique utilisable, et le dit au téléphone', async () => {
    const inst = createImageInstaller({
      dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'jr-img-')), platform: 'win32', gpus: async () => ['Intel(R) UHD Graphics 620'],
      fetchImpl: async () => { throw new Error('pas de réseau attendu'); },
    });
    const gen = createImageGen({ baseUrl: '', installer: inst, fetchImpl: fakeFetch({}) });
    assert.match((await gen.run({ prompt: 'un chat' })).text, /installe le générateur d’images/);
    assert.match((await gen.run({ action: 'install' })).text, /Installation lancée/);
    while (inst.status().installing) await new Promise((r) => setTimeout(r, 5));
    assert.match((await gen.run({ action: 'status' })).text, /échoué.*carte graphique/);
  });
});
