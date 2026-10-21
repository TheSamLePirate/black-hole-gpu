# Plan A320 — l'avion de ligne sur Terre (22 octobre 2026)

Un Airbus A320 pilotable au niveau du F-35 : le modèle, le cockpit cliquable entier, les commandes de vol électriques
Airbus, l'autopilote et le FMGC, les six écrans, les systèmes, les pannes, le son, les effets — puis le métier autour
(vols de ligne, contrôle aérien, sol, école, équipage à deux). Suivi global : [`AAA-PROGRESS.md`](AAA-PROGRESS.md).
Référence de qualité : [`PLAN-F35.md`](PLAN-F35.md).

## Décisions du propriétaire (22/10/2026)

- **Source : l'A320-family de FlightGear** (`legoboyvdlp/A320-family`, branche `dev`, révision `fec1ecba`, copie locale
  `~/Documents/DEV/A320/flightgear-a320/`, inspection dans `~/Documents/DEV/A320/inspection/`), sous **GPL v2**.
- **Livrées : maison + réelles** — une livrée fictive « Kerr » par défaut et une blanche ; les 12 livrées réelles du dépôt
  (SWISS, Austrian, Delta, American ×2, Qatar, SAS ×2, N680AW, British Airways, Lufthansa, Spirit) en option.
- **Sons : les enregistrements FlightGear** (209 WAV : moteurs CFM56 et V2500, APU, PTU, alarmes, annonces GPWS, cabine),
  crédités sous la GPL v2 du dépôt, mixés et spatialisés par notre moteur ; la synthèse en complément.
- **Variantes : l'A320-214 CFM56 d'abord**, puis l'A320-232 IAE V2500, l'A320-251N LEAP-1A et l'A320-271N PW1100G.
- **Le jeu autour, tout** : vols de ligne et contrôle aérien, sol et aéroports, pannes / école / défis, équipage à deux
  en réseau.

## Ce qu'apporte la source (inventaire du 22/10/2026)

| Domaine | Fichiers FlightGear | Ce qu'on en tire |
|---|---|---|
| Extérieur | `Models/Fuselage/res/A320-216.ac` (6,5 Mo), `CFM56.ac`, `IAEV2500.ac`, `CFMLEAP1A.ac`, `PW1100G.ac` ; mouvements dans `fuselage.xml`, `a320.cfm.xml` (151 règles, `inspection/exterior-movements.json`) | la géométrie, les charnières (axes donnés par deux points dans le XML), le train et ses 21 biellettes suiveuses, les trappes, les 10 spoilers, les becs et volets, les inverseurs (4 portes par moteur), les portes, la RAT, le volet d'APU, les essuie-glaces |
| Livrées | `Models/Liveries/{CFM,IAE,CFM-NEO,PW-NEO}` : fuselage 4K, moteurs 2K, salissures | la couleur ; les cartes PBR (rugosité, métal, normales) sont à faire |
| Cockpit | `Models/FlightDeck/res/fd_complete.ac` (30 Mo, **441 857 triangles, 1 432 objets, 24 textures dont trois en 4K**) ; `a320.flightdeck.xml` (43 445 lignes : 482 zones cliquables, 101 boutons rotatifs, 361 translations, 142 rotations, 402 sélections) | l'aménagement complet (overhead, glareshield, FCU, pédestal, mini-manches, manettes) avec les **noms d'objets et leurs propriétés** — de quoi rendre chaque commande vivante |
| Vol | `FDE/Config/a320-aerodynamics.xml` (830 lignes de tables JSBSim), `a320-ground-reactions.xml`, `a320-metrics.xml`, masses dans `FDE/A320-*.xml` | portance par incidence et becs, incréments volets/becs, traînées (train, volets, spoilers), effet de sol, moments ; 122,6 m², 35,74 m, CMA 4,19 m ; 43,3 t à vide, MTOW 78 t, 5 réservoirs (19,4 t) ; inerties ; train (positions, ressorts, amortisseurs, Pacejka) |
| Moteurs | `Engines/cfm56-5b4_1.xml`, `v2527-a5_1.xml`, `leap-1a26_1.xml`, `pw1127g_1.xml`, `APS3200.xml` ; FADEC `Systems/a320-cfm56-5b4-engine-fadec.xml` (53 Ko) | poussées (27 000 lbf), ralenti par Mach × altitude, N1/N2/EGT/débit, **limites TOGA/FLX/MCT/CLB/IDLE en tables N1 (altitude × TAT)**, crans de manette, inverseurs, alpha floor |
| Commandes de vol | `Systems/a320-fcs.xml`, `a320-fbw.xml` (2 400 lignes), `a320-fbw-rules.xml`, `a320-spoilers.xml`, `Nasal/Systems/fbw.nas` | lois normale / alternée / directe / secours mécanique ; facteur de charge +2,5/−1 g, assiette +30/−15°, inclinaison 33° lâché / 67° maxi, roulis 15°/s, protections d'incidence (tables α prot / α max par Mach et configuration), grande vitesse, mode arrondi, auto-trim, amortisseur de lacet ; vitesses et débattements des gouvernes ; SFCC (CONF 0/1/1+F/2/3/FULL et leur logique) |
| Autopilote | `Nasal/FMGC/FMGC-b.nas`, `FMGC-c.nas` (FMA), `FCU.nas`, `Systems/fmgc-{pitch,roll-yaw,thrust,drivers}.xml`, `a320-fmgc.xml` | la machine à modes (SRS, CLB/DES, OP CLB/DES, ALT*, ALT CRZ, V/S, FPA, NAV, HDG/TRK, LOC*/LOC, G/S*/G/S, LAND, FLARE, ROLL OUT, RWY, GA), l'A/THR, les vitesses (VMO/MMO, green dot, S, F, VLS, VFE, VS1G par masse) |
| MCDU | `Nasal/MCDU/` (38 pages : INIT A/B, F-PLN, PERF TO…GA, FUEL PRED, PROG, RAD NAV, DIR TO, HOLD, LAT/VERT REV…) | la structure et le comportement de chaque page |
| Systèmes | `Systems/a320-{electrical,hydraulic,fuel,pneumatic,aircond,apu,ignition,adr,engine-fire,oxygen,lights,indicators}.xml`, `Nasal/Systems/*` | les schémas : bus électriques, IDG, TR, batteries, RAT ; vert/bleu/jaune et PTU ; transferts carburant ; prélèvements, packs, pressurisation ; démarrage moteur ; alignement ADIRS ; feux |
| ECAM | `Nasal/ECAM/ECAM-messages.nas` (150 alarmes avec procédures, ~70 mémos, STATUS), `ECAM-logic.nas` (4 095 lignes), `Systems/a320-fwc.xml` (phases de vol, inhibitions) | les messages, leurs conditions, leurs procédures |
| Écrans | SVG Inkscape animés par identifiants : `PFD/res/pfd.svg` (1 114 ids), `ND/canvas/res/airbusND.svg`, `Upper-ECAM/res/cfm-eis2.svg`, 13 pages SD, `MCDU/res/mcdu.svg`, `IESI/res/iesi.svg`, DCDU | le dessin exact de chaque écran, à animer par les mêmes identifiants sur nos canevas 2D |
| Sons | `Sounds/` : `SASA/` (105 : CFM56 et V2500 cockpit/extérieur/aile, démarrage, inverseurs, APU, packs, volets, train, toucher), `GPWS/` (46 annonces), `Cockpit/` (34 : CRC, gong, cavalry charge, cricket, V1, boutons), `Hydraulic/` (PTU), `Announce/` (13), `Effects/` ; correspondances `A320-common-sound.xml` | des sons enregistrés ; les lois volume/hauteur de `Systems/*-sound.xml` |
| Procédures | `A32X-Checklists.xml` (305 items : flux et listes normales), `AircraftConfig/acconfig.nas` (états cold & dark, before start, taxi, takeoff), QRH | les check-lists, les états de départ |
| Sol | `Models/Services/` (tracteur de repoussage, camions traiteur et carburant, escaliers, cales, dégivreuse, GPU) | les véhicules de piste |

**Ce que la source ne fournit pas** : aucune cabine passagers ; V1/VR/V2 non calculées (saisies) ; pas de données de
navigation (SID/STAR, voies aériennes) — nous avons les pistes d'OurAirports ; pas de cartes PBR modernes ; les polices
Honeywell (MCDU) n'ont pas de licence déclarée.

## Licences

- Tout ce qui dérive du dépôt (géométrie convertie, textures, tables, sons, SVG) va dans `assets/a320/` (LFS pour les
  binaires) avec un `README.md` : la GPL v2, les auteurs (`README.copyright.md`), l'origine (Immersive Design Group,
  `Docs/THANKS.md`), la révision, la liste des modifications et **les scripts de construction comme forme source**
  (`scripts/build-a320*.py|ts`). Le code du jeu reste le nôtre ; les tables numériques réécrites en TypeScript citent leur
  fichier d'origine.
- Polices : `ECAMFontRegular/Bold` (FlyByWire, GPL v3) utilisables avec crédit ; **les polices Honeywell MCDU, Airbus7Seg
  et AirbusRMP (sans licence) ne sont pas reprises** — une police MCDU à nous (ou dérivée de Liberation Mono, déjà libre).
- Livrées réelles : en option, jamais par défaut ; aucune n'est utilisée dans les visuels promotionnels du jeu.
- Sons « SASA » sans source déclarée : repris sous la licence du dépôt, crédités ; remplaçables par la synthèse si un
  ayant droit se manifeste (le moteur audio garde les deux).

## Architecture — ce qui change dans le jeu

Le F-35 est aujourd'hui « le » jet : ~150 tests `fleet.active === "f35"`, un seul jeu de cartes `jetMaps`, une plage de
matières 30–39, un seul écran `jetScreen`, `F35Mesh`/`F35Pose` à l'ordre de pièces figé, `TurbofanDef` monomoteur à
postcombustion, des volets codés en dur dans `aero.ts` (ΔCL 0,45). Un deuxième avion impose d'abord de **généraliser**
(étape A0), sans changer le F-35 d'un pixel ni d'un newton (A/B mesuré).

- Identifiant du vaisseau **`a320`** ; le maillage de trafic actuel (`assets/traffic/a320.bin`, `ShipMeshId "a320"`,
  genre 4) est renommé **`a320t`** puis, en A17, remplacé par un niveau de détail du nouveau modèle.
- Capacités au lieu des noms : `VesselDef.aircraft = { role: "fighter" | "airliner", engines, helmet?, stovl?, weapons?,
  screens? }` ; les tests `=== "f35"` génériques deviennent `isJet(id)` / `hasRole`, ceux propres au chasseur (STOVL,
  pont d'envol, combat, ravitaillement) restent au F-35.
- Rendu : un **jeu de cartes et une plage de matières par avion** (couches d'atlas indexées), des pièces nommées (le
  tableau des noms écrit par le script de construction), `MAX_PARTS` relevé (l'A320 aura ~250 pièces), plusieurs écrans
  (un atlas d'écrans 4096² : PFD×2, ND×2, E/WD, SD, ISIS, MCDU×2, DCDU).
- Vol : `TurbofanDef` à N moteurs (N1/N2/EGT, inverseurs, démarrage) ; `AeroConfig.flaps` → **configurations** (becs,
  volets, spoilers par panneau, tables d'effet de sol) ; freinage automatique ; la loi Airbus dans `src/a320/fbw.ts`
  appelée par `pilot.ts` comme le F-35 l'est.
- Code propre à l'avion dans `src/a320/` (comme `src/f35/`), réglages `a320*` dans un groupe « A320 ».

## Étapes

Chaque étape : un commit (poussé), une planche dans `docs/progress/a320/`, FR + EN, tests unitaires, e2e par de vrais
événements avec la **vue cockpit** par défaut, le F-35 vérifié inchangé, `bunx biome ci .` et
`bun scripts/check-repo-size.ts --base origin/main` avant chaque poussée.

### Bloc 1 — l'avion vole

| # | Étape | Contenu | Statut |
|---|---|---|---|
| A0 | **Deux avions dans le jeu** | généralisation décrite ci-dessus : capacités, genres d'engins, cartes/matières par avion, pièces nommées, écrans multiples, `TurbofanDef` multi-moteurs, configurations de volets, `a320t` pour le trafic ; le F-35 identique (images et vols A/B, tous les tests F-35 verts) | à faire |
| A1 | **L'extérieur** | `scripts/build-a320.py` (Blender, import AC3D via assimp) : `A320-216.ac` + `CFM56.ac`, repère du vaisseau, échelle réelle (35,8 m d'envergure, 37,57 m) ; **les pièces mobiles lues dans les règles XML** — ailerons, profondeurs, PHR, direction, 5 becs et 2 volets par aile (rotation + translation sur rails), 10 spoilers, train (3 jambes, bogies, 21 biellettes suiveuses, compression, rotation et braquage des roues), trappes, inverseurs (4 portes et cascades), soufflante, portes passagers et soute, RAT, volet d'APU, essuie-glaces, sondes ; vitres cockpit et hublots ; **textures PBR** : la livrée 4K + rugosité/métal (aluminium, peinture, composite, pneus) + normales (rivets, panneaux, dérivées des cartes d'`Effects/`), salissures ; KTX2 en LFS ; livrées maison « Kerr » et blanche, les 12 réelles en option | à faire |
| A2 | **Le rendu** | `ship.wgsl` : l'A320 au genre propre, ses pièces posées, ombres ; la passe de verre (pare-brise, hublots) ; les **feux** — navigation, anticollision rouges (ventre, dos), flashes blancs, logo, aile, roulage, décollage, atterrissage escamotables, dégagement de piste (`ship-lights.ts` : nouveaux genres, `MAX_LAMPS` relevé) ; deux panaches de turbofan à fort taux de dilution (chaleur, pas de flamme) ; coût GPU mesuré face au F-35 | à faire |
| A3 | **Le vol** | `scripts/build-a320-data.ts` : les tables JSBSim lues et écrites en TypeScript (`src/a320/aero-data.ts`, citations des lignes) ; `src/a320/aero.ts` : portance par incidence × Mach × becs, incréments CONF, traînées (train, volets, becs, spoilers, phares), effet de sol, moments et amortissements ; **deux CFM56-5B4** (`src/a320/engine.ts` : N1/N2/EGT/débit par les tables de la FADEC, ralenti par Mach × altitude, inertie des attelages, inverseurs à 65 %) ; masses et centrage (ZFW, passagers, soute, 5 réservoirs et leurs transferts) ; le **train** (positions JSBSim, bogies, freins, orientation 75° au palonnier/tiller), **freinage automatique** LO/MED/MAX ; **mesuré** contre les chiffres réels : décollage, VS1G par masse et CONF, montée, croisière FL370 M0,78 (≈ 2,4 t/h), plafond, atterrissage | à faire |
| A4 | **Les commandes de vol Airbus** | `src/a320/fbw.ts` : **loi normale** (le mini-manche commande un facteur de charge en tangage, un taux de roulis en roulis ; lâché, la trajectoire est tenue), auto-trim, coordination et amortisseur de lacet ; **protections** — assiette +30/−15°, inclinaison 33°/67°, facteur de charge, incidence (α prot, α max, **alpha floor** → TOGA LK), grande vitesse (VMO+6) ; **mode arrondi** sous 50 ft ; lois **alternée**, **directe**, secours mécanique selon les calculateurs (ELAC/SEC/FAC) et l'hydraulique ; priorité des mini-manches et double saisie ; les gouvernes visibles à la vitesse de leurs vérins ; **mesuré** : tenue de pente, réponse à 15°/s, protections qui tiennent à pleine butée | à faire |

### Bloc 2 — le cockpit et l'avionique

| # | Étape | Contenu | Statut |
|---|---|---|---|
| A5 | **Le cockpit** | `scripts/build-a320-cockpit.py` : `fd_complete.ac` (442 k triangles) allégé là où l'œil ne va pas, matières fusionnées, 24 textures en atlas KTX2 ; les **commandes en pièces nommées** (les 482 zones de `a320.flightdeck.xml` : leurs objets, axes, courses, crans) ; les surfaces des écrans en matières d'écran ; les sièges, mini-manches, manettes, palonniers, tiller animés ; l'**éclairage** — éclairage intégré des panneaux (lettrage), plafonniers, lampes de lecture, projecteurs d'orage ; les **voyants** (FAULT, OFF, ON, AVAIL…) allumés par l'état des systèmes ; jour/nuit, reflets dans le pare-brise ; l'œil du CDB et de l'OPL | à faire |
| A6 | **Tout est cliquable** | chaque bouton-poussoir, sélecteur, potentiomètre, levier et cache des 482 zones : le survol, le clic, la molette, le glisser, les crans (volets, aérofreins, manettes CL/FLX-MCT/TOGA, inverseurs, frein de parc, train, ENG MASTER), les caches rouges qui se soulèvent ; l'infobulle (FR/EN) ; le pointeur dans la vue, la manette (TDC) et la vue libre de la tête ; chaque commande reliée à son système (A8) ou marquée inopérante tant qu'il n'existe pas | à faire |
| A7 | **Les écrans** | `src/a320/du/` : les **SVG FlightGear dessinés sur canevas** et animés par leurs identifiants (loader SVG → chemins Path2D pré-compilés, au rythme des vrais écrans) : **PFD** (FMA, vitesse et ses repères VLS/VFE/VMAX/α prot, tendance, horizon, directeur de vol, altitude, V/S, cap, ILS), **ND** (ARC, ROSE NAV/VOR/ILS, PLAN ; route, contraintes, aéroports, VOR/NDB, trafic TCAS du trafic réel, **radar météo depuis la météo du jeu**, relief), **E/WD** (N1, EGT, N2, FF, flaps, mémos et alarmes), **SD** (les 13 pages : ENG, BLEED, PRESS, ELEC, HYD, FUEL, APU, COND, DOOR, WHEEL, F/CTL, STATUS, CRZ), **ISIS**, **DCDU** ; l'effet LCD, la luminosité par les potentiomètres, l'autotest à la mise sous tension, l'écran qui s'éteint sans bus ; un atlas d'écrans 4096² mis à jour par rectangles | à faire |
| A8 | **FCU, autopilote, A/THR** | `src/a320/fmgc/modes.ts` : la machine à modes de `FMGC-b.nas` réécrite et testée (armé/engagé, captures, transitions, FMA de `FMGC-c.nas`) ; FCU (sélecté/managé tiré-poussé, SPD/MACH, HDG/TRK, V/S/FPA, ALT, LOC, APPR, AP1/AP2, A/THR, EXPED) ; l'**A/THR** (SPEED, MACH, THR CLB/IDLE/MCT, A.FLOOR, TOGA LK, THR LK) ; décollage SRS → CLB, croisière, descente, **approche ILS et atterrissage automatique CAT III** (LAND, FLARE, ROLL OUT) sur les ILS du jeu, remise des gaz (GA), RWY ; déconnexions (cavalry charge) ; les vitesses managées (green dot, S, F, VLS, VFE) | à faire |
| A9 | **MCDU et FMGC** | les deux MCDU cliquables (touches et clavier de l'ordinateur dans le bloc-notes) : INIT A/B, F-PLN (départ/arrivée sur nos pistes, points, aéroports, discontinuités), LAT/VERT REV, DIR TO, PERF TO (V1/VR/V2 **calculées** pour aider, FLEX TEMP), CLB/CRZ/DES/APPR/GA, FUEL PRED, PROG, RAD NAV, HOLD, DATA ; branché sur `game/flightplan.ts` (LNAV/VNAV avec contraintes, profil de descente, T/D), les prédictions de carburant par les tables de consommation | à faire |

### Bloc 3 — un avion vivant

| # | Étape | Contenu | Statut |
|---|---|---|---|
| A10 | **Les systèmes** | `src/a320/systems/` : électricité (batteries, IDG, APU GEN, EXT PWR, TR, AC/DC ESS, RAT et EMER GEN), hydraulique (vert, bleu, jaune, PTU, RAT), carburant (pompes, transferts, X-FEED, déséquilibre), prélèvements et climatisation (packs, APU BLEED, pressurisation : altitude cabine), **APU** (démarrage, AVAIL), **démarrage moteur** (ENG MODE IGN/START, MASTER, N2 → allumage → EGT → stabilisé), **ADIRS** (alignement selon la latitude), feux, essuie-glaces, portes, oxygène, anti-givrage ; **les états de départ** (cold & dark, avant démarrage, roulage, décollage, en vol) ; tout pilotable depuis l'overhead | à faire |
| A11 | **ECAM, alarmes, pannes** | le FWC : phases de vol et inhibitions, **les 150 alarmes** avec leurs procédures (actions en cyan qui s'effacent quand on les fait), mémos, STATUS, MASTER WARN/CAUT, CRC, gong ; les **pannes injectables** (moteur au décollage, feu moteur, perte hydraulique, électricité de secours, double panne moteur → RAT, pressurisation, gel des sondes) ; les **check-lists** normales (`A32X-Checklists.xml`) et le QRH ; GPWS/EGPWS (modes 1–5, relief en avant), TCAS (RA/TA sur le trafic réel), windshear | à faire |
| A12 | **Le son** | les WAV FlightGear → Opus/OGG en LFS, joués par le moteur audio : les **CFM56** (cockpit, extérieur avant/arrière, aile : ralenti, montée en régime, buzz-saw de la soufflante, grondement, inverseurs), démarrage et arrêt, APU, packs, **PTU** (l'aboiement), volets et leur moteur, train (sortie, verrouillage, roulement, toucher), vent cockpit, pluie ; **alarmes** (CRC, gong, cavalry charge, cricket, C-chord), **annonces GPWS** (2500 → 5, « retard », « hundred above », « minimum », sink rate, pull up, terrain, too low gear/flaps, glideslope, bank angle) ; boutons et sélecteurs ; annonces cabine ; lois volume/hauteur de `Systems/cfm56-sound.xml` ; spatialisés (HRTF), filtrés à l'intérieur ; **mesuré** comme le F-35 | à faire |
| A13 | **Les effets** | condensation sur l'extrados (volets sortis, humidité), tourbillons d'extrémité et de volets, vortex d'entrée d'air au sol, deux traînées de condensation, fumée des pneus au toucher, embruns des inverseurs sur piste mouillée, gerbes d'eau des roues, distorsion de chaleur, **flexion des ailes** sous facteur de charge, tremblements (roulage, buffet, toucher), pluie sur le pare-brise **avec les essuie-glaces**, givre ; caméras cinéma (aile, train, passager au hublot) | à faire |

### Bloc 4 — le métier

| # | Étape | Contenu | Statut |
|---|---|---|---|
| A14 | **Sol et aéroports** | **repoussage** (le tracteur de FlightGear, commandé depuis le cockpit), roulage au tiller avec les marquages, les postes de stationnement et les voies de circulation d'**OpenStreetMap** (aeroway=parking_position/taxiway, par la tuile d'aéroport existante), les **services** (escaliers ou passerelle, traiteur, carburant avec le plein réel, GPU, cales, cônes), portes qui s'ouvrent, dégivrage ; départ « à la porte » choisi dans **Préparer un vol** | à faire |
| A15 | **Vols de ligne et ATC** | **Préparer un vol de ligne** : aéroports réels, route (grand cercle + points), passagers et fret, carburant calculé (étape, réserve, dégagement, à la pompe), METAR/TAF réels, devis de masse et centrage (load sheet), livrée et immatriculation ; le **contrôle aérien** — rôles radio délivrance, sol, tour, départ, centre, approche (sous-titres et voix, phraséologie FR/EN, clairance, repoussage, roulage, alignement, décollage, montées, fréquences), TARS en contrôleur ; le trafic réel autour (TCAS) ; **notation du vol** (confort passagers : g, inclinaisons, toucher ; ponctualité ; carburant ; procédures) et carnet de vol | à faire |
| A16 | **École, pannes, défis** | **qualification de type** guidée (`game/course.ts`) : tour du cockpit, mise en route, roulage, décollage, montée, croisière, approche ILS, atterrissage manuel, remise des gaz, panne moteur à V1, approche à vue, vent de travers, autoland ; **scénarios** (panne à V1, feu moteur, amerrissage de l'Hudson, double panne en plané, cisaillement de vent, CAT III dans le brouillard, Madère, Saint-Martin) ; **défis notés** (atterrissage le plus doux, vent de travers, précision du toucher, économie de carburant) ; les missions et l'éditeur ouverts à l'A320 | à faire |
| A17 | **Équipage à deux en réseau** | CDB et OPL dans le même avion : chaque place a ses commandes, **priorité des mini-manches** et « DUAL INPUT », l'état des systèmes partagé (un bouton pressé d'un côté s'allume de l'autre), FCU et MCDU de chacun, la voix ; la console crew au profil **airliner** (PFD/ND/ECAM répliqués, check-lists à deux, rôles PF/PNF) ; l'A320 du trafic réel et des missions remplacé par un niveau de détail du nouveau modèle (livrée selon la compagnie quand on l'a) | à faire |
| A18 | **Commandes, TARS, documentation** | profils clavier/manette/HOTAS Airbus (mini-manche, manette à crans CL/FLX/TOGA, inverseurs, tiller, déconnexions AP et A/THR, PTT) — dont le **Thrustmaster TCA Airbus** ; TARS **copilote PNF** (annonces, check-lists à voix, « flaps 1 », « gear up », lecture des ECAM) et base de connaissances A320 (`docs/aviation/{fr,en}/a320.md`) ; `docs/A320.md` + `docs/A320.fr.md` ; coût GPU final ; planche finale | à faire |
| A19 | **Les variantes** | A320-232 **IAE V2500** (moteur, FADEC à EPR, sons V2500), A320-251N **LEAP-1A** et A320-271N **PW1100G** (nacelles neo, sharklets, masses neo, sons LEAP) ; choisies au hangar avec la livrée | à faire |

## Ordre et règles

- Ordre : A0 → A4 (il vole, de l'extérieur) → A5 → A9 (on le pilote du cockpit) → A10 → A13 → A14 → A18 → A19.
- Un commit par étape, poussé (la poussée de `main` déploie) ; une planche par étape envoyée ; e2e courts (≤ 1 min) en vue
  cockpit, sur le mini pour les longs ; le F-35 et les vaisseaux restent verts.
- WGS84 partout (positions, hauteurs, contact au sol, pistes, ILS).
- Unités : selon `settings.units` comme partout (`ui/unitsys.ts`, métrique par défaut, jamais de kt/ft codés en dur) ;
  en impérial, l'avionique est exactement celle du vrai avion (kt, ft, FL, inHg/hPa).
