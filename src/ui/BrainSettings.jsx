import React, { useState } from 'react';
import { llmStore } from '../llm/llmStore.js';
import { PROVIDERS } from '../llm/providers.js';
import { BRAIN_PROVIDER_IDS, runBrain } from '../llm/brain.js';
import { ModelPicker, useLlmState } from './ProviderSettings.jsx';

const PROBE_TOOL = [{ name: 'get_test_value', description: 'Renvoie le code de test. À appeler pour obtenir le code.', parameters: { type: 'OBJECT', properties: {} } }];

/** Réglage du « cerveau » : un modèle externe répond aux messages tapés, avec les outils de Jarvis. */
export default function BrainSettings() {
  const state = useLlmState();
  const brain = state.brain;
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const configured = llmStore.isConfigured(brain.provider);
  const ready = brain.model && configured;

  const patch = (next) => llmStore.update({ brain: { ...brain, ...next } });

  const test = async () => {
    setBusy(true);
    setResult('');
    try {
      const res = await runBrain({
        slot: llmStore.resolve(brain),
        system: 'Tu es un assistant de test.',
        userText: 'Appelle l’outil get_test_value puis écris exactement le code qu’il renvoie.',
        declarations: PROBE_TOOL,
        execute: async () => 'JARVIS-4242',
      });
      if (!res.ok) setResult(`❌ ${res.error}`);
      else if (res.toolsUsed.length && res.text.includes('4242')) setResult('✅ Le modèle répond et appelle bien les outils.');
      else if (res.toolsUsed.length) setResult(`⚠️ Outil appelé, mais réponse inattendue : ${res.text.slice(0, 120)}`);
      else setResult(`⚠️ Le modèle répond mais n’a pas appelé l’outil (modèle sans outils ?) : ${res.text.slice(0, 120)}`);
    } catch (e) {
      setResult(`❌ ${e.message || e}`);
    }
    setBusy(false);
  };

  return (
    <div className="llm-brain">
      <label className="llm-row">
        <input type="checkbox" checked={brain.enabled} disabled={!ready && !brain.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
        <strong>Utiliser ce modèle pour les messages tapés</strong>
      </label>
      <div className="llm-row">
        <ModelPicker value={{ provider: brain.provider, model: brain.model }} exclude={['gemini']} onChange={(slot) => patch({ provider: slot.provider, model: slot.model })} />
        <button className="space-pill" disabled={busy || !ready} onClick={test}>{busy ? '⏳ Test…' : '🧪 Tester (texte + outils)'}</button>
      </div>
      {!configured && <div className="space-sub llm-error">Configurez d’abord {PROVIDERS[brain.provider]?.label} dans l’onglet 🔑 Fournisseurs (clé API ou adresse locale).</div>}
      {result && <div className="space-sub skill-message">{result}</div>}
      <ul className="space-sub llm-brain-notes">
        <li>Texte uniquement : le modèle choisi répond à la saisie clavier et peut utiliser les mêmes outils que Gemini (PC, agenda, cartes, Spotify…).</li>
        <li>La voix en direct (micro) reste sur Gemini Live ; il faut donc garder une clé Gemini pour parler.</li>
        <li>Si le modèle est injoignable, Jarvis le signale et reprend avec Gemini.</li>
        <li>Fournisseurs possibles : {BRAIN_PROVIDER_IDS.map((id) => PROVIDERS[id].label).join(', ')}. Les modèles locaux doivent gérer les appels d’outils ; sinon ils répondent sans outils.</li>
        <li>Les images jointes restent traitées par Gemini.</li>
      </ul>
    </div>
  );
}
