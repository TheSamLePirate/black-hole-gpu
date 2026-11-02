# La Terre en raster — escaliers, triangles, chargement, mer (analyse du code, 2026-11-02)

Analyse **du code seulement** : aucun test, e2e ni capture n'a été lancé. Les causes sont déduites du code ; chacune
donne le levier qui permet de la confirmer à l'image sur kerr-mini (§7). Distances à 47° N (cos φ ≈ 0,68).
Suite de [ANALYSE-TERRE-RASTER-2026-10-28.md](ANALYSE-TERRE-RASTER-2026-10-28.md) : depuis, **aucune** de ses
recommandations n'a été appliquée (seuls `d5e6677d` et `f3aa71e5` ont touché ces fichiers).

## En bref

| Symptôme | Cause principale | Depuis | Où |
|---|---|---|---|
| **Escaliers dans le relief** | Agrandissement des tuiles par une **cubique monotone** (Fritsch–Butland) : pente forcée à 0 à chaque palier ou extremum des données. Les données au mètre près (SRTM) deviennent des marches ; le bruit radar, des creux plats alignés sur la grille Mercator. Le patch de 1,2 m dessine exactement cette forme. | 22/10 (`831e2f61`), rendu visible par I3 le 23/10 (`0b8b8a7f`) | `trace.wgsl` `monoCubic`, `tileSample` ; `earth-tiles.ts` `sampleLevel` ; `TUNE_TILE_CR = 2` |
| **Triangles visibles** (toujours) | La normale d'éclairage est celle du **maillage**, plate par triangle : 1,2 → 2,4 → 9,5 → 38 → 153 m. Seule l'IGN, sous 10 m d'empreinte, y échappe. | toujours | `rasterNormal` (`trace.wgsl:13033`) |
| **Triangles visibles au chargement** | Anneaux sans fondu ni géomorphose : la bande de chevauchement de 4 nœuds laisse les grands triangles du niveau grossier **percer** le niveau fin. Les niveaux du cache sont recuits **un par image**, depuis des états de tuiles différents. Et, **régression d'I3**, le garde-fou des coutures ne voit plus 4 coutures sur 6. | 23/10 (I3) | `terrain-raster.ts` `drawRing`, `RING_OVERLAP` ; `terrain-cache.ts` `encode` ; `renderer.terrainRings` `step` |
| Pas d'ombres portées du relief | La carte d'ombre du Soleil ne contient **que le patch (±76 m)** ; `shadeLite` ne fait aucune marche. Une montagne n'ombre donc pas la vallée. | 23/10 (I3) — déjà signalé le 28/10 | `terrain-raster.ts` `encodeSunShadow`, `liteSun` |
| Mer : moiré, motif répété, côte en dents de scie | Niveau des vagues isotrope (moyenne géométrique de l'empreinte). Tuile de 1 km répétée. **Côte = isoligne 0,5–2 m du maillage** (triangles de 38 à 611 m), puis masque ETOPO de 4,9 km. | inchangé | `shadeWater`, `seaWavesFft`, `shadeLite` (masque) |
| Chargement | Ordre niveau par niveau, du grossier au fin. Un niveau n'est dessiné que **complet**. Un créneau de chargement reste bloqué pendant l'attente du quota IGN. Décodage PNG sur le fil principal. Orthos sans cache. | inchangé | `earth-tiles.ts` `request`, `complete`, `pixels` |

---

## 1. Les escaliers : la cubique monotone

### Le mécanisme

`tileSample` (`trace.wgsl:6821+`) passe du bilinéaire à une cubique dès que le texel dépasse deux fois l'empreinte
(`k = clamp(mag − 1, 0, 1)`). Depuis `831e2f61` (22/10), `TUNE_TILE_CR = 2` par défaut : c'est la cubique monotone
`monoCubic`, appliquée en x puis en y. Le CPU fait de même (`earth-tiles.ts:1396 sampleLevel`).

```
m1 = (d0·d1 > 0) ? 2·d0·d1/(d0 + d1) : 0
```

La pente au nœud est la moyenne harmonique des deux sécantes. Elle **vaut 0** dès qu'une sécante est nulle ou que les
deux changent de signe, et elle est presque nulle quand l'une est petite.

- **Données quantifiées** (SRTM au mètre entier, la source de Terrarium sur la plupart du monde) : sur une pente douce,
  les texels se suivent en paliers (100, 100, 100, 101, 101…). Les paliers restent parfaitement plats, chaque marche
  devient un S raide : **un escalier de 1 m de contremarche**.
- **Bruit des données** (le radar de SRTM, ±quelques m) : chaque extremum local le long d'un axe reçoit une pente nulle.
  La surface se couvre de petits plats et de plis **alignés sur la grille des tuiles**, toujours en marches.
- La B-spline d'avant (`TUNE_TILE_CR = 0`) lissait sur 4 texels (~26 m à z14) et effaçait ces deux défauts.
  Elle arrondissait en revanche les falaises de Monument Valley, d'où le changement.

### Pourquoi ça se voit depuis I3 (23/10)

Le cache cuit chaque niveau avec une empreinte d'un demi-pas de nœud (`terrainWindowParams`, `foot = pas/2`). À 47° N :

| Niveau | Pas | Empreinte | zf | Lecture hors relevé (z14, 6,5 m) |
|---|---:|---:|---:|---|
| 0 (patch, ±76 m) | 1,2 m | 0,6 m | 17,4 | mag 3,4 → **cubique monotone pleine** |
| 1 (±153 m) | 2,4 m | 1,2 m | 16,4 | mag 2,4 → **cubique monotone pleine** |
| 2 (±611 m) | 9,5 m | 4,8 m | 14,4 | bilinéaire |
| 3 et au-delà | 38 m… | 19 m… | ≤ 12,5 | bilinéaire |

Avant I3, le patch était à 153 m de pas : la forme de la cubique n'apparaissait jamais. Depuis I3, les 1,2 et 2,4 m
dessinent chaque texel de 6,5 m avec 5 nœuds, et donc la marche exacte.

L'éclairage par la normale du maillage (§2) découpe ensuite chaque contremarche en bandes. Deux autres changements
aggravent le défaut :
- le bruit procédural (`earthDetail`), qui le masquait en partie, est coupé dans les noyaux du raster (plan des noyaux P4,
  `NEAR_DETAIL = 0`) ;
- il est aussi effacé sous les relevés (I2).

### Où, quand

- **Hors France / Suisse, en permanence**, au sol et en vol bas : le patch et l'anneau 1 lisent z14 en cubique.
- **En France, pendant le chargement** :
  - tant que les fenêtres z15–17 (IGN, 4 tuiles) ne sont pas là ;
  - à chaque recentrage de ces fenêtres. z17 se recentre tous les ~170 m (0,8 tuile), et la partie neuve reste
    invalide jusqu'à ses tuiles (`setValid(intersect(...))`).

  Entre-temps, les niveaux 0 et 1 relisent z14 (ou plus grossier) en cubique. Le relief IGN z14 est lisse, mais les
  plis d'extremum restent. Les niveaux z6–10 de Terrarium donnent de grands « plateaux » pendant les premières secondes.
- Le passage bilinéaire → cubique sur une octave (`mix(lin, cubic, k)`) laisse en plus, dans le traceur (`main`,
  `shade`), des plis bilinéaires alignés sur les texels là où mag ∈ ]1, 2[.

### Correctif proposé

Garder la monotone **seulement là où elle sert** : les falaises, et les relevés, dont les données sont propres.
- Pente au nœud : `mix(m_CatmullRom, m_FritschButland, s)`, où `s` monte avec la raideur du texel (|d| / texel > ~0,5)
  ou avec la marque de relevé (`tileFine`). Ailleurs, B-spline ou Catmull–Rom.
- **CPU et GPU à l'identique** : `sampleLevel` et `tileSample`, pour garder le contact du train.
- Variante plus robuste pour SRTM : un pré-filtre au décodage des tuiles Terrarium z13–14 non marquées (3 × 3 gaussien,
  ou tramage ±0,5 m avant le flou). Il casse la quantification à la source, pour tous les chemins.

**Confirmation** : `tune {TUNE_TILE_CR: 0}` contre `{TUNE_TILE_CR: 2}`, même vue basse en raster, soleil rasant, sur une
pente douce hors Europe (SRTM pur), puis en France avec `earthIgnRelief` coupé.

---

## 2. Les triangles visibles

### 2a. La normale du maillage (toujours)

- `shadeLite` éclaire avec `rasterNormal` (`trace.wgsl:13033`) : le produit vectoriel des distances de deux pixels
  voisins. C'est la normale **du triangle**, constante sur toute sa surface, avec une cassure le long de chaque diagonale.
- `earthSlopeFine` ne la remplace que sur un **relevé** (`tileFine`), pour un texel ≤ 10 m et une empreinte < 10 m
  (`d5e6677d`).
- Partout ailleurs, on voit les facettes de 1,2 / 2,4 m près du sol, puis 9,5 m jusqu'à 611 m, 38 m jusqu'à 2,4 km,
  153 m jusqu'à 10 km.
- L'eau en hérite aussi (`shadeWater` : `n` pour le décalage d'ombre).

**Correctif** :
1. **Des normales lisses par nœud** : différences centrées sur la grille du cache, dans `terrainVs` (4 lectures de
   table de plus par sommet) ou cuites avec les hauteurs. Elles sont interpolées sur le triangle et écrites dans la
   cible de visibilité. Le canal `a` est déjà pris : il faut une seconde attache `rg16snorm` en octaèdre (~4 o/px).
   `shadeLite` les lit à la place de `rasterNormal`.
2. **Le détail des tuiles par-dessus**, pour toutes les données et pas seulement les relevés : généraliser
   `earthSlopeFine` sous 2 km (lecture ancrée, `TILE_ANCHOR_M`), avec un fondu vers la normale du nœud. Au-delà de 2 km,
   le float32 limite la précision (~0,4 m) : la normale du nœud suffit.

**Confirmation** : `tune {TUNE_LITE: 16}` coupe la normale du maillage (ellipsoïde seule). Si les triangles
disparaissent avec le relief, c'est elle.

### 2b. Les coutures entre anneaux (pendant le chargement surtout)

- Le patch et chaque anneau sont des grilles 129² **indépendantes** (`drawRing`). Le niveau grossier retire les
  triangles entièrement dans le fin, et garde une bande de chevauchement de `RING_OVERLAP = 4` nœuds fins. Le test de
  profondeur garde le plus proche.
- Les deux surfaces ne coïncident pas :
  - le niveau grossier est cuit avec une empreinte 4 fois plus large (2 fois entre 0 et 1), donc sur des tuiles plus
    grossières, en bilinéaire là où le fin est en cubique ;
  - dans une vallée, la surface grossière est au-dessus de la fine ; sur une crête, en dessous.
- Dans la bande, les **grands triangles grossiers percent le maillage fin** : des triangles de 2 à 4 fois la taille
  locale, éclairés par leur propre facette. Ils forment un anneau autour de chaque fenêtre, à 76 m, 153 m, 611 m,
  2,4 km et 9,8 km.

**Régression d'I3, le garde-fou des coutures** :
- `rasterNormal` refuse de calculer une normale à travers une couture quand `terrainRasterLevelStep` diffère d'un
  pixel à l'autre (le correctif des « lignes blanches » sur la mer).
- Or `step = max(0, lv − max(level, PATCH_REF = 4))` (`renderer.ts:8538`) vaut **0 pour les anneaux 1 à 4** : `a = 1`,
  comme le patch.
- Avant I3 (patch au niveau 2, anneaux à step 1 et 2), toutes les coutures étaient gardées. Depuis, **4 coutures sur 6
  ne le sont plus** : 76 m, 153 m, 611 m et 2,4 km.
- La normale y est faite de deux maillages différents, d'où une ligne de fausse pente le long de la couture.
- Le même `step` règle la tolérance du traceur (`RHINT_TOL`) : c'est voulu là, mais le marqueur sert aux deux.

**Pendant le chargement, l'écart grandit** :
- Révision du cache = `earthTiles.stamp` (`renderer.ts:5191`). Il change à **chaque** rectangle valide qui bouge :
  fenêtre recentrée, niveau complété.
- Chaque changement marque les 8 niveaux périmés, recuits **un par image** (`TerrainCache.encode` : un seul `dirty` par
  image). Pendant ~8 images, deux niveaux voisins sont cuits sur des états de tuiles différents.
- En vol bas, le stamp change à peu près toutes les secondes (z17 tous les 170 m, z16 tous les 340 m…) : la désynchro
  est quasi permanente.
- Les recuissons se font aussi sans fondu : la forme saute d'un coup.

**Correctifs (par ordre d'effet)** :
1. **Géomorphose CDLOD** dans `terrainVs` : sur les ~8 à 16 derniers nœuds avant le bord de sa fenêtre, chaque sommet
   d'un niveau glisse vers la hauteur du niveau suivant, interpolée au même point (la table contient déjà les deux
   niveaux). Les sommets impairs tombent sur le milieu des arêtes grossières.
   - Au bord, les deux maillages sont la même surface : plus de percée, plus de T.
   - Le chevauchement peut descendre à 1 nœud.
2. **Le vrai niveau dans le marqueur** : un code de couture séparé de la tolérance, par exemple `a = 1 + niveau/16`
   pour le raster du sol, au lieu de `0,5^step`. `rasterNormal` voit alors chaque couture.
3. **Cuire ensemble les niveaux voisins** :
   - quand des tuiles changent, recuire tous les niveaux périmés **dans la même image** (8 × 16 641 nœuds, à mesurer),
     ou au minimum les publier par paires (n, n+1) ;
   - ne marquer périmés **que les niveaux concernés** : ceux dont l'empreinte (zf ± 1) lit le niveau de tuiles qui a
     changé et dont la fenêtre le recoupe.

   Cela réduit aussi le coût permanent des recuissons en vol.
4. **Fondu de recuisson** : garder l'ancienne cuisson d'un niveau 0,2–0,3 s et interpoler en `terrainVs`. Le saut
   devient un glissement, comme les LOD des moteurs AAA.

**Confirmation** : `__bh` → `rasterRingsInfo` et la vue `TUNE_RASTER_PATHS: 2` pour voir les bandes. Puis une vue
figée pendant qu'un niveau de tuiles arrive (Chamonix, 300 m sol), captures image par image.

---

## 3. Les ombres du relief : seulement ±76 m (confirmé par le code)

- `encodeSunShadow` (`terrain-raster.ts:584`) ne dessine que `this.index`/`this.vertex`, le **patch** (niveau 0, ±76 m).
- La carte couvre pourtant ±10 km (`SUN_HALF_M`), et la table annonce une portée de `H × 0,98 = 9,8 km`
  (`renderer.ts:8288`). C'est le patch d'avant I3.
- Le reste de la carte est vide (profondeur 1), donc lu « éclairé ».
- `liteSun` (le matériau raster, presque tout le sol) lit `sunShadowFar(...).x` et **ne marche jamais**. Seul `shade`
  (le reste) reprend sa marche à la sortie annoncée, 9,8 km.

**Conséquence** : en raster, aucune montagne n'ombre la vallée. Seul l'ombrage propre (n·L) reste, sur des facettes
(§2a). C'est la plus grande perte « AAA » des vues basses au soleil rasant.

**Correctif** :
- Dessiner aussi les anneaux 1 à 4 dans la carte, avec leurs maillages et trous déjà calculés : ~130 k triangles de
  profondeur seule, < 0,2 ms.
- Une seconde cascade (±80 km, anneaux 5–6) pour les grandes ombres de fin de journée.
- Remettre la portée annoncée à celle qui est vraiment dessinée.

---

## 4. Le chargement des données

### Ce que fait le code

| Point | Comportement actuel |
|---|---|
| Ordre | `request` boucle sur les niveaux **du grossier au fin**, chacun du centre vers l'extérieur, `MAX_INFLIGHT = 8` en tout. En `veryFar`, z11–14 ont 8 × 8 tuiles : jusqu'à 256 tuiles passent avant z15. |
| Quota IGN | `ignGate.take()` est attendu **dans** `load`, créneau tenu. Une tuile de z11–13 avec silhouettes coûte jusqu'à 4 requêtes WMS-R (LiDAR, RGE, MNS LiDAR, MNS RGE en 512²), à 20/s. Les créneaux Terrarium/EOX restent bloqués derrière. |
| Validité | Un niveau n'est dessiné que sur son rectangle **complet** (`complete`). À un recentrage, la bande neuve, souvent devant (`gaze`), reste aux niveaux grossiers jusqu'à sa dernière tuile. |
| Anticipation | Anneau préchargé en cache seulement quand **plus rien** n'est en attente (`pending == 0`), pour les 2–3 niveaux les plus fins. |
| Orthos IGN | Fenêtres 4 × 4, **ni cache ni préchargement** (`requestOrtho`) : revenir ou recentrer retélécharge. z18 s'arrête à ±210 m. |
| Décodage | `pixels()` : `createImageBitmap`, puis `drawImage` + `getImageData` sur le **fil principal** (~1 ms/tuile), puis `writeTexture` de 512 Kio. Quand l'imagerie arrive, la tuile entière (hauteurs comprises) est **réécrite** (`put` avec `col`). |
| Échec | Après deux échecs, la tuile prend la carte globale ETOPO (4,9 km) : une **falaise carrée** au bord de la tuile. Rare, mais ce serait un « escalier » de 256 texels. |

### Recommandations

1. **Priorité par importance à l'écran, tous niveaux confondus** :
   - score = distance au point regardé / taille du texel du niveau ;
   - en pratique, les 2 × 2 tuiles centrales de chaque niveau fin passent avant la couronne extérieure des grossiers,
     puisque la carte globale couvre déjà le lointain ;
   - les surfaces MNS (silhouettes I6) passent **après** le sol nu de tous les niveaux.
2. **Deux files** :
   - l'IGN derrière son portillon, sans tenir de créneau pendant l'attente ;
   - Terrarium et EOX, en HTTP/2 sur S3, avec 12 à 16 requêtes en parallèle.
3. **Validité par tuile** : un masque de bits par niveau dans `P.tileL` (16 ou 64 bits) au lieu du rectangle complet.
   `earthH` saute une tuile absente comme il saute une fenêtre (même fondu de bord). Le fin apparaît tuile par tuile,
   sans attendre la dernière.
4. **Orthos** : cache LRU et anneau préchargé comme le relief ; `ORTHO_SPAN = 8` pour z15–16 (±3,3 km nets à z15).
5. **Décodage dans un worker** (`OffscreenCanvas` et `createImageBitmap` y existent, transfert du buffer). Hauteurs et
   imagerie dans **deux textures** (r32float, rgba8unorm-srgb) : on n'envoie que ce qui arrive. Voir le point suivant.
6. **L'imagerie dans une vraie texture filtrée**. C'est le plus gros levier qualité + perf du sol.
   - Aujourd'hui, l'imagerie des tuiles et des orthos est lue **texel par texel** dans `rg32uint` : bilinéaire à la
     main, **sans mips**, jusqu'à 4 prises le long de l'axe long.
   - Une `texture_2d_array<rgba8unorm-srgb>` avec mips par tuile (`mips.wgsl` existe), lue par `textureSampleGrad`
     avec `maxAnisotropy: 16` :
     - une lecture matérielle au lieu de 4 × 4 × n chargements par niveau ;
     - plus de scintillement en vue rasante ;
     - l'anisotropie 16 au lieu de 4.
   - Le tore des fenêtres reste compatible : mips à l'intérieur de chaque tuile, fondu de bord inchangé.

---

## 5. La mer

Rien n'a changé depuis le 28/10 ; les causes et les correctifs de l'analyse précédente (§3, #3 à #7) tiennent.
Ce qui s'ajoute en relisant `shadeLite` et `shadeWater` :

1. **La côte est l'isoligne 0,5–2 m du maillage** :
   - le masque de mer vaut `smoothstep(0.35, 0.65, ETOPO) · (1 − smoothstep(0.5, 2.0, hG))`, avec `hG` la hauteur au
     point **du maillage** (`rasterPoint`), pas des données ;
   - au-delà du patch, la côte est donc la coupe linéaire de triangles de 9,5 à 611 m, tous coupés dans la même
     diagonale : une **côte en dents de scie**, qui bouge à chaque recuisson ;
   - au-delà de la portée OSM (7 km), seul reste le masque ETOPO de 4,9 km.

   **Correctif** : prendre `hG` dans les tuiles à l'empreinte du pixel (`earthH(gq, foot, true)`, une lecture), et le
   masque WorldCover (classe 80, déjà chargé : `surfaceCover`) entre la portée OSM et le bord de sa zone.
2. **Terres basses lues comme mer** : sous un texel ETOPO « mer », toute terre sous 0,5 m devient de l'eau (Camargue,
   polders, marais). Le même correctif (WorldCover / OSM) le règle.
3. **Niveau des vagues** : toujours `footSea = √(|fx|·|fy|)` (`shadeWater`), la moyenne géométrique. En vue rasante,
   c'est plusieurs octaves trop fin : moiré, reflet qui pétille, et LEAN lu trop fin. Le sampler de la mer n'a pas
   d'anisotropie (`renderer.ts:1117`).

   **Correctif** : `lod` sur l'axe long (ou sur la moyenne log biaisée vers l'axe long), avec la variance LEAN ajoutée
   pour la différence ; ou `textureSampleGrad` avec un sampler `maxAnisotropy: 16`.
4. **Répétition de la cascade de 1 024 m** : rotation ou décalage par cellule de 4 km, mélangés sur leurs bords ; ou
   passage aux statistiques Cox–Munk quand `foot > L/16`.
5. SSR sans fondu en distance, écume qui change de modèle, rivières en miroir dur : voir l'analyse du 28/10.

---

## 6. La performance (lecture du code)

| Poste | Constat | Piste |
|---|---|---|
| Recuissons du cache | Une par image dès que le stamp bouge, soit en continu en vol. Chaque nœud : cubique (16 lectures × 2 niveaux), `earthDetail` (multifractale jusqu'à 7 octaves + gauchissement), et sur relevé deux `earthH` de plus. | Révision par niveau (§2b-3) ; `earthDetail` coupé dans la cuisson des niveaux ≥ 3, sous-pixel là-bas. |
| Imagerie dans `shadeLite` | `earthImageryAniso` : jusqu'à 4 niveaux d'ortho + 9 de tuiles, × n prises (≤ 4) × 4 chargements, plus la conversion sRGB à la main. | Texture filtrée avec mips (§4-6) : le gain le plus net du matériau. |
| Masque de mer | `seaDepthAt` (3 niveaux × 4 lectures) dès que `hG < 0,3` m, même loin de toute côte. | Un bit « tuile avec mer » par tuile, ou par cellule de la carte globale. |
| Pentes fines | `earthSlopeFine` : 4 `tileSample` bilinéaires (16 lectures). | À garder ; le généraliser (§2a) coûte autant, compensé par la normale lisse (plus de `rasterNormal` : 2 lectures et 3 `rasterRay`). |
| Fil principal | Décodage des PNG et JPEG, et `writeTexture` ×2 par tuile, pendant le chargement. | Worker (§4-5). |
| Carte d'ombre | Patch seul : peu coûteuse, mais vide (§3). | +130 k triangles de profondeur seule, mesurer. |

Déjà en bon état :
- l'ombrage en damier gouverné ;
- la cuisson d'un niveau déplacé dans son image (`47a85774`) ;
- l'imagerie ancrée en float64 sous 2 km (`d5e6677d`) ;
- les cuissons ancrées ;
- la FFT coupée quand aucune mer n'est vue.

---

## 7. Plan proposé et vérifications sur kerr-mini

Chaque étape : A/B en raster (e2e de vol bas, captures journalisées) et `perf-suite` avant/après, sur kerr-mini
(`--host kerr-mini`), une e2e IGN à la fois.

| # | Étape | Confirmation d'abord (levier) | Effet attendu | Coût estimé |
|---:|---|---|---|---|
| 1 | Cubique : monotone seulement aux falaises et sur relevés, CPU = GPU ; pré-filtre SRTM au décodage | `tune {TUNE_TILE_CR: 0}` / `2`, pente douce hors Europe, et France relief IGN coupé | fin des escaliers | nul |
| 2 | Marqueur de couture = vrai niveau (pas `step`) | captures sur les coutures 76 m / 153 m / 611 m | fin des lignes de fausse pente | nul |
| 3 | Géomorphose CDLOD aux bords des fenêtres, chevauchement 1 nœud | `TUNE_RASTER_PATHS: 2` + captures image par image pendant un chargement | fin des triangles qui percent | ~0 (VS) |
| 4 | Révision du cache par niveau + cuisson des voisins ensemble + fondu de recuisson | `rasterRingsInfo`, compteur `builds` du cache en vol | fin des sauts au chargement, moins de cuissons | gain |
| 5 | Normales lisses par nœud + détail des tuiles sous 2 km pour toutes les données | `tune {TUNE_LITE: 16}` | fin des facettes | +4 o/px, ±0 ms |
| 6 | Carte d'ombre : anneaux 1–4, + cascade lointaine | `TUNE_LITE: 4` (ombres coupées) : aucune différence au-delà de 76 m aujourd'hui | ombres des montagnes | < 0,3 ms |
| 7 | Mer : `hG` des tuiles, masque WorldCover, LOD sur l'axe long, casse de la répétition | `TUNE_LITE: 512` (eau en couleurs par sorte) | côtes nettes, mer sans moiré | < 0,1 ms |
| 8 | Chargement : priorité par importance, deux files, validité par tuile, orthos en cache | journal des tuiles (`pending`, `finest`, `orthoFinest`) sur un vol scripté | détail fin 2 à 5 × plus tôt | réseau |
| 9 | Imagerie en texture filtrée avec mips + aniso 16 | captures rasantes à 1–3 km | sol net et stable au loin | gain GPU |

Les étapes 1 et 2 sont de petits changements, sûrs et rapides à vérifier. 3, 4 et 6 corrigent ce qui reste des
triangles et donnent le relief AAA. 8 et 9 sont des chantiers plus longs.
