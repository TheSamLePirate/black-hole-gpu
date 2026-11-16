# Fiche J8-0 — les mesures avant les bâtiments de toute la vue

Fiche de [PLAN-J8](../../PLAN-J8-BATIMENTS.md), lot J8-0. Les parties (a), (b), (d) sont tenues par la session des approches
(1feb2f7f), (c) et (e) par la session du rendu. Chaque chiffre porte sa machine, sa date, son commit et sa source.

## (a) Le recensement des bâtiments BD TOPO de la vue J0

- **Mesuré le 16 novembre 2026** (~12:40 UTC), ce Mac (MacBook Pro M1 Max), commit 16c3eabb, `bun scripts/j8-census.ts` →
  [`census-j0.json`](census-j0.json). Les tuiles z 15 de la Géoplateforme (`data.geopf.fr/tms/1.0.0/BDTOPO/15/x/y.pbf`), téléchargées
  une fois, 6 à la fois, gardées hors du dépôt (`~/.kerr-cache/bdtopo/15/`).
- **Où** : le départ de J0 (`tests/e2e/lib/j0-scene.ts` : 43,06° N 6,32° E, au-dessus de la rade d'Hyères), un disque de 30 km.
  **La vue** : ±45° autour du cap (le cockpit couvre ~90° en largeur), au départ (270°) et après le virage (340°).
- **Comptés** : les bâtiments « en service » (`bdtopoStands`, comme le worker), une seule fois chacun (`cleabs` : un bâtiment coupé par deux
  tuiles vient dans les deux). La distance est prise au centre de son premier anneau ; une tuile est rangée à l'anneau de son point le
  plus proche.

| Anneau | Tuiles (disque) | Octets (disque) | Bâtiments (disque) | Au plus par tuile | Vue 270° | Vue 340° |
|---|---:|---:|---:|---:|---:|---:|
| 0–2 km | 26 | 69 kB | 0 | 0 | 0 | 0 |
| 2–5 km | 97 | 1,2 MB | 402 | 418 | 0 | 197 |
| 5–10 km | 322 | 8,7 MB | 15 217 | 1 305 | 315 | 12 540 |
| 10–15 km | 511 | 14,3 MB | 24 536 | 2 123 | 8 374 | 13 517 |
| 15–30 km | 2 740 | 79,1 MB | 183 357 | 2 497 | 120 041 | 64 474 |
| **Total** | **3 696** | **103 MB** | **223 512** | | **128 730** | **90 728** |

- **Hauteur mesurée** : 221 699 des 223 512 ont une `hauteur` BD TOPO (99,2 %).
- **Temps** : le téléchargement complet 287 s (aucun échec, aucun 429) ; le décodage des 3 696 tuiles en `VectorTile` seul (sans
  géométrie ni toit) 1,8 s en tout sur ce Mac — **mesuré pour le décodage brut seulement** ; la préparation complète par tuile (les
  enregistrements de 48 octets) se mesure avec J8-3.

**Ce que ça dit pour J8-4** : au départ de J0, la vue regarde la rade : presque rien avant 10 km (315 bâtiments), puis la ville de Toulon et
sa périphérie au-delà (8 374 entre 10 et 15 km, 120 041 entre 15 et 30 km). Après le virage vers La Londe, il y en a dès 2 km. L'ordre de
grandeur que la couche lointaine doit tenir dans la vue est **~10⁵ bâtiments** (×48 o ≈ 6 Mio d'enregistrements pour la vue, ≈ 11 Mio
pour tout le disque — estimé à partir de ces comptes). Ce sont des comptes de la donnée : le nombre qui couvre au moins 1 pixel dépend
de la taille de chacun et se compte avec J8-4.

## (b) Le profil du worker de décor — Toulon fait ; Paris après J8-T

- **Mesuré le 16 novembre 2026** (12:29–12:37 UTC), ce Mac (M1 Max), e2e `j8-scenery-profile` → [`worker-profile.json`](worker-profile.json).
  Le thread du worker profilé par le DevTools (`tests/e2e/lib/worker-profile.ts` : attaché dès sa naissance — il est recréé après un
  placement lointain —, 250 µs), découpé par ses propres `phases`. **Actif** = script et ramasse-miettes ; **inactif** = le worker attend
  (le réseau, des minuteries). Témoins (règle 3) : une boucle de 400 ms vue 400 ms active ; une attente de 400 ms vue 0 ms active ; **A/A**
  : la même scène deux fois, 51,3 s contre 51,8 s, 25,8 s contre 26,1 s actives.
- **Le protocole** : le F-35 gelé à 500 m au-dessus de Toulon (43,124 / 5,93), une scène faite une fois (les données en mémoire), envoyé à
  33 km, ramené. La scène rapide se demande à 140 m/s (régime rapide), la complète à l'arrêt.
- **« À chaud » ne l'est pas en e2e** : le Service Worker y est coupé, et le worker **retélécharge 50 Mo** par scène complète (412 réponses ;
  22,8 Mo pour la rapide). L'inactif ci-dessous est donc surtout le réseau de cette ligne (~4,5 Mb/s) ; J8-T (le cache disque) le refera.

| Toulon, à chaud | Durée | Actif | Inactif | Phases où le temps passe |
|---|---:|---:|---:|---|
| Scène rapide | 22,7 s (A/A 24,4) | 4,3 s (19 %) | 18,3 s | attente : `turbines` 9,4 s, `before forest` 7,8 s ; calcul : `party walls` 1,5 s, `detail` 0,9 s, `osm` 0,7 s |
| Scène complète | 51,3 s (A/A 51,8) | 25,8 s (50 %) | 25,5 s | attente : `before forest` 20,8 s, `bdtopo` 2,5 s, `cover` 1,6 s ; calcul : `party walls` 9,7 s, `detail` 7,8 s, `roofs` 3,0 s, `osm` 2,2 s |

**Ce que ça dit pour J8-3 et J8-5** : la moitié d'une scène complète est du calcul que la scène refait chaque fois : les murs mitoyens, le
détail, les toits, le décodage d'OSM. C'est la cible du cache par tuile de J8-5. L'autre moitié est de l'attente réseau, que J8-T doit
mesurer à nouveau avec le cache disque. Le décodage BD TOPO lui-même est petit (`bdtopo` 0,3 s actif). Pour J8-3, la préparation d'une
cellule mesurée à part (`cell-prep`) prend 2,9 ms par tuile au médian. **Non mesuré** : kerr-mini ; Paris (après J8-T, depuis le disque).

## (c) Le coût GPU par enveloppe

**kerr-mini**, 16 nov. 2026 12:29–12:33 UTC, run `20261116-132941-j8-0c-bench`, l'arbre de 7e99623d (le banc de f5dd6428). État
thermique « Nominal » avant et après ; GPU à 1 019 puis 1 266 MHz sur 1 278. e2e `j8-envelope-bench` :

- **Vue** : Toulon depuis 12 km à l'est, 400 m, cap 272°, le temps gelé, tout chargé (32 000 bâtiments dans la scène).
- **Injection** : sur l'anneau de 2 à 15 km autour de Toulon, des boîtes orientées pleines, avec le matériau d'un vrai bâtiment.
- **Mesure** : chaque palier pendant 5 s.
- **Témoin négatif (A/A)** : 0 enveloppe au début et à la fin, **49,0 et 49,7 ms**. Dérive de 0,7 ms.
- **Témoin positif** : la charge injectée elle-même ; à 512 k elle est vue (+7,2 ms).

| Injectées | Vues (tri ≥ 1 px) | GPU médian | Ajouté | p95 |
|---:|---:|---:|---:|---:|
| 0 | 0 | 49,0 ms | — | 52,1 ms |
| 32 k | 19 775 | 51,1 ms | +2,1 ms | 54,5 ms |
| 64 k | 39 347 | 51,8 ms | +2,8 ms | 54,5 ms |
| 128 k | 78 860 | 51,7 ms | +2,7 ms | 55,4 ms |
| 256 k | 157 973 | 53,6 ms | +4,6 ms | 56,9 ms |
| 512 k | 316 149 | 56,2 ms | +7,2 ms | 59,4 ms |

- **Les parts, à 512 k** : sans la visibilité **49,6 ms**, sans l'ombre **56,0 ms**, sans le tri 50,0 ms. Couper le tri coupe aussi le
  dessin, qui n'a plus d'instances. **Presque tout le coût est le dessin de visibilité** : ~6,6 ms pour 316 k boîtes vues, la plupart de
  quelques pixels. L'ombre coûte ~0,2 ms, le tri ≤ 0,6 ms. La passe « terrain raster visibility » monte de ~10 à 14,5 ms.
- **Lu avec (a)** : la vue au départ de J0 a ~129 000 bâtiments dans le champ, pour la plupart à 15–30 km. C'est entre les paliers
  128 k et 256 k (79 k à 158 k vues), soit **~+3 à +4,5 ms sur le mini pour des boîtes naïves**. **C'est au-dessus du seuil de 3 ms de
  la question 1 : retour à Sam avant J8-4.**
- **Ce que le banc ne dit pas encore** :
  - le coût de boîtes plus légères pour les bâtiments minuscules au loin (un point ou un quad au-dessous de quelques pixels, des
    maillages fusionnés par cellule) ;
  - l'effet d'un tri au critère de taille plus fort.

  Ce sont les leviers à essayer avant d'accepter un coût.
- **Le second passage, avec l'allègement** (kerr-mini, 16 nov. 2026 ~13:58–14:01 UTC, run `20261116-145728-j8-0c-bench-lod`, 9afd6473) :
  les enveloppes projetées sous 4 ou 8 px y sont dessinées en un quad face à la caméra (6 sommets) au lieu d'une boîte (36), à
  enveloppes vues égales.
  - **Témoin négatif (A/A)** : 49,6 et 48,6 ms. **Le bruit de cette mesure est de l'ordre de 1 à 2 ms** : à 256 k, les boîtes donnent
    +4,6 ms au premier passage et +2,1 au second.

  | Injectées | Vues | Boîtes | Quads sous 4 px (part en quads) | Quads sous 8 px (part en quads) |
  |---:|---:|---:|---:|---:|
  | 128 k | 78 860 | +2,4 ms | +1,9 ms (88 %) | +1,7 ms (97 %) |
  | 512 k | 316 149 | +5,6 ms | +4,4 ms (88 %) | +3,5 ms (97 %) |

  - **Ce qu'on en tire** : l'allègement retire ~0,7 ms à 128 k et ~2 ms à 512 k. La vue J0 passerait d'environ +2,5 à +4,5 ms (boîtes)
    à **environ +1,7 à +3 ms (quads sous 8 px)**, autour du seuil de 3 ms, que la mesure ne départage pas à ±1–2 ms près.
  - **Leviers non encore mesurés** : des maillages fusionnés par cellule, un point d'un pixel, un tri au pixel plus strict.
- **M1 Max** (ce Mac, 13:21–13:26 UTC) : **non valable**. La pression thermique était « Heavy », le GPU médian baissait quand la charge
  montait (23,7 ms à 0, 21,5 ms à 512 k) et le témoin positif a échoué ; la mesure est écartée (règle 3). À refaire sur une machine
  refroidie.

## (d) Le budget qui bloque — Toulon fait ; Paris après J8-T

- **Toulon** (même passage, scène complète) : **le plafond de bâtiments** coupe, ni la mémoire ni les maillages. 32 000 gardés (8 000 ×
  portée²), **70 247 coupés**, gardés jusqu'à 2 116 m ; `budgetLimited` vrai. Les postes que le worker rapporte (`bytes`) : le budget **64 Mio** (et non 48 :
  `budget` = 67 108 864), avant les bâtiments 26,0 Mio, bâtiments 11,3 Mio, forêt 13,1 Mio, raster 4,0 Mio ; maillages **11,5 Mio sur
  16**. (Leur recouvrement — « avant les bâtiments » inclut-il la forêt et le raster ? — n'est pas établi : pas de somme ici.)
- **Paris** : à mesurer depuis le disque après J8-T.

## (e) Le décor pendant J0 — `earthScenery.stats()` chaque seconde

kerr-mini, 16 nov. 2026 ~11:55 UTC, run `20261116-125132-j8-0e-j0` (l'arbre d'efcb0e99, plus l'essai J8-1 alors non commité, sans effet sur
le décor), `J0_PHASES=flight` (70 s à 140 m/s, 500 m, de 43,060/6,312 vers 43,096/6,219, le virage au 340° à 25 s).

- **Toute la durée du vol, une scène rapide** (régime > 120 m/s) : 70 relevés sur 70, `refreshing` 59 fois et `ready` 11 fois. Son
  centre reste à **moins de 0,93 km** de l'appareil.
- **Ses bâtiments** : **0** pendant 57 s, l'appareil au-dessus de la mer, puis **149** à l'approche de la côte. **Aucun de la BD TOPO** :
  `bdtopo` 0 sur tout le vol. **Arbres** : 0. **Aucun coupé** par le plafond (`cut` 0) : la scène rapide n'en a pas besoin.
- **À lire avec le recensement (a)** : dans le champ au départ, 120 041 bâtiments à 15–30 km et 8 374 à 10–15 km. La scène, elle, n'en
  porte aucun. En vol rapide, le décor ne voit donc jamais la côte que montre la vue de J0. Le plafond n'est pas en cause ici, c'est la
  portée de la scène rapide (~2,1 km). **C'est le cas que la couche lointaine (J8-4) doit couvrir.**
- **À vérifier** (non établi) : pourquoi la BD TOPO ne donne rien à l'approche de la côte. Le levé n'est peut-être pas « ign » à cet
  instant, ou la scène rapide n'a pas encore ses tuiles. J8-0 (b) le dira.
