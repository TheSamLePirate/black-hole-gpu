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

## Le chemin vers §8 (PLAN-J2 §4, sortie de J2) — où est le temps, par famille, par image

Familles de la stratégie §8.2 (enveloppe prescriptive pour 60 Hz). Chaque passe **par image** = son temps moyen × la part des images où elle
tourne (`n` / images mesurées : les horizons, l'ombre du relief, l'ombre des arbres, le posemètre ne tournent pas à chaque image). Les passes de
calcul s'attribuent ; les passes de rendu (*) se chevauchent sur Apple (GP-09) : indicatives. Sources : cette fiche (kerr-mini, 5c420e09) et la
[fiche M1 Max du 12](FICHE-m1max-2026-11-12.md) (vol frais, 1 296 MHz, 98–100 °C) ; recalcul depuis leurs JSON.

| Famille (§8.2) | Enveloppe | M1 Max frais | kerr-mini | Ce qui est compté |
|---|---:|---:|---:|---|
| Visibilité, publication | 2,0 | 0,9 * | 2,9 * | `terrain raster visibility` (rendu) ; la publication des tuiles au fil principal p95 1,3 ms (mini) |
| Opaque et éclairage (sol) | 4,0 | 4,1 | 10,9 | `earth lite` + `light` + `finishing` + `earth shade` ; **+ l'appareil** : −3,2 ms par ablation (mini), non mesurable sur le M1 Max |
| **Eau** | **1,0** | **5,3** | **16,2** | `earth water` 4,3 / 12,7 + `earth water open` 0,5 / 1,4 + `sea fft` 0,5 / 2,0 + `earth shore` ; **par ablation (mini, 13 nov., `liteSkip` réparé) : sans matériau de l'eau −13,0 ms** (58,0 → 45,0 ; intervalle p95 80 → 60,7 ms) ; **`sea surface` (rendu, 19,7 * à l'horodatage) : −0,7 ms seulement par ablation** (mer plate) |
| Air et nuages | 2,5 | 3,8 | 8,4 | `clouds (half)` + `trace` + `aerial perspective` + l'historique et l'ombre des nuages ; ablation des nuages −6,3 ms (mini) |
| Reconstruction et sortie | 2,0 | 2,1 | 6,9 | `taau` + `temporal` + `resolve` + le bloom |
| Ombres, sondes | 1,5 | 0,6 | 3,4 | l'ombre du relief (rendu, 32/204 images), les horizons (10/204), l'ombre des arbres, le posemètre, le cache de surface, la profondeur d'occlusion — **par image** |
| **Non attribué** (calculé) | — | **≈ 7** | **≈ 10** | GPU p50 moins les passes de calcul ; sur le mini moins aussi l'appareil et le HUD (ablations −3,2, −1,1) : l'affichage, les masques, l'appareil (M1 Max) — **pas `sea surface`** (−0,7 ms par ablation) |
| **Total mesuré** | 13,0 | **22,5** | **58,4** | `lastGpuMs` p50 |

**Le chemin** (décisions de Sam du 13, stratégie §24) :
1. **L'eau d'abord** (5,3 pour 1,0 sur le M1 Max) : l'eau étagée (surface → éclairage → reflets), puis la classification de l'écran par tuiles —
   `earth water` et `earth water open` lancés plein écran sur une vue à moitié terrestre. Préalables **faits** (13 nov.) : l'ablation de l'eau
   réparée (le mot `liteSkip` passé par ses bits) — **−13,0 ms** sur le mini — et une ablation `sea surface` — **−0,7 ms** : la mer déplacée
   n'est pas le poste, le matériau l'est.
2. **Le non-attribué** (≈ 7 ms sur le M1 Max, ≈ 10 sur le mini) : une matrice d'ablations qui couvre la frame, puis un démontage cumulé.
3. **L'opaque** (4,1 pour 4,0, plus l'appareil) : la classification par tuiles (les noyaux du sol lancés là où il y a du sol).
4. **Air et nuages** (3,8 pour 2,5) : J4.
5. **Dans l'enveloppe** : la reconstruction (2,1 pour 2,0 — J2 ne l'a pas réduite) et les ombres/sondes (0,6 pour 1,5, par image).
6. **Le palier se juge borné et soutenu** (décision 3) : le M1 Max bride (soutenu 29 ms) — l'essai de `fpsCap` 30 puis 40 d'abord. Le mini a
   sa cible propre, 25 images/s régulières (40 ms) : ici 58,4 ms.
