# J0 — fiche kerr-mini, 2026-11-10

Scène `toulon-hyeres-v1` ([contrat](../../J0-CONTRAT.md)) · commit `510bb87f` · sortie 1920×1080 · lancé 2026-11-10T17:11:50.859Z · source `docs/progress/j0/j0-kerr-mini-2026-11-10-mer-2.json` (écrite par `scripts/j0-fiche.ts`).

> **Vol seul, après la mer WebGPU** (PLAN-MER-WEBGPU S1–S5, commits `22b97bd9` → `510bb87f`) : deux passages le 10 novembre au
> soir, `J0_PHASES=flight` — pas d'ablations ni de vol soutenu ici (ceux de la [fiche du matin](FICHE-kerr-mini-2026-11-10.md)
> restent la dernière mesure). Les chiffres ci-dessous sont ceux du **second** passage (`j0-kerr-mini-2026-11-10-mer-2.json`) ;
> le premier (`…-mer.json`) : GPU p50 / p95 60,9 / 68,0 ms, 16,4 images/s.
>
> | | matin (`5aeec7b0`) | soir (`510bb87f`) |
> |---|---:|---:|
> | temps GPU par image p50 | 65,4 / 64,2 ms | **60,9 / 60,7 ms** |
> | images nouvelles par seconde | 15,2 / 15,5 | **16,4 / 16,4** |
> | `earth lite (raster)` | 17,5 ms | 12,1 ms (l'eau sort de `shadeLite`) |
> | `earth water` (+ `open`) | 12,7 ms | 12,4 + 2,1 ms |
> | `sea fft` | 1,6 ms | 2,1 ms (4 cascades, écume monde) |
>
> **Chemin d'entrée** : le premier passage, sources neuves, a mis 33,3 s à la première image et 60,8 s à l'image pilotable — le
> cache des shaders de Metal (système, hors du profil Chrome) ne les avait pas ; le second, cache chaud, 12,2 / 16,9 s comme le
> matin (12,8 / 17). Le froid du matin n'est pas connu : la comparaison à froid reste à faire.

Navigateur : Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36. Adaptateur : `"apple"`.
Réglages effectifs (profil du joueur) : `{"quality":"game","dynamicResolution":true,"earthPipeline":"raster","earthScenery":"high","earthSurface":"satellite","detailReach":"veryFar","lookProfile":"auto","realtimeSubsampling":"auto","earthRasterShading":"auto","fpsCap":0,"motionBlur":0,"dof":false}`.

## Chemin d'entrée, à froid (profil Chrome neuf)

| étape | s depuis le démarrage |
|---|---:|
| première image (`game:artemis`) | 12.2 |
| image pilotable (F-35 placé, noyau de la scène compilé) | 16.9 |
| couverture utile (relief fin, calme 3 s) | 59.8 |
| détail complet (imagerie, décor, noyaux) | 62.8 |

## Vol mesuré (70 s, temps réel, virage compris) — la machine telle que le démarrage la laisse

Thermique : au départ Nominal, GPU 1278 MHz (100 % du max), ? °C ; au milieu Nominal, GPU 1278 MHz (100 % du max), ? °C ; à la fin Nominal, GPU 1278 MHz (100 % du max), ? °C.

| mesure | valeur | palier 1 (validé) |
|---|---:|---|
| images nouvelles | 1148 (16.4/s) | 40/s |
| intervalle p50 [ms] | **60** ✗ | ≤ 25 |
| intervalle p95 [ms] | **80.5** ✗ | ≤ 25 |
| intervalle p99 [ms] | **81** ✗ | ≤ 37.5 |
| intervalle max [ms] | 140 | — |
| épisodes > 33,3 ms | 1142 (69874 ms cumulés) | datés |
| temps GPU par image p50 / p95 [ms] (`lastGpuMs`) | 60.7 / 67.7 | — |
| boucle CPU p50 / p95 / p99 [ms] | 3 / **9.5** ✗ / 13 | p95 ≤ 4 |
| image, tier | 1920×1080, `{"level":2,"capMpx":2.2,"label":"apple · metal-3 · 16 GB"}` | 1920×1080 |
| cap final | 340° | 340° demandé |

Première moitié (ligne droite et entrée du virage) : p50 60, p95 80.6 ms ; seconde : p50 60, p95 80.4 ms.

**Qualité effective et contexte, chaque seconde** : échelle de rendu 0.75 – 0.75 ; bloc 16 – 16 ; qualité « game » ; AGL 489 – 501 m ; tuiles de relief en attente 38 – 266 ; orthophotos en attente 4 – 36 ; compilations 0 – 0 ; tas JS 545 – 859 Mo.
Mémoire : avant Chrome 3071 Mo résidents, processus GPU 2648 Mo d'empreinte ; après Chrome 3225 Mo résidents, processus GPU 2662 Mo d'empreinte.

**Passes GPU horodatées** (une image sur 4, seconde moitié du vol ; sur Apple les passes de rendu se chevauchent — audit GP-09 — : à lire une à une, jamais additionnées) :

| passe | ms moyen |
|---|---:|
| display | 46.42 |
| ship: shading (MSAA) | 45.11 |
| ship: own mask | 35.20 |
| ship: shadow map | 33.19 |
| sea surface | 21.87 |
| ship: thrusters and plasma | 21.67 |
| earth lite (raster) | 12.86 |
| earth water (raster) | 12.75 |
| clouds (half) | 5.14 |
| taau | 3.33 |
| terrain raster visibility | 2.44 |
| sea fft | 2.14 |
| terrain from the Sun | 2.07 |
| earth water open (raster) | 2.06 |
| earth horizons | 1.75 |

## Mémoire et thermique de la séance

- Thermique au lancement : Nominal, GPU 0 MHz (0 % du max), ? °C ; à la fin : Nominal, GPU 1278 MHz (100 % du max), ? °C.

