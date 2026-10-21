// Ragator : moteur de recherche citée sur les vidéos YouTube (corpus des Frères Poulain, ou le vôtre), par son interface web locale.
// Jarvis lui pose la question et rapporte la réponse avec les vidéos et l'instant qui la prouvent.
// Idée et API (POST /api/ask, GET /api/collections) d'après le module Ragator de Cornelius (lfpoulain/Cornelius,
// PolyForm Noncommercial 1.0.0) ; code réécrit pour Jarvis.
import { done, failed } from '../core/safety.js';

export const DEFAULT_URL = 'http://127.0.0.1:3210';
export const MAX_QUESTION = 1000;
export const ANSWER_MAX = 4000;
export const SOURCES_MAX = 5;
export const ASK_TIMEOUT_MS = 60_000;

const PRIVATE_V4 = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/;

/** Adresse de Ragator : sans jeton à protéger, http est accepté sur la machine et le réseau local ; https partout. */
export function ragatorUrl(raw) {
  let u;
  try { u = new URL(String(raw || DEFAULT_URL).trim()); } catch { throw new Error('Adresse de Ragator invalide.'); }
  if (u.username || u.password || u.search || u.hash) throw new Error('L’adresse ne doit contenir ni identifiants ni paramètres.');
  const local = u.hostname === 'localhost' || u.hostname === '[::1]' || PRIVATE_V4.test(u.hostname) || /\.(local|lan|home)$/i.test(u.hostname) || !u.hostname.includes('.');
  if (u.protocol === 'http:' && !local) throw new Error('http:// n’est accepté que sur la machine ou le réseau local ; utilisez https:// ailleurs.');
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Protocole non pris en charge.');
  return u.origin;
}

/** Citations « [Gu8bnHQaG5s:t00062 @ 03:45] » : utiles à l'écran de Ragator, pas à l'oral. */
export function withoutCitations(text) {
  return String(text || '')
    .replace(/\s*\[[A-Za-z0-9_:-]{4,40}(?:\s*@\s*[0-9:]+(?:\s*[–-]\s*[0-9:]+)?)?\]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/** Coupe au plus près d'une fin de phrase, sinon au dernier mot. */
export function clip(text, max) {
  if (text.length <= max) return text;
  const head = text.slice(0, max - 1);
  const sentence = Math.max(head.lastIndexOf('. '), head.lastIndexOf('.\n'));
  if (sentence >= max / 2) return head.slice(0, sentence + 1);
  const word = head.lastIndexOf(' ');
  return `${(word >= max / 2 ? head.slice(0, word) : head).trimEnd()}…`;
}

export function timestamp(seconds) {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

const frenchDate = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${y}`; };

function statusError(res, collection) {
  if (res.status === 401) return 'Ragator demande un mot de passe (RAGATOR_PASSWORD) : non pris en charge. Laissez-le vide ou limitez l’accès par le réseau.';
  if (res.status === 403) return 'Ragator refuse cette adresse : ajoutez-la à RAGATOR_HOSTS côté Ragator.';
  if (res.status === 429) return 'Ragator traite déjà trop de questions.';
  if (res.status === 400 && collection && /collection inconnue/.test(String(res.text || ''))) return `Collection « ${collection} » inconnue de Ragator.`;
  if (res.status === 400 || res.status === 413) return 'Ragator a refusé la question.';
  if (res.status === 404) return 'Aucune interface Ragator à cette adresse.';
  if (res.status >= 500) return 'Ragator a rencontré une erreur.';
  return res.status ? `Réponse HTTP ${res.status} inattendue de Ragator.` : `Ragator injoignable${res.error ? ` (${String(res.error).slice(0, 80)})` : ''}.`;
}

/** Réponse de POST /api/ask → texte pour l'assistant, ou null si la forme est invalide. */
export function formatAnswer(payload, question) {
  const p = payload && typeof payload === 'object' ? payload : null;
  if (!p || typeof p.answer !== 'string' || typeof p.refused !== 'boolean' || !Array.isArray(p.sources)) return null;
  const sources = p.sources
    .filter((s) => s && typeof s.title === 'string' && s.title && /^[A-Za-z0-9_-]{11}$/.test(String(s.videoId || '')) && /^https:\/\//.test(String(s.link || '')))
    .slice(0, SOURCES_MAX);
  const lines = [];
  if (p.refused) lines.push('Ragator répond que le corpus ne contient pas l’information demandée.');
  else lines.push(clip(withoutCitations(p.answer), ANSWER_MAX));
  if (p.degradedReason) lines.push('Réponse dégradée (recherche sans modèle).');
  if (sources.length) {
    lines.push('Vidéos citées :');
    for (const s of sources) {
      const parts = [Number.isFinite(s.startS) ? `à ${timestamp(s.startS)}` : null, s.publishedAt ? `vidéo du ${frenchDate(s.publishedAt)}` : null].filter(Boolean);
      lines.push(`• ${clip(s.title, 80)}${parts.length ? ` — ${parts.join(' · ')}` : ''} — ${s.link}`);
    }
  }
  return lines.join('\n');
}

/**
 * Outil « ask_ragator ». deps = { baseUrl, collection, detailed, fetcher }.
 * args.question : la question complète en français (1 000 caractères au plus). args.action = 'status' vérifie la connexion.
 */
export async function runRagator(args, deps) {
  let base;
  try { base = ragatorUrl(deps.baseUrl); } catch (e) { return failed('ask_ragator', e.message); }
  const { collection, fetcher } = deps;
  const json = (res) => res.json || (() => { try { return JSON.parse(res.text); } catch { return null; } })();
  if (String(args.action || '').toLowerCase() === 'status') {
    const res = await fetcher({ url: `${base}/api/collections`, method: 'GET', timeoutMs: 8000, maxBytes: 256 * 1024 });
    if (!res.ok) return failed('ask_ragator', statusError(res, collection));
    const data = json(res);
    if (!data || !Array.isArray(data.collections)) return failed('ask_ragator', 'Liste des collections de Ragator invalide.');
    const fold = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const chosen = collection ? data.collections.find((c) => c.key === collection || fold(c.name) === fold(collection)) : null;
    if (collection && !chosen) return failed('ask_ragator', `Collection « ${collection} » inconnue de Ragator.`);
    const videos = chosen ? chosen.videos : data.collections.reduce((n, c) => n + (Number(c.videos) || 0), 0);
    return done('ask_ragator', { action: 'status', collections: data.collections.length, videos, scope: chosen?.name || 'tout le corpus' });
  }
  const question = String(args.question || '').trim().slice(0, MAX_QUESTION);
  if (!question) return failed('ask_ragator', 'question manquante (la question complète, sans sous-entendu)');
  const res = await fetcher({
    url: `${base}/api/ask`, method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, mode: deps.detailed ? 'détaillé' : 'court', ...(collection ? { collection } : {}) }),
    timeoutMs: ASK_TIMEOUT_MS, maxBytes: 2 * 1024 * 1024,
  });
  if (!res.ok) return failed('ask_ragator', statusError(res, collection));
  const text = formatAnswer(json(res), question);
  return text ?? failed('ask_ragator', 'Réponse de Ragator illisible ou de forme inattendue');
}
