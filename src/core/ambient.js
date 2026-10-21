// Cartes d'affichage permanent (idée de Cornelius : « refreshAt », recalcul à l'heure dite sans réseau).
//
// Une carte garde son dernier relevé ; l'affichage est RECALCULÉ localement : l'horloge à chaque minute, le compte à rebours des bus
// chaque minute, la météo au changement de jour. Le réseau ne sert qu'à renouveler le relevé. Une panne ne devient jamais « aucun bus » :
// le dernier relevé reste affiché comme « dernier horaire connu », et un relevé de plus de 24 h n'est plus affiché.

export const FRESH_MAX_MS = 24 * 3600 * 1000;
export const TRANSIT_REFRESH_MS = 60_000;
export const WEATHER_REFRESH_MS = 30 * 60_000;

const WEATHER_LABELS = { 0: 'Ciel dégagé', 1: 'Plutôt dégagé', 2: 'Partiellement nuageux', 3: 'Couvert', 45: 'Brouillard', 48: 'Brouillard givrant', 51: 'Bruine', 53: 'Bruine', 55: 'Bruine dense', 61: 'Pluie faible', 63: 'Pluie', 65: 'Forte pluie', 71: 'Neige faible', 73: 'Neige', 75: 'Forte neige', 80: 'Averses', 81: 'Averses', 82: 'Fortes averses', 95: 'Orage', 96: 'Orage et grêle', 99: 'Orage et grêle' };

const fmt = (tz, opts, date) => new Intl.DateTimeFormat('fr-FR', { timeZone: tz, ...opts }).format(date);

/** Prochain instant où l'affichage doit changer : début de la minute suivante (heure), ou minuit dans le fuseau (jour). */
export function nextMinute(now) { return (Math.floor(now / 60000) + 1) * 60000; }

export function clockCard(now, tz = 'Europe/Paris') {
  const zone = (() => { try { new Intl.DateTimeFormat('fr-FR', { timeZone: tz }); return tz; } catch { return 'Europe/Paris'; } })();
  const date = new Date(now);
  return {
    id: 'clock', title: 'Heure', primary: fmt(zone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, date).replace(':', ' h '),
    subtitle: fmt(zone, { weekday: 'long', day: 'numeric', month: 'long' }, date), items: [], status: 'ok', refreshAt: nextMinute(now),
  };
}

/** Minutes avant un passage, recalculées à partir de l'instant prévu : aucun réseau nécessaire. */
export function transitCard(snapshot, now, name = 'Bus') {
  const base = { id: 'transit', title: name, items: [], refreshAt: nextMinute(now) };
  if (!snapshot || !snapshot.at) return { ...base, primary: '—', subtitle: 'Pas encore de relevé', status: 'pending' };
  if (now - snapshot.at > FRESH_MAX_MS) return { ...base, primary: '—', subtitle: 'Relevé trop ancien', status: 'stale' };
  const stale = Boolean(snapshot.failedAt && snapshot.failedAt > snapshot.at);
  const upcoming = (snapshot.departures || []).filter((d) => !d.cancelled && d.at >= now).sort((a, b) => a.at - b.at);
  if (!upcoming.length) {
    // Le relevé disait « rien » (nuit, ligne interrompue) : c'est une information, pas une panne. Des horaires dépassés ne le sont pas.
    const expired = (snapshot.departures || []).some((d) => !d.cancelled);
    return { ...base, primary: expired ? '—' : 'Aucun passage', subtitle: expired ? 'Les derniers horaires connus sont dépassés' : 'Aucun passage prévu pour le moment', status: expired ? 'stale' : 'empty' };
  }
  const mins = (d) => Math.max(0, Math.round((d.at - now) / 60000));
  const first = upcoming[0];
  return {
    ...base,
    primary: `${mins(first)} min`,
    subtitle: `Ligne ${first.line}${first.direction ? ` → ${first.direction}` : ''}${first.realtime ? '' : ' · horaire théorique'}${stale ? ' · dernier horaire connu' : ''}`,
    items: upcoming.slice(1, 3).map((d, i) => ({ label: i === 0 ? 'Suivant' : 'Puis', value: `${mins(d)} min · ligne ${d.line}` })),
    status: stale ? 'stale' : 'ok',
  };
}

/** Météo du jour affichée depuis le dernier relevé ; les jours passés sont écartés et le jour change à minuit (fuseau du relevé). */
export function weatherCard(snapshot, now, tz = 'Europe/Paris') {
  const base = { id: 'weather', title: 'Météo', items: [], refreshAt: nextMinute(now) };
  if (!snapshot || !snapshot.at) return { ...base, primary: '—', subtitle: 'Pas encore de relevé', status: 'pending' };
  if (now - snapshot.at > FRESH_MAX_MS) return { ...base, primary: '—', subtitle: 'Relevé trop ancien', status: 'stale' };
  const today = fmt(tz, { year: 'numeric', month: '2-digit', day: '2-digit' }, new Date(now)).split('/').reverse().join('-');
  const day = (snapshot.days || []).find((d) => d.date === today);
  const stale = Boolean(snapshot.failedAt && snapshot.failedAt > snapshot.at);
  if (!day) return { ...base, primary: '—', subtitle: 'Prévision du jour indisponible', status: 'stale' };
  const current = fmt(tz, { year: 'numeric', month: '2-digit', day: '2-digit' }, new Date(snapshot.at)).split('/').reverse().join('-') === today && Number.isFinite(snapshot.temp);
  return {
    ...base,
    primary: current ? `${Math.round(snapshot.temp)}°` : `${Math.round(day.max)}°`,
    subtitle: `${WEATHER_LABELS[day.code] || 'Météo'} · min ${Math.round(day.min)}° / max ${Math.round(day.max)}°${stale ? ' · dernier relevé' : ''}`,
    items: Number.isFinite(day.rain) && day.rain >= 30 ? [{ label: 'Pluie', value: `${day.rain} %` }] : [],
    status: stale ? 'stale' : 'ok',
  };
}

/** Réponse Open-Meteo → relevé stocké. */
export function weatherSnapshot(json, now = Date.now()) {
  const d = json?.daily;
  if (!d || !Array.isArray(d.time)) return null;
  return {
    at: now,
    temp: Number(json.current?.temperature_2m),
    days: d.time.map((date, i) => ({ date, min: d.temperature_2m_min?.[i], max: d.temperature_2m_max?.[i], code: d.weather_code?.[i], rain: d.precipitation_probability_max?.[i] })),
  };
}
