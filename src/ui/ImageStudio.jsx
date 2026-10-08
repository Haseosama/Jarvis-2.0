import React, { useEffect, useRef, useState } from 'react';
import { configStore } from '../core/ConfigStore.js';
import { hostBridge } from '../core/hostBridge.js';
import { toggleAdultImages } from './adultImages.js';
import { addStudioImage, selectStudioImage } from './studioShared.js';

const SIZES = [
  { id: 'portrait', label: 'Portrait 832×1216', width: 832, height: 1216 },
  { id: 'square', label: 'Carré 1024×1024', width: 1024, height: 1024 },
  { id: 'landscape', label: 'Paysage 1216×832', width: 1216, height: 832 },
];

const STYLES = [
  { id: 'auto', label: 'Auto' },
  { id: 'photo', label: 'Photo réaliste' },
  { id: 'anime', label: 'Anime / illustration' },
  { id: 'raw', label: 'Brut (ma description telle quelle)' },
];

/** Création d'images à la main : la description part directement au générateur du PC (ComfyUI, Forge ou Fooocus), sans passer par un assistant. */
export default function ImageStudio({ onAnimate } = {}) {
  const [cfg, setCfg] = useState(configStore.get());
  const [prompt, setPrompt] = useState('');
  const [negative, setNegative] = useState('');
  const [size, setSize] = useState('portrait');
  const [steps, setSteps] = useState(30);
  const [style, setStyle] = useState('photo');
  const [hd, setHd] = useState(false);
  const [count, setCount] = useState(1);
  const [seed, setSeed] = useState('');
  const [model, setModel] = useState('');
  const [models, setModels] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [images, setImages] = useState([]); // { src, path, seed, prompt }
  const [setup, setSetup] = useState(null);
  const timer = useRef(null);

  useEffect(() => configStore.subscribe((next) => setCfg({ ...next })), []);

  const refreshSetup = async () => {
    const st = await hostBridge.imageGen('status');
    setSetup(st);
    return st;
  };
  const refreshModels = async () => {
    const r = await hostBridge.imageGen('models');
    if (Array.isArray(r?.models)) setModels(r.models);
  };
  useEffect(() => {
    refreshSetup();
    refreshModels();
    return () => clearInterval(timer.current);
  }, []);

  const install = async () => {
    setSetup(await hostBridge.imageGen('install'));
    clearInterval(timer.current);
    timer.current = setInterval(async () => {
      const st = await refreshSetup();
      if (!st?.installing) clearInterval(timer.current);
    }, 2000);
  };

  const create = async (e, overrides = {}) => {
    e?.preventDefault?.();
    const text = overrides.prompt ?? prompt;
    if (!text.trim() || busy) return;
    const dims = SIZES.find((s) => s.id === size) || SIZES[0];
    const total = overrides.count ?? Math.min(4, Math.max(1, Number(count) || 1));
    const fixed = overrides.seed ?? (seed !== '' && Number.isFinite(Number(seed)) ? Number(seed) : undefined);
    setBusy(true);
    for (let i = 0; i < total; i += 1) {
      setMessage(`⏳ Création ${i + 1}/${total}… la première image charge le modèle${hd ? ' ; la passe HD est bien plus longue' : ''} (plusieurs minutes possibles).`);
      // Plusieurs images : même graine fixe = même image, donc on la fait varier d'une image à l'autre.
      const res = await hostBridge.imageGen('run', {
        prompt: text, negative, width: dims.width, height: dims.height, steps: Number(steps) || 30, style, hd, model: model || undefined,
        seed: fixed === undefined ? undefined : fixed + i, inline: true,
      });
      if (res?.unavailable) { setMessage('Le générateur d’images n’est disponible que dans l’application Windows.'); break; }
      if (!res?.ok) { setMessage(`⚠️ ${res?.text || 'Échec de la création.'}`); break; }
      setMessage(`✅ ${res.text}`);
      if (res.dataUri) {
        const made = { src: res.dataUri, path: res.path, seed: res.seed, prompt: text };
        setImages((list) => [made, ...list].slice(0, 12));
        addStudioImage(made);
      }
    }
    setBusy(false);
    refreshModels();
  };

  const installed = setup?.installed;
  return (
    <div className="llm-images">
      <label className="llm-row">
        <input type="checkbox" checked={cfg.imageAdult === true} onChange={(e) => toggleAdultImages(e.target.checked, (patch) => configStore.update(patch))} />
        <span><strong>Autoriser le contenu adulte (18+)</strong> — personnages fictifs adultes ; jamais de mineur.</span>
      </label>

      {setup && !setup.unavailable && !installed && (
        <div className="space-sub skill-message">
          {setup.installing ? `⏳ Installation : ${setup.text} ` : 'Aucun générateur d’images installé par Jarvis. S’il y a déjà ComfyUI, Forge ou Fooocus sur ce PC, il sera trouvé tout seul. '}
          {!setup.installing && <button className="space-pill" onClick={install}>⬇️ Installer ComfyUI (environ 9 Go)</button>}
        </div>
      )}

      <form className="llm-image-form" onSubmit={create}>
        <textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Décrivez l’image (l’anglais donne de meilleurs résultats)…" disabled={busy} />
        <input type="text" value={negative} onChange={(e) => setNegative(e.target.value)} placeholder="À éviter (facultatif) : flou, texte, mains déformées…" disabled={busy} />
        <div className="llm-row">
          <select value={size} onChange={(e) => setSize(e.target.value)} disabled={busy}>{SIZES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
          <select value={style} onChange={(e) => setStyle(e.target.value)} disabled={busy} title="Style">{STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
          <label className="space-sub">Étapes <input type="number" min="10" max="50" value={steps} onChange={(e) => setSteps(e.target.value)} style={{ width: 64 }} disabled={busy} /></label>
        </div>
        <div className="llm-row">
          <label className="space-sub"><input type="checkbox" checked={hd} onChange={(e) => setHd(e.target.checked)} disabled={busy} /> HD (plus de détails, 2 à 3 fois plus long)</label>
          <label className="space-sub">Images <input type="number" min="1" max="4" value={count} onChange={(e) => setCount(e.target.value)} style={{ width: 56 }} disabled={busy} /></label>
          <label className="space-sub">Graine <input type="number" min="0" value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="aléatoire" style={{ width: 110 }} disabled={busy} /></label>
          {models.length > 1 && (
            <select value={model} onChange={(e) => setModel(e.target.value)} disabled={busy} title="Modèle">
              <option value="">Modèle par défaut</option>
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
        </div>
        <div className="llm-row">          <button type="submit" className="space-pill active" disabled={busy || !prompt.trim()}>{busy ? '⏳ Création…' : '🎨 Créer l’image'}</button>
        </div>
      </form>
      {message && <div className="space-sub skill-message">{message}</div>}

      <div className="llm-image-grid">
        {images.map((img, i) => (
          <figure key={`${img.path}-${i}`} className="llm-image-card">
            <img src={img.src} alt={img.prompt} />
            <figcaption className="space-sub">{img.prompt.slice(0, 80)}{img.seed != null ? ` · graine ${img.seed}` : ''}<br />{img.path}</figcaption>
            <div className="llm-row">
              <button type="button" className="space-pill" disabled={busy} onClick={() => create(null, { prompt: img.prompt, count: 1, seed: -1 })}>🔁 Variation</button>
              {onAnimate && <button type="button" className="space-pill" disabled={busy} onClick={() => { selectStudioImage(img.path); onAnimate(); }}>🎬 Animer</button>}
              {img.seed != null && <button type="button" className="space-pill" disabled={busy} onClick={() => { setPrompt(img.prompt); setSeed(String(img.seed)); }}>📌 Garder la graine</button>}
            </div>
          </figure>
        ))}
      </div>
    </div>
  );
}
