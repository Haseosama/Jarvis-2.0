// Mémoire consultable (port de l'idée de Mark LVI) : le prompt porte ce qui tient, le reste se retrouve à la demande.

const fold = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const tokens = (s) => fold(s).split(/[^a-z0-9]+/).filter((t) => t.length > 1);

/** Classe les souvenirs par pertinence (mots communs dans la clé ×3, dans la valeur ×1) puis par fraîcheur. */
export function searchMemories(memories, query, limit = 8) {
  const list = Array.isArray(memories) ? memories : [];
  const q = tokens(query);
  if (!q.length) return [...list].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, limit);
  return list
    .map((m) => {
      const k = new Set(tokens(m.key));
      const v = new Set(tokens(m.value));
      let score = 0;
      for (const t of q) {
        if (k.has(t)) score += 3;
        else if ([...k].some((x) => x.startsWith(t) || t.startsWith(x))) score += 2;
        if (v.has(t)) score += 1;
        else if ([...v].some((x) => x.startsWith(t) && t.length > 3)) score += 0.5;
      }
      return { m, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || (b.m.updatedAt || 0) - (a.m.updatedAt || 0))
    .slice(0, limit)
    .map((r) => r.m);
}

export const PROMPT_MEMORY_LIMIT = 40;

/** Bloc de mémoire pour le prompt : les plus récents, plus un renvoi vers recall_memory pour le reste. */
export function memoryPromptBlock(memories, limit = PROMPT_MEMORY_LIMIT) {
  const list = Array.isArray(memories) ? memories : [];
  if (!list.length) return '';
  const shown = [...list].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, limit);
  const rest = list.length - shown.length;
  return (
    '\nMémoire utilisateur :\n' +
    shown.map((m) => `- ${m.key}: ${m.value}`).join('\n') +
    (rest > 0 ? `\n(${rest} autres souvenirs : utilise recall_memory pour les retrouver.)` : '')
  );
}
