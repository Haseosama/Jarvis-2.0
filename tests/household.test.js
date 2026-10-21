import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { effectiveProfileId, findProfile, profilePromptLine, profileState, visibleMemories } from '../src/core/profiles.js';
import { buildLocalVisionRequest, describeImage, runCameraLook } from '../src/llm/vision.js';
import { clockCard, transitCard, weatherCard, weatherSnapshot, nextMinute } from '../src/core/ambient.js';
import { PresenceTracker } from '../src/vision/presenceTracker.js';
import { runExternalModules, refOf } from '../src/integrations/externalModules.js';
import { ToolRegistry } from '../src/actions/ToolRegistry.js';
import { dataStore } from '../src/core/DataStore.js';

const require = createRequire(import.meta.url);
const openai = require('../electron/openaiImage.cjs');
const mdns = require('../electron/mdns.cjs');
const { createModuleHost, nodeOk, checkedDir } = require('../electron/moduleHost.cjs');

const ok = (json) => ({ ok: true, status: 200, json, text: JSON.stringify(json) });

describe('images OpenAI', () => {
  it('refuse les mineurs et le contenu adulte, choisit la taille, valide le modèle', () => {
    assert.match(openai.buildRequest({ prompt: 'a child playing' }).error, /enfant ni de mineur/);
    assert.match(openai.buildRequest({ prompt: 'a nude woman' }).error, /n’accepte pas le contenu adulte/);
    assert.match(openai.buildRequest({ prompt: '' }).error, /Décrivez/);
    assert.match(openai.buildRequest({ prompt: 'un chat' }, { model: 'bad model!' }).error, /invalide/);
    const r = openai.buildRequest({ prompt: 'un chat', width: 1536, height: 832, style: 'photo' }, { model: 'gpt-image-1', quality: 'high' });
    assert.equal(r.body.size, '1536x1024');
    assert.equal(r.body.quality, 'high');
    assert.match(r.body.prompt, /^Photorealistic/);
    assert.equal(openai.pickSize(832, 1216), '1024x1536');
    assert.equal(openai.pickSize(1000, 1000), '1024x1024');
  });
  const fakeFetch = (status, body) => async () => ({ status, ok: status < 300, headers: { get: () => null }, body: null, arrayBuffer: async () => Buffer.from(JSON.stringify(body)) });
  it('appelle l’API avec la clé en en-tête et traduit les erreurs', async () => {
    let seen;
    const f = async (url, init) => { seen = { url, init }; return fakeFetch(200, { data: [{ b64_json: 'QUJD' }] })(); };
    const res = await openai.generate({ prompt: 'un chat roux' }, { model: 'gpt-image-1' }, 'sk-test', { fetchImpl: f });
    assert.equal(res.ok, true);
    assert.equal(res.png, 'QUJD');
    assert.equal(seen.url, 'https://api.openai.com/v1/images/generations');
    assert.equal(seen.init.headers.Authorization, 'Bearer sk-test');
    assert.equal(JSON.parse(seen.init.body).n, 1);
    assert.match((await openai.generate({ prompt: 'x chat' }, {}, '', { fetchImpl: f })).text, /Aucune clé OpenAI/);
    assert.match((await openai.generate({ prompt: 'un chat' }, {}, 'k', { fetchImpl: fakeFetch(401, { error: { message: 'bad' } }) })).text, /clé OpenAI refusée/);
    assert.match((await openai.generate({ prompt: 'un chat' }, {}, 'k', { fetchImpl: fakeFetch(400, { error: { message: 'safety system' } }) })).text, /modération/);
    assert.match((await openai.generate({ prompt: 'un chat' }, {}, 'k', { fetchImpl: fakeFetch(200, { data: [] }) })).text, /aucune image/);
  });
});

describe('profils et mémoire par personne', () => {
  const data = {
    profiles: [{ id: 'p1', name: 'Sacha' }, { id: 'p2', name: 'Léa' }],
    activeProfileId: 'p1',
    memories: [{ key: 'wifi', value: 'abc' }, { key: 'café', value: 'noir', profileId: 'p1' }, { key: 'secret', value: 'x', profileId: 'p2' }],
  };
  it('chacun ne voit que le foyer et ses propres souvenirs', () => {
    assert.deepEqual(visibleMemories(data, 'p1').map((m) => m.key), ['wifi', 'café']);
    assert.deepEqual(visibleMemories(data, 'p2').map((m) => m.key), ['wifi', 'secret']);
    assert.deepEqual(visibleMemories(data, null).map((m) => m.key), ['wifi']);
  });
  it('vie privée et satellites : seulement le foyer', () => {
    assert.equal(effectiveProfileId(data, { override: undefined, privacy: false }), 'p1');
    assert.equal(effectiveProfileId(data, { override: undefined, privacy: true }), null);
    assert.equal(effectiveProfileId(data, { override: null, privacy: false }), null);
    assert.equal(effectiveProfileId({ ...data, activeProfileId: 'inconnu' }, { override: undefined, privacy: false }), null);
    assert.match(profilePromptLine(data, { override: undefined, privacy: true }), /mode vie privée/);
    assert.match(profilePromptLine(data, { override: undefined, privacy: false }), /Personne actuelle : Sacha/);
    assert.equal(profilePromptLine({ profiles: [] }, profileState), '');
  });
  it('retrouve un profil sans tenir compte des accents', () => {
    assert.equal(findProfile(data.profiles, 'lea').id, 'p2');
    assert.equal(findProfile(data.profiles, 'SACHA').id, 'p1');
    assert.equal(findProfile(data.profiles, 'zoé'), null);
  });
  it('outils : souvenir personnel, partage, changement de personne, suppression gardée par confirmation', async () => {
    dataStore.update({ profiles: [], memories: [], activeProfileId: null });
    const reg = new ToolRegistry({});
    assert.match(await reg.execute('profile', { action: 'add', name: 'Sacha' }), /status=done/);
    assert.match(await reg.execute('profile', { action: 'add', name: 'Léa' }), /current=Léa/);
    await reg.execute('remember_fact', { key: 'couleur', value: 'bleu' });
    await reg.execute('remember_fact', { key: 'wifi', value: 'abc', shared: true });
    assert.match(await reg.execute('profile', { action: 'switch', name: 'sacha' }), /current=Sacha/);
    await reg.execute('remember_fact', { key: 'couleur', value: 'rouge' });
    const mine = await reg.execute('list_memories', {});
    assert.match(mine, /couleur : rouge/);
    assert.doesNotMatch(mine, /bleu/);
    assert.match(mine, /wifi/);
    await reg.execute('profile', { action: 'switch', name: 'Léa' });
    assert.match(await reg.execute('recall_memory', { query: 'couleur' }), /bleu/);
    assert.match(await reg.execute('profile', { action: 'switch', name: 'Inconnu' }), /status=failed/);
    assert.match(await reg.execute('profile', { action: 'guest' }), /foyer/);
    assert.doesNotMatch(await reg.execute('list_memories', {}), /couleur/);
    assert.match(await reg.execute('profile', { action: 'remove', name: 'Léa' }), /status=failed|CONFIRMATION_PENDING/);
    assert.equal(dataStore.get().profiles.length, 2, 'rien n’est supprimé sans confirmation');
  });
});

describe('vision locale', () => {
  const img = 'data:image/jpeg;base64,/9j/AAAA';
  it('requête OpenAI-compatible avec image, adresse protégée', () => {
    const r = buildLocalVisionRequest({ baseUrl: 'http://localhost:11434/v1', model: 'llava', dataUrl: img, question: 'Que vois-tu ?' });
    assert.equal(r.url, 'http://localhost:11434/v1/chat/completions');
    const body = JSON.parse(r.body);
    assert.equal(body.messages[0].content[1].image_url.url, img);
    assert.equal(body.stream, false);
    assert.throws(() => buildLocalVisionRequest({ baseUrl: 'http://autre.example', dataUrl: img }), /localhost/);
    assert.throws(() => buildLocalVisionRequest({ baseUrl: 'http://localhost:11434/v1', dataUrl: 'javascript:alert(1)' }), /invalide/);
  });
  it('décrit en local (blocs de réflexion masqués) ou avec Gemini ; erreurs claires', async () => {
    const local = await describeImage({ dataUrl: img, cfg: { engine: 'local', model: 'llava' } }, async () => ok({ choices: [{ message: { content: '<think>hm</think>Une pièce lumineuse.' } }] }));
    assert.equal(local.text, 'Une pièce lumineuse.');
    const gem = await describeImage({ dataUrl: img, cfg: { engine: 'gemini', geminiKey: 'k' } }, async (r) => { assert.equal(r.headers['x-goog-api-key'], 'k'); assert.equal(JSON.parse(r.body).contents[0].parts[1].inline_data.mime_type, 'image/jpeg'); return ok({ candidates: [{ content: { parts: [{ text: 'Un salon.' }] } }] }); });
    assert.equal(gem.text, 'Un salon.');
    assert.match((await describeImage({ dataUrl: img, cfg: { engine: 'local' } }, async () => ({ ok: false, status: 0 }))).error, /injoignable/);
    assert.match((await describeImage({ dataUrl: img, cfg: { engine: 'local' } }, async () => ({ ok: false, status: 404 }))).error, /ollama pull/);
    assert.match((await describeImage({ dataUrl: img, cfg: { engine: 'gemini' } })).error, /Clé Gemini/);
  });
  it('l’outil prend une photo à la demande, jamais de flux continu', async () => {
    assert.match(await runCameraLook({ mode: 'start' }, { capture: async () => img, cfg: { engine: 'local' } }), /flux continu/);
    assert.match(await runCameraLook({}, { capture: async () => { throw new Error('refusé'); }, cfg: { engine: 'local' } }), /webcam inaccessible/);
    const out = await runCameraLook({ question: 'qui est là ?' }, { capture: async () => img, cfg: { engine: 'local' }, describe: async ({ question }) => ({ ok: true, text: `réponse à ${question}` }) });
    assert.match(out, /status=done/);
    assert.match(out, /réponse à qui est là \?/);
  });
});

describe('cartes ambiantes', () => {
  const at = Date.UTC(2026, 9, 21, 12, 30, 0);
  it('horloge dans le fuseau du foyer, rafraîchie à la minute suivante', () => {
    const c = clockCard(at, 'Asia/Tokyo');
    assert.match(c.primary, /21 h 30/);
    assert.match(c.subtitle, /mercredi/);
    assert.equal(c.refreshAt, nextMinute(at));
    assert.match(clockCard(at, 'Fuseau/Invalide').primary, /14 h 30/);
  });
  const dep = (minutes, extra = {}) => ({ at: at + minutes * 60000, realtime: true, cancelled: false, line: '102', direction: 'Gare', ...extra });
  it('bus : compte à rebours recalculé sans réseau, panne ≠ aucun bus', () => {
    const snap = { at, departures: [dep(5), dep(15), dep(25)] };
    assert.equal(transitCard(snap, at, 'maison').primary, '5 min');
    assert.equal(transitCard(snap, at + 3 * 60000, 'maison').primary, '2 min');
    assert.equal(transitCard(snap, at + 3 * 60000, 'maison').items[0].value, '12 min · ligne 102');
    assert.equal(transitCard({ ...snap, failedAt: at + 1000 }, at, 'maison').status, 'stale');
    assert.match(transitCard({ ...snap, failedAt: at + 1000 }, at, 'm').subtitle, /dernier horaire connu/);
    assert.equal(transitCard({ at, departures: [] }, at, 'm').primary, 'Aucun passage');
    const expired = transitCard(snap, at + 40 * 60000, 'm');
    assert.equal(expired.primary, '—');
    assert.match(expired.subtitle, /dépassés/);
    assert.equal(transitCard(snap, at + 25 * 3600000, 'm').status, 'stale');
    assert.equal(transitCard(null, at, 'm').status, 'pending');
    assert.match(transitCard({ at, departures: [dep(5, { realtime: false })] }, at, 'm').subtitle, /horaire théorique/);
  });
  it('météo : jour courant, changement à minuit, relevé trop ancien écarté', () => {
    const snap = weatherSnapshot({ current: { temperature_2m: 14.6 }, daily: { time: ['2026-10-21', '2026-10-22'], temperature_2m_min: [8, 7], temperature_2m_max: [16, 12], weather_code: [3, 61], precipitation_probability_max: [10, 70] } }, at);
    const today = weatherCard(snap, at, 'Europe/Paris');
    assert.equal(today.primary, '15°');
    assert.match(today.subtitle, /Couvert · min 8° \/ max 16°/);
    const tomorrow = weatherCard(snap, at + 12 * 3600000, 'Europe/Paris');
    assert.equal(tomorrow.primary, '12°');
    assert.equal(tomorrow.items[0].value, '70 %');
    assert.equal(weatherCard(snap, at + 26 * 3600000, 'Europe/Paris').status, 'stale');
    assert.equal(weatherSnapshot({}), null);
  });
});

describe('présence par caméra', () => {
  it('lisse les mesures : arrivée, plusieurs personnes, départ', () => {
    const t = new PresenceTracker({ absentAfterMs: 5000, multiClearMs: 3000 });
    let now = 0;
    const step = (n, dt = 400) => { now += dt; return t.push(n, now); };
    assert.deepEqual(step(1).events, []);
    assert.deepEqual(step(1).events, ['arrived']);
    assert.deepEqual(step(2).events, []);
    assert.deepEqual(step(2).events, ['multiple']);
    assert.equal(step(1).state.multiple, true, 'pas de clignotement');
    assert.deepEqual(step(1, 3000).events, ['alone']);
    assert.deepEqual(step(0, 2000).events, [], 'une détection manquée ne fait pas partir');
    assert.deepEqual(step(0, 4000).events, ['left']);
    assert.equal(t.state.present, false);
  });
  it('le modèle de visages embarqué est celui dont l’empreinte est annoncée', () => {
    const file = path.join(process.cwd(), 'public', 'models', 'blaze_face_short_range.tflite');
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), 'b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f');
  });
});

describe('annonce mDNS des satellites', () => {
  function names(buf) {
    const out = [];
    const count = buf.readUInt16BE(6) + buf.readUInt16BE(10);
    let pos = 12;
    for (let i = 0; i < count; i++) {
      const { name, next } = mdns.readName(buf, pos);
      const type = buf.readUInt16BE(next);
      const len = buf.readUInt16BE(next + 8);
      out.push({ name, type, data: buf.subarray(next + 10, next + 10 + len) });
      pos = next + 10 + len;
    }
    return out;
  }
  const rec = mdns.buildRecords({ instance: 'Jarvis', host: 'pc-salon', port: 3443, addresses: ['192.168.1.20'], txt: ['path=/satellite', 'protocol=1', 'key=abcd'] });
  it('répond à la recherche du service _cornelius._tcp avec PTR, SRV, TXT et A', () => {
    const q = Buffer.concat([Buffer.alloc(12), mdns.encodeName('_cornelius._tcp.local'), Buffer.from([0, 12, 0, 1])]);
    q.writeUInt16BE(1, 4);
    const reply = mdns.answerFor(mdns.parseQuestions(q), rec);
    const all = names(reply);
    assert.deepEqual(all.map((r) => r.type).sort((a, b) => a - b), [1, 12, 16, 33]);
    const ptr = all.find((r) => r.type === 12);
    assert.equal(ptr.name, '_cornelius._tcp.local');
    assert.equal(mdns.readName(ptr.data, 0).name, 'Jarvis._cornelius._tcp.local');
    const srv = all.find((r) => r.type === 33);
    assert.equal(srv.data.readUInt16BE(4), 3443);
    assert.equal(mdns.readName(srv.data, 6).name, 'pc-salon.local');
    assert.deepEqual([...all.find((r) => r.type === 1).data], [192, 168, 1, 20]);
    assert.match(all.find((r) => r.type === 16).data.toString('utf8'), /path=\/satellite/);
    assert.equal(reply.readUInt16BE(2), 0x8400);
  });
  it('ignore les autres questions et les réponses', () => {
    const other = Buffer.concat([Buffer.alloc(12), mdns.encodeName('_http._tcp.local'), Buffer.from([0, 12, 0, 1])]);
    other.writeUInt16BE(1, 4);
    assert.equal(mdns.answerFor(mdns.parseQuestions(other), rec), null);
    const response = Buffer.from(other);
    response.writeUInt16BE(0x8400, 2);
    assert.deepEqual(mdns.parseQuestions(response), []);
    assert.deepEqual(mdns.parseQuestions(Buffer.from([1, 2, 3])), []);
  });
  it('relit les noms compressés sans boucler', () => {
    const loop = Buffer.concat([Buffer.alloc(12), Buffer.from([0xc0, 12])]);
    assert.throws(() => mdns.readName(loop, 12));
  });
});

describe('modules externes : outil', () => {
  const mod = { id: 'vacances', version: '1', sourceLabel: 'Vacances', display: { name: 'Vacances', description: 'Les vacances.', example: { label: 'Vacances zone C' } }, secrets: [], configSchema: { required: ['zone'], properties: { zone: { type: 'string', title: 'Zone', enum: ['A', 'B', 'C'] } } }, configDefaults: { zone: 'C' }, ambient: true };
  const keyed = { ...mod, id: 'agenda', secrets: [{ name: 'tok', label: 'un jeton agenda', url: 'https://x.example' }] };
  const stores = () => {
    let sources = []; let snaps = {};
    return { sources: { get: () => sources, set: (v) => { sources = v; } }, snapshots: { get: () => snaps, set: (v) => { snaps = v; } } };
  };
  const mkHost = (handlers) => async (req) => (req.op === 'list' ? { ok: true, result: { modules: [mod, keyed], failed: [{ dir: 'casse', reason: 'icône inconnue' }] } } : handlers[req.op](req));
  const card = { title: 'Vacances', summary: 'En vacances jusqu’au 2 novembre.', items: [{ label: 'Prochaines', value: 'Noël' }] };
  it('liste, décrit, ajoute après un essai, lit depuis le cache puis en direct', async () => {
    const store = stores();
    let reads = 0;
    const deps = { store, timeZone: 'Europe/Paris', host: mkHost({ read: async () => { reads++; return { ok: true, result: { snapshot: { status: 'ready', data: { z: 1 } }, card, freshMs: 60000 } }; }, present: async () => ({ ok: true, result: { card } }) }) };
    assert.match(await runExternalModules({ action: 'list' }, deps), /vacances — Vacances : Les vacances\.[\s\S]*casse : icône inconnue/);
    assert.match(await runExternalModules({ action: 'describe', module: 'vacances' }, deps), /zone \* \[string\] \(choix : A, B, C\)/);
    assert.match(await runExternalModules({ action: 'add', module: 'vacances', name: 'Vacances zone C', config: '{"zone":"C"}' }, deps), /status=done[\s\S]*En vacances/);
    assert.equal(store.sources.get()[0].ref, 'vacances-zone-c');
    assert.match(await runExternalModules({ action: 'add', module: 'vacances', name: 'Vacances zone C' }, deps), /existe déjà/);
    const cached = await runExternalModules({ action: 'read', name: 'vacances' }, { ...deps, now: () => Date.now() });
    assert.match(cached, /cache=true/);
    assert.equal(reads, 1, 'le relevé frais est réutilisé sans réseau');
    const later = Date.now() + 10 * 60000;
    await runExternalModules({ action: 'read', name: 'zone c' }, { ...deps, now: () => later });
    assert.equal(reads, 2);
    assert.match(await runExternalModules({ action: 'ambient', name: 'vacances', on: true }, deps), /status=done/);
    assert.equal(store.sources.get()[0].ambient, true);
  });
  it('jeton manquant, config invalide, panne avec dernier relevé, suppression', async () => {
    const store = stores();
    const fail = { ok: false, error: { code: 'unavailable', message: 'Destination injoignable.' } };
    let down = false;
    const deps = { store, secrets: async () => ({}), host: mkHost({ read: async () => (down ? fail : { ok: true, result: { snapshot: { status: 'ready', data: {} }, card, freshMs: 5000 } }), present: async (r) => ({ ok: true, result: { card: { ...card, summary: r.snapshot.status === 'stale' ? 'ancien' : 'frais' } } }) }) };
    assert.match(await runExternalModules({ action: 'add', module: 'agenda', name: 'Famille' }, deps), /jeton manquant : un jeton agenda/);
    assert.match(await runExternalModules({ action: 'add', module: 'vacances', name: 'V', config: 'pas du json' }, deps), /objet JSON/);
    await runExternalModules({ action: 'add', module: 'vacances', name: 'V' }, deps);
    down = true;
    const stale = await runExternalModules({ action: 'read', name: 'v' }, { ...deps, now: () => Date.now() + 3600000 });
    assert.match(stale, /stale=true/);
    assert.match(stale, /Dernier relevé connu/);
    assert.match(stale, /Le service ne répond pas/);
    assert.match(await runExternalModules({ action: 'read', name: 'v', query: 'x' }, { ...deps, now: () => Date.now() + 3600000 }), /status=failed/);
    assert.match(await runExternalModules({ action: 'remove', name: 'v' }, deps), /status=done/);
    assert.match(await runExternalModules({ action: 'read', name: 'v' }, deps), /aucune source/);
    assert.equal(refOf('Vacances zone C !'), 'vacances-zone-c');
  });
  it('désactivé : l’erreur du processus principal est dite telle quelle', async () => {
    const out = await runExternalModules({ action: 'list' }, { store: stores(), host: async () => ({ ok: false, error: { code: 'config_invalid', message: 'Les modules externes sont désactivés.' } }) });
    assert.match(out, /Réglage incomplet : Les modules externes sont désactivés/);
  });
});

describe('modules externes : processus réel (Node 24.2+)', { skip: !nodeOk(process.version) }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-mod-'));
  let server;
  let port;
  const host = createModuleHost();
  after(async () => { host.stop(); server?.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  it('charge un module TypeScript au contrat, collecte, présente, refuse une config invalide', async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/redirect') { res.writeHead(302, { Location: '/fruits' }); res.end(); return; }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ fruits: ['pomme', 'poire'] }));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
    fs.mkdirSync(path.join(dir, '_lib'));
    fs.mkdirSync(path.join(dir, 'fruits'));
    fs.mkdirSync(path.join(dir, 'casse'));
    fs.writeFileSync(path.join(dir, '_lib', 'texte.ts'), 'export function joli(items: string[]): string { return items.join(" et "); }\n');
    fs.writeFileSync(path.join(dir, 'fruits', 'config.schema.json'), JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', additionalProperties: false, required: ['port'], properties: { port: { type: 'integer', minimum: 1, maximum: 65535 } } }));
    fs.writeFileSync(path.join(dir, 'fruits', 'data.schema.json'), JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', additionalProperties: false, required: ['fruits'], properties: { fruits: { type: 'array', items: { type: 'string' } } } }));
    fs.writeFileSync(path.join(dir, 'fruits', 'index.ts'), `
import { AddonCollectError, type AddonDefinition } from '#cornelius/addons';
import { compile } from '#cornelius/validation';
import { joli } from '../_lib/texte.js';
import configSchema from './config.schema.json' with { type: 'json' };
import dataSchema from './data.schema.json' with { type: 'json' };
type Cfg = { port: number };
type Data = { fruits: string[] };
const check = compile<Data>(dataSchema);
const addon: AddonDefinition<Cfg, Data> = {
  id: 'fruits', apiVersion: 1, version: '1.0.0', sourceLabel: 'Fruits', display: { name: 'Fruits', description: 'Des fruits.', icon: 'leaf' },
  configVersion: 1, configSchema, configDefaults: { port: 80 }, dataVersion: 1, dataSchema, freshMs: 60000,
  tools: [{ name: 'read', description: 'Lire', parameters: { type: 'object', properties: {} } }],
  async collect(context) {
    const r = await context.http.fetch({ url: 'http://127.0.0.1:' + context.config.port + '/redirect', signal: context.signal });
    if (r.status !== 200) throw new AddonCollectError('upstream', 'Statut ' + r.status);
    const body = r.json();
    if (!check(body)) throw new AddonCollectError('malformed', 'Forme inattendue.');
    return { data: body, source: { provider: 'local', sourceId: 'test' } };
  },
  present(snapshot) {
    const d = snapshot.data!;
    return { title: 'Fruits', primaryValue: String(d.fruits.length), subtitle: snapshot.status === 'stale' ? 'ancien' : null, description: null, items: [], summary: joli(d.fruits) };
  },
  ambient: { present(s) { return { layout: 'metric', title: 'Fruits', value: String(s.data!.fruits.length), subtitle: null, items: [] }; } },
};
export default addon;
`);
    fs.writeFileSync(path.join(dir, 'casse', 'index.ts'), 'export default { id: "autre", apiVersion: 1 };\n');
    const list = await host.call(dir, { op: 'list' });
    assert.equal(list.ok, true, JSON.stringify(list));
    assert.deepEqual(list.result.modules.map((m) => m.id), ['fruits']);
    assert.equal(list.result.modules[0].ambient, true);
    assert.match(list.result.failed[0].reason, /égal au nom du dossier/);

    const read = await host.call(dir, { op: 'read', id: 'fruits', config: { port }, instance: { name: 'Mes fruits', ref: 'fruits' } });
    assert.equal(read.ok, true, JSON.stringify(read));
    assert.equal(read.result.card.summary, 'pomme et poire');
    assert.equal(read.result.snapshot.status, 'ready');
    assert.equal(read.result.ambient.value, '2');
    assert.equal(read.result.freshMs, 60000);

    const again = await host.call(dir, { op: 'present', id: 'fruits', snapshot: { ...read.result.snapshot, status: 'stale' }, instance: { name: 'x', ref: 'x' } });
    assert.equal(again.result.card.subtitle, 'ancien');

    const bad = await host.call(dir, { op: 'read', id: 'fruits', config: { port: 'abc' }, instance: {} });
    assert.equal(bad.ok, false);
    assert.equal(bad.error.code, 'config_invalid');
    const down = await host.call(dir, { op: 'read', id: 'fruits', config: { port: 1 }, instance: {} });
    assert.equal(down.error.code, 'unavailable');
    const unknown = await host.call(dir, { op: 'read', id: 'zzz', config: {}, instance: {} });
    assert.equal(unknown.error.code, 'not_found');
  });

  it('refuse un dossier invalide', async () => {
    assert.match(checkedDir('relatif').error, /absolu/);
    assert.match(checkedDir(`${dir}/x/../y`).error, /absolu/);
    assert.match(checkedDir(path.join(dir, 'inexistant')).error, /introuvable/);
    assert.equal((await host.call('relatif', { op: 'list' })).error.code, 'config_invalid');
  });
});
