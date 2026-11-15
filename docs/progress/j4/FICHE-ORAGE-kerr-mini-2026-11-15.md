# J4-0 — le profil lourd : J0 sous orage (kerr-mini, 15 novembre 2026)

**Mesuré** le 15 novembre 2026 (~02:20–02:50 UTC), kerr-mini froid (pression nominale, GPU 1 278 MHz pendant les vols, CPU ~33 °C au départ),
commit `0f2278a9` + la variante de scène `J0_WEATHER` (`tests/e2e/lib/j0-scene.ts`). La scène est **J0 (Toulon-Hyères, vol et virage
identiques) avec la météo « storm »** et une couverture de 0,9 — identifiant `toulon-hyeres-v1-storm` : à ne jamais comparer à J0 comme si
c'était la même scène. Runs `…-j4-storm` (vol + ablations), `…-j4-storm-weather` (l'ablation météo).

## Le vol (70 s)

| | Beau temps (J0, 15 nov., 0bb2aa86) | Orage |
|---|---:|---:|
| GPU p50 | 57,3 ms | **77,8 ms** |
| GPU p95 | 62,4 ms | 85,6 ms |
| Images / s | 17,6 | 12,8 |
| Âge des écrans p95 | 56,2 ms | 6 ms |

## Les ablations (GPU p50, 20 s chacune ; références 79,7 / 75,9 puis 77,0 / 76,4 ms — A/A jusqu'à 3,8 ms)

| Ablation | GPU p50 | Δ (sur la moyenne des références de son run) |
|---|---:|---:|
| **météo beau temps (couverture gardée)** | 55,9 | **−20,8** |
| sans matériau de l'eau | 64,8 | −13,0 |
| sans dessin de l'appareil | 70,1 | −7,7 |
| sans carte d'ombre de l'appareil | 76,1 | −1,7 |
| sans nuages (`earthClouds` 0) | 77,2 / 75,0 | −0,6 / −1,7 |
| sans décor | 76,5 | −1,3 |
| sans HUD ni écrans | 76,5 | −1,3 |
| mer plate | 77,6 | −0,2 |

Le profil des passes (le vol) : `clouds (half)` **16,5 ms** (une passe de calcul : ses horodatages valent ; 5,15 ms sur J0 le 13 nov.) — les
passes de rendu se chevauchent sur Apple, leurs temps ne s'additionnent pas.

## Lecture

- **Le surcoût de l'orage (+20,5 ms sur J0) est celui de la météo elle-même** (ses couches de nuages `wxCloud`, la pluie, les éclairs) : la
  météo ramenée au beau temps, couverture gardée, rend 20,8 ms ; la couverture seule (`earthClouds` 0) presque rien. La passe des nuages
  triple (5,15 → 16,5 ms).
- **Plafond pour J4-2 / J4-6 (règle 1)** : sous orage, la météo 20,8 ms, dont la passe des nuages ~11 ms de plus qu'au beau temps.
- L'ablation « sans nuages » de J0 ne mesure pas les nuages de la météo : l'ablation `weather` (ajoutée) le fait.

## Non vérifié

Un seul passage par cas (A/A 3,8 ms entre les références du premier run) ; le M1 Max non mesuré ; la part de la pluie, des éclairs et des
rideaux dans les 20,8 ms non séparée.
