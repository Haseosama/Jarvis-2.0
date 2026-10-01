import React, { useEffect, useRef, useState } from 'react';
import { hostBridge } from '../core/hostBridge.js';
import { configStore } from '../core/ConfigStore.js';
import { llmStore } from '../llm/llmStore.js';
import { callModel } from '../llm/providers.js';
import { CODE_SYSTEM_PROMPT, extractCodeBlocks, safeRelativePath, suggestFilename, withAttachedFile } from '../llm/codeTools.js';
import { ModelPicker, useLlmState } from './ProviderSettings.jsx';

const HISTORY_LIMIT = 20;
const isDesktop = () => typeof window !== 'undefined' && Boolean(window.jarvisHost);

function CodeCard({ block, index, onNotice }) {
  const [name, setName] = useState(suggestFilename(block, index));
  const copy = async () => onNotice((await hostBridge.writeClipboard(block.code)).ok ? 'Code copié.' : '⚠️ Copie impossible.');
  const save = async () => {
    const rel = safeRelativePath(name);
    if (!rel) return onNotice('⚠️ Nom de fichier invalide (chemin relatif sans « .. »).');
    const root = configStore.get().workFolderPath || '';
    if (!root && isDesktop()) return onNotice('⚠️ Définissez d’abord un Dossier de travail dans les Réglages.');
    if (!root) {
      const res = await hostBridge.saveDocument({ filename: rel.split('/').pop(), text: block.code, mimeType: 'text/plain' });
      return onNotice(res.ok ? `Téléchargé : ${res.path}` : `⚠️ ${res.error}`);
    }
    const existing = await hostBridge.fileOp({ root, action: 'read', relPath: rel });
    if (existing.ok && !window.confirm(`« ${rel} » existe déjà dans le dossier de travail. Le remplacer ?`)) return onNotice('Enregistrement annulé.');
    const res = await hostBridge.fileOp({ root, action: 'write', relPath: rel, content: block.code });
    onNotice(res.ok ? `Enregistré : ${rel} (le code n’est jamais exécuté par Jarvis).` : `⚠️ ${res.error || 'Écriture impossible.'}`);
  };
  return (
    <div className="llm-code">
      <div className="llm-code-bar">
        <span>{block.lang || 'texte'}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Nom du fichier" />
        <button className="space-pill" onClick={copy}>📋 Copier</button>
        <button className="space-pill" onClick={save}>💾 Enregistrer</button>
      </div>
      <pre className="skill-code">{block.code}</pre>
    </div>
  );
}

export default function CodeStudio({ seed }) {
  const state = useLlmState();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [attachPath, setAttachPath] = useState('');
  const [file, setFile] = useState(null);
  const [imported, setImported] = useState([]);
  const endRef = useRef(null);

  useEffect(() => { if (seed) setInput(seed); }, [seed]);
  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'end' }); }, [messages, busy]);

  const send = async () => {
    const prompt = input.trim();
    if (!prompt || busy) return;
    const slot = state.code;
    const userContent = withAttachedFile(prompt, file);
    const history = [...messages, { role: 'user', content: userContent, shown: prompt }];
    setMessages(history);
    setInput('');
    setBusy(true);
    setNotice('');
    const result = await callModel({
      ...llmStore.resolve(slot),
      system: CODE_SYSTEM_PROMPT,
      messages: history.slice(-HISTORY_LIMIT).map(({ role, content }) => ({ role, content })),
    });
    setMessages((prev) => [...prev, result.ok
      ? { role: 'assistant', content: result.text, meta: `${slot.model} · ${(result.ms / 1000).toFixed(1)} s` }
      : { role: 'error', content: result.error }]);
    setBusy(false);
  };

  const attach = async () => {
    const rel = safeRelativePath(attachPath);
    const root = configStore.get().workFolderPath || '';
    if (!rel) return setNotice('⚠️ Chemin relatif invalide.');
    if (!root) return setNotice('⚠️ Définissez un Dossier de travail dans les Réglages pour joindre des fichiers.');
    const res = await hostBridge.fileOp({ root, action: 'read', relPath: rel });
    if (!res.ok) return setNotice(`⚠️ ${res.error || 'Lecture impossible.'}`);
    setFile({ path: rel, content: res.content });
    setNotice(`Fichier joint : ${rel} (envoyé au fournisseur avec la prochaine question).`);
  };

  const importClipboard = async () => {
    const res = await hostBridge.readClipboard();
    const text = (res.text || '').trim();
    if (!res.ok || !text) return setNotice('⚠️ Presse-papiers vide ou inaccessible. Copiez d’abord le code depuis arena.ai.');
    const blocks = extractCodeBlocks(text);
    setImported(blocks.length ? blocks : [{ lang: '', code: text.slice(0, 60000), filename: '' }]);
    setInput((prev) => `${prev ? `${prev}\n\n` : 'Relis ce code et améliore-le :\n\n'}\`\`\`\n${text.slice(0, 60000)}\n\`\`\``);
    setNotice(`${blocks.length || 1} bloc(s) importé(s) depuis le presse-papiers : ajouté à la saisie.`);
  };

  const openArena = async () => {
    const res = await hostBridge.openArena();
    setNotice(res.ok ? 'arena.ai ouvert : connectez-vous et utilisez-le vous-même, puis copiez le code ici.' : `⚠️ ${res.message}`);
  };

  return (
    <div className="llm-studio">
      <div className="llm-toolbar">
        <ModelPicker value={state.code} onChange={(code) => llmStore.update({ code })} disabled={busy} />
        <button className="space-pill" onClick={openArena} title="Ouvre arena.ai dans une fenêtre séparée : usage manuel uniquement">🌐 Ouvrir arena.ai</button>
        <button className="space-pill" onClick={importClipboard} title="Colle ici le code que vous avez copié depuis arena.ai">📋 Envoyer le code copié à Jarvis</button>
        <button className="space-pill" onClick={() => { setMessages([]); setFile(null); setImported([]); setNotice(''); }}>🧹 Nouvelle conversation</button>
      </div>
      {notice && <div className="space-sub skill-message llm-notice">{notice}</div>}
      {imported.length > 0 && (
        <div className="llm-imported">
          <div className="llm-code-bar"><strong>📋 Importé du presse-papiers</strong><button className="space-pill" onClick={() => setImported([])}>✕</button></div>
          {imported.map((b, i) => <CodeCard key={i} block={b} index={i} onNotice={setNotice} />)}
        </div>
      )}
      <div className="llm-chat">
        {messages.length === 0 && <div className="circuit-empty">Posez une question de code. Jarvis n’exécute jamais le code généré : vous le relisez, le copiez ou l’enregistrez.</div>}
        {messages.map((m, i) => (
          <div key={i} className={`llm-msg ${m.role}`}>
            <div className="llm-msg-head">{m.role === 'user' ? 'Vous' : m.role === 'error' ? 'Erreur' : `🤖 ${m.meta || ''}`}</div>
            <div className="llm-text">{m.shown || m.content}</div>
            {m.role === 'assistant' && extractCodeBlocks(m.content).map((b, j) => <CodeCard key={j} block={b} index={j} onNotice={setNotice} />)}
          </div>
        ))}
        {busy && <div className="space-sub">⏳ {state.code.model} réfléchit…</div>}
        <div ref={endRef} />
      </div>
      <div className="llm-attach">
        <input value={attachPath} placeholder="Fichier du dossier de travail à joindre (ex. src/app.js)" onChange={(e) => setAttachPath(e.target.value)} />
        <button className="space-pill" onClick={attach} disabled={!attachPath.trim()}>📎 Joindre</button>
        {file && <button className="space-pill" onClick={() => { setFile(null); setNotice('Fichier retiré.'); }}>✕ {file.path}</button>}
      </div>
      <div className="llm-composer">
        <textarea value={input} rows={3} placeholder="Votre demande… (Ctrl+Entrée pour envoyer)" onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }} />
        <button className="space-pill active" onClick={send} disabled={busy || !input.trim()}>Envoyer</button>
      </div>
    </div>
  );
}
