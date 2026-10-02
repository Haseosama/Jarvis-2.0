import React, { useEffect, useMemo, useState } from 'react';
import AvatarView from '../avatar/AvatarView.jsx';
import PolygonEditor from './PolygonEditor.jsx';
import { isEmptySculpt, normalizeSculpt } from '../avatar/MeshSculpt.js';
import { configStore, normalizeCustomSlots } from '../core/ConfigStore.js';
import {
  DEFAULT_FACE_CUSTOM,
  FACE_GROUPS,
  FACE_PARAMS,
  FACE_PRESETS,
  isDefaultFaceCustom,
  normalizeFaceCustom,
  presetValues,
  randomFaceCustom,
} from '../avatar/FaceCustomizer.js';

/**
 * Character creator for the Classic face. Sliders edit a draft that is previewed live
 * (debounced); nothing is saved until the user presses "Appliquer".
 */
export default function AvatarCreator({ cfg, onClose }) {
  const [draft, setDraft] = useState(() => normalizeFaceCustom(cfg.avatarCustom));
  const [preview, setPreview] = useState(draft);
  const [group, setGroup] = useState('face');
  const [sculpt, setSculpt] = useState(() => normalizeSculpt(cfg.avatarSculpt));
  const [polyOpen, setPolyOpen] = useState(false);
  const [slotName, setSlotName] = useState('');
  const slots = useMemo(() => normalizeCustomSlots(cfg.avatarCustomSlots), [cfg.avatarCustomSlots]);

  // Live preview without rebuilding the mesh on every slider tick.
  useEffect(() => {
    const id = setTimeout(() => setPreview(draft), 140);
    return () => clearTimeout(id);
  }, [draft]);

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const setValue = (id, value) => setDraft((current) => normalizeFaceCustom({ ...current, [id]: value }));
  const apply = () => {
    configStore.update({ avatarCustom: draft, avatarSculpt: sculpt, avatarFaceId: 'classic', avatarMode: '3d' });
    onClose?.();
  };
  const saveSlot = () => {
    const name = slotName.trim() || `Look ${slots.length + 1}`;
    const next = [...slots.filter((slot) => slot.name !== name), { name, values: draft }].slice(-8);
    configStore.update({ avatarCustomSlots: next });
    setSlotName('');
  };
  const deleteSlot = (name) => configStore.update({ avatarCustomSlots: slots.filter((slot) => slot.name !== name) });

  const params = FACE_PARAMS.filter((param) => param.group === group);

  return (
    <div className="creator-overlay" role="dialog" aria-modal="true" aria-label="Créateur de personnage">
      <div className="creator-panel">
        <div className="space-header">
          <div>
            <strong>🎨 Créateur de personnage — Classique</strong>
            <div className="space-sub">Façonnez le visage comme dans un jeu vidéo. Les couleurs, la peau et les circuits ne changent pas. L’éditeur de polygones permet des retouches point par point.</div>
          </div>
          <button className="space-close-btn" onClick={onClose} title="Annuler (Échap)">✕</button>
        </div>

        <div className="creator-body">
          <div className="creator-preview">
            <AvatarView
              state="IDLE"
              faceId="classic"
              customization={preview}
              sculpt={sculpt}
              skin={cfg.avatarSkin}
              lips={cfg.avatarLips}
              showCircuits={cfg.avatarCircuits !== false}
              polygonLevel="medium"
              hairStyleId={cfg.avatarHair}
              hairShadeId={cfg.avatarHairShade}
              avatarMode="3d"
            />
            <div className="creator-preview-note">Aperçu en direct (qualité Standard)</div>
          </div>

          <div className="creator-controls">
            <div className="creator-presets">
              {FACE_PRESETS.map((preset) => (
                <button key={preset.id} className="space-pill" onClick={() => setDraft(presetValues(preset.id))}>{preset.label}</button>
              ))}
              <button className="space-pill" onClick={() => setDraft(randomFaceCustom(Date.now()))}>🎲 Aléatoire</button>
              <button className="space-pill active" onClick={() => setPolyOpen(true)} title="Modifier chaque point et chaque polygone du visage à la main">
                🧱 Éditeur de polygones{isEmptySculpt(sculpt) ? '' : ` (${Object.keys(sculpt).length} retouches)`}
              </button>
            </div>

            <div className="creator-tabs">
              {FACE_GROUPS.map((entry) => (
                <button key={entry.id} className={`space-tab ${group === entry.id ? 'active' : ''}`} onClick={() => setGroup(entry.id)}>
                  {entry.icon} {entry.label}
                </button>
              ))}
            </div>

            <div className="creator-sliders">
              {params.map((param) => (
                <div key={param.id} className="creator-slider">
                  <div className="creator-slider-head">
                    <label htmlFor={`creator-${param.id}`}>{param.label}</label>
                    <span className="creator-value">{draft[param.id] > 0 ? '+' : ''}{Math.round(draft[param.id] * 100)}</span>
                    <button className="creator-reset" onClick={() => setValue(param.id, 0)} disabled={draft[param.id] === 0} title="Remettre à 0">↺</button>
                  </div>
                  <input
                    id={`creator-${param.id}`}
                    type="range"
                    min="-100"
                    max="100"
                    step="1"
                    value={Math.round(draft[param.id] * 100)}
                    onChange={(event) => setValue(param.id, Number(event.target.value) / 100)}
                    onDoubleClick={() => setValue(param.id, 0)}
                  />
                  <div className="creator-slider-hints"><span>{param.low}</span><span>{param.high}</span></div>
                </div>
              ))}
            </div>

            <div className="creator-slots">
              <strong>Mes looks</strong>
              <div className="creator-slot-form">
                <input type="text" maxLength={30} placeholder="Nom du look" value={slotName} onChange={(event) => setSlotName(event.target.value)} />
                <button className="space-pill" onClick={saveSlot}>💾 Enregistrer</button>
              </div>
              {slots.length === 0 && <div className="space-sub">Aucun look enregistré.</div>}
              {slots.map((slot) => (
                <div key={slot.name} className="creator-slot">
                  <span>{slot.name}</span>
                  <button className="space-pill" onClick={() => setDraft(slot.values)}>Charger</button>
                  <button className="space-pill" onClick={() => deleteSlot(slot.name)} title="Supprimer">🗑️</button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="creator-footer">
          <button className="space-pill" onClick={() => { setDraft({ ...DEFAULT_FACE_CUSTOM }); setSculpt({}); }} disabled={isDefaultFaceCustom(draft) && isEmptySculpt(sculpt)}>↺ Tout réinitialiser</button>
          <span className="creator-spacer" />
          <button className="space-pill" onClick={onClose}>Annuler</button>
          <button className="space-pill active" onClick={apply}>✅ Appliquer</button>
        </div>
      </div>
      {polyOpen && (
        <PolygonEditor
          custom={draft}
          sculpt={sculpt}
          onClose={() => setPolyOpen(false)}
          onApply={(next) => { setSculpt(next); setPolyOpen(false); }}
        />
      )}
    </div>
  );
}
