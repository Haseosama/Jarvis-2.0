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
const HD_SCALE = 1.4; // seconde passe « HD » (agrandissement dans l'espace latent puis raffinage)
const HD_DENOISE = 0.45;
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
// Qualité : ce qui améliore presque toujours le rendu (mains, anatomie, flou, filigranes). Le style choisit en plus un
// complément à la description et à l'invite négative ; « raw » n'ajoute rien.
const QUALITY_NEGATIVE = 'lowres, blurry, out of focus, bad anatomy, bad proportions, bad hands, extra fingers, missing fingers, '
  + 'fused fingers, extra limbs, deformed, disfigured, mutated, cross-eyed, watermark, text, signature, jpeg artifacts';
const STYLES = {
  auto: { positive: 'highly detailed, sharp focus', negative: '' },
  photo: {
    positive: 'photorealistic, natural skin texture, soft cinematic lighting, sharp focus, highly detailed, 8k, dslr photo',
    negative: 'cartoon, anime, illustration, 3d render, painting, plastic skin, airbrushed',
  },
  anime: {
    positive: 'anime style, detailed illustration, clean lineart, vibrant colors, masterpiece, best quality',
    negative: 'photo, photorealistic, realistic, 3d render, sketch',
  },
  raw: { positive: '', negative: '' },
};
const SAFE_NEGATIVE = 'nsfw, nude, naked, nudity, nipples, sexual, explicit, erotic, lingerie';

function normalize(text) {
  return ` ${String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
}

function hasWord(text, words) {
  const t = normalize(text);
  return words.some((w) => t.includes(` ${normalize(w).trim()} `));
}

/** Pourquoi refuser cette demande, ou null si elle passe. */
function refusal(prompt, adult, source = 'phone') {
  const p = String(prompt || '');
  if (!p.trim()) return 'Décrivez l’image à créer.';
  if (hasWord(p, MINOR_WORDS) || UNDERAGE_AGE.test(p)) {
    return 'Refusé : je ne crée aucune image d’enfant ni de mineur.';
  }
  if (!adult && hasWord(p, EXPLICIT_WORDS)) {
    return source === 'pc'
      ? 'Le contenu adulte est désactivé : activez-le dans les Réglages de Jarvis 2.0 (Images créées sur ce PC, 18+) pour ce genre d’image.'
      : 'Le contenu adulte est désactivé : activez-le dans Jarvis Android (Réglages > Images IA) pour ce genre d’image.';
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
  const style = STYLES[String(input.style || 'auto').toLowerCase()] || STYLES.auto;
  const raw = String(input.style || '').toLowerCase() === 'raw';
  const negative = [String(input.negative || '').trim().slice(0, 600), ALWAYS_NEGATIVE, raw ? '' : QUALITY_NEGATIVE, style.negative, adult ? '' : SAFE_NEGATIVE]
    .filter(Boolean).join(', ');
  const side = (v, d) => Math.round(clampInt(v, 512, 1536, d) / 64) * 64;
  const prompt = [String(input.prompt || '').trim().slice(0, MAX_PROMPT), style.positive].filter(Boolean).join(', ');
  const hd = input.hd === true;
  return {
    prompt,
    negative_prompt: negative,
    width: side(input.width, 832),
    height: side(input.height, 1216),
    steps: clampInt(input.steps, 10, 50, 30),
    cfg_scale: 5.5,
    seed: clampInt(input.seed, -1, 2 ** 31 - 1, -1),
    batch_size: 1,
    n_iter: 1,
    save_images: false,
    send_images: true,
    hd,
    model: String(input.model || '').trim().slice(0, 200),
    // Forge / A1111 : « hires fix » en seconde passe dans l'espace latent.
    ...(hd ? { enable_hr: true, hr_scale: HD_SCALE, hr_upscaler: 'Latent', denoising_strength: HD_DENOISE, hr_second_pass_steps: 15 } : {}),
    ...(String(input.model || '').trim() ? { override_settings: { sd_model_checkpoint: String(input.model).trim().slice(0, 200) } } : {}),
  };
}

/** Le graphe ComfyUI (format API) d'une image texte → image avec le modèle `ckpt`. */
function comfyWorkflow(body, ckpt) {
  const seed = body.seed >= 0 ? body.seed : Math.floor(Math.random() * 2 ** 31);
  const graph = {
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
    2: { class_type: 'CLIPTextEncode', inputs: { text: body.prompt, clip: ['1', 1] } },
    3: { class_type: 'CLIPTextEncode', inputs: { text: body.negative_prompt, clip: ['1', 1] } },
    4: { class_type: 'EmptyLatentImage', inputs: { width: body.width, height: body.height, batch_size: 1 } },
    5: {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0],
        seed, steps: body.steps, cfg: body.cfg_scale,
        sampler_name: 'dpmpp_2m_sde', scheduler: 'karras', denoise: 1,
      },
    },
    6: { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    7: { class_type: 'PreviewImage', inputs: { images: ['6', 0] } },
  };
  if (body.hd) {
    // Passe HD : agrandissement du latent puis second échantillonnage léger, qui ajoute du détail (peau, tissus, yeux).
    graph[8] = { class_type: 'LatentUpscaleBy', inputs: { samples: ['5', 0], upscale_method: 'bislerp', scale_by: HD_SCALE } };
    graph[9] = {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['8', 0],
        seed, steps: 18, cfg: body.cfg_scale, sampler_name: 'dpmpp_2m_sde', scheduler: 'karras', denoise: HD_DENOISE,
      },
    };
    graph[6].inputs.samples = ['9', 0];
  }
  return graph;
}

// ── Vidéo (ComfyUI seulement) : LTX-Video 2B distillé, nœuds intégrés à ComfyUI ────────────────────────────────────────────
const VIDEO_MODEL = 'ltxv-2b-0.9.6-distilled-04-25.safetensors';
const TEXT_ENCODER = 't5xxl_fp8_e4m3fn.safetensors';
const VIDEO_FPS = 24;
const VIDEO_TIMEOUT_MS = 25 * 60_000; // un clip prend plusieurs minutes sur une carte de 6 à 8 Go
const VIDEO_NEGATIVE = 'worst quality, inconsistent motion, blurry, jittery, distorted, watermark, text';

/** Les paramètres d'un clip. Taille multiple de 32 (256 à 1024), durée 1 à 4 s, nombre d'images = 8 n + 1. */
function videoBody(input = {}) {
  const adult = input.adult === true;
  const side = (v, d) => Math.round(clampInt(v, 256, 1024, d) / 32) * 32;
  const seconds = Math.min(4, Math.max(1, Number(input.seconds) || 2));
  return {
    prompt: String(input.prompt || '').trim().slice(0, MAX_PROMPT),
    negative_prompt: [String(input.negative || '').trim().slice(0, 600), ALWAYS_NEGATIVE, VIDEO_NEGATIVE, adult ? '' : SAFE_NEGATIVE]
      .filter(Boolean).join(', '),
    width: side(input.width, 512),
    height: side(input.height, 768),
    length: Math.round((seconds * VIDEO_FPS) / 8) * 8 + 1,
    seconds,
    steps: clampInt(input.steps, 4, 20, 8),
    seed: clampInt(input.seed, -1, 2 ** 31 - 1, -1),
  };
}

/** Le graphe ComfyUI d'un clip : depuis une image (`imageName` dans input/) ou depuis le texte seul. */
function videoWorkflow(body, imageName = '') {
  const seed = body.seed >= 0 ? body.seed : Math.floor(Math.random() * 2 ** 31);
  const g = {
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: VIDEO_MODEL } },
    2: { class_type: 'CLIPLoader', inputs: { clip_name: TEXT_ENCODER, type: 'ltxv' } },
    3: { class_type: 'CLIPTextEncode', inputs: { text: body.prompt, clip: ['2', 0] } },
    4: { class_type: 'CLIPTextEncode', inputs: { text: body.negative_prompt, clip: ['2', 0] } },
  };
  let positive = ['3', 0];
  let negative = ['4', 0];
  let latent;
  if (imageName) {
    g[5] = { class_type: 'LoadImage', inputs: { image: imageName } };
    // LTX apprend sur des vidéos compressées : une image trop nette reste figée, d'où ce léger prétraitement.
    g[6] = { class_type: 'LTXVPreprocess', inputs: { image: ['5', 0], img_compression: 35 } };
    g[7] = {
      class_type: 'LTXVImgToVideo',
      inputs: { positive, negative, vae: ['1', 2], image: ['6', 0], width: body.width, height: body.height, length: body.length, batch_size: 1, strength: 1 },
    };
    positive = ['7', 0]; negative = ['7', 1]; latent = ['7', 2];
  } else {
    g[7] = { class_type: 'EmptyLTXVLatentVideo', inputs: { width: body.width, height: body.height, length: body.length, batch_size: 1 } };
    latent = ['7', 0];
  }
  g[8] = { class_type: 'LTXVConditioning', inputs: { positive, negative, frame_rate: VIDEO_FPS } };
  g[9] = { class_type: 'LTXVScheduler', inputs: { steps: body.steps, max_shift: 2.05, base_shift: 0.95, stretch: true, terminal: 0.1, latent } };
  g[10] = { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } };
  g[11] = {
    class_type: 'SamplerCustom',
    inputs: {
      model: ['1', 0], add_noise: true, noise_seed: seed, cfg: 1, positive: ['8', 0], negative: ['8', 1],
      sampler: ['10', 0], sigmas: ['9', 0], latent_image: latent,
    },
  };
  // Décodage par morceaux : le décodage d'un coup dépasse la mémoire d'une carte de 8 Go.
  g[12] = { class_type: 'VAEDecodeTiled', inputs: { samples: ['11', 0], vae: ['1', 2], tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 8 } };
  g[13] = { class_type: 'SaveWEBM', inputs: { images: ['12', 0], filename_prefix: 'jarvis/clip', codec: 'vp9', fps: VIDEO_FPS, crf: 28 } };
  return { graph: g, seed };
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
  videoTimeoutMs = VIDEO_TIMEOUT_MS,
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

  async function locate(start = true) {
    const own = value(baseUrl).replace(/\/+$/, '');
    if (own) return probe(own);
    if (found && (await probe(found.url, found.kind))) return found;
    for (const c of CANDIDATES) {
      const hit = await probe(c.url, c.kind);
      if (hit) return hit;
    }
    // Rien ne tourne : le ComfyUI que Jarvis a installé démarre à la demande.
    if (start && installer && installer.installed() && (await installer.ensureRunning())) return probe(CANDIDATES[1].url, 'comfy');
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

  /** Les valeurs permises d'une entrée de nœud ComfyUI (ex. CLIPLoader.clip_name), selon les deux formes de /object_info. */
  async function comfyChoices(url, node, field) {
    const info = await (await call(`${url}/object_info/${node}`, {}, 10_000)).json();
    const spec = info?.[node]?.input?.required?.[field];
    if (Array.isArray(spec?.[0])) return spec[0].map(String);
    if (Array.isArray(spec?.[1]?.options)) return spec[1].options.map(String);
    return [];
  }

  /** Met un graphe en file, attend son résultat (délai `ms`) et rend le premier fichier produit. */
  async function comfyRun(url, graph, ms) {
    const queued = await call(`${url}/prompt`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: graph, client_id: 'jarvis' }),
    });
    if (!queued.ok) {
      const why = await comfyProblem(queued);
      return { error: `ComfyUI a refusé la demande (code ${queued.status})${why ? ` : ${why}` : ''}.` };
    }
    const id = (await queued.json()).prompt_id;
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollMs));
      const hist = await (await call(`${url}/history/${encodeURIComponent(id)}`, {}, 10_000)).json();
      const entry = hist && hist[id];
      if (!entry) continue;
      if (entry.status?.status_str === 'error') {
        const msg = (entry.status.messages || []).find((m) => m?.[0] === 'execution_error')?.[1];
        const why = msg?.exception_message ? String(msg.exception_message).trim().slice(0, 200) : '';
        return { error: `ComfyUI a échoué${why ? ` : ${why}` : ''}.` };
      }
      const file = Object.values(entry.outputs || {}).flatMap((o) => o.images || o.gifs || [])[0];
      if (!file) {
        if (entry.status?.completed) return { error: 'ComfyUI a fini sans rien produire.' };
        continue;
      }
      const q = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder || '', type: file.type || 'output' });
      const res = await call(`${url}/view?${q}`, {}, 120_000);
      if (!res.ok) return { error: 'ComfyUI n’a pas rendu le fichier.' };
      return { data: Buffer.from(await res.arrayBuffer()).toString('base64'), filename: file.filename };
    }
    try {
      await call(`${url}/queue`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delete: [id] }) }, 5000);
      await call(`${url}/interrupt`, { method: 'POST' }, 5000);
    } catch { /* ComfyUI ne répond plus : rien à arrêter */ }
    return { error: 'timeout' };
  }

  /** Un clip : texte → vidéo, ou image → vidéo si `input.image` (PNG en base64) est fourni. */
  async function video(input) {
    const adult = input.adult === true;
    const why = refusal(input.prompt, adult, input.source === 'pc' ? 'pc' : 'phone');
    if (why) return { ok: false, text: why };
    const body = videoBody({ ...input, adult });
    let where = await locate();
    if (where && where.kind !== 'comfy' && !value(baseUrl)) {
      // Forge ou Fooocus a répondu en premier : la vidéo n'a besoin que de ComfyUI, on le cherche à part.
      for (const c of CANDIDATES.filter((x) => x.kind === 'comfy')) {
        const hit = await probe(c.url, 'comfy');
        if (hit) { where = hit; break; }
      }
    }
    if (!where) return { ok: false, text: 'Aucun ComfyUI ne répond : lancez-le ou installez le générateur d’images (Studio IA › Images).' };
    if (where.kind !== 'comfy') return { ok: false, text: 'La vidéo demande ComfyUI (Forge et Fooocus ne la font pas).' };
    found = where;
    const url = where.url;
    let out;
    try {
      const [ckpts, encoders] = await Promise.all([comfyModels(url), comfyChoices(url, 'CLIPLoader', 'clip_name')]);
      if (!ckpts.includes(VIDEO_MODEL) || !encoders.includes(TEXT_ENCODER)) {
        return { ok: false, text: 'Le module vidéo n’est pas installé : installez-le dans Studio IA › Vidéo (environ 11 Go).' };
      }
      let imageName = '';
      if (input.image) {
        const form = new FormData();
        form.append('image', new Blob([Buffer.from(String(input.image).replace(/^data:image\/\w+;base64,/, ''), 'base64')], { type: 'image/png' }), `jarvis-${Date.now()}.png`);
        form.append('type', 'input');
        form.append('overwrite', 'true');
        const up = await call(`${url}/upload/image`, { method: 'POST', body: form }, 60_000);
        if (!up.ok) return { ok: false, text: `ComfyUI a refusé l’image à animer (code ${up.status}).` };
        imageName = (await up.json()).name || '';
        if (!imageName) return { ok: false, text: 'ComfyUI n’a pas gardé l’image à animer.' };
      }
      const { graph, seed } = videoWorkflow(body, imageName);
      out = await comfyRun(url, graph, videoTimeoutMs);
      out.seed = seed;
    } catch (err) {
      out = { error: err && (err.name === 'TimeoutError' || err.name === 'AbortError') ? 'timeout' : 'ComfyUI ne répond plus.' };
    }
    if (out.error === 'timeout') return { ok: false, text: 'La vidéo n’a pas fini à temps. Essayez une durée plus courte (1 s) ou une taille plus petite.' };
    if (out.error) return { ok: false, text: out.error };
    return {
      ok: true,
      text: `Vidéo créée avec ComfyUI (${body.width}×${body.height}, ${body.seconds} s, graine ${out.seed}).`,
      video: out.data,
      ext: /\.(\w+)$/.exec(out.filename || '')?.[1] || 'webm',
      seed: out.seed,
    };
  }

  async function comfy(url, body) {
    let ckpt = body.model || value(comfyModel);
    if (body.model) {
      const names = await comfyModels(url);
      if (!names.includes(body.model)) return { error: `ComfyUI n’a pas le modèle « ${body.model} » (modèles : ${names.slice(0, 6).join(', ') || 'aucun'}).` };
    }
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
    const deadline = Date.now() + timeoutMs * (body.hd ? 3 : 1); // la passe HD demande bien plus de temps
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
    if (action === 'video') return video(input);
    if (action === 'models') {
      // Les modèles du générateur déjà lancé (on n'en démarre pas un pour ça).
      const here = await locate(false);
      if (!here) return { ok: true, models: [], engine: null, text: 'Aucun générateur ne tourne pour l’instant : il démarrera à la première image.' };
      try {
        if (here.kind === 'comfy') return { ok: true, engine: 'comfy', models: await comfyModels(here.url), text: '' };
        if (here.kind === 'forge') {
          const list = await (await call(`${here.url}/sdapi/v1/sd-models`, {}, 10_000)).json();
          return { ok: true, engine: 'forge', models: (Array.isArray(list) ? list : []).map((m) => String(m.title || m.model_name || '')).filter(Boolean), text: '' };
        }
      } catch { /* liste indisponible */ }
      return { ok: true, engine: here.kind, models: [], text: '' };
    }
    const adult = input.adult === true;
    const why = refusal(input.prompt, adult, input.source === 'pc' ? 'pc' : 'phone');
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
      text: `Image créée avec ${NAMES[where.kind]} (${body.width}×${body.height}${body.hd ? ' + HD' : ''}${seed != null ? `, graine ${seed}` : ''}).`,
      png,
      seed,
      engine: where.kind,
    };
  }

  return { run, locate };
}

module.exports = { createImageGen, refusal, STYLES, videoBody, videoWorkflow, VIDEO_MODEL, TEXT_ENCODER, txt2imgBody, comfyWorkflow, fooocusBody, CANDIDATES };
