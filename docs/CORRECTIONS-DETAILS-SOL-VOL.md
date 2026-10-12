# Corrections : collisions, profondeur, streaming, carte et ombres

Analyse du 12 octobre 2026, sur les modifications existantes de la branche `codex/earth-photorealistic`
(HEAD initial `6268e9f`, avec changements non commités du panneau de placement et de la marche).
La correction de reprojection pendant la marche, les réglages de déplacement/herbe et le placement
« à pied » sont conservés.

## Problèmes trouvés et corrections

### Collisions des objets 3D

Le tronc rendu est une boîte de demi-largeur 22 cm ; la collision était cylindrique et manquait ses
coins. Les cinq couronnes ellipsoïdales n’étaient pas prises en compte. Le contact utilise désormais
les dimensions, centres et phases effectivement utilisés par `sceneryQuery` dans le shader : boîte
pour le tronc, distance à l’ellipsoïde pour chaque couronne. Les empreintes OSM restent les mêmes
polygones que le rendu, y compris cours et trous.

La collision était vérifiée avant le déplacement vertical du saut : une tête pouvait franchir le dessous
d’un pont après cette vérification. Le déplacement vertical est maintenant arrêté au dernier point libre,
puis la gravité reprend. Le moteur conserve les petits pas à 120 Hz et le support sur les tabliers.

La coque du vaisseau et la caméra ont également un contact de proximité : capsule contre les triangles
réels de la coque, avec parcours de son BVH existant. La requête couvre faces, arêtes et petits triangles,
pas uniquement la sphère englobante. Elle n’alloue pas une deuxième copie du mesh. Les pieds utilisent
le champ de hauteur partagé introduit précédemment. Les hauteurs et formes des objets OSM restent
celles des données/estimations affichées : ce ne sont pas des relevés architecturaux.

### Le vaisseau passait devant le personnage

Le personnage est rasterisé dans le HDR, puis le vaisseau dans sa propre image avec MSAA, compositée
ensuite. Cette seconde passe ignorait la profondeur du personnage. Changer seulement l’ordre de dessin
aurait inversé le défaut.

La profondeur du personnage est maintenant conservée et lisible comme texture. La passe du vaisseau
la compare à sa profondeur réelle, en mètres, au même pixel. Les fragments du vaisseau derrière le
personnage sont rejetés ; ceux devant restent visibles. La profondeur de la station et celle du terrain
restent consultées. Le vaisseau quitté est désormais occulté par le terrain comme les autres vaisseaux.
Le mécanisme conserve le MSAA du vaisseau et n’ajoute pas de lecture GPU vers le CPU en jeu.

### Le vaisseau ne projetait pas d’ombre

La carte d’ombre du vaisseau existait pour son propre éclairage et certains sols. Deux chemins manquaient :
la vue à pied désactive `settings.ship`, ce qui annulait son rayon d’ombre ; le shader terrestre ne
multipliait pas son éclairement direct par cette visibilité.

Le vaisseau visible depuis l’extérieur conserve désormais son état de projection d’ombre. Le sol
terrestre consulte la carte existante à la position réelle rencontrée par le rayon. L’ombre atténue la
lumière directe ; le ciel et l’ambiance restent présents. La carte est mise à jour à chaque image à pied
pour suivre la caméra, au lieu d’une image sur deux. Il s’agit de la silhouette de la coque et des éléments
présents dans sa carte, avec filtrage PCF ; la source lumineuse vient du probe déjà utilisé pour le vaisseau.

### Chargements dans la direction du vol et autour

La priorité utilise la vitesse relative au sol qui tourne, convertie dans les axes terrestres. La composante
verticale est retirée : ni l’orbite de la Terre ni un appareil immobile sur la piste ne simulent un vol horizontal.
L’anticipation est de **six secondes maximum**, limitée à **650 m**. À 100 m/s elle avance de 600 m ; à
250 m/s, de 650 m. Un demi-tour réoriente cette priorité dès l’image suivante.

- Terrain : les fenêtres de 4 × 4 tuiles par niveau restent autour de la position actuelle ; l’ordre des requêtes
  favorise le point anticipé, aussi dans les callbacks de fin/relance. Les niveaux grossiers restent prioritaires.
- Satellite régional : le pack est choisi depuis la position actuelle, mais ses pages sont priorisées vers l’avant.
- Décor mondial : le centre demandé se déplace vers ce point anticipé. Le déplacement reste inférieur au rayon
  de couverture afin de conserver des données derrière et sur les côtés. Les données précédentes restent présentes
  pendant la préparation du nouveau centre.
- À pied : avance nulle, le streaming suit le personnage et conserve la correction existante `onFoot`.

Les budgets, fenêtres, limite de huit requêtes de terrain et buffer de décor de 16 MiB sont conservés.
La couverture du satellite régional reste limitée aux packs existants ; WorldCover/OSM reste mondial dans
ses limites de latitude et de données. Un réseau plus lent que la progression de l’avion peut encore imposer
le repli : aucun chargement borné ne garantit l’arrivée des détails avant un avion arbitrairement rapide.

### Carte locale au sol

La carte sélectionne automatiquement le planisphère local lorsqu’un vaisseau est posé ou que le personnage
est à pied. **M** l’ouvre aussi à pied sans ouvrir simultanément les réglages. Le zoom initial est **18**,
avec molette, boutons +/−, déplacement par glisser et double clic/bouton de recentrage.

La carte utilise les données déjà chargées : imagerie WorldCover/Copernicus, empreintes de bâtiments,
réseaux routiers et ferrés, eaux et ponts OSM. Elle ne lance pas un second téléchargement de tuiles.
La projection locale conserve le nord vers le haut et une échelle métrique correspondant au niveau de zoom
cartographique ; au zoom 18, elle vaut environ 0,43 m/pixel à 44° de latitude. Le bleu marque la position
observée, l’orange le vaisseau laissé sur place. Le fond satellite est moins fin que cette échelle.

L’image de fond est préparée une seule fois par jeu de données ; les objets hors champ sont écartés avec
les indices d’échappement du BVH. La vue à pied est rafraîchie au maximum vingt fois par seconde, seulement
quand la carte est ouverte. Pan/zoom restent immédiats. Cette carte montre la couverture du cache de décor,
les réseaux disponibles et leurs géométries ; elle n’ajoute pas les noms de rues absents du buffer de rendu.
Le statut expose une source indisponible au lieu d’annoncer des données complètes.

## Validation et automatisation

- `bun run check` : types et compilation des dix modules WGSL sur Apple passent.
- Suite complète `bun test` : **779 réussis, 364 ignorés, aucun échec** avant le commit final (`bun test --timeout 20000`, 170 s ici).
- Tests ciblés : **41 réussis, aucun échec**, incluant coins des troncs, couronnes, caméra, dessous de pont, capsule/triangles, direction/limite de
  streaming, échelle de carte, raccourcis, TARS et traductions.
- `bun run e2e ground-details character` : **trois tests passent** (71 s ici), aucune erreur GPU/console ; marche,
  embarquement, sauvegarde, herbe, ombre du vaisseau, profondeur et zoom de carte.

Le test de profondeur exclut les pixels hors du rectangle actif du vaisseau : son image intermédiaire
réutilise un cache dont l’extérieur peut conserver les pixels d’une vue précédente. Un plan de profondeur
contrôlé placé à 1 m masque les environ 59 600 pixels de coque dans la vue testée. Le test ne suppose pas que le
personnage recouvre la coque dans une pose où le vaisseau se trouve au-dessus de lui.

Les captures attendent les données, les shaders de rendu et d’éclairage et 120 images sans arrivée de
ressources, aussi pour la carte après sa transition. Artifacts : `remote-results/ground-depth-shadow.png`,
`ground-local-map.png`, leurs `*-readiness.json` et `ground-depth-ab.json`.

TARS dispose de `/mapzoom 18`, `interface(mapZoom)`, `show_screen(map_planisphere)`, des groupes
`map` et `streaming` de `get_telemetry` et des états correspondants dans `get_state`. Les ouvertures et
changements de zoom génèrent l’événement `map`. Le coût CPU de dessin de carte est exposé dans son état ;
Le test navigateur vérifie également un vol à 200 m/s : l’avance atteint 650 m après sortie du mode à pied.
La distance anticipée et la limite temporelle sont exposées dans les diagnostics de performance.

Ces corrections réutilisent les textures, meshes, BVH et buffers existants. Le coût supplémentaire porte
sur les tests de proximité, une consultation de profondeur pour les fragments du vaisseau, la consultation
de sa carte d’ombre sur les sols concernés et le dessin 2D visible de la carte. Elles ne constituent pas
une nouvelle promesse de rendu photoréaliste AAA ni un benchmark universel de performance.


## Planisphère sur les autres planètes

La touche **M** ouvre aussi la carte à pied sur la Lune, Mars et les autres surfaces marchables.
Chaque changement de monde recentre la carte sur le personnage et rétablit le **zoom 18**.
Le zoom est réglable de **0 à 21**, par molette, boutons et TARS ; le dézoom permet de retrouver
le contexte planétaire. Les positions sont exprimées dans les axes du corps visité, avec
le rayon propre à ce corps pour l’échelle et le déplacement du centre. Les longitudes bouclent
à ±180° ; le déplacement nord/sud est limité aux pôles. Le vaisseau laissé sur ce corps conserve
son repère orange, y compris dans les référentiels de Gargantua.

La carte réutilise les atlas déjà enregistrés dans le projet : Lune, Mars, Mercure, Vénus,
Pluton et les satellites disposant d’une texture. Ces atlas globaux ne fournissent pas une
imagerie métrique au zoom 18 : le fond peut donc être presque uniforme à cette échelle.
La Terre garde son fond local Copernicus/WorldCover et ses géométries OSM lorsqu’ils sont chargés ;
l’atlas global prend le relais en l’absence de cache local.

Mann et Edmunds affichent un **quadrillage de référence**, les coordonnées, le marqueur et
une échelle métrique avec leur teinte de surface. La carte signale l’absence d’imagerie.
Elle ne présente pas des formes de terrain inventées comme des données cartographiques.
Les statuts `sourceReady`, `sourceStatus` et `radiusM` sont accessibles à TARS.

Le chargement d’atlas utilise le cache existant du planisphère orbital (1024 × 512, environ 2 Mio
par image RGBA préparée), sans service de tuiles supplémentaire. Le dessin effectue des copies
2D des portions visibles et un quadrillage adaptatif, sans lecture GPU et uniquement lorsque
la carte est visible. Il conserve le plafond de vingt rafraîchissements par seconde.

Validation dédiée : `bun run e2e ground-planets` vérifie les atlas Lune/Mars réellement chargés,
le zoom initial, les coordonnées près de l’antiméridien, le dézoom et le retour à pied ; il vérifie
également le quadrillage de Mann sans atlas. Les captures `ground-planisphere-*-local.png`,
`ground-planisphere-*-global.png` et `ground-planisphere-mann-grid.png` attendent les shaders
et la stabilité des ressources avant d’être enregistrées.

Contrôle final de l’extension : `bun run check` passe (types et **10/10 shaders**), et
`bun run e2e ground-planets ground-details` passe (**2 tests, 22 assertions**, aucune erreur).


## Diagnostic des collisions décalées : volumes roses

Le réglage **Volumes de collision roses** est activé pour cette vérification, à pied sur Terre.
Il dessine les colliders CPU dans un rayon de 60 m : boîte du tronc, cinq couronnes ellipsoïdales,
extrusions des empreintes OSM et leurs cours intérieures. Les ponts stockés comme volumes sont
également présents. Les lignes restent visibles à travers les objets pour comparer les positions.
Ce sont les volumes physiques, sans l’expansion de 30 cm liée au rayon du personnage.

Le diagnostic utilise les coordonnées Earth-fixed et le repère de la caméra du personnage ;
il ne reprend pas la transformation du shader de décor, afin de rendre un décalage CPU/GPU visible.
Il ne corrige pas automatiquement ce décalage. Son budget est limité à 16 384 segments, avec
priorité aux objets proches, recalcul de géométrie après 8 m de déplacement ou changement de cache,
et dessin à 30 Hz maximum. Désactivé, il ne construit ni ne projette la géométrie.

L’interrupteur est dans Réglages → Terre et accessible à TARS par `/set sceneryHitboxes false`.
Les captures `pink-hitboxes-tree.png` et `pink-hitboxes-building.png` sont produites par le test
`scenery-hitboxes`, après chargement des données et compilation des shaders.

Validation du diagnostic : 27 tests ciblés passent (géométrie, TARS, traductions ; délai 20 s
pour le calcul d’éclipse existant), `bun run check` compile les 10 shaders et les types, et
`bun run e2e scenery-hitboxes` passe sur les données réelles du Bourget (36 s, aucune erreur GPU/console).


## Correction du décalage mesuré entre les volumes roses et le décor

Le test navigateur a mesuré **6,498 m de décalage** entre l’origine CPU des contacts et
l’origine GPU du décor près du Bourget. Les géométries et dimensions étaient identiques ;
le déplacement provenait de `ourPatch()` dans `src/system/local-patch.ts`.

Cette fonction retardait optiquement le centre terrestre avec `seenFrom()` en utilisant
sa vitesse de translation. Elle gardait néanmoins la rotation et les objets de surface à
l’instant courant. La caméra sur le sol suit aussi la rotation terrestre : sa vitesse diffère
alors de celle du centre. Le retard mesuré sur un rayon planétaire produisait une translation
apparente de plusieurs mètres de l’ensemble du sol, tandis que le personnage, les hitboxes
et les collisions conservaient leurs coordonnées physiques actuelles.

La scène proche utilise maintenant le **même repère physique instantané** que les contacts
et les meshes natifs. Pour les planètes de notre système, jusqu’à 1,02 rayon depuis le centre
(environ 128 km au-dessus de l’équateur terrestre), aux vitesses ordinaires de la caméra
(< 0,001 c), la position relative et les axes de surface évitent ce retard au centre et la
transformation de Lorentz des axes. Les vues plus éloignées et les observateurs relativistes
conservent leur branche optique. Cette première correction concernait notre système ; l’extension aux mondes de Gargantua est décrite plus bas.
L’éclairage solaire conserve son traitement optique ; aucune géométrie supplémentaire n’est
créée et aucun coût GPU n’est ajouté.

Après correction, sur les mêmes points de vue chargés :

- Près de l’arbre : **0,000996 m** d’écart CPU/GPU, contre **6,498 m** auparavant.
- Près du bâtiment : **0,000911 m** d’écart.

Les contours roses se superposent visuellement aux formes rendues. Le test navigateur
calcule la position de l’œil depuis le repère du personnage, la convertit dans le repère
CPU des collisions et la compare à l’origine réellement envoyée au GPU (tolérance 5 cm).
Il produit `pink-hitboxes-tree-alignment.json` et `pink-hitboxes-building-alignment.json`,
ainsi que les captures après stabilité des données et des shaders.

`bun test --timeout 20000 tests/local-patch.test.ts tests/scenery-contact.test.ts tests/character.test.ts` :
**26 réussis**, aucun échec. Deux régressions ciblées vérifient le sol en rotation et le maintien
des vues optiques éloignées/relativistes. `bun run check` passe ; `scenery-hitboxes` passe avec
les assertions d’alignement et aucune erreur GPU/console.

La campagne de régression `bun run e2e ground-details character ground-planets` passe aussi :
**4 tests, 48 assertions, aucun échec** (131 s ici). Elle couvre les contacts en marche,
l’embarquement, l’herbe, les ombres, la profondeur, les cartes sur les autres mondes et le
chargement anticipé en vol. Avec `scenery-hitboxes`, cinq tests navigateur ont validé ce correctif.


## Sortie et placement à pied sur Mann, Miller et Edmunds

Trois causes expliquaient le personnage et le vaisseau visibles en altitude :

1. La caméra à pied était créée avec une vitesse nulle dans le référentiel de Gargantua,
   alors que son point de vue se déplace avec la planète. Le rendu optique voyait alors
   une planète en mouvement relatif rapide. Elle reçoit désormais la vitesse calculée
   par `toGlobal()` pour son point fixe dans le repère planétaire.
2. `theirGroundPose()` ne conservait pas l’état local posé. `land()` transportait le vaisseau
   à une position au sol mais perdait les coordonnées propres, l’état posé et la vitesse
   locale nulle. La pose transporte maintenant `localLanded`, repris par le contrôleur
   avec train sorti et état local posé. Le raccourci de sortie identifie donc aussi le corps
   sans devoir attendre une étape physique.
3. Terrain et objets natifs employaient des transformations différentes autour de Gargantua.
   Après correction de la vitesse, le test trouvait encore **1 596 m** d’écart sur Edmunds.
   Le rendu proche reconstruit maintenant sa caméra depuis `toLocal()` et partage un repère
   orthonormal de longueurs propres avec le personnage et le vaisseau vu depuis la caméra
   à pied. Les vues hors de la proximité de surface gardent leur calcul optique.

Le placement du vaisseau utilise aussi ce repère pour son attitude. Au point situé sous le
corps primaire ou à son antipode, la direction projetée vers le primaire devenait nulle :
elle reçoit désormais une direction tangente de secours, pour éviter un vaisseau dressé
verticalement au lieu d’être posé à plat.

Miller permet maintenant la sortie à pied sur son plan de contact marin, entre les vagues
sélectionnées par le placement existant. Les grandes vagues restent visuelles, comme dans
la physique du vaisseau ; ce correctif n’introduit pas de simulation de nage ou de collisions
avec leurs crêtes. Les surfaces gazeuses restent non marchables.

Validation : tests de vitesse de caméra, coordonnées propres terrain/personnage, pose au sol,
et attitude non dégénérée aux deux extrêmes. Le navigateur vérifie les trois planètes avec
`land()` puis **⇧K**, réembarquement, et `walk()` (le chemin du panneau « On foot »).
Les pieds sont mesurés à environ **12 mm du contact**, la marge volontaire du contrôleur ;
le vaisseau reste posé, et le terrain se trouve à la hauteur de la caméra (environ 2,2 m).
Captures et mesures : `gargantua-ground-{mann,miller,edmunds}.png` et `.json`, avec fichiers
`*-readiness.json` après chargement des ressources et compilation.

Le changement ne crée ni texture ni buffer GPU supplémentaire. Il ajoute des conversions
CPU de repère à la caméra à pied et remplace les calculs incohérents de placement proche.
TARS conserve les mêmes actions de placement et de marche et lit l’état posé du contrôleur.

Contrôles finaux de cette correction : **26 tests ciblés**, `bun run check` (types et **10/10 shaders**),
`gargantua-ground` (**35 assertions**, panneau Miller inclus) et `ground-planets` passent. Les fichiers navigateur sont
exécutés séparément (`--each`) pour éviter un arrêt du serveur entre deux campagnes concurrentes.

Avant le commit : la sélection « À pied » du panneau autorise également Miller, comme le
contrôleur et `walk()` ; la sélection et l’action sont vérifiées par de vrais clics dans le navigateur.
