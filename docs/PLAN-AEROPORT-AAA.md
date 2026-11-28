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

### Les avions de ligne parfaits (26 nov. 2026 — Sam : « assure-toi que les avions de ligne ont tous les effets et soient parfaits au
décollage, à l'atterrissage », « et les effets atmosphériques »)

Inventaire du 26 nov. : l'atterrissage du trafic avait son traitement AAA (L1–L5 : plan, arrondi, toucher, dérotation, spoilers,
inverseurs, freinage) ; le décollage aucun ; les effets atmosphériques de l'A320 (vapeur, tourbillons, fumée des pneus, gerbes, flux des
inverseurs) étaient réservés à l'A320 piloté, les traînées du trafic à moins de 30 km de l'appareil piloté — dans la vue Aéroport (un
vaisseau en orbite) : aucun.

| Lot | Contenu | Vérification | État |
|---|---|---|---|
| V13 | **Le décollage du trafic** : rotation au roulage (assiette 0 → 9° de VR − 10 à VR − 4 m/s), assiette limitée à 4°/s (plus de saut à l'envol), train rentré à la montée confirmée (10 m, était 150 m), aligné sur la piste : volets 1+F et phares | `traffic-runway` (rotation 9°, ≤ 4°/s, train à 10–80 m) | **fait** |
| V14 | **Les effets du trafic** : `trafficConfig` partagé gréement/effets ; les effets de l'A320 (`a320/effects.ts`) générés pour les 6 avions de ligne en mouvement les plus proches (celui filmé d'abord), à leur taille, dans la météo du lieu ; **la vue Aéroport gare un A320 au parking** de l'aéroport (le repère des effets, la météo et les distances sont ceux de l'appareil piloté) | observé à KLAX (headless) : tourbillons en approche, fumée des pneus au toucher (ASA412) ; vapeur et gerbes non vues (temps sec ce matin-là : leur seuil d'humidité, de pluie) | **fait** |
| V15 | Le gréement complet (volets, becs, train, spoilers, inverseurs, N1, phares) pour **l'avion filmé quelle que soit sa distance** (les autres : 4 au plus, à moins de 4 km de l'œil) ; feux 3D (cônes, halos dans la brume) : à faire | unitaire trafic | **fait** (gréement) ; feux 3D à faire |
| V16 | **Le son du trafic** (`audio/engine.ts` `trafficFrame`, `traffic.ts` `trafficSounds`) : deux voix, les avions en mouvement les plus proches de l'œil (l'avion filmé d'abord), chacune un grondement et le sifflement de la soufflante (~30 × N1 Hz), plus fort et plus clair à l'inversion, l'air qui étouffe les aigus avec la distance, le Doppler | vu à KLAX (headless : deux voix, distances, N1, vitesse radiale) ; **non écouté** | **fait** (écoute à faire) |
| V17 | **La météo sur le trafic** : la dérive au vent de travers — le nez sur le cap rapporté par l'ADS-B, la route sur sa trajectoire (le vrai crabe du moment), 20° au plus, réponse amortie 3 s et limitée à 2°/s, décrabage progressif entre 15 et 1 m AGL puis amorti au sol ; piste mouillée et pluie (gerbes : V14 selon la pluie du lieu) | `traffic-runway` (crabe 10,0° du bon côté), `traffic-attitude` (limite de vitesse, convergence, décrabage sans saut) | **fait** (crabe) |

26 novembre 2026, complément V17 : le panneau aéroport affiche la météo simulée (préréglage,
vent/rafales à 10 m, visibilité, couches AGL, température et QNH si disponibles) et le METAR brut
de la station choisie, consulté indépendamment du mode météo. Chargement et absence de bulletin sont explicites ;
le bulletin garde son groupe horaire UTC. Cache METAR existant conservé (30 min, échec 5 min).
La section météo reste visible quand les listes sont repliées. Le crabe est une attitude de restitution ADS-B,
pas une nouvelle simulation aérodynamique du trafic ; aucune dérive inventée sans cap rapporté.

## V18–V24 — Expérience enrichie (Sam, 26–27 novembre 2026)

Choix : compléter l'activité quand les données manquent ; météo réelle de l'aéroport faisant autorité.
Les observations gardent priorité, aucun mouvement complémentaire n'est attribué à un vrai vol.

- **V18, chronologie** : cap, route, vitesse et roulis interpolés sur l'instant retardé ; cap absent conservé nul,
  correction du parseur `null → 0`. Position ADS-B non dérivée une seconde fois par le vent. La vitesse publiée
  estime le déplacement dessiné, filtré et borné en accélération pour éviter le bruit des différences finies.
- **V19, météo/crabe** : météo réelle forcée dans ce mode, préréglage précédent restauré à la sortie. Vent
  local estimé avec le profil vertical existant, vitesse dans l'air = sol − vent. Crabe amorti, décrabage selon
  le temps estimé avant le contact (vitesse de lacet plafonnée à 6°/s dans cette phase). Légère aile au vent.
- **V20, familles/contact** : profils light/regional/narrow/heavy, rotations et vitesses de roulis distinctes,
  vitesse équivalente estimée pour le rig, roulette selon courbure/empattement, contacts indépendants des trois
  trains et compression d'impact amortie ; fumée des pneus pilotée par ces contacts.
- **V21, roulage observé** : réseau `airportnet` partagé, raccordement des trous entre rapports au sol sur un
  chemin faisable, virages arrondis ; sans réseau, trajet déconnecté ou vitesse impossible : observations conservées.
- **V22, activité complémentaire** : un seul avion explicitement `SIM` à la fois, réseau et poste cartographiés
  requis ; recul, pause, taxi, point d'arrêt, piste libre durablement selon les positions observées et leur projection,
  alignement par le réseau, accélération puis montée. Pas de traversée de piste pendant le taxi libre. Piste trop
  courte ou raccordement inconnu : attente. Priorité aux observations, arrêt devant un conflit ; retrait de l'acteur complémentaire si une nouvelle observation apparaît à moins de 60 m au sol. Bouton du panneau,
  `__bh.airport.activity` et TARS `airport_activity` permettent l'inspection et l'arrêt de cette activité.
- **V23, feux/effets** : feux retirés du canvas, nouvelle passe `traffic lamps` après la profondeur des avions et les historiques temporels,
  source et halo occultés ; secteurs directionnels. Transformation d'attache partagée entre feux et traînées,
  modèle statique/rig, échelle et décalage vertical compris ; sujet d'attente (`filler`) conservé aussi.
- **V24, caméra** : hauteur minimale au-dessus du relief ; en Auto/Cinéma, sujet masqué durablement : essai
  d'un autre point de vue pendant quelques secondes. Un plan choisi manuellement reste choisi.

Preuves : tests `traffic-experience`, `traffic-attitude`, `traffic-runway`, `traffic-selection`, `airport-view`,
`tars-tools` ; e2e `traffic-lamps` (occlusion WebGPU) et `airport-experience` (météo, modèles, sources, sortie du mode).
Les résultats exacts de livraison sont consignés dans le journal.

Limites : profils visuels plausibles, pas des performances certifiées ; réseau OSM parfois absent/incomplet ;
activité complémentaire limitée aux routes effectivement connectées, une seule réservation synthétique ;
prévision des conflits fondée sur les données reçues, sans connaissance des clairances du vrai contrôle aérien.
Les silhouettes A320/CRJ restent utilisées pour les types sans modèle dédié.
Le vent en altitude reste estimé ; les balises/feux du trafic n'éclairent pas physiquement le sol.

### Boeing — 27 novembre 2026

B738, B744, B772 et B77W utilisent désormais quatre extérieurs FGAddon distincts, avec cartes
neutralisées, couleurs de compagnie, attaches propres au modèle et quatre moteurs pour le 747.
Sources, auteurs, licences et conversion : `assets/traffic/boeing/README.md`. Les autres variantes
737/747/777 sont des représentations mises à l’échelle ; les 757/767/787 gardent le fallback.
Trains, volets, spoilers, gouvernes et fans articulés par les fichiers FlightGear (27 nov., seconde passe). Aucun cockpit Boeing
ni modèle de vol nouveau. Pas de coût GPU mesuré ni de validation artistique exhaustive AAA.

### Qualité des avions et émissions — 27 novembre, seconde passe

CRJ900 remplacé par l’extérieur articulé FGAddon (63 nœuds, ~50 714 triangles). Boeing :
80/132/100/104 nœuds pour B738/B744/B772/B77W. La livrée ne remplace plus l’adresse du gréement
de l’A320. Les LOD gardent les frontières de pièces mobiles, les normales suivent leurs rotations.
Vitrage/chrome Boeing distingués, peinture moins métallique et trains plus mats.
Les feux du CRJ reprennent ses positions XML.

Traînées corrigées dans le repère WGS84 et occultées par toutes les silhouettes articulées avant
composition de la profondeur de scène. Émissions de volets liées à leurs triangles et articulations.
E2E `airliner-fx` : un seul avion à l’image, condensation humide et croisière par modèle ;
`traffic-trails` : occlusion GPU avec témoin visible et bord partiellement masqué.
Limites : certains canaux sans observation ADS-B (compression des amortisseurs, flexion sous charge,
timonerie asservie) restent au repos ; les animations importées ici sont rotate/translate/spin.
Les silhouettes de substitution des familles non livrées et les cockpits restent hors de ce lot.
Le terme AAA demeure une destination, pas une certification artistique exhaustive ou de cadence.

### 28 novembre 2026 — interface observatoire et météo choisie

Le panneau Airport propose météo réelle ou météo du jeu (préréglages communs ; vent réglable pour le temps clair). La boucle Airport ne réimpose plus `real`. Le trafic supplémentaire lit la météo choisie ; le rendu et la physique gardent leur autorité commune. La météo précédente est restaurée à la sortie. Les réglages restent accessibles par TARS `set_settings` (`weather`, `wind`).

Habillage observatoire sombre, météo graphique (direction du vent, ciel, visibilité, température/QNH si disponibles), METAR dépliable distinct des conditions effectivement simulées. Horloge civile réelle de l’aéroport, fuseau IANA par `tz-lookup` CC0 puis `Intl` pour le changement saisonnier (frontières géographiques approximatives de la bibliothèque). Fiche du vol filmé aussi pour les plans d’attente : télémétrie principale, phase, hauteur sol, dimensions, train, provenance et âge du relevé. Commandes réalisateur dépliables. Aucun itinéraire ou horaire commercial inventé.

#### Révision visuelle — 28 novembre, retour de Sam

La colonne de cartes a été retirée : overlay aux quatre bords de l’image, typographie et ambre du HUD (`--font`, `--mono`, `--hud-font`, `--accent`), fonds en dégradés discrets et traits fins. Identité/heure à gauche, météo à droite, télémétrie du vol en bas à gauche, listes d’arrivées/départs/proximité par onglets en bas à droite ; réalisateur au bord inférieur. Le bandeau historique est masqué pour éviter une seconde identité du même vol. Les faits secondaires du vol sont dépliables. Icônes météo vectorielles, pas d’emoji. Sous 620 px, repli en disposition verticale scrollable.

#### Commandes complètes toujours accessibles — 28 novembre

La barre inférieure reste visible, même lorsque les listes sont repliées : Cinéma, Auto et les dix angles fixes, descriptions au survol et état sélectionné, mode réalisateur / angle effectivement filmé, mouvement suivant, libération du suivi, bandes cinéma et trafic complémentaire. Bouton « Réglages caméra » vers le panneau caméra commun (objectifs et autres réglages existants), au-dessus de l’overlay. Le réalisateur conserve l’autorité sur le cadrage de ses plans. Les zones télémétrie/mouvements sont relevées pour laisser cette barre accessible.
