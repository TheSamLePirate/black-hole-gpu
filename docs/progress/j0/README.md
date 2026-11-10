# J0 — les premières mesures de la scène de référence (10 novembre 2026)

Scène `toulon-hyeres-v1` ([contrat](../../J0-CONTRAT.md)), code du jeu à `5aeec7b0`, e2e
`tests/e2e/j0-reference.e2e.test.ts` du même lot. Sortie 1920 × 1080, profil du joueur tel que livré (qualité « game »,
résolution dynamique, échelle tenue à 0,75, décor « high », portée « veryFar »), Chrome 157, profil neuf à chaque
lancement. Fiches : [M1 Max](FICHE-m1max-2026-11-10.md), [kerr-mini](FICHE-kerr-mini-2026-11-10.md) ; données brutes
`j0-<machine>-2026-11-10.json` (le premier passage du M1 Max, mesuré déjà bridé et avec un défaut de démarrage des
ablations corrigé depuis, gardé dans `j0-m1max-2026-11-10-passage1.json`).

**État de preuve : mesuré** — deux passages par machine, l'e2e réussi à chaque fois (3/3), aucune erreur GPU. Les seuils
du palier et son jugement sur l'état soutenu ont été validés par Sam le soir du 10 novembre (J0 atteint) ; le palier 1
n'est pas atteint.

## Le palier (25 ms sur M1 Max) : pas atteint

| | images/s | intervalle p50 | p95 | p99 | GPU p50 | CPU p95 | GPU (MHz) |
|---|---:|---:|---:|---:|---:|---:|---|
| M1 Max, frais | 36,8 | **25,1** | 34,2 | 50,3 | 26,3 | 6,4 | 1 296 → 1 197 |
| M1 Max, soutenu | 24,9 | 41,5 | 50,2 | 83,0 | 39,0 | 10,6 | 858 → 706 |
| M1 Max, passage 1, bridé | — | ≈ 82–85 (ablations) | — | — | ≈ 80 | ≈ 16 | 389 |
| kerr-mini, frais | 15,2 | 60,1 | 80,8 | 100,1 | 65,4 | 9,4 | 1 278 |
| kerr-mini, soutenu | 15,5 | 60,0 | 80,7 | 99,8 | 64,2 | 9,5 | 1 278 |
| *palier 1 (validé)* | *40* | *≤ 25* | *≤ 25* | *≤ 37,5* | — | *≤ 4* | — |

- **Frais, le M1 Max est au palier en médiane** (25,1 ms) mais pas en régularité (p95 34, p99 50) ni en CPU (p95 6,4).
- **Soutenu, il en est loin** : ce MacBook Pro (secteur, mode économie coupé) passe de 100 % à 30–60 % de sa fréquence
  GPU en 2,5 à 4 minutes de jeu (97–99 °C ; pression « Heavy » puis « Trapping »), et oscille ensuite. Selon l'instant, le
  même vol coûte 25, 41 ou ≈ 83 ms. kerr-mini, lui, ne bride pas.
- Le CPU de la boucle principale est hors budget partout (p95 6–10 ms contre 4 proposés).

## Où part la frame (kerr-mini, fréquence stable, GPU 65 ms par image)

| poste retiré | ΔGPU p50 | Δ images/s | ΔCPU p95 (réf. 9,6 ms) |
|---|---:|---:|---:|
| nuages | **−5,8 ms** | +1,7 | 0,0 |
| décor (bâtiments, arbres) | **−3,8 ms** | +1,2 | −1,1 |
| HUD et panneaux | −1,4 ms | +0,2 | −1,2 |
| ombre de l'appareil | −0,7 ms | +0,3 | −0,1 |
| dessin de l'appareil (`debugSkipShip`)¹ | −0,25 ms | +0,2 | −0,8 |
| matériau de l'eau dans `shadeLite` | 0,0 ms | +0,1 | 0,0 |

¹ Le dessin sauté, le masque du cockpit reste : l'image garde là un cockpit ancien, plus sombre, et le sol n'y est pas
ombré (vérifié par une sonde sur ce Mac). L'ablation borne le coût du dessin, pas celui de la surface qu'il cache.

Dérive entre les deux bases : 0,9 ms. **Ces six postes ensemble ≈ 12 ms ; le reste — ≈ 53 ms — est le sol et l'eau**, que
les passes de calcul horodatées (attribuables sur Apple) chiffrent : `earth lite (raster)` 17,5 ms, `earth water (raster)`
12,7 ms, puis `clouds (half)` 5,1, `taau` 3,3, `terrain from the Sun` 2,3, `earth horizons` 1,6, `sea fft` 1,6,
`temporal` 1,6, `trace` 1,3.

Trois enseignements :

1. **Le dessin de l'appareil n'est pas le problème.** Les horodatages lui attribuent 37–49 ms (`ship: shading (MSAA)`,
   `ship: shadow map`, `display`…) ; sauté, il rend 0,25 ms (sa carte d'ombre seule 0,7). GP-09 confirmé : sur Apple, ne jamais lire une passe de rendu
   comme un coût.
2. **Le domaine de J1 est la moitié de la frame** : `earth lite` + `earth water` ≈ 30 ms sur 65 sur kerr-mini (≈ 12 sur
   26 sur le M1 Max frais). Le retrait du matériau de l'eau dans `shadeLite` (`liteSkip` 1) ne gagne rien : la passe
   `earth water (raster)` (12,7 ms) tourne quand même — c'est elle, pas le matériau, qu'il faut juger (ablation à
   ajouter).
3. Les nuages (≈ 9 %) et le décor (≈ 6 %) sont les seuls autres postes qui comptent ; affichages, appareil et son ombre
   pèsent moins de 4 % du GPU mais ≈ 2 ms de CPU au p95 (référence 9,6 ms).

## Le chemin d'entrée et le chargement en vol

| | première image | image pilotable | relief fin (calme 3 s) | détail complet |
|---|---:|---:|---:|---:|
| M1 Max (passage 2 / 1) | 8,3 / 8,4 s | 11,3 / 11,4 s | 73 / 61 s | 88 / 64 s |
| kerr-mini (passage 2 / 1) | 12,8 / 17,3 s | 17,0 / 21,6 s | pas calme en 90 s | 142 / 127 s |

Pendant le vol (140 m/s à 500 m, portée « veryFar »), **les tuiles de relief en attente montent sans redescendre** :
20 → 192 sur le M1 Max, 37 → 258 sur kerr-mini en 70 s. Le chargement ne suit pas le vol de référence — une mesure
d'entrée pour le plan [CM](../../PLAN-CHARGEMENT-MONDE.md) (vague 2 de l'audit), pas encore expliquée.

## Mémoire

Processus GPU de Chrome : ≈ 2,6–2,9 Go d'empreinte physique ; Chrome entier 2,1–3,4 Go résidents ; tas JS 540–870 Mo.
Pas de croissance nette pendant un vol.

## Ce qui n'est pas mesuré

La présentation à l'écran (seulement les complétions GPU) ; la latence commande → image ; l'âge des instruments ; un
second lancement sur profil gardé (caches chauds) ; le parcours par l'écran titre ; kerr-pc ; la qualité d'image en
mouvement (aucune comparaison d'image ici). Le passage 2 du M1 Max a gardé le HUD éteint après l'ablation
« affichages » (défaut corrigé avant le passage 2 de kerr-mini) : sa base finale et son vol soutenu sont sans HUD
(≈ −1,4 ms de GPU sur kerr-mini).

## Suite proposée

- ~~Sam : valider les seuils et l'état thermique~~ — fait le 10 novembre au soir (soutenu).
- Une ablation de la passe `earth water (raster)` et une de `earth lite` à taux réduit, pour borner le gain de J1.
- Le chargement qui ne suit pas le vol : CM0 (le chemin réel des tuiles) avec cette scène.
