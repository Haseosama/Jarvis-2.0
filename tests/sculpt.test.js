import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { HeadMesh } from '../src/avatar/HeadMesh.js';
import { HoloAvatar } from '../src/avatar/Visemes.js';
import { customizeClassicFace } from '../src/avatar/FaceCustomizer.js';
import {
  addDelta, applySculpt, boxSelect, buildScene, buildTopology, clearOffsets, displayVerts, growSelection, isEmptySculpt, makeCamera,
  mirrorWeights, normalizeSculpt, pickTriangle, pickVertex, projectPoint, screenDeltaToWorld, sculptKey, sculptableVertexCount,
  selectEyelids, shrinkSelection, smoothOffsets, softWeights, trianglePoints, visibleReps, estimateSymmetryPlane, symmetrizeOffsets,
} from '../src/avatar/MeshSculpt.js';
import { drawSculptScene } from '../src/avatar/SculptView.js';
import { configStore } from '../src/core/ConfigStore.js';

const file = fs.readFileSync(new URL('../public/assets/avatar/head_mesh.bin', import.meta.url));
const raw = HeadMesh.parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
const base = customizeClassicFace(HeadMesh.refineClassicFace(raw), {});
const topo = buildTopology(base);

describe('Éditeur de polygones : données', () => {
  it('normalises, bounds and fingerprints the stored edits', () => {
    const clean = normalizeSculpt({ 5: [0.1, 0, 0], 6: [0, 0, 0], 7: [NaN, 9, 'x'], '-1': [1, 1, 1], abc: [1, 1, 1], 8: [1] });
    assert.deepEqual(Object.keys(clean), ['5', '7']);
    assert.deepEqual(clean[7], [0, 0.6, 0], 'offsets are clamped and non-numbers become 0');
    assert.equal(isEmptySculpt({}), true);
    assert.equal(isEmptySculpt(null), true);
    assert.equal(sculptKey({}), '');
    assert.notEqual(sculptKey({ 5: [0.1, 0, 0] }), sculptKey({ 5: [0.1, 0.1, 0] }));
    assert.equal(sculptKey({ 5: [0.1, 0, 0] }), sculptKey({ 5: [0.1, 0, 0] }));
    assert.ok(Object.keys(normalizeSculpt(Object.fromEntries(Array.from({ length: 13000 }, (_, i) => [i, [0.01, 0, 0]])))).length <= 12000);
  });

  it('is persisted and sanitised by the config store', () => {
    configStore.update({ avatarSculpt: { 12: [0.02, 0, 0], 13: ['x'] } });
    assert.deepEqual(configStore.get().avatarSculpt, { 12: [0.02, 0, 0] });
    configStore.update({ avatarSculpt: {} });
  });
});

describe('Éditeur de polygones : maillage', () => {
  it('edits everything except the hair and welds coincident seam vertices', () => {
    const limit = sculptableVertexCount(base);
    assert.equal(limit, 9328);
    assert.ok(topo.members.size < limit, 'seams are welded');
    for (const [r, list] of topo.members) for (const i of list) assert.equal(topo.rep[i], r);
    for (let t = 0; t < topo.tris.length; t++) assert.ok(topo.tris[t] < limit, 'no hair triangle in the editor');
  });

  it('applies edits to a copy only, moves seam twins together and refits normals', () => {
    const rep = topo.reps.find((r) => topo.members.get(r).length > 1);
    const weights = softWeights(topo, base.verts, new Set([rep]), 0);
    const edits = addDelta({}, topo, weights, [0, 0.03, 0.05]);
    const before = Float32Array.from(base.verts);
    const edited = applySculpt(base, edits);
    assert.deepEqual(Array.from(base.verts), Array.from(before), 'the source mesh is untouched');
    for (const i of topo.members.get(rep)) assert.ok(Math.abs(edited.verts[3 * i + 2] - base.verts[3 * i + 2] - 0.05) < 1e-6);
    assert.ok(edited.normals.some((v, i) => v !== base.normals[i]), 'normals follow the new surface');
    assert.equal(applySculpt(base, {}), base, 'no edits → same mesh');
    assert.equal(applySculpt(base, { 99999: [0.1, 0, 0] }), base, 'hair indices are ignored');
    // Hair vertices (outside the editable range) are never moved even when requested.
    const hairEdit = applySculpt(base, { 9400: [0.3, 0, 0], [rep]: [0.01, 0, 0] });
    assert.equal(hairEdit.verts[3 * 9400], base.verts[3 * 9400]);
  });

  it('keeps animating and subdividing after an edit (eye globe edit moves the iris centre)', () => {
    const lids = selectEyelids(base, topo, 'left', 1);
    const edits = addDelta({}, topo, softWeights(topo, base.verts, lids, 0.03), [0, -0.01, 0.004]);
    const edited = applySculpt(base, edits);
    const subdivided = HeadMesh.applyPolygonLevel(edited, 'high');
    assert.ok(subdivided.faceCount > edited.faceCount);
    assert.ok(subdivided.verts.every(Number.isFinite));
    const avatar = new HoloAvatar(edited);
    avatar.step(0.02, 1, true, 'IDLE', [{ level: 1, open: 1, wide: 0.1 }], 0.02);
    avatar.pose();
    assert.ok(avatar.pv.every(Number.isFinite));
    const globe = applySculpt(base, Object.fromEntries(Array.from({ length: base.eyeCount[0] }, (_, k) => [base.eyeFirst[0] + k, [0.02, 0, 0]])));
    assert.ok(Math.abs(globe.eyeCentre[0] - base.eyeCentre[0] - 0.02) < 1e-6);
    assert.equal(globe.eyeCentre[3], base.eyeCentre[3]);
  });
});

describe('Éditeur de polygones : sélection et outils', () => {
  const cam = makeCamera({ width: 700, height: 700 });
  const scene = buildScene(cam, base.verts, topo, base.normals);

  it('picks the visible vertex under the cursor and ignores hidden ones', () => {
    const nose = [...topo.reps].reduce((best, r) => (base.verts[3 * r + 2] > base.verts[3 * best + 2] && r < 8480 ? r : best), topo.reps[0]);
    const p = projectPoint(cam, base.verts[3 * nose], base.verts[3 * nose + 1], base.verts[3 * nose + 2]);
    assert.equal(pickVertex(scene, topo, p[0], p[1], 6), nose, 'the nose tip is pickable');
    // A back-of-head vertex projects onto the face but is occluded.
    const back = topo.reps.find((r) => base.verts[3 * r + 2] < -0.9 && Math.abs(base.verts[3 * r]) < 0.1 && r < 8480);
    const pb = projectPoint(cam, base.verts[3 * back], base.verts[3 * back + 1], base.verts[3 * back + 2]);
    assert.notEqual(pickVertex(scene, topo, pb[0], pb[1], 2), back, 'hidden vertices cannot be picked');
    assert.ok(!visibleReps(scene, topo).includes(back));
    const tri = pickTriangle(scene, p[0], p[1]);
    assert.ok(tri >= 0);
    assert.equal(trianglePoints(topo, tri).length, 3);
    const box = boxSelect(scene, topo, p[0] - 15, p[1] - 15, p[0] + 15, p[1] + 15);
    assert.ok(box.includes(nose));
    assert.ok(box.every((r) => visibleReps(scene, topo).includes(r)));
  });

  it('maps a screen drag to the view plane for any camera angle', () => {
    for (const yaw of [0, -1.5, 0.7]) {
      const c = makeCamera({ yaw, pitch: 0.3, width: 600, height: 600 });
      const d = screenDeltaToWorld(c, 30, -20);
      const a = projectPoint(c, 0, 0, 0);
      const b = projectPoint(c, d[0], d[1], d[2]);
      assert.ok(Math.abs(b[0] - a[0] - 30) < 1e-6 && Math.abs(b[1] - a[1] + 20) < 1e-6, `yaw ${yaw}`);
      assert.ok(Math.abs(b[2] - a[2]) < 1e-9, 'a drag never changes the depth');
    }
  });

  it('falls off along the surface, mirrors across the face and smooths', () => {
    const lids = selectEyelids(base, topo, 'left', 1);
    assert.ok(lids.size > 50);
    const cx = 0.5 * (base.eyeCentre[0] + base.eyeCentre[3]);
    assert.ok([...lids].every((r) => base.verts[3 * r] < cx), 'left eyelids are on the left of the face');
    const right = selectEyelids(base, topo, 'right', 1);
    assert.ok([...right].every((r) => base.verts[3 * r] > cx));
    const one = new Set([[...lids][0]]);
    const w0 = softWeights(topo, base.verts, one, 0);
    const w = softWeights(topo, base.verts, one, 0.05);
    assert.equal(w0.size, 1);
    assert.equal(w.get([...one][0]), 1);
    assert.ok(w.size > 5 && [...w.values()].every((v) => v >= 0 && v <= 1));
    assert.ok(growSelection(topo, one).size > 1);
    assert.equal(shrinkSelection(topo, growSelection(topo, one)).has([...one][0]), true);
    const mirrored = mirrorWeights(topo, base.verts, lids, 0, cx);
    assert.ok(mirrored.size > 0, 'some right-side counterparts are found');
    const both = addDelta({}, topo, softWeights(topo, base.verts, lids, 0), [0.01, 0, 0], mirrored);
    const [mr] = mirrored.keys();
    assert.ok(both[mr][0] < 0, 'the mirrored side moves the opposite way in x');
    // Smoothing a spike lowers it.
    const spike = [...lids][3];
    const rough = addDelta({}, topo, new Map([[spike, 1]]), [0, 0, 0.05]);
    const smoothed = smoothOffsets(rough, topo, base.verts, new Map([[spike, 1]]), 0.5);
    const mi = topo.members.get(spike)[0];
    assert.ok(smoothed[mi][2] < rough[mi][2]);
    assert.deepEqual(clearOffsets(rough, topo, new Set([spike])), {});
    assert.equal(displayVerts(base.verts, rough, topo.limit)[3 * mi + 2] > base.verts[3 * mi + 2], true);
  });

  it('draws the editor scene with any 2D context', () => {
    const calls = new Map();
    const ctx = new Proxy({}, { get: (_t, name) => (name === 'canvas' ? {} : (...args) => { calls.set(name, (calls.get(name) || 0) + 1); return args; }), set: () => true });
    drawSculptScene(ctx, scene, { topo, selection: new Set([topo.reps[10]]), soft: new Map([[topo.reps[11], 0.5]]), hoverVertex: topo.reps[12], box: [1, 1, 50, 50] });
    assert.ok(calls.get('fill') > 1000 && calls.get('stroke') >= 1);
  });

  it('exposes the editor in the creator and applies the edits to the avatar view', () => {
    const creator = fs.readFileSync(new URL('../src/ui/AvatarCreator.jsx', import.meta.url), 'utf8');
    assert.match(creator, /PolygonEditor/);
    assert.match(creator, /avatarSculpt: sculpt/);
    const view = fs.readFileSync(new URL('../src/avatar/AvatarView.jsx', import.meta.url), 'utf8');
    assert.match(view, /applySculpt\(customizeClassicFace/);
    assert.match(view, /sculptId\]\)/);
  });
});

describe('Éditeur de polygones : symétrie', () => {
  const cx = estimateSymmetryPlane(base, topo, -0.035);
  const eyeMid = 0.5 * (base.eyeCentre[0] + base.eyeCentre[3]);

  it('finds the mid-plane of the face', () => {
    assert.ok(Math.abs(cx - eyeMid) < 0.02, `plane ${cx} vs eye midpoint ${eyeMid}`);
  });

  it('copies the left side onto the right and leaves the source side untouched', () => {
    const left = symmetrizeOffsets(base, topo, {}, { from: 'left', cx });
    assert.ok(left.moved > 3000 && left.skipped < left.moved * 0.05);
    for (const key of Object.keys(left.offsets)) {
      const i = Number(key);
      assert.ok(base.verts[3 * i] + left.offsets[key][0] >= cx - 0.02 || base.verts[3 * i] > cx - 0.05, 'only the right side (and the blend band) moves');
      assert.ok(base.verts[3 * i] >= cx - 0.05, `left vertex ${i} must not move`);
    }
    const sym = applySculpt(base, left.offsets);
    // Both eye globes are now mirror images (same height, same depth, mirrored x).
    const [lx, ly, lz] = [sym.eyeCentre[0], sym.eyeCentre[1], sym.eyeCentre[2]];
    assert.ok(Math.abs((2 * cx - lx) - sym.eyeCentre[3]) < 1e-4);
    assert.ok(Math.abs(ly - sym.eyeCentre[4]) < 1e-4 && Math.abs(lz - sym.eyeCentre[5]) < 1e-4);
    // Running it again changes almost nothing (the result is stable).
    const again = symmetrizeOffsets(base, topo, left.offsets, { from: 'left', cx });
    let drift = 0;
    for (const key of Object.keys(again.offsets)) {
      const a = left.offsets[key] || [0, 0, 0];
      drift = Math.max(drift, Math.hypot(a[0] - again.offsets[key][0], a[1] - again.offsets[key][1], a[2] - again.offsets[key][2]));
    }
    assert.ok(drift < 0.01, `drift ${drift}`);
    assert.ok(sym.verts.every(Number.isFinite));
  });

  it('can copy the other way and be limited to a selection', () => {
    const rightToLeft = symmetrizeOffsets(base, topo, {}, { from: 'right', cx });
    for (const key of Object.keys(rightToLeft.offsets)) assert.ok(base.verts[3 * Number(key)] <= cx + 0.05, 'the right side stays put');
    const lids = selectEyelids(base, topo, 'right', 2);
    const only = symmetrizeOffsets(base, topo, {}, { from: 'left', cx, only: lids });
    assert.ok(only.moved > 0 && only.moved < 800, `${only.moved} points`);
    const full = symmetrizeOffsets(base, topo, {}, { from: 'left', cx });
    assert.ok(Object.keys(only.offsets).length < Object.keys(full.offsets).length / 3);
  });

  it('keeps previous manual edits on the source side and exposes the buttons in the editor', () => {
    const lids = selectEyelids(base, topo, 'left', 1);
    const mine = addDelta({}, topo, softWeights(topo, base.verts, lids, 0.02), [0, 0.01, 0]);
    const res = symmetrizeOffsets(base, topo, mine, { from: 'left', cx });
    for (const key of Object.keys(mine)) {
      if (base.verts[3 * Number(key)] < cx - 0.05) assert.deepEqual(res.offsets[key], mine[key]);
    }
    const editor = fs.readFileSync(new URL('../src/ui/PolygonEditor.jsx', import.meta.url), 'utf8');
    assert.match(editor, /Copier gauche → droite/);
    assert.match(editor, /Copier droite → gauche/);
  });
});
