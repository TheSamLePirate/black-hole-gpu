# PLAN-AEROPORT-AAA — les atterrissages du trafic réel, et la vue Aéroport

> **État (26 nov. 2026)** : le mode Aéroport (V6–V12) est sur `main`, en mode normal. V6 à V11 sont faits, vérifiés en unitaire et
> vus sur ce Mac en headless avec le vrai trafic de KLAX ; les radios n'ont pas encore été écoutées. V12 (e2e sur le mini) reste à faire. Les lots L1–L5 / V1–V5 ci-dessous datent de la branche `worktree-airliners-runway` (29 oct.), jamais
> fusionnée : L1–L5 sont arrivés sur `main` par d'autres chemins (`traffic/landing.ts`, `traffic/runway-phase.ts`) ; V1–V2 ont été
> repris le 26 nov. (V6).

(2026-10-29, suite de la branche `worktree-airliners-runway` : plancher sur la piste, atterrissage reconstitué sur
l'axe pendant le trou des reports ADS-B, caméra libre sur le trafic.)

## But

1. **L'atterrissage d'un avion de ligne réel, de qualité AAA** — vu de près, il doit se poser comme un vrai :
   approche stabilisée sur le plan de descente, arrondi, toucher sur le train principal, dérotation, spoilers et
   inverseurs, freinage, sortie de piste en courbe, fumée des pneus.
2. **La vue Aéroport** — pour un aéroport choisi, la caméra regarde chaque avion qui s'y pose, l'un après l'autre,
   filmé par un réalisateur au choix.

## Décisions (par défaut — à corriger par l'utilisateur)

- Tout aéroport du monde (base OurAirports du jeu) : par son code OACI/IATA, ou le plus proche de la vue.
- La vue Aéroport est une vue de la caméra libre (spectateur, F3) : l'appareil piloté reste où il est ; le flux
  ADS-B est centré sur l'aéroport tant que la vue est active (et non sur l'appareil piloté).
- Le trafic reste dessiné une minute derrière le temps réel (réglage existant) : la file des arrivées connaît la
  minute qui vient.
- Réalisateurs : **Auto** (montage selon la phase), **Tour** (téléobjectif depuis la tour), **Seuil** (spotter sous
  l'approche, l'avion passe au-dessus), **Bord de piste** (zone de toucher, objectif qui suit), **Poursuite**,
  **Cockpit**, **Drone** (grue lente autour). Les caméras au sol restent du même côté de l'axe (règle des 180°).
- Le rig complet de l'A320 (train, volets, spoilers, inverseurs, phares) pour les avions de la famille A320 proches
  de la vue ; les autres types gardent leur mesh simple (et leur attitude AAA).
- FR + EN partout (i18n), unités du jeu (unitsFor).

## Phases

| Phase | Contenu | Vérification |
|---|---|---|
| L1 | Profil vertical : plan de descente 3° vers le point d'aboutissement (300 m), arrondi depuis 15 m (taux de chute → ~0,8 m/s), dans l'atterrissage reconstitué | unitaire : taux de chute au toucher, pas de marche |
| L2 | Attitude : assiette d'approche, cabré de l'arrondi, toucher sur le train principal, dérotation de la roulette de nez sur ~4 s | unitaire : assiette au toucher, dérotation continue |
| L3 | Rig A320 des avions de ligne proches (≤ 4 km de la vue) : train sorti sous 600 m, volets FULL, phares, spoilers au sol déployés au toucher, inverseurs jusqu'à 70 kt, N1 | e2e : props lus |
| L4 | Roulage : inverseurs + autobrake (~2,6 m/s²) jusqu'à 35 m/s, freinage doux jusqu'au roulage, sortie de piste en courbe (rayon ~150 m) vers le taxiway | unitaire : décélération, courbe continue |
| L5 | Fumée des pneus au toucher (traînées type 8), aux roues principales | e2e : image |
| V1 | Réalisateur pur (`src/cine/airport.ts`) : plans Tour/Seuil/Bord/Poursuite/Cockpit/Drone, montage Auto par phase, focale à ressort, tremblé caméra à la main | unitaire : chaque plan cadre l'avion, coupes ≥ 3 s |
| V2 | File des arrivées (`src/controller/airportview.ts`) : avions alignés sur une piste de l'aéroport, ETA, le suivant après le roulage ; flux centré sur l'aéroport | unitaire : ordre par ETA, bascule |
| V3 | Panneau caméra › Aéroport (code, réalisateur, file, suivant), bandeau « broadcast » (indicatif, type, immatriculation, piste, ETA) | e2e : vrais clics |
| V4 | `__bh.airport` ; e2e vidéo 720p à Roissy, réalisateur Auto, plusieurs atterrissages | kerr-mini |
| V5 | docs/CAMERA.md (FR + EN) | — |

## État (2026-10-29)

Tout est fait : L1–L5 (8af6ecff), V1–V5 (741789dd + correctifs). e2e `airport-view` sur kerr-mini : une arrivée réelle
à Roissy filmée en 720p par le Réalisateur (BTI3FL A220-300, 09L : tour → poursuite → seuil → bord de piste →
poursuite ; roues jamais sous le sol ; 0 image de roulage rapide hors piste sur 713 ; bandeau 100 %).

Leçons : un film image par image (≈ 1 s réelle par image) laisse le temps réel filer — le flux ADS-B doit être gelé
après avoir couvert la durée du film (son historique d'un quart d'heure et la fenêtre du chemin lissé perdraient les
reports de l'instant dessiné) ; l'ETA d'un atterrissage reconstitué se compare à l'instant dessiné (horloge du trafic
moins son différé), pas à l'horloge du trafic ; un avion aligné mais trop haut pour sa distance (≥ 5°) n'arrive pas.

Limites : la fumée des pneus n'apparaît qu'à moins de 8 km de l'appareil piloté (repère des traînées) ; les types hors
famille A320 gardent leur mesh simple (CRJ-900 pour les A220) ; la livrée de l'A320 est celle du joueur.


## Le mode Aéroport (26 nov. 2026 — demandes de Sam)

« Crée un mode de jeu : vue Aéroport. On sélectionne un aéroport et on regarde les avions de ligne décoller et atterrir, un mode
super réalisateur. » Puis : « dans ce mode, pas de HUD ni d'UI (à part le menu du haut qui se masque comme d'habitude) ; une UI avec
la liste des avions, les files (sélectionnables pour voir leurs infos et les suivre) ; le mode super réalisateur cinématographique ;
le bandeau télé ; les sons des radios (générés à partir des données) ».

Choix par défaut (à corriger par Sam) :

- **Le trafic est réel** (ADS-B : adsb.lol, OpenSky en secours ; `server/traffic.ts`), dessiné une minute derrière le temps réel.
  Aucun avion de ligne simulé : un aéroport sans trafic réel reste vide. **L'heure du jeu est réglée sur l'instant dessiné** au
  démarrage du mode (maintenant moins le différé) : la lumière est celle du lieu ; de nuit, il fait nuit.
- La vue reste celle de la caméra libre (spectateur) ; l'appareil piloté reste où il est.

| Lot | Contenu | Vérification | État |
|---|---|---|---|
| V6 | Reprise sur `main` de `cine/airport.ts` et `controller/airportview.ts` (la branche avait 1 692 commits de retard) ; `subjectView: "airport"` ; `__bh.airport` ; panneau caméra › Aéroport | `tests/airport-view.test.ts` (7) | **fait** |
| V7 | **Les décollages** : `departuresOf` (aligné sur la piste au sol, roulage de décollage, montée initiale dans l'axe), une seule file triée par secondes avant l'événement (`movementsOf`) ; plans **Rotation** (bord de piste là où il tourne) et **Montée initiale** (sous l'axe après le bout de piste) ; Auto : tour → rotation → montée → poursuite ; un départ arrêté plus d'une minute cède à un mouvement dû dans les 20 s | unitaire `departuresOf`, `movementsOf` (un roulage de décollage était pris pour une arrivée au roulage — corrigé) ; vu à KLAX (un départ en file) | **fait** (non filmé de bout en bout) |
| V8 | **L'interface du mode** : `body.airport-mode` cache HUD et panneaux (ce que H cache, sauf la barre du haut) et les étiquettes de l'overlay, le marqueur du vaisseau du HUD ; `ui/airportui.ts` : l'aéroport, le réalisateur, la fiche de l'avion filmé (indicatif, compagnie, immatriculation, type, phase, altitude, vitesse, vario, piste, compte à rebours), les files **Arrivées / Départs / Autour de l'aéroport**, chaque ligne cliquée suivie (cliquée à nouveau : rendue au réalisateur), repliable ; **le bandeau télé** (DÉPARTS / ARRIVÉES, indicatif · type, immatriculation · piste · compte à rebours, plan en cours) | vu à KLAX (captures : A319 Delta en finale en poursuite, A321 Air Canada au toucher en bord de piste, 7 arrivées et 27 avions autour) | **fait** |
| V9 | **Le réalisateur Cinéma** (le mode par défaut) : les plans de chaque phase tirés tour à tour, tenus 6 à 12 s (jamais deux fois le même de suite) — approche lointaine : tour, aile, poursuite, cockpit, drone ; finale : poursuite, aile, tour ; toujours le seuil en courte finale et le toucher au bord de piste ; un départ : alignement (derrière lui en bout de piste), tour, cockpit, puis rotation, montée initiale, poursuite, aile, drone — ; deux plans nouveaux, **Aile** (en formation) et **Alignement** ; plans d'attente (un avion qui roule, filmé) quand aucun mouvement n'est en file ; **bandes cinéma** 2,39:1 (oui par défaut) ; la fiche donne la phase du mouvement | unitaire : Cinéma filme un atterrissage (20 plans en 170 s, 5 sortes, ≥ 3 s, seuil et toucher tenus), chaque plan cadre l'avion ; vu à KLAX (B747 cargo : tour → aile → seuil → toucher → poursuite ; 737 en formation) | **fait** |
| V10 | **Les radios** (`src/traffic/atc.ts`) : les échanges tour / équipages faits à partir des mouvements, chacun une fois, en phraséologie OACI anglaise — arrivée : appel en finale, « cleared to land », collationnement ; dégagement, « contact Ground » ; départ : prêt au point d'attente, « line up and wait », « cleared for takeoff » au roulage, « contact Departure » en montée —, indicatifs en radiotéléphonie (60 compagnies, sinon épelés), pistes et chiffres un par un ; dits par la file des voix (`audio/voice.ts` : la tour — Deepgram en bande radio quand joignable, sinon la voix du système —, les équipages par une autre voix, locuteur `pilot`), squelch et souffle ; les trois dernières lignes dans le panneau | unitaire `airport-atc` (mots, ordre, une fois) ; vu à KLAX (lignes envoyées à la voix ; **non écouté** : headless) | **fait** (écoute à faire) |
| V11 | **Le mode à l'écran titre** : 5ᵉ carte « Aéroport » (entre En vaisseau et Caméra libre) ; son écran propose 12 grands aéroports avec leur heure locale (jour/nuit) et une recherche (code ou nom, `airportSearch`) ; lancé : une scène avec appareil si aucun n'est piloté (la caméra libre en sort), puis la vue en Cinéma (`TitleGame.airport`) | `title-activities` (5 modes, aéroports, heure locale) ; vu (headless, ce Mac) : titre à 5 cartes, recherche « nice » → LFMN, KLAX lancé (Cinéma, 7 en file, radio) | **fait** |
| V12 | e2e sur kerr-mini (affiché) : un aéroport chargé, un atterrissage et un décollage filmés par le Réalisateur, la file cliquée, captures | kerr-mini | à faire |
