# Le radar, l'image tactique et les pistes du monde

Ce que voient les capteurs du pilote, ce que chaque écran en montre, ce que reçoivent le crew et la salle. Le plan et
son histoire : [PLAN-RADAR-AAA.md](PLAN-RADAR-AAA.md), une fiche par phase dans `docs/progress/radar/`. En anglais :
[RADAR.md](RADAR.md).

## Une seule image tactique

Une seule liste de pistes, construite à chaque image (`src/radar/picture.ts`). Tous les écrans, les outils et le réseau
la lisent. Ce qui se voit sur un écran est donc vrai sur les autres.

- **Chaque piste porte deux choses** :
  - **la vérité** : ce qu'est l'objet (ami, hostile, neutre, trafic, porte-avions, joueur, abattu) et où il est
    exactement, en latitude, longitude et hauteur sur l'ellipsoïde WGS84 ;
  - **ce qu'en savent les capteurs** : lesquels le tiennent, l'IFF connue (inconnue tant qu'il n'a pas répondu ni été
    vu), et s'il est mesuré, prolongé, tenu par le datalink ou seulement connu du jeu.
- **Les missiles et les leurres sont des pistes** comme les autres.
  - Un missile : sa cible, son temps avant impact, s'il est leurré, sa fin (SPLASH ou RATÉ, 3 s).
  - Un leurre : sa vie restante.
- **Une seule sélection** pour tous les écrans du pilote ; le verrou est celui du radar.

## Les capteurs

| capteur | sur | ce qu'il voit |
|---|---|---|
| **Radar APG-81** | le F-35 en vol | ±60° en 2 s, jusqu'à 150 km sur un chasseur ; l'horizon radar, le relief qui masque, l'encoche Doppler en visée basse ; modes RWS, TWS, STT ; IFF à 120 km, identification à vue à 3 km |
| **Radar de nez** | le Ranger en vol | le même moteur : ±60° en 2,5 s, ±30° en site, 90 km sur un chasseur (60 % de l'APG-81) ; coupé au-dessus de 1 500 m/s (le plasma d'une rentrée) ; IFF des transpondeurs à 80 km, identification à vue à 3 km |
| **DAS** | le F-35 | à la chaleur, tout autour : les avions à 30 km, un moteur de missile à 20 km (3 km éteint), les fusées à 10 km ; pas d'IFF |
| **EOTS** | le F-35 | ±30° devant le nez, 60 km ; pas d'IFF |
| **Datalink** | tous | les appareils amis, nos missiles (leur liaison de guidage), les pistes radar des équipiers (Link 16) |
| **TCAS** | tout appareil en vol | les transpondeurs à 30 NM et ±9 900 ft |
| **AIS** | tous | les navires |
| **Radar d'atterrissage** | le Lander au-dessus d'un sol | comme celui du LM d'Apollo : l'altitude accrochée sous 12 km, les vitesses sous 7,5 km, le ventre à moins de 50° de la verticale ; ses chiffres sont ceux des sondes de l'engin, le capteur dit s'ils sont mesurés. La ligne **LR** du panneau DESCENTE (ALT · VEL, ALT, PAS D'ACCROCHE · NAV), la hauteur **LR** du HUD d'approche (sinon **NAV**) |
| **Radar de rendez-vous et lidar d'amarrage** | Ranger, Lander, Endurance | la station, les engins de la flotte, les joueurs en orbite, dans le repère LVLH |

**Les paillettes** : en RWS, à l'assistance réaliste ou manuelle, une gerbe fait une fausse piste inconnue pendant 2,5 s.

### Le TCAS

Il classe chaque transpondeur comme le TCAS II :

- **proche** : à moins de 6 NM et de 1 200 ft ;
- **avis de trafic (TA)** : le point de rapprochement maximal à 40 s ;
- **avis de résolution (RA)** : à 25 s, sur un intrus qui se rapproche. Il demande de monter ou de descendre, à
  l'écart de là où passera l'intrus. Pas de RA sous 300 m sol.

Où on le voit et l'entend :

- **les symboles** du TCAS II : losange, disque ambre, carré rouge ;
- **le HUD de tout appareil** : TRAFIC, ou MONTEZ ↑ / DESCENDEZ ↓, l'intrus marqué dans la vue ;
- **les annonces** : « Trafic, trafic », « Montez, montez ! », « Descendez, descendez ! », « Fin de conflit » ;
- **l'Auto-ACAS du F-35** suit le RA.

Réglage : Réglages › Trafic réel › TCAS.

### Les vaisseaux

Chaque engin tient les autres dans le repère LVLH de son orbite, avec la distance, la vitesse d'approche et le point de
rapprochement maximal.

| engin | radar de rendez-vous (sur 5 m²) | lidar |
|---|---|---|
| Ranger | 120 km (l'ISS vue à environ 540 km) | 5 km |
| Lander | 80 km | 3 km |
| Endurance | 300 km | 5 km |

Un astre entre deux cache l'autre au radar, jamais au datalink. Le scope spatial du HUD est en vue de poursuite :

- le V-bar en haut ;
- une distance logarithmique de 100 m à 1 000 km ;
- pour chaque engin : sa distance, sa vitesse d'approche, son écart sur le R-bar.

## Les écrans

**Les mêmes symboles partout**, inspirés de l'OTAN :

- **les formes** :
  - un ami en demi-cercle, un hostile en chevron, un inconnu ou un neutre en demi-carré ;
  - le trafic civil en losange ;
  - un missile en dard le long de sa route, qui clignote s'il vient sur nous ;
  - une fusée en étoile orange, des paillettes en nuage gris ;
- **les états** : plein (mesuré), plus pâle (prolongé), tireté (datalink), estompé (connu du jeu seulement) ;
- **le verrou** est cerclé, **la sélection** a un anneau ambre tireté.

| écran | ce qu'il montre |
|---|---|
| **Scope du HUD** (celui du Ranger : marqué NOSE, ses ±60°, à la place du panneau d'orbite hors du HUD spatial) | les pistes radar et datalink, le trafic TCAS qui compte, les missiles (trait vers la cible, temps, PITBULL avec l'A-pole, SPLASH ou RATÉ avec le F-pole, LEURRÉ), les leurres, les traînées, les terrains. Un clic sélectionne, la molette change la portée |
| **PCD** : TSD, FCR, DAS, EOTS | la même chose. Le FCR montre les échos du radar seul, la bande DAS ce que tient le DAS. Un toucher sélectionne ; la molette change la portée du TSD et du FCR |
| **Carte tactique** (panneau de droite, M) | OSM de nuit, la trace et la prédiction de l'avion, le plan, les terrains, l'image tactique. La molette va de 2 à 320 km, un clic sélectionne, le coin haut-gauche se tire pour la taille |
| **La vue 3D** | un clic sur un avion le sélectionne (jamais un astre), avec sa fiche |

**Sélectionner** : un clic sur un symbole le sélectionne partout. Un second clic le verrouille, si c'est une piste
radar. Un clic dans le vide désélectionne, et le verrou reste.

**Zoomer** : la molette au-dessus d'un radar change sa portée d'un pas. Elle ne touche jamais au champ de la caméra.

## Les pistes du monde

- **La base** : OurAirports (domaine public), 72 621 terrains et 34 030 pistes. Les seuils manquants sont reconstruits
  et marqués approximatifs.
- **Sur toutes les cartes et tous les radars**, du pilote comme du crew. Le détail suit la portée : un point de loin,
  la piste à l'échelle de près, son contour et ses numéros tout près.
- **En 3D**, autour de l'avion, les pistes sont aplanies comme celles du jeu, avec leurs marquages et leur balisage.
- **Utilisables** : l'ILS, l'approche et l'atterrissage automatiques, le plan de vol, le retour à la base, les cartes
  d'approche, le METAR, TARS et le crew. N'importe quel code OACI ou IATA marche.

## Le crew et la salle

**L'image tactique compacte**, quatre fois par seconde :

- une ligne par piste et un dictionnaire des noms ;
- d'abord ce qui compte : le verrou, la sélection, les hostiles, les missiles, les leurres, ce qui est à moins de
  40 km ; le reste à tour de rôle ;
- un crew qui arrive reçoit les deux dernières minutes de chaque traînée.

300 pistes tiennent dans environ 6 Ko.

**Les deux vues du crew**, deux filtres de la même liste :

- **« Capteur »** : ce que tiennent les capteurs du pilote, aux couleurs de leur IFF. Le scope montre le vrai secteur
  de ±60° et le vrai faisceau du pilote.
- **« Partagé »** : toute la vérité, même en match (la salle en est prévenue). Ce que les capteurs ne tiennent pas est
  estompé, et il n'y a pas de faux balayage.

Les ordres du crew visent une piste par son id. La portée, le nord en haut et la vue sont gardés.

**L'image du vaisseau** au crew, à chaque instantané (12 pistes au plus) : les pistes des capteurs de l'engin dans son
repère LVLH. La vue **Amarrage** les dessine loin d'un port comme le scope spatial du pilote (la même échelle
logarithmique), avec leur liste : distance, vitesse d'approche, écart sur le R-bar, point de rapprochement, RDR / LID /
LIAISON, CACHÉ. Près d'un port, la liste passe sous les chiffres. Une piste touchée ouvre son menu : **Cibler**.

**Le Link 16** entre F-35, deux fois par seconde :

- **qui partage** : toute la salle hors match et dans les matchs qui ne sont pas des combats ; son équipe en combat
  par équipes ; personne en combat libre ni en mêlée générale ;
- **chez le receveur**, l'objet devient une piste datalink. Une piste vue par deux joueurs reste une seule piste.

**En match**, les missiles et les leurres d'un autre joueur sont replacés depuis son avion. Un missile tiré sur nous est
hostile, quel que soit le tireur.

## Réglages

| réglage | défaut | effet |
|---|---|---|
| Radar du HUD, portée, relief | oui, auto, oui | le scope du HUD |
| Traînées | non | l'historique des pistes : non, 30 s, 3 min |
| Traînée du verrou | oui | l'historique du verrou et de la sélection, même traînées coupées |
| Traînées des missiles | oui | les 5 dernières secondes d'un missile, toujours |
| TCAS | oui | l'anticollision pour tout appareil en vol |
