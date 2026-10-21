// Unified Persistent Store for Jarvis 2.0 PC Edition
// Covers: Memories, Tasks, Reminders, Timers, Alarms, Expenses, Budgets, Subscriptions,
// Habits, Recipes, Parcels, Birthdays, Calendar, Contacts, Meetings, Web Watches, Routines, QuietMode

import { hostBridge } from './hostBridge.js';

const STORAGE_KEY = 'jarvis2_datastore_v1';

const INITIAL_DATA = {
  memories: [
    { key: 'plateforme', value: 'Jarvis 2.0 Édition PC (Windows / Desktop autonome sans serveur externe)', updatedAt: Date.now() },
  ],
  taskLists: {
    courses: [
      { id: 't1', text: 'Café en grains', done: false, createdAt: Date.now() },
      { id: 't2', text: 'Fruits frais', done: false, createdAt: Date.now() },
    ],
    todo: [
      { id: 't3', text: 'Tester les commandes vocales et les 82 plugins de Jarvis 2.0', done: false, createdAt: Date.now() },
    ],
  },
  reminders: [],
  personReminders: [],
  placeReminders: [],
  timers: [],
  alarms: [
    { id: 'a1', time: '07:30', label: 'Réveil matin', enabled: false, radioQuery: 'France Inter' },
  ],
  calendarEvents: [
    {
      id: 'ev1',
      title: 'Point projet Jarvis 2.0 PC',
      startIso: new Date(Date.now() + 3600000 * 3).toISOString(),
      endIso: new Date(Date.now() + 3600000 * 4).toISOString(),
      location: 'Bureau / Visio',
      notes: 'Revue des fonctionnalités desktop et avatar 3D',
    },
  ],
  contacts: [
    { id: 'c1', name: 'Marie Martin', phone: '+33612345678', email: 'marie.martin@example.com', note: 'Collègue' },
    { id: 'c2', name: 'Thomas Bernard', phone: '+33698765432', email: 'thomas.b@example.com', note: 'Ami' },
  ],
  expenses: [
    { id: 'ex1', amount: 42.5, category: 'courses', label: 'Supermarché bio', date: new Date().toISOString().slice(0, 10) },
    { id: 'ex2', amount: 14.9, category: 'repas', label: 'Déjeuner boulangerie', date: new Date().toISOString().slice(0, 10) },
  ],
  budgets: {
    global: 1200,
    courses: 400,
    loisirs: 200,
    repas: 200,
  },
  subscriptions: [
    { id: 'sub1', name: 'Fibre Optique', amount: 29.99, period: 'mensuel', category: 'internet', dayOfMonth: 5 },
    { id: 'sub2', name: 'Musique Streaming', amount: 10.99, period: 'mensuel', category: 'média', dayOfMonth: 15 },
  ],
  habits: [
    { id: 'h1', name: 'Sport / Marche 30 min', streak: 4, history: [new Date().toISOString().slice(0, 10)] },
    { id: 'h2', name: 'Lecture 20 pages', streak: 2, history: [] },
    { id: 'h3', name: 'Hydratation 2L', streak: 7, history: [new Date().toISOString().slice(0, 10)] },
  ],
  recipes: [
    {
      id: 'rec1',
      title: 'Risotto aux champignons',
      servings: 4,
      prepMinutes: 30,
      ingredients: ['300g riz arborio', '400g champignons de Paris', '1L bouillon de légumes', '50g parmesan', '1 oignon'],
      steps: [
        'Émincer l’oignon et les champignons puis les faire revenir à l’huile d’olive.',
        'Ajouter le riz arborio et nacrer 2 minutes à feu moyen.',
        'Verser le bouillon chaud louche par louche en remuant régulièrement pendant 18 minutes.',
        'Incorporer le parmesan hors du feu, saler, poivrer et servir chaud.',
      ],
    },
  ],
  parcels: [
    { id: 'p1', number: '6A12345678901', carrier: 'Colissimo', label: 'Casque Audio PC', status: 'En cours d’acheminement vers le centre de tri', updatedAt: Date.now() },
  ],
  birthdays: [
    { id: 'b1', name: 'Marie Martin', date: '10-14', year: 1994 },
    { id: 'b2', name: 'Maman', date: '05-22', year: 1965 },
  ],
  meetings: [],
  watches: [
    { id: 'w1', url: 'https://news.ycombinator.com', label: 'Hacker News Top', lastSummary: 'Surveillance active', updatedAt: Date.now() },
  ],
  routines: [
    {
      id: 'r1',
      name: 'bonjour',
      label: 'Routine du matin',
      triggerTime: '08:00',
      steps: ['weather', 'calendar', 'tasks'],
    },
    {
      id: 'r2',
      name: 'concentration',
      label: 'Mode Focus PC',
      triggerTime: '',
      steps: ['quiet_mode', 'timer'],
    },
  ],
  quietMode: {
    active: false,
    untilMs: 0,
    reason: 'Concentration',
    vipContacts: ['Marie Martin', 'Maman'],
  },
  sentMessages: [],
  customPlugins: [],
};

class DataStore {
  constructor() {
    this.data = this._load();
    this.listeners = new Set();
    this._initAsync();
  }

  async _initAsync() {
    try {
      const disk = await hostBridge.storageGet('datastore_v1', null);
      if (disk && typeof disk === 'object') {
        this.data = { ...INITIAL_DATA, ...this.data, ...disk };
        for (const fn of this.listeners) {
          try {
            fn(this.data);
          } catch {}
        }
      }
    } catch {}
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return { ...INITIAL_DATA, ...parsed };
      }
    } catch {
      // ignore
    }
    return { ...INITIAL_DATA };
  }

  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // ignore
    }
    hostBridge.storageSet('datastore_v1', this.data).catch(() => {});
    for (const fn of this.listeners) {
      try {
        fn(this.data);
      } catch {
        // ignore
      }
    }
  }

  get() {
    return this.data;
  }

  update(updater) {
    const next = typeof updater === 'function' ? updater(this.data) : { ...this.data, ...updater };
    this.data = next;
    this._save();
    return this.data;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ── Memory Helpers ──
  /** profileId : null = souvenir du foyer (visible de tous), sinon propre à cette personne. */
  rememberFact(key, value, profileId = null) {
    const k = String(key || '').trim();
    const v = String(value || '').trim();
    if (!k || !v) return false;
    const pid = profileId || null;
    const entry = { key: k, value: v, updatedAt: Date.now(), ...(pid ? { profileId: pid } : {}) };
    const list = [...(this.data.memories || [])];
    const idx = list.findIndex((m) => m.key.toLowerCase() === k.toLowerCase() && (m.profileId || null) === pid);
    if (idx >= 0) list[idx] = entry;
    else list.push(entry);
    this.update({ memories: list });
    return true;
  }

  /** `visibleTo` : si fourni, seuls les souvenirs du foyer et de ce profil peuvent être oubliés. */
  forgetFact(key, visibleTo) {
    const k = String(key || '').trim().toLowerCase();
    const before = (this.data.memories || []).length;
    const visible = (m) => visibleTo === undefined || !m.profileId || m.profileId === visibleTo;
    const list = (this.data.memories || []).filter((m) => !(m.key.toLowerCase().includes(k) && visible(m)));
    this.update({ memories: list });
    return list.length < before;
  }

  addProfile(name) {
    const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 30);
    if (!clean) return null;
    const profiles = this.data.profiles || [];
    const existing = profiles.find((p) => p.name.toLowerCase() === clean.toLowerCase());
    if (existing) return existing.id;
    const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    this.update({ profiles: [...profiles, { id, name: clean, createdAt: Date.now() }] });
    return id;
  }

  /** Supprime la personne et ses souvenirs (ceux du foyer restent). */
  removeProfile(id) {
    const profiles = (this.data.profiles || []).filter((p) => p.id !== id);
    this.update({
      profiles,
      memories: (this.data.memories || []).filter((m) => m.profileId !== id),
      activeProfileId: this.data.activeProfileId === id ? null : this.data.activeProfileId ?? null,
    });
  }

  setActiveProfile(id) {
    const ok = id === null || (this.data.profiles || []).some((p) => p.id === id);
    if (ok) this.update({ activeProfileId: id });
    return ok;
  }

  clearMemories() {
    this.update({ memories: [] });
  }
}

export const dataStore = new DataStore();
