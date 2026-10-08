import { hostBridge } from '../core/hostBridge.js';

const EARTH_RADIUS_KM = 6371.0088;
const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const DEG = Math.PI / 180;

const POI_FILTERS = [
  { match: /hospital|clinic|doctor|dentist|veterinar|medical|hôpital|clinique|médecin|dentiste|vétérinaire|santé/i, tag: '"amenity"~"^(hospital|clinic|doctors|dentist|veterinary)$"' },
  { match: /pharmacy|chemist|pharmacie/i, tag: '"amenity"="pharmacy"' },
  { match: /restaurant|food|dinner|lunch|resto|manger|restaurant/i, tag: '"amenity"~"^(restaurant|fast_food)$"' },
  { match: /cafe|coffee|café|coffee shop/i, tag: '"amenity"="cafe"' },
  { match: /bakery|boulangerie|baker/i, tag: '"shop"="bakery"' },
  { match: /\bbar\b|pub|nightlife/i, tag: '"amenity"~"^(bar|pub|nightclub)$"' },
  { match: /school|university|college|école|université|lycée/i, tag: '"amenity"~"^(school|university|college)$"' },
  { match: /post.?office|bureau de poste|poste|courrier/i, tag: '"amenity"="post_office"' },
  { match: /fuel|gas|petrol|diesel|station.?service|carburant|essence/i, tag: '"amenity"~"^(fuel|charging_station)$"' },
  { match: /hotel|motel|lodging|resort|hôtel|hébergement/i, tag: '"tourism"~"^(hotel|guest_house|motel)$"' },
  { match: /bank|atm|cash|banque|distributeur/i, tag: '"amenity"~"^(bank|atm)$"' },
  { match: /police|security|commissariat|police/i, tag: '"amenity"="police"' },
  { match: /grocery|supermarket|market|supermarché|épicerie|courses/i, tag: '"shop"~"^(supermarket|convenience)$"' },
  { match: /parking|car park|stationnement/i, tag: '"amenity"="parking"' },
  { match: /museum|attraction|sight|tourist|musée|tourisme|monument/i, tag: '"tourism"~"^(museum|attraction|viewpoint)$"' },
];

function validCoordinates(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function coordinatesFrom(value) {
  if (typeof value === 'string') {
    const match = /^\s*([+-]?\d{1,2}(?:\.\d+)?)\s*[,;]\s*([+-]?\d{1,3}(?:\.\d+)?)\s*$/.exec(value);
    if (match) {
      const lat = Number(match[1]);
      const lon = Number(match[2]);
      if (validCoordinates(lat, lon)) return { lat, lon, label: `${lat.toFixed(3)}, ${lon.toFixed(3)}` };
    }
  }
  if (value && typeof value === 'object') {
    const lat = Number(value.lat ?? value.latitude ?? value.latDeg);
    const lon = Number(value.lon ?? value.lng ?? value.longitude ?? value.lonDeg);
    if (validCoordinates(lat, lon)) return { lat, lon, label: String(value.label || value.name || `${lat.toFixed(3)}, ${lon.toFixed(3)}`) };
  }
  return null;
}

export function greatCircleDistanceKm(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return NaN;
  const phi1 = lat1 * DEG;
  const phi2 = lat2 * DEG;
  const dPhi = (lat2 - lat1) * DEG;
  const dLambda = (lon2 - lon1) * DEG;
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function calculateGreatCircleRoute(origin, destination, pointCount = 64) {
  const from = coordinatesFrom(origin);
  const to = coordinatesFrom(destination);
  if (!from || !to) throw new Error('Coordonnées d’itinéraire invalides.');
  const distanceKm = greatCircleDistanceKm(from.lat, from.lon, to.lat, to.lon);
  const phi1 = from.lat * DEG;
  const phi2 = to.lat * DEG;
  const lambda1 = from.lon * DEG;
  const lambda2 = to.lon * DEG;
  const y = Math.sin(lambda2 - lambda1) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda2 - lambda1);
  const bearingDeg = (Math.atan2(y, x) / DEG + 360) % 360;
  const omega = distanceKm / EARTH_RADIUS_KM;
  const sinOmega = Math.sin(omega);
  const count = Math.max(2, Math.min(256, Math.round(pointCount)));
  const waypoints = [];
  const startVector = [Math.cos(phi1) * Math.cos(lambda1), Math.cos(phi1) * Math.sin(lambda1), Math.sin(phi1)];
  let antipodalVector = null;
  if (omega > Math.PI - 1e-7) {
    const reference = Math.abs(startVector[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
    const cross = [
      startVector[1] * reference[2] - startVector[2] * reference[1],
      startVector[2] * reference[0] - startVector[0] * reference[2],
      startVector[0] * reference[1] - startVector[1] * reference[0],
    ];
    const magnitude = Math.hypot(...cross) || 1;
    antipodalVector = cross.map((component) => component / magnitude);
  }

  for (let index = 0; index <= count; index++) {
    const fraction = index / count;
    if (omega < 1e-8) {
      waypoints.push([from.lat, from.lon]);
      continue;
    }
    let vx; let vy; let vz;
    if (antipodalVector) {
      const cosine = Math.cos(omega * fraction);
      const sine = Math.sin(omega * fraction);
      vx = startVector[0] * cosine + antipodalVector[0] * sine;
      vy = startVector[1] * cosine + antipodalVector[1] * sine;
      vz = startVector[2] * cosine + antipodalVector[2] * sine;
    } else {
      const a = Math.sin((1 - fraction) * omega) / sinOmega;
      const b = Math.sin(fraction * omega) / sinOmega;
      vx = a * Math.cos(phi1) * Math.cos(lambda1) + b * Math.cos(phi2) * Math.cos(lambda2);
      vy = a * Math.cos(phi1) * Math.sin(lambda1) + b * Math.cos(phi2) * Math.sin(lambda2);
      vz = a * Math.sin(phi1) + b * Math.sin(phi2);
    }
    const lat = Math.atan2(vz, Math.hypot(vx, vy)) / DEG;
    const lon = Math.atan2(vy, vx) / DEG;
    waypoints.push([Number(lat.toFixed(5)), Number(lon.toFixed(5))]);
  }

  return {
    mode: 'great-circle',
    source: 'Great-circle fallback',
    origin: from,
    destination: to,
    distanceKm: Number(distanceKm.toFixed(1)),
    durationMinutes: null,
    bearingDeg: Number(bearingDeg.toFixed(1)),
    waypoints,
    focus: { lat: waypoints[Math.floor(waypoints.length / 2)][0], lon: waypoints[Math.floor(waypoints.length / 2)][1], zoom: 2.4 },
  };
}

export async function geocodeLocation(location) {
  const point = coordinatesFrom(location);
  if (point) return point;
  const query = String(location || '').trim();
  if (!query || query.length > 160) throw new Error('Indiquez une ville ou des coordonnées valides.');
  const response = await hostBridge.httpFetch(`${GEOCODING_URL}?name=${encodeURIComponent(query)}&count=1&language=fr&format=json`, { timeoutMs: 10000 });
  const first = response.json?.results?.[0];
  if (!response.ok || !first) throw new Error(`Lieu introuvable : ${query}.`);
  const lat = Number(first.latitude);
  const lon = Number(first.longitude);
  if (!validCoordinates(lat, lon)) throw new Error(`Coordonnées invalides pour ${query}.`);
  return {
    lat,
    lon,
    label: [first.name, first.admin1, first.country].filter(Boolean).join(', '),
  };
}

export async function calculateDrivingRoute(originInput, destinationInput) {
  const [origin, destination] = await Promise.all([
    geocodeLocation(originInput),
    geocodeLocation(destinationInput),
  ]);
  const fallback = calculateGreatCircleRoute(origin, destination);
  const coordinates = `${origin.lon.toFixed(5)},${origin.lat.toFixed(5)};${destination.lon.toFixed(5)},${destination.lat.toFixed(5)}`;
  try {
    const response = await hostBridge.httpFetch(
      `${OSRM_URL}/${coordinates}?overview=full&geometries=geojson&steps=false`,
      { timeoutMs: 16000 }
    );
    const route = response.json?.routes?.[0];
    const coords = route?.geometry?.coordinates;
    const routeDistanceKm = Number(route?.distance) / 1000;
    const routeDurationMinutes = Number(route?.duration) / 60;
    if (response.ok && response.json?.code === 'Ok'
      && Number.isFinite(routeDistanceKm) && routeDistanceKm >= 0
      && Number.isFinite(routeDurationMinutes) && routeDurationMinutes >= 0
      && Array.isArray(coords) && coords.length > 1) {
      const waypoints = coords
        .filter((pair) => Array.isArray(pair) && validCoordinates(Number(pair[1]), Number(pair[0])))
        .map(([lon, lat]) => [Number(Number(lat).toFixed(5)), Number(Number(lon).toFixed(5))]);
      if (waypoints.length > 1) {
        const middle = waypoints[Math.floor(waypoints.length / 2)];
        const distanceKm = Number(routeDistanceKm.toFixed(1));
        return {
          ...fallback,
          mode: 'driving',
          source: 'OSRM / OpenStreetMap',
          distanceKm,
          durationMinutes: Math.round(routeDurationMinutes),
          waypoints,
          focus: { lat: middle[0], lon: middle[1], zoom: 4.2 },
        };
      }
    }
  } catch {
    // Public routing service may be busy; the labeled great-circle fallback remains useful.
  }
  return fallback;
}

function categoryFilter(query) {
  return POI_FILTERS.find((item) => item.match.test(String(query || '')))?.tag || null;
}

function haversineKm(pointA, pointB) {
  return greatCircleDistanceKm(pointA.lat, pointA.lon, pointB.lat, pointB.lon);
}

export async function searchNearbyPlaces(query, location, radiusKm = 8) {
  const center = await geocodeLocation(location);
  const cleanedQuery = String(query || '').trim();
  if (!cleanedQuery || cleanedQuery.length > 80) throw new Error('Indiquez le type de lieu à rechercher.');
  const radius = Math.max(1, Math.min(25, Number(radiusKm) || 8)) * 1000;
  const filter = categoryFilter(cleanedQuery);

  if (filter) {
    const lat = center.lat.toFixed(5);
    const lon = center.lon.toFixed(5);
    const overpassQuery = `[out:json][timeout:12];(node[${filter}](around:${radius},${lat},${lon});way[${filter}](around:${radius},${lat},${lon});relation[${filter}](around:${radius},${lat},${lon}););out center 40;`;
    try {
      const response = await hostBridge.httpFetch(OVERPASS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: `data=${encodeURIComponent(overpassQuery)}`,
        timeoutMs: 18000,
      });
      const elements = response.json?.elements;
      if (response.ok && Array.isArray(elements)) {
        const seen = new Set();
        const places = elements.flatMap((element) => {
          const tags = element.tags || {};
          const name = tags.name || tags.brand || tags.operator;
          const lat = Number(element.lat ?? element.center?.lat);
          const lon = Number(element.lon ?? element.center?.lon);
          if (!name || !validCoordinates(lat, lon)) return [];
          const key = `${String(name).toLowerCase()}|${lat.toFixed(4)}|${lon.toFixed(4)}`;
          if (seen.has(key)) return [];
          seen.add(key);
          const address = [tags['addr:housenumber'], tags['addr:street'], tags['addr:city']].filter(Boolean).join(' ');
          return [{
            name: String(name),
            label: String(name),
            lat,
            lon,
            distanceKm: Number(haversineKm(center, { lat, lon }).toFixed(2)),
            type: tags.amenity || tags.tourism || tags.shop || 'poi',
            address,
            source: 'OpenStreetMap / Overpass',
          }];
        }).sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 15);
        if (places.length) return { center, places, source: 'OpenStreetMap / Overpass', radiusKm: radius / 1000 };
      }
    } catch {
      // Nominatim fallback below.
    }
  }

  const textQuery = `${cleanedQuery} in ${center.label}`;
  const viewbox = `${center.lon - 0.25},${center.lat + 0.25},${center.lon + 0.25},${center.lat - 0.25}`;
  const fallbackResponse = await hostBridge.httpFetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&namedetails=1&limit=15&bounded=1&q=${encodeURIComponent(textQuery)}&viewbox=${encodeURIComponent(viewbox)}`,
    { timeoutMs: 12000 }
  );
  const results = Array.isArray(fallbackResponse.json) ? fallbackResponse.json : [];
  const places = results.flatMap((item) => {
    const lat = Number(item.lat);
    const lon = Number(item.lon);
    if (!validCoordinates(lat, lon)) return [];
    const distanceKm = haversineKm(center, { lat, lon });
    if (distanceKm > radius / 1000) return [];
    const name = item.namedetails?.name || String(item.display_name || cleanedQuery).split(',')[0];
    return [{ name, label: name, lat, lon, distanceKm: Number(distanceKm.toFixed(2)), type: item.type || 'poi', address: String(item.display_name || ''), source: 'OpenStreetMap / Nominatim' }];
  }).sort((a, b) => a.distanceKm - b.distanceKm);
  return { center, places, source: 'OpenStreetMap / Nominatim', radiusKm: radius / 1000 };
}

export function poiSearchCategory(query) {
  return POI_FILTERS.find((item) => item.match.test(String(query || '')))?.tag ? 'overpass' : 'geocoded-search';
}
