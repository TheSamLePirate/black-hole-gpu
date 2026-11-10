# Analyse — le chargement du monde : téléchargement, cache, assemblage (6 novembre 2026)

**Demande de Sam.** « Il faut vraiment un super système de gestion de téléchargement, de cache et d'assemblage, optimisé AAA,
compatible avec la gestion de téléchargement de zones du PWA déjà implémentée. […] Le chargement des tuiles, détails,
bâtiments, lampadaires, pylônes, voitures… est ce qui rend le jeu “buggé”, alors que quand c'est chargé, c'est magnifique.
[…] S'assurer que les nouvelles données (lampadaires, routes, bâtiments, USA…) fassent partie du mode téléchargement de zone
du PWA. Dans l'idéal, lancer des e2e à travers la PWA. »

**État du document.** Analyse datée, fondée sur la lecture du code à `d11f0171` et sur les mesures du 6 novembre (ce Mac,
kerr-mini). Le code fait foi. Références : [ANALYSE-STRATEGIE-RENDU §7.6, §7.16, §7.19](ANALYSE-STRATEGIE-RENDU-2026-11-03.md),
[GRAPHICS-PIPELINE §7](GRAPHICS-PIPELINE.md), [ANALYSE-IGN-LIDAR §9](ANALYSE-IGN-LIDAR.md) (zones hors ligne),
[T8](progress/refraction-horizons/T8.md) (décodage en worker, ordre d'arrivée, audit réseau).

## 0. Résumé

1. **Le défaut perçu n'est pas le réseau, c'est l'assemblage.** Sur une approche de JFK, le voyant réseau est jaune (« données
   demandées, rien ne descend ») 74 s sur 162 s. Pendant ce temps, l'unique worker du décor recalcule une scène entière de
   13 km : 20 à 44 s, toutes les 40 s environ. Ce n'est pas un manque de bande passante.
2. **Le décor est monolithique.** Une scène = une boîte autour d'un centre, refaite d'un bloc à chaque recentrage :
   forêt, rues, murs mitoyens, toits, décalques, pylônes, voitures et lampadaires, puis un seul `writeBuffer` de 64 Mo.
   Deux scènes successives partagent environ les trois quarts de leur contenu ; presque rien n'est réutilisé.
3. **Rien n'ordonne l'ensemble.** Une douzaine de files et de limites s'ignorent : 8 hauteurs, imagerie sans plafond,
   14 national, 8 ortho, les 6/6/6/4/6 du worker, et les portes IGN de la page, du worker et du SW. Il n'y a ni budget en
   octets ni en temps, ni contre-pression GPU → décodage → réseau. La prédiction ne regarde que 650 m devant.
4. **Les zones hors ligne avaient pris du retard sur les sources.** Les rues de nuit (NU1), l'infrastructure Overture
   (pylônes, éoliennes) et Terrarium sous les reliefs nationaux n'y étaient pas, et aucune version de zone ne le signalait.
   **Corrigé aujourd'hui** (§6, lot ST1) et couvert par un e2e passé par la PWA, aux USA, de nuit.
5. **Ce que ferait un studio** (§4) : un monde découpé en **cellules** stables, chacune **cuite** une fois par un pool de
   workers en un format prêt pour le GPU. Les cellules cuites vont dans un **cache persistant versionné**, celui-là même que
   les zones téléchargent. Elles sont publiées **progressivement** dans un **pool GPU paginé**, sous un **ordonnanceur unique**
   qui priorise par temps avant visibilité, avec **prédiction** de trajectoire et un **HLOD** lointain. L'ancien contenu
   reste affiché jusqu'au remplacement cohérent.
6. **Plan** (§7) : onze lots (ST0–ST10), mesurés un à un. ST0 (mesures) et ST1 (couverture des zones, e2e PWA) sont
   faits ou en cours. Le cœur est ST3–ST6 : cellules, cuisson, cache cuit, pool GPU. Le HLOD lointain (ST8) et la
   parallélisation (ST4) sont planifiés, comme Sam l'a demandé (« 3 et 4 en planifié »).

## 1. Ce qui se charge en temps réel

### 1.1 Le sol : relief et imagerie (`EarthTiles`, page)

| Donnée | Source | Niveaux | Chemin | Hors ligne (zones) |
|---|---|---|---|---|
| Relief mondial | Terrarium (S3) | z 6–15 (z 16–17 : parent z 15) | `terrarium()` → worker de décodage → `putTile` | oui, **sa propre chaîne depuis ST1** |
| Relief national | IGN WMS-R (RGE ALTI, LiDAR HD), swisstopo (maillages), Mapterhorn (USA 3DEP, Europe, Japon, NZ) | z 11/12–17 | `refine` → file nationale (14) → `putTile` | oui (chaînes de `heightUrls`) |
| Sursol lointain (HLOD) | IGN MNS | z 11–13 | second passage de `refine` | oui |
| Imagerie | GIBS (≤ z 8), EOX, IGN, swisstopo, USGS (≤ z 16) | z 6–14 + ortho z 15–18 | `imagery()` sans plafond, `requestOrtho` (8) | oui (USGS borné à z 16 depuis `91483f0f`) |
| Lumières de nuit | VIIRS z 8 + **rues OSM z 12–13** (NU1) | z 6–14 | `imagery()` + `fetchRoads` → masque cuit en worker | **rues depuis ST1** |
| Ciel du jour | GIBS nuages (WMS quotidien) | globe | `day-clouds.ts` | non (une URL par jour) |

### 1.2 Le décor (`EarthScenery`, worker unique)

| Donnée | Source | Rayon | Hors ligne |
|---|---|---|---|
| Couverture du sol | ESA WorldCover (Terrascope WMS) | boîte de la scène | oui |
| Rues, eau, bâtiments OSM, aéroports | OpenFreeMap z 14 | ≤ 64 · portée² tuiles | oui |
| Bâtiments | BD TOPO (France), Overture `buildings.pmtiles` (ailleurs, ≤ 1,8 km) | rayon de la scène | oui |
| Sol sous les arbres et bâtiments | IGN (MNH, LiDAR, RGE), swisstopo, **Mapterhorn z 14 (USA)** | relevé + 250 m | oui (USA aussi désormais dans `sceneryChains`) |
| Forêt | WorldCover + MNH (France) | boîte | — (calculée) |
| Lampadaires, voitures | dérivés des rues OSM z 14 | 1,5 km, 3 km | via OSM z 14 |
| Pylônes, lignes, éoliennes | Overture `base.pmtiles` z 13 | 5 km, 15 km | **depuis ST1, dans le rayon des pylônes (5 km)** |

### 1.3 Les autres chargements

Cartes globales et KTX2 (immuables, mis en cache à l'usage), surface régionale, pistes du monde (`runways/v1`, LRU),
réseau des aéroports (Overpass, cache propre), météo, METAR, ADS-B, météo spatiale (réseau seul, par conception), cuissons
GPU du cache de relief et des horizons, compilations des noyaux.

## 2. Ce qui a été mesuré

| Mesure | Valeur | Source |
|---|---|---|
| Scène de décor (JFK, approche de nuit, 93 m/s) | 20–44 s par scène, refaite toutes les ~40 s ; 33 relevés « refreshing » sur 50 | e2e `lebourget-night-ils` `LBN_SCENERY=1`, ce Mac, 6/11 |
| Phases d'une scène (marqueurs cumulés) | rues OSM 2,5–6 s ; forêt et murs mitoyens 3–6 s ; toits 3–7 s ; détail 2–8 s ; infrastructure 1–8 s | idem, après `d11f0171` |
| Toits repris d'une scène à l'autre (`planCache`) | 26–36 % (0 % à la première) | idem |
| Voyant réseau pendant le vol | vert 63 s, jaune 74 s, gris 25 s sur 162 s | idem, `netLight.stats().seconds` |
| Volume réseau d'une approche | 270–280 Mo en 160 s ; 670 Mo avec le préchargement par la page (doublons) | idem |
| Échecs réseau (voyant rouge) | 930 × 404 USGS z 17–18 → **2** après `orthoZ1` | e2e JFK, avant/après `91483f0f` |
| Décor complet après un saut | 24–33 s par scène, couverture 0,97 | T8m/T8o, kerr-mini |
| Vue à 90 % (relief et imagerie) | 8,1 s ; file vide en 44 s | T8 |

## 3. Diagnostic : cinq causes racines

1. **Unité de travail trop grosse.** La scène de 13 km est l'unité de calcul, de publication et d'invalidation. Un
   recentrage de 1,5 km refait tout ; aucune publication partielle n'existe, et le fondu de 600 ms est global.
2. **Pas de parallélisme ni de priorité dans l'assemblage.** Un seul worker de décor, en phases séquentielles, annulé
   seulement entre deux phases. Un seul worker de décodage, en FIFO, qui décode même les tuiles abandonnées.
3. **Pas de chef d'orchestre.** Les budgets se comptent en nombre de promesses, pas en octets ni en millisecondes. Rien ne
   circule du GPU vers le décodage et le réseau. Le relief et le décor téléchargent chacun leur Terrarium ; la page et le
   worker leurs OpenFreeMap. La prédiction est linéaire et courte (650 m) ; ni le plan de vol ni l'autopilote ne sont lus.
4. **Caches éclatés et volatils.** Une douzaine de LRU indépendants, à tailles fixes, sans comptabilité mémoire commune.
   Rien de ce que le worker *calcule* n'est persistant. Seuls les octets réseau le sont (SW), donc chaque visite recalcule.
5. **Lisibilité de l'état insuffisante.** Un rectangle de validité par niveau, un booléen `earthSettled`, un tampon par
   scène. Ni génération par cellule, ni horodatage, ni « âge de l'information » mesurable.

## 4. Ce que font les studios

- **Flight Simulator.** Un *rolling cache* sur disque, de taille fixée par le joueur, qui garde ce qui a été streamé
  (relief, imagerie, photogrammétrie). Un *manual cache* de régions choisies d'avance, à une qualité donnée : c'est
  exactement nos zones. Les bâtiments génériques sont produits côté client à partir des emprises et de l'imagerie, par
  tuiles, puis gardés. Sources : [FlyAway Simulation, réglages de données](https://flyawaysimulation.com/ask/answers/msfs-2020-data-settings-cache/),
  [forum officiel, rolling/manual cache](https://forums.flightsimulator.com/t/need-an-explanation-about-rolling-cache-and-manual-cache/142641?page=2)
  (sources communautaires, non officielles).
- **Cesium 3D Tiles.** Une hiérarchie de tuiles choisies par **erreur projetée à l'écran** et un ordonnanceur de requêtes
  qui classe par profondeur, distance au centre de l'écran et à la caméra. Les requêtes devenues inutiles sont
  **annulées**, l'erreur est relâchée en périphérie (*foveated*), les requêtes sont différées pendant les mouvements et la
  destination d'un vol est préchargée. Sources : [Cesium, « Faster 3D Tiles »](https://cesium.com/blog/2019/05/07/faster-3d-tiles/),
  [doc Cesium3DTileset](https://cesium.com/downloads/cesiumjs/releases/1.79/Build/Documentation/Cesium3DTileset.html).
- **Unreal World Partition.** Une grille de **cellules** chargées autour de **sources de streaming** (joueur, caméras
  prédites), avec une portée par grille et des priorités. Au-delà, des **HLOD** : des groupes d'acteurs fusionnés en un
  maillage simple, vus dès la portée de chargement. Sources : [FWorldPartitionStreamingSource](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Engine/WorldPartition/FWorldPartitionStreamingSource?application_version=5.5),
  [Streaming et HLOD (UEFN)](https://dev.epicgames.com/documentation/fortnite/streaming-and-hlods-in-unreal-editor-for-fortnite).
- **Virtual texturing** (déjà cité par ANALYSE-STRATEGIE §7.16) : pages résidentes à taille fixe, et une couverture
  grossière toujours présente sous la fine.

**Les principes communs** :
1. **Cellules stables** plutôt que scènes.
2. **Cuisson une fois, réutilisation partout** : session, disque, zones.
3. **Ordonnanceur unique** à priorités et à budgets, avec annulation.
4. **Prédiction** de la caméra et de la trajectoire.
5. **Hiérarchie de détail** : quelque chose de juste est toujours affiché.
6. **Publication progressive et bornée par image**.
7. **Mesure continue** : temps avant visibilité, trous, âge.

## 5. Architecture cible

### 5.1 Les cellules du monde

- **Grille commune** pour tout ce qui n'est pas une tuile raster : cellules Web Mercator z 15 (environ 0,8 km à 49°) pour le
  détail proche, regroupées en super-cellules z 13 pour le lointain. La scène actuelle devient la *réunion des cellules
  résidentes* autour des sources de streaming : caméra, point prédit, regard.
- **Une cellule cuite** est un binaire autonome : primitives, BVH local, maillages, lampadaires, voitures, arbres, décalques,
  en coordonnées locales à la cellule. Elle porte une **clé de contenu** (sources, versions des données, version du
  cuiseur) et une **génération**.
- **Les dépendances de bord** (murs mitoyens, arbres sur la limite, ponts) se règlent par un **halo** : chaque cellule lit
  ses voisines au moment de la cuisson et ne garde que ce qui lui appartient, par un point d'ancrage. C'est la règle des
  tuiles vectorielles.
- **Résidence.** Anneau proche (cellules z 15 pleines) ; anneau moyen (z 15 sans les détails de près : pas de cheminées ni
  de maillages fins) ; anneau lointain (super-cellules **HLOD** : boîtes à la hauteur réelle, arbres en impostures,
  lumières de nuit). Une cellule est remplacée seulement quand sa remplaçante est publiée.

### 5.2 L'ordonnanceur unique (`StreamScheduler`)

- **Un seul lieu** pour toutes les demandes : tuiles de relief, imagerie, rues, cellules de décor, pylônes, ciel. Chaque
  demande porte : clé, coût estimé (octets, ms de cuisson, octets GPU), **temps avant visibilité** (distance au regard et à la
  trajectoire prédite divisée par la vitesse ; bonus si la cellule est dans le champ ou sous l'appareil) et génération.
- **Étapes séparées**, chacune avec son budget : réseau par fournisseur (concurrence et débit par hôte, file prioritaire
  d'âge pour l'IGN comme celle du SW), décodage (pool), cuisson (pool), téléversement (octets par image),
  publication (ms par image). La contre-pression remonte : file d'upload pleine → cuisson ralentie → réseau non urgent
  différé.
- **Annulation et pertinence.** Une demande sortie de la zone utile est annulée si elle est annulable (fetch, cuisson pas
  commencée), sinon son résultat est gardé en cache sans être publié. Les délais d'attente deviennent des **échéances
  de pertinence**.
- **Bibliothèques.** CLAUDE.md propose **Effect** pour ce périmètre borné (annulation, erreurs, contre-pression) ; à décider
  au lot ST2 sur prototype, sans fiber par objet. Sinon, une petite file maison à priorités, testée.

### 5.3 La prédiction

- **Sources de streaming.** La caméra ; le point prédit à 10, 30 et 60 s (vitesse et cap, virage en cours, autopilote
  engagé : cap et altitude visés ; plan de vol actif : prochains points ; ILS : l'axe de la finale) ; le regard (HMD, vue
  libre) ; une réserve derrière la caméra pour un regard brusque.
- **Distance utile par donnée** : le relief fin sous l'appareil, le décor dans l'anneau proche de la trajectoire, le HLOD
  sur le cône de vue.

### 5.4 La cuisson et ses caches

- **Pool de cuiseurs** : 2 à 4 workers selon `hardwareConcurrency`, une cellule par tâche, annulable. On n'interrompt
  jamais une cuisson commencée : chaque tâche fait moins de 300 ms.
- **Données partagées** : un **service de hauteurs** commun au relief et au décor (fin du double Terrarium), un cache des
  tuiles OSM et Overture décodées partagé par les cuiseurs (un worker propriétaire ou `SharedArrayBuffer` si l'en-tête
  COOP/COEP le permet ; sinon le cache HTTP et le SW).
- **Cache cuit persistant** : Cache API (même origine), clé `cell/z/x/y?k=<clé de contenu>`, géré par le SW comme les tuiles.
  Il prend place dans le LRU (`TILE_BUDGET`) et dans les zones. **Une zone télécharge ses octets réseau *et* stocke ses
  cellules cuites** à la fin de son téléchargement : un vol hors ligne en zone ne cuit plus rien.
- **Versionnement** : `COOKER_VERSION` dans la clé. Une nouvelle version du cuiseur rend les anciennes cellules
  inutilisables sans casser les zones ; elles sont recuites depuis les octets bruts de la zone, sans réseau.

### 5.5 Le GPU

- **Pool paginé** : le buffer du décor devient un tas de pages (par exemple 256 Ko). Une cellule occupe des pages ; une
  table d'indirection et une **BVH de second niveau** (les boîtes des cellules résidentes) remplacent la BVH monolithique.
- **Téléversements bornés** : N octets par image (`writeBuffer` partiels). Les mips d'imagerie sont regroupés en un encodeur
  et une soumission par image, au lieu d'une soumission par tuile et par couche. Les `putTile` successifs d'une même tuile
  sont regroupés : relief Terrarium → national → sursol, une seule écriture quand plusieurs arrivent dans la même image.
- **Fondu par cellule** : génération et heure de publication dans la table ; le shader fond la cellule et non la scène.

### 5.6 Les zones hors ligne (PWA)

- **Manifeste de sources versionné** (`ZONE_SCHEMA`, fait en ST1) : une zone ancienne est signalée « à mettre à jour », et
  sa mise à jour ne télécharge que ce qui manque.
- **Une seule spécification** des requêtes : `sceneryChains`, `reliefChains` et `orthoUrls` dérivent des mêmes fonctions que
  les chargeurs. Les tests comparent aux requêtes réelles du worker et non à une copie. Fait en partie : USA et
  infrastructure ajoutés à `sceneryChains`.
- **Cellules cuites dans les zones** (ST6) et **pré-cuisson** à la fin du téléchargement, en arrière-plan.
- **Les e2e passent par la PWA** : `App.boot({ sw: true })`, zone téléchargée, réseau coupé, rechargement, vol. Le profil
  de Chrome des e2e peut être gardé (`E2E_PROFILE`, ST1b) pour réutiliser une zone entre deux lancements. La PWA installée
  par Sam vit dans son propre profil : les e2e ne la partagent pas ; ils en reproduisent le chemin (SW, zones, hors ligne).

### 5.7 L'observabilité

- **Une ligne de temps par cellule** : demandée, octets reçus, cuite, téléversée, publiée, vue. Les e2e mesurent le
  **temps avant visibilité**, les **trous** (pixels du sol sans leur niveau voulu, déjà mesurés par `tile-arrival`) et la
  **part du vol à voyant vert**.
- **Le voyant** distingue réseau inactif par choix (tout est là) et inactif par attente (cuisson). Le jaune devient « en
  cuisson » quand c'est le cas.

## 6. Fait le 6 novembre (lots ST0 et ST1)

- **Mesures** :
  - les phases fines de la scène ;
  - les secondes du voyant par état ;
  - les échecs réseau par source et réponse (`netLight.stats().failBy`) ;
  - `LBN_SCENERY` dans l'e2e d'approche.
- **Voyant rouge** : l'USGS borné à z 16 (`orthoZ1`), passé de 930 à 2 échecs.
- **Décor** : toits gardés d'une scène à l'autre (`planCache`) ; scène dépassée abandonnée sans tuer le worker (caches
  gardés) ; préchargement écrit puis éteint (doublons mesurés).
- **Zones** (ST1) :
  - Terrarium a sa propre chaîne sous les reliefs nationaux. Le jeu le demande toujours en premier ; la zone ne le
    gardait qu'en secours, d'où des tuiles qui échouaient hors ligne sous l'IGN, les USA et Mapterhorn.
  - Les rues de nuit z 12–13 et l'infrastructure Overture (`kerr-overture-base:`, résolue par le SW comme les bâtiments)
    sont ajoutées.
  - Mapterhorn est compté à part (`tileKind`), et les tailles des nouvelles sources sont estimées.
  - `ZONE_SCHEMA` 2 : une zone d'avant est signalée « à mettre à jour ».
  - `sceneryChains` inclut désormais le sol USA et l'infrastructure.
  - e2e `zones-usa-night` : la zone JFK téléchargée, puis volée de nuit hors ligne à travers la PWA.

## 7. Plan par lots

Chaque lot est mesuré par un e2e de vol avant/après : JFK de nuit, Paris à 900 m, Chamonix vol bas, en ligne et hors ligne.
Il est tenu dans GRAPHICS-PIPELINE (parcours joueur) et dans le journal.

| Lot | Contenu | Critère de passage |
|---|---|---|
| **ST0** — mesurer | phases, voyant, échecs par source (fait) ; temps avant visibilité par cellule ; trous ; part de vol à voyant vert | une planche par vol, chiffres reproductibles à ±10 % |
| **ST1** — zones complètes | sources ajoutées, `ZONE_SCHEMA`, e2e PWA USA de nuit (fait) ; ST1b : profil d'e2e persistant, tests des chaînes contre les requêtes réelles du worker | 0 tuile du sol ou du décor au réseau hors ligne, USA et France |
| **ST2** — ordonnanceur | `StreamScheduler` (priorité temps-avant-visibilité, budgets octets/ms, par hôte, annulation) ; relief, imagerie et rues d'abord | voyant vert ≥ 85 % d'un vol ; requêtes inutiles annulées ; aucune régression T8 |
| **ST3** — cellules | grille z 15 / z 13, clé de contenu, halo de bord ; le worker cuit une cellule à la fois (même code de cuisson, découpé) | un recentrage ne recuit que les cellules neuves ; temps de la première cellule visible < 3 s |
| **ST4** — pool de cuiseurs | 2–4 workers ; données brutes partagées ; service de hauteurs commun | débit de cuisson × 2 ou plus ; pas de saccade page (p95 boucle ≤ 5 ms) |
| **ST5** — pool GPU paginé | pages, BVH à deux niveaux, téléversements bornés, fondu par cellule ; mips d'imagerie regroupés ; `putTile` coalescés | aucun `writeBuffer` > 4 Mo par image ; pas de pic > 2 ms dû à la publication |
| **ST6** — cache cuit persistant | cellules dans la Cache API (LRU, zones), `COOKER_VERSION`, pré-cuisson à la fin d'un téléchargement de zone | revisiter un lieu : décor complet < 2 s ; hors ligne en zone : 0 cuisson |
| **ST7** — prédiction | sources de streaming : point prédit (vitesse, virage, AP, plan de vol, ILS), regard, réserve arrière | cellules prêtes avant d'entrer dans le champ dans 95 % des cas sur les vols de référence |
| **ST8** — HLOD lointain | super-cellules z 13 : boîtes à la hauteur, arbres en impostures, lumières de nuit ; au-delà de l'anneau proche | « charger plus loin » : la ville visible jusqu'à 10–15 km sans trou ni pop massif |
| **ST9** — tuiles raster | validité par tuile (masque) au lieu d'un rectangle ; décodage annulable et à priorités ; travail CPU des relevés IGN déplacé en worker | moins de tuiles « en attente » visibles ; p95 boucle stable |
| **ST10** — zones « cuites » | pré-cuisson et vérification d'intégrité des zones ; une zone d'aéroport complète (cœur détaillé, décor, nuit) en un clic | e2e par la PWA sur 3 zones (Paris, JFK, Chamonix) vertes hors ligne |

**Ordre conseillé** : ST0 → ST1 → ST2 (les gains les plus sûrs) → ST3 + ST6 ensemble (même clé de contenu) → ST5 → ST4 → ST7 →
ST8 → ST9 → ST10. ST4 et ST8 restent planifiés tant que les mesures n'en montrent pas le besoin, comme demandé par Sam.

## 8. Risques et limites

- **Mémoire** : le cache cuit et le pool GPU s'ajoutent au LRU des tuiles. Il faut un budget commun (réglage joueur) et une
  éviction par coût de refabrication.
- **Bords de cellules** : murs mitoyens, ponts et forêts doivent rester identiques à ceux de la scène monolithique. Tests de
  parité sur des emprises connues (Paris, Saint-Lô).
- **Quotas des fournisseurs** (IGN ~40 req/s par adresse, OpenFreeMap, Overture S3) : l'ordonnanceur doit garder les
  politiques actuelles (`geopf` du SW) et ne jamais les dépasser.
- **Compatibilité des zones** : `ZONE_SCHEMA` et `COOKER_VERSION` évitent qu'une zone ancienne sorte des données fausses ;
  une zone non mise à jour reste utilisable avec ce qu'elle a.
- **Non mesuré à ce jour** : le gain de chaque lot. Les critères ci-dessus sont des objectifs, pas des résultats.
