# J9-5 — Ombres découpées des arbres proches, lumière commune, contact visuel et reprise

20 novembre 2026. Ce lot remplace dans la carte d'ombre des arbres (`tsmTex`, couche 0 de `encodeShadow`) les enveloppes pleines des proxies par la **géométrie 3D découpée en LOD 1** pour tous les arbres proches (`≤ 84 m` autour de la caméra, dans le champ ou hors champ), adapte la lecture `treeShadowAt` (`src/system/tree-shadow.ts`) au domaine proche (filtrage bilinéaire `2 × 2` à `0,88 m` et biais de contact réduit à `0,55 m + 1 texel`), allège l'ombre des houppiers caducs lointains en hiver, et vérifie l'éclairage commun (Soleil rasant, crépuscule/nuit sous la pluie), la stabilité de `tsmDraws` au repos/pause/pas, la forêt hors champ et l'alignement des cylindres de collision CPU (`SceneryContact`).

## Ce qui a changé

1. **Listes et pipelines d'ombre 3D découpée (`src/vegetation/tree-near.ts`, `src/system/scenery-raster.ts`)** :
   - `NearDraws` passe à 36 entrées (`NEAR_TREE_SLOTS = 36` : `0..11` visibilité LOD 0, `12..23` visibilité LOD 1, `24..35` ombre LOD 1).
   - Dans `cull`, **avant** le test de frustum caméra, lorsque `sun.c.w > 0.5`, `nearShadowKeep(k, t, hd)` capture tous les arbres dans la sphère proche (`dNow <= nearU.y * 1.05`, qu'ils soient vus ou derrière la caméra) vers les listes `24..35` ; en cas de dépassement de capacité (`at >= nearU.z`), l'arbre retombe sur la liste d'ombre proxy (`LISTS + 1 / 2`) sans perte d'ombre. Au-delà de `84 m` et jusqu'à `±900 m`, la forêt hors champ et lointaine continue d'alimenter `LISTS + 1 / 2`.
   - Douze pipelines `nearTreeShadowVs` / `nearTreeShadowFs` (`label: "near tree shadow"`, `depthCompare: "less"`) dessinent les triangles LOD 1 dans la couche 0 de `tsmTex`, en rejetant les vides de `leafMask` et, en hiver (`v.bare > 0.5`), les cartes de feuilles des feuillus pour ne projeter que l'ombre 3D du tronc et de la ramure.
   - Sur les frames où `sunOn` est faux (`tsmRedraw = false`), `nearTrees.prepare(false)` conserve les compteurs des tranches `24..35` de la dernière cuisson d'ombre (`readCounts().shadow`).
2. **Filtrage proche et biais de contact dans `treeShadowAt` (`src/system/tree-shadow.ts`)** :
   - Pour la couche 0 (`trees' shadow map`) lorsque `nearTreeGeometryOn` est actif (`P.scenery[6].w > 1.5`), `nearK = 1 - smoothstep(55, 85, length(p - P.scenery[3].xyz))` réduit le biais de profondeur de `1,5 m + 2 texels` (`3,26 m`, requis par les octaèdres circonscrits des proxies) à `0,55 m + 1 texel` (`1,43 m`) afin que les troncs, branches basses et arbustes portent ombre jusqu'au pied, et interpole sans lecture supplémentaire le filtre bilinéaire `2 × 2` interne (`0,88 m`) vers le filtre `3 × 3` (`2,64 m`) au-delà de `85 m`.
   - Pour les feuillus lointains en hiver (`part == 0 && bare > 0.5`), `shadowFs` (`kind == 3`) ajoure la sphère proxy au lieu de projeter un disque d'été plein.
3. **Fréquence de mise à jour amortie (`src/renderer.ts`)** :
   - `tsmNearKey` suit l'état de la géométrie proche (`nearActive`, `reachM`, `debugTreeId`, `capacity`, et une grille de `32 m` lorsque la caméra évolue à basse hauteur `< reachM + 40 m`). Au repos, en gel (`freeze(true)`) ou au pas-à-pas (`step`), `tsmDraws` reste strictement constant (`0` redessin superflu).

## Preuves mesurées sur `kerr-mini`

- **Compilations WGSL :** `20261120-133411-j9-5-wgsl` — **84/84 shaders** compilent sur Apple (`kerr-mini` et local).
- **Campagne e2e complète (`20261120-134219-j9-5-full3`) :** exit 0, **173 assertions**, **53 relevés thermiques Nominal** (`1 278 MHz` médian), résolution `1920×1080` (interne `1440×810`, tier 2, `rasterRate = 1`, borne 30) :

| Vue | A/B/A p50 (ms) | Instances vue / ombre 360° | Texels d'ombre proches (proxy → 3D) | Ouvertures découpées (`carvedOpenings`) | Forêt hors champ (`farOccluded`) | Hiver (proxy → 3D) | `tsmDraws` immobile (600 ms) | Contact CPU (` < 60 m`) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `maures-floor` (`3 m` AGL) | `68,2 → 54,8 → 66,5` | `44` (`2` L0 + `42` L1) / **`182`** | `3 907 → 3 080` (`A/A = 0`) | **`948`** (`both: 5 256`) | **`903 729`** | `5 046 → 4 860` | `16 → 16` (`+0`) | `94` arbres (`1 726` seg.) |
| `maures-low` (`60 m` AGL) | `59,5 → 60,2 → 59,3` | `0` / **`123`** (au sol sous 60 m) | — | — | — | — | — | — |
| `chamonix-slope` (`5 m` AGL) | `71,4 → 59,3 → 71,8` | `18` (`2` L0 + `16` L1) / **`73`** | `1 629 → 1 249` (`A/A = 0`) | **`411`** (`both: 2 265`) | **`1 063 869`** | `15 214 → 15 156` | `41 → 41` (`+0`) | `55` arbres (`1 723` seg.) |

- **Témoin positif d'ombre :** `debugSkip = 1` avec isolation ramène `nearOccluded` à `0` (contre `3 080` aux Maures et `1 249` à Chamonix) tout en conservant l'ombre de la forêt lointaine.
- **Soleil rasant (`05:35 UTC`) et crépuscule/nuit sous pluie (`19:45 UTC`, `weather: "rain"`) :** `48 742` et `48 568` pixels de géométrie 3D valide aux Maures (`19 296` et `19 282` à Chamonix), 0 erreur GPU/console.

## Limites et suite

- **Marche en raster (`walkRasterOn`) :** évaluée séparément conformément au plan (§6 l. 152) — J9 supprime le coût de rayons des arbres proches mais ne modifie ni le personnage fantôme ni le coût du sol proche relevés en J5 ; `walkRasterOn` reste éteint par défaut.
- Prochaine étape : **J9-6** (disponibilité PWA / rechargement hors ligne de l'asset KTG1 `trees-v1-*.bin` sans requête réseau, compteurs mémoire GPU bornés et non-régression J8), puis **J9-A** et **J9-R**.
