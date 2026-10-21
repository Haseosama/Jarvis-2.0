'use strict';
// Modules externes au contrat apiVersion 1 de Cornelius (dépôt lfpoulain/cornelius-modules : vacances, agenda, carburants, vélos…).
// Un module est du code TypeScript qui s'exécute avec les droits de l'utilisateur : il tourne dans un processus Node.js séparé
// (electron/moduleHost/child.mjs, Node 24.2 ou plus du système), jamais dans l'application, avec un environnement réduit.
// Le dossier et l'activation viennent des Réglages (lus par le processus principal, jamais des arguments d'un outil).

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const CHILD = path.join(__dirname, 'moduleHost', 'child.mjs');
const REQUEST_TIMEOUT_MS = 60_000;
const IDLE_MS = 5 * 60_000;

/** Node.js 24.2 ou plus (types TypeScript effacés nativement, comme l'exige le dépôt des modules). */
function nodeOk(version) {
  const m = /^v?(\d+)\.(\d+)\./.exec(String(version || ''));
  if (!m) return false;
  const major = Number(m[1]);
  return major > 24 || (major === 24 && Number(m[2]) >= 2);
}

/** Dossier valide : chemin absolu, sans « .. », existant. */
function checkedDir(dir) {
  const d = String(dir || '');
  if (!d || !path.isAbsolute(d) || d.split(/[\\/]/).includes('..')) return { error: 'Le dossier des modules doit être un chemin absolu.' };
  try { if (!fs.statSync(d).isDirectory()) return { error: 'Ce chemin n’est pas un dossier.' }; } catch { return { error: 'Dossier des modules introuvable.' }; }
  return { dir: d };
}

function run(file, args, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try { child = spawn(file, args, { shell: false, windowsHide: true }); } catch { resolve({ ok: false, stdout: '' }); return; }
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => { clearTimeout(timer); resolve({ ok: false, stdout: '' }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, stdout: out }); });
  });
}

function createModuleHost({ nodeFinder, spawnImpl = spawn } = {}) {
  let child = null;
  let dirOfChild = '';
  let rl = null;
  let ready = null;
  const waiting = new Map();
  let nextId = 1;
  let idle = null;

  async function findNode() {
    if (nodeFinder) return nodeFinder();
    const where = await run(process.platform === 'win32' ? 'where' : 'which', ['node']);
    const exe = where.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (!exe) return { ok: false, reason: 'Node.js introuvable : les modules externes exigent Node.js 24.2 ou plus.' };
    const v = (await run(exe, ['--version'])).stdout.trim();
    return nodeOk(v) ? { ok: true, exe, version: v } : { ok: false, reason: `Node.js ${v || 'inconnu'} est trop ancien : les modules externes exigent Node.js 24.2 ou plus.` };
  }

  function stop() {
    clearTimeout(idle);
    for (const w of waiting.values()) w({ ok: false, error: { code: 'unavailable', message: 'Processus des modules arrêté.', retryable: true } });
    waiting.clear();
    try { child?.kill(); } catch { /* déjà arrêté */ }
    child = null; ready = null; dirOfChild = '';
  }

  async function ensure(dir) {
    if (child && dirOfChild === dir && ready) return ready;
    stop();
    const node = await findNode();
    if (!node.ok) return { ok: false, error: { code: 'unavailable', message: node.reason, retryable: false } };
    dirOfChild = dir;
    const env = { PATH: process.env.PATH || '', SystemRoot: process.env.SystemRoot || '', TEMP: process.env.TEMP || '', TMP: process.env.TMP || '', NODE_NO_WARNINGS: '1' };
    child = spawnImpl(node.exe, ['--no-warnings', CHILD, dir], { shell: false, windowsHide: true, env, stdio: ['pipe', 'pipe', 'ignore'] });
    ready = new Promise((resolve) => {
      const failTimer = setTimeout(() => { resolve({ ok: false, error: { code: 'unavailable', message: 'Le processus des modules ne répond pas.', retryable: true } }); stop(); }, 20_000);
      child.on('error', () => { clearTimeout(failTimer); resolve({ ok: false, error: { code: 'unavailable', message: 'Impossible de lancer Node.js.', retryable: false } }); stop(); });
      child.on('close', () => { stop(); });
      let buf = '';
      child.stdout.on('data', (chunk) => {
        buf += chunk;
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          let msg;
          try { msg = JSON.parse(line); } catch { continue; }
          if (msg.ready) { clearTimeout(failTimer); resolve({ ok: true }); continue; }
          const w = waiting.get(msg.rid);
          if (w) { waiting.delete(msg.rid); w(msg); }
        }
      });
    });
    return ready;
  }

  /** Une requête au processus des modules. Retourne { ok, result } ou { ok:false, error }. */
  async function call(dir, req) {
    const checked = checkedDir(dir);
    if (checked.error) return { ok: false, error: { code: 'config_invalid', message: checked.error, retryable: false } };
    const up = await ensure(checked.dir);
    if (!up.ok) return up;
    clearTimeout(idle);
    idle = setTimeout(stop, IDLE_MS);
    idle.unref?.();
    return new Promise((resolve) => {
      const rid = nextId++;
      const timer = setTimeout(() => { waiting.delete(rid); resolve({ ok: false, error: { code: 'timeout', message: 'Le module a mis trop de temps à répondre.', retryable: true } }); }, REQUEST_TIMEOUT_MS);
      waiting.set(rid, (msg) => { clearTimeout(timer); resolve(msg); });
      try { child.stdin.write(`${JSON.stringify({ rid, ...req })}\n`); } catch { clearTimeout(timer); waiting.delete(rid); resolve({ ok: false, error: { code: 'unavailable', message: 'Processus des modules indisponible.', retryable: true } }); }
    });
  }

  return { call, stop, findNode };
}

module.exports = { createModuleHost, checkedDir, nodeOk, CHILD };
