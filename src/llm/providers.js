// Fournisseurs de modèles via leurs API OFFICIELLES (clé API de l'utilisateur).
// Aucun accès à arena.ai ni à une session de navigateur : voir docs/MODEL-PROVIDERS.md.
import { hostBridge } from '../core/hostBridge.js';

export const ANTHROPIC_VERSION = '2023-06-01';

export const PROVIDERS = {
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    kind: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    keyless: false,
    usesJarvisKey: true, // réutilise les clés Gemini déjà saisies dans les réglages
    editableUrl: false,
    suggestions: ['gemini-2.5-flash', 'gemini-2.5-pro'],
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    editableUrl: false,
    suggestions: ['gpt-4o', 'gpt-4o-mini'],
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    editableUrl: false,
    suggestions: [],
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter (centaines de modèles)',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    editableUrl: false,
    suggestions: [],
  },
  local: {
    id: 'local',
    label: 'Local (Ollama / LM Studio)',
    kind: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    keyless: true,
    editableUrl: true,
    suggestions: [],
  },
  custom: {
    id: 'custom',
    label: 'Personnalisé (compatible OpenAI)',
    kind: 'openai',
    baseUrl: '',
    editableUrl: true,
    suggestions: [],
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Normalise une URL de base. https partout ; http uniquement en boucle locale (la clé ne circule jamais en clair sur le réseau). */
export function validateBaseUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || '').trim());
  } catch {
    throw new Error('URL de base invalide.');
  }
  if (url.username || url.password) throw new Error('L’URL ne doit pas contenir d’identifiants.');
  if (url.protocol === 'http:' && !LOOPBACK.has(url.hostname)) {
    throw new Error('http:// n’est accepté que pour localhost ; utilisez https:// pour un service distant.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Protocole non pris en charge.');
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/+$/, '');
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('');
  }
  return '';
}

/** Construit la requête HTTP (fonction pure, testable). `messages` = [{role:'user'|'assistant', content}] */
export function buildRequest({ provider, model, messages, system = '', apiKey = '', baseUrl = '', maxTokens, temperature, tools = null, raw = false }) {
  const def = PROVIDERS[provider];
  if (!def) throw new Error(`Fournisseur inconnu : ${provider}`);
  if (!model) throw new Error('Aucun modèle choisi.');
  const base = validateBaseUrl(baseUrl || def.baseUrl);
  // raw : messages déjà au format du fournisseur (boucle d'outils : tool_calls, tool_use, tool_result…)
  if (raw && def.kind === 'gemini') throw new Error('Mode brut non pris en charge pour Gemini.');
  const turns = raw
    ? (messages || []).filter(Boolean)
    : (messages || [])
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
      .map((m) => ({ role: m.role, content: String(m.content) }));
  if (!turns.length) throw new Error('Message vide.');

  if (def.kind === 'anthropic') {
    const body = { model, max_tokens: maxTokens || 8192, messages: turns };
    if (system) body.system = system;
    if (temperature !== undefined) body.temperature = temperature;
    if (tools?.length) body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    return {
      url: `${base}/messages`,
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
      body: JSON.stringify(body),
    };
  }
  if (def.kind === 'gemini') {
    const body = {
      contents: turns.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    const generationConfig = {};
    if (maxTokens) generationConfig.maxOutputTokens = maxTokens;
    if (temperature !== undefined) generationConfig.temperature = temperature;
    if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;
    return {
      url: `${base}/models/${encodeURIComponent(model)}:generateContent`,
      method: 'POST',
      // La clé voyage dans un en-tête (jamais dans l'URL) : elle n'apparaît ainsi ni dans les journaux ni dans les erreurs.
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    };
  }
  const headers = { 'content-type': 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const body = { model, messages: [...(system ? [{ role: 'system', content: system }] : []), ...turns] };
  if (maxTokens) body.max_tokens = maxTokens;
  if (temperature !== undefined) body.temperature = temperature;
  if (tools?.length) body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  return { url: `${base}/chat/completions`, method: 'POST', headers, body: JSON.stringify(body) };
}

function safeParseArgs(value) {
  if (value && typeof value === 'object') return value;
  try { const parsed = JSON.parse(String(value || '{}')); return parsed && typeof parsed === 'object' ? parsed : {}; } catch { return {}; }
}

/** Extrait texte, usage et appels d'outils d'une réponse JSON de fournisseur (fonction pure). */
export function parseResponse(provider, json) {
  const def = PROVIDERS[provider];
  const empty = { text: '', usage: null, toolCalls: [], assistantMessage: null };
  if (!def || !json) return empty;
  if (def.kind === 'anthropic') {
    const blocks = Array.isArray(json.content) ? json.content : [];
    const text = blocks.filter((b) => b?.type === 'text').map((b) => b.text || '').join('');
    const toolCalls = blocks.filter((b) => b?.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, args: safeParseArgs(b.input) }));
    return { text, usage: json.usage ? { input: json.usage.input_tokens, output: json.usage.output_tokens } : null, toolCalls, assistantMessage: { role: 'assistant', content: blocks } };
  }
  if (def.kind === 'gemini') {
    const parts = json.candidates?.[0]?.content?.parts || [];
    const text = parts.filter((p) => !p.thought).map((p) => p.text || '').join('');
    const u = json.usageMetadata;
    return { ...empty, text, usage: u ? { input: u.promptTokenCount, output: u.candidatesTokenCount } : null };
  }
  const message = json.choices?.[0]?.message || {};
  const text = textOf(message.content);
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const toolCalls = calls.filter((c) => c?.function?.name).map((c, i) => ({ id: c.id || `call_${i}`, name: c.function.name, args: safeParseArgs(c.function.arguments) }));
  const assistantMessage = { role: 'assistant', content: message.content ?? null };
  if (calls.length) assistantMessage.tool_calls = calls.map((c, i) => ({ id: c.id || `call_${i}`, type: 'function', function: { name: c.function?.name, arguments: typeof c.function?.arguments === 'string' ? c.function.arguments : JSON.stringify(c.function?.arguments || {}) } }));
  return { text, usage: json.usage ? { input: json.usage.prompt_tokens, output: json.usage.completion_tokens } : null, toolCalls, assistantMessage };
}

export function redact(text, ...secrets) {
  let out = String(text ?? '');
  for (const secret of secrets) {
    if (secret && String(secret).length >= 6) out = out.split(String(secret)).join('••••');
  }
  return out;
}

function errorMessage(status, json, text, apiKey) {
  const detail = json?.error?.message || json?.error || json?.message || (typeof text === 'string' ? text.slice(0, 240) : '');
  const msg = typeof detail === 'string' ? detail : JSON.stringify(detail);
  const hint = status === 401 || status === 403 ? ' (clé refusée ou droits insuffisants)' : status === 429 ? ' (quota ou limite de débit atteinte)' : '';
  return redact(`HTTP ${status}${hint}${msg ? ` : ${msg}` : ''}`, apiKey);
}

/** Interroge un modèle. Ne lève jamais : renvoie {ok, text, ms, usage, error}. */
export async function callModel(options, fetcher = hostBridge.httpFetch.bind(hostBridge)) {
  const started = Date.now();
  const apiKey = options.apiKey || '';
  try {
    const def = PROVIDERS[options.provider];
    if (def && !def.keyless && !apiKey) throw new Error('Clé API manquante pour ce fournisseur.');
    const req = buildRequest(options);
    const res = await fetcher({ ...req, timeoutMs: options.timeoutMs || 120000 });
    const ms = Date.now() - started;
    if (!res?.ok) {
      return { ok: false, text: '', ms, usage: null, error: res?.status ? errorMessage(res.status, res.json, res.text, apiKey) : redact(res?.error || 'Réseau indisponible.', apiKey) };
    }
    const parsed = parseResponse(options.provider, res.json);
    if (!parsed.text.trim() && !parsed.toolCalls.length) return { ok: false, text: '', ms, usage: parsed.usage, error: 'Réponse vide du modèle.' };
    return { ok: true, text: parsed.text, ms, usage: parsed.usage, error: '', toolCalls: parsed.toolCalls, assistantMessage: parsed.assistantMessage };
  } catch (error) {
    return { ok: false, text: '', ms: Date.now() - started, usage: null, error: redact(error.message || String(error), apiKey) };
  }
}

/** Liste les modèles disponibles chez un fournisseur (évite de coder des identifiants périmés). */
export async function listModels({ provider, apiKey = '', baseUrl = '' }, fetcher = hostBridge.httpFetch.bind(hostBridge)) {
  const def = PROVIDERS[provider];
  if (!def) throw new Error(`Fournisseur inconnu : ${provider}`);
  const base = validateBaseUrl(baseUrl || def.baseUrl);
  const headers = {};
  if (def.kind === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = ANTHROPIC_VERSION;
  } else if (def.kind === 'gemini') {
    headers['x-goog-api-key'] = apiKey;
  } else if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }
  const res = await fetcher({ url: `${base}/models${def.kind === 'gemini' ? '?pageSize=200' : def.kind === 'anthropic' ? '?limit=100' : ''}`, method: 'GET', headers, timeoutMs: 20000 });
  if (!res?.ok) throw new Error(res?.status ? errorMessage(res.status, res.json, res.text, apiKey) : redact(res?.error || 'Réseau indisponible.', apiKey));
  const json = res.json || {};
  let ids;
  if (def.kind === 'gemini') {
    ids = (json.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => String(m.name || '').replace(/^models\//, ''));
  } else {
    ids = (json.data || json.models || []).map((m) => (typeof m === 'string' ? m : m.id || m.name || ''));
  }
  return [...new Set(ids.filter(Boolean))].sort();
}
