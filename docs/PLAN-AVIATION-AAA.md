# Plan — l'aviation AAA : le vrai F-35, le combat, la patrouille, le ciel et la mer vivants

*Écrit le 2026-10-15, après la formation en réseau (`492c3b8`). Branche de travail : `reseau` (== `main`).*

Demande (2026-10-15), « gros plan AAA » :
- le F-35 **réagit comme le vrai** et fait les mêmes manœuvres (looping, vrilles…) ;
- **changer de formation, donner des ordres**, créer des **plans de vol**, des **missions**, une **carte de mission**
  et un **radar** ;
- **radar toujours actif**, **trajectoire d'interception** ;
- pour le canon, **un indicateur de où tirer** selon où sera la cible ;
- **vie aérienne et maritime** : aisstream.io (clé dans `.env`), OpenSky et adsb.lol (avions et historique), le
  porte-avions et les modèles de `assets/porte-avion` ;
- **une mer hyper-réaliste** vue en vol ;
- missions **d'escorte, de protection, de destruction d'avions** (réels ou simulés), **de bateaux**,
  **d'appontage** ;
- **pilotes automatiques avancés, assistances, manuel** ;
- **TARS sait tout** de l'avion, du vol, et assiste le pilote ;
- **en solo comme en réseau** ;
- pour finir : des **scènes et missions/défis aux vues exceptionnelles** (éclipses, Lune, canyons, paysages,
  missions conjointes en équipes).

## Décisions de l'utilisateur

| Sujet | Décision |
|---|---|
| Trafic réel comme cible | **Les vols et navires réels, avec leur vrai indicatif, sont des cibles possibles**, et des **scénarios où un vol ou un navire réel se met à faire quelque chose de simulé** (détournement, intrus, contrebandier) pour une mission ou un défi |
| Vrilles et loi de pilotage | **La loi du vrai F-35** par défaut (50° d'incidence, anti-vrille, Auto-GCAS) **+ un mode « commandes directes »** sans calculateur pour décrocher, vriller et en sortir |
| Porte-avions | **Le Kiev** (appontage vertical, décollage court) **+ catapulte et brins d'arrêt « le mieux possible »** sur un grand porte-avions : le Gerald Ford et le Charles de Gaulle fournis, analysés ci-dessous |
| Ordre des phases | **Le vol réel d'abord** (l'ordre proposé) |

Reprises des plans précédents :
- **FR + EN** pour toute l'interface (`src/i18n/fr-*.ts`, le test `i18n` en garde).
- **Un commit et une fiche d'avancement par étape**, capture à l'appui ; `bunx biome ci .` avant chaque push.
- **Le solo reste entier** : aucune connexion externe sans action du joueur (trafic réel : un réglage, désactivé
  hors ligne).
- **Les clés ne vont jamais au navigateur** : relais serveur, comme Deepgram (`server.ts`) ; en production, les
  clés dans l'environnement de la pile Portainer.
- **Mesurer** : chaque étape a son test (unitaire, e2e sur kerr-mini, ou mesure GPU `trace-ab`).

## État du code (inventaire du 2026-10-15, `492c3b8`)

### Ce qui existe et sert
- **Le vol** est un corps rigide à 6 degrés de liberté (`aero.ts` `aeroForces`, `flightair.ts`, `pilot.ts`) : un
  modèle **géométrique**, pas des tables de coefficients. Deux demi-ailes ont chacune leur incidence (une seule peut
  décrocher), il y a la traînée d'onde transsonique, l'effet de sol, les volets et l'aérofrein, les moments
  amortis. Le F-35 (`vessels.ts`) : 20,9 t, aile 42,7 m², allongement 2,68, décrochage à 0,45 rad, limite
  structurale 10,5 g, `fbw { rates, gMax 7, gMin −3, alphaMax 0,47 }`. Le moteur F135 (`f35/engine.ts`) : 120 kN
  sec, 176 kN avec postcombustion, poussée variant avec la densité et le Mach, montée en régime en 1,1 s. Le STOVL
  est complet (`f35/stovl.ts`).
- **La loi de pilotage** (`pilot.ts`, la « plane law ») : le manche commande des vitesses angulaires ; lâché, elle
  tient la pente et l'inclinaison ; incidence et facteur de charge bornés ; dérapage annulé. Looping, vol dos et
  −3 g passent.
- **Le combat** (`game/combat.ts` `CombatWorld`) : AIM-120, AIM-9X, R-73, SAM (navigation proportionnelle,
  leurres), canon GAU-22, JDAM ; drones, chasseurs, SAM, camions, bunkers ; une IA de chasse (patrouille,
  engagement, défense, canon à 900 m) ; un collimateur canon au point de tir calculé (`gunLead`) ; domaine de tir
  et SHOOT ; le radar de combat (±60°, portée selon la SER) ; l'écran radar (`drawRadar`).
- **Les plans de vol** (`game/flightplan.ts`, ⇧M) : LNAV/VNAV, carburant par branche, bingo. Les modes ALT, HDG,
  A/T, AB. **La formation** sur un joueur (`game/formation.ts`).
- **Les défis** (`game/challenges.ts`) : portes, atterrissage, vertical, aéro ; les scénarios de combat
  (`game/scenarios.ts`) ; **les matchs en réseau** (`game/match.ts` : coopération, chacun pour soi, équipes,
  course, atterrissage).
- **La mer** (`trace.wgsl` `seaWaves`/`seaShade`) : 12 trains de houle sinusoïdaux (normales seulement, pas de
  géométrie), reflet du soleil Cox–Munk avec masquage de Smith, Fresnel, ciel réfléchi, écume de Monahan, reflets
  tracés du relief (`waterMirror`).
- **TARS** (`ai/game-tools.ts`) : une soixantaine d'outils, dont `f35`, `autopilot`, `flight_plan`, `hold`,
  `controls`, `memory`, `save_skill`.
- **Les modèles** passent par une conversion hors ligne (`scripts/build-f35.py` avec Blender → `.bin`, textures
  KTX2) puis sont rastérisés et testés en profondeur contre l'image tracée (`ship.ts`, `ship.wgsl`, 24 instances
  dont 8 F-35 animés).

### Les manques
- **Pas de haute incidence réaliste** : ni tables de moments post-décrochage, ni couplage roulis/lacet, ni perte de
  stabilité de route, ni vrille, ni super-décrochage. **Pas de loi directe** (commandes sans calculateur) : le mode
  « fusée » dans l'air n'a pas de gouvernes.
- **Radar** : seulement pendant un combat ; le masquage par le relief est annoncé mais pas codé ; pas de modes
  (RWS/TWS/STT), pas d'IFF, pas de liaison de données ; **aucun guidage d'interception**.
- **Canon** : un seul point prédit, sans l'accélération de la cible, sans entonnoir de traçantes ni LCOS.
- **Les cibles au sol n'ont pas de modèle 3D** (des cases sur le HUD) ; l'IA vole en point matériel, pas avec le
  modèle de vol.
- **Aucun trafic** (ni avions, ni bateaux) ; aucun accès à OpenSky, ADS-B ou AIS.
- **Mer** : pas de spectre (FFT/JONSWAP), pas de géométrie, pas de sillages ; prévu dans `PLAN-MONDE-VIVANT-AAA`
  B1, jamais commencé.
- **Pas de porte-avions**, et le train (`gear.ts`, `scenery-contact.ts`) suppose un sol immobile.
- **Missions** : six briefings spatiaux sans score ; **ni carte de mission, ni éditeur, ni campagne**.
- **Approches** : celle du vaisseau (pente de 18°, MLS) ; **pas d'ILS à 3° pour le F-35, pas d'approche de
  porte-avions**.
- **TARS** se présente encore comme copilote spatial ; **aucune base de connaissances** aéronautique.
- **Pas d'ailiers IA** : la formation ne suit qu'un joueur humain.

### Les données réelles (vérifiées le 2026-10-15)
- **adsb.lol** : `api.adsb.lol/v2/point/{lat}/{lon}/{rayon NM}`, **sans clé**, réponse riche (immatriculation,
  type OACI, vol, cap, vitesses sol et air, roulis, altitudes baro et géométrique, taux de montée, consignes
  pilote automatique). **Pas d'en-tête CORS** : relais serveur. Historique : dumps quotidiens `globe_history`
  (GitHub, ODbL), pas d'API.
- **OpenSky** : 400 crédits/jour en anonyme, 4 000 avec un compte ; **OAuth2** (identifiants client, jetons de
  30 min) ; `/states/all` par boîte (1 à 4 crédits selon la surface) ; `/tracks/all` jusqu'à 30 jours
  (expérimental) ; `/flights/*` la veille au plus tôt.
- **aisstream.io** : `wss://stream.aisstream.io/v0/stream`, abonnement par boîtes géographiques ; **interdit
  depuis le navigateur** ; 3 connexions par compte ; une mise à jour d'abonnement par seconde au plus ; pas de
  rejeu.
- **Les modèles fournis** (`assets/porte-avion`, non suivis par git) :
  - le **porte-aéronefs de classe Kiev** (GLB de 7,6 Mo, 39 000 triangles, 7 textures, ~40 m dans le fichier :
    à mettre à l'échelle des 273 m réels). C'était un navire **à décollage court et appontage vertical** (ses
    Yak-38 sont dans les textures) : **le terrain naturel du F-35B** ;
  - un **A320** (GLB), un **CRJ-900**, un **porte-conteneurs** (FBX, à convertir) ;
  - le **Gerald Ford** (FBX, 2 700 triangles, une texture 2048², ~53 unités de long → 333 m) et le **Charles de
    Gaulle** (FBX, 3 400 triangles, une texture 2048², ~47 unités → 261 m). Des modèles de jeu mobile : pont
    plat, îlot très simplifié, coque peinte blanc et rouge (non réaliste). **Mais leurs pièces sont séparées** :
    4 catapultes, 3 ascenseurs et le hangar sur le Ford ; 2 brins d'arrêt, la tour, les ascenseurs et un
    « aimer » (le miroir d'appontage) sur le Charles de Gaulle, et la piste oblique est peinte sur les deux.
    **Verdict : bons pour le jeu (le pont, les catapultes et les brins sont aux bons endroits), insuffisants de
    près pour l'AAA.** Le plan les complète (M2) ; un modèle détaillé (100 000 triangles et plus) pourra les
    remplacer sans rien changer d'autre.

## Les phases

Chaque étape : ce qu'elle fait, **ce qui prouve qu'elle est finie**, en solo **et** en réseau quand c'est
pertinent.

### V — Le vrai F-35 (vol, manœuvres, loi de pilotage)

- **V1. Le domaine de vol mesuré.** *Fait le 2026-10-15 — [fiche](progress/aviation/V1.md) : traînée induite, poussée stratosphérique et consommation calées, deux écarts laissés à V2 et V3.* Un banc (`tests/f35-envelope.test.ts`) qui mesure le virage soutenu et
  instantané, le taux de roulis, la montée, l'accélération de Mach 0,8 à 1,2, le plafond, la vitesse maxi, la
  finesse et l'incidence maxi, comparés aux valeurs publiées du F-35B, avec l'écart de chacune.
  *Fini quand* la table d'écarts est écrite et que chaque valeur est à ±10 % (ou l'écart expliqué).
- **V2. La haute incidence.** *Fait le 2026-10-15 — [fiche](progress/aviation/V2.md) : 50° tenus sur la loi, vrille et super-décrochage sans calculateur, sortie en lâchant ; la loi directe et le « pedal turn » faits avec.* Au modèle géométrique s'ajoutent les effets connus du vol à grande incidence :
  - le moment de tangage au-delà du décrochage (cabré, puis piqué) ;
  - la perte de la stabilité de route et le couplage roulis/lacet (le lacet induit par l'aileron) ;
  - l'autorotation quand une aile décroche avant l'autre ;
  - l'amortissement de rotation qui change avec l'incidence ;
  - le tremblement aux approches du décrochage.

  Le F-35 réel tient **50° d'incidence** sous contrôle.
  *Fini quand* une vrille entretenue et un super-décrochage sont possibles **sans** le calculateur, et que le
  calculateur les empêche.
- **V3. Les lois de pilotage du vrai F-35.** *Fait le 2026-10-15 — [fiche](progress/aviation/V3.md) : le manche commande un facteur de charge (7 g en 0,4 s), la pente capturée une fois stabilisée, 4 g train sorti ; le domaine de vol sans écart.*
  - **Normale** : « carefree » ; limites de facteur de charge et d'incidence, résistance au départ en vrille,
    virage coordonné.
  - **Approche** : vitesse/incidence tenues, trajectoire au manche.
  - **STOVL** : celle qui existe.
  - **Commandes directes** : sans calculateur, gouvernes au manche, palonnier libre. Ce n'est pas le vrai
    F-35, mais c'est ce qui rend vrilles et figures « interdites » possibles. Le choix dépend de la décision
    « Vrilles ».
  - Sortie de vrille : procédure réelle, et la récupération automatique quand le calculateur est actif.

  *Fini quand* chaque loi a son test de réponse (échelon de manche : dépassement, temps de montée, limites
  tenues).
- **V4. Les figures.** *Fait le 2026-10-15 — [fiche](progress/aviation/V4.md) : dix figures démontrées, jugées et enseignées, la boîte de voltige ; démonstrations notées de 18,7 à 20/20.*
  - La bibliothèque : looping, Immelmann, split-S, tonneau barriqué, tonneau rapide, huit cubain, passage à
    haute incidence, virage de Herbst (« J-turn »), vrille et sortie, glissade sur la queue, vol dos.
  - Chacune est **jugée** (sa trace comparée à la figure idéale : ronde, symétrique, cap de sortie, altitude
    perdue), **démontrée** par le pilote automatique (TARS peut la voler devant vous) et **enseignée** (les
    repères au HUD, la voix).
  - Un défi « boîte de voltige ».

  *Fini quand* le pilote automatique vole chaque figure et que le juge note 18/20 ou plus sa propre
  démonstration.
- **V5. Sentir l'avion.** *Fait le 2026-10-15 — [fiche](progress/aviation/V5.md) : corps du pilote (fatigue, voile noir, G-LOC, voile rouge enfin), respiration au masque, grondement du tremblement, « Bingo fuel », « Angle of attack », manette ; le maintien d'inclinaison corrigé à la verticale.*
  - Tremblement, voile gris et voile noir aux g soutenus (sobres, à régler) ; la respiration du pilote
    (reportée en F7).
  - Les alarmes vocales du F-35 (« PULL UP », alarmes d'altitude et de vitesse).
  - Le bruit de l'écoulement en haute incidence ; la vibration de la manette.

### C — Capteurs et combat

- **C1. Le radar toujours actif.** L'AN/APG-81 fonctionne hors combat aussi : trafic réel et simulé, joueurs,
  ailiers, bateaux.
  - Les modes : recherche (RWS), poursuite pendant le balayage (TWS), verrouillage (STT).
  - Le masquage par le relief (codé, enfin), l'encoche Doppler.
  - **L'IFF** : ami, neutre, inconnu, hostile ; la couleur et le symbole suivent.
  - **La liaison de données** : les contacts partagés entre ailiers, IA et joueurs (la MADL).
  - L'écran radar et le **TSD du PCD** (la situation tactique sur l'écran panoramique).

  *Fini quand* un avion de ligne réel apparaît en neutre, disparaît derrière une crête et réapparaît.
  *Fait le 2026-10-15 — [fiche](progress/aviation/C1.md) : balayage, portée selon la taille, horizon, relief, encoche, RWS/TWS/STT, IFF, liaison ; le combat nourri par le radar ; portée HUD unifiée, boîte de verrouillage, TSD. Le critère « avion de ligne réel » attend la source du trafic (phase T).*
- **C2. La trajectoire d'interception.**
  - Pour la cible choisie : le **cap de collision** (et le cap pour passer derrière elle à une distance donnée)
    au HUD, la poursuite pure, en avance ou en retard, le temps avant la rencontre, l'angle d'aspect.
  - Un **mode de pilote automatique « INTERCEPT »** qui vole le rendez-vous puis **se met en patrouille** sur la
    cible (la loi de formation : 300 m derrière, côté gauche, comme une vraie interception de police du ciel),
    pour l'identifier à vue.

  *Fini quand* l'interception d'un avion de ligne réel à 80 km se fait seule jusqu'à la patrouille à 300 m.
  *Fait le 2026-10-15 — [fiche](progress/aviation/C2.md) : repères au HUD (INTC, TTI, AA, poursuite, HCA, repère de pilotage) ; INTERCEPT (⇧Tab) : conversion par l'arrière, jonction et patrouille 300 m derrière à gauche par la loi de formation ; 80 km de face → patrouille en 309 s, tenue à 9 m ; un drone en orbite aussi. L'avion de ligne réel attend la phase T.*
- **C3. Où tirer.**
  - Au canon, le collimateur **calcule la position future de la cible** avec sa vitesse **et son
    accélération** (son virage), le temps de vol des obus, leur chute et la vitesse de l'avion.
  - S'affichent : un réticule sur la cible future, **l'entonnoir des traçantes** (ce que décrivent les obus
    tirés maintenant), une barre de distance, « IN RANGE », et les traçantes à l'écran.

  *Fini quand*, sur une cible qui vire à 5 g, le taux de coups au but en visant le réticule dépasse 60 % au
  banc (le tireur parfait).
  *Fait le 2026-10-15 — [fiche](progress/aviation/C3.md) : position future par la vitesse et l'accélération, temps de vol et visée résolus avec la balistique du combat ; réticule, barre de distance, IN RANGE, entonnoir, traçantes ; au banc à 5 g, avec 5 mrad d'erreur de visée : 100 / 100 / 86 % à 400 / 700 / 1 000 m (l'ancien : 100 / 9 / 0 %).*
- **C4. L'IA vole le vrai avion.** Les chasseurs IA sont pilotés par le même modèle de vol et la même loi que le
  joueur, au lieu d'un point matériel.
  - Combat tournoyant offensif et défensif : ciseaux, yo-yo, gestion de l'énergie.
  - Trois niveaux de compétence.
  - Les mêmes contraintes (carburant, g), les mêmes leurres.
- **C5. Les cibles réelles en 3D.** Des modèles pour les camions, les SAM, **les navires** (frégates, patrouilleurs,
  cargos), avec leurs états de dégât : feu, fumée, gîte, naufrage. Les cases du HUD deviennent des objets visibles.
- **C6. Les armes de la mer et les soutes.** Un missile antinavire (de type JSM), des bombes guidées sur cible
  mobile, l'animation des trappes de soute (un manque de F10), les effets d'impact sur l'eau.

### F — La patrouille : formations, ordres, ailiers

- **F1. Les formations.** Échelon droite et gauche, « fingertip », ligne de front, colonne (« trail »), patrouille
  de combat étalée, triangle, losange à 4. Chaque place a son numéro ; un tableau de postes par formation, avec
  l'écartement (serré, normal, large). La loi de formation existante vole chaque poste.
  *Fait le 2026-10-15 — [fiche](progress/aviation/F1.md) : 8 formations, postes 2–4, 3 écartements, réglages et Formation du salon ; loi de formation intégrée près du poste (1 m en air calme, 3,6 m en turbulence légère).*
- **F2. Les ordres du leader**, par une roue (une touche), à la voix (TARS), au HOTAS :
  - rejoindre, changer de formation, serrer, s'écarter ;
  - attaquer ma cible, engager les hostiles, me couvrir ;
  - tenir ici (un hippodrome), rentrer à la base, dégagement à gauche ou à droite.

  En réseau, l'ordre s'affiche chez le joueur humain (et s'exécute s'il est en formation).

  *Fait le 2026-10-15 — [fiche](progress/aviation/F2.md) : 11 ordres et leurs appels radio ; roue (Tab › Patrouille, action F13 réassignable/HOTAS), TARS (outil et hors ligne) ; reçus en réseau, exécutés en formation (forme, écartement, dégagement, attente étagée, retour base, rejoindre) ; ralliement lointain par la course de C2.*
- **F3. Les ailiers IA**, en solo comme en réseau (l'hôte les fait voler).
  - Un à trois F-35 qui volent avec le vrai modèle, tiennent leur poste et obéissent aux ordres.
  - Ils annoncent leurs contacts, se battent (C4) et peuvent être perdus.

  *Fait le 2026-10-15 — [fiche](progress/aviation/F3.md) : avion IA aux forces du vrai F-35 (aero.ts, F135) volé à la manière de la loi ; 1–3 ailiers en formation, tous les ordres, combat (AIM-120/9X, abattus possibles), radio, liaison, réseau (l'hôte les fait voler) ; losange tenu à 1,3 m, 2 drones abattus.*
- **F4. Les manœuvres de patrouille.** Décollage et atterrissage en patrouille, virages en formation (« cross-under »),
  changements de formation fluides, un passage en losange pour les spectateurs.
  *Fait le 2026-10-15 — [fiche](progress/aviation/F4.md) : transitions fluides (dessous et derrière), virages croisés des formations tactiques, décollage et atterrissage en patrouille (avion IA au sol), passage en losange avec la caméra de passage.*

### T — Le ciel et la mer vivants (trafic réel et simulé)

- **T1. Le relais du trafic.**
  - En dev, `server.ts` ; en production, le serveur des salles (`stream.samlepirate.org`), clés dans
    l'environnement de la pile : `AISSTREAM_API_KEY`, `OPENSKY_CLIENT_ID` et `OPENSKY_CLIENT_SECRET`.
  - adsb.lol (sans clé) pour le direct ; OpenSky pour l'historique et en secours.
  - aisstream : **une seule connexion** serveur, l'abonnement suivant les zones des joueurs actifs ; les navires
    poussés aux pages par WebSocket.
  - Cache, quotas respectés, attribution (ODbL, conditions d'OpenSky et d'aisstream).
  - **Désactivable**, et absent hors ligne.

  *Fait le 2026-10-15 — [fiche](progress/aviation/T1.md) : relais (dev et serveur des salles) adsb.lol → OpenSky (OAuth2), aisstream en une connexion qui suit les zones ; flux de la page (5 s/10 s), désactivable, crédits ; 49 avions réels au-dessus de Paris en jeu. Clés à mettre dans la pile Portainer.*
- **T2. Les avions dans le ciel.**
  - Les modèles A320 et CRJ-900 (et des variantes à l'échelle pour 737, 777, A350, jets d'affaires, avions
    légers, hélicoptères), avec leurs feux (navigation, anticollision, atterrissage) et des traînées de
    condensation selon l'air (`contrails.ts`).
  - Le mouvement est interpolé entre deux positions avec la trajectoire, la vitesse et le taux de virage, sans
    à-coups.
  - Des niveaux de détail jusqu'au point lumineux.
  - Le trafic au sol des aéroports : les avions qui roulent, à partir des positions ADS-B au sol.

  *Fini quand* on vole en patrouille avec un avion de ligne réel au-dessus de Paris, son immatriculation lue
  sur l'étiquette.

  *Fait le 2026-10-15 — [fiche](progress/aviation/T2.md) : A320 et CRJ-900 (chaque type à sa longueur), feux aux saumons, traînées ; le trafic montré une minute en différé sur son vol reconstruit (vitesse, route, vario lissés puis intégrés ; virage coordonné, incidence par la portance) ; en patrouille avec DJT101 F-HBUZ (A321neo réel) au-dessus de Paris, tenu à 10,8 m. Écarts : pas de roulage au sol, une livrée par modèle.*
- **T3. Les bateaux sur la mer.**
  - Le porte-conteneurs converti, plus des variantes (pétrolier, ferry, chalutier, voilier), à la taille
    donnée par l'AIS.
  - Leurs **sillages** (le sillage de Kelvin dans le shader de la mer), leurs feux la nuit.
  - L'interpolation entre deux positions (route et vitesse fond).

  *Fait le 2026-10-15 — [fiche](progress/aviation/T3.md) : porte-conteneurs fourni (proue trouvée par sa flottaison) et pétrolier, ferry/chalutier/voilier dessinés, à la taille AIS ; une minute en différé sur leur route lissée, la proue sur le cap vrai ; roulis/tangage/pilonnement ; sillage de Kelvin, sillage turbulent et vague d'étrave dans le shader de la mer ; feux de navigation la nuit, étiquettes, radar. Relais de production sans ses clés (Portainer).*
- **T4. Le trafic simulé et l'histoire.**
  - Là où rien n'est reçu (hors ligne, en plein océan, une autre date), un trafic plausible : les airways entre
    aéroports, les rails de navigation.
  - **Les rejeux** : voler dans le trafic réel d'une journée passée. Les traces OpenSky sur 30 jours ; les dumps
    adsb.lol pour les jours anciens, préparés hors ligne pour une région et une heure.
- **T5. Vivre avec le trafic.** Le trafic sur le radar (en neutre), des annonces de type contrôle (« trafic à
  2 heures, 5 nautiques »), l'alarme anticollision, l'évitement par les IA, la turbulence de sillage derrière un
  gros porteur.

### M — La mer et le porte-avions

- **M1. La mer hyper-réaliste en vol** (reprend `PLAN-MONDE-VIVANT-AAA` B1).
  - Un **spectre de houle JONSWAP** en FFT (Tessendorf), en cascades (de la houle de 300 m aux vaguelettes de
    5 cm), au lieu des 12 sinusoïdes.
  - **L'état de la mer réel** : hauteur, période, direction de la houle et de la mer du vent, par l'API marine
    d'Open-Meteo (sans clé).
  - **Une géométrie** près de l'avion pour le rase-mottes.
  - L'écume par le jacobien (les crêtes qui déferlent), les embruns, la lumière qui traverse les crêtes, les
    ombres des nuages, le scintillement du soleil, la couleur selon la profondeur (GEBCO) et les sillages.

  *Fini quand* une comparaison côte à côte avec des photos de référence (mer calme, force 5, tempête, contre-jour)
  est jugée bonne, et que le coût GPU est mesuré sur M1 Max et sur le mini.

  *Fait le 2026-10-15 — [fiche](progress/aviation/M1.md) : JONSWAP mer du vent + houle (Open-Meteo marine, sinon le vent) en trois cascades FFT 256² sur le GPU, moutons par le jacobien, relief des vagues près de l'avion, ciel réel reflété (sonde), empreinte de pixel de la mer corrigée ; coût mesuré (passe FFT 0,33 ms M1 Max, 1,71 ms M1). Reste : ton jugement sur les quatre mers, la couleur selon la profondeur (relief sans bathymétrie).*
- **M2. Les porte-avions.**
  - **Le Kiev** à l'échelle (273 m), tel quel (39 000 triangles, détaillé ; les Yak-38 et hélicoptères posés
    sur le pont gardés comme décor ou retirés, selon leurs maillages).
  - **Le Gerald Ford** (333 m, catapultes et brins), **mis à niveau** : coque repeinte en gris marine, un pont
    à nous en haute résolution (antidérapant, marquages, traces, usure), les **4 brins d'arrêt** modélisés et
    simulés, les **déflecteurs de jet** des catapultes, l'**IFLOLS** (le « meatball », ses feux et ses barres
    de référence), les feux de pont, un îlot enrichi. Le Charles de Gaulle (261 m) suit la même mise à niveau
    pour un second pont.
  - Chacun fait route **face au vent** à 25–30 nœuds, et **tangue, roule et pilonne** selon la mer.
  - Le pont est une **plate-forme mobile** : contact du train, collision, repos sur le pont, le repère qui
    bouge (un manque à combler dans `gear.ts`).
  - Les feux de pont, les marques d'appontage, son escorte (frégates).
  - Il est placé sur la mer depuis la carte ou la mission ; en réseau, sa route est déterministe sur l'horloge de
    la salle.

  *Fait le 2026-10-15 — [fiche](progress/aviation/M2.md) : le Ford (ton modèle), le Kiev et l'Implacable à l'échelle, leurs ponts au mètre, une route sur l'horloge (partagée en salle), face au vent, tangage et roulis selon la mer, deux frégates d'escorte, radar ami, IFLOLS et feux de nuit ; le pont plate-forme mobile (avion porté sans dérive ni vrille, train sur le pont en marche) ; ombres (seconde carte : l'avion sur le pont, l'îlot, la coque sur la mer) et reflets dans la mer (l'avion aussi, bas au-dessus de l'eau) ; changer l'heure ne déplace plus l'avion ni le porte-avions. Reste : le Charles de Gaulle, brins et catapultes (M3), le placement depuis la carte ou la mission.*
- **M3. L'appontage.**
  - Le F-35B : approche par l'arrière, décélération jusqu'au **stationnaire à côté du pont**, translation
    au-dessus de la tache, descente verticale.
  - Le décollage court (STO) sur le pont.
  - Le pilote automatique d'appontage, les repères au HUD, un **officier d'appontage** (une voix qui guide et
    note).
  - **Catapulte et brins d'arrêt** (sur le Ford et le Charles de Gaulle) : la variante **F-35C** (aile plus
    grande, crosse d'appontage) ; l'accrochage à la catapulte, le lancement (0 à 70 m/s en 2 s), l'appontage
    à 3,5° sur le « meatball », le brin accroché par la crosse et l'arrêt en 100 m, le « bolter » (brin raté, on
    remet les gaz), l'officier d'appontage qui note chaque passage (OK, Fair, No grade, Cut) comme sur les vrais
    porte-avions.

  *Fini quand* le pilote automatique se pose sur le pont qui tangue, et que les qualifications de jour, de nuit et
  par mer forte ont leur note.

  *M3a fait le 2026-10-15 — [fiche](progress/aviation/M3a.md) : l'appontage vertical automatique du F-35B (point d'entrée, remontée le long de bâbord, conversion, stationnaire le long du bord, traversée, descente sur la tache d'un pont qui tangue), l'officier d'appontage à la radio et sa note, la tache entourée de feux ; posé à 0,01–0,07 m de la tache sur les trois porte-avions, par mer de 1,5 à 3 m.*

  *M3b fait le 2026-10-15 — [fiche](progress/aviation/M3b.md) : le décollage court automatique du F-35B (conversion freins serrés, roulage tuyère vers l'arrière, rotation, transition) depuis un couloir dégagé de chaque pont — 151 m sur le Ford réservoirs pleins —, ou vertical s'il est assez léger quand le pont est trop court, refusé sinon.*

  *M3c fait le 2026-10-15 — [fiche](progress/aviation/M3c.md) : la variante F-35C (aile de 62 m², 9 t de carburant, crosse) ; la catapulte avant du Ford (72 m/s par rapport au pont, montée tenue au lâcher) ; les trois brins pris par la crosse, l'arrêt en une centaine de mètres moteur plein gaz, le bolter ; l'approche automatique alignée sur la piste oblique qui bouge et sur le plan de 3,5° stabilisé ; l'officier d'appontage qui guide et note chaque passage (OK souligné, OK, Passable, B, Non noté, WO, Coupé) — brin 2, OK, dans le navigateur.*

  *M3d fait le 2026-10-15 — **M3 fini** — [fiche](progress/aviation/M3d.md) : les qualifications de jour, de nuit et par mer forte (houle de 4,4 m imposée), quatre passages notés chacune, enchaînés par le pilote automatique (catapulte ou décollage court, tour, approche, ravitaillement moteur tournant) ou volés par le pilote ; qualifiés : F-35C 3,50 / 3,50 / 3,75, F-35B 4,00.*

### P — Plans de vol, missions, carte

- **P1. Le moteur de missions.** Une mission est **une donnée** (JSON). Elle peut prendre **un vol ou un navire
  réel** et le faire **dévier** par un comportement simulé (il quitte sa route, coupe son transpondeur, devient
  hostile) :
  - le briefing ;
  - les objectifs : points de passage, cibles, escorter, protéger, se poser, chronomètre ;
  - les déclencheurs ;
  - ce qui apparaît : IA, navires, trafic réel filtré, porte-avions ;
  - la météo et l'heure ;
  - les conditions de succès et d'échec, le score, et le débriefing (le rapport de vol existe).

  Il marche en solo et **en équipes** en réseau.

  *P1 fait le 2026-10-15 — [fiche](progress/aviation/P1.md) : les missions en JSON (briefing, départ, heure, météo, unités, objectifs atteindre/détruire/escorter/protéger/identifier/se poser, déclencheurs, fin, débriefing noté sur 20) ; un vol réel repris au trafic et dévié (transpondeur coupé, nouvelle route, camp changé) ; partagées en salon ; trois missions fournies (Renegade sur les Alpes, Frappe en Corse depuis le Ford, Escorte jusqu'à Ajaccio).*
- **P2. La carte de mission.** Sur la carte (2D et 3D) : la route, les zones des menaces (cercles des SAM), les
  cibles, les amis, le porte-avions, le trafic. On y glisse les points ; on y clique « voler vers ». La même carte
  est sur le TSD du cockpit.
- **P3. Créer ses missions.** Un éditeur dans le jeu (poser les objectifs sur la carte, régler les conditions),
  partageable par lien ; et **TARS crée une mission à la voix** (« une escorte de l'A320 AFR123 jusqu'à
  Nice »).
- **P4. Les procédures.**
  - L'**ILS à 3°** pour le F-35, avec ses repères ; les départs et arrivées ; l'attente en hippodrome.
  - L'approche du porte-avions (cas I, II, III).
  - Les hippodromes de ravitaillement, si le ravitaillement en vol entre au plan (S).

### A — Pilotes automatiques avancés, assistances, manuel

- **A1. Les niveaux d'assistance.**
  - **Manuel** : la loi directe, si la décision l'ouvre.
  - **Réaliste** : le vrai F-35, sa loi et ses limites.
  - **Assisté** : trim automatique, gaz automatiques, protection contre le décrochage et le sol, retour au vol
    stable d'une touche.
  - **Débutant** : on vise, l'avion y va.
- **A2. Les protections du vrai F-35.** L'**Auto-GCAS** (la ressource automatique avant le sol, qui existe sur
  l'avion) et l'**Auto-ACAS** (l'évitement des collisions en vol).
- **A3. Les nouveaux modes.**
  - Approche ILS, appontage vertical, interception, formation (fait), orbite ou hippodrome sur un point.
  - **Suivi de terrain** (vol à très basse altitude), rendez-vous avec un ravitailleur, démonstration de
    voltige, « voler vers le point cliqué ».
- **A4. L'instructeur.** Pendant chaque approche et chaque figure, les écarts annoncés au bon moment (« trop
  haut », « vitesse », « incidence »), puis un débriefing chiffré.

### I — TARS aviateur

- **I1. La base de connaissances.** Des pages écrites (FR + EN, `docs/aviation/`) indexées pour TARS, qu'il
  cherche et lit par un outil `knowledge` :
  - les systèmes, limites et procédures du F-35 ;
  - le pilotage de base ;
  - l'énergie ;
  - le combat tournoyant ;
  - la patrouille ;
  - l'appontage ;
  - l'ILS ;
  - les urgences ;
  - le radar ;
  - les armes ;
  - le trafic.

  Son prompt dit enfin qu'il est aussi **copilote de chasse**.
- **I2. Les outils.**
  - **Trafic** : « quels avions autour ? », « intercepte l'AFR123 ».
  - **Missions** : créer, lancer, modifier.
  - **Patrouille** : ordres, formations.
  - **Porte-avions** et **armes** ; les menaces annoncées.
- **I3. Le mode instructeur.** Des leçons guidées : premier vol, tour de piste, atterrissage, ILS, figures,
  patrouille, appontage, interception, combat. TARS vole d'abord, puis vous laisse la main et vous corrige,
  télémétrie à l'appui.
- **I4. Les voix des rôles.** TARS est l'ailier, le contrôleur radar (« Darkstar »), le porte-avions
  (« Mother ») ou l'officier d'appontage : leurs annonces, à la radio de la patrouille.

### R — Le réseau, partout
Le réseau n'est pas une phase à part : **chaque étape est livrée en solo et en réseau**.
- Les ailiers IA et les ennemis tournent chez l'hôte.
- Le trafic vient du même relais pour tous (le même monde).
- Le porte-avions est déterministe sur l'horloge de la salle.
- Les missions se jouent en équipes, et les ordres de patrouille passent entre humains.

Un test e2e à deux pages par étape concernée.

### S — Scènes, missions et défis d'exception (pour finir)
- **S1. Les missions.**
  - **Escorte** d'un avion de ligne réel ou d'un VIP simulé.
  - **Protection** : patrouille aérienne au-dessus du porte-avions ou d'un convoi.
  - **Police du ciel** : intercepter, identifier et accompagner un intrus.
  - **Combat aérien** contre des cibles simulées.
  - **Frappe antinavire.**
  - **Qualifications d'appontage** : jour, nuit, mer forte.
  - **Patrouille acrobatique** : un spectacle en losange devant le public.
  - **Missions conjointes en équipes** en réseau : un avion escorte, l'autre frappe ; 2 contre 2 ; défense du
    porte-avions.
- **S2. Les vues d'exception**, chaque scène avec son heure, sa météo et son défi :
  - **poursuivre une éclipse** à Mach 1,6, comme Concorde en 1973 : l'éclipse totale du 12 août 2026 sur le
    Groenland, l'Islande et l'Espagne, à sa vraie date ;
  - le lever de Lune en patrouille ;
  - les aurores au-dessus de la Norvège ;
  - le coucher de soleil sur le porte-avions ;
  - le Grand Canyon, Monument Valley, la Mach Loop et le Star Wars Canyon (le Rainbow existe) ;
  - les fjords, l'Himalaya, la Patagonie, les volcans d'Islande ;
  - la tempête en mer avec appontage.
- **S3. Le spectacle.** Les caméras du replay (passage, tour, poursuite), le mode photo (existant) placé dans
  chaque scène, une bande-annonce automatique de la meilleure séquence.

## Ordre proposé
1. **V** (le vrai F-35) — tout le reste en dépend.
2. **C1–C3** (radar toujours actif, interception, où tirer).
3. **F** (formations, ordres, ailiers IA).
4. **T** (trafic réel).
5. **M** (mer, porte-avions, appontage).
6. **P** (missions, carte, éditeur).
7. **A**, **I** (assistances, TARS).
8. **C4–C6** (IA de combat, cibles 3D, armes de la mer).
9. **S** pour finir.

R est dans chaque étape.

## Risques
- **Le coût GPU de la mer FFT et du trafic** : budget mesuré dès M1 et T2, niveaux de détail, réglage de qualité.
- **Les quotas des API** : un relais avec cache, un seul abonnement aisstream, OpenSky avec un compte ;
  l'historique préparé hors ligne.
- **La plate-forme mobile** touche au train et aux collisions, un code délicat : la commencer tôt dans M2, avec
  ses tests.
- **Le réalisme de la haute incidence** sans données de soufflerie du F-35 (confidentielles) : la calibrer sur les
  comportements publiés (incidence de 50°, résistance au départ en vrille, taux de roulis) et sur des avions
  comparables aux données publiques (F-16 de la NASA, F/A-18 HARV).
