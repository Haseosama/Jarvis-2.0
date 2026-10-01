import { hostBridge } from '../core/hostBridge.js';
import { executeSpotifyLibraryAction, resolvePlaylist } from './spotifyLibrary.js';

export const SPOTIFY_REDIRECT_URI = 'http://127.0.0.1:43821/spotify/callback';
const CLIENT_ID_SLOT = 'spotifyClientId';
const TOKEN_SLOT = 'spotifyTokens';
const PENDING_SLOT = 'spotifyPkcePending';
const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const API_ROOT = 'https://api.spotify.com/v1';
const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-read-recently-played',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'playlist-modify-public',
  'user-library-read',
  'user-library-modify',
  'user-top-read',
];

function randomHex(byteCount) {
  const bytes = new Uint8Array(byteCount);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function createCodeChallenge(verifier) {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto indisponible pour l’authentification Spotify.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

async function postTokenForm(fields) {
  const response = await hostBridge.httpFetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
    timeoutMs: 20000,
  });
  if (!response.ok || !response.json?.access_token) {
    const description = response.json?.error_description || response.json?.error || `HTTP ${response.status || 0}`;
    throw new Error(`Spotify OAuth : ${description}`);
  }
  return response.json;
}

export async function saveSpotifyClientId(clientId) {
  const cleaned = String(clientId || '').trim();
  await hostBridge.storageSet(CLIENT_ID_SLOT, cleaned);
  return cleaned;
}

export async function getSpotifyStatus() {
  const [clientId, tokens] = await Promise.all([
    hostBridge.storageGet(CLIENT_ID_SLOT, ''),
    hostBridge.getSecret(TOKEN_SLOT, null),
  ]);
  return {
    clientId: String(clientId || ''),
    connected: Boolean(tokens?.refreshToken && tokens?.clientId === clientId),
    expiresAt: tokens?.expiresAt || null,
  };
}

export async function connectSpotify(clientIdInput) {
  if (!hostBridge.isElectron) {
    throw new Error('La connexion Spotify sécurisée est disponible dans l’application Jarvis PC installée.');
  }
  const clientId = await saveSpotifyClientId(clientIdInput);
  if (!clientId) throw new Error('Saisissez le Client ID de votre application Spotify.');

  const verifier = randomHex(48);
  const state = randomHex(24);
  const codeChallenge = await createCodeChallenge(verifier);
  await hostBridge.setSecret(PENDING_SLOT, { clientId, verifier, state });

  let callback;
  try {
    callback = await hostBridge.spotifyAuthorize({
      clientId,
      codeChallenge,
      state,
      scope: SCOPES.join(' '),
    });
  } catch (error) {
    await hostBridge.setSecret(PENDING_SLOT, null);
    throw error;
  }

  const pending = await hostBridge.getSecret(PENDING_SLOT, null);
  await hostBridge.setSecret(PENDING_SLOT, null);
  if (!callback?.ok || !callback.code) {
    throw new Error(callback?.error || 'Authentification Spotify annulée ou expirée.');
  }
  if (!pending || pending.state !== callback.state || pending.clientId !== clientId) {
    throw new Error('État OAuth invalide : la connexion Spotify a été rejetée.');
  }

  const tokenResponse = await postTokenForm({
    grant_type: 'authorization_code',
    code: callback.code,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    client_id: clientId,
    code_verifier: pending.verifier,
  });
  await hostBridge.setSecret(TOKEN_SLOT, {
    clientId,
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    expiresAt: Date.now() + (tokenResponse.expires_in || 3600) * 1000,
    scope: tokenResponse.scope || SCOPES.join(' '),
  });
  return { connected: true };
}

export async function disconnectSpotify() {
  await Promise.all([
    hostBridge.setSecret(TOKEN_SLOT, null),
    hostBridge.setSecret(PENDING_SLOT, null),
  ]);
}

async function getAccessToken(forceRefresh = false) {
  const [clientId, tokens] = await Promise.all([
    hostBridge.storageGet(CLIENT_ID_SLOT, ''),
    hostBridge.getSecret(TOKEN_SLOT, null),
  ]);
  if (!clientId || !tokens?.refreshToken || tokens.clientId !== clientId) {
    throw new Error('Spotify n’est pas connecté. Configurez le Client ID puis connectez Spotify dans Paramètres > PC.');
  }
  if (!forceRefresh && tokens.accessToken && tokens.expiresAt > Date.now() + 60000) return tokens.accessToken;

  const refreshed = await postTokenForm({
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
    client_id: clientId,
  });
  await hostBridge.setSecret(TOKEN_SLOT, {
    ...tokens,
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token || tokens.refreshToken,
    expiresAt: Date.now() + (refreshed.expires_in || 3600) * 1000,
    scope: refreshed.scope || tokens.scope,
  });
  return refreshed.access_token;
}

async function spotifyRequest(path, { method = 'GET', body = null, retry = true } = {}) {
  const token = await getAccessToken();
  const response = await hostBridge.httpFetch(`${API_ROOT}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : null,
    timeoutMs: 20000,
  });
  if (response.status === 401 && retry) {
    await getAccessToken(true);
    return spotifyRequest(path, { method, body, retry: false });
  }
  if (!response.ok) {
    const details = response.json?.error?.message || response.json?.error_description || `HTTP ${response.status || 0}`;
    throw new Error(`Spotify : ${details}`);
  }
  return response.json;
}

export function formatSpotifyTrack(track) {
  if (!track) return 'Aucune piste en cours.';
  const artists = (track.artists || []).map((artist) => artist.name).filter(Boolean).join(', ');
  return `${track.name || 'Piste inconnue'}${artists ? ` — ${artists}` : ''}`;
}

function formatTrackList(items = []) {
  return items.map((item, index) => `${index + 1}. ${formatSpotifyTrack(item.track || item)}`).join('\n');
}

export async function executeSpotifyAction(args = {}) {
  const action = String(args.action || 'search_play').toLowerCase().trim();
  const query = String(args.query || '').trim();
  const deviceId = args.device_id ? `?device_id=${encodeURIComponent(args.device_id)}` : '';
  const request = spotifyRequest;

  if (action === 'auth' || action === 'login' || action === 'connect') {
    return 'Ouvrez Paramètres > PC, saisissez le Client ID de votre application Spotify et choisissez « Connecter Spotify ».';
  }
  if (action === 'open_spotify' || action === 'open') {
    await hostBridge.openApp('spotify');
    return 'Spotify est ouvert.';
  }

  if (action === 'search' || action === 'search_play' || action === 'play_song' || action === 'play_music') {
    if (!query) throw new Error('Indiquez le titre, l’artiste ou la playlist à rechercher.');
    const type = ['track', 'album', 'artist', 'playlist'].includes(String(args.type || '').toLowerCase())
      ? String(args.type).toLowerCase()
      : 'track';
    const limit = Math.min(10, Math.max(1, Number(args.limit) || 5));
    const results = await request(`/search?q=${encodeURIComponent(query)}&type=${type}&limit=${limit}`);
    const items = results?.[`${type}s`]?.items || [];
    if (!items.length) return `Aucun résultat Spotify pour « ${query} ».`;
    if (action === 'search') {
      return items.map((item, index) => {
        const artists = (item.artists || []).map((artist) => artist.name).join(', ');
        return `${index + 1}. ${item.name}${artists ? ` — ${artists}` : ''}${item.uri ? ` (${item.uri})` : ''}`;
      }).join('\n');
    }
    const chosen = items[0];
    if (type === 'track') {
      await request(`/me/player/play${deviceId}`, { method: 'PUT', body: { uris: [chosen.uri] } });
    } else {
      await request(`/me/player/play${deviceId}`, { method: 'PUT', body: { context_uri: chosen.uri } });
    }
    return `Lecture de « ${chosen.name} » sur Spotify.`;
  }

  if (action === 'get_now_playing' || action === 'now_playing' || action === 'current') {
    const playing = await request('/me/player/currently-playing');
    if (!playing?.item) return 'Aucune piste Spotify n’est en cours de lecture.';
    const device = playing.device?.name ? ` • appareil : ${playing.device.name}` : '';
    return `${playing.is_playing ? 'En lecture' : 'En pause'} : ${formatSpotifyTrack(playing.item)}${device}`;
  }
  if (action === 'get_devices' || action === 'devices') {
    const result = await request('/me/player/devices');
    const devices = result?.devices || [];
    return devices.length
      ? devices.map((device) => `${device.is_active ? '●' : '○'} ${device.name} (${device.type})${device.volume_percent === null ? '' : ` — volume ${device.volume_percent}%`} — ID ${device.id}`).join('\n')
      : 'Aucun appareil Spotify Connect disponible. Ouvrez Spotify sur un appareil puis réessayez.';
  }
  if (action === 'get_playlists' || action === 'playlists') {
    const result = await request('/me/playlists?limit=20');
    const items = result?.items || [];
    return items.length ? items.map((playlist, index) => `${index + 1}. ${playlist.name} (${playlist.tracks?.total ?? 0} pistes) — ${playlist.id}`).join('\n') : 'Aucune playlist Spotify trouvée.';
  }
  if (action === 'get_queue' || action === 'queue') {
    const result = await request('/me/player/queue');
    return `En cours : ${formatSpotifyTrack(result?.currently_playing)}\nÀ suivre :\n${formatTrackList(result?.queue?.slice(0, 10) || [])}`;
  }
  if (action === 'get_recently_played' || action === 'recent') {
    const result = await request(`/me/player/recently-played?limit=${Math.min(50, Math.max(1, Number(args.limit) || 10))}`);
    return result?.items?.length ? formatTrackList(result.items) : 'Aucune écoute récente disponible.';
  }
  if (action === 'get_liked_songs' || action === 'liked') {
    const result = await request(`/me/tracks?limit=${Math.min(50, Math.max(1, Number(args.limit) || 20))}`);
    return result?.items?.length ? formatTrackList(result.items) : 'Aucune piste enregistrée dans vos titres likés.';
  }
  if (action === 'pause' || action === 'stop') {
    await request(`/me/player/pause${deviceId}`, { method: 'PUT' });
    return 'Lecture Spotify mise en pause.';
  }
  if (action === 'resume' || action === 'play' || action === 'toggle') {
    await request(`/me/player/play${deviceId}`, { method: 'PUT' });
    return 'Lecture Spotify reprise.';
  }
  if (action === 'next' || action === 'skip') {
    await request(`/me/player/next${deviceId}`, { method: 'POST' });
    return 'Piste Spotify suivante.';
  }
  if (action === 'previous' || action === 'prev') {
    await request(`/me/player/previous${deviceId}`, { method: 'POST' });
    return 'Piste Spotify précédente.';
  }
  if (action === 'set_volume' || action === 'volume') {
    const volume = Math.max(0, Math.min(100, Math.round(Number(args.volume ?? args.volume_percent))));
    if (!Number.isFinite(volume)) throw new Error('Le volume doit être un pourcentage de 0 à 100.');
    await request(`/me/player/volume?volume_percent=${volume}${args.device_id ? `&device_id=${encodeURIComponent(args.device_id)}` : ''}`, { method: 'PUT' });
    return `Volume Spotify réglé à ${volume}%.`;
  }
  if (action === 'volume_up' || action === 'volume_down') {
    const playing = await request('/me/player');
    if (!playing?.device || playing.device.volume_percent === null) throw new Error('Le volume de cet appareil Spotify n’est pas réglable via l’API.');
    const delta = action === 'volume_up' ? 10 : -10;
    const volume = Math.max(0, Math.min(100, playing.device.volume_percent + delta));
    await request(`/me/player/volume?volume_percent=${volume}${args.device_id ? `&device_id=${encodeURIComponent(args.device_id)}` : ''}`, { method: 'PUT' });
    return `Volume Spotify réglé à ${volume}%.`;
  }
  if (action === 'add_to_queue' || action === 'enqueue') {
    const uri = String(args.uri || '').trim();
    if (!/^spotify:(track|episode):[A-Za-z0-9]{10,64}$/.test(uri)) throw new Error('Fournissez un URI Spotify de piste ou d’épisode valide.');
    await request(`/me/player/queue?uri=${encodeURIComponent(uri)}${args.device_id ? `&device_id=${encodeURIComponent(args.device_id)}` : ''}`, { method: 'POST' });
    return 'Élément ajouté à la file Spotify.';
  }
  if (action === 'create_playlist') {
    const name = String(args.name || '').trim().slice(0, 100);
    if (!name) throw new Error('Donnez un nom à la playlist.');
    const playlist = await request('/me/playlists', { method: 'POST', body: { name, description: String(args.description || '').slice(0, 300), public: Boolean(args.public) } });
    return `Playlist « ${playlist.name} » créée : ${playlist.external_urls?.spotify || playlist.id}`;
  }
  if (action === 'add_tracks_to_playlist') {
    const playlistId = (await resolvePlaylist(args, request)).id;
    const uris = (Array.isArray(args.uris) ? args.uris : []).map(String).filter((uri) => /^spotify:track:[A-Za-z0-9]{10,64}$/.test(uri)).slice(0, 100);
    if (!uris.length) throw new Error('Fournissez au moins un URI Spotify de piste valide.');
    await request(`/playlists/${playlistId}/items`, { method: 'POST', body: { uris } });
    return `${uris.length} piste(s) ajoutée(s) à la playlist.`;
  }
  const libraryResult = await executeSpotifyLibraryAction(action, args, request);
  if (libraryResult !== undefined) return libraryResult;
  throw new Error(`Action Spotify inconnue : ${action}`);
}
