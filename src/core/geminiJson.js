// Minimal Gemini REST helper returning a parsed JSON object, with the same key rotation and
// model fallback behaviour as the rest of Jarvis. Prompts must treat user/external text as data.

import { hostBridge } from './hostBridge.js';
import { configStore, REST_MODELS } from './ConfigStore.js';

export function parseJsonObject(text) {
  const cleaned = String(text || '').replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* fall through */ }
    }
  }
  return null;
}

export async function askGeminiJson({ system, user, temperature = 0.2, timeoutMs = 45000 }) {
  const apiKey = configStore.getActiveApiKey();
  if (!apiKey) throw new Error('Aucune clé Gemini configurée (Paramètres > Voix & Clés Gemini).');
  const cfg = configStore.get();
  const models = [cfg.restModel || 'models/gemini-2.5-flash', ...REST_MODELS.map((model) => model.id)]
    .filter((id, index, list) => id && list.indexOf(id) === index)
    .slice(0, 3);
  let lastError = 'Réponse Gemini indisponible.';
  for (const modelId of models) {
    const modelPath = modelId.startsWith('models/') ? modelId : `models/${modelId}`;
    const response = await hostBridge.httpFetch(
      `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature, responseMimeType: 'application/json' },
        }),
        timeoutMs,
      }
    );
    if (response.status === 429 || response.status === 403) {
      configStore.rotateApiKey();
      lastError = `Quota Gemini dépassé sur ${modelPath}.`;
      continue;
    }
    const text = response.json?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
    const parsed = parseJsonObject(text);
    if (response.ok && parsed && typeof parsed === 'object') return parsed;
    lastError = `Gemini n’a pas renvoyé de JSON exploitable (${response.status || 'réseau'}).`;
  }
  throw new Error(lastError);
}
