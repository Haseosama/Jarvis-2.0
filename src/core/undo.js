// Annuler ce que l'assistant a fait (port de core/undo.py) : chaque action réversible empile sa propre marche arrière.

export const UNDO_LIMIT = 30;

export class UndoStack {
  constructor(limit = UNDO_LIMIT) {
    this.limit = limit;
    this.items = [];
  }

  /** `undo` : fonction async qui défait l'action. `label` : phrase lisible. */
  record(label, undo) {
    if (typeof undo !== 'function') return;
    this.items.push({ label: String(label), undo, at: Date.now() });
    if (this.items.length > this.limit) this.items.shift();
  }

  peek() {
    return this.items.at(-1)?.label || null;
  }

  list() {
    return this.items.map((i) => i.label).reverse();
  }

  async undoLast(count = 1) {
    const out = [];
    for (let i = 0; i < Math.max(1, count) && this.items.length; i++) {
      const item = this.items.pop();
      try {
        await item.undo();
        out.push(`Annulé : ${item.label}`);
      } catch (err) {
        out.push(`Impossible d'annuler « ${item.label} » : ${err?.message || err}`);
      }
    }
    return out;
  }
}

export const undoStack = new UndoStack();
