# Audit 2026-11-10 — 04. Réseau, multijoueur et console équipage

Périmètre : `server/rooms.ts`, `server/main.ts`, `server.ts`, `deploy/*`, `.github/workflows/rooms.yml`, `src/net/*`,
`src/ui/netsession.ts`, `src/ui/netmatch.ts`, `src/ui/netpanel.ts`, `src/ui/crew-exec.ts`, `src/crew/main.ts`,
`src/controller/netcraft.ts`, tests `tests/net-*`, `tests/crew-*`, `tests/e2e/net-*`, `tests/e2e/crew-*`.
Méthode : lecture du code seule (aucun serveur, e2e ni test lancé). Les docs lues (NETWORK, PLAN-RESEAU, CREW,
AUDIT-CREW, PLAN-CREW-ACTIONS, PLAN-SERVICES-SERVEUR-AAA, DEPLOY) ne servent que de repère : le code fait foi.

Niveaux de preuve : **lu** = lu dans le code ; **mesuré (source)** ; **supposé** = à confirmer par un test.

## 0. Résumé

Le socle est propre : un relais WebSocket (Bun, SQLite), des liens directs WebRTC pour les échantillons, une horloge
de salle servie par le serveur, une prédiction soignée des appareils distants, des ordres d'équipage validés par
schéma. Le jeu à deux entre amis fonctionne et il est mesuré.

Il n'est pas « parfait », et l'écart est net sur trois axes :

1. **Confiance totale entre membres.** Hors `crew-cmd`, `stel`, `rpt`, `l16`, presque aucun événement reçu n'est
   validé. Un message mal formé (bogue, version différente, malveillance) fige l'image des autres joueurs ; le
   serveur le rejoue même aux nouveaux venus. Un membre peut détruire, téléporter ou piloter l'appareil d'un autre.
2. **Serveur sans défense.** Pas de limite sur les messages JSON, 1 000 salles au total sans expiration ni quota,
   identité = un identifiant d'appareil publié à toute la salle.
3. **État dur sans reprise.** Amarrages, passagers, scores, rôles co-op ne vivent que dans des événements passés :
   un joueur qui arrive ou se reconnecte ne les connaît pas. Pendant une coupure du WebSocket, plus rien n'est
   envoyé, même si les liens directs marchent.

## 1. Architecture constatée

- **Topologie** : étoile WebSocket vers `server/rooms.ts` (JSON pour les événements, binaire 104 octets pour les
  échantillons) + maillage WebRTC complet (canal de données non ordonné, sans retransmission, et voix Opus). Le
  serveur relaie les échantillons tant qu'un pair n'est pas joint en direct (`src/net/client.ts:456-474`).
- **Autorité** :
  - horloge de salle, allure (vote : la plus lente), liste des membres, slots : **serveur** (`server/rooms.ts:196-212`) ;
  - position, attitude, état de chaque appareil : **son propre client**, sans contrôle ;
  - tirs : **le tireur décide** du coup, la cible applique les dégâts reçus (`src/ui/netmatch.ts:300-311, 803-810`) ;
  - agresseurs IA, fin de match : le client « hôte » du match (`match.host`), champ fourni par le message lui-même ;
  - date : celle de la salle, imposée à l'entrée et recalée si l'écart dépasse 30 s (`src/ui/netsession.ts:1487-1518`) ;
  - météo, turbulence, trafic réel : **locaux à chaque page** (voir NET-33).
- **Repères** : position float64 en mètres, repère fixe au corps (ECEF sur Terre) ou inertiel centré sur le corps,
  ou carte de Gargantua (`src/net/proto.ts:103-105, 187`). Vitesse et accélération en float32, attitude 4 × int16.
  Le temps de l'échantillon est le temps de scène de l'émetteur, en float64.

## 2. Constats

### P0

**NET-01 — P0 — Un événement mal formé fige l'image des autres joueurs ; le serveur le rejoue aux nouveaux venus**
- Fichiers : `src/ui/netmatch.ts:265` et `:447-452` (`begin(ev.m as Match)` sans contrôle), `:296-298` (`cs`),
  `:773-800` (lecture de `s.ai`, `s.ms`), `:986-994` (`m.rules.limit`) ; `src/ui/netsession.ts:635-637` (`dock` :
  `c`, `ax` non contrôlés) puis `src/controller/netcraft.ts:483-486` ; `src/ui/netsession.ts:573` (`tel`) puis
  `:988-989` (`tau.toFixed`) ; boucle : `src/main.ts:8524, 8536` ; rejeu serveur : `server/rooms.ts:327, 409-412`.
- Constat : `{kind:"match", m:{id:"x"}}` est accepté de n'importe quel membre. `this.match` est posé avant toute
  vérification ; ensuite `frame()` lit `m.pilots`, `m.rules` et lève une exception à chaque image. Même effet avec
  `{kind:"cs", s:{}}` pendant un match (`s.ms` non itérable), `{kind:"dock", to:<victime>}` sans `c`/`ax`
  (`on(mine, link.c)`), `{kind:"tel", v:{tau:"0"}}` (`"0".toFixed`). `netSession.frame` et `netMatch.frame` sont
  appelés dans la boucle avant le rendu, sans `try`. Le serveur garde le dernier `match` et l'envoie à chaque
  entrant.
- Impact : un seul message bloque le rendu de tous les membres, et de tout nouveau venu tant que la salle reste
  occupée. Le même défaut frappera sans malveillance dès que deux versions du client coexistent (PWA en cache).
- Piste : un module unique de lecture des événements (`readEvent(kind, raw)`), sur le modèle de `readCrewCmd` /
  `spaceTelOf` : chaque `kind` a son schéma borné, tout le reste est jeté. `try/catch` autour des deux `frame`
  réseau avec compteur d'erreurs. Le serveur ne garde qu'un `match` validé (champs, tailles).
- Preuve : lu. Le gel d'image lui-même est à confirmer par un e2e (l'exception avant le rendu est lue).

**NET-02 — P0 — La création de salles s'épuise en une seconde, pour tout le monde, sans retour**
- Fichier : `server/rooms.ts:265-282` (`create`), `:137-141`, `:359` (seule suppression : le propriétaire).
- Constat : plafond global `maxRooms ?? 1000`, compté dans SQLite. Aucune limite par connexion, par IP ou par
  appareil ; aucune expiration (`used` est écrit, jamais lu pour purger). `create` n'exige qu'un `hello`.
- Impact : 1 000 messages `create` et plus personne ne peut créer de salle (« Too many rooms on this server »),
  jusqu'à une intervention manuelle sur la base. Sans attaque, le plafond sera atteint par l'usage normal :
  chaque essai laisse une salle éternelle.
- Piste : purge des salles inutilisées (ex. 30 jours sans membre), quota de création par IP et par appareil,
  seau à jetons par connexion, outil d'administration.
- Preuve : lu.

### P1

**NET-03 — P1 — Aucune limite sur les messages JSON du serveur**
- Fichier : `server/rooms.ts:429-440` (texte : seule la taille ≤ 65 536 est testée), `:443-446` (le seul compteur
  de débit est sur le binaire), `:392-414` (`event` publié à toute la salle), `:362-370` (`info`).
- Constat : un client peut publier des événements de 16 Ko sans limite de cadence ; chacun est analysé, re-sérialisé
  et diffusé à 7 pairs, qui l'analysent tous sur leur fil principal. `info` accepte 50 codes par requête, chaque
  code inconnu coûte une requête SQLite (`load`).
- Impact : saturation du serveur et des clients d'une salle ; énumération des codes (31⁶ ≈ 887 M de codes ;
  ~17 000 requêtes par salle trouvée à 1 000 salles) ; recherche de mot de passe sans frein (NET-10).
- Piste : seau à jetons par connexion et par type (`event`, `info`, `join`, `create`, `signal`), fermeture au-delà.
- Preuve : lu.

**NET-04 — P1 — L'identifiant d'appareil sert de preuve d'identité et il est publié à toute la salle**
- Fichier : `server/rooms.ts:178-179` (le `device` part dans le `roster`), `:299-306` (même `device` = ancien
  socket fermé, slot repris), `:314` (le rôle demandé est appliqué sans recompter les pilotes), `:156` (`mine`).
- Constat : tout membre lit le `device` des autres, puis peut rejoindre avec ce `device` : la victime est expulsée
  (`close(4000)`), son slot, son nom d'affichage en cours et son appareil laissé (`mine`) sont pris. Sur ce chemin
  le plafond de 4 pilotes n'est pas vérifié (un spectateur revient en pilote).
- Impact : usurpation et expulsion à volonté ; cinquième pilote possible.
- Piste : jeton de session secret remis par le serveur à l'entrée (jamais diffusé), exigé pour reprendre un slot ;
  ne publier qu'un identifiant public dérivé ; revalider le rôle.
- Preuve : lu.

**NET-05 — P1 — Deux onglets du jeu dans le même navigateur s'expulsent en boucle**
- Fichier : `src/ui/netpanel.ts:44-51` (un `device` par navigateur, en `localStorage`), `src/net/client.ts:163`,
  `:167-189` (toute fermeture, y compris 4000 « replaced », relance la reconnexion), `server/rooms.ts:303-305`.
- Constat : l'onglet B rejoint la salle de l'onglet A : A est fermé « replaced », se reconnecte 0,5 s plus tard,
  ferme B, etc. `retry` revient à 0 à chaque `welcome` : la boucle tourne à ~2 Hz sans fin, avec un `roster` et
  une reconstruction du maillage WebRTC à chaque tour pour toute la salle. La console équipage a évité le piège
  (identité par document, `src/crew/main.ts:46-51`), pas le jeu.
- Impact : salle inutilisable pour tous dès qu'un joueur ouvre un second onglet (cas courant : lien `#join=`).
- Piste : traiter le code 4000 comme terminal (« salle ouverte dans un autre onglet »), ou identité par onglet
  avec reprise explicite.
- Preuve : lu ; boucle à confirmer par un test à deux pages.

**NET-06 — P1 — Sur les liens directs, un pair peut parler au nom d'un autre slot**
- Fichier : `src/net/p2p.ts:110-114` (le tampon reçu est passé tel quel), `src/net/client.ts:224-231` (seul
  `s.slot !== this.room.slot` est testé), `src/net/remote.ts:295-300`.
- Constat : le serveur estampille le slot (`server/rooms.ts:447`), mais un échantillon arrivé par WebRTC garde
  l'octet de slot écrit par l'émetteur. Le client ne compare pas ce slot à celui du lien. Les slots ≥ 200
  (appareils « absents ») sont aussi acceptés.
- Impact : un pair déplace, téléporte ou fait disparaître l'appareil de n'importe quel autre joueur sur l'écran des
  autres (y compris la cible d'une formation, d'un amarrage, d'une caméra de suivi).
- Piste : `onData(buf, slot du lien)` et écraser `u[1]` côté réception ; refuser un slot hors `members`.
- Preuve : lu.

**NET-07 — P1 — Les échantillons ne sont pas validés : NaN, infini, temps aberrant empoisonnent une piste**
- Fichier : `src/net/proto.ts:216-255` (aucun `isFinite` au décodage), `src/net/remote.ts:123-132` (tri et purge
  par `t`), `:198-213` (Hermite avec `h = b.t − a.t`), `server/rooms.ts:443` (longueur et premier octet seulement).
- Constat : `t = +∞` reste « dernier échantillon » pour toujours ; l'interpolation donne alors `0 × ∞ = NaN`.
  `t = NaN` reste en tête du tableau, qui n'est plus purgé (croissance sans borne, ~30–60 objets/s). Des positions
  NaN passent jusqu'à `netShips` ; en suivi (`puppetFrame`, `src/ui/netsession.ts:1900-1903`) elles vont dans la
  pose de l'appareil du suiveur. Un `t` simplement en avance (horloge de scène décalée) fait rejeter tous les
  échantillons suivants comme « tardifs ».
- Impact : appareil distant invisible ou figé jusqu'au prochain `roster` ; fuite mémoire ; caméra NaN chez un
  spectateur. Avec NET-06, applicable à la piste de n'importe qui.
- Piste : `decodeCraft` rend `null` si un champ n'est pas fini ou hors bornes (|p| < 1e13 m, |v| < c, `kind`,
  `body`, `frame` connus) ; refuser `|t − heure de salle| > quelques secondes × allure` ; le serveur applique le
  même filtre avant relais et avant de garder `last`.
- Preuve : lu.

**NET-08 — P1 — Combat et collisions : n'importe quel membre décide du sort des autres**
- Fichier : `src/ui/netmatch.ts:265` (`match` : n'importe qui démarre, et `beginOwn` replace chaque pilote,
  `:481-518`), `:294-295` (`matchEnd` sans `id` accepté), `:300-311` (`hit` : dégâts lus tels quels), `:330-332`
  (`down` : le slot abattu est un champ du message, pas `from`), `:267-273` (`crash` avec `with: moi` → notre
  appareil détruit), `:276-279` (`tgtDown` retire un avion du trafic), `:287-290` (`hitWing`) ;
  `server/rooms.ts:392-414` (aucun contrôle de rôle : spectateurs et écrans d'instruments publient tout).
- Constat : le tireur fait autorité, ce qui est un choix documenté. Mais rien ne borne ce choix : pas de contrôle
  de portée, d'arme, de cadence, d'équipe, de rôle ni de phase. Un spectateur peut lancer un match (tous les
  pilotes sont replacés en F-35 au départ), l'arrêter, abattre un joueur, détruire son appareil hors match.
- Impact : parties sabotables par un seul membre ; scores non fiables ; un bogue d'un client se propage en dégâts.
- Piste : contrôles côté cible (portée/géométrie plausibles, cadence par arme, équipe, match en cours, émetteur
  pilote du match) ; `down`/`impact` acceptés seulement de leur propre slot ; `match`/`matchEnd` réservés aux
  pilotes côté serveur, l'hôte fixé par le serveur. À terme : un arbitre (hôte désigné par le serveur ou serveur).
- Preuve : lu.

**NET-09 — P1 — Des événements changent l'état de vol d'un autre sans son accord**
- Fichier : `src/ui/netsession.ts:620-628` (`order` « rejoin » → `this.formation(from)` : notre pilote automatique
  part en formation sur l'émetteur), `:598-604` (`msn` : mission d'un autre rejointe d'office), `:707-714` (`xtgt` :
  notre cible remplacée, identifiant libre de 40 caractères), `:715-729` (`xplan` : notre plan de manœuvres effacé
  et remplacé, Δv non bornés), `:694-706` (`xgive` : ajout aux réservoirs sans demande préalable ni amarrage),
  `:629-634` + `src/ui/crew-exec.ts:320` (`board` auto-déclaré → droits de copilote → `crew-cmd` : train, pilote
  automatique, désamarrage), `:642-647` + `src/controller/docking.ts:731-733` (`bump` ≤ 50 m/s, sans contrôle de
  distance ni de cadence).
- Constat : ces messages n'exigent ni proximité, ni amarrage, ni demande en attente, ni question au pilote (alors
  que `sorder`, `xask`, `helm-ask`, `crew-aboard` en posent une).
- Impact : un membre peut prendre la main sur le vol d'un autre (formation forcée, plan effacé, train rentré au
  sol par « copilote » auto-proclamé, poussées répétées).
- Piste : même règle partout : une action sur l'appareil d'autrui passe par `d.ask` ou par un état vérifié
  localement (amarré à lui, à bord accepté, demande émise). `board` validé par la distance ou l'amarrage lus dans
  nos propres pistes.
- Preuve : lu.

**NET-10 — P1 — Pas d'état de reprise : un arrivant ou un reconnecté ignore l'état dur de la salle**
- Fichier : `src/ui/netsession.ts:395-405` (`dock`/`undock` émis une fois), `:629-634` (`board`, `handed`),
  `:776-810` (co-op), `:754-775` (résultats, défi de salle), `src/ui/netmatch.ts` (feuille de score construite
  des événements), `src/net/client.ts:400-413` (`event()` : si le lien est fermé, le message est perdu sans file),
  `server/rooms.ts:327-328` (seuls `match` et `room-delay` sont rejoués).
- Constat : `fml`, `stel`, `cv`, `msn`, `wng`, `tel` sont répétés (état « mou », correct). Amarrages, passagers,
  appareils cédés, rôles co-op, défi de salle, scores et abattus ne le sont pas. Un événement émis pendant une
  coupure est perdu.
- Impact : après une reconnexion ou une entrée en cours de partie, vues divergentes : appareil amarré vu libre,
  passager vu absent, appareil cédé dessiné en double, score faux, rôle co-op repris deux fois.
- Piste : instantané d'état par joueur, renvoyé à chaque changement de `roster` et toutes les N secondes
  (`links`, `aboard`, `handed`, rôle, score), ou journal de salle tenu par le serveur ; file d'attente bornée
  des événements durs pendant `offline`.
- Preuve : lu.

**NET-11 — P1 — Pendant une coupure du WebSocket, plus aucun échantillon ne part, même en lien direct**
- Fichier : `src/net/client.ts:457` (`if (!this.room || !this.link?.open) return;`), `:313-318` (à la reprise,
  `setRoom` vide les pistes et ferme tout le maillage), `.github/workflows/rooms.yml:11-20` (redéploiement à chaque
  poussée sous `src/net/**`).
- Constat : le maillage WebRTC reste ouvert pendant la coupure, mais `sendCraft` sort avant de l'utiliser. À la
  reprise, toutes les pistes sont effacées et tous les `RTCPeerConnection` recréés.
- Impact : chaque redémarrage du serveur de salles (voir NET-20) fige puis fait disparaître tous les appareils
  distants pendant la reconnexion (0,5 à 10 s et plus), en plein vol en formation ou en combat.
- Piste : envoyer en direct tant que le maillage vit ; à la reprise, garder pistes et liens si le slot est le même.
- Preuve : lu.

**NET-12 — P1 — Reconnexion ratée : le client se croit dans la salle**
- Fichier : `src/net/client.ts:183-188`.
- Constat : après `connect()`, si `join` est refusé (salle supprimée, pleine, mot de passe changé, 4 pilotes),
  l'erreur est avalée (`.catch(() => {})`). `status` est `online`, `room` reste posé, rien n'est retenté.
- Impact : le joueur vole seul sans le savoir ; ses événements reçoivent « not-in-room ».
- Piste : sur refus, sortir de la salle avec le motif, ou retenter selon le code d'erreur.
- Preuve : lu.

**NET-13 — P1 — Le slot n'est pas stable et tout l'état client est indexé par slot**
- Fichier : `server/rooms.ts:214-243` (le slot est libéré à la fermeture), `:311-312` (plus petit slot libre),
  `src/ui/netsession.ts:573, 632, 651, 667` (`tel`, `handed`, `spaceTel`, `orderAnswers` jamais purgés au
  changement de `roster`), `:445` (seul `crewAboard` est vidé en quittant la salle).
- Constat : après une coupure commune (redémarrage serveur, même box), les joueurs reprennent « le plus petit slot
  libre » dans l'ordre d'arrivée : les slots s'échangent. Scores, équipes, cible de formation, suivi, rôles sont
  par slot. `handed` n'est jamais vidé, même en changeant de salle : un slot « cédé » reste invisible. Un nouvel
  écran d'équipage qui hérite du slot d'un précédent hérite de son « à bord accepté » tant que le pilote n'a pas
  quitté la salle.
- Impact : identités mélangées après reconnexion ; appareil invisible ; droits hérités.
- Piste : réserver le slot d'un appareil absent pendant un délai de grâce ; indexer l'état par identifiant de
  session ; purger toutes les tables par slot sur `roster` et en quittant la salle.
- Preuve : lu.

### P2

**NET-14 — P2 — Onglet masqué : le pilote disparaît et tient l'allure de la salle**
- Fichier : `src/main.ts:8394-8396` (boucle `requestAnimationFrame` seule), `src/ui/netsession.ts:419` (tout
  l'envoi est dans `frame`), `:520` (disparition après 10 s), `server/rooms.ts:186-199` (le dernier `want` reste).
- Constat : onglet masqué = plus d'image, donc plus d'échantillon ni de vote d'allure. Les autres voient un
  fantôme puis rien, alors que le membre reste au `roster`. S'il était en pause (`want = 0`), la salle reste en
  pause ; s'il était à ×1, aucune accélération n'est possible. Aucun délai ni droit du propriétaire pour passer
  outre. Aucun `visibilitychange` dans le code réseau.
- Impact : une salle bloquée par un joueur parti chercher un café.
- Piste : battement de présence par minuterie (pas par image) ; vote ignoré après N secondes sans échantillon ;
  état « absent » visible ; appareil laissé traité comme un appareil « away ».
- Preuve : lu.

**NET-15 — P2 — Mot de passe de salle : SHA-256 nu, essais illimités**
- Fichier : `server/rooms.ts:85, 274, 294-297`.
- Constat : hachage rapide sans sel ; aucun compteur d'échecs ; `info` dit quelles salles ont un mot de passe.
- Impact : recherche en ligne à plein débit (NET-03) ; base volée = mots de passe faibles retrouvés.
- Piste : `Bun.password` (argon2/bcrypt) ou sel + délai croissant par salle et par IP.
- Preuve : lu.

**NET-16 — P2 — Identifiants TURN donnés à toute connexion, sans salle**
- Fichier : `server/rooms.ts:381-391` ; quotas : `deploy/compose.yml:57` (12 par utilisateur, 60 au total).
- Constat : `ice` n'exige qu'un `hello`. Le nom d'utilisateur contient le `device`, libre : autant d'utilisateurs
  que voulu.
- Impact : 60 allocations prises par un script = plus de relais pour la voix et les liens des vrais joueurs en 4G.
- Piste : `ice` réservé aux membres d'une salle, limité en cadence ; quota lié à la salle.
- Preuve : lu.

**NET-17 — P2 — Le monde persistant grossit sans borne**
- Fichier : `server/rooms.ts:322` (une entrée par `device` vu), `:150-157` (liste `away` envoyée à tous à chaque
  entrée/sortie), `:158-165` (salle entière réécrite toutes les 2 s) ; `src/crew/main.ts:47-51` (un `device`
  aléatoire par chargement de la console) ; `src/ui/netsession.ts:525-531`.
- Constat : aucune purge de `world`. Chaque visite de console équipage ajoute une entrée définitive. Chaque
  pilote passé laisse un appareil « (away) » pour toujours, sans moyen de le retirer (sauf supprimer la salle).
- Impact : salles durables de plus en plus lourdes (JSON réécrit toutes les 2 s, pistes et étiquettes côté client).
- Piste : ne pas inscrire les rôles sans appareil ; plafond et ancienneté maximale ; retrait par le propriétaire.
- Preuve : lu.

**NET-18 — P2 — Un avion laissé en vol reste figé en l'air pour toujours**
- Fichier : `src/net/remote.ts:176` (Kepler seulement en repère inertiel), `:231-249` (sinon extrapolé 1 s au
  plus, et jamais fantôme si `persist`), `server/rooms.ts:222-225`.
- Constat : le dernier échantillon d'un pilote parti en vol atmosphérique est gardé tel quel. Il est redessiné
  immobile à son altitude, cible radar comprise. À son retour, « Retour à mon appareil » le replace là, à sa vitesse.
- Impact : incohérence visible ; la doc dit « garé où il était, ou sur son orbite ».
- Piste : ne persister que les états stables (posé, en orbite) ; sinon retirer l'appareil ou le poser.
- Preuve : lu.

**NET-19 — P2 — Flux à 20 Hz et instantanés de 16 Ko sur le canal fiable, diffusés à tous**
- Fichier : `src/ui/netsession.ts:462-465` (`wng` 20 Hz), `:256-287` (`instruments` 4 Hz, jusqu'à 16 Ko),
  `:1155-1179` (`tel` 4 Hz, `stel` 1 Hz), `src/ui/netmatch.ts:849` (`cs`), `server/rooms.ts:413` (diffusion à
  toute la salle).
- Constat : les ailiers IA, l'état de combat et la télémétrie passent en JSON par TCP et par le serveur, même
  quand les liens directs existent. L'instantané d'instruments est envoyé à tous les pilotes, qui le décodent
  pour le jeter.
- Impact : blocage en tête de file sous perte (ailiers et missiles saccadés à 200–500 ms) ; jusqu'à ~64 Ko/s par
  pilote suivi, analysés sur le fil principal de chaque membre.
- Piste : second canal de données non fiable pour `wng`/`cs`/`tel` ; adressage serveur (`to`) pour `instruments`.
- Preuve : lu. Effet sous perte non mesuré.

**NET-20 — P2 — Le serveur de salles redémarre à chaque changement sous `src/net/**`**
- Fichier : `.github/workflows/rooms.yml:11-20` ; le serveur n'importe que `src/net/proto.ts`
  (`server/rooms.ts:8-28`) ; `deploy/Dockerfile.rooms:7`.
- Constat : une retouche de `remote.ts`, `picture.ts` ou `qr.ts` (code client) reconstruit et redémarre le serveur
  en production. État en mémoire perdu : match en cours (`l.match`), délai lumière (`l.delay`), votes d'allure.
  Le client du propriétaire ne renvoie pas le délai (`delaySent` gardé, `src/ui/netsession.ts:240-253`).
- Impact : joueurs coupés sans raison (avec NET-11, NET-13) ; délai lumière différent pour les nouveaux venus.
- Piste : restreindre le déclencheur à `server/**` et `src/net/proto.ts` ; persister `match` et `delay` ; remettre
  `delaySent` à `null` à chaque `joined`.
- Preuve : lu.

**NET-21 — P2 — Compatibilité de versions : seuls le `hello` et le binaire sont versionnés**
- Fichier : `src/net/proto.ts:6-8` (`PROTO_MIN = PROTO_VERSION = 2`), `server/rooms.ts:248` ; événements :
  aucun champ de version hors `crew-cmd`/`crew-ack` (`v: 1`).
- Constat : site (Pages, service worker) et serveur de salles se déploient séparément. Deux clients de versions
  différentes peuvent partager une salle ; le format de `match`, `cs`, `wng`, `helm`, `dock` peut différer.
- Impact : avec NET-01, un changement de forme d'un événement fige les clients de l'autre version.
- Piste : `build` annoncé au `roster` et avertissement si différent ; version par famille d'événements ;
  lecteurs tolérants (NET-01).
- Preuve : lu.

**NET-22 — P2 — Liens directs : après reconnexion, retour au direct lent ou jamais**
- Fichier : `src/net/p2p.ts:87-100` (relance seulement sur `failed`), `:189-196` (relance seulement d'une offre
  sans réponse), `:56-62` (`sync` ne refait rien si le slot existe déjà), `src/net/client.ts:313-331`.
- Constat : le pair de slot haut qui se reconnecte ferme son maillage et attend une offre. Le pair de slot bas
  garde son ancien lien jusqu'à ce que le navigateur le déclare `failed` (dizaines de secondes) ; si l'état passe
  à `closed`, aucune relance n'existe. `disconnected` n'est pas traité.
- Impact : échantillons relayés par le serveur (latence plus haute) pendant ~30 s, voire jusqu'au prochain `roster`.
- Piste : signal « reprise » qui force une nouvelle offre ; relance sur canal fermé ; ICE restart.
- Preuve : lu pour la logique ; durées et état `closed` supposés, à confirmer dans Chrome.

**NET-23 — P2 — Pas de détection de lien mort côté client, pas de contre-pression**
- Fichier : `src/net/client.ts:217-222` (ping sans délai de garde), `src/net/transport.ts:44-48` (`send` sans
  `bufferedAmount`), `server/rooms.ts:176, 413` (retour de `send`/`publish` ignoré), `server/main.ts:43`.
- Constat : un WebSocket à moitié mort reste `online` jusqu'à l'erreur TCP. Côté client, `ws.send` empile sans
  borne sur un lien lent (les échantillons relayés à 30–60 Hz s'accumulent au lieu d'être jetés). Le canal WebRTC,
  lui, est protégé (`bufferedAmount < 64 000`, `src/net/p2p.ts:176`).
- Impact : latence qui gonfle sur un lien montant faible ; état « en ligne » trompeur.
- Piste : pong attendu sous 5 s sinon fermeture ; sauter l'échantillon relayé si `bufferedAmount` dépasse un seuil ;
  côté serveur, traiter le retour de `send` (abandon du binaire, fermeture si le fiable ne passe plus).
- Preuve : lu. Comportement exact de Bun sous contre-pression : supposé.

**NET-24 — P2 — Rôle « instruments » : pleins droits sur tout pilote, sur simple déclaration**
- Fichier : `server/rooms.ts:308, 314` (rôle choisi par le client), `src/ui/crew-exec.ts:319-323`,
  `src/settings.ts:891` (`netCrewActions: true` par défaut).
- Constat : tout appareil qui connaît le code (et le mot de passe s'il y en a) entre en « instruments » et peut
  commander n'importe quel pilote (`to` libre) : pilote automatique, plan de vol, train, amarrage, checklists.
  Seul « à bord » demande l'accord du pilote ; depuis « le sol » les ordres passent, avec le délai lumière.
- Impact : choix de conception assumé entre amis (décision du 21 octobre), mais sans garde pour une salle ouverte.
- Piste : accord du pilote à la première commande d'un écran donné ; verrou visible dans le panneau de salle.
- Preuve : lu.

**NET-25 — P2 — Réponses et minuteries d'ordres d'équipage sans borne**
- Fichier : `src/ui/netsession.ts:540-543` (un `setTimeout` par ordre retardé, avant la limite de cadence),
  `src/ui/crew-exec.ts:319-327` (refus envoyé avant `gate.pass`).
- Constat : avec un délai lumière de plusieurs minutes, chaque `crew-cmd` reçu crée une minuterie ; la limite de
  4 ordres/s ne s'applique qu'à l'échéance. Un émetteur non autorisé reçoit un `crew-ack` diffusé par message.
- Impact : mémoire et diffusion amplifiées par un écran bavard ou bogué.
- Piste : limite de cadence à la réception, avant mise en attente ; plafond de la file retardée.
- Preuve : lu.

**NET-26 — P2 — Trois fonctions du solo sont locales en salle sans le dire**
- Fichier : météo : aucun événement météo dans `src/net/*`, `src/ui/netsession.ts`, `src/ui/netmatch.ts` ;
  constat repris par `docs/PLAN-SERVICES-SERVEUR-AAA.md:34` et `docs/NETWORK.md:81-82` (turbulence propre à chacun) ;
  trafic réel : chaque page interroge le relais, seule la destruction est partagée (`src/ui/netmatch.ts:276-279`) ;
  date : un changement de date en salle est annulé par le recalage (`src/ui/netsession.ts:1514-1518`).
- Constat : deux ailiers peuvent voler dans deux météos (vent, nuages, visibilité) ; les avions de ligne ne sont
  pas garantis identiques ; changer la date ou charger une sauvegarde datée est défait avec un simple message.
- Impact : formation qui s'ouvre (40 → 105 m en 3 min, mesuré `docs/NETWORK.md:81`, e2e `net-formation`) ;
  ravitaillement et approches à deux incohérents ; fonctions solo silencieusement inopérantes.
- Piste : SV2 (météo commune de salle) ; graine de turbulence et instantané de trafic partagés ; date de salle
  changeable par vote ou par le propriétaire ; désactiver les commandes sans effet, avec la raison.
- Preuve : lu ; écart de formation mesuré (source citée).

**NET-27 — P2 — Le suivi écrase l'état de notre appareil**
- Fichier : `src/ui/netsession.ts:1907-1916`.
- Constat : en suivi (spectateur, passager, caméra de victoire), `fleet.fuel`, manette, train, volets, frein sont
  remplacés par la télémétrie non validée du pilote suivi, et ne sont pas rendus à la fin du suivi.
- Impact : après un passage à bord, notre appareil repart avec le carburant de l'autre ; valeurs non numériques
  possibles.
- Piste : état d'affichage séparé pour le pantin ; `tel` lu par un schéma.
- Preuve : lu.

### P3

**NET-28 — P3 — Altitude sphérique dans le placement des appareils distants**
- Fichier : `src/controller/netcraft.ts:475, 481` (`|p| − rayon`), utilisée pour la densité d'air du panache
  (`:543`). Contraire à la règle WGS84 du dépôt (jusqu'à ±11 km). Effet : aspect et son du moteur seulement.
- Preuve : lu.

**NET-29 — P3 — Vitesse en float32 près de Gargantua**
- Fichier : `src/net/proto.ts:188`. À ~10⁸ m/s le pas vaut ~8 m/s : ~0,8 m d'erreur par 0,1 s extrapolée. Sans
  effet dans le système solaire (pas ≈ 2 mm/s à 30 km/s). Le numéro de séquence (`:181`) n'est lu nulle part :
  aucune mesure de perte.
- Preuve : lu (ordre de grandeur calculé, non mesuré).

**NET-30 — P3 — Un seul délai d'affichage pour tous les pairs**
- Fichier : `src/net/remote.ts:282-314`. Le tampon de gigue (mode `lead = "delay"`) est commun : le pire pair
  retarde tous les autres. Le mode par défaut (prédiction, `lead = 0`) n'est pas touché.
- Preuve : lu.

**NET-31 — P3 — Port 3001 publié en clair, Origin non protecteur, IP du mandataire**
- Fichier : `deploy/compose.yml:16-17` (le serveur est joignable sans TLS hors du mandataire),
  `server/rooms.ts:422-423` (sans en-tête `Origin`, tout passe : ce contrôle n'arrête que les navigateurs),
  `server/main.ts:35` (`requestIP` : derrière le mandataire, la limite par IP du relais de trafic vaut pour tous
  les joueurs à la fois — supposé, selon la configuration du mandataire).
- Preuve : lu ; effet de la limite par IP supposé.

**NET-32 — P3 — Messages d'erreur du serveur en anglais dans la console française**
- Fichier : `server/rooms.ts:248-401` (textes anglais), `src/crew/main.ts:239` (`notice(msg)` brut pour les erreurs
  sans requête). Le jeu, lui, traduit par code (`src/ui/netpanel.ts:76-79`).
- Preuve : lu.

**NET-33 — P3 — Petites fuites et restes**
- `src/net/client.ts:207-214` : minuterie de 10 s par requête jamais annulée.
- `src/ui/netsession.ts:534-535` : écouteurs posés sur le client sans désabonnement (liés à la vie du client).
- `src/net/client.ts:229` + `:251-257` : un échantillon tardif d'un joueur parti recrée sa piste (fantôme jusqu'au
  prochain `roster`).
- `server/rooms.ts:171` : biais de modulo sur le code de salle (256 mod 31).
- Preuve : lu.

## 3. Qualité perçue (question 3)

- **Prédiction** : par défaut les autres sont montrés « maintenant » : extrapolation par vitesse + accélération +
  rotation, bornée à 1 s, fantôme après 4 s ; écart repris en 0,15 s ; saut > 1 km pris d'un coup
  (`src/net/remote.ts:119-120, 144, 231-249, 263`). Hermite entre échantillons. Orbite : Kepler + J2 du jeu.
  C'est solide et testé (`tests/net-core.test.ts`).
- **Horloge** : échange type NTP, huitième le plus rapide de 64 échanges (`src/net/clock.ts`). Testé à 200 ms
  ± 60 ms et 5 % de perte : ~12 ms (source : `tests/net-core.test.ts:103`).
- **Latence 200–500 ms** : aucun e2e n'utilise `#netlab` (`grep netlab tests/` : aucun résultat). La tenue en
  formation, en combat et au ravitaillement sous latence et perte n'est donc **pas établie**. Les mesures de la
  doc sont sur réseau local ou entre deux Mac proches.
- **Accélération du temps et pause** : cohérentes par construction (vote serveur, échantillons datés en temps de
  scène, historique étiré par l'allure). Limite : NET-14.
- **Combat** : voir NET-08. Avec 300 ms de latence, le tireur voit sa cible extrapolée ; la cible reçoit un coup
  qu'elle a pu esquiver sur son écran. Aucune compensation ni contrôle.
- **Ravitaillement en salle entre joueurs** : non vérifié dans le code réseau (pas d'événement dédié trouvé) ;
  la console équipage pilote le ravitaillement du jeu solo (`ap.mode tanker`).

## 4. Console équipage (question 6)

- **Actions** : mêmes fonctions que TARS (`tool.run` après `checkArgs`), plus quelques appels directs du
  contrôleur (`apSet`, `navSet`, `routeSetPoint`, amarrage) — `src/ui/crew-exec.ts:60-222, 335-341`. Double
  validation, cadence 4/s, dédoublonnage par identifiant, réponse dans la langue de la console. C'est le meilleur
  morceau du réseau.
- **États périmés** : traités (âge > 3 s → « Position ancienne », alertes masquées — `src/crew/main.ts:805, 934,
  1850-1860`).
- **i18n** : FR/EN par `L()` ; reste NET-32.
- **Droits** : NET-24, NET-13 (héritage par slot), NET-09 (`board` auto-déclaré).
- **Charge** : NET-19 (instantané diffusé à tous).

## 5. Tests (question 8)

| Sujet | Unitaire | E2E | Rien |
|---|---|---|---|
| Codec 104 octets, horloge, Hermite, lissage, Kepler | `net-core` (11) | — | |
| Serveur : salles, limites, mot de passe, reprise de slot, redémarrage, TURN | `net-rooms` (9) | `net-rooms` | |
| Ordres d'équipage, schémas | `crew-actions`, `crew*` (≈ 54) | 9 fichiers `crew-*` | |
| Vol, formation, combat, amarrage, espace, voix, co-op | `combat-net` (7), `netspace` (8) | 22 fichiers `net-*` | |
| Messages mal formés, NaN, inondation, usurpation de `device` ou de slot | | | **rien** |
| Latence, gigue, perte en jeu (`#netlab`) | horloge seule | | **rien** |
| Reconnexion en vol, redémarrage serveur en partie, deux onglets | reprise de slot seule | une mention (`net-crew`) | **quasi rien** |
| Onglet masqué, joueur absent, salle pleine en reconnexion | | | **rien** |
| Arrivée en cours de partie (état dur) | | | **rien** |
| 3–4 pilotes + 4 écrans (charge réelle) | | 2 pages, 3 pour `net-time` | **rien** |
| Compatibilité de deux versions du client | | | **rien** |

Avant déploiement, `rooms.yml` ne lance que `net-core`, `net-rooms`, `lola-tiles` (`.github/workflows/rooms.yml:40`).

## 6. Écart avec PLAN-SERVICES-SERVEUR-AAA (question 9)

Le plan (23 octobre) est sans implémentation : pas de `/svc/v1/health` (`server/main.ts:38` sert `/health`
seul), pas de météo de salle (SV2), pas de débriefing (SV3). Sont servis aujourd'hui : salles, relais de trafic,
tuiles de relief Lune/Mars/Mercure/Cérès. Le plan ne couvre pas la sécurité ni la robustesse du serveur de salles.

Ce qui manque pour « parfait », par ordre :

1. Lecture stricte de tout ce qui arrive (NET-01, 06, 07) et `try/catch` des images réseau.
2. Défenses serveur : débits, quotas, expiration, jeton de session (NET-02, 03, 04, 15, 16).
3. Reprise : état dur rejoué, envoi direct pendant la coupure, slot réservé, code 4000 terminal
   (NET-05, 10, 11, 12, 13).
4. Arbitrage minimal du combat et consentement pour toute action sur autrui (NET-08, 09).
5. Présence et allure : joueur absent, onglet masqué (NET-14).
6. Cohérence de monde : météo, turbulence, trafic, date (NET-26, SV2).
7. Banc d'essai réseau : e2e sous `#netlab` 100/20/2 % et 250/50/5 %, messages hostiles (fuzz des lecteurs),
   redémarrage serveur en vol, 4 pilotes + écrans.
8. Observabilité : compteurs serveur (messages, rejets, salles, débit), pertes mesurées (le numéro de séquence
   existe déjà), journal des refus côté client.

## 7. Récapitulatif

| Id | Gravité | Sujet | Fichier principal |
|---|---|---|---|
| NET-01 | P0 | Événement mal formé : image figée, rejoué par le serveur | `src/ui/netmatch.ts:265` |
| NET-02 | P0 | 1 000 salles au total, sans quota ni expiration | `server/rooms.ts:265` |
| NET-03 | P1 | Aucun débit limite sur le JSON | `server/rooms.ts:429` |
| NET-04 | P1 | `device` public = identité : usurpation, expulsion | `server/rooms.ts:299` |
| NET-05 | P1 | Deux onglets s'expulsent en boucle | `src/net/client.ts:167` |
| NET-06 | P1 | Slot usurpable sur les liens directs | `src/net/client.ts:229` |
| NET-07 | P1 | Échantillons non validés (NaN, ∞, temps) | `src/net/proto.ts:216` |
| NET-08 | P1 | Combat : tout membre décide du sort des autres | `src/ui/netmatch.ts:265-332` |
| NET-09 | P1 | Actions sur l'appareil d'autrui sans accord | `src/ui/netsession.ts:620-729` |
| NET-10 | P1 | Pas d'état de reprise pour arrivants et reconnectés | `src/ui/netsession.ts:395` |
| NET-11 | P1 | Coupure WebSocket : plus d'envoi, même en direct | `src/net/client.ts:457` |
| NET-12 | P1 | Reconnexion refusée avalée | `src/net/client.ts:183` |
| NET-13 | P1 | Slot instable, état par slot jamais purgé | `server/rooms.ts:311` |
| NET-14 | P2 | Onglet masqué : disparition et allure bloquée | `src/ui/netsession.ts:419` |
| NET-15 | P2 | Mot de passe SHA-256 nu, essais illimités | `server/rooms.ts:294` |
| NET-16 | P2 | TURN sans salle | `server/rooms.ts:381` |
| NET-17 | P2 | Monde persistant sans borne | `server/rooms.ts:322` |
| NET-18 | P2 | Avion laissé en vol figé en l'air | `src/net/remote.ts:231` |
| NET-19 | P2 | 20 Hz et 16 Ko sur le canal fiable, à tous | `src/ui/netsession.ts:462` |
| NET-20 | P2 | Redémarrage serveur à chaque retouche client | `.github/workflows/rooms.yml:11` |
| NET-21 | P2 | Événements non versionnés | `src/net/proto.ts:6` |
| NET-22 | P2 | Retour au lien direct lent ou absent | `src/net/p2p.ts:87` |
| NET-23 | P2 | Ni garde de lien mort ni contre-pression | `src/net/transport.ts:44` |
| NET-24 | P2 | « Instruments » : pleins droits sur déclaration | `src/ui/crew-exec.ts:319` |
| NET-25 | P2 | Minuteries et réponses d'ordres sans borne | `src/ui/netsession.ts:540` |
| NET-26 | P2 | Météo, trafic, date : locaux en salle | `src/ui/netsession.ts:1514` |
| NET-27 | P2 | Le suivi écrase notre état | `src/ui/netsession.ts:1907` |
| NET-28 | P3 | Altitude sphérique (panache) | `src/controller/netcraft.ts:475` |
| NET-29 | P3 | Vitesse float32 près de Gargantua ; séquence non lue | `src/net/proto.ts:188` |
| NET-30 | P3 | Tampon de gigue commun | `src/net/remote.ts:282` |
| NET-31 | P3 | Port 3001 en clair, Origin, IP du mandataire | `deploy/compose.yml:16` |
| NET-32 | P3 | Erreurs serveur en anglais dans la console FR | `src/crew/main.ts:239` |
| NET-33 | P3 | Petites fuites et restes | `src/net/client.ts:207` |

## 8. Ce qui est solide

- Positions en float64 par corps, temps de scène dans l'échantillon, repères explicites : pas de problème de
  précision dans le système solaire.
- Prédiction, lissage, propagation Kepler + J2, horloge : conçus avec soin et testés unitairement.
- Horloge et allure de salle servies par le serveur, changement daté à l'avance (150 ms).
- Ordres d'équipage : schéma, double validation, cadence, dédoublonnage, mêmes fonctions que TARS.
- Pas d'injection HTML trouvée : noms nettoyés au serveur (`server/rooms.ts:86-90`), affichage par `textContent` ;
  les deux seuls `innerHTML` reçoivent du contenu local (`src/crew/main.ts:741`, `src/ui/netpanel.ts:309`).
- Clés (Deepgram, AIS, OpenSky, TURN) côté serveur seulement ; relais Deepgram limité au dev et à la même origine
  (`server.ts:23-39`) ; jeton de propriétaire haché, jamais relayé (`server/rooms.ts:396-405`).
- Le solo ne charge pas le réseau (`src/net/load.ts`).
- Canal WebRTC protégé contre l'engorgement (`src/net/p2p.ts:176`).

## 9. Non vérifié

- Aucun test, e2e ni serveur lancé : tous les constats sont de lecture. Le gel d'image de NET-01 et la boucle de
  NET-05 sont à reproduire.
- `src/game/combat.ts` (règles `invulnérable`, tir ami dans `W.hurt`), `src/net/picture.ts`, `link16.ts`,
  `spacefleet.ts`, `roomboard.ts`, `instruments*.ts`, `src/ui/netvoice.ts`, `src/ui/crew-feed.ts`,
  `src/crew/views.ts`, `src/crew/radio.ts` : survolés ou non lus. Leurs lecteurs (`spaceTelOf`, `resultOf`,
  `readL16`) sont cités sur la foi de leur usage.
- Rendu et extrapolation des ailiers IA distants (`wng`) ; ravitaillement entre deux joueurs ; missions solo en salle.
- Comportement de Bun sous contre-pression, états WebRTC exacts après fermeture distante, bridage des minuteries
  de Chrome en onglet masqué face à `idleTimeout: 60` : supposés.
- Configuration réelle du mandataire (Nginx Proxy Manager), du pare-feu (port 3001) et de coturn en production.
- Sauvegardes : effet d'un chargement de sauvegarde en salle (hors recalage de date) non suivi.
- La ligne de ce document dans `docs/README.md` (carte de la doc) et l'entrée de `progress-to-destination.md` ne
  sont pas écrites ici (un seul fichier autorisé) : à faire par la session qui assemble l'audit.
