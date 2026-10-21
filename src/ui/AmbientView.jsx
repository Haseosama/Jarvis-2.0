import React, { useCallback, useEffect, useRef, useState } from 'react';
import { configStore } from '../core/ConfigStore.js';
import { dataStore } from '../core/DataStore.js';
import { hostBridge } from '../core/hostBridge.js';
import { TRANSIT_REFRESH_MS, WEATHER_REFRESH_MS, clockCard, transitCard, weatherCard, weatherSnapshot } from '../core/ambient.js';
import { PRIM_BASE, mapDepartures } from '../integrations/transit.js';

// Affichage permanent : heure, météo et prochains passages. Le réseau ne renouvelle que les relevés ; l'affichage se recalcule seul.
export default function AmbientView({ onClose }) {
  const [now, setNow] = useState(Date.now());
  const [snaps, setSnaps] = useState(() => dataStore.get().ambient || { weather: null, transit: {} });
  const [moduleCards, setModuleCards] = useState([]);
  const snapsRef = useRef(snaps);
  snapsRef.current = snaps;
  const cfg = configStore.get();
  const tz = cfg.ambientTimezone || 'Europe/Paris';
  const stops = (dataStore.get().transitStops || []).slice(0, 3);

  const save = useCallback((next) => { setSnaps(next); dataStore.update({ ambient: next }); }, []);

  // Recalcul local chaque seconde (sans réseau).
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);

  const refreshWeather = useCallback(async () => {
    const c = configStore.get();
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${c.userLat || 44.8378}&longitude=${c.userLon || -0.5792}&current=temperature_2m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto`;
    const res = await hostBridge.httpFetch(url, { timeoutMs: 10000 });
    const snap = res.ok ? weatherSnapshot(res.json) : null;
    const cur = snapsRef.current;
    save({ ...cur, weather: snap || { ...(cur.weather || {}), failedAt: Date.now() } });
  }, [save]);

  const refreshTransit = useCallback(async () => {
    const c = configStore.get();
    if (!c.primKey) return;
    let next = { ...snapsRef.current, transit: { ...(snapsRef.current.transit || {}) } };
    for (const stop of (dataStore.get().transitStops || []).slice(0, 3)) {
      const res = await hostBridge.httpFetch({ url: `${PRIM_BASE}/stop_areas/${encodeURIComponent(stop.stopAreaId).replace(/%3A/gi, ':')}/departures?data_freshness=realtime&count=16&disable_geojson=true`, headers: { apikey: c.primKey }, timeoutMs: 8000, maxBytes: 4 * 1024 * 1024, maxRedirects: 0 });
      const prev = next.transit[stop.name];
      next.transit[stop.name] = res.ok && res.json ? { at: Date.now(), departures: mapDepartures(res.json) } : { ...(prev || {}), failedAt: Date.now() };
    }
    save(next);
  }, [save]);

  // Modules externes affichés en permanence : relevé renouvelé à l'expiration (réseau), présentation recalculée toutes les 30 s (sans réseau).
  useEffect(() => {
    let stopped = false;
    const refreshModules = async (collect) => {
      const sources = (dataStore.get().moduleSources || []).filter((s) => s.ambient);
      const cards = [];
      for (const s of sources) {
        const c = configStore.get();
        let entry = (dataStore.get().moduleSnapshots || {})[s.ref];
        const instance = { name: s.name, ref: s.ref };
        const tz = c.ambientTimezone || 'Europe/Paris';
        if (collect && (!entry || Date.now() - entry.at >= entry.freshMs)) {
          const r = await hostBridge.modules({ op: 'read', id: s.moduleId, config: s.config, secrets: c.moduleSecrets || {}, instance, timeZone: tz, now: Date.now() });
          if (r.ok) {
            entry = { snapshot: r.result.snapshot, at: Date.now(), freshMs: r.result.freshMs };
            dataStore.update({ moduleSnapshots: { ...(dataStore.get().moduleSnapshots || {}), [s.ref]: entry } });
          }
        }
        if (!entry) { cards.push({ id: `m:${s.ref}`, title: s.name, primary: '—', subtitle: 'Pas encore de relevé', items: [], status: 'pending' }); continue; }
        const stale = Date.now() - entry.at >= entry.freshMs;
        const p = await hostBridge.modules({ op: 'present', id: s.moduleId, snapshot: stale ? { ...entry.snapshot, status: 'stale' } : entry.snapshot, instance, timeZone: tz, now: Date.now() });
        const a = p.ok ? p.result.ambient : null;
        cards.push(a ? { id: `m:${s.ref}`, title: s.name, primary: a.value || '—', subtitle: `${a.subtitle || ''}${stale ? ' · dernier relevé connu' : ''}`, items: a.items || [], status: stale ? 'stale' : 'ok' } : { id: `m:${s.ref}`, title: s.name, primary: '—', subtitle: 'Source indisponible', items: [], status: 'stale' });
      }
      if (!stopped) setModuleCards(cards);
    };
    refreshModules(true).catch(() => {});
    const a = setInterval(() => refreshModules(false).catch(() => {}), 30_000);
    const b = setInterval(() => refreshModules(true).catch(() => {}), 60_000);
    return () => { stopped = true; clearInterval(a); clearInterval(b); };
  }, []);

  useEffect(() => {
    const first = setTimeout(() => { refreshWeather().catch(() => {}); refreshTransit().catch(() => {}); }, 300);
    const w = setInterval(() => refreshWeather().catch(() => {}), WEATHER_REFRESH_MS);
    const t = setInterval(() => refreshTransit().catch(() => {}), TRANSIT_REFRESH_MS);
    return () => { clearTimeout(first); clearInterval(w); clearInterval(t); };
  }, [refreshWeather, refreshTransit]);

  const cards = [clockCard(now, tz), weatherCard(snaps.weather, now, tz), ...stops.map((s) => transitCard((snaps.transit || {})[s.name], now, s.name)), ...moduleCards];

  return (
    <div className="ambient-view">
      <div className="ambient-bar">
        <span>🪞 Affichage permanent</span>
        <span>
          <button type="button" onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}>Plein écran</button>
          <button type="button" onClick={onClose}>Fermer</button>
        </span>
      </div>
      <div className="ambient-grid">
        {cards.map((c) => (
          <div key={`${c.id}:${c.title}`} className={`ambient-card ambient-${c.status}`}>
            <div className="ambient-title">{c.title}</div>
            <div className="ambient-primary">{c.primary}</div>
            <div className="ambient-sub">{c.subtitle}</div>
            {c.items.map((i) => <div key={i.label} className="ambient-item"><span>{i.label}</span><span>{i.value}</span></div>)}
          </div>
        ))}
      </div>
      {!cfg.primKey && <p className="settings-hint" style={{ textAlign: 'center' }}>Ajoutez un jeton PRIM et des arrêts (« enregistre l’arrêt … comme maison ») pour voir les prochains passages ici.</p>}
    </div>
  );
}
