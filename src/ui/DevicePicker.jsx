import React, { useCallback, useEffect, useState } from 'react';
import { listAudioDevices } from '../audio/devices.js';

// Choix du micro et des haut-parleurs par leur nom, avec un bouton TEST (jauge en direct) pour le micro.
export default function DevicePicker({ cfg, update }) {
  const [devices, setDevices] = useState({ inputs: [], outputs: [], cameras: [] });
  const [level, setLevel] = useState(null);

  const refresh = useCallback(async () => {
    // Sans une autorisation micro, les noms des périphériques restent vides : on la demande une fois, puis on libère le micro.
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch { /* refus : la liste restera sans noms */ }
    setDevices(await listAudioDevices());
  }, []);

  useEffect(() => {
    refresh();
    const md = navigator.mediaDevices;
    md?.addEventListener?.('devicechange', refresh);
    return () => md?.removeEventListener?.('devicechange', refresh);
  }, [refresh]);

  // TEST : 3 secondes de jauge réelle. C'est la seule vérification qu'une sonde automatique sur du silence ne peut pas faire.
  const testMic = async () => {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: cfg.audioInputId ? { deviceId: { exact: cfg.audioInputId } } : true });
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      const end = Date.now() + 3000;
      await new Promise((resolve) => {
        const id = setInterval(() => {
          analyser.getFloatTimeDomainData(data);
          let sum = 0;
          for (const v of data) sum += v * v;
          setLevel(Math.min(1, Math.sqrt(sum / data.length) * 8));
          if (Date.now() > end) { clearInterval(id); resolve(); }
        }, 60);
      });
      ctx.close().catch(() => {});
    } catch (e) {
      setLevel(-1);
      return;
    } finally {
      stream?.getTracks().forEach((t) => t.stop());
    }
    setLevel(null);
  };

  const select = (key, list) => (
    <select value={cfg[key] || ''} onChange={(e) => update({ [key]: e.target.value })}>
      <option value="">Par défaut du système</option>
      {list.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
    </select>
  );

  return (
    <>
      <h4>Périphériques audio</h4>
      <div className="settings-grid-fields">
        <div className="settings-field">
          <label>Microphone</label>
          {select('audioInputId', devices.inputs)}
          <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="button" onClick={testMic}>TEST</button>
            <div style={{ flex: 1, height: 8, background: 'rgba(255,255,255,0.1)', borderRadius: 4 }}>
              <div style={{ width: `${Math.max(0, (level ?? 0)) * 100}%`, height: '100%', background: 'var(--cyan)', borderRadius: 4 }} />
            </div>
            {level === -1 && <span className="settings-hint">Micro inaccessible</span>}
          </div>
        </div>
        <div className="settings-field">
          <label>Haut-parleurs</label>
          {select('audioOutputId', devices.outputs)}
        </div>
        <div className="settings-field">
          <label>Webcam</label>
          {select('cameraId', devices.cameras || [])}
        </div>
        <div className="settings-field">
          <label>Vision (description de la webcam)</label>
          <select value={cfg.visionEngine || 'local'} onChange={(e) => update({ visionEngine: e.target.value })}>
            <option value="local">Modèle local (l’image reste sur ce PC)</option>
            <option value="gemini">Gemini (l’image part chez Google)</option>
          </select>
          {(cfg.visionEngine || 'local') === 'local' && (
            <>
              <input type="text" placeholder="http://localhost:11434/v1" value={cfg.visionBaseUrl || ''} onChange={(e) => update({ visionBaseUrl: e.target.value.trim() })} />
              <input type="text" placeholder="llava" value={cfg.visionModel || ''} onChange={(e) => update({ visionModel: e.target.value.trim() })} />
              <span className="settings-hint">Serveur compatible OpenAI avec un modèle à vision (ex : Ollama, <code>ollama pull llava</code>). Une photo n’est prise que sur demande (« que vois-tu ? »).</span>
            </>
          )}
        </div>
      </div>
    </>
  );
}
