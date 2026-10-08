import React, { useEffect, useRef, useState } from 'react';
import { configStore } from '../core/ConfigStore.js';
import { hostBridge } from '../core/hostBridge.js';
import { toggleAdultImages } from './adultImages.js';
import { getStudioImages, selectStudioImage, subscribeStudioImages } from './studioShared.js';

const FORMATS = [
  { id: 'portrait', label: 'Portrait 512×768', width: 512, height: 768 },
  { id: 'square', label: 'Carré 640×640', width: 640, height: 640 },
  { id: 'landscape', label: 'Paysage 768×512', width: 768, height: 512 },
];

/** Clips vidéo courts (ComfyUI + LTX-Video) : depuis une image créée dans Studio IA › Images, ou depuis le texte seul. */
export default function VideoStudio() {
  const [cfg, setCfg] = useState(configStore.get());
  const [shared, setShared] = useState({ ...getStudioImages() });
  const [prompt, setPrompt] = useState('');
  const [format, setFormat] = useState('portrait');
  const [seconds, setSeconds] = useState(2);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [message, setMessage] = useState('');
  const [clips, setClips] = useState([]); // { src, path, prompt }
  const [setup, setSetup] = useState(null);
  const timer = useRef(null);
  const clock = useRef(null);

  useEffect(() => configStore.subscribe((next) => setCfg({ ...next })), []);
  useEffect(() => subscribeStudioImages((s) => setShared({ ...s })), []);

  const refreshSetup = async () => {
    const st = await hostBridge.imageGen('status');
    setSetup(st);
    return st;
  };
  useEffect(() => {
    refreshSetup();
    return () => { clearInterval(timer.current); clearInterval(clock.current); };
  }, []);

  const install = async () => {
    setSetup(await hostBridge.videoGen('install'));
    clearInterval(timer.current);
    timer.current = setInterval(async () => {
      const st = await refreshSetup();
      if (!st?.installing) clearInterval(timer.current);
    }, 2000);
  };

  const source = shared.images.find((i) => i.path === shared.selected) || null;

  const create = async (e) => {
    e?.preventDefault();
    if (!prompt.trim() || busy) return;
    const dims = FORMATS.find((f) => f.id === format) || FORMATS[0];
    setBusy(true);
    setElapsed(0);
    const started = Date.now();
    clearInterval(clock.current);
    clock.current = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    setMessage('⏳ Création du clip… comptez plusieurs minutes (le premier essai charge les modèles).');
    // Avec une image source, le format est celui de l'image : on garde le choix de l'utilisateur, ComfyUI recadre.
    const res = await hostBridge.videoGen('run', {
      prompt, seconds: Number(seconds) || 2, width: dims.width, height: dims.height, imagePath: source?.path, inline: true,
    });
    clearInterval(clock.current);
    setBusy(false);
    if (res?.unavailable) { setMessage('La vidéo n’est disponible que dans l’application Windows.'); return; }
    if (!res?.ok) { setMessage(`⚠️ ${res?.text || 'Échec de la création.'}`); return; }
    setMessage(`✅ ${res.text}`);
    if (res.dataUri) setClips((list) => [{ src: res.dataUri, path: res.path, prompt }, ...list].slice(0, 4));
  };

  const ready = setup?.videoInstalled;
  const canInstall = setup && !setup.unavailable && !ready;
  return (
    <div className="llm-images">
      <label className="llm-row">
        <input type="checkbox" checked={cfg.imageAdult === true} onChange={(e) => toggleAdultImages(e.target.checked, (patch) => configStore.update(patch))} />
        <span><strong>Autoriser le contenu adulte (18+)</strong> — personnages fictifs adultes ; jamais de mineur. Même réglage que pour les images.</span>
      </label>

      {canInstall && (
        <div className="space-sub skill-message">
          {setup.installing ? `⏳ Installation : ${setup.text} ` : (
            setup.installed
              ? 'Le module vidéo (LTX-Video 2B + encodeur de texte, environ 11 Go) n’est pas installé. '
              : 'Installez d’abord le générateur d’images (onglet Images) : le module vidéo s’y ajoute. '
          )}
          {!setup.installing && setup.installed && <button className="space-pill" onClick={install}>⬇️ Installer le module vidéo (environ 11 Go)</button>}
        </div>
      )}

      <div className="space-sub">
        Source : {source
          ? <>une image créée par Jarvis <button type="button" className="space-pill" onClick={() => selectStudioImage(null)}>✕ Texte seul</button></>
          : 'texte seul. Pour animer une image, créez-la dans l’onglet Images puis cliquez sur « 🎬 Animer ».'}
      </div>
      {source && <img src={source.src} alt={source.prompt} style={{ maxWidth: 160, borderRadius: 8 }} />}
      {!source && shared.images.length > 0 && (
        <div className="llm-row">
          {shared.images.slice(0, 6).map((i) => (
            <button key={i.path} type="button" className="space-pill" onClick={() => selectStudioImage(i.path)} title={i.prompt}>
              <img src={i.src} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6 }} />
            </button>
          ))}
        </div>
      )}

      <form className="llm-image-form" onSubmit={create}>
        <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={busy}
          placeholder={source ? 'Décrivez le mouvement (en anglais de préférence) : « she turns her head and smiles, hair moving in the wind »…' : 'Décrivez la scène et le mouvement (en anglais de préférence)…'} />
        <div className="llm-row">
          <select value={format} onChange={(e) => setFormat(e.target.value)} disabled={busy}>{FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select>
          <select value={seconds} onChange={(e) => setSeconds(e.target.value)} disabled={busy} title="Durée">
            {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} s</option>)}
          </select>
          <button type="submit" className="space-pill active" disabled={busy || !prompt.trim() || !ready}>{busy ? `⏳ ${elapsed} s…` : '🎬 Créer le clip'}</button>
        </div>
      </form>
      {message && <div className="space-sub skill-message">{message}</div>}

      <div className="llm-image-grid">
        {clips.map((c, i) => (
          <figure key={`${c.path}-${i}`} className="llm-image-card">
            <video src={c.src} controls loop muted playsInline />
            <figcaption className="space-sub">{c.prompt.slice(0, 80)}<br />{c.path}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
