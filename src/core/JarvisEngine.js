// Port of JarvisEngine.kt, GeminiLiveClient.kt, RestChat.kt, ModelLadder.kt, and OfflineIntents.kt
// Supports:
// 1. Gemini Live bidirectional WebSocket (16kHz PCM in, 24kHz PCM out + real-time F1/F2 formant 3D lip-sync + tool calling)
// 2. Gemini REST generateContent with automatic ModelLadder fallback + 3-key rotation + tool loop
// 3. Offline / Local Intent Engine that works immediately even without an API key

import { configStore, REST_MODELS, VOICE_PROFILES, DEFAULT_TTS_MODEL } from './ConfigStore.js';
import { dataStore } from './DataStore.js';
import { hostBridge } from './hostBridge.js';
import { pluginEngine } from './PluginEngine.js';
import { textToVisemes, VISEMES, pcmVisemes, VisemeStream } from '../avatar/Visemes.js';

const LIVE_WS_ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

const LIVE_MODEL_FALLBACKS = [
  'models/gemini-2.5-flash-native-audio-preview-12-2025',
  'models/gemini-3.1-flash-live-preview',
  'models/gemini-2.0-flash-live-001',
];

export class JarvisEngine {
  constructor(toolRegistry, callbacks = {}) {
    this.tools = toolRegistry;
    this.cb = callbacks; // { onStateChange, onMessage, onViseme, onAudioLevel, onStatusText }
    this.state = 'IDLE'; // 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING'
    this.ws = null;
    this.wsReady = false;
    this.wsVoice = null;
    this.wsModel = null;
    this.wsKey = null;
    this.connectingPromise = null;
    this.micActive = false;
    this.audioCtx = null;
    this.micStream = null;
    this.micProcessor = null;
    this.nextPlayTime = 0;
    this.liveAudioSources = [];
    this.liveVisemeQueue = [];
    this.scheduledVisemeChunks = [];
    this.liveVisemeStream = new VisemeStream();
    this.liveVisemeTimer = null;
    this.currentAssistantTurnId = null;
    this.currentUserTurnId = null;
    this.suppressNextLiveTranscript = false;
    this.recognition = null;
    this.ttsTimer = null;
    this.chatHistory = [];

    // Reconnect Gemini Live automatically whenever voiceName or API key changes
    this._unsubConfig = configStore.subscribe((cfg) => {
      const activeKey = configStore.getActiveApiKey();
      if (this.ws && (this.wsVoice !== cfg.voiceName || this.wsKey !== activeKey)) {
        this._closeLiveSocketOnly();
        if (activeKey && cfg.voiceMode !== 'offline') {
          this.ensureLiveSession(cfg.voiceName).catch(() => {});
        }
      }
    });
  }

  setCallbacks(cb) {
    this.cb = { ...this.cb, ...cb };
  }

  _setState(next, statusText = '') {
    this.state = next;
    this.cb.onStateChange?.(next, statusText);
  }

  buildSystemPrompt() {
    const cfg = configStore.get();
    const mems = dataStore.get().memories || [];
    const nowStr = new Date().toLocaleString('fr-FR', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const memBlock = mems.length
      ? '\nMémoire utilisateur :\n' + mems.map((m) => `- ${m.key}: ${m.value}`).join('\n')
      : '';
    return (
      `Tu es Jarvis 2.0, un assistant personnel intelligent sur PC (Windows / Desktop autonome). ` +
      `Tu parles en français de manière naturelle, concise, chaleureuse et efficace. ` +
      `Date et heure actuelles : ${nowStr}. Ville de l'utilisateur : ${cfg.userCity || 'Bordeaux'}. ` +
      `Tu disposes d'outils complets pour contrôler le PC (applications, souris, clavier, fenêtres, volume, luminosité, capture d'écran, webcam, fichiers, documents PDF/Word/Excel, Obsidian), ` +
      `afficher la carte du monde, l'ISS et la voûte céleste, lancer la radio en direct, des podcasts ou des vidéos YouTube, ` +
      `gérer l'agenda, les tâches, les dépenses, les habitudes, et exécuter 82 plugins JSON spécialisés.` +
      memBlock +
      (cfg.customPrompt ? `\nInstructions personnalisées : ${cfg.customPrompt}` : '')
    );
  }

  // ── Text & Voice Turn Entry Point ──────────────────────────────────────────

  async sendUserMessage(text, { speakReply = true, imageBase64 = null } = {}) {
    const clean = String(text || '').trim();
    if (!clean) return;

    this.stopSpeaking();
    this.cb.onMessage?.({
      id: `u_${Date.now()}`,
      role: 'user',
      text: clean,
      timestamp: Date.now(),
    });

    this._setState('THINKING', 'Analyse de la demande...');

    const apiKey = configStore.getActiveApiKey();
    const mode = configStore.get().voiceMode;

    // 1. Always prefer Gemini Live WebSocket (even when microphone is NOT active!) so the response
    //    is spoken with the real Gemini Live 24 kHz voice (Aoede, Kore, Fenrir, Puck, etc.)
    if (apiKey && mode !== 'offline' && !imageBase64) {
      const liveReady = await this.ensureLiveSession();
      if (liveReady && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.suppressNextLiveTranscript = false;
        this.currentAssistantTurnId = null;
        this.ws.send(
          JSON.stringify({
            clientContent: {
              turns: [{ role: 'user', parts: [{ text: clean }] }],
              turnComplete: true,
            },
          })
        );
        return;
      }
    }

    // 2. Try Gemini REST with ModelLadder if API key is configured and not forced offline
    if (apiKey && mode !== 'offline') {
      try {
        const reply = await this._runRestWithLadder(clean, imageBase64);
        this._deliverAssistantReply(reply, speakReply);
        return;
      } catch (err) {
        console.warn('REST fallback to local engine:', err);
      }
    }

    // 3. Local / Offline Intent Engine (works 100% without API key!)
    const localReply = await this._runLocalIntent(clean);
    this._deliverAssistantReply(localReply, speakReply);
  }

  _deliverAssistantReply(replyText, speak = true) {
    const text = String(replyText || 'Action effectuée.').trim();
    this.cb.onMessage?.({
      id: `a_${Date.now()}`,
      role: 'assistant',
      text,
      timestamp: Date.now(),
    });

    if (speak && configStore.get().ttsEnabled) {
      this.speakTextWithLipSync(text);
    } else {
      this._setState(this.micActive ? 'LISTENING' : 'IDLE', this.micActive ? 'À l’écoute...' : 'Prêt');
    }
  }

  // ── Speech Synthesis (Gemini Live 24kHz -> Gemini TTS 24kHz -> Offline Profile) ──

  async speakTextWithLipSync(text, voiceOverride = null) {
    this.stopSpeaking();
    const cleanForSpeech = String(text || '')
      .replace(/```[\s\S]*?```/g, 'Code affiché à l’écran.')
      .replace(/[*#_`~•]/g, ' ')
      .replace(/https?:\/\/\S+/g, 'lien web')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1800);

    if (!cleanForSpeech) {
      this._setState(this.micActive ? 'LISTENING' : 'IDLE', 'Prêt');
      return;
    }

    const cfg = configStore.get();
    const voiceName = voiceOverride || cfg.voiceName || 'Aoede';
    const profile = VOICE_PROFILES[voiceName] || { gender: 'female', pitch: 1.0, rate: 1.05, idx: 0 };
    const apiKey = configStore.getActiveApiKey();

    // 1. Even when the microphone is NOT active, use Gemini Live WebSocket first!
    if (apiKey && cfg.voiceMode !== 'offline') {
      try {
        this._setState('SPEAKING', `Gemini Live (${voiceName})...`);
        const liveReady = await this.ensureLiveSession(voiceName);
        if (liveReady && this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.suppressNextLiveTranscript = true;
          this.currentAssistantTurnId = null;
          this.liveVisemeStream.reset();
          this.liveVisemeStream.feedText(cleanForSpeech);
          this.ws.send(
            JSON.stringify({
              clientContent: {
                turns: [
                  {
                    role: 'user',
                    parts: [
                      {
                        text: `[Lis exactement cette phrase à voix haute en français, sans ajouter aucun autre mot ni commentaire : "${cleanForSpeech}"]`,
                      },
                    ],
                  },
                ],
                turnComplete: true,
              },
            })
          );
          return;
        }
      } catch {
        // Fall through to Gemini REST TTS
      }

      // 2. Fallback to Gemini 24 kHz REST TTS (models/gemini-2.5-flash-preview-tts)
      try {
        this._setState('SPEAKING', `Synthèse vocale Gemini (${voiceName})...`);
        const ttsModel = cfg.ttsModel || DEFAULT_TTS_MODEL;
        const modelPath = ttsModel.startsWith('models/') ? ttsModel : `models/${ttsModel}`;
        const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const body = {
          contents: [{ role: 'user', parts: [{ text: cleanForSpeech }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName },
              },
            },
          },
        };
        const res = await hostBridge.httpFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          timeoutMs: 12000,
        });
        const inline = res.json?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
        if (res.ok && inline?.data) {
          this._playFullTtsPcm24k(inline.data, voiceName, cleanForSpeech);
          return;
        }
      } catch {
        // Fall through to local PC voice synthesis with acoustic profile
      }
    }

    // 3. Offline / Local PC Speech Synthesis (only when no API key or offline mode)
    this._setState('SPEAKING', `Voix hors ligne (${voiceName})...`);
    const words = cleanForSpeech.split(/\s+/).filter(Boolean);
    const frames = [];
    const wordFrameStart = [];
    let charPos = 0;

    for (const w of words) {
      const foundPos = cleanForSpeech.indexOf(w, charPos);
      const startChar = foundPos >= 0 ? foundPos : charPos;
      wordFrameStart.push({ charIndex: startChar, frameIndex: frames.length });
      charPos = startChar + w.length;

      const wPairs = textToVisemes(w);
      for (const [vKey, dur] of wPairs) {
        if (vKey === 'REST') continue;
        const shape = VISEMES[vKey] || VISEMES.REST;
        const count = Math.max(2, Math.round((dur || 1) * 3.1));
        for (let k = 0; k < count; k++) {
          const env = Math.sin(((k + 0.5) / count) * Math.PI);
          const openVal = shape.open * (1 - (shape.closure || 0)) * (0.65 + 0.35 * env);
          frames.push({
            jaw: openVal,
            open: openVal,
            width: shape.wide,
            wide: shape.wide,
            level: shape.closure >= 0.9 ? 0.05 : Math.max(0.15, openVal),
          });
        }
      }
      // Subtle syllable closure between words
      frames.push({ jaw: 0.04, open: 0.04, width: 0, wide: 0, level: 0.06 });
    }
    frames.push({ jaw: 0, open: 0, width: 0, wide: 0, level: 0 });

    let idx = 0;
    const effRate = Math.max(0.75, Math.min(1.45, (profile.rate || 1.0) * (cfg.speechRate || 1.0)));
    const stepMs = Math.max(16, Math.round(24 / effRate));
    this.ttsTimer = setInterval(() => {
      if (idx < frames.length) {
        const v = frames[idx++];
        this.cb.onViseme?.(v);
        this.cb.onAudioLevel?.(Math.min(1, (v.level ?? v.open) * 0.95));
      } else {
        this.stopSpeaking();
      }
    }, stepMs);

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(cleanForSpeech);
        utter.lang = 'fr-FR';
        utter.pitch = profile.pitch;
        utter.rate = effRate;

        const allVoices = window.speechSynthesis.getVoices() || [];
        const frVoices = allVoices.filter((v) => /^fr/i.test(v.lang));
        if (frVoices.length > 0) {
          const maleHint = /paul|henri|claude|thomas|mathieu|antoine|nicolas|male|homme|david|mark/i;
          const femaleHint = /hortense|julie|denise|eloise|amelie|amélie|brigitte|celeste|female|femme|zira/i;
          const genderPool = frVoices.filter((v) =>
            profile.gender === 'male' ? maleHint.test(v.name) : femaleHint.test(v.name)
          );
          const pool = genderPool.length > 0 ? genderPool : frVoices;
          utter.voice = pool[(profile.idx || 0) % pool.length];
        }

        // Lock viseme cursor to OS SpeechSynthesis word boundaries for tight lip-sync
        utter.onboundary = (ev) => {
          if (typeof ev.charIndex === 'number' && wordFrameStart.length > 0) {
            let best = wordFrameStart[0].frameIndex;
            for (const wf of wordFrameStart) {
              if (wf.charIndex <= ev.charIndex + 1) best = wf.frameIndex;
              else break;
            }
            idx = best;
          }
        };
        utter.onend = () => this.stopSpeaking();
        utter.onerror = () => this.stopSpeaking();
        window.speechSynthesis.speak(utter);
      } catch {
        // Timer will finish naturally
      }
    }
  }

  _playFullTtsPcm24k(b64, voiceName = 'Aoede', transcriptText = '') {
    try {
      this.audioCtx = this.audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const pcm16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768.0;

      const rawFrames = pcmVisemes(float32, 24000);
      const stream = new VisemeStream();
      if (transcriptText) stream.feedText(transcriptText);
      const visFrames = transcriptText ? stream.frames(rawFrames, 0.02) : rawFrames;

      this._setState('SPEAKING', `Jarvis parle (${voiceName} • 24 kHz)...`);

      const audioBuffer = this.audioCtx.createBuffer(1, float32.length, 24000);
      audioBuffer.getChannelData(0).set(float32);
      const src = this.audioCtx.createBufferSource();
      src.buffer = audioBuffer;
      src.connect(this.audioCtx.destination);
      this.activeTtsSource = src;
      const startAt = this.audioCtx.currentTime;

      this.ttsTimer = setInterval(() => {
        if (!this.audioCtx) {
          this.stopSpeaking();
          return;
        }
        const elapsed = this.audioCtx.currentTime - startAt;
        const fIdx = Math.floor(elapsed / 0.02);
        if (fIdx >= 0 && fIdx < visFrames.length) {
          const vf = visFrames[fIdx];
          this.cb.onViseme?.({ jaw: vf.open, open: vf.open, width: vf.wide, wide: vf.wide, level: vf.level });
          this.cb.onAudioLevel?.(Math.min(1, (vf.level || vf.open || 0) * 0.95));
        } else if (elapsed > audioBuffer.duration + 0.05) {
          this.stopSpeaking();
        }
      }, 16);

      src.onended = () => this.stopSpeaking();
      src.start(startAt);
    } catch {
      this.stopSpeaking();
    }
  }

  stopSpeaking() {
    if (this.ttsTimer) {
      clearInterval(this.ttsTimer);
      this.ttsTimer = null;
    }
    if (this.activeTtsSource) {
      try {
        this.activeTtsSource.stop();
      } catch {
        // ignore
      }
      this.activeTtsSource = null;
    }
    this._flushLiveAudio();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
    this.cb.onViseme?.({ jaw: 0, open: 0, width: 0, wide: 0, level: 0 });
    this.cb.onAudioLevel?.(0);
    if (this.state === 'SPEAKING') {
      this._setState(this.micActive ? 'LISTENING' : 'IDLE', this.micActive ? 'À l’écoute...' : 'Prêt');
    }
  }

  _flushLiveAudio() {
    if (this.liveVisemeTimer) {
      clearInterval(this.liveVisemeTimer);
      this.liveVisemeTimer = null;
    }
    this.liveVisemeQueue = [];
    this.scheduledVisemeChunks = [];
    this.liveVisemeStream?.reset();
    if (this.liveAudioSources && this.liveAudioSources.length > 0) {
      for (const s of this.liveAudioSources) {
        try {
          s.stop();
        } catch {
          // ignore
        }
      }
      this.liveAudioSources = [];
    }
    this.nextPlayTime = 0;
  }

  // ── Gemini REST ModelLadder + Tool Calling Loop ────────────────────────────

  async _runRestWithLadder(userText, imageBase64 = null) {
    const cfg = configStore.get();
    const ladder = [
      cfg.restModel || 'models/gemini-2.5-flash',
      ...REST_MODELS.map((m) => m.id).filter((id) => id !== cfg.restModel),
    ];

    const parts = [{ text: userText }];
    if (imageBase64) {
      const cleanB64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: cleanB64 } });
    }
    this.chatHistory.push({ role: 'user', parts });
    if (this.chatHistory.length > 20) {
      this.chatHistory = this.chatHistory.slice(-20);
    }

    let lastErr = null;
    for (const modelId of ladder) {
      const modelPath = modelId.startsWith('models/') ? modelId : `models/${modelId}`;
      const apiKey = configStore.getActiveApiKey();
      if (!apiKey) break;

      const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const body = {
        systemInstruction: { parts: [{ text: this.buildSystemPrompt() }] },
        contents: this.chatHistory,
        tools: [{ functionDeclarations: this.tools.getDeclarations() }],
        generationConfig: { temperature: 0.4 },
      };

      const res = await hostBridge.httpFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        timeoutMs: 18000,
      });

      if (res.status === 429 || res.status === 403) {
        configStore.rotateApiKey();
        lastErr = new Error(`Quota dépassé sur ${modelPath}`);
        continue;
      }

      if (!res.ok || !res.json?.candidates?.[0]?.content) {
        lastErr = new Error(`Erreur HTTP ${res.status} sur ${modelPath}`);
        continue;
      }

      let candidateContent = res.json.candidates[0].content;
      this.chatHistory.push(candidateContent);

      // Handle up to 4 tool call turns
      for (let hop = 0; hop < 4; hop++) {
        const fnCalls = (candidateContent.parts || [])
          .map((p) => p.functionCall)
          .filter(Boolean);
        if (!fnCalls.length) break;

        const responseParts = [];
        for (const fc of fnCalls) {
          this._setState('THINKING', `Exécution : ${fc.name}...`);
          const toolResult = await this.tools.execute(fc.name, fc.args || {});
          this.cb.onToolExecuted?.(fc.name, fc.args, toolResult);
          responseParts.push({
            functionResponse: {
              name: fc.name,
              response: { result: toolResult },
            },
          });
        }

        this.chatHistory.push({ role: 'user', parts: responseParts });
        const followRes = await hostBridge.httpFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: this.buildSystemPrompt() }] },
            contents: this.chatHistory,
            tools: [{ functionDeclarations: this.tools.getDeclarations() }],
          }),
          timeoutMs: 18000,
        });
        if (!followRes.ok || !followRes.json?.candidates?.[0]?.content) break;
        candidateContent = followRes.json.candidates[0].content;
        this.chatHistory.push(candidateContent);
      }

      const finalText = (candidateContent.parts || [])
        .map((p) => p.text)
        .filter(Boolean)
        .join('\n')
        .trim();
      return finalText || 'Action exécutée.';
    }

    throw lastErr || new Error('Aucun modèle REST disponible');
  }

  // ── Gemini Live Bidirectional WebSocket Session (Always-On for Text & Mic) ──

  async ensureLiveSession(voiceOverride = null) {
    const cfg = configStore.get();
    if (cfg.voiceMode === 'offline') return false;
    const apiKey = configStore.getActiveApiKey();
    if (!apiKey) return false;

    const targetVoice = voiceOverride || cfg.voiceName || 'Aoede';

    // Already connected and ready with the right voice & key
    if (
      this.ws &&
      this.ws.readyState === WebSocket.OPEN &&
      this.wsReady &&
      this.wsVoice === targetVoice &&
      this.wsKey === apiKey
    ) {
      return true;
    }

    // Close stale socket if voice or key changed
    if (this.ws && (this.wsVoice !== targetVoice || this.wsKey !== apiKey || !this.wsReady)) {
      this._closeLiveSocketOnly();
    }

    if (this.connectingPromise) {
      return this.connectingPromise;
    }

    this.connectingPromise = (async () => {
      try {
        const preferredModel = cfg.liveModel || 'models/gemini-2.5-flash-native-audio-preview-12-2025';
        const candidates = [
          preferredModel,
          ...LIVE_MODEL_FALLBACKS.filter((m) => m !== preferredModel),
        ];

        for (const modelId of candidates) {
          const ok = await this._connectLiveSocketOnce(apiKey, modelId, targetVoice);
          if (ok) return true;
        }

        // Try rotating API key if another key slot is configured
        if (configStore.rotateApiKey()) {
          const nextKey = configStore.getActiveApiKey();
          for (const modelId of candidates) {
            const ok = await this._connectLiveSocketOnce(nextKey, modelId, targetVoice);
            if (ok) return true;
          }
        }
        return false;
      } finally {
        this.connectingPromise = null;
      }
    })();

    return this.connectingPromise;
  }

  _connectLiveSocketOnce(apiKey, rawModelId, voiceName) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(ok);
        }
      };

      const modelId = rawModelId.startsWith('models/') ? rawModelId : `models/${rawModelId}`;
      const wsUrl = `${LIVE_WS_ENDPOINT}?key=${encodeURIComponent(apiKey)}`;
      let ws;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        finish(false);
        return;
      }

      const timer = setTimeout(() => {
        if (!settled) {
          try {
            ws.close();
          } catch {}
          finish(false);
        }
      }, 7000);

      ws.onopen = () => {
        const setupFrame = {
          setup: {
            model: modelId,
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: voiceName || 'Aoede',
                  },
                },
              },
            },
            systemInstruction: {
              parts: [{ text: this.buildSystemPrompt() }],
            },
            tools: [{ functionDeclarations: this.tools.getDeclarations() }],
            outputAudioTranscription: {},
            inputAudioTranscription: {},
          },
        };
        try {
          ws.send(JSON.stringify(setupFrame));
        } catch {
          finish(false);
        }
      };

      ws.onmessage = async (event) => {
        let textData = event.data;
        if (textData instanceof Blob) {
          textData = await textData.text();
        }
        let msg;
        try {
          msg = JSON.parse(textData);
        } catch {
          return;
        }

        // 1. Handshake setupComplete
        if (msg.setupComplete !== undefined) {
          this.ws = ws;
          this.wsReady = true;
          this.wsVoice = voiceName;
          this.wsModel = modelId;
          this.wsKey = apiKey;
          finish(true);
          return;
        }

        // 2. Server Content (24kHz Audio, Transcriptions, Interruption, TurnComplete)
        const sc = msg.serverContent;
        if (sc) {
          if (sc.interrupted) {
            this._flushLiveAudio();
          }

          // Input speech transcription (when microphone is active)
          const inText = sc.inputTranscription?.text;
          if (inText) {
            if (!this.currentUserTurnId) {
              this.currentUserTurnId = `u_live_${Date.now()}`;
            }
            this.cb.onMessage?.({
              id: this.currentUserTurnId,
              role: 'user',
              text: inText,
              append: true,
              timestamp: Date.now(),
            });
          }

          // Output speech transcription from Gemini Live
          const outText = sc.outputTranscription?.text;
          if (outText) {
            this.liveVisemeStream?.feedText(outText);
            if (!this.suppressNextLiveTranscript) {
              if (!this.currentAssistantTurnId) {
                this.currentAssistantTurnId = `a_live_${Date.now()}`;
              }
              this.cb.onMessage?.({
                id: this.currentAssistantTurnId,
                role: 'assistant',
                text: outText,
                append: true,
                timestamp: Date.now(),
              });
            }
          }

          // Incoming 24kHz PCM audio chunks
          const parts = sc.modelTurn?.parts || [];
          for (const p of parts) {
            if (p.inlineData?.data) {
              this._playPcm24kBase64(p.inlineData.data);
            } else if (p.text) {
              if (!outText) this.liveVisemeStream?.feedText(p.text);
              if (!outText && !this.suppressNextLiveTranscript) {
                if (!this.currentAssistantTurnId) {
                  this.currentAssistantTurnId = `a_live_${Date.now()}`;
                }
                this.cb.onMessage?.({
                  id: this.currentAssistantTurnId,
                  role: 'assistant',
                  text: p.text,
                  append: true,
                  timestamp: Date.now(),
                });
              }
            }
          }

          if (sc.turnComplete) {
            this.currentAssistantTurnId = null;
            this.currentUserTurnId = null;
            this.suppressNextLiveTranscript = false;
            if (this.liveVisemeQueue.length === 0 && this.state === 'THINKING') {
              this._setState(
                this.micActive ? 'LISTENING' : 'IDLE',
                this.micActive ? `Gemini Live à l’écoute (${this.wsVoice})` : `Gemini Live prêt (${this.wsVoice})`
              );
            }
          }
        }

        // 3. Tool calls from Gemini Live
        const fnCalls = msg.toolCall?.functionCalls || [];
        if (fnCalls.length > 0) {
          this._setState('THINKING', `Exécution d’action (${fnCalls[0].name})...`);
          const functionResponses = [];
          for (const fc of fnCalls) {
            const result = await this.tools.execute(fc.name, fc.args || {});
            this.cb.onToolExecuted?.(fc.name, fc.args, result);
            functionResponses.push({
              id: fc.id,
              name: fc.name,
              response: { result: typeof result === 'string' ? result : JSON.stringify(result) },
            });
          }
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ toolResponse: { functionResponses } }));
          }
        }
      };

      ws.onerror = () => {
        finish(false);
      };

      ws.onclose = () => {
        if (this.ws === ws) {
          this.ws = null;
          this.wsReady = false;
        }
        finish(false);
      };
    });
  }

  _closeLiveSocketOnly() {
    if (this.ws) {
      const old = this.ws;
      this.ws = null;
      this.wsReady = false;
      try {
        old.close();
      } catch {
        // ignore
      }
    }
  }

  async startLiveSession() {
    const apiKey = configStore.getActiveApiKey();
    if (!apiKey || configStore.get().voiceMode === 'offline') {
      return this.startVoiceRecognition();
    }

    this._setState('LISTENING', 'Connexion au microphone Gemini Live...');
    const ready = await this.ensureLiveSession();
    if (!ready) {
      return this.startVoiceRecognition();
    }

    this.micActive = true;
    await this._startMicPcmStream();
    this._setState('LISTENING', `Microphone Gemini Live actif (${this.wsVoice})`);
  }

  stopLiveSession() {
    // Stop microphone capture & current speech, while keeping the Gemini Live WebSocket ready for text & TTS!
    this.micActive = false;
    this._stopMicPcmStream();
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // ignore
      }
      this.recognition = null;
    }
    this.stopSpeaking();
    this._setState(
      'IDLE',
      this.wsReady ? `Gemini Live prêt (${this.wsVoice})` : 'Prêt'
    );
  }

  async _startMicPcmStream() {
    try {
      this._stopMicPcmStream();
      this.audioCtx = this.audioCtx || new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume().catch(() => {});
      }
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const source = this.audioCtx.createMediaStreamSource(this.micStream);
      const processor = this.audioCtx.createScriptProcessor(4096, 1, 1);
      this.micProcessor = processor;

      processor.onaudioprocess = (e) => {
        if (!this.micActive || !this.ws || this.ws.readyState !== WebSocket.OPEN || !this.wsReady) return;
        // Half-duplex protection: while Jarvis is speaking out loud, do not feed speaker echo back into the mic
        if (this.state === 'SPEAKING' || this.liveVisemeQueue.length > 0) return;

        const input = e.inputBuffer.getChannelData(0);
        const inRate = e.inputBuffer.sampleRate || 16000;
        const ratio = inRate / 16000;
        const outLen = Math.floor(input.length / ratio);
        const pcm16 = new Int16Array(outLen);
        let sumSq = 0;
        for (let i = 0; i < outLen; i++) {
          const s = Math.max(-1, Math.min(1, input[Math.floor(i * ratio)]));
          sumSq += s * s;
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        const rms = Math.sqrt(sumSq / Math.max(1, outLen));
        if (this.state === 'LISTENING') {
          this.cb.onAudioLevel?.(Math.min(1, rms * 6));
        }

        const bytes = new Uint8Array(pcm16.buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const b64 = btoa(binary);

        this.ws.send(
          JSON.stringify({
            realtimeInput: {
              audio: {
                data: b64,
                mimeType: 'audio/pcm;rate=16000',
              },
            },
          })
        );
      };

      source.connect(processor);
      processor.connect(this.audioCtx.destination);
    } catch {
      // Microphone unavailable in headless sandbox
    }
  }

  _stopMicPcmStream() {
    if (this.micProcessor) {
      try {
        this.micProcessor.disconnect();
      } catch {
        // ignore
      }
      this.micProcessor = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
  }

  _playPcm24kBase64(b64) {
    try {
      this.audioCtx = this.audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const pcm16 = new Int16Array(bytes.buffer);

      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768.0;

      // Compute 50 FPS (20ms) F1/F2 formant visemes and blend with phoneme stream
      const rawFrames = pcmVisemes(float32, 24000);
      const visFrames = this.liveVisemeStream ? this.liveVisemeStream.frames(rawFrames, 0.02) : rawFrames;

      const audioBuffer = this.audioCtx.createBuffer(1, float32.length, 24000);
      audioBuffer.getChannelData(0).set(float32);
      const src = this.audioCtx.createBufferSource();
      src.buffer = audioBuffer;
      src.connect(this.audioCtx.destination);
      const startAt = Math.max(this.audioCtx.currentTime, this.nextPlayTime || 0);
      const endAt = startAt + audioBuffer.duration;
      src.start(startAt);
      this.nextPlayTime = endAt;
      this.liveAudioSources.push(src);
      src.onended = () => {
        this.liveAudioSources = this.liveAudioSources.filter((s) => s !== src);
      };

      this.scheduledVisemeChunks = this.scheduledVisemeChunks || [];
      this.scheduledVisemeChunks.push({ startAt, endAt, frames: visFrames });
      this.liveVisemeQueue = this.scheduledVisemeChunks;

      this._setState('SPEAKING', `Gemini Live parle (${this.wsVoice || configStore.get().voiceName})...`);

      if (!this.liveVisemeTimer) {
        this.liveVisemeTimer = setInterval(() => {
          const now = this.audioCtx ? this.audioCtx.currentTime : 0;
          // Prune finished chunks
          while (
            this.scheduledVisemeChunks.length > 0 &&
            now > this.scheduledVisemeChunks[0].endAt + 0.02
          ) {
            this.scheduledVisemeChunks.shift();
          }

          const active = this.scheduledVisemeChunks[0];
          if (active && now >= active.startAt - 0.01) {
            const fIdx = Math.max(
              0,
              Math.min(active.frames.length - 1, Math.floor((now - active.startAt) / 0.02))
            );
            const vf = active.frames[fIdx] || { open: 0, wide: 0, level: 0 };
            this.cb.onViseme?.({
              jaw: vf.open,
              open: vf.open,
              width: vf.wide,
              wide: vf.wide,
              level: vf.level,
            });
            this.cb.onAudioLevel?.(Math.min(1, (vf.level || vf.open || 0) * 0.95));
          } else if (this.scheduledVisemeChunks.length === 0 && (!this.audioCtx || now >= (this.nextPlayTime || 0))) {
            clearInterval(this.liveVisemeTimer);
            this.liveVisemeTimer = null;
            this.cb.onViseme?.({ jaw: 0, open: 0, width: 0, wide: 0, level: 0 });
            this.cb.onAudioLevel?.(0);
            if (this.state === 'SPEAKING') {
              this._setState(
                this.micActive ? 'LISTENING' : 'IDLE',
                this.micActive ? `Gemini Live à l’écoute (${this.wsVoice})` : `Gemini Live prêt (${this.wsVoice})`
              );
            }
          }
        }, 16);
      }
    } catch {
      // ignore
    }
  }

  // ── Browser / Electron Web Speech Recognition (PTT / Continuous) ───────────

  startVoiceRecognition() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      this._setState('IDLE', 'Reconnaissance vocale du navigateur non supportée ici — utilisez la barre de commande.');
      return;
    }
    try {
      const rec = new SpeechRec();
      rec.lang = 'fr-FR';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      this.recognition = rec;
      this._setState('LISTENING', 'À l’écoute (parlez maintenant)...');

      rec.onresult = (event) => {
        const transcript = event.results?.[0]?.[0]?.transcript || '';
        if (transcript.trim()) {
          this.sendUserMessage(transcript.trim(), { speakReply: true });
        }
      };
      rec.onerror = () => {
        this._setState('IDLE', 'Prêt');
      };
      rec.onend = () => {
        if (this.state === 'LISTENING') this._setState('IDLE', 'Prêt');
      };
      rec.start();
    } catch {
      this._setState('IDLE', 'Prêt');
    }
  }

  // ── Offline / Local Intent Engine (Port of OfflineIntents.kt) ──────────────

  async _runLocalIntent(text) {
    const q = text.toLowerCase().trim();

    // 1. Briefing / Bonjour
    if (/^(bonjour|salut|briefing|quoi de neuf|point du jour)/.test(q)) {
      return await this.tools.execute('wake_briefing', {});
    }

    // 2. Weather / Rain / Air Quality / Fuel
    if (/(pleuvoir|pluie dans l'heure|averse)/.test(q)) {
      const cityMatch = /\b(?:à|a|sur)\s+([a-zA-ZÀ-ÿ\-]+)/i.exec(text);
      return await this.tools.execute('rain_soon', { city: cityMatch?.[1] });
    }
    if (/(qualit[ée] de l'air|pollen|pollution)/.test(q)) {
      const cityMatch = /\b(?:à|a|sur)\s+([a-zA-ZÀ-ÿ\-]+)/i.exec(text);
      return await this.tools.execute('air_quality', { city: cityMatch?.[1] });
    }
    if (/(m[ée]t[ée]o|quel temps|temp[ée]rature)/.test(q)) {
      const cityMatch = /\b(?:à|a|sur|de)\s+([a-zA-ZÀ-ÿ\-]+)/i.exec(text);
      return await this.tools.execute('weather', { city: cityMatch?.[1] });
    }
    if (/(essence|carburant|gazole|sp95|sp98|e85)/.test(q)) {
      const cityMatch = /\b(?:à|a|sur)\s+([a-zA-ZÀ-ÿ\-]+)/i.exec(text);
      return await this.tools.execute('fuel_prices', {
        city: cityMatch?.[1] || configStore.get().userCity || 'Bordeaux',
      });
    }

    // 3. Space / ISS / Sky / World Map
    if (/\b(iss|station spatiale|tiangong|hubble|satellite)\b/.test(q)) {
      return await this.tools.execute('satellites', { name: q.includes('tiangong') ? 'Tiangong' : q.includes('hubble') ? 'Hubble' : 'ISS' });
    }
    if (/(carte du ciel|vo[ûu]te c[ée]leste|[ée]toiles|plan[èe]tes|constellation|phase de la lune)/.test(q)) {
      return await this.tools.execute('night_sky', {});
    }
    if (/(carte du monde|carte spatiale|séismes|aurores|lancements)/.test(q)) {
      return await this.tools.execute('sky_view', { view: 'map' });
    }
    if (/(avions au-dessus|avions en vol|trafic a[ée]rien)/.test(q)) {
      return await this.tools.execute('planes_overhead', {});
    }

    // 4. Radio / Podcasts / Video / YouTube
    if (/(arr[êe]te la radio|stop radio)/.test(q)) {
      return await this.tools.execute('radio', { action: 'stop' });
    }
    if (/(radio|france inter|france info|fip|france culture|france musique|mouv|somafm)/.test(q)) {
      const station = text.replace(/^(mets|lance|[ée]coute|joue)\s+(la\s+)?(radio\s+)?/i, '').trim() || 'France Inter';
      return await this.tools.execute('radio', { action: 'play', query: station });
    }
    if (/(endors-moi|pluie pour dormir|sons de la nature)/.test(q)) {
      return await this.tools.execute('radio', { action: 'sleep', query: 'pluie', minutes: 30 });
    }
    if (/podcast/.test(q)) {
      const topic = text.replace(/.*podcast\s*(sur|de)?\s*/i, '').trim() || 'Affaires sensibles';
      return await this.tools.execute('podcasts', { query: topic });
    }
    if (/(youtube|vid[ée]o)/.test(q)) {
      const topic = text.replace(/.*(youtube|vid[ée]o)\s*(sur|de)?\s*/i, '').trim() || 'espace';
      return await this.tools.execute('play_video', { action: 'play', query: topic });
    }

    // 5. PC System Monitor / Settings / Open App / Control
    if (/(cpu|ram|m[ée]moire vive|[ée]tat du pc|processeur|syst[èe]me)/.test(q)) {
      return await this.tools.execute('system_monitor', {});
    }
    if (/(vide la corbeille|vider la corbeille)/.test(q)) {
      return await this.tools.execute('device_settings', { setting: 'empty_recycle_bin' });
    }
    if (/([ée]teins l'[ée]cran|mets l'[ée]cran en veille)/.test(q)) {
      return await this.tools.execute('device_settings', { setting: 'display_off' });
    }
    if (/(mets le pc en veille|mise en veille)/.test(q)) {
      return await this.tools.execute('device_settings', { setting: 'sleep' });
    }
    if (/(volume|monte le son|baisse le son|coupe le son|muet|luminosit[ée]|verrouille le pc)/.test(q)) {
      if (q.includes('muet') || q.includes('coupe le son')) {
        return await this.tools.execute('device_settings', { setting: 'mute' });
      }
      if (q.includes('verrouille')) {
        return await this.tools.execute('device_settings', { setting: 'lock' });
      }
      const numMatch = /(\d+)/.exec(q);
      const val = numMatch ? parseInt(numMatch[1], 10) : q.includes('baisse') ? 35 : 75;
      const setting = q.includes('luminosit') ? 'brightness' : 'volume';
      return await this.tools.execute('device_settings', { setting, value: val });
    }
    if (/^(ouvre|lance|d[ée]marre)\s+/i.test(text)) {
      const appName = text.replace(/^(ouvre|lance|d[ée]marre)\s+(l'application\s+|le\s+dossier\s+|le\s+|la\s+|les\s+)?/i, '').trim();
      return await this.tools.execute('open_app', { app_name: appName });
    }
    if (/^(ferme|quitte)\s+/i.test(text)) {
      const winName = text.replace(/^(ferme|quitte)\s+(la\s+fen[êe]tre\s+|l'application\s+|le\s+|la\s+)?/i, '').trim();
      return await this.tools.execute('pc_control', { action: 'close_window', text: winName });
    }
    if (/(agrandis|plein [ée]cran|maximise)/.test(q)) {
      const winName = text.replace(/.*(agrandis|plein [ée]cran|maximise)\s*(la\s+fen[êe]tre\s+)?/i, '').trim();
      return await this.tools.execute('pc_control', { action: 'maximize_window', text: winName });
    }
    if (/(ancre|mets la fen[êe]tre|aligne).*(gauche|droite)/.test(q)) {
      return await this.tools.execute('pc_control', {
        action: q.includes('droite') ? 'snap_right' : 'snap_left',
      });
    }
    if (/(affiche le bureau|r[ée]duis toutes les fen[êe]tres)/.test(q)) {
      return await this.tools.execute('pc_control', { action: 'minimize_all' });
    }
    if (/^(tape|écris|ecris|colle)\s+/i.test(text)) {
      const toType = text.replace(/^(tape|écris|ecris|colle)\s+/i, '');
      return await this.tools.execute('pc_control', { action: 'paste', text: toType });
    }
    if (/(appuie sur|raccourci|fais\s+ctrl|fais\s+alt)/i.test(q)) {
      const keyStr = text.replace(/^(appuie sur|raccourci|fais)\s+/i, '').trim();
      return await this.tools.execute('pc_control', { action: 'hotkey', keys: keyStr });
    }
    if (/(scrolle|d[ée]file)\s+/i.test(q)) {
      const up = /haut|monte/i.test(q);
      return await this.tools.execute('pc_control', { action: 'scroll', delta: up ? 480 : -480 });
    }
    if (/(fen[êe]tres ouvertes|liste les fen[êe]tres)/.test(q)) {
      return await this.tools.execute('pc_control', { action: 'list_windows' });
    }
    if (/(capture d'[ée]cran|regarde mon [ée]cran|screenshot)/.test(q)) {
      return await this.tools.execute('read_screen', {});
    }

    // 6. Document Generation (PDF, Word, Excel)
    if (/(cr[ée]e un document|cr[ée]e un pdf|g[ée]n[èe]re un pdf|document word|fichier excel)/.test(q)) {
      const type = q.includes('excel') || q.includes('xlsx') ? 'xlsx' : q.includes('word') || q.includes('docx') ? 'docx' : 'pdf';
      return await this.tools.execute('create_document', {
        type,
        title: 'Rapport Jarvis 2.0',
        content: `# Rapport généré par Jarvis 2.0 PC\n\nDemande : ${text}\nDate : ${new Date().toLocaleString('fr-FR')}`,
      });
    }

    // 7. Tasks / Timers / Expenses / Habits / Memory
    if (/(liste de courses|ajoute .* courses|t[âa]ches)/.test(q)) {
      const addMatch = /ajoute\s+(.+?)\s+(?:à|a|dans)\s+la\s+liste/i.exec(text);
      if (addMatch) {
        return await this.tools.execute('tasks', {
          action: 'add',
          list_name: q.includes('courses') ? 'courses' : 'todo',
          item: addMatch[1],
        });
      }
      return await this.tools.execute('tasks', {
        action: 'list',
        list_name: q.includes('courses') ? 'courses' : 'todo',
      });
    }
    if (/minuteur/.test(q)) {
      const minMatch = /(\d+)\s*min/i.exec(q);
      const secMatch = /(\d+)\s*sec/i.exec(q);
      return await this.tools.execute('set_timer', {
        action: 'start',
        minutes: minMatch ? parseInt(minMatch[1], 10) : secMatch ? 0 : 5,
        seconds: secMatch ? parseInt(secMatch[1], 10) : 0,
      });
    }
    if (/(d[ée]pense|budget)/.test(q)) {
      const amtMatch = /(\d+(?:[.,]\d+)?)\s*(?:€|euros?)/i.exec(q);
      if (amtMatch) {
        return await this.tools.execute('expenses', {
          action: 'add',
          amount: parseFloat(amtMatch[1].replace(',', '.')),
          category: 'courses',
          label: text,
        });
      }
      return await this.tools.execute('expenses', { action: 'summary' });
    }
    if (/habitude/.test(q)) {
      return await this.tools.execute('habits', { action: 'list' });
    }
    if (/souviens-toi que\s+(.+)/i.test(text)) {
      const m = /souviens-toi que\s+(.+)/i.exec(text);
      return await this.tools.execute('remember_fact', { key: 'note', value: m[1] });
    }

    // 8. Check if any of the 82 bundled JSON plugins matches the query
    await pluginEngine.loadCatalog();
    const matchedPlugin = pluginEngine.findPlugin(q);
    if (matchedPlugin) {
      return await pluginEngine.runPlugin(matchedPlugin, {}, (tName, tArgs) =>
        this.tools.execute(tName, tArgs)
      );
    }

    // 9. Fallback: Run web_search so the user always gets a helpful factual answer!
    const searchRes = await this.tools.execute('web_search', { query: text });
    return `${searchRes}\n\n💡 (Astuce : ajoutez une clé API Gemini gratuite dans Réglages > Modèles & Voix pour activer la conversation Gemini Live 24 kHz en continu.)`;
  }
}
