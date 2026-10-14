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

Unitaires : `tests/net-core.test.ts` (les échantillons, l'horloge sous 200 ms et 5 % de pertes, Hermite au
centimètre, le lissage, le vol du robot), `tests/net-rooms.test.ts` (un vrai serveur : salles, limites, mots
de passe, la place reprise à la reconnexion, la suppression par le propriétaire, les salles gardées après un
redémarrage). De bout en bout : `tests/e2e/net-rooms` (la page solo intacte, une salle depuis le menu pause,
une page par le lien, le robot, les horloges, le départ).
