import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PROVIDERS, buildRequest, callModel, listModels, parseResponse, validateBaseUrl } from '../src/llm/providers.js';
import { applyVote, ELO_START, leaderboard, runComparison } from '../src/llm/compare.js';
import { extractCodeBlocks, safeRelativePath, suggestFilename, withAttachedFile } from '../src/llm/codeTools.js';
import { llmStore, sanitizeState } from '../src/llm/llmStore.js';
import { hostBridge } from '../src/core/hostBridge.js';
import { ToolRegistry } from '../src/actions/ToolRegistry.js';
import { JarvisEngine } from '../src/core/JarvisEngine.js';

const msgs = [{ role: 'user', content: 'bonjour' }];

describe('Studio IA : fournisseurs par API officielle', () => {
  it('builds OpenAI-compatible, Anthropic and Gemini requests with the right auth', () => {
    const o = buildRequest({ provider: 'openai', model: 'm', messages: msgs, system: 'sys', apiKey: 'sk-test-123456' });
    assert.equal(o.url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(o.headers.authorization, 'Bearer sk-test-123456');
    assert.deepEqual(JSON.parse(o.body).messages.map((m) => m.role), ['system', 'user']);
    const a = buildRequest({ provider: 'anthropic', model: 'm', messages: msgs, system: 'sys', apiKey: 'k-anthropic' });
    assert.equal(a.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(a.headers['x-api-key'], 'k-anthropic');
    assert.equal(a.headers['anthropic-version'], '2023-06-01');
    const ab = JSON.parse(a.body);
    assert.equal(ab.system, 'sys');
    assert.ok(ab.max_tokens > 0, 'Anthropic requires max_tokens');
    const g = buildRequest({ provider: 'gemini', model: 'gemini-x', messages: [{ role: 'assistant', content: 'a' }, ...msgs], apiKey: 'AIza-secret' });
    assert.ok(!g.url.includes('AIza-secret'), 'the Gemini key never goes in the URL');
    assert.equal(g.headers['x-goog-api-key'], 'AIza-secret');
    assert.equal(JSON.parse(g.body).contents[0].role, 'model');
    const local = buildRequest({ provider: 'local', model: 'llama', messages: msgs });
    assert.equal(local.url, 'http://localhost:11434/v1/chat/completions');
    assert.equal(local.headers.authorization, undefined);
  });

  it('only sends keys over https (http is limited to localhost) and rejects embedded credentials', () => {
    assert.equal(validateBaseUrl('https://example.com/v1/'), 'https://example.com/v1');
    assert.equal(validateBaseUrl('http://127.0.0.1:1234/v1'), 'http://127.0.0.1:1234/v1');
    assert.throws(() => validateBaseUrl('http://example.com/v1'), /localhost/);
    assert.throws(() => validateBaseUrl('https://user:pw@example.com/v1'), /identifiants/);
    assert.throws(() => validateBaseUrl('ftp://example.com'), /Protocole|invalide/);
    assert.throws(() => validateBaseUrl('nope'), /invalide/);
  });

  it('parses the three response shapes', () => {
    assert.equal(parseResponse('openai', { choices: [{ message: { content: 'salut' } }], usage: { prompt_tokens: 3, completion_tokens: 5 } }).text, 'salut');
    assert.deepEqual(parseResponse('anthropic', { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }], usage: { input_tokens: 1, output_tokens: 2 } }), { text: 'ab', usage: { input: 1, output: 2 } });
    assert.equal(parseResponse('gemini', { candidates: [{ content: { parts: [{ text: 'x', thought: true }, { text: 'y' }] } }] }).text, 'y');
  });

  it('never throws, redacts the key from errors and reports latency', async () => {
    const key = 'sk-very-secret-key';
    const fail = await callModel({ provider: 'openai', model: 'm', messages: msgs, apiKey: key }, async () => ({ ok: false, status: 401, json: { error: { message: `bad key ${key}` } }, text: '' }));
    assert.equal(fail.ok, false);
    assert.ok(!fail.error.includes(key));
    assert.match(fail.error, /401/);
    assert.equal((await callModel({ provider: 'openai', model: 'm', messages: msgs }, async () => assert.fail('no call without key'))).ok, false);
    const ok = await callModel({ provider: 'local', model: 'm', messages: msgs }, async (req) => {
      assert.ok(req.timeoutMs >= 60000, 'code answers need a long timeout');
      return { ok: true, status: 200, json: { choices: [{ message: { content: 'ok' } }] }, text: '' };
    });
    assert.equal(ok.text, 'ok');
    assert.ok(ok.ms >= 0);
    const boom = await callModel({ provider: 'local', model: 'm', messages: msgs }, async () => { throw new Error('réseau'); });
    assert.equal(boom.ok, false);
  });

  it('lists models for each provider family', async () => {
    const seen = [];
    const fetcher = (json) => async (req) => { seen.push(req); return { ok: true, status: 200, json, text: '' }; };
    assert.deepEqual(await listModels({ provider: 'openai', apiKey: 'k12345678' }, fetcher({ data: [{ id: 'b' }, { id: 'a' }] })), ['a', 'b']);
    assert.deepEqual(await listModels({ provider: 'gemini', apiKey: 'k12345678' }, fetcher({ models: [{ name: 'models/g1', supportedGenerationMethods: ['generateContent'] }, { name: 'models/emb', supportedGenerationMethods: ['embedContent'] }] })), ['g1']);
    assert.equal(seen[0].headers.authorization, 'Bearer k12345678');
    assert.ok(seen[1].headers['x-goog-api-key'] && !seen[1].url.includes('k12345678'));
  });
});

describe('Studio IA : comparateur et Elo', () => {
  it('updates Elo in a zero-sum way and ranks the winner first', () => {
    let ratings = applyVote({}, 'a|1', ['a|1', 'b|1', 'c|1']);
    assert.ok(ratings['a|1'].elo > ELO_START);
    assert.ok(ratings['b|1'].elo < ELO_START);
    const total = Object.values(ratings).reduce((s, r) => s + r.elo, 0);
    assert.ok(Math.abs(total - 3 * ELO_START) < 1e-9, 'rating points are conserved');
    assert.equal(ratings['a|1'].wins, 2);
    assert.equal(leaderboard(ratings)[0].key, 'a|1');
    const before = ratings;
    ratings = applyVote(ratings, 'z|9', ['a|1', 'b|1']);
    assert.equal(ratings, ratings);
    assert.deepEqual(ratings, before, 'a vote for a non-participant is ignored');
    const upset = applyVote({ 'x|1': { elo: 1400, games: 5, wins: 5 }, 'y|1': { elo: 1000, games: 5, wins: 0 } }, 'y|1', ['x|1', 'y|1']);
    assert.ok(upset['y|1'].elo - 1000 > 12, 'beating a stronger model earns more');
  });

  it('runs all models in parallel and keeps failures isolated', async () => {
    const started = [];
    const call = async (opts) => {
      started.push(opts.model);
      await new Promise((r) => setTimeout(r, 20));
      return opts.model === 'bad' ? { ok: false, text: '', ms: 20, error: 'boom' } : { ok: true, text: `réponse ${opts.model}`, ms: 20, error: '' };
    };
    const slots = [{ provider: 'openai', model: 'm1' }, { provider: 'local', model: 'bad' }, { provider: 'local', model: 'm3' }];
    const t0 = Date.now();
    const out = await runComparison({ prompt: 'p', slots, resolve: (s) => ({ ...s }), call });
    assert.ok(Date.now() - t0 < 55, 'calls overlap');
    assert.deepEqual(out.map((r) => r.ok), [true, false, true]);
    await assert.rejects(runComparison({ prompt: 'p', slots: slots.slice(0, 1), resolve: (s) => s, call }), /deux/);
    await assert.rejects(runComparison({ prompt: ' ', slots, resolve: (s) => s, call }), /invite/);
  });
});

describe('Studio IA : outils de code', () => {
  it('extracts code blocks, file hints and refuses unsafe paths', () => {
    const blocks = extractCodeBlocks('Voici :\n```js\n// fichier: src/a.js\nconsole.log(1)\n```\net\n```python\nprint(2)\n```');
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].filename, 'src/a.js');
    assert.equal(suggestFilename(blocks[1], 1), 'jarvis-code-2.py');
    assert.equal(extractCodeBlocks('````md\n```js\nx\n```\n````')[0].code, '```js\nx\n```');
    for (const bad of ['../x', '/etc/passwd', 'C:\\Windows\\a.txt', '~/a', 'a/../../b', 'a:b']) assert.equal(safeRelativePath(bad), '', bad);
    assert.equal(safeRelativePath('src\\a/b.js'), 'src/a/b.js');
    assert.match(withAttachedFile('Q', { path: 'a.js', content: 'x' }), /Fichier joint : a\.js/);
  });
});

describe('Studio IA : stockage, outil et commandes vocales', () => {
  it('keeps API keys out of the persisted state and sanitises it', async () => {
    const mem = new Map();
    const secrets = {};
    const saved = { sg: hostBridge.storageGet, ss: hostBridge.storageSet, gs: hostBridge.getSecret, ss2: hostBridge.setSecret };
    hostBridge.storageGet = async (k) => mem.get(k) ?? null;
    hostBridge.storageSet = async (k, v) => { mem.set(k, v); return true; };
    hostBridge.getSecret = async (slot, fb) => secrets[slot] ?? fb;
    hostBridge.setSecret = async (slot, v) => { secrets[slot] = v; return true; };
    try {
      await llmStore.init();
      await llmStore.setKey('openai', ' sk-top-secret-0001 ');
      llmStore.setProvider('openai', { models: ['gpt-x'] });
      llmStore.setProvider('custom', { baseUrl: 'http://evil.example.com/v1' });
      assert.equal(llmStore.getApiKey('openai'), 'sk-top-secret-0001');
      assert.ok(!String(mem.get('llm_v1')).includes('sk-top-secret'), 'keys never reach the normal storage');
      assert.equal(secrets.llmKeys.openai, 'sk-top-secret-0001');
      assert.equal(llmStore.get().providers.custom.baseUrl, undefined, 'an insecure custom URL is dropped');
      assert.ok(llmStore.isConfigured('openai'));
      assert.ok(llmStore.isConfigured('local'));
      assert.equal(llmStore.isConfigured('anthropic'), false);
      assert.ok(llmStore.modelsOf('openai').includes('gpt-x'));
      await llmStore.setKey('openai', '');
      assert.equal(llmStore.hasKey('openai'), false);
    } finally {
      Object.assign(hostBridge, { storageGet: saved.sg, storageSet: saved.ss, getSecret: saved.gs, setSecret: saved.ss2 });
    }
    const clean = sanitizeState({ code: { provider: 'nope', model: 'x' }, compareSlots: [{ provider: 'openai', model: 'a' }], ratings: { 'a|b': { elo: 'x' } } });
    assert.equal(clean.code.provider, 'gemini');
    assert.equal(clean.compareSlots.length, 2);
    assert.deepEqual(clean.ratings, {});
  });

  it('opens arena.ai manually, opens the studio and delegates questions with an untrusted-content label', async () => {
    const opened = [];
    const studio = [];
    const previous = hostBridge.openArena;
    hostBridge.openArena = async () => { opened.push(1); return { ok: true, message: '' }; };
    const tools = new ToolRegistry({ onOpenStudio: (v) => studio.push(v) });
    assert.match(await tools.execute('ai_studio', { action: 'open_arena' }), /vous-même/);
    assert.equal(opened.length, 1);
    await tools.execute('ai_studio', { action: 'open_compare', prompt: 'x' });
    assert.deepEqual(studio[0], { tab: 'compare', seed: 'x' });
    assert.match(await tools.execute('ai_studio', { action: 'ask', prompt: 'q', provider: 'zzz' }), /inconnu/);
    assert.match(await tools.execute('ai_studio', { action: 'ask', prompt: 'q', provider: 'anthropic' }), /pas configuré/);
    hostBridge.openArena = previous;
    const calls = [];
    const engine = Object.create(JarvisEngine.prototype);
    engine.tools = { execute: async (name, args) => { calls.push(args.action); return 'ok'; } };
    await engine._runLocalIntent('ouvre arena.ai');
    await engine._runLocalIntent('ouvre le studio de code');
    await engine._runLocalIntent('compare les modèles');
    assert.deepEqual(calls, ['open_arena', 'open_code', 'open_compare']);
  });

  it('never automates arena.ai: the window is isolated, has no preload and denies permissions', () => {
    const main = fs.readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
    const block = main.slice(main.indexOf('const ARENA_PARTITION'), main.indexOf("ipcMain.handle('jarvis:notify'"));
    assert.match(block, /persist:jarvis-arena/);
    assert.match(block, /nodeIntegration: false/);
    assert.match(block, /sandbox: true/);
    assert.match(block, /callback\(false\)/);
    assert.ok(!/preload/.test(block), 'no privileged preload in the arena window');
    assert.ok(!/cookies|executeJavaScript|insertCSS|webRequest/.test(block), 'no cookie or page automation');
    assert.ok(Object.keys(PROVIDERS).every((id) => !/arena/.test(id)), 'arena.ai is not a model provider');
  });
});
