'use strict';
// Images créées avec OpenAI (API Images, clé OpenAI de l'utilisateur) : alternative pour les PC sans carte graphique.
// Idée de Cornelius (génération d'image « Sur ce PC » ou « Avec OpenAI »), réécrite pour Jarvis.
//
// Règles : les mêmes refus que le générateur local (jamais d'enfant ni de mineur) ; le contenu adulte est toujours refusé ici,
// OpenAI ne l'acceptant pas et le réglage 18+ ne concernant que le générateur du PC. La description part chez OpenAI.

const { refusal } = require('./imageGen.cjs');
const { guardedFetch } = require('./httpGuard.cjs');

const MODEL_RE = /^[A-Za-z0-9][\w.:-]{2,59}$/;
const QUALITIES = ['low', 'medium', 'high', 'auto'];
const SIZES = { square: '1024x1024', portrait: '1024x1536', landscape: '1536x1024' };
const STYLE_HINT = {
  photo: 'Photorealistic photograph, natural light, fine detail. ',
  anime: 'Anime illustration, clean line art, vivid colours. ',
};

/** Taille OpenAI la plus proche du ratio demandé. */
function pickSize(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!(w > 0) || !(h > 0)) return SIZES.square;
  const r = w / h;
  return r > 1.2 ? SIZES.landscape : r < 0.83 ? SIZES.portrait : SIZES.square;
}

/** Requête sans la clé (qui est ajoutée à l'envoi). Retourne { body } ou { error }. */
function buildRequest(input = {}, config = {}) {
  const why = refusal(input.prompt, false, 'pc');
  if (why) return { error: why.startsWith('Le contenu adulte est désactivé') ? 'Le moteur OpenAI n’accepte pas le contenu adulte : choisissez le générateur du PC dans les Réglages pour ce genre d’image.' : why };
  const model = String(config.model || 'gpt-image-1').trim();
  if (!MODEL_RE.test(model)) return { error: 'Nom de modèle d’image invalide.' };
  const quality = QUALITIES.includes(String(config.quality)) ? config.quality : 'auto';
  const style = String(input.style || 'auto').toLowerCase();
  const prompt = `${STYLE_HINT[style] || ''}${String(input.prompt).trim()}`.slice(0, 4000);
  return { body: { model, prompt, size: pickSize(input.width, input.height), quality, n: 1 } };
}

/** Appelle l'API Images. Retourne { ok, png (base64), text } ou { ok:false, text }. */
async function generate(input, config, apiKey, { fetchImpl = fetch, timeoutMs = 180_000 } = {}) {
  const built = buildRequest(input, config);
  if (built.error) return { ok: false, text: built.error };
  if (!apiKey) return { ok: false, text: 'Aucune clé OpenAI : saisissez-la dans Studio IA › Modèles (fournisseur OpenAI).' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const got = await guardedFetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(built.body),
      signal: controller.signal,
      maxBytes: 32 * 1024 * 1024,
      maxRedirects: 0,
      fetchImpl,
    });
    if (got.error) return { ok: false, text: `OpenAI : ${got.error}` };
    const text = got.buffer.toString('utf8');
    let json = null;
    try { json = JSON.parse(text); } catch { /* corps illisible */ }
    if (!got.res.ok) {
      const msg = String(json?.error?.message || '').slice(0, 200);
      const hint = got.res.status === 401 ? 'clé OpenAI refusée' : got.res.status === 429 ? 'quota ou limite de débit dépassé' : got.res.status === 400 && /safety|moderation|content/i.test(msg) ? 'demande refusée par la modération d’OpenAI' : `HTTP ${got.res.status}`;
      return { ok: false, text: `OpenAI n’a pas créé l’image : ${hint}${msg && !/clé|quota/.test(hint) ? ` (${msg})` : ''}.` };
    }
    const png = String(json?.data?.[0]?.b64_json || '');
    if (!png || got.truncated) return { ok: false, text: 'OpenAI n’a rendu aucune image exploitable.' };
    return { ok: true, png, seed: null, text: `Image créée avec OpenAI (${built.body.model}, ${built.body.size}).`, engine: 'openai' };
  } catch (err) {
    return { ok: false, text: err && err.name === 'AbortError' ? 'OpenAI n’a pas fini l’image à temps.' : `OpenAI injoignable (${String(err && err.message || err).slice(0, 80)}).` };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { generate, buildRequest, pickSize, MODEL_RE, QUALITIES };
