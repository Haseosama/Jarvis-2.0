import React, { useEffect, useRef, useState } from 'react';
import {
  BUILT_IN_FACES,
  HAIR_SHADES,
  HOLO_SKIN,
  HOLO_HAIR_SKIN,
  BLUE_HOLO_SKIN,
  HeadMesh,
  HairStyle,
  recolourHair,
  removeHairPaint,
} from './HeadMesh.js';
import { HoloAvatar } from './Visemes.js';
import {
  AvatarRenderer,
  DEEP_BLUE,
  drawGlowReactor,
} from './AvatarRenderer.js';

const meshCache = new Map();
const hairCache = new Map();

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

function moodForState(state) {
  if (state === 'LISTENING') return 'LISTENING';
  if (state === 'THINKING' || state === 'CONNECTING') return 'THINKING';
  if (state === 'ASLEEP' || state === 'ERROR') return 'ASLEEP';
  return 'IDLE';
}

function resolveFaceSpec(faceId, config) {
  if (faceId) {
    const clean = String(faceId).replace(/^char:/, '').toLowerCase();
    const mapId = clean === 'female01' ? 'lea' : clean === 'male02' ? 'marc' : clean;
    const found = BUILT_IN_FACES.find((f) => f.id === mapId);
    if (found) return found;
  }
  const idx = config?.avatarModel ?? 0;
  return BUILT_IN_FACES[Math.max(0, Math.min(BUILT_IN_FACES.length - 1, idx))];
}

function resolveSkinCode(skinProp, config) {
  if (typeof skinProp === 'number') return skinProp;
  if (typeof config?.avatarSkin === 'number') return config.avatarSkin;
  if (skinProp === true) return 2; // Realistic skin (Mate)
  return BLUE_HOLO_SKIN; // Default in Jarvis-Android: 7 (Hologramme bleu + circuits électriques)
}

export default function AvatarView({
  config,
  state = 'IDLE',
  outputLevel = 0,
  audioLevel = 0,
  viseme = null,
  timeline = null,
  faceId = 'classic',
  skin = BLUE_HOLO_SKIN,
  lips = 0,
  showCircuits = true,
  polygonLevel = 'high',
  hairStyleId = 'auto',
  hairShadeId = 'natural',
  avatarMode = '3d',
  watching = false,
  closeUp = false,
  size = null,
  onClick = null,
  onPolygonCountChange = null,
  primaryHex = 0xff00d4ff,
  accentHex = 0xff5ce1e6,
  bgHex = 0xff060e14,
}) {
  const canvasRef = useRef(null);
  const engineRef = useRef({
    renderer: null,
    avatar: null,
  });
  const [ready, setReady] = useState(false);

  const faceSpec = resolveFaceSpec(faceId, config);
  const isBald = hairStyleId === 'none' || config?.avatarHair === 'none';
  const effectiveHairId =
    hairStyleId && hairStyleId !== 'auto' && hairStyleId !== 'none'
      ? hairStyleId
      : config?.avatarHair?.[faceSpec.label] || '';
  const effectiveShadeId =
    hairShadeId && hairShadeId !== 'natural'
      ? hairShadeId
      : config?.avatarHairColour?.[faceSpec.label] || '';
  const showFace = avatarMode !== 'reactor' && config?.avatarFace !== false;
  const skinMode = resolveSkinCode(skin, config);
  const lipTone = typeof lips === 'number' ? lips : config?.avatarLips ?? 0;
  const circuitsEnabled =
    showCircuits !== undefined ? Boolean(showCircuits) : config?.avatarCircuits !== false;
  const effectivePolyLevel = closeUp
    ? polygonLevel === 'eco'
      ? 'eco'
      : 'medium'
    : polygonLevel || config?.avatarPolygonLevel || (faceSpec.subdivide ? 'high' : 'medium');
  const levelVal = Math.max(outputLevel || 0, audioLevel || 0);

  useEffect(() => {
    let cancelled = false;
    async function prepare() {
      try {
        const baseMesh = await loadHeadMesh(faceSpec.asset);
        const shade = HAIR_SHADES.find((s) => s.id === effectiveShadeId);
        const targetColours = shade ? shade.colours : faceSpec.hairColours;
        let finalMesh = baseMesh;

        if (effectiveHairId) {
          const style = await loadHairStyle(effectiveHairId);
          if (style) {
            finalMesh = style.fitOn(baseMesh, targetColours);
          }
        } else if (!isBald && shade) {
          finalMesh = recolourHair(baseMesh, faceSpec.hairColours, targetColours);
        }

        // Apply selected polygon level (eco / low / medium / high / ultra)
        finalMesh = HeadMesh.applyPolygonLevel(finalMesh, effectivePolyLevel);
        if (isBald) finalMesh = removeHairPaint(finalMesh);

        if (cancelled) return;
        engineRef.current.renderer = new AvatarRenderer(finalMesh);
        engineRef.current.avatar = new HoloAvatar(finalMesh);
        onPolygonCountChange?.(finalMesh.faceCount);
        setReady(true);
      } catch (err) {
        console.error('Avatar load error:', err);
      }
    }
    prepare();
    return () => {
      cancelled = true;
    };
  }, [faceSpec, effectiveHairId, effectiveShadeId, effectivePolyLevel, isBald]);

  const propsRef = useRef({});
  propsRef.current = {
    state,
    levelVal,
    viseme,
    watching,
    showFace,
    skinMode,
    lipTone,
    circuitsEnabled,
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
      const { renderer, avatar } = engineRef.current;

      let frames = null;
      if (timeline) {
        const sample = timeline.sample(nowMs);
        frames = sample.frames;
      } else if (
        p.viseme &&
        (p.state === 'SPEAKING' ||
          (p.viseme.jaw ?? 0) > 0.004 ||
          (p.viseme.open ?? 0) > 0.004 ||
          Math.abs(p.viseme.wide ?? p.viseme.width ?? 0) > 0.01)
      ) {
        const openVal = p.viseme.open ?? p.viseme.jaw ?? 0;
        const wideVal = p.viseme.wide ?? p.viseme.width ?? 0;
        const lvl =
          p.viseme.level !== undefined
            ? p.viseme.level
            : openVal > 0.015
            ? Math.max(p.levelVal, openVal)
            : 0;
        frames = [{ level: lvl, open: openVal, wide: wideVal }];
      }

      const speaking = p.state === 'SPEAKING' || Boolean(frames && frames.some((f) => f.open > 0.01));
      const level = speaking ? Math.max(p.levelVal, frames?.[0]?.level ?? 0.18) : p.levelVal;

      if (!p.showFace || !avatar || !renderer) {
        drawGlowReactor(
          ctx,
          w / 2,
          h / 2,
          Math.min(w, h) * 0.36,
          p.state,
          level,
          nowMs / 1000,
          p.primaryHex
        );
        ctx.restore();
        return;
      }

      avatar.watching = p.watching;
      avatar.step(dt, level, speaking, moodForState(p.state), frames);

      const r = Math.min(w, h) * (p.closeUp ? 0.54 : 0.38);
      const cx = w / 2;
      const cy = h * (p.closeUp ? 0.44 : 0.46);

      const shade = HAIR_SHADES.find((s) => s.id === p.effectiveShadeId);
      renderer.closeUp = Boolean(p.closeUp);
      renderer.showCircuits = Boolean(p.circuitsEnabled);
      renderer.holo = p.skinMode >= HOLO_SKIN;
      renderer.holoHair = p.skinMode === HOLO_HAIR_SKIN;
      renderer.blueMix = p.skinMode >= BLUE_HOLO_SKIN;
      renderer.skin = renderer.blueMix ? 5 : renderer.holo ? 2 : p.skinMode;
      renderer.lips = p.lipTone;
      renderer.browColour = renderer.holo
        ? DEEP_BLUE
        : shade?.browColour ?? p.faceSpec.browColour;
      renderer.browScale = p.faceSpec.browScale;
      renderer.lashScale = p.faceSpec.lashScale;
      renderer.androidLook = p.faceSpec.androidLook;
      renderer.halo = p.faceSpec.halo;
      renderer.lipTint = p.faceSpec.lipTint;
      renderer.fibreOverlay = p.faceSpec.fibres !== false;
      renderer.draw(ctx, avatar, cx, cy, r, p.primaryHex, p.accentHex, p.bgHex);

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
