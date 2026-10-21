import React, { useCallback, useEffect, useState } from 'react';
import { hostBridge } from '../core/hostBridge.js';

// Satellites audio (ESP32-S3) : activer, associer, régler, retirer. Protocole version 1 de Cornelius.
export default function SatellitePanel({ cfg }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [names, setNames] = useState({});
  const [created, setCreated] = useState(null); // { name, token } : montré une seule fois

  const refresh = useCallback(async () => {
    const r = await hostBridge.satellites('status');
    if (r.ok) { setInfo(r); setError(''); } else setError(r.error || '');
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [refresh]);

  const call = async (action, payload) => {
    const r = await hostBridge.satellites(action, payload);
    if (!r.ok) setError(r.error || 'Échec.');
    await refresh();
    return r;
  };

  if (!info) return <div className="settings-field"><h4>Satellites audio</h4><p className="settings-hint">{error || 'Chargement…'}</p></div>;
  const localStt = cfg.sttEngine === 'local';

  return (
    <div className="settings-field">
      <h4>Satellites audio (ESP32-S3)</h4>
      <p className="settings-hint">
        Un micro et un haut-parleur dans une autre pièce : « Hey {cfg.wakeWord || 'jarvis'} » ouvre une conversation en voix seule, avec les outils d’information uniquement (météo, heure, minuteurs, recherche, transports…), jamais le contrôle du PC.
        Le firmware est celui du projet Cornelius (protocole version 1) : il doit être configuré avec l’adresse ci-dessous et l’empreinte de la clé.
        Windows demandera d’autoriser Jarvis sur les réseaux privés (port {info.port}).
      </p>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={info.running} onChange={(e) => call('enable', { enabled: e.target.checked })} />
        Activer le serveur des satellites
      </label>
      {!localStt && <p className="settings-hint">⚠️ Le mot d’éveil n’est écouté que par une reconnaissance locale (vie privée : jamais de transcription dans le cloud d’une pièce qui n’a pas appelé Jarvis). Réglez « Reconnaissance : Whisper local » plus haut, sinon les satellites restent muets en veille.</p>}
      {info.running && (
        <>
          <p className="settings-hint">Adresse : <code>wss://{info.address || '(adresse du PC):' + info.port}/satellite</code></p>
          <p className="settings-hint" style={{ wordBreak: 'break-all' }}>Empreinte de la clé (SHA-256) : <code>{info.fingerprint}</code></p>
        </>
      )}
      {error && <p className="settings-hint" style={{ color: '#ff8a80' }}>{error}</p>}

      {info.pending.length > 0 && (
        <div>
          <b>Nouveaux satellites</b>
          {info.pending.map((p) => (
            <div key={p.device} style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '4px 0' }}>
              <code>{p.device}</code>
              <button type="button" onClick={() => call('identify', { device: p.device })}>Faire clignoter</button>
              <input type="text" placeholder="Pièce (ex : Chambre)" value={names[p.device] || ''} onChange={(e) => setNames({ ...names, [p.device]: e.target.value })} />
              <button type="button" disabled={!(names[p.device] || '').trim()} onClick={() => call('pair', { device: p.device, name: names[p.device] })}>Associer</button>
            </div>
          ))}
        </div>
      )}

      {info.satellites.map((s) => (
        <div key={s.id} style={{ borderTop: '1px solid rgba(255,255,255,0.1)', padding: '6px 0' }}>
          <b>{s.name}</b> {s.online ? '🟢 en ligne' : '⚪ hors ligne'}{s.inConversation ? ' · 🗣️ en conversation' : ''}{s.firmware ? ` · firmware ${s.firmware}` : ''}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
            <label>Volume <input type="range" min="0" max="100" value={s.volume} onChange={(e) => call('update', { id: s.id, patch: { volume: Number(e.target.value) } })} /></label>
            <label>Anneau <input type="color" value={s.led.color} onChange={(e) => call('update', { id: s.id, patch: { led: { color: e.target.value } } })} /></label>
            <label>Luminosité <input type="range" min="0" max="10" value={s.led.brightness} onChange={(e) => call('update', { id: s.id, patch: { led: { brightness: Number(e.target.value) } } })} /></label>
            <label><input type="checkbox" checked={s.led.nightLight} onChange={(e) => call('update', { id: s.id, patch: { led: { nightLight: e.target.checked } } })} /> Veilleuse</label>
            <label title={s.aec ? '' : 'Ce satellite n’annonce pas d’annulation d’écho'}><input type="checkbox" disabled={!s.aec} checked={s.attentive} onChange={(e) => call('update', { id: s.id, patch: { attentive: e.target.checked } })} /> Écoute attentive</label>
            <button type="button" onClick={() => call('remove', { id: s.id })}>Retirer</button>
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}>
        <label>Fin de parole (s) <input type="number" min="5" max="120" value={Math.round((info.settings.endSilenceMs || 20000) / 1000)} onChange={(e) => call('settings', { endSilenceMs: Number(e.target.value) * 1000 })} style={{ width: 70 }} /></label>
        <button type="button" onClick={async () => { const name = window.prompt('Nom du nouveau satellite (association manuelle, sans réseau de configuration) :'); if (name) { const r = await call('create', { name }); if (r.ok) setCreated({ name, token: r.token }); } }}>Créer un jeton</button>
      </div>
      {created && (
        <p className="settings-hint" style={{ wordBreak: 'break-all' }}>
          Jeton de « {created.name} » (montré une seule fois, à saisir dans le firmware) : <code>{created.token}</code>
          <button type="button" onClick={() => setCreated(null)}>J’ai noté</button>
        </p>
      )}
    </div>
  );
}
