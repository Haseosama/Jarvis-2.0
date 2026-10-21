'use strict';
// REA (morluto/rea, paquet npm rea-agents, licence MIT) : rétro-ingénierie locale de binaires, applications Electron/JavaScript,
// assemblies .NET, bases SQLite et binaires Go/Rust. Jarvis s'en sert comme d'un outil en ligne de commande.
//
// Sécurité :
//  - le paquet est installé UNE fois dans les données de Jarvis, à une version fixée, sur confirmation de l'utilisateur
//    (le téléchargement et l'installation sont décidés dans l'interface, jamais par le modèle), avec --ignore-scripts ;
//  - aucune commande n'est lancée via un shell : liste blanche de sous-commandes, arguments passés en tableau ;
//  - les cibles sont des chemins absolus existants ; REA ne les exécute pas (analyse statique) ;
//  - les résultats volumineux vont dans un fichier, Jarvis n'en reçoit qu'un résumé.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const REA_VERSION = '6.5.0';
const NODE_RANGE = 'Node.js ^22.19, ^24.11 ou >=26';
const RUN_TIMEOUT_MS = 10 * 60 * 1000;
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_CAPTURE = 300 * 1024 * 1024;
const PROVIDERS = ['ghidra', 'hopper', 'ida', 'kuna', 'jadx'];

// sous-commande REA -> forme des arguments
const COMMANDS = {
  analyze_javascript_application: { cli: 'analyze-javascript-application', target: true },
  inspect_managed_artifact: { cli: 'inspect-managed-artifact', target: true },
  inspect_managed_members: { cli: 'inspect-managed-members', target: true, type: true },
  inspect_sqlite_database: { cli: 'inspect-sqlite-database', target: true, table: true },
  inspect_go_binary: { cli: 'inspect-go-binary', target: true },
  inspect_rust_binary: { cli: 'inspect-rust-binary', target: true },
  analyze: { cli: 'analyze', target: true, provider: true },
  search: { cli: 'search', target: true, query: true, provider: true },
  function: { cli: 'function', target: true, query: true, provider: true },
  decompile: { cli: 'decompile', target: true, query: true, provider: true },
  xrefs: { cli: 'xrefs', target: true, query: true, provider: true },
  trace: { cli: 'trace', target: true, query: true, provider: true },
  providers: { cli: 'providers' },
  capabilities: { cli: 'capabilities' },
  doctor: { cli: 'doctor', provider: true },
};

/** Version de Node acceptée par REA : ^22.19 || ^24.11 || >=26. */
function nodeVersionOk(version) {
  const m = /^v?(\d+)\.(\d+)\./.exec(String(version || ''));
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  return (major === 22 && minor >= 19) || (major === 24 && minor >= 11) || major >= 26;
}

/**
 * Variables d'environnement pour le moteur natif. REA n'installe jamais Ghidra ni Java : il lit GHIDRA_INSTALL_DIR
 * (Ghidra 12.1.x) et JAVA_HOME (JDK 64 bits complet, 21 ou plus récent). On ne les transmet que si elles ont l'air valides.
 */
function engineEnv({ ghidraDir, javaHome } = {}, { exists = (p) => fs.existsSync(p) } = {}) {
  const env = {};
  const problems = [];
  if (ghidraDir) {
    if (!path.isAbsolute(ghidraDir)) problems.push('Le dossier Ghidra doit être un chemin absolu.');
    else if (!exists(path.join(ghidraDir, 'Ghidra', 'application.properties'))) problems.push(`« ${ghidraDir} » n’est pas un dossier Ghidra (Ghidra/application.properties introuvable). Indiquez le dossier ghidra_12.1.x_PUBLIC.`);
    else env.GHIDRA_INSTALL_DIR = ghidraDir;
  }
  if (javaHome) {
    const java = path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    if (!path.isAbsolute(javaHome)) problems.push('JAVA_HOME doit être un chemin absolu.');
    else if (!exists(java)) problems.push(`« ${javaHome} » ne contient pas bin/java : indiquez le dossier d’un JDK complet (21 ou plus).`);
    else env.JAVA_HOME = javaHome;
  }
  return { env, problems };
}

/** Construit la liste d'arguments (sans shell) ou renvoie { error }. */
function buildArgs(command, params = {}, { exists = (p) => fs.existsSync(p) } = {}) {
  const spec = COMMANDS[String(command || '')];
  if (!spec) return { error: `Commande REA inconnue : « ${command} ». Commandes : ${Object.keys(COMMANDS).join(', ')}.` };
  const args = [spec.cli];
  if (spec.target) {
    const target = String(params.target || '');
    if (!path.isAbsolute(target) || target.split(/[\\/]/).includes('..')) return { error: 'La cible doit être un chemin absolu, sans « .. ».' };
    if (!exists(target)) return { error: `Cible introuvable : ${target}` };
    args.push(target);
  }
  if (spec.query) {
    const query = String(params.query || '').trim();
    if (!query || query.length > 300 || query.startsWith('-')) return { error: 'Recherche, nom de fonction ou adresse manquant ou invalide.' };
    args.push(query);
  }
  if (spec.provider && params.provider) {
    const provider = String(params.provider).toLowerCase();
    if (!PROVIDERS.includes(provider)) return { error: `Fournisseur inconnu : ${provider}. Fournisseurs : ${PROVIDERS.join(', ')}.` };
    args.push('--provider', provider);
  }
  if (spec.type && params.type) {
    const type = String(params.type).trim();
    if (!/^[\w.+`<>,\[\]-]{1,200}$/.test(type)) return { error: 'Nom de type invalide.' };
    args.push('--type', type);
  }
  if (spec.table && params.table) {
    const table = String(params.table).trim();
    if (!/^[\w$ .-]{1,100}$/.test(table)) return { error: 'Nom de table invalide.' };
    args.push('--table', table, '--row-limit', String(Math.min(100, Math.max(1, Number(params.row_limit) || 20))));
  }
  args.push('--json');
  return { args };
}

/** Résumé borné d'une sortie JSON potentiellement énorme : clés de premier niveau, tailles, début. */
function summarizeJson(text, { maxChars = 3000 } = {}) {
  const size = Buffer.byteLength(text);
  let parsed;
  try { parsed = JSON.parse(text); } catch { return { size, summary: String(text).slice(0, maxChars) }; }
  const describe = (v) => (Array.isArray(v) ? `liste de ${v.length}` : v && typeof v === 'object' ? `objet de ${Object.keys(v).length} clés` : JSON.stringify(v)?.slice(0, 80));
  const top = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? Object.entries(parsed).slice(0, 25).map(([k, v]) => `${k}: ${describe(v)}`)
    : [describe(parsed)];
  const head = JSON.stringify(parsed, (_k, v) => (Array.isArray(v) ? v.slice(0, 3) : v), 1).slice(0, maxChars);
  return { size, summary: `${top.join('\n')}\n---\n${head}` };
}

function run(file, args, { timeoutMs, env, cwd } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, args, { shell: false, windowsHide: true, cwd, env: { ...process.env, ...env } });
    } catch (e) {
      resolve({ ok: false, code: -1, stdout: '', stderr: String(e.message || e) });
      return;
    }
    const out = [];
    let outBytes = 0;
    let err = '';
    let killed = false;
    const timer = setTimeout(() => { killed = true; child.kill(); }, timeoutMs || RUN_TIMEOUT_MS);
    child.stdout.on('data', (d) => { outBytes += d.length; if (outBytes <= MAX_CAPTURE) out.push(d); else if (!killed) { killed = true; child.kill(); } });
    child.stderr.on('data', (d) => { if (err.length < 8000) err += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, code: -1, stdout: '', stderr: String(e.message || e) }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && !killed, code, killed, stdout: Buffer.concat(out).toString('utf8'), stderr: err });
    });
  });
}

function createReaBridge({ dataDir, nodeFinder } = {}) {
  const home = path.join(dataDir, 'rea');
  const outDir = path.join(home, 'out');
  const reaScript = path.join(home, 'node_modules', 'rea-agents', 'scripts', 'rea.mjs');

  async function findNode() {
    if (nodeFinder) return nodeFinder();
    const lookup = await run(process.platform === 'win32' ? 'where' : 'which', ['node'], { timeoutMs: 5000 });
    const exe = lookup.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (!exe) return { ok: false, reason: `Node.js introuvable : REA exige ${NODE_RANGE}.` };
    const v = await run(exe, ['--version'], { timeoutMs: 5000 });
    const version = v.stdout.trim();
    if (!nodeVersionOk(version)) return { ok: false, reason: `Node.js ${version || 'inconnu'} est trop ancien : REA exige ${NODE_RANGE}.` };
    return { ok: true, exe, version };
  }

  async function status() {
    const node = await findNode();
    return { installed: fs.existsSync(reaScript), version: REA_VERSION, node, folder: home };
  }

  async function install() {
    const node = await findNode();
    if (!node.ok) return { ok: false, text: node.reason };
    const npmCli = path.join(path.dirname(node.exe), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (!fs.existsSync(npmCli)) return { ok: false, text: 'npm est introuvable à côté de Node.js : installez Node.js avec npm.' };
    fs.mkdirSync(home, { recursive: true });
    const res = await run(node.exe, [npmCli, 'install', '--prefix', home, `rea-agents@${REA_VERSION}`, '--ignore-scripts', '--no-audit', '--no-fund'], { timeoutMs: INSTALL_TIMEOUT_MS });
    if (!res.ok || !fs.existsSync(reaScript)) return { ok: false, text: `Installation de REA échouée : ${(res.stderr || res.stdout).slice(0, 400)}` };
    return { ok: true, text: `REA ${REA_VERSION} installé dans ${home} (scripts d'installation désactivés).` };
  }

  async function exec({ command, ...params } = {}) {
    const built = buildArgs(command, params);
    if (built.error) return { ok: false, text: built.error };
    if (!fs.existsSync(reaScript)) return { ok: false, needsInstall: true, text: 'REA n’est pas installé.' };
    const node = await findNode();
    if (!node.ok) return { ok: false, text: node.reason };
    const engine = engineEnv({ ghidraDir: params.ghidraDir, javaHome: params.javaHome });
    if (engine.problems.length) return { ok: false, text: engine.problems.join(' ') };
    const res = await run(node.exe, [reaScript, ...built.args], { timeoutMs: RUN_TIMEOUT_MS, cwd: home, env: engine.env });
    if (res.killed) return { ok: false, text: 'L’analyse a dépassé la limite (10 min) ou produit une sortie trop volumineuse.' };
    if (!res.ok && !res.stdout) return { ok: false, text: `REA a échoué (code ${res.code}) : ${res.stderr.slice(0, 600)}` };
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `${Date.now()}-${COMMANDS[command].cli}.json`);
    fs.writeFileSync(file, res.stdout);
    const { size, summary } = summarizeJson(res.stdout);
    return { ok: res.ok, file, size, text: summary, warning: res.ok ? '' : res.stderr.slice(0, 400) };
  }

  return { status, install, exec };
}

module.exports = { createReaBridge, engineEnv, buildArgs, summarizeJson, nodeVersionOk, COMMANDS, PROVIDERS, REA_VERSION };
