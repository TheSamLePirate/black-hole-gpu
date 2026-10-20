# Les vaisseaux — Ranger, Lander, Endurance

*[English version](VAISSEAUX.md)* — *à jour au 2026-10-20*

Trois vaisseaux amenés au niveau du F-35, seul ou en salle : le **Ranger** (l'avion spatial agile), le **Lander**
(la grue lourde de la descente motorisée) et l'**Endurance** (le vaisseau-mère lent, à l'anneau tournant), des deux
côtés du trou de ver. Quatre niveaux d'assistance et une touche de récupération, des protections automatiques, le
maintien à poste, un rendez-vous complet façon ISS, un désignateur de point d'atterrissage, un plan de mission
éditable, des consommables et des pannes avec leurs checklists, un HUD par vaisseau, une roue de onze secteurs, une
disposition manette et HOTAS, trois cockpits, une voix par vaisseau, des comptes rendus de phase sur 20, une école
spatiale de quinze leçons, sept défis, une bibliothèque de missions et la campagne Interstellar — et tout cela à
plusieurs : la flotte de la salle, les ordres, le partage, un copilote à bord, la passation du manche, les défis de
salle et les missions coopératives à rôles.

- Le plan : [PLAN-VAISSEAUX-AAA.md](PLAN-VAISSEAUX-AAA.md) — le vol (X0–X5), la console crew (K1–K7), l'immersion
  (X6–X8), l'école, les défis et les missions (X9–X11), le réseau (N1–N6).
- Les planches : [`docs/progress/vaisseaux/`](progress/vaisseaux/) (une par étape, avec ses images et ses mesures).
- Ce qu'en sait TARS : la base de connaissances [`docs/spatial/fr/`](spatial/fr/orbits.md) (six pages :
  [les orbites](spatial/fr/orbits.md), [les manœuvres](spatial/fr/maneuvers.md),
  [le rendez-vous et l'amarrage](spatial/fr/rendezvous-docking.md),
  [la rentrée et l'atterrissage](spatial/fr/entry-landing.md),
  [les systèmes et les urgences](spatial/fr/systems-emergencies.md), [la relativité](spatial/fr/relativity.md)).
- Jouer ensemble : [NETWORK.fr.md](NETWORK.fr.md) ; la console crew : [CREW.md](CREW.md) ; le HUD :
  [HUD.md](HUD.md) ; manettes et HOTAS : [HOTAS.md](HOTAS.md) ; les cockpits : [COCKPIT.md](COCKPIT.md) ; le
  chasseur : [F35.fr.md](F35.fr.md).

Les unités sont métriques par défaut (m, m/s, km, t, kWh), impériales en option (Réglages › Jeu › Aides HUD ›
Unités) ; les chiffres ci-dessous sont ceux que mesure le jeu.

## Les trois vaisseaux

| | Ranger | Lander | Endurance |
|---|---|---|---|
| Masse | 40 t | 160 t | 900 t |
| Moteurs | 2, des ailes, un train à roues, un bouclier | 6 en deux nacelles, des patins | 4, l'anneau (tout le vaisseau tourne) |
| Facteur de charge limite | 9 g | 6 g | 1,5 g |
| Batterie | 60 kWh | 120 kWh | 2 MWh |
| Se pose · vole dans l'air | oui · oui (en avion dans l'air, F) | oui · non | non (refus expliqué) · non |
| Son panneau au HUD | le HUD commun (Atmosphère, Espace, Approche) | DESCENTE | celui du vaisseau-mère, titré ENDURANCE |
| Sa voix | la référence, vive | lourde et grave (moteur ×0,72) | profonde et lente (moteur ×0,48) |

Les réservoirs de l'Endurance valent 22 fois ceux du Ranger (elle pèse 22 Rangers) ; son équipage compte douze
personnes, celui du Ranger quatre (40 kg d'oxygène : 11,9 jours).

## Pour commencer

- **K** (ou, hors vol, la roue : Tab maintenu › **Piloter**) prend le Ranger ; **[ · ]** (^ · $ sur un AZERTY
  français) passent au Lander et à l'Endurance — les vaisseaux quittés poursuivent leur route, en tournant comme
  avant. Près de Gargantua, [ ] ne mènent qu'à un vaisseau amarré à celui qu'on pilote, ou à moins de 10 km.
- **Placer le vaisseau** (la roue, hors vol) : une orbite, un sol, un site — le panneau Placer.
- **Les scènes** (les préréglages de la galerie) mettent un vaisseau en situation : « Amarrage à l'ISS »,
  « l'Endurance à 800 km », « le Lander à 500 km », « l'Endurance en vrille, 300 km », « Gargantua : le Ranger près
  de l'Endurance » (à 150 m de son port avant, à 0,24 c autour du trou) et « Mann : l'Endurance en vrille »
  (l'amarrage du film, 3 tr/min).
- **L'école spatiale, les défis et les missions** : Tab maintenu › **École et défis** (dans un vaisseau, l'école
  spatiale passe en premier, l'école de pilotage ensuite).
- Le F-35 a sa propre page : [F35.fr.md](F35.fr.md).

## Assistance et récupération (Réglages › Jeu › Engins spatiaux)

- **Assistance** :
  - **Manuel** : pas de SAS — le manche accélère la rotation, qui garde son élan jusqu'à ce qu'on l'arrête à la
    main ;
  - **Réaliste** (par défaut) : le SAS tel que le pilote le règle (T) ;
  - **Assisté** : SAS toujours actif ; à moins d'1 km d'un vaisseau ou de la station, le RCS relâché annule la
    dérive par rapport à lui (mesuré : 0,30 m/s de dérive à 150 m de l'Endurance → 0,002 m/s en 20 s) ;
  - **Débutant** : la même chose à moins de 2 km, rotations à moitié, jamais de panne.
  La puce SAS du HUD dit le niveau (`SAS`, `MANUEL`, `SAS · ASSISTÉ`, `SAS · DÉBUTANT`, `SAS · DÉRIVE ANNULÉE`,
  `RCS TRANSL.`) ; la touche T explique quand le niveau impose le SAS.
- **⇧X — Récupérer**, à tous les niveaux : au-dessus d'un sol à moins de 3 km, **vol stationnaire** aussitôt ;
  sinon maintiens et autopilotes coupés, moteur coupé, **rotation arrêtée**, puis **prograde maintenu** en orbite
  (près d'un vaisseau : l'attitude gardée, la dérive annulée). Le manche repris annule la récupération. Mesuré :
  le Ranger en culbute à 18°/s à 100 km de la Lune, stable et prograde en 0,6 s ; le Lander en chute à 1,5 km de
  Tranquillité, en stationnaire, dérive sous 2 m/s après 25 s. Un Ranger en mode avion reçoit la récupération du
  F-35 (ailes à plat, montée douce).
- **Protections automatiques** (activées par défaut), **Pannes** (aucune · rares, environ une en 20 h ·
  réalistes, une en 3 h · difficiles, une en 1 h 30 ; tirage graine), **Consommables**, **Ergols infinis**. La
  maniabilité du Ranger (vitesse de rotation…) a son propre groupe.

## Touches (noms QWERTY — les touches physiques : AZERTY entre parenthèses)

| Touches | Quoi |
|---|---|
| W S · A D · Q E (Z S · Q D · A E) | Tangage · lacet · roulis |
| Maj · Alt (ou ↑ ↓) | Plus · moins de poussée (maintenu) |
| Z · X (W · X) | Plein gaz (en approche de l'autopilote de rentrée : remise des gaz) · coupé |
| ⇧X | Récupérer : la rotation arrêtée ; au-dessus d'un sol un stationnaire, en orbite prograde maintenu |
| T · R · Verr. Maj | SAS · alignement du roulis (ailes dans le plan de l'orbite) · commandes fines |
| 1 – 7 | Maintien prograde · rétrograde · radial extérieur · radial intérieur · normal · anti-normal · vers la cible |
| I K · J L · H N | Translation RCS : bas/haut · gauche/droite · avant/arrière |
| 8 · ⇧8 | Vol stationnaire (maintien de position) · **maintien à poste** (amarré : désamarrer, reculer de 30 m, tenir) |
| 9 · ⇧9 | Circulariser · **mode RCS** : rotation ⟷ translation (alors Z S haut · bas, Q D gauche · droite, ⇧ Alt avant · arrière ; A E roulent toujours) |
| 0 · ⇧0 | Approche · orbiter la cible |
| B | **Rendez-vous et amarrage** : à moins de 3 km, l'autopilote d'amarrage ; au-delà, tout le rendez-vous planifié, volé, puis l'amarrage |
| F7 · U · ⇧G | Descente et atterrissage (Z S · Q D redésignent le point : le LPD) · décoller vers l'orbite · rentrée et atterrissage (Ranger) |
| O · ⇧O | L'onglet MISSION de l'ordinateur de vol · le **plan de mission** |
| ⇧F4 | L'autopilote vole, ou il assiste (vous pilotez, son directeur au HUD) |
| ⇧[ · ⇧] | L'anneau de l'Endurance : un tour par minute de moins · de plus |
| [ · ] | Le vaisseau piloté : Ranger, Lander, Endurance |
| F · G · P · ⇧P | Ranger dans l'air : fusée ⟷ avion · train · volets · aérofrein |
| ⇧K | Descendre / monter dans un vaisseau posé ; amarré au vaisseau d'un autre joueur en orbite : monter à bord (N3) |
| Tab (bref) · Tab (maintenu) | Cible suivante · la roue du vaisseau (ci-dessous) |
| Entrée · ⌫ | Acquitter l'alarme principale · rendre les commandes (mission, maintien, autopilote) |
| M · ⇧M · ⇧Y | Carte 3D · réglages · la trajectoire future dans la vue |
| ² · ⇧² | Densité du HUD · type de HUD (automatique, Atmosphère, Espace, Approche) |
| V · ⇧R | Vue suivante · recentrer la caméra |
| F6 | TARS (appui bref : écrire · maintenu : parler) |

Les chiffres se lisent par position (la rangée du haut sur AZERTY). Toutes les touches se réassignent (pause ›
Commandes) ; la feuille d'aide (?) les range sous « Piloter un vaisseau (K) ».

### La roue (Tab maintenu)

`ui/spacewheel.ts`, construite à chaque ouverture selon le vaisseau et son état — onze secteurs, chaque vaisseau
la sienne :

- **SAS** (T).
- **Maintiens ›** les neuf (les sept ci-dessus, dos à la cible, le nœud de manœuvre) et le manuel.
- **Autopilotes ›** circulariser, exécuter le nœud, transfert, approche, orbiter la cible, rendez-vous et amarrage
  (B), maintien à poste (⇧8) ; stationnaire, descente et atterrissage, décollage vers l'orbite pour un vaisseau qui
  se pose ; rentrée pour le Ranger.
- **Ordinateur de vol ›** ORBITE, CIBLE, ATTERRIR (un vaisseau qui se pose), MISSION, le plan de mission (⇧O),
  exécuter.
- **Systèmes ›** mode RCS, la page Systèmes (avec le nombre de pannes en cours), acquitter, stopper la rotation,
  train, feux de navigation et phares du Ranger, l'**anneau ±** de l'Endurance.
- **Amarrage ›** amarrer ou maintien à poste ; amarré : désamarrer, faire le plein, désamarrer et tenir à 30 m ;
  cible suivante.
- **Flotte ›** les vaisseaux qu'on peut piloter ; en salle, la flotte de la salle et les trois ordres au pilote
  ciblé.
- **Navigation ›** carte, placer, cible suivante — les entrées avion (plan de vol, carte de mission, ILS, préparer
  un vol) seulement quand le Ranger vole en avion.
- **École et défis ›** école de vol, missions, défis. **Caméra ›** vue suivante, photo, replay, bande-annonce.
- **Vaisseau ›** l'assistance (les quatre niveaux), le mode de vol (Ranger), HUD suivant, commandes fines.

### À la manette et au HOTAS

`input/spacepad.ts`, sur la disposition standard (un profil propre au joueur pour cette manette reste prioritaire) :

| Commande | Quoi |
|---|---|
| Manche gauche | Tangage · lacet — en translation RCS : haut · bas · gauche · droite |
| Manche droit | Le regard — la roue ouverte : vise ses secteurs |
| RT · LT | Plus · moins de poussée — en translation : avant · arrière |
| LB · RB · L3 | Roulis gauche · droite · mode RCS |
| A | SAS — la roue ouverte : fait le secteur |
| B | Bref : acquitter · maintenu : stopper la rotation — la roue ouverte : retour |
| X | Bref : amarrer (le rendez-vous au-delà de 3 km) · maintenu : maintien à poste |
| Y | Bref : cible suivante · maintenu : la roue (relâché : fait le secteur) |
| Croix | Prograde · rétrograde · vers la cible · radial et normal tour à tour |
| View · Menu | Bref : vue suivante — maintenu : la carte · bref : la pause — maintenu : le plan de mission |

Un HOTAS : bouton **Profil vaisseau 6 DDL** dans l'écran Manettes — sur une manette standard, la disposition
d'amarrage (manche droit l'attitude, manche gauche les translations, gâchettes avant et arrière) ; sur une manette
des gaz, son basculeur fait la translation avant–arrière à la place du palonnier, le mini-manche les translations
latérales ([HOTAS.md](HOTAS.md)).

## Les pilotes automatiques

- **Le maintien à poste** (⇧8, `controller/stationkeep.ts`) : le vaisseau tenu où il est par rapport à la station
  ou à un vaisseau à moins de 5 km (le sien ou celui d'un autre joueur), aux seuls propulseurs RCS, l'attitude
  laissée au SAS. Le point est tenu dans le repère propre de la cible — le repère orbital de l'ISS (LVLH : un point
  sur sa R-bar ou sa V-bar) ; une cible qui tourne à plus de 0,2°/s (l'Endurance en vrille) : son repère orbital —,
  rejoint à 1 m/s au plus, freiné à 0,02 m/s² ; le temps accéléré limité à ×10. Amarré, ⇧8 désamarre, recule de
  30 m et tient. Mesuré : à 150 m de l'Endurance, en dérive à 0,30 m/s → 0,04 m du point et 0,005 m/s après
  240 s. Au HUD, le bouton **À POSTE** et sa carte (l'écart au point, la dérive, le repère).
- **Le rendez-vous et l'amarrage** (B, `docking-guidance.ts`) : une cible au-delà de 3 km — la station ou un
  vaisseau — et tout le rendez-vous est planifié puis volé (ses poussées exécutées), l'amarrage enchaîné.
  L'approche marque les points d'attente de Dragon : **Waypoint 1 à 220 m** (30 s, « feu vert pour l'approche »),
  **Waypoint 2 à 20 m** (20 s, « feu vert pour la capture »), chacun seulement si l'approche commence au-delà ;
  puis l'attente alignée à 10 m et la capture. La carte d'amarrage dit la zone : dehors, dans l'**ellipsoïde
  d'approche** (4 × 2 × 2 km dans le repère orbital de la cible), dans la **sphère d'exclusion** (200 m) ; le
  profil de rapprochement porte WP1 et WP2. Mesuré : du Lander à 500 km vers l'Endurance à 800 km, « 200 m de son
  port arrière · départ dans 15,1 h, 735 min de vol · Δv 636,9 m/s », quatre poussées, la dernière enchaînant
  l'amarrage ; en jeu, tenu au point d'attente 1 à 220,2 m, 0,00 m/s.
- **Le désignateur de point d'atterrissage** (LPD, comme le P64 d'Apollo) : pendant l'atterrissage automatique
  (F7) vers un site ou le point sous le vaisseau, le manche redésigne le point — Z S avant · arrière, Q D (ou les
  touches de translation) gauche · droite —, l'attitude restant celle de l'autopilote. Le point glisse à 5 % de la
  hauteur par seconde (5 m/s au moins), jamais plus loin de sa première place que la hauteur (250 m au moins), sous
  5 km. Au HUD, une croix dans un cercle au sol, « LPD 2,8 km », verte tant qu'elle est celle de l'autopilote,
  ambre une fois déplacée. Mesuré : déplacé de 298 m vers l'avant, posé à 0,0 m du point à 0,8 m/s. Le
  « hoverslam » est une aide, pas un autopilote : le graphique de descente verticale et le compte à rebours de la
  poussée d'arrêt.
- **Le plan de mission** (⇧O, `ui/missionplan.ts`, `game/missiontimeline.ts`) : dans un vaisseau, dans l'espace,
  dans notre système solaire (un appareil qui vole en avion dans l'air garde le plan de vol ; près de Gargantua,
  les poussées de l'ordinateur de vol, O). La **chronologie** : chaque poussée (son rôle —
  départ, correction, capture, arrivée —, son échéance, son Δv, sa durée à pleine poussée), chaque sphère
  d'influence traversée, un impact, et ce que fait l'autopilote à la fin (« puis l'autopilote d'amarrage », « puis
  une orbite circulaire ») ; la prochaine poussée surlignée, rafraîchie toutes les 0,7 s. Le **budget** : Δv prévu,
  Δv dans les réservoirs, la marge (rouge si elle manque), une jauge. **Exécuter**, **Effacer**, l'ordinateur de
  vol (O) pour planifier. Un rendez-vous au-delà de 10 km/s est refusé avec sa raison (l'orbite de l'ISS n'est
  connue que près de la date du jour). Mesuré : un transfert lunaire depuis l'orbite basse, départ 3 089 m/s
  (2 min 38 s), capture 804 m/s (41 s), 3 893 m/s prévus.
- **Les autres** : stationnaire (8), circulariser (9), approche (0), orbiter la cible (⇧0), exécuter le nœud,
  transfert, décoller vers l'orbite (U), descente et atterrissage (F7), rentrée (⇧G, le Ranger : la désorbitation
  vers un site choisi dans l'onglet ATTERRIR, la rentrée guidée, le plané et l'atterrissage). ⇧F4 fait voler l'un
  ou l'autre, ou vous laisse son directeur.
- **L'ascension et l'inclinaison** : tout mesure désormais l'inclinaison par rapport au **pôle de la date** (on
  prenait celui de J2000) : de Tranquillité vers une orbite de 1°, 1,00°, et le HUD le dit. Une ascension coûte
  19 % de plus que le minimum impulsif sur la Lune (2 040–2 051 m/s pour 1 722) et 27–30 % sur Terre (les pertes
  de gravité seules valent ~15 % à la poussée du Ranger).

## Les protections (`game/spaceguard.ts`)

L'Auto-GCAS et l'Auto-ACAS des vaisseaux :

- **Le sol** : en descente sur les moteurs plus vite qu'ils ne peuvent encore arrêter le vaisseau au-dessus du sol
  (90 % de la poussée, 2 s pour pivoter et monter en régime, 20 m de marge ; seulement au-delà de 80 % de la vitesse
  de crash) — une **alerte ambre** d'abord (« TAUX DE CHUTE · 105 M/S · ARRÊT 600 M »), puis le **stationnaire**
  engagé tout seul, une **alarme rouge** tant qu'il dompte la descente. Mesuré : le Lander lâché à 2,5 km
  au-dessus de Tranquillité, en stationnaire à 507 m depuis 80 m/s, 505 m et 1,6 m/s 30 s plus tard (en Manuel :
  « le train s'est effondré à 90 m/s »).
- **La sphère d'exclusion** (200 m autour de la station ou d'un vaisseau) : un rapprochement plus rapide que sa
  limite — 0,05 m/s + 0,5 % de la distance (1 m/s au bord, 0,1 m/s à 10 m) — une alerte à 1,5×, le **maintien à
  poste** engagé à 2× (mesuré : le Ranger lancé à 2 m/s vers l'Endurance depuis 150 m, arrêté à 148 m).
- **Le couloir d'amarrage est exempté** (N2) : une approche lente (≤ 0,5 m/s) sur l'axe d'un port (écart sous
  15 % de la distance), ports en face (< 15°), n'est jamais reprise — la garde prenait la main pendant un amarrage.
- **Armées** aux niveaux Assisté et Débutant, en Réaliste avec *Protections automatiques* ; **jamais en Manuel**
  (alerte seulement) ; jamais sous un autopilote, amarré ou posé ; pas pour un appareil qui vole sur ses ailes (son
  GPWS). Chaque alarme a son *pourquoi* et son *que faire* au HUD ; le manche ou ⇧X reprennent la main.

## L'Endurance, vaisseau-mère

- **L'anneau** (⇧[ · ⇧], `controller/ring.ts`) : tout le vaisseau tourne sur son axe pour donner du poids dans les
  modules de l'anneau (ω²r à 30 m). La rotation demandée va de 0 à 10 tr/min, un tour à la fois ; les propulseurs
  l'y amènent lentement (0,01 rad/s² : 5 tr/min en 50 s environ) et la tiennent ; 0 l'arrête et rend le roulis au
  manche. HUD : « ANNEAU 2.4 TR/MIN → 5 · 0.20 G », puis « ANNEAU 5.0 TR/MIN · 0.84 G » ; ambre au-delà de
  7 tr/min. 1 g vaut 5,5 tr/min. Pour s'amarrer au moyeu, égaler sa rotation.
- **Le plein** (`controller/refuel.ts`) : chaque vaisseau a ses ergols. Amarré à un vaisseau de la flotte, le
  panneau d'amarrage montre les réservoirs de chacun et **FAIRE LE PLEIN · 12 %** : le réservoir du vaisseau
  piloté rempli depuis l'Endurance (à défaut le plus plein), jamais plus que ce que l'un a ni que ce que l'autre
  contient, la masse conservée. Mesuré : 33,4 t transférées, l'Endurance à 96 %. Larguer le Lander depuis
  l'Endurance : piloter le Lander, DÉSAMARRER.
- **Des deux côtés du trou de ver** (`controller/holeendurance.ts`) : près de Gargantua, l'Endurance est un vrai
  vaisseau-mère — son orbite celle de la scène, dans le plan équatorial de Gargantua où son cercle est une
  géodésique de Kerr (un vaisseau à côté y reste : 0,85 m en 60 s) ; son vrai modèle (64 m) dessiné à moins de
  60 km ; amarrable comme la station, tenue au port pendant que l'orbite emporte l'ensemble ; **B** y amarre aussi
  (depuis 150 m : amarré à 0,09 m/s en 266 s). Un vaisseau laissé là suit sa propre géodésique ; [ ] pilotent
  l'Endurance elle-même ; les pièces désamarrées partent sur leurs géodésiques, pas de capture pendant 5 s. **La
  traversée amarrée** : l'Endurance avec le Ranger à son moyeu passe de la Terre à Gargantua et revient,
  l'assemblage gardé.
- **Mann, en vrille** (« Mann : l'Endurance en vrille ») : l'Endurance sur l'orbite de Mann, tournant à
  **3 tr/min** autour de l'axe de son moyeu ; B vole la rotation de la cible en avance et commande la vitesse du
  centre moins ω × r — depuis 18°/s d'écart, la rotation égalée (0,00°/s dans les 12 derniers mètres), amarré à
  0,09 m/s en 265 s. (Les ≈ 67 tr/min du film dépassent ce que le Ranger sait tourner.)

## Systèmes, consommables, pannes, checklists

`game/systems.ts` (modèle pur), `controller/systems.ts`, la page **Systèmes** de la tablette (M) :

- **L'électricité** : une batterie nourrie par ses générateurs (piles à combustible, panneaux, réacteur) et tirée
  par les systèmes, les propulseurs et les roues à réaction selon l'effort ; **à plat**, plus de RCS ni de roues
  jusqu'à 5 % de recharge.
- **L'oxygène** : 0,84 kg par personne et par jour (le chiffre de la NASA), les jours restants affichés ; les
  **épurateurs de CO₂** et leur durée de vie.
- **Les pannes** (tirage graine : le même vol, les mêmes pannes) : **moteur principal éteint** (le rallumage
  échoue une fois sur trois : mi-poussée alors), **propulseur RCS bloqué ouvert** (le vaisseau dérive ; isoler le
  bloc retire un quart du RCS), **dérive de la centrale inertielle**, **court-circuit du bus principal** (trois
  fois la consommation), **fuite d'oxygène cabine** (vide en 6 h environ), **panne d'épurateur**.
- **Les alarmes** : chaque panne allume la sienne au HUD (avertissement rouge, puis prudence ambre pendant la
  réparation) avec **POURQUOI / QUE FAIRE** — les étapes de sa checklist ; s'y ajoutent batterie basse, oxygène
  bas, épurateurs usés.
- **Les checklists** : celle d'une panne sur la page Systèmes — chaque étape cochée, puis l'action (« ISOLER LE
  BLOC », « RALLUMER LE MOTEUR »…) donnée, la réparation en quelques secondes ; les **normales** (avant le
  lancement, mise en orbite, rendez-vous et amarrage, désorbitation et rentrée, atterrissage propulsé). Les cases
  sont partagées avec la page CKL du cockpit et la console crew (`camera.sysTicks`).
- Désactivables : *Consommables* coupé, *Pannes* sur « aucune ».

## Les HUD

Chaque vaisseau son panneau (`VESSELS.*.space.panel`, `ui/hud/symbology.ts drawCraftPanel`), placé par la mise
en page du HUD (à gauche, sous les cartes du haut) — le détail dans [HUD.md](HUD.md) :

- **Lander — DESCENTE** (celui du LM d'Apollo) : H, la vitesse verticale, les vitesses **avant · latérale** sur
  le sol, les **secondes de stationnaire** restantes (le Δv du réservoir sur la pesanteur locale : vert, ambre sous
  60 s, rouge sous 30 s), les ergols ; les annonces **« Soixante secondes »** et **« Trente secondes — posez-vous ou
  interrompez »**. Sous 15 km, posé exclu.
- **Endurance — le vaisseau-mère** (titré ENDURANCE) : l'anneau (tr/min, g), **chaque port** (libre, ou le
  vaisseau amarré), la masse de l'assemblage, les ergols de chaque vaisseau amarré.
- **Le COAS**, les 60 derniers mètres d'un amarrage : une croix sur l'axe du port du vaisseau, le port visé un
  cercle — vert sous 1°, ambre sous 5° (dans la vue de la caméra d'écoutille).
- Au-dessus d'un monde sans air, le HUD est Espace, et Approche sous 5 km (plus de « HUD ATMOSPHÈRE » au-dessus
  de la Lune).
- La carte d'amarrage côté Gargantua a ses lignes (distance, axe · travers, rapprochement, axes des ports,
  rotation) ; les ports nommés en français (moyeu avant · arrière, écoutille arrière · dorsale).
- Les alertes des protections, de l'anneau et des pannes, le marqueur du LPD, la carte du maintien à poste,
  l'alerte de proximité en salle (plus bas).

## Les cockpits

- **Ranger** (`ui/cockpitscreens.ts`) : des **écrans tactiles** comme le PCD du F-35 — un toucher sur un bouton de
  page fait l'action —, les onglets en 2 × 6 : PFD, ORB, NAV, SYS (ses boutons SAS · RCS TR · PRO · RETRO), DCK,
  PLN, CLK, LOG, APP, LDG, **CKL** (la checklist de la panne en cours, un bouton par étape, puis l'action ; sans
  panne, les checklists normales, CHECKLIST SUIVANTE) et **ECS** (batterie, oxygène, épurateurs, bilan, équipage,
  pannes). Deux boutons physiques sur le panneau C : **RCS TRANS** (allumé en ambre) et **MASTER** (clignote en
  rouge tant qu'une panne court ; un appui l'acquitte). L'éclairage de nuit couvre les nouvelles pages.
- **Lander et Endurance** : la cabine commune du film (*endurance lander cockpit*) placée au décalage propre à
  chaque vaisseau (`VESSELS.*.cabin.offset`) — derrière les hublots du nez du Lander, dans le module de commande du
  moyeu de l'Endurance —, ses écrans montrant le vaisseau piloté (la descente du Lander, l'Endurance et son Ranger
  amarré).

## Sons, secousses, replay

- **Une voix par vaisseau** (`VESSELS.*.sound`) : le moteur du Lander à ×0,72 de hauteur, ses RCS à ×0,8, le
  grondement de sa structure plus bas ; l'Endurance une octave plus bas (×0,48), ses RCS en grondement (×0,6), sa
  structure qui gémit.
- **Des secousses pour les trois** (`camshake.ts`) : la poussée de la fusée à travers la structure (plus fort pour
  un vaisseau lourd), le plasma de la rentrée, l'anneau de l'Endurance qui change de régime, le coup du poser selon
  la vitesse de chute (une fois par contact).
- **Les moments spatiaux du replay** : la capture d'amarrage et le début d'une poussée, choisis par la
  bande-annonce (« Amarrage », « Poussée moteur »).
- En salle, on entend le moteur des autres (plus bas).

## Télémétrie et comptes rendus de phase

- **Les canaux du vaisseau** dans l'enregistreur de vol (page TÉLÉMÉTRIE de la tablette, CSV, graphiques de
  TARS) : Δv restant, Δv du plan, batterie, oxygène, distance et vitesse d'amarrage, avance de l'horloge de la Terre
  sur celle du vaisseau.
- **Un compte rendu sur 20 à la fin de chaque phase** (`game/report.ts`, `controller/phasereports.ts`) :
  **ascension** (le rendement : le Δv minimal sur le Δv dépensé, 20/20 dès 85 %), **insertion** (la précision de
  l'orbite contre l'objectif de lancement ou l'apside visée), **rendez-vous** (Δv dépensé contre celui du plan, le
  temps), **rentrée** (le couloir — charge et flux thermique maximaux — et l'écart au site), à côté de ceux de
  l'atterrissage et de l'amarrage. Chaque carte trace la courbe de sa phase (l'altitude de l'ascension, la charge
  de la rentrée, le Δv du rendez-vous). Mesuré : le Ranger de Tranquillité vers 100 km, « Ascension vers l'orbite ·
  Lune : 19,1 » (84 %, 2 042 m/s pour 1 718), « Mise en orbite : 20,0 » (100,1 × 101,0 km).
- **Les horloges** : l'écran CLOCKS du cockpit montre le **MET** et **TERRE +…** quand l'horloge de la Terre a pris
  de l'avance (les heures de Miller : rouge au-delà d'un jour). Le journal de bord inscrit chaque compte rendu.

## L'école de vol spatial

Tab maintenu › École et défis › École de vol (ou `__bh.flight.school.space`). **Quinze leçons**
(`game/spacecourse.ts`), chacune avec sa mise en place (une scène, une orbite, un sol, un stationnaire, l'ISS à une
distance donnée, une cible) : 1 l'attitude et le RCS · 2 les maintiens et le SAS · 3 monter et descendre ·
4 circulariser et le Hohmann · 5 le changement de plan · 6 le rendez-vous · 7 l'amarrage à la main (6 degrés de
liberté) · 8 la désorbitation et la rentrée · 9 le plané et la piste (Ranger) · 10 la descente lunaire avec le
désignateur (Lander) · 11 le décollage et l'ascension · 12 l'amarrage à l'Endurance en vrille · 13 l'assistance
gravitationnelle (un survol de la Lune) · 14 voler près de Gargantua (les deux horloges) · 15 les urgences (RCS
bloqué, moteur éteint).

- **Guidé** (TARS vole ses étapes en les disant, puis vous laisse les commandes), **démonstration** (TARS vole
  aussi les vôtres : « Je le fais : … »), **essai** (vos étapes seules).
- Une étape est faite quand ce qu'elle demande tient un instant (maintien aligné à moins de 5°, apside atteinte,
  orbite circulaire, inclinaison, amarré, posé, à moins d'1 km, panne réparée, point désigné, rotation arrêtée…) ;
  sinon elle passe à la fin de son temps — une leçon ne bloque jamais. Le compte rendu : 20 partagés entre vos
  étapes faites, chacune avec son temps.
- Mesuré : « Les maintiens » démontrée en orbite basse, 20/20 (rétrograde en 6 s, normal en 4 s).

## Les défis

`game/spacechallenges.ts`, la roue › École et défis › Défis — plus bas, c'est mieux ; le but tenu une seconde, un
temps maximal :

| Défi | Départ | Mesure | Or · argent · bronze |
|---|---|---|---|
| L'amarrage contre la montre | l'ISS à 60 m | le temps | 2 min · 3 min 20 · 5 min 20 |
| Le poser de précision sur la Lune | 3 km au-dessus de Tranquillité | l'écart à l'aire | 15 · 50 · 150 m |
| Le poser de précision sur Mars | 3 km au-dessus de Jezero | l'écart au site | 25 · 80 · 250 m |
| Le hoverslam | 2 km, moteur coupé, en chute | le Δv dépensé | 170 · 220 · 300 m/s |
| Le couloir de rentrée | une orbite de 400 km | la charge maximale | 3 · 4 · 5,5 g |
| Le rendez-vous au Δv minimal | l'ISS à 20 km | le Δv dépensé | 25 · 50 · 100 m/s |
| L'Endurance en vrille | la scène du film | le temps | 3 · 5 · 8 min |

L'écart est l'arc de grand cercle sur le corps, à partir de la position géodésique du vaisseau. Le résultat est un
compte rendu (la médaille, la marque de l'or, le meilleur — « nouveau record ») ; 20 pour l'or, 15 l'argent, 10 le
bronze ; les meilleurs gardés sur l'appareil (`kerr.space.bests`). Mesuré : le poser lunaire par l'autopilote
d'atterrissage, 0,1 m, or.

## Les missions

`game/spacemissions.ts`, `controller/spacemission.ts`, la roue › École et défis › Missions — des objectifs dans
l'ordre, chacun tenu une seconde et annoncé par TARS, un budget en Δv et en temps (dépassé : mission échouée, les
objectifs restants manqués), des pannes injectées et des messages à heure fixe ; un débrief (chaque objectif ✓ avec
son heure ou ✗, le Δv face au budget, le temps, la raison de l'échec, le chapitre suivant ouvert), noté sur la part
des objectifs atteints.

- **La bibliothèque** : **Artemis II** (un retour libre planifié → la sphère de la Lune → retour dans celle de la
  Terre ; 4 000 m/s), **Vers l'ISS** (20 km derrière : à moins d'1 km → amarré ; 150 m/s, 2 h), **Se poser sur la
  Lune** (le Lander à 50 km : sous 10 km → posé ; 2 200 m/s, 2 h), **Se poser sur Mars** (à 200 km : dans l'air
  sous 60 km → posé ; 2 h), **Le sauvetage** (l'Endurance en vrille à 300 km, un propulseur qui se bloque à 60 s :
  amarré ; 25 min).
- **La campagne Interstellar**, sept chapitres, chacun ouvert quand le précédent a été volé en entier (gardé dans
  `kerr.space.campaign`) : 1 le décollage de Cap Canaveral jusqu'en orbite · 2 l'Endurance (l'anneau à 4 tr/min,
  le départ planifié) · 3 le trou de ver · 4 Miller (descendre jusqu'à la mer, remonter avant la vague, 30 min) ·
  5 Mann (s'amarrer à l'Endurance en rotation) · 6 la fronde (plonger sous 8 M de Gargantua, être projeté au-delà
  de 40 M) · 7 Edmunds (s'y poser).
- **L'éditeur** (« Créer une mission d'ici… ») : le départ est le vol tel qu'il est, sauvegardé dans la mission ;
  les objectifs choisis parmi treize conditions avec leur valeur ou leur choix (corps, côté), le budget Δv et
  temps, des messages (« 60: le texte ») ; **Voler** tout de suite, **Copier son lien** — un `#smission=…` qui
  recharge la page et vole la mission (vérifié ; jamais compté comme un chapitre). Mesuré : « Se poser sur la
  Lune », posé à 74 s pour 117 m/s sur 2 200, 20/20.

## La console crew

Un téléphone, une tablette ou un second écran dans la salle ([CREW.md](CREW.md)) prend le **profil vaisseau** dès
que le pilote suivi en pilote un (thème bleu, badge `VAISSEAU · RANGER` ; tuiles Δv, ergols, Pe, Ap, période,
prochain événement, charge, dτ/dt, liaison) : le Tableau, l'ORBITE (avec les autres vaisseaux de la salle, N6), la
**carte système** 3D du Soleil ou de Gargantua (WebGPU, repli 2D), les vues Boule, Amarrage, Δv, EECOM,
Chronologie, Relativité et Sol. Chaque équipier choisit son **poste** — à bord (copilote, navigateur, ingénieur de
bord, en direct) ou au sol (FLIGHT, FIDO, GUIDO, EECOM, CAPCOM) avec le **délai lumière** (*Réseau › Délai lumière
vers le sol* : réel, un dixième, aucun ; coupé derrière le trou de ver, messages enregistrés). Ses actions : cible,
maintien à poste, désamarrer, faire le plein, mode RCS, l'anneau, une poussée glissée le long de l'orbite, la
checklist d'une panne cochée et son action donnée — « tout sauf piloter ». `bun scripts/crew-demo.ts --space`
ouvre une salle de démonstration (le Ranger de Cooper à l'ISS, le Lander de Brand au-dessus de la Lune,
l'Endurance de Romilly près de Gargantua).

## Jouer ensemble

Tout ce qui précède marche en salle ([NETWORK.fr.md](NETWORK.fr.md), *Les vaisseaux ensemble*) :

- **La flotte de la salle** (N1) : l'état de chaque vaisseau une fois par seconde (type, corps, altitude, état de
  vol, Δv, pannes, amarrage, O₂, batterie, côté). L'onglet **Flotte** du panneau Réseau liste les pilotes aux
  commandes d'un vaisseau, soi d'abord, puis du plus proche au plus loin — où, Δv, consommables, pannes, distance
  et vitesse de rapprochement (▼) ou d'éloignement (▲).
- **Les ordres** — « Rejoins-moi », « Maintiens-toi sur moi », « Amarre-toi à moi » — depuis l'onglet Flotte ou la
  roue (Flotte › Flotte de la salle, puis le pilote ciblé) : une carte chez l'autre (Accepter / Refuser, 30 s) ;
  accepté, son vaisseau cible le nôtre et son autopilote s'amarre ou maintient à poste s'il est à portée (3 km),
  sinon il cible et dit de planifier le rendez-vous.
- **La proximité** : « PROXIMITÉ » sous 200 m à plus de 1 m/s, ou sous 1 km et moins d'une minute de l'impact ;
  « Trafic » sous 2 km et 3 min — jamais entre vaisseaux amarrés ni pour un passager, une alerte par vaisseau et par
  15 s au plus.
- **Le partage entre vaisseaux amarrés** (N2) : demander des ergols, de l'électricité, de l'oxygène — ce que son
  réservoir peut encore contenir ; le donneur ne descend jamais sous **25 % de sa propre capacité** ; « Envoyer ma
  cible », « Envoyer mon plan » (12 poussées au plus, à leurs heures sur l'horloge de la salle, les passées
  écartées). Mesuré : 50 kWh transférés, 2 000 → 1 950 kWh chez le donneur.
- **À bord, le copilote, les commandes** (N3) : amarré au vaisseau d'un autre en orbite, **Monter à bord** (onglet
  Flotte ou ⇧K) — son vaisseau et ses instruments deviennent les vôtres à voir, le vôtre reste amarré, ⇧K pour y
  revenir. En **copilote** : SAS, prograde, rétrograde, tenue coupée, maintien à poste, autopilote coupé, anneau +
  et −, exécuter le plan — envoyés comme les ordres de l'équipage, sous le verrou du pilote. **Prendre les
  commandes** : le pilote accepte, le passager pilote le vaisseau là où il le voyait (ses ergols, sa batterie, son
  oxygène), l'ancien pilote devient son passager ; dans notre univers.
- **Les défis de salle et les résultats** (N4) : tout compte rendu volé en salle part à tous (un toast) ; l'onglet
  **Résultats** classe le meilleur de chaque pilote par chose volée (un défi par son résultat, le reste par la note).
  « Proposer à la salle » sur la carte d'un défi : ceux qui acceptent partent du même endroit, **fantômes** l'un pour
  l'autre tant qu'ils le volent tous deux.
- **Les missions coopératives à rôles** (N5) : « La Lune ensemble » (Endurance — l'orbite : 120 km, l'anneau
  au-delà de 2 tr/min, tenue au-dessus de 100 km · Lander — la descente de 50 km jusqu'au sol) et « Le sauvetage
  ensemble » (Endurance — arrêter la vrille · Ranger — l'amarrage). Un pilote par rôle ; la mission gagnée quand
  tous les rôles sont finis, perdue dès qu'un rôle finit sans ses objectifs ; un pilote qui part libère son rôle
  (« Prendre le rôle »).
- **Le temps et le son** (N6) : la salle tourne au warp du pilote le plus lent et un pilote en poussée le retient —
  c'est désormais dit (« ×10 demandé — en attente de Ben (en poussée) ») ; le vaisseau le plus proche qui pousse à
  moins de 3 km s'entend à sa place ; la vue ORBITE du crew dessine les autres vaisseaux de la salle.

## L'automatisation (`__bh`)

`__bh.flight.school.space(id, mode)` (une leçon spatiale : `"attitude"` … `"emergencies"` ; `"guided"`, `"demo"`,
`"try"`), `__bh.flight.spaceChallenges` (`open`, `go`), `__bh.flight.spaceMissions` (`open`, `go`, `fly`, `link`),
`__bh.camera.systemsFail(kind)` et `systemsInfo()` (une panne, l'état des systèmes), `__bh.camera.missionPlan(spec)`,
`fcPlan`, `fcExecute`, `undock` ; la salle sous `__bh.net`. Référence : [BH-API.md](BH-API.md).

## Tests

Unitaires : `spaceassist`, `stationkeep`, `spaceguard`, `lpd`, `missiontimeline`, `takeoff-flight`, `ring`,
`propellant`, `hole-endurance`, `dock-spin`, `systems`, `craftpanel`, `spacepad`, `cockpit-pages`, `cabin`,
`space-fx`, `phase-reports`, `spacecourse`, `knowledge`, `spacechallenges`, `spacemissions`, `netspace`,
`crew-space`, `crew-profile`, `crew-system`, `crew-station`. De bout en bout (vraies touches et clics) :
`vaisseaux-x1`, `vaisseaux-x5`, `space-school`, `space-missions`, `crew-space`, `crew-stations`,
`crew-space-actions`, `crew-demo-space`, et à deux navigateurs `net-fleet`, `net-share`, `net-crew`, `net-board`,
`net-coop`, `net-time`, `net-dock`. Ce que couvre chacun : [E2E-CATALOGUE.md](E2E-CATALOGUE.md).

## Pas encore

- **Le vol** : l'ascension en deux temps (insertion avec l'apoapside à la hauteur visée, puis circularisation) —
  l'ascension reste à +19 % (Lune) et +27–30 % (Terre) du minimum impulsif ; la mission vers Jupiter (le
  planificateur n corps se croit sur sa visée) ; la protection du couloir de rentrée (rebond, surchauffe) ; le
  rendez-vous lointain volé de bout en bout dans un e2e (≈ 15 h de jeu) ; l'édition des poussées depuis la
  chronologie (l'ordinateur de vol et la carte du crew le font).
- **L'Endurance** : un anneau qui tourne séparément d'un moyeu immobile ; les ≈ 67 tr/min du film (3 ici) ; un
  rapport de masse par vaisseau ; les vaisseaux amarrés ne sont pas dessinés dans la gorge même du trou de ver.
- **HUD et cockpits** : couleur et luminosité du HUD des vaisseaux ; la boule de navigation « AAA » au HUD (la
  console crew a la sienne) ; un tableau propre au Lander et une passerelle propre à l'Endurance (Blender ou modèle
  CC-BY, proposé avant tout téléchargement) ; le coût GPU des cockpits non mesuré.
- **L'immersion** : les vues d'exception spatiales (les scènes existent dans la galerie) ; le replay hors de la
  Terre (un poser lunaire n'est pas capté).
- **École et missions** : les schémas des leçons et un instructeur à canaux par leçon ; seule « Les maintiens » est
  vérifiée de bout en bout (les démonstrations longues s'appuient sur les autopilotes et le garde-fou) ; la leçon à
  deux ; les fenêtres de lancement et une carte par mission dans la vue 3D du système ; le voyage automatique comme
  démonstration de la campagne.
- **Le réseau** : l'Endurance de salle prise avec un bail et reprise à la déconnexion (il faut des identifiants de
  vaisseau plutôt qu'un vaisseau par joueur) ; monter à bord depuis le vaisseau hôte vers l'invité amarré (seul
  l'invité passe le sas) ; le contrôle de mission comme rôle compté en coopération ; reprendre un rôle après une
  reconnexion ; les feux et le train d'un Ranger distant (`F_LIGHTS` est envoyé) ; les autres vaisseaux sur la carte
  3D du crew ; les messages vocaux enregistrés derrière le trou de ver (les écrits existent) ; la masse de
  l'assemblage pour l'hôte ; les repères courbés par la lentille au loin.
