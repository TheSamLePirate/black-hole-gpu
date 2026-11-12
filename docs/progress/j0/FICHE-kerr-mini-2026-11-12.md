# J0 — fiche mini-de-olivier, 2026-11-12

Scène `toulon-hyeres-v1` ([contrat](../../J0-CONTRAT.md)) · commit `a6ab487c` · sortie 1920×1080 · lancé 2026-11-12T09:37:31.040Z · source `docs/progress/j0/j0-kerr-mini-2026-11-12.json` (écrite par `scripts/j0-fiche.ts`).
> **Séance complète après J1-5, le rejet (b), J1-6 et le premier retrait de J1-7** (kerr-mini, plein écran ; l'arbre de a6ab487c
> **avec le travail non commité de la session des bâtiments en forward**, son levier `buildingsForward` éteint par défaut) :
> - **Vol frais** : 16,8 images/s, GPU p50 59,5 ms (le 10 au soir, [fiche](FICHE-kerr-mini-2026-11-10-mer.md) : GPU p50 61) ; soutenu
>   17,2/s, GPU p50 58,2 ms — kerr-mini ne bride pas (1 278 MHz partout).
> - **Ablations** (ΔGPU p50) : nuages −5,8 ms, appareil −3,8 (depuis J1-5, sa composition dans la scène et sa passe de mouvement :
>   −3,7 le 10 « à recontrôler »), décor −3,7, HUD −2,4, ombre de l'appareil −1,7, matériau de l'eau −1,1.

Navigateur : Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36. Adaptateur : `"apple"`.
Réglages effectifs (profil du joueur) : `{"quality":"game","dynamicResolution":true,"earthPipeline":"raster","earthScenery":"high","earthSurface":"satellite","detailReach":"veryFar","lookProfile":"auto","realtimeSubsampling":"auto","earthRasterShading":"auto","fpsCap":0,"motionBlur":0,"dof":false}`.

## Chemin d'entrée, à froid (profil Chrome neuf)

| étape | s depuis le démarrage |
|---|---:|
| première image (`game:artemis`) | 13.6 |
| image pilotable (F-35 placé, noyau de la scène compilé) | 18.5 |
| couverture utile (relief fin, calme 3 s) | 77.3 |
| détail complet (imagerie, décor, noyaux) | 80.3 |

## Vol mesuré (70 s, temps réel, virage compris) — la machine telle que le démarrage la laisse

Thermique : au départ Nominal, GPU 1278 MHz (100 % du max), ? °C ; au milieu Nominal, GPU 1278 MHz (100 % du max), ? °C ; à la fin Nominal, GPU 1278 MHz (100 % du max), ? °C.

| mesure | valeur | palier 1 (validé) |
|---|---:|---|
| images nouvelles | 1176 (16.8/s) | 40/s |
| intervalle p50 [ms] | **60** ✗ | ≤ 25 |
| intervalle p95 [ms] | **80.3** ✗ | ≤ 25 |
| intervalle p99 [ms] | **80.9** ✗ | ≤ 37.5 |
| intervalle max [ms] | 120.6 | — |
| épisodes > 33,3 ms | 1156 (69533 ms cumulés) | datés |
| temps GPU par image p50 / p95 [ms] (`lastGpuMs`) | 59.5 / 66 | — |
| boucle CPU p50 / p95 / p99 [ms] | 2.9 / **9.5** ✗ / 12.5 | p95 ≤ 4 |
| image, tier | 1920×1080, `{"level":2,"capMpx":2.2,"label":"apple · metal-3 · 16 GB"}` | 1920×1080 |
| cap final | 340° | 340° demandé |

Première moitié (ligne droite et entrée du virage) : p50 60, p95 80.3 ms ; seconde : p50 60, p95 80.1 ms.

**Qualité effective et contexte, chaque seconde** : échelle de rendu 0.75 – 0.75 ; bloc 16 – 16 ; qualité « game » ; AGL 488 – 501 m ; tuiles de relief en attente 38 – 265 ; orthophotos en attente 2 – 32 ; compilations 0 – 0 ; tas JS 546 – 839 Mo.
Mémoire : avant Chrome 3065 Mo résidents, processus GPU 2928 Mo d'empreinte ; après Chrome 3307 Mo résidents, processus GPU 2922 Mo d'empreinte.

**Passes GPU horodatées** (une image sur 4, seconde moitié du vol ; sur Apple les passes de rendu se chevauchent — audit GP-09 — : à lire une à une, jamais additionnées) :

| passe | ms moyen |
|---|---:|
| display | 44.51 |
| ship: shading (MSAA) | 37.31 |
| ship: shadow map | 30.58 |
| ship: thrusters and plasma | 29.94 |
| ship: own mask | 27.75 |
| sea surface | 19.16 |
| earth water (raster) | 12.47 |
| earth lite (raster) | 5.38 |
| clouds (half) | 5.15 |
| earth lite: light | 4.00 |
| taau | 3.69 |
| terrain raster visibility | 2.82 |
| terrain from the Sun | 2.18 |
| sea fft | 2.12 |
| temporal | 1.73 |

## Le même vol, soutenu — après les ablations, la machine telle qu'un jeu prolongé la laisse

Thermique : au départ Nominal, GPU 1278 MHz (100 % du max), ? °C ; au milieu Nominal, GPU 1278 MHz (100 % du max), ? °C ; à la fin Nominal, GPU 1278 MHz (100 % du max), ? °C.

| mesure | valeur | palier 1 (validé) |
|---|---:|---|
| images nouvelles | 1201 (17.2/s) | 40/s |
| intervalle p50 [ms] | **60** ✗ | ≤ 25 |
| intervalle p95 [ms] | **80** ✗ | ≤ 25 |
| intervalle p99 [ms] | **80.9** ✗ | ≤ 37.5 |
| intervalle max [ms] | 100.2 | — |
| épisodes > 33,3 ms | 1178 (69497 ms cumulés) | datés |
| temps GPU par image p50 / p95 [ms] (`lastGpuMs`) | 58.2 / 65 | — |
| boucle CPU p50 / p95 / p99 [ms] | 2.7 / **9.6** ✗ / 13.6 | p95 ≤ 4 |
| image, tier | 1920×1080, `{"level":2,"capMpx":2.2,"label":"apple · metal-3 · 16 GB"}` | 1920×1080 |
| cap final | 340° | 340° demandé |

Première moitié (ligne droite et entrée du virage) : p50 60, p95 80 ms ; seconde : p50 60, p95 80.1 ms.

**Qualité effective et contexte, chaque seconde** : échelle de rendu 0.75 – 0.75 ; bloc 16 – 16 ; qualité « game » ; AGL 489 – 501 m ; tuiles de relief en attente 0 – 19 ; orthophotos en attente 0 – 9 ; compilations 0 – 0 ; tas JS 740 – 893 Mo.
Mémoire : avant Chrome 2543 Mo résidents, processus GPU 2931 Mo d'empreinte ; après Chrome 2642 Mo résidents, processus GPU 2941 Mo d'empreinte.

**Passes GPU horodatées** (une image sur 4, seconde moitié du vol ; sur Apple les passes de rendu se chevauchent — audit GP-09 — : à lire une à une, jamais additionnées) :

| passe | ms moyen |
|---|---:|
| display | 41.91 |
| ship: shading (MSAA) | 34.55 |
| ship: thrusters and plasma | 31.82 |
| ship: shadow map | 27.75 |
| ship: own mask | 22.76 |
| sea surface | 19.51 |
| earth water (raster) | 12.59 |
| earth lite (raster) | 5.70 |
| clouds (half) | 5.12 |
| earth lite: light | 4.16 |
| taau | 3.66 |
| terrain raster visibility | 2.98 |
| terrain from the Sun | 2.23 |
| sea fft | 1.97 |
| earth horizons | 1.75 |

## Mémoire et thermique de la séance

- Thermique au lancement : Nominal, GPU 714 MHz (56 % du max), ? °C ; à la fin : Nominal, GPU 1278 MHz (100 % du max), ? °C.

## La frame par poste : ablations sur images terminées (20 s chacune, même instantané)

Référence moyenne des deux vols de base : p50 60.0 ms, p95 79.7 ms (dérive entre eux : 0.0 ms au p50).

| ordre | poste retiré | images/s | Δ images/s | GPU p50 [ms] | ΔGPU | p50 [ms] | Δp50 | p95 [ms] | Δp95 | CPU p95 | GPU MHz | compil. |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| 0 | référence | 16.6 |  | 60.3 |  | 60 |  | 80.2 |  | 10.3 | 1278→1278 | 0 |
| 1 | sans nuages | 18.9 | +1.8 | 53 | -5.8 | 59.5 | -0.5 | 61 | -18.7 | 10.4 | 1278→1278 | 0 |
| 2 | sans décor (bâtiments, arbres) | 18 | +0.9 | 55.1 | -3.7 | 59.9 | -0.1 | 80.1 | +0.4 | 8.6 | 1278→1278 | 0 |
| 3 | sans matériau de l'eau | 17.4 | +0.3 | 57.7 | -1.1 | 60 | +0.0 | 80 | +0.3 | 9.6 | 1278→1278 | 0 |
| 4 | sans HUD ni écrans d'interface | 17.7 | +0.6 | 56.4 | -2.4 | 60 | +0.0 | 61 | -18.7 | 8.9 | 1278→1278 | 0 |
| 5 | sans dessin de l'appareil (debugSkipShip ; son masque reste) ¹ | 18.2 | +1.1 | 55 | -3.8 | 59.8 | -0.2 | 79.8 | +0.1 | 8.9 | 1278→1278 | 0 |
| 6 | sans carte d'ombre de l'appareil | 17.4 | +0.3 | 57.1 | -1.7 | 59.9 | -0.1 | 79.8 | +0.1 | 9.9 | 1278→1278 | 0 |
| 7 | référence | 17.5 |  | 57.4 |  | 60 |  | 79.2 |  | 9.5 | 1278→1278 | 0 |

¹ `debugSkipShip` saute le dessin de l'appareil mais garde le masque du cockpit : l'image y garde un cockpit ancien et le sol n'y est pas ombré — le coût du dessin, pas celui de la surface qu'il cache.

Un Δ négatif en temps (positif en images/s) est ce que le poste coûte dans cette scène ; les postes ne s'additionnent pas (contrat §5). Sur un écran à 50 Hz (kerr-mini), l'intervalle se quantifie par pas de 20 ms : y lire ΔGPU et Δ images/s plutôt que Δp50.

