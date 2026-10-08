import React, { useEffect, useRef, useState } from 'react';
import { configStore } from '../core/ConfigStore.js';
import { hostBridge } from '../core/hostBridge.js';
import { toggleAdultImages } from './adultImages.js';

const SIZES = [
  { id: 'portrait', label: 'Portrait 832×1216', width: 832, height: 1216 },
  { id: 'square', label: 'Carré 1024×1024', width: 1024, height: 1024 },
  { id: 'landscape', label: 'Paysage 1216×832', width: 1216, height: 832 },
];

/** Création d'images à la main : la description part directement au générateur du PC (ComfyUI, Forge ou Fooocus), sans passer par un assistant. */
export default function ImageStudio() {
  const [cfg, setCfg] = useState(configStore.get());
  const [prompt, setPrompt] = useState('');
  const [negative, setNegative] = useState('');
  const [size, setSize] = useState('portrait');
  const [steps, setSteps] = useState(25);
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
  useEffect(() => {
    refreshSetup();
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

  const create = async (e) => {
    e?.preventDefault();
    if (!prompt.trim() || busy) return;
    const dims = SIZES.find((s) => s.id === size) || SIZES[0];
    setBusy(true);
    setMessage('⏳ Création en cours… la première image charge le modèle et peut prendre plusieurs minutes.');
    const res = await hostBridge.imageGen('run', { prompt, negative, width: dims.width, height: dims.height, steps: Number(steps) || 25, inline: true });
    setBusy(false);
    if (res?.unavailable) { setMessage('Le générateur d’images n’est disponible que dans l’application Windows.'); return; }
    if (!res?.ok) { setMessage(`⚠️ ${res?.text || 'Échec de la création.'}`); return; }
    setMessage(`✅ ${res.text}`);
    if (res.dataUri) setImages((list) => [{ src: res.dataUri, path: res.path, seed: res.seed, prompt }, ...list].slice(0, 12));
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
          <label className="space-sub">Étapes <input type="number" min="10" max="50" value={steps} onChange={(e) => setSteps(e.target.value)} style={{ width: 64 }} disabled={busy} /></label>
          <button type="submit" className="space-pill active" disabled={busy || !prompt.trim()}>{busy ? '⏳ Création…' : '🎨 Créer l’image'}</button>
        </div>
      </form>
      {message && <div className="space-sub skill-message">{message}</div>}

      <div className="llm-image-grid">
        {images.map((img, i) => (
          <figure key={`${img.path}-${i}`} className="llm-image-card">
            <img src={img.src} alt={img.prompt} />
            <figcaption className="space-sub">{img.prompt.slice(0, 80)}{img.seed != null ? ` · graine ${img.seed}` : ''}<br />{img.path}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
