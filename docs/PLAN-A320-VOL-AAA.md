# Plan A320 AAA — le vol, l'autopilote, le poste à 100 %, les assistances (26 novembre 2026)

**Mode : normal** (rien d'autre n'a été dit). Demande de Sam, 26 nov. 2026 : « des tests de vol A320 (de vrais vols : décollage,
manœuvres, autopilotes, approches, atterrissages) et vérifier la physique du vol de l'A320 afin qu'il vole bien (PID, oscillations…) ;
finir l'intégration des fonctions de l'A320, en mode réel et assisté pour le cockpit ; toutes les fonctions de carte tactique,
autopilote, plan de vol doivent marcher aussi bien avec les instruments de l'A320 (cockpit) qu'avec les outils du jeu et de l'équipage ;
un mode A320 à la roue (Tab maintenu) avec toutes les assistances, les réglages d'instruments et des modes faciles — tout doit marcher
avec les vrais appareils de l'A320, mais ces fonctions permettent de décoller, régler le pilote automatique, l'ILS… facilement. Les
boutons complexes fonctionnent mal (les molettes de l'autopilote : tirer, pousser avec Maj). Tous les e2e sur le mini, fenêtre
visible. » Puis : « les prochains vols, fais-les en journée » ; « fais les vols par temps clair ».

Prédécesseur : [PLAN-A320.md](PLAN-A320.md) (A0–A14 faits ; A15–A19 à faire). Cours : [VOL-AVIONS.md](VOL-AVIONS.md) leçon 10.

## 0. L'état au départ (audit du 26 nov. 2026, code à `0c6feaea`)

- **Les molettes du FCU ne se tirent pas.** FlightGear : clic = pousser (géré), **Maj-clic** ou clic du milieu = tirer (sélecté),
  molette = tourner (`a320.flightdeck.xml` `spd-sel`…). Le jeu : le Maj-clic n'atteint jamais le poste (`controls.ts` : `!e.shiftKey`,
  puis `dragLook = … || e.shiftKey` : il tourne le regard) ; la propriété `devices/status/keyboard/shift` n'est jamais écrite (la branche
  « tirer » des liaisons est morte : un clic pousse toujours) ; Maj et Alt tenus 0,1 s **déplacent les manettes** (`bindings.ts`
  throttleUp/Down, `piloting.ts modGate`). Seul le clic du milieu tire — absent d'un trackpad. Aucun e2e ne tire une molette.
- **La roue Tab de l'A320 est celle des vaisseaux** (`main.ts wheelItems` → `spaceWheelNow`) : SAS, orbites, ordinateur de vol… sans
  objet ; seul le secteur Approche (`ui/approach-wheel.ts`) est de l'A320.
- **Aucune assistance A320** : `assistlevel.ts` force « réaliste » pour tout avion autre que le F-35 ; le secteur Assistance de la roue
  écrit `spaceAssist`, sans effet. Il y a la loi normale (protections, auto-trim), les barres du FD, `recoverStart`.
- **Outils du jeu et FMGC** : `apSet`, `jetToggle`, `navToggle`, `ilsStart`, `approachSelect`, la carte tactique, l'équipage (`ap.set`,
  `ap.ils`, `app.*`), TARS (`jet_autopilot`, `approach`, remise de gaz) passent bien par le FMGC. **Écarts** : `navSet` (`lnav: false`
  sans effet, `vnav` = NAV) ; `jet_mode` orbite/attente/suivi de terrain (TARS, équipage `ap.mode`) pilote l'A320 par l'autopilote du
  F-35 en contournant le FCU ; TARS `autopilot`/`hold` (vaisseaux) sans objet.
- **Vols mesurés** : aucun vol complet de l'A320 en direct n'était au banc (seulement les approches ILS de Toulon-Hyères) ; le scénario
  `a320-line-lfpb` (ce plan, V0) en fait un, au midi solaire du terrain, par temps clair.

## 1. Les lots

| # | Lot | Contenu | Preuve attendue | Statut |
|---|---|---|---|---|
| V0 | **Les vols mesurés** | `tests/flight/scenarios/a320.ts` : un vol de ligne au Bourget (TOGA, rotation au mini-manche, AP1, FCU : niveau, vitesse, virages de 90°, V/S, ILS, atterrissage automatique, arrêt), chaque phase mesurée (dépassements des captures, oscillations de tangage, d'inclinaison et de vitesse, inclinaison maximale, toucher) ; la campagne e2e A320 existante (19 fichiers) sur le mini | rapports du banc, verdicts chiffrés | **en cours** : campagne e2e A320 19 fichiers (15 ✓ ; `a320-start`/`ecam`/`rain` réparés — la texture à 8 couches depuis la livrée du trafic — ; `a320-approach-join` : l'AP compté coupé pendant ses 5 s d'engagement, test corrigé, relancé) ; vol de ligne `a320-line-lfpb` relancé (le premier figeait la simulation avant les systèmes) |
| V1 | **La physique et les lois** | d'après V0 : les boucles du FMGC (tangage par la vitesse, captures ALT/HDG, A/THR), la loi normale (`fbw.ts`), l'aéro calée sur FlightGear ; chaque correction un test unitaire au banc sans page quand c'est possible (`tests/helpers/flight.ts`) | V0 revolé : captures < 150 ft et < 5°, ≤ 2 inversions par minute en tenue, toucher < 3 m/s | à faire |
| K1 | **Les molettes du FCU** | Maj-clic sur une commande du poste = tirer (la propriété `devices/status/keyboard/shift` tenue à jour ; le regard au Maj-glisser hors d'une commande) ; Alt-clic = tirer aussi ; les manettes non déplacées par une touche tenue pendant un clic du poste ; un e2e à la vraie souris : SPD, HDG, ALT, V/S tirés puis poussés, le FMA lu | e2e `a320-fcu-knobs` | **fait** (26 nov., kerr-mini 4/4 : ALT tiré au Maj-clic → OP CLB, poussé → CLB, manettes 0,6 → 0,6 ; SPD, HDG, V/S). Reste : 20 crans de molette de cap n'ont tourné que de 5° (à comprendre) |
| W1 | **La roue de l'A320** | `ui/a320wheel.ts` : Autopilote (AP1/AP2, A/THR, FD, LOC, APPR, EXPED), FCU (SPD/HDG/ALT/V/S : pas ±, tirer/pousser), Configuration (volets par cran, train, aérofreins, autofrein, inverseurs, frein de parc), Approche (le secteur existant), Instruments (QNH/STD, ND mode et échelle, LS), Assistance (W2), Décollage facile, Caméra ; chaque action par les mêmes fonctions que les vrais boutons (FMGC, `deckgame`) | e2e `a320-wheel` à la vraie touche Tab | **fait** (26 nov., kerr-mini 4/4 : secteurs A320 sans ceux des vaisseaux ; décollage facile → THR CLB · CLB · AP1 · A/THR, train et volets rentrés, CL ; FCU › Altitude tiré → OP CLB ; ND ×2) |
| W2 | **Réel et assisté** | `settings.a320Assist` (`realistic` / `assisted`) : assisté — rotation à VR et assiette 15°, train rentré au vario positif, volets suivant les vitesses (F, S, green dot ; à l'approche), A/THR et AP proposés, FD ; réel — rien d'automatique ; une touche de décollage facile ; la tablette et la roue le règlent | e2e décollage assisté et réel | **en partie** : `settings.a320Assist`, `controller/a320assist.ts`, le décollage facile vérifié (a320-wheel) ; le niveau Assisté pendant un vol complet non volé par un e2e |
| G1 | **Les outils au FMGC** | `navSet` (LNAV seul, VNAV) ; `jet_mode` orbite/attente/suivi de terrain sur l'A320 → refus dit ou équivalent FMGC (HOLD du MCDU), jamais l'autopilote du F-35 ; TARS `autopilot`/`hold` sans objet → refus dit ; l'équipage et la carte tactique vérifiés de bout en bout | e2e outils ↔ FCU (le FCU du poste montre ce que l'outil a réglé) | **en partie** : `navSet` par le FMGC, orbite/suivi de terrain/attente du F-35 refusés sur l'A320 (dit), TARS `autopilot`/`hold` refusés ; pas d'e2e dédié |
| D1 | **La documentation** | VOL-AVIONS leçon 10 et §4, apprendre-avions.html, BH-API, COCKPIT.md (l'A320), E2E-CATALOGUE ; le compte rendu des examens | — | au fil des lots |

Ordre : V0 (en cours) → K1 et V1 (selon V0) → W1 → W2 → G1 ; la documentation dans chaque lot ; un commit poussé par lot.

## 2. Règles

- Tous les e2e et vols du banc sur kerr-mini, fenêtre visible (plein écran), **de jour** (le midi solaire du terrain), **par temps clair**
  (`weather: "fair"`, vent nul, `earthClouds: 0`) sauf un test de météo.
- Chaque fonction de la roue, de TARS et de l'équipage passe par ce que font les vrais boutons (le FMGC, les propriétés du poste) :
  le FCU et le FMA du poste montrent toujours l'état réel.
- Une recette du cours modifiée se revole par son e2e avant d'être écrite comme vraie.
