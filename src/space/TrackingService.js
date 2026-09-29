import { hostBridge } from '../core/hostBridge.js';

const ADSBFI_ROOT = 'https://opendata.adsb.fi/api/v2';
const AIRPLANES_LIVE_ROOT = 'https://api.airplanes.live/v2';
const MAX_TRACK_POINTS = 240;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeAircraft(raw, source) {
  const lat = finite(raw.lat);
  const lon = finite(raw.lon);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const altitudeText = String(raw.alt_baro ?? '').toLowerCase();
  const ground = raw.alt_baro === 'ground' || altitudeText === 'ground' || raw.ground === true;
  const altitudeFt = finite(raw.alt_baro) ?? finite(raw.alt_geom);
  const callsign = String(raw.flight || raw.callsign || '').trim() || null;
  const type = String(raw.t || raw.type || '').trim() || null;
  const typeUpper = (type || '').toUpperCase();
  const isMilitary = (Number(raw.dbFlags || 0) & 1) !== 0 || raw.category === 'A5' || raw.category === 'A6' || raw.category === 'A7';
  const isBusiness = /^(G[0-9A-Z]{2,3}|CL[0-9A-Z]{2}|C[0-9]{3}|FA[0-9A-Z]{2}|E[0-9]{3}|PC24|PC12)/.test(typeUpper);
  const isCommercialType = /^(A3[0-9]{2}|A33|A34|A35|A38|B7[0-9]{2}|B38|B39|B77|B78|E17|E19|CRJ|AT7|DH8)/.test(typeUpper);
  const airlineCallsign = /^[A-Z]{3,4}\d/.test((callsign || '').replace(/\s+/g, '').toUpperCase());
  const category = isMilitary ? 'military' : isBusiness ? 'jet' : isCommercialType || airlineCallsign ? 'commercial' : 'private';
  return {
    icao24: String(raw.hex || raw.icao24 || '').toLowerCase().trim() || null,
    callsign,
    lat,
    lon,
    altitudeFt,
    altitudeM: altitudeFt === null || ground ? (ground ? 0 : null) : altitudeFt * 0.3048,
    ground,
    speedKnots: finite(raw.gs ?? raw.velocity),
    heading: finite(raw.track ?? raw.heading),
    verticalRateFpm: finite(raw.baro_rate ?? raw.geom_rate ?? raw.vertical_rate),
    registration: String(raw.r || raw.registration || '').trim() || null,
    type,
    category,
    squawk: String(raw.squawk || '').trim() || null,
    messages: finite(raw.messages),
    seenSeconds: finite(raw.seen_pos ?? raw.seen),
    source,
    raw,
  };
}

export async function fetchFlightsNear(lat, lon, radiusNm = 250) {
  const latitude = Number(lat).toFixed(4);
  const longitude = Number(lon).toFixed(4);
  const sources = [
    {
      name: 'adsb.fi',
      url: `${ADSBFI_ROOT}/lat/${latitude}/lon/${longitude}/dist/${Math.min(250, Math.max(10, Math.round(radiusNm)))}`,
    },
    {
      name: 'airplanes.live',
      url: `${AIRPLANES_LIVE_ROOT}/point/${latitude}/${longitude}/${Math.min(250, Math.max(10, Math.round(radiusNm)))}`,
    },
  ];

  for (const source of sources) {
    const response = await hostBridge.httpFetch(source.url, { timeoutMs: 12000 });
    if (!response.ok || !response.json) continue;
    const aircraft = response.json.ac || response.json.aircraft || response.json.states || [];
    if (!Array.isArray(aircraft)) continue;
    const dedup = new Map();
    for (const raw of aircraft) {
      const item = normalizeAircraft(raw, source.name);
      if (!item) continue;
      const key = item.icao24 || item.callsign || `${item.lat.toFixed(4)},${item.lon.toFixed(4)}`;
      if (!dedup.has(key)) dedup.set(key, item);
    }
    return { flights: [...dedup.values()], source: source.name, error: '' };
  }
  return { flights: [], source: '', error: 'Flux ADS-B temporairement indisponible. Réessayez dans quelques instants.' };
}

function parseAirport(value) {
  if (!value || typeof value !== 'object') return null;
  const lat = finite(value.latitude ?? value.lat);
  const lon = finite(value.longitude ?? value.lon ?? value.lng);
  return {
    code: value.iata_code || value.iata || value.icao_code || value.icao || null,
    iata: value.iata_code || value.iata || null,
    icao: value.icao_code || value.icao || null,
    name: value.name || null,
    city: value.municipality || value.city || null,
    country: value.country_iso_name || value.country || null,
    lat,
    lon,
  };
}

function decodeTraceRows(rows) {
  if (!Array.isArray(rows)) return [];
  let points = rows
    .map((row) => {
      if (!Array.isArray(row)) return null;
      const lat = finite(row[1]);
      const lon = finite(row[2]);
      if (lat === null || lon === null) return null;
      const altFt = typeof row[3] === 'number' ? row[3] : null;
      return { lat, lon, altitudeFt: altFt, ground: row[3] === 'ground' };
    })
    .filter(Boolean);
  if (points.length > MAX_TRACK_POINTS) {
    const step = (points.length - 1) / (MAX_TRACK_POINTS - 1);
    points = Array.from({ length: MAX_TRACK_POINTS }, (_, i) => points[Math.round(i * step)]);
  }
  return points;
}

export async function fetchAircraftDetails(flight) {
  const icao24 = String(flight?.icao24 || '').toLowerCase().trim();
  const callsign = String(flight?.callsign || '').trim().toUpperCase();
  const requests = [];
  if (callsign) {
    requests.push(hostBridge.httpFetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign)}`, { timeoutMs: 9000 }));
  }
  if (icao24 && /^[0-9a-f]{6}$/.test(icao24)) {
    requests.push(hostBridge.httpFetch(`https://api.adsbdb.com/v0/aircraft/${encodeURIComponent(icao24)}`, { timeoutMs: 9000 }));
    const shard = icao24.slice(-2);
    requests.push(hostBridge.httpFetch(`https://api.adsb.lol/data/traces/${shard}/trace_full_${icao24}.json`, { timeoutMs: 9000 }));
  }
  const responses = await Promise.all(requests);
  let aircraft = null;
  let route = null;
  let track = [];
  const warnings = [];
  for (const response of responses) {
    if (!response.ok || !response.json) {
      if (response.error) warnings.push(response.error);
      continue;
    }
    const data = response.json;
    const ad = data?.response?.aircraft || data?.aircraft || null;
    const fr = data?.response?.flightroute || data?.flightroute || null;
    if (ad || fr) {
      aircraft = {
        registration: ad?.registration || null,
        typeCode: ad?.icao_type || ad?.type || null,
        model: [ad?.manufacturer, ad?.type].filter(Boolean).join(' ') || null,
        operator: ad?.registered_owner || null,
        manufacturer: ad?.manufacturer || null,
      };
      route = fr
        ? {
            airline: fr.airline?.name || null,
            airlineIcao: fr.airline?.icao || fr.airline?.iata || null,
            origin: parseAirport(fr.origin),
            destination: parseAirport(fr.destination),
          }
        : route;
    }
    if (Array.isArray(data?.trace)) track = decodeTraceRows(data.trace);
  }
  const trackStart = track[0] || null;
  const trackEnd = track[track.length - 1] || null;
  return {
    aircraft: {
      registration: aircraft?.registration || flight?.registration || null,
      typeCode: aircraft?.typeCode || flight?.type || null,
      model: aircraft?.model || flight?.type || null,
      operator: aircraft?.operator || route?.airline || null,
      manufacturer: aircraft?.manufacturer || null,
    },
    route: route || null,
    track,
    trackStart,
    trackEnd,
    warnings,
    sources: ['adsbdb.com', ...(track.length ? ['adsb.lol'] : [])],
  };
}

export async function fetchSatelliteLiveState(noradId) {
  const id = Number(noradId);
  if (!Number.isFinite(id)) return null;
  const result = await hostBridge.httpFetch(`https://api.wheretheiss.at/v1/satellites/${id}`, { timeoutMs: 9000 });
  if (!result.ok || !result.json) return null;
  const data = result.json;
  const latitude = finite(data.latitude);
  const longitude = finite(data.longitude);
  if (latitude === null || longitude === null) return null;
  return {
    latitude,
    longitude,
    altitudeKm: finite(data.altitude),
    velocityKmh: finite(data.velocity),
    visibility: data.visibility || null,
    footprintKm: finite(data.footprint),
    solarLatitude: finite(data.solar_lat),
    solarLongitude: finite(data.solar_lon),
    timestamp: finite(data.timestamp),
    source: 'WhereTheISS.at',
  };
}

export function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
