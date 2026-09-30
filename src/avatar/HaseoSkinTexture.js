import * as THREE from 'three';

// Léa's iris is centred on the middle of her eye opening. Reuse that natural
// proportion for Haseo: iris radius is 20% of the eyelid opening in each axis.
export const LEA_IRIS_APERTURE_RATIO = 0.2;

const FALLBACK_EYES = [
  { name: 'EyeBlink_L', center: [0.0279, 0.0392, 0.0684], normal: [0.08, 0.12, 0.99], radius: [0.0069, 0.0053] },
  { name: 'EyeBlink_R', center: [-0.0349, 0.0359, 0.0676], normal: [-0.08, 0.12, 0.99], radius: [0.0068, 0.0051] },
];

const PALETTES = {
  0: { base: [29, 54, 78], light: [105, 143, 165], glow: [80, 220, 255] },
  1: { base: [119, 76, 59], light: [228, 180, 151], glow: [66, 211, 245] },
  2: { base: [105, 64, 44], light: [213, 157, 123], glow: [66, 211, 245] },
  3: { base: [82, 48, 35], light: [180, 124, 95], glow: [66, 211, 245] },
  4: { base: [53, 36, 31], light: [133, 91, 72], glow: [66, 211, 245] },
  5: { base: [116, 78, 55], light: [224, 182, 143], glow: [255, 207, 111] },
  6: { base: [53, 94, 101], light: [142, 180, 177], glow: [105, 233, 240] },
  // The default blue remains, but is muted and desaturated like cool human skin.
  7: { base: [48, 80, 101], light: [143, 174, 187], glow: [100, 225, 247] },
  8: { base: [24, 44, 67], light: [92, 126, 150], glow: [94, 191, 237] },
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
  const etchedEdge = [12, 35, 53];
  const luminousCore = [126, 244, 255];
  for (let i = 1; i < points.length; i++) {
    strokeSegment(data, size, points[i - 1], points[i], glow, size * 0.007, 0.20);
    strokeSegment(data, size, points[i - 1], points[i], etchedEdge, size * 0.0028, 0.76);
    strokeSegment(data, size, points[i - 1], points[i], accent, size * 0.0017, 0.96);
    strokeSegment(data, size, points[i - 1], points[i], luminousCore, size * 0.0006, 0.78);
  }
}

function hashPixel(x, y) {
  let hash = (Math.imul(x + 1, 374761393) + Math.imul(y + 1, 668265263)) | 0;
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return (hash >>> 0) / 4294967295;
}

export function deriveHaseoEyeLayout(geometry, morphTargetDictionary = {}) {
  const position = geometry?.attributes?.position;
  const normals = geometry?.attributes?.normal;
  const positionMorphs = geometry?.morphAttributes?.position;
  if (!position || !positionMorphs) return FALLBACK_EYES.map((eye) => ({ ...eye, center: [...eye.center], normal: [...eye.normal], radius: [...eye.radius] }));

  return ['EyeBlink_L', 'EyeBlink_R'].map((name, eyeIndex) => {
    const morphIndex = morphTargetDictionary[name];
    const morph = Number.isInteger(morphIndex) ? positionMorphs[morphIndex] : null;
    if (!morph) return FALLBACK_EYES[eyeIndex];

    const delta = new Float32Array(position.count);
    let maxDelta = 0;
    for (let i = 0; i < position.count; i++) {
      const amount = Math.hypot(morph.getX(i), morph.getY(i), morph.getZ(i));
      delta[i] = amount;
      if (amount > maxDelta) maxDelta = amount;
    }
    if (maxDelta <= 1e-8) return FALLBACK_EYES[eyeIndex];

    // Find the full eyelid-opening footprint, not just the strongest blink vertices
    // at its upper edge. This places the pupil in the aperture, as on Léa.
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const activeThreshold = maxDelta * 0.05;
    for (let i = 0; i < position.count; i++) {
      if (delta[i] < activeThreshold) continue;
      minX = Math.min(minX, position.getX(i));
      maxX = Math.max(maxX, position.getX(i));
      minY = Math.min(minY, position.getY(i));
      maxY = Math.max(maxY, position.getY(i));
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return FALLBACK_EYES[eyeIndex];

    const centerX = (minX + maxX) * 0.5;
    const centerY = (minY + maxY) * 0.5;
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    let zSum = 0;
    let normalX = 0;
    let normalY = 0;
    let normalZ = 0;
    let weightSum = 0;
    for (let i = 0; i < position.count; i++) {
      if (delta[i] < activeThreshold) continue;
      const dx = (position.getX(i) - centerX) / Math.max(spanX, 1e-6);
      const dy = (position.getY(i) - centerY) / Math.max(spanY, 1e-6);
      if (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2) continue;
      const weight = delta[i] * delta[i];
      zSum += position.getZ(i) * weight;
      if (normals) {
        normalX += normals.getX(i) * weight;
        normalY += normals.getY(i) * weight;
        normalZ += normals.getZ(i) * weight;
      }
      weightSum += weight;
    }
    if (!weightSum) return FALLBACK_EYES[eyeIndex];

    const normalLength = Math.hypot(normalX, normalY, normalZ) || 1;
    return {
      name,
      center: [centerX, centerY, zSum / weightSum],
      normal: normals
        ? [normalX / normalLength, normalY / normalLength, normalZ / normalLength]
        : [0, 0, 1],
      radius: [
        Math.max(0.003, spanX * LEA_IRIS_APERTURE_RATIO),
        Math.max(0.003, spanY * LEA_IRIS_APERTURE_RATIO),
      ],
    };
  });
}

export function buildHaseoIrisPixels(size = 128) {
  const data = new Uint8Array(size * size * 4);
  const cx = (size - 1) * 0.5;
  const cy = (size - 1) * 0.5;
  const radius = size * 0.47;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - cx) / radius;
      const dy = (y - cy) / radius;
      const r = Math.hypot(dx, dy);
      if (r > 1) continue;
      const angle = Math.atan2(dy, dx);
      const ray = 0.5 + 0.5 * Math.sin(angle * 24 + r * 30);
      let color;
      if (r > 0.88) color = [5, 20, 35];
      else if (r > 0.32) {
        const light = clamp01((0.88 - r) / 0.56 + ray * 0.14);
        color = [28 + 35 * light, 92 + 93 * light, 139 + 86 * light];
      } else color = [3, 11, 21];
      const offset = 4 * (y * size + x);
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = 255;
    }
  }
  // A compact sclera reflection in the upper-left; the black pupil remains centred.
  stamp(data, size, cx - radius * 0.22, cy - radius * 0.24, size * 0.035, [240, 250, 255], 0.95);
  return data;
}

export function createHaseoIrisTexture(size = 128) {
  const texture = new THREE.DataTexture(buildHaseoIrisPixels(size), size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export function buildHaseoSkinPixels(skinMode = 7, accentHex = 0xff5ce1e6, showCircuits = true, size = 1024) {
  const palette = PALETTES[skinMode] || PALETTES[7];
  const data = new Uint8Array(size * size * 4);
  const accent = [
    (accentHex >>> 16) & 0xff,
    (accentHex >>> 8) & 0xff,
    accentHex & 0xff,
  ];

  // Low-frequency colour clouds, fine pores and subdued grain add skin depth while
  // keeping Haseo's cool blue tone. The blue remains in the pigment, not a neon wash.
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const coarse = hashPixel(x >> 4, y >> 4) - 0.5;
      const micro = hashPixel(x, y) - 0.5;
      const pore = hashPixel(x >> 1, y >> 1);
      const cloud =
        Math.sin(u * 8.4 + Math.sin(v * 6.2)) * 0.025 +
        Math.sin(v * 11.1 - u * 4.8) * 0.019 +
        Math.cos((u + v) * 15.0) * 0.012 +
        coarse * 0.075;
      const softLight = Math.max(0, Math.sin((u * 0.75 + v * 0.42) * Math.PI * 2)) * 0.045;
      const poreShade = pore > 0.986 ? -0.085 : pore < 0.012 ? 0.045 : 0;
      const factor = Math.max(0.68, Math.min(1.23, 0.98 + cloud + micro * 0.045 + poreShade + softLight));
      const warmUndertone = Math.max(0, Math.sin(u * 9.0 + v * 5.0)) * 0.025;
      const offset = 4 * (y * size + x);
      data[offset] = Math.max(0, Math.min(255, palette.base[0] * factor + palette.light[0] * (0.10 + softLight) + warmUndertone * 18));
      data[offset + 1] = Math.max(0, Math.min(255, palette.base[1] * factor + palette.light[1] * (0.10 + softLight)));
      data[offset + 2] = Math.max(0, Math.min(255, palette.base[2] * factor + palette.light[2] * (0.10 + softLight)));
      data[offset + 3] = 255;
    }
  }

  if (showCircuits) {
    // Bright, embedded PCB traces run around the eye line and cheeks. No detached
    // terminal dots are added; the fine paths remain integrated with skin.
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
