import React, { useEffect, useState } from 'react';
import {
  configStore,
  ALL_VOICES,
  VOICE_DESC,
  LIVE_MODELS,
  REST_MODELS,
} from '../core/ConfigStore.js';
import { BUILT_IN_FACES, HAIR_SHADES } from '../avatar/HeadMesh.js';

export default function SettingsModal({ onClose, onTestVoice }) {
  const [cfg, setCfg] = useState(configStore.get());
  const [hairStyles, setHairStyles] = useState([]);
  const [tab, setTab] = useState('avatar'); // 'avatar' | 'ai' | 'pc'

  useEffect(() => {
    const unsub = configStore.subscribe(setCfg);
    fetch('./assets/avatar/hair/styles.json')
      .then((r) => r.json())
      .then(setHairStyles)
      .catch(() => {});
    return unsub;
  }, []);

  const update = (patch) => configStore.update(patch);

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
                  <h4>Visage 3D (Classique 84 000 polygones, Léa, Marc)</h4>
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
                        🌐 {f.label} ({f.gender === 'male' ? 'H' : 'F'})
                      </button>
                    ))}
                  </div>

                  <h4>Peau & Circuits Électriques (comme sur la version téléphone)</h4>
                  <div className="settings-chip-row">
                    {[
                      { v: 7, label: '⚡ Hologramme bleu (Circuits Or & Bleu)' },
                      { v: 5, label: '✨ Hologramme (Circuits Or)' },
                      { v: 6, label: '💫 Hologramme + cheveux fibres optiques' },
                      { v: 0, label: '🕸️ Réseau lumineux + circuits' },
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
