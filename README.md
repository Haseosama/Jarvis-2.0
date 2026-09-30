# JARVIS 2.0 — Édition PC Autonome (Sans Backend)

**Version actuelle : 2.0.13** — la release GitHub est étiquetée à partir de `package.json`. Incrémenter cette version avant toute publication.

Adaptation complète sur PC (Windows / Desktop autonome) de **[Jarvis-Android v0.9.53](https://github.com/Haseosama/Jarvis-Android)**, conçue pour fonctionner en tant qu'exécutable `.exe` autonome sans aucun serveur backend externe.

---

## ✨ Fonctionnalités principales

### 1. 🎭 Avatar 3D Temps Réel & Synchronisation Labiale (60 FPS)
- **Trois visages 3D** : Classique (`84 555 polygones` par défaut), Léa et Marc. Les avatars Cartoon, Adam et Mei ne sont pas inclus.
- **Densité réglable** : sélecteur Éco, Léger, Standard, Haute Définition et Ultra; le compteur de polygones s’actualise sur l’avatar. En mode « Sans cheveux », le résidu de peinture du cuir chevelu est supprimé, sans enlever les détails du visage.
- **Morphologie du Classique inspirée de la référence** : nez et arcade sourcilière plus marqués, mâchoire plus carrée, menton mieux défini et dessous du menton relevé. Les couleurs et les repères des lèvres restent inchangés.
- **Miniature PiP déplaçable** : glisser l’avatar vers n’importe quelle zone de la fenêtre; sa position est mémorisée et reste dans les limites de l’écran.
- **Circuits PCB activables ou désactivables**, styles hologramme/peau, 23 coiffures 3D (`JHR1`), 11 teintes de cheveux et 5 teintes de lèvres.
- **Lip-sync audio-locked** : analyse formantique FFT F1/F2 sur PCM 24 kHz, phonèmes français et synchronisation des visèmes avec l’horloge de lecture audio. La bouche dessine maintenant une cavité animée, les dents et la langue, avec des lèvres mieux lissées en parole et dans la miniature. Le réseau holographique affiche moins de points bleus, tout en gardant ses lignes polygonales.

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
- **Vols en direct** : avions détectés par ADS-B dans un rayon de 250 NM autour du centre de carte (source adsb.fi, repli airplanes.live). Survolez la zone en glissant la carte pour charger un autre secteur.
- **Satellites** : cibles ISS, Tiangong et Hubble, plus un catalogue TLE CelesTrak (stations, navigation, météo, science, Starlink et militaire). Les TLE sont propagés localement par un modèle Kepler/J2 approché; l’ISS utilise aussi sa télémétrie publique en direct.
- **Fiches interactives** : cliquez sur un avion pour consulter télémétrie, immatriculation, type, opérateur, route/trace et sources lorsqu’elles sont disponibles; cliquez sur un satellite pour afficher NORAD, éléments orbitaux, position, altitude, vitesse et visibilité locale.
- **Voûte Céleste Nocturne** (`stars.tsv`, catalogue Yale Bright Star) : dôme polaire interactif avec constellations, Soleil, phase de la Lune et planètes (Mercure, Vénus, Mars, Jupiter, Saturne). À l’ouverture, Jarvis demande la position actuelle pour afficher le ciel observé localement et recentrer la carte; un bouton permet de la mettre à jour.
- **Lancements Spatiaux, Séismes USGS M4.5+ & Aurores Boréales (Kp)**.

### 5. 📻 Radios en Direct, Podcasts & Lecteur Vidéo YouTube
- **Radios en direct** : stations françaises préconfigurées (*France Inter, France Info, FIP, France Culture, France Musique, Mouv'*), annuaire mondial **Radio Browser** et mode **Sommeil** (*Pluie, Nature, SomaFM Drone Zone*) avec minuteur d'extinction.
- **Podcasts** : recherche iTunes France et lecture directe des épisodes RSS.
- **Vidéos & YouTube** : recherche et lecteur intégré dans l'interface.

### 6. ✅ Productivité, Générateur de Documents & 82 Plugins JSON
- **Créateur de Documents sans serveur** (`create_document`) : génération native de fichiers **PDF (`.pdf`)**, **Word (`.docx`)**, **Excel (`.xlsx`)**, **CSV (`.csv`)**, **Markdown (`.md`)** et **Texte (`.txt`)** dans `~/Documents/Jarvis`, plus intégration **Obsidian**.
- **Organisation & Vie quotidienne** : listes de tâches/courses, agenda, minuteurs, dépenses, budgets, abonnements, habitudes (streaks), recettes, suivi de colis, anniversaires, mémoire à long terme, briefing du matin (`wake_briefing`), météo Open-Meteo, pluie dans l'heure, qualité de l'air/pollens et prix des carburants en France.
- **82 Plugins JSON déclaratifs réparés** (`public/assets/plugins/`) : les réponses sont décodées par chemins/collections de résultats, les paramètres manquants sont signalés et les routines Android ont été remplacées par leurs équivalents PC (fenêtres, lecteur multimédia, volume, luminosité, agenda/tâches et minuteurs). Les appels web passent par le pont réseau de l’application, sans serveur backend à installer.

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

### Versionner une nouvelle release

Avant chaque push destiné à publier une nouvelle version, incrémenter `package.json` et `package-lock.json` (par exemple `npm version patch --no-git-tag-version`). Le workflow récupère cette version pour créer le tag et la release GitHub correspondants; les anciennes releases restent disponibles.
