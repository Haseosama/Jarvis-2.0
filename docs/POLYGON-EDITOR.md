# Éditeur de polygones (Classique, Léa et Marc)

Ouvrir :
- **Classique** : Créateur de personnage → **🧱 Éditeur de polygones** (retouches appliquées après les curseurs du créateur).
- **Léa / Marc** : avatar 3D → bouton **🧱 Éditer les polygones** de l'écran principal (visible en mode 3D ; il ouvre le visage actuellement choisi). Ces visages n'ont pas de curseurs : l'éditeur travaille directement sur leur maillage, avec les mêmes outils (sélection, paupières, rayon d'influence, lissage, symétrie gauche ↔ droite).

- **Sélectionner** : clic sur un sommet (ou un polygone en mode ▲), Shift+clic pour ajouter, Ctrl+clic pour basculer, glisser pour un cadre (seuls les points visibles sont pris). Boutons Agrandir / Réduire / Aucune, et sélection directe des **paupières gauche / droite** (côtés à l'écran).
- **Déplacer** : glisser les points sélectionnés dans le plan de la vue ; tournez la vue (clic droit ou Alt+glisser) pour modifier la profondeur. Le **rayon d'influence** adoucit le déplacement le long de la surface (la paupière du haut ne tire pas celle du bas). Flèches / Page ↑ ↓ pour des pas précis, option **symétrie**.
- **Lisser** efface plis et marches ; **Points d'origine** annule la sélection ; Ctrl+Z / Ctrl+Y et « Tout effacer ».
- **Symétrie du visage** : « Copier gauche → droite » (ou l'inverse) recopie la forme d'un côté sur l'autre (œil, nez, oreille, bouche…). Le côté copié n'est jamais modifié ; l'axe de symétrie est estimé automatiquement. Cochez « Limiter à la sélection » pour ne traiter que certains points (ex. les paupières). Gauche/droite = côtés à l'écran ; Ctrl+Z annule.
- **Valider les retouches** puis **Appliquer** dans le créateur pour enregistrer.

Les retouches sont stockées dans `avatarSculpt` pour le Classique et dans `avatarSculptFaces.lea` / `avatarSculptFaces.marc` pour Léa et Marc (`{ indexSommet: [dx, dy, dz] }`, chaque visage garde les siennes) et appliquées après les curseurs du créateur ; le maillage d'origine n'est jamais modifié. Les cheveux ne sont pas modifiables. Les « Looks » enregistrés ne contiennent que les curseurs, pas les retouches.
