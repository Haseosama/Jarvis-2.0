import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { DEFAULT_SATELLITES, loadMapData, satelliteStateAt, subSolar } from './SpaceEngine.js';
import { fetchFlightsNear } from './TrackingService.js';
import { hostBridge } from '../core/hostBridge.js';
import {
  approachLon,
  clampLat,
  graticuleSegments,
  isFacingCamera,
  latLonToXYZ,
  normalizeLon,
  pickNearest,
  ringsToSegments,
  routePositions,
  visualRadius,
} from './globeGeometry.js';

const KIND_COLOR = {
  observer: '#ffd54f', origin: '#4ade80', destination: '#f87171', poi: '#38bdf8', marker: '#38bdf8',
  satellite: '#fde68a', quake: '#fb923c', flight: '#e0f2fe', city: '#7dd3fc',
};

function circleTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.55, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

const EARTH_VERTEX = 'varying vec3 vN; void main(){ vN = normalize(normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }';
const EARTH_FRAGMENT = 'uniform vec3 sunDir; uniform float shade; varying vec3 vN; void main(){ float d = dot(normalize(vN), normalize(sunDir)); float k = mix(1.0, smoothstep(-0.18, 0.28, d), shade); vec3 night = vec3(0.012,0.03,0.07); vec3 day = vec3(0.045,0.21,0.38); gl_FragColor = vec4(mix(night, day, k), 1.0); }';

/**
 * Real-time 3D globe (three.js). It reuses the existing space services (land/border data, ADS-B,
 * USGS, orbital models) instead of duplicating them; the route/marker props come from the same
 * `geospatial` and `sky_view` tools as the flat map.
 */
export default function GlobeView({ observer, markers = [], route = null, focus = null, onClose, onOpenMap }) {
  const mountRef = useRef(null);
  const stateRef = useRef({ lat: observer?.latDeg ?? 46, lon: observer?.lonDeg ?? 2, dist: 3.2, targetLat: null, targetLon: null, auto: true });
  const sceneRef = useRef(null);
  const itemsRef = useRef([]);
  const [layers, setLayers] = useState({ shade: true, auto: true, satellites: true, quakes: true, flights: false, cities: true });
  const [quakes, setQuakes] = useState([]);
  const [flights, setFlights] = useState([]);
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState('Chargement du globe…');
  const [nowMs, setNowMs] = useState(Date.now());
  const [mapData, setMapData] = useState(null);

  useEffect(() => { stateRef.current.auto = layers.auto; }, [layers.auto]);
  useEffect(() => { const id = setInterval(() => setNowMs(Date.now()), 2000); return () => clearInterval(id); }, []);
  useEffect(() => { loadMapData().then(setMapData).catch(() => setStatus('Données cartographiques indisponibles.')); }, []);

  // Fly to a requested place (route, POI search or city from the tools).
  useEffect(() => {
    const lat = Number(focus?.lat);
    const lon = Number(focus?.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      stateRef.current.targetLat = clampLat(lat);
      stateRef.current.targetLon = normalizeLon(lon);
      stateRef.current.auto = false;
      stateRef.current.dist = Number.isFinite(focus?.zoom) ? Math.max(1.4, 3.4 - Math.log2(Math.max(1, focus.zoom)) * 0.5) : stateRef.current.dist;
      setLayers((current) => ({ ...current, auto: false }));
    } else if (observer && Number.isFinite(observer.latDeg)) {
      stateRef.current.targetLat = clampLat(observer.latDeg);
      stateRef.current.targetLon = normalizeLon(observer.lonDeg);
    }
  }, [focus, observer?.latDeg, observer?.lonDeg]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await hostBridge.httpFetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson', { timeoutMs: 9000 });
      if (cancelled || !res.ok || !res.json?.features) return;
      setQuakes(res.json.features.slice(0, 40).map((f) => ({
        id: f.id, mag: f.properties?.mag || 4.5, place: f.properties?.place || 'Séisme',
        lon: f.geometry?.coordinates?.[0] || 0, lat: f.geometry?.coordinates?.[1] || 0, depthKm: f.geometry?.coordinates?.[2] || 10,
      })));
    })().catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!layers.flights || !observer) { setFlights([]); return undefined; }
    let cancelled = false;
    const refresh = async () => {
      const result = await fetchFlightsNear(observer.latDeg, observer.lonDeg, 250);
      if (cancelled) return;
      setFlights(result.flights.slice(0, 250));
      if (result.error) setStatus(result.error);
    };
    refresh();
    const id = setInterval(refresh, 45_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [layers.flights, observer?.latDeg, observer?.lonDeg]);

  // Scene setup (once).
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setStatus('WebGL indisponible : utilisez la carte 2D.');
      return undefined;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;cursor:grab';
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 100);

    const earthMaterial = new THREE.ShaderMaterial({ vertexShader: EARTH_VERTEX, fragmentShader: EARTH_FRAGMENT, uniforms: { sunDir: { value: new THREE.Vector3(1, 0, 0) }, shade: { value: 1 } } });
    const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 72, 48), earthMaterial);
    scene.add(earth);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(1.07, 48, 32), new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.07, side: THREE.BackSide, depthWrite: false }));
    scene.add(halo);

    const gridGeometry = new THREE.BufferGeometry();
    gridGeometry.setAttribute('position', new THREE.BufferAttribute(graticuleSegments(), 3));
    scene.add(new THREE.LineSegments(gridGeometry, new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.12 })));

    const starPositions = new Float32Array(900);
    for (let i = 0; i < 300; i += 1) {
      const u = Math.random() * 2 - 1; const a = Math.random() * Math.PI * 2; const s = Math.sqrt(1 - u * u);
      starPositions.set([s * Math.cos(a) * 40, u * 40, s * Math.sin(a) * 40], i * 3);
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    scene.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xbfdbfe, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.7 })));

    const sprite = circleTexture();
    const dynamic = new THREE.Group();
    scene.add(dynamic);
    sceneRef.current = { renderer, scene, camera, earthMaterial, dynamic, sprite, land: null, borders: null };

    const resize = () => {
      const width = mount.clientWidth || 640; const height = mount.clientHeight || 420;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observerResize = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    observerResize?.observe(mount);

    const place = () => {
      const view = stateRef.current;
      const [x, y, z] = latLonToXYZ(view.lat, view.lon, view.dist);
      camera.position.set(x, y, z);
      camera.up.set(0, 1, 0);
      camera.lookAt(0, 0, 0);
    };

    let frame = 0;
    const loop = () => {
      const view = stateRef.current;
      if (view.targetLat !== null) {
        view.lat += (view.targetLat - view.lat) * 0.08;
        view.lon = approachLon(view.lon, view.targetLon, 0.08);
        if (Math.abs(view.targetLat - view.lat) < 0.05 && Math.abs(normalizeLon(view.targetLon - view.lon)) < 0.05) { view.targetLat = null; view.targetLon = null; }
      } else if (view.auto && !view.dragging) {
        view.lon = normalizeLon(view.lon + 0.06);
      }
      place();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(loop);
    };
    loop();

    const dom = renderer.domElement;
    const pointer = { down: false, x: 0, y: 0, moved: 0 };
    const onDown = (event) => { pointer.down = true; pointer.x = event.clientX; pointer.y = event.clientY; pointer.moved = 0; stateRef.current.dragging = true; stateRef.current.targetLat = null; stateRef.current.targetLon = null; dom.setPointerCapture?.(event.pointerId); dom.style.cursor = 'grabbing'; };
    const onMove = (event) => {
      if (!pointer.down) return;
      const dx = event.clientX - pointer.x; const dy = event.clientY - pointer.y;
      pointer.x = event.clientX; pointer.y = event.clientY; pointer.moved += Math.abs(dx) + Math.abs(dy);
      const view = stateRef.current;
      const speed = 0.18 * (view.dist - 0.7);
      view.lon = normalizeLon(view.lon - dx * speed);
      view.lat = clampLat(view.lat + dy * speed);
    };
    const onUp = (event) => {
      pointer.down = false; stateRef.current.dragging = false; dom.style.cursor = 'grab';
      if (pointer.moved < 5) {
        const rect = dom.getBoundingClientRect();
        const cameraXYZ = [camera.position.x, camera.position.y, camera.position.z];
        const project = (xyz) => {
          const vector = new THREE.Vector3(...xyz).project(camera);
          return { x: ((vector.x + 1) / 2) * rect.width, y: ((1 - vector.y) / 2) * rect.height, visible: vector.z < 1 && isFacingCamera(xyz, cameraXYZ) };
        };
        setSelected(pickNearest(itemsRef.current, project, event.clientX - rect.left, event.clientY - rect.top, 16) || null);
      }
    };
    const onWheel = (event) => { event.preventDefault(); const view = stateRef.current; view.dist = Math.max(1.35, Math.min(6, view.dist * (1 + Math.sign(event.deltaY) * 0.08))); };
    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointermove', onMove);
    dom.addEventListener('pointerup', onUp);
    dom.addEventListener('pointercancel', onUp);
    dom.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(frame);
      observerResize?.disconnect();
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointermove', onMove);
      dom.removeEventListener('pointerup', onUp);
      dom.removeEventListener('pointercancel', onUp);
      dom.removeEventListener('wheel', onWheel);
      scene.traverse((object) => { object.geometry?.dispose?.(); const material = object.material; if (Array.isArray(material)) material.forEach((m) => m.dispose?.()); else material?.dispose?.(); });
      sprite.dispose();
      renderer.dispose();
      dom.remove();
      sceneRef.current = null;
    };
  }, []);

  // Land and border outlines once the data is available.
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx || !mapData) return;
    const make = (rings, color, opacity, radius, stride) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(ringsToSegments(rings, radius, stride), 3));
      const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
      ctx.scene.add(lines);
      return lines;
    };
    ctx.land = make(mapData.land, 0x67e8f9, 0.85, 1.0012, 1);
    ctx.borders = make(mapData.borders, 0x38bdf8, 0.28, 1.001, 2);
    setStatus('');
    return () => { for (const key of ['land', 'borders']) { const lines = ctx[key]; if (lines) { ctx.scene.remove(lines); lines.geometry.dispose(); lines.material.dispose(); ctx[key] = null; } } };
  }, [mapData, sceneRef.current]);

  // Day/night shading.
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    const sun = subSolar(nowMs);
    ctx.earthMaterial.uniforms.sunDir.value.set(...latLonToXYZ(sun.lat, sun.lon));
    ctx.earthMaterial.uniforms.shade.value = layers.shade ? 1 : 0;
  }, [nowMs, layers.shade]);

  const items = useMemo(() => {
    const list = [];
    if (observer && Number.isFinite(observer.latDeg)) list.push({ id: 'observer', kind: 'observer', label: observer.label || 'Ma position', lat: observer.latDeg, lon: observer.lonDeg, alt: 0, detail: 'Position de référence' });
    markers.forEach((marker, index) => {
      if (Number.isFinite(Number(marker.lat)) && Number.isFinite(Number(marker.lon))) list.push({ id: `marker-${index}`, kind: marker.kind || 'marker', label: marker.name || marker.label || 'Repère', lat: Number(marker.lat), lon: Number(marker.lon), alt: 0, detail: marker.address || '' });
    });
    if (layers.satellites) {
      for (const sat of DEFAULT_SATELLITES) {
        const state = satelliteStateAt(sat, nowMs);
        list.push({ id: `sat-${sat.norad}`, kind: 'satellite', label: sat.name, lat: state.lat, lon: state.lon, alt: state.altKm, detail: `Altitude ${Math.round(state.altKm)} km (orbite modélisée)`, color: sat.color });
      }
    }
    if (layers.quakes) quakes.forEach((q) => list.push({ id: `quake-${q.id}`, kind: 'quake', label: `M${Number(q.mag).toFixed(1)} · ${q.place}`, lat: q.lat, lon: q.lon, alt: 0, detail: `Profondeur ${Math.round(q.depthKm)} km (USGS)` }));
    if (layers.flights) flights.forEach((f, index) => list.push({ id: `flight-${f.icao24 || index}`, kind: 'flight', label: f.callsign || f.icao24 || 'Avion', lat: f.lat, lon: f.lon, alt: 0.3, detail: `${f.type || 'Type inconnu'} · ${f.altitudeM != null ? `${Math.round(f.altitudeM)} m` : 'altitude inconnue'}${f.speedKnots != null ? ` · ${Math.round(f.speedKnots * 1.852)} km/h` : ''} (ADS-B)` }));
    if (layers.cities && mapData?.cities) mapData.cities.filter((city) => city.capital).slice(0, 120).forEach((city) => list.push({ id: `city-${city.name}`, kind: 'city', label: city.name, lat: city.lat, lon: city.lon, alt: 0, detail: `Capitale · ${city.population.toLocaleString('fr-FR')} hab.` }));
    return list.filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon)).map((item) => ({ ...item, xyz: latLonToXYZ(item.lat, item.lon, item.kind === 'flight' ? 1.012 : visualRadius(item.alt)) }));
  }, [observer, markers, layers.satellites, layers.quakes, layers.flights, layers.cities, quakes, flights, mapData, Math.floor(nowMs / 4000)]);

  // Points + route are rebuilt whenever the layered data changes.
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return undefined;
    itemsRef.current = items;
    const positions = new Float32Array(items.length * 3);
    const colors = new Float32Array(items.length * 3);
    items.forEach((item, index) => {
      positions.set(item.xyz, index * 3);
      new THREE.Color(item.color || KIND_COLOR[item.kind] || '#38bdf8').toArray(colors, index * 3);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, vertexColors: true, map: ctx.sprite, transparent: true, alphaTest: 0.2, depthWrite: false }));
    ctx.dynamic.add(points);
    const owned = [points];
    if (route?.waypoints?.length > 1) {
      const lineGeometry = new THREE.BufferGeometry();
      const long = route.mode !== 'driving';
      lineGeometry.setAttribute('position', new THREE.BufferAttribute(routePositions(route.waypoints, 1.006, long ? 0.05 : 0), 3));
      const line = new THREE.Line(lineGeometry, long
        ? new THREE.LineDashedMaterial({ color: 0x38bdf8, dashSize: 0.03, gapSize: 0.02 })
        : new THREE.LineBasicMaterial({ color: 0xfbbf24 }));
      if (long) line.computeLineDistances();
      ctx.dynamic.add(line);
      owned.push(line);
    }
    return () => { for (const object of owned) { ctx.dynamic.remove(object); object.geometry.dispose(); object.material.dispose(); } };
  }, [items, route, sceneRef.current]);

  const toggle = useCallback((key) => setLayers((current) => ({ ...current, [key]: !current[key] })), []);
  const recenter = () => { if (observer) { stateRef.current.targetLat = clampLat(observer.latDeg); stateRef.current.targetLon = normalizeLon(observer.lonDeg); stateRef.current.dist = 2.4; } };

  return (
    <div className="globe-view">
      <div className="space-header">
        <div>
          <strong>🌐 Globe 3D</strong>
          <div className="space-sub">Glisser pour tourner · molette pour zoomer · cliquer un point pour les détails</div>
        </div>
        <div className="globe-tools">
          {onOpenMap && <button className="space-pill" onClick={onOpenMap}>🗺️ Carte 2D</button>}
          {onClose && <button className="space-close-btn" onClick={onClose} title="Fermer">✕</button>}
        </div>
      </div>
      <div className="globe-toolbar">
        {[['shade', '🌙 Jour/nuit'], ['auto', '🔄 Rotation'], ['satellites', '🛰️ Satellites'], ['quakes', '🌋 Séismes'], ['flights', '✈️ Avions'], ['cities', '🏙️ Capitales']].map(([key, label]) => (
          <button key={key} className={`space-pill ${layers[key] ? 'active' : ''}`} onClick={() => toggle(key)}>{label}</button>
        ))}
        <button className="space-pill" onClick={recenter}>📍 Centrer</button>
      </div>
      <div className="globe-stage">
        <div ref={mountRef} className="globe-canvas" />
        {status && <div className="globe-status">{status}</div>}
        {selected && (
          <div className="globe-card">
            <button className="space-close-btn" onClick={() => setSelected(null)} title="Fermer">✕</button>
            <strong>{selected.label}</strong>
            <div>{selected.lat.toFixed(3)}°, {selected.lon.toFixed(3)}°</div>
            {selected.detail && <div className="space-sub">{selected.detail}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
