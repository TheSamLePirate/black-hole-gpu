# P1b — Terrain raster WGS84 et vues de comparaison

Statut : **pilote diagnostique implémenté, désactivé par défaut ; exécution et image non validées**.
Branche : `codex/aaa-terrestrial-renderer`, après le cache P1a (`a159802d`).

Ce lot construit la première passe de terrain par triangles. Il donne un outil de comparaison avant de
remplacer les intersections du traceur. Ce n'est pas encore le terrain raster du rendu final ni une preuve
de gain sur le M1 Max. Aucun test, vol ou benchmark de jeu n'a été lancé.

## Géométrie et données réutilisées

- Une grille indexée part de 129 × 129 sommets, 32 768 triangles, et lit les hauteurs float32 du cache P1a.
  Pour chaque piste (quatre au maximum), deux contours sont suivis : le ruban revêtu (0 → longueur,
  ± 30 m) et la zone nivelée (300 m avant/après, ± 320 m). Leurs huit coins reçoivent chacun une ligne de
  la grille, donc un sommet ; **les cellules traversées par un côté de contour sont ensuite coupées le long
  de ce côté**, quel que soit le cap de la piste. Seuils et bords sont ainsi de vraies arêtes du maillage,
  y compris pour une piste oblique. Chaque cellule coupée est découpée en pièces convexes, puis triangulée
  sans perdre de sommet (une pièce garde tous les points posés sur ses côtés).
  Les raccords sont sans fissure : un point de coupe sur un côté partagé se calcule à partir du contour et de ce
  côté seulement, les deux cellules voisines reçoivent donc le même sommet, y compris quand l'une d'elles n'a
  pas de segment à couper ; un point sur une arête interne se calcule depuis ses deux extrémités triées.
  Les coins de contour à moins de 2·10⁻³ cellule d'un nœud (0,3 m au niveau 2, 1 cm au niveau 0) et les
  coupes à moins de cette distance d'un coin sont ramenés à ce nœud : une piste presque alignée sur les axes ne
  fabrique pas de lamelle plus fine que les tolérances. Aux niveaux grossiers (cellules de plusieurs centaines
  de mètres) ce décalage atteint quelques mètres : sans conséquence tant que le ruban fait moins d'une cellule
  de large, mais à revoir si ces niveaux servent un jour de chemin d'atterrissage.
  Les contours sont des segments droits dans les coordonnées de la grille (longitude/latitude), pas des
  géodésiques : l'écart est de l'ordre du centimètre sur 4,5 km.
  Budget : au plus 12 288 sommets et 24 576 triangles ajoutés par les coupes. Mesures CPU de construction
  (une fois par fenêtre, niveau ou géométrie de pistes, jamais par image) : une piste au niveau 0, 583
  sommets/1 162 triangles ajoutés, 18 ms ; quatre pistes sécantes au niveau 0, 2 242 sommets/4 468 triangles,
  22 ms. Au-delà du budget, ou sans contour dans la fenêtre, le maillage retombe sur l'ancienne grille
  rectiligne (lignes à travers la portion : aucune jonction en T, mais pas d'arêtes alignées) ; `conforming`
  le dit dans les statistiques. Les sommets lisent le cache bilinéairement hors nivellement ; dans la zone, ils
  utilisent la fonction de référence avec une empreinte adaptée à leurs intervalles. Chaque sommet est partagé.
  La topologie ne change qu'avec la fenêtre, le niveau ou la géométrie des pistes, pas avec caméra/vent/horloge.
  Un seul niveau est dessiné à la fois, choisi explicitement entre 0 et 5 ; le niveau demandé est préparé
  en priorité. Il n'y a pas de nouvelle copie des hauteurs vers le CPU, ni de tableau de sommets par image.
- Le niveau 2 par défaut couvre environ 19,6 km nord-sud, avec des cellules de 153 m. Les autres niveaux
  permettent d'inspecter les échelles plus proches ou plus lointaines. La largeur est/ouest suit la latitude.
- Les sommets sont placés sur l'ellipsoïde WGS84, plus la hauteur le long de la normale géodétique.
  La courbure est conservée. L'ancrage du centre de fenêtre moins la position de caméra est calculé en
  float64 sur CPU ; les déplacements sont calculés en float32 sur GPU par différences trigonométriques
  stables. Le shader évite de soustraire deux positions absolues d'environ 6 000 km.
- Le dessin lit une fenêtre seulement quand sa préparation et sa copie précèdent la passe raster dans la
  soumission actuelle. Une fenêtre non prête laisse la vue actuelle visible.

Les hauteurs de P1a sont le **relief naturel filtré**. Le pilote recalcule désormais les sommets dans la zone
de nivellement des pistes avec `earthHeightExactG`, extraite de la même source WGSL : altitude, transition
et suppression du détail procédural suivent le modèle existant, à l'empreinte du niveau choisi. Aucun
tampon de hauteurs supplémentaire n'est ajouté. Les paramètres et textures sont partagés ; les valeurs
de piste sont relues à chaque dessin, sans dépendre d'une invalidation du cache naturel.

Les sommets des triangles qui touchent le ruban sont dans la zone plane de nivellement tant que les cellules
restent plus petites que sa marge (environ 290 m) : jusqu'au niveau 2, le ruban est donc plan par
construction. Aux niveaux plus grossiers, la planéité du ruban n'est pas garantie. La zone nivelée n'est cependant pas encore
validée en rendu : la hauteur vient de la fonction de référence, mais son accord avec le contact n'a pas été mesuré.
Le pilote ne dessine ni végétation, ni bâtiments, ni vagues et ne raccorde pas plusieurs fenêtres. Il utilise des
triangles à deux faces pour l'inspection. Aucun de ces choix n'est validé pour la visibilité finale.

## Contrat de profondeur de cette passe

| Donnée | Convention |
|---|---|
| Position raster | Mètres physiques, relative à la caméra, sur le repère terrestre WGS84 ; axes de vue actuels |
| Profondeur GPU | `depth32float`, reversed-Z, proche à 0,25 m, lointain infini : `zDepth = 0,25 / zVue`, clear 0, comparaison `greater` |
| Texture de distance | `r32float`, distance euclidienne positive en mètres ; 0 signifie aucune couverture du patch |
| Profondeur actuelle du jeu | `sceneDepth`, distance le long du rayon en M, convertie par `1476.625 × massSolar` |
| Normales de diagnostic | Différences finies des points reconstruits à partir de la distance, dans le repère de vue |
| Pose précédente / mouvement | Pas encore fournis par le pilote ; aucun nouvel historique temporel de terrain |

La distance métrique et la profondeur GPU sont distinctes. Le noyau de trace, les appareils, le personnage
et leurs occultations continuent de lire leurs données actuelles. La nouvelle texture ne leur est pas
substituée. Les interfaces d'API consultées sont celles de
[GPUDepthStencilState](https://gpuweb.github.io/types/interfaces/GPUDepthStencilState.html) et
[GPUTextureBindingLayout](https://gpuweb.github.io/types/interfaces/GPUTextureBindingLayout.html).
Le layout de lecture `r32float` est explicitement non filtrable ; aucune extension float32-filterable n'est demandée.

## Inspecteur et limites de la comparaison

L'inspecteur s'affiche **après** le rendu normal et sa sortie finale, avant la carte/HUD de ce canvas. Il ne
pollue ni la radiance, ni le bloom, ni l'historique temporel, ni les exports hors ligne. Hors du patch, il laisse
la vue actuelle visible. Les couleurs sont des indications diagnostiques, sans interprétation radiométrique.

| Vue | Interprétation |
|---|---|
| `depth` | Distance en niveaux de gris logarithmiques, de 0 à environ 1 000 km ; proche plus clair |
| `normals` | Normales de vue en RGB ; orange lorsque le voisinage du pixel sort de la couverture du patch |
| `difference` | Vert pour un faible écart, rouge si le raster est plus loin, bleu s'il est plus proche ; intensité logarithmique saturée à 100 m d'écart absolu ; jaune sans profondeur de référence utilisable |

**La vue `difference` ne borne pas l'erreur verticale du terrain.** `sceneDepth` est la profondeur de la scène
tracée/résolue, y compris son décor et ses effets ; entre les rayons temps réel, elle peut conserver une valeur
antérieure ou utiliser le minimum des quatre échantillons frais voisins. Le raster échantillonne les centres
des pixels, sans le jitter individuel des rayons. À cela s'ajoutent empreintes filtrées différentes, triangles
au lieu d'interpolation bilinéaire, sous-échantillonnage des pistes, mer/décor absents du pilote. Une couleur signale donc un écart
à investiguer, pas une faute géométrique attribuable automatiquement au cache.

Le chemin physique conserve les calculs d'éclipse, réfraction, diffusion, absorption et transport relativiste.
Le pilote reprend le domaine d'éligibilité de P1a ; il ne s'active pas dans les noyaux scientifiques/relativistes,
les sondes, la marche ou les rendus hors ligne. La validation optique et les séquences du plan restent à faire.

## Budget et cycle de vie

Deux textures seulement pour le pilote : distance `r32float` et profondeur `depth32float`, soit **8 octets
par pixel interne** (hors alignement et mémoire de driver). Plafond : 4 194 304 pixels, donc **32 Mio**.
Au-delà, le pilote rapporte `pixel-budget` et conserve la vue actuelle. Pas de baisse de résolution cachée.

Un redimensionnement garde au plus deux paires de textures, actuelle et retirée. La paire retirée attend
la fin des soumissions qui l'utilisent ; une nouvelle allocation de taille différente attend sa libération.
La désactivation retire aussi les textures. Les buffers de sommets/index sont plafonnés à **1 774 092 octets**
(594 444 + 1 179 648), plus l'uniforme de **128 octets**. Ces buffers et les
pipelines restent réutilisables après première activation. La perte ou libération du device libère le tout.
Les compteurs distinguent les textures actuelles et retirées, sans prétendre mesurer les allocations internes du driver.

Une inspection éligible maintient le rendu temps réel, même caméra immobile, pour préparer les fenêtres et
actualiser les vues. Elle n'entraîne pas la calibration de résolution ni l'adaptation automatique du bloc.
Elle **ajoute** le coût des passes `terrain raster visibility` et `terrain raster inspector` au rendu actuel ;
ne pas interpréter sa cadence comme celle d'un futur pipeline où la marche primaire aura été retirée.

## Commande et diagnostics

Le panneau Terre propose les deux réglages avancés, avec traduction française ; le même schéma atteint TARS.
Exemples pour une utilisation future, non exécutés pour ce lot :

```js
__bh.game.set("earthTerrainCache", false); // garde le traceur sur sa source de référence
__bh.game.set("earthTerrainRasterLevel", 2);
__bh.game.set("earthTerrainRasterView", "difference");
__bh.renderer.terrainRasterStats;
__bh.game.perf().terrainRaster;
__bh.game.set("earthTerrainRasterView", "off");
```

`active` signifie qu'un dessin a été encodé ; `encodedFrames` ne compte pas des frames GPU terminées.
`requested` décrit l'éligibilité de la dernière frame caméra, sans démarrer de compilation par lecture.

## Vérifications et suite

Vérifications effectuées, sans exécuter de passe de jeu :

- `bun run typecheck` : réussi.
- Biome sur les dix fichiers TypeScript modifiés : code de sortie 0 ; un avertissement et une information
  préexistants dans `main.ts`, hors des lignes modifiées (`useOptionalChain`, `useLiteralKeys`).
- `bun scripts/check-wgsl.ts` : **24/24 modules/compositions WGSL compilent**, adaptateur `apple`, Chrome headless local.
- `git diff --check` : réussi.
- Maillage conforme : `bun test ./tests/terrain-raster-mesh.test.ts`, test géométrique **purement CPU** (aucun
  GPU, aucun jeu, aucun Chrome) : 8/8. Il vérifie, pour chaque site à piste (niveaux 0, 2, 4), pour une piste
  oblique (niveaux 0 à 3) et pour quatre pistes sécantes au même point : surface totale = celle de la portion,
  aucun triangle retourné au-delà de la résolution float32, chaque côté utilisé une fois dans chaque sens
  (hors bord de portion) donc sans jonction en T, budget de coupes respecté, et qu'**aucun triangle n'enjambe**
  un côté de contour. Deux sommets à un pas float32 l'un de l'autre sont tolérés (pistes superposées par le test).
- Aucun autre `bun test`, e2e, vol, capture comparative ou benchmark de jeu lancé.

Ces vérifications ne valident pas la géométrie une fois sur le GPU (hauteurs des sommets coupés), les bind groups, les dessins, la précision numérique ou le rendu en mouvement.

Suite nécessaire : références P0, accord numérique WGS84 des sommets et de la profondeur, hauteur réelle aux sommets coupés,
raccords entre fenêtres/niveaux et bornes d'erreur, sélection multi-patches par erreur projetée, mouvement, puis consommation
de la visibilité raster par le rendu final en conservant éclairage et optique. Les forêts et nuages restent
des lots distincts ; aucun gain de FPS ou de qualité AAA n'est déclaré acquis ici.
