// Fuzzy, accent-insensitive device-name matching shared by Home Assistant and Tuya.

export const normalizeName = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, ' ').trim();

const STOPWORDS = new Set(['le', 'la', 'les', 'l', 'un', 'une', 'du', 'de', 'des', 'd', 'mon', 'ma', 'mes', 'au', 'aux', 'a', 'dans', 'sur']);
const GENERIC = new Set(['lumiere', 'lumieres', 'lampe', 'lampes', 'ampoule', 'ampoules', 'prise', 'prises', 'ventilateur', 'interrupteur']);

const tokens = (value) => normalizeName(value).split(/[^a-z0-9]+/).filter((token) => token && !STOPWORDS.has(token));

/** Returns the best candidates: exact name, then substring, then all-tokens, then tokens without generic words. */
export function matchByName(items, query, getName = (item) => item.name) {
  const wanted = normalizeName(query);
  if (!wanted) return [];
  const exact = items.filter((item) => normalizeName(getName(item)) === wanted);
  if (exact.length) return exact;
  const partial = items.filter((item) => normalizeName(getName(item)).includes(wanted));
  if (partial.length) return partial;
  const wantedTokens = tokens(query);
  if (!wantedTokens.length) return [];
  const hasAll = (needed) => items.filter((item) => {
    const nameTokens = tokens(getName(item));
    return needed.every((token) => nameTokens.some((candidate) => candidate === token || candidate.startsWith(token) || (token.startsWith(candidate) && candidate.length > 3)));
  });
  const all = hasAll(wantedTokens);
  if (all.length) return all;
  const specific = wantedTokens.filter((token) => !GENERIC.has(token));
  return specific.length && specific.length < wantedTokens.length ? hasAll(specific) : [];
}
