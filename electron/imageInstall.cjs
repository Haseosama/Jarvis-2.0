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
const NEEDED_BYTES = 12e9; // archive (2 Go) + ComfyUI décompressé (~5 Go) + modèle (7 Go), l'archive étant effacée ensuite

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

/** Ce que dit le journal de ComfyUI quand il ne démarre pas, traduit en conseil. */
function diagnose(logText = '') {
  const t = String(logText);
  if (/c10\.dll|vcruntime|msvcp140|VCRUNTIME|0xc0000135/i.test(t)) {
    return 'Il manque « Microsoft Visual C++ Redistributable » : installez-le (https://aka.ms/vc14/vc_redist.x64.exe) puis réessayez.';
  }
  if (/Torch not compiled with CUDA|no NVIDIA driver|driver.{0,40}(too old|outdated)|CUDA (driver|error|initialization)|cudaGetDeviceCount/i.test(t)) {
    return 'Les pilotes de la carte graphique sont trop anciens ou absents : mettez à jour les pilotes NVIDIA (ou AMD/Intel) puis réessayez.';
  }
  if (/out of memory|CUDA out of memory|DefaultCPUAllocator|paging file/i.test(t)) {
    return 'Mémoire insuffisante (carte graphique ou fichier d’échange Windows) : fermez les autres applications lourdes ou réduisez la taille de l’image.';
  }
  if (/address already in use|only one usage of each socket|Errno 10048/i.test(t)) {
    return 'Le port 8188 est déjà pris par un autre programme : fermez-le (ou l’autre ComfyUI) puis réessayez.';
  }
  return '';
}

function createImageInstaller({
  dataDir,
  fetchImpl = globalThis.fetch,
  spawnImpl = spawn,
  gpus = () => listGpus(),
  isUp = null, // async () => boolean : ComfyUI répond-il ?
  platform = process.platform,
  freeBytes = null, // () => octets libres (injectable pour les tests)
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
  let startProblem = '';
  const logPath = path.join(root, 'comfyui.log');
  const readLog = () => {
    try {
      const size = fs.statSync(logPath).size;
      const fd = fs.openSync(logPath, 'r');
      try {
        const len = Math.min(size, 6000);
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, size - len);
        return buf.toString('utf8');
      } finally { fs.closeSync(fd); }
    } catch { return ''; }
  };

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
    // Reprise : un téléchargement interrompu (7 Go pour le modèle) repart de l'octet déjà reçu au lieu de zéro.
    let have = 0;
    try { have = fs.statSync(part).size; } catch { /* rien de commencé */ }
    const res = await fetchImpl(url, { redirect: 'follow', headers: have > 0 ? { Range: `bytes=${have}-` } : {} });
    if (!res.ok || !res.body) throw new Error(`${label} : téléchargement refusé (code ${res.status}).`);
    const resumed = have > 0 && res.status === 206;
    if (!resumed) have = 0;
    const length = Number(res.headers?.get?.('content-length')) || 0;
    const total = length ? length + have : 0;
    let got = have;
    let shown = -1;
    const out = fs.createWriteStream(part, { flags: resumed ? 'a' : 'w' });
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
    if (total && got < total) throw new Error(`${label} : téléchargement interrompu (${Math.round(got / 1e6)} Mo sur ${Math.round(total / 1e6)}). Relancez l’installation : elle reprend là où elle s’est arrêtée.`);
    fs.renameSync(part, dest);
  }

  /** Espace libre (octets) sur le disque des données de Jarvis, ou null si Node ne sait pas le dire. */
  function freeSpace() {
    try {
      const st = fs.statfsSync(root);
      return Number(st.bavail) * Number(st.bsize);
    } catch { return null; }
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
    const free = freeBytes ? freeBytes() : freeSpace();
    if (free !== null && free < NEEDED_BYTES && !installed()) {
      throw new Error(`Pas assez de place sur le disque : il faut environ 12 Go libres pour ComfyUI et son modèle, il en reste ${(free / 1e9).toFixed(1)}.`);
    }
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
    startProblem = '';
    if (!child) {
      const { python, mainPy, comfyDir } = pathsNow();
      const args = ['-s', mainPy, '--listen', '127.0.0.1', '--port', String(COMFY_PORT), '--disable-auto-launch', '--preview-method', 'none'];
      // Le journal de ComfyUI est gardé : sans lui, un démarrage raté (pilote, Visual C++, port pris) reste muet.
      let fd = 'ignore';
      try { fs.mkdirSync(root, { recursive: true }); fd = fs.openSync(logPath, 'w'); } catch { /* sans journal */ }
      child = spawnImpl(python, args, { cwd: comfyDir, windowsHide: true, stdio: ['ignore', fd, fd] });
      if (typeof fd === 'number') { try { fs.closeSync(fd); } catch { /* déjà fermé */ } }
      child.on('exit', (code) => { child = null; if (code) startProblem = diagnose(readLog()) || `ComfyUI s’est arrêté (code ${code}).`; });
      child.on('error', (err) => { child = null; startProblem = `ComfyUI n’a pas pu être lancé : ${err.message || err}`; });
    }
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      if (await up()) return true;
      if (!child) return false;
      await new Promise((r) => setTimeout(r, 1500));
    }
    startProblem = diagnose(readLog()) || 'ComfyUI met trop de temps à démarrer (le premier lancement peut durer plusieurs minutes) : réessayez dans un moment.';
    return false;
  }

  function stop() {
    if (child) {
      try { child.kill(); } catch { /* déjà arrêté */ }
      child = null;
    }
  }

  return { install, status, ensureRunning, stop, installed, paths: pathsNow, startProblem: () => startProblem, logPath };
}

module.exports = { createImageInstaller, diagnose, pickGpu, listGpus, COMFY_URL, MODEL_URL, SEVEN_ZR_URL, COMFY_PORT };
