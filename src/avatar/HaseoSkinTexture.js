import * as THREE from 'three';

export const HASEO_EYE_UV_CENTERS = [
  [0.4425, 0.609],
  [0.384, 0.555],
];

const PALETTES = {
  0: { base: [5, 20, 58], light: [16, 59, 120], glow: [38, 205, 255] },
  1: { base: [106, 69, 56], light: [231, 177, 143], glow: [58, 203, 255] },
  2: { base: [94, 52, 36], light: [209, 140, 97], glow: [58, 203, 255] },
  3: { base: [73, 38, 27], light: [173, 104, 69], glow: [58, 203, 255] },
  4: { base: [43, 27, 24], light: [119, 73, 56], glow: [58, 203, 255] },
  5: { base: [77, 46, 14], light: [211, 155, 59], glow: [255, 205, 92] },
  6: { base: [8, 60, 78], light: [43, 173, 194], glow: [81, 238, 255] },
  7: { base: [7, 35, 103], light: [31, 101, 199], glow: [66, 222, 255] },
  8: { base: [4, 18, 60], light: [25, 60, 139], glow: [68, 178, 255] },
};

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function blendPixel(data, size, x, y, color, alpha) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= size || iy >= size) return;
  const offset = 4 * (iy * size + ix);
  const a = clamp01(alpha);
  const inv = 1 - a;
  data[offset] = data[offset] * inv + color[0] * a;
  data[offset + 1] = data[offset + 1] * inv + color[1] * a;
  data[offset + 2] = data[offset + 2] * inv + color[2] * a;
  data[offset + 3] = 255;
}

function stamp(data, size, cx, cy, radius, color, alpha) {
  const r = Math.max(1, radius);
  const r2 = r * r;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const d2 = (x - cx) ** 2 + (y - cy) ** 2;
      if (d2 > r2) continue;
      const falloff = 1 - Math.sqrt(d2) / r;
      blendPixel(data, size, x, y, color, alpha * falloff);
    }
  }
}

function strokeSegment(data, size, a, b, color, width, alpha) {
  const x0 = a[0] * size;
  const y0 = a[1] * size;
  const x1 = b[0] * size;
  const y1 = b[1] * size;
  const length = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(length * 1.4));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    stamp(data, size, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, width, color, alpha);
  }
}

function drawTrace(data, size, points, glow, accent) {
  const dark = [3, 17, 49];
  for (let i = 1; i < points.length; i++) {
    strokeSegment(data, size, points[i - 1], points[i], glow, size * 0.005, 0.11);
    strokeSegment(data, size, points[i - 1], points[i], dark, size * 0.0018, 0.60);
    strokeSegment(data, size, points[i - 1], points[i], accent, size * 0.0010, 0.63);
  }
  const end = points[points.length - 1];
  stamp(data, size, end[0] * size, end[1] * size, size * 0.003, glow, 0.32);
  stamp(data, size, end[0] * size, end[1] * size, size * 0.0015, accent, 0.95);
}

function drawIris(data, size, center) {
  const cx = center[0] * size;
  const cy = center[1] * size;
  const rx = size * 0.0085;
  const ry = size * 0.0105;
  const x0 = Math.floor(cx - rx - 1);
  const x1 = Math.ceil(cx + rx + 1);
  const y0 = Math.floor(cy - ry - 1);
  const y1 = Math.ceil(cy + ry + 1);

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const radius = Math.hypot(dx, dy);
      if (radius > 1) continue;
      let color;
      if (radius > 0.78) color = [4, 26, 78];
      else if (radius > 0.30) {
        const ray = 0.5 + 0.5 * Math.sin(Math.atan2(dy, dx) * 22 + radius * 28);
        const t = clamp01((0.78 - radius) / 0.48 + ray * 0.16);
        color = [20 + 48 * t, 83 + 132 * t, 177 + 74 * t];
      } else color = [3, 13, 41];
      blendPixel(data, size, x, y, color, 1);
    }
  }

  // A crisp deep-blue pupil, with a small cyan catchlight like the supplied reference.
  stamp(data, size, cx, cy, size * 0.0027, [2, 12, 36], 1);
  stamp(data, size, cx - size * 0.0018, cy - size * 0.0027, size * 0.0013, [224, 247, 255], 0.95);
}

export function buildHaseoSkinPixels(skinMode = 7, accentHex = 0xff5ce1e6, showCircuits = true, size = 1024) {
  const palette = PALETTES[skinMode] || PALETTES[7];
  const data = new Uint8Array(size * size * 4);
  const accent = [
    (accentHex >>> 16) & 0xff,
    (accentHex >>> 8) & 0xff,
    accentHex & 0xff,
  ];

  // Fine mottling and soft tonal variation give the FBX a blue, skin-like finish
  // without relying on the missing external image referenced by the original file.
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      let hash = (Math.imul(x + 1, 374761393) + Math.imul(y + 1, 668265263)) | 0;
      hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
      const grain = ((hash >>> 0) / 4294967295 - 0.5) * 0.13;
      const contour = Math.sin(u * 17 + Math.sin(v * 9)) * 0.055 + Math.sin(v * 23 - u * 8) * 0.035;
      const highlight = Math.max(0, Math.sin((u + v * 0.27) * Math.PI * 2)) * 0.10;
      const factor = Math.max(0.58, Math.min(1.24, 0.88 + grain + contour + highlight));
      const offset = 4 * (y * size + x);
      for (let channel = 0; channel < 3; channel++) {
        const value = palette.base[channel] * factor + palette.light[channel] * (0.08 + highlight * 0.45);
        data[offset + channel] = Math.max(0, Math.min(255, value));
      }
      data[offset + 3] = 255;
    }
  }

  // Short etched traces around the eye line and cheeks echo the blue cybernetic
  // skin in the reference image while remaining subtle enough to read as texture.
  if (showCircuits) {
    const traces = [
      [[0.305, 0.652], [0.333, 0.652], [0.352, 0.635], [0.373, 0.635], [0.389, 0.618]],
      [[0.351, 0.523], [0.371, 0.523], [0.387, 0.539], [0.405, 0.539], [0.421, 0.555]],
      [[0.445, 0.631], [0.465, 0.647], [0.489, 0.647], [0.506, 0.666], [0.532, 0.666]],
      [[0.402, 0.488], [0.427, 0.488], [0.445, 0.504], [0.472, 0.504]],
      [[0.492, 0.594], [0.514, 0.594], [0.531, 0.611], [0.558, 0.611]],
      [[0.392, 0.694], [0.414, 0.677], [0.438, 0.677], [0.457, 0.696], [0.482, 0.696]],
      [[0.305, 0.592], [0.321, 0.608], [0.344, 0.608], [0.359, 0.624]],
      [[0.464, 0.554], [0.482, 0.538], [0.508, 0.538], [0.528, 0.519]],
    ];
    for (const trace of traces) drawTrace(data, size, trace, palette.glow, accent);
  }

  for (const eye of HASEO_EYE_UV_CENTERS) drawIris(data, size, eye);
  return data;
}

export function createHaseoSkinTexture(skinMode = 7, accentHex = 0xff5ce1e6, showCircuits = true, size = 1024) {
  const texture = new THREE.DataTexture(
    buildHaseoSkinPixels(skinMode, accentHex, showCircuits, size),
    size,
    size,
    THREE.RGBAFormat,
    THREE.UnsignedByteType
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
