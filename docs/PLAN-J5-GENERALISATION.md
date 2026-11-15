# PLAN-J5 — la généralisation contrôlée, après une J4 hors budget

**État (15 novembre 2026, 06:10 UTC) : mené jusqu'aux décisions de Sam** sous la consigne « continue le plan » (comme PLAN-J3 et PLAN-J4),
chaque réglage provisoire daté et révisable. **Fait** : J5-0 chiffré (petits arbres 4 px −0,7 / 6 px −1,75 ms ; MSAA 1× ≈ −3,4 ms au cockpit ;
houle demi-résolution −0,5 / −0,7, non gardée) ; J5-1 rangé (présence ~2,7 ms sous orage, 0 au beau temps) ; J5-2 clos (les corps déjà en
raster) ; J5-3 : la marche sur la Terre reste tracée — le raster à pied attend des arbres proches en géométrie (59 ms de restes à Chamonix) ;
J5-4 : l'export de la vue vivante sort l'image montrée (corrigé). J5-3 fermé (à pied, le tracé est le moins cher : 34 ms contre 70).
**Attend Sam** : la confirmation des réglages provisoires (§3 : l'image gardée), qui ouvre J5-R ; le lot d'assets des arbres proches. Jalon de la [stratégie](ANALYSE-STRATEGIE-RENDU-2026-11-03.md)
§15 J5 : « étendre aux autres corps droits, à la marche puis aux transitions ; finaliser HDR/SDR/exports ; conserver les phénomènes
scientifiques sur le chemin spécialisé ; retirer les portions terrestres historiques devenues redondantes après validation de la parité ».
**Sortie** : *un renderer produit principal par domaine, pas une nouvelle option permanente parmi cinq compromis.*

Le code fait foi. Les trois règles de méthode (CLAUDE.md) s'appliquent à chaque lot : le gain maximal lu dans une fiche avant un lot de
performance, l'ancien chemin d'un levier allumé retiré au lot de retrait suivant, une sonde neuve passée par ses témoins.

## 1. Le point de départ : J4 n'a pas atteint sa sortie

La stratégie le dit (§15, « si un jalon manque ses objectifs ») : **ne pas généraliser une architecture qui reste hors budget** ; identifier le
coût réel par poste, modifier une hypothèse ciblée, documenter l'écart et l'arbitrage produit. Au 15 novembre ([PLAN-J4 §10](PLAN-J4-VOLUMES.md)) :

| Poste (kerr-mini) | Mesuré | Source | Ce qui le réduirait |
|---|---:|---|---|
| L'eau sur J0 | 16,2 ms (`earth water` 12,7) | fiche J0 de sortie de J2 | les étapes E1/E2 et les tuiles faites ; la houle : son travail (J4-4) |
| La houle côtière, côte proche | +3,3 à +3,5 ms (+0,8 sur J0) | sonde `coast-swell`, 15 nov. | faire moins : demi-résolution, ou seulement où ses crêtes sont résolues (décision d'image) |
| Les nuages sous orage | 16,5 ms (`clouds (half)`), dont leur lumière ~9,8 | PLAN-J4 J4-2 | la structure du noyau des nuages (son découpage) |
| Le décor au-dessus d'une forêt | ~8,6 ms (Maures, après la carte d'ombre) | PLAN-J4 §10, un passage | le seuil des petits arbres (≈ −2,7 ms, décision d'image) ; la carte d'ombre des arbres (≈ −1,4) |
| L'appareil (F-35) | 3,5–4,5 ms, dont le MSAA 4× 4–5 ms | PLAN-J3 question 6 | `SHIP_MSAA` 1 (décision d'image, levier prêt) |

Sur la cible du mini (40 ms) J0 est à 53–57 ms : **l'écart de ~15 ms ne se ferme qu'avec des décisions d'image** (petits arbres, MSAA de
l'appareil, résolution de la houle) **ou avec un découpage des noyaux de l'eau et des nuages** — aucun levier sans coût d'image ne reste
au-dessus de 1,6 ms dans les mesures de J4.

## 2. Les lots proposés

| Lot | Contenu | Plafond lu (règle 1) | Preuve | Taille |
|---|---|---|---|---|
| **J5-0** | **Les arbitrages d'image chiffrés** : pour chaque levier qui change l'image — le seuil des petits arbres (`treeMinPx` 2,5 / 4 / 6), le MSAA de l'appareil (4× / 1×), la houle à demi-résolution —, son gain en A/B répété et sa planche au même instant, posés devant Sam | petits arbres ≈ 2,7 ms, MSAA 4–5, houle ≤ 3,5 sur une côte | A/B A B C répétés, planches | M |
| **J5-1** | **Le noyau des nuages découpé** : la marche de densité et la lumière en deux noyaux (comme le sol différé et l'eau étagée), pour que la lumière cesse de peser par sa présence | la lumière des nuages ~9,8 ms sous orage, ~2 ms au beau temps (à lire) | ΔGPU J0 beau temps et orage | L |
| **J5-2** | **Les autres corps droits** : la Lune, Mars, les mondes de PLAN-PLANETES-AAA sur le même socle raster (visibilité, `shadeLite`, eau où il y en a), leurs scènes de référence et leurs fiches | à lire par scène | fiche par corps | L |
| **J5-3** | **La marche et les transitions** : le personnage (character e2e), l'orbite → le sol, la Terre → l'espace ; ce que chaque transition laisse dans l'historique (contrat de la reconstruction) | qualité (transitions) | e2e de parcours, images | L |
| **J5-4** | **HDR/SDR/exports** : la sortie de l'image (hdrMap, AgX), les captures et les vidéos sur la même chaîne que l'écran | qualité | captures SDR sur kerr-mini (mesures de couleur), exports | M |
| **J5-5** | **L'eau à demi-rythme** (ajouté le 15 nov. après la répartition de J0) : un pixel sur deux par image, des groupes de 32 fils | J0 −8,4 ms (une tuile sur deux sautée) | ΔGPU J0 et à 30 m, captures — **allumé : −6,0 à −7,2 ms** (§5) | M |
| **J5-6** | **Le matériau du sol à demi-rythme** (`shadeLite`, sa lumière) : le même schéma que l'eau, le voisin classé (eau, arbres, ponts) et sa photo gardée | **J0 ~2,3 ms** (lu : `earth lite` 3,8 → 2,0, sa lumière 1,3 → 0,8) ; plus sur la terre | ΔGPU J0 et forêt, images en mouvement (le détail des photos) — **essayé : plus lent (+0,9 J0, +2,7 forêt), retiré** (§5) ; **refait par la reconstruction (15 nov.) : J0 −1,9 à −3,2 ms, les Maures −5,7 à −6,3 ; les houppiers un peu « peignés » en mouvement — **laissé au joueur (réglage « demi ») par Sam, « auto » inchangé** | L |
| **J5-R** | **Le retrait des chemins terrestres redondants** : le tracé de la Terre proche (repli dormant depuis J2-7, PROBLEMES) et les options sans utilisateur — après validation de la parité ; une décision de Sam | compilation et code | suite, J0, `kernel-budget` | M |

**Ordre recommandé** : J5-0 d'abord (les décisions d'image sont la seule voie mesurée vers 40 ms : elles reviennent à Sam), puis J5-1
(le poste lourd sans coût d'image), J5-2 → J5-3 → J5-4, J5-R en dernier.

## 3. Questions pour Sam

1. **Les arbitrages d'image (J5-0)** : accepter, au vu des planches, des arbres de moins de 4 (ou 6) px laissés à la photo ; le MSAA de
   l'appareil à 1× ; la houle à demi-résolution ?
2. **Le découpage du noyau des nuages (J5-1)** avant la généralisation, ou la généralisation d'abord ?
3. **Le repli tracé de la Terre (J5-R)** : le retirer une fois la parité vérifiée, ou le garder comme filet des GPU faibles ?

**Décisions de Sam (15 novembre, 08:34 UTC)** : **aucun arbitrage d'image** (ni MSAA 1×, ni petits arbres, ni nuages amortis) — la
cible du mini reste à ~48 ms pour l'instant ; **l'eau à demi-rythme gardée** (J5-5, son ancien chemin retiré : J5-R2).

**Réglées provisoirement le 15 novembre, selon les recommandations du plan — révisables par Sam** (avant ses décisions ci-dessus) : 1. **l'image gardée telle quelle** —
le seuil des petits arbres à 2,5 px (4 px : −0,7 ms, sous 1 ms, règle 1 ; 6 px : −1,75 ms mais la forêt lointaine s'éclaircit) ; le MSAA
de l'appareil à 4× (1× : ≈ −3,4 ms au cockpit, mais des bords en escalier) ; la houle en pleine résolution (demi-résolution : −0,5 / −0,7,
non gardée) ; 2. J5-1 rangé (présence ~2,7 ms sous orage seulement) ; 3. le repli tracé gardé ; **J5-R** : les anciens chemins des réglages
provisoires de J3 et J5 (`TUNE_SKYFLAT_DIM`, `TUNE_SHIP_SCENERY_SHADOW`, `treeShadowCut`…) retirés **à la confirmation de Sam** (la règle de
J3-R) ; les leviers de mesure restent.

## 4. Non vérifié

Les plafonds de J5-1 au beau temps, de J5-2 par corps et la parité du repli tracé ne sont pas mesurés. Aucun gain n'est promis.

## 5. Avancement

- **Le plan** (15 novembre, 04:55 UTC) : écrit après la fermeture de J4 ; les questions du §3 réglées provisoirement (aucune décision
  d'image prise).
- **J5-0, le seuil des petits arbres chiffré** (2026-11-15 05:00 UTC) : J0 parti au-dessus des Maures (kerr-mini), A B C A B C A —
  références 54,4 (la première, chaude) / 52,4 / 52,5 ms ; arbres de moins de 4 px laissés à la photo **51,75 ms (−0,7)** (52,1 / 51,4) ; de
  moins de 6 px **50,7 ms (−1,75)** (50,8 / 50,6) — moins que l'estimation d'un seul passage (−2,7). **Image** (captures de fin de vol, même
  instant du même vol) : les pentes proches inchangées ; **sur les versants lointains, à 6 px, la forêt s'éclaircit** — les trouées et la
  photo jaune apparaissent où la forêt était d'un vert sombre uniforme ; à 4 px, la différence est faible. L'écart pixel à pixel base / 6 px
  est de l'ordre de l'écart entre deux références (le vol bouge) : la planche, pas un chiffre, montre la différence. **Aucune décision prise** :
  le choix 2,5 / 4 / 6 revient à Sam (question 1).
- **J5-0, le MSAA de l'appareil chiffré ; J5-1, son plafond au beau temps** (2026-11-15 05:12 UTC) : `perf-ab SET=ship` (Tarifa, kerr-mini,
  ×4, trois alternances), ce que coûte le dessin de l'appareil — MSAA 4× : cockpit 3,4 ms, autour à 30 m 5,1, poursuite 4,8 ; MSAA 1× :
  ≈ 0, 1,0, 2,5 — **le 1× rendrait ≈ 3,4 ms au cockpit, 4,1 autour, 2,3 en poursuite** (A/A 0,7 et 0,0). **Image** : à 1×, les bords de
  l'appareil en escalier (ventre, dérives) que l'historique ne lisse pas (planche dans T3, non commitée). **Aucune décision** : question 1.
  **J5-1** : la marche de lumière des nuages au beau temps sur J0 (ablation `cloudLight`, deux fois) **≈ 0 ms** (55,9 / 55,2 contre 55,3 /
  55,2) — le découpage du noyau des nuages ne paierait que sous ciel chargé (~9,8 ms sous orage) : son plafond est celui du profil lourd.
- **J5-1, le plafond du découpage lu** (2026-11-15 05:17 UTC) : sous orage (J0 `J0_WEATHER=storm`, kerr-mini, deux fois) — référence
  78,7 / 79,1 / 77,8 ms ; la marche vers le Soleil coupée **à l'exécution**, son code gardé (levier de mesure `cloudLightRuntimeOff`,
  `FLAG_CLOUD_LIGHT_OFF`, ablation `cloudLightRt`) 72,4 / 72,7 (**−6,0 : son travail**) ; **compilée hors** 69,9 / 69,8 (−8,7). **Sa présence
  ≈ 2,7 ms** : ce qu'un noyau de nuages découpé (la lumière hors du noyau de la marche) pourrait rendre au plus, **sous orage seulement**
  (au beau temps la lumière entière ≈ 0). Lot possible (au-dessus de 1 ms), à ouvrir avec le profil lourd ; son travail (6 ms) ne bouge
  qu'avec moins d'échantillons ou un cache plus large — des décisions d'image.
- **J5-1, non ouvert comme découpage** (2026-11-15 05:22 UTC) : la lumière d'un échantillon dépend de la place que la marche lui trouve ; un
  noyau à part demanderait la liste des échantillons par texel (≈ 16 × 16 o par texel en demi-résolution : ~130 Mo) ; le volume de lumière
  (voxels de 1,5 km, `CLV_N` 64 sur 96 km) ne peut remplacer la marche proche (180 m, pas de 60 m) sans perdre l'ombre propre des cumulus.
  Les leviers restants sont des décisions d'image : la marche proche en 1 pas (−1,6 ms, J4-2) ou moins d'échantillons. **J5-1 rangé** avec
  ses chiffres (présence ~2,7 ms sous orage, 0 au beau temps) ; à rouvrir si le profil lourd devient une cible de Sam.
- **J5-2, les corps de référence mesurés ; J5-3, la marche sur la Terre** (2026-11-15 05:30 UTC) : `planets-baseline` (kerr-mini, vues du
  viewer, échelle fixe à part) — Terre vol bas 43,0 ms (raster) ; **Terre à pied 54,6 ms, tracée** (trace 30,8 ; à échelle fixe 115,5) ;
  Lune vol bas 25,9 / à pied 30,5 ; Mars vol bas 40,8 / à pied 27,3 (raster 1/4). **Trouvé** : sur la Terre la marche coupe le raster
  (`rasterPrimary()` : `P.walk[0].w < 0.5` ; `terrainRasterEligible` : `!walking`) — le marcheur garde le pipeline tracé, dont la marche
  rencontre la grille de sol que ses pieds touchent. **Mesuré** (levier `renderer.walkRasterOn`, la grille toujours envoyée,
  `WALK_RASTER=1` de `planets-baseline`) : à pied sur la Terre, raster **67,3 ms** (chaque pixel ombré, ×16, échelle 0,75 ; à échelle fixe
  67,8) contre tracé **54,8 ms** (×8, échelle 1 ; à échelle fixe 115,8) — à qualité comparable le raster coûte ~40 % de moins, et son image
  est nette (le tracé : flou, un losange blanc sur le versant). **Reste à établir** avant de l'allumer : le contact des pieds (la grille
  du marcheur contre le maillage du raster), sur un e2e du personnage, en raster.
- **J5-3, le raster à pied, en jeu : pas prêt** (2026-11-15 05:35 UTC) : sonde `walk-raster` (E2E_PROBE, neuve : le marcheur debout à
  Chamonix dans `game:artemis`, tracé / raster / tracé, la caméra à la troisième personne) — **tracé 36,5 / 35,0 ms** (profileur éteint),
  **raster 105,4 ms** ; profileur allumé : tracé 24,3 / 24,5, raster 133,3 dont **`earth shade (raster)` 81 ms** — le noyau des restes du
  raster (les arbres à moins de 80 m, les ponts, les boîtes marquées, tracés) prend presque tout l'avant-plan à hauteur d'homme. Image : le
  sol net mais strié, **le marcheur en traînée fantôme**. (La vue « à pied » de `planets-baseline` — 67,3 contre 54,8 ms — regarde la
  ville d'en haut : elle ne représente pas la marche.) **Conclusion** : la marche en raster attend **le champ proche en raster** (les arbres
  proches et les restes de `shade` dessinés, non tracés) et le marcheur dans l'historique du raster ; le levier `walkRasterOn` reste un
  levier de mesure, éteint. Prochain lot possible : J5-3a, « le champ proche en raster », son plafond lu sur cette sonde (`earth shade`
  81 ms à pied).
- **J5-3a, le champ proche en raster : son obstacle mesuré** (2026-11-15 05:38 UTC) : sonde `walk-raster` à Chamonix, une troisième voie —
  le raster, les arbres à moins de 80 m laissés au matériau (levier de mesure `renderer.nearTreesRays` false) : profileur allumé, raster
  132,8 ms dont `earth shade` 80,2 ; **arbres proches au matériau 77,8 ms, `earth shade` 21,0** ; tracé 24,6 / 25,0. Les arbres proches
  coûtent ~59 ms au noyau des restes ; au matériau ils deviennent **leurs volumes lisses** (ellipsoïdes, cônes — capture `raster-near`),
  et le reste (`shade` 21 ms : boîtes de bâtiments sans triangles, ponts ; `earth lite` + lumière 27 ms) garde le raster à pied trois fois
  plus cher que le tracé ; le marcheur reste fantôme. **Conclusion** : la marche en raster attend **des arbres proches en géométrie** (maillages
  ou cartes à alpha, LOD — la chaîne d'assets, §18 meshoptimizer) et le marcheur dans l'historique — un lot d'assets et de rendu (L), non
  ouvert ici. La marche reste tracée ; `walkRasterOn` et `nearTreesRays` restent des leviers de mesure (éteint, allumé).
- **J5-4, l'export de la vue vivante sur la chaîne de l'écran** (2026-11-15 05:48 UTC) : sonde neuve `export-parity` (E2E_PROBE : le départ de
  J0 de jour, HUD coupé, le monde figé, l'exposition tenue ; l'écran — capture DevTools — contre `exportRGBA`, en 16 × 9 blocs) ; témoins
  passés : A/A 0,07–0,12, +1 EV 23,5–23,7 (un premier essai en orbite, noir et étoilé, ne voyait pas +1 EV : écarté). **Trouvé** : l'export
  sortait **à la taille interne** (1440×810, l'image native à l'échelle 0,75) au lieu de l'image montrée (1920×1080, le suréchantillonnage
  temporel) — `encodePost` coupe `taau.on`, que l'export ne rendait pas : **l'image suivante perdait aussi l'historique du suréchantillonnage**
  (lu dans le code, non mesuré). **Corrigé** : `exportPNG` sort l'image montrée (1920×1080 vérifié), `exportRGBA` garde l'image native sauf
  `shown` (les time-lapses veulent une taille stable), l'état rendu après chaque export. Couleur : export contre écran 1,33 niveau en moyenne
  (dont l'interface restée à l'écran : le bloc le plus éloigné est le panneau avionique). Non vérifié : la vidéo des rendus (cible hors
  ligne, inchangée), le HDR (écran de ce Mac).
- **J5-0, la houle à demi-résolution essayée et retirée** (2026-11-15 05:57 UTC) : la passe de J4-4 reprise, un texel par bloc de 2 × 2 (au
  premier pixel de mer du bloc, lu par les quatre ; `TUNE_SWELL_HALF`), sonde `coast-swell` A/B (kerr-mini, trois passages) : vue de 250 m
  passe 70,7 / 70,7 / 70,7 contre houle dans les noyaux 71,3 / 71,3 / 71,5 (**−0,7 ms**) ; vue de 6 m 58,7 / 57,8 / 58,4 contre 58,8 / 58,9 /
  58,7 (**−0,5**) ; compilée hors 69,2 et 56,2. Images au même instant figé : à 6 m identiques (0,58 contre 0,53 au témoin A/A). Sous 1 ms
  (règle 1) : **non gardée** (patch hors du dépôt). La passe garde ~0,8–1,1 ms de temps mesuré même aux trois quarts de ses fils sortis
  aussitôt — son coût n'est pas son calcul. La houle reste à +2 à +3,5 ms sur une côte proche : un prix d'image assumé, non un lot.
- **J5-2, les autres corps : déjà sur le socle raster** (2026-11-15 06:00 UTC, relu) : PLAN-PLANETES-AAA a porté le raster à tous les mondes
  solides (`bodyLite`) ; mesurés le 15 nov. (kerr-mini, `planets-baseline`) : Lune vol bas 25,9 / à pied 30,5 ms, Mars 40,8 / 27,3 — sous la
  Terre en vol bas (43,0) et à pied dans le raster (la Terre seule y est tracée, J5-3). Rien à porter ; leurs fiches par scène restent celles
  de PLAN-PLANETES-AAA. **J5-2 clos.**
- **J5-3b, les arbres proches par leurs imposteurs ; J5-3 fermé** (2026-11-15 06:20 UTC) : la distance des imposteurs rendue réglable
  (`IMPOSTOR_NEAR_M` devient une constante surchargeable, 200 m par défaut ; `renderer.tune = { IMPOSTOR_NEAR_M: -100 }` : tous les arbres
  du matériau par leurs imposteurs), sonde `walk-raster` voie `imp` (kerr-mini) : tracé 33,9 / 34,0 ms ; raster 103,9 ; arbres proches au
  matériau 70,2 ; **par leurs imposteurs 69,9** (`earth shade` 14,2, `earth lite` + lumière 26,6) — même coût, image à peine meilleure (la
  résolution des imposteurs ne tient pas à quelques mètres : taches floues, un conifère transparent, le sol à travers). **Conclusion** : à
  pied, le tracé est aujourd'hui **le moins cher** (34 ms, sous la cible de 40 du mini) et sans question de contact ; le raster y coûte le
  double même sans les arbres proches tracés. **J5-3 fermé** : la marche reste tracée ; son flou (le tracé sous-échantillonné ×8) est sa
  limite d'image connue. Rouvrir avec des arbres proches en géométrie (assets) et un ombrage du sol proche moins cher.
- **J5-R, les anciens chemins retirés** (2026-11-15 06:22 UTC) — sous la consigne « continue le plan » (avancer sans attendre les décisions de
  Sam, les réglages provisoires révisables ; le retour possible par l'historique git) : `TUNE_SKYFLAT_DIM` (l'ancien repli bleuté du sol au
  crépuscule), `TUNE_SHIP_SCENERY_SHADOW` (l'appareil sans l'ombre du décor), `treeShadowCut` (les proxies entiers dans la carte d'ombre des
  arbres) — trace.wgsl, renderer.ts, scenery-raster.ts ; la phase J0 `twilightdim` retirée, `craftshade` réduite à l'A/A, `perf-ab SET=j3` à
  l'A/A ; PLAN-J3 (ajout au tableau de J3-R), BH-API, GRAPHICS-PIPELINE. Vérifié : tsc, biome, `check-wgsl` 84/84, budgets des noyaux.
  Restent : les leviers de mesure (§5 et J4) ; le repli tracé de la Terre (gardé, réglage 3) ; `ship.skyBand4` et `ship.nightFloor` (éteints,
  options sans autre usage — à retirer à la confirmation de Sam, PLAN-J3).
- **J5-R terminé** (2026-11-15 06:30 UTC) : `ship.skyBand4` (son noyau `envSH4`, la bande 4 de `sh[13..21]`) et `ship.nightFloor` retirés —
  ship.wgsl, ship.ts —, leurs phases J0 `skyband4` et `nightfloor` aussi ; BH-API, GRAPHICS-PIPELINE (D2, annexe régénérée), E2E-CATALOGUE.
  Vérifié : tsc, biome, `check-wgsl` 84/84. Il ne reste aucun ancien chemin de levier allumé depuis J3 ; restent les leviers de mesure et le
  repli tracé de la Terre (gardé, réglage 3).
- **J5-5 (lot neuf) : l'eau à demi-rythme — allumée** (2026-11-15 07:26 UTC) : la répartition de J0 refaite (kerr-mini, une ablation chacune,
  référence 55,9) : eau −10,3, nuages −6,0, appareil −3,9, décor −2,4, écrans −1,25, bloom −1,15, mer déplacée −0,95, accentuation −0,95,
  brume de chaleur −0,85, ombre de l'appareil −0,75 ms. **Plafond lu** (règle 1) : une tuile d'eau sur deux sautée entière, J0 **−8,4 ms**
  (`earth water` 11,7 → 5,9, sa finition 4,5 → 2,3) ; un pixel sur deux en damier dans la même vague : rien (11,9 ms) ; la moitié des fils
  d'un groupe de 64 sortis : rien (11,4) — le coût suit les groupes lancés. **Fait** : `WATER_HALF` — des groupes de 32 fils par tuile
  (`WATER_WG_Y` 4), un pixel du damier chacun (tourné chaque image), son résultat écrit aussi au pixel voisin de sa paire (moments, `liteOut`,
  l'enregistrement des reflets) ; le voisin ombré quand celui du damier n'est pas de l'eau (sinon des points blancs le long des côtes, vus et
  corrigés). Une première voie (le voisin marqué `RASTER_STALE`, rebâti par `resolve`) cassait l'image (bruit cyan : la reconstruction ne
  trouvait pas l'eau fraîche — non élucidé) : abandonnée. **Mesuré** (kerr-mini) : J0 **−6,0 à −6,4 ms** (50,0 / 51,0 et 53,7 / 54,0 contre
  56,7–60,2 selon le passage) ; à 30 m sur la mer **−6,6 / −7,2** ; les captures au même instant du vol : la mer, les îles, la côte
  identiques. **Allumé par défaut** (réglage provisoire, révisable par Sam : `renderer.waterHalfRate`), l'ancien chemin gardé pour l'A/B
  (`renderer.tune = { WATER_HALF: 0, WATER_WG_Y: 8 }`, ablation J0 `waterFull`) jusqu'au prochain lot de retrait. Non vérifié : le reflet du
  Soleil intense (scintillement possible au demi-rythme), la houle proche ; la finition de l'eau reste pleine (4,2 ms : son demi-rythme, le
  lot suivant possible, ~2 ms).
- **J5-5b, la finition de l'eau au demi-rythme** (2026-11-15 07:41 UTC) : `shadeWaterFinish` compilé avec `WATER_HALF` comme les noyaux de
  l'eau (groupes de 32 fils, le pixel du damier fini et recopié — accum, moments, stamps — au voisin de sa paire). Mesuré (kerr-mini, A/B deux
  fois) : J0 **48,1 / 48,0 / 48,2 ms contre 55,9 / 55,2** sans le demi-rythme (`waterFull`) — **−7,4 ms en tout** (la finition ~2 de plus) ;
  captures au même instant : la mer, les îles, la côte identiques. **J0 sur le mini : ~48 ms** pour une cible de 40.
- **J5-6, son plafond lu ; le M1 Max avec l'eau à demi-rythme** (2026-11-15 07:58 UTC) : une tuile sur deux du matériau du sol sautée entière
  (levier de mesure `TUNE_LITE_HALF_TILES`, ablation J0 `liteHalfTiles`, l'image cassée) : J0 41,4 / 41,4 contre 49,0 / 48,1 / 48,0 — mais
  l'eau, non marquée sur ces tuiles, y fond aussi ; **le plafond propre du sol ≈ 2,3 ms** (`earth lite` 3,8 → 2,0, sa lumière 1,3 → 0,8).
  Lot ouvrable (au-dessus de 1 ms), mais lourd : le noyau le plus chargé du sol, chaque voisin à classer, le détail des photos à garder en
  mouvement — non ouvert dans cette session. **M1 Max** (J0 borné à 30, l'eau à demi-rythme) : vol 30 images/s, GPU p50 **19,1 ms** (21,3
  avant), soutenu 30 images/s, 23,1 ms (horloge 1 286 → 1 076 MHz).
- **J5-6 essayé et retiré** (2026-11-15 08:12 UTC) : `LITE_HALF` — des groupes de 32 fils, chaque fil le pixel du damier puis son voisin (une
  boucle, un seul site d'appel : la première version en avait deux et doublait le noyau inliné, budgets cassés, corrigée avant la mesure),
  le voisin classé en entier, son matériau repris du premier quand les deux sont le sol nu à la même profondeur. **Mesuré** (kerr-mini, A/B
  deux fois) : J0 **49,3 / 49,5 contre 48,5–48,6 ms (+0,9)**, la forêt des Maures **55,9 / 55,1 contre 53,4 / 52,2 (+2,7)** ; `earth lite`
  3,75 → 4,5 et 6,4 → 9,4 ms. **Leçon** : le coût du matériau du sol n'est pas `liteMaterial` (la photo), mais la classification et le rayon
  de chaque pixel — le voisin les refait ; le plafond lu (−2,3 ms) supposait le voisin non traité, ce que seule une reconstruction (celle
  qui a échoué pour l'eau : le voisin `RASTER_STALE` rebâti par `resolve`) donnerait. **Retiré** (patch hors du dépôt) ; à reprendre avec
  cette reconstruction élucidée.
- **La reconstruction de l'eau laissée (`RASTER_STALE`) : non élucidée** (2026-11-15 08:23 UTC) : une sonde (`readMoments`, une copie des
  `moments`/`stamps` prise après les passes de l'eau ; un levier `WATER_PAIR_STALE`) — trois passages sur kerr-mini, dont deux à tort (le
  monde figé converge sur le noyau tracé de qualité, pas le raster ; la lecture de fin d'image voit les marques réécrites). En vol, la copie
  montre la mer « fraîche » (`RASTER_MARK`, estampilles en retard de 2–3 images) et **aucun pixel laissé**, même le levier allumé — la copie
  ou la variante recompilée n'est pas celle que je crois. Arrêté là (outillage retiré, patch hors du dépôt) : la voie de J5-6 qui donnerait
  ~2,3 ms reste fermée tant que cette reconstruction n'est pas comprise.
- **Décisions de Sam ; J5-R2** (2026-11-15 08:34 UTC) : aucun arbitrage d'image ; l'eau à demi-rythme confirmée — `WATER_HALF` et `WATER_WG_Y`
  deviennent des constantes, `renderer.waterHalfRate`, l'option `waterHalf` de `tracerConstants` et l'ablation J0 `waterFull` retirés (règle
  2). Vérifié : tsc, biome, `check-wgsl` 84/84, tests des noyaux. **J0 sur le mini ~48 ms : la cible de 40 attend une autre voie que l'image
  (la reconstruction des pixels laissés, à élucider — J5-6) ou une nouvelle décision.**
- **La sonde de la reconstruction, son témoin positif : échoué** (2026-11-15 08:47 UTC) : la finition de l'eau marquant ses pixels d'une
  estampille impossible (777777, `TUNE_WATER_STAMP`), la copie des `moments`/`stamps` prise juste après elle n'en montre **aucune** — la mer y
  est « fraîche » (`RASTER_MARK` 1e30, l'estampille de l'image), finie comme un sol (`water` faux). La copie ne voit pas ce qu'écrit
  `shadeWaterFinish` (autre cible, autre moment, ou ces pixels finis par `shadeLiteFinish`) : **aucun chiffre de cette sonde ne vaut** (règle 3),
  ni ceux de 08:23. Retirée (patch hors du dépôt). Reprendre demande de comprendre d'abord par quel chemin la mer de J0 est finie — un
  outillage de débogage du GPU (lire un pixel à chaque passe) plutôt qu'une copie.
- **Comment la mer de J0 est marquée au moment du `resolve`** (2026-11-15 08:58 UTC) : sonde `sea-marks` (E2E_PROBE ; `renderer.traceColumn`, le
  diagnostic de HORIZON-FLICKER, copié juste après le `resolve`), une colonne de l'horizon au cockpit, trois images — **témoin passé** (les
  lignes du cockpit lisent −1). **Constat** : la mer porte `RASTER_MARK` × 1 (1e30, « fini comme un sol »), pas × 4 (4e30, « fini comme de
  l'eau » — `rasterMark(…, water)`), à l'estampille de l'image. Le chemin que je supposais (l'eau marquée `RASTER_WATER` par `shadeLite`,
  ombrée par `shadeWater`, finie en eau par `shadeWaterFinish`) n'est pas celui que la mer de J0 suit à 500 m — ou la couverture d'eau y
  vaut ≤ 0,5. C'est le point de départ de la suite : suivre une ligne de mer de J0 à travers `shadeLite` (son `liteWater`, la condition
  « early » `P.sea[1].w ≥ 0,999`), `liteEpilogue` et les noyaux de l'eau, avant de rouvrir la reconstruction et J5-6.
- **Correction : mes sondes regardaient la piste du Bourget** (2026-11-15 09:27 UTC) : `stale-probe`, `sea-marks` et `export-parity`
  appliquaient `J0_FIXED` (changement d'appareil asynchrone) puis plaçaient l'avion aussitôt — le changement le remettait sur la piste du
  Bourget (E2E-VOLS §7, « appareil changé ou placé dans le mauvais ordre ») : **aucune mer à l'écran**. Les constats de 08:23, 08:47 et
  08:58 (la mer « finie comme un sol », le témoin 777777 absent) ne valent donc rien sur la mer ; la mesure d'`export-parity` vaut pour
  la piste (sa conclusion — la taille de l'export — reste juste). `sea-marks` corrigé (attendre `fleet.active === "f35"`, placer, attendre,
  replacer) : **la mer de J0 est bien finie en eau (`RASTER_MARK` × 4, 4e30) au moment du `resolve`** — le modèle était juste. Reprise du
  voisin laissé à la reconstruction (levier `TUNE_WATER_PAIR_STALE`) : l'image se couvre de **points blancs** (le défaut se reproduit),
  mais l'avion, sans manette ni monde figé, était descendu à 0 m pendant l'attente — la mesure n'est pas concluante. Levier retiré (patch
  hors du dépôt) ; la suite demande une scène tenue (le monde figé hors de la convergence tracée, ou l'avion en palier) avant de chercher
  la cause.
- **La reconstruction des pixels laissés : le défaut est après le `resolve`** (2026-11-15 09:43 UTC) : dans le vol J0 tenu (ablation de mesure,
  le voisin de chaque pixel d'eau marqué `RASTER_STALE` au lieu d'être écrit — levier `TUNE_WATER_PAIR_STALE`), `traceColumn` au `resolve` :
  une colonne à −3 (laissée), la voisine à 4e30 (fraîche, son estampille de l'image) — **les marques sont justes**. L'image : le même bruit
  cyan qu'au premier essai (le défaut se reproduit dans une scène tenue). **Peint par le `resolve` lui-même** (bit de mesure de `R.f.w` :
  vert un pixel laissé rebâti de pixels frais, magenta aucun) : **toute la mer verte** — le `resolve` rebâtit chaque pixel laissé. Le cyan
  naît donc **après** lui : le temporel ou le TAAU (dont l'entrée est `t.hdr`). Prochaine étape : la même peinture dans le temporel, puis
  le TAAU. Leviers et peinture retirés (patch hors du dépôt).
- **La reconstruction : ce n'est pas le temporel** (2026-11-15 09:53 UTC) : la même scène J0 tenue, le pixel laissé prenant dans le temporel
  la couleur reconstruite seule, sans historique (bit de mesure de `R.f.w`) : **toujours le bruit cyan** — la couleur que le `resolve`
  rebâtit est elle-même fausse, alors que sa peinture montrait des voisins frais trouvés partout. Or `liteFinish` écrit la couleur finale
  dans l'`accum` de l'eau fraîche (et la mer est juste en mode normal). **Question ouverte, précise** : que lit `loadAvg` des voisins frais au
  moment du `resolve` — lire leurs `accum` (r, g, b, a) par `traceColumn` (qui les copie déjà), à côté d'un pixel laissé. Outillage retiré
  (patchs hors du dépôt : `stale-resolve-debug.patch`, `stale-temporal-debug.patch`).
- **La reconstruction des pixels laissés : élucidée — c'est le miroir de la mer** (2026-11-15 10:19 UTC) : `traceColumn` étendu (chaque ligne,
  ses 32 pixels : `moments.x`, l'`accum` et son poids, l'estampille, la sortie du `resolve`) ; la fenêtre ±2 px du `resolve` relevée autour
  d'un pixel laissé dans le vol J0 tenu (levier de mesure `TUNE_WATER_PAIR_STALE`, kerr-mini, trois passages). **Constat** : un pixel d'eau
  laissé (−3) garde dans `accum` la valeur sous-marine que `shadeLite` vient d'écrire (le fond, poids 2 ; luminance 0,003–0,2 contre 8e-6 pour
  l'eau), **pas sa couleur de l'image d'avant** ; or `seaSSR` (le miroir de la mer, dans `shadeWaterFinish`) accepte un pixel `RASTER_STALE`
  comme reflet — prévu pour le sol laissé, qui garde sa couleur — : des pixels d'eau **frais** (4e30) reflètent ces valeurs (des points
  ×100–×1 000, épars), et la reconstruction les étale autour d'eux — le bruit cyan ; l'exposition automatique baisse alors ×6 (la mer brille).
  **Témoin** : le miroir n'acceptant plus ces pixels sous le levier, la fenêtre est propre — le pixel laissé rebâti vaut ses voisins frais
  (0,0124 contre 0,0124 ; 0,00673 contre 0,00672), l'exposition celle de la base, la capture la même que la base. **La reconstruction du
  `resolve` est juste** ; reste une image sur quatre où le `resolve` n'a pas pris sa voie (le rythme forcé du levier, lu par la clé du
  tune, faux à cette image : un défaut du levier, pas de la reconstruction). GPU : 51,7 contre 51,3 ms (le levier ne retire rien : la copie
  vers le voisin ne coûtait rien). **Conséquences pour J5-6** : (1) un pixel du sol laissé par `shadeLite` garde sa couleur — rien n'y écrit
  — ; (2) un pixel d'**eau** laissé non : il ne doit être ni lu par `seaSSR`, ni repris par son propre `accum` ; (3) le rythme vu par `post.wgsl`
  (`R.f.y`) doit être celui de l'image. Levier et sonde retirés (patch hors du dépôt : `stale-reconstruction-probe.patch`) ; l'extension de
  `traceColumn` gardée (BH-API).
- **J5-6 refait par la reconstruction ; à Sam** (2026-11-15 10:32 UTC) : le matériau de la Terre suit la cadence du raster comme `bodyLite`
  et `shade` — un fil par pixel du motif, serrés (`rasterPixel`), `shadeLite`, `shadeLiteLight` et `shadeLiteFinish` lancés sur la largeur
  divisée ; `shadeMark` marque aussi les pixels du matériau laissés (`RASTER_STALE`, leur couleur gardée : rien n'y écrit) et passe seul quand
  `liteAll` ; l'eau à demi-rythme, dont le damier est le motif de la cadence 2, n'a plus de voisin à écrire (il est laissé, rebâti). **Gain
  maximal lu** : ~2,3 ms sur J0 (la tuile sur deux), plus sur la terre. **Mesuré** (kerr-mini, ablation J0 `liteHalf` =
  `earthRasterShading` « demi », A/B ×2) : **J0 47,9 / 47,5 contre 51,1 / 49,4 ms** ; **les Maures (`J0_START=43.22,6.33,300,90,140`)
  47,7 / 47,3 contre 54,0 / 53,0** ; 0 erreur GPU. **Image** : la mer et les îles de J0 les mêmes ; la forêt en vol, la netteté (gradient
  moyen sur trois zones) dans l'écart A/A (base contre base au même instant : 11,85–13,04 ; demi 12,05–12,74), mais à l'œil les houppiers un
  peu « peignés » horizontalement (la reconstruction 2 × 1 ; le détail d'albédo — RASTER_DETAIL — coupé sous le TAAU). **Non allumé** :
  « auto » garde le matériau à chaque pixel sur la Terre ; le réglage « demi » (et plus grossier) l'applique désormais aussi au matériau —
  l'arbitrage (−2,5 à −6 ms contre ce léger peigné en mouvement) est à Sam, qui a refusé les compromis d'image le 15 nov. Vérifié :
  `check-wgsl` 84/84, budgets des noyaux, tests des noyaux, tsc, inventaire.
- **Décision de Sam : « améliorer d'abord » ; deux essais, aucun ne garde le gain sans l'image** (2026-11-15 10:53 UTC) : Sam (vers 10:35) veut
  la texture nette entre les pixels rebâtis avant d'allumer. Le détail d'albédo (`RASTER_DETAIL`) ne couvre pas les houppiers
  (`rasterAlbedo` vaut 0 sur un arbre) : ce n'est pas le levier. **(1) Le pixel laissé pesé comme un pixel rebâti dans le temporel**
  (`TA.k.w`, et non 1 : son estampille, d'une image, est dans la fenêtre — `validFrom` remonte en vol) : coût nul (47,5 / 47,0 contre
  47,3 / 47,4 ms), mais les houppiers **traînent** dans le sens du mouvement (l'historique pèse plus) au lieu du peigné — pas mieux. La
  mesure de netteté (gradients horizontal / vertical sur trois zones) **échoue à son A/A** (la même configuration varie autant que l'effet :
  7,27 / 7,75 ; 7,61 / 7,13) : aucun de ses chiffres ne compte, jugement à l'œil sur recadrages au même instant. **(2) Les arbres à chaque
  pixel** (une seconde tranche du lancement, `z` 1 : le complément du motif, ses arbres seuls ; `shadeMark` les laisse frais) : les Maures
  **55,9 / 55,6 contre 54,6 / 53,7 ms (+1,3 à +1,9 — plus lent que la base)**, J0 49,4 / 48,5 contre 51,9 / 49,6 (−2,5 / −1,1). Les deux
  retirés (patchs hors du dépôt : `j5-6-stale-weight-trial.patch`, `j5-6-trees-every-pixel-trial.patch`). **Constat** : le gain du demi-rythme
  vient surtout des arbres, et c'est eux que la reconstruction adoucit en mouvement ; « demi » reste au choix du joueur, « auto » à chaque
  pixel. **À Sam** : accepter ce léger adoucissement des houppiers en mouvement pour −2 à −6 ms, ou laisser J5-6 au réglage du joueur.
- **Décision de Sam : J5-6 laissé au joueur** (2026-11-15 14:16 UTC) : « auto » garde le matériau de la Terre à chaque pixel (aucun
  compromis d'image) ; le réglage « demi » (et plus grossier) l'applique pour qui le choisit (db50c54e). J5-6 fermé ; la cible des 40 ms
  du mini attend une autre voie.
