// Détection de visages sur la webcam (MediaPipe FaceDetector, modèle BlazeFace court portée, Apache-2.0), entièrement dans cette fenêtre.
// Rien n'est enregistré ni envoyé : seul un nombre de visages sort d'ici. Activé uniquement par l'utilisateur (Réglages), avec un
// voyant « caméra active » permanent dans l'interface.
import { configStore } from '../core/ConfigStore.js';
import { PresenceTracker } from './presenceTracker.js';

const SAMPLE_MS = 400;

export class PresenceMonitor {
  constructor({ onChange = () => {}, onEvent = () => {}, onStatus = () => {} } = {}) {
    this.onChange = onChange;
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.tracker = new PresenceTracker();
    this.running = false;
    this.stream = null;
    this.video = null;
    this.timer = null;
    this.detector = null;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    try {
      const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks('./mediapipe/wasm');
      this.detector = await FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: './models/blaze_face_short_range.tflite', delegate: 'CPU' },
        runningMode: 'VIDEO',
        minDetectionConfidence: 0.6,
      });
      const cameraId = configStore.get().cameraId;
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { ...(cameraId ? { deviceId: { ideal: cameraId } } : {}), width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      if (!this.running) { this.stop(); return; }
      this.video = document.createElement('video');
      this.video.muted = true;
      this.video.playsInline = true;
      this.video.srcObject = this.stream;
      await this.video.play();
      this.onStatus('Présence : caméra active');
      this.timer = setInterval(() => this.sample(), SAMPLE_MS);
    } catch (err) {
      this.onStatus(`Présence indisponible : ${err?.message || err}`);
      this.stop();
    }
  }

  sample() {
    if (!this.detector || !this.video || this.video.readyState < 2) return;
    let count = 0;
    try { count = this.detector.detectForVideo(this.video, performance.now()).detections.length; } catch { return; }
    const { state, events } = this.tracker.push(count, Date.now());
    this.onChange(state);
    for (const e of events) this.onEvent(e, state);
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    try { this.detector?.close(); } catch { /* déjà fermé */ }
    this.detector = null;
    this.video = null;
    this.tracker = new PresenceTracker();
    this.onChange({ present: false, count: 0, multiple: false });
  }
}
