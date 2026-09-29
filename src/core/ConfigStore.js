// Port of ConfigStore.kt, LiveModels.kt, and ModelLadder.kt from Jarvis-Android

import { hostBridge } from './hostBridge.js';

export const DEFAULT_LIVE_MODEL = 'models/gemini-2.5-flash-native-audio-preview-12-2025';
export const DEFAULT_REST_MODEL = 'models/gemini-2.5-flash';
export const DEFAULT_TTS_MODEL = 'models/gemini-2.5-flash-preview-tts';
export const DEFAULT_VOICE = 'Aoede';
export const DEFAULT_WAKE_WORD = 'jarvis';
export const MAX_API_KEYS = 3;

export const LIVE_MODELS = [
  { id: 'models/gemini-3.8-live', label: 'Gemini 3.8 Live (Audio natif)' },
  { id: 'models/gemini-3.1-flash-live-preview', label: 'Gemini 3.1 Flash Live Preview' },
  { id: 'models/gemini-2.5-flash-native-audio-preview-12-2025', label: 'Gemini 2.5 Flash Native Audio' },
  { id: 'models/gemini-2.0-flash-live-001', label: 'Gemini 2.0 Flash Live' },
];

export const REST_MODELS = [
  { id: 'models/gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
  { id: 'models/gemini-2.5-flash', label: 'Gemini 2.5 Flash (Recommandé)' },
  { id: 'models/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite (Rapide)' },
  { id: 'models/gemini-2.5-pro', label: 'Gemini 2.5 Pro (Raisonnement)' },
  { id: 'models/gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
];

export const FEMALE_VOICES = [
  'Kore', 'Aoede', 'Leda', 'Zephyr', 'Autonoe', 'Callirrhoe', 'Despina',
  'Erinome', 'Laomedeia', 'Achernar', 'Gacrux', 'Pulcherrima', 'Vindemiatrix', 'Sulafat',
];

export const MALE_VOICES = [
  'Puck', 'Charon', 'Fenrir', 'Orus', 'Enceladus', 'Iapetus', 'Umbriel',
  'Algieba', 'Algenib', 'Rasalgethi', 'Alnilam', 'Schedar', 'Achird',
  'Zubenelgenubi', 'Sadachbia', 'Sadaltager',
];

export const ALL_VOICES = [...FEMALE_VOICES, ...MALE_VOICES];

export const VOICE_DESC = {
  Kore: 'Féminine · posée, claire',
  Aoede: 'Féminine · chaleureuse, naturelle',
  Leda: 'Féminine · douce, calme',
  Zephyr: 'Féminine · vive, légère',
  Autonoe: 'Féminine · lumineuse',
  Callirrhoe: 'Féminine · fluide, détendue',
  Despina: 'Féminine · limpide',
  Erinome: 'Féminine · précise, articulée',
  Laomedeia: 'Féminine · enjouée',
  Achernar: 'Féminine · feutrée',
  Gacrux: 'Féminine · mûre, assurée',
  Pulcherrima: 'Féminine · nette, projetée',
  Vindemiatrix: 'Féminine · posée, grave',
  Sulafat: 'Féminine · enveloppante',
  Puck: 'Masculine · vive, enjouée',
  Charon: 'Masculine · posée, informative',
  Fenrir: 'Masculine · énergique, grave',
  Orus: 'Masculine · ferme, nette',
  Enceladus: 'Masculine · soufflée, douce',
  Iapetus: 'Masculine · claire, directe',
  Umbriel: 'Masculine · détendue',
  Algieba: 'Masculine · lisse, coulante',
  Algenib: 'Masculine · grave, rocailleuse',
  Rasalgethi: 'Masculine · posée, narrative',
  Alnilam: 'Masculine · franche',
  Schedar: 'Masculine · régulière',
  Achird: 'Masculine · amicale',
  Zubenelgenubi: 'Masculine · décontractée',
  Sadachbia: 'Masculine · animée',
  Sadaltager: 'Masculine · calme, posée',
};

// Acoustic profiles (gender, pitch, rate, variant index) for local PC TTS fallback
export const VOICE_PROFILES = {
  // Feminine voices
  Kore:         { gender: 'female', pitch: 1.05, rate: 1.02, idx: 0 },
  Aoede:        { gender: 'female', pitch: 1.12, rate: 1.05, idx: 1 },
  Leda:         { gender: 'female', pitch: 0.98, rate: 0.95, idx: 2 },
  Zephyr:       { gender: 'female', pitch: 1.24, rate: 1.14, idx: 0 },
  Autonoe:      { gender: 'female', pitch: 1.18, rate: 1.06, idx: 1 },
  Callirrhoe:   { gender: 'female', pitch: 1.04, rate: 0.98, idx: 2 },
  Despina:      { gender: 'female', pitch: 1.28, rate: 1.08, idx: 0 },
  Erinome:      { gender: 'female', pitch: 1.08, rate: 1.10, idx: 1 },
  Laomedeia:    { gender: 'female', pitch: 1.22, rate: 1.12, idx: 2 },
  Achernar:     { gender: 'female', pitch: 0.94, rate: 0.94, idx: 0 },
  Gacrux:       { gender: 'female', pitch: 0.90, rate: 1.00, idx: 1 },
  Pulcherrima:  { gender: 'female', pitch: 1.15, rate: 1.08, idx: 2 },
  Vindemiatrix: { gender: 'female', pitch: 0.88, rate: 0.96, idx: 0 },
  Sulafat:      { gender: 'female', pitch: 1.00, rate: 0.98, idx: 1 },
  // Masculine voices
  Puck:         { gender: 'male',   pitch: 0.92, rate: 1.12, idx: 0 },
  Charon:       { gender: 'male',   pitch: 0.80, rate: 1.00, idx: 1 },
  Fenrir:       { gender: 'male',   pitch: 0.68, rate: 1.04, idx: 2 },
  Orus:         { gender: 'male',   pitch: 0.78, rate: 1.06, idx: 0 },
  Enceladus:    { gender: 'male',   pitch: 0.86, rate: 0.94, idx: 1 },
  Iapetus:      { gender: 'male',   pitch: 0.84, rate: 1.08, idx: 2 },
  Umbriel:      { gender: 'male',   pitch: 0.82, rate: 0.96, idx: 0 },
  Algieba:      { gender: 'male',   pitch: 0.88, rate: 1.02, idx: 1 },
  Algenib:      { gender: 'male',   pitch: 0.65, rate: 0.98, idx: 2 },
  Rasalgethi:   { gender: 'male',   pitch: 0.76, rate: 0.96, idx: 0 },
  Alnilam:      { gender: 'male',   pitch: 0.74, rate: 1.06, idx: 1 },
  Schedar:      { gender: 'male',   pitch: 0.82, rate: 1.02, idx: 2 },
  Achird:       { gender: 'male',   pitch: 0.90, rate: 1.06, idx: 0 },
  Zubenelgenubi:{ gender: 'male',   pitch: 0.85, rate: 0.98, idx: 1 },
  Sadachbia:    { gender: 'male',   pitch: 0.94, rate: 1.14, idx: 2 },
  Sadaltager:   { gender: 'male',   pitch: 0.75, rate: 0.95, idx: 0 },
};

export function normalizeFaceId(rawId) {
  const s = String(rawId || 'classic').trim().toLowerCase().replace(/^char:/, '');
  if (s === 'female01') return 'lea';
  if (s === 'male02') return 'marc';
  if (['classic', 'lea', 'marc'].includes(s)) return s;
  return 'classic';
}

export function normalizeSkinMode(rawSkin) {
  if (typeof rawSkin === 'number' && rawSkin >= 0 && rawSkin <= 8) return rawSkin;
  if (rawSkin === true) return 2;
  return 7; // Default in Jarvis-Android: 7 (Hologramme bleu + circuits électriques)
}

const STORAGE_KEY = 'jarvis2_config_v1';

const DEFAULT_CONFIG = {
  apiKeys: ['', '', ''],
  activeKeySlot: 0,
  voiceMode: 'hybrid', // 'live' | 'rest' | 'hybrid' | 'offline'
  liveModel: DEFAULT_LIVE_MODEL,
  restModel: DEFAULT_REST_MODEL,
  ttsModel: DEFAULT_TTS_MODEL,
  voiceName: DEFAULT_VOICE,
  wakeWord: DEFAULT_WAKE_WORD,
  wakeListenEnabled: false,
  pttShortcut: 'CommandOrControl+Space',
  ttsEnabled: true,
  speechRate: 1.05,
  // Avatar
  avatarMode: '3d', // '3d' | 'reactor'
  avatarFaceId: 'classic', // 'classic' | 'lea' | 'marc'
  avatarSkin: 7, // 7 = Hologramme bleu + circuits, 5 = Hologramme or + circuits, 6 = Hologramme + fibres, 0 = Réseau lumineux, 1..4 = Peau
  avatarLips: 0, // 0 = Naturelles, 1 = Rose, 2 = Rouge, 3 = Prune, 4 = Corail
  avatarHair: 'auto', // 'auto' | 'none' | style id
  avatarHairShade: 'natural',
  // User & Location
  userName: '',
  userCity: 'Bordeaux',
  userLat: 44.8378,
  userLon: -0.5792,
  customPrompt: '',
  // External integrations
  haUrl: '',
  haToken: '',
  obsidianVaultPath: '',
  workFolderPath: '',
  laposteKey: '',
  sncfKey: '',
  navitiaKey: '',
  confirmDestructiveActions: true,
};

class ConfigStore {
  constructor() {
    this.state = { ...DEFAULT_CONFIG };
    this.listeners = new Set();
    this._loadSync();
  }

  _loadSync() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.state = {
          ...DEFAULT_CONFIG,
          ...parsed,
          avatarMode: parsed.avatarMode === 'reactor' ? 'reactor' : '3d',
          avatarFaceId: normalizeFaceId(parsed.avatarFaceId),
          avatarSkin: normalizeSkinMode(parsed.avatarSkin),
        };
      }
    } catch {
      // ignore
    }
  }

  async initSecrets() {
    try {
      // Load persisted config from Electron %APPDATA%/jarvis-pc/jarvis-store.json
      const diskConfig = await hostBridge.storageGet('config_v1', null);
      if (diskConfig && typeof diskConfig === 'object') {
        this.state = {
          ...DEFAULT_CONFIG,
          ...this.state,
          ...diskConfig,
          avatarMode: (diskConfig.avatarMode || this.state.avatarMode) === 'reactor' ? 'reactor' : '3d',
          avatarFaceId: normalizeFaceId(diskConfig.avatarFaceId || this.state.avatarFaceId),
          avatarSkin: normalizeSkinMode(
            diskConfig.avatarSkin !== undefined ? diskConfig.avatarSkin : this.state.avatarSkin
          ),
        };
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
        } catch {
          // ignore
        }
      }

      const savedKeys = await hostBridge.getSecret('apiKeys', null);
      if (Array.isArray(savedKeys) && savedKeys.some(Boolean)) {
        this.state.apiKeys = savedKeys;
      }
      const haToken = await hostBridge.getSecret('haToken', '');
      if (haToken) this.state.haToken = haToken;
      this._notify();
    } catch {
      // ignore
    }
  }

  get() {
    return this.state;
  }

  update(patch) {
    const nextPatch = { ...patch };
    if (nextPatch.avatarFaceId !== undefined) {
      nextPatch.avatarFaceId = normalizeFaceId(nextPatch.avatarFaceId);
    }
    if (nextPatch.avatarSkin !== undefined) {
      nextPatch.avatarSkin = normalizeSkinMode(nextPatch.avatarSkin);
    }
    if (nextPatch.avatarMode !== undefined && nextPatch.avatarMode !== 'reactor') {
      nextPatch.avatarMode = '3d';
    }
    this.state = { ...this.state, ...nextPatch };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // ignore
    }
    hostBridge.storageSet('config_v1', this.state).catch(() => {});
    if (patch.apiKeys) {
      hostBridge.setSecret('apiKeys', this.state.apiKeys).catch(() => {});
    }
    if (patch.haToken !== undefined) {
      hostBridge.setSecret('haToken', this.state.haToken).catch(() => {});
    }
    this._notify();
    return this.state;
  }

  getActiveApiKey() {
    const keys = (this.state.apiKeys || []).map((k) => String(k || '').trim()).filter(Boolean);
    if (keys.length === 0) return '';
    const idx = Math.min(this.state.activeKeySlot || 0, keys.length - 1);
    return keys[idx] || keys[0];
  }

  rotateApiKey() {
    const keys = (this.state.apiKeys || []).map((k) => String(k || '').trim());
    const validIndices = keys.map((k, i) => (k ? i : -1)).filter((i) => i >= 0);
    if (validIndices.length <= 1) return false;
    const curPos = validIndices.indexOf(this.state.activeKeySlot);
    const nextSlot = validIndices[(curPos + 1) % validIndices.length];
    this.update({ activeKeySlot: nextSlot });
    return true;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _notify() {
    for (const fn of this.listeners) {
      try {
        fn(this.state);
      } catch {
        // ignore
      }
    }
  }
}

export const configStore = new ConfigStore();
