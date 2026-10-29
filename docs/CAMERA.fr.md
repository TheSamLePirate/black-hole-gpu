# La caméra — vol libre, voyages, vues autour de tout appareil

(English: [CAMERA.md](CAMERA.md). Le plan et ses mesures : [PLAN-CAMERA-AAA.md](PLAN-CAMERA-AAA.md).)

## La caméra libre

- **F3** sort la vue de l'appareil piloté (il continue de voler) ; **F1** ramène à bord, le regard gardé (sans saut).
- **Vitesse selon la surface** : en vol libre, la vitesse de la caméra est proportionnelle à sa hauteur au-dessus du
  monde le plus proche — tous les mondes comptés ensemble (un minimum doux) : rien ne saute quand le plus proche
  change. La molette et le curseur du panneau caméra règlent le facteur, une seule plage (× 1/16 … × 32).
- Les touches d'orbite autour d'une cible démarrent et s'arrêtent en douceur (un dixième de seconde), et la focale
  zoome sur un ressort critique : aucun zoom ne part ni ne s'arrête d'une image à l'autre.

## Le voyage — G

Choisir une cible (la carte, la liste des cibles, un clic sur un monde), puis **G** dans la caméra libre. **G** à
nouveau arrête le voyage où il est, au repos avec ce qui est proche. **Espace** le met en pause comme le reste du monde.

- **La fusée relativiste** : accélération propre constante jusqu'à mi-chemin, la même décélération ensuite. Elle est
  freinée près de tout monde (vitesse ≤ k × la hauteur au-dessus de sa surface) : relativiste dans le vide, douce
  près d'une planète. Départ et arrivée en douceur, jamais d'arrêt net en une image.
- **L'allure** (panneau caméra › Voyage) : *selon le trajet* (par défaut : 10⁵ g plafonné à 0,999 c — quelques % de c
  vers la Lune, ~0,93 c vers Mars, ~0,99 c vers Saturne), ou une **vitesse** de pointe, une **durée** sur votre
  horloge τ ou sur celle du monde t, ou une **accélération**.
- **Deux horloges** : le monde avance du temps coordonné t (les planètes ont bougé à l'arrivée) ; la carte du voyage
  montre t, votre temps propre τ, l'écart t − τ, β, γ et l'accélération.
- **La lecture** : une vingtaine de secondes à l'écran (*lecture* dans le panneau) : temps réel près d'un monde,
  l'accélération du temps qui monte dans le vide pour traverser sa propre hauteur au même rythme tout du long.
- **Le regard est libre** : glisser pour regarder autour pendant le voyage — devant, le ciel se resserre et bleuit ;
  derrière, il s'éclaircit et rougit (aberration, Doppler, effet projecteur). Le regard revient sur le cadrage de la
  cible dans les deux dernières secondes.
- **La route ne traverse aucun monde** : elle quitte en spirale le monde de départ et entre de même dans celui
  d'arrivée ; une cible mobile (une lune, l'ISS) est rejointe là où elle sera.
- **Qui voyage** (panneau) : **l'observateur** (la caméra libre ; l'appareil continue), ou **l'appareil lui-même** —
  l'horloge de l'équipage avance de τ et sa mission continue.

## Le voyage ciné — ⇧G

Le même voyage, filmé : un rase-motte sur le monde quitté (900 m au-dessus du sol, relief anticipé — 250 km sur une
géante gazeuse —, vers le côté jour), le voyage, un rase-motte sur le monde atteint, puis la montée au cadrage. Deux
montages (panneau › Voyage › *ciné*) :

- **plan-séquence** : un seul plan continu ;
- **montage** : des coupes — regard en arrière sur le monde quitté, puis devant dans le sens de la vitesse, puis sur
  la cible.

## À travers le trou de ver

Les mondes de Gargantua et le trou noir sont de l'autre côté du trou de ver. Un voyage vers eux depuis notre côté se
fait tout seul : voyage jusqu'à notre embouchure, **descente de la gorge** (un voyage relativiste aussi, le long de la
coordonnée ℓ de la gorge, ralenti dans la gorge même pour qu'on voie la traversée), sortie par l'autre embouchure,
puis la suite vers la cible. Et retour de la même façon. La cible **trou de ver** seule mène à l'embouchure de son côté.

**Un itinéraire** : `__bh.tour(["saturn", "wormhole", "hole"])` voyage vers chaque étape tour à tour, avec une pause à
chacune — depuis la Terre : Saturne, le trou de ver, la gorge, Gargantua.

## La caméra sur tout appareil

Cibler un appareil — de la flotte, l'ISS, un avion de ligne du trafic, un bateau, un ailier, celui d'un autre joueur —
et choisir sa vue dans le panneau caméra :

| tuile | la vue |
|---|---|
| **Autour** | l'orbite autour de lui (glisser, molette = distance) |
| **Poursuite** | derrière lui et un peu au-dessus, ses virages suivis avec retard (molette = distance, glisser = tourner autour) |
| **Cockpit** | à son poste — le cockpit, la passerelle —, regard vers l'avant (glisser = tourner la tête) |
| **Tour** | posée en avant de sa route — au sol, ou dans l'espace en le suivant —, pivotant pour le suivre, la focale resserrée sur lui ; reposée plus loin une fois qu'il est passé et loin |

Choisir une de ces vues arrête le suivi de votre propre appareil par la caméra libre.

## Touches

| touche | dans la caméra libre (F3) |
|---|---|
| G | voyage vers la cible · à nouveau : arrêt |
| ⇧G | le voyage ciné |
| F1 / F3 | retour à bord / sortie |
| molette | la vitesse (en vol), la distance (orbite, poursuite) |
| glisser | regarder autour (aussi pendant un voyage) |
| Espace | pause |

À bord d'un appareil, **G** reste le train d'atterrissage.

## Pour les tests et les outils

- `__bh.goTo(cible)`, `__bh.tour(étapes, pause?)`, `__bh.touring()`, `__bh.voyage()` (les chiffres du voyage),
  `__bh.cam` (le capteur de fluidité : sauts, visées cassées, sauts de focale, cassures de vitesse) — [BH-API.md](BH-API.md).
- e2e : `camera-smooth` (14 situations passées au capteur), `camera-voyage`, `camera-subject` —
  [E2E-CATALOGUE.md](E2E-CATALOGUE.md).
- Films : `bun scripts/camera-video.ts [voyage cine montage subject tour]` — 720p, 30 images/s, image par image (jeu
  figé et avancé pas à pas), encodés par ffmpeg dans `remote-results/camera-video/`.

## Le code

| fichier | rôle |
|---|---|
| `src/camera/voyage.ts` | le plan de la fusée relativiste (pur) : la borne selon la surface, les spirales, la lecture |
| `src/camera/voyager.ts` | le voyage joué par le contrôleur ; la traversée de la gorge (`startThroat`) |
| `src/camera/cinevoyage.ts`, `skim.ts` | le voyage ciné, les rase-mottes |
| `src/camera/subjectcam.ts` | les vues autour d'un appareil |
| `src/camera/speed.ts` | la vitesse selon la surface |
| `src/camera/metrics.ts` | le capteur de fluidité |
| `src/ui/voyagehud.ts`, `src/ui/camerapanel.ts` | la carte du voyage, le panneau caméra |
| `src/main.ts` (`goTo`, `travelTo`, `mouthGoal`, `tour`) | les cibles, la traversée du trou de ver, l'itinéraire |
