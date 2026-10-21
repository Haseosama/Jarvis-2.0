import React, { useEffect, useState } from 'react';
import { dataStore } from '../core/DataStore.js';
import { MAX_PROFILES, cleanProfileName } from '../core/profiles.js';

// Profils du foyer : chaque personne a ses propres souvenirs, le foyer a les souvenirs communs.
export default function ProfilesPanel() {
  const [data, setData] = useState(dataStore.get());
  const [name, setName] = useState('');
  useEffect(() => dataStore.subscribe((d) => setData({ ...d })), []);
  const profiles = data.profiles || [];

  const add = () => {
    const clean = cleanProfileName(name);
    if (!clean) return;
    const id = dataStore.addProfile(clean);
    if (!data.activeProfileId) dataStore.setActiveProfile(id);
    setName('');
  };

  return (
    <div className="settings-field">
      <h4>Profils du foyer</h4>
      <p className="settings-hint">
        Chaque personne a ses souvenirs ; le foyer a les souvenirs communs. Ce n’est pas une sécurité : dire « c’est Sacha » suffit pour changer de personne.
        Avec plusieurs personnes devant la caméra (mode vie privée) ou depuis un satellite audio, seuls les souvenirs du foyer servent.
      </p>
      <label>Personne actuelle{' '}
        <select value={data.activeProfileId || ''} onChange={(e) => dataStore.setActiveProfile(e.target.value || null)}>
          <option value="">Foyer / personne non identifiée</option>
          {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      {profiles.map((p) => (
        <div key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '3px 0' }}>
          <span style={{ flex: 1 }}>{p.name} <span className="settings-hint">({(data.memories || []).filter((m) => m.profileId === p.id).length} souvenirs)</span></span>
          <button type="button" onClick={() => { if (window.confirm(`Supprimer ${p.name} et ses souvenirs personnels ? Ceux du foyer restent.`)) dataStore.removeProfile(p.id); }}>Supprimer</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <input type="text" placeholder="Prénom" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button type="button" disabled={!cleanProfileName(name) || profiles.length >= MAX_PROFILES} onClick={add}>Ajouter</button>
      </div>
    </div>
  );
}
