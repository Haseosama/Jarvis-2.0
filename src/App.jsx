import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import packageJson from '../package.json';
import AvatarView from './avatar/AvatarView.jsx';
import { POLYGON_LEVELS } from './avatar/HeadMesh.js';
import SpaceView from './space/SpaceView.jsx';
import GlobeView from './space/GlobeView.jsx';
import MediaPlayerPanel from './video/MediaPlayerPanel.jsx';
import ProductivityPanel from './ui/ProductivityPanel.jsx';
import PCControlPanel from './ui/PCControlPanel.jsx';
import PluginsPanel from './ui/PluginsPanel.jsx';
import CircuitPanel from './ui/CircuitPanel.jsx';
import SkillPanel from './ui/SkillPanel.jsx';
import SettingsModal from './ui/SettingsModal.jsx';
import { configStore } from './core/ConfigStore.js';
import { ToolRegistry } from './actions/ToolRegistry.js';
import { JarvisEngine } from './core/JarvisEngine.js';
import { hostBridge } from './core/hostBridge.js';
import { clampMiniAvatarPosition } from './ui/miniAvatarPosition.js';
import { formatTraceValue } from './ui/executionTrace.js';
import { AUDIO_SPECTRUM_BAND_COUNT } from './audio/AudioSpectrum.js';

const MINI_AVATAR_POSITION_KEY = 'jarvis.miniAvatarPosition';

function readMiniAvatarPosition() {
  try {
    if (typeof window === 'undefined') return null;
    const saved = JSON.parse(window.localStorage.getItem(MINI_AVATAR_POSITION_KEY) || 'null');
    return Number.isFinite(saved?.left) && Number.isFinite(saved?.top)
      ? { left: saved.left, top: saved.top }
      : null;
  } catch {
    return null;
  }
}

function upsertExecutionTrace(entries, entry) {
  const index = entries.findIndex((item) => item.id === entry.id);
  if (index < 0) return [...entries, entry].slice(-12);
  const next = [...entries];
  next[index] = { ...next[index], ...entry, startedAt: entry.startedAt ?? next[index].startedAt };
  return next;
}

const QUICK_COMMANDS = [
  { label: '📋 Briefing du jour', cmd: 'Fais-moi le briefing du jour' },
  { label: '🌦️ Météo', cmd: 'Quelle est la météo à Bordeaux ?' },
  { label: '🛰️ Position ISS', cmd: 'Où se trouve la station spatiale ISS ?' },
  { label: '✨ Voûte céleste', cmd: 'Ouvre la carte du ciel nocturne' },
  { label: '📻 France Inter', cmd: 'Mets la radio France Inter' },
  { label: '⚡ État du PC', cmd: 'Quel est l’état CPU et RAM du PC ?' },
  { label: '⛽ Carburants', cmd: 'Prix du carburant à Bordeaux' },
  { label: '📄 Créer PDF', cmd: 'Crée un PDF de synthèse du projet' },
];

export default function App() {
  const [cfg, setCfg] = useState(configStore.get());
  const [activeView, setActiveView] = useState('avatar'); // 'avatar' | 'space' | 'globe' | 'circuit' | 'skills' | 'media' | 'productivity' | 'pc' | 'plugins'
  const [spaceConfig, setSpaceConfig] = useState({
    mode: 'map',
    observer: { latDeg: 44.8378, lonDeg: -0.5792, label: 'Bordeaux' },
    route: null,
    markers: [],
    focus: null,
  });
  const [circuitState, setCircuitState] = useState(null);
  const [mediaState, setMediaState] = useState(null);
  const [miniAvatarPosition, setMiniAvatarPosition] = useState(readMiniAvatarPosition);
  const [miniAvatarDragging, setMiniAvatarDragging] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const [aiState, setAiState] = useState('IDLE');
  const [statusText, setStatusText] = useState('Prêt — Appuyez sur Ctrl+Espace ou écrivez une commande');
  const [viseme, setViseme] = useState({ jaw: 0, width: 0, round: 0, close: 0, teeth: 0 });
  const [audioLevel, setAudioLevel] = useState(0);
  const [audioSpectrum, setAudioSpectrum] = useState(() => Array(AUDIO_SPECTRUM_BAND_COUNT).fill(0));
  const [executionTrace, setExecutionTrace] = useState([]);
  const [polygonCount, setPolygonCount] = useState(84555);
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      role: 'assistant',
      text:
        'Bonjour ! Je suis Jarvis 2.0 Édition PC (application autonome sans serveur externe).\n' +
        '• Avatar 3D haute définition (Classique à 84 000 polygones + circuits électriques, Léa, Marc, 23 coiffures, 11 teintes, lip-sync 60 FPS)\n' +
        '• Contrôle PC complet (applications, souris/clavier/fenêtres, capture d’écran, webcam, fichiers, PDF/Word/Excel)\n' +
        '• Carte du monde & orbites ISS, Voûte céleste, Radios en direct, Podcasts, YouTube et 82 plugins JSON intégrés.',
      timestamp: Date.now(),
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [toast, setToast] = useState('');

  const engineRef = useRef(null);
  const toolsRef = useRef(null);
  const chatEndRef = useRef(null);
  const miniAvatarRef = useRef(null);
  const miniAvatarDragRef = useRef(null);
  const miniAvatarClickSuppressedRef = useRef(false);

  const clampMiniAvatar = (left, top, element = miniAvatarRef.current) => {
    const width = element?.offsetWidth || 156;
    const height = element?.offsetHeight || 180;
    return clampMiniAvatarPosition(left, top, width, height, window.innerWidth, window.innerHeight);
  };

  const onMiniAvatarPointerDown = (event) => {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    miniAvatarDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setMiniAvatarDragging(true);
  };

  const onMiniAvatarPointerMove = (event) => {
    const drag = miniAvatarDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    event.preventDefault();
    setMiniAvatarPosition(clampMiniAvatar(drag.startLeft + dx, drag.startTop + dy));
  };

  const finishMiniAvatarDrag = (event, cancelled = false) => {
    const drag = miniAvatarDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    miniAvatarDragRef.current = null;
    setMiniAvatarDragging(false);
    if (drag.moved && !cancelled) {
      miniAvatarClickSuppressedRef.current = true;
      window.setTimeout(() => { miniAvatarClickSuppressedRef.current = false; }, 0);
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onMiniAvatarKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setActiveView('avatar');
      return;
    }
    const steps = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] };
    const step = steps[event.key];
    if (!step || !miniAvatarRef.current) return;
    event.preventDefault();
    const rect = miniAvatarRef.current.getBoundingClientRect();
    setMiniAvatarPosition(clampMiniAvatar(rect.left + step[0], rect.top + step[1]));
  };

  useEffect(() => {
    if (!miniAvatarPosition) return;
    try {
      window.localStorage.setItem(MINI_AVATAR_POSITION_KEY, JSON.stringify(miniAvatarPosition));
    } catch { /* Storage can be disabled in private browser contexts. */ }
  }, [miniAvatarPosition]);

  useEffect(() => {
    if (activeView === 'avatar' || !miniAvatarPosition || !miniAvatarRef.current) return;
    const rect = miniAvatarRef.current.getBoundingClientRect();
    const clamped = clampMiniAvatar(rect.left, rect.top);
    if (clamped.left !== miniAvatarPosition.left || clamped.top !== miniAvatarPosition.top) {
      setMiniAvatarPosition(clamped);
    }
  }, [activeView]);

  useEffect(() => {
    const clampOnResize = () => {
      if (!miniAvatarRef.current) return;
      setMiniAvatarPosition((position) =>
        position ? clampMiniAvatar(position.left, position.top) : position
      );
    };
    window.addEventListener('resize', clampOnResize);
    return () => window.removeEventListener('resize', clampOnResize);
  }, []);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  };

  useEffect(() => {
    const unsub = configStore.subscribe((nextCfg) => {
      setCfg(nextCfg);
    });

    const tools = new ToolRegistry({
      onOpenSpace: (sc) => {
        setSpaceConfig((prev) => ({
          ...prev,
          ...sc,
          route: sc?.route ?? null,
          markers: sc?.markers ?? [],
          focus: sc?.focus ?? null,
        }));
        setActiveView(sc?.mode === 'globe' ? 'globe' : 'space');
      },
      onOpenCircuit: (state) => {
        setCircuitState(state);
        setActiveView('circuit');
      },
      onOpenMedia: (ms) => {
        if (typeof ms === 'function') {
          setMediaState(ms);
        } else {
          setMediaState(ms);
          if (ms) setActiveView('media');
        }
      },
      onScreenCaptured: () => {
        showToast('📸 Capture d’écran PC enregistrée');
      },
      onEndSession: () => {
        engineRef.current?.stopLiveSession();
      },
      onNotify: showToast,
      onToolStarted: (name, args, meta = {}) => {
        const traceId = meta.traceId || `tool-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        setExecutionTrace((prev) => upsertExecutionTrace(prev, {
          id: traceId,
          name,
          status: 'running',
          parameters: formatTraceValue(args),
          result: '',
          startedAt: meta.startedAt || Date.now(),
          durationMs: null,
        }));
      },
      onToolExecuted: (name, args, result, meta = {}) => {
        const traceId = meta.traceId || `tool-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        setExecutionTrace((prev) => upsertExecutionTrace(prev, {
          id: traceId,
          name,
          status: 'completed',
          parameters: formatTraceValue(args),
          result: formatTraceValue(result),
          finishedAt: Date.now(),
          durationMs: Number.isFinite(meta.durationMs) ? meta.durationMs : null,
        }));
        showToast(`⚙️ Outil exécuté : ${name}`);
      },
      onToolFailed: (name, args, error, meta = {}) => {
        const traceId = meta.traceId || `tool-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        setExecutionTrace((prev) => upsertExecutionTrace(prev, {
          id: traceId,
          name,
          status: 'failed',
          parameters: formatTraceValue(args),
          result: formatTraceValue({ error: error?.message || String(error) }),
          finishedAt: Date.now(),
          durationMs: Number.isFinite(meta.durationMs) ? meta.durationMs : null,
        }));
        showToast(`⚠️ Échec de l’outil : ${name}`);
      },
    });
    toolsRef.current = tools;

    const engine = new JarvisEngine(tools, {
      onStateChange: (st, txt) => {
        setAiState(st);
        if (txt) setStatusText(txt);
      },
      onMessage: (msg) => {
        setMessages((prev) => {
          if (msg.append && prev.length > 0) {
            const idx = prev.findIndex((m) => m.id === msg.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = { ...next[idx], text: next[idx].text + msg.text };
              return next;
            }
          }
          return [...prev, msg];
        });
      },
      onViseme: (v) => setViseme(v),
      onAudioLevel: (lvl) => setAudioLevel(lvl),
      onAudioSpectrum: (spectrum) => setAudioSpectrum(spectrum),
    });
    engineRef.current = engine;

    // Pre-connect Gemini Live WebSocket as soon as secrets/config load, even before mic is activated
    configStore.initSecrets().then(() => {
      if (configStore.getActiveApiKey() && configStore.get().voiceMode !== 'offline') {
        engine.ensureLiveSession().then((ok) => {
          if (ok && engine.state === 'IDLE') {
            setStatusText(`Gemini Live connecté (${configStore.get().voiceName}) — Prêt`);
          }
        });
      }
    });

    const unsubPtt = hostBridge.onPushToTalk(() => {
      if (engineRef.current?.micActive || engineRef.current?.state === 'LISTENING') {
        engineRef.current.stopLiveSession();
      } else {
        engineRef.current?.startLiveSession();
      }
    });

    return () => {
      unsub();
      unsubPtt?.();
      engine.stopLiveSession();
      engine._closeLiveSocketOnly?.();
    };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = (e) => {
    if (e) e.preventDefault();
    if (!inputText.trim()) return;
    const txt = inputText.trim();
    setInputText('');
    engineRef.current?.sendUserMessage(txt, { speakReply: true });
  };

  const handleQuickCmd = (cmd) => {
    engineRef.current?.sendUserMessage(cmd, { speakReply: true });
  };

  const toggleVoice = () => {
    if (!engineRef.current) return;
    if (engineRef.current.micActive || aiState === 'LISTENING') {
      engineRef.current.stopLiveSession();
    } else if (aiState === 'SPEAKING') {
      engineRef.current.stopSpeaking();
    } else {
      engineRef.current.startLiveSession();
    }
  };

  return (
    <div className="jarvis-app">
      {/* Top Desktop HUD Header */}
      <header className="hud-topbar">
        <div className="hud-brand">
          <div className={`hud-orb state-${aiState.toLowerCase()}`} />
          <div>
            <div className="hud-title">JARVIS 2.0</div>
            <div className="hud-subtitle">PC STANDALONE EDITION • v{packageJson.version}</div>
          </div>
        </div>

        {/* Main Navigation Tabs */}
        <nav className="hud-nav">
          <button
            className={`hud-nav-btn ${activeView === 'avatar' ? 'active' : ''}`}
            onClick={() => setActiveView('avatar')}
          >
            🎭 Avatar 3D
          </button>
          <button
            className={`hud-nav-btn ${activeView === 'space' ? 'active' : ''}`}
            onClick={() => setActiveView('space')}
          >
            🌍 Espace & Ciel
          </button>
          <button
            className={`hud-nav-btn ${activeView === 'globe' ? 'active' : ''}`}
            onClick={() => setActiveView('globe')}
          >
            🌐 Globe 3D
          </button>
          <button
            className={`hud-nav-btn ${activeView === 'circuit' ? 'active' : ''}`}
            onClick={() => setActiveView('circuit')}
          >
            ⚡ Circuits
          </button>
          <button
            className={`hud-nav-btn ${activeView === 'skills' ? 'active' : ''}`}
            onClick={() => setActiveView('skills')}
          >
            🧪 Compétences
          </button>
          <button
            className={`hud-nav-btn ${activeView === 'media' ? 'active' : ''}`}
            onClick={() => setActiveView('media')}
          >
            📻 Radio & Vidéo {mediaState ? '• 🔴' : ''}
          </button>
          <button
            className={`hud-nav-btn ${activeView === 'productivity' ? 'active' : ''}`}
            onClick={() => setActiveView('productivity')}
          >
            ✅ Productivité & Docs
          </button>
          <button
            className={`hud-nav-btn ${activeView === 'pc' ? 'active' : ''}`}
            onClick={() => setActiveView('pc')}
          >
            🖥️ Contrôle PC
          </button>
          <button
            className={`hud-nav-btn ${activeView === 'plugins' ? 'active' : ''}`}
            onClick={() => setActiveView('plugins')}
          >
            🧩 82 Plugins
          </button>
        </nav>

        <div className="hud-actions">
          <button
            className="hud-settings-btn"
            onClick={() => setShowSettings(true)}
            title="Réglages Avatar, 30 Voix & Clés Gemini"
          >
            ⚙️ Réglages
          </button>
        </div>
      </header>

      {/* Main Split Workspace */}
      <main className="hud-workspace">
        {/* Left / Center Stage */}
        <section className="hud-stage">
          {/* Floating Avatar Quick Switcher Bar when in Avatar view */}
          {activeView === 'avatar' && (
            <div className="avatar-stage-container">
              <div className="avatar-quick-bar">
                <div className="avatar-quick-group">
                  {[
                    { id: 'classic', label: 'Classique 3D' },
                    { id: 'lea', label: 'Léa 3D' },
                    { id: 'marc', label: 'Marc 3D' },
                    { id: 'haseo', label: 'Haseo' },
                  ].map((f) => (
                    <button
                      key={f.id}
                      className={`space-pill ${cfg.avatarMode === '3d' && cfg.avatarFaceId === f.id ? 'active' : ''}`}
                      onClick={() => configStore.update({ avatarMode: '3d', avatarFaceId: f.id })}
                    >
                      {f.label}
                    </button>
                  ))}
                  <button
                    className={`space-pill ${cfg.avatarMode === 'reactor' ? 'active' : ''}`}
                    onClick={() => configStore.update({ avatarMode: 'reactor' })}
                  >
                    ⚛️ Réacteur
                  </button>
                </div>

                {cfg.avatarMode === '3d' && (
                  <div className="avatar-quick-group">
                    <button
                      className={`space-pill ${cfg.avatarSkin === 7 ? 'active' : ''}`}
                      onClick={() => configStore.update({ avatarSkin: 7 })}
                      title="Hologramme bleu (défaut téléphone)"
                    >
                      ⚡ Holo Bleu
                    </button>
                    <button
                      className={`space-pill ${cfg.avatarSkin === 5 ? 'active' : ''}`}
                      onClick={() => configStore.update({ avatarSkin: 5 })}
                      title="Hologramme doré"
                    >
                      ✨ Holo Or
                    </button>
                    <button
                      className={`space-pill ${cfg.avatarSkin === 6 ? 'active' : ''}`}
                      onClick={() => configStore.update({ avatarSkin: 6 })}
                      title="Hologramme + cheveux en fibres optiques"
                    >
                      💫 Fibres Optiques
                    </button>
                    <button
                      className={`space-pill ${cfg.avatarSkin === 0 ? 'active' : ''}`}
                      onClick={() => configStore.update({ avatarSkin: 0 })}
                      title="Réseau polygonal lumineux"
                    >
                      🕸️ Réseau
                    </button>
                    <button
                      className={`space-pill ${cfg.avatarSkin >= 1 && cfg.avatarSkin <= 4 ? 'active' : ''}`}
                      onClick={() => configStore.update({ avatarSkin: 2 })}
                      title="Peau réaliste 3D"
                    >
                      🎨 Peau 3D
                    </button>
                    <button
                      className={`space-pill ${cfg.avatarCircuits !== false ? 'active' : ''}`}
                      onClick={() =>
                        configStore.update({ avatarCircuits: cfg.avatarCircuits === false })
                      }
                      title="Activer ou désactiver les circuits électriques sur le visage"
                    >
                      {cfg.avatarCircuits !== false ? '🔌 Circuits : ON' : '🔌 Circuits : OFF'}
                    </button>
                    <select
                      className="avatar-poly-select"
                      value={cfg.avatarPolygonLevel || 'high'}
                      onChange={(e) =>
                        configStore.update({ avatarPolygonLevel: e.target.value })
                      }
                      title="Sélecteur de densité de polygones (réduire si besoin pour économiser le PC)"
                    >
                      {POLYGON_LEVELS.map((p) => (
                        <option key={p.id} value={p.id}>
                          🔺 {p.short}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="avatar-canvas-holder">
                <AvatarView
                  state={aiState}
                  audioLevel={audioLevel}
                  viseme={viseme}
                  faceId={cfg.avatarFaceId}
                  skin={cfg.avatarSkin}
                  lips={cfg.avatarLips}
                  showCircuits={cfg.avatarCircuits !== false}
                  polygonLevel={cfg.avatarPolygonLevel || 'high'}
                  hairStyleId={cfg.avatarHair}
                  hairShadeId={cfg.avatarHairShade}
                  avatarMode={cfg.avatarMode}
                  onPolygonCountChange={setPolygonCount}
                />
              </div>

              <div className="avatar-hud-footer">
                <div className="hud-status-pill">
                  <span className={`hud-dot state-${aiState.toLowerCase()}`} />
                  <span>{statusText}</span>
                </div>
                <div className="hud-voice-badge">
                  🎙️ Voix : <strong>{cfg.voiceName}</strong> • 🔺{' '}
                  <strong>{polygonCount.toLocaleString('fr-FR')}</strong> polygones • Ville :{' '}
                  <strong>{cfg.userCity}</strong>
                </div>
              </div>
            </div>
          )}

          {activeView === 'space' && (
            <SpaceView
              mode={spaceConfig.mode}
              observer={spaceConfig.observer}
              route={spaceConfig.route}
              markers={spaceConfig.markers}
              focus={spaceConfig.focus}
              onObserverChange={(observer) => setSpaceConfig((prev) => ({ ...prev, observer }))}
              onClose={() => setActiveView('avatar')}
            />
          )}

          {activeView === 'globe' && (
            <GlobeView
              observer={spaceConfig.observer}
              route={spaceConfig.route}
              markers={spaceConfig.markers}
              focus={spaceConfig.focus}
              onClose={() => setActiveView('avatar')}
              onOpenMap={() => setActiveView('space')}
            />
          )}

          {activeView === 'circuit' && (
            <CircuitPanel
              circuit={circuitState?.circuit}
              sourceLabel={circuitState?.sourceLabel}
              onClose={() => setActiveView('avatar')}
            />
          )}

          {activeView === 'skills' && <SkillPanel onClose={() => setActiveView('avatar')} />}

          {activeView === 'media' && (
            <MediaPlayerPanel
              mediaState={mediaState}
              onMediaChange={(ms) => setMediaState(ms)}
              onClose={() => setActiveView('avatar')}
            />
          )}

          {activeView === 'productivity' && (
            <ProductivityPanel
              onClose={() => setActiveView('avatar')}
              onNotify={showToast}
            />
          )}

          {activeView === 'pc' && (
            <PCControlPanel
              onClose={() => setActiveView('avatar')}
              onSendVisionFrame={(dataUrl, promptText) => {
                engineRef.current?.sendUserMessage(promptText, {
                  speakReply: true,
                  imageBase64: dataUrl,
                });
              }}
            />
          )}

          {activeView === 'plugins' && (
            <PluginsPanel
              onClose={() => setActiveView('avatar')}
              onRunPluginResult={(plugin, resultText) => {
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `pl_${Date.now()}`,
                    role: 'assistant',
                    text: resultText,
                    timestamp: Date.now(),
                  },
                ]);
              }}
            />
          )}

          {/* Persistent Mini Avatar PiP when viewing Map / Media / Productivity / PC / Plugins */}
          {activeView !== 'avatar' && createPortal(
            <div
              ref={miniAvatarRef}
              className={`mini-avatar-pip${miniAvatarDragging ? ' is-dragging' : ''}`}
              style={miniAvatarPosition ? {
                left: `${miniAvatarPosition.left}px`,
                top: `${miniAvatarPosition.top}px`,
                right: 'auto',
                bottom: 'auto',
              } : undefined}
              role="button"
              tabIndex={0}
              aria-label="Avatar miniature. Faites-le glisser pour le déplacer, ou appuyez sur Entrée pour l’agrandir."
              onPointerDown={onMiniAvatarPointerDown}
              onPointerMove={onMiniAvatarPointerMove}
              onPointerUp={(event) => finishMiniAvatarDrag(event)}
              onPointerCancel={(event) => finishMiniAvatarDrag(event, true)}
              onKeyDown={onMiniAvatarKeyDown}
              onClick={() => {
                if (miniAvatarClickSuppressedRef.current) {
                  miniAvatarClickSuppressedRef.current = false;
                  return;
                }
                setActiveView('avatar');
              }}
              title="Faire glisser pour déplacer · Cliquer pour revenir à l’Avatar 3D"
            >
              <div className="mini-pip-canvas">
                <AvatarView
                  state={aiState}
                  audioLevel={audioLevel}
                  viseme={viseme}
                  faceId={cfg.avatarFaceId}
                  skin={cfg.avatarSkin}
                  lips={cfg.avatarLips}
                  showCircuits={cfg.avatarCircuits !== false}
                  polygonLevel={cfg.avatarPolygonLevel || 'high'}
                  hairStyleId={cfg.avatarHair}
                  hairShadeId={cfg.avatarHairShade}
                  avatarMode={cfg.avatarMode}
                  closeUp={true}
                />
              </div>
              <div className="mini-pip-label">
                <span className="mini-pip-grip" aria-hidden="true">⠿</span>
                <span className={`hud-dot state-${aiState.toLowerCase()}`} />
                <span>🎭 {cfg.voiceName}</span>
              </div>
            </div>,
            document.body
          )}
        </section>

        {/* Right Dock: Conversation & Command Console */}
        <aside className="hud-chat-dock">
          <div className="chat-dock-header">
            <span>💬 CONSOLE VOCALE & COMMANDES PC</span>
            <button
              className="space-mini-btn"
              onClick={() =>
                engineRef.current?.speakTextWithLipSync(
                  'Tous les systèmes de Jarvis 2.0 PC sont opérationnels. Que puis-je faire pour vous ?'
                )
              }
              title="Tester l'animation labiale 3D"
            >
              🔊 Test Lip-Sync
            </button>
          </div>

          {/* Quick Suggestion Chips */}
          <div className="quick-chips-bar">
            {QUICK_COMMANDS.map((q, i) => (
              <button
                key={i}
                className="quick-chip"
                onClick={() => handleQuickCmd(q.cmd)}
              >
                {q.label}
              </button>
            ))}
          </div>

          {executionTrace.length > 0 && (
            <details className="execution-trace-panel">
              <summary>
                <span>🧩 Trace des actions</span>
                <span className="execution-trace-count">
                  {executionTrace.filter((entry) => entry.status === 'running').length > 0
                    ? `${executionTrace.filter((entry) => entry.status === 'running').length} en cours · `
                    : ''}
                  {executionTrace.length}
                </span>
              </summary>
              <div className="execution-trace-list">
                {[...executionTrace].reverse().map((entry) => (
                  <details key={entry.id} className={`execution-trace-entry status-${entry.status}`}>
                    <summary>
                      <span className="execution-trace-status" aria-hidden="true">
                        {entry.status === 'running' ? '◌' : entry.status === 'failed' ? '!' : '✓'}
                      </span>
                      <strong>{entry.name}</strong>
                      <span className="execution-trace-label">
                        {entry.status === 'running' ? 'En cours' : entry.status === 'failed' ? 'Échec' : 'Terminé'}
                      </span>
                      {entry.durationMs !== null && entry.durationMs !== undefined && (
                        <small>{entry.durationMs} ms</small>
                      )}
                    </summary>
                    <div className="execution-trace-inspect">
                      <div>
                        <b>Paramètres</b>
                        <pre>{entry.parameters}</pre>
                      </div>
                      {entry.result && (
                        <div>
                          <b>Résultat</b>
                          <pre>{entry.result}</pre>
                        </div>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            </details>
          )}

          {/* Chat Transcript */}
          <div className="chat-messages">
            {messages.map((m) => (
              <div key={m.id} className={`chat-bubble role-${m.role}`}>
                <div className="chat-bubble-meta">
                  <strong>{m.role === 'user' ? 'Vous' : 'Jarvis 2.0'}</strong>
                  <span>
                    {new Date(m.timestamp).toLocaleTimeString('fr-FR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  {m.role === 'assistant' && (
                    <button
                      className="chat-speak-btn"
                      onClick={() => engineRef.current?.speakTextWithLipSync(m.text)}
                      title="Lire à haute voix avec l'avatar 3D"
                    >
                      🔊
                    </button>
                  )}
                </div>
                <div className="chat-bubble-text">{m.text}</div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {/* Input & Push-to-Talk Bar */}
          <form className="chat-input-bar" onSubmit={handleSend}>
            <button
              type="button"
              className={`mic-btn ${aiState === 'LISTENING' ? 'listening' : aiState === 'SPEAKING' ? 'speaking' : ''}`}
              onClick={toggleVoice}
              title="Activer le micro / Gemini Live (ou Ctrl+Espace)"
            >
              {aiState === 'LISTENING' ? '⏹' : aiState === 'SPEAKING' ? '🔊' : '🎙️'}
            </button>
            <div
              className={`audio-spectrum spectrum-${String(aiState).toLowerCase()}`}
              role="img"
              aria-label="Spectre fréquentiel audio en direct"
            >
              {audioSpectrum.map((level, index) => (
                <span key={index} style={{ '--spectrum-level': Math.max(0, Math.min(1, level)) }} />
              ))}
            </div>
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Demandez n’importe quoi à Jarvis (météo, radio, ISS, ouvre Chrome, crée un PDF...)"
            />
            <button type="submit" className="send-btn">
              Envoyer
            </button>
          </form>
        </aside>
      </main>

      {toast && <div className="hud-toast">{toast}</div>}

      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          onTestVoice={(sample, voiceOverride) => engineRef.current?.speakTextWithLipSync(sample, voiceOverride)}
        />
      )}
    </div>
  );
}
