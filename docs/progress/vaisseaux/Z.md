# Z — Finition : la doc, la suite complète, la campagne e2e

*2026-10-20, branche `vaisseaux-aaa` — `docs/PLAN-VAISSEAUX-AAA.md`, phase Z. Le plan est terminé.*

## La doc

- **`docs/VAISSEAUX.md`** et **`docs/VAISSEAUX.fr.md`** : la référence des trois vaisseaux, comme `F35.md`. Elle
  couvre :
  - l'entrée en jeu, l'assistance et ⇧X, les touches, la roue, la manette et le HOTAS ;
  - les autopilotes, les protections, l'Endurance, les systèmes, les HUD, les cockpits, le son ;
  - les comptes rendus, l'école, les défis, les missions, la console crew ;
  - le jeu à plusieurs, `__bh`, et ce qui reste à faire.
- **`NETWORK.md` / `.fr.md`** : une section « Les vaisseaux ensemble (N1–N6) » qui donne les événements, ce qui est
  vérifié à la réception, et les onglets Flotte et Résultats. Le « pas de second siège » de R5 et le « pace following
  the proper time » de R8 sont mis à jour.
- **`CREW.md`** : les blocs `att`, `dock`, `land`, `time.met`, `hole` et `others`, les autres vaisseaux sur la vue
  ORBITE, et le copilote à bord.
- **`HUD.md`** : les tableaux et aides des vaisseaux (DESCENTE, ENDURANCE, COAS, LPD), les alertes des protections,
  des systèmes et de proximité, et la roue à onze secteurs.
- **`README.md`** : le lien vers la nouvelle doc.
- **`BH-API.md`** : couvre les 163 membres vivants (`scripts/bh-api.ts --check`).
- **Aide** : la touche B annonce maintenant le rendez-vous complet au-delà de 3 km.

## La suite unitaire complète

1 425 réussis, 949 ignorés (les e2e), 3 échecs : aérobatie (huit cubain, passage à haute incidence) et
qualification sur mer du F-35C. Ces tests sont connus pour échouer sous la charge de la suite entière ; relancés
seuls, ils passent 19/19.

## La campagne e2e complète (kerr-mini, plein écran)

180 fichiers en 4 h 53 (`20261020-105814-vaisseaux-z`) : **167 réussis**, 13 en échec. Chaque échec a été relancé
sur le mini et passé à HEAD et à la base de la branche (`dd2e453c`) :

| fichier | verdict |
|---|---|
| crew-actions (A4) | **régression de K6, corrigée** : la console mettait la signature du MCP à la place de son genre (« space ») ; la signature est à part. 6/6 sur le mini. |
| report | **régression de X8, corrigée** : charger une sauvegarde en orbite juste après un poser était pris pour une ascension finie (compte rendu fallacieux). L'ascension ne démarre plus qu'au ras du sol, et un saut de plus de 50 km remet les phases à zéro. 3/3 sur le mini. |
| golden | **références enregistrées à nouveau** : 6 vols sur 8 dérivaient déjà à la base (références du 13/10). La branche ajoute iss-autodock (+1,9 cm d'altitude finale) et de petits écarts de lacet, venus de ses changements voulus (lois SAS X0, pôle de la date X1f, systèmes X3). Mêmes nombres ici et sur le mini. 8/8. |
| net-flight, eclipse-atmosphere, near-air, copilot, gpu-startup, forest-aaa | **déjà en échec à la base** : identiques avant la branche (shaders de test périmés, l'annonce « bandit » de TARS, le noyau de la première image, le décor des forêts). |
| assist-dock, school-demos (la boucle), trap | **instables** : réussis à la relance. |
| grass-aaa | **environnement** : réussi ici à HEAD comme à la base ; sur le mini, 8 698 tiges pour plus de 15 000 attendues. |

Les e2e propres à la branche passent tous, sur le mini comme ici : vaisseaux-x1, vaisseaux-x5, space-school,
space-missions, crew-space, crew-space-actions, crew-stations, crew-demo-space, net-space, net-dock, net-fleet,
net-share, net-crew, net-board, net-coop, net-time et audio-space.

## Le plan, phase par phase

La fiche de chaque phase est dans ce dossier, avec ses images et ses mesures. Les commits de la branche, dans
l'ordre : X0 `d40877a3` · X1a–f `998da6ac`…`a6a87180` · X2a–e `934fe5fc`…`f0c3a7d1` · X4 `e7db621b` · X3 `13dc91f1` ·
X5 `6f79a369` · K1–K7 `9b1471c4`…`24b9843f` · X6 `97bf753b` · X7 `26cea27b` · X8 `ebafdc41` · X9 `e5730983` ·
X10 `4f114353` · X11 `0b851a8d` · N1 `e4e9d5a9` · correctif X1b `9ad50230` · N2–N3 `c15b69c8` · N4 `45c3e478` ·
N5 `91c68c0e` · N6 `45ae44f1` · doc Z `541d4262` · correctifs de campagne `4d94cca8`.

## Ce qui reste (des fiches)

- L'Endurance de salle prise avec un bail (passer d'un vaisseau par joueur à des vaisseaux identifiés).
- Les feux et le train d'un Ranger distant, les autres vaisseaux sur la carte 3D du système de la console.
- Les messages vocaux enregistrés ; le contrôle de mission comme rôle compté des missions coopératives ; reprendre un
  rôle après une reconnexion.
- Les tableaux intérieurs propres au Lander et à l'Endurance (un modèle à construire ou à télécharger — à demander).
- L'ascension en deux temps et la mission vers Jupiter (sessions à part, X1).
- Côté main, hors de la branche : les e2e déjà en échec ci-dessus.
