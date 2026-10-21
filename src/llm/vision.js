// Vision de la webcam : décrire ce que montre la caméra, sur ce PC (modèle local) ou avec Gemini.
// Idée de Cornelius (« vision locale : description de ce que voit la caméra, calculée sur place »), réécrite pour Jarvis.
// Rien ne part tant que l'outil n'est pas appelé ; avec le moteur « local », l'image ne quitte jamais le PC.
import { hostBridge } from '../core/hostBridge.js';
import { stripThink } from '../audio/voiceGuards.js';
import { validateBaseUrl } from './providers.js';
import { done, failed } from '../core/safety.js';

export const VISION_DEFAULTS = { baseUrl: 'http://localhost:11434/v1', model: 'llava', geminiModel: 'gemini-2.5-flash' };
const DEFAULT_QUESTION = 'Décris en français, en deux ou trois phrases, ce que montre cette image de la webcam : les personnes (sans chercher à les identifier), les objets, l’ambiance.';

/** Requête OpenAI-compatible (Ollama, LM Studio, llama.cpp, vLLM avec un modèle à vision). Pure : testable. */
export function buildLocalVisionRequest({ baseUrl, model, dataUrl, question, apiKey = '' }) {
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(String(dataUrl || ''))) throw new Error('Image invalide.');
  const base = validateBaseUrl(baseUrl || VISION_DEFAULTS.baseUrl);
  return {
    url: `${base}/chat/completions`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({
      model: model || VISION_DEFAULTS.model,
      stream: false,
      max_tokens: 400,
      messages: [{ role: 'user', content: [{ type: 'text', text: String(question || DEFAULT_QUESTION).slice(0, 500) }, { type: 'image_url', image_url: { url: dataUrl } }] }],
    }),
    timeoutMs: 120000,
    maxBytes: 512 * 1024,
  };
}

const parse = (res) => res.json || (() => { try { return JSON.parse(res.text); } catch { return null; } })();

/** Décrit une image. cfg = { engine: 'local'|'gemini', baseUrl, model, geminiKey }. Retourne { ok, text, error }. */
export async function describeImage({ dataUrl, question, cfg }, fetcher = (r) => hostBridge.httpFetch(r)) {
  try {
    if (cfg.engine === 'gemini') {
      if (!cfg.geminiKey) return { ok: false, error: 'Clé Gemini manquante.' };
      const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(String(dataUrl || ''));
      if (!m) return { ok: false, error: 'Image invalide.' };
      const res = await fetcher({
        url: `https://generativelanguage.googleapis.com/v1beta/models/${cfg.geminiModel || VISION_DEFAULTS.geminiModel}:generateContent`, method: 'POST', timeoutMs: 60000, maxBytes: 512 * 1024,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.geminiKey },
        body: JSON.stringify({ contents: [{ parts: [{ text: String(question || DEFAULT_QUESTION).slice(0, 500) }, { inline_data: { mime_type: m[1], data: m[2] } }] }] }),
      });
      if (!res.ok) return { ok: false, error: `Vision Gemini : HTTP ${res.status || 0}` };
      const text = String(parse(res)?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '').trim();
      return text ? { ok: true, text } : { ok: false, error: 'Vision Gemini : aucune description reçue.' };
    }
    const req = buildLocalVisionRequest({ baseUrl: cfg.baseUrl, model: cfg.model, dataUrl, question });
    const res = await fetcher(req);
    if (!res.ok) return { ok: false, error: res.status ? `Le modèle de vision local a répondu HTTP ${res.status} (modèle à vision installé ? ex. ollama pull ${cfg.model || VISION_DEFAULTS.model}).` : `Modèle de vision local injoignable à ${cfg.baseUrl || VISION_DEFAULTS.baseUrl}.` };
    const text = stripThink(String(parse(res)?.choices?.[0]?.message?.content || '')).trim();
    return text ? { ok: true, text } : { ok: false, error: 'Le modèle de vision local n’a rien décrit.' };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

/** Outil « camera_look ». deps = { capture(): dataUrl, cfg, describe }. */
export async function runCameraLook(args, deps) {
  const mode = String(args.mode || 'snapshot').toLowerCase();
  if (mode === 'start' || mode === 'stop') return failed('camera_look', 'le flux continu n’existe pas : utilise une photo à la demande (mode snapshot)');
  let dataUrl;
  try { dataUrl = await deps.capture(); } catch (err) { return failed('camera_look', `webcam inaccessible : ${err.message || err}`); }
  const r = await (deps.describe || describeImage)({ dataUrl, question: args.question, cfg: deps.cfg });
  return r.ok ? `${done('camera_look', { engine: deps.cfg.engine })}\n${r.text}` : failed('camera_look', r.error);
}
