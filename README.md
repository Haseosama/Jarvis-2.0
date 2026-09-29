# JARVIS 2.0 — Édition PC Autonome (Sans Backend)

Adaptation complète sur PC (Windows / Desktop autonome) de **[Jarvis-Android v0.9.53](https://github.com/Haseosama/Jarvis-Android)**, conçue pour fonctionner en tant qu'exécutable `.exe` autonome sans aucun serveur backend externe.

---

## ✨ Fonctionnalités principales

### 1. 🎭 Avatar 3D Temps Réel & Synchronisation Labiale (60 FPS)
- **Visages & Bustes 3D** :
  - **Léa** (`head_mesh_lea.bin` — maillage 3D `JHM2` avec suivi du regard, paupières, sourcils, mâchoire)
  - **Marc** (`head_mesh_marc.bin` — maillage 3D `JHM2` masculin)
  - **Adam & Mei** (`characters/adam`, `characters/mei` — bustes 3D texturés `JCH1`/`JCH2` avec atlas WebP)
  - **Classique**, **Cartoon 2D Expressif** et **Réacteur HUD**
- **23 Coiffures 3D (`JHR1`) & 10 Teintes de Cheveux** : adaptation radiale sur le crâne (`fitOn`), physique ressort (`HoloAvatar`) et recoloration dynamique.
- **2 Styles de rendu** : **Hologramme Cyan** (filaire + surface + balayage) ou **Peau 3D réaliste** avec éclairage et maquillage.
- **Lip-Sync Temps Réel** : analyse formantique FFT F1/F2 sur flux audio PCM 24 kHz (`pcmVisemes`) et génération phonétique française (`textToVisemes`).

### 2. 🎙️ Voix Gemini Live (24 kHz), ModelLadder REST & Moteur Local Hors-Ligne
- **Gemini Live WebSocket** (`BidiGenerateContent`) : flux audio bidirectionnel temps réel (entrée micro 16 kHz PCM16, sortie 24 kHz PCM16) avec appel d'outils en direct.
- **30 Voix Gemini** : *Aoede, Kore, Leda, Zephyr, Puck, Charon, Fenrir, Orus, Callirrhoe, Despina, Schedar, Sulafat...*
- **Rotation automatique de 3 clés API Gemini** et **ModelLadder REST** (`gemini-2.5-flash` → `gemini-2.5-flash-lite` → `gemini-2.0-flash`).
- **Moteur d'intentions local** : fonctionne immédiatement **même sans clé API**, avec synthèse vocale PC et lip-sync 3D.

### 3. 🖥️ Contrôle PC Complet & Vision (Adaptation Desktop des outils mobiles)
- **Applications PC** (`open_app`) : lancement direct de Chrome, Edge, Firefox, VS Code, Explorateur, Terminal, Calculatrice, Bloc-notes, Spotify, WhatsApp, Discord, Office, etc.
- **Contrôle Souris / Clavier / Fenêtres** (`pc_control`) : clics, déplacement, molette, frappe clavier automatisée, raccourcis (`Ctrl+C`, `Alt+Tab`, `Win+D`), liste et focus des fenêtres Windows via Win32/PowerShell natif.
- **Réglages Système PC** (`device_settings`) : volume (0-100 %), muet, luminosité, touches média, verrouillage de session Windows, mise en veille, panneaux de configuration Windows.
- **Vision PC** (`read_screen`, `camera_look`) : capture d'écran du bureau PC et flux Webcam en direct.
- **Messagerie PC** (`send_message`) : WhatsApp Web/Desktop et client mail PC (`mailto:`).
- *Note : les fonctions strictement téléphoniques (Android Auto, Retrouver le téléphone, SOS) ont été retirées.*

### 4. 🌍 Espace, Voûte Céleste & Carte du Monde Interactive
- **Carte vectorielle mondiale** (`land.bin`, `borders.bin`, `cities.tsv`) avec zoom/déplacement, terminateur Jour/Nuit en temps réel et position sub-solaire.
- **Suivi Orbital Temps Réel** : **ISS (Zarya)**, **Tiangong (CSS)** et **Hubble** avec traces au sol et empreinte de visibilité.
- **Voûte Céleste Nocturne** (`stars.tsv`, catalogue Yale Bright Star) : dôme polaire interactif avec constellations, Soleil, phase de la Lune et planètes (Mercure, Vénus, Mars, Jupiter, Saturne).
- **Lancements Spatiaux, Séismes USGS M4.5+ & Aurores Boréales (Kp)**.

### 5. 📻 Radios en Direct, Podcasts & Lecteur Vidéo YouTube
- **Radios en direct** : stations françaises préconfigurées (*France Inter, France Info, FIP, France Culture, France Musique, Mouv'*), annuaire mondial **Radio Browser** et mode **Sommeil** (*Pluie, Nature, SomaFM Drone Zone*) avec minuteur d'extinction.
- **Podcasts** : recherche iTunes France et lecture directe des épisodes RSS.
- **Vidéos & YouTube** : recherche et lecteur intégré dans l'interface.

### 6. ✅ Productivité, Générateur de Documents & 82 Plugins JSON
- **Créateur de Documents sans serveur** (`create_document`) : génération native de fichiers **PDF (`.pdf`)**, **Word (`.docx`)**, **Excel (`.xlsx`)**, **CSV (`.csv`)**, **Markdown (`.md`)** et **Texte (`.txt`)** dans `~/Documents/Jarvis`, plus intégration **Obsidian**.
- **Organisation & Vie quotidienne** : listes de tâches/courses, agenda, minuteurs, dépenses, budgets, abonnements, habitudes (streaks), recettes, suivi de colis, anniversaires, mémoire à long terme, briefing du matin (`wake_briefing`), météo Open-Meteo, pluie dans l'heure, qualité de l'air/pollens et prix des carburants en France.
- **82 Plugins JSON déclaratifs** (`public/assets/plugins/`) : *SNCF, RATP, EDF Tempo, RTE EcoWatt, Vigicrues, Allociné, Programme TV, Ligue 1, Top 14, Formule 1, Hacker News, ArXiv, PubMed, NASA APOD, Crypto, Taux de change, Wikipédia, OpenFoodFacts, Steam, GitHub Trending...*

---

## 🚀 Installation & Compilation en `.exe` (Windows)

### Prérequis
- Node.js 20+ (pour compiler depuis les sources)

### 1. Lancer en mode développement / aperçu
```bash
npm install
npm run dev
```

### 2. Générer l'installateur Windows `.exe` (Electron NSIS autonome)
Sur Windows (ou via le workflow GitHub Actions `.github/workflows/build-exe.yml`) :
```bash
npm install
npm run dist:win
```
L'installateur autonome **`out/Jarvis-2.0-Setup.exe`** est généré et installe Jarvis 2.0 avec raccourci Bureau et menu Démarrer.

### 3. Générer le package Windows Portable (Sans Backend)
```bash
npm run build:exe
```
Génère le dossier **`release/Jarvis-2.0-Windows-Portable/`** contenant `Lancer-Jarvis-2.0.bat` qui compile et exécute automatiquement **`Jarvis-2.0.exe`** avec le compilateur natif Windows (`csc.exe`), sans aucun serveur externe requis.
