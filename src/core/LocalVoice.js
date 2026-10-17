// Voix hors Gemini : écoute (Whisper local ou navigateur), parole (serveur local / ElevenLabs), mot d'éveil.
// Utilisé par JarvisEngine ; chaque méthode échoue en douceur et dit pourquoi, sans jamais bloquer le moteur.
import { configStore } from './ConfigStore.js';
import { hostBridge } from './hostBridge.js';
import { transcribe, synthesize, SPEECH_DEFAULTS } from '../llm/speech.js';
import { matchWakeWord, isEcho, WAKE_SLEEP_MS } from '../audio/voiceGuards.js';

const SILENCE_RMS = 0.015;

export class LocalVoice {
  constructor(engine) {
    this.engine = engine;
    this.wakeRec = null;
    this.wakeTimer = null;
    this.listening = false;
    this.speechKey = '';
    this._keyLoaded = false;
  }

  async _key() {
    if (!this._keyLoaded) {
      this.speechKey = (await hostBridge.getSecret('speechKey', '')) || configStore.get().speechKey || '';
      this._keyLoaded = true;
    }
    return this.speechKey;
  }

  setKey(value) {
    this.speechKey = String(value || '');
    this._keyLoaded = true;
    hostBridge.setSecret('speechKey', this.speechKey);
  }

  get cfg() {
    return configStore.get();
  }

  usesLocalTts() {
    return ['local', 'elevenlabs'].includes(this.cfg.ttsEngine);
  }

  usesLocalStt() {
    return this.cfg.sttEngine === 'local';
  }

  /** Parle avec le moteur choisi. Retourne true si la voix a été jouée. */
  async speak(text) {
    const cfg = this.cfg;
    const eleven = cfg.ttsEngine === 'elevenlabs';
    const res = await synthesize({
      engine: eleven ? 'elevenlabs' : 'openai',
      baseUrl: cfg.speechBaseUrl || SPEECH_DEFAULTS.baseUrl,
      apiKey: await this._key(),
      model: eleven ? cfg.elevenModel : cfg.ttsLocalModel,
      voice: eleven ? cfg.elevenVoiceId : cfg.ttsLocalVoice,
      input: text,
    });
    if (!res.ok) {
      this.engine.cb.onStatusText?.(res.error);
      return false;
    }
    const ctx = (this.engine.audioCtx = this.engine.audioCtx || new (window.AudioContext || window.webkitAudioContext)());
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    const buffer = await ctx.decodeAudioData(res.bytes.buffer.slice(res.bytes.byteOffset, res.bytes.byteOffset + res.bytes.byteLength));
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    analyser.connect(ctx.destination);
    this.engine.activeTtsSource = src;
    this.engine._setState('SPEAKING', 'Voix locale');
    const data = new Float32Array(analyser.fftSize);
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += v * v;
      const level = Math.min(1, Math.sqrt(sum / data.length) * 5);
      this.engine.cb.onAudioLevel?.(level);
      this.engine.cb.onViseme?.({ jaw: level * 0.8, open: level, width: 0.3 + level * 0.3, wide: level * 0.4, level });
    }, 20);
    src.onended = () => {
      clearInterval(timer);
      if (this.engine.activeTtsSource === src) this.engine.activeTtsSource = null;
      this.engine.stopSpeaking();
    };
    src.start();
    return true;
  }

  /** Enregistre une phrase (coupe après un silence) et la fait transcrire. Retourne le texte, ou ''. */
  async listenOnce({ maxMs = 30000, silenceMs = 1300 } = {}) {
    if (this.listening) return '';
    this.listening = true;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const rec = new MediaRecorder(stream);
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const stopped = new Promise((r) => { rec.onstop = r; });
      rec.start();
      const data = new Float32Array(analyser.fftSize);
      const started = Date.now();
      let lastVoice = 0;
      await new Promise((resolve) => {
        const tick = setInterval(() => {
          analyser.getFloatTimeDomainData(data);
          let sum = 0;
          for (const v of data) sum += v * v;
          const rms = Math.sqrt(sum / data.length);
          this.engine.cb.onAudioLevel?.(Math.min(1, rms * 6));
          const now = Date.now();
          if (rms > SILENCE_RMS) lastVoice = now;
          const heardSomething = lastVoice > 0;
          if (now - started > maxMs || (heardSomething && now - lastVoice > silenceMs) || (!heardSomething && now - started > 8000)) {
            clearInterval(tick);
            resolve();
          }
        }, 80);
        this._stopListening = () => { clearInterval(tick); resolve(); };
      });
      if (rec.state !== 'inactive') rec.stop();
      await stopped;
      ctx.close().catch(() => {});
      if (!lastVoice) return '';
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      const res = await transcribe({
        baseUrl: this.cfg.speechBaseUrl || SPEECH_DEFAULTS.baseUrl,
        apiKey: await this._key(),
        model: this.cfg.sttLocalModel,
        bytes: new Uint8Array(await blob.arrayBuffer()),
        mime: blob.type || 'audio/webm',
        language: this.cfg.sttLanguage || '',
      });
      if (!res.ok) {
        this.engine.cb.onStatusText?.(res.error);
        return '';
      }
      return res.text;
    } catch (err) {
      this.engine.cb.onStatusText?.(`Micro indisponible : ${err?.message || err}`);
      return '';
    } finally {
      this.listening = false;
      this._stopListening = null;
      stream?.getTracks().forEach((t) => t.stop());
    }
  }

  stopListening() {
    this._stopListening?.();
  }

  /** Mot d'éveil local : le navigateur n'écoute que pour reconnaître le mot, le moteur ne reçoit rien avant. */
  startWake() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec || this.wakeRec) return Boolean(this.wakeRec);
    const rec = new SpeechRec();
    rec.lang = 'fr-FR';
    rec.continuous = true;
    rec.interimResults = false;
    this.wakeRec = rec;
    const armSleep = () => {
      clearTimeout(this.wakeTimer);
      this.wakeTimer = setTimeout(() => {
        this.stopWake();
        this.engine.cb.onStatusText?.('Veille : dites « Hey ' + (this.cfg.wakeWord || 'jarvis') + ' » pour me réveiller.');
      }, WAKE_SLEEP_MS);
    };
    rec.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      const transcript = last?.[0]?.transcript || '';
      if (isEcho(transcript, this.engine.lastSpoken)) return;
      const { matched, command } = matchWakeWord(transcript, this.cfg.wakeWord);
      if (!matched) return;
      armSleep();
      if (command) this.engine.sendUserMessage(command, { speakReply: true });
      else this.engine.startVoiceRecognition();
    };
    rec.onerror = () => {};
    rec.onend = () => {
      if (this.wakeRec === rec) {
        try { rec.start(); } catch { this.wakeRec = null; }
      }
    };
    try {
      rec.start();
      armSleep();
      return true;
    } catch {
      this.wakeRec = null;
      return false;
    }
  }

  stopWake() {
    clearTimeout(this.wakeTimer);
    const rec = this.wakeRec;
    this.wakeRec = null;
    try { rec?.stop(); } catch { /* déjà arrêté */ }
  }
}
