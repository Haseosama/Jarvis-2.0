// Port of Visemes.kt, VisemeTimeline.kt, and HoloAvatar.kt from Jarvis-Android

import { JAW_PIVOT, JAW_MAX } from './HeadMesh.js';

export const VISEMES = {
  REST: { open: 0.0, wide: 0.0, closure: 0.0 },
  M:    { open: 0.0, wide: 0.0, closure: 1.0 },
  F:    { open: 0.12, wide: 0.15, closure: 0.55 },
  S:    { open: 0.16, wide: 0.35, closure: 0.35 },
  T:    { open: 0.26, wide: 0.15, closure: 0.15 },
  K:    { open: 0.38, wide: 0.0, closure: 0.0 },
  I:    { open: 0.34, wide: 0.85, closure: 0.0 },
  E:    { open: 0.54, wide: 0.52, closure: 0.0 },
  A:    { open: 0.92, wide: 0.10, closure: 0.0 },
  O:    { open: 0.68, wide: -0.65, closure: 0.0 },
  U:    { open: 0.32, wide: -0.90, closure: 0.0 },
};

const DURATION = {
  REST: 0.55, M: 0.78, F: 0.76, S: 0.80, T: 0.72, K: 0.76,
  I: 1.12, E: 1.18, A: 1.32, O: 1.24, U: 1.15,
};

const TRIGRAPH = {
  eau: 'O', oin: 'O', ain: 'E', ein: 'E', aim: 'E',
  tch: 'S', sch: 'S', ill: 'I', gue: 'K', gui: 'I',
};

const DIGRAPH = {
  ou: 'U', au: 'O', eu: 'O', oe: 'O', oi: 'O', ai: 'E', ei: 'E',
  et: 'E', er: 'E', ez: 'E', ch: 'S', sh: 'S', ph: 'F', th: 'T',
  gn: 'I', qu: 'K', gu: 'K', an: 'A', am: 'A', en: 'A', em: 'A',
  on: 'O', om: 'O', in: 'E', im: 'E', un: 'O', um: 'O', yn: 'E',
};

const LETTER = {
  a: 'A', b: 'M', c: 'K', d: 'T', e: 'E', f: 'F', g: 'K', h: 'REST',
  i: 'I', j: 'S', k: 'K', l: 'T', m: 'M', n: 'T', o: 'O', p: 'M',
  q: 'K', r: 'K', s: 'S', t: 'T', u: 'U', v: 'F', w: 'U', x: 'S',
  y: 'I', z: 'S',
};

function toLatin(ch) {
  return ch
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function textToVisemes(text) {
  const s = String(text || '');
  const out = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/[.,;:!?—–\-]/.test(ch)) {
      if (out.length === 0 || out[out.length - 1][0] !== 'REST') {
        out.push(['REST', DURATION.REST]);
      }
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      while (i < s.length && /\s/.test(s[i])) i++;
      // Subtle syllable transition between words for natural French rhythm
      if (out.length > 0 && out[out.length - 1][0] !== 'REST' && out[out.length - 1][0] !== 'M') {
        out.push(['T', 0.32]);
      }
      continue;
    }
    const c1 = toLatin(ch);
    const c2 = i + 1 < s.length ? toLatin(s[i + 1]) : '';
    const c3 = i + 2 < s.length ? toLatin(s[i + 2]) : '';
    const three = c1 + c2 + c3;
    const two = c1 + c2;
    let v = null;
    if (three.length === 3 && TRIGRAPH[three]) {
      v = TRIGRAPH[three];
      i += 3;
    } else if (two.length === 2 && DIGRAPH[two]) {
      v = DIGRAPH[two];
      i += 2;
    } else {
      const nextIsBreak = i + 1 >= s.length || /[\s.,;:!?—–\-]/.test(s[i + 1]);
      i++;
      if (!c1) continue;
      // Silent final e / s / t / d / x / z in French words
      if (nextIsBreak && /^[estdxzp]$/.test(c1) && out.length > 0) {
        continue;
      }
      v = LETTER[c1[0]];
      if (!v) continue;
    }
    if (out.length > 0 && out[out.length - 1][0] === v) {
      out[out.length - 1][1] = Math.min(1.8, out[out.length - 1][1] + 0.25);
      continue;
    }
    out.push([v, DURATION[v] || 1.0]);
  }
  if (out.length === 0 || out[out.length - 1][0] !== 'REST') {
    out.push(['REST', DURATION.REST]);
  }
  return out;
}

export class VisemeStream {
  constructor() {
    this.queue = [];
    this.current = ['REST', 1.0];
    this.carry = 0;
  }

  reset() {
    this.queue = [];
    this.current = ['REST', 1.0];
    this.carry = 0;
  }

  feedText(text) {
    const items = textToVisemes(text);
    for (const it of items) this.queue.push(it);
    while (this.queue.length > 600) this.queue.shift();
  }

  stepSeconds() {
    const backlog = Math.min(1, this.queue.length / 45);
    return 0.105 - (0.105 - 0.045) * backlog;
  }

  frames(audioFrames, hop = 0.02) {
    const out = [];
    for (const a of audioFrames) {
      if (a.level <= 0) {
        out.push({ level: 0, open: 0, wide: 0 });
        continue;
      }
      this.carry += hop / Math.max(1e-3, this.stepSeconds() * this.current[1]);
      while (this.carry >= 1 && this.queue.length > 0) {
        this.current = this.queue.shift();
        this.carry -= 1;
      }
      if (this.carry >= 1) this.carry = 1;
      const shape = VISEMES[this.current[0]] || VISEMES.REST;
      let o, w, closure = shape.closure;
      if (this.queue.length > 0 || this.current[0] !== 'REST') {
        o = 0.72 * shape.open + 0.28 * a.open;
        w = 0.78 * shape.wide + 0.22 * a.wide;
      } else {
        o = a.open;
        w = a.wide;
        closure = 0;
      }
      o *= 1 - closure;
      out.push({
        level: a.level,
        open: Math.max(0, Math.min(1, o)),
        wide: Math.max(-1, Math.min(1, w)),
      });
    }
    return out;
  }
}

// ── FFT & PCM Audio Formant Analysis ─────────────────────────────────────────

const VIS_WIN = 1024;
const VIS_HOP = 480; // 20 ms at 24 kHz
const HANN = new Float32Array(VIS_WIN);
for (let i = 0; i < VIS_WIN; i++) {
  HANN[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (VIS_WIN - 1));
}

function fft(re, im) {
  const n = re.length;
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = i + k + half;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

export function pcmVisemes(samplesFloat32, sampleRate = 24000) {
  if (!samplesFloat32 || samplesFloat32.length < 120) return [];
  const hop = Math.max(120, Math.round(sampleRate * 0.02));
  const binHz = sampleRate / VIS_WIN;
  const bin = (hz) => Math.max(0, Math.min(VIS_WIN >> 1, Math.floor(hz / binHz)));
  const f1loA = bin(150), f1loB = bin(450);
  const f1hiA = bin(450), f1hiB = bin(1100);
  const f2bkA = bin(600), f2bkB = bin(1300);
  const f2frA = bin(1700), f2frB = bin(3200);
  const hissA = bin(3800), hissB = bin(8000);

  const re = new Float32Array(VIS_WIN);
  const im = new Float32Array(VIS_WIN);
  const out = [];

  for (let start = 0; start < samplesFloat32.length; start += hop) {
    const end = Math.min(samplesFloat32.length, start + hop);
    let sum = 0;
    for (let i = start; i < end; i++) {
      const v = samplesFloat32[i] * 32768;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / Math.max(1, end - start));
    const level = rms <= 60 ? 0 : Math.min(1, (rms - 60) / (2600 - 60));
    if (level <= 0) {
      out.push({ level: 0, open: 0, wide: 0 });
      continue;
    }
    for (let i = 0; i < VIS_WIN; i++) {
      const idx = start + i;
      re[i] = idx < samplesFloat32.length ? samplesFloat32[idx] * HANN[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    const band = (a, b) => {
      let s = 0;
      for (let k = a; k < b; k++) s += Math.hypot(re[k], im[k]);
      return s;
    };
    const f1l = band(f1loA, f1loB);
    const f1h = band(f1hiA, f1hiB);
    const f2b = band(f2bkA, f2bkB);
    const f2f = band(f2frA, f2frB);
    const hiss = band(hissA, hissB);
    let openness = f1h / (f1l + f1h + 1e-6);
    let width = (f2f - f2b) / (f2f + f2b + 1e-6);
    width *= Math.pow(Math.max(0, 1 - openness), 0.8);
    const h = hiss / (f1l + f1h + f2b + f2f + hiss + 1e-6);
    openness *= 1 - 0.65 * Math.min(1, h * 2.5);
    out.push({
      level,
      open: Math.max(0, Math.min(1, openness)),
      wide: Math.max(-1, Math.min(1, width)),
    });
  }
  return out;
}

export class VisemeTimeline {
  constructor(hopMs = 20, tailMs = 150) {
    this.hopMs = hopMs;
    this.tailMs = tailMs;
    this.chunks = [];
    this.endMs = 0;
    this.lastMs = 0;
  }

  push(frames, nowMs = performance.now(), latencyMs = 40) {
    if (!frames || frames.length === 0) return;
    const start = Math.max(nowMs + latencyMs, this.endMs);
    this.chunks.push({ startMs: start, frames });
    this.endMs = start + frames.length * this.hopMs;
  }

  clear() {
    this.chunks = [];
    this.endMs = 0;
  }

  sample(nowMs = performance.now()) {
    if (this.lastMs === 0 || nowMs < this.lastMs) this.lastMs = nowMs - this.hopMs;
    const due = [];
    const kept = [];
    for (const c of this.chunks) {
      for (let i = 0; i < c.frames.length; i++) {
        const slot = c.startMs + i * this.hopMs;
        if (slot > this.lastMs && slot <= nowMs) due.push(c.frames[i]);
      }
      if (c.startMs + c.frames.length * this.hopMs > nowMs) kept.push(c);
    }
    this.chunks = kept;
    this.lastMs = nowMs;
    const speaking = this.endMs !== 0 && nowMs < this.endMs + this.tailMs;
    return {
      frames: due.length > 15 ? due.slice(due.length - 15) : due,
      speaking,
    };
  }
}

// ── HoloAvatar (3D Head Pose & Spring Hair & Facial Acting) ──────────────────

const BROW_LIFT = 0.14;
const HAIR_STIFFNESS = 38;
const HAIR_DAMPING = 7.5;
const HAIR_PIVOT_X = 0;
const HAIR_PIVOT_Y = 0.55;
const HAIR_PIVOT_Z = -0.25;

const TAU_OPEN = 0.022;
const TAU_SHUT = 0.012;
const TAU_REST = 0.055;
const TAU_SHAPE = 0.018;
const MIC_FLOOR = 0.14;
const CLOSE_FRAC = 0.10;

function rate(dt, tau) {
  return 1 - Math.exp(-dt / tau);
}

export class HoloAvatar {
  constructor(mesh) {
    this.mesh = mesh;
    this.time = 0;
    this.sway = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.mouth = 0;
    this.glow = 0;
    this.scan = -1.6;
    this.blink = 0;
    this.blinkAt = 2.8;
    this.ampSlow = 0;
    this.expr = 0;
    this.exprTgt = 0;
    this.exprAt = 0;
    this.brow = 0;
    this.emph = 0;
    this.gaze = [0, 0];
    this.gazeTgt = [0, 0];
    this.gazeAt = 0;
    this.gazeBias = [0, 0];
    this.biasTgt = [0, 0];
    this.biasAt = 0;
    this.lids = 1;
    this.browBias = 0;
    this.glanceTarget = null;
    this.vOpen = 1;
    this.vPeak = 0.18;
    this.wide = 0;
    this.lastVWide = 0;
    this.watching = false;
    this.reactAt = -10;

    this.pv = new Float32Array(mesh.verts.length);
    this.pn = new Float32Array(mesh.normals.length);

    // Hair sway weights
    if (mesh.hairSway) {
      this.swayWeight = mesh.hairSway;
    } else {
      this.swayWeight = new Float32Array(mesh.vertexCount);
      const rows = mesh.lockRows;
      if (mesh.lockCount > 0 && rows > 1) {
        for (let l = 0; l < mesh.lockCount; l++) {
          for (let r = 0; r < rows; r++) {
            for (let k = 0; k < 3; k++) {
              const i = mesh.lockFirst + (l * rows + r) * 3 + k;
              if (i >= mesh.vertexCount) continue;
              const along = r / (rows - 1);
              const y = mesh.verts[3 * i + 1];
              const low = Math.max(0, Math.min(1, (0.35 - y) / 1.1));
              this.swayWeight[i] = 0.6 * along * along * (0.35 + 0.65 * low);
            }
          }
        }
      }
    }

    const swayingList = [];
    for (let i = 0; i < this.swayWeight.length; i++) {
      if (this.swayWeight[i] > 0.01) swayingList.push(i);
    }
    this.swaying = new Int32Array(swayingList);

    this.hairYaw = 0; this.hairYawV = 0;
    this.hairPitch = 0; this.hairPitchV = 0;
    this.hairRoll = 0; this.hairRollV = 0;

    // Corner factor for natural almond-shaped jaw opening
    const cx = mesh.lipCentre[0];
    let halfWidth = 0.01;
    for (let k = 0; k < mesh.mouthLower.length; k++) {
      const idx = mesh.mouthLower[k];
      halfWidth = Math.max(halfWidth, Math.abs(mesh.verts[3 * idx] - cx));
    }
    this.cornerFactor = new Float32Array(mesh.vertexCount);
    for (let i = 0; i < mesh.vertexCount; i++) {
      const d = Math.abs(mesh.verts[3 * i] - cx) / halfWidth;
      const t = Math.max(0, Math.min(1, (d - 0.55) / (1.05 - 0.55)));
      this.cornerFactor[i] = 1 - t * t * (3 - 2 * t);
    }
  }

  react() {
    this.reactAt = this.time;
  }

  glance(dx, dy, hold = 1.1) {
    this.glanceTarget = [Math.max(-1, Math.min(1, dx)), Math.max(-1, Math.min(1, dy)), this.time + Math.max(0.1, hold)];
  }

  mouthStep(dt, amp, live, vOpenIn, vLevel) {
    let shape;
    if (vOpenIn == null) {
      shape = 1;
    } else {
      this.vOpen += (vOpenIn - this.vOpen) * rate(dt, TAU_SHAPE);
      shape = this.vOpen;
    }
    let drive;
    if (vLevel == null) {
      const gated = Math.max(0, (amp - MIC_FLOOR) / (1 - MIC_FLOOR));
      drive = Math.pow(gated, 0.6) * Math.pow(shape, 0.75);
    } else {
      this.vPeak = Math.max(vLevel, this.vPeak - dt * 0.55);
      const ref = Math.max(0.18, this.vPeak);
      const q = Math.max(0, Math.min(1, (vLevel - CLOSE_FRAC * ref) / (ref * (1 - CLOSE_FRAC))));
      drive = Math.pow(q, 0.85) * Math.pow(shape, 0.75);
    }
    const target = live ? Math.min(1, drive) : 0;
    const tau = target > this.mouth ? TAU_OPEN : live ? TAU_SHUT : TAU_REST;
    this.mouth += (target - this.mouth) * rate(dt, tau);
    if (this.mouth < 0.002) this.mouth = 0;
  }

  step(dtIn, amp0, speaking, mood = 'IDLE', frames = null, hop = 0.02) {
    const dt = Math.max(0.001, Math.min(0.1, dtIn));
    this.time += dt;
    const t = this.time;
    const amp = Math.max(0, Math.min(1, amp0));
    const live = Boolean(speaking);

    this.sway += dt * (live ? 1.25 : 1);
    const s = this.sway;
    this.yaw = 0.26 * Math.sin(s * 0.31) + 0.09 * Math.sin(s * 0.73 + 1.3);
    this.pitch = 0.06 * Math.sin(s * 0.23 + 0.7) + 0.024 * Math.sin(s * 0.61);
    this.roll = 0.045 * Math.sin(s * 0.17 + 2.6) + 0.018 * Math.sin(s * 0.44);

    if (frames && frames.length > 0) {
      for (const f of frames) this.mouthStep(hop, amp, live, f.open, f.level);
      this.lastVWide = frames[frames.length - 1].wide;
    } else {
      this.mouthStep(dt, amp, live, null, null);
    }

    this.emph += (this.mouth - this.emph) * rate(dt, this.mouth > this.emph ? 0.055 : 0.32);
    this.pitch -= this.emph * 0.028;
    this.yaw += 0.018 * Math.sin(t * 1.7) * this.emph;

    if (this.swaying.length > 0) {
      let left = dt;
      const stepSpring = (pos, vel, target, h) => {
        const acc = (target - pos) * HAIR_STIFFNESS - vel * HAIR_DAMPING;
        const v = vel + acc * h;
        return [pos + v * h, v];
      };
      while (left > 0) {
        const h = Math.min(left, 0.016);
        left -= h;
        [this.hairYaw, this.hairYawV] = stepSpring(this.hairYaw, this.hairYawV, this.yaw, h);
        [this.hairPitch, this.hairPitchV] = stepSpring(this.hairPitch, this.hairPitchV, this.pitch, h);
        [this.hairRoll, this.hairRollV] = stepSpring(this.hairRoll, this.hairRollV, this.roll, h);
      }
    }

    const env = live ? amp : 0;
    this.ampSlow += (env - this.ampSlow) * rate(dt, env > this.ampSlow ? 0.16 : 0.36);

    if (live) {
      if (t >= this.exprAt) {
        this.exprTgt = Math.random() * 1.35 - 0.35;
        this.exprAt = t + 1.1 + 2 * Math.random();
      }
    } else {
      this.exprTgt = 0;
      this.exprAt = t + 0.8;
    }
    this.expr += (this.exprTgt - this.expr) * rate(dt, 0.43);

    const browT = Math.max(-0.4, Math.min(1.2, 0.55 * this.ampSlow + 0.6 * this.expr + this.browBias));
    this.brow += (browT - this.brow) * rate(dt, 0.15);

    const sinceReact = t - this.reactAt;
    if (sinceReact >= 0 && sinceReact <= 0.9) {
      const bump = Math.sin((Math.PI * sinceReact) / 0.9);
      this.brow += 0.55 * bump;
      this.pitch -= 0.07 * bump;
    }

    const thinking = mood === 'THINKING';
    const asleep = mood === 'ASLEEP';
    let browBiasTarget, lidTarget;
    if (thinking) {
      if (t >= this.biasAt) {
        this.biasTgt[0] = (Math.random() < 0.5 ? -1 : 1) * (0.45 + 0.35 * Math.random());
        this.biasTgt[1] = 0.25 + 0.3 * Math.random();
        this.biasAt = t + 1.4 + 1.6 * Math.random();
      }
      browBiasTarget = -0.28;
      lidTarget = 0.94;
    } else if (asleep) {
      this.biasTgt[0] = 0;
      this.biasTgt[1] = -0.25;
      browBiasTarget = -0.05;
      lidTarget = 0.22;
    } else {
      this.biasTgt[0] = 0;
      this.biasTgt[1] = this.watching ? -0.6 : 0;
      this.biasAt = 0;
      browBiasTarget = mood === 'LISTENING' ? 0.1 : 0;
      lidTarget = 1;
    }
    this.gazeBias[0] += (this.biasTgt[0] - this.gazeBias[0]) * rate(dt, 0.54);
    this.gazeBias[1] += (this.biasTgt[1] - this.gazeBias[1]) * rate(dt, 0.54);
    this.lids += (lidTarget - this.lids) * rate(dt, 0.4);
    this.browBias += (browBiasTarget - this.browBias) * rate(dt, 0.54);

    if (t >= this.gazeAt) {
      const reach = live ? 0.9 : thinking ? 0.35 : 0.55;
      this.gazeTgt[0] = (Math.random() * 2 - 1) * reach;
      this.gazeTgt[1] = (Math.random() * 2 - 1) * reach * 0.55;
      this.gazeAt = t + (live ? 0.55 + 1.7 * Math.random() : thinking ? 1.8 + 2.4 * Math.random() : 1.3 + 2.8 * Math.random());
    }
    if (this.glanceTarget) {
      if (t < this.glanceTarget[2]) {
        this.gazeTgt[0] = this.glanceTarget[0];
        this.gazeTgt[1] = this.glanceTarget[1];
      } else {
        this.glanceTarget = null;
      }
    }
    for (let i = 0; i < 2; i++) {
      const tgt = Math.max(-1, Math.min(1, this.gazeTgt[i] + this.gazeBias[i]));
      this.gaze[i] += (tgt - this.gaze[i]) * rate(dt, 0.09);
    }

    const wideT = live && frames ? this.lastVWide : 0;
    this.wide += (Math.max(-1, Math.min(1, wideT)) - this.wide) * rate(dt, 0.03);

    const gl = amp;
    this.glow += (gl - this.glow) * (gl > this.glow ? 0.35 : 0.1);
    this.scan += dt * (0.55 + 1.5 * this.glow);
    if (this.scan > 1.35) this.scan = -1.75;

    if (this.blink > 0) {
      this.blink = Math.max(0, this.blink - dt * 8.5);
    } else if (t >= this.blinkAt) {
      if (asleep) {
        this.blinkAt = t + 6;
      } else {
        this.blink = 1;
        this.blinkAt = t + (thinking ? 5.5 : 3.4) + 3.1 * Math.random();
      }
    }
  }

  pose() {
    const mesh = this.mesh;
    const n = mesh.vertexCount;
    const v = this.pv;
    const nrm = this.pn;
    v.set(mesh.verts);

    if (Math.abs(this.brow) > 0.004) {
      const k = this.brow * BROW_LIFT;
      for (let i = 0; i < n; i++) v[3 * i + 1] += mesh.brow[i] * k;
    }

    const close = Math.max(0, Math.min(0.97, 1 - (1 - this.blink) * Math.max(0, Math.min(1, this.lids))));
    if (close > 0.01) {
      for (let i = 0; i < n; i++) {
        const l = mesh.lid[i];
        if (l !== 0) v[3 * i + 1] -= l * close;
      }
    }

    const ey = this.gaze[0] * 0.32;
    const ep = this.gaze[1] * 0.26;
    const cye = Math.cos(ey), sye = Math.sin(ey), cpe = Math.cos(ep), spe = Math.sin(ep);
    for (let e = 0; e < mesh.eyeFirst.length; e++) {
      const cx = mesh.eyeCentre[3 * e];
      const cy0 = mesh.eyeCentre[3 * e + 1];
      const cz = mesh.eyeCentre[3 * e + 2];
      const start = mesh.eyeFirst[e];
      const end = start + mesh.eyeCount[e];
      for (let i = start; i < end; i++) {
        const x = v[3 * i] - cx, y = v[3 * i + 1] - cy0, z = v[3 * i + 2] - cz;
        const x1 = x * cye + z * sye, z1 = -x * sye + z * cye;
        const y2 = y * cpe - z1 * spe, z2 = y * spe + z1 * cpe;
        v[3 * i] = cx + x1;
        v[3 * i + 1] = cy0 + y2;
        v[3 * i + 2] = cz + z2;
      }
    }

    if (Math.abs(this.wide) > 0.01 && (this.mouth > 0.002 || Math.abs(this.wide) > 0.15)) {
      const active = Math.max(this.mouth, 0.28);
      const kk = this.wide * active;
      const lx = mesh.lipCentre[0];
      const ly = mesh.lipCentre[1];
      for (let i = 0; i < n; i++) {
        const k = mesh.lips[i] * kk;
        if (k === 0) continue;
        v[3 * i] += k * (v[3 * i] - lx) * 0.62;
        v[3 * i + 1] += k * (v[3 * i + 1] - ly) * 0.28;
        // Rounded vowels (wide < 0 => k < 0) protrude lips forward (+z), wide vowels pull corners back (-z)
        v[3 * i + 2] -= k * 0.065;
      }
    }

    if (this.mouth > 0.003) {
      const py = JAW_PIVOT[1], pz = JAW_PIVOT[2];
      const upperLift = this.mouth * 0.018;
      const ly = mesh.lipCentre[1];
      for (let i = 0; i < n; i++) {
        const lm = mesh.lipMask[i];
        if (lm > 0.05 && v[3 * i + 1] > ly && mesh.jaw[i] < 0.35) {
          v[3 * i + 1] += lm * upperLift * this.cornerFactor[i];
        }
        const w = mesh.jaw[i];
        if (w === 0) continue;
        const ang = w * this.cornerFactor[i] * (this.mouth * (JAW_MAX * 1.12));
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const dy = v[3 * i + 1] - py;
        const dz = v[3 * i + 2] - pz;
        v[3 * i + 1] = py + dy * ca - dz * sa;
        v[3 * i + 2] = pz + dy * sa + dz * ca;
      }
    }

    if (this.swaying.length > 0) {
      const lagY = Math.max(-0.35, Math.min(0.35, this.hairYaw - this.yaw)) + 0.012 * Math.sin(this.time * 1.3);
      const lagP = Math.max(-0.3, Math.min(0.3, this.hairPitch - this.pitch));
      const lagR = Math.max(-0.3, Math.min(0.3, this.hairRoll - this.roll)) + 0.008 * Math.sin(this.time * 0.9 + 1);
      for (let sIdx = 0; sIdx < this.swaying.length; sIdx++) {
        const i = this.swaying[sIdx];
        const w = this.swayWeight[i];
        const ax = lagP * w, ay = lagY * w, az = lagR * w;
        const dx = v[3 * i] - HAIR_PIVOT_X;
        const dy = v[3 * i + 1] - HAIR_PIVOT_Y;
        const dz = v[3 * i + 2] - HAIR_PIVOT_Z;
        v[3 * i] += ay * dz - az * dy;
        v[3 * i + 1] += az * dx - ax * dz;
        v[3 * i + 2] += ax * dy - ay * dx;
      }
    }

    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cr = Math.cos(this.roll), sr = Math.sin(this.roll);
    const m00 = cy, m01 = 0, m02 = sy;
    const m10 = sp * sy, m11 = cp, m12 = -sp * cy;
    const m20 = -cp * sy, m21 = sp, m22 = cp * cy;

    for (let i = 0; i < n; i++) {
      const h = mesh.fade[i];
      const x = v[3 * i], y = v[3 * i + 1], z = v[3 * i + 2];
      const rx = m00 * x + m01 * y + m02 * z;
      const ry = m10 * x + m11 * y + m12 * z;
      const rz = m20 * x + m21 * y + m22 * z;
      const tx = rx * cr - ry * sr;
      const ty = rx * sr + ry * cr;
      v[3 * i] = x + h * (tx - x);
      v[3 * i + 1] = y + h * (ty - y);
      v[3 * i + 2] = z + h * (rz - z);

      const nx = mesh.normals[3 * i], ny = mesh.normals[3 * i + 1], nz = mesh.normals[3 * i + 2];
      const rnx = m00 * nx + m01 * ny + m02 * nz;
      const rny = m10 * nx + m11 * ny + m12 * nz;
      const rnz = m20 * nx + m21 * ny + m22 * nz;
      const tnx = rnx * cr - rny * sr;
      const tny = rnx * sr + rny * cr;
      nrm[3 * i] = nx + h * (tnx - nx);
      nrm[3 * i + 1] = ny + h * (tny - ny);
      nrm[3 * i + 2] = nz + h * (rnz - nz);
    }
  }
}
