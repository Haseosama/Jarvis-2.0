import React, { useEffect, useRef, useState } from 'react';
import { hostBridge } from '../core/hostBridge.js';

const QUICK_APPS = [
  { name: 'chrome', label: '🌐 Navigateur' },
  { name: 'vscode', label: '💻 VS Code' },
  { name: 'explorateur', label: '📁 Explorateur' },
  { name: 'terminal', label: '⌨️ Terminal' },
  { name: 'calculatrice', label: '🧮 Calculatrice' },
  { name: 'bloc-notes', label: '📝 Bloc-notes' },
  { name: 'spotify', label: '🎵 Spotify' },
  { name: 'whatsapp', label: '💬 WhatsApp' },
  { name: 'discord', label: '🎮 Discord' },
  { name: 'steam', label: '🕹️ Steam' },
  { name: 'vlc', label: '🎬 VLC' },
  { name: 'gestionnaire', label: '📊 Tâches' },
];

const QUICK_FOLDERS = [
  { name: 'dossier jarvis', label: '🤖 Dossier Jarvis' },
  { name: 'documents', label: '📂 Documents' },
  { name: 'telechargements', label: '📥 Téléchargements' },
  { name: 'bureau', label: '🖥️ Bureau' },
  { name: 'images', label: '🖼️ Images' },
  { name: 'musique', label: '🎵 Musique' },
  { name: 'videos', label: '🎬 Vidéos' },
];

const SHORTCUT_DECK = [
  { keys: 'ctrl+c', label: '📋 Copier (Ctrl+C)' },
  { keys: 'ctrl+v', label: '📥 Coller (Ctrl+V)' },
  { keys: 'ctrl+x', label: '✂️ Couper (Ctrl+X)' },
  { keys: 'ctrl+z', label: '↩️ Annuler (Ctrl+Z)' },
  { keys: 'ctrl+a', label: '☑️ Tout sélect. (Ctrl+A)' },
  { keys: 'ctrl+s', label: '💾 Enregistrer (Ctrl+S)' },
  { keys: 'ctrl+f', label: '🔍 Rechercher (Ctrl+F)' },
  { keys: 'alt+tab', label: '🔄 Fenêtre suiv. (Alt+Tab)' },
  { keys: 'ctrl+t', label: '➕ Nouvel onglet (Ctrl+T)' },
  { keys: 'ctrl+w', label: '✖️ Fermer onglet (Ctrl+W)' },
  { keys: 'win+d', label: '🗕 Bureau (Win+D)' },
  { keys: 'win+shift+s', label: '📸 Capture Win' },
  { keys: 'enter', label: '⏎ Entrée' },
  { keys: 'esc', label: '⎋ Échap' },
  { keys: 'space', label: '␣ Espace' },
  { keys: 'backspace', label: '⌫ Retour' },
];

export default function PCControlPanel({ onClose, onSendVisionFrame }) {
  const [sysInfo, setSysInfo] = useState(null);
  const [windows, setWindows] = useState([]);
  const [winFilter, setWinFilter] = useState('');
  const [volume, setVolume] = useState(65);
  const [brightness, setBrightness] = useState(80);
  const [screenshotUrl, setScreenshotUrl] = useState('');
  const [webcamActive, setWebcamActive] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [customApp, setCustomApp] = useState('');
  const [keyText, setKeyText] = useState('');
  const [customHotkey, setCustomHotkey] = useState('');
  const [clipboardText, setClipboardText] = useState('');
  const [mouseX, setMouseX] = useState(960);
  const [mouseY, setMouseY] = useState(540);
  const [clickMode, setClickMode] = useState('click'); // 'click' | 'double_click' | 'right_click' | 'move'
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const refreshSystem = async () => {
    const info = await hostBridge.getSystemInfo();
    setSysInfo(info);
    const wRes = await hostBridge.windowControl({ action: 'list' });
    if (wRes.windows) setWindows(wRes.windows);
  };

  const loadClipboard = async () => {
    const res = await hostBridge.readClipboard();
    if (res.ok) setClipboardText(res.text || '');
  };

  useEffect(() => {
    refreshSystem();
    loadClipboard();
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

  const handleScreenImageClick = async (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const relX = (e.clientX - rect.left) / rect.width;
    const relY = (e.clientY - rect.top) / rect.height;
    const scrW = sysInfo?.screen?.width || 1920;
    const scrH = sysInfo?.screen?.height || 1080;
    const targetX = Math.round(relX * scrW);
    const targetY = Math.round(relY * scrH);
    setMouseX(targetX);
    setMouseY(targetY);
    const r = await hostBridge.mouseControl({ action: clickMode, x: targetX, y: targetY });
    setStatusMsg(r.message);
    setTimeout(handleCaptureScreen, 450);
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

  const filteredWindows = windows.filter((w) => {
    if (!winFilter.trim()) return true;
    const q = winFilter.toLowerCase();
    return (
      String(w.Name || '').toLowerCase().includes(q) ||
      String(w.MainWindowTitle || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="prod-panel">
      <div className="space-header">
        <div className="space-tabs">
          <span className="space-tab active">🖥️ Poste de Contrôle PC, Automatisation & Vision</span>
        </div>
        <div className="space-header-right">
          {statusMsg && <span className="space-badge">{statusMsg}</span>}
          <button className="space-mini-btn" onClick={refreshSystem} title="Rafraîchir l'état du PC">
            🔄 Actualiser
          </button>
          {onClose && (
            <button className="space-close-btn" onClick={onClose}>
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="prod-body">
        <div className="prod-grid-2">
          {/* Column 1: Telemetry, Power, Audio, Apps, Folders & Windows */}
          <div className="space-card">
            <h4>⚡ Télémétrie, Disques & Réglages Système PC</h4>
            {sysInfo && (
              <>
                <div className="pc-metrics-grid">
                  <div className="pc-metric-box">
                    <span className="pc-metric-label">
                      CPU ({sysInfo.cpuCores} cœurs • {sysInfo.hostname})
                    </span>
                    <div className="pc-metric-val">{sysInfo.cpuUsagePercent}%</div>
                    <div className="pc-bar">
                      <div style={{ width: `${sysInfo.cpuUsagePercent}%` }} />
                    </div>
                  </div>
                  <div className="pc-metric-box">
                    <span className="pc-metric-label">
                      RAM ({sysInfo.usedMemGb}/{sysInfo.totalMemGb} Go)
                    </span>
                    <div className="pc-metric-val">{sysInfo.memUsagePercent}%</div>
                    <div className="pc-bar">
                      <div style={{ width: `${sysInfo.memUsagePercent}%` }} />
                    </div>
                  </div>
                </div>

                {Array.isArray(sysInfo.disk) && sysInfo.disk.length > 0 && (
                  <div className="pc-metrics-grid" style={{ marginTop: '8px' }}>
                    {sysInfo.disk.map((d, i) => {
                      const used = Math.max(0, Math.round((d.totalGb - d.freeGb) * 10) / 10);
                      const pct = d.totalGb > 0 ? Math.round((used / d.totalGb) * 100) : 0;
                      return (
                        <div key={i} className="pc-metric-box">
                          <span className="pc-metric-label">
                            💾 Disque {d.mount} ({d.freeGb} Go libres / {d.totalGb} Go)
                          </span>
                          <div className="pc-bar" style={{ marginTop: '4px' }}>
                            <div style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
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
                  const r = await hostBridge.setDeviceSetting({ setting: 'media_previous' });
                  setStatusMsg(r.message);
                }}
              >
                ⏮ Précédent
              </button>
              <button
                className="space-pill"
                onClick={async () => {
                  const r = await hostBridge.setDeviceSetting({ setting: 'media_play_pause' });
                  setStatusMsg(r.message);
                }}
              >
                ⏯ Play/Pause
              </button>
              <button
                className="space-pill"
                onClick={async () => {
                  const r = await hostBridge.setDeviceSetting({ setting: 'media_next' });
                  setStatusMsg(r.message);
                }}
              >
                ⏭ Suivant
              </button>
              <button
                className="space-pill"
                onClick={async () => {
                  const r = await hostBridge.windowControl({ action: 'minimize_all' });
                  setStatusMsg(r.message);
                }}
              >
                🗕 Afficher Bureau
              </button>
              <button
                className="space-pill"
                onClick={async () => {
                  const r = await hostBridge.setDeviceSetting({ setting: 'lock' });
                  setStatusMsg(r.message);
                }}
              >
                🔒 Verrouiller
              </button>
              <button
                className="space-pill"
                onClick={async () => {
                  const r = await hostBridge.setDeviceSetting({ setting: 'display_off' });
                  setStatusMsg(r.message);
                }}
              >
                🌙 Éteindre Écran
              </button>
              <button
                className="space-pill"
                onClick={async () => {
                  const r = await hostBridge.setDeviceSetting({ setting: 'sleep' });
                  setStatusMsg(r.message);
                }}
              >
                💤 Veille PC
              </button>
              <button
                className="space-pill"
                onClick={async () => {
                  const r = await hostBridge.setDeviceSetting({ setting: 'empty_recycle_bin' });
                  setStatusMsg(r.message);
                }}
              >
                🗑️ Vider Corbeille
              </button>
              <button
                className="space-pill"
                onClick={async () => {
                  const r = await hostBridge.setDeviceSetting({ setting: 'wifi' });
                  setStatusMsg(r.message);
                }}
              >
                📶 Wi-Fi
              </button>
              <button
                className="space-pill"
                onClick={async () => {
                  const r = await hostBridge.setDeviceSetting({ setting: 'bluetooth' });
                  setStatusMsg(r.message);
                }}
              >
                🦷 Bluetooth
              </button>
              <button
                className="space-pill"
                onClick={async () => {
                  const r = await hostBridge.setDeviceSetting({ setting: 'sound' });
                  setStatusMsg(r.message);
                }}
              >
                🔊 Son Win
              </button>
            </div>

            <h4 style={{ marginTop: '14px' }}>🚀 Applications & Dossiers Rapides</h4>
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
            <div className="pc-action-chips" style={{ marginTop: '8px' }}>
              {QUICK_FOLDERS.map((f) => (
                <button
                  key={f.name}
                  className="space-pill"
                  onClick={async () => {
                    const r = await hostBridge.openApp(f.name);
                    setStatusMsg(r.message);
                  }}
                >
                  {f.label}
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
                placeholder="Nom d’application, dossier ou URL à ouvrir..."
                value={customApp}
                onChange={(e) => setCustomApp(e.target.value)}
              />
              <button type="submit">Lancer</button>
            </form>

            <h4 style={{ marginTop: '14px' }}>
              🪟 Fenêtres & Processus Actifs ({filteredWindows.length})
            </h4>
            <div className="prod-inline-form" style={{ marginBottom: '6px' }}>
              <input
                type="text"
                placeholder="Filtrer une fenêtre ou un processus..."
                value={winFilter}
                onChange={(e) => setWinFilter(e.target.value)}
              />
              <button
                type="button"
                onClick={async () => {
                  const r = await hostBridge.windowControl({ action: 'snap_left' });
                  setStatusMsg(r.message);
                }}
                title="Ancrer la fenêtre active à gauche"
              >
                ⬅️ Gauche
              </button>
              <button
                type="button"
                onClick={async () => {
                  const r = await hostBridge.windowControl({ action: 'snap_right' });
                  setStatusMsg(r.message);
                }}
                title="Ancrer la fenêtre active à droite"
              >
                ➡️ Droite
              </button>
            </div>
            <div className="prod-items" style={{ maxHeight: '185px' }}>
              {filteredWindows.map((w, idx) => (
                <div key={idx} className="space-list-item" style={{ gap: '6px', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: '140px' }}>
                    <strong>{w.Name}</strong>
                    {w.MemoryMB ? <span className="space-badge" style={{ marginLeft: '6px' }}>{w.MemoryMB} Mo</span> : null}
                    <div style={{ fontSize: '11px', opacity: 0.8 }}>{w.MainWindowTitle}</div>
                  </div>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    <button
                      className="space-mini-btn"
                      onClick={async () => {
                        const r = await hostBridge.windowControl({ action: 'focus', title: w.MainWindowTitle, pid: w.Id });
                        setStatusMsg(r.message);
                      }}
                      title="Mettre au premier plan"
                    >
                      🎯 Activer
                    </button>
                    <button
                      className="space-mini-btn"
                      onClick={async () => {
                        const r = await hostBridge.windowControl({ action: 'maximize', title: w.MainWindowTitle, pid: w.Id });
                        setStatusMsg(r.message);
                      }}
                      title="Agrandir"
                    >
                      🗖
                    </button>
                    <button
                      className="space-mini-btn"
                      onClick={async () => {
                        const r = await hostBridge.windowControl({ action: 'minimize', title: w.MainWindowTitle, pid: w.Id });
                        setStatusMsg(r.message);
                      }}
                      title="Réduire"
                    >
                      🗕
                    </button>
                    <button
                      className="space-mini-btn"
                      onClick={async () => {
                        const r = await hostBridge.windowControl({ action: 'close', title: w.MainWindowTitle, pid: w.Id });
                        setStatusMsg(r.message);
                        setTimeout(refreshSystem, 500);
                      }}
                      title="Fermer la fenêtre"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Column 2: Interactive Screen/Vision, Mouse Controller, Shortcut Deck & Clipboard */}
          <div className="space-card">
            <h4>👁️ Vision PC & Contrôle Souris Direct sur Écran</h4>
            <div className="pc-action-chips" style={{ marginBottom: '8px' }}>
              <button className="space-pill active" onClick={handleCaptureScreen}>
                📸 Capturer l’écran PC
              </button>
              <button className="space-pill" onClick={toggleWebcam}>
                {webcamActive ? '⏹ Arrêter Webcam' : '🎥 Activer Webcam PC'}
              </button>
              {webcamActive && (
                <button className="space-pill" onClick={snapshotWebcamToAi}>
                  ✨ Analyser Webcam
                </button>
              )}
              {screenshotUrl && (
                <button
                  className="space-pill"
                  onClick={() =>
                    onSendVisionFrame?.(screenshotUrl, 'Analyse cette capture de mon écran PC.')
                  }
                >
                  🧠 Analyser par Jarvis
                </button>
              )}
            </div>

            {webcamActive && (
              <div className="pc-vision-preview">
                <video ref={videoRef} autoPlay playsInline muted />
              </div>
            )}

            {screenshotUrl && !webcamActive && (
              <div>
                <div className="pc-action-chips" style={{ marginBottom: '6px' }}>
                  {[
                    { id: 'click', label: '🖱️ Clic Gauche sur image' },
                    { id: 'double_click', label: '🖱️ Double-Clic' },
                    { id: 'right_click', label: '🖱️ Clic Droit' },
                    { id: 'move', label: '🎯 Déplacer curseur' },
                  ].map((m) => (
                    <button
                      key={m.id}
                      className={`space-pill ${clickMode === m.id ? 'active' : ''}`}
                      onClick={() => setClickMode(m.id)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <div
                  className="pc-vision-preview"
                  style={{ cursor: 'crosshair' }}
                  title="Cliquez sur l'aperçu pour cliquer au même endroit sur votre écran PC"
                >
                  <img src={screenshotUrl} alt="Capture PC" onClick={handleScreenImageClick} />
                </div>
              </div>
            )}

            <div className="prod-inline-form" style={{ marginTop: '8px' }}>
              <input
                type="number"
                placeholder="X"
                value={mouseX}
                onChange={(e) => setMouseX(parseInt(e.target.value, 10) || 0)}
                style={{ width: '80px' }}
              />
              <input
                type="number"
                placeholder="Y"
                value={mouseY}
                onChange={(e) => setMouseY(parseInt(e.target.value, 10) || 0)}
                style={{ width: '80px' }}
              />
              <button
                type="button"
                onClick={async () => {
                  const r = await hostBridge.mouseControl({ action: clickMode, x: mouseX, y: mouseY });
                  setStatusMsg(r.message);
                }}
              >
                🖱️ Action ({mouseX}, {mouseY})
              </button>
              <button
                type="button"
                onClick={async () => {
                  const r = await hostBridge.mouseControl({ action: 'scroll', delta: 420 });
                  setStatusMsg(r.message);
                }}
              >
                ⬆️ Scroller Haut
              </button>
              <button
                type="button"
                onClick={async () => {
                  const r = await hostBridge.mouseControl({ action: 'scroll', delta: -420 });
                  setStatusMsg(r.message);
                }}
              >
                ⬇️ Scroller Bas
              </button>
            </div>

            <h4 style={{ marginTop: '14px' }}>⌨️ Deck de Raccourcis Clavier & Saisie Instantanée</h4>
            <div className="pc-app-grid" style={{ marginBottom: '8px' }}>
              {SHORTCUT_DECK.map((sc) => (
                <button
                  key={sc.keys}
                  className="pc-app-btn"
                  onClick={async () => {
                    const r = await hostBridge.keyboardControl({ action: 'hotkey', keys: sc.keys });
                    setStatusMsg(r.message);
                  }}
                >
                  {sc.label}
                </button>
              ))}
            </div>

            <form
              className="prod-inline-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!keyText.trim()) return;
                const r = await hostBridge.keyboardControl({ action: 'paste', text: keyText });
                setStatusMsg(r.message);
                setKeyText('');
              }}
            >
              <input
                type="text"
                placeholder="Texte à saisir/coller dans la fenêtre active (supporte accents)..."
                value={keyText}
                onChange={(e) => setKeyText(e.target.value)}
              />
              <button type="submit">⚡ Saisir</button>
            </form>

            <form
              className="prod-inline-form"
              style={{ marginTop: '6px' }}
              onSubmit={async (e) => {
                e.preventDefault();
                if (!customHotkey.trim()) return;
                const r = await hostBridge.keyboardControl({ action: 'hotkey', keys: customHotkey.trim() });
                setStatusMsg(r.message);
                setCustomHotkey('');
              }}
            >
              <input
                type="text"
                placeholder="Raccourci personnalisé (ex: ctrl+shift+t, alt+f4, f5)..."
                value={customHotkey}
                onChange={(e) => setCustomHotkey(e.target.value)}
              />
              <button type="submit">Envoyer</button>
            </form>

            <h4 style={{ marginTop: '14px' }}>📋 Presse-Papiers du PC</h4>
            <div className="prod-inline-form">
              <input
                type="text"
                placeholder="Contenu du presse-papiers Windows..."
                value={clipboardText}
                onChange={(e) => setClipboardText(e.target.value)}
              />
              <button type="button" onClick={loadClipboard}>
                🔄 Lire
              </button>
              <button
                type="button"
                onClick={async () => {
                  await hostBridge.writeClipboard(clipboardText);
                  setStatusMsg('Texte copié dans le presse-papiers du PC.');
                }}
              >
                📋 Copier
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
