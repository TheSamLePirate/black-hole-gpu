# J4-0 / J4-6 — J0 par profil météo (kerr-mini, 15 novembre 2026)

**Mesuré** le 15 novembre 2026, kerr-mini froid (pression nominale, CPU 33–41 °C au départ), le vol J0 (Toulon-Hyères, 70 s, cockpit) sous
chaque préréglage (`J0_WEATHER`, couverture `earthClouds` 0,9 hors beau temps) ; la traversée : le même vol à 1 900 m dans la couche de
« cloudy ». Runs `…-j4-storm`, `…-j4-crossing`, `…-j4-overcast`, `…-j4-rain` ; J0 beau temps du même jour (0bb2aa86). Un vol par profil.

| Profil (couches du préréglage) | GPU p50 | GPU p95 | Images / s | `clouds (half)` | Δ sur J0 |
|---|---:|---:|---:|---:|---:|
| Beau temps (aucune) — J0 | 57,3 | 62,4 | 17,6 | 5,15 (13 nov.) | — |
| Traversée de cumulus (1 200–2 600 m, 0,45 ; vol à 1 900 m) | 60,0 | 70,7 | 16,7 | 6,2 | +2,7 |
| Couvert (600–2 000 m 0,95 ; 4 000–5 500 m 0,5) | 67,9 | 74,6 | 14,7 | 12,4 | +10,6 |
| Pluie (500–3 500 m, 1 ; pluie 0,6) | 67,3 | 73,7 | 14,8 | 10,6 | +10,0 |
| Orage (400–9 000 m, 1 ; 10 000–11 500 m 0,6 ; pluie 1, éclairs) | 77,8 | 85,6 | 12,8 | 16,5 | +20,5 |

Les autres passes de l'air restent à peu près fixes (couvert / pluie) : `clouds' shadow map` 1,3–1,4 ms, `aerial perspective` 1,1–1,2 ms,
`clouds' history` 0,5 ms, `clouds' light volume` 0,3 ms, `sky ambient` < 0,1 ms.

## Lecture

- **Le coût suit la passe des nuages** : +5 à +11 ms selon l'épaisseur de la couche ; la pluie elle-même ne pèse rien de lisible (pluie ≈
  couvert). L'orage ajoute ~9 ms au-delà de sa passe (couche de 8,6 km, couche haute, éclairs, ses autres lecteurs — non séparés).
- **Plafond de J4-2 (règle 1)** : la passe des nuages au-dessus du beau temps, 7 à 11 ms selon le profil ; le saut du vide (grille d'occupation)
  vise les couvertures partielles — une couche pleine (couvert, orage) se paie dans son épaisseur : là, le pas et l'arrêt sur la transmittance.
- **L'enveloppe par profil (J4-6, réglage provisoire du §8)** : sur kerr-mini (cible 40 ms), aucun profil n'est tenu ; l'écart va de 17 ms (beau
  temps) à 38 ms (orage).

## Non vérifié

Un vol par profil (A/A de J0 ~±1,6 ms) ; le M1 Max non mesuré ; la part des éclairs et de la couche haute de l'orage non séparée.
