// Processus des modules externes (contrat apiVersion 1 de Cornelius, lfpoulain/cornelius-modules) : tourne sous le Node.js du système
// (24.2 ou plus : types TypeScript effacés nativement). Dialogue en lignes JSON sur stdin / stdout.
//   requête  : { rid, op: 'list' | 'read' | 'present' | 'ping', ... }
//   réponse  : { rid, ok: true, result } | { rid, ok: false, error: { code, message, retryable } }
// Un module externe s'exécute avec les droits de l'utilisateur : n'installer que du code de confiance (Réglages › Modules externes).
import { register } from 'node:module';
import { createInterface } from 'node:readline';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

register('./hooks.mjs', import.meta.url);

const { AddonCollectError } = await import('./addons.mjs');
const { compile } = await import('./validation.mjs');

const modulesDir = process.argv[2];
const ID_RE = /^[a-z][a-z0-9_]{0,31}$/;
const UA = 'Jarvis/2.0 (+https://github.com/Haseosama/Jarvis-2.0)';
const MAX_REDIRECTS = 3;
const FOLLOW_ACROSS_DOMAINS = new Set(['accept', 'accept-language', 'user-agent']);
const ICONS = new Set(['bell', 'bike', 'book-open', 'bus', 'calendar', 'calendar-days', 'car', 'clapperboard', 'clock', 'cloud-sun', 'droplets', 'fuel', 'gift', 'graduation-cap', 'heart', 'history', 'house', 'leaf', 'map-pin', 'music', 'newspaper', 'package', 'party-popper', 'play', 'plug', 'scroll-text', 'shopping-cart', 'sun', 'thermometer', 'train-front', 'trash-2', 'tree-palm', 'tv', 'utensils', 'wind', 'zap']);

// ── client HTTP du contrat ────────────────────────────────────────────────────

const cache = new Map(); // clé → { at, expires, response (snapshot sérialisable), bytes }
let cacheBytes = 0;

function checkedUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { throw new AddonCollectError('invalid_params', 'Adresse illisible.'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new AddonCollectError('invalid_params', 'Seules les adresses http et https sont permises.');
  if (u.username || u.password) throw new AddonCollectError('invalid_params', 'Adresse avec identifiants refusée.');
  return u;
}

function decodeBody(buf, contentType) {
  const header = /charset\s*=\s*"?([\w.:-]+)/i.exec(contentType || '')?.[1];
  const xml = !header ? /^<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)["']/i.exec(buf.subarray(0, 200).toString('latin1'))?.[1] : null;
  for (const label of [header, xml, 'utf-8']) {
    if (!label) continue;
    try { return new TextDecoder(label).decode(buf); } catch { /* étiquette inconnue */ }
  }
  return buf.toString('utf8');
}

function makeResponse(status, headers, buf, truncated, url) {
  const text = decodeBody(buf, headers['content-type']);
  return { status, headers, truncated, url, text: () => text, json: () => JSON.parse(text) };
}

async function httpFetch(req, outer) {
  let url = checkedUrl(req.url);
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') throw new AddonCollectError('invalid_params', 'Méthode non permise.');
  if (method === 'GET' && req.body != null) throw new AddonCollectError('invalid_params', 'Un GET ne porte pas de corps.');
  let headers = {};
  for (const [k, v] of Object.entries(req.headers || {})) {
    if (typeof v !== 'string' || /[\r\n]/.test(k + v) || !/^[\w-]+$/.test(k)) throw new AddonCollectError('invalid_params', 'En-tête mal formé.');
    headers[k.toLowerCase()] = v;
  }
  if (!headers['user-agent']) headers['user-agent'] = UA;
  const timeoutMs = Math.min(60_000, Math.max(500, Number(req.timeoutMs) || 4000));
  const maxBytes = Math.min(8 * 1024 * 1024, Math.max(1024, Number(req.maxBytes) || 256 * 1024));
  const cacheMs = method === 'GET' ? Math.min(600_000, Math.max(0, Number(req.cacheMs) || 0)) : 0;
  const key = `${url}|${JSON.stringify(headers)}|${maxBytes}`;
  const hit = cacheMs && cache.get(key);
  if (hit && hit.expires > Date.now()) return makeResponse(hit.status, hit.headers, hit.buf, hit.truncated, hit.url);

  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = AbortSignal.any([timeout, outer, ...(req.signal ? [req.signal] : [])]);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetch(url, { method, headers, body: method === 'POST' ? String(req.body ?? '') : undefined, redirect: 'manual', signal });
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        if (method === 'POST') throw new AddonCollectError('upstream', 'La source redirige une requête POST : adresse à corriger.');
        if (hop === MAX_REDIRECTS) throw new AddonCollectError('upstream', 'Trop de redirections.');
        const next = checkedUrl(new URL(location, url));
        if (url.protocol === 'https:' && next.protocol === 'http:') throw new AddonCollectError('upstream', 'Redirection de https vers http refusée.');
        if (next.hostname !== url.hostname) headers = Object.fromEntries(Object.entries(headers).filter(([k]) => FOLLOW_ACROSS_DOMAINS.has(k)));
        url = next;
        continue;
      }
      const chunks = [];
      let size = 0;
      let truncated = false;
      if (res.body) {
        const reader = res.body.getReader();
        for (;;) {
          let step;
          try { step = await reader.read(); } catch (e) { if (signal.aborted) throw e; throw new AddonCollectError('upstream', 'Connexion coupée avant la fin de la réponse.'); }
          if (step.done) break;
          size += step.value.length;
          if (size > maxBytes) { chunks.push(step.value.subarray(0, step.value.length - (size - maxBytes))); truncated = true; await reader.cancel().catch(() => {}); break; }
          chunks.push(step.value);
        }
      }
      const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
      const outHeaders = Object.fromEntries([...res.headers.entries()].map(([k, v]) => [k.toLowerCase(), v]));
      if (cacheMs && res.status === 200) {
        cache.set(key, { status: res.status, headers: outHeaders, buf, truncated, url: String(url), expires: Date.now() + cacheMs });
        cacheBytes += buf.length;
        while (cache.size > 32 || cacheBytes > 16 * 1024 * 1024) { const oldest = cache.keys().next().value; cacheBytes -= cache.get(oldest).buf.length; cache.delete(oldest); }
      }
      return makeResponse(res.status, outHeaders, buf, truncated, String(url));
    }
    throw new AddonCollectError('upstream', 'Trop de redirections.');
  } catch (err) {
    if (err instanceof AddonCollectError) throw err;
    if (timeout.aborted) throw new AddonCollectError('timeout', 'Le service a mis trop de temps à répondre.', true);
    if (signal.aborted) throw new AddonCollectError('unavailable', 'Lecture annulée.', true);
    throw new AddonCollectError('unavailable', 'Destination injoignable.', true);
  }
}

// ── chargement des modules ────────────────────────────────────────────────────

const modules = new Map();
const failed = [];

async function loadAll() {
  if (!modulesDir || !existsSync(modulesDir)) { failed.push({ dir: String(modulesDir || ''), reason: 'Dossier des modules introuvable.' }); return; }
  for (const dir of readdirSync(modulesDir).sort()) {
    const full = join(modulesDir, dir);
    if (!ID_RE.test(dir) || !statSync(full).isDirectory() || !existsSync(join(full, 'index.ts'))) continue;
    try {
      const def = (await import(pathToFileURL(join(full, 'index.ts')).href)).default;
      if (!def || typeof def !== 'object') throw new Error('Pas de définition exportée par défaut.');
      if (def.id !== dir) throw new Error(`L’identifiant « ${def.id} » doit être égal au nom du dossier.`);
      if (def.apiVersion !== 1) throw new Error('apiVersion 1 attendu.');
      if (typeof def.collect !== 'function' || typeof def.present !== 'function') throw new Error('collect et present sont obligatoires.');
      if (!def.configSchema || !def.dataSchema) throw new Error('configSchema et dataSchema sont obligatoires.');
      if (def.display?.icon && !ICONS.has(def.display.icon)) throw new Error(`Icône inconnue : ${def.display.icon}.`);
      modules.set(dir, { def, validateConfig: compile(def.configSchema), validateData: compile(def.dataSchema) });
    } catch (err) {
      failed.push({ dir, reason: String(err?.message || err).slice(0, 300) });
    }
  }
}

function meta({ def }) {
  return {
    id: def.id, version: def.version ?? '', sourceLabel: def.sourceLabel ?? def.id, display: def.display ?? null,
    secrets: (def.secrets ?? []).map((s) => ({ name: s.name, label: s.label, url: s.url, note: s.note })),
    configSchema: def.configSchema, configDefaults: def.configDefaults ?? {}, configVersion: def.configVersion ?? 1, dataVersion: def.dataVersion ?? 1,
    freshMs: def.freshMs, tools: def.tools ?? [], ambient: Boolean(def.ambient?.present), hasSearch: Boolean(def.search), minCoreVersion: def.minCoreVersion ?? null,
  };
}

// ── cartes : mêmes limites que le cœur de Cornelius ──────────────────────────

const len = (s, min, max) => typeof s === 'string' && s.length >= min && s.length <= max;
const nullOr = (s, max) => s === null || len(s, 1, max);
const itemsOk = (items, max, vMax) => Array.isArray(items) && items.length <= max && items.every((i) => i && len(i.label, 1, 80) && len(i.value, 1, vMax));

export function cardProblem(c) {
  if (!c || typeof c !== 'object') return 'carte absente';
  if (!len(c.title, 1, 80)) return 'title (1 à 80 caractères)';
  if (!nullOr(c.primaryValue ?? null, 120)) return 'primaryValue (null ou 1 à 120 caractères)';
  if (!nullOr(c.subtitle ?? null, 120)) return 'subtitle (null ou 1 à 120 caractères)';
  if (!nullOr(c.description ?? null, 500)) return 'description (null ou 1 à 500 caractères)';
  if (!itemsOk(c.items ?? [], 5, 160)) return 'items (5 lignes au plus, label 1 à 80, value 1 à 160)';
  if (!len(c.summary, 1, 500)) return 'summary (1 à 500 caractères)';
  if (c.sources !== undefined && !(Array.isArray(c.sources) && c.sources.length <= 3 && new Set(c.sources).size === c.sources.length && c.sources.every((s) => len(s, 1, 128)))) return 'sources (3 chaînes distinctes au plus)';
  return null;
}

export function ambientProblem(a) {
  if (!a || typeof a !== 'object') return 'présentation absente';
  if (a.layout !== 'metric' && a.layout !== 'list') return 'layout (metric ou list)';
  if (!len(a.title, 1, 80)) return 'title';
  if (!nullOr(a.value ?? null, 120)) return 'value';
  if (!nullOr(a.subtitle ?? null, 120)) return 'subtitle';
  if (!itemsOk(a.items ?? [], 3, 160)) return 'items (3 lignes au plus)';
  if (a.refreshAt !== undefined && !Number.isFinite(Date.parse(a.refreshAt))) return 'refreshAt (ISO 8601)';
  return null;
}

function presentAll(entry, snapshot, instance, now, timeZone) {
  const ctx = { instance, now: () => now, timeZone };
  let card = null;
  try { card = entry.def.present(snapshot, ctx); } catch { card = null; }
  if (card === null && snapshot.status === 'empty') card = { title: entry.def.display?.name || entry.def.sourceLabel || entry.def.id, primaryValue: null, subtitle: null, description: null, items: [], summary: 'La source ne fournit aucune donnée utile pour le moment.' };
  const cardErr = card ? cardProblem(card) : 'Présentation de carte impossible';
  if (cardErr) throw new AddonCollectError('malformed', `Données reçues mais illisibles (${cardErr}).`);
  let ambient = null;
  if (entry.def.ambient?.present) {
    try { ambient = entry.def.ambient.present(snapshot, ctx); } catch { ambient = null; }
    if (ambient && ambientProblem(ambient)) ambient = null;
  }
  return { card, ambient };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

async function read(req) {
  const entry = modules.get(req.id);
  if (!entry) throw new AddonCollectError('not_found', `Module « ${req.id} » inconnu ou non chargé.`);
  const now = Number.isFinite(req.now) ? req.now : Date.now();
  if (!entry.validateConfig(req.config ?? {})) throw new AddonCollectError('config_invalid', 'Réglages de la source invalides pour ce module.');
  const secrets = req.secrets || {};
  const declared = new Set((entry.def.secrets ?? []).map((s) => s.name));
  const signal = AbortSignal.timeout(45_000);
  const instance = { name: String(req.instance?.name || entry.def.id), ref: String(req.instance?.ref || entry.def.id) };
  const context = {
    config: req.config ?? {}, instance, now: () => Date.now(), timeZone: req.timeZone || 'Europe/Paris', signal,
    secret: (name) => (declared.has(name) && typeof secrets[name] === 'string' && secrets[name] ? secrets[name] : undefined),
    http: { fetch: (r) => httpFetch(r, signal) },
    query: req.query === undefined || req.query === null ? undefined : String(req.query),
    ...(req.args && typeof req.args === 'object' ? { args: req.args } : {}),
  };
  const result = await entry.def.collect(context);
  if (!result || !entry.validateData(result.data)) throw new AddonCollectError('malformed', 'Les données du module ne respectent pas son schéma.');
  const snapshot = { status: result.empty === true ? 'empty' : 'ready', data: result.data, source: result.source ?? null, observedAt: result.observedAt ?? null, fetchedAt: now };
  const out = presentAll(entry, snapshot, instance, now, context.timeZone);
  return { snapshot, ...out, freshMs: clamp(Number(result.freshMs ?? entry.def.freshMs) || 60_000, 5000, 86_400_000) };
}

async function present(req) {
  const entry = modules.get(req.id);
  if (!entry) throw new AddonCollectError('not_found', `Module « ${req.id} » inconnu ou non chargé.`);
  const snapshot = req.snapshot;
  if (!snapshot || !entry.validateData(snapshot.data)) throw new AddonCollectError('malformed', 'Relevé enregistré illisible.');
  return presentAll(entry, snapshot, { name: String(req.instance?.name || entry.def.id), ref: String(req.instance?.ref || entry.def.id) }, Number.isFinite(req.now) ? req.now : Date.now(), req.timeZone || 'Europe/Paris');
}

await loadAll();
process.stdout.write(`${JSON.stringify({ ready: true, modules: modules.size, failed: failed.length })}\n`);

const rl = createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  let req;
  try { req = JSON.parse(line); } catch { return; }
  const reply = (obj) => process.stdout.write(`${JSON.stringify({ rid: req.rid, ...obj })}\n`);
  try {
    if (req.op === 'ping') return reply({ ok: true, result: 'pong' });
    if (req.op === 'list') return reply({ ok: true, result: { modules: [...modules.values()].map(meta), failed } });
    if (req.op === 'read') return reply({ ok: true, result: await read(req) });
    if (req.op === 'present') return reply({ ok: true, result: await present(req) });
    return reply({ ok: false, error: { code: 'invalid_params', message: 'Opération inconnue.', retryable: false } });
  } catch (err) {
    const known = err instanceof AddonCollectError;
    return reply({ ok: false, error: { code: known ? err.code : 'upstream', message: known ? err.message : 'Le module a rencontré une erreur inattendue.', retryable: known ? err.retryable : false, detail: known ? undefined : String(err?.message || err).slice(0, 300) } });
  }
});
rl.on('close', () => process.exit(0));
