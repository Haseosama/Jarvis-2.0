// Unified smart-home controller (Home Assistant + Tuya Cloud) behind the `smart_home` tool.
// Dependencies are injected so the logic can be tested without Electron or the network.

import { buildTuyaCommands, findTuyaDevice } from './tuyaClient.js';
import { matchByName, normalizeName as normalize } from './nameMatch.js';

const SWITCH_STATUS = /^(switch_led|switch(_\d+)?|led_switch)$/;
const HA_LISTED_DOMAINS = ['light', 'switch', 'fan', 'cover', 'climate', 'lock', 'media_player', 'input_boolean', 'scene', 'sensor', 'binary_sensor'];
const HA_CONTROL_DOMAINS = ['light', 'switch', 'fan', 'cover', 'climate', 'lock', 'media_player', 'input_boolean', 'scene'];
const HA_CONFIRM_DOMAINS = new Set(['cover', 'lock']);

const ACTIONS = ['list', 'status', 'turn_on', 'turn_off', 'toggle', 'set_brightness'];

function haServiceFor(domain, action) {
  if (domain === 'lock') return action === 'turn_off' ? 'unlock' : 'lock';
  if (domain === 'cover') return action === 'turn_off' ? 'close_cover' : action === 'toggle' ? 'toggle' : 'open_cover';
  if (domain === 'scene') return 'turn_on';
  return action === 'turn_off' ? 'turn_off' : action === 'toggle' ? 'toggle' : 'turn_on';
}

function confirmationMessage(label, verb) {
  return `Action sensible : ${verb} « ${label} » peut avoir des conséquences physiques. Demandez confirmation à l’utilisateur, puis relancez la commande avec confirmed=true.`;
}

async function haRequest(cfg, http, path, options = {}) {
  const base = String(cfg.haUrl || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) throw new Error('L’URL Home Assistant doit commencer par http:// ou https://.');
  const res = await http({
    url: `${base}${path}`,
    method: options.method || 'GET',
    headers: { Authorization: `Bearer ${cfg.haToken}`, 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : null,
  });
  if (res.status === 401) throw new Error('Home Assistant a refusé le jeton (401) : vérifiez le jeton d’accès longue durée.');
  if (!res.ok) throw new Error(`Home Assistant a répondu HTTP ${res.status}.`);
  return res.json;
}

async function haEntities(cfg, http) {
  const states = await haRequest(cfg, http, '/api/states');
  if (!Array.isArray(states)) throw new Error('Réponse Home Assistant inattendue.');
  return states.map((state) => ({
    entity_id: state.entity_id,
    domain: String(state.entity_id || '').split('.')[0],
    name: state.attributes?.friendly_name || state.entity_id,
    state: state.state,
  }));
}

async function runHomeAssistant(args, { cfg, http }) {
  if (!cfg.haUrl || !cfg.haToken) {
    return 'Home Assistant n’est pas encore configuré. Ajoutez son URL et son jeton dans les Réglages > Système PC & Domotique.';
  }
  const action = args.action;
  if (action === 'list') {
    const wantedDomain = normalize(args.domain);
    const entities = (await haEntities(cfg, http)).filter((entity) => (wantedDomain ? entity.domain === wantedDomain : HA_LISTED_DOMAINS.includes(entity.domain) && !['sensor', 'binary_sensor'].includes(entity.domain)));
    if (!entities.length) return 'Aucune entité Home Assistant correspondante.';
    const shown = entities.slice(0, 40).map((entity) => `• ${entity.name} (${entity.entity_id}) : ${entity.state}`);
    return `Home Assistant — ${entities.length} entité(s)${entities.length > 40 ? ' (40 affichées)' : ''} :\n${shown.join('\n')}`;
  }

  let entityId = String(args.entity_id || args.device || '').trim();
  if (!entityId) return 'Précisez l’appareil à contrôler (nom ou entity_id). Utilisez action=list pour voir les appareils disponibles.';
  let label = entityId;
  if (!/^[a-z_]+\.[a-z0-9_]+$/i.test(entityId)) {
    const candidates = (await haEntities(cfg, http)).filter((entity) => HA_CONTROL_DOMAINS.includes(entity.domain) || action === 'status');
    const matches = matchByName(candidates, entityId);
    if (matches.length !== 1) {
      return matches.length
        ? `Plusieurs appareils correspondent à « ${entityId} » : ${matches.slice(0, 8).map((entity) => `${entity.name} (${entity.entity_id})`).join(', ')}. Précisez lequel.`
        : `Aucun appareil Home Assistant ne correspond à « ${entityId} ».`;
    }
    entityId = matches[0].entity_id;
    label = matches[0].name;
  }
  const domain = entityId.split('.')[0].toLowerCase();

  if (action === 'status') {
    const state = await haRequest(cfg, http, `/api/states/${encodeURIComponent(entityId)}`);
    const brightness = state?.attributes?.brightness != null ? `, luminosité ${Math.round((state.attributes.brightness / 255) * 100)} %` : '';
    return `${state?.attributes?.friendly_name || entityId} : ${state?.state ?? 'inconnu'}${brightness}.`;
  }
  if (domain === 'alarm_control_panel') {
    return 'Jarvis n’arme ni ne désarme une alarme par commande : utilisez Home Assistant directement.';
  }
  if (!HA_CONTROL_DOMAINS.includes(domain)) return `Le type d’entité « ${domain} » n’est pas contrôlable par Jarvis.`;
  if (HA_CONFIRM_DOMAINS.has(domain) && args.confirmed !== true) {
    return confirmationMessage(label, action === 'turn_off' ? (domain === 'lock' ? 'déverrouiller' : 'fermer') : domain === 'lock' ? 'verrouiller' : 'ouvrir');
  }

  let service;
  const data = { entity_id: entityId };
  if (action === 'set_brightness') {
    if (domain !== 'light') return 'La luminosité ne s’applique qu’aux lumières.';
    const percent = Math.round(Number(args.brightness));
    if (!Number.isFinite(percent) || percent < 1 || percent > 100) return 'Luminosité invalide : indiquez un pourcentage entre 1 et 100.';
    service = 'turn_on';
    data.brightness_pct = percent;
  } else {
    service = haServiceFor(domain, action);
  }
  await haRequest(cfg, http, `/api/services/${domain}/${service}`, { method: 'POST', body: data });
  return action === 'set_brightness' ? `Luminosité de « ${label} » réglée à ${data.brightness_pct} %.` : `Action ${service} exécutée sur « ${label} ».`;
}

async function runTuya(args, { getTuya }) {
  const client = await getTuya();
  const devices = await client.listDevices();
  if (args.action === 'list') {
    if (!devices.length) return 'Aucun appareil Tuya lié à ce projet. Dans la plateforme Tuya IoT, liez votre compte Smart Life (Devices > Link App Account).';
    return `Tuya — ${devices.length} appareil(s) :\n${devices.map((device) => `• ${device.name} [${device.type}${device.online ? '' : ', hors ligne'}]`).join('\n')}`;
  }
  const query = args.device || args.entity_id;
  if (!String(query || '').trim()) return 'Précisez le nom de l’appareil Tuya (voir action=list).';
  const { device, matches } = findTuyaDevice(devices, query);
  if (!device) {
    return matches.length
      ? `Plusieurs appareils Tuya correspondent à « ${query} » : ${matches.slice(0, 8).map((candidate) => candidate.name).join(', ')}. Précisez lequel.`
      : `Aucun appareil Tuya ne correspond à « ${query} ».`;
  }
  if (!device.online && args.action !== 'status') return `« ${device.name} » est hors ligne dans Tuya.`;

  if (args.action === 'status') {
    const status = await client.getStatus(device.id);
    if (!status.length) return `« ${device.name} » : aucun état renvoyé.`;
    return `${device.name} [${device.type}${device.online ? '' : ', hors ligne'}] : ${status.slice(0, 12).map(({ code, value }) => `${code}=${typeof value === 'object' ? JSON.stringify(value) : value}`).join(', ')}.`;
  }
  if (device.sensitive && args.confirmed !== true) {
    return confirmationMessage(device.name, args.action === 'turn_off' ? 'fermer/verrouiller' : 'ouvrir/déverrouiller');
  }

  let action = args.action;
  if (action === 'toggle') {
    const status = await client.getStatus(device.id);
    const current = status.find((entry) => SWITCH_STATUS.test(entry.code));
    if (!current) return `Impossible de déterminer l’état de « ${device.name} » pour le basculer.`;
    action = current.value ? 'turn_off' : 'turn_on';
  }
  let functions = await client.getFunctions(device.id).catch(() => []);
  if (!functions.length) functions = (await client.getStatus(device.id)).map(({ code }) => ({ code }));
  const commands = buildTuyaCommands(action, { brightness: args.brightness }, functions);
  await client.sendCommands(device.id, commands);
  if (action === 'set_brightness') return `Luminosité de « ${device.name} » réglée à ${Math.round(Number(args.brightness))} %.`;
  return `« ${device.name} » ${action === 'turn_on' ? 'allumé' : 'éteint'} (Tuya).`;
}

/**
 * @param {object} args  tool arguments: action, provider, device|entity_id, domain, brightness, confirmed
 * @param {{ cfg:object, http:Function, getTuya:Function, tuyaConfigured:()=>Promise<boolean> }} deps
 */
export async function runSmartHome(args = {}, deps) {
  const action = String(args.action || 'list').toLowerCase();
  if (!ACTIONS.includes(action)) return `Action inconnue : ${action}. Actions disponibles : ${ACTIONS.join(', ')}.`;
  const request = { ...args, action };
  let provider = normalize(args.provider).replace(/[\s-]+/g, '_');
  if (provider === 'homeassistant' || provider === 'ha') provider = 'home_assistant';
  if (provider === 'smart_life' || provider === 'tuya_cloud') provider = 'tuya';
  const tuyaConfigured = await deps.tuyaConfigured();
  const haConfigured = Boolean(deps.cfg.haUrl && deps.cfg.haToken);
  if (!provider || provider === 'auto') {
    if (/^[a-z_]+\.[a-z0-9_]+$/i.test(String(args.entity_id || ''))) provider = 'home_assistant';
    else if (action === 'list' && tuyaConfigured && haConfigured) provider = 'both';
    else provider = haConfigured ? 'home_assistant' : tuyaConfigured ? 'tuya' : 'home_assistant';
  }
  try {
    if (provider === 'both') {
      const parts = await Promise.allSettled([runHomeAssistant(request, deps), runTuya(request, deps)]);
      return parts.map((part) => (part.status === 'fulfilled' ? part.value : `Erreur : ${part.reason?.message || part.reason}`)).join('\n\n');
    }
    if (provider === 'tuya') {
      if (!tuyaConfigured) return 'Tuya n’est pas configuré. Ajoutez l’Access ID et l’Access Secret du projet Tuya IoT dans Réglages > Système PC & Domotique.';
      return await runTuya(request, deps);
    }
    if (provider === 'home_assistant') return await runHomeAssistant(request, deps);
    return `Fournisseur inconnu : ${args.provider}. Utilisez home_assistant ou tuya.`;
  } catch (error) {
    return `Erreur domotique : ${error.message || error}`;
  }
}
