// Pure geometry helpers for the 3D globe (no WebGL, fully testable in Node).
// Convention: unit sphere, +Y = north pole, longitude 0°/latitude 0° faces +Z, east is +X.

import { latOf } from './SpaceEngine.js';

const DEG = Math.PI / 180;

export function latLonToXYZ(latDeg, lonDeg, radius = 1) {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  return [radius * Math.cos(lat) * Math.sin(lon), radius * Math.sin(lat), radius * Math.cos(lat) * Math.cos(lon)];
}

export function xyzToLatLon([x, y, z]) {
  const r = Math.hypot(x, y, z) || 1;
  return { lat: Math.asin(y / r) / DEG, lon: Math.atan2(x, z) / DEG };
}

export function normalizeLon(lon) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

export function clampLat(lat, limit = 85) {
  return Math.max(-limit, Math.min(limit, lat));
}

/** Visual altitude: compressed so that satellites stay readable next to the globe. */
export function visualRadius(altKm = 0) {
  if (!Number.isFinite(altKm) || altKm <= 0) return 1.004;
  return 1 + Math.min(0.28, 0.01 + (altKm / 6371) * 0.55);
}

/** Converts normalized Mercator rings (SpaceEngine.parseMapRings) to LineSegments positions on the sphere. */
export function ringsToSegments(rings, radius = 1.001, stride = 1) {
  const out = [];
  for (const ring of rings || []) {
    const count = ring.length / 2;
    let previous = null;
    for (let i = 0; i < count; i += Math.max(1, stride)) {
      const point = latLonToXYZ(latOf(ring[2 * i + 1]), ring[2 * i] * 360 - 180, radius);
      if (previous) out.push(...previous, ...point);
      previous = point;
    }
  }
  return new Float32Array(out);
}

/** Latitude/longitude grid as LineSegments positions. */
export function graticuleSegments(stepDeg = 30, radius = 1.0005, samples = 72) {
  const out = [];
  for (let lat = -60; lat <= 60; lat += stepDeg) {
    for (let i = 0; i < samples; i += 1) {
      out.push(...latLonToXYZ(lat, -180 + (360 * i) / samples, radius), ...latLonToXYZ(lat, -180 + (360 * (i + 1)) / samples, radius));
    }
  }
  for (let lon = -180; lon < 180; lon += stepDeg) {
    for (let i = 0; i < samples / 2; i += 1) {
      out.push(...latLonToXYZ(-90 + (180 * i) / (samples / 2), lon, radius), ...latLonToXYZ(-90 + (180 * (i + 1)) / (samples / 2), lon, radius));
    }
  }
  return new Float32Array(out);
}

/** Polyline on the sphere (waypoints are [lat, lon]); a great-circle bulge is added for long hops. */
export function routePositions(waypoints, radius = 1.006, bulge = 0) {
  const points = (waypoints || []).filter((point) => Number.isFinite(point?.[0]) && Number.isFinite(point?.[1]));
  const out = [];
  points.forEach(([lat, lon], index) => {
    const t = points.length > 1 ? index / (points.length - 1) : 0;
    out.push(...latLonToXYZ(lat, lon, radius + bulge * Math.sin(Math.PI * t)));
  });
  return new Float32Array(out);
}

/** A point on the visible hemisphere faces the camera. */
export function isFacingCamera(pointXYZ, cameraXYZ) {
  const [px, py, pz] = pointXYZ;
  const pr = Math.hypot(px, py, pz) || 1;
  const [cx, cy, cz] = cameraXYZ;
  // Horizon test on the unit sphere: with u = p/|p|, the point is visible when u·c > 1 (i.e. cos θ > 1/|c|).
  return (px * cx + py * cy + pz * cz) / pr > 1;
}

/** Nearest screen-space candidate within maxPx. `project(xyz)` must return {x, y, visible}. */
export function pickNearest(items, project, x, y, maxPx = 14) {
  let best = null;
  let bestDistance = maxPx;
  for (const item of items) {
    const screen = project(item.xyz);
    if (!screen?.visible) continue;
    const distance = Math.hypot(screen.x - x, screen.y - y);
    if (distance <= bestDistance) {
      best = item;
      bestDistance = distance;
    }
  }
  return best;
}

/** Shortest-path interpolation of a longitude (used for smooth fly-to). */
export function approachLon(current, target, factor) {
  const delta = normalizeLon(target - current);
  return normalizeLon(current + delta * factor);
}
