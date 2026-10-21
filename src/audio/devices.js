// Choix du micro et des haut-parleurs par leur nom (port de core/audio_devices.py de Mark LVI).

/** Liste courte : les alias système « default » / « communications » et les doublons sont écartés. */
export function cleanDevices(devices, kind) {
  const seen = new Set();
  return (devices || [])
    .filter((d) => d && d.kind === kind && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
    .filter((d) => {
      const key = `${d.groupId || ''}|${String(d.label || d.deviceId).toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((d) => ({ id: d.deviceId, label: String(d.label || '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '') || 'Périphérique audio' }));
}

export async function listAudioDevices(enumerate = () => navigator.mediaDevices.enumerateDevices()) {
  try {
    const all = await enumerate();
    return { inputs: cleanDevices(all, 'audioinput'), outputs: cleanDevices(all, 'audiooutput'), cameras: cleanDevices(all, 'videoinput') };
  } catch {
    return { inputs: [], outputs: [], cameras: [] };
  }
}

/** Contraintes getUserMedia : le micro choisi (exact), sinon le micro par défaut. */
export function audioConstraints(cfg = {}, extra = {}) {
  const audio = { echoCancellation: true, noiseSuppression: true, ...extra };
  if (cfg.audioInputId) audio.deviceId = { ideal: cfg.audioInputId };
  return { audio };
}

/** Oriente un AudioContext vers les haut-parleurs choisis (Chromium). Sans effet, sans erreur, sinon. */
export function applySink(ctx, deviceId) {
  try {
    if (ctx && deviceId && typeof ctx.setSinkId === 'function') ctx.setSinkId(deviceId).catch(() => {});
  } catch { /* périphérique absent : on garde la sortie par défaut */ }
  return ctx;
}
