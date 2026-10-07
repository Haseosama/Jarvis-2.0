'use strict';
// Installe et lance ComfyUI pour les images de Jarvis (electron/imageGen.cjs), sans rien demander d'autre à l'utilisateur.
//
// ComfyUI et son modèle pèsent environ 9 Go et réclament PyTorch : ils ne tiennent pas dans le .exe. Jarvis les télécharge donc
// une fois dans ses données (dossier images-ia) :
//  - 7zr.exe (l'extracteur officiel de 7-Zip, 7-zip.org) pour ouvrir l'archive ;
//  - ComfyUI portable pour Windows (Python embarqué compris, github.com/Comfy-Org/ComfyUI, dernière version) dans sa variante
//    NVIDIA, AMD ou Intel selon la carte graphique ;
//  - le modèle Juggernaut XL v9 (RunDiffusion, Hugging Face, licence CreativeML OpenRAIL-M) dans models/checkpoints.
// Ensuite Jarvis lance ComfyUI en arrière-plan (fenêtre cachée, 127.0.0.1:8188 seulement) quand une image est demandée, et
// l'arrête en quittant.

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

const SEVEN_ZR_URL = 'https://www.7-zip.org/a/7zr.exe';
const COMFY_URL = (gpu) => `https://github.com/Comfy-Org/ComfyUI/releases/latest/download/ComfyUI_windows_portable_${gpu}.7z`;
const MODEL_FILE = 'Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors';
const MODEL_URL = `https://huggingface.co/RunDiffusion/Juggernaut-XL-v9/resolve/main/${MODEL_FILE}`;
const COMFY_PORT = 8188;
const START_TIMEOUT_MS = 180_000;

/** La variante de ComfyUI pour ces cartes graphiques (noms Windows), ou null sans carte utilisable. */
function pickGpu(names = []) {
  const all = names.map((n) => String(n).toLowerCase());
  if (all.some((n) => n.includes('nvidia') || n.includes('geforce') || n.includes('rtx') || n.includes('quadro'))) return 'nvidia';
  if (all.some((n) => n.includes('radeon') || n.includes('amd'))) return 'amd';
  if (all.some((n) => n.includes('intel') && n.includes('arc'))) return 'intel';
  return null;
}

/** Les cartes graphiques de ce PC, d'après Windows. */
function listGpus(run = execFile) {
  return new Promise((resolve) => {
    run('powershell.exe', ['-NoProfile', '-Command', '(Get-CimInstance Win32_VideoController).Name'], { windowsHide: true }, (err, out) => {
      resolve(err ? [] : String(out || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
    });
  });
}

function createImageInstaller({
  dataDir,
  fetchImpl = globalThis.fetch,
  spawnImpl = spawn,
  gpus = () => listGpus(),
  isUp = null, // async () => boolean : ComfyUI répond-il ?
  platform = process.platform,
} = {}) {
  const root = path.join(dataDir, 'images-ia');
  // Le dossier que l'archive a créé (ComfyUI_windows_portable selon la variante) : celui qui contient python_embeded.
  const comfyDirOf = () => {
    try {
      const hit = fs.readdirSync(root, { withFileTypes: true })
        .find((d) => d.isDirectory() && fs.existsSync(path.join(root, d.name, 'python_embeded', 'python.exe')));
      if (hit) return path.join(root, hit.name);
    } catch { /* pas encore de dossier */ }
    return path.join(root, 'ComfyUI_windows_portable');
  };
  const pathsNow = () => {
    const comfyDir = comfyDirOf();
    return {
      root,
      comfyDir,
      python: path.join(comfyDir, 'python_embeded', 'python.exe'),
      mainPy: path.join(comfyDir, 'ComfyUI', 'main.py'),
      modelPath: path.join(comfyDir, 'ComfyUI', 'models', 'checkpoints', MODEL_FILE),
    };
  };
  let state = { step: 'idle', text: '', percent: 0 };
  let installing = null;
  let child = null;

  const up = isUp || (async () => {
    try {
      const r = await fetchImpl(`http://127.0.0.1:${COMFY_PORT}/system_stats`, { signal: AbortSignal.timeout(2000) });
      return r.ok;
    } catch { return false; }
  });

  const installed = () => {
    const p = pathsNow();
    return fs.existsSync(p.python) && fs.existsSync(p.mainPy) && fs.existsSync(p.modelPath);
  };

  function status() {
    return { installed: installed(), running: Boolean(child), installing: Boolean(installing), ...state };
  }

  async function download(url, dest, label) {
    const part = `${dest}.part`;
    const res = await fetchImpl(url, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`${label} : téléchargement refusé (code ${res.status}).`);
    const total = Number(res.headers?.get?.('content-length')) || 0;
    let got = 0;
    let shown = -1;
    const out = fs.createWriteStream(part);
    try {
      for await (const chunk of res.body) {
        got += chunk.length;
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
        const pct = total ? Math.floor((got / total) * 100) : 0;
        if (pct !== shown) {
          shown = pct;
          state = { step: 'download', text: `${label} : ${total ? `${pct} %` : `${Math.round(got / 1e6)} Mo`}`, percent: pct };
        }
      }
    } finally {
      await new Promise((r) => out.end(r));
    }
    fs.renameSync(part, dest);
  }

  function extract(sevenZr, archive) {
    state = { step: 'extract', text: 'Décompression de ComfyUI…', percent: 0 };
    return new Promise((resolve, reject) => {
      const p = spawnImpl(sevenZr, ['x', archive, `-o${root}`, '-y'], { windowsHide: true, stdio: 'ignore' });
      p.on('error', reject);
      p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Décompression de ComfyUI impossible (code ${code}).`))));
    });
  }

  async function doInstall() {
    if (platform !== 'win32') throw new Error('L’installation automatique du générateur d’images ne marche que sur Windows.');
    const gpu = pickGpu(await gpus());
    if (!gpu) {
      throw new Error('Aucune carte graphique NVIDIA, AMD ou Intel Arc trouvée : ce PC ne peut pas créer d’images en un temps raisonnable.');
    }
    fs.mkdirSync(root, { recursive: true });
    if (!fs.existsSync(pathsNow().mainPy)) {
      const sevenZr = path.join(root, '7zr.exe');
      if (!fs.existsSync(sevenZr)) await download(SEVEN_ZR_URL, sevenZr, 'Extracteur 7-Zip');
      const archive = path.join(root, `ComfyUI_windows_portable_${gpu}.7z`);
      if (!fs.existsSync(archive)) await download(COMFY_URL(gpu), archive, `ComfyUI (${gpu.toUpperCase()}, environ 1,9 Go)`);
      await extract(sevenZr, archive);
      if (!fs.existsSync(pathsNow().mainPy)) throw new Error('L’archive de ComfyUI n’a pas le contenu attendu.');
      fs.rmSync(archive, { force: true });
    }
    const { modelPath } = pathsNow();
    if (!fs.existsSync(modelPath)) {
      fs.mkdirSync(path.dirname(modelPath), { recursive: true });
      await download(MODEL_URL, modelPath, 'Modèle Juggernaut XL (environ 7 Go)');
    }
    state = { step: 'done', text: 'Générateur d’images installé.', percent: 100 };
  }

  /** Lance l'installation (une seule à la fois) et rend tout de suite où elle en est. */
  function install() {
    if (installed()) return { ...status(), ok: true, text: 'Le générateur d’images est déjà installé.' };
    if (!installing) {
      state = { step: 'start', text: 'Installation du générateur d’images…', percent: 0 };
      installing = doInstall()
        .catch((err) => { state = { step: 'error', text: String(err.message || err), percent: 0 }; })
        .finally(() => { installing = null; });
    }
    return { ...status(), ok: true, text: 'Installation lancée : ComfyUI et son modèle, environ 9 Go à télécharger.' };
  }

  /** Démarre ComfyUI s'il est installé et ne tourne pas, puis attend qu'il réponde. */
  async function ensureRunning(waitMs = START_TIMEOUT_MS) {
    if (await up()) return true;
    if (!installed()) return false;
    if (!child) {
      const { python, mainPy, comfyDir } = pathsNow();
      const args = ['-s', mainPy, '--listen', '127.0.0.1', '--port', String(COMFY_PORT), '--disable-auto-launch', '--preview-method', 'none'];
      child = spawnImpl(python, args, { cwd: comfyDir, windowsHide: true, stdio: 'ignore' });
      child.on('exit', () => { child = null; });
      child.on('error', () => { child = null; });
    }
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      if (await up()) return true;
      if (!child) return false;
      await new Promise((r) => setTimeout(r, 1500));
    }
    return false;
  }

  function stop() {
    if (child) {
      try { child.kill(); } catch { /* déjà arrêté */ }
      child = null;
    }
  }

  return { install, status, ensureRunning, stop, installed, paths: pathsNow };
}

module.exports = { createImageInstaller, pickGpu, listGpus, COMFY_URL, MODEL_URL, SEVEN_ZR_URL, COMFY_PORT };
