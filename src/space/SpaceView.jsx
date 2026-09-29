import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  loadMapData,
  loadStars,
  mercX,
  mercY,
  nightPolygon,
  subSolar,
  solarSystemObjects,
  projectStars,
  CONSTELLATION_FIGURES,
  DEFAULT_SATELLITES,
  satelliteStateAt,
  satelliteTrack,
  lookAt,
  moonPhase,
} from './SpaceEngine.js';
import { hostBridge } from '../core/hostBridge.js';

export default function SpaceView({
  mode = 'map', // 'map' | 'sky'
  observer = { latDeg: 48.8566, lonDeg: 2.3522, label: 'Paris' },
  markers = [],
  onClose,
}) {
  const canvasRef = useRef(null);
  const [activeTab, setActiveTab] = useState(mode === 'sky' ? 'sky' : 'map');
  const [mapData, setMapData] = useState(null);
  const [stars, setStars] = useState([]);
  const [zoom, setZoom] = useState(1.65);
  const [centerLon, setCenterLon] = useState(observer.lonDeg || 2.3522);
  const [centerLat, setCenterLat] = useState(observer.latDeg || 46.5);
  const [selectedSat, setSelectedSat] = useState(DEFAULT_SATELLITES[0]);
  const [showTerminator, setShowTerminator] = useState(true);
  const [showAurora, setShowAurora] = useState(false);
  const [showQuakes, setShowQuakes] = useState(true);
  const [quakes, setQuakes] = useState([]);
  const [launches, setLaunches] = useState([]);
  const [kpIndex, setKpIndex] = useState(3.3);
  const [selectedObject, setSelectedObject] = useState(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const dragRef = useRef(null);

  useEffect(() => {
    setActiveTab(mode === 'sky' ? 'sky' : 'map');
  }, [mode]);

  useEffect(() => {
    loadMapData().then(setMapData).catch(() => {});
    loadStars().then(setStars).catch(() => {});
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Load live USGS earthquakes & NOAA Kp & upcoming launches (with graceful fallback)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await hostBridge.httpFetch(
          'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson',
          { timeoutMs: 8000 }
        );
        if (!cancelled && res.ok && res.json?.features) {
          const parsed = res.json.features.slice(0, 25).map((f) => ({
            id: f.id,
            mag: f.properties?.mag || 4.5,
            place: f.properties?.place || 'Séisme',
            time: f.properties?.time || Date.now(),
            lon: f.geometry?.coordinates?.[0] || 0,
            lat: f.geometry?.coordinates?.[1] || 0,
            depthKm: f.geometry?.coordinates?.[2] || 10,
          }));
          setQuakes(parsed);
        }
      } catch {
        // Fallback sample seismic events if offline
        if (!cancelled) {
          setQuakes([
            { id: 'q1', mag: 5.4, place: 'Kamchatka, Russie', lon: 160.4, lat: 52.8, depthKm: 35 },
            { id: 'q2', mag: 4.9, place: 'Crète, Grèce', lon: 25.1, lat: 35.2, depthKm: 18 },
            { id: 'q3', mag: 5.1, place: 'Antofagasta, Chili', lon: -70.4, lat: -23.6, depthKm: 42 },
          ]);
        }
      }

      try {
        const lRes = await hostBridge.httpFetch(
          'https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=5',
          { timeoutMs: 8000 }
        );
        if (!cancelled && lRes.ok && lRes.json?.results) {
          setLaunches(
            lRes.json.results.map((r) => ({
              id: r.id,
              name: r.name,
              net: r.net,
              provider: r.launch_service_provider?.name || 'Agence spatiale',
              pad: r.pad?.name || 'Pas de tir',
              location: r.pad?.location?.name || '',
            }))
          );
        }
      } catch {
        if (!cancelled) {
          setLaunches([
            { id: 'l1', name: 'Ariane 6 | CSO-3', net: new Date(Date.now() + 86400000 * 3).toISOString(), provider: 'Arianespace', pad: 'ELA-4', location: 'Kourou, Guyane' },
            { id: 'l2', name: 'Falcon 9 | Starlink Group', net: new Date(Date.now() + 3600000 * 14).toISOString(), provider: 'SpaceX', pad: 'SLC-40', location: 'Cape Canaveral' },
          ]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const solarBodies = useMemo(
    () => solarSystemObjects(observer, nowMs),
    [observer.latDeg, observer.lonDeg, Math.floor(nowMs / 5000)]
  );

  const visibleStars = useMemo(
    () => (stars.length ? projectStars(stars, observer, nowMs, 4.5) : []),
    [stars, observer.latDeg, observer.lonDeg, Math.floor(nowMs / 15000)]
  );

  const phase = useMemo(() => moonPhase(nowMs), [Math.floor(nowMs / 60000)]);

  // Render Map or Sky on Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 680;
    const h = canvas.clientHeight || 440;
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    ctx.save();
    ctx.scale(dpr, dpr);

    if (activeTab === 'map') {
      drawWorldMap(ctx, w, h, {
        mapData,
        zoom,
        centerLon,
        centerLat,
        observer,
        nowMs,
        selectedSat,
        showTerminator,
        showAurora,
        showQuakes,
        quakes,
        markers,
        kpIndex,
      });
    } else if (activeTab === 'sky') {
      drawNightSky(ctx, w, h, {
        observer,
        nowMs,
        solarBodies,
        visibleStars,
        selectedSat,
      });
    }
    ctx.restore();
  }, [
    activeTab,
    mapData,
    zoom,
    centerLon,
    centerLat,
    observer,
    nowMs,
    selectedSat,
    showTerminator,
    showAurora,
    showQuakes,
    quakes,
    markers,
    kpIndex,
    solarBodies,
    visibleStars,
  ]);

  const handleMouseDown = (e) => {
    if (activeTab !== 'map') return;
    dragRef.current = { x: e.clientX, y: e.clientY, lon: centerLon, lat: centerLat };
  };

  const handleMouseMove = (e) => {
    if (!dragRef.current || activeTab !== 'map') return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    const scale = 360 / (600 * zoom);
    let nextLon = dragRef.current.lon - dx * scale;
    if (nextLon > 180) nextLon -= 360;
    if (nextLon < -180) nextLon += 360;
    const nextLat = Math.max(-75, Math.min(75, dragRef.current.lat + dy * scale * 0.75));
    setCenterLon(nextLon);
    setCenterLat(nextLat);
  };

  const handleMouseUp = () => {
    dragRef.current = null;
  };

  const handleWheel = (e) => {
    if (activeTab !== 'map') return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.2 : 0.84;
    setZoom((z) => Math.max(1.0, Math.min(12.0, z * factor)));
  };

  const satPos = satelliteStateAt(selectedSat, nowMs);
  const satLook = lookAt(observer, satPos.ecef);

  return (
    <div className="space-panel">
      <div className="space-header">
        <div className="space-tabs">
          <button
            className={`space-tab ${activeTab === 'map' ? 'active' : ''}`}
            onClick={() => setActiveTab('map')}
          >
            🌍 Carte & Orbites
          </button>
          <button
            className={`space-tab ${activeTab === 'sky' ? 'active' : ''}`}
            onClick={() => setActiveTab('sky')}
          >
            ✨ Voûte Céleste
          </button>
          <button
            className={`space-tab ${activeTab === 'launches' ? 'active' : ''}`}
            onClick={() => setActiveTab('launches')}
          >
            🚀 Lancements & Séismes
          </button>
        </div>
        <div className="space-header-right">
          <span className="space-badge">
            📍 {observer.label || 'Observateur'} ({observer.latDeg.toFixed(2)}°N, {observer.lonDeg.toFixed(2)}°E)
          </span>
          {onClose && (
            <button className="space-close-btn" onClick={onClose} title="Fermer">
              ✕
            </button>
          )}
        </div>
      </div>

      {activeTab === 'launches' ? (
        <div className="space-list-view">
          <div className="space-card">
            <h4>🚀 Prochains lancements spatiaux</h4>
            {launches.map((l) => (
              <div key={l.id} className="space-list-item">
                <div>
                  <strong>{l.name}</strong>
                  <div className="space-sub">
                    {l.provider} • {l.pad} ({l.location})
                  </div>
                </div>
                <span className="space-tag">
                  {new Date(l.net).toLocaleString('fr-FR', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            ))}
          </div>

          <div className="space-card">
            <h4>🌋 Derniers séismes significatifs (M4.5+)</h4>
            {quakes.slice(0, 10).map((q) => (
              <div key={q.id} className="space-list-item">
                <div>
                  <strong>M{q.mag.toFixed(1)} — {q.place}</strong>
                  <div className="space-sub">
                    Profondeur {q.depthKm} km • ({q.lat.toFixed(2)}°, {q.lon.toFixed(2)}°)
                  </div>
                </div>
                <button
                  className="space-mini-btn"
                  onClick={() => {
                    setCenterLat(q.lat);
                    setCenterLon(q.lon);
                    setZoom(3.5);
                    setActiveTab('map');
                  }}
                >
                  Voir carte
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-canvas-wrap">
          <canvas
            ref={canvasRef}
            className="space-canvas"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
          />
          <div className="space-controls-bar">
            {activeTab === 'map' && (
              <>
                <div className="space-sat-pills">
                  {DEFAULT_SATELLITES.map((s) => (
                    <button
                      key={s.norad}
                      className={`space-pill ${selectedSat.norad === s.norad ? 'active' : ''}`}
                      onClick={() => {
                        setSelectedSat(s);
                        const st = satelliteStateAt(s, Date.now());
                        setCenterLat(st.lat);
                        setCenterLon(st.lon);
                      }}
                    >
                      🛰️ {s.name}
                    </button>
                  ))}
                </div>
                <div className="space-toggles">
                  <label>
                    <input
                      type="checkbox"
                      checked={showTerminator}
                      onChange={(e) => setShowTerminator(e.target.checked)}
                    />
                    Jour/Nuit
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={showQuakes}
                      onChange={(e) => setShowQuakes(e.target.checked)}
                    />
                    Séismes ({quakes.length})
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={showAurora}
                      onChange={(e) => setShowAurora(e.target.checked)}
                    />
                    Aurores (Kp {kpIndex})
                  </label>
                </div>
              </>
            )}
            {activeTab === 'sky' && (
              <div className="space-sky-summary">
                <span>🌙 Lune : <strong>{phase.name}</strong> ({Math.round(phase.lit * 100)}%)</span>
                <span>
                  🛰️ {selectedSat.name} : élév. <strong>{satLook.elevationDeg.toFixed(1)}°</strong> • az.{' '}
                  <strong>{satLook.azimuthDeg.toFixed(0)}°</strong>
                </span>
                <span>
                  🪐 Planètes visibles :{' '}
                  {solarBodies
                    .filter((b) => b.kind === 'PLANET' && b.look.elevationDeg > 0)
                    .map((b) => `${b.name} (${b.look.elevationDeg.toFixed(0)}°)`)
                    .join(', ') || 'Sous l’horizon'}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── World Map Canvas Renderer ────────────────────────────────────────────────

function drawWorldMap(
  ctx,
  w,
  h,
  {
    mapData,
    zoom,
    centerLon,
    centerLat,
    observer,
    nowMs,
    selectedSat,
    showTerminator,
    showAurora,
    showQuakes,
    quakes,
    markers,
    kpIndex,
  }
) {
  ctx.fillStyle = '#050c18';
  ctx.fillRect(0, 0, w, h);

  const mapSize = Math.min(w, h * 1.35) * zoom;
  const cx = mercX(centerLon);
  const cy = mercY(centerLat);

  const project = (lon, lat) => {
    let dx = mercX(lon) - cx;
    if (dx > 0.5) dx -= 1;
    if (dx < -0.5) dx += 1;
    const dy = mercY(lat) - cy;
    return [w / 2 + dx * mapSize, h / 2 + dy * mapSize];
  };

  // Grid lines
  ctx.strokeStyle = 'rgba(0, 212, 255, 0.08)';
  ctx.lineWidth = 1;
  for (let lon = -180; lon <= 180; lon += 30) {
    const [x] = project(lon, 0);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let lat = -60; lat <= 75; lat += 30) {
    const [, y] = project(0, lat);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Continents & Borders from binary Natural Earth vectors
  if (mapData) {
    ctx.fillStyle = '#0d2238';
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.36)';
    ctx.lineWidth = 1;
    for (const ring of mapData.land) {
      ctx.beginPath();
      let prevX = null;
      for (let i = 0; i < ring.length; i += 2) {
        let dx = ring[i] - cx;
        if (dx > 0.5) dx -= 1;
        if (dx < -0.5) dx += 1;
        const px = w / 2 + dx * mapSize;
        const py = h / 2 + (ring[i + 1] - cy) * mapSize;
        if (i === 0 || (prevX !== null && Math.abs(px - prevX) > mapSize * 0.45)) {
          ctx.moveTo(px, py);
        } else {
          ctx.lineTo(px, py);
        }
        prevX = px;
      }
      ctx.fill();
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(0, 212, 255, 0.16)';
    ctx.lineWidth = 0.75;
    for (const ring of mapData.borders) {
      ctx.beginPath();
      let prevX = null;
      for (let i = 0; i < ring.length; i += 2) {
        let dx = ring[i] - cx;
        if (dx > 0.5) dx -= 1;
        if (dx < -0.5) dx += 1;
        const px = w / 2 + dx * mapSize;
        const py = h / 2 + (ring[i + 1] - cy) * mapSize;
        if (i === 0 || (prevX !== null && Math.abs(px - prevX) > mapSize * 0.45)) {
          ctx.moveTo(px, py);
        } else {
          ctx.lineTo(px, py);
        }
        prevX = px;
      }
      ctx.stroke();
    }

    // Major cities
    ctx.font = '10px "JetBrains Mono", monospace';
    for (const c of mapData.cities) {
      if (!c.capital && zoom < 2.2 && c.population < 3500000) continue;
      const [px, py] = project(c.lon, c.lat);
      if (px < 0 || px > w || py < 0 || py > h) continue;
      ctx.fillStyle = c.capital ? '#7fd8ff' : 'rgba(180,220,255,0.55)';
      ctx.beginPath();
      ctx.arc(px, py, c.capital ? 2.2 : 1.4, 0, Math.PI * 2);
      ctx.fill();
      if (zoom >= 1.8 || c.population > 6000000) {
        ctx.fillStyle = 'rgba(210, 238, 255, 0.78)';
        ctx.fillText(c.name, px + 4, py + 3);
      }
    }
  }

  // Day/Night Terminator
  if (showTerminator) {
    const poly = nightPolygon(nowMs);
    ctx.fillStyle = 'rgba(2, 6, 16, 0.48)';
    ctx.beginPath();
    poly.forEach(([lon, lat], i) => {
      const [px, py] = project(lon, lat);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fill();

    // Sun sub-solar position
    const sun = subSolar(nowMs);
    const [sx, sy] = project(sun.lon, sun.lat);
    ctx.fillStyle = '#ffd54f';
    ctx.beginPath();
    ctx.arc(sx, sy, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Aurora Borealis Oval
  if (showAurora) {
    const latEdge = 66.5 - kpIndex * 1.6;
    ctx.strokeStyle = 'rgba(52, 211, 153, 0.55)';
    ctx.lineWidth = 10;
    ctx.beginPath();
    for (let lon = -180; lon <= 180; lon += 5) {
      const [px, py] = project(lon, latEdge + Math.sin((lon * Math.PI) / 180) * 3);
      if (lon === -180) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // Earthquakes
  if (showQuakes && quakes.length > 0) {
    for (const q of quakes) {
      const [qx, qy] = project(q.lon, q.lat);
      if (qx < -20 || qx > w + 20 || qy < -20 || qy > h + 20) continue;
      const r = Math.max(3, (q.mag - 3.8) * 3.2);
      ctx.fillStyle = 'rgba(255, 87, 51, 0.35)';
      ctx.beginPath();
      ctx.arc(qx, qy, r * 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ff6b4a';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(qx, qy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Custom user markers
  for (const m of markers) {
    const [mx, my] = project(m.lon, m.lat);
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(mx, my, 5, 0, Math.PI * 2);
    ctx.fill();
    if (m.label) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '11px "Inter", sans-serif';
      ctx.fillText(m.label, mx + 8, my + 4);
    }
  }

  // Observer Marker
  const [ox, oy] = project(observer.lonDeg, observer.latDeg);
  ctx.strokeStyle = '#00e5ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(ox, oy, 6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#00e5ff';
  ctx.beginPath();
  ctx.arc(ox, oy, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // Selected Satellite Ground Track & Live Position
  if (selectedSat) {
    const trackSegs = satelliteTrack(selectedSat, nowMs, 92);
    ctx.strokeStyle = selectedSat.color || '#ffd54f';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([4, 4]);
    for (const seg of trackSegs) {
      ctx.beginPath();
      let prevX = null;
      seg.forEach(([lat, lon], idx) => {
        const [px, py] = project(lon, lat);
        if (idx === 0 || (prevX !== null && Math.abs(px - prevX) > mapSize * 0.4)) {
          ctx.moveTo(px, py);
        } else {
          ctx.lineTo(px, py);
        }
        prevX = px;
      });
      ctx.stroke();
    }
    ctx.setLineDash([]);

    const pos = satelliteStateAt(selectedSat, nowMs);
    const [sx, sy] = project(pos.lon, pos.lat);
    // Footprint circle
    ctx.strokeStyle = 'rgba(255, 213, 79, 0.32)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(sx, sy, 26 * Math.sqrt(zoom), 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = selectedSat.color || '#ffd54f';
    ctx.beginPath();
    ctx.arc(sx, sy, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.fillText(
      `${selectedSat.name} (${pos.lat.toFixed(1)}°, ${pos.lon.toFixed(1)}° • ${pos.altKm.toFixed(0)} km)`,
      sx + 9,
      sy - 6
    );
  }
}

// ── Night Sky Polar Dome Renderer ────────────────────────────────────────────

function drawNightSky(ctx, w, h, { observer, nowMs, solarBodies, visibleStars, selectedSat }) {
  ctx.fillStyle = '#030812';
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) * 0.44;

  const projectAltAz = (elDeg, azDeg) => {
    const r = ((90 - elDeg) / 90) * R;
    const azRad = (azDeg * Math.PI) / 180;
    // North up, East left (looking up at sky dome) or standard compass
    return [cx + r * Math.sin(azRad), cy - r * Math.cos(azRad)];
  };

  // Dome background gradient
  const grad = ctx.createRadialGradient(cx, cy, R * 0.05, cx, cy, R);
  grad.addColorStop(0, '#071428');
  grad.addColorStop(1, '#0c2240');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();

  // Altitude circles (30°, 60°, Horizon)
  ctx.strokeStyle = 'rgba(0, 212, 255, 0.22)';
  ctx.lineWidth = 1;
  for (const el of [0, 30, 60]) {
    const r = ((90 - el) / 90) * R;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Cardinal directions
  ctx.fillStyle = '#00e5ff';
  ctx.font = 'bold 12px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('N', cx, cy - R - 8);
  ctx.fillText('S', cx, cy + R + 16);
  ctx.fillText('E', cx + R + 12, cy + 4);
  ctx.fillText('O', cx - R - 12, cy + 4);

  // Constellation stick figures
  const byBayer = new Map();
  for (const s of visibleStars) {
    if (s.bayer) byBayer.set(s.bayer, s);
  }
  ctx.strokeStyle = 'rgba(100, 200, 255, 0.28)';
  ctx.lineWidth = 1;
  for (const fig of CONSTELLATION_FIGURES) {
    ctx.beginPath();
    let started = false;
    for (const key of fig) {
      const st = byBayer.get(key);
      if (!st) {
        started = false;
        continue;
      }
      const [px, py] = projectAltAz(st.look.elevationDeg, st.look.azimuthDeg);
      if (!started) {
        ctx.moveTo(px, py);
        started = true;
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();
  }

  // Stars
  ctx.textAlign = 'left';
  for (const s of visibleStars) {
    const [px, py] = projectAltAz(s.look.elevationDeg, s.look.azimuthDeg);
    const radius = Math.max(0.8, 3.3 - s.mag * 0.55);
    ctx.fillStyle = s.mag < 1.5 ? '#ffffff' : 'rgba(220, 238, 255, 0.82)';
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fill();
    if (s.name && s.mag < 2.1) {
      ctx.fillStyle = 'rgba(165, 220, 255, 0.78)';
      ctx.font = '10px "Inter", sans-serif';
      ctx.fillText(s.name, px + 5, py + 3);
    }
  }

  // Solar system bodies (Sun, Moon, Planets above horizon)
  for (const b of solarBodies) {
    if (b.look.elevationDeg <= 0) continue;
    const [px, py] = projectAltAz(b.look.elevationDeg, b.look.azimuthDeg);
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.arc(px, py, b.kind === 'SUN' || b.kind === 'MOON' ? 6.5 : 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px "Inter", sans-serif';
    ctx.fillText(b.name, px + 8, py + 4);
  }

  // Satellite if above horizon
  if (selectedSat) {
    const st = satelliteStateAt(selectedSat, nowMs);
    const look = lookAt(observer, st.ecef);
    if (look.elevationDeg > 0) {
      const [sx, sy] = projectAltAz(look.elevationDeg, look.azimuthDeg);
      ctx.fillStyle = '#ffd54f';
      ctx.beginPath();
      ctx.arc(sx, sy, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(`🛰️ ${selectedSat.name}`, sx + 8, sy + 4);
    }
  }
}
