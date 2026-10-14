# Jouer ensemble

*[English version](NETWORK.md)* — le plan et ses étapes : [PLAN-RESEAU.md](PLAN-RESEAU.md) ; les planches :
`docs/progress/reseau/`.

Deux à quatre joueurs dans un même monde, avec des spectateurs et des écrans instruments à côté. Le solo
reste entier : rien ne se connecte tant que le joueur ne demande pas une salle, et le code réseau
(`net.js`, 13 Ko) n'est chargé qu'à ce moment.

## Les salles (R0)

- **Réseau — jouer ensemble** (le menu pause, la roue) : un pseudo et une couleur ; **Créer une salle**
  (un nom et un mot de passe, tous deux facultatifs) ou en **Rejoindre** une par son code, comme pilote,
  spectateur ou écran instruments ; **Vos salles** : celles que l'appareil connaît, rejointes d'un clic,
  supprimées par leur propriétaire.
- **Le lien de la salle** (`#join=CODE`) : la page s'ouvre directement dans le jeu, la salle rejointe.
- **Le badge** à côté de la carte de la cible : le code de la salle, ses membres, l'aller-retour ; ambre
  quand la liaison est perdue (le jeu continue, la liaison est retentée et la salle reprise, à la même
  place).
- Une salle accueille 8 appareils, dont 4 pilotes. Le serveur la garde jusqu'à ce que son propriétaire la
  supprime ; son horloge continue quand personne n'y est.
- **Réglages › Réseau › Menu Réseau** désactivé : aucune trace du réseau dans le jeu.

## Voler ensemble sur Terre (R1)

- **Chacun pilote son engin** (le F-35, le Ranger, le Lander…, plusieurs du même type) : ceux des autres sont
  dessinés là où ils sont — les gouvernes, le train, la tuyère et les trappes STOVL d'un F-35 bougent comme
  les commandes de son pilote, sa flamme de postcombustion, les traînées de ses moteurs, les fils de ses
  saumons et sa nappe de vapeur sous facteur de charge —, leur pseudo, leur engin et leur distance au-dessus
  d'eux (une flèche au bord de l'écran hors champ), sur le radar du F-35 dans leur couleur avec leur route et
  leur hauteur par rapport à la nôtre.
- **Affichés au présent** : prolongés depuis leur dernier échantillon par leur mouvement (vitesse,
  accélération, rotation), un désaccord résorbé en douceur — un ailier à 25 m vole à 25 m (un cinquième de
  seconde de retard le mettrait 50 m en arrière à 250 m/s).
- **À côté** (le panneau de la salle, pour chaque autre pilote) : votre engin placé à sa droite, à sa vitesse,
  son cap et son altitude — en patrouille ; au sol, garé à côté de lui. `__bh.net.teleport(slot, écart?)`.
- **Le temps de la salle** : ×1 (temps réel) pour tous, un warp demandé est refusé ; en entrant, la scène est
  mise à l'heure de la salle (le même Soleil) si elle en est à plus d'une minute.
- **Les liens directs** : un canal de données WebRTC vers chaque autre page — sans ordre, jamais renvoyé —,
  établi par le serveur de salles, les échantillons en direct (1–3 ms sur un même réseau), par le serveur tant
  qu'un pair n'est pas joint ; le panneau dit comment arrivent ceux de chacun (direct, local · relayé · via le
  serveur).

Mesuré sur kerr-mini (`tests/e2e/net-flight`, deux pages) : un lien direct local de 1–3 ms ; les deux F-35 en
patrouille se voient à 27,6–27,7 m ; la postcombustion du leader vue allumée chez l'ailier.

Pas encore : les collisions entre joueurs (R3, avec les dégâts des combats), le train et les feux du Ranger
d'un autre (une uniforme de l'engin piloté), les engins des joueurs partis gardés dans le monde de la salle
(R7).

## Comment ça marche

- **Le serveur de salles** (`server/rooms.ts`, Bun, SQLite) : les salles et leurs membres, l'horloge, les
  événements de la salle, les échantillons des engins relayés. En production sur
  `wss://stream.samlepirate.org/` ([DEPLOY.md](DEPLOY.md)) ; en dev et dans les tests, sur le serveur de
  la page, en `/net` (`#server=` en choisit un autre, `?prodnet` celui de production depuis localhost).
- **Le protocole** (`src/net/proto.ts`) : du JSON pour la vie de la salle, des échantillons binaires de
  104 octets pour les engins (position en float64, vitesse, attitude, rotation, accélération, ce que montre
  l'engin : manette, postcombustion, train, volets, STOVL, commandes de vol, α, CL, Mach).
- **L'horloge** (`src/net/clock.ts`) : l'échange de NTP, le décalage du huitième le plus rapide des 64
  derniers échanges ; à moins d'une milliseconde entre deux pages sur une même machine.
- **Les autres** (`src/net/remote.ts`) : affichés un peu dans le passé — assez pour que l'échantillon
  suivant soit là —, une spline d'Hermite entre deux échantillons, prolongés par leur mouvement au-delà du
  dernier (puis un fantôme), un désaccord résorbé en douceur.
- **Le labo réseau** : `#netlab=latence,gigue,pertes` (par exemple `100,20,0.05`) simule un réseau par-dessus
  la liaison.
- **Le robot** (`src/net/bot.ts`) : `bun src/net/bot.ts --room CODE` rejoint une salle et vole un cercle
  au-dessus d'Edwards, 30 échantillons par seconde.

Mesuré sur kerr-mini (deux pages et le robot, `tests/e2e/net-rooms`) : aller-retour 5–7 ms, les
échantillons en retard de 5 ms (95 % : 27 ms), les autres affichés avec 60–75 ms de retard, les horloges des
deux pages à 0,3 ms près.

## Tests

De bout en bout aussi : `tests/e2e/net-flight` (deux F-35 : vus à 8 km, sur le radar, le lien direct, À côté —
la patrouille, le même écart vu des deux côtés —, la postcombustion vue). Unitaires : `tests/net-core.test.ts` (les échantillons, l'horloge sous 200 ms et 5 % de pertes, Hermite au
centimètre, le lissage, le vol du robot), `tests/net-rooms.test.ts` (un vrai serveur : salles, limites, mots
de passe, la place reprise à la reconnexion, la suppression par le propriétaire, les salles gardées après un
redémarrage). De bout en bout : `tests/e2e/net-rooms` (la page solo intacte, une salle depuis le menu pause,
une page par le lien, le robot, les horloges, le départ).
