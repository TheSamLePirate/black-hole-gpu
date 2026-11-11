# PLAN-VEGETATION-V2 — les arbres lointains en imposteurs ré-éclairables

**État (11 novembre 2026)** : V2a et V2b faits (les arbres modélisés et leur cuisson en imposteurs, vérifiés sur planche) ; **V2c
fait** (l'ombrage des arbres lointains lu dans les imposteurs, mips, vues mêlées) ;
V2d revu (au-delà de 6,25 km les arbres sont sous le pixel : V1/V3 avec J1), V2e à faire. Demande de Sam, 11 novembre : « commence Littoral L1/L2 et arbres V2 ». Décision du 10 novembre
([analyse §8](ANALYSE-MER-LITTORAL-VEGETATION-2026-11-10.md)) : les arbres sources **générés procéduralement**, comme le fait
BakedVoxelLighting. Origine : analyse §5.1 V2 ; [PLAN-REFRACTION-HORIZONS](PLAN-REFRACTION-HORIZONS.md) Q8 F3 ; stratégie §7.7
(la forêt de moyenne distance : des imposteurs à profondeur fiable).

## 1. Ce qui existe (lu le 11 novembre)

- **Placement** (`system/forest.ts`, `scenery-worker.ts`) : une cellule de 7 m, un arbre au plus, 7 sortes (aucune, feuillu,
  conifère, pin, palmier, arbuste, colonnaire), hauteur par WorldCover + climat ou mesurée par le MNH de l'IGN, un mot de 32 bits par
  cellule ; **portée 6,25 km** (`reach = radius + 250`, `scenery-worker.ts`), rien au-delà.
- **Raster** (`system/scenery-raster.ts`) : tri GPU (`scenery raster cull`) en listes atomiques → `drawIndirect` ; près (< 300 m)
  icosphère + tronc, loin octaèdre / pyramide ; ils écrivent l'identité de cellule et la distance dans la cible de visibilité.
- **Ombrage** : `shadeLite` → `sceneryTreeLite` (formes analytiques, matériau `forestLook`, éclairage par heuristique de normale) ;
  sous 80 m, le noyau de rayons sculpte les houppiers (`forest.wgsl`).
- **Au-delà de 6,25 km** : la couleur de l'orthophoto ; en France, le relief du MNS de l'IGN (« silhouettes lointaines »).

## 2. Les lots

| Lot | Contenu | Preuve | État |
|---|---|---|---|
| **V2a** | **Les arbres modélisés** (`vegetation/tree-model.ts`) : par sorte et à deux proportions (jeune et large, grand et élancé — r/H tiré du rayon des cellules sur la gamme de hauteurs de la sorte), tronc, charpentières, branches et cartes de feuilles qui remplissent **l'enveloppe de la sorte** (l'ellipsoïde ou le cône que le traceur sculpte de près : l'imposteur loin et le houppier près au même endroit, de la même taille). Colonisation de l'espace allégée (touffes semées dans l'enveloppe, plutôt sur sa coquille, reliées au squelette par des branches arquées), rayons par le modèle des tuyaux ; conifère en verticilles, pin en parasol, palmier en palmes arquées, arbuste en plusieurs tiges, colonnaire en branches serrées. Déterministe | `tests/tree-model.test.ts` (déterminisme, feuilles dans l'enveloppe, hauteur) | **fait** |
| **V2b** | **La cuisson hémi-octaédrique** (`vegetation/tree-impostors.ts`) : 8 × 8 vues sur l'hémisphère supérieur (du zénith à l'horizon : vu d'avion, pas l'azimut seul), 64² par vue, rendues à 128² puis moyennées 2 × 2 ; deux tableaux de textures de 12 couches (6 sortes × 2 proportions) : termes d'albédo (ombre des feuilles × profondeur dans le houppier, feuille/écorce, couverture) et surface (normale octaédrique dans le repère de l'arbre, profondeur le long de la vue). Aucun éclairage cuit : ré-éclairés au pixel | planche `docs/progress/vegetation/imposteurs-v2b-planche.jpg` ; sonde `tree-impostors` ; cuisson 71–332 ms (ce Mac) | **fait** |
| V2c | **Les dessiner** : **fait** — une texture de 24 couches (albédo 0–11, surface 12–23) à 5 mips liée au traceur (groupe 0, binding 50, si l'appareil prend 38 textures échantillonnées) ; `sceneryTreeLite` lit l'imposteur au-delà de 200 m (fondu tramé sur 100 m) : couche de la sorte à la proportion la plus proche, rayon dans le repère mis à l'échelle de la cellule, vue la plus proche, texel de son plan, **couverture prise comme une probabilité** (la forêt lointaine garde sa couverture moyenne ; l'historique la lisse — à la place de la mise à l'échelle de Castaño), profondeur et normale de l'imposteur, couleur de la sorte, saison et teinte de la photo par `forestLook` ; un feuillu nu en hiver garde la forme et ses rameaux ; cuisson au premier dessin de la forêt (523 ms sur kerr-mini, 211 ms sur ce Mac). **Ajouté ensuite (11 nov.)** : les quatre vues voisines mêlées de façon stochastique (une tirée par pixel selon leurs poids, l'historique les moyenne : aucune lecture de plus ; M1 Max, vue à 500 m, imposteurs 20,1 / 20,2 / 20,5 contre formes 21,1 / 20,7 / 21,7 ms, luminance inchangée). **Gardé tel quel, raisonné** : les octaèdres de la visibilité — l'imposteur tient dans l'enveloppe de la forme (`tests/tree-model.test.ts`), que l'octaèdre circonscrit : aucun pixel d'imposteur perdu, et la distance finale est celle de l'imposteur (`shadeLite` reprend `tM`) ; des quads tournés vers la caméra avaient été mesurés plus lents (étape 1b). **Limite** : un trou entre les feuilles montre le sol (l'orthophoto, sombre en forêt), pas l'arbre derrière — la marche de la grille depuis l'arbre coûtait 40 % du matériau (TUNE_LITE 256) | A/B `treeImpostorsOn`, sonde `forest-impostors` (Maures) : planche `docs/progress/vegetation/imposteurs-v2c-maures.jpg` ; kerr-mini GPU p50 vue à 500 m 54,1 / 55,4 / 55,2 → 53,4 / 53,6 / 53,7 ms (−0,7 à −1,8 : `earth lite` 13,7 → 13,0), canopée à 150 m 58,4 / 58,3 / 57,4 → 58,9 / 58,3 / 58,7 (bruit) ; luminance moyenne à 1 % près (pas de saut) | **fait** (sauf la limite dite) |
| V2d | **Revu le 11 novembre, sur preuve** : des imposteurs d'arbres un à un au-delà de 6,25 km seraient **sous le pixel** — le tri des arbres écarte déjà tout arbre de moins d'≈ 1,2 px de rayon (`scenery-raster.ts` `cull`, `sc.east.w`) : un arbre de 15 m (sphère ≈ 8 m) n'a plus ce rayon au-delà de ~7,5 km en 1080p (8,9·10⁻⁴ rad le pixel), et 0,4 px à 20 km. Là-bas la forêt est une **matière** : sa couleur moyenne sans saut au passage arbres → photo, l'assombrissement et le point chaud de la canopée selon le Soleil et la vue, sa rugosité sur les crêtes. C'est V1 (tuiles de couvert et de canopée dans le matériau du sol) et V3 (horizons de la canopée), que l'analyse place dans l'opaque de J1 (§7 : un seul lecteur à écrire) ; la silhouette en volume, en France, vient déjà du MNS (« silhouettes lointaines »). V2d devient donc : **les imposteurs jusqu'à la limite du pixel** (fait par V2c jusqu'à 6,25 km) **+ V1/V3 au-delà**, avec J1. **V1, premier lot fait le 11 novembre** (dans le noyau matériau, déjà découpé matériau/éclairage) : deux tuiles de canopée de 64 m (feuillus et pins ; conifères) cuites du dessus à partir des arbres de V2a sur la grille des cellules (85 % d'arbres, hauteurs et rayons de la forêt), raccordables, 10 mips jusqu'à leur moyenne, dans quatre couches de plus de l'atlas (aucune liaison de plus) ; `canopyTile` les lit sur le couvert WorldCover arbres/mangroves au-delà de 1,5–4 km : facteur d'albédo (ombre des houppiers et sol ombré entre eux, sur la moyenne de la tuile) et inclinaison de la normale (les sommets arrondis), conifères au-dessus de 1 100 m ou de 55° | planches `docs/progress/vegetation/canopee-v1-tuiles.png`, `canopee-v1-maures.jpg` ; kerr-mini (avec les imposteurs, A/B `treeImpostorsOn`) : vue à 500 m 54,1 / 55,1 / 54,7 contre 55,7 / 54,7 / 55,3 ms, canopée 59,1 / 57,5 / 58,4 contre 57,5 / 57,2 / 57,6 ; **effet faible** à 2–10 km (luminance +1,3 %, 3 % des pixels) : l'orthophoto domine — intensité à régler, à juger par Sam | V1 lot 1 fait ; V3 à faire |
| V2e | Ombres (carte des arbres), transmission à contre-jour bornée, vent figé loin / vivant près (V5), le contrat de profondeur de J1 | J1 | à faire |

## 3. Contrats

- **Repère canonique** : z en haut, hauteur 1, rayon du houppier `aspect` (= r / H) ; pied du tronc à l'origine. Une instance met
  l'imposteur à l'échelle (H, r) de sa cellule, de la proportion la plus proche des deux cuites.
- **Vues** : cellule (colonne, rang) → direction d (de l'arbre vers l'œil) par l'octaèdre de l'hémisphère tourné de 45°
  (`impostorViewDir`, inverse `impostorCellOf`) ; repère de vue right = z × d normalisé (x si d est vertical), up = d × right ;
  centre (0, 0, 0,5), demi-taille √(rayon² + 0,25) ; texel (x, y) en haut à gauche ; profondeur 0,5 + 0,5 × (avance vers l'œil) /
  demi-taille.
- **Rien d'éclairé** dans la cuisson ; lue par `sceneryTreeLite` (V2c) au-delà de `IMPOSTOR_NEAR_M` ; cuite au premier dessin de la
  forêt, `P.scenery[6].w` = 1 une fois prête et `treeImpostorsOn`.

## 4. Limites connues de V2a/V2b

Les modèles élancés n'occupent qu'une colonne étroite du cadre (le cadre est la sphère englobante) ; les
palmes du palmier descendent sous le disque plat du traceur (≈ 4 % des sommets hors de l'enveloppe) ; le masque des feuilles est
procédural (cinq folioles, ou des lames pour aiguilles et palmes), sans texture d'écorce.
