// Agent personnel Hermes (Nous Research, installé à part) : Jarvis lui confie les demandes longues, suit leur avancement et
// rapporte les réponses. C'est Hermes qui choisit et exécute ses outils ; Jarvis ne refait jamais une action de Hermes.
// Idée et API (/v1/capabilities, /v1/runs…) d'après l'intégration de Cornelius (lfpoulain/Cornelius, PolyForm Noncommercial 1.0.0) ;
// code réécrit pour Jarvis. Pas de relais des accords : ils se donnent directement dans Hermes.
import { done, failed } from '../core/safety.js';

export const MAX_TASKS = 100;
export const TERMINAL = new Set(['completed', 'failed', 'interrupted', 'stopped', 'cancelled', 'unknown']);
const KNOWN = new Set(['running', 'waiting_for_approval', 'completed', 'failed', 'interrupted', 'stopping', 'stopped', 'cancelled', 'queued', 'pending']);
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export const STATUS_LABEL = {
  queued: 'en attente', pending: 'en attente', running: 'en cours', waiting_for_approval: 'accord attendu', completed: 'terminée', failed: 'échouée',
  interrupted: 'interrompue', stopping: 'arrêt demandé', stopped: 'arrêtée', cancelled: 'annulée', unknown: 'état à vérifier',
};

const rec = (v) => (v && typeof v === 'object' ? v : {});
const arr = (v) => (Array.isArray(v) ? v : []);
const clean = (v, max = 4000) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);

/** Adresse de Hermes : https, ou http en boucle locale ; ni identifiants, ni paramètres ; « /v1 » final retiré. */
export function hermesUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { throw new Error('Adresse de Hermes invalide.'); }
  if (u.username || u.password || u.search || u.hash) throw new Error('L’adresse ne doit contenir ni identifiants, ni paramètres, ni fragment.');
  if (u.protocol === 'http:' && !LOOPBACK.has(u.hostname)) throw new Error('http:// n’est accepté que pour localhost : le jeton ne doit pas circuler en clair. Utilisez https:// pour une autre machine.');
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Protocole non pris en charge.');
  return u.toString().replace(/\/+$/, '').replace(/\/v1$/, '');
}

const mask = (token, text) => (token ? String(text).split(token).join('[masqué]') : String(text));

function explain(status) {
  if (status === 401 || status === 403) return 'Hermes a refusé le jeton ou les droits.';
  if (status === 404) return 'Ressource Hermes introuvable.';
  if (status === 409) return 'Hermes ne peut pas accepter cette demande dans son état actuel.';
  return `Hermes est indisponible (HTTP ${status || 'sans réponse'}).`;
}

/** Appel à Hermes : jeton en Bearer, 5 s, 256 Kio, aucune redirection. Lève une Error au message clair. */
export async function hermesRequest(conn, path, body, { fetcher, idempotencyKey } = {}) {
  const res = await fetcher({
    url: conn.url + path,
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${conn.token}`, 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    timeoutMs: 5000, maxBytes: 256 * 1024, maxRedirects: 0,
  });
  if (!res.ok) throw Object.assign(new Error(res.error && /adresse|redirection/i.test(res.error) ? 'Hermes redirige : utilisez son adresse finale.' : explain(res.status)), { status: res.status });
  const data = res.json || (() => { try { return JSON.parse(res.text); } catch { return null; } })();
  if (!data || typeof data !== 'object' || !Object.keys(data).length) throw new Error('Réponse Hermes vide ou illisible.');
  return data;
}

/** Capacités publiées par Hermes (lecture seule : rien n'est créé, aucun modèle ne travaille). */
export async function discover(conn, deps) {
  const base = { checkedAt: Date.now(), available: false, error: null, approval: false, steer: false, capabilities: [], partial: false };
  try {
    const caps = await hermesRequest(conn, '/v1/capabilities', undefined, deps);
    const f = rec(caps.features);
    if (f.run_submission !== true || f.run_status !== true || f.run_stop !== true) throw new Error('Cette version de Hermes doit exposer la création, le suivi et l’arrêt des tâches.');
    base.available = true;
    base.approval = f.run_approval_response === true || f.run_approval === true;
    base.steer = f.run_steer === true;
    const [toolsets, skills] = await Promise.allSettled([hermesRequest(conn, '/v1/toolsets', undefined, deps), hermesRequest(conn, '/v1/skills', undefined, deps)]);
    for (const [kind, r] of [['outil', toolsets], ['compétence', skills]]) {
      if (r.status === 'rejected' || !Array.isArray(r.value.data)) { base.partial = true; continue; }
      for (const e of r.value.data.slice(0, 200)) {
        const item = rec(e);
        if (item.enabled === false || item.available === false) continue;
        const name = clean(item.name || item.id, 80);
        if (name) base.capabilities.push({ kind, name, description: clean(item.description, 200) });
      }
    }
  } catch (err) {
    base.error = String(err.message || err);
  }
  return base;
}

/** Une réponse /v1/runs/{id} → état normalisé. Un état inconnu n'est jamais pris pour une réussite. */
export function parseRun(conn, data) {
  const raw = data.status === 'started' ? 'running' : data.status;
  const status = typeof raw === 'string' && KNOWN.has(raw) ? raw : 'unknown';
  const approval = rec(data.approval);
  return {
    status,
    output: clean(mask(conn.token, data.output ?? ''), 6000) || null,
    approval: status === 'waiting_for_approval' ? { id: clean(approval.request_id, 120) || null, description: clean(mask(conn.token, approval.description || approval.command || approval.message || approval.reason || 'Hermes demande votre accord pour poursuivre.'), 1000) } : null,
    error: status === 'failed' || status === 'interrupted' ? 'Hermes signale que cette tâche n’a pas abouti.' : status === 'unknown' ? 'État Hermes inconnu : aucune réussite ne peut être confirmée.' : null,
  };
}

export async function refreshTask(conn, task, deps) {
  if (!task.runId) return task;
  const data = await hermesRequest(conn, `/v1/runs/${encodeURIComponent(task.runId)}`, undefined, deps);
  return { ...task, ...parseRun(conn, data), updatedAt: Date.now() };
}

const view = (t) => `#${t.n} · ${STATUS_LABEL[t.status] || t.status}${t.approval ? ` — ${t.approval.description} (à accorder directement dans Hermes)` : ''}${t.output ? `\n${t.output}` : ''}${t.error ? `\n${t.error}` : ''}`;

/**
 * Outil « agent_hermes ». deps = { conn:{url,token,role,enabled}, fetcher, store:{get,set}, now }.
 * Actions : ask (message), status (task), stop (task), steer (task, message), list, discover.
 */
export async function runHermes(args, deps) {
  const { conn, fetcher, store } = deps;
  const act = String(args.action || 'status').toLowerCase();
  if (!conn?.enabled) return failed('agent_hermes', 'Hermes n’est pas activé : à configurer dans les Réglages (adresse, jeton, « Autoriser Jarvis à contacter Hermes »)');
  let c;
  try { c = { url: hermesUrl(conn.url), token: String(conn.token || '') }; } catch (e) { return failed('agent_hermes', e.message); }
  if (!c.token) return failed('agent_hermes', 'jeton Hermes manquant');
  const rq = { fetcher };
  const tasks = store.get() || [];
  const pick = (id) => (id ? tasks.find((t) => String(t.n) === String(id).replace('#', '')) : tasks[tasks.length - 1]);
  // Les réponses de Hermes ne sont pas enregistrées sur le disque : seules les références de tâches le sont.
  const save = (t) => {
    const { output, approval, error, ...kept } = t;
    const cur = store.get() || [];
    const next = cur.some((x) => x.n === kept.n) ? cur.map((x) => (x.n === kept.n ? kept : x)) : [...cur, kept];
    const overflow = Math.max(0, next.length - MAX_TASKS);
    const dropped = new Set(next.filter((x) => TERMINAL.has(x.status)).slice(0, overflow).map((x) => x.n));
    store.set(next.filter((x) => !dropped.has(x.n)));
  };
  try {
    if (act === 'discover') {
      const d = await discover(c, rq);
      return d.available
        ? done('agent_hermes', { action: 'discover', available: true, approval_relay: false, steer: d.steer, capabilities: d.capabilities.length, partial: d.partial })
          + '\n' + d.capabilities.slice(0, 40).map((x) => `• ${x.kind} ${x.name}${x.description ? ` : ${x.description}` : ''}`).join('\n')
        : failed('agent_hermes', d.error || 'Hermes indisponible');
    }
    if (act === 'list') return tasks.length ? 'Demandes récentes :\n' + tasks.slice(-15).reverse().map((t) => `• #${t.n} · ${STATUS_LABEL[t.status] || t.status}`).join('\n') : 'Aucune demande envoyée à Hermes.';
    if (act === 'ask') {
      const message = clean(args.message, 4000);
      if (!message) return failed('agent_hermes', 'message manquant');
      const n = (tasks.reduce((m, t) => Math.max(m, t.n), 0) || 0) + 1;
      const key = `jarvis-${Date.now()}-${n}`;
      const task = { n, key, sessionId: `jarvis-${key}`, runId: null, status: 'running', createdAt: Date.now(), updatedAt: Date.now(), announced: '' };
      save(task); // une fois envoyée, l'action peut s'exécuter même si Jarvis se ferme : la référence est gardée avant l'appel
      try {
        const data = await hermesRequest(c, '/v1/runs', {
          input: message, session_id: task.sessionId,
          instructions: `Réponds en français. La demande arrive via l’assistant Jarvis.${conn.role ? ` Rôle de cet agent : ${clean(conn.role, 300)}.` : ''} Donne une réponse claire, avec sources si utile. Gère tes actions, précisions et accords selon tes propres règles.`,
        }, { ...rq, idempotencyKey: key });
        const runId = clean(data.run_id, 120);
        if (!runId) throw new Error('Identifiant de tâche Hermes manquant.');
        const t = { ...task, runId };
        save(t);
        const fresh = await refreshTask(c, t, rq).catch(() => t);
        save(fresh);
        return done('agent_hermes', { action: 'ask', task: `#${n}`, state: STATUS_LABEL[fresh.status] }) + '\nL’état « en cours » ne veut pas dire que l’action a réussi : Hermes préviendra à la fin.';
      } catch (err) {
        save({ ...task, status: 'unknown', updatedAt: Date.now() });
        return failed('agent_hermes', `${err.message || err} La demande a peut-être été reçue : état à vérifier dans Hermes, elle ne sera pas renvoyée automatiquement.`);
      }
    }
    const t = pick(args.task);
    if (!t) return failed('agent_hermes', 'aucune demande correspondante');
    if (act === 'status') {
      const fresh = await refreshTask(c, t, rq);
      save(fresh);
      return view(fresh);
    }
    if (act === 'stop') {
      if (!t.runId) return failed('agent_hermes', 'demande sans identifiant Hermes');
      await hermesRequest(c, `/v1/runs/${encodeURIComponent(t.runId)}/stop`, {}, rq);
      save({ ...t, status: 'stopping', updatedAt: Date.now() });
      return done('agent_hermes', { action: 'stop', task: `#${t.n}`, note: 'arrêt demandé, pas action annulée' });
    }
    if (act === 'steer') {
      const message = clean(args.message, 2000);
      if (!message || !t.runId) return failed('agent_hermes', 'message ou demande manquants');
      const fresh = await refreshTask(c, t, rq);
      save(fresh);
      if (fresh.status !== 'running') return failed('agent_hermes', `la demande #${t.n} n’est plus en cours (${STATUS_LABEL[fresh.status]})`);
      const caps = await discover(c, rq);
      if (!caps.steer) return failed('agent_hermes', 'cette version de Hermes ne permet pas d’ajouter une précision en cours de route');
      await hermesRequest(c, `/v1/runs/${encodeURIComponent(t.runId)}/steer`, { input: message }, rq);
      return done('agent_hermes', { action: 'steer', task: `#${t.n}` });
    }
  } catch (err) {
    return failed('agent_hermes', String(err.message || err));
  }
  return failed('agent_hermes', 'action inconnue (ask, status, stop, steer, list, discover)');
}

/** Tâches actives à suivre et textes à annoncer quand un état change (une seule fois par état). */
export async function pollTasks(conn, store, fetcher) {
  const c = { url: hermesUrl(conn.url), token: String(conn.token || '') };
  const announcements = [];
  const list = store.get() || [];
  let changed = false;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (!t.runId || TERMINAL.has(t.status)) continue;
    let fresh;
    try { fresh = await refreshTask(c, t, { fetcher }); } catch { continue; }
    const stamp = `${fresh.status}:${fresh.approval?.id ?? ''}`;
    if (stamp !== t.announced && (TERMINAL.has(fresh.status) || fresh.status === 'waiting_for_approval')) {
      fresh.announced = stamp;
      announcements.push(`Hermes · demande #${fresh.n} ${STATUS_LABEL[fresh.status]}${fresh.approval ? ` : ${fresh.approval.description} — à accorder directement dans Hermes` : fresh.status === 'completed' ? ' : demande-moi la réponse.' : '.'}`);
    }
    const { output, approval, error, ...kept } = fresh;
    list[i] = kept;
    changed = true;
  }
  if (changed) store.set(list);
  return announcements;
}
