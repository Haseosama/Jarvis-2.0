// Complete Tool Registry for Jarvis 2.0 PC Edition
// Adapts Jarvis-Android v0.9.53 + Jarvis-Pc tools to standalone PC desktop

import { hostBridge } from '../core/hostBridge.js';
import { configStore, ALL_VOICES, VOICE_DESC } from '../core/ConfigStore.js';
import { dataStore } from '../core/DataStore.js';
import { pluginEngine } from '../core/PluginEngine.js';
import { createAndSaveDocument } from './documentGenerator.js';
import {
  searchRadioStations,
  searchPodcasts,
  searchYouTubeVideos,
} from '../video/mediaService.js';
import {
  DEFAULT_SATELLITES,
  satelliteStateAt,
  lookAt,
  solarSystemObjects,
  moonPhase,
} from '../space/SpaceEngine.js';

export class ToolRegistry {
  constructor(uiCallbacks = {}) {
    this.ui = uiCallbacks; // { onOpenSpace, onOpenMedia, onCaptureCamera, onSpeak, onEndSession, onNotify }
    this.tools = new Map();
    this._registerCoreTools();
  }

  setUiCallbacks(cb) {
    this.ui = { ...this.ui, ...cb };
  }

  register(tool) {
    this.tools.set(tool.name, tool);
  }

  getDeclarations() {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters || { type: 'OBJECT', properties: {} },
    }));
  }

  async execute(name, args = {}) {
    const cleanName = String(name || '').trim();
    const tool = this.tools.get(cleanName);
    if (tool) {
      try {
        return await tool.run(args || {}, this);
      } catch (err) {
        return `Erreur lors de l'exécution de ${cleanName} : ${err.message || err}`;
      }
    }
    // Check if it's a direct plugin call (e.g. plugin_hn_top or hn_top)
    const pluginSpec = pluginEngine.findPlugin(cleanName);
    if (pluginSpec) {
      return pluginEngine.runPlugin(pluginSpec, args, (tName, tArgs) => this.execute(tName, tArgs));
    }
    return `Outil inconnu : ${cleanName}`;
  }

  _registerCoreTools() {
    // 1. System Monitor PC
    this.register({
      name: 'system_monitor',
      description: 'Obtenir l’état du PC : processeur (CPU), mémoire vive (RAM), système d’exploitation, temps de fonctionnement (uptime) et résolution d’écran.',
      parameters: { type: 'OBJECT', properties: {} },
      run: async () => {
        const info = await hostBridge.getSystemInfo();
        return (
          `État du système PC (${info.hostname}) :\n` +
          `• Système : ${info.platform} (${info.arch}) — ${info.osRelease}\n` +
          `• Processeur : ${info.cpuModel} (${info.cpuCores} cœurs) — Charge : ${info.cpuUsagePercent}%\n` +
          `• Mémoire RAM : ${info.usedMemGb} Go utilisés sur ${info.totalMemGb} Go (${info.memUsagePercent}%)\n` +
          `• Écran principal : ${info.screen?.width || 1920}×${info.screen?.height || 1080}\n` +
          `• Uptime : ${Math.floor((info.uptimeHours || 1))} h`
        );
      },
    });

    // 2. PC Device Settings (Volume, Brightness, Media, Lock, Sleep, Windows Settings)
    this.register({
      name: 'device_settings',
      description: 'Contrôler les réglages système du PC : volume (0-100), mute, unmute, brightness (0-100), media_play_pause, media_next, media_prev, lock (verrouiller la session Windows), sleep (mettre en veille), ou ouvrir un panneau de paramètres (wifi, bluetooth, display, sound).',
      parameters: {
        type: 'OBJECT',
        properties: {
          setting: {
            type: 'STRING',
            description: 'volume, mute, unmute, brightness, media_play_pause, media_next, media_prev, lock, sleep, wifi, bluetooth, display, sound',
          },
          value: { type: 'NUMBER', description: 'Niveau entre 0 et 100 pour volume ou brightness.' },
        },
        required: ['setting'],
      },
      run: async (args) => {
        const res = await hostBridge.setDeviceSetting(args);
        return res.message || `Réglage PC « ${args.setting} » appliqué.`;
      },
    });

    // 3. Open PC Application
    this.register({
      name: 'open_app',
      description: 'Lancer une application installée sur le PC (ex: Chrome, Edge, Firefox, VS Code, Bloc-notes, Calculatrice, Explorateur, Terminal, Spotify, Discord, WhatsApp, Steam, Word, Excel, PowerPoint, VLC, OBS, Paramètres).',
      parameters: {
        type: 'OBJECT',
        properties: {
          app_name: { type: 'STRING', description: 'Nom de l’application PC à ouvrir.' },
        },
        required: ['app_name'],
      },
      run: async (args) => {
        const res = await hostBridge.openApp(args.app_name || args.app || '');
        return res.message || `Application ${args.app_name} ouverte.`;
      },
    });

    // 4. PC Mouse / Keyboard / Window Control (PC equivalent of ScreenTools.kt)
    this.register({
      name: 'pc_control',
      description:
        'Contrôler la souris, le clavier et les fenêtres du PC : action = click, double_click, right_click, move, scroll, type, paste (coller du texte avec accents instantanément), hotkey (ex: ctrl+c, ctrl+v, ctrl+z, alt+tab, alt+f4, win+d, win+e, enter, esc, space), list_windows, focus_window, maximize_window, minimize_window, restore_window, snap_left, snap_right, close_window, kill_process, minimize_all.',
      parameters: {
        type: 'OBJECT',
        properties: {
          action: {
            type: 'STRING',
            description:
              'click, double_click, right_click, move, scroll, type, paste, hotkey, list_windows, focus_window, maximize_window, minimize_window, restore_window, snap_left, snap_right, close_window, kill_process, minimize_all',
          },
          x: { type: 'NUMBER', description: 'Coordonnée X à l’écran (pour click/move).' },
          y: { type: 'NUMBER', description: 'Coordonnée Y à l’écran (pour click/move).' },
          text: { type: 'STRING', description: 'Texte à taper/coller ou titre/nom de la fenêtre cible.' },
          keys: { type: 'STRING', description: 'Raccourci clavier (ex: ctrl+c, alt+tab, enter, escape).' },
          delta: { type: 'NUMBER', description: 'Amplitude de défilement (pour scroll, positif=haut, négatif=bas).' },
        },
        required: ['action'],
      },
      run: async (args) => {
        const act = String(args.action || '').toLowerCase();
        if (['click', 'double_click', 'right_click', 'move', 'scroll'].includes(act)) {
          const r = await hostBridge.mouseControl({
            action: act,
            x: args.x,
            y: args.y,
            delta: args.delta ?? -360,
          });
          return r.message || `Action souris ${act} effectuée.`;
        }
        if (act === 'type' || act === 'paste' || act === 'hotkey') {
          const r = await hostBridge.keyboardControl({
            action: act,
            text: args.text,
            keys: args.keys || args.text,
          });
          return r.message || `Action clavier ${act} effectuée.`;
        }
        if (act === 'list_windows') {
          const r = await hostBridge.windowControl({ action: 'list' });
          const wins = r.windows || [];
          if (!wins.length) return 'Aucune fenêtre active détectée.';
          return (
            'Fenêtres ouvertes sur le PC :\n' +
            wins
              .map(
                (w) =>
                  `• ${w.Name}${w.MemoryMB ? ` (${w.MemoryMB} Mo)` : ''} : ${w.MainWindowTitle}`
              )
              .join('\n')
          );
        }
        if (act === 'focus_window') {
          const r = await hostBridge.windowControl({ action: 'focus', title: args.text });
          return r.message || `Fenêtre « ${args.text} » activée.`;
        }
        if (act === 'maximize_window' || act === 'maximize') {
          const r = await hostBridge.windowControl({ action: 'maximize', title: args.text });
          return r.message || `Fenêtre « ${args.text} » agrandie.`;
        }
        if (act === 'minimize_window' || act === 'minimize') {
          const r = await hostBridge.windowControl({ action: 'minimize', title: args.text });
          return r.message || `Fenêtre « ${args.text} » réduite.`;
        }
        if (act === 'restore_window' || act === 'restore') {
          const r = await hostBridge.windowControl({ action: 'restore', title: args.text });
          return r.message || `Fenêtre « ${args.text} » restaurée.`;
        }
        if (act === 'snap_left' || act === 'snap_right') {
          const r = await hostBridge.windowControl({ action: act, title: args.text });
          return r.message || `Fenêtre ancrée (${act}).`;
        }
        if (act === 'close_window' || act === 'close') {
          const r = await hostBridge.windowControl({ action: 'close', title: args.text });
          return r.message || `Fenêtre « ${args.text} » fermée.`;
        }
        if (act === 'kill_process' || act === 'kill') {
          const r = await hostBridge.windowControl({ action: 'kill', title: args.text });
          return r.message || `Processus « ${args.text} » arrêté.`;
        }
        if (act === 'minimize_all') {
          const r = await hostBridge.windowControl({ action: 'minimize_all' });
          return r.message || 'Toutes les fenêtres ont été réduites.';
        }
        return `Action PC ${act} exécutée.`;
      },
    });

    // 5. Screen Capture & Analysis
    this.register({
      name: 'read_screen',
      description: 'Capturer une image de l’écran du PC pour voir ce qui est affiché ou aider l’utilisateur.',
      parameters: { type: 'OBJECT', properties: {} },
      run: async () => {
        const snap = await hostBridge.captureScreen();
        if (snap.ok && snap.dataUrl) {
          this.ui.onScreenCaptured?.(snap.dataUrl);
          return `Capture d'écran PC effectuée (${snap.width}×${snap.height}).`;
        }
        return 'Capture d’écran effectuée en mode aperçu.';
      },
    });

    // 6. Webcam Capture / Vision Stream
    this.register({
      name: 'camera_look',
      description: 'Prendre une photo avec la webcam du PC ou activer la vision en direct (mode start, stop ou snapshot).',
      parameters: {
        type: 'OBJECT',
        properties: {
          mode: { type: 'STRING', description: 'snapshot (photo unique), start (flux continu) ou stop.' },
          question: { type: 'STRING', description: 'Ce qu’il faut observer avec la webcam.' },
        },
      },
      run: async (args) => {
        const mode = String(args.mode || 'snapshot').toLowerCase();
        if (this.ui.onCameraCommand) {
          return await this.ui.onCameraCommand(mode, args.question);
        }
        return `Webcam PC activée (${mode}).`;
      },
    });

    // 7. Clipboard PC
    this.register({
      name: 'clipboard',
      description: 'Lire le contenu actuel du presse-papiers du PC (action="read") ou y copier du texte (action="write", text="...").',
      parameters: {
        type: 'OBJECT',
        properties: {
          action: { type: 'STRING', description: 'read ou write' },
          text: { type: 'STRING', description: 'Texte à copier dans le presse-papiers.' },
        },
        required: ['action'],
      },
      run: async (args) => {
        if (String(args.action).toLowerCase() === 'write') {
          await hostBridge.writeClipboard(args.text || '');
          return `Texte copié dans le presse-papiers du PC (${(args.text || '').length} caractères).`;
        }
        const res = await hostBridge.readClipboard();
        return res.text
          ? `Contenu du presse-papiers :\n${res.text.slice(0, 2000)}`
          : 'Le presse-papiers est vide.';
      },
    });

    // 8. File Manager (Work Folder PC)
    this.register({
      name: 'file_manager',
      description: 'Gérer les fichiers dans le dossier de travail du PC : action = list, read, write, append, search, mkdir, delete.',
      parameters: {
        type: 'OBJECT',
        properties: {
          action: { type: 'STRING', description: 'list, read, write, append, search, mkdir, delete' },
          path: { type: 'STRING', description: 'Chemin relatif dans le dossier de travail.' },
          content: { type: 'STRING', description: 'Contenu texte (pour write ou append).' },
          query: { type: 'STRING', description: 'Mot-clé (pour search).' },
        },
        required: ['action'],
      },
      run: async (args) => {
        const root = configStore.get().workFolderPath || '';
        const res = await hostBridge.fileOp({
          root,
          action: args.action,
          relPath: args.path || '',
          content: args.content || '',
          query: args.query || '',
        });
        if (!res.ok) return `Erreur fichier : ${res.error}`;
        if (args.action === 'list') {
          const items = res.items || [];
          if (!items.length) return `Le dossier (${res.root}) est vide.`;
          return (
            `Fichiers dans ${res.root} :\n` +
            items.map((i) => `• [${i.type === 'dir' ? 'DOSSIER' : 'FICHIER'}] ${i.name} (${i.size} octets)`).join('\n')
          );
        }
        if (args.action === 'read') {
          return `Contenu de ${args.path} :\n${res.content}`;
        }
        if (args.action === 'search') {
          const matches = res.matches || [];
          return matches.length
            ? `Résultats trouvés :\n${matches.map((m) => `• ${m.path}`).join('\n')}`
            : 'Aucun fichier correspondant.';
        }
        return `Opération fichier « ${args.action} » réussie (${res.path || res.root}).`;
      },
    });

    // 9. Obsidian Vault Tool
    this.register({
      name: 'obsidian',
      description: 'Interagir avec le coffre de notes Obsidian sur le PC : action = daily (ajouter à la note du jour), create (créer une note Markdown), read (lire une note), search (chercher dans les notes).',
      parameters: {
        type: 'OBJECT',
        properties: {
          action: { type: 'STRING', description: 'daily, create, read, search, list' },
          title: { type: 'STRING', description: 'Titre de la note (sans .md).' },
          content: { type: 'STRING', description: 'Contenu Markdown à écrire ou ajouter.' },
          query: { type: 'STRING', description: 'Recherche.' },
        },
        required: ['action'],
      },
      run: async (args) => {
        const vault = configStore.get().obsidianVaultPath || configStore.get().workFolderPath || '';
        const act = String(args.action || 'daily').toLowerCase();
        if (act === 'daily') {
          const today = new Date().toISOString().slice(0, 10);
          const time = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
          await hostBridge.fileOp({
            root: vault,
            action: 'append',
            relPath: `Daily/${today}.md`,
            content: `\n- **${time}** : ${args.content || args.title || ''}`,
          });
          return `Ajouté à la note du jour Obsidian (Daily/${today}.md).`;
        }
        if (act === 'create') {
          const name = `${(args.title || 'Note').replace(/\.md$/i, '')}.md`;
          await hostBridge.fileOp({
            root: vault,
            action: 'write',
            relPath: name,
            content: `# ${args.title || 'Note'}\n\n${args.content || ''}`,
          });
          return `Note Obsidian « ${name} » créée.`;
        }
        if (act === 'read') {
          const name = `${(args.title || '').replace(/\.md$/i, '')}.md`;
          const r = await hostBridge.fileOp({ root: vault, action: 'read', relPath: name });
          return r.ok ? r.content : `Note introuvable : ${name}`;
        }
        const r = await hostBridge.fileOp({ root: vault, action: 'search', query: args.query || args.title || '' });
        return (r.matches || []).length
          ? `Notes Obsidian trouvées :\n${r.matches.map((m) => `• ${m.path}`).join('\n')}`
          : 'Aucune note trouvée.';
      },
    });

    // 10. Create Document (PDF, DOCX, XLSX, CSV, MD, TXT)
    this.register({
      name: 'create_document',
      description: 'Créer et enregistrer un document sur le PC (PDF, Word docx, Excel xlsx, CSV, Markdown md, Texte txt).',
      parameters: {
        type: 'OBJECT',
        properties: {
          type: { type: 'STRING', description: 'pdf, docx, xlsx, csv, md ou txt' },
          title: { type: 'STRING', description: 'Titre du document' },
          content: { type: 'STRING', description: 'Contenu complet en Markdown ou lignes de tableau séparées par |' },
          filename: { type: 'STRING', description: 'Nom du fichier souhaité' },
        },
        required: ['type', 'content'],
      },
      run: async (args) => {
        const res = await createAndSaveDocument(args);
        if (res.ok) {
          return `Document « ${args.title || args.filename || args.type} » créé et enregistré (${res.path}).`;
        }
        return `Erreur lors de la création du document : ${res.error}`;
      },
    });

    // 11. Weather Tool (Open-Meteo + Geocoding)
    this.register({
      name: 'weather',
      description: 'Obtenir la météo actuelle et les prévisions sur 7 jours pour une ville.',
      parameters: {
        type: 'OBJECT',
        properties: {
          city: { type: 'STRING', description: 'Ville (par défaut la ville de l’utilisateur).' },
        },
      },
      run: async (args) => {
        const cfg = configStore.get();
        const city = String(args.city || cfg.userCity || 'Bordeaux').trim();
        let lat = cfg.userLat || 44.8378;
        let lon = cfg.userLon || -0.5792;
        let label = city;

        if (args.city) {
          const geo = await hostBridge.httpFetch(
            `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=fr`
          );
          const first = geo.json?.results?.[0];
          if (first) {
            lat = first.latitude;
            lon = first.longitude;
            label = `${first.name}${first.country ? `, ${first.country}` : ''}`;
          }
        }

        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto`;
        const res = await hostBridge.httpFetch(url);
        if (!res.ok || !res.json?.current) {
          return `Météo indisponible pour ${label}.`;
        }
        const c = res.json.current;
        const d = res.json.daily;
        const nextDays = (d?.time || [])
          .slice(0, 4)
          .map(
            (day, i) =>
              `• ${day} : ${d.temperature_2m_min[i]}°C à ${d.temperature_2m_max[i]}°C (pluie ${d.precipitation_probability_max?.[i] || 0}%)`
          )
          .join('\n');
        return (
          `Météo à ${label} :\n` +
          `• Actuellement : ${c.temperature_2m}°C (ressenti ${c.apparent_temperature}°C), humidité ${c.relative_humidity_2m}%, vent ${c.wind_speed_10m} km/h\n` +
          `• Prévisions :\n${nextDays}`
        );
      },
    });

    // 12. Rain Soon (Minute-by-minute 1h precipitation)
    this.register({
      name: 'rain_soon',
      description: 'Savoir s’il va pleuvoir dans l’heure qui vient (prévisions à 15 minutes).',
      parameters: {
        type: 'OBJECT',
        properties: {
          city: { type: 'STRING', description: 'Ville optionnelle.' },
        },
      },
      run: async (args) => {
        const cfg = configStore.get();
        let lat = cfg.userLat || 44.8378;
        let lon = cfg.userLon || -0.5792;
        let label = args.city || cfg.userCity || 'Bordeaux';
        if (args.city) {
          const geo = await hostBridge.httpFetch(
            `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(args.city)}&count=1&language=fr`
          );
          const first = geo.json?.results?.[0];
          if (first) {
            lat = first.latitude;
            lon = first.longitude;
            label = first.name;
          }
        }
        const res = await hostBridge.httpFetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&minutely_15=precipitation&forecast_minutely_15=4&timezone=auto`
        );
        const vals = res.json?.minutely_15?.precipitation || [];
        const maxRain = Math.max(0, ...vals);
        if (maxRain <= 0.05) {
          return `Aucune pluie prévue dans l’heure à ${label}.`;
        }
        return `Pluie détectée dans l’heure à ${label} : intensité max ${maxRain.toFixed(1)} mm (${vals.map((v) => `${v}mm`).join(' → ')}).`;
      },
    });

    // 13. Air Quality & Pollen
    this.register({
      name: 'air_quality',
      description: 'Indice de qualité de l’air (PM2.5, PM10, NO2, Ozone) et niveaux de pollens (graminées, bouleau, ambroisie, olivier).',
      parameters: {
        type: 'OBJECT',
        properties: {
          city: { type: 'STRING', description: 'Ville (par défaut la ville de l’utilisateur).' },
        },
      },
      run: async (args) => {
        const cfg = configStore.get();
        let lat = cfg.userLat || 44.8378;
        let lon = cfg.userLon || -0.5792;
        let label = args.city || cfg.userCity || 'Bordeaux';
        if (args.city) {
          const geo = await hostBridge.httpFetch(
            `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(args.city)}&count=1&language=fr`
          );
          const first = geo.json?.results?.[0];
          if (first) {
            lat = first.latitude;
            lon = first.longitude;
            label = first.name;
          }
        }
        const res = await hostBridge.httpFetch(
          `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=european_aqi,pm10,pm2_5,nitrogen_dioxide,ozone,grass_pollen,birch_pollen,ragweed_pollen,olive_pollen`
        );
        const c = res.json?.current;
        if (!c) return `Données qualité de l’air indisponibles pour ${label}.`;
        return (
          `Qualité de l’air et pollens à ${label} :\n` +
          `• Indice AQI Européen : ${c.european_aqi} (${c.european_aqi < 25 ? 'Bon' : c.european_aqi < 50 ? 'Correct' : 'Dégradé'})\n` +
          `• Particules fines : PM2.5 = ${c.pm2_5} µg/m³, PM10 = ${c.pm10} µg/m³, NO₂ = ${c.nitrogen_dioxide} µg/m³, O₃ = ${c.ozone} µg/m³\n` +
          `• Pollens : Graminées = ${c.grass_pollen ?? 0} grains/m³, Bouleau = ${c.birch_pollen ?? 0}, Ambroisie = ${c.ragweed_pollen ?? 0}`
        );
      },
    });

    // 14. Fuel Prices (France official open data)
    this.register({
      name: 'fuel_prices',
      description: 'Prix des carburants (Gazole, E10, SP98, E85, GPL) dans les stations-service d’une commune française.',
      parameters: {
        type: 'OBJECT',
        properties: {
          city: { type: 'STRING', description: 'Ville française (ex: Bordeaux, Lyon, Paris, Nantes).' },
          fuel: { type: 'STRING', description: 'Carburant : Gazole, E10, SP98, E85, GPLc (Gazole par défaut).' },
        },
        required: ['city'],
      },
      run: async (args) => {
        const city = String(args.city || 'Bordeaux').trim();
        const fuel = String(args.fuel || 'Gazole').trim();
        const url = `https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records?where=ville%20like%20%22${encodeURIComponent(city)}%22&limit=8`;
        const res = await hostBridge.httpFetch(url);
        const list = res.json?.results || [];
        if (!list.length) return `Aucune station trouvée pour « ${city} ».`;
        const priceKey = `${fuel.toLowerCase()}_prix`;
        const lines = list
          .map((st) => {
            const p = st[priceKey] ?? st.gazole_prix ?? st.e10_prix;
            return p ? `• ${st.adresse} (${st.cp} ${st.ville}) : ${Number(p).toFixed(3)} €/L` : null;
          })
          .filter(Boolean);
        return lines.length
          ? `Stations-service à ${city} (${fuel}) :\n${lines.join('\n')}`
          : `Stations trouvées à ${city}, mais aucun prix affiché pour ${fuel}.`;
      },
    });

    // 15. Web Search
    this.register({
      name: 'web_search',
      description: 'Rechercher une information récente ou factuelle sur le web.',
      parameters: {
        type: 'OBJECT',
        properties: {
          query: { type: 'STRING', description: 'Requête de recherche.' },
        },
        required: ['query'],
      },
      run: async (args) => {
        const q = String(args.query || '').trim();
        if (!q) return 'Requête vide.';
        // Query French Wikipedia + DuckDuckGo Instant Answer API
        const [wikiRes, ddgRes] = await Promise.all([
          hostBridge.httpFetch(
            `https://fr.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&utf8=&format=json&srlimit=4`
          ),
          hostBridge.httpFetch(
            `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`
          ),
        ]);
        const out = [];
        if (ddgRes.json?.AbstractText) {
          out.push(`Résumé : ${ddgRes.json.AbstractText} (${ddgRes.json.AbstractURL || ''})`);
        }
        const searchItems = wikiRes.json?.query?.search || [];
        for (const it of searchItems) {
          const cleanSnippet = String(it.snippet || '').replace(/<[^>]+>/g, '');
          out.push(`• ${it.title} : ${cleanSnippet}`);
        }
        return out.length
          ? `Résultats de recherche pour « ${q} » :\n${out.join('\n')}`
          : `Aucun résultat direct trouvé pour « ${q} ».`;
      },
    });

    // 16. Read Webpage
    this.register({
      name: 'read_webpage',
      description: 'Lire le contenu texte d’une page web à partir de son URL https://.',
      parameters: {
        type: 'OBJECT',
        properties: {
          url: { type: 'STRING', description: 'URL complète commençant par https://' },
        },
        required: ['url'],
      },
      run: async (args) => {
        const res = await hostBridge.httpFetch(args.url, { timeoutMs: 10000 });
        if (!res.ok) return `Impossible de lire ${args.url} (statut ${res.status}).`;
        const plain = String(res.text || '')
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 3500);
        return `Contenu extrait de ${args.url} :\n${plain}`;
      },
    });

    // 17. Open Browser
    this.register({
      name: 'open_browser',
      description: 'Ouvrir une URL ou lancer une recherche Google/YouTube dans le navigateur du PC.',
      parameters: {
        type: 'OBJECT',
        properties: {
          url: { type: 'STRING', description: 'URL ou recherche à ouvrir.' },
        },
        required: ['url'],
      },
      run: async (args) => {
        let target = String(args.url || '').trim();
        if (!/^https?:\/\//i.test(target)) {
          target = `https://www.google.com/search?q=${encodeURIComponent(target)}`;
        }
        await hostBridge.openExternal(target);
        return `Ouverture dans le navigateur du PC : ${target}`;
      },
    });

    // 18. Radio Tool
    this.register({
      name: 'radio',
      description: 'Écouter une radio en direct dans Jarvis (FIP, France Inter, France Info, France Culture, Jazz, Lofi, ou mode sleep pluie/nature/calme) ou arrêter la radio (action="stop").',
      parameters: {
        type: 'OBJECT',
        properties: {
          action: { type: 'STRING', description: 'play, sleep ou stop' },
          query: { type: 'STRING', description: 'Nom de la station ou genre musical (ex: FIP, France Inter, jazz, pluie).' },
          minutes: { type: 'NUMBER', description: 'Durée du minuteur de veille en minutes (pour sleep).' },
        },
        required: ['action'],
      },
      run: async (args) => {
        const act = String(args.action || 'play').toLowerCase();
        if (act === 'stop') {
          this.ui.onOpenMedia?.(null);
          return 'Radio arrêtée.';
        }
        const stations = await searchRadioStations(args.query || 'France Inter', 'FR');
        const st = stations[0];
        if (!st) return `Aucune station trouvée pour « ${args.query} ».`;
        this.ui.onOpenMedia?.({
          mode: 'radio',
          title: st.name,
          subtitle: `${st.tags || 'Direct'} • ${st.country || 'FR'}`,
          url: st.stream,
          paused: false,
          sleepMinutes: act === 'sleep' ? args.minutes || 30 : 0,
        });
        return `Lecture en direct de « ${st.name} » activée dans le lecteur média.`;
      },
    });

    // 19. Podcasts Tool
    this.register({
      name: 'podcasts',
      description: 'Chercher et écouter un podcast en direct dans l’application.',
      parameters: {
        type: 'OBJECT',
        properties: {
          query: { type: 'STRING', description: 'Titre ou sujet du podcast (ex: Affaires sensibles, science, histoire).' },
        },
        required: ['query'],
      },
      run: async (args) => {
        const { podcasts, episodes } = await searchPodcasts(args.query);
        if (episodes.length > 0) {
          const ep = episodes[0];
          this.ui.onOpenMedia?.({
            mode: 'podcast',
            title: ep.title,
            subtitle: ep.podcastTitle || podcasts[0]?.title || 'Podcast',
            url: ep.url,
            paused: false,
          });
          return `Podcast « ${podcasts[0]?.title} » trouvé — lecture de l'épisode « ${ep.title} ».`;
        }
        return `Aucun épisode audio trouvé pour « ${args.query} ».`;
      },
    });

    // 20. YouTube / Play Video Tool
    this.register({
      name: 'play_video',
      description: 'Chercher et lire une vidéo YouTube dans le lecteur vidéo intégré de Jarvis ou contrôler la lecture (action = play, pause, stop).',
      parameters: {
        type: 'OBJECT',
        properties: {
          action: { type: 'STRING', description: 'play, pause, stop' },
          query: { type: 'STRING', description: 'Sujet ou titre de la vidéo à chercher sur YouTube.' },
        },
        required: ['action'],
      },
      run: async (args) => {
        const act = String(args.action || 'play').toLowerCase();
        if (act === 'stop') {
          this.ui.onOpenMedia?.(null);
          return 'Lecteur vidéo fermé.';
        }
        if (act === 'pause') {
          this.ui.onOpenMedia?.((prev) => (prev ? { ...prev, paused: true } : null));
          return 'Lecture mise en pause.';
        }
        const vids = await searchYouTubeVideos(args.query || 'actualités science');
        const v = vids[0];
        if (!v) return `Aucune vidéo trouvée pour « ${args.query} ».`;
        this.ui.onOpenMedia?.({
          mode: 'video',
          title: v.title,
          subtitle: v.uploader,
          embedUrl: v.embedUrl,
          watchUrl: v.watchUrl,
          paused: false,
        });
        return `Lecture de la vidéo « ${v.title} » dans le panneau média.`;
      },
    });

    // 21. Sky View & World Map Tool
    this.register({
      name: 'sky_view',
      description: 'Ouvrir la carte du monde interactive, les orbites satellites, le terminateur jour/nuit et les séismes.',
      parameters: {
        type: 'OBJECT',
        properties: {
          view: { type: 'STRING', description: 'map, sky ou launches' },
          city: { type: 'STRING', description: 'Lieu à centrer sur la carte.' },
        },
      },
      run: async (args) => {
        const cfg = configStore.get();
        let observer = {
          latDeg: cfg.userLat || 44.8378,
          lonDeg: cfg.userLon || -0.5792,
          label: args.city || cfg.userCity || 'Bordeaux',
        };
        if (args.city) {
          const geo = await hostBridge.httpFetch(
            `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(args.city)}&count=1&language=fr`
          );
          const first = geo.json?.results?.[0];
          if (first) {
            observer = { latDeg: first.latitude, lonDeg: first.longitude, label: first.name };
          }
        }
        this.ui.onOpenSpace?.({ mode: args.view === 'sky' ? 'sky' : 'map', observer });
        return `Carte spatiale ouverte sur ${observer.label} (${observer.latDeg.toFixed(2)}°N, ${observer.lonDeg.toFixed(2)}°E).`;
      },
    });

    // 22. Satellites & ISS Tracker
    this.register({
      name: 'satellites',
      description: 'Suivre la Station Spatiale Internationale (ISS), Tiangong ou Hubble en direct et afficher sa position sur la carte du monde.',
      parameters: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', description: 'ISS, Tiangong ou Hubble (ISS par défaut).' },
        },
      },
      run: async (args) => {
        const q = String(args.name || 'ISS').toUpperCase();
        const sat =
          DEFAULT_SATELLITES.find((s) => s.name.toUpperCase().includes(q)) || DEFAULT_SATELLITES[0];
        const now = Date.now();
        const st = satelliteStateAt(sat, now);
        const cfg = configStore.get();
        const obs = {
          latDeg: cfg.userLat || 44.8378,
          lonDeg: cfg.userLon || -0.5792,
          label: cfg.userCity || 'Bordeaux',
        };
        const look = lookAt(obs, st.ecef);
        this.ui.onOpenSpace?.({ mode: 'map', observer: obs });
        return (
          `Position actuelle de ${sat.name} :\n` +
          `• Latitude : ${st.lat.toFixed(2)}°, Longitude : ${st.lon.toFixed(2)}°, Altitude : ${st.altKm.toFixed(0)} km\n` +
          `• Vu depuis ${obs.label} : élévation ${look.elevationDeg.toFixed(1)}°, azimut ${look.azimuthDeg.toFixed(0)}°, distance ${Math.round(look.rangeKm)} km`
        );
      },
    });

    // 23. Night Sky (Stars, Planets, Moon, Constellations)
    this.register({
      name: 'night_sky',
      description: 'Afficher la carte du ciel nocturne (planètes visibles, phase de la Lune, étoiles et constellations) au-dessus de l’utilisateur.',
      parameters: {
        type: 'OBJECT',
        properties: {
          city: { type: 'STRING', description: 'Ville d’observation.' },
        },
      },
      run: async (args) => {
        const cfg = configStore.get();
        const obs = {
          latDeg: cfg.userLat || 44.8378,
          lonDeg: cfg.userLon || -0.5792,
          label: args.city || cfg.userCity || 'Bordeaux',
        };
        const now = Date.now();
        const bodies = solarSystemObjects(obs, now);
        const phase = moonPhase(now);
        this.ui.onOpenSpace?.({ mode: 'sky', observer: obs });
        const visible = bodies
          .filter((b) => b.look.elevationDeg > 0)
          .map((b) => `${b.name} (élév. ${b.look.elevationDeg.toFixed(0)}°, az. ${b.look.azimuthDeg.toFixed(0)}°)`);
        return (
          `Voûte céleste ouverte au-dessus de ${obs.label} :\n` +
          `• Lune : ${phase.name} (${Math.round(phase.lit * 100)}% éclairée)\n` +
          `• Astres au-dessus de l’horizon : ${visible.join(', ') || 'Aucun astre majeur actuellement au-dessus de l’horizon'}`
        );
      },
    });

    // 24. Planes Overhead (OpenSky Network)
    this.register({
      name: 'planes_overhead',
      description: 'Voir les avions en vol actuellement au-dessus de la position de l’utilisateur.',
      parameters: { type: 'OBJECT', properties: {} },
      run: async () => {
        const cfg = configStore.get();
        const lat = cfg.userLat || 44.8378;
        const lon = cfg.userLon || -0.5792;
        const url = `https://opensky-network.org/api/states/all?lamin=${(lat - 1.0).toFixed(2)}&lomin=${(lon - 1.2).toFixed(2)}&lamax=${(lat + 1.0).toFixed(2)}&lomax=${(lon + 1.2).toFixed(2)}`;
        const res = await hostBridge.httpFetch(url, { timeoutMs: 8000 });
        const states = res.json?.states || [];
        if (!states.length) {
          return `Aucun avion détecté immédiatement au-dessus de ${cfg.userCity || 'votre position'} (ou API OpenSky momentanément saturée).`;
        }
        const list = states.slice(0, 6).map((s) => {
          const callsign = String(s[1] || 'Inconnu').trim();
          const country = s[2] || '';
          const altM = Math.round(s[7] || s[13] || 0);
          const speedKmh = Math.round((s[9] || 0) * 3.6);
          return `• Vol ${callsign} (${country}) — Altitude ${altM} m, vitesse ${speedKmh} km/h`;
        });
        return `Avions en vol autour de ${cfg.userCity} (${states.length} détectés) :\n${list.join('\n')}`;
      },
    });

    // 25. Memory Tools (remember_fact, forget_fact, list_memories, clear_memories)
    this.register({
      name: 'remember_fact',
      description: 'Mémoriser une information importante sur l’utilisateur ou ses préférences.',
      parameters: {
        type: 'OBJECT',
        properties: {
          key: { type: 'STRING', description: 'Sujet ou clé du souvenir (ex: café, anniversaire, projet).' },
          value: { type: 'STRING', description: 'Information détaillée à retenir.' },
        },
        required: ['key', 'value'],
      },
      run: async (args) => {
        dataStore.rememberFact(args.key, args.value);
        return `Mémorisé : [${args.key}] = ${args.value}`;
      },
    });

    this.register({
      name: 'forget_fact',
      description: 'Oublier un souvenir enregistré dans la mémoire de Jarvis.',
      parameters: {
        type: 'OBJECT',
        properties: {
          key: { type: 'STRING', description: 'Clé ou sujet à oublier.' },
        },
        required: ['key'],
      },
      run: async (args) => {
        const removed = dataStore.forgetFact(args.key);
        return removed ? `Souvenir « ${args.key} » supprimé.` : `Aucun souvenir trouvé pour « ${args.key} ».`;
      },
    });

    this.register({
      name: 'list_memories',
      description: 'Lister tous les souvenirs enregistrés dans la mémoire à long terme.',
      parameters: { type: 'OBJECT', properties: {} },
      run: async () => {
        const mems = dataStore.get().memories || [];
        if (!mems.length) return 'Aucun souvenir enregistré.';
        return 'Mémoire à long terme :\n' + mems.map((m) => `• ${m.key} : ${m.value}`).join('\n');
      },
    });

    // 26. Task & Shopping Lists
    this.register({
      name: 'tasks',
      description: 'Gérer les listes de tâches et listes de courses : action = list, add, complete, remove, clear.',
      parameters: {
        type: 'OBJECT',
        properties: {
          action: { type: 'STRING', description: 'list, add, complete, remove, clear' },
          list_name: { type: 'STRING', description: 'Nom de la liste (ex: courses, todo, travail).' },
          item: { type: 'STRING', description: 'Élément à ajouter, cocher ou retirer.' },
        },
        required: ['action'],
      },
      run: async (args) => {
        const listName = String(args.list_name || 'todo').toLowerCase().trim();
        const act = String(args.action || 'list').toLowerCase();
        const lists = { ...(dataStore.get().taskLists || {}) };
        const items = [...(lists[listName] || [])];

        if (act === 'add' && args.item) {
          items.push({ id: `t_${Date.now()}`, text: args.item, done: false, createdAt: Date.now() });
          lists[listName] = items;
          dataStore.update({ taskLists: lists });
          return `Ajouté à la liste « ${listName} » : ${args.item}`;
        }
        if (act === 'complete' && args.item) {
          const q = args.item.toLowerCase();
          const target = items.find((i) => i.text.toLowerCase().includes(q));
          if (target) target.done = true;
          lists[listName] = items;
          dataStore.update({ taskLists: lists });
          return target ? `Tâche « ${target.text} » marquée comme terminée.` : `Élément introuvable.`;
        }
        if (act === 'remove' && args.item) {
          const q = args.item.toLowerCase();
          lists[listName] = items.filter((i) => !i.text.toLowerCase().includes(q));
          dataStore.update({ taskLists: lists });
          return `Élément retiré de la liste « ${listName} ».`;
        }
        if (act === 'clear') {
          lists[listName] = [];
          dataStore.update({ taskLists: lists });
          return `Liste « ${listName} » vidée.`;
        }
        if (!items.length) return `La liste « ${listName} » est vide.`;
        return (
          `Liste « ${listName} » :\n` +
          items.map((i) => `• [${i.done ? '✓' : ' '}] ${i.text}`).join('\n')
        );
      },
    });

    // 27. Timers & Alarms
    this.register({
      name: 'set_timer',
      description: 'Démarrer un minuteur (duration_seconds ou minutes), lister les minuteurs (action="list") ou annuler (action="cancel").',
      parameters: {
        type: 'OBJECT',
        properties: {
          action: { type: 'STRING', description: 'start, list, cancel' },
          minutes: { type: 'NUMBER', description: 'Durée en minutes.' },
          seconds: { type: 'NUMBER', description: 'Durée en secondes.' },
          label: { type: 'STRING', description: 'Nom du minuteur (ex: Pâtes, Thé, Pomodoro).' },
        },
      },
      run: async (args) => {
        const act = String(args.action || 'start').toLowerCase();
        const timers = [...(dataStore.get().timers || [])];
        if (act === 'cancel') {
          dataStore.update({ timers: [] });
          return 'Tous les minuteurs ont été annulés.';
        }
        if (act === 'list') {
          const active = timers.filter((t) => t.endsAt > Date.now());
          if (!active.length) return 'Aucun minuteur actif.';
          return active
            .map((t) => `• ${t.label} : reste ${Math.ceil((t.endsAt - Date.now()) / 1000)} s`)
            .join('\n');
        }
        const totalSec = (Number(args.minutes || 0) * 60) + Number(args.seconds || 0) || 60;
        const label = args.label || `Minuteur ${Math.round(totalSec / 60) || 1} min`;
        const timer = {
          id: `tm_${Date.now()}`,
          label,
          durationSec: totalSec,
          endsAt: Date.now() + totalSec * 1000,
        };
        timers.push(timer);
        dataStore.update({ timers });
        return `Minuteur « ${label} » démarré pour ${totalSec} secondes.`;
      },
    });

    // 28. Calendar Events
    this.register({
      name: 'calendar',
      description: 'Consulter les événements de l’agenda (action="list") ou ajouter un rendez-vous (action="add", title, start_iso, location).',
      parameters: {
        type: 'OBJECT',
        properties: {
          action: { type: 'STRING', description: 'list, add, remove' },
          title: { type: 'STRING', description: 'Titre du rendez-vous.' },
          start_iso: { type: 'STRING', description: 'Date/heure ISO (ex: 2026-09-29T14:00).' },
          location: { type: 'STRING', description: 'Lieu ou lien visio.' },
        },
        required: ['action'],
      },
      run: async (args) => {
        const act = String(args.action || 'list').toLowerCase();
        const events = [...(dataStore.get().calendarEvents || [])];
        if (act === 'add' && args.title) {
          const ev = {
            id: `ev_${Date.now()}`,
            title: args.title,
            startIso: args.start_iso || new Date(Date.now() + 3600000).toISOString(),
            location: args.location || '',
          };
          events.push(ev);
          dataStore.update({ calendarEvents: events });
          return `Rendez-vous « ${ev.title} » ajouté à l’agenda (${ev.startIso}).`;
        }
        if (!events.length) return 'Aucun événement prévu à l’agenda.';
        return (
          'Agenda :\n' +
          events
            .map(
              (e) =>
                `• ${new Date(e.startIso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} — ${e.title}${e.location ? ` (${e.location})` : ''}`
            )
            .join('\n')
        );
      },
    });

    // 29. Expenses, Budgets & Subscriptions
    this.register({
      name: 'expenses',
      description: 'Suivre ses dépenses et son budget : action = add (ajouter une dépense), summary (bilan du mois par catégorie), set_budget.',
      parameters: {
        type: 'OBJECT',
        properties: {
          action: { type: 'STRING', description: 'add, summary, set_budget' },
          amount: { type: 'NUMBER', description: 'Montant en euros.' },
          category: { type: 'STRING', description: 'courses, repas, transport, loisirs, logement, autre' },
          label: { type: 'STRING', description: 'Description de la dépense.' },
        },
        required: ['action'],
      },
      run: async (args) => {
        const act = String(args.action || 'summary').toLowerCase();
        const state = dataStore.get();
        const expenses = [...(state.expenses || [])];
        const budgets = { ...(state.budgets || {}) };

        if (act === 'add' && args.amount) {
          const item = {
            id: `ex_${Date.now()}`,
            amount: Number(args.amount),
            category: String(args.category || 'autre').toLowerCase(),
            label: args.label || args.category || 'Dépense',
            date: new Date().toISOString().slice(0, 10),
          };
          expenses.unshift(item);
          dataStore.update({ expenses });
          return `Dépense enregistrée : ${item.amount.toFixed(2)} € (${item.category} — ${item.label}).`;
        }
        if (act === 'set_budget' && args.amount) {
          const cat = String(args.category || 'global').toLowerCase();
          budgets[cat] = Number(args.amount);
          dataStore.update({ budgets });
          return `Budget « ${cat} » fixé à ${Number(args.amount).toFixed(2)} €/mois.`;
        }
        const total = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
        const byCat = {};
        for (const e of expenses) {
          byCat[e.category] = (byCat[e.category] || 0) + Number(e.amount || 0);
        }
        const catLines = Object.entries(byCat)
          .map(([c, val]) => `• ${c} : ${val.toFixed(2)} €${budgets[c] ? ` / budget ${budgets[c]} €` : ''}`)
          .join('\n');
        return `Total des dépenses : ${total.toFixed(2)} € (Budget global : ${budgets.global || 1200} €)\n${catLines}`;
      },
    });

    // 30. Habits Tracker
    this.register({
      name: 'habits',
      description: 'Suivre ses habitudes quotidiennes : action = list, check (cocher une habitude aujourd’hui), add.',
      parameters: {
        type: 'OBJECT',
        properties: {
          action: { type: 'STRING', description: 'list, check, add' },
          name: { type: 'STRING', description: 'Nom de l’habitude.' },
        },
        required: ['action'],
      },
      run: async (args) => {
        const act = String(args.action || 'list').toLowerCase();
        const habits = [...(dataStore.get().habits || [])];
        const today = new Date().toISOString().slice(0, 10);

        if (act === 'add' && args.name) {
          habits.push({ id: `h_${Date.now()}`, name: args.name, streak: 0, history: [] });
          dataStore.update({ habits });
          return `Nouvelle habitude ajoutée : « ${args.name} ».`;
        }
        if (act === 'check' && args.name) {
          const q = args.name.toLowerCase();
          const h = habits.find((x) => x.name.toLowerCase().includes(q));
          if (!h) return `Habitude introuvable : ${args.name}`;
          if (!h.history.includes(today)) {
            h.history.push(today);
            h.streak = (h.streak || 0) + 1;
            dataStore.update({ habits });
          }
          return `Habitude « ${h.name} » validée pour aujourd’hui ! Série actuelle : ${h.streak} jours 🔥.`;
        }
        return (
          'Habitudes quotidiennes :\n' +
          habits
            .map((h) => `• [${h.history?.includes(today) ? '✓' : ' '}] ${h.name} — Série : ${h.streak} j`)
            .join('\n')
        );
      },
    });

    // 31. Send Message (PC adapted: WhatsApp Web/Desktop, Email mailto:, SMS Web)
    this.register({
      name: 'send_message',
      description: 'Envoyer un message depuis le PC via WhatsApp (channel="whatsapp"), Email (channel="email") ou SMS Web.',
      parameters: {
        type: 'OBJECT',
        properties: {
          channel: { type: 'STRING', description: 'whatsapp, email ou sms' },
          recipient: { type: 'STRING', description: 'Nom du contact, numéro de téléphone ou adresse email.' },
          message: { type: 'STRING', description: 'Texte du message.' },
          subject: { type: 'STRING', description: 'Objet (pour un email).' },
        },
        required: ['channel', 'recipient', 'message'],
      },
      run: async (args) => {
        const contacts = dataStore.get().contacts || [];
        const q = String(args.recipient || '').toLowerCase();
        const contact = contacts.find((c) => c.name.toLowerCase().includes(q));
        const ch = String(args.channel || 'whatsapp').toLowerCase();

        if (ch === 'email') {
          const email = contact?.email || args.recipient;
          const url = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(args.subject || 'Message via Jarvis')}&body=${encodeURIComponent(args.message)}`;
          await hostBridge.openExternal(url);
          return `Client mail ouvert sur le PC pour ${email}.`;
        }
        const phone = (contact?.phone || args.recipient).replace(/[^0-9+]/g, '');
        const waUrl = `https://web.whatsapp.com/send?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(args.message)}`;
        await hostBridge.openExternal(waUrl);
        return `WhatsApp PC ouvert avec le message préparé pour ${contact?.name || args.recipient}.`;
      },
    });

    // 32. Change Voice / Avatar
    this.register({
      name: 'change_voice',
      description: 'Changer la voix de Jarvis (30 voix : Aoede, Kore, Leda, Zephyr, Puck, Charon, Fenrir, Orus...) ou changer l’avatar 3D (female01 Léa, male02 Marc, char:adam Adam, char:mei Mei, cartoon, reactor).',
      parameters: {
        type: 'OBJECT',
        properties: {
          voice: { type: 'STRING', description: 'Nom de la voix Gemini.' },
          avatar: { type: 'STRING', description: 'female01, male02, char:adam, char:mei, cartoon, reactor' },
          skin: { type: 'BOOLEAN', description: 'true pour le rendu peau réaliste, false pour le rendu holographique.' },
        },
      },
      run: async (args) => {
        const patch = {};
        if (args.voice) {
          const found = ALL_VOICES.find((v) => v.toLowerCase() === args.voice.toLowerCase());
          if (found) patch.voiceName = found;
        }
        if (args.avatar) {
          if (args.avatar === 'cartoon' || args.avatar === 'reactor') {
            patch.avatarMode = args.avatar;
          } else {
            patch.avatarMode = '3d';
            patch.avatarFaceId = args.avatar;
          }
        }
        if (args.skin !== undefined) patch.avatarSkin = Boolean(args.skin);
        configStore.update(patch);
        return `Configuration mise à jour : Voix = ${configStore.get().voiceName} (${VOICE_DESC[configStore.get().voiceName] || ''}), Avatar = ${configStore.get().avatarFaceId}.`;
      },
    });

    // 33. Wake Briefing (Daily Summary)
    this.register({
      name: 'wake_briefing',
      description: 'Générer le briefing complet de la journée : météo, agenda, tâches, habitudes, dépenses et anniversaires.',
      parameters: { type: 'OBJECT', properties: {} },
      run: async () => {
        const weatherText = await this.execute('weather', {});
        const calText = await this.execute('calendar', { action: 'list' });
        const tasksText = await this.execute('tasks', { action: 'list', list_name: 'todo' });
        const habitsText = await this.execute('habits', { action: 'list' });
        return `📋 Briefing quotidien Jarvis 2.0 :\n\n${weatherText}\n\n${calText}\n\n${tasksText}\n\n${habitsText}`;
      },
    });

    // 34. Smart Home (Home Assistant)
    this.register({
      name: 'smart_home',
      description: 'Contrôler la maison connectée via Home Assistant : action = list, turn_on, turn_off, toggle.',
      parameters: {
        type: 'OBJECT',
        properties: {
          action: { type: 'STRING', description: 'list, turn_on, turn_off, toggle' },
          entity_id: { type: 'STRING', description: 'Identifiant Home Assistant (ex: light.salon, switch.bureau).' },
        },
        required: ['action'],
      },
      run: async (args) => {
        const { haUrl, haToken } = configStore.get();
        if (!haUrl || !haToken) {
          return 'Home Assistant n’est pas encore configuré. Ajoutez son URL et son jeton dans les Réglages > Maison connectée.';
        }
        const base = haUrl.replace(/\/+$/, '');
        const headers = { Authorization: `Bearer ${haToken}`, 'Content-Type': 'application/json' };
        if (args.action === 'list') {
          const r = await hostBridge.httpFetch(`${base}/api/states`, { headers });
          if (!r.ok || !Array.isArray(r.json)) return 'Impossible de joindre Home Assistant.';
          return r.json
            .slice(0, 15)
            .map((e) => `• ${e.entity_id} : ${e.state}`)
            .join('\n');
        }
        const domain = String(args.entity_id || 'light.salon').split('.')[0] || 'homeassistant';
        const service = args.action === 'turn_off' ? 'turn_off' : args.action === 'toggle' ? 'toggle' : 'turn_on';
        const r = await hostBridge.httpFetch(`${base}/api/services/${domain}/${service}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ entity_id: args.entity_id }),
        });
        return r.ok ? `Action ${service} exécutée sur ${args.entity_id}.` : `Erreur Home Assistant (${r.status}).`;
      },
    });

    // 35. Plugins Catalog & Runner (82 bundled JSON plugins!)
    this.register({
      name: 'plugins',
      description: 'Lister, chercher ou exécuter l’un des 82 plugins JSON intégrés (ex: hn_top, arxiv_search, crypto_price, exchange_rate, sncf_disruptions, ratp_traffic, edf_tempo, rte_ecowatt, allocine_cinema, tv_tonight, ligue1_table, f1_standings, wikipedia_summary, apod_nasa, open_food_facts, steam_featured, github_trending...).',
      parameters: {
        type: 'OBJECT',
        properties: {
          action: { type: 'STRING', description: 'run, list, search' },
          name: { type: 'STRING', description: 'Nom du plugin à exécuter ou chercher.' },
          args: { type: 'OBJECT', description: 'Paramètres à passer au plugin.' },
        },
        required: ['action'],
      },
      run: async (args) => {
        await pluginEngine.loadCatalog();
        const act = String(args.action || 'run').toLowerCase();
        const all = pluginEngine.getAllPlugins();
        if (act === 'list') {
          return (
            `Catalogue de ${all.length} plugins disponibles :\n` +
            all.map((p) => `• ${p.name} (${p.title || p.name}) : ${p.description}`).join('\n')
          );
        }
        if (act === 'search') {
          const q = String(args.name || '').toLowerCase();
          const matches = all.filter(
            (p) =>
              p.name.toLowerCase().includes(q) ||
              (p.title || '').toLowerCase().includes(q) ||
              (p.description || '').toLowerCase().includes(q)
          );
          return matches.length
            ? matches.map((p) => `• ${p.name} : ${p.description}`).join('\n')
            : `Aucun plugin trouvé pour « ${args.name} ».`;
        }
        return pluginEngine.runPlugin(args.name, args.args || args, (tName, tArgs) =>
          this.execute(tName, tArgs)
        );
      },
    });

    // 36. End Session
    this.register({
      name: 'end_session',
      description: 'Terminer la conversation vocale en cours.',
      parameters: { type: 'OBJECT', properties: {} },
      run: async () => {
        this.ui.onEndSession?.();
        return 'Session terminée. À bientôt !';
      },
    });
  }
}
