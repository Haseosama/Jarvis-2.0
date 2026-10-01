# Éditeur de polygones (créateur de personnage › Classique)

Ouvrir : Créateur de personnage → **🧱 Éditeur de polygones**.

- **Sélectionner** : clic sur un sommet (ou un polygone en mode ▲), Shift+clic pour ajouter, Ctrl+clic pour basculer, glisser pour un cadre (seuls les points visibles sont pris). Boutons Agrandir / Réduire / Aucune, et sélection directe des **paupières gauche / droite** (côtés à l'écran).
- **Déplacer** : glisser les points sélectionnés dans le plan de la vue ; tournez la vue (clic droit ou Alt+glisser) pour modifier la profondeur. Le **rayon d'influence** adoucit le déplacement le long de la surface (la paupière du haut ne tire pas celle du bas). Flèches / Page ↑ ↓ pour des pas précis, option **symétrie**.
- **Lisser** efface plis et marches ; **Points d'origine** annule la sélection ; Ctrl+Z / Ctrl+Y et « Tout effacer ».
- **Symétrie du visage** : « Copier gauche → droite » (ou l'inverse) recopie la forme d'un côté sur l'autre (œil, nez, oreille, bouche…). Le côté copié n'est jamais modifié ; l'axe de symétrie est estimé automatiquement. Cochez « Limiter à la sélection » pour ne traiter que certains points (ex. les paupières). Gauche/droite = côtés à l'écran ; Ctrl+Z annule.
- **Valider les retouches** puis **Appliquer** dans le créateur pour enregistrer.

Les retouches sont stockées dans `avatarSculpt` (`{ indexSommet: [dx, dy, dz] }`) et appliquées après les curseurs du créateur ; le maillage d'origine n'est jamais modifié. Les cheveux ne sont pas modifiables. Les « Looks » enregistrés ne contiennent que les curseurs, pas les retouches.
