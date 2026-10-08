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
  const [images, setImages] = useState(null); // electron/imageInstall.cjs : installé, en cours, erreur

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
      } else if (event?.type === 'browser') {
        setMessage(`Navigateur piloté depuis le téléphone (${String(event.action).slice(0, 20)}).`);
      } else if (event?.type === 'image') {
        setMessage('Image demandée depuis le téléphone.');
      }
    });
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const readImages = async () => setImages(await hostBridge.imageGen('status'));
    readImages();
    const imageTick = setInterval(readImages, 3000);
    return () => {
      unsub?.();
      clearInterval(tick);
      clearInterval(imageTick);
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

  const switchMode = async () => {
    const next = status?.mode === 'local' ? 'distance' : 'local';
    const res = await hostBridge.remote('mode', next);
    setPairing(null);
    setQr('');
    setMessage(
      !res.ok
        ? res.error || 'Échec.'
        : next === 'distance'
          ? 'Accès à distance : le téléphone passe par Tailscale, le Wi-Fi local est fermé. Appairez de nouveau le téléphone.'
          : 'Wi-Fi local : le téléphone doit être sur le même réseau que le PC. Appairez de nouveau le téléphone.',
    );
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

  const remote = status?.mode !== 'local';
  const remaining = pairing ? Math.max(0, Math.round((pairing.expiresAt - now) / 1000)) : 0;

  return (
    <div className="space-card">
      <h4>📱 Contrôle depuis le téléphone (Jarvis Android)</h4>
      <p className="settings-hint">
        Pilotez ce PC par la voix depuis Jarvis Android. Dans l’app : Réglages &gt; Jarvis PC, puis scannez le QR code (ou
        tapez l’adresse et le code). Le téléphone reste appairé, même après un redémarrage de Jarvis.
      </p>
      <p className="settings-hint">
        {remote ? (
          <>
            🌍 <b>Accès à distance</b> : le téléphone joint ce PC de partout (4G, autre Wi-Fi) par Tailscale, un réseau privé
            chiffré et gratuit entre vos appareils, sans port à ouvrir sur la box. Le Wi-Fi local, lui, est fermé : un autre
            appareil de la maison ne peut pas s’y connecter. Une seule fois : installez Tailscale sur ce PC (tailscale.com/download)
            et sur le téléphone (Play Store), connectez-vous avec le même compte sur les deux, puis appairez le téléphone.
          </>
        ) : (
          <>🏠 <b>Wi-Fi local</b> : seulement quand le téléphone est sur le même réseau que le PC.</>
        )}
      </p>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '8px 0' }}>
        <button className="space-mini-btn" onClick={showCode}>
          🔗 Appairer un téléphone
        </button>
        <button className="space-mini-btn" onClick={switchMode}>
          {remote ? '🏠 Passer en Wi-Fi local' : '🌍 Passer en accès à distance'}
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
        {status?.running && remote && !status.tailscale
          ? 'Actif, mais Tailscale n’est pas connecté sur ce PC : le téléphone ne peut pas le joindre.'
          : status?.running
          ? `Actif sur ${status.address}${remote ? ' (Tailscale)' : ' (Wi-Fi local)'} • ${status.devices || 0} téléphone(s) appairé(s)`
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
      {images && !images.unavailable && (
        <div style={{ marginTop: '12px' }}>
          <div className="settings-hint">
            🎨 Images pour le téléphone :{' '}
            {images.installed
              ? `ComfyUI installé${images.running ? ', en marche' : ' (démarre à la première image)'}.`
              : images.installing
                ? images.text
                : images.step === 'error'
                  ? `échec : ${images.text}`
                  : 'aucun générateur installé (ComfyUI et son modèle, environ 9 Go ; carte graphique NVIDIA conseillée).'}
          </div>
          {!images.installed && !images.installing && (
            <button className="space-mini-btn" style={{ marginTop: '6px' }} onClick={async () => setImages(await hostBridge.imageGen('install'))}>
              ⬇️ Installer le générateur d’images
            </button>
          )}
        </div>
      )}
      {status?.running && status.fingerprint && (
        <div className="settings-hint" style={{ marginTop: '6px', wordBreak: 'break-all', opacity: 0.7 }}>
          Empreinte du certificat : {status.fingerprint}
        </div>
      )}
    </div>
  );
}
