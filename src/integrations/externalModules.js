// Outil « external_module » : les modules externes au contrat apiVersion 1 de Cornelius (dépôt cornelius-modules) dans Jarvis.
// Le code des modules tourne dans un processus séparé (electron/moduleHost.cjs) ; ici : sources, relevés en cache, mise en phrase.
// Idée et contrat d'après Cornelius (lfpoulain/Cornelius, PolyForm Noncommercial 1.0.0) ; code réécrit pour Jarvis.
import { done, failed } from '../core/safety.js';

export const MAX_SOURCES = 30;
const CODE_LABEL = { config_invalid: 'Réglage incomplet', auth: 'Identifiants refusés', forbidden: 'Accès refusé', not_found: 'Introuvable', invalid_params: 'Requête invalide', quota: 'Limite d’utilisation atteinte', timeout: 'Le service a mis trop de temps à répondre', unavailable: 'Le service ne répond pas', malformed: 'Réponse illisible', upstream: 'Le service ne répond pas' };

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export const refOf = (name) => fold(name).slice(0, 40);

const errorText = (e) => `${CODE_LABEL[e?.code] || 'Erreur'} : ${String(e?.message || 'échec du module').slice(0, 300)}`;

function describeSchema(schema) {
  const required = new Set(schema?.required || []);
  return Object.entries(schema?.properties || {}).map(([key, p]) => {
    const choices = Array.isArray(p.enum) ? ` (choix : ${p.enum.join(', ')})` : Array.isArray(p.oneOf) ? ` (choix : ${p.oneOf.map((o) => o.const ?? 'vide').join(', ')})` : '';
    const type = Array.isArray(p.type) ? p.type.join('|') : p.type;
    return `• ${key}${required.has(key) ? ' *' : ''} [${type}]${choices} — ${p.title || ''}${p.description ? ` : ${p.description}` : ''}`;
  }).join('\n');
}

function cardText(card, { stale = false, ambient = false } = {}) {
  const lines = [stale ? 'Dernier relevé connu (la source ne répond pas).' : null, card.summary, ...(card.items || []).map((i) => `${i.label} : ${i.value}`)].filter(Boolean);
  return ambient ? lines.slice(1).join('\n') : lines.join('\n');
}

/**
 * deps = { host(req) → { ok, result | error }, store:{ sources: {get,set}, snapshots: {get,set} }, secrets() → {name: valeur}, timeZone, now }.
 * Actions : list, describe (module), add (module, name, config JSON), remove (name), read (name ou module, query, args JSON), ambient (name, on).
 */
export async function runExternalModules(args, deps) {
  const act = String(args.action || 'list').toLowerCase();
  const now = deps.now ? deps.now() : Date.now();
  const sources = deps.store.sources.get() || [];
  const snaps = deps.store.snapshots.get() || {};
  const host = async (req) => deps.host(req);

  const listing = await host({ op: 'list' });
  if (!listing.ok) return failed('external_module', errorText(listing.error));
  const { modules, failed: bad } = listing.result;
  const byId = new Map(modules.map((m) => [m.id, m]));
  const parseJson = (raw, what) => {
    if (raw === undefined || raw === null || raw === '') return {};
    if (typeof raw === 'object') return raw;
    try { const v = JSON.parse(String(raw)); return v && typeof v === 'object' ? v : null; } catch { return null; }
  };

  if (act === 'list') {
    const mod = modules.map((m) => `• ${m.id} — ${m.display?.name || m.sourceLabel}${m.display?.description ? ` : ${m.display.description}` : ''}${m.secrets.length ? ` (jeton : ${m.secrets.map((s) => s.label).join(', ')})` : ''}`).join('\n') || 'Aucun module chargé.';
    const src = sources.length ? '\nSources :\n' + sources.map((s) => `• ${s.name} (${s.moduleId})${s.ambient ? ' · affichage permanent' : ''}`).join('\n') : '\nAucune source.';
    const ko = bad.length ? '\nNon chargés :\n' + bad.map((b) => `• ${b.dir} : ${b.reason}`).join('\n') : '';
    return `Modules :\n${mod}${src}${ko}`;
  }
  if (act === 'describe') {
    const m = byId.get(String(args.module || ''));
    if (!m) return failed('external_module', `module « ${args.module} » inconnu (action=list)`);
    return `${m.display?.name || m.id} — réglages d’une source (* obligatoire) :\n${describeSchema(m.configSchema)}\nValeurs par défaut : ${JSON.stringify(m.configDefaults)}\nExemple de nom : ${m.display?.example?.label || m.id}`;
  }
  if (act === 'add') {
    const m = byId.get(String(args.module || ''));
    if (!m) return failed('external_module', `module « ${args.module} » inconnu (action=list)`);
    const name = String(args.name || m.display?.example?.label || m.display?.name || m.id).trim().slice(0, 40);
    const ref = refOf(args.ref || name);
    if (!ref) return failed('external_module', 'nom de source invalide');
    if (sources.some((s) => s.ref === ref)) return failed('external_module', `une source « ${ref} » existe déjà`);
    if (sources.length >= MAX_SOURCES) return failed('external_module', `limite de ${MAX_SOURCES} sources atteinte`);
    const config = parseJson(args.config);
    if (config === null) return failed('external_module', 'config doit être un objet JSON (voir action=describe)');
    const merged = { ...m.configDefaults, ...config };
    const secrets = deps.secrets ? await deps.secrets() : {};
    const missing = m.secrets.filter((s) => !secrets[s.name]);
    if (missing.length) return failed('external_module', `jeton manquant : ${missing.map((s) => `${s.label}${s.url ? ` (${s.url})` : ''}`).join(', ')} — à saisir dans les Réglages › Modules externes`);
    // Un essai à l'ajout : une source invalide ou un service hors ligne se voit tout de suite.
    const probe = await host({ op: 'read', id: m.id, config: merged, secrets, instance: { name, ref }, timeZone: deps.timeZone, now });
    if (!probe.ok) return failed('external_module', `la source n’a pas pu être lue : ${errorText(probe.error)}`);
    deps.store.sources.set([...sources, { ref, name, moduleId: m.id, config: merged, ambient: false, createdAt: now }]);
    deps.store.snapshots.set({ ...snaps, [ref]: { snapshot: probe.result.snapshot, at: now, freshMs: probe.result.freshMs } });
    return done('external_module', { action: 'add', source: name, ref }) + `\n${cardText(probe.result.card)}`;
  }
  const find = () => {
    const wanted = refOf(args.name || args.ref || '');
    return sources.find((s) => s.ref === wanted) || sources.find((s) => s.ref.includes(wanted) && wanted) || sources.find((s) => s.moduleId === refOf(args.module || args.name || '')) || (sources.length === 1 && !wanted ? sources[0] : null);
  };
  if (act === 'remove') {
    const s = find();
    if (!s) return failed('external_module', `aucune source « ${args.name} »`);
    deps.store.sources.set(sources.filter((x) => x.ref !== s.ref));
    const { [s.ref]: _drop, ...rest } = snaps;
    deps.store.snapshots.set(rest);
    return done('external_module', { action: 'remove', source: s.name });
  }
  if (act === 'ambient') {
    const s = find();
    if (!s) return failed('external_module', `aucune source « ${args.name} »`);
    if (args.on !== false && !byId.get(s.moduleId)?.ambient) return failed('external_module', 'ce module ne propose pas d’affichage permanent');
    deps.store.sources.set(sources.map((x) => (x.ref === s.ref ? { ...x, ambient: args.on !== false } : x)));
    return done('external_module', { action: 'ambient', source: s.name, on: args.on !== false });
  }
  if (act === 'read') {
    const s = find();
    if (!s) return failed('external_module', sources.length > 1 && !args.name ? 'plusieurs sources existent : préciser laquelle (action=list)' : `aucune source « ${args.name || args.module || ''} » (action=list)`);
    const m = byId.get(s.moduleId);
    if (!m) return failed('external_module', `le module « ${s.moduleId} » n’est plus chargé`);
    const toolArgs = parseJson(args.args);
    if (toolArgs === null) return failed('external_module', 'args doit être un objet JSON');
    const instance = { name: s.name, ref: s.ref };
    const cached = snaps[s.ref];
    const onDemand = args.query !== undefined || Object.keys(toolArgs).length > 0;
    if (cached && !onDemand && now - cached.at < cached.freshMs) {
      const p = await host({ op: 'present', id: s.moduleId, snapshot: cached.snapshot, instance, timeZone: deps.timeZone, now });
      if (p.ok) return `${done('external_module', { source: s.name, cache: true })}\n${cardText(p.result.card)}`;
    }
    const secrets = deps.secrets ? await deps.secrets() : {};
    const r = await host({ op: 'read', id: s.moduleId, config: s.config, secrets, query: args.query, args: Object.keys(toolArgs).length ? toolArgs : undefined, instance, timeZone: deps.timeZone, now });
    if (r.ok) {
      if (!onDemand) deps.store.snapshots.set({ ...snaps, [s.ref]: { snapshot: r.result.snapshot, at: now, freshMs: r.result.freshMs } });
      return `${done('external_module', { source: s.name })}\n${cardText(r.result.card)}`;
    }
    // Une panne n'efface pas ce qu'on savait : dernier relevé connu, annoncé comme tel.
    if (cached && !onDemand) {
      const p = await host({ op: 'present', id: s.moduleId, snapshot: { ...cached.snapshot, status: 'stale' }, instance, timeZone: deps.timeZone, now });
      if (p.ok) return `${done('external_module', { source: s.name, stale: true })}\n${cardText(p.result.card, { stale: true })}\n(${errorText(r.error)})`;
    }
    return failed('external_module', errorText(r.error));
  }
  return failed('external_module', 'action inconnue (list, describe, add, remove, read, ambient)');
}
