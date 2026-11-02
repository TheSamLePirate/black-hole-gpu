# Challenge de l’analyse Terre Unreal — photoréalisme AAA et performance

**Date : 2 novembre 2026.** Analyse contradictoire de [ANALYSE-TERRE-UNREAL-2026-11-02.md](ANALYSE-TERRE-UNREAL-2026-11-02.md), confrontée au code et aux références techniques primaires.

**Périmètre respecté : lecture statique uniquement. Aucun code modifié, aucun lancement de l’application, aucun test, aucun e2e, aucune mesure GPU nouvelle.** Ce document est le seul livrable ajouté par cette analyse. Les campagnes évoquées ci-dessous sont des critères proposés pour un travail ultérieur, pas des vérifications effectuées.

Référence de lecture : `HEAD c884ef2535f65b743f81b3a3a8a9e2c973c32915`, avec des modifications de travail déjà présentes, notamment dans `renderer.ts` et `trace.wgsl`. L’analyse porte sur les fichiers de travail lus, pas exclusivement sur le commit. Les noms de fonctions font foi ; les lignes indiquées sont des repères de cette lecture.

## 1. Verdict

**Le plan identifie correctement beaucoup de défauts du raster. Il ne constitue pas encore un plan crédible de livraison AAA à cadence maîtrisée.** Il mélange corrections, recherche, refonte de pipeline et enrichissement artistique, en leur attribuant des coûts et des risques trop homogènes.

Son principal mérite est de relier lumière, données, décor et image en mouvement. Son principal défaut est de présenter leur financement comme acquis : **les optimisations proposées ne démontrent ni le retour au budget annoncé, ni le coût des nouveaux effets une fois leurs dépendances intégrées.**

Je conserverais l’ambition et une grande partie des chantiers, mais je changerais cinq décisions structurantes :

1. **Avancer la reconstruction temporelle et son contrat de profondeur/identité**, avant les effets qui multiplieront scintillement et historiques.
2. **Avancer le filtrage matériel de l’imagerie T9/P11**, au lieu de repousser l’une des principales pistes identifiées dans le matériau dominant.
3. **Fixer un modèle physique d’atmosphère indépendant de la caméra.** C2, tel qu’écrit, doit être remplacé.
4. **Traiter les photos comme une source de couleur et de lumière mélangées**, avant d’augmenter systématiquement les ombres et le spéculaire.
5. **Définir les représentations selon la taille projetée et la distance**, avec des passages cohérents entre terrain, sursol, canopée, arbres et bâtiments.

Le critère AAA doit être : une scène crédible, stable pendant un déplacement et livrée dans son budget. Une liste de techniques présentes dans Unreal ne garantit aucun de ces trois résultats.

## 2. Ce qui est établi, ce qui ne l’est pas

Dans ce document :

- **[C]** : constat directement vérifié dans le code lu.
- **[A]** : chiffre ou observation provenant d’un document archivé, sans reproduction ici.
- **[D]** : déduction de cette lecture ; ce n’est pas une mesure visuelle ou GPU.
- **[R]** : recommandation ou hypothèse de conception.

### Constats du plan largement confirmés

| Sujet | Vérification | Conséquence |
|---|---|---|
| Sol terrestre raster | [C] `shadeLite`, vers 13542 : diffus `A / PI`, ciel modulé par l’orientation, rebond à 0,18 ; pas de lobe solaire GGX pour ce sol | Une réponse matérielle plus riche est justifiée |
| Bâtiments | [C] `shadeLite`, vers 13470 : toiture désaturée, mur beige et fenêtres procédurales ; `buildingLook` est appelé depuis `worldScenery`, pas depuis ce chemin | La perte de matériaux et de fenêtres émissives en raster est réelle |
| Gouverneur | [C] `main.ts:8507` force `want = rasterTop()` lorsque `rasterLiteActive` ; l’échelle mobile par défaut est 0,75 | Le diagnostic d’une adaptation bloquée pour ce chemin est fondé |
| Affûtage | [C] `display.wgsl:686–701` : Catmull-Rom dans la branche d’agrandissement, RCAS dans l’autre | Les deux branches ont des traitements différents |
| Reconstruction | [C] `post.wgsl temporal`, `taau` : reprojection géométrique et écrêtage ; pas de comparaison à une véritable profondeur de l’image précédente dans ces chemins | Désocclusions et changements de contenu restent insuffisamment caractérisés |
| Air | [C] `earth-air.ts`, `renderer.ts:3258`, `setAir` : facteur 3 ; `earthAir` : termes empiriques 0,8 et 0,3 | La cohérence physique mérite une refonte |
| Ombres du décor | [C] `liteSun` : fondu `550–750 m`, malgré la carte de ±900 m et les autres portées du chemin tracé | Le lointain raster perd effectivement ces ombres |
| Imagerie | [C] `earthImageryAniso` : plusieurs lectures manuelles, interpolation des valeurs encodées, puis décodage sRGB | T9 a une justification de qualité et de coût |
| Sursol existant | [C] `earth-tiles.ts drawnHeight`, `overground`, `ignGround` : le relief dessiné peut déjà inclure un sursol | Toute nouvelle canopée doit composer avec cette représentation |

Sources principales : [trace.wgsl](../src/shaders/trace.wgsl), [renderer.ts](../src/renderer.ts), [post.wgsl](../src/shaders/post.wgsl), [display.wgsl](../src/shaders/display.wgsl), [earth-tiles.ts](../src/system/earth-tiles.ts), [main.ts](../src/main.ts).

### Formulations du plan à corriger

**« Aucune occlusion ambiante » est trop absolu.** Le terrain et les bâtiments de `shadeLite` n’ont pas d’occlusion géométrique générale du ciel, mais les arbres ont déjà une atténuation analytique appelée `ao`. Le chemin tracé possède aussi `WS_AO` dans `buildingLook`. Cela ne remplace pas une occlusion correcte ; cela impose d’éviter d’empiler une seconde atténuation sans examiner la première.

**« Pas de tables d’atmosphère » doit être circonscrit.** Il manque les LUT de transmittance et de diffusion multiple proposées par C1. Il existe déjà une table de perspective aérienne et une représentation tabulée du ciel : SH à quatre altitudes et grille directionnelle 8 × 8, produites par `skyAmbient`. Cette dernière est déjà amortie, `SKY_EVERY = 3`. La migration doit les remplacer ou les réutiliser explicitement, pas ajouter un système parallèle.

**« Sous 2,5 px, plus d’arbres » masque une dépendance importante.** Dans `scenery-raster.ts cull`, `minPx = 2.5` est un seuil sur un **rayon projeté de sphère englobante**, pas une distance fixe, ni exactement le rayon de la couronne. La portée dépend de la hauteur de l’arbre, du FOV et de la résolution interne. Le « ~2,6 km » ne peut pas devenir un invariant architectural.

**Les aérodromes restent un point de parité à établir.** `airportScenery` est appelé dans le chemin `earthNear`, pas directement dans `shadeLite`. Cela étaye le risque d’objets absents lorsque le matériau prend le pixel ; cela ne prouve pas ici l’invisibilité de tous les objets dans toutes les configurations hybrides. Garder le statut d’hypothèse et détailler les types d’objets concernés.

**Les 41–47 ms ne sont pas une mesure du code du 2 novembre.** Le relevé U10 documente une situation du 25 octobre, à Paris bas, et mentionne lui-même des chevauchements dans les horodatages des passes raster. Le plan peut s’en servir pour orienter l’enquête, pas comme devis GPU actualisé. Source : [TERRE-UNREAL, U10](progress/raster-aaa/TERRE-UNREAL.md).

## 3. La promesse de performance ne ferme pas

### 3.1 Le compte du plan laisse un déficit majeur

Le plan part de **41–47 ms**, vise un budget de **18 ms**, et annonce **4–8 ms** récupérés par P1–P8.

Même en acceptant ces estimations, avant tout ajout de qualité, il resterait **33–43 ms**. Il manquerait donc encore **15–25 ms** pour atteindre 18 ms. C’est une déduction arithmétique des chiffres du plan, pas une prévision de la machine.

« Les gains paient l’essentiel des ajouts » peut signifier que l’image enrichie coûtera autant que l’image lente actuelle. Cela ne signifie pas que l’objectif de performance est atteint.

À distinguer dès l’en-tête du futur plan :

- le **budget de rendu GPU** réellement disponible ;
- la **cadence présentée** et sa régularité ;
- le **niveau de qualité** et la résolution de sortie auxquels ce contrat s’applique.

18 ms n’est pas un budget de rendu permettant à lui seul de garantir une présentation à 60 Hz. Un plafond à 25 i/s sur un écran à 50 Hz peut produire une cadence régulière, mais ce choix représente un profil dégradé à expliciter, avec son budget de 40 ms et sa latence. Ce n’est pas une résolution générale de la cible AAA.

### 3.2 La résolution dynamique ne réduit pas tout

[C] Les passes à résolution fixe comprennent notamment la carte d’ombre des nuages, les cartes d’ombre du décor, les données du terrain et une partie des sondes. Le culling de toutes les cellules de forêt ne devient pas quatre fois moins cher parce que la largeur de l’image est divisée par deux.

[D] Passer de 0,75 à 0,50 réduit les pixels rendus à environ **44 %** de leur nombre précédent. Cela ne divise pas le temps d’image total dans le même rapport. Un futur upscaler à la résolution de sortie ajoute en outre son propre coût et ses historiques.

[R] Décomposer le budget en coûts dépendant des pixels, des instances, des données renouvelées et de la résolution de sortie. Utiliser ce modèle pour choisir le levier du gouverneur. Une baisse d’échelle ne doit pas être son unique réponse à une surcharge de streaming ou d’ombres.

### 3.3 Les gains annoncés ne sont pas additionnables sans preuve

[C] `gpuprof.ts` somme les durées des passes étiquetées pour produire `frameMs`. U10 signale déjà que certaines durées raster se chevauchent. Une somme de passes n’est donc pas automatiquement la durée du chemin critique entre début et fin du travail utile.

[R] Pour les mesures futures, distinguer durée totale, horodatage par passe, coût CPU, attente GPU et présentation. Fixer également le mode de profilage : les timestamps eux-mêmes peuvent influer sur l’ordonnancement.

Les interactions sont concrètes :

- P1 et P2 réduisent une même passe de visibilité : leurs gains ne sont pas indépendants.
- P5 et P6 visent une partie commune de la circulation mémoire.
- F1 anime des arbres dont les ombres sont aujourd’hui conservées en cache : cela peut consommer une partie du gain de P4/S1.
- S1 augmente le nombre de casters et de lectures au moment où P1/P2 cherchent à les réduire.
- Un upscaler, GTAO et des volumes temporels réclament de nouvelles surfaces et des invalidations cohérentes.

**Décision proposée : supprimer toute formulation de financement acquis ; garder des hypothèses de gains, avec condition de conservation et mesure du coût total.**

### 3.4 Les postes dominants doivent guider l’ordre des expériences

Même dans le relevé archivé, le matériau terrestre à 13,5 ms pèse bien plus que la visibilité à 4,4 ms. Réduire de 60 % le seul travail de sommets ne réduit pas de 60 % toute cette passe : elle comprend aussi rastérisation, profondeur, écritures et décor. Ce serait encore moins une réduction de 60 % de l’image.

[R] Donner des priorités aux expériences qui peuvent distinguer coût d’imagerie, éclairage/ombres, pression de registres et circulation mémoire dans `shadeLite`. Avancer T9 pour cette raison. Les ~5,5 ms attribuées à l’ombre du vaisseau doivent également être isolées avant toute décision : U10 avertit précisément que cette attribution reste à mesurer correctement. Aucun gain sur ce poste ne peut être engagé à partir de son seul étiquetage.

## 4. Le premier chantier manquant : un contrat commun des surfaces

### 4.1 La visibilité actuelle n’est pas un G-buffer de surfaces exactes

[C] `TERRAIN_RASTER_FORMAT` vaut `rgba32float`. Ses quatre composantes ont déjà des rôles :

| Canal | Sens actuel |
|---|---|
| r | Distance du terrain ou de la géométrie solide du bâtiment |
| g | Identifiant de cellule d’arbre + 1 |
| b | Distance de la surface solide, ou du proxy d’arbre |
| a | Marqueur de niveau du terrain, de boîte, de pont, de bâtiment, et d’autres chemins de raster |

`proxyFs` écrit l’identifiant et la profondeur du **polyèdre englobant** l’arbre. `shadeLite` teste ensuite la forme analytique avec `sceneryTreeLite`. En cas d’échec, la recherche derrière ce proxy n’est activée que par un réglage de diagnostic dans ce chemin ; le proche peut être confié au noyau tracé.

Sources : [terrain-raster.ts](../src/system/terrain-raster.ts), [terrain-raster-hint.ts](../src/system/terrain-raster-hint.ts), [scenery-raster.ts](../src/system/scenery-raster.ts), `sceneryTreeLite` vers 9168 et `rasterLiteTakes` vers 13030 dans [trace.wgsl](../src/shaders/trace.wgsl).

[D] Un GTAO directement calculé sur b produirait de l’occlusion autour du proxy, y compris là où le matériau affiche du terrain. Un effet calculé seulement sur r ignorerait le volume des arbres. La profondeur dite « exacte du raster » dans L2 doit donc être définie avant de promettre le résultat.

Il en va de même pour le contact solaire, le Hi-Z, le brouillard, la désocclusion et les normales reconstruites. Tous n’ont pas besoin de la même profondeur, mais tous doivent savoir laquelle ils lisent.

### 4.2 P5 ne peut pas être un simple changement de format

Sur le terrain nu, r et b sont redondants. Devant un arbre, ils ne le sont plus : r sert de repli derrière le proxy. Compacter en deux mots de 32 bits implique de décider où vivent cette seconde profondeur, le type, le niveau, l’identité et la normale.

Le plan doit décrire au minimum :

1. La profondeur opaque finale utilisée pour l’image et la reprojection.
2. La profondeur de terrain conservée si les proxies en ont encore besoin.
3. L’identité de primitive et le type de matériau.
4. La normale géométrique et la normale d’ombrage, avec leur espace de coordonnées.
5. Les informations nécessaires au relèvement réfractif R4b.
6. La validité temporelle : changement de tuile, de LOD, d’objet ou de météo.

[R] Évaluer deux solutions avant de choisir : conserver un hint spécialisé pour le chemin hybride, ou produire un tampon de surfaces finalisé dont les consommateurs partagent le contrat. Une architecture mixte reste possible ; il faut rendre son coût et ses responsabilités explicites.

**Le gain « bande passante ÷2 » de P5 ne vaut que pour la cible compactée**, pas pour l’ensemble du pipeline. Ajouter ensuite normales, vélocités et profondeur précédente change le bilan.

### 4.3 B1 nécessite aussi de modifier le conditionnement des maillages

[C] `packScenery` concatène actuellement les sommets et indices des maillages. `meshVertex(vi)` récupère une position, et `meshFs` ne reçoit pas l’identité du bâtiment. Le fichier ne contient pas à cet endroit une association explicite triangle → enregistrement de matériau utilisable telle quelle par le fragment.

Le canal g est à zéro pour un bâtiment, mais l’identifiant à y écrire n’arrive pas magiquement au shader. B1 doit prévoir une table triangle → primitive, des plages de dessin par bâtiment, ou un attribut adapté. Le résultat devra aussi permettre de reconstruire l’orientation et la coordonnée de façade que `buildingLook` attend dans `SceneryHit.aux`.

[D] « Une lecture par pixel » ne couvre ni ces données, ni la reconstruction des baies, ni les lectures des paramètres du bâtiment, ni les effets sur le compilateur. **B1 reste prioritaire, mais son risque passe de faible à moyen.**

### 4.4 Le choix `rg16snorm` de T5 exige une vérification de capacité

La spécification WebGPU consultée place `rg16snorm` sous la fonctionnalité `texture-formats-tier1`. Le code de création du device demande actuellement les timestamps et compressions disponibles, sans cette fonctionnalité ni `shader-f16`. La disponibilité de l’adaptateur ne suffit pas : la fonctionnalité optionnelle doit être demandée sur le device. Source : [WebGPU, formats](https://www.w3.org/TR/webgpu/#texture-format-caps).

[R] Prévoir un format de repli, par exemple un encodage dans un format de base adapté, et documenter l’erreur angulaire acceptée. P10 doit de même inclure détection, demande de fonctionnalité, variantes WGSL et repli. Aucun de ces deux changements n’est validé sur les navigateurs cibles par cette analyse.

## 5. La netteté temporelle doit précéder l’enrichissement du matériau

### 5.1 I2 est un chantier de fondation, pas de finition

Le plan place le spéculaire, les ombres de contact, le vent et une nouvelle canopée avant la reconstruction temporelle. Ces effets créent précisément les signaux difficiles à reconstruire : détails sous-pixel, silhouettes animées, lueurs spéculaires et ombres changeantes.

[C] Le TAAU actuel s’ajoute à une passe temporelle native et utilise son résultat pour borner l’historique haute résolution. Son commentaire indique un coût historique de 2–3 ms supplémentaires et un résultat insuffisant dans certaines rotations. Source : `renderer.ts:6089`, `post.wgsl taau`.

[D] Réactiver ce TAAU, ajouter du jitter et une profondeur précédente ne suffit pas à obtenir un TSR. Il faut examiner le nombre de filtrages successifs, le poids réel des échantillons, la précision des mouvements et les changements de résolution.

Epic décrit des mécanismes distincts pour l’historique, les désocclusions, les changements d’ombrage et le scintillement. Sa documentation souligne aussi que le résultat dépend du débit d’échantillons, pas seulement du taux d’agrandissement. Source : [Temporal Super Resolution](https://dev.epicgames.com/documentation/unreal-engine/temporal-super-resolution-in-unreal-engine).

### 5.2 La promesse « 0,5 net comme du natif » doit disparaître

À 0,5 par axe, une image apporte un quart des pixels de sortie. À 25 i/s, quatre images représentent environ 160 ms. À 0,6, atteindre une densité moyenne d’un échantillon par pixel de sortie demande encore environ 111 ms. Ce sont des bornes de débit simplifiées, déduites de `1 / (échelle² × cadence)` ; elles ne garantissent aucune convergence après désocclusion.

[D] Une façade nouvellement découverte ou une route qui grossit rapidement n’offre pas cet historique stable. En vol bas, la netteté du premier instant et la stabilité des lignes minces doivent donc être évaluées séparément de l’image après accumulation.

[R] Remplacer la promesse par : « chercher le meilleur compromis démontré entre résolution interne, cadence, latence et netteté en déplacement ». Commencer avec une échelle prudente, puis abaisser le plancher uniquement si les scènes critiques le permettent.

### 5.3 Les mouvements d’objets ne sont pas une simple texture rg16f

Pour le terrain statique dans son repère terrestre, une reprojection analytique peut rester précise. Pour les objets mobiles, il faut les transformations précédentes ; pour le vent, la déformation précédente ; pour l’eau, le mouvement de sa surface ne prédit pas toujours celui de ses reflets.

La même pixel peut contenir de l’air, un nuage semi-transparent et une surface : une vélocité unique ne décrit pas les trois. Les glints et l’émission changeante nécessitent aussi un poids d’historique adapté. Source primaire complémentaire : [Epic, temporal upscalers](https://dev.epicgames.com/documentation/unreal-engine/temporal-upscalers-in-unreal-engine).

[R] Spécifier séparément reprojection opaque, données précédentes des objets et masques réactifs/confiance des signaux qui changent sans mouvement géométrique prévisible. Traiter les clouds avec leur historique propre. **I3 passe de risque faible à moyen/élevé selon le périmètre réellement couvert.**

### 5.4 I1 est utile, mais ne coûte pas automatiquement zéro

[C] `rcasDelta` lit le centre et quatre voisins de la texture source. Catmull-Rom reconstruit depuis neuf lectures filtrées. Ajouter le delta du texel source à la couleur agrandie n’équivaut pas à appliquer RCAS au signal reconstruit à la résolution de sortie.

[R] Choisir un affûtage intégré à la reconstruction, ou une passe de sortie explicite. Budgéter les lectures et le signal HDR utilisé. La netteté doit rester stable quand l’échelle varie, sans halo sur les crêtes, les fenêtres ni les marquages. Le risque est limité, mais ni nul ni indépendant de l’aliasing initial.

### 5.5 Le gouverneur doit préserver l’image et l’identité du monde

[C] Le code a figé l’échelle du raster pour éviter des impulsions de flou lors du redimensionnement des historiques. Enlever cette condition sans traiter la migration des historiques réintroduirait un problème connu.

[R] I4 doit comprendre hystérésis, temps minimal par palier, adaptation des historiques, et priorité aux réductions dont le gain a été établi. Les seuils des arbres doivent dépendre d’un contrat de qualité de sortie stable : sinon la baisse de résolution supprime du décor, puis sa remontée le recrée. Ce n’est plus seulement une baisse de netteté.

## 6. L’éclairage doit commencer par la séparation matière/lumière

### 6.1 Le Lambert n’est pas, à lui seul, le problème principal

Un diffus simple reste une approximation acceptable de nombreux matériaux rugueux lointains. Le défaut déterminant est le mélange entre photo déjà éclairée, éclairage dynamique approximatif, ciel non occulté et matériaux insuffisamment identifiés.

Ajouter une BRDF plus sophistiquée à cette entrée peut rendre les incohérences plus visibles. Une ombre cuite dans la photo demeure noire même quand le Soleil simulé vient de l’autre côté. Un reflet brillant sur une zone identifiée à tort comme métal paraît plus faux qu’une zone mate.

[R] Conserver le Lambert comme repli lointain. Réserver la complexité aux surfaces dont la sémantique et la taille projetée la justifient.

### 6.2 L4 confond classe d’occupation du sol et matériau

WorldCover fournit onze classes d’occupation du sol à 10 m ; la classe bâtie ne distingue pas une vitre, une toiture de zinc et une route. Source : [ESA WorldCover](https://esa-worldcover.org/en/about/about).

[C] Le projet possède une meilleure sémantique locale : matériaux/couleurs de bâtiments dans les enregistrements de décor, réseaux routiers, classes de couvert et pistes. Il faut l’exposer au raster plutôt que demander à la couleur satellite de résoudre tous les matériaux.

[R] Hiérarchie proposée : bâtiment connu → matériau du bâtiment ; route connue → matériau de chaussée ; piste → matériau de piste ; couvert naturel → modèle par classe ; inconnu → rugueux et peu spéculaire. Les données manquantes doivent porter une confiance explicite. **Éviter d’inférer du zinc parce qu’un pixel est gris.**

### 6.3 GGX doit venir avec son filtrage

L4 annonce un coût de quelques dizaines d’ALU. Le coût réel comprend l’accès au matériau, les normales, le ciel réfléchi et le traitement des hautes fréquences.

[C] `skyMirror` est une grille 8 × 8 de radiance au niveau de la mer. Elle n’est ni un environnement local complet ni une convolution pour toutes les rugosités. Un simple lookup de la direction réfléchie ne donne pas une réflexion GGX rugueuse correcte ; il ne représente pas non plus les bâtiments qui cachent le ciel.

[R] Définir conservation d’énergie diffuse/spéculaire, rugosité minimale effective, filtrage des normales et environnement préfiltré ou approximation documentée. Représenter la taille finie du Soleil ou une rugosité suffisante évitera les points spéculaires instables. Pour les conducteurs, prévoir une réponse différente des diélectriques ; pour le mouillé, un revêtement et une variation spatiale, pas un F0 arbitraire par couleur.

Ces besoins sont distincts dans la documentation de référence de [Filament : BRDF, éclairage d’environnement et antialiasing](https://google.github.io/filament/main/filament.html). Ils doivent figurer dans le devis de L4.

### 6.4 L1 est un bon gain, à intégrer sans double facteur

`skyIrradiance(h, n)` fournit déjà une irradiance convoluée par le cosinus. Après son évaluation avec la normale réelle, il ne faut pas multiplier encore ce résultat par `0.5 × (1 + up)` : on atténuerait deux fois l’orientation.

[R] Séparer ciel directionnel, sol vu dans l’hémisphère inférieur et occlusion. Conserver le transport en fonction du lieu/altitude/éclipse de `skyFlat`. Examiner le cas d’une normale tournée sous l’horizon, puisque les SH proviennent d’un ciel échantillonné et tronqué, pas d’une sonde locale de GI complète.

L1 peut avancer rapidement après la définition des normales. Son coût « ~20 ALU » reste cependant incomplet : le code évalue neuf coefficients, interpolés entre deux altitudes, avec lectures du buffer.

### 6.5 L6 ne doit pas remplacer `Esun` par une ombre ponctuelle

Le problème du rebond sous les nuages est réel. Mais le rebond d’un mur vient d’une étendue du terrain autour de lui. L’ombre au point du mur n’est pas nécessairement celle du sol qui l’éclaire. Son albédo local n’est pas forcément celui de la zone de rebond.

[R] Employer une moyenne spatiale grossière de lumière incidente et d’albédo du sol, au moins à une échelle définie. Préserver l’énergie et préciser l’erreur acceptée. Si l’on garde un rebond empirique, le nommer ainsi. Une simple atténuation améliore certains cas, sans devenir une GI physique gratuite.

### 6.6 L5 : Ross-Li et RPV ne sont pas interchangeables

Les modèles satellitaires de BRDF demandent des coefficients liés à la surface et aux conditions d’observation. Les produits MODIS distinguent les paramètres BRDF, l’albédo et la réflectance ajustée au nadir : ces quantités ne sont pas équivalentes. Source : [NASA, produits BRDF/albédo MODIS](https://modis.gsfc.nasa.gov/data/dataprod/mod43.php).

[R] Ne pas accepter « normalisé à 1 au nadir » comme garantie d’énergie ni de point chaud réaliste. Définir le modèle choisi, ses paramètres, son comportement aux angles rasants et son raccord au diffus déjà dans la photo. Séparer le modèle statistique de canopée lointaine des feuilles et couronnes proches.

L5 est intéressant pour le vol, mais devrait commencer comme étude bornée, avec un matériau de référence et une transition d’échelle. Le risque n’est pas seulement quelques ALU.

## 7. Le dé-éclairage L7 est trop tardif pour le rôle qu’on lui attribue

### 7.1 Une mosaïque RGB ne permet pas une inversion complète

[C] L’imagerie courante arrive via des tuiles et des services nationaux, avec une correction globale `OrthoFit`. Ce ne sont pas des enregistrements contenant systématiquement heure, géométrie de prise de vue, exposition et BRDF par pixel. La mosaïque WorldCover/Sentinel n’est pas une scène acquise à un unique instant.

[D] Supposer « Sentinel ≈ 10 h 30 » ne permet pas de retrouver toutes les ombres de la mosaïque. La division par un cosinus de pente ne reconstruit pas un objet dans l’ombre, sa couleur occultée, ni une façade cachée. Elle peut amplifier bruit et raccords.

[R] Distinguer :

- correction topographique douce à grande échelle ;
- normalisation radiométrique entre sources ;
- détection des ombres avec estimation de confiance ;
- reconstruction de leur contenu, qui reste une inférence ;
- acquisition future de réflectances mieux caractérisées quand elles existent.

**L7 n’est pas une opération de décodage générique à considérer comme résolue en CPU.** Elle affecte aussi latence, cache, mémoire et consommation au chargement.

### 7.2 Une politique de ré-éclairage est nécessaire immédiatement

Reporter toute la question après Q4 est contradictoire avec l’ajout, en Q2/Q3, de nouvelles ombres et de nouveaux reflets sur les mêmes photos.

[R] Avancer une version prudente : séparer couleur basse fréquence et détail photographique ; limiter la correction là où elle est incertaine ; utiliser les matériaux sémantiques pour les bâtiments/routes proches ; conserver des réglages de confiance par source. Étudier le vrai dé-éclairage hors ligne sur un petit nombre de zones avant de le généraliser.

La conservation de la « lumière de la photo » proposée pour les toits B1 est notamment à arbitrer : elle aide à garder du détail, mais maintient précisément le mélange que le modèle PBR cherche à supprimer.

### 7.3 Le détail proche L8 est sous-priorisé

Au roulage et à pied, aucune AO ne transforme une ortho grossie en herbe, gravier ou roche crédibles. Le plan met les matériaux de détail tard alors qu’ils conditionnent directement l’objectif de proximité.

[C] `surfaceMaterial` est un bruit multiplicatif, activé par le mode `materials` de pages régionales ; il n’offre pas un système global de matériaux avec normales et rugosité.

[R] Pour le périmètre proche, avancer un ensemble limité de détails physiques, à taille métrique, filtrés, dont la moyenne conserve la couleur de la photo. Définir leurs mips et leur apparition selon l’empreinte du pixel. Le triplanaire et le tuilage stochastique multiplient potentiellement les lectures : « deux textures » n’est pas un coût GPU.

## 8. Occlusion et ombres : raisonner par phénomène et par échelle

### 8.1 L2 : le ciel d’une vallée ne se résume pas à un AO global

L’idée de deux échelles est bonne. Mais une carte d’horizon lointain n’intègre pas les murs voisins, tandis qu’un GTAO ne voit pas la montagne hors écran. Les deux doivent se compléter sans compter deux fois les mêmes reliefs.

[C] H5 est actuellement une option du plan commun, dans la direction du Soleil et ses voisins, sur les niveaux 4–6 du cache. Ce n’est pas encore une occlusion du ciel proche à huit directions.

[R] Définir les distances de séparation. Pour un ciel isotrope, des horizons peuvent donner une visibilité hémisphérique approximative. Pour le ciel directionnel de L1, il faut pondérer les directions réellement visibles ; un simple scalaire perd la direction et la couleur du ciel. Une direction moyenne visible ou quelques coefficients peuvent offrir un compromis, à chiffrer.

Étendre H5 implique aussi coût de cuisson, stockage, interpolation, renouvellement des niveaux, et comportement aux frontières. « 1–2 lectures » ne représente pas la totalité du calcul à huit directions.

### 8.2 GTAO et contact solaire exigent épaisseur et validité

[R] Spécifier normale, profondeur finale, épaisseur des surfaces, rayon en mètres, reconstruction, filtrage et désocclusion. Les pieds de mur ne doivent pas recevoir une auréole sombre ; les branches ne doivent pas être traitées comme des murs pleins. Le cockpit et les bords de terrain nécessitent un traitement explicite.

L3 reste un complément local : un rayon en écran ne découvre ni le caster hors champ ni celui caché par une autre surface. Le repli doit être visible dans le contrat, et le risque « faible » est à relever.

### 8.3 S1 : cascades d’abord ; cartes virtuelles hors engagement initial

Deux ou trois cascades stables sont une piste raisonnable. Une carte virtuelle paginée constitue un autre chantier : allocation, invalidation, demande de pages, filtrage, résidence et comportement aux limites WebGPU.

[R] Ne pas placer ces deux architectures comme alternatives de même effort. Commencer par des cascades bornées, avec grille stabilisée, choix des casters, biais selon pente/LOD et transition conservant l’énergie moyenne.

Ne pas réutiliser le frustum de la caméra pour le culling des casters : un bâtiment hors écran peut ombrer une surface visible. Le volume utile dépend du Soleil et des récepteurs. Au couchant, il devient long et amplifie les coûts et erreurs de bornes.

**Un seuil actuel manque au diagnostic initial.** [C] `treeShadowFrame` retourne une carte inactive lorsque le Soleil local vérifie `L[2] < 0.03`, soit environ 1,72° d’élévation. Dans `liteSun`, des lectures hors carte ne déclenchent pas une marche de repli du décor : elles laissent ce terme éclairé. Le problème du couchant n’est donc pas seulement la portée de 750 m ; il faut également traiter cette limite et son raccord. Étendre la distance des cascades sans revoir cette activation laisserait disparaître les ombres dans une situation visuelle centrale du plan.

### 8.4 Le cache d’ombres dépend de plus que la caméra et le Soleil

[C] La carte des arbres/bâtiments est conservée selon son repère et la révision du décor (`renderer.ts`, vers 8766). La carte de terrain est redessinée actuellement et ne dessine que le patch central dans `TerrainRaster.encodeSunShadow`.

[R] P4 doit intégrer les changements de hauteurs, géomorphose/LOD, nouvelles tuiles, couverture de la fenêtre et paramètres de réfraction d’éclairage. F1 implique soit des ombres dynamiques proches, soit une approximation explicitement stable au loin. Il faut gérer séparément casters statiques et animés.

**Mettre en cache l’actuelle carte de terrain incomplète ne prouve pas le gain de la future carte corrigée par T6.** Le cache doit être conçu sur cette dernière représentation.

## 9. Forêts : F2 est une transition de représentation, F4 change des invariants

### 9.1 La canopée ne peut pas être seulement une nouvelle couche sur le relief

[C] Les tuiles IGN disposent déjà d’un sursol ajouté à la hauteur dessinée, tandis que les contacts CPU utilisent le terrain nu. `overground` conserve des sommets dans des blocs de données.

[D] Ajouter une hauteur de canopée peut doubler ce sursol ou créer des bosses incompatibles avec les arbres de premier plan. Une canopée simplement ombrée au-dessus d’une photo contenant les ombres de forêt peut aussi trop assombrir le lointain.

[R] Écrire une chaîne explicite : terrain nu → couvert statistique lointain/sursol → canopée intermédiaire → arbres individuels. Indiquer quel composant fournit silhouette, couleur, ombre, occlusion et collision à chaque distance.

Le passage doit préserver densité apparente, hauteur des lisières et lumière moyenne. Une substitution progressive évitera l’épaississement temporaire si l’on dessine deux représentations ensemble. Les falaises, les routes et les clairières doivent rester découpées ; le proche reste attaché au terrain WGS84, la mer au géoïde.

### 9.2 F4 n’est pas un changement gratuit de paramètres

[C] La hauteur est codée sur six bits dans `packCell`, de 2 à 33,5 m par pas de 0,5 m. La couronne est liée à une cellule de 7 m et aux facteurs de forme de l’espèce. La traversée repose sur des candidats dans les cellules voisines et sur des bornes par blocs.

[D] Augmenter la largeur des chênes ou pins au-delà de l’hypothèse de portée de la grille risque de faire manquer un arbre par la traversée ou ses bornes. Augmenter la hauteur maximale impose un nouvel encodage, un changement de précision, ou une donnée complémentaire. Le CPU, le shader des proxies, les ombres et les contacts doivent partager cette définition.

[R] Traiter F4 comme évolution du format de forêt, avec bornes conservatrices et stratégie de voisinage explicites. Il existe déjà des largeurs différentes par espèce ; le défaut est leur amplitude et leur dépendance à la cellule, pas leur absence totale.

Sources : [forest.ts](../src/system/forest.ts), [forest.wgsl](../src/shaders/forest.wgsl), `treeOf` dans [scenery-raster.ts](../src/system/scenery-raster.ts).

### 9.3 Le vent n’est pas le meilleur investissement à toutes les altitudes

Le vent proche est utile. Vu à plusieurs kilomètres, son effet peut être inférieur au pixel ; sa mise à jour d’ombres et de vélocités peut coûter davantage que son bénéfice.

[R] Déformer surtout le proche, avec amplitude bornée dans le culling, état précédent pour l’historique et transitions selon taille projetée. Préserver la logique de collision choisie : les branches peuvent bouger visuellement sans imposer une simulation de toutes les collisions de feuilles, mais ce choix doit être assumé. La simple égalité d’une sinusoïde CPU/GPU n’épuise pas le problème.

### 9.4 Les imposteurs F3 ont un coût de signal et de contenu

Les proxies sont une optimisation de visibilité ; un imposteur devient une représentation d’apparence. Il faut alors gérer angle de vue, profondeur, saison, soleil, transmission, ombre, mips et passages aux arbres analytiques.

[R] Étudier F3 après avoir fixé le passage à la canopée. Éviter une nouvelle représentation intermédiaire si une canopée bien conçue couvre déjà son bénéfice. Le budget inclut les textures et leur fabrication, pas seulement la passe de dessin.

## 10. Atmosphère : accepter C1, remplacer C2, mieux cadrer C4/C9

### 10.1 C2 change le monde avec l’observateur

La proposition `AIR_K = 1` près du sol et `3` au-dessus rend le même trajet lumineux dépendant de l’altitude de la caméra. Le Soleil reçu par une montagne, les nuages et le sol changerait quand l’observateur monte, même si leur état physique est inchangé.

[C] Le facteur est utilisé à la fois dans la transmission CPU et dans les paramètres de l’air GPU. Les hauteurs d’échelle et les densités changent ensemble. Leur produit conserve approximativement la colonne verticale au sol, mais pas la distribution verticale ni les trajets rasants.

**L’erreur ne se décrit donc pas par « tout est trois fois plus opaque ».** Les écarts dépendent de l’altitude et de l’angle. Les compensations actuelles dans l’exposition ne suffisent pas à caractériser ce qu’un passage à 1 changera.

[R] Adopter une atmosphère physique unique. S’il faut plusieurs méthodes pour le sol, l’avion et l’orbite, faire varier les méthodes d’intégration, la précision et les tables, avec des sorties raccordées pour le même air. Un réglage artistique de limbe peut être distinct et explicitement nommé ; il ne doit pas modifier l’éclairage physique global selon l’observateur.

La densité utilisée pour la réfraction et celle utilisée pour la diffusion doivent être cohérentes dans leur géométrie et leurs conditions. Cela ne signifie pas que Rayleigh, ozone et aérosols doivent partager un profil identique : ce sont des constituants différents. USSA-76 ne fournit pas à elle seule une météo d’aérosols ni une distribution d’ozone.

### 10.2 C1 est une bonne direction, mais pas un remplacement de 0,05 ms garanti

L’implémentation de référence de Hillaire sépare des tables et des intégrations de visibilité/éclairage ; elle utilise des textures filtrées. Le projet dispose déjà de froxels de perspective aérienne et d’une table de ciel. Sources : [dépôt de référence Hillaire](https://github.com/sebh/UnrealEngineSkyAtmosphere), [shader de référence](https://github.com/sebh/UnrealEngineSkyAtmosphere/blob/master/Resources/RenderSkyRayMarching.hlsl).

[R] Migrer par étapes : transmittance, diffusion multiple, ciel, puis intégration avec la perspective aérienne et les consommateurs existants. Définir ce qui reste dynamique : météo locale, éclipses, Soleil/Lune, ombres et orbite.

Stocker les LUT dans `bodies` évite une liaison de texture supplémentaire, mais impose une interpolation manuelle et peut augmenter les lectures de buffer. Ce n’est pas automatiquement plus rapide que des textures. Les mises à jour d’une table globale et d’une table dépendant de la caméra ne suivent pas la même cadence.

Le coût de C1 doit distinguer cuisson initiale, cuisson lors d’un changement d’atmosphère, mise à jour de vue et lecture pendant les autres passes. Le remplacement exige aussi la cohérence de l’éclairage incident CPU et des sondes du vaisseau.

### 10.3 C4 réemploie une fonction de surface là où il faut une visibilité volumique

[C] `sunShadowFar` utilise une portée d’exclusion des occluders proches (`SUN_NEAR_M`, actuellement 300 m), et peut l’adapter avec une normale de surface `SUN_N`. Ce contrat répond au partage carte/marche du terrain.

[D] Lu tel quel depuis un froxel, il peut ignorer un obstacle proche qui doit pourtant bloquer le Soleil dans l’air. Le volume n’a pas la normale de pente d’un récepteur de sol.

[R] Exposer une lecture d’occlusion pour les volumes, avec biais et portée propres. Moduler la diffusion solaire simple par cette visibilité ; conserver une composante diffuse raisonnable dans l’ombre. Budgéter les lectures sur les froxels réellement utiles, leur jitter et leur historique. La carte du relief ne suffit pas à rendre gratuitement les rayons de montagne.

### 10.4 C9 ne doit pas confondre ombre solaire et occlusion du ciel

Une carte d’ombre solaire contient une transmittance dans une direction. L’irradiance diffuse vient d’un hémisphère. Un cumulus peut cacher le Soleil et laisser beaucoup de ciel visible ; un ciel couvert peut supprimer le Soleil tout en éclairant le sol par diffusion.

[C] `shadeLite` a déjà une recomposition du ciel sous les couches météo via `wxVeil`. Ajouter une atténuation issue de la carte des nuages sans établir les responsabilités peut compter deux fois l’atténuation.

[R] Séparer transmission directe, lumière diffuse des nuages et visibilité du ciel. La carte solaire peut aider une approximation, à condition de ne pas servir de facteur unique sur le SH. C9 passe de « ~0, faible » à une correction à définir physiquement et à raccorder aux termes existants.

## 11. Nuages et météo : cohérence spatiale avant promesse de réalité

### 11.1 C5 ne permet pas de promettre les vrais cumulus

[C] `dayCloudsFor` utilise la mosaïque de la veille pour aujourd’hui. Le fichier décrit une acquisition diurne par bandes et une couverture estimée à partir de la couleur, avec repli dans les trous et la nuit polaire. La carte de travail globale est demandée en 4096 × 2048, soit une maille de l’ordre de 10 km en longitude à l’équateur.

[C] `openmeteo.ts` échantillonne actuellement des cellules de 0,25° et interpole des états horaires. Une grille multipoint améliorerait la variation spatiale de cet état, mais ne révélerait pas la position instantanée de chaque nuage. L’API fournit des champs de modèles, avec des couvertures de couches ; ce n’est pas un radar volumique. Source : [Open-Meteo, API météo](https://open-meteo.com/en/docs).

[R] Renommer C5 « météo spatialement cohérente, contrainte par des observations disponibles ». Distinguer observation et synthèse, temps valide et temps d’acquisition, résolution et confiance. Prévoir altitude des couches, vent, advection et raccord entre régions. La précision à ±250 km ne peut pas être décrite par le nombre de requêtes seul.

Une mosaïque quotidienne vieillie et un champ horaire courant ne doivent pas être fusionnés comme s’ils représentaient le même instant. Plus de données, mal alignées, peut diminuer la crédibilité.

### 11.2 C6 sous-estime la représentation de l’ombre à l’intérieur des nuages

[C] La carte actuelle stocke une profondeur avant, une extinction moyenne et une profondeur optique totale ; `csmTexelT` reconstitue une transmission avec cette moyenne. Cela ne représente pas toute la répartition des vides et de plusieurs couches dans la colonne solaire.

[D] Une lecture de cette carte peut être utile pour l’ombre lointaine ou d’une autre couche, mais ne remplace pas une marche locale précise dans tous les cumulus. Ajouter du jitter aux mêmes 40 pas améliore certains biais après accumulation, sans garantir qu’une structure fine n’est plus manquée.

[R] Séparer auto-ombrage proche et champ d’ombre plus large ; intégrer les bandes d’altitude actives et les volumes vides ; étudier les besoins réels de profondeur de la carte avant de la complexifier. Garantir que densité, extinction et déplacement sont communs entre volume visible et ombre.

### 11.3 P8 dépend d’une reprojection qui n’existe pas partout

La passe de nuages a un historique. La table aérienne est aujourd’hui recalculée depuis la caméra. Conserver cette table deux à quatre images nécessite une reprojection volumique ou une stratégie équivalente, avec les anciens repères, distances et états d’éclairage. Garder simplement l’ancienne texture ne conserve pas le même trajet lumineux lors d’un virage.

[R] Adapter la fréquence à une erreur d’image estimée : rotation/translation, déplacement du nuage, déplacement d’ombre, éclair ou changement de météo. Renouveler immédiatement les zones invalides et les premières images. Les durées doivent être définies en temps et en erreur projetée, pas seulement en nombre d’images.

Le damier réduit le calcul neuf, mais exige reconstruction et gestion des désocclusions. L’ajout simultané d’historiques nuages, air, AO, ombres et image finale appelle un contrat commun d’invalidation : sinon chaque étage accumule les erreurs du précédent.

### 11.4 Compositing : une distance de nuage ne suffit pas à toutes les couches

[C] `earthClouds` fusionne les couches en conservant la distance de la plus proche. `liteFinish` utilise la distance et la radiance agrégées pour la composition avec l’air.

[D] Une couche éloignée ne devrait pas subir la même perspective aérienne qu’une couche proche. La correction devient particulièrement visible entre plusieurs couches et au couchant.

[R] Étudier une intégration par segments ou un petit nombre de couches ordonnées, avec radiance prémultipliée et transmittance. Ce problème de composition mérite une priorité plus haute que le halo de 22°.

### 11.5 C7/C10 : séparer correction indispensable et effet spécialisé

Lier les cirrus à la météo et raccorder le passage au volume/plan sont des corrections prioritaires. Un halo de 22° demande un modèle de phase de cristaux distinct ; sa seule présence ne rend pas les cirrus plus physiques.

La fin du plancher de transmittance doit conserver l’extinction restante, y compris pour le disque solaire et lunaire, mais aussi corriger la reconstruction aux frontières en demi-résolution. Un rayon central opaque ne suffit pas à classifier toute la couverture sous-pixel de ce texel.

## 12. Nuit, saisons, caméra : trois niveaux de priorité différents

### 12.1 La nuit doit être recalibrée avant d’ajouter beaucoup de lampes

[C] `renderer.ts:3165` applique un gain des villes dépendant de l’altitude ; `P.earth4.x` modifie aussi le plancher nocturne selon l’altitude. `EARTH_NIGHT` et `EARTH_MOON` sont volontairement élevés ; la lumière de Lune utilise une puissance de la fraction de disque éclairée.

Le défaut identifié par L10 est réel. Mais un ratio fixe de 50–100 entre deux nuits ne décrit pas toutes les conditions : hauteur de Lune, phase, transparence, pollution lumineuse et nuages interviennent.

[R] Fixer les unités relatives de radiance/irradiance, la pré-exposition, la réponse de la Lune, les émissions et le plancher choisi. Les lumières de ville ne doivent pas devenir plus émissives parce que la caméra monte. Le transport, la taille projetée et la réponse caméra doivent expliquer leur apparence différente.

Ensuite seulement : distribuer des lumières plausibles le long des routes, sans supposer qu’un fichier de routes décrit les lampadaires réels. Prévoir leur regroupement, portée et LOD ; une fenêtre émissive qui brille ne signifie pas que la rue reçoit son éclairage. Éviter tout ajout d’une lumière dynamique par fenêtre.

### 12.2 Saisons et neige : conserver une cohérence d’ensemble

La neige pilotée uniquement par altitude, pente et date peut contredire la météo et la région. Un produit satellite de neige ne fournit pas automatiquement épaisseur, état du sol ou observations sous les nuages.

[R] Commencer par un modèle cohérent sol–arbres–toits–pistes, avec masque de neige et vieillissement contrôlés, puis ajouter des observations avec qualité et trous connus. Une teinte automnale ne remplace pas le changement des cultures ou de couverture. Le NIR peut aider, mais le NDVI exige une bande rouge et NIR correctement calibrées et compatibles, pas un canal reconstruit depuis un RGB d’affichage.

### 12.3 Exposition locale et optique doivent rester des choix d’image

L’exposition locale peut aider le cockpit et le paysage, mais une correction spatiale forte produit des halos et réduit le contraste physique. Une grille calculée sur le bloom, dont la source privilégie les hautes lumières, ne constitue pas automatiquement un signal de luminance locale adapté. Les poids, le filtrage et la stabilité temporelle doivent être définis.

[R] Garder une exposition globale maîtrisée comme référence, puis limiter l’amplitude et les temps d’adaptation de la correction locale. Vérifier ciel clair/éclipse/nuit avec les mêmes conventions d’exposition.

Grain, vignette, aberration chromatique et poussière peuvent contribuer à une intention photographique. Ils ne sont pas une exigence générale du photoréalisme : une caméra de qualité peut aussi être nette et propre. Les placer après reconstruction et filtrage, rendre leur intensité réglable, et conserver un profil de lecture neutre. La PSF optionnelle est un chantier distinct, pas un bonus gratuit dans 0,1–0,3 ms.

## 13. Optimisations : lesquelles garder, lesquelles reformuler

| Proposition | Décision recommandée | Conditions et risques sous-estimés |
|---|---|---|
| P1, blocs de terrain | Garder | Bornes conservatrices incluant géomorphose, relief renouvelé et projection R4b ; culling Soleil distinct ; chiffrer soumissions et sommets évités, pas seulement triangles |
| P2, bâtiments | Garder, en deux étapes | D’abord frustum par bâtiment/bloc ; Hi-Z ensuite si son gain couvre sa construction et ses délais. Avec reversed-Z, réduction et comparaison adaptées ; rejets prudents aux déplacements et désocclusions |
| P3, blocs d’arbres | Garder | Les bornes existantes aident ; intégrer portée des couronnes, vent, liste des casters et saturation des listes indirectes. Mesurer le nombre de cellules réellement éliminées |
| P4, cache de terrain solaire | Garder après contrat T6 | Clé de validité complète, repère stable malgré origine caméra et rebase ; ne pas mettre en cache une couverture annoncée mais non dessinée |
| P5, visibilité compacte | Reconcevoir avant implémentation | Deux distances non redondantes dans le chemin proxy ; identité bâtiment et normales manquantes ; compter toutes les nouvelles attaches |
| P6, copies et albédo | Bon candidat borné | Le ping-pong doit respecter les usages lecture/écriture et la durée de vie des textures, étoiles, exports, mips et handover. Distinguer copies supprimées et textures réellement désallouées |
| P7, pré-passe cockpit | Hypothèse à mesurer | `shadeLite` et le traceur ignorent déjà les régions masquées. Gain marginal sur visibilité/overdraw, pas sur tout le shading. La géométrie du cockpit et sa pré-passe ont un coût ; le Soleil ne doit pas hériter de ce masque |
| P8, amortissement | Garder après historiques fiables | Reprojection de l’air à concevoir ; fréquence selon l’erreur, et réveil sur éclair/météo/mouvement ; risque accru à basse cadence |
| P9, tuiles spécialisées | Expérience bornée | Les pixels restent mixtes, notamment aux lisières et sur l’eau ; coût des listes, dispatches et lectures dispersées ; la pression de registres dépend aussi du code compilé. L’échec U10 ne prouve ni le succès ni l’échec de cette variante |
| P10, f16 | Cibler et comparer | Capacité optionnelle ; précision des couleurs HDR, extinction et accumulation ; conversion et arrondis ; gains de registres non garantis partout |
| P11/T9, filtrage matériel | Avancer fortement | Mips corrects en linéaire, coutures/gutters, validité et mélange des sources, canal nocturne, résidence et uploads. Une instruction anisotrope ne correspond pas à une seule lecture physique |
| P12, petits nettoyages | Faire lorsqu’ils accompagnent le chantier | Ne pas en faire une justification de plusieurs ms sans profil CPU/GC ; le budget principal reste ailleurs |

### T9 mérite une étude de mise en page complète

Les fenêtres toriques actuelles et les orthos en quadrants ne deviennent pas automatiquement des couches indépendantes de texture échantillonnée. Il faut empêcher les mips d’intégrer le voisin logique incorrect, gérer les bords et séparer « pas de donnée » d’une vraie couleur noire. La séparation hauteur/imagerie et la chaîne de mips changent aussi l’allocation et le débit d’upload.

Le gain est crédible comme direction, car le code actuel multiplie les lectures manuelles. Le bilan mémoire de T9 doit néanmoins être calculé **avec T10 et les surfaces de sortie**, pas traité comme forcément favorable parce qu’un poste isolé se compacte.

### Les temps de compilation font partie de la performance utilisateur

[C] `tracer-kernels.ts` fixe des profils pour éviter les recompilations en vol. `renderer.ts` documente des compilations D3D12 pouvant durer des minutes, et un chemin `skyFill` pour afficher l’image avant les noyaux lourds.

[R] Toute nouvelle BRDF, branche de matériau, LUT ou variante doit être évaluée aussi sur taille de source composée, nombre de pipelines, première image et temps d’activation. Les nouveaux niveaux du gouverneur devraient réutiliser autant que possible des pipelines prêts. Un rendu rapide après une longue attente ne remplit pas un contrat AAA de démarrage et de navigation.

## 14. Le contenu géographique et son arrivée sont des fonctionnalités visuelles

G1/G2 sont justifiés, mais les sources ne sont pas interchangeables. Le projet impose WGS84 pour les positions et distingue hauteur ellipsoïdale, MSL et géoïde. Un DSM peut inclure bâtiments/forêts, un DTM non. Une meilleure résolution ne compense pas un mauvais référentiel vertical ou un double sursol.

[R] Chaque source doit déclarer projection, datum vertical, DTM/DSM, résolution utile, date, masque de validité et repli. Les couleurs doivent être raccordées sans cacher les échecs de données par une teinte uniforme. L’interface `NationalSource` aide, mais ne résout pas ces contrats à elle seule.

Le plan manque également d’un budget d’arrivée des données : requêtes, décodage, mémoire CPU transitoire, uploads GPU et recuissons. Des états chaud/froid doivent être distingués. En vol rapide, l’anticipation doit suivre trajectoire, hauteur et champ de vue, avec priorités explicites et annulation des besoins devenus inutiles.

**L’absence de pop et de trous temporaires fait partie du photoréalisme.** Elle mérite le même niveau d’exigence qu’une BRDF. Cela ne signifie pas recuire tous les niveaux dans la même image au prix d’une saccade : il faut un état cohérent publiable et un repli cohérent pendant la préparation.

## 15. Le périmètre AAA doit être fixé par situation de vue

Un même budget ne peut promettre la même géométrie et le même détail à pied, en avion et depuis l’orbite. Il faut définir une continuité crédible entre représentations, sans exiger une complexité uniforme.

| Situation | Ce qui domine la crédibilité | Ce qui doit être économe |
|---|---|---|
| À pied / roulage | Matériaux métriques, contacts, façades, silhouette proche, raccord piste/terrain | Atmosphère lointaine et décor sous-pixel |
| Vol bas | Stabilité des routes et toits, forêts, parallax, streaming, ombres | Microdétail et animation hors de portée visuelle |
| Croisière | Cohérence des masses, nuages, canopée et silhouettes urbaines, perspective aérienne | Objets individuels devenus trop petits |
| Haute altitude / orbite | Limbe physique, nuages, terminator, cohérence du globe et des lumières | Matériaux de proximité et géométrie locale inutile |
| Nuit / couchant / couvert | Rapports lumineux cohérents, émissions, lisibilité sans compensation incohérente | Effets de caméra qui masquent les erreurs de transport |

[R] Ajouter au futur plan une notion d’**erreur projetée admissible**, liée à la résolution de sortie et au mouvement. La distance seule ne suffit pas : le téléobjectif change radicalement la portée utile du détail et des ombres.

## 16. Ordre de travail proposé à la place de Q1–Q4

Cet ordre exprime des dépendances et des livrables, **pas une autorisation d’implémenter ni une estimation de durée validée**. Les décisions déjà prises dans le plan commun, notamment H5 optionnel et R4a/R4b livrés ensemble, restent à respecter ; leur changement éventuel doit être explicite.

### Étape A — Définir le contrat et la référence

- Cible machine, résolution de sortie, cadence et budget GPU ; profil de repli distinct.
- Liste courte de scènes et mouvements représentatifs, plus critères visuels.
- Carte des producteurs/consommateurs de profondeur, identité, normale et historique.
- Convention de lumière, pré-exposition et radiance nocturne ; politique de ré-éclairage des sources.

Sortie attendue : des contrats permettant de dire si une modification améliore le produit. Le chemin tracé reste utile pour comparer une géométrie ou une régression, mais **ne devient pas une vérité photométrique**, puisqu’il partage des approximations d’air, d’images et de lumière.

### Étape B — Corriger et financer la base

- T1–T6 selon leurs dépendances, cohérence des coutures et ombres réelles ; aucune promesse de qualité sur une géométrie incohérente.
- Avancer l’étude puis la migration T9/P11, coordonnée avec T10.
- P1/P3, premier culling bâtiment, P6 ; conserver chaque optimisation seulement si elle améliore le coût total dans ses cas utiles.
- Concevoir ensemble T5, P5 et B1 pour ne pas refaire plusieurs fois les formats de visibilité.

Sortie attendue : base plus stable et coût caractérisé. Aucune qualité supplémentaire « financée » sur la seule addition des estimations.

### Étape C — Reconstruire correctement l’image en mouvement

- I2/I3 : profondeur finale, identité, données précédentes, désocclusion et signaux réactifs.
- Clarifier l’articulation entre temporel natif et TAAU pour limiter les filtrages successifs.
- I1 : affûtage sur le signal reconstruit.
- I4 : échelle et paliers avec hystérésis, adaptation des historiques et LOD stable.

Sortie attendue : un vol qui garde netteté et cadence au changement de résolution et au dévoilement d’une nouvelle façade. L’échelle 0,5 est un candidat à évaluer, pas un critère imposé.

### Étape D — Matière et lumière cohérentes

- B1 et B3 avec identité/coordonnées de façade ; B4 pour les routes où la sémantique est fiable.
- L1, correction prudente L6/C9, première politique de ré-éclairage L7.
- L4 avec matériau, rugosité filtrée et environnement adapté.
- L2 local, L3 et S1 selon budget, après choix de profondeur ; l’occlusion lointaine ne suppose pas H5 déjà accepté.
- L8/B2 limités aux situations proches visées par le produit.

Sortie attendue : matériaux reconnaissables sous différents Soleils et météos, sans introduire scintillement ou doubles ombres plus fortes.

### Étape E — Air et volumes, avec modèle physique stable

- Modèle d’air unique remplaçant C2 ; C1 progressivement raccordé au CPU, ciel, air, sondes et nuages.
- C10, cohérence des cirrus, composition multicouche et C4 adapté aux volumes.
- C6 puis P8 avec erreur et historique contrôlés ; C5 spatial et horodaté, sans promesse de nuages individuels réels.
- Références de nuit, puis émissions proches et lumières regroupées.

Cette étape peut être étudiée tôt, après l’étape A, mais les nouveaux effets dynamiques doivent s’intégrer à la reconstruction de C. Elle n’impose pas d’attendre toutes les façades pour commencer les LUT.

### Étape F — Continuité du monde et enrichissements ciblés

- F2 raccordé au sursol existant et aux arbres ; F4 comme évolution contrôlée de données.
- Vent proche, saisons/neige cohérentes, élargissement des sources géographiques.
- Imposteurs seulement si le besoin persiste ; trafic, mobilier et optique selon bénéfice dans les scènes cibles.

Le vent et les voitures peuvent donner de la vie. Une façade qui scintille, une ombre qui saute et une forêt qui disparaît doivent être corrigées avant d’en multiplier les occasions.

## 17. Critères de livraison à écrire dans le plan

**Ces critères sont proposés ; aucun n’a été exécuté ici.** Les seuils numériques devront être fixés avec les profils visés, pas empruntés à une autre machine ou à une autre résolution.

### Qualité spatiale et physique

- Terrain sans marches/facettes artificielles, normale et silhouette cohérentes, transitions de niveaux continues.
- Aucune nouvelle double ombre manifeste ; couleurs des matériaux stables au changement de source.
- Reflets plausibles sur les surfaces identifiées, sans créer des points brillants sur des classes inconnues.
- Ciel/nuages/sol partageant la même météo et des rapports d’énergie cohérents.
- Une position physique donnée reçoit le même éclairage si seule l’altitude de l’observateur change.
- Terrain nu, géoïde, sursol et collisions respectent leurs contrats distincts ; aucune nouvelle représentation ne déplace implicitement les contacts.

### Qualité temporelle

- Pas de traînée durable derrière les bâtiments, les arbres, le trafic ou les glints.
- Pas d’anneau de sol artificiel au bord des proxies ; pas d’occlusion produite par une forme invisible.
- Marquages, façades et forêts évalués lors d’un déplacement, pas seulement après convergence.
- Pas de saut de décor ou d’impulsion de flou lorsque le gouverneur change de palier.
- Historiques renouvelés correctement sur téléportation, rebase, nouvelle tuile, météo, éclair et changement de date.
- Air et nuages raccordés pendant la montée, le passage des couches et l’arrivée en orbite.

### Performance et exploitation

- Durée totale CPU/GPU et cadence présentée séparées ; médiane et queues de distribution, pas seulement une moyenne.
- Cas froids et chauds, téléchargement/décodage/upload/recuisson et coût d’une invalidation documentés.
- Mémoire résidente et pic transitoire comptés ensemble : nouvelles LUT, attaches, historiques, mips, anciennes textures en vol.
- Première image, temps de compilation, nombre de variantes et comportement pendant la compilation documentés.
- Compatibilité réelle des formats/fonctionnalités sur les paliers prévus, avec repli lisible.
- Chaque réglage livré accessible à TARS et à l’automatisation, avec unités, état de validité, coût et documentation synchronisés.

Le protocole futur doit suivre [E2E.md](E2E.md) et les outils du dépôt ; la liste ci-dessus définit ce qu’il faudra démontrer, sans déclencher une campagne dans cette analyse.

## 18. Décisions à trancher avant de transformer ce challenge en plan d’implémentation

1. **Quelle expérience porte l’étiquette AAA ?** Vol bas d’abord, ou également proximité à pied et roulage ? Dans le second cas, L8/B2 remontent obligatoirement.
2. **Quel contrat de performance par machine et résolution ?** 25, 30, 50 et 60 i/s ne sont pas des variantes équivalentes du même objectif ; préciser le profil de repli.
3. **Quelle politique sur les photos ?** Ré-éclairage partiel conservateur immédiatement, recherche de dé-éclairage complet séparée ; éviter de promettre une restitution d’albédo sans métadonnées.
4. **Quelle profondeur et identité communes ?** Choix à stabiliser avant P5, B1, GTAO, contact et reconstruction temporelle.
5. **Atmosphère physique partout ?** Recommandation ferme : oui, avec transitions de méthodes de calcul et calibration caméra, au lieu d’un `AIR_K` dépendant de l’observateur.
6. **Quel engagement de vérité météo ?** Recommandation : champs cohérents et explicitement datés ; nuages individuels synthétiques tant que les observations ne les déterminent pas.

Les durées Q1–Q4 totalisent 27–39 jours avant même les éléments « plus tard ». Ce cumul ne constitue pas un engagement crédible tant que les formats, la reconstruction, le modèle physique et les ressources ne sont pas définis. Je recommande de chiffrer après ces choix, avec une part explicite de recherche pour L5/L7/I2/C5 et une recette distincte par palier.

## 19. Corpus et références

### Code relu directement

| Ensemble | Fichiers et points de contrôle |
|---|---|
| Pilotage | [main.ts](../src/main.ts), `rasterScale`, `rasterTop`, gouverneur ; [settings.ts](../src/settings.ts) ; [schema.ts](../src/ui/schema.ts) |
| Pipeline | [renderer.ts](../src/renderer.ts), création device, paramètres, cache, visibilité, ombres, ciel/air/nuages, temporel/TAAU, masque cockpit ; [gpuprof.ts](../src/gpuprof.ts) |
| Ombrage | [trace.wgsl](../src/shaders/trace.wgsl), `shadeLite`, `liteSun`, `liteSky`, `liteFinish`, `buildingLook`, `scenerySurface`, `sceneryTreeLite`, `earthImageryAniso`, `skyIrradiance`, `skyMirror`, `setAir`, `earthAir`, `aerial`, `earthClouds`, `cloudShadow` |
| Image | [post.wgsl](../src/shaders/post.wgsl), temporel, nuages, TAAU et exposition ; [display.wgsl](../src/shaders/display.wgsl), Catmull-Rom et RCAS ; [mask.wgsl](../src/shaders/mask.wgsl) |
| Terrain / visibilité | [terrain-raster.ts](../src/system/terrain-raster.ts), [terrain-raster-frame.ts](../src/system/terrain-raster-frame.ts), [terrain-raster-mesh.ts](../src/system/terrain-raster-mesh.ts), [terrain-raster-hint.ts](../src/system/terrain-raster-hint.ts) |
| Décor / forêt | [scenery-raster.ts](../src/system/scenery-raster.ts), [scenery-data.ts](../src/system/scenery-data.ts), [scenery-sources.ts](../src/system/scenery-sources.ts), [scenery-worker.ts](../src/system/scenery-worker.ts), [forest.ts](../src/system/forest.ts), [forest.wgsl](../src/shaders/forest.wgsl), [tree-shadow.ts](../src/system/tree-shadow.ts) |
| Sources / météo | [earth-tiles.ts](../src/system/earth-tiles.ts), [earth-surface.ts](../src/system/earth-surface.ts), [national.ts](../src/system/national.ts), [earth-air.ts](../src/system/earth-air.ts), [day-clouds.ts](../src/system/day-clouds.ts), [cloud-shadow.ts](../src/system/cloud-shadow.ts), [cloud-pass.ts](../src/system/cloud-pass.ts), [openmeteo.ts](../src/openmeteo.ts) |
| Assemblage des noyaux | [tracer-source.ts](../src/system/tracer-source.ts), [tracer-kernels.ts](../src/system/tracer-kernels.ts) |

### Documents internes croisés

- [Plan commun réfraction/horizons](PLAN-REFRACTION-HORIZONS.md), notamment dépendances T5/R4/P5, T9/T10, statut optionnel de H5 et décisions déjà prises.
- [Analyse Terre raster du 2 novembre](ANALYSE-TERRE-RASTER-2026-11-02.md).
- [Progression Terre Unreal](progress/raster-aaa/TERRE-UNREAL.md), surtout limites des chiffres U10.
- [Plan image VIPER11](PLAN-IMAGE-VIPER11.md), qui propose déjà filtrage, ré-éclairage partiel et détails : à coordonner pour éviter deux devis et deux implémentations du même sujet.
- [CLAUDE.md](../CLAUDE.md), pour WGS84, géoïde, cohérence CPU/GPU et règles du projet.
- Dernière note d’Alex lue sur `origin/master` après actualisation : `puffs-reglages-ordre-brouillard_2026-11-02-01-13-15.md`. Elle illustre notamment le piège d’une atténuation uniforme du ciel dans les scènes déjà ombrées ; elle ne vaut pas validation de notre rendu terrestre.

Les sources externes sont liées à proximité des propositions qu’elles soutiennent. Les temps et gains non mesurés restent des hypothèses ; aucun jugement de qualité visuelle actuelle n’est présenté comme issu d’une nouvelle capture.
