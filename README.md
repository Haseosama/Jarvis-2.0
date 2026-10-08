# JARVIS 2.0 — Édition PC Autonome (Sans Backend)

**Version actuelle : 2.0.40** — la release GitHub est étiquetée à partir de `package.json`. Incrémenter cette version avant toute publication.

Adaptation complète sur PC (Windows / Desktop autonome) de **[Jarvis-Android v0.9.53](https://github.com/Haseosama/Jarvis-Android)**, conçue pour fonctionner en tant qu'exécutable `.exe` autonome sans aucun serveur backend externe.

---

## ✨ Fonctionnalités principales

### 1. 🎭 Avatar 3D Temps Réel & Synchronisation Labiale (60 FPS)
- **Trois visages 3D** : Classique (`84 555 polygones` par défaut), Léa et Marc. Le modèle Haseo a été retiré au profit du **créateur de personnage** du Classique. Les avatars Cartoon, Adam et Mei ne sont pas inclus.
- **🎨 Créateur de personnage (Classique)** : comme dans un jeu vidéo, 20 curseurs répartis en Visage (largeur, hauteur, front, arcades, sourcils, joues, pommettes, mâchoire, menton), Yeux (taille, écartement, hauteur, inclinaison), Nez (largeur, longueur, saillie) et Bouche (largeur, lèvres, position), avec aperçu en direct, 6 préréglages, tirage aléatoire, 8 emplacements « Mes looks » et réinitialisation. Les couleurs, la peau, les circuits, les coiffures et le lip-sync suivent la nouvelle morphologie. Ouvrir via « 🎨 Créer mon visage », les Réglages ou la voix (« ouvre le créateur de personnage »).
- **Densité réglable** : sélecteur Éco, Léger, Standard, Haute Définition et Ultra; le compteur de polygones s’actualise sur l’avatar. En mode « Sans cheveux », le résidu de peinture du cuir chevelu est supprimé, sans enlever les détails du visage.
- **Morphologie du Classique inspirée de la référence** : joues moins rondes, angles de mâchoire plus nets, menton mieux défini et dessous du menton relevé; forme du nez et palette conservées.
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
- **📱 Contrôle depuis le téléphone (2.0.32)** : Jarvis Android pilote ce PC par la voix (« sur le PC, ouvre Chrome », « mets le PC en veille »). Activer dans 🖥️ Poste de Contrôle PC → « Appairer un téléphone », puis scanner le QR code dans l’app Android (Réglages > Jarvis PC) ou taper l’adresse et le code à 6 caractères (valable 10 minutes, une seule fois). L’ordre est traité comme un message tapé dans Jarvis 2.0, qui répond aussi sur le téléphone. Serveur HTTPS local sur le port 8000 (`electron/remoteServer.cjs`, sans dépendance) avec un certificat fabriqué une fois sur ce PC, que le téléphone épingle ; ordres chiffrés en AES-256 ; le téléphone reste appairé après un redémarrage (seule l’empreinte de son jeton est gardée), « Oublier les téléphones » les révoque tous. Même protocole que le tableau de bord de Mark-LIV. Au premier démarrage, Windows demande d’autoriser Jarvis 2.0 sur les réseaux privés : accepter.
- **🌐 Navigateur piloté par Playwright (2.0.33)** : outil `navigateur` : Jarvis ouvre un vrai navigateur sur ce PC (Edge, sinon Chrome, déjà installés ; fenêtre visible ; profil à part dans les données de Jarvis qui garde les connexions), lit la page avec ses éléments numérotés, clique, remplit les formulaires, appuie sur des touches, fait défiler, revient en arrière, change d’onglet et fait une capture. Utilisable par la voix sur le PC et depuis Jarvis Android appairé (`POST /api/browser`, même chiffrement que les ordres). `electron/browserControl.cjs`, paquet `playwright-core` (aucun navigateur téléchargé ; `JARVIS_BROWSER` = chemin d’un autre exécutable Chromium).
- **🎨 Images créées sur ce PC (2.0.36 à 2.0.40)** : outil `generate_image`, commande `/image description` dans le chat écrit (la demande part directement au générateur, sans passer par l’assistant) et onglet **Studio IA › 🎨 Images**. Le contenu adulte (personnages fictifs adultes) dépend du réglage **« Images créées sur ce PC (ComfyUI) »** des Réglages, désactivé par défaut ; toute demande qui vise un enfant ou un mineur est toujours refusée. Qualité (2.0.40) : sampler DPM++ 2M SDE Karras, invite négative anti-défauts, styles Photo / Anime / Brut, passe **HD** facultative (agrandissement ×1,4 puis raffinage), choix du modèle, graine fixe, 1 à 4 images et variations dans Studio IA › Images. Les refus propres au modèle d’IA du chat ne sont pas contournés.
- **🎨 Images pour Jarvis Android (2.0.34)** : Jarvis Android appairé peut demander une image (`POST /api/image`, même chiffrement que les ordres). Jarvis 2.0 la fait créer par un générateur sur ce PC. **Sans rien d’installé**, Jarvis installe lui-même ComfyUI (bouton « Installer le générateur d’images » dans Contrôle depuis le téléphone, ou « installe le générateur d’images » depuis le téléphone) : 7zr.exe de 7-zip.org, ComfyUI portable pour Windows (variante NVIDIA, AMD ou Intel Arc selon la carte graphique) et le modèle Juggernaut XL v9 (RunDiffusion, CreativeML OpenRAIL-M), environ 9 Go dans le dossier `images-ia` des données de Jarvis ; il lance ComfyUI caché sur 127.0.0.1:8188 à la première image et l’arrête en quittant (`electron/imageInstall.cjs`). Sinon il trouve tout seul un générateur déjà installé : **Fooocus** par Fooocus-API (port 8888), **ComfyUI** (port 8188, premier modèle de `models/checkpoints`, ou `JARVIS_COMFY_MODEL`), ou **Stable Diffusion WebUI Forge / AUTOMATIC1111** lancé avec `--api` (port 7860) ; `JARVIS_SD_URL` pour une autre adresse. Seul du texte entre (aucune photo). Le contenu adulte n’est permis que si le téléphone l’a activé ; toute demande qui parle d’enfant ou de mineur est refusée et l’invite négative écarte toujours les corps juvéniles. `electron/imageGen.cjs`.
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
