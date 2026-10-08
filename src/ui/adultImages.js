// Réglage « contenu adulte (18+) » des images créées sur le PC : une seule confirmation, partagée par les Réglages et le Studio d'images.
export const ADULT_IMAGES_CONFIRM =
  'Autoriser les images pour adultes (18 ans et plus) ?\n\nRéservé aux adultes, pour des personnages fictifs adultes : ne créez pas d’images de personnes réelles. Jarvis refuse toujours toute demande d’enfant ou de mineur.';

/** Active ou désactive le réglage ; l'activation demande confirmation. Renvoie la nouvelle valeur. */
export function toggleAdultImages(checked, update, confirmFn = (text) => window.confirm(text)) {
  if (!checked) { update({ imageAdult: false }); return false; }
  if (confirmFn(ADULT_IMAGES_CONFIRM)) { update({ imageAdult: true }); return true; }
  return false;
}
