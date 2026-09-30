import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import {
  buildHaseoSkinPixels,
  deriveHaseoEyeLayout,
  HASEO_EYE_UV_CENTERS,
  LEA_IRIS_APERTURE_RATIO,
} from '../src/avatar/HaseoSkinTexture.js';
import fs from 'node:fs';
import path from 'node:path';
import {
  HeadMesh,
  HairStyle,
  CharacterMesh,
  HAIR_SHADES,
  BUILT_IN_FACES,
  POLYGON_LEVELS,
  CircuitTraces,
  NetworkWeb,
  recolourHair,
  removeHairPaint,
} from '../src/avatar/HeadMesh.js';
import { textToVisemes, VisemeStream, pcmVisemes, HoloAvatar } from '../src/avatar/Visemes.js';
import { AvatarRenderer } from '../src/avatar/AvatarRenderer.js';
import {
  parseMapRings,
  parseCities,
  solarSystemObjects,
  satelliteStateAt,
  DEFAULT_SATELLITES,
  parseTleCatalog,
  tleStateAt,
  moonPhase,
  observerFromCoordinates,
} from '../src/space/SpaceEngine.js';
import { hostBridge } from '../src/core/hostBridge.js';
import { PluginEngine } from '../src/core/PluginEngine.js';
import { ToolRegistry } from '../src/actions/ToolRegistry.js';
import { normalizeAircraft, haversineDistanceKm } from '../src/space/TrackingService.js';
import { configStore, ALL_VOICES, VOICE_PROFILES, normalizeFaceId } from '../src/core/ConfigStore.js';
import { clampMiniAvatarPosition } from '../src/ui/miniAvatarPosition.js';

const ASSETS_DIR = path.resolve(process.cwd(), 'public/assets');

function readArrayBuffer(relPath) {
  const buf = fs.readFileSync(path.join(ASSETS_DIR, relPath));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe('Jarvis 2.0 PC Edition — Core & Binary Asset Suite', () => {
  it('parses JHM2 3D head meshes (Classic, Léa, Marc) and animates HoloAvatar', () => {
    for (const file of ['avatar/head_mesh.bin', 'avatar/head_mesh_lea.bin', 'avatar/head_mesh_marc.bin']) {
      const ab = readArrayBuffer(file);
      const mesh = HeadMesh.parse(ab);
      assert.ok(mesh.vertexCount > 500, `${file} vertexCount > 500`);
      assert.ok(mesh.faceCount > 500, `${file} faceCount > 500`);
      assert.ok(mesh.nHead > 500, `${file} nHead > 500`);

      const holo = new HoloAvatar(mesh);
      holo.step(0.016, 0.65, true, 'IDLE', [{ level: 0.7, open: 0.8, wide: 0.2 }]);
      assert.ok(holo.mouth > 0, 'HoloAvatar mouth > 0 when speaking');
    }
  });

  it('sculpts Classic toward the reference morphology while preserving all colors', () => {
    const mesh = HeadMesh.parse(readArrayBuffer('avatar/head_mesh.bin'));
    const originalPaint = new Int32Array(mesh.paint);
    const refined = HeadMesh.refineClassicFace(mesh);
    const centerX = 0.5 * (mesh.eyeCentre[0] + mesh.eyeCentre[3]);
    const select = (predicate) => {
      const indices = [];
      for (let i = 0; i < mesh.nHead; i++) {
        if (predicate(i, mesh.verts[3 * i], mesh.verts[3 * i + 1], mesh.verts[3 * i + 2])) indices.push(i);
      }
      return indices;
    };
    const average = (indices, values, axis, transform = (value) => value) =>
      indices.reduce((sum, i) => sum + transform(values[3 * i + axis]), 0) / indices.length;
    const underChin = select((i, x, y, z) =>
      y > -0.96 && y < -0.80 && Math.abs(x - centerX) < 0.28 && z > 0.2 && mesh.jaw[i] > 0.2 && mesh.lipMask[i] <= 0.05);
    const chinFront = select((i, x, y, z) =>
      y > -0.75 && y < -0.60 && Math.abs(x - centerX) < 0.28 && z > 0.2 && mesh.jaw[i] > 0.3 && mesh.lipMask[i] <= 0.05);
    const jawCorner = select((i, x, y, z) =>
      y > -0.78 && y < -0.50 && Math.abs(x - centerX) > 0.22 && Math.abs(x - centerX) < 0.55 && z > 0.2 && mesh.jaw[i] > 0.1 && mesh.lipMask[i] <= 0.05);
    const cheek = select((i, x, y, z) =>
      y > -0.15 && y < 0.22 && Math.abs(x - centerX) > 0.25 && Math.abs(x - centerX) < 0.45 && z > 0.2 && mesh.lipMask[i] <= 0.05);
    const nose = select((i, x, y, z) =>
      y > -0.38 && y < -0.15 && Math.abs(x - centerX) < 0.12 && z > 0.3);
    const brow = select((i, x, y, z) =>
      y > 0.08 && y < 0.28 && mesh.brow[i] > 0.15 && z > 0.2);

    assert.ok(underChin.length > 10 && chinFront.length > 10 && jawCorner.length > 10 && cheek.length > 10 && nose.length > 10 && brow.length > 10);
    assert.ok(average(underChin, refined.verts, 1) > average(underChin, mesh.verts, 1), 'the underside is lifted to remove the double-chin contour');
    assert.ok(average(underChin, refined.verts, 2) < average(underChin, mesh.verts, 2), 'the underside recedes for a cleaner jaw-to-neck transition');
    assert.ok(average(chinFront, refined.verts, 0, (x) => Math.abs(x - centerX)) > average(chinFront, mesh.verts, 0, (x) => Math.abs(x - centerX)), 'the chin stays broad and square');
    assert.ok(average(chinFront, refined.verts, 2) > average(chinFront, mesh.verts, 2), 'the chin gains a stronger forward profile');
    assert.ok(average(jawCorner, refined.verts, 0, (x) => Math.abs(x - centerX)) > average(jawCorner, mesh.verts, 0, (x) => Math.abs(x - centerX)), 'the jaw corners gain definition');
    assert.ok(average(cheek, refined.verts, 0, (x) => Math.abs(x - centerX)) < average(cheek, mesh.verts, 0, (x) => Math.abs(x - centerX)), 'cheek fullness is reduced so the face reads less round');
    assert.ok(average(cheek, refined.verts, 2) < average(cheek, mesh.verts, 2), 'the cheeks are subtly flattened');
    for (const i of nose) {
      assert.equal(refined.verts[3 * i], mesh.verts[3 * i], 'nose width is left unchanged');
      assert.equal(refined.verts[3 * i + 1], mesh.verts[3 * i + 1]);
      assert.equal(refined.verts[3 * i + 2], mesh.verts[3 * i + 2], 'nose projection is left unchanged');
    }
    assert.ok(average(brow, refined.verts, 2) > average(brow, mesh.verts, 2), 'the brow ridge is more pronounced');
    assert.notEqual(refined.verts, mesh.verts, 'the cached source mesh remains unchanged');
    assert.deepEqual(refined.paint, originalPaint, 'vertex paint and therefore all existing colors stay unchanged');
    assert.notEqual(refined.normals, mesh.normals, 'the deformed surface gets its own recalculated normals');
    assert.ok(Math.abs(Math.hypot(refined.normals[3 * chinFront[0]], refined.normals[3 * chinFront[0] + 1], refined.normals[3 * chinFront[0] + 2]) - 1) < 1e-4, 'deformed facial normals remain normalized');
    assert.deepEqual(Array.from(refined.verts.slice(3 * mesh.nHead)), Array.from(mesh.verts.slice(3 * mesh.nHead)), 'hair vertices are not altered');
    for (let i = 0; i < mesh.vertexCount; i++) {
      if (mesh.lipMask[i] > 0.05) {
        assert.equal(refined.verts[3 * i], mesh.verts[3 * i], 'lip landmarks remain unchanged');
        assert.equal(refined.verts[3 * i + 1], mesh.verts[3 * i + 1]);
        assert.equal(refined.verts[3 * i + 2], mesh.verts[3 * i + 2]);
      }
    }
  });

  it('clamps a draggable mini avatar to the viewport edges', () => {
    assert.deepEqual(clampMiniAvatarPosition(900, -30, 156, 180, 800, 600), { left: 636, top: 8 });
    assert.deepEqual(clampMiniAvatarPosition(-10, 900, 156, 180, 800, 600), { left: 8, top: 412 });
    assert.deepEqual(clampMiniAvatarPosition(50, 50, 156, 180, 100, 100), { left: 0, top: 0 });

    const app = fs.readFileSync(path.resolve(process.cwd(), 'src/App.jsx'), 'utf8');
    const styles = fs.readFileSync(path.resolve(process.cwd(), 'src/styles.css'), 'utf8');
    assert.match(app, /createPortal\([\s\S]*onPointerDown=\{onMiniAvatarPointerDown\}/);
    assert.match(app, /setPointerCapture\(event\.pointerId\)/);
    assert.match(app, /localStorage\.setItem\(MINI_AVATAR_POSITION_KEY/);
    assert.match(styles, /\.mini-avatar-pip\s*\{[^}]*position:\s*fixed/);
  });

  it('animates a visible mouth cavity and eases back to a closed resting pose', () => {
    const mesh = HeadMesh.parse(readArrayBuffer('avatar/head_mesh.bin'));
    const avatar = new HoloAvatar(mesh);
    avatar.step(0.02, 1, true, 'IDLE', [{ level: 1, open: 1, wide: 0.1 }], 0.02);
    avatar.pose();

    const averageY = (chain) => chain.reduce((sum, i) => sum + avatar.pv[3 * i + 1], 0) / chain.length;
    const openGap = averageY(mesh.mouthUpper) - averageY(mesh.mouthLower);
    const peakMouth = avatar.mouth;
    assert.ok(peakMouth > 0.3, `open mouth drive is visible (${peakMouth})`);
    assert.ok(openGap > 0.03, `upper/lower lips separate for the mouth cavity (${openGap})`);

    const renderer = Object.create(AvatarRenderer.prototype);
    renderer.mesh = mesh;
    renderer.xs = new Float32Array(mesh.vertexCount);
    renderer.ys = new Float32Array(mesh.vertexCount);
    renderer.holo = false;
    renderer.skin = 1;
    renderer.lips = 0;
    const cameraDistance = 4.6;
    for (let i = 0; i < mesh.vertexCount; i++) {
      const z = avatar.pv[3 * i + 2];
      const scale = (cameraDistance / Math.max(cameraDistance - z, 0.35)) * 200;
      renderer.xs[i] = avatar.pv[3 * i] * scale;
      renderer.ys[i] = -avatar.pv[3 * i + 1] * scale;
    }
    let fills = 0;
    const gradient = { addColorStop() {} };
    const ctx = {
      save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
      fill() { fills++; }, clip() {}, stroke() {}, ellipse() {},
      createLinearGradient() { return gradient; }, createRadialGradient() { return gradient; },
    };
    renderer.drawMouth(ctx, avatar, 200, 1, 0xff00d4ff, 1);
    assert.ok(fills >= 3, 'draws the mouth cavity, teeth and tongue while speaking');

    for (let i = 0; i < 20; i++) {
      avatar.step(0.02, 0, false, 'IDLE', [{ level: 0, open: 0, wide: 0 }], 0.02);
    }
    avatar.pose();
    assert.ok(avatar.mouth < peakMouth * 0.1, 'mouth relaxes back toward closed after speech');
    assert.ok(averageY(mesh.mouthUpper) - averageY(mesh.mouthLower) < openGap * 0.2, 'lip gap returns toward rest');
    for (let i = 0; i < mesh.vertexCount; i++) {
      const z = avatar.pv[3 * i + 2];
      const scale = (cameraDistance / Math.max(cameraDistance - z, 0.35)) * 200;
      renderer.xs[i] = avatar.pv[3 * i] * scale;
      renderer.ys[i] = -avatar.pv[3 * i + 1] * scale;
    }
    const restingFills = fills;
    renderer.drawMouth(ctx, avatar, 200, 1, 0xff00d4ff, 1);
    assert.equal(fills, restingFills, 'closed mouth has no dark cavity overlay');
  });

  it('does not render scalp strands in optical-fibre or 3D-skin styles', () => {
    const renderer = Object.create(AvatarRenderer.prototype);
    renderer.mesh = {
      vertexCount: 0, faceCount: 0,
      verts: new Float32Array(0), normals: new Float32Array(0),
      faces: new Int32Array(0), faceGroup: new Float32Array(0),
      fade: new Float32Array(0), paint: new Int32Array(0), lipMask: new Float32Array(0),
    };
    renderer.nV = 0; renderer.nF = 0;
    renderer.xs = new Float32Array(0); renderer.ys = new Float32Array(0);
    renderer.faceColor = new Int32Array(0); renderer.faceFront = new Uint8Array(0);
    renderer.faceZ = new Float32Array(0); renderer.order = new Int32Array(0);
    renderer.lut = new Int32Array(192); renderer.lutKey = '';
    renderer.closeUp = false; renderer.halo = false; renderer.showCircuits = false;
    renderer.fibreOverlay = true; renderer.classicEyes = false;
    renderer.drawWeb = () => {}; renderer.drawWire = () => {}; renderer.drawFeatures = () => {};
    let scalpStrandDraws = 0;
    renderer.drawFiberHair = () => { scalpStrandDraws++; };
    renderer.drawFibres = () => { scalpStrandDraws++; };

    const gradient = { addColorStop() {} };
    const ctx = {
      save() {}, restore() {}, beginPath() {}, arc() {}, fill() {},
      createRadialGradient() { return gradient; },
    };
    const avatar = {
      pose() {}, pv: new Float32Array(0), pn: new Float32Array(0),
      glow: 0, scan: 0, time: 0,
    };
    const styles = [
      { holo: true, holoHair: true, blueMix: false, skin: 2 },
      { holo: false, holoHair: false, blueMix: false, skin: 2 },
    ];
    for (const style of styles) {
      Object.assign(renderer, style);
      renderer.draw(ctx, avatar, 100, 100, 80, 0xff00d4ff, 0xff5ce1e6, 0xff060e14);
    }
    assert.equal(scalpStrandDraws, 0, 'neither optical fibres nor realistic scalp strands are rendered');
  });

  it('suppresses drifting blue particles in hologram styles', () => {
    const renderer = Object.create(AvatarRenderer.prototype);
    renderer.closeUp = false;
    let dots = 0;
    const ctx = {
      beginPath() {},
      arc() { dots++; },
      fill() {},
    };

    renderer.holo = true;
    renderer.drawDriftingParticles(ctx, 100, 100, 80, 1, 0xff00d4ff, 1);
    assert.equal(dots, 0, 'hologram styles have no ambient particle dots');

    renderer.holo = false;
    renderer.drawDriftingParticles(ctx, 100, 100, 80, 1, 0xff00d4ff, 1);
    assert.equal(dots, 26, 'non-hologram styles retain their ambient particles');
  });

  it('removes blue circuit terminal dots on holograms while leaving track lines', () => {
    const renderer = Object.create(AvatarRenderer.prototype);
    renderer._circuits = {
      count: 1,
      triA: new Int32Array([0]), triB: new Int32Array([0]), triC: new Int32Array([0]),
      wu: new Float32Array([0]), wv: new Float32Array([0]),
      segments: new Int32Array(0), segTrack: new Int32Array(0), segAlong: new Float32Array(0),
      trackKind: new Int32Array([1]), fade: new Float32Array([1]), pads: new Int32Array([0, 0]),
    };
    renderer.cx = new Float32Array(1);
    renderer.cy = new Float32Array(1);
    renderer.cz = new Float32Array(1);
    renderer.xs = new Float32Array([10]);
    renderer.ys = new Float32Array([12]);
    renderer.holo = true;
    renderer.blueMix = true;
    let dots = 0;
    let lines = 0;
    const ctx = {
      save() {}, restore() {}, beginPath() {}, moveTo() {},
      lineTo() { lines++; }, stroke() {},
      arc() { dots++; }, fill() {},
    };

    renderer.drawCircuits(ctx, new Float32Array([0, 0, 1]), 0, 0xff00d4ff, 0xff000000, 1, 0);
    assert.equal(dots, 0, 'blue terminal pads are not drawn as isolated hologram dots');
    assert.equal(lines, 0, 'the test mesh has no tracks to alter');
  });

  it('centers the Classic face projection on its eye line while leaving other faces untouched', () => {
    const renderer = Object.create(AvatarRenderer.prototype);
    renderer.mesh = { eyeCentre: new Float32Array([-0.272, 0.017, 0.211, 0.202, 0.017, 0.241]) };
    renderer.classicEyes = true;
    const eyeLineCenter = (renderer.mesh.eyeCentre[0] + renderer.mesh.eyeCentre[3]) / 2;
    assert.equal(renderer.faceCenterX, eyeLineCenter);
    assert.ok(Math.abs(((renderer.mesh.eyeCentre[0] - renderer.faceCenterX) + (renderer.mesh.eyeCentre[3] - renderer.faceCenterX)) / 2) < 1e-6,
      'left and right eyes are centered around the canvas axis');

    renderer.classicEyes = false;
    assert.equal(renderer.faceCenterX, 0, 'Léa and Marc retain their original projection');
  });

  it('uses Léa 3D eye colors for a more natural Classic iris without hologram tint changes', () => {
    const renderer = Object.create(AvatarRenderer.prototype);
    renderer.mesh = {
      paint: new Int32Array([0xff3f7ca6 | 0]),
      lipMask: new Float32Array([0]),
      fade: new Float32Array([1]),
    };
    renderer.classicEyeMask = new Uint8Array([1]);
    renderer.classicEyes = true;
    renderer.holo = false;
    renderer.skin = 2;
    renderer.androidLook = false;
    renderer.lips = 0;
    renderer.lipTint = 0.7;

    const normal = new Float32Array([0, 0, 1]);
    const args = [0, normal, 0, 0xffabcdef, 0xff00d4ff, 0xff000000];
    const classicIris = renderer.vertexColour(...args);
    renderer.mesh.paint[0] = 0xff3dbe8c | 0;
    renderer.classicEyeMask[0] = 0;
    const leaIris = renderer.vertexColour(...args);
    assert.equal(classicIris, leaIris, 'Classic iris reuses the Léa green iris palette');

    renderer.mesh.paint[0] = 0xff3f7ca6 | 0;
    renderer.classicEyeMask[0] = 0;
    const unmodifiedFace = renderer.vertexColour(...args);
    assert.notEqual(classicIris, unmodifiedFace, 'iris recoloring is scoped to Classic eye vertices');

    renderer.holo = true;
    renderer.classicEyeMask[0] = 1;
    const hologramEye = renderer.vertexColour(...args);
    renderer.classicEyeMask[0] = 0;
    assert.equal(hologramEye, renderer.vertexColour(...args), 'hologram eye colors remain unchanged');
  });

  it('suppresses translucent scalp hair paint in every avatar style', () => {
    const renderer = Object.create(AvatarRenderer.prototype);
    renderer.mesh = {
      paint: new Int32Array([0x80aa2200 | 0]),
      lipMask: new Float32Array([0]),
      fade: new Float32Array([1]),
    };
    renderer.androidLook = false;
    renderer.lips = 0;
    renderer.lipTint = 0.7;

    const normal = new Float32Array([0, 0, 1]);
    const flat = 0xffabcdef;
    const primary = 0xff00d4ff;
    const bg = 0xff000000;
    const modes = [
      { skin: 5, holo: true, blueMix: true, holoHair: false, label: 'blue hologram' },
      { skin: 2, holo: true, blueMix: false, holoHair: false, label: 'gold hologram' },
      { skin: 2, holo: true, blueMix: false, holoHair: true, label: 'optical-fibre hologram' },
      { skin: 0, holo: false, blueMix: false, holoHair: false, label: 'network' },
      { skin: 2, holo: false, blueMix: false, holoHair: false, label: '3D skin' },
    ];

    for (const mode of modes) {
      Object.assign(renderer, mode);
      renderer.mesh.paint[0] = 0x80aa2200 | 0;
      const withHairPaint = renderer.vertexColour(0, normal, 0, flat, primary, bg);
      renderer.mesh.paint[0] = 0;
      const withoutHairPaint = renderer.vertexColour(0, normal, 0, flat, primary, bg);
      assert.equal(withHairPaint, withoutHairPaint, `${mode.label} ignores translucent scalp hair paint`);
    }
  });

  it('hides hair polygon edges in every avatar style', () => {
    const renderer = Object.create(AvatarRenderer.prototype);
    renderer.mesh = { faceGroup: new Float32Array([0, 2.5, 0]), fade: new Float32Array(4).fill(1) };
    renderer.structure = {
      count: 2,
      face0: new Int32Array([0, 2]),
      face1: new Int32Array([1, -1]),
      a: new Int32Array([0, 2]),
      b: new Int32Array([1, 3]),
      crease: new Float32Array([1, 1]),
    };
    renderer.faceFront = new Uint8Array([1, 1, 1]);
    renderer.xs = new Float32Array([0, 10, 20, 30]);
    renderer.ys = new Float32Array(4);
    renderer.scanY = 100;
    const renderedSegments = () => {
      const segments = [];
      let start = null;
      const ctx = {
        beginPath() {},
        moveTo(x, y) { start = [x, y]; },
        lineTo(x, y) { segments.push([start, [x, y]]); },
        stroke() {},
      };
      renderer.drawWire(ctx, new Float32Array(12), 0, 0xff00d4ff, 0xff000000, 1);
      return segments;
    };

    const styles = [
      { holo: true, holoHair: false, blueMix: true, skin: 5, label: 'blue hologram' },
      { holo: true, holoHair: false, blueMix: false, skin: 5, label: 'gold hologram' },
      { holo: true, holoHair: true, blueMix: false, skin: 5, label: 'optical-fibre hologram' },
      { holo: false, holoHair: false, blueMix: false, skin: 0, label: 'network' },
      { holo: false, holoHair: false, blueMix: false, skin: 2, label: '3D skin' },
    ];
    for (const style of styles) {
      Object.assign(renderer, style);
      assert.deepEqual(renderedSegments(), [[[20, 0], [30, 0]]], `${style.label} keeps facial edges but hides hair edges`);
    }
  });

  it('removes isolated hologram dots while retaining polygon lines and network nodes', () => {
    const renderer = Object.create(AvatarRenderer.prototype);
    const count = 100;
    renderer.skin = 5;
    renderer.holo = true;
    renderer.closeUp = false;
    renderer.web = {
      count,
      triA: new Int32Array(count),
      triB: new Int32Array(count),
      triC: new Int32Array(count),
      wu: new Float32Array(count),
      wv: new Float32Array(count),
      fade: new Float32Array(count).fill(1),
      edges: new Int32Array([0, 1]),
    };
    renderer.wx = new Float32Array(count);
    renderer.wy = new Float32Array(count);
    renderer.wz = new Float32Array(count);
    renderer.xs = new Float32Array([0]);
    renderer.ys = new Float32Array([0]);
    let dots = 0;
    let edgeSegments = 0;
    const ctx = {
      beginPath() {}, moveTo() {}, lineTo() { edgeSegments++; }, stroke() {}, fill() {},
      arc() { dots++; },
    };
    renderer.drawWeb(ctx, new Float32Array([0, 0, 0.2]), 0, 0xff00d4ff, 1, 0);
    assert.equal(dots, 0, 'hologram styles draw no isolated polygon dots');
    assert.ok(edgeSegments > 0, 'hologram polygon web lines remain visible');

    renderer.holo = false;
    renderer.skin = 0;
    dots = 0;
    edgeSegments = 0;
    renderer.drawWeb(ctx, new Float32Array([0, 0, 0.2]), 0, 0xff00d4ff, 1, 0);
    assert.ok(dots > 0, 'network-only style retains its node visualization');
  });

  it('removes residual scalp hair paint for bald avatars while preserving opaque facial details', () => {
    const mesh = HeadMesh.parse(readArrayBuffer('avatar/head_mesh.bin'));
    const sourceHairPaint = mesh.paint.filter((p) => p !== 0 && ((p >>> 24) & 0xff) < 255).length;
    const opaqueDetails = mesh.paint.filter((p) => p !== 0 && ((p >>> 24) & 0xff) === 255).length;
    assert.ok(sourceHairPaint > 1000, 'source mesh contains hair-colour remnants to remove');

    const baldMesh = removeHairPaint(mesh);
    assert.notEqual(baldMesh, mesh);
    assert.equal(baldMesh.faceCount, mesh.faceCount);
    assert.equal(baldMesh.paint.filter((p) => p !== 0 && ((p >>> 24) & 0xff) < 255).length, 0);
    assert.equal(baldMesh.paint.filter((p) => p !== 0 && ((p >>> 24) & 0xff) === 255).length, opaqueDetails);
    assert.equal(removeHairPaint(baldMesh), baldMesh, 'removal is safe to repeat');
  });

  it('parses JHR1 3D hairstyles and fits them onto a head mesh', () => {
    const headAb = readArrayBuffer('avatar/head_mesh_lea.bin');
    const head = HeadMesh.parse(headAb);
    const hairAb = readArrayBuffer('avatar/hair/women09_00.bin');
    const style = HairStyle.parse(hairAb);
    assert.ok(style.vertexCount > 100);
    assert.ok(style.faceCount > 100);

    const fitted = style.fitOn(head, HAIR_SHADES[0].colours);
    assert.ok(fitted.vertexCount > head.nHead);
    const recoloured = recolourHair(fitted, HAIR_SHADES[0].colours, HAIR_SHADES[4].colours);
    assert.equal(recoloured.vertexCount, fitted.vertexCount);
  });

  it('parses JCH1/JCH2 3D textured characters (Adam & Mei)', () => {
    for (const charId of ['adam', 'mei']) {
      const meta = JSON.parse(
        fs.readFileSync(path.join(ASSETS_DIR, `avatar/characters/${charId}/meta.json`), 'utf8')
      );
      const bin = readArrayBuffer(`avatar/characters/${charId}/mesh.bin`);
      const ch = CharacterMesh.parse(bin, meta, null);
      assert.ok(ch.vertexCount > 1000);
      assert.ok(ch.faceCount > 1000);
    }
  });

  it('computes French visemes from text and F1/F2 formants from 24kHz PCM audio', () => {
    const seq = textToVisemes('Bonjour Jarvis, quelle est la météo sur Bordeaux ?');
    assert.ok(seq.length > 10);

    const stream = new VisemeStream();
    stream.feedText('Bonjour');
    const frames = stream.frames([{ level: 0.6, open: 0.4, wide: 0.1 }]);
    assert.equal(frames.length, 1);
    assert.ok(frames[0].open >= 0);

    const pcm = new Float32Array(2400);
    for (let i = 0; i < pcm.length; i++) {
      pcm[i] = 0.4 * Math.sin((2 * Math.PI * 600 * i) / 24000) + 0.2 * Math.sin((2 * Math.PI * 1800 * i) / 24000);
    }
    const audioVis = pcmVisemes(pcm, 24000);
    assert.ok(audioVis.length > 0);
    assert.ok(audioVis[0].level > 0);
  });

  it('parses Natural Earth binary world map (land.bin, borders.bin, cities.tsv) and computes orbits/astronomy', () => {
    const land = parseMapRings(readArrayBuffer('sky/land.bin'));
    const borders = parseMapRings(readArrayBuffer('sky/borders.bin'));
    const cities = parseCities(fs.readFileSync(path.join(ASSETS_DIR, 'sky/cities.tsv'), 'utf8'));

    assert.ok(land.length > 50);
    assert.ok(borders.length > 20);
    assert.ok(cities.length > 50);

    const now = Date.now();
    const issState = satelliteStateAt(DEFAULT_SATELLITES[0], now);
    assert.ok(issState.lat >= -55 && issState.lat <= 55);

    const bodies = solarSystemObjects({ latDeg: 44.8378, lonDeg: -0.5792 }, now);
    assert.ok(bodies.length >= 7);

    const phase = moonPhase(now);
    assert.ok(phase.lit >= 0 && phase.lit <= 1);
  });

  it('uses validated current-device coordinates as the observer for the local sky chart', () => {
    assert.deepEqual(observerFromCoordinates({ latitude: 44.84, longitude: -0.58 }), {
      latDeg: 44.84,
      lonDeg: -0.58,
      label: 'Ma position',
    });
    assert.equal(observerFromCoordinates({ latitude: 91, longitude: 0 }), null);
    assert.equal(observerFromCoordinates({ latitude: 0, longitude: Infinity }), null);
  });

  it('normalizes live ADS-B aircraft into selectable flight telemetry', () => {
    const plane = normalizeAircraft({
      hex: 'a0b1c2', flight: 'AFR123', lat: 44.8, lon: -0.6, alt_baro: 35000,
      gs: 420, track: 180, baro_rate: -512, t: 'A320', r: 'F-GKXY', squawk: '7000', messages: 1300,
    }, 'adsb.fi');
    assert.equal(plane.icao24, 'a0b1c2');
    assert.equal(plane.category, 'commercial');
    assert.equal(plane.altitudeM, 35000 * 0.3048);
    assert.equal(plane.speedKnots, 420);
    assert.equal(plane.verticalRateFpm, -512);
    assert.ok(haversineDistanceKm(44.84, -0.58, 48.86, 2.35) > 400);
  });

  it('parses live TLE catalog lines and propagates a selectable satellite position', () => {
    const tle = [
      'ISS (ZARYA)',
      '1 25544U 98067A   24146.40251785  .00015505  00000-0  27885-3 0  9997',
      '2 25544  51.6402 189.7042 0004381 334.8091 106.8778 15.50091157455243',
    ].join('\n');
    const [iss] = parseTleCatalog(tle, 'science');
    assert.equal(iss.norad, 25544);
    assert.equal(iss.name, 'ISS (ZARYA)');
    assert.ok(iss.meanMotionRevDay > 15);
    assert.ok(iss.apogeeAltKm > iss.perigeeAltKm);
    const position = tleStateAt(iss, iss.epoch + 60 * 60_000);
    assert.ok(position.lat >= -90 && position.lat <= 90);
    assert.ok(position.lon >= -180 && position.lon <= 180);
    assert.ok(position.altKm > 200 && position.altKm < 1000);
  });

  it('validates all 82 bundled JSON plugins', () => {
    const index = JSON.parse(fs.readFileSync(path.join(ASSETS_DIR, 'plugins/index.json'), 'utf8'));
    assert.equal(index.length, 82);
    for (const entry of index) {
      const spec = entry.spec || entry;
      assert.ok(spec.name, `Plugin ${entry.fileName} has name`);
      assert.ok(spec.description, `Plugin ${entry.fileName} has description`);
    }
  });

  it('validates hostBridge methods required by App, ConfigStore, ToolRegistry, and PCControlPanel', async () => {
    assert.equal(typeof hostBridge.onPushToTalk, 'function');
    const unsub = hostBridge.onPushToTalk(() => {});
    assert.equal(typeof unsub, 'function');
    unsub();

    const sys = await hostBridge.getSystemInfo();
    assert.ok(sys.cpuCores > 0);
    assert.ok(typeof sys.cpuUsagePercent === 'number');
    assert.ok(typeof sys.memUsagePercent === 'number');

    const dev = await hostBridge.setDeviceSetting({ setting: 'volume', value: 50 });
    assert.equal(dev.ok, true);

    const win = await hostBridge.windowControl({ action: 'list' });
    assert.equal(win.ok, true);
    assert.ok(Array.isArray(win.windows));
  });

  it('registers Haseo as an independent FBX face while keeping the existing faces', async () => {
    assert.deepEqual(
      BUILT_IN_FACES.map((f) => f.id),
      ['classic', 'lea', 'marc', 'haseo']
    );
    const haseo = BUILT_IN_FACES.find((face) => face.id === 'haseo');
    assert.equal(haseo.label, 'Haseo');
    assert.equal(haseo.asset, './assets/avatar/haseo.fbx');
    assert.equal(normalizeFaceId('char:Haseo'), 'haseo');
    const fbx = fs.readFileSync(path.join(ASSETS_DIR, 'avatar/haseo.fbx'));
    assert.ok(fbx.subarray(0, 18).toString('ascii').startsWith('Kaydara FBX Binary'));
    assert.ok(fbx.byteLength > 2_000_000, 'the complete FBX asset is bundled locally');
  });

  it('parses Haseo FBX geometry and facial morph targets without requesting the missing texture', () => {
    let textureRequests = 0;
    const noTextureLoader = {
      path: undefined,
      setPath(value) { this.path = value; return this; },
      load() { textureRequests += 1; return new THREE.Texture(); },
    };
    const manager = new THREE.LoadingManager();
    manager.addHandler(/\.png$/i, noTextureLoader);
    const model = new FBXLoader(manager).parse(readArrayBuffer('avatar/haseo.fbx'), '');
    const meshes = [];
    model.traverse((object) => { if (object.isMesh) meshes.push(object); });

    assert.equal(meshes.length, 1);
    assert.ok(meshes[0].geometry.attributes.position.count > 50_000);
    assert.ok(meshes[0].morphTargetDictionary.JawOpen !== undefined);
    assert.ok(meshes[0].morphTargetDictionary.AA !== undefined);
    assert.ok(meshes[0].morphTargetDictionary.EyeBlink_L !== undefined);
    assert.equal(textureRequests, 1, 'the missing sidecar is intercepted locally');

    meshes[0].geometry.computeBoundingBox();
    const neutralBounds = new THREE.Box3().setFromBufferAttribute(meshes[0].geometry.attributes.position);
    const neutralHeight = neutralBounds.getSize(new THREE.Vector3()).y;
    const morphHeight = meshes[0].geometry.boundingBox.getSize(new THREE.Vector3()).y;
    assert.ok(morphHeight > neutralHeight * 2, 'camera framing must use the neutral face bounds, not extreme blendshape bounds');

    const eyeLayout = deriveHaseoEyeLayout(meshes[0].geometry, meshes[0].morphTargetDictionary);
    assert.equal(eyeLayout.length, 2);
    eyeLayout.forEach((eye, index) => {
      assert.ok(Math.abs(eye.center[0] - HASEO_EYE_UV_CENTERS[index][0]) < 0.001);
      assert.ok(Math.abs(eye.center[1] - HASEO_EYE_UV_CENTERS[index][1]) < 0.001);
      assert.ok(eye.radius[0] > 0.004 && eye.radius[0] < 0.02);
      assert.ok(eye.radius[1] > 0.004 && eye.radius[1] < 0.02);
    });

    // Léa's painted iris layers share the centre of each eye; Haseo follows that
    // same concentric placement, using his own blink morph to find the UV position.
    const lea = HeadMesh.parse(readArrayBuffer('avatar/head_mesh_lea.bin'));
    const leaIrisPaint = new Set([0xff05070a, 0xff0e4a36, 0xff3dbe8c, 0xff16553f]);
    for (let eye = 0; eye < lea.eyeFirst.length; eye++) {
      let count = 0;
      let x = 0;
      let y = 0;
      for (let vertex = lea.eyeFirst[eye]; vertex < lea.eyeFirst[eye] + lea.eyeCount[eye]; vertex++) {
        if (!leaIrisPaint.has(lea.paint[vertex] >>> 0)) continue;
        x += lea.verts[3 * vertex];
        y += lea.verts[3 * vertex + 1];
        count++;
      }
      assert.ok(count > 0);
      assert.ok(Math.abs(x / count - lea.eyeCentre[3 * eye]) < 0.001);
      assert.ok(Math.abs(y / count - lea.eyeCentre[3 * eye + 1]) < 0.001);
    }
    assert.equal(LEA_IRIS_APERTURE_RATIO, 0.2);
  });

  it('builds human-like blue Haseo skin with electric circuits and correctly centred irises', () => {
    const size = 512;
    const eyeLayout = HASEO_EYE_UV_CENTERS.map((center) => ({ center, radius: [0.008, 0.009] }));
    const textured = buildHaseoSkinPixels(7, 0xff5ce1e6, true, size, eyeLayout);
    const plain = buildHaseoSkinPixels(7, 0xff5ce1e6, false, size, eyeLayout);
    const sample = (data, u, v) => {
      const offset = 4 * (Math.floor(v * size) * size + Math.floor(u * size));
      return Array.from(data.subarray(offset, offset + 3));
    };

    assert.equal(textured.length, size * size * 4);
    const skin = sample(plain, 0.7, 0.4);
    assert.ok(skin[1] > 55 && skin[2] > skin[0], 'the skin keeps a muted, human-like cool complexion');
    assert.notDeepEqual(sample(plain, 0.7, 0.4), sample(plain, 0.71, 0.41), 'skin has fine natural tonal variation');
    for (const eye of eyeLayout) {
      const pupil = sample(textured, eye.center[0], eye.center[1]);
      assert.ok(pupil[2] > pupil[0], 'pupils use a blue tone');
    }
    assert.notDeepEqual(sample(textured, 0.32, 0.652), sample(plain, 0.32, 0.652), 'electric circuit traces disappear when circuits are disabled');
  });

  it('subdivides Classic avatar to 84,000+ polygons and generates PCB electrical circuits', async () => {
    assert.equal(normalizeFaceId('female01'), 'lea');
    assert.equal(normalizeFaceId('male02'), 'marc');
    assert.equal(normalizeFaceId('char:adam'), 'classic');
    assert.equal(normalizeFaceId('char:mei'), 'classic');
    assert.equal(normalizeFaceId('cartoon'), 'classic');

    const classicAb = readArrayBuffer('avatar/head_mesh.bin');
    const baseClassic = HeadMesh.parse(classicAb);
    const ecoClassic = HeadMesh.applyPolygonLevel(baseClassic, 'eco');
    const lowClassic = HeadMesh.applyPolygonLevel(baseClassic, 'low');
    const medClassic = HeadMesh.applyPolygonLevel(baseClassic, 'medium');
    const highClassic = HeadMesh.applyPolygonLevel(baseClassic, 'high');
    const ultraClassic = HeadMesh.applyPolygonLevel(baseClassic, 'ultra');

    assert.equal(POLYGON_LEVELS.length, 5);
    assert.ok(ecoClassic.faceCount < lowClassic.faceCount, 'eco < low polygons');
    assert.ok(lowClassic.faceCount < medClassic.faceCount, 'low < medium polygons');
    assert.ok(medClassic.faceCount < highClassic.faceCount, 'medium < high polygons');
    assert.ok(highClassic.faceCount > 80000, `Expected >80,000 polygons on high Classic, got ${highClassic.faceCount}`);
    assert.ok(ultraClassic.faceCount > 140000, `Expected >140,000 polygons on ultra Classic, got ${ultraClassic.faceCount}`);

    const circuits = new CircuitTraces(highClassic);
    assert.ok(circuits.trackCount > 50, `Expected >50 circuit tracks, got ${circuits.trackCount}`);
    assert.ok(circuits.segments.length > 500, 'Expected >500 circuit segment endpoints');
    assert.ok(circuits.pads.length > 100, 'Expected >100 circuit pads');

    const webMesh = new HeadMesh({
      ...highClassic,
      paint: new Int32Array(highClassic.vertexCount),
    });
    const web = new NetworkWeb(webMesh);
    assert.ok(web.count > 5000, `Expected >5,000 polygon web nodes, got ${web.count}`);
    assert.ok(web.edges.length > 20000, 'Expected >20,000 polygon web edge endpoints');
    const skinTriangles = new Set();
    for (let t = 0; t < webMesh.faceCount; t++) {
      if (webMesh.faceGroup[t] < 0.5 || webMesh.faceGroup[t] > 1.5) continue;
      const a = webMesh.faces[3 * t], b = webMesh.faces[3 * t + 1], c = webMesh.faces[3 * t + 2];
      skinTriangles.add([a, b, c].sort((x, y) => x - y).join(','));
    }
    for (let i = 0; i < web.count; i++) {
      const key = [web.triA[i], web.triB[i], web.triC[i]].sort((x, y) => x - y).join(',');
      assert.ok(skinTriangles.has(key), 'polygon web samples only face skin, never hair polygons');
    }

    assert.equal(ALL_VOICES.length, 30);
    for (const v of ALL_VOICES) {
      const prof = VOICE_PROFILES[v];
      assert.ok(prof, `Voice ${v} has acoustic profile`);
      assert.ok(prof.gender === 'female' || prof.gender === 'male');
    }

    configStore.update({
      avatarFaceId: 'classic',
      avatarSkin: 7,
      avatarCircuits: false,
      avatarPolygonLevel: 'low',
      voiceName: 'Fenrir',
    });
    assert.equal(configStore.get().avatarFaceId, 'classic');
    assert.equal(configStore.get().avatarSkin, 7);
    assert.equal(configStore.get().avatarCircuits, false);
    assert.equal(configStore.get().avatarPolygonLevel, 'low');
    assert.equal(configStore.get().voiceName, 'Fenrir');
  });

  it('checks bundled plugin definitions, parameter placeholders, desktop routines and JSON/index sync', () => {
    const index = JSON.parse(fs.readFileSync(path.join(ASSETS_DIR, 'plugins/index.json'), 'utf8'));
    const tools = new Set([...new ToolRegistry().tools.keys()]);
    assert.equal(index.length, 82);
    for (const entry of index) {
      const spec = entry.spec || entry;
      assert.ok(spec.name && spec.description, `Plugin ${entry.fileName} has metadata`);
      const disk = JSON.parse(fs.readFileSync(path.join(ASSETS_DIR, `plugins/${entry.fileName}`), 'utf8'));
      assert.deepEqual(spec, disk, `${spec.name} index entry matches its JSON file`);
      const declared = new Set((spec.parameters || []).map((p) => p.name));
      const templates = [spec.url, spec.uri, spec.body, spec.body_template, ...(spec.steps || []).flatMap((step) => Object.values(step.args || {}))]
        .filter((value) => typeof value === 'string').join(' ');
      for (const [, key] of templates.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)) {
        assert.ok(declared.has(key), `${spec.name} uses declared placeholder ${key}`);
      }
      if (spec.type === 'routine') {
        assert.ok(spec.steps?.length > 0, `${spec.name} has routine steps`);
        for (const step of spec.steps) assert.ok(tools.has(step.tool), `${spec.name} uses PC tool ${step.tool}`);
      }
      if (spec.type === 'http') assert.ok(spec.url.startsWith('https://'), `${spec.name} uses HTTPS`);
    }
  });

  it('keeps the app, lockfile and GitHub release tag on the bumped package version', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
    const lock = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package-lock.json'), 'utf8'));
    const workflow = fs.readFileSync(path.resolve(process.cwd(), '.github/workflows/build-exe.yml'), 'utf8');
    const app = fs.readFileSync(path.resolve(process.cwd(), 'src/App.jsx'), 'utf8');
    assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
    assert.notEqual(pkg.version, '2.0.0', 'new release increments the previous 2.0.0 tag');
    assert.equal(lock.version, pkg.version);
    assert.equal(lock.packages[''].version, pkg.version);
    assert.match(app, /v\{packageJson\.version\}/);
    assert.match(workflow, /node -p "require\('\.\/package\.json'\)\.version"/);
    assert.match(workflow, /gh release create \$tag/);
    assert.doesNotMatch(workflow, /gh release create v2\.0\.0/);
  });

  it('formats nested JSON, array fields, and missing required plugin parameters safely', async () => {
    const engine = new PluginEngine();
    engine.loaded = true;
    engine.catalog = [{
      name: 'meteo_test', description: 'Météo de test.', type: 'http',
      parameters: [{ name: 'ville', description: 'Ville requise', required: true }],
      url: 'https://example.com/weather?city={ville}', result_fields: ['current.temperature', 'current.wind_speed'],
    }];
    const originalFetch = hostBridge.httpFetch;
    const calls = [];
    hostBridge.httpFetch = async (payload) => {
      calls.push(payload);
      return { ok: true, status: 200, text: '{"current":{"temperature":21,"wind_speed":9}}', json: { current: { temperature: 21, wind_speed: 9 } } };
    };
    try {
      const missing = await engine.runPlugin('meteo_test', {});
      assert.match(missing, /ville/);
      const result = await engine.runPlugin('meteo_test', { ville: 'Saint Étienne' });
      assert.match(calls[0].url, /Saint%20%C3%89tienne/);
      assert.match(result, /temperature : 21/);
      assert.match(result, /wind_speed : 9/);
      assert.match(result, /Données externes/);
      assert.equal(engine.formatResponse({ result_items: 'rows', result_fields: ['name', 'nested.value'] }, '', { rows: [{ name: 'Avion', nested: { value: 12 } }] }), '1. Avion — 12');
      assert.match(engine.formatResponse({ name: 'wikipedia_recherche' }, '', ['Jarvis', ['Jarvis'], ['Assistant personnel'], ['https://fr.wikipedia.org/wiki/Jarvis']]), /Assistant personnel/);
      assert.match(engine.formatResponse({ name: 'asteroides_du_jour' }, '', { near_earth_objects: { today: [{ name: '2026 AB', close_approach_data: [{ close_approach_date: '2026-09-29', miss_distance: { kilometers: '123456' } }], estimated_diameter: { kilometers: { estimated_diameter_max: 0.3 } } }] } }), /2026 AB.*123.456 km/);
    } finally {
      hostBridge.httpFetch = originalFetch;
    }
  });
});
