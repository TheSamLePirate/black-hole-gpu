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
est présent, chaque pilote transmet aussi un événement `instruments` (version 1, au plus 4 Hz) avec :

- les mesures disponibles, en SI : altitude, vitesse HUD, vitesse verticale, charge, pression dynamique,
  Mach, flux thermique, gaz, fraction de carburant et taux du temps propre ;
- la position géographique et le cap (coordonnées terrestres géodétiques WGS84) ;
- les pistes du radar du pilote, leur identification et le verrouillage ;
- jusqu'à 32 points de route terrestre et 48 points de trajectoire future autour du corps courant.

Le contrat est `src/net/instruments.ts`. Les tableaux et les textes reçus sont bornés, les valeurs non finies
écartées. Les anciens clients restent compatibles : sans cet événement, les mesures avancées sont indiquées
indisponibles. Après trois secondes sans pose, les mesures actuelles sont remplacées par des tirets et le
signal ancien est annoncé. Les courbes conservent au plus 2 400 points reçus par pilote (pas d'historique
antérieur à la connexion) ; l'export CSV contient les mesures SI reçues.

Les cartes et le globe utilisent un fond terrestre vectoriel. Pour les autres corps, une grille permet de
situer la trace reçue. Les positions inertielles ne sont jamais interprétées comme terrestres ; sans position
géographique fournie par le pilote, la vue l'indique. Les distances locales de Gargantua sont indisponibles.
La vue schématique et la vue joueurs comparent uniquement des poses dans le même corps et le même repère.
Le radar **Positions joueurs** est distinct du mode **Capteur du pilote**, qui affiche les seules pistes
réellement transmises par ce pilote.

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
`schéma`, `télémétrie`, `suivre Ana`, `zoom +`, `centrer`, `ajuster`, `portée 50`, `nord`, `cap`, `capteur`,
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
| `setView(view)` | `map`, `globe`, `radar`, `schematic`, `telemetry` |
| `askTars(text)` | commande locale, réponse texte (Promise) |

## Vérification

`bun test tests/crew.test.ts tests/pwa-rules.test.ts` vérifie le garde de transmission, le contrat, WGS84 et
les frontières du build et du cache. `bun run e2e crew` exerce une salle réelle, les cinq vues à 390×844,
1024×768 et 844×390, une conversation WebRTC entre deux pages du même Chrome, le PTT à plusieurs doigts,
les interruptions et les permissions retardées, puis les mesures émises par le vrai simulateur et le lien
de ses Écrans. Captures : `remote-results/crew-*.png`. Le WebGPU est rendu inaccessible dans la console
pendant ce test. Safari/iPadOS et les chemins TURN réels demandent une validation sur appareil/réseau réel.

Fond vectoriel : Natural Earth, domaine public, `ne_110m_coastline.geojson`, issu de
https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_coastline.geojson ; un point sur deux
conservé (ainsi que les extrémités), coordonnées arrondies au centième de degré dans `src/crew/coastlines.json`.
Conditions : https://www.naturalearthdata.com/about/terms-of-use/.
