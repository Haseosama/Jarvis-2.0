import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

function handleProxyRequest(req, res) {
  if (!req.url || !req.url.startsWith('/__jarvis_proxy__')) return false;
  let rawBody = '';
  req.on('data', (chunk) => {
    rawBody += chunk;
  });
  req.on('end', async () => {
    try {
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const { url, method = 'GET', headers = {}, body = null, timeoutMs = 12000 } = payload;
      if (!url || !/^https?:\/\//i.test(url)) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, status: 400, error: 'Invalid URL', text: '' }));
        return;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const upstream = await fetch(url, {
          method,
          headers: {
            'User-Agent': 'Jarvis-PC/2.0 (Windows NT 10.0; Win64; x64)',
            Accept: 'application/json, text/plain, */*',
            ...headers,
          },
          body: method !== 'GET' && method !== 'HEAD' ? body : undefined,
          signal: controller.signal,
        });
        const text = await upstream.text();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(
          JSON.stringify({
            ok: upstream.ok,
            status: upstream.status,
            text,
          })
        );
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          ok: false,
          status: 0,
          error: e.message || String(e),
          text: '',
        })
      );
    }
  });
  return true;
}

function jarvisCorsProxyPlugin() {
  return {
    name: 'jarvis-cors-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!handleProxyRequest(req, res)) next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!handleProxyRequest(req, res)) next();
      });
    },
  };
}

// MediaPipe (détection de visages pour la présence) : le moteur WebAssembly est servi depuis ce dossier de l'application.
const MEDIAPIPE_WASM = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm'];
function mediapipeWasmPlugin() {
  const dir = path.resolve('node_modules/@mediapipe/tasks-vision/wasm');
  return {
    name: 'jarvis-mediapipe-wasm',
    configureServer(server) {
      server.middlewares.use('/mediapipe/wasm', (req, res, next) => {
        const name = decodeURIComponent((req.url || '').split('?')[0]).replace(/^\/+/, '');
        if (!MEDIAPIPE_WASM.includes(name)) return next();
        res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'application/javascript');
        fs.createReadStream(path.join(dir, name)).pipe(res);
        return undefined;
      });
    },
    generateBundle() {
      for (const name of MEDIAPIPE_WASM) {
        const file = path.join(dir, name);
        if (fs.existsSync(file)) this.emitFile({ type: 'asset', fileName: `mediapipe/wasm/${name}`, source: fs.readFileSync(file) });
      }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), jarvisCorsProxyPlugin(), mediapipeWasmPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets-bundle',
    emptyOutDir: true,
  },
});
