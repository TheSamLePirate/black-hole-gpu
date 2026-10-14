# Plan — le jeu en réseau (2 à 4 joueurs)

*Réécrit le 2026-10-14 sur la branche `reseau`. Il remplace le plan du 2026-10-02 (phases N0–N9, jamais
commencé). Ses décisions encore valables sont reprises ici.*

Demande (2026-10-14) : jouer à 2–4, **très réactif**, de qualité AAA :
- voler ensemble sur la planète (combat, défis, duels) ;
- voler ensemble dans le système solaire ;
- une caméra spectateur en réseau (2ᵉ vue) ;
- les personnages à pied sur la planète ;
- s'amarrer ensemble.

## Décisions de l'utilisateur

| Sujet | Décision |
|---|---|
| Ordre | Fondations, puis **voler ensemble sur Terre** d'abord ; l'espace et l'amarrage ensuite |
| Transport | Serveur de salles Bun (WebSocket) **et** WebRTC direct entre joueurs pour les poses, avec repli sur le WebSocket |
| Autorité en combat | **Les clients** : chacun fait foi pour son avion, le tireur est favorisé (compensation de latence), l'IA tourne chez l'hôte. Pas d'anti-triche, on est entre amis |
| Temps dans l'espace | **Une horloge par salle** : baisse du warp immédiate pour tous, hausse au vote |
| Modes sur Terre | Coopération contre l'IA · chacun pour soi · équipes 2 contre 2 · courses et concours d'atterrissage |
| Salles | **Sessions** (les matchs) et **monde persistant** (gardé jusqu'à sa suppression) |
| Voix | **Tôt**, avec le WebRTC : effet radio, bips Quindar, activation vocale |
| Adresse | **`https://stream.samlepirate.org/`** (hôte nginx-proxy-manager, certificat déjà en place) |
| À pied | Se voir marcher ; monter à bord de l'engin d'un ami comme passager |
| Spectateur | Ordinateur, tablette ou téléphone (QR code), écran instruments |
| Engins | **Au choix de chacun**, plusieurs exemplaires du même type ; les combats imposent le F-35 |

Repris du plan d'octobre :
- **4 pilotes** et **8 appareils** au plus par salle.
- **Le solo reste entier** : aucune connexion sans action du joueur, le code réseau chargé à la demande.
- **Déploiement** par la branche `deploy` interrogée par Portainer, qui n'est pas exposé ([DEPLOY.md](DEPLOY.md)).
- **coturn** sur le serveur pour le relais TURN, Cloudflare TURN en secours éventuel.
- Réapparaître où l'on veut après une destruction ; en multijoueur, ni pause globale ni retour en arrière.

## État du code (analyse du 2026-10-14, `845b470`)

**Aucun code réseau.** Le seul WebSocket est le relais Deepgram de `server.ts`. Il n'y a ni `src/net`, ni
BroadcastChannel, ni WebRTC. Le serveur de production ne sert que des fichiers statiques (nginx).

### Ce qui aide
- **Des F-35 distants animés sont possibles.** `ship.ts` dessine 24 instances (`MAX_INST`), dont 8 F-35
  (`JET_SLOTS`) avec leurs pièces propres à chacun : train, gouvernes, verrière, tuyère, trappes STOVL
  (`partMatrices(jetMesh, it.jet)`). Il suffit de leur donner un `F35Pose` (`f35/model.ts`), que `JetPoser`
  (`f35/pose.ts`) construit à partir d'une quinzaine de grandeurs.
- **Le modèle d'injection existe.** `renderer.combatOthers` place déjà les F-35 ennemis dans la vue, relatifs
  à la caméra (`controller/combat.ts` `combatShips`).
- **L'astronaute est un vrai personnage** : maillage CGTrader de 70 os, trois animations mêlées (repos,
  marche, course), pieds posés par IK (`character-model.ts`, `character-ik.ts`), physique à 120 Hz
  (`controller/character.ts`).
- **Une seconde caméra existe** : le spectateur est un `CameraController` sans écouteurs, avec ses propres
  réglages (`controller/spectator.ts`). C'est le modèle de la caméra en réseau.
- **Les corps et l'ISS se calculent à partir de `t`** : DE440, Kepler, SGP4. Ils ne transitent jamais.
- **Le pas fixe `__bh.step`** (`automation.ts`) et l'horloge de vol `frameclock.ts` montrent comment
  découpler la simulation de l'image.
- **Les tests de bout en bout** lancent déjà plusieurs Chrome isolés dans un même test (port et profil
  propres à chacun, `tests/e2e/lib/cdp.ts`), localement ou sur kerr-mini (`scripts/remote.ts`).
- **La chaîne de déploiement** GHCR → branche `deploy` → Portainer fonctionne (`pages.yml` job `server`).

### Ce qui bloque
1. **Pas de déterminisme d'une machine à l'autre.** Le pas suit l'horloge murale (`main.ts`,
   `dt = min(0.1, …)`), les sous-pas le framerate (`controller/lens.ts` `subCap`), et il y a 19 écritures de
   `s.timeSpeed` dont 9 dans `controller/plan.ts`. Le combat tire au sort avec `Math.random`
   (`game/combat.ts`, `rand` jamais injecté). Les tuiles du sol diffèrent selon les machines.
   → **On synchronise l'état, jamais les commandes.**
2. **Un seul engin par type.** `VesselId = "ranger" | "lander" | "endurance" | "f35"` (`vessels.ts:13`)
   indexe toute la flotte : `free`, `fuel`, `payload`, `links`, les coques, les types du rendu. Deux Rangers
   ne peuvent pas coexister dans `fleet`.
3. **Le vaisseau piloté est la caméra.** Sa pose est dans `Settings` (`camera.ts` `setHomePose`…). Le
   suivi du spectateur et `shipFromView` lisent le contrôleur local (`spectator.ts`). Aucune API ne dit
   « suivre la pose X ».
4. **Les effets ne valent que pour l'engin piloté** (`ship.ts`) : panaches et postcombustion
   (`writeJets(this.flown ? …)`, un seul `jetBuf`), plasma de rentrée (`writeReentry`, un seul bloc),
   traînées (un seul `Contrails`), feux, train du Ranger (`v.gear` pour toutes les instances).
5. **Le combat ne connaît qu'un humain** (`game/combat.ts`) : `damage`, `stores`, `lock`, `seen`, `firing`
   uniques, le joueur codé `-1`, `owner: "blue" | "red"`, l'IA ne vise que lui, `isGround = !q.ai` confond
   « avion » et « piloté par l'IA », les identifiants viennent d'un compteur unique.
6. **Les défis et les combats sont locaux** : horloge `C.t += dtPilot`, records dans `localStorage`, réglages
   relus chaque image (`opts`).
7. **Un seul astronaute** : un tampon d'os, un `evaluate()`, `frame()` qui dépend de `c.spectator`
   (`character-renderer.ts`, `renderer.ts`).
8. **Les autres engins** ne sont dessinés que de notre côté du trou de ver et à moins de 60 km
   (`renderer.ts` `fleetOthers`) ; le sol et les bâtiments ne se chargent qu'autour de la caméra locale
   (règle « tout est ancré à la caméra »).
9. **L'instantané est incomplet** (`game/save.ts` `GameSave`) : il manque `pilot.omega`, le train, le
   carburant, les modes du F-35, le STOVL, l'état de l'air, l'amarrage, le combat.

## Architecture

### Solo ou réseau
- **Le solo reste le jeu par défaut, identique à aujourd'hui.**
  - Aucune requête vers `stream.samlepirate.org` sans action du joueur (vérifié dans l'onglet réseau).
  - Le code réseau est une entrée à part (`net.js`, construite comme les workers par
    `scripts/build-pages.ts`), chargée par `import()` au premier usage. La taille du bundle solo est mesurée
    avant et après chaque phase.
  - En solo, chaque accroche est transparente : `wantWarp()` applique, l'horloge suit le vaisseau,
    `onCraftLost` garde la pause et le « reprendre avant l'entrée ».
- **Le menu Réseau** (menu pause, écran d'accueil, roue) : *Créer une salle*, *Rejoindre* (code, lien
  `#join=CODE`, QR), *Mes salles*, *Ajouter un écran*, *Quitter*.
- **Quitter** ramène à la partie solo telle qu'on l'avait laissée : les mondes des salles ne réécrivent
  jamais l'autosave solo.
- **Coupure** : on continue de voler en local avec un bandeau « hors ligne », reconnexion automatique.
- **Un réglage Réseau** masque entièrement le menu et les boutons.

### Transport
- **Le serveur de salles** (`server/rooms.ts`, Bun, `Bun.serve` + WebSocket, `bun:sqlite`) :
  - salons, présence, signalisation WebRTC, horloge de la salle, votes, baux, scores, persistance ;
  - relais des poses quand le direct échoue ;
  - identifiants TURN de courte durée (HMAC partagé avec coturn).
- **Le direct (WebRTC DataChannel)** entre joueurs, en maillage (4 pilotes : 6 liens ; 8 appareils : 28) :
  - canal **non fiable et non ordonné** pour les poses (`maxRetransmits: 0`) : pas d'attente de reprise
    comme sur TCP ;
  - canal **fiable et ordonné** pour les événements de combat ;
  - ICE : candidats locaux et mDNS (même pièce, ~1 ms), STUN puis TURN sur coturn (CGNAT des téléphones
    en 4G/5G) ;
  - repli automatique et transparent sur le WebSocket si le lien direct tombe.
- **Même machine** (2ᵉ fenêtre) : `BroadcastChannel`, sans réseau.
- **Objectifs mesurés** :
  - aller-retour serveur ≤ 40 ms entre amis en France ; lien direct ≤ 30 ms à distance, ≤ 5 ms en local ;
  - délai d'affichage d'un autre joueur (latence + tampon) : **≤ 80 ms** en direct, ≤ 120 ms par le serveur ;
  - débit ≤ 20 Ko/s montants par joueur en combat.

### Protocole
- **Binaire et versionné** (`src/net/proto.ts`, partagé client/serveur) : un octet de type, la version au
  handshake. Le serveur accepte N et N−1 ; un client plus vieux est invité à recharger (le service worker
  peut garder une ancienne page un moment : `src/pwa.ts`).
- **Messages** : `hello/welcome` (version, sha de build, pseudo, couleur), `roster`, `ping/pong` (horloge),
  `sample` (pose d'un engin ou d'un marcheur), `event` (tir, coup, destruction, apparition, train…),
  `vote`, `lease`, `session` (mode, équipes, compte à rebours, scores), `snapshot` (JSON compressé par
  `CompressionStream`), `signal` (offre/réponse/ICE), `chat`.
- **Échantillon d'engin** (~100 octets) :
  - `t` (f64, horloge de la salle) ; repère : corps + type (fixe au corps près du sol, inertiel centré sur
    le corps dans l'espace) ;
  - position (f64 × 3), vitesse (f32 × 3), attitude (quaternion « smallest-three » 3 × 16 bits),
    vitesse angulaire (f32 × 3), accélération (f16 × 3) ;
  - bloc visuel : manette, postcombustion, train, volets, aérofreins, STOVL (conversion, tuyère,
    soufflante), manche, α, `cl`, Mach, feux, au sol, rentrée (plasma, peau), drapeaux.
- **Repères** : près d'un corps, **fixe au corps** (ECEF WGS84 sur Terre, `bodyFixedOf`), pour qu'un engin
  posé ou à basse altitude soit exact quelle que soit la rotation ; dans l'espace, inertiel centré sur le
  corps dominant. Chaque client convertit vers son repère de rendu.
- **Cadence adaptative** : 30 Hz en vol, 60 Hz en combat rapproché (< 5 km d'un adversaire), 2 Hz posé,
  un message par changement d'orbite sur rails. Un échantillon part aussi dès que la prédiction des autres
  s'écarte du réel (0,5 m, 0,5°) : du *dead reckoning* côté émetteur.

### Horloge
- **L'horloge de la salle** : `t = t₀ + warp · (heure du serveur − h₀)`, chaque changement de warp étant un
  événement daté.
- **Synchro** à la NTP : rafales de pings au départ puis toutes les 2 s, filtre médian, décalage et dérive.
- **Le jeu suit l'horloge de la salle sans saut** : `timeSpeed` modulé de ±1 % pour rattraper l'écart.
  Aujourd'hui c'est l'inverse (la scène suit l'intégrateur du vaisseau, `sim.ts` `shipClock`) : l'accroche
  « horloge » fait avancer le vaisseau jusqu'au `t` de la salle.
- **Sur Terre (R1–R3)** : warp ×1 imposé en session, la pause n'arrête que son propre écran.
- **L'arbitre du warp** (`wantWarp(x, raison)`) arrive en R6 : en salle, une baisse s'applique tout de suite à
  tous, une hausse dépose un vote (10 s, tous d'accord).

### Afficher les autres
- **Interpolation** : chaque engin distant est affiché à `t − délai` ; le délai s'adapte à la gigue mesurée
  (30–60 ms en direct, 60–100 ms par le serveur). Spline d'Hermite entre deux échantillons, avec les
  vitesses.
- **Au-delà du dernier échantillon** : prolongation par la physique, jamais en ligne droite. En vol, un
  virage à vitesse angulaire et accélération constantes, pendant 250 ms au plus, puis l'engin passe en
  **fantôme** translucide. Sur rails, Kepler (`keplerProp`). Au sol, collé au terrain **local**.
- **Correction douce** : un écart entre la prédiction et un nouvel échantillon est résorbé en 150–300 ms,
  sans à-coup.
- **Le registre des engins distants** (`src/net/remote.ts`) alimente une liste `renderer.netOthers`, à côté
  de `combatOthers` et que `sim.ts` n'écrase pas. Un `JetPoser` par F-35 distant donne ses gouvernes, son
  train, sa tuyère.
- **Les effets par instance** (`ship.ts`) : panaches et postcombustion, plasma et peau chaude, feux, train
  du Ranger ; des traînées par engin, recalculées sur place à partir de `cl`, α, la vitesse et la manette
  reçus (`controller/computer.ts` `contrailsFrame`).
- **Au loin** : au-delà de 60 km ou sous un pixel, un marqueur HUD avec pseudo et couleur ; sur la carte et
  le radar, chaque joueur avec son pseudo.

### Autorité
- **Chaque joueur fait foi pour son engin** et pour son marcheur.
- **Le serveur fait foi** pour les salles, l'horloge, les votes, les baux (qui pilote quoi), les sessions
  (équipes, scores, compte à rebours), la persistance, l'ISS (un seul TLE pour tous).
- **L'hôte d'une session** (le créateur, ou le suivant s'il part) fait tourner l'IA (agresseurs, site SA-11,
  drones) et la diffuse comme des engins.
- **Combat, le tireur favorisé** :
  - **Canon** : les obus sont testés **chez le tireur**, contre les autres tels qu'il les voit (leurs poses
    interpolées). Le coup part en événement `hit` (cible, dégâts, point d'impact). La cible applique les
    dégâts. C'est la compensation de latence « favoriser le tireur ».
  - **Missiles** : le lanceur guide et fuse son missile contre la pose interpolée de la cible, et diffuse
    son état (10–20 Hz) pour que tous le voient, avec la traînée. La cible reçoit l'alerte missile depuis ce
    flux.
  - **Leurres** : un événement daté. Le lanceur fait apparaître les leurres à la position et à l'heure
    reçues (recalées), et son missile les pèse une fois chacun, comme aujourd'hui.
  - **L'IA** est touchée chez le tireur et ses dégâts sont appliqués par l'hôte.
  - **Le tirage au sort** (dispersion, leurres) se fait avec un générateur à graine par joueur, transmise à
    l'événement.
- **Destruction** : un événement « détruit », l'épave suit sa chute, puis le menu **Réapparaître** (sur la
  piste, au point de départ du match, près d'un ami, où l'on veut). Ni pause ni retour en arrière.

### Salles et sessions
- **Salle** : un code de 6 caractères, un **jeton de propriétaire** (gardé dans `localStorage`), un mot de
  passe optionnel, 4 pilotes et 8 appareils au plus. Pas de comptes : un pseudo et une couleur.
- **Monde persistant** : la salle garde la dernière pose de chaque engin (posé, en orbite, stationné), les
  baux, l'heure de la salle et la position de chacun. Elle vit jusqu'à sa suppression par son propriétaire.
- **Session** : un match dans la salle (coopération, chacun pour soi, équipes, course, atterrissage) avec
  ses règles fixées par l'hôte et **verrouillées** pour tous (munitions infinies, invulnérable, carburant,
  niveau de l'IA, missiles ennemis, tir ami), ses équipes, son compte à rebours, ses scores, son tableau de
  fin. Les records de la salle sont gardés.

### Hébergement
- **Image** `ghcr.io/thesamlepirate/black-hole-gpu-rooms` (`deploy/Dockerfile.rooms`, `oven/bun`), avec un
  volume `/data` pour SQLite.
- **`deploy/compose.yml`** (compose v1 pour Portainer 2.9) : le service `kerr` existant, le service
  `rooms` (port hôte 3001), puis `coturn` en R2 (`network_mode: host`).
- **CI** (`pages.yml`, job `server`) : construit l'image `rooms` quand `server/` ou `src/net/` ont changé,
  remplace un 2ᵉ jeton `ROOMS_IMAGE` dans `compose.yml` de la branche `deploy`. Portainer l'interroge toutes
  les 2 min : le serveur peut avoir 2 min de retard sur la page, ce que couvre la compatibilité N/N−1.
- **nginx-proxy-manager** (à faire par l'utilisateur) : l'hôte `stream.samlepirate.org` vers `host:3001`,
  case *Websockets Support* cochée.
- **coturn** (R2, à faire par l'utilisateur) : ouvrir 3478/udp, 3478/tcp et 49160–49200/udp sur le serveur
  et, si le Network Firewall OVH est actif, dans l'espace client. Secret partagé dans les variables de la
  stack Portainer, jamais dans le dépôt. Relais interdit vers les réseaux privés (`denied-peer-ip`).
- **Origines acceptées** : `https://samlepirate.org`, `https://thesamlepirate.github.io`, `localhost`.
- **Arrêt propre** : le serveur prévient, écrit SQLite et s'arrête ; les clients continuent en local et se
  reconnectent seuls.
- **Le service worker** ne met jamais en cache `stream.samlepirate.org` (`src/pwa/rules.ts`).

### Tests
- **Unitaires** (`bun test`) : codage du protocole, convergence de l'horloge à 200 ms et 5 % de pertes,
  erreur de l'interpolation et de la prolongation face à l'intégrateur, combat à plusieurs joueurs avec
  graine, logique des salles et des sessions, baux.
- **Labo réseau** : latence, gigue et pertes simulées dans la couche de transport (`#netlab=`), pour tester
  à 200 ms et 5 % de pertes.
- **Robot** (`src/net/bot.ts`) : un faux joueur sans rendu (Bun) qui vole un circuit, un virage serré ou
  une orbite, et peut tirer. On teste seul, en continu.
- **Bout en bout** : `tests/e2e/lib/room.ts` démarre le serveur de salles local (`ROOMS_URL`) et 2 à 4
  `App` dans la même salle ; `__bh.net` (salle, liens, latences, engins distants). Captures synchronisées de
  plusieurs appareils côte à côte pour les planches. À 4 Chrome, sur kerr-mini sans affichage (un seul GPU
  partagé ici).

## Phases

Chaque phase donne un ou plusieurs commits sur `reseau`, une planche `docs/progress/reseau/`, la doc en
anglais et en français, et repasse les tests solo existants (vol de référence réseau coupé).

### R0 — Fondations ✅ (2026-10-14)

*Fait* : `src/net/` (protocole, horloge, transport et labo, registre des autres, client, robot, chargé à la
demande : `net.js` 13 Ko, le bundle solo +11 Ko d'interface), `server/` (salles, SQLite, `/health`), le
panneau Réseau et son badge, `#join=`, `__bh.net`, la CI `rooms.yml` et `deploy/Dockerfile.rooms`.
Mesuré sur kerr-mini : horloges à 0,3 ms, autres affichés à 60–75 ms. L'attitude passe en 4 × int16
(pas 3·10⁻⁵ rad) plutôt qu'en « smallest-three ». **Reporté à R1** : l'instantané complet (`GameSave`),
utile quand on rejoint un monde avec ses engins. Voir [NETWORK.md](NETWORK.md).

- `src/net/` : protocole, horloge, transport WebSocket, registre des engins distants, interpolation et
  prolongation, labo réseau ; chargé à la demande.
- `server/rooms.ts` : salles, présence, persistance SQLite, horloge, `/health`, `/version` ; branché aussi
  sur `server.ts` en dev.
- Déploiement : `deploy/Dockerfile.rooms`, service `rooms` dans `compose.yml`, CI ; l'hôte
  `stream.samlepirate.org` dans NPM.
- Menu **Réseau** (créer, rejoindre, mes salles, quitter), pseudo et couleur.
- Robot, `tests/e2e/lib/room.ts`, `__bh.net`.
- **Vérifié** : deux navigateurs et un robot dans une salle sur `stream.samlepirate.org` ; l'horloge à
  ±2 ms ; aucune requête réseau en solo ; taille du bundle solo inchangée.

### R1 — Voler ensemble sur Terre ✅ (2026-10-14)

*Fait* : les engins des autres en coordonnées fixes de la Terre, **affichés au présent** (prédiction par leur
mouvement plutôt qu'un retard d'interpolation : la patrouille serrée l'exige), F-35 posés par leurs commandes
(protocole v2, 104 octets), flammes, traînées et vapeur comme les nôtres, étiquettes, radar, WebRTC direct
avec repli, ×1 imposé (`timeSpeed` est en M/s), l'heure de la salle à l'entrée, **À côté** (ailier à droite, à
sa vitesse). *Reporté* : les collisions (R3), le train et les feux du Ranger d'un autre, l'instantané et les
engins des absents (R7). Voir [NETWORK.md](NETWORK.md).

- Chaque joueur choisit son engin (F-35, Ranger, Lander…) et apparaît sur un aérodrome de la salle ; les
  autres sont des engins distants, plusieurs exemplaires du même type compris (ils restent hors de `fleet`).
- WebRTC : signalisation par le serveur, canaux non fiable et fiable, repli WebSocket, indicateur de liaison.
- Rendu des autres : F-35 animés par `JetPoser`, effets par instance (panaches, postcombustion, vapeur et
  traînées, feux, train), pseudos, marqueurs au loin, radar et carte.
- Warp ×1 imposé en session ; la pause n'arrête que son écran.
- Collisions joueur-joueur simples (contact détecté chez chacun, chacun applique sa part).
- **Vérifié** : deux F-35 en patrouille serrée, captures des deux écrans à la même heure de salle ; délai
  d'affichage mesuré (objectif ≤ 80 ms en direct) ; coupure du Wi-Fi puis reprise ; 4 joueurs et le robot
  sur kerr-mini.

### R2 — La voix ✅ (2026-10-14)

*Fait* : l'audio sur les liens WebRTC (un émetteur-récepteur ouvert avec le lien, pas de renégociation), le
micro (activation vocale, touche à choisir, toujours), la radio, les bips Quindar, la baisse des moteurs, qui
parle, le volume de chacun, pas de voix sur un même réseau ; les identifiants TURN de courte durée fabriqués
par le serveur. *En attente de l'utilisateur* : coturn (ouvrir 3478/udp+tcp et 49160–49200/udp, `TURN_SECRET`
dans Portainer, décommenter le service) — voir [DEPLOY.md](DEPLOY.md).

- Audio WebRTC sur les mêmes liens, Opus 48 kHz mono avec FEC et DTX, annulation d'écho et réduction de
  bruit.
- coturn dans la stack, identifiants de courte durée fabriqués par le serveur.
- Activation vocale par défaut, push-to-talk (une touche hors des touches de vol AZERTY et de F6 de TARS),
  volume et coupure par joueur, qui parle (pseudo allumé au HUD et sur la carte).
- Bus **voix** dans `src/audio/engine.ts` ; moteurs et ambiance baissés pendant la parole ; effet radio et
  bips Quindar d'un engin à l'autre, voix claire dans le même engin ; pas de voix entre appareils de la même
  pièce.
- **Vérifié** : 3 Chrome sans affichage avec micro simulé, relais forcé (`iceTransportPolicy: "relay"`), un
  téléphone en 4G ; latence de bout en bout < 150 ms.

### R3 — Combats, courses et atterrissages ✅ (2026-10-14)

*Fait* : le monde de combat à plusieurs (`game/combat.ts` : pairs, cibles distantes, missiles distants, coups
envoyés, IA visant le pilote le plus proche), les matchs (`game/match.ts`, `ui/netmatch.ts` : cinq modes,
règles verrouillées, compte à rebours, départs, scores, fin décidée par l'hôte, réapparition), marqueur de
coup, fil des éliminations, barre, classement ; collisions en vol (destruction sans pause en salle). Chacun
reste dans son propre monde : le tireur juge ses coups, la victime applique les dégâts. Voir
[NETWORK.md](NETWORK.md).

- `CombatWorld` à plusieurs joueurs : `players` (dégâts, emports, verrou, tir), cibles de type `human`,
  `owner` = joueur, identifiants préfixés par joueur, IA qui choisit sa cible parmi les joueurs,
  générateurs à graine.
- Tir favorisé (canon, missiles, leurres) et événements comme décrit plus haut ; IA chez l'hôte.
- Sessions :
  - **coopération** : les 4 combats existants (drones, duel, interception, frappe) à plusieurs, l'IA
    renforcée selon le nombre ;
  - **chacun pour soi** et **équipes 2 contre 2** : réapparition au cercle de départ, IFF sur le radar et au
    HUD (couleurs d'équipe), tir ami en option, tableau des scores (victoires, coups, précision) ;
  - **courses** de portes : départ au compte à rebours de la salle, les autres visibles en direct, temps
    intermédiaires, classement ;
  - **concours d'atterrissage** : chacun son tour ou ensemble, notes diffusées, classement.
- Règles de la session verrouillées pour tous ; records de la salle.
- **Vérifié** : un duel au canon à 100 ms de latence simulée, les coups comptés des deux côtés ; un AIM-9X
  leurré par des leurres lancés de l'autre machine ; une course à 3 avec le robot.

### R4 — Spectateur et écran instruments
- **Spectateur** : rejoindre sans piloter (`s.ship = false`), choisir un joueur à suivre.
  - Le spectateur reçoit une « source de pose » : il suit l'engin distant avec **tous** les points de vue
    (cockpit, poursuite, fly-by, trépied, libre, télescope, plongée).
  - L'engin suivi est rejoué en marionnette : pose et regard ensemble (comme `syncLook`), rentrée, secousse,
    traînées recalculées, et le son (le director nourri par l'état de l'air reçu).
- **Ajouter un écran** : 2ᵉ fenêtre (`BroadcastChannel`) ou appareil distant par QR code, dans une salle
  privée ; tablette et téléphone en tier bas.
- **Écran instruments** : carte 3D, radar, ground track, écrans du cockpit (PCD) d'un joueur, en lecture
  seule, par un canal de télémétrie à 2–5 Hz (trajectoires décimées).
- **Vérifié** : un téléphone suit un F-35 en vue cockpit, captures côte à côte, écart de temps mesuré.

### R5 — À pied ensemble
- Le rendu de plusieurs astronautes : un tampon d'os par marcheur (4 au plus en plus du sien), `evaluate()`
  pour chacun, ombre et IK des pieds sur le sol **local**.
- L'échantillon du marcheur : corps, position fixe au corps, cap, vitesse, phase d'animation, en l'air,
  accroupi ; 15 Hz.
- Pseudo au-dessus de chacun ; descendre de son engin et y remonter vus par les autres.
- **Monter à bord d'un ami** : on devient passager, avec la vue de sa cabine ou de son cockpit (le mode
  spectateur de R4, attaché à son engin) ; on descend quand il est posé.
- **Vérifié** : deux astronautes qui marchent l'un vers l'autre sur la piste d'Edwards, puis l'un monte dans
  le F-35 de l'autre et vole en passager.

### R6 — Ensemble dans le système solaire
- L'arbitre du warp `wantWarp()` : les 19 écritures de `timeSpeed` y passent ; en salle, baisse immédiate
  pour tous, hausse au vote ; chaque autopilote vérifié avec un warp plus lent que demandé (rentrée,
  calculateur de vol, transferts).
- Engins sur rails : un échantillon par changement d'orbite, propagation Kepler (position exacte même à
  ×4747) ; marqueurs au-delà de 60 km.
- Les autres joueurs sont des cibles (HUD, rendez-vous, carte 3D, sphères d'influence).
- **Vérifié** : deux Rangers lancés du même pas de tir, un rendez-vous en orbite basse au HUD.

### R7 — Amarrage et engins multiples
- **Refonte de la flotte** : des identifiants d'engin (`ranger#2`…) à la place de `VesselId` dans `fleet`
  (`free`, `fuel`, `payload`, `links`), les coques et les types du rendu restant indexés par type.
- **Baux** tenus par le serveur : un engin piloté appartient à son pilote, un engin libre (l'Endurance,
  l'ISS…) se prend en premier arrivé.
- **Collisions** avec les engins distants (`controller/docking.ts` `stationContact`) : celui qui détecte
  envoie les deux états, chacun applique sa part selon les masses.
- **Amarrage** : la capture est décidée par celui qui manœuvre ; l'assemblage a un seul pilote, l'autre
  devient passager (ses caméras et ses écrans gardés) ; chacun reprend son engin au désamarrage.
- **Vérifié** : deux Rangers amarrés à l'Endurance à 50 ms et 2 % de pertes, sans à-coups.

### R8 — Gargantua et finitions
- Les autres engins des deux côtés du trou de ver : rendu près de Gargantua dans le repère local de la
  caméra, marqueurs déviés par la lentille au-delà, « de l'autre côté » à travers la gorge.
- La dilatation avec une horloge par salle : un joueur dans une forte dilatation (Miller) quitte l'horloge
  de la salle et la rejoint quand les autres l'ont rattrapé. À rediscuter avant la phase.
- Finitions de l'interface, réglages réseau, aide en anglais et en français.

## Accroches dans le code existant

Le réseau lit ce que la physique expose et ne la réimplémente jamais. Les accroches sont minces et
regroupées :

| Accroche | Où | Phase |
|---|---|---|
| État de l'engin piloté à émettre | `controller/fleet.ts` `activePoseNow`, les entrées de `JetPoser` (`main.ts`) | R1 |
| Engins distants dans le rendu | `renderer.ts` (`shipOthers`, nouvelle `netOthers`), `sim.ts` | R1 |
| Effets par instance | `ship.ts` (`writeJets`, `writeReentry`, contrails, feux, train) | R1 |
| Radar, HUD, carte | `controller/combat.ts` `combatHud`, `ui/hud/symbology.ts`, carte 3D | R1 |
| Horloge imposée | `sim.ts` (`shipClock`), sous-pas de l'air (`controller/piloting.ts`) | R1 |
| Combat à plusieurs | `game/combat.ts`, `controller/combat.ts`, `game/scenarios.ts` | R3 |
| Défis synchronisés | `controller/challenge.ts`, `game/challenges.ts` | R3 |
| Source de pose du spectateur | `controller/spectator.ts` (`followShip`, `shipFromView`) | R4 |
| Plusieurs astronautes | `character-model.ts`, `character-renderer.ts`, `controller/character.ts` | R5 |
| Arbitre du warp | les 19 écritures de `timeSpeed` (`controller/plan.ts`, `piloting.ts`…) | R6 |
| Identifiants d'engin, baux, amarrage | `vessels.ts`, `fleet.ts`, `controller/docking.ts` | R7 |
| Destruction en multijoueur | `onCraftLost` (`main.ts`) | R1 |
| Instantané complet | `game/save.ts`, `game/tools.ts` (`snapshot`, `load`) | R1 |

## Risques
- **Régression du solo** : les tests existants et un vol de référence repassent à chaque phase, réseau coupé.
- **Le coût GPU des effets par instance** (panaches, traînées de 4 F-35) : mesuré avec la méthode de
  `docs/PLAN-F35.md` (vues figées, `__bh.game.perf({ gpu: true })`).
- **Le sol diffère d'une machine à l'autre** (tuiles chargées autour de chaque caméra) : un engin posé est
  collé au terrain local, et l'écart reste invisible à la distance où on le voit.
- **Les autopilotes en attente de vote** (R6) : chaque phase doit tolérer un warp plus lent.
- **La refonte de la flotte** (R7) touche beaucoup de fichiers : elle vient tard, une fois les engins distants
  éprouvés.
- **Safari et les téléphones** : WebGPU, WebRTC et l'audio sur iOS (`audioSession`, démarrage du son).
- **Le CGNAT des réseaux mobiles** : dépend du TURN (coturn, Cloudflare en secours).
- **Un autre agent travaille sur main** : la branche `reseau` est rebasée régulièrement ; les accroches dans
  `main.ts`, `controls.ts` et `renderer.ts` restent petites pour limiter les conflits.

## À faire par l'utilisateur
- R0 : l'hôte `stream.samlepirate.org` dans nginx-proxy-manager vers `host:3001`, *Websockets Support* coché.
- R2 : ouvrir 3478/udp, 3478/tcp et 49160–49200/udp (et dans le Network Firewall OVH s'il est actif) ; le
  secret de coturn dans les variables de la stack Portainer.
