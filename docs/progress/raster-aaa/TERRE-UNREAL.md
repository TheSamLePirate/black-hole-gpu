# La Terre en raster « façon Unreal » — plan et suivi

Démarré le 25/10/2026. Demande : en raster, la Terre **à pleine résolution, chaque pixel ombré à chaque image** — plus de
taux ×2 / ×4 / ×16 ni d'échelle 0,5 — avec la qualité d'une vue convergée, sur le M1 de kerr-mini. Le traceur reste pour
la vue à l'arrêt (affinage), les photos et l'espace.

## Le constat (25/10)

Le « raster » d'aujourd'hui ne rastérise que la visibilité : chaque pixel du sol lance ensuite le code du traceur
(`shade` → `earthNear` → `earthLook` → `earthGround`), ~40 ms par Mpx sur un M1. Le gouverneur ne peut qu'en ombrer un
sur 16 à l'échelle 0,5 — un pixel neuf sur 64 à l'écran — et le reste est reconstruit et porté par l'historique : flou en
vol. `earthLook` est déjà différé en partie (nuages : passe en demi-résolution `clouds` ; air : table aérienne `apRead`) ;
le coût par pixel restant est dans :

1. la **marche du sol** depuis la distance raster (`earthMarchHinted`, et la marche entière en rasant) ;
2. le **parcours du décor** (`worldScenery` : bâtiments en BVH, arbres en grille, sculptés par sphere tracing) ;
3. **`earthGround`** : détail procédural du relief, normale fine, ombres (relief, décor, nuages), matériaux, surfaces OSM.

## L'architecture visée (comme Unreal)

| Aujourd'hui (par pixel, tracé) | Visé (raster) |
|---|---|
| Marche du sol depuis l'indice | La profondeur raster **est** la surface (maillage assez fin près) |
| Décor tracé | Bâtiments et arbres en maillages / instances, matériau à part |
| Ombres par rayons | Cartes d'ombre (relief, décor), nuages en carte |
| Imagerie filtrée à la main | Anisotrope (fait), mips |
| Détail procédural par pixel | Orthophoto + normale de la carte de relief |
| Air intégré | Table aérienne (déjà) |
| Nuages | Passe en demi-résolution (déjà) |
| 1 pixel sur 4–64 + historique | **Chaque pixel, chaque image** ; TAA pour l'antialiasing seul |

## Les phases

| Phase | Contenu | État |
|---|---|---|
| U0 | Mesurer ce que coûte chaque partie de `shade` à chaque pixel (Paris bas, mini) | en cours |
| U1 | Le sol léger à chaque pixel : sans marche, sans détail procédural, ombres en cartes ; taux 1, échelle 1 | fait |
| U2 | Le décor en raster : bâtiments (prismes déjà triangulés) et arbres (instances déjà) ombrés par un matériau simple | fait (1re version) |
| U3 | Ombres du décor en carte (cascades), plus de rayons d'ombre | à faire |
| U4 | Gouverneur : l'échelle et le taux retirés en raster ; le TAA à 1 échantillon par pixel | à faire |
| U5 | Le cockpit du F-35 allégé (~8 ms mesurés) | à faire |
| U6 | Finition : netteté (RCAS), comparaison avec la vue convergée, mini à 50 Hz | à faire |

Chaque phase : mesurée sur le mini (GPU par passe, img/s), une capture en vol au-dessus de Paris, un commit poussé, une
ligne ici.

## Journal

### 25/10 — avant le plan (3d359212)

Vol net en raster : noyaux du raster prêts avant les bits du décor, historique gardé quand le cache recuit, repli tracé
mesuré, orthophoto anisotrope, albédo par pixel accumulé. Voir [VOL-NET-2026-10-25.md](VOL-NET-2026-10-25.md).

### 25/10 — le détail par pixel coupé par défaut

L'échange d'albédo (`renderer.rasterDetail`) grainait le sol en mouvement et le tachait d'une image à l'autre ; à l'arrêt,
il s'emballait (vue noire, croix blanches — corrigé, 26176b7c). À chaque pixel ombré, l'image est propre sans lui : coupé
par défaut, gardé comme interrupteur.

### U0 — mesure (kerr-mini, Paris bas, chaque pixel, 1920 × 1080)

`RASTER_BENCH=1 RP_PLACE=paris-low RP_RATE=every bun test tests/e2e/raster-shade-ablation.e2e.test.ts` — le banc gèle
désormais le vol pendant les compilations (l'avion se posait sur le sol, train cassé). `shade` seul : **~161 ms** par image
(~80 ms par Mpx). Ce qu'on gagne en retirant une partie (deuxième mesure de chaque paire ; la première est faussée par la
compilation de la variante) :

| Retiré | gain |
|---|---|
| le décor | −51 ms |
| la marche des rayons rasants | −16 ms |
| le détail procédural du relief | −30 ms |
| les ombres du relief | −9 ms |
| les ombres du décor | −4,5 ms |
| la normale fine du relief | −3,5 ms |
| les matériaux proches, l'imagerie, les nuages | ~0 |

Même tout retiré, l'ombrage du sol par le code du traceur resterait à ~50 ms : régler le traceur ne suffit pas — il faut un
noyau de sol neuf.

### U1 — le sol à chaque pixel (`shadeLite`) — en cours

Nouveau point d'entrée `shadeLite` (trace.wgsl), un fil par pixel à pleine résolution, chaque image : la surface du maillage
raster (sans marche), sa normale depuis les distances des pixels voisins, l'imagerie anisotrope, la surface régionale, le
soleil et le ciel, les ombres lues dans les cartes (relief `sunShadowFar`, arbres et bâtiments `treeShadowAt` /
`buildingShadowAt`, nuages `cloudShadowAt`), l'air par la table aérienne, les nuages par la passe en demi-résolution, l'eau
OSM (Fresnel, ciel, reflet du Soleil). La mer et le décor restent à `shade`. `renderer.rasterLite` (vrai par défaut) pour
comparer.

Première mesure (ce Mac, M1 Max, Paris, chaque pixel) : **`earth lite (raster)` 0,6 ms** pour tout le sol — contre ~160 ms
pour `shade` sur le mini ; le reste de `shade` (le décor, la mer) 7,9 ms.

Vu en vol : bon ; deux défauts relevés et corrigés — les lacs sombres (l'eau OSM n'était que l'orthophoto) ; un saut des
ombres des arbres toutes les ~0,8 s (la carte d'ombre du décor, ±900 m, se recentre sur une grille de 128 m : lue jusqu'à
son bord, ses ombres y apparaissaient en bloc — estompées désormais de 550 à 750 m). Reste : les ombres proches du relief
(la carte ne compte que les reliefs au-delà de la portée de la marche de `shade`).

Le « blip » de chaque seconde (relevé image par image en vol) : (1) l'historique temporel coupé presque tout le temps
— le garde-fou de parallaxe (`taParallaxPx`, pensé pour les profondeurs approximatives des rayons clairsemés) le jetait, il
revenait par salves de quelques images ; sans lui chaque image est un seul échantillon décalé qui scintille — levé quand
`shadeLite` ombre le sol (sa profondeur est exacte), le poids d'un pixel frais porté à 0,3 (`RASTER_LITE_ALPHA` : au
1/16 d'avant, l'historique rééchantillonné sous l'avance brouillait le sol) ; (2) le flou de mouvement d'une image en
retard (pics à 45 ms et plus toutes les 0,5–1 s) deux à trois fois plus long — ramené à la durée d'une image habituelle
(`shutterShare`). Les pics eux-mêmes restent à trouver.

**La « bouillie » de tout le paysage, plusieurs fois par seconde** (attrapée en rafale de captures, puis par
`terrainRasterStats.rings` image par image) : les anneaux du relief au-delà du patch fin (153 m) tombaient de 6 à 0–2 pendant
une à trois images, toutes les 0,5–1 s — le cache du relief invalidait la cuisson d'un niveau dès que sa fenêtre se
recentrait mais n'en recuisait qu'un par image ; les anneaux au-delà d'un niveau en attente n'étaient pas dessinés, et tout
le lointain retombait dans les blocs tracés. Corrigé (system/terrain-cache.ts) : chaque niveau déplacé est recuit dans son
image (un uniforme par niveau), puis un niveau périmé par de nouvelles tuiles par image. Mesuré : 0 chute sur 1 033 images
de vol (une vingtaine en 15 s avant).

**Sur le mini (vol Paris, « chaque pixel », avant ce dernier correctif)** : la netteté du sol mesurée **2,2** (médiane, contre
0,8 avant U1), mais **9,4 img/s** : le réglage « chaque pixel » fait aussi ombrer à chaque pixel, par le vieux `shade`, les
bâtiments, les arbres et la mer — la moitié de l'écran au-dessus de Paris. C'est U2 (le décor en matériau raster) qui
rendra ce mode jouable sur le M1.

Le dernier blip (vu par l'utilisateur : « les légères différences entre deux images ») : le gouverneur d'échelle changeait la
résolution (0,5 ↔ 0,625) toutes les quelques secondes, l'historique rééchantillonné à chaque pas au poids d'un échantillon.
Avec `shadeLite`, l'échelle est tenue à celle du raster (`earthRasterScale`, main.ts). Mesuré sur 30 s de vol : aucun
changement d'échelle, l'historique toujours tenu, aucune chute d'anneau — mais 18 img/s à l'échelle 1 en « chaque pixel » sur
ce Mac : le décor par `shade` à chaque pixel (U2).

Reste : des images à plus de 45 ms (~2 par seconde), à attribuer.

### U2 — le décor en matériau raster (25/10)

- **Bâtiments** : leurs triangles (roof-mesh.ts, jusqu'ici dans la seule carte d'ombre) dessinés dans la visibilité raster
  (`meshVs` / `meshFs` : distance exacte, marque 3), après leurs boîtes. `shadeLite` les ombre : le toit d'après
  l'orthophoto désaturée (elle « penche » : sa couleur sur un toit est souvent la rue ou l'arbre voisin — zinc et ardoise,
  un cinquième de sa teinte), les murs en pierre, une teinte par îlot, des fenêtres (étages de 3,1 m, travées de 2,6 m sur le
  repère du décor) au verre sombre qui reflète le ciel ; leurs ombres par la carte, le point soulevé de 1,2 m et vers le
  Soleil (à 0,35 m, leurs propres triangles les mouchetaient). Les bâtiments sans triangles restent aux rayons de `shade`.
- **Arbres** : l'arbre désigné par le raster testé seul sur sa forme simple (`sceneryTreeLite` : sans la sculpture des
  couronnes, des bosses dans la normale à sa place ; la grille parcourue depuis lui s'il est manqué), son aspect de
  `forestLook`, la lumière à travers les feuilles ; les arbres sur fond de ciel restent à `shade`.
- Correction de U1 : les pixels des boîtes de bâtiments ne sont plus pris par `shadeLite` (il dessinait le sol à leur place).

Mesuré ici (M1 Max, Paris, 150 m, « chaque pixel », échelle 1, 839 × 596) : `earth lite` 5,2 ms (sol, bâtiments, arbres),
`shade` 9,8 ms (sans les triangles : 16,3) — il reste à `shade` les bâtiments sans triangles, la mer, les arbres sur le ciel
et surtout son lancement sur chaque pixel pour en rendre la plupart à `shadeLite`.

![U2 Paris](img/u2-paris.jpg)

### U2 — suite (25/10)

- Les boîtes des bâtiments à triangles retirées de la visibilité (`BOX_SKIP_MESHED`) : elles envoyaient aux rayons de
  `shade` les pixels au-dessus des toits en pente et le long des marges — `shade` 10,4 → 3,9 ms, 42 img/s à l'échelle 1 ici.
- Les arbres éclairés comme `windsockShade` les éclaire (six dixièmes du ciel, le dessous de la couronne dans son ombre, la
  lumière à travers les feuilles au bord contre le Soleil) : l'ombrage du sol les rendait jaunes et trop clairs.
- Un indicateur de compilation (un « thinking orb » et le nombre de compilations, sous le compteur d'images ;
  `data-pending` pour les tests).
- Mini, Paris, « chaque pixel » à l'échelle native (1920 × 1080), noyaux prêts : **5 img/s** avec le matériau comme avec
  l'ancien `shade` — à cette taille, ce n'est plus l'ombrage du sol qui limite : passes mesurées en cours.

#### Les passes sur le mini (Paris, 300 m, « chaque pixel », 1920 × 1080, noyaux prêts)

| Passe (calcul — fiables ; les passes de rendu du vaisseau et l'affichage se chevauchent sur Apple) | ms |
|---|---|
| `earth shade` (le décor par rayons : les bâtiments **sans triangles** — les lointains, tout l'horizon —, la mer, les arbres sur le ciel) | 53–96 |
| `earth lite` (sol, bâtiments à triangles, arbres) | 45–50 |
| visibilité raster · ciel tracé · cartes d'ombre | 7 · 7 · 3 |

Prochaines étapes : (1) les bâtiments sans triangles dessinés comme leurs boîtes pleines (toit plat) dans la visibilité,
au matériau — plus aucun bâtiment par rayons ; (2) `earth lite` à ~22 ns par pixel sur le M1 : mesurer ses parties (l'eau
OSM, qui parcourt des polygones à chaque pixel, en tête ; l'imagerie anisotrope ; les cartes d'ombre lues en 4 × 4) et les
alléger — viser quelques ns par pixel.

### U2c — plus aucun bâtiment par rayons, `earth lite` allégé, l'eau d'un seul tenant (25/10)

Mesure des parties de `shadeLite` (ce Mac, Paris, 150 m, chaque pixel, ~0,5 Mpx ; `TUNE_LITE`) : base 5,4–7,2 ms ; tout
retiré 0,66 ms ; les arbres — surtout la grille parcourue quand l'arbre désigné est manqué : **2,4 ms**, 40 % — en tête ;
l'eau OSM −0,5 ; l'imagerie −0,3 ; les cartes d'ombre ~0.

- La grille des arbres n'est plus parcourue sur un manqué (le sol là ; `TUNE_LITE` 256 pour la remettre) : rien de visible à
  la taille d'un pixel.
- Les bâtiments ont leurs triangles jusqu'à 2 000 m du centre du décor (`BUILDING_MESH_M`, 1 100 avant) ; au-delà, leurs
  boîtes sont dessinées **pleines** (toit plat, `boxSolidVs`) au matériau — les boîtes de marquage ne sont plus dessinées.
- L'eau : sa couverture franche (le bord du polygone seul adouci), une surface plate, un seul ton de fond éclairé par le
  Soleil non ombré, le ciel réfléchi selon l'angle de vue ; les ombres sur le reflet du Soleil seul.

Mesuré ici : `shade` **0,2 ms** (4–10 avant), `earth lite` 3,9 ms, visibilité 1,5 ms — 43 img/s à l'échelle 1.

![U2c](img/u2c-paris.jpg)

**L'eau, d'un seul tenant (vue de près)** : des bandes sombres en diagonale coupaient la Seine — peinte en rouge (`TUNE_LITE`
512), l'eau reconnue y montrait des lignes vides : `scenerySurface` garde la surface OSM du rang le plus haut, et une ligne
(un rail, une route en tunnel sous le fleuve) l'emporte sur un polygone. `sceneryWaterAt` parcourt désormais les surfaces
pour l'eau seule (polygones et cours d'eau en ligne, la plus forte couverture ; les îles d'un fleuve sèches, comme avant).

| Avant (l'eau reconnue en rouge) | Après |
|---|---|
| ![bandes](img/u2c-seine-bandes.png) | ![seine](img/u2c-seine.png) |

**Mini, Paris, « chaque pixel », 1920 × 1080, noyaux prêts (U2c)** : **8,9 img/s** (5 avant) ; `earth shade` hors du
classement (< 1,6 ms) ; `earth lite` 26 ms ; visibilité 7 ms, ciel tracé 7 ms, cartes d'ombre des arbres 3 ms ; le reste
dans les passes de rendu du cockpit et du vaisseau (MSAA à la pleine taille : leurs horodatages se chevauchent sur Apple,
~50 ms d'après leur somme). Suite : `earth lite` (26 ms sur le M1, ~13 ns par pixel), le cockpit à la pleine taille (U5).

### U2d — l'eau AAA : la mer, les rivières, les lacs, les cascades (25/10)

- **La mer** quitte `shade` : `shadeLite` prend tout le sol, la mer comprise, et l'ombre par `seaShade` — le shader d'eau du
  traceur, déjà complet : les trains d'ondes résolus et les cascades de la FFT près, le reflet du Soleil de Cox–Munk, le
  miroir moyenné sur les pentes non résolues (Bruneton), le monde reflété près (`seaSSR`), les nuages lointains, le fond peu
  profond, l'écume et le ressac.
- **Les rivières et les lacs** ont leur propre style (`inlandWater`), pas la mer calmée : quatre trains de rides
  capillaires-gravitaires autour du vent, chacun estompé sous l'empreinte du pixel (sa variance alors à la rugosité) ;
  rivière : rides courtes, étirées, eau trouble vert-brun ; lac : presque un miroir, des risées par plaques de 40 m, eau
  plus sombre. Le ciel par Fresnel sur la facette ridée, le monde reflété près, le reflet du Soleil (Beckmann). Une rivière
  se reconnaît à sa classe OpenMapTiles (`river`, `canal`, `stream`…), portée par la couleur de son polygone.
- **Les cascades** : là où le sol de l'eau penche (la normale du maillage à plus de ~16° de la verticale), une eau blanche
  aérée en traînées tirées dans la pente, qui la descendent avec l'horloge.

Mesuré ici (Paris, 60 m, chaque pixel) : `earth lite` 6,4 ms (+2,5 pour l'eau), `shade` 1,8 ms (les arbres sur le ciel).
Cascades non encore vues sur un vrai site.

| La Seine (rivière) | La mer à Tarifa |
|---|---|
| ![seine](img/u2d-seine-riviere.png) | ![mer](img/u2d-tarifa-mer.jpg) |

**La mer plate près de la côte, puis normale** : près des côtes, la mer vient des polygones OSM (classe `ocean`), que le
matériau prenait pour des lacs — presque un miroir — jusqu'à la portée du décor, au-delà de laquelle le masque de mer du relief
prenait le relais, en `seaShade`. Les polygones `ocean` sont désormais marqués (leur couleur, scenery-worker) et ombrés en mer.

| Avant | Après |
|---|---|
| ![plate](img/u2d-mer-plate-avant.jpg) | ![mer](img/u2d-mer-apres.jpg) |

**Le trait blanc à la frontière de la mer** (Tarifa) : l'effet cascade — la pente lue sur la normale du maillage, tirée des
pixels voisins — basculait à la couture de deux anneaux du relief (leurs maillages s'y rejoignent à leur tolérance près) : une
ligne d'eau blanche le long de la couture. Corrigé : la normale n'est plus prise à travers une couture d'anneaux ; les
cascades ne sont que pour l'eau intérieure. Au passage : le ressac et le fond visible de `seaShade` ne s'appliquent plus que
là où la bathymétrie est sûre (au bord de ses données, la profondeur moyennée sur quelques texels valides tombait au mètre).
Reste : une langue sombre près de la côte, là où la bathymétrie (Terrarium z 10 — ETOPO, GEBCO — ; SRTM met la mer à 0 près des
côtes) ne donne aucune profondeur et que la mer y est supposée profonde — une donnée à trouver (une bathymétrie côtière plus
fine) ; deux essais pour la masquer (l'imagerie de la mer — trop sombre, la mosaïque Sentinel peint la mer d'un ton
uniforme —, une profondeur devinée — une couture de plus) retirés.

Les compilations : un réglage de mesure (`renderer.tune`) recompile **tous** les noyaux de chaque clé (le traceur principal,
`shade`, `shadeMark`, `shadeLite`, le ciel, les nuages…) — plusieurs minutes ici ; `shadeLite`, qui porte désormais l'eau de
la mer, les rivières, les arbres et le décor, est devenu gros : à découper (l'eau dans son propre noyau).

| Avant (le trait, HUD masqué) | Après |
|---|---|
| ![avant](img/u2d-trait-avant.png) | ![après](img/u2d-trait-apres.png) |
