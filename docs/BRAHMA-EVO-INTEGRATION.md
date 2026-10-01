# Brahma AI Evo → Jarvis : plan d’intégration

État au 1er octobre 2026 : inventaire du dépôt public `titechprabhasolutions/Brahma-Ai-Evo` terminé; phase 1 en cours, avec une première tranche d’observabilité livrée dans Jarvis. Ne pas recopier l’interface PyQt ni lancer Brahma comme une seconde application : conserver l’interface React/Electron de Jarvis et intégrer les capacités par modules.

## Inventaire et recouvrement

| Domaine Brahma Evo | État dans Jarvis PC | Intégration prévue |
|---|---|---|
| Voix Gemini native, webcam et vision écran | Déjà présent (Gemini Live, capture PC, caméra) | Comparer les flux; n’ajouter que les capacités manquantes et les états visuels FFT. |
| Outils Windows : applications, fenêtres, processus, presse-papiers | Contrôle PC et paramètres système déjà présents | Compléter les actions manquantes et améliorer les confirmations/retours d’exécution. |
| Trace visuelle des outils | Intégrée : démarrage/résultat/erreur, durée, paramètres et réponse dans une chronologie inspectable; 12 entrées récentes conservées en mémoire | Masquage des champs secrets, jetons usuels, URI binaires et contenu long; la trace n’inclut que les actions, jamais le raisonnement privé. |
| FFT audio et orb dynamique | Spectre fréquentiel 9 bandes (Goertzel) branché sur le micro et les flux audio sortants; couleurs liées aux états dans la barre de commande | Première tranche de HUD réalisée; vérifier le rendu sur Windows réel et compléter les signaux/états manquants. |
| Skill Forge + Crucible (génération, tests, rechargement à chaud) | Absent | Étape 4 : conception isolée, permissions minimales, dossier de travail dédié, revue et approbation explicites avant activation. |
| Auto-Heal / patch automatique | Absent | Étape 4 : diagnostic et proposition de patch d’abord; aucune modification ou exécution silencieuse. |
| Assembleur de circuits et Circuit HUD | Première intégration : outil `circuit_assembler`, panneau React/SVG (schéma, étapes, avertissements, code Arduino), 3 plans hors ligne (DHT11, HC-SR04, SG90), plans Gemini validés et analyse d’écran à la demande | Valider le rendu dans l’application; ajouter d’autres plans hors ligne et un export SVG/HTML si utile. |
| Globe 3D, itinéraires, radar aérien, POI | Carte 2D, ADS-B, satellites et ciel déjà présents; itinéraires routiers OSRM et recherche de POI OpenStreetMap ajoutés sur la carte existante, avec repli grand cercle si OSRM est indisponible; globe 3D distinct toujours absent | Étape 2 : compléter le globe 3D et l’assemblage de circuits sans dupliquer `SpaceView`. |
| Spotify MCP | Première intégration : OAuth PKCE, jetons chiffrés dans Electron, recherche/lecture, transport, volume, état, appareils, file, écoute récente, titres aimés (lecture) et opérations simples de playlist | Ajouter les opérations album/bibliothèque et l’édition avancée des playlists; valider avec un compte réel. L’app Spotify Developer doit autoriser l’URI loopback indiquée dans Paramètres PC; aucun client secret n’est requis. |
| Word/Excel/PDF/PowerPoint et Google Workspace | Génération PDF/DOCX/XLSX/CSV/MD/TXT déjà présente; PowerPoint et Workspace limités | Étape 2 : PPTX complet, opérations PDF et connecteurs Google avec consentement OAuth. |
| Smart Home Home Assistant/Tuya | Outil `smart_home` unifié : Home Assistant (déjà présent, durci) et Tuya Cloud réel (liste, état, marche/arrêt, bascule, luminosité), confirmation des actions sensibles | Valider avec un compte Tuya et une instance Home Assistant réels; autres fournisseurs de Brahma (Kasa, Hue, LG, Daikin, Nest, SmartThings, Atomberg) non portés. |
| Mémoire longue durée et briefing | Mémoire et briefing déjà présents | Étape 3 : enrichir avec préférences/contextes et opt-in, sans dupliquer les données. |
| Brahma Connect Android, appels, SMS, géolocalisation et batterie | Absent; les fonctions téléphoniques ont été retirées de cette édition PC | Étape 3 : companion Android appairé/authentifié, permissions Android et journal des échanges. |
| Modules annexes (calendrier, réunions, santé, navigateur, Discord, météo, réseaux sociaux, etc.) | Recouvrement variable via outils et plugins Jarvis | Audit action par action avant toute intégration, avec comptes et permissions documentés. |

## Découpage proposé

1. **Fondations d’interface et d’observabilité** — première tranche livrée : trace des appels d’outils, spectre audio 9 bandes/états du HUD, tests d’événements et masquage des secrets. Reste à valider visuellement sur Windows et à compléter les signaux HUD après l’audit détaillé.
2. **Actions quotidiennes** — Spotify MCP livré en première version et tranche itinéraires/POI raccordée à la carte existante; circuit assembler livré en première version; poursuivre avec documents avancés/Google Workspace, globe 3D et connecteurs domotiques.
3. **Contexte et companion** — mémoire/briefing, réunions et Brahma Connect Android avec authentification, pairing et permissions.
4. **Évolution contrôlée** — Skill Forge/Crucible et Auto-Heal; tout code généré est isolé, inspectable, testé sans accès réseau ou système par défaut, et soumis à approbation avant activation/application.

## Première livraison (phase 1)

- `ToolRegistry` émet des événements de début, fin et échec autour de chaque exécution, y compris les appels imbriqués de briefing et de plugins; la vue conserve les 12 entrées les plus récentes et montre durée, paramètres et résultat.
- `src/ui/executionTrace.js` masque les valeurs des champs secrets, jetons usuels et données binaires, puis borne la taille des valeurs affichées. Le panneau ne collecte ni ne présente le raisonnement privé.
- `src/audio/AudioSpectrum.js` calcule neuf bandes fréquentielles Goertzel à faible coût; le HUD s’alimente du micro et de l’audio sortant.
- Tests de non-divulgation, cycle de vie des outils et spectre ajoutés à `tests/jarvis.test.js`.

## Deuxième livraison (phase 2 — Spotify MCP)

- `src/integrations/spotifyClient.js` implémente OAuth Authorization Code + PKCE sans client secret, renouvellement des jetons, recherche, lecture, commandes transport/volume, état en cours, appareils Connect, file, playlists, historiques et titres aimés.
- `electron/main.cjs` ouvre un callback HTTP limité à `127.0.0.1:43821`; le client ID est une configuration publique et les jetons sont stockés via le coffre Electron. L’URI exacte à autoriser dans le tableau de bord Spotify est affichée dans Paramètres > PC.
- `spotify_controller` est disponible au moteur d’outils et les commandes vocales locales en français reconnaissent recherche/lecture, pause/reprise, suivant/précédent, volume, playlists et état de lecture.
- La définition de l’outil demande explicitement l’intention de l’utilisateur pour créer/modifier une playlist; ce rappel n’est pas encore un verrou d’approbation technique. La connexion réelle exige un Client ID Spotify et reste à valider avec un compte développeur/utilisateur.

## Tranche géospatiale (routes et POI)

- `src/space/GeoNavigation.js` géocode les villes via Open-Meteo, demande des routes routières à OSRM et affiche la géométrie routière sur le `SpaceView` existant; si le service routier échoue, seule la distance/ligne grand cercle est annoncée, sans durée de conduite inventée.
- La recherche de restaurants, pharmacies, santé, hôtels, carburant, banques, supermarchés, parkings et lieux touristiques utilise Overpass, avec repli Nominatim; rayon borné à 1–25 km, résultats dédoublonnés et ordonnés par distance.
- L’outil `geospatial` est disponible en appel direct et via les intentions vocales françaises d’itinéraire et de lieux à proximité. L’utilisateur voit la ligne routière, les repères cliquables, les coordonnées et les sources OpenStreetMap dans la carte; aucune deuxième carte n’a été ajoutée.
- Chaque recherche transmet le lieu demandé au service cartographique public; les résultats restent des données externes non fiables. La suite géospatiale peut ajouter un globe 3D séparé, mais ne remplace pas les vues existantes.
- Validation locale : `npm test` (42 tests) et `npm run build` passent; le build conserve l’avertissement existant sur la taille du chunk (supérieur à 500 kB).

## Tranche matériel (assembleur de circuits)

- `src/hardware/circuitAssembler.js` porte les plans DHT11, HC-SR04 et SG90 de Brahma en français, avec brochage, avertissements de tension et code Arduino, disponibles hors ligne.
- Pour les autres montages, Gemini (clé déjà configurée) renvoie un plan JSON. Il est traité comme donnée non fiable : composants, broches, fils, couleurs (`#rrggbb` uniquement) et tailles sont validés; les fils vers des broches inconnues sont écartés; un rappel de vérification électrique est toujours ajouté. Le code Arduino est affiché, jamais exécuté.
- `analyze_screen` n’envoie une capture d’écran à Gemini que sur demande explicite (« regarde les composants sur mon écran »); le plan est alors étiqueté « à vérifier ».
- `CircuitPanel` affiche le schéma SVG avec navigation par étapes, avertissements, étapes et copie du code. Tests : validité des plans, nettoyage d’un plan hostile, routage des commandes françaises (45 tests au total).
- Non vérifié : rendu visuel dans Electron/navigateur et reconnaissance réelle de composants sur capture.

## Tranche Office/PDF (génération de documents)

- `src/actions/officeFormats.js` (pur, sans dépendance npm) : ZIP, PDF multi-pages (table xref valide, accents WinAnsi, retour à la ligne, tableaux, code, pied de page numéroté), DOCX (styles, tableaux), XLSX multi-feuilles (colonnes au-delà de Z, en-tête stylé, filtre, volet figé), CSV protégé contre l'injection de formules, PPTX complet (7 thèmes dont `clean`, couverture, tableaux, deux colonnes, diapositives « (suite) »).
- `documentGenerator.js` s'appuie sur ce module; l'ancien « .pptx » (en réalité du texte) et le PDF mono-page sans accents sont remplacés. Le type `pptx` est disponible dans le panneau Productivité, l'outil `create_document` (paramètres `theme`, `subtitle`, `slides`, `sheets`) et par commande vocale (« crée une présentation sur… »).
- Sécurité : formules XLSX dangereuses (HYPERLINK, WEBSERVICE, références externes…) écrites comme texte; extensions limitées à pdf/docx/xlsx/pptx/csv/md/txt dans le processus principal Electron; un document existant n'est plus écrasé (suffixe `_2`, `_3`…).
- Vérification : fichiers générés relus avec python-pptx, python-docx, openpyxl et pypdf, rendu PDF contrôlé en image; 6 tests ajoutés.
- Non porté : téléchargement de modèles PowerPoint depuis le web, notes de présentation, fusion/découpe/extraction de PDF (nécessiteraient un parseur PDF), rendu PPTX/DOCX/XLSX dans PowerPoint ou LibreOffice (non disponibles ici).

## Tranche domotique (Tuya Cloud + Home Assistant)

- Constat d'audit : le `TuyaProvider` de Brahma est une simulation (il renvoie un faux appareil « Study Room Plug » sans appel réseau). Il n'a donc pas été copié; Jarvis implémente le vrai protocole Tuya Cloud OpenAPI.
- `src/integrations/tuyaClient.js` : signature HMAC-SHA256 de Tuya (reproduit les deux vecteurs de test officiels), jeton mis en cache, liste des appareils liés au projet, état, jeu de fonctions, commandes; régions Europe centrale/Ouest, États-Unis, Inde, Chine. L'Access Secret n'est stocké que par `setSecret` (chiffré par Electron), jamais dans la configuration persistée.
- `src/integrations/smartHome.js` : outil `smart_home` (actions `list`, `status`, `turn_on`, `turn_off`, `toggle`, `set_brightness`; `provider` auto/home_assistant/tuya) avec résolution des noms français sans accent (« la lumière du salon »), refus en cas d'ambiguïté, appareils hors ligne signalés.
- Sécurité : volets, serrures et portes de garage (Home Assistant `cover`/`lock`, catégories Tuya correspondantes) exigent `confirmed=true` après accord explicite; les alarmes ne sont jamais armées/désarmées. L'ancien outil agissait sur `light.salon` par défaut quand aucun appareil n'était indiqué : il demande maintenant de préciser l'appareil.
- Interface : réglages Tuya (Access ID, secret, centre de données, test de connexion) dans Paramètres > Système PC & Domotique; intentions locales « allume/éteins la lumière/lampe/prise… » et « liste mes appareils connectés ».
- Vérification : 6 tests (vecteurs de signature, flux client simulé, appariement de noms, Home Assistant, Tuya, intentions); build OK.
- Non vérifié : appels réels à Tuya Cloud (le code de liste via `/v1.0/iot-01/associated-users/devices` suppose un compte Smart Life lié) et à une instance Home Assistant; rendu des nouveaux réglages. Hors périmètre : API locale Tuya sans cloud, découverte réseau.
- Remarque : le jeton Home Assistant existant (`haToken`) reste enregistré aussi dans la configuration locale; à migrer vers le stockage chiffré dans une tranche ultérieure.

## Tranche Spotify (bibliothèque et playlists)

- `src/integrations/spotifyLibrary.js` : albums (consultation, enregistrement, retrait), titres aimés (API de bibliothèque unifiée `/me/library`), vérification « déjà enregistré ? », playlists avancées (détails, titres, renommage, ordre, retrait de titres, suppression = désabonnement) et top titres/artistes. Références acceptées : ID, URI ou URL; `playlist_name` insensible aux accents.
- Sécurité : toute suppression exige `confirmed=true`. Les nouveaux scopes (dont `user-top-read`) nécessitent de **reconnecter Spotify** dans les Réglages.
- Non vérifié : parcours réel avec un compte Spotify; forme exacte de `GET /me/playlists` et de `GET /me/top/{type}` (code défensif).

## Tranche Google Workspace (Gmail, Agenda, Drive)

- Constat d'audit : le « Drive » et l'« Agenda Google » de Brahma sont locaux; Jarvis appelle les vraies API Google.
- `src/integrations/googleClient.js` : OAuth « application de bureau » (PKCE, callback `http://127.0.0.1:43822/google/callback`), rafraîchissement automatique après 401, révocation, `googleRequest` limité aux hôtes Google. Le Client ID/Secret viennent du projet Google Cloud de l'utilisateur (Réglages > Google); le secret passe par `setSecret`.
- `src/integrations/googleWorkspace.js` : outil `google_workspace` — Gmail (liste, non lus, recherche, lecture, brouillon, envoi), Agenda (liste, création, suppression), Drive (recherche, lecture, dépôt de texte). Envoi de mail, suppression d'événement et dépôt Drive exigent `confirmed=true`; le contenu lu est signalé « Contenu externe non vérifié » (anti-injection).
- Intentions vocales : « mes mails non lus », « agenda Google demain », « cherche X dans mon Drive » (le mot « Google » est requis pour ne pas détourner l'agenda local).
- Limite connue : tant que le projet Google Cloud est en mode « Test », le jeton de rafraîchissement expire au bout de ~7 jours (reconnexion nécessaire).
- Non vérifié : OAuth et appels réels (Gmail/Calendar/Drive), rendu des réglages.

## Tranche Skill Forge / Crucible et Auto-Heal

- Constat d'audit : le Crucible de Brahma se limite à un scan de chaînes interdites, installe des paquets pip automatiquement, exécute le code généré dans un sous-processus de l'hôte et l'active sans revue. Ce modèle n'a **pas** été reproduit.
- `electron/skillSandbox.cjs` : exécution dans un `worker_threads` + contexte V8 `vm` vierge (aucun objet hôte, `eval`/`Function`/`import()` désactivés, délai d'exécution + arrêt forcé du worker, limites de mémoire/pile, sortie plafonnée à 20 000 caractères). IPC `jarvis:skill-run`; hors application PC, la fonction est indisponible. Isolation de calcul, pas un bac à sable au niveau du système : d'où l'approbation obligatoire.
- `src/skills/skillForge.js` : synthèse par Gemini (`function execute(args)` synchrone + cas de test), scan statique, Crucible (syntaxe + tests dans le bac à sable), jusqu'à 2 réparations automatiques, stockage en statut **en attente**, versions et retour arrière. Compétences de calcul pur uniquement (pas de réseau ni de fichiers).
- Approbation : uniquement depuis l'onglet **🧪 Compétences** (`SkillPanel.jsx` : code, résultats des tests, Approuver, Relancer, Correctif, Version précédente, Supprimer). L'outil `skill_forge` (forge/list/show/run) ne peut ni approuver ni restaurer; `run` refuse toute compétence non approuvée.
- Auto-Heal (`src/skills/autoHeal.js`, outil `auto_heal`) : diagnostic heuristique en français des erreurs d'outils récentes (journal masqué des secrets dans `ToolRegistry.recentFailures`), analyse Gemini optionnelle (`use_ai`), et proposition de correctif pour une compétence forgée (nouvelle version repassée au Crucible, appliquée seulement après approbation, ancienne version conservée). Contrairement à Brahma, Jarvis ne réécrit jamais ses propres fichiers installés.
- Intentions : « forge une compétence qui… », « répare la compétence X », « diagnostique la dernière erreur », « liste mes compétences ».
- Vérification : sandbox testé sous Node (échappements `constructor`/`eval`, boucle infinie, mémoire, pollution de prototype, sortie volumineuse); 8 tests.
- Non vérifié : synthèse Gemini réelle, rendu du panneau, exécution du worker dans le binaire Electron packagé.

## Tranche globe 3D

- Constat d'audit : `geospatial_globe.py` de Brahma n'est qu'un moteur de données (géocodage, grand cercle, OSRM, vols OpenSky, ISS, séismes, POI, météo). Jarvis possède déjà ces services (`GeoNavigation`, `TrackingService`, `SpaceEngine`); ils sont réutilisés, pas recopiés.
- `src/space/GlobeView.jsx` (three.js) : vue distincte « 🌐 Globe 3D » avec contours des terres et frontières (mêmes fichiers `land.bin`/`borders.bin`), terminateur jour/nuit réel, satellites (orbites modélisées), séismes USGS, avions ADS-B autour de la position, capitales, repères et itinéraires de l'outil `geospatial`, rotation/zoom, sélection d'un point. `src/space/globeGeometry.js` regroupe la géométrie pure (testée).
- Ouverture : bouton de navigation, `sky_view` avec `view=globe`, `geospatial` avec `view=globe`, commandes « montre le globe (sur Tokyo) ».
- Vérification : 4 tests (projection, anneaux réels de `land.bin`/`borders.bin` valides, visibilité/sélection, outils/intentions); build OK.
- Non vérifié : rendu WebGL réel (aucun navigateur disponible ici), performances sur machines modestes.

## Créateur de personnage (remplace l'avatar Haseo)

- Demande utilisateur : retirer Haseo et proposer, sur le visage Classique, une création de personnage façon jeu vidéo. Le modèle FBX, ses yeux, sa texture procédurale et leurs tests/assets ont été supprimés; un `avatarFaceId` « haseo » déjà enregistré retombe sur Classique.
- `src/avatar/FaceCustomizer.js` : 20 curseurs [-1, 1] (Visage, Yeux, Nez, Bouche) convertis en un champ de déplacement lisse appliqué à tous les sommets (peau, globes oculaires, intérieur de bouche, cheveux intégrés). Les pivots d'animation `eyeCentre`/`lipCentre` suivent; les globes oculaires restent rigides dans les paupières; la zone entre les yeux ne se déchire pas quand les yeux se rapprochent. Couleurs/peinture inchangées. Les coiffures s'ajustent sur le visage modifié (ce qui corrige aussi l'ancien usage du maillage non affiné lorsqu'une coiffure ou une teinte était choisie).
- `src/ui/AvatarCreator.jsx` : aperçu en direct (anti-rebond, qualité Standard), onglets, curseur par paramètre avec ↺ et double-clic, 6 préréglages, aléatoire, 8 emplacements « Mes looks », Appliquer/Annuler (Échap). Accès : « 🎨 Créer mon visage », Réglages, outil `avatar_creator` (open/preset/random/reset) et commandes vocales. Stockage : `avatarCustom` et `avatarCustomSlots` dans `ConfigStore` (valeurs normalisées).
- Vérification : rendu logiciel du maillage (face/profil) pour chaque curseur à ±1 (deux défauts corrigés : déchirure du pont du nez, pli du front par la longueur du nez); 7 tests (bornes, direction de chaque trait, rigidité des yeux, absence de triangles retournés sur visages réalistes, coiffure + niveaux de polygones + lip-sync, outil et voix).
- Limite : les 20 curseurs au minimum simultanément retournent environ 1,4 % des triangles de peau (cas extrême, non réaliste). Non vérifié : rendu réel dans l'interface (aucun navigateur ici), sensation d'usage des curseurs.

## Conditions transversales

- Jarvis reste une application Electron/React autonome, avec ses ponts IPC existants; pas de serveur public ou backend requis par défaut.
- Ne pas importer un deuxième runtime graphique. Les dépendances Python lourdes (vision, audio, Android) ne sont ajoutées qu’après étude d’un port JS ou d’un sidecar local explicitement contrôlé.
- Les fonctions nécessitant des comptes (Gemini, Spotify, Google, Tuya, Instagram) demandent une configuration sûre et un consentement clair; secrets stockés via `hostBridge`/Electron, jamais dans le dépôt.
- Tester chaque phase sous Node, puis valider sur Windows réel pour les fonctions OS, audio, Android et domotique.
