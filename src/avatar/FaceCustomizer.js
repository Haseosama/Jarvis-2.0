// Character-creator style face customization for the Classic avatar.
//
// Each parameter is a slider in [-1, 1] (0 = original Classic face). The sliders are turned into one smooth
// displacement field applied to every vertex of the head mesh (skin, eyeballs, mouth interior and baked hair),
// so eyelids, lips, brows and hairstyles keep following the face. Eye and lip pivots used by the animation
// (eyeCentre / lipCentre) are moved with the field, and colours/paint are never touched.

import { HeadMesh } from './HeadMesh.js';

export const FACE_GROUPS = [
  { id: 'face', label: 'Visage', icon: '🧑' },
  { id: 'eyes', label: 'Yeux', icon: '👁️' },
  { id: 'nose', label: 'Nez', icon: '👃' },
  { id: 'mouth', label: 'Bouche', icon: '👄' },
];

export const FACE_PARAMS = [
  { id: 'faceWidth', group: 'face', label: 'Largeur du visage', low: 'Étroit', high: 'Large' },
  { id: 'faceLength', group: 'face', label: 'Hauteur du visage', low: 'Court', high: 'Allongé' },
  { id: 'foreheadHeight', group: 'face', label: 'Front', low: 'Bas', high: 'Haut' },
  { id: 'browRidge', group: 'face', label: 'Arcades sourcilières', low: 'Lisses', high: 'Marquées' },
  { id: 'browHeight', group: 'face', label: 'Hauteur des sourcils', low: 'Bas', high: 'Haut' },
  { id: 'cheeks', group: 'face', label: 'Joues', low: 'Creuses', high: 'Pleines' },
  { id: 'cheekbones', group: 'face', label: 'Pommettes', low: 'Discrètes', high: 'Saillantes' },
  { id: 'jawWidth', group: 'face', label: 'Mâchoire', low: 'Fine', high: 'Carrée' },
  { id: 'chinLength', group: 'face', label: 'Longueur du menton', low: 'Court', high: 'Long' },
  { id: 'chinWidth', group: 'face', label: 'Largeur du menton', low: 'Pointu', high: 'Large' },
  { id: 'eyeSize', group: 'eyes', label: 'Taille des yeux', low: 'Petits', high: 'Grands' },
  { id: 'eyeSpacing', group: 'eyes', label: 'Écartement', low: 'Rapprochés', high: 'Écartés' },
  { id: 'eyeHeight', group: 'eyes', label: 'Position verticale', low: 'Bas', high: 'Haut' },
  { id: 'eyeTilt', group: 'eyes', label: 'Inclinaison', low: 'Tombants', high: 'Relevés' },
  { id: 'noseWidth', group: 'nose', label: 'Largeur du nez', low: 'Fin', high: 'Large' },
  { id: 'noseLength', group: 'nose', label: 'Longueur du nez', low: 'Court', high: 'Long' },
  { id: 'noseProjection', group: 'nose', label: 'Saillie du nez', low: 'Plat', high: 'Proéminent' },
  { id: 'mouthWidth', group: 'mouth', label: 'Largeur de la bouche', low: 'Étroite', high: 'Large' },
  { id: 'lipFullness', group: 'mouth', label: 'Épaisseur des lèvres', low: 'Fines', high: 'Pulpeuses' },
  { id: 'mouthHeight', group: 'mouth', label: 'Position de la bouche', low: 'Basse', high: 'Haute' },
];

export const FACE_PARAM_IDS = FACE_PARAMS.map((param) => param.id);

export const DEFAULT_FACE_CUSTOM = Object.freeze(Object.fromEntries(FACE_PARAM_IDS.map((id) => [id, 0])));

export const FACE_PRESETS = [
  { id: 'default', label: 'Classique (original)', values: {} },
  { id: 'angular', label: 'Anguleux', values: { jawWidth: 0.7, chinWidth: 0.4, cheekbones: 0.6, cheeks: -0.5, browRidge: 0.6, noseProjection: 0.2, lipFullness: -0.2 } },
  { id: 'soft', label: 'Doux', values: { faceWidth: 0.15, cheeks: 0.6, jawWidth: -0.4, chinLength: -0.3, chinWidth: -0.2, eyeSize: 0.4, lipFullness: 0.5, noseWidth: -0.3, browRidge: -0.4 } },
  { id: 'narrow', label: 'Fin et élancé', values: { faceWidth: -0.5, faceLength: 0.5, cheeks: -0.4, jawWidth: -0.4, chinWidth: -0.5, noseWidth: -0.4, noseLength: 0.3, eyeSpacing: -0.2 } },
  { id: 'round', label: 'Rond', values: { faceWidth: 0.4, faceLength: -0.4, cheeks: 0.8, jawWidth: -0.2, chinLength: -0.4, noseLength: -0.3, eyeSize: 0.3, eyeSpacing: 0.2 } },
  { id: 'expressive', label: 'Regard expressif', values: { eyeSize: 0.7, eyeTilt: 0.4, eyeHeight: 0.1, browHeight: 0.3, lipFullness: 0.2, cheekbones: 0.3 } },
];

const clamp = (value) => Math.max(-1, Math.min(1, value));

/** Keeps only known parameters, clamped to [-1, 1] and rounded to 2 decimals. */
export function normalizeFaceCustom(raw) {
  const out = { ...DEFAULT_FACE_CUSTOM };
  if (raw && typeof raw === 'object') {
    for (const id of FACE_PARAM_IDS) {
      const value = Number(raw[id]);
      if (Number.isFinite(value)) out[id] = Math.round(clamp(value) * 100) / 100;
    }
  }
  return out;
}

export function isDefaultFaceCustom(raw) {
  const values = normalizeFaceCustom(raw);
  return FACE_PARAM_IDS.every((id) => values[id] === 0);
}

export function faceCustomKey(raw) {
  const values = normalizeFaceCustom(raw);
  return FACE_PARAM_IDS.map((id) => values[id]).join(',');
}

export function presetValues(presetId) {
  const preset = FACE_PRESETS.find((entry) => entry.id === presetId);
  return normalizeFaceCustom(preset ? preset.values : {});
}

/** Reproducible random face (moderate amplitude so results stay natural). */
export function randomFaceCustom(seed = Date.now()) {
  let state = (Math.floor(seed) >>> 0) || 1;
  const rnd = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const out = {};
  for (const id of FACE_PARAM_IDS) out[id] = Math.round((rnd() * 2 - 1) * 0.65 * 100) / 100;
  return normalizeFaceCustom(out);
}

function smooth(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Displacement of one point. `eyeball` (0 or 1) marks eyeball vertices, which follow the eye features
 * rigidly (no depth fade) so that the globes always stay inside their eyelids.
 */
export function faceDisplacement(x, y, z, k, ctx, eyeball = -1) {
  const u = x - ctx.cx;
  const au = Math.abs(u);
  const side = u < 0 ? -1 : 1;
  let dx = 0;
  let dy = 0;
  let dz = 0;
  const front = (a, b) => smooth(a, b, z);

  // ── Face ────────────────────────────────────────────────────────────────
  const headBand = smooth(-1.05, -0.8, y) * (1 - smooth(0.9, 1.12, y));
  dx += u * 0.14 * k.faceWidth * headBand;

  const yRel = y - ctx.eyeY;
  const lowerFace = smooth(0.1, -0.1, yRel) * smooth(-1.25, -0.95, y);
  dy += 0.16 * k.faceLength * yRel * lowerFace;
  dy += 0.14 * k.foreheadHeight * Math.max(0, y - 0.25) * (1 - smooth(0.85, 1.1, y));

  const ridge = smooth(0.05, 0.14, y) * (1 - smooth(0.3, 0.42, y)) * front(-0.08, 0.24) * (1 - smooth(0.5, 0.8, au));
  dz += 0.06 * k.browRidge * ridge;
  const browBand = smooth(0.12, 0.2, y) * (1 - smooth(0.28, 0.36, y)) * front(0.2, 0.3) * (1 - smooth(0.55, 0.75, au));
  dy += 0.05 * k.browHeight * browBand;

  const cheekBand = smooth(-0.45, -0.2, y) * (1 - smooth(0.12, 0.35, y)) * smooth(0.1, 0.3, au) * (1 - smooth(0.6, 0.85, au)) * front(0, 0.25);
  dx += side * 0.07 * k.cheeks * cheekBand;
  dz += 0.04 * k.cheeks * cheekBand;
  const boneBand = smooth(-0.2, -0.05, y) * (1 - smooth(0.08, 0.2, y)) * smooth(0.25, 0.4, au) * (1 - smooth(0.62, 0.8, au)) * front(0, 0.25);
  dx += side * 0.05 * k.cheekbones * boneBand;
  dz += 0.05 * k.cheekbones * boneBand;

  const jawBand = smooth(-1.0, -0.8, y) * (1 - smooth(-0.5, -0.3, y)) * front(-0.2, 0.25);
  dx += u * 0.18 * k.jawWidth * jawBand;
  const chinBand = smooth(-0.6, -0.85, y) * smooth(-1.15, -0.95, y) * front(0, 0.3);
  dy += -0.12 * k.chinLength * chinBand * (1 - smooth(0.2, 0.45, au));
  dz += 0.05 * k.chinLength * chinBand * (1 - smooth(0.2, 0.45, au));
  dx += u * 0.3 * k.chinWidth * chinBand * (1 - smooth(0.4, 0.6, au));

  // ── Eyes ────────────────────────────────────────────────────────────────
  const eyeIndex = eyeball >= 0 ? eyeball : (u < 0 ? 0 : 1);
  const eye = ctx.eyes[eyeIndex] || ctx.eyes[0];
  if (eye) {
    const rx = x - eye.x;
    const ry = y - eye.y;
    const r = Math.hypot(rx, ry);
    const depth = eyeball >= 0 ? 1 : smooth(0, 0.3, z);
    const core = (eyeball >= 0 ? 1 : 1 - smooth(0.1, 0.28, r)) * depth;
    const move = (eyeball >= 0 ? 1 : 1 - smooth(0.22, 0.5, r)) * depth;
    const eyeSide = eye.x < ctx.cx ? -1 : 1;
    const scale = 0.3 * k.eyeSize * core;
    dx += rx * scale;
    dy += ry * scale;
    if (eyeball >= 0) dz += (z - eye.z) * 0.3 * k.eyeSize;
    // The nose bridge between the eyes must not be pulled by either eye (it would tear when eyes move inward).
    dx += eyeSide * 0.045 * k.eyeSpacing * move * (eyeball >= 0 ? 1 : smooth(0.02, 0.14, au));
    dy += 0.08 * k.eyeHeight * move;
    dy += 0.3 * k.eyeTilt * (rx * eyeSide) * move;
  }

  // ── Nose ────────────────────────────────────────────────────────────────
  const alar = (1 - smooth(0.16, 0.34, au)) * smooth(-0.46, -0.36, y) * (1 - smooth(-0.16, -0.04, y)) * front(0.3, 0.48);
  dx += u * 0.35 * k.noseWidth * alar;
  const noseLen = (1 - smooth(0.14, 0.3, au)) * smooth(-0.55, -0.4, y) * (1 - smooth(0, 0.15, y)) * front(0.3, 0.48);
  dy += 0.18 * k.noseLength * y * noseLen;
  const proj = (1 - smooth(0.07, 0.2, au)) * smooth(-0.45, -0.25, y) * (1 - smooth(-0.15, 0.1, y)) * front(0.3, 0.5);
  dz += 0.1 * k.noseProjection * proj;

  // ── Mouth ───────────────────────────────────────────────────────────────
  const mouthFront = front(0.25, 0.45);
  const lx = u;
  const ly = y - ctx.lipY;
  const wMouth = 1 - smooth(0.8, 1.6, Math.hypot(lx / 0.38, ly / 0.14));
  const wLips = 1 - smooth(0.7, 1.4, Math.hypot(lx / 0.26, ly / 0.075));
  const wArea = 1 - smooth(0.7, 1.5, Math.hypot(lx / 0.55, ly / 0.22));
  dx += u * 0.25 * k.mouthWidth * wMouth * mouthFront;
  dy += ly * 0.5 * k.lipFullness * wLips * mouthFront;
  dz += 0.035 * k.lipFullness * wLips * mouthFront;
  dy += 0.07 * k.mouthHeight * wArea * mouthFront;

  return [dx, dy, dz];
}

/** Returns a new mesh with the customized proportions (the cached input mesh is never modified). */
export function customizeClassicFace(mesh, raw) {
  const k = normalizeFaceCustom(raw);
  if (isDefaultFaceCustom(k)) return mesh;
  const eyeCentre = mesh.eyeCentre;
  const eyes = [];
  for (let e = 0; e < (eyeCentre?.length || 0) / 3; e++) eyes.push({ x: eyeCentre[3 * e], y: eyeCentre[3 * e + 1], z: eyeCentre[3 * e + 2] });
  eyes.sort((a, b) => a.x - b.x);
  const cx = eyes.length >= 2 ? 0.5 * (eyes[0].x + eyes[eyes.length - 1].x) : 0;
  const ctx = {
    cx,
    eyes,
    eyeY: eyes.length ? eyes[0].y : 0,
    lipY: mesh.lipCentre ? mesh.lipCentre[1] : -0.47,
  };

  const eyeOf = new Int8Array(mesh.vertexCount).fill(-1);
  for (let e = 0; e < (mesh.eyeFirst?.length || 0); e++) {
    // eyeFirst follows the order of eyeCentre in the file; map to the sorted eye list through x.
    const target = eyeCentre[3 * e] < cx ? 0 : 1;
    for (let i = mesh.eyeFirst[e]; i < mesh.eyeFirst[e] + mesh.eyeCount[e]; i++) eyeOf[i] = target;
  }

  const verts = new Float32Array(mesh.verts);
  for (let i = 0; i < mesh.vertexCount; i++) {
    const [dx, dy, dz] = faceDisplacement(verts[3 * i], verts[3 * i + 1], verts[3 * i + 2], k, ctx, eyeOf[i]);
    verts[3 * i] += dx;
    verts[3 * i + 1] += dy;
    verts[3 * i + 2] += dz;
  }

  const moveCentre = (point, eyeball = -1) => {
    const [dx, dy, dz] = faceDisplacement(point[0], point[1], point[2], k, ctx, eyeball);
    return [point[0] + dx, point[1] + dy, point[2] + dz];
  };
  const newEyeCentre = new Float32Array(eyeCentre);
  for (let e = 0; e < newEyeCentre.length / 3; e++) {
    const moved = moveCentre([eyeCentre[3 * e], eyeCentre[3 * e + 1], eyeCentre[3 * e + 2]], eyeCentre[3 * e] < cx ? 0 : 1);
    newEyeCentre.set(moved, 3 * e);
  }
  const lipCentre = new Float32Array(moveCentre([mesh.lipCentre[0], mesh.lipCentre[1], mesh.lipCentre[2]]));

  const headVertices = Math.min(mesh.nHead || mesh.vertexCount, mesh.vertexCount);
  const normals = HeadMesh.refitHeadNormals(mesh, verts, headVertices);
  const crown = mesh.crown + faceDisplacement(cx, mesh.crown, 0, k, ctx)[1];
  const bottom = mesh.bottom + faceDisplacement(cx, mesh.bottom, 0, k, ctx)[1];
  const result = new HeadMesh({ ...mesh, verts, normals, eyeCentre: newEyeCentre, lipCentre, crown, bottom });
  result._customized = faceCustomKey(k);
  return result;
}
