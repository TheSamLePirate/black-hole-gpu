# J0 — fiche kerr-mini, 2026-11-10

Scène `toulon-hyeres-v1` ([contrat](../../J0-CONTRAT.md)) · commit `6e7c06a1` · sortie 1920×1080 · lancé 2026-11-10T18:53:47.296Z · source `docs/progress/j0/j0-kerr-mini-2026-11-10-mer-ablations.json` (écrite par `scripts/j0-fiche.ts`).

> **Ablations seules, après la mer WebGPU** (commit `6e7c06a1`, kerr-mini 1 278 MHz stables, `J0_PHASES=ablate`). La base a dérivé
> de 63,9 à 60,7 ms au fil du passage ; contre sa moyenne (62,3) : nuages −6,2 ms, dessin de l'appareil −3,7, décor −2,6, HUD et
> écrans −1,6, ombre de l'appareil −1,5, matériau de l'eau −0,5 — à ±1,6 ms près. Le matin (fiche du matin) : nuages −5,8, décor
> −3,8, HUD −1,4, ombre −0,7, appareil −0,25, eau 0. L'écart de l'appareil (−0,25 → −3,7) est à recontrôler avant d'en tirer quoi
> que ce soit.

Navigateur : Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36. Adaptateur : `"apple"`.
Réglages effectifs (profil du joueur) : `{"quality":"game","dynamicResolution":true,"earthPipeline":"raster","earthScenery":"high","earthSurface":"satellite","detailReach":"veryFar","lookProfile":"auto","realtimeSubsampling":"auto","earthRasterShading":"auto","fpsCap":0,"motionBlur":0,"dof":false}`.

## Chemin d'entrée, à froid (profil Chrome neuf)

| étape | s depuis le démarrage |
|---|---:|
| première image (`game:artemis`) | 13 |
| image pilotable (F-35 placé, noyau de la scène compilé) | 17.4 |
| couverture utile (relief fin, calme 3 s) | 94.5 |
| détail complet (imagerie, décor, noyaux) | 97.5 |

## Mémoire et thermique de la séance

- Thermique au lancement : Nominal, GPU 0 MHz (0 % du max), ? °C ; à la fin : Nominal, GPU 1278 MHz (100 % du max), ? °C.

## La frame par poste : ablations sur images terminées (20 s chacune, même instantané)

Référence moyenne des deux vols de base : p50 60.0 ms, p95 80.3 ms (dérive entre eux : 0.0 ms au p50).

| ordre | poste retiré | images/s | Δ images/s | GPU p50 [ms] | ΔGPU | p50 [ms] | Δp50 | p95 [ms] | Δp95 | CPU p95 | GPU MHz | compil. |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| 0 | référence | 15.8 |  | 63.9 |  | 60 |  | 80.6 |  | 10.6 | 1278→1278 | 0 |
| 1 | sans nuages | 17.7 | +1.6 | 56.1 | -6.2 | 59.9 | -0.1 | 79.1 | -1.2 | 9.9 | 1278→1278 | 0 |
| 2 | sans décor (bâtiments, arbres) | 16.7 | +0.6 | 59.7 | -2.6 | 60 | +0.0 | 80.6 | +0.3 | 9.4 | 1278→1278 | 0 |
| 3 | sans matériau de l'eau | 16.2 | +0.1 | 61.8 | -0.5 | 60 | +0.0 | 80.1 | -0.2 | 9.6 | 1278→1278 | 0 |
| 4 | sans HUD ni écrans d'interface | 16.4 | +0.3 | 60.7 | -1.6 | 60 | +0.0 | 80.1 | -0.2 | 9.1 | 1278→1278 | 0 |
| 5 | sans dessin de l'appareil (debugSkipShip ; son masque reste) ¹ | 17 | +0.9 | 58.6 | -3.7 | 60 | +0.0 | 79.9 | -0.3 | 9.2 | 1278→1278 | 0 |
| 6 | sans carte d'ombre de l'appareil | 16.4 | +0.3 | 60.8 | -1.5 | 60 | +0.0 | 80.1 | -0.2 | 9.5 | 1278→1278 | 0 |
| 7 | référence | 16.5 |  | 60.7 |  | 60 |  | 79.9 |  | 9.6 | 1278→1278 | 0 |

¹ `debugSkipShip` saute le dessin de l'appareil mais garde le masque du cockpit : l'image y garde un cockpit ancien et le sol n'y est pas ombré — le coût du dessin, pas celui de la surface qu'il cache.

Un Δ négatif en temps (positif en images/s) est ce que le poste coûte dans cette scène ; les postes ne s'additionnent pas (contrat §5). Sur un écran à 50 Hz (kerr-mini), l'intervalle se quantifie par pas de 20 ms : y lire ΔGPU et Δ images/s plutôt que Δp50.

