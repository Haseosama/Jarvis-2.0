// Implémentation côté Jarvis de « #cornelius/addons » (contrat apiVersion 1) : seules les valeurs d'exécution existent ici,
// les types sont effacés par le chargeur TypeScript de Node.

export const COLLECT_CODES = ['config_invalid', 'auth', 'forbidden', 'not_found', 'invalid_params', 'quota', 'timeout', 'unavailable', 'malformed', 'upstream'];

export class AddonCollectError extends Error {
  constructor(code, message, retryable = false) {
    super(String(message ?? '').slice(0, 300) || 'Erreur de collecte.');
    this.name = 'AddonCollectError';
    this.code = COLLECT_CODES.includes(code) ? code : 'upstream';
    this.retryable = retryable === true;
  }
}

export const CONTRACT_VERSION = 1;
