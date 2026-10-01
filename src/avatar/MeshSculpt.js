// Édition manuelle des polygones du visage Classique (déplacement de sommets).
// Les retouches sont stockées comme décalages creux { indexSommet: [dx, dy, dz] } appliqués APRÈS les
// curseurs du créateur : le maillage d'origine n'est jamais modifié.
import { HeadMesh } from './HeadMesh.js';

export const SCULPT_MAX_ENTRIES = 12000;
export const SCULPT_MAX_OFFSET = 0.6;
const WELD_SCALE = 1e4; // sommets confondus à 0,0001 près = même point (coutures du maillage)

// ── Données persistées ──────────────────────────────────────────────────────

export function normalizeSculpt(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  let count = 0;
  for (const [key, value] of Object.entries(raw)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index > 500000) continue;
    if (!Array.isArray(value) || value.length < 3) continue;
    const v = [0, 1, 2].map((i) => {
      const x = Number(value[i]);
      if (!Number.isFinite(x)) return 0;
      return Math.max(-SCULPT_MAX_OFFSET, Math.min(SCULPT_MAX_OFFSET, Math.round(x * 1e4) / 1e4)) + 0;
    });
    if (!v[0] && !v[1] && !v[2]) continue;
    out[index] = v;
    if (++count >= SCULPT_MAX_ENTRIES) break;
  }
  return out;
}

export function isEmptySculpt(sculpt) {
  return Object.keys(normalizeSculpt(sculpt)).length === 0;
}

/** Empreinte courte du jeu de retouches (clé de rechargement du rendu). */
export function sculptKey(sculpt) {
  const s = normalizeSculpt(sculpt);
  const keys = Object.keys(s);
  if (!keys.length) return '';
  let h = 2166136261;
  for (const k of keys) {
    const text = `${k}:${s[k].join(',')};`;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return `${keys.length}:${(h >>> 0).toString(36)}`;
}

/** Nombre de sommets modifiables : tout sauf les cheveux (faces de groupe 2). */
export function sculptableVertexCount(mesh) {
  if (mesh._sculptLimit !== undefined) return mesh._sculptLimit;
  let limit = Infinity;
  if (mesh.faceGroup) {
    for (let f = 0; f < mesh.faceCount; f++) {
      if (mesh.faceGroup[f] > 1.5) {
        limit = Math.min(limit, mesh.faces[3 * f], mesh.faces[3 * f + 1], mesh.faces[3 * f + 2]);
      }
    }
  }
  if (!Number.isFinite(limit)) limit = Math.min(mesh.nHead || mesh.vertexCount, mesh.vertexCount);
  mesh._sculptLimit = limit;
  return limit;
}

/** Renvoie un NOUVEAU maillage avec les retouches (le maillage en entrée n'est pas modifié). */
export function applySculpt(mesh, sculpt) {
  const offsets = normalizeSculpt(sculpt);
  const keys = Object.keys(offsets);
  if (!keys.length) return mesh;
  const limit = sculptableVertexCount(mesh);
  const verts = new Float32Array(mesh.verts);
  const moved = [];
  for (const key of keys) {
    const i = Number(key);
    if (i >= limit) continue;
    verts[3 * i] += offsets[key][0];
    verts[3 * i + 1] += offsets[key][1];
    verts[3 * i + 2] += offsets[key][2];
    moved.push(i);
  }
  if (!moved.length) return mesh;
  const headVertices = Math.min(mesh.nHead || mesh.vertexCount, mesh.vertexCount);
  const normals = HeadMesh.refitHeadNormals(mesh, verts, headVertices);

  // Si le globe oculaire a été déplacé, le centre de l'iris le suit.
  const eyeCentre = new Float32Array(mesh.eyeCentre || []);
  for (let e = 0; e < (mesh.eyeFirst?.length || 0); e++) {
    const first = mesh.eyeFirst[e];
    const end = Math.min(first + mesh.eyeCount[e], limit);
    if (end <= first) continue;
    let dx = 0; let dy = 0; let dz = 0;
    for (let i = first; i < end; i++) {
      dx += verts[3 * i] - mesh.verts[3 * i];
      dy += verts[3 * i + 1] - mesh.verts[3 * i + 1];
      dz += verts[3 * i + 2] - mesh.verts[3 * i + 2];
    }
    const n = end - first;
    eyeCentre[3 * e] += dx / n;
    eyeCentre[3 * e + 1] += dy / n;
    eyeCentre[3 * e + 2] += dz / n;
  }
  const result = new HeadMesh({ ...mesh, verts, normals, eyeCentre });
  result._sculpted = sculptKey(offsets);
  return result;
}

// ── Topologie d'édition ─────────────────────────────────────────────────────

/**
 * Topologie des sommets modifiables. Les sommets confondus (coutures) sont soudés : `rep[i]` est le sommet
 * représentant ; sélectionner/déplacer un point déplace tous ses jumeaux, sans fissure.
 */
export function buildTopology(mesh) {
  const limit = sculptableVertexCount(mesh);
  const rep = new Int32Array(limit);
  const members = new Map();
  const seen = new Map();
  for (let i = 0; i < limit; i++) {
    const key = `${Math.round(mesh.verts[3 * i] * WELD_SCALE)},${Math.round(mesh.verts[3 * i + 1] * WELD_SCALE)},${Math.round(mesh.verts[3 * i + 2] * WELD_SCALE)}`;
    let r = seen.get(key);
    if (r === undefined) { r = i; seen.set(key, i); members.set(i, [i]); } else members.get(r).push(i);
    rep[i] = r;
  }
  const tris = [];
  const nbrSets = new Map();
  for (let f = 0; f < mesh.faceCount; f++) {
    if (mesh.faceGroup && mesh.faceGroup[f] > 1.5) continue;
    const a = mesh.faces[3 * f]; const b = mesh.faces[3 * f + 1]; const c = mesh.faces[3 * f + 2];
    if (a >= limit || b >= limit || c >= limit) continue;
    tris.push(a, b, c);
    for (const [u, v] of [[rep[a], rep[b]], [rep[b], rep[c]], [rep[c], rep[a]]]) {
      if (u === v) continue;
      if (!nbrSets.has(u)) nbrSets.set(u, new Set());
      if (!nbrSets.has(v)) nbrSets.set(v, new Set());
      nbrSets.get(u).add(v);
      nbrSets.get(v).add(u);
    }
  }
  const neighbours = new Map();
  for (const [k, set] of nbrSets) neighbours.set(k, [...set]);
  return { limit, rep, members, tris: Int32Array.from(tris), neighbours, reps: [...members.keys()].filter((r) => neighbours.has(r)) };
}

export function growSelection(topo, selection) {
  const out = new Set(selection);
  for (const r of selection) for (const n of topo.neighbours.get(r) || []) out.add(n);
  return out;
}

export function shrinkSelection(topo, selection) {
  const out = new Set();
  for (const r of selection) {
    if ((topo.neighbours.get(r) || []).every((n) => selection.has(n))) out.add(r);
  }
  return out;
}

class MinHeap {
  constructor() { this.keys = []; this.vals = []; }
  get size() { return this.keys.length; }
  push(key, val) {
    const { keys, vals } = this;
    let i = keys.length;
    keys.push(key); vals.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= keys[i]) break;
      [keys[p], keys[i]] = [keys[i], keys[p]];
      [vals[p], vals[i]] = [vals[i], vals[p]];
      i = p;
    }
  }
  pop() {
    const { keys, vals } = this;
    const key = keys[0]; const val = vals[0];
    const lastK = keys.pop(); const lastV = vals.pop();
    if (keys.length) {
      keys[0] = lastK; vals[0] = lastV;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1; const r = l + 1;
        let m = i;
        if (l < keys.length && keys[l] < keys[m]) m = l;
        if (r < keys.length && keys[r] < keys[m]) m = r;
        if (m === i) break;
        [keys[m], keys[i]] = [keys[i], keys[m]];
        [vals[m], vals[i]] = [vals[i], vals[m]];
        i = m;
      }
    }
    return [key, val];
  }
}

/**
 * Influence douce autour de la sélection : distance le long de la SURFACE (arêtes du maillage), donc la paupière
 * du haut ne tire pas celle du bas à travers l'ouverture de l'œil. Renvoie Map(rep → poids 0..1).
 */
export function softWeights(topo, verts, selection, radius) {
  const weights = new Map();
  if (!(radius > 1e-6)) {
    for (const r of selection) weights.set(r, 1);
    return weights;
  }
  const dist = new Map();
  const heap = new MinHeap();
  for (const r of selection) { dist.set(r, 0); heap.push(0, r); }
  while (heap.size) {
    const [d, r] = heap.pop();
    if (d > dist.get(r)) continue;
    for (const n of topo.neighbours.get(r) || []) {
      const nd = d + Math.hypot(verts[3 * n] - verts[3 * r], verts[3 * n + 1] - verts[3 * r + 1], verts[3 * n + 2] - verts[3 * r + 2]);
      if (nd >= radius || nd >= (dist.get(n) ?? Infinity)) continue;
      dist.set(n, nd);
      heap.push(nd, n);
    }
  }
  for (const [r, d] of dist) {
    const t = d / radius;
    weights.set(r, 1 - t * t * (3 - 2 * t));
  }
  return weights;
}

/** Sommet symétrique (par rapport au plan x = cx) de chaque sommet sélectionné, quand il existe. */
export function mirrorMap(topo, verts, selection, cx, tolerance = 0.03) {
  const cell = tolerance * 2;
  const grid = new Map();
  const keyOf = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (const r of topo.reps) {
    const k = keyOf(verts[3 * r], verts[3 * r + 1], verts[3 * r + 2]);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(r);
  }
  const out = new Map();
  for (const r of selection) {
    const x = 2 * cx - verts[3 * r]; const y = verts[3 * r + 1]; const z = verts[3 * r + 2];
    let best = -1; let bestD = tolerance;
    for (let ix = -1; ix <= 1; ix++) for (let iy = -1; iy <= 1; iy++) for (let iz = -1; iz <= 1; iz++) {
      const list = grid.get(`${Math.floor(x / cell) + ix},${Math.floor(y / cell) + iy},${Math.floor(z / cell) + iz}`);
      if (!list) continue;
      for (const c of list) {
        const d = Math.hypot(verts[3 * c] - x, verts[3 * c + 1] - y, verts[3 * c + 2] - z);
        if (d < bestD) { bestD = d; best = c; }
      }
    }
    if (best >= 0) out.set(r, best);
  }
  return out;
}

// ── Décalages ───────────────────────────────────────────────────────────────

/**
 * Poids de la passe miroir : points symétriques de la sélection (hors points déjà sélectionnés), avec la même
 * influence douce. Calculé une fois au début d'un geste.
 */
export function mirrorWeights(topo, verts, selection, radius, cx) {
  const pairs = mirrorMap(topo, verts, selection, cx);
  const mirrored = new Set();
  for (const m of pairs.values()) if (!selection.has(m)) mirrored.add(m);
  return softWeights(topo, verts, mirrored, radius);
}

/**
 * Ajoute `delta * poids` aux sommets (et à leurs jumeaux). `mirror` (optionnel) = poids de la passe miroir :
 * ces sommets reçoivent le déplacement inversé en x. Renvoie de nouveaux décalages.
 */
export function addDelta(offsets, topo, weights, delta, mirror = null) {
  const next = { ...offsets };
  const push = (r, dx, dy, dz, w) => {
    for (const i of topo.members.get(r) || []) {
      const cur = next[i] || [0, 0, 0];
      next[i] = [cur[0] + dx * w, cur[1] + dy * w, cur[2] + dz * w];
    }
  };
  for (const [r, w] of weights) push(r, delta[0], delta[1], delta[2], w);
  if (mirror) for (const [r, w] of mirror) push(r, -delta[0], delta[1], delta[2], w);
  return next;
}

/** Remet à zéro les décalages des sommets donnés. */
export function clearOffsets(offsets, topo, reps) {
  const next = { ...offsets };
  for (const r of reps) for (const i of topo.members.get(r) || []) delete next[i];
  return next;
}

/** Lissage laplacien : rapproche chaque sommet de la moyenne de ses voisins (efface plis et marches). */
export function smoothOffsets(offsets, topo, baseVerts, weights, strength = 0.5) {
  const cur = (r) => {
    const o = offsets[r] || [0, 0, 0];
    return [baseVerts[3 * r] + o[0], baseVerts[3 * r + 1] + o[1], baseVerts[3 * r + 2] + o[2]];
  };
  const deltas = new Map();
  for (const [r, w] of weights) {
    const nb = topo.neighbours.get(r);
    if (!nb || !nb.length) continue;
    const p = cur(r);
    let ax = 0; let ay = 0; let az = 0;
    for (const n of nb) { const q = cur(n); ax += q[0]; ay += q[1]; az += q[2]; }
    ax /= nb.length; ay /= nb.length; az /= nb.length;
    const k = strength * w;
    deltas.set(r, [(ax - p[0]) * k, (ay - p[1]) * k, (az - p[2]) * k]);
  }
  const next = { ...offsets };
  for (const [r, d] of deltas) {
    for (const i of topo.members.get(r) || []) {
      const c = next[i] || [0, 0, 0];
      next[i] = [c[0] + d[0], c[1] + d[1], c[2] + d[2]];
    }
  }
  return next;
}

/** Positions affichées = base + décalages. */
export function displayVerts(baseVerts, offsets, limit) {
  const out = new Float32Array(baseVerts);
  for (const key of Object.keys(offsets)) {
    const i = Number(key);
    if (i >= limit) continue;
    out[3 * i] += offsets[key][0];
    out[3 * i + 1] += offsets[key][1];
    out[3 * i + 2] += offsets[key][2];
  }
  return out;
}

// ── Caméra orthographique et sélection à l'écran ────────────────────────────

export function makeCamera({ yaw = 0, pitch = 0, zoom = 1, panX = 0, panY = 0, width = 600, height = 600, centre = [0, -0.1, 0], extent = 1.45 } = {}) {
  const cy = Math.cos(yaw); const sy = Math.sin(yaw); const cp = Math.cos(pitch); const sp = Math.sin(pitch);
  return {
    yaw, pitch, zoom, panX, panY, width, height, centre, extent,
    r0: [cy, 0, sy],
    r1: [sp * sy, cp, -sp * cy],
    r2: [-cp * sy, sp, cp * cy],
    scale: (zoom * Math.min(width, height)) / (2 * extent),
  };
}

export function projectPoint(cam, x, y, z, out = [0, 0, 0]) {
  const px = x - cam.centre[0]; const py = y - cam.centre[1]; const pz = z - cam.centre[2];
  out[0] = cam.width / 2 + cam.panX + (cam.r0[0] * px + cam.r0[1] * py + cam.r0[2] * pz) * cam.scale;
  out[1] = cam.height / 2 + cam.panY - (cam.r1[0] * px + cam.r1[1] * py + cam.r1[2] * pz) * cam.scale;
  out[2] = cam.r2[0] * px + cam.r2[1] * py + cam.r2[2] * pz;
  return out;
}

export function projectAll(cam, verts, count) {
  const out = new Float32Array(3 * count);
  const tmp = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    projectPoint(cam, verts[3 * i], verts[3 * i + 1], verts[3 * i + 2], tmp);
    out[3 * i] = tmp[0]; out[3 * i + 1] = tmp[1]; out[3 * i + 2] = tmp[2];
  }
  return out;
}

/** Déplacement écran (pixels) → déplacement dans l'espace de l'objet (plan de la vue). */
export function screenDeltaToWorld(cam, dxPx, dyPx) {
  const dx = dxPx / cam.scale; const dy = -dyPx / cam.scale;
  return [cam.r0[0] * dx + cam.r1[0] * dy, cam.r0[1] * dx + cam.r1[1] * dy, cam.r0[2] * dx + cam.r1[2] * dy];
}

/** Direction (objet) qui pointe vers la caméra. */
export function viewForward(cam) {
  return [cam.r2[0], cam.r2[1], cam.r2[2]];
}

/**
 * Faces tournées vers la caméra + tampon de profondeur à demi-résolution (pour ne sélectionner que le visible).
 * `faceNormalSign` : orientation de référence de chaque face (somme des normales de sommets d'origine).
 */
export function buildScene(cam, verts, topo, refNormals) {
  const proj = projectAll(cam, verts, topo.limit);
  const tris = topo.tris;
  const nTri = tris.length / 3;
  const front = new Uint8Array(nTri);
  const shade = new Float32Array(nTri);
  const depth = new Float32Array(nTri);
  const lx = -0.35; const ly = 0.45; const lz = 0.82; // lumière dans l'espace caméra
  for (let t = 0; t < nTri; t++) {
    const a = tris[3 * t]; const b = tris[3 * t + 1]; const c = tris[3 * t + 2];
    const abx = verts[3 * b] - verts[3 * a]; const aby = verts[3 * b + 1] - verts[3 * a + 1]; const abz = verts[3 * b + 2] - verts[3 * a + 2];
    const acx = verts[3 * c] - verts[3 * a]; const acy = verts[3 * c + 1] - verts[3 * a + 1]; const acz = verts[3 * c + 2] - verts[3 * a + 2];
    let nx = aby * acz - abz * acy; let ny = abz * acx - abx * acz; let nz = abx * acy - aby * acx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    const rx = refNormals[3 * a] + refNormals[3 * b] + refNormals[3 * c];
    const ry = refNormals[3 * a + 1] + refNormals[3 * b + 1] + refNormals[3 * c + 1];
    const rz = refNormals[3 * a + 2] + refNormals[3 * b + 2] + refNormals[3 * c + 2];
    if (nx * rx + ny * ry + nz * rz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const cz = cam.r2[0] * nx + cam.r2[1] * ny + cam.r2[2] * nz;
    const cxn = cam.r0[0] * nx + cam.r0[1] * ny + cam.r0[2] * nz;
    const cyn = cam.r1[0] * nx + cam.r1[1] * ny + cam.r1[2] * nz;
    front[t] = cz > 0.02 ? 1 : 0;
    shade[t] = Math.max(0, cxn * lx + cyn * ly + cz * lz);
    depth[t] = (proj[3 * a + 2] + proj[3 * b + 2] + proj[3 * c + 2]) / 3;
  }
  // Tampon de profondeur (demi-résolution)
  const dw = Math.max(1, Math.ceil(cam.width / 2)); const dh = Math.max(1, Math.ceil(cam.height / 2));
  const zbuf = new Float32Array(dw * dh).fill(-Infinity);
  for (let t = 0; t < nTri; t++) {
    if (!front[t]) continue;
    const a = tris[3 * t]; const b = tris[3 * t + 1]; const c = tris[3 * t + 2];
    const x0 = proj[3 * a] / 2; const y0 = proj[3 * a + 1] / 2; const z0 = proj[3 * a + 2];
    const x1 = proj[3 * b] / 2; const y1 = proj[3 * b + 1] / 2; const z1 = proj[3 * b + 2];
    const x2 = proj[3 * c] / 2; const y2 = proj[3 * c + 1] / 2; const z2 = proj[3 * c + 2];
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))); const maxX = Math.min(dw - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))); const maxY = Math.min(dh - 1, Math.ceil(Math.max(y0, y1, y2)));
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-6) continue;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5; const py = y + 0.5;
        const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area;
        const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue;
        const z = w0 * z0 + w1 * z1 + w2 * z2;
        const idx = y * dw + x;
        if (z > zbuf[idx]) zbuf[idx] = z;
      }
    }
  }
  return { cam, proj, front, shade, depth, zbuf, dw, dh, tris };
}

export const VISIBILITY_EPS = 0.014;

export function isVertexVisible(scene, i) {
  const x = Math.floor(scene.proj[3 * i] / 2); const y = Math.floor(scene.proj[3 * i + 1] / 2);
  if (x < 0 || y < 0 || x >= scene.dw || y >= scene.dh) return false;
  let best = -Infinity;
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const xx = x + ox; const yy = y + oy;
    if (xx < 0 || yy < 0 || xx >= scene.dw || yy >= scene.dh) continue;
    best = Math.max(best, scene.zbuf[yy * scene.dw + xx]);
  }
  return scene.proj[3 * i + 2] >= best - VISIBILITY_EPS;
}

/** Représentants visibles (point choisi par son représentant). */
export function visibleReps(scene, topo) {
  const out = [];
  for (const r of topo.reps) if (isVertexVisible(scene, r)) out.push(r);
  return out;
}

export function pickVertex(scene, topo, px, py, radiusPx = 10) {
  let best = -1; let bestScore = Infinity;
  for (const r of topo.reps) {
    const dx = scene.proj[3 * r] - px; const dy = scene.proj[3 * r + 1] - py;
    const d2 = dx * dx + dy * dy;
    if (d2 > radiusPx * radiusPx) continue;
    if (!isVertexVisible(scene, r)) continue;
    // plus proche du curseur ; à égalité de pixel, le plus proche de la caméra
    const score = d2 - scene.proj[3 * r + 2] * 4;
    if (score < bestScore) { bestScore = score; best = r; }
  }
  return best;
}

export function pickTriangle(scene, px, py) {
  const { tris, proj, front, depth } = scene;
  let best = -1; let bestDepth = -Infinity;
  for (let t = 0; t < tris.length / 3; t++) {
    if (!front[t]) continue;
    const a = tris[3 * t]; const b = tris[3 * t + 1]; const c = tris[3 * t + 2];
    const x0 = proj[3 * a]; const y0 = proj[3 * a + 1]; const x1 = proj[3 * b]; const y1 = proj[3 * b + 1]; const x2 = proj[3 * c]; const y2 = proj[3 * c + 1];
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-9) continue;
    const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area;
    const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area;
    const w2 = 1 - w0 - w1;
    if (w0 < 0 || w1 < 0 || w2 < 0) continue;
    if (depth[t] > bestDepth) { bestDepth = depth[t]; best = t; }
  }
  return best;
}

export function trianglePoints(topo, t) {
  return [topo.rep[topo.tris[3 * t]], topo.rep[topo.tris[3 * t + 1]], topo.rep[topo.tris[3 * t + 2]]];
}

export function boxSelect(scene, topo, x0, y0, x1, y1) {
  const minX = Math.min(x0, x1); const maxX = Math.max(x0, x1); const minY = Math.min(y0, y1); const maxY = Math.max(y0, y1);
  const out = [];
  for (const r of topo.reps) {
    const x = scene.proj[3 * r]; const y = scene.proj[3 * r + 1];
    if (x >= minX && x <= maxX && y >= minY && y <= maxY && isVertexVisible(scene, r)) out.push(r);
  }
  return out;
}

/**
 * Paupières d'un œil : sommets du bord palpébral (eyelidRim) + `rings` anneaux de voisins.
 * side = 'left' / 'right' tels qu'on les voit à l'écran (x croissant vers la droite).
 */
export function selectEyelids(mesh, topo, side = 'left', rings = 2) {
  const out = new Set();
  const rim = mesh.eyelidRim;
  const centres = mesh.eyeCentre;
  if (!rim || !centres || centres.length < 6) return out;
  const xs = [];
  for (let e = 0; e < centres.length / 3; e++) xs.push(centres[3 * e]);
  const target = side === 'left' ? Math.min(...xs) : Math.max(...xs);
  for (let k = 0; k < rim.length; k += 3) {
    for (const vi of [rim[k], rim[k + 1]]) {
      if (vi >= topo.limit) continue;
      const x = mesh.verts[3 * vi];
      let best = xs[0];
      for (const cx of xs) if (Math.abs(cx - x) < Math.abs(best - x)) best = cx;
      if (best === target) out.add(topo.rep[vi]);
    }
  }
  let selection = out;
  for (let i = 0; i < rings; i++) selection = growSelection(topo, selection);
  return selection;
}
