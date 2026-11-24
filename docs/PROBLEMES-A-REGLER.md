# Problèmes à régler

Problèmes constatés, pas encore réglés. Chaque entrée : la date (UTC), ce qui est mesuré ou observé et sa source, la cause
connue ou supposée, la piste. Une entrée réglée est barrée avec le commit qui la règle, pas effacée.

## Un trait clair et un « poteau » sombre à travers un F-35 posé sur le mont Faron (relevé le 24 novembre 2026, e2e `j2-contact-camera`, campagne 1)

- **Constat** : F-35 posé sur le flanc sud du mont Faron (43,1405° N, 5,942° E, scène J0, 11 h UTC), caméra « autour » à ~25 m
  devant lui (yaw 180, tangage 8°) : un trait rectiligne bleu pâle, couleur de ciel, part de l'emplanture de l'aile droite vers la
  gauche de l'image, s'élargissant vers le bord ; et un trait vertical brun sombre (un « poteau ») descend du train avant jusqu'au
  bas de l'image. Reproduit sur ce Mac (sonde jetable, 24 nov., 14 lancements) ; vu de 1,5 km, de côté ou de plus haut (yaw 160,
  tangage 20°) : rien. Sur le mont Diablo (Californie), vu de derrière seulement : rien (la vue de face n'y a pas été essayée).
- **Écarté** (les deux traits restent) : la passe du vaisseau entière (`debugSkipShip`), sa carte d'ombre, ses jets, lampes,
  traînées et panaches (`ship.debugSkip`), `shipInScene`, l'air J3-2, le chemin prédit (`pathInView` ; `cameraPath` nul), les
  ancres de contact J2-2, les réverbères (`earthStreetLamps`), l'herbe (`earthGrass`), la TAAU, les imposteurs, les arbres proches
  en 3D (`nearTreeGeometryOn`) et leurs ombres, la couche `#overlay`, et dans `liteSkip` : ombre de l'appareil, ombres de contact,
  occlusion du sol, ciel/rebond, spéculaire, vallées, ombres du relief et du décor (bits 2 et 4, interrupteurs `groundSpecular`/
  `skyOpen` allumés pour qu'ils passent).
- **Ce qui les fait disparaître** : `liteSkip` 64 (les arbres retirés du matériau du raster) — les deux traits partent ; et le
  pipeline tracé (`earthPipeline` « trace »). `surfaceAt` lit sous le trait clair des arbres réels (objets 243157, 243158, 243849,
  11 à 30 m), sous le « poteau » du sol (15,8 m) : rien de la visibilité n'a cette forme ; c'est l'ombrage des arbres du matériau
  (`shadeLite`, `sceneryTreeLite` — ses arbres tracés dans le matériau) qui les dessine.
- **Piste** : un arbre du matériau dégénéré à la place de l'appareil (un tronc — le poteau — et un houppier étiré en fil vers
  l'horizon — le trait), ou un rayon du matériau qui rencontre l'appareil comme un arbre ; lire l'enregistrement d'arbre que
  `sceneryTreeLite` touche sur ces pixels (sonde du tracé d'une colonne, `colTraceFrame`) et regarder les exclusions de forêt
  autour d'un appareil posé (`forest-exclusions.ts`). Non réglé dans cette session.

## ~~Le navire suivi en caméra libre, sans appareil : ni coque ni sillage~~ (relevé le 24 novembre 2026, e2e `traffic-free-camera`, campagne 1) — réglé le même jour (`c716fefd`)

- **Constat** : « JILLIAN IRENE » suivi à 49 m (vue Chase, aucun appareil piloté, baie de San Francisco) : ses feux seuls, ni coque
  ni sillage. Sonde : un porte-conteneurs à 484 m invisible ; dessiné en gris plat (`ship.debugFs` 8) ou sans le test d'occultation
  du trafic (`far` éteint) ; la profondeur d'occlusion sous la coque à quelques mètres (`moments.y` de la mer : 0,6 à 7 m pour une
  mer à 150 m–3 km).
- **Cause** : `subjectStep` (camera/subjectcam.ts) plaçait la vue pour le début du pas, la simulation avançant son horloge après :
  le rendu dessinait la Terre une image de son mouvement orbital plus loin (patch proche à −223 m d'ellipsoïde pour une vue à 67 m, à
  ×1 ; −2,8 km à ×10 ; juste à l'arrêt). Le maillage de la mer (`seaSurf.hc` borné à 0,3 m) tombait sous la caméra et le navire,
  testé contre cette distance, était caché entier.
- **Correction** : la vue placée pour la fin de l'image (comme le rig, controller/rig.ts) et l'horloge du contrôleur à cette fin
  (`shipTime`, controller/lens.ts) : ce qui lit la vue (le trafic placé depuis elle, `geoNow`, le HUD) le fait à l'instant dessiné.
  e2e `traffic-free-camera` : hauteur du sol dessiné et de la vue à moins de 10 m (avant 290 m ; après 12,5 / 12,5 m), le chalutier
  suivi à 76 m avec sa coque et son sillage.

## ~~Le marcheur translucide en raster (fantôme)~~ (relevé le 24 novembre 2026, e2e `walk-raster`, campagne 1) — réglé le même jour (`6d003e5b`)

- **Constat** : à pied à Chamonix, pipeline raster : l'astronaute n'est qu'un fantôme orangé, l'herbe absente.
- **Cause** : E11 (marcheur, herbe, pierres, couvert bas, ombre portée) encodé après E5 `temporal` : l'image de la TAAU — celle que
  montre l'écran dès que l'image vivante est rendue sous le canevas — ne les recevait jamais ; seule fuyait l'image d'avant.
- **Correction** : E11 avant le temporel, son mouvement écrit (marque w 1 ; le marcheur au même pixel, l'herbe reprojetée par le sol).
  Vérifié en image ici (walk-raster, `WALK_SPOTS` 45,80 ; 6,98) : astronaute opaque, herbe et pierres présentes.

## ~~« Descend, descend! » contre le ravitailleur, 1 e2e `aar` sur 3~~ (relevé le 24 novembre 2026, campagne e2e 1) — réglé le même jour (`d51017b2`)

- **Constat** : un RA « Descend, descend! » dit une fois pendant l'e2e `aar` malgré le TA ONLY (1 lancement sur 3, ici).
- **Cause** : le TA ONLY suivait `!!this.aar`, nul dès la fin de la session (« cleared to depart », sonde rentrée). Le ravitaillé reste
  alors à quelques mètres derrière et sous le ravitailleur, à sa vitesse ; au moindre rapprochement, RA. Sans tête, sur les 40 s qui
  suivent le départ : 454 pas d'RA sans maintien.
- **Correction** : `radar/tcas.ts` `aarTaOnly`, `controls.aarTaHold` posé par `aarOff` : TA ONLY toute la session et après, tant que le
  ravitailleur est à moins de 2 NM et 1 200 ft (ou hors de l'image moins de 5 s). Tests `tcas.test.ts`, `aar.test.ts` (0 RA après le départ).

## ~~Un avion de ligne garé dessiné 23 m sous le sol (SFO)~~ (relevé le 24 novembre 2026, e2e `traffic-free-camera`) — réglé le même jour (`825f1d45`)

- **Constat** : N796UA, un 777 garé à SFO (0,7 kt, `alt_baro` −200 ft numérique et non « ground ») étiqueté « −23 m », en vol sous le sol.
- **Cause** : `server/traffic.ts` ne le compte au sol que si `alt_baro === "ground"` ; beaucoup de transpondeurs au parking envoient une
  altitude-pression.
- **Correction** : `traffic/feed.ts` `groundedReport` : lent (< 35 kt), en palier et au plus au sol de l'aérodrome voisin (tuiles des
  pistes, altitude mer + géoïde) plus 270 m (baro) ou 60 m (géométrique) — au sol ; hélicoptères, planeurs, ballons, drones laissés à leur
  source. `controller/traffic.ts` ne dessine plus un avion en vol sous le sol du monde (posé dessus, sous 9 000 m). Test `traffic-ground.test.ts`.

## ~~OBC : `pi` introuvable après `obc-install` ; téléchargement de Claude Code coupé par Wisp~~ (relevé le 24 novembre 2026, e2e `obc`) — réglé le même jour (`6f493924`)

- **Constat** : `sh: pi: not found` (127) sur Alpine et Debian ; une fois, « wget: connection closed prematurely » sur les 130 Mo de Claude Code.
- **Cause** : sans `BUN_INSTALL`, `bun add -g` suit `XDG_CACHE_HOME` (`/tmp/.cache`) : `pi` dans `/tmp/.cache/.bun/bin`, hors PATH et en RAM.
  Le shim kw de Claude Code télécharge en flux, sans reprise.
- **Correction** : `BUN_INSTALL=$HOME/.bun` (obc-install, env invité, `profile.d`), `pi` lié depuis `bun pm bin -g` ; Claude Code
  téléchargé par `obc-install` sur le disque de données, repris par plage HTTP (8 essais), vérifié (zstd puis SHA-256 du manifeste).

## Ponts et routes : géométrie, supports et parité incomplets (21 novembre 2026)

**Établi en lecture du code `3a86f5e1` et sur entrées contrôlées, pas par une nouvelle observation en jeu.**
`deckBridge` calcule un profil continu mais construit des prismes à dessus horizontal ; trafic et contacts ne lisent
pas la même surface. Le constructeur ne distingue pas les bouts ouverts de tuiles des vraies culées. La recherche
du tablier par XY ne porte pas d'identité/niveau. Les ponts contournent le matériau routier partagé ; leur loin
emploie des dalles sur un plan de sol de cellule, sans hauteur de tablier pour les voitures. Les phases de pointillés
des routes repartent par segment. Le nivellement `roadProfile/roadBank` existe comme fonctions, sans lecteur de
production appliquant ce profil au terrain et aux contacts.

Sonde du constructeur réel, cas **synthétique** de 100 m : marches jusqu'à 2,75 m ; ce n'est pas une mesure d'un
pont réel. Le cas de chaînage route/rail et la clé de dédoublonnage locale révèlent des risques reproductibles ;
aucun doublon trouvé dans les cinq records réels de Seine examinés. Les 37 tests unitaires ciblés passent,
sans prouver la continuité du tablier. Sources locales : `remote-results/bridges-analysis-probes.json`,
`remote-results/bridges-analysis-tests.log` ; sources de code et limites détaillées dans le
[plan Ponts et routes AAA](PLAN-PONT-ROUTES-AAA.md#2-existant-vérifié-et-causes-des-écarts).

**Suite proposée :** PR0–PR8/PR-R de ce plan, identité/profil communs avant finitions. Aucune correction implémentée
par la session documentaire ; J8 conserve sa clôture historique.

## ~~Grand carré d'ombre : récepteur hors profondeur des cascades~~ (21 novembre 2026, 07:44 UTC)

**Corrigé le 21 novembre à 08:01 UTC — commit `fix(shadows): prevent square terrain shadows on Earth and Moon`.** Le lecteur partagé contrôle la
distance du récepteur le long du Soleil, **en mètres avant normalisation**, dans la sélection et le fondu des
cascades. Hors volume, la suivante puis la marche/horizons reprennent. Même correctif pour la Terre et la
Lune (`encodeBodySunShadow`, cascade 0), sans agrandir ±20 km ni changer de texture/passe.

**Vérifié** : `sun-shadow-depth`, rapport `20261121-080037-MacBook-Pro-de-olivier`, fenêtre visible M1 Max :
1 test, 31 assertions, zéro erreur GPU/page. Treize cas sur le lecteur WGSL réel (plans proche/lointain,
carte vide, occultant, cascade suivante, fondu) ; A/A exact, huit cas réfutent l'ancien lecteur injecté.
La pose de Sam n'a plus le grand carré ; comparaison carte active/coupée : 2 211 pixels au seuil de 8 niveaux,
contre un bruit A/A de 1 668, sur 1 714 770 pixels hors interface. Lune à 30 km : 0 pixel au même seuil, A/A 0,
avec luminance médiane 117/255 (image non saturée). Lune à 5 km, Soleil rasant : couper toutes les ombres
du relief change 8 479 pixels contre un bruit A/A de 459 ; les ombres légitimes restent présentes.
Sources versionnées : `tests/e2e/sun-shadow-depth.e2e.test.ts`, `lib/sun-shadow-depth.ts`,
`lib/square-shadow-view.ts` ; captures et JSON dans `remote-results/sun-shadow-depth/`.
84/84 WGSL, TypeScript, Biome, inventaire du pipeline et 18 tests unitaires ciblés passent.

**Historique du diagnostic initial (07:44 UTC, avant correction).** Sur le M1 Max, arbre `b179e0b6`, pose fournie par Sam :
Monument Valley, latitude `36.876883648196284`, longitude `-110.51352643813274`, hauteur WGS84
`19829.09353049848 m` (environ 18 km AGL), temps `-3295162.2539921496 M` (`2015-07-27 22:33 UTC`).
Chargement par `game.load` puis `step(0)` ; coordonnées contrôlées, horloge gelée, sortie 2225 × 863,
échelle 0,75, données et shaders prêts. La simple copie des réglages laisse un rig de la scène précédente :
le premier essai a échoué sur les coordonnées et ne constitue pas une preuve d'image.

**Preuves locales** : sonde `tests/e2e/zz-square-shadow.e2e.test.ts` (ignorée par git), journal
`remote-results/square-shadow-20261121-depth.log`, captures et `state.json` dans
`remote-results/square-shadow-20261121/`, rapport `20261121-074407-MacBook-Pro-de-olivier` :
1 test passe, 6 assertions, aucune erreur de page/GPU. La carte de profondeur est lue par un compute
(`TEXTURE_BINDING` → tampon), avec scope de validation ; aucune copie illégale de `sunDepth` sans `COPY_SRC`.

- Référence A/A : 13 pixels diffèrent de plus de 8 niveaux de luminance, hors bandeau haut/marge gauche.
  Couper seulement `sunShadowOn` enlève le carré : 456 148 pixels s'éclaircissent de plus de 8 niveaux.
- Les cascades couvrent latéralement 374 943 pixels du sol raster (1668 × 647). La reconstruction de leurs
  récepteurs au centre des pixels en compte 274 834 hors profondeur `[0, 1]` à ±20 km ; cette sonde n'intègre
  pas la gigue sous-pixel. Exemple `(600,100)` : `dz=1.34549`, profondeur de carte **1**, soit un faux obstacle
  `ahead=13819.6 m`. Le lecteur ne vérifie que x/y, puis assimile ce fond vide à un occultant.
- À **±40 km**, sans couper les cascades, ces mêmes récepteurs sont tous dans la profondeur (`dz` maximal
  0,93875 contre 1,37749 à ±20 km) et le grand carré disparaît. Le retour à ±20 km le rétablit
  (12 pixels seulement diffèrent de plus de 8 niveaux de la référence). Ce changement de portée est un
  **témoin de diagnostic**, pas un correctif livré ni une recommandation de doubler la profondeur.

**Correctif proposé lors du diagnostic, désormais réalisé ci-dessus** : vérifier la profondeur du récepteur avant `sunCascadeRead` dans
`src/system/terrain-raster-hint.ts` (`sunShadowFarAt`), y compris pour la seconde cascade dans le fondu.
Une cascade sans couverture valide doit laisser la suivante, puis les horizons, prendre le relais.
Le « trou des niveaux 0–2 » n'explique pas le grand carré : une profondeur vide à 1 ne l'ombre que parce
que le récepteur dépasse lui-même 1. Un petit carré reste visible dans le diagnostic des ombres à ±40 km :
ne pas déclarer tous les défauts d'ombre résolus. À ce stade initial, aucun shader produit modifié, aucun coût GPU mesuré.
Le petit artefact relevé avec l'extension expérimentale à ±40 km n'a pas fait l'objet d'un correctif distinct.

## J9-3, prototype éteint : les feuilles proches beaucoup plus claires que la forêt (20 novembre 2026)

**Observé sur kerr-mini**, A/B/A `20261120-104528-j9-geometry-final-prototype`, source et captures dans
[la fiche J9-3](progress/j9/J9-3-PROTOTYPE.md). La géométrie proche est réellement dessinée, mais son feuillage tranche
par sa clarté et son aspect plat. Cause non isolée ; comparer normale, occlusion locale et matériau partagé, pas un facteur
arbitraire d'assombrissement. `nearTreeGeometryOn` reste **faux par défaut**. Le raccord brut à 80 m et les ombres encore
portées par les proxies sont d'autres limites connues du prototype ; lots J9-4/J9-5 avant acceptation. Aucun défaut nouveau
activé par ce levier dans les réglages produit.

## La couche lointaine de nuit : des carrés blancs éblouissants à l'horizon, **quelques secondes après un saut à la nuit** (relevé le 16 novembre 2026, PLAN-J8 J8-A)

**Requalifié (16 nov. 2026, ~18:28 UTC, kerr-mini, `j8-junction` `J8J_JUMP`)** : ce n'est pas un effet des matériaux. La nuit, sautée
depuis le jour avec les matériaux, compte **1 382 pixels blancs 3 s après le saut et 18 après 30 s** (16 sans la couche). La capture à
l'aspect générique prise 3 s après le saut en compte 1 315. Les runs précédents prenaient la capture avec matériaux juste après le saut et
les autres plus tard : la fausse piste. Un **transitoire d'une trentaine de secondes après un changement d'heure brusque** (`setDate`, les
commandes du temps), la couche lointaine présente ; non vu en temps qui s'écoule. `farMaterials` rallumé par défaut. Cause du transitoire
non cherchée (l'adaptation de l'œil, l'historique temporel des pixels lointains ?) — gravité faible.

**Revu le 20 novembre.** Une capture M1 Max de Toulon après un saut à la nuit montre des lignes orange dans le ciel
(`j8-junction-ab/after/a-toulon-nuit.png`). La capture plus tardive avec la couche des bâtiments lointains coupée ne
les montre plus. Le rejeu kerr-mini (`20261120-191626-j8-night-stabilized`) n'en montre pas à 30 s, avant ou après
la correction de la lueur. La durée et la cause de cette variante sur le M1 Max restent à établir.

**Ce qui suit est l'historique de l'enquête (la piste des matériaux, abandonnée).**


**État (16 nov. 2026, ~17:35 UTC)** : ouvert, non réglé ; la couche lointaine (`farBuildingsOn`, allumée par défaut) et ses matériaux
sont commités en local, **non poussés** tant qu'il dure.
- **Vu** (kerr-mini, e2e `j8-junction` `J8J_DIAG`, runs 20261116-172520, 173855, 180558) : à 23 h, vue de Hyères vers l'ouest à 350 m,
  à 10–20 km, des carrés blancs avec un halo et une rangée de points orangés à la ligne d'horizon.
- **Isolé** :
  - présents avec les quads et la marque lointaine ;
  - absents avec les boîtes seules (`farQuadPx` 0), avec l'aspect générique (`farMaterials` false, sans marque) et sans la couche ;
  - la marque passée de la fraction du code raster (62,5) au signe de g ne les a pas fait disparaître (moins nombreux) ;
  - le diagnostic local hors ligne (M1 Max, données partielles) ne les reproduit pas.
- **Contournement essayé, sans effet** (run 20261116-183705) : les quads sans matériaux, les boîtes avec — les carrés restent ; ils
  tiennent aux matériaux des boîtes **et** à la présence des quads (boîtes seules : rien ; générique : rien).
- **Correctif** (~17:45 UTC) : `farMaterials` false par défaut (l'aspect générique, sans marque) — 646eac75 et 17681f10, déjà déployés
  par une poussée de la session des approches, portaient le défaut ; les matériaux restent derrière le levier.
- **Sondé** (run 20261116-184609 → j8-probe2, `surfaceAt(...).vis` aux pixels blancs repérés sur la capture) : 21 sur 24 sont du **ciel**
  (texel nul), un seul un bâtiment lointain à 13,2 km (g −11 850 240 : ses matériaux) ; les carrés sont le **halo du flou lumineux**
  autour de quelques pixels de bâtiments lointains d'une luminance énorme (ou infinie) — à chercher dans l'ombrage de ces pixels avec la
  marque (le chemin qui ne la lit pas, l'aspect générique, ne les rend pas).
- **Piste** : la normale des quads (`atNg`, lue des dérivées de la profondeur sur un quad d'un à trois pixels, au bord du ciel) envoie
  peut-être leurs pixels dans la branche « toit » ou dans une lumière que la marque déclenche ; à mesurer pixel par pixel
  (`surfaceAt`, la normale et le g) sur le mini.

## Une scène proche vide après un changement de jonction — la caméra libre hors de la Terre, dans l'e2e de jonction seulement (relevé le 16 novembre 2026, PLAN-J8 J8-5)

**Corrigé (16 nov. 2026, ~20:15 UTC)** : **le défaut du jeu supposé plus bas n'est pas établi.** Un e2e nouveau, `free-camera-hold`
(la caméra libre sans appareil au-dessus de Toulon : gelée, le monde qui tourne 60 s, l'heure sautée d'une heure et remise, l'heure
remise monde gelé puis relâché, replacée gelée puis relâchée), **passe sur ce Mac et sur kerr-mini** : `jumpTo` porte déjà la caméra
libre (`rig.ts` `groundHold`). La caméra perdue tient à quelque chose de propre à la séquence de `j8-junction` (ses réglages J0, la scène
refaite à chaque jonction, ses captures), non trouvé ; contourné en gardant le monde gelé (8/8 propres). `tools.ts` non modifié.

**Enquête (16 nov. 2026, ~21:45–22:10 UTC, hors ligne — `E2E_EARTH_DATA=offline`, aucune requête)** : **reproduit sur kerr-mini**
(run 20261116-225401-j8j-run-offline, `J8J_RUN=1` : le monde qui tourne pendant l'attente, comme avant le contournement) — Toulon,
jonctions 0, 1, 2 km propres, à 3 km la caméra perdue pendant l'attente de la scène (« away-from-earth », `geoNow()` null, GPU 13,4 ms,
la date 15:31 : une minute de monde), **pas au saut d'heure** ; replacée (`viewAt`), elle revient. **Pas reproduit sur ce Mac** :
15 étapes complètes sur 15 propres (Toulon et Hyères à 0 et 1 km, la 4ᵉ interrompue ; deux séquences 0–3 km à Toulon ; une avec le fil principal bloqué 400 ms toutes les 2 s, `J8J_STALL`
— les à-coups d'une machine lente ne la perdent pas ; le pas du jeu borné à 0,1 s, le même pour l'horloge et la caméra). **Écarté** :
les réglages de J0 (`free-camera-hold` `FCH_J0=1` : la caméra tient ; avec `ship: false` l'appareil n'est pas changé). **Vu en passant** :
`geoNow()` sans appareil oscille de −730 à +306 m sous la caméra tenue (la vue, elle, ne bouge pas : `surfaceAt` constant) — à
comprendre, peut-être le même désaccord d'horloge. **Prêt** : un enregistreur image par image (`J8J_RUN` : la place de la caméra,
`held()`, l'horloge ; les images autour d'une perte écrites au journal) — à lancer sur kerr-mini après la zone de Paris (02:15 UTC). **Lancé** (11/17 ~01:00 UTC, kerr-mini, run 20261117-012051, hors ligne, deux séquences 0–3 km à Toulon) : **0 perte sur 8 étapes** cette fois (1 sur 4 au premier run) — le défaut rare ; l'enregistreur reste prêt (`J8J_RUN`).
**Suite (~22:30 UTC, ce Mac, hors ligne)** : le rig de la caméra libre (`controller/rig.ts`) suivi image par image — 11 281 images
le monde tournant, deux scènes refaites : **aucun recalage** (`rig.key` stable, « free|moon|earth »), le décalage au centre de la Terre
constant au mètre (6 368,539 km) ; le corps le plus proche toujours la Terre (le Ranger d'Artemis à ~2,6 milliards de km ; au démarrage,
avant `viewAt`, le rig le suivait à ~200 m — il bascule bien sur la Terre). **L'oscillation de `geoNow()` expliquée** : `ourNav` lit la
caméra à l'heure courante, le rig la place pour la fin de l'image — une image de mouvement de la Terre (30 km/s × 20–60 ms), un
artefact de lecture entre deux images, pas un déplacement (le décalage du rig, lui, ne bouge pas). L'enregistreur de `J8J_RUN`
porte désormais le rig (clé, corps, décalage) et le corps le plus proche : la prochaine perte sur le mini dira lequel change.



**Trouvé (16 nov. 2026, ~19:25 UTC, kerr-mini, `j8-junction` — l'état de la page relevé au blocage)** : `earthScenery` « away-from-earth »,
`camera.geoNow()` null — **la caméra libre n'était plus sur la Terre**. Deux causes, une même chose : le monde qui tourne pendant l'attente de la scène (l'e2e dégelait le monde à chaque étape), et la remise de l'heure. L'e2e remettait l'heure (`game.setDate`) après avoir placé la caméra
libre (`viewAt`, `ship: false`) : `tools.ts` `jumpTo` porte d'une heure à l'autre l'appareil près d'un sol (`s.ship`), **pas la caméra
libre sans appareil**, laissée là où était la Terre — l'image noire (l'espace), la scène vide, le GPU à 14 ms ; par intermittence selon
l'écart de temps. **L'e2e corrigé** (le monde gelé pendant l'attente, la caméra replacée après chaque saut d'heure : run 20261116-…-j8-jx-frozen, 8 étapes sur 8 propres). **Le jeu** : un joueur en caméra libre (mode photo,
sans appareil) qui change la date perd la Terre de vue — à porter comme l'appareil (`jumpTo`), hors du domaine du rendu : à régler par
la session qui tient la caméra et le temps.

**Historique de l'enquête** :


**État (16 nov. 2026, ~17:35 UTC)** : ouvert, non expliqué.
- **Vu** (kerr-mini, e2e `j8-junction`) : trois runs sur cinq. À Toulon, au passage de la jonction à 2 km (une fois à 1 km), la scène
  ne redevient jamais entière en 60 s :
  - `status` « ready », `quick` vrai, 0 bâtiment, `corridorM` 0, pas de `phases` ;
  - l'image entièrement noire, ciel compris (99,9 % des pixels noirs), le GPU à 14 ms ;
  - ensuite, à Hyères, des scènes rapides de 5 000 bâtiments seulement et un GPU à 19 ms.
- **Écarté** : une perte du périphérique (`graphicsDiagnostic`, aucun `device-lost`).
- **Non reproduit** : Toulon seul, quatre jonctions (run 20261116-181851) ; le run complet 20261116-172520.
- **Piste** : l'annulation de la scène en cours quand la jonction change (`scenery.ts`, `changed` → `cancel`) au moment d'une
  scène rapide ; l'e2e relève désormais l'état de la page au blocage (caméra, scène, tuiles, pipeline).

## Les ombres du décor à Paris : `earth-scenery` les juge « plus d'éclaircis que d'assombris » (relevé le 16 novembre 2026, J8-T)

**État (16 nov. 2026, 14:11 UTC)** : relevé par la session des approches, non étudié. C'est le domaine du rendu (les ombres du décor).
Depuis que le cache disque des e2e (J8-T) laisse `earth-scenery` atteindre sa vérification d'ombre à Paris (elle n'y arrivait jamais à
temps sur le réseau, 120 s), la comparaison avec et sans les ombres du décor échoue de peu, deux fois de suite. Le test veut plus de
pixels assombris (seuil de luminance de 4) que d'éclaircis dans la zone centrale ; il a obtenu 905 contre 921, puis 948 contre 1 007.
L'écart vient peut-être de l'image qui s'affine entre les deux captures, plutôt que des ombres elles-mêmes : à vérifier, l'image gelée
et convergée. Non lié au cache : les données sont les mêmes, seule l'attente change. En attente derrière PLAN-J8.

## ~~Un appareil qui roule glisse de côté par rapport à la Terre, 0,2–0,4 m/s, loin de 2067~~ (relevé le 16 novembre 2026, e2e `takeoff-axis`) — réglé le même jour dans `controller/motion.ts` ; deux autres intégrateurs à revoir

- **Constaté** (ce Mac) : à Edwards, le 10 juillet 2026, l'A320 au décollage, cap dans l'axe à 0,09°, finit 8,2 m à droite de l'axe à VR
  (le F-35 4,8 m) ; les pneus ne voient aucun glissement (angles de dérive ≈ 0,001°), ni vent ni braquage ; rien au Bourget ce jour-là, rien
  à Edwards en 2067 (la date par défaut). La position avançait ~0,3 m/s de plus que la vitesse ne le dit.
- **Cause** : l'horloge du vol est comptée en M depuis 2067 ; en 2026 (|t| ≈ 2,6·10⁶ M), un double ne la résout qu'à ~0,1 µs, et chaque
  sous-pas de 4 ms sur le train avançait l'horloge d'un pas arrondi pendant que l'appareil avançait du pas exact : 14 µs perdues par seconde,
  soit 0,42 m/s contre la Terre emportée à 29,8 km/s sur son orbite (calculé : `bun` sur `EPOCH_DATE`/`M_SECONDS` ; 0 en 2067).
- **Réglé** : `motion.ts` avance l'appareil du pas que l'horloge prend vraiment (`(t + dt) − t`). Vérifié : sonde 2,02 m → 0,24 m en 8 s ;
  `takeoff-axis` 7/7 (A320 et F-35, Le Bourget, la piste la plus proche, Edwards, la pluie : ≤ 0,1° et ≤ 0,9 m jusqu'à VR) ; vol et train
  unitaires 91/91.
- **Les deux autres intégrateurs** (relus le même jour) : `system/our-coast.ts` (la flotte en roue libre) avait le même schéma — corrigé de
  même ; `system/iss.ts` rend l'heure exacte et avance de `n × span/n` — pas concerné. Non mesuré en vol pour la flotte.

## La piste du HUD contre la piste dessinée : alignée ; les autres pistes des sites du jeu flottaient (réglé) ; la vue en mouvement non mesurée (relevé le 16 novembre 2026, question de Sam, e2e `hud-runway-drawn`)

- **Mesuré** (ce Mac, 10 juillet 2026, de jour) : au seuil puis 3 km en finale, chaque coin du contour HUD contre la bande dessinée et nivelée
  (`EARTH_RUNWAYS`, le sol dessiné) — Le Bourget 25, Edwards 23L (sites du jeu), Toulon-Hyères 05 et sa 13 (le géoïde +49 m), Madrid
  18R et ses trois autres : cap identique (0,000°), seuil 0,0 m, largeur et longueur identiques, ≤ 0,023° vu de l'œil. Les sites du jeu sont
  posés sur les vraies extrémités (OurAirports : Le Bourget 25 = 48,974 / 2,45825, 3 000 m ; Edwards 23L = 34,918858 / −117,857377).
- **Écart réel, réglé le même jour** : aux sites du jeu, le HUD trace les **autres** pistes (Le Bourget 03/21 et 09/27, Edwards 05L/23R et
  07/25, AP7a) d'après OurAirports, sur un sol que le jeu ne nivelle pas (seule l'orthophoto les montre). Leur contour était un plan plat au
  niveau du relief sous leur seul seuil : la 05L d'Edwards **24 m au-dessus du sol** (1,15° vu du seuil de la 23L, sa ligne au-dessus de
  l'horizon) pendant l'arrivée du relief, encore 7 m une fois chargé (la piste penche : 2 312 → 2 289 ft), Le Bourget 03/21 6,7 m. Désormais
  (`controller/lowthrust.ts`) : le niveau = la médiane du sol sous la longueur, chaque bout posé sur le sol dessiné sous lui — mesuré
  ≤ 2,1 m (0,09° au seuil, ≤ 0,03° en finale). L'alignement en plan avec la photo dépend d'OurAirports (non mesuré).
- **Non mesuré** : la vue en mouvement (le contour d'une image en retard en virage ou en roulis, un coût d'une image à 20–30 images/s) ;
  et les e2e où Sam a vu l'écart — à nommer (avec le bandeau, désormais citable) pour reproduire ce cas-là.
- **Piste** : (1) que Sam cite l'e2e et le scénario ; (2) une mesure en virage (le contour projeté contre les coins dessinés, image par image) ;
  (3) dessiner/niveler les autres pistes des sites du jeu comme celles du monde (ou ne pas les tracer au HUD).

## ~~L'alarme « GEAR UP · TOO LOW » en montée après le décollage et en croisière rapide~~ (relevé le 16 novembre 2026, captures des parcours-*, règle 13) — réglé le même jour (`game/gear-warn.ts`)

Observé (kerr-mini, runs `20261116-092121-r13-again`, `…-090328-r13-parcours`) : « MASTER WARNING · GEAR UP · TOO LOW » et « Too low,
gear! » (1) au décollage automatique du F-35 à Toulon-Hyères, à 34 m, en montée à +9 m/s, 98 m/s, train rentré par le décollage
(`parcours-debarquer`, 3-off-again) ; (2) en croisière sur ses maintiens, 680 m d'altitude, 275 m au-dessus des collines, 140 m/s, en palier,
à 4 km de LFTZ (`parcours-camera`, 2-back-aboard). Cause lue : `controller/computer.ts` `gearWarn` — tout avion en l'air sous 300 m du
sol **et** sous 150 m/s, train rentré, quelle que soit la phase ; un avertisseur réel (GPWS mode 4) ne s'arme qu'en descente ou en approche
(environ < 150 m, < 100 m/s), et pas au décollage. **Non corrigé** (un système de vol : son cours, VOL-AVIONS, et son e2e) — à la session
qui tient le vol. Les tests de la règle 13 ne l'assertent pas encore (l'alarme n'est pas dans `flightState`).

- **Réglé (16 nov., session 1feb2f7f)** : `game/gear-warn.ts` — le mode 4A d'un GPWS (comme la voix EGPWS de l'A320,
  `a320/sound/callouts.ts`) : train rentré, sous 152 m sol (500 ft) et 98 m/s (190 kt), en descente, jamais dans la montée initiale (de
  l'envol à 457 m sol) ; `computer.ts` `gearWarn` le lit (HUD, voyant, annonce « Too low, gear! », crew). Les deux cas des parcours-* sans
  alarme, une approche basse et lente train rentré toujours alarmée : `tests/gear-warn.test.ts` 3/3. VOL-AVIONS, COCKPIT, cours.

## ~~Relancer une approche après une prise de manche ouvre un débriefing « F 0,0/20 » en plein vol~~ (relevé le 16 novembre 2026, `parcours-meteo`) — réglé le même jour (`controller/instructor.ts`)

Observé (run `20261116-095016-r13-meteo2`, 3-after-stick) : après le manche tenu 1,5 s pendant l'ILS de LFTH, `camera.ilsStart("LFTH")`
(l'appel de la roue et de TARS) relance l'approche ; l'approche précédente, reprise au manche, est notée « DEBRIEF — ILS APPROACH F 0.0/20 »
dans un panneau qui couvre la vue pendant le vol (« Intercept 4 s », « Within tolerance 0 % »). Un débriefing de l'approche abandonnée en plein
vol, au moment où le pilote la reprend, gêne ; à décider (le noter seulement à l'atterrissage, ou ne pas noter une approche reprise au
manche puis relancée). Non corrigé — à la session des approches.

- **Réglé (16 nov., session 1feb2f7f)** : l'instructeur ne débriefe une approche qu'à sa vraie fin — sur les roues (arrondi touché,
  roulage) ou remise de gaz ; abandonnée ou relancée (`ilsStart` la remet « vers l'IAF »), elle n'est pas notée. Test
  `tests/instructor.test.ts` (relancée vers l'autre bout : aucun débriefing ; ramenée et posée : un) — témoin : sans la correction, il échoue.

## Le détail procédural au-delà du couloir d'approche de J7-1 : 4 485 extrémités où il dépasse les données de plus de 300 m (relevé le 16 novembre 2026, `scripts/approach-detail-beyond.ts`)

Mesuré (sans navigateur, carte mondiale `relief-high.bin` et l'échantillonneur du jeu sans tuiles) : sur l'axe de chaque extrémité de
piste du monde de 10 à 18,5 km — au-delà du couloir de J7-1 (7128cffe, 10 km), jusqu'au point initial —, l'excès du sol avec détail
sur les données : < 50 m pour 54 534 extrémités, 50–100 m 3 302, 100–200 m 3 009, 200–300 m 1 584, **> 300 m 4 485** (6,7 %). Les données
dégageant la pente de 150 m et plus, le détail vient à moins de 90 m de la pente sur 2 294 extrémités et **la traverse sur 1 607** — pires :
l'Altiplano bolivien (SLCB 05 : −444 m à 10,3 km, données +282 m ; SLCB 14 : −672 m à 18,5 km ; SLLP, SLOR, SLSU, SLUY), le Chili (SCCF).
Effet : les paliers des jonctions (300 m au-dessus des données — décision de Sam du 16 nov., PLAN-APPROCHES §9 q. 4) et la pente entre
10 et 18,5 km peuvent passer dans un relief inventé. **Vu en vol (16 nov.)** : F-35, ILS 32 de Cochabamba (`APS_ONLY=SLCB:32`, sans tuiles) —
avec les paliers de la jonction (les données + 300 m), deux remises de gaz sûres (au plus près 453 m du sol) ; les paliers retirés pour
l'essai (une approche réelle volée « comme publiée »), il percute le relief **10,9 km avant le seuil** à −9 m/s — là où le détail
dépasse la pente de 431 m (hors du couloir) ; vers 5,5 km la carte grossière elle-même passe sur la pente (la vallée comblée). Les
paliers restent donc (un filet tant que le sol dessiné n'est pas le relief).
**Après le couloir prolongé à 18,5 km (8b683069, 16 nov.)** : l'axe est propre ; mais `bun scripts/approach-detail-beyond.ts --joins` (les deux
jonctions de la campagne, hors du couloir) : sur **2 712 extrémités** une branche prévue passe sous le sol avec détail (3 155 à moins de 50 m) —
vent arrière à 6 km de l'axe, base, point de jonction ; pires sur l'Altiplano (SLCB 32 DW −450 m, SLOR 09 DW −334 m). **Question posée à Sam
(sans réponse, 16 nov. ~08:00 UTC)** : paliers des jonctions pris au plus haut des données et du sol dessiné hors du couloir (recommandé —
aucune approche refusée de plus), ou aplanir sous les jonctions, ou borner le détail. Rien changé en attendant. Piste (session du rendu,
`game/runway-grade.ts`) : le couloir prolongé jusqu'au point initial (18,5 km) ou à la jonction (16 km + la base), et/ou l'amplitude du
détail bornée là où les données sont planes ; côté approches, si besoin, les paliers pris au plus haut des deux sols hors du couloir.
**Réglé côté approches (16 nov., 16c3eabb — Sam : « Sol dessiné »)** : les paliers des jonctions au plus haut des données et du sol dessiné
(`groundJoinMsl`) ; sur un échantillon de 1 673 extrémités, sous le sol 54 → 0, à moins de 50 m 63 → 0. Les pentes restent sur les données.

**Couloir prolongé au point initial (11/16 07:29 UTC, PLAN-J7 J7-1, décision de Sam ~07:05 UTC : « prolonger à 18,5 km »)** —
le cône continué au même évasement (~±460 m à 18,5 km), fondu 300 m ; seul le détail retiré. **Vérifié** (kerr-mini, e2e
`j7-approach-ground`, `AG_FIELD`/`AG_RWY`, A/B contre 42c5887f) : sous l'axe de 3 à 18,2 km le sol touché égale les données (0,0 m) à
OIFK 11 et à **SLCB 05** — où le détail retiré atteignait **+770 m** (14 km : 3 528 m contre 2 758 m de données) ; hors du couloir le sol
inchangé ; parité GPU du zonage (`ellipsoid`) ; J0 sans coût (GPU p50 49,4–49,8 contre 49,5–50,2 ms). **À dire** : sur l'Altiplano les flancs
du couloir dans un détail de cette ampleur sont presque des falaises (138 m pour 50 m dans le fondu de 300 m) — réglage révisable sur la
planche. **Non vérifié** : le vol `APS_ONLY=SLCB:32` sans paliers (l'essai annulé par la session des approches) ; avec eux, le F-35 remet
les gaz deux fois (jamais sous 551 m) — à la session des approches de rejouer sa mesure.

## L'e2e `ellipsoid`, son second test (« the live polar renderer … ») expire à 300 s sur kerr-mini (relevé le 16 novembre 2026)

Observé : `the live polar renderer keeps WGS84 geometry and altitude when Earth textures are unavailable` expire à 300 s, trois fois
sur kerr-mini le 16 nov. (runs `…-j71-ellipsoid`, `…-j71-polar`, et `…-j71-polar-before` **sur 23ea4135, avant J7-1** : l'échec ne vient
pas de J7-1). Le premier test du fichier (la parité GPU de la géométrie et de `runwayGrade`) passe. Non analysé : sa page (320 × 240,
sans textures de la Terre) attend `__bh.renderer.lastNear` — sa première image, peut-être un noyau compilé à froid au-delà de 300 s sur
le mini, ou une attente qui ne vient jamais. À rejouer avec la sonde et `waitProgress` (J7-4, la santé).

## ~~L'A320 ne se repose pas à OIFK 11 après un rebond~~ (relevé le 15 novembre 2026, e2e `approach-sample`, APS_CRAFT=a320, kerr-mini) — réglé le 16 novembre 2026 (J7-1)

Observé : l'approche construite d'OIFK 11 (Kerman, 1 056 m, montagnes à 20 km), sans tuiles fines ; arrondi à 13 m au lieu de 15 (le sol
monte sous la finale : 12, 22, 17 m d'un instant à l'autre), contact, ROLL OUT, rebond ; la pente de trajectoire à +20°, l'alpha floor
et son TOGA LK. Avant le correctif d'AP10b, l'A320 montait à 6 km en ROLL OUT, sans guidage. Désormais : remise de gaz (manettes TOGA,
GA TRK/SRS), nouveau tour ; mais le second passage arrive au-dessus de la pente (OP DES à −8°), traverse le faisceau sans capter le G/S,
ALT* à 168 m du sol, puis OP CLB — pas posé en 20 min. Cause supposée : (1) le détail procédural du relief (`earthDetail`) sous la
trouée d'approche — des bosses de 10 à 50 m avant le seuil d'une piste aplanie ; (2) la jonction refaite après une remise de gaz
au-dessus de la piste (`joinFrom` depuis l'axe, l'altitude de la remise de gaz gardée) trop haute pour une capture du G/S par en
dessous. Piste : la question 4 de PLAN-APPROCHES §9 — **décidée le 16 nov. : les données seules** (les pentes jugées sans le détail) ; **demandé
à la session du rendu : aplanir le détail sous les trouées d'approche des pistes du monde** (`terrain.ts`, comme sous la piste — la
collision le garde aujourd'hui) ; côté approches : une jonction après remise de gaz qui redescend sous le faisceau avant l'interception.
Rejoué le 16 nov. sur le juge des données : toujours non posé (le détail sous la trouée inchangé).
**Cause établie (16 nov., 03:30 UTC)** : le « rebond » n'est pas un atterrissage — le FLARE se déclenche **4,0 à 4,6 km avant le seuil**,
14 m au-dessus du sol : sous la finale d'OIFK 11 les données sont plates (1 036–1 049 m de 3 à 6 km), le sol de la collision, avec le
détail procédural, monte à 1 122–1 248 m (+75 à +205 m) — le faisceau (1 313 m à 4,6 km) passe à 65 m de cette bosse inventée.
Côté approches, réglé : la jonction après une remise de gaz prend le vent arrière du côté du relief bas (`planJoin`) — le second
passage se stabilise désormais sur LOC/G/S ; il rebondit à la même bosse. **Reste entièrement à la session du rendu : le détail
procédural aplani sous les trouées d'approche des pistes du monde** (`terrain.ts` `earthDetail`, comme sous la piste) — **planifié :
[PLAN-J7](PLAN-J7-FLUIDITE.md) J7-1** (16 nov., session d'analyse), son critère : `approach-sample` A320 posé à OIFK 11.
**Réglé (16 nov., 06:00 UTC, J7-1)** : le détail procédural retiré sous le couloir d'approche de chaque extrémité de piste d'un aérodrome
réel (largeur + 80 m au seuil → ±300 m à 10 km, fondu 300 m ; `game/runway-grade.ts`, le même calcul pour la collision, le décor et le
WGSL) ; à OIFK 11 le sol de l'axe passe de bosses jusqu'à 1 245 m aux données (1 051 → 1 012 m de 3 à 10 km). **L'A320 s'y pose**
(`approach-sample -t mountain`, APS_CRAFT=a320, run `20261116-061434-j71-oifk`, note 20).


## ~~La vue « Les aurores sur les fjords des Lofoten » volée en plein jour quand la date du jeu est en été~~ (relevé le 14 novembre 2026, e2e `s2-views`) — réglé le même jour

- **Constat** : l'e2e `s2-views` échouait dans sa suite complète, pas seul : après les Alpes (`setDate` au 10 juillet), la vue des aurores
  démarrait à midi, le Soleil à 43°, sans aurores (leur bit de noyau jamais posé, l'œil adapté au jour). Seule, elle prenait la date
  de l'horloge (novembre), nuit noire.
- **Cause** : `views.ts` cherchait « une heure après le crépuscule » à −12° dans les 36 h. À 68° N, de mai à août, le Soleil ne descend
  jamais à −12° : `null`, puis le repli `?? now`.
- **Correction** : `nextDusk` passe aux jours suivants, jusqu'à la première nuit qui descend 4° plus bas que −12° (depuis le 10 juillet :
  le 8 septembre, 21 h 34 UTC, Soleil à −14,8°). La carte dit « La prochaine nuit noire ». Test `s2-views` (unité) 5/5, e2e 6/6, capture.

## ~~Le piéton passe sous le ventre du Ranger posé ; trois autres échecs des e2e du piéton~~ (relevé le 15 novembre 2026) — réglé (le train l'arrête) ; les trois autres non reproduits

- **`character-aaa` « in front of the landed vessel »** (40 et 43 pas dans la boîte de la coque, deux lancements). Sonde : le piéton marche
  vers le centre de la coque et passe **sous** le ventre, entre les roues du train. Le point le plus bas du maillage est 1,85 m au-dessus de
  ses pieds, sa capsule mesure 1,80 m ; la collision sur les vrais triangles (`vesselBlocked`, BVH) ne le bloque jamais, la boîte ne le
  touche qu'à un coin (43 pas sur 1 200). (Capture prise, non commitée : le budget de 600 Mo de binaires est atteint.) Le code de collision
  (`controller/character.ts`, `system/collide.ts`) n'a pas changé depuis le 30 octobre. Au commit 6aee50fe (13 nov.), le même test échouait
  autrement : le piéton s'arrêtait à 4,2 m de la boîte. Ce n'est donc pas une traversée de la coque : l'hypothèse du test (« la tête
  heurte le bord ») ne tient plus, à quelques centimètres de sol ou de hauteur de pose près. **Tranché par Sam (15 nov.) : « viser une
  roue ».** En le faisant, un vrai défaut est apparu : le **train du Ranger n'était dans aucune collision** (son maillage, `gear-mesh.ts`,
  à part de la coque ; la sonde au sol trouvait 0 cellule bloquée), et le piéton traversait les roues. Réglé : `controller/character.ts`
  ajoute le train sorti (sa BVH, faite une fois) à `vesselBlocked`. Le test marche vers la jambe la plus proche : 76 cellules bloquées,
  arrêté à 0,59 m, 0 pas dedans ; tests du piéton 54/54.
- ~~**`character-aaa` « the light on foot »** : `renderer.characterLight()` rend `null` (Lune) ; **« after a teleport »** : le décor
  `degraded` au lieu de `ready`. **`character`** : `variantReady && calibrationReady && !hdLoading` jamais vrai en 240 s.~~ **Non
  reproduits** le 15 nov. (~05 h 30 UTC) : `character` 2/2 et `character-aaa` 4/4 au même endroit. Une sonde avec les réglages exacts
  de `character` trouve les trois signaux prêts en 0 à 40 s par corps. Échecs passagers (machine chargée par les séries d'e2e de la nuit,
  ou corrigés entre-temps par la session du rendu), à surveiller.
  **Repris par la session du rendu (2026-11-15 02:49 UTC)** : sur kerr-mini, « the light on foot » et « after a teleport » **passent** (la charge de ce
  Mac pendant la mesure, supposée). `character` **réglé** — deux défauts du jeu : (1) une tuile de relief refusée par le réseau restait
  « en attente » pour toujours (aucun parent pour la remplacer) : `earthSettled` jamais vrai sur la Terre — le test bloque ses hôtes (`tiles:
  false`), 528 tuiles ; une photo ou un rendu hors ligne y aurait attendu sans fin — `earth-tiles.ts` : une tuile en échec compte comme échouée
  (`tests/earth-tiles.test.ts`, témoin positif) ; (2) puis, au chargement d'une sauvegarde, « Destroyed texture (RG16Float 1440×810) used in a
  submit » : le rendu du piéton détruisait sa texture d'occlusion au milieu d'une image où l'appareil l'avait déjà lue — `character-renderer.ts`
  les lâche au lieu de les détruire. `character` 2/2 sur kerr-mini ; son attente dit maintenant ce qui manque.
- ~~**`offline-settings`** : la zone hors ligne pas prête en 420 s~~ — réglé le 15 nov. : relancé seul, le même échec, mais la zone
  **avançait** (7 296 / 8 038 chaînes à 421 s, 0 échec, les dernières tuiles de l'IGN plus lentes que les premières). Le plafond fixe
  était trop court pour un téléchargement réseau. L'attente suit maintenant la progression (dite toutes les 30 s ; échec si elle
  s'arrête 150 s ou dépasse 15 min). 4/4, la zone prête en ~340 s (391 Mo).

## ~~« Climb, climb! » pendant tout le contact d'un ravitaillement en vol~~ (relevé le 14 novembre 2026, capture de l'e2e `aar`) — réglé le même jour

- **Constat** : pendant le contact, l'annonce « Climb, climb! » (signée RANGER). Sans tête, sur le vol automatique : le TCAS donne des RA
  pendant toute la phase au panier (environ 3 000 pas, « climb » et « descend » en alternance).
- **Cause** : le ravitailleur, à quelques mètres, se rapproche lentement. Pour le TCAS II, c'est un intrus dans son volume, en rapprochement.
- **Correction** : le TCAS passe en TA ONLY pendant un ravitaillement (`tcasAdvise(…, taOnly)`, `controller/radar.ts`), comme le fait un
  pilote ravitaillé. Tests : `tcas.test.ts` (même géométrie : RA, puis TA en TA ONLY), le vol automatique de `aar.test.ts` (0 RA). RADAR.md et .fr.
- **Non tranché** : les annonces sont signées « RANGER » sur tous les appareils (`ui/subtitles.ts`, la voix des annonces), F-35 et A320
  compris. Un choix de nom, laissé tel quel.

## ~~Le ravitaillement en vol automatique jamais autorisé : l'avion dépasse le panier à 5 m/s~~ (relevé le 14 novembre 2026, e2e `aar`, `crew-aar`) — réglé le même jour

- **Constat** : `aar` 1/3, `crew-aar` 2/3 (« cleared » jamais vrai en 90 s, pas de contact en 300 s). Sonde : la loi approche à 4–6 m/s,
  dépasse le panier et va jusqu'à 237 m devant lui. Sa manette passe de 0 à 1 (en 4 s : 251 fois 0, 41 fois 1).
- **Cause** : `aarJet` dérive notre vitesse de nos places successives (`(P.p − lastP) / dt`). Or la place lue est celle que le pas
  précédent a laissée : le déplacement mesuré appartient au `dt` d'avant. Aux images inégales du jeu (8, 16, 25 ms), la vitesse lue alterne
  70 et 680 m/s. Les tests sans tête, à pas égaux (1/30 s), ne le voyaient pas.
- **Correction** : `controller/aar.ts` divise le déplacement par le pas qui l'a produit (`lastDt`). Nouveau test sans tête sur des pas inégaux
  (échoue sur l'ancien code, passe sur le nouveau) ; `aar.test.ts` 4/4 ; e2e `aar` 3/3 (5 934 kg à bord), `crew-aar` 3/3.

## ~~La vidéo brouillon de la bande-annonce : 25 à 45 s par image en vol bas (e2e `s3-replay`, aucune image en 120 s)~~ (relevé le 14 novembre 2026) — réglé le 15 novembre 2026

- **Constat** : ce Mac en fenêtre visible. `replay.video(true)` acceptée, mais une image toutes les 25 à 45 s (prévu : 250 ms en brouillon) ;
  les 240 images d'un brouillon auraient pris 2 à 3 heures. Les deux tests suivants échouaient en cascade (« Un rendu est en cours »).
- **Cause** (sonde, toutes les 10 s) : l'image a ses échantillons (`offlineState.progress` 1, puis jusqu'à 1 884 spp), mais
  `renderer.ts` ne la dit finie que quand `earthSettled` est vrai. En vol bas à 250 m/s, chaque image déplace la caméra, et
  `earthTiles.anyPending` (parfois le décor) reste vrai pendant des dizaines de secondes. Aucune compilation en cours.
- **Correction** (`src/renderdialog.ts`, sans toucher au moteur) : une image **brouillon** est prise 1,5 s après avoir ses échantillons,
  même si des tuiles arrivent encore. Une vidéo finale attend toujours ses données (rien n'entre entre deux images). Après : environ
  une image toutes les 2 s, `s3-replay` 6/6 (brouillon de 239 images).

## ~~La pastille « Compiling the ray tracer for this scene » reste affichée sur une scène immobile~~ (relevé le 14 novembre 2026, e2e `a320-deck`) — corrigé le 16 novembre 2026

> **16 nov. 2026, 10:53 UTC — corrigé (PLAN-J7 J7-4)** : la cause était celle notée ci-dessous ; la phase convergée ferme maintenant la
> pastille (`noteSceneTracer(false)`, `src/renderer.ts`) avant son retour anticipé. `a320-deck` l'asserte au départ (8/8, ce Mac) ; son
> témoin (le correctif coupé) voit le défaut : « Compiling the ray tracer for this scene · 0 s » au départ, le test rouge.


- **Constat** : A320 au sol au Bourget (`lineUp`), vue cockpit, ce Mac en fenêtre visible : la pastille du bas affiche « Compiling the
  ray tracer for this scene · 2 s », figée, pendant au moins 60 s. Lus toutes les 10 s : `renderer.tracerSettled` vrai, `compilesPending` 0,
  `compilingNow` vide. Le joueur voit une compilation qui ne finit pas. L'e2e qui attendait ce texte perdait 240 s à chaque lancement.
- **Cause probable** (non corrigée : `src/renderer.ts`, le périmètre de la session du rendu, prévenue) : `noteSceneTracer(!traced)` n'est
  appelé que hors de la phase `converged` (l. ~12551). Le retour anticipé de la phase convergée passe avant. Quand l'image converge,
  le stage `scene-tracer` n'est jamais fermé.
- **Côté tests** : les 8 e2e de l'A320 attendent maintenant `app.settled(60_000)`, pas le texte.

## ~~Le jeu ne démarre pas sur un GPU à 16–18 textures échantillonnées : `seaFft` non résolu dans trace.wgsl~~ (relevé le 14 novembre 2026)
— réglé le 14 novembre 2026

**Cause établie** : la coupe de la mer FFT (`sea/fft-gpu.ts` `seaShader`) retirait la liaison et la région `seaWavesFft`, mais `seaSkyRadiance`
(le ciel que la mer reflète, PLAN-MER S5, couche `SEA_SKY_LAYER` du même tableau de textures) la lisait hors de cette région. **Réglé** : ses
marqueurs et son substitut (les harmoniques de la sonde, `nearE`, comme la mer d'un autre monde ; sur la Terre son poids y est 0) ; `seaShader`
refuse une source sans ses marqueurs. **Gardes** : `tests/tracer-limits.test.ts` (40 compositions de 16 à 48 textures, 8 à 16 tampons : aucune
liaison coupée encore nommée ; témoin positif : l'ancien `seaShader` y nomme `seaFft`, `seaSamp`) ; `check-wgsl` compile le traceur composé à
16 et 18 textures (84/84 ; l'ancien : « 9371:29 unresolved value 'seaFft' »). `site-smoke` `gpuTextures=16` OK en 8,6 s, `24` OK. **En CI après le
correctif** (run 43636295115, 62b99b61, SwiftShader) : le traceur compile (`shader-validation`, `core-pipeline-compilation@9395`,
`tracer-compilation@11523`), puis « WebGPU device lost: Device was destroyed » / « Instance dropped in popErrorScope » — le processus GPU de
Chrome tombe aux premières images (la page ne détruit pas le device : `release`/`simulateLoss` seuls l'appellent) ; **autre cause, non
cherchée** : le dessin émulé par SwiftShader (trop long, mémoire ?) ; non reproduit ici (Metal). L'étape `site-smoke` reste informative. **Depuis 9efb03a4 (session audit, choix de Sam « la fumée en porte »)** : l'étape est une porte jusqu'au renderer (`--until renderer` : les shaders compilés) ; la perte de l'appareil qui suit est rapportée, pas comptée. **Non reproduit avec SwiftShader sur macOS (14 nov., `site-smoke --swiftshader`)** : l'adaptateur « swiftshader » (16 textures) crée le renderer en 19 s et dessine la première image à 26 s, sans perte — la chute du runner tient à son Linux (le Vulkan de SwiftShader, la mémoire du runner), pas aux limites de SwiftShader. Le constat :

**Constat (observé, CI et ce Mac)** : le site construit, ouvert par `scripts/site-smoke.ts` sous SwiftShader en CI (16 textures, 10 tampons de
stockage par étage), affiche « trace.wgsl failed to compile: 9370:29 unresolved value 'seaFft' » — pas de jeu (runs 43632741249, 43634230192).
**Reproduit ici** : `bun scripts/site-smoke.ts _site --hash "scene=game:artemis&gpuTextures=16"` → le même texte (9350:29) ; avec
`gpuTextures=24` → OK. **Cause probable** : `seaFft` (@binding(33)) n'existe que si `maxSampledTexturesPerShaderStage >= SEA_TEXTURE_LIMIT`
(19 — `renderer.ts:1372`, `sea/fft-gpu.ts:34`), ses usages (trace.wgsl ≈ 9232–9253, la mer FFT du 10 nov.) restent dans la variante compilée
sans lui. 16 est la limite par défaut de WebGPU : des appareils modestes sont touchés. **Domaine du rendu** (trace.wgsl) : signalé à sa session
le 14 nov., non corrigé ici. `check-wgsl` (82/82 en CI) ne compile pas cette variante.
## ~~Des rayures horizontales dans le ciel de nuit, l'exposition relevée~~ (relevé le 14 novembre 2026, J0 `nightfloor`) — non reproduit en
régime établi : un transitoire

**Repris (mesuré, kerr-mini, même jour, phase J0 `nightbands`)** : même vue, même heure, +6 IL réglés avant d'attendre le traceur compilé — la
profondeur des bandes (le saut moyen d'une ligne à la suivante sur la moyenne) **1,0–1,6 %** dans les cinq cas : tel que dessiné, convergé
(4 s de plus), chaque rayon tracé (`realtimeSubsampling` 1), le raster ombré en entier sans résolution dynamique, le pipeline tracé ; aucune
bande à l'image. Les bandes du premier relevé venaient 20 images après un saut d'exposition de 6 IL, monde figé : **un transitoire de
l'historique** après un changement d'exposition, pas un défaut du ciel. Le constat d'origine :

**Constat (observé, kerr-mini, J0 à 21:40 UTC — Soleil −19° —, vue quarter, exposition du jeu + 6 IL)** : le ciel au-dessus de l'horizon fait des
bandes horizontales régulières, une période de ~10–11 lignes de l'image, la luminance (canal vert, colonnes 200–600) allant de 7 à 24 d'une
bande à l'autre. À l'exposition du jeu, invisible (le ciel ~0). **Cause non cherchée** (supposées : le sous-échantillonnage du temps réel par
blocs, ou un ciel dessiné par bandes, au bruit d'une nuit très sombre amplifié). **Piste** : la même vue à +6 IL monde figé, un raster ombré
en entier (`earthRasterShading: "every"`), puis le tracé seul ; la photo de nuit (mode photo, exposition longue) la montrerait.

## ~~Le sol éclairé comme de jour au crépuscule nautique (Soleil −5 à −10°)~~ (relevé le 14 novembre 2026, sonde de cohérence J0) — réglé le 14 novembre 2026

**Constat (mesuré, kerr-mini, J0 `coherence` et `twilightdim`, 14 nov.)** : de −7,5 à −9° de Soleil, le ciel que prend le sol (`liteSky` :
`skyFlat`, ou le plancher de nuit) valait **115 à 185 fois sa propre table** (`skyIrradiance`) et ~500 à 740 fois la référence calibrée du
crépuscule (`twilightGround`), quand l'appareil recevait la table (×0,88–0,93) : à l'image, une mer bleue et des collines vertes de plein jour
sous un ciel de crépuscule, l'appareil 70 à 160 fois plus sombre que le sol. **Cause** : `skyFlat` revenait, quand le ciel de la caméra est
trop sombre pour être mis à l'échelle (son Soleil sous ~−4°), à « l'ancien modèle » — un dixième bleuté du Soleil, `smoothstep(−0,18 ; 0,25 ; μ0)`,
éteint seulement vers −10,4°. **Réglé** : un lieu pas plus éclairé que celui de la caméra (son Soleil pas plus haut, son éclipse pas moins
profonde) prend le ciel de la caméra ramené à lui (facteurs ≤ 1) ; un lieu plus éclairé (vu d'orbite, hors de l'ombre de la Lune) garde
l'ancien modèle. Levier de mesure `TUNE_SKYFLAT_DIM` 0 (l'ancien, `renderer.tune`), à retirer avec J3-R. **Mesuré après** (A/B, 3ᵉ passage) :
le sol 0,94–0,97 de sa table, l'appareil / le sol 0,92–0,95 ; à l'image le sol 125,6 → 69,8 (20:00) et 85,3 → 25,6 (20:10), A/A ≤ 1,5. `twilight-sky`,
`eclipse-raster` (Burgos), `night-views` passent. **Puis (même jour, ~19:45 UTC)** : à −10…−13° l'appareil 1,7–1,8 fois le sol — au pied du
`smoothstep`, le rapport de deux nombres presque nuls amplifiait un écart de ~0,05° entre la hauteur du Soleil de la cuisson et celle du sol
(la place de la caméra 0,54 de sa table à −10,2°, rien au-delà de −10,4°) ; **réglé** (à 0,17° près de la caméra, sa table entière) : appareil /
sol **0,87–1,08 de −7,5 à −12,7°**. **Reste**, voulu : sous −15°, l'appareil 0,24–0,56 fois le sol — le plancher du sol (`EARTH_NIGHT`, ~0,01 lux,
cinq fois le ciel réel d'une nuit sans Lune « pour que le sol se devine », calibrage Q2) quand l'appareil reçoit le ciel tracé, proche du
réel : donner ce plancher à l'appareil serait un choix d'image (PLAN-J3 §8).


## ~~Les états de la galerie du HUD périmés : le final de Le Bourget remet les gaz, le Lander tombe de 27 m~~ (relevé le 13 novembre 2026, e2e `report`) — réglé le 14 novembre 2026 : les états 05, 06 et 09 refaits sur le sol d'aujourd'hui

**Réglé (observé, kerr-mini et ce Mac, 14 nov.)** : 05 (le plané) et 06 (le final) sont ceux du labo de vol (`LAB_STATES=1 bun scripts/flightlab.ts run --only '^entry-bourget-i51$'`, PASS, posé à 0,9 m de l'axe ; 06 = le passage au profil `outer`, 14 km du seuil, 2,5 km de haut, la carte « on the final » et son graphe) ; 09 est le Lander en descente sous l'autopilote d'atterrissage, 147 m au-dessus de la piste de Kennedy (enregistré par `hoverOver` + `setAuto("land")`, comme l'original : un état en vol, pas posé). Rechargé, il se pose (« Touchdown on Earth · 0,7 m/s down », nouveau test de `saves`). Les sept e2e de la galerie passent sur kerr-mini : `hub-graph` 1/1, `hub-card` 2/2, `telemetry` 1/1, `hud-layout` 10/10, `saves` 4/4, `saves-storage` 4/4, `report` 4/4. Les états 01–04, 07, 08, 10 n'ont pas été refaits (`hud-layout` et `saves` passent avec eux). Trouvé en route : un état pris **en roulage** après le toucher (le Lander posé, le Ranger qui roule) a `ship.landed = null` alors que son résumé dit LANDED : son sol n'est pas dans la sauvegarde (`landed` ne lit que `ourLanded`, pas `rolling`). Comment il se recharge, temps en marche, **non vérifié** (mes sondes l'ont lu temps arrêté : voir E2E-VOLS §7) ; à suivre si une sauvegarde au roulage doit valoir (E2E-VOLS §7). Le constat d'origine, gardé :

**Constat (observé, e2e headed sur ce Mac, 13 nov. 22:50–23:20 UTC)** : `tests/hud/states/06-final.json` (7 oct. 2026) chargé, l'autopilote d'entrée
du Ranger remet les gaz dès les premières secondes — « Go-around: 1718 m off the axis at the minima » — et ne se pose pas en 90 s ; **même chose
avant les lots de sauvegarde du 13 nov.** (arbre de travail à f84bee82 : « 1713 m off the axis »). `09-lander-descent.json` (le Lander 0,6 m au-dessus
de son contact) part à 27 m : 23 m/s, train cédé, pas de carte ; la protection du sol (X1b, 18 oct.) le mettait d'abord en stationnaire.
**Cause supposée** : le sol passé au WGS84 et au géoïde (I0, 23 oct.), et les sites posés sur leurs vrais seuils le 2 nov. (fcfd8088 ; la
même cause a déjà mis Le Bourget à 937 m de l'axe dans un autre e2e, E2E-VOLS §7) : l'état garde le site de son entrée et des positions d'avant.
L'e2e `report` : le test du Lander et celui des unités portés sur l'autopilote d'atterrissage (Kennedy), celui de Le Bourget sur l'ILS du F-35B
depuis 5 km — **4/4** (13 nov., plus tard) ; **les états eux-mêmes restent périmés**. `hub-graph` lit le même état 06 (son graphe seul : non touché). **Piste** : refaire l'état 06 en volant l'approche (`glideTo`, puis
`snapshot` au final) — ou porter le test sur une approche volée. Les autres états de la galerie (`tests/hud/states/`) sont à revérifier.

## ~~L'e2e `shootdown` instable : le Tab ne verrouille pas toujours sa cible~~ (relevé le 14 novembre 2026) — réglé le 14 novembre 2026 : la vie marine coupée, un second tir si besoin

**Constat (observé, ce Mac, fenêtre visible, trois passages)** : `tests/e2e/shootdown.e2e.test.ts` 3/4 à chaque fois, l'échec changeant de
test — deux fois « the frigate ahead » (`engage` : quatre Tab, `locked()` reste `null`), une fois « the airliner head-on », **sur le dernier
commit comme avec une retouche** (QA-09 : la pause du naufrage remplacée par une condition — retirée, faute d'avoir pu l'atteindre).
**Cause trouvée pour la frégate (sonde, 14 nov.)** : Tab parcourt aussi les navires de la vie marine (`seaLife` : « L'Espérance », « Pen
Duick », « Mega Express »…), que le test ne coupait pas (`traffic: false` ne vise que le trafic réel) : la frégate ne venait qu'au quatrième
Tab, ou pas. **Réglé dans le test** (`seaLife: false`) : la frégate verrouillée et coulée deux fois sur deux. **Reste ouvert** : une fois sur
deux, l'AIM-9X tiré face à face sur l'avion de ligne (8 km, 450 m au-dessus de la mer) ne l'abat pas en 60 s — un tir manqué (leurre, géométrie
ou la mer), cause non cherchée.

**Réglé aussi (sonde, 14 nov.)** : l'AIM-9X arrivait bien à 25–27 m et fusait (rayon 8 m) ; ses dégâts, 110 × (1 − 0,4 · écart / 8), passent sous
les 80 points de l'avion de ligne au-delà de 5,5 m d'écart : un missile ne l'abat pas toujours — le jeu fait ce qu'il doit. Le test tire de
nouveau si la cible survit (trois au plus). Trois passages : **4/4, 4/4, 4/4** (le second tir n'a pas eu à servir dans ces trois-là).

## ~~L'e2e `hub-graph` : plus de graphe dans la carte du hub une seconde après le chargement~~ (relevé le 13 novembre 2026) — réglé le 14 novembre 2026 : l'état périmé, pas le graphe

**Cause établie (lue dans le code, 14 nov.)** : la carte de l'autopilote d'entrée ne porte un graphe que sur la finale (`controller/lowthrust.ts` : `rw?.final && rw.fix ? this.glideAssist(rw) : {}`) ; l'état 06 du 7 oct., à 1,7 km de l'axe d'aujourd'hui, remettait les gaz et repartait « On the approach », sans graphe par construction. Les changements de `flighthud.ts` d'alors (le `remeasure()` de la carte) n'y étaient pour rien. Avec l'état 06 refait (ci-dessus) : `hub-graph` 1/1 sur kerr-mini. Le constat d'origine :

**Constat (observé, sonde e2e, ce Mac)** : chargé l'état 06 (le final du Ranger) ou l'état 05 (son plané), le petit graphe de la carte du hub
est là à 0,3 s, puis tout son bloc est masqué (`fl-hub-graph` en `display: none` : `drawHubGraph` reçoit `G = null`, l'assistant ne donne plus
de graphe) dès que l'autopilote d'entrée passe « On the approach » — en 1 à 2 s ; avec l'état 06, après une remise de gaz à 1,7 km de l'axe.
Le clic du test tombe alors sur la vue. **Cause non établie** : les états périmés (voir plus haut) ou un graphe d'approche retiré ;
`src/ui/flighthud.ts` était en cours de modification par la session du rendu pendant la mesure (la page servait ses changements non commités).
Les quatre autres e2e de la galerie (`hub-card` 2/2, `telemetry` 1/1, `hud-layout` 10/10, `saves` 3/3) passent depuis que leur démarrage est
borné (ils tombaient tous sur les 5 s par défaut de `beforeAll`). **Piste** : refaire les états ; vérifier si l'approche doit avoir son graphe.

## ~~Le toucher dit deux fois dans la page~~ (relevé le 13 novembre 2026, e2e `report`) — réglé le 13 novembre 2026 : chaque message du pilote était journalisé deux fois

**Constat (observé)** : le Lander posé par son autopilote près de Kennedy, dans la page : le journal du jeu a deux lignes « Touchdown on Earth ·
… » identiques avant « Landing · Earth — A » ; le même vol dans le contrôleur seul (`tests/helpers/flight.ts`, 1 km et 300 m) n'en dit qu'une.
**Cause non cherchée** : deux chemins écrivent ce message (`fallStep` et `flyHome`, `controller/motion.ts`) ; le pas de la page en prend
peut-être deux. **Piste** : compter les messages dans l'e2e, puis voir lequel des deux chemins parle.

**Réglé** (13 nov., plus tard) : la cause n'était pas le vol — une seule émission (`flyHome`, pile capturée) — mais le journal : le
gestionnaire des messages du pilote (`main.ts`) les montrait par `panel.toast`, qui écrit chaque toast au journal (« info », sans heure), puis les
y écrivait comme le pilote. **Tous** les messages du pilote étaient doublés. `panel.toast(msg, { log: false })` pour eux ; e2e `journal-once` :
avant `[info no-time, pilot t]`, après `[pilot t]`.

## ~~Après le roulage de l'ILS, le F-35 ne s'arrête jamais : il glisse de côté, freins serrés — on ne peut pas débarquer~~ (relevé le 15 novembre 2026, PLAN-J6 J6-3) — corrigé le même jour

> **15 nov. 2026, 19:13 UTC — cause trouvée, corrigé** : un relevé de la vitesse relative au sol à chaque pas : en long et en travers ~0,1 mm/s,
> **verticale −0,29 m/s** — les jambes replacent l'avion sur le sol à chaque pas sans corriger sa vitesse ; la condition de repos (`motion.ts`
> `still`) testait la vitesse en 3D : jamais sous 0,05 m/s. Désormais jugée **dans le plan du sol** (et moins de 0,5 m/s verticale) : à l'arrêt
> 0 m en 10 s, la sortie à pied, le retour et le redécollage passent (`parcours-debarquer`) ; `apprendre-avions` 7/7, `landing` 5/5, tests du
> train et des atterrissages 46/46. Reste à comprendre : pourquoi cette vitesse verticale n'est pas amortie par les jambes.

**État (15 nov. 2026, 18:45 UTC)** : relevé, cause non trouvée. Le parcours `parcours-debarquer` : l'ILS 05 de Toulon-Hyères depuis une finale de
9 km, toucher 19,5/20 (640 m, 1,6 m de l'axe, −1,2 m/s), aucun rebond, roulage jusqu'à ~0 ; puis, sans rien toucher, l'avion **reste
`rolling`** et **glisse de 2,65 à 2,71 m en 10 s** (trois passages) — vers le 165° pour un cap de 51° : de côté, un peu en arrière —, freins à
1, manette à 0, ses trois roues au sol, **aucun lacet** (0,03°), **aucun vent** (`windNow` nul). Il n'atteint donc jamais le repos
(`motion.ts` : moins de 0,05 m/s) et Maj+K répond **« Land the vessel before going out. »** (0,28–0,30 m/s).
- **L'interface le dit posé** : à l'arrêt, le bandeau propose « Craft landed — ⇧K Leave the craft » (capture `1-stopped.png`), puis la sortie
  est refusée — l'interface et `character.disembark` (qui exige `ourLanded`) ne lisent pas le même état.
- Écarté : aligné par `lineUp` (posé d'emblée), il ne bouge pas, horloge à pas fixes ou en temps réel, à Edwards comme à Toulon-Hyères ;
  `groundVelocity` concorde avec le repère tournant de la Terre (différences finies de `fromBodyFixed` : 0,015–0,033 m/s).
- **Les roues au repos par rapport au sol** (18:52 UTC, un sixième passage) : charges 32 kN (avant), 79 et 79 kN (principales), **glissement
  latéral 0 sur les trois**, roue avant non braquée, aucun frein au pied, rotation nulle : les pneus se voient immobiles par rapport à la
  vitesse du sol de référence, et la position de l'avion dérive pourtant de 0,27 m/s (≈ 1,1·10⁻⁵ de sa vitesse absolue, ~25 km/s avec la
  Terre). **Piste** : l'intégration de l'état de roulage (`motion.ts`, la position avancée à la vitesse absolue, la vitesse du sol prise à un
  autre instant ou à un autre pas que la position) — l'avion « posé » (`landedAt`, tenu dans le repère du sol) ne dérive pas ; et pourquoi la
  condition de repos (`still`, moins de 0,05 m/s relatifs) ne se déclenche pas si les roues se voient au repos.

## ~~Deux tests de `gpu-startup` échouent : le LUT de qualité et le noyau adaptatif n'atteignent pas l'état attendu~~ (relevé le 15 novembre 2026) — réglé le 16 novembre 2026 (le test)

> **16 nov. 2026, 10:53 UTC — la cause est dans le test (PLAN-J7 J7-4)** : les deux attendaient 30 s que le noyau de qualité général
> démarre, or il ne démarre qu'une fois le noyau général temps réel prêt, et celui-ci (toutes les fonctions, à la demande depuis P8)
> compile en **226 s** à froid sur ce Mac (M1 Max). Les tests demandent maintenant le noyau de qualité eux-mêmes et attendent sa
> compilation sur sa progression (dite toutes les 10 s) : **128 à 271 s** à froid ici selon la charge. Au-delà de 180 s, le délai des
> pipelines optionnels (`AsyncResource`) le marque « failed », puis il est pris à son arrivée (`lateIsCurrent`) : le troisième test
> touché (« failed quality LUT… ») l'attend aussi. `gpu-startup` 15/17 puis les deux 2/2 (ce Mac). **Reste à voir** (jeu) : sur une
> machine lente, une vue fixe s'affine sur le noyau à pas fixes pendant ces minutes ; la durée de cette compilation n'a pas été réduite.


**État (15 nov. 2026, 20:35 UTC)** : relevé en passant (PLAN-J6 J6-6), non étudié. `gpu-startup` › « the quality LUT starts compiling as the quality
kernel lands » : `qualityCompile.state === "pending" && lutWanted` jamais vrai en 30 s ; « failed adaptive kernel … » : `pipelineStatus.quality ===
"failed"` jamais vrai en 30 s (kerr-mini, deux passages). Un troisième (« variants retain … ») échouait par son faux renderer (`prof.table` absent
depuis H5, 3 nov.) : corrigé dans le test. Aucun lien établi avec les lots du jour ; non rejoués sur une révision antérieure.

## ~~Le bouton de la couche météo de la carte masqué par la carte elle-même~~ (relevé le 15 novembre 2026, e2e `weather-panel`) — corrigé le 16 novembre 2026

> **16 nov. 2026, 10:53 UTC — corrigé (PLAN-J7 J7-4)** : en vue carte, la barre de droite commence à `--fc-l + 310 px` ; les onglets
> (3D, Globe, Planisphère, Tactique, Météo) mesurent maintenant 380 px, et la boîte vide de la barre, posée après, prenait les clics
> du bouton Météo. Sa boîte laisse passer le pointeur, ses boutons le prennent (`src/style.css`). `weather-panel` 6/6 (ce Mac), le
> bouton visible sur la capture.


**État (15 nov. 2026, 18:03 UTC)** : relevé en passant (PLAN-J6 J6-2), non étudié. `weather-panel` › « the planisphere's weather layer » : le
clic réel sur `[data-testid=map-weather]` refusé — `div.fl-mapbar.m3-bar > button.fl-mapwx > div.fl-maptabs > canvas.fl-map >
div.m3-stage.gpu` au-dessus (kerr-mini, un passage). Hors du périmètre de J6-2 ; à reproduire puis à donner à qui tient la carte.

## Le décor ne suit pas un vol rapide : en arrivant sur une ville à 150 m/s, aucun bâtiment devant (relevé le 15 novembre 2026, PLAN-J6 J6-1) — **rouvert le 16 novembre 2026**

> **16 nov. 2026, 11:07 UTC — rouvert (PLAN-J7 J7-4) : la correction de J6-1 n'a pas tenu, le défaut est intermittent.** `parcours-ville`
> sur kerr-mini, 6 passages : à l'arrivée sur Toulon, **0** point de bâtiment devant (à moins de 2 km) cinq fois, **35** une fois ; la
> révision même de J6-1 (abe34202, A/B `ab-e2e`) : 0 aussi — pas une régression depuis, les 36–38 de J6-1 étaient des passages
> favorables. **Le décor est en retard, il n'est pas absent** : le même instant gelé, le décor laissé finir (`sceneryReady`, 60 s au
> plus), **41** points de bâtiment entre 1 et 2 km devant (capture `3b-arrivee-decor-fini`). À l'arrivée, la scène en vigueur est
> centrée à 3–5,5 km de l'avion (0,6 km au passage vert), la suivante encore en construction (`refreshing`, bâtiments 19/29, forêt) ;
> une scène rapide prend ~12,7 s (« before forest » 11,6 s), ~1,9 km à 150 m/s, et son centre est mis à vitesse × durée de la dernière
> construction devant, plafonné à 2,5 rayons (`buildLead`, `sceneryQuickLead`). **Non corrigé** : une scène qui couvre le point
> d'arrivée à temps relève d'un lot du décor (sa durée, la scène suivante commencée plus tôt, ou deux scènes gardées), proposé à la
> session d'analyse. `parcours-ville` garde son assertion (le défaut est vu du joueur) et mesure désormais aussi l'arrivée gelée.
> **Renvoyé à [PLAN-J8](PLAN-J8-BATIMENTS.md) J8-5** (la scène proche allégée) et J8-4 (la couche lointaine par cellules) — décision de
> la session d'analyse, 16 nov. ~11:30 UTC ; l'assertion de `parcours-ville` est le témoin du critère 2 de J8 (aucun trou devant).


> **15 nov. 2026, 17:40 UTC — corrigé** : l'avance d'une scène rapide portée de 1,2 à **2,5** fois son rayon (`renderer.sceneryQuickLead`) :
> en arrivant sur Toulon, **36–38** points de bâtiment devant (0 à trois passages sur quatre avant) ; le regard arrière **83–97** à moins de
> 2 km (~0 avant) ; GPU au même niveau (kerr-mini, deux passages de `parcours-ville`, qui l'asserte désormais).

**État (15 nov. 2026, 17:02 UTC)** : relevé, non corrigé. Le parcours `parcours-ville` (le F-35 décolle de Toulon-Hyères, vole vers le
centre de Toulon à 500 m et 150 m/s) : **en arrivant à 1,5 km du centre, la grille de visibilité devant le cockpit (48 × 27,
`renderer.surfaceAt`) ne compte ni bâtiment ni arbre à moins de 5 km** — la ville n'est que la photo aérienne (capture
`3-over-toulon.png`) ; dans le regard arrière 30 s plus tard, quelques bâtiments à plus de 2 km. Trois passages, le même résultat.

- **Mesuré** (kerr-mini, l'état du décor à chaque tranche de 10 s) : en vol au-delà de 120 m/s le décor enchaîne des scènes
  « rapides » (`fastFlight`, boîte de 0,35 fois la portée), toujours « refreshing », l'étape **`forest`** presque à chaque relevé ;
  1 800 à 3 900 bâtiments par scène (32 000 au repos), 65 000 à 233 000 arbres ; le centre de la scène dessinée **0,2 à 2,3 km** de
  l'avion.
- **Le temps des étapes** (17:18 UTC, `stats().phases` à chaque tranche, un quatrième passage) : l'étiquette « forest » est celle de
  l'étape **suivante** (`next`) ; le temps d'une scène rapide va à la **construction des tuiles de bâtiments** (entre `bdtopo` et `before
  forest` : **2 à 16 s**), la forêt ~0,5 s, le reste < 1 s ; une scène rapide finie en 3 à 17 s. Ce passage-là : **71** points de bâtiment
  devant à l'arrivée (0 aux trois autres) — selon le moment où la scène se termine.
- **Cause supposée, non vérifiée** : la boîte d'une scène rapide (0,35 fois la portée) centrée près de l'avion (l'avance de `buildLead`
  plafonnée à 1,2 fois son rayon) couvre mal ce que voit le cockpit à 500 m (le sol de 1 à 5 km devant) ; selon l'instant, la ville
  visée est dans la boîte ou non.
- **À faire** (PLAN-J6 J6-1) : asserter sur plusieurs passages (la variance : 0 à 71) ; essayer une boîte rapide décalée vers l'avant
  (couvrir le sol vu) ou des tuiles de bâtiments plus rapides ; le parcours relève `buildingsNear` sans l'asserter jusque-là.

## ~~Le repli du raster vers le pipeline tracé ne s'arme plus sur la Terre~~ (relevé le 13 novembre 2026, e2e `raster-governor`) — réglé le 15 novembre 2026 : le repli retiré (décision (b) de Sam)

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

**Décision de Sam (2026-11-15 ~19:55 UTC) : (b)** — le repli vers le tracé est retiré sur la Terre (le raster toujours, son plancher de
qualité à régler) ; le code du repli sur la Terre et la partie « repli » de l'e2e `raster-governor` sont à retirer (lot de la session du
rendu, après J6). Reste ouvert ici jusqu'à ce retrait.

**Retiré le 15 novembre 2026 (~20:46 UTC)** : `rasterFellBack`, `rasterKept` et le contrôle de 6 s du gouverneur (`src/game/governor.ts`),
leur remise à zéro au changement de réglage (`main.ts`), leurs deux messages ; `renderer.earthPipelineNow` rend le réglage tel quel (le tracé
reste au choix du joueur). Sur les autres astres le repli n'était pas atteignable (leur cadence plafonne à 4, il en demandait 16) : retiré
avec. L'e2e `raster-governor` vérifie désormais l'inverse — le budget serré à 8 ms pendant 15 s (plus que les 12 s du repli), le raster
jamais quitté : **passé sur kerr-mini** (run `20261115-214344-raster-governor-norepli`, 1/1, GPU 36,4 ms sous ce budget, la Terre en raster
à chaque relevé). **Le plancher, réglé le 15 novembre (23:46 UTC)** — relu : sous le matériau l'échelle est épinglée (0,75) et la rétrogradation de palier
demandait 0,5 : sur la Terre en raster, plus aucun levier n'agissait. **Décision de Sam (15 nov., ~23:30 UTC) : proposer, pas imposer,
sous 15 images/s soutenues.** Le gouverneur (`slowFor`) compte les images finies par seconde en mouvement sur le raster (rien en
compilation, page visible, aucun bench) ; sous 15 pendant 12 s, il demande à `main.ts` de proposer un cran plus léger dans le panneau de
proposition de TARS (Accepter / Refuser) — l'échelle du raster en mouvement au cran suivant du menu, le décor équilibré, la distance de
détail un cran plus près (`quality-policy.ts` `lighterSettings`). Un oui : appliqué par le chemin des réglages, dit ; le cran suivant
proposé si l'image reste sous le seuil. Un non : retenu sur l'appareil. Rien ne change sans l'accord du joueur. Les e2e démarrent avec
le refus posé (aucune proposition sur une mesure). Vérifié : `tests/low-rate-offer.test.ts` 3/3 (témoin positif à 10 images/s, négatifs
à 30 et 16, page masquée, bench, caméra immobile, tracé) ; e2e `low-rate-offer` 2/2 sur kerr-mini (clics réels). **Non mesuré** : la
cadence gagnée par un cran (dépend de la machine).

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
- **Mesuré sur kerr-mini** (2026-11-14 ~00:07 UTC, e2e `j2-probes` `J2_PHASES=flight`, code 9c1c5fd8, run `…-j2-pointes-mini`, un passage) : **en vol, 2
  images sur 1 010 au-delà de 2 ms** de travail des tuiles ; `request()` p95 1,2 ms, max 2,1 ; publication p95 1,2, max 1,9 ; l'écriture des
  pages (`put`) max 2,9 ; le halo max 2,0. **Au chargement** : 12 sur 1 140, `request()` max 3,7, `put` max 3,8. Le mini tient donc le lot comme
  le M1 Max (5–7 par vol) : le critère presque tenu en vol, pas au chargement.

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

## ~~« Posé sur un aérodrome » ne s'aligne plus sur sa piste au Bourget (e2e `ground-placement`)~~ — le test était périmé, pas le jeu (13 novembre 2026, ~22:45 UTC)

- **Observé** (12 nov. 2026, kerr-mini) : `game.land("earth", 48.96, 2.44)` répond « landed at 48.96°, 2.44° » au lieu de « lined up
  … » (Δcap 9,015°, décalage −936,86 m de l'axe) — **à l'identique sur 72a16452 et sur J2-2** (A/B `ab-commit`), donc antérieur à J2-2 ;
  les trois autres cas de l'e2e (appareil garé à côté, F-35 et Ranger sur une piste et sur le flanc du Fuji, chaque jambe au sol) passent.
- **Cause** : non cherchée (hors du lot J2-2) — le choix de l'aérodrome ou de sa piste en service par le placement (`game/place.ts`).
- **Cause** (13 nov.) : le test posait l'appareil à 48,96°, 2,44° — l'ancienne place du site, faite à la main ; depuis le 2 nov. (fcfd8088) le site
  est sur le seuil publié de sa piste 25 (48,974°, 2,45825°) : l'ancien point est à 937 m de l'axe, hors de la bande (150 m) — « landed »
  y est juste. Le test lit maintenant la place du site (`__bh.sys.runways()`) : « lined up, runway 25 », Δcap 0,001°, 0,00 m de l'axe ;
  `ground-placement` **4/4** (kerr-mini). Leçon : [E2E-VOLS.md](E2E-VOLS.md) §7.

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
- **Le correctif fait le 14 novembre 2026 (~20:43 UTC)** (PLAN-J3 J3-3, après J1) : `scenery-raster.ts` `shadowFs` — un texel de la carte n'est
  gardé que si sa droite vers le Soleil traverse le houppier (la sphère unité, ou le cône unité : sa base, son flanc) ; les troncs entiers ; levier
  de comparaison `renderer.treeShadowCut` (vrai par défaut). **Mesuré** (kerr-mini, la vue du constat, `forest-wind` `WIND_AB=treeShadowCut`) :
  l'image +13 à +17 % de luminance moyenne (8,17 → 9,24–9,58 ; A/A 0,00 et 0,34), le sol au soleil (> 40) 3,0 → 3,3–3,7 % ; GPU p50 inchangé
  au bruit (174 / 174–176 ms, cette vue très lourde) ; aucune erreur WebGPU. **Les bandes restent** en partie : les trouées entre des ombres
  allongées par le Soleil rasant (incidence ≈ 74°) — l'aspect attendu ; leur netteté (bords francs, opaques) non traitée.

## ~~La lumière de l'appareil en retard après un saut d'horloge (le ciel d'avant gardé des minutes)~~ — réglé le 13 novembre 2026 (~23:58 UTC)

- **Trouvé par la sonde de cohérence de J3** (phase J0 `coherence`, kerr-mini) : au coucher, l'heure avancée de 5 minutes à la fois, le ciel
  que reçoit l'appareil valait **1,20 à 1,80 fois** celui du sol (19:05 → 19:20 UTC), et seulement 1,00–1,02 l'heure avancée de 15 minutes.
- **Cause** : la sonde de l'appareil n'était réécrite entière (`envSpread`) que si son ciel changeait d'une demi-luminance ou si un astre
  bougeait de 0,1 rad sur ses axes **inertiels** — où le Soleil ne bouge presque pas au coucher (c'est la Terre qui tourne). Sinon, une image de
  fenêtre courte, puis la moyenne lente (jusqu'à 512 images, un texel sur seize toutes les quatre) : le ciel d'avant gardé des minutes. En
  jeu : après le curseur du temps, un `setDate`, un saut de quelques minutes.
- **Correctif** (`renderer.ts` `probeDrift`) : la sonde réécrite sur 4 images quand le Soleil tourne de plus de ¼° **sur les axes du corps
  proche** depuis la dernière réécriture (au seuil d'un texel, 1,4°, un saut de 5 minutes sur deux passait encore). Levier de mesure
  `probeSunJump`. **Mesuré** (même balayage) : 1,20 / 1,35 / 1,50 / 1,80 → **1,003 / 1,004 / 1,003 / 1,006** ; midi inchangé (0,957). Coût : au
  temps réel, quatre images de sonde de plus par minute de jeu (non chronométré).

## Le dessin de l'appareil coûte 4 à 5 ms sur kerr-mini (et non 0,25 ms) — le MSAA 4× de sa passe

- **Mesure propre** (14 nov., ~01:03 UTC ; kerr-mini, e2e `perf-ab` `SET=ship SUBS=4 NOVSYNC=disable-gpu-vsync`, fenêtre 1600 × 1000, F-35 à
  900 m au nord de Tarifa, côtés A B B A A B, **les données attendues avant la première paire** ; A/A +0,8 ms) — Δ de l'image en sautant :

  | Ce qui est sauté | Δ |
  |---|---:|
  | l'appareil entier, depuis le cockpit (`debugSkipShip`) | −4,4 |
  | ses coques (`ship.debugSkip` `hull`), depuis le cockpit | −2,3 |
  | l'appareil entier, caméra « chase » | −5,1 |
  | l'appareil entier vu de 30 m / de 300 m (monture « around ») | −5,3 / **−2,1** |
  | ses coques, vu de 30 m | −5,4 |
  | ses verrières / flammes et feux / brume de chaleur, vu de 30 m | −0,2 / +0,2 / +0,1 |

  Avant (mêmes runs, autres positions — valables) : l'ombrage des coques au bruit, même réduit à un gris constant (`ship.debugFs` 8) ; ses
  parties (ombre, réflexion d'écran, spéculaire) au bruit ; la composition dans la scène (`shipInScene`) −0,8 ; le masque propre +0,9 ; la carte
  d'ombre −1,2 ; la profondeur préalable au bruit. **Retirés** : les « −10,5 à −12,1 ms à 30 m » et « −5,9 à −7,0 ms des flammes » — chaque fois la
  première paire d'un passage, mesurée pendant que le sol et le décor de Tarifa arrivaient encore (son côté A 66–68 ms au lieu de 62–64) : un
  biais de 4 à 6 ms que l'ordre A B B A A B n'annule pas (non linéaire) ; `perf-ab` attend maintenant les données avant la première paire.
- **Reproduit** (second passage identique, A/A −0,1) : −4,5 / −3,8 / −5,3 / −5,8 / **−2,6** / −4,5 ; verrières +0,9, flammes +1,2, brume +0,2.
- **Lecture** : le coût est le dessin des coques (le F-35 : 93 000 triangles, MSAA 4×, et le trafic du détroit), **pas leur ombrage**, et il
  croît avec la surface couverte (4–6 ms de près). **Vu de loin, rien d'établi** (~01:21 UTC) : à 300 m l'appareil entier −1,9 et ses coques seules
  −1,5, pour un A/A +1,3 — au bord du bruit ; et 90 000 sommets ne pèsent presque rien pour ce GPU (hors ligne : depuis le cockpit, 3 % des
  triangles opaques du F-35 sont dans le champ) : la « part des sommets ≈ 2 ms » écrite plus tôt était une lecture trop forte — **retirée**.
  Restent, pour le coût de près : la rastérisation MSAA 4× (deux fois : la profondeur préalable puis l'ombrage), les coûts fixes des passes.
- **Sur J0** (~01:16 UTC, l'ablation `ship` de `j0-reference`, ordre base, ship, base, ship, base, kerr-mini à 1 278 MHz, « Nominal ») : GPU p50
  56,4 / 55,3 / 55,3 ms contre **52,2 / 52,0** sans le dessin de l'appareil — **−3,3 à −3,6 ms** ; le −0,25 du 10 nov. (GRAPHICS-PIPELINE §8.4)
  **périmé**. Les deux scènes concordent : l'appareil, 3,5 à 4,5 ms sur kerr-mini (cible 40 ms).
- **Le levier nommé : le MSAA 4× de sa passe** (~01:36 UTC ; `SHIP_MSAA`, une constante lue au chargement — `globalThis.__shipMsaa = 1` avant la
  page, `perf-ab` `SHIP_MSAA=1` —, la passe dessinée alors droit dans son image résolue). En 1×, sauter l'appareil ne rend plus que **−0,9 / +0,2
  ms (cockpit), −0,8 / −1,1 (chase), −3,3 / −0,3 (30 m)**, contre −4,4 à −4,8 / −5,1 à −5,6 / −5,3 à −5,8 en 4× (deux passages chaque) : **le
  MSAA de l'appareil coûte 4 à 5 ms sur kerr-mini**. Retirer l'usage `TEXTURE_BINDING` de sa profondeur multiéchantillonnée (que rien ne lit) :
  sans effet mesuré (gardé, l'usage juste). **L'image** (captures `perf-ab` `SHOTS=1`, vue à 30 m, kerr-mini, non commitées — budget des
  binaires plein) : en 1× les bords de l'appareil en escalier (ventre, dérives), ses petits feux et lignes fines scintillent davantage ; en
  mouvement, des bords qui sautillent. **Décision de Sam** (PLAN-J3 §8, question 6) : garder le 4× (son prix, 4–5 ms) ou passer à 1× (l'appareil
  lissé par l'accumulation temporelle seule — aujourd'hui son poids d'image ≥ 0,5, `CRAFT_ALPHA` : à revoir alors) ; rien n'est changé.
- Un niveau de détail vu de loin : gain non établi (≤ 2 ms, au bord du bruit).
- **La boîte de la passe n'est pas le levier** (~03:13 UTC ; `ship.lastBox`, relevé par `perf-ab` `SET=ship`) : cockpit et « chase » 100 % de
  l'image (1440 × 810), coût −3,8 / −6,7 ms ; vu de 30 m 22 %, −5,0 ; de 300 m 8 %, −2,6 (A/A −0,2) — le coût ne suit pas l'aire de la boîte
  (l'effacement et la résolution du MSAA) mais les pixels de l'appareil : resserrer la boîte ne rendrait presque rien. Le levier reste le MSAA
  lui-même (question 6 de PLAN-J3).

## ~~Le HUD : l'oscilloscope spatial touche la carte du hub d'un pixel (e2e `hud-layout`, état « 02-circ »)~~ — réglé le 14 novembre 2026 (~15:19 UTC)

- **Constaté** (14 nov. 2026, ~03:21 UTC, kerr-mini) : `.fl-hubcard [1106,783,258,265] × space-scope [1267,560,314,224]` — **aussi avec le code
  d'avant** (`hud/layout.ts` de HEAD remis pour l'essai) : antérieur. `fit` garde 6 px de marge avec les panneaux qu'il connaît : la carte du hub
  n'était sans doute pas encore dans sa mesure (en cache 250 ms) quand l'oscilloscope a été placé. Non cherché plus loin.
- **Réglé** : la carte du hub, ancrée en bas, grandit vers le haut quand une ligne s'ajoute ; la mesure des panneaux (en cache 250 ms) gardait
  son ancien haut. `flighthud.ts` redemande la mesure (`hud/layout.ts` `remeasure`) quand la carte apparaît, disparaît ou change de hauteur
  — pas à chaque mise à jour : une mesure coûte ~1,6 ms. `hud-layout` **10/10 deux fois** (9/10 avant, deux fois) ; tests HUD 151/151.

## L'observatoire : la bouche du trou de ver à peine plus claire que le ciel au télescope (e2e `observatory`, 1 sur 6)

- **Constaté** (14 nov. 2026, ~15:27 UTC, kerr-mini, trois passages) : « the wormhole: found as Gargantua… » — le posemètre spot lit le cœur de la
  bouche **1,32 / 1,33 / 1,83 fois** le ciel derrière (le test veut > 2) ; valeurs brutes 3,5·10⁻¹¹ contre 1,9·10⁻¹¹. Capture (`E2E_SHOTS`) :
  ciel bleu de crépuscule (2026-01-11 17:32 UTC, « au mieux près de Saturne »), la bouche à peine visible dans le cercle. Les 5 autres tests
  passent. Déjà noté en échec à la fin de PLAN-CAMERA-AAA (29 oct.). **Non tranché** : le ciel du soir plus clair depuis (modèles du ciel et du
  crépuscule revus) ou l'autre univers plus sombre dans la bouche ; à comparer à une version d'octobre (`ab-commit`).
- **Tenté** (même jour) : `ab-commit 3f825497` (14 oct., le posemètre spot) + `ab-e2e` sur kerr-mini — le serveur de développement d'alors
  échoue en `EMFILE` (trop de fichiers ouverts, même `ulimit -n 65536`) ; en `NODE_ENV=production` il sert, mais **le harnais e2e d'aujourd'hui ne
  démarre pas sa page** (`beforeAll` expiré à 200 s) : pas de côté A. Le côté B redonne 1,30. Pour trancher : un harnais d'époque (le test et
  `lib/` de ce commit), ou une sonde du ciel et de la bouche séparés (la luminance du ciel à la même heure, l'autre univers seul).
- **Sondé** (~15:39 UTC, `OBS_SHIFT_H`) : **la bouche est intacte, c'est le ciel**. Au « meilleur moment » de l'observatoire le Soleil n'était
  qu'à −12,2° (crépuscule nautique : la règle de l'observatoire, `system/observing.ts`, −12° pour tout objet faible ; le meilleur moment, le plus
  haut, tombe au début de la fenêtre pour une bouche qui se couche tôt) — 1,42× ; deux heures plus tard, Soleil −21,7°, **6,27×**. **Fait** : le
  trou de ver veut la nuit astronomique (`seeingRule` : Soleil sous −18°, test unitaire) — son meilleur moment 18:09, Soleil −18,1° : **1,86×**,
  encore sous 2. **Reste ouvert** : le ciel du modèle à −18° est ~4 fois celui de la pleine nuit (4,7·10⁻¹³ contre 1,2·10⁻¹³) — le crépuscule réel
  y est presque éteint : un crépuscule du modèle trop long ? À mesurer contre une courbe de référence (luminance au zénith selon la profondeur du
  Soleil) avant d'y toucher ; le seuil du test laissé tel quel.
- **Mesuré ensuite** (~15:43 UTC, J0 `coherence` de midi à la nuit, Toulon 10 juillet, `sunAlt` relevé) : **le crépuscule du modèle finit où il doit**
  — le ciel tracé (sonde de l'appareil, fond de nuit compris) vaut 7,5× son plancher de nuit à −12,7°, 2,3× à −15,1°, 1,1× à −17,2°, 1,0× à −19,2°
  (le crépuscule réel s'éteint à −18°). Les 4× de l'observatoire à −18° tiennent donc plutôt à la direction visée (bas sur l'ouest, du côté du
  Soleil couché) qu'à un crépuscule trop long. Le seuil du test (> 2) reste une question de moment choisi, pas de modèle.

## La compilation du noyau de Jupiter proche : ~200 s à froid (M1 Max, 6 nov.) — 60 s sur kerr-mini le 13 nov., ~47 s à l'arrivée d'un voyage depuis le 13

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
- **Remesuré** (2026-11-13 ~23:02 UTC, kerr-mini ; l'ancien chiffre est du M1 Max, autre machine) : la vue près de Jupiter demandée → plus rien ne compile,
  **60,3 s à froid** (une constante de pipeline poussée d'un cheveu, `AJ_COLD` : le cache du pilote manqué, comme à chaque nouvelle version) et
  **5,2 s à chaud** — `main` 42–47 s puis `env` 19–20 s, en série. La clé de Jupiter proche est celle de Mars (NEAR_KIND 2, monde avec air).
- **Fait : la compilation en avance au départ d'un voyage** (`renderer.prewarmNear`, appelée par `travelTo` — G, ⇧G, `goTo`, les visites) :
  la clé du corps visé devinée juste (celle de l'arrivée, 2/2) ; e2e `voyage-prewarm`, voyage G de la Terre à Jupiter (20 s), noyaux à froid :
  attente à l'arrivée **73,7 / 73,7 s → 46,7 / 47,6 s** (A/A serré des deux côtés). Plafond de ce levier : la durée du voyage. **En passant** :
  l'indicateur des compilations perdait le libellé d'un noyau quand un autre du même nom finissait (35 s de compilation de Jupiter affichées
  « rien ») — compté maintenant. **Reste** : ~47 s à froid après un voyage de 20 s (le noyau principal partage le GPU avec celui d'un monde sans
  air croisé au départ, 36 s pour rien) ; la spécialisation du noyau des géantes (ce que Mars apporte à leur clé commune) non essayée.
  **Lu dans le code** (non vérifié en vol) : le corps « proche » est le plus proche en rayons à moins de 300 de ses rayons (`local-patch.ts`
  `LOCAL_RANGE`) — la Lune jusqu'à ~520 000 km d'elle : en quittant la Terre la caméra passe dans sa portée, sa clé (NEAR_KIND 3) compile
  pendant le voyage, en concurrence avec celle du but (`main` de Jupiter 42,6 s seul, 47,3 s à côté). Gain d'un correctif ≈ 5 s à l'arrivée
  (règle 1 : petit) ; il toucherait à la portée du corps proche en transit — pas fait.

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

## ~~Jupiter vu de près depuis l'hémisphère sud : l'image parfois toute noire~~ — réglé le 13 novembre 2026 (~22:16 UTC) : un signe perdu dans `giantLevel`

- **Constaté le 6 novembre 2026** (AM3, e2e `aurora-jupiter` et une sonde jetable) : la caméra libre à 7 000–14 000 km
  au-dessus de 50–55° S, regardant vers le sud, l'image est entièrement noire, étoiles comprises (luminance moyenne 0,1 sur
  255), **aurore éteinte comme allumée, de jour comme de nuit** — ce n'est pas l'aurore. Une autre fois, la même vue
  s'affiche (étoiles, limbe, ovale sud). Pas d'erreur GPU (`gpuErrors` 0), temps GPU normal (7–14 ms), une fois 0,5 ms.
- **Piste** : un NaN ou une exposition qui part (le posemètre après la coupe), le chemin des géantes proches
  (`giantInside`, la tuile de turbulence) sur l'hémisphère sud ; relire la luminance du posemètre et les pixels NaN dans
  cette vue.
- **Reproduit et rétréci** (~21:57 UTC, e2e `aurora-jupiter` sur kerr-mini, runs `…-aurora-giants-now`, `…-aurora-jupiter-diag` ; le test
  relève désormais l'exposition et la couleur de scène relue) : la vue `south-act5` (0,2 RJ au-dessus de 50° S, vers le sud) est **noire,
  étoiles comprises**, deux runs sur deux — et le test passe (il ne vérifie pas l'image). La couleur de scène (`sceneColor`, l'image de la
  reconstruction) : **exactement 0 partout** (max 0, moyenne 0), **aucune valeur non finie** ; l'exposition 32 EV comme dans les vues qui
  marchent (`north-act5` max 0,15, `south-far-act5` à 0,5 RJ max 0,047). **Ni un NaN, ni l'exposition** : le traceur rend un noir absolu.
  **Piste** : la caméra dans l'enveloppe du volume de la géante (PLAN-GEANTES-VOLUME, la hauteur tangente — V3) près de la surface au sud
  (aplatissement 0,065 : à 50° S le rayon est plus court) — tout absorbé ; à vérifier en faisant varier l'altitude.
- **Balayé** (~22:00 UTC, `AJ_SWEEP=1`, run `…-aurora-jupiter-sweep`) : au-dessus de **50° S**, l'image est nulle **quels que soient le
  regard** (vers le sud, le nord, l'horizon) **et la hauteur** (0,1 et 0,2 RJ) ; à **30° S** et, en miroir, à **50° N** elle est normale (max
  0,225 et 0,11). La piste du volume (la hauteur) tombe : **c'est la position de la caméra**, à ces latitudes du sud, qui éteint toute l'image —
  vraisemblablement un paramètre par image calculé depuis la caméra qui devient non fini (rendu ensuite à 0 par un `max(…, 0)`), ou un
  chemin choisi par la caméra (la tuile de turbulence des géantes proches, `bakeGiantTile` ; `giantInsideOn`). Prochain pas : relire les
  paramètres de l'image (`P`) dans cette vue, chercher le non-fini.
- **Paramètres relus** (~22:03 UTC, run `…-aurora-jupiter-params`, le test relève `renderer.paramsF`) : **aucun non-fini** dans les paramètres
  de l'image, dans la vue noire comme ailleurs. Le défaut est donc côté GPU : une table ou une texture calculée depuis la caméra et lue par
  tout pixel (candidats : la tuile des géantes proches `bakeGiantTile`, les tables du ciel ou de l'air de la géante, la sonde) — à relire
  par une passe qui compte les non-finis d'une texture (comme `readSeaSky`).
- **Écarté aussi** (~22:06 UTC, runs `…-aurora-jupiter-bodies`, `…-aurora-jupiter-key`) : la table des corps (`bodyData`) sans non-fini ; **la même
  variante du noyau** (clé 134234848, compilée, ni échec ni abandon) dans les vues noire et normales, le pipeline raster, pas de raster de
  corps. Reste une donnée calculée sur le GPU depuis la position de la caméra (la tuile, l'air de la géante, la sonde) : un lot à part, avec
  une relecture de texture par candidat.
- **Écarté encore** (~22:08 UTC, run `…-aurora-jupiter-hd`) : la carte HD (« jupiter », complète) et la tuile (« done ») **les mêmes** dans les
  vues noire et normales. Reste un calcul **dans le noyau**, commun à tous les pixels et fonction de la position de la caméra (la figure
  aplatie de Jupiter vers 50° S, l'air ou le pont de nuages à la verticale de la caméra — `giantInsideOn`, `GI_FAR` —) devenu non fini :
  prochain pas, une sortie de diagnostic du noyau (la valeur au pixel central, par étape) — un lot à part.
- **Cause et correctif** (~22:16 UTC) : `trace.wgsl` `giantLevel` (et son jumeau `giant-clouds.ts`) prenait `n.y · |z| / ba` — `n.y` signé, `|z|`
  non : au sud le terme passait négatif, le facteur de niveau traversait l'infini vers 45° S et devenait négatif au-delà ; `giantInsideOn` (la
  hauteur de la caméra × ce facteur sous le pont de nuages + 450 km) prenait alors la caméra **sous les nuages** : le chemin intérieur
  absorbait tout, étoiles comprises. Le terme signé (`n.y · z / ba`) rend le facteur symétrique (1,052 à ±50°). **Vérifié** (kerr-mini, run
  `…-aurora-jupiter-fixed`) : `south-act5` montre étoiles, Voie lactée et l'ovale sud (max 0,095 au lieu de 0) ; les cinq vues du balayage
  normales ; un test unitaire fige la symétrie (`tests/giant-clouds.test.ts`, 13/13). **Touchait aussi** (non vérifié à l'image) : les hauteurs
  des ponts et des brumes dans l'hémisphère sud des géantes (le facteur faux de 0 à 45° S), les chiffres du cockpit d'un appareil au sud.

## ~~Le coût de l'aurore terrestre de près, la nuit : +4,6 ms sur le M1~~ — mesuré nul le 13 novembre 2026

- **Mesuré le 6 novembre 2026** (e2e `aurora-cost` sur kerr-mini, Nominal, plein écran, ABAB, médiane de 24 lectures) :
  Tromsø, Kp 4, de nuit, regard au sud : 36,2 → 40,8 ms (échelle de rendu 0,75 des deux côtés), ~+12 %. Depuis 400 km :
  +2,1 ms (échelles différentes, à refaire). Le schéma de la magnétosphère : +2,3 ms à échelle 1,00 après passage à la
  demi-résolution (≥ +5,5 ms avant). Jupiter : +0,5 ms.
- **Déjà fait** : 16 évaluations par rayon au lieu de 40 ; aucun noyau d'aurore quand l'œil est adapté à plus de 1 000 lux ;
  les rayons qui restent sous 45° de latitude magnétique sautés (gain de ces deux tris non mesuré).
- **Piste** : le cache par direction d'Alex (§ 7.5 : une carte octaédrique marchée depuis l'œil, une bande par image, lue par
  la composition) — au-delà de ~100 km sans parallaxe ; la marche à ¼ de résolution recomposée.
- **Remesuré le 13 nov.** (~22:30 UTC, e2e `aurora-cost` sur kerr-mini, run `…-aurora-cost-now`) : **Tromsø Kp 4 de nuit 37,05 → 36,95 ms
  (Δ −0,1, au bruit ; échelle 0,75 des deux côtés)**, l'aurore bien dessinée (vue relue) — le coût de l'aurore au sol a disparu (les tris
  ajoutés depuis — moins d'évaluations, rien sous 45° de latitude magnétique, aucun noyau au-delà de 1 000 lux —, leur gain enfin mesuré). Jupiter
  +0,4 ms. Depuis 400 km +1,7 ms et le schéma de la magnétosphère +3,35 ms : **échelles différentes entre les côtés** (0,88 / 1,00 et
  0,88 / 0,80) — non lisibles, à refaire à échelle fixe. **Règle 1** : au sol, plus de gain à prendre ; pas de lot de performance.
- **À échelle fixe** (~22:35 UTC, `AC_FIXED=1`, run `…-aurora-cost-fixed`, kerr-mini) : Tromsø −0,55 ms (nul), **orbite à 400 km +0,95 ms**,
  Jupiter +0,25 ms, **le schéma de la magnétosphère +2,45 ms** (échelle 1,00 des deux côtés). Règle 1 : seul le schéma passe 1 ms — un mode de
  visualisation vu de 400 000 km, hors du profil principal (§8) : pas prioritaire ; l'aurore elle-même ne demande plus de lot.

## ~~Saturne vue de son ombre, l'œil adapté : des artefacts partout~~ — revue le 13 novembre 2026 (~22:20 UTC) : l'adaptation rendue ; le grain réduit le 14 (la lumière des anneaux, 4 échantillons stratifiés)

- **Constaté le 6 novembre 2026** (AM4, e2e `aurora-giants` sur kerr-mini) : la caméra à un rayon au-dessus du côté nuit de
  Saturne, dans son ombre, l'exposition adaptée au noir (comme pour Jupiter) : l'image se couvre de croissants pixellisés
  dans tout le ciel et de trous dans le disque. À la lumière du jour, rien de tel : c'est une lumière faible et fausse du
  traceur autour de Saturne (la lumière des anneaux sur la face nuit ? un bruit d'accumulation ?) que le gain révèle.
- **Raccord** : l'œil n'est pas adapté à l'ombre de Saturne (`earthSunlight`) ; ses aurores sont calculées mais à leur
  radiance physique, donc invisibles de nuit. **Piste** : relever cette lumière (sonde de pixels) et la corriger, puis
  rendre l'adaptation à Saturne.
- **Revue** (~22:20 UTC, e2e `aurora-giants` avec une vue `saturn-night` — un rayon au-dessus du point antisolaire, l'œil adapté : Saturne
  remise dans `earthSunlight` avec Jupiter, Uranus et Neptune — ; run `…-aurora-saturn`) : **ni croissants pixellisés dans le ciel ni trous
  dans le disque** ; le disque éclairé par les anneaux, les anneaux et les étoiles nets. Reste **un grain** sur la moitié du disque que les
  anneaux éclairent peu (le bruit de cette lumière faible, vraisemblablement — non sondé). Cause probable du défaut du 6 nov. (non
  prouvée) : le facteur de niveau des géantes faux au sud (`giantLevel`, réglé ce jour) ou la sonde en demi-flottants (réglée ce jour).
  L'adaptation à Saturne gardée ; le raccord retiré.
- **Le grain sondé** (2026-11-13 ~23:08 UTC, kerr-mini, e2e `aurora-giants` `AG_ONLY=saturn AG_GRAIN=1`, run `…-saturn-grain`) : **du bruit, pas une
  texture** — monde figé, la couleur de la scène relue à 1,5 s puis 8 s d'écart change de **18–29 %** en moyenne (|Δ| sur la moyenne) ; dispersion
  spatiale 0,68 (moitié haute, peu éclairée, luminance 0,0024) et 0,34 (moitié basse, 0,045). Figée, l'image devient un bruit fin pixel par pixel ;
  les taches marbrées de la vue vivante sont ce bruit lissé par l'accumulation. (Le noyau d'affinage compilait encore : la vue figée n'a pas
  convergé.) **Source probable, non isolée** (les 32 bits de `TUNE_GSKIP` sont pris) : la lumière des anneaux (`ringShine`, `trace.wgsl`) — la
  seule sur la face nuit, 10 échantillons aux azimuts tirés à chaque rayon à travers le bord net de l'ombre de la planète sur les anneaux ; le
  tirage de la phase du volume des géantes (V7) est l'autre candidat. **Piste** : cette lumière varie lentement sur le disque — la calculer une
  fois par image dans une petite table (latitude × heure locale, beaucoup d'échantillons), lue par pixel ; ou plus d'échantillons stratifiés.
  Vue hors du profil principal (§8) : pas de lot ouvert.
- **Réglé** (2026-11-13 ~23:33 UTC) : **la source prouvée et réduite** — levier `TUNE_RING_SHINE_N` (échantillons stratifiés par secteur d'azimut de
  `ringShine`) ; mesure en temps réel (le gel lançait le noyau d'affinage et brouillait la comparaison), deux passages par côté, kerr-mini :
  changement d'une image à l'autre **19–22 % / 16–17 % avec 1 → 7,4–7,5 % / 5,5 % avec 4** (moitiés haute / basse) ; le coût sous le bruit du
  compteur GPU sur cette vue (13,6–19,2 ms contre 13,7–16,0, ±3 ms). **4 par défaut** ; vérifié sans réglage : 8,3 % / 5,2 %, Uranus et Neptune
  dessinées, 0 erreur. Le reste du bruit : le tirage de phase du volume (V7), non sondé.

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
  - *(13 novembre ~22:43 UTC : la cause restante trouvée et réglée — e2e `pwa` instrumenté, kerr-mini. Après une seule visite, hors ligne, 5 cartes
    échouaient encore (`moon/mars/mercury/jupiter/saturn-HASH.jpg`) : le tableau des grandes cartes (`MAPS_HI`) passe par le transcodeur KTX2,
    un worker qui démarre avant que le Service Worker tienne la page (enregistré après `Renderer.create`) ; ses premiers fichiers (Terre, Lune,
    Mars en `.ktx2`) allaient au réseau sans être gardés, et `warmShell` ne lit que les ressources de la page. Hors ligne, le tableau
    compressé échouait (« Failed to fetch ») et le repli JPEG demandait des fichiers jamais chargés. Réglé : le module KTX2 note ce qu'il fait
    charger (`src/pwa/seen.ts`), `warmShell` le reprend ; après : Terre, Lune, Mars et les matériaux du sol gardés, hors ligne aucun fichier du
    jeu en échec (seul `/__deepgram`, le relais du serveur de dev), `pwa` 2/2. **Vérifié en production** le 14 nov. (~02:31 UTC, GitHub Pages
    `9d78dca`, `pwa` lancé contre le site — `E2E_URL` —, kerr-mini) : hors ligne après une seule visite, 0 fichier en échec, 2/2. Le constat
    ci-dessous reste l'historique.)*
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
