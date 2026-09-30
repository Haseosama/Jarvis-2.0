import React, { useEffect, useRef, useState } from 'react';
import packageJson from '../package.json';
import AvatarView from './avatar/AvatarView.jsx';
import { POLYGON_LEVELS } from './avatar/HeadMesh.js';
import SpaceView from './space/SpaceView.jsx';
import MediaPlayerPanel from './video/MediaPlayerPanel.jsx';
import ProductivityPanel from './ui/ProductivityPanel.jsx';
import PCControlPanel from './ui/PCControlPanel.jsx';
import PluginsPanel from './ui/PluginsPanel.jsx';
import SettingsModal from './ui/SettingsModal.jsx';
import { configStore } from './core/ConfigStore.js';
import { ToolRegistry } from './actions/ToolRegistry.js';
import { JarvisEngine } from './core/JarvisEngine.js';
import { hostBridge } from './core/hostBridge.js';

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
  const [activeView, setActiveView] = useState('avatar'); // 'avatar' | 'space' | 'media' | 'productivity' | 'pc' | 'plugins'
  const [spaceConfig, setSpaceConfig] = useState({
    mode: 'map',
    observer: { latDeg: 44.8378, lonDeg: -0.5792, label: 'Bordeaux' },
  });
  const [mediaState, setMediaState] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  const [aiState, setAiState] = useState('IDLE');
  const [statusText, setStatusText] = useState('Prêt — Appuyez sur Ctrl+Espace ou écrivez une commande');
  const [viseme, setViseme] = useState({ jaw: 0, width: 0, round: 0, close: 0, teeth: 0 });
  const [audioLevel, setAudioLevel] = useState(0);
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
        setSpaceConfig((prev) => ({ ...prev, ...sc }));
        setActiveView('space');
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
      onToolExecuted: (name) => {
        showToast(`⚙️ Outil exécuté : ${name}`);
      },
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
              onClose={() => setActiveView('avatar')}
            />
          )}

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
          {activeView !== 'avatar' && (
            <div
              className="mini-avatar-pip"
              onClick={() => setActiveView('avatar')}
              title="Revenir à l’Avatar 3D plein écran"
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
                <span className={`hud-dot state-${aiState.toLowerCase()}`} />
                <span>🎭 {cfg.voiceName}</span>
              </div>
            </div>
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
