# J0 — fiche kerr-mini, 2026-11-13

Scène `toulon-hyeres-v1` ([contrat](../../J0-CONTRAT.md)) · commit `5c420e09` · sortie 1920×1080 · lancé 2026-11-13T07:30:25.462Z · source `docs/progress/j0/j0-kerr-mini-2026-11-13-sortie.json` (écrite par `scripts/j0-fiche.ts`).
> **Fiche J0 de sortie de J2** (PLAN-J2 J2-8 ; l'état décidé par Sam le 13 nov. : `singleHistory`, `edgeFoot`, `earthRateOne`, `seaSsrSafe`,
> `clearCut`, `earthScenery.corridor` allumés, la désocclusion et `rigidMotionOn` retirés ; kerr-mini plein écran, « Nominal », 1 278 MHz) :
> - **Entrée à froid** : première image 8,7 s, pilotable 13,6 s, couverture utile **56,3 s**, détail complet 59,3 s (le 12 : 13,6 / 18,5 /
>   77,3 s ; une entrée par jour : non attribué).
> - **Vol frais** : 17,1/s, GPU p50 58,4 / p95 64,4 ms, intervalle p95 80,1 ms ; soutenu 17,4/s, GPU p50 57,4 ms (le 12 : 59,5 / 58,2) — le
>   palier 1 (40/s) non atteint ; J2 n'en change pas le coût (A/B des lots : ΔGPU nul).
> - **Ablations** (ΔGPU p50) : nuages −6,3 ms, décor −2,0, HUD −1,1 ; l'eau −0,4 non valable (`liteSkip`).

Navigateur : Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36. Adaptateur : `"apple"`.
Réglages effectifs (profil du joueur) : `{"quality":"game","dynamicResolution":true,"earthPipeline":"raster","earthScenery":"high","earthSurface":"satellite","detailReach":"veryFar","lookProfile":"auto","realtimeSubsampling":"auto","earthRasterShading":"auto","fpsCap":0,"motionBlur":0,"dof":false}`.

## Chemin d'entrée, à froid (profil Chrome neuf)

| étape | s depuis le démarrage |
|---|---:|
| première image (`game:artemis`) | 8.7 |
| image pilotable (F-35 placé, noyau de la scène compilé) | 13.6 |
| couverture utile (relief fin, calme 3 s) | 56.3 |
| détail complet (imagerie, décor, noyaux) | 59.3 |

## Vol mesuré (70 s, temps réel, virage compris) — la machine telle que le démarrage la laisse

Thermique : au départ Nominal, GPU 1278 MHz (100 % du max), ? °C ; au milieu Nominal, GPU 1278 MHz (100 % du max), ? °C ; à la fin Nominal, GPU 1278 MHz (100 % du max), ? °C.

| mesure | valeur | palier 1 (validé) |
|---|---:|---|
| images nouvelles | 1196 (17.1/s) | 40/s |
| intervalle p50 [ms] | **60** ✗ | ≤ 25 |
| intervalle p95 [ms] | **80.1** ✗ | ≤ 25 |
| intervalle p99 [ms] | **81** ✗ | ≤ 37.5 |
| intervalle max [ms] | 140.9 | — |
| épisodes > 33,3 ms | 1172 (69479 ms cumulés) | datés |
| temps GPU par image p50 / p95 [ms] (`lastGpuMs`) | 58.4 / 64.4 | — |
| boucle CPU p50 / p95 / p99 [ms] | 2.4 / **8.5** ✗ / 11.1 | p95 ≤ 4 |
| image, tier | 1920×1080, `{"level":2,"capMpx":2.2,"label":"apple · metal-3 · 16 GB"}` | 1920×1080 |
| cap final | 340° | 340° demandé |

Première moitié (ligne droite et entrée du virage) : p50 60, p95 80.1 ms ; seconde : p50 60, p95 80 ms.

**Qualité effective et contexte, chaque seconde** : échelle de rendu 0.75 – 0.75 ; bloc 16 – 16 ; qualité « game » ; AGL 488 – 501 m ; tuiles de relief en attente 0 – 166 ; orthophotos en attente 0 – 11 ; compilations 0 – 0 ; tas JS 568 – 842 Mo.
Mémoire : avant Chrome 3063 Mo résidents, processus GPU 2906 Mo d'empreinte ; après Chrome 3513 Mo résidents, processus GPU 2906 Mo d'empreinte.

**Passes GPU horodatées** (une image sur 4, seconde moitié du vol ; sur Apple les passes de rendu se chevauchent — audit GP-09 — : à lire une à une, jamais additionnées) :

| passe | ms moyen |
|---|---:|
| display | 45.25 |
| ship: shading (MSAA) | 37.78 |
| ship: own mask | 28.36 |
| ship: shadow map | 26.77 |
| ship: thrusters and plasma | 26.74 |
| sea surface | 19.71 |
| earth water (raster) | 12.73 |
| earth lite (raster) | 5.88 |
| clouds (half) | 5.15 |
| earth lite: light | 4.34 |
| taau | 3.66 |
| terrain raster visibility | 2.85 |
| terrain from the Sun | 2.37 |
| sea fft | 2.04 |
| temporal | 1.73 |

## Le même vol, soutenu — après les ablations, la machine telle qu'un jeu prolongé la laisse

Thermique : au départ Nominal, GPU 1278 MHz (100 % du max), ? °C ; au milieu Nominal, GPU 1278 MHz (100 % du max), ? °C ; à la fin Nominal, GPU 1278 MHz (100 % du max), ? °C.

| mesure | valeur | palier 1 (validé) |
|---|---:|---|
| images nouvelles | 1217 (17.4/s) | 40/s |
| intervalle p50 [ms] | **60** ✗ | ≤ 25 |
| intervalle p95 [ms] | **80.1** ✗ | ≤ 25 |
| intervalle p99 [ms] | **80.9** ✗ | ≤ 37.5 |
| intervalle max [ms] | 100.9 | — |
| épisodes > 33,3 ms | 1189 (69375 ms cumulés) | datés |
| temps GPU par image p50 / p95 [ms] (`lastGpuMs`) | 57.4 / 63.5 | — |
| boucle CPU p50 / p95 / p99 [ms] | 2.4 / **8.2** ✗ / 10.6 | p95 ≤ 4 |
| image, tier | 1920×1080, `{"level":2,"capMpx":2.2,"label":"apple · metal-3 · 16 GB"}` | 1920×1080 |
| cap final | 340° | 340° demandé |

Première moitié (ligne droite et entrée du virage) : p50 60, p95 80.2 ms ; seconde : p50 60, p95 80 ms.

**Qualité effective et contexte, chaque seconde** : échelle de rendu 0.75 – 0.75 ; bloc 16 – 16 ; qualité « game » ; AGL 488 – 501 m ; tuiles de relief en attente 0 – 99 ; orthophotos en attente 0 – 14 ; compilations 0 – 0 ; tas JS 722 – 868 Mo.
Mémoire : avant Chrome 3639 Mo résidents, processus GPU 2905 Mo d'empreinte ; après Chrome 3669 Mo résidents, processus GPU 2911 Mo d'empreinte.

**Passes GPU horodatées** (une image sur 4, seconde moitié du vol ; sur Apple les passes de rendu se chevauchent — audit GP-09 — : à lire une à une, jamais additionnées) :

| passe | ms moyen |
|---|---:|
| display | 41.53 |
| ship: shading (MSAA) | 33.62 |
| ship: thrusters and plasma | 25.18 |
| ship: own mask | 25.11 |
| ship: shadow map | 24.59 |
| sea surface | 19.16 |
| earth water (raster) | 12.75 |
| earth lite (raster) | 5.61 |
| clouds (half) | 5.09 |
| earth lite: light | 4.16 |
| taau | 3.65 |
| terrain raster visibility | 2.92 |
| terrain from the Sun | 2.30 |
| sea fft | 2.25 |
| temporal | 1.71 |

## Mémoire et thermique de la séance

- Thermique au lancement : Nominal, GPU 707 MHz (55 % du max), ? °C ; à la fin : Nominal, GPU 1278 MHz (100 % du max), ? °C.

## La frame par poste : ablations sur images terminées (20 s chacune, même instantané)

Référence moyenne des deux vols de base : p50 60.0 ms, p95 80.1 ms (dérive entre eux : 0.0 ms au p50).

| ordre | poste retiré | images/s | Δ images/s | GPU p50 [ms] | ΔGPU | p50 [ms] | Δp50 | p95 [ms] | Δp95 | CPU p95 | GPU MHz | compil. |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| 0 | référence | 17.3 |  | 57.8 |  | 60 |  | 80.2 |  | 8.3 | 1278→1278 | 0 |
| 1 | sans nuages | 19.6 | +2.1 | 51 | -6.3 | 59.1 | -0.9 | 60.9 | -19.2 | 8 | 1278→1278 | 0 |
| 2 | sans décor (bâtiments, arbres) | 18.2 | +0.7 | 55.2 | -2.0 | 59.9 | -0.1 | 80 | -0.1 | 7.9 | 1278→1278 | 0 |
| 3 | sans matériau de l'eau | 17.5 | +0.0 | 56.9 | -0.4 | 60 | +0.0 | 79.9 | -0.2 | 8 | 1278→1278 | 0 |
| 4 | sans HUD ni écrans d'interface | 17.7 | +0.2 | 56.1 | -1.1 | 59.9 | -0.1 | 80 | -0.1 | 8.7 | 1278→1278 | 0 |
| 5 | sans dessin de l'appareil (debugSkipShip ; son masque reste) ¹ | 18.2 | +0.7 | 54.5 | -2.8 | 59.9 | -0.1 | 80 | -0.1 | 8 | 1278→1278 | 0 |
| 6 | sans carte d'ombre de l'appareil | 17.6 | +0.1 | 57 | -0.3 | 60 | +0.0 | 80 | -0.1 | 8.2 | 1278→1278 | 0 |
| 7 | référence | 17.6 |  | 56.7 |  | 60 |  | 80 |  | 8.3 | 1278→1278 | 0 |

¹ `debugSkipShip` saute le dessin de l'appareil mais garde le masque du cockpit : l'image y garde un cockpit ancien et le sol n'y est pas ombré — le coût du dessin, pas celui de la surface qu'il cache.

Un Δ négatif en temps (positif en images/s) est ce que le poste coûte dans cette scène ; les postes ne s'additionnent pas (contrat §5). Sur un écran à 50 Hz (kerr-mini), l'intervalle se quantifie par pas de 20 ms : y lire ΔGPU et Δ images/s plutôt que Δp50.

