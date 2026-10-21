// « #cornelius/validation » : JSON Schema 2020-12 compilé par Ajv en mode strict avec les formats standards.
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true });
addFormats.default ? addFormats.default(ajv) : addFormats(ajv);

/** Retourne un garde de type (data) => boolean ; `.errors` garde les erreurs du dernier appel. */
export function compile(schema) {
  const validate = ajv.compile(schema);
  const guard = (data) => { const ok = validate(data); guard.errors = validate.errors; return ok; };
  guard.errors = null;
  return guard;
}
