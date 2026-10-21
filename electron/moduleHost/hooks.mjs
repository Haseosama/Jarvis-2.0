// Crochets de résolution du processus des modules externes (contrat apiVersion 1 de Cornelius) :
//  - « #cornelius/addons », « #cornelius/validation », « #cornelius/testing » pointent vers les implémentations de Jarvis ;
//  - un import relatif en « .js » qui n'existe pas est cherché en « .ts » (les modules s'écrivent en TypeScript avec l'extension .js).
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = new URL('.', import.meta.url);
const ALIASES = {
  '#cornelius/addons': new URL('./addons.mjs', here).href,
  '#cornelius/validation': new URL('./validation.mjs', here).href,
  '#cornelius/testing': new URL('./testing.mjs', here).href,
};

export async function resolve(specifier, context, nextResolve) {
  if (ALIASES[specifier]) return { url: ALIASES[specifier], shortCircuit: true };
  if (specifier.startsWith('#cornelius/')) throw new Error(`Alias inconnu : ${specifier}`);
  if (/^\.\.?\//.test(specifier) && specifier.endsWith('.js') && context.parentURL?.startsWith('file:')) {
    const target = new URL(specifier, context.parentURL);
    const js = fileURLToPath(target);
    if (!existsSync(js)) {
      const ts = js.slice(0, -3) + '.ts';
      if (existsSync(ts)) return { url: pathToFileURL(ts).href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
