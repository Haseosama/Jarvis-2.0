// Complete port of AvatarRenderer.kt (including StructureEdges, NetworkWeb,
// CircuitTraces, FiberHair, drawEtched, drawHalo, drawEyes, drawFeatures) and GlowReactor from Jarvis-Android.

import {
  NetworkWeb,
  CircuitTraces,
  FiberHair,
  StructureEdges,
} from './HeadMesh.js';

const CAM_D = 4.6;
const LUT_N = 192;
const MIN_ALPHA = 0.05;
const BROW_HAIRS = 160;
const LID_COLUMNS = 9;
const HAIR_FIBRE_LOCKS = 600;
const FIBRES_PER_LOCK = 8;

const ANDROID_SKIN = 0xffcdd2d8;
const ANDROID_GLOW = 0xff35c9ff;
export const DEEP_BLUE = 0xff0c2160;
const GOLD_CIRCUIT = 0xffffb640;
const BLUE_HOT = 0xff8fc1ff;

const SKIN_TONES = [0xf1c9a8, 0xd9a47c, 0xb07a54, 0x7a4e36, 0x69b4f0];
const LIP_TONES = [0xd9707f, 0xc02836, 0x8e3a6b, 0xe8735a];
const EYE_BACK_PAINT = 0xff2b1f1c;
const CLASSIC_TO_LEA_IRIS = new Map([
  [0xff16324f, 0xff0e4a36],
  [0xff3f7ca6, 0xff3dbe8c],
  [0xff1f4560, 0xff16553f],
]);

function argb(a, r, g, b) {
  return ((a & 0xff) << 24) | ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}

function mixInt(base, other, f) {
  const t = Math.max(0, Math.min(1, f));
  const r = (((base >> 16) & 0xff) + (((other >> 16) & 0xff) - ((base >> 16) & 0xff)) * t) | 0;
  const g = (((base >> 8) & 0xff) + (((other >> 8) & 0xff) - ((base >> 8) & 0xff)) * t) | 0;
  const b = ((base & 0xff) + ((other & 0xff) - (base & 0xff)) * t) | 0;
  return argb(255, r, g, b);
}

function intToCss(col, alphaOverride = null) {
  const r = (col >> 16) & 0xff;
  const g = (col >> 8) & 0xff;
  const b = col & 0xff;
  const a = alphaOverride !== null ? alphaOverride : ((col >>> 24) & 0xff) / 255;
  if (a >= 0.995) return `rgb(${r},${g},${b})`;
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

function smooth01(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function traceChain(ctx, xs, ys, chain, reverse = false) {
  if (!chain || chain.length === 0) return;
  const first = reverse ? chain.length - 1 : 0;
  const step = reverse ? -1 : 1;
  ctx.moveTo(xs[chain[first]], ys[chain[first]]);
  for (let i = first + step; reverse ? i >= 0 : i < chain.length; i += step) {
    const vi = chain[i];
    ctx.lineTo(xs[vi], ys[vi]);
  }
}

export class AvatarRenderer {
  constructor(mesh) {
    this.mesh = mesh;
    this.nV = mesh.vertexCount;
    this.nF = mesh.faceCount;
    this.rimMask = new Uint8Array(this.nV);
    // Skin around each eye (front of the face only): its facets may turn sideways inside the eye-corner pits.
    const eyeCentres = mesh.eyeCentre || [];
    for (let e = 0; e < eyeCentres.length / 3; e++) {
      for (let i = 0; i < Math.min(this.nV, mesh.nHead || this.nV); i++) {
        const dx = mesh.verts[3 * i] - eyeCentres[3 * e];
        const dy = mesh.verts[3 * i + 1] - eyeCentres[3 * e + 1];
        if (mesh.verts[3 * i + 2] > 0.15 && dx * dx + dy * dy < 0.26 * 0.26) this.rimMask[i] = 1;
      }
    }
    this.classicEyeMask = new Uint8Array(this.nV);
    for (let e = 0; e < (mesh.eyeFirst?.length || 0); e++) {
      const start = mesh.eyeFirst[e];
      const end = Math.min(this.nV, start + mesh.eyeCount[e]);
      this.classicEyeMask.fill(1, start, end);
    }
    this.xs = new Float32Array(this.nV);
    this.ys = new Float32Array(this.nV);
    this.faceColor = new Int32Array(this.nF);
    this.faceFront = new Uint8Array(this.nF);
    this.faceZ = new Float32Array(this.nF);
    this.order = new Int32Array(this.nF);
    this.eyeFaces = new Int32Array(Math.max(1, this.nF));
    this.lut = new Int32Array(LUT_N);
    this.lutKey = '';

    // High-density polygon web
    this.web = new NetworkWeb(mesh);
    this.wx = new Float32Array(this.web.count);
    this.wy = new Float32Array(this.web.count);
    this.wz = new Float32Array(this.web.count);

    // Structural edges & scanner sweep
    this.structure = StructureEdges.build(mesh);
    this.scanY = 0;

    // Electronic PCB circuit tracks & pads (lazy-initialized on first draw)
    this._circuits = null;
    this.cx = null;
    this.cy = null;
    this.cz = null;
    this.etchKeep = null;

    // Optical-fibre hologram hair
    this._fiberHair = null;

    // Pre-generated eyebrow hairs & eyelid curves (exact port of AvatarRenderer.kt)
    this.browHairs = this._initBrowHairs();
    this.lidCurves = this._initLidCurves();
    this.lashRnd = this._initLashRnd();

    // Renderer settings updated before draw
    this.skin = 5; // 0 = web, 1..4 = skin tones, 5 = blue hologram skin
    this.holo = true;
    this.holoHair = false;
    this.blueMix = true;
    this.fibreOverlay = true;
    this.classicEyes = false;
    this.browColour = 0xff34241c;
    this.browScale = 1.0;
    this.lashScale = 1.0;
    this.androidLook = false;
    this.lipTint = 0.7;
    this.halo = false;
    this.lips = 0;
    this.showCircuits = true;
    this.closeUp = false;
  }

  get faceCenterX() {
    const centres = this.mesh.eyeCentre;
    if (!this.classicEyes || !centres || centres.length < 6) return 0;
    return 0.5 * (centres[0] + centres[3]);
  }

  get circuits() {
    if (!this._circuits) {
      this._circuits = new CircuitTraces(this.mesh);
      this.cx = new Float32Array(this._circuits.count);
      this.cy = new Float32Array(this._circuits.count);
      this.cz = new Float32Array(this._circuits.count);
    }
    return this._circuits;
  }

  get fiberHair() {
    if (!this._fiberHair) {
      this._fiberHair = new FiberHair(this.mesh);
    }
    return this._fiberHair;
  }

  _initBrowHairs() {
    let seed = 11;
    const rnd = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const list = [];
    for (let i = 0; i < BROW_HAIRS; i++) {
      list.push({
        u: rnd(),
        off: rnd() * 2 - 1,
        len: 0.7 + 0.6 * rnd(),
        jitter: (rnd() - 0.5) * 0.4,
      });
    }
    return list;
  }

  _initLashRnd() {
    const out = new Float32Array(40);
    for (let i = 0; i < 40; i++) {
      const h = Math.imul(23 + i, -1640531535) >>> 0;
      out[i] = (h & 0xffff) / 65535;
    }
    return out;
  }

  _initLidCurves() {
    const mesh = this.mesh;
    const eyes = mesh.eyeFirst ? mesh.eyeFirst.length : 0;
    const rim = mesh.eyelidRim || new Int32Array(0);
    const curves = [];
    for (let e = 0; e < eyes; e++) {
      const pair = [];
      for (let flag = 0; flag < 2; flag++) {
        const set = new Set();
        for (let k = 0; k < (rim.length / 3) | 0; k++) {
          if (rim[3 * k + 2] !== flag) continue;
          for (const v of [rim[3 * k], rim[3 * k + 1]]) {
            const x = mesh.verts[3 * v];
            let bestEye = 0;
            let bestDist = Infinity;
            for (let ei = 0; ei < eyes; ei++) {
              const d = Math.abs(mesh.eyeCentre[3 * ei] - x);
              if (d < bestDist) { bestDist = d; bestEye = ei; }
            }
            if (bestEye === e) set.add(v);
          }
        }
        const verts = Int32Array.from(set);
        let lo = Infinity, hi = -Infinity;
        for (const v of verts) {
          const x = mesh.verts[3 * v];
          if (x < lo) lo = x;
          if (x > hi) hi = x;
        }
        if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
        const span = Math.max(hi - lo, 1e-4);
        const column = new Int32Array(verts.length);
        for (let i = 0; i < verts.length; i++) {
          column[i] = Math.max(0, Math.min(LID_COLUMNS - 1, Math.floor(((mesh.verts[3 * verts[i]] - lo) / span) * (LID_COLUMNS - 1))));
        }
        pair.push({ verts, column });
      }
      curves.push(pair);
    }
    return curves;
  }

  buildLut(bg, primary) {
    const key = `${bg}_${primary}`;
    if (key === this.lutKey) return;
    this.lutKey = key;
    for (let i = 0; i < LUT_N; i++) {
      this.lut[i] = mixInt(bg, primary, ((i + 0.5) / LUT_N) * 0.36);
    }
  }

  vertexColour(vi, nrm, amp, flat, primaryColor, bgColor) {
    const mesh = this.mesh;
    let vx = nrm[3 * vi], vy = nrm[3 * vi + 1], vz = nrm[3 * vi + 2];
    const vl = Math.max(Math.hypot(vx, vy, vz), 1e-9);
    vx /= vl; vy /= vl; vz /= vl;
    const vlam = Math.max(0, Math.min(1, vx * -0.55 + vy * 0.5 + vz * 0.52));
    const lit = (rgb, k) =>
      argb(
        255,
        Math.min(255, Math.max(0, (((rgb >> 16) & 0xff) * k) | 0)),
        Math.min(255, Math.max(0, (((rgb >> 8) & 0xff) * k) | 0)),
        Math.min(255, Math.max(0, ((rgb & 0xff) * k) | 0))
      );

    const sourcePaint = mesh.paint[vi];
    const isHairPaint = sourcePaint !== 0 && ((sourcePaint >>> 24) & 0xff) < 255;
    let pnt = isHairPaint ? 0 : sourcePaint;
    if (!this.holo && this.classicEyes && this.classicEyeMask?.[vi]) {
      pnt = CLASSIC_TO_LEA_IRIS.get(pnt >>> 0) ?? pnt;
    }
    if (pnt !== 0 && ((pnt >>> 24) & 0xff) < 255) {
      const cover = Math.max(0, Math.min(1, ((pnt >>> 24) & 0xff) / 254));
      const diffuse = 0.42 + 0.8 * vlam;
      const hairLit = lit(0xff000000 | (pnt & 0x00ffffff), diffuse);
      const spec = Math.pow(Math.max(0, Math.min(1, vx * -0.22 + vy * 0.28 + vz * 0.93)), 12);
      const sheen = (spec * 50) | 0;
      let hair = argb(
        255,
        Math.min(255, ((hairLit >> 16) & 0xff) + sheen),
        Math.min(255, ((hairLit >> 8) & 0xff) + sheen),
        Math.min(255, (hairLit & 0xff) + ((sheen * 0.9) | 0))
      );
      if (this.holoHair) hair = lit(0xff0d1b2b, 0.55 + 0.9 * vlam);
      if (cover > 0.995) return hair;
      const skinRgb = this.androidLook && !this.holo ? ANDROID_SKIN : 0xff000000 | SKIN_TONES[Math.max(0, Math.min(4, this.skin - 1))];
      const ks = Math.max(0.15, Math.min(1.15, 0.3 + 0.85 * vlam + 0.1 * Math.max(0, vz))) * (0.94 + 0.12 * amp);
      return mixInt(lit(skinRgb, ks), hair, cover);
    }

    if (pnt !== 0) {
      let base = this.skin > 0 ? pnt : mixInt(pnt, primaryColor, 0.22);
      if (this.classicEyes && this.classicEyeMask?.[vi]) {
        // Brighter, cleaner whites of the eyes (iris and pupil colours are left as they are).
        const sr = (pnt >> 16) & 0xff, sg = (pnt >> 8) & 0xff, sb = pnt & 0xff;
        if (Math.min(sr, sg, sb) > 0xa8 && Math.max(sr, sg, sb) - Math.min(sr, sg, sb) < 0x20) {
          base = mixInt(pnt, 0xfff6f4ef, 0.55);
          return lit(base, 0.8 + 0.3 * vlam);
        }
      }
      return lit(base, 0.62 + 0.42 * vlam);
    }

    const lipW = mesh.lipMask[vi];
    if (this.skin === 0) {
      if (lipW > 0.02 && this.lips > 0) {
        return mixInt(flat, lit(0xff000000 | LIP_TONES[this.lips - 1], 0.75 + 0.3 * vlam), lipW);
      }
      return flat;
    }

    const k = Math.max(0.15, Math.min(1.15, 0.3 + 0.85 * vlam + 0.1 * Math.max(0, vz))) * (0.94 + 0.12 * amp);
    const skinRgb = this.androidLook && !this.holo ? ANDROID_SKIN : 0xff000000 | SKIN_TONES[Math.max(0, Math.min(4, this.skin - 1))];
    let c = lit(skinRgb, k);
    if (!this.holo) {
      const spec = Math.pow(Math.max(0, Math.min(1, vx * -0.22 + vy * 0.28 + vz * 0.93)), 30);
      const sheen = (spec * 26) | 0;
      const blush = this.androidLook ? 0 : (vlam * vlam * 9) | 0;
      c = argb(
        255,
        Math.min(255, ((c >> 16) & 0xff) + sheen + blush),
        Math.min(255, ((c >> 8) & 0xff) + ((sheen * 0.9) | 0) + ((blush * 0.35) | 0)),
        Math.min(255, (c & 0xff) + ((sheen * 0.8) | 0))
      );
    }

    if (lipW > 0.02) {
      const lipRgb =
        this.lips > 0
          ? 0xff000000 | LIP_TONES[this.lips - 1]
          : this.androidLook
          ? 0xff8e7c87
          : mixInt(skinRgb, 0xffb04a5a, this.lipTint);
      c = mixInt(c, lit(lipRgb, 0.8 + 0.3 * vlam), lipW);
    }

    if (this.holo) {
      const edge = Math.pow(1 - Math.max(0, Math.min(1, vz)), 2.4);
      if (this.blueMix) {
        const hollow = mixInt(lit(c, 1.16), DEEP_BLUE, 0.55 * (1 - vlam));
        c = mixInt(hollow, DEEP_BLUE, 0.8 * edge);
      } else {
        c = mixInt(lit(c, 1.16), mixInt(primaryColor, 0xffffffff, 0.45), 0.62 * edge);
      }
      return mixInt(bgColor, c, Math.max(0, Math.min(1, mesh.fade[vi] * 1.9)));
    }

    const fv = Math.max(0, Math.min(1, mesh.fade[vi] * mesh.fade[vi]));
    return mixInt(bgColor, c, fv);
  }

  draw(ctx, avatar, cx, cy, r, primary, accent, bg) {
    avatar.pose();
    this.scanY = avatar.scan || 0;
    const amp = avatar.glow;
    const v = avatar.pv;
    const nrm = avatar.pn;
    const mesh = this.mesh;
    const strokePx = Math.max(0.45, r / 170);

    // 1. Radial aura (brighter on close-up miniature PiP, matching AvatarView.kt)
    const ar = r * (this.closeUp ? 1.35 : 1.95);
    const prR = (primary >> 16) & 0xff, prG = (primary >> 8) & 0xff, prB = primary & 0xff;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, ar);
    const auraBase = this.closeUp ? 85 : 34;
    grad.addColorStop(0, `rgba(${prR},${prG},${prB},${((auraBase + 66 * amp) / 255).toFixed(3)})`);
    grad.addColorStop(0.42, `rgba(${prR},${prG},${prB},${(((auraBase * 0.55) + 40 * amp) / 255).toFixed(3)})`);
    grad.addColorStop(1, `rgba(${prR},${prG},${prB},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, ar, 0, Math.PI * 2);
    ctx.fill();

    // 2. Multi-ring breathing halo (Léa)
    if (this.halo && !this.closeUp) {
      this.drawHalo(ctx, cx, cy, r, amp, avatar.time);
    }

    // 3. Ambient particles remain in non-holographic styles only.
    this.drawDriftingParticles(ctx, cx, cy, r, avatar.time, primary, strokePx);

    // 4. Project 3D vertices to screen space, centering Classic on its eye line.
    const faceCenterX = this.faceCenterX;
    for (let i = 0; i < this.nV; i++) {
      const w = Math.max(CAM_D - v[3 * i + 2], 0.35);
      const k = (CAM_D / w) * r;
      this.xs[i] = cx + (v[3 * i] - faceCenterX) * k;
      this.ys[i] = cy - v[3 * i + 1] * k;
    }

    this.buildLut(bg, primary);

    // 5. Shade & depth-sort visible triangles
    let count = 0;
    const f = mesh.faces;
    const fade = mesh.fade;
    this.faceFront.fill(0);
    // Near front view the eyeballs are drawn in their own pass, clipped to the lid opening,
    // instead of being depth-sorted with the faceted skin (which left ragged white teeth).
    const eyePass = this.classicEyes && this.faceEyePass(avatar);
    const eyeMask = this.classicEyeMask;
    let eyeCount = 0;

    for (let t = 0; t < this.nF; t++) {
      const a = f[3 * t], b = f[3 * t + 1], c = f[3 * t + 2];
      const abx = v[3 * b] - v[3 * a], aby = v[3 * b + 1] - v[3 * a + 1], abz = v[3 * b + 2] - v[3 * a + 2];
      const acx = v[3 * c] - v[3 * a], acy = v[3 * c + 1] - v[3 * a + 1], acz = v[3 * c + 2] - v[3 * a + 2];
      let nx = aby * acz - abz * acy;
      let ny = abz * acx - abx * acz;
      let nz = abx * acy - aby * acx;
      const len = Math.max(Math.hypot(nx, ny, nz), 1e-9);
      nx /= len; ny /= len; nz /= len;
      const rx = nrm[3 * a] + nrm[3 * b] + nrm[3 * c];
      const ry = nrm[3 * a + 1] + nrm[3 * b + 1] + nrm[3 * c + 1];
      const rz = nrm[3 * a + 2] + nrm[3 * b + 2] + nrm[3 * c + 2];
      if (nx * rx + ny * ry + nz * rz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      if (nz < 0 && mesh.faceGroup[t] > 2.25) { nx = -nx; ny = -ny; nz = -nz; }
      // Skin facets in the pit at the eye corners turn sideways; keep them so no hole shows the background.
      const rimFace = eyePass && (this.rimMask[a] & this.rimMask[b] & this.rimMask[c]) !== 0;
      if (nz > 0.015 || (rimFace && nz > -0.95)) this.faceFront[t] = 1;
      else continue;

      const area = Math.abs((this.xs[b] - this.xs[a]) * (this.ys[c] - this.ys[a]) - (this.xs[c] - this.xs[a]) * (this.ys[b] - this.ys[a]));
      if (area <= 1e-4) continue;

      // Hair surfaces are omitted in every skin mode; dedicated fibre strokes remain a separate overlay.
      if (mesh.faceGroup[t] > 1.5) continue;
      const fadeAvg = (fade[a] + fade[b] + fade[c]) / 3;
      const cutoff = this.skin > 0 ? 0.15 : 0.4;
      if (fadeAvg < cutoff) continue;

      const fres = Math.pow(Math.max(0, Math.min(2, 1 - nz)), 1.7);
      const lam = Math.max(0, Math.min(1, nx * -0.55 + ny * 0.5 + nz * 0.52));
      let bright = 0.26 + 0.2 * fres + 0.66 * Math.pow(lam, 1.05);
      bright *= (fade[a] * fade[a] + fade[b] * fade[b] + fade[c] * fade[c]) / 3;
      bright *= 0.88 + 0.24 * amp;

      let col = this.lut[Math.max(0, Math.min(LUT_N - 1, (bright * LUT_N) | 0))];
      const painted = mesh.paint[a] !== 0 || mesh.paint[b] !== 0 || mesh.paint[c] !== 0;
      const onLips = this.lips > 0 && (mesh.lipMask[a] > 0.02 || mesh.lipMask[b] > 0.02 || mesh.lipMask[c] > 0.02);

      if (this.skin > 0 || painted || onLips) {
        const ca = this.vertexColour(a, nrm, amp, col, primary, bg);
        const cb = this.vertexColour(b, nrm, amp, col, primary, bg);
        const cc = this.vertexColour(c, nrm, amp, col, primary, bg);
        col = mixInt(mixInt(ca, cb, 0.5), cc, 0.333);
      } else {
        const rim = Math.max(0, Math.min(0.14, fres * fres * 0.14));
        if (rim > 0.01) col = mixInt(col, accent, rim);
      }

      // Close-up miniature brightness lift (CLOSE_UP_PAINT from AvatarView.kt)
      if (this.closeUp) {
        const cr = Math.min(255, (((col >> 16) & 0xff) * 1.35 + 18) | 0);
        const cg = Math.min(255, (((col >> 8) & 0xff) * 1.35 + 18) | 0);
        const cb = Math.min(255, ((col & 0xff) * 1.35 + 18) | 0);
        col = argb(255, cr, cg, cb);
      }

      this.faceColor[t] = col;
      const g = mesh.faceGroup[t];
      const zBias = g > 1.5 ? 0.05 : g > 0.5 ? 0 : -1000;
      this.faceZ[t] = (v[3 * a + 2] + v[3 * b + 2] + v[3 * c + 2]) / 3 + zBias;
      if (eyePass && eyeMask[a] && eyeMask[b] && eyeMask[c]) {
        // The flat dark disc inside each globe shows through at the lid corners: the sclera underlay replaces it.
        if ((mesh.paint[a] >>> 0) === EYE_BACK_PAINT && (mesh.paint[b] >>> 0) === EYE_BACK_PAINT && (mesh.paint[c] >>> 0) === EYE_BACK_PAINT) continue;
        this.eyeFaces[eyeCount++] = t;
        continue;
      }
      this.order[count++] = t;
    }

    const activeOrder = this.order.subarray(0, count);
    const faceZ = this.faceZ;
    activeOrder.sort((t1, t2) => faceZ[t1] - faceZ[t2]);

    // 6. Draw 3D surface triangles
    const expand = Math.min(0.55, strokePx * 0.5);
    for (let k = 0; k < count; k++) this.fillFace(ctx, activeOrder[k], expand);

    // 6b. Eyeballs, clipped to the actual eyelid opening
    if (eyePass && eyeCount > 0) this.drawEyes(ctx, eyeCount, expand, nrm, amp, primary, bg, strokePx, activeOrder);

    // 7. Structural Polygon Edges & Energy Scanner Sweep (on Web and Hologram modes)
    if (this.skin === 0 || this.holo) {
      this.drawWire(ctx, v, amp, primary, bg, strokePx);
    }

    // 8. High-Density Poisson-Disc Polygon Web & Twinkling Nodes
    this.drawWeb(ctx, nrm, amp, primary, strokePx, avatar.time);

    // 9. Electronic Circuit Tracks, Running Light Pulses & Terminal Pads (optional via showCircuits)
    if (this.showCircuits) {
      if (this.androidLook && this.skin > 0 && !this.holo) {
        this.drawEtched(ctx, nrm, amp, strokePx, avatar.time);
      } else {
        this.drawCircuits(ctx, nrm, amp, primary, bg, strokePx, avatar.time);
      }
    }

    // 10. Scalp hair strands and fibre locks are intentionally omitted in every avatar style.

    // 11. Facial features (160 brow hairs, smooth lid curves, 15+7 lashes, catchlights, lip chains)
    this.drawFeatures(ctx, avatar, r, primary, strokePx);
  }

  drawDriftingParticles(ctx, cx, cy, r, time, primary, strokePx) {
    if (this.holo) return;
    const prR = (primary >> 16) & 0xff, prG = (primary >> 8) & 0xff, prB = primary & 0xff;
    const particleCount = this.closeUp ? 10 : 26;
    for (let k = 0; k < particleCount; k++) {
      const h = (Math.imul(k, -1640531535) >>> 8) & 0xffff;
      const ang = (h % 628) / 100 + 0.05 * time * (k % 2 === 0 ? 1 : -1);
      const dist = r * (1.15 + 0.85 * ((((h / 7) | 0) % 100) / 100));
      const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * (0.8 + (h % 5) * 0.3) + k));
      ctx.fillStyle = `rgba(${prR},${prG},${prB},${((150 * tw) / 255).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(
        cx + Math.cos(ang) * dist * 0.8,
        cy + Math.sin(ang) * dist * 1.05,
        (1.2 + (h % 3)) * Math.min(1, strokePx),
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
  }

  // ── Structural Wireframe & Scanner Sweep (AvatarRenderer.kt drawWire) ───────

  faceEyePass(avatar) {
    return Math.abs(avatar.yaw || 0) < 0.4 && Math.abs(avatar.pitch || 0) < 0.45;
  }

  fillFace(ctx, t, expand) {
    const f = this.mesh.faces;
    const a = f[3 * t], b = f[3 * t + 1], d = f[3 * t + 2];
    const x0 = this.xs[a], y0 = this.ys[a];
    const x1 = this.xs[b], y1 = this.ys[b];
    const x2 = this.xs[d], y2 = this.ys[d];
    const tcx = (x0 + x1 + x2) / 3, tcy = (y0 + y1 + y2) / 3;

    ctx.fillStyle = intToCss(this.faceColor[t], 1);
    ctx.beginPath();
    const dx0 = x0 - tcx, dy0 = y0 - tcy, g0 = expand / Math.max(Math.abs(dx0) + Math.abs(dy0), expand);
    const dx1 = x1 - tcx, dy1 = y1 - tcy, g1 = expand / Math.max(Math.abs(dx1) + Math.abs(dy1), expand);
    const dx2 = x2 - tcx, dy2 = y2 - tcy, g2 = expand / Math.max(Math.abs(dx2) + Math.abs(dy2), expand);
    ctx.moveTo(x0 + dx0 * g0, y0 + dy0 * g0);
    ctx.lineTo(x1 + dx1 * g1, y1 + dy1 * g1);
    ctx.lineTo(x2 + dx2 * g2, y2 + dy2 * g2);
    ctx.closePath();
    ctx.fill();
  }

  // Closed outline of one eye's lid opening (upper lid inner->outer, lower lid back), in screen space.
  _lidOpening(e) {
    const pair = this.lidCurves[e];
    if (!pair) return null;
    const up = this._lidPoints(pair[1]);
    const low = this._lidPoints(pair[0]);
    if (up.ux.length < 2 || low.ux.length < 2) return null;
    const pts = [];
    for (let i = 0; i < up.ux.length; i++) pts.push([up.ux[i], up.uy[i]]);
    for (let i = low.ux.length - 1; i >= 0; i--) pts.push([low.ux[i], low.uy[i]]);
    // Both lids meet at the corners: snap the free ends of the lower lid to the upper lid.
    const n = up.ux.length, m = low.ux.length;
    pts[n] = [up.ux[n - 1] * 0.5 + low.ux[m - 1] * 0.5, up.uy[n - 1] * 0.5 + low.uy[m - 1] * 0.5];
    pts[pts.length - 1] = [up.ux[0] * 0.5 + low.ux[0] * 0.5, up.uy[0] * 0.5 + low.uy[0] * 0.5];
    pts[0] = pts[pts.length - 1];
    pts[n - 1] = pts[n];
    // Slightly overscan the opening so the corners reach the real lid rim (no gap showing the background).
    let mx = 0, my = 0;
    for (const [x, y] of pts) { mx += x; my += y; }
    mx /= pts.length; my /= pts.length;
    for (const q of pts) {
      q[0] = mx + (q[0] - mx) * 1.07;
      q[1] = my + (q[1] - my) * 1.05;
    }
    return pts;
  }

  // The skin facets right under the lower lid are lit unevenly and read as white teeth. Paint a soft band of the
  // surrounding skin colour over them (the eyeball and the lashes are drawn on top afterwards).
  _smoothLowerLid(ctx, e, minX, maxX, skinOrder) {
    const low = this._lidPoints(this.lidCurves[e][0]);
    const n = low.ux.length;
    if (n < 2 || !skinOrder) return;
    const wpx = Math.max(maxX - minX, 1);
    let mx = 0, my = 0;
    for (let i = 0; i < n; i++) { mx += low.ux[i]; my += low.uy[i]; }
    mx /= n; my /= n;
    const px = mx, py = my + 0.26 * wpx, rad = 0.09 * wpx;
    const f = this.mesh.faces;
    let sr = 0, sg = 0, sb = 0, cnt = 0;
    for (let k = 0; k < skinOrder.length; k++) {
      const t = skinOrder[k];
      if (this.eyeFaceMark && this.eyeFaceMark[t]) continue;
      const a = f[3 * t], b = f[3 * t + 1], c = f[3 * t + 2];
      const cx = (this.xs[a] + this.xs[b] + this.xs[c]) / 3;
      const cy = (this.ys[a] + this.ys[b] + this.ys[c]) / 3;
      if (Math.abs(cx - px) > rad * 2.2 || Math.abs(cy - py) > rad) continue;
      const col = this.faceColor[t];
      sr += (col >> 16) & 0xff; sg += (col >> 8) & 0xff; sb += col & 0xff; cnt++;
    }
    if (cnt < 3) return;
    const base = argb(255, (sr / cnt) | 0, (sg / cnt) | 0, (sb / cnt) | 0);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const widths = [0.17, 0.13, 0.09, 0.05];
    for (const wf of widths) {
      ctx.strokeStyle = intToCss(base, 0.62);
      ctx.lineWidth = wf * wpx;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = low.ux[i], y = low.uy[i] + 0.06 * wpx;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // Soft skin-coloured shadow in the pits at both eye corners, so no gap shows the background there.
  _fillCornerPits(ctx, outline, wpx, skinOrder) {
    if (!skinOrder || outline.length < 4) return;
    let lo = outline[0], hi = outline[0];
    for (const q of outline) { if (q[0] < lo[0]) lo = q; if (q[0] > hi[0]) hi = q; }
    const f = this.mesh.faces;
    const radius = 0.11 * wpx;
    for (const corner of [lo, hi]) {
      let sr = 0, sg = 0, sb = 0, cnt = 0;
      for (let k = 0; k < skinOrder.length; k++) {
        const t = skinOrder[k];
        const a = f[3 * t], b = f[3 * t + 1], c = f[3 * t + 2];
        const cx = (this.xs[a] + this.xs[b] + this.xs[c]) / 3;
        const cy = (this.ys[a] + this.ys[b] + this.ys[c]) / 3;
        if (Math.hypot(cx - corner[0], cy - corner[1]) > radius * 1.8) continue;
        const col = this.faceColor[t];
        sr += (col >> 16) & 0xff; sg += (col >> 8) & 0xff; sb += col & 0xff; cnt++;
      }
      if (cnt < 3) continue;
      const shade = 0.82;
      const base = argb(255, ((sr / cnt) * shade) | 0, ((sg / cnt) * shade) | 0, ((sb / cnt) * shade) | 0);
      const grad = ctx.createRadialGradient(corner[0], corner[1], 0, corner[0], corner[1], radius);
      grad.addColorStop(0, intToCss(base, 1));
      grad.addColorStop(0.55, intToCss(base, 0.85));
      grad.addColorStop(1, intToCss(base, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(corner[0], corner[1], radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawEyes(ctx, eyeCount, expand, nrm, amp, primary, bg, strokePx, skinOrder) {
    const mesh = this.mesh;
    const eyes = mesh.eyeFirst.length;
    for (let e = 0; e < eyes; e++) {
      const outline = this._lidOpening(e);
      if (!outline) continue;
      const first = mesh.eyeFirst[e], last = first + mesh.eyeCount[e];
      let minX = Infinity, maxX = -Infinity;
      for (const [x] of outline) { if (x < minX) minX = x; if (x > maxX) maxX = x; }

      this._smoothLowerLid(ctx, e, minX, maxX, skinOrder);
      this._fillCornerPits(ctx, outline, maxX - minX, skinOrder);

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(outline[0][0], outline[0][1]);
      for (let i = 1; i < outline.length; i++) ctx.lineTo(outline[i][0], outline[i][1]);
      ctx.closePath();
      ctx.clip();

      // Sclera underlay: fills the corners the spherical globe never reaches.
      let vi = first;
      for (let i = first; i < last; i++) {
        if ((mesh.paint[i] & 0x00ffffff) === 0xe3ded5) { vi = i; break; }
      }
      const sclera = this.vertexColour(vi, nrm, amp, 0xffd9d3ca, primary, bg);
      const dark = mixInt(sclera, 0xff1a2330, 0.55);
      const grad = ctx.createLinearGradient(minX, 0, maxX, 0);
      grad.addColorStop(0, intToCss(dark, 1));
      grad.addColorStop(0.2, intToCss(sclera, 1));
      grad.addColorStop(0.8, intToCss(sclera, 1));
      grad.addColorStop(1, intToCss(dark, 1));
      ctx.fillStyle = grad;
      ctx.fillRect(minX - 2, -1e4, maxX - minX + 4, 2e4);

      const list = [];
      for (let k = 0; k < eyeCount; k++) {
        const t = this.eyeFaces[k];
        if (mesh.faces[3 * t] >= first && mesh.faces[3 * t] < last) list.push(t);
      }
      const z = this.faceZ;
      list.sort((a, b) => z[a] - z[b]);
      for (const t of list) this.fillFace(ctx, t, expand);

      // Smooth, softly lit lower lid (waterline) instead of the faceted skin edge.
      const low = this._lidPoints(this.lidCurves[e][0]);
      if (low.ux.length >= 2) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = intToCss(mixInt(sclera, 0xffe2a79e, 0.45), 0.7);
        ctx.lineWidth = strokePx * 2.6;
        ctx.beginPath();
        ctx.moveTo(low.ux[0], low.uy[0]);
        for (let i = 1; i < low.ux.length; i++) ctx.lineTo(low.ux[i], low.uy[i]);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawWire(ctx, v, amp, primary, bg, strokePx) {
    const st = this.structure;
    const scan = this.scanY;
    const gain = (0.80 + 0.45 * amp) * (this.holo ? 0.45 : 0.85);
    const buckets = [[], [], [], []];

    for (let k = 0; k < st.count; k++) {
      const f0 = st.face0[k], f1 = st.face1[k];
      // Hair polygons are hidden in every style, so do not draw their structural edges either.
      if (this.mesh.faceGroup[f0] > 1.5 || (f1 >= 0 && this.mesh.faceGroup[f1] > 1.5)) continue;
      const front0 = this.faceFront[f0] === 1;
      const front1 = f1 >= 0 ? this.faceFront[f1] === 1 : front0;
      if (!front0 && !front1) continue;
      const i0 = st.a[k], i1 = st.b[k];
      const silhouette = front0 !== front1;
      const fadeE = 0.5 * (this.mesh.fade[i0] + this.mesh.fade[i1]);
      let alpha = silhouette ? 0.55 : st.crease[k] > 0 ? 0.14 + 0.38 * st.crease[k] : 0;

      // Energy scanner sweep
      const ym = 0.5 * (v[3 * i0 + 1] + v[3 * i1 + 1]);
      const d = (ym - scan) / 0.13;
      alpha += 0.34 * Math.exp(-d * d);
      alpha *= fadeE * gain;
      if (alpha <= MIN_ALPHA) continue;
      const bkt = Math.max(0, Math.min(3, (alpha * 4) | 0));
      buckets[bkt].push(i0, i1);
    }

    const baseCol = mixInt(bg, primary, 0.52);
    ctx.lineWidth = Math.max(0.7, strokePx * 0.75);
    for (let b = 0; b < 4; b++) {
      const arr = buckets[b];
      if (!arr.length) continue;
      const a = Math.min(1, (b + 0.5) / 4) * 0.8;
      ctx.strokeStyle = intToCss(mixInt(baseCol, primary, a), a);
      ctx.beginPath();
      for (let i = 0; i < arr.length; i += 2) {
        const i0 = arr[i], i1 = arr[i + 1];
        ctx.moveTo(this.xs[i0], this.ys[i0]);
        ctx.lineTo(this.xs[i1], this.ys[i1]);
      }
      ctx.stroke();
    }
  }

  // ── High-Density Polygon Web & Twinkling Nodes (AvatarRenderer.kt drawWeb) ──

  drawWeb(ctx, nrm, amp, primary, strokePx, t) {
    if (this.skin > 0 && !this.holo) return;
    const w = this.web;
    const gain = (0.85 + 0.5 * amp) * (this.holo ? 0.38 : 1.0);

    for (let i = 0; i < w.count; i++) {
      const a = w.triA[i], b = w.triB[i], c = w.triC[i];
      const u = w.wu[i], q = w.wv[i], s = 1 - u - q;
      this.wx[i] = s * this.xs[a] + u * this.xs[b] + q * this.xs[c];
      this.wy[i] = s * this.ys[a] + u * this.ys[b] + q * this.ys[c];
      this.wz[i] = s * nrm[3 * a + 2] + u * nrm[3 * b + 2] + q * nrm[3 * c + 2];
    }

    // 1. Web polygon edges (4 Fresnel buckets)
    const lineBuckets = [[], [], [], []];
    const e = w.edges;
    for (let k = 0; k < e.length; k += 2) {
      const i = e[k], j = e[k + 1];
      const nzi = this.wz[i], nzj = this.wz[j];
      if (nzi < 0.05 && nzj < 0.05) continue;
      // On solid hologram skin, keep the polygon web focused around the contour and relief
      if (this.holo && nzi > 0.72 && nzj > 0.72) continue;
      const fres = Math.pow(Math.max(0, Math.min(1, 1 - 0.5 * (nzi + nzj))), 2.4);
      let a = (0.30 + 0.55 * fres) * 0.5 * (w.fade[i] * w.fade[i] + w.fade[j] * w.fade[j]) * gain;
      if (nzi < 0.15 || nzj < 0.15) a *= 0.6;
      if (a <= MIN_ALPHA) continue;
      const bk = Math.max(0, Math.min(3, (a * 4) | 0));
      lineBuckets[bk].push(i, j);
    }

    ctx.lineWidth = Math.max(0.75, strokePx * 0.6);
    for (let bk = 0; bk < 4; bk++) {
      const arr = lineBuckets[bk];
      if (!arr.length) continue;
      const alpha = ((bk + 0.5) / 4) * (this.holo ? 0.48 : 0.92);
      ctx.strokeStyle = intToCss(primary, alpha);
      ctx.beginPath();
      for (let m = 0; m < arr.length; m += 2) {
        const i = arr[m], j = arr[m + 1];
        ctx.moveTo(this.wx[i], this.wy[i]);
        ctx.lineTo(this.wx[j], this.wy[j]);
      }
      ctx.stroke();
    }

    // Hologram styles keep the polygon lines but omit every isolated blue node.
    if (this.holo) return;

    // 2. Twinkling polygon nodes for the network-only style
    const nodeBuckets = [[], [], []];
    const nodeKeep = this.holo ? [0, 0.22, 0.45] : [0.10, 0.24, 0.46];
    const closeUpDensity = this.closeUp ? 0.82 : 1;
    for (let i = 0; i < w.count; i++) {
      const nz = this.wz[i];
      if (nz < 0 || w.fade[i] < 0.25) continue;
      const fres = Math.pow(Math.max(0, Math.min(1, 1 - nz)), 2.4);
      const tw = 0.8 + 0.2 * Math.sin(t * 2.1 + i * 1.7);
      const br = (0.55 + 0.9 * fres) * tw * w.fade[i] * w.fade[i];
      const hash = (Math.imul(i, -1640531535) >>> 16) & 0xff;
      const bk = br > 0.85 || hash > 236 ? 2 : br > 0.5 ? 1 : 0;
      if (this.holo && (bk < 1 || nz > 0.65)) continue;
      const sample = (Math.imul(i + 1, 0x45d9f3b) >>> 8) & 0xff;
      if (sample > nodeKeep[bk] * closeUpDensity * 255) continue;
      nodeBuckets[bk].push(i);
    }

    const radii = [0.7, 1.1, 1.7];
    const alphas = [0.62, 0.82, 1.0];
    for (let bk = 0; bk < 3; bk++) {
      const arr = nodeBuckets[bk];
      if (!arr.length) continue;
      const col = bk === 2 ? mixInt(primary, 0xffffffff, 0.55) : primary;
      ctx.fillStyle = intToCss(col, alphas[bk] * (this.holo ? 0.65 : 1.0));
      const rad = radii[bk] * Math.max(0.42, Math.min(1.5, strokePx * 0.85));
      ctx.beginPath();
      for (let m = 0; m < arr.length; m++) {
        const i = arr[m];
        ctx.moveTo(this.wx[i] + rad, this.wy[i]);
        ctx.arc(this.wx[i], this.wy[i], rad, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }

  // ── Electronic Circuit Tracks, Pulses & Pads (AvatarRenderer.kt drawCircuits) ──

  drawCircuits(ctx, nrm, amp, primary, bg, strokePx, t) {
    const c = this.circuits;
    if (!c || c.count === 0) return;

    for (let i = 0; i < c.count; i++) {
      const a = c.triA[i], b = c.triB[i], d = c.triC[i];
      const u = c.wu[i], q = c.wv[i], w = 1 - u - q;
      this.cx[i] = w * this.xs[a] + u * this.xs[b] + q * this.xs[d];
      this.cy[i] = w * this.ys[a] + u * this.ys[b] + q * this.ys[d];
      this.cz[i] = w * nrm[3 * a + 2] + u * nrm[3 * b + 2] + q * nrm[3 * d + 2];
    }

    const circuitBuckets = [[], [], [], [], [], []];
    const gain = 0.85 + 0.4 * amp;
    const segCount = (c.segments.length / 2) | 0;

    for (let k = 0; k < segCount; k++) {
      const i = c.segments[2 * k], j = c.segments[2 * k + 1];
      const face = smooth01(0.10, 0.45, Math.min(this.cz[i], this.cz[j]));
      if (face <= 0) continue;

      // Running light pulse along each electronic track
      const phase = (t * 0.32 + c.segTrack[k] * 0.137) % 1.25;
      const d = (c.segAlong[k] - phase) / 0.07;
      const a = (0.42 + 0.58 * Math.exp(-d * d)) * face * (c.fade[i] + c.fade[j]) * 0.5 * gain;
      const level = a > 0.75 ? 2 : a > 0.45 ? 1 : 0;
      const kind = this.blueMix ? c.trackKind[c.segTrack[k]] : 0;
      const bk = kind * 3 + level;
      circuitBuckets[bk].push(i, j);
    }

    const gold = GOLD_CIRCUIT;
    const goldHot = mixInt(gold, 0xffffff, 0.6);
    const blueHot = BLUE_HOT;

    ctx.save();
    ctx.lineCap = 'round';

    // 1. Wide glowing gold halo under the gold circuit tracks
    const haloAlphas = [38 / 255, 58 / 255, 88 / 255];
    for (let level = 0; level < 3; level++) {
      const arr = circuitBuckets[level];
      if (!arr.length) continue;
      ctx.lineWidth = Math.max(1.4, strokePx * (2.6 + 0.9 * level));
      ctx.strokeStyle = intToCss(gold, haloAlphas[level]);
      ctx.beginPath();
      for (let m = 0; m < arr.length; m += 2) {
        const i = arr[m], j = arr[m + 1];
        ctx.moveTo(this.cx[i], this.cy[i]);
        ctx.lineTo(this.cx[j], this.cy[j]);
      }
      ctx.stroke();
    }

    // 2. Crisp gold & deep-blue electronic circuit tracks + bright running light pulses
    const lineAlphas = [195 / 255, 238 / 255, 1.0];
    for (let bk = 0; bk < 6; bk++) {
      const arr = circuitBuckets[bk];
      if (!arr.length) continue;
      const kind = (bk / 3) | 0;
      const level = bk % 3;
      ctx.lineWidth = Math.max(0.68, strokePx * (0.78 + 0.32 * level));
      const base = kind === 1 ? DEEP_BLUE : gold;
      const hot = kind === 1 ? blueHot : goldHot;
      ctx.strokeStyle = intToCss(level === 2 ? hot : base, lineAlphas[level]);
      ctx.beginPath();
      for (let m = 0; m < arr.length; m += 2) {
        const i = arr[m], j = arr[m + 1];
        ctx.moveTo(this.cx[i], this.cy[i]);
        ctx.lineTo(this.cx[j], this.cy[j]);
      }
      ctx.stroke();
    }

    // 3. Round terminal circuit pads (outer ring + inner center)
    const outerR = Math.max(0.95, strokePx * 1.25);
    const innerR = Math.max(0.42, strokePx * 0.52);
    for (let kind = 0; kind < 2; kind++) {
      if (this.holo && kind === 1) continue; // keep the blue circuit lines, not isolated blue terminal dots
      const padPoints = [];
      for (let idx = 0; idx < c.pads.length; idx++) {
        const p = c.pads[idx];
        const trackK = this.blueMix ? c.trackKind[(idx / 2) | 0] : 0;
        if (trackK !== kind) continue;
        if (smooth01(0.10, 0.45, this.cz[p]) <= 0) continue;
        padPoints.push(p);
      }
      if (padPoints.length > 0) {
        ctx.fillStyle = intToCss(kind === 1 ? DEEP_BLUE : gold, 0.96);
        ctx.beginPath();
        for (const p of padPoints) {
          ctx.moveTo(this.cx[p] + outerR, this.cy[p]);
          ctx.arc(this.cx[p], this.cy[p], outerR, 0, Math.PI * 2);
        }
        ctx.fill();

        ctx.fillStyle = intToCss(kind === 1 ? 0xffbfdcff : bg, 1.0);
        ctx.beginPath();
        for (const p of padPoints) {
          ctx.moveTo(this.cx[p] + innerR, this.cy[p]);
          ctx.arc(this.cx[p], this.cy[p], innerR, 0, Math.PI * 2);
        }
        ctx.fill();
      }
    }

    ctx.restore();
  }

  // ── Etched Porcelain Circuits for Léa (AvatarRenderer.kt drawEtched) ────────

  _getEtchKeep(c) {
    if (this.etchKeep && this.etchKeep.length === c.count) return this.etchKeep;
    const v = this.mesh.verts;
    let mid = 0, n = 0;
    for (const name of ['eye_l', 'eye_r']) {
      const ring = this.mesh.landmarks[name] || [];
      for (const i of ring) { mid += v[3 * i]; n++; }
    }
    mid = n > 0 ? mid / n : 0;
    const trackOf = new Int32Array(c.count).fill(-1);
    for (let k = 0; k < (c.segments.length / 2) | 0; k++) {
      trackOf[c.segments[2 * k]] = c.segTrack[k];
      trackOf[c.segments[2 * k + 1]] = c.segTrack[k];
    }
    const keep = new Uint8Array(c.count);
    for (let i = 0; i < c.count; i++) {
      const a = c.triA[i], b = c.triB[i], d = c.triC[i];
      const u = c.wu[i], q = c.wv[i], w = 1 - u - q;
      const x = w * v[3 * a] + u * v[3 * b] + q * v[3 * d] - mid;
      const y = w * v[3 * a + 1] + u * v[3 * b + 1] + q * v[3 * d + 1];
      const ax = Math.abs(x);
      const forehead = y >= 0.16 && y <= 0.40 && ax >= 0.06 && ax <= 0.46;
      const cheek = y >= -0.62 && y <= 0.05 && ax >= 0.30 && ax <= 0.62;
      if ((forehead || cheek) && trackOf[i] % 2 === 0) keep[i] = 1;
    }
    this.etchKeep = keep;
    return keep;
  }

  drawEtched(ctx, nrm, amp, strokePx, t) {
    const c = this.circuits;
    if (!c || c.count === 0) return;

    for (let i = 0; i < c.count; i++) {
      const a = c.triA[i], b = c.triB[i], d = c.triC[i];
      const u = c.wu[i], q = c.wv[i], w = 1 - u - q;
      this.cx[i] = w * this.xs[a] + u * this.xs[b] + q * this.xs[d];
      this.cy[i] = w * this.ys[a] + u * this.ys[b] + q * this.ys[d];
      this.cz[i] = w * nrm[3 * a + 2] + u * nrm[3 * b + 2] + q * nrm[3 * d + 2];
    }

    const keep = this._getEtchKeep(c);
    const buckets = [[], []];
    const segCount = (c.segments.length / 2) | 0;

    for (let k = 0; k < segCount; k++) {
      const i = c.segments[2 * k], j = c.segments[2 * k + 1];
      if (!keep[i] || !keep[j]) continue;
      const face = smooth01(0.15, 0.50, Math.min(this.cz[i], this.cz[j])) * (c.fade[i] + c.fade[j]) * 0.5;
      if (face <= 0.05) continue;
      const phase = (t * 0.22 + c.segTrack[k] * 0.211) % 1.6;
      const d = (c.segAlong[k] - phase) / 0.06;
      const bk = Math.exp(-d * d) > 0.35 ? 1 : 0;
      buckets[bk].push(i, j);
    }

    ctx.save();
    ctx.lineCap = 'round';
    for (let bk = 0; bk <= 1; bk++) {
      const arr = buckets[bk];
      if (!arr.length) continue;
      // Pale highlight groove edge
      ctx.lineWidth = Math.max(1.6, strokePx * 1.05);
      ctx.strokeStyle = 'rgba(244,247,250,0.47)';
      ctx.beginPath();
      const dy = Math.max(0.8, strokePx * 0.35);
      for (let m = 0; m < arr.length; m += 2) {
        const i = arr[m], j = arr[m + 1];
        ctx.moveTo(this.cx[i], this.cy[i] + dy);
        ctx.lineTo(this.cx[j], this.cy[j] + dy);
      }
      ctx.stroke();

      // Etched darker groove line
      ctx.lineWidth = Math.max(1.1, strokePx * 0.62);
      ctx.strokeStyle = 'rgba(125,132,142,0.84)';
      ctx.beginPath();
      for (let m = 0; m < arr.length; m += 2) {
        const i = arr[m], j = arr[m + 1];
        ctx.moveTo(this.cx[i], this.cy[i]);
        ctx.lineTo(this.cx[j], this.cy[j]);
      }
      ctx.stroke();
    }

    // Running cyan pulse along etched tracks
    if (buckets[1].length > 0) {
      const arr = buckets[1];
      ctx.lineWidth = Math.max(2.4, strokePx * 1.6);
      ctx.strokeStyle = intToCss(ANDROID_GLOW, (70 + 60 * amp) / 255);
      ctx.beginPath();
      for (let m = 0; m < arr.length; m += 2) {
        const i = arr[m], j = arr[m + 1];
        ctx.moveTo(this.cx[i], this.cy[i]);
        ctx.lineTo(this.cx[j], this.cy[j]);
      }
      ctx.stroke();

      ctx.lineWidth = Math.max(1.0, strokePx * 0.55);
      ctx.strokeStyle = 'rgba(233,251,255,0.86)';
      ctx.stroke();
    }

    // Silver terminal pads
    const outerR = Math.max(1.5, strokePx * 0.95);
    const innerR = Math.max(0.75, strokePx * 0.48);
    const pads = [];
    for (const p of c.pads) {
      if (keep[p] && smooth01(0.15, 0.50, this.cz[p]) > 0.1) pads.push(p);
    }
    if (pads.length > 0) {
      ctx.fillStyle = 'rgba(111,118,128,0.90)';
      ctx.beginPath();
      for (const p of pads) {
        ctx.moveTo(this.cx[p] + outerR, this.cy[p]);
        ctx.arc(this.cx[p], this.cy[p], outerR, 0, Math.PI * 2);
      }
      ctx.fill();

      ctx.fillStyle = 'rgba(242,245,248,1.0)';
      ctx.beginPath();
      for (const p of pads) {
        ctx.moveTo(this.cx[p] + innerR, this.cy[p]);
        ctx.arc(this.cx[p], this.cy[p], innerR, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.restore();
  }

  // ── Optical-Fibre Hologram Hair (FiberHair.kt) ─────────────────────────────

  drawFiberHair(ctx, nrm, primary, gold, t, strokePx) {
    const fh = this.fiberHair;
    if (fh.rows < 3 || fh.locks === 0) return;

    const buckets = Array.from({ length: Math.max(fh.rows - 1, 1) }, () => []);
    const hotLines = [];
    const sparks = [];

    for (let l = 0; l < fh.locks; l++) {
      const base = this.mesh.lockFirst + l * 3 * fh.rows;
      if (nrm[3 * (base + 1) + 2] < 0.10) continue;
      for (let f = 0; f < fh.perLock; f++) {
        const i = l * fh.perLock + f;
        const u = fh.across[i];
        const ph = fh.pulse[i] ? (t * 0.55 + i * 0.0137) % 1.6 : -9;
        let px = 0, py = 0;
        for (let s = 0; s < fh.rows; s++) {
          const li = base + 3 * s, ci = li + 1, ri = li + 2;
          const dx = this.xs[ri] - this.xs[li], dy = this.ys[ri] - this.ys[li];
          const half = 0.5 * Math.hypot(dx, dy);
          const along = s / (fh.rows - 1);
          const sway = half * fh.amp[i] * Math.sin(along * fh.freq[i] * 6.2832 + fh.phase[i] + t * 1.1) * (0.4 + 0.6 * along);
          const nl = Math.max(Math.hypot(dx, dy), 1e-4);
          const x = this.xs[ci] + dx * 0.5 * u + (dy / nl) * sway;
          const y = this.ys[ci] + dy * 0.5 * u - (dx / nl) * sway;
          if (s > 0) {
            if (Math.abs(along - ph) < 0.2) {
              hotLines.push(px, py, x, y);
            } else {
              const b = Math.min(buckets.length, s) - 1;
              buckets[b].push(px, py, x, y);
            }
          }
          px = x; py = y;
        }
        if (fh.spark[i]) sparks.push(px, py);
      }
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    for (let b = 0; b < buckets.length; b++) {
      const arr = buckets[b];
      if (!arr.length) continue;
      const frac = (b + 1) / buckets.length;
      ctx.lineWidth = Math.max(0.7, strokePx * 0.5);
      const col = mixInt(primary, 0xffffffff, 0.25 * frac * frac);
      ctx.strokeStyle = intToCss(col, (3 + 17 * frac * frac) / 255);
      ctx.beginPath();
      for (let m = 0; m < arr.length; m += 4) {
        ctx.moveTo(arr[m], arr[m + 1]);
        ctx.lineTo(arr[m + 2], arr[m + 3]);
      }
      ctx.stroke();
    }

    if (hotLines.length > 0) {
      ctx.lineWidth = Math.max(1.3, strokePx * 0.95);
      ctx.strokeStyle = intToCss(mixInt(primary, 0xffffffff, 0.6), 120 / 255);
      ctx.beginPath();
      for (let m = 0; m < hotLines.length; m += 4) {
        ctx.moveTo(hotLines[m], hotLines[m + 1]);
        ctx.lineTo(hotLines[m + 2], hotLines[m + 3]);
      }
      ctx.stroke();
    }

    if (sparks.length > 0) {
      const sr = Math.max(1.2, strokePx * 0.8);
      ctx.fillStyle = intToCss(gold, 135 / 255);
      ctx.beginPath();
      for (let m = 0; m < sparks.length; m += 2) {
        ctx.moveTo(sparks[m] + sr, sparks[m + 1]);
        ctx.arc(sparks[m], sparks[m + 1], sr, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    ctx.restore();
  }

  // ── Realistic Hair Strands & Sheen (AvatarRenderer.kt drawFibres) ──────────

  drawFibres(ctx, v, nrm, strokePx) {
    const mesh = this.mesh;
    if (mesh.lockCount === 0 || mesh.lockRows < 3) return;
    const rows = mesh.lockRows;
    const locks = Math.min(mesh.lockCount, HAIR_FIBRE_LOCKS);
    const light = mixInt(this.browColour, 0xff6b4e36, 0.6);

    ctx.save();
    ctx.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      ctx.lineWidth = Math.max(0.7, strokePx * (pass === 0 ? 0.62 : 0.5));
      ctx.strokeStyle = pass === 0 ? 'rgba(18,10,6,0.51)' : intToCss(light, 24 / 255);
      ctx.beginPath();
      for (let l = 0; l < locks; l++) {
        const base = mesh.lockFirst + l * 3 * rows;
        if (nrm[3 * (base + 1) + 2] < 0.10) continue;
        const lockHash = Math.imul(l, -1640531535);
        const lockFreq = 1.2 + (1.6 * ((lockHash >>> 8) & 0xff)) / 255;
        const lockPhase = (((lockHash >>> 16) & 0xff) / 255) * 6.2832;
        for (let f = 0; f < FIBRES_PER_LOCK; f++) {
          if ((f + l) % 2 !== pass) continue;
          const hash = Math.imul(l * 31 + f * 1039, -1640531535);
          const u = -0.9 + (1.8 * (f + 0.5 + 0.35 * (((hash >>> 8) & 0xff) / 255 - 0.5))) / FIBRES_PER_LOCK;
          const wave = 0.10 + (0.10 * ((hash >>> 16) & 0xff)) / 255;
          const stop = rows - (((hash >>> 24) & 3) === 0 ? 2 : 0);
          let px = 0, py = 0;
          for (let sIdx = 0; sIdx < stop; sIdx++) {
            const li = base + 3 * sIdx, ci = li + 1, ri = li + 2;
            const dx = this.xs[ri] - this.xs[li], dy = this.ys[ri] - this.ys[li];
            const half = 0.5 * Math.hypot(dx, dy);
            let x = this.xs[ci] + dx * 0.5 * u;
            let y = this.ys[ci] + dy * 0.5 * u;
            const t = sIdx / (rows - 1);
            const shift = half * wave * Math.sin(t * lockFreq * 6.2832 + lockPhase + f * 0.35);
            const nx = this.ys[ri] - this.ys[li], ny = this.xs[li] - this.xs[ri];
            const nl = Math.max(Math.hypot(nx, ny), 1e-4);
            x += (nx / nl) * shift;
            y += (ny / nl) * shift;
            if (sIdx > 0) {
              ctx.moveTo(px, py);
              ctx.lineTo(x, y);
            }
            px = x; py = y;
          }
        }
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── Multi-ring Breathing Halo (AvatarRenderer.kt drawHalo) ─────────────────

  drawHalo(ctx, cx, cy, r, amp, t) {
    const hcy = cy - r * 0.10;
    const rr = r * 1.30;
    const breath = 0.85 + 0.15 * Math.sin(t * 1.3) + 0.25 * amp;
    const rings = [
      { rad: rr, width: r * 0.20, col: ANDROID_GLOW, alpha: (30 * breath) / 255 },
      { rad: rr, width: r * 0.07, col: ANDROID_GLOW, alpha: (70 * breath) / 255 },
      { rad: rr, width: r * 0.022, col: ANDROID_GLOW, alpha: 200 / 255 },
      { rad: rr, width: r * 0.008, col: 0xffe9fbff, alpha: 235 / 255 },
      { rad: r * 1.62, width: r * 0.010, col: ANDROID_GLOW, alpha: 55 / 255 },
      { rad: r * 1.88, width: r * 0.008, col: 0xff9a6bff, alpha: 45 / 255 },
    ];
    ctx.save();
    for (const rg of rings) {
      ctx.strokeStyle = intToCss(rg.col, rg.alpha);
      ctx.lineWidth = Math.max(1, rg.width);
      ctx.beginPath();
      ctx.arc(cx, hcy, rg.rad, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── Smooth Lid Curve Helper (AvatarRenderer.kt lidPoints) ──────────────────

  _lidPoints(curve) {
    const curveX = new Float32Array(LID_COLUMNS);
    const curveY = new Float32Array(LID_COLUMNS);
    const curveN = new Float32Array(LID_COLUMNS);
    for (let k = 0; k < curve.verts.length; k++) {
      const v = curve.verts[k];
      const c = curve.column[k];
      curveX[c] += this.xs[v];
      curveY[c] += this.ys[v];
      curveN[c] += 1;
    }
    const ux = [], uy = [];
    for (let c = 0; c < LID_COLUMNS; c++) {
      if (curveN[c] > 0) {
        ux.push(curveX[c] / curveN[c]);
        uy.push(curveY[c] / curveN[c]);
      }
    }
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < ux.length - 1; i++) {
        uy[i] = 0.25 * uy[i - 1] + 0.5 * uy[i] + 0.25 * uy[i + 1];
      }
    }
    return { ux, uy };
  }

  // Draw an actual inner mouth rather than letting the animated lip seams sit on skin.
  // The cavity follows the same projected lip chains as the deforming head mesh.
  drawMouth(ctx, avatar, r, face, primary, strokePx) {
    const upper = this.mesh.mouthUpper;
    const lower = this.mesh.mouthLower;
    if (!upper || !lower || upper.length < 3 || lower.length < 3) return;

    let left = Infinity, right = -Infinity, upperY = 0, lowerY = 0;
    for (let i = 0; i < upper.length; i++) {
      const x = this.xs[upper[i]];
      left = Math.min(left, x);
      right = Math.max(right, x);
      upperY += this.ys[upper[i]];
      lowerY += this.ys[lower[i]];
    }
    upperY /= upper.length;
    lowerY /= lower.length;
    const gap = lowerY - upperY;
    const width = right - left;
    const open = Math.max(0, Math.min(1, avatar.mouth || 0));
    if (gap < 0.55 || width < 2 || open < 0.008) return;

    const isHolo = this.holo || this.skin === 0;
    const cavityTop = isHolo ? 'rgba(2,9,25,0.98)' : 'rgba(43,12,18,0.98)';
    const cavityBottom = isHolo ? 'rgba(4,23,54,0.98)' : 'rgba(83,24,31,0.98)';
    const teethColor = isHolo ? 'rgba(174,237,255,0.94)' : 'rgba(255,239,218,0.97)';

    ctx.save();
    ctx.beginPath();
    traceChain(ctx, this.xs, this.ys, upper);
    traceChain(ctx, this.xs, this.ys, lower, true);
    ctx.closePath();
    const cavity = ctx.createLinearGradient(0, upperY, 0, lowerY);
    cavity.addColorStop(0, cavityTop);
    cavity.addColorStop(1, cavityBottom);
    ctx.fillStyle = cavity;
    ctx.fill();
    ctx.clip();

    // A softly curved upper row makes open vowels read as a real mouth at avatar/PiP sizes.
    const toothDepth = Math.max(0.7, Math.min(gap * 0.36, r * 0.026));
    if (gap > 1.1 && toothDepth > 0.75) {
      ctx.beginPath();
      traceChain(ctx, this.xs, this.ys, upper);
      for (let i = upper.length - 1; i >= 0; i--) {
        const vi = upper[i];
        const t = i / (upper.length - 1);
        const arch = Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.42);
        ctx.lineTo(this.xs[vi], this.ys[vi] + toothDepth * arch);
      }
      ctx.closePath();
      ctx.fillStyle = teethColor;
      ctx.fill();

      ctx.strokeStyle = isHolo ? 'rgba(47,148,194,0.38)' : 'rgba(112,71,66,0.22)';
      ctx.lineWidth = Math.max(0.55, strokePx * 0.32);
      ctx.beginPath();
      for (const fraction of [0.25, 0.5, 0.75]) {
        const i = Math.round(fraction * (upper.length - 1));
        const vi = upper[i];
        const t = i / (upper.length - 1);
        const arch = Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.42);
        ctx.moveTo(this.xs[vi], this.ys[vi] + 0.25);
        ctx.lineTo(this.xs[vi], this.ys[vi] + toothDepth * arch);
      }
      ctx.stroke();
    }

    if (open > 0.28 && gap > 3) {
      const tongueY = upperY + gap * 0.82;
      const tongue = ctx.createRadialGradient((left + right) / 2, tongueY, 0, (left + right) / 2, tongueY, width * 0.19);
      tongue.addColorStop(0, isHolo ? 'rgba(63,178,227,0.60)' : 'rgba(209,91,103,0.72)');
      tongue.addColorStop(1, isHolo ? 'rgba(19,73,135,0.12)' : 'rgba(117,37,49,0.12)');
      ctx.fillStyle = tongue;
      ctx.beginPath();
      ctx.ellipse((left + right) / 2, tongueY, width * 0.17, Math.min(gap * 0.11, r * 0.014), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    const lipTone = this.lips > 0 ? LIP_TONES[this.lips - 1] : null;
    const lipLine = isHolo ? DEEP_BLUE : lipTone || (this.skin > 0 ? 0xff6e2a38 : primary);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = intToCss(lipLine, (isHolo ? 0.88 : 0.92) * face);
    ctx.lineWidth = Math.max(0.8, strokePx * (1.15 + open * 0.22));
    for (const chain of [upper, lower]) {
      ctx.beginPath();
      traceChain(ctx, this.xs, this.ys, chain);
      ctx.stroke();
    }
    if (!isHolo && open > 0.04) {
      ctx.strokeStyle = `rgba(255,224,218,${(0.12 * face * open).toFixed(3)})`;
      ctx.lineWidth = Math.max(0.6, strokePx * 0.48);
      ctx.beginPath();
      traceChain(ctx, this.xs, this.ys, lower);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── Brows, Lashes, Eyelids, Catchlights & Lip Chains (drawFeatures) ────────

  drawFeatures(ctx, avatar, r, primary, strokePx) {
    const face = Math.pow(Math.max(0, Math.cos(avatar.yaw) * Math.cos(avatar.pitch)), 2);
    if (face < 0.02) return;
    const mesh = this.mesh;
    const lm = mesh.landmarks;
    const lipsOut = lm.lips_out || [];
    let midX = 0;
    for (const vi of lipsOut) midX += this.xs[vi];
    midX = lipsOut.length ? midX / lipsOut.length : 0;

    const hairCol = this.holo ? DEEP_BLUE : this.browColour;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 1. Eyebrows (underlay + 160 individual hairs)
    for (const key of ['brow_l', 'brow_r']) {
      const idx = lm[key];
      if (!idx || idx.length < 2) continue;
      const n = idx.length;
      const inner0 = Math.abs(this.xs[idx[0]] - midX) < Math.abs(this.xs[idx[n - 1]] - midX);
      const px = new Float32Array(n);
      const py = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const vi = idx[inner0 ? i : n - 1 - i];
        px[i] = this.xs[vi];
        py[i] = this.ys[vi];
      }

      if (this.skin === 0) {
        ctx.strokeStyle = intToCss(primary, (60 * face) / 255);
        ctx.lineWidth = strokePx * 4.5;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          if (i === 0) ctx.moveTo(px[i], py[i]);
          else ctx.lineTo(px[i], py[i]);
        }
        ctx.stroke();

        ctx.strokeStyle = intToCss(primary, (230 * face) / 255);
        ctx.lineWidth = strokePx * 1.8;
        ctx.stroke();
        continue;
      }

      const cum = new Float32Array(n);
      for (let i = 1; i < n; i++) {
        cum[i] = cum[i - 1] + Math.hypot(px[i] - px[i - 1], py[i] - py[i - 1]);
      }
      const total = Math.max(cum[n - 1], 1);

      // Soft brow underlay
      ctx.strokeStyle = intToCss(hairCol, (90 * face) / 255);
      ctx.lineWidth = r * 0.030 * this.browScale;
      ctx.beginPath();
      for (let step = 0; step <= 24; step++) {
        const target = (step / 24) * total;
        let seg = 1;
        while (seg < n - 1 && cum[seg] < target) seg++;
        const segLen = Math.max(cum[seg] - cum[seg - 1], 1e-3);
        const f = Math.max(0, Math.min(1, (target - cum[seg - 1]) / segLen));
        const bx = px[seg - 1] + (px[seg] - px[seg - 1]) * f;
        const by = py[seg - 1] + (py[seg] - py[seg - 1]) * f;
        if (step === 0) ctx.moveTo(bx, by);
        else ctx.lineTo(bx, by);
      }
      ctx.stroke();

      // 160 individual brow hairs
      ctx.strokeStyle = intToCss(hairCol, (215 * face) / 255);
      ctx.lineWidth = Math.max(1, strokePx * 0.85);
      ctx.beginPath();
      for (const h of this.browHairs) {
        const target = h.u * total;
        let seg = 1;
        while (seg < n - 1 && cum[seg] < target) seg++;
        const segLen = Math.max(cum[seg] - cum[seg - 1], 1e-3);
        const f = Math.max(0, Math.min(1, (target - cum[seg - 1]) / segLen));
        const tx = (px[seg] - px[seg - 1]) / segLen;
        const ty = (py[seg] - py[seg - 1]) / segLen;
        let nx = -ty, ny = tx;
        if (ny > 0) { nx = -nx; ny = -ny; }
        const width = r * (0.050 - 0.026 * h.u) * this.browScale;
        const rx = px[seg - 1] + (px[seg] - px[seg - 1]) * f + nx * h.off * width * 0.5;
        const ry = py[seg - 1] + (py[seg] - py[seg - 1]) * f + ny * h.off * width * 0.5;
        const angle = 0.95 - 1.1 * h.u + h.jitter;
        const ca = Math.cos(angle), sa = Math.sin(angle);
        const length = r * 0.048 * h.len * (1.0 - 0.35 * h.u) * (0.5 + 0.5 * this.browScale);
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx + (tx * ca + nx * sa) * length, ry + (ty * ca + ny * sa) * length);
      }
      ctx.stroke();
    }

    // 2. Eyelids, Eyelashes & Eyeball Catchlights (AvatarRenderer.kt drawEyes)
    const open = Math.max(0, Math.min(1, (1 - avatar.blink) * avatar.lids));
    const lash = this.holo ? DEEP_BLUE : this.skin > 0 ? 0xff1e120e : primary;
    const fold = this.holo ? DEEP_BLUE : this.skin > 0 ? 0xff6b4636 : primary;
    const foldAlpha = this.holo ? 130 / 255 : 70 / 255;

    for (let e = 0; e < this.lidCurves.length; e++) {
      const up = this.lidCurves[e][1];
      const low = this.lidCurves[e][0];
      if (!up.verts.length) continue;
      const { ux, uy } = this._lidPoints(up);
      const n = ux.length;
      if (n < 2) continue;
      if (Math.abs(ux[0] - midX) > Math.abs(ux[n - 1] - midX)) {
        ux.reverse();
        uy.reverse();
      }

      // Upper eyelid crease fold
      ctx.strokeStyle = intToCss(fold, foldAlpha * face * (0.4 + 0.6 * open));
      ctx.lineWidth = strokePx * 1.4;
      ctx.beginPath();
      for (let i = 0; i < n - 1; i++) {
        ctx.moveTo(ux[i], uy[i] - r * 0.016);
        ctx.lineTo(ux[i + 1], uy[i + 1] - r * 0.016);
      }
      ctx.stroke();

      // Upper lash line (thicker towards outer corner)
      ctx.strokeStyle = intToCss(lash, (235 / 255) * face);
      for (let i = 0; i < n - 1; i++) {
        ctx.lineWidth = strokePx * (0.8 + (1.5 * (i + 0.5)) / (n - 1)) * (0.6 + 0.4 * this.lashScale);
        ctx.beginPath();
        ctx.moveTo(ux[i], uy[i]);
        ctx.lineTo(ux[i + 1], uy[i + 1]);
        ctx.stroke();
      }

      // 15 curved upper lashes
      const outward = ux[n - 1] < ux[0] ? -1 : 1;
      const lashes = 15;
      ctx.strokeStyle = intToCss(lash, (215 / 255) * face);
      ctx.lineWidth = Math.max(1, strokePx * 0.65);
      ctx.beginPath();
      for (let k = 0; k < lashes; k++) {
        const t = (k + 0.5) / lashes;
        const pos = t * (n - 1);
        const i = Math.max(0, Math.min(n - 2, pos | 0));
        const f = pos - i;
        const bx = ux[i] + (ux[i + 1] - ux[i]) * f;
        const by = uy[i] + (uy[i + 1] - uy[i]) * f;
        const len = r * 0.030 * this.lashScale * (0.45 + 0.75 * t) * (0.8 + 0.4 * this.lashRnd[k]);
        const lift = 2 * open - 1;
        const dx = outward * (0.30 + 0.55 * t) * Math.max(0.5, Math.abs(lift));
        const dy = -lift * (1.0 - 0.35 * t);
        const dl = Math.max(Math.hypot(dx, dy), 1e-3);
        const midx = bx + (dx / dl) * len * 0.55;
        const midy = by + (dy / dl) * len * 0.55;
        const tipX = bx + (dx / dl) * len;
        const tipY = by + (dy / dl) * len;
        ctx.moveTo(bx, by);
        ctx.lineTo(midx, midy);
        ctx.lineTo(tipX + outward * len * 0.10, tipY - lift * len * 0.05);
      }
      ctx.stroke();

      // Lower lid & 7 short lower lashes
      const lowPts = this._lidPoints(low);
      const m = lowPts.ux.length;
      if (m >= 2) {
        ctx.strokeStyle = intToCss(lash, (120 / 255) * face);
        ctx.lineWidth = strokePx * 0.65;
        ctx.beginPath();
        for (let i = 0; i < m - 1; i++) {
          ctx.moveTo(lowPts.ux[i], lowPts.uy[i]);
          ctx.lineTo(lowPts.ux[i + 1], lowPts.uy[i + 1]);
        }
        ctx.stroke();

        ctx.strokeStyle = intToCss(lash, (105 / 255) * face);
        ctx.lineWidth = Math.max(1, strokePx * 0.5);
        ctx.beginPath();
        for (let k = 0; k < 7; k++) {
          const pos = ((k + 0.5) / 7) * (m - 1);
          const i = Math.max(0, Math.min(m - 2, pos | 0));
          const f = pos - i;
          const bx = lowPts.ux[i] + (lowPts.ux[i + 1] - lowPts.ux[i]) * f;
          const by = lowPts.uy[i] + (lowPts.uy[i + 1] - lowPts.uy[i]) * f;
          ctx.moveTo(bx, by);
          ctx.lineTo(
            bx + outward * r * 0.004,
            by + r * 0.010 * (0.7 + 0.6 * this.lashRnd[20 + k]) * (0.3 + 0.7 * open)
          );
        }
        ctx.stroke();
      }

      // Dual eyeball catchlights
      if (open > 0.4 && mesh.eyeFirst.length > e) {
        const pole = mesh.eyeFirst[e] + 17;
        if (pole < this.nV) {
          ctx.fillStyle = `rgba(255,255,255,${((235 / 255) * face * open).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(this.xs[pole] - r * 0.010, this.ys[pole] - r * 0.010, Math.max(1.2, r * 0.0075), 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = `rgba(255,255,255,${((110 / 255) * face * open).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(this.xs[pole] + r * 0.008, this.ys[pole] + r * 0.009, Math.max(0.8, r * 0.0038), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // 3. Animated oral cavity, teeth, tongue and shaped lip edges
    this.drawMouth(ctx, avatar, r, face, primary, strokePx);

    ctx.restore();
  }
}

// ── GlowReactor (HUD Reactor Orb when in Reactor mode) ──────────────────────

export function drawGlowReactor(ctx, cx, cy, r, state, outputLevel, timeSec, primary = 0xff00d4ff) {
  const prR = (primary >> 16) & 0xff, prG = (primary >> 8) & 0xff, prB = primary & 0xff;
  const pulse =
    state === 'SPEAKING'
      ? 1 + 0.25 * outputLevel + 0.06 * Math.sin(timeSec * 12)
      : state === 'LISTENING'
      ? 1 + 0.08 * Math.sin(timeSec * 4)
      : 1 + 0.03 * Math.sin(timeSec * 1.8);

  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.6 * pulse);
  grad.addColorStop(0, `rgba(${prR},${prG},${prB},0.55)`);
  grad.addColorStop(0.45, `rgba(${prR},${prG},${prB},0.16)`);
  grad.addColorStop(1, `rgba(${prR},${prG},${prB},0)`);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.6 * pulse, 0, Math.PI * 2);
  ctx.fill();

  for (let ring = 0; ring < 4; ring++) {
    const rad = r * (0.35 + ring * 0.22) * pulse;
    ctx.strokeStyle = `rgba(${prR},${prG},${prB},${0.75 - ring * 0.15})`;
    ctx.lineWidth = ring === 0 ? 3 : 1.5;
    ctx.beginPath();
    const start = timeSec * (ring % 2 === 0 ? 0.9 : -0.7) + ring;
    ctx.arc(cx, cy, rad, start, start + Math.PI * 1.65);
    ctx.stroke();
  }
}
