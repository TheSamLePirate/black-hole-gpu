# J0 — fiche kerr-mini, 2026-11-10

Scène `toulon-hyeres-v1` ([contrat](../../J0-CONTRAT.md)) · commit `5aeec7b0` · sortie 1920×1080 · lancé 2026-11-10T10:15:51.867Z · source `docs/progress/j0/j0-kerr-mini-2026-11-10.json` (écrite par `scripts/j0-fiche.ts`).
Navigateur : Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36. Adaptateur : `"apple"`.
Réglages effectifs (profil du joueur) : `{"quality":"game","dynamicResolution":true,"earthPipeline":"raster","earthScenery":"high","earthSurface":"satellite","detailReach":"veryFar","lookProfile":"auto","realtimeSubsampling":"auto","earthRasterShading":"auto","fpsCap":0,"motionBlur":0,"dof":false}`.

## Chemin d'entrée, à froid (profil Chrome neuf)

| étape | s depuis le démarrage |
|---|---:|
| première image (`game:artemis`) | 12.8 |
| image pilotable (F-35 placé, noyau de la scène compilé) | 17 |
| couverture utile (relief fin, calme 3 s) | 104.1 |
| détail complet (imagerie, décor, noyaux) | 141.8 |

## Vol mesuré (70 s, temps réel, virage compris) — la machine telle que le démarrage la laisse

Thermique : au départ Nominal, GPU 1278 MHz (100 % du max), ? °C ; au milieu Nominal, GPU 1278 MHz (100 % du max), ? °C ; à la fin Nominal, GPU 1278 MHz (100 % du max), ? °C.

| mesure | valeur | palier 1 (validé) |
|---|---:|---|
| images nouvelles | 1068 (15.2/s) | 40/s |
| intervalle p50 [ms] | **60.1** ✗ | ≤ 25 |
| intervalle p95 [ms] | **80.8** ✗ | ≤ 25 |
| intervalle p99 [ms] | **100.1** ✗ | ≤ 37.5 |
| intervalle max [ms] | 140.5 | — |
| épisodes > 33,3 ms | 1063 (69896 ms cumulés) | datés |
| temps GPU par image p50 / p95 [ms] (`lastGpuMs`) | 65.4 / 72.2 | — |
| boucle CPU p50 / p95 / p99 [ms] | 2.8 / **9.4** ✗ / 12.8 | p95 ≤ 4 |
| image, tier | 1920×1080, `{"level":2,"capMpx":2.2,"label":"apple · metal-3 · 16 GB"}` | 1920×1080 |
| cap final | 340° | 340° demandé |

Première moitié (ligne droite et entrée du virage) : p50 60.4, p95 80.8 ms ; seconde : p50 60, p95 80.8 ms.

**Qualité effective et contexte, chaque seconde** : échelle de rendu 0.75 – 0.75 ; bloc 16 – 16 ; qualité « game » ; AGL 488 – 501 m ; tuiles de relief en attente 37 – 271 ; orthophotos en attente 0 – 24 ; compilations 0 – 0 ; tas JS 552 – 900 Mo.
Mémoire : avant Chrome 3189 Mo résidents, processus GPU 2606 Mo d'empreinte ; après Chrome 3422 Mo résidents, processus GPU 2619 Mo d'empreinte.

**Passes GPU horodatées** (une image sur 4, seconde moitié du vol ; sur Apple les passes de rendu se chevauchent — audit GP-09 — : à lire une à une, jamais additionnées) :

| passe | ms moyen |
|---|---:|
| ship: shading (MSAA) | 48.70 |
| display | 48.63 |
| ship: shadow map | 38.00 |
| ship: own mask | 37.87 |
| ship: thrusters and plasma | 36.83 |
| earth lite (raster) | 17.51 |
| earth water (raster) | 12.70 |
| clouds (half) | 5.14 |
| taau | 3.28 |
| terrain raster visibility | 2.59 |
| terrain from the Sun | 2.32 |
| sea fft | 1.63 |
| earth horizons | 1.59 |
| temporal | 1.56 |
| trace | 1.29 |

## Le même vol, soutenu — après les ablations, la machine telle qu'un jeu prolongé la laisse

Thermique : au départ Nominal, GPU 1278 MHz (100 % du max), ? °C ; au milieu Nominal, GPU 1278 MHz (100 % du max), ? °C ; à la fin Nominal, GPU 1278 MHz (100 % du max), ? °C.

| mesure | valeur | palier 1 (validé) |
|---|---:|---|
| images nouvelles | 1088 (15.5/s) | 40/s |
| intervalle p50 [ms] | **60** ✗ | ≤ 25 |
| intervalle p95 [ms] | **80.7** ✗ | ≤ 25 |
| intervalle p99 [ms] | **99.8** ✗ | ≤ 37.5 |
| intervalle max [ms] | 140.7 | — |
| épisodes > 33,3 ms | 1086 (69889 ms cumulés) | datés |
| temps GPU par image p50 / p95 [ms] (`lastGpuMs`) | 64.2 / 70.2 | — |
| boucle CPU p50 / p95 / p99 [ms] | 2.7 / **9.5** ✗ / 17.5 | p95 ≤ 4 |
| image, tier | 1920×1080, `{"level":2,"capMpx":2.2,"label":"apple · metal-3 · 16 GB"}` | 1920×1080 |
| cap final | 340° | 340° demandé |

Première moitié (ligne droite et entrée du virage) : p50 60, p95 80.9 ms ; seconde : p50 60, p95 80.5 ms.

**Qualité effective et contexte, chaque seconde** : échelle de rendu 0.75 – 0.75 ; bloc 16 – 16 ; qualité « game » ; AGL 489 – 501 m ; tuiles de relief en attente 0 – 19 ; orthophotos en attente 0 – 5 ; compilations 0 – 0 ; tas JS 738 – 910 Mo.
Mémoire : avant Chrome 2162 Mo résidents, processus GPU 2601 Mo d'empreinte ; après Chrome 2318 Mo résidents, processus GPU 2639 Mo d'empreinte.

**Passes GPU horodatées** (une image sur 4, seconde moitié du vol ; sur Apple les passes de rendu se chevauchent — audit GP-09 — : à lire une à une, jamais additionnées) :

| passe | ms moyen |
|---|---:|
| display | 49.51 |
| ship: shading (MSAA) | 48.94 |
| ship: own mask | 38.71 |
| ship: shadow map | 37.31 |
| ship: thrusters and plasma | 32.10 |
| earth lite (raster) | 17.88 |
| earth water (raster) | 13.03 |
| clouds (half) | 5.18 |
| taau | 3.31 |
| terrain raster visibility | 2.75 |
| terrain from the Sun | 2.30 |
| earth horizons | 1.75 |
| temporal | 1.58 |
| sea fft | 1.57 |
| trace | 1.29 |

## Mémoire et thermique de la séance

- Thermique au lancement : Nominal, GPU 709 MHz (55 % du max), ? °C ; à la fin : Nominal, GPU 1278 MHz (100 % du max), ? °C.

## La frame par poste : ablations sur images terminées (20 s chacune, même instantané)

Référence moyenne des deux vols de base : p50 60.4 ms, p95 80.8 ms (dérive entre eux : -0.4 ms au p50).

| ordre | poste retiré | images/s | Δ images/s | GPU p50 [ms] | ΔGPU | p50 [ms] | Δp50 | p95 [ms] | Δp95 | CPU p95 | GPU MHz | compil. |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| 0 | référence | 15 |  | 65.7 |  | 60.6 |  | 80.7 |  | 9.8 | 1278→1278 | 0 |
| 1 | sans nuages | 16.8 | +1.7 | 59.5 | -5.8 | 60 | -0.4 | 80.1 | -0.7 | 9.6 | 1278→1278 | 0 |
| 2 | sans décor (bâtiments, arbres) | 16.3 | +1.2 | 61.5 | -3.8 | 60 | -0.4 | 80.4 | -0.4 | 8.5 | 1278→1278 | 0 |
| 3 | sans matériau de l'eau | 15.2 | +0.1 | 65.2 | -0.0 | 60.1 | -0.3 | 80.5 | -0.3 | 9.6 | 1278→1278 | 0 |
| 4 | sans HUD ni écrans d'interface | 15.3 | +0.2 | 63.9 | -1.4 | 60.1 | -0.3 | 81 | +0.2 | 8.4 | 1278→1278 | 0 |
| 5 | sans appareil ni cockpit (debugSkipShip) ¹ | 15.3 | +0.2 | 65 | -0.3 | 60.1 | -0.3 | 80.5 | -0.3 | 8.8 | 1278→1278 | 0 |
| 6 | sans carte d'ombre de l'appareil | 15.4 | +0.3 | 64.6 | -0.7 | 60.1 | -0.3 | 80.8 | -0.0 | 9.5 | 1278→1278 | 0 |
| 7 | référence | 15.2 |  | 64.8 |  | 60.2 |  | 80.9 |  | 9.4 | 1278→1278 | 0 |

¹ `debugSkipShip` saute le dessin de l'appareil mais garde le masque du cockpit : l'image y garde un cockpit ancien et le sol n'y est pas ombré — le coût du dessin, pas celui de la surface qu'il cache.

Un Δ négatif en temps (positif en images/s) est ce que le poste coûte dans cette scène ; les postes ne s'additionnent pas (contrat §5). Sur un écran à 50 Hz (kerr-mini), l'intervalle se quantifie par pas de 20 ms : y lire ΔGPU et Δ images/s plutôt que Δp50.

