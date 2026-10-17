// Surveillance de sujets (port de la surveillance d'arrière-plan de Mark LVI) : une fois par jour, les nouveaux titres
// d'un sujet sont signalés. La première vérification pose la référence sans rien annoncer.

export const CHECK_INTERVAL_MS = 20 * 3600 * 1000;
export const MAX_TOPICS = 10;
const SEEN_LIMIT = 200;

const decode = (s) =>
  String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .trim();

export function parseRssItems(xml) {
  const items = [];
  for (const m of String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const title = decode(/<title>([\s\S]*?)<\/title>/.exec(m[1])?.[1]);
    const link = decode(/<link>([\s\S]*?)<\/link>/.exec(m[1])?.[1]);
    if (title) items.push({ title, link });
  }
  return items;
}

export const newsUrl = (topic) => `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=fr&gl=FR&ceid=FR:fr`;

export function normalizeTopic(topic) {
  return String(topic || '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/**
 * Vérifie les sujets échus. `store` = { get(), set(list) } ; `fetcher(url)` → { ok, text }.
 * Retourne [{ topic, items }] pour les sujets ayant de nouveaux titres.
 */
export async function checkTopics({ store, fetcher, now = Date.now(), force = false, only = null }) {
  const alerts = [];
  const list = [...(store.get() || [])];
  for (let i = 0; i < list.length; i++) {
    const w = list[i];
    if (only && w.topic.toLowerCase() !== only.toLowerCase()) continue;
    if (!force && w.lastCheck && now - w.lastCheck < CHECK_INTERVAL_MS) continue;
    const res = await fetcher(newsUrl(w.topic));
    if (!res?.ok) continue;
    const items = parseRssItems(res.text).slice(0, 15);
    const seen = new Set(w.seen || []);
    const fresh = items.filter((it) => !seen.has(it.title));
    list[i] = { ...w, lastCheck: now, seen: [...fresh.map((f) => f.title), ...(w.seen || [])].slice(0, SEEN_LIMIT) };
    if (w.lastCheck && fresh.length) alerts.push({ topic: w.topic, items: fresh.slice(0, 3) });
  }
  store.set(list);
  return alerts;
}

export function alertText(alerts) {
  return alerts.map((a) => `📰 ${a.topic} : ${a.items.map((i) => i.title).join(' · ')}`).join('\n');
}
