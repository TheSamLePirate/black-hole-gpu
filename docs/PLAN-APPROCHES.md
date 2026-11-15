# Plan — les approches et les pistes, AAA (pilote, crew, roue)

**État (2026-11-15) : AP0a, AP1, AP2, AP0b, AP3 (a, b, c), AP4, AP5, AP6, AP7 (a, b) et AP8 faits.** AP8 : le secteur « Approche »
de la roue, le même pour le F-35 et l'A320 (`ui/approach-wheel.ts` : Auto et sa raison, terrain, piste, approche, entrée — guidage,
transition, attente —, armer/désarmer, remise de gaz, autorisé, affichages) ; les options du Labo, Jeu › Approches
(`approachAutoTailwindKt`, `approachShowBuilt`, `approachPathOnMap`, `approachProfile` — le PROF de la carte en est un réglage) ;
`ilsGoAround()` — la remise de gaz du crew et de TARS n'atteignait que l'autopilote d'entrée des vaisseaux ; `approachPreview`,
`approachFields`. **AP9 fait** : l'autorisation avec les vraies valeurs (approche, piste, altitude de la jonction — montez/maintenez/descendez,
rien si établi —, QNH du METAR) ; l'indicatif du localizer en morse une fois reçu, les radiobalises de nav.dat (O, M, I) survolées
(`game/approach-audio.ts`, `SoundEngine.morse/marker`, `camera.approachAudio()`, réglages `ilsIdentAudio`, `markerAudio`) ; l'outil
`approach` de TARS : `preview` (le choix dit avant d'armer) et `goaround` ; e2e `approach-audio` 4/4 (Sofia 09 : l'ident « ISL », O/M/I au
spectre, témoin négatif à 1 dB). AP7a : toutes les pistes de l'aéroport
au HUD (`hudAllRunways`, activé par défaut — décision de Sam, Q2 ; réglage au Labo, la roue à AP8), la désignation publiée dans la
boîte de piste (« 27R »). AP7b : le directeur de vol — `flightDirector()` commun (pente et inclinaison demandées, leurs écarts) ; au
HUD du F-35 le repère de guidage sur l'approche, en automatique comme à la main ; l'A320 : ses barres FD (FMGC) et l'approche qui ne
réengage plus l'AP1 coupé par le pilote ; le crew : barres FD au PFD ; la pente publiée de chaque approche (Marseille 31R à 4°)
lue par les aiguilles, le guidage et le contrôle du relief (fin du « 3° partout ») ; un échec de chargement des index de pistes et
d'approches n'est plus gardé pour la session. Suite : AP10 (tous les aéroports), AP-R (retraits). AP6a : le crew — actions `app.*` (tous les
postes), boîte APP (approches réelles et construites, transition, Choisir/Auto/Armer/Remise de gaz, état choisi/volé), l'état de
l'approche et celle de l'A320 dans la télémétrie, le DME corrigé. AP6b : les terrains et l'approche au radar et au ND
du crew (touchés, ils la choisissent), la vue « Approche » (plan, repères, profil), les appels de l'approche dits à l'équipage. Non
fait : la fiche de terrain complète au clic sur la carte et le globe du crew (le clic choisit, sans fiche). AP5 : sur le radar du HUD et la TSD du F-35,
les terrains et les parties de l'approche cliquables (son choix), l'approche dessinée (le module partagé), l'en-tête de la TSD sur
l'approche choisie ; les pistes gardent la priorité au clic et au TDC ; coût non mesurable à cette résolution (A/B indicatif). AP4 : la carte tactique — la fiche de terrain
(choix auto et raison, extrémités, vent, approches, Armer, Auto, Guidage/Par sa transition), l'approche dessinée (cône, repères et
altitudes, jonction, remise de gaz, attente ; les autres en discret, cliquables), le profil vertical (PROF) ; le dessin partagé
`world/approach-draw.ts` pour le radar et le crew (AP5, AP6). AP3b : la page ARRIVAL du MCDU (approches réelles et
construites, VIA publiées, INSERT) sur l'état « approche choisie » (`via` ajouté), RAD NAV sur le localizer réel, l'arrivée publiée
mise dans le plan et volée en NAV jusqu'à l'IF où l'approche s'enclenche ; TARS `select` avec `via`. AP3c : le ND de l'A320 dessine l'approche (sa piste, son axe sur 10 NM, sa remise de gaz en cyan) et le localizer réel en ROSE LS. Reste du lot AP3 au plan : la télémétrie de l'A320 (avec AP6, son DME). AP3a : l'A320 vole la même jonction (FCU en HDG et altitude, APPR
sur la dernière branche) ; le planificateur ajoute des milles quand l'avion est trop haut, tient ses paliers jusqu'à l'obstacle passé,
et une approche construite que le relief rend impossible est écartée.  AP0b : le CIFP de la FAA (cycle 2611, domaine public) lu par
`scripts/cifp.ts` — 9 568 approches publiées des États-Unis sur nos pistes (ILS, LOC, LDA, RNAV, VOR, NDB ; leurs transitions,
finales, remises de gaz, contraintes), préférées à nav.dat à leur extrémité ; tuiles 6,4 Mo ; relais des notes d'erreur de la
FAA à faire à la main (ses pages refusent la lecture automatique). AP2 : la jonction planifiée (`game/approach-plan.ts`) — dans l'axe depuis
l'arrière de la finale, sinon vent arrière à 6 km du côté de l'avion puis base vers la finale à 16 km ; chaque branche à 300 m sur le
relief, des paliers jusqu'à la capture de la pente ; replanifiée après une remise de gaz ; une approche construite dont la pente rase le
relief écartée du choix (« relief »). Reste d'AP2 : les antennes réelles du LOC/GS (le LOC est encore placé au-delà du seuil opposé) —
reporté à AP3 avec le RAD NAV. Vu à l'e2e, pour AP7 : la boîte « RWY » du HUD lit le site du jeu le plus proche (« RWY 23 · Nice »
pendant une 22R), pas l'approche choisie. AP0a : nav.dat lié à nos pistes, `world/approaches.ts`, une approche à chaque extrémité.
AP1 : l'état « approche choisie » (`controller/approach.ts`, sauvé avec le vol), `approachSelect` vérifié, le choix automatique
(`game/approach-choice.ts` : le vent, l'aide, une piste trop juste, le sens d'arrivée ; le terrain devant), l'ILS du F-35 et le FMGC de
l'A320 qui le lisent, le plan de vol qui garde sa piste, TARS (`list`, `select`, `auto`, `state`) et `__bh`. **AP0b** (le CIFP de la
FAA, cycle 2611 téléchargé dans `assets/approaches/raw/`) remis après AP2. Plan mené par la session de l'audit (1feb2f7f).

**Objectif (Sam, 15 nov. 2026)** : sélectionner un aéroport sur la carte tactique et sur le radar ; avoir **les approches de
chaque aéroport, d'après les vraies données** ; choisir graphiquement la piste et l'approche, pour l'AP d'approche ILS
comme pour l'assistance en manuel ; le tout **aussi depuis la console crew** ; au HUD de piste, **toutes les pistes à l'écran
visibles** (bascule) ; **tous les aéroports fonctionnent** (approche, piste) ; l'AP ILS et son assistance **prennent toujours
la bonne approche, choisie ou automatique**. AAA : les outils crew, les UI des pistes, les options et la roue.

**Contraintes.** Rien de payant. Coût nul mesurable sur l'image du pilote (A/B ±1 %, comme PLAN-RADAR-AAA et PLAN-PCD-AAA).
Les mêmes actions métier pour la roue, le clavier, la carte, le crew et TARS (CLAUDE.md, « préserver toute l'expérience »).
Terre WGS84 partout (CLAUDE.md) : seuils et fixes géodésiques, altitudes publiées MSL converties au bord (`h − N`).
Les e2e suivent [E2E-VOLS](E2E-VOLS.md) (vols, tuiles, temps) : placements dans le bon ordre, attentes bornées et dites.

## 0. Décisions de Sam (15 nov. 2026)

| Question | Réponse |
|---|---|
| Sources | **« Faisons comme FlightGear »**, rien de payant : les ILS réels du monde (nav.dat GPL de FlightGear), les procédures publiées gratuites là où elles existent (FAA CIFP), une approche construite ailleurs, marquée comme telle (§3) |
| « Tous les aéroports » | **Toutes les pistes** : chaque extrémité de chaque piste a au moins une approche (construite à défaut de réelle) ; l'AP ne refuse que ce que l'appareil ne peut pas faire (longueur, surface, relief), en le disant. Hélistations et hydrobases hors du plan |
| Assistance en manuel | **Directeur de vol + AP** : en manuel, aiguilles LOC/GS **et directeur de vol** sur l'approche choisie ; l'AP d'approche (F7 du F-35, APPR de l'A320) vole la même. F-35 et A320 (et tout avion à venir) ; les vaisseaux (MLS du Ranger) hors du plan |
| HUD : toutes les pistes | **Réglage du Labo + entrée de la roue + une touche** ; la piste choisie mise en avant, les autres en contour discret avec leur nom |
| Visuel | **Les approches tracées sur la carte et le radar** (pilote et crew) |
| Droits du crew (15 nov., second tour) | **Tous les postes du crew** peuvent choisir, armer, annuler une approche et commander la remise de gaz |
| Données FAA (15 nov., second tour) | Domaine public, redistribuables ; leurs deux conditions tenues (§3) — la question 1 du §9 levée |

## 1. La sortie, en faits vérifiables

1. **Le bon choix automatique** : enclenché à 20–60 km d'un terrain, depuis les quatre quadrants, par beau temps et par vent,
   l'AP prend l'extrémité et l'approche que choisirait un contrôleur (§4.3) — e2e et test pur sur un tableau de cas.
2. **Une rejointe fiable** : depuis ces mêmes départs, établi LOC + GS **avant le FAF** sans demi-tour à l'IAF ni survol du
   terrain, sans remise de gaz due à l'énergie, au-dessus du relief sur tout le chemin — e2e F-35 et A320 (§6, AP2/AP3).
3. **Les vraies données** : chaque ILS de nav.dat rattaché à sa piste (y compris les pistes renumérotées) avec son axe, sa
   pente, sa fréquence, son indicatif ; les approches de la FAA aux États-Unis volées par leurs segments ; ailleurs l'approche
   construite, son origine dite partout où elle s'affiche.
4. **Tous les aéroports** : une campagne pure (sans navigateur) sur les 34 030 pistes : chaque extrémité a une approche, le
   planificateur rend un chemin valide ou un refus motivé ; un échantillon stratifié volé en e2e (§6, AP10).
5. **Partout la même chose** : carte tactique, radar du HUD, TSD du F-35, ND et MCDU de l'A320, carte/ND/radar/PFD du crew,
   la roue, TARS, `__bh` montrent et modifient **le même état** « approche choisie ».
6. **Coût nul** sur l'image (A/B ±1 % sur J0 et une approche, M1 Max borné et kerr-mini).

## 2. L'existant (relu le 15 nov. 2026, lecture seule)

### 2.1 Données

- `assets/runways/v1` (OurAirports, domaine public, `scripts/build-runways.ts`) : 1 008 tuiles de 5°, 72 621 terrains,
  34 030 pistes ; **aucun ILS, fréquence, seuil décalé ni procédure**. 58 % des pistes `approx` (seuils reconstruits faute de
  données) — 668 sur 7 055 aux grands et moyens aéroports. API : `fieldsNear` (synchrone, tuiles chargées), `fieldByCode`
  (asynchrone, monde), `fieldCached` (tuiles chargées) — `src/world/runways.ts`.
- `game/procedures.ts` : des cartes façon Shuttle pour les 7 `SITES` seulement (`src/game/sites.ts:35-142`).
- A320 : aucune base de navigation. MCDU RAD NAV **invente une fréquence en hachant l'indicatif** (`a320/mcdu/pages-misc.ts:30-43`),
  que `controller/a320ap.ts` ne lit pas ; aucune page ARR (approches, VIA).

### 2.2 L'ILS et son AP — pourquoi il prend la mauvaise approche de loin

Analyse présentée à Sam le 15 nov. (T3, « AP ILS : pourquoi la mauvaise approche »).

| Étape | Code | Défaut |
|---|---|---|
| Terrain | `findRunway` (`controller/ils.ts:151`) : le plus proche dans 150 km, parmi les `SITES` et les terrains **dont la tuile est chargée** avec une piste revêtue ≥ 1 800 m ; un nom hors tuile chargée échoue (`fieldCached`) | Le F-35 ignore la destination du plan (l'A320 la prend : `tune`, `a320ap.ts:44`) |
| Piste | `worldSite` (`world/fieldsite.ts:38`) : la **plus longue** | Aéroports multipistes : souvent pas celle voulue |
| Extrémité | `landingEnd` (`game/sites.ts:369`) : par beau temps (`weather: "fair"`, le défaut) **toujours la première extrémité** ; au vent, l'autre seulement par vent arrière > 0,5 m/s | **Cause principale** : le sens d'arrivée jamais pris en compte |
| Rejointe | `toIaf` (`game/ils.ts:255`) : un direct vers un IAF fixe à 18,5 km sur l'axe, à ~985 m sur le seuil | Survol du terrain et demi-tour à l'IAF si l'on vient de l'autre côté ; relief **non vérifié** sur ce trajet (`glideClearance` ne voit que la finale) |
| Interception | phase `intercept` à 2,5 km de l'IAF **quel que soit le cap** (`game/ils.ts:275`), 45° au plus | À contre-cap, axe recoupé en virage ; FAF + 1,5 km dépassé sans glide → remise de gaz (`:329`) |
| Descente | aucun point de début de descente ni décélération planifiée ; glide capté par-dessous dans −2°…+5° | Enclenché haut, il arrive haut → remise de gaz |
| Plan de vol | à l'IAF du plan, `ilsStart(terrain)` re-choisit l'extrémité au vent du moment (`controller/fplan.ts:192`) | Vent tourné : l'avion à l'IAF de l'autre piste |

L'A320 rejoint mieux (`a320ap.ts:212-214`, entrée à 22 km décalée de 6 km, interception sur un point à 13 km, altitude de
segment au-dessus du relief) mais hérite des trois premières étapes. Le F-35 en manuel n'a que les aiguilles
(`ilsJet`, `controller/ils.ts:298`).

### 2.3 Sélection et affichage

- **Carte tactique** (`ui/jetmap.ts:178-227`) : un clic sur un terrain ouvre une fiche (pistes, `≈` des approx), boutons
  « Direct » et « Ajouter au plan » ; **ni piste ni approche à choisir**.
- **Radar du HUD** : terrains dessinés (`ui/hud/symbology.ts:2879`), **pas cliquables** (`hudHits` ne couvre que les pistes
  radar, `:386`, `:2942`). TSD du F-35 : terrains dessinés, ILS au plus proche (`f35/pcd.ts:1860`).
- **Roue** (`main.ts:5026-5050`) : « Approche ILS » et, s'il y a plus de deux extrémités, Automatique / Piste NN.
- **État** : aucun « terrain / piste / approche choisis ». Le dernier point du plan porte `field: {icao, elev, rwy?}`
  (`game/flightplan.ts:28`). Une approche en cours n'est pas sauvée (`controller/craftsave.ts:8-9`).
- **TARS** : outil `approach` (`ai/game-tools.ts:2109-2146`) — `ils|clear|off|status|runways|procedures`, `field`, `runway`, `hold`.
- **HUD de piste** : **une seule** piste (`runwayView`, `controller/lowthrust.ts:2706-2870` ; `drawRunway`, `symbology.ts:1428`),
  bascule `settings.hudRunway` (`settings.ts:557`), pas de touche, pas de mode « toutes ».

### 2.4 Crew

- Actions (`net/crewcmd.ts:190-310` → `ui/crew-exec.ts` → les outils de TARS) : `nav.*`, `ap.*`, `ap.ils {field}` **sans
  piste**, `ap.ilsOff`. Boîte « APP » du MCP : un champ OACI libre + ILS / Annuler (`crew/main.ts:1082-1094`). Clic droit
  carte : un point lat/lon seulement (`:2038-2079`).
- Terrains dessinés sur la carte/globe (`crew/draw/geo.ts:205-221`) et le ND (`crew/draw/nd.ts:80-87`), **pas sur le radar
  crew** (`crew/draw/radar.ts`).
- Télémétrie ILS `{id, loc, gs, dme, phase}` (`net/instruments.ts:165`) remplie seulement par `ilsRun`
  (`controller/telemetry.ts:546`) : **l'approche de l'A320 n'est pas envoyée** ; aucune liste de pistes. Défaut probable :
  `dme` déjà en km (`game/ils.ts:90`) redivisé par 1 000 au PFD crew (`crew/draw/pfd.ts:209`).

## 3. Les données réelles (gratuites)

FlightGear (cloné en lecture à côté du dépôt : `../flightgear`, et `../fgdata/Navaids` en extraction partielle) :
ses ILS viennent de `nav.dat` ; ses procédures complètes de fichiers Level-D (Navigraph, **payants**, fournis par l'utilisateur,
non livrés) ; à défaut, une approche par défaut (`createDefaultApproach`, `src/Autopilot/route_mgr.cxx:1144`) : un point à
12 NM à seuil + 4 000 ft, un à 8 NM à seuil + 2 000 ft, l'interception du glide à 3°, des segments de 45° depuis la route.

| Niveau | Source | Contenu | Couverture | Licence |
|---|---|---|---|---|
| **1 — publiée, à jour** | **FAA CIFP** (ARINC 424, cycle de 28 jours, [téléchargement](https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/cifp/download/)) | Approches complètes ILS/LOC/LDA/RNAV/VOR/NDB : transitions, IAF/IF/FAF/MAP, contraintes d'altitude et de vitesse, remises de gaz, attentes ; ILS (enregistrements PI), pistes (PG), points (PC/EA), balises | États-Unis (+ SID/STAR du Canada et d'Amérique latine) | **Domaine public** ([FAQ de la FAA](https://www.faa.gov/air_traffic/flight_info/aeronav/faq) : « all digital products published by the FAA are in the public domain »), redistribution permise ; l'accord du CIFP ajoute deux conditions : **ne pas servir à la navigation réelle** (un jeu : mention dans la fiche et ASSETS) et **relayer les erreurs signalées par la FAA** (données reconstruites à chaque cycle, notes d'erreur du cycle reprises dans ASSETS) |
| **2 — ILS réels mondiaux** | **nav.dat de FlightGear** (Robin Peel, cycle 2013.10, `fgdata/Navaids/nav.dat.gz`) | LOC (types 4/5) : position de l'antenne, **axe vrai**, fréquence, portée, indicatif, catégorie ; GS (6) : position, élévation, **pente réelle** (codée `pente×100000 + axe` : LFML 31R `400314.020` = 4,00°) ; balises OM/MM/IM (7–9) ; DME (12/13) | 3 501 localizers (2 781 CAT I, 210 CAT II, 201 CAT III, LDA/IGS), 3 197 glides | **GPL v2 ou ultérieure** (en-tête du fichier ; comme l'A320 déjà intégré) : en-tête de copyright conservé, crédit dans CREDITS.md et ASSETS.md |
| **3 — construite** | Notre code, à la manière de FlightGear | Axe de la piste, IF/FAF, glide de 3° (ou la pente de la piste si un ILS est connu), rejointe ; marquée « construite » | Toutes les autres extrémités (34 030 pistes) | — |

**Croisement nav.dat ↔ nos pistes** (analyse en lecture seule, 15 nov.) : sur 3 501 localizers, **2 845 retrouvés tels quels
(81 %)** — dont 12 sur des pistes `approx` —, **582 sur des pistes renumérotées depuis 2013** (dérive magnétique : BIKF 02/20
devenue 01/19…), **74 sur des terrains fermés** ou absents (EDDT Tegel…). Écart d'axe LOC/piste : médiane 0,12°, 90ᵉ centile
1,1°, 310 au-delà de 1° (axes décalés réels — LDA, offset — ou données périmées) ; antenne à moins de 4,6 m de l'axe en médiane,
255 à plus de 60 m.

**Rapprochement** (lot AP0) : par code et désignation, sinon **par géométrie** (antenne LOC dans le prolongement d'une piste du
terrain à ±3° et à moins de 1,5 km de son extrémité opposée) ; un LOC décalé de plus de 3° gardé comme LDA/offset s'il est
nommé ainsi, sinon écarté et compté ; un terrain fermé écarté. Chaque approche porte sa **source et son cycle** (« ILS · nav.dat
2013 », « FAA CIFP 2611 », « construite »), affichés dans les fiches et au MCDU.

**Ce qu'aucune source libre ne donne hors des États-Unis** : les procédures complètes (IAF/IF publiés, altitudes, remises de
gaz, attentes). Hors États-Unis, une approche ILS « niveau 2 » est donc l'ILS réel (axe, pente, fréquence, catégorie,
balises) **plus des segments construits**. Les minima publiés ne figurent dans aucune de ces sources : la hauteur de décision
suit la catégorie (CAT I 200 ft, CAT II 100 ft, CAT III 50 ft ; construite 250 ft), dite comme telle.

**Format** : `assets/approaches/v1/` en tuiles de 5° alignées sur celles des pistes (`t<la>_<lo>.json`, même LRU, même
service `runways/`-like), construites par `scripts/build-approaches.ts` depuis les fichiers bruts ignorés par git
(`assets/approaches/raw/`). Taille à mesurer à AP0 (ordre attendu : quelques centaines de Ko pour nav.dat, quelques Mo pour le
CIFP) ; JSON textuel, hors du budget des binaires mais dans la limite de 1 Go de Pages. Mise à jour : relancer le script à un
nouveau cycle FAA ; nav.dat reste au cycle 2013 tant qu'aucune source libre plus récente n'est trouvée (à rechercher à AP0 :
autres données GPL ou en licence ouverte — SIA France en licence ouverte, par exemple).

## 4. Architecture

Une responsabilité par module ; le même modèle pur pour le jeu et la console crew (comme `world/runways.ts`).

### 4.1 `world/approaches.ts` (pur, partagé jeu + crew)

```ts
type ApproachKind = "ILS" | "LOC" | "LDA" | "RNAV" | "VOR" | "NDB" | "VIS"; // VIS : construite sans aide
interface Approach {
  id: string;            // « I31R », « R27-Y », « C05 » (construite)
  field: string;         // code OACI/ident
  rwy: string;           // extrémité (« 31R »)
  kind: ApproachKind;
  source: "cifp" | "navdat" | "built";
  cycle?: string;        // « 2611 », « 2013.10 »
  loc?: { lat; lon; crs /* vrai */; freq; ident; cat; range };
  gs?:  { lat; lon; elev; angle; tch?: number };
  dh: number;            // hauteur de décision [m] et d'où elle vient
  transitions: Leg[][];  // IAF → IF (« vecteurs » toujours possible)
  final: Leg[];          // IF → FAF → seuil/MAP
  missed: Leg[];         // remise de gaz (construite : droit devant puis retour à l'IF)
  hold?: Hold;           // attente publiée, sinon celle de l'IAF
  msa?: number;          // altitude minimale de secteur (calculée sur le relief si non publiée)
}
type Leg = { t: "IF"|"TF"|"CF"|"DF"|"RF"|"HM"|"CA"|"VA"; fix?; lat?; lon?; crs?; alt?: [min?, max?]; spd?; arc? };
```

Un sous-ensemble des types de segments ARINC 424 suffit (les plus fréquents aux approches FAA) ; les autres sont convertis
en TF approchés et comptés à AP0.

### 4.2 L'état « approche choisie » — propriété de la simulation

`ApproachSel = { field, rwy | "auto", approach | "auto", entry: "auto" | "straight" | "vectors" | "iaf" | transition, hold?: n }`,
**propriété de la simulation** (pas des réglages ni de l'UI : CLAUDE.md, « la simulation possède l'état accepté »), avec une
**génération** incrémentée à chaque changement. Lu par : l'AP du F-35, le FMGC de l'A320, le directeur de vol, le HUD, la
carte, le radar, la TSD, le ND, le crew (télémétrie), TARS, `__bh`. Modifié par une seule action métier
`approachSelect(sel, by)` validée (terrain connu, extrémité existante, approche applicable à l'appareil) — appelée par la
roue, la carte, le radar, le MCDU, le crew, TARS et le plan de vol. **Sauvé** avec le vol (`game/save.ts`) ; une approche en
cours reprend à la phase « rejointe » après un chargement.

### 4.3 Le choix automatique

Terrain : celui sélectionné (carte, radar, crew), sinon la destination du plan, sinon le plus proche **dans la direction du
vol** (secteur ±60° devant, sinon le plus proche), charge des tuiles par `fieldByCode`/préchargement autour de la position
(plus de dépendance aux tuiles déjà en mémoire). Extrémité et approche, par un score dit en clair :

1. **Vent** : vent arrière > 10 kt ou travers au-delà de la limite de l'appareil → exclue ; sinon face au vent préférée.
2. **Aide réelle** : ILS (catégorie la plus haute) > LOC/LDA > RNAV > construite.
3. **Sens d'arrivée** : l'écart entre la route et l'axe d'approche, la distance de chemin (§4.4) — à vent égal, l'extrémité
   « dans l'axe » gagne.
4. **Appareil** : longueur et surface requises (A320 : revêtue ; F-35 : selon la masse), relief sous la pente.

Le résultat et sa raison s'affichent (« Auto : LFML ILS 31R — vent 300/12, ILS CAT I ») sur la fiche, la roue, le MCDU, le crew,
et se disent à la radio. Le plan de vol **fige** l'approche qu'il contient : passé l'IAF, c'est elle qui est volée
(correction de `fplan.ts:192`).

### 4.4 Le planificateur d'approche (`game/approach-plan.ts`, pur)

Entrée : position, route, vitesse, altitude, l'approche choisie, le relief (`groundRelief` − géoïde). Sortie : un **chemin**
(segments avec contraintes d'altitude et de vitesse) + un **profil vertical** + des points nommés pour l'affichage.

- **Entrée selon le secteur** : *directe* (route à ±30° de l'axe final, en dehors de l'IF) ; *guidage radar* (vent arrière puis
  base, interception à 30° avant l'IF, comme un contrôleur — généralise l'entrée de l'A320) ; *par l'IAF* et sa transition
  publiée (CIFP), avec l'attente publiée et son entrée (directe, parallèle, en goutte d'eau) ; *virage conventionnel* si l'on
  arrive dans l'axe opposé et qu'aucun guidage n'est voulu.
- **Profil** : point de début de descente (pente ≤ 3,5° ou 1 000 ft par 3 NM), décélérations planifiées (vitesse
  d'approche initiale, puis vitesse finale au FAF), aérofreins proposés si trop haut ; altitudes publiées respectées (CIFP) ;
  **jamais sous l'altitude de sécurité** du segment (relief + 300 m sur ±5 km, MSA calculée sinon).
- **Validation** : chemin au-dessus du relief sur **toute** sa longueur ; pente refusée si elle percute (comme
  `glideClearance`) ; extrémité trop courte refusée — chaque refus dit pourquoi et propose l'autre extrémité.
- **Replanification** : à chaque changement de sélection, de vent ou d'écart au chemin > seuil ; le chemin publié avec sa
  génération.

### 4.5 Le vol : un suiveur de segments pour chaque appareil

- **F-35** : `ilsStep` devient un suiveur du chemin (latéral par segments, vertical par le profil) jusqu'à l'interception du
  LOC ; la finale, l'arrondi, la remise de gaz et la note restent ceux d'aujourd'hui (`game/ils.ts:337-381`), le LOC et le GS
  **lus sur les vraies antennes** (axe, pente, position du GPI) quand l'approche en a.
- **A320** : le FMGC suit le chemin en NAV (consignes de cap issues des segments, comme `a320AppStep` le fait déjà en HDG),
  APPR armé à l'IF, LOC/G/S existants (`a320/fmgc/fmgc.ts:432-470`) ; RAD NAV et ND sur la fréquence et l'axe réels.
- **Directeur de vol** : les mêmes consignes (cap et pente) exposées en continu ; F-35 : repère de guidage au HUD (cercle
  à aligner sur le vecteur vitesse) ; A320 : barres FD du PFD (les siennes, branchées sur le même chemin) ; crew : barres
  au PFD crew.

## 5. Les écrans et les outils

### 5.1 Carte tactique (pilote) — `ui/jetmap.ts`

- **Fiche de terrain enrichie** : pistes (longueur, surface, éclairage, `≈`), **chaque extrémité avec ses approches** (« ILS
  31R · 110.75 · 4,0° · CAT I · nav.dat 2013 », « construite »), vent sur chaque extrémité (face/travers), la ligne « Auto » et
  sa raison. Boutons : **Choisir l'approche** (sélection), **Armer** (AP), **Direct**, **Ajouter au plan** (avec l'approche),
  **Vecteurs / Par l'IAF**.
- **Sélection graphique** : un clic sur une extrémité de piste dessinée la choisit ; un clic sur une approche tracée la choisit.
- **Tracé** : le cône du LOC (« plume »), les fixes (IAF/IF/FAF/MAP) avec leurs altitudes, le chemin prévu depuis l'appareil
  (trait plein), la remise de gaz (tirets), l'attente ; toutes les approches du terrain choisi en discret, la choisie en
  surbrillance ; la vue s'ajuste sur le chemin. Option : **profil vertical** sous la carte (le chemin, le relief, l'appareil).

### 5.2 Radars et instruments (pilote)

- **Radar du HUD** : terrains **cliquables** (étendre `hudHits` aux terrains), même fiche compacte ; l'approche choisie
  tracée (axe, FAF, chemin).
- **TSD du F-35** (`f35/pcd.ts`) : terrains cliquables, approche tracée, page ILS sur l'approche choisie (fin du « plus proche »).
- **A320** : MCDU **ARR** (liste des approches de la destination, VIA = transitions, « Auto » en tête), **RAD NAV** sur les
  vraies fréquences/axes (fin du hachage), **ND** ROSE ILS / ARC / PLAN avec l'approche, les fixes et leurs contraintes ;
  PFD : indicatif et fréquence de l'ILS, FD.

### 5.3 Console crew (outils complets)

- **Actions** (mêmes actions métier, validées ; **tous les postes**, décision de Sam du 15 nov.) : `app.select {field, rwy, approach, entry}`, `app.auto`,
  `app.arm`, `app.clear`, `app.goAround`, `app.hold {laps}` ; `ap.ils` étendu de `rwy`/`approach` (compatibilité gardée).
- **Fiche de terrain** partagée avec le pilote (même module de rendu des fiches) : clic (et clic droit) sur un terrain de la
  carte, du globe, du ND **et du radar crew** (qui dessinera les terrains).
- **Vue « Approche »** du crew : carte de l'approche choisie générée (vue en plan + profil vertical, fixes, altitudes,
  fréquences, MSA, remise de gaz), à la manière d'une carte d'approche — produite par nous, pas une reproduction de carte
  publiée ; l'appareil en direct dessus.
- **Boîte APP du MCP** : terrain (avec recherche et « destination »), piste, approche, entrée, Armer/Annuler/Remise de gaz,
  « Auto » et sa raison.
- **Télémétrie** : l'état choisi (avec génération), la phase, le prochain fixe, sa distance et sa contrainte, les écarts LOC/GS
  **aussi pour l'A320** ; correction du DME (§2.4). Taille ≤ 16 Ko par événement (`server/rooms.ts`).
- **Callouts** à l'équipage (capture LOC/GS, minimums) dans le fil du crew.

### 5.4 La roue (F-35 et A320)

Un secteur **« Approche »** remplaçant l'entrée « Approche ILS » actuelle :

- **Auto** — l'étiquette dit le choix (« Auto — LFML ILS 31R »), l'astuce sa raison ;
- **Terrain ▸** destination du plan · sélectionné sur la carte · les 5 plus proches devant ;
- **Piste ▸** chaque extrémité (longueur, vent, « en service ») ;
- **Approche ▸** ILS / LOC / RNAV / construite de l'extrémité choisie, avec la source ;
- **Entrée ▸** auto · directe · vecteurs · par l'IAF · attente (n tours / jusqu'à autorisation) ;
- **Armer / Désarmer**, **Remise de gaz**, **Autorisé** (sortie d'attente) ;
- **Affichages ▸** toutes les pistes au HUD · tracé de l'approche sur la carte · directeur de vol.

Les entrées d'une approche en cours restent accessibles (changer d'extrémité en vol replanifie). Toutes appellent
`approachSelect` / les actions du §4.2.

### 5.5 HUD de piste — toutes les pistes

- **Toutes les pistes à l'écran** (bascule) : contours discrets et nom (« 13L ») de chaque piste dans le champ, jusqu'à une
  portée bornée (≈ 25 km, comme `runways3d`), la **piste choisie mise en avant** (contour plein, axe, point d'aboutissement,
  PAPI comme aujourd'hui) ; désencombrement par `ui/hud/declutter.ts`.
- **Repères d'approche** : les fixes à venir (losange + altitude), le repère du directeur de vol.
- Réglage `hudRunwaysAll` (Labo, défaut à décider en AP7 après capture), entrée de la roue, **une touche** choisie parmi les
  libres de `input/bindings.ts` (pas une touche de vol AZERTY ni ⇧M/V/C/Y) — à proposer à Sam avec AP7.

### 5.6 Options du Labo (`settings.ts`, `ui/schema.ts`)

`hudRunwaysAll`, `approachPathOnMap`, `approachProfile` (profil vertical), `flightDirector`, `approachAutoTailwindKt` (10),
`approachShowBuilt` (montrer les approches construites), `ilsIdentAudio` (morse de l'indicatif), `markerAudio` (balises
OM/MM/IM). Chaque réglage avec son libellé FR/EN, sa ligne au schéma et la garde statique des réglages (AR-21).

### 5.7 TARS, radio, audio, `__bh`

- Outil `approach` étendu : `list` (approches d'un terrain avec sources), `select` (« ILS 31R », « RNAV 27 via MTL »), `auto`
  (avec la raison), `entry`, `arm`, `goaround` ; ses réponses citent la source.
- Phraséologie avec les vraies valeurs (« autorisé ILS 31R, établissez le localizer, descendez 3 000 ft, QNH ») ; morse de
  l'indicatif et balises (réglables).
- `__bh.sys.approaches(field)`, `__bh.camera.approachSelect/approachState/approachPlan` — documentés dans [BH-API](BH-API.md).

## 6. Les lots

Ordre par impact sur la fiabilité d'abord (ce que Sam constate), puis les données, puis l'UI. Chaque lot : son e2e, ses
captures montrées dans T3, ses docs, une entrée au journal.

| Lot | Contenu | Fait quand |
|---|---|---|
| **AP0 — données** (AP0a fait le 15 nov. : nav.dat ; AP0b fait le 15 nov. : le CIFP) | Accepter l'accord de téléchargement du CIFP (domaine public, §3) ; chercher une source libre plus récente que nav.dat 2013 ; `scripts/build-approaches.ts` (nav.dat : LOC/GS/DME/balises ; CIFP : PF/PI/PG/PC/EA/D) ; rapprochement géométrique (§3) ; tuiles `assets/approaches/v1` ; rapport de couverture (rattachés, renumérotés, écartés, segments non convertis) ; CREDITS/ASSETS ; `world/approaches.ts` + tests purs (LFML, LFPG, KSFO, BIKF renumérotée, EDDT écarté, une LDA) | Rapport chiffré ; tests verts ; taille mesurée |
| **AP1 — choix et état** (fait le 15 nov.) | `ApproachSel` dans la simulation, `approachSelect`, choix auto (§4.3) avec sa raison, approche construite pour toute extrémité, sauvegarde, TARS et `__bh` ; F-35 et A320 lisent la sélection ; le plan de vol fige son approche | Test pur des cas (4 quadrants × vent nul/fort × 1/2/3 pistes) ; e2e `approach-auto` : enclenché de 4 côtés de Toulon-Hyères, l'extrémité attendue est prise |
| **AP2 — planificateur + F-35** (fait le 15 nov.) | `game/approach-plan.ts` (entrées, profil, relief, replanification) ; `ilsStep` en suiveur de segments ; LOC/GS sur les antennes réelles | e2e `approach-join` F-35 : 4 départs à 30–50 km, haut et bas, établi avant le FAF, pas de demi-tour à l'IAF, au-dessus du relief (Nice ou Chambéry pour le relief), note ≥ actuelle |
| **AP3 — A320** (fait le 15 nov., sauf la télémétrie) | FMGC en NAV sur le chemin, APPR à l'IF ; MCDU ARR/VIA ; RAD NAV réel ; ND avec l'approche ; télémétrie A320 | e2e `a320-approach-join` mêmes départs ; `a320-mcdu` étendu |
| **AP4 — carte tactique** (fait le 15 nov.) | Fiche enrichie, sélection graphique (extrémité, approche), tracé (plume, fixes, chemin, remise de gaz, attente), profil vertical | e2e `jetmap-approach` : clic LFML → 31R ILS → armer → tracé et AP sur la bonne ; captures |
| **AP5 — radar, TSD, ND** (fait le 15 nov.) | Terrains cliquables au radar du HUD et à la TSD ; approche tracée ; page ILS de la TSD | e2e `radar-approach` : sélection par le radar ; A/B de coût ±1 % |
| **AP6 — crew** (fait le 15 nov., sauf la fiche au clic de la carte et du globe) | Actions `app.*` ; fiche partagée ; terrains au radar crew ; vue « Approche » ; boîte APP ; télémétrie et DME ; callouts | e2e `crew-approach` : le crew choisit et arme, le pilote voit la même sélection et l'AP la vole ; `crew-actions` étendu |
| **AP7 — HUD et directeur de vol** | Toutes les pistes (bascule, réglage, touche proposée), repères d'approche, FD F-35/A320/crew | e2e `hud-runways-all` (captures LFPG multipistes, avec/sans) ; e2e FD : en manuel scripté sur les barres, établi ; A/B ±1 % |
| **AP8 — roue et options** | Secteur « Approche » (§5.4), options du Labo (§5.6), touche | e2e par entrée réelle (CDP) de la roue ; `settings` vert |
| **AP9 — radio et audio** | Phraséologie, morse, balises, callouts | Écoute vérifiée par les compteurs audio de l'e2e |
| **AP10 — tous les aéroports** | Campagne pure sur les 34 030 pistes × 2 extrémités (approche, chemin, relief, refus motivés : tableau) ; échantillon volé stratifié (ILS réel, LDA, renumérotée, construite, `approx`, herbe, terrain d'altitude, montagne, piste courte), F-35 et A320, ici et sur kerr-mini | Tableau des refus compris ; échantillon vert ; captures |
| **AP-R — retraits** (règle 2) | `findRunway` « le plus proche/le plus long », `ilsItems` de la roue, le hachage des fréquences du MCDU, les constantes IAF/FAF fixes là où le chemin les remplace | Plus aucun lecteur ; tests verts |

## 7. Docs tenues dans le même lot

[VOL-AVIONS](VOL-AVIONS.md) partie I (leçon 7 ILS, leçon 10 A320 : choisir l'approche, la roue, la carte, le FD) et
[apprendre-avions.html](apprendre-avions.html) + son e2e revolé ; [HUD.md](HUD.md) (toutes les pistes, repères, FD) ;
[CREW.md](CREW.md) (actions, vue Approche) ; [BH-API](BH-API.md) ; [E2E.md](E2E.md), [E2E-CATALOGUE](E2E-CATALOGUE.md),
[E2E-VOLS](E2E-VOLS.md) §7 (leçons nouvelles) ; [TARS.md](TARS.md) ; [ASSETS.md](ASSETS.md) et CREDITS.md (GPL nav.dat, FAA) ;
[MENUS.md](MENUS.md) si les réglages y figurent ; ce plan (état en tête) ; le journal.

## 8. Risques et limites

- **nav.dat date de 2013** : ILS ajoutés depuis absents, quelques fréquences/axes changés. Rapprochement géométrique, source
  et cycle affichés ; une source plus récente recherchée à AP0.
- **Hors États-Unis, pas de procédures publiées libres** : segments construits autour de l'ILS réel ; dit dans l'UI.
- **58 % des pistes `approx`** (petits terrains surtout) : approche construite sur une géométrie approchée — marquée `≈`,
  hauteur de décision relevée ; l'AP ne vole pas une approche dont la piste est `approx` sans le dire.
- **Jeu, pas navigation réelle** : mention « ne pas utiliser pour la navigation » dans la fiche et ASSETS (exigé aussi par
  l'esprit de l'accord FAA).
- **Coût** : rien dans la boucle d'image hors du dessin HUD/carte ; planificateur à la sélection et à la replanification (pas à
  chaque image) ; tuiles chargées comme celles des pistes.

## 9. Questions à Sam (à poser au lot concerné, avec une recommandation)

1. ~~AP0 : la redistribution du CIFP~~ — **levée le 15 nov.** : domaine public, redistribuable sous ses deux conditions (§3).
2. ~~AP7 : la touche de « toutes les pistes » et le défaut du réglage~~ — **décidé le 15 nov. : activé par défaut ; bascule par
   la roue et le Labo, sans touche** (les touches de vol presque toutes prises).
3. ~~AP6 : quels postes du crew peuvent armer une approche~~ — **décidé le 15 nov. : tous les postes.**
