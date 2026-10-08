import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { callModel, buildRequest, parseResponse } from '../src/llm/providers.js';
import { runBrain, toJsonSchema, toolSpecs, BRAIN_PROVIDER_IDS } from '../src/llm/brain.js';
import { llmStore, sanitizeState } from '../src/llm/llmStore.js';
import { ToolRegistry } from '../src/actions/ToolRegistry.js';
import { JarvisEngine } from '../src/core/JarvisEngine.js';
import { hostBridge } from '../src/core/hostBridge.js';

const DECLS = [{ name: 'get_weather', description: 'Météo', parameters: { type: 'OBJECT', properties: { city: { type: 'STRING', description: 'Ville' }, days: { type: 'NUMBER' }, tags: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['city'] } }, { name: 'noop', description: 'rien', parameters: { type: 'OBJECT', properties: {} } }];

/** Faux fournisseur : renvoie les réponses dans l'ordre et enregistre les requêtes. */
function scripted(responses) {
  const requests = [];
  const fetcher = async (req) => {
    requests.push({ url: req.url, headers: req.headers, body: JSON.parse(req.body) });
    const next = responses.shift();
    return typeof next === 'function' ? next(req) : { ok: true, status: 200, json: next, text: '' };
  };
  return { requests, call: (o) => callModel(o, fetcher) };
}

const openaiTool = (id, name, args) => ({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
const openaiText = (text) => ({ choices: [{ message: { role: 'assistant', content: text } }] });

describe('Cerveau multi-modèles : schémas et formats', () => {
  it('converts Gemini parameter schemas to JSON Schema', () => {
    const schema = toJsonSchema(DECLS[0].parameters);
    assert.equal(schema.type, 'object');
    assert.equal(schema.properties.city.type, 'string');
    assert.equal(schema.properties.days.type, 'number');
    assert.deepEqual(schema.properties.tags, { type: 'array', items: { type: 'string' } });
    assert.deepEqual(schema.required, ['city']);
  });

  it('exposes every real Jarvis tool with a valid name and a lowercase schema', () => {
    const decls = new ToolRegistry().getDeclarations();
    const specs = toolSpecs(decls);
    assert.equal(specs.length, decls.length);
    assert.ok(specs.length <= 120);
    const text = JSON.stringify(specs);
    assert.ok(!/"type":"(OBJECT|STRING|NUMBER|BOOLEAN|ARRAY)"/.test(text), 'no Gemini-style uppercase types');
    assert.ok(specs.every((s) => s.parameters.type === 'object'));
  });

  it('builds OpenAI and Anthropic tool declarations and keeps raw tool messages', () => {
    const tools = toolSpecs(DECLS);
    const o = JSON.parse(buildRequest({ provider: 'openrouter', model: 'm', apiKey: 'k', system: 's', raw: true, tools, messages: [{ role: 'user', content: 'x' }, { role: 'tool', tool_call_id: 'c1', content: 'r' }] }).body);
    assert.equal(o.tools[0].type, 'function');
    assert.equal(o.tools[0].function.name, 'get_weather');
    assert.equal(o.messages[2].role, 'tool');
    const a = JSON.parse(buildRequest({ provider: 'anthropic', model: 'm', apiKey: 'k', raw: true, tools, messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'r' }] }] }).body);
    assert.equal(a.tools[0].input_schema.type, 'object');
    assert.equal(a.messages[0].content[0].type, 'tool_result');
    assert.throws(() => buildRequest({ provider: 'gemini', model: 'm', apiKey: 'k', raw: true, messages: [{ role: 'user', content: 'x' }] }));
  });

  it('parses tool calls from both formats, tolerating invalid argument JSON', () => {
    const o = parseResponse('openai', { choices: [{ message: { content: null, tool_calls: [{ id: 'a', function: { name: 'x', arguments: '{bad' } }] } }] });
    assert.deepEqual(o.toolCalls, [{ id: 'a', name: 'x', args: {} }]);
    assert.equal(o.assistantMessage.tool_calls[0].function.name, 'x');
    const a = parseResponse('anthropic', { content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 'u', name: 'y', input: { q: 1 } }] });
    assert.deepEqual(a.toolCalls, [{ id: 'u', name: 'y', args: { q: 1 } }]);
    assert.equal(a.text, 'ok');
  });
});

describe('Cerveau multi-modèles : boucle d’outils', () => {
  it('runs an OpenAI-compatible tool loop and feeds the result back', async () => {
    const fake = scripted([openaiTool('call_1', 'get_weather', { city: 'Bordeaux' }), openaiText('Il fait 21 °C à Bordeaux.')]);
    const executed = [];
    const res = await runBrain({
      slot: { provider: 'openrouter', model: 'm', apiKey: 'k-test-123456', baseUrl: 'https://openrouter.ai/api/v1' },
      system: 'sys', history: [{ role: 'user', content: 'salut' }, { role: 'assistant', content: 'bonjour' }], userText: 'météo ?',
      declarations: DECLS, call: fake.call, execute: async (n, a) => { executed.push([n, a]); return '21 °C'; },
    });
    assert.deepEqual(res, { ok: true, text: 'Il fait 21 °C à Bordeaux.', toolsUsed: ['get_weather'] });
    assert.deepEqual(executed, [['get_weather', { city: 'Bordeaux' }]]);
    assert.equal(fake.requests[0].url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(fake.requests[0].body.tools.length, 2);
    const second = fake.requests[1].body.messages;
    assert.deepEqual(second.slice(-2).map((m) => m.role), ['assistant', 'tool']);
    assert.equal(second.at(-1).tool_call_id, 'call_1');
    assert.equal(second.at(-1).content, '21 °C');
    assert.deepEqual(second.slice(1, 4).map((m) => m.content), ['salut', 'bonjour', 'météo ?']);
  });

  it('runs an Anthropic tool_use loop with tool_result blocks', async () => {
    const fake = scripted([
      { content: [{ type: 'text', text: 'Je regarde.' }, { type: 'tool_use', id: 'tu_1', name: 'get_weather', input: { city: 'Paris' } }] },
      { content: [{ type: 'text', text: 'Soleil à Paris.' }] },
    ]);
    const res = await runBrain({ slot: { provider: 'anthropic', model: 'claude-x', apiKey: 'k-ant-123456', baseUrl: 'https://api.anthropic.com/v1' }, userText: 'météo Paris', declarations: DECLS, call: fake.call, execute: async () => 'soleil' });
    assert.equal(res.text, 'Soleil à Paris.');
    const msgs = fake.requests[1].body.messages;
    assert.equal(msgs[1].role, 'assistant');
    assert.equal(msgs[1].content[1].type, 'tool_use');
    assert.deepEqual(msgs[2], { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'soleil' }] });
  });

  it('survives tool errors, truncates huge results and stops looping after the hop limit', async () => {
    const calls = [];
    const loop = Array.from({ length: 10 }, (_, i) => openaiTool(`c${i}`, 'noop', {}));
    const fake = scripted([...loop, openaiText('fini')]);
    const res = await runBrain({
      slot: { provider: 'local', model: 'm', baseUrl: 'http://localhost:11434/v1' }, userText: 'boucle', declarations: DECLS, maxHops: 3, call: fake.call,
      execute: async (name) => { calls.push(name); if (calls.length === 1) throw new Error('boom'); return 'x'.repeat(20000); },
    });
    assert.equal(res.ok, true);
    assert.equal(calls.length, 3, 'exactly maxHops tool rounds');
    assert.equal(fake.requests.at(-1).body.tools, undefined, 'last request forces a text answer');
    assert.match(fake.requests[1].body.messages.at(-1).content, /Erreur lors de l'exécution de noop : boom/);
    assert.ok(fake.requests[2].body.messages.at(-1).content.length < 8100);
  });

  it('retries once without tools when a local model rejects tool calling', async () => {
    const fake = scripted([
      { ok: false, status: 400, json: { error: { message: 'registry.ollama.ai/x does not support tools' } }, text: '' },
      openaiText('Réponse sans outils.'),
    ].map((r) => (r.choices ? r : () => r)));
    const res = await runBrain({ slot: { provider: 'local', model: 'm', baseUrl: 'http://localhost:11434/v1' }, userText: 'salut', declarations: DECLS, call: fake.call, execute: async () => 'x' });
    assert.equal(res.ok, true);
    assert.equal(res.text, 'Réponse sans outils.');
    assert.ok(fake.requests[0].body.tools);
    assert.equal(fake.requests[1].body.tools, undefined);
  });

  it('reports errors without leaking the key and refuses Gemini as external brain', async () => {
    const fake = scripted([() => ({ ok: false, status: 401, json: { error: { message: 'bad key sk-secret-999999' } }, text: '' })]);
    const res = await runBrain({ slot: { provider: 'openai', model: 'm', apiKey: 'sk-secret-999999', baseUrl: 'https://api.openai.com/v1' }, userText: 'x', declarations: DECLS, call: fake.call, execute: async () => '' });
    assert.equal(res.ok, false);
    assert.ok(!res.error.includes('sk-secret-999999'));
    assert.equal((await runBrain({ slot: { provider: 'gemini', model: 'm' }, userText: 'x' })).ok, false);
    assert.ok(!BRAIN_PROVIDER_IDS.includes('gemini'));
  });
});

describe('Cerveau multi-modèles : réglages et moteur', () => {
  const realFetch = hostBridge.httpFetch;
  const realConfig = { ...llmStore.state };
  afterEach(() => { hostBridge.httpFetch = realFetch; llmStore.state = realConfig; llmStore.keys = {}; });

  it('sanitises the brain setting and never accepts Gemini', () => {
    assert.deepEqual(sanitizeState(null).brain, { enabled: false, provider: 'openai', model: '' });
    assert.deepEqual(sanitizeState({ brain: { enabled: true, provider: 'anthropic', model: ' claude-x ' } }).brain, { enabled: true, provider: 'anthropic', model: 'claude-x' });
    assert.equal(sanitizeState({ brain: { enabled: true, provider: 'gemini', model: 'g' } }).brain.enabled, false);
    assert.equal(sanitizeState({ brain: { enabled: 'yes', provider: 'nope', model: 'x' } }).brain.enabled, false);
  });

  it('answers typed messages through the external model, executes tools and keeps the history', async () => {
    llmStore.ready = true;
    llmStore.keys = { openai: 'sk-test-123456' };
    llmStore.state = sanitizeState({ brain: { enabled: true, provider: 'openai', model: 'gpt-x' } });
    const bodies = [];
    const replies = [openaiTool('c1', 'get_weather', { city: 'Bordeaux' }), openaiText('Très beau temps.')];
    hostBridge.httpFetch = async (req) => { bodies.push(JSON.parse(req.body)); return { ok: true, status: 200, json: replies.shift(), text: '' }; };
    const engine = Object.create(JarvisEngine.prototype);
    const ran = [];
    engine.externalHistory = [];
    engine.cb = {};
    engine._setState = () => {};
    engine.buildSystemPrompt = () => 'prompt';
    engine.tools = { getDeclarations: () => DECLS, execute: async (n, a) => { ran.push([n, a]); return 'beau'; } };
    assert.equal(await engine._tryExternalBrain('quel temps ?'), 'Très beau temps.');
    assert.deepEqual(ran, [['get_weather', { city: 'Bordeaux' }]]);
    assert.deepEqual(engine.externalHistory, [{ role: 'user', content: 'quel temps ?' }, { role: 'assistant', content: 'Très beau temps.' }]);
    assert.equal(bodies[0].model, 'gpt-x');
  });

  it('falls back (null) and warns when the external model fails or is not configured', async () => {
    llmStore.ready = true;
    llmStore.keys = { openai: 'sk-test-123456' };
    llmStore.state = sanitizeState({ brain: { enabled: true, provider: 'openai', model: 'gpt-x' } });
    const messages = [];
    hostBridge.httpFetch = async () => ({ ok: false, status: 500, json: null, text: 'oops' });
    const engine = Object.create(JarvisEngine.prototype);
    engine.externalHistory = [];
    engine.cb = { onMessage: (m) => messages.push(m) };
    engine._setState = () => {};
    engine.buildSystemPrompt = () => 'p';
    engine.tools = { getDeclarations: () => [], execute: async () => '' };
    assert.equal(await engine._tryExternalBrain('x'), null);
    assert.match(messages[0].text, /reprends avec Gemini/);
    assert.equal(engine.externalHistory.length, 0);
    llmStore.keys = {};
    messages.length = 0;
    assert.equal(await engine._tryExternalBrain('x'), null);
    assert.equal(messages.length, 0, 'unconfigured → silent fallback');
    llmStore.state = sanitizeState(null);
    assert.equal(await engine._tryExternalBrain('x'), null);
  });

  it('wires typed messages to the brain before Gemini and exposes the Cerveau tab', () => {
    const engine = fs.readFileSync(new URL('../src/core/JarvisEngine.js', import.meta.url), 'utf8');
    const send = engine.slice(engine.indexOf('async sendUserMessage'), engine.indexOf('async _tryExternalBrain'));
    assert.ok(send.indexOf('_tryExternalBrain') > 0 && send.indexOf('_tryExternalBrain') < send.indexOf('ensureLiveSession'));
    assert.match(send, /!imageBase64/);
    const panel = fs.readFileSync(new URL('../src/ui/ModelStudioPanel.jsx', import.meta.url), 'utf8');
    assert.match(panel, /BrainSettings/);
  });
});
