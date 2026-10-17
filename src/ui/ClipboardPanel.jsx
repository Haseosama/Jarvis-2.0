import React, { useEffect, useRef, useState } from 'react';
import { hostBridge } from '../core/hostBridge.js';
import { CLIPBOARD_ACTIONS, buildClipboardPrompt, shouldOffer } from '../core/clipboardWatch.js';

// Panneau flottant : quand un texte est copié, propose Traduire / Résumer / Expliquer / Corriger.
// Actif seulement si l'utilisateur l'a activé (le presse-papiers n'est lu qu'à ce moment-là).
export default function ClipboardPanel({ enabled, onAsk, ownCopyRef }) {
  const [text, setText] = useState('');
  const lastRef = useRef('');

  useEffect(() => {
    if (!enabled) { setText(''); return undefined; }
    let stopped = false;
    const tick = async () => {
      const res = await hostBridge.readClipboard();
      if (stopped || !res.ok) return;
      if (shouldOffer(res.text, lastRef.current, ownCopyRef?.current)) setText(res.text.trim());
      lastRef.current = res.text;
    };
    // La valeur déjà présente à l'activation n'est pas proposée : seule une nouvelle copie l'est.
    hostBridge.readClipboard().then((r) => { lastRef.current = r.text || ''; });
    const id = setInterval(tick, 1500);
    return () => { stopped = true; clearInterval(id); };
  }, [enabled, ownCopyRef]);

  if (!enabled || !text) return null;
  return (
    <div className="clip-panel" role="dialog" aria-label="Presse-papiers intelligent">
      <div className="clip-preview">📋 {text.slice(0, 90)}{text.length > 90 ? '…' : ''}</div>
      <div className="clip-actions">
        {CLIPBOARD_ACTIONS.map((a) => (
          <button key={a.id} type="button" onClick={() => { onAsk(buildClipboardPrompt(a.id, text)); setText(''); }}>{a.label}</button>
        ))}
        <button type="button" aria-label="Fermer" onClick={() => setText('')}>✕</button>
      </div>
    </div>
  );
}
