// État des fournisseurs de modèles. Les clés API ne sont jamais écrites dans le stockage normal :
// elles passent par hostBridge.setSecret (chiffrement safeStorage dans l'application de bureau).
import { hostBridge } from '../core/hostBridge.js';
import { configStore } from '../core/ConfigStore.js';
import { PROVIDERS, PROVIDER_IDS, validateBaseUrl } from './providers.js';

const STORAGE_KEY = 'llm_v1';
const SECRET_SLOT = 'llmKeys';
export const MAX_SLOTS = 4;

export const DEFAULT_LLM_STATE = {
  providers: {}, // { [id]: { baseUrl?, models: string[] } }
  code: { provider: 'gemini', model: 'gemini-2.5-flash' },
  compareSlots: [
    { provider: 'gemini', model: 'gemini-2.5-flash' },
    { provider: 'gemini', model: 'gemini-2.5-pro' },
  ],
  ratings: {}, // { 'provider|model': { elo, games, wins } }
};

export function slotKey(slot) {
  return `${slot.provider}|${slot.model}`;
}

export function sanitizeState(raw) {
  const state = JSON.parse(JSON.stringify(DEFAULT_LLM_STATE));
  if (!raw || typeof raw !== 'object') return state;
  for (const id of PROVIDER_IDS) {
    const p = raw.providers?.[id];
    if (!p || typeof p !== 'object') continue;
    const entry = { models: Array.isArray(p.models) ? p.models.filter((m) => typeof m === 'string').slice(0, 300) : [] };
    if (typeof p.baseUrl === 'string' && p.baseUrl) {
      try { entry.baseUrl = validateBaseUrl(p.baseUrl); } catch { /* URL ignorée */ }
    }
    state.providers[id] = entry;
  }
  const validSlot = (s) => s && PROVIDERS[s.provider] && typeof s.model === 'string' && s.model.trim();
  if (validSlot(raw.code)) state.code = { provider: raw.code.provider, model: raw.code.model.trim() };
  if (Array.isArray(raw.compareSlots)) {
    const slots = raw.compareSlots.filter(validSlot).slice(0, MAX_SLOTS).map((s) => ({ provider: s.provider, model: s.model.trim() }));
    if (slots.length >= 2) state.compareSlots = slots;
  }
  if (raw.ratings && typeof raw.ratings === 'object') {
    for (const [key, value] of Object.entries(raw.ratings).slice(0, 500)) {
      if (value && Number.isFinite(value.elo)) {
        state.ratings[key] = { elo: value.elo, games: Math.max(0, value.games | 0), wins: Math.max(0, value.wins | 0) };
      }
    }
  }
  return state;
}

class LlmStore {
  constructor() {
    this.state = sanitizeState(null);
    this.keys = {};
    this.listeners = new Set();
    this.ready = false;
  }

  async init() {
    try {
      const raw = await hostBridge.storageGet(STORAGE_KEY);
      this.state = sanitizeState(typeof raw === 'string' ? JSON.parse(raw) : raw);
    } catch { this.state = sanitizeState(null); }
    try {
      const secret = await hostBridge.getSecret(SECRET_SLOT, {});
      this.keys = secret && typeof secret === 'object' ? secret : {};
    } catch { this.keys = {}; }
    this.ready = true;
    this.emit();
    return this;
  }

  get() { return this.state; }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() { this.listeners.forEach((fn) => fn(this.state)); }

  async persist() {
    try { await hostBridge.storageSet(STORAGE_KEY, JSON.stringify(this.state)); } catch { /* ignore */ }
  }

  update(patch) {
    this.state = sanitizeState({ ...this.state, ...patch });
    this.persist();
    this.emit();
  }

  setProvider(id, patch) {
    this.update({ providers: { ...this.state.providers, [id]: { ...(this.state.providers[id] || { models: [] }), ...patch } } });
  }

  hasKey(id) { return Boolean(this.keys[id]); }

  async setKey(id, key) {
    if (!PROVIDERS[id]) return false;
    const next = { ...this.keys };
    const clean = String(key || '').trim();
    if (clean) next[id] = clean; else delete next[id];
    this.keys = next;
    const ok = await hostBridge.setSecret(SECRET_SLOT, Object.keys(next).length ? next : '');
    this.emit();
    return ok;
  }

  /** Clé effective : celles de Jarvis pour Gemini, sinon la clé enregistrée. */
  getApiKey(id) {
    if (PROVIDERS[id]?.usesJarvisKey) return configStore.getActiveApiKey?.() || this.keys[id] || '';
    return this.keys[id] || '';
  }

  baseUrlOf(id) { return this.state.providers[id]?.baseUrl || PROVIDERS[id]?.baseUrl || ''; }

  isConfigured(id) {
    const def = PROVIDERS[id];
    if (!def) return false;
    if (def.keyless) return Boolean(this.baseUrlOf(id));
    if (!this.baseUrlOf(id)) return false;
    return Boolean(this.getApiKey(id));
  }

  /** Modèles proposés pour un fournisseur : liste récupérée + suggestions. */
  modelsOf(id) {
    return [...new Set([...(this.state.providers[id]?.models || []), ...(PROVIDERS[id]?.suggestions || [])])];
  }

  /** Paramètres prêts pour callModel(). */
  resolve(slot) {
    return { provider: slot.provider, model: slot.model, apiKey: this.getApiKey(slot.provider), baseUrl: this.baseUrlOf(slot.provider) };
  }
}

export const llmStore = new LlmStore();
