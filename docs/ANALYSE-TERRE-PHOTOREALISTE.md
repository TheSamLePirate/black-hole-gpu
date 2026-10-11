# Terre photoréaliste en mode avion : faisabilité, performances et propositions

**Analyse du 11 octobre 2026 — code inspecté : `2b8342a`, avec l'arbre de travail présent.**

## 1. Recommandation

**Oui, un très grand saut de qualité est faisable sans faire exploser le CPU. En revanche, WorldCover + Sentinel-2 ne permettent pas, seuls, une Terre de qualité AAA photoréaliste à 100–300 m du sol.** Leur résolution de 10 m donne une excellente structure géographique ; elle ne donne ni les façades, ni les arbres individuels, ni les petits chemins.

Je recommande une architecture à trois échelles :

1. **Géographie réelle :** mosaïque Sentinel-2 à 10 m, classification WorldCover, relief existant ; données préparées hors du jeu, tuiles compressées chargées à la demande.
2. **Paysage volumétrique :** matériaux de sol détaillés, masses de canopée et quartiers simplifiés au loin ; arbres, bâtiments et quelques accessoires en géométrie instanciée seulement lorsqu'ils deviennent visuellement utiles.
3. **Zones de vol premium :** orthophotos à 0,2–1 m, terrain fin, emprises de bâtiments et végétation corrigée autour des aéroports et des lieux emblématiques. En France, les données IGN rendent cette proposition particulièrement intéressante.

**Le meilleur investissement visuel n'est pas d'instancier davantage d'objets partout. C'est de choisir la représentation adaptée à leur taille à l'écran, tout en conservant la bonne couleur, la silhouette, les ombres et la stabilité en mouvement.**

Premier objectif recommandé : une région rurale crédible à **300–1 500 m AGL**, avec un passage à **100 m** dans une zone préparée, à environ **1,4–2,2 millions de pixels**, et une cible de **60 images réellement rendues/s** sur le matériel qui dispose du budget nécessaire. AGL signifie altitude au-dessus du terrain, et non altitude au-dessus du niveau marin.

Ce document conserve l'étude de conception initiale, réalisée avant le prototype. Les faits externes sont sourcés ; les constats sur le projet viennent du code ; les tailles mémoire et débits sont calculés ; les plages de millisecondes sont des hypothèses de dimensionnement à valider. Aucun résultat d'un autre moteur ou GPU n'est présenté comme une mesure de ce jeu. **Le jalon A a depuis été implémenté et mesuré : voir [mise en œuvre et résultats](PLAN-TERRE-PHOTOREALISTE.md).** Les budgets B/C ci-dessous restent des hypothèses.

## 2. Ce que le projet possède déjà

### 2.1 Un socle réutilisable

| Élément constaté | Implémentation actuelle | Conséquence |
|---|---|---|
| Terre ellipsoïdale et repère local précis | `src/system/ellipsoid.ts`, paramètres locaux du renderer | Le placement de petits objets peut réutiliser ce socle |
| Relief réel local | `src/system/earth-tiles.ts` : Terrarium, niveaux z6 à z13, fenêtres de 4 × 4 tuiles de 256² | Déjà un cache spatial de type clipmap ; pas besoin de commencer par un globe intégralement nouveau |
| Résolution utile du relief | Limite déclarée de 25 m ; le commentaire indique principalement SRTM 30 m et certains relevés nationaux | Augmenter le zoom seul ne crée pas un terrain à 1 m |
| Couleur locale | GIBS Blue Marble, jusqu'à z8, source annoncée à environ 500 m | C'est une limitation majeure du survol terrestre actuel |
| Couleur globale | Cubes de faces 2048² ou 4096² | À conserver pour l'orbite, le fond et le repli |
| Couverture fine simulée | `earthCover` et `fieldPlot`, `src/shaders/trace.wgsl` | Champs et forêts déduits surtout de la luminosité de la carte, puis enrichis procéduralement |
| Terrain dessiné | `earthMarch`, normales et ombres dans le shader de trace | Ajouter des objets à cette marche de rayons peut coûter beaucoup plus cher qu'une passe raster |
| Géométrie raster déjà intégrée | `src/ship.ts`, `src/shaders/display.wgsl` | Le moteur sait combiner des objets raster avec l'image tracée ; le paysage demande cependant un contrat de profondeur et d'atmosphère plus complet |
| Compression GPU | KTX2, transcodage Basis dans un worker, BC7 ou ASTC 4×4 | Très utile pour les futures tuiles de couleur |
| Gouverneur de qualité | `src/tier.ts`, `src/quality-policy.ts`, résolution dynamique | À étendre avec un budget propre au paysage |
| Mesure | `src/gpuprof.ts`, `src/perf.ts`, `__bh.game.perf()`, Kerr Bench | L'infrastructure nécessaire pour décider existe |
| Cache persistant | Service Worker et règles PWA | 300 MiB de budget de tuiles, classification actuellement spécifique à Terrarium/GIBS |

Le problème actuel n'est donc pas simplement « pas assez de polygones ». Le sol manque d'information réelle sur sa couleur et son occupation, puis de volume dans les éléments visibles de près.

### 2.2 Une correction importante pour le budget mémoire

Le code alloue la texture de relief local en **`rg32uint`, 1024 × 1024 × 8**. Sa taille utile est :

```text
1024 × 1024 × 8 couches × 8 octets = 64 MiB GPU
```

Les hauteurs CPU des 128 tuiles occupent jusqu'à **32 MiB**, hors copies temporaires. La mention « 32 MB GPU » dans [PERFORMANCE.md](PERFORMANCE.md) ne correspond donc pas à la texture du code inspecté. Ici, le calcul du format fait référence ; l'allocation réelle peut encore inclure des surcoûts du pilote.

Il serait possible de séparer hauteur et couleur, puis de compacter la hauteur avec une échelle et un décalage par tuile. Mais **ce serait une évolution du format et de la précision**, à vérifier sur le GPU et dans les collisions. Une hauteur entière quantifiée par tuile offre une précision contrôlable ; passer naïvement en float16 à plusieurs milliers de mètres d'altitude ferait perdre trop de précision verticale.

### 2.3 Les chiffres historiques ne sont pas un budget libre

[PERFORMANCE.md](PERFORMANCE.md) rapporte des optimisations importantes, mais des scènes de relief réel ont aussi coûté plusieurs dizaines de millisecondes. Il indique également que le noyau est sensible à la pression sur les registres : du code supplémentaire dans ses chemins peut ralentir des scènes qui ne l'utilisent pas.

Dans le rapport conservé [bench-g2-end/report.json](perf/bench-g2-end/report.json), daté du 4 octobre, version `fefbbc8`, Apple/Metal, viewport déclaré 1469 × 965, DPR 2, la scène `game:artemis` donne **53,1 fps**, intervalle **p95 33,3 ms**, et **669 MiB** comptabilisés. Cette scène n'est pas une forêt en vol bas ; ce chiffre illustre uniquement qu'il serait dangereux de supposer 5 ms disponibles sur toute scène. La résolution interne, le sous-échantillonnage et la météo doivent accompagner toute future comparaison.

Le document [ab-pages-2026-10-05.md](perf/ab-pages-2026-10-05.md) corrige justement des conclusions fondées sur les callbacks du navigateur. Pour cette étude, **60 callbacks rAF/s ne prouvent pas 60 nouvelles images GPU/s**.

## 3. Ce que donnent réellement les données

### 3.1 WorldCover : excellent masque de placement, pas modèle du paysage

WorldCover 2021 v200 fournit une classification globale à environ **10 m**, comprenant **11 classes** : arbres, arbustes, herbe, cultures, bâti, sol nu/végétation rare, neige/glace, eau permanente, zones humides herbacées, mangroves et mousses/lichens. Ce sont des catégories de couverture, pas des essences d'arbres ni des types architecturaux. [Manuel officiel WorldCover v2](https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/docs/WorldCover_PUM_V2.0.pdf).

La distribution officielle propose les millésimes **2020 et 2021** ; v200 annonce une exactitude globale de **76,7 %**. Il s'agit d'une métrique agrégée de classification, pas d'une confiance de 76,7 % pour chaque pixel. Les cartes sont livrées en COG géographiques de 3° × 3°, pour environ 117 GB au total. Licence CC BY 4.0 avec attribution. [Accès et validation ESA](https://esa-worldcover.org/en/data-access).

**Utilisation recommandée :** choisir des matériaux, autoriser ou interdire la végétation, guider densité et représentation. Ajouter des exclusions plus précises autour des pistes, routes et bâtiments. Un pixel « bâti » ne contient pas les emprises de ses maisons ; un pixel « arbres » ne contient pas leurs positions ou leurs hauteurs.

Ne pas transformer chaque cellule boisée en un arbre de même taille. Il faut une distribution spatiale stable, des trouées, des lisières, plusieurs tailles et des données complémentaires de biome. La finesse apparente sous 10 m sera synthétique tant qu'une source plus précise ne la contraint pas.

### 3.2 Sentinel-2 : énorme amélioration des motifs, résolution limitée

Les bandes visibles B02/B03/B04 et le proche infrarouge B08 sont à **10 m** ; d'autres bandes sont à 20 ou 60 m. Les produits L2A fournissent une réflectance de surface corrigée de l'atmosphère, avec notamment une classification de scène. La correction atmosphérique ne transforme pas une image prise sous un soleil donné en un matériau entièrement débarrassé des ombres. [Mission Sentinel-2](https://sentiwiki.copernicus.eu/web/s2-mission), [produits L2A](https://sentiwiki.copernicus.eu/web/s2-products).

**Apport attendu :** vraies parcelles, zones urbaines, limites forestières, littoraux et grands cours d'eau ; environ 50 fois plus fin en distance que la source couleur locale annoncée à 500 m. Ce facteur décrit la résolution nominale des données, pas un facteur de qualité ni de performance.

**Piste particulièrement rentable : les composites annuels WorldCover Sentinel-2.** Ils fournissent déjà des mosaïques RGBNIR L2A pour 2020/2021, en COG de 1° × 1°, accessibles publiquement sur AWS, avec licence CC BY 4.0. La fiche indique qu'ils ne sont pas mis à jour. Ils évitent une grande partie du travail de sélection/composition pour le premier essai. [Catalogue officiel AWS/VITO](https://registry.opendata.aws/esa-worldcover-vito-composites/).

Ils nécessitent néanmoins une préparation graphique : traitement des nodata, raccords, calibration des couleurs et conversion en tuiles. Une médiane annuelle peut mélanger les états de cultures et donner un paysage moins expressif qu'une mosaïque saisonnière sélectionnée. Elle suffit à évaluer l'intérêt avant de construire un traitement d'images plus récent.

### 3.3 Le complément qui change réellement le vol bas

| Donnée | Utilité | Limite à traiter |
|---|---|---|
| Orthophoto 0,2–1 m | Sol identifiable près de l'avion : petits chemins, parcelles, parkings, marques au sol | Ombres et objets déjà photographiés ; coût de stockage et streaming |
| MNT fin, typiquement 1–5 m pour le premier pack | Talus, petits reliefs, raccord aux pistes | Pas besoin de charger le nuage LiDAR brut en jeu |
| Emprises de bâtiments + hauteurs | Bâtiments bien placés, silhouette urbaine et ombres | Hauteurs incomplètes, façades à synthétiser |
| Hauteur de canopée quand disponible | Variation crédible des forêts, suppression du « tapis uniforme » | Ne donne pas nécessairement les arbres individuels |
| Routes, eau, exclusions aéroportuaires | Empêcher les placements absurdes, dessiner les petits éléments structurants | Ponts et voies superposées demandent une vraie géométrie |

En France, **BD ORTHO annonce une résolution de 20 cm**. Le programme IGN LiDAR HD fournit des modèles de terrain, surface et hauteur ; disponibilité et millésime doivent être vérifiés sur chaque zone retenue. L'IGN diffuse la quasi-totalité de ses données sous licence ouverte Etalab 2.0, et cite notamment BD TOPO pour bâtiments et réseau routier. [BD ORTHO](https://cartes.gouv.fr/aide/fr/partenaires/ign/observations-regulieres-territoire/imagerie/bd-ortho/), [modèles LiDAR HD](https://www.ign.fr/institut/espace-presse/lidar-hd-les-premiers-modeles-3d-du-territoire-sont-disponibles), [données ouvertes IGN](https://www.ign.fr/institut/des-donnees-et-logiciels-ouverts-au-service-de-la-nation).

Pour d'autres régions : USGS 3DEP pour le relief américain et NAIP pour l'imagerie aérienne constituent des pistes publiques ; contrôler la couverture et la résolution du produit choisi. [USGS 3DEP](https://www.usgs.gov/3d-elevation-program), [USGS NAIP](https://www.usgs.gov/centers/eros/science/usgs-eros-archive-aerial-photography-national-agriculture-imagery-program-naip).

OSM ou Overture peuvent apporter les bâtiments et routes ailleurs. Les hauteurs sont à traiter comme des attributs parfois absents ; **Overture Buildings comporte des obligations ODbL**, ce n'est pas une échappatoire à la licence OSM. Attribution et éventuel partage des bases dérivées doivent être prévus dans la distribution des données, sans en déduire que tout le code du jeu devient ODbL. [Overture Buildings](https://docs.overturemaps.org/guides/buildings/), [FAQ OSMF](https://osmfoundation.org/wiki/Licence_and_Legal_FAQ).

### 3.4 Un piège de hauteur : DSM et sol nu

Le Copernicus DEM GLO-30 est un **DSM**, incluant végétation et constructions, et non un MNT de sol nu. Ajouter des arbres au-dessus d'une hauteur qui représente déjà la canopée produit une forêt trop haute. Les références verticales et la transformation vers l'ellipsoïde doivent également être harmonisées ; une hauteur orthométrique ne s'additionne pas directement à une hauteur ellipsoïdale. GLO-30/90 sont accessibles librement aux utilisateurs enregistrés ; ne pas présumer que l'instance européenne à 10 m est librement accessible dans les mêmes conditions. [Description officielle Copernicus DEM](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM).

Pour les packs locaux : utiliser un **MNT pour le sol**, et le MNH pour la hauteur au-dessus de celui-ci. En couverture globale, conserver une approximation explicitement identifiée là où le sol nu n'est pas connu.

## 4. À quelle altitude les détails deviennent-ils nécessaires ?

### 4.1 Calcul de visibilité

Exemple de dimensionnement : **image interne 1920 × 1080, FOV vertical 60°, vue au nadir, sol localement plat**. Au centre :

```text
taille d'un pixel au sol ≈ 2 × h × tan(FOV_vertical / 2) / hauteur_image
                      ≈ 0,001069 × h mètres/pixel
```

| AGL | Mètres/pixel | Un texel Sentinel-2 de 10 m occupe | Lecture visuelle |
|---:|---:|---:|---|
| 100 m | 0,107 | 94 pixels | La photographie 10 m apparaît très grossière ; les objets proches dominent |
| 300 m | 0,321 | 31 pixels | Des maisons, couronnes et chemins doivent être représentés autrement |
| 1 000 m | 1,069 | 9,4 pixels | La structure satellite est utile, mais demande du détail synthétique |
| 3 000 m | 3,208 | 3,1 pixels | Bonne base de paysage ; géométrie pour les silhouettes dominantes |
| 5 000 m | 5,346 | 1,9 pixel | Imagerie et masses de couverture font l'essentiel du travail |
| 10 000 m | 10,692 | 0,94 pixel | Le 10 m devient généralement suffisant au centre de cette vue |

Ces nombres sont des calculs, pas des seuils universels. Dans le jeu, partir du FOV réellement utilisé et de ses conventions. Une vue oblique a des empreintes très anisotropes ; le sol proche de l'avion peut demander beaucoup de détail alors que l'horizon se satisfait d'une représentation grossière. Un zoom ou une image 4K changent les besoins.

### 4.2 Gouverner par taille à l'écran, pas seulement par altitude

Proposition initiale pour un arbre dont la couronne a une dimension de 10 m :

| Taille projetée approximative | Représentation |
|---:|---|
| < 2 px | Intégration dans la couleur et la masse de canopée |
| 2–15 px | Groupes de couronnes ou imposteurs simples |
| 15–50 px | Imposteur multi-vues avec normales/profondeur, ou mesh très simplifié |
| > 50 px | Mesh proche, feuillage et tronc plus détaillés |

À 1080p/60°, un objet transversal de 10 m occupe environ 47 px à 200 m de distance, 19 px à 500 m et 9 px à 1 km. **Un arbre visible depuis un avion à 1 km AGL ne nécessite donc généralement pas son modèle le plus détaillé.** La mesure doit porter sur la dimension projetée de sa boîte réelle : une grande hauteur de tronc, une vue de dessus et une vue rasante ne donnent pas la même taille.

Ajouter une hystérésis aux transitions ; préserver identifiant, position, couleur moyenne et volume entre les LOD. Les rayons limites servent à borner la charge, mais la taille projetée décide de la représentation.

## 5. Les quatre propositions

Toutes les plages GPU ci-dessous sont des **enveloppes initiales non mesurées**, pour environ 1,4–2,2 Mpx, un paysage modérément dense et une bibliothèque d'assets maîtrisée. Elles ne sont pas transposables telles quelles au M1, à un Pro/Max ou à un iPad. L'ajout de GPU peut remplacer du travail existant ; on ne doit pas additionner des estimations sans mesurer la chaîne entière.

| Proposition | Résultat visé | CPU principal supplémentaire en régime stable | GPU supplémentaire envisagé | Mémoire GPU supplémentaire envisagée | Avis |
|---|---|---:|---:|---:|---|
| **A. Géographie réelle + matériaux** | Gros progrès global, surtout vers 1–10 km AGL | 0,1–0,4 ms/frame | 0,4–1,5 ms/frame | 64–160 MiB | Première étape avec le meilleur rapport bénéfice/risque |
| **B. A + paysage à plusieurs représentations** | Rural/forêt crédibles à 300–1 500 m, vrai volume proche | 0,2–0,8 ms/frame | 2–5 ms/frame au total pour les ajouts A+B | 160–320 MiB au total | Architecture recommandée, à adapter au budget disponible |
| **C. B + packs géographiques premium** | Cible photoréaliste locale à 100–500 m, beaux atterrissages | Même cible CPU que B ; pics de chargement à maîtriser | 3–7 ms/frame au total pour A+B+C | 256–512 MiB au total | Pour réellement viser AAA en vol bas |
| **D. Photogrammétrie dense généralisée** | Villes reconnues, beaucoup de détails réels | Dépend fortement de sélection/décodage des tuiles | Impossible à borner sérieusement sans dataset/prototype | Très variable, forte pression de streaming | Option ponctuelle ; mauvais premier choix pour le globe |

Les mémoires de B/C comprennent les ajouts des étapes précédentes ; **elles ne sont pas à additionner ligne par ligne**, et excluent le renderer déjà présent. Les temps CPU sont des objectifs de main thread, pas la somme de tous les workers. Le haut de ces plages GPU n'est pas compatible avec « petit surcoût » sur une scène qui consomme déjà son budget.

### 5.1 Proposition A — le gain rapide et utile partout

**Faire arriver la vraie géographie avant les arbres.**

- Préparer un jeu de tuiles de couleur Sentinel-2 et un jeu de classes WorldCover, avec parents grossiers disponibles en permanence.
- Découpler leur résolution de celle du relief : l'imagerie peut être à 10 m, le relief rester à 25–30 m.
- Utiliser la couleur satellite aux grandes échelles ; à courte distance, ajouter détails de normal, rugosité et couleur à moyenne contrôlée, adaptés au type de sol.
- Remplacer progressivement les parcelles arbitraires de `fieldPlot` là où l'image révèle les vraies limites. Ne pas redessiner une grille de champs par-dessus une vraie photographie de parcelles.
- Conserver les fonctions procédurales actuelles comme repli là où il manque des données.

**Matériaux conseillés :** terre labourée, cultures/herbe, roche, sable, gravier, neige, asphalte ; textures partagées de qualité, pas un matériau complet unique par tuile. Mélanger au plus un ou deux matériaux dominants au pixel. Réserver le triplanaire aux pentes qui l'exigent : six ou neuf lectures de texture partout seraient une mauvaise dépense.

La variation de textures par rotations et positions stables permet de réduire la répétition ; elle demande un filtrage correct aux frontières et des lectures supplémentaires. La famille « texture bombing » documente ce compromis ; ce n'est pas une augmentation gratuite de qualité. [NVIDIA, Texture Bombing](https://developer.nvidia.com/gpugems/gpugems/part-iii-materials/chapter-20-texture-bombing).

**Précaution graphique essentielle :** garder les couleurs en espace linéaire pendant le mélange et l'éclairage ; appliquer la conversion sRGB au bon endroit. Préserver les basses fréquences de la photographie et normaliser l'énergie du détail ajouté. Le jeu multiplie déjà sa carte par des variations : augmenter contrastes et bruit sans calibration produirait une Terre surchargée.

**Ce que A ne donnera pas :** parallaxe de forêt, silhouettes de maisons, ombres d'objets proches. À 300 m, un sol plus net mais toujours plat ne suffit pas.

### 5.2 Proposition B — le meilleur compromis pour le mode avion

#### Loin : représenter une forêt comme une surface et des groupes

Au-delà de quelques kilomètres, les millions d'arbres sont une mauvaise unité de rendu. Utiliser la couleur réelle, une normale de canopée et des groupes simplifiés. Une surface de couronnes peut fournir du relief visuel et des ombres de masse ; réserver la géométrie de lisière aux silhouettes visibles.

Cette canopée reste **distincte du sol physique**. Elle ne modifie pas le MNT, ne recouvre pas les pistes et ne crée pas un plan vert uniforme au niveau des maisons. Les mêmes graines déterministes doivent piloter ses bosses et les futurs arbres individuels, afin de ne pas faire surgir une deuxième forêt pendant la transition.

Commencer par des groupes raster simples et des textures de normales ; ne pas insérer un raymarch volumétrique de chaque forêt dans le noyau de trace. La proposition de canopée agrégée est une conception à prototyper, pas une fonctionnalité déjà disponible.

#### Distance moyenne : imposteurs multi-vues

Un arbre est affiché par une petite géométrie qui choisit une vue précalculée. L'atlas contient couleur/albedo, normale, masque et éventuellement profondeur pour un peu de parallaxe. Un imposteur octaédrique est une variante compacte de choix des vues, à évaluer.

Pour l'avion, **inclure les vues du dessus et les élévations intermédiaires**. Les billboards cylindriques uniquement vus de côté sont médiocres lorsqu'on survole la forêt. Garder la lumière recalculable : une image avec soleil et ombre fortement cuits devient incohérente au coucher du soleil.

Un atlas plus élaboré n'est pas automatiquement meilleur : interpolation entre vues, alpha et correction de profondeur augmentent le coût. Comparer d'abord trois solutions sur le même bosquet : mesh LOD très simple, cartes croisées, imposteur multi-vues. Les techniques d'imposteurs sont documentées, mais les anciens chiffres matériels ne doivent pas servir de prévision pour WebGPU. [NVIDIA, True Impostors](https://developer.nvidia.com/gpugems/gpugems3/part-iv-image-effects/chapter-21-true-impostors).

#### Proche : vrais modèles instanciés

Proposition de départ : **12–24 variantes végétales**, représentant quelques familles de biomes, avec 3–4 niveaux de détail, atlas partagés et variations de taille, orientation et teinte. La distinction feuillus/conifères est plus importante au début que la reproduction de dizaines d'espèces.

Un modèle source de très haute qualité sert à fabriquer les LOD et imposteurs. Il ne doit pas être rendu intégralement pour chaque arbre. Exemple de calcul : 2 000 arbres à 3 000 triangles représentent déjà **6 millions de triangles**, avant les ombres ; 50 000 à cette complexité donneraient **150 millions**. L'instancing réduit les soumissions CPU, pas les triangles ni les fragments traités.

Cap initial : quelques milliers de meshes proches, quelques dizaines de milliers d'imposteurs/groupes, budget de triangles visible de l'ordre de **1–3 millions** pour le paysage sur le profil intermédiaire. Ces caps sont des paramètres de prototype ; les pixels couverts, l'overdraw et les ombres peuvent imposer de les réduire bien avant la limite de triangles.

**Priorités de qualité :** lisières, bosquets isolés, alignements et haies près de l'avion. Dans une forêt opaque, supprimer intelligemment les arbres cachés donne beaucoup plus que simplifier de quelques triangles chaque tronc invisible.

#### Bâti : emprises réelles, qualité concentrée sur les éléments visibles

La première ville crédible doit provenir d'emprises réelles extrudées, avec hauteurs disponibles et variantes de toitures/façades régionales. Réserver les modèles spécifiques aux monuments, grands bâtiments et aéroports.

Contrairement aux arbres, chaque bâtiment n'a pas forcément une géométrie identique. Préparer hors ligne des **meshes regroupés par tuile et matériau**, avec LOD et regroupements de quartiers. Instancier les familles répétitives ; éviter une soumission et un objet JavaScript par maison.

Au loin, les toits et les grandes ombres suffisent souvent. Les fenêtres individuelles, véhicules et mobilier demandent une forte priorité visuelle pour mériter leur coût. Les routes ordinaires peuvent commencer comme masques de matériaux ; ponts, viaducs et ouvrages aéroportuaires ont besoin de géométrie.

### 5.3 Proposition C — le photoréalisme local qui vaut la peine

**Une bibliothèque d'assets AAA dans une géographie imprécise restera un décor générique.** Pour les passages à 100–300 m, le meilleur complément est une région précisément documentée.

Premier terrain d'essai recommandé : **Le Bourget et une couronne rurale/forestière**, ou **les Cévennes** pour tester relief et végétation. Prévoir deux sites, parce qu'une plaine aéroportuaire ne valide pas une vallée boisée. Le pack peut couvrir 20 × 20 km autour d'un point principal, avec une couronne plus large à résolution moindre.

Contenu initial : orthophotos distribuées à **0,5–1 m** là où cela suffit, MNT à 1–5 m, bâtiments et routes, hauteurs de canopée si disponibles, quelques lieux faits à la main. Garder le 20 cm pour des petites zones où l'empreinte à l'écran le justifie. Le produit IGN source peut être à 20 cm sans que tout le jeu en consomme la pleine résolution.

La qualité vient aussi du **raccord entre l'image et les volumes** : supprimer ou atténuer les ombres photographiées dominantes, éviter qu'un toit photographié dépasse autour du bâtiment, ne pas doubler les arbres visibles dans l'orthophoto. Une orthophoto n'est pas un albedo parfait ; il faut une préparation dédiée. Le masque eau/sol, les exclusions d'aéroport et les données vectorielles doivent prendre le dessus là où leur précision est supérieure.

Faire une première saison bien réglée. Les packs saisonniers multiples accroissent données, QA et raccords ; ils pourront suivre. Les neiges et la pluie déjà simulées doivent affecter les nouveaux matériaux et objets avec les mêmes règles visuelles.

### 5.4 Proposition D et techniques que je ne choisirais pas pour commencer

| Technique | Intérêt réel | Pourquoi elle n'est pas le premier choix |
|---|---|---|
| Photogrammétrie en tuiles 3D | Reconnaissance de villes et monuments | Gros streaming, erreurs de reconstruction, arbres fusionnés, lumière photographiée ; intégration du format et du LOD nécessaire |
| Google Photorealistic 3D Tiles | Accès à de la géométrie réelle détaillée dans les zones couvertes | Compte/API, attribution et contraintes de cache/préchargement/offline ; pas une banque d'assets à convertir librement |
| Gaussian splatting | Très bon pour revisiter un lieu capturé | Acquisition multivue nécessaire, gestion de visibilité/transparence et difficulté de relighting ; Sentinel-2 ne fournit pas seul cette reconstruction |
| NeRF / génération neurale au runtime | Recherche et scènes ciblées | Coût, déploiement et contrôle du résultat peu adaptés à ce budget |
| Super-résolution IA des satellites | Amélioration apparente de texture hors ligne | Peut inventer des chemins et bâtiments ; ne produit pas leur vraie géométrie |
| Voxeliser/raymarcher chaque arbre | Cohérence avec un renderer à rayons | Traversée et ombrage trop coûteux avant de disposer d'une structure accélératrice et d'une preuve A/B |
| Refaire Nanite dans WebGPU | Rendu de meshes complexes | Projet de renderer à part entière ; mauvaise proportion de travail pour le premier gain |

Les politiques Google limitent notamment le préchargement, le stockage/cache et l'usage offline, sous réserve des conditions contractuelles applicables ; elles imposent également l'attribution. Ces limites entrent directement en jeu avec le cache PWA actuel. Ce constat ne signifie pas que tout usage de ces tuiles dans un simulateur serait interdit. [Politiques officielles Map Tiles](https://developers.google.com/maps/documentation/tile/policies).

La recherche sur les **Gaussian splats hiérarchiques** montre que de grandes scènes peuvent être représentées avec un LOD, mais cela ne résout pas automatiquement l'acquisition, les collisions et l'éclairage dynamique d'un globe. Mon choix serait une expérimentation sur un lieu exceptionnel après le socle classique. [Publication et projet INRIA, Hierarchical 3D Gaussians](https://repo-sam.inria.fr/fungraph/hierarchical-3d-gaussians/).

## 6. Architecture GPU recommandée

### 6.1 Placement et culling sans travail CPU par arbre

```mermaid
flowchart LR
    S[Sources géographiques] --> P[Préparation hors ligne]
    P --> T[Tuiles couleur, classes, hauteurs et géométrie]
    T --> W[Worker : téléchargement et décodage]
    W --> C[Cache CPU et pools GPU bornés]
    C --> G[Compute : génération locale stable]
    G --> V[Compute : visibilité et choix des LOD]
    V --> I[Buffers de commandes indirectes]
    I --> R[Raster : sol proche et paysage]
    R --> A[Profondeur, atmosphère et composition HDR]
```

La génération doit se produire **à l'entrée d'une cellule**, pas chaque frame sur toute la région. Les graines viennent d'identifiants géographiques stables ; les positions ne changent pas lorsqu'un slot de cache est recyclé. Lire le masque de couverture, appliquer densité, pente, altitude et exclusions. Préparer hors ligne les contraintes coûteuses : distance aux routes, emprises bâties, rives, limites de parcelles.

Le GPU effectue ensuite frustum culling et LOD sur les candidats résidents ; il compacte des listes par prototype et LOD. Le CPU encode une liste bornée de lots, par exemple **24–64 commandes indirectes principales**, plutôt qu'un appel par instance. Les ombres ajoutent leurs propres lots et doivent être comptées.

`drawIndexedIndirect` est adapté à ces compteurs produits sur le GPU. Le buffer doit avoir l'usage `INDIRECT` ; si `firstInstance` est non nul, la feature `indirect-first-instance` doit être activée. Prévoir une variante avec `firstInstance=0` et un décalage de liste transmis séparément. Ne pas baser le design portable sur une commande hypothétique de multi-draw à compteur GPU : la liste de lots reste bornée et connue du CPU. [Documentation drawIndexedIndirect](https://developer.mozilla.org/en-US/docs/Web/API/GPURenderPassEncoder/drawIndexedIndirect).

Éviter toute lecture GPU→CPU pour connaître le nombre d'arbres visibles avant de dessiner. Les compteurs de télémétrie peuvent être lus à faible fréquence et avec retard. Contrôler les limites effectives du device : les nouveaux buffers/textures ont intérêt à vivre dans leurs propres pipelines, plutôt qu'à alourdir le bind group du gros traceur.

### 6.2 Culling : commencer simple, ajouter ce qui rapporte

Ordre conseillé : cellules hors distance/frustum → instances et taille projetée → caps par LOD → rendu. Un atlas de hauteurs conservateur peut ensuite rejeter des cellules derrière le terrain. Un Hi-Z issu de la profondeur opaque peut aider en ville ou dans des vallées.

**Ne pas payer un Hi-Z dès le premier prototype si le paysage est ouvert.** Construction et tests ont un coût ; l'occlusion par l'image précédente exige des marges conservatrices pour les virages rapides. Une forêt/maison ne doit pas disparaître parce que la caméra vient de changer d'orientation. Les tests doivent inclure rotations, désocclusions et sauts de scène.

### 6.3 Feuillage et ombres : les postes les plus dangereux

- Une carte de feuilles transparente peut provoquer beaucoup de fragments pour peu de pixels réellement couverts. Découper les contours et limiter les plans superposés.
- Comparer alpha test stable avec antialiasing temporel et alpha-to-coverage dans une passe MSAA adaptée. L'alpha-to-coverage est une option de pipeline ; elle n'est pas une solution gratuite au scintillement. [Pipeline WebGPU](https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/createRenderPipeline).
- Ne pas passer tout le paysage en 4× MSAA par défaut : le projet a déjà documenté le prix de grandes cibles MSAA.
- Ne pas animer toutes les feuilles éloignées. Vent simple en vertex shader pour les objets proches, paramètres par instance, sans upload CPU de matrices animées.
- Ombres géométriques dans une petite zone proche ; masses et occlusion précalculée/matériau plus loin. Les ombres de relief doivent rester séparées des ombres de végétation.
- Préserver quelques ombres lisibles avant les accessoires : le volume perçu en dépend fortement.

Un soleil bas peut rendre les ombres visibles très loin ; les limiter uniquement par distance à la caméra provoquerait des coupures. Prévoir transitions et ombres agrégées, puis mesurer ce cas spécifique.

## 7. Le vrai travail d'intégration : profondeur et atmosphère

### 7.1 Ajouter une passe d'arbres « par-dessus » ne suffit pas

Le terrain, l'air et les nuages sont aujourd'hui combinés dans `earthLook`. Un arbre raster doit :

1. Être masqué par le terrain qui passe devant lui.
2. Masquer le paysage derrière lui et être masqué par le cockpit/appareil si nécessaire.
3. Recevoir l'éclairage soleil, ciel, lune et météo cohérent avec le sol.
4. Être atténué par l'air entre caméra et objet, avec la diffusion ajoutée sur ce trajet.
5. Être correctement placé avant ou après une couche de brouillard/nuage.
6. Participer à la profondeur utilisée par pluie, DOF, motion blur et reconstruction temporelle.

Le contrat doit définir une distance caméra en mètres commune, sa conversion en profondeur raster, le repère local, et les cas « ciel sans surface ». Le renderer existant a des images et profondeurs intermédiaires ; **on ne peut pas présumer qu'une profondeur reconstruite et sous-échantillonnée suffit pour un tronc de quelques pixels**. Le tester avant les grandes densités.

La couleur d'objet doit recevoir `L_air(distance) + T_air(distance) × L_objet`, et non l'atténuation de l'air jusqu'au terrain derrière. En présence de nuages, une profondeur unique de surface ne suffit pas à représenter toutes les contributions volumétriques. Une LUT analytique pour l'air clair et un volume local/froxel pour les contributions météo sont des pistes ; leur construction, leur interpolation et leurs raccords font partie du budget.

### 7.2 Deux niveaux d'intégration, avec un risque différent

**Chemin conservateur — à faire d'abord :** garder `earthMarch` pour le sol, ajouter les objets raster avec leur couleur/profondeur et un traitement d'atmosphère cohérent. Cela permet de mesurer le bénéfice rapidement. Il ajoute du travail sans supprimer nécessairement celui du terrain derrière les arbres. Accepter ce double coût pour le prototype, pas comme preuve que le résultat final sera peu cher.

**Chemin de performance — si l'A/B le justifie :** rasteriser le terrain proche en grilles à LOD, avec le paysage dans la même profondeur opaque, puis intégrer l'atmosphère jusqu'au premier hit opaque. Conserver le terrain tracé/globe à grande distance et les chemins spatiaux. Les geometry clipmaps offrent une référence pour limiter la complexité des grilles et réutiliser leur topologie ; il faut adapter la précision, la courbure et les transitions au globe du projet. [NVIDIA, Geometry Clipmaps](https://developer.nvidia.com/gpugems/gpugems2/part-i-geometric-complexity/chapter-2-terrain-rendering-using-gpu-based-geometry).

Ce deuxième chemin peut **remplacer** la marche et une partie du shading du sol proche. Aucun gain net n'est établi sans mesure ; une grille mal dimensionnée, un passage de profondeur supplémentaire ou une atmosphère dupliquée peuvent annuler l'économie.

Seuil initial d'activation à étudier : voisinage terrestre en vol atmosphérique, avec transition progressive vers le chemin global autour de 20–50 km AGL, à régler selon erreur projetée. Il ne doit pas dépendre du seul bouton « mode avion » : caméra extérieure, photo, TARS et vues hors cockpit doivent rester cohérents. Les scènes relativistes et l'autre univers gardent leur rendu adapté.

### 7.3 Stabilité et collisions

Le projet impose déjà que le sol touché soit celui dessiné. Le MNT GPU, le sampler CPU, le nivellement des pistes et les nouveaux meshes de terrain doivent partager les mêmes hauteurs et règles d'interpolation utiles aux collisions. Limiter l'écart accepté, par exemple à **0,2 m dans les zones d'atterrissage**, à valider selon le train ; ce seuil est un critère proposé, pas la précision garantie des sources.

Ne pas rendre chaque arbre physiquement simulé. Pour le gameplay, cellules et proxies simples peuvent suffire ; les bâtiments/obstacles pertinents doivent avoir des volumes de collision préparés. La disparition d'un LOD graphique ne doit pas déplacer une collision. Un détail de normal n'altère pas le terrain physique.

La reprojection actuelle n'est pas automatiquement un TAA complet pour les objets. Les nouveaux meshes mobiles sous le vent demandent vitesse/profondeur correctes, rejet des désocclusions, et contrôle de l'histoire. **Supprimer le scintillement de feuilles et les transitions brusques vaut davantage que multiplier les polygones.**

## 8. Budgets calculables

### 8.1 Mémoire des textures : la compression est déterminante

BC7 et ASTC 4×4 utilisent 16 octets par bloc de 16 texels, soit **1 octet/texel** ; les mipmaps ajoutent environ un tiers. RGBA8 utilise quatre fois plus. Les formats compressés dépendent des features disponibles ; le code possède déjà cette sélection. [Formats/features WebGPU](https://developer.mozilla.org/en-US/docs/Web/API/GPUSupportedFeatures).

| Pool de couleur proposé | GPU compressé avec mipmaps | GPU RGBA8 avec mipmaps |
|---|---:|---:|
| 32 pages de 1024² | 42,7 MiB | 170,7 MiB |
| 64 pages de 1024² | 85,3 MiB | 341,3 MiB |
| 64 pages de 512² | 21,3 MiB | 85,3 MiB |

Il s'agit de pools résidents, pas de la taille téléchargée du KTX2, ni de la couverture fine entière. Leur couverture dépend des résolutions de chaque page et de la part consommée par les parents. **Changer la résolution géographique d'une page de 10 m à 0,5 m ne change pas sa taille GPU ; cela réduit sa couverture, ce qui accroît la pression du cache.**

WorldCover peut être stocké en `r8uint` : 64 pages de 256² représentent **4 MiB**, sans mipmaps. Les IDs de classes ne doivent pas être interpolés ou compressés avec pertes. Pour la distance, produire des proportions de couverture séparées ou un majoritaire calculé correctement ; une moyenne arithmétique d'IDs est invalide.

Pour 300 000 candidats à 32 octets : **9,2 MiB**. Deux listes d'indices de cette capacité : **2,3 MiB**. Ajouter compteurs, allocations de sécurité et données de prototypes. Une matrice 4×4 par candidat doublerait déjà la taille de la fiche ; une position locale quantifiée, orientation, taille et seed peuvent suffire.

À 2,2 Mpx, une couleur HDR `rgba16float` et une profondeur 32 bits représentent **25,2 MiB** en un échantillon. Une vitesse 4 octets/pixel ajoute **8,4 MiB**. Le doublage pour histoire ou le MSAA multiplient certains postes ; ils doivent apparaître dans les comptes.

**Configuration intermédiaire concrète à viser pour le premier B :**

| Poste ajouté | Enveloppe |
|---|---:|
| Couleur : 64 pages 1024² compressées | 85 MiB |
| Classes, proportions, exclusions et petite table de pages | 8–16 MiB |
| Matériaux de sol partagés, meshes et atlas de végétation | 48–96 MiB |
| Candidats, listes visibles et commandes | 12–20 MiB |
| Cibles locales HDR/profondeur/vitesse réutilisées quand possible | 25–40 MiB |
| **Somme indicative** | **178–257 MiB** |

Cette somme exclut les 64 MiB de relief existants et le reste du moteur. Sur mémoire unifiée Apple, CPU, workers, staging et GPU partagent aussi une pression mémoire globale. Le navigateur n'offre pas un budget VRAM universel fiable : limiter soi-même pools et copies, surveiller pertes du device et échecs d'allocation.

Sans compression, baisser la capacité et/ou la taille des pages. Conserver le même pool 64 × 1024² en RGBA8 ajouterait environ **256 MiB** à lui seul. La dégradation doit donc être prévue dans le profil matériel, pas laissée à l'OOM.

### 8.2 Stockage : la planète entière n'est pas un petit asset

Pour une surface terrestre simplifiée de 149 millions de km², à 10 m : environ **1,49 × 10¹² pixels**. Une couche couleur BC7 complète et mip-mappée représenterait environ **2 TB décimaux** avant conteneur, masques, géométrie et redondance de tuilage. Le calcul ne prédit pas exactement la taille d'une mosaïque mondiale projetée ; il donne son ordre de grandeur.

À surface égale, passer de 10 m à 20 cm multiplie le nombre de pixels par **2 500**. La distribution mondiale uniforme d'orthophotos fines ne correspond pas au budget de ce projet.

| Région carrée | Pas | Couleur BC7 + mips, couverture fine complète |
|---|---:|---:|
| 20 × 20 km | 10 m | 5,3 MB |
| 20 × 20 km | 1 m | 533 MB |
| 20 × 20 km | 0,5 m | 2,13 GB |
| 20 × 20 km | 0,2 m | 13,3 GB |

Ces tailles décrivent les blocs GPU et leurs mipmaps, pas des tailles HTTP promises. Les fichiers peuvent être supercompressés ; les bordures, parents et autres couches ajoutent des octets. Télécharger tout le pack au lancement serait une erreur : **ne charger que les pages utiles, avec un parent prêt**.

### 8.3 Débit en déplacement

Une approximation de la surface neuve parcourue par seconde, pour une zone de détail de rayon `r` et une vitesse `v`, est `2 × r × v`. Exemple : `r=2 km`, `v=250 m/s` → **1 km²/s** de surface nouvelle.

```text
débit blocs couleur + mips ≈ 2 × r × v / pas² × 4/3 octets/s
```

| Hypothèse | Flux théorique couleur |
|---|---:|
| r=2 km, v=250 m/s, pas=10 m | 0,013 MB/s |
| r=1 km, v=100 m/s, pas=0,5 m | 1,07 MB/s, soit 8,5 Mbit/s |
| r=1 km, v=250 m/s, pas=0,5 m | 2,67 MB/s, soit 21,3 Mbit/s |
| r=1 km, v=100 m/s, pas=0,2 m | 6,67 MB/s, soit 53,3 Mbit/s |

Ces valeurs sont une moyenne idéale sur un terrain nouveau. Les téléchargements par tuiles, bordures, autres couches, virages et arrivées à froid peuvent demander davantage ; KTX2 supercompressé peut demander moins. Une fois la zone en cache, le débit baisse nettement.

**C'est pourquoi le 0,5–1 m local mérite de passer avant le 20 cm étendu.** Le pilotage du détail doit prendre en compte vitesse, trajectoire, taille projetée, débit et latence, pas seulement la puissance GPU.

Précharger un corridor de **5–15 secondes** devant l'avion comme hypothèse initiale : à 250 m/s, 1,25–3,75 km. Garder une couronne autour de la caméra pour les virages et un repli pour une téléportation. En time warp, réduire le détail et sauter les requêtes qui n'arriveraient qu'après le passage de l'appareil.

### 8.4 Temps de frame : effet concret d'un surcoût

Dans une simplification où le GPU est le facteur limitant :

| Temps actuel | Ajout | Nouveau temps | Plafond théorique |
|---:|---:|---:|---:|
| 16,7 ms | 0 ms | 16,7 ms | 60 fps |
| 16,7 ms | 2 ms | 18,7 ms | 53,5 fps |
| 16,7 ms | 4 ms | 20,7 ms | 48,3 fps |
| 16,7 ms | 6 ms | 22,7 ms | 44,1 fps |

La présentation écran, le pipeline à plusieurs frames et le CPU font que le résultat observé ne sera pas exactement ce quotient. Il explique cependant pourquoi **« seulement 4 ms » reste une dépense importante**.

Pour 60 fps : viser une frame complète avec marge, autour de **14–15 ms GPU** selon écran/pipeline, et réserver initialement **2–3 ms au paysage supplémentaire** seulement si la scène de base le permet. Sinon il faut réduire un autre poste, diminuer la densité, ou adopter un terrain raster qui remplace du travail. Pour un mode 30 fps, 33,3 ms de période permettent plus de détail ; réserver aussi une marge pour les chargements et le cockpit.

Enveloppe à tester pour B, sans prétendre l'avoir obtenue : culling/LOD **0,2–0,6 ms**, végétation/bâti **0,8–2,0 ms**, ombres locales **0,3–0,8 ms**, atmosphère/composition **0,3–0,8 ms**, données/matériaux **0,4–0,8 ms**. Somme **2–5 ms environ**. Sur une vue de forêt dense rasante ou une ville, certains postes dépasseront ces hypothèses ; la régulation doit réduire le travail avant l'effondrement du framerate.

## 9. Streaming et préparation : déplacer le travail hors de la frame

### 9.1 Hors ligne

Pipeline conseillé : sélectionner les sources → reprojeter → harmoniser hauteurs et millésimes → nettoyer couleur/nodata → produire parents et bordures → préparer masques et géométrie → encoder KTX2 → publier avec manifeste versionné.

Les classes doivent garder leur sémantique lors de la reprojection. Les photos nécessitent raccords et gradients/mips corrects. Chaque tuile doit enregistrer résolution utile, source, année, référence verticale et version. Ne pas télécharger un COG de plusieurs degrés pour n'en afficher qu'une petite partie.

Un outillage géospatial hors ligne peut utiliser GDAL/Python ; l'orchestration et le runtime du projet restent en **Bun**, conformément à `CLAUDE.md`. Les choix précis de bibliothèques et options de commande demanderaient une lecture de leurs docs au moment de l'implémentation.

### 9.2 En jeu

- Cache de pages physiques borné avec parents garantis et validité par page ; ne pas attendre que toute une grande fenêtre soit complète pour améliorer un petit secteur.
- Priorité aux pages visibles, au terrain devant l'appareil et aux zones d'atterrissage ; annuler les travaux dépassés.
- Décodage/transcodage dans workers ; buffers transférables, pas de tableau de millions d'objets JS.
- Limiter uploads par frame, initialement **1–4 MiB**, à régler par mesure ; suivre aussi leur latence et les copies temporaires.
- Charger les matériaux/prototypes en avance ; créer les pipelines asynchrones avant leur usage visible. Aucun compile à la première seconde de finale.
- Un changement de couleur ne doit pas reconstruire les hauteurs CPU ni modifier le sol ; la validité des couches est indépendante.
- Purger les ressources après sortie de la Terre, avec délai pour éviter l'oscillation au seuil.

Dans le code actuel, `pixels/decode/put` de `EarthTiles` utilisent `OffscreenCanvas`, extraient les pixels puis font des boucles et uploads depuis le contexte appelant, sans worker dédié à ces tuiles. `OffscreenCanvas` seul ne déplace pas ces opérations dans un autre thread. Étendre ce chemin tel quel à de nombreuses grandes photos augmenterait les risques de longues tâches.

Réutiliser le worker KTX2 est utile : son protocole actuel **transfère déjà les buffers des niveaux transcodés** côté réponse. Il traite les fichiers séquentiellement pour protéger l'instance partagée du transcodeur ; mesurer sa file d'attente avant d'augmenter le volume. Contrôler aussi le heap WASM, les copies nécessaires à l'upload et la durée de vie du worker.

### 9.3 Hébergement

Publier un petit pack pilote statique et versionné, conforme au workflow de déploiement existant. Pour une extension globale, envisager stockage objet/CDN ou génération de tuiles côté service, avec cache de résultats ; la sélection/décompression geospatiale n'a pas à se faire dans la boucle de vol.

Éviter de construire le runtime autour d'une API scientifique à requêtes coûteuses pour chaque joueur. Les services Copernicus/Sentinel Hub ont quotas et limites : données gratuites ne signifie pas traitement et distribution sans limite. [Quotas CDSE](https://documentation.dataspace.copernicus.eu/Quotas.html).

Ne pas utiliser le WMTS colorisé WorldCover comme masque de classes : l'ESA précise que les cartes web représentées en RGB sont destinées à la cartographie et non à l'analyse. Utiliser les valeurs de classification des COG. [Accès WorldCover](https://esa-worldcover.org/en/data-access).

**Adaptation PWA indispensable :** les nouvelles tuiles doivent entrer dans le budget LRU. Les règles actuelles classent les ressources du même origin sans hash comme « shell », et les assets hashés comme immuables. Des tuiles locales ajoutées naïvement seraient donc mises dans un cache qui ne possède pas le budget terrain attendu. Définir leur classification avant distribution ; versionner données et index, prévoir mode offline explicite pour les régions téléchargées.

## 10. Profils de qualité proposés

Les noms de GPU ne suffisent pas : le projet peut promouvoir/rétrograder le tier par mesure. Les profils ci-dessous sont des points de départ, puis le gouverneur choisit selon le **temps complet de frame**, le réseau et la pression mémoire.

| Profil | Paysage | Rayon initial de meshes proches | Pages couleur | Surcoût GPU ciblé | Objectif |
|---|---|---:|---:|---:|---|
| Économe / appareil faible | Sentinel + matériaux, canopée et bâti agrégés | 0–100 m | 32 × 512² | ≤ 1–2 ms | Bonne géographie, fluidité prioritaire |
| Intermédiaire / Apple selon mesure | A+B, imposteurs, peu de meshes proches, ombres limitées | 150–250 m | 32–64 × 1024² compressées | ≤ 2–3 ms si disponibles | 60 fps là où le renderer de base le permet |
| Haut / GPU avec marge | A+B+C, packs locaux, silhouettes plus denses | 300–500 m | 64–128 × 1024², si budget mémoire | ≤ 4–6 ms si disponibles | 60 fps ou choix qualité 30 fps |
| Photo / pause | Données résidentes fines, densité et ombres augmentées | Selon région | Bornées séparément | Hors budget de vol temps réel | Rendu fixe ; ne valide pas la qualité en vol |

Les rayons ne remplacent pas le choix par taille projetée. L'avion peut être à 500 m AGL : aucune instance au sol ne sera alors dans un rayon 200 m autour de la caméra, ce qui est normal. Le paysage passe en imposteurs/groupes.

Quand la frame dépasse son budget : réduire d'abord accessoires/herbe, ombres lointaines, meshes détaillés et nombre de candidats. Conserver autant que possible la **position des bâtiments, les lisières, les grands volumes et la couleur réelle**. Ne pas faire disparaître une moitié de ville pour maintenir un chiffre de fps. Diminuer la résolution interne vient après ces coupes ciblées, avec hystérésis et diagnostic visible.

Si la base seule manque le budget, il n'y a aucune raison d'activer B complet. Le governor doit pouvoir rester en A, afficher pourquoi, et proposer un mode qualité 30 fps. Définir un contrôle propre du paysage, sans oscillation avec les changements de résolution et de tier existants.

## 11. Coût de réalisation et coût d'exploitation

### 11.1 Charge de développement

Estimations de planification, pour une personne expérimentée connaissant ce renderer, avec accès aux sources ; elles ne constituent pas un devis ni une date garantie. La création artistique et la préparation de régions peuvent devenir le poste dominant.

| Lot | Charge indicative | Résultat nécessaire pour décider |
|---|---:|---|
| Étude de données concrètes + petit pack + référence A/B | 3–5 jours | Couleur/classe/terrain alignés, tailles de fichiers réelles |
| Prototype A avec cache, matériaux, worker et instrumentation | 5–10 jours | Premier gain visuel et coûts sur les deux Macs |
| Intégration profondeur/atmosphère des objets | 5–15 jours | Bosquet correct depuis cockpit, par brume et soleil bas |
| B : LOD, placement, culling, ombres et budgets | 15–30 jours | Vol rural/forestier stable, caps vérifiés |
| Terrain proche raster, si nécessaire | 10–25 jours supplémentaires | Gain net A/B et collisions conservées |
| Premier pack C avec bâti, relief fin et raccords | 10–25 jours | Région premium réellement agréable à 100–300 m |
| Robustesse, TARS, PWA, multi-appareils, tests | 10–20 jours | Produit distribuable |

On peut voir un premier progrès A en **1–3 semaines de travail**. La cible robuste B+C se compte plutôt en **plusieurs mois**, typiquement 3–6 selon l'intégration et le travail artistique. Ne pas planifier un globe uniformément AAA comme quelques semaines d'instancing.

### 11.2 Sources, assets et bande passante

Les données ouvertes choisies évitent un achat de couverture, mais pas la préparation, le stockage, le CDN ni les crédits requis. Les bibliothèques d'assets doivent autoriser une **distribution dans une application web**, où les fichiers sont récupérables ; contrôler la licence effective du pack acheté ou créé. Les modèles détaillés ne doivent pas être injectés tels quels sans LOD et atlas.

Pour dimensionner l'exploitation :

```text
trafic mensuel ≈ sessions × données nouvelles moyennes/session
coût ≈ stockage × tarif stockage + trafic facturé × tarif egress
       + requêtes + calcul de préparation/génération éventuelle
```

Exemple de sensibilité, **pas tarifs actuels d'un fournisseur** : 10 000 sessions consommant 400 MB nouvelles chacune donnent environ **4 TB/mois**. À une hypothèse de 0,05 €/GB de trafic, cela donne **200 €/mois**, avant autres postes. Si le cache porte les nouvelles données à 40 MB/session, ce poste descend vers 20 €. Une hypothèse de 0,02 €/GB/mois pour 2 TB stockés donne 40 €/mois. Choisir un hébergeur exige un chiffrage réel de son offre, des quotas et du trafic.

Ces scénarios n'estiment pas encore le trafic du jeu : un échantillon de vols avec fichiers préparés doit fournir la moyenne réelle. Une région connue en cache et un trajet nouveau à 250 m/s n'ont pas la même consommation.

## 12. Protocole pour prouver le rapport qualité/coût

### 12.1 Matrice de vol

| Scène | AGL et cas | Ce qu'elle doit révéler |
|---|---|---|
| Le Bourget, finale cockpit et externe | 1 000 → 50 m | Exclusions, profondeur, netteté des pistes, bâti proche |
| Cévennes | 100 / 300 / 1 000 m, soleil bas | Terrain, lisières, masquage par les crêtes, ombres |
| Forêt dense | 100 / 300 / 1 500 m, vue rasante et nadir | Overdraw, transition canopée/arbres, scintillement |
| Plaine agricole | 300 / 1 000 / 3 000 m | Vraies parcelles, répétition, stabilité des matériaux |
| Ville dense | 300 / 1 000 m, jour et nuit | Nombre de lots, LOD quartiers, ombres et mémoire |
| Côte, rivière, pont | 100 / 500 m | Masques eau/sol, pas d'arbres dans l'eau, ouvrage 3D |
| Sortie atmosphère et retour | Au-delà des seuils locaux | Continuité vers le globe et libération des ressources |

Vitesses : **80–100 m/s**, **250 m/s**, puis une vitesse plus élevée compatible avec le vol retenu pour stresser le streaming. Ajouter virages à 90°, demi-tour, zoom, téléportation, pluie/brume, cache froid, cache chaud et données indisponibles.

### 12.2 Mesures

- Frames réellement rendues : fps, intervalles p50/p95/p99, proportion > 33 et > 50 ms.
- GPU par passe : trace, culling, terrain raster éventuel, végétation, bâti, ombres, atmosphère, composition, temporal.
- Main thread et workers séparément : génération, décodage, encodage, uploads, longues tâches.
- Résolution interne, bloc de sous-échantillonnage, tier et settings exacts pendant chaque mesure.
- Allocations GPU comptabilisées, heap JS/WASM/staging, pics à froid, retour au budget après départ.
- Octets réseau, temps jusqu'à détail utilisable, défauts de pages et profondeur de préchargement.
- Qualité **en mouvement** : lisières, parallaxe, ghosting, popping, scintillement, cohérence jour/nuit et brouillard.

Comparaisons proposées : référence → A → A + matériaux → B sans ombres → B avec ombres → B avec/sans occlusion → terrain raster éventuel → C. Mesurer le GPU à résolution/bloc fixés pour comprendre le coût, puis refaire les vols avec le mode adaptatif pour voir l'expérience réelle. Intercaler A/B/B/A et répéter ; garder temps, météo, trajectoire et jeu de tuiles identiques.

Les scripts existants servent de point de départ :

```bash
# Référence avant implémentation, quand le serveur local est disponible
bun scripts/bench.ts --label earth-detail-reference --suites worlds,weather,flights --quick

# Fonctionnel local puis remote, sélection ajustée au catalogue
bun run e2e planet-detail cockpit-flight landing
bun run e2e --remote planet-detail cockpit-flight landing

# Vérification complète avant un push d'implémentation
bun run check && bun test
```

Respecter [E2E.md](E2E.md) : **un seul Chrome de test par Mac**, ici headless, `kerr-mini` en plein écran. Comparer chaque machine à sa propre référence, sans mélanger ses fps avec ceux de l'autre. Ajouter les nouveaux vols au Kerr Bench et les tests au [catalogue](E2E-CATALOGUE.md). Les commandes ci-dessus sont un protocole futur ; elles n'ont pas été exécutées pour cette étude documentaire.

### 12.3 Critères de passage proposés

1. **A** : gain perceptible sur parcelles/forêts/littoraux, classes correctes, aucune longue tâche nouvelle récurrente, surcoût GPU compatible avec la marge mesurée.
2. **B** : arbres et maisons correctement masqués et éclairés, transitions acceptables en virage, plafond d'instances/draws respecté, pas de croissance mémoire sur un vol de 20 minutes.
3. **C** : sol identifiable à 100–300 m dans la région ciblée, volumes alignés avec l'orthophoto, terrain/collisions raccordés, débit soutenable à la vitesse choisie.
4. **60 fps** : le profil matériel doit les tenir en frames rendues avec une qualité interne définie et une marge ; ne pas valider une « qualité AAA » qui n'existe que sur une capture après convergence.
5. **Repli** : pages manquantes/offline/device faible donnent un paysage dégradé continu, sans trou, crash ni changements du sol qui compromettent une finale.

## 13. Intégration au projet et à TARS

Points d'intervention prévus, sans imposer de refonte globale :

| Emplacement | Évolution envisagée |
|---|---|
| `src/system/earth-tiles.ts` | Conserver ou adapter le relief ; séparer couches et préparation asynchrone |
| Nouveau cache de surface | Pages couleur/classes, parents, priorités, manifestes de régions |
| Nouveau renderer de paysage et shaders dédiés | Instances, listes visibles, LOD, ombres, profondeur |
| `src/renderer.ts` | Ordre des passes, budget et contract profondeur/atmosphère |
| `src/shaders/trace.wgsl` | Couleur/classification réelle ; chemins spécialisés, ajouts minimaux dans les boucles |
| `src/terrain.ts`, nivellement des pistes | Sampler physique cohérent si nouvelle hauteur |
| `src/system/ktx-worker.ts`, `ktx2.ts` | Transferts, limites du heap, débit de transcodage |
| `src/tier.ts`, `quality-policy.ts`, settings | Profils et budget paysage indépendants, télémétrie |
| `src/pwa/rules.ts`, `sw.ts` | LRU des nouvelles tuiles et régions offline |
| Outils d'assets / build / déploiement | Préparation reproductible, attribution et tailles contrôlées |
| Tests / bench | Couverture visuelle en vol, mémoire et streaming |

Conformément à `CLAUDE.md`, **TARS doit pouvoir atteindre toutes les nouvelles fonctions** :

- Régler détail, densité, ombres et budget ; sélectionner/télécharger une région si cette fonction existe.
- Lire source/résolution du sol, région, pages résidentes/en attente, mémoire, instances par LOD et temps des nouvelles passes.
- Montrer réglages et diagnostics ; recevoir un événement lors de disponibilité d'une région ou d'un repli durable.
- Attendre l'achèvement d'une préparation et proposer une commande `/` adaptée aux actions joueur.

Étendre `get_state/get_telemetry`, les tools/commands et les tests TARS, puis documenter les nouveaux membres de `__bh` dans [BH-API.md](BH-API.md). Un contrôle « Ultra » accessible seulement par une nouvelle case de panneau ne satisferait pas les règles du projet.

## 14. Décision proposée

**Je choisirais A → B → C, en fixant des portes de mesure à chaque étape.**

Commencer par un pack de deux régions et les composites WorldCover/Sentinel-2 2021 : c'est le moyen le plus direct de vérifier la valeur du 10 m réel. Ajouter ensuite un bosquet raster avec LOD et profondeur/atmosphère correcte, puis seulement la densité et le bâti. Décider du terrain proche raster lorsque les passes montrent que `earthMarch` empêche d'atteindre le budget. Finir par un pack IGN préparé à 0,5–1 m sur la zone de vol bas.

**Ce qui est réaliste :** géographie bien plus détaillée presque partout ; paysage photoréaliste crédible sur des régions choisies ; faible coût CPU principal grâce à la préparation, aux workers et aux lots GPU ; coût GPU maîtrisable par profils et représentations.

**Ce qui ne peut pas être promis à ce stade :** photoréalisme uniforme à 100 m sur toute la planète, 60 fps sur tout appareil, ou zéro surcoût GPU. Le compromis le plus solide consiste à préserver la structure réelle et les silhouettes, puis à concentrer le détail coûteux dans les pixels qui le montrent.

**Premier jalon concret : un vol rural/forestier de 300 à 1 500 m, puis une finale à 100 m dans un pack local, avec rapport A/B, vidéo en mouvement, tailles réseau réelles et budget complet CPU/GPU/mémoire.** Ce jalon permettra de choisir la qualité maximale soutenable avec des preuves, avant un investissement mondial.
