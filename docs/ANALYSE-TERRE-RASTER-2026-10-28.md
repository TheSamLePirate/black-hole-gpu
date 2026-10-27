# La Terre en raster — qualité, portée, eau, nuages (analyse du code, 2026-10-28)

Analyse **du code seulement** : aucun test, e2e ni capture n'a été lancé. Les distances sont celles des constantes, à
47° N (France) quand elles en dépendent (cos ≈ 0,68 est-ouest). Les points marqués **à vérifier** sont déduits du
code et doivent être confirmés à l'image avant d'agir.

Questions posées :
1. Affiche-t-on les images IGN et le relief à leur qualité maximale ?
2. Quelles distances pour les LOD, les changements d'échelle, la taille des triangles ? Le paysage détaillé ne va pas
   assez loin.
3. L'eau (mer, rivières, lacs) est parfois grossière à distance.
4. Les nuages ne cachent pas le Soleil ni la Lune.

## En bref

| Question | Réponse | Cause principale |
|---|---|---|
| Qualité IGN maximale ? | **Non** : orthos à z18 (0,41 m/px) pour z19 disponible (0,2 m) ; relief LiDAR à z17 (0,8 m) pour 0,5 m disponible | `ORTHO_Z1 = 18`, `Z1 = 17` (`earth-tiles.ts:84, 49`) |
| Pourquoi le détail s'arrête tôt ? | Les niveaux fins ne couvrent que **quelques centaines de mètres** autour de la caméra | fenêtres fixes de 4 tuiles (`ORTHO_SPAN = 4`, `SPAN = 4`), niveau choisi d'après la hauteur sol et non la distance, anisotropie limitée à 4 |
| Eau grossière au loin | Vagues échantillonnées à un niveau trop fin en vue rasante (moiré) ; rivières/lacs perdus au-delà de 2,5–7 km ; côte ETOPO à ~5 km/texel | `seaWavesFft` (`trace.wgsl:6835`), `scenery.ts:330`, `earthRelief` |
| Nuages et Soleil | Les nuages ne descendent **jamais sous 1 % de transmission** ; le Soleil, ~10⁵ × le ciel, reste éblouissant derrière | `if (Tv < 0.01) { break; }` (`trace.wgsl:8422, 8663, 8821`) |
| En plus | **Régression probable** : les ombres du relief ne sont dessinées que sur ±76 m autour de la caméra (à vérifier) | `encodeSunShadow` ne dessine que le patch (`terrain-raster.ts:592`) |

---

## 1. Images IGN et relief : la qualité maximale ?

### Sources et niveaux

| Source | Niveau le plus fin utilisé | m/pixel | Le plus fin disponible | Écart |
|---|---|---:|---|---|
| IGN BD ORTHO (WMTS Géoplateforme, JPEG) | z18 | 0,41 | z19 (0,20 m) | 1 niveau, ×2 |
| SWISSIMAGE (swisstopo) | z18 | 0,41 | ~z20 (0,10 m) — non vérifié | ~2 niveaux |
| Sentinel-2 EOX (hors France) | z14 | 6,5 | 10 m natif | aucun |
| Pilote Sentinel-2 régional | page 1024² | ~8,7 | 10 m | aucun (BC7/ASTC avec perte) |
| IGN LiDAR HD MNT | z17 | 0,81 | 0,5 m (z18) | 1 niveau |
| IGN RGE ALTI | z17 | 0,81 | 1 m | aucun |
| swissALTI3D | maillage g16 (~1,9 m) | ~1,9 | 0,5 m | 1–2 niveaux |
| Terrarium (monde) | z14 | — | SRTM 30 m | aucun |

### Ce qui limite vraiment (par ordre d'impact visible)

1. **Les fenêtres fines sont minuscules.**
   - Orthos : `ORTHO_SPAN = 4` tuiles par niveau (`earth-tiles.ts:87`). Rayon autour de la caméra :
     - z18 : ±210 m ;
     - z17 : ±420 m ;
     - z16 : ±830 m ;
     - z15 : ±1,7 km.
   - Au-delà de ±1,7 km, il ne reste que Sentinel-2 à 6,5–10 m.
   - Relief IGN z15–17 : fenêtres de 4 tuiles aussi (`levelSpan`, `earth-tiles.ts:465`), soit ±420 m à z17.
   - Les fenêtres peuvent avancer vers le regard, de 1,25 tuile au plus.
2. **Le niveau dépend de la hauteur sol, pas de la distance.**
   - `zNeed = ceil(log2(2πR·cosφ / (256·max(h·pixAngle, 0,1))))` (`earth-tiles.ts:1052`), avec h la hauteur au-dessus du sol.
   - `pixAngle` dépend de la hauteur de la cible de rendu : une résolution réduite (« render scale » < 1) baisse le niveau.
   - En vol à 900 m, ça donne z15–16 sous l'avion. Le z18 ne sert qu'au sol ou presque.
3. **Lecture rasante limitée.** Les tuiles n'ont pas de mipmaps ; l'anisotropie est faite à la main, avec `TUNE_ANISO = 4` lectures au plus (`trace.wgsl:211, 5699`). En vol horizontal, l'empreinte d'un pixel au loin est 10 à 50 fois plus longue que large : le shader prend un niveau plus grossier.
4. **Pas de cache pour les orthos.** Contrairement au relief, une fenêtre d'ortho quittée n'est pas gardée en mémoire ni pré-chargée en anneau (`earth-tiles.ts:213, 803-830`) : revenir sur une zone retélécharge, 8 requêtes à la fois.
5. **Maillage raster** (§2) : 1,2 m sur ±76 m seulement, puis 2,4, 9,5 et 38 m. Au-delà de ~300 m, la forme du relief est au mieux à 9,5 m, quelle que soit la donnée LiDAR.
6. **Normales du relief** : plancher de 10 m hors données IGN/swisstopo (`trace.wgsl:6050`). La raison est une limite de précision réelle : un point de la sphère unité en float32 ne fait qu'environ 0,4 m. En France, `earthSlopeFine` descend à 0,8 m.
7. **Détail procédural coupé dans le raster** : `NEAR_DETAIL = 0` dans les noyaux du vol Terre-raster (plan des noyaux, P4). La forme fine sous la donnée ne vient plus que de la cache cuite.
8. **Petites pertes** :
   - JPEG à la source ;
   - recalage colorimétrique 8 bits des orthos (`ORTHO_FIT`, `earth-tiles.ts:149`) ;
   - BC7/ASTC sur le pilote régional ;
   - le commentaire `earth-tiles.ts:22` est faux (« z15–18 = 0,8 à 0,2 m » ; en réalité 3,2 à 0,4 m).
9. **Machines modestes et hors-ligne** :
   - au tier ≤ 1, `detailReach` passe de `veryFar` à `normal` (`quality-policy.ts:114`) ;
   - le profil hors-ligne `low` s'arrête au relief z16 et à l'ortho z17 (`zones.ts:56`).

---

## 2. Les distances : LOD, triangles, décor

### Le maillage raster (anneaux imbriqués autour d'un patch fin)

Chaque niveau est une grille de 129 × 129 nœuds (32 768 triangles, `TERRAIN_CACHE_N`), sur
`TERRAIN_CACHE_ROUNDS = [2²⁵, 2²⁴, 2²², 2²⁰, 2¹⁸, 2¹⁶, 2¹⁴, 2¹²]` (`terrain-cache-layout.ts:7-8`).

| Niveau | Côté de triangle (N-S) | Demi-largeur nominale | Rôle |
|---|---:|---:|---|
| 0 (patch) | 1,2 m | 76 m | découpes des pistes |
| 1 | 2,4 m | 153 m | anneau |
| 2 | 9,5 m | 611 m | anneau |
| 3 | 38 m | 2,45 km | anneau |
| 4 | 153 m | 9,8 km | anneau (l'ancien patch avant I3) |
| 5 | 611 m | 39 km | anneau, ombrage 1 pixel sur 2 |
| 6 | 2,45 km | 156 km | dernier anneau (`TERRAIN_CACHE_RING_LAST = 6`) |
| 7 | 9,8 km | 626 km | cuit, pas dessiné |

- **Est-ouest**, tout est ×0,68 à 47° N : le dernier anneau fait ±107 km nominal. Selon où la fenêtre s'est accrochée, ce peut être seulement 53 km. Au-delà, c'est le traceur, à 1 rayon par bloc.
- **Pas de morphing ni de jupes** : les anneaux se chevauchent de 4 nœuds et le test de profondeur tranche. Une fenêtre ne se déplace qu'après 32 nœuds de mouvement : la portée réelle varie de 0,5× à 1,5× la demi-largeur.
- **Rien ne dépend de l'altitude** : mêmes niveaux à 50 m et à 3 km.
- **L'ombrage du sol** (`shadeLite`) prend la normale du maillage lui-même (`rasterNormal`, `trace.wgsl:10711`) :
  - de ~1 à 3,7 km, le relief est éclairé à la résolution de 38 m ;
  - de 5 à 15 km, à 153 m ;
  - à chaque couture d'anneau, la normale retombe sur l'ellipsoïde plat (`:10719`).

  C'est la principale raison d'un relief « mou » à moyenne distance.
- **Gouverneur** : `earthRasterShading: "auto"` fait varier le taux d'ombrage de 2 à 16 (`renderer.ts:8527`).

### Le décor

| Élément | Portée | Où |
|---|---|---|
| Boîte du décor | 3000 m × portée (×2 en `veryFar`) = **6 km** | `scenery-sources.ts:17` |
| Surfaces OSM (eau, routes…) dans le tracé | 3500 m × 2 = **7 km**, fondu sur 300 m | `scenery.ts:330`, `trace.wgsl:7870` |
| Arbres : modèle proche / lointain | 300 m (ico80 + tronc, puis octaèdre) | `scenery-raster.ts:24` |
| **Arbres retirés sous 2,5 px de rayon** | **~2,6 km** à 1080 lignes, ~1,95 km à 0,75 de résolution | `scenery-raster.ts:290, 732` |
| Ombres des arbres et bâtiments | ±900 m, fondues de 550 à 750 m | `TREE_SHADOW_HALF_M`, `scenery-raster.ts:30` |
| Bâtiments en triangles (toits) | 2 km (des boîtes au-delà) | `BUILDING_MESH_M`, `scenery-data.ts:79` |
| Overture (bâtiments hors France) | 1,8 km | `scenery-sources.ts:120` |
| Canopée IGN pleine résolution | 2 km (demi au-delà) | `ign-canopy.ts:24` |
| Bâtiments lointains (HLOD) | cuits dans le relief jusqu'à z13 | `earth-tiles.ts:304` |
| Herbe | 30 m, à pied seulement | `grass-layout.ts:9` |
| Décor coupé | au-dessus de 12 km | `scenery.ts:155` |
| Budget du décor | 64 Mo (16 × portée²), un quart pour les maillages | `scenery-data.ts:6` |

### Pourquoi « le paysage détaillé ne va pas assez loin »

Plusieurs limites tombent toutes dans la même bande de 1,7 à 3 km :

| Ce qui s'arrête | Où |
|---|---|
| L'ortho IGN nette | ±1,7 km |
| Les arbres | ~2,6 km |
| Les bâtiments maillés | 2 km |
| Le relief éclairé finement | ~1 km (38 m au-delà) |
| L'eau OSM | ~7 km |

Au-delà, le sol est fait de :
- la photo Sentinel-2 à 10 m ;
- un relief à 153 m éclairé par la normale du maillage ;
- les forêts réduites à leur couleur.

### Régression probable : les ombres du relief (**à vérifier**)

- `encodeSunShadow` (`terrain-raster.ts:592-594`) ne dessine que le maillage du **patch**, le niveau 0 sur ±76 m depuis I3.
- La carte d'ombres couvre pourtant ±10 km (`SUN_HALF_M = 10 000`, `renderer.ts:7678`).
- `shadeLite` et le traceur supposent l'ancien patch de ±10 km, et ne reprennent leur propre marche d'ombre qu'au-delà de ~9,8 km.

Entre ~80 m et ~10 km, les ombres portées du relief (une montagne sur la vallée) manqueraient donc. Le correctif est de dessiner aussi les anneaux 1 à 4 dans la carte d'ombres : environ 120 000 triangles de plus dans une passe de profondeur.

---

## 3. L'eau à distance

### Qui dessine l'eau, selon la distance

- **Près et dans les anneaux** (`shadeWater`, `trace.wgsl:11081`) :
  - masque = max(mer ETOPO, eau OSM) ;
  - mer : vagues FFT, reflet Cox–Munk, Fresnel, sonde du ciel, réflexions écran (SSR), nuages lointains ;
  - rivières et lacs : `inlandWater`, rides qui disparaissent sous l'empreinte, puis miroir plat d'une grille de ciel 8 × 8.
- **Au-delà de l'eau OSM (2,5 à 7 km)** : seule la mer ETOPO reste, à **~4,9 km par texel**, découpée par la hauteur des triangles grossiers (`hG < 0,5–2 m`, `trace.wgsl:11052`). Les rivières et lacs redeviennent de la photo éclairée comme du sol.
- **Traceur lointain** (`main`, profil Terre-raster) :
  - `HAS_SCENERY = 0`, donc pas d'eau OSM ;
  - `NEAR_DETAIL = 0`, donc pas de vagues en relief ni de miroir SSR ;
  - FFT lu avec `footSea / sqrt(FOOT)`, un niveau plus fin que l'empreinte (`:8189`).

### Les causes du « grossier », de la plus probable à la moins probable

1. **Les vagues lues au mauvais niveau en vue rasante.**
   - `lod = log2(foot·256/L)` avec `foot = √(|fx|·|fy|)`, la moyenne des deux axes (`trace.wgsl:6835, 6845`).
   - L'axe le long de la vue est 20 à 100 fois plus long que l'axe en travers : on lit un niveau beaucoup trop fin.
   - `textureSampleLevel` est à niveau fixe et le sampler n'a pas d'anisotropie (`renderer.ts:1029`).
   - Résultat : moiré et scintillement que seul l'historique lisse. La rugosité des pentes non résolues (LEAN) est aussi lue trop fine, si bien que le reflet du soleil pétille au lieu de devenir un lustre doux.
2. **La tuile de vagues de 1 km se répète.** La FFT fait 256² sur des cascades de 1024, 128 et 16 m, sans rotation ni casse du motif. De 2 à 20 km, la répétition de la cascade de 1 km se voit.
3. **Côte ETOPO en blocs** au-delà de la portée OSM : texels de ~5 km, flous en vue rasante, puis recoupés par des triangles de 611 m à 2,4 km. La côte fait des taches ou des marches, et peut bouger quand l'anneau change.
4. **Rivières et lacs coupés à la portée OSM** (2,5–7 km, `scenery.ts:330`). En deçà, au-delà de ~100 m, c'est un miroir plat sans rugosité : un autre modèle que la mer. Un petit lac sous 2 m d'altitude ETOPO devient de la « mer », avec des vagues de mer.
5. **Réflexions écran (SSR)** jusqu'à 8 km sans fondu en distance, avec un jitter par image : l'eau lointaine clignote entre le SSR et la sonde. Dans le traceur lointain, pas de SSR du tout.
6. **Sonde du ciel** 256 × 128 (~1,4° par texel, `ship.ts:359`) : la bande d'horizon reflétée par une mer rasante est floue (contributeur mineur).
7. L'écume change de modèle avec la distance (`trace.wgsl:7159, 6968`) : bandes légères.

**Le WorldCover 10 m est déjà chargé** (`surfaceCover`, `trace.wgsl:7902`), mais sa classe « eau » (80) ne sert pas de masque.

---

## 4. Les nuages ne cachent ni le Soleil ni la Lune

L'ordre de composition est correct : nuages, puis tracé, puis disques. Chaque chemin multiplie bien le Soleil et la Lune par la transmission des nuages (`trace.wgsl:3443-3473`, `earthLookCompose :9082`).

**La cause est un plancher de transmission.** Les trois marches s'arrêtent quand moins de 1 % de la lumière passe encore :
- volume des nuages : `trace.wgsl:8422` ;
- couches météo : `:8663` ;
- rideaux de pluie : `:8821`.

Le fond reçoit alors `o.T = (1 − alpha)·air.T` ≥ 1 %. Or le disque du Soleil est ~10⁵ fois plus lumineux que le sol éclairé : 1 % de lui reste ~1000 fois le blanc. On voit donc un disque éblouissant derrière un cumulus épais, que le halo (bloom) et le reflet d'objectif amplifient encore.

Trois aggravations :
- **La Lune de nuit** est multipliée par 150 (`MOON_NIGHT_GAIN`, `:10149`) avant la transmission : 150 × 1 % = 1,5 fois sa luminosité normale, à travers un nuage « épais ».
- **Avec la météo**, `cloudVolume` ne commence qu'à 250 km : près de la caméra, seules restent les couches météo, en 16 pas. Une couche fine peut ne jamais atteindre le plancher.
- **La passe nuages en demi-résolution** est lue en bilinéaire et filtrée dans le temps (`cloud-pass.ts:35`, `post.wgsl:998`). Au bord d'un trou, le Soleil filtre à ~25 % : un liseré lumineux.

**La carte d'ombre des nuages, elle, n'a pas de plancher** (`cloud-shadow.ts:27`, `exp(-tau)`). Le sol s'assombrit sous un nuage pendant que le Soleil reste visible au travers.

---

## 5. Recommandations par priorité

Gain = effet visible attendu ; coût = estimation d'après le code et les mesures passées (kerr-mini), **non mesuré ici**.

| # | Changement | Gain | Coût | Risque |
|---:|---|---|---|---|
| 1 | **Nuages : transmission du fond sans plancher.** Une transmission d'extinction seule (`Tbg`) prolongée après l'arrêt de la marche (4 à 8 lectures de densité, `exp(-τ)`), utilisée pour le fond. Pour la passe nuages, la porter dans le `.w` libre de `cloudOutB` et la moyenner en log. | Soleil et Lune cachés ; halo et reflet d'objectif corrigés du même coup | ~0,1–0,3 ms | faible |
| 1b | Rustine immédiate : `Tv = 0` à l'arrêt de la marche | idem, presque | nul | petit saut au bord intérieur du nuage |
| 2 | **Ombres du relief : dessiner les anneaux 1 à 4** dans la carte d'ombres du Soleil (**à vérifier d'abord à l'image**) | ombres des montagnes de 80 m à 10 km | ~120 k triangles dans une passe de profondeur | faible |
| 3 | **Vagues lues en anisotrope** : `textureSampleGrad` avec les axes projetés et un sampler `maxAnisotropy: 16` (ou le niveau de l'axe long plus la variance) ; retirer le `/sqrt(FOOT)` du lointain | fin du moiré et du scintillement de la mer au loin | ~0,1–0,3 ms | faible |
| 4 | **Eau WorldCover 10 m (classe 80)** comme masque de l'eau entre la portée OSM et le bord de la zone WorldCover, et pour la côte au lieu d'ETOPO | rivières, lacs et côtes nets jusqu'à l'horizon (en Europe) | ~0,02 ms | faible |
| 5 | **Casser la répétition de la tuile de 1 km** (rotation ou décalage par cellule, ou passage aux statistiques Cox–Munk quand `foot > L/16`) | mer lointaine sans motif | < 0,05 ms | faible |
| 6 | **SSR fondu avec la distance** (2 à 6 km) et jitter réduit quand l'empreinte grandit | fin du clignotement de l'eau lointaine | gain de temps | nul |
| 7 | **`inlandWater` avec la rugosité non résolue de la mer** | rivières lointaines en lustre doux, pas en miroir dur | négligeable | faible |
| 8 | **Fenêtres d'ortho plus larges** : `ORTHO_SPAN` 4 → 8, au moins pour z15–16 (±3,3 km à z15) | ortho nette deux fois plus loin | ×4 tuiles par niveau élargi, limité par 8 requêtes à la fois et le quota Géoplateforme (40/s/IP) | réseau |
| 9 | **Choisir le niveau d'ortho et de relief d'après la distance dans la fenêtre** (empreinte au loin, pas seulement sous l'avion) ; anisotropie 4 → 8 lectures | sol rasant plus net | coût de lecture par pixel ×1,5–2 sur le sol | moyen (perf) |
| 10 | **Normale de l'ombrage lue dans la donnée**, pas dans le maillage, au-delà du patch (`earthNormalAt` sur les tuiles déjà chargées au lieu de `rasterNormal`) | relief éclairé finement jusqu'à la portée des tuiles (plusieurs km) | quelques lectures de tuile par pixel | moyen (coutures) |
| 11 | **Arbres retirés plus loin** : `minPx` 2,5 → 1,5 | forêts jusqu'à ~4 km | 1,5–2,5 ms sur M1 en ville (commentaire du code) | perf |
| 12 | Ortho z19 et LiDAR z18 près du sol (au roulage, à basse hauteur) | 0,2 m d'ortho, 0,4 m de relief au roulage | bande passante ×4 par niveau | réseau |
| 13 | Cache mémoire et anneau pré-chargé pour les orthos comme pour le relief | pas de retéléchargement en revenant | mémoire | faible |

**Ordre conseillé :**
1. Le 1 (ou le 1b tout de suite) et le 2 : ce sont des défauts nets, pas du réglage.
2. Puis 3, 4, 6, 5, 7 pour l'eau : tous bon marché.
3. Puis la portée du détail : 10 d'abord (le plus visible pour le coût), ensuite 8, 9, 11.

Chaque étape avec capture A/B en raster (e2e de vol bas sur kerr-mini) et `perf-suite` avant/après, comme pour le plan des noyaux.

**À regarder en jeu avant de toucher à l'eau** : `TUNE_LITE` 512 peint en rouge ce que l'ombrage prend pour de l'eau. Si la bizarrerie commence vers 2,5–7 km, c'est la portée OSM (causes 3–4) ; si elle est là à toute distance, c'est le niveau des vagues (cause 1).
