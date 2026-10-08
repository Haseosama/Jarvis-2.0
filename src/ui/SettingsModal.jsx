import { toggleAdultImages } from './adultImages.js';
import React, { useEffect, useState } from 'react';
import {
  configStore,
  ALL_VOICES,
  VOICE_DESC,
  LIVE_MODELS,
  REST_MODELS,
} from '../core/ConfigStore.js';
import { BUILT_IN_FACES, HAIR_SHADES, POLYGON_LEVELS } from '../avatar/HeadMesh.js';
import { hostBridge } from '../core/hostBridge.js';
import {
  connectSpotify,
  disconnectSpotify,
  getSpotifyStatus,
  SPOTIFY_REDIRECT_URI,
} from '../integrations/spotifyClient.js';
import { GOOGLE_REDIRECT_URI, clearGoogleCredentials, connectGoogle, disconnectGoogle, getGoogleStatus } from '../integrations/googleClient.js';
import { TUYA_REGIONS, clearTuyaSettings, getTuyaClient, getTuyaStatus, saveTuyaSettings } from '../integrations/tuyaClient.js';

export default function SettingsModal({ onClose, onTestVoice, onOpenCreator }) {
  const [cfg, setCfg] = useState(configStore.get());
  const [hairStyles, setHairStyles] = useState([]);
  const [tab, setTab] = useState('avatar'); // 'avatar' | 'ai' | 'pc'
  const [spotifyClientId, setSpotifyClientId] = useState('');
  const [spotifyConnected, setSpotifyConnected] = useState(false);
  const [spotifyBusy, setSpotifyBusy] = useState(false);
  const [spotifyMessage, setSpotifyMessage] = useState('');
  const [tuyaAccessId, setTuyaAccessId] = useState('');
  const [tuyaSecret, setTuyaSecret] = useState('');
  const [tuyaRegion, setTuyaRegion] = useState('eu');
  const [tuyaHasSecret, setTuyaHasSecret] = useState(false);
  const [tuyaBusy, setTuyaBusy] = useState(false);
  const [tuyaMessage, setTuyaMessage] = useState('');
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleSecret, setGoogleSecret] = useState('');
  const [googleHasSecret, setGoogleHasSecret] = useState(false);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleMessage, setGoogleMessage] = useState('');

  useEffect(() => {
    const unsub = configStore.subscribe(setCfg);
    fetch('./assets/avatar/hair/styles.json')
      .then((r) => r.json())
      .then(setHairStyles)
      .catch(() => {});
    getSpotifyStatus().then((status) => {
      setSpotifyClientId(status.clientId);
      setSpotifyConnected(status.connected);
    }).catch(() => {});
    getGoogleStatus().then((status) => {
      setGoogleClientId(status.clientId);
      setGoogleHasSecret(status.hasSecret);
      setGoogleConnected(status.connected);
    }).catch(() => {});
    getTuyaStatus().then((status) => {
      setTuyaAccessId(status.accessId);
      setTuyaRegion(status.region);
      setTuyaHasSecret(status.hasSecret);
    }).catch(() => {});
    return unsub;
  }, []);

  const update = (patch) => configStore.update(patch);

  const handleSpotifyConnect = async () => {
    setSpotifyBusy(true);
    setSpotifyMessage('Ouverture de la page de connexion Spotify…');
    try {
      await connectSpotify(spotifyClientId);
      setSpotifyConnected(true);
      setSpotifyMessage('Spotify est connecté à Jarvis.');
    } catch (error) {
      setSpotifyMessage(error.message || 'Connexion Spotify impossible.');
    } finally {
      setSpotifyBusy(false);
    }
  };

  const handleSpotifyDisconnect = async () => {
    setSpotifyBusy(true);
    try {
      await disconnectSpotify();
      setSpotifyConnected(false);
      setSpotifyMessage('Jetons Spotify supprimés de ce PC.');
    } catch (error) {
      setSpotifyMessage(error.message || 'Déconnexion Spotify impossible.');
    } finally {
      setSpotifyBusy(false);
    }
  };

  const handleTuyaSave = async (testAfter) => {
    setTuyaBusy(true);
    setTuyaMessage('');
    try {
      await saveTuyaSettings({ accessId: tuyaAccessId, secret: tuyaSecret, region: tuyaRegion });
      if (tuyaSecret.trim()) {
        setTuyaSecret('');
        setTuyaHasSecret(true);
      }
      if (!testAfter) {
        setTuyaMessage('Réglages Tuya enregistrés (le secret est chiffré dans l’application PC).');
      } else {
        const devices = await (await getTuyaClient()).listDevices();
        setTuyaMessage(`Connexion Tuya réussie : ${devices.length} appareil(s) lié(s) au projet.`);
      }
    } catch (error) {
      setTuyaMessage(error.message || 'Connexion Tuya impossible.');
    } finally {
      setTuyaBusy(false);
    }
  };

  const handleGoogleConnect = async () => {
    setGoogleBusy(true);
    setGoogleMessage('Ouverture de la page de connexion Google…');
    try {
      await connectGoogle({ clientId: googleClientId, clientSecret: googleSecret });
      setGoogleSecret('');
      setGoogleHasSecret(true);
      setGoogleConnected(true);
      setGoogleMessage('Google Workspace est connecté à Jarvis.');
    } catch (error) {
      setGoogleMessage(error.message || 'Connexion Google impossible.');
    } finally {
      setGoogleBusy(false);
    }
  };

  const handleGoogleDisconnect = async (forget) => {
    setGoogleBusy(true);
    try {
      if (forget) {
        await clearGoogleCredentials();
        setGoogleClientId('');
        setGoogleHasSecret(false);
      } else {
        await disconnectGoogle();
      }
      setGoogleSecret('');
      setGoogleConnected(false);
      setGoogleMessage(forget ? 'Accès révoqué et identifiants Google supprimés de ce PC.' : 'Accès Google révoqué et jetons supprimés de ce PC.');
    } catch (error) {
      setGoogleMessage(error.message || 'Déconnexion Google impossible.');
    } finally {
      setGoogleBusy(false);
    }
  };

  const handleTuyaClear = async () => {
    setTuyaBusy(true);
    try {
      await clearTuyaSettings();
      setTuyaAccessId('');
      setTuyaSecret('');
      setTuyaHasSecret(false);
      setTuyaMessage('Identifiants Tuya supprimés de ce PC.');
    } finally {
      setTuyaBusy(false);
    }
  };

  const handleApiKeyChange = (slotIdx, val) => {
    const next = [...(cfg.apiKeys || ['', '', ''])];
    next[slotIdx] = val;
    update({ apiKeys: next });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="space-header">
          <div className="space-tabs">
            <button
              className={`space-tab ${tab === 'avatar' ? 'active' : ''}`}
              onClick={() => setTab('avatar')}
            >
              🎭 Avatar 3D & Coiffures
            </button>
            <button
              className={`space-tab ${tab === 'ai' ? 'active' : ''}`}
              onClick={() => setTab('ai')}
            >
              🎙️ Voix (30) & Clés Gemini
            </button>
            <button
              className={`space-tab ${tab === 'pc' ? 'active' : ''}`}
              onClick={() => setTab('pc')}
            >
              🖥️ Système PC & Domotique
            </button>
          </div>
          <button className="space-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="settings-body">
          {tab === 'avatar' && (
            <div className="settings-section">
              <h4>Mode d’affichage de l’Avatar</h4>
              <div className="settings-chip-row">
                {[
                  { id: '3d', label: '🧊 Avatar 3D Haute Définition' },
                  { id: 'reactor', label: '⚛️ Réacteur HUD' },
                ].map((m) => (
                  <button
                    key={m.id}
                    className={`space-pill ${cfg.avatarMode === m.id ? 'active' : ''}`}
                    onClick={() => update({ avatarMode: m.id })}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {cfg.avatarMode === '3d' && (
                <>
                  <h4>Visage 3D (Classique, Léa, Marc)</h4>
                  <div className="settings-chip-row">
                    {BUILT_IN_FACES.map((f) => (
                      <button
                        key={f.id}
                        className={`space-pill ${cfg.avatarFaceId === f.id ? 'active' : ''}`}
                        onClick={() =>
                          update({
                            avatarFaceId: f.id,
                            avatarMode: '3d',
                          })
                        }
                      >
                        🌐 {f.label}{` (${f.gender === 'male' ? 'H' : 'F'})`}
                      </button>
                    ))}
                  </div>

                  {onOpenCreator && (
                    <div className="settings-chip-row">
                      <button className="space-pill" onClick={onOpenCreator}>🎨 Créateur de personnage (visage, yeux, nez, bouche…)</button>
                    </div>
                  )}

                  <h4>Peau & Hologramme (comme sur la version téléphone)</h4>
                  <div className="settings-chip-row">
                    {[
                      { v: 7, label: '⚡ Hologramme bleu' },
                      { v: 5, label: '✨ Hologramme doré' },
                      { v: 6, label: '💫 Hologramme + cheveux fibres optiques' },
                      { v: 0, label: '🕸️ Réseau lumineux' },
                      { v: 1, label: '🧑 Peau claire' },
                      { v: 2, label: '🧑 Peau mate' },
                      { v: 3, label: '🧑 Peau bronzée' },
                      { v: 4, label: '🧑 Peau foncée' },
                    ].map((s) => (
                      <button
                        key={s.v}
                        className={`space-pill ${cfg.avatarSkin === s.v ? 'active' : ''}`}
                        onClick={() => update({ avatarSkin: s.v })}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>

                  <h4>Circuits Électriques sur le Visage</h4>
                  <div className="settings-chip-row">
                    <button
                      className={`space-pill ${cfg.avatarCircuits !== false ? 'active' : ''}`}
                      onClick={() => update({ avatarCircuits: true })}
                    >
                      🔌 Avec circuits électriques (Or & Bleu)
                    </button>
                    <button
                      className={`space-pill ${cfg.avatarCircuits === false ? 'active' : ''}`}
                      onClick={() => update({ avatarCircuits: false })}
                    >
                      🚫 Sans circuits électriques
                    </button>
                  </div>
                  <h4>Sélecteur de Polygones (Densité 3D & Performance PC)</h4>
                  <div className="settings-chip-row">
                    {POLYGON_LEVELS.map((p) => (
                      <button
                        key={p.id}
                        className={`space-pill ${(cfg.avatarPolygonLevel || 'high') === p.id ? 'active' : ''}`}
                        onClick={() => update({ avatarPolygonLevel: p.id })}
                      >
                        🔺 {p.label}
                      </button>
                    ))}
                  </div>

                  <h4>Teinte des Lèvres</h4>
                  <div className="settings-chip-row">
                    {[
                      { v: 0, label: 'Naturelles' },
                      { v: 1, label: 'Rose' },
                      { v: 2, label: 'Rouge' },
                      { v: 3, label: 'Prune' },
                      { v: 4, label: 'Corail' },
                    ].map((l) => (
                      <button
                        key={l.v}
                        className={`space-pill ${(cfg.avatarLips ?? 0) === l.v ? 'active' : ''}`}
                        onClick={() => update({ avatarLips: l.v })}
                      >
                        {l.label}
                      </button>
                    ))}
                  </div>

                  <h4>Coiffure 3D ({hairStyles.length} coupes disponibles)</h4>
                  <div className="settings-grid-fields">
                    <select
                      value={cfg.avatarHair || 'auto'}
                      onChange={(e) => update({ avatarHair: e.target.value })}
                    >
                      <option value="auto">Automatique selon le visage</option>
                      <option value="none">Sans cheveux (Crâne)</option>
                      {hairStyles.map((st) => (
                        <option key={st.id} value={st.id}>
                          {st.label} ({st.gender === 'male' ? 'Homme' : 'Femme'})
                        </option>
                      ))}
                    </select>

                    <select
                      value={cfg.avatarHairShade || 'natural'}
                      onChange={(e) => update({ avatarHairShade: e.target.value })}
                    >
                      {HAIR_SHADES.map((sh) => (
                        <option key={sh.id} value={sh.id}>
                          Teinte : {sh.fr || sh.label || sh.en}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </div>
          )}

          {tab === 'ai' && (
            <div className="settings-section">
              <h4>Voix de Jarvis (30 voix Gemini Live + Synthèse vocale PC)</h4>
              <div className="settings-inline-row">
                <select
                  value={cfg.voiceName}
                  onChange={(e) => {
                    const newVoice = e.target.value;
                    update({ voiceName: newVoice });
                    onTestVoice?.(
                      `Bonjour ! Je suis Jarvis avec la voix ${newVoice}.`,
                      newVoice
                    );
                  }}
                  style={{ flex: 1 }}
                >
                  {ALL_VOICES.map((v) => (
                    <option key={v} value={v}>
                      {v} — {VOICE_DESC[v] || ''}
                    </option>
                  ))}
                </select>
                <button
                  className="media-play-btn"
                  onClick={() =>
                    onTestVoice?.(
                      `Bonjour ! Je suis Jarvis 2.0 sur votre PC, avec la voix ${cfg.voiceName}.`,
                      cfg.voiceName
                    )
                  }
                >
                  🔊 Tester la voix & Lip-Sync
                </button>
              </div>

              <h4>Clés API Google Gemini (Jusqu’à 3 clés avec rotation automatique sur quota)</h4>
              <p className="settings-hint">
                Jarvis 2.0 fonctionne immédiatement en mode local sans clé, et active Gemini Live 24 kHz + le ModelLadder dès qu’une clé API est renseignée.
              </p>
              {[0, 1, 2].map((slot) => (
                <div key={slot} className="settings-field">
                  <label>
                    Clé API #{slot + 1} {cfg.activeKeySlot === slot ? '(Active)' : ''}
                  </label>
                  <div className="settings-inline-row">
                    <input
                      type="password"
                      placeholder="AIzaSy..."
                      value={(cfg.apiKeys && cfg.apiKeys[slot]) || ''}
                      onChange={(e) => handleApiKeyChange(slot, e.target.value)}
                    />
                    <button
                      className={`space-pill ${cfg.activeKeySlot === slot ? 'active' : ''}`}
                      onClick={() => update({ activeKeySlot: slot })}
                    >
                      Utiliser
                    </button>
                  </div>
                </div>
              ))}

              <div className="settings-grid-fields">
                <div className="settings-field">
                  <label>Modèle Gemini Live (WebSocket Audio)</label>
                  <select
                    value={cfg.liveModel}
                    onChange={(e) => update({ liveModel: e.target.value })}
                  >
                    {LIVE_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="settings-field">
                  <label>Modèle Gemini REST principal (ModelLadder)</label>
                  <select
                    value={cfg.restModel}
                    onChange={(e) => update({ restModel: e.target.value })}
                  >
                    {REST_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {tab === 'pc' && (
            <div className="settings-section">
              <h4>Spotify MCP — recherche, lecture et playlists</h4>
              <p className="settings-hint">
                Créez une application dans le tableau de bord développeur Spotify, ajoutez l’URI de retour ci-dessous, puis collez son Client ID. Jarvis utilise OAuth PKCE (aucun Client Secret) et chiffre les jetons localement dans l’application PC.
              </p>
              <div className="settings-field">
                <label>Spotify Client ID</label>
                <input
                  type="text"
                  autoComplete="off"
                  value={spotifyClientId}
                  onChange={(event) => {
                    setSpotifyClientId(event.target.value);
                    setSpotifyConnected(false);
                  }}
                  placeholder="Client ID du tableau de bord Spotify"
                />
              </div>
              <div className="settings-inline-row">
                <button
                  className="media-play-btn"
                  onClick={handleSpotifyConnect}
                  disabled={spotifyBusy || !hostBridge.isElectron || !spotifyClientId.trim()}
                  title={!hostBridge.isElectron ? 'Utilisez Jarvis PC installé pour connecter Spotify.' : ''}
                >
                  {spotifyBusy ? 'Connexion…' : spotifyConnected ? '🔄 Reconnecter Spotify' : '🔗 Connecter Spotify'}
                </button>
                {spotifyConnected && (
                  <button className="space-pill" onClick={handleSpotifyDisconnect} disabled={spotifyBusy}>
                    Déconnecter
                  </button>
                )}
                <button
                  className="space-pill"
                  onClick={() => hostBridge.openExternal('https://developer.spotify.com/dashboard')}
                >
                  Tableau de bord Spotify ↗
                </button>
              </div>
              <p className="settings-hint">
                URI de retour à enregistrer exactement : <code>{SPOTIFY_REDIRECT_URI}</code>
                <br />Spotify doit être ouvert sur un appareil Connect; certaines commandes de lecture et de volume exigent Premium.
              </p>
              {spotifyMessage && <p className="settings-hint" role="status">{spotifyMessage}</p>}
              <div className="settings-grid-fields">
                <div className="settings-field">
                  <label>Ville par défaut (Météo, Qualité de l’air, Ciel)</label>
                  <input
                    type="text"
                    value={cfg.userCity || ''}
                    onChange={(e) => update({ userCity: e.target.value })}
                  />
                </div>
                <div className="settings-field">
                  <label>Mot d’activation (Wake Word)</label>
                  <input
                    type="text"
                    value={cfg.wakeWord || 'jarvis'}
                    onChange={(e) => update({ wakeWord: e.target.value })}
                  />
                </div>
              </div>

              <div className="settings-field">
                <label>Dossier de travail PC (Fichiers & Documents générés)</label>
                <input
                  type="text"
                  placeholder="Par défaut : ~/Documents/Jarvis"
                  value={cfg.workFolderPath || ''}
                  onChange={(e) => update({ workFolderPath: e.target.value })}
                />
              </div>

              <div className="settings-field">
                <label>Chemin du coffre Obsidian local</label>
                <input
                  type="text"
                  placeholder="Ex: C:\Users\Vous\Documents\ObsidianVault"
                  value={cfg.obsidianVaultPath || ''}
                  onChange={(e) => update({ obsidianVaultPath: e.target.value })}
                />
              </div>

              <div className="settings-grid-fields">
                <div className="settings-field">
                  <label>URL Home Assistant (Domotique)</label>
                  <input
                    type="text"
                    placeholder="http://homeassistant.local:8123"
                    value={cfg.haUrl || ''}
                    onChange={(e) => update({ haUrl: e.target.value })}
                  />
                </div>
                <div className="settings-field">
                  <label>Jeton d’accès Home Assistant</label>
                  <input
                    type="password"
                    placeholder="eyJ0eXAiOiJKV1Qi..."
                    value={cfg.haToken || ''}
                    onChange={(e) => update({ haToken: e.target.value })}
                  />
                </div>
              </div>

              <h4>Images créées sur ce PC (ComfyUI)</h4>
              <label className="settings-field" style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                <input
                  type="checkbox"
                  checked={cfg.imageAdult === true}
                  onChange={(e) => toggleAdultImages(e.target.checked, update)}
                />
                <span>
                  Autoriser le contenu adulte (18+)
                  <span className="settings-hint" style={{ display: 'block' }}>
                    Désactivé par défaut. Quand il est activé, l’outil de création d’images n’ajoute plus le filtre « contenu sûr » ; les demandes d’enfants ou de mineurs restent toujours refusées.
                  </span>
                </span>
              </label>

              <h4>Google Workspace — Gmail, Agenda, Drive</h4>
              <p className="settings-hint">
                Dans Google Cloud Console, activez les API Gmail, Calendar et Drive, puis créez un identifiant OAuth de type « Application de bureau » et collez son Client ID et son Client Secret. Jarvis demande : lecture Gmail, création de brouillons/envoi (toujours avec votre confirmation), événements d’agenda, lecture Drive et fichiers créés par Jarvis. Tant que votre projet est en mode « Test », Google expire la connexion au bout de 7 jours.
              </p>
              <div className="settings-grid-fields">
                <div className="settings-field">
                  <label>Google Client ID</label>
                  <input
                    type="text"
                    autoComplete="off"
                    value={googleClientId}
                    onChange={(e) => { setGoogleClientId(e.target.value); setGoogleConnected(false); }}
                    placeholder="123456789-xxxx.apps.googleusercontent.com"
                  />
                </div>
                <div className="settings-field">
                  <label>Google Client Secret</label>
                  <input
                    type="password"
                    autoComplete="off"
                    value={googleSecret}
                    onChange={(e) => setGoogleSecret(e.target.value)}
                    placeholder={googleHasSecret ? '•••••••• (enregistré — laisser vide pour conserver)' : 'GOCSPX-…'}
                  />
                </div>
              </div>
              <div className="settings-chip-row">
                <button
                  className="space-pill"
                  onClick={handleGoogleConnect}
                  disabled={googleBusy || !hostBridge.isElectron || !googleClientId.trim() || (!googleSecret.trim() && !googleHasSecret)}
                  title={!hostBridge.isElectron ? 'Utilisez Jarvis PC installé pour connecter Google.' : ''}
                >
                  {googleBusy ? 'Connexion…' : googleConnected ? '🔄 Reconnecter Google' : '🔗 Connecter Google'}
                </button>
                {googleConnected && (
                  <button className="space-pill" onClick={() => handleGoogleDisconnect(false)} disabled={googleBusy}>Révoquer l’accès</button>
                )}
                {(googleHasSecret || googleClientId) && (
                  <button className="space-pill" onClick={() => handleGoogleDisconnect(true)} disabled={googleBusy}>Tout supprimer</button>
                )}
                <button className="space-pill" onClick={() => hostBridge.openExternal('https://console.cloud.google.com/apis/credentials')}>
                  Console Google Cloud ↗
                </button>
              </div>
              <p className="settings-hint">URI de retour (automatique pour une application de bureau) : <code>{GOOGLE_REDIRECT_URI}</code></p>
              {googleMessage && <p className="settings-hint" role="status">{googleMessage}</p>}

              <h4>Tuya / Smart Life — maison connectée (cloud)</h4>
              <p className="settings-hint">
                Créez un projet « Smart Home » sur la plateforme Tuya IoT, liez votre compte Smart Life (Devices &gt; Link App Account), puis collez l’Access ID et l’Access Secret. Choisissez le centre de données de votre compte (Europe : « Europe centrale »). Le secret est chiffré localement et n’est jamais enregistré dans la configuration.
              </p>
              <div className="settings-grid-fields">
                <div className="settings-field">
                  <label>Tuya Access ID</label>
                  <input
                    type="text"
                    autoComplete="off"
                    value={tuyaAccessId}
                    onChange={(e) => setTuyaAccessId(e.target.value)}
                    placeholder="Access ID / Client ID"
                  />
                </div>
                <div className="settings-field">
                  <label>Tuya Access Secret</label>
                  <input
                    type="password"
                    autoComplete="off"
                    value={tuyaSecret}
                    onChange={(e) => setTuyaSecret(e.target.value)}
                    placeholder={tuyaHasSecret ? '•••••••• (enregistré — laisser vide pour conserver)' : 'Access Secret / Client Secret'}
                  />
                </div>
              </div>
              <div className="settings-field">
                <label>Centre de données Tuya</label>
                <select value={tuyaRegion} onChange={(e) => setTuyaRegion(e.target.value)}>
                  {Object.entries(TUYA_REGIONS).map(([key, region]) => (
                    <option key={key} value={key}>{region.label}</option>
                  ))}
                </select>
              </div>
              <div className="settings-chip-row">
                <button className="space-pill" onClick={() => handleTuyaSave(false)} disabled={tuyaBusy || !tuyaAccessId.trim()}>
                  💾 Enregistrer
                </button>
                <button
                  className="space-pill"
                  onClick={() => handleTuyaSave(true)}
                  disabled={tuyaBusy || !tuyaAccessId.trim() || (!tuyaSecret.trim() && !tuyaHasSecret)}
                >
                  {tuyaBusy ? 'Test…' : '🔌 Enregistrer et tester'}
                </button>
                {(tuyaHasSecret || tuyaAccessId) && (
                  <button className="space-pill" onClick={handleTuyaClear} disabled={tuyaBusy}>
                    Supprimer
                  </button>
                )}
              </div>
              {tuyaMessage && <p className="settings-hint" role="status">{tuyaMessage}</p>}

              <div className="settings-field">
                <label>Instructions personnalisées pour Jarvis</label>
                <textarea
                  rows={3}
                  value={cfg.customPrompt || ''}
                  onChange={(e) => update({ customPrompt: e.target.value })}
                  placeholder="Ex: Réponds toujours en 2 phrases maximum, tutoie-moi..."
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
