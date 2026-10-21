# Plan — le radar, l'image tactique et les pistes, AAA (pilote + crew)

Sur `main`. Objectif : **un radar parfait**, pour le pilote comme pour la console crew. Tous les écrans doivent
montrer la même chose, au même endroit, au même instant, avec les mêmes symboles. Ce qui se dit sur un écran est
vrai sur les autres. Les ajouts :

- **toutes les pistes d'atterrissage du monde** sur tous les radars et toutes les cartes ;
- **l'historique de chaque piste radar** (sa traînée), activable ou non ;
- **les missiles et les leurres** (fusées IR, paillettes) sur tous les radars et toutes les cartes ;
- **cliquer sur un radar pour sélectionner une cible**, sur tous les radars ;
- **zoomer un radar à la molette**, sur tous les radars.

**Contrainte** : coût nul mesurable sur l'image du pilote (A/B à ±1 %, comme pour le PCD) et ≤ 16 Ko par
événement réseau (la limite du serveur, `server/rooms.ts:391`).

## Décisions (2026-10-18)

| question | réponse |
|---|---|
| « les pistes » | **les deux** : toutes les pistes d'atterrissage (aéroports du monde entier + ponts des porte-avions), et l'historique de chaque piste radar (traînée, **option à bascule**) |
| la vue « Partagé » du crew | **toujours la vérité** du jeu, y compris en match ; la vue « Capteur » montre ce que savent les capteurs du pilote |
| les vaisseaux sans radar (Ranger, Lander, Endurance) | **un radar par vaisseau**, chacun avec son capteur (portée, champ, modes), sur le même moteur de pistes |
| missiles et leurres | **sur tous les radars et toutes les cartes**, pilote et crew (demandé le 2026-10-18, second tour) |
| sélection | **un clic sur un radar sélectionne la cible**, sur tous les radars (HUD, TSD, FCR, DAS, EOTS, carte de mission, crew) |
| zoom | **la molette zoome le radar** sous le pointeur, sur tous les radars |

### Décisions du 2026-10-21 (second lancement : « fais le plan radar », AAA)

| question | réponse |
|---|---|
| la base mondiale (RD10) | **accord donné** pour OurAirports : `airports.csv` (12,7 Mo) et `runways.csv` (4,0 Mo), depuis davidmegginson.github.io/ourairports-data, domaine public. Les CSV bruts restent hors dépôt ; seules les tuiles construites sont versionnées (`assets/runways/`) |
| « mêmes caractéristiques que les pistes déjà présentes » | **3D + ILS + autopilote** : les pistes revêtues proches de la caméra rendues comme les 8 `SITES` (nivelées, marquages, balisage OACI) ; un ILS synthétique et l'approche/atterrissage automatique sur les revêtues ≥ 1 800 m ; n'importe quel ICAO dans le plan de vol ; herbe, terre et eau en 3D plus simple (question ouverte 2 et 3 tranchées) |
| un clic sur un avion | **sélectionne seulement** — sur un radar **et dans la vue 3D** : la cible est désignée (fiche, BRAA) ; le verrou demande un second clic ou la touche LOCK. En vol, seuls les objets (avions, navires, missiles, leurres) se sélectionnent, jamais la Terre, la Lune ni un corps (question 7 tranchée) |
| les leurres | ils marchaient dans la simulation (ils détournent les missiles) mais **ne se voyaient nulle part** chez le pilote : ils doivent être visibles **dans la vue 3D** et **sur tous les radars** |
| les cartes du F-35 | sur toutes les cartes, **la trace de l'avion et la prédiction de sa trajectoire** |
| la mini-carte | **le panneau de droite** (la carte existante) en vol F-35 : il **suit l'avion**, se **zoome**, montre trace et prédiction, et sa **taille se règle en tirant son coin haut-gauche** |

Les autres questions ouvertes prennent la proposition du plan : écrans du pilote sur ses capteurs, option « image
complète » aux assistances élevées (1) ; pas d'AWACS (4) ; traînées `off` par défaut (5) ; héliports et hydrobases
sous 20 km (6) ; le clic du crew désigne au pilote, par défaut quand ses actions sont ouvertes — une désignation, pas
un verrou, comme le clic du pilote (8) ; paillettes en fausse piste au niveau « réaliste » seulement (9).

**Solo et multijoueur** (consigne du 2026-10-21) : chaque système de ce plan doit marcher **aussi bien en solo qu'en
salle** : leurres, image tactique, sélection, mini-carte, pistes du monde, ILS. Chaque phase se vérifie donc aussi
dans un e2e réseau à deux navigateurs sur kerr-mini.

**Ordre d'exécution retenu** (2026-10-21) : RD8a (les leurres visibles, tout de suite) → RD2 → RD3 → RD8 → RD9 (avec
le clic dans la vue 3D) → RD15 (la mini-carte, trace et prédiction) → RD7 → RD10 → RD11 → RD13 (avec la 3D) → RD4 →
RD5 → RD6 → RD12 → RD14.

## Définition de « parfait » (les critères d'acceptation)

Chaque critère est mesuré par un test (phase RD14) :

| # | critère | mesure |
|---|---|---|
| P1 | **Même image** : à la même heure de salle, la vue Capteur du crew contient exactement les pistes du TSD et du scope du HUD (mêmes ids, même IFF, même lock) | e2e : écart d'ensemble = 0, hors pistes nées depuis moins de 300 ms |
| P2 | **Même place** : chaque contact dessiné chez le crew est à moins de 25 m + 0,05 s × sa vitesse de sa position chez le pilote (p95) | e2e réseau, WebSocket local et via kerr-mini |
| P3 | **Pas de saut** : aucun contact ne se déplace de plus de 2 × sa vitesse × l'intervalle d'image entre deux images, sauf apparition ou téléportation | e2e : sauts comptés sur 60 s de combat |
| P4 | **Pause et accélération du temps respectées** : en pause, rien ne bouge ; à ×N, tout va N fois plus vite, chez le pilote comme chez le crew | e2e |
| P5 | **Mêmes symboles, mêmes couleurs** sur tous les écrans | test unitaire : chaque écran passe par `radar/symbols.ts` ; aucune couleur radar en dur ailleurs (recherche dans le code) |
| P6 | **Toutes les pistes** ouvertes de la base (OurAirports) avec coordonnées dessinées, à leur vraie place (±30 m sur les tuiles OSM), avec leur cap et leur longueur | test unitaire sur LFPG, KJFK, EGLL, un terrain en herbe, un hydro ; capture e2e |
| P7 | **Coût** : image du pilote inchangée (A/B ±1 % contre le commit de départ, Mojave et Alpes) ; crew à 60 i/s sur téléphone avec 200 pistes, traînées et pistes d'aéroport | trace-ab, profilage crew |
| P8 | **Débit** : ≤ 16 Ko par événement, ≤ 48 Ko/s par pilote | compteur dans `netsession` |
| P9 | **Missiles et leurres** : chaque missile en vol et chaque leurre vivant est une piste, sur tous les écrans qui doivent le montrer (vérité au crew Partagé, ce que voient DAS / radar / EOTS ailleurs), avec sa cible et son temps restant | e2e : un AIM-120 tiré sur un drone, un SAM tiré sur nous, des leurres largués — comptés sur chaque écran, pilote et crew |
| P10 | **Sélection** : un clic à moins de 12 px d'un symbole le sélectionne, sur chaque radar ; la même piste est alors sélectionnée sur **tous** les écrans du pilote (et le lock suit en < 1 image) ; un clic dans le vide ne fait rien d'autre que désélectionner | e2e en vrais événements CDP (`e2e-real-input`), un par écran |
| P11 | **Zoom** : un cran de molette = un pas de portée, sur chaque radar ; au-dessus d'un radar, la molette ne touche **jamais** le champ de la caméra | e2e en vrais événements CDP, un par écran |

## État de départ (analysé le 2026-10-18)

### Ce qui existe

- **Le moteur** : `game/radar.ts` (l'APG-81 : faisceau ±60° en 2 s, portée ∝ σ^¼, horizon radar, masque du
  relief, notch Doppler, pistes RWS/TWS/STT, IFF, datalink), piloté par `controller/radar.ts` (`radarFix`,
  `radarStep`, `radarHud`).
  - Les **sources** (`radarSources`) : `trf` (trafic ADS-B), `ais` (navires), `cv` (porte-avions et escortes),
    `cmb` (cibles du combat), `wng` (nos ailiers IA), `rwg` (ailiers IA des autres joueurs), `net` (les autres
    joueurs).
  - Le radar n'existe que **dans le F-35 en l'air** (`radarFix`, `controller/radar.ts:57`).
- **Les écrans du pilote**
  - Le scope du HUD (`ui/hud/symbology.ts:2584 drawRadar`), à chaque image.
  - Le PCD (`f35/pcd.ts`) : TSD (`:897`), FCR (`:1159`), EOTS et bande DAS (`:1404`, `:1536`). Données lues
    toutes les 100 ms par `pcdData` (`f35/cockpit.ts:44`).
  - La carte de mission (`ui/missionmap.ts`) et les étiquettes 3D (`trafficOverlay`, `seaOverlay`,
    `carrierOverlay`) lisent la vérité.
- **Les consommateurs** : TARS (`ai/game-tools.ts` : outils `traffic`, `weapons`), le copilote
  (`controller/copilot.ts` : `aircraftAround`, `lockOnName`, `threatPicture`, BRAA), les ailiers (annonces des
  contacts), l'interception (`controller/intercept.ts`), l'ACAS (`controller/gcas.ts:118`), les procurations de
  combat (`fightproxy.ts`).
- **Le crew** (`src/crew/`) reçoit l'événement `instruments` (`ui/crew-feed.ts`, `net/instruments.ts`) :
  - 4 Hz : `radar.contacts` (24 au plus, `{id, name, e, n, dz, iff, locked}`, sans vitesse ni heure) ;
  - 1 Hz : `traffic` et `zones` (`surroundings()`), construits à part, depuis la vérité.
  - Neuf vues (`dash pfd nd map globe radar schematic plan telemetry`), une bascule Partagé / Capteur (non
    sauvegardée).
- **Les pistes d'atterrissage** : **8 en tout** dans le jeu (`game/sites.ts:27-50`, `SITES` : KTTS, KEDW, SOCA,
  UAOO, LFPB, RJFG, YPWR et une sur Edmunds), un point et un cap chacune, toutes de 4 500 m × 60 m. Dessinées
  sur le TSD, la trace au sol et la carte de route ; **aucune** dans le crew ni sur la carte de mission. Pas de
  base mondiale, pas d'index spatial.
- **Les traînées** : aucune, nulle part. La seule trace est celle du pilote suivi dans la carte du crew
  (`crew/draw/geo.ts:222`).
- **Les missiles** (`game/combat.ts:29`, `:256`) : AIM-120, AIM-9X, JSM, SAM, R-73, avec leur tireur (`owner`
  blue/red, `from`), leur cible (une cible, nous `-1`, un leurre `-2 − i`, rien), leur guidage (IR ou radar).
  - Dessinés en points : le scope du HUD (`i.combat.radar.missiles`), le TSD et la bande DAS
    (`f35/cockpit.ts:174`, `pcd.ts:1537`).
  - **Toujours la vérité** : sans cible dessinée, sans temps restant.
  - En match, les missiles de chaque pilote sont envoyés aux autres 10 fois par seconde (`ui/netmatch.ts:784`).
- **Les leurres** (`game/combat.ts:289`) : une fusée IR et une gerbe de paillettes à chaque largage
  (`combat.ts:576`), 5 s de vie, qui détournent les missiles (IR et radar). En match, les nôtres sont envoyés
  aux autres (`netmatch.ts:778`, événement `cm`). **Aucun écran ne les montre**, ni chez le pilote ni chez le
  crew.
- **Le clic sur un radar**
  - Scope du HUD : **aucun** (dessin seulement).
  - PCD : un toucher dans le cockpit (`camera.onJetTouch` → `jetPick` → `jetPcd.touch`, `main.ts:4291`) n'agit
    que sur les touches. La touche LOCK passe à **la piste suivante** (`lockOnName()` sans nom). Toucher une
    piste du TSD ou du FCR ne fait rien.
  - Crew : un toucher sur un contact ouvre un menu (`views.onContact`, `crew/main.ts:1460`).
- **La molette**
  - Dans le jeu, elle zoome **le champ de la caméra** (`controls.ts:841 onWheel` → `zoomStep`), sauf au-dessus
    d'une commande du cockpit (le bouton tourne).
  - La portée du scope du HUD est un réglage (`f35RadarRange`). Celles du TSD et du FCR passent par les touches
    du PCD (`pcd.ts:438`).
  - Crew : portée continue de 500 m à 20 000 km à la molette et au pincement (radar, ND, dash : `views.ts:270`),
    qui ne tombe pas sur les pas du jeu.
- **Le réseau** : événements JSON par le WebSocket (fiables, ordonnés, ≤ 16 384 caractères), échantillons
  binaires de 104 octets (WebRTC sans retransmission + serveur). Horloge de salle : `net.roomNow()`,
  `net.roomWarp()` (pause = warp 0). Prédiction des autres : `remote.ts at(t)` (Hermite, correction lissée).

### Ce qui ne va pas

| # | constat | où |
|---|---|---|
| 1 | Le crew reçoit **deux images construites à part** : la vérité à 1 Hz (Partagé) et les pistes radar appauvries à 4 Hz (Capteur). Elles ne peuvent pas coller au radar | `ui/crew-feed.ts:90`, `:356` |
| 2 | **Le lock peut disparaître du crew** : les pistes sont coupées à 24, dans l'ordre d'insertion | `crew-feed.ts:356` |
| 3 | **Les amis et neutres IA d'un combat partent en « hostile »** chez le crew : le camp est deviné par `colour.startsWith("rgba(110")`, or la couleur n'existe que pour les joueurs | `crew-feed.ts:142` |
| 4 | Les cibles d'un combat envoyées au crew sont **la vérité** (`combatHud().radar`), tournées par un autre cap que celui qui a servi à les tourner | `crew-feed.ts:130-150`, `combat.ts:461` |
| 5 | **En mission, les cibles de combat ne sont pas envoyées** (`if (cb && !marks.length)`) | `crew-feed.ts:130` |
| 6 | **Navires AIS, ailiers IA (les nôtres et ceux des autres) et missiles absents** des cartes du crew, alors qu'ils sont sur le radar | `surroundings()` |
| 7 | **Unités de mission et cibles sans vitesse** (`spd: null`) : figées une seconde, puis elles sautent | `crew-feed.ts:110`, `:147`, `crew/model.ts:174` |
| 8 | Le crew **extrapole en temps réel**, pas en temps de salle : les contacts dérivent pendant une pause, et retardent en accéléré | `crew/model.ts:162-183` |
| 9 | Le crew place les joueurs (et lui-même) sur le **dernier échantillon brut** (`remotes.track().latest`), sans la prédiction de `at()` : décalage de vitesse × (latence + 250 ms) | `crew/model.ts:131` |
| 10 | Le scope du crew dessine un **faux balayage sur 360°** à son rythme, sans rapport avec le vrai faisceau (±60° en 2 s) | `crew/draw/radar.ts:132` |
| 11 | **La source `cmb` est dans un autre repère** (l'ENU plat du combat, `v` non tournée) ; toutes les autres passent par `fix.toLocal` | `controller/combat.ts:158` |
| 12 | **Six palettes** pour l'IFF (`IFF_COLOUR`, la boîte de lock, TSD/FCR `#ff5a46`, DAS avec neutre = inconnu = blanc, crew ambre, carte de mission) | voir la phase RD3 |
| 13 | **Symboles différents** : chevron au HUD, OTAN au TSD, losange (symbole *surface* OTAN) pour un hostile aérien au FCR, aucun cap chez le crew | `symbology.ts:2693`, `pcd.ts:1159`, `crew/draw/radar.ts` |
| 14 | **Hauteurs différentes** : relatives en centaines au HUD, absolues en milliers au FCR, rien au TSD ni au DAS, `dz` au crew | — |
| 15 | Le scope du HUD a du **code mort** (couleur de lock rouge, pistes non vues à 50 %) : `radarHud` remplit toujours `colour` | `symbology.ts:2693`, `radar.ts:212` |
| 16 | **Missiles toujours vrais** (HUD, TSD, DAS) : aucun modèle d'alerte missile, le DAS voit tout | `cockpit.ts:179` |
| 17 | En RWS, les pistes sont **figées entre deux balayages** ; l'EOTS et le DAS (qui devraient voir à 360° en IR) les reprennent telles quelles | `game/radar.ts:149` |
| 18 | `radarHud` est **calculé deux fois** (la télémétrie à chaque image, `pcdData` toutes les 100 ms) | `telemetry.ts:390`, `cockpit.ts:73` |
| 19 | `netRadar` est **calculé à chaque image et dessiné nulle part** | `netsession.ts:561`, `symbology.ts:37` |
| 20 | Les actions crew visent un contact **par son nom** (`wp.lock {target: name}`, `ap.traffic {name}`) : deux appareils de même nom, une piste renommée, et c'est le mauvais | `crew/main.ts:1460-1485` |
| 21 | Les options du crew (portée, nord, source) **ne sont pas sauvegardées** | `crew/main.ts:258` |
| 22 | **Aucun radar hors du F-35** : Ranger, Lander, Endurance n'ont ni scope, ni ACAS, ni radar de rendez-vous | `radarFix` |
| 23 | **Les leurres n'apparaissent nulle part** : ni sur le FCR (les paillettes sont un écho radar), ni sur le DAS ou l'EOTS (les fusées sont des points chauds), ni au crew | `combat.ts:289` |
| 24 | **Les missiles ne sont que des points** : pas de cible ni de ligne vers elle, pas de temps avant impact (le nôtre : « pitbull », A-pole, F-pole), pas de distinction de type ou de guidage ; un missile détourné vers un leurre ne se voit pas | `symbology.ts`, `pcd.ts:1537` |
| 25 | **Le crew ne voit aucun missile** (ni les nôtres, ni ceux des SAM, ni ceux des autres joueurs en match) | `surroundings()` |
| 26 | **On ne peut pas désigner une piste précise** dans le jeu : la touche LOCK et Tab passent à la suivante (de la plus proche à la plus lointaine) ; viser *ce* bandit-là demande plusieurs appuis | `game/radar.ts lockNext`, `pcd.ts:448` |
| 27 | **Au-dessus d'un radar, la molette zoome la caméra** : on change le champ de vue en voulant changer la portée | `controls.ts:841` |
| 28 | **Portées sans pas commun** : HUD 10–160 km (réglage), TSD 5–160 (touches), FCR 10–160 (touches), crew continu 500 m–20 000 km | `symbology.ts:2600`, `pcd.ts:252`, `:275`, `crew/views.ts:270` |
| 29 | **Pas de curseur de désignation** (TDC) à la manette ou au HOTAS : sans souris, rien n'est sélectionnable | `input/jetpad.ts`, `input/bindings.ts` |

## La proposition

### 1. L'image tactique unique (`src/radar/picture.ts`)

**Une seule liste de pistes par pilote**, construite une fois par image après `radarStep`. C'est la seule chose
que lisent les écrans, les outils et le réseau.

```ts
interface PicTrack {
  id: string;            // stable, préfixé par la source : trf:, ais:, cv:, cmb:, wng:, rwg:, net:, msl:, cm:, iss:, flt:
  name: string;          // indicatif ou nom
  type: string;          // A320, F-35, frégate, AIM-120, fusée…
  kind: "air" | "sea" | "ground" | "space" | "missile" | "flare" | "chaff";
  // un missile : son guidage, sa cible (l'id d'une piste, ou celui d'un leurre), son temps avant impact [s]
  msl?: { seeker: "ir" | "radar"; target: string | null; tti: number | null; pitbull: boolean; ours: boolean };
  // un leurre : qui l'a largué, sa vie restante [s]
  cm?: { by: string; life: number };
  // la vérité (ce qu'est l'objet)
  side: "friend" | "hostile" | "neutral" | "traffic" | "carrier" | "player" | "dead";
  // ce qu'en savent nos capteurs
  iff: "friend" | "neutral" | "unknown" | "hostile";
  sensors: number;       // bits : RADAR | DATALINK | TCAS | AIS | DAS | EOTS | BRIEF | EYES
  state: "firm" | "coast" | "memory" | "truth";  // vue à l'instant, prolongée, en mémoire, hors capteurs
  seenAt: number;        // heure de salle de la dernière mesure [s]
  hits: number;
  locked: boolean;
  // la position : Terre-fixe exacte + géodésique WGS84 ; vitesse dans le repère local
  p: V3; lat: number; lon: number; h: number;
  v: V3;                 // est, nord, haut [m/s] (ou LVLH dans l'espace)
  hist: Float64Array;    // l'anneau de l'historique (RD7)
}
```

- **Les sources rendent toutes leurs objets dans le même repère** (`fix.toLocal`, vitesses tournées). La source
  `cmb` y passe aussi (constat 11).
- **La vérité et le capteur sont deux champs de la même piste**, jamais deux listes. Une piste peut être
  `truth` (connue du jeu, pas des capteurs) : la vue Partagé la montre, les écrans du pilote non.
- **Les missiles et les leurres deviennent des pistes** (`msl:`, `cm:`), vus par les capteurs qui le peuvent,
  sinon `truth` seulement (constats 16, 23 à 25 ; détail au §7).
- **La sélection est dans l'image** (`picture.selected`, une seule pour tous les écrans du pilote ; détail au §8).
- **L'EOTS et le DAS sont des capteurs** (bits `EOTS`, `DAS`), pas une copie des pistes radar (constat 17).
- **`radarHud`, `pcdData`, la télémétrie, les outils lisent l'image**, une fois par image (constats 18, 19 : on
  supprime `netRadar`).
- **Les consommateurs** passent à l'image : `aircraftAround`, `lockOnName` (par id d'abord), `threatPicture`,
  les annonces des ailiers, l'interception, l'ACAS (bit `TCAS`), les procurations. Ceux qui *doivent* lire la
  vérité (procurations de combat, ACAS sur transpondeur) le disent par un filtre explicite.
- **`__bh.radar`** : `picture()`, `track(id)`, `stats()` (coût, nombre par source), pour les tests.

### 2. Les capteurs, par vaisseau (`src/radar/sensors.ts`)

Le moteur de `game/radar.ts` devient **générique**, paramétré par une fiche `SensorSpec` : portée de référence,
champ (az/él), balayage, rétention, notch, modes, IFF, repère (local ENU en l'air, **LVLH** en orbite : R-bar,
V-bar, H-bar).

| vaisseau | capteurs |
|---|---|
| **F-35** | APG-81 (l'actuel) ; **DAS** (IR à 360°, alerte et départ de missile, avions à courte portée) ; EOTS (le pod, ±6°/30°) ; IFF ; datalink (Link 16 avec ailiers et équipiers) ; TCAS (transpondeurs) |
| **Ranger** (avion spatial) | **en l'air** : radar nez ±60° (météo + air-air simple, portée ≈ 60 % de l'APG-81), TCAS ; **en orbite** : **radar de rendez-vous** à 360° (≈ 300 km sur une peau, 1 000 km sur un transpondeur : ISS, Endurance, joueurs) |
| **Lander** | **radar de rendez-vous** façon LM (≈ 740 km sur transpondeur, cône ±30° orientable) ; **radar d'atterrissage** (hauteur, vitesses : l'existant, rangé ici) |
| **Endurance** | **radar de veille** à 360° (≈ 5 000 km sur transpondeur, 500 km sur peau) ; radar d'amarrage (< 2 km, distance et vitesse fines) |
| **tous, en l'air** | **TCAS** : les transpondeurs à 74 km (40 NM) et ±3 000 m, avec TA/RA ; l'ACAS de `gcas.ts` passe dessus |

- **Les sources spatiales** : la flotte (`fleet.ts`), l'ISS, les joueurs du même corps (repère inertiel), le
  vaisseau-mère, côté Gargantua comme côté Terre.
- **Les écrans** : le scope générique du HUD (§4) existe pour tous ; les HUD, cockpits et vues crew propres aux
  vaisseaux sont ceux de **PLAN-VAISSEAUX-AAA** (X4, X6, K4). Ce plan leur fournit l'image et le scope ; il ne
  refait pas leurs écrans. **À coordonner** avec la branche `vaisseaux-aaa` (§11).

### 3. Le flux crew (`net/picture.ts`)

Un nouveau bloc optionnel `pic` dans `instruments` v1 remplace `radar.contacts` et `traffic` (ces deux-là restent
envoyés, dérivés de l'image, jusqu'à la clôture, pour un ancien crew ouvert).

- **Compact** : un tableau de lignes quantifiées. lat et lon en 1e-5° (entiers), h en mètres, v en dm/s, l'âge
  en dixièmes de seconde, les bits `sensors`, `side`, `iff`, `state`, `kind` dans un entier. Les **noms et types
  dans un dictionnaire** envoyé une fois par id (puis à chaque arrivée d'un membre). Environ 30 caractères par
  piste, soit **≈ 300 pistes sous 16 Ko**.
- **Daté en heure de salle** : `t0` du bloc, et l'âge de chaque mesure.
- **Par priorité**, toutes les 250 ms :
  1. tout de suite : le lock, la sélection, les hostiles, **les missiles et les leurres** (dans chaque bloc,
     tant qu'ils vivent), le datalink, ce qui est à moins de 40 km ;
  2. le reste à tour de rôle, chaque piste au moins **une fois par seconde** ;
  3. les disparitions (ids perdus) dans le même bloc.
- **Le faisceau** : mode, azimut, sens, limites du balayage, la portée de l'écran du pilote.
- **La sélection du pilote** (son id) et sa portée par écran, pour que le crew les montre.
- **L'historique de rattrapage** : à l'arrivée d'un crew (ou sur sa demande), un bloc `hist` étalé sur quelques
  envois, les 2 dernières minutes de chaque piste à 1 point par 2 s, quantifiées en écarts.
- **Plusieurs pilotes** : le crew fusionne les images de tous les pilotes de la salle par id, la mesure la plus
  fraîche gagne (comme aujourd'hui) ; les bits `sensors` disent *qui* voit quoi.

### 4. Les écrans du pilote

**Une symbologie commune** (`src/radar/symbols.ts`, module pur, sans dépendance au simulateur : le crew
l'importe aussi).

- **Une palette** : ami cyan, hostile rouge, inconnu jaune, neutre blanc, trafic gris-blanc, joueur sa couleur
  (liseré), mort gris barré. Contraste vérifié sur fond sombre et sur le HUD vert.
- **Une forme par nature et camp**, OTAN simplifiée (APP-6) :

  | | air | surface |
  |---|---|---|
  | ami | demi-cercle | cercle |
  | hostile | chevron | losange |
  | inconnu | demi-carré | carré |
  | neutre | demi-carré blanc | carré blanc |

  Le trafic civil est un losange TCAS ouvert. Les armes et les leurres :

  | objet | symbole |
  |---|---|
  | missile | un trait avec sa pointe, dans l'axe de sa route ; le nôtre cyan, celui d'un équipier à sa couleur, l'ennemi rouge et clignotant s'il nous vise ; le type en petit (120, 9X, SAM, R73, JSM) |
  | sa cible | un trait pointillé du missile à sa cible ; le temps avant impact au bout (`12 s`), « PITBULL » quand le nôtre guide seul |
  | fusée IR | une étoile orange qui pâlit en 5 s |
  | paillettes | un petit nuage de points gris qui s'étale et ralentit |
  | missile détourné | son trait de cible passe sur le leurre, marqué « LEURRÉ » ; à l'impact « SPLASH », sinon « RATÉ » (3 s) |
- **Les états** :
  - ferme : plein ;
  - prolongé : creux ;
  - mémoire : pointillé, et il s'efface ;
  - datalink : tireté ;
  - lock : un anneau, plus un trait vers soi ;
  - **vérité hors capteurs** (crew Partagé seulement) : estompé.
- **Le vecteur vitesse** : sa longueur = 30 s de route, partout.
- **Les hauteurs** : relatives en centaines (de mètres ou de pieds, `unitsFor()`) près du symbole sur le HUD, le
  TSD et le crew ; absolues dans les listes et le bloc du lock ; jamais en dur.

Ce que ça change à chaque écran :

- **Scope du HUD** : formes et états ci-dessus ; on enlève le code mort (constat 15) ; une étiquette seulement
  pour le lock, les hostiles et le plus proche (le reste sans texte, pour désencombrer) ; le secteur réel ±60° et
  le faisceau ; un **mode « espace »** (LVLH, distance et vitesse de rapprochement) pour les vaisseaux.
- **TSD** : même symbologie ; hauteurs relatives ajoutées ; missiles et leurres (§7) ; traînées (§6) ; pistes
  (§5).
- **FCR** : le hostile aérien en chevron (plus de losange) ; distinction air/surface ; l'historique « B-scope »
  (les échos précédents en points qui s'estompent) ; nos missiles en vol vers le lock (temps avant impact, A-pole
  et F-pole dans le bloc du lock), les échos de paillettes ; en carte sol (SAR stylisé), les pistes d'aéroport.
- **DAS** : neutre ≠ inconnu ; ses propres pistes IR à 360°, plus seulement le radar ; les départs de missile
  et les fusées.
- **EOTS** : les fusées en points chauds qui éblouissent l'image un instant ; le missile suivi.
- **Carte de mission** : lit l'image (vérité filtrée comme le pilote la voit, ou tout, selon l'assistance — voir
  les questions ouvertes) ; ajoute AIS, ailiers, joueurs, missiles, leurres.
- **Étiquettes 3D** : mêmes couleurs que les écrans.

### 5. Toutes les pistes d'atterrissage (`src/world/runways.ts`, `assets/runways/`)

- **La base** : OurAirports (domaine public), `airports.csv` (≈ 12 Mo, ≈ 80 000 lieux) et `runways.csv`
  (≈ 4 Mo, ≈ 47 000 pistes). **Téléchargement soumis à ton accord** (nom, source, taille) au début de RD10.
- **La construction** (`scripts/build-runways.ts`, comme `build-ephemeris.ts`) :
  - Garder les lieux ouverts : grands, moyens et petits aéroports, hydrobases, héliports. Écarter les fermés.
  - Pour chaque piste : les deux seuils (lat/lon, élévation, seuil décalé), cap vrai, longueur, largeur,
    **surface en classes** (revêtue, herbe, terre/gravier, eau, neige/glace, inconnue), balisage, noms des deux
    bouts (09L/27R).
  - **Les seuils manquants** (fréquents sur les petits terrains) : reconstruits depuis le point de l'aéroport,
    le numéro de piste (cap magnétique → vrai, déclinaison WMM) et la longueur. Marqués « approximatifs ».
  - **Tuiles de 5° × 5°** en binaire (entiers quantifiés, écarts en mètres depuis le point de l'aéroport), plus
    un index des tuiles non vides et un dictionnaire des noms à part. Cible : **< 1,5 Mo gzip** pour le monde.
  - Les 8 `SITES` restent la référence de leurs propres pistes (ILS, nivellement, rendu 3D) ; la base y est
    rapprochée (pas de doublon).
- **Le chargement** : par tuile, à la demande, gardé en LRU ; mis en cache par le service worker (PWA).
  `runwaysNear(lat, lon, r)` et `runwaysInBox(...)` sur une grille de 0,25°. **Le même module pur sert au jeu et
  au crew** : le crew charge les tuiles lui-même, depuis le même site (pas de pistes dans le flux réseau).
- **Les porte-avions sont des pistes mobiles** : le pont oblique du Ford (`LANDING`, `carrier.ts:37`), le pont
  axial du Kiev et de l'Implacable (longueur, `STO_LANE`), projetés à chaque image par `carrierPose` et
  `fromDeck`. Envoyés au crew avec le porte-avions (cap et position suffisent : la géométrie du pont est une
  constante partagée).
- **Les autres corps** : les sites de la Lune, de Mars, de Titan, de Miller et de Mann, sur les cartes de ces
  corps.
- **Le niveau de détail** (déclutter), réglé par la portée ou le zoom :

  | portée affichée | ce qui est dessiné |
  |---|---|
  | > 300 km | un point par grand aéroport |
  | 80–300 km | les pistes revêtues ≥ 1 800 m, en traits à l'échelle |
  | 20–80 km | toutes les pistes revêtues, plus l'herbe ≥ 600 m ; ICAO en étiquette |
  | < 20 km | tout, héliports (H) et hydrobases compris ; contour à la vraie largeur, seuils, numéros des deux bouts |

  Couleur par surface : revêtue cyan clair, herbe vert, terre ocre, eau bleu. Le terrain choisi (plan de vol,
  ILS) est en magenta.
- **Où** : scope du HUD, TSD (remplace `FIELDS`), FCR en carte sol, carte de mission, trace au sol, carte de
  route, carte 3D (grands aéroports, au zoom Terre) ; crew : radar, ND, carte, globe, plan.
- **Ce qu'on en fait** : un toucher sur une piste (jeu ou crew) l'ouvre : nom, ICAO, pistes, longueurs,
  surface, élévation, METAR le plus proche, et les actions « ajouter au plan », « direct », « approche » (si un
  ILS existe, voir les questions ouvertes).
- **Une bascule** `radarRunways` côté jeu (préférence) et « Pistes » côté crew (sauvegardée).

### 6. L'historique des pistes (traînées)

- **Côté pilote** : chaque piste garde un anneau de positions (`Float64Array`, lat/lon/h).
  - Les pistes **radar** : un point à chaque mesure (l'historique d'un vrai radar, des échos qui s'estompent).
  - Les **autres** (datalink, ADS-B, AIS, vérité) : un point toutes les 2 s.
  - Les joueurs : depuis leurs échantillons.
  - Bornes : 120 points par piste, 400 pistes, mémoire fixe.
- **Côté crew** : il construit son propre historique depuis le flux, rattrapé à l'arrivée par le bloc `hist`
  (§3). Les joueurs aussi.
- **Le dessin** : des points qui pâlissent avec l'âge (le style radar), ou un trait (le style carte) sur les
  cartes du crew ; couleur de la piste.
- **Les réglages** :
  - `radarTrails` : `off` | `short` (30 s) | `long` (3 min), défaut `off`, préférence ;
  - côté crew, la même bascule, sauvegardée ;
  - le lock et la cible gardent leur traînée même en `off` (option `radarTrailLock`, défaut on).
- **Partout** : scope du HUD (court, quelques points), TSD, FCR (échos), carte de mission ; crew : radar, ND,
  carte, globe.

### 7. Les missiles et les leurres

**Deux nouvelles sources** de l'image : `msl` (les missiles de `combat.world.missiles`, plus ceux des autres
joueurs en match, reçus par `netmatch`) et `cm` (les leurres de `combat.world.decoys`, plus ceux reçus par
l'événement `cm`). Ils deviennent des pistes comme les autres : même id d'un écran à l'autre, même place, même
heure de salle.

**Qui voit quoi** (pour le pilote ; le crew Partagé voit tout, toujours) :

| objet | radar (APG-81) | DAS (IR, 360°) | EOTS | datalink |
|---|---|---|---|---|
| **notre missile** | dans le faisceau (σ ≈ 0,05 m² : ≈ 47 km) | moteur allumé | dans son champ | **toujours** (la liaison de guidage) : place, cible, temps avant impact |
| **missile d'un équipier ou d'un ailier** | idem | idem | idem | toujours (Link 16) |
| **missile ennemi** | dans le faisceau | **le départ** (la flamme, ≤ 20 km) et le vol moteur allumé ; moteur éteint, seulement à moins de 3 km | dans son champ | non |
| **fusée IR** | non | oui (≤ 10 km), 5 s | oui (un point chaud qui éblouit) | non |
| **paillettes** | **oui** : un écho fort (σ ≈ 50 m²) qui ralentit à la vitesse du vent en 1–2 s, tombe dans le notch Doppler et se perd ; en RWS il peut faire une **fausse piste** | non | non | non |

- **Notre missile** : son trait de cible, son temps avant impact, « PITBULL » dans les 15 derniers km de
  l'AIM-120 ; sur le FCR, A-pole et F-pole dans le bloc du lock. À la fin, « SPLASH » ou « RATÉ » 3 s sur la
  piste.
- **Le missile ennemi** : rouge, clignotant s'il nous vise. Son relèvement est marqué sur le cercle du scope du
  HUD et sur la bande DAS (l'horloge de l'alerte, « MISSILE 4 H », déjà annoncée par la voix). Son temps avant
  impact est estimé depuis sa vitesse de rapprochement. Le site SAM qui tire est marqué au départ.
- **Le leurre qui détourne** : le trait de cible du missile passe sur lui, marqué « LEURRÉ » (on le voit pour nos
  missiles comme pour ceux qu'on esquive).
- **La traînée d'un missile** (sa fumée) : toujours courte (5 s), même avec les traînées éteintes (réglage
  `radarTrailMissiles`, défaut on).
- **Partout** : scope du HUD, TSD, FCR, DAS, EOTS, carte de mission ; crew : radar, ND, carte, globe.
- **Au crew** : dans chaque bloc (priorité 1) ; les missiles portent `target` (un id de piste) et `tti` ; les
  leurres leur vie restante. Une salve de leurres (≈ 2 objets par largage, 5 s de vie) tient dans le budget.
- **Le réseau** : un missile d'un autre joueur garde l'id de son tireur (`msl:<slot>:<id>`), le même sur tous
  les écrans de la salle.

### 8. Sélectionner et zoomer, sur tous les radars

**Une seule sélection** pour tous les écrans du pilote (`picture.selected`), surlignée partout (un anneau ambre
tireté, comme le crew aujourd'hui), plus le lock qui garde son anneau à lui.

**Le clic**

- **Un clic à moins de 12 px d'un symbole le sélectionne.** Plusieurs symboles sous le pointeur : le plus
  menaçant d'abord ; un nouveau clic au même endroit passe au suivant.
- **Ce que la sélection fait** dépend de la piste :

  | piste | un clic | un second clic sur la même | appui long ou clic droit |
  |---|---|---|---|
  | une piste **radar** | **désignée et verrouillée** (le lock en TWS, le radar continue de balayer) | **STT** | menu : intercepter, rejoindre en formation, BRAA à la radio, déverrouiller, infos |
  | une piste hors radar (datalink, TCAS, AIS, porte-avions) | **la cible** : intercepter ou rejoindre la visent, le bloc de la cible donne relèvement, distance, hauteur | le radar est pointé sur elle (un balayage resserré autour) | même menu, plus « direct » |
  | **un missile** | sélectionné : type, tireur, cible, temps avant impact | — | « suivre à l'EOTS » |
  | **un leurre** | infos seulement | — | — |
  | **une piste d'aéroport** | le terrain sélectionné (sa fiche, §5) | « direct » | ajouter au plan, approche, infos METAR |
  | le vide | désélectionne (le lock reste ; il se lâche par le menu ou la touche) | — | — |

- **Où** :
  - **Scope du HUD** : chaque dessin enregistre ses cibles de clic (comme les `hits` du PCD). Un clic sans
    glisser (< 4 px, sinon c'est le regard qui tourne) dans le disque du scope est pris **avant** le regard et
    `onJetTouch` (`controls.ts:723`).
  - **PCD** (TSD, FCR, DAS, EOTS) : `jetPick` → (u, v) → `pcd.pick(u, v)` sur la page touchée, les touches de
    page gardant leur rôle.
  - **Carte de mission** : la même règle sur son canvas.
  - **Crew** : radar, ND, carte, globe (§9).
- **À la manette, au HOTAS, au clavier** (constat 29) : un **curseur de désignation** (TDC). On maintient une
  touche (liaison à choisir dans `input/bindings.ts` sans conflit avec ZQSD, AE, WX en AZERTY), le manche droit
  le déplace sur l'écran actif (le scope du HUD, ou la page du PCD regardée dans le cockpit) ; A ou la détente
  désigne. Tab garde « la suivante », ⇧Tab « la précédente ».
- **TARS et les outils** désignent par id (`lockOn(id)`), le nom restant en repli (« verrouille le bandit au
  nord »).

**La molette**

- **Une seule échelle de pas** pour tous les radars :
  - air : 2, 5, 10, 20, 40, 80, 160, 320 km (en NM : 1, 2,5, 5, 10, 20, 40, 80, 160, selon `unitsFor()`) ;
  - espace : 1, 10, 100, 1 000, 10 000 km.
- **Au-dessus d'un radar, un cran de molette = un pas**, accumulé comme le bouton du cockpit (50 px par cran,
  pour les pavés tactiles). L'événement est consommé : **le champ de la caméra ne bouge pas** (constat 27).
  - **Scope du HUD** : le pointeur dans son disque → `f35RadarRange` (AUTO bascule en manuel au pas courant ; un
    clic sur l'étiquette de portée revient à AUTO).
  - **PCD** : `jetPick` au moment de la molette (seulement si le pointeur est sur l'écran, matériau 36) → la
    page sous le pointeur (portée du TSD ou du FCR, champ large ou étroit de l'EOTS).
  - **Carte de mission** : zoom continu centré sous le pointeur (c'est une carte).
  - **Crew** : radar, ND, dash par pas (le pincement glisse puis se cale sur le pas le plus proche) ; carte et
    globe en continu, centrés sous le pointeur.
- **Clavier, manette, HOTAS** : portée + et − en liaisons (à choisir sans conflit), sur l'écran actif.
- **Mémorisé** : la portée de chaque écran (préférences pour le jeu, `localStorage` pour le crew).

### 9. La console crew

- **Un `TrackStore`** (`crew/tracks.ts`) :
  - Il reçoit les blocs `pic` de tous les pilotes et fusionne par id.
  - Il **extrapole en heure de salle** : `net.roomNow()` ; la pause (warp 0) fige, l'accéléré multiplie
    (constat 8).
  - Il **lisse par convergence** : à chaque mesure, l'écart avec la position affichée s'efface en 0,3 s (comme
    `remote.ts`), sans saut (P3).
  - Il **retire les pistes** selon leur source : une piste radar quand le pilote la perd, une piste de vérité
    après 8 s sans nouvelle.
- **Les joueurs et soi-même** passent par `remotes.at(maintenant)`, prédits au même instant que les pistes
  (constat 9).
- **Les deux vues sont deux filtres de la même liste** (constats 1 à 7) :
  - **Capteur** : les pistes dont un bit `sensors` est mis, colorées par l'**IFF perçue**, comme le TSD. Le
    scope montre **le vrai secteur et le vrai faisceau** du pilote (B-scope ±60° ou plan ±60°, au choix), plus le
    datalink et le TCAS à 360° (constat 10).
  - **Partagé** : **toute la vérité** (décision), colorée par le **camp réel**. Ce que les capteurs du pilote
    voient aussi est plein, le reste creux, le lock entouré. Pas de faux balayage : c'est un écran tactique.
- **Missiles et leurres** dans toutes les vues (§7) : Partagé les montre tous, Capteur ceux que voient les
  capteurs du pilote, avec les mêmes traits de cible, temps avant impact, « LEURRÉ ».
- **Le clic** (§8) :
  - Un clic sélectionne la piste chez le crew (anneau ambre, fiche). Plusieurs sous le doigt : la plus menaçante,
    puis la suivante au clic suivant.
  - **« Le clic désigne au pilote »** (bascule du crew, **activée par défaut** quand le pilote ouvre ses actions,
    `netCrewActions`) : la sélection du crew devient celle du pilote, avec les mêmes effets que son propre clic
    (une piste radar est verrouillée, une autre devient la cible), par l'acte `wp.lock {id}` ou `nav.target {id}`.
    Le pilote voit « CREW ▸ nom » et le marqueur de désignation du crew.
  - Appui long ou clic droit : le menu actuel (cibler, intercepter, rejoindre, verrouiller), par id.
  - La sélection du pilote est montrée au crew (anneau ambre plein) ; celle du crew au pilote (anneau tireté).
- **La molette et le pincement** (§8) : radar, ND et dash par pas communs avec le jeu ; carte et globe en continu
  sous le pointeur.
- **Les actions visent un id** (`wp.lock {id}`, `ap.traffic {id}`, `nav.target {id}`), le nom restant en repli
  (constat 20).
- **Les options sauvegardées** (constat 21) : portée, nord ou cap, source, traînées, pistes.
- **Les listes** : contacts triés par menace puis distance (le lock d'abord), filtre par camp et nature,
  recherche par nom.

### 10. Le réseau partout

- **Link 16 entre joueurs** : chaque F-35 partage ses pistes radar avec ses équipiers (même équipe, ou toute la
  salle hors match). Elles arrivent dans leur image avec le bit `DATALINK` et l'id d'origine : une piste vue par
  deux joueurs reste une seule piste.
- **En match** : le pilote ne voit que ses capteurs et le datalink de son équipe ; **le crew Partagé voit la
  vérité** (décision : assumée, à dire dans l'écran de salle « le crew voit tout »).
- **Les vaisseaux** : le radar de rendez-vous voit les joueurs (transpondeur) ; leurs traînées viennent de
  leurs échantillons.
- **Missiles et leurres en match** : ceux de chaque joueur (déjà envoyés 10 fois par seconde par `netmatch`)
  entrent dans l'image de tous avec le même id ; un missile qui vise un joueur est rouge chez lui, à la couleur de
  son équipe chez les autres.

### 11. Coordination avec les autres plans

- **PLAN-VAISSEAUX-AAA** (branche `vaisseaux-aaa`, worktree `../bhg-vaisseaux`) :
  - X4 (HUD spécialisés), X6 (cockpits), K1 à K4 (crew vaisseau) consomment l'image et les capteurs de RD4.
  - **Ordre proposé** : RD2 et RD4 fusionnés sur `main` avant que la branche vaisseaux attaque X4 et K4 ; sinon
    elle rebase sur `sync_with_base_branch`.
  - Pas de fichier commun touché en même temps : `src/radar/*` est neuf ; `controller/radar.ts` et
    `game/radar.ts` sont à ce plan.
- **PLAN-AEROPORTS** : les `SITES` restent la référence 3D ; la base mondiale est une couche de cartes.
- **PLAN-CREW-ACTIONS** : les actes `wp.lock`, `ap.traffic`, `nav.target` gagnent `id`.

### 12. Les budgets

| quoi | budget |
|---|---|
| construction de l'image | ≤ 0,15 ms/image à 400 objets (Mojave, trafic réel) |
| scope du HUD avec traînées et pistes | ≤ 0,10 ms/image |
| TSD et FCR | dans leur budget actuel (0,21–0,45 ms à 14 pages, PLAN-PCD-AAA Q9) |
| requête des pistes | refaite tous les 1 km ou à chaque changement de portée, ≤ 0,05 ms |
| mémoire des traînées | ≤ 2 Mo (400 × 120 × 3 × 8 octets + marge) |
| flux crew | ≤ 16 Ko par bloc, ≤ 48 Ko/s |
| pistes du monde | ≤ 1,5 Mo gzip au total, une tuile ≤ 120 Ko |
| crew | 60 i/s sur iPhone récent avec 200 pistes + traînées + aéroports |
| missiles et leurres | ≤ 0,03 ms/image pour 40 objets (pas de masque du relief pour le DAS) |
| clic et molette | test des cibles ≤ 0,05 ms par événement ; `jetPick` seulement sur un clic ou un cran, jamais au survol |

## Phases

Chaque phase : un commit, une fiche et une planche de captures (`docs/progress/radar/`), FR + EN, `bun test` et
`bunx biome ci .` verts, poussée sur `main`. Taille : **S** = moins d'une demi-journée, **M** = une journée,
**L** = deux jours ou plus.

### RD0 — Mesures et socle (M)

- **Le chiffre de départ** : un e2e sonde (`tests/e2e/radar-sync.e2e.test.ts`) qui ouvre un pilote et un crew
  dans la même salle, et mesure les critères P1 à P4 **avant** tout changement.
  - Il passe par `__bh.radar` (jeu) et un nouveau `__crew` (crew : pistes dessinées et leur position écran →
    géo).
- **Le coût de départ** : `radarStep`, `radarHud` ×2, PCD, scope du HUD, en vol sur le Mojave et les Alpes
  (trace-ab sur vues figées).
- **La salle de démo enrichie** (`scripts/crew-demo.ts`) : un combat (amis IA, neutres, hostiles, missiles et
  leurres), du trafic, des navires AIS, un porte-avions, deux joueurs.
- **Les captures « avant »** de chaque écran radar et carte : `docs/progress/radar/before/`.

### RD1 — Les correctifs immédiats (S)

- Les pistes envoyées au crew **triées** (lock, hostiles, datalink, distance) avant la coupe (constat 2).
- Le camp des cibles de combat par leurs drapeaux, plus par la couleur (3).
- Les cibles de combat en mission (5) ; leur rotation par le bon cap (4).
- `spd` envoyé pour les unités et les cibles (7).
- L'extrapolation du crew en heure de salle, pause comprise (8).
- Le code mort du scope (15) ; `netRadar` supprimé (19) ; `radarHud` une fois par image (18).
- Corrige les plus gros écarts tout de suite, sans attendre la refonte. Mesure RD0 refaite.

### RD2 — L'image tactique unique (L)

- `src/radar/picture.ts`, `PicTrack`, les bits `sensors`, les états, la vérité dans la même piste.
- La source `cmb` dans le repère commun (11) ; les missiles en pistes.
- Tous les consommateurs migrés (écrans, TARS, copilote, ailiers, interception, ACAS, procurations).
- `__bh.radar`. Tests unitaires de la fusion (une piste vue par radar + datalink + vérité = une seule), des
  états, des retraits.

### RD3 — La symbologie commune (M)

- `src/radar/symbols.ts` (pur), la palette, les formes, les états, les hauteurs par `unitsFor()`.
- Scope du HUD, TSD, FCR, DAS, EOTS, carte de mission, étiquettes 3D (12 à 14).
- Le test P5 (pas de couleur radar ailleurs). Planche de tous les écrans côte à côte.

### RD4 — Les capteurs par vaisseau (L)

- `SensorSpec` et le moteur générique ; l'APG-81 réexprimé (les tests `radar.test.ts` inchangés).
- DAS et alerte missile, EOTS en capteur (16, 17).
- Le TCAS pour tous (avec TA/RA, l'ACAS dessus).
- Le Ranger (nez + rendez-vous), le Lander (rendez-vous + atterrissage), l'Endurance (veille + amarrage) ; le
  repère LVLH ; le scope « espace » du HUD (22).
- e2e : le Ranger en approche de l'ISS la voit à 300 km, le Lander voit l'Endurance en orbite lunaire.

### RD5 — Le flux crew (L)

- `net/picture.ts` : bloc `pic`, quantification, dictionnaire, priorités, disparitions, faisceau, `hist`.
- Les anciens blocs dérivés de l'image. Le compteur de débit (P8).
- Tests : aller-retour d'encodage (erreur ≤ 1 m, ≤ 0,1 m/s), 300 pistes sous 16 Ko, priorités (le lock dans
  chaque bloc), rattrapage.

### RD6 — La console crew affiche l'image (L)

- `TrackStore`, la convergence, l'heure de salle, les retraits.
- Joueurs et soi par `remotes.at()` (9).
- Capteur (le vrai faisceau, IFF perçue) et Partagé (vérité, plein/creux) (1, 10).
- Les actions par id (20) ; les options sauvegardées (21) ; les listes.
- e2e P1 à P4 verts en local.

### RD7 — Les traînées (M)

- Les anneaux côté pilote ; la construction et le rattrapage côté crew.
- Le dessin sur tous les radars et toutes les cartes ; les réglages `radarTrails` et `radarTrailLock` (FR + EN).
- e2e : bascule, longueur, rattrapage à l'arrivée d'un crew.

### RD8 — Les missiles et les leurres (M)

- Les sources `msl` et `cm` (les nôtres, ceux des ennemis, ceux des autres joueurs en match) ; qui voit quoi
  (radar, DAS, EOTS, datalink) ; les paillettes en écho radar, la fausse piste en RWS.
- Les symboles, les traits de cible, le temps avant impact, PITBULL, A-pole et F-pole, LEURRÉ, SPLASH ou RATÉ ;
  le relèvement de l'alerte sur le scope et le DAS.
- Sur tous les écrans du pilote et du crew ; la traînée courte des missiles (`radarTrailMissiles`).
- La salle de démo avec des tirs et des largages.
- Tests : qui voit quoi (unitaire) ; e2e P9 (un AIM-120 sur un drone, un SAM sur nous, des leurres, en solo et
  en match à deux).

### RD9 — Sélectionner et zoomer (M)

- `picture.selected` ; les cibles de clic de chaque écran (scope du HUD, PCD : TSD, FCR, DAS, EOTS ; carte de
  mission) ; le clic avant le regard ; le second clic, l'appui long et le menu.
- La molette sur chaque radar, l'échelle de pas commune, le champ de la caméra protégé (27, 28) ; AUTO.
- Le curseur de désignation à la manette et au HOTAS, les liaisons portée + et − (29) ; ⇧Tab.
- Le crew : sélection, « le clic désigne au pilote », menu par id, pas communs ; les deux sélections montrées de
  part et d'autre.
- e2e P10 et P11 en vrais événements CDP, un par écran (le point du PCD trouvé par `jetPick`, comme
  `f35-pcd.e2e`), et une fausse manette pour le curseur.

### RD8a — Les leurres visibles (S, 2026-10-21)

- Dans la vue 3D : la fusée IR (point très chaud, halo, petite traînée de fumée blanche qui pâlit en 5 s), la gerbe de
  paillettes (nuage de reflets argentés qui s'étale et ralentit), les nôtres comme ceux des cibles et des autres
  joueurs.
- Sur le scope du HUD, le TSD, le FCR (paillettes : écho) et la bande DAS (fusées) : le symbole du §4.
- e2e : un largage vu dans la vue (pixels chauds derrière l'avion) et compté sur chaque écran.

### RD15 — La mini-carte et la route de l'avion (M, 2026-10-21)

- Le panneau de droite (la carte 3D, `flighthud.ts`) affiché en vol F-35 : centré sur l'avion qui suit, zoom à la
  molette et au pincement, taille réglable en tirant le coin haut-gauche (mémorisée).
- Sur toutes les cartes du F-35 (ce panneau, la carte plein écran M, la carte de mission, le TSD, la trace au sol,
  la carte de route ; crew : carte, ND, globe) : **la trace** de l'avion (les dernières minutes, colorée par la
  hauteur) et **la prédiction** de sa trajectoire (virage en cours extrapolé, 30 s à 5 min selon l'échelle, minutée).
- e2e : le panneau redimensionné à la souris (vrais événements CDP), la trace et la prédiction comptées.

### RD10 — La base mondiale des pistes (M)

- **Demande d'accord pour le téléchargement** (OurAirports, noms, tailles).
- `scripts/build-runways.ts`, les tuiles, l'index, les seuils reconstruits ; `src/world/runways.ts` (pur) ; le
  cache PWA.
- Rapprochement avec `SITES`. Crédits (OurAirports, domaine public) dans `CREDITS.md`.
- Tests : LFPG (4 pistes), KJFK, EGLL, un terrain en herbe, une hydrobase, un héliport ; taille des tuiles ;
  requête près de l'antiméridien et des pôles.

### RD11 — Les pistes sur tous les radars et toutes les cartes (L)

- Scope du HUD, TSD, FCR carte sol, carte de mission, trace au sol, carte de route, carte 3D ; crew : radar,
  ND, carte, globe, plan.
- Les ponts des porte-avions qui bougent.
- Le niveau de détail, les couleurs par surface, le terrain choisi en magenta.
- La fiche d'un aéroport au toucher et ses actions. Les bascules.
- Captures : Paris (LFPG, LFPO, LFPB), Mojave, le Ford en mer, sur le TSD, le HUD et toutes les cartes du crew.

### RD12 — Le réseau partout (M)

- Le Link 16 entre joueurs (une piste vue par deux joueurs n'est qu'une).
- Les règles du match (pilote : ses capteurs et son équipe ; crew Partagé : vérité, annoncée dans la salle).
- Rendez-vous entre joueurs au radar.
- e2e deux navigateurs sur kerr-mini : `net-wing-fight`, `net-battle` et un vol en patrouille avec deux crews.

### RD13 — Les pistes utilisables (M, si validé — voir les questions ouvertes)

- `findRunway` et l'ILS sur la base mondiale : un ILS synthétique pour chaque piste revêtue ≥ 1 800 m.
- `nav.add` et le crew qui trouvent n'importe quel ICAO ; METAR de la station la plus proche.

### RD14 — Clôture (M)

- **La campagne e2e** : P1 à P11 sur ce Mac (headless) et kerr-mini (plein écran) ; captures en vol réel (Alpes,
  Mojave, Paris, combat BVR, Ranger vers l'ISS).
- **Les mesures** : A/B contre le commit de départ (Mojave, Alpes), crew sur téléphone.
- **Les docs** : `docs/RADAR.md` et `RADAR.fr.md` ; `F35.md`, `CREW.md`, `BH-API.md` (`__bh.radar`),
  `E2E-CATALOGUE`.
- La suppression des anciens blocs `radar.contacts` et `traffic` du flux. La planche finale.

## Suivi

| phase | état |
|---|---|
| RD0 | **fait** 2026-10-21 ([fiche](progress/radar/RD0.md)) : la sonde `radar-sync`, le point de départ mesuré |
| RD1 | **fait côté crew** 2026-10-21 ([fiche](progress/radar/RD1.md)) : combat à 4 Hz avec vitesses et ids stables, place juste (problème direct WGS84), heure de salle, virages, convergence sans saut, joueurs prédits, événements sous 16 Ko comptés, reconnexion, passage des commandes, missiles et leurres au crew. **Reste** : les constats côté pilote 15, 18, 19 (laissés à RD2) |
| RD8a | **fait** 2026-10-21 ([fiche](progress/radar/RD8a.md)) : les leurres visibles dans la vue et sur tous les radars |
| RD2, RD3, RD9 | **faits** 2026-10-21 ([fiche](progress/radar/RD2-RD3-RD9.md)) : l'image unique, la symbologie commune, la sélection par clic (vue, scope, PCD, crew) |
| RD15 | **fait** 2026-10-21 ([fiche](progress/radar/RD15.md)) : la carte tactique du panneau de droite, trace et prédiction |
| RD10, RD11 | **faits** 2026-10-21 ([RD10](progress/radar/RD10.md), [RD11](progress/radar/RD11.md)) : la base mondiale (OurAirports), les terrains sur tous les radars et cartes |
| RD13 | **fait** 2026-10-21 ([fiche](progress/radar/RD13.md)) : les pistes du monde en 3D aplanies, l'ILS et l'autopilote, partout |
| RD7 | **fait** 2026-10-21 ([fiche](progress/radar/RD7.md)) : les traînées, pilote et crew, trois réglages ; le rattrapage d'un crew qui arrive fait avec RD5 |
| RD8 | **fait** 2026-10-21 ([fiche](progress/radar/RD8.md)) : les missiles (cible, temps, PITBULL, A/F-pole, LEURRÉ, SPLASH/RATÉ) partout, la fausse piste des paillettes, l'autodestruction, solo et salle (repère du tireur), salle de démo |
| RD4 | **fait** 2026-10-21 ([fiche](progress/radar/RD4.md)) : la spec radar, le DAS et l'EOTS capteurs, le TCAS (TA/RA, annonces, Auto-ACAS) pour tous, les capteurs et le scope LVLH des vaisseaux. **Suites** : le radar de nez du Ranger fait 2026-10-21 ([fiche](progress/radar/RD4-ranger-nose.md)), le radar d'atterrissage du Lander fait ([fiche](progress/radar/RD4-lander-lr.md)), l'image spatiale au crew faite ([fiche](progress/radar/RD4-crew-lvlh.md)) |
| RD5, RD6 | **faits** 2026-10-21 ([fiche](progress/radar/RD5-RD6.md)) : l'image compacte au crew (dictionnaire, priorités, disparitions, faisceau, rattrapage des traînées), le magasin de pistes, Capteur et Partagé filtres d'une liste, le vrai faisceau, les ordres par id, les options gardées, la molette par pas |
| RD12 | **fait** 2026-10-21 ([fiche](progress/radar/RD12.md)) : le Link 16 entre F-35 selon les règles du match, les règles annoncées à la salle |
| RD14 | **fait** 2026-10-21 ([fiche](progress/radar/RD14.md)) : la campagne P1–P11, les docs `RADAR.md` et `RADAR.fr.md`, les anciens blocs retirés du flux. **P7** (l'A/B de l'image du pilote contre le commit de départ) **écarté à la demande du 2026-10-21** |

## Risques

- **Le trafic dense** (des centaines d'avions au-dessus du Mojave ou de Paris) : la construction de l'image et
  les traînées doivent tenir 0,15 ms. Parade : tableaux typés, pas d'objet par image, l'historique à 1 point
  par mesure ; mesuré dès RD2.
- **Les 16 Ko par événement** : au-delà de ≈ 300 pistes, le tour de rôle s'allonge (chaque piste à 1 Hz au
  moins, puis 0,5 Hz pour les plus lointaines). Le dictionnaire de noms ne passe jamais avec les positions.
- **La qualité d'OurAirports** : seuils manquants ou faux sur les petits terrains, pistes fermées encore
  listées. Parade : la reconstruction depuis le numéro de piste, le marquage « approximatif », un test sur un
  échantillon contre OSM.
- **L'indépendance du bundle crew** (`tests/crew.test.ts:115`) : `radar/symbols.ts`, `world/runways.ts`,
  `net/picture.ts` doivent rester purs (aucun import du simulateur).
- **La branche vaisseaux** en parallèle : `src/radar/*` est neuf, les écrans vaisseaux restent à elle ; ordre
  de fusion au §11.
- **Le clic contre le regard** : dans le cockpit, la souris tourne la tête. Parade : un clic est un appui sans
  glisser (< 4 px), et seul un clic sur un symbole (ou dans le disque du scope, ou sur l'écran du PCD) est pris par
  le radar ; partout ailleurs, rien ne change.
- **La molette et le cockpit** : le bouton du cockpit sous le pointeur garde la priorité, puis le radar, puis le
  champ de la caméra.
- **Le réalisme contre la lisibilité** : un radar vrai perd des contacts (notch, relief). Les états (prolongé,
  mémoire) et les traînées aident à suivre ; l'assistance (questions ouvertes) peut tout montrer.

## Questions encore ouvertes (à trancher en cours de route)

1. **Les écrans du pilote en assistance** : seulement ses capteurs (réaliste, proposé par défaut), ou une option
   « image complète » (tout, comme le crew Partagé) pour les niveaux d'assistance élevés ?
2. **Les pistes utilisables (RD13)** : un ILS synthétique et l'autopilote d'approche sur toutes les pistes
   revêtues ≥ 1 800 m, ou seulement les cartes ?
3. **Les pistes en 3D dans le monde** : aujourd'hui seules les 8 `SITES` existent dans le rendu. Les autres
   restent sur les cartes (proposé), le rendu 3D des pistes du monde étant un autre plan ?
4. **Un AWACS** (E-7 fictif) qui partagerait son image par datalink dans certaines missions ?
5. **Les traînées par défaut** : `off` (proposé) ou `short` ?
6. **Les héliports et hydrobases** : affichés sous 20 km (proposé) ou jamais par défaut ?
7. **Le clic sur une piste radar** : il verrouille tout de suite (proposé : c'est « sélectionner la cible »), ou il
   sélectionne seulement, le lock demandant un second clic ?
8. **« Le clic du crew désigne au pilote »** activé par défaut quand le pilote ouvre ses actions (proposé), ou
   désactivé par défaut ?
9. **Les paillettes en fausse piste** (RWS) : réaliste (proposé), ou trop déroutant hors du niveau d'assistance
   « réaliste » ?
