// Spotify album, library and advanced playlist operations.
// `request(path, {method, body})` is the authenticated Spotify Web API caller from spotifyClient.js.
// Endpoints follow the current Web API reference (unified /me/library, /playlists/{id}/items).

import { matchByName } from './nameMatch.js';

const TYPE_PATTERN = '(track|album|playlist|artist|episode|show)';
const ID_PATTERN = /^[A-Za-z0-9]{10,64}$/;

/** Accepts spotify:type:id, an open.spotify.com URL, or a bare id (when `expected` is given). */
export function parseSpotifyRef(value, expected = '') {
  const text = String(value || '').trim();
  if (!text) return null;
  let match = new RegExp(`^spotify:${TYPE_PATTERN}:([A-Za-z0-9]{10,64})$`).exec(text);
  if (!match) match = new RegExp(`^https://open\\.spotify\\.com/(?:intl-[a-z]+/)?${TYPE_PATTERN}/([A-Za-z0-9]{10,64})(?:[?#/].*)?$`).exec(text);
  if (match) {
    if (expected && match[1] !== expected) throw new Error(`Référence Spotify inattendue : ${match[1]} au lieu de ${expected}.`);
    return { type: match[1], id: match[2], uri: `spotify:${match[1]}:${match[2]}` };
  }
  if (expected && ID_PATTERN.test(text)) return { type: expected, id: text, uri: `spotify:${expected}:${text}` };
  throw new Error('Référence Spotify invalide.');
}

const names = (artists = []) => artists.map((artist) => artist.name).filter(Boolean).join(', ');
const trackLine = (track, index) => `${index + 1}. ${track?.name || 'Piste inconnue'}${track?.artists?.length ? ` — ${names(track.artists)}` : ''}`;
const clamp = (value, min, max, fallback) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) && Number(value) > 0 ? Math.round(Number(value)) : fallback));

function confirmation(what) {
  return `Action sensible : ${what}. Demandez confirmation à l’utilisateur, puis relancez avec confirmed=true.`;
}

async function currentTrack(request) {
  const playing = await request('/me/player/currently-playing');
  if (!playing?.item || playing.item.type === 'episode') throw new Error('Aucune piste Spotify n’est en cours de lecture.');
  return playing.item;
}

async function resolveAlbum(args, request) {
  const ref = args.album_id || args.uri;
  if (ref) return parseSpotifyRef(ref, 'album');
  if (args.query) {
    const found = await request(`/search?q=${encodeURIComponent(String(args.query))}&type=album&limit=1`);
    const album = found?.albums?.items?.[0];
    if (!album) throw new Error(`Aucun album Spotify trouvé pour « ${args.query} ».`);
    return parseSpotifyRef(album.uri);
  }
  const track = await currentTrack(request);
  if (!track.album?.uri) throw new Error('Impossible de déterminer l’album en cours.');
  return parseSpotifyRef(track.album.uri);
}

export async function resolvePlaylist(args, request) {
  if (args.playlist_id || String(args.uri || '').includes('playlist')) return parseSpotifyRef(args.playlist_id || args.uri, 'playlist');
  const wanted = String(args.playlist_name || args.name_of_playlist || '').trim();
  if (!wanted) throw new Error('Indiquez la playlist (playlist_id ou playlist_name).');
  const result = await request('/me/playlists?limit=50');
  const matches = matchByName(result?.items || [], wanted);
  if (matches.length !== 1) {
    throw new Error(matches.length ? `Plusieurs playlists correspondent à « ${wanted} » : ${matches.slice(0, 6).map((p) => p.name).join(', ')}.` : `Aucune de vos playlists ne correspond à « ${wanted} ».`);
  }
  return { ...parseSpotifyRef(matches[0].uri), name: matches[0].name };
}

function trackUris(args) {
  const raw = Array.isArray(args.uris) ? args.uris : args.uri ? [args.uri] : [];
  return raw.map((item) => {
    const ref = parseSpotifyRef(item, 'track');
    if (ref.type !== 'track' && ref.type !== 'episode') throw new Error('Seuls les URI de pistes ou d’épisodes sont acceptés ici.');
    return ref.uri;
  }).slice(0, 40);
}

const joinUris = (uris) => encodeURIComponent(uris.join(','));

export const SPOTIFY_LIBRARY_ACTIONS = [
  'get_album', 'get_saved_albums', 'save_album', 'remove_album',
  'save_tracks', 'remove_tracks', 'like_current', 'check_saved',
  'get_playlist', 'get_playlist_tracks', 'update_playlist', 'remove_tracks_from_playlist', 'reorder_playlist', 'delete_playlist', 'add_current_to_playlist',
  'get_top_tracks', 'get_top_artists',
];

/** Returns a French result string, or `undefined` when the action is not a library/playlist action. */
export async function executeSpotifyLibraryAction(action, args, request) {
  if (!SPOTIFY_LIBRARY_ACTIONS.includes(action)) return undefined;
  const confirmed = args.confirmed === true;

  if (action === 'get_album') {
    const album = await resolveAlbum(args, request);
    const data = await request(`/albums/${album.id}`);
    const tracks = data?.tracks?.items || [];
    return `${data.name} — ${names(data.artists)} (${String(data.release_date || '').slice(0, 4) || 's.d.'}), ${data.total_tracks ?? tracks.length} piste(s) :\n${tracks.slice(0, 30).map(trackLine).join('\n')}\nURI : ${data.uri}`;
  }
  if (action === 'get_saved_albums') {
    const result = await request(`/me/albums?limit=${clamp(args.limit, 1, 50, 20)}`);
    const items = result?.items || [];
    return items.length ? items.map(({ album }, index) => `${index + 1}. ${album.name} — ${names(album.artists)} (${album.uri})`).join('\n') : 'Aucun album enregistré dans votre bibliothèque.';
  }
  if (action === 'save_album' || action === 'remove_album') {
    const album = await resolveAlbum(args, request);
    if (action === 'remove_album' && !confirmed) return confirmation('retirer cet album de votre bibliothèque Spotify');
    await request(`/me/library?uris=${joinUris([album.uri])}`, { method: action === 'save_album' ? 'PUT' : 'DELETE' });
    return action === 'save_album' ? 'Album ajouté à votre bibliothèque Spotify.' : 'Album retiré de votre bibliothèque Spotify.';
  }
  if (action === 'save_tracks' || action === 'like_current' || action === 'remove_tracks') {
    let uris = action === 'like_current' ? [] : trackUris(args);
    let label = `${uris.length} titre(s)`;
    if (!uris.length) {
      const track = await currentTrack(request);
      uris = [track.uri];
      label = `« ${track.name} »`;
    }
    if (action === 'remove_tracks') {
      if (!confirmed) return confirmation(`retirer ${label} de vos titres likés`);
      await request(`/me/library?uris=${joinUris(uris)}`, { method: 'DELETE' });
      return `${label} retiré(s) de vos titres likés.`;
    }
    await request(`/me/library?uris=${joinUris(uris)}`, { method: 'PUT' });
    return `${label} ajouté(s) à vos titres likés.`;
  }
  if (action === 'check_saved') {
    let uris = (Array.isArray(args.uris) ? args.uris : args.uri ? [args.uri] : []).map((item) => parseSpotifyRef(item).uri).slice(0, 40);
    if (!uris.length) uris = [(await currentTrack(request)).uri];
    const flags = await request(`/me/library/contains?uris=${joinUris(uris)}`);
    return uris.map((uri, index) => `${uri} : ${flags?.[index] ? 'enregistré' : 'non enregistré'}`).join('\n');
  }

  if (action === 'get_top_tracks' || action === 'get_top_artists') {
    const range = ['short_term', 'medium_term', 'long_term'].includes(args.time_range) ? args.time_range : 'medium_term';
    try {
      const result = await request(`/me/top/${action === 'get_top_tracks' ? 'tracks' : 'artists'}?time_range=${range}&limit=${clamp(args.limit, 1, 50, 10)}`);
      const items = result?.items || [];
      if (!items.length) return 'Pas assez d’écoutes pour établir un classement.';
      return items.map((item, index) => (action === 'get_top_tracks' ? trackLine(item, index) : `${index + 1}. ${item.name}`)).join('\n');
    } catch (error) {
      if (/insufficient|scope|403/i.test(error.message)) throw new Error('Spotify refuse ce classement : reconnectez Spotify dans les Paramètres pour accorder l’autorisation « user-top-read ».');
      throw error;
    }
  }

  // Playlist operations
  const playlist = await resolvePlaylist(args, request);
  if (action === 'get_playlist') {
    const data = await request(`/playlists/${playlist.id}`);
    return `${data.name}${data.description ? ` — ${data.description}` : ''}\nPropriétaire : ${data.owner?.display_name || data.owner?.id || 'inconnu'} • ${data.public ? 'publique' : 'privée'} • ${data.items?.total ?? data.tracks?.total ?? '?'} piste(s)\nID : ${data.id}`;
  }
  if (action === 'get_playlist_tracks') {
    const limit = clamp(args.limit, 1, 50, 20);
    const result = await request(`/playlists/${playlist.id}/items?limit=${limit}&offset=${Math.max(0, Math.round(Number(args.offset) || 0))}`);
    const items = (result?.items || []).map((entry) => entry.item || entry.track).filter(Boolean);
    return items.length ? items.map(trackLine).join('\n') : 'Cette playlist est vide.';
  }
  if (action === 'update_playlist') {
    const body = {};
    if (args.name) body.name = String(args.name).slice(0, 100);
    if (args.description !== undefined && args.description !== null) body.description = String(args.description).slice(0, 300);
    if (typeof args.public === 'boolean') body.public = args.public;
    if (!Object.keys(body).length) throw new Error('Indiquez au moins un champ à modifier : name, description ou public.');
    await request(`/playlists/${playlist.id}`, { method: 'PUT', body });
    return `Playlist mise à jour (${Object.keys(body).join(', ')}).`;
  }
  if (action === 'add_current_to_playlist') {
    const track = await currentTrack(request);
    await request(`/playlists/${playlist.id}/items`, { method: 'POST', body: { uris: [track.uri] } });
    return `« ${track.name} » ajouté à la playlist${playlist.name ? ` « ${playlist.name} »` : ''}.`;
  }
  if (action === 'remove_tracks_from_playlist') {
    const uris = trackUris(args);
    if (!uris.length) throw new Error('Fournissez les URI des pistes à retirer.');
    if (!confirmed) return confirmation(`retirer ${uris.length} piste(s) de la playlist${playlist.name ? ` « ${playlist.name} »` : ''}`);
    await request(`/playlists/${playlist.id}/items`, { method: 'DELETE', body: { items: uris.map((uri) => ({ uri })) } });
    return `${uris.length} piste(s) retirée(s) de la playlist.`;
  }
  if (action === 'reorder_playlist') {
    const start = Math.round(Number(args.range_start));
    const before = Math.round(Number(args.insert_before));
    if (!Number.isInteger(start) || !Number.isInteger(before) || start < 0 || before < 0) throw new Error('range_start et insert_before doivent être des positions (à partir de 0).');
    const body = { range_start: start, insert_before: before, range_length: clamp(args.range_length, 1, 100, 1) };
    await request(`/playlists/${playlist.id}/items`, { method: 'PUT', body });
    return `${body.range_length} piste(s) déplacée(s) de la position ${start} vers ${before}.`;
  }
  if (action === 'delete_playlist') {
    if (!confirmed) return confirmation(`supprimer (ne plus suivre) la playlist${playlist.name ? ` « ${playlist.name} »` : ''}`);
    await request(`/playlists/${playlist.id}/followers`, { method: 'DELETE' });
    return 'Playlist retirée de votre bibliothèque (elle reste récupérable depuis Spotify pendant un temps).';
  }
  return undefined;
}
