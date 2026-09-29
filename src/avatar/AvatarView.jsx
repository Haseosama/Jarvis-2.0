import React, { useEffect, useRef, useState } from 'react';
import {
  BUILT_IN_FACES,
  HAIR_SHADES,
  HOLO_SKIN,
  HOLO_HAIR_SKIN,
  BLUE_HOLO_SKIN,
  HeadMesh,
  HairStyle,
  CharacterMesh,
  recolourHair,
} from './HeadMesh.js';
import { HoloAvatar } from './Visemes.js';
import {
  AvatarRenderer,
  CharacterRenderer,
  CartoonRenderer,
  drawGlowReactor,
} from './AvatarRenderer.js';

const meshCache = new Map();
const hairCache = new Map();
const charCache = new Map();

async function loadHeadMesh(url) {
  if (meshCache.has(url)) return meshCache.get(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch mesh: ${url}`);
  const buf = await res.arrayBuffer();
  const parsed = HeadMesh.parse(buf);
  meshCache.set(url, parsed);
  return parsed;
}

async function loadHairStyle(id) {
  if (!id || id === 'auto' || id === 'none') return null;
  if (hairCache.has(id)) return hairCache.get(id);
  const url = `./assets/avatar/hair/${id}.bin`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  const parsed = HairStyle.parse(buf);
  hairCache.set(id, parsed);
  return parsed;
}

async function loadCharacterMesh(folder) {
  if (charCache.has(folder)) return charCache.get(folder);
  const [metaRes, binRes] = await Promise.all([
    fetch(`${folder}/meta.json`),
    fetch(`${folder}/mesh.bin`),
  ]);
  const meta = await metaRes.json();
  const bin = await binRes.arrayBuffer();
  const atlasImg = await new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = `${folder}/atlas.webp`;
  });
  const ch = CharacterMesh.parse(bin, meta, atlasImg);
  const renderer = new CharacterRenderer(ch);
  charCache.set(folder, renderer);
  return renderer;
}

function moodForState(state) {
  if (state === 'LISTENING') return 'LISTENING';
  if (state === 'THINKING' || state === 'CONNECTING') return 'THINKING';
  if (state === 'ASLEEP' || state === 'ERROR') return 'ASLEEP';
  return 'IDLE';
}

function resolveFaceSpec(faceId, avatarMode, config) {
  if (avatarMode === 'cartoon') {
    return BUILT_IN_FACES.find((f) => f.id === 'cartoon') || BUILT_IN_FACES[3];
  }
  if (faceId) {
    const clean = String(faceId).replace(/^char:/, '').toLowerCase();
    const mapId =
      clean === 'female01' ? 'lea' : clean === 'male02' ? 'marc' : clean;
    const found = BUILT_IN_FACES.find((f) => f.id === mapId);
    if (found) return found;
  }
  const idx = config?.avatarModel ?? 1;
  return BUILT_IN_FACES[Math.max(0, Math.min(BUILT_IN_FACES.length - 1, idx))];
}

export default function AvatarView({
  config,
  state = 'IDLE',
  outputLevel = 0,
  audioLevel = 0,
  viseme = null,
  timeline = null,
  faceId = 'lea',
  skin = false,
  hairStyleId = 'auto',
  hairShadeId = 'natural',
  avatarMode = '3d',
  watching = false,
  closeUp = false,
  size = null,
  onClick = null,
  primaryHex = 0xff00d4ff,
  accentHex = 0xff5ce1e6,
  bgHex = 0xff060e14,
}) {
  const canvasRef = useRef(null);
  const engineRef = useRef({
    renderer: null,
    avatar: null,
    charRenderer: null,
    cartoonRenderer: new CartoonRenderer(),
  });
  const [ready, setReady] = useState(false);

  const faceSpec = resolveFaceSpec(faceId, avatarMode, config);
  const effectiveHairId =
    hairStyleId && hairStyleId !== 'auto' && hairStyleId !== 'none'
      ? hairStyleId
      : config?.avatarHair?.[faceSpec.label] || '';
  const effectiveShadeId =
    hairShadeId && hairShadeId !== 'natural'
      ? hairShadeId
      : config?.avatarHairColour?.[faceSpec.label] || '';
  const showFace = avatarMode !== 'reactor' && config?.avatarFace !== false;
  const skinMode = skin ? 2 : config?.avatarSkin ?? BLUE_HOLO_SKIN;
  const lipTone = config?.avatarLips ?? 0;
  const levelVal = Math.max(outputLevel || 0, audioLevel || 0);

  useEffect(() => {
    let cancelled = false;
    async function prepare() {
      try {
        const baseMesh = await loadHeadMesh(faceSpec.asset);
        const shade = HAIR_SHADES.find((s) => s.id === effectiveShadeId);
        const targetColours = shade ? shade.colours : faceSpec.hairColours;
        let finalMesh = baseMesh;

        if (effectiveHairId && !faceSpec.character && !faceSpec.cartoon) {
          const style = await loadHairStyle(effectiveHairId);
          if (style) {
            finalMesh = style.fitOn(baseMesh, targetColours);
          }
        } else if (shade && !faceSpec.character && !faceSpec.cartoon) {
          finalMesh = recolourHair(baseMesh, faceSpec.hairColours, targetColours);
        }

        let charRend = null;
        if (faceSpec.character) {
          charRend = await loadCharacterMesh(faceSpec.character);
        }

        if (cancelled) return;
        engineRef.current.renderer = new AvatarRenderer(finalMesh);
        engineRef.current.avatar = new HoloAvatar(finalMesh);
        engineRef.current.charRenderer = charRend;
        setReady(true);
      } catch (err) {
        console.error('Avatar load error:', err);
      }
    }
    prepare();
    return () => {
      cancelled = true;
    };
  }, [faceSpec, effectiveHairId, effectiveShadeId]);

  const propsRef = useRef({});
  propsRef.current = {
    state,
    levelVal,
    viseme,
    watching,
    showFace,
    skinMode,
    lipTone,
    faceSpec,
    effectiveShadeId,
    primaryHex,
    accentHex,
    bgHex,
    closeUp,
  };

  useEffect(() => {
    let rafId = 0;
    let lastMs = performance.now();

    function loop(nowMs) {
      rafId = requestAnimationFrame(loop);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth || size || 480;
      const h = canvas.clientHeight || size || 480;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      const dt = Math.max(0.001, Math.min(0.1, (nowMs - lastMs) / 1000));
      lastMs = nowMs;

      const p = propsRef.current;
      const { renderer, avatar, charRenderer, cartoonRenderer } = engineRef.current;

      let frames = null;
      if (timeline) {
        const sample = timeline.sample(nowMs);
        frames = sample.frames;
      } else if (p.viseme && (p.viseme.jaw > 0.01 || p.viseme.open > 0.01)) {
        const openVal = p.viseme.open ?? p.viseme.jaw ?? 0;
        const wideVal = p.viseme.wide ?? p.viseme.width ?? 0;
        frames = [{ level: Math.max(p.levelVal, openVal), open: openVal, wide: wideVal }];
      }

      const speaking = p.state === 'SPEAKING' || (frames && frames.length > 0);
      const level = speaking ? Math.max(p.levelVal, 0.25) : p.levelVal;

      if (!p.showFace || !avatar || !renderer) {
        drawGlowReactor(
          ctx,
          w / 2,
          h / 2,
          Math.min(w, h) * 0.36,
          p.primaryHex,
          p.state,
          level,
          nowMs / 1000
        );
        ctx.restore();
        return;
      }

      avatar.watching = p.watching;
      avatar.step(dt, level, speaking, moodForState(p.state), frames);

      const r = Math.min(w, h) * (p.closeUp ? 0.52 : 0.38);
      const cx = w / 2;
      const cy = h * (p.closeUp ? 0.48 : 0.47);

      if (p.faceSpec.character && charRenderer) {
        charRenderer.draw(ctx, avatar, cx, cy, r, p.primaryHex);
      } else if (p.faceSpec.cartoon) {
        cartoonRenderer.draw(ctx, avatar, cx, cy, r, p.primaryHex);
      } else {
        const shade = HAIR_SHADES.find((s) => s.id === p.effectiveShadeId);
        renderer.holo = p.skinMode >= HOLO_SKIN;
        renderer.holoHair = p.skinMode === HOLO_HAIR_SKIN;
        renderer.blueMix = p.skinMode >= BLUE_HOLO_SKIN;
        renderer.skin = renderer.blueMix ? 5 : renderer.holo ? 2 : p.skinMode;
        renderer.lips = p.lipTone;
        renderer.browColour = renderer.holo
          ? 0xff0c2160
          : shade?.browColour ?? p.faceSpec.browColour;
        renderer.browScale = p.faceSpec.browScale;
        renderer.lashScale = p.faceSpec.lashScale;
        renderer.androidLook = p.faceSpec.androidLook;
        renderer.halo = p.faceSpec.halo;
        renderer.lipTint = p.faceSpec.lipTint;
        renderer.draw(ctx, avatar, cx, cy, r, p.primaryHex, p.accentHex, p.bgHex);
      }

      ctx.restore();
    }

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [ready, size, timeline]);

  return (
    <div
      onClick={onClick}
      style={{
        width: size ? `${size}px` : '100%',
        height: size ? `${size}px` : '100%',
        position: 'relative',
        cursor: onClick ? 'pointer' : 'default',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
        }}
      />
    </div>
  );
}
