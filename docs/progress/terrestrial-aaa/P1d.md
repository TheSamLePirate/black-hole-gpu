# P1d — Le tracé démarre la recherche du sol depuis la distance raster (option A)

Date : **20 octobre 2026**. Réglage `earthTerrainRasterUse` (**désactivé par défaut**, avancé, TARS/schéma/FR).
Chrome headless local, GPU Apple (Metal 3), 960 × 540, bloc 1, une seule machine. Tests : `tests/e2e/terrain-raster-hint.e2e.test.ts`
(`HINT_PLACE=kennedy|alps|canyon`, `HINT_LEVEL`). Données : [kennedy](data/hint-kennedy-L2.json), [canyon](data/hint-canyon-L2.json),
[Alpes, avant le garde-fou rasant](data/hint-alps-L2-before-gate.json).

## Ce qui est implémenté

- **Passe de visibilité avant le tracé.** `TerrainRaster.encodeVisibility` dessine la portion (cache déjà prêt dans la même
  soumission) dans une texture `r32float` de distances ; l'inspecteur (`encodeInspector`) n'est plus qu'une surcouche après
  l'image finale.
- **Le noyau temps réel lit cette texture** (`HAS_TERRAIN_RASTER`, binding 35, noyau « main » non qualité seulement). Pour le
  rayon d'un pixel, `earthMarchHinted` lit le relief **complet** en deux points de part et d'autre de la distance du raster
  (bande verticale 5 m + 2 empreintes, élargie à angle rasant, au plus 2 % de la distance), exige « au-dessus » puis « sous le
  sol », et affine par regula falsi d'Illinois jusqu'à un dixième d'empreinte. **Tout échec (sol non encadré, rayon rasant
  `sinG < 0,15`, pas de couverture) retombe sur la marche d'origine.** Le point trouvé est donc toujours un zéro du relief exact.
- **Compatibilité.** La texture exige 22 textures échantillonnées par étage (`RASTER_HINT_TEXTURE_LIMIT`) : sans cela le
  noyau, le layout et la source restent ceux d'avant. Une texture vide (1×1) est liée aux autres passes ; seul le groupe du
  passage « trace » reçoit la texture du jour (aucune texture retirée par un redimensionnement n'est dans un groupe utilisé).
  Les noyaux de qualité, de sonde, la marche à pied, les pistes (relief nivelé exact aux sommets et aux lectures) et l'optique
  ne sont pas modifiés.
- **L'inspecteur ne dépendait pas du noyau Kerr** (P1c) : inchangé. Le *cache de hauteurs dans le tracé* garde sa condition.

## Résultats (A/B alterné, 2 tours de 50 images profilées par mode ; `trace` en ms, médiane)

| Lieu | Vue | Sans | Avec | Gain | Écart d'image |
|---|---|---|---|---|---|
| Kennedy (plat) | nadir 900 m | 56,1 | 34,4 | −39 % | 0,64 (bruit 0,64) |
| | oblique 900 m | 61,2 | 34,8 | −43 % | 0,35 (0,35) |
| | oblique 3 km | 51,9 | 35,4 | −32 % | 0,35 (0,35) |
| | oblique 10 km | 39,0 | 36,9 | −5 % | 0,27 (0,27) |
| Canyon (tuiles réelles) | bord 2 km | 69,2 | 52,9 | −23 % | 1,92 (1,92) |
| | bord 4 km | 60,4 | 41,7 | −31 % | 2,63 (2,55) |
| | horizon | 65,3 | 50,2 | −23 % | 1,88 (**1,53**) |
| Alpes* | vallée 2 km | 59,5 | 34,0 | −43 % | 1,22 (1,22) |
| | vallée 4 km | 56,6 | 36,5 | −35 % | 2,44 (2,43) |
| | crêtes 3 km | 62,8 | 36,7 | −42 % | 1,85 (1,66) |
| | haut 8 km | 47,1 | 40,1 | −15 % | 2,65 (2,65) |

« Écart d'image » : différence moyenne absolue (échelle 0–255) hors barre d'outils entre la capture avec et sans ; entre
parenthèses le plancher de bruit, mesuré entre **deux captures sans indice**. \*Alpes : mesures faites avant le garde-fou rasant
et le plafond de bande (voir ci-dessous) ; Kennedy et le canyon l'ont été avec. Les temps absolus varient avec la charge de la
machine entre séries (30–80 ms sans indice) : seuls les rapports d'un même A/B alterné comptent.

- **Le gain de `trace` est de 23 à 43 % de 900 m à 4 km** (jusqu'à 3 km sur terrain plat 32–43 %), 5–15 % quand la portion de
  niveau 2 (≈ 20 km) ne couvre plus qu'une part de l'image (10 km, 8 km). Les images sont **au plancher de bruit** presque
  partout : le rayon trouve le même zéro du relief exact.
- **Taux de réussite** (instrumentation temporaire, retirée) : Kennedy 900 m, 100 % des rayons de sol sont résolus par
  l'indice (échecs 0,02 %) ; 3 km niveau 2 : 80 % des pixels (le reste hors couverture ou ciel) ; 10 km : 10 %.
- **Accord avec la marche, point par point** (canyon, tuiles réelles, calcul des deux et écart en mètres sur les pixels
  indicés) : bord 2 km, 99,7 % à moins d'un mètre (p99 0,66 m) ; bord 4 km, ≈ 98 % (p99 ≈ 130 m) ; horizon, ≥ 90 % à moins de
  0,4 m après le garde-fou, mais **1 à 5 % de pixels très différents (p99 ≈ 500 m)**.

## Limite connue et garde-fous

Le raster est un maillage filtré (cellules de 153 m au niveau 2). **Une arête de crête plus fine que la cellule, entre la
caméra et le point indiqué, n'est pas vue par l'indice** : le rayon peut alors la traverser et sortir de l'autre côté avant la
distance du raster, et l'indice encadre quand même un zéro (le suivant). Cela apparaît aux vues rasantes sur terrain
accidenté (canyon, horizon : écart 1,88 contre bruit 1,53 ; crêtes des Alpes 1,85 contre 1,66). Deux garde-fous réduisent le
cas (rayons rasants `sinG < 0,15` laissés à la marche ; bande de confiance ≤ 2 % de la distance) sans l'éliminer : la
solution rigoureuse est un raster de **bornes** (hauteur maximale par nœud pour le début de la recherche, minimale pour sa fin),
qui encadre le zéro à coup sûr et n'est pas faite ici. D'ici là, **le réglage reste expérimental, hors défaut**.

## Ce qui n'est pas démontré

- Aucune mesure de cadence terminée sur plusieurs minutes de vol, ni sur M1 Max en temps réel ×4 (la machine de mesure
  n'est pas celle du propriétaire et la cible ×4 sous-échantillonne : un gain absolu y sera plus faible).
- Un seul niveau de raster à la fois : au-delà de ~20 km (niveau 2) ou à haute altitude, pas de couverture. Plusieurs niveaux
  (le plus fin d'abord) et leur tolérance par niveau restent à faire ; un maillage grossier seul ne convient pas (crêtes).
- Mer, nuages, scenery, ombres du relief, air : inchangés (≈ la moitié du travail d'un rayon, P1c §6).
- La reconstruction temporelle (jitter, historique) n'a pas été examinée avec l'indice : tests sans reprojection temporelle.

## Vérifications

`bun run typecheck`, Biome, `bun scripts/check-wgsl.ts` (25/25), `bun test` (1 365 réussis ; échecs : packs KTX2, présent sans
mes changements), e2e : smoke 17/17, bh-api 2/2, terrain-raster, cost-view (un dépassement de 240 s de compilation lors d'une
première passe, réussi à la seconde, 639 s), gpu-startup 15/16 (« the first image waits for the scene's own kernel », déjà
signalé en échec avant ce lot).
