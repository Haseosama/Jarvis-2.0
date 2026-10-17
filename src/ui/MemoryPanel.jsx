import React, { useEffect, useMemo, useState } from 'react';
import { dataStore } from '../core/DataStore.js';
import { searchMemories } from '../core/memorySearch.js';

// Tout ce que Jarvis a retenu sur l'utilisateur, avec la date d'apprentissage, et la suppression en un clic.
export default function MemoryPanel() {
  const [memories, setMemories] = useState(dataStore.get().memories || []);
  const [query, setQuery] = useState('');

  useEffect(() => dataStore.subscribe((d) => setMemories(d.memories || [])), []);

  const shown = useMemo(() => (query.trim() ? searchMemories(memories, query, 100) : [...memories].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))), [memories, query]);

  return (
    <div className="settings-field">
      <h4>Mémoire de Jarvis ({memories.length})</h4>
      <input type="text" placeholder="Rechercher un souvenir…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div style={{ maxHeight: 180, overflowY: 'auto', marginTop: 6 }}>
        {shown.length === 0 && <p className="settings-hint">Aucun souvenir.</p>}
        {shown.map((m) => (
          <div key={m.key} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12.5, padding: '3px 0' }}>
            <span style={{ flex: 1 }}>
              <b>{m.key}</b> : {m.value}
              {m.updatedAt ? <span className="settings-hint"> — {new Date(m.updatedAt).toLocaleDateString('fr-FR')}</span> : null}
            </span>
            <button type="button" aria-label={`Oublier ${m.key}`} onClick={() => dataStore.forgetFact(m.key)}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}
