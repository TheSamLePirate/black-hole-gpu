# J0 — fiche m1max, 2026-11-10

Scène `toulon-hyeres-v1` ([contrat](../../J0-CONTRAT.md)) · commit `e00182a2` · sortie 1920×1080 · lancé 2026-11-10T18:16:35.973Z · source `docs/progress/j0/j0-m1max-2026-11-10-mer-complet.json` (écrite par `scripts/j0-fiche.ts`).

> **Séance complète après la mer WebGPU** (commit `e00182a2`, ce Mac en fenêtre visible) : vol frais, ablations, vol soutenu.
> - **Vol frais** : 40,9 images/s, intervalle p50 25,0 ms (au seuil), p95 34, p99 50 ; GPU p50 23,5 ms — comme [le vol frais du soir](FICHE-m1max-2026-11-10-mer.md) (42,5/s).
> - **Vol soutenu** (Heavy, 934 → 838 MHz) : **31,4 images/s**, intervalle p50 33,2 ms ; le matin (Heavy, 858 → 706 MHz) 24,9/s. Les
>   fréquences diffèrent : par MHz, ≈ +9 % (31,4 / ~890 contre 24,9 / ~780) ; le reste est un M1 Max moins bridé ce soir.
> - **Ablations non exploitables** : le bridage a fait tomber le GPU jusqu'à 389 MHz pendant l'une d'elles (`gpuMHz` de chaque ligne) —
>   la répartition par poste se lit sur kerr-mini (contrat §5).

Navigateur : Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36. Adaptateur : `"apple"`.
Réglages effectifs (profil du joueur) : `{"quality":"game","dynamicResolution":true,"earthPipeline":"raster","earthScenery":"high","earthSurface":"satellite","detailReach":"veryFar","lookProfile":"auto","realtimeSubsampling":"auto","earthRasterShading":"auto","fpsCap":0,"motionBlur":0,"dof":false}`.

## Chemin d'entrée, à froid (profil Chrome neuf)

| étape | s depuis le démarrage |
|---|---:|
| première image (`game:artemis`) | 27.5 |
| image pilotable (F-35 placé, noyau de la scène compilé) | 84 |
| couverture utile (relief fin, calme 3 s) | 84 |
| détail complet (imagerie, décor, noyaux) | 87 |

## Vol mesuré (70 s, temps réel, virage compris) — la machine telle que le démarrage la laisse

Thermique : au départ Nominal, GPU 1296 MHz (100 % du max), 98.2 °C ; au milieu Moderate, GPU 1268 MHz (98 % du max), 99.2 °C ; à la fin Heavy, GPU 1269 MHz (98 % du max), 99.5 °C.

| mesure | valeur | palier 1 (validé) |
|---|---:|---|
| images nouvelles | 2861 (40.9/s) | 40/s |
| intervalle p50 [ms] | 25 ✓ | ≤ 25 |
| intervalle p95 [ms] | **34** ✗ | ≤ 25 |
| intervalle p99 [ms] | **50** ✗ | ≤ 37.5 |
| intervalle max [ms] | 59.1 | — |
| épisodes > 33,3 ms | 285 (10912 ms cumulés) | datés |
| temps GPU par image p50 / p95 [ms] (`lastGpuMs`) | 23.5 / 29.2 | — |
| boucle CPU p50 / p95 / p99 [ms] | 3 / **6.2** ✗ / 8.4 | p95 ≤ 4 |
| image, tier | 1800×1169, `{"level":2,"capMpx":2.2,"label":"apple · metal-3 · 32 GB"}` | 1920×1080 |
| cap final | 340° | 340° demandé |

Première moitié (ligne droite et entrée du virage) : p50 25, p95 33.8 ms ; seconde : p50 25, p95 34.3 ms.

**Qualité effective et contexte, chaque seconde** : échelle de rendu 0.75 – 0.75 ; bloc 16 – 16 ; qualité « game » ; AGL 487 – 501 m ; tuiles de relief en attente 1 – 155 ; orthophotos en attente 0 – 9 ; compilations 0 – 0 ; tas JS 749 – 935 Mo.
Mémoire : avant Chrome 3526 Mo résidents, processus GPU 2919 Mo d'empreinte ; après Chrome 3787 Mo résidents, processus GPU 2962 Mo d'empreinte.

**Passes GPU horodatées** (une image sur 4, seconde moitié du vol ; sur Apple les passes de rendu se chevauchent — audit GP-09 — : à lire une à une, jamais additionnées) :

| passe | ms moyen |
|---|---:|
| display | 17.33 |
| ship: shading (MSAA) | 16.77 |
| ship: shadow map | 11.84 |
| sea surface | 8.79 |
| ship: thrusters and plasma | 7.61 |
| ship: own mask | 6.35 |
| earth lite (raster) | 4.80 |
| earth water (raster) | 4.17 |
| clouds (half) | 1.87 |
| earth horizons | 1.37 |
| trace | 1.13 |
| taau | 1.02 |
| terrain raster visibility | 0.88 |
| terrain from the Sun | 0.83 |
| ship probe: trace | 0.52 |

## Le même vol, soutenu — après les ablations, la machine telle qu'un jeu prolongé la laisse

Thermique : au départ Heavy, GPU 934 MHz (72 % du max), 86.9 °C ; au milieu Heavy, GPU 902 MHz (70 % du max), 86.1 °C ; à la fin Heavy, GPU 838 MHz (65 % du max), 84.9 °C.

| mesure | valeur | palier 1 (validé) |
|---|---:|---|
| images nouvelles | 2199 (31.4/s) | 40/s |
| intervalle p50 [ms] | **33.2** ✗ | ≤ 25 |
| intervalle p95 [ms] | **41.8** ✗ | ≤ 25 |
| intervalle p99 [ms] | **58.6** ✗ | ≤ 37.5 |
| intervalle max [ms] | 74.4 | — |
| épisodes > 33,3 ms | 943 (34894 ms cumulés) | datés |
| temps GPU par image p50 / p95 [ms] (`lastGpuMs`) | 30.8 / 38 | — |
| boucle CPU p50 / p95 / p99 [ms] | 4.3 / **9.1** ✗ / 14 | p95 ≤ 4 |
| image, tier | 1800×1169, `{"level":2,"capMpx":2.2,"label":"apple · metal-3 · 32 GB"}` | 1920×1080 |
| cap final | 340° | 340° demandé |

Première moitié (ligne droite et entrée du virage) : p50 33.2, p95 41.7 ms ; seconde : p50 33.3, p95 42 ms.

**Qualité effective et contexte, chaque seconde** : échelle de rendu 0.75 – 0.75 ; bloc 16 – 16 ; qualité « game » ; AGL 486 – 501 m ; tuiles de relief en attente 0 – 15 ; orthophotos en attente 0 – 7 ; compilations 0 – 0 ; tas JS 753 – 917 Mo.
Mémoire : avant Chrome 3856 Mo résidents, processus GPU 2909 Mo d'empreinte ; après Chrome 3876 Mo résidents, processus GPU 2938 Mo d'empreinte.

**Passes GPU horodatées** (une image sur 4, seconde moitié du vol ; sur Apple les passes de rendu se chevauchent — audit GP-09 — : à lire une à une, jamais additionnées) :

| passe | ms moyen |
|---|---:|
| display | 25.40 |
| ship: shading (MSAA) | 24.79 |
| ship: shadow map | 16.58 |
| sea surface | 12.64 |
| ship: thrusters and plasma | 11.70 |
| earth lite (raster) | 7.11 |
| earth water (raster) | 6.96 |
| ship: own mask | 6.82 |
| clouds (half) | 2.64 |
| trace | 1.60 |
| taau | 1.51 |
| earth horizons | 1.50 |
| terrain raster visibility | 1.37 |
| terrain from the Sun | 1.10 |
| temporal | 0.85 |

## Mémoire et thermique de la séance

- Thermique au lancement : Nominal, GPU 540 MHz (42 % du max), 66.1 °C ; à la fin : Heavy, GPU 838 MHz (65 % du max), 84.9 °C.

## La frame par poste : ablations sur images terminées (20 s chacune, même instantané)

Référence moyenne des deux vols de base : p50 28.4 ms, p95 37.6 ms (dérive entre eux : 6.7 ms au p50).

| ordre | poste retiré | images/s | Δ images/s | GPU p50 [ms] | ΔGPU | p50 [ms] | Δp50 | p95 [ms] | Δp95 | CPU p95 | GPU MHz | compil. |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| 0 | référence | 39.4 |  | 24.7 |  | 25 |  | 33.8 |  | 6.2 | 1296→1215 ⚠ | 0 |
| 1 | sans nuages | 23 | -13.5 | 29 | +2.2 | 33.7 | +5.4 | 75 | +37.4 | 14.3 | 1295→389 ⚠ | 0 |
| 2 | sans décor (bâtiments, arbres) | 14.5 | -22.0 | 66.9 | +40.1 | 66.7 | +38.4 | 83.4 | +45.8 | 14.6 | 389→389 ⚠ | 0 |
| 3 | sans matériau de l'eau | 13.7 | -22.8 | 70.3 | +43.5 | 73.5 | +45.1 | 91.3 | +53.6 | 15.2 | 402→389 ⚠ | 0 |
| 4 | sans HUD ni écrans d'interface | 23.4 | -13.1 | 29.9 | +3.1 | 33.3 | +4.9 | 83.2 | +45.6 | 11.4 | 394→614 ⚠ | 0 |
| 5 | sans dessin de l'appareil (debugSkipShip ; son masque reste) ¹ | 35.3 | -1.3 | 27.3 | +0.5 | 25.3 | -3.1 | 40.1 | +2.5 | 6.6 | 1116→986 ⚠ | 0 |
| 6 | sans carte d'ombre de l'appareil | 33.4 | -3.1 | 29.3 | +2.5 | 32.1 | +3.8 | 40.2 | +2.6 | 7 | 1013→994 ⚠ | 0 |
| 7 | référence | 33.7 |  | 28.9 |  | 31.7 |  | 41.5 |  | 7.4 | 1039→956 ⚠ | 0 |

¹ `debugSkipShip` saute le dessin de l'appareil mais garde le masque du cockpit : l'image y garde un cockpit ancien et le sol n'y est pas ombré — le coût du dessin, pas celui de la surface qu'il cache.
**⚠ Fréquence GPU instable** (bases de 1256 et 998 MHz) : les lignes marquées ⚠ mesurent la fréquence, pas le poste — 0 ablation(s) comparable(s) sur 6. La répartition par poste se lit sur une machine à fréquence stable.

Un Δ négatif en temps (positif en images/s) est ce que le poste coûte dans cette scène ; les postes ne s'additionnent pas (contrat §5). Sur un écran à 50 Hz (kerr-mini), l'intervalle se quantifie par pas de 20 ms : y lire ΔGPU et Δ images/s plutôt que Δp50.

