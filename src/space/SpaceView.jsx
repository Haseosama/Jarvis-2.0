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
  parseTleCatalog,
  tleSatelliteTrack,
  tleStateAt,
  lookAt,
  moonPhase,
  observerFromCoordinates,
} from './SpaceEngine.js';
import { hostBridge } from '../core/hostBridge.js';
import {
  fetchAircraftDetails,
  fetchFlightsNear,
  fetchSatelliteLiveState,
  haversineDistanceKm,
} from './TrackingService.js';

export default function SpaceView({
  mode = 'map', // 'map' | 'sky'
  observer = { latDeg: 48.8566, lonDeg: 2.3522, label: 'Paris' },
  markers = [],
  onClose,
  onObserverChange,
}) {
  const canvasRef = useRef(null);
  const [activeTab, setActiveTab] = useState(mode === 'sky' ? 'sky' : 'map');
  const [mapData, setMapData] = useState(null);
  const [stars, setStars] = useState([]);
  const [zoom, setZoom] = useState(observer.label === 'Ma position' ? 4.2 : 1.65);
  const [centerLon, setCenterLon] = useState(observer.lonDeg ?? 2.3522);
  const [centerLat, setCenterLat] = useState(observer.latDeg ?? 46.5);
  const [selectedSat, setSelectedSat] = useState(DEFAULT_SATELLITES[0]);
  const [satelliteCatalog, setSatelliteCatalog] = useState([]);
  const [satelliteFeed, setSatelliteFeed] = useState('');
  const [loadingSatellites, setLoadingSatellites] = useState(false);
  const [showCatalogSatellites, setShowCatalogSatellites] = useState(true);
  const [flights, setFlights] = useState([]);
  const [flightSource, setFlightSource] = useState('');
  const [flightError, setFlightError] = useState('');
  const [loadingFlights, setLoadingFlights] = useState(false);
  const [showFlights, setShowFlights] = useState(true);
  const [selectedFlight, setSelectedFlight] = useState(null);
  const [flightDetails, setFlightDetails] = useState(null);
  const [loadingFlightDetails, setLoadingFlightDetails] = useState(false);
  const [entityPanel, setEntityPanel] = useState(null);
  const [liveSatellites, setLiveSatellites] = useState({});
  const [showTerminator, setShowTerminator] = useState(true);
  const [showAurora, setShowAurora] = useState(false);
  const [showQuakes, setShowQuakes] = useState(true);
  const [quakes, setQuakes] = useState([]);
  const [launches, setLaunches] = useState([]);
  const [kpIndex, setKpIndex] = useState(3.3);
  const [selectedObject, setSelectedObject] = useState(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [feedRefreshKey, setFeedRefreshKey] = useState(0);
  const [locatingPosition, setLocatingPosition] = useState(false);
  const [locationMessage, setLocationMessage] = useState('');
  const dragRef = useRef(null);
  const justDraggedRef = useRef(false);
  const mapHitsRef = useRef([]);
  const mapViewRef = useRef({ centerLat, centerLon });
  mapViewRef.current = { centerLat, centerLon };

  const locateCurrentPosition = () => {
    if (locatingPosition) return;
    const geolocation = typeof navigator !== 'undefined' ? navigator.geolocation : null;
    if (typeof geolocation?.getCurrentPosition !== 'function') {
      setLocationMessage('La géolocalisation n’est pas disponible dans cet environnement.');
      return;
    }
    setLocatingPosition(true);
    setLocationMessage('Recherche de votre position…');
    try {
      geolocation.getCurrentPosition(
        ({ coords }) => {
          const currentObserver = observerFromCoordinates(coords);
          if (!currentObserver) {
            setLocationMessage('La position renvoyée par le système est invalide.');
            setLocatingPosition(false);
            return;
          }
          onObserverChange?.(currentObserver);
          setCenterLat(currentObserver.latDeg);
          setCenterLon(currentObserver.lonDeg);
          setZoom(4.2);
          setFeedRefreshKey((key) => key + 1);
          const accuracy = Number.isFinite(coords.accuracy) ? ` (précision ±${Math.round(coords.accuracy)} m)` : '';
          setLocationMessage(`Carte centrée sur votre position${accuracy}.`);
          setLocatingPosition(false);
        },
        (error) => {
          const message = error?.code === 1
            ? 'Autorisez la localisation pour afficher votre position actuelle.'
            : error?.code === 3
            ? 'La localisation a expiré. Réessayez.'
            : 'Position actuelle indisponible; la position configurée est conservée.';
          setLocationMessage(message);
          setLocatingPosition(false);
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 5 * 60_000 }
      );
    } catch {
      setLocationMessage('La géolocalisation a été bloquée par le navigateur.');
      setLocatingPosition(false);
    }
  };

  useEffect(() => {
    const openSky = mode === 'sky';
    setActiveTab(openSky ? 'sky' : 'map');
    if (openSky) locateCurrentPosition();
  }, [mode]);

  useEffect(() => {
    loadMapData().then(setMapData).catch(() => {});
    loadStars().then(setStars).catch(() => {});
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Nearby ADS-B snapshot only (250 NM); panning fetches another region instead of polling the whole world.
  useEffect(() => {
    if (activeTab !== 'map') return undefined;
    let cancelled = false;
    const refresh = async () => {
      const view = mapViewRef.current;
      setLoadingFlights(true);
      const result = await fetchFlightsNear(view.centerLat, view.centerLon, 250);
      if (cancelled) return;
      setFlights(result.flights);
      setFlightSource(result.source);
      setFlightError(result.error);
      setLoadingFlights(false);
    };
    refresh();
    const id = setInterval(refresh, 45_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [activeTab, feedRefreshKey]);

  // Fetch a live TLE catalogue for stations, navigation, weather, science, Starlink and military satellites.
  useEffect(() => {
    if (activeTab !== 'map') return undefined;
    let cancelled = false;
    const refresh = async () => {
      setLoadingSatellites(true);
      const groups = [
        ['stations', 'science'],
        ['gps-ops', 'navigation'],
        ['weather', 'earth_obs'],
        ['science', 'science'],
        ['starlink', 'comms'],
        ['military', 'military'],
      ];
      const results = await Promise.all(groups.map(async ([group, category]) => {
        const response = await hostBridge.httpFetch(
          `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=tle`,
          { timeoutMs: 22000 }
        );
        return response.ok && response.text ? parseTleCatalog(response.text, category) : [];
      }));
      if (cancelled) return;
      const byNorad = new Map();
      for (const item of results.flat()) if (!byNorad.has(item.norad)) byNorad.set(item.norad, item);
      const catalog = [...byNorad.values()];
      setSatelliteCatalog(catalog);
      setSatelliteFeed(catalog.length ? `CelesTrak · ${catalog.length.toLocaleString('fr-FR')} TLE` : 'Catalogue TLE indisponible');
      setLoadingSatellites(false);
    };
    refresh();
    const id = setInterval(refresh, 60 * 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [activeTab, feedRefreshKey]);

  // Live ISS position, altitude and speed; other satellites use their fresh TLE.
  useEffect(() => {
    if (![25544, 48274, 20580].includes(Number(selectedSat?.norad))) return undefined;
    let cancelled = false;
    const refresh = async () => {
      const state = await fetchSatelliteLiveState(selectedSat.norad);
      if (!cancelled && state) setLiveSatellites((current) => ({ ...current, [selectedSat.norad]: state }));
    };
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [selectedSat?.norad]);

  useEffect(() => {
    if (!selectedFlight) { setFlightDetails(null); setLoadingFlightDetails(false); return undefined; }
    let cancelled = false;
    setFlightDetails(null);
    setLoadingFlightDetails(true);
    fetchAircraftDetails(selectedFlight)
      .then((details) => { if (!cancelled) setFlightDetails(details); })
      .finally(() => { if (!cancelled) setLoadingFlightDetails(false); });
    return () => { cancelled = true; };
  }, [selectedFlight?.icao24, selectedFlight?.callsign]);

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
  const mapSatellites = useMemo(() => {
    const byNorad = new Map(DEFAULT_SATELLITES.map((satellite) => [satellite.norad, satellite]));
    if (showCatalogSatellites) {
      for (const satellite of satelliteCatalog) {
        if (!byNorad.has(satellite.norad)) byNorad.set(satellite.norad, satellite);
        if (byNorad.size >= 703) break;
      }
    }
    return [...byNorad.values()];
  }, [satelliteCatalog, showCatalogSatellites]);

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
      mapHitsRef.current = drawWorldMap(ctx, w, h, {
        mapData,
        zoom,
        centerLon,
        centerLat,
        observer,
        nowMs,
        selectedSat,
        satellites: mapSatellites,
        liveSatellites,
        flights,
        showFlights,
        selectedFlight,
        flightDetails,
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
    mapSatellites,
    liveSatellites,
    flights,
    showFlights,
    selectedFlight,
    flightDetails,
    showTerminator,
    showQuakes,
    quakes,
    markers,
    kpIndex,
    solarBodies,
    visibleStars,
  ]);

  const handleMouseDown = (e) => {
    if (activeTab !== 'map') return;
    justDraggedRef.current = false;
    dragRef.current = { x: e.clientX, y: e.clientY, lon: centerLon, lat: centerLat };
  };

  const handleMouseMove = (e) => {
    if (!dragRef.current || activeTab !== 'map') return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) justDraggedRef.current = true;
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
    if (justDraggedRef.current) {
      const view = mapViewRef.current;
      fetchFlightsNear(view.centerLat, view.centerLon, 250).then((result) => {
        setFlights(result.flights);
        setFlightSource(result.source);
        setFlightError(result.error);
        setLoadingFlights(false);
      });
    }
  };

  const handleCanvasClick = (e) => {
    if (activeTab !== 'map') return;
    if (justDraggedRef.current) { justDraggedRef.current = false; return; }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const target = mapHitsRef.current
      .map((hit) => ({ hit, distance: Math.hypot(hit.x - x, hit.y - y) }))
      .filter((item) => item.distance <= (item.hit.type === 'flight' ? 17 : 18))
      .sort((a, b) => a.distance - b.distance)[0]?.hit;
    if (!target) { setEntityPanel(null); setSelectedFlight(null); return; }
    if (target.type === 'flight') {
      setSelectedFlight(target.flight);
      setEntityPanel({ type: 'flight', key: target.key });
    } else if (target.type === 'satellite') {
      setSelectedFlight(null);
      setSelectedSat(target.satellite);
      setEntityPanel({ type: 'satellite', key: String(target.satellite.norad) });
      setCenterLat(target.position.lat);
      setCenterLon(target.position.lon);
    }
  };

  const handleWheel = (e) => {
    if (activeTab !== 'map') return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.2 : 0.84;
    setZoom((z) => Math.max(1.0, Math.min(12.0, z * factor)));
  };

  const modeledSatPos = getSatelliteState(selectedSat, nowMs);
  const liveSelectedSat = liveSatellites[selectedSat.norad];
  const satPos = liveSelectedSat
    ? { ...modeledSatPos, lat: liveSelectedSat.latitude, lon: liveSelectedSat.longitude, altKm: liveSelectedSat.altitudeKm ?? modeledSatPos.altKm, ecef: livePositionEcef(liveSelectedSat) }
    : modeledSatPos;
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
            onClick={() => {
              setActiveTab('sky');
              locateCurrentPosition();
            }}
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
          <span className="space-badge" title={locationMessage || 'Position utilisée pour les calculs du ciel et le centre de la carte'}>
            📍 {observer.label || 'Observateur'} ({Math.abs(observer.latDeg).toFixed(2)}°{observer.latDeg >= 0 ? 'N' : 'S'}, {Math.abs(observer.lonDeg).toFixed(2)}°{observer.lonDeg >= 0 ? 'E' : 'O'})
          </span>
          <button
            className="space-mini-btn"
            onClick={locateCurrentPosition}
            disabled={locatingPosition}
            title={locationMessage || 'Centrer la carte et le ciel sur votre position actuelle'}
          >
            {locatingPosition ? '⏳ Position…' : '📍 Ma position'}
          </button>
          <button
            className="space-mini-btn"
            onClick={() => setFeedRefreshKey((key) => key + 1)}
            disabled={loadingFlights || loadingSatellites}
            title="Actualiser les vols ADS-B et le catalogue satellite CelesTrak"
          >
            {loadingFlights || loadingSatellites ? '⏳' : '↻'} Flux
          </button>
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
            onClick={handleCanvasClick}
            onWheel={handleWheel}
          />
          {activeTab === 'map' && entityPanel?.type === 'flight' && selectedFlight && (
            <FlightInfoCard flight={selectedFlight} details={flightDetails} loading={loadingFlightDetails} onClose={() => { setEntityPanel(null); setSelectedFlight(null); }} />
          )}
          {activeTab === 'map' && entityPanel?.type === 'satellite' && (
            <SatelliteInfoCard satellite={selectedSat} position={satPos} look={satLook} live={liveSatellites[selectedSat.norad]} onClose={() => setEntityPanel(null)} />
          )}
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
                  <label title="Afficher les satellites actifs issus des éléments orbitaux CelesTrak">
                    <input type="checkbox" checked={showCatalogSatellites} onChange={(e) => setShowCatalogSatellites(e.target.checked)} />
                    🛰️ Catalogue ({loadingSatellites ? '…' : satelliteCatalog.length})
                  </label>
                  <span className="space-feed-status" title={satelliteFeed || 'Chargement du catalogue TLE'}>
                    {loadingSatellites ? '● Chargement TLE…' : satelliteFeed || '● Catalogue local'}
                  </span>
                  <label title="Avions ADS-B dans un rayon de 250 NM autour du centre de carte">
                    <input type="checkbox" checked={showFlights} onChange={(e) => setShowFlights(e.target.checked)} />
                    ✈️ Vols ({loadingFlights ? '…' : flights.length})
                  </label>
                  <span className="space-feed-status" title={flightError || `Flux ADS-B : ${flightSource || 'connexion…'}`}>
                    {flightError ? '⚠ Flux hors ligne' : flightSource ? `● ${flightSource}` : '● Connexion…'}
                  </span>
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

function getSatelliteState(satellite, timeMs) {
  return satellite?.tle ? tleStateAt(satellite, timeMs) : satelliteStateAt(satellite, timeMs);
}

function getSatelliteTrack(satellite, timeMs, minutes) {
  return satellite?.tle ? tleSatelliteTrack(satellite, timeMs, minutes) : satelliteTrack(satellite, timeMs, minutes);
}

function livePositionEcef(live) {
  const radius = 6371 + (live.altitudeKm || 0);
  const lat = (live.latitude * Math.PI) / 180;
  const lon = (live.longitude * Math.PI) / 180;
  return [radius * Math.cos(lat) * Math.cos(lon), radius * Math.cos(lat) * Math.sin(lon), radius * Math.sin(lat)];
}

function displayValue(value, suffix = '') {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return 'Indisponible';
  return `${value}${suffix}`;
}

function FlightInfoCard({ flight, details, loading, onClose }) {
  const aircraft = details?.aircraft || {};
  const route = details?.route;
  const origin = route?.origin;
  const destination = route?.destination;
  const currentToDestination = destination?.lat != null && destination?.lon != null
    ? haversineDistanceKm(flight.lat, flight.lon, destination.lat, destination.lon)
    : null;
  const fullRoute = origin?.lat != null && destination?.lat != null
    ? haversineDistanceKm(origin.lat, origin.lon, destination.lat, destination.lon)
    : null;
  const etaMinutes = currentToDestination != null && flight.speedKnots > 40
    ? Math.round(currentToDestination / (flight.speedKnots * 1.852) * 60)
    : null;
  const rows = [
    ['Statut', flight.ground ? 'Au sol' : 'En vol'],
    ['Catégorie', ({ commercial: 'Commercial', private: 'Privé / aviation générale', jet: 'Jet d’affaires', military: 'Militaire' })[flight.category] || flight.category],
    ['Compagnie / exploitant', aircraft.operator || route?.airline || route?.airlineIcao],
    ['Indicatif', flight.callsign],
    ['ICAO24', flight.icao24],
    ['Immatriculation', aircraft.registration || flight.registration],
    ['Constructeur', aircraft.manufacturer],
    ['Modèle', aircraft.model || flight.type],
    ['Code OACI', aircraft.typeCode],
    ['Altitude', flight.altitudeM == null ? null : `${Math.round(flight.altitudeM).toLocaleString('fr-FR')} m (${Math.round(flight.altitudeFt || 0).toLocaleString('fr-FR')} ft)`],
    ['Vitesse sol', flight.speedKnots == null ? null : `${Math.round(flight.speedKnots)} kt (${Math.round(flight.speedKnots * 1.852)} km/h)`],
    ['Cap', flight.heading == null ? null : `${Math.round(flight.heading)}°`],
    ['Vitesse verticale', flight.verticalRateFpm == null ? null : `${Math.round(flight.verticalRateFpm)} ft/min`],
    ['Squawk', flight.squawk],
    ['Latitude / longitude', `${flight.lat.toFixed(5)}°, ${flight.lon.toFixed(5)}°`],
    ['Distance destination', currentToDestination == null ? null : `${Math.round(currentToDestination).toLocaleString('fr-FR')} km`],
    ['Distance de route', fullRoute == null ? null : `${Math.round(fullRoute).toLocaleString('fr-FR')} km`],
    ['ETA estimée', etaMinutes == null ? null : `${Math.floor(etaMinutes / 60)} h ${etaMinutes % 60} min (estimation)`],
    ['Points de trace réelle', details?.track?.length ? `${details.track.length} points` : null],
    ['Messages ADS-B', flight.messages],
    ['Âge du relevé', flight.seenSeconds == null ? null : `${Math.round(flight.seenSeconds)} s`],
    ['Source position', flight.source],
    ['Sources détails', details?.sources?.join(', ')],
  ];
  const airportName = (airport) => airport ? [airport.code, airport.city, airport.name, airport.country].filter(Boolean).join(' · ') : null;
  const externalUrl = flight.callsign ? `https://www.flightaware.com/live/flight/${encodeURIComponent(flight.callsign.trim())}` : null;
  return (
    <div className="space-entity-card" onClick={(e) => e.stopPropagation()}>
      <div className="space-entity-head">
        <div><strong>✈️ {flight.callsign || flight.icao24 || 'Aéronef'}</strong><div className="space-sub">Données ADS-B en direct • détail à la demande</div></div>
        <button className="space-close-btn" onClick={onClose} aria-label="Fermer">✕</button>
      </div>
      {loading && <div className="space-entity-loading">Recherche de la route, de l’aéronef et de sa trace réelle…</div>}
      {route && <div className="space-route-line"><b>{airportName(origin) || 'Départ inconnu'}</b><span>→</span><b>{airportName(destination) || 'Arrivée inconnue'}</b></div>}
      <div className="space-info-grid">
        {rows.map(([label, value]) => value !== null && value !== undefined && value !== '' && (
          <div className="space-info-cell" key={label}><span>{label}</span><strong>{value}</strong></div>
        ))}
      </div>
      {details?.warnings?.length > 0 && <div className="space-sub">Certains enrichissements ne sont pas disponibles ; la télémétrie ADS-B reste affichée.</div>}
      <div className="space-entity-actions">
        {externalUrl && <button className="space-mini-btn" onClick={() => hostBridge.openExternal(externalUrl)}>Ouvrir FlightAware ↗</button>}
        {flight.icao24 && <button className="space-mini-btn" onClick={() => hostBridge.openExternal(`https://adsb.lol/?icao=${encodeURIComponent(flight.icao24)}`)}>Voir ADS-B ↗</button>}
      </div>
    </div>
  );
}

function SatelliteInfoCard({ satellite, position, look, live, onClose }) {
  const periodMinutes = 1440 / satellite.meanMotionRevDay;
  const orbitalSpeed = live?.velocityKmh != null
    ? `${Math.round(live.velocityKmh).toLocaleString('fr-FR')} km/h`
    : `${((2 * Math.PI * (6371 + position.altKm)) / (periodMinutes * 60)).toFixed(2)} km/s (estimée)`;
  const mission = satellite.mission || (satellite.norad === 25544 ? 'Station spatiale habitée' : satellite.norad === 48274 ? 'Station spatiale Tiangong' : satellite.norad === 20580 ? 'Télescope spatial Hubble' : 'Satellite actif');
  const rows = [
    ['Mission / catégorie', mission],
    ['NORAD ID', satellite.norad],
    ['Identifiant', satellite.name],
    ['Latitude sub-satellite', `${position.lat.toFixed(4)}°`],
    ['Longitude sub-satellite', `${position.lon.toFixed(4)}°`],
    ['Altitude instantanée', `${Math.round(position.altKm).toLocaleString('fr-FR')} km`],
    ['Vitesse orbitale', orbitalSpeed],
    ['Inclinaison', `${satellite.incDeg.toFixed(2)}°`],
    ['RAAN / nœud ascendant', satellite.raanDeg == null ? null : `${satellite.raanDeg.toFixed(2)}°`],
    ['Argument périgée', satellite.argumentPerigeeDeg == null ? null : `${satellite.argumentPerigeeDeg.toFixed(2)}°`],
    ['Anomalie moyenne', satellite.meanAnomalyDeg == null ? null : `${satellite.meanAnomalyDeg.toFixed(2)}°`],
    ['Période orbitale', `${Math.floor(periodMinutes / 60)} h ${Math.round(periodMinutes % 60)} min`],
    ['Tours par jour', satellite.meanMotionRevDay.toFixed(2)],
    ['Apogée / périgée', satellite.apogeeAltKm == null ? null : `${Math.round(satellite.apogeeAltKm)} / ${Math.round(satellite.perigeeAltKm)} km`],
    ['Excentricité', satellite.eccentricity == null ? null : satellite.eccentricity.toFixed(5)],
    ['Époque TLE', satellite.epoch ? new Date(satellite.epoch).toLocaleString('fr-FR') : null],
    ['Classe d’orbite', position.altKm < 2000 ? 'LEO · orbite terrestre basse' : position.altKm < 35000 ? 'MEO · orbite moyenne' : 'GEO/HEO · orbite haute'],
    ['Modèle orbital', satellite.source || (satellite.tle ? 'TLE Kepler/J2 (approximation)' : 'Propagation simplifiée')],
    ['Élévation depuis l’observateur', `${look.elevationDeg.toFixed(1)}°`],
    ['Azimut depuis l’observateur', `${look.azimuthDeg.toFixed(1)}°`],
    ['Distance oblique', `${Math.round(look.rangeKm).toLocaleString('fr-FR')} km`],
    ['Visibilité orbitale', live?.visibility],
    ['Empreinte au sol', live?.footprintKm == null ? null : `${Math.round(live.footprintKm).toLocaleString('fr-FR')} km`],
    ['Sous-point solaire', live?.solarLatitude == null ? null : `${live.solarLatitude.toFixed(2)}°, ${live.solarLongitude.toFixed(2)}°`],
    ['Horodatage source', live?.timestamp ? new Date(live.timestamp * 1000).toLocaleString('fr-FR') : null],
    ['Source position', live?.source || 'Propagation orbitale locale · estimation'],
  ];
  return (
    <div className="space-entity-card" onClick={(e) => e.stopPropagation()}>
      <div className="space-entity-head">
        <div><strong>🛰️ {satellite.name}</strong><div className="space-sub">Éléments orbitaux & position observée</div></div>
        <button className="space-close-btn" onClick={onClose} aria-label="Fermer">✕</button>
      </div>
      <div className="space-info-grid">
        {rows.map(([label, value]) => value !== null && value !== undefined && value !== '' && (
          <div className="space-info-cell" key={label}><span>{label}</span><strong>{value}</strong></div>
        ))}
      </div>
      <div className="space-entity-actions">
        <button className="space-mini-btn" onClick={() => hostBridge.openExternal(`https://www.n2yo.com/satellite/?s=${satellite.norad}`)}>Suivre sur N2YO ↗</button>
        <button className="space-mini-btn" onClick={() => hostBridge.openExternal(`https://celestrak.org/NORAD/elements/gp.php?CATNR=${satellite.norad}&FORMAT=tle`)}>TLE CelesTrak ↗</button>
      </div>
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
    satellites = DEFAULT_SATELLITES,
    liveSatellites = {},
    flights = [],
    showFlights = true,
    selectedFlight = null,
    flightDetails = null,
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
  const hitTargets = [];

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

  // Draw the selected satellite's predicted ground track.
  if (selectedSat) {
    const trackSegs = getSatelliteTrack(selectedSat, nowMs, 92);
    ctx.strokeStyle = selectedSat.color || '#ffd54f';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([4, 4]);
    for (const seg of trackSegs) {
      ctx.beginPath();
      let prevX = null;
      seg.forEach(([lat, lon], idx) => {
        const [px, py] = project(lon, lat);
        if (idx === 0 || (prevX !== null && Math.abs(px - prevX) > mapSize * 0.4)) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
        prevX = px;
      });
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // Three default targets are individually selectable; ISS uses its live feed when available.
  for (const satellite of satellites) {
    const modeled = getSatelliteState(satellite, nowMs);
    const live = liveSatellites[satellite.norad];
    const pos = live ? { ...modeled, lat: live.latitude, lon: live.longitude, altKm: live.altitudeKm ?? modeled.altKm } : modeled;
    const [sx, sy] = project(pos.lon, pos.lat);
    const selected = selectedSat?.norad === satellite.norad;
    if (selected) {
      ctx.strokeStyle = `${satellite.color || '#ffd54f'}66`;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(sx, sy, 24 * Math.sqrt(zoom), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = satellite.color || '#ffd54f';
    ctx.beginPath(); ctx.arc(sx, sy, selected ? 6.5 : 5, 0, Math.PI * 2); ctx.fill();
    ctx.font = `${selected ? 'bold ' : ''}11px "JetBrains Mono", monospace`;
    ctx.fillStyle = selected ? '#fff' : (satellite.color || '#ffd54f');
    ctx.fillText(`${satellite.name.split(' ')[0]} · ${pos.altKm.toFixed(0)} km`, sx + 9, sy - 6);
    hitTargets.push({ type: 'satellite', satellite, position: pos, x: sx, y: sy });
  }

  // Enriched actual flown path and scheduled route, drawn only for the selected aircraft.
  if (selectedFlight && flightDetails) {
    const drawGeoLine = (points, color, dash = []) => {
      if (!points || points.length < 2) return;
      ctx.beginPath(); ctx.setLineDash(dash);
      let prevX = null;
      points.forEach((point) => {
        if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return;
        const [px, py] = project(point.lon, point.lat);
        if (prevX === null || Math.abs(px - prevX) > mapSize * 0.4) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        prevX = px;
      });
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
    };
    drawGeoLine(flightDetails.track || [], 'rgba(255,255,255,0.82)');
    const route = flightDetails.route;
    if (route?.origin?.lat != null && route?.destination?.lat != null) {
      drawGeoLine([route.origin, route.destination], 'rgba(255,193,7,0.58)', [5, 5]);
    }
  }

  // Live ADS-B aircraft in the current 250 NM map region.
  if (showFlights) {
    for (const flight of flights) {
      const [fx, fy] = project(flight.lon, flight.lat);
      if (fx < -18 || fx > w + 18 || fy < -18 || fy > h + 18) continue;
      const key = flight.icao24 || flight.callsign;
      const selected = selectedFlight && (selectedFlight.icao24 || selectedFlight.callsign) === key;
      const color = flight.category === 'military' ? '#ff5252' : flight.category === 'jet' ? '#e040fb' : flight.category === 'private' ? '#ffd54f' : '#00e5ff';
      ctx.save(); ctx.translate(fx, fy); ctx.rotate(((flight.heading ?? 0) * Math.PI) / 180);
      ctx.fillStyle = color; ctx.strokeStyle = selected ? '#fff' : 'rgba(255,255,255,0.65)'; ctx.lineWidth = selected ? 1.8 : 0.8;
      ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(5.5, 6); ctx.lineTo(0, 3.5); ctx.lineTo(-5.5, 6); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
      if (selected || zoom >= 2.7) {
        ctx.font = '10px "JetBrains Mono", monospace'; ctx.fillStyle = selected ? '#fff' : color;
        ctx.fillText(flight.callsign || flight.icao24 || 'Avion', fx + 8, fy - 8);
      }
      hitTargets.push({ type: 'flight', key, flight, x: fx, y: fy });
    }
  }
  return hitTargets;
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
    const st = getSatelliteState(selectedSat, nowMs);
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
