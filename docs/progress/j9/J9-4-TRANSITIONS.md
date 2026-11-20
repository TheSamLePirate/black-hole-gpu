# J9-4 — Sélection de LOD avec hystérésis, raccord géométrie ↔ imposteurs V2, saisons, vent et vecteurs de mouvement

20 novembre 2026. Ce lot complète les **LOD géométriques utiles** de [J9-2](J9-2-ASSETS.md) (24 modèles KTG1 : 12 × LOD 0 + 12 × LOD 1, réduction de triangles de **60,1 % à 64,2 %** sur les 12 couples espèce/proportion) et livre **J9-4** : sélection LOD 0 / LOD 1 par erreur projetée avec hystérésis sur le GPU, raccord direct à 80 m entre géométrie 3D et imposteurs V2 (sans anneau intermédiaire d'enveloppes pleines non sculptées entre 80 m et 200 m), saisons (couleurs d'automne et couronnes caduques nues en hiver), vue du dessous à la base des troncs et vecteurs de mouvement du balancement au vent (`o.mot`).

## Ce qui a changé

1. **Deux tampons GPU partagés pour les 24 modèles (`NearTreeGeometry`)** :
   - Les 24 modèles de `trees-v1-b31429154c38b2fd.bin` (`9 519 424` octets décompressés, `3 979 761` octets gzip) sont téléversés une seule fois dans **un tampon de sommets unique** (`6 832 080` octets) et **un tampon d'indices unique** (`2 686 416` octets), indexés par `firstIndex` et `baseVertex` dans `drawIndexedIndirect` (sans dépendre de l'extension WebGPU optionnelle `indirect-first-instance`).
2. **Sélection LOD 0 / LOD 1 par erreur projetée et ancre d'hystérésis GPU (`nearDraws.anchor`)** :
   - Dans `cull` (`src/system/scenery-raster.ts`), la distance courante `dNow` est évaluée à l'œil courant et la distance d'hystérésis `dHyst` à l'ancre `nearDraws.anchor` (mise à jour dans `clampDraws` dès que la caméra s'éloigne de plus de `2,5 m` de l'ancre), avec une bande morte de `±5 %` (`hyst = clamp(1 + (dNow - dHyst) * 0.025, 0.95, 1.05)`) et une gigue déterministe par cellule de `±4 %` (`jit = 0.96 + 0.08 * t.seed`).
   - L'erreur projetée `errPx = 0.025 * max(t.height, 2.0 * r) * pxPerM * hyst * jit` sélectionne LOD 0 au premier plan et bascule vers LOD 1 lorsque `dNow > 0.52 * lim || errPx < 3.2`.
   - `readCounts()` expose `{ instances, lod0, lod1, overflow }` par espèce/proportion.
3. **Raccord géométrie 3D ↔ imposteurs V2 à 80 m et cuisson alignée (`sceneryTreeLite`, `tree-impostors.ts`)** :
   - `BAKE_WGSL` (`src/vegetation/tree-impostors.ts`) applique exactement la même inclinaison verticale (`dz`) aux éventails d'aiguilles de conifères, la même normale hémisphérique `nCrown` et le même ombrage radial/vertical `crDepth` que `nearTreeVs`.
   - Quand `nearTreeGeometryOn` est actif (`P.scenery[6].w = 2`), `sceneryTreeLite` (`src/shaders/trace.wgsl`) abaisse le seuil d'entrée des imposteurs `impNear` de `200 m` à `0 m` : dès la sortie de la géométrie 3D à 80 m, les proxies passent **directement** à `sceneryTreeImpostor` avec la même rotation déterministe par cellule (`6.2831853 * tree.seed`), la même échelle d'enveloppe (`0.8 * r`, `0.86 * H`) et le même relief/grain (`0.55 * clump`, `0.8 + 0.2 * grain`), supprimant l'anneau d'œufs lisses de `80..200 m`.
   - En hiver (`bare > 0.5`), les feuillus proches en géométrie 3D rejettent leurs cartes de feuilles (`attr.z > 0.5 && v.bare > 0.5`) pour ne conserver que leur tronc et leur ramure 3D, tandis qu'au-delà de 80 m `sceneryTreeLite` prolonge les houppiers caducs nus par `forestTwigs` jusqu'à `160 m`.
4. **Balancement au vent et vecteurs de mouvement (`o.mot`)** :
   - `nearTreeVs` évalue `forestSwayAt(cell, P.wind.xy, P.wind.z, P.wind.w)` (pose courante et pose précédente) pondéré par `weight`.
   - Comme `proxyVs`, `nearTreeVs` n'écrit `o.mot` (`o.mot.z = 1.0`) que lorsque `any(sw != vec2f(0.0))` : à vent nul ou `treeWindOn = false`, `o.mot` reste à zéro (la reprojection temporelle utilise profondeur + caméra) ; sous le vent, `o.mot` fournit le déplacement écran exact de chaque sommet de branche et de feuille.

## Preuves mesurées sur `kerr-mini`

- **Compilations WGSL :** `20261120-125559-j9-4-wgsl` — **84/84 shaders** compilent sur Apple (`kerr-mini` et local).
- **Campagne e2e complète (`20261120-130901-j9-4-full3`) :** exit 0, **129 assertions**, état thermique **Nominal** de bout en bout, résolution `1920×1080` (interne `1440×810`, tier 2, `rasterRate = 1`, borne 30) :

| Vue | A (rayons proches) p50 / p95 | B (géométrie J9, LOD 0 + LOD 1) p50 / p95 | A (retour rayons) p50 / p95 | Instances (LOD 0 / LOD 1 / refus) | Témoins d'occlusion & transitions |
|---|---:|---:|---:|---:|---|
| `maures-floor` (`3 m` AGL) | `67,4` / `72,0 ms` | **`53,9` / `57,3 ms`** (−13,5 ms) | `66,2` / `70,2 ms` | `44` (`2` LOD 0 / `42` LOD 1 / `0` refus) | Couronne-couronne (`1239356` devant `1241186`) : `480` recouvrements (`0` err), `38` ouvertures (`0` err) ; vent : `0` px mobile calme → `49 339` px mobiles sous vent ; hiver : écorce `37 → 3 527` px, feuilles `49 700 → 37 096` px ; dessous (`0,8 m` AGL, pitch `+11°`) : `38 044` px (`100 %` prof/id) ; hystérésis : approche `33` vs recul `41` instances |
| `maures-low` (`60 m` AGL) | `58,7` / `62,5 ms` | **`59,3` / `63,4 ms`** | `59,0` / `62,9 ms` | `0` (`0` / `0` / `0` refus) | Aucun arbre dans la sphère de 80 m |
| `chamonix-slope` (`5 m` AGL) | `70,5` / `74,9 ms` | **`59,3` / `63,8 ms`** (−11,2 ms) | `70,5` / `74,3 ms` | `18` (`2` LOD 0 / `16` LOD 1 / `0` refus) | Bâtiment derrière arbre (`1736718` devant bâtiment `code 62`) : `4 287` recouvrements (`0` err), `25` ouvertures (`0` err) ; vent : `0` px mobile calme → `18 357` px mobiles sous vent ; hiver : écorce `499 → 2 648` px, feuilles `17 888 → 10 083` px ; dessous (`0,8 m` AGL, pitch `+6°`) : `17 131` px (`100 %` prof/id) ; hystérésis : approche `18` (`1` LOD 0) vs recul `19` (`2` LOD 0) |

## Limites et suite

- Le prototype reste derrière `nearTreeGeometryOn = false` par défaut jusqu'à l'acceptation **J9-A**.
- Les ombres portées au sol des arbres proches passent encore par les enveloppes proxies dans `encodeShadow` : c'est l'objet du lot suivant **J9-5** (ombres découpées des arbres proches en géométrie, éclairage commun, Soleil rasant, nuit/pluie et reprise).
