# Studio IA : fournisseurs de modèles, Studio de code, comparateur, arena.ai

## Ce que fait Jarvis
- **Fournisseurs par API officielle** (onglet *Studio IA › Fournisseurs*) : Google Gemini (clés déjà saisies dans les Réglages), OpenAI, Anthropic, OpenRouter, local (Ollama `http://localhost:11434/v1`, LM Studio `http://localhost:1234/v1`) et tout service compatible OpenAI. Chaque clé est chiffrée sur le PC (`safeStorage`) et n'est envoyée qu'au fournisseur concerné. `http://` n'est accepté que pour `localhost`.
- **Studio de code** : conversation multi-tours, fichier joint depuis le *Dossier de travail*, blocs de code avec Copier / Enregistrer (dans le Dossier de travail, confirmation avant remplacement). Jarvis **n'exécute jamais** le code généré.
- **Comparateur** : même invite envoyée en parallèle à 2–4 modèles, latence affichée, mode à l'aveugle, vote « meilleure réponse » et classement Elo stocké localement.
- **Voix / outil** : « ouvre arena.ai », « ouvre le studio de code », « compare les modèles » ; l'outil `ai_studio` permet aussi à Jarvis de poser une question à un modèle externe configuré (réponse marquée comme contenu externe non vérifié).

## arena.ai
arena.ai n'a pas d'API publique et ses conditions d'utilisation interdisent l'accès automatisé. Jarvis se limite donc à **ouvrir le site** (fenêtre séparée, profil dédié, sans pont privilégié, permissions refusées) pour un usage **manuel**. Il ne lit pas la session ni les cookies et ne pilote pas la page. Le bouton « Envoyer le code copié à Jarvis » lit simplement le presse-papiers sur votre demande.

## Limites
- Le cerveau principal reste Gemini (appels d'outils, voix en direct) : les autres modèles servent au Studio de code, au comparateur et à l'outil `ai_studio`.
- Pas de réponse en flux continu : la réponse s'affiche une fois complète (délai maximal 120 s).
- Vos invites et fichiers joints sont envoyés au fournisseur choisi ; sa facturation s'applique.
