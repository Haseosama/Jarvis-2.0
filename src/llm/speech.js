// Voix locale ou tierce, sans Gemini : reconnaissance (Whisper) et synthèse (Piper, Kokoro, OpenAI, ElevenLabs).
// Tout passe par des serveurs compatibles OpenAI (/audio/transcriptions, /audio/speech) : whisper.cpp server,
// faster-whisper-server, LocalAI, openedai-speech (Piper)... ou ElevenLabs. Rien n'est installé par Jarvis.
import { hostBridge } from '../core/hostBridge.js';
import { validateBaseUrl } from './providers.js';

export const SPEECH_DEFAULTS = {
  baseUrl: 'http://localhost:8000/v1',
  sttModel: 'whisper-1',
  ttsModel: 'tts-1',
  ttsVoice: 'alloy',
};

export function toBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (typeof Buffer !== 'undefined') return Buffer.from(u8).toString('base64');
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromBase64(b64) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** multipart/form-data construit à la main (le transport IPC n'accepte que du texte / base64). */
export function buildMultipart(fields, file, boundary = `----jarvis${Math.random().toString(16).slice(2)}`) {
  const enc = new TextEncoder();
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null || v === '') continue;
    parts.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\nContent-Type: ${file.mime}\r\n\r\n`));
  parts.push(file.bytes, enc.encode(`\r\n--${boundary}--\r\n`));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return { contentType: `multipart/form-data; boundary=${boundary}`, bytes: out };
}

const authHeaders = (apiKey) => (apiKey ? { Authorization: `Bearer ${apiKey}` } : {});
const defaultFetch = (payload) => hostBridge.httpFetch(payload);

/** Audio → texte. Retourne { ok, text, language, error }. */
export async function transcribe({ baseUrl, apiKey = '', model, bytes, filename = 'audio.webm', mime = 'audio/webm', language = '' }, fetcher = defaultFetch) {
  try {
    const base = validateBaseUrl(baseUrl || SPEECH_DEFAULTS.baseUrl);
    const mp = buildMultipart({ model: model || SPEECH_DEFAULTS.sttModel, response_format: 'verbose_json', language }, { filename, mime, bytes });
    const res = await fetcher({
      url: `${base}/audio/transcriptions`,
      method: 'POST',
      headers: { ...authHeaders(apiKey), 'Content-Type': mp.contentType },
      bodyBase64: toBase64(mp.bytes),
      timeoutMs: 60000,
    });
    if (!res.ok) return { ok: false, text: '', error: `Reconnaissance vocale : HTTP ${res.status || 0} ${String(res.text || res.error || '').slice(0, 160)}` };
    const json = res.json || (() => { try { return JSON.parse(res.text); } catch { return null; } })();
    const text = String(json?.text ?? res.text ?? '').trim();
    return { ok: true, text, language: json?.language || '' };
  } catch (err) {
    return { ok: false, text: '', error: String(err?.message || err) };
  }
}

/** Texte → audio. engine = 'openai' (tout serveur compatible) | 'elevenlabs'. Retourne { ok, bytes, mime, error }. */
export async function synthesize({ engine = 'openai', baseUrl, apiKey = '', model, voice, input, language = '', format = 'mp3' }, fetcher = defaultFetch) {
  try {
    const text = String(input || '').trim();
    if (!text) return { ok: false, error: 'Texte vide.' };
    let req;
    if (engine === 'elevenlabs') {
      if (!apiKey) return { ok: false, error: 'Clé ElevenLabs manquante.' };
      if (!/^[A-Za-z0-9]{10,40}$/.test(String(voice || ''))) return { ok: false, error: 'Identifiant de voix ElevenLabs invalide.' };
      req = {
        url: `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=${format === 'pcm' ? 'pcm_16000' : 'mp3_44100_128'}`,
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: model || 'eleven_multilingual_v2', ...(language ? { language_code: language } : {}) }),
      };
    } else {
      const base = validateBaseUrl(baseUrl || SPEECH_DEFAULTS.baseUrl);
      req = {
        url: `${base}/audio/speech`,
        method: 'POST',
        headers: { ...authHeaders(apiKey), 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model || SPEECH_DEFAULTS.ttsModel, voice: voice || SPEECH_DEFAULTS.ttsVoice, input: text, response_format: format === 'pcm' ? 'pcm' : 'mp3' }),
      };
    }
    const res = await fetcher({ ...req, responseType: 'base64', timeoutMs: 60000 });
    if (!res.ok || !res.base64) return { ok: false, error: `Synthèse vocale : HTTP ${res.status || 0} ${String(res.error || '').slice(0, 160)}` };
    // PCM : ElevenLabs renvoie du 16 kHz, les serveurs compatibles OpenAI du 24 kHz (16 bits, mono).
    if (format === 'pcm') return { ok: true, bytes: fromBase64(res.base64), mime: 'audio/pcm', rate: engine === 'elevenlabs' ? 16000 : 24000 };
    return { ok: true, bytes: fromBase64(res.base64), mime: 'audio/mpeg' };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

/** Les modèles de raisonnement écrivent <think>…</think> : jamais lu à voix haute. */
export { stripThink } from '../audio/voiceGuards.js';

// ── Gemini (REST) : transcription et synthèse, pour les satellites audio sans serveur vocal local ─────────

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';

/** PCM 16 kHz (déjà enveloppé en WAV) → texte. */
export async function geminiTranscribe({ apiKey, model = 'gemini-2.5-flash', wav, language = 'français' }, fetcher = defaultFetch) {
  if (!apiKey) return { ok: false, text: '', error: 'Clé Gemini manquante.' };
  const res = await fetcher({
    url: `${GEMINI}/models/${model}:generateContent`, method: 'POST', timeoutMs: 30000,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ contents: [{ parts: [{ text: `Transcris exactement cet enregistrement (${language}). Réponds uniquement par la transcription, sans commentaire. S'il n'y a pas de parole, réponds par un texte vide.` }, { inline_data: { mime_type: 'audio/wav', data: toBase64(wav) } }] }] }),
  });
  if (!res.ok) return { ok: false, text: '', error: `Transcription Gemini : HTTP ${res.status || 0}` };
  const json = res.json || (() => { try { return JSON.parse(res.text); } catch { return null; } })();
  const text = String(json?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '').trim();
  return { ok: true, text };
}

/** Texte → PCM 24 kHz 16 bits mono. */
export async function geminiSpeak({ apiKey, model = 'gemini-2.5-flash-preview-tts', voice = 'Aoede', input }, fetcher = defaultFetch) {
  if (!apiKey) return { ok: false, error: 'Clé Gemini manquante.' };
  const text = String(input || '').trim();
  if (!text) return { ok: false, error: 'Texte vide.' };
  const res = await fetcher({
    url: `${GEMINI}/models/${String(model).replace(/^models\//, '')}:generateContent`, method: 'POST', timeoutMs: 60000,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ contents: [{ parts: [{ text }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } }),
  });
  if (!res.ok) return { ok: false, error: `Synthèse Gemini : HTTP ${res.status || 0}` };
  const json = res.json || (() => { try { return JSON.parse(res.text); } catch { return null; } })();
  const data = json?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData || p.inline_data);
  const b64 = data?.inlineData?.data || data?.inline_data?.data;
  if (!b64) return { ok: false, error: 'Synthèse Gemini : aucun audio reçu.' };
  return { ok: true, bytes: fromBase64(b64), rate: 24000 };
}
