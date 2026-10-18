# Plan — les vaisseaux AAA : Ranger, Lander, Endurance au niveau du F-35, et deux équipages

*Écrit le 2026-10-18, sur `main` (`dd2e453c`). Inventaire fait le même jour (F-35, vaisseaux, console crew, réseau).*

Demande (2026-10-18) :
- amener **le Ranger, le Lander et l'Endurance au niveau du F-35** : options, assistances, pilotes automatiques,
  **HUD spécialisés**, **UI spécialisées**, **la roue (Tab maintenu)** — tout le polish ;
- **missions, école de vol, réalisme** pour les vols en vaisseau : HUD, UI, télémétrie, graphiques, cartes ;
- la console **crew** affiche **l'équipage F-35 ou l'équipage vaisseau selon l'appareil du joueur**, et **les deux
  sont différents** ; dans le crew vaisseau : **toutes les options**, affichages, **carte système solaire / Gargantua**,
  **orbites, prédictions** ;
- (en cours de rédaction) **« n'oublie pas tout le jeu en réseau, les interactions entre joueurs, vaisseau, partage,
  flotte »** ; et **« tout doit aussi être parfait en réseau »**.

## Décisions de l'utilisateur (2026-10-18)

| Sujet | Décision |
|---|---|
| Cockpits | **Les trois complets** : le Ranger repoli, un vrai cockpit du Lander et une passerelle de l'Endurance, écrans tactiles cliquables comme le PCD du F-35, chaque vaisseau son identité |
| Endurance | **Vaisseau-mère complet** : dans la flotte des deux côtés (Gargantua compris), Ranger et Lander s'y amarrent partout, anneau en rotation géré, scènes du film jouables (amarrage en vrille à Mann, fronde, largage du Lander), propulsion réaliste |
| Esprit du crew vaisseau | **Les deux** : chaque équipier choisit son poste, **à bord** (copilote, navigateur, ingénieur — l'esprit Interstellar) ou **au sol** (contrôle de mission : FLIGHT, FIDO, GUIDO, EECOM, CAPCOM) |
| Réalisme des systèmes | **Consommables + pannes** : ergols, RCS, électricité, O₂/support de vie, thermique ; pannes réglables avec checklists et procédures d'urgence, désactivables |
| Ordre | **Le vol d'abord** : assistances, autopilotes, HUD, roue et systèmes de bord ; le crew vaisseau vient ensuite, sur des données déjà riches |
| Carte du crew | **3D WebGPU + repli 2D** : orbites, trajectoire, nœuds, corps à leur vraie place ; WebGPU demandé seulement dans cette vue |
| Délai lumière (poste au sol) | **Réglable** : réaliste par défaut (données et commandes retardées, liaison coupée derrière le trou de ver, messages enregistrés), un réglage de salle pour le couper |
| Réseau | **Tout parfait en réseau** : interactions entre joueurs, vaisseau partagé, partage, flotte — un volet à part entière (phase **N**) et une ligne « réseau » dans chaque phase |

Reprises des plans précédents :
- **FR + EN** partout (`src/i18n/fr-*.ts`, le test `i18n` en garde) ; **unités métriques** via `ui/unitsys.ts`.
- **Un commit poussé et une fiche d'avancement par étape**, captures à l'appui (`docs/progress/vaisseaux/`) ;
  `bunx biome ci .` et `bun scripts/check-repo-size.ts --base origin/main` avant chaque push.
- **WGS84** pour tout ce qui touche la Terre (CLAUDE.md) ; les autres corps en sphères (ou leur figure propre).
- **e2e courts (≤ ~1 min), FPS affichés, entrée réelle (CDP)**, vue cockpit par défaut ; campagnes longues sur kerr-mini.
- **Le solo reste entier** : aucune connexion externe sans action du joueur ; aucun téléchargement de modèle sans
  demander (nom, source, taille).
- **Le F-35 ne régresse pas** : toute généralisation garde ses tests verts (école, missions, défis, crew A1–A6).

## État du code (inventaire du 2026-10-18)

### Ce qui existe et sert
- **Trois vaisseaux** (`src/vessels.ts:205/266/321`) : Ranger 40 t (2 moteurs, ailes, train à roues, bouclier,
  9 g), Lander 160 t (6 moteurs en deux nacelles, patins, 6 g), Endurance 900 t (4 moteurs, `lands/flies: false`,
  1,5 g). Le Ranger seul a des lampes (`ship-lights.ts`) et un intérieur (`assets/ranger/cockpit.bin`, 76 k
  triangles, 10 pages d'écrans, 20 commandes cliquables — `src/cockpit/*`, `ui/cockpitscreens.ts`).
- **Le pilotage** (`pilot.ts` `FlightComputer`) : commande en vitesse angulaire, SAS, 9 maintiens d'attitude,
  précision (Verr. Maj), mode AUTO/ASSISTÉ commun à tous les autopilotes (⇧F4, le `director`).
- **Onze autopilotes** (`pilot.ts:29`) : vol stationnaire, circularisation, approche, orbite de la cible, nœud,
  transfert à faible poussée, atterrissage, décollage, amarrage, rentrée (désorbitation → rentrée guidée → plané →
  approche → arrondi, remise des gaz), séquences de poussées (côté Gargantua).
- **L'ordinateur de vol** (`ui/fc/computer.ts`, O) : ORBITE, CIBLE, ATTERRIR, MISSION ; planification puis EXÉCUTER ;
  planificateur n corps (`system/our-plan.ts`, `plan-worker`), rendez-vous ISS, Lambert.
- **Le HUD vaisseau** (`ui/flighthud.ts`, 4 185 lignes) : bandeaux, carte du hub (phase, tendances, prédiction),
  boule d'attitude, panneau d'amarrage, encart relativité ; `ui/hud/graph.ts` (graphiques des assistants, corridor
  optimal) ; trois HUD (`game/hudkind.ts` : Atmosphère, Espace, Approche) ; dégroupage par phase.
- **Cartes** : carte 3D des deux univers (`ui/map3d/*`, coniques patchées, sphères de Hill, trou de ver), trace au
  sol / planisphère (`ui/groundtrack.ts`), atlas Terre/Lune/Mars.
- **Tablette** (M) : ORDINATEUR, VAISSEAU, TÉLÉMÉTRIE (3 courbes, export CSV), CARTES, CAMÉRA, CIEL, JOURNAL ;
  **compte rendu /20** à l'atterrissage et à l'amarrage (`game/report.ts`) ; panneaux Placer et Temps.
- **Voix** : `game/capcom.ts` (Houston, tour, délai lumière, perte de signal au trou de ver), `game/callouts.ts`,
  `game/tars.ts` (conseils hors ligne) ; **son** : `audio/rocket.ts` (une seule voix de fusée), RCS, roues de
  réaction, cabine.
- **Réseau vaisseau** (`docs/NETWORK.md` R6–R8) : en orbite ensemble (Kepler entre les échantillons), vote du
  warp de salle, **amarrage entre joueurs** (le plus léger tenu par le plus lourd, désamarrage à 5 cm/s), contacts
  de coque, **monde persistant** (le vaisseau laissé en orbite, ciblable, amarrable), **passager** (à pied, monter
  dans le vaisseau posé d'un autre), côté Gargantua (carte de Boyer–Lindquist, horloge de salle, τ affiché).
- **La console crew** (`crew/`, `src/crew/*`, `src/net/instruments.ts` v1, `ui/crew-feed.ts`, `ui/crew-exec.ts`) :
  9 vues, actions A1–A6 dont l'**ordinateur de vol vaisseau** (A4 : maintiens, autopilotes, manœuvres, missions).

### Le F-35 a, les vaisseaux n'ont pas (le cahier des charges de la parité)

| Domaine | F-35 | Vaisseaux aujourd'hui |
|---|---|---|
| Réglages | groupe « F-35 » de 25 réglages (`ui/schema.ts` ≈ l.4000) : assistance, protections, loi, carburant/munitions infinis, IA, radar, HMD… | « Ranger handling » (6), apparence ; rien pour le Lander, rien d'assistance |
| Niveaux d'assistance | manuel / réaliste / assisté / débutant (`controller/assistlevel.ts`, `f35Assist`) + ⇧X « retour au vol stable » | SAS, précision, AUTO/ASSISTÉ ; pas de niveaux, pas de « récupérer » |
| Protections auto | Auto-GCAS / ACAS (`game/gcas.ts`) | aucune (sol, collision station, couloir de rentrée, g) |
| Plans de vol | LNAV/VNAV, panneau de route ⇧O, hub « Préparer un vol » | onglet MISSION de l'ordinateur ; pas de chronologie de mission éditable |
| HUD spécialisé | HMD, radar, armes, avionique, ILS, GCAS, défis (`symbology.ts`, `jethud.ts`) | un HUD commun aux trois ; le Lander n'a pas de HUD de descente, l'Endurance pas de HUD de vaisseau-mère |
| Écrans de bord | PCD tactile 8 pages (`f35/pcd.ts`) + HMD | Ranger : 10 pages non tactiles ; Lander, Endurance : rien |
| Roue (Tab) | 10 secteurs riches (`main.ts:3662` `jetWheel`) | 4 maintiens + 7 autopilotes ; manquent radial/normal/nœud, orbite/nœud/transfert, ordinateur de vol, assistance, flotte, désamarrage, train ; la Navigation du Ranger mène aux fonctions avion (ILS, défis F-35) |
| Manette / HOTAS | disposition propre (`input/jetpad.ts`) | pas de translation RCS, pas de regard, pas d'autopilotes |
| École | 18 leçons guidées, démo (TARS vole tout), instructeur, débrief graphique (`game/course.ts`, `controller/course.ts:430` refuse les autres) | aucune leçon |
| Défis / quals | 6 défis, quals porte-avions, voltige jugée | aucun |
| Missions | 13 missions à objectifs (`game/mission.ts`, `airmissions.ts`), carte, éditeur, débrief | 6 briefings de scène sans objectifs ni score (`game/missions.ts`) ; `mission.ts` (le voyage Interstellar entièrement automatique) |
| Radio / TARS | rôles (tour, ailier, AWACS, LSO), base de connaissances `docs/aviation/` | CAPCOM générique ; pas de base de connaissances spatiale ; `tars.ts:309` donne la mauvaise touche (0 au lieu de O) |
| Sons / effets | turbofan, PC, souffle, buffet, vapeur, secousses, haze | une voix de fusée pour trois vaisseaux ; secousses pour le Ranger seul |
| Crew | MCP, armes (A3, A5), vues aviation | les mêmes vues aviation (carte OSM, ILS, tuiles Mach/AGL) ; la carte ORBITE prend le rayon de la Terre partout (`crew/draw/systems.ts:302`) ; pas de carte système, pas de trajectoire 3D, pas de nœuds |

### Défauts connus à purger en chemin
- `docs/CAMPAGNE-AUTOPILOTES-2026-10-07.md` « Reste à traiter » : mission Jupiter en échec, ascension 27–30 % au-dessus
  du Δv optimal, inclinaison au pôle J2000 contre sites au pôle de la date, côté Gargantua non testé (décollage de
  Miller, chauffe d'Edmunds, orbites à faible poussée).
- `docs/ERRORS-TO-FIX.md` E1 : `heightAt` NaN après chaque poussée.
- Le texte d'aide parle « du Ranger » pour les trois (`keymap.ts:400`) ; l'Endurance ne peut ni amarrer ni être
  piloté côté Gargantua (`docking.ts:86`, `controller/fleet.ts:161`) ; « Not yet » du réseau : Endurance de salle
  partagée avec baux, masse de l'assemblage pour l'hôte, train et lampes d'un Ranger distant, siège passager.

## Principes

1. **Une famille, trois personnalités.** Une couche commune « vaisseau » (assistance, protections, roue, systèmes,
   école, missions) paramétrée par un **profil par vaisseau** (`VESSELS.*.space` : HUD, pages d'écrans, roue,
   systèmes, voix, secousses, leçons). Le Ranger est l'avion spatial agile, le Lander la grue lourde de descente
   motorisée, l'Endurance le vaisseau-mère lent, à l'anneau tournant.
2. **Le F-35 est la règle de mesure.** Chaque phase finit par sa ligne du tableau de parité cochée, mesurée.
3. **Le réalisme d'abord, l'aide en option.** Valeurs réelles (Apollo, Navette, ISS, Dragon/Soyuz) quand elles
   existent ; les niveaux d'assistance et les réglages « infini / invulnérable / sans panne » pour jouer.
4. **Le réseau dans chaque phase.** Rien n'est fini s'il ne marche pas à deux (ou plus) dans une salle : chaque
   phase a son critère réseau et son e2e à deux navigateurs sur kerr-mini.
5. **Le crew suit.** Chaque phase vaisseau publie ses données dans l'instantané (blocs optionnels v1) pour que le
   bloc K les affiche sans retoucher la simulation.

## Les phases

Ordre décidé : **bloc 1 vol (X0–X5) → bloc 2 crew (K1–K7) → bloc 3 immersion (X6–X8) → bloc 4 école, défis,
missions (X9–X11) → N réseau (chaque phase en porte sa part, N finit les fonctions propres au multijoueur)
→ Z finition**.

---

### Bloc 1 — Le vol

### X0 — Le socle : profils, réglages, niveaux d'assistance, défauts
- **Profils par vaisseau** (`VESSELS.*.space`) : ce que chaque couche lit au lieu de tester `fleet.active`.
- **Réglages** (`ui/schema.ts`, `settings.ts` « pref ») : un groupe par vaisseau, au niveau du groupe F-35 —
  niveau d'assistance, protections auto, limite de g, ergols infinis, RCS infini, invulnérable, pannes (X3),
  consommables (X3), couleur/luminosité du HUD, annonces de l'instructeur, voix CAPCOM, secousses, pages d'écrans.
- **Niveaux d'assistance vaisseau** (`controller/assistlevel.ts` généralisé, `spaceAssist`) :
  - *manuel* : pas de SAS imposé, RCS en accélération directe, aucune protection ;
  - *réaliste* (défaut) : SAS, maintiens, protections qui avertissent ;
  - *assisté* : le directeur toujours affiché, autopilote en ASSISTÉ, translation RCS amortie, poussée limitée près
    du sol ;
  - *débutant* : protections qui agissent, couloirs larges, rotation tuée au lâcher, gâchette « suivre le directeur ».
- **⇧X « Récupérer »** pour les vaisseaux (même action `jetSystem recover`) : tuer la rotation, puis selon la phase —
  rétrograde horizon et vol stationnaire près du sol, prograde en orbite, attitude de rentrée dans l'air.
- **Purge des défauts** : E1, touche TARS, textes d'aide et `keymap`. *(Fait : la mission Jupiter, le Δv d'ascension
  et le pôle de la date sont des défauts d'autopilotes — passés en X1. Les profils par vaisseau naissent avec leur
  premier usage, X4/X5. L'affichage des « triches » aux autres va en N.)*
- **Réseau** : les réglages « pref » restent locaux ; les triches (infini, invulnérable) affichées dans le tag
  des autres et refusées en match classé.
- **Mesure** : tests unitaires des niveaux ; l'ascension ≤ 10 % du Δv optimal ; campagne autopilotes re-jouée.

### X1 — Pilotage et pilotes automatiques complets
- **Modes RCS** : *rotation* (actuel), *translation 6 DDL* (amarrage, à la Dragon/Soyuz : manche gauche
  translation, droit rotation), *mixte* ; vitesses d'amarrage réelles (0,03–0,1 m/s au contact).
- **Nouveaux autopilotes** :
  - **maintien à poste** relative à une cible (station-keeping, R-bar / V-bar) ;
  - **rendez-vous complet** : phasage → approche lointaine → ellipsoïde d'approche (4 × 2 × 2 km) → sphère
    d'exclusion (200 m) → couloir final, comme l'ISS ;
  - **désamarrage et éloignement** (séparation, sortie du couloir) ;
  - **descente motorisée du Lander** à la Apollo (P63 freinage, P64 approche avec **désignateur de point
    d'atterrissage** re-désignable au manche, P66 vertical contrôlé) ; **hoverslam** pour le Ranger ;
  - **ascension vers un rendez-vous** (décollage lunaire direct vers l'Endurance ou un joueur) ;
  - **fronde** (assistance gravitationnelle planifiée, Gargantua compris) ;
  - côté Endurance : longues poussées et faible poussée, contrôle de l'anneau (X2).
- **Le plan de mission** (l'équivalent de LNAV/VNAV et du panneau de route ⇧O) : une **chronologie éditable**
  (fenêtre de tir, poussées, croisières, changements de sphère, rendez-vous, atterrissage) lue de l'ordinateur de
  vol, avec le Δv par étape, la marge d'ergols et un « exécuter jusqu'à ». ⇧O l'ouvre en vaisseau ;
  `__bh.flight.plan` l'expose aux tests.
- **Protections auto** (l'équivalent d'Auto-GCAS/ACAS, `game/spaceguard.ts`) : sol (taux de descente vs hauteur →
  stationnaire), zone d'exclusion d'une station ou d'un joueur (vitesse de rapprochement trop forte → freinage),
  couloir de rentrée (rebond ou surchauffe prédits), limite de g et de chauffe structurale ; réglage
  avertir / agir / off.
- **Défauts de la campagne autopilotes** (venus de X0) : mission Jupiter (le planificateur se croit sur sa visée),
  ascension à +27–30 % du Δv optimal, inclinaison au pôle J2000 contre sites au pôle de la date.
- **Réseau** : rendez-vous et amarrage automatiques sur un joueur (existe pour DOCK, étendu au maintien de
  position et au rendez-vous complet) ; les protections tiennent compte des vaisseaux des autres.
- **Mesure** : e2e par autopilote (ISS rendez-vous de bout en bout, descente Lander sur la Lune à < 50 m du
  point désigné, fronde), tests unitaires de la chronologie.

### X2 — L'Endurance, vaisseau-mère
- **Une seule Endurance** : l'objet dessiné côté Gargantua (`src/endurance.ts`) et le vaisseau de la flotte
  (`fleet.ts`) deviennent un seul vaisseau, pilotable **des deux côtés** du trou de ver.
- **L'anneau** : rotation réglable (montée, descente en régime avec le RCS, couple et ergols comptés), gravité
  artificielle affichée par module, moyeu amarrable en rotation (le pilote doit égaler le roulis).
- **La flotte autour d'elle** : Ranger(s) et Lander amarrés à leurs ports (le Lander largué et repris comme dans le
  film), bascule de vaisseau partout (`controller/fleet.ts:161` levé), transfert d'ergols et d'électricité entre
  vaisseaux amarrés.
- **Propulsion** : moteurs principaux (poussées longues, faible accélération), mode faible poussée,
  l'Endurance ne se pose pas (refus expliqué) ; ses modules (dégâts par module, explosion de Mann jouable en X11).
- **Les scènes du film** préparées comme situations jouables : amarrage en vrille à Mann (≈ 67–68 tr/min),
  fronde autour de Gargantua avec largage, départ de Saturne.
- **Réseau** : **l'Endurance de salle partagée** (le « Not yet » de R7) — un vaisseau de la salle, non possédé,
  avec **baux** : qui la pilote en a le bail (demande / cession / reprise si déconnexion), les autres amarrés
  restent tenus ; la **masse de l'assemblage** comptée chez celui qui pilote ; persistance dans la salle.
- **Mesure** : e2e amarrage au moyeu tournant (solo et à deux), bascule Ranger → Endurance → Lander côté Miller,
  fronde jouée.

### X3 — Systèmes de bord : consommables, pannes, checklists
- **Consommables** (`game/systems.ts`, modèle pur, testé) : ergols principaux et RCS séparés, électricité
  (batteries, panneaux / générateur, consommation par système), **support de vie** (O₂ ≈ 0,84 kg/personne/jour,
  CO₂ à épurer, eau), thermique (radiateurs, bouclier ablatif), liaisons (antennes, masquage par un corps,
  délai lumière) ; équipage par vaisseau ; tout affiché avec des marges et des prévisions (« O₂ : 41 j »).
- **Pannes** (réglage off / rares / réalistes / difficiles, graine reproductible) : moteur éteint ou poussée
  réduite, propulseur RCS bloqué ouvert, gyroscope qui dérive, capteur faux (altimètre radar), bus électrique,
  fuite, verrou d'amarrage, réchauffeur ; des causes, des symptômes, des effets sur le vol.
- **Alarmes et checklists** : le système d'alarme (maître caution existant) avec des messages précis, des
  **checklists normales** (pré-lancement, mise en orbite, rendez-vous, rentrée, atterrissage) et **d'urgence**
  (incendie, dépressurisation, moteur, RCS), pas à pas, dans la tablette et sur les écrans ; actions de bord
  (disjoncteurs, secours, isoler un RCS).
- **Réseau** : l'état des systèmes appartient au propriétaire du vaisseau et part dans l'échantillon (compact) ;
  les pannes sont tirées chez lui (graine de salle en mission) ; un vaisseau amarré partage ses ressources.
- **Mesure** : tests unitaires (bilans sur 30 jours, pannes reproductibles), e2e « RCS bloqué en approche ISS ».

### X4 — Les HUD spécialisés
- **Ranger** : le HUD actuel repoli (Atmosphère / Espace / Approche), mêmes soins que le HMD : couleurs réglables,
  dégroupage, directeur, marqueurs de nœud et de cible.
- **Lander** : un **HUD de descente** à la LM — H et Ḣ, vitesses avant/latérale en croix, grille du désignateur
  de point d'atterrissage sur la vue, carburant restant en secondes de vol stationnaire, « 60 / 30 secondes »,
  détection d'obstacles (pente, rochers du relief).
- **Endurance** : un **HUD de vaisseau-mère** — régime de l'anneau et g par module, état des ports (libre, amarré,
  qui), poussées longues (temps restant, Δv), attitude de la fronde, état des modules.
- **Amarrage AAA** pour tous : réticule COAS, caméra d'axe, distance / vitesse de rapprochement sur le profil
  nominal, cible d'alignement comme celle de l'ISS, couloir et ellipsoïde dessinés.
- **Boule de navigation AAA** (marqueurs prograde/normal/radial/cible/nœud, directeur, erreurs chiffrées).
- **Réseau** : les joueurs dans le HUD (tags, distance, vitesse relative, orbite), alerte de proximité, port
  libre ou pris sur le vaisseau d'un autre.
- **Mesure** : galerie HUD (`scripts/hud-gallery.ts`, états sauvegardés par vaisseau), feuille de captures.

### X5 — La roue, la manette, le HOTAS
- **Roue par vaisseau** (déclarée par profil, `ui/wheel.ts` inchangé) :
  - *Maintiens* ▸ les 9 ; *Autopilotes* ▸ tous (orbite, nœud, transfert, maintien à poste, rendez-vous,
    désamarrage, descente, fronde) ;
  - *Ordinateur de vol* ▸ ORBITE / CIBLE / ATTERRIR / MISSION, plan de mission (⇧O), exécuter ;
  - *Systèmes* ▸ train, lampes, mode RCS, alimentation, checklists, acquitter, anneau (Endurance) ;
  - *Amarrage* ▸ amarrer, désamarrer, port, cible, maintien à poste ;
  - *Flotte* ▸ bascule de vaisseau, ordres aux vaisseaux de la flotte et de la salle (N) ;
  - *Navigation* ▸ carte, placer, cible ; *École & défis* ▸ ; *Caméra* ▸ ; *Vaisseau* ▸ mode de vol, assistance.
  - Les entrées avion (ILS, défis F-35) quittent la roue du Ranger, sauf en mode avion.
- **Manette vaisseau** (`input/spacepad.ts`, comme `jetpad.ts`) : translation RCS en mode amarrage, regard au
  manche droit, gâchettes poussée, croix maintiens, roue à la manette ; **HOTAS** : profil translation 6 DDL ;
  feuille d'aide par vaisseau.
- **Réseau** : la roue *Flotte* donne les ordres aux autres joueurs (demande d'amarrage, « tiens ta position »,
  rendez-vous) — reçus comme ceux de la patrouille F-35.
- **Mesure** : e2e roue (entrée réelle, Tab maintenu), e2e manette factice.

---

### Bloc 2 — Les deux équipages (crew)

### K1 — Le contrat « espace » des instruments
Blocs optionnels nouveaux de l'instantané v1 (`src/net/instruments.ts`, `ui/crew-feed.ts`), bornés :
- `orbit` complété (rayon du corps, demi-grand axe, anomalies) — la carte ORBITE cesse de prendre le rayon terrestre ;
- `traj` : la trajectoire prédite en 3D (repère du corps de référence, segments par sphère d'influence, sort final),
  et la trajectoire planifiée (`OurPath`, `plan.path`) ;
- `nodes` : les nœuds de manœuvre (date, Δv par axe, durée), la poussée en cours ;
- `bodies` : les positions des corps utiles (éphémérides du jeu, une fois par seconde) ou leurs éléments ;
- `target` : la cible (distance, vitesse de rapprochement, approche minimale et sa date), la rencontre ;
- `sysx` : consommables, pannes, checklist en cours (X3) ; `time` : warp, horloge de salle, τ, temps écoulé sur
  Terre ; `link` : délai lumière, liaison coupée ; `ring`, `ports` (Endurance).
- **Réseau** : budget de débit mesuré (4 Hz, blocs lourds à 1 Hz), 16 Ko par événement tenus.

### K2 — Une console par appareil
- **Profil de console** choisi par l'appareil suivi (`caps.fam` + `own.kind`) : **F-35** (tactique : PFD, ND, carte
  OSM, globe, radar, armes, plan de vol, VSD) ou **vaisseau** (onglets propres, tuiles propres : Δv, ergols, Pe/Ap,
  période, prochain événement, g, τ, liaison). Bascule propre quand le pilote change d'appareil.
- **Le crew F-35 rendu distinct** : identité tactique (thème, ordre des vues, MCP et armes en avant, onglet
  « Mission aérienne »).
- **Mesure** : test unitaire du choix de profil ; e2e qui suit un pilote passant du F-35 au Ranger.

### K3 — La carte système solaire / Gargantua (3D WebGPU, repli 2D)
- Vue 3D orientable : corps à leur place (`system/solar.ts` est pur — à tenir dans le budget du bundle, sinon
  positions envoyées par K1), orbites des corps, **trajectoire patchée** du pilote, **nœuds**, sphères
  d'influence, cible et rencontre, les autres joueurs et leurs orbites ; côté Gargantua : Miller, Mann, Edmunds,
  le trou de ver, l'ISCO, l'orbite de photons.
- Échelle vraie / logarithmique, focus sur un corps, temps futur à faire défiler (prédiction).
- WebGPU demandé dans cette vue seulement (règle du globe) ; **repli 2D** canvas (vue du dessus + profil).
- Textures des corps chargées à l'exécution (pas d'image dans le bundle : test `crew.test.ts`), sinon vectoriel.

### K4 — Les vues vaisseau
- **Orbite** (conique 2D autour du corps, Pe/Ap, nœuds, cible) ; **PFD espace / boule de navigation** ;
  **amarrage** (schéma axe et couloir, distance, rapprochement, alignement) ; **Δv et ergols** (budget par étape
  du plan de mission) ; **systèmes EECOM** (consommables, pannes, checklists) ; **chronologie** (MET, événements
  à venir, fenêtres) ; **relativité** (dτ/dt, γ, temps écoulé sur Terre) ; **sol** (globe des corps, trace au sol,
  sites d'atterrissage, désignateur du Lander).

### K5 — Les postes : à bord ou au sol
- Au lobby, l'équipier choisit **à bord** (copilote, navigateur, ingénieur) ou **au sol** (FLIGHT, FIDO, GUIDO,
  EECOM, CAPCOM) ; chaque poste a ses onglets par défaut, ses actions mises en avant, son nom dans la salle.
- **Délai lumière réglable** (réglage de salle, réaliste par défaut) : le sol voit les données et envoie ses
  commandes avec le délai réel (Lune 1,3 s, Mars des minutes) ; derrière le trou de ver, plus de temps réel :
  **messages enregistrés** (texte / voix) délivrés à l'arrivée, compteur « temps écoulé sur Terre » ; à bord,
  toujours en direct. Tonalités Quindar pour le CAPCOM.

### K6 — Toutes les actions vaisseau
- `sp.target` enfin dans l'interface, cible depuis la carte 3D ; **nœuds déplaçables** sur la carte (comme les
  points de route) ; plan de mission édité ; maintien à poste, rendez-vous, désamarrage (X1) ; systèmes
  (disjoncteurs, secours, isoler un RCS, checklists partagées) ; anneau de l'Endurance ; ordres de flotte.
- Toujours « tout sauf piloter » (`PLAN-CREW-ACTIONS`) : liste blanche, verrou du pilote, 4 actions/s.

### K7 — La salle de démonstration vaisseau, les tests, la doc
- `scripts/crew-demo.ts` : un pilote vaisseau scénarisé (Ranger en approche de l'ISS, Lander en descente lunaire,
  Endurance côté Gargantua) à côté des F-35 ; e2e crew vaisseau (vues, carte 3D, repli 2D, postes, délai) ;
  `docs/CREW.md` complété.

---

### Bloc 3 — L'immersion

### X6 — Les cockpits
- **X6a Ranger** : écrans **tactiles** comme le PCD (pages ORB, NAV, SYS, DCK, PLN, CLK, LOG, APP, LDG + CKL
  checklists + SYSTÈMES), boutons physiques complétés (modes RCS, alimentation), éclairage nuit.
- **X6b Lander** : un vrai cockpit (le modèle source n'a que l'extérieur) — construit sous Blender à partir de la
  coque (hublots de descente, tableau LM-like, grille du désignateur gravée sur le hublot), ou un modèle CC-BY
  proposé avant tout téléchargement ; occlusion et ciel cuits, commandes cliquables.
- **X6c Endurance** : la **passerelle** (module de commande : sièges, consoles, hublots sur l'anneau, TARS/CASE),
  écrans de vaisseau-mère, vue sur la rotation ; même chaîne Blender → `build-*.ts`.
- **Réseau** : **un second siège modelé** (le « Not yet » de R5) : un passager ou un joueur à bord prend un siège,
  voit les écrans en direct, peut agir comme copilote depuis le cockpit (mêmes droits que le crew à bord).
- **Mesure** : coût GPU mesuré (`trace-ab` sur vues figées), captures cockpit jour/nuit.

### X7 — Sons, effets, caméras
- **Une voix par vaisseau** (Ranger vif, Lander grave et lourd, Endurance profond et lent), caractère RCS par
  vaisseau, ambiance de cabine, craquements de structure, chocs d'amarrage, souffle dans le casque, tonalités de
  liaison ; plasma de rentrée et vibrations dans le cockpit.
- **Secousses** pour les trois (lancement, rentrée, contact, atterrissage, anneau) ; effets de rentrée.
- **Caméras et rejeu** : meilleurs moments spatiaux (amarrage, poser, fronde), vues d'exception spatiales
  (anneaux de Saturne, trou de ver, Gargantua), photo.
- **Réseau** : sons des vaisseaux des autres (moteurs, RCS proches), effets visibles d'un joueur à l'autre.

### X8 — Télémétrie, graphiques, comptes rendus
- Canaux propres au vaisseau (Δv dépensé vs prévu, marges, chauffe et g de rentrée, profil d'amarrage, consommables).
- **Comptes rendus /20 par phase** : ascension (efficacité), insertion (précision), rendez-vous (Δv, temps),
  amarrage, rentrée (couloir), atterrissage (précision, vitesse) ; débrief à graphiques comme l'instructeur F-35.
- MET, journal de mission, compteur « temps écoulé sur Terre ».
- **Réseau** : comptes rendus partagés dans la salle (classement par épreuve), envoyés au crew.

---

### Bloc 4 — École, défis, missions

### X9 — L'école de vol spatial
- `game/course.ts` généralisé (familles *avion* / *espace*), `controller/course.ts` ouvert aux vaisseaux ; chaque
  leçon en **guidé**, **démo** (TARS vole tout, garde-fou de blocage) et **essai** :
  1. attitude et RCS ; 2. maintiens et SAS ; 3. bases orbitales (prograde/rétrograde, monter, descendre) ;
  4. circulariser, Hohmann ; 5. changement de plan ; 6. rendez-vous ; 7. amarrage manuel 6 DDL ;
  8. désorbitation et rentrée ; 9. plané et atterrissage sur piste (Ranger) ; 10. descente motorisée lunaire
  (Lander, désignateur) ; 11. décollage et ascension ; 12. amarrage à l'Endurance en rotation ; 13. fronde ;
  14. navigation relativiste près de Gargantua (Miller) ; 15. urgences (moteur, RCS bloqué, dépressurisation).
- Instructeur vaisseau (canaux par leçon), cartes de leçon et schémas, base de connaissances `docs/spatial/{fr,en}`
  pour TARS (outil `knowledge`).
- **Réseau** : leçon à deux (moniteur et élève : le moniteur voit et commente, peut reprendre la main en démo).

### X10 — Défis et qualifications
- Amarrage contre la montre, poser de précision (cible lunaire, martienne), couloir de rentrée, hoverslam,
  rendez-vous au Δv minimal, amarrage à l'Endurance en vrille, fuite de la vague de Miller, fronde de Gargantua ;
  médailles, records locaux.
- **Réseau** : défis de salle (même départ, classement en direct, fantômes des autres).

### X11 — Missions, éditeur, la campagne Interstellar
- `game/mission.ts` étendu à l'espace : objectifs (orbite, rendez-vous, amarrage, poser sur un site, retour),
  budgets (Δv, ergols, temps), fenêtres, pannes injectées, déclencheurs ; carte de mission = la carte 3D ;
  éditeur et lien `#mission=` ; débrief.
- **Bibliothèque** : Artemis II, ISS, alunissage, Mars, sauvetage d'un vaisseau en panne, et **la campagne
  Interstellar** jouée chapitre par chapitre (lancement → Endurance → Saturne → trou de ver → Miller → Mann →
  fronde → Edmunds) avec objectifs, score, débrief — `mission.ts` (le voyage automatique) devient la démo.
- **Réseau** : missions coopératives à rôles (l'un garde l'Endurance en orbite, l'autre descend en Lander, un
  troisième au contrôle de mission), réussite commune, reprise si un joueur part.

---

### N — Le jeu en réseau, partout (interactions, vaisseau partagé, partage, flotte)
Chaque phase porte sa ligne réseau ; N finit ce qui n'existe qu'à plusieurs.
- **Équipage dans un même vaisseau** : plusieurs joueurs à bord (sièges de X6), rôles pilote / copilote /
  ingénieur, passation du manche (demande, accord, reprise), le copilote règle autopilotes et systèmes comme le crew.
- **Vaisseaux partagés et baux** : l'Endurance de salle (X2), tout vaisseau « libre » de la salle prenable avec bail ;
  reprise propre à la déconnexion (le vaisseau continue sur son orbite, persistant).
- **La flotte de salle** : liste des vaisseaux (à qui, où, état, ergols), ordres de flotte (rendez-vous, amarrage,
  maintien), bascule vers un vaisseau de la salle avec son accord.
- **Partage** : transfert d'ergols, d'électricité, d'O₂ entre vaisseaux amarrés ; partage de cibles, de plans de
  mission, de nœuds ; points d'intérêt et sites marqués pour la salle ; passage de joueurs d'un vaisseau à l'autre
  par le sas (à pied quand c'est posé, amarré en orbite).
- **Interactions** : amarrage mutuel (existe), maintien à poste et rendez-vous sur un joueur (X1),
  remorquage d'un vaisseau en panne, sauvetage, collision et contacts (existent), avertissement de proximité.
- **Temps** : warp de salle avec poussées longues (un joueur en poussée retient le warp, explication affichée),
  horloge de salle et dilatation (τ par joueur, « temps écoulé sur Terre » de chacun, R8 « pace following the
  proper time » tranché et documenté), délai lumière de salle (K5).
- **Restes du réseau à finir** : train et lampes d'un Ranger distant, masse de l'assemblage pour l'hôte, repères
  courbés par la lentille au loin.
- **Mesure** : e2e à deux navigateurs (kerr-mini) : équipage à deux dans l'Endurance, bail cédé puis repris à la
  déconnexion, transfert d'ergols amarré, mission coopérative Lander + Endurance, défi de salle.

### Z — Finition
- `docs/VAISSEAUX.md` + `.fr.md` (comme `F35.md`), `docs/HUD.md`, `docs/CREW.md`, `docs/NETWORK.md`,
  `docs/E2E-CATALOGUE.md` à jour ; feuille finale de captures ; campagne e2e complète sur kerr-mini.

## Tableau de suivi

| Phase | Contenu | État |
|---|---|---|
| X0 | niveaux d'assistance, ⇧X, ergols infinis, E1, aide, TARS | **fait** 2026-10-18 ([fiche](progress/vaisseaux/X0.md)) |
| X1 | modes RCS, nouveaux autopilotes, plan de mission, protections, défauts de la campagne autopilotes | en cours — X1a maintien à poste, recul, mode RCS ([fiche](progress/vaisseaux/X1a.md)) · X1b protections ([fiche](progress/vaisseaux/X1b.md)) · X1c rendez-vous ([fiche](progress/vaisseaux/X1c.md)) · X1d LPD ([fiche](progress/vaisseaux/X1d.md)) · X1e plan de mission ([fiche](progress/vaisseaux/X1e.md)) · X1f pôle de la date ([fiche](progress/vaisseaux/X1f.md)) ; restent l'ascension en deux temps et Jupiter (sessions à part) |
| X2 | Endurance vaisseau-mère (deux côtés, anneau, flotte, scènes) | en cours — X2a l'anneau ([fiche](progress/vaisseaux/X2a.md)) · X2b ergols et plein ([fiche](progress/vaisseaux/X2b.md)) · X2c près de Gargantua ([fiche](progress/vaisseaux/X2c.md)) · X2d Mann en vrille ([fiche](progress/vaisseaux/X2d.md)) · X2e piloter près de Gargantua, traversée amarrée ([fiche](progress/vaisseaux/X2e.md)) — **fait** (la fronde : X11) |
| X3 | consommables, pannes, alarmes, checklists | **fait** 2026-10-18 ([fiche](progress/vaisseaux/X3.md)) — pannes en réseau en N |
| X4 | HUD Ranger / Lander / Endurance, amarrage, boule | **fait** 2026-10-18 ([fiche](progress/vaisseaux/X4.md)) — reste la couleur du HUD et la boule « AAA » |
| X5 | roue par vaisseau, manette, HOTAS | **fait** 2026-10-18 ([fiche](progress/vaisseaux/X5.md)) — ordres de flotte en réseau en N |
| K1 | contrat « espace » des instruments | à faire |
| K2 | console par appareil, crew F-35 distinct | à faire |
| K3 | carte 3D WebGPU système solaire / Gargantua + repli 2D | à faire |
| K4 | vues vaisseau | à faire |
| K5 | postes à bord / au sol, délai lumière réglable | à faire |
| K6 | actions vaisseau complètes | à faire |
| K7 | démo vaisseau, e2e, doc crew | à faire |
| X6 | cockpits Ranger (a), Lander (b), Endurance (c) | à faire |
| X7 | sons, effets, caméras | à faire |
| X8 | télémétrie, graphiques, comptes rendus | à faire |
| X9 | école de vol spatial (15 leçons) | à faire |
| X10 | défis et qualifications | à faire |
| X11 | missions, éditeur, campagne Interstellar | à faire |
| N | réseau : équipage, baux, flotte, partage, interactions, temps | à faire (une part dans chaque phase) |
| Z | finition, docs, campagne | à faire |

## Risques
- **Le volume.** Vingt phases : on garde une phase = un commit poussé, mesuré ; le tableau ci-dessus fait foi.
- **Les cockpits Lander et Endurance** : pas de modèle intérieur fourni ; construction Blender (longue) ou modèle
  CC-BY à proposer (nom, source, taille, licence) avant tout téléchargement ; budget GPU mesuré.
- **Le bundle crew** (≤ 256 Ko, sans image ni WGSL externe, 197 Ko le 2026-10-18) : la carte 3D et `solar.ts`
  peuvent le dépasser — repli : positions calculées par le simulateur et envoyées (K1), shader inline.
- **Le débit réseau** : trajectoires et nœuds sont lourds — échantillonnage adaptatif, 1 Hz, 16 Ko tenus.
- **La généralisation de l'école et des missions** touche du code F-35 éprouvé : les e2e F-35 (école, démos,
  missions, crew A1–A6) tournent à chaque phase du bloc 4.
- **Les pannes** peuvent rendre le jeu frustrant : désactivées par défaut en débutant, « rares » en réaliste,
  toujours une procédure pour s'en sortir.
- **Le temps à plusieurs** (warp, dilatation, délai) : décisions écrites dans `NETWORK.md`, testées à deux.
