// Les images créées dans Studio IA › Images, gardées hors des composants pour que l'onglet Vidéo puisse les animer
// même après un changement d'onglet. Seules ces images (PNG créés par Jarvis) peuvent être animées.
const state = { images: [], selected: null };
const listeners = new Set();

export function getStudioImages() { return state; }

export function addStudioImage(img) {
  state.images = [img, ...state.images.filter((i) => i.path !== img.path)].slice(0, 12);
  listeners.forEach((fn) => fn(state));
}

export function selectStudioImage(path) {
  state.selected = path || null;
  listeners.forEach((fn) => fn(state));
}

export function subscribeStudioImages(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
