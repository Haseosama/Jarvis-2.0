// Port of JarvisEngine.kt, GeminiLiveClient.kt, RestChat.kt, ModelLadder.kt, and OfflineIntents.kt
// Supports:
// 1. Gemini Live bidirectional WebSocket (16kHz PCM in, 24kHz PCM out + real-time F1/F2 formant 3D lip-sync + tool calling)
// 2. Gemini REST generateContent with automatic ModelLadder fallback + 3-key rotation + tool loop
// 3. Offline / Local Intent Engine that works immediately even without an API key

import { configStore, REST_MODELS } from './ConfigStore.js';
import { dataStore } from './DataStore.js';
import { hostBridge } from './hostBridge.js';
import { pluginEngine } from './PluginEngine.js';
import { textToVisemes, VISEMES, pcmVisemes } from '../avatar/Visemes.js';

const LIVE_WS_ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

export class JarvisEngine {
  constructor(toolRegistry, callbacks = {}) {
    this.tools = toolRegistry;
    this.cb = callbacks; // { onStateChange, onMessage, onViseme, onAudioLevel, onStatusText }
    this.state = 'IDLE'; // 'IDLE' | 'LISTENING' | 'THINKING' | 'SPEAKING'
    this.ws = null;
    this.audioCtx = null;
    this.micStream = null;
    this.micProcessor = null;
    this.nextPlayTime = 0;
    this.recognition = null;
    this.ttsTimer = null;
    this.chatHistory = [];
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

    // If Gemini Live WebSocket is open, send clientContent turn
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
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

    const apiKey = configStore.getActiveApiKey();
    const mode = configStore.get().voiceMode;

    // Try Gemini REST with ModelLadder if API key is configured and not forced offline
    if (apiKey && mode !== 'offline') {
      try {
        const reply = await this._runRestWithLadder(clean, imageBase64);
        this._deliverAssistantReply(reply, speakReply);
        return;
      } catch (err) {
        // Fall through to local intent engine if quota/network error
        console.warn('REST fallback to local engine:', err);
      }
    }

    // Local / Offline Intent Engine (works 100% without API key!)
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
      this._setState('IDLE', 'Prêt');
    }
  }

  // ── Speech Synthesis + Real-Time 3D Viseme Lip-Sync ────────────────────────

  speakTextWithLipSync(text) {
    this.stopSpeaking();
    const cleanForSpeech = String(text || '')
      .replace(/```[\s\S]*?```/g, 'Code affiché à l’écran.')
      .replace(/[*#_`~•]/g, ' ')
      .replace(/https?:\/\/\S+/g, 'lien web')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanForSpeech) {
      this._setState('IDLE', 'Prêt');
      return;
    }

    this._setState('SPEAKING', 'Jarvis parle...');
    const pairs = textToVisemes(cleanForSpeech);
    const frames = [];
    for (const [vKey, dur] of pairs) {
      const shape = VISEMES[vKey] || VISEMES.REST;
      const count = Math.max(1, Math.round((dur || 1) * 1.6));
      for (let k = 0; k < count; k++) {
        frames.push({
          jaw: shape.open * (1 - (shape.closure || 0)),
          open: shape.open * (1 - (shape.closure || 0)),
          width: shape.wide,
          wide: shape.wide,
        });
      }
    }

    // Drive 60 FPS viseme animation synchronized with speech duration
    let idx = 0;
    const stepMs = 70;
    this.ttsTimer = setInterval(() => {
      if (idx < frames.length) {
        const v = frames[idx++];
        this.cb.onViseme?.(v);
        this.cb.onAudioLevel?.(Math.min(1, v.jaw * 0.9 + 0.15));
      } else {
        this.stopSpeaking();
      }
    }, stepMs);

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(cleanForSpeech);
        utter.lang = 'fr-FR';
        utter.rate = configStore.get().speechRate || 1.05;
        const voices = window.speechSynthesis.getVoices();
        const frVoice =
          voices.find((v) => v.lang.startsWith('fr') && /natural|neural|google|microsoft/i.test(v.name)) ||
          voices.find((v) => v.lang.startsWith('fr'));
        if (frVoice) utter.voice = frVoice;
        utter.onend = () => this.stopSpeaking();
        utter.onerror = () => this.stopSpeaking();
        window.speechSynthesis.speak(utter);
      } catch {
        // Timer will finish naturally
      }
    }
  }

  stopSpeaking() {
    if (this.ttsTimer) {
      clearInterval(this.ttsTimer);
      this.ttsTimer = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
    this.cb.onViseme?.({ jaw: 0, width: 0, round: 0, close: 0, teeth: 0 });
    this.cb.onAudioLevel?.(0);
    if (this.state === 'SPEAKING') {
      this._setState('IDLE', 'Prêt');
    }
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

  // ── Gemini Live Bidirectional WebSocket Session ────────────────────────────

  async startLiveSession() {
    const apiKey = configStore.getActiveApiKey();
    if (!apiKey) {
      // Fall back to Web Speech Recognition + Local/REST engine
      return this.startVoiceRecognition();
    }

    try {
      this._setState('LISTENING', 'Connexion à Gemini Live...');
      const cfg = configStore.get();
      const wsUrl = `${LIVE_WS_ENDPOINT}?key=${encodeURIComponent(apiKey)}`;
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.onopen = async () => {
        const setupFrame = {
          setup: {
            model: cfg.liveModel || 'models/gemini-2.5-flash-native-audio-preview-12-2025',
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: cfg.voiceName || 'Aoede',
                  },
                },
              },
            },
            systemInstruction: {
              parts: [{ text: this.buildSystemPrompt() }],
            },
            tools: [{ functionDeclarations: this.tools.getDeclarations() }],
          },
        };
        ws.send(JSON.stringify(setupFrame));
        await this._startMicPcmStream();
        this._setState('LISTENING', `Gemini Live actif (${cfg.voiceName})`);
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

        // Handle incoming 24kHz PCM audio from Gemini Live
        const parts = msg.serverContent?.modelTurn?.parts || [];
        for (const p of parts) {
          if (p.inlineData?.data && String(p.inlineData.mimeType || '').startsWith('audio/pcm')) {
            this._playPcm24kBase64(p.inlineData.data);
          }
          if (p.text) {
            this.cb.onMessage?.({
              id: `live_${Date.now()}`,
              role: 'assistant',
              text: p.text,
              timestamp: Date.now(),
            });
          }
        }

        // Handle tool calls from Gemini Live
        const fnCalls = msg.toolCall?.functionCalls || [];
        if (fnCalls.length > 0) {
          const functionResponses = [];
          for (const fc of fnCalls) {
            const result = await this.tools.execute(fc.name, fc.args || {});
            this.cb.onToolExecuted?.(fc.name, fc.args, result);
            functionResponses.push({
              id: fc.id,
              name: fc.name,
              response: { result },
            });
          }
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ toolResponse: { functionResponses } }));
          }
        }
      };

      ws.onerror = () => {
        this.stopLiveSession();
        this.startVoiceRecognition();
      };

      ws.onclose = () => {
        this.ws = null;
        this._stopMicPcmStream();
        if (this.state !== 'IDLE') this._setState('IDLE', 'Prêt');
      };
    } catch {
      this.startVoiceRecognition();
    }
  }

  stopLiveSession() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
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
    this._setState('IDLE', 'Prêt');
  }

  async _startMicPcmStream() {
    try {
      this.audioCtx = this.audioCtx || new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = this.audioCtx.createMediaStreamSource(this.micStream);
      const processor = this.audioCtx.createScriptProcessor(4096, 1, 1);
      this.micProcessor = processor;

      processor.onaudioprocess = (e) => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const input = e.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(input.length);
        let sumSq = 0;
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          sumSq += s * s;
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        const rms = Math.sqrt(sumSq / input.length);
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
              mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: b64 }],
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
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const pcm16 = new Int16Array(bytes.buffer);

      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768.0;

      // Compute real-time F1/F2 formants from PCM to drive 3D avatar lip-sync!
      const visFrames = pcmVisemes(float32, 24000);
      const vis = visFrames[0] || { open: 0.35, wide: 0 };
      this._setState('SPEAKING', 'Gemini Live parle...');
      this.cb.onViseme?.({ jaw: vis.open, open: vis.open, width: vis.wide, wide: vis.wide });
      this.cb.onAudioLevel?.(Math.min(1, (vis.open || 0.25) * 0.9 + 0.1));

      const audioBuffer = this.audioCtx.createBuffer(1, float32.length, 24000);
      audioBuffer.getChannelData(0).set(float32);
      const src = this.audioCtx.createBufferSource();
      src.buffer = audioBuffer;
      src.connect(this.audioCtx.destination);
      const startAt = Math.max(this.audioCtx.currentTime, this.nextPlayTime || 0);
      src.start(startAt);
      this.nextPlayTime = startAt + audioBuffer.duration;
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
    if (/(volume|monte le son|baisse le son|coupe le son|muet|luminosit[ée]|verrouille le pc)/.test(q)) {
      if (q.includes('muet') || q.includes('coupe le son')) {
        return await this.tools.execute('device_settings', { setting: 'mute' });
      }
      if (q.includes('verrouille')) {
        return await this.tools.execute('device_settings', { setting: 'lock' });
      }
      const numMatch = /(\d+)/.exec(q);
      const val = numMatch ? parseInt(numMatch[1], 10) : 60;
      const setting = q.includes('luminosit') ? 'brightness' : 'volume';
      return await this.tools.execute('device_settings', { setting, value: val });
    }
    if (/^(ouvre|lance|d[ée]marre)\s+/i.test(text)) {
      const appName = text.replace(/^(ouvre|lance|d[ée]marre)\s+(l'application\s+|le\s+|la\s+)?/i, '').trim();
      return await this.tools.execute('open_app', { app_name: appName });
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
