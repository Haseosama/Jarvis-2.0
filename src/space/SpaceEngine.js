// Port of MapData.kt, Astro.kt, Sgp4.kt, NightSky.kt, Aurora.kt, Quakes.kt, Launches.kt from Jarvis-Android

const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;
const AU_KM = 149597870.7;

export function mercX(lon) {
  return (lon + 180) / 360;
}

export function mercY(lat) {
  const l = Math.max(-85.05, Math.min(85.05, lat)) * DEG;
  return (1 - Math.log(Math.tan(l) + 1 / Math.cos(l)) / Math.PI) / 2;
}

export function latOf(y) {
  return Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / DEG;
}

export function distanceKm(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * DEG, l1 = lon1 * DEG;
  const p2 = lat2 * DEG, l2 = lon2 * DEG;
  const dLat = p2 - p1, dLon = l2 - l1;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function parseMapRings(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  let pos = 0;
  const count = dv.getInt32(pos, true);
  pos += 4;
  const rings = [];
  for (let r = 0; r < count; r++) {
    const n = dv.getInt32(pos, true);
    pos += 4;
    const pts = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const lon = dv.getInt16(pos, true) / 100.0;
      const lat = dv.getInt16(pos + 2, true) / 100.0;
      pos += 4;
      pts[2 * i] = mercX(lon);
      pts[2 * i + 1] = mercY(lat);
    }
    rings.push(pts);
  }
  return rings;
}

export function parseCities(tsv) {
  return String(tsv || '')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const f = l.split('\t');
      if (f.length < 5) return null;
      return {
        name: f[0],
        lat: parseFloat(f[1]),
        lon: parseFloat(f[2]),
        population: parseInt(f[3], 10) || 0,
        capital: f[4].trim() === '1',
      };
    })
    .filter(Boolean);
}

let cachedMapData = null;
export async function loadMapData() {
  if (cachedMapData) return cachedMapData;
  const [landRes, bordersRes, citiesRes] = await Promise.all([
    fetch('./assets/sky/land.bin'),
    fetch('./assets/sky/borders.bin'),
    fetch('./assets/sky/cities.tsv'),
  ]);
  const [landBuf, bordersBuf, citiesTsv] = await Promise.all([
    landRes.arrayBuffer(),
    bordersRes.arrayBuffer(),
    citiesRes.text(),
  ]);
  cachedMapData = {
    land: parseMapRings(landBuf),
    borders: parseMapRings(bordersBuf),
    cities: parseCities(citiesTsv),
  };
  return cachedMapData;
}

// ── Astronomy & SGP4 Helpers ─────────────────────────────────────────────────

export function julian(timeMs) {
  return timeMs / 86400000.0 + 2440587.5;
}

export function gmst(timeMs) {
  const t = (julian(timeMs) - 2451545.0) / 36525.0;
  const s = -6.2e-6 * t * t * t + 0.093104 * t * t + (876600.0 * 3600 + 8640184.812866) * t + 67310.54841;
  const a = (s * DEG) / 240.0;
  return a - TWO_PI * Math.floor(a / TWO_PI);
}

export function temeToEcef(x, y, z, timeMs) {
  const g = gmst(timeMs);
  return [Math.cos(g) * x + Math.sin(g) * y, -Math.sin(g) * x + Math.cos(g) * y, z];
}

export function subPoint([x, y, z]) {
  const r = Math.hypot(x, y, z);
  const lat = Math.atan2(z, Math.hypot(x, y)) / DEG;
  const lon = Math.atan2(y, x) / DEG;
  return { lat, lon, altKm: r - 6371.0 };
}

export function observerEcef(latDeg, lonDeg, heightKm = 0) {
  const a = 6378.137;
  const f = 1 / 298.257223563;
  const e2 = f * (2 - f);
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const n = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  return [
    (n + heightKm) * Math.cos(lat) * Math.cos(lon),
    (n + heightKm) * Math.cos(lat) * Math.sin(lon),
    (n * (1 - e2) + heightKm) * Math.sin(lat),
  ];
}

export function lookAt(observer, ecefPt) {
  const [ox, oy, oz] = observerEcef(observer.latDeg, observer.lonDeg, observer.heightKm || 0);
  const rx = ecefPt[0] - ox;
  const ry = ecefPt[1] - oy;
  const rz = ecefPt[2] - oz;
  const lat = observer.latDeg * DEG;
  const lon = observer.lonDeg * DEG;
  const e = -Math.sin(lon) * rx + Math.cos(lon) * ry;
  const n = -Math.sin(lat) * Math.cos(lon) * rx - Math.sin(lat) * Math.sin(lon) * ry + Math.cos(lat) * rz;
  const u = Math.cos(lat) * Math.cos(lon) * rx + Math.cos(lat) * Math.sin(lon) * ry + Math.sin(lat) * rz;
  const rangeKm = Math.hypot(rx, ry, rz);
  const azimuthDeg = (Math.atan2(e, n) / DEG + 360) % 360;
  const elevationDeg = Math.asin(Math.max(-1, Math.min(1, u / Math.max(1e-6, rangeKm)))) / DEG;
  return { elevationDeg, azimuthDeg, rangeKm };
}

export function sunPosition(timeMs) {
  const n = julian(timeMs) - 2451545.0;
  const l = (280.46 + 0.9856474 * n) * DEG;
  const g = (357.528 + 0.9856003 * n) * DEG;
  const lambda = l + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.0000004 * n) * DEG;
  const r = (1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g)) * AU_KM;
  return [r * Math.cos(lambda), r * Math.cos(eps) * Math.sin(lambda), r * Math.sin(eps) * Math.sin(lambda)];
}

export function subSolar(timeMs) {
  const [x, y, z] = sunPosition(timeMs);
  return subPoint(temeToEcef(x, y, z, timeMs));
}

export function nightPolygon(timeMs) {
  const { lat: sLat, lon: sLon } = subSolar(timeMs);
  const dec = (Math.abs(sLat) < 0.1 ? 0.1 : sLat) * DEG;
  const pts = [];
  for (let lon = -180; lon <= 180; lon += 2) {
    const h = (lon - sLon) * DEG;
    const lat = Math.atan(-Math.cos(h) / Math.tan(dec)) / DEG;
    pts.push([lon, lat]);
  }
  const darkPole = sLat > 0 ? -85 : 85;
  pts.push([180, darkPole], [-180, darkPole]);
  return pts;
}

// ── Planets, Moon, Stars & Constellations ────────────────────────────────────

function centuries(timeMs) {
  return (julian(timeMs) - 2451545.0) / 36525.0;
}

function obliquity(t) {
  return (23.439291 - 0.0130042 * t) * DEG;
}

function precession(t) {
  return 1.396971 * t * DEG;
}

function eclipticToEquatorial(lon, lat, r, t) {
  const e = obliquity(t);
  const x = r * Math.cos(lat) * Math.cos(lon);
  const y = r * Math.cos(lat) * Math.sin(lon);
  const z = r * Math.sin(lat);
  return [x, y * Math.cos(e) - z * Math.sin(e), y * Math.sin(e) + z * Math.cos(e)];
}

function orbitPos(d, t) {
  const a = d[0] + d[6] * t;
  const e = d[1] + d[7] * t;
  const i = (d[2] + d[8] * t) * DEG;
  const l = d[3] + d[9] * t;
  const peri = d[4] + d[10] * t;
  const node = (d[5] + d[11] * t) * DEG;
  const w = peri * DEG - node;
  let m = (((l - peri) % 360) * DEG);
  if (m > Math.PI) m -= TWO_PI;
  if (m < -Math.PI) m += TWO_PI;
  let ecc = m + e * Math.sin(m);
  for (let k = 0; k < 8; k++) {
    ecc -= (ecc - e * Math.sin(ecc) - m) / (1 - e * Math.cos(ecc));
  }
  const xp = a * (Math.cos(ecc) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(ecc);
  const cw = Math.cos(w), sw = Math.sin(w), cn = Math.cos(node), sn = Math.sin(node), ci = Math.cos(i), si = Math.sin(i);
  const x = (cw * cn - sw * sn * ci) * xp + (-sw * cn - cw * sn * ci) * yp;
  const y = (cw * sn + sw * cn * ci) * xp + (-sw * sn + cw * cn * ci) * yp;
  const z = sw * si * xp + cw * si * yp;
  return [x, y, z];
}

const EARTH_ORBIT = [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0, 0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0];

export const PLANETS = [
  { id: 'MERCURY', french: 'Mercure', color: '#b8b8c8', mag: 0.0, data: [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593, 0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081] },
  { id: 'VENUS', french: 'Vénus', color: '#fff6d5', mag: -4.2, data: [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255, 0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418] },
  { id: 'MARS', french: 'Mars', color: '#ff7a59', mag: 0.7, data: [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891, 0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343] },
  { id: 'JUPITER', french: 'Jupiter', color: '#f3d9a4', mag: -2.3, data: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909, -0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106] },
  { id: 'SATURN', french: 'Saturne', color: '#e8c872', mag: 0.6, data: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448, -0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794] },
];

export function moonVector(timeMs) {
  const t = centuries(timeMs);
  const s = (a, b) => Math.sin((a + b * t) * DEG);
  const c = (a, b) => Math.cos((a + b * t) * DEG);
  const lon =
    218.32 +
    481267.881 * t +
    6.29 * s(135.0, 477198.87) -
    1.27 * s(259.3, -413335.36) +
    0.66 * s(235.7, 890534.22) +
    0.21 * s(269.9, 954397.74) -
    0.19 * s(357.5, 35999.05) -
    0.11 * s(186.5, 966404.03);
  const lat = 5.13 * s(93.3, 483202.02) + 0.28 * s(228.2, 960400.89) - 0.28 * s(318.3, 6003.15) - 0.17 * s(217.6, -407332.21);
  const parallax = 0.9508 + 0.0518 * c(135.0, 477198.87) + 0.0095 * c(259.3, -413335.36) + 0.0078 * c(235.7, 890534.22) + 0.0028 * c(269.9, 954397.74);
  const r = 6378.14 / Math.sin(parallax * DEG);
  return eclipticToEquatorial(lon * DEG, lat * DEG, r, t);
}

export function moonPhase(timeMs) {
  const m = moonVector(timeMs);
  const s = sunPosition(timeMs);
  const ml = Math.hypot(m[0], m[1], m[2]);
  const sl = Math.hypot(s[0], s[1], s[2]);
  const cosElong = (m[0] * s[0] + m[1] * s[1] + m[2] * s[2]) / (ml * sl);
  const raM = (Math.atan2(m[1], m[0]) / DEG + 360) % 360;
  const raS = (Math.atan2(s[1], s[0]) / DEG + 360) % 360;
  const waxing = ((raM - raS + 360) % 360) < 180;
  const lit = (1 - cosElong) / 2;
  let name;
  if (lit < 0.03) name = 'nouvelle lune';
  else if (lit > 0.97) name = 'pleine lune';
  else if (Math.abs(lit - 0.5) < 0.06) name = waxing ? 'premier quartier' : 'dernier quartier';
  else if (lit < 0.5) name = waxing ? 'premier croissant' : 'dernier croissant';
  else name = waxing ? 'gibbeuse croissante' : 'gibbeuse décroissante';
  return { lit, waxing, name };
}

export function solarSystemObjects(observer, timeMs) {
  const t = centuries(timeMs);
  const [ex, ey, ez] = orbitPos(EARTH_ORBIT, t);
  const sun = sunPosition(timeMs);
  const moon = moonVector(timeMs);
  const out = [
    {
      id: 'sun',
      kind: 'SUN',
      name: 'Soleil',
      color: '#ffd54f',
      mag: -26.7,
      look: lookAt(observer, temeToEcef(sun[0], sun[1], sun[2], timeMs)),
      distanceKm: Math.hypot(sun[0], sun[1], sun[2]),
    },
    {
      id: 'moon',
      kind: 'MOON',
      name: 'Lune',
      color: '#e2e8f0',
      mag: -10.0,
      look: lookAt(observer, temeToEcef(moon[0], moon[1], moon[2], timeMs)),
      distanceKm: Math.hypot(moon[0], moon[1], moon[2]),
    },
  ];
  for (const p of PLANETS) {
    const [px, py, pz] = orbitPos(p.data, t);
    const gx = px - ex, gy = py - ey, gz = pz - ez;
    const r = Math.hypot(gx, gy, gz);
    const lon = Math.atan2(gy, gx) + precession(t);
    const lat = Math.asin(gz / r);
    const eq = eclipticToEquatorial(lon, lat, r * AU_KM, t);
    out.push({
      id: `pl:${p.id}`,
      kind: 'PLANET',
      name: p.french,
      color: p.color,
      mag: p.mag,
      look: lookAt(observer, temeToEcef(eq[0], eq[1], eq[2], timeMs)),
      distanceKm: r * AU_KM,
    });
  }
  return out;
}

const STAR_NAMES = {
  'Alp CMa': 'Sirius', 'Alp Car': 'Canopus', 'Alp Boo': 'Arcturus', 'Alp Lyr': 'Véga', 'Alp Aur': 'Capella',
  'Bet Ori': 'Rigel', 'Alp CMi': 'Procyon', 'Alp Ori': 'Bételgeuse', 'Alp Aql': 'Altaïr', 'Alp Tau': 'Aldébaran',
  'Alp Sco': 'Antarès', 'Alp Vir': 'Spica', 'Bet Gem': 'Pollux', 'Alp PsA': 'Fomalhaut', 'Alp Cyg': 'Deneb',
  'Alp Leo': 'Régulus', 'Alp Gem': 'Castor', 'Gam Ori': 'Bellatrix', 'Alp UMi': 'Étoile polaire', 'Alp UMa': 'Dubhe',
  'Eta UMa': 'Alkaïd', 'Alp Cas': 'Schedar', 'Alp Per': 'Mirfak', 'Alp And': 'Alphératz', 'Alp Peg': 'Markab',
};

export const CONSTELLATION_FIGURES = [
  ['Eta UMa', 'Zet UMa', 'Eps UMa', 'Del UMa', 'Gam UMa', 'Bet UMa', 'Alp UMa', 'Del UMa'],
  ['Alp UMi', 'Del UMi', 'Eps UMi', 'Zet UMi', 'Bet UMi', 'Gam UMi', 'Eta UMi', 'Zet UMi'],
  ['Eps Cas', 'Del Cas', 'Gam Cas', 'Alp Cas', 'Bet Cas'],
  ['Alp Ori', 'Gam Ori'], ['Gam Ori', 'Del Ori', 'Eps Ori', 'Zet Ori', 'Alp Ori'], ['Del Ori', 'Bet Ori'], ['Zet Ori', 'Kap Ori'],
  ['Alp Cyg', 'Gam Cyg', 'Eta Cyg', 'Bet Cyg'], ['Del Cyg', 'Gam Cyg', 'Eps Cyg'],
  ['Alp Lyr', 'Zet Lyr', 'Bet Lyr', 'Gam Lyr', 'Del Lyr', 'Zet Lyr'],
  ['Alp Leo', 'Eta Leo', 'Gam Leo', 'Zet Leo', 'Mu Leo', 'Eps Leo'], ['Gam Leo', 'Del Leo', 'Bet Leo', 'The Leo', 'Alp Leo'],
  ['Alp Peg', 'Bet Peg', 'Alp And', 'Gam Peg', 'Alp Peg'],
];

let cachedStars = null;
export async function loadStars() {
  if (cachedStars) return cachedStars;
  const res = await fetch('./assets/sky/stars.tsv');
  const tsv = await res.text();
  const bayerRe = /([A-Z][a-z]{1,2})\s*\d?\s*([A-Z][A-Za-z]{2})$/;
  cachedStars = tsv
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const f = l.split('\t');
      if (f.length < 5) return null;
      const des = f[4].trim();
      const m = bayerRe.exec(des);
      const bayer = m ? `${m[1]} ${m[2]}` : des.replace(/^\d+/, '').trim();
      return {
        hr: parseInt(f[0], 10),
        ra: parseFloat(f[1]),
        dec: parseFloat(f[2]),
        mag: parseFloat(f[3]),
        designation: des,
        bayer,
        name: STAR_NAMES[bayer] || null,
      };
    })
    .filter(Boolean);
  return cachedStars;
}

export function projectStars(stars, observer, timeMs, maxMag = 4.5) {
  const t = centuries(timeMs);
  const e0 = obliquity(0);
  const ce0 = Math.cos(e0), se0 = Math.sin(e0);
  const prec = precession(t);
  const out = [];
  for (const s of stars) {
    if (s.mag > maxMag && !CONSTELLATION_FIGURES.some((fig) => fig.includes(s.bayer))) continue;
    const ra = s.ra * DEG, dec = s.dec * DEG;
    const x = Math.cos(dec) * Math.cos(ra);
    const y = Math.cos(dec) * Math.sin(ra);
    const z = Math.sin(dec);
    const ye = y * ce0 + z * se0;
    const ze = -y * se0 + z * ce0;
    const lon = Math.atan2(ye, x) + prec;
    const lat = Math.asin(Math.max(-1, Math.min(1, ze)));
    const eq = eclipticToEquatorial(lon, lat, 1e9, t);
    const look = lookAt(observer, temeToEcef(eq[0], eq[1], eq[2], timeMs));
    if (look.elevationDeg > 0) {
      out.push({ ...s, look });
    }
  }
  return out;
}

// ── Simple Orbital Propagator for ISS & Tiangong & Satellites ────────────────

export const DEFAULT_SATELLITES = [
  {
    name: 'ISS (ZARYA)',
    norad: 25544,
    incDeg: 51.64,
    raanDeg: 145.2,
    meanMotionRevDay: 15.5,
    altKm: 418,
    phase0: 0.4,
    color: '#ffd54f',
  },
  {
    name: 'CSS (TIANGONG)',
    norad: 48274,
    incDeg: 41.47,
    raanDeg: 210.8,
    meanMotionRevDay: 15.6,
    altKm: 392,
    phase0: 2.1,
    color: '#7fd8ff',
  },
  {
    name: 'HUBBLE (HST)',
    norad: 20580,
    incDeg: 28.47,
    raanDeg: 85.0,
    meanMotionRevDay: 15.09,
    altKm: 535,
    phase0: 1.2,
    color: '#a5f3fc',
  },
];

export function satelliteStateAt(sat, timeMs) {
  const r = 6371 + (sat.altKm || 415);
  const inc = sat.incDeg * DEG;
  const dtDays = (timeMs - Date.UTC(2026, 8, 29, 0, 0, 0)) / 86400000;
  const raan = (sat.raanDeg - 4.95 * dtDays) * DEG;
  const u = sat.phase0 + dtDays * sat.meanMotionRevDay * TWO_PI;
  const xOrb = r * Math.cos(u);
  const yOrb = r * Math.sin(u);
  const x = xOrb * Math.cos(raan) - yOrb * Math.cos(inc) * Math.sin(raan);
  const y = xOrb * Math.sin(raan) + yOrb * Math.cos(inc) * Math.cos(raan);
  const z = yOrb * Math.sin(inc);
  const ecef = temeToEcef(x, y, z, timeMs);
  const sub = subPoint(ecef);
  return { x, y, z, ecef, ...sub };
}

export function satelliteTrack(sat, timeMs, minutes = 92) {
  const segs = [];
  let cur = [];
  let lastLon = null;
  for (let m = -15; m <= minutes; m += 1) {
    const st = satelliteStateAt(sat, timeMs + m * 60000);
    if (lastLon !== null && Math.abs(st.lon - lastLon) > 180) {
      segs.push(cur);
      cur = [];
    }
    cur.push([st.lat, st.lon]);
    lastLon = st.lon;
  }
  if (cur.length > 1) segs.push(cur);
  return segs;
}

const EARTH_MU_KM3_S2 = 398600.4418;
const EARTH_RADIUS_KM = 6371.0;
const EARTH_J2 = 1.08262668e-3;

export function parseTleCatalog(text, category = 'other') {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const entries = [];
  for (let i = 0; i < lines.length - 2; i++) {
    if (!lines[i + 1].startsWith('1 ') || !lines[i + 2].startsWith('2 ')) continue;
    const name = lines[i].replace(/^0\s+/, '').trim();
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];
    try {
      const norad = Number(line1.slice(2, 7).trim());
      const epochYearShort = Number(line1.slice(18, 20));
      const epochDay = Number(line1.slice(20, 32));
      const year = epochYearShort < 57 ? 2000 + epochYearShort : 1900 + epochYearShort;
      const epoch = Date.UTC(year, 0, 1) + (epochDay - 1) * 86400000;
      const incDeg = Number(line2.slice(8, 16));
      const raanDeg = Number(line2.slice(17, 25));
      const eccentricity = Number(`0.${line2.slice(26, 33).trim()}`);
      const argumentPerigeeDeg = Number(line2.slice(34, 42));
      const meanAnomalyDeg = Number(line2.slice(43, 51));
      const meanMotionRevDay = Number(line2.slice(52, 63));
      if (![norad, epoch, incDeg, raanDeg, eccentricity, argumentPerigeeDeg, meanAnomalyDeg, meanMotionRevDay].every(Number.isFinite) || meanMotionRevDay <= 0 || eccentricity >= 1) continue;
      const meanMotionRadSec = meanMotionRevDay * TWO_PI / 86400;
      const semiMajorKm = Math.cbrt(EARTH_MU_KM3_S2 / (meanMotionRadSec * meanMotionRadSec));
      const apogeeKm = semiMajorKm * (1 + eccentricity) - EARTH_RADIUS_KM;
      const perigeeKm = semiMajorKm * (1 - eccentricity) - EARTH_RADIUS_KM;
      const upper = name.toUpperCase();
      const color = category === 'military' ? '#ff5252' : category === 'navigation' ? '#448aff' : category === 'comms' ? '#00e676' : category === 'earth_obs' ? '#90ee90' : category === 'science' ? '#ffd700' : '#7fd8ff';
      entries.push({
        name,
        norad,
        incDeg,
        raanDeg,
        eccentricity,
        argumentPerigeeDeg,
        meanAnomalyDeg,
        meanMotionRevDay,
        epoch,
        semiMajorKm,
        altKm: (apogeeKm + perigeeKm) / 2,
        apogeeAltKm: apogeeKm,
        perigeeAltKm: perigeeKm,
        mission: category === 'comms' ? 'Communications' : category === 'navigation' ? 'Navigation' : category === 'earth_obs' ? 'Observation de la Terre' : category === 'military' ? 'Militaire' : category === 'science' ? 'Science spatiale' : upper.includes('DEB') ? 'Débris' : 'Satellite actif',
        category,
        color,
        tle: { line1, line2 },
        tleEpoch: epoch,
        source: 'CelesTrak TLE · propagation Kepler/J2',
      });
    } catch {
      // Ignore malformed records but continue parsing the rest of the catalogue.
    }
    i += 2;
  }
  return entries;
}

export function tleStateAt(satellite, timeMs) {
  const tle = satellite?.tle;
  if (!tle) return satelliteStateAt(satellite, timeMs);
  const dt = (timeMs - satellite.epoch) / 1000;
  const inc = satellite.incDeg * DEG;
  const raan0 = satellite.raanDeg * DEG;
  const arg0 = satellite.argumentPerigeeDeg * DEG;
  const e = satellite.eccentricity;
  const a = satellite.semiMajorKm;
  const meanMotion = satellite.meanMotionRevDay * TWO_PI / 86400;
  const p = a * (1 - e * e);
  const raanRate = -1.5 * EARTH_J2 * (EARTH_RADIUS_KM / p) ** 2 * meanMotion * Math.cos(inc);
  const argRate = 0.75 * EARTH_J2 * (EARTH_RADIUS_KM / p) ** 2 * meanMotion * (5 * Math.cos(inc) ** 2 - 1);
  const raan = raan0 + raanRate * dt;
  const arg = arg0 + argRate * dt;
  const mean = satellite.meanAnomalyDeg * DEG + meanMotion * dt;
  let eccentricAnomaly = mean;
  for (let k = 0; k < 10; k++) eccentricAnomaly -= (eccentricAnomaly - e * Math.sin(eccentricAnomaly) - mean) / (1 - e * Math.cos(eccentricAnomaly));
  const xOrb = a * (Math.cos(eccentricAnomaly) - e);
  const yOrb = a * Math.sqrt(1 - e * e) * Math.sin(eccentricAnomaly);
  const co = Math.cos(arg), so = Math.sin(arg), cn = Math.cos(raan), sn = Math.sin(raan), ci = Math.cos(inc), si = Math.sin(inc);
  const x = (co * cn - so * sn * ci) * xOrb + (-so * cn - co * sn * ci) * yOrb;
  const y = (co * sn + so * cn * ci) * xOrb + (-so * sn + co * cn * ci) * yOrb;
  const z = so * si * xOrb + co * si * yOrb;
  const ecef = temeToEcef(x, y, z, timeMs);
  const sub = subPoint(ecef);
  return { x, y, z, ecef, ...sub };
}

export function tleSatelliteTrack(satellite, timeMs, minutes = 92) {
  const segments = [];
  let current = [];
  let lastLon = null;
  for (let minute = -15; minute <= minutes; minute += 1) {
    const pos = tleStateAt(satellite, timeMs + minute * 60_000);
    if (lastLon !== null && Math.abs(pos.lon - lastLon) > 180) {
      if (current.length > 1) segments.push(current);
      current = [];
    }
    current.push([pos.lat, pos.lon]);
    lastLon = pos.lon;
  }
  if (current.length > 1) segments.push(current);
  return segments;
}
