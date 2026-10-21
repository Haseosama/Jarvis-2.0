import React, { useState } from 'react';
import { hostBridge } from '../core/hostBridge.js';

// Modules externes (dépôt cornelius-modules) : activer, choisir le dossier, saisir les jetons.
export default function ModulesPanel({ cfg, update }) {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    setBusy(true);
    const r = await hostBridge.modules({ op: 'list' });
    setInfo(r);
    setBusy(false);
  };

  const secrets = cfg.moduleSecrets || {};
  const setSecret = (name, value) => update({ moduleSecrets: { ...secrets, [name]: value.trim() } });

  return (
    <div className="settings-field">
      <h4>Modules externes (cornelius-modules)</h4>
      <p className="settings-hint">
        Vacances et jours fériés, agenda iCal, carburants, vélos en libre-service, actualité, poubelles… au contrat de <a href="https://github.com/lfpoulain/cornelius-modules" target="_blank" rel="noreferrer">cornelius-modules</a>.
        ⚠️ Un module est du code qui s’exécute avec vos droits sur ce PC (dans un processus Node.js séparé, 24.2 ou plus) : n’activez que des modules dont vous connaissez l’auteur. Clonez le dépôt vous-même, puis indiquez son dossier.
      </p>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={cfg.externalModulesEnabled === true} onChange={(e) => update({ externalModulesEnabled: e.target.checked })} />
        Autoriser les modules externes
      </label>
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <input type="text" style={{ flex: 1 }} placeholder="C:\Users\vous\cornelius-modules" value={cfg.externalModulesDir || ''} onChange={(e) => update({ externalModulesDir: e.target.value.trim() })} />
        <button type="button" disabled={busy || cfg.externalModulesEnabled !== true || !cfg.externalModulesDir} onClick={reload}>{busy ? '…' : 'Charger'}</button>
      </div>
      {info && !info.ok && <p className="settings-hint" style={{ color: '#ff8a80' }}>{info.error?.message}</p>}
      {info?.ok && (
        <div style={{ marginTop: 8 }}>
          {info.result.modules.map((m) => (
            <div key={m.id} style={{ padding: '4px 0', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <b>{m.display?.name || m.sourceLabel}</b> <span className="settings-hint">({m.id}) — {m.display?.description}</span>
              {m.secrets.map((s) => (
                <div key={s.name}>
                  <label>Jeton : {s.label}{s.note ? ` (${s.note})` : ''}{' '}
                    <input type="password" value={secrets[s.name] || ''} onChange={(e) => setSecret(s.name, e.target.value)} />
                  </label>
                </div>
              ))}
            </div>
          ))}
          {info.result.failed.length > 0 && (
            <div className="settings-hint">
              Non chargés :
              {info.result.failed.map((f) => <div key={f.dir}>• {f.dir} : {f.reason}</div>)}
            </div>
          )}
          <p className="settings-hint">Ajoutez ensuite les sources à la voix : « ajoute le module vacances en zone C ».</p>
        </div>
      )}
    </div>
  );
}
