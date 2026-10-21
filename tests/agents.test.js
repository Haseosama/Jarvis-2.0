import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hermesUrl, parseRun, runHermes, pollTasks, discover } from '../src/integrations/hermes.js';
import { ragatorUrl, withoutCitations, formatAnswer, runRagator, clip } from '../src/integrations/ragator.js';
import { resampleS16, wavFromPcm } from '../src/audio/pcm.js';
import { interpretUtterance, SATELLITE_TOOLS } from '../src/core/SatelliteBridge.js';
import { ToolRegistry } from '../src/actions/ToolRegistry.js';
import { geminiSpeak, geminiTranscribe, toBase64 } from '../src/llm/speech.js';

const memoryStore = (initial = []) => { let list = initial; return { get: () => list, set: (l) => { list = l; } }; };
const ok = (json) => ({ ok: true, status: 200, json, text: JSON.stringify(json) });

describe('Hermes', () => {
  it('adresse : https ou loopback, « /v1 » retiré, rien d’autre', () => {
    assert.equal(hermesUrl('http://127.0.0.1:8642/v1/'), 'http://127.0.0.1:8642');
    assert.equal(hermesUrl('https://hermes.example/p/sacha'), 'https://hermes.example/p/sacha');
    assert.throws(() => hermesUrl('http://192.168.1.5:8642'), /localhost/);
    assert.throws(() => hermesUrl('https://u:p@h.example'), /identifiants/);
    assert.throws(() => hermesUrl('https://h.example/?a=1'), /paramètres/);
    assert.throws(() => hermesUrl('ftp://h.example'), /Protocole/);
  });
  it('un état inconnu n’est jamais une réussite ; le jeton est masqué', () => {
    assert.equal(parseRun({ token: 't' }, { status: 'bizarre' }).status, 'unknown');
    assert.match(parseRun({ token: 't' }, { status: 'bizarre' }).error, /aucune réussite/);
    assert.equal(parseRun({ token: 'sekret' }, { status: 'completed', output: 'voici sekret fin' }).output, 'voici [masqué] fin');
    const waiting = parseRun({ token: 't' }, { status: 'waiting_for_approval', approval: { request_id: 'r1', description: 'Réserver ?' } });
    assert.deepEqual(waiting.approval, { id: 'r1', description: 'Réserver ?' });
    assert.equal(parseRun({ token: 't' }, { status: 'started' }).status, 'running');
  });
  const conn = { enabled: true, url: 'http://127.0.0.1:8642', token: 'tok', role: 'Mon agenda' };
  it('désactivé, jeton manquant, adresse invalide : refus clairs', async () => {
    const store = memoryStore();
    assert.match(await runHermes({ action: 'ask', message: 'x' }, { conn: { ...conn, enabled: false }, fetcher: async () => ok({}), store }), /pas activé/);
    assert.match(await runHermes({ action: 'ask', message: 'x' }, { conn: { ...conn, token: '' }, fetcher: async () => ok({}), store }), /jeton Hermes manquant/);
    assert.match(await runHermes({ action: 'ask', message: 'x' }, { conn: { ...conn, url: 'http://10.0.0.2' }, fetcher: async () => ok({}), store }), /status=failed/);
  });
  it('ask : envoie avec clé d’idempotence, garde la référence sans la réponse, ne renvoie jamais seul', async () => {
    const store = memoryStore();
    const calls = [];
    const fetcher = async (r) => {
      calls.push(r);
      if (r.url.endsWith('/v1/runs')) return ok({ run_id: 'run1' });
      return ok({ status: 'running', output: 'secret de la réponse' });
    };
    const out = await runHermes({ action: 'ask', message: 'Prépare trois idées de sorties' }, { conn, fetcher, store });
    assert.match(out, /status=done/);
    assert.match(out, /ne veut pas dire que l’action a réussi/);
    const first = calls[0];
    assert.equal(first.headers.Authorization, 'Bearer tok');
    assert.ok(first.headers['Idempotency-Key']);
    assert.equal(first.maxRedirects, 0);
    assert.match(JSON.parse(first.body).instructions, /Mon agenda/);
    assert.equal(store.get().length, 1);
    assert.equal(JSON.stringify(store.get()).includes('secret de la réponse'), false);
    // l'envoi échoue : état à vérifier, pas de renvoi automatique
    const store2 = memoryStore();
    const bad = await runHermes({ action: 'ask', message: 'x' }, { conn, fetcher: async () => ({ ok: false, status: 0 }), store: store2 });
    assert.match(bad, /ne sera pas renvoyée automatiquement/);
    assert.equal(store2.get()[0].status, 'unknown');
  });
  it('status, stop, steer et liste', async () => {
    const store = memoryStore([{ n: 1, runId: 'run1', status: 'running' }]);
    const fetcher = async (r) => {
      if (r.url.endsWith('/stop')) return ok({ ok: true });
      if (r.url.endsWith('/steer')) return ok({ ok: true });
      if (r.url.endsWith('/v1/capabilities')) return ok({ features: { run_submission: true, run_status: true, run_stop: true, run_steer: true } });
      if (r.url.includes('/v1/toolsets') || r.url.includes('/v1/skills')) return ok({ data: [{ name: 'agenda', description: 'Agenda', enabled: true }, { name: 'off', enabled: false }] });
      return ok({ status: 'completed', output: 'Trois idées : parc, plage, musée.' });
    };
    const st = await runHermes({ action: 'status', task: '#1' }, { conn, fetcher, store });
    assert.match(st, /terminée/);
    assert.match(st, /Trois idées/);
    assert.match(await runHermes({ action: 'stop', task: '1' }, { conn, fetcher, store }), /pas action annulée/);
    assert.match(await runHermes({ action: 'list' }, { conn, fetcher, store }), /#1/);
    const d = await runHermes({ action: 'discover' }, { conn, fetcher, store });
    assert.match(d, /capabilities=2|capabilities=1/);
    assert.match(d, /agenda/);
    assert.doesNotMatch(d, /off/);
    assert.equal((await discover({ url: 'http://127.0.0.1:1', token: 't' }, { fetcher: async () => ok({ features: {} }) })).available, false);
  });
  it('suivi : une annonce par état, accord à donner dans Hermes', async () => {
    const store = memoryStore([{ n: 2, runId: 'r2', status: 'running', announced: '' }]);
    let state = { status: 'waiting_for_approval', approval: { request_id: 'q1', description: 'Réserver le restaurant ?' } };
    const fetcher = async () => ok(state);
    const first = await pollTasks({ url: 'http://127.0.0.1:8642', token: 't' }, store, fetcher);
    assert.equal(first.length, 1);
    assert.match(first[0], /directement dans Hermes/);
    assert.equal((await pollTasks({ url: 'http://127.0.0.1:8642', token: 't' }, store, fetcher)).length, 0);
    state = { status: 'completed', output: 'ok' };
    const done = await pollTasks({ url: 'http://127.0.0.1:8642', token: 't' }, store, fetcher);
    assert.match(done[0], /terminée/);
    assert.equal(JSON.stringify(store.get()).includes('"output"'), false);
  });
});

describe('Ragator', () => {
  it('adresse : machine et réseau local en http, https ailleurs', () => {
    assert.equal(ragatorUrl(''), 'http://127.0.0.1:3210');
    assert.equal(ragatorUrl('http://nas.local:3210/'), 'http://nas.local:3210');
    assert.equal(ragatorUrl('http://192.168.1.20:3210'), 'http://192.168.1.20:3210');
    assert.throws(() => ragatorUrl('http://ragator.example.com'), /réseau local/);
    assert.equal(ragatorUrl('https://ragator.example.com'), 'https://ragator.example.com');
  });
  it('retire les citations et coupe à la phrase', () => {
    assert.equal(withoutCitations('La glacière [Gu8bnHQaG5s:t00062 @ 03:45] est bleue [abc12345].'), 'La glacière est bleue.');
    assert.equal(clip('Une phrase. Une autre phrase très longue qui dépasse.', 20), 'Une phrase.');
  });
  const payload = { answer: 'Ils en parlent [Gu8bnHQaG5s:t1 @ 01:02].', refused: false, route: 'rag', degradedReason: 'lexical', sources: [{ videoId: 'Gu8bnHQaG5s', title: 'Le skee-ball', startS: 3725, publishedAt: '2024-03-09T10:00:00Z', link: 'https://youtu.be/Gu8bnHQaG5s?t=3725' }, { videoId: 'x', title: 'mauvais', link: 'http://x' }] };
  it('formate réponse, vidéos et mode dégradé ; refus du corpus', () => {
    const text = formatAnswer(payload, 'q');
    assert.match(text, /^Ils en parlent\./);
    assert.match(text, /Réponse dégradée/);
    assert.match(text, /Le skee-ball — à 1:02:05 · vidéo du 09\/03\/2024 — https:\/\/youtu\.be/);
    assert.doesNotMatch(text, /mauvais/);
    assert.match(formatAnswer({ ...payload, refused: true }, 'q'), /ne contient pas l’information/);
    assert.equal(formatAnswer({ nope: 1 }, 'q'), null);
  });
  it('outil : corps de la requête, erreurs traduites, jamais le message brut', async () => {
    const seen = [];
    const fetcher = async (r) => { seen.push(r); return ok(payload); };
    const out = await runRagator({ question: 'Comment ils ont fabriqué le skee-ball ?' }, { baseUrl: 'http://127.0.0.1:3210', collection: 'poulain', detailed: true, fetcher });
    assert.match(out, /Ils en parlent/);
    assert.deepEqual(JSON.parse(seen[0].body), { question: 'Comment ils ont fabriqué le skee-ball ?', mode: 'détaillé', collection: 'poulain' });
    assert.equal(seen[0].url, 'http://127.0.0.1:3210/api/ask');
    assert.match(await runRagator({ question: 'q' }, { baseUrl: '', fetcher: async () => ({ ok: false, status: 403 }) }), /RAGATOR_HOSTS/);
    assert.match(await runRagator({ question: 'q' }, { baseUrl: '', collection: 'zz', fetcher: async () => ({ ok: false, status: 400, text: 'collection inconnue: zz' }) }), /inconnue de Ragator/);
    assert.match(await runRagator({ question: '' }, { baseUrl: '', fetcher }), /question manquante/);
    assert.match(await runRagator({ question: 'q' }, { baseUrl: '', fetcher: async () => ({ ok: false, status: 0, error: 'ECONNREFUSED' }) }), /injoignable/);
    const status = await runRagator({ action: 'status' }, { baseUrl: '', fetcher: async () => ok({ collections: [{ key: 'a', name: 'A', videos: 10 }, { key: 'b', name: 'B', videos: 5 }] }) });
    assert.match(status, /videos=15/);
  });
});

describe('satellites : pont voix', () => {
  it('mot d’éveil en veille, tout est écouté en conversation, au revoir', () => {
    assert.deepEqual(interpretUtterance('il fait beau', { conversation: false, wakeWord: 'jarvis' }), { wake: false, command: '' });
    assert.equal(interpretUtterance('Hey Jarvis quelle heure est-il', { conversation: false, wakeWord: 'jarvis' }).command, 'quelle heure est il');
    assert.equal(interpretUtterance('et demain ?', { conversation: true, wakeWord: 'jarvis' }).command, 'et demain ?');
    assert.equal(interpretUtterance('merci Jarvis', { conversation: true, wakeWord: 'jarvis' }).goodbye, true);
    assert.equal(interpretUtterance('', { conversation: true, wakeWord: 'jarvis' }).command, '');
  });
  it('rééchantillonne 24 kHz → 16 kHz et enveloppe en WAV', () => {
    const src = new Uint8Array(24000 * 2); // 1 s
    assert.equal(resampleS16(src, 24000, 16000).length, 16000 * 2);
    assert.equal(resampleS16(src, 16000, 16000), src);
    const wav = wavFromPcm(new Uint8Array(100));
    assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
    assert.equal(wav.length, 144);
  });
  it('depuis un satellite, seuls les outils d’information passent', async () => {
    const reg = new ToolRegistry({});
    let ran = 0;
    reg.register({ name: 'device_settings_x', description: '', run: async () => { ran++; return 'fait'; } });
    reg.register({ name: 'world_clock', description: '', run: async () => 'heure' });
    const inside = await reg.withAllowlist(SATELLITE_TOOLS, async () => [await reg.execute('device_settings_x', {}), await reg.execute('world_clock', {})]);
    assert.match(inside[0], /satellite audio/);
    assert.equal(inside[1], 'heure');
    assert.equal(ran, 0);
    assert.equal(await reg.execute('device_settings_x', {}), 'fait');
    for (const dangerous of ['pc_control', 'file_manager', 'device_settings', 'send_message', 'reverse_engineer', 'agent_hermes', 'navigateur', 'google_workspace', 'open_app']) {
      assert.equal(SATELLITE_TOOLS.includes(dangerous), false, dangerous);
    }
  });
  it('Gemini REST : transcription et synthèse', async () => {
    let seen;
    const t = await geminiTranscribe({ apiKey: 'k', wav: new Uint8Array([1, 2]) }, async (r) => { seen = r; return ok({ candidates: [{ content: { parts: [{ text: ' bonjour ' }] } }] }); });
    assert.equal(t.text, 'bonjour');
    assert.equal(seen.headers['x-goog-api-key'], 'k');
    assert.equal(seen.url.includes('key='), false, 'la clé ne passe pas dans l’URL');
    const s = await geminiSpeak({ apiKey: 'k', input: 'salut' }, async () => ok({ candidates: [{ content: { parts: [{ inlineData: { data: toBase64(new Uint8Array([5, 6])) } }] } }] }));
    assert.deepEqual([...s.bytes], [5, 6]);
    assert.equal(s.rate, 24000);
    assert.equal((await geminiSpeak({ apiKey: '', input: 'x' })).ok, false);
  });
});
