// Heure dans un fuseau ou une ville (Intl, hors ligne). Idée inspirée du module « Heure » de Cornelius.

const CITIES = {
  paris: 'Europe/Paris', france: 'Europe/Paris', londres: 'Europe/London', london: 'Europe/London', berlin: 'Europe/Berlin', madrid: 'Europe/Madrid', rome: 'Europe/Rome',
  lisbonne: 'Europe/Lisbon', bruxelles: 'Europe/Brussels', geneve: 'Europe/Zurich', zurich: 'Europe/Zurich', moscou: 'Europe/Moscow', istanbul: 'Europe/Istanbul',
  'new york': 'America/New_York', newyork: 'America/New_York', washington: 'America/New_York', chicago: 'America/Chicago', denver: 'America/Denver', 'los angeles': 'America/Los_Angeles',
  'san francisco': 'America/Los_Angeles', montreal: 'America/Toronto', toronto: 'America/Toronto', vancouver: 'America/Vancouver', mexico: 'America/Mexico_City', 'sao paulo': 'America/Sao_Paulo',
  'buenos aires': 'America/Argentina/Buenos_Aires', tokyo: 'Asia/Tokyo', japon: 'Asia/Tokyo', seoul: 'Asia/Seoul', pekin: 'Asia/Shanghai', beijing: 'Asia/Shanghai', shanghai: 'Asia/Shanghai',
  'hong kong': 'Asia/Hong_Kong', singapour: 'Asia/Singapore', bangkok: 'Asia/Bangkok', dubai: 'Asia/Dubai', delhi: 'Asia/Kolkata', mumbai: 'Asia/Kolkata', inde: 'Asia/Kolkata',
  sydney: 'Australia/Sydney', melbourne: 'Australia/Melbourne', auckland: 'Pacific/Auckland', casablanca: 'Africa/Casablanca', alger: 'Africa/Algiers', tunis: 'Africa/Tunis',
  'le caire': 'Africa/Cairo', dakar: 'Africa/Dakar', lagos: 'Africa/Lagos', johannesburg: 'Africa/Johannesburg', reunion: 'Indian/Reunion', 'la reunion': 'Indian/Reunion',
  martinique: 'America/Martinique', guadeloupe: 'America/Guadeloupe', tahiti: 'Pacific/Tahiti', noumea: 'Pacific/Noumea', utc: 'UTC',
};

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

/** Ville courante ou identifiant IANA (« Asia/Tokyo ») → fuseau valide, sinon null. */
export function resolveZone(place) {
  const raw = String(place || '').trim();
  if (!raw) return 'Europe/Paris';
  const zone = CITIES[fold(raw)] || raw;
  try { new Intl.DateTimeFormat('fr-FR', { timeZone: zone }); return zone; } catch { return null; }
}

const dayNumber = (zone, date) => Number(new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date)
  .reduce((acc, p) => (p.type === 'year' ? acc + Number(p.value) * 400 : p.type === 'month' ? acc + Number(p.value) * 31 : p.type === 'day' ? acc + Number(p.value) : acc), 0));

export function describeTime(place, date = new Date()) {
  const zone = resolveZone(place);
  if (!zone) return null;
  const time = new Intl.DateTimeFormat('fr-FR', { timeZone: zone, hour: '2-digit', minute: '2-digit' }).format(date);
  const day = new Intl.DateTimeFormat('fr-FR', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long' }).format(date);
  const diff = dayNumber(zone, date) - dayNumber('Europe/Paris', date);
  const note = diff > 0 ? ' (le lendemain par rapport à Paris)' : diff < 0 ? ' (la veille par rapport à Paris)' : '';
  return `Il est ${time.replace(':', ' h ')} (${zone.replace(/_/g, ' ')}), le ${day}${note}.`;
}
