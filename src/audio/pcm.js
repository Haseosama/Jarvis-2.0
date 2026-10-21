// Outils PCM 16 bits little-endian mono, partagés par le pont des satellites audio.

/** Ré-échantillonne (interpolation linéaire) : 24 kHz → 16 kHz pour la voix renvoyée aux satellites. */
export function resampleS16(bytes, fromRate, toRate) {
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (fromRate === toRate) return src;
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength - (src.byteLength % 2));
  const inLen = view.byteLength >> 1;
  const outLen = Math.floor((inLen * toRate) / fromRate);
  const out = new Uint8Array(outLen * 2);
  const outView = new DataView(out.buffer);
  const ratio = fromRate / toRate;
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.min(inLen - 1, Math.floor(pos));
    const i1 = Math.min(inLen - 1, i0 + 1);
    const frac = pos - i0;
    const s = view.getInt16(i0 * 2, true) * (1 - frac) + view.getInt16(i1 * 2, true) * frac;
    outView.setInt16(i * 2, Math.max(-32768, Math.min(32767, Math.round(s))), true);
  }
  return out;
}

/** Entoure du PCM d'un en-tête WAV (pour l'envoyer à un service de transcription). */
export function wavFromPcm(pcm, sampleRate = 16000) {
  const data = pcm instanceof Uint8Array ? pcm : new Uint8Array(pcm);
  const out = new Uint8Array(44 + data.length);
  const v = new DataView(out.buffer);
  const tag = (o, s) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  tag(0, 'RIFF'); v.setUint32(4, 36 + data.length, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  tag(36, 'data'); v.setUint32(40, data.length, true);
  out.set(data, 44);
  return out;
}

/** Durée en secondes d'un PCM 16 bits mono. */
export const pcmSeconds = (bytes, rate = 16000) => bytes.byteLength / 2 / rate;
