// Tuya Cloud (OpenAPI) client for Jarvis PC.
// Signature scheme: https://developer.tuya.com/en/docs/iot/new-singnature?id=Kbw0q34cs2e5g
// The Access Secret is stored only through hostBridge.setSecret (encrypted by Electron);
// it is never kept in the persisted configuration.

import { hostBridge } from '../core/hostBridge.js';
import { matchByName } from './nameMatch.js';

export const TUYA_REGIONS = {
  eu: { label: 'Europe centrale (openapi.tuyaeu.com)', url: 'https://openapi.tuyaeu.com' },
  weaz: { label: 'Europe de l’Ouest (openapi-weaz.tuyaeu.com)', url: 'https://openapi-weaz.tuyaeu.com' },
  us: { label: 'Amérique de l’Ouest (openapi.tuyaus.com)', url: 'https://openapi.tuyaus.com' },
  in: { label: 'Inde (openapi.tuyain.com)', url: 'https://openapi.tuyain.com' },
  cn: { label: 'Chine (openapi.tuyacn.com)', url: 'https://openapi.tuyacn.com' },
};

const ACCESS_ID_SLOT = 'tuya_access_id';
const REGION_SLOT = 'tuya_region';
const SECRET_SLOT = 'tuya_access_secret';

const EMPTY_BODY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const encoder = new TextEncoder();
const toHex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(text) {
  return toHex(await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

export async function hmacSha256Hex(message, secret) {
  const key = await globalThis.crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await globalThis.crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

/** Path + query parameters sorted by key, as required by the Tuya signature. */
export function canonicalUrl(path, query = {}) {
  const keys = Object.keys(query || {}).filter((key) => query[key] !== undefined && query[key] !== null && query[key] !== '').sort();
  if (!keys.length) return path;
  return `${path}?${keys.map((key) => `${key}=${query[key]}`).join('&')}`;
}

/**
 * Computes the signature for a token request (no accessToken) or a business request.
 * `signatureHeaders` is an optional ordered object of custom headers included in the signature.
 */
export async function signTuyaRequest({ clientId, secret, accessToken = '', t, nonce = '', method = 'GET', path, query = {}, body = '', signatureHeaders = {} }) {
  const bodyHash = body ? await sha256Hex(body) : EMPTY_BODY_SHA256;
  const headerLines = Object.entries(signatureHeaders).map(([key, value]) => `${key}:${value}\n`).join('');
  const stringToSign = `${String(method).toUpperCase()}\n${bodyHash}\n${headerLines}\n${canonicalUrl(path, query)}`;
  const str = `${clientId}${accessToken}${t}${nonce}${stringToSign}`;
  return { stringToSign, sign: (await hmacSha256Hex(str, secret)).toUpperCase() };
}

// Tuya product category codes → friendly type. `sensitive` devices need explicit confirmation.
const CATEGORY_TYPES = {
  kg: 'switch', tdq: 'switch', cz: 'plug', pc: 'plug',
  dj: 'light', dd: 'light', xdd: 'light', fwd: 'light', dc: 'light', tgq: 'light', tgkg: 'light',
  fs: 'fan', fsd: 'fan', kt: 'climatiseur', qn: 'chauffage', wk: 'thermostat',
  cl: 'volet', clkg: 'volet', ckmkzq: 'porte de garage', ms: 'serrure', jtmspro: 'serrure', mc: 'serrure',
  sp: 'caméra', wsdcg: 'capteur', mcs: 'capteur', pir: 'capteur',
};
const SENSITIVE_TYPES = new Set(['volet', 'porte de garage', 'serrure']);

export function describeTuyaDevice(raw = {}) {
  const type = CATEGORY_TYPES[raw.category] || 'appareil';
  return {
    id: String(raw.id || ''),
    name: String(raw.name || raw.product_name || raw.id || 'Appareil Tuya'),
    category: String(raw.category || ''),
    type,
    online: raw.online !== false,
    sensitive: SENSITIVE_TYPES.has(type),
  };
}

export function findTuyaDevice(devices, query) {
  if (!String(query || '').trim()) return { device: null, matches: [] };
  const exactId = devices.find((device) => device.id === String(query).trim());
  if (exactId) return { device: exactId, matches: [exactId] };
  const matches = matchByName(devices, query);
  return { device: matches.length === 1 ? matches[0] : null, matches };
}

const SWITCH_CODE = /^(switch_led|switch(_\d+)?|led_switch|switch_1)$/;

function parseRange(values) {
  try {
    const parsed = typeof values === 'string' ? JSON.parse(values) : values;
    const min = Number(parsed?.min);
    const max = Number(parsed?.max);
    if (Number.isFinite(min) && Number.isFinite(max) && max > min) return { min, max };
  } catch {
    // fall through to null
  }
  return null;
}

const BRIGHTNESS_FALLBACK = { bright_value_v2: { min: 10, max: 1000 }, bright_value: { min: 25, max: 255 } };

/** Turns a high-level action into Tuya command objects, given the device function list. */
export function buildTuyaCommands(action, payload = {}, functions = []) {
  const byCode = new Map(functions.map((fn) => [fn.code, fn]));
  const codes = functions.length ? [...byCode.keys()] : [];
  if (action === 'turn_on' || action === 'turn_off') {
    const switches = codes.filter((code) => SWITCH_CODE.test(code));
    if (!switches.length) throw new Error('Cet appareil n’expose pas de commande marche/arrêt.');
    return switches.map((code) => ({ code, value: action === 'turn_on' }));
  }
  if (action === 'set_brightness') {
    const percent = Math.max(1, Math.min(100, Math.round(Number(payload.brightness))));
    if (!Number.isFinite(percent)) throw new Error('Luminosité invalide (1 à 100).');
    const code = ['bright_value_v2', 'bright_value'].find((candidate) => byCode.has(candidate));
    if (!code) throw new Error('Cet appareil ne gère pas la luminosité.');
    const range = parseRange(byCode.get(code)?.values) || BRIGHTNESS_FALLBACK[code];
    return [{ code, value: Math.round(range.min + ((range.max - range.min) * percent) / 100) }];
  }
  throw new Error(`Action Tuya non prise en charge : ${action}`);
}

const ERROR_HINTS = {
  1004: 'signature refusée — vérifiez l’Access ID, l’Access Secret et la région du centre de données.',
  1010: 'jeton expiré.',
  1106: 'accès refusé — l’appareil n’est pas lié à ce projet Tuya Cloud.',
};

export class TuyaClient {
  constructor({ accessId, secret, region = 'eu', http = (request) => hostBridge.httpFetch(request), now = () => Date.now(), nonce = () => globalThis.crypto.randomUUID().replace(/-/g, '') } = {}) {
    this.accessId = String(accessId || '').trim();
    this.secret = String(secret || '').trim();
    this.baseUrl = (TUYA_REGIONS[region] || TUYA_REGIONS.eu).url;
    this.http = http;
    this.now = now;
    this.nonce = nonce;
    this.token = null;
    this.functionsCache = new Map();
  }

  async request(method, path, { query = {}, body = null, tokenRequest = false } = {}) {
    if (!this.accessId || !this.secret) throw new Error('Tuya n’est pas configuré (Access ID et Access Secret requis dans Paramètres > PC).');
    const t = String(this.now());
    const nonce = this.nonce();
    const bodyText = body ? JSON.stringify(body) : '';
    const accessToken = tokenRequest ? '' : await this.getAccessToken();
    const { sign } = await signTuyaRequest({ clientId: this.accessId, secret: this.secret, accessToken, t, nonce, method, path, query, body: bodyText });
    const headers = { client_id: this.accessId, sign, t, sign_method: 'HMAC-SHA256', nonce, lang: 'fr' };
    if (accessToken) headers.access_token = accessToken;
    if (bodyText) headers['Content-Type'] = 'application/json';
    const res = await this.http({ url: `${this.baseUrl}${canonicalUrl(path, query)}`, method, headers, body: bodyText || null, timeoutMs: 15000 });
    const json = res?.json;
    if (!json || typeof json !== 'object') throw new Error(`Réponse Tuya illisible (HTTP ${res?.status || 0}).`);
    if (json.success === false) {
      if (json.code === 1010 && !tokenRequest && !this._retried) {
        this.token = null;
        this._retried = true;
        try { return await this.request(method, path, { query, body, tokenRequest }); } finally { this._retried = false; }
      }
      const hint = ERROR_HINTS[json.code];
      throw new Error(`Tuya : ${hint || json.msg || 'erreur inconnue'} (code ${json.code})`);
    }
    return json.result;
  }

  async getAccessToken() {
    if (this.token && this.token.expiresAt > this.now() + 60000) return this.token.value;
    const result = await this.request('GET', '/v1.0/token', { query: { grant_type: 1 }, tokenRequest: true });
    if (!result?.access_token) throw new Error('Tuya n’a pas renvoyé de jeton d’accès.');
    this.token = { value: result.access_token, expiresAt: this.now() + Number(result.expire_time || 7200) * 1000 };
    return this.token.value;
  }

  async listDevices() {
    const devices = [];
    let lastRowKey = '';
    for (let page = 0; page < 4; page++) {
      const result = await this.request('GET', '/v1.0/iot-01/associated-users/devices', { query: { size: 50, last_row_key: lastRowKey } });
      devices.push(...(result?.devices || []));
      if (!result?.has_more || !result?.last_row_key) break;
      lastRowKey = result.last_row_key;
    }
    return devices.map(describeTuyaDevice);
  }

  async getStatus(deviceId) {
    return (await this.request('GET', `/v1.0/devices/${encodeURIComponent(deviceId)}/status`)) || [];
  }

  async getFunctions(deviceId) {
    if (this.functionsCache.has(deviceId)) return this.functionsCache.get(deviceId);
    const result = await this.request('GET', `/v1.0/devices/${encodeURIComponent(deviceId)}/functions`);
    const functions = result?.functions || [];
    this.functionsCache.set(deviceId, functions);
    return functions;
  }

  async sendCommands(deviceId, commands) {
    const result = await this.request('POST', `/v1.0/devices/${encodeURIComponent(deviceId)}/commands`, { body: { commands } });
    if (result === false) throw new Error('Tuya a refusé la commande.');
    return result;
  }
}

export async function saveTuyaSettings({ accessId, secret, region }) {
  await hostBridge.storageSet(ACCESS_ID_SLOT, String(accessId || '').trim());
  await hostBridge.storageSet(REGION_SLOT, TUYA_REGIONS[region] ? region : 'eu');
  if (secret !== undefined && secret !== null && String(secret).trim()) {
    await hostBridge.setSecret(SECRET_SLOT, String(secret).trim());
  }
}

export async function getTuyaStatus() {
  const [accessId, region, secret] = await Promise.all([
    hostBridge.storageGet(ACCESS_ID_SLOT, ''),
    hostBridge.storageGet(REGION_SLOT, 'eu'),
    hostBridge.getSecret(SECRET_SLOT, ''),
  ]);
  return { accessId: String(accessId || ''), region: TUYA_REGIONS[region] ? region : 'eu', hasSecret: Boolean(secret) };
}

export async function clearTuyaSettings() {
  await Promise.all([hostBridge.storageSet(ACCESS_ID_SLOT, ''), hostBridge.setSecret(SECRET_SLOT, null)]);
}

let sharedClient = null;
let sharedKey = '';

export async function getTuyaClient() {
  const [accessId, region, secret] = await Promise.all([
    hostBridge.storageGet(ACCESS_ID_SLOT, ''),
    hostBridge.storageGet(REGION_SLOT, 'eu'),
    hostBridge.getSecret(SECRET_SLOT, ''),
  ]);
  const key = `${accessId}|${region}|${secret}`;
  if (!sharedClient || sharedKey !== key) {
    sharedClient = new TuyaClient({ accessId, secret, region });
    sharedKey = key;
  }
  return sharedClient;
}
