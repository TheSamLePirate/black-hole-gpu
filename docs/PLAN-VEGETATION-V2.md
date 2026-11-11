# PLAN-VEGETATION-V2 — les arbres lointains en imposteurs ré-éclairables

**État (11 novembre 2026)** : V2a et V2b faits (les arbres modélisés et leur cuisson en imposteurs, vérifiés sur planche) ; V2c–V2e
à faire. Demande de Sam, 11 novembre : « commence Littoral L1/L2 et arbres V2 ». Décision du 10 novembre
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
| V2c | **Les dessiner** : mips à couverture conservée (Castaño) ; les octaèdres lointains (300 m – 6,25 km) remplacés par des quads d'imposteur dans la passe de visibilité — leur profondeur par texel (canal de profondeur), l'identité de cellule comme aujourd'hui — ; `sceneryTreeLite` lit l'imposteur au pixel (vue → cellule, rayon → plan de l'imposteur → texel ; deux vues voisines mêlées) : couleur de la sorte, saison et teinte de la photo comme aujourd'hui, normale de l'imposteur pour le Soleil et le ciel ; fondu en trame complémentaire avec les houppiers proches | captures A/B (forêt de 300 m à 6 km, vue d'avion à 500 m et 3 km) ; ΔGPU sur J0 et une vue de forêt ; pas de couronne qui pivote en virage | à faire |
| V2d | **Au-delà de 6,25 km** jusqu'à ~20 km : un placement grossier (cellules agrégées, densité WorldCover/MNH) et des imposteurs de grappes ; la forêt en volume (but de Q4) | captures de 6 à 20 km ; mémoire et coût | à faire |
| V2e | Ombres (carte des arbres), transmission à contre-jour bornée, vent figé loin / vivant près (V5), le contrat de profondeur de J1 | J1 | à faire |

## 3. Contrats

- **Repère canonique** : z en haut, hauteur 1, rayon du houppier `aspect` (= r / H) ; pied du tronc à l'origine. Une instance met
  l'imposteur à l'échelle (H, r) de sa cellule, de la proportion la plus proche des deux cuites.
- **Vues** : cellule (colonne, rang) → direction d (de l'arbre vers l'œil) par l'octaèdre de l'hémisphère tourné de 45°
  (`impostorViewDir`, inverse `impostorCellOf`) ; repère de vue right = z × d normalisé (x si d est vertical), up = d × right ;
  centre (0, 0, 0,5), demi-taille √(rayon² + 0,25) ; texel (x, y) en haut à gauche ; profondeur 0,5 + 0,5 × (avance vers l'œil) /
  demi-taille.
- **Rien d'éclairé** dans la cuisson ; aucune passe de l'image ne la lit encore (V2c) : coût d'image nul aujourd'hui, la cuisson se
  fait à la demande (`renderer.treeImpostorPreview`).

## 4. Limites connues de V2a/V2b

Pas encore de mips (V2c) ; les modèles élancés n'occupent qu'une colonne étroite du cadre (le cadre est la sphère englobante) ; les
palmes du palmier descendent sous le disque plat du traceur (≈ 4 % des sommets hors de l'enveloppe) ; le masque des feuilles est
procédural (cinq folioles, ou des lames pour aiguilles et palmes), sans texture d'écorce.
