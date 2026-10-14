# Plan — l'observatoire : TARS partout, la vue cadrée, le télescope depuis la Terre

Demande (2026-10-14) :
- la recherche d'un lieu (géocodage) aussi pour placer le vaisseau — au sol, à pied, en orbite au-dessus —,
  exacte en WGS84 (et dans l'Atlas) ;
- la même recherche pour TARS, et **toutes** les fonctions du jeu accessibles à TARS ;
- à pied ou en caméra sur Terre : cadrer la vue, puis faire une surimpression **depuis cette vue précise**
  (analemme, filé d'étoiles…) ;
- la caméra posée au sol ne bouge pas, même en ×1000 ;
- depuis la Terre, tout regarder au télescope : chercher quand un astre est visible et aller à cette date ;
- des menus cohérents ; du travail AAA, sans accroc.

Chaque phase : un commit poussé sur `main`, ses tests (unitaires et e2e par vrais événements), sa vérification
en images.

## O0 — La recherche dans « Placer le vaisseau », WGS84 exact (`d15580a`)

- Le panneau Placer cherche par nom en orbite, au sol, à pied : coordonnées tapées, destinations, pistes, adresses de
  la Terre (Photon pendant la frappe, Nominatim sur Entrée — `game/geocode.ts`).
- Le lieu est gardé entier : les champs l'arrondissaient à 0,001° (110 m) et c'est l'arrondi qui était posé.
- En orbite au-dessus d'un lieu : la latitude géodésique était lue comme si la Terre était une sphère (jusqu'à
  0,19°, 21 km). Le vaisseau vise maintenant le point sur la normale du lieu, à la distance de l'orbite à cet
  endroit (`place.overPlace` ; deux passes pour une orbite excentrique). Son nadir est le lieu au milliardième de
  degré.
- Le « vous êtes ici » de l'Atlas et `groundBelow` prennent la latitude géodésique du point à sa hauteur.

## O1 — TARS place par nom ; la caméra tenue au sol en accéléré (`f92129c`)

- `place_ship` prend `query` (piste, destination, adresse, coordonnées : la recherche de l'Atlas) et les modes
  `walk`, `lineup`, `fly`.
- Le panneau, l'Atlas et TARS placent par **un seul chemin** (`placeShip` : mission terminée, monde chargé,
  marcheur remonté à bord, panneaux redessinés).
- **Trépied en ×1000 : 1 410 km de dérive → 3 cm.** Le spectateur naissait avec une horloge vide, lue comme 0 : le
  trépied était posé sur la Terre du début de la scène, à 1,3 million de km de celle dessinée. Il démarre
  maintenant sur l'horloge de la scène. Il est placé à l'horloge du vaisseau que la scène suit, et sa visée est
  relue à l'instant où elle a été placée.
- **Entre deux images** (une touche, un clic, TARS), on lit l'horloge de la scène (`viewTime`), plus celle, en
  retard d'une image, du contrôleur. Le ⇧T pose ainsi le trépied à la place du marcheur au millionième de degré
  (avant : 700 m à côté).
- Test e2e `ground-camera-warp` : trépied (vaisseau en orbite), caméra libre, marcheur, en ×1 / ×1000 / ×10 000,
  avec une rotation de la vue en plein accéléré.

## O2 — La surimpression depuis la vue cadrée (`6c4ee9f`)

- **« Depuis cette vue »** : le lieu, l'azimut, la hauteur et le champ de la vue cadrée (`framedView`) sont gardés
  pour toute la série (analemme, filé, Lune, éclipse dans le ciel du trépied, ISS). L'option est cochée d'office
  quand on ouvre depuis le sol.
- Avant de lancer, on dit ce qui sortirait du cadre (« 12 sur 37 hors de votre cadrage »), avec deux sorties :
  « Lancer quand même » ou « Laisser la série cadrer ». Après la série, la vue est rendue telle qu'elle était
  cadrée (trépied, visée, champ).
- **Accès** : barre du haut (à pied, caméra libre, photo), roue radiale, menu pause, page « Le ciel d'ici »,
  TARS (`multiple_exposure` `fromView`).
- **La série remarche** (elle était cassée depuis la Terre photoréaliste) :
  - chaque pose est une coupe franche : le fondu de visée d'une scène figée ne finissait jamais, et les gros
    plans visaient où était le précédent ;
  - la vue reste placée pendant que le joueur a les mains retirées ;
  - le lieu est gardé entier (arrondi à 0,01°, le Champ-de-Mars devenait la rive de la Seine) ;
  - le trépied s'écarte des bâtiments, des arbres et d'un appareil garé (`clearStand`).
- La visée de la vue était lue dans la représentation du trou de ver (30° d'erreur pour « Le ciel d'ici »). Le
  zénith de l'horizon est maintenant géodésique (WGS84).

## O3 — L'observatoire (ce commit)

- `system/observing.ts` (pur) : où est chaque chose vue d'un lieu (corps du Système solaire avec temps de lumière et
  WGS84, étoile nommée, ISS, embouchure du trou de ver) et ses fenêtres de visibilité, chacune selon sa règle :
  - le Soleil de jour ;
  - la Lune dans n'importe quel ciel ;
  - Mercure et Vénus au crépuscule ;
  - le reste de nuit, à 10° au moins ;
  - l'ISS par ses passages.
  Chaque fenêtre a son meilleur moment (le plus haut).
- `ui/observe.ts` — **l'observatoire** (⇧Y, barre du haut, roue, pause, page « Le ciel d'ici ») : tout ce qu'il y
  a à voir, groupé, avec une recherche. Pour chaque chose : où elle est maintenant, sa prochaine fenêtre, « Viser
  maintenant » et « Au meilleur moment » (l'horloge y va, le télescope dessus).
- **Y à pied** : le trépied posé là où l'on est (à hauteur d'yeux), puis le télescope. Sur un trépied spectateur,
  les touches de la vue (Y, ⇧Y, C, Tab) passent avant celles du vaisseau quitté. Elles agissaient sur la vue du
  vaisseau, que le joueur ne voyait pas.
- **Une étoile est suivie** : tenue au centre pendant que le ciel tourne, comme sur une monture. On la lâche en
  tournant la vue.
- **La visée vise où le rendu dessine l'astre** :
  - là où sa lumière est partie ;
  - aberration par le mouvement de l'observateur (la Terre, 30 km/s) ;
  - réfraction de l'air, celle du rendu (16″ à 46°, un demi-degré à l'horizon).
  Jupiter au télescope (champ de 0,038°) était au bord du champ ; elle est maintenant à 0,003° du centre. Le
  réticule l'entoure.
- **Un saut de date emporte la vue posée sur un sol** (trépied, caméra libre portée par le sol, spectateur) avec
  sa visée, à la même place du sol. Avant, elle restait là où la Terre était.
- Le marcheur, posé entre deux images juste après un saut de date, lisait la Terre d'avant : « aucune sortie
  dégagée ». Il lit maintenant l'horloge de la scène.
- TARS : outil `observe` (`when` : les fenêtres ; `look` : maintenant, au meilleur moment, ou à une date ; `open`),
  commandes `/when` et `/observe`.
- Tests : `observing` (le Soleil à midi solaire à 19°, Jupiter à l'opposition à 64° plein sud, Vénus invisible en
  conjonction, Sirius à 24,5°) ; e2e `observatory` :
  - Y à pied ;
  - ⇧Y, Jupiter cherchée et visée, tenue au centre en ×1000 ;
  - Sirius au meilleur moment par TARS, suivie ;
  - Saturne au meilleur moment par un clic.

## O4 — TARS : le reste du jeu (à venir)

Ce que l'audit trouve encore hors de portée de TARS :
- la préparation d'un vol F-35 ;
- le plan de vol (points de route) et les défis ;
- la musique (mode, thème, intensité, mélange) ;
- l'export, l'import et le partage d'une partie ;
- l'arrêt d'une capture en direct ;
- la météo par préréglage ;
- l'écran titre ;
- le préréglage graphique.
