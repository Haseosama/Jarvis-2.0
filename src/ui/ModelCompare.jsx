import React, { useEffect, useMemo, useState } from 'react';
import { llmStore, slotKey, MAX_SLOTS } from '../llm/llmStore.js';
import { applyVote, leaderboard, runComparison } from '../llm/compare.js';
import { ModelPicker, useLlmState } from './ProviderSettings.jsx';

const LETTERS = 'ABCD';

export default function ModelCompare({ seed }) {
  const state = useLlmState();
  const [prompt, setPrompt] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [blind, setBlind] = useState(false);
  const [voted, setVoted] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { if (seed) setPrompt(seed); }, [seed]);

  const slots = state.compareSlots;
  const setSlot = (i, slot) => llmStore.update({ compareSlots: slots.map((s, j) => (j === i ? slot : s)) });
  const board = useMemo(() => leaderboard(state.ratings), [state.ratings]);
  const revealed = !blind || Boolean(voted);

  const run = async () => {
    setBusy(true);
    setError('');
    setVoted('');
    setResults([]);
    try {
      const out = await runComparison({ prompt, slots, resolve: (slot) => llmStore.resolve(slot) });
      const order = blind ? [...out].sort(() => Math.random() - 0.5) : out;
      setResults(order);
    } catch (e) { setError(e.message || String(e)); }
    setBusy(false);
  };

  const vote = (winnerKey) => {
    const ok = results.filter((r) => r.ok).map((r) => slotKey(r.slot));
    if (ok.length < 2 || voted) return;
    llmStore.update({ ratings: applyVote(state.ratings, winnerKey, ok) });
    setVoted(winnerKey);
  };

  return (
    <div className="llm-compare">
      <div className="llm-slots">
        {slots.map((slot, i) => (
          <div key={i} className="llm-slot">
            <span className="llm-letter">{LETTERS[i]}</span>
            <ModelPicker value={slot} onChange={(s) => setSlot(i, s)} disabled={busy} />
            {slots.length > 2 && <button className="space-pill" disabled={busy} onClick={() => llmStore.update({ compareSlots: slots.filter((_, j) => j !== i) })}>✕</button>}
          </div>
        ))}
        {slots.length < MAX_SLOTS && <button className="space-pill" disabled={busy} onClick={() => llmStore.update({ compareSlots: [...slots, { ...slots[slots.length - 1] }] })}>＋ Ajouter un modèle</button>}
      </div>
      <div className="llm-composer">
        <textarea value={prompt} rows={3} placeholder="Une invite, envoyée telle quelle à tous les modèles…" onChange={(e) => setPrompt(e.target.value)} />
        <div className="llm-composer-side">
          <label className="space-sub"><input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} disabled={busy} /> Mode à l’aveugle</label>
          <button className="space-pill active" onClick={run} disabled={busy || !prompt.trim()}>{busy ? '⏳ Comparaison…' : '⚔️ Comparer'}</button>
        </div>
      </div>
      <div className="space-sub">Chaque comparaison envoie votre invite à {slots.length} fournisseurs (facturation possible chez eux).</div>
      {error && <div className="space-sub skill-message">⚠️ {error}</div>}
      <div className="llm-results" style={{ gridTemplateColumns: `repeat(${Math.max(results.length, 1)}, minmax(0, 1fr))` }}>
        {results.map((r, i) => (
          <div key={i} className={`llm-result ${voted === slotKey(r.slot) ? 'winner' : ''}`}>
            <div className="llm-msg-head">
              <strong>{revealed ? `${r.slot.model}` : `Modèle ${LETTERS[i]}`}</strong>
              {revealed && <span className="space-sub"> · {r.slot.provider}</span>}
              <span className="space-sub"> · {(r.ms / 1000).toFixed(1)} s{r.usage?.output ? ` · ${r.usage.output} tok` : ''}</span>
            </div>
            {r.ok ? <div className="llm-text">{r.text}</div> : <div className="llm-text llm-error">⚠️ {r.error}</div>}
            {r.ok && results.filter((x) => x.ok).length >= 2 && (
              <button className="space-pill" disabled={Boolean(voted)} onClick={() => vote(slotKey(r.slot))}>{voted === slotKey(r.slot) ? '🏆 Votre choix' : '👍 Meilleure réponse'}</button>
            )}
          </div>
        ))}
      </div>
      <div className="llm-board">
        <h4>🏆 Classement local (Elo, stocké sur ce PC uniquement)
          {board.length > 0 && <button className="space-pill" onClick={() => { if (window.confirm('Effacer le classement ?')) llmStore.update({ ratings: {} }); }}>Réinitialiser</button>}
        </h4>
        {board.length === 0 && <div className="space-sub">Aucun vote pour l’instant.</div>}
        {board.length > 0 && (
          <table>
            <thead><tr><th>#</th><th>Modèle</th><th>Elo</th><th>Victoires</th><th>Duels</th></tr></thead>
            <tbody>{board.map((row, i) => <tr key={row.key}><td>{i + 1}</td><td>{row.key.replace('|', ' · ')}</td><td>{row.elo}</td><td>{row.wins}</td><td>{row.games}</td></tr>)}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
