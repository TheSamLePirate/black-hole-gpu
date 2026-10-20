# Analyse — un pipeline terrestre de qualité AAA, adapté au vol

Date : **20 octobre 2026**. Base examinée : **`a9380bfe69d8b40a26bc4ed158934338624646c1`**, dernier `origin/main` récupéré à la création de la branche `codex/aaa-terrestrial-renderer`.

Statut : **proposition d'architecture, aucune implémentation dans ce document**. Analyse statique du code, lecture des mesures déjà archivées et de références techniques primaires. Aucun test, benchmark, serveur ou navigateur de jeu lancé pour cette étude. Le plan associé est [PLAN-PIPELINE-TERRE-AAA.md](PLAN-PIPELINE-TERRE-AAA.md).

## 1. Demande et niveau visuel recherché

Le propriétaire rapporte environ **24 images/s sur son Mac M1 Max, en temps réel ×4**, avec une image fortement pixellisée. Ce chiffre décrit son expérience ; la résolution interne, la scène, la météo et les réglages exacts n'ont pas été relevés dans cette analyse. À cadence régulière, 24 images/s correspondent à environ 41,7 ms entre images ; **ce n'est pas une mesure isolée de la passe de trace ni la preuve que le GPU consomme seul ces 41,7 ms**.

Dans le code, un bloc ×4 représente un rayon par zone de 4 × 4 pixels internes, soit un échantillonnage frais de 1/16 avant reconstruction. La résolution interne peut elle-même différer de la résolution de sortie. Il ne faut donc pas confondre bloc ×4, échelle de résolution, DPR et qualité finale.

La référence graphique est **Microsoft Flight Simulator** : profondeur atmosphérique, lumière, nuages, matériaux, végétation et continuité du paysage en vol. L'objectif ne porte pas sur sa précision géographique ni sur sa couverture photogrammétrique. Cette étude ne prétend pas reproduire son pipeline propriétaire.

### Ce que « AAA » doit signifier ici

- Une image convaincante **en mouvement**, pas seulement après convergence à l'arrêt.
- Des crêtes, lisières, pistes et petits objets lisibles sans blocs dominants.
- Un éclairage compatible entre terrain, appareils, forêts, nuages et cockpit.
- Des forêts continues sur les 10–20 km vus devant l'avion, sans détailler chaque arbre à cette distance.
- Des transitions de résolution, de représentation et de chargement progressives.
- Des matériaux reconnaissables par leur réaction à la lumière, et pas uniquement par leur couleur.
- Un coût et une résidence mémoire plafonnés, avec dégradation contrôlée sur les appareils moins puissants.

**Aucun engagement de 60 images/s ou d'égalité visuelle avec Flight Simulator ne découle de la seule lecture du code.** Le premier objectif est une image beaucoup plus fine que le ×4 actuel avec une meilleure cadence stable sur le M1 Max, dans des conditions figées. 60 images/s reste une cible de dimensionnement ultérieure.

## 2. Cartographie vérifiée du rendu actuel

### 2.1 Le paysage est tracé dans des shaders compute

[renderer.ts](../src/renderer.ts), `dispatchTrace`, crée et exécute les noyaux compute de [trace.wgsl](../src/shaders/trace.wgsl). Les recherches d'intersection sont écrites en WGSL ; ce n'est pas un pipeline d'intersection matérielle RTX. Ce n'est pas non plus un path tracer général calculant tous les rebonds diffus du monde.

| Élément | Chemin actuel | Détail important |
|---|---|---|
| Relief terrestre | `earthNear` → `earthMarch` → `earthHeight*` | Recherche sur les cartes de hauteur et le détail procédural ; boucle principale plafonnée à 256 pas, arrêts anticipés |
| Forêts | `worldScenery` → `forestQuery` | Grille duale, intersections analytiques, couronnes sculptées de près |
| Bâtiments et ponts OSM | `sceneryQuery` | BVH et extrusions/polygones simplifiés |
| Certains équipements d'aéroport | `airportScenery`, `windsocks` | Volumes et intersections procédurales |
| Routes, pistes et matériaux du sol | `earthGround`, `scenerySurface`, `runwayShade` | Essentiellement évalués au point touché, sans un rayon indépendant par marquage |
| Nuages proches | `cloudVolume`, `wxCloud` | Intégration volumétrique, 16 intervalles par traversée et par couche concernée |
| Atmosphère, brume et aurores | `earthAir`, fonctions associées | Intégration ; perspective aérienne partiellement mutualisée en temps réel |
| Vagues proches | `seaSurfaceHit` | Intersection avec les hauteurs FFT dans certaines limites de distance et de hauteur |
| Ombres du relief et du décor | `earthTerrainShadow`, `sceneryShadow` | Parcours supplémentaires vers le Soleil, bornés |
| Certains reflets des eaux calmes | `waterMirror`, `sceneryMirror` | Rayons réfléchis vers le relief et les arbres proches des rives |
| Gargantua et trou de ver | `traceLook`, `dnegTrace` | Intégration des trajectoires courbes et des milieux traversés |

### 2.2 Le jeu est déjà hybride

Les appareils et cockpits ([ship.ts](../src/ship.ts)), la station ([station.ts](../src/station.ts)), l'Endurance ([endurance.ts](../src/endurance.ts)), les personnages, l'herbe et les petits cailloux ([character-renderer.ts](../src/character-renderer.ts)) sont dessinés par triangles. Certaines passes utilisent déjà l'instanciation et des commandes indirectes.

Leurs ombres comprennent des cartes d'ombre rasterisées. Leur éclairage peut néanmoins appeler des parcours du décor : par exemple `nearSceneryShadow` dans [character.wgsl](../src/shaders/character.wgsl) traverse le BVH et la forêt ; l'herbe mutualise une partie de ce travail dans `grassLight`.

Les panaches sont également hybrides : une géométrie rasterisée peut délimiter un volume intégré dans son fragment shader. **Une passe compute n'est pas automatiquement du ray tracing, et une passe raster peut contenir une marche volumétrique.** La FFT, les filtres, la reconstruction, le bloom et les photomètres sont du calcul GPU sans recherche géométrique générale de rayons.

Les étoiles et fonds combinent textures, procédural et projection directe selon le chemin. Les reflets des appareils utilisent notamment une sonde filtrée et `screenRefl`, qui consulte l'image par direction en supposant le décor lointain ; ce n'est pas une recherche d'intersection générale du reflet avec toutes les surfaces proches.

### 2.3 La Terre ne paie pas systématiquement le traceur relativiste

`trace` retourne directement lorsqu'une surface proche est rencontrée. `renderer.ts` sélectionne aussi une spécialisation `earthOnly` retirant `HAS_KERR` lorsque les conditions de distance et de taille angulaire de la région du trou de ver le permettent. Le chemin droit de `traceLook` évite alors l'intégration courbe.

**Le problème terrestre principal n'est donc pas de supprimer Kerr sur chaque pixel du terrain : ce raccourci existe déjà.** Il concerne les évaluations de surface, les parcours de visibilité et d'ombre, puis la reconstruction d'une image peu échantillonnée.

## 3. Ce que prouvent les archives, et leurs limites

[PLAN-RENDU-PERF.md](PLAN-RENDU-PERF.md) rapporte des mesures des 16–17 octobre sur **kerr-mini, Mac mini M1**, notamment à 1600 × 1000 avec blocs ×4. Il ne s'agit ni de mesures nouvelles, ni du M1 Max du propriétaire, ni d'un budget directement transposable au commit de base.

| Observation archivée | Implication pour la conception |
|---|---|
| Trace seule autour de 19–23 ms dans certaines vues des Alpes ; environ 25,7 ms à Tarifa dans un autre lot | La visibilité et l'ombrage terrestres peuvent déjà dépasser un budget complet de 16,7 ms |
| Généralement 14–30 pas de terrain par rayon, p90 32–81 ; 24–37 lectures de hauteur | Le maximum de 256 ne décrit pas le coût moyen ; le prix d'une hauteur compte beaucoup |
| Réduction importante du coût en retirant le détail procédural dans certains scénarios | Mutualiser et filtrer les évaluations est plus prometteur que seulement raccourcir les marches |
| Grille de déformation déjà adoptée, perspective aérienne déjà mutualisée | Ne pas reproposer ces optimisations comme absentes |
| Plusieurs réglages de TAA et filtres de reconstruction sans gain significatif en vol | Le manque d'information fraîche et les erreurs de reprojection ne se résolvent pas par le seul filtre |
| Étendre la portée du décor n'a pas toujours augmenté fortement la trace dans les scènes étudiées | Éviter d'affirmer que tout ajout d'arbres coûte proportionnellement au nombre résident |
| Portée accrue : hausse de mémoire, réseau et préparation du worker | Rendu et streaming doivent être traités séparément |

Certaines expériences anciennes ont été corrigées à cause de variantes pas encore compilées ou de scènes pas entièrement chargées. Les suppressions de fonctions donnent des bornes locales de coût, **pas des gains additionnables**. Les images rAF, les images réellement soumises/terminées et les timings GPU sont des métriques différentes. Les documents signalent aussi des recouvrements de timestamps de passes raster sur Apple.

La conclusion justifiée est une **hypothèse d'architecture à forte plausibilité**, pas un facteur d'accélération chiffré.

## 4. Les écarts structurels de qualité

### 4.1 Visibilité coûteuse et information fraîche rare

Le terrain est recherché par rayon ; ses normales peuvent demander trois évaluations supplémentaires de hauteur (`earthNormalAt`). Les ombres relisent aussi du relief. Les grilles de déformation allègent déjà une partie du calcul, mais la surface complète n'est pas un cache de hauteurs/normales final partagé par tous ces usages.

En temps réel, `post.wgsl` reconstruit les pixels sans rayon frais à partir de voisins et de l'historique. Un virage, une nouvelle surface visible ou une profondeur incorrecte oblige à utiliser une image pauvre en information. Augmenter les rayons améliore l'image en payant de nouveau le chemin coûteux.

### 4.2 Éclairage hétérogène

`earthGround` utilise principalement une réponse diffuse, une lumière de ciel approximée et un rebond de sol simplifié. L'humidité ajoute un reflet approximatif du ciel. `surfaceMaterial` enrichit surtout la couleur par un bruit modulé selon la classe.

À l'inverse, `ship.wgsl` dispose déjà de GGX, d'environnement préfiltré, de compensation énergétique, de vernis et d'anticrénelage spéculaire. Refaire ces composants existants n'est pas une priorité ; **rapprocher le sol et le décor de cette cohérence matérielle l'est**.

L'imagerie n'est pas un albédo pur : elle contient ombres et objets photographiés. La relire comme une réflectance puis ajouter des ombres peut introduire un double éclairage apparent. Il faut conserver son organisation géographique en maîtrisant progressivement ses contrastes et ses mélanges avec les matériaux synthétiques. Une décomposition exacte n'est pas possible à partir des seules images actuelles.

### 4.3 Profondeur, atmosphère et historique ne décrivent pas toute la scène de la même façon

Dans `encodePost`, la reconstruction temporelle et le flou de mouvement du fond précèdent l'ajout de la station, des personnages et des appareils. La profondeur du traceur est ensuite adaptée à leurs tests d'occlusion ; plusieurs cibles et rectangles locaux servent au compositing.

Cela a des raisons de performance et de précision, mais ce n'est pas un contrat commun de profondeur et de mouvement de toute la scène. Les shaders opaques des appareils/personnages inspectés ne reçoivent pas une application générale de la perspective aérienne au point visible équivalente à celle de `earthLook`. Un appareil distant doit pourtant subir l'extinction et la diffusion de l'air qui le sépare de l'observateur.

Les nuages sont composités dans `earthLook`, mais `earthNear` transmet la distance de la surface solide rencontrée ; la distance du nuage n'alimente pas une profondeur/motion indépendante de la reconstruction. Une couche devant le terrain peut ainsi hériter de sa parallaxe, et une couche devant le ciel d'une profondeur de fond.

Une seule profondeur opaque ne représente pas toutes les couches d'un volume. Une distance effective de nuage est utile, mais reste une approximation lors des superpositions et traversées.

### 4.4 Nuages sous-échantillonnés et peu préfiltrés

`cloudVolume` et `wxCloud` utilisent 16 intervalles quadratiques et le même décalage normalisé dans leurs intervalles ; les couches reçoivent le même `jit`. Les longues traversées peuvent avoir des intervalles kilométriques à plurikilométriques alors que les détails sont beaucoup plus petits.

`dnoise` lit le niveau zéro d'une texture 3D sans mipmaps. Les octaves de densité ne sont pas filtrées complètement selon l'empreinte du pixel et la longueur de l'intervalle. Le bruit d'échantillonnage est de l'IGN animé, pas un masque optimisé de bruit bleu spatiotemporel ; le jitter sous-pixel temps réel provient d'un hash distinct.

Un STBN correctement intégré aiderait à répartir l'erreur. Il ne corrige ni le manque de prélèvements utiles, ni la densité non filtrée, ni une mauvaise reprojection. Les transformations arbitraires d'une valeur aléatoire ne préservent pas nécessairement les propriétés d'un masque optimisé ; les usages doivent recevoir des dimensions/séquences appropriées.

L'éclairage interne des nuages comporte déjà phase, poudre et approximations de diffusion multiple. Les approfondir exige surtout une cohérence spatiale entre la densité visible, la lumière reçue et les ombres projetées ; ajouter du bruit et des lobes ne suffit pas à produire des formes convaincantes.

### 4.5 Forêts compactes, mais sans représentation collective lointaine

`forest.ts` stocke un mot de 32 bits par cellule de 7 m ; le GPU reconstruit les arbres par hachage stable. `forestQuery` parcourt une grille duale avec blocs de 8 × 8 pour sauter les régions hors de la hauteur du rayon. Le budget d'environ 640 étapes compte aussi des passages de blocs : ce n'est pas un rayon fixe de portée.

Les couronnes sont sculptées jusqu'à environ 220 m, puis simplifiées analytiquement. Il n'existe pas de HLOD collectif de forêt/canopée. Les feuilles n'ont pas à être individualisées à 20 km, mais les masses et silhouettes doivent persister.

La préparation normale est de 2/3 km de rayon, ×1/1,5/2 selon `detailReach`, avec 250 m supplémentaires pour la grille forestière. L'intersection caméra est bornée à 2,5/3,5 km × portée, soit 7 km au maximum. Les 20 km de `GAZE_TILES_M` concernent le guidage des fenêtres du relief, pas une forêt chargée sur 20 km. La préparation est aussi arrêtée au-dessus de 12 km d'altitude ellipsoïdale : c'est une limite actuelle, pas une propriété à conserver pour la forêt distante.

Une grille carrée couvrant un rayon de 20 km à 7 m représente environ 33 millions de cellules, soit 130 Mo décimaux pour les mots seuls, avant bornes et données temporaires. Ce calcul illustre le mauvais passage à l'échelle d'une simple extension uniforme ; il ne prédit pas le temps de rendu.

### 4.6 Le ciel et la radiance ont aussi des conventions artistiques

Le projet possède déjà exposition automatique, pré-exposition, plusieurs opérateurs de rendu des couleurs et des lectures sRGB correctes. Il n'a pas besoin d'un nouveau tone mapper pour devenir AAA.

`skyScale` conserve volontairement la luminosité du fond artistique sous exposition automatique. Certaines émissions sont exprimées pour rester visibles à l'écran. Ces choix servent le mode spatial/cinématographique ; leur interaction avec les sondes ne doit pas piloter involontairement l'éclairage physique terrestre.

Prévoir une calibration terrestre cohérente, tout en gardant explicitement les intentions artistiques des autres modes et la lisibilité des interfaces. Éviter une migration brutale de toutes les unités et de toutes les scènes.

## 5. Architecture retenue

### 5.1 Deux chemins de visibilité, des données et conventions partagées

1. **Terre et voisinage où l'approximation droite est valide :** raster forward léger pour les surfaces, volumes compute dédiés.
2. **Régions relativistes :** traceur existant conservé pour les trajectoires et éléments déformés.

Sélection selon l'erreur angulaire et les conditions physiques, avec hystérésis. L'altitude seule ne suffit pas. Le zoom doit être pris en compte. On ne peut pas coller une image raster de géométrie à distance finie derrière le trou de ver et obtenir automatiquement les bonnes déformations.

Le proche terrestre doit rejoindre un globe lointain courbe, sans trou à l'horizon ni saut depuis l'orbite. La caméra, les contacts et les tuiles restent WGS84 ; positions relatives à la caméra/ancrages locaux sur GPU, précision suffisante aux raccords et changements d'origine.

### 5.2 Pourquoi forward léger

Le monde extérieur est dominé par le Soleil, le ciel et des lumières locales sélectionnées. Un forward avec listes de lumières limitées, puis sélection par tuiles si nécessaire, évite d'imposer immédiatement un gros G-buffer et son trafic mémoire.

Sorties minimales : couleur HDR et profondeur ; mouvement lorsque le traitement temporel l'exige. Normales et masques supplémentaires seulement pour des effets identifiés. Ne pas ajouter par défaut une passe de profondeur complète ou une pyramide d'occlusion : sur Apple, le coût de géométrie et de stockage supplémentaire doit se justifier face au rejet matériel des surfaces cachées. Le feuillage découpé et les transparences demandent une attention distincte.

Le choix doit rester implémentable dans le WebGPU utilisé par le projet, sans supposer les tile shaders Metal, les mesh shaders, une accélération matérielle de rayons ou un ordonnanceur multi-draw natif. Les commandes indirectes déjà utilisées par le projet fournissent un socle, pas une garantie de coût nul.

### Exigence transversale : conserver les phénomènes physiques et optiques

**Le changement de pipeline ne doit supprimer aucun phénomène physique ou optique déjà implémenté.** Cette exigence porte sur le domaine et la précision actuels des modèles, pas sur une promesse de simulation optique exacte ou sur des phénomènes absents du jeu. La conservation est une condition de généralisation, pas une propriété automatique du raster.

La rasterisation remplace la recherche de visibilité des surfaces dans les régions où la trajectoire droite convient. Les calculs de transmission, de diffusion, de réfraction, d'occultation, d'éclairage et de transport relativiste restent des responsabilités explicites du pipeline. Une table ou un cache ne peut remplacer un calcul qu'avec un domaine de validité et une erreur contrôlés.

Points à traiter expressément :

- **Éclipses et occultations :** transmettre la visibilité du Soleil aux surfaces, nuages et volumes, et conserver les réponses existantes de la lumière diffuse (`sunSeenPhysical`, `sunSeen`, `skySeen`, `airShade`, `eclipse/shadows-gpu.ts`). Les éclipses lunaires et celles des autres corps font aussi partie de l'inventaire.
- **Réfraction atmosphérique :** préserver la direction apparente et son accord avec les positions/pointages astronomiques (`airBend`, `REFR_DELTA`, `system/refraction.ts`), ainsi que les effets chromatiques existants. Le chemin actuel infléchit notamment le fond astronomique ; cette migration ne promet pas de nouveaux mirages ou une réfraction complète du terrain proche. Un ciel astronomique directement rasterisé doit recevoir la transformation correspondante avant son affichage et son évaluation.
- **Diffusion et absorption :** conserver Rayleigh/Mie, absorption, phases, lumière solaire/lunaire, brume, nuages et perspective aérienne dans leur domaine actuel. L'éclipse doit aussi affecter les volumes, pas seulement la couleur finale du sol.
- **Réflexion et transmission :** conserver les réponses de Fresnel, matériaux, eau et vitrages ; une sonde ou un reflet écran doit avoir un repli valide lorsque son approximation ne convient plus.
- **Relativité et modes scientifiques :** conserver géodésiques Kerr/Dneg, lentilles, décalages de fréquence, aberration, transport de polarisation et fonctions spectrales/radio existantes. Lorsque les sorties du raster ne portent pas les grandeurs nécessaires (par exemple Stokes), garder le chemin spécialisé plutôt que supprimer silencieusement le phénomène.

Le tableau de non-régression du plan doit être complété à partir du code avant la bascule. La position réelle des corps, leur position apparente, leur visibilité et leur radiance doivent rester cohérentes dans l'image principale, les sondes et le télescope.

### 5.3 Contrat de scène

- **Géométrie :** même source de hauteur et nivellement que la physique ; détail graphique filtré et erreur de simplification explicite.
- **Profondeur :** profondeur GPU précise et convention commune ; conversion documentée vers distance physique pour les consommateurs compute/legacy. Le nuage n'écrase pas la profondeur opaque.
- **Mouvements :** caméra, rotation terrestre, poses précédentes, animation et advection ; masques locaux d'invalidation pour tuiles/LOD/transparences.
- **Radiance :** espace linéaire et pré-exposition partagés ; conversion physique/artistique explicite ; une exposition finale cohérente.
- **Atmosphère :** chaque surface reçoit l'air jusqu'à sa distance ; nuages et air composés par segments ordonnés. Un voile final unique ou deux applications de brume sont incorrects.
- **Cockpit :** proche opaque, vitrage, contenu extérieur et écrans distingués ; ne pas appliquer une distance de paysage au tableau de bord ni laisser le décor traverser une coque opaque.

### 5.4 Terrain : géométrie préparée et caches de surface

Réutiliser `EarthTiles`, `EarthSurface`, `WarpGrid`, le nivellement des pistes et la hiérarchie globale. Construire des patches/grilles géométriques avec transitions, bornes et erreur projetée. Évaluer les hauteurs procédurales utiles lorsque le contenu d'une tuile change, pas tout le long de chaque rayon.

Cacher les hauteurs, normales macro, masques de matériaux et bornes à des niveaux cohérents. Le cache doit conserver une identité stable dans le monde, gérer les bordures/gutters et prévoir une version des sources. Les microdétails deviennent des textures filtrées ; les formes qui modifient la silhouette restent géométriques.

Ne pas cuire les reflets ou tout l'éclairage dans un cache statique. Ne pas promettre de conserver bit à bit une fonction actuellement dépendante de l'empreinte du rayon : formaliser sa surface source et ses versions filtrées. La quantification des hauteurs doit avoir une erreur bornée ; un float16 absolu à plusieurs kilomètres d'altitude n'est pas un remplacement sûr par défaut.

Une étape de cache de hauteurs/normales réutilisable par le ray marcher constitue un pont et une comparaison utile. Elle ne doit pas retarder indéfiniment l'évaluation du raster : elle conserve le parcours par rayon et la reconstruction clairsemée.

### 5.5 Lumière et matériaux

Partager transmission solaire, lumière diffuse du ciel, sondes d'environnement et cartes d'ombre. La sonde terrestre peut être dérivée des tables atmosphériques et d'une représentation économique du voisinage ; réserver le traçage du disque relativiste au mode qui l'exige.

Ombres proches par cartes stabilisées, portée/qualité par cascade ou équivalent ; relief lointain mutualisé à plus faible fréquence ; transmission des nuages issue de leur densité. Une approximation 2D au sol ne représente pas seule l'ombre à toutes les altitudes : prévoir une fonction d'évaluation/layers pour les appareils et reliefs élevés.

Matériaux terrestres cohérents : albédo, normale, rugosité, humidité, neige et occlusion appropriée. Mélanger la structure géographique réelle avec des matériaux multi-échelles ; ne pas inventer une géographie de détail contredisant les routes et parcelles. Garder les modèles PBR déjà présents sur les appareils et mutualiser leurs briques pertinentes.

Filtrer la rugosité et la variance des normales, la couverture des feuilles et les motifs procéduraux. TAA et affûtage ne remplacent pas ce préfiltrage.

### 5.6 Forêt et décor par tuiles et représentations

Découpler les familles de données et leur résidence : forêt lointaine indépendante du chargement OSM proche, tuiles conservées, priorité au regard/trajectoire avec couverture de sécurité autour de l'avion.

| Taille/distance indicative, à adapter au FOV et à la taille projetée | Représentation |
|---|---|
| Jusqu'à quelques centaines de mètres | Arbres individuels détaillés, contacts proches |
| Centaines de mètres à quelques kilomètres | Modèles simplifiés et/ou imposteurs multiangles |
| Quelques kilomètres | Groupes et HLOD avec profondeur, normales et ombrage compatibles |
| Environ 8–20 km et au-delà | Canopée en relief et silhouettes sélectionnées |

Les distances ne sont pas des coupures fixes. Zoom, crêtes, lisières et arbres isolés peuvent justifier une représentation plus fine. Garder des positions déterministes et une continuité d'albédo, couverture, hauteur et ombre entre LOD. L'instanciation ne résout pas l'overdraw de millions de feuilles.

### 5.7 Nuages et atmosphère dédiés

Conserver le socle atmosphérique, puis unifier ses tables et ses usages. Pour les nuages : météo macroscopique, profils verticaux par type, forme/érosion 3D filtrée, bornes d'occupation pour sauter le vide, prélèvements adaptés à la densité et à l'empreinte, arrêt sur opacité.

Éclairage et ombres internes doivent consulter une représentation cohérente de la densité, éventuellement mise en cache avec invalidation selon le vent, le Soleil et la météo. Le coût d'actualisation des caches compte dans le budget.

Résolution initiale candidate : moitié de chaque axe, soit un quart des pixels, **pas moitié du coût total garanti**. Historique propre aux volumes, mouvement du vent, distances/couches représentatives et rejet en découverte/traversée. Prévoir une stratégie plus robuste de près ; un unique mouvement moyen d'une colonne multinuages n'est pas exact.

STBN pour répartir l'erreur résiduelle, avec dimensions appropriées. Il ne remplace pas les formes, le filtrage ou la reconstruction. Les passages sous, dans, au-dessus et à travers plusieurs couches sont des cas normaux de ce jeu de vol.

### 5.8 Eau, transparences et traitement temporel

Conserver la FFT, rasteriser la surface avec LOD, transférer les vagues non résolues vers leur variance de pente/rugosité. Réutiliser sondes, reflets écran guidés par profondeur et reflets planaires sélectionnés ; conserver des rayons pour certains cas ou la photo si leur gain visuel le justifie.

Le `screenRefl` actuel suppose un environnement lointain ; ne pas le présenter comme un SSR général correctement parallaxé. Les reflets des objets proches nécessitent une représentation adaptée.

Intégrer les objets extérieurs au traitement temporel de la scène ; garder des historiques internes aux volumes mais éviter une double accumulation incontrôlée. Les vitrages et effets translucides reçoivent des masques/règles explicites. L'anticrénelage doit d'abord fonctionner à résolution interne élevée avant une reconstruction agressive. HUD à résolution de sortie ; cockpit traité pour préserver instruments et commandes.

## 6. Pourquoi cette direction plutôt que les alternatives

| Option | Intérêt | Limite / décision |
|---|---|---|
| Optimiser seulement le monolithe | Faible migration, bénéfices locaux possibles | Plusieurs optimisations ont déjà été explorées ; ne règle pas l'information fraîche manquante |
| Caches + terrain encore ray marché | Pont réutilisable, isole le coût des hauteurs | Conserve parcours, ombres spécifiques et reconstruction ; comparaison intermédiaire |
| **Raster forward terrestre + caches + volumes dédiés** | Coût de visibilité plus prévisible, géométrie fraîche, échelles indépendantes | **Choix recommandé**, sous réserve d'un premier prototype mesuré |
| Gros rendu différé d'emblée | Flexible pour beaucoup de lumières | Buffers, bande passante et complexité non justifiés au départ |
| Path tracing général, GI et reflets dynamiques partout | Richesse théorique | Hors du compromis M1 Max/WebGPU visé pour le vol courant |
| Porter immédiatement le moteur vers Metal natif | Accès à d'autres fonctions | Change la plateforme ; ne résout pas seul les représentations, les données et les défauts temporels |

Ce projet n'a pas besoin de cloner Nanite ou un moteur généraliste complet pour cette migration.

## 7. Performance, mémoire et limites de la promesse

Une cible de 60 images/s représente 16,7 ms entre images. L'ancien exemple de répartition à environ 14 ms GPU est **une enveloppe d'ingénierie indicative**, pas un résultat ni un contrat de performance. Il faut réserver présentation, irrégularités et travail hors passes ; temps CPU et GPU se recouvrent partiellement et ne s'additionnent pas naïvement.

La meilleure qualité demande une résolution interne suffisante. Mesurer image réellement terminée, p50/p95/p99, latence, chargement, chauffe et mémoire ; ne pas améliorer les statistiques en baissant secrètement la résolution, le détail ou la couverture nuageuse.

Budgets indépendants : terrain, forêt, bâtiments, ombres, eau, nuages, sondes et post-traitement. Inclure buffers temporaires, anciens buffers en retraite, données CPU, caches de tuiles, historiques, compilations et pics d'arrivée. Ne pas remplir le thread principal de préparation synchrone ni dépendre d'un readback GPU par frame pour sélectionner les tuiles.

La qualité globale dépend aussi des assets et de la calibration artistique. Des couronnes, toitures et matériaux soignés sont nécessaires ; les données actuelles ne deviennent pas des orthophotos ou du LiDAR par changement de pipeline. Certaines séquences pourraient approcher le langage visuel de la référence sans égaler toutes ses scènes ni son détail.

## 8. Risques à garder visibles

1. Relief raster/physique divergent, roues flottantes, nivellement des pistes différent.
2. Fissures, sauts de LOD et erreurs d'origine lors des longs déplacements ou du zoom.
3. Double brume, avion distant trop contrasté, occultation cockpit/nuage incorrecte.
4. Ghosting de végétation, de verrière et de nuages ; perte de détail dans les zones nouvellement visibles.
5. Canopée qui change de couleur ou d'épaisseur avec la distance ; ombres incohérentes.
6. Overdraw du feuillage et coût des ombres supérieurs au bénéfice de l'instanciation.
7. Coût des caches déplacé vers des à-coups CPU/GPU et des pics mémoire.
8. Régression de l'orbite, du télescope, du trou de ver ou du mode photo à cause d'une unification trop large.
9. Résultat techniquement propre mais visuellement pauvre faute d'assets, de lumière et de matériaux calibrés.

Le [plan](PLAN-PIPELINE-TERRE-AAA.md) transforme ces risques en jalons avec conditions de poursuite.

## 9. Références et lecture des preuves

### Code et archives du dépôt

- [renderer.ts](../src/renderer.ts) : `frame`, `dispatchTrace`, `encodePost`, `encodeTemporal`, `skyScale`, `dispatchEnv`, spécialisation `earthOnly`.
- [trace.wgsl](../src/shaders/trace.wgsl) : `trace`, `earthMarch`, `earthNormalAt`, `earthGround`, `earthLook`, `earthAir`, `wxCloud`, `cloudVolume`, `surfaceMaterial` et les chemins de sondes.
- [forest.ts](../src/system/forest.ts), [forest.wgsl](../src/shaders/forest.wgsl), [scenery.ts](../src/system/scenery.ts), [scenery-worker.ts](../src/system/scenery-worker.ts), [scenery-data.ts](../src/system/scenery-data.ts).
- [ship.wgsl](../src/shaders/ship.wgsl), [character.wgsl](../src/shaders/character.wgsl), [post.wgsl](../src/shaders/post.wgsl), [display.wgsl](../src/shaders/display.wgsl).
- [earth-tiles.ts](../src/system/earth-tiles.ts), [earth-surface.ts](../src/system/earth-surface.ts), [warp-grid.ts](../src/system/warp-grid.ts), [terrain.ts](../src/terrain.ts), [ellipsoid.ts](../src/system/ellipsoid.ts).
- [PLAN-RENDU-PERF.md](PLAN-RENDU-PERF.md), [PERFORMANCE.md](PERFORMANCE.md) : résultats historiques, matériels et protocoles propres à leurs campagnes.
- [ANALYSE-TERRE-PHOTOREALISTE.md](ANALYSE-TERRE-PHOTOREALISTE.md), [FORETS-BATIMENTS-WORLDWIDE.md](FORETS-BATIMENTS-WORLDWIDE.md) : contexte de conception ; certains états et budgets ont évolué depuis leur rédaction, le code de base fait référence.

Les noms de fonctions servent de repères stables ; les mesures archivées ne sont pas une validation nouvelle de cette proposition.

### Références techniques primaires consultées

- [Asirvatham / Hoppe, GPU-Based Geometry Clipmaps](https://developer.nvidia.com/gpugems/gpugems2/part-i-geometric-complexity/chapter-2-terrain-rendering-using-gpu-based-geometry) : grilles, transitions et mises à jour incrémentales ; les performances de cette publication ne sont pas transposées au jeu.
- [Apple, Harness Apple GPUs with Metal](https://developer.apple.com/videos/play/wwdc2020/10602/) : architecture par tuiles, surfaces cachées et coût des load/store ; ne constitue pas une exposition de toutes ces fonctions dans WebGPU.
- [Guerrilla, Nubis Evolved](https://www.guerrilla-games.com/read/nubis-evolved), [Nubis³](https://www.guerrilla-games.com/read/nubis-cubed) : nuages traversables, accélération et représentations ; pas de promesse de reproduire leur système ou leur coût.
- [NVIDIA Research, Scalar Spatiotemporal Blue Noise Masks](https://research.nvidia.com/publication/2021-12_scalar-spatiotemporal-blue-noise-masks) : distribution de l'erreur spatiale/temporelle et rendu volumétrique.
- [Epic, Impostor Baker](https://dev.epicgames.com/documentation/en-us/unreal-engine/impostor-baker-plugin-in-unreal-engine), [Temporal Super Resolution](https://dev.epicgames.com/documentation/unreal-engine/temporal-super-resolution-in-unreal-engine) : représentations distantes et contrats temporels ; aucune dépendance Unreal proposée.
- [Kaplanyan et al., Specular Anti-Aliasing](https://developer.download.nvidia.com/gameworks/events/GDC2016/akaplanyan_specular_aa.pdf) : filtrage des reflets et normales.
- [MSFS 2024, Using the SDK](https://docs.flightsimulator.com/msfs2024/html/1_Introduction/Using_The_SDK.htm), [Exterior Lights](https://docs.flightsimulator.com/msfs2024/retail/models-and-textures/modeling/aircraft/airframe/exterior-lights/) : PBR et calibration des émissions ; ces pages ne décrivent pas l'intégralité du pipeline MSFS.
