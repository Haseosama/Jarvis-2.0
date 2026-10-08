'use strict';
// Génération d'images pour Jarvis Android (POST /api/image, electron/remoteServer.cjs).
//
// Jarvis ne fait pas les images lui-même : il passe la demande à un générateur installé sur ce PC, trouvé tout seul à son
// adresse habituelle (ou à JARVIS_SD_URL / au réglage imageServerUrl) :
//  - Stable Diffusion WebUI Forge, AUTOMATIC1111 ou SD.Next lancés avec --api (http://127.0.0.1:7860, /sdapi/v1/txt2img) ;
//  - ComfyUI (http://127.0.0.1:8188) : un graphe texte → image simple avec le premier modèle installé (ou JARVIS_COMFY_MODEL),
//    mis en file par /prompt, suivi par /history, l'image lue par /view (aperçu temporaire, rien n'est rangé dans output/) ;
//  - Fooocus par Fooocus-API (http://127.0.0.1:8888, /v1/generation/text-to-image) : Fooocus seul n'a pas d'API.
// Seul du texte entre : aucune photo, donc aucune image tirée d'une vraie personne.
//
// Le contenu adulte n'est permis que si le téléphone l'a activé (« adult »). Dans tous les cas, une demande qui parle d'enfant
// ou de mineur est refusée, et l'invite négative écarte toujours les corps et visages juvéniles.

const CANDIDATES = [
  { kind: 'forge', url: 'http://127.0.0.1:7860' },
  { kind: 'comfy', url: 'http://127.0.0.1:8188' },
  { kind: 'comfy', url: 'http://127.0.0.1:8000' }, // ComfyUI Desktop (l'application) écoute sur 8000
  { kind: 'fooocus', url: 'http://127.0.0.1:8888' },
];
const MAX_PROMPT = 1500;
const TIMEOUT_MS = 170_000;

// Mots (français et anglais) qui désignent un enfant ou un mineur : la demande est refusée, réglage adulte ou non.
const MINOR_WORDS = [
  'enfant', 'enfants', 'gamin', 'gamine', 'gosse', 'mineur', 'mineure', 'mineurs', 'mineures', 'bébé', 'bebe', 'fillette',
  'petite fille', 'petit garçon', 'petit garcon', 'ado', 'ados', 'adolescent', 'adolescente', 'adolescents', 'collégien',
  'collegien', 'collégienne', 'collegienne', 'lycéen', 'lyceen', 'lycéenne', 'lyceenne', 'écolière', 'ecoliere', 'écolier', 'ecolier',
  'child', 'children', 'kid', 'kids', 'minor', 'minors', 'underage', 'under age', 'teen', 'teens', 'teenager', 'teenage', 'preteen',
  'young girl', 'young boy', 'little girl', 'little boy', 'schoolgirl', 'schoolboy', 'toddler', 'baby', 'infant', 'loli', 'lolita',
  'shota', 'jailbait', 'juvenile', 'pubescent', 'prepubescent',
];
// Un âge écrit sous 18 ans (« 15 ans », « 16 years old », « 17yo »).
const UNDERAGE_AGE = /\b(?:[0-9]|1[0-7])\s*(?:ans|an|years?\s*old|y\.?o\.?|yrs?)\b/i;
const EXPLICIT_WORDS = [
  'nu', 'nue', 'nus', 'nues', 'nudité', 'nudite', 'sexe', 'sexuel', 'sexuelle', 'érotique', 'erotique', 'porno', 'seins', 'topless',
  'nude', 'naked', 'nudity', 'nsfw', 'sex', 'sexual', 'erotic', 'porn', 'explicit', 'breasts', 'nipples', 'lingerie', 'hentai',
];

const ALWAYS_NEGATIVE = 'child, children, kid, minor, underage, teen, teenager, young girl, young boy, loli, childlike, '
  + 'baby face, petite child body, school uniform';
const SAFE_NEGATIVE = 'nsfw, nude, naked, nudity, nipples, sexual, explicit, erotic, lingerie';

function normalize(text) {
  return ` ${String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
}

function hasWord(text, words) {
  const t = normalize(text);
  return words.some((w) => t.includes(` ${normalize(w).trim()} `));
}

/** Pourquoi refuser cette demande, ou null si elle passe. */
function refusal(prompt, adult) {
  const p = String(prompt || '');
  if (!p.trim()) return 'Décrivez l’image à créer.';
  if (hasWord(p, MINOR_WORDS) || UNDERAGE_AGE.test(p)) {
    return 'Refusé : je ne crée aucune image d’enfant ni de mineur.';
  }
  if (!adult && hasWord(p, EXPLICIT_WORDS)) {
    return 'Le contenu adulte est désactivé : activez-le dans Jarvis Android (Réglages > Images IA) pour ce genre d’image.';
  }
  return null;
}

function clampInt(v, min, max, def) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

/** Le corps envoyé à /sdapi/v1/txt2img. Taille multiple de 64, 512 à 1536. */
function txt2imgBody(input = {}) {
  const adult = input.adult === true;
  const negative = [String(input.negative || '').trim().slice(0, 600), ALWAYS_NEGATIVE, adult ? '' : SAFE_NEGATIVE]
    .filter(Boolean).join(', ');
  const side = (v, d) => Math.round(clampInt(v, 512, 1536, d) / 64) * 64;
  return {
    prompt: String(input.prompt || '').trim().slice(0, MAX_PROMPT),
    negative_prompt: negative,
    width: side(input.width, 832),
    height: side(input.height, 1216),
    steps: clampInt(input.steps, 10, 50, 25),
    cfg_scale: 6,
    seed: clampInt(input.seed, -1, 2 ** 31 - 1, -1),
    batch_size: 1,
    n_iter: 1,
    save_images: false,
    send_images: true,
  };
}

/** Le graphe ComfyUI (format API) d'une image texte → image avec le modèle `ckpt`. */
function comfyWorkflow(body, ckpt) {
  return {
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
    2: { class_type: 'CLIPTextEncode', inputs: { text: body.prompt, clip: ['1', 1] } },
    3: { class_type: 'CLIPTextEncode', inputs: { text: body.negative_prompt, clip: ['1', 1] } },
    4: { class_type: 'EmptyLatentImage', inputs: { width: body.width, height: body.height, batch_size: 1 } },
    5: {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0],
        seed: body.seed >= 0 ? body.seed : Math.floor(Math.random() * 2 ** 31), steps: body.steps, cfg: body.cfg_scale,
        sampler_name: 'euler_ancestral', scheduler: 'normal', denoise: 1,
      },
    },
    6: { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    7: { class_type: 'PreviewImage', inputs: { images: ['6', 0] } },
  };
}

/** Le corps envoyé à Fooocus-API (/v1/generation/text-to-image), réponse synchrone en base64. */
const FOOOCUS_SIZES = [[704, 1408], [768, 1344], [832, 1216], [896, 1152], [1024, 1024], [1152, 896], [1216, 832], [1344, 768]];

function fooocusBody(body) {
  const ratio = body.width / body.height;
  const [w, h] = FOOOCUS_SIZES.reduce((best, s) => (Math.abs(s[0] / s[1] - ratio) < Math.abs(best[0] / best[1] - ratio) ? s : best));
  return {
    prompt: body.prompt,
    negative_prompt: body.negative_prompt,
    aspect_ratios_selection: `${w}*${h}`, // Fooocus n'accepte que ses formats
    image_number: 1,
    image_seed: body.seed,
    require_base64: true,
    async_process: false,
  };
}

const NONE_FOUND = 'Aucun générateur d’images trouvé sur le PC. Lancez Fooocus (avec Fooocus-API), ComfyUI, ou Stable Diffusion '
  + 'WebUI Forge avec l’option --api, puis réessayez.';

const NONE_FOUND_INSTALL = 'Aucun générateur d’images sur le PC. Jarvis peut installer ComfyUI lui-même (environ 9 Go à '
  + 'télécharger) : demandez « installe le générateur d’images ».';

function createImageGen({
  baseUrl = () => process.env.JARVIS_SD_URL || '',
  comfyModel = () => process.env.JARVIS_COMFY_MODEL || '',
  fetchImpl = globalThis.fetch,
  timeoutMs = TIMEOUT_MS,
  pollMs = 1000,
  installer = null, // electron/imageInstall.cjs : ComfyUI installé et lancé par Jarvis
} = {}) {
  const value = (v) => String((typeof v === 'function' ? v() : v) || '').trim();
  let found = null; // { kind, url } trouvé la dernière fois

  async function call(url, init = {}, ms = timeoutMs) {
    return fetchImpl(url, { ...init, signal: AbortSignal.timeout(ms) });
  }

  /** Quel générateur répond à cette adresse, ou null. */
  async function probe(url, only = null) {
    const tries = [
      ['forge', '/sdapi/v1/sd-models'],
      ['comfy', '/system_stats'],
      ['fooocus', '/ping'],
    ].filter(([k]) => !only || k === only);
    for (const [kind, path] of tries) {
      try {
        const r = await call(url + path, {}, 2500);
        if (r.ok) return { kind, url };
      } catch { /* rien à cette adresse */ }
    }
    return null;
  }

  async function locate() {
    const own = value(baseUrl).replace(/\/+$/, '');
    if (own) return probe(own);
    if (found && (await probe(found.url, found.kind))) return found;
    for (const c of CANDIDATES) {
      const hit = await probe(c.url, c.kind);
      if (hit) return hit;
    }
    // Rien ne tourne : le ComfyUI que Jarvis a installé démarre à la demande.
    if (installer && installer.installed() && (await installer.ensureRunning())) return probe(CANDIDATES[1].url, 'comfy');
    return null;
  }

  function installState() {
    if (!installer) return { ok: false, text: 'Cette version de Jarvis 2.0 n’installe pas de générateur d’images.' };
    const s = installer.status();
    if (s.installed) return { ok: true, text: 'Le générateur d’images (ComfyUI) est installé sur le PC.' };
    if (s.installing) return { ok: true, text: `Installation en cours : ${s.text}` };
    if (s.step === 'error') return { ok: false, text: `L’installation a échoué : ${s.text}` };
    return { ok: false, text: 'Aucun générateur d’images installé sur le PC.' };
  }

  async function forge(url, body) {
    const res = await call(`${url}/sdapi/v1/txt2img`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (res.status === 404) return { error: 'Le générateur d’images du PC n’a pas son API ouverte : relancez-le avec l’option --api.' };
    if (!res.ok) return { error: `Forge a échoué (code ${res.status}).` };
    const data = await res.json();
    let seed = null;
    try { seed = JSON.parse(data.info || '{}').seed ?? null; } catch { /* info absent */ }
    return { png: Array.isArray(data.images) ? data.images[0] : '', seed };
  }

  /** Le texte d'une erreur de ComfyUI (réponse 400 de /prompt : error.message + node_errors). */
  async function comfyProblem(res) {
    try {
      const data = await res.json();
      const first = Object.values(data?.node_errors || {})[0]?.errors?.[0];
      const detail = first?.details || first?.message || data?.error?.details || data?.error?.message;
      return detail ? String(detail).slice(0, 200) : '';
    } catch { return ''; }
  }

  /** Les modèles de ComfyUI : /models/checkpoints (stable), sinon la liste de /object_info (deux formes selon la version). */
  async function comfyModels(url) {
    try {
      const r = await call(`${url}/models/checkpoints`, {}, 10_000);
      if (r.ok) {
        const list = await r.json();
        if (Array.isArray(list) && list.length) return list.map(String);
      }
    } catch { /* on essaie object_info */ }
    const info = await (await call(`${url}/object_info/CheckpointLoaderSimple`, {}, 10_000)).json();
    const spec = info?.CheckpointLoaderSimple?.input?.required?.ckpt_name;
    if (Array.isArray(spec?.[0])) return spec[0].map(String);
    if (Array.isArray(spec?.[1]?.options)) return spec[1].options.map(String); // forme « COMBO » des versions récentes
    return [];
  }

  async function comfy(url, body) {
    let ckpt = value(comfyModel);
    if (!ckpt) {
      const names = await comfyModels(url);
      // Le modèle que Jarvis installe d'abord, sinon le premier trouvé.
      ckpt = names.find((n) => /juggernaut/i.test(n)) || names[0] || '';
    }
    if (!ckpt) return { error: 'ComfyUI n’a aucun modèle installé (dossier models/checkpoints).' };
    const graph = comfyWorkflow(body, ckpt);
    const queued = await call(`${url}/prompt`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: graph, client_id: 'jarvis' }),
    });
    if (!queued.ok) {
      const why = await comfyProblem(queued);
      return { error: `ComfyUI a refusé la demande (code ${queued.status})${why ? ` : ${why}` : ''}.` };
    }
    const id = (await queued.json()).prompt_id;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollMs));
      const hist = await (await call(`${url}/history/${encodeURIComponent(id)}`, {}, 10_000)).json();
      const entry = hist && hist[id];
      if (!entry) continue;
      if (entry.status?.status_str === 'error') {
        const msg = (entry.status.messages || []).find((m) => m?.[0] === 'execution_error')?.[1];
        const why = msg?.exception_message ? String(msg.exception_message).trim().slice(0, 200) : '';
        return { error: `ComfyUI a échoué en créant l’image${why ? ` : ${why}` : ''}.` };
      }
      const img = Object.values(entry.outputs || {}).flatMap((o) => o.images || [])[0];
      if (!img) {
        if (entry.status?.completed) return { error: 'ComfyUI a fini sans rendre d’image.' };
        continue;
      }
      const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'temp' });
      const pic = await call(`${url}/view?${q}`, {}, 20_000);
      if (!pic.ok) return { error: 'ComfyUI n’a pas rendu l’image.' };
      return { png: Buffer.from(await pic.arrayBuffer()).toString('base64'), seed: graph[5].inputs.seed, ckpt };
    }
    // Trop long : on arrête ce travail, sinon il reste en file et bloque la prochaine demande.
    try {
      await call(`${url}/queue`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delete: [id] }) }, 5000);
      await call(`${url}/interrupt`, { method: 'POST' }, 5000);
    } catch { /* ComfyUI ne répond plus : rien à arrêter */ }
    return { error: 'timeout' };
  }

  async function fooocus(url, body) {
    const res = await call(`${url}/v1/generation/text-to-image`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fooocusBody(body)),
    });
    if (!res.ok) return { error: `Fooocus a échoué (code ${res.status}).` };
    const data = await res.json();
    const first = Array.isArray(data) ? data[0] : null;
    return { png: first?.base64 || '', seed: first?.seed ?? null };
  }

  const NAMES = { forge: 'Forge', comfy: 'ComfyUI', fooocus: 'Fooocus' };

  async function run(input = {}) {
    const action = String(input.action || '').trim().toLowerCase();
    if (action === 'install') {
      if (!installer) return installState();
      const r = installer.install();
      return { ok: r.ok, text: r.text };
    }
    if (action === 'status') return installState();
    const adult = input.adult === true;
    const why = refusal(input.prompt, adult);
    if (why) return { ok: false, text: why };
    const body = txt2imgBody({ ...input, adult });
    const where = await locate();
    if (!where) {
      found = null;
      if (value(baseUrl)) return { ok: false, text: `Aucun générateur d’images ne répond à ${value(baseUrl)}.` };
      const st = installer ? installer.status() : null;
      if (st?.installing) return { ok: false, text: `Le générateur d’images s’installe encore sur le PC (${st.text}).` };
      if (st?.installed) {
        const why = installer.startProblem ? installer.startProblem() : '';
        return { ok: false, text: `ComfyUI est installé sur le PC mais n’a pas démarré.${why ? ` ${why}` : ''}` };
      }
      return { ok: false, text: installer ? NONE_FOUND_INSTALL : NONE_FOUND };
    }
    found = where;
    let out;
    try {
      out = await ({ forge, comfy, fooocus })[where.kind](where.url, body);
    } catch (err) {
      out = { error: err && (err.name === 'TimeoutError' || err.name === 'AbortError') ? 'timeout' : `${NAMES[where.kind]} ne répond plus.` };
    }
    if (out.error === 'timeout') {
      return { ok: false, text: `${NAMES[where.kind]} n’a pas fini l’image à temps (le premier essai charge le modèle, c’est le plus long). Réessayez : ce sera plus rapide, ou demandez une image plus petite.` };
    }
    if (out.error) return { ok: false, text: out.error };
    const png = String(out.png || '').replace(/^data:image\/\w+;base64,/, '');
    if (!png) return { ok: false, text: `${NAMES[where.kind]} n’a rendu aucune image.` };
    const seed = out.seed ?? null;
    return {
      ok: true,
      text: `Image créée avec ${NAMES[where.kind]} (${body.width}×${body.height}${seed != null ? `, graine ${seed}` : ''}).`,
      png,
      seed,
      engine: where.kind,
    };
  }

  return { run, locate };
}

module.exports = { createImageGen, refusal, txt2imgBody, comfyWorkflow, fooocusBody, CANDIDATES };
