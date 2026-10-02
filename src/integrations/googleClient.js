// Google Workspace OAuth 2.0 (installed app, PKCE) for Jarvis PC.
// The user creates a "Desktop app" OAuth client in their own Google Cloud project; the client secret
// and the tokens are kept only in the Electron-encrypted secret store, never in the configuration.

import { hostBridge } from '../core/hostBridge.js';

export const GOOGLE_REDIRECT_URI = 'http://127.0.0.1:43822/google/callback';
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
];

const CLIENT_ID_SLOT = 'googleClientId';
const CLIENT_SECRET_SLOT = 'googleClientSecret';
const TOKEN_SLOT = 'googleTokens';
const PENDING_SLOT = 'googlePkcePending';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

const randomHex = (byteCount) => {
  const bytes = new Uint8Array(byteCount);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

async function createCodeChallenge(verifier) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  let binary = '';
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
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
    throw new Error(`Google OAuth : ${description}`);
  }
  return response.json;
}

export async function saveGoogleCredentials({ clientId, clientSecret }) {
  await hostBridge.storageSet(CLIENT_ID_SLOT, String(clientId || '').trim());
  if (clientSecret && String(clientSecret).trim()) await hostBridge.setSecret(CLIENT_SECRET_SLOT, String(clientSecret).trim());
}

export async function getGoogleStatus() {
  const [clientId, secret, tokens] = await Promise.all([
    hostBridge.storageGet(CLIENT_ID_SLOT, ''),
    hostBridge.getSecret(CLIENT_SECRET_SLOT, ''),
    hostBridge.getSecret(TOKEN_SLOT, null),
  ]);
  return {
    clientId: String(clientId || ''),
    hasSecret: Boolean(secret),
    connected: Boolean(tokens?.refreshToken && tokens?.clientId === clientId),
  };
}

export async function connectGoogle({ clientId: clientIdInput, clientSecret: secretInput } = {}) {
  if (!hostBridge.isElectron) throw new Error('La connexion Google sécurisée est disponible dans l’application Jarvis PC installée.');
  await saveGoogleCredentials({ clientId: clientIdInput, clientSecret: secretInput });
  const clientId = String(await hostBridge.storageGet(CLIENT_ID_SLOT, '')).trim();
  const clientSecret = String(await hostBridge.getSecret(CLIENT_SECRET_SLOT, '')).trim();
  if (!clientId || !clientSecret) throw new Error('Saisissez le Client ID et le Client Secret de votre client OAuth Google (type « Application de bureau »).');

  const verifier = randomHex(48);
  const state = randomHex(24);
  await hostBridge.setSecret(PENDING_SLOT, { clientId, verifier, state });
  let callback;
  try {
    callback = await hostBridge.googleAuthorize({ clientId, codeChallenge: await createCodeChallenge(verifier), state, scopes: GOOGLE_SCOPES });
  } catch (error) {
    await hostBridge.setSecret(PENDING_SLOT, null);
    throw error;
  }
  const pending = await hostBridge.getSecret(PENDING_SLOT, null);
  await hostBridge.setSecret(PENDING_SLOT, null);
  if (!callback?.ok || !callback.code) throw new Error(callback?.error || 'Authentification Google annulée ou expirée.');
  if (!pending || pending.state !== callback.state || pending.clientId !== clientId) throw new Error('État OAuth invalide : la connexion Google a été rejetée.');

  const token = await postTokenForm({
    grant_type: 'authorization_code',
    code: callback.code,
    redirect_uri: GOOGLE_REDIRECT_URI,
    client_id: clientId,
    client_secret: clientSecret,
    code_verifier: pending.verifier,
  });
  if (!token.refresh_token) throw new Error('Google n’a pas renvoyé de jeton de renouvellement : révoquez l’accès de Jarvis dans votre compte Google puis réessayez.');
  await hostBridge.setSecret(TOKEN_SLOT, {
    clientId,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + (token.expires_in || 3600) * 1000,
    scope: token.scope || GOOGLE_SCOPES.join(' '),
  });
  return { connected: true, scope: token.scope || '' };
}

export async function disconnectGoogle() {
  const tokens = await hostBridge.getSecret(TOKEN_SLOT, null);
  if (tokens?.refreshToken) {
    // Best effort: revoke the grant at Google, then forget it locally whatever the outcome.
    await hostBridge.httpFetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: tokens.refreshToken }).toString(),
      timeoutMs: 10000,
    }).catch(() => {});
  }
  await Promise.all([hostBridge.setSecret(TOKEN_SLOT, null), hostBridge.setSecret(PENDING_SLOT, null)]);
}

export async function clearGoogleCredentials() {
  await disconnectGoogle();
  await Promise.all([hostBridge.storageSet(CLIENT_ID_SLOT, ''), hostBridge.setSecret(CLIENT_SECRET_SLOT, null)]);
}

async function getAccessToken(forceRefresh = false) {
  const [clientId, clientSecret, tokens] = await Promise.all([
    hostBridge.storageGet(CLIENT_ID_SLOT, ''),
    hostBridge.getSecret(CLIENT_SECRET_SLOT, ''),
    hostBridge.getSecret(TOKEN_SLOT, null),
  ]);
  if (!clientId || !clientSecret || !tokens?.refreshToken || tokens.clientId !== clientId) {
    throw new Error('Google Workspace n’est pas connecté. Renseignez le client OAuth puis connectez-vous dans Paramètres > Système PC & Domotique.');
  }
  if (!forceRefresh && tokens.accessToken && tokens.expiresAt > Date.now() + 60000) return tokens.accessToken;
  const refreshed = await postTokenForm({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken, client_id: clientId, client_secret: clientSecret });
  await hostBridge.setSecret(TOKEN_SLOT, {
    ...tokens,
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token || tokens.refreshToken,
    expiresAt: Date.now() + (refreshed.expires_in || 3600) * 1000,
  });
  return refreshed.access_token;
}

const API_HOSTS = /^https:\/\/(gmail\.googleapis\.com|www\.googleapis\.com)\//;

/** Authenticated Google API call; refreshes the token once on 401. Only Google API hosts are allowed. */
export async function googleRequest(url, { method = 'GET', body = null, headers = {}, raw = false, retry = true } = {}) {
  if (!API_HOSTS.test(url)) throw new Error('Hôte Google non autorisé.');
  const token = await getAccessToken();
  const response = await hostBridge.httpFetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body && typeof body === 'object' && !headers['Content-Type'] ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === null ? null : typeof body === 'string' ? body : JSON.stringify(body),
    timeoutMs: 25000,
  });
  if (response.status === 401 && retry) {
    await getAccessToken(true);
    return googleRequest(url, { method, body, headers, raw, retry: false });
  }
  if (!response.ok) {
    const details = response.json?.error?.message || response.json?.error_description || `HTTP ${response.status || 0}`;
    if (response.status === 403 && /insufficient|scope/i.test(details)) {
      throw new Error('Google : autorisation insuffisante. Reconnectez Google Workspace pour accorder les accès demandés.');
    }
    if (response.status === 403 && /has not been used|disabled/i.test(details)) {
      throw new Error('Google : activez l’API correspondante (Gmail, Calendar ou Drive) dans votre projet Google Cloud.');
    }
    throw new Error(`Google : ${details}`);
  }
  return raw ? response.text : response.json;
}
