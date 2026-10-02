// Calculs de budget (purs) : dépenses d'un mois, totaux par catégorie, dépassements de budget.

export function monthKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function shiftMonth(key, delta) {
  const m = /^(\d{4})-(\d{2})$/.exec(key || '');
  const base = m ? new Date(Number(m[1]), Number(m[2]) - 1, 1) : new Date();
  base.setMonth(base.getMonth() + delta);
  return monthKey(base);
}

export function monthLabel(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(key || '');
  if (!m) return String(key || '');
  return new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

export function expensesOfMonth(expenses, key) {
  return (expenses || []).filter((e) => String(e?.date || '').slice(0, 7) === key);
}

/** Total du mois, totaux par catégorie (triés), et état de chaque budget défini. */
export function summarizeMonth(expenses, budgets, key = monthKey()) {
  const items = expensesOfMonth(expenses, key);
  const total = items.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const byCat = {};
  for (const e of items) {
    const cat = String(e.category || 'autre');
    byCat[cat] = (byCat[cat] || 0) + (Number(e.amount) || 0);
  }
  const limit = (cat) => Number(budgets?.[cat]) || 0;
  const categories = Object.entries(byCat)
    .sort((a, b) => b[1] - a[1])
    .map(([category, spent]) => ({ category, spent, budget: limit(category), over: limit(category) > 0 && spent > limit(category) }));
  const globalBudget = limit('global');
  return { key, items, total, categories, globalBudget, overGlobal: globalBudget > 0 && total > globalBudget };
}
