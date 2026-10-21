// Une image de la webcam à la demande (jamais en continu) : le flux est ouvert, une image est prise, le flux est fermé.
import { configStore } from './ConfigStore.js';

export async function captureWebcam({ maxDim = 1024, settleMs = 450 } = {}) {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) throw new Error('webcam non disponible ici');
  const cameraId = configStore.get().cameraId;
  const stream = await navigator.mediaDevices.getUserMedia({ video: cameraId ? { deviceId: { ideal: cameraId }, width: { ideal: 1280 } } : { width: { ideal: 1280 } }, audio: false });
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    await new Promise((r) => setTimeout(r, settleMs)); // laisse l'exposition se régler
    const scale = Math.min(1, maxDim / Math.max(video.videoWidth || 1, video.videoHeight || 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((video.videoWidth || 640) * scale));
    canvas.height = Math.max(1, Math.round((video.videoHeight || 480) * scale));
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}
