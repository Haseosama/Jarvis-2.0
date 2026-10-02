import React, { useState, useEffect } from 'react';
import { dataStore } from '../core/DataStore.js';
import { createAndSaveDocument } from '../actions/documentGenerator.js';

const DelBtn = ({ onClick, title = 'Supprimer' }) => (
  <button type="button" className="prod-del-btn" title={title} aria-label={title} onClick={onClick}>🗑</button>
);
const ClearBtn = ({ onClick, children }) => (
  <button type="button" className="prod-clear-btn" onClick={onClick}>{children}</button>
);

export default function ProductivityPanel({ onClose, onNotify, initialTab = 'tasks' }) {
  const [data, setData] = useState(dataStore.get());
  const [subTab, setSubTab] = useState(initialTab); // 'tasks' | 'finance' | 'habits' | 'docs' | 'life'
  const [activeList, setActiveList] = useState('courses');
  const [newItemText, setNewItemText] = useState('');
  const [newExpAmount, setNewExpAmount] = useState('');
  const [newExpLabel, setNewExpLabel] = useState('');
  const [newExpCat, setNewExpCat] = useState('courses');
  const [docTitle, setDocTitle] = useState('Compte-rendu Jarvis 2.0');
  const [docType, setDocType] = useState('pdf');
  const [docContent, setDocContent] = useState(
    '# Synthèse du projet\n\n- Application PC autonome (.exe sans serveur)\n- Avatar 3D temps réel avec synchronisation labiale\n- 82 plugins JSON et contrôle complet du bureau Windows'
  );
  const [docStatus, setDocStatus] = useState('');
  const [now, setNow] = useState(Date.now());
  const [undo, setUndo] = useState(null); // { label, previous } : dernière suppression annulable

  useEffect(() => {
    const unsub = dataStore.subscribe(setData);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      unsub();
      clearInterval(timer);
    };
  }, []);

  const taskItems = data.taskLists?.[activeList] || [];

  // Suppression avec annulation : on garde l'ancienne valeur des clés modifiées.
  const applyDeletion = (label, patch) => {
    const previous = {};
    for (const key of Object.keys(patch)) previous[key] = dataStore.get()[key];
    dataStore.update(patch);
    setUndo({ label, previous });
  };
  const removeById = (key, id, label) =>
    applyDeletion(label, { [key]: (dataStore.get()[key] || []).filter((x) => x.id !== id) });
  const clearAll = (key, what, patch = null) => {
    const count = patch ? 1 : (dataStore.get()[key] || []).length;
    if (!count) return;
    if (!window.confirm(`Supprimer tout : ${what} ? (vous pourrez annuler juste après)`)) return;
    applyDeletion(`${what} supprimé(e)s`, patch || { [key]: [] });
  };
  const undoDelete = () => {
    if (!undo) return;
    dataStore.update(undo.previous);
    setUndo(null);
  };

  const handleAddTask = (e) => {
    e.preventDefault();
    if (!newItemText.trim()) return;
    const lists = { ...(data.taskLists || {}) };
    const arr = [...(lists[activeList] || [])];
    arr.push({ id: `t_${Date.now()}`, text: newItemText.trim(), done: false, createdAt: Date.now() });
    lists[activeList] = arr;
    dataStore.update({ taskLists: lists });
    setNewItemText('');
  };

  const toggleTask = (id) => {
    const lists = { ...(data.taskLists || {}) };
    lists[activeList] = (lists[activeList] || []).map((t) =>
      t.id === id ? { ...t, done: !t.done } : t
    );
    dataStore.update({ taskLists: lists });
  };

  const removeTask = (id) => {
    const lists = { ...(data.taskLists || {}) };
    lists[activeList] = (lists[activeList] || []).filter((t) => t.id !== id);
    applyDeletion('Tâche supprimée', { taskLists: lists });
  };
  const clearTasks = (onlyDone) => {
    const list = data.taskLists?.[activeList] || [];
    const kept = onlyDone ? list.filter((t) => !t.done) : [];
    if (kept.length === list.length) return;
    if (!onlyDone && !window.confirm(`Vider la liste « ${activeList} » ?`)) return;
    applyDeletion(onlyDone ? 'Tâches terminées supprimées' : `Liste « ${activeList} » vidée`, { taskLists: { ...(data.taskLists || {}), [activeList]: kept } });
  };

  const handleAddExpense = (e) => {
    e.preventDefault();
    const amt = parseFloat(newExpAmount);
    if (Number.isNaN(amt) || amt <= 0) return;
    const expenses = [
      {
        id: `ex_${Date.now()}`,
        amount: amt,
        category: newExpCat,
        label: newExpLabel.trim() || newExpCat,
        date: new Date().toISOString().slice(0, 10),
      },
      ...(data.expenses || []),
    ];
    dataStore.update({ expenses });
    setNewExpAmount('');
    setNewExpLabel('');
  };

  const toggleHabitToday = (id) => {
    const today = new Date().toISOString().slice(0, 10);
    const habits = (data.habits || []).map((h) => {
      if (h.id !== id) return h;
      const done = (h.history || []).includes(today);
      const history = done
        ? h.history.filter((d) => d !== today)
        : [...(h.history || []), today];
      return {
        ...h,
        history,
        streak: done ? Math.max(0, (h.streak || 1) - 1) : (h.streak || 0) + 1,
      };
    });
    dataStore.update({ habits });
  };

  const handleGenerateDoc = async (e) => {
    e.preventDefault();
    setDocStatus('Génération en cours...');
    const res = await createAndSaveDocument({
      type: docType,
      title: docTitle,
      content: docContent,
    });
    if (res.ok) {
      setDocStatus(`✓ Enregistré : ${res.path}`);
      onNotify?.(`Document ${docType.toUpperCase()} enregistré (${res.path})`);
    } else {
      setDocStatus(`Erreur : ${res.error}`);
    }
  };

  const totalExpenses = (data.expenses || []).reduce((s, e) => s + Number(e.amount || 0), 0);
  const totalSubs = (data.subscriptions || []).reduce((s, sub) => s + Number(sub.amount || 0), 0);
  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div className="prod-panel">
      <div className="space-header">
        <div className="space-tabs">
          <button
            className={`space-tab ${subTab === 'tasks' ? 'active' : ''}`}
            onClick={() => setSubTab('tasks')}
          >
            ✅ Tâches & Agenda
          </button>
          <button
            className={`space-tab ${subTab === 'finance' ? 'active' : ''}`}
            onClick={() => setSubTab('finance')}
          >
            💶 Dépenses & Budgets
          </button>
          <button
            className={`space-tab ${subTab === 'habits' ? 'active' : ''}`}
            onClick={() => setSubTab('habits')}
          >
            🔥 Habitudes & Vie
          </button>
          <button
            className={`space-tab ${subTab === 'docs' ? 'active' : ''}`}
            onClick={() => setSubTab('docs')}
          >
            📄 Créateur Documents
          </button>
        </div>
        {onClose && (
          <button className="space-close-btn" onClick={onClose}>
            ✕
          </button>
        )}
      </div>

      {undo && (
        <div className="prod-undo-bar" role="status">
          <span>🗑 {undo.label}</span>
          <button type="button" onClick={undoDelete}>↩ Annuler</button>
          <button type="button" className="prod-undo-close" onClick={() => setUndo(null)} aria-label="Fermer">✕</button>
        </div>
      )}
      <div className="prod-body">
        {subTab === 'tasks' && (
          <div className="prod-grid-2">
            <div className="space-card">
              <div className="prod-card-head">
                <h4>📝 Listes ({activeList})</h4>
                <div className="space-sat-pills">
                  {['courses', 'todo', 'travail'].map((ln) => (
                    <button
                      key={ln}
                      className={`space-pill ${activeList === ln ? 'active' : ''}`}
                      onClick={() => setActiveList(ln)}
                    >
                      {ln}
                    </button>
                  ))}
                </div>
              </div>

              <form className="prod-inline-form" onSubmit={handleAddTask}>
                <input
                  type="text"
                  value={newItemText}
                  onChange={(e) => setNewItemText(e.target.value)}
                  placeholder={`Ajouter à « ${activeList} »...`}
                />
                <button type="submit">+ Ajouter</button>
              </form>

              <div className="prod-items">
                {taskItems.map((it) => (
                  <div key={it.id} className={`prod-item ${it.done ? 'done' : ''}`}>
                    <label>
                      <input
                        type="checkbox"
                        checked={it.done}
                        onChange={() => toggleTask(it.id)}
                      />
                      <span>{it.text}</span>
                    </label>
                    <DelBtn onClick={() => removeTask(it.id)} />
                  </div>
                ))}
                {taskItems.length === 0 && <div className="space-sub">Liste vide.</div>}
              </div>
              {taskItems.length > 0 && (
                <div className="prod-clear-row">
                  {taskItems.some((t) => t.done) && <ClearBtn onClick={() => clearTasks(true)}>Supprimer les terminées</ClearBtn>}
                  <ClearBtn onClick={() => clearTasks(false)}>Vider la liste</ClearBtn>
                </div>
              )}
            </div>

            <div className="space-card">
              <h4>📅 Agenda & Minuteurs actifs</h4>
              {(data.timers || []).filter((t) => t.endsAt > now).length > 0 && (
                <div className="prod-timers-box">
                  {(data.timers || [])
                    .filter((t) => t.endsAt > now)
                    .map((t) => (
                      <div key={t.id} className="prod-timer-pill">
                        ⏱️ {t.label} : <strong>{Math.ceil((t.endsAt - now) / 1000)}s</strong>
                        <DelBtn title="Arrêter le minuteur" onClick={() => removeById('timers', t.id, 'Minuteur supprimé')} />
                      </div>
                    ))}
                </div>
              )}

              <div className="prod-items">
                {(data.calendarEvents || []).map((ev) => (
                  <div key={ev.id} className="space-list-item">
                    <div>
                      <strong>{ev.title}</strong>
                      <div className="space-sub">
                        {new Date(ev.startIso).toLocaleString('fr-FR', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}{' '}
                        {ev.location ? `• ${ev.location}` : ''}
                      </div>
                    </div>
                    <DelBtn onClick={() => removeById('calendarEvents', ev.id, `Événement « ${ev.title} » supprimé`)} />
                  </div>
                ))}
                {(data.calendarEvents || []).length === 0 && <div className="space-sub">Aucun événement.</div>}
              </div>
              {(data.calendarEvents || []).length > 0 && (
                <div className="prod-clear-row">
                  {(data.calendarEvents || []).some((ev) => new Date(ev.endIso || ev.startIso).getTime() < now) && (
                    <ClearBtn onClick={() => applyDeletion('Événements passés supprimés', { calendarEvents: (data.calendarEvents || []).filter((ev) => new Date(ev.endIso || ev.startIso).getTime() >= now) })}>Supprimer les événements passés</ClearBtn>
                  )}
                  <ClearBtn onClick={() => clearAll('calendarEvents', 'tout l’agenda')}>Vider l’agenda</ClearBtn>
                </div>
              )}

              <h4 style={{ marginTop: '14px' }}>🧠 Mémoire à long terme</h4>
              <div className="prod-items">
                {(data.memories || []).map((m, i) => (
                  <div key={`${m.key}-${i}`} className="space-list-item">
                    <div>
                      <strong>{m.key}</strong> : {m.value}
                    </div>
                    <DelBtn onClick={() => applyDeletion(`Souvenir « ${m.key} » supprimé`, { memories: (data.memories || []).filter((_, j) => j !== i) })} />
                  </div>
                ))}
              </div>
              {(data.memories || []).length > 0 && (
                <div className="prod-clear-row"><ClearBtn onClick={() => clearAll('memories', 'toute la mémoire à long terme')}>Tout oublier</ClearBtn></div>
              )}
            </div>
          </div>
        )}

        {subTab === 'finance' && (
          <div className="prod-grid-2">
            <div className="space-card">
              <h4>💶 Dépenses du mois ({totalExpenses.toFixed(2)} € / {data.budgets?.global || 1200} €)</h4>
              <form className="prod-inline-form" onSubmit={handleAddExpense}>
                <input
                  type="number"
                  step="0.01"
                  placeholder="Montant €"
                  value={newExpAmount}
                  onChange={(e) => setNewExpAmount(e.target.value)}
                  style={{ maxWidth: '100px' }}
                />
                <select value={newExpCat} onChange={(e) => setNewExpCat(e.target.value)}>
                  <option value="courses">Courses</option>
                  <option value="repas">Repas</option>
                  <option value="transport">Transport</option>
                  <option value="loisirs">Loisirs</option>
                  <option value="autre">Autre</option>
                </select>
                <input
                  type="text"
                  placeholder="Libellé..."
                  value={newExpLabel}
                  onChange={(e) => setNewExpLabel(e.target.value)}
                />
                <button type="submit">+ Ajouter</button>
              </form>

              <div className="prod-items">
                {(data.expenses || []).map((ex) => (
                  <div key={ex.id} className="space-list-item">
                    <div>
                      <strong>{ex.label}</strong>
                      <div className="space-sub">
                        {ex.category} • {ex.date}
                      </div>
                    </div>
                    <span className="prod-row-actions">
                      <span className="space-tag">{Number(ex.amount).toFixed(2)} €</span>
                      <DelBtn onClick={() => removeById('expenses', ex.id, `Dépense « ${ex.label} » supprimée`)} />
                    </span>
                  </div>
                ))}
                {(data.expenses || []).length === 0 && <div className="space-sub">Aucune dépense.</div>}
              </div>
              {(data.expenses || []).length > 0 && (
                <div className="prod-clear-row"><ClearBtn onClick={() => clearAll('expenses', 'toutes les dépenses')}>Effacer toutes les dépenses</ClearBtn></div>
              )}
            </div>

            <div className="space-card">
              <h4>🔄 Abonnements récurrents ({totalSubs.toFixed(2)} €/mois)</h4>
              <div className="prod-items">
                {(data.subscriptions || []).map((sub) => (
                  <div key={sub.id} className="space-list-item">
                    <div>
                      <strong>{sub.name}</strong>
                      <div className="space-sub">
                        {sub.category} • Prélèvement le {sub.dayOfMonth} du mois
                      </div>
                    </div>
                    <span className="prod-row-actions">
                      <span className="space-tag">{Number(sub.amount).toFixed(2)} €</span>
                      <DelBtn onClick={() => removeById('subscriptions', sub.id, `Abonnement « ${sub.name} » supprimé`)} />
                    </span>
                  </div>
                ))}
                {(data.subscriptions || []).length === 0 && <div className="space-sub">Aucun abonnement.</div>}
              </div>
              {(data.subscriptions || []).length > 0 && (
                <div className="prod-clear-row"><ClearBtn onClick={() => clearAll('subscriptions', 'tous les abonnements')}>Supprimer tous les abonnements</ClearBtn></div>
              )}
            </div>
          </div>
        )}

        {subTab === 'habits' && (
          <div className="prod-grid-2">
            <div className="space-card">
              <h4>🔥 Habitudes quotidiennes</h4>
              <div className="prod-items">
                {(data.habits || []).map((h) => {
                  const done = (h.history || []).includes(todayStr);
                  return (
                    <div key={h.id} className="space-list-item">
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={done}
                          onChange={() => toggleHabitToday(h.id)}
                        />
                        <strong>{h.name}</strong>
                      </label>
                      <span className="prod-row-actions">
                        <span className="space-tag">🔥 {h.streak || 0} jours</span>
                        <DelBtn onClick={() => removeById('habits', h.id, `Habitude « ${h.name} » supprimée`)} />
                      </span>
                    </div>
                  );
                })}
              </div>
              {(data.habits || []).length > 0 && (
                <div className="prod-clear-row"><ClearBtn onClick={() => clearAll('habits', 'toutes les habitudes')}>Supprimer toutes les habitudes</ClearBtn></div>
              )}

              <h4 style={{ marginTop: '14px' }}>📦 Suivi de colis</h4>
              <div className="prod-items">
                {(data.parcels || []).map((p) => (
                  <div key={p.id} className="space-list-item">
                    <div>
                      <strong>{p.label} ({p.carrier} : {p.number})</strong>
                      <div className="space-sub">{p.status}</div>
                    </div>
                    <DelBtn onClick={() => removeById('parcels', p.id, `Colis « ${p.label} » supprimé`)} />
                  </div>
                ))}
              </div>
              {(data.parcels || []).length > 0 && (
                <div className="prod-clear-row"><ClearBtn onClick={() => clearAll('parcels', 'tous les colis')}>Supprimer tous les colis</ClearBtn></div>
              )}
            </div>

            <div className="space-card">
              <h4>🎂 Anniversaires & 🍳 Recettes</h4>
              {(data.birthdays || []).map((b) => (
                <div key={b.id} className="space-list-item">
                  <strong>🎂 {b.name}</strong>
                  <span className="prod-row-actions">
                    <span className="space-tag">{b.date}</span>
                    <DelBtn onClick={() => removeById('birthdays', b.id, `Anniversaire de ${b.name} supprimé`)} />
                  </span>
                </div>
              ))}
              {(data.birthdays || []).length > 0 && (
                <div className="prod-clear-row"><ClearBtn onClick={() => clearAll('birthdays', 'tous les anniversaires')}>Supprimer tous les anniversaires</ClearBtn></div>
              )}
              {(data.recipes || []).map((r) => (
                <div key={r.id} className="space-list-item" style={{ marginTop: '8px' }}>
                  <div>
                    <strong>🍳 {r.title} ({r.servings} pers. • {r.prepMinutes} min)</strong>
                    <div className="space-sub">{(r.ingredients || []).join(', ')}</div>
                  </div>
                  <DelBtn onClick={() => removeById('recipes', r.id, `Recette « ${r.title} » supprimée`)} />
                </div>
              ))}
              {(data.recipes || []).length > 0 && (
                <div className="prod-clear-row"><ClearBtn onClick={() => clearAll('recipes', 'toutes les recettes')}>Supprimer toutes les recettes</ClearBtn></div>
              )}
            </div>
          </div>
        )}

        {subTab === 'docs' && (
          <div className="space-card">
            <h4>📄 Générer un fichier PDF, Word (.docx), Excel (.xlsx), CSV ou Markdown sur le PC</h4>
            <form className="prod-doc-form" onSubmit={handleGenerateDoc}>
              <div className="prod-inline-form">
                <input
                  type="text"
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  placeholder="Titre du document..."
                />
                <select value={docType} onChange={(e) => setDocType(e.target.value)}>
                  <option value="pdf">PDF (.pdf)</option>
                  <option value="docx">Word (.docx)</option>
                  <option value="xlsx">Excel (.xlsx)</option>
                  <option value="pptx">PowerPoint (.pptx)</option>
                  <option value="csv">CSV (.csv)</option>
                  <option value="md">Markdown (.md)</option>
                  <option value="txt">Texte (.txt)</option>
                </select>
                <button type="submit">💾 Créer & Enregistrer</button>
              </div>
              <textarea
                rows={7}
                value={docContent}
                onChange={(e) => setDocContent(e.target.value)}
                placeholder="Contenu en Markdown (pour PDF/Word) ou tableau séparé par | (pour Excel/CSV)..."
              />
              {docStatus && <div className="prod-doc-status">{docStatus}</div>}
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
