# Au-dessus de Paris : tout le pipeline de l'image, toutes les phases de chargement, les bâtiments

3 novembre 2026. Analyse du code (HEAD `a8b9f392` + la nuit calibrée non commitée), demandée par Sam après deux
constats : les bâtiments « en cubes mal orientés » dès que la caméra regarde vers le bas, et le décor qui met
60 à 180 s à arriver sur les deux Macs. Les numéros de ligne sont ceux du jour.

## 1. Les deux constats, et leur cause

### 1.1 Les bâtiments en boîtes alignées nord-sud

**Ce n'est pas une régression du jour.** La bissection sur le mini (65d028c7 contre a1d981ec, test `buildings` à
Paris) montre les boîtes aussi sur l'ancien commit ; une première A/B les montrait seulement sur l'arbre du jour : le
défaut est intermittent, selon la scène affichée au moment de la capture.

- Le worker du décor ne fabrique les vrais triangles d'un bâtiment (contour, toits, parties) qu'à moins de
  **2 km du centre de la scène** (`BUILDING_MESH_M`, `scenery-data.ts:79`, `scenery-worker.ts:1043-1052`), et dans le
  budget de maillage (`meshBytes < budget/4`).
- **Le centre de la scène suit le regard** : `aheadFocus(eye, gazeS)`, jusqu'à 0,6 × 3 000 m × portée 2 =
  **3,6 km devant l'avion** en regard horizontal (`renderer.ts:3441-3443`, `streaming-focus.ts:23`), arrondi à
  0,005° (~556 m).
- Un bâtiment non maillé est dessiné par **la boîte englobante de sa feuille, alignée sur les axes est-nord**
  (`boxSolidVs`, `scenery-raster.ts:504-523`), ombrée par `shadeLite` comme un bâtiment : murs en pierre avec la
  grille de fenêtres générique, et **son couvercle plat reçoit l'orthophoto** — la photo du sol « vue dedans ».
- En vol bas, regard horizontal, les bâtiments les plus visibles (0–1,5 km) sont donc souvent des boîtes. Quand la
  caméra baisse, le regard tombe à ~650 m, le centre bouge, une nouvelle scène est demandée (35–60 s) : l'ancienne,
  avec ses boîtes sous les yeux, reste affichée jusque-là. Le test `buildings` photographiait sans attendre la scène
  de la vue.
- Autres cas de boîtes : le budget de maillage épuisé dans le Paris dense (≈1–1,5 km), une feuille sans place
  (`room4`), les cheminées (toujours en boîte).
- Le pipeline tracé ne montre jamais ces boîtes : il teste chaque feuille exactement (`sceneryQuery`,
  `trace.wgsl:8912`).

### 1.2 Le décor lent (60–180 s)

Voir §3. En bref : une boucle de reconstruction (le centre suit le regard, arrondi à 556 m ; chaque scène finie est
déjà périmée), des reprises complètes après une erreur isolée, et des phases CPU très lourdes (« forêt » sur ~2,3 M
cellules, « assemblage » sur 32 000 bâtiments) qui attendent en plus tout le relevé IGN.

## 2. L'image, passe par passe (pipeline raster, F-35 à 100–300 m)

`frame()` (`renderer.ts:9207`). Fenêtres du cache de relief à 257² : L0 ±153 m (nœuds de 1,19 m), L1 ±306 m,
L2 ±1,2 km, L3 ±4,9 km, L4 ±19,6 km, L5 ±78 km, L6 ±313 km ; le patch est L0, les anneaux L1–L6.

| # | Passe (`prof.pass`) | Lit | Écrit | Rôle |
|---|---|---|---|---|
| 1 | `cockpit mask` | le masque du vaisseau | `moments.x` sous la cabine | les pixels de la cabine sautés |
| 2 | `sea fft`, `far-field LUT` | — | textures | quand c'est dû |
| 3 | `terrain surface cache` (+ fondu) | tuiles, `earthElev` | hauteurs 257² dans `TABLE_TERRAIN` | les niveaux déplacés cuits dans l'image, puis les sales |
| 4 | `scenery raster cull` | BVH du décor | listes indirectes | arbres (4 vues + 2 ombres), feuilles de bâtiments |
| 5 | `terrain raster visibility` | maillages patch/anneaux, cache, décor | cible rgba32f (r distance, g id d'arbre, b distance, a code·2¹⁸+normale) + profondeur | patch (code 1) → anneaux → proxies d'arbres → bâtiments (triangles, boîtes) |
| 6 | `terrain from the Sun` | maillages | atlas d'ombre 2×2048² | quand le Soleil change |
| 7 | `trees' shadow map` | listes d'ombre | couche arbres + couche bâtiments | quand son cadre bouge |
| 8 | `clouds' shadow map`, `sky ambient`, `aerial perspective` | — | tables | lus par tous les noyaux |
| 9 | `clouds (half)` + historique | indice | nuages en demi-résolution | |
| 10 | `trace` (`main`) | indice | accum, moments | le ciel seul (les pixels du raster sautés), un rayon par bloc 16×16 sous 1,5 km |
| 11 | `trace (discs)`, `stars (raster)` | — | — | astres, étoiles |
| 12 | `earth shade (raster)` (`shade`) | indice | accum | le noyau des rayons : ponts, arbres proches, boîtes code 60 ; sauté si `liteAll` |
| 13 | `earth lite (raster)` (`shadeLite`) | indice, tables, imagerie | accum / marque eau | sol, triangles et boîtes des bâtiments, arbres > 80 m |
| 14 | `earth water (raster)` | marques eau | accum | eau |
| 15 | sonde du vaisseau | — | SH | la lumière du F-35 |
| 16–17 | `resolve`, `temporal` (+ taau, étoiles, flou) | accum, historique | hdr | |
| 18 | `occlusion depth` | profondeurs | `sceneDepth` | le F-35 caché par le relief |
| 19 | le vaisseau (passes de rendu) | `sceneDepth` | textures du vaisseau | |
| 20 | bloom, flare, posemètre | | | |
| 21 | `display` | hdr, vaisseau, bloom | écran | mise à l'échelle, tone map, Purkinje |

### Les bâtiments à l'écran

- **Géométrie** : la feuille du BVH (`packScenery`) — `[bas, haut, nb d'arêtes, kind]`, `[min/max xy]` (non lu),
  `[couleur du mur, mot packé]` (matériaux toit/mur, étages, plans, forme, maillé bit 21, parapet), les arêtes, `[couleur
  du toit, égout]`, les plans du toit ; une section de maillage (sommets, triangles).
- **Position** : uniquement les données du décor et `P.scenery[3]` (la caméra dans le repère du décor, en float64 côté
  CPU). Ni la fenêtre du relief ni le maillage du patch ne déplacent un bâtiment ; ils ne décident que de la profondeur
  contre laquelle il est testé.
- **Dessin** (`SceneryRaster.draw`, `scenery-raster.ts:861`) : proxies d'arbres (profondeur écrite), puis boîtes
  pleines des feuilles non maillées (code 62), puis triangles des bâtiments maillés (code 62, ponts 63) ; sans les
  pipelines prêts, boîtes de marquage code 60 pour le noyau des rayons.
- **Ombrage raster** (`shadeLite`) : il ne reçoit que la distance et le code 62 — **ni identité du bâtiment, ni
  face, ni normale** (g = 0, bas de `a` = 0). La normale vient des distances voisines (`rasterNormal`) ; toit si
  n·up ≥ 0,35 → orthophoto désaturée à 80 % ; mur → pierre teintée par bloc de 25 m, fenêtres 3,1 × 2,6 m ancrées sur
  l'origine de la scène ; la nuit, aucune fenêtre allumée.
- **Ombrage tracé** (`worldScenery` → `sceneryQuery` → `buildingLook`/`roofLook`, `trace.wgsl:8912-9077`) :
  géométrie exacte, matériaux de la BD TOPO, étages et égout, travées de 3,2 m centrées sur chaque mur, commerces au
  rez-de-chaussée, balcons haussmanniens, grain de pierre ou brique, tuiles/ardoises/zinc, mansardes et lucarnes,
  fenêtres allumées la nuit, verre et zinc en miroir, occlusion au pied ; le détail s'efface au-delà de 120–260 m.

### Ce que N = 257, la fenêtre décidée d'avance et le maillage en worker peuvent toucher

Ils ne déplacent aucun bâtiment. Ils changent le niveau de relief (et donc la hauteur) contre lequel le pied et le toit
d'un bâtiment sont testés en profondeur ; un niveau re-cuit sans fondu quand sa fenêtre bouge. Les constantes liées à N
(`*_OFF` de `trace.wgsl`, `TC_N`, `RASTER_MESH_MAX_SIDE`, le centre de fenêtre) sont à jour et gardées par
`tests/gpu-tables.test.ts`.

## 3. Le chargement, phase par phase

Défauts sur une machine capable : décor « high », portée « veryFar » → rayon 6 km, boîte de 13,3 km, tampon 64 Mio,
raster 1024², forêt sur un disque de 6,25 km en cellules de ~7 m (≈2,3 M cellules), plafond 32 000 bâtiments et
96 000 surfaces.

1. **Tuiles de relief** (`earth-tiles.ts`, fil principal) : fenêtres z6–14, puis z15–17 de l'IGN seul en France
   (≈384 tuiles) ; 8 en vol (`MAX_INFLIGHT`), le plus proche d'abord ; Terrarium (S3) 15 s de délai, décodé sur le fil
   principal ; l'imagerie en parallèle (WMTS IGN, EOX, GIBS la nuit). Puis le raffinage IGN (WMS-R, grilles float32
   256² — RGE ALTI, LiDAR dès z16, silhouettes lointaines 512²), 14 en vol, **un portillon de 20 requêtes/s**, reprises
   à 1/2/4 s sur 400/429/5xx. ≈50 s à froid : ≈24 s de Terrarium, ≈20–35 s d'IGN par le portillon.
2. **Cuissons du cache** : 150 ms après le dernier changement visible (500 ms au plus), 10 s si caché ; fondu 250 ms.
3. **Horizons, cartes fines** : pas sur la Terre (Lune seule).
4. **La demande de décor** (`scenery.ts`) : centre = œil + avance du regard (≤ 3,6 km), arrondi à 556 m ; la clé
   change à chaque case franchie ; une demande dès que libre, 3 s après la précédente ; une construction en cours n'est
   annulée qu'au-delà de 16 km — elle finit, puis est remplacée aussitôt : **une boucle de reconstruction**.
5. **Le worker du décor** (`scenery-worker.ts`), un neuf par scène :

   | Étape affichée | Travail | Réseau | Limites |
   |---|---|---|---|
   | occupation du sol | relevé IGN lancé à t = 0 en fond (≈66 blocs MNH + sol LiDAR) ; couverture WorldCover (classes puis couleurs) | terrascope, `data.geopf.fr` (portillon 12/s, 4 en vol) | délai global de 60 s depuis le début ; relevé 45 s |
   | routes et eau | OSM (6 en vol) puis lecture tuile par tuile | openfreemap, ≈90–100 tuiles z14 | |
   | bâtiments n/N | BD TOPO par lots de 4 (`Promise.all`), les 32 000 plus proches | `data.geopf.fr/tms/…/BDTOPO`, 40–60 tuiles | utilise le délai de 45 s du relevé |
   | forêt | ponts (`await height()` → **attend tout le relevé IGN**), index des surfaces et des bâtiments, `growForest` sur ≈2,3 M cellules (9 lectures de canopée chacune, test point-dans-polygone sans boîte englobante), ≈700 k promesses de sol | Terrarium en repli | |
   | assemblage | contours (32 000), murs mitoyens (≈0,5 M arêtes), toits LiDAR (≈10 k), **deux passes de `planBuilding`** pour les bâtiments proches, maillages (~15 k), BVH (`slice`+`sort` récursifs), `packScenery` | — | |

6. **Après la réponse** : jusqu'à 64 Mio envoyés au GPU, la variante du shader compilée si besoin, fondu de 600 ms.
7. **Caches** : zones hors ligne, puis le cache LRU du Service Worker (300 Mo), puis le réseau ; les grilles IGN
   décompressées à chaque lecture dans le Service Worker ; **les portillons IGN s'appliquent même aux réponses en
   cache** (`ign-canopy.ts:139`), d'où ≥ 15–35 s même à chaud.

### Les échecs

- Relief IGN refusé : les hauteurs Terrarium restent ; Terrarium échoué deux fois : la carte globale, « Relief n
  failed ».
- Une cellule de couverture, une tuile OSM, un Terrarium dans le worker → scène **dégradée** : reprise de la même clé
  après 30 s (doublé jusqu'à 5 min), et si une scène est déjà affichée, **la reconstruction entière est jetée**.
- Les Terrarium demandés après 60 s échouent aussitôt (« TimeoutError: signal timed out ») — le délai est global.
- Les 429 viennent de `data.geopf.fr` : relief (20/s), relevé (12/s), BD TOPO (sans limite), orthophotos (8 en vol),
  zones (8/s) — rien ne les coordonne.

## 4. Ce qu'on fait, dans l'ordre

1. **Les bâtiments sous les yeux toujours maillés** : le maillage autour de l'avion (le worker reçoit l'œil ; disque
   autour de lui plus une bande vers le regard), le budget de maillage dépensé du plus proche de l'œil au plus loin ;
   au-delà, une boîte **orientée** selon l'axe principal du bâtiment (calculée par le worker, rangée dans la feuille —
   son vec4 1 n'est pas lu) au lieu de la boîte nord-sud ; les cheminées en vraie boîte orientée.
2. **Fin de la boucle de reconstruction** : re-centrer seulement quand le point visé sort d'un disque intérieur
   (~0,3 × rayon), avance du regard réduite en vol bas, délais par requête et non globaux, une erreur isolée ne jette
   plus une scène meilleure que celle affichée.
3. **Le CPU du worker** : la forêt sans tests point-dans-polygone (un masque brûlé une fois), sans `localPoint` par
   cellule, clés numériques, sol lu de façon synchrone après le relevé, `planBuilding` une seule fois, BVH en tableaux
   typés ; éventuellement la forêt répartie sur 2–4 workers.
4. **Livraison progressive** : une première scène à 2 km (couverture, OSM, BD TOPO en boîtes orientées, forêt de la
   couverture), puis la complète.
5. **Le réseau** : tout lancer à t = 0, un pool BD TOPO, pas de portillon sur une réponse en cache, un seul budget
   Géoplateforme (dans le Service Worker, `Retry-After` respecté) ; les scènes finies gardées par clé (revisite
   instantanée).
6. **Les bâtiments raster au niveau du tracé (Q3/B1)** : l'identité du bâtiment dans le canal g et la face dans le bas
   de a pour les pixels de bâtiment ; `buildingLook`/`roofLook` partagés en une fonction pure appelée par `shadeLite` ;
   la normale exacte de la face ; les toits du plan (matériau, tuiles, zinc, lucarnes) avec la médiane de l'orthophoto
   par toit ; les fenêtres allumées la nuit selon l'usage BD TOPO ; les murs mitoyens aveugles.
