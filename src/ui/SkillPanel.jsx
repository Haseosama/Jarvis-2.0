import React, { useCallback, useEffect, useState } from 'react';
import { approvePatch, approveSkill, discardPatch, loadSkills, rejectSkill, rollbackSkill, runCrucible } from '../skills/skillForge.js';
import { proposeSkillPatch } from '../skills/autoHeal.js';

const STATUS_LABEL = { pending: 'En attente de revue', active: 'Active' };

export default function SkillPanel({ onClose }) {
  const [skills, setSkills] = useState({});
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    const data = await loadSkills();
    setSkills(data);
    setSelected((current) => (data[current] ? current : Object.keys(data)[0] || ''));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const skill = skills[selected];

  const act = async (label, fn, okMessage) => {
    setBusy(label);
    setMessage('');
    try {
      await fn();
      setMessage(okMessage);
    } catch (error) {
      setMessage(`⚠️ ${error.message || error}`);
    } finally {
      setBusy('');
      await refresh();
    }
  };

  const retest = () => act('test', async () => {
    const crucible = await runCrucible(skill);
    if (!crucible.ok) throw new Error(crucible.message);
  }, 'Tests du Crucible réussis.');

  return (
    <div className="circuit-panel skill-panel">
      <div className="space-header">
        <div>
          <strong>🧪 Compétences (Skill Forge)</strong>
          <div className="space-sub">Le code généré tourne dans un bac à sable isolé, sans réseau ni fichiers. Rien ne s’active sans votre approbation.</div>
        </div>
        {onClose && <button className="space-close-btn" onClick={onClose} title="Fermer">✕</button>}
      </div>
      <div className="circuit-body skill-body">
        <div className="circuit-side skill-list">
          {Object.keys(skills).length === 0 && <div className="circuit-empty">Aucune compétence. Demandez : « forge une compétence qui convertit des degrés Celsius en Fahrenheit ».</div>}
          {Object.values(skills).map((entry) => (
            <button key={entry.name} className={`skill-item ${entry.name === selected ? 'active' : ''}`} onClick={() => { setSelected(entry.name); setMessage(''); }}>
              <strong>{entry.title || entry.name}</strong>
              <span className={`skill-badge ${entry.status}`}>{STATUS_LABEL[entry.status] || entry.status}</span>
              {entry.pendingPatch && <span className="skill-badge pending">Correctif à revoir</span>}
            </button>
          ))}
        </div>
        <div className="circuit-schematic-wrap skill-detail">
          {!skill && <div className="circuit-empty">Sélectionnez une compétence.</div>}
          {skill && (
            <>
              <p className="circuit-description">{skill.description} <code>{skill.name}</code> · v{skill.version}</p>
              {skill.parameters?.length > 0 && <p className="circuit-description">Paramètres : {skill.parameters.map((param) => `${param.name} (${param.type}${param.required ? '' : ', optionnel'})`).join(', ')}</p>}
              <div className="skill-actions">
                {skill.status === 'pending' && <button className="space-pill active" disabled={Boolean(busy)} onClick={() => act('approve', () => approveSkill(skill.name), 'Compétence approuvée.')}>✅ Approuver</button>}
                <button className="space-pill" disabled={Boolean(busy)} onClick={retest}>🔁 Relancer les tests</button>
                {skill.status === 'active' && <button className="space-pill" disabled={Boolean(busy)} onClick={() => act('heal', () => proposeSkillPatch(skill.name, skill.tests?.ok === false ? skill.tests.message : 'Amélioration demandée manuellement'), 'Correctif proposé et testé : relisez-le ci-dessous.')}>🩹 Proposer un correctif</button>}
                {(skill.versions?.length || 0) > 1 && <button className="space-pill" disabled={Boolean(busy)} onClick={() => act('rollback', () => rollbackSkill(skill.name), 'Version précédente restaurée (à ré-approuver).')}>↩️ Version précédente</button>}
                <button className="space-pill" disabled={Boolean(busy)} onClick={() => { if (window.confirm(`Supprimer la compétence « ${skill.name} » ?`)) act('delete', () => rejectSkill(skill.name), 'Compétence supprimée.'); }}>🗑️ Supprimer</button>
              </div>
              {busy && <div className="space-sub">Opération en cours : {busy}…</div>}
              {message && <div className="space-sub skill-message">{message}</div>}
              <h4>Code</h4>
              <pre className="skill-code">{skill.code}</pre>
              <h4>Tests du Crucible — {skill.tests?.message || 'non exécutés'}</h4>
              <ul className="skill-tests">
                {(skill.tests?.results || []).map((result, index) => (
                  <li key={index} className={result.ok ? 'ok' : 'ko'}>{result.ok ? '✔' : '✖'} <code>{JSON.stringify(result.input)}</code> → {result.ok ? result.output : result.error}</li>
                ))}
              </ul>
              {skill.pendingPatch && (
                <div className="skill-patch">
                  <h4>Correctif proposé (v{skill.pendingPatch.version}) — {skill.pendingPatch.tests?.message}</h4>
                  <div className="space-sub">{skill.pendingPatch.note}</div>
                  <pre className="skill-code">{skill.pendingPatch.code}</pre>
                  <div className="skill-actions">
                    <button className="space-pill active" disabled={Boolean(busy)} onClick={() => act('patch', () => approvePatch(skill.name), 'Correctif appliqué (ancienne version conservée).')}>✅ Appliquer le correctif</button>
                    <button className="space-pill" disabled={Boolean(busy)} onClick={() => act('discard', () => discardPatch(skill.name), 'Correctif écarté.')}>Écarter</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
