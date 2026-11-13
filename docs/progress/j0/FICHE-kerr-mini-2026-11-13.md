# J0 — fiche kerr-mini, 2026-11-13

Scène `toulon-hyeres-v1` ([contrat](../../J0-CONTRAT.md)) · commit `f6b4b20f` · sortie 1920×1080 · lancé 2026-11-13T06:50:10.329Z · source `docs/progress/j0/j0-kerr-mini-2026-11-13.json` (écrite par `scripts/j0-fiche.ts`).
> **Séance complète de sortie provisoire de J2** (PLAN-J2 J2-8 : la fiche J0 de sortie, avant les décisions de Sam sur `singleHistory`,
> `edgeFoot` et J2-4 — leviers tels qu'au commit : `earthRateOne` allumé, les autres éteints ; kerr-mini plein écran, « Nominal » partout,
> 1 278 MHz) :
> - **Chemin d'entrée à froid** : première image 8,5 s (le 12 : 13,6), pilotable 12,5 s (18,5), couverture utile **56,8 s (77,3)**, détail
>   complet 59,8 s — non attribué (J2-1, les pointes, le réseau du jour : une seule entrée).
> - **Vol frais** : 17/s, GPU p50 59,0 / p95 65,2 ms (le 12 : 59,5), intervalle p95 80,1 ms ; soutenu 17,2/s, GPU p50 58,1 ms — inchangé
>   (l'A/B des lots du même jour : ΔGPU nul, PLAN-J2 §9 decies).
> - **Ablations** (ΔGPU p50) : nuages −6,2 ms, appareil −3,2, décor −2,3, HUD −1,6, ombre de l'appareil −0,3 ; « sans matériau de l'eau » −0,7
>   **non valable** (`liteSkip = 1` perd ses bits bas dans le flottant : l'eau n'est pas coupée — PROBLEMES, 12 nov.).

Navigateur : Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36. Adaptateur : `"apple"`.
Réglages effectifs (profil du joueur) : `{"quality":"game","dynamicResolution":true,"earthPipeline":"raster","earthScenery":"high","earthSurface":"satellite","detailReach":"veryFar","lookProfile":"auto","realtimeSubsampling":"auto","earthRasterShading":"auto","fpsCap":0,"motionBlur":0,"dof":false}`.

## Chemin d'entrée, à froid (profil Chrome neuf)

| étape | s depuis le démarrage |
|---|---:|
| première image (`game:artemis`) | 8.5 |
| image pilotable (F-35 placé, noyau de la scène compilé) | 12.5 |
| couverture utile (relief fin, calme 3 s) | 56.8 |
| détail complet (imagerie, décor, noyaux) | 59.8 |

## Vol mesuré (70 s, temps réel, virage compris) — la machine telle que le démarrage la laisse

Thermique : au départ Nominal, GPU 1278 MHz (100 % du max), ? °C ; au milieu Nominal, GPU 1278 MHz (100 % du max), ? °C ; à la fin Nominal, GPU 1278 MHz (100 % du max), ? °C.

| mesure | valeur | palier 1 (validé) |
|---|---:|---|
| images nouvelles | 1188 (17/s) | 40/s |
| intervalle p50 [ms] | **60** ✗ | ≤ 25 |
| intervalle p95 [ms] | **80.1** ✗ | ≤ 25 |
| intervalle p99 [ms] | **81** ✗ | ≤ 37.5 |
| intervalle max [ms] | 100.5 | — |
| épisodes > 33,3 ms | 1169 (69621 ms cumulés) | datés |
| temps GPU par image p50 / p95 [ms] (`lastGpuMs`) | 59 / 65.2 | — |
| boucle CPU p50 / p95 / p99 [ms] | 2.5 / **8.4** ✗ / 10.9 | p95 ≤ 4 |
| image, tier | 1920×1080, `{"level":2,"capMpx":2.2,"label":"apple · metal-3 · 16 GB"}` | 1920×1080 |
| cap final | 340° | 340° demandé |

Première moitié (ligne droite et entrée du virage) : p50 60, p95 80.1 ms ; seconde : p50 60, p95 80.3 ms.

**Qualité effective et contexte, chaque seconde** : échelle de rendu 0.75 – 0.75 ; bloc 16 – 16 ; qualité « game » ; AGL 488 – 501 m ; tuiles de relief en attente 0 – 172 ; orthophotos en attente 0 – 10 ; compilations 0 – 0 ; tas JS 552 – 850 Mo.
Mémoire : avant Chrome 3191 Mo résidents, processus GPU 3001 Mo d'empreinte ; après Chrome 3551 Mo résidents, processus GPU 2995 Mo d'empreinte.

**Passes GPU horodatées** (une image sur 4, seconde moitié du vol ; sur Apple les passes de rendu se chevauchent — audit GP-09 — : à lire une à une, jamais additionnées) :

| passe | ms moyen |
|---|---:|
| display | 42.58 |
| ship: shading (MSAA) | 36.45 |
| ship: thrusters and plasma | 28.91 |
| ship: own mask | 28.22 |
| ship: shadow map | 26.21 |
| sea surface | 19.71 |
| earth water (raster) | 12.69 |
| earth lite (raster) | 5.74 |
| clouds (half) | 5.37 |
| earth lite: light | 4.26 |
| taau | 3.67 |
| terrain raster visibility | 2.75 |
| terrain from the Sun | 2.22 |
| sea fft | 2.02 |
| temporal | 1.81 |

## Le même vol, soutenu — après les ablations, la machine telle qu'un jeu prolongé la laisse

Thermique : au départ Nominal, GPU 1278 MHz (100 % du max), ? °C ; au milieu Nominal, GPU 1278 MHz (100 % du max), ? °C ; à la fin Nominal, GPU 1278 MHz (100 % du max), ? °C.

| mesure | valeur | palier 1 (validé) |
|---|---:|---|
| images nouvelles | 1202 (17.2/s) | 40/s |
| intervalle p50 [ms] | **60** ✗ | ≤ 25 |
| intervalle p95 [ms] | **80** ✗ | ≤ 25 |
| intervalle p99 [ms] | **81** ✗ | ≤ 37.5 |
| intervalle max [ms] | 120 | — |
| épisodes > 33,3 ms | 1179 (69515 ms cumulés) | datés |
| temps GPU par image p50 / p95 [ms] (`lastGpuMs`) | 58.1 / 64.5 | — |
| boucle CPU p50 / p95 / p99 [ms] | 2.4 / **8.2** ✗ / 9.9 | p95 ≤ 4 |
| image, tier | 1920×1080, `{"level":2,"capMpx":2.2,"label":"apple · metal-3 · 16 GB"}` | 1920×1080 |
| cap final | 340° | 340° demandé |

Première moitié (ligne droite et entrée du virage) : p50 60, p95 80 ms ; seconde : p50 60, p95 80.1 ms.

**Qualité effective et contexte, chaque seconde** : échelle de rendu 0.75 – 0.75 ; bloc 16 – 16 ; qualité « game » ; AGL 488 – 501 m ; tuiles de relief en attente 0 – 95 ; orthophotos en attente 0 – 7 ; compilations 0 – 0 ; tas JS 724 – 867 Mo.
Mémoire : avant Chrome 3463 Mo résidents, processus GPU 2996 Mo d'empreinte ; après Chrome 3252 Mo résidents, processus GPU 3000 Mo d'empreinte.

**Passes GPU horodatées** (une image sur 4, seconde moitié du vol ; sur Apple les passes de rendu se chevauchent — audit GP-09 — : à lire une à une, jamais additionnées) :

| passe | ms moyen |
|---|---:|
| display | 43.03 |
| ship: shading (MSAA) | 36.69 |
| ship: thrusters and plasma | 29.82 |
| ship: shadow map | 28.89 |
| ship: own mask | 24.05 |
| sea surface | 19.38 |
| earth water (raster) | 12.74 |
| earth lite (raster) | 5.65 |
| clouds (half) | 5.31 |
| earth lite: light | 4.11 |
| taau | 3.65 |
| terrain raster visibility | 2.80 |
| terrain from the Sun | 2.25 |
| sea fft | 2.09 |
| temporal | 1.80 |

## Mémoire et thermique de la séance

- Thermique au lancement : Nominal, GPU 707 MHz (55 % du max), ? °C ; à la fin : Nominal, GPU 1278 MHz (100 % du max), ? °C.

## La frame par poste : ablations sur images terminées (20 s chacune, même instantané)

Référence moyenne des deux vols de base : p50 60.0 ms, p95 80.0 ms (dérive entre eux : 0.0 ms au p50).

| ordre | poste retiré | images/s | Δ images/s | GPU p50 [ms] | ΔGPU | p50 [ms] | Δp50 | p95 [ms] | Δp95 | CPU p95 | GPU MHz | compil. |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| 0 | référence | 17.2 |  | 58.3 |  | 60 |  | 80.1 |  | 8.6 | 1278→1278 | 0 |
| 1 | sans nuages | 19.3 | +2.1 | 51.7 | -6.2 | 59.5 | -0.5 | 79.9 | -0.1 | 8.2 | 1278→1278 | 0 |
| 2 | sans décor (bâtiments, arbres) | 18 | +0.8 | 55.6 | -2.3 | 60 | +0.0 | 80 | -0.0 | 7.9 | 1278→1278 | 0 |
| 3 | sans matériau de l'eau | 17.5 | +0.3 | 57.2 | -0.7 | 60 | +0.0 | 80 | -0.0 | 8.6 | 1278→1278 | 0 |
| 4 | sans HUD ni écrans d'interface | 17.6 | +0.4 | 56.3 | -1.6 | 60 | +0.0 | 80 | -0.0 | 8.2 | 1278→1278 | 0 |
| 5 | sans dessin de l'appareil (debugSkipShip ; son masque reste) ¹ | 18.3 | +1.1 | 54.7 | -3.2 | 60 | +0.0 | 80 | -0.0 | 8.4 | 1278→1278 | 0 |
| 6 | sans carte d'ombre de l'appareil | 17.5 | +0.3 | 57.6 | -0.3 | 60 | +0.0 | 80 | -0.0 | 8.4 | 1278→1278 | 0 |
| 7 | référence | 17.3 |  | 57.5 |  | 60 |  | 80 |  | 8.3 | 1278→1278 | 0 |

¹ `debugSkipShip` saute le dessin de l'appareil mais garde le masque du cockpit : l'image y garde un cockpit ancien et le sol n'y est pas ombré — le coût du dessin, pas celui de la surface qu'il cache.

Un Δ négatif en temps (positif en images/s) est ce que le poste coûte dans cette scène ; les postes ne s'additionnent pas (contrat §5). Sur un écran à 50 Hz (kerr-mini), l'intervalle se quantifie par pas de 20 ms : y lire ΔGPU et Δ images/s plutôt que Δp50.

