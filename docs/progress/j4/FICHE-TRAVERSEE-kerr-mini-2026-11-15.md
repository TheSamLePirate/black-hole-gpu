# J4-0 — la traversée de nuages : J0 dans la couche de cumulus (kerr-mini, 15 novembre 2026)

**Mesuré** le 15 novembre 2026 (~02:40–02:50 UTC), kerr-mini froid (nominal, CPU 41 °C au départ), commit `e4cac1c3`. La scène : **J0
(Toulon-Hyères, même trajet et virage) à 1 900 m, sous la météo « cloudy »** — sa couche de cumulus de 1 200 à 2 600 m, couverture 0,45 —
(`J0_WEATHER=cloudy J0_START=43.06,6.32,1900,270,140`) : l'appareil entre et sort des cumulus (au virage, la vue toute dans le nuage —
capture `flight-turn`). Identifiant `toulon-hyeres-v1-cloudy` à 1 900 m : à ne pas comparer à J0 comme si c'était la même scène. Run `…-j4-crossing`.

| | J0 beau temps (15 nov.) | Traversée | J0 sous orage (15 nov.) |
|---|---:|---:|---:|
| GPU p50 | 57,3 ms | **60,0 ms** | 77,8 ms |
| GPU p95 | 62,4 ms | 70,7 ms | 85,6 ms |
| Images / s | 17,6 | 16,7 | 12,8 |
| `clouds (half)` | 5,15 ms (13 nov.) | **6,2 ms** | 16,5 ms |
| `clouds' shadow map` | — | 1,3 ms | — |

Ablations (GPU p50) : références 60,2 / 61,4 ; **météo au beau temps 60,8 (≈ 0)** ; couverture 0 : 60,2 (≈ 0).

## Lecture

- Traverser des cumulus coûte peu : +2,7 ms sur le vol, la passe des nuages 6,2 ms ; la météo « cloudy » ne pèse rien de mesurable au-delà du
  bruit (A/A 1,2 ms). **Le poste lourd des volumes est l'orage** (la fiche voisine : la météo d'orage 20,8 ms).
- Pour l'enveloppe par profil (J4-6) : beau temps, traversée de cumulus et orage ont chacun leur chiffre de référence.

## Non vérifié

Un passage ; le M1 Max non mesuré ; la stabilité de l'image dans le nuage (les fantômes, J4-1) non mesurée.
