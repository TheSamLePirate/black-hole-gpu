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

## Ce que disent les vues coût

- **Le trou noir** : la boucle principale (les pas géodésiques) — ≈ 150 pas par rayon sur le disque, ≈ 500 au bord de
  l'ombre ; mais aussi **40 à 150 pas pour les rayons du ciel lointain**, à peine déviés, qui sont la plus grande part
  de l'image ; l'axe de rotation (la singularité des coordonnées) 3 à 5 fois plus. Un pas coûte déjà ≈ 3,6 ns : il faut
  moins de pas, ou moins de rayons.
- **La Terre en vol bas** : ≈ 150 lectures de hauteur par rayon au sol, 40 pas d'ombre du relief, 32 pas d'air sur
  chaque pixel.

## À mesurer, puis à faire (par gain attendu)

1. **Garder l'historique temporel en vol** — aujourd'hui jeté dès que le sol bouge d'un demi-pixel (`taParallaxPx`) :
   en vol bas, à chaque image ; l'image n'est que les rayons de l'image courante. Le shader reprojette déjà par la
   profondeur (le sol rigide, la profondeur la plus proche, l'écrêtage de Salvi). Mesure : `flight-quality`.
2. **Les pas géodésiques du ciel lointain** — la tolérance, les contraintes de pas hors du disque.
3. **L'air par une table** (perspective aérienne précalculée) au lieu de 32 pas par pixel — `tune` TUNE_AIR_N d'abord.
4. **La marche du terrain** : sauter le vide par une pyramide de hauteurs max (comme la Lune, `demTop`), ou un premier
   passage rasterisé.
5. **Les planètes lourdes** (Saturne, Miller, Yosemite) : leurs vues coût.
