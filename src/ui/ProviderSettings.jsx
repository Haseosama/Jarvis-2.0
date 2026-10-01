import React, { useEffect, useState } from 'react';
import { llmStore } from '../llm/llmStore.js';
import { PROVIDERS, PROVIDER_IDS, listModels, validateBaseUrl } from '../llm/providers.js';

export function useLlmState() {
  const [state, setState] = useState(llmStore.get());
  useEffect(() => llmStore.subscribe((next) => setState({ ...next })), []);
  return state;
}

/** Sélecteur fournisseur + modèle (saisie libre avec suggestions). */
export function ModelPicker({ value, onChange, disabled }) {
  useLlmState();
  const listId = `llm-models-${value.provider}`;
  const configured = llmStore.isConfigured(value.provider);
  return (
    <div className="llm-picker">
      <select value={value.provider} disabled={disabled} onChange={(e) => onChange({ provider: e.target.value, model: llmStore.modelsOf(e.target.value)[0] || '' })}>
        {PROVIDER_IDS.map((id) => <option key={id} value={id}>{PROVIDERS[id].label}{llmStore.isConfigured(id) ? '' : ' (non configuré)'}</option>)}
      </select>
      <input list={listId} value={value.model} disabled={disabled} placeholder="identifiant du modèle" onChange={(e) => onChange({ ...value, model: e.target.value })} />
      <datalist id={listId}>{llmStore.modelsOf(value.provider).map((m) => <option key={m} value={m} />)}</datalist>
      {!configured && <span className="llm-warn" title="Configurez ce fournisseur dans l’onglet Fournisseurs">⚠️</span>}
    </div>
  );
}

function ProviderCard({ id }) {
  const def = PROVIDERS[id];
  const state = useLlmState();
  const [keyDraft, setKeyDraft] = useState('');
  const [urlDraft, setUrlDraft] = useState(state.providers[id]?.baseUrl || def.baseUrl);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const saveKey = async () => {
    await llmStore.setKey(id, keyDraft);
    setKeyDraft('');
    setMsg(keyDraft.trim() ? 'Clé enregistrée (chiffrée).' : 'Clé supprimée.');
  };
  const saveUrl = () => {
    try {
      const clean = validateBaseUrl(urlDraft);
      llmStore.setProvider(id, { baseUrl: clean });
      setUrlDraft(clean);
      setMsg('URL enregistrée.');
    } catch (error) { setMsg(`⚠️ ${error.message}`); }
  };
  const fetchModels = async () => {
    setBusy(true);
    setMsg('');
    try {
      const models = await listModels(llmStore.resolve({ provider: id, model: 'x' }));
      llmStore.setProvider(id, { models });
      setMsg(`${models.length} modèle(s) trouvé(s).`);
    } catch (error) { setMsg(`⚠️ ${error.message || error}`); }
    setBusy(false);
  };

  return (
    <div className="llm-card">
      <div className="llm-card-head">
        <strong>{def.label}</strong>
        <span className={`skill-badge ${llmStore.isConfigured(id) ? 'active' : 'pending'}`}>{llmStore.isConfigured(id) ? 'Prêt' : 'À configurer'}</span>
      </div>
      {def.usesJarvisKey && <div className="space-sub">Utilise les clés Gemini des Réglages de Jarvis.</div>}
      {!def.usesJarvisKey && !def.keyless && (
        <div className="llm-row">
          <input type="password" autoComplete="off" value={keyDraft} placeholder={llmStore.hasKey(id) ? '•••••••• (clé enregistrée)' : 'Clé API'} onChange={(e) => setKeyDraft(e.target.value)} />
          <button className="space-pill" onClick={saveKey} disabled={!keyDraft.trim()}>Enregistrer</button>
          {llmStore.hasKey(id) && <button className="space-pill" onClick={async () => { await llmStore.setKey(id, ''); setMsg('Clé supprimée.'); }}>Supprimer</button>}
        </div>
      )}
      {def.keyless && <div className="llm-row"><input type="password" autoComplete="off" value={keyDraft} placeholder={llmStore.hasKey(id) ? '•••••••• (clé optionnelle enregistrée)' : 'Clé (optionnelle)'} onChange={(e) => setKeyDraft(e.target.value)} /><button className="space-pill" onClick={saveKey} disabled={!keyDraft.trim()}>Enregistrer</button></div>}
      {def.editableUrl && (
        <div className="llm-row">
          <input value={urlDraft} placeholder="https://…/v1" onChange={(e) => setUrlDraft(e.target.value)} />
          <button className="space-pill" onClick={saveUrl}>Enregistrer l’URL</button>
        </div>
      )}
      <div className="llm-row">
        <button className="space-pill" disabled={busy || !llmStore.isConfigured(id)} onClick={fetchModels}>{busy ? 'Recherche…' : '🔄 Lister les modèles'}</button>
        <span className="space-sub">{(state.providers[id]?.models || []).length || '—'} modèle(s) connus</span>
      </div>
      {msg && <div className="space-sub skill-message">{msg}</div>}
    </div>
  );
}

export default function ProviderSettings() {
  return (
    <div className="llm-providers">
      <p className="circuit-description">
        Jarvis parle aux modèles par leurs <strong>API officielles</strong> avec <strong>votre</strong> clé. Les clés sont chiffrées sur votre PC (application de bureau) et
        ne sont envoyées qu’au fournisseur correspondant. Vos invites et fichiers joints partent chez le fournisseur choisi, ce qui peut être facturé par lui.
        arena.ai n’a pas d’API publique et interdit l’accès automatisé : il reste en usage manuel (bouton « Ouvrir arena.ai »).
      </p>
      <div className="llm-grid">{PROVIDER_IDS.map((id) => <ProviderCard key={id} id={id} />)}</div>
    </div>
  );
}
