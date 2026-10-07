import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { hostBridge } from '../core/hostBridge.js';

// Contrôle à distance depuis Jarvis Android : un QR code à scanner dans l'app (Réglages > Jarvis PC), ou l'adresse et le
// code à taper. Le serveur est dans electron/remoteServer.cjs ; ce panneau ne fait que l'allumer et afficher le code.
export default function RemoteControlCard() {
  const [status, setStatus] = useState(null);
  const [pairing, setPairing] = useState(null); // { key, url, address, expiresAt }
  const [qr, setQr] = useState('');
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(Date.now());

  const refresh = async () => setStatus(await hostBridge.remote('status'));

  useEffect(() => {
    refresh();
    const unsub = hostBridge.onRemoteEvent((event) => {
      if (event?.type === 'paired') {
        setPairing(null);
        setQr('');
        setMessage('Téléphone appairé. Parlez à Jarvis sur le téléphone : « sur le PC, ouvre Chrome ».');
        refresh();
      } else if (event?.type === 'command') {
        setMessage(`Ordre reçu du téléphone : « ${String(event.text).slice(0, 80)} »`);
      }
    });
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      unsub?.();
      clearInterval(tick);
    };
  }, []);

  const showCode = async () => {
    setMessage('');
    const res = await hostBridge.remote('newKey');
    if (!res.ok) {
      setMessage(res.error || 'Impossible de démarrer le contrôle à distance.');
      refresh();
      return;
    }
    setPairing(res);
    try {
      setQr(await QRCode.toDataURL(res.url, { margin: 1, width: 220 }));
    } catch {
      setQr('');
    }
    refresh();
  };

  const toggle = async () => {
    const res = await hostBridge.remote('enable', !status?.enabled);
    setPairing(null);
    setQr('');
    setMessage(res.ok ? '' : res.error || 'Échec.');
    refresh();
  };

  const revoke = async () => {
    await hostBridge.remote('revoke');
    setMessage('Tous les téléphones ont été oubliés : il faudra un nouveau code.');
    refresh();
  };

  if (status?.unavailable) {
    return (
      <div className="space-card">
        <h4>📱 Contrôle depuis le téléphone</h4>
        <p className="settings-hint">{status.error}</p>
      </div>
    );
  }

  const remaining = pairing ? Math.max(0, Math.round((pairing.expiresAt - now) / 1000)) : 0;

  return (
    <div className="space-card">
      <h4>📱 Contrôle depuis le téléphone (Jarvis Android)</h4>
      <p className="settings-hint">
        Pilotez ce PC par la voix depuis Jarvis Android, sur le même réseau Wi-Fi. Dans l’app : Réglages &gt; Jarvis PC, puis
        scannez le QR code (ou tapez l’adresse et le code). Le téléphone reste appairé, même après un redémarrage de Jarvis.
      </p>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '8px 0' }}>
        <button className="space-mini-btn" onClick={showCode}>
          🔗 Appairer un téléphone
        </button>
        <button className="space-mini-btn" onClick={toggle}>
          {status?.enabled ? '⏸️ Désactiver' : '▶️ Activer'}
        </button>
        {status?.devices > 0 && (
          <button className="space-mini-btn" onClick={revoke}>
            🗑️ Oublier les téléphones
          </button>
        )}
      </div>
      <div className="settings-hint">
        {status?.running
          ? `Actif sur ${status.address} • ${status.devices || 0} téléphone(s) appairé(s)`
          : status?.enabled
            ? 'Activé, mais le serveur n’a pas pu démarrer.'
            : 'Désactivé.'}
      </div>
      {pairing && remaining > 0 && (
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap' }}>
          {qr && <img src={qr} alt="QR code d’appairage" width={220} height={220} style={{ borderRadius: '8px', background: '#fff' }} />}
          <div>
            <div className="settings-hint">Adresse</div>
            <div style={{ fontSize: '20px', fontFamily: 'monospace' }}>{pairing.address}</div>
            <div className="settings-hint" style={{ marginTop: '8px' }}>Code</div>
            <div style={{ fontSize: '32px', fontFamily: 'monospace', letterSpacing: '8px' }}>{pairing.key}</div>
            <div className="settings-hint">
              Valable encore {Math.floor(remaining / 60)} min {String(remaining % 60).padStart(2, '0')} s, une seule fois.
            </div>
          </div>
        </div>
      )}
      {pairing && remaining === 0 && <div className="settings-hint">Code expiré : cliquez de nouveau sur « Appairer un téléphone ».</div>}
      {message && <div className="settings-hint" style={{ marginTop: '8px' }}>{message}</div>}
      {status?.running && status.fingerprint && (
        <div className="settings-hint" style={{ marginTop: '6px', wordBreak: 'break-all', opacity: 0.7 }}>
          Empreinte du certificat : {status.fingerprint}
        </div>
      )}
    </div>
  );
}
