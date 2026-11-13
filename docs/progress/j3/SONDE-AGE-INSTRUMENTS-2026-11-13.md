# J3-0 — la sonde de l'âge des instruments (13 novembre 2026)

[PLAN-J3](../../PLAN-J3-LUMIERE-COCKPIT.md) J3-0 (« l'âge des instruments ») et J3-4 (« âge des écrans mesuré et borné ») ; CLAUDE.md : suivre
« l'âge des informations critiques ». La partie de J3 qui ne dépend d'aucune des questions posées à Sam : un instrument de mesure, rien de
changé à l'image ni au jeu.

## Ce qu'elle mesure

`ship.displayAges()` (BH-API) : le temps depuis le dernier envoi au GPU de chaque surface d'affichage — le PCD du F-35 (`jet`), l'atlas des
écrans de l'A320 (`du`), les écrans des autres cabines (`screens`). J0 relève celui de l'appareil (`jet`) **à chaque image** de ses vols
(`instrumentAge` : p50, p95, max).

**Sa limite** : un écran dont l'image ne change pas n'est pas renvoyé ; son âge grandit sans que l'information soit périmée. En vol, le PCD
change sans cesse (cap, carburant, carte) : là, l'âge mesuré est celui de l'information. Une mesure plus juste — le délai entre un changement
de donnée et son affichage — demanderait d'instrumenter le dessin des écrans (`main.ts`, partagé avec la session de l'audit) : non fait.

## Les témoins (règle de méthode 3)

kerr-mini, 13 nov. ~13:50 UTC, `remote-results/…-j3-agecheck` (`J0_PHASES=flight,agecheck`) :

| Fenêtre | Images | p50 | p95 | max |
|---|---:|---:|---:|---:|
| A (10 s, tel quel) | 181 | 18,4 ms | 57,0 ms | 63,9 ms |
| **Envois du PCD arrêtés 4 s** (le défaut injecté) | 72 | 2 078 ms | 3 837 ms | **3 998 ms** |
| A′ (10 s, tel quel) | 178 | 18,3 ms | 56,7 ms | 4 058 ms (la première image après l'arrêt) |

Le témoin positif voit le défaut (≥ 3,5 s exigé) ; l'A/A est nul (p95 57,0 / 56,7 ms). **La sonde peut entrer dans les fiches.**

## Sa première mesure

Le vol de J0 (kerr-mini, 70 s, 1 243 images) : l'âge du PCD **p50 18,4 ms, p95 56,6 ms, max 64,1 ms** — sous le pas d'envoi du PCD (au plus
toutes les 66 ms, ou aussitôt touché : `main.ts updateJetScreen`) plus une image. Le seuil à tenir n'est pas fixé (J3-4, avec le plan).
