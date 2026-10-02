import React, { useState, useEffect } from 'react';
import { dataStore } from '../core/DataStore.js';
import { expensesOfMonth, monthKey, monthLabel, shiftMonth, summarizeMonth } from '../core/finance.js';
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
  const [draft, setDraft] = useState({}); // champs des formulaires d'ajout
  const field = (k) => ({ value: draft[k] || '', onChange: (e) => setDraft((x) => ({ ...x, [k]: e.target.value })) });
  const clearDraft = (...keys) => setDraft((x) => Object.fromEntries(Object.entries(x).filter(([k]) => !keys.includes(k))));
  const [month, setMonth] = useState(monthKey());
  const [undo, setUndo] = useState(null); // { label, previous } : dernière suppression annulable

  useEffect(() => {
    const unsub = dataStore.subscribe(setData);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      unsub();
      clearInterval(timer);
    };
  }, []);

  const BASE_LISTS = ['courses', 'todo', 'travail'];
  const listNames = [...new Set([...BASE_LISTS, ...Object.keys(data.taskLists || {})])];
  const taskItems = data.taskLists?.[activeList] || [];
  const addList = (e) => {
    e.preventDefault();
    const name = (draft.listName || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 30);
    if (!name || name === '__proto__' || name === 'constructor') return;
    if (!(name in (data.taskLists || {}))) dataStore.update({ taskLists: { ...(data.taskLists || {}), [name]: [] } });
    setActiveList(name);
    clearDraft('listName');
  };
  const deleteList = () => {
    if (BASE_LISTS.includes(activeList)) return;
    const lists = { ...(data.taskLists || {}) };
    if ((lists[activeList] || []).length && !window.confirm(`Supprimer la liste « ${activeList} » et ses ${lists[activeList].length} élément(s) ?`)) return;
    delete lists[activeList];
    applyDeletion(`Liste « ${activeList} » supprimée`, { taskLists: lists });
    setActiveList('todo');
  };

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

  const addEvent = (e) => {
    e.preventDefault();
    const title = (draft.evTitle || '').trim();
    const start = new Date(draft.evStart || '');
    if (!title || Number.isNaN(start.getTime())) return;
    const end = new Date(start.getTime() + 3600000);
    const ev = { id: `ev_${Date.now()}`, title, startIso: start.toISOString(), endIso: end.toISOString(), location: (draft.evLoc || '').trim(), notes: '' };
    dataStore.update({ calendarEvents: [...(dataStore.get().calendarEvents || []), ev].sort((a, b) => new Date(a.startIso) - new Date(b.startIso)) });
    clearDraft('evTitle', 'evStart', 'evLoc');
  };
  const addSubscription = (e) => {
    e.preventDefault();
    const name = (draft.subName || '').trim();
    const amount = parseFloat(draft.subAmount);
    const day = Math.min(31, Math.max(1, parseInt(draft.subDay, 10) || 1));
    if (!name || Number.isNaN(amount) || amount <= 0) return;
    dataStore.update({ subscriptions: [...(dataStore.get().subscriptions || []), { id: `sub_${Date.now()}`, name, amount, period: 'mensuel', category: 'autre', dayOfMonth: day }] });
    clearDraft('subName', 'subAmount', 'subDay');
  };
  const addMemory = (e) => {
    e.preventDefault();
    if (dataStore.rememberFact(draft.memKey, draft.memValue)) clearDraft('memKey', 'memValue');
  };
  const addHabit = (e) => {
    e.preventDefault();
    const name = (draft.habitName || '').trim();
    if (!name) return;
    dataStore.update({ habits: [...(dataStore.get().habits || []), { id: `h_${Date.now()}`, name, streak: 0, history: [] }] });
    clearDraft('habitName');
  };
  const addBirthday = (e) => {
    e.preventDefault();
    const name = (draft.bdName || '').trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(draft.bdDate || '');
    if (!name || !m) return;
    dataStore.update({ birthdays: [...(dataStore.get().birthdays || []), { id: `b_${Date.now()}`, name, date: `${m[2]}-${m[3]}`, year: Number(m[1]) }] });
    clearDraft('bdName', 'bdDate');
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

  const summary = summarizeMonth(data.expenses, data.budgets, month);
  const monthExpenses = expensesOfMonth(data.expenses, month);
  const totalExpenses = summary.total;
  const setBudget = (cat, value) => {
    const amount = parseFloat(value);
    const budgets = { ...(dataStore.get().budgets || {}) };
    if (Number.isNaN(amount) || amount <= 0) delete budgets[cat];
    else budgets[cat] = amount;
    dataStore.update({ budgets });
  };
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
                  {listNames.map((ln) => (
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

              <form className="prod-inline-form" onSubmit={addList}>
                <input type="text" placeholder="Nouvelle liste (ex. voyage)…" {...field('listName')} />
                <button type="submit">+ Liste</button>
                {!BASE_LISTS.includes(activeList) && <button type="button" className="prod-clear-btn" onClick={deleteList}>🗑 Supprimer cette liste</button>}
              </form>

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

              <form className="prod-inline-form" onSubmit={addEvent}>
                <input type="text" placeholder="Nouvel événement…" {...field('evTitle')} />
                <input type="datetime-local" {...field('evStart')} />
                <input type="text" placeholder="Lieu (facultatif)" {...field('evLoc')} />
                <button type="submit">+ Ajouter</button>
              </form>
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
              <form className="prod-inline-form" onSubmit={addMemory}>
                <input type="text" placeholder="Sujet (ex. allergie)…" {...field('memKey')} />
                <input type="text" placeholder="Ce que Jarvis doit retenir…" {...field('memValue')} />
                <button type="submit">+ Retenir</button>
              </form>
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
              <h4>💶 Dépenses de {monthLabel(month)} ({totalExpenses.toFixed(2)} € / {data.budgets?.global || 1200} €)</h4>
              <div className="prod-month-nav">
                <button type="button" className="space-pill" onClick={() => setMonth(shiftMonth(month, -1))}>◀</button>
                <span>{monthLabel(month)}</span>
                <button type="button" className="space-pill" disabled={month >= monthKey()} onClick={() => setMonth(shiftMonth(month, 1))}>▶</button>
              </div>
              <div className={`prod-bar ${summary.overGlobal ? 'over' : ''}`} title="Budget global">
                <div style={{ width: `${Math.min(100, (totalExpenses / (data.budgets?.global || 1200)) * 100)}%` }} />
              </div>
              {summary.categories.map((c) => (
                <div key={c.category} className="prod-cat-row">
                  <span>{c.category}</span>
                  <div className={`prod-bar small ${c.over ? 'over' : ''}`}>
                    <div style={{ width: `${c.budget ? Math.min(100, (c.spent / c.budget) * 100) : 100}%` }} />
                  </div>
                  <span className="space-sub">{c.spent.toFixed(2)} €{c.budget ? ` / ${c.budget} €` : ''}{c.over ? ' ⚠️' : ''}</span>
                  <input
                    className="prod-budget-input"
                    type="number"
                    min="0"
                    step="10"
                    placeholder="budget"
                    title={`Budget mensuel « ${c.category} » (vide = aucun)`}
                    defaultValue={c.budget || ''}
                    key={`${c.category}-${c.budget}`}
                    onBlur={(e) => setBudget(c.category, e.target.value)}
                  />
                </div>
              ))}
              <div className="prod-cat-row">
                <span>budget global</span>
                <input className="prod-budget-input" type="number" min="0" step="50" defaultValue={data.budgets?.global || 1200} key={`g-${data.budgets?.global}`} onBlur={(e) => setBudget('global', e.target.value)} />
              </div>
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
                {monthExpenses.map((ex) => (
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
                {monthExpenses.length === 0 && <div className="space-sub">Aucune dépense ce mois-ci.</div>}
              </div>
              {(data.expenses || []).length > 0 && (
                <div className="prod-clear-row"><ClearBtn onClick={() => clearAll('expenses', 'toutes les dépenses')}>Effacer toutes les dépenses</ClearBtn></div>
              )}
            </div>

            <div className="space-card">
              <h4>🔄 Abonnements récurrents ({totalSubs.toFixed(2)} €/mois)</h4>
              <form className="prod-inline-form" onSubmit={addSubscription}>
                <input type="text" placeholder="Abonnement…" {...field('subName')} />
                <input type="number" step="0.01" placeholder="€/mois" style={{ maxWidth: '90px' }} {...field('subAmount')} />
                <input type="number" min="1" max="31" placeholder="Jour" style={{ maxWidth: '70px' }} {...field('subDay')} />
                <button type="submit">+ Ajouter</button>
              </form>
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
              <form className="prod-inline-form" onSubmit={addHabit}>
                <input type="text" placeholder="Nouvelle habitude…" {...field('habitName')} />
                <button type="submit">+ Ajouter</button>
              </form>
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
              <form className="prod-inline-form" onSubmit={addBirthday}>
                <input type="text" placeholder="Prénom…" {...field('bdName')} />
                <input type="date" {...field('bdDate')} />
                <button type="submit">+ Ajouter</button>
              </form>
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
