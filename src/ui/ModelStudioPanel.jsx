import React, { useEffect, useState } from 'react';
import CodeStudio from './CodeStudio.jsx';
import ModelCompare from './ModelCompare.jsx';
import ProviderSettings from './ProviderSettings.jsx';
import BrainSettings from './BrainSettings.jsx';
import ImageStudio from './ImageStudio.jsx';

const TABS = [
  { id: 'code', label: '💻 Studio de code' },
  { id: 'compare', label: '⚔️ Comparateur' },
  { id: 'images', label: '🎨 Images' },
  { id: 'brain', label: '🧠 Cerveau' },
  { id: 'providers', label: '🔑 Fournisseurs' },
];

export default function ModelStudioPanel({ tab = 'code', seed = '', onClose }) {
  const [active, setActive] = useState(tab);
  useEffect(() => { setActive(tab); }, [tab, seed]);
  return (
    <div className="circuit-panel llm-panel">
      <div className="space-header">
        <div>
          <strong>🤖 Studio IA</strong>
          <div className="space-sub">Modèles par API officielle (votre clé). arena.ai : ouverture manuelle uniquement, jamais automatisé.</div>
        </div>
        {onClose && <button className="space-close-btn" onClick={onClose} title="Fermer">✕</button>}
      </div>
      <div className="llm-tabs">
        {TABS.map((t) => <button key={t.id} className={`space-pill ${active === t.id ? 'active' : ''}`} onClick={() => setActive(t.id)}>{t.label}</button>)}
      </div>
      <div className="llm-body">
        {active === 'code' && <CodeStudio seed={seed} />}
        {active === 'compare' && <ModelCompare seed={seed} />}
        {active === 'images' && <ImageStudio />}
        {active === 'brain' && <BrainSettings />}
        {active === 'providers' && <ProviderSettings />}
      </div>
    </div>
  );
}
