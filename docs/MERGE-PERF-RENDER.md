# Fusion de `perf-render` dans `main` — rapport pour l'agent qui fusionne (17/10/2026)

Ce document décrit **tout** ce que la branche `perf-render` apporte par rapport à `main` : les améliorations, les
mesures, les changements de code et d'API, ce qui ne marche pas ou reste douteux, et la marche à suivre pour fusionner.
Le journal détaillé, mesure par mesure, est [`PLAN-RENDU-PERF.md`](PLAN-RENDU-PERF.md) ; l'API de débogage,
[`BH-API.md`](BH-API.md).

## 0. L'état en un coup d'œil

| | |
|---|---|
| Branche | `perf-render` — tête `2377f8c0` + ce rapport ; `test-kimi` = `2377f8c0`, déployée sur GitHub Pages `/test/` |
| Base commune avec `main` | `a7da8d28` (16/10, « What costs in the low flight's render… ») |
| Commits propres à la branche | 29 (dont 4 déjà sur `main` sous un autre hash, à contenu identique — §5) |
| `main` en avance | 7 commits (18/10) : les 4 copies ci-dessus + `1ce1f2a7` (la console d'équipage), `ff7ec030` (l'école de vol), `dfa72d36` (le radar) |
| Fichiers touchés | 45 fichiers, +3 216 / −272 lignes |
| Fusion à blanc | `git merge-tree --write-tree origin/main perf-render` : **aucun conflit** (17/10, 21 h ; refaite le 18/10 sur `dfa72d36` : aucun) |
| Vérifié sur la branche | `bunx biome ci .` OK, `bunx tsc --noEmit -p .` OK, `check-repo-size` 0 binaire nouveau, `check-wgsl` 20/20 shaders (Apple), tests unitaires **1 307 pass / 0 fail** (kerr-mini, `--parallel=4`), CI Pages de `test-kimi` verte (snapshot, main, preview, site, deploy) |

La demande d'origine (16/10) : « Ne pas tracer sous le cockpit. Mode diagnostic de performances… Le rendu, c'est le
goulot (trou noir, planète). Je veux que ce soit hyper beau, qualité AAA et performant. » Toutes les mesures ont été
faites sur **kerr-mini** (Mac mini M1, écran 1920×1080 **à 50 Hz**), jamais sur la machine de développement.

## 1. Les gains de performance (la passe de trace, ×4, 1600×1000, kerr-mini)

La passe de trace est presque tout le temps de l'image (la reconstruction et le post-traitement ≈ 4 ms).

| Scène | `main` (départ) | `perf-render` | Gain | D'où vient le gain |
|---|---|---|---|---|
| Kerr a=0,94 par la tranche | 12,7 ms | **10,1 ms** | −21 % | tolérance des géodésiques ×3 loin du trou (§2.6) |
| Disque volumétrique + jet | 32,6 | 32,9 | = | — |
| Interstellar (le passage du film) | 43,3 | **34,6** | −20 % | la fumée du disque pas à pas de 0,5 M en temps réel (§2.6) |
| Saturne à contre-jour | 137,9 | **≈ 51** | −63 % | pas du trou de ver fusionnés (§2.5) + liste de la bouche (§2.8) |
| Miller : Gargantua sur la mer | 122,3 | **115,9** | −5 % | rejet tôt des corps (§2.8) ; le reste est du vrai travail |
| La Lune en plaine | 64,6 | 65,9 | = | — |
| Yosemite | 98,9 | **73,3** | −26 % | grille de déformation (§2.7), marche sur-relâchée (§2.4), table aérienne (§2.3) |
| Les Andes au couchant | 96,0 | **65,5** | −32 % | grille de déformation (§2.7), marche sur-relâchée |
| Vol, Alpes, cockpit F-35 | 27,2 | **19–23** | −20 à −30 % | masque du cockpit (§2.1), table aérienne, plafond du relief, ombres |
| Vol, Tarifa, cockpit F-35 | 43,9 | **≈ 25,7** | −41 % | masque du cockpit, table aérienne, marche, grille, ombres |
| Cabine du Ranger devant Gargantua (Interstellar) | 52 | **18** | −65 % | masque du cockpit |
| Cabine du Ranger, Kerr par la tranche | 30 | **9** | −70 % | masque du cockpit |

Les images sont identiques au bruit de mesure près, sauf indication contraire en §2. Le bruit d'une comparaison se
mesure avec `AB=noop` (deux captures de la même chose) : par exemple 35,2 dB sur Kerr et 32,7 dB sur Miller. Les deux
exceptions sont la fumée du disque d'Interstellar en mouvement (29,4 dB contre 29,7) et les réglages de densité, qui
coûtent du temps.

**Qualité en vol** (PSNR de l'image temps réel contre l'image convergée de la même vue, `flight-quality`) :

| Vol | `main` | `perf-render` |
|---|---|---|
| Alpes, ligne droite | 31,6 dB | 33,0 dB (historique gardé) |
| Tarifa, croisière | 40,3 dB | 44,4 dB (historique gardé) |
| Virage serré dans les Alpes | 29,8 dB | 30,3 → **32,4 dB** avec « Netteté en mouvement : En virage » (trace 21 → 35 ms pendant le virage) |
| Tarifa à 700 m en virage | 36,0 dB | **38,8 dB** (« En virage », 40 % des images densifiées) |

## 2. Ce qui a été fait, commit par commit et par thème

### 2.1 Ne pas tracer sous le cockpit — `374e59f2`, corrigé en revue `44e67be0`
- **Principe.** Après le raster de l'appareil, `ship.ts` redessine seules ses parties opaques (`ownMask` : cabine,
  panneau, cadre — ni la verrière, ni les autres appareils) dans une cible r8. Avant la trace temps réel suivante, une
  passe `shaders/mask.wgsl` marque chaque tuile 16×16 entièrement couverte, avec une marge (`moments.x = −1`).
- **Côté trace.** Le thread du noyau ne trace pas là ; il n'y a pas de `return` anticipé avant les barrières (le
  besoin et l'échantillonnage sont coupés). Le photomètre (`post.wgsl` meter) ignore ces points.
- **Quand c'est actif.** Seulement en cockpit, la tête et l'objectif tels qu'au dessin. `ship.ts ownPose` compare l'œil
  sur l'appareil, la ligne de visée et le haut ; la secousse est tolérée jusqu'à `SHAKE_PX` (10 px).
- **La marge.** Deux blocs plus 6 px, et 40 px si le flou de mouvement est actif. Le masque est coupé sous une
  profondeur de champ.
- **Garde.** `renderer.ownMaskStamp` : le masque n'est actif qu'après une image qui a réellement dessiné le masque de
  l'appareil. Si le maillage charge encore et que la passe est sautée, rien n'est masqué.
- **Interrupteur.** `renderer.cockpitMask` (défaut `true`). Les deux passes ajoutées coûtent ≈ 2,5 ms.

### 2.2 Les outils de diagnostic — `6c7df98c`, `45fc1be8`, `ce7861a9`
- **`renderer.costView`** : le travail de chaque rayon en carte de chaleur, brute (sans exposition, tone map, profondeur
  de champ ni flou).
  - 1 : le total pondéré ; 2 … 13 : une sorte de travail (marche du sol, hauteurs, ombres, nuages, air, eau, décor,
    intégrateur, bruit, étoiles, corps, boucle principale).
  - 14 et 15 : des comptes bruts, relus par `renderer.costStats()` (part, moyenne, p50, p90, p99).
  - C'est une variante de noyau à part : à 0, elle est hors du noyau (coût mesuré : nul).
- **`renderer.tune`** : les constantes `TUNE_*` de `trace.wgsl` (constantes d'override, une variante par jeu de
  valeurs). On mesure ce que coûte une boucle sans toucher au code. Liste et sens en §3.3.
- **`renderer.kernelsSettled` et `renderer.aerialWanted`.** Le noyau courant est compilé avec sa cascade : sonde, table
  aérienne, décor et surface demandés pour sa clé. **Indispensable aux A/B** : attendre `variantReady` ne suffit pas ;
  le côté B se mesurait sans table aérienne ou sans décor (10–30 % d'erreur sur Terre).
- **`renderer.probeEveryMoving`** (défaut 1) : la sonde de lumière toutes les n images en mouvement. Aucun gain
  mesurable, laissé à 1.
- **Tests e2e de mesure ajoutés** (tous sur kerr-mini) :
  - `tests/e2e/perf-suite.e2e.test.ts` : scènes figées, chaque image profilée, `AB=<interrupteur>` alterné,
    `COST=…`, `SCENES=…`, `REPS=…`.
  - `tests/e2e/flight-quality.e2e.test.ts` : PSNR en vol contre l'image convergée. Variables `PLACES`
    (`alps`, `tarifa`, `alps-turn`, `tarifa-low`), `CONF=a,b,a,b` (les captures reprises sont numérotées).
  - `tests/e2e/motion-quality.e2e.test.ts` : rotation pure devant le trou noir.
  - `tests/e2e/compile-time.e2e.test.ts` : la première trace d'une scène (0,3–0,5 s à chaud ; `main` 0,4 s).
  - `tests/e2e/boot-debug.e2e.test.ts` : les erreurs d'un démarrage.
  - `tests/e2e/cost-view.e2e.test.ts`, mis à jour.

### 2.3 La table de perspective aérienne — `45fc1be8`, corrigé `44e67be0`
- **Principe.** C'est la méthode des froxels de Hillaire 2020 : 96 × 54 directions × 32 tranches exponentielles
  jusqu'au-delà de l'air. Chaque colonne est intégrée une fois (`earthAir` par tranche, 3 échantillons, arrêtée au sol).
- **Lecture.** Les rayons de la caméra près d'un monde avec air la lisent au sol, au nuage et à la fin de l'air, au
  lieu de leurs 32 échantillons. La passe coûte moins de 0,3 ms.
- **Portée** : `√(r² − 1) + √(A² − 1)`.
- **Gains.** Tarifa −21,5 %, Alpes −15 %, Yosemite −6 à −12 %, Andes −6 %, Bretagne −9 %. Images à 43–47 dB entre
  elles.
- **⚠ Deux textures échantillonnées de plus pour le noyau** (`AERIAL_TEXTURE_LIMIT` 21).
  - Elles ne sont demandées que si l'appareil le permet ; sinon le traceur est construit sans la table
    (`system/aerial.ts aerialShader`, vérifié par `check-wgsl`).
  - Elles sont aussi liées aux noyaux des sondes et du champ lointain, parce que `earthLook` est partagé. **Toute
    nouvelle liaison du groupe 1 doit être ajoutée aux trois layouts**, sinon le démarrage échoue avec « Device was
    destroyed ».
- **Interrupteur** : `renderer.aerialTable`.

### 2.4 La marche du terrain — `d1797082`, `81e10f94`, corrigé `44e67be0`
- **Plafond du relief** (`system/relief-ceiling.ts`, `trace.wgsl earthTop`, `renderer.reliefCeiling`).
  - La coquille des marches n'est plus à 9 600 m. Elle est au plus haut que le sol peut être autour de la caméra :
    maxima de la carte globale par cellules de 1°, maxima des tuiles (`EarthTiles.top`), plus ce que le détail ajoute
    (crêtes 1 900 m, collines 95 m).
  - Elle n'est recalculée que sous 300 km d'altitude.
  - Gains : Alpes −7 %, Tarifa −3 %.
- **Marche sur-relâchée** (Keinert et al. 2014, `TUNE_RELAX` / `TUNE_RELAX_BAND` 1,6).
  - Un pas vaut 1,6 fois le pas sûr ; il est repris si les deux portées laissent un trou.
  - Le pas ne dépasse jamais la fin de la coquille et ne s'applique pas sur la grille de marche à pied.
  - Gains : Andes −10,5 %, Yosemite −10,5 %, Tarifa −6 %. Revalidé avec le banc corrigé : la retirer coûte +13 % aux
    Andes et +7 % à Tarifa.

### 2.5 Saturne : les pas du trou de ver fusionnés — `37bb362a`, corrigé `44e67be0`
- **Le problème.** Près de la bouche, chaque pas de notre côté regardait tous nos corps, une quarantaine de fois par
  rayon.
- **La solution.** Les cordes sont réunies en morceaux droits tant que le chemin tient à un quart de pixel près
  (`TUNE_MERGE`). Un morceau est vidé quand le chemin plie, quand le rayon quitte la région ou entre dans la bouche, et
  quand les pas s'épuisent.
- **Résultat.** Saturne : trace 126,7 → 54,8 ms ; image 142 → 71 ms, à 52 dB.

### 2.6 Le ciel du trou noir — `8d446de9`, `4645e86f`
- **`TUNE_EPS_FAR` 3.** La tolérance des géodésiques est ×1 jusqu'à 10 M (sphère de photons, anneau et ombre exacts) et
  monte jusqu'à ×3 au-delà de 20 M. Elle ne s'applique qu'aux passes temps réel. Kerr par la tranche −21 %. Un
  doublement global (`realtimeEps` 0,24) faisait des taches autour de l'anneau : rejeté.
- **`TUNE_SMOKE_STEP`.** La fumée du disque avance par pas de 0,5 M en temps réel (0,25 avant ; les passes d'affinage
  gardent 0,1). Interstellar −22 % ; en mouvement 29,4 dB contre 29,7 (choix du propriétaire, 16/10).

### 2.7 La déformation des crêtes lue dans des grilles — P1 `ce7861a9`
- **Le problème.** Le relief des montagnes (`earthDetail`) est un multifractal sur un réseau déformé par un champ lisse
  qui coûte six bruits de gradient à chaque hauteur lue.
- **Où le champ est calculé.** `system/warp-grid.ts` le calcule sur des nœuds fixes sur la Terre (longitude et latitude
  en pas entiers : rien ne saute quand la grille suit la caméra). Il y a 3 niveaux de 512² nœuds (19, 76 et 306 m, soit
  ±4,9, ±20 et ±78 km).
- **Comment il est lu.** En bilinéaire, chaque niveau fondu dans le suivant vers son bord. Au-delà des grilles et
  au-dessus de 75° de latitude, le champ est calculé par chaque rayon.
- **Mise à jour.** Un niveau est recalculé (passe de calcul) quand la caméra s'éloigne de 64 nœuds de son centre. Le
  bruit de la passe est extrait du source de `trace.wgsl` (`wgslFunction`), pas recopié.
- **Mémoire.** Les grilles vivent dans le buffer de tables du traceur (`gpu-tables.ts TABLE_WARP`), qui **grandit de
  3 × 512² × 16 o ≈ 12,6 Mo**.
- **Précision.** Les crêtes se déplacent de 3 cm au plus près de la caméra, 0,4 m à 20 km, 6 m à 78 km
  (`tests/warp-grid.test.ts`). La physique garde le champ exact (`terrain.ts`).
- **Gains.** Andes −32 %, Yosemite −26 %, Tarifa −11 %, Alpes neutre. Interrupteur : `renderer.warpGrid`.

### 2.8 Les corps, moins souvent regardés — P2 `2540a1b3`
- **Liste de la bouche** (`Params.mouthList`, `listedBody(list)`, `renderer.bodyListSizes`). Les rayons de la région
  de la bouche ne lisent plus que les corps assez grands vus du bord de la région, ceux de la région, ceux à anneaux et
  les étoiles (9 au lieu de 27 près de Saturne). Saturne −5 %.
- **Rejet tôt** (`TUNE_BODY_REJECT`). Un corps de Gargantua plus loin du début du pas que le pas, plus sa portée, plus
  son déplacement orbital, n'a pas sa position en fin de pas calculée. Miller −2 à −3 %.
- **Liste compacte de nos corps pour `ourSegment`** (`renderer.bodyList`, depuis `45fc1be8`) : −1,6 ms sur Terre, rien
  sur Saturne. Gardée parce qu'elle est exacte.

### 2.9 L'ombrage du sol — `63539141`
- **Décomposition** (`TUNE_GSKIP`, bits 1 à 256). Les ombres du relief coûtent ≈ 11–12,5 %, la normale fine 5–10 %, et
  tout le reste ≤ 2–3 % chacun.
- **Ce qui est fait** (`TUNE_SHADOW_RELAX` 0,3). Un rayon d'ombre haut au-dessus du sol avance d'une part de sa hauteur
  libre. Avec la marge de distance dans le pas, des rivières se retrouvaient ombrées au couchant : la part est donc
  calculée sur la hauteur libre seule.
- **Gains.** Alpes −4 %, Tarifa −3 %, Andes 0. Images à 46–53 dB.

### 2.10 Plus de rayons quand l'image glisse vite — `3e947c2b`, puis réglage `20814e4c`
- **Réglage** : Rendu › Temps réel › « Netteté en mouvement » (`settings.motionDetail`, persistance `pref`). Valeurs
  `off` (**défaut** depuis l'audit du 18/10, §7), `turns`, `low`.
- **Effet** : le bloc des rayons passe un cran plus fin (×4 → ×3, ×6 → ×4, ×8 → ×6 ; `renderer.motionBlock`).
- **Déclencheurs** (mesurés en px/s, pas en px par image : sinon la densité s'entretenait d'elle-même) :
  - En virage : `imageTurnPx` > 25 px/s pendant 200 ms, retour sous 18 px/s après 300 ms.
  - En vol bas (`low`) : `imageGroundPx` > 12 px/s, retour sous 9 px/s. C'est la moyenne sur 15 directions de la
    vue : le déplacement de la caméra en travers, divisé par la distance au sol (40 km au plus).
- **Choix automatique du bloc.** Il ne compte pas ces images.
- **Retiré** : `renderer.motionDense`, remplacé par le réglage. Ce n'était jamais sur `main`.
- **Test** : `tests/e2e/motion-detail.e2e.test.ts` (recherche en français, vrai clic).

### 2.11 La distance de détail — `2377f8c0`
- **Réglage** : Ciel › La Terre › « Distance de détail » (`settings.detailReach`, `pref`). Valeurs `normal`
  (**défaut**), `far`, `veryFar`.
- **Décor** (`scenery-data.ts DETAIL_REACH` 1 / 1,5 / 2, `sceneryBudget`, `sceneryGrid`).
  - Zone ×k : en équilibré 2 → 3 ou 4 km, en élevé 3 → 4,5 ou 6 km. La portée des rayons suit
    (`params o[7]`).
  - Budgets ×k² :
    - tampon GPU 16 → 36 ou 64 Mio, borné par `maxStorageBufferBindingSize` ;
    - trame 512 → 768 ou 1 024 px ;
    - forêt, surfaces, tuiles OSM, bâtiments et ponts.
  - Le tampon est réalloué à la taille du budget, et l'ancien est retiré une fois le GPU passé.
  - **Correctif** : `scenery-contact.ts` (collisions, végétation) et `ui/local-ground-map.ts` (mini-carte) lisent le
    côté de la trame dans la scène (`f[3]`), et non plus 512 en dur.
- **Relief** (`earth-tiles.ts TILE_REACH`, `EarthTiles.setReach`).
  - Fenêtres de 4 → 8 tuiles de côté à tous les niveaux.
  - Texture 1 024² → 2 048² × 8 niveaux (`rg32uint`), soit **64 → 256 Mio**. Elle est recréée et les groupes de
    liaison sont reconstruits (`onResize` → `bindTarget`).
  - `trace.wgsl tileTexel` / `tileImage` masquent l'adresse par `textureDimensions − 1` (le côté doit rester une
    puissance de deux), et non plus `& 1023`.
- **Regard.** `GAZE_TILES_M` vaut 6 / 12 / 20 km ; le décalage d'une fenêtre est d'au plus `span/2 − 0,75` tuile.
- **Préchargement.**
  - Sur les 2 (`far`) ou 3 (`veryFar`) niveaux les plus fins, une tuile quittée est gardée avec son imagerie dans un
    LRU de 128 ou 256 tuiles (`EarthTiles.kept`).
  - Une fois les fenêtres complètes, l'anneau suivant est chargé d'avance (au plus la moitié des chargements).
  - Une tuile gardée revient à l'image même. Les tuiles gardées ne sont plus bloquées par les chargements en vol.
- **Tests** : `tests/earth-tiles.test.ts` (fenêtres de 8, la mémoire, l'anneau) et
  `tests/e2e/detail-reach.e2e.test.ts` (`PLACES`, `REACH`, `FRAMES`, `E2E_SHOTS`).

### 2.12 Mesuré, rien d'adopté (le code n'est pas sur la branche, sauf les tests-bornes)
- **P3, la netteté en mouvement rapide** (`36384d60`). Le rognage de l'historique, le poids entre rayons, le plafond de
  l'historique et l'affûtage restent tous dans ±1 dB. Un pixel de bord lisant deux historiques : rien.
- **Normale du relief par un bruit à dérivées analytiques** (`0dd3d511`). Vérifiée contre une référence CPU en float64,
  mais rien gagné (Andes 61,0 contre 61,1 ms) : un bruit dérivé coûte environ deux bruits, et le noyau est limité par
  ses registres. Retirée.
- **Reconstruction en virage** (`a3b32cf7`). Catmull–Rom, profondeur bilinéaire, rognage sur la grille des rayons :
  rien. Rognage à 100 σ : mieux en rotation pure, des fantômes à Tarifa. Les réglages-bornes `g100`, `g100n64` et
  `nota` sont gardés dans les tests.

### 2.13 Hors rendu (déjà sur `main`, copies identiques)
- **Appontage par mer forte** (`8ad757ce` = `ed5c4378` sur `main`).
  - `controller/trap.ts` : l'arrestation se termine sur la vitesse le long de l'axe du pont, et une sortie du pont est
    un « Cut ».
  - `game/trap.ts TrapRun.missed` : la relance ne se fait qu'en ralliement, en rapprochement et avec de la place.
  - `controller/carriers.ts` : option `seed`. `tests/quals.test.ts` : SEED 699 699.
- **Budgets de temps des tests sous `PERF=1`** (`dc51632b` = `43acf696`).
- **CI Pages en parallèle** (`90bf3e38` = `da71a74d`) : jobs snapshot → main ∥ preview → site → deploy/server. Le
  build de `main` est mis en cache par sha. Les binaires de la préview identiques à ceux de `main` sont dédupliqués
  (`../x`). Documentation dans `docs/ASSETS.md`.
- **Délai de 30 s par test en CI** (`13ed00f2` = `3031e278`).

## 3. Les changements de code, fichier par fichier

### 3.1 Nouveaux fichiers
| Fichier | Rôle |
|---|---|
| `src/shaders/mask.wgsl` | passe du masque du cockpit (tuiles 16×16 couvertes) |
| `src/system/relief-ceiling.ts` | plafond du relief autour de la caméra |
| `src/system/warp-grid.ts` | grilles de la déformation des crêtes (`WarpGrid`, `warpWindows`, `warpShader`, `wgslFunction`) |
| `tests/warp-grid.test.ts` | précision des grilles contre le champ |
| `tests/e2e/perf-suite.e2e.test.ts`, `flight-quality`, `motion-quality`, `motion-detail`, `detail-reach`, `compile-time`, `boot-debug` | mesure et vérification (kerr-mini) |
| `docs/PLAN-RENDU-PERF.md` | journal de la branche |

### 3.2 Fichiers modifiés les plus lourds
- **`src/shaders/trace.wgsl` (+476).**
  - Constantes `TUNE_*` (overrides).
  - `COST_VIEW` 14 et 15.
  - Masque (`moments.x`).
  - Lecture de la table aérienne (`aerial`, `apRead`).
  - `earthTop` et marche relâchée.
  - `earthWarp` (`WARP_OFF`) avec `earthWarpExact` en repli.
  - Fusion des cordes de `ourSegment`.
  - `mouthList` / `listedBody`.
  - Rejet tôt des corps.
  - `earthTerrainShadow` relâché.
  - `tileTexel` / `tileImage` masqués par `textureDimensions`.
- **`src/renderer.ts` (+583).**
  - Masque : `cockpitMask`, `ownMaskStamp`.
  - Table aérienne : `aerialTable`, `aerialWanted`, `FLAG_AERIAL`.
  - `reliefCeiling`, `bodyList`, `bodyListSizes`, `warpGrid` / `updateWarp`.
  - Mesure : `tune`, `kernelsSettled`, `costStats`.
  - Densité en mouvement : `motionBlock`, `imageTurnPx`, `imageGroundPx`.
  - `taParallaxPx` 0,5 → **64**.
  - `probeEveryMoving`.
  - Distance de détail : `DETAIL_REACH`, `GAZE_TILES_M`, `earthTiles.setReach`, `onResize`.
- **`src/ship.ts`** : `ownMask`, `ownPose`. **`src/shaders/ship.wgsl`, `post.wgsl`** : masque et photomètre.
- **`src/system/earth-tiles.ts`** (+210) : `top()`, la portée (`span`, LRU, anneau), `kept`, `slotOf` devenue une
  méthode.
- **Décor** : `scenery.ts`, `scenery-worker.ts`, `scenery-data.ts`, `scenery-contact.ts`, `ui/local-ground-map.ts`.
- **`src/gpu-tables.ts`** : `TABLE_WARP` ; `TABLE_VEC4S` grandit (+12,6 Mo).
- **`src/terrain.ts`** : exporte la déformation exacte pour la physique et les tests.
- **`src/system/aerial.ts`** : `aerialShader` (le traceur sans la table).
- **`scripts/check-wgsl.ts`** : variantes ajoutées.
  - Sans table aérienne.
  - Sans table, sans textures de surface et sans décor.
  - La passe de la grille.
  - Total : 20 shaders.
- **Réglages** : `src/settings.ts` (`motionDetail`, `detailReach`, tous deux `pref`), `src/ui/schema.ts`,
  `src/i18n/fr-settings.ts` (FR et EN).
- **`.github/workflows/pages.yml`** : identique à celui de `main` (copies, §2.13).

### 3.3 Les constantes `TUNE_*` (trace.wgsl, via `renderer.tune`)
- **Adoptées comme valeur par défaut du noyau** :
  - `TUNE_RELAX` / `TUNE_RELAX_BAND` (1,6) ;
  - `TUNE_EPS_FAR` (3) ;
  - `TUNE_SMOKE_STEP` (0,5 M en temps réel) ;
  - `TUNE_MERGE` (1) ;
  - `TUNE_BODY_REJECT` ;
  - `TUNE_SHADOW_RELAX` (0,3) ;
  - `TUNE_WARP` (grille).
- **Bornes de mesure uniquement** (elles changent l'image ou retirent du travail réel) :
  - `TUNE_SKIP` (bits 1024 / 2048 / 4096 / 8192…) et `TUNE_GSKIP` (bits 1 à 256) ;
  - `TUNE_AIR_N`, `TUNE_SHADOW_N`, `TUNE_SHADOW_K`, `TUNE_MARCH_K` ;
  - `TUNE_CHEAP`, `TUNE_DETAIL`, `TUNE_STEP_BODIES`.
  - **À ne jamais livrer avec une autre valeur que leur neutre.**

### 3.4 API et réglages visibles (résumé de `BH-API.md`)
- **Nouveaux sur `__bh.renderer`** :
  - interrupteurs : `cockpitMask`, `aerialTable`, `reliefCeiling`, `bodyList`, `warpGrid` ;
  - lecture seule : `bodyListSizes`, `imageTurnPx`, `imageGroundPx`, `kernelsSettled`, `aerialWanted`,
    `earthTiles.kept` ;
  - mesure : `costStats()`, `probeEveryMoving`, `tune`.
- **Modifiés** :
  - `taParallaxPx` vaut 64 par défaut ;
  - `costView` : 14 et 15, affichage brut ;
  - `streamingState.gazeM` : jusqu'à 12 et 20 km selon la portée ;
  - `earthScenery.stats().reach`.
- **Réglages nouveaux** (les deux en persistance `pref`) : `motionDetail` (défaut `off`), `detailReach` (défaut
  `normal`).

## 4. Ce qui ne fonctionne pas, reste douteux ou n'a pas été vérifié

**À savoir avant de fusionner :**

1. **Pas testé sur iPad ni sur Safari**, et pas sur Windows ni sur un GPU non-Apple. Toutes les mesures sont sur M1
   (Chrome). Points à risque :
   - la table aérienne demande 21 textures échantillonnées ; il y a un repli sans elle, vérifié par `check-wgsl` mais
     pas sur un vrai appareil limité ;
   - la distance de détail « Loin » ou « Très loin » ajoute environ 240 Mio de GPU (texture du relief 256 Mio + décor
     64 Mio) ; un iPad risque la perte du device ;
   - le buffer de tables grandit de 12,6 Mo pour tout le monde.
2. **« Loin » et « Très loin » ont la même fenêtre de relief** (8 tuiles, 256 Mio). Seuls le décor, le regard et
   l'anneau diffèrent.
   - Les niveaux grossiers (z 6–9) passent eux aussi à 8 tuiles : c'est inutile (une fenêtre z 6 de 8 tuiles couvre des
     milliers de km).
   - Côté CPU, les hauteurs des fenêtres font 64 tuiles × 8 niveaux × 256 Kio = **128 Mio**, plus jusqu'à 128 Mio de
     tuiles gardées.
   - Piste : des fenêtres de 8 seulement sur les niveaux fins, ou une texture par groupe de niveaux.
3. **Changer la distance de détail recrée la texture et recharge tout le relief.** On voit pendant quelques secondes le
   relief grossier, et le chargement complet prend 6–33 s au lieu de 3–12 s, avec 4× plus de tuiles téléchargées.
4. **Le coût de trace de la distance de détail n'est mesuré qu'en vol réel**, donc avec beaucoup de bruit (±5 ms,
   météo réelle) : Tarifa 13–18 ms en Normale contre 14–19 en Très loin. Il n'y a pas d'A/B `perf-suite` sur vue
   figée. Cela peut cacher +5–15 % là où le décor emplit la vue.
5. **Portées des ombres du décor non mises à l'échelle.** `shadowReceiverRangeM` (1 200 / 2 000 m) et `shadowRayRangeM`
   ne suivent pas `detailReach` : les arbres au-delà n'ont pas d'ombre portée. Volontaire pour le coût, mais pas vérifié
   à l'œil.
6. **Captures de la distance de détail** (`detail-reach.e2e`). Au premier passage, l'avion n'a pas exactement la même
   attitude d'une portée à l'autre : le cadrage varie légèrement. La comparaison visuelle reste valable, pas un PSNR.
7. **Les chargements en vol de tuiles qui ne sont plus voulues ne sont pas annulés.** C'était déjà le cas sur `main`,
   mais l'anneau en lance davantage, et ils occupent des places de `MAX_INFLIGHT` (8).
8. **Yosemite** garde un biais de +10 ms inexpliqué sur toute variante réglée (`tune`) : ses A/B par `tune` ne sont
   pas fiables. Les Alpes en cockpit varient de 20 à 34 ms d'un passage à l'autre. Dans `perf-suite`, la première
   mesure A d'une scène est souvent prise avant le chargement (Andes ≈ 11 ms) : utiliser `REPS=2` et lire les paires.
9. **Virage.** En virage, le recalage du sol par la TAA se dégrade : cause non trouvée (ni la profondeur, ni la
   secousse, ni la rotation pure). Le seul levier est plus de rayons, avec le réglage « Netteté en mouvement ».
   - « En virage » fait passer la trace de 21 à 35 ms pendant le virage : la cadence baisse.
   - « En virage et en vol bas » coûte ×1,5 en continu en vol bas pour peu de gain sur les vols mesurés.
10. **Miller reste à 116 ms.** C'est du vrai travail : disque épais traversé par les rayons du ciel ≈ 18 %, corps à
    chaque pas ≈ 17 %, sondes 11 ms. Le rejet tôt par position (+3,7 %, à cause des registres) et le tri par bande
    d'orbite n'ont rien donné.
11. **Contradiction dans `PLAN-RENDU-PERF.md`.** La section « Essayés, non retenus » dit encore de revoir à l'œil
    `TUNE_EPS_FAR` avant de l'adopter. Il **a** été adopté à 3 (§2.6, `8d446de9`), contrôlé par `AB=noop` seulement,
    sans revue à l'œil par le propriétaire. La doc est corrigée (18/10) ; le propriétaire le regarde lui-même, au
    télescope surtout.
12. **Le masque du cockpit** n'agit qu'en cockpit, tête immobile à 10 px près, sans profondeur de champ. Hors de ces
    conditions, aucun gain (c'est voulu). Si un nouvel appareil a des parties opaques mal classées (verrière marquée
    opaque), des rayons visibles ne seraient pas tracés : à vérifier à l'ajout de tout nouveau cockpit.
13. **Code jeté.** Le bruit à dérivées analytiques et les essais de reconstruction ne sont pas commités : ils sont
    perdus, seules les mesures restent dans la doc.

## 5. Comment fusionner

1. **Où travailler.** Ne pas commiter dans `/Users/olivierveinand/Documents/DEV/black-hole-gpu` : une autre session y
   a des changements non commités (`crew/`, `src/crew/…`, `src/net/instruments.ts`, `src/system/ellipsoid.ts`…).
   Travailler dans `bhg-net` ou dans un worktree neuf :
   ```bash
   git -C /Users/olivierveinand/Documents/DEV/bhg-net fetch origin
   git -C /Users/olivierveinand/Documents/DEV/bhg-net worktree add ../bhg-merge origin/main
   ```
2. **Fusionner** (aucun conflit attendu ; les 4 commits copiés sont équivalents en patch et Git les absorbe) :
   ```bash
   git -C ../bhg-merge switch -c merge-perf-render
   git -C ../bhg-merge merge --no-ff perf-render
   ```
   Si `main` a bougé depuis le 17/10 21 h, refaire `git merge-tree --write-tree --name-only origin/main perf-render`.
   Fichiers à surveiller : `src/renderer.ts`, `src/shaders/trace.wgsl` (énormes, très partagés), `src/settings.ts`,
   `src/ui/schema.ts`, `src/i18n/fr-settings.ts`, `docs/BH-API.md`, `src/system/earth-tiles.ts`, `scenery*.ts`.
3. **Vérifier en local** (ni GPU ni tests sur la machine de dev) :
   ```bash
   bunx biome ci .
   bunx tsc --noEmit -p .
   bun scripts/check-repo-size.ts --base origin/main
   ```
4. **Vérifier sur kerr-mini** avec `scripts/remote.ts`, une commande par appel (un `sh -c "a && b"` y échoue). Le
   message « worker died … exit 2 » à la fin d'un passage propre est sans conséquence : lire les comptes pass/fail dans
   `remote-results/<id>/log`.
   ```bash
   bun scripts/remote.ts run -- bun scripts/check-wgsl.ts
   bun scripts/remote.ts run -- bun test --parallel=4 --timeout 600000
   bun scripts/remote.ts run -- E2E=1 bun test --preload ./tests/e2e/lib/preload.ts tests/e2e/motion-detail.e2e.test.ts --timeout 600000
   bun scripts/remote.ts run -- E2E=1 PLACES=tarifa REACH=normal,veryFar bun test --preload ./tests/e2e/lib/preload.ts tests/e2e/detail-reach.e2e.test.ts --timeout 600000
   bun scripts/remote.ts run -- E2E=1 SCENES=interstellar,saturn,alps REPS=2 bun test --preload ./tests/e2e/lib/preload.ts tests/e2e/perf-suite.e2e.test.ts --timeout 1200000
   ```
   Attendu :
   - `check-wgsl` 20/20 ;
   - au moins 1 307 tests pass (plus ceux de la console d'équipage venus de `main`) ;
   - `motion-detail` : 1 pass ;
   - `detail-reach` : tous pass, 0 fenêtre en attente ;
   - `perf-suite` : Interstellar ≈ 34–35 ms, Saturne ≈ 51–55 ms, Alpes 19–25 ms à ×4.
   - Alias des scènes : `ALIAS` de `perf-suite.e2e.test.ts` (interstellar, kerr, cinematic, miller, saturn, moon, yosemite, andes, brittany, himalaya, alps, tarifa).
5. **Pousser `main`.** **Demander l'accord du propriétaire d'abord** : pousser `main` redéploie GitHub Pages **et le
   serveur samlepirate.org** (GHCR + branche `deploy`, Portainer). Après le push, suivre la CI (`gh run list`) et
   vérifier le site.
6. **Après la fusion.** `test-kimi` peut être remise sur `main` (avec `--force-with-lease`) pour que `/test/` redevienne
   la préview de la prochaine branche. Retirer le worktree.

## 6. Pistes ouvertes (non faites)

(Voir aussi §7 : les suites de l'audit du 18/10.)

- **Distance de détail.**
  - Fenêtres de 8 seulement sur les niveaux fins (diviser la mémoire par 2 à 4).
  - Un A/B `perf-suite` sur vue figée (`AB=reach`).
  - Mettre à l'échelle, ou non, les portées d'ombre du décor.
  - Annuler les chargements de tuiles devenues inutiles.
- **Vérifier sur iPad** (`scripts/ipad.ts`) la table aérienne, la grille de déformation et la distance de détail.
- **Faire valider à l'œil `TUNE_EPS_FAR` 3** par le propriétaire et corriger la note contradictoire de la doc.
- **Trou noir.** Les pas géodésiques du ciel lointain (≈ 11 par rayon) : la LUT du champ lointain n'aide pas au-delà
  de blocs de 2 (audit O1).
- **Sol.** La normale fine du relief (5–10 %) et les ombres du relief (≈ 11 %) restent les plus gros postes de
  l'ombrage. La marche elle-même ne fait que 14–30 pas par pixel.

## 7. L'audit avant la fusion (18/10/2026)

Une relecture du code (le masque, la Terre, le trou noir, les réglages et les tuiles), sans e2e, puis des correctifs
sur la branche. Décisions du propriétaire : corriger sur `perf-render` puis fusionner ; « Netteté en mouvement » à
**Non** par défaut ; `TUNE_EPS_FAR` 3 regardé par lui au télescope ; une vérification ciblée sur kerr-mini.

**Corrigé sur la branche :**
- **Le masque ne peut plus empêcher le démarrage.** `mask.wgsl` lisait `covered` par `workgroupUniformLoad` sur un
  atomique (une surcharge récente, la première du projet) et son pipeline était dans le `Promise.all` attendu à la
  création du moteur : un navigateur qui refuse le shader (Safari, iPad ?) bloquait tout. Maintenant une barrière et
  `atomicLoad`, le pipeline à part, son échec laissant le masque éteint.
- **Le décor ne disparaît plus en changeant la distance de détail.** `scenery.ts` réallouait le tampon (vide) avant le
  test « une source manque, garder la scène dessinée » : une tuile OSM en échec laissait des arbres et des bâtiments
  invisibles mais solides (collisions). Le test passe avant la réallocation.
- **La table aérienne pré-exposée.** Ses `rgba16float` gardaient la lumière brute ; le reste du pipeline la multiplie
  par `preExposure` (jusqu'à 2⁴⁰) avant tout stockage 16 bits. De nuit l'air de la table pouvait s'arrondir à zéro.
  Écrite × `preExposure`, lue ÷ (`Params.zamo2.y`, `trace.wgsl apScale`).
- **Les étoiles d'une nuit de lune voilées par la table** (trouvé par la vérification ci-dessous). La table garde la part
  de la lune (`Lm`) en luminance grise ; le voile des étoiles (`earthNear`) l'ôtait canal par canal d'un ciel bleu,
  borné à 0 : le bleu restait, et voilait la plupart des étoiles faibles sous la lune (le ciel de la vue 14 % plus
  sombre qu'avec la marche de chaque rayon). Le voile ôte maintenant la luminance : identique pour la marche d'un rayon
  (linéaire), juste pour la table.
- **« Netteté en mouvement » : Non par défaut.** « En virage » coûte 21 → 35 ms par virage et la résolution dynamique
  compte ces images (voir plus bas) ; le joueur la choisit.
- **La doc** : `TUNE_EPS_FAR` adopté (plus « à revoir ») ; le rejet tôt des corps du 16/10 (+3,7 %) distingué de celui
  adopté le 17/10 ; les commentaires « 1024² » du noyau.

**Vérifié sur kerr-mini (18/10)** : `check-wgsl` 20/20 ; tests unitaires 1 307 pass / 0 fail ; `perf-suite` sur deux
scènes nouvelles (`tarifa-dusk` : Tarifa au crépuscule vers le couchant, `tarifa-night` : sous la pleine lune du
29/07/2026), A/B alternés, images comparées en PSNR (le bruit d'une comparaison, `AB=noop` : 50,0 dB au crépuscule,
44,2 dB la nuit) :

| | crépuscule | nuit |
|---|---|---|
| table pré-exposée → lumière brute (`AB=aerialraw`, l'ancienne table) | 46,0 dB — des bandes dans le ciel | 43,3 dB |
| table → marche de chaque rayon, avant le correctif du voile | 51,1 dB | 41,5 dB — les étoiles voilées |
| table → marche de chaque rayon, après (`AB=aerial`) | **49,1 dB** (moyennes 9,24 / 9,26) | **46,1 dB** (14,96 / 14,98) |
| gain de la table sur la trace | −17 % | −21 % |

**Suites, non bloquantes (à faire sur `main`) :**
- **Netteté en mouvement et résolution dynamique** : `main.ts` (gpuEma, scaleMs) et `adaptBlock` (`blockMs`,
  `recentMs`) enregistrent les images densifiées : après un virage de plus de 3 s, l'échelle de rendu baisse et ne
  remonte pas avant 30 s. En « vol bas », `imageGroundPx` borne la distance au sol (40 km) au lieu d'ignorer ce qui est
  plus loin : densifié en permanence en orbite basse.
- **Fusion des pas de Saturne** (`trace.wgsl` ourSegment) : l'écart n'est mesuré qu'au dernier point du morceau
  (l'erreur d'un chemin qui plie régulièrement ≈ n/4 fois le seuil), et le flush garde la corde qui plie. Borner par
  la direction de la première corde ; vider à `p0`.
- **`TUNE_EPS_FAR`** ne dépend pas du champ de vision : au télescope, une erreur fixe couvre plus de pixels.
- **Masque du cockpit** : la tolérance de secousse prise au centre (≈ ×1,8 au bord à 60°) ; le photomètre qui change
  quand le masque bascule ; les reflets de la verrière (`screenRefl`) et l'historique qui lisent des tuiles figées ;
  son coût (≈ 2,5 ms mesuré avant l'élargissement de la marge) et son raster payé même quand il ne sert pas.
- **Distance de détail** : pas de repli si la texture de 256 Mio échoue (iPad) ; niveaux grossiers à 8 tuiles ; la
  mémoire CPU en Très loin ≈ 300 Mio (avec les couleurs de l'anneau).
- **Table aérienne à l'horizon** : une colonne de 20 px mélange un rayon arrêté sur la mer et un rayon rasant du ciel
  (plausible : une bande à l'horizon, le soleil couchant sur la mer trop clair).
- **`taParallaxPx` 64** : l'historique n'est presque plus jeté ; mesuré en vol seulement, pas au roulage, sur le pont ni
  près des bâtiments.
