# Plan RENDU-PERF — le rendu, beau et rapide (16 octobre 2026)

Branche `perf-render`. Suivi global : [`AAA-PROGRESS.md`](AAA-PROGRESS.md). Mesures : kerr-mini (Mac mini M1, écran
1920×1080 à 50 Hz), jamais sur la machine de développement.

## La demande (16/10/2026)

« Ne pas tracer sous le cockpit. Mets-toi en mode diagnostic de performances, travaille sur une branche où tu peux
tester, améliorer. Le rendu dans ce projet, c'est vraiment le goulot (trou noir, planète). Je veux que ce soit hyper
beau, qualité AAA et performant. Analyse et trouve des solutions. »

## Les outils de diagnostic

- **`tests/e2e/perf-suite.e2e.test.ts`** — des scènes figées (la manière de `scripts/trace-ab.ts`, dans un seul
  build) : la vue « touchée » à chaque image (la passe temps réel, les mêmes rayons), chaque image profilée — la trace,
  les sondes, la LUT du champ lointain, la reconstruction, chaque passe — ; reproductible au dixième de ms d'un passage
  à l'autre. `SCENES=interstellar,kerr,…` (alias), `SUB=4`, `AB=<nom>` (A, B, A, B : un interrupteur, un réglage),
  `COST=1,3,…` (les vues coût), `E2E_SHOTS` (les images, `perf.json`).
- **La vue coût** — `renderer.costView` : le travail de chaque rayon en carte de chaleur, brute (sans exposition ni tone
  map) ; 1 le total, 2 … 13 une sorte (marche du sol, hauteurs lues, ombres du relief, nuages, air, eau, décor,
  intégrateur, bruit, étoiles, corps, boucle principale). Hors du noyau quand elle est éteinte (mesuré : 0).
- **Les réglages de débogage** — `renderer.tune = { TUNE_AIR_N: 8, … }` : des constantes du noyau (une variante à
  part) pour mesurer ce que coûte une boucle sans toucher au code.
- **`tests/e2e/flight-quality.e2e.test.ts`** — la qualité de l'image temps réel en vol : PSNR contre l'image
  convergée de la même vue (la méthode de `scripts/quality.ts`).
- **Les pièges de mesure** : l'écran à 50 Hz arrondit l'intervalle des images à 20 / 40 / 60 ms ; les horodatages des
  passes de rendu (raster) se chevauchent sur Apple — seules les passes de calcul se lisent seules.

## La référence (×4, 1600×1000, avant le masque du cockpit)

| Scène | trace | sondes | reconstruction | image |
|---|---|---|---|---|
| Kerr a=0,94 par la tranche | 12,7 | 0 | 3,8 | 21 ms |
| Disque volumétrique + jet | 32,6 | 0 | 3,8 | 41 ms |
| Interstellar (le passage du film) | 43,3 | 0 | 3,8 | 59 ms |
| La Lune, après-midi en plaine | 64,6 | 5,9 | 3,7 | 81 ms |
| Yosemite | 98,9 | 0 | 3,6 | 114 ms |
| Miller : Gargantua sur la mer | 122,3 | 12,8 | 3,8 | 144 ms |
| Saturne à contre-jour | 137,9 | 11,1 | 3,9 | 156 ms |
| Vol, les Alpes, cockpit | 27,2 | 6,1 | 4,0 | 41 ms |
| Vol, Tarifa, cockpit | 43,9 | 5,8 | 3,8 | 60 ms |

La trace est presque tout le temps de l'image ; la reconstruction et le post-traitement ≈ 4 ms. C'est le prix d'un
rayon et le nombre de rayons qui font la vitesse.

## Fait

1. **Ne pas tracer sous le cockpit** (`shaders/mask.wgsl`, `ship.ts` ownMask, `renderer.cockpitMask`) : les parties
   opaques de l'appareil piloté dessinées seules après le raster ; avant la trace suivante, les tuiles 16×16 qu'elles
   couvraient (une marge de deux blocs) marquées ; le noyau n'y trace pas, le photomètre les ignore. Seulement en
   cockpit, la tête et l'objectif immobiles. Trace : Alpes 27,2 → 19,2 ms, Tarifa 43,9 → 32,4 ms ; depuis la cabine du
   Ranger devant Gargantua 52 → 18 ms (Interstellar), 30 → 9 ms (Kerr). Images identiques.

2. **L'historique temporel gardé en vol** (`renderer.taParallaxPx` 0,5 → 64 px) : il était jeté dès que le sol bougeait
   d'un demi-pixel — en vol bas, à chaque image ; le shader reprojette déjà par la profondeur. PSNR contre l'image
   convergée (`flight-quality`) : Alpes 31,6 → 33,0 dB, Tarifa 40,3 → 44,4 dB, en virage serré 29,8 → 30,3, en
   rase-mottes 37,0 → 37,2 — ×4 avec historique vaut ×3 sans ; plus d'escaliers ni de nuages en blocs ; en virage
   serré, un peu de flou du premier plan au lieu des blocs.
3. **La table de perspective aérienne** (`trace.wgsl` aerial/apRead, `system/aerial.ts`, `renderer.aerialTable`) : 96 × 54
   directions × 32 tranches exponentielles jusqu'au-delà de l'air, chaque colonne intégrée une fois (earthAir par
   tranche, 3 échantillons, composé ; arrêtée au sol) ; les rayons de la caméra près d'un monde avec air la lisent au
   sol, au nuage, à la fin de l'air au lieu de leurs 32 échantillons. Sa passe < 0,3 ms. Trace : Tarifa −21,5 %
   (36,2 → 28,4 ms, l'image 59 → 43 ms), Alpes −15 %, Yosemite −6 à −12 %, Andes au couchant −6 %, Bretagne −9 % ;
   images identiques (43–47 dB entre les deux). Deux textures de plus pour le noyau : demandées si l'appareil les
   permet (21), sinon le traceur sans la table (`aerialShader`).

4. **La marche du terrain** — le plafond du relief (`system/relief-ceiling.ts`, `earthTop`) : la coquille des marches au
   plus haut que le sol autour de la caméra peut être (la carte et les tuiles, le détail en plus), pas 9 600 m — Alpes
   −7 %, Tarifa −3 % ; la marche sur-relâchée (Keinert et al. 2014 : un pas 1,6 fois le pas sûr, repris quand les deux
   portées sûres laissent un trou) — Andes −10,5 %, Yosemite −10,5 %, Tarifa −6 %. Images identiques.
   Cumul en cockpit à Tarifa depuis le début : trace 43,9 → 25,7 ms (−41 %), l'image 60 → 41 ms.

5. **Saturne : les pas du trou de ver fusionnés pour `ourSegment`** — près de la bouche (celle de Saturne), chaque rayon
   est intégré dans sa métrique, et chaque pas de notre côté regardait tous nos corps (leurs anneaux, leur air, la
   couronne et le disque du Soleil) le long de sa corde : une quarantaine de fois par rayon. Ses cordes sont réunies
   en morceaux droits tant que le chemin tient droit à un quart de pixel près — un regard par morceau
   (`TUNE_MERGE`). Trace 126,7 → 54,8 ms (−57 %), l'image 142 → 71 ms, identique (52 dB). Trouvé par élimination
   (`TUNE_SKIP`) : le ciel −99 %, `ourSegment` −80 %, le fond 0 %.

6. **Le ciel du trou noir** — la tolérance des géodésiques trois fois plus large loin du trou (`TUNE_EPS_FAR` : × 1
   jusqu'à 10 M — la sphère de photons, l'anneau, l'ombre exacts —, × 3 au-delà de 20 M) : Kerr par la tranche
   −21 %, les images au niveau du bruit d'une comparaison (`AB=noop` : deux captures du même, 0,82 d'écart moyen ;
   × 3 contre × 1 : 0,73, les mêmes cartes de différences). La fumée du disque pas à pas de 0,5 M en temps réel
   (`TUNE_SMOKE_STEP`, 0,25 avant ; les passes d'affinage gardent 0,1) : Interstellar −22 % ; l'image à l'arrêt
   la même, en mouvement 29,4 dB contre 29,7 face à l'image convergée (`motion-quality`, choix du 16/10).

7. **La déformation des crêtes lue dans des grilles** (P1, 17/10 ; `system/warp-grid.ts`, `trace.wgsl` earthWarp) — le
   relief des montagnes est un multifractal sur un réseau déformé par un champ lisse : six bruits de gradient à chaque
   hauteur lue. Ce champ est calculé sur des nœuds fixes sur la Terre (longitude et latitude en pas entiers : la
   valeur en un point ne dépend jamais de la place de la grille, rien ne saute quand elle suit la caméra), à trois
   niveaux autour de la caméra (19, 76, 306 m ; ±4,9, ±20, ±78 km), lu en bilinéaire, chaque niveau fondu dans le
   suivant vers son bord, calculé au-delà et près des pôles. Les crêtes déplacées de 3 cm au plus près, 0,4 m à 20 km,
   6 m à 78 km (`tests/warp-grid.test.ts`) ; un niveau recalculé (une passe de calcul) quand la caméra s'est éloignée
   de 64 nœuds de son centre ; les bruits de la passe sont pris dans le source du traceur, pas recopiés. La physique
   garde le champ exact (`terrain.ts`). Trace : Andes −32 % (96,0 → 65,5 ms), Yosemite −26 % (98,7 → 73,3 ms),
   Tarifa −11 %, Alpes neutre ; images au niveau du bruit d'une comparaison (40–46 dB ; les Alpes 45,2 dB, leur
   plancher `noop` 45,7).

8. **Les corps de Gargantua et les nôtres, moins souvent regardés** (P2, 17/10) — les comptes donnaient Miller ≈ 180
   corps testés par rayon (p99 1 272), Saturne 270 ; les bornes (le banc corrigé) : à Miller les tests de chaque pas
   −15 %, à Saturne la boucle des corps rencontrés d'`ourSegment` −39 % — mais cette borne retirait aussi toute
   rencontre, donc l'ombrage de Saturne elle-même, qui couvre l'image : du vrai travail. Fait, exact (images au
   niveau du bruit : Saturne 53,6 dB ; Miller 35,5 dB pour un plancher `noop` de 32,7) :
   - **la liste de la bouche** (`Params.mouthList`) : les rayons de la région de la bouche — ses morceaux intégrés
     là, le rayon qui en sort — regardaient tous nos corps (27 près de Saturne), à chaque morceau ; ils lisent
     maintenant ceux assez grands vus du bord de la région (un rayon parti de là a parcouru au moins jusqu'au bord :
     le test d'`ourSegment` n'en laisse passer aucun autre), ceux de la région, les anneaux, les étoiles (9 près de
     Saturne). Saturne −5 %.
   - **le rejet tôt** (`TUNE_BODY_REJECT`) : un corps de Gargantua plus loin du début du pas que le pas, sa portée et
     ce que son orbite le déplace pendant le pas n'a pas sa place en fin de pas calculée. Miller −2 à −3 %.
   Comparé révision à révision (avant P1, P1, P2) : Interstellar, Kerr et le disque volumétrique inchangés (33,5,
   10,2, 32,9 ms) ; Miller 119,3 → 115,9 ms. Le reste de Miller est du vrai travail : le disque épais traversé par
   les rayons du ciel, les sondes (11 ms), la mer.

9. **La netteté en mouvement** (P3, 17/10) — mesurée, rien d'adopté. `flight-quality` (PSNR de l'image temps réel
   contre la convergée, et la netteté : l'énergie des gradients de l'une sur l'autre) en virage dans les Alpes, en
   rase-mottes et en croisière à Tarifa, réglages alternés (A, B, A, B) : la largeur du rognage de l'historique
   (1,5, 2, 3 σ), le poids d'un pixel entre rayons (0,02, 0,05, 0,1), le poids plafond de l'historique (1/16, 1/32),
   l'affûtage — tous dans l'écart entre deux passages d'un même réglage (±1 dB). Ce qui se voit en virage serré : la
   crête contre le ciel en escaliers de blocs de 4 px et le sol adouci, quand l'historique cède à la reconstruction
   d'un rayon pour 16 pixels. Essayé : un pixel entre rayons au bord (ses voisins frais proches et lointains) lisant
   les deux historiques — celui que trouve la profondeur du plus proche, celui du plus lointain — et gardant le plus
   proche de l'image : rien, ni sur l'image (±0,1 dB au second passage) ni sur ses seuls contours (le 5 % de plus fort
   gradient) — retiré. Le défaut est la reconstruction elle-même : plus de rayons en virage (`dynamicResolution`, ou
   ×3 — « ×4 avec historique vaut ×3 sans »), ou une reconstruction guidée. Le test corrigé : les captures d'un
   réglage repris numérotées ; le virage demandé depuis la route suivie (le cap demandé s'ajoutait d'un test au
   suivant : 70° de plus à chaque fois — la meilleure image toujours la première d'un lieu).

10. **L'ombrage du sol décomposé** (17/10 ; `TUNE_GSKIP`, une partie retirée, une mesure) — Alpes et Tarifa en cockpit
   (les Andes de ce lot mesurées avant que la scène ne soit chargée) :

   | Retiré | Alpes | Tarifa | Andes |
   |---|---|---|---|
   | les ombres du relief | −12,5 % | −11,1 % | −10,0 % |
   | la normale fine du relief (trois hauteurs entières) | −10,1 % | −4,8 % | −2,8 % |
   | les matériaux proches, le bruit fin, les ombres des nuages, l'imagerie des tuiles, les textures de surface, la mer, les surfaces OSM | ≤ 2–3 % chacun | | |

   Fait : **les ombres du relief pas à pas sur leur hauteur libre** (`TUNE_SHADOW_RELAX` 0,3) — un rayon haut au-dessus
   du sol (un versant au soleil, un soleil haut) avance d'une part de sa hauteur libre, pas des petits pas de la
   croissance (de 20 m, ×1,18 : ~35 pas d'un fond de vallée jusqu'au plafond du relief) ; la part de la hauteur libre
   seule — avec la marge de la distance, des pas passaient sous les crêtes : une rivière au soleil couchant ombrée.
   Alpes −4 %, Tarifa −3 %, Andes 0 ; images identiques (46–53 dB). Reste : la normale fine — ses trois hauteurs à
   10 m l'une de l'autre ne partagent pas la déformation (≈ 14 m de décalage), les tuiles n'y pèsent rien (le
   bilinéaire : 0–3 %) ; c'est le bruit du détail, trois fois — un bruit à dérivées analytiques essayé (11.) : rien.

11. **La normale du relief par un bruit à dérivées analytiques** (17/10) — mesurée, retirée. Le bruit et son gradient
   en une évaluation (gnoiseD : les gradients des coins et la dérivée du fondu quintique), les fBm et le multifractal
   dérivés, la déformation et sa jacobienne lue dans les grilles ; la normale : la base (tuiles, pistes) aux trois
   points, le détail une fois au centre, prolongé aux deux autres par son gradient. Vérifié sur le GPU contre les
   différences de son jumeau CPU en float64 (400 points de montagne : la hauteur exacte, 398 pentes concordantes — les
   deux autres sur l'arête d'une crête fine, où `1 − |n|` change de signe). Mais rien de gagné : deux paires A/B,
   Andes 61,0 contre 61,1 ms, Yosemite 69,2 contre 69,3, Alpes 20,3 contre 20,2 (un premier −15 % aux Andes était
   leur première mesure, prise avant que la scène ne soit chargée : 11,4 ms). Un bruit à dérivées coûte environ deux
   bruits ; la normale garde ses trois lectures de tuiles : une à deux évaluations du détail épargnées sur trois, 1 à
   3 % du total, dans le bruit — le noyau, limité par ses registres, n'y gagne pas la place. Retiré (le code est dans
   l'historique de la session, non commité).

12. **La reconstruction en virage** (17/10) — mesurée, rien d'adopté ; ce qu'on sait maintenant. `flight-quality`
   (virage des Alpes, rase-mottes et croisière à Tarifa) et `motion-quality` (une rotation pure devant Interstellar et
   Kerr), réglages alternés :
   - **sans historique** (`nota`), l'image en virage vaut celle avec (36,4 contre 35,8 dB à Tarifa en rase-mottes) :
     elle est la reconstruction d'un rayon pour 16 pixels ; en rotation pure au contraire l'historique fait tout
     (Interstellar 29,0 dB, 18,4 sans).
   - **la reconstruction** : un Catmull–Rom sur la grille des rayons de l'image (borné au 2 × 2 voisin) au lieu de la
     gaussienne normalisée — rien (±0,5 dB, avec ou sans historique) : avec un rayon pour 16 pixels l'information
     manque, la manière d'interpoler ne la rend pas. Retiré.
   - **le rognage de l'historique presque coupé** (100 σ) : en rotation pure, mieux (Interstellar 30,3 dB et une
     netteté de 1,07 contre 29,0 et 0,95) — la reprojection y est exacte, le rognage ôte du détail ; en vol droit
     au-dessus des Alpes, pareil (32,8 contre 32,7) ; en virage, pire (29,5 contre 30,7) ; à Tarifa, bien pire (28,7
     contre 39,6 : les nuages et la mer bougent — des fantômes).
   - **la profondeur entre les rayons** bilinéaire sur la grille (au lieu de la plus proche) pour la parallaxe du sol :
     rien. **Le rognage mesuré sur les rayons** de la grille (3 × 3) au lieu de l'image reconstruite : un peu moins bon
     (Interstellar 27,2 contre 29,3, le virage des Alpes 30,0 contre 30,6). Retirés.
   - La secousse du vol (la charge en virage) n'est qu'un décalage de l'affichage : rien pour la reprojection.
   Bilan : la TAA est à un optimum local ; ce qui reste en virage tient à l'information (un rayon pour 16 pixels) et à
   un recalage du sol qui se dégrade en virage seulement (cause non trouvée : ni la profondeur, ni la secousse, ni la
   rotation pure). Les leviers restants coûtent des rayons : un bloc ×3 quand la caméra tourne vite (« ×4 avec
   historique vaut ×3 sans »), `dynamicResolution`. Les réglages-bornes gardés dans les tests : `g100`, `g100n64`,
   `nota` (vol), `g100`, `nota` (rotation pure).

13. **Des rayons plus denses quand l'image glisse vite** (17/10 ; le réglage « Netteté en mouvement »,
   `settings.motionDetail` : Non, En virage — par défaut —, En virage et en vol bas ; renderer motionBlock) — fait. Le
   bloc des rayons passe à un cran plus fin — ×4 → ×3, ×6 → ×4, ×8 → ×6 — quand la ligne de visée tourne plus vite que
   25 px/s pendant 200 ms (`imageTurnPx` : sur les 8 dernières images, la secousse du vol, un tremblement de moyenne
   nulle, s'y annule ; en pixels par seconde — en pixels par image, les images ralenties par les rayons plus denses
   tournaient de plus de pixels chacune : la densité s'entretenait) ; avec le vol bas, aussi quand le sol vu glisse
   plus vite que 12 px/s (`imageGroundPx` : la moyenne sur quinze directions de la vue — celles sous l'horizon chacune
   jusqu'au sol, sa hauteur au-dessus de lui, plat, 40 km au plus ; le déplacement de la caméra en travers sur la
   distance ; le ciel, rien). Retour sous 18 et 9 px/s après 300 ms. Pas sur la parallaxe du sol le plus proche : sous
   l'avion, hors du champ, elle mettait tout vol au-dessus du seuil (une croisière densifiée pour rien, le tracé +70 à
   +110 %). Le choix automatique du bloc ne compte pas ces images. Mesuré sur kerr-mini (`flight-quality`, alterné ;
   le tracé pendant le vol, la part d'images plus fines) :

   | Vol (le sol vu, la rotation) | Non | En virage | En virage et en vol bas |
   |---|---|---|---|
   | virage des Alpes (4, 32 px/s) | 30,5 dB · 21 ms | **32,4 dB** · 35 ms (100 %) | 32,6 dB · 36 ms (100 %) |
   | Tarifa à 700 m, un virage (15–22, 21–24 px/s) | 36,0 dB · 32–40 ms | **38,8 dB** · 41 ms (40 %) | 37–38,4 dB · 46–62 ms (64–100 %) |
   | croisière à Tarifa (8, 10 px/s) | 38,7 dB · 22 ms | égal (0 %) | égal (0–14 %) |
   | Alpes en ligne droite (2, 11 px/s) | 33,0 dB · 20 ms | égal (1 %) | — |

   « En virage » prend l'essentiel ; le vol bas ajoute peu sur ces vols (Tarifa bas y vire déjà) pour un tracé ×1,5 en
   continu : il vaut pour une ligne droite à basse altitude (densifié tout le vol, Tarifa à 700 m 36,1 → 39,0 dB). Le
   coût est celui de la netteté : la cadence baisse le temps que cela dure ; « Non » le rend.

**Le banc corrigé** (17/10) : une variante réglée (`tune`) a son propre noyau de table aérienne, et le décor et la
surface demandent un noyau compilé pour sa clé ; attendre `variantReady` ne garantissait ni l'un ni l'autre — le côté
B se mesurait souvent sans table aérienne (plus lent) ou sans décor (plus rapide), de 10 à 30 % sur Terre.
`renderer.kernelsSettled` (et `aerialWanted`) : la suite de perf attend que le noyau soit réglé. Mesures reprises :
la marche sur-relâchée tient (la retirer : Andes +13 %, Tarifa +7 %, Alpes neutre). Yosemite garde un biais de
+10 ms sur toute variante réglée (non expliqué) : ses A/B par `tune` ne sont pas fiables. Les Alpes en cockpit varient
d'un passage à l'autre (20 à 34 ms : le temps réel chargé à l'heure du test).

14. **La distance de détail** (17/10 ; le réglage « Distance de détail », `settings.detailReach` : Normale — par
   défaut —, Loin, Très loin ; Ciel › La Terre) — fait. Le détail du sol plus loin, et plus loin devant là où porte le
   regard, préchargé autour du joueur :
   - **le décor** (arbres, bâtiments, routes, rivières, ponts) : sa zone ×1,5 ou ×2 (équilibré 2 → 3 ou 4 km, élevé
     3 → 4,5 ou 6 km), la portée de ses rayons autant, ses budgets à la mesure de sa surface — le tampon GPU 16 → 36 ou
     64 Mio (dans la limite du périphérique), la trame d'occupation du sol 512 → 768 ou 1 024 px (≈ 10 m le pixel
     gardé), la grille de la forêt, les surfaces, les tuiles OSM, les bâtiments et les ponts ×k² ; le tampon refait à
     la taille du budget quand la portée change (l'ancien retiré une fois le GPU passé). La collision et la mini-carte
     lisent le côté de la trame dans la scène (`f[3]`), plus 512 en dur ;
   - **le relief** (`EarthTiles.setReach`, `TILE_REACH`) : les fenêtres de 4 → 8 tuiles de côté à chaque niveau (la
     texture 1 024² → 2 048² × 8 niveaux : 64 → 256 Mio ; refaite, l'ancienne détruite après le travail soumis, les
     groupes de liaison reconstruits — `onResize`) ; le tracé masque l'adresse par la taille de la texture
     (`textureDimensions`, une puissance de deux), plus `& 1023` ;
   - **le regard** : les fenêtres du relief menées jusqu'à 6 → 12 ou 20 km vers le sol regardé (`gazeLead` ; décalage
     au plus d'une demi-fenêtre moins ¾ de tuile), la zone du décor de 0,6 de son rayon ;
   - **le préchargement** : sur les 2 (Loin) ou 3 (Très loin) niveaux les plus fins, une tuile que la fenêtre quitte
     est gardée en mémoire avec son imagerie, et, les fenêtres entières, l'anneau suivant autour d'elles est chargé
     d'avance (le plus proche du point de tête d'abord, la moitié des chargements au plus) ; une tuile gardée revient
     dans sa fenêtre à l'image même, sans réseau (LRU de 128 ou 256 tuiles, 512 Kio chacune). Les tuiles gardées ne
     sont plus bloquées par les chargements en vol (ils se limitent eux seuls).

   Mesuré sur kerr-mini (`detail-reach.e2e.test.ts`, cockpit du F-35, alterné Normale/Très loin/Loin ; Tarifa à 600 m
   et les Alpes à 2 500 m, l'avion tenu le temps du chargement puis 600 ou 1 500 images en vol) :

   | | Normale | Loin | Très loin |
   |---|---|---|---|
   | tuiles du relief à l'arrivée | 64–140 | 525–600 | 530–620 |
   | temps de chargement (relief + décor) | 3–12 s | 6–33 s | 10–28 s |
   | arbres · bâtiments · routes (Tarifa) | 210 k · 17 · 2 101 | 420 k · 79 · 5 823 | 714 k · 106 · 8 879 |
   | arbres · bâtiments · routes (Alpes) | 141 k · 1 670 · 5 417 | 245 k · 3 341 · 9 839 | 295 k · 3 372 · 12 608 |
   | tuiles gardées / chargées pendant 1 500 images à Tarifa | 0 / 18 | — | 147 / 39 |
   | images avec une fenêtre incomplète (Tarifa, 1 500 images) | 0–3 % | — | 0 % |
   | le tracé en vol (Tarifa) | 13–18 ms | 15,6 ms | 14–19 ms |
   | le tracé en vol (Alpes) | 16–23 ms | 23,5 ms | 18–24 ms |

   Le coût du tracé reste dans le bruit d'un passage à l'autre (le temps réel du jour, ±5 ms) : les rayons du décor
   s'arrêtent à la première boîte, plus loin ne coûte que là où le décor emplit la vue. Le prix est la mémoire
   (GPU 64 + 16 → 256 + 64 Mio, CPU jusqu'à 128 Mio de tuiles gardées), le réseau (4× de tuiles à l'arrivée) et la
   préparation du worker (4–9 s au lieu de 2–6). Les images : le relief fin et l'imagerie loin sur les pentes (les
   Alpes), routes et forêts sur les collines du fond (Tarifa) — `tests/e2e/detail-reach.e2e.test.ts`
   (`E2E_SHOTS`), `tests/earth-tiles.test.ts` (les fenêtres de 8, la mémoire, l'anneau).

### Où en est chaque scène (×4, 1600×1000, kerr-mini)

| Scène | trace au départ | trace maintenant |
|---|---|---|
| Kerr a=0,94 par la tranche | 12,7 | **10,1 ms** |
| Disque volumétrique + jet | 32,6 | 32,9 ms |
| Interstellar (le passage du film) | 43,3 | **34,6 ms** |
| Saturne à contre-jour | 137,9 | **≈ 51 ms** |
| Miller : Gargantua sur la mer | 122,3 | **115,9 ms** |
| La Lune en plaine | 64,6 | 65,9 ms |
| Yosemite | 98,9 | **73,3 ms** |
| Les Andes au couchant | — | **65,5 ms** (96,0 sans la grille) |
| Vol, Alpes, cockpit | 27,2 | **19–23 ms** |
| Vol, Tarifa, cockpit | 43,9 | **≈ 25,7 ms** |
| (cabine du Ranger, Interstellar) | 52 | **18 ms** |

## Essayés, non retenus

- **La tolérance des géodésiques doublée** (`realtimeEps` 0,12 → 0,24) : −32 % sur Kerr par la tranche, mais des taches
  autour de l'anneau de photons et l'ombre déformée — rejeté. Doublée seulement loin du trou (`tune` TUNE_EPS_FAR) :
  −13 % sur Kerr, rien ailleurs — à revoir à l'œil avant de l'adopter.
- **La liste compacte des corps** (`renderer.bodyList`) : les 250 tests de corps par rayon de ciel coûtaient peu (−1,6 ms
  sur Terre, rien sur Saturne) — gardée (images identiques, test exact), sans gain notable.
- **L'air à 8 échantillons** au lieu de 32 : −4 à −15 % mais l'image change — la table fait mieux sans rien perdre.
- **La sonde de lumière une image sur deux** : rien de mesurable.
- **L'approche du terrain sans bruit** (les hauteurs des tuiles et le plus que le détail peut ajouter) : −1 à −3 % en
  plaine, +14 % dans les Alpes (la grande marge des montagnes : les hauteurs complètes plus tôt).
- **Les corps de Gargantua écartés par la bande de leur orbite** : rien (ils passent près des rayons).
- **Alléger la déformation des crêtes** (−18 % à Yosemite) : écarté — la forme des crêtes serait changée (choix du
  16/10 : les garder telles quelles).

- **Miller** : les corps de Gargantua écartés tôt par leur place au début du pas (+3,7 % : les registres) ; par la
  bande de leur orbite (rien). Ce qui y coûte est du vrai travail : le disque épais — sa brume, sa fumée, sa
  turbulence que les rayons du ciel traversent — ≈ 18 %, les corps à chaque pas ≈ 17 %, les traversées du plan ≈ 5 %.

## Ce qui coûte encore, sur Terre

Mesuré avec le banc corrigé (17/10, avant la grille de déformation), le gain d'une borne (la chose retirée) :

| Retiré | Andes | Alpes | Tarifa |
|---|---|---|---|
| le détail procédural | −56 % | −15 % | −22 % |
| sa déformation des crêtes | −30 % | −2 % | −10 % |
| l'ombrage du sol (`TUNE_SKIP` 8192 : plat) | −20 % | −34 % | −28 % |
| la moitié des pas de la marche (`TUNE_MARCH_K` 1) | −14 % | −9 % | −3 % |
| la B-spline des tuiles (`TUNE_CHEAP`) | 0 % | −3 % | −2 % |

Les comptes (`costView` 14, `costStats`) : la marche fait 14 à 30 pas par pixel (p90 32–81), 24 à 37 hauteurs lues,
~10 pas d'ombre — pas 150. Le coût est le prix d'une hauteur (le détail) et l'ombrage, pas le nombre de pas.

## Ce que disent les vues coût

- **Le trou noir** : la boucle principale (les pas géodésiques) — ≈ 150 pas par rayon sur le disque, ≈ 500 au bord de
  l'ombre ; mais aussi **40 à 150 pas pour les rayons du ciel lointain**, à peine déviés, qui sont la plus grande part
  de l'image ; l'axe de rotation (la singularité des coordonnées) 3 à 5 fois plus. Un pas coûte déjà ≈ 3,6 ns : il faut
  moins de pas, ou moins de rayons.
- **La Terre en vol bas** : (lu sur les cartes, à corriger par les comptes ci-dessus) ≈ 150 lectures de hauteur par
  rayon au sol, 40 pas d'ombre du relief, 32 pas d'air sur chaque pixel.
- **Les comptes du trou noir** (`costView` 15) : ≈ 38 pas géodésiques par rayon (p50 25, p90 ~80) sur Kerr,
  Interstellar, le disque volumétrique ; le ciel lointain ≈ 11 — les pas chers sont les rayons fortement déviés près
  du trou. Miller teste ≈ 180 corps par rayon (p99 1 272), Saturne 270.

## À mesurer, puis à faire (par gain attendu)

1. ~~La marche du terrain par une pyramide de hauteurs max~~ — mesuré : ≤ 10 % à gagner (la marche fait peu de pas) ;
   remplacé par la grille de déformation (fait, 7.).
2. ~~Les corps de Gargantua testés à chaque pas~~ (Miller, Saturne) — fait (8.), ce qu'il y avait d'exact à gagner.
3. La netteté en mouvement rapide — mesurée (9., 12.) ; plus de rayons en virage et en vol bas, le réglage
   « Netteté en mouvement » (13.).
4. L'ombrage du sol — décomposé (10.) ; les ombres allégées ; la normale par un bruit à dérivées essayée (11.) : rien.
5. Les pas géodésiques du ciel lointain : ≈ 11 par rayon déjà ; la LUT du champ lointain n'aide pas au-delà de blocs
   de 2 (audit O1).
