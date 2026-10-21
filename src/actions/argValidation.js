// Arguments d'outils contrôlés par le cœur, pas par chaque outil (idée du contrat des modules de Cornelius).
// Un modèle envoie souvent "12" pour 12 ou "oui" pour true : on convertit ce qui est sans ambiguïté, on refuse le reste
// avec une phrase claire, et on borne les nombres / choix déclarés dans le schéma de l'outil.

const TRUE = new Set(['true', 'oui', 'yes', '1', 'vrai']);
const FALSE = new Set(['false', 'non', 'no', '0', 'faux']);

/**
 * Retourne { args } (arguments normalisés) ou { error } (phrase destinée au modèle).
 * Les propriétés sans schéma, ou de type non géré, passent telles quelles.
 */
export function validateArgs(parameters, rawArgs) {
  const props = parameters?.properties || {};
  const args = { ...(rawArgs || {}) };
  for (const [name, spec] of Object.entries(props)) {
    let v = args[name];
    if (v === undefined || v === null || v === '') continue;
    const type = String(spec?.type || '').toUpperCase();
    if (type === 'NUMBER' || type === 'INTEGER') {
      const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.replace(',', '.')) : NaN;
      if (!Number.isFinite(n)) return { error: `Paramètre « ${name} » : un nombre est attendu (reçu « ${String(v).slice(0, 40)} »).` };
      if (type === 'INTEGER' && !Number.isInteger(n)) return { error: `Paramètre « ${name} » : un nombre entier est attendu (reçu ${n}).` };
      if (Number.isFinite(spec.minimum) && n < spec.minimum) return { error: `Paramètre « ${name} » : au moins ${spec.minimum} (reçu ${n}).` };
      if (Number.isFinite(spec.maximum) && n > spec.maximum) return { error: `Paramètre « ${name} » : au plus ${spec.maximum} (reçu ${n}).` };
      v = n;
    } else if (type === 'BOOLEAN') {
      if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        if (TRUE.has(s)) v = true;
        else if (FALSE.has(s)) v = false;
        else return { error: `Paramètre « ${name} » : oui ou non attendu (reçu « ${s.slice(0, 40)} »).` };
      } else if (typeof v !== 'boolean') {
        return { error: `Paramètre « ${name} » : oui ou non attendu.` };
      }
    } else if (type === 'STRING') {
      if (typeof v !== 'string') v = String(v);
      if (Array.isArray(spec.enum) && spec.enum.length) {
        const hit = spec.enum.find((e) => String(e).toLowerCase() === v.trim().toLowerCase());
        if (hit === undefined) return { error: `Paramètre « ${name} » : choisir parmi ${spec.enum.join(', ')} (reçu « ${v.slice(0, 40)} »).` };
        v = hit;
      }
    }
    args[name] = v;
  }
  return { args };
}
