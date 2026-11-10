# J0 — fiche m1max, 2026-11-10

Scène `toulon-hyeres-v1` ([contrat](../../J0-CONTRAT.md)) · commit `f0f24c9e` · sortie 1920×1080 · lancé 2026-11-10T17:17:00.638Z · source `docs/progress/j0/j0-m1max-2026-11-10-mer.json` (écrite par `scripts/j0-fiche.ts`).

> **Vol seul, après la mer WebGPU** (commit `f0f24c9e`, ce Mac en fenêtre visible, frais : 95,7 °C au départ, Nominal → Moderate),
> un passage, `J0_PHASES=flight` ; ablations et vol soutenu : [fiche du matin](FICHE-m1max-2026-11-10.md). Image 1800 × 1169 (la
> fenêtre visible ; 2,10 Mpx contre 2,07 le matin).
>
> | | matin (`5aeec7b0`, frais) | soir (`f0f24c9e`, frais) |
> |---|---:|---:|
> | images nouvelles par seconde | 36,8 | **42,5** |
> | intervalle p50 / p95 / p99 | 25,1 / 34 / 50 ms | **24,9** / 33,3 / 49,6 ms |
> | temps GPU par image p50 | 26,3 ms | **23,0 ms** |
> | boucle CPU p95 | 6,4 ms | 5,8 ms |
>
> **Le palier 1 est tenu en médiane** (24,9 ms ≤ 25), pas en régularité (p95 33,3, p99 49,6) ni en CPU (p95 5,8 > 4), et seulement
> frais : le bridage thermique du M1 Max (fiche du matin, vol soutenu) reste à remesurer. Chemin d'entrée à froid (sources neuves,
> cache Metal vide) : 27,3 / 79,4 s ; le matin, cache chaud, 8,3 / 11,3 s — pas comparables.

Navigateur : Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36. Adaptateur : `"apple"`.
Réglages effectifs (profil du joueur) : `{"quality":"game","dynamicResolution":true,"earthPipeline":"raster","earthScenery":"high","earthSurface":"satellite","detailReach":"veryFar","lookProfile":"auto","realtimeSubsampling":"auto","earthRasterShading":"auto","fpsCap":0,"motionBlur":0,"dof":false}`.

## Chemin d'entrée, à froid (profil Chrome neuf)

| étape | s depuis le démarrage |
|---|---:|
| première image (`game:artemis`) | 27.3 |
| image pilotable (F-35 placé, noyau de la scène compilé) | 79.4 |
| couverture utile (relief fin, calme 3 s) | 86.3 |
| détail complet (imagerie, décor, noyaux) | 89.3 |

## Vol mesuré (70 s, temps réel, virage compris) — la machine telle que le démarrage la laisse

Thermique : au départ Nominal, GPU 1296 MHz (100 % du max), 95.7 °C ; au milieu Nominal, GPU 1245 MHz (96 % du max), 97 °C ; à la fin Moderate, GPU 1180 MHz (91 % du max), 96.8 °C.

| mesure | valeur | palier 1 (validé) |
|---|---:|---|
| images nouvelles | 2974 (42.5/s) | 40/s |
| intervalle p50 [ms] | 24.9 ✓ | ≤ 25 |
| intervalle p95 [ms] | **33.3** ✗ | ≤ 25 |
| intervalle p99 [ms] | **49.6** ✗ | ≤ 37.5 |
| intervalle max [ms] | 51.4 | — |
| épisodes > 33,3 ms | 161 (6260 ms cumulés) | datés |
| temps GPU par image p50 / p95 [ms] (`lastGpuMs`) | 23 / 26.2 | — |
| boucle CPU p50 / p95 / p99 [ms] | 3 / **5.8** ✗ / 7.9 | p95 ≤ 4 |
| image, tier | 1800×1169, `{"level":2,"capMpx":2.2,"label":"apple · metal-3 · 32 GB"}` | 1920×1080 |
| cap final | 340° | 340° demandé |

Première moitié (ligne droite et entrée du virage) : p50 24.9, p95 33.3 ms ; seconde : p50 24.9, p95 33.4 ms.

**Qualité effective et contexte, chaque seconde** : échelle de rendu 0.75 – 0.75 ; bloc 16 – 16 ; qualité « game » ; AGL 487 – 501 m ; tuiles de relief en attente 1 – 157 ; orthophotos en attente 0 – 8 ; compilations 0 – 0 ; tas JS 744 – 968 Mo.
Mémoire : avant Chrome 3592 Mo résidents, processus GPU 2916 Mo d'empreinte ; après Chrome 3995 Mo résidents, processus GPU 2965 Mo d'empreinte.

**Passes GPU horodatées** (une image sur 4, seconde moitié du vol ; sur Apple les passes de rendu se chevauchent — audit GP-09 — : à lire une à une, jamais additionnées) :

| passe | ms moyen |
|---|---:|
| display | 18.11 |
| ship: shading (MSAA) | 17.38 |
| ship: shadow map | 13.30 |
| ship: thrusters and plasma | 10.97 |
| sea surface | 8.97 |
| ship: own mask | 7.36 |
| earth lite (raster) | 4.95 |
| earth water (raster) | 4.18 |
| clouds (half) | 1.90 |
| earth horizons | 1.52 |
| trace | 1.18 |
| taau | 1.03 |
| terrain raster visibility | 0.93 |
| terrain from the Sun | 0.85 |
| earth water open (raster) | 0.75 |

## Mémoire et thermique de la séance

- Thermique au lancement : Nominal, GPU 412 MHz (32 % du max), 60.3 °C ; à la fin : Moderate, GPU 1180 MHz (91 % du max), 96.8 °C.

