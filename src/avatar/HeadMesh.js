// Direct port of HeadMesh.kt, AvatarFaces.kt, HairStyle.kt, HairShade.kt, CharacterMesh.kt,
// StructureEdges, NetworkWeb.kt, CircuitTraces.kt, and FiberHair.kt from Jarvis-Android.

export const JAW_PIVOT = [0, 0.06, -0.34];
export const JAW_MAX = 0.15;

export const HOLO_SKIN = 5;
export const HOLO_HAIR_SKIN = 6;
export const BLUE_HOLO_SKIN = 7;

export const HAIR_SHADES = [
  { id: 'black', fr: 'Noir', en: 'Black', browColour: 0xff161414, colours: { body: 0x1c1918, root: 0x0b0a0a, tip: 0x35302e, grey: 0, greyRgb: 0x8e8b86 } },
  { id: 'dark_brown', fr: 'Brun foncé', en: 'Dark brown', browColour: 0xff281b14, colours: { body: 0x2e1f16, root: 0x140d09, tip: 0x543a29, grey: 0, greyRgb: 0x8e8b86 } },
  { id: 'brown', fr: 'Châtain', en: 'Brown', browColour: 0xff3d291d, colours: { body: 0x543826, root: 0x24170f, tip: 0x8c6244, grey: 0, greyRgb: 0x8e8b86 } },
  { id: 'chestnut', fr: 'Acajou', en: 'Chestnut', browColour: 0xff4a241b, colours: { body: 0x6b2f22, root: 0x2e120c, tip: 0xa8523d, grey: 0, greyRgb: 0x8e8b86 } },
  { id: 'blonde', fr: 'Blond', en: 'Blonde', browColour: 0xff6e5434, colours: { body: 0xc8a262, root: 0x6e5229, tip: 0xf0d59c, grey: 0, greyRgb: 0x8e8b86 } },
  { id: 'red', fr: 'Roux', en: 'Red', browColour: 0xff682a16, colours: { body: 0x9e3c1c, root: 0x4a190a, tip: 0xd96e3c, grey: 0, greyRgb: 0x8e8b86 } },
  { id: 'salt_pepper', fr: 'Poivre et sel', en: 'Salt & pepper', browColour: 0xff3c3936, colours: { body: 0x4a4744, root: 0x242220, tip: 0x8a8782, grey: 0.45, greyRgb: 0x9c9994 } },
  { id: 'white', fr: 'Blanc', en: 'White', browColour: 0xff7a7772, colours: { body: 0xcfccc7, root: 0x8e8b86, tip: 0xf2f0ec, grey: 0, greyRgb: 0x8e8b86 } },
  { id: 'blue', fr: 'Bleu', en: 'Blue', browColour: 0xff16294d, colours: { body: 0x1e3a6e, root: 0x0c1a36, tip: 0x4a78c0, grey: 0, greyRgb: 0x8e8b86 } },
  { id: 'pink', fr: 'Rose', en: 'Pink', browColour: 0xff7a344b, colours: { body: 0xc0607e, root: 0x6a2a40, tip: 0xf0a0b8, grey: 0, greyRgb: 0x8e8b86 } },
  { id: 'purple', fr: 'Violet', en: 'Purple', browColour: 0xff3b1b52, colours: { body: 0x5a2a7a, root: 0x2a1040, tip: 0x9a6ac0, grey: 0, greyRgb: 0x8e8b86 } },
];

export const BUILT_IN_FACES = [
  {
    id: 'lea',
    label: 'Léa',
    gender: 'female',
    asset: './assets/avatar/head_mesh_lea.bin',
    browColour: 0xff1a1e27,
    fibres: false,
    cartoon: false,
    browScale: 0.65,
    lashScale: 1.35,
    androidLook: true,
    halo: true,
    lipTint: 0.7,
    character: null,
    credit: 'Sculpt basé sur "Female Head Sculpt" (Aconear, CC BY 4.0)',
    hairColours: { body: 0x1f2533, root: 0x0b0d13, tip: 0x5b7496, grey: 0, greyRgb: 0x8e8b86 },
  },
  {
    id: 'marc',
    label: 'Marc',
    gender: 'male',
    asset: './assets/avatar/head_mesh_marc.bin',
    browColour: 0xff2b2928,
    fibres: true,
    cartoon: false,
    browScale: 1.0,
    lashScale: 1.0,
    androidLook: false,
    halo: false,
    lipTint: 0.3,
    character: null,
    credit: 'Sculpt basé sur "Realistic Male Head" (Ouail, CC BY 4.0)',
    hairColours: { body: 0x33302f, root: 0x151313, tip: 0x4e4a46, grey: 0.12, greyRgb: 0x77736e },
  },
  {
    id: 'adam',
    label: 'Adam',
    gender: 'male',
    asset: './assets/avatar/head_mesh.bin',
    browColour: 0xff1f1614,
    fibres: false,
    cartoon: false,
    browScale: 1.0,
    lashScale: 1.0,
    androidLook: false,
    halo: false,
    lipTint: 0.5,
    character: './assets/avatar/characters/adam',
    credit: '"Casual Confidence" by restore50 (CC BY 4.0)',
    hairColours: { body: 0x483121, root: 0x20150e, tip: 0x8e6c48, grey: 0, greyRgb: 0x8e8b86 },
  },
  {
    id: 'mei',
    label: 'Mei',
    gender: 'female',
    asset: './assets/avatar/head_mesh.bin',
    browColour: 0xff1f1614,
    fibres: false,
    cartoon: false,
    browScale: 1.0,
    lashScale: 1.0,
    androidLook: false,
    halo: false,
    lipTint: 0.7,
    character: './assets/avatar/characters/mei',
    credit: '"Girl Wearing Traditional Clothing V4" by Fadly.W (CC BY 4.0)',
    hairColours: { body: 0x1f2533, root: 0x0b0d13, tip: 0x5b7496, grey: 0, greyRgb: 0x8e8b86 },
  },
  {
    id: 'classic',
    label: 'Classique',
    gender: 'female',
    asset: './assets/avatar/head_mesh.bin',
    browColour: 0xff34241c,
    fibres: true,
    cartoon: false,
    browScale: 1.0,
    lashScale: 1.0,
    androidLook: false,
    halo: false,
    lipTint: 0.7,
    character: null,
    credit: '',
    hairColours: { body: 0x483121, root: 0x20150e, tip: 0x8e6c48, grey: 0, greyRgb: 0x8e8b86 },
  },
  {
    id: 'cartoon',
    label: 'Dessin animé',
    gender: 'female',
    asset: './assets/avatar/head_mesh.bin',
    browColour: 0xff1f1614,
    fibres: false,
    cartoon: true,
    browScale: 1.0,
    lashScale: 1.0,
    androidLook: false,
    halo: false,
    lipTint: 0.7,
    character: null,
    credit: '',
    hairColours: { body: 0x483121, root: 0x20150e, tip: 0x8e6c48, grey: 0, greyRgb: 0x8e8b86 },
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

  static parse(arrayBuffer) {
    const dv = new DataView(arrayBuffer);
    if (
      arrayBuffer.byteLength <= 40 ||
      dv.getUint8(0) !== 0x4a || // 'J'
      dv.getUint8(1) !== 0x48 || // 'H'
      dv.getUint8(2) !== 0x4d || // 'M'
      dv.getUint8(3) !== 0x32    // '2'
    ) {
      throw new Error('Not a valid JHM2 head mesh file');
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
      for (let i = 0; i < n; i++) out[i] = readFloat();
      return out;
    };
    const readInts = (n) => {
      const out = new Int32Array(n);
      for (let i = 0; i < n; i++) out[i] = readInt();
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

    const verts = readFloats(nv * 3);
    const normals = readFloats(nv * 3);
    const jaw = readFloats(nv);
    const brow = readFloats(nv);
    const lips = readFloats(nv);
    const fade = readFloats(nv);
    const faceGroup = readFloats(nf);
    const faces = readInts(nf * 3);
    const edges = readInts(ne * 2);

    const rings = readInt();
    const landmarks = {};
    for (let r = 0; r < rings; r++) {
      const count = readInt();
      landmarks[LANDMARK_NAMES[r] || `ring_${r}`] = readInts(count);
    }

    const paint = readInts(nv);
    const lid = readFloats(nv);
    const lipMask = readFloats(nv);
    const rimCount = readInt();
    const eyelidRim = readInts(rimCount * 3);
    const mouthUpper = readInts(readInt());
    const mouthLower = readInts(readInt());
    const eyes = readInt();
    const eyeFirst = new Int32Array(eyes);
    const eyeCount = new Int32Array(eyes);
    const eyeCentre = new Float32Array(eyes * 3);
    for (let e = 0; e < eyes; e++) {
      eyeFirst[e] = readInt();
      eyeCount[e] = readInt();
      eyeCentre[3 * e] = readFloat();
      eyeCentre[3 * e + 1] = readFloat();
      eyeCentre[3 * e + 2] = readFloat();
    }
    const lockFirst = readInt();
    const lockCount = readInt();
    const lockRows = readInt();

    return new HeadMesh({
      verts,
      normals,
      jaw,
      brow,
      lips,
      fade,
      faceGroup,
      faces,
      edges,
      landmarks,
      lipCentre,
      nHead,
      nFace,
      crown,
      bottom,
      paint,
      lid,
      lipMask,
      eyeFirst,
      eyeCount,
      eyeCentre,
      eyelidRim,
      mouthUpper,
      mouthLower,
      lockFirst,
      lockCount,
      lockRows,
      hairSway: null,
    });
  }

  copyWith({ paint = this.paint, hairSway = this.hairSway } = {}) {
    return new HeadMesh({
      ...this,
      paint,
      hairSway,
    });
  }
}

// ── HairShade recolouring ────────────────────────────────────────────────────

function lum(rgb) {
  return 0.2126 * ((rgb >> 16) & 0xff) + 0.7152 * ((rgb >> 8) & 0xff) + 0.0722 * (rgb & 0xff);
}

function mixRgb(a, b, t) {
  const f = Math.max(0, Math.min(1, t));
  let out = 0;
  for (const s of [16, 8, 0]) {
    const x = (a >> s) & 0xff;
    const y = (b >> s) & 0xff;
    const v = Math.max(0, Math.min(255, (x + (y - x) * f) | 0));
    out |= v << s;
  }
  return out;
}

export function recolourHair(head, from, to) {
  const lb = Math.max(lum(from.body), 1);
  const kr = lum(from.root) / lb;
  const kt = Math.max(lum(from.tip) / lb, 1.05);
  const paint = new Int32Array(head.paint);
  for (let i = 0; i < paint.length; i++) {
    const p = paint[i];
    const a = (p >>> 24) & 0xff;
    if (p === 0 || a === 0xff) continue;
    const k = lum(p & 0xffffff) / lb;
    const rgb =
      k <= 1
        ? mixRgb(to.root, to.body, (k - kr) / Math.max(1 - kr, 0.05))
        : mixRgb(to.body, to.tip, (k - 1) / (kt - 1));
    paint[i] = (a << 24) | rgb;
  }
  return head.copyWith({ paint });
}

// ── HairStyle (JHR1 binary parser & radial fitOn) ────────────────────────────

function smooth(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function strandColour(key, height, c) {
  const ch = (rgb, s) => (rgb >> s) & 0xff;
  const grey = ((key * 37) % 256) / 256 < (c.grey || 0);
  const tone = 0.86 + (0.24 * key) / 255;
  const rootMix = 0.45 + 0.55 * Math.max(0, Math.min(1, height * 8));
  const tipMix = Math.max(0, Math.min(1, (height - 0.45) * 1.2)) * 0.35;
  let rgb = 0;
  for (const s of [16, 8, 0]) {
    let v;
    if (grey) {
      v = ch(c.greyRgb || 0x8e8b86, s) * (0.85 + 0.15 * height);
    } else {
      const m = ch(c.root, s) + (ch(c.body, s) - ch(c.root, s)) * rootMix;
      v = m + (ch(c.tip, s) - m) * tipMix;
    }
    v = Math.max(0, Math.min(255, Math.round(v * tone)));
    rgb |= v << s;
  }
  return (254 << 24) | rgb;
}

function gridOf(ux, uy, uz, az, el) {
  const a = ((Math.atan2(ux, uz) + Math.PI) / (2 * Math.PI)) * az;
  const e = ((Math.asin(Math.max(-1, Math.min(1, uy))) + Math.PI / 2) / Math.PI) * (el - 1);
  return [a, e];
}

function sampleGrid(grid, a, e, az, el) {
  const a0 = ((Math.floor(a) % az) + az) % az;
  const a1 = (a0 + 1) % az;
  const fa = a - Math.floor(a);
  const ec = Math.max(0, Math.min(el - 1.0001, e));
  const e0 = Math.floor(ec);
  const e1 = Math.min(el - 1, e0 + 1);
  const fe = ec - e0;
  const r00 = grid[e0 * az + a0];
  const r01 = grid[e0 * az + a1];
  const r10 = grid[e1 * az + a0];
  const r11 = grid[e1 * az + a1];
  return (r00 * (1 - fa) + r01 * fa) * (1 - fe) + (r10 * (1 - fa) + r11 * fa) * fe;
}

function skullCentre(verts, faces, tris) {
  let minX = 1e9, maxX = -1e9, maxY = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const v = faces[3 * t + k];
      const y = verts[3 * v + 1];
      if (y > maxY) maxY = y;
      if (y < -0.55) continue;
      const x = verts[3 * v];
      const z = verts[3 * v + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }
  return new Float32Array([(minX + maxX) / 2, maxY - 0.88, (minZ + maxZ) / 2]);
}

function radiusMap(verts, faces, tris, centre, az, el) {
  const grid = new Float32Array(el * az);
  for (const t of tris) {
    const a = faces[3 * t], b = faces[3 * t + 1], c = faces[3 * t + 2];
    const pts = [
      [verts[3 * a], verts[3 * a + 1], verts[3 * a + 2]],
      [verts[3 * b], verts[3 * b + 1], verts[3 * b + 2]],
      [verts[3 * c], verts[3 * c + 1], verts[3 * c + 2]],
      [(verts[3 * a] + verts[3 * b]) / 2, (verts[3 * a + 1] + verts[3 * b + 1]) / 2, (verts[3 * a + 2] + verts[3 * b + 2]) / 2],
      [(verts[3 * b] + verts[3 * c]) / 2, (verts[3 * b + 1] + verts[3 * c + 1]) / 2, (verts[3 * b + 2] + verts[3 * c + 2]) / 2],
      [(verts[3 * c] + verts[3 * a]) / 2, (verts[3 * c + 1] + verts[3 * a + 1]) / 2, (verts[3 * c + 2] + verts[3 * a + 2]) / 2],
    ];
    for (const p of pts) {
      const dx = p[0] - centre[0], dy = p[1] - centre[1], dz = p[2] - centre[2];
      const r = Math.hypot(dx, dy, dz);
      if (r < 1e-6) continue;
      const [ga, ge] = gridOf(dx / r, dy / r, dz / r, az, el);
      const ia = ((Math.round(ga) % az) + az) % az;
      const ie = Math.max(0, Math.min(el - 1, Math.round(ge)));
      const idx = ie * az + ia;
      if (r > grid[idx]) grid[idx] = r;
    }
  }
  // Fill any empty cells from neighbors
  for (let pass = 0; pass < 6; pass++) {
    for (let e = 0; e < el; e++) {
      for (let a = 0; a < az; a++) {
        const idx = e * az + a;
        if (grid[idx] > 0) continue;
        let sum = 0, cnt = 0;
        for (const [de, da] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const ne = Math.max(0, Math.min(el - 1, e + de));
          const na = (a + da + az) % az;
          const v = grid[ne * az + na];
          if (v > 0) { sum += v; cnt++; }
        }
        if (cnt > 0) grid[idx] = sum / cnt;
      }
    }
  }
  return grid;
}

export class HairStyle {
  constructor(positions, key, faces, centre, radius, az, el) {
    this.positions = positions;
    this.key = key;
    this.faces = faces;
    this.centre = centre;
    this.radius = radius;
    this.az = az;
    this.el = el;
    this.vertexCount = (positions.length / 3) | 0;
    this.faceCount = (faces.length / 3) | 0;
  }

  static parse(arrayBuffer) {
    const dv = new DataView(arrayBuffer);
    if (
      dv.getUint8(0) !== 0x4a || // 'J'
      dv.getUint8(1) !== 0x48 || // 'H'
      dv.getUint8(2) !== 0x52 || // 'R'
      dv.getUint8(3) !== 0x31    // '1'
    ) {
      throw new Error('Not a JHR1 hairstyle file');
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
    const positions = new Float32Array(3 * nv);
    for (let i = 0; i < 3 * nv; i++) {
      const u16 = dv.getUint16(pos, true);
      pos += 2;
      positions[i] = lo[i % 3] + u16 * step[i % 3];
    }
    const key = new Uint8Array(arrayBuffer, pos, nv);
    pos += nv + ((4 - (nv % 4)) % 4);
    const faces = new Int32Array(3 * nf);
    for (let i = 0; i < 3 * nf; i++) {
      faces[i] = dv.getUint16(pos, true);
      pos += 2;
    }
    return new HairStyle(positions, key, faces, centre, radius, az, el);
  }

  fitOn(head, colours, lift = 0.012) {
    const skull = [];
    for (let t = 0; t < head.faceCount; t++) {
      if (head.faceGroup[t] > 1.5) continue;
      const a = head.faces[3 * t], b = head.faces[3 * t + 1], c = head.faces[3 * t + 2];
      if (head.paint[a] !== 0 || head.paint[b] !== 0 || head.paint[c] !== 0) continue;
      skull.push(t);
    }
    const ct = skullCentre(head.verts, head.faces, skull);
    const rt = radiusMap(head.verts, head.faces, skull, ct, this.az, this.el);
    const n = this.vertexCount;
    const out = new Float32Array(3 * n);
    const heightOver = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      const x = this.positions[3 * i] - this.centre[0];
      const y = this.positions[3 * i + 1] - this.centre[1];
      const z = this.positions[3 * i + 2] - this.centre[2];
      const r = Math.max(Math.hypot(x, y, z), 1e-9);
      const ux = x / r, uy = y / r, uz = z / r;
      const [a, e] = gridOf(ux, uy, uz, this.az, this.el);
      const h = Math.max(r - sampleGrid(this.radius, a, e, this.az, this.el), lift);
      const nr = sampleGrid(rt, a, e, this.az, this.el) + h;
      out[3 * i] = ct[0] + ux * nr;
      out[3 * i + 1] = ct[1] + uy * nr;
      out[3 * i + 2] = ct[2] + uz * nr;
      heightOver[i] = h;
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

// ── CharacterMesh (JCH1 / JCH2 textured characters: Adam & Mei) ─────────────

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

    const mouthPts = meta.mouth?.points || [];
    const mouth = new Float32Array(3 * mouthPts.length);
    for (let k = 0; k < mouthPts.length; k++) {
      mouth[3 * k] = mouthPts[k][0];
      mouth[3 * k + 1] = mouthPts[k][1];
      mouth[3 * k + 2] = mouthPts[k][2];
    }

    return new CharacterMesh({
      label: meta.label || 'Character',
      credit: meta.credit || '',
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
      eyes: meta.eyes || [],
      mouth,
      mouthColour: meta.mouth?.inner ?? 0xff2a1014,
      teeth: meta.mouth?.teeth ?? true,
      lashColour: meta.lash ?? 0xff1a1210,
      ambient: meta.ambient ?? 0.55,
      cut: meta.cut ?? -1.9,
      top: meta.top ?? 1.0,
      scale: meta.scale ?? 1.0,
      pivot: meta.pivot || [0, -1, -0.15],
      jawPivot: meta.jaw_pivot || JAW_PIVOT,
      gazeReach: meta.gaze ?? 0.0,
      browLift: meta.brow_lift ?? 0.06,
    });
  }
}

// ── NetworkWeb (Hologram constellation nodes & edges on the head mesh) ──────

export class NetworkWeb {
  constructor(mesh) {
    const f = mesh.faces;
    const v = mesh.verts;
    let seed = 104729;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const ta = [], tb = [], tc = [], wa = [], wb = [], fd = [], px = [], py = [], pz = [];
    for (let t = 0; t < mesh.faceCount; t += 2) {
      const a = f[3 * t], b = f[3 * t + 1], c = f[3 * t + 2];
      const fAvg = (mesh.fade[a] + mesh.fade[b] + mesh.fade[c]) / 3;
      if (fAvg <= 0.25) continue;
      if (mesh.paint[a] !== 0 || mesh.paint[b] !== 0 || mesh.paint[c] !== 0) continue;
      let u = rnd(), w = rnd();
      if (u + w > 1) { u = 1 - u; w = 1 - w; }
      const s = 1 - u - w;
      px.push(s * v[3 * a] + u * v[3 * b] + w * v[3 * c]);
      py.push(s * v[3 * a + 1] + u * v[3 * b + 1] + w * v[3 * c + 1]);
      pz.push(s * v[3 * a + 2] + u * v[3 * b + 2] + w * v[3 * c + 2]);
      ta.push(a); tb.push(b); tc.push(c);
      wa.push(u); wb.push(w);
      fd.push(fAvg);
      if (ta.length >= 900) break;
    }

    this.count = ta.length;
    this.triA = new Int32Array(ta);
    this.triB = new Int32Array(tb);
    this.triC = new Int32Array(tc);
    this.wu = new Float32Array(wa);
    this.wv = new Float32Array(wb);
    this.fade = new Float32Array(fd);

    const edges = [];
    const maxD2 = 0.085 * 0.085;
    for (let i = 0; i < this.count; i++) {
      let connected = 0;
      for (let j = i + 1; j < this.count; j++) {
        const dx = px[i] - px[j], dy = py[i] - py[j], dz = pz[i] - pz[j];
        if (dx * dx + dy * dy + dz * dz < maxD2) {
          edges.push(i, j);
          if (++connected >= 4) break;
        }
      }
    }
    this.edges = new Int32Array(edges);
  }
}
