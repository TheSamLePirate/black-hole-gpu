# J0 — la boucle CPU par fonction, kerr-mini (14 novembre 2026, ~01:54 UTC)

**Nature** : mesure datée (§8.3, le budget CPU de la boucle : 95ᵉ centile ≤ 4 ms ; mesuré 8,5 ms le 13 nov., 9,0 ms ce jour). Outil :
`j0-reference` `J0_PHASES=flight J0_CPU_PROFILE=1` — le profileur CPU de Chrome (CDP, échantillon 0,2 ms) sur la seconde moitié du vol J0
(~35 s), lu par `tests/e2e/lib/cpu-profile.ts` `longRuns` (les tranches de script continu ≥ 4 ms). Profil brut : `flight-second-half.cpuprofile`
(remote-results, non commité). Les noms minifiés retrouvés dans le bundle de production local (mêmes sources).

## Ce qui a été mesuré

- **566 tranches ≥ 4 ms en ~35 s** (≈ une par image à 17 images/s), **4 207 ms au total** (≈ 7 ms de script par image), les plus longues 17–25 ms.
- Dans ces tranches, le temps (appels compris) :

| Poste | ms (35 s) | ≈ par image | Ce que c'est |
|---|---:|---:|---|
| `renderer.frame` | 1 590 | 2,7 | dont `writeParams` 572 (tuiles `request` 98, `top` 60, les corps `sP`/`aG` — positions corrigées du temps de lumière — 96, l'éclairement incident 21), `dispatchTrace` 422, `encodeTerrainRasterVisibility` 284 (`drawRing` 162), `encodePost` 273, `encodeShipNow` 186 |
| le pas de la caméra et du vol (`step` → `advance`) | 911 | 1,5 | `fallStep` 206, le radar 114, la source AIS du radar et les navires (`seaNow`, mis en cache par image) 109, le contact au sol 52 |
| le HUD (`update` → `drawHud`) | 807 | 1,4 | `drawSymbology` (le HUD du F-35) 578 — réparti sur ses dessins, sans point chaud |
| la publication des tuiles (`publish`, `drain`) | ≈ 350 | 0,6 | |

## Lecture

Pas de point chaud unique : ≈ 7 ms par image répartis en postes de 0,2 à 2,7 ms. Les 4 ms du 95ᵉ centile demandent plusieurs lots (le HUD
moins souvent redessiné qu'à chaque image — une question de fraîcheur des instruments, à décider —, le renderer préparant moins chaque image,
du travail vers des workers), pas un correctif. **Non mesuré** : le M1 Max ; la première moitié du vol (le virage).

## Premier lot (~02:10 UTC) : les anneaux du raster

\`drawRing\` reconstruisait à chaque pas de fenêtre le maillage d'un anneau : ses sommets (la grille du niveau, la même pour toute fenêtre)
réécrits, ses triangles filtrés coin par coin, un tableau neuf de 1,5 Mo. Maintenant : les sommets écrits seulement quand le niveau change,
le filtrage sur les boîtes des triangles calculées une fois par grille (\`ringCut\`, le même ensemble — \`tests/terrain-ring-cut.test.ts\`, 64 découpes),
un tableau de travail réutilisé. **Mesuré** (compteur \`terrainRasterStats.ringBuilds\`, vol J0, kerr-mini, un passage par variante) : 283
reconstructions (la découpe change à chaque pas : aucune évitée), sommets écrits 6 fois au lieu de 99, **temps 393–425 → 326 ms** (−20 à −25 %,
≈ 0,1 ms par image en moyenne). La boucle p95 9,0–9,1 → 8,6–8,9 ms : **dans le bruit**, non revendiquée. Reste par reconstruction ≈ 1,15 ms
(la copie de 1,5 Mo d'indices vers le GPU, le filtrage).

## Deuxième lot (~02:43 UTC) : le ciel de TARS une fois par seconde

Le relevé des allocations (`J0_ALLOC_PROFILE=1` : HeapProfiler échantillonné, objets ramassés compris — **145 Mo/s alloués** en vol) a montré
32 Mo/s dans la réfraction par couches (`apparentElevation` → `refraction` → `bendingUp`, 60 × 4 000 pas, un tableau par pas) ; le profil CPU,
`apparentElevation` 224 ms en 35 s. Son appelant : le guetteur d'événements de TARS (`main.ts`, une fois par seconde) qui lisait
`camera.skyInfo()` **pour la seule phase d'une éclipse** — le rapport de réfraction complet calculé, ~7,5 ms, puis jeté. Maintenant
`skyInfo({ layered: false })` (`skyNow` sans ce rapport) ; la télémétrie de TARS le garde quand elle le demande. **Mesuré** (vol J0, kerr-mini, un
passage) : `apparentElevation` absent des tranches longues ; leur total 4 207–4 345 → 4 018 ms ; la boucle p95 8,4 ms (8,6–9,1 avant — un passage,
dans le bruit mais du bon côté, le mécanisme établi). Tests du ciel et de la réfraction 20/20.

Reste dans les allocations : les hauteurs du sol (`heightAt`, `refine`), `calibrationReady` (un accesseur, 2 Mo/s), les corps (`seenFrom`).

## Troisième lot (~02:47 UTC) : `earthSettled` sans compter les tuiles

`renderer.earthSettled` (lu par le gouverneur, `calibrationReady`, plusieurs fois par image) demandait `earthTiles.pending` — le compte entier,
une clé texte bâtie pour chaque tuile voulue (71 ms sur 35 s, 2 Mo/s alloués). Maintenant `earthTiles.anyPending`, arrêté à la première tuile
manquante (le même booléen : assertions `anyPending === pending > 0` ajoutées aux tests des tuiles, 22/22). **Mesuré** (vol J0, kerr-mini,
`J0_ALLOC_PROFILE`) : allocations **145 → 110 Mo/s** avec le lot précédent (la réfraction de TARS), `calibrationReady` absent du relevé ;
boucle p95 8,9 ms dans ce passage (8,4–9,1 selon les passages : le bruit). Les allocations restantes sont réparties (≤ 3 Mo/s chacune : la
navigation dans le système de Gargantua, les hauteurs du sol, les corps).

## Quatrième lot (~03:07 UTC) : l'agrandissement des tuiles de relief au-delà de z 15

Au temps propre, le profil J0 nomme `enlarge` (`earth-tiles.ts` : une tuile z 16–17 tirée de son parent z 15 de Terrarium, bilinéaire, sur le
fil de la page) : 172 ms en 35 s. Chaque pixel recalculait la source et le poids de sa colonne et de sa ligne ; ils sont maintenant calculés une
fois par colonne et par ligne — **les mêmes flottants au bit près** (`tests/earth-tiles-enlarge.test.ts`, 25 cas contre l'ancien calcul).
**Mesuré** : 0,276 → 0,172 ms par tuile (Bun, M1 Max, micro-banc ; ×1,6) ; dans le jeu, ≈ 0,1 ms par image au mieux — non mesuré en vol.
Restent au temps propre : la conversion géodésique (`cartToGeodetic`, 191 ms — itérative, ses résultats tenus exacts : pas touchée), le dessin du
HUD (texte, traits), les éphémérides.

## Où s'arrêter (~03:08 UTC) — règle 1

Après les quatre lots, chaque poste restant identifié rend **≤ 0,1–0,2 ms par image** : la mesure des panneaux du HUD (`hud/layout.ts`
`panels`, déjà en cache 250 ms, ~1,6 ms quatre fois par seconde : `getBoundingClientRect` et styles calculés), la conversion géodésique
(`cartToGeodetic`, itérative, exacte), les éphémérides (`solarState` deux fois par corps et par image pour le temps de lumière), le décor de la
navigation dans le système de Gargantua (`as`, ~3 Mo/s alloués), la publication des tuiles (budgétée par J2). **Règle 1** : un lot plafonné sous
1 ms ne s'ouvre pas pour la cadence — ces postes ne se traitent qu'ensemble, par un chantier de fond (le renderer préparant moins chaque
image, du travail vers des workers) ou par une décision de Sam sur la fraîcheur du HUD (redessiné moins souvent : ≈ 1,4 ms par image en jeu).

## Le chantier de fond le plus gros sans décision : le HUD dans un worker (étude, ~03:14 UTC — rien de fait)

Le HUD coûte ≈ 1,4 ms par image sur le fil de la page (le HUD du F-35, `drawSymbology`, ≈ 1,0 ms ; les écrans du cockpit — `portal`, `tsd` —
≈ 0,25 ms). Le dessiner dans un worker sur un `OffscreenCanvas` ne change ni l'image ni la fraîcheur des instruments (toujours à chaque image) :
c'est le lot de fond sans décision qui rendrait le plus. **Ce qu'il faut** (lu dans le code, 14 nov.) : `src/ui/hud/symbology.ts`, 3 522 lignes,
et ses modules (`jethud`, `kindhud`, `radar/symbols`, `world/runwaydraw`, `hudkit`) dans le worker ; envoyer à chaque image ses données
(`SymFrame` : réglages, `SymInfo`, la vue du futur, la piste, la densité — des objets à rendre clonables) ; lui donner ce qu'il lit sur la page :
les boîtes des panneaux (`hud/layout.ts` `panels`, mesurées dans le DOM — à envoyer quand elles changent), les pistes proches
(`world/runways.ts` `fieldsNearCached` — leurs données chargées sur la page), la langue (`i18n`), l'horloge du clignotement ; reprendre ce qu'il
rend à la page : les cibles cliquables (`hudHits`), les boîtes dessinées (`layout.drawn`, que l'e2e « rien ne se recouvre » lit) ; remplacer son
`document.createElement("canvas")` (l'image du relief) par un `OffscreenCanvas`. **Risque** : une image de retard du HUD sur la scène si la
synchronisation est mal faite — à mesurer (l'âge des instruments, la sonde de J3-0) avant et après. **Plafond** (règle 1) : ≈ 1,4 ms par image de la
boucle sur kerr-mini.

