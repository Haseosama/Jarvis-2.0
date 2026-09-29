// Port of PluginSpec.kt, PluginCatalog.kt, PluginRunner.kt, PluginStore.kt from Jarvis-Android
// Loads and executes the 82 bundled JSON plugins + custom user plugins

import { hostBridge } from './hostBridge.js';
import { dataStore } from './DataStore.js';

class PluginEngine {
  constructor() {
    this.catalog = [];
    this.loaded = false;
    this.loadingPromise = null;
  }

  async loadCatalog() {
    if (this.loaded) return this.catalog;
    if (this.loadingPromise) return this.loadingPromise;
    this.loadingPromise = (async () => {
      try {
        const res = await fetch('./assets/plugins/index.json');
        const entries = await res.json();
        const specs = await Promise.all(
          entries.map(async (entry) => {
            try {
              if (entry && typeof entry === 'object') {
                const spec = entry.spec || entry;
                return { ...spec, _bundled: true, _file: entry.fileName || `${spec.name}.json` };
              }
              const r = await fetch(`./assets/plugins/${entry}`);
              const spec = await r.json();
              return { ...spec, _bundled: true, _file: entry };
            } catch {
              return null;
            }
          })
        );
        this.catalog = specs.filter((s) => s && s.name && s.description);
        this.loaded = true;
      } catch {
        this.catalog = [];
      }
      return this.catalog;
    })();
    return this.loadingPromise;
  }

  getAllPlugins() {
    const custom = dataStore.get().customPlugins || [];
    const byName = new Map();
    for (const p of this.catalog) byName.set(p.name, p);
    for (const p of custom) byName.set(p.name, { ...p, _custom: true });
    return Array.from(byName.values());
  }

  findPlugin(nameOrQuery) {
    const q = String(nameOrQuery || '')
      .trim()
      .toLowerCase()
      .replace(/^plugin_/, '');
    if (!q) return null;
    const all = this.getAllPlugins();
    return (
      all.find((p) => p.name.toLowerCase() === q) ||
      all.find((p) => p.name.toLowerCase().includes(q) || (p.title || '').toLowerCase().includes(q)) ||
      all.find((p) => (p.description || '').toLowerCase().includes(q))
    );
  }

  fillTemplate(template, args = {}) {
    if (!template) return '';
    return String(template).replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_, key) => {
      const val = args[key] ?? '';
      return String(val);
    });
  }

  fillUrlTemplate(template, args = {}) {
    if (!template) return '';
    return String(template).replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_, key) => {
      const val = args[key] ?? '';
      return encodeURIComponent(String(val));
    });
  }

  extractAtPath(node, pathStr) {
    if (!pathStr) return node;
    let cur = node;
    const parts = String(pathStr).split('.');
    for (const part of parts) {
      if (cur == null) return null;
      const m = /^([^[\]]+)?(?:\[(\d+)\])?$/.exec(part);
      if (!m) return null;
      const key = m[1];
      const idx = m[2] !== undefined ? parseInt(m[2], 10) : null;
      if (key) {
        cur = typeof cur === 'object' ? cur[key] : null;
      }
      if (idx !== null) {
        cur = Array.isArray(cur) ? cur[idx] : null;
      }
    }
    return cur;
  }

  formatResponse(spec, rawText, jsonNode) {
    if (!jsonNode) {
      return String(rawText || '').slice(0, 1200) || 'Réponse vide.';
    }
    if (spec.result_items) {
      const items = this.extractAtPath(jsonNode, spec.result_items);
      if (Array.isArray(items)) {
        const max = Math.min(Math.max(spec.result_max || 8, 1), 20);
        const fields = Array.isArray(spec.result_fields) ? spec.result_fields : [];
        const lines = items.slice(0, max).map((item, idx) => {
          if (fields.length > 0 && item && typeof item === 'object') {
            const parts = fields
              .map((f) => this.extractAtPath(item, f))
              .filter((v) => v !== null && v !== undefined && String(v).trim() !== '');
            return `${idx + 1}. ${parts.join(' — ')}`;
          }
          return `${idx + 1}. ${typeof item === 'object' ? JSON.stringify(item) : String(item)}`;
        });
        return lines.length > 0 ? lines.join('\n') : 'Aucun élément trouvé.';
      }
    }
    if (spec.result_path) {
      const val = this.extractAtPath(jsonNode, spec.result_path);
      if (val !== null && val !== undefined) {
        return typeof val === 'object' ? JSON.stringify(val, null, 2).slice(0, 1200) : String(val);
      }
    }
    return JSON.stringify(jsonNode, null, 2).slice(0, 1200);
  }

  async runPlugin(nameOrSpec, args = {}, toolRunner = null) {
    await this.loadCatalog();
    const spec = typeof nameOrSpec === 'string' ? this.findPlugin(nameOrSpec) : nameOrSpec;
    if (!spec) {
      return `Plugin introuvable : "${nameOrSpec}". Utilisez plugins(action="list") pour voir les 82 plugins disponibles.`;
    }

    // Populate default parameter values
    const mergedArgs = { ...args };
    for (const p of spec.parameters || []) {
      if (mergedArgs[p.name] === undefined || mergedArgs[p.name] === '') {
        if (p.default !== undefined && p.default !== '') {
          mergedArgs[p.name] = p.default;
        }
      }
    }

    const type = (spec.type || 'http').toLowerCase();

    if (type === 'open') {
      const uri = this.fillUrlTemplate(spec.url || spec.uri || '', mergedArgs);
      if (!uri) return `Plugin ${spec.name} : aucune URL à ouvrir.`;
      await hostBridge.openExternal(uri);
      return `Plugin « ${spec.title || spec.name} » exécuté : ouverture de ${uri}`;
    }

    if (type === 'routine') {
      const steps = Array.isArray(spec.steps) ? spec.steps.slice(0, 10) : [];
      if (!steps.length) return `Plugin routine « ${spec.name} » sans étapes.`;
      const results = [];
      for (const st of steps) {
        const stepArgs = {};
        for (const [k, v] of Object.entries(st.args || {})) {
          stepArgs[k] = this.fillTemplate(v, mergedArgs);
        }
        if (toolRunner) {
          const out = await toolRunner(st.tool, stepArgs);
          results.push(`[${st.tool}] : ${out}`);
        }
      }
      return results.join('\n');
    }

    // Default: HTTP plugin
    const url = this.fillUrlTemplate(spec.url, mergedArgs);
    const method = (spec.method || 'GET').toUpperCase();
    const headers = { ...(spec.headers || {}) };
    let body;
    if (method === 'POST' && spec.body_template) {
      body = this.fillTemplate(spec.body_template, mergedArgs);
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    }

    const res = await hostBridge.httpFetch(url, {
      method,
      headers,
      body,
      timeoutMs: 10000,
    });

    if (!res.ok) {
      return `Le plugin « ${spec.title || spec.name} » a répondu avec le statut HTTP ${res.status || 'erreur'}.`;
    }

    const formatted = this.formatResponse(spec, res.text, res.json);
    return `[Données externes du plugin « ${spec.title || spec.name} »]\n${formatted}`;
  }
}

export const pluginEngine = new PluginEngine();
