# Console Équipage

La page `crew/` est une entrée HTML autonome pour rejoindre une salle depuis un ordinateur, un téléphone ou
une tablette peu puissants. Exemple : `https://samlepirate.org/crew/#join=ABCDEF` (ajouter le sous-répertoire du
site lorsque nécessaire). En développement : `http://localhost:3000/crew/`.

Dans le simulateur : **Réseau → Écrans → Instruments** génère son lien et son QR code. La console demande le
nom, le code et, si nécessaire, le mot de passe. Elle rejoint comme `instruments`, sans occuper un des quatre
sièges de pilote ; elle compte parmi les huit appareils de la salle. Chaque document possède une identité
distincte, conservée pendant ses reconnexions, afin de ne pas remplacer le pilote ou un autre onglet.

## Chargement et données

`crew/index.html` ne charge que `src/crew/main.ts` et sa feuille de style. Il importe le client réseau pur,
le protocole, les mathématiques WGS84 et un fond vectoriel. Aucun accès à WebGPU/WebGL, shader, texture,
modèle, moteur de simulation ou moteur audio du jeu. Le build place tous ses fichiers sous `crew/`, en dehors
du précache du simulateur. Le service worker du simulateur laisse passer ces URL et ne les remplace jamais
par sa page principale hors ligne. La console n'installe pas de service worker ; une première ouverture
nécessite donc une connexion.

Les poses existantes alimentent les positions et une télémétrie de secours. Lorsqu'un membre `instruments`
est présent, chaque pilote transmet aussi un événement `instruments` (version 1, au plus 4 Hz). La version 1
ne grandit que par blocs optionnels : une ancienne console les ignore, la nouvelle affiche « indisponible »
pour ce qu'un ancien pilote n'envoie pas.

- les mesures, en SI : altitude, vitesse HUD, vitesse verticale, charge, pression dynamique, Mach, flux
  thermique, gaz, fraction de carburant, taux du temps propre ;
- la position géographique et le cap (coordonnées géodésiques WGS84) ;
- `flight` : assiette, inclinaison, cap, route, pente, incidence, dérapage, TAS/EAS/GS, hauteur sol, facteur
  de charge et sa limite, buffeting, incidence de décrochage, vent, secondes avant le sol (GPWS) ;
- `auto` : mode de vol, niveau d'assistance, consignes ALT/CAP/VIT, PC, LNAV/VNAV, tenue, ordre, assistant
  (hub : titre, phase, prochaine étape, progression) ;
- `nav` : point actif, distance, relèvement, ETE, écart latéral, phase VNAV, T/D, consignes, croisière, bingo,
  carburant et temps restants du plan ;
- `sys` : moteur (régime, poussée, PC, débit), carburant (kg, plein), train, volets, aérofrein, STOVL,
  température de coque, bouclier, dommages, masse ;
- `ils`, `orbit` (apogée, périgée, inclinaison, période, temps aux apsides), `next` (prochain événement),
  `msn` (objectif de mission), `warn` (alertes : FLY UP, PULL UP, STALL, GEAR, BINGO, MISSILE…) ;
- les pistes du radar du pilote, leur identification et le verrouillage ;
- la route (32 points, avec contraintes d'altitude et de vitesse) et la trajectoire prévue (48 points, avec
  leur temps et leur hauteur géodésique) : pour un avion en vol, son virage actuel prolongé sur 3 minutes
  (pas à pas sur l'ellipsoïde WGS84), sinon la trajectoire de chute libre ou planifiée ;
- une fois par seconde, `traffic` et `zones` : le trafic réel (les 64 avions ADS-B les plus proches), les
  unités d'une mission (hostiles, amies, neutres, détruites), les porte-avions, les cibles d'un combat, les
  zones d'objectif et la portée des SAM. La console fusionne les listes de tous les pilotes (sans doublon) et
  les extrapole entre deux envois le long de leur cap (rayons de courbure WGS84).

Le contrat est `src/net/instruments.ts`. Les tableaux et les textes reçus sont bornés, les valeurs non finies
écartées. Après trois secondes sans pose, les mesures actuelles sont remplacées par des tirets et le signal
ancien est annoncé. Les courbes conservent au plus 2 400 points reçus par pilote (pas d'historique antérieur
à la connexion) ; l'export CSV contient les mesures SI reçues.

## Les vues

Toutes dessinées en canvas 2D, à la demande (nouvelles données, geste, lissage des valeurs reçues à 4 Hz) :
seuls le balayage du radar et une alerte clignotante entretiennent l'animation, à 30 images/s au plus. Le
tampon suit la densité de l'écran, borné à ~4 Mpx.

| vue | contenu |
|---|---|
| Tableau | PFD + ND ; sur grand écran aussi la carte et le plan de vol. Toucher un panneau l'ouvre |
| Vol (PFD) | horizon, échelle de tangage, inclinaison et dérapage, vecteur vitesse, rubans vitesse (consigne, tendance) et altitude (consigne, sol), vario, cap (consigne, route, point actif, objectif), FMA, ILS, hauteur radio, G, α |
| Navigation (ND) | arc cap en haut ou rose nord en haut, route (branche active magenta), T/D, prédiction, vent, trafic façon TCAS (hauteur relative), navires, unités, zones, joueurs, pistes radar |
| Carte | OpenStreetMap de nuit, Web Mercator, zoom continu ; traînée colorée par l'altitude, prédiction minutée, plan, zones, tous les contacts, joueurs ; étiquettes sans chevauchement |
| Globe | orthographique ombré, atmosphère, étoiles, continents remplis |
| Radar | balayage et rémanence ; positions partagées (joueurs + trafic + unités) ou capteur du pilote ; liste triée par distance |
| Systèmes | moteur, carburant (bingo, autonomie, rayon, à l'arrivée), configuration, charge/incidence, structure, pilote automatique et assistance, orbite, alertes |
| Plan de vol | profil vertical (niveaux, contraintes, T/D, hauteurs prévues) et branches (distance, ETE, ETA, altitude, vitesse), carburant à l'arrivée |
| Télémétrie | une mesure (min/moy/max, curseur) ou quatre empilées |

Unités : métrique par défaut, impérial en option (bouton de l'en-tête ou TARS) ; seul l'affichage change.

### Géodésie

Tout ce qui touche la Terre passe par WGS84 (`src/system/ellipsoid.ts`) : distances et azimuts par
`wgs84Inverse` (Andoyer–Lambert sur l'ellipsoïde, azimut dans l'est/nord géodésique), décalages locaux par
`wgs84Offset` (rayons de courbure), hauteurs géodésiques. La carte utilise Web Mercator (EPSG:3857, la
projection des tuiles OSM, définie sur les coordonnées WGS84). Les autres corps sont des sphères ; une grille y
situe la trace. Les positions inertielles ne sont jamais interprétées comme terrestres ; sans position
géographique fournie par le pilote, la vue l'indique, et les distances locales de Gargantua sont indisponibles.
Les vues relatives ne comparent que des poses dans le même corps et le même repère.

### Fond de carte

Tuiles `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, chargées seulement quand une carte est affichée
(cache de 400 tuiles, la tuile parente en attendant), passées en mode nuit par composition canvas (inversion,
teinte bleue, assombrissement). Crédit « © OpenStreetMap contributors » toujours visible. Hors ligne, ou si les
tuiles échouent, la carte garde le fond vectoriel Natural Earth (continents remplis). Les tuiles CARTO
« Dark Matter » exigent désormais une clé d'API et ne sont donc pas utilisées.

## Commandes tactiles et radio

Toutes les commandes sont accessibles sans clavier ni survol, en portrait et en paysage. Glisser déplace la
carte ou tourne le globe ; pincer règle le zoom ou la portée. Des boutons permettent aussi de zoomer,
déplacer, recentrer, suivre, ajuster la portée et sélectionner les joueurs ou les contacts. La télémétrie
propose le choix de la mesure, de la durée, la consultation figée, un curseur tactile et le CSV.

**Écouter** active la réception sans demander le microphone. **Activer le micro** demande la permission ;
le microphone reste silencieux jusqu'à la commande de transmission. Maintenir **Parler** pour émettre,
relâcher pour couper, ou choisir **Toucher pour parler** pour une commande à bascule. Le bouton est aussi
utilisable au clavier (Espace/Entrée) ou par activation accessible. Le volume et la coupure sont réglables
par membre. Les deux modes de transmission ne sont pas enregistrés comme un micro ouvert au prochain accès.

Une annulation du geste, la perte de capture, la perte de focus de la fenêtre, une page masquée, la coupure du
microphone ou la perte de connexion ferme la transmission. Une permission obtenue après annulation ne peut
pas ouvrir le micro. Une reconnexion exige une nouvelle commande. Une seconde main peut manipuler la carte
pendant que la première tient le bouton radio.

Le transport est le WebRTC existant : signalisation par le serveur de salle, STUN et TURN configuré sur ce
serveur. La voix n'a pas de repli WebSocket. Le microphone nécessite HTTPS (localhost accepté) et une
permission ; l'audio peut nécessiter une interaction explicite, notamment sous Safari. L'arrière-plan et
la reprise après verrouillage doivent être vérifiés sur l'appareil cible ; aucune continuité d'émission
en arrière-plan n'est promise.

Dans le simulateur classique, le réglage radio existant qui coupe les appareils du même réseau s'applique
aussi à la voix d'une console sur ce réseau. Le désactiver côté pilote si cet appareil doit être entendu.

## TARS et automatisation

TARS dispose ici d'une console locale, sans modèle en ligne ni chargement de l'application classique. Il
lit seulement les mesures reçues et exécute les mêmes actions que les contrôles : `carte`, `globe`, `radar`,
`tableau`, `vol`, `navigation`, `systèmes`, `plan`, `télémétrie`, `courbes`, `trafic`, `impérial`/`métrique`, `suivre Ana`, `zoom +`, `centrer`, `ajuster`, `portée 50`, `nord`, `cap`, `capteur`,
`joueurs`, `pause`, `direct`, `courbe Mach`, `écouter`, `couper micro`, `export CSV` ou une mesure comme
`carburant`. Il ne peut ni piloter ni modifier le vol distant.

Dans l'application classique, TARS peut ouvrir le partage et son QR via `show_screen(crew_console)`.

L'interface d'automatisation est `window.__crew`, indépendante de `__bh` :

| membre | usage |
|---|---|
| `net` | `NetClient` : salle, membres, état, horloge, mesh, microphone |
| `model` | `crafts()`, `own()`, `selected`, `history`, `csv()` |
| `views` | vue, zoom, portée en mètres, orientation, suivi, canal, fenêtre en secondes, inspection |
| `radio` | `listen()`, `enableMic()`, `disableMic()`, `gate`, `speaking(slot)`, `volume(slot, value?)`, `mute(slot)` |
| `join(code, name, password?)` | rejoindre comme instruments (Promise) |
| `setView(view)` | `dash`, `pfd`, `nd`, `map`, `globe`, `radar`, `schematic` (systèmes), `plan`, `telemetry` |
| `askTars(text)` | commande locale, réponse texte (Promise) |

## Vérification

`bun test tests/crew.test.ts tests/pwa-rules.test.ts` vérifie le garde de transmission, le contrat, WGS84 et
les frontières du build et du cache. `bun run e2e crew` exerce une salle réelle, les cinq vues à 390×844,
1024×768 et 844×390, une conversation WebRTC entre deux pages du même Chrome, le PTT à plusieurs doigts,
les interruptions et les permissions retardées, puis les mesures émises par le vrai simulateur (avec ses blocs
`auto`, `sys`, `warn`) et le lien de ses Écrans.

`bun scripts/crew-demo.ts [ws://localhost:3000/net]` ouvre une salle scriptée sans simulateur : deux pilotes
de Paris à Lyon (plan, prédiction, pilote automatique, systèmes, alertes), 36 avions de ligne, un porte-avions
et un ferry, des unités et des zones de mission. Il affiche le lien `/crew/#join=CODE`. Captures : `remote-results/crew-*.png`. Le WebGPU est rendu inaccessible dans la console
pendant ce test. Safari/iPadOS et les chemins TURN réels demandent une validation sur appareil/réseau réel.

Fond vectoriel : Natural Earth, domaine public, `ne_110m_coastline.geojson`, issu de
https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_coastline.geojson ; un point sur deux
conservé (ainsi que les extrémités), coordonnées arrondies au centième de degré dans `src/crew/coastlines.json`.
Conditions : https://www.naturalearthdata.com/about/terms-of-use/.
