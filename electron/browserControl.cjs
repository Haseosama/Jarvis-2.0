'use strict';
// Navigateur piloté par Playwright, pour Jarvis sur le PC et pour Jarvis Android (POST /api/browser, electron/remoteServer.cjs).
//
// Playwright (paquet playwright-core, sans navigateur téléchargé) lance Edge ou Chrome déjà installés sur le PC, visibles, avec
// un profil à part dans les données de Jarvis : les connexions faites dans cette fenêtre restent d'une fois sur l'autre, sans
// toucher au profil habituel de l'utilisateur.
//
// La page se lit comme l'écran du téléphone (screen_read) : le texte visible, puis les éléments où l'on peut cliquer ou écrire,
// numérotés. Les numéros sont posés sur la page (attribut data-jarvis-ref) et servent aux actions suivantes ; un texte visible,
// une étiquette de champ ou un sélecteur CSS marchent aussi.

const fs = require('fs');

const ACTIONS = ['open', 'read', 'click', 'fill', 'press', 'scroll', 'back', 'forward', 'look', 'tabs', 'tab', 'close'];
const MAX_TEXT = 4000;
const MAX_ELEMENTS = 60;
const NAV_TIMEOUT_MS = 30_000;
const ACT_TIMEOUT_MS = 8_000;

const ALIASES = {
  ouvrir: 'open', aller: 'open', goto: 'open', navigate: 'open',
  lire: 'read', snapshot: 'read', etat: 'read', 'état': 'read',
  cliquer: 'click', clic: 'click', appuyer: 'click', tap: 'click',
  remplir: 'fill', ecrire: 'fill', 'écrire': 'fill', taper: 'fill', type: 'fill',
  touche: 'press', key: 'press',
  defiler: 'scroll', 'défiler': 'scroll',
  retour: 'back', precedent: 'back', 'précédent': 'back',
  suivant: 'forward',
  regarder: 'look', capture: 'look', screenshot: 'look',
  onglets: 'tabs',
  onglet: 'tab',
  fermer: 'close', quit: 'close',
};

function normalizeAction(raw) {
  const a = String(raw || '').trim().toLowerCase();
  if (!a) return 'read';
  return ACTIONS.includes(a) ? a : (ALIASES[a] || null);
}

/** Une adresse à ouvrir : une URL http(s), un nom de domaine (https:// ajouté), sinon une recherche Google. */
function normalizeUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^localhost(:\d+)?([/?#]|$)/i.test(s)) return `http://${s}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[^\s/]+\.[a-z]{2,}(:\d+)?([/?#]|$)/i.test(s)) return null; // file:, javascript:, chrome:…
  if (!/\s/.test(s) && /^[^\s/]+\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(s)) return `https://${s}`;
  return `https://www.google.com/search?q=${encodeURIComponent(s)}`;
}

/** Ce que désigne la cible : un numéro de la dernière lecture, un sélecteur CSS explicite, ou un texte. */
function parseTarget(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const n = s.replace(/^[#[(]?\s*/, '').replace(/\s*[\])]?$/, '');
  if (/^\d{1,4}$/.test(n)) return { ref: Number(n) };
  if (/^css[:=]/i.test(s)) return { css: s.replace(/^css[:=]\s*/i, '') };
  return { text: s };
}

/** Le texte rendu au modèle pour une lecture de page. */
function formatSnapshot(snap, { maxText = MAX_TEXT } = {}) {
  const lines = [`Page : ${snap.title || '(sans titre)'} — ${snap.url}`];
  const text = String(snap.text || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (text) lines.push('', 'Texte :', text.length > maxText ? `${text.slice(0, maxText)}…` : text);
  if (snap.elements?.length) {
    lines.push('', 'Éléments :');
    for (const e of snap.elements) {
      const kind = e.kind ? `${e.kind} ` : '';
      const value = e.value ? ` = « ${e.value} »` : '';
      lines.push(`[${e.ref}] ${kind}« ${e.label || '(sans nom)'} »${value}`);
    }
    if (snap.more) lines.push(`(+${snap.more} autres éléments plus bas : faites défiler)`);
  }
  return lines.join('\n');
}

// Exécuté dans la page : numérote les éléments visibles où l'on peut agir et renvoie le texte visible.
/* c8 ignore start */
function snapshotInPage(max) {
  const sel = 'a[href], button, input:not([type=hidden]), textarea, select, summary, [role=button], [role=link], [role=checkbox], '
    + '[role=radio], [role=tab], [role=menuitem], [role=option], [role=switch], [role=textbox], [role=combobox], [contenteditable=""], [contenteditable=true], [onclick]';
  document.querySelectorAll('[data-jarvis-ref]').forEach((el) => el.removeAttribute('data-jarvis-ref'));
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.05;
  };
  const inView = (el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight * 1.5 && r.right > 0 && r.left < innerWidth;
  };
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const labelOf = (el) => {
    const aria = el.getAttribute('aria-label') || el.getAttribute('title');
    if (aria) return clean(aria);
    if (el.labels && el.labels.length) return clean(el.labels[0].innerText);
    const by = el.getAttribute('aria-labelledby');
    if (by) { const t = by.split(/\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' '); if (clean(t)) return clean(t); }
    const own = clean(el.innerText || el.value);
    if (own && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return own;
    if (el.placeholder) return clean(el.placeholder);
    const img = el.querySelector && el.querySelector('img[alt]');
    if (img) return clean(img.alt);
    return clean(el.name || el.id || own);
  };
  const kindOf = (el) => {
    const role = el.getAttribute('role');
    const tag = el.tagName.toLowerCase();
    if (tag === 'a' || role === 'link') return 'lien';
    if (tag === 'select' || role === 'combobox') return 'liste';
    if (tag === 'textarea' || el.isContentEditable || role === 'textbox') return 'champ';
    if (tag === 'input') {
      const t = (el.type || 'text').toLowerCase();
      if (t === 'checkbox' || t === 'radio') return el.checked ? 'case cochée' : 'case';
      if (['submit', 'button', 'reset', 'image'].includes(t)) return 'bouton';
      return t === 'password' ? 'champ mot de passe' : 'champ';
    }
    if (role === 'checkbox' || role === 'switch') return el.getAttribute('aria-checked') === 'true' ? 'case cochée' : 'case';
    if (role === 'tab') return 'onglet';
    return 'bouton';
  };
  const all = Array.from(document.querySelectorAll(sel)).filter(visible);
  const shown = all.filter(inView);
  const elements = [];
  let ref = 0;
  for (const el of shown) {
    if (elements.length >= max) break;
    ref += 1;
    el.setAttribute('data-jarvis-ref', String(ref));
    const kind = kindOf(el);
    let value = '';
    if (el.tagName === 'SELECT') value = clean(el.options[el.selectedIndex]?.text);
    else if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.type !== 'password') value = clean(el.value);
    elements.push({ ref, kind, label: labelOf(el), value });
  }
  return {
    title: document.title,
    url: location.href,
    text: document.body ? document.body.innerText : '',
    elements,
    more: Math.max(0, all.length - elements.length),
  };
}
/* c8 ignore stop */

/** Les navigateurs essayés, dans l'ordre : celui demandé (JARVIS_BROWSER = chemin d'un exécutable), Edge, Chrome. */
function launchCandidates(env = process.env) {
  const list = [];
  if (env.JARVIS_BROWSER) list.push({ executablePath: env.JARVIS_BROWSER });
  list.push({ channel: 'msedge' }, { channel: 'chrome' });
  return list;
}

function createBrowserControl({ profileDir, loadPlaywright = () => require('playwright-core'), headless = false, env = process.env } = {}) {
  let context = null;
  let page = null;
  let starting = null;

  async function launch() {
    const { chromium } = loadPlaywright();
    if (profileDir) fs.mkdirSync(profileDir, { recursive: true });
    let lastError = null;
    for (const choice of launchCandidates(env)) {
      try {
        return await chromium.launchPersistentContext(profileDir || '', { ...choice, headless, viewport: null, args: ['--start-maximized'] });
      } catch (err) {
        lastError = err;
      }
    }
    const e = new Error(`Aucun navigateur utilisable (Edge ou Chrome) : ${String(lastError?.message || lastError).split('\n')[0]}`);
    e.code = 'NO_BROWSER';
    throw e;
  }

  async function ensure() {
    if (context && page && !page.isClosed()) return page;
    if (!context) {
      if (!starting) starting = launch().finally(() => { starting = null; });
      context = await starting;
      context.on('close', () => { context = null; page = null; });
      context.on('page', (p) => { page = p; }); // un lien qui ouvre un nouvel onglet : on le suit
    }
    const pages = context.pages().filter((p) => !p.isClosed());
    page = pages[pages.length - 1] || await context.newPage();
    return page;
  }

  async function snapshot(p) {
    try { await p.waitForLoadState('domcontentloaded', { timeout: 5_000 }); } catch {}
    return p.evaluate(snapshotInPage, MAX_ELEMENTS);
  }

  async function locate(p, target, { forFill = false } = {}) {
    if (target.ref !== undefined) {
      const loc = p.locator(`[data-jarvis-ref="${target.ref}"]`);
      if (await loc.count()) return loc.first();
      throw new Error(`L'élément ${target.ref} n'existe plus : relisez la page.`);
    }
    if (target.css) return p.locator(target.css).first();
    const name = target.text;
    const tries = forFill
      ? [p.getByLabel(name), p.getByPlaceholder(name), p.getByRole('textbox', { name }), p.getByRole('searchbox', { name }), p.getByRole('combobox', { name })]
      : [p.getByRole('button', { name }), p.getByRole('link', { name }), p.getByRole('tab', { name }), p.getByRole('menuitem', { name }),
        p.getByRole('checkbox', { name }), p.getByLabel(name), p.getByText(name, { exact: true }), p.getByText(name)];
    for (const loc of tries) {
      try {
        const visible = loc.filter({ visible: true });
        if (await visible.count()) return visible.first();
      } catch {}
    }
    throw new Error(`Rien trouvé sur la page pour « ${name} » : relisez la page et donnez le numéro de l'élément.`);
  }

  async function settle(p) {
    try { await p.waitForLoadState('domcontentloaded', { timeout: 4_000 }); } catch {}
    try { await p.waitForTimeout(400); } catch {}
  }

  const done = async (p, message) => {
    const snap = await snapshot(page && !page.isClosed() ? page : p);
    return { ok: true, message, title: snap.title, url: snap.url, text: `${message}\n\n${formatSnapshot(snap)}` };
  };

  /**
   * Une action sur le navigateur : { action, url, target, value, key, direction, submit, index }. Renvoie toujours un objet
   * { ok, text, … } : text est une phrase ou la page lue, prête pour le modèle ; une capture (look) ajoute jpegBase64.
   */
  async function run(input = {}) {
    const action = normalizeAction(input.action);
    if (!action) return { ok: false, text: `Action inconnue « ${input.action} » : ${ACTIONS.join(', ')}.` };
    try {
      if (action === 'close') {
        if (context) await context.close().catch(() => {});
        context = null; page = null;
        return { ok: true, text: 'Navigateur fermé.' };
      }
      if (action === 'open') {
        const url = normalizeUrl(input.url ?? input.target);
        if (!url) return { ok: false, text: 'Quelle adresse ouvrir ? (une URL http ou https, un site, ou des mots à chercher)' };
        const p = await ensure();
        await p.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
        return done(p, `Ouvert : ${url}`);
      }
      const p = await ensure();
      p.setDefaultTimeout(ACT_TIMEOUT_MS);
      switch (action) {
        case 'read': {
          const snap = await snapshot(p);
          return { ok: true, title: snap.title, url: snap.url, text: formatSnapshot(snap) };
        }
        case 'click': {
          const target = parseTarget(input.target ?? input.index ?? input.text);
          if (!target) return { ok: false, text: 'Sur quoi cliquer ? Donnez le numéro de l’élément (lecture de la page) ou son texte.' };
          const loc = await locate(p, target);
          await loc.click();
          await settle(p);
          return done(p, 'Clic fait.');
        }
        case 'fill': {
          const target = parseTarget(input.target ?? input.index ?? input.text);
          if (!target) return { ok: false, text: 'Quel champ remplir ? Donnez son numéro ou son étiquette.' };
          const value = String(input.value ?? '');
          const loc = await locate(p, target, { forFill: true });
          const tag = await loc.evaluate((el) => el.tagName).catch(() => '');
          if (tag === 'SELECT') await loc.selectOption({ label: value }).catch(() => loc.selectOption(value));
          else await loc.fill(value);
          if (input.submit === true || input.submit === 'true') { await loc.press('Enter'); await settle(p); }
          return done(p, input.submit ? 'Champ rempli et validé.' : 'Champ rempli.');
        }
        case 'press': {
          const key = String(input.key || input.value || 'Enter').trim();
          await p.keyboard.press(key);
          await settle(p);
          return done(p, `Touche ${key} appuyée.`);
        }
        case 'scroll': {
          const up = /^(up|haut|monter)/i.test(String(input.direction || ''));
          await p.mouse.wheel(0, up ? -700 : 700);
          await p.waitForTimeout(300);
          return done(p, up ? 'Défilé vers le haut.' : 'Défilé vers le bas.');
        }
        case 'back':
        case 'forward': {
          const r = action === 'back' ? await p.goBack({ timeout: NAV_TIMEOUT_MS }) : await p.goForward({ timeout: NAV_TIMEOUT_MS });
          return done(p, r ? (action === 'back' ? 'Page précédente.' : 'Page suivante.') : 'Pas d’autre page dans l’historique.');
        }
        case 'look': {
          const jpeg = await p.screenshot({ type: 'jpeg', quality: 60 });
          return { ok: true, title: await p.title(), url: p.url(), jpegBase64: jpeg.toString('base64'), text: `Capture de la page ${p.url()}.` };
        }
        case 'tabs': {
          const pages = context.pages();
          const lines = await Promise.all(pages.map(async (x, i) => `[${i + 1}] ${await x.title().catch(() => '')} — ${x.url()}${x === p ? ' (actuel)' : ''}`));
          return { ok: true, text: `Onglets :\n${lines.join('\n')}` };
        }
        case 'tab': {
          const i = Number.parseInt(input.index ?? input.target, 10);
          const pages = context.pages();
          if (!(i >= 1 && i <= pages.length)) return { ok: false, text: `Onglet ${input.index ?? input.target} inconnu (1 à ${pages.length}).` };
          page = pages[i - 1];
          await page.bringToFront();
          return done(page, `Onglet ${i}.`);
        }
        default:
          return { ok: false, text: `Action inconnue « ${input.action} ».` };
      }
    } catch (err) {
      const msg = String(err?.message || err).split('\n')[0];
      if (err?.code === 'NO_BROWSER') return { ok: false, text: `${msg}. Installez Microsoft Edge ou Google Chrome sur le PC.` };
      if (/Cannot find module 'playwright-core'/.test(msg)) return { ok: false, text: 'Playwright n’est pas installé avec Jarvis 2.0 (npm install).' };
      return { ok: false, text: `Le navigateur n'a pas pu le faire : ${msg}` };
    }
  }

  async function close() {
    if (context) await context.close().catch(() => {});
    context = null; page = null;
  }

  return { run, close, isOpen: () => Boolean(context) };
}

module.exports = { createBrowserControl, normalizeAction, normalizeUrl, parseTarget, formatSnapshot, launchCandidates, snapshotInPage, ACTIONS };
