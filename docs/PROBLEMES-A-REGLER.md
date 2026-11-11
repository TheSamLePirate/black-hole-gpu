# Problèmes à régler

Problèmes constatés, pas encore réglés. Chaque entrée : la date (UTC), ce qui est mesuré ou observé et sa source, la cause
connue ou supposée, la piste. Une entrée réglée est barrée avec le commit qui la règle, pas effacée.

## ~~Des rectangles turquoise sur l'eau peu profonde devant l'Almanarre~~ — réglé le même jour : les blocs JPEG de l'orthophoto (8 × 8 pixels, 1,6 m) sur l'eau calme, lus de près sous huit empreintes du pixel seulement, le seuil du turquoise les découpant ; l'albédo du fond lu sur 3,2 m au moins (`shadeLite`, eau peu profonde) ; planche `docs/progress/mer/turquoise-avant-apres.png`. (Les diagnostics « albédo nul » plus bas avaient été pris pendant la recompilation : faux.)

**2026-11-11T08:50Z.** Observé (ce Mac, vue à 20 m au-dessus de l'eau devant la plage, regard −40° vers l'ouest ; planche
`docs/progress/mer/turquoise-rectangles.png`, trois instants) : des taches turquoise rectangulaires, à bords en marches de 1–3 m, fixes,
sur l'eau de 0–0,3 m — le turquoise des hauts-fonds (l'albédo du fond lu par `shadeLite`, `accum` w = 2) ouvert par endroits seulement.
Cause non cherchée ; pistes : les texels de la décision « fond visible » (l'orthophoto, ses huit empreintes) ou de la bathymétrie.
**Repris (même jour)** : ce n'est pas le seuil de `seaShade` (`smoothstep(0,05, 0,12)` élargi à 0,03–0,2 : rectangles à peine
adoucis — essai annulé) ; **c'est l'albédo lu sous l'eau qui est en blocs** (`shadeLite`, eau peu profonde : `earthImageryAniso` à 8
empreintes, `accum` w = 2). L'orthophoto y est filtrée par le matériel (`orthoGrad`) ; les blocs viennent donc vraisemblablement du
repli sur l'imagerie des tuiles du relief (`tileImgAt`, des entiers lus texel à texel) là où la couverture de l'orthophoto manque à ce
niveau, ou du bord de ses fenêtres (`smoothstep(2, 48, d)`). Suite : sortir `im.o` (la part de l'orthophoto) sur cette vue.
**Corrigé du point précédent (même jour, diagnostic temporaire)** : sur ces pixels l'albédo de l'eau peu profonde est **nul** — ils ne
passent pas par ce chemin (eau profonde au sens de la bathymétrie, sortie anticipée) : le turquoise n'y vient donc pas du fond vu. Et
la règle LiDAR du jour (`LIDAR_SEA_TRUST_M`) n'y est pour rien (A/B : identique désactivée). Restent : des pixels classés terre
(l'orthophoto de l'eau turquoise dessinée comme sol), ou la couleur de l'eau par région (Kd490) — à départager par `liteSkip` 1 (l'eau
du raster) sur cette vue.
**Encore (même jour)** : `rasterColumn` à 30 % de la largeur — les lignes des rectangles et l'eau autour portent **la même marque**
(4·10³⁰) et la même distance (11–15 m) : le même noyau, l'eau. Le turquoise naît donc dans l'ombrage de l'eau, pas d'un sol mal classé.
L'essai suivant (la vue de débogage des sillages, `TUNE_GSKIP` 32768) a été pris pendant la recompilation : non concluant. Reste à
couper une à une, une fois compilées, les sources de couleur de `seaShade` (sillages et bulles, Kd490, ciel reflété, SSR).
**Coupées une à une, compilées (ce Mac, 20 s d'attente chacune)** : sillages et bulles (vue de débogage `TUNE_GSKIP` 32768 : noire —
aucun), SSR (4096), ciel reflété (512), nuages reflétés (16384), ombres du Soleil (`liteSkip` 4096), ombres de contact (16384),
ombre de l'appareil (2097152) : **les rectangles restent à chaque fois**. Le diagnostic « albédo du fond nul » plus haut a pu être pris
pendant une recompilation (comme celui des sillages) : **suspect principal, à revérifier compilé** — la classification de l'eau peu
profonde dans `shadeLite` (`liteWater` : `wat.x ≥ 0,999` et `wat.y ≤ 0` → l'albédo de l'imagerie dans `accum`, w = 2, qui ouvre le
turquoise de `seaShade`), décidée par cellules (profondeur, masque) — d'où des rectangles.
**Revérifié compilé (25 s d'attente) : faux** — l'albédo du fond est nul sur toute la vue, aucun pixel n'y passe par l'eau peu
profonde ; et la couleur finale de `seaShade` remplacée par un diagnostic fait disparaître les rectangles : **ils naissent dans
`seaShade`**. Écartés encore, compilés : la lumière à travers les crêtes (S3), le champ de houle entier (`TUNE_SWELL` 0), le partage
entre noyau de pleine mer et noyau côtier (`seaWaterOpenOn` false). Restent dans `seaShade` : la couleur de l'eau par région (Kd490,
`seaWaterOf`), l'écume (`W` : moutons de Monahan en taches, dentelle couchée), le Fresnel moyenné (`TUNE_GSKIP` 2048), le reflet du
Soleil. Les rectangles sont fixes sur plusieurs minutes et d'un vert d'eau clair (54, 108, 85 contre 21, 36, 39 autour).
**Resserré encore** : rendre `water` seul garde les rectangles (ils sont dans la couleur de l'eau, pas dans le reflet ni l'écume) ;
`SEA_KD`, `calm` et la confiance de profondeur y sont uniformes ; l'ouverture du ciel (`liteSkip` 4194304) et H5 (1048576) écartés.
**Suspect restant** : les bulles des sillages — `water = mix(water, Ein · (0,02, 0,075, 0,085) / π, wk.bub …)`, exactement ce
turquoise —, des bandes de sillage fixes (un navire à l'arrêt ? des enregistrements anciens de `renderer.seaWakes`). Les deux vues de
débogage des sillages ont été prises **avant la fin de la recompilation** du noyau de l'eau (le sol de repli à l'écran, malgré 20–25 s
d'attente) : à refaire en attendant le noyau (`renderer.variants`), et lire `renderer.seaWakes` sur cette vue. **Lu** : `seaWakes` vide —
pas de navire ; reste le souffle d'un appareil (`seaWake`, hors navires) ou le fond peu profond de `seaShade` (le seuil sur
`luminance(under)` : `under` mesuré nul en moyenne, à revérifier pixel à pixel sur un rectangle). Recherche close pour cette session.

## ~~Le bord de l'eau sur la plage en marches d'environ 1 m~~ — réglé le même jour : c'était l'écume des crêtes (le seuil du Jacobien) — sa bande comptait les pentes des deux cascades longues seules ; bas sur l'eau, la plus fine calculée aussi pliait la surface sous le seuil sur la moitié de la mer (`renderer.ts` `seaFftParams` : la largeur sur les cascades calculées) ; planche `docs/progress/mer/ecume-puzzle-avant-apres.jpg`

**2026-11-11T07:50Z.** Observé (kerr-mini, `coast-swell` `SWELL_ABLATE=sand`, 20 m au-dessus de la plage de l'Almanarre, regard −40°
vers l'ouest ; planche `docs/progress/mer/l3-lame-plage.jpg` : sans L3, avec, et leur différence) : la limite entre l'eau (reflets)
et le sable est en marches d'environ 1 m (~20 px à 40 m), avec et sans L3. Pas la limite eau profonde / fond pâle (réglée par le
niveau 2) : celle de la terre et de la mer dans `shadeLite` (`sea0` du masque grossier × la hauteur du maillage `hW`, les polygones OSM
de `sceneryWaterAt`). Le pas — celui des texels z 17 (~0,9 m) ou des nœuds du patch (1,2 m) — désigne la hauteur lue : à vérifier si
`hW` vient d'un mélange LiDAR / RGE ALTI texel par texel (`lidarYields` les mêle depuis ce jour au niveau de la mer) ou du maillage.
C'est le « trait de côte en dents de scie » de l'analyse (§3), côté terre. Piste : la décision mer/terre par une hauteur filtrée sur
quelques mètres, et un fondu au lieu du seuil.

**Repris le même jour (ce Mac, sonde locale, 20 m au-dessus de l'eau devant la plage, regard vers l'ouest)** : ce n'est pas le bord
de la terre — c'est **un puzzle de plaques pâles et sombres à bords en marches sur toute l'eau très peu profonde** (0–0,3 m : relevé à
1 m, `heightAt`), **qui bouge avec le temps**. Écartés un à un : L3 (lame rendue continue — un vrai saut de `fract`, corrigé —, sans
effet sur le puzzle), le lavis du rivage (`shoreWash`), la surface maillée (`seaSurfaceOn`), le champ de houle (`shoreSwellOn`),
l'écume monde (`seaFoamWorldOn`), l'imagerie (`liteSkip` 128), les ombres du relief et des nuages (`liteSkip` 4, 32), les nuages, et
**tout le déferlement compilé hors** (`TUNE_GSKIP` 1024). **Il disparaît sans les vagues FFT** (`settings.seaFft` false). Suspects :
l'écume des cascades (Jacobien, dentelle) ou le fond vu au creux des vagues sur un haut-fond plus mince que leur hauteur. Suite :
`TUNE_GSKIP` des parts de `seaShade` une à une sur cette vue (les bits de la mer : 2048 Fresnel moyenné, …).

## ~~Le trait de l'eau en escalier devant l'Almanarre, qui bouge à chaque recuisson~~ — réglé (niveau 2 du cache ajouté aux distances au rivage, même jour ; planche `docs/progress/mer/trait-de-cote-niveau2.png` : avant / après, même vue)

**2026-11-11T06:20Z.** Observé (kerr-mini, `coast-swell` `SWELL_ABLATE=sand`, vue plongeante 25 m au-dessus de la plage de
l'Almanarre, regard −38° vers l'ouest ; planche `docs/progress/mer/trait-de-cote-escalier.png`, sans / avec L3) : la limite entre
l'eau verte (profonde) et le fond de sable pâle est **en marches de ~30 m** et se déplace entre deux captures de la même vue — avec
L3 comme sans. Ce n'est pas la surface maillée (elle refuse la plage basse : sol sous la borne des vagues, `seaFs`). Cause supposée :
la classification de l'eau peu profonde — la profondeur de Dean et le lavis tirés des distances au rivage aux nœuds de 38 m (niveau
3 du cache), dont l'iso-ligne suit les cellules des nœuds de terre, recuites quand les tuiles arrivent (au plus toutes les 2 s depuis
L1). C'est le « trait de côte en dents de scie qui change au recuit » de l'analyse du 10 novembre (§3). Il cache la lame de L3 dans
cette vue. Pistes : la distance au rivage d'un niveau plus fin (le niveau 2 du cache, 9,6 m) près de la caméra ; ou la profondeur du
pixel tirée du relief fin lui-même (la hauteur du sol sous l'eau) plutôt que des nœuds ; et un fondu sur quelques mètres au lieu du
seuil.

## ~~Des parois vertes à texture étirée au ras de l'eau, vues de la plage de l'Almanarre~~ — réglé le même jour : le LiDAR HD interpolé au-dessus de l'étang et de la plage (rampes jusqu'à 14,7 m, sous les seuils de 15 et 40 m) cède maintenant à RGE ALTI là où celui-ci dit niveau de la mer (`lidarYields`, `LIDAR_SEA_TRUST_M` 3 m, `earth-tiles.ts`) ; planche `docs/progress/mer/parois-tombolo-avant-apres.png`

**2026-11-11T05:45Z.** Observé (kerr-mini et ce Mac, sonde `forest-impostors` `IMPOSTOR_VIEW=43.066,6.1262,8,80,-9`, et `coast-swell`
vue `sand`) : à 8 m au-dessus de la plage de l'Almanarre, regard vers l'est, une paroi vert sombre de 10–15 m au loin (1–3 km) le long
du rivage, sa texture étirée en traînées verticales, sur une frange blanche ; une forme isolée pareille plus au centre. **Identique
avec les formes analytiques et avec les imposteurs** (`treeImpostorsOn`) : pas les arbres. Planche
`docs/progress/mer/parois-vertes-tombolo.png` (en haut formes, en bas imposteurs). **Cause supposée** (non vérifiée) : les
« silhouettes lointaines » — le MNS de l'IGN moins le sol ajouté aux hauteurs du relief aux niveaux z ≤ 13 (`earth-tiles.ts`,
`earthIgnSilhouettes`) — font des pins du rivage un relief vertical, que l'orthophoto habille en l'étirant. **Écartée le même jour**
(ce Mac, `forest-impostors` `SETTING_BOOT=earthIgnSilhouettes=false`, le réglage posé avant tout chargement) : les parois restent,
identiques ; elles restent aussi **sans aucun arbre dessiné** (`raster: false`, le décor pas encore là) — ni les arbres ni les
silhouettes. Reste le relief lui-même (un relevé LiDAR interpolé sur l'eau ? cf. le bloc noir de S2) ou une autre surface ; un
relevé des hauteurs par `earthTiles.heightAt` le long de l'éventail (relèvements 50–78°, 0,5–6 km) a rendu 0 partout, tombolo compris
— la mesure elle-même est à revoir (tuiles pas encore là, ou mauvaise lecture). Piste suivante : la passe de visibilité seule
(`__bh.renderer` distance/code au pixel de la paroi) pour savoir quelle surface la dessine.
**Localisé (même jour, ce Mac, `__bh.renderer.rasterColumn` à 10, 20 et 42 % de la largeur, sonde locale)** : sur ~50 lignes la
distance du patch le plus fin (niveau 0 des anneaux) reste à **231–233 m** — une paroi verticale du **relief** d'environ 14 m à
~230 m de la caméra, le sol au niveau de la mer à son pied (le lavis du rivage y fait la frange blanche), puis le sol qui s'approche
(distances décroissantes) en dessous ; au-dessus, la terre à 17–22 km. Ce n'est ni un arbre ni une silhouette lointaine : **les
hauteurs fines du cache contiennent une marche de la hauteur des pins** (14 m) au bord du tombolo. Cause à trouver dans les sources
fines (`earth-tiles.ts` : quel relevé fournit z ≥ 15 là — un MNS au lieu d'un MNT, ou une tuile interpolée sur l'eau comme le bloc
noir de S2) ; la mesure `heightAt` à 0 partout est à reprendre avec le niveau des tuiles dessinées.
**Resserré (même jour)** : `earthTiles.heightAt(q, 1 m, drawn)` le long de 43,0669° N, de 6,124 à 6,134° E (tous les ~16 m, la
source nationale « ign », niveau le plus fin z 17, `rem` 0 : les tuiles couvrent) : **0 à 1,2 m** sur la plage et le tombolo,
−0,5 m dans l'étang — **aucune marche dans les sources**. La paroi naît après elles : dans la cuisson du cache de relief (le relevé
fin ajouté au relief grossier, `terrain-cache.ts` — cf. son commentaire sur « une aiguille aussi haute que la mer était profonde ») ou
dans le maillage raster (`terrain-raster.ts`). Suite : lire les nœuds du cache (niveaux 0–2) autour de 43,0669 N, 6,1288 E.
**Encore resserré** (`renderer.terrainCacheLevel(k)`, niveaux 0–3, même ligne) : les nœuds du cache sont plats aussi (0 à 1,5 m) —
pas de marche dans les hauteurs. Mais la fenêtre du **niveau 1** (2,4 m) s'arrête vers 6,129° E, ~250 m à l'est de la caméra : là
où se tient la paroi (232 m) ; au-delà, la visibilité n'a plus de sol avant 17–22 km (l'étang des Pesquiers n'est pas dessiné). La
paroi est donc **un raccord entre niveaux du maillage raster** (le bord du niveau 1 et l'anneau du niveau suivant au-dessus de l'eau :
recouvrement, glissement des sommets — `MORPH_FULL`/`MORPH_BAND` —, ou l'anneau absent sur l'eau), dont la face verticale reçoit
l'orthophoto étirée — pas une donnée de hauteur. Suite : `settings.earthTerrainRasterView` « depth »/« difference » sur cette vue,
et les anneaux dessinés (`terrainRaster.ringsDrawn`) ; regarder si l'anneau du niveau 2 omet ses triangles sur l'eau.
**Corrigé du dernier point, trouvé (même jour)** : la vue des normales du raster (`earthTerrainRasterView` « normals ») montre de
**vraies facettes** — crêtes en dents, une pyramide —, et les niveaux 1 et 2 du cache **contiennent 617 et 435 nœuds à 12–14,5 m**
en bandes diagonales le long du tombolo (ex. 14,5 m à 43,0666 N 6,12883 E, voisins 0,5 m ; 14,7 m à 43,07688 N 6,12471 E), là où
`earthTiles.heightAt` lit 0–1,2 m (le relevé de la ligne précédente passait à côté des bandes). La marche naît donc **dans la cuisson
du cache** (`terrain-cache.ts`, `h = exact + fin − max(grossier, 0)`). Une hypothèse — la surélévation d'un niveau lointain (la
canopée du MNS, I6) gardée là où les fenêtres fines manquent — est **contredite** par l'A/B fait plus tôt : les parois restaient avec
`earthIgnSilhouettes` coupé au démarrage (il atteint bien `earthTiles.hlodOn`, `renderer.ts`, et relance le chargement). **Résolu ensuite** : `heightAt` à 1 m aux nœuds fautifs lisait 14,7 m — les tuiles z 17 elles-mêmes (le relevé de la ligne plus haut
passait entre les bandes) ; le LiDAR HD MNT interpolé sur l'eau. Ce qui suit est l'état d'avant. Reste à
savoir lequel des trois termes porte les 13 m : `earthHeightExactG` à l'empreinte du niveau, ou le relevé fin à 1 m (`earthH(q, 1)`)
— le GPU lit peut-être un texel que la lecture CPU (`heightAt`) ne voit pas. Suite : une passe de diagnostic qui écrit les trois
termes à un nœud fautif (43,0666 N, 6,12883 E, niveau 1).

## Le Lander posé ne décolle pas avec U (autopilote de décollage)

- **Constaté en jeu le 6 novembre 2026** (sonde `probe-moon` de la session, e2e `apprendre-vaisseaux`, ce Mac) : le
  Lander posé à Tranquillité (`__bh.game.land("moon", 0.674, 23.473)`), `launchGoal = { altKm: 100 }`,
  `setAuto("takeoff")` : 600 s plus tard, toujours posé, `pilot.auto === "takeoff"`, manette et poussée à 0, aucun
  message. Même chose après un stationnaire (8) demandé posé. Le Ranger, même place, même recette : décolle et monte
  (98 km en 600 s). Le Lander placé en stationnaire à 300 m par `hoverOver` puis U : décolle et monte.
- **Cause supposée** (lecture de `controller/lowthrust.ts`, branche du décollage) : la boucle de vitesse veut pointer
  le nez vers la poussée demandée et coupe le moteur tant qu'il n'y est pas (rampe d'alignement) ; posé, le Lander ne
  tourne pas — le Ranger a son cas particulier (« Airless, its 12° on the gear and the engine lift it at once »).
- **Piste** : un départ vertical du Lander posé (poussée sur son axe de moteurs, comme le cas du Ranger), puis la loi
  de montée ; un e2e qui le vérifie (`apprendre-vaisseaux`, leçon 10, avec le Lander).

## Vol et tests : défauts relevés en lisant le code, non vérifiés en vol

- **Constaté le 6 novembre 2026** par lecture du code (session de documentation : [VOL-AVIONS.md](VOL-AVIONS.md),
  [VOL-VAISSEAUX.md](VOL-VAISSEAUX.md), [E2E-VOLS.md](E2E-VOLS.md) §9). Rien n'a été lancé : chaque point est à confirmer.
- **Des e2e lisent des membres qui n'existent pas** (la ligne ne fait rien, le test passe sans vérifier) :
  `c.jetModes.alt = c.last?.alt ?? …` dans 9 fichiers (`flight-quality`, `raster-motion`, `raster-flight`…) — `camera.last`
  n'existe pas (voulu : `c.jetFigures()?.h`) ; `cockpit-flight.e2e.test.ts` l. 60 et 82 attend `airInfo().agl` (pas de tel
  champ : l'étape « jusqu'à 3 km » court son plafond de 200 s) ; `coast-survey.e2e.test.ts:101` appelle
  `__bh.sys.sunElevation?.()` (inexistant : toujours `null`).
- **U ne décolle probablement pas un F-35** : sur une piste, U lance l'autopilote de décollage orbital
  (`controller/lowthrust.ts`), qui refuse sous un rapport poussée/poids de 1,05 ; le F-35 sec est à ≈ 0,59.
  [F35.md](F35.md) dit que U décolle automatiquement. Piste : un essai en vol, puis un décollage propre aux avions ou la
  doc corrigée.
- **Les grisés du HUD pour décoller et atterrir** (`src/ui/flighthud.ts`, vers la ligne 2274) dépendent d'un `else` qui
  semble rattaché à la condition du maintien de station : ils ne s'appliqueraient qu'avec un appareil à moins de 5 km.
- **Affichage TAT/SAT de l'A320** (`src/a320/du/data.ts`, vers la ligne 203) : une température en °C divisée par
  `1 + 0,2 M²` ; la SAT affichée serait fausse en vitesse.
- **Limites non appliquées** (choix ou oubli à trancher) : aucune vitesse de train, de volets ni VMO n'endommage un avion ;
  aucune masse maximale de l'A320 ; la ZFW du MCDU ne change pas la masse ; le ralenti du F135 n'est pas lu (manette 0 =
  poussée 0).

## La compilation du noyau de Jupiter proche : ~200 s à froid

- **Constaté le 6 novembre 2026** (Sam : « 200 s pour Jupiter »), en écrivant l'e2e `aurora-jupiter` (AM3).
- **Mesuré** sur le MacBook Pro M1 Max, Chrome lancé par l'e2e, cache de pipelines vide : la caméra à 7 000 km au-dessus de
  45° N de Jupiter (dans son ombre), le noyau du traceur pour cette vue se compile en **203 s sans les aurores** et **219 s
  avec** (`__bh.renderer.compilesPending` à 0). Sonde e2e jetable, même vue, réglage `aurora` 0 puis 5. Après la compilation
  du traceur, le noyau de la sonde de lumière (« the light probe (auroras) ») en demande encore ~60 s.
- **Ce n'est pas l'aurore** : la variante sans aurore met déjà 203 s. C'est le noyau du détail proche des géantes
  (`NEAR_DETAIL`, la tuile de turbulence, le volume des nuages `giantInside`…), compilé à la première approche.
- **Effet** : à la première approche de Jupiter, l'image attend plus de trois minutes sur ce Mac (plus sur le mini, le PC
  Windows non mesuré). Les e2e de Jupiter doivent attendre jusqu'à 5 min à froid (`aurora-jupiter` le dit dans son bandeau).
- **Piste** : mesurer le temps de compilation par fonction comme pour PLAN-LEAN-TRACER-KERNELS (P0–P10 : la Terre passée de
  134 à 19 s) ; spécialiser le noyau des géantes (ce que la caméra proche n'utilise pas) ; compiler en avance dès que
  Jupiter devient la destination (G, l'Atlas, `near`) — ANALYSE-STRATEGIE §8 « anticiper les compilations ».

## Le ciel de nuit de la sonde de lumière du Ranger, ~40 fois son sol

- **Constaté le 6 novembre 2026** (AM2). La nuit à Tromsø, la mer des fjords dessinait une bande blanche saturée le long de
  l'horizon, avec ou sans Lune. La sonde relue : son ciel ~4·10⁻⁶, son sol ~10⁻⁷ (unités de la scène), alors que la vue
  principale dessine le ciel plus sombre que la neige. Sans le vaisseau, la bande disparaît (moyenne 170 → 4).
- **Raccord provisoire** (a1e34357) : dans `seaShade`, le reflet de la sonde est borné à 4 fois le ciel clair du modèle de la
  caméra.
- **À trouver** : pourquoi le ciel de la sonde est si clair la nuit (échelle du fond de ciel liée à l'exposition ?
  `physicalPoints` des étoiles ?) ; puis retirer la borne.

## L'aurore de la face nuit invisible quand la caméra est au soleil, dans l'espace

- **Constaté le 6 novembre 2026** (AM2) : à 4 000 km au-dessus du Canada, caméra au soleil, l'exposition suit la lumière
  qui tombe sur la caméra (`earthSunlight`), l'œil est adapté au jour, la face nuit et son aurore restent noires.
- **Piste** : une exposition qui tient compte de ce que la vue regarde (le posemètre lit déjà la scène pour la retenue des
  hautes lumières) plutôt que de la seule lumière incidente, hors de l'atmosphère.

## Jupiter vu de près depuis l'hémisphère sud : l'image parfois toute noire

- **Constaté le 6 novembre 2026** (AM3, e2e `aurora-jupiter` et une sonde jetable) : la caméra libre à 7 000–14 000 km
  au-dessus de 50–55° S, regardant vers le sud, l'image est entièrement noire, étoiles comprises (luminance moyenne 0,1 sur
  255), **aurore éteinte comme allumée, de jour comme de nuit** — ce n'est pas l'aurore. Une autre fois, la même vue
  s'affiche (étoiles, limbe, ovale sud). Pas d'erreur GPU (`gpuErrors` 0), temps GPU normal (7–14 ms), une fois 0,5 ms.
- **Piste** : un NaN ou une exposition qui part (le posemètre après la coupe), le chemin des géantes proches
  (`giantInside`, la tuile de turbulence) sur l'hémisphère sud ; relire la luminance du posemètre et les pixels NaN dans
  cette vue.

## Le coût de l'aurore terrestre de près, la nuit : +4,6 ms sur le M1

- **Mesuré le 6 novembre 2026** (e2e `aurora-cost` sur kerr-mini, Nominal, plein écran, ABAB, médiane de 24 lectures) :
  Tromsø, Kp 4, de nuit, regard au sud : 36,2 → 40,8 ms (échelle de rendu 0,75 des deux côtés), ~+12 %. Depuis 400 km :
  +2,1 ms (échelles différentes, à refaire). Le schéma de la magnétosphère : +2,3 ms à échelle 1,00 après passage à la
  demi-résolution (≥ +5,5 ms avant). Jupiter : +0,5 ms.
- **Déjà fait** : 16 évaluations par rayon au lieu de 40 ; aucun noyau d'aurore quand l'œil est adapté à plus de 1 000 lux ;
  les rayons qui restent sous 45° de latitude magnétique sautés (gain de ces deux tris non mesuré).
- **Piste** : le cache par direction d'Alex (§ 7.5 : une carte octaédrique marchée depuis l'œil, une bande par image, lue par
  la composition) — au-delà de ~100 km sans parallaxe ; la marche à ¼ de résolution recomposée.

## Saturne vue de son ombre, l'œil adapté : des artefacts partout

- **Constaté le 6 novembre 2026** (AM4, e2e `aurora-giants` sur kerr-mini) : la caméra à un rayon au-dessus du côté nuit de
  Saturne, dans son ombre, l'exposition adaptée au noir (comme pour Jupiter) : l'image se couvre de croissants pixellisés
  dans tout le ciel et de trous dans le disque. À la lumière du jour, rien de tel : c'est une lumière faible et fausse du
  traceur autour de Saturne (la lumière des anneaux sur la face nuit ? un bruit d'accumulation ?) que le gain révèle.
- **Raccord** : l'œil n'est pas adapté à l'ombre de Saturne (`earthSunlight`) ; ses aurores sont calculées mais à leur
  radiance physique, donc invisibles de nuit. **Piste** : relever cette lumière (sonde de pixels) et la corriger, puis
  rendre l'adaptation à Saturne.

## Le traceur (pipeline « trace ») au large de Big Sur : une nappe sombre plate jusqu'à l'horizon

- **Constaté le 6 novembre 2026** (sonde e2e, vol à 450 m au large de Big Sur, cap 150°, `earthPipeline: "trace"`) : une nappe
  plate et sombre au-dessus de la mer, à droite, jusqu'à l'horizon, avec un trait clair le long de la côte. **Elle est
  identique avec le relief national coupé** (`earthIgnRelief: false`) : elle ne vient pas de Mapterhorn, elle précède le lot D.
  Le raster (le pipeline par défaut) ne la montre pas.
- **Piste** : la profondeur de la mer du traceur (`seaDepthAt`, niveaux z 8–10 de Terrarium) ou sa surface de mer lointaine ;
  sonder les pixels de la nappe (distance, `gq`, profondeur lue).

## Les e2e « hors ligne » ne coupent pas le réseau du Service Worker

- **Constaté le 10 novembre 2026** (ce Mac, copie de travail sur `fcddd376`), en cherchant pourquoi `zones-usa-night` échouait
  (8 requêtes Overture comptées « réseau » pendant le vol hors ligne).
- **Mesuré** par une sonde e2e jetable (`App.boot({ sw: true })`, puis `Network.emulateNetworkConditions { offline: true }`
  sur la session de la page) : `navigator.onLine` vaut `false`, mais une tuile Terrarium jamais chargée, demandée par la
  page, revient **200, 138 485 octets**, sans en-tête de zone ni de cache. Le Service Worker est une autre cible de Chrome :
  la coupure posée sur la page ne s'applique pas à ses `fetch`.
- **Effet** : `zones`, `zones-scenery`, `zones-usa-night`, `pwa` et `overture` coupent le réseau de cette façon. Leur compte
  « servi par la zone / demandé au réseau » reste juste (il est tenu par le Service Worker), mais ils ne prouvent pas que
  le jeu tient sans réseau : une donnée absente de la zone est servie par le réseau au lieu de manquer.
- **Les 8 requêtes de `zones-usa-night`** : 43 des 45 plages `base.pmtiles` demandées au réseau sont les tuiles z 13 autour
  de 2,54° S, 14,76° E — le point sous l'orbite de départ de la scène `game:artemis`, pas JFK (0 sur 45 autour de JFK ;
  script jetable, `PmTiles.locate`). C'est la première scène du décor : ses requêtes ne sont pas annulées au saut
  (`scenery-worker.ts:915-941`, aucun signal d'annulation par scène) et, le réseau marchant, elles durent assez pour tomber
  dans la fenêtre comptée. La zone de JFK n'a pas de trou. Le test passe ou échoue selon l'instant.
- **Corrigé dans le harnais le 10 novembre** (non commité) : `app.offline(on)` (`tests/e2e/lib/cdp.ts`, `app.ts`) coupe la page
  et les cibles du Service Worker ; sonde : la tuile échoue hors ligne, avant et après un rechargement, et revient en ligne.
  `zones-usa-night` l'utilise, liste les requêtes de la page qui échouent hors ligne et vérifie qu'aucune tuile de sol n'a
  échoué au-dessus de la zone. **Restent à convertir** : `zones`, `zones-scenery`, `pwa`, `overture` (non relancés).
- **Ce que le premier passage réellement hors ligne a montré** (`zones-usa-night`, ce Mac, `run-2026-11-10b.log` et `c.log`) :
  - **Après une seule visite, le monde est noir hors ligne.** Les fichiers du jeu sont gardés à l'usage, et la première visite
    les charge avant que le Service Worker tienne la page : au rechargement hors ligne, 24 cartes de planètes (`*-HASH.jpg`)
    et `basis_transcoder.wasm` échouent, le décor reste « away-from-earth », aucune tuile n'est demandée. Avec une seconde
    visite en ligne avant la coupure, la zone est dessinée (8 000 bâtiments, 135 réponses du décor par la zone, 0 hors zone,
    0 tuile de sol en échec, 0 plage Overture au réseau).
  - ~~**Les pistes manquent hors ligne.**~~ *Réglé le 10 novembre (lot ST1, commit de ce jour) : les zones gardent
    l'index et les tuiles de 5° des pistes à 150 km (`runwayZoneChains`) ; une tuile en échec n'est redemandée qu'après
    30 s (`world/runways.ts`). Revérifié : `zones-usa-night`, la piste 13R dessinée hors ligne.* `runways/v1/t*.json` (servi par le jeu) n'est pas gardé : 445 échecs en une minute
    sur 4 fichiers — demandé en boucle, sans recul. La piste de JFK n'est pas dessinée (capture `held.png`).
  - **Des workers et modèles manquent** (toujours ouvert ; depuis le 10 novembre, un modèle d'appareil en échec réseau
    est signalé par un avertissement et redemandé après 30 s au lieu de rester « en chargement » toute la session —
    `ship.ts` ; il n'est toujours pas gardé hors ligne) : `earth-surface-worker.js`, `terrain-mesh-worker.js`, `sailboat-HASH.bin`,
    `trawler-HASH.bin` échouent hors ligne.
  - ~~**Du relief IGN demandé à JFK**~~ *Réglé le 10 novembre : c'était la première scène du décor, au lieu de départ
    du F-35 (Le Bourget), dont le relevé IGN continuait ses requêtes et ses relances après l'annulation. Chaque scène a
    désormais son `AbortController`, déclenché par l'annulation (`scenery-worker.ts`). Revérifié : `zones-usa-night`,
    0 requête au réseau pendant le vol.* Constat d'origine : 36 grilles `wms-r` et 16 de couvert, autour de 2,44° E, 48,9° N (Le Bourget), pendant
    le vol à New York. Origine non établie.
  - *(10 novembre, après les correctifs : `zones-usa-night` **vert** sur ce Mac, `run-2026-11-10e.log`.)* Le test restait **rouge** sur son dernier critère (rien d'autre que la carte tactique demandé au réseau) : pistes, relief,
    couvert. C'est l'état réel, pas un artefact.
- **Piste** : mettre en cache à l'installation ce qu'il faut pour un premier rechargement hors ligne (cartes des corps,
  transcodeur, workers, pistes), ou le dire au joueur ; un recul sur les pistes en échec ; chercher qui demande Le Bourget.
- **Piste d'origine (faite pour le harnais)** : couper aussi la cible du Service Worker (`Target.setAutoAttach` puis la même commande sur sa session, ou
  `Network.emulateNetworkConditions` au niveau du navigateur) dans `tests/e2e/lib/app.ts`, en une fonction `app.offline()` ;
  puis compter dès le rechargement, et lire `earthTiles.failed`. Annuler les requêtes d'une scène dépassée (ST2). Ajouter la
  leçon à [E2E.md](E2E.md) §7.

## ~~Paris de nuit vu du cockpit : la ville presque noire (300 m et 900 m)~~ — pas une régression (11 nov., même machine)

- **Constaté le 11 novembre 2026** (kerr-mini) : e2e `night-views` (`NV_ONLY=300m` : 48,86° N 2,15° E, cap 95°, 300 m, nuit sans
  lune) — image presque noire, luminance moyenne 0,010, le décor « en cours d'assemblage » au moment de la photo ; e2e
  `paris-night-flight` (900 m) — de face quelques points, de côté en virage des rues orange pâles ; la planche du 6 novembre
  (`docs/progress/nuit/n1-paris-900-vues.jpg`, df9c782e) montrait les rues vives. **Antérieur aux travaux du 11** : A/B
  `ab-commit` contre 7fd26201 (début de session) — identique (0,0102 contre 0,0103, RMSE 0,5 %).
- **Cause** : non cherchée. La planche du 6 a peut-être été faite autrement (caméra libre, exposition) ; ou une régression entre le
  6 et le 10 (exposition de nuit, lumières de la carte, décor).
- **Piste** : rejouer `paris-night-flight` sur df9c782e (A/B `ab-commit`), puis bissection si l'écart se confirme ; comparer
  l'exposition choisie (`renderer` exposure) des deux côtés.
- **Vérifié le 11 novembre (ce Mac, M1 Max)** : `paris-night-flight` sur df9c782e (worktree) et sur l'arbre actuel — luminances
  moyennes de la ville 0,099 / 0,066 / 0,094 / 0,089 contre 0,100 / 0,066 / 0,099 / 0,068 : les mêmes. La planche du 6 a été faite
  sur ce Mac (sortie HDR) ; kerr-mini (SDR) rend la nuit 3 à 4 fois plus sombre en capture — un écart de machine, pas du code.
  (Le banc `ab-commit` ne charge pas le paquet de décor de ce test : « scenery pack », les deux côtés.)
- **Pluie** : l'e2e `rain` (« paused, the rain holds… ») échoue aussi avant et après le 11 (la vue en pause n'atteint pas
  `converged` en 150 s) — même démarche.
