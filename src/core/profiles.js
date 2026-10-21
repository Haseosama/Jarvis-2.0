// Profils du foyer et mémoire par personne (idée de Cornelius : « des souvenirs propres à chaque personne »).
//
// Ce n'est pas une sécurité : n'importe qui peut dire « c'est Sacha ». Un profil sert à ranger les souvenirs et à ne pas mélanger les
// personnes de la maison. Les souvenirs du foyer (sans profil) sont visibles de tous ; ceux d'un profil ne le sont que sous ce profil.
// Quand plusieurs personnes sont devant l'écran (mode vie privée) ou depuis un satellite audio, seuls les souvenirs du foyer sont utilisés.

export const profileState = {
  /** undefined : aucun forçage ; null ou id : profil imposé le temps d'un appel (conversation de satellite). */
  override: undefined,
  /** Plusieurs personnes devant la caméra : seuls les souvenirs du foyer servent. */
  privacy: false,
};

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Profil réellement utilisé maintenant : id, ou null pour le foyer. */
export function effectiveProfileId(data, state = profileState) {
  if (state.override !== undefined) return state.override;
  if (state.privacy) return null;
  const id = data?.activeProfileId ?? null;
  return id && (data.profiles || []).some((p) => p.id === id) ? id : null;
}

/** Souvenirs visibles sous ce profil : ceux du foyer et les siens. */
export function visibleMemories(data, profileId) {
  return (data?.memories || []).filter((m) => !m.profileId || m.profileId === profileId);
}

export function profileName(data, id) {
  return (data?.profiles || []).find((p) => p.id === id)?.name || null;
}

/** Retrouve un profil par son nom (exact, puis contenu), sans tenir compte des accents. */
export function findProfile(profiles, name) {
  const wanted = fold(name);
  if (!wanted) return null;
  const list = profiles || [];
  return list.find((p) => fold(p.name) === wanted) || list.find((p) => fold(p.name).includes(wanted) || wanted.includes(fold(p.name))) || null;
}

export const MAX_PROFILES = 12;

export function cleanProfileName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, 30);
}

/** Phrase ajoutée au prompt : qui parle, et la règle de discrétion. */
export function profilePromptLine(data, state = profileState) {
  const id = effectiveProfileId(data, state);
  const name = profileName(data, id);
  const others = (data?.profiles || []).length > 0;
  if (!others) return '';
  const who = name ? `Personne actuelle : ${name}. ` : state.privacy ? 'Plusieurs personnes sont devant l’écran : mode vie privée, seuls les souvenirs du foyer sont disponibles. ' : 'Personne non identifiée : seuls les souvenirs du foyer sont disponibles. ';
  return `\n${who}Ne révèle jamais les souvenirs d’une autre personne ; pour passer à quelqu’un d’autre, l’utilisateur le dit et tu utilises l’outil profile.`;
}
