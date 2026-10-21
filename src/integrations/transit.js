// Transports d'Île-de-France en temps réel (Navitia hébergé par PRIM, Île-de-France Mobilités). Jeton PRIM gratuit.
// Idée inspirée du module « Transports » de Cornelius (lfpoulain/Cornelius, PolyForm Noncommercial 1.0.0) :
// code réécrit pour Jarvis, aucune ligne reprise telle quelle.
import { done, failed } from '../core/safety.js';

export const PRIM_BASE = 'https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia';
export const MAX_STOPS = 12;

const rec = (v) => (v && typeof v === 'object' ? v : {});
const arr = (v) => (Array.isArray(v) ? v : []);
const txt = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const seg = (v) => encodeURIComponent(v).replace(/%3A/gi, ':');

const PARIS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Paris', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

/** Navitia donne des heures locales (20261021T143000) : converties en instant exact, changements d'heure compris. */
export function parisToEpoch(value) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(String(value || ''));
  if (!m) return null;
  const want = m.slice(1).map(Number);
  const target = Date.UTC(want[0], want[1] - 1, want[2], want[3], want[4], want[5]);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const parts = PARIS.formatToParts(new Date(guess));
    const local = ['year', 'month', 'day', 'hour', 'minute', 'second'].map((t) => Number(parts.find((p) => p.type === t)?.value));
    if (local.every((v, k) => v === want[k])) return guess;
    guess += target - Date.UTC(local[0], local[1] - 1, local[2], local[3], local[4], local[5]);
  }
  return null;
}

export function mapPlaces(body) {
  return arr(rec(body).places)
    .filter((p) => rec(p).embedded_type === 'stop_area')
    .map((p) => ({ id: String(rec(p).id || ''), label: txt(rec(rec(p).stop_area).label) || txt(rec(p).name) || '', city: txt(rec(arr(rec(p).administrative_regions)[0]).name) }))
    .filter((p) => p.id)
    .slice(0, 8);
}

export function mapDepartures(body) {
  return arr(rec(body).departures).map((entry) => {
    const item = rec(entry);
    const info = rec(item.display_informations);
    const sd = rec(item.stop_date_time);
    const flags = [...arr(item.additional_informations), ...arr(sd.additional_informations)];
    const expected = parisToEpoch(txt(sd.departure_date_time));
    const scheduled = parisToEpoch(txt(sd.base_departure_date_time));
    return {
      at: expected ?? scheduled,
      realtime: txt(sd.data_freshness) === 'realtime',
      cancelled: flags.some((f) => /deleted|cancel/i.test(String(f))),
      line: txt(info.label) || txt(info.code) || '?',
      direction: txt(info.direction) || '',
    };
  }).filter((d) => d.at !== null).sort((a, b) => a.at - b.at);
}

/** Phrase à dire : les trois prochains passages, « horaire théorique » sans temps réel, jamais une panne prise pour « aucun bus ». */
export function describeDepartures(departures, name, now = Date.now()) {
  const upcoming = departures.filter((d) => !d.cancelled && d.at >= now);
  const cancelled = departures.filter((d) => d.cancelled && d.at >= now).length;
  if (!upcoming.length) return `Aucun passage prévu pour le moment à ${name}.`;
  const mins = (d) => Math.max(0, Math.round((d.at - now) / 60000));
  const first = upcoming[0];
  const parts = [`Prochain passage à ${name} : ligne ${first.line}${first.direction ? ` direction ${first.direction}` : ''} dans ${mins(first)} min${first.realtime ? '' : ' (horaire théorique)'}.`];
  if (upcoming[1]) parts.push(`Ensuite ${upcoming[1].line} dans ${mins(upcoming[1])} min${upcoming[2] ? `, puis ${upcoming[2].line} dans ${mins(upcoming[2])} min` : ''}.`);
  if (cancelled) parts.push(`${cancelled} passage${cancelled > 1 ? 's' : ''} supprimé${cancelled > 1 ? 's' : ''}.`);
  return parts.join(' ');
}

function explain(res) {
  if (res.status === 401) return 'Jeton PRIM refusé.';
  if (res.status === 403) return 'Accès PRIM refusé pour cette API.';
  if (res.status === 404) return 'Arrêt ou ligne introuvable chez PRIM.';
  if (res.status === 429) return 'Quota PRIM dépassé, réessayez plus tard.';
  if (res.status >= 500) return 'PRIM est indisponible.';
  return `PRIM a répondu ${res.status || 'sans réponse'}${res.error ? ` (${String(res.error).slice(0, 80)})` : ''}.`;
}

/**
 * Outil « transport ». deps = { token, fetcher({url,headers,timeoutMs}), store:{get,set}, now }.
 * Actions : search (query), add (stop_id, name), list, next (name), remove (name).
 */
export async function runTransit(args, deps) {
  const act = String(args.action || 'next').toLowerCase();
  const { token, fetcher, store } = deps;
  const now = deps.now ? deps.now() : Date.now();
  const stops = store.get() || [];
  const call = async (path) => {
    const res = await fetcher({ url: `${PRIM_BASE}${path}`, headers: { apikey: token }, timeoutMs: 8000 });
    if (!res.ok) return { error: explain(res) };
    const json = res.json || (() => { try { return JSON.parse(res.text); } catch { return null; } })();
    if (!json) return { error: 'Réponse PRIM illisible.' };
    return { json };
  };
  if (act === 'list') return stops.length ? 'Arrêts enregistrés :\n' + stops.map((s) => `• ${s.name} (${s.label})`).join('\n') : 'Aucun arrêt enregistré.';
  if (act === 'remove') {
    const name = String(args.name || '').toLowerCase();
    const next = stops.filter((s) => s.name.toLowerCase() !== name);
    if (next.length === stops.length) return failed('transport', `aucun arrêt nommé « ${args.name} »`);
    store.set(next);
    return done('transport', { action: 'remove', name: args.name });
  }
  if (!token) return failed('transport', 'jeton PRIM manquant : à créer gratuitement sur prim.iledefrance-mobilites.fr puis à saisir dans les Réglages');
  if (act === 'search') {
    const q = String(args.query || '').trim();
    if (q.length < 3) return failed('transport', 'au moins 3 lettres pour chercher un arrêt');
    const r = await call(`/places?q=${encodeURIComponent(q)}&type[]=stop_area&count=8&disable_geojson=true`);
    if (r.error) return failed('transport', r.error);
    const places = mapPlaces(r.json);
    return places.length ? 'Arrêts trouvés :\n' + places.map((p) => `• ${p.label}${p.city ? ` (${p.city})` : ''} — stop_id=${p.id}`).join('\n') : `Aucun arrêt ne correspond à « ${q} ».`;
  }
  if (act === 'add') {
    const id = String(args.stop_id || '').trim();
    const name = String(args.name || '').trim().slice(0, 40);
    if (!/^stop_area:[\w:.-]+$/.test(id)) return failed('transport', 'stop_id invalide : lance d’abord action=search');
    if (!name) return failed('transport', 'nom manquant (ex : « travail »)');
    if (stops.length >= MAX_STOPS) return failed('transport', `limite de ${MAX_STOPS} arrêts atteinte`);
    store.set([...stops.filter((s) => s.name.toLowerCase() !== name.toLowerCase()), { name, stopAreaId: id, label: String(args.label || name).slice(0, 80) }]);
    return done('transport', { action: 'add', name });
  }
  if (act === 'next') {
    const wanted = String(args.name || '').toLowerCase();
    const stop = wanted ? stops.find((s) => s.name.toLowerCase() === wanted) || stops.find((s) => s.name.toLowerCase().includes(wanted)) : stops[0];
    if (!stop) return failed('transport', stops.length ? `aucun arrêt nommé « ${args.name} »` : 'aucun arrêt enregistré : action=search puis action=add');
    const r = await call(`/stop_areas/${seg(stop.stopAreaId)}/departures?data_freshness=realtime&count=16&disable_geojson=true`);
    if (r.error) return failed('transport', r.error);
    return describeDepartures(mapDepartures(r.json), stop.name, now);
  }
  return failed('transport', 'action inconnue (search, add, list, next, remove)');
}
