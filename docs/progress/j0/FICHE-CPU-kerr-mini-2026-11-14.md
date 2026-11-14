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
