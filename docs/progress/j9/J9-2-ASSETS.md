# J9-2 — Géométrie partagée préparée et LOD 0 / LOD 1

20 novembre 2026. Le build Bun produit vingt-quatre modèles partagés (12 couples espèce/proportion × 2 niveaux de détail, LOD 0 et LOD 1) sans génération ni simplification pendant une frame.
`src/vegetation/tree-assets.ts` définit KTG1 : en-tête versionné, table de modèles (sorte/proportion/LOD, erreur canonique, bornes,
rayon, comptes et offsets), sommets entrelacés de 10 flottants (position, normale, UV, matière, ombrage), indices u32.
La lecture refuse tailles, versions, offsets, indices, bornes ou valeurs non finies invalides et doublons de modèles.

Le manifeste `assets/vegetation/trees-v1.json` porte la révision SHA-256 des sources, le nom du fichier adressé par contenu (`trees-v1-b31429154c38b2fd.bin`),
son SHA-256 et ses octets. Le binaire est gzip, placé dans Git LFS selon ASSETS ; les générations antérieures ne sont pas
écrasées. Les 24 modèles sont téléversés une seule fois dans deux tampons GPU partagés (un tampon de sommets et un tampon d'indices indexés par `firstIndex` et `baseVertex`).

## Meshoptimizer et construction de LOD 1 à silhouette et perméabilité conservées

Version npm vérifiée et installée : **1.3.0, MIT**, documentation JS de la version lue :
[API officielle v1.3](https://github.com/zeux/meshoptimizer/blob/v1.3/js/README.md). Bun exécute ses modules JS/WASM après
`ready`. Adoption bornée au build (devDependency) : `reorderMesh(..., true, false)` pour organiser sommets et indices sur les 24 modèles.
Le codec runtime n'importe pas meshoptimizer. Ni simplificateur ni décodeur dans la boucle d'image.

L'essai de simplification générique par effondrement d'arêtes (`barkLodStudy`) ne touche que les branches et laisse les cartes de feuilles déconnectées intactes : la plupart des modèles restent presque identiques.
Pour obtenir un **LOD 1 utile** sans trou artificiel ni saut d'enveloppe, `treeModel(kind, aspect, seed, 1)` partage exactement le même flux aléatoire, le même tronc et les mêmes centres d'amas (`clumps`) que LOD 0 :
- les coudes terminaux à enfant unique (`flow <= 1`) sont fusionnés et les prismes d'écorce passent à 3 faces (`SIDES = 3`), préservant le squelette principal en hiver ;
- chaque amas de feuillage, rameau de conifère ou palme est consolidé en `1/3` (ou `1/2` pour les palmiers) de cartes compensées (`s × 1,38..1,42`, bornées au rayon d'amas `rad0`), toutes réordonnées par `meshoptimizer`.
- L'étude `lodStudy` du manifeste mesure sur une grille orthographique CPU avec `leafMask` : **60,1 % à 64,2 % de réduction de triangles sur chacun des 12 modèles** (`78 452` triangles au total en LOD 0 → `29 496` triangles en LOD 1, soit **−62,4 %**), avec une couverture optique latérale et zénithale conservée à mieux que 3,8 % et une erreur canonique bornée (`0,0022` à `0,0466`).

## Preuves et limites

- 9 519 424 octets décompressés (6 832 080 octets de sommets + 2 686 416 octets d'indices + 928 octets d'en-tête et table pour les 24 modèles), 3 979 761 octets gzip.
- Les tests unitaires (`tests/tree-model.test.ts`, `tests/tree-assets.test.ts`) vérifient la réduction `> 55 %` sur chacun des 12 modèles, la conservation de couverture `leafMask` latérale et zénithale, la concordance exacte de chaque triangle et attribut avec la source après réordonnancement, et rejettent versions, offsets, indices, doublons et NaN invalides.
- Deux builds identiques produisent les mêmes octets. Typecheck et Biome passent.
