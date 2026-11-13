# J3-0 — la référence de ville, premier relevé : Paris, de jour (13 novembre 2026)

[PLAN-J3](../../PLAN-J3-LUMIERE-COCKPIT.md) J3-0. **La scène suit la recommandation du plan (« la ville d'abord ») en attendant la réponse de
Sam à sa question 1** : un relevé de mesure, rien de changé à l'image. Le vol de J0 (`j0-reference`, F-35B, cockpit, 15:30 UTC le 10 juillet,
beau temps, nuages 0,5) parti de Passy à 300 m vers le Louvre (`J0_START=48.86,2.278,300,95,140`), virage à 340° à 25 s. kerr-mini,
13 nov. ~14:00 UTC, arbre de 9fe1fd2f + le passage du renderer sur `ViewPose` (AR-07, non commité au moment de la mesure — commité avec cette
fiche), `remote-results/…-j3-paris-ref2`.

## Le vol

GPU p50 **53,2 ms**, p95 62,7 ; 18,7 images/s ; intervalle p50 59,8 / p95 80 ms ; GPU 1 278 MHz du début à la fin (pression nominale) ;
l'âge du PCD p95 57,7 ms. Arrivée : première image 8,2 s, pilotable 12,2 s, relief 52,3 s, tout le détail 128,2 s.

## Le coût par famille (ablations de 20 s, GPU p50 ; référence 52,8 / 50,6 → 51,7 ms)

| Sans… | GPU p50 | Δ |
|---|---:|---:|
| **décor (bâtiments, arbres)** | 43,3 | **−8,4** |
| nuages | 46,1 | −5,6 |
| matériau de l'eau (la Seine) | 46,8 | −4,9 |
| dessin de l'appareil | 47,5 | −4,2 |
| HUD et écrans d'interface | 50,1 | −1,6 |

Au-dessus de la ville, **le décor est le premier poste** (sur J0, en mer, c'est l'eau). L'eau de la Seine coûte encore ~5 ms.

## Ce que l'image montre (cadrage de départ)

La Seine, les quartiers, l'horizon brumeux : une ville crédible à cette distance. **La tour Eiffel est dessinée en colonne pleine beige** —
un bâtiment procédural tiré de son emprise : le cas même des « matériaux identifiés » et des « premiers assets » de J3-5 / J3-6.

## Non vérifié

Le M1 Max (borne provisoire 30) ; les cadrages fixes de la sonde de cohérence appareil / sol (à écrire) ; une montagne.
