// Pont entre les satellites audio (electron/satellites.cjs) et le moteur de Jarvis.
//
// Le processus principal découpe la parole en phrases et nous les envoie (PCM 16 kHz). Ici : transcription, mot d'éveil, réponse
// du moteur avec une liste d'outils réduite, synthèse vocale, ré-échantillonnage à 16 kHz.
//
// Vie privée : en veille, le satellite écoute en permanence. Le mot d'éveil n'est donc cherché que par une reconnaissance LOCALE
// (serveur Whisper compatible OpenAI) : jamais de transcription dans le cloud d'une pièce qui n'a pas appelé Jarvis.
// Une fois l'assistant appelé, la conversation peut utiliser Gemini si aucun serveur local n'est réglé.
import { configStore } from './ConfigStore.js';
import { hostBridge } from './hostBridge.js';
import { matchWakeWord } from '../audio/voiceGuards.js';
import { resampleS16, wavFromPcm } from '../audio/pcm.js';
import { geminiSpeak, geminiTranscribe, synthesize, transcribe, SPEECH_DEFAULTS } from '../llm/speech.js';

/** Outils permis depuis une pièce : informatifs et sans effet sur le PC. Jamais de fichiers, de souris, d'envois ni d'arrêt. */
export const SATELLITE_TOOLS = [
  'weather', 'rain_soon', 'air_quality', 'fuel_prices', 'web_search', 'read_webpage', 'world_clock', 'transport', 'set_timer', 'radio', 'podcasts',
  'planes_overhead', 'night_sky', 'satellites', 'sky_view', 'recall_memory', 'list_memories', 'ask_ragator', 'calendar', 'tasks', 'system_monitor', 'end_session',
];

const GOODBYE = /^(merci( jarvis| beaucoup)?|c'?est tout|ce sera tout|au revoir|a bientot|stop|ca ira|termine)\b/;
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Que faire d'une phrase transcrite ? (pur, testable) */
export function interpretUtterance(text, { conversation, wakeWord }) {
  const t = String(text || '').trim();
  if (!t) return { wake: conversation, command: '' };
  if (conversation) return { wake: true, command: t, goodbye: GOODBYE.test(fold(t)) };
  const m = matchWakeWord(t, wakeWord);
  return m.matched ? { wake: true, command: m.command, goodbye: false } : { wake: false, command: '' };
}

export class SatelliteBridge {
  constructor(engine) {
    this.engine = engine;
    this.off = null;
  }

  get cfg() { return configStore.get(); }

  /** Reconnaissance locale réglée ? Condition pour écouter le mot d'éveil. */
  localSttReady() {
    return this.cfg.sttEngine === 'local' && Boolean(this.cfg.speechBaseUrl);
  }

  async _key() {
    return this.engine.localVoice?._key ? this.engine.localVoice._key() : '';
  }

  attach() {
    this.detach();
    this.off = hostBridge.onSatelliteUtterance((req) => this.handle(req));
    hostBridge.satellites('wake', { available: this.localSttReady() });
    this._unsub = configStore.subscribe(() => hostBridge.satellites('wake', { available: this.localSttReady() }));
  }

  detach() {
    this.off?.();
    this.off = null;
    this._unsub?.();
    this._unsub = null;
  }

  async transcribePcm(pcm, conversation) {
    const cfg = this.cfg;
    if (this.localSttReady()) {
      const r = await transcribe({ baseUrl: cfg.speechBaseUrl, apiKey: await this._key(), model: cfg.sttLocalModel, bytes: wavFromPcm(pcm), filename: 'satellite.wav', mime: 'audio/wav', language: cfg.sttLanguage || '' });
      return r.ok ? { text: r.text } : { error: r.error };
    }
    if (!conversation) return { unavailable: true };
    const key = configStore.getActiveApiKey();
    if (!key) return { error: 'Aucune reconnaissance vocale disponible (ni serveur local, ni clé Gemini).' };
    const r = await geminiTranscribe({ apiKey: key, wav: wavFromPcm(pcm) });
    return r.ok ? { text: r.text } : { error: r.error };
  }

  /** Texte → PCM 16 kHz, avec le moteur de voix choisi (serveur local, ElevenLabs ou Gemini). */
  async speakPcm(text) {
    const cfg = this.cfg;
    const t = String(text || '').replace(/```[\s\S]*?```/g, ' ').replace(/[*#_`~•]/g, ' ').replace(/https?:\/\/\S+/g, 'lien web').replace(/\s+/g, ' ').trim().slice(0, 1500);
    if (!t) return null;
    if (cfg.ttsEngine === 'local' || cfg.ttsEngine === 'elevenlabs') {
      const eleven = cfg.ttsEngine === 'elevenlabs';
      const r = await synthesize({ engine: eleven ? 'elevenlabs' : 'openai', baseUrl: cfg.speechBaseUrl || SPEECH_DEFAULTS.baseUrl, apiKey: await this._key(), model: eleven ? cfg.elevenModel : cfg.ttsLocalModel, voice: eleven ? cfg.elevenVoiceId : cfg.ttsLocalVoice, input: t, format: 'pcm' });
      if (r.ok) return resampleS16(r.bytes, r.rate, 16000);
    }
    const key = configStore.getActiveApiKey();
    if (!key) return null;
    const r = await geminiSpeak({ apiKey: key, voice: cfg.voiceName || 'Aoede', input: t });
    return r.ok ? resampleS16(r.bytes, r.rate, 16000) : null;
  }

  async handle({ requestId, satelliteId, name, pcm, conversation }) {
    let result = {};
    try {
      const raw = Uint8Array.from(atob(pcm), (c) => c.charCodeAt(0));
      const heard = await this.transcribePcm(raw, conversation);
      if (heard.unavailable) result = { unavailable: true };
      else if (heard.error) {
        this.engine.cb.onStatusText?.(`Satellite ${name} : ${heard.error}`);
        if (conversation) result = { reply: await this._say('Je n’ai pas pu comprendre, peux-tu répéter ?') };
      } else {
        const turn = interpretUtterance(heard.text, { conversation, wakeWord: this.cfg.wakeWord });
        if (!turn.wake) result = { wake: false };
        else if (!turn.command) result = conversation ? { wake: true } : { wake: true, reply: await this._say('Oui ?') };
        else if (turn.goodbye) result = { wake: true, reply: await this._say('À bientôt.'), close: true };
        else {
          this.engine.cb.onMessage?.({ id: `u_${Date.now()}`, role: 'user', text: `[${name}] ${turn.command}`, timestamp: Date.now() });
          const answer = await this.engine.answerText(turn.command, { allow: SATELLITE_TOOLS, profile: null });
          result = { wake: true, reply: await this._say(answer || 'Je n’ai pas de réponse.') };
        }
      }
    } catch (err) {
      this.engine.cb.onStatusText?.(`Satellite ${name} : ${err?.message || err}`);
    }
    const out = { wake: Boolean(result.wake), close: Boolean(result.close), unavailable: Boolean(result.unavailable) };
    if (result.reply?.length) out.reply = btoa(this._b64(result.reply));
    hostBridge.satellites('result', { requestId, result: out });
  }

  _b64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return bin;
  }

  async _say(text) {
    return this.speakPcm(text);
  }
}
