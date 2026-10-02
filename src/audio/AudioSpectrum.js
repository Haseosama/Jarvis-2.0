const BAND_FREQUENCIES = [80, 140, 240, 420, 730, 1250, 2150, 3600, 6000];
const clamp01 = (value) => Math.max(0, Math.min(1, value));

// Nine low-cost Goertzel bins give the command-bar visualizer a real spectrum
// without adding an audio/DSP dependency to the standalone app.
export function analyzeAudioSpectrum(samples, sampleRate = 16000) {
  if (!samples?.length || !Number.isFinite(sampleRate) || sampleRate <= 0) return BAND_FREQUENCIES.map(() => 0);
  const size = Math.min(512, samples.length);
  if (size < 32) return BAND_FREQUENCIES.map(() => 0);
  const start = samples.length - size;
  const spectrum = [];

  for (const requestedFrequency of BAND_FREQUENCIES) {
    const frequency = Math.min(requestedFrequency, sampleRate * 0.45);
    const omega = (2 * Math.PI * frequency) / sampleRate;
    const coefficient = 2 * Math.cos(omega);
    let previous = 0;
    let previous2 = 0;

    for (let i = 0; i < size; i++) {
      const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, size - 1));
      const sample = Number(samples[start + i]) || 0;
      const current = sample * window + coefficient * previous - previous2;
      previous2 = previous;
      previous = current;
    }

    const power = Math.max(0, previous * previous + previous2 * previous2 - coefficient * previous * previous2);
    const amplitude = (4 * Math.sqrt(power)) / size;
    spectrum.push(amplitude < 0.002 ? 0 : clamp01(Math.sqrt(amplitude) * 2.4));
  }
  return spectrum;
}

export const AUDIO_SPECTRUM_BAND_COUNT = BAND_FREQUENCIES.length;
