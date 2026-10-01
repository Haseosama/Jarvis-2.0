import React, { useEffect, useMemo, useState } from 'react';
import { layoutCircuit } from '../hardware/circuitAssembler.js';
import { hostBridge } from '../core/hostBridge.js';

function wirePath(a, b) {
  const dx = Math.max(60, Math.abs(b.x - a.x) * 0.45);
  const direction = b.x >= a.x ? 1 : -1;
  return `M ${a.x} ${a.y} C ${a.x + dx * direction} ${a.y}, ${b.x - dx * direction} ${b.y}, ${b.x} ${b.y}`;
}

export default function CircuitPanel({ circuit, sourceLabel = '', onClose }) {
  const maxStep = useMemo(() => Math.max(1, ...(circuit?.wires || []).map((wire) => wire.step)), [circuit]);
  const [step, setStep] = useState(maxStep);
  const [copied, setCopied] = useState(false);
  const layout = useMemo(() => (circuit ? layoutCircuit(circuit) : null), [circuit]);

  useEffect(() => { setStep(maxStep); setCopied(false); }, [maxStep, circuit]);

  if (!circuit || !layout) {
    return (
      <div className="circuit-panel">
        <div className="space-header"><strong>⚡ Assembleur de circuits</strong>{onClose && <button className="space-close-btn" onClick={onClose}>✕</button>}</div>
        <div className="circuit-empty">Demandez à Jarvis : « comment connecter un capteur DHT11 à un Arduino ? » ou « analyse les composants sur mon écran ».</div>
      </div>
    );
  }

  const copyCode = async () => {
    const result = await hostBridge.writeClipboard(circuit.arduino_code);
    setCopied(Boolean(result.ok));
  };

  return (
    <div className="circuit-panel">
      <div className="space-header">
        <div>
          <strong>⚡ {circuit.title}</strong>
          {sourceLabel && <div className="space-sub">{sourceLabel}</div>}
        </div>
        {onClose && <button className="space-close-btn" onClick={onClose} title="Fermer">✕</button>}
      </div>
      <div className="circuit-body">
        <div className="circuit-schematic-wrap">
          {circuit.description && <p className="circuit-description">{circuit.description}</p>}
          <svg
            className="circuit-svg"
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            role="img"
            aria-label={`Schéma de câblage : ${circuit.title}`}
          >
            {circuit.components.map((component) => {
              const box = layout.positions.get(component.id);
              return (
                <g key={component.id}>
                  <rect x={box.x} y={box.y} width={box.width} height={box.height} rx="10" className={`circuit-card ${component.highlight ? 'highlight' : ''}`} />
                  <text x={box.x + box.width / 2} y={box.y + 24} textAnchor="middle" className="circuit-card-title">{component.name}</text>
                  <text x={box.x + box.width / 2} y={box.y + 42} textAnchor="middle" className="circuit-card-subtitle">{component.subtitle}</text>
                  {component.left_pins.map((pin, index) => {
                    const y = box.y + 56 + index * 28 + 14;
                    return (
                      <g key={`l-${pin.name}`}>
                        <circle cx={box.x} cy={y} r="6" fill={pin.color} stroke="#06111e" strokeWidth="1.5" />
                        <text x={box.x + 14} y={y + 4} className="circuit-pin-label">{pin.name}</text>
                      </g>
                    );
                  })}
                  {component.right_pins.map((pin, index) => {
                    const y = box.y + 56 + index * 28 + 14;
                    return (
                      <g key={`r-${pin.name}`}>
                        <circle cx={box.x + box.width} cy={y} r="6" fill={pin.color} stroke="#06111e" strokeWidth="1.5" />
                        <text x={box.x + box.width - 14} y={y + 4} textAnchor="end" className="circuit-pin-label">{pin.name}</text>
                      </g>
                    );
                  })}
                </g>
              );
            })}
            {layout.wires.map((wire, index) => {
              const visible = wire.step <= step;
              const midX = (wire.a.x + wire.b.x) / 2;
              const midY = (wire.a.y + wire.b.y) / 2;
              return (
                <g key={index} opacity={visible ? 1 : 0.12} className={wire.step === step ? 'circuit-wire-current' : ''}>
                  <path d={wirePath(wire.a, wire.b)} fill="none" stroke={wire.color} strokeWidth={wire.step === step ? 4 : 2.5} strokeLinecap="round" />
                  {visible && wire.label && <text x={midX} y={midY - 6} textAnchor="middle" className="circuit-wire-label">{wire.label}</text>}
                </g>
              );
            })}
          </svg>
          <div className="circuit-step-controls">
            <button className="space-mini-btn" onClick={() => setStep((value) => Math.max(1, value - 1))} disabled={step <= 1}>◀</button>
            <span>Étape {step} / {maxStep}</span>
            <button className="space-mini-btn" onClick={() => setStep((value) => Math.min(maxStep, value + 1))} disabled={step >= maxStep}>▶</button>
            <button className="space-mini-btn" onClick={() => setStep(maxStep)}>Tout afficher</button>
          </div>
        </div>
        <aside className="circuit-side">
          {circuit.warnings.length > 0 && (
            <section className="circuit-warnings">
              <h4>⚠️ Avant de brancher</h4>
              <ul>{circuit.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
            </section>
          )}
          {circuit.steps.length > 0 && (
            <section>
              <h4>🔧 Assemblage</h4>
              <ol>{circuit.steps.map((text, index) => <li key={index}>{text}</li>)}</ol>
            </section>
          )}
          {circuit.arduino_code && (
            <section>
              <h4>💻 Code Arduino <button className="space-mini-btn" onClick={copyCode}>{copied ? 'Copié ✓' : 'Copier'}</button></h4>
              <pre className="circuit-code"><code>{circuit.arduino_code}</code></pre>
              <div className="space-sub">Le code n’est jamais exécuté par Jarvis : relisez-le avant de le téléverser.</div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
