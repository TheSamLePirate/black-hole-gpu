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

## (b) Le profil du worker de décor — à faire

## (d) Le budget qui bloque à Paris — à faire

## (c) Le coût GPU par enveloppe — le banc écrit, pas encore tourné

Le banc (`renderer.envelopeBench`, f5dd6428) et son e2e `j8-envelope-bench` (0 → 512 k, A/A, chaque part) attendent la fin de la charge
IGN de (b). Les chiffres viendront ici, avec leur machine (kerr-mini, M1 Max), leur commit et leur état thermique.

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
