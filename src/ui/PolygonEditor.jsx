import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HeadMesh, BUILT_IN_FACES } from '../avatar/HeadMesh.js';
import { customizeClassicFace } from '../avatar/FaceCustomizer.js';
import { loadHeadMesh } from '../avatar/meshLoader.js';
import {
  addDelta, boxSelect, buildScene, buildTopology, clearOffsets, displayVerts, growSelection, makeCamera, mirrorWeights,
  normalizeSculpt, pickTriangle, pickVertex, screenDeltaToWorld, selectEyelids, shrinkSelection, smoothOffsets, softWeights,
  trianglePoints,
} from '../avatar/MeshSculpt.js';
import { drawSculptScene } from '../avatar/SculptView.js';

const VIEWS = [
  { id: 'front', label: 'Face', yaw: 0 },
  { id: 'l34', label: '¾ gauche', yaw: -0.6 },
  { id: 'lprof', label: 'Profil gauche', yaw: -1.5 },
  { id: 'r34', label: '¾ droit', yaw: 0.6 },
  { id: 'rprof', label: 'Profil droit', yaw: 1.5 },
];
const HISTORY_LIMIT = 100;
const CLASSIC = BUILT_IN_FACES.find((face) => face.id === 'classic');

/**
 * Éditeur de polygones du visage Classique : sélection de sommets / polygones, déplacement dans le plan de la vue
 * avec influence douce, lissage, symétrie, annuler/rétablir. Les retouches sont des décalages par sommet
 * (appliqués après les curseurs) : rien n'est enregistré avant « Appliquer ».
 */
export default function PolygonEditor({ custom, sculpt, onApply, onClose }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const dataRef = useRef(null); // { base, topo, cx, eyes }
  const camRef = useRef({ yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0, centre: [0, -0.1, 0] });
  const offsetsRef = useRef(normalizeSculpt(sculpt));
  const liveRef = useRef(null);
  const dispRef = useRef(null);
  const sceneRef = useRef(null);
  const hoverRef = useRef({ vertex: -1, triangle: -1 });
  const boxRef = useRef(null);
  const dragRef = useRef(null);
  const spaceRef = useRef(false);
  const historyRef = useRef({ undo: [], redo: [] });
  const rafRef = useRef(0);
  const softRef = useRef(null);

  const [status, setStatus] = useState('loading');
  const [offsets, setOffsetsState] = useState(offsetsRef.current);
  const [selection, setSelection] = useState(() => new Set());
  const [tool, setTool] = useState('select');
  const [pickMode, setPickMode] = useState('vertex');
  const [radius, setRadius] = useState(0.05);
  const [mirror, setMirror] = useState(false);
  const [viewMode, setViewMode] = useState('both');
  const [showPoints, setShowPoints] = useState(true);
  const [step, setStep] = useState(0.004);
  const [message, setMessage] = useState('');
  const [dirty, setDirty] = useState(false);

  const optsRef = useRef({});
  optsRef.current = { tool, pickMode, radius, mirror, viewMode, showPoints, selection, step };

  // ── Rendu ────────────────────────────────────────────────────────────────
  const redraw = useCallback(() => {
    rafRef.current = 0;
    const canvas = canvasRef.current;
    const data = dataRef.current;
    if (!canvas || !data || !dispRef.current) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(50, canvas.clientWidth);
    const h = Math.max(50, canvas.clientHeight);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cam = makeCamera({ ...camRef.current, width: w, height: h });
    const scene = buildScene(cam, dispRef.current, data.topo, data.base.normals);
    sceneRef.current = scene;
    const o = optsRef.current;
    drawSculptScene(ctx, scene, {
      topo: data.topo,
      mode: o.viewMode,
      showPoints: o.showPoints,
      selection: o.selection,
      soft: o.tool === 'move' && o.selection.size > 0 && o.radius > 0 ? softRef.current : null,
      hoverVertex: o.pickMode === 'vertex' ? hoverRef.current.vertex : -1,
      hoverTriangle: o.pickMode === 'triangle' ? hoverRef.current.triangle : -1,
      box: boxRef.current,
    });
  }, []);
  const requestRedraw = useCallback(() => {
    if (!rafRef.current) rafRef.current = requestAnimationFrame(redraw);
  }, [redraw]);

  const syncDisplay = useCallback((list) => {
    const data = dataRef.current;
    if (!data) return;
    dispRef.current = displayVerts(data.base.verts, list, data.topo.limit);
  }, []);

  // ── Chargement du maillage de base (Classique + curseurs du créateur) ───────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await loadHeadMesh(CLASSIC.asset);
        const base = customizeClassicFace(HeadMesh.refineClassicFace(raw), custom);
        const topo = buildTopology(base);
        const xs = [];
        for (let e = 0; e < (base.eyeCentre?.length || 0) / 3; e++) xs.push({ x: base.eyeCentre[3 * e], y: base.eyeCentre[3 * e + 1], z: base.eyeCentre[3 * e + 2] });
        xs.sort((a, b) => a.x - b.x);
        const cx = xs.length >= 2 ? 0.5 * (xs[0].x + xs[xs.length - 1].x) : 0;
        if (cancelled) return;
        dataRef.current = { base, topo, cx, eyes: xs };
        syncDisplay(offsetsRef.current);
        setStatus('ready');
      } catch (error) {
        console.error('Polygon editor load error:', error);
        if (!cancelled) setStatus('error');
      }
    })();
    return () => { cancelled = true; cancelAnimationFrame(rafRef.current); };
  }, [custom, syncDisplay]);

  useEffect(() => { if (status === 'ready') requestRedraw(); }, [status, tool, pickMode, radius, mirror, viewMode, showPoints, selection, offsets, requestRedraw]);

  useEffect(() => {
    const data = dataRef.current;
    if (status !== 'ready' || !data) return;
    softRef.current = selection.size && radius > 0 ? softWeights(data.topo, dispRef.current, selection, radius) : null;
    requestRedraw();
  }, [status, selection, radius, offsets, requestRedraw]);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => requestRedraw());
    observer.observe(node);
    return () => observer.disconnect();
  }, [requestRedraw, status]);

  // ── Historique ────────────────────────────────────────────────────────────
  const commit = useCallback((next, note = '') => {
    const hist = historyRef.current;
    hist.undo.push(offsetsRef.current);
    if (hist.undo.length > HISTORY_LIMIT) hist.undo.shift();
    hist.redo = [];
    offsetsRef.current = next;
    syncDisplay(next);
    setOffsetsState(next);
    setDirty(true);
    if (note) setMessage(note);
  }, [syncDisplay]);

  const undo = useCallback(() => {
    const hist = historyRef.current;
    if (!hist.undo.length) return;
    hist.redo.push(offsetsRef.current);
    offsetsRef.current = hist.undo.pop();
    syncDisplay(offsetsRef.current);
    setOffsetsState(offsetsRef.current);
    setMessage('Annulé.');
  }, [syncDisplay]);

  const redo = useCallback(() => {
    const hist = historyRef.current;
    if (!hist.redo.length) return;
    hist.undo.push(offsetsRef.current);
    offsetsRef.current = hist.redo.pop();
    syncDisplay(offsetsRef.current);
    setOffsetsState(offsetsRef.current);
    setMessage('Rétabli.');
  }, [syncDisplay]);

  // ── Opérations sur la sélection ───────────────────────────────────────────
  const currentWeights = () => {
    const data = dataRef.current;
    const o = optsRef.current;
    const weights = softWeights(data.topo, dispRef.current, o.selection, o.radius);
    const mirrorW = o.mirror ? mirrorWeights(data.topo, dispRef.current, o.selection, o.radius, data.cx) : null;
    return { weights, mirrorW };
  };

  const nudge = (vec) => {
    const data = dataRef.current;
    if (!data || !selection.size) return setMessage('Sélectionnez d’abord des points.');
    const { weights, mirrorW } = currentWeights();
    commit(addDelta(offsetsRef.current, data.topo, weights, vec, mirrorW));
  };
  const viewVectors = () => {
    const cam = makeCamera({ ...camRef.current, width: 100, height: 100 });
    return { right: cam.r0, up: cam.r1, toward: cam.r2 };
  };
  const nudgeView = (dir) => {
    const { right, up, toward } = viewVectors();
    const k = optsRef.current.step;
    const table = { left: right.map((v) => -v * k), right: right.map((v) => v * k), up: up.map((v) => v * k), down: up.map((v) => -v * k), toward: toward.map((v) => v * k), away: toward.map((v) => -v * k) };
    nudge(table[dir]);
  };

  const smoothSelection = () => {
    const data = dataRef.current;
    if (!data || !selection.size) return setMessage('Sélectionnez d’abord des points à lisser.');
    const { weights, mirrorW } = currentWeights();
    let next = smoothOffsets(offsetsRef.current, data.topo, data.base.verts, weights, 0.5);
    if (mirrorW) next = smoothOffsets(next, data.topo, data.base.verts, mirrorW, 0.5);
    commit(next, 'Zone lissée (recliquez pour lisser davantage).');
  };

  const resetSelection = () => {
    const data = dataRef.current;
    if (!data || !selection.size) return;
    commit(clearOffsets(offsetsRef.current, data.topo, selection), 'Points remis à leur forme d’origine.');
  };

  const resetAll = () => {
    if (!Object.keys(offsetsRef.current).length) return;
    if (window.confirm('Annuler toutes les retouches de polygones ?')) commit({}, 'Toutes les retouches ont été effacées (Ctrl+Z pour revenir).');
  };

  // ── Vue ───────────────────────────────────────────────────────────────────
  const setView = (patch) => {
    camRef.current = { ...camRef.current, ...patch };
    requestRedraw();
  };
  const focusEye = (side) => {
    const data = dataRef.current;
    if (!data?.eyes.length) return;
    const eye = side === 'left' ? data.eyes[0] : data.eyes[data.eyes.length - 1];
    setView({ zoom: 5, panX: 0, panY: 0, centre: [eye.x, eye.y, eye.z] });
  };

  // ── Sélection ─────────────────────────────────────────────────────────────
  const applySelection = (reps, how) => {
    setSelection((current) => {
      if (how === 'replace') return new Set(reps);
      const next = new Set(current);
      for (const r of reps) {
        if (how === 'toggle' && next.has(r)) next.delete(r); else next.add(r);
      }
      return next;
    });
  };
  const modifier = (e) => (e.shiftKey ? 'add' : e.ctrlKey || e.metaKey ? 'toggle' : 'replace');

  // ── Souris ────────────────────────────────────────────────────────────────
  const localPoint = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  const onPointerDown = (e) => {
    const data = dataRef.current;
    if (!data || !sceneRef.current) return;
    canvasRef.current.focus({ preventScroll: true });
    canvasRef.current.setPointerCapture?.(e.pointerId);
    const [x, y] = localPoint(e);
    let kind = 'select';
    if (e.button === 2 || (e.button === 0 && e.altKey)) kind = 'orbit';
    else if (e.button === 1 || (e.button === 0 && spaceRef.current)) kind = 'pan';
    else if (e.button === 0 && optsRef.current.tool === 'move' && optsRef.current.selection.size > 0) kind = 'move';
    else if (e.button !== 0) return;
    dragRef.current = { kind, x0: x, y0: y, lx: x, ly: y, moved: false, mod: modifier(e) };
    if (kind === 'move') {
      const { weights, mirrorW } = currentWeights();
      Object.assign(dragRef.current, { weights, mirrorW, start: offsetsRef.current, cam: sceneRef.current.cam });
    }
    e.preventDefault();
  };

  const onPointerMove = (e) => {
    const data = dataRef.current;
    if (!data) return;
    const [x, y] = localPoint(e);
    const drag = dragRef.current;
    if (!drag) {
      const scene = sceneRef.current;
      if (scene) {
        const o = optsRef.current;
        hoverRef.current = o.pickMode === 'vertex'
          ? { vertex: pickVertex(scene, data.topo, x, y, 10), triangle: -1 }
          : { vertex: -1, triangle: pickTriangle(scene, x, y) };
        requestRedraw();
      }
      return;
    }
    if (Math.hypot(x - drag.x0, y - drag.y0) > 3) drag.moved = true;
    if (drag.kind === 'orbit') {
      const cam = camRef.current;
      camRef.current = { ...cam, yaw: cam.yaw + (x - drag.lx) * 0.008, pitch: Math.max(-1.4, Math.min(1.4, cam.pitch + (y - drag.ly) * 0.008)) };
    } else if (drag.kind === 'pan') {
      const cam = camRef.current;
      camRef.current = { ...cam, panX: cam.panX + (x - drag.lx), panY: cam.panY + (y - drag.ly) };
    } else if (drag.kind === 'move' && drag.moved) {
      const delta = screenDeltaToWorld(drag.cam, x - drag.x0, y - drag.y0);
      liveRef.current = addDelta(drag.start, data.topo, drag.weights, delta, drag.mirrorW);
      dispRef.current = displayVerts(data.base.verts, liveRef.current, data.topo.limit);
    } else if (drag.kind === 'select' && drag.moved) {
      boxRef.current = [drag.x0, drag.y0, x, y];
    }
    drag.lx = x;
    drag.ly = y;
    requestRedraw();
  };

  const onPointerUp = (e) => {
    const data = dataRef.current;
    const drag = dragRef.current;
    dragRef.current = null;
    if (!data || !drag) return;
    canvasRef.current.releasePointerCapture?.(e.pointerId);
    const [x, y] = localPoint(e);
    if (drag.kind === 'move' && drag.moved && liveRef.current) {
      const next = liveRef.current;
      liveRef.current = null;
      commit(next);
    } else if (drag.kind === 'select') {
      boxRef.current = null;
      const scene = sceneRef.current;
      if (drag.moved) {
        applySelection(boxSelect(scene, data.topo, drag.x0, drag.y0, x, y), drag.mod);
      } else if (optsRef.current.pickMode === 'vertex') {
        const hit = pickVertex(scene, data.topo, x, y, 10);
        if (hit >= 0) applySelection([hit], drag.mod); else if (drag.mod === 'replace') setSelection(new Set());
      } else {
        const t = pickTriangle(scene, x, y);
        if (t >= 0) applySelection(trianglePoints(data.topo, t), drag.mod); else if (drag.mod === 'replace') setSelection(new Set());
      }
    }
    requestRedraw();
  };

  // Molette (non passive pour bloquer le défilement de la page) et menu contextuel
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || status !== 'ready') return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left - rect.width / 2;
      const py = e.clientY - rect.top - rect.height / 2;
      const cam = camRef.current;
      const f = Math.exp(-e.deltaY * 0.0015);
      const zoom = Math.max(0.4, Math.min(40, cam.zoom * f));
      const k = zoom / cam.zoom;
      camRef.current = { ...cam, zoom, panX: px - (px - cam.panX) * k, panY: py - (py - cam.panY) * k };
      requestRedraw();
    };
    const onContext = (e) => e.preventDefault();
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContext);
    return () => { canvas.removeEventListener('wheel', onWheel); canvas.removeEventListener('contextmenu', onContext); };
  }, [status, requestRedraw]);

  // Clavier : annuler / rétablir, flèches, Échap (ferme l'éditeur sans fermer le créateur)
  const close = useCallback(() => {
    if (dirty && !window.confirm('Quitter sans appliquer vos retouches de polygones ?')) return;
    onClose?.();
  }, [dirty, onClose]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
      if (e.code === 'Space' && e.target === canvasRef.current) { spaceRef.current = true; e.preventDefault(); }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (e.target !== canvasRef.current) return;
      const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', PageUp: 'toward', PageDown: 'away' };
      if (map[e.key]) { e.preventDefault(); nudgeView(map[e.key]); }
    };
    const onKeyUp = (e) => { if (e.code === 'Space') spaceRef.current = false; };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', onKeyUp, true); };
  });

  const editedCount = useMemo(() => Object.keys(offsets).length, [offsets]);
  const data = dataRef.current;
  const triCount = useMemo(() => {
    if (!data || !selection.size) return 0;
    let n = 0;
    for (let t = 0; t < data.topo.tris.length / 3; t++) {
      const [a, b, c] = trianglePoints(data.topo, t);
      if (selection.has(a) && selection.has(b) && selection.has(c)) n++;
    }
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, status]);

  const apply = () => onApply?.(normalizeSculpt(offsetsRef.current));

  return (
    <div className="creator-overlay poly-overlay" role="dialog" aria-modal="true" aria-label="Éditeur de polygones">
      <div className="creator-panel poly-panel">
        <div className="space-header">
          <div>
            <strong>🧱 Éditeur de polygones — Classique</strong>
            <div className="space-sub">Clic : sélectionner · glisser : cadre · outil Déplacer : glisser les points · clic droit ou Alt+glisser : tourner · Espace+glisser : déplacer la vue · molette : zoom</div>
          </div>
          <button className="space-close-btn" onClick={close} title="Fermer (Échap)">✕</button>
        </div>

        <div className="poly-body">
          <div className="poly-canvas-wrap" ref={wrapRef}>
            {status === 'loading' && <div className="poly-state">Chargement du maillage…</div>}
            {status === 'error' && <div className="poly-state">⚠️ Impossible de charger le maillage du visage.</div>}
            <canvas
              ref={canvasRef}
              className="poly-canvas"
              tabIndex={0}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={() => { hoverRef.current = { vertex: -1, triangle: -1 }; requestRedraw(); }}
              style={{ cursor: tool === 'move' ? 'move' : 'crosshair' }}
            />
            <div className="poly-hud">{selection.size} point(s) · {triCount} polygone(s) · {editedCount} sommet(s) retouché(s){message ? ` — ${message}` : ''}</div>
          </div>

          <div className="poly-side">
            <section>
              <h4>Outil</h4>
              <div className="poly-row">
                <button className={`space-pill ${tool === 'select' ? 'active' : ''}`} onClick={() => setTool('select')}>👆 Sélectionner</button>
                <button className={`space-pill ${tool === 'move' ? 'active' : ''}`} onClick={() => setTool('move')}>✋ Déplacer</button>
              </div>
              <div className="poly-row">
                <button className={`space-pill ${pickMode === 'vertex' ? 'active' : ''}`} onClick={() => setPickMode('vertex')}>• Sommet</button>
                <button className={`space-pill ${pickMode === 'triangle' ? 'active' : ''}`} onClick={() => setPickMode('triangle')}>▲ Polygone</button>
              </div>
            </section>

            <section>
              <h4>Sélection</h4>
              <div className="poly-row">
                <button className="space-pill" onClick={() => selection.size && setSelection(growSelection(data.topo, selection))}>＋ Agrandir</button>
                <button className="space-pill" onClick={() => selection.size && setSelection(shrinkSelection(data.topo, selection))}>－ Réduire</button>
                <button className="space-pill" onClick={() => setSelection(new Set())}>Aucune</button>
              </div>
              <div className="poly-row">
                <button className="space-pill" disabled={!data} onClick={() => { setSelection(selectEyelids(data.base, data.topo, 'left', 2)); setTool('move'); }}>👁 Paupières gauche</button>
                <button className="space-pill" disabled={!data} onClick={() => { setSelection(selectEyelids(data.base, data.topo, 'right', 2)); setTool('move'); }}>👁 Paupières droite</button>
              </div>
              <div className="space-sub">« Gauche » et « droite » : côtés tels qu’on les voit à l’écran. Shift+clic ajoute, Ctrl+clic bascule.</div>
            </section>

            <section>
              <h4>Influence</h4>
              <label className="poly-slider">Rayon d’influence : {radius === 0 ? 'points choisis seulement' : radius.toFixed(3)}
                <input type="range" min="0" max="250" value={Math.round(radius * 1000)} onChange={(e) => setRadius(Number(e.target.value) / 1000)} />
              </label>
              <label className="space-sub"><input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} /> Symétrie gauche/droite (applique l’inverse de l’autre côté)</label>
            </section>

            <section>
              <h4>Déplacement précis</h4>
              <label className="poly-slider">Pas : {step.toFixed(3)}
                <input type="range" min="1" max="30" value={Math.round(step * 1000)} onChange={(e) => setStep(Number(e.target.value) / 1000)} />
              </label>
              <div className="poly-pad">
                <span /><button className="space-pill" onClick={() => nudgeView('up')} title="Haut (↑)">↑</button><span />
                <button className="space-pill" onClick={() => nudgeView('left')} title="Gauche (←)">←</button>
                <span className="space-sub">vue</span>
                <button className="space-pill" onClick={() => nudgeView('right')} title="Droite (→)">→</button>
                <button className="space-pill" onClick={() => nudgeView('toward')} title="Vers vous (Page ↑)">⊙ avant</button>
                <button className="space-pill" onClick={() => nudgeView('down')} title="Bas (↓)">↓</button>
                <button className="space-pill" onClick={() => nudgeView('away')} title="Vers l’arrière (Page ↓)">⊗ arrière</button>
              </div>
              <div className="poly-row">
                <button className="space-pill" onClick={smoothSelection}>🧽 Lisser</button>
                <button className="space-pill" onClick={resetSelection}>↺ Points d’origine</button>
              </div>
            </section>

            <section>
              <h4>Vue</h4>
              <div className="poly-row">
                {VIEWS.map((v) => <button key={v.id} className="space-pill" onClick={() => setView({ yaw: v.yaw, pitch: 0 })}>{v.label}</button>)}
              </div>
              <div className="poly-row">
                <button className="space-pill" onClick={() => setView({ zoom: 1, panX: 0, panY: 0, centre: [0, -0.1, 0] })}>Visage entier</button>
                <button className="space-pill" onClick={() => focusEye('left')}>🔍 Œil gauche</button>
                <button className="space-pill" onClick={() => focusEye('right')}>🔍 Œil droit</button>
              </div>
              <div className="poly-row">
                <select value={viewMode} onChange={(e) => setViewMode(e.target.value)}>
                  <option value="both">Plein + fils</option>
                  <option value="solid">Plein</option>
                  <option value="wire">Fils de fer</option>
                </select>
                <label className="space-sub"><input type="checkbox" checked={showPoints} onChange={(e) => setShowPoints(e.target.checked)} /> Points</label>
              </div>
            </section>
          </div>
        </div>

        <div className="creator-footer">
          <button className="space-pill" onClick={undo} disabled={!historyRef.current.undo.length}>↶ Annuler</button>
          <button className="space-pill" onClick={redo} disabled={!historyRef.current.redo.length}>↷ Rétablir</button>
          <button className="space-pill" onClick={resetAll} disabled={!editedCount}>🗑 Tout effacer</button>
          <span className="creator-spacer" />
          <button className="space-pill" onClick={close}>Annuler</button>
          <button className="space-pill active" onClick={apply}>✅ Valider les retouches</button>
        </div>
      </div>
    </div>
  );
}
