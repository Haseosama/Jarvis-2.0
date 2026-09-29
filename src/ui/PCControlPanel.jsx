import React, { useEffect, useRef, useState } from 'react';
import { hostBridge } from '../core/hostBridge.js';

const QUICK_APPS = [
  { name: 'chrome', label: '🌐 Navigateur', icon: '🌐' },
  { name: 'vscode', label: '💻 VS Code', icon: '💻' },
  { name: 'explorateur', label: '📁 Explorateur', icon: '📁' },
  { name: 'terminal', label: '⌨️ Terminal', icon: '⌨️' },
  { name: 'calculatrice', label: '🧮 Calculatrice', icon: '🧮' },
  { name: 'bloc-notes', label: '📝 Bloc-notes', icon: '📝' },
  { name: 'spotify', label: '🎵 Spotify', icon: '🎵' },
  { name: 'whatsapp', label: '💬 WhatsApp PC', icon: '💬' },
  { name: 'discord', label: '🎮 Discord', icon: '🎮' },
  { name: 'parametres', label: '⚙️ Paramètres Win', icon: '⚙️' },
];

export default function PCControlPanel({ onClose, onSendVisionFrame }) {
  const [sysInfo, setSysInfo] = useState(null);
  const [windows, setWindows] = useState([]);
  const [volume, setVolume] = useState(65);
  const [brightness, setBrightness] = useState(80);
  const [screenshotUrl, setScreenshotUrl] = useState('');
  const [webcamActive, setWebcamActive] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [customApp, setCustomApp] = useState('');
  const [keyText, setKeyText] = useState('');
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const refreshSystem = async () => {
    const info = await hostBridge.getSystemInfo();
    setSysInfo(info);
    const wRes = await hostBridge.windowControl({ action: 'list' });
    if (wRes.windows) setWindows(wRes.windows);
  };

  useEffect(() => {
    refreshSystem();
    const id = setInterval(refreshSystem, 4000);
    return () => {
      clearInterval(id);
      stopWebcam();
    };
  }, []);

  const handleCaptureScreen = async () => {
    const snap = await hostBridge.captureScreen();
    if (snap.ok && snap.dataUrl) {
      setScreenshotUrl(snap.dataUrl);
      setStatusMsg(`Capture d'écran PC effectuée (${snap.width}×${snap.height})`);
    }
  };

  const toggleWebcam = async () => {
    if (webcamActive) {
      stopWebcam();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 360 },
        audio: false,
      });
      streamRef.current = stream;
      setWebcamActive(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setStatusMsg('Webcam PC active');
    } catch {
      setStatusMsg('Aucune webcam physique détectée dans cet environnement.');
    }
  };

  const stopWebcam = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setWebcamActive(false);
  };

  const snapshotWebcamToAi = () => {
    const v = videoRef.current;
    if (!v || !webcamActive) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth || 640;
    c.height = v.videoHeight || 360;
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    const dataUrl = c.toDataURL('image/jpeg', 0.85);
    setScreenshotUrl(dataUrl);
    onSendVisionFrame?.(dataUrl, 'Décris ce que tu vois sur la webcam de mon PC.');
  };

  return (
    <div className="prod-panel">
      <div className="space-header">
        <div className="space-tabs">
          <span className="space-tab active">🖥️ Poste de Contrôle PC & Vision</span>
        </div>
        <div className="space-header-right">
          {statusMsg && <span className="space-badge">{statusMsg}</span>}
          {onClose && (
            <button className="space-close-btn" onClick={onClose}>
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="prod-body">
        <div className="prod-grid-2">
          {/* Telemetry & Settings */}
          <div className="space-card">
            <h4>⚡ Télémétrie & Réglages Système PC</h4>
            {sysInfo && (
              <div className="pc-metrics-grid">
                <div className="pc-metric-box">
                  <span className="pc-metric-label">CPU ({sysInfo.cpuCores} cœurs)</span>
                  <div className="pc-metric-val">{sysInfo.cpuUsagePercent}%</div>
                  <div className="pc-bar">
                    <div style={{ width: `${sysInfo.cpuUsagePercent}%` }} />
                  </div>
                </div>
                <div className="pc-metric-box">
                  <span className="pc-metric-label">RAM ({sysInfo.usedMemGb}/{sysInfo.totalMemGb} Go)</span>
                  <div className="pc-metric-val">{sysInfo.memUsagePercent}%</div>
                  <div className="pc-bar">
                    <div style={{ width: `${sysInfo.memUsagePercent}%` }} />
                  </div>
                </div>
              </div>
            )}

            <div className="pc-sliders">
              <div className="pc-slider-row">
                <span>🔊 Volume PC ({volume}%)</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={volume}
                  onChange={async (e) => {
                    const v = parseInt(e.target.value, 10);
                    setVolume(v);
                    const r = await hostBridge.setDeviceSetting({ setting: 'volume', value: v });
                    setStatusMsg(r.message);
                  }}
                />
              </div>
              <div className="pc-slider-row">
                <span>🔆 Luminosité ({brightness}%)</span>
                <input
                  type="range"
                  min="10"
                  max="100"
                  value={brightness}
                  onChange={async (e) => {
                    const v = parseInt(e.target.value, 10);
                    setBrightness(v);
                    const r = await hostBridge.setDeviceSetting({ setting: 'brightness', value: v });
                    setStatusMsg(r.message);
                  }}
                />
              </div>
            </div>

            <div className="pc-action-chips">
              <button
                className="space-pill"
                onClick={async () => {
                  const r = await hostBridge.setDeviceSetting({ setting: 'mute' });
                  setStatusMsg(r.message);
                }}
              >
                🔇 Muet
              </button>
              <button
                className="space-pill"
                onClick={async () => {
                  const r = await hostBridge.setDeviceSetting({ setting: 'media_play_pause' });
                  setStatusMsg(r.message);
                }}
              >
                ⏯ Média Play/Pause
              </button>
              <button
                className="space-pill"
                onClick={async () => {
                  const r = await hostBridge.windowControl({ action: 'minimize_all' });
                  setStatusMsg(r.message);
                }}
              >
                🗕 Afficher le Bureau
              </button>
              <button
                className="space-pill"
                onClick={async () => {
                  const r = await hostBridge.setDeviceSetting({ setting: 'lock' });
                  setStatusMsg(r.message);
                }}
              >
                🔒 Verrouiller PC
              </button>
            </div>

            <h4 style={{ marginTop: '14px' }}>🚀 Lanceur Rapide d’Applications PC</h4>
            <div className="pc-app-grid">
              {QUICK_APPS.map((a) => (
                <button
                  key={a.name}
                  className="pc-app-btn"
                  onClick={async () => {
                    const r = await hostBridge.openApp(a.name);
                    setStatusMsg(r.message);
                  }}
                >
                  {a.label}
                </button>
              ))}
            </div>
            <form
              className="prod-inline-form"
              style={{ marginTop: '8px' }}
              onSubmit={async (e) => {
                e.preventDefault();
                if (!customApp.trim()) return;
                const r = await hostBridge.openApp(customApp.trim());
                setStatusMsg(r.message);
                setCustomApp('');
              }}
            >
              <input
                type="text"
                placeholder="Nom d’une autre application ou exécutable..."
                value={customApp}
                onChange={(e) => setCustomApp(e.target.value)}
              />
              <button type="submit">Lancer</button>
            </form>
          </div>

          {/* Screen Capture, Webcam & Keyboard/Window Control */}
          <div className="space-card">
            <h4>👁️ Vision PC (Capture d’écran & Webcam)</h4>
            <div className="pc-action-chips" style={{ marginBottom: '10px' }}>
              <button className="space-pill active" onClick={handleCaptureScreen}>
                📸 Capturer l’écran PC
              </button>
              <button className="space-pill" onClick={toggleWebcam}>
                {webcamActive ? '⏹ Arrêter Webcam' : '🎥 Activer Webcam PC'}
              </button>
              {webcamActive && (
                <button className="space-pill" onClick={snapshotWebcamToAi}>
                  ✨ Analyser par Jarvis
                </button>
              )}
              {screenshotUrl && (
                <button
                  className="space-pill"
                  onClick={() =>
                    onSendVisionFrame?.(screenshotUrl, 'Analyse cette capture de mon écran PC.')
                  }
                >
                  🧠 Analyser la capture
                </button>
              )}
            </div>

            {webcamActive && (
              <div className="pc-vision-preview">
                <video ref={videoRef} autoPlay playsInline muted />
              </div>
            )}

            {screenshotUrl && !webcamActive && (
              <div className="pc-vision-preview">
                <img src={screenshotUrl} alt="Capture PC" />
              </div>
            )}

            <h4 style={{ marginTop: '14px' }}>⌨️ Automatisation Clavier / Souris & Fenêtres</h4>
            <form
              className="prod-inline-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!keyText.trim()) return;
                const r = await hostBridge.keyboardControl({ action: 'type', text: keyText });
                setStatusMsg(r.message);
                setKeyText('');
              }}
            >
              <input
                type="text"
                placeholder="Texte à frapper automatiquement au clavier..."
                value={keyText}
                onChange={(e) => setKeyText(e.target.value)}
              />
              <button type="submit">⌨️ Taper</button>
            </form>

            <div className="prod-items" style={{ marginTop: '8px', maxHeight: '140px' }}>
              {windows.map((w, idx) => (
                <div key={idx} className="space-list-item">
                  <div>
                    <strong>{w.Name}</strong> — {w.MainWindowTitle}
                  </div>
                  <button
                    className="space-mini-btn"
                    onClick={async () => {
                      const r = await hostBridge.windowControl({
                        action: 'focus',
                        title: w.MainWindowTitle,
                      });
                      setStatusMsg(r.message);
                    }}
                  >
                    Activer
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
