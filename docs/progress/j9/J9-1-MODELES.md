# J9-1 — Modèles sources vus en géométrie directe

20 novembre 2026. Six sortes, deux proportions par sorte ; planche de côté, dessous et dessus, plus le feuillu sans feuilles
pour examiner la ramure. [Planche interactive](models.html). Éclairage fixe de diagnostic : aucune revendication sur le matériau
final, les ombres ou le coût dans la frame du jeu.

Le nouvel e2e `j9-models` dessine directement les positions, normales, attributs et indices de `treeModel` dans des cibles
GPU temporaires. Il ne lit pas l'atlas d'imposteurs. Les buffers, cibles et tampons de lecture sont détruits même en cas d'erreur.
Le masque `leafMask` est extrait dans `src/vegetation/tree-leaf.ts`, partagé avec la cuisson sans changement sémantique.
L'outil d'inspection reste dans les e2e ; aucune nouvelle commande produit ou API TARS.

Les premières planches ont révélé des conifères très clairsemés : la ligne de sprays d'aiguilles sur chaque branche est
remplacée par deux éventails latéraux, tournés vers le ciel, sur une plus grande partie de la branche. Le cône, le pied,
la hauteur et les sortes du monde restent les mêmes. Le conifère large passe de 2 678 à 4 622 triangles ; l'élancé de 2 038
à 3 232. Ce surcroît de contenu n'est pas présenté comme une optimisation.

Preuves sur kerr-mini : `20261120-101201-j9-models-inspect` avant, `20261120-101351-j9-models-dense` après, exit 0, aucune
erreur GPU/console ; planches regardées. `20261120-101615-j9-wgsl` : 84/84 shaders compilent sur Apple. Tests modèles et
vues octaédriques passent ; déterminisme, sommets finis et bornes d'enveloppe sont conservés. Inventaire :
[models-j9-1.json](models-j9-1.json), source identifiée par SHA-256 ; l'inventaire J9-0 reste inchangé.

Les troncs et branches sont réellement modélisés ; les cartes occupent le volume du houppier. Les deux proportions
existantes sont conservées ; aucune espèce botanique nouvelle n'est inventée. Le matériau d'écorce, la saison et le vent du
proche seront intégrés dans J9-3/J9-4 ; l'image de jeu et le raccord proche/loin restent à juger. La cuisson V2 reprend la
même source à la prochaine création de ses textures, sans cache d'atlas persistant à migrer.

Limites : pas de validation de coût de forêt soutenu après le changement des aiguilles ; pas encore de géométrie proche
dans la frame du monde. La forme au-dessous du houppier et la ramure sans feuilles sont observées ici, mais les témoins
d'occlusion entre arbres seront jugés sur le futur lecteur de profondeur J9-3, pas sur cette seule planche.
