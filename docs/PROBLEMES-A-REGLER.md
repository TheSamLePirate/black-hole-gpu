# Problèmes à régler

Problèmes constatés, pas encore réglés. Chaque entrée : la date (UTC), ce qui est mesuré ou observé et sa source, la cause
connue ou supposée, la piste. Une entrée réglée est barrée avec le commit qui la règle, pas effacée.


## Le repli du raster vers le pipeline tracé ne s'arme plus sur la Terre (relevé le 13 novembre 2026, e2e `raster-governor`)

**Constat (lu dans le code, 13 nov. ~14:40 UTC)** : le gouverneur (`src/game/governor.ts`, extrait de `main.ts` le 13) ne donne la Terre au
pipeline tracé, pour la session, que si la cadence d'ombrage est à son plus grossier (`renderer.rasterRateCoarsest` : cadence ≥ 16), les blocs à
8 ou plus, l'échelle à 0,5 (résolution dynamique) et l'image au-delà d'une fois et demie le budget pendant 12 s. Or :
- **depuis J2-7** (décision de Sam, 13 nov. ; l'ancien chemin retiré au lot R1, a41711f4), la cadence de la Terre sous son matériau est fixée à 1
  (elle ne réglait que les restes de `shade` : le matériau coûte autant à 16 qu'à 1) — `rasterRateCoarsest` n'est plus jamais vrai sur la Terre ;
- **et avant cela**, sous le matériau, l'échelle est épinglée à celle du raster (`want = rasterTop()`) : la condition « échelle 0,5 » ne tenait
  déjà pas, résolution dynamique active.

L'e2e `raster-governor` (écrit le 23 oct., avant ces deux changements) l'a montré : « la cadence d'ombrage dans {2, 4, 8, 16} » faux (1), puis
il attend la cadence 16 et le repli. **Le filet du GPU faible — le tracé si le raster ne tient pas — est donc dormant sur la Terre.**

**Ce qui est à décider (Sam)** : (a) le rendre atteignable — `rasterRateCoarsest` vrai quand la cadence de la Terre est fixée par son matériau,
l'épinglage de l'échelle compté comme son plancher —, mais alors il peut se déclencher sur kerr-mini pendant J0 (GPU p50 ~55 ms) et chez un
joueur à GPU faible, la vue basculant au tracé (le contrôle de 6 s le rend si le tracé n'est pas plus rapide) ; (b) le retirer sur la Terre (le
raster toujours, un plancher de qualité à la place). ~~Recommandation : (a), après une mesure du tracé contre le raster~~ — **mesuré le
13 nov. (~14:55 UTC, kerr-mini, J0, ablation `traced` : `remote-results/…-j0-traced`)** : le tracé **19,9 ms** de GPU (50 images/s) contre
**57,3 / 55,3 ms** au raster — mais **au prix de l'image** : les nuages presque tous perdus, la mer plate et floue, les écrans du cockpit brouillés
(vues comparées). Le contrôle de 6 s du gouverneur ne juge que la vitesse : réarmé, le repli garderait ce tracé dégradé sur le mini — gagner la
cadence en retirant du contenu, ce que CLAUDE.md interdit. **Recommandation révisée : (b)**, le repli retiré sur la Terre (le raster toujours,
son plancher de qualité à régler) ; ou (a) seulement avec un critère d'image en plus de la vitesse. L'e2e : sa vérification de
cadence mise au contrat actuel (1 sous le matériau) ; sa partie « repli » mise de côté jusqu'à la décision.

## ~~Des taches de couleur sur la mer au crépuscule~~ — réglé le 13 novembre 2026 (~20:29 UTC) : la sonde en demi-flottants sous-normaux

- **Observé** (kerr-mini, J0 Toulon-Hyères, 10 juillet 19:40 UTC — le Soleil couché —, vue de trois quarts arrière vers l'ouest, profil neutre,
  run `…-j3-skyband4b`, `skyband4-1940-*.png`) : de grandes taches roses, jaunes et vertes, aux bords nets, sur la mer et la côte sous le
  couchant. Une seule vue ; non reproduit ailleurs.
- **Rétréci** (~19:14 UTC, phase J0 `seadusk`, trois runs `…-seadusk`, `-seadusk2`, `-seadusk3`, la même vue à 19:40, une source coupée à la
  fois) : les taches **restent** sans la sonde de la mer (`seaProbeOn`), sans les reflets (SSR et nuages reflétés, `TUNE_GSKIP` 20480), sans
  les nuages, sans l'eau par région (Kd490, `TUNE_GSKIP` 1024), sans la surface déplacée (`seaSurfaceOn`), sans l'écume en carte du monde ;
  elles **disparaissent** sans le matériau de l'eau (`liteSkip` 1) et **sans les vagues FFT** (`settings.seaFft` false). **La cause est dans
  le chemin des vagues FFT** (`sea/fft-gpu.ts`, le tableau de textures de la mer et sa lecture dans `trace.wgsl`). Pistes non vérifiées : une
  couche du tableau lue pour une autre (les couleurs roses / jaunes / vertes ressemblent à des normales ou des dérivées lues comme une
  couleur), un niveau de détail au crépuscule.
- **Trouvé** (~19:34 UTC, runs `…-seadusk4/5/6`, un levier de mesure `TUNE_SEA_DBG` dans `seaShade` / `seaSkyRadiance`) : les taches restent
  sans les variances LEAN (1), sans l'écume (2), la normale à plat (4), la lecture plafonnée au niveau 2 (16) ; elles **disparaissent sans la
  lecture du ciel reflété** (8 : `seaSkyRadiance`, la couche du ciel du tableau FFT — la sonde de l'appareil, `takeSky`). Couper `seaProbeOn`
  ne les ôtait pas : la sonde reste tracée pour l'appareil à l'écran (`seaProbeOn` ne commande que celle de la mer sans appareil), fraîche,
  donc lue (`P.seafft[6].z`, moins d'une seconde) — pas un défaut. **Lecture** (non vérifiée) : près de l'horizon, la mer reflète
  ce que la sonde voit sous l'horizon visible — son sol grossier, coloré, éclairé par le couchant — alors que ce chemin (PLAN-MER-WEBGPU S5)
  devait refléter le ciel, le monde étant le SSR. Correctif à choisir dans le chantier de l'eau : ne lire de la sonde que le ciel (les
  directions au-dessus de l'horizon vu de la caméra, le reste au ciel clair), ou marquer le sol dans la sonde.
- **Confirmé** (~19:39 UTC, run `…-seadusk7`, la lecture au niveau 0 — sans flou GGX —) : les taches deviennent des bandes plus fines, roses et
  jaunes, **toujours là** : c'est le contenu de la sonde près de son horizon (son rendu grossier de la mer et des terres, 1,4° le texel, coloré
  au couchant), le flou des niveaux l'étalant seulement.
- **Révisé** (~20:02 UTC) : la sonde relue et écrite en image (`renderer.readShipProbe`, phase `probedump`, run `…-probedump`) est **lisse** à
  19:40 — un dégradé, la bande orangée du couchant, aucune plaque verte ou jaune : la lecture « le sol de la sonde coloré » ne tient pas ; et
  `rUp` est déjà relevé à ≥ 1,15° (les vrais reflets de la côte y sont attendus) — une marge sur l'horizon ne serait pas le correctif.
  **Nouvelle piste, à mesurer** : le reflet est borné **canal par canal** (`min(seaSky, 4 × skyR)`) — l'orange vif de la sonde au-dessus du
  ciel clair dans le rouge seulement donne des teintes qui ne sont ni l'un ni l'autre (roses, jaunes, verts). Levier de mesure posé
  (`TUNE_SEA_DBG` 32 : borné par la luminance, la teinte gardée) ; **non testé** — trois runs bloqués au démarrage de J0 par le chargement de la
  forêt (240 s, « scenery forest » ; les services IGN et WorldCover répondaient ; une phase au même démarrage passait entre-temps : probablement
  la canopée IGN limitée par une autre campagne depuis la même adresse).
- **Cause** (~20:14 UTC, run `…-probedump3` ; `renderer.readSeaSky()` relit la couche du ciel du tableau FFT) : à 19:40 cette couche est presque
  **noire avec une bande saturée en paliers** (rouge, jaune, blanc, bleu), quand la sonde (`envBuf`, en f32) est lisse. La sonde est copiée en
  **radiance brute, non pré-exposée**, dans des textures **rgba16float** (`envRaw` → `envSpec` → la couche FFT, `takeSky`) : au crépuscule la
  radiance tombe vers 2·10⁻⁷ (l'échelle relevée), sous le plus petit demi-flottant normal (6·10⁻⁵) — dans les sous-normaux, quelques bits :
  chaque canal en paliers différents (les fausses teintes), sous 6·10⁻⁸ zéro (le noir). Le bornage par la luminance (`TUNE_SEA_DBG` 32, run
  `…-seadusk11`) ne changeait rien : la couleur est fausse dès la copie. **Touche aussi** (non vérifié à l'image) : les reflets de l'appareil
  (`ship.wgsl` `envSpec`) et du marcheur (`character.wgsl` `envSpecular`), qui lisent la même `envSpec`, la nuit et au crépuscule.
- **Correctif proposé** (comme la table aérienne, stockée × la pré-exposition pour « tenir dans un demi-flottant à tout EV » — `trace.wgsl`
  `apScale`) : la sonde copiée dans `envRaw` × une échelle (la pré-exposition, ou une puissance de deux tirée de sa luminance), écrite à côté
  (`envBuf` + 7 .w → `sh[12].w`), et chaque lecteur d'`envSpec` divisant par elle — `ship.wgsl` `envSpec`, `character.wgsl` `envSpecular`,
  `trace.wgsl` `seaSkyRadiance`. Trois lecteurs, une échelle commune : un lot à part.
- **Réglé** (~20:29 UTC) : `trace.wgsl` `env` écrit la pré-exposition de l'image dans `envBuf` + 8 ; `ship.wgsl` `envCopy` y multiplie la sonde ;
  `envSH`/`envSH4` la recopient en `sh[22]` ; `envSpec` (`ship.wgsl`) et `envSpecular` (`character.wgsl`) divisent par `sh[22]`,
  `seaSkyRadiance` par `apScale()`. **Vérifié** (kerr-mini) : la couche du ciel relue est une copie lisse de la sonde, à ~5·10⁻² au lieu de
  ~2·10⁻⁷ (`…-probedump4`) ; à 19:40 les taches ont disparu et la coque de l'appareil reflète le ciel (elle était en silhouette noire :
  ses reflets lisaient la même sonde) (`…-seadusk12`) ; de jour, les vues et l'exposition identiques (14,645 EV, `…-j3-framing-after` contre
  `…-j3-framing`). Le marcheur : `character-aaa` « the light on foot » (Lune, Terre de jour et de nuit, Mars) passe après le correctif (~20:36 UTC, 29 vérifications) — ses reflets non jugés à part. **Coût** (~20:41 UTC, J0, kerr-mini, `…-probe-scale-cost`) : les passes de la sonde inchangées au bruit (trace 0,454–0,456 ms, GGX 0,166, SH 0,157–0,159, mips 0,038–0,041 contre 0,448–0,453 / 0,166 / 0,155 / 0,037–0,039). Le levier de
  mesure `TUNE_SEA_DBG` retiré (~20:31 UTC), la phase `seadusk` gardée (9 cas) comme garde.

## ~~Le premier `renderer.tune` d'une session fige la sonde de lumière de l'appareil~~ — réglé le 13 novembre 2026 (~17:57 UTC) : la sonde de l'appareil gelée pendant la compilation de son noyau à chaque changement de clé

> **Cause et correctif** (phase J0 `tunestall`, kerr-mini) : `app.settled()` (`renderer.tracerSettled`) attend le noyau principal de la clé,
> pas celui de la sonde (`env`). À un changement de clé — un `tune`, mais aussi **en jeu le bit du décor (8192) ou de la surface (4096) qui
> s'allume en vol** —, `traceVariant("env")` rendait `null` tant que le noyau de la nouvelle clé compilait (des dizaines de secondes sur le
> mini) et la sonde de l'appareil n'était pas lancée : son éclairage, sa lumière principale, le ciel que la mer reflète restaient ceux d'avant.
> `renderer.ts` (sonde de l'appareil) : en attendant, **le dernier noyau `env` compilé**, si sa clé ne diffère que par ces bits (4096, 8192,
> le réglage 20–25) — vérifié : après le premier `tune`, `envFound` faux, la lumière relue suit l'heure (0,0463 / 0,342). Reste : la sonde tourne
> pendant ce temps sans les constantes du nouveau `tune` (une mesure de la sonde sous un `tune` attend toujours son noyau).

- **Observé** (kerr-mini, e2e J0 `J0_PHASES=keyair`, deux runs) : après le premier changement de `renderer.tune` depuis le départ — quelle
  que soit la variante (`TUNE_KEY_AIR` 1, puis `TUNE_AIR_N` 4) —, la lumière de l'appareil et sa sonde relues (`renderer.readShipKey`) restent
  **exactement** celles de l'image d'avant le changement, à toutes les heures lues ensuite, l'horloge tournant, `app.settled()` passé (la
  compilation de la variante attendue, la sonde de lumière comprise) ; au changement **suivant**, elles repartent.
- **Précisé** (troisième run, une variante de chauffe `TUNE_AIR_N` 8 lue à 19:05) : la sonde **tourne** (la hauteur de la caméra relue a
  changé, 577,7 → 580,0 m), mais le **Soleil reste à l'heure d'avant** — la transmittance lue 0,0040 (celle de 19:15) pour 0,0468 attendue à
  19:05 : après le premier `tune`, `game.setDate` n'est pas pris (ou les tables de lumière ne sont pas réécrites) jusqu'au changement suivant.
- **Rétréci** (13 nov., ~17:51 UTC, phase J0 `tunestall`, kerr-mini) : `game.setDate` **est pris** — après le premier `tune`, la date de la scène
  (`game.date()`) et le Soleil du CPU (`camera.skyInfo().sun.altDeg` 0,73° à 19:05, 6,41° à 18:30) suivent ; **seul le GPU reste** : la
  transmittance de la lumière de l'appareil relue (`readShipKey().air.table`) 0,341 aux deux heures (celle de 18:30), puis juste après le
  second `tune` (0,0468 / 0,342). `incidentNow` est remis à zéro chaque image (une valeur restée donnerait le Soleil géométrique, pas l'heure
  d'avant) : le noyau de la sonde (`env`, `keyLight`) ne tourne pas, ou pas avec les paramètres de l'image, sous la variante du premier
  `tune`. Pistes non vérifiées : le choix de la variante `env` (`renderer.ts` ~6650, le repli « par les constantes » propre aux sondes) ou la
  cadence amortie de la sonde après `invalidate()`.
- **Conséquence** : une ablation ou un A/B par `renderer.tune` qui serait le premier d'une session mesure, pour l'appareil (son éclairage, sa
  sonde, le ciel que la mer reflète), l'état d'avant. La phase `keyair` passe par une variante de chauffe et dit si sa lecture était figée.
- **Cause non trouvée** : la recherche de variante du renderer (`renderer.ts` ~6650, le noyau `env` couvert par les bits de la clé, sinon par
  ses constantes) n'a pas été instrumentée. À faire : relever, après un premier `tune`, quel pipeline `env` est lancé (ou s'il l'est).

## La page figée quand le rectangle publié d'un niveau du relief ne couvre plus la tuile de la caméra (relevé par la sonde de fuite de J2-0)

- **Observé** (12 nov. 2026, ce Mac, Chrome sans tête, F-35 gelé à 300 m au-dessus de la plaine du Gapeau, cap 20° ; e2e de mise au
  point, retiré) : la première version de `earthTiles.leakProbe` retirait toujours la **dernière** colonne et la **dernière** rangée
  d'une fenêtre entière ; la page s'est figée 3 fois sur 4 (plus aucune réponse de DevTools, même `Debugger.enable`, en ~1 s), avec
  ou sans la peinture de la sentinelle ; jamais avec seulement le rétrécissement, seulement l'effacement des clés, ou seulement le
  relief ou les orthophotos (une fois chacun). Les fenêtres sont menées **devant** l'appareil : la rangée retirée pouvait être celle
  de la caméra. En retirant la rangée/colonne **la plus éloignée de la caméra** (`probePublished(valid, span, at)`), 3 essais sur 3
  sans blocage. **Cause non prouvée** : un niveau fin dont le rectangle publié exclut la tuile sous la caméra semble bloquer le fil
  de la page ou le GPU (le fil ne répondant pas même au débogueur : une attente native — un GPU occupé — plutôt qu'une boucle JS).
- **Pourquoi c'est à regarder hors de la sonde** : en jeu, `loadedRect` garde la tuile du **centre des chargements** (devant
  l'appareil, `priorityLon`), pas forcément celle de la caméra ; une fenêtre partielle pendant un chargement pourrait donc exclure la
  tuile sous la caméra. Non observé en jeu ; à vérifier (un e2e qui force ce cas, puis la pile du GPU) — J2-1 (validité par tuile)
  touche cette règle.
- **Vérifié en jeu** (12 nov. 2026, ~12 h 55 UTC, kerr-mini, e2e [`j2-page-camera`](../tests/e2e/j2-page-camera.e2e.test.ts), code be0ec185 ;
  [fiche J2-1](progress/j2/FICHE-J2-1-2026-11-12.md) §1) : F-35 à 300 m sur la Beauce, 140 m/s, tuiles IGN chargées en vol, quatre vues de
  15 s. **Aucun blocage** de la page (écart rAF max 59 ms, toutes les lectures répondues). **Mais le trou existe en jeu** : caméra
  extérieure 1,5 km devant l'appareil, regard vers lui — 190 images sur 761 avec un niveau publié sans la tuile sous la caméra (z 15–17),
  jusqu'à **1,5 s** avec le sol sous la caméra en **z 14** au lieu de 17 ; caméra 1,5 km derrière : 37 images, z 16 au lieu de 17
  (≤ 0,12 s) ; cockpit vers l'avant : 0. Deux causes lues dans le code : (1) le rectangle d'un niveau incomplet grandi autour du centre
  des chargements (devant la caméra) même s'il laisse la tuile de la caméra ; (2) une fenêtre menée vers le regard (jusqu'à ¾ de tuile
  du bord) qui dérive de 0,8 tuile avant de se recentrer : regard en arrière sur un appareil qui avance, la caméra sort de sa propre
  fenêtre (z 16, `camIn` faux). **Corrigé par J2-1** (règle de validité : le rectangle garde d'abord la tuile de la caméra ; la tuile de
  la caméra chargée et publiée la première ; la fenêtre recentrée quand la caméra s'approche à 0,2 tuile de son bord) — effet mesuré
  dans la fiche J2-1. **Reste ouvert** : la cause du blocage de la sonde (non reproduit en jeu). ~~La tuile **sous l'appareil** quand la
  caméra est loin (le sol de contact, §19.4 : la fenêtre suit la caméra — J2-2 / le monde)~~ — **réglé par J2-2** (12 nov. 2026 : le
  monde tient les tuiles du niveau de contact sous l'appareil, `earthTiles.setAnchors`/`groundAt` ; appareil posé, caméra à 3 km puis
  revenue : sol constant au millimètre contre +0,83 m et l'avion soulevé de 0,56 m avant — [fiche J2-2](progress/j2/FICHE-J2-2-2026-11-12.md)).

## Des pointes de 2 à 20 ms du fil principal autour des tuiles : `request()` et la publication (relevé par J2-2)

- **Mesuré** (12 nov. 2026, kerr-mini, vol J0 de `j2-probes`, compteurs `earthTiles.pubStats` `reqMs`/`haloMs`/`pubMs` — [fiche J2-2](progress/j2/FICHE-J2-2-2026-11-12.md)
  §4) : **`request()`** (le balayage des chargements, appelé à chaque image et après chaque tuile arrivée) jusqu'à **7 ms** en vol (18
  images sur 939 > 2 ms) et **14–20 ms** au chargement à froid, **sans le halo** (`haloMs` 0) ; **la publication** au-delà de son budget
  quand elle écrit sa page « au moins une » ou rattrape (2,2–3,2 ms en vol ; une à 12,1 ms au chargement). Le travail des arrivées
  lui-même est ≤ 0,5–1,7 ms.
- **Cause supposée** : le balayage des fenêtres (clés de tuiles refaites et triées à chaque appel) ou les chargements qu'il démarre
  (`load` : `fetch`, imagerie, contrôleurs) — non séparés. Relancer `request()` au plus toutes les 16 ms n'a rien changé (essayé, retiré).
- **Piste** : chronométrer séparément le balayage et les démarrages ; tenir par niveau les tuiles manquantes au lieu de les recalculer ;
  étaler les démarrages ; une page qui dépasse le budget reportée sauf rattrapage. Critère de J2-1 « aucune pointe > 2 ms » non tenu.
- **Traité par le lot « pointes » de J2** (12 nov. 2026, [fiche](progress/j2/FICHE-J2-pointes-2026-11-12.md)) : la cause n'était pas le
  balayage (≤ 0,4 ms en vol) mais **les démarrages groupés** (≈ 0,3 ms chacun, leurs `fetch` : 8 d'un coup 2,1–3,3 ms) et **le regard du
  halo** (1,6–2,7 ms) ; au chargement, le balayage répété à chaque arrivée. Un budget des tuiles de 2 ms par image (publication +
  démarrages + halo, ordre des priorités gardé, le reste à l'image suivante), le halo par tranches et mémorisé, une arrivée qui ne relance
  `request()` qu'une fois par image, la publication estimée par octets avec sa queue, plus d'allocation par page. **Mesuré** (M1 Max, A/B
  A B B A refroidi, vol J0) : travail des tuiles par image p95 1,5 → 1,2–1,3 ms, `request()` max 2,8–3,6 → 1,9–2,0 ms, images > 2 ms
  37–40 → 5–7 par vol (dont la plupart à 2,1 ms, la résolution du chronomètre) ; au chargement `request()` 8,3–8,8 → 2,6–4,1 ms ; image
  inchangée. **Reste ouvert** : 1 image par vol à 3,1–3,2 ms, dont 1,7–2,7 ms dans le simple enregistrement d'une arrivée (`put`, hors de
  tout chemin coûteux : pause du ramasse-miettes probable, A en montre aussi) — critère non tenu strictement ; la mesure sur kerr-mini.

## ~~Une marche sous le pixel aux bords des niveaux du raster près de Hyères~~ — pas une couture : des plis et des crêtes ; C0-12 tenu (J2-3, 13 novembre 2026)

La sonde géométrique des coutures (e2e `j2-probes`, phase `seams`, [fiche J2-3](progress/j2/FICHE-J2-3-2026-11-13.md) §4) comptait aux
bords des niveaux des « marches » que la géomorphose ne retirait qu'à moitié. Ce qu'elles étaient : **des plis** (deux niveaux qui se
rejoignent, leurs pentes cassées : la facette du grossier contre le relief du fin) et **des crêtes** (un rang fin qui cache un terrain plus
loin, en vue rasante). La **fissure** (les deux côtés prolongés : croisés entre les deux pixels, la surface est entière) : p95 0,004 px
(Alpes), 0,18 px (vers La Crau), et sur la plaine du Gapeau **regardée 35° vers le bas** (`hyeres-down`, les mêmes bords sans crête)
**0,069 px**, 2,9 % des paires > 0,25 px contre 1,5 % à l'intérieur ; sans géomorphose 20–31 %. La même plaine en vue rasante (p95 0,77 px)
mêle les crêtes. **C0-12 tenu.**

## ~~La reconstruction (TAAU) ne restitue bien que l'échelle 0,75~~ — un artefact de mesure (J2-6, 13 novembre 2026)

La « référence à pleine échelle » de `motion-quality` était, en raster, une vue tenue à `earthRasterScale` (0,75), jamais convergée ; et
`forceScale` d'une autre échelle recréait les cibles à chaque image. Corrigés (`motion-quality`, `main.ts` `resize`) : PSNR en virage
monotone, 2/3 30,4 ; 0,75 32,5 ; 0,80 34,3 dB. Les mesures historiques de `motion-quality` **entre échelles** en raster (Q6, I4 « ce que la
TAAU garde sous 75 % ») sont à relire avec ce biais.

## « Posé sur un aérodrome » ne s'aligne plus sur sa piste au Bourget (e2e `ground-placement`)

- **Observé** (12 nov. 2026, kerr-mini) : `game.land("earth", 48.96, 2.44)` répond « landed at 48.96°, 2.44° » au lieu de « lined up
  … » (Δcap 9,015°, décalage −936,86 m de l'axe) — **à l'identique sur 72a16452 et sur J2-2** (A/B `ab-commit`), donc antérieur à J2-2 ;
  les trois autres cas de l'e2e (appareil garé à côté, F-35 et Ranger sur une piste et sur le flanc du Fuji, chaque jambe au sol) passent.
- **Cause** : non cherchée (hors du lot J2-2) — le choix de l'aérodrome ou de sa piste en service par le placement (`game/place.ts`).

## Des villes couvertes d'arbres, sans bâtiments proches, dans les e2e (Marseille, Toulon, Manhattan)

> **13 novembre 2026 — décision de Sam (« ok pour tes recommandations »)** : `earthScenery.clearCut` **allumé par défaut** (les arbres refusés
> aux îlots coupés) ; la cause de fond — le plafond gardé autour du seul centre de la scène — traitée par un couloir le long de la
> trajectoire — **fait** : `earthScenery.corridor` (allumé) ; Paris, même scène tenue (centre 3,4 km devant) : points de bâtiment à moins de
> 1 km de l'appareil **0 → 272**, entre 1 et 2 km 173 → 274, le sol nu sous l'appareil 548 → 332, le worker au même temps (~30 s)
> (`docs/progress/decor/corridor-2026-11-13.json`). Non mesuré : un vol long où la scène suivante tarde (la sonde en vol a vu deux
> scènes différentes d'un passage à l'autre).

**État (12 nov. 2026, soir)** : **confirmé en vol réel au-dessus de Paris** — les arbres de la canopée IGN couvrent les îlots dont le
plafond du décor a coupé les bâtiments (la moitié des arbres de la scène) ; et en vol l'appareil sort du disque des bâtiments gardés :
la ville visible devant lui n'est plus qu'une forêt. Cause dans le code, correctif des arbres derrière `earthScenery.clearCut`, **éteint**
(décision de Sam) ; la cause de fond (le plafond gardé autour d'un centre que l'appareil dépasse) reste ouverte (fin de l'entrée).

- **Observé** (12 nov. 2026, e2e `buildings-forward` sur kerr-mini, e482082b ; planches `docs/progress/j1/j1-5-batiments-forward-marseille.jpg`,
  `…-new-york.jpg`, `…-batiments-forward.jpg`) : le Vieux-Port de Marseille vu à 30 m au-dessus de l'eau — **les quais couverts d'arbres
  d'automne, presque aucun bâtiment** (217 pixels de bâtiment dans la vue, scène complète « all in ») ; la Darse de Toulon, des arbres
  sur la vieille ville au premier plan ; Times Square à 60 m, aucun bâtiment près de l'appareil, les tours seulement au loin.
- **Une cause trouvée, dans l'e2e** : un appareil placé (et gelé) au-dessus de 120 m/s fait chaîner au décor des scènes rapides
  (`scenery.ts` `fastFlight`, T8m — voulu en vol rapide) : la scène complète, celle des bâtiments, ne vient jamais (`quick` reste vrai
  plus de 3 min). Corrigé dans l'e2e (`BF_PLACE` à 90 m/s ; attente de `!quick`). **Mais à 90 m/s, la scène complète dessinée, les quais
  de Marseille restent sous les arbres.**
- **Relevé ensuite** (`earthScenery.stats()` loggé par l'e2e) : à 90 m/s cap 80°, **la scène est centrée à ~3,7 km devant l'appareil**
  (5,414° E pour un appareil à 5,368° E : le décor centre sa scène où l'appareil sera — l'avance du renderer, vitesse × temps d'une
  scène —, un appareil gelé n'y arrive jamais) et **ses bâtiments plafonnés à 32 000** (BD TOPO, 28 dalles), les 943 000 arbres de la
  canopée IGN couvrant le reste — le Vieux-Port, au bord de la scène, sous les arbres. **Placé à 10 m/s** (gelé) : la scène centrée sur
  lui (5,372° E), 32 000 bâtiments encore (plafond), **les façades des quais dessinées**. Donc dans ces e2e : l'avance du centre sur un
  appareil gelé. **Reste une question pour le jeu** : en vol réel au-dessus d'une ville dense, le plafond de 32 000 bâtiments laisse-t-il
  la canopée IGN planter des arbres sur les îlots coupés (les vues de Toulon et de Paris de la session J1-5 le suggèrent) — à mesurer
  (`budgetLimited`, le masque bâti des arbres relevés).
- **Paris, même jour** (Louvre et Tuileries, 60 m, appareil lent ; kerr-mini, e2e retiré depuis, `remote-results/20261112-120515-…`) :
  les bâtiments proches dessinés, **le plafond atteint** (32 000 bâtiments BD TOPO, `budgetLimited` vrai, 1,34 million d'arbres) — les
  îlots coupés sont plus loin, pas regardés ; **une requête de la canopée IGN refusée** (`surveyError` : HTTP 400 du WMS-R `data.geopf.fr`)
  — à examiner à part (quelle couche, quels paramètres).
- **Conséquence** : pour une vue de façades, placer l'appareil lent (≤ 10 m/s) et attendre `!quick` (l'e2e `buildings-forward`, qui le faisait, est retiré avec son pilote le 12 nov. : `git show 081e4b17:tests/e2e/buildings-forward.e2e.test.ts`).
- **La cause, dans le code** (`src/system/scenery-worker.ts`, 12 nov. soir) : le plafond garde les `limit` bâtiments (8 000 × portée² en
  `high` : 32 000 à la portée `veryFar`, le défaut) **les plus proches du centre de la scène** (`choices`, triés par `d` puis tronqués ; les
  dalles BD TOPO au-delà ne sont même pas chargées, OSM y tient lieu de candidat). Les arbres relevés (`growForest`, I4) poussent partout
  où la canopée (MNH : la surface du LiDAR moins le sol — **toits compris**) dépasse 2 m, quelle que soit la classe du sol (sauf l'eau) ;
  ils ne sont refusés que dans les emprises de `houses`, construites **après** la troncature : les seuls bâtiments gardés. Un îlot coupé
  reçoit donc des arbres aussi hauts que ses immeubles. (Sans la canopée IGN — hors France, ou un bloc en échec —, la couverture du sol ne
  met pas d'arbres sur le bâti : WorldCover 50 a une densité nulle.)
- **Mesuré** (e2e `cut-buildings-trees`, E2E_PROBE=1, ce Mac M1 Max, fenêtre visible, thermique « Heavy » ; F-35 au protocole de J0,
  300 m au-dessus de Passy, cap 95°, train sorti, autopilote et automanette tenus ; données
  [docs/progress/decor/cut-buildings-trees-2026-11-12.json](progress/decor/cut-buildings-trees-2026-11-12.json), aucune image commitée) :
  - **le plafond** : 32 000 bâtiments gardés (BD TOPO), **215 000 à 261 000 coupés**, les gardés à **2,5 km au plus du centre** ; la scène
    porte 1,22–1,37 million d'arbres relevés.
  - **les arbres sur le bâti coupé** : levier allumé, à centre identique, **1 366 347 → 680 567 arbres** (685 785 candidats refusés par les
    emprises coupées) et 1 217 907 → 644 764 sur une autre scène : **la moitié des arbres de la scène de Paris sont sur des bâtiments
    coupés**. Dans la grille 80 × 45 de `surfaceAt` (vue tenue, scène centrée devant l'appareil) : points « arbre » 245 → 87 et 230 → 83
    (−64 %), devenus sol (et quelques bâtiments qu'ils cachaient) ; mais dans cette vue-là la plupart sont sous le panneau du cockpit : la
    partie visible, dans le disque gardé, n'en change que 12 → 7 et 15 → 12.
  - **en vol réel** (60 s à 110 m/s, la vue tenue ensuite telle quelle) : la scène dessinée est **centrée 3,2 km derrière l'appareil**
    (demandée devant lui au départ, 36–68 s de construction à froid, l'appareil l'a dépassée ; la suivante en cours) — l'appareil, au-dessus
    de la Bastille, est **hors du disque des bâtiments gardés (2,5 km)** : dans toute la grille, **0 bâtiment, 672 points d'arbre**
    (1–2 km : 427 ; 2–3 km : 154) ; dans la partie visible, **0 bâtiment, 66 arbres, 103 sol** : l'est de Paris vu comme une forêt. Le même
    vol levier allumé (la scène du vol, ici la rapide) : **0 arbre, 0 bâtiment, 169 sol** visibles — l'orthophoto à plat, plus de forêt, mais
    toujours aucun bâtiment. Le vol à 90 m/s (α 13°, train sorti) ne montrait que le ciel : la vue regarde à −18° et vole à 110 m/s.
  - **coût du levier** : la grille des emprises coupées 0,27–0,75 s dans le worker (40 000–261 000 emprises), la forêt +0,9–1,3 s (le test
    de 1,3 million de candidats) : **+1,4–2,0 s sur une scène de Paris chaude de 22–23 s** (un échantillon par côté) ; la mémoire du GPU
    inchangée (tampon de 64 Mio fixe) ; le temps GPU d'une image inchangé dans le bruit (16,8 / 17,3 / 17,0 ms ; 19,9 / 19,9 ms, thermique
    « Heavy » : pas une mesure de gain).
- **Correctif derrière un levier éteint** : `renderer.earthScenery.clearCut` (défaut `false`) — les emprises des bâtiments coupés gardées
  à part (`cutHouses`) et refusées aux arbres comme celles des gardés ; partie de la clé de la scène (une bascule en refait une) ; stats
  `cutBuildings`, `keptReachM` (toujours), `clearedTrees`, `cutHousesMs`, `clearCutDrawn` (BH-API). **Il ne rend pas les bâtiments** :
  les îlots coupés deviennent l'orthophoto à plat.
- **Reste ouvert, pour Sam** : (1) allumer `clearCut` (le sol à plat plutôt qu'une forêt, +1,4–2 s par scène de ville) ; (2) la cause de
  fond — en vol l'appareil dépasse le centre de sa scène et sort de son disque de 2,5 km : garder les bâtiments par distance à la
  trajectoire ou à la caméra (`q.eye`) plutôt qu'au centre, un plafond plus haut dans les villes, une scène plus rapide, ou une avance qui
  tienne compte du temps réel de construction (36–68 s à froid à Paris, l'avance plafonnée à 3,6 km) ; non essayé. (3) La requête de
  canopée refusée (HTTP 400) à Paris n'a pas reparu ; un délai dépassé (`TimeoutError`) sur un bloc à froid.

## Des points blancs qui scintillent sur la mer et dans la brume de l'horizon (scène J0, Toulon-Hyères)

> **13 novembre 2026 — décision de Sam** : `renderer.seaSsrSafe` **allumé par défaut** (le miroir de la mer ne lit plus les pixels d'eau que
> sa passe écrit).

**État (12 nov. 2026, soir)** : cause trouvée — la réflexion écran de la mer lit des pixels d'eau en cours d'écriture (fin de
l'entrée) ; correctif derrière `renderer.seaSsrSafe`, éteint, en attente de la décision de Sam.


- **Observé** (Sam, 12 nov. 2026, e2e `j0-reference` sur ce Mac, fenêtre visible) : « plein de points blancs (pixels) qui apparaissent
  et disparaissent, comme du bruit ». **Relevé** sur les captures de la séance (M1 Max, 9691ed31) : des **rangées de points blancs
  d'un pixel, régulièrement espacés**, dans la brume au ras de l'horizon et sur la mer lointaine — sur l'ablation sans HUD aussi ; planche
  `docs/progress/j0/points-blancs-mer-2026-11-12.jpg`. **Déjà là le 10 novembre** (fiche du soir, e00182a2 : la même rangée sur la mer
  au virage) : **pas une régression** des lots du 12 (rejet par identité, appareil dans la scène, export, retrait du pilote).
- **Cause supposée, non vérifiée** : l'espacement régulier ressemble au motif d'ombrage clairsemé **du noyau des rayons `shade`** (1 pixel
  sur 8 ou 16 tracé frais à chaque image, le reste reconstruit) — celui de la mer lointaine et de la brume au-delà du patch raster, où
  sont les points ; le sol raster lui-même est ombré à chaque pixel par `shadeLite` (relevé de la session J1-5 bâtiments, PLAN-J1) : un
  pixel frais bien plus clair que ses voisins reconstruits — un reflet du Soleil bas sur l'eau, la brume — que la reconstruction et le
  temporel ne lissent pas ; le motif tourne à chaque image, d'où le scintillement.
  Une première sonde (`tests/e2e/sea-sparkle-probe.e2e.test.ts`, E2E_PROBE=1) ne l'a pas mesuré : elle comptait le texte du HUD, puis
  son vol a cabré (train rentré : l'autopilote remonte — remarque de Sam) ; dans la couleur de scène exportée (`renderer.sceneColor`),
  presque aucun point sur la mer pendant ce vol-là — à refaire en vol tenu.
- **Sonde corrigée, même jour** (`sea-sparkle-probe`, protocole de J0 : placé horloge gelée, données attendues, autopilote, automanette
  et train tenus — vol à 497–502 m ; **tuiles bloquées**, un e2e IGN tournant sur kerr-mini) : dans la couleur de scène
  (`sceneColor`), **aucun** pixel isolé ni au-dessus du blanc SDR sur la mer et la brume ; à l'écran, quelques dizaines à centaines de
  pixels qui changent entre deux images, en baisse avec le chargement, **sans écart** entre `earthRasterShading` « every » et auto, ni
  entre la sortie HDR coupée et non : **pas reproduit sans tuiles**. À refaire avec les tuiles (l'imagerie de la mer, le relevé) quand
  aucun autre e2e IGN ne tourne ; et demander à Sam l'instant et la vue où il les voit (vol frais, virage, ablation).
- **Avec les tuiles, même jour** (ce Mac, vol tenu à 496–499 m, les côtés tel que livré / sortie HDR coupée / `earthRasterShading`
  « every » / tel que livré) : **dans la couleur de scène même**, 0 à 20 pixels par image **isolés et plus clairs que le blanc SDR**
  (plus d'1,5 fois leurs voisins) sur la mer et la brume, **dans les trois réglages** — ni la sortie HDR ni l'ombrage clairsemé ne les
  font : ils naissent de l'ombrage de la mer, avant l'affichage. **Cause supposée** (non prouvée) : le crénelage du spéculaire —
  le reflet du Soleil bas (15:30 UTC, cap à l'ouest) sur des facettes de vague plus petites qu'un pixel, allumées une image et pas la
  suivante. Le motif en rangées régulières des captures reste à expliquer (la gigue du temporel ?).
- **Puis, leviers par leviers** (même jour, ce Mac, même sonde, côtés alternés avec l'état livré) : les pixels isolés au-delà du blanc
  dans la couleur de scène **restent** (0–24 par image, l'état livré 0–22) avec le spéculaire du sol coupé (`liteSkip` 67108864), la mer
  plate (`seaSurfaceOn` false), **le matériau de l'eau coupé** (`liteSkip` 1) — **l'hypothèse du spéculaire de la mer est donc fausse
  ou incomplète**. Certains tombent au centre bas de l'image, sur le nez de l'appareil (ses reflets métalliques, dans la scène depuis
  J1-5), d'autres sur la mer à droite. Peu nombreux pour « plein de points » : la mesure ne voit peut-être pas ce que Sam voit. **Cause
  inconnue** ; à faire : une vidéo ou une rafale d'écran à l'instant où Sam les voit, et les points localisés (nez, mer, brume).
- **Localisés par J2-0** (12 nov., e2e `j2-probes`, vol J0 tenu ; [fiche](progress/j2/FICHE-J2-0-2026-11-12.md) §6, planche
  `docs/progress/j2/j2-0-points-blancs-m1max-mini.jpg`) : **ils naissent avant la reconstruction** — déjà dans l'image résolue qui entre
  dans `temporal` (2–8 au-delà du blanc sur la mer par lecture), le temporel les garde aux mêmes pixels, la TAAU les étale (6–22 pixels) ;
  dans une vue tenue ils s'accumulent (des dizaines, **blancs et cyan**, sur la mer et le nez). **Selon la machine** : 113 par seconde
  dans la vue sur le M1 Max (la moitié des images), 0,23 par seconde sur kerr-mini, même scène et même code ; sur le M1 Max l'énergie de
  l'image oscille aussi d'une image à l'autre (0,1 ↔ 0,4), le mini est lisse. À chercher entre les deux machines : la cadence d'ombrage du
  gouverneur (`adaptRasterRate`, `rasterRate`), la cadence d'images (42 contre 17/s : la gigue), l'écran HDR et l'exposition de ce Mac ;
  outils : `renderer.sharpLog` (`points` par image) et `sceneStages()`.
- **Vue tenue, M1 Max (même jour, après J2-0 : 113 points/s sur le M1 Max contre 0,23/s sur kerr-mini, déjà avant le temporel)** :
  la sonde en vue tenue (`SP_HOLD=1`) les reproduit **avec les tuiles** (100–250 pixels isolés au-delà du blanc par image ; ~5 en vol),
  **aucun sans tuiles** ; ni les étoiles (`starBrightness` 0) ni l'affinage (`targetSpp` 0) ne les ôtent. À tester en vue tenue avec
  tuiles : le matériau de l'eau (`liteSkip` 1), le spéculaire (`liteSkip` 67108864), la gigue (`liteJitter`) — quand aucun autre e2e IGN
  ne tourne.
- **Vue tenue avec tuiles, M1 Max, même jour (suite)** : vus agrandis, ce sont **des points blancs semés sur la mer sombre, comme des
  étoiles**, dans la bande juste au-dessus du nez (≈ 70–80 % de la hauteur) ; **leurs lignes tombent toutes les ~10,7 px de l'export, soit
  8 px internes** (échelle 0,75) — un motif de grille. **Exclus en vue tenue** (100–260 points/image de chaque côté) : le matériau de l'eau
  (`liteSkip` 1), le spéculaire (`liteSkip` 67108864), l'ombrage à chaque pixel (`earthRasterShading` « every »), le sous-échantillonnage 1,
  la mer plate (`seaSurfaceOn`), les crêtes devant la terre, la sonde du ciel de la mer (`seaProbeOn`), le noyau de la haute mer
  (`seaWaterOpenOn`), les étoiles projetées (`starsSplat`), l'affinage (`targetSpp` 0), la luminosité des étoiles. **Suite** : chercher la
  passe par la sonde d'étapes de J2-0 (`stageProbe`/`sceneStages`) et des coupes passe par passe (`trace`, `shade`, les nuages, l'air), et
  ce qui a une période de 8 px internes (le bloc des rayons, la LUT du champ lointain — un rayon tous les 8 px —, la grille de gigue).
- **Localisés (même jour, soir, M1 Max, vue tenue, tuiles)** : **`liteSkip` 1024 (l'ombrage de `shadeLite` remplacé par un gris) les
  ôte tous (0 par image)** — ils naissent dans `shadeLite`. Sous chacun (`surfaceAt`), **la mer comme sol raster, à 2,0–2,3 km, au
  niveau 3 des anneaux**, et la couleur un **blanc neutre de 3 à 13 fois le blanc** (une émission ou une saturation, pas un reflet teinté).
  **Exclus en plus** : les groupes de `liteSkip` 126 (ombres du décor et du relief, surfaces, normale, ombres des nuages, arbres), 65664
  (imagerie et son empreinte), 21004288 (contact, ciel et rebond, ciel des vallées, occlusion), 3670016 (H3, H5, ombre de l'appareil),
  41943040 (bits restants), l'écume (`seaFoamWorldOn`), la FFT (`seaFft`), la frange du rivage (`shoreWash`), les lampadaires
  (`earthStreetLamps`), les nuages (`earthClouds` 0). **À faire** : lire `shadeLite` sur ce cas — un pixel de mer à ~2 km au niveau 3,
  sa valeur > 1 sans eau ni spéculaire —, en vidant ses termes un à un dans un noyau de diagnostic ; ce qui a une période de 8 px internes
  (les lignes des points) ; pourquoi le M1 Max seulement (kerr-mini 0,23/s).
- **Piste (avant ces leviers)** : un spéculaire de la mer filtré à l'échelle du pixel (rugosité élargie par la variance des normales FFT sous le pixel —
  Toksvig/LEAN —, ou plafonnée au loin), ou une borne des lucioles dans le temporel sur l'eau ; relève de la passe d'eau
  (PLAN-MER-WEBGPU / J4) ; mesurer avec la sonde (`SP_SWITCHES`), la couleur de scène et l'écran comparés aux mêmes instants ; `realtimeSubsampling`
  ou le taux raster à 1 pour voir si le motif suit l'ombrage clairsemé ; puis la reconstruction (`liteReconstruct`) ou la plage du
  temporel sur l'eau lointaine.
- **CAUSE TROUVÉE (12 nov. 2026, soir, M1 Max, vue J0 tenue, tuiles ; sonde `sea-sparkle-probe`) : la réflexion de la mer en
  espace écran (`seaSSR`, dans `seaShade` de `shadeWater`) lit des pixels d'eau que la même passe est en train d'écrire.** Elle
  accepte toute marque ≥ 10²⁹, donc celle d'une eau **finie** (`rasterMark(0, 1)` = 4·10³⁰) ; ces pixels sont écrits par d'autres
  groupes de travail du même envoi, `moments` et `accum` sans ordre entre eux : la marque vue finie, `accum` encore l'intermédiaire
  de `shadeLite` — l'**albédo** de la mer peu profonde (`w` = 2, turquoise), la lumière du fond —, lu comme la radiance du monde
  reflété. Son premier pas n'est qu'à ~10 m le long du rayon réfléchi (≈ 2,2 km) : le pixel touché est une ou deux rangées au-dessus ;
  pour la **rangée haute de chaque groupe 8 × 8**, c'est un autre groupe de travail. **Preuves** : sous 16 points sur 16, la rangée
  interne `y mod 8` = 0 (ou 1 à l'arrondi de `surfaceAt`), les colonnes quelconques ; la réflexion écran coupée (bit de diagnostic
  temporaire) → 0 point ; ne refuser que les marques d'eau (≥ 3·10³⁰) → 0 point, avec l'eau, son spéculaire et sa réflexion gardés.
  **Pourquoi le M1 Max seulement** (non prouvé) : une course entre groupes de travail dépend de l'ordonnancement et de l'ordre des
  mémoires du GPU (32 cœurs contre ceux de kerr-mini) ; elle explique aussi que tout changement de code autour en change l'issue.
  Dans une vue tenue le temporel garde chaque point lu — d'où l'accumulation et le scintillement.
- **Correctif derrière un levier éteint** : `renderer.seaSsrSafe` (bit raster 4096, `RASTER_SSR_SAFE_FLAG` ; trace.wgsl `seaSSR`) —
  la réflexion ne lit plus les pixels d'eau (marque ≥ 3·10³⁰), le miroir y est celui du ciel. **Mesuré** (r12, A B A B A, M1 Max en
  pression thermique « Heavy », même vol J0 tenu) : points au-delà du blanc par relevé **A 127–235 / B 28 puis 0 / A 128–277 / B 24 puis
  0 / A 97–191** (les 24–28 du premier relevé : les points gardés par le temporel avant la bascule) ; clignotants à l'écran A 118–394 /
  B 0 ; l'image (couleur de scène, points exclus) : la vue tenue dérive de ≈ −1,1 % de luminance par côté, et le levier s'en écarte de
  −0,2 à −0,3 % (les points et leurs halos retirés). **Non mesuré** : une vue sans mer (inchangée par construction : `seaSSR` seul lit le
  bit) ; le coût GPU (une comparaison par réflexion touchée) ; kerr-mini (hors réseau) ; en vol. **Décision de Sam** : allumer le levier
  par défaut (et le retirer ensuite), ou corriger autrement (lire l'image de l'image précédente pour la réflexion écran).
- **Défaut de mesure trouvé en chemin** : `renderer.liteSkip` arrive au noyau dans un float (`P.jet2.w`) avec, ajoutés, 2²⁶ quand
  `groundSpecular` est coupé — **le défaut** — (et 2²⁹ si `shoreWash` est coupé) : les bits 1, 2 et 4 y sont **perdus** (pas de 8 du
  float32 à 2²⁶). **`liteSkip` 1 n'a donc jamais coupé l'eau** dans les mesures ci-dessus (ni 2, ni 4 : les exclusions « eau »,
  « 126 », « 9 », « 129 », « 8193 » de cette entrée ne valent que pour leurs bits ≥ 8) ; c'est ce qui a fait chercher la cause hors de
  l'eau. À corriger (un mot entier, ou ces trois réglages hors du masque) ; BH-API le signale.

## ~~Des rectangles turquoise sur l'eau peu profonde devant l'Almanarre~~ — réglé le même jour : les blocs JPEG de l'orthophoto (8 × 8 pixels, 1,6 m) sur l'eau calme, lus de près sous huit empreintes du pixel seulement, le seuil du turquoise les découpant ; l'albédo du fond lu sur 3,2 m au moins (`shadeLite`, eau peu profonde) ; planche `docs/progress/mer/turquoise-avant-apres.jpg`. (Les diagnostics « albédo nul » plus bas avaient été pris pendant la recompilation : faux.)

**2026-11-11T08:50Z.** Observé (ce Mac, vue à 20 m au-dessus de l'eau devant la plage, regard −40° vers l'ouest ; planche
`docs/progress/mer/turquoise-rectangles.jpg`, trois instants) : des taches turquoise rectangulaires, à bords en marches de 1–3 m, fixes,
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

## ~~Le trait de l'eau en escalier devant l'Almanarre, qui bouge à chaque recuisson~~ — réglé (niveau 2 du cache ajouté aux distances au rivage, même jour ; planche `docs/progress/mer/trait-de-cote-niveau2.jpg` : avant / après, même vue)

**2026-11-11T06:20Z.** Observé (kerr-mini, `coast-swell` `SWELL_ABLATE=sand`, vue plongeante 25 m au-dessus de la plage de
l'Almanarre, regard −38° vers l'ouest ; planche `docs/progress/mer/trait-de-cote-escalier.jpg`, sans / avec L3) : la limite entre
l'eau verte (profonde) et le fond de sable pâle est **en marches de ~30 m** et se déplace entre deux captures de la même vue — avec
L3 comme sans. Ce n'est pas la surface maillée (elle refuse la plage basse : sol sous la borne des vagues, `seaFs`). Cause supposée :
la classification de l'eau peu profonde — la profondeur de Dean et le lavis tirés des distances au rivage aux nœuds de 38 m (niveau
3 du cache), dont l'iso-ligne suit les cellules des nœuds de terre, recuites quand les tuiles arrivent (au plus toutes les 2 s depuis
L1). C'est le « trait de côte en dents de scie qui change au recuit » de l'analyse du 10 novembre (§3). Il cache la lame de L3 dans
cette vue. Pistes : la distance au rivage d'un niveau plus fin (le niveau 2 du cache, 9,6 m) près de la caméra ; ou la profondeur du
pixel tirée du relief fin lui-même (la hauteur du sol sous l'eau) plutôt que des nœuds ; et un fondu sur quelques mètres au lieu du
seuil.

## ~~Des parois vertes à texture étirée au ras de l'eau, vues de la plage de l'Almanarre~~ — réglé le même jour : le LiDAR HD interpolé au-dessus de l'étang et de la plage (rampes jusqu'à 14,7 m, sous les seuils de 15 et 40 m) cède maintenant à RGE ALTI là où celui-ci dit niveau de la mer (`lidarYields`, `LIDAR_SEA_TRUST_M` 3 m, `earth-tiles.ts`) ; planche `docs/progress/mer/parois-tombolo-avant-apres.jpg`

**2026-11-11T05:45Z.** Observé (kerr-mini et ce Mac, sonde `forest-impostors` `IMPOSTOR_VIEW=43.066,6.1262,8,80,-9`, et `coast-swell`
vue `sand`) : à 8 m au-dessus de la plage de l'Almanarre, regard vers l'est, une paroi vert sombre de 10–15 m au loin (1–3 km) le long
du rivage, sa texture étirée en traînées verticales, sur une frange blanche ; une forme isolée pareille plus au centre. **Identique
avec les formes analytiques et avec les imposteurs** (`treeImpostorsOn`) : pas les arbres. Planche
`docs/progress/mer/parois-vertes-tombolo.jpg` (en haut formes, en bas imposteurs). **Cause supposée** (non vérifiée) : les
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

## ~~Le Lander posé ne décolle pas avec U (autopilote de décollage)~~ — réglé le 11 novembre 2026 : sur ses jambes, un départ vertical sur sa poussée vectorée, à plat sur son cap, jusqu'à 200 m, puis la loi de montée (`controller/lowthrust.ts` `ourSurfaceWant`, `camera.liftOff`) ; e2e `apprendre-vaisseaux` leçon 10 avec le Lander : +10 m en 3 s, orbite 100,0 ± 0,04 km (9/9)

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
- ~~**Des e2e lisent des membres qui n'existent pas**~~ — réglé le 11 novembre 2026 : `c.jetFigures()?.h` dans les 8
  fichiers, l'AGL par `__bh.sys.heightOverGround` (`cockpit-flight`, `ground-sunset`), l'élévation du Soleil par
  `__bh.camera.skyInfo().sun.altDeg` (`coast-survey`, et `earth-horizons`, `sky-open` qui lisaient
  `renderer.sunElevationDeg`, absent aussi) ; revolés : `cockpit-flight` (23 s, il s'arrête à 3 km), `runway-mesh`
  (altitude tenue à 4,5–5,6 m près). Ce qui était constaté :
  `c.jetModes.alt = c.last?.alt ?? …` dans 9 fichiers (`flight-quality`, `raster-motion`, `raster-flight`…) — `camera.last`
  n'existe pas (voulu : `c.jetFigures()?.h`) ; `cockpit-flight.e2e.test.ts` l. 60 et 82 attend `airInfo().agl` (pas de tel
  champ : l'étape « jusqu'à 3 km » court son plafond de 200 s) ; `coast-survey.e2e.test.ts:101` appelle
  `__bh.sys.sunElevation?.()` (inexistant : toujours `null`).
- ~~**U ne décolle probablement pas un F-35**~~ — confirmé en vol puis réglé le 11 novembre 2026 : le décollage
  automatique sur piste (`controller/runwaytakeoff.ts`) ; e2e `apprendre-avions` (la vraie touche U, 7/7). Ce qui était
  constaté : sur une piste, U lance l'autopilote de décollage orbital
  (`controller/lowthrust.ts`), qui refuse sous un rapport poussée/poids de 1,05 ; le F-35 sec est à ≈ 0,59.
  [F35.md](F35.md) dit que U décolle automatiquement. Piste : un essai en vol, puis un décollage propre aux avions ou la
  doc corrigée.
- ~~**Les grisés du HUD pour décoller et atterrir**~~ — confirmé et réglé le 11 novembre 2026 : la ligne du maintien de station
  (X1a, 998da6ac) s'était glissée entre `if (i.landed)` et son `else` ; rétabli — posé : atterrir et stationnaire grisés, décoller
  actif ; en l'air loin de tout sol (au-delà d'un demi-rayon) : décoller et atterrir grisés ; vérifié par une sonde (orbite
  à 505 km, posé, stationnaire à 300 m). Ce qui était constaté : (`src/ui/flighthud.ts`, vers la ligne 2274) dépendent d'un `else` qui
  semble rattaché à la condition du maintien de station : ils ne s'appliqueraient qu'avec un appareil à moins de 5 km.
- ~~**Affichage TAT/SAT de l'A320**~~ — confirmé et corrigé le 11 novembre 2026 : `air.T` est la température statique (la
  SAT) ; la TAT = T·(1 + 0,2 M²) en kelvins (`a320/du/data.ts` `airTemps`, test `a320-temps` : FL370 ISA M 0,78 → SAT −56,5 °C,
  TAT ≈ −30 °C). Non revu en jeu sur l'ECAM. Ce qui était constaté : (`src/a320/du/data.ts`, vers la ligne 203) : une température en °C divisée par
  `1 + 0,2 M²` ; la SAT affichée serait fausse en vitesse.
- **Limites non appliquées** — **décision de Sam (11 novembre 2026) : laisser tel quel** (ni alarme ni dégât ajoutés ; la doc le dit) : aucune vitesse de train, de volets ni VMO n'endommage un avion ;
  aucune masse maximale de l'A320 ; la ZFW du MCDU ne change pas la masse ; le ralenti du F135 n'est pas lu (manette 0 =
  poussée 0).

## ~~Près des mondes de Gargantua : deux points vus en vérifiant CIRC (11 novembre 2026)~~ — réglés le même jour : la hauteur par défaut au-dessus de l'air (`game/place.ts`, Miller 200 km, une minute sans dommage) ; le décollage (`controller/planet.ts`) tourne à `frameRate(F)`, part à la verticale et finit par CIRC — il ne quittait d'ailleurs pas le sol (constaté en vol) ; e2e `gargantua-circ`

- **`game.orbit("miller")` par défaut (100 km) place le Ranger dans l'air de Miller** : à ~10 km/s, sa coque y brûle en moins de
  40 s (« the hull burnt through at 1151 K ») — la hauteur par défaut des planètes de Gargantua (BH-API : 100 km) est sous le haut
  de l'air de Miller. Constaté par une sonde (ce Mac) ; non corrigé (choix : la hauteur par défaut au-dessus de l'air, comme de
  notre côté « clear of the air × 1,25 »).
- **Le décollage de Miller (`controller/planet.ts` `surfaceWant`) tourne le repère à n·ut**, quand le placement en orbite et la
  circularisation prennent `frameRate(F)` (l'étirement de la métrique près de Gargantua compris) : la vitesse orbitale qu'il vise
  peut être fausse de quelques pour cent. Lecture du code seulement ; non volé.

## ~~Les houppiers proches très étirés sur une pente raide (Chamonix)~~ — réglé le 12 novembre 2026 : l'élancement du houppier borné par sorte (les bandes jaunes, à part, restent ouvertes)

- **Constaté le 12 novembre 2026** (sonde `forest-wind`, kerr-mini, avec et sans vent : ce n'est pas le vent) : sur la pente boisée au-dessus
  de Chamonix (45,912 N, 6,872 E), la vue 40 m au-dessus du sol, 15° vers le bas — les feuillus en « œufs » hauts et étroits, les
  conifères en colonnes à étages, des bandes jaunes de sol au soleil entre eux. Capture
  `remote-results/20261112-020906-forest-wind/artifacts/remote-results/forest-wind-alps5/p1-still-a.png`.
- **Cause trouvée et corrigée le 12 novembre 2026** : le rayon d'un houppier est celui de la cellule (7 m : 2,1–3,3 m), sa
  hauteur celle de l'arbre (le MNH de l'IGN : 25–33 m pour les épicéas et les hêtres des Alpes) — un feuillu de 30 m devenait un
  ellipsoïde de 10 m de demi-hauteur sur 2,7 m de rayon, un épicéa un cône 12 fois plus long que large. L'élancement est maintenant
  borné par sorte (`KIND_SHAPES.slender` : demi-hauteur ≤ 1,5 rayon pour un houppier rond, longueur ≤ 6 rayons de base pour un
  cône, 5 pour un fuseau), le sommet en place, le fût plus long et entrant d'un dixième dans le houppier : un seul lecteur WGSL
  (`forest.wgsl` `forestShape`, pour le traceur, le raster et ses proxies), son jumeau CPU (`forest.ts` `shapeOf`, pour les contacts
  et `check-forest`), et les modèles des imposteurs (`tree-model.ts` `treeEnvelope`). Planche
  `docs/progress/vegetation/houppiers-elancement-chamonix.jpg`.
- **Reste ouvert — les bandes jaunes en diagonale entre les arbres** (avant et après). **Cause établie le 12 novembre 2026** (sonde
  `forest-wind`, `WIND_AB=treeShadowOn`, même vue, ce Mac) : sans la carte d'ombre des arbres, plus de bandes. La pente regarde au
  nord-ouest, le Soleil de 9 h 30 UTC vient de l'est-sud-est : incidence ≈ 74°, les ombres des houppiers très allongées, les trouées
  en bandes. Et la carte dessine les **proxies circonscrits sans découpe** (`scenery-raster.ts` `shadowVs`, aucun fragment) :
  l'octaèdre d'un houppier rond couvre vu du dessus ~1,9 × l'aire de son disque, la pyramide d'un cône 1,27 × — les ombres d'arbres
  presque deux fois trop larges, opaques et à bords francs. **Correctif proposé, écrit puis mis de côté** (Sam, même jour : J1 d'abord,
  sans changer l'image) : un `shadowFs` qui écarte les texels hors de la silhouette du houppier vue du Soleil (droite vers le Soleil
  dans le repère unité de la sphère ou du cône), la profondeur restant celle du proxy ; à mesurer (`trees' shadow map`, image).

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

## ~~Le ciel de nuit de la sonde de lumière du Ranger, ~40 fois son sol~~ — réglé le 13 novembre 2026 (~21:41 UTC) : la borne provisoire retirée

- **Constaté le 6 novembre 2026** (AM2). La nuit à Tromsø, la mer des fjords dessinait une bande blanche saturée le long de
  l'horizon, avec ou sans Lune. La sonde relue : son ciel ~4·10⁻⁶, son sol ~10⁻⁷ (unités de la scène), alors que la vue
  principale dessine le ciel plus sombre que la neige. Sans le vaisseau, la bande disparaît (moyenne 170 → 4).
- **Raccord provisoire** (a1e34357) : dans `seaShade`, le reflet de la sonde est borné à 4 fois le ciel clair du modèle de la
  caméra.
- **À trouver** : pourquoi le ciel de la sonde est si clair la nuit (échelle du fond de ciel liée à l'exposition ?
  `physicalPoints` des étoiles ?) ; puis retirer la borne.
- **Relevé du 13 nov.** (~20:54 UTC, phase J0 `probedump` au-dessus de Tromsø à 500 m, `PROBE_DATES` 15 déc. 22:00 et 11:00 UTC, run
  `…-probedump-tromso`) : la nuit, la sonde (f32) vaut ~1,2·10⁻¹⁰ en haut, ~1·10⁻¹¹ en bas (axes de la sonde) ; le jour d'hiver ~1,6·10⁻⁷ /
  ~9·10⁻⁸. Les 4·10⁻⁶ du 6 nov. ne se reproduisent pas (le modèle de nuit a changé depuis). **Lié** : jusqu'au 13 nov. la sonde était recopiée
  brute en demi-flottants — à ~10⁻¹⁰ la nuit, mille fois sous le plus petit normal : le ciel reflété par la mer y était **nul** ; depuis la mise
  à l'échelle (PROBLEMES ci-dessus, réglé) il est lu. `probeNoStar` écarté (il ne retire que l'astre principal, pas le fond d'étoiles).
  **Reste** : revoir la nuit à Tromsø avec la mise à l'échelle pour décider si la borne `4 × ciel clair` sert encore.
- **Revu** (~21:01 UTC, phase `seadusk` à Tromsø, `SEADUSK_DATE` 15 déc. 22:00, vue de trois quarts vers l'est, run `…-seadusk-tromso` ; un levier
  de mesure `TUNE_SEA_NOCLAMP` ôte la borne) : **aucune bande blanche, avec ou sans la borne** ; 143 000 pixels diffèrent de plus de 6 entre
  les deux vues, sans A/A pour séparer la borne du scintillement des lumières et des étoiles. **Non conclu** : la vue d'origine (les fjords vers
  l'horizon, l'e2e des aurores AM2) reste à revoir avant de retirer la borne ; le levier reste (0 par défaut) jusque-là.
- **Réglé** (~21:41 UTC) : la vue d'origine (`aurora-oval`, Tromsø au sol vers le sud, Kp 4 ; `AO_TUNE` passe un levier à chaque vue) **sans
  la borne** : aucune bande blanche (le bas de l'image 31,3 contre 30,9 avec la borne, le ciel 9,0 / 9,0 ; runs `…-aurora-clamp`,
  `…-aurora-noclamp5`) ; au crépuscule de J0, la mer 76,05 contre 76,04 (`…-seadusk-clamp`). La borne n'agissait plus nulle part depuis la mise
  à l'échelle de la sonde (les sous-normaux des demi-flottants, ci-dessus) : **retirée de `seaShade`** avec son levier.

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

## ~~Le traceur (pipeline « trace ») au large de Big Sur : une nappe sombre plate jusqu'à l'horizon~~ — non reproduit le 13 novembre 2026

- **Constaté le 6 novembre 2026** (sonde e2e, vol à 450 m au large de Big Sur, cap 150°, `earthPipeline: "trace"`) : une nappe
  plate et sombre au-dessus de la mer, à droite, jusqu'à l'horizon, avec un trait clair le long de la côte. **Elle est
  identique avec le relief national coupé** (`earthIgnRelief: false`) : elle ne vient pas de Mapterhorn, elle précède le lot D.
  Le raster (le pipeline par défaut) ne la montre pas.
- **Piste** : la profondeur de la mer du traceur (`seaDepthAt`, niveaux z 8–10 de Terrarium) ou sa surface de mer lointaine ;
  sonder les pixels de la nappe (distance, `gq`, profondeur lue).
- **Regardé le 13 nov.** (~21:46 UTC, phase J0 `tracedview`, au large de Big Sur à 450 m cap 150°, 20:00 UTC, raster puis tracé ; run
  `…-bigsur-traced`) : **non concluant** — l'appareil incliné, le ciel et les nuages occupent la vue, la mer à droite à peine visible. Une piste
  nouvelle à vérifier : la sonde stockée en demi-flottants sous-normaux (réglée ce jour, ci-dessus) assombrissait le ciel reflété par la mer
  du traceur aussi. À refaire en vol tenu, la mer à droite dans le cadre (une vue `around`).
- **Non reproduit** (~21:51 UTC, run `…-bigsur-traced2`, vues `around` des deux côtés, pipeline tracé) : la mer d'un bleu normal jusqu'à
  l'horizon des deux côtés, la côte de Big Sur d'un côté — **aucune nappe sombre**. Cause probable (non prouvée : d'autres changements depuis
  le 6 nov.) : le ciel reflété lu dans la sonde en demi-flottants sous-normaux, réglé ce jour. À rouvrir si revu.

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
  échoué au-dessus de la zone. ~~**Restent à convertir**~~ — convertis le 11 novembre (`zones`, `zones-scenery`, `pwa`,
  `overture` : `app.offline`, recoupé après chaque `load`). Relancés, ce Mac et kerr-mini :
  - `pwa` **2/2**.
  - Le **serveur de développement** des e2e servait un `precache.json` vide (la production liste ses workers et son WASM) : au
    rechargement hors ligne, ni `earth-surface-worker.js` ni `terrain-mesh-worker.js` — le relief jamais demandé (0 tuile). Il sert
    maintenant la même liste que la production (`server.ts`) ; c'était la cause des « workers manquants » plus bas, propre au banc.
  - `zones` **vert** (ce Mac) : en vol tout vient de la zone (553 tuiles, 0 du réseau, 0 échec) ; au rechargement 53–68 tuiles hors
    zone échouent — le point sous l'orbite de départ de `game:artemis` (Terrarium et Sentinel-2 z 12 vers 2,5° E, 14,6° S) et des
    niveaux larges de GIBS : attendu, sans effet sur la vallée. Le « détail » qui manquait (3,7 contre 8,2) **était la mesure** :
    prise en phase realtime (hors du mode photo la vue raster ne converge pas — `renderer.rasterHold`), elle allait de 3,7 à 8,4
    d'un passage à l'autre, les mêmes tuiles dessinées ; mesurée en mode photo, convergée : 6,03 en ligne, 6,26 hors ligne.
  - `overture` : en ligne, 980 bâtiments au lieu de 8 000 — **le test lisait la scène rapide** (T8m, 3 nov. : à 140 m/s il était
    en « vol rapide », ses scènes rapides seules, 8 000 × 0,35² = 980) ; il vole maintenant à 100 m/s et attend `!quick`
    (`earthScenery.stats().quick`, nouveau) : 8 000 bâtiments, comme le 24 octobre (données d'Overture identiques entre ses
    publications 2026-09-23.1 et 2026-10-21.0 : 21 568 bâtiments sur les 9 tuiles). Encore **rouge** plus loin : au
    rechargement en ligne, 3 requêtes Overture au réseau sur 99 (la liste des publications et deux plages) — peut-être les
    plages d'une scène abandonnée (annulées, jamais gardées) ; non établi. **Puis** : le centre de la scène fixé (l'appareil replacé
    gelé : 9 tuiles des deux côtés) — toujours 3 ; le Service Worker relève maintenant les plages coupées avant leur fin
    (`pwa.stats().served.rangesCut`) — aucune. Ni l'éviction (71 Mo sur 315). **Établi ensuite** : ces plages sont celles du
    thème `base` d'Overture (éoliennes, pylônes jusqu'à 15 km, dont la sélection varie d'une visite à l'autre), compté avec les
    bâtiments ; séparé (`pwa/rules.ts` : `overture-base`) — au rechargement les bâtiments viennent tous du cache (12, 0 au réseau),
    hors ligne les 8 000 de la zone : **`overture` vert** (kerr-mini, 319 s). Reste noté : le thème `base` redemande au réseau 3
    de ses ~90 plages à chaque visite.
  - `zones-scenery` : il attend la scène complète (`!quick`) avant de compter ; après le vol à 120 m/s, une scène rapide permise (le
    vol rapide de T8m). Relancé une fois (ce Mac) : **rouge avant le hors ligne** — le téléchargement de la zone (476 Mo) a pris
    1 175 s et laissé 23 liens en échec (réseau, IGN). **Puis établi** (relances instrumentées sur kerr-mini) : (1) un lot sans
    réponse en 120 s mettait le téléchargement **en pause pour de bon** (3 456 / 8 620) — réglé (`pwa-zones.ts` : le lot redemandé à
    la fin, pause seulement après trois de suite ; `tests/pwa-zones.test.ts`) ; (2) une reprise comptait ses liens deux fois —
    réglé ; (3) l'estimation disait 400 s pour ~1 170 mesurées — recalée (`zoneDuration` : les chaînes de la Géoplateforme ~4,6
    par seconde) ; le temps passe dans les lots (l'attente du jeu : 2 à 30 s). Reste : 6 à 13 chaînes en échec à chaque passage,
    même après une reprise — des grilles WMS-R de l'IGN (LiDAR MNT/MNH, RGE ALTI HIGHRES z 11–12) : **HTTP 400** (au-delà de son
    débit) et **HTTP 502** ; seules, plus tard, elles répondent en 0,2–0,8 s depuis ce Mac et kerr-mini, mais l'une a mis **64 s**
    (`11/1068/733`) : le serveur de l'IGN dépasse par moments sa minute de passerelle sur certaines tuiles. Cinq essais espacés
    jusqu'à 16 s ont été essayés et retirés (les lots passaient leurs 120 s : 54 échecs, 1 530 s) ; gardés : trois essais, une pause
    de 30 s avant la dernière demande des échecs, l'erreur relevée. Le produit fait ce qu'il faut (la zone en pause, ses échecs
    nommés, une reprise plus tard) ; le test reprend la zone 12 minutes au plus. **Puis réglé** : le 400 `LayerNotDefined` (hors de la
    couverture du LiDAR HD) lu comme une absence (le repli RGE ALTI pris), et le téléchargement hors du cache HTTP du navigateur
    (soupçon : un 502 de passerelle gardé là, resservi à chaque reprise) — **`zones-scenery` vert** (kerr-mini, 1 007 s : la zone en
    851 s, 0 échec ; hors ligne 313 596 arbres, 8 000 bâtiments, 447 tuiles de sol, tout de la zone, 0 du réseau). Un seul passage
    vert : à revoir sur d'autres.
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
- ~~**Pluie**~~ (réglé le 11 novembre, 2db276ba : la comparaison en pause faite en mode photo — 2/2) : l'e2e `rain` (« paused, the rain holds… ») échoue aussi avant et après le 11 (la vue en pause n'atteint pas
  `converged` en 150 s) — même démarche.
