# Analyse — l'IGN et le LiDAR HD dans la Terre de Kerr

Date : **23 octobre 2026**. Base : `main` à `b30ad20a`. Laboratoire examiné : `../test-ortho-IGN-lidar` (Three.js
WebGPU, Paris et Saint-Jean-de-Valériscle, 4 × 4 km détaillés dans 12 × 12 km).

Statut : **analyse, aucune implémentation**. Les services IGN ont été interrogés le 23 octobre 2026 depuis ce Mac
(latences et formats ci-dessous mesurés) ; le rendu de Kerr n'a pas été relancé : ses coûts viennent de
[progress/raster-aaa/ETAPE-1.md](progress/raster-aaa/ETAPE-1.md). Les chiffres marqués *(estimation)* sont des calculs.

## 1. Verdict

**Oui, et c'est le plus gros gain visuel disponible pour le vol bas en France** — il vient des données, pas du moteur.
Le moteur de Kerr (air, nuages, lumière, ombres, raster + `shade`) est déjà au-dessus du labo ; ce qui manque au sol,
c'est la résolution de ce qu'il dessine : **relief SRTM 30 m complété de bruit procédural, imagerie Sentinel‑2 10 m**.
L'IGN donne **0,5 m de relief mesuré et 0,2 m d'orthophoto**, en accès libre, CORS ouvert, sous Licence Ouverte
(usage commercial permis — mieux que l'EOX actuel, CC BY-NC-SA).

Les données entrent **dans les deux chemins (raster et tracé) à la fois** : elles alimentent les mêmes tuiles
(`earth-tiles.ts`) que lisent `earthHeight*` (tracé) et le maillage raster. Mais pour voir le mètre en relief et non
seulement en couleur, **le raster est le chemin à développer** (maillage plus fin près de la caméra) ; le tracé
profite de l'imagerie et des normales sans rien changer.

Ordre recommandé : **géoïde d'abord** (§5, bloquant pour la règle WGS84), puis **orthophoto IGN** (le gain le plus
grand pour le moins de code), puis **relief**, puis **arbres et bâtiments réels**, enfin le **HLOD lointain par MNS**.

## 2. Pourquoi le labo est plus beau

| Couche | Kerr aujourd'hui | Labo IGN | Facteur |
|---|---|---|---|
| Relief | Terrarium z ≤ 14 (6,3 m le texel à Paris), **SRTM 30 m** dessous (`TILE_RES_MIN = 25`) + bruit procédural | MNT LiDAR HD 0,98 m au centre, 3,9 m dans le noyau | ×25–30 |
| Imagerie | EOX Sentinel‑2 cloudless 2021, **10 m** | BD ORTHO 0,49 m (0,24 m en Cinéma) | ×20–40 |
| Bâtiments | OSM (OpenFreeMap), hauteurs souvent absentes | BD TOPO : emprises + hauteurs mesurées ; toits par MNS 1 m | qualitatif |
| Arbres | ESA WorldCover 10 m → classe, hauteur tirée | MNH LiDAR (hauteur réelle du sursol) | qualitatif |

Le labo n'est pas réutilisable tel quel (Three.js, une scène bornée de 4 km, altitudes normales non converties,
préparation par WMS en EPSG:4326) : **sa valeur est la preuve des données et la cible visuelle**, pas son code.

## 3. Ce que l'IGN sert, mesuré le 23/10/2026

| Couche | Service | Résolution | Format | Accès | Latence (1 tuile 256²) |
|---|---|---|---|---|---|
| Orthophoto `ORTHOIMAGERY.ORTHOPHOTOS` | WMTS, **grille PM (Web Mercator)** z 0–19 | z 17 : 0,79 m, z 18 : 0,39 m, z 19 : 0,20 m à Paris | JPEG ≈ 11–16 Ko | CORS `*`, **aucune limite d'usage**, `max-age` 21 j | 0,35–0,42 s |
| RGE ALTI `ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES` | WMTS WGS84G z 6–14 / WMS-R | WMTS : 4,8 × 3,3 m ; WMS-R : à la demande | BIL float32 (deflate) | CORS `*` | 0,46 s (WMTS), 0,61 s (WMS-R) |
| MNS `…HIGHRES.MNS` | WMTS WGS84G z 4–17 | 0,6 m | BIL float32 | CORS `*` | 0,60 s |
| MNT / MNS / MNH LiDAR HD `IGNF_LIDAR-HD_*` | **WMS-R seulement** | natif 0,5 m | BIL float32 (non compressé, 256 Ko) | CORS `*`, **40 req/s par IP** | 0,53–0,77 s |
| BD TOPO (bâti, eau) | WFS (30 req/s/IP) ; tuiles vectorielles TMS (sans limite) | vecteur | GeoJSON / MVT | CORS | — |

Vérifié : **le WMS-R accepte `CRS=EPSG:3857` sur la boîte exacte d'une tuile de Kerr** (testé z 17 à Paris, LiDAR
25,8–36,9 m, RGE ALTI 26,9–36,6 m) : une requête = une tuile du clipmap, sans reprojection dans le worker.
Le navigateur décode seul le `Content-Encoding: deflate` du WMTS.

Couverture LiDAR HD : l'objectif IGN est la métropole entière fin 2026 ; des trous subsistent (le labo les signale,
`LIDAR_NODATA`). **Le RGE ALTI couvre tout le territoire** : c'est le repli naturel, le SRTM au-delà des frontières.

Quota : la Géoplateforme annonce 1 To de trafic par an en offre gratuite ; à qui il s'applique sans clé (par IP,
par application) **n'est pas établi** — à vérifier auprès de l'IGN avant une diffusion large.

## 4. Où chaque couche entre dans Kerr

### 4.1 Orthophoto → `earth-tiles.ts` (le gain immédiat)

L'imagerie de Kerr est **déjà en tuiles Web Mercator par niveau** (GIBS ≤ z 8, EOX z 9–14). L'IGN est la même grille :
une troisième source par niveau, choisie quand la tuile est en France (emprise de couverture + test « image vide »,
comme le labo). À ajouter :

- **Niveaux z 15–18** au‑delà de `Z1 = 14` (`LEVELS`, `TILE_PARAM_VEC4S`, tables du traceur). Un niveau de plus :
  une couche 1024² rg32uint, **8 Mio** (32 Mio en portée `far`). z 15–18 : 32 à 128 Mio *(estimation)*. Hors de
  France, ces niveaux restent vides et rien ne change.
- **Le recalage colorimétrique** : l'ortho IGN (saturée, ombres photographiées, millésimes en mosaïque) ne ressemble
  ni à l'EOX ni au Blue Marble. Même méthode que `EOX_FIT` : un ajustement par canal mesuré sur des lieux témoins,
  et un fondu sur 1–2 niveaux pour éviter une couture au bord de la couverture.
- **Les ombres photographiées** : le §4.2 de [ANALYSE-PIPELINE-TERRE-AAA.md](ANALYSE-PIPELINE-TERRE-AAA.md)
  s'applique dix fois plus à 0,5 m (chaque bâtiment, chaque arbre a son ombre peinte). Atténuer les basses
  luminances de l'ortho là où le décor dessine déjà ses ombres.

**Fait le 23/10 (I1).** Quatre niveaux d'imagerie seule z 15–18 (fenêtres de 4 × 4 tuiles, dans des quadrants de
1024² de couches de plus de la texture des tuiles, placés par la table du traceur `TABLE_ORTHO`) ; en France, les niveaux
du relief z 9–14 prennent aussi l'ortho IGN au lieu de l'EOX (net jusqu'aux 6–20 km de leurs fenêtres). Recalage
mesuré sur douze lieux : une courbe de tonalité sur la luminance L′ = 0,811·L^1,475 et des gains de couleur
(0,82 ; 1,10 ; 0,39) estompés sur les surfaces claires (moyennes à 4 % de celles du jeu, le blanc neutre).
L'imagerie IGN passe devant la couche régionale à 10 m et coupe sous elle les matériaux dessinés et les routes OSM
peintes. Réglage « Photographies aériennes (France) », mention « © IGN BD ORTHO · Licence Ouverte 2.0 » à l'écran
quand elles sont dessinées, dans le panneau et l'Atlas ; tuiles gardées par le PWA. Coût mesuré sur kerr-mini : aucun
écart de FPS sensible (dans le bruit). Leçons des e2e : le « flou » des premières captures venait de l'imagerie IGN
cachée sous la couche régionale à 10 m, du repli du raster en tracé (sur le M1 du mini, le régulateur abandonne le
raster pendant les chargements) et d'images prises avant convergence — pas du débruiteur (vérifié : il ne tourne
qu'en image accumulée, où le sol est tracé, pas en raster).

Débit en vol bas *(estimation)* : à 150 m/s, une rangée de 4 tuiles z 17 (200 m) toutes les 1,3 s, ≈ 3 tuiles/s
par niveau, ≈ 15 Ko chacune : **< 0,2 Mo/s** pour toute l'imagerie fine. Latence 0,4 s : `MAX_INFLIGHT` (8) à
augmenter et l'anneau d'avance (`ring`) utilisé dès la portée normale.

### 4.2 Relief → tuiles de hauteur, puis maillage raster

Les hauteurs vont dans les mêmes couches (le canal hauteur de chaque tuile). Source par niveau en France :
RGE ALTI (WMS-R 3857) jusqu'à z 15, **LiDAR HD MNT (WMS-R 3857) z 16–17** près de la caméra.

Trois changements nécessaires :

1. **`TILE_RES_MIN` par source** (25 m aujourd'hui, en dur dans `earth-tiles.ts:44` et `trace.wgsl:5439`) : 1 m sur
   une tuile LiDAR. Sans cela le traceur continue de croire la donnée à 25 m et de la recouvrir de bruit.
2. **Le bruit procédural s'efface là où la donnée est fine.** C'est aussi un **gain de performance** : le détail
   procédural coûte **5,4–7,4 ms** dans `shade` (ETAPE-1, `TUNE_DETAIL` 0). Une donnée mesurée lue en une lecture
   remplace une somme d'octaves.
3. **Le maillage raster plus fin.** Le cache de surface (`terrain-cache-layout.ts`) a son niveau le plus fin à
   `2^22` nœuds par tour, **9,5 m**, sur 129 nœuds (1,2 km). Pour voir des talus, fossés, murets en géométrie :
   deux ou trois niveaux de plus (2,4 m, 1,2 m, éventuellement 0,6 m), et des **normales lues à 0,5 m** pour le reste
   (la normale actuelle à trois lectures de hauteur coûte ≈ 0 ms d'après l'ablation). 129² nœuds par niveau : la
   mémoire est négligeable ; le coût est dans la passe de visibilité (≈ 4,6 ms aujourd'hui), à mesurer.

**Fait le 23/10 (I2).** En France (réglage « Relief IGN (France) »), les niveaux z 11–14 prennent leurs hauteurs à
la RGE ALTI au lieu de Terrarium, et trois niveaux de relief de plus, z 15–17 (3,2 → 0,8 m le texel ; fenêtres de 4
tuiles), viennent de l'IGN seul — le LiDAR HD dès z 16, la RGE ALTI dans ses trous ; là où l'IGN n'a rien (en mer, à
l'étranger), Terrarium (au-delà de son z 15, agrandi). Une requête WMS-R en EPSG:3857 par tuile ; les valeurs que la
RGE ALTI rééchantillonne le long des côtes (jusqu'à −856 m) écartées sous −100 m. La source de chaque hauteur est
dans le dernier bit de son flottant (Terrarium ne l'emploie jamais : ses k/256 tiennent sur 22 bits) : le CPU
(`heightAt`) et le traceur (`tileFine`) en tirent la résolution de la donnée — 1 m pour l'IGN, 25 m pour le reste —,
qui efface le détail procédural plus fin que le relevé. Mesuré à Étretat sur kerr-mini : la falaise à 84° de pente
au lieu de 59°, la résolution de 1,2 m au lieu de 25 m. Pas fait : le maillage raster garde ses niveaux à 9,5 m (le
relief fin n'y est que dans l'ombrage et les intersections affinées, pas dans les silhouettes : I3).

**Fait le 23/10 (I3).** Le cache de surface du raster a deux niveaux de plus, nœuds à 1,2 et 2,4 m
(`TERRAIN_CACHE_ROUNDS` : 2²⁵, 2²⁴, puis 2²² … 2¹², pas par 4) ; le patch se pose sur le plus fin (réglage
`earthTerrainRasterLevel`, 0 par défaut, 155 m de côté) et les niveaux plus grossiers l'entourent en anneaux jusqu'au
niveau 6 (nœuds de 2,4 km) — le trou de chaque anneau au rapport de pas de son voisin (×2 entre 0 et 1, ×4 ensuite).
La tolérance du repère de distance et la cadence réduite des anneaux restent comptées depuis le niveau 4 : les
anneaux 1–4 sont traités comme l'ancien patch. Les normales lisent le relevé dans sa propre grille (`earthSlopeFine` :
le niveau valide le plus fin, texel ≤ 10 m, différences centrées à l'empreinte du pixel, jusqu'au demi-mètre de z 17)
là où l'empreinte passe sous 10 m. Mesuré à Étretat sur kerr-mini (e2e `raster-fine-relief`, vue tenue, mêmes pixels —
échelle 0,75, ombrage un sur deux —, niveau 4 / 0 / 4) : passe de visibilité 1,39 → 1,61 ms (1,38 au retour, soit
**+0,22 ms**), ombrage raster 108,3 → 105,0 ms (−3 % : le repère plus juste raccourcit la marche). Limites : les
directions des nœuds cuites en f32 (≈ 0,4 m à la surface) bruitent un peu le niveau 1,2 m ; les découpes des pistes
ne se font que dans le patch (155 m désormais), les anneaux sont des grilles simples.

Débit *(estimation)* : 256 Ko par tuile non compressée en WMS-R, ≈ 1,5 Mo/s en vol bas à 150 m/s sur z 15–17 :
acceptable sur fibre, lourd en 4G — quantifier à 16 bits (cm) dans le worker avant le cache PWA, et réserver
z 17 au‑dessous de ≈ 1 500 m de hauteur sol. 40 req/s par IP : large pour un joueur (8–16 en vol), **pas pour un
relais serveur commun** — chaque navigateur doit interroger l'IGN lui-même.

### 4.3 Forêts → MNH dans `forest.ts`

Le worker décide la hauteur de chaque cellule de 7 m (`FOREST_CELL`). En France, **la lire dans le MNH** (et la
présence : MNH > 2 m hors bâti BD TOPO et hors eau, comme le labo) au lieu du tirage depuis WorldCover : lisières,
haies du bocage, ripisylves, clairières à leur vraie place. Coût GPU nul (même mot de 32 bits) ; une requête MNH
par tuile de forêt dans le worker.

### 4.4 Bâtiments → BD TOPO dans la scène

`scenery-data.ts` prend OSM. En France, BD TOPO donne **les hauteurs mesurées** de presque tout le bâti (le labo :
26 675 parties sur 4 × 4 km à Paris) ; les tuiles vectorielles de la Géoplateforme évitent la limite du WFS. Les
toits par MNS (le labo en fait 280 à Paris) sont un raffinement ultérieur, pas une priorité.

## 5. Le préalable : le géoïde

**Kerr n'a pas de géoïde** (`AAA-PROGRESS.md` 2.8 : « le niveau de la mer est l'ellipsoïde, à ±100 m près »).
Les hauteurs Terrarium (EGM96) et IGN (altitudes normales IGN69) sont donc posées comme des hauteurs ellipsoïdales :
**le sol de la France est dessiné ≈ 45–55 m trop bas** par rapport aux positions WGS84 (le trafic ADS-B en hauteur
géométrique, un GNSS, la règle de `CLAUDE.md`).

À 30 m de résolution cette erreur se voyait peu ; avec un sol mesuré au décimètre, elle devient l'erreur dominante
(avions réels 50 m trop hauts au-dessus des pistes, ILS, contact). Correction proposée :

- une grille **EGM2008** (2,5′, quelques Mo) appliquée à Terrarium, à l'IGN et **à la mer** (la mer est sur le géoïde) ;
- l'IGN converti au même géoïde (l'écart IGN69/EGM2008 est de l'ordre du décimètre en métropole *(à mesurer)* ;
  la grille RAF20 de l'IGN si l'on veut mieux) ;
- les pistes, aéroports, sites et vols de référence revérifiés (ils sont nivelés sur le relief, donc suivent).

C'est un changement transversal mais borné ; il vaut pour toute la Terre, pas seulement la France.

**Fait le 23/10 (I0).** La grille EGM2008 à 15′ (`assets/earth/geoid-egm2008-15.bin`, 0,92 Mo, construite par
`scripts/build-geoid.py` depuis la grille 5′ de GeographicLib ; 7 cm rms, 2,5 m au pire) est lue de la même façon
par le CPU (`src/system/geoid-grid.ts`) et par le traceur, où elle occupe 4 Mo de sa table (`TABLE_GEOID`,
`trace.wgsl geoidN`). Les données restent des altitudes au-dessus de la mer — le détail procédural, les pistes
nivelées, le cache de surface les lisent ainsi — et N s'ajoute à la sortie : `earthHeightSampler` (CPU),
`earthHeightG`/`earthHeightStep` et le maillage raster (GPU), le décor par un plan du géoïde envoyé au worker. La
mer est la surface h = N (ombrage, vagues, reflets). Les positions restent ellipsoïdales ; les altimètres (HUD,
PFD de l'A320, PCD du F-35), `geoNow().alt` et les tenues d'altitude des pilotes automatiques sont au-dessus de la
mer (`seaAltitudeOver`). Les navires flottent à N ; l'ADS-B barométrique est relevé de N. Non fait : l'atmosphère
standard lit encore la hauteur ellipsoïdale (±0,5 % de densité) ; les étiquettes du trafic montrent sa hauteur
géométrique.

## 6. Raster ou tracé ?

| | Tracé | Raster + `shade` (défaut actuel) |
|---|---|---|
| Ortho IGN | gagne tout de suite (lecture d'imagerie au point touché) | idem |
| Relief fin en couleur et normales | oui | oui |
| Relief fin en géométrie (silhouettes, talus) | marche plus longue sur des données plus fines (pas plus petits, plus de lectures) | **maillage plus fin, coût borné** |
| Bruit procédural retiré | −5 à −7 ms | −5 à −7 ms |

**Le raster est le bon chemin pour la géométrie fine ; les données servent les deux.** Le tracé reste le repli et
la référence (`earthPipeline: "trace"`), sans travail spécifique.

## 7. Mieux encore

1. **Le HLOD lointain des villes et forêts par le MNS.** Le §4.5 de l'analyse AAA note qu'il n'existe pas de
   représentation collective lointaine : les arbres s'arrêtent à 2,5–7 km, le bâti BVH aussi. Le **MNS (0,6 m en
   WMTS)** est exactement cette représentation : au-delà de la portée du décor, lire le sursol `MNS − MNT` comme un
   relief de plus (une hauteur par texel, déjà dans le chemin des tuiles) donne les silhouettes de Paris et des
   massifs forestiers jusqu'à l'horizon, pour le prix d'une lecture. Valable partout où un MNS existe.
2. **Une interface « source nationale », pas un cas IGN.** Les mêmes trois couches existent ailleurs, ouvertes :
   **swisstopo** (swissALTI3D 0,5 m, SWISSIMAGE 0,1 m — les Alpes côté Suisse, là où Kerr teste d'abord),
   Espagne (PNOA 0,25 m, LiDAR 2 m — Tarifa), Pays-Bas (AHN 0,5 m), États-Unis (3DEP 1 m, NAIP 0,6 m — Kennedy,
   Edwards). Une source = une emprise, des URL par niveau, une résolution native, un géoïde, une attribution.
3. **Des packs préparés pour les lieux joués** (aéroports, Chamonix, Paris) : LiDAR 0,5 m pré-tuilé, quantifié,
   compressé, hébergé avec le jeu — pour le hors-ligne PWA et pour ne pas dépendre de la latence du WMS-R au roulage.
   La France entière à 0,5 m ne s'héberge pas (≈ 2 × 10¹² points, plusieurs To même compressés *(estimation)*) : le
   streaming direct depuis l'IGN reste la règle.

## 8. Risques

| Risque | Mesure |
|---|---|
| Couleurs et millésimes de l'ortho en mosaïque, nuages ponctuels | ajustement par canal, fondu entre niveaux, repli EOX sur tuile vide ou incohérente |
| Ombres photographiées + ombres dynamiques (double ombre) | atténuation des basses luminances sous le décor dessiné |
| Trous LiDAR HD | repli RGE ALTI puis Terrarium, par tuile ; jamais de terrain inventé |
| Couture de hauteur au bord de la France | même géoïde des deux côtés, fondu des hauteurs sur une tuile |
| Dépendance au service IGN (panne, quota non établi) | cache PWA, packs des lieux joués, repli mondial intact |
| Coût de la visibilité raster avec des niveaux plus fins | mesuré par `raster-flight` avant/après ; niveaux fins limités en hauteur sol |
| Attribution | « © IGN — Licence Ouverte 2.0 » dans le panneau, l'Atlas et l'aide, comme l'EOX |

## 9. Zones hors ligne : pré-cacher une région dans le PWA

**Possible, et une bonne idée — pour des zones bornées (5 à 50 km de rayon), pas pour la France entière.**

### 9.1 Pourquoi

- **La latence de l'IGN** : 0,35–0,8 s par tuile, contre un S3 plus rapide pour Terrarium. En vol bas, une tuile fine
  arrive après que le sol est déjà sous l'avion. En zone pré-cachée, le service worker répond depuis le disque : le
  détail est là dès la première image.
- **Le hors ligne promis par le PWA** (PLAN-MONDE M1) : aujourd'hui seule la dernière scène jouée l'est, au hasard
  du LRU.
- **Les tests** : un e2e sur une zone pré-cachée, réseau coupé ensuite, ne dépend plus d'Internet. C'est
  précisément la cause des blocages de kerr-mini quand le Wi-Fi tombe.
- **Le jeu en réseau** : chacun a le même sol, chargé d'avance, au départ d'un vol commun.

### 9.2 Ce qui existe

[sw.ts](../src/sw.ts) et [pwa/rules.ts](../src/pwa/rules.ts) : un cache `kerr-tiles-v1` **en cache-first, LRU
sous 300 Mo** (`TILE_BUDGET`), avec un index en IndexedDB (URL, dernier usage, taille). Il couvre Terrarium, GIBS,
EOX, OpenFreeMap, WorldCover (Terrascope), `earth-surface/`, `runways/` et les tuiles OSM de la carte. Le service
worker répond déjà aux messages `stats` et `clear-tiles` (`__bh.pwa`), mais **aucun écran ne les montre**. Les
Réglages ont huit onglets, construits depuis le schéma ([ui/settings/player.ts](../src/ui/settings/player.ts)).
`navigator.storage.persist()` n'est jamais appelé.

### 9.3 Volumes *(estimation, à 46° N)*

Ortho à 13–20 Ko la tuile (mesuré). Relief en WMS-R à 256 Ko la tuile en float32 brut ; quantifié sur 16 bits
puis compressé, ≈ 80 Ko *(à mesurer)*. Téléchargement avec 8 requêtes en parallèle à 0,45 s chacune.

| Profil | Rayon | Niveaux (image / relief) | Tuiles | Brut | Relief quantifié | Durée |
|---|---|---|---|---|---|---|
| Aéroport, roulage | 5 km | z 18 / z 17 | ≈ 11 600 | 0,7 Go | **≈ 0,3 Go** | ≈ 11 min |
| Vol bas | 20 km | z 17 / z 16 | ≈ 46 000 | 2,7 Go | **≈ 1,2 Go** | ≈ 45 min |
| Vallée, massif | 50 km | z 16 / z 15 | ≈ 72 500 | 3,8 Go | ≈ 2 Go | ≈ 70 min |
| Région, survol | 100 km | z 15 / z 14 | ≈ 72 500 | 2,0 Go | ≈ 1,5 Go | ≈ 70 min |
| France entière | — | z 15 / z 14 | ≈ 1,3 M | 36 Go | ≈ 25 Go | ≈ 20 h |

Conclusions : la quantification du relief est indispensable, puisqu'il pèse 80 % du brut. Une zone de vol bas tient
dans les quotas des navigateurs : Chrome accorde à une origine jusqu'à ≈ 60 % du disque, Safari et Firefox des
fractions comparables une fois le stockage persistant. **La France entière n'est pas proposée.**

### 9.4 Contraintes

- **Les URL doivent être exactement celles du jeu.** Le service worker cherche une tuile par son URL. La liste de
  la zone doit donc sortir des **mêmes fonctions** que `earth-tiles.ts` (`tileUrl`, `eoxUrl`, futures URL IGN) et
  des mêmes règles de niveaux, dans un module pur et testé.
- **Les zones ne sont pas évincées par le LRU.** Il faut un second cache `kerr-zones-v1`, avec son index
  zone → URL, hors `TILE_BUDGET`, que `tile()` consulte en premier. Une tuile partagée par deux zones n'est stockée
  qu'une fois et n'est retirée qu'avec la dernière zone qui la contient.
- **Le stockage persistant** : `navigator.storage.persist()` est demandé au premier téléchargement de zone. Sans
  lui, le navigateur peut tout effacer sous pression d'espace. Safari efface en plus les données d'un site non
  installé après 7 jours sans visite : **installer le PWA** est à conseiller sur l'écran.
- **Le jeu passe avant le téléchargement.** Celui-ci se suspend quand le streaming du jeu a des tuiles en attente
  (vol bas, arrivée sur un lieu). Il se reprend d'où il s'est arrêté, car l'index sait ce qui est déjà là. Il
  respecte la limite de 40 req/s du WMS-R et recule sur une réponse 429.
- **En arrière-plan** : l'API Background Fetch (Chrome seulement) permettrait de continuer page fermée. À traiter
  comme une option plus tard. Le cas normal est un téléchargement pendant que le jeu est ouvert, titre compris.
- **Ce qui ne se télécharge pas** :
  - les tuiles **OSM** de la carte tactique : leur politique interdit le hors ligne et toute récupération anticipée ;
  - l'**EOX** en masse : EOX vend un produit hors ligne (GeoPackage), et l'usage en masse de ses tuiles gratuites
    n'est pas établi. En France, l'IGN le remplace ; ailleurs, c'est à vérifier avant de l'inclure.
  - L'IGN (WMTS sans limite d'usage, WMS-R à 40 req/s), GIBS, Terrarium et OpenFreeMap n'interdisent pas ce
    téléchargement.
- **Les millésimes changent** : une zone garde la date de son téléchargement, et « Mettre à jour » la refait.
  L'ortho IGN se renouvelle par département tous les 3 ans environ.

### 9.5 L'écran : Réglages › Hors ligne

Un neuvième onglet, **Hors ligne**. Il n'est pas construit depuis le schéma : c'est un panneau sur mesure, qui garde
le focus, la navigation à la manette, les invites et le français/anglais du menu.

- **Stockage** : ce qui est utilisé et le quota (`navigator.storage.estimate()`), si le stockage est persistant,
  avec un bouton pour le demander, et le conseil d'installer le PWA.
- **Cache automatique** : sa taille, son budget à choisir (300 Mo, 1 Go, 3 Go), un bouton « Vider ».
- **Zones** : une ligne par zone avec son nom, son profil, son rayon, sa taille, sa date et ses sources. Actions :
  « Voir sur la carte », « Mettre à jour », « Supprimer ». Une zone en cours affiche sa progression, avec
  « Suspendre », « Reprendre » et « Annuler ».
- **Ajouter une zone** : le lieu se choisit avec le sélecteur de l'écran À pied
  ([ui/title/foot.ts](../src/ui/title/foot.ts) : destinations de l'Atlas, adresse, coordonnées), ou « la position
  actuelle » depuis la pause. Le profil se choisit parmi Aéroport, Vol bas et Survol, et le rayon est réglable. **Le
  nombre de tuiles, la taille et la durée estimées sont montrés avant de lancer**, avec la place libre. Puis le
  bouton Télécharger.
- **Raccourci** : dans la pause, tiroir Monde, « Garder cette zone hors ligne ».
- Distances en km ou en NM selon `unitsFor()`, tailles en Mo/Go ; textes en français et en anglais.
- Automatisation : `__bh.pwa.zones` (liste, ajout, progression, suppression) pour les e2e et TARS.

## 10. Plan proposé

| Étape | Contenu | Mesure de réussite |
|---|---|---|
| **I0** — fait (23/10) | Géoïde EGM2008 (sol, mer, IGN) — `src/system/geoid.ts`, la table du traceur, `seaAltitudeOver` ; voir §5 | vols de référence et atterrissages inchangés à l'issue près ; trafic ADS-B posé sur les pistes |
| **I1** — fait (23/10) | Ortho IGN z 15–18 dans `earth-tiles.ts`, recalage couleur, attribution — et l'imagerie des niveaux z 9–14 prise à l'IGN en France ; voir §4.1 | captures A/B Chamonix, CdG, Paris en cockpit ; FPS inchangé (`raster-flight`) |
| **I2** — fait (23/10) | Hauteurs RGE ALTI + LiDAR HD (WMS-R 3857), `TILE_RES_MIN` par source, bruit effacé — voir §4.2 | `shade` −5 ms attendu en France ; aucune couture au bord |
| **I3** — fait (23/10) | Niveaux fins du cache de surface (2,4/1,2 m) et normales à 0,5 m — voir §4.2 | passe de visibilité mesurée, cible ≤ +2 ms : +0,22 ms |
| **I4** | MNH → forêts | captures de lisières/haies contre l'ortho |
| **I5** | BD TOPO → bâtiments | hauteurs comparées au MNS sur un quartier |
| **I6** | HLOD lointain par `MNS − MNT` | silhouette de Paris à 20 km ; coût d'une lecture |
| **I7** | Interface de source nationale ; swisstopo ensuite | Alpes suisses au même niveau |
| **I8a** | Zones hors ligne, le socle : module pur `zoneTiles` (mêmes URL que le jeu, testé), cache `kerr-zones-v1` hors LRU dans le service worker, `storage.persist()`, téléchargement suspendable et repris, priorité au streaming du jeu, `__bh.pwa.zones` | test unitaire « URL de la zone = URL demandées en vol » ; e2e : zone de 5 km pré-cachée, réseau coupé, vol sans aucune requête de tuile et sol complet |
| **I8b** | Réglages › Hors ligne : stockage, cache automatique, liste des zones, ajout avec estimation, progression ; raccourci dans la pause ; FR/EN | e2e à la souris et à la manette ; captures de l'onglet |
| **I8c** | Relief quantifié sur 16 bits et compressé dans le cache (en vol aussi) | taille par tuile mesurée (cible ≈ 80 Ko) ; hauteurs identiques au centimètre |

I1 seul apporte déjà l'essentiel de ce qui frappe dans le labo (le sol photographié à 0,5 m) ; I2–I3 donnent le
relief ; I0 est indispensable avant de faire voler du trafic réel sur un sol mesuré. **I8a–b peuvent se faire dès
la fin d'I1** : ils servent aussi les sources actuelles (Terrarium, GIBS, OpenFreeMap), et I8c suit I2.

## 11. Sources

- [Limites d'usage des API Géoplateforme](https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/limites-d-usage/) — WMTS sans limite, WMS-R 40 req/s, WFS 30 req/s.
- [CGU cartes.gouv.fr](https://cartes.gouv.fr/cgu/)
- [MNT LiDAR HD (data.gouv.fr)](https://www.data.gouv.fr/datasets/mnt-lidar-hd) — dalles 1 km, pas 0,5 m, objectif 2026.
- [Atelier Géoplateforme (OpenIG)](https://openig.org/sites/default/files/2024-11/Atelier_Geoplateforme.pdf) — 1 To/an en offre gratuite.
- [Atelier LiDAR 2025 (OpenIG)](https://www.openig.org/sites/default/files/2025-12/IGN-ATELIER%20LIDAR-2025.pdf)
- `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetCapabilities` — couches, grilles et zooms lus le 23/10/2026.
- [Politique d'usage des tuiles OSM](https://operations.osmfoundation.org/policies/tiles/) — hors ligne et récupération anticipée interdits.
- [EOX cloudless, usage](https://cloudless.eox.at/documentation/usage) — le hors ligne vendu en GeoPackage.
