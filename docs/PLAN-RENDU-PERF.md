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

**Le banc corrigé** (17/10) : une variante réglée (`tune`) a son propre noyau de table aérienne, et le décor et la
surface demandent un noyau compilé pour sa clé ; attendre `variantReady` ne garantissait ni l'un ni l'autre — le côté
B se mesurait souvent sans table aérienne (plus lent) ou sans décor (plus rapide), de 10 à 30 % sur Terre.
`renderer.kernelsSettled` (et `aerialWanted`) : la suite de perf attend que le noyau soit réglé. Mesures reprises :
la marche sur-relâchée tient (la retirer : Andes +13 %, Tarifa +7 %, Alpes neutre). Yosemite garde un biais de
+10 ms sur toute variante réglée (non expliqué) : ses A/B par `tune` ne sont pas fiables. Les Alpes en cockpit varient
d'un passage à l'autre (20 à 34 ms : le temps réel chargé à l'heure du test).

### Où en est chaque scène (×4, 1600×1000, kerr-mini)

| Scène | trace au départ | trace maintenant |
|---|---|---|
| Kerr a=0,94 par la tranche | 12,7 | **10,1 ms** |
| Disque volumétrique + jet | 32,6 | 32,9 ms |
| Interstellar (le passage du film) | 43,3 | **34,6 ms** |
| Saturne à contre-jour | 137,9 | **54,9 ms** |
| Miller : Gargantua sur la mer | 122,3 | 124,9 ms |
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
2. **Les corps de Gargantua testés à chaque pas** (Miller, Saturne) — P2.
3. **La netteté en mouvement rapide** (l'historique gardé floute un peu le premier plan en virage serré) — P3.
4. **L'ombrage du sol** (−20 à −34 % si plat) : ce qui y coûte reste à décomposer (normales, ombres, textures).
5. Les pas géodésiques du ciel lointain : ≈ 11 par rayon déjà ; la LUT du champ lointain n'aide pas au-delà de blocs
   de 2 (audit O1).
