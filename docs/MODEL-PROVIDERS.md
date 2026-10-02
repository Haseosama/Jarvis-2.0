# Studio IA : fournisseurs de modèles, Studio de code, comparateur, arena.ai

## Ce que fait Jarvis
- **Fournisseurs par API officielle** (onglet *Studio IA › Fournisseurs*) : Google Gemini (clés déjà saisies dans les Réglages), OpenAI, Anthropic, OpenRouter, local (Ollama `http://localhost:11434/v1`, LM Studio `http://localhost:1234/v1`) et tout service compatible OpenAI. Chaque clé est chiffrée sur le PC (`safeStorage`) et n'est envoyée qu'au fournisseur concerné. `http://` n'est accepté que pour `localhost`.
- **Studio de code** : conversation multi-tours, fichier joint depuis le *Dossier de travail*, blocs de code avec Copier / Enregistrer (dans le Dossier de travail, confirmation avant remplacement). Jarvis **n'exécute jamais** le code généré.
- **Comparateur** : même invite envoyée en parallèle à 2–4 modèles, latence affichée, mode à l'aveugle, vote « meilleure réponse » et classement Elo stocké localement.
- **Voix / outil** : « ouvre arena.ai », « ouvre le studio de code », « compare les modèles » ; l'outil `ai_studio` permet aussi à Jarvis de poser une question à un modèle externe configuré (réponse marquée comme contenu externe non vérifié).
- **🧠 Cerveau** (onglet *Studio IA › Cerveau*) : un modèle OpenAI, Anthropic, OpenRouter ou local répond **à la place de Gemini REST** aux messages **tapés**, et peut appeler les mêmes outils que Gemini (46 outils : PC, agenda, cartes, Spotify, Smart Home…). Les outils sont traduits en `tools`/`tool_calls` (OpenAI-compatible) ou `tool_use`/`tool_result` (Anthropic), avec au plus 5 tours d'outils par message et des résultats tronqués à 8000 caractères (traités comme données non fiables). Le bouton « Tester » vérifie réponse **et** appel d'outil. En cas d'échec, Jarvis le signale et reprend avec Gemini ; si le modèle local refuse les outils, il est réessayé en texte seul. Réglage stocké dans `llm_v1` (`brain`), clés toujours dans `llmKeys`.

## arena.ai
arena.ai n'a pas d'API publique et ses conditions d'utilisation interdisent l'accès automatisé. Jarvis se limite donc à **ouvrir le site** (fenêtre séparée, profil dédié, sans pont privilégié, permissions refusées) pour un usage **manuel**. Il ne lit pas la session ni les cookies et ne pilote pas la page. Le bouton « Envoyer le code copié à Jarvis » lit simplement le presse-papiers sur votre demande.

## Limites
- La **voix en direct (micro)** et les images jointes restent sur Gemini (Live / REST) : le cerveau externe ne concerne que la saisie clavier. Une clé Gemini reste nécessaire pour parler.
- Le cerveau externe a les mêmes pouvoirs que Gemini sur le PC (souris, fichiers…) : choisissez un modèle de confiance. Les échanges (y compris les résultats d'outils) sont envoyés à ce fournisseur.
- Historique du cerveau externe : 20 derniers messages, texte seul (pas les détails d'outils), conservé jusqu'au redémarrage.
- Pas de réponse en flux continu : la réponse s'affiche une fois complète (délai maximal 120 s).
- Vos invites et fichiers joints sont envoyés au fournisseur choisi ; sa facturation s'applique.
