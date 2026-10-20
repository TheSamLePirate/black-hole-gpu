# P1b — Terrain raster WGS84 et vues de comparaison

Statut : **pilote diagnostique implémenté, désactivé par défaut ; exécution et image non validées**.
Branche : `codex/aaa-terrestrial-renderer`, après le cache P1a (`a159802d`).

Ce lot construit la première passe de terrain par triangles. Il donne un outil de comparaison avant de
remplacer les intersections du traceur. Ce n'est pas encore le terrain raster du rendu final ni une preuve
de gain sur le M1 Max. Aucun test, vol ou benchmark de jeu n'a été lancé.

## Géométrie et données réutilisées

- Une grille indexée de 129 × 129 sommets, 32 768 triangles, lit directement les hauteurs float32 du cache P1a.
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

Les hauteurs de P1a sont le **relief naturel filtré**. Le pilote n'applique pas le nivellement des pistes,
ne dessine ni végétation, ni bâtiments, ni vagues et ne raccorde pas plusieurs fenêtres. Il utilise des
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
au lieu d'interpolation bilinéaire, et pistes/mer/décor absents du pilote. Une couleur signale donc un écart
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
La désactivation retire aussi les textures. L'index de **393 216 octets**, l'uniforme de **128 octets** et les
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
- Aucun `bun test`, e2e, vol, capture comparative ou benchmark de jeu lancé.

Ces vérifications ne valident pas les bind groups, les dessins, la précision numérique ou le rendu en mouvement.

Suite nécessaire : références P0, accord numérique WGS84 des sommets et de la profondeur, nivellement des pistes,
bords/raccords et bornes d'erreur, sélection multi-patches par erreur projetée, mouvement, puis consommation
de la visibilité raster par le rendu final en conservant éclairage et optique. Les forêts et nuages restent
des lots distincts ; aucun gain de FPS ou de qualité AAA n'est déclaré acquis ici.
