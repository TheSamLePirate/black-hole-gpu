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
| V0 | **Les vols mesurés** | `tests/flight/scenarios/a320.ts` : un vol de ligne au Bourget (TOGA, rotation au mini-manche, AP1, FCU : niveau, vitesse, virages de 90°, V/S, ILS, atterrissage automatique, arrêt), chaque phase mesurée (dépassements des captures, oscillations de tangage, d'inclinaison et de vitesse, inclinaison maximale, toucher) ; la campagne e2e A320 existante (19 fichiers) sur le mini | rapports du banc, verdicts chiffrés | **fait** (26 nov., kerr-mini, `a320-line-lfpb` **PASS** : 7 000 ft capturés à 0,6 ft, 4 000 ft à 3,4 ft, tangage 0,45° et vitesse 1,3 kt crête à crête en palier, virages 25,1°, caps à 0°, toucher 20/20 à 557 m, 0,23 m de l'axe, un seul contact ; avant les correctifs : 4 rebonds, posé à 1 720 m à 200 kt, ~10 m à gauche de la piste dessinée, sans freinage — causes : l'axe de l'ILS 07 du Bourget à 1,7° de la piste (`approach.ts` : l'axe de la piste dessinée), la vitesse sélectée gardée et la phase restée en croisière (`a320Approach` : SPD poussé, phase d'approche), l'autofrein non armé (armé avec le train). Avant ce PASS : campagne e2e A320 19 fichiers (15 ✓ ; `a320-start`/`ecam`/`rain` réparés — la texture à 8 couches depuis la livrée du trafic — ; `a320-approach-join` : l'AP compté coupé pendant ses 5 s d'engagement, test corrigé, relancé) ; vol de ligne `a320-line-lfpb` relancé (le premier figeait la simulation avant les systèmes) |
| V1 | **La physique et les lois** | V0 n'a montré **aucune oscillation** des boucles (tenues, captures, virages) ; ses défauts étaient ceux de l'approche (ci-dessus, corrigés). Restent d'après V0 : les boucles du FMGC (tangage par la vitesse, captures ALT/HDG, A/THR), la loi normale (`fbw.ts`), l'aéro calée sur FlightGear ; chaque correction un test unitaire au banc sans page quand c'est possible (`tests/helpers/flight.ts`) | V0 revolé : captures < 150 ft et < 5°, ≤ 2 inversions par minute en tenue, toucher < 3 m/s | à faire |
| K1 | **Les molettes du FCU** | Maj-clic sur une commande du poste = tirer (la propriété `devices/status/keyboard/shift` tenue à jour ; le regard au Maj-glisser hors d'une commande) ; Alt-clic = tirer aussi ; les manettes non déplacées par une touche tenue pendant un clic du poste ; un e2e à la vraie souris : SPD, HDG, ALT, V/S tirés puis poussés, le FMA lu | e2e `a320-fcu-knobs` | **fait** (26 nov., kerr-mini 4/4 : ALT tiré au Maj-clic → OP CLB, poussé → CLB, manettes 0,6 → 0,6 ; SPD, HDG, V/S). Reste : 20 crans de molette de cap n'ont tourné que de 5° (à comprendre) |
| W1 | **La roue de l'A320** | `ui/a320wheel.ts` : Autopilote (AP1/AP2, A/THR, FD, LOC, APPR, EXPED), FCU (SPD/HDG/ALT/V/S : pas ±, tirer/pousser), Configuration (volets par cran, train, aérofreins, autofrein, inverseurs, frein de parc), Approche (le secteur existant), Instruments (QNH/STD, ND mode et échelle, LS), Assistance (W2), Décollage facile, Caméra ; chaque action par les mêmes fonctions que les vrais boutons (FMGC, `deckgame`) | e2e `a320-wheel` à la vraie touche Tab | **fait** (26 nov., kerr-mini 4/4 : secteurs A320 sans ceux des vaisseaux ; décollage facile → THR CLB · CLB · AP1 · A/THR, train et volets rentrés, CL ; FCU › Altitude tiré → OP CLB ; ND ×2) |
| W2 | **Réel et assisté** | `settings.a320Assist` (`realistic` / `assisted`) : assisté — rotation à VR et assiette 15°, train rentré au vario positif, volets suivant les vitesses (F, S, green dot ; à l'approche), A/THR et AP proposés, FD ; réel — rien d'automatique ; une touche de décollage facile ; la tablette et la roue le règlent | e2e décollage assisté et réel | **en partie** : `settings.a320Assist`, `controller/a320assist.ts`, le décollage facile vérifié (a320-wheel) ; le niveau Assisté pendant un vol complet non volé par un e2e |
| G1 | **Les outils au FMGC** | `navSet` (LNAV seul, VNAV) ; `jet_mode` orbite/attente/suivi de terrain sur l'A320 → refus dit ou équivalent FMGC (HOLD du MCDU), jamais l'autopilote du F-35 ; TARS `autopilot`/`hold` sans objet → refus dit ; l'équipage et la carte tactique vérifiés de bout en bout | e2e outils ↔ FCU (le FCU du poste montre ce que l'outil a réglé) | **en partie** : `navSet` par le FMGC, orbite/suivi de terrain/attente du F-35 refusés sur l'A320 (dit), TARS `autopilot`/`hold` refusés ; pas d'e2e dédié |
| D1 | **La documentation** | VOL-AVIONS leçon 10 et §4, apprendre-avions.html, BH-API, COCKPIT.md (l'A320), E2E-CATALOGUE ; le compte rendu des examens | — | au fil des lots |

### Lots ajoutés le 26 nov. 2026 (Sam : « sur le radar de l'A320, tous les éléments visuels — routes, prédictions, relief… —, toutes
les options ; de vrais vols avec le pilote automatique AAA et tous les instruments : décollage, couloirs aériens, route, approche,
atterrissage ; idem pour tous les instruments de l'A320 »)

Inventaire du 26 nov. (code à `4c4b61de`) : le ND a ses modes, ses échelles, le plan actif (une ligne verte), l'approche interrompue
en cyan, le TCAS, la carte d'aéroport, l'ILS en ROSE ILS, ARPT et CSTR ; il **manque** le cap sélecté, le plan temporaire jaune, les
pseudo-points (T/C, T/D, DECEL, flèches de palier), les virages courbes, les couches WPT/VOR.D/NDB, les aiguilles VOR/ADF, **TERR**
(relief EGPWS), **WXR** (météo), l'écart vertical. Le PFD a sa bande de vitesse complète et son FMA ; y sont **cachés ou absents** le
repère de cap sélecté et l'aiguille de route ILS, la cible d'altitude magenta (contrainte), DH/MDA et « MINIMUM », les boîtes des
modes armés et la capacité CAT, VR, le vecteur vitesse (TRK/FPA), l'écart vertical, les balises. Le FMS **n'a pas** de base de
navigation (VOR, NDB, points, voies aériennes), ni SID/STAR, ni voies aériennes, ni attente, ni discontinuités, ni profil vertical
géré (contraintes, T/D, DECEL — `cstr: null` dans `a320ap.ts`), ni prédictions par point.

| # | Lot | Contenu | Preuve attendue | Statut |
|---|---|---|---|---|
| N1 | **La base de navigation** | VOR, NDB, DME de `nav.dat` (déjà dans `assets/approaches/raw`), points et voies aériennes (source à choisir : CIFP de la FAA — public, États-Unis — et/ou `fix.dat`/`awy.dat` de FlightGear — GPL, monde, à télécharger) → `assets/nav/v1` par tuiles, `world/navdb.ts` ; `resolveWp` du MCDU les trouve | MCDU : un point, un VOR, une voie aérienne insérés | **fait** (26 nov. : `scripts/build-navdb.ts` → `assets/nav/v1`, 11 590 aides, 119 720 points, 70 291 segments, 1 443 tuiles ; `world/navdb.ts` ; MCDU F-PLN par identifiant ; ND VOR.D/NDB/WPT ; tests `navdb` 3/3, `a320-mcdu` 8/8) — **source décidée par Sam (26 nov.) : CIFP de la FAA aux États-Unis (SID, STAR, voies) + fix.dat/awy.dat de FlightGear (GPL v2) pour le monde** |
| N2 | **SID, STAR, voies aériennes au MCDU** | DEPARTURE (SID, transition), ARRIVAL (STAR, VIA), AIRWAYS (VIA/TO), discontinuités, HOLD ; procédures du CIFP (États-Unis) | e2e MCDU : un plan KSFO → KLAX par SID, voie aérienne, STAR, ILS | **en partie** : AIRWAYS (VIA/GO TO, F-PLN écrit la voie) et **DEPARTURE (piste, SID, transition) et ARRIVAL › STARS/TRANS** (CIFP, 755 aéroports US ; `world/terminals.ts`) faits le 26 nov. — test MCDU KSFO 10L CIITY3.DEDHD → KLAX SADDE8.FIM ; discontinuités, HOLD, branches sans point (VA), limites de vitesse, e2e au poste à faire |
| N3 | **Le profil vertical géré et les prédictions** | contraintes du plan au FMGC, montée/descente gérées sur profil, T/C, T/D, DECEL (phase d'approche activée d'elle-même), VERT REV ; temps, altitude et carburant prévus par point (F-PLN, PROG) | vol du banc : contraintes tenues, descente au T/D | **fait en simulation** (26 nov.) : contraintes tenues (ALT CST) ; profil vertical géré (`fmgc/vprofile.ts` : chemin à 3° bâti à rebours, palier de décélération au FL100 et avant l'approche, contraintes de montée/descente séparées) ; DES armé en croisière, engagé au T/D, chemin suivi (VDEV ≤ 211 ft), MORE DRAG, phase approche au DECEL ; l'ALT tient l'altitude capturée ; ND : T/C, T/D, DECEL, contraintes magenta/ambre ; F-PLN : (T/C) (T/D) (DECEL), prédictions ; PFD : VDEV, MORE DRAG. Pas encore : VERT REV, carburant prévu par point, message DECELERATE, vol au banc (V2) |
| I1 | **Le ND complet** | (fait le 26 nov. : cap sélecté en bleu sur la rose) ; virages courbes, branche FROM, plan temporaire jaune, pseudo-points, couleurs des contraintes, WPT/VOR.D/NDB, aiguilles VOR/ADF et ROSE VOR, **TERR** (relief EGPWS par `groundRelief`), **WXR** (`weather.ts`), écart vertical, messages | captures du ND dans chaque mode, chaque option | à faire |
| I2 | **Le PFD complet** | (fait le 26 nov. : repère de cap sélecté et aiguille de route ILS sur la bande, chiffres en bout de bande) ; cible magenta, DH/MDA et MINIMUM, boîtes et capacité CAT du FMA, VR, FPV/FPD, écart vertical, balises, messages | captures du PFD aux phases du vol | à faire |
| I3 | **Les autres instruments** | ISIS (échelles ILS), horloge/chrono, DCDU, pages MCDU manquantes (VERT REV, HOLD, DEPARTURE, AIRWAYS, SEC F-PLN, données) | captures | à faire |
| V2 | **Le vrai vol IFR** | au banc : porte → repoussage → roulage → SID → voie aérienne → STAR → ILS → atterrissage → poste, au pilote automatique, de jour, temps clair, chaque instrument capturé | rapport du banc, captures | à faire |

Ordre : V0 (en cours) → K1 et V1 (selon V0) → W1 → W2 → G1 → I2 et I1 (ce qui ne demande pas de base de navigation) → N1 → N2 → N3 → V2 ; la documentation dans chaque lot ; un commit poussé par lot.

## 2. Règles

- Tous les e2e et vols du banc sur kerr-mini, fenêtre visible (plein écran), **de jour** (le midi solaire du terrain), **par temps clair**
  (`weather: "fair"`, vent nul, `earthClouds: 0`) sauf un test de météo.
- Chaque fonction de la roue, de TARS et de l'équipage passe par ce que font les vrais boutons (le FMGC, les propriétés du poste) :
  le FCU et le FMA du poste montrent toujours l'état réel.
- Une recette du cours modifiée se revole par son e2e avant d'être écrite comme vraie.
