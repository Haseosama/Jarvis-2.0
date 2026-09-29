// Complete Canvas2D renderer porting AvatarRenderer.kt, CharacterRenderer.kt,
// CartoonAvatar.kt, and GlowReactor from Jarvis-Android.

import { NetworkWeb, JAW_MAX } from './HeadMesh.js';

const CAM_D = 4.6;
const LUT_N = 192;
const ANDROID_SKIN = 0xffcdd2d8;
const DEEP_BLUE = 0xff0c2160;
const SKIN_TONES = [0xf1c9a8, 0xd9a47c, 0xb07a54, 0x7a4e36, 0x69b4f0];
const LIP_TONES = [0xd9707f, 0xc02836, 0x8e3a6b, 0xe8735a];

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
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

export class AvatarRenderer {
  constructor(mesh) {
    this.mesh = mesh;
    this.nV = mesh.vertexCount;
    this.nF = mesh.faceCount;
    this.xs = new Float32Array(this.nV);
    this.ys = new Float32Array(this.nV);
    this.faceColor = new Int32Array(this.nF);
    this.faceZ = new Float32Array(this.nF);
    this.order = new Int32Array(this.nF);
    this.lut = new Int32Array(LUT_N);
    this.lutKey = '';
    this.web = new NetworkWeb(mesh);
    this.wx = new Float32Array(this.web.count);
    this.wy = new Float32Array(this.web.count);
    this.wz = new Float32Array(this.web.count);

    // Config properties updated before draw
    this.skin = 1;
    this.holo = false;
    this.holoHair = false;
    this.blueMix = false;
    this.fibreOverlay = true;
    this.browColour = 0xff34241c;
    this.browScale = 1.0;
    this.lashScale = 1.0;
    this.androidLook = false;
    this.lipTint = 0.7;
    this.halo = false;
    this.lips = 0;
    this.cap = 0;
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

    const pnt = mesh.paint[vi];
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
      const base = this.skin > 0 ? pnt : mixInt(pnt, primaryColor, 0.22);
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
    const amp = avatar.glow;
    const v = avatar.pv;
    const nrm = avatar.pn;
    const mesh = this.mesh;

    // 1. Radial aura
    const ar = r * 1.9;
    const prR = (primary >> 16) & 0xff, prG = (primary >> 8) & 0xff, prB = primary & 0xff;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, ar);
    grad.addColorStop(0, `rgba(${prR},${prG},${prB},${(0.13 + 0.25 * amp).toFixed(3)})`);
    grad.addColorStop(0.4, `rgba(${prR},${prG},${prB},${(0.07 + 0.14 * amp).toFixed(3)})`);
    grad.addColorStop(1, `rgba(${prR},${prG},${prB},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, ar, 0, Math.PI * 2);
    ctx.fill();

    // 2. Optional Léa halo
    if (this.halo) {
      ctx.save();
      const hr = r * 1.15;
      ctx.strokeStyle = `rgba(53,201,255,${(0.28 + 0.28 * amp).toFixed(3)})`;
      ctx.lineWidth = Math.max(2, r * 0.022);
      ctx.beginPath();
      ctx.arc(cx, cy - r * 0.06, hr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 3. Drifting particles of light
    for (let k = 0; k < 24; k++) {
      const h = ((k * -1640531535) >>> 8) & 0xffff;
      const ang = (h % 628) / 100 + 0.05 * avatar.time * (k % 2 === 0 ? 1 : -1);
      const dist = r * (1.1 + 0.8 * (((h / 7) | 0) % 100) / 100);
      const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(avatar.time * (0.8 + (h % 5) * 0.3) + k));
      ctx.fillStyle = `rgba(${prR},${prG},${prB},${(0.55 * tw).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(ang) * dist * 0.82, cy + Math.sin(ang) * dist * 1.02, 1.3 + (h % 2), 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. Project vertices
    for (let i = 0; i < this.nV; i++) {
      const w = Math.max(CAM_D - v[3 * i + 2], 0.35);
      const k = (CAM_D / w) * r;
      this.xs[i] = cx + v[3 * i] * k;
      this.ys[i] = cy - v[3 * i + 1] * k;
    }

    this.buildLut(bg, primary);

    // 5. Shade & depth-sort visible triangles
    let count = 0;
    const f = mesh.faces;
    const fade = mesh.fade;
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
      if (nz <= 0.015) continue;

      const area = Math.abs((this.xs[b] - this.xs[a]) * (this.ys[c] - this.ys[a]) - (this.xs[c] - this.xs[a]) * (this.ys[b] - this.ys[a]));
      if (area <= 2.2) continue;

      if ((this.skin === 0 || (this.holo && !this.holoHair)) && mesh.faceGroup[t] > 1.5) continue;
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

      this.faceColor[t] = col;
      const g = mesh.faceGroup[t];
      const zBias = g > 1.5 ? 0.05 : g > 0.5 ? 0 : -1000;
      this.faceZ[t] = (v[3 * a + 2] + v[3 * b + 2] + v[3 * c + 2]) / 3 + zBias;
      this.order[count++] = t;
    }

    const activeOrder = this.order.subarray(0, count);
    const faceZ = this.faceZ;
    activeOrder.sort((t1, t2) => faceZ[t1] - faceZ[t2]);

    // 6. Draw triangles
    for (let k = 0; k < count; k++) {
      const t = activeOrder[k];
      const a = f[3 * t], b = f[3 * t + 1], d = f[3 * t + 2];
      const x0 = this.xs[a], y0 = this.ys[a];
      const x1 = this.xs[b], y1 = this.ys[b];
      const x2 = this.xs[d], y2 = this.ys[d];
      const tcx = (x0 + x1 + x2) / 3, tcy = (y0 + y1 + y2) / 3;

      const col = intToCss(this.faceColor[t], 1);
      ctx.fillStyle = col;
      ctx.beginPath();
      // Slightly expand each triangle by ~0.45px from centroid to avoid seam gaps
      const gx0 = x0 + (x0 - tcx > 0 ? 0.45 : -0.45), gy0 = y0 + (y0 - tcy > 0 ? 0.45 : -0.45);
      const gx1 = x1 + (x1 - tcx > 0 ? 0.45 : -0.45), gy1 = y1 + (y1 - tcy > 0 ? 0.45 : -0.45);
      const gx2 = x2 + (x2 - tcx > 0 ? 0.45 : -0.45), gy2 = y2 + (y2 - tcy > 0 ? 0.45 : -0.45);
      ctx.moveTo(gx0, gy0);
      ctx.lineTo(gx1, gy1);
      ctx.lineTo(gx2, gy2);
      ctx.closePath();
      ctx.fill();
    }

    // 7. Holographic Web / Etched Android Circuits
    if (this.skin === 0 || this.holo || this.androidLook) {
      this.drawWebOverlay(ctx, nrm, amp, primary, avatar.time);
    }

    // 8. Facial features (brows, eyes, catchlights, lip lines)
    this.drawFeatures(ctx, avatar, r, primary);
  }

  drawWebOverlay(ctx, nrm, amp, primary, t) {
    const w = this.web;
    const prR = (primary >> 16) & 0xff, prG = (primary >> 8) & 0xff, prB = primary & 0xff;
    for (let i = 0; i < w.count; i++) {
      const a = w.triA[i], b = w.triB[i], c = w.triC[i];
      const u = w.wu[i], q = w.wv[i], s = 1 - u - q;
      this.wx[i] = s * this.xs[a] + u * this.xs[b] + q * this.xs[c];
      this.wy[i] = s * this.ys[a] + u * this.ys[b] + q * this.ys[c];
      this.wz[i] = s * nrm[3 * a + 2] + u * nrm[3 * b + 2] + q * nrm[3 * c + 2];
    }
    const alphaScale = this.skin === 0 ? 0.42 : this.holo ? 0.22 : 0.14;
    ctx.strokeStyle = `rgba(${prR},${prG},${prB},${(alphaScale * (0.8 + 0.4 * amp)).toFixed(3)})`;
    ctx.lineWidth = 0.85;
    ctx.beginPath();
    const e = w.edges;
    for (let k = 0; k < e.length; k += 2) {
      const i = e[k], j = e[k + 1];
      if (this.wz[i] < 0.08 || this.wz[j] < 0.08) continue;
      if (this.skin > 0 && this.wz[i] > 0.55 && this.wz[j] > 0.55) continue; // keep contour only on solid skin
      ctx.moveTo(this.wx[i], this.wy[i]);
      ctx.lineTo(this.wx[j], this.wy[j]);
    }
    ctx.stroke();
  }

  drawFeatures(ctx, avatar, r, primary) {
    const face = Math.pow(Math.max(0, Math.cos(avatar.yaw) * Math.cos(avatar.pitch)), 2);
    if (face < 0.02) return;
    const mesh = this.mesh;
    const lm = mesh.landmarks;
    const hairCol = this.holo ? DEEP_BLUE : this.browColour;

    // Brows
    for (const key of ['brow_l', 'brow_r']) {
      const idx = lm[key];
      if (!idx || idx.length === 0) continue;
      ctx.strokeStyle = intToCss(this.skin === 0 ? primary : hairCol, 0.78 * face);
      ctx.lineWidth = Math.max(1.8, r * 0.028 * this.browScale);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < idx.length; i++) {
        const vi = idx[i];
        if (i === 0) ctx.moveTo(this.xs[vi], this.ys[vi]);
        else ctx.lineTo(this.xs[vi], this.ys[vi]);
      }
      ctx.stroke();
    }

    // Eyelid rims & catchlights
    const open = Math.max(0, Math.min(1, (1 - avatar.blink) * avatar.lids));
    const lashCol = this.holo ? DEEP_BLUE : this.skin === 0 ? primary : 0xff16100e;
    ctx.strokeStyle = intToCss(lashCol, 0.85 * face);
    ctx.lineWidth = Math.max(1.2, r * 0.011 * this.lashScale);
    ctx.beginPath();
    for (let i = 0; i < mesh.eyelidRim.length; i += 3) {
      const v0 = mesh.eyelidRim[i], v1 = mesh.eyelidRim[i + 1], upper = mesh.eyelidRim[i + 2];
      if (upper === 1) {
        ctx.moveTo(this.xs[v0], this.ys[v0]);
        ctx.lineTo(this.xs[v1], this.ys[v1]);
      }
    }
    ctx.stroke();

    if (open > 0.38) {
      for (let e = 0; e < mesh.eyeFirst.length; e++) {
        const pole = mesh.eyeFirst[e] + 17;
        if (pole < this.nV) {
          ctx.fillStyle = `rgba(255,255,255,${(0.9 * face * open).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(this.xs[pole] - r * 0.01, this.ys[pole] - r * 0.01, Math.max(1.3, r * 0.008), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Mouth lip lines
    const lipLine = this.holo ? DEEP_BLUE : this.skin > 0 ? 0xff6e2a38 : primary;
    for (const [chain, alpha] of [
      [mesh.mouthUpper, 0.78],
      [mesh.mouthLower, 0.66],
    ]) {
      if (!chain || chain.length === 0) continue;
      ctx.strokeStyle = intToCss(lipLine, alpha * face);
      ctx.lineWidth = Math.max(1.1, r * 0.008);
      ctx.beginPath();
      for (let k = 0; k < chain.length; k++) {
        const vi = chain[k];
        if (k === 0) ctx.moveTo(this.xs[vi], this.ys[vi]);
        else ctx.lineTo(this.xs[vi], this.ys[vi]);
      }
      ctx.stroke();
    }
  }
}

// ── CharacterRenderer (Adam & Mei textured 3D busts) ─────────────────────────

export class CharacterRenderer {
  constructor(characterMesh) {
    this.ch = characterMesh;
    this.nV = characterMesh.vertexCount;
    this.nF = characterMesh.faceCount;
    this.pv = new Float32Array(3 * this.nV);
    this.xs = new Float32Array(this.nV);
    this.ys = new Float32Array(this.nV);
    this.lit = new Float32Array(this.nV);
    this.faceZ = new Float32Array(this.nF);
    this.order = new Int32Array(this.nF);

    // Pre-sample average RGB colour per UV triangle from the atlas image for ultra-fast software shading,
    // plus support affine texture draw when atlas is loaded.
    this.triAvgColor = new Array(this.nF);
    this.prepareAtlasColors();
  }

  prepareAtlasColors() {
    const ch = this.ch;
    if (!ch.atlas) return;
    try {
      const w = ch.atlas.width || 512;
      const h = ch.atlas.height || 512;
      const off = document.createElement('canvas');
      off.width = w;
      off.height = h;
      const octx = off.getContext('2d');
      octx.drawImage(ch.atlas, 0, 0, w, h);
      const data = octx.getImageData(0, 0, w, h).data;
      const f = ch.faces;
      const uv = ch.uv;
      for (let t = 0; t < this.nF; t++) {
        const a = f[3 * t], b = f[3 * t + 1], c = f[3 * t + 2];
        const u = (uv[2 * a] + uv[2 * b] + uv[2 * c]) / 3;
        const v = (uv[2 * a + 1] + uv[2 * b + 1] + uv[2 * c + 1]) / 3;
        const px = Math.max(0, Math.min(w - 1, Math.floor(u * w)));
        const py = Math.max(0, Math.min(h - 1, Math.floor(v * h)));
        const idx = (py * w + px) * 4;
        this.triAvgColor[t] = [data[idx], data[idx + 1], data[idx + 2]];
      }
    } catch {}
  }

  draw(ctx, avatar, cx, cy, r, primary) {
    const ch = this.ch;
    const k = r * ch.scale;
    const ox = cx;
    const oy = cy - r * 0.08;
    const CAM = 4.6;

    // Aura behind character
    const prR = (primary >> 16) & 0xff, prG = (primary >> 8) & 0xff, prB = primary & 0xff;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.7);
    grad.addColorStop(0, `rgba(${prR},${prG},${prB},${(0.18 + 0.22 * avatar.glow).toFixed(3)})`);
    grad.addColorStop(1, `rgba(${prR},${prG},${prB},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.7, 0, Math.PI * 2);
    ctx.fill();

    const cyaw = Math.cos(avatar.yaw), syaw = Math.sin(avatar.yaw);
    const cp = Math.cos(avatar.pitch), sp = Math.sin(avatar.pitch);
    const cr = Math.cos(avatar.roll), sr = Math.sin(avatar.roll);
    const m00 = cyaw, m01 = 0, m02 = syaw;
    const m10 = sp * syaw, m11 = cp, m12 = -sp * cyaw;
    const m20 = -cp * syaw, m21 = sp, m22 = cp * cyaw;

    const jawAng = Math.max(0, Math.min(1, avatar.mouth)) * JAW_MAX;
    const jy = ch.jawPivot[1], jz = ch.jawPivot[2];
    const px = ch.pivot[0], py = ch.pivot[1], pz = ch.pivot[2];
    const v = ch.verts, n = ch.normals;
    const lx = -0.45, ly = 0.5, lz = 0.75;
    const ll = Math.hypot(lx, ly, lz);
    const lift = Math.max(-0.4, Math.min(1.2, avatar.brow)) * ch.browLift;
    const gx = Math.max(-1, Math.min(1, avatar.gaze[0])) * ch.gazeReach;
    const gy = Math.max(-1, Math.min(1, avatar.gaze[1])) * ch.gazeReach * 0.6;

    for (let i = 0; i < this.nV; i++) {
      let x = v[3 * i], y = v[3 * i + 1], z = v[3 * i + 2];
      if (ch.brow[i] !== 0) y += ch.brow[i] * lift;
      if (ch.gazing[i]) { x += gx; y += gy; }
      const w = ch.jaw[i];
      if (w > 0 && jawAng > 0) {
        const ang = w * jawAng;
        const c = Math.cos(ang), s = Math.sin(ang);
        const dy = y - jy, dz = z - jz;
        y = jy + dy * c - dz * s;
        z = jz + dy * s + dz * c;
      }
      const h = ch.headW[i];
      const dx = x - px, dy = y - py, dz = z - pz;
      const rx = m00 * dx + m01 * dy + m02 * dz;
      const ry = m10 * dx + m11 * dy + m12 * dz;
      const rz = m20 * dx + m21 * dy + m22 * dz;
      const tx = rx * cr - ry * sr, ty = rx * sr + ry * cr;
      x += h * (px + tx - x);
      y += h * (py + ty - y);
      z += h * (pz + rz - z);
      this.pv[3 * i] = x;
      this.pv[3 * i + 1] = y;
      this.pv[3 * i + 2] = z;
      const kk = (CAM / Math.max(CAM - z, 0.35)) * k;
      this.xs[i] = ox + x * kk;
      this.ys[i] = oy - y * kk;

      const nx = n[3 * i], ny = n[3 * i + 1], nz = n[3 * i + 2];
      const rnx = m00 * nx + m01 * ny + m02 * nz;
      const rny = m10 * nx + m11 * ny + m12 * nz;
      const rnz = m20 * nx + m21 * ny + m22 * nz;
      const tnx = rnx * cr - rny * sr, tny = rnx * sr + rny * cr;
      const fx = nx + h * (tnx - nx), fy = ny + h * (tny - ny), fz = nz + h * (rnz - nz);
      this.lit[i] = ch.unlit[i] ? 1 : ch.ambient + (1 - ch.ambient) * (Math.abs(fx * lx + fy * ly + fz * lz) / ll);
    }

    const f = ch.faces;
    for (let t = 0; t < this.nF; t++) {
      this.faceZ[t] = this.pv[3 * f[3 * t] + 2] + this.pv[3 * f[3 * t + 1] + 2] + this.pv[3 * f[3 * t + 2] + 2];
      this.order[t] = t;
    }
    const faceZ = this.faceZ;
    this.order.sort((a, b) => faceZ[a] - faceZ[b]);

    for (let s = 0; s < this.nF; s++) {
      const t = this.order[s];
      const a = f[3 * t], b = f[3 * t + 1], d = f[3 * t + 2];
      const rgb = this.triAvgColor[t] || [205, 175, 160];
      const l = Math.min(1.15, (this.lit[a] + this.lit[b] + this.lit[d]) / 3);
      ctx.fillStyle = `rgb(${(rgb[0] * l) | 0},${(rgb[1] * l) | 0},${(rgb[2] * l) | 0})`;
      ctx.beginPath();
      ctx.moveTo(this.xs[a], this.ys[a]);
      ctx.lineTo(this.xs[b], this.ys[b]);
      ctx.lineTo(this.xs[d], this.ys[d]);
      ctx.closePath();
      ctx.fill();
    }

    const projectPt = (x0, y0, z0, jawK) => {
      let x = x0, y = y0, z = z0;
      if (jawK > 0) {
        const c = Math.cos(jawK), s = Math.sin(jawK);
        const dy = y - jy, dz = z - jz;
        y = jy + dy * c - dz * s;
        z = jz + dy * s + dz * c;
      }
      const dx = x - px, dy = y - py, dz = z - pz;
      const rx = m00 * dx + m01 * dy + m02 * dz;
      const ry = m10 * dx + m11 * dy + m12 * dz;
      const rz = m20 * dx + m21 * dy + m22 * dz;
      x = px + rx * cr - ry * sr;
      y = py + rx * sr + ry * cr;
      z = pz + rz;
      const kk = (CAM / Math.max(CAM - z, 0.35)) * k;
      return [ox + x * kk, oy - y * kk];
    };

    // Open mouth overlay
    const open = Math.max(0, Math.min(1, avatar.mouth));
    if (open >= 0.03 && ch.mouth.length >= 6) {
      const m = ch.mouth;
      const nPts = (m.length / 3) | 0;
      const mcx = (m[0] + m[3 * (nPts - 1)]) / 2;
      const hw = Math.max((m[3 * (nPts - 1)] - m[0]) / 2, 1e-3);
      const up = [], lo = [];
      for (let i = 0; i < nPts; i++) {
        const x = m[3 * i], y = m[3 * i + 1], z = m[3 * i + 2];
        const d = Math.abs(x - mcx) / hw;
        const t = Math.max(0, Math.min(1, (d - 0.55) / 0.5));
        const corner = 1 - t * t * (3 - 2 * t);
        up.push(projectPt(x, y, z, 0));
        lo.push(projectPt(x, y, z, 0.92 * corner * open * JAW_MAX));
      }
      ctx.fillStyle = intToCss(ch.mouthColour, 1);
      ctx.beginPath();
      ctx.moveTo(up[0][0], up[0][1]);
      for (let i = 1; i < nPts; i++) ctx.lineTo(up[i][0], up[i][1]);
      for (let i = nPts - 1; i >= 0; i--) ctx.lineTo(lo[i][0], lo[i][1]);
      ctx.closePath();
      ctx.fill();
    }

    // Blinking eyelids
    const close = Math.max(0, Math.min(1, 1 - (1 - avatar.blink) * avatar.lids));
    if (close >= 0.04) {
      const seg = 12;
      for (const e of ch.eyes) {
        const ct = Math.cos((e.tilt * Math.PI) / 180), st = Math.sin((e.tilt * Math.PI) / 180);
        const hw = e.hw * 1.12, hh = e.hh * 1.18;
        const topPts = [], edgePts = [];
        for (let s = 0; s <= seg; s++) {
          const th = (Math.PI * s) / seg;
          const lx0 = hw * Math.cos(th);
          const lyTop = hh * Math.sin(th);
          const lyEdge = hh * Math.sin(th) * (1 - 2 * close);
          topPts.push(projectPt(e.x + lx0 * ct - lyTop * st, e.y + lx0 * st + lyTop * ct, e.z, 0));
          edgePts.push(projectPt(e.x + lx0 * ct - lyEdge * st, e.y + lx0 * st + lyEdge * ct, e.z, 0));
        }
        ctx.fillStyle = intToCss(e.lid, 1);
        ctx.beginPath();
        ctx.moveTo(topPts[0][0], topPts[0][1]);
        for (let s = 1; s <= seg; s++) ctx.lineTo(topPts[s][0], topPts[s][1]);
        for (let s = seg; s >= 0; s--) ctx.lineTo(edgePts[s][0], edgePts[s][1]);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
}

// ── CartoonRenderer (Port of CartoonAvatar.kt) ──────────────────────────────

export class CartoonRenderer {
  draw(ctx, avatar, cx, cy, r, primary) {
    ctx.save();
    ctx.translate(cx, cy);
    const scale = r * 0.85;
    ctx.scale(scale, scale);

    const fx = avatar.yaw * 0.25;
    const fy = -avatar.pitch * 0.25;
    const open = Math.max(0, Math.min(1, (1 - avatar.blink) * avatar.lids));

    // Aura
    const prR = (primary >> 16) & 0xff, prG = (primary >> 8) & 0xff, prB = primary & 0xff;
    const aura = ctx.createRadialGradient(0, 0, 0.2, 0, 0, 1.45);
    aura.addColorStop(0, `rgba(${prR},${prG},${prB},${(0.22 + 0.25 * avatar.glow).toFixed(3)})`);
    aura.addColorStop(1, `rgba(${prR},${prG},${prB},0)`);
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(0, 0, 1.45, 0, Math.PI * 2);
    ctx.fill();

    // Back hair
    ctx.fillStyle = '#1f1410';
    ctx.beginPath();
    ctx.arc(fx * 0.4, -0.25 + fy * 0.4, 0.88, Math.PI, 0);
    ctx.fill();

    // Neck & shoulders
    ctx.fillStyle = '#c8926e';
    ctx.fillRect(-0.24, 0.65, 0.48, 0.45);

    // Head oval
    const skinGrad = ctx.createRadialGradient(fx - 0.15, fy - 0.2, 0.1, fx, fy + 0.1, 0.95);
    skinGrad.addColorStop(0, '#f5ccb0');
    skinGrad.addColorStop(0.7, '#dfb08e');
    skinGrad.addColorStop(1, '#ba8562');
    ctx.fillStyle = skinGrad;
    ctx.beginPath();
    ctx.ellipse(fx * 0.6, fy * 0.6 + 0.06, 0.72, 0.84, 0, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    for (const s of [-1, 1]) {
      const ex = s * 0.31 + fx;
      const ey = -0.04 + fy;
      const ew = 0.19;
      const eh = Math.max(0.012, 0.13 * open);
      ctx.fillStyle = '#fdfbf7';
      ctx.beginPath();
      ctx.ellipse(ex, ey, ew, eh, 0, 0, Math.PI * 2);
      ctx.fill();

      if (open > 0.15) {
        const ix = ex + avatar.gaze[0] * 0.065;
        const iy = ey + avatar.gaze[1] * 0.04;
        ctx.fillStyle = '#5e3a24';
        ctx.beginPath();
        ctx.arc(ix, iy, Math.min(eh, 0.1), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#140c0a';
        ctx.beginPath();
        ctx.arc(ix, iy, Math.min(eh * 0.6, 0.048), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(ix - 0.03, iy - 0.03, 0.024, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = '#1b1210';
      ctx.lineWidth = 0.028;
      ctx.beginPath();
      ctx.ellipse(ex, ey, ew, eh, 0, Math.PI, 0);
      ctx.stroke();
    }

    // Glasses
    ctx.strokeStyle = '#14110f';
    ctx.lineWidth = 0.048;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(s * 0.315 + fx, -0.04 + fy, 0.25, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-0.065 + fx, -0.06 + fy);
    ctx.lineTo(0.065 + fx, -0.06 + fy);
    ctx.stroke();

    // Brows
    const browLift = avatar.brow * 0.06;
    ctx.strokeStyle = '#2a1b15';
    ctx.lineWidth = 0.055;
    ctx.lineCap = 'round';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * 0.11 + fx, -0.34 + fy - browLift);
      ctx.quadraticCurveTo(s * 0.31 + fx, -0.42 + fy - browLift, s * 0.5 + fx, -0.33 + fy - browLift * 0.6);
      ctx.stroke();
    }

    // Nose
    ctx.fillStyle = 'rgba(165, 110, 82, 0.45)';
    ctx.beginPath();
    ctx.arc(fx * 1.05, 0.18 + fy, 0.09, 0, Math.PI);
    ctx.fill();

    // Mouth
    const mOpen = avatar.mouth;
    const my = 0.46 + fy;
    ctx.fillStyle = '#4a1820';
    ctx.beginPath();
    ctx.ellipse(fx, my + mOpen * 0.06, 0.22 + avatar.wide * 0.05, 0.025 + mOpen * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    if (mOpen > 0.08) {
      ctx.fillStyle = '#f4f0e8';
      ctx.fillRect(fx - 0.14, my - 0.01, 0.28, Math.min(0.045, mOpen * 0.06));
    }

    // Front curly hair
    ctx.fillStyle = '#2b1c16';
    const curls = [
      [-0.5, -0.72, 0.22],
      [-0.25, -0.84, 0.25],
      [0.05, -0.88, 0.26],
      [0.35, -0.82, 0.24],
      [0.55, -0.68, 0.2],
    ];
    for (const [cx0, cy0, cr0] of curls) {
      ctx.beginPath();
      ctx.arc(cx0 + fx * 0.5, cy0 + fy * 0.4, cr0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}

// ── GlowReactor (Port of JarvisComponents.kt GlowReactor) ───────────────────

export function drawGlowReactor(ctx, cx, cy, r, primary, state, outputLevel, timeSec) {
  const prR = (primary >> 16) & 0xff, prG = (primary >> 8) & 0xff, prB = primary & 0xff;
  const active = state !== 'ASLEEP' && state !== 'ERROR';
  const alpha = active ? 1 : 0.28;
  const voice = Math.max(0, Math.min(1, outputLevel));

  // Background radial glow
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.45);
  grad.addColorStop(0, `rgba(${prR},${prG},${prB},${((0.28 + 0.35 * voice) * alpha).toFixed(3)})`);
  grad.addColorStop(0.55, `rgba(${prR},${prG},${prB},${(0.1 * alpha).toFixed(3)})`);
  grad.addColorStop(1, `rgba(${prR},${prG},${prB},0)`);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.45, 0, Math.PI * 2);
  ctx.fill();

  // Outer gauge ticks
  ctx.save();
  ctx.translate(cx, cy);
  const speed = state === 'THINKING' ? 1.8 : state === 'SPEAKING' ? 1.1 : 0.45;
  ctx.rotate(timeSec * speed);
  for (let i = 0; i < 36; i++) {
    const ang = (i * Math.PI * 2) / 36;
    const isMajor = i % 3 === 0;
    const r0 = r * (isMajor ? 0.86 : 0.9);
    const r1 = r * 0.96;
    ctx.strokeStyle = `rgba(${prR},${prG},${prB},${((isMajor ? 0.75 : 0.35) * alpha).toFixed(3)})`;
    ctx.lineWidth = isMajor ? 2.2 : 1.2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(ang) * r0, Math.sin(ang) * r0);
    ctx.lineTo(Math.cos(ang) * r1, Math.sin(ang) * r1);
    ctx.stroke();
  }
  ctx.restore();

  // Counter-rotating segmented arcs
  for (const [radiusFrac, dir, widthFrac, segs] of [
    [0.76, -1.2, 0.038, 3],
    [0.62, 1.6, 0.026, 4],
  ]) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(timeSec * dir * speed);
    ctx.strokeStyle = `rgba(${prR},${prG},${prB},${(0.75 * alpha).toFixed(3)})`;
    ctx.lineWidth = Math.max(2, r * widthFrac);
    ctx.lineCap = 'round';
    for (let s = 0; s < segs; s++) {
      const a0 = (s * Math.PI * 2) / segs + 0.18;
      const a1 = ((s + 1) * Math.PI * 2) / segs - 0.28;
      ctx.beginPath();
      ctx.arc(0, 0, r * radiusFrac, a0, a1);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Audio waveform spikes around core
  const bars = 48;
  const baseR = r * 0.42;
  ctx.strokeStyle = `rgba(${prR},${prG},${prB},${(0.88 * alpha).toFixed(3)})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < bars; i++) {
    const a = (i * Math.PI * 2) / bars;
    const wave = Math.abs(Math.sin(timeSec * 8 + i * 0.45)) * voice * r * 0.16;
    const rOut = baseR + 3 + wave;
    ctx.moveTo(cx + Math.cos(a) * baseR, cy + Math.sin(a) * baseR);
    ctx.lineTo(cx + Math.cos(a) * rOut, cy + Math.sin(a) * rOut);
  }
  ctx.stroke();

  // Inner glowing core
  const coreR = r * (0.28 + 0.08 * voice + 0.02 * Math.sin(timeSec * 3));
  const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
  coreGrad.addColorStop(0, `rgba(255,255,255,${(0.92 * alpha).toFixed(3)})`);
  coreGrad.addColorStop(0.55, `rgba(${prR},${prG},${prB},${(0.85 * alpha).toFixed(3)})`);
  coreGrad.addColorStop(1, `rgba(${prR},${prG},${prB},0.1)`);
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
  ctx.fill();
}
