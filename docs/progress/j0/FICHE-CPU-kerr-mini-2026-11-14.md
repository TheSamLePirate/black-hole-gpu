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

