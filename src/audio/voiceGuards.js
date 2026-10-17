// Gardes de la voix : mot d'éveil, anti-écho (ne pas répondre à sa propre phrase), blocs de réflexion privés.

const fold = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Détecte « hey jarvis », « ok jarvis », « jarvis » en tête de phrase ou dans la phrase.
 * Retourne { matched, command } où command est ce qui suit le mot d'éveil.
 */
export function matchWakeWord(transcript, wakeWord = 'jarvis') {
  const text = fold(transcript);
  const wake = fold(wakeWord) || 'jarvis';
  if (!text) return { matched: false, command: '' };
  const escaped = wake.replace(/[^a-z0-9 ]/g, '');
  const re = new RegExp('(?:^|\\s)(?:(?:hey|hei|ok|okay|ola|salut|dis)\\s+)?' + escaped + '(?:\\s|$)');
  const m = re.exec(text);
  if (!m) return { matched: false, command: '' };
  return { matched: true, command: text.slice(m.index + m[0].length).trim() };
}

/**
 * Vrai si la transcription est (la fin de) ce que l'assistant vient de dire : elle est ignorée sans couper le micro.
 * Compare les mots de la transcription avec la fin de la dernière phrase prononcée.
 */
export function isEcho(transcript, lastSpoken, { tailWords = 40, threshold = 0.8 } = {}) {
  const heard = fold(transcript).split(' ').filter(Boolean);
  const spoken = fold(lastSpoken).split(' ').filter(Boolean);
  if (heard.length < 2 || spoken.length < 2) return false;
  const tail = new Set(spoken.slice(-tailWords));
  const hits = heard.filter((w) => tail.has(w)).length;
  return hits / heard.length >= threshold;
}

/** Retire les blocs de réflexion (qwen3, deepseek-r1…) : ils ne sont jamais lus à voix haute ni affichés. */
export function stripThink(text) {
  return String(text || '')
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
    .replace(/<think(?:ing)?>[\s\S]*$/i, '')
    .replace(/^\s+/, '');
}

export const WAKE_SLEEP_MS = 120_000;
