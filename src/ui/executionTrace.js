const SENSITIVE_FIELD = /api.?key|secret|token|password|credential|authorization|cookie/i;
const MAX_STRING_LENGTH = 1200;
const MAX_ITEMS = 32;

export function sanitizeTraceValue(value, fieldName = '', depth = 0) {
  if (SENSITIVE_FIELD.test(fieldName)) return '[secret masqué]';
  if (depth > 5) return '[profondeur masquée]';
  if (typeof value === 'string') {
    if (/^data:[^,]*;base64,/i.test(value)) return '[donnée binaire masquée]';
    const redacted = value
      .replace(/(bearer\s+)[a-z0-9._~+\/-]+=*/gi, '$1[secret masqué]')
      .replace(/((?:api[_ -]?key|(?:(?:access|refresh|auth)[_ -]?)?token|client[_ -]?secret|secret|password|passphrase|authorization|cookie)\s*[:=]\s*)["']?[^\s,;&"']+/gi, '$1[secret masqué]')
      .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[secret masqué]')
      .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[secret masqué]')
      .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[secret masqué]');
    return redacted.length > MAX_STRING_LENGTH ? `${redacted.slice(0, MAX_STRING_LENGTH)}…` : redacted;
  }
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map((item) => sanitizeTraceValue(item, '', depth + 1));
    if (value.length > MAX_ITEMS) items.push(`… ${value.length - MAX_ITEMS} éléments masqués`);
    return items;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).slice(0, MAX_ITEMS).map(([key, item]) => [key, sanitizeTraceValue(item, key, depth + 1)]);
    if (Object.keys(value).length > MAX_ITEMS) entries.push(['…', 'champs supplémentaires masqués']);
    return Object.fromEntries(entries);
  }
  return String(value);
}

export function formatTraceValue(value, maxLength = 1800) {
  const safeValue = sanitizeTraceValue(value);
  let formatted;
  try {
    formatted = typeof safeValue === 'string' ? safeValue : JSON.stringify(safeValue, null, 2);
  } catch {
    formatted = String(safeValue);
  }
  if (!formatted) return '—';
  return formatted.length > maxLength ? `${formatted.slice(0, maxLength)}…` : formatted;
}
