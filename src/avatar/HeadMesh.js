// Complete port of HeadMesh.kt, HairStyle.kt, HairShade.kt, AvatarFaces.kt,
// NetworkWeb.kt, CircuitTraces.kt, FiberHair.kt, and StructureEdges from Jarvis-Android.

export const JAW_PIVOT = [0, 0.06, -0.34];
export const JAW_MAX = 0.15;

export const HOLO_SKIN = 5;
export const HOLO_HAIR_SKIN = 6;
export const BLUE_HOLO_SKIN = 7;
export const DARK_BLUE_HOLO_SKIN = 8;

export const POLYGON_LEVELS = [
  { id: 'eco', label: 'Éco (~20 500 polygones)', short: 'Éco (20k)', webR0: 0.048 },
  { id: 'low', label: 'Léger (~27 700 polygones)', short: 'Léger (28k)', webR0: 0.038 },
  { id: 'medium', label: 'Standard (~37 160 polygones)', short: 'Standard (37k)', webR0: 0.032 },
  { id: 'high', label: 'Haute Définition (~84 555 polygones)', short: 'Haute (85k)', webR0: 0.028 },
  { id: 'ultra', label: 'Ultra (~148 600 polygones)', short: 'Ultra (149k)', webR0: 0.024 },
];

export const HAIR_SHADES = [
  { id: 'black', fr: 'Noir', en: 'Black', colours: { body: 0x1a1512, root: 0x0a0807, tip: 0x302620, grey: 0, greyRgb: 0x8e8b86 }, browColour: 0xff161210 },
  { id: 'dark_brown', fr: 'Brun foncé', en: 'Dark brown', colours: { body: 0x2a1c14, root: 0x120c08, tip: 0x4a3325, grey: 0, greyRgb: 0x8e8b86 }, browColour: 0xff221710 },
  { id: 'chestnut', fr: 'Châtain', en: 'Chestnut', colours: { body: 0x483121, root: 0x20150e, tip: 0x8e6c48, grey: 0, greyRgb: 0x8e8b86 }, browColour: 0xff34241c },
  { id: 'light_brown', fr: 'Châtain clair', en: 'Light brown', colours: { body: 0x6b4a2e, root: 0x332214, tip: 0xa67c52, grey: 0, greyRgb: 0x8e8b86 }, browColour: 0xff4a3320 },
  { id: 'dark_blonde', fr: 'Blond foncé', en: 'Dark blonde', colours: { body: 0x8c6d42, root: 0x47351d, tip: 0xc29f68, grey: 0, greyRgb: 0x8e8b86 }, browColour: 0xff5e482b },
  { id: 'blonde', fr: 'Blond', en: 'Blonde', colours: { body: 0xb89356, root: 0x634b26, tip: 0xe0c082, grey: 0, greyRgb: 0x8e8b86 }, browColour: 0xff705732 },
  { id: 'platinum', fr: 'Blond platine', en: 'Platinum', colours: { body: 0xd8cdb8, root: 0x857a67, tip: 0xf2ece0, grey: 0, greyRgb: 0x8e8b86 }, browColour: 0xff7d7362 },
  { id: 'auburn', fr: 'Auburn', en: 'Auburn', colours: { body: 0x5c2618, root: 0x290f08, tip: 0x8f432c, grey: 0, greyRgb: 0x8e8b86 }, browColour: 0xff3d1a11 },
  { id: 'copper', fr: 'Roux cuivré', en: 'Copper', colours: { body: 0x8c3b1e, root: 0x42190a, tip: 0xc46538, grey: 0, greyRgb: 0x8e8b86 }, browColour: 0xff592614 },
  { id: 'grey', fr: 'Gris poivre et sel', en: 'Salt & pepper', colours: { body: 0x3b3836, root: 0x1c1a19, tip: 0x595450, grey: 0.45, greyRgb: 0x9e9b96 }, browColour: 0xff383533 },
  { id: 'silver', fr: 'Argenté', en: 'Silver', colours: { body: 0x8a8884, root: 0x4d4b48, tip: 0xc7c4be, grey: 0.75, greyRgb: 0xd4d1cc }, browColour: 0xff595754 },
];

export const BUILT_IN_FACES = [
  {
    id: 'classic',
    label: 'Classique',
    gender: 'female',
    asset: './assets/avatar/head_mesh.bin',
    subdivide: true,
    browColour: 0xff34241c,
    fibres: true,
    browScale: 1.0,
    lashScale: 1.0,
    androidLook: false,
    halo: false,
    lipTint: 0.7,
    credit: 'Adapté de Mark-LIV (FatihMakes) & Lee Perry-Smith (CC BY 3.0)',
    hairColours: { body: 0x483121, root: 0x20150e, tip: 0x8e6c48, grey: 0, greyRgb: 0x8e8b86 },
  },
  {
    id: 'lea',
    label: 'Léa',
    gender: 'female',
    asset: './assets/avatar/head_mesh_lea.bin',
    subdivide: false,
    browColour: 0xff1a1e27,
    fibres: false,
    browScale: 0.65,
    lashScale: 1.35,
    androidLook: true,
    halo: true,
    lipTint: 0.7,
    credit: 'Sculpt basé sur "Female Head Sculpt" (Aconear, CC BY 4.0)',
    hairColours: { body: 0x1f2533, root: 0x0b0d13, tip: 0x5b7496, grey: 0, greyRgb: 0x8e8b86 },
  },
  {
    id: 'marc',
    label: 'Marc',
    gender: 'male',
    asset: './assets/avatar/head_mesh_marc.bin',
    subdivide: false,
    browColour: 0xff2b2928,
    fibres: true,
    browScale: 1.0,
    lashScale: 1.0,
    androidLook: false,
    halo: false,
    lipTint: 0.3,
    credit: 'Sculpt basé sur "Realistic Male Head" (Ouail, CC BY 4.0)',
    hairColours: { body: 0x33302f, root: 0x151313, tip: 0x4e4a46, grey: 0.12, greyRgb: 0x77736e },
  },
  {
    id: 'haseo',
    label: 'Haseo',
    gender: 'custom',
    asset: './assets/avatar/haseo.fbx',
    subdivide: false,
    browColour: 0xff242a34,
    fibres: false,
    browScale: 1.0,
    lashScale: 1.0,
    androidLook: false,
    halo: false,
    lipTint: 0,
    credit: 'Modèle FBX fourni par Haseosama (sans texture)',
    hairColours: { body: 0x30343a, root: 0x15181d, tip: 0x555e6a, grey: 0, greyRgb: 0x8e8b86 },
  },
];

const LANDMARK_NAMES = ['eye_l', 'eye_r', 'brow_l', 'brow_r', 'lips_out', 'lips_in'];

export class HeadMesh {
  constructor(props) {
    Object.assign(this, props);
    this.vertexCount = (this.verts.length / 3) | 0;
    this.faceCount = (this.faces.length / 3) | 0;
    this.edgeCount = (this.edges.length / 2) | 0;
  }

  /** Match Classic's face proportions to the masculine, angular reference without changing any colors. */
  static refineClassicFace(mesh) {
    const verts = new Float32Array(mesh.verts);
    const eyeCentre = mesh.eyeCentre;
    const centreX = eyeCentre?.length >= 6 ? 0.5 * (eyeCentre[0] + eyeCentre[3]) : 0;
    const headVertices = Math.min(mesh.nHead || mesh.vertexCount, mesh.vertexCount);

    for (let i = 0; i < headVertices; i++) {
      const x = mesh.verts[3 * i];
      const y = mesh.verts[3 * i + 1];
      const z = mesh.verts[3 * i + 2];
      const jaw = mesh.jaw?.[i] || 0;
      const brow = mesh.brow?.[i] || 0;
      if (mesh.lipMask?.[i] > 0.05) continue;

      const front = smooth(-0.08, 0.24, z);
      if (front <= 0) continue;
      const absX = Math.abs(x - centreX);
      const cheekSide = smooth(0.12, 0.26, absX);
      const cheek = smooth(-0.35, -0.12, y) * (1 - smooth(0.28, 0.48, y)) * cheekSide * front;
      const jawBand = smooth(-1.00, -0.76, y) * (1 - smooth(-0.46, -0.30, y)) * front * jaw;
      const jawCorner = smooth(0.22, 0.40, absX) * (1 - smooth(0.56, 0.72, absX)) *
        smooth(-0.78, -0.66, y) * (1 - smooth(-0.38, -0.26, y)) * front * jaw;
      const chinFront = smooth(-0.84, -0.68, y) * (1 - smooth(-0.55, -0.48, y)) *
        (1 - smooth(0.23, 0.43, absX)) * front * jaw;
      const underChin = smooth(-0.99, -0.86, y) * (1 - smooth(-0.79, -0.70, y)) * front * jaw;
      const browRidge = smooth(0.04, 0.14, y) * (1 - smooth(0.32, 0.42, y)) * front * brow;

      // Reduce cheek fullness, but keep a distinct, squarer jaw angle. Leave the nose itself alone.
      const widthScale = 1 - 0.060 * cheek + 0.100 * jawBand + 0.075 * jawCorner;
      if (widthScale === 1 && chinFront === 0 && underChin === 0 && browRidge === 0 && cheek === 0) continue;
      verts[3 * i] = centreX + (x - centreX) * widthScale;
      verts[3 * i + 1] = y + 0.045 * underChin - 0.014 * jawCorner;
      verts[3 * i + 2] = z - 0.026 * cheek + 0.052 * browRidge + 0.045 * chinFront - 0.052 * underChin;
    }

    // Refit smooth head normals to the deformed surface; vertex paint/material colors are untouched.
    const normals = new Float32Array(mesh.normals);
    const normalSums = new Float64Array(headVertices * 3);
    for (let face = 0; face < mesh.faceCount; face++) {
      if (mesh.faceGroup?.[face] > 1.5) continue;
      const a = mesh.faces[3 * face];
      const b = mesh.faces[3 * face + 1];
      const c = mesh.faces[3 * face + 2];
      if (a >= headVertices || b >= headVertices || c >= headVertices) continue;
      const abx = verts[3 * b] - verts[3 * a];
      const aby = verts[3 * b + 1] - verts[3 * a + 1];
      const abz = verts[3 * b + 2] - verts[3 * a + 2];
      const acx = verts[3 * c] - verts[3 * a];
      const acy = verts[3 * c + 1] - verts[3 * a + 1];
      const acz = verts[3 * c + 2] - verts[3 * a + 2];
      const nx = aby * acz - abz * acy;
      const ny = abz * acx - abx * acz;
      const nz = abx * acy - aby * acx;
      for (const index of [a, b, c]) {
        normalSums[3 * index] += nx;
        normalSums[3 * index + 1] += ny;
        normalSums[3 * index + 2] += nz;
      }
    }
    for (let i = 0; i < headVertices; i++) {
      let nx = normalSums[3 * i];
      let ny = normalSums[3 * i + 1];
      let nz = normalSums[3 * i + 2];
      const length = Math.hypot(nx, ny, nz);
      if (length < 1e-9) continue;
      const old = 3 * i;
      if (nx * mesh.normals[old] + ny * mesh.normals[old + 1] + nz * mesh.normals[old + 2] < 0) {
        nx = -nx; ny = -ny; nz = -nz;
      }
      normals[old] = nx / length;
      normals[old + 1] = ny / length;
      normals[old + 2] = nz / length;
    }

    return new HeadMesh({ ...mesh, verts, normals });
  }

  static parse(arrayBuffer) {
    const dv = new DataView(arrayBuffer);
    const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    if (magic !== 'JHM2') {
      throw new Error(`Unsupported head_mesh.bin header: ${magic} (expected JHM2)`);
    }
    let pos = 4;
    const readInt = () => {
      const v = dv.getInt32(pos, true);
      pos += 4;
      return v;
    };
    const readFloat = () => {
      const v = dv.getFloat32(pos, true);
      pos += 4;
      return v;
    };
    const readFloats = (n) => {
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        out[i] = dv.getFloat32(pos, true);
        pos += 4;
      }
      return out;
    };
    const readInts = (n) => {
      const out = new Int32Array(n);
      for (let i = 0; i < n; i++) {
        out[i] = dv.getInt32(pos, true);
        pos += 4;
      }
      return out;
    };

    const nv = readInt();
    const nf = readInt();
    const ne = readInt();
    const nHead = readInt();
    const nFace = readInt();
    const crown = readFloat();
    const bottom = readFloat();
    const lipCentre = readFloats(3);
    const verts = readFloats(3 * nv);
    const normals = readFloats(3 * nv);
    const jaw = readFloats(nv);
    const brow = readFloats(nv);
    const lips = readFloats(nv);
    const fade = readFloats(nv);
    const group = readFloats(nf);
    const faces = readInts(3 * nf);
    const edges = readInts(2 * ne);

    const rings = readInt();
    const landmarks = {};
    for (let r = 0; r < rings; r++) {
      const count = readInt();
      landmarks[LANDMARK_NAMES[r] || `ring_${r}`] = readInts(count);
    }

    const paint = pos < dv.byteLength ? readInts(nv) : new Int32Array(nv);
    const lid = pos < dv.byteLength ? readFloats(nv) : new Float32Array(nv);
    const lipMask = pos < dv.byteLength ? readFloats(nv) : new Float32Array(nv);
    const eyelidRim = pos < dv.byteLength ? readInts(readInt() * 3) : new Int32Array(0);
    const mouthUpper = pos < dv.byteLength ? readInts(readInt()) : new Int32Array(0);
    const mouthLower = pos < dv.byteLength ? readInts(readInt()) : new Int32Array(0);

    const eyes = pos < dv.byteLength ? readInt() : 0;
    const eyeFirst = new Int32Array(eyes);
    const eyeCount = new Int32Array(eyes);
    const eyeCentre = new Float32Array(3 * eyes);
    for (let e = 0; e < eyes; e++) {
      eyeFirst[e] = readInt();
      eyeCount[e] = readInt();
      eyeCentre[3 * e] = readFloat();
      eyeCentre[3 * e + 1] = readFloat();
      eyeCentre[3 * e + 2] = readFloat();
    }

    const lockFirst = pos < dv.byteLength ? readInt() : 0;
    const lockCount = pos < dv.byteLength ? readInt() : 0;
    const lockRows = pos < dv.byteLength ? readInt() : 0;

    return new HeadMesh({
      nHead,
      nFace,
      crown,
      bottom,
      lipCentre,
      verts,
      normals,
      jaw,
      brow,
      lips,
      fade,
      faceGroup: group,
      faces,
      edges,
      landmarks,
      paint,
      lid,
      lipMask,
      eyelidRim,
      mouthUpper,
      mouthLower,
      eyeFirst,
      eyeCount,
      eyeCentre,
      lockFirst,
      lockCount,
      lockRows,
      hairSway: new Float32Array(nv),
    });
  }

  /**
   * 1-to-4 Phong / Curved-Normal subdivision of the skin triangles on the head mesh.
   * Quadruples the face polygon count of the Classic avatar (~16,400 skin triangles -> ~65,600 curved triangles,
   * ~86,600 total triangles) while preserving all landmark, eye, lip, and hair lock vertex indices.
   */
  static subdivideSkin(mesh, { includeHair = false } = {}) {
    if (mesh._subdivided && !includeHair) return mesh;
    const oldV = mesh.vertexCount;
    const oldF = mesh.faceCount;
    const v = mesh.verts;
    const nrm = mesh.normals;
    const f = mesh.faces;
    const fg = mesh.faceGroup;
    const paint = mesh.paint;
    const fade = mesh.fade;
    const jaw = mesh.jaw;
    const brow = mesh.brow;
    const lips = mesh.lips;
    const lid = mesh.lid;
    const lipMask = mesh.lipMask;
    const sway = mesh.hairSway || new Float32Array(oldV);

    // Mark eyelid rim & mouth chain vertices so their boundary edges stay exact
    const boundaryVert = new Uint8Array(oldV);
    for (let i = 0; i < mesh.eyelidRim.length; i += 3) {
      boundaryVert[mesh.eyelidRim[i]] = 1;
      boundaryVert[mesh.eyelidRim[i + 1]] = 1;
    }
    for (const vi of mesh.mouthUpper) boundaryVert[vi] = 1;
    for (const vi of mesh.mouthLower) boundaryVert[vi] = 1;

    const toSubdivide = new Uint8Array(oldF);
    let subCount = 0;
    for (let t = 0; t < oldF; t++) {
      const a = f[3 * t], b = f[3 * t + 1], c = f[3 * t + 2];
      const allowedGroup = includeHair ? fg[t] <= 3.5 : fg[t] <= 1.5;
      const allowedPaint = includeHair || (paint[a] === 0 && paint[b] === 0 && paint[c] === 0);
      if (
        allowedGroup &&
        allowedPaint &&
        (fade[a] + fade[b] + fade[c]) / 3 > 0.12
      ) {
        toSubdivide[t] = 1;
        subCount++;
      }
    }
    if (subCount === 0) return mesh;

    const edgeMap = new Map();
    const newVerts = [];
    const newNormals = [];
    const newJaw = [];
    const newBrow = [];
    const newLips = [];
    const newFade = [];
    const newPaint = [];
    const newLid = [];
    const newLipMask = [];
    const newSway = [];

    const getMidpoint = (i, j) => {
      const lo = i < j ? i : j;
      const hi = i < j ? j : i;
      const key = lo * 131072 + hi;
      const existing = edgeMap.get(key);
      if (existing !== undefined) return existing;

      const idx = oldV + newJaw.length;
      edgeMap.set(key, idx);

      const ax = v[3 * lo], ay = v[3 * lo + 1], az = v[3 * lo + 2];
      const bx = v[3 * hi], by = v[3 * hi + 1], bz = v[3 * hi + 2];
      const nax = nrm[3 * lo], nay = nrm[3 * lo + 1], naz = nrm[3 * lo + 2];
      const nbx = nrm[3 * hi], nby = nrm[3 * hi + 1], nbz = nrm[3 * hi + 2];

      let mx = 0.5 * (ax + bx);
      let my = 0.5 * (ay + by);
      let mz = 0.5 * (az + bz);

      // Curved Phong projection along surface normals (unless on an eyelid/lip seam)
      if (!boundaryVert[lo] && !boundaryVert[hi] && lid[lo] === 0 && lid[hi] === 0) {
        const dx = bx - ax, dy = by - ay, dz = bz - az;
        const dotA = dx * nax + dy * nay + dz * naz;
        const dotB = -dx * nbx - dy * nby - dz * nbz;
        const alpha = 0.16;
        mx -= alpha * (dotA * nax + dotB * nbx);
        my -= alpha * (dotA * nay + dotB * nby);
        mz -= alpha * (dotA * naz + dotB * nbz);
      }

      let nx = nax + nbx, ny = nay + nby, nz = naz + nbz;
      const nl = Math.max(Math.hypot(nx, ny, nz), 1e-9);
      nx /= nl; ny /= nl; nz /= nl;

      newVerts.push(mx, my, mz);
      newNormals.push(nx, ny, nz);
      newJaw.push(0.5 * (jaw[lo] + jaw[hi]));
      newBrow.push(0.5 * (brow[lo] + brow[hi]));
      newLips.push(0.5 * (lips[lo] + lips[hi]));
      newFade.push(0.5 * (fade[lo] + fade[hi]));
      newPaint.push(paint[lo] !== 0 ? paint[lo] : paint[hi]);
      newLid.push(0.5 * (lid[lo] + lid[hi]));
      newLipMask.push(0.5 * (lipMask[lo] + lipMask[hi]));
      newSway.push(0.5 * (sway[lo] + sway[hi]));

      return idx;
    };

    const newF = oldF + 3 * subCount;
    const outFaces = new Int32Array(3 * newF);
    const outGroup = new Float32Array(newF);
    let fk = 0;

    for (let t = 0; t < oldF; t++) {
      const a = f[3 * t], b = f[3 * t + 1], c = f[3 * t + 2];
      const g = fg[t];
      if (!toSubdivide[t]) {
        outFaces[3 * fk] = a;
        outFaces[3 * fk + 1] = b;
        outFaces[3 * fk + 2] = c;
        outGroup[fk++] = g;
      } else {
        const ab = getMidpoint(a, b);
        const bc = getMidpoint(b, c);
        const ca = getMidpoint(c, a);

        outFaces[3 * fk] = a; outFaces[3 * fk + 1] = ab; outFaces[3 * fk + 2] = ca; outGroup[fk++] = g;
        outFaces[3 * fk] = b; outFaces[3 * fk + 1] = bc; outFaces[3 * fk + 2] = ab; outGroup[fk++] = g;
        outFaces[3 * fk] = c; outFaces[3 * fk + 1] = ca; outFaces[3 * fk + 2] = bc; outGroup[fk++] = g;
        outFaces[3 * fk] = ab; outFaces[3 * fk + 1] = bc; outFaces[3 * fk + 2] = ca; outGroup[fk++] = g;
      }
    }

    const totalV = oldV + newJaw.length;
    const mergeFloat = (orig, added) => {
      const out = new Float32Array(totalV);
      out.set(orig, 0);
      out.set(added, oldV);
      return out;
    };
    const mergeInt = (orig, added) => {
      const out = new Int32Array(totalV);
      out.set(orig, 0);
      out.set(added, oldV);
      return out;
    };

    const outVerts = new Float32Array(3 * totalV);
    outVerts.set(v, 0);
    outVerts.set(newVerts, 3 * oldV);

    const outNormals = new Float32Array(3 * totalV);
    outNormals.set(nrm, 0);
    outNormals.set(newNormals, 3 * oldV);

    const subdivided = new HeadMesh({
      ...mesh,
      verts: outVerts,
      normals: outNormals,
      jaw: mergeFloat(jaw, newJaw),
      brow: mergeFloat(brow, newBrow),
      lips: mergeFloat(lips, newLips),
      fade: mergeFloat(fade, newFade),
      paint: mergeInt(paint, newPaint),
      lid: mergeFloat(lid, newLid),
      lipMask: mergeFloat(lipMask, newLipMask),
      hairSway: mergeFloat(sway, newSway),
      faces: outFaces,
      faceGroup: outGroup,
    });
    subdivided._subdivided = true;
    return subdivided;
  }

  /**
   * Watertight vertex-clustering mesh decimation for lower polygon levels ('eco', 'low').
   * Preserves all eyes, eyelids, lips, landmarks, and hair lock vertices 100% intact.
   */
  static decimateSkin(mesh, cellSize = 0.018) {
    if (!cellSize || cellSize <= 0) return mesh;
    const nV = mesh.vertexCount;
    const nF = mesh.faceCount;
    const v = mesh.verts;
    const f = mesh.faces;
    const fg = mesh.faceGroup;

    // Pin eyes, eyelids, mouth chains, lips, landmarks, and locks so facial features stay sharp
    const pinned = new Uint8Array(nV);
    for (let e = 0; e < mesh.eyeFirst.length; e++) {
      const s = mesh.eyeFirst[e], end = s + mesh.eyeCount[e];
      for (let i = s; i < end; i++) pinned[i] = 1;
    }
    for (let i = 0; i < mesh.eyelidRim.length; i += 3) {
      pinned[mesh.eyelidRim[i]] = 1;
      pinned[mesh.eyelidRim[i + 1]] = 1;
    }
    for (const vi of mesh.mouthUpper) pinned[vi] = 1;
    for (const vi of mesh.mouthLower) pinned[vi] = 1;
    for (const ring of Object.values(mesh.landmarks || {})) {
      for (const vi of ring) pinned[vi] = 1;
    }
    for (let i = 0; i < nV; i++) {
      if (mesh.lid[i] > 0.005 || mesh.lipMask[i] > 0.08 || mesh.lips[i] > 0.08) {
        pinned[i] = 1;
      }
    }

    const inv = 1 / cellSize;
    const cellMap = new Map();
    const rep = new Int32Array(nV);
    for (let i = 0; i < nV; i++) {
      if (pinned[i]) {
        rep[i] = i;
        continue;
      }
      const gx = Math.floor((v[3 * i] + 2.0) * inv) & 0x3ff;
      const gy = Math.floor((v[3 * i + 1] + 2.0) * inv) & 0x3ff;
      const gz = Math.floor((v[3 * i + 2] + 2.0) * inv) & 0x3ff;
      const pTag = mesh.paint[i] === 0 ? 0 : 1;
      const key = ((gx * 1024 + gy) * 1024 + gz) * 2 + pTag;
      const existing = cellMap.get(key);
      if (existing !== undefined) {
        rep[i] = existing;
      } else {
        cellMap.set(key, i);
        rep[i] = i;
      }
    }

    const outFacesTmp = [];
    const outGroupTmp = [];
    for (let t = 0; t < nF; t++) {
      const a = rep[f[3 * t]];
      const b = rep[f[3 * t + 1]];
      const c = rep[f[3 * t + 2]];
      if (a === b || b === c || c === a) continue;
      outFacesTmp.push(a, b, c);
      outGroupTmp.push(fg[t]);
    }

    const decimated = new HeadMesh({
      ...mesh,
      faces: new Int32Array(outFacesTmp),
      faceGroup: new Float32Array(outGroupTmp),
    });
    decimated._decimated = true;
    return decimated;
  }

  /**
   * Applies the user-selected polygon density level ('eco' | 'low' | 'medium' | 'high' | 'ultra').
   */
  static applyPolygonLevel(baseMesh, level = 'high') {
    const spec = POLYGON_LEVELS.find((p) => p.id === level) || POLYGON_LEVELS[3];
    let result = baseMesh;
    if (level === 'eco') {
      result = HeadMesh.decimateSkin(baseMesh, 0.046);
    } else if (level === 'low') {
      result = HeadMesh.decimateSkin(baseMesh, 0.026);
    } else if (level === 'medium') {
      result = baseMesh;
    } else if (level === 'ultra') {
      result = HeadMesh.subdivideSkin(baseMesh, { includeHair: true });
    } else {
      // 'high' (default: 84,555 polygons on Classic)
      result = HeadMesh.subdivideSkin(baseMesh, { includeHair: false });
    }
    result._polygonLevel = spec.id;
    result._webR0 = spec.webR0;
    return result;
  }
}

/**
 * Removes the original scalp/hair colour overlay from a head mesh when the user
 * selects the bald option. Fully opaque facial details (eyes/brows) are retained.
 */
export function removeHairPaint(mesh) {
  const paint = new Int32Array(mesh.paint);
  let removed = 0;
  for (let i = 0; i < paint.length; i++) {
    const value = paint[i] >>> 0;
    if (value !== 0 && ((value >>> 24) & 0xff) < 255) {
      paint[i] = 0;
      removed++;
    }
  }
  return removed ? new HeadMesh({ ...mesh, paint }) : mesh;
}

// ── Colour & Hair Helpers ───────────────────────────────────────────────────

function mixRgb(a, b, t) {
  const f = Math.max(0, Math.min(1, t));
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * f);
  const g = Math.round(ag + (bg - ag) * f);
  const bl = Math.round(ab + (bb - ab) * f);
  return (r << 16) | (g << 8) | bl;
}

function scaleRgb(rgb, k) {
  const r = Math.min(255, Math.max(0, Math.round(((rgb >> 16) & 0xff) * k)));
  const g = Math.min(255, Math.max(0, Math.round(((rgb >> 8) & 0xff) * k)));
  const b = Math.min(255, Math.max(0, Math.round((rgb & 0xff) * k)));
  return (r << 16) | (g << 8) | b;
}

function strandColour(keyByte, lift, colours, alpha = 254) {
  const k = (keyByte & 0xff) / 255.0;
  const grey = colours.grey || 0;
  if (grey > 0 && (((keyByte * 73 + 19) & 0xff) / 255.0) < grey) {
    const shade = 0.8 + 0.35 * k;
    return ((alpha & 0xff) << 24) | scaleRgb(colours.greyRgb || 0x8e8b86, shade);
  }
  const base = k < 0.5 ? mixRgb(colours.root, colours.body, k * 2) : mixRgb(colours.body, colours.tip, (k - 0.5) * 2);
  const lifted = mixRgb(colours.root, base, 0.55 + 0.45 * Math.max(0, Math.min(1, lift)));
  return ((alpha & 0xff) << 24) | lifted;
}

function rgbToHsv(rgb) {
  const r = ((rgb >> 16) & 0xff) / 255;
  const g = ((rgb >> 8) & 0xff) / 255;
  const b = (rgb & 0xff) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 1e-5) {
    if (max === r) h = (((g - b) / d) % 6 + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  const s = max > 1e-5 ? d / max : 0;
  return [h, s, max];
}

function hsvToRgb(h, s, v) {
  const hh = ((h % 1) + 1) % 1 * 6;
  const i = Math.floor(hh);
  const f = hh - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  let r = 0, g = 0, b = 0;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    default: r = v; g = p; b = q; break;
  }
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

export function recolourHair(mesh, fromColours, toColours) {
  const paint = new Int32Array(mesh.paint);
  const [fh, fs, fv] = rgbToHsv(fromColours.body);
  const [th, ts, tv] = rgbToHsv(toColours.body);
  const vRatio = tv / Math.max(fv, 0.08);
  const sRatio = ts / Math.max(fs, 0.08);

  for (let i = 0; i < paint.length; i++) {
    const p = paint[i];
    const a = (p >>> 24) & 0xff;
    if (p === 0 || a >= 255) continue;
    const [, s, v] = rgbToHsv(p & 0x00ffffff);
    const nv = Math.max(0.02, Math.min(1, Math.pow(v, 0.9) * vRatio));
    const ns = Math.max(0, Math.min(1, s * sRatio));
    let rgb = hsvToRgb(th, ns, nv);
    if (toColours.grey > 0 && (((i * 73 + 19) & 0xff) / 255) < toColours.grey) {
      rgb = scaleRgb(toColours.greyRgb || 0x8e8b86, 0.65 + 0.5 * v);
    }
    paint[i] = (a << 24) | rgb;
  }
  return new HeadMesh({ ...mesh, paint });
}

// ── HairStyle (JHR1 binary parser & skull-field fitter) ─────────────────────

function smooth(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export class HairStyle {
  constructor(props) {
    Object.assign(this, props);
    this.vertexCount = (this.pos.length / 3) | 0;
    this.faceCount = (this.faces.length / 3) | 0;
  }

  static parse(arrayBuffer) {
    const dv = new DataView(arrayBuffer);
    const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    if (magic !== 'JHR1') {
      throw new Error(`Not a hairstyle file: ${magic}`);
    }
    let pos = 4;
    const readInt = () => { const v = dv.getInt32(pos, true); pos += 4; return v; };
    const readFloat = () => { const v = dv.getFloat32(pos, true); pos += 4; return v; };
    const nv = readInt();
    const nf = readInt();
    const az = readInt();
    const el = readInt();
    const centre = new Float32Array([readFloat(), readFloat(), readFloat()]);
    const lo = new Float32Array([readFloat(), readFloat(), readFloat()]);
    const step = new Float32Array([readFloat(), readFloat(), readFloat()]);
    const radius = new Float32Array(el * az);
    for (let i = 0; i < el * az; i++) radius[i] = readFloat();

    const vPos = new Float32Array(3 * nv);
    for (let i = 0; i < nv; i++) {
      const qx = dv.getUint16(pos, true); pos += 2;
      const qy = dv.getUint16(pos, true); pos += 2;
      const qz = dv.getUint16(pos, true); pos += 2;
      vPos[3 * i] = lo[0] + qx * step[0];
      vPos[3 * i + 1] = lo[1] + qy * step[1];
      vPos[3 * i + 2] = lo[2] + qz * step[2];
    }
    const key = new Uint8Array(nv);
    for (let i = 0; i < nv; i++) key[i] = dv.getUint8(pos + i);
    const raw = 6 * nv + nv;
    pos += nv + ((4 - (raw % 4)) % 4);

    const faces = new Int32Array(3 * nf);
    for (let i = 0; i < 3 * nf; i++) {
      faces[i] = dv.getUint16(pos, true);
      pos += 2;
    }

    return new HairStyle({ az, el, centre, radius, pos: vPos, key, faces });
  }

  sampleRadius(grid, dirX, dirY, dirZ) {
    const theta = Math.atan2(dirX, dirZ);
    const phi = Math.asin(Math.max(-1, Math.min(1, dirY)));
    const u = ((theta + Math.PI) / (2 * Math.PI)) * this.az - 0.5;
    const v = ((phi + 0.35 * Math.PI) / (0.85 * Math.PI)) * (this.el - 1);
    const j0 = Math.floor(u);
    const i0 = Math.max(0, Math.min(this.el - 2, Math.floor(v)));
    const fu = u - j0;
    const fv = Math.max(0, Math.min(1, v - i0));
    const jA = ((j0 % this.az) + this.az) % this.az;
    const jB = (jA + 1) % this.az;
    const r00 = grid[i0 * this.az + jA];
    const r01 = grid[i0 * this.az + jB];
    const r10 = grid[(i0 + 1) * this.az + jA];
    const r11 = grid[(i0 + 1) * this.az + jB];
    return (1 - fv) * ((1 - fu) * r00 + fu * r01) + fv * ((1 - fu) * r10 + fu * r11);
  }

  targetSkull(head) {
    const v = head.verts;
    const lm = head.landmarks;
    const eyeL = lm.eye_l || [];
    const eyeR = lm.eye_r || [];
    let ex = 0, ey = 0, ez = 0;
    const en = Math.max(1, eyeL.length + eyeR.length);
    for (const i of eyeL) { ex += v[3 * i]; ey += v[3 * i + 1]; ez += v[3 * i + 2]; }
    for (const i of eyeR) { ex += v[3 * i]; ey += v[3 * i + 1]; ez += v[3 * i + 2]; }
    ex /= en; ey /= en; ez /= en;

    let topY = -1e9, minX = 1e9, maxX = -1e9, backZ = 1e9;
    for (let i = 0; i < head.nHead; i++) {
      const x = v[3 * i], y = v[3 * i + 1], z = v[3 * i + 2];
      if (y > topY) topY = y;
      if (y > ey - 0.15 && y < ey + 0.55) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < backZ) backZ = z;
      }
    }
    const halfW = 0.5 * (maxX - minX);
    const cx = 0.5 * (minX + maxX);
    const cy = ey + 0.12 * (topY - ey);
    const cz = Math.min(ez - 0.85 * halfW, 0.5 * (ez + backZ));
    const ct = new Float32Array([cx, cy, cz]);

    const grid = new Float32Array(this.el * this.az);
    for (let i = 0; i < head.nHead; i++) {
      const dx = v[3 * i] - cx, dy = v[3 * i + 1] - cy, dz = v[3 * i + 2] - cz;
      const r = Math.hypot(dx, dy, dz);
      if (r < 1e-4) continue;
      const theta = Math.atan2(dx / r, dz / r);
      const phi = Math.asin(Math.max(-1, Math.min(1, dy / r)));
      const j = ((Math.floor(((theta + Math.PI) / (2 * Math.PI)) * this.az) % this.az) + this.az) % this.az;
      const k = Math.floor(((phi + 0.35 * Math.PI) / (0.85 * Math.PI)) * (this.el - 1));
      if (k >= 0 && k < this.el) {
        const idx = k * this.az + j;
        if (r > grid[idx]) grid[idx] = r;
      }
    }

    let sum = 0, cnt = 0;
    for (let k = Math.floor(this.el * 0.55); k < this.el; k++) {
      for (let j = 0; j < this.az; j++) {
        const r = grid[k * this.az + j];
        if (r > 0) { sum += r; cnt++; }
      }
    }
    const fallback = cnt > 0 ? sum / cnt : Math.max(topY - cy, 0.65);
    for (let idx = 0; idx < grid.length; idx++) {
      if (grid[idx] === 0) grid[idx] = fallback;
    }
    for (let pass = 0; pass < 3; pass++) {
      const prev = new Float32Array(grid);
      for (let k = 0; k < this.el; k++) {
        const k0 = Math.max(0, k - 1), k1 = Math.min(this.el - 1, k + 1);
        for (let j = 0; j < this.az; j++) {
          const jL = (j + this.az - 1) % this.az;
          const jR = (j + 1) % this.az;
          grid[k * this.az + j] =
            0.4 * prev[k * this.az + j] +
            0.15 * (prev[k * this.az + jL] + prev[k * this.az + jR] + prev[k0 * this.az + j] + prev[k1 * this.az + j]);
        }
      }
    }
    return { ct, grid };
  }

  fitOn(head, colours) {
    const { ct, grid: rT } = this.targetSkull(head);
    const scaleCand = [];
    for (let k = Math.floor(this.el * 0.5); k < this.el; k++) {
      for (let j = 0; j < this.az; j++) {
        const rs = this.radius[k * this.az + j];
        const rt = rT[k * this.az + j];
        if (rs > 0.1 && rt > 0.1) scaleCand.push(rt / rs);
      }
    }
    scaleCand.sort((a, b) => a - b);
    const s = scaleCand.length ? scaleCand[scaleCand.length >> 1] : 1.0;

    let frontZ = 0;
    const brows = [...(head.landmarks.brow_l || []), ...(head.landmarks.brow_r || [])];
    for (const i of brows) {
      if (head.verts[3 * i + 2] > frontZ) frontZ = head.verts[3 * i + 2];
    }

    const n = this.vertexCount;
    const out = new Float32Array(3 * n);
    const heightOver = new Float32Array(n);
    const cs = this.centre;

    for (let i = 0; i < n; i++) {
      const dx = this.pos[3 * i] - cs[0];
      const dy = this.pos[3 * i + 1] - cs[1];
      const dz = this.pos[3 * i + 2] - cs[2];
      const r = Math.hypot(dx, dy, dz);
      if (r < 1e-5) {
        out[3 * i] = ct[0];
        out[3 * i + 1] = ct[1];
        out[3 * i + 2] = ct[2];
        continue;
      }
      const ux = dx / r, uy = dy / r, uz = dz / r;
      const rs = this.sampleRadius(this.radius, ux, uy, uz);
      const rt = this.sampleRadius(rT, ux, uy, uz);
      const cap = smooth(-0.25, 0.2, uy);
      const rGoal = cap * (rt + (r - rs) * s) + (1 - cap) * (r * s);
      let x = ct[0] + ux * rGoal;
      let y = ct[1] + uy * rGoal;
      let z = ct[2] + uz * rGoal;
      heightOver[i] = Math.max(0, r - rs) * s;

      if (uz > 0.15 && y < ct[1] + 0.25 && y > ct[1] - 1.1) {
        const inFront = smooth(0.42, 0.12, Math.abs(x - ct[0]));
        const floor = frontZ + 0.05;
        if (inFront > 0 && z < floor) z += (floor - z) * inFront;
      }
      out[3 * i] = x;
      out[3 * i + 1] = y;
      out[3 * i + 2] = z;
    }

    const nrm = new Float32Array(3 * n);
    for (let t = 0; t < this.faceCount; t++) {
      const a = this.faces[3 * t], b = this.faces[3 * t + 1], c = this.faces[3 * t + 2];
      const ux = out[3 * b] - out[3 * a], uy = out[3 * b + 1] - out[3 * a + 1], uz = out[3 * b + 2] - out[3 * a + 2];
      const vx = out[3 * c] - out[3 * a], vy = out[3 * c + 1] - out[3 * a + 1], vz = out[3 * c + 2] - out[3 * a + 2];
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      for (const v of [a, b, c]) {
        nrm[3 * v] += fx;
        nrm[3 * v + 1] += fy;
        nrm[3 * v + 2] += fz;
      }
    }

    const paint = new Int32Array(n);
    const sway = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const ox = out[3 * i] - ct[0], oy = out[3 * i + 1] - ct[1], oz = out[3 * i + 2] - ct[2];
      const ol = Math.max(Math.hypot(ox, oy, oz), 1e-9);
      let sx = nrm[3 * i], sy = nrm[3 * i + 1], sz = nrm[3 * i + 2];
      const sl = Math.max(Math.hypot(sx, sy, sz), 1e-12);
      sx /= sl; sy /= sl; sz /= sl;
      if (sx * ox + sy * oy + sz * oz < 0) { sx = -sx; sy = -sy; sz = -sz; }
      let nx = 0.45 * sx + (0.55 * ox) / ol;
      let ny = 0.45 * sy + (0.55 * oy) / ol;
      let nz = 0.45 * sz + (0.55 * oz) / ol;
      const nl = Math.max(Math.hypot(nx, ny, nz), 1e-12);
      nrm[3 * i] = nx / nl;
      nrm[3 * i + 1] = ny / nl;
      nrm[3 * i + 2] = nz / nl;
      paint[i] = strandColour(this.key[i], Math.max(0, Math.min(1, heightOver[i] / 0.1)), colours);
      const low = smooth(0.25, -0.85, out[3 * i + 1]);
      sway[i] = low * (0.3 + 0.7 * smooth(0.02, 0.1, heightOver[i]));
    }

    const base = head.vertexCount;
    const lockEnd = head.lockFirst + head.lockCount * 3 * head.lockRows;
    const isLock = (v) => head.lockCount > 0 && v >= head.lockFirst && v < lockEnd;
    const keptFaces = [];
    for (let t = 0; t < head.faceCount; t++) {
      const a = head.faces[3 * t], b = head.faces[3 * t + 1], c = head.faces[3 * t + 2];
      if (!(isLock(a) || isLock(b) || isLock(c))) keptFaces.push(t);
    }

    const nf = keptFaces.length + this.faceCount;
    const faces = new Int32Array(3 * nf);
    const group = new Float32Array(nf);
    let k = 0;
    for (const t of keptFaces) {
      faces[3 * k] = head.faces[3 * t];
      faces[3 * k + 1] = head.faces[3 * t + 1];
      faces[3 * k + 2] = head.faces[3 * t + 2];
      group[k++] = head.faceGroup[t];
    }
    for (let t = 0; t < this.faceCount; t++) {
      faces[3 * k] = base + this.faces[3 * t];
      faces[3 * k + 1] = base + this.faces[3 * t + 1];
      faces[3 * k + 2] = base + this.faces[3 * t + 2];
      group[k++] = 2.5;
    }

    const totalV = base + n;
    const extFloat = (arr, fill) => {
      const res = new Float32Array(totalV);
      res.set(arr, 0);
      if (fill !== 0) res.fill(fill, base);
      return res;
    };
    const verts = new Float32Array(3 * totalV);
    verts.set(head.verts, 0);
    verts.set(out, 3 * base);

    const normals = new Float32Array(3 * totalV);
    normals.set(head.normals, 0);
    normals.set(nrm, 3 * base);

    const fullPaint = new Int32Array(totalV);
    fullPaint.set(head.paint, 0);
    fullPaint.set(paint, base);

    const fullSway = new Float32Array(totalV);
    fullSway.set(sway, base);

    return new HeadMesh({
      ...head,
      verts,
      normals,
      jaw: extFloat(head.jaw, 0),
      brow: extFloat(head.brow, 0),
      lips: extFloat(head.lips, 0),
      fade: extFloat(head.fade, 1),
      faceGroup: group,
      faces,
      paint: fullPaint,
      lid: extFloat(head.lid, 0),
      lipMask: extFloat(head.lipMask, 0),
      lockFirst: 0,
      lockCount: 0,
      lockRows: 0,
      hairSway: fullSway,
    });
  }
}

// ── CharacterMesh (Kept for unit test compatibility) ────────────────────────

export class CharacterMesh {
  constructor(props) {
    Object.assign(this, props);
    this.vertexCount = (this.verts.length / 3) | 0;
    this.faceCount = (this.faces.length / 3) | 0;
  }

  static parse(arrayBuffer, meta, atlasImage) {
    const dv = new DataView(arrayBuffer);
    const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    if (magic !== 'JCH1' && magic !== 'JCH2') {
      throw new Error(`Not a character mesh: ${magic}`);
    }
    let pos = 4;
    const readInt = () => { const v = dv.getInt32(pos, true); pos += 4; return v; };
    const readFloats = (n) => {
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        out[i] = dv.getFloat32(pos, true);
        pos += 4;
      }
      return out;
    };
    const nV = readInt();
    const nF = readInt();
    const verts = readFloats(3 * nV);
    const normals = readFloats(3 * nV);
    const uv = readFloats(2 * nV);
    const headW = readFloats(nV);
    const jaw = readFloats(nV);
    const brow = magic === 'JCH2' ? readFloats(nV) : new Float32Array(nV);

    const unlit = new Uint8Array(nV);
    const gazing = new Uint8Array(nV);
    for (let i = 0; i < nV; i++) {
      const b = dv.getUint8(pos + i);
      unlit[i] = (b & 1) !== 0 ? 1 : 0;
      gazing[i] = (b & 2) !== 0 ? 1 : 0;
    }
    pos += nV + ((4 - (nV % 4)) % 4);
    const faces = new Int32Array(3 * nF);
    for (let i = 0; i < 3 * nF; i++) {
      faces[i] = readInt();
    }

    return new CharacterMesh({
      label: meta?.label || 'Character',
      verts,
      normals,
      uv,
      headW,
      jaw,
      brow,
      unlit,
      gazing,
      faces,
      atlas: atlasImage,
    });
  }
}

// ── NetworkWeb (Port of NetworkWeb.kt — High-Density Poisson-Disc Polygon Web) ──

export class NetworkWeb {
  constructor(mesh, r0 = mesh._webR0 || 0.028) {
    const v = mesh.verts;
    const f = mesh.faces;
    const nF = mesh.faceCount;

    // Area-weighted cumulative distribution of head skin triangles
    const cumulative = new Float64Array(nF);
    let total = 0.0;
    for (let t = 0; t < nF; t++) {
      const a = f[3 * t], b = f[3 * t + 1], c = f[3 * t + 2];
      const avgFade = (mesh.fade[a] + mesh.fade[b] + mesh.fade[c]) / 3;
      const skinFace = mesh.faceGroup[t] >= 0.5 && mesh.faceGroup[t] <= 1.5;
      const plain = mesh.paint[a] === 0 && mesh.paint[b] === 0 && mesh.paint[c] === 0;
      if (skinFace && avgFade > 0.2 && plain) {
        const abx = v[3 * b] - v[3 * a], aby = v[3 * b + 1] - v[3 * a + 1], abz = v[3 * b + 2] - v[3 * a + 2];
        const acx = v[3 * c] - v[3 * a], acy = v[3 * c + 1] - v[3 * a + 1], acz = v[3 * c + 2] - v[3 * a + 2];
        const cx = aby * acz - abz * acy, cy = abz * acx - abx * acz, cz = abx * acy - aby * acx;
        total += 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
      }
      cumulative[t] = total;
    }

    // Denser around the eyes and lips
    const dense = [];
    for (const name of ['eye_l', 'eye_r', 'lips_out']) {
      const ring = mesh.landmarks[name];
      if (!ring || !ring.length) continue;
      let x = 0, y = 0, z = 0, rad = 0;
      for (const i of ring) { x += v[3 * i]; y += v[3 * i + 1]; z += v[3 * i + 2]; }
      x /= ring.length; y /= ring.length; z /= ring.length;
      for (const i of ring) {
        rad = Math.max(rad, Math.hypot(v[3 * i] - x, v[3 * i + 1] - y, v[3 * i + 2] - z));
      }
      dense.push([x, y, z, rad * 1.5]);
    }

    let seed = 31;
    const rnd = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const px = [], py = [], pz = [], pr = [];
    const ta = [], tb = [], tc = [], wa = [], wb = [], fd = [];
    const grid = new Map();
    const cell = (x) => Math.floor(x / r0);
    const key = (i, j, k) => (i + 512) * 1048576 + (j + 512) * 1024 + (k + 512);

    const tries = 180000;
    for (let n = 0; n < tries; n++) {
      const target = rnd() * total;
      let lo = 0, hi = nF - 1;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (cumulative[mid] < target) lo = mid + 1;
        else hi = mid;
      }
      const t = lo;
      const a = f[3 * t], b = f[3 * t + 1], c = f[3 * t + 2];
      if (mesh.faceGroup[t] < 0.5 || mesh.faceGroup[t] > 1.5) continue;
      if ((mesh.fade[a] + mesh.fade[b] + mesh.fade[c]) / 3 <= 0.2) continue;
      if (mesh.paint[a] !== 0 || mesh.paint[b] !== 0 || mesh.paint[c] !== 0) continue;

      let u = rnd(), w = rnd();
      if (u + w > 1) { u = 1 - u; w = 1 - w; }
      const s = 1 - u - w;
      const x = s * v[3 * a] + u * v[3 * b] + w * v[3 * c];
      const y = s * v[3 * a + 1] + u * v[3 * b + 1] + w * v[3 * c + 1];
      const z = s * v[3 * a + 2] + u * v[3 * b + 2] + w * v[3 * c + 2];

      let radius = r0;
      for (const d of dense) {
        const dx = x - d[0], dy = y - d[1], dz = z - d[2];
        const q = (dx * dx + dy * dy + dz * dz) / (d[3] * d[3] * 2.2);
        if (q < 1) radius = Math.min(radius, r0 * (0.66 + 0.34 * q));
      }

      const ci = cell(x), cj = cell(y), ck = cell(z);
      let ok = true;
      outer: for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          for (let k = -1; k <= 1; k++) {
            const list = grid.get(key(ci + i, cj + j, ck + k));
            if (!list) continue;
            for (const o of list) {
              const dx = x - px[o], dy = y - py[o], dz = z - pz[o];
              const m = Math.min(radius, pr[o]);
              if (dx * dx + dy * dy + dz * dz < m * m) {
                ok = false;
                break outer;
              }
            }
          }
        }
      }
      if (!ok) continue;

      const idx = px.length;
      px.push(x); py.push(y); pz.push(z); pr.push(radius);
      ta.push(a); tb.push(b); tc.push(c);
      wa.push(u); wb.push(w);
      fd.push(s * mesh.fade[a] + u * mesh.fade[b] + w * mesh.fade[c]);
      const gk = key(ci, cj, ck);
      let bucket = grid.get(gk);
      if (!bucket) { bucket = []; grid.set(gk, bucket); }
      bucket.push(idx);
    }

    const n = px.length;
    this.count = n;
    this.triA = new Int32Array(ta);
    this.triB = new Int32Array(tb);
    this.triC = new Int32Array(tc);
    this.wu = new Float32Array(wa);
    this.wv = new Float32Array(wb);
    this.fade = new Float32Array(fd);

    // Connect each node to its 5 nearest neighbours within 2.15 * r0
    const limit = 2.15 * r0;
    const limitSq = limit * limit;
    const gcell = (x) => Math.floor(x / limit);
    const reach = new Map();
    for (let i = 0; i < n; i++) {
      const rk = key(gcell(px[i]), gcell(py[i]), gcell(pz[i]));
      let list = reach.get(rk);
      if (!list) { list = []; reach.set(rk, list); }
      list.push(i);
    }

    const pairSet = new Set();
    const edgeList = [];
    const nearIdx = new Int32Array(5);
    const nearD = new Float32Array(5);

    for (let i = 0; i < n; i++) {
      nearIdx.fill(-1);
      nearD.fill(1e9);
      const ci = gcell(px[i]), cj = gcell(py[i]), ck = gcell(pz[i]);
      for (let a = -1; a <= 1; a++) {
        for (let b = -1; b <= 1; b++) {
          for (let c = -1; c <= 1; c++) {
            const list = reach.get(key(ci + a, cj + b, ck + c));
            if (!list) continue;
            for (const j of list) {
              if (j === i) continue;
              const dx = px[i] - px[j], dy = py[i] - py[j], dz = pz[i] - pz[j];
              const d = dx * dx + dy * dy + dz * dz;
              if (d >= nearD[4]) continue;
              let p = 4;
              while (p > 0 && nearD[p - 1] > d) {
                nearD[p] = nearD[p - 1];
                nearIdx[p] = nearIdx[p - 1];
                p--;
              }
              nearD[p] = d;
              nearIdx[p] = j;
            }
          }
        }
      }
      for (let k = 0; k < 5; k++) {
        const j = nearIdx[k];
        if (j < 0 || nearD[k] > limitSq) continue;
        const lo = Math.min(i, j), hi = Math.max(i, j);
        const pk = lo * 65536 + hi;
        if (!pairSet.has(pk)) {
          pairSet.add(pk);
          edgeList.push(lo, hi);
        }
      }
    }

    this.edges = new Int32Array(edgeList);
  }
}

// ── CircuitTraces (Port of CircuitTraces.kt — Electronic PCB Tracks on Face) ──

export class CircuitTraces {
  constructor(mesh) {
    const v = mesh.verts;
    const nrm = mesh.normals;
    const f = mesh.faces;
    const nF = mesh.faceCount;

    // Usable front skin triangles (away from hair, neck end, eyes, and mouth)
    const usable = [];
    for (let t = 0; t < nF; t++) {
      const a = f[3 * t], b = f[3 * t + 1], c = f[3 * t + 2];
      if (mesh.faceGroup[t] > 1.5 || mesh.faceGroup[t] < 0.5) continue;
      if (mesh.paint[a] !== 0 || mesh.paint[b] !== 0 || mesh.paint[c] !== 0) continue;
      if ((mesh.fade[a] + mesh.fade[b] + mesh.fade[c]) / 3 < 0.55) continue;
      if ((nrm[3 * a + 2] + nrm[3 * b + 2] + nrm[3 * c + 2]) / 3 < 0.28) continue;
      usable.push(t);
    }

    // Exclusion zones around the eyes and lips
    const avoid = [];
    for (const name of ['eye_l', 'eye_r', 'lips_out']) {
      const ring = mesh.landmarks[name];
      if (!ring || !ring.length) continue;
      let x = 0, y = 0;
      for (const i of ring) { x += v[3 * i]; y += v[3 * i + 1]; }
      x /= ring.length; y /= ring.length;
      let rad = 0;
      for (const i of ring) {
        rad = Math.max(rad, Math.hypot(v[3 * i] - x, v[3 * i + 1] - y));
      }
      avoid.push([x, y, rad * (name === 'lips_out' ? 1.35 : 1.55)]);
    }

    // Spatial grid over the front plane of the face
    const cell = 0.06;
    const cellOf = (x) => Math.floor(x / cell);
    const key = (i, j) => ((i + 1024) << 12) | ((j + 1024) & 0xfff);
    const grid = new Map();
    for (const t of usable) {
      const a = f[3 * t], b = f[3 * t + 1], c = f[3 * t + 2];
      const x0 = Math.min(v[3 * a], v[3 * b], v[3 * c]);
      const x1 = Math.max(v[3 * a], v[3 * b], v[3 * c]);
      const y0 = Math.min(v[3 * a + 1], v[3 * b + 1], v[3 * c + 1]);
      const y1 = Math.max(v[3 * a + 1], v[3 * b + 1], v[3 * c + 1]);
      for (let i = cellOf(x0); i <= cellOf(x1); i++) {
        for (let j = cellOf(y0); j <= cellOf(y1); j++) {
          const gk = key(i, j);
          let list = grid.get(gk);
          if (!list) { list = []; grid.set(gk, list); }
          list.push(t);
        }
      }
    }

    let hitTri = 0, hitU = 0, hitV = 0;
    const locate = (x, y) => {
      let bestZ = -1e9, found = false;
      const list = grid.get(key(cellOf(x), cellOf(y)));
      if (!list) return false;
      for (const t of list) {
        const a = f[3 * t], b = f[3 * t + 1], c = f[3 * t + 2];
        const ax = v[3 * a], ay = v[3 * a + 1];
        const bx = v[3 * b], by = v[3 * b + 1];
        const cx = v[3 * c], cy = v[3 * c + 1];
        const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
        if (Math.abs(d) < 1e-9) continue;
        const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
        const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
        const l3 = 1 - l1 - l2;
        if (l1 < 0 || l2 < 0 || l3 < 0) continue;
        const z = l1 * v[3 * a + 2] + l2 * v[3 * b + 2] + l3 * v[3 * c + 2];
        if (z > bestZ) {
          bestZ = z;
          found = true;
          hitTri = t;
          hitU = l2;
          hitV = l3;
        }
      }
      return found;
    };

    const pitch = 0.036;
    const dirs = [
      [1, 0], [1, 1], [0, 1], [-1, 1],
      [-1, 0], [-1, -1], [0, -1], [1, -1],
    ];

    let seed = 2026;
    const nextFloat = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const nextInt = (min, maxExcl) => min + Math.floor(nextFloat() * (maxExcl - min));
    const nextBoolean = () => nextFloat() < 0.5;

    const taken = new Set();
    const pTri = [], pU = [], pV = [];
    const sA = [], sB = [], sTrack = [], sAlong = [];
    const padList = [];
    const kinds = [];
    let tracks = 0;

    const free = (ix, iy) => {
      if (taken.has(key(ix, iy))) return false;
      const x = ix * pitch, y = iy * pitch;
      for (const a of avoid) {
        if ((x - a[0]) * (x - a[0]) + (y - a[1]) * (y - a[1]) < a[2] * a[2]) return false;
      }
      return true;
    };

    for (let attempt = 0; attempt < 6000; attempt++) {
      const sx = nextInt(-25, 26);
      const sy = nextInt(-27, 24);
      if (!free(sx, sy) || !locate(sx * pitch, sy * pitch)) continue;
      let dir = nextInt(0, 8);
      const target = nextInt(9, 34);
      const cells = [[sx, sy]];
      let cx = sx, cy = sy;
      while (cells.length < target) {
        const r = nextFloat();
        if (cells.length > 2 && r < 0.26) {
          dir = (dir + (nextBoolean() ? 1 : 7)) % 8; // 45-degree turn
        } else if (cells.length > 2 && r < 0.31) {
          dir = (dir + (nextBoolean() ? 2 : 6)) % 8; // 90-degree turn
        }
        const nx = cx + dirs[dir][0], ny = cy + dirs[dir][1];
        if (!free(nx, ny) || !locate(nx * pitch, ny * pitch)) break;
        cells.push([nx, ny]);
        cx = nx;
        cy = ny;
      }
      if (cells.length < 6) continue;
      const first = pTri.length;
      for (const c of cells) {
        taken.add(key(c[0], c[1]));
        locate(c[0] * pitch, c[1] * pitch);
        pTri.push(hitTri);
        pU.push(hitU);
        pV.push(hitV);
      }
      const n = cells.length;
      for (let k = 0; k < n - 1; k++) {
        sA.push(first + k);
        sB.push(first + k + 1);
        sTrack.push(tracks);
        sAlong.push(k / (n - 1));
      }
      padList.push(first, first + n - 1);
      kinds.push(nextFloat() < 0.40 ? 1 : 0);
      tracks++;
    }

    const n = pTri.length;
    this.count = n;
    this.triA = new Int32Array(n);
    this.triB = new Int32Array(n);
    this.triC = new Int32Array(n);
    this.wu = new Float32Array(pU);
    this.wv = new Float32Array(pV);
    this.fade = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = f[3 * pTri[i]], b = f[3 * pTri[i] + 1], c = f[3 * pTri[i] + 2];
      this.triA[i] = a;
      this.triB[i] = b;
      this.triC[i] = c;
      const s = 1 - pU[i] - pV[i];
      this.fade[i] = s * mesh.fade[a] + pU[i] * mesh.fade[b] + pV[i] * mesh.fade[c];
    }

    this.segments = new Int32Array(sA.length * 2);
    for (let k = 0; k < sA.length; k++) {
      this.segments[2 * k] = sA[k];
      this.segments[2 * k + 1] = sB[k];
    }
    this.segTrack = new Int32Array(sTrack);
    this.segAlong = new Float32Array(sAlong);
    this.pads = new Int32Array(padList);
    this.trackKind = new Int32Array(kinds);
    this.trackCount = tracks;
  }
}

// ── FiberHair (Port of FiberHair.kt — Optical Fibre Hologram Hair) ──────────

export class FiberHair {
  constructor(mesh) {
    this.mesh = mesh;
    this.rows = mesh.lockRows;
    this.locks = Math.min(mesh.lockCount || 0, 1100);
    this.perLock = 3;
    const total = this.locks * this.perLock;
    this.across = new Float32Array(total);
    this.amp = new Float32Array(total);
    this.freq = new Float32Array(total);
    this.phase = new Float32Array(total);
    this.pulse = new Uint8Array(total);
    this.spark = new Uint8Array(total);

    for (let l = 0; l < this.locks; l++) {
      for (let f = 0; f < this.perLock; f++) {
        const i = l * this.perLock + f;
        const h = Math.imul(l * 31 + f * 1039, -1640531535);
        this.across[i] = -0.9 + (1.8 * (f + 0.5 + 0.4 * (((h >>> 8) & 0xff) / 255 - 0.5))) / this.perLock;
        this.amp[i] = 0.10 + (0.16 * ((h >>> 16) & 0xff)) / 255;
        this.freq[i] = 1.0 + (1.8 * ((h >>> 4) & 0xff)) / 255;
        this.phase[i] = (((h >>> 12) & 0xff) / 255) * 6.2832;
        this.pulse[i] = ((h >>> 24) & 7) < 3 ? 1 : 0;
        this.spark[i] = ((h >>> 20) & 7) < 3 ? 1 : 0;
      }
    }
  }
}

// ── StructureEdges (Port of StructureEdges from AvatarRenderer.kt) ──────────

export class StructureEdges {
  constructor(a, b, face0, face1, crease) {
    this.a = a;
    this.b = b;
    this.face0 = face0;
    this.face1 = face1;
    this.crease = crease;
    this.count = a.length;
  }

  static build(mesh) {
    const f = mesh.faces;
    const v = mesh.verts;
    const nrm = mesh.normals;
    const nF = mesh.faceCount;
    const fn = new Float32Array(nF * 3);

    for (let t = 0; t < nF; t++) {
      const i = f[3 * t], j = f[3 * t + 1], k = f[3 * t + 2];
      const abx = v[3 * j] - v[3 * i], aby = v[3 * j + 1] - v[3 * i + 1], abz = v[3 * j + 2] - v[3 * i + 2];
      const acx = v[3 * k] - v[3 * i], acy = v[3 * k + 1] - v[3 * i + 1], acz = v[3 * k + 2] - v[3 * i + 2];
      let x = aby * acz - abz * acy;
      let y = abz * acx - abx * acz;
      let z = abx * acy - aby * acx;
      const len = Math.max(Math.hypot(x, y, z), 1e-9);
      x /= len; y /= len; z /= len;
      const rx = nrm[3 * i] + nrm[3 * j] + nrm[3 * k];
      const ry = nrm[3 * i + 1] + nrm[3 * j + 1] + nrm[3 * k + 1];
      const rz = nrm[3 * i + 2] + nrm[3 * j + 2] + nrm[3 * k + 2];
      if (x * rx + y * ry + z * rz < 0) { x = -x; y = -y; z = -z; }
      fn[3 * t] = x; fn[3 * t + 1] = y; fn[3 * t + 2] = z;
    }

    const first = new Map();
    const ea = [], eb = [], e0 = [], e1 = [];
    const addEdge = (u, w, t) => {
      const lo = Math.min(u, w), hi = Math.max(u, w);
      const key = lo * 131072 + hi;
      const idx = first.get(key);
      if (idx === undefined) {
        first.set(key, ea.length);
        ea.push(lo); eb.push(hi); e0.push(t); e1.push(-1);
      } else {
        e1[idx] = t;
      }
    };

    for (let t = 0; t < nF; t++) {
      const i = f[3 * t], j = f[3 * t + 1], k = f[3 * t + 2];
      addEdge(i, j, t);
      addEdge(j, k, t);
      addEdge(k, i, t);
    }

    const CREASE_MIN_COS = 0.93;
    const crease = new Float32Array(ea.length);
    for (let e = 0; e < ea.length; e++) {
      const t0 = e0[e], t1 = e1[e];
      if (t1 < 0) {
        crease[e] = 1.0;
      } else {
        const dot = fn[3 * t0] * fn[3 * t1] + fn[3 * t0 + 1] * fn[3 * t1 + 1] + fn[3 * t0 + 2] * fn[3 * t1 + 2];
        crease[e] = dot < CREASE_MIN_COS ? Math.max(0.05, Math.min(1, (CREASE_MIN_COS - dot) / 0.6)) : 0;
      }
    }

    return new StructureEdges(
      new Int32Array(ea),
      new Int32Array(eb),
      new Int32Array(e0),
      new Int32Array(e1),
      crease
    );
  }
}
