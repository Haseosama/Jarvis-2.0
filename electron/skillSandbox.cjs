'use strict';
// Skill sandbox: runs generated skill code in a dedicated worker thread, inside a fresh V8 context that has
//  - no host objects (no require/process/fetch/timers; only JS builtins),
//  - string code generation disabled (eval / Function / import() are unavailable),
//  - a synchronous execution timeout plus a hard worker.terminate() deadline,
//  - bounded heap, stack, log lines and output size.
// Only primitives (JSON strings) cross the boundary. This is defence in depth for pure-computation skills;
// it is not an operating-system level sandbox, which is why skills also need explicit user approval.

const { Worker } = require('node:worker_threads');

const MAX_CODE_CHARS = 20000;
const MAX_OUTPUT_CHARS = 20000;
const MAX_ARGS_CHARS = 20000;

const WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const vm = require('node:vm');
const started = Date.now();
const reply = (message) => { parentPort.postMessage({ ...message, durationMs: Date.now() - started }); };
try {
  const { code, argsJson, mode, timeoutMs, maxOutput } = workerData;
  const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
  context.__argsJson = argsJson;
  context.__maxOutput = maxOutput;
  vm.runInContext('globalThis.__logs = []; globalThis.console = { log: (...a) => { if (__logs.length < 50) __logs.push(a.map((x) => { try { return typeof x === "string" ? x : JSON.stringify(x); } catch (e) { return String(x); } }).join(" ").slice(0, 500)); } }; console.info = console.warn = console.error = console.log;', context, { timeout: 500 });
  const script = new vm.Script('"use strict";\n' + code + '\n;globalThis.__execute = typeof execute === "function" ? execute : undefined;', { filename: 'skill.js' });
  if (mode === 'check') {
    script.runInContext(context, { timeout: timeoutMs });
    reply({ ok: true, hasExecute: vm.runInContext('typeof __execute', context) === 'function' });
  } else {
    script.runInContext(context, { timeout: timeoutMs });
    const out = vm.runInContext('(function () {' +
      'if (typeof __execute !== "function") return JSON.stringify({ ok: false, error: "La compétence doit définir function execute(args)." });' +
      'var args = JSON.parse(__argsJson);' +
      'var result = __execute(args);' +
      'if (result && typeof result.then === "function") return JSON.stringify({ ok: false, error: "execute doit être synchrone (pas de Promise)." });' +
      'var text;' +
      'if (typeof result === "string") text = result; else if (result === undefined) text = ""; else { try { text = JSON.stringify(result); } catch (e) { return JSON.stringify({ ok: false, error: "Résultat non sérialisable." }); } if (text === undefined) text = String(result); }' +
      'var truncated = text.length > __maxOutput;' +
      'return JSON.stringify({ ok: true, output: truncated ? text.slice(0, __maxOutput) : text, truncated: truncated, logs: __logs.slice(0, 50) });' +
      '})()', context, { timeout: timeoutMs });
    reply(JSON.parse(out));
  }
} catch (error) {
  const message = error && typeof error.message === 'string' ? error.message : 'Erreur inconnue';
  const timedOut = error && error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT';
  reply({ ok: false, error: timedOut ? 'Délai d’exécution dépassé (boucle infinie ?).' : String(error && error.name ? error.name : 'Error') + ' : ' + message.slice(0, 300) });
}
`;

/**
 * @param {{code:string,args?:object,mode?:'run'|'check',timeoutMs?:number}} input
 * @returns {Promise<{ok:boolean,output?:string,error?:string,logs?:string[],truncated?:boolean,durationMs:number,hasExecute?:boolean}>}
 */
function runInSandbox(input = {}) {
  const started = Date.now();
  const code = String(input.code ?? '');
  const mode = input.mode === 'check' ? 'check' : 'run';
  const timeoutMs = Math.min(5000, Math.max(50, Math.round(Number(input.timeoutMs) || 1500)));
  if (!code.trim()) return Promise.resolve({ ok: false, error: 'Code vide.', durationMs: 0 });
  if (code.length > MAX_CODE_CHARS) return Promise.resolve({ ok: false, error: `Code trop long (${MAX_CODE_CHARS} caractères maximum).`, durationMs: 0 });
  let argsJson;
  try {
    argsJson = JSON.stringify(input.args ?? {});
  } catch {
    return Promise.resolve({ ok: false, error: 'Arguments non sérialisables.', durationMs: 0 });
  }
  if (argsJson.length > MAX_ARGS_CHARS) return Promise.resolve({ ok: false, error: 'Arguments trop volumineux.', durationMs: 0 });

  return new Promise((resolve) => {
    let settled = false;
    let worker;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (worker) worker.terminate().catch(() => {});
      resolve({ durationMs: Date.now() - started, ...result });
    };
    const deadline = setTimeout(() => finish({ ok: false, error: 'Délai d’exécution dépassé (boucle infinie ?).' }), timeoutMs + 750);
    try {
      worker = new Worker(WORKER_SOURCE, {
        eval: true,
        env: {},
        stdout: true,
        stderr: true,
        execArgv: [],
        resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 2 },
        workerData: { code, argsJson, mode, timeoutMs, maxOutput: MAX_OUTPUT_CHARS },
      });
    } catch (error) {
      finish({ ok: false, error: `Bac à sable indisponible : ${error.message}` });
      return;
    }
    worker.once('message', (message) => finish(message));
    worker.once('error', (error) => finish({ ok: false, error: error?.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'Mémoire dépassée.' : `Erreur du bac à sable : ${String(error?.message || error).slice(0, 200)}` }));
    worker.once('exit', (exitCode) => finish({ ok: false, error: `Le bac à sable s’est arrêté (code ${exitCode}).` }));
  });
}

module.exports = { runInSandbox, MAX_CODE_CHARS, MAX_OUTPUT_CHARS };
