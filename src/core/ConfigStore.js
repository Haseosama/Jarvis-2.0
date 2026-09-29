// Port of ConfigStore.kt, LiveModels.kt, and ModelLadder.kt from Jarvis-Android

import { hostBridge } from './hostBridge.js';

export const DEFAULT_LIVE_MODEL = 'models/gemini-2.5-flash-native-audio-preview-12-2025';
export const DEFAULT_REST_MODEL = 'models/gemini-2.5-flash';
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

const STORAGE_KEY = 'jarvis2_config_v1';

const DEFAULT_CONFIG = {
  apiKeys: ['', '', ''],
  activeKeySlot: 0,
  voiceMode: 'hybrid', // 'live' | 'rest' | 'hybrid' | 'offline'
  liveModel: DEFAULT_LIVE_MODEL,
  restModel: DEFAULT_REST_MODEL,
  voiceName: DEFAULT_VOICE,
  wakeWord: DEFAULT_WAKE_WORD,
  wakeListenEnabled: false,
  pttShortcut: 'CommandOrControl+Space',
  ttsEnabled: true,
  speechRate: 1.05,
  // Avatar
  avatarMode: '3d', // '3d' | 'cartoon' | 'reactor'
  avatarFaceId: 'female01', // 'female01' | 'male02' | 'char:adam' | 'char:mei'
  avatarSkin: false, // false = holo wireframe/surface, true = full skin shaded
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
        this.state = { ...DEFAULT_CONFIG, ...parsed };
      }
    } catch {
      // ignore
    }
  }

  async initSecrets() {
    try {
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
    this.state = { ...this.state, ...patch };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // ignore
    }
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
