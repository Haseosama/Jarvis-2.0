'use strict';
// Client HTTP des outils (jarvis:http-fetch) : redirections suivies à la main et bornées, jamais de repli vers http,
// jetons non renvoyés à un autre site, réponse coupée à une taille maximale et signalée (idée du client HTTP des
// modules de Cornelius, réécrite pour Jarvis).

const MAX_REDIRECTS = 3;
const MAX_BYTES = 8 * 1024 * 1024;
const SENSITIVE = /^(authorization|cookie|proxy-authorization|x-api-key|apikey|xi-api-key)$/i;

/** Prochaine URL d'une redirection, ou { error }. Pure : testable sans réseau. */
function nextHop(current, location, headers) {
  let target;
  try { target = new URL(location, current); } catch { return { error: 'Redirection invalide.' }; }
  if (!/^https?:$/.test(target.protocol)) return { error: 'Redirection vers un protocole non pris en charge.' };
  if (current.protocol === 'https:' && target.protocol === 'http:') return { error: 'Redirection refusée : https vers http.' };
  const sameSite = target.origin === current.origin;
  const next = {};
  for (const [k, v] of Object.entries(headers || {})) if (sameSite || !SENSITIVE.test(k)) next[k] = v;
  return { url: target, headers: next };
}

/** Lit le corps jusqu'à maxBytes ; { buffer, truncated }. */
async function readCapped(res, maxBytes) {
  const reader = res.body?.getReader?.();
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > maxBytes ? { buffer: buf.subarray(0, maxBytes), truncated: true } : { buffer: buf, truncated: false };
  }
  const chunks = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      chunks.push(value.subarray(0, value.length - (size - maxBytes)));
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
  }
  return { buffer: Buffer.concat(chunks.map((c) => Buffer.from(c))), truncated };
}

async function guardedFetch(url, { method = 'GET', headers = {}, body, signal, maxBytes = MAX_BYTES, fetchImpl = fetch } = {}) {
  let current = new URL(url);
  let hdrs = headers;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetchImpl(current.toString(), { method, headers: hdrs, body: method === 'GET' || method === 'HEAD' ? undefined : body, signal, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      if (method !== 'GET' && method !== 'HEAD') return { res, buffer: Buffer.alloc(0), truncated: false, error: 'La source renvoie vers une autre adresse : utiliser son adresse finale.' };
      if (hop === MAX_REDIRECTS) return { res, buffer: Buffer.alloc(0), truncated: false, error: 'Trop de redirections.' };
      const hopped = nextHop(current, res.headers.get('location'), hdrs);
      if (hopped.error) return { res, buffer: Buffer.alloc(0), truncated: false, error: hopped.error };
      current = hopped.url;
      hdrs = hopped.headers;
      continue;
    }
    const { buffer, truncated } = await readCapped(res, maxBytes);
    return { res, buffer, truncated };
  }
  return { res: null, buffer: Buffer.alloc(0), truncated: false, error: 'Trop de redirections.' };
}

module.exports = { guardedFetch, nextHop, readCapped, MAX_REDIRECTS, MAX_BYTES };
