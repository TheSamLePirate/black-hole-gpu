# Plan — réseau : la 2ᵉ vue et le jeu à plusieurs

Demande (2026-10-02) : 
- **Vue en réseau** : un 2ᵉ appareil (ordinateur, tablette, téléphone) devient une 2ᵉ caméra, synchronisée avec le monde.
- **Jeu en réseau** : être plusieurs dans le même monde.

Le tout de la meilleure qualité possible, dans le système solaire **et** dans celui de Gargantua.

Décisions de l'utilisateur :
- **2ᵉ appareil** : il fait son propre rendu (WebGPU) et peut aussi servir d'**écran instruments** (carte 3D, ground track, écrans cockpit). Sa caméra est **libre**, avec tous les modes de la caméra classique. Il **regarde seulement** : il n'agit pas sur la partie.
- **Public** : entre amis, à distance et dans la même pièce. **4 joueurs au maximum.**
- **Infra** : le serveur dédié de l'utilisateur (en France, `samlepirate.org` derrière nginx-proxy-manager, Portainer, HTTPS). Cloudflare est accepté si besoin.
- **Temps** : **hybride**. Les joueurs ensemble partagent une horloge, sinon chacun a son sous-espace.
  - Le warp commun se décide **au vote**.
  - Un joueur dans une forte dilatation (Miller) **sort automatiquement de la bulle** et vit son temps propre en ×1. Les autres le retrouvent « des années plus tard », comme dans le film.
- **Persistance** : **monde persistant**, une salle par partie, conservée tant qu'on ne la supprime pas.
- **Engins** : **chacun son Ranger**. Tout engin libre est pilotable par n'importe qui, Endurance comprise.
- **Interactions** : collisions et amarrages entre joueurs.
- **Destruction** : on **réapparaît où l'on veut**.
- **Voix** entre joueurs par WebRTC (ajoutée le 2026-10-02).
- **Le réseau est une option** (2026-10-03) : on peut toujours jouer seul, exactement comme aujourd'hui. Voir « Solo ou réseau ».

## État de départ (exploration du 2026-10-02, revue le 2026-10-03 à `e9b772f`)

- **Le jeu n'est pas déterministe d'une machine à l'autre.**
  - Le pas `dt` suit l'horloge murale, borné à 0,1 s (`main.ts:1558`).
  - Le nombre de sous-pas dépend du framerate (`controls.ts:1356`).
  - Le planificateur tourne en worker asynchrone. Depuis la refonte du vol, ses tâches `deorbit` et `guide` pilotent la rentrée, cadencées par `performance.now()`.
  - Les hauteurs du sol viennent des tuiles chargées autour de chaque caméra.
  - Le TLE de l'ISS est téléchargé par chaque client.
  - → **On synchronise l'état, pas les commandes** : pas de lockstep possible.
- **Les corps sont déterministes en `t`** : DE440, orbites de Kerr, `endurancePose`. Ils ne transitent jamais par le réseau, chacun les recalcule.
- **Le vaisseau piloté est la caméra.** Sa pose est dans `Settings` (`setHolePose`, `setRepPose`, `setHomePose` dans `camera.ts`).
  - Le lancer de rayons part toujours du vaisseau.
  - Les vues extérieures ne déplacent l'œil que de quelques km (`renderer.ts:1448`).
- **L'horloge de la scène suit l'intégrateur du vaisseau** (`sim.ts:56`, `shipClock`).
  - Dans l'air, le pilote a un sous-pas propre : `dtPilot = dt·min(warp, 4)` (`controls.ts:2655`).
  - Le warp `timeSpeed` est en **temps coordonnée**.
  - Chaque vaisseau a son temps propre (`properTime`).
- **Les engins non pilotés sont dessinés comme des « autres »** (`renderer.shipOthers`), avec trois limites :
  - de notre côté seulement (`region === "throat" && ell < 0`) ;
  - à moins de 60 km ;
  - 8 instances au maximum (`MAX_INST`, `ship.ts:100`).
- **La flotte** (`fleet.ts`) :
  - Il n'existe que 3 `VesselId` (ranger, lander, endurance).
  - Les engins libres sont **sur rails képlériens** (`keplerProp`), donc déterministes en `t`.
  - Les amarrages sont des `links`.
- **Sérialisation existante** :
  - `GameSave` (`game/save.ts`) contient presque tout l'instantané, mais pas la flotte (`Fleet.toJSON()` jamais appelé), ni le pistage local de l'ISS, ni `pilot.omega`.
  - `load()` garde déjà les réglages propres à chaque appareil.
  - `Take` (`take.ts`) enregistre les différences de `Settings` image par image : c'est le modèle du flux « marionnette ».
- **Aucun code réseau.** `server.ts` est un `Bun.serve` sans WebSocket. GitHub Pages est statique.
- **Mobile** :
  - WebGPU tourne sur Safari 26 (iOS/iPadOS) et sur Chrome Android.
  - Un téléphone est en tier 1 (0,9 Mpx).
  - **WebGPU exige HTTPS**, donc un téléphone ne peut pas utiliser `http://192.168.x.x`.
- **Refonte du vol et de la carte terminée** : PLAN-ATMOSPHERE-ORDINATEUR P1–P9 et PLAN-CARTE C1–C8. `controls.ts` fait maintenant **7 400 lignes**. Ce qu'elles ajoutent et qui concerne le réseau :
  - **Les autopilotes écrivent `s.timeSpeed` à chaque image** :
    - plafond ×4 dans l'air (`AIR_WARP`, `flightair.ts:18`, `controls.ts:2649`) ;
    - rentrée : attente à ×1000, poussée à ×1, chute à ×500, puis ×4 dans l'air, et ×1 sous 1 500 m (`controls.ts:3018-3058`, `3544`) ;
    - poussées du calculateur de vol (`controls.ts:3486`).
    - Le warp n'est plus « une décision du joueur » : c'est aussi une décision des autopilotes.
  - **État visuel propre au vaisseau piloté** :
    - le renderer reçoit `shipReentry` (plasma, peau chaude), `shipContrails` et `shake` par `sim.applyRender` (`sim.ts:75-120`) ;
    - `ship.ts` ne dessine plasma, lueur, jets et traînées **que pour l'engin piloté** (`this.flown`, `ship.ts:754, 823`) ;
    - il n'y a qu'un bloc d'uniformes de rentrée et un seul tampon de traînée.
  - **Les traînées de condensation sont une histoire, pas un état instantané** (`contrails.ts`, avancé dans `applyRender`).
  - **Mode de vol, antigravité et dégâts sont des réglages globaux** (`Settings.flightMode`, `antigrav`, `damage`, `settings.ts:258-260`), pas des propriétés de chaque engin.
  - **Une seule instance** d'`AirFlight` (thermique, volets, aérofreins, train, panne, g), d'`entryRun`, d'`entrySite`, de `fcBurns` et de `launchGoal`. Deux autopilotes nouveaux : `entry` et `burns`.
  - **Destruction en solo** (`onCraftLost`, `main.ts:1424`) : **pause globale** (`settings.animate = false`), puis « reprendre » recharge l'instantané pris à l'entrée dans l'air. On **remonte donc le temps**.
  - **Le regard du cockpit** (`syncLook` / `markLook`, `controls.ts:1328`, `2217-2240`) : si seuls les angles du regard changent, la caméra tourne et le vaisseau reste. Si la pose change aussi, tout est pris tel quel.
  - **Carte, HUD et calculateur de vol sont bien découplés** :
    - `Map3D.draw(Info)` avec `MapHost` ;
    - `FlightHud(s, actions)` ;
    - `FlightComputer(FcHost)`.
    - Ils ne lisent que `Info` (= `flightInfo()` + sonde + statut) et `Settings`.
    - La carte GPU emprunte le device et les cartes de planètes du renderer (`renderer.mapGpuSource()`). Sans renderer, elle se rabat sur Canvas 2D.
    - La carte et le ground track codent en dur `CRAFT = ["ranger","lander","endurance"]` (`map3d/scene.ts:23`), avec la Terre comme parent.
  - **Son** :
    - le grondement de rentrée et le vent vont directement dans le bus `listener`, pas dans `engine` ;
    - le director a besoin de `info.air` ;
    - `Mix` ne compte que master, beeps, engines, ambience, ui.
  - **Documentation d'architecture** : `docs/systemes/` (README, fiches 01–09). La fiche 04 §8–9 couvre la flotte et tous les limiteurs de warp, la fiche 08 la boucle, la fiche 09 le son, le serveur et Pages. Ses numéros de ligne ont dérivé : le code fait foi.

## Architecture

### Solo ou réseau

**Le jeu solo reste le jeu par défaut, et reste entier sans réseau.** Le réseau ne s'active que sur une action explicite du joueur.
- **Aucune connexion au démarrage.**
  - La page ne contacte `samlepirate.org` que lorsqu'on crée ou rejoint une salle, ou qu'on ajoute un écran.
  - Pas de télémétrie, pas de « présence ».
  - Si le serveur est absent ou en panne, le solo ne s'en aperçoit pas.
- **Le code réseau est chargé à la demande.**
  - Le module réseau est un bundle à part (`net.js`, chargé par URL comme `plan-worker.js`, ou par `import()` dynamique avec `--splitting`, à trancher en N0).
  - Le solo ne télécharge ni ne compile une ligne de réseau.
  - La taille du bundle solo est mesurée avant et après.
- **En solo, les accroches sont transparentes** :
  - `wantWarp()` applique directement ;
  - l'horloge suit le vaisseau comme aujourd'hui ;
  - `onCraftLost` garde la pause et le « reprendre avant l'entrée » ;
  - les autopilotes, les sauvegardes et l'autosave sont inchangés.
- **Les façons d'entrer en réseau**, toutes dans un menu **Réseau** (panneau et écran d'accueil) :
  - **Ajouter un écran** : depuis une partie solo, un QR code ouvre une salle **privée** (sans autre pilote) pour une 2ᵉ vue ou un écran instruments. Le jeu reste « solo » pour tout le reste (pas de vote de warp, destruction du solo).
  - **Ouvrir ma partie au réseau** : la partie solo en cours devient une salle (instantané envoyé au serveur), et des amis peuvent la rejoindre comme pilotes.
  - **Rejoindre une salle** : code, lien ou QR.
  - **Mes salles** : reprendre une salle persistante, ou la supprimer.
- **Quitter le réseau** :
  - Quitter une salle ramène à sa partie solo, telle qu'on l'avait laissée.
  - Les mondes des salles et les sauvegardes solo sont **séparés** : une salle ne réécrit jamais l'autosave solo.
  - Option : « garder une copie en solo » crée une sauvegarde solo à partir de l'état de la salle (son vaisseau, son `t`).
- **Pendant une coupure réseau** : on continue de voler en local, avec un bandeau « hors ligne ». La reconnexion est automatique.
- **Un réglage Réseau** dans les paramètres permet de **masquer entièrement** le menu et les boutons réseau.

### Un monde fait de lignes d'univers

**Chaque engin est une ligne d'univers** : une suite d'échantillons datés en temps coordonnée `t`. Chaque échantillon contient :
- **l'état** : position et vitesse en float64, attitude en quaternion, vitesse angulaire ;
- **le repère** :
  - corps X de notre côté (Kepler autour du parent) ;
  - Kerr en Boyer-Lindquist avec la 4-vitesse ;
  - gorge du trou de ver (ℓ, n) ;
  - posé sur le corps X à lat/lon ;
- **l'état visuel et sonore** (de quoi alimenter le rendu et le director audio du client distant) :
  - poussée de chaque moteur et RCS ;
  - rentrée : plasma, peau chaude (le contenu de `Reentry`, `ship.ts:87`) ;
  - air : densité, Mach, `cl` (coefficient de portance) — de quoi **recalculer les traînées de condensation sur place** ;
  - thermique (bouclier, coque), g ;
  - mode de vol (fusée, avion, calculateur) et antigravité, **par engin** ;
  - train, volets, aérofreins : aujourd'hui sans effet visuel, sauf les manches du cockpit, transmis pour l'avenir ;
  - autopilote actif et sa phase (`entry`, `burns`, `node`…) ;
  - état d'amarrage, dégâts, destruction.
- Le flux marionnette n'est **pas** `Take` : `TakeState` n'a ni rentrée, ni traînées, ni secousses. `Take` reste le modèle (une différence de réglages par image), mais le flux réseau a son propre format.

**Lire une ligne d'univers à un instant `t` :**
- **Dans l'historique** : on interpole avec une spline d'Hermite, dans le repère du corps le plus proche.
- **Au-delà du dernier échantillon** : on propage avec la physique, sans jamais extrapoler en ligne droite.
  - Kepler de notre côté (`keplerProp`) ;
  - géodésique côté Gargantua (`geodesic.ts`) ;
  - au sol, on colle le vaisseau au terrain **local** (les tuiles diffèrent selon les machines).
- **Débit** :
  - **En croisière ou en warp sur rails, un message par changement d'orbite suffit.** La position reste exacte même à ×4747.
  - En vol propulsé, on envoie 20 Hz (~4 Ko/s par engin). Les échantillons ne sont émis que quand la prédiction s'écarte de la réalité : on fait du *dead reckoning* sur la physique.
- **Rafraîchissement** : chaque appareil affiche chaque engin à **son propre** `t`. Un engin dont l'état n'est pas encore connu à ce `t` (dans votre futur, ou joueur déconnecté) apparaît en **fantôme** translucide, sur sa trajectoire propagée.

### Le temps : bulles et sous-espaces

- **Bulle** : un groupe de joueurs qui partagent une horloge en temps coordonnée.
  - L'horloge de la bulle mène le jeu. L'intégrateur du vaisseau avance **jusqu'à** l'heure de la bulle. Aujourd'hui c'est l'inverse (`shipClock`).
  - La dérive entre machines est corrigée en modulant `timeSpeed` de ±1 %. C'est invisible et il n'y a jamais de saut.
- **Le warp au vote** :
  - Une **hausse** est proposée à la bulle et **appliquée si tout le monde accepte**. Délai de 10 s, au-delà c'est un refus.
  - Une **baisse est immédiate** pour toute la bulle, sans vote (sécurité : manœuvre, atterrissage).
  - **Après un refus**, le demandeur peut « partir seul » : il quitte la bulle et devient son propre sous-espace.
- **Un arbitre du warp.** Les autopilotes écrivent `s.timeSpeed` à chaque image ; en multijoueur, ces écritures deviennent des **souhaits**.
  - Dans l'accroche « horloge », chaque écriture passe par une fonction unique `wantWarp(x, raison)`. En solo, elle applique directement : rien ne change.
  - En bulle, l'arbitre décide :
    - **une baisse** (plafond ×4 dans l'air, poussée à ×1, vol plané sous 1 500 m) s'applique **tout de suite à toute la bulle** ;
    - **une hausse** (attente de rentrée à ×1000, chute à ×500, croisière) **dépose un vote**.
  - En attendant le vote, l'autopilote continue au warp courant. Ses phases attendent des conditions sur le temps coordonnée, donc l'attente dure seulement plus longtemps. À vérifier phase par phase en N5.
  - Conséquence acceptée : un joueur qui fait sa rentrée tient toute la bulle à ×4 pendant la traversée de l'air. Les autres peuvent quitter la bulle s'ils veulent accélérer.
- **Dilatation** (décision 3b) :
  - En multijoueur, le ×1 d'un joueur est **son temps propre**.
  - Une bulle n'admet que des joueurs dont les rythmes `dτ/dt` concordent (tolérance à régler, ~1 %).
  - Si un joueur descend sur Miller (`dτ/dt ≈ 1/60 000`), il **sort automatiquement** de la bulle. Son horloge coordonnée file alors ×60 000.
- **Rattrapage** : on ne remonte jamais le temps. Celui qui est dans le passé peut avancer jusqu'au `t` d'un autre, et ils reforment une bulle. Exemple :
  - Romilly, resté en orbite, voit le joueur remonté de Miller arriver « 23 ans plus tard ».
  - Il le voit en fantôme tant qu'il n'a pas rattrapé.
  - Le rattrapage est une avance rapide **qu'il vit**.
- **Causalité des engins partagés** :
  - **Un engin piloté appartient à son pilote.**
  - **Un engin libre n'est modifiable** (prendre les commandes, s'y amarrer, le heurter) **que par quelqu'un dont le `t` est postérieur à son dernier événement**.
  - Ceux qui sont dans son passé le voient suivre sa ligne d'univers, verrouillé, jusqu'à ce qu'ils rattrapent.
- **Historique conservé** : seulement à partir du plus petit `t` des joueurs de la salle, puisque personne ne peut voir plus tôt. Le stockage reste donc borné.

### Autorité

- **Chaque joueur fait autorité sur l'engin qu'il pilote.** Il n'y a pas d'anti-triche : on est entre amis.
  - Il n'existe toujours **qu'un seul vaisseau simulé par machine**, le `CameraController` local.
  - Les autres engins sont des **proxys cinématiques** : on ne refond pas le contrôleur, qui suppose un seul vaisseau.
- **Le serveur fait autorité sur** :
  - les bulles et les votes de warp ;
  - les **baux** des engins (qui pilote quoi) ;
  - l'ISS (un seul TLE pour tous) ;
  - la persistance ;
  - l'instantané d'entrée dans la salle.
- **Collision** :
  - Celui qui la détecte (`stationContact` étendu aux proxys) envoie les deux états à l'instant `t`.
  - L'impulsion est partagée selon les masses, comme aujourd'hui.
  - Chaque pilote applique sa part.
- **Amarrage** :
  - L'assemblage a **un seul pilote**, celui qui manœuvrait.
  - L'autre devient **passager** : il garde ses caméras et ses écrans.
  - Au désamarrage, chacun reprend son engin.
- **Destruction** :
  - En multijoueur, **ni pause globale ni retour en arrière** : on ne réutilise pas le « reprendre avant l'entrée » du solo, qui remonte le temps. Le solo garde son comportement.
  - La ligne d'univers se termine par un événement « détruit ».
  - Un menu **Réapparaître** propose un Ranger neuf **où l'on veut**, en réutilisant le placement des outils de jeu (`game/place.ts`) :
    - sur un pas de tir ;
    - en orbite autour de n'importe quel corps ;
    - près d'un ami ;
    - à bord de l'Endurance (sur un port libre).
- **Réglages de la salle**, fixés à sa création et identiques pour tous :
  - « sans dégâts » (`damage`) ;
  - délai de la lumière ;
  - coupure radio.
  - Le mode de vol et l'antigravité restent **propres à chaque engin** (choisis par son pilote).

### Les places dans une salle

| Place | Ce qu'elle fait | Son horloge |
|---|---|---|
| **Pilote** (4 au maximum) | pilote son Ranger ou tout engin libre | sa bulle |
| **Observateur** | caméra libre avec **tous** les modes classiques : orbite, libre, trépied, look-at, télescope, plongée, et les mounts attachés à **n'importe quel** engin (cockpit, chase, fly-by…) | celle du joueur qu'il suit |
| **Instruments** | carte 3D, ground track, écrans cockpit d'un joueur, en lecture seule | celle du joueur suivi |

- **8 appareils au maximum par salle** : 4 pilotes, plus des observateurs et des écrans instruments.
- **Rejoindre une salle** :
  - Un QR code ou un lien `https://thesamlepirate.github.io/black-hole-gpu/#join=CODE` ouvre la page en HTTPS.
  - L'appareil reçoit l'instantané : scène, `GameSave` + flotte, TLE, lignes d'univers.
  - Il choisit sa place.
  - Il garde sa qualité, son son et son tier.
- **Caméra attachée à l'engin d'un autre** : le rendu place la caméra à l'origine du vaisseau piloté. L'engin suivi est donc **rejoué en marionnette**, avec les mounts et le regard propres à l'observateur.
  - La marionnette écrit la pose **et** le regard ensemble, par le même chemin que `syncLook`.
  - Elle alimente aussi `shipReentry`, la secousse et les traînées (recalculées sur place), et le **director audio** : l'observateur entend le grondement de la rentrée qu'il regarde.
- **Caméra libre** : `s.ship = false`, et tous les engins sont dessinés comme des « autres ».

### Rendu des autres engins (le chantier dur)

- **Lever les limites de `shipOthers`.** Il faut passer de « notre côté, 60 km, 8 instances » à « des deux côtés, sans limite de distance, ~12 instances » :
  - 4 Rangers ;
  - le Lander, l'Endurance, l'ISS ;
  - de la marge.
- **Près de Gargantua** : à quelques centaines de km, l'espace est plat à 10⁻⁹ près (M ≈ 1,5·10¹¹ m). On exprime l'écart en coordonnées BL dans le repère local de la caméra (ZAMO, puis boost). Le maillage s'affiche exactement, ombres et sonde de lumière comprises.
- **Au-delà** (engin plus petit qu'un pixel) : on affiche un **marqueur HUD dont la direction est déviée par la lentille gravitationnelle**, grâce à `bodyLook` étendu à une position quelconque. On peut voir l'image d'un ami tordue par le trou noir. À travers la gorge du trou de ver, un marqueur indique « de l'autre côté ».
- **Leur rentrée et leurs traînées aussi** : aujourd'hui `ship.ts` ne les dessine que pour l'engin piloté.
  - Il faut passer à des **données de rentrée par instance** (plasma, peau chaude, jets) dans `ShipInstance`.
  - Il faut **un tampon de traînée par engin**, recalculé sur place à partir des échantillons.
  - La rentrée d'un ami se voit alors depuis le sol ou depuis l'orbite.
- **Les autres engins sont aussi des cibles HUD et des objets sur la carte 3D**, avec le pseudo et la couleur du joueur.
  - La liste codée en dur `CRAFT` de la carte et du ground track (`map3d/scene.ts:23`) devient la liste des engins de la salle, avec leur vrai parent (pas toujours la Terre).

### Transport

- **Serveur de salles en Bun** (`server/net.ts`), avec `Bun.serve` et WebSocket :
  - signalisation, relais, autorité, persistance ;
  - `bun:sqlite` pour les salles et les lignes d'univers.
  - Il partage le code du dépôt : protocole, propagation, tests.
  - En dev, le même module se branche sur `server.ts`.
- **À distance** : tout passe par le WebSocket. Le serveur est en France, donc ~10–30 ms entre amis français, et un tampon d'interpolation de ~100 ms rend les vues fluides.
- **Dans la même pièce** : **WebRTC direct** entre appareils.
  - Les candidats locaux et mDNS suffisent, sans TURN.
  - Les poses passent en canal non fiable et non ordonné, avec ~1 ms de latence et un tampon réduit à ~30 ms.
  - Si la connexion directe échoue, on revient automatiquement au WebSocket.
- **Les données du jeu n'ont besoin d'aucun port UDP.** À distance, elles passent par le serveur, qui est proche.
- **La voix, en revanche, va en direct d'un joueur à l'autre, à distance aussi** (voir « La voix »).
  - Elle passe par STUN (gratuit), et par un relais TURN quand la connexion directe est impossible.
  - Ce cas est fréquent sur les téléphones en 4G/5G, dont l'opérateur partage les adresses (CGNAT).
- **Même machine** (2ᵉ fenêtre sur un 2ᵉ écran) : `BroadcastChannel`, sans réseau.
- **Protocole** :
  - binaire (`Float64Array` pour les états) et versionné ;
  - le serveur accepte les versions N et N−1 ;
  - un client obsolète est invité à recharger la page ;
  - l'instantané est en JSON compressé (`CompressionStream`).
- **Synchro d'horloge** : échanges à la NTP sur le canal, puis filtrage du décalage et de la dérive.
- **Labo réseau** : latence, gigue et pertes simulées dans la couche de transport (réglage de dev) pour tester à 200 ms et 5 % de pertes.

### La voix

- **Réseau : chaque joueur parle directement à chacun des autres (maillage WebRTC), sans serveur audio.**
  - Avec au plus 8 appareils, cela fait au plus ~220 kb/s montants par personne qui parle. Un serveur de mixage audio (SFU : LiveKit, mediasoup) ne s'impose pas, et il exigerait des ports UDP.
  - **Le serveur ne fait que la mise en relation** (signalisation) sur le WebSocket existant. **Il ne transporte ni n'enregistre jamais l'audio.**
- **Connexion (ICE)** :
  - en premier lieu, connexion directe (candidats locaux, ou STUN sur notre propre coturn) ;
  - sinon, relais **TURN** : **coturn sur le Kimsufi** (voir « Hébergement »).
    - Le serveur est dédié, avec une IP publique et sans box devant : il suffit d'ouvrir les ports.
    - Aucun compte tiers. Une heure de voix pèse ~15 Mo par flux.
    - **Identifiants de courte durée** (« TURN REST API ») : coturn et le serveur Bun partagent un secret, et le serveur fabrique pour chaque joueur un identifiant HMAC valable quelques heures. Le secret ne quitte jamais le serveur.
  - **Secours retenu** : le TURN Cloudflare (l'utilisateur a un compte) (TLS sur le port 443, gratuit jusqu'à 1 To/mois), ajouté à la liste des serveurs ICE **après** coturn.
    - Il ne sert qu'aux réseaux qui bloquent l'UDP (Wi-Fi d'hôtel, d'entreprise, d'école).
    - Il aide aussi un ami à l'étranger : il entre sur le réseau Cloudflare au plus près de chez lui.
  - **Latence** : le relais ne sert que quand la connexion directe échoue (~10–30 % des cas, davantage en 4G). Entre amis en France, coturn chez OVH et Cloudflare se valent à 5–20 ms près, ce qui est inaudible face aux ~100–150 ms d'une voix par Internet. Mesure prévue en N6 avec `getStats`, sur les deux relais.
- **Qualité** :
  - codec Opus 48 kHz mono, 32–40 kb/s ;
  - FEC intégrée (corrige les paquets perdus), DTX (rien n'est émis pendant les silences), trames de 20 ms ;
  - au micro : annulation d'écho, réduction de bruit, gain automatique ;
  - les statistiques (`getStats`) mesurent latence, gigue et pertes, et s'affichent dans un indicateur de liaison.
- **Façons de parler** :
  - **activation vocale par défaut** (seuil réglable), **push-to-talk** (touche à choisir hors des touches de vol AZERTY), ou micro ouvert ;
  - couper ou régler le volume de chaque joueur ;
  - choix du micro ;
  - **qui parle** : pseudo allumé dans le HUD et sur la carte ;
  - témoin visible quand le micro est ouvert.
- **Dans le moteur sonore** (`src/audio/engine.ts`) :
  - les voix arrivent sur un nouveau bus **voix** du mélange, avec son propre curseur ;
  - les moteurs et l'ambiance baissent quand quelqu'un parle ;
  - **effet radio, actif par défaut**, quand l'interlocuteur est dans un autre engin : bande passante téléphonique, légère saturation, souffle, **bips Quindar** d'Apollo au début et à la fin de chaque prise de parole ;
  - voix claire, avec la petite réverbération de la cabine, quand on est dans le même engin (amarrés, passagers).
- **Options réalistes, désactivées par défaut** :
  - **délai de la lumière** selon la distance : Terre–Lune 1,3 s, Terre–Mars 3 à 22 min ;
  - **coupure radio pendant le plasma de rentrée** ;
  - pas de liaison directe à travers le trou de ver.
- **Même pièce** :
  - Deux appareils sur le même réseau local ne s'échangent **pas** la voix (on s'entend déjà), sinon il y aurait de l'écho et des larsens. La détection se fait par la connexion directe locale.
  - **Les observateurs et écrans instruments n'ont pas de voix par défaut** : un réglage les active.
- **Vie privée** :
  - le micro n'est demandé que lorsqu'on active la voix ;
  - rien n'est enregistré ;
  - les exports vidéo (prises, rendus) n'incluent jamais les voix.
- **Navigateurs** :
  - Chrome n'envoie un flux distant dans Web Audio que s'il est aussi rattaché à un élément `<audio>` (muet).
  - Sur iOS, il faut `navigator.audioSession.type = "play-and-record"`, sinon le son sort par l'écouteur du téléphone, à faible volume.
  - Le contexte audio ne démarre qu'après un geste de l'utilisateur.

### Salles et persistance

- **Gestion des salles** :
  - Créer une salle donne un code et un **jeton de propriétaire** gardé dans le `localStorage` de l'appareil.
  - « Mes salles » liste les codes connus de l'appareil.
  - Le propriétaire peut **supprimer** une salle.
  - Pas de comptes, des pseudos. Mot de passe de salle en option.
- **Ce que le serveur conserve** : les lignes d'univers, les baux, les bulles, l'horloge et la position de chacun.
- **Joueur déconnecté** : son engin reste dans le monde, figé à son `t` (sous-espace en pause) ou propagé en fantôme pour les autres. Il reprend là où il était.

### Hébergement (serveur de l'utilisateur)

- **Conteneur** : `oven/bun`, avec un volume `/data` pour SQLite. La stack Portainer est décrite dans `server/compose.yml`.
- **nginx-proxy-manager** :
  - hôte **`samlepirate.org`** : le service écoute en `wss://samlepirate.org/…` ;
  - si la racine sert déjà un site, on ajoute une *Custom location* `/bh-net/` vers le conteneur ;
  - case **« Websockets Support »** cochée, certificat Let's Encrypt.
- **coturn** (même stack, `network_mode: host`, car le relais a besoin des vrais ports et de l'IP publique) :
  - ports : `3478` en UDP et TCP (STUN et TURN), et une petite plage de relais en UDP, `49160–49200` (largement assez pour 8 appareils) ;
  - pas de TURN-TLS sur 443 : le port est pris par nginx-proxy-manager, et c'est inutile entre amis (à la maison comme en 4G, l'UDP sortant passe) ;
  - réglages de sécurité :
    - `use-auth-secret` / `static-auth-secret`, `realm=samlepirate.org`, `external-ip` = l'IP du Kimsufi ;
    - **relais interdit vers les réseaux privés** (`denied-peer-ip` 10/8, 172.16/12, 192.168/16, 127/8, et leurs équivalents IPv6), `no-multicast-peers`, `no-cli` ;
    - quotas par utilisateur et débit plafonné ;
  - **pare-feu du Kimsufi** (`ufw` ou `nftables`) : ouvrir 3478/udp, 3478/tcp et 49160–49200/udp. Si le **Network Firewall** OVH est activé dans l'espace client, y ajouter les mêmes règles.
  - **Anti-DDoS OVH (VAC)** : il est toujours actif et n'entre en jeu qu'en cas d'attaque. Le trafic voix est minuscule, on vérifie seulement qu'un appel passe en relais forcé.
- **Secrets** (variables d'environnement de la stack Portainer, jamais dans le dépôt) :
  - le secret partagé avec coturn ;
  - l'identifiant et le jeton de la **clé TURN Cloudflare** (à créer dans le tableau de bord, rubrique Realtime › TURN, au moment de N6).
  - Le serveur Bun demande à l'API Cloudflare des identifiants de courte durée et les envoie aux joueurs avec ceux de coturn.
- **Origines acceptées** : `https://thesamlepirate.github.io` et `localhost`.
- **Déploiement : le serveur d'abord, la page ensuite.** La CI (`pages.yml`) enchaîne :
  1. `bun test` ;
  2. **si `server/` ou `src/net/` ont changé** : construction de l'image `ghcr.io/thesamlepirate/black-hole-gpu-net`, étiquetée par commit et `latest`, et poussée sur GHCR avec le `GITHUB_TOKEN` (aucun secret en plus) ;
  3. **redéploiement de la stack** par l'API de Portainer avec `pullImage`, à l'aide d'un jeton d'accès Portainer (secret GitHub `PORTAINER_TOKEN`). Le webhook de stack est réservé à l'édition Business. Puis la CI attend que `/health` réponde avec la nouvelle version ;
  4. déploiement de Pages.
  - Une poussée qui ne touche pas au serveur ne le redémarre pas. Les joueurs ne sont donc pas déconnectés à chaque commit.
- **Alternative sans exposer Portainer** : une stack « depuis Git » en interrogation périodique (édition Community).
  - Portainer construit l'image sur le Kimsufi.
  - Le Dockerfile ne copie que `server/` et `src/net/`. Quand ces fichiers sont inchangés, l'image est identique et le conteneur n'est pas recréé.
  - En contrepartie, le serveur peut avoir quelques minutes de retard sur la page, ce que la compatibilité N/N−1 doit couvrir.
- **Redémarrage sans casse** :
  - le serveur prévient (« mise à jour »), écrit SQLite et s'arrête proprement ;
  - les clients continuent de voler en local, se reconnectent tout seuls et resynchronisent leurs lignes d'univers.
- **Installation initiale (une seule fois, guide dans `server/README.md`)** :
  - créer la stack dans Portainer (`server/compose.yml` : `bh-net` + `coturn/coturn`) ;
  - renseigner les variables secrètes ;
  - ajouter l'hôte dans nginx-proxy-manager ;
  - ouvrir les ports de coturn ;
  - ajouter `PORTAINER_TOKEN` aux secrets du dépôt.
- **Adresse du serveur dans l'app** : `wss://samlepirate.org/bh-net/` par défaut. `#server=` permet de la changer (dev). En local, `bun --hot server.ts` monte le même module réseau.

## Accroches dans le code existant

La refonte du vol (P1–P9) et celle de la carte (C1–C8) sont terminées : plus personne ne travaille en parallèle sur ces fichiers.
- **N0 n'utilise que des fichiers nouveaux** : `src/net/*`, `server/*`.
- **Les accroches dans le code existant sont regroupées et minces.** Cinq accroches :
  - **état** : l'engin piloté exporte son échantillon de ligne d'univers, à partir de `flightInfo()` (`air`, autopilote) et des champs de `sim.applyRender` ;
  - **horloge** : le vaisseau avance jusqu'à un `t` imposé (`shipTime`, et le sous-pas de l'air) ;
  - **warp** : toutes les écritures de `s.timeSpeed` des autopilotes passent par `wantWarp()` ;
  - **marionnette** : pose, regard (`syncLook`), rentrée, secousse et traînées appliqués sans intégrer ;
  - **autres** : les proxys entrent dans `fleet`, `others`, `ShipInstance` (rentrée par instance) et la liste des engins de la carte.
- **Destruction** : `onCraftLost` reçoit une branche multijoueur (événement + Réapparaître) à la place de la pause et du retour à l'instantané.
- **Si un autre chantier reprend ces fichiers** : les accroches se posent entre deux de ses phases commitées.
- **Le réseau lit ce que la physique expose et ne la réimplémente jamais.** Les nouveautés de la physique (modes avion, fusée, SF, plasma, chaleur, destruction `craftlost`) deviennent des champs du protocole : la rentrée d'un ami s'affiche avec son plasma.

## Phases

Chaque phase donne un commit et une fiche `docs/progress/NNN_*.jpg`. La vérification passe par des captures CDP synchronisées de deux appareils, côte à côte.

### N0 — Fondations (`src/net/`, `server/`, testé)
- Protocole binaire versionné ; messages pour l'instantané, les échantillons, les événements, les votes et les baux.
- Synchro d'horloge (décalage, dérive).
- Lignes d'univers : stockage, interpolation d'Hermite, propagation Kepler et Kerr, fantômes.
- **Solo intact** :
  - module réseau dans un bundle séparé, chargé à la demande ;
  - aucune requête réseau sans action du joueur (vérifié dans l'onglet réseau de la page en solo) ;
  - taille du bundle solo mesurée.
- Instantané complet : `GameSave` + flotte + TLE, et l'état de vol absent aujourd'hui de `GameSave` : `pilot.omega`, autopilote et sa phase (`entryRun`, `entrySite`, `fcBurns`, `launchGoal`), état de l'air (thermique, volets, aérofreins, train).
- Labo réseau.
- Serveur de salles Bun + SQLite, Dockerfile, compose (`bh-net` + coturn), job CI image GHCR + redéploiement Portainer, `/health`, guide d'installation `server/README.md`.
- Tests `bun test` :
  - précision de la propagation par rapport à l'intégrateur ;
  - convergence de l'horloge à 200 ms et 5 % de pertes ;
  - causalité des baux ;
  - élagage de l'historique.
- **Client bot** : un faux joueur (Bun, sans rendu) qui vole une orbite scriptée, pour tester seul.

### N1 — L'observateur miroir
- Menu **Réseau**, commande **Ajouter un écran** : 2ᵉ fenêtre sur la même machine (`BroadcastChannel`), puis appareil distant par QR code, dans une salle privée.
- L'hôte diffuse sa pose et son état visuel. L'observateur rejoue le vaisseau en marionnette, avec **tous les mounts**, son propre regard et sa propre qualité.
- La marionnette inclut la rentrée (plasma, peau chaude), la secousse, les traînées recalculées sur place, et le son : le director est nourri par le `info.air` reçu.
- **Vérification** : hôte et téléphone côte à côte, écart de temps mesuré, écran fluide au warp maximum.

### N2 — La caméra libre de l'observateur, des deux côtés
- `s.ship = false`, et le vaisseau suivi devient un proxy.
- `shipOthers` est levé : les deux côtés, rendu local près de Gargantua, marqueurs avec lentille au-delà.
- Rentrée et traînées **par instance** dans `ship.ts` : on voit le plasma de l'hôte depuis le sol.
- Tous les modes classiques sur l'observateur : télescope sur l'hôte, trépied, look-at, plongée.
- **Vérification** : l'Endurance de l'hôte filmée depuis l'orbite de Miller et depuis la Terre. Le marqueur dévié est comparé à `bodyLook`.

### N3 — WebRTC dans la même pièce
- Signalisation par le serveur, connexion directe et canal non fiable, repli automatique.
- **Vérification** : latence mesurée sur le réseau local, coupure du Wi-Fi puis reprise.

### N4 — L'écran instruments
- Canal de télémétrie à 2–5 Hz : nœuds, trajectoire prédite, cible, sphère d'influence, autopilote, carburant, aéro/thermique.
- La carte 3D, le ground track et les écrans cockpit tournent en mode lecture seule sur ces données.
  - Les accroches existent déjà : `Map3D.draw(Info)`, `FlightHud`, `FlightComputer(FcHost)`. Les actions (`act`) sont désactivées.
- **Taille** :
  - `Info` contient les trajectoires prédites complètes (jusqu'à 12 000 pas) et le candidat du calculateur.
  - On les **décime** : polylignes simplifiées, et transmises seulement quand elles changent.
  - Le côté lecture du calculateur de vol (contexte, plan, budget Δv, sites, état de l'autopilote, missions) fait partie du flux.
- **Carte GPU** : elle emprunte le device et les cartes de planètes du renderer.
  - Un appareil seulement « instruments » ouvre un **renderer allégé**, qui a le device et les cartes mais pas de lancer de rayons.
  - Sinon, la carte se rabat sur Canvas 2D.

### N5 — Multijoueur v1 (une bulle)
- Places de pilote, un Ranger par joueur (`VesselId` → instances), baux, prendre les commandes de tout engin libre.
- Arbitre du warp (`wantWarp`) : les baisses des autopilotes s'appliquent à toute la bulle, leurs hausses sont mises au vote. Chaque autopilote est vérifié (rentrée, calculateur, transferts) en attente de vote.
- Mode de vol et antigravité par engin. « Sans dégâts » devient un réglage de la salle. Destruction sans pause ni retour en arrière.
- Proxys des autres, cibles HUD, carte, pseudos et couleurs.
- Une bulle, warp au vote, persistance (créer, rejoindre, lister, supprimer une salle), menu **Réapparaître**.
- **Ouvrir ma partie au réseau**, **Rejoindre**, **Quitter** (retour à la partie solo), « garder une copie en solo ». Mondes des salles séparés des sauvegardes solo.
- **Vérification** : 3 navigateurs et un bot en orbite basse, un rendez-vous au HUD.

### N6 — La voix
- Maillage WebRTC audio, STUN et TURN sur coturn (identifiants de courte durée fabriqués par le serveur), Opus avec FEC et DTX.
- coturn ajouté à la stack Portainer, ports ouverts sur le Kimsufi.
- Activation vocale, push-to-talk, volume par joueur, indicateurs de qui parle.
- Bus voix dans le moteur sonore (ajouté à `Mix`). Pendant la parole, on baisse `listener` (moteurs, grondement de rentrée, vent) et `ambience`. Le bus `room` sert de réverbération « même engin ». effet radio et bips Quindar, voix claire dans le même engin.
- Pas de voix entre appareils de la même pièce. Options réalistes : délai de la lumière, coupure pendant le plasma.
- **Vérification** :
  - 3 onglets Chrome headless (micro simulé) ;
  - le relais TURN forcé (`iceTransportPolicy: "relay"`) ;
  - un téléphone en 4G ;
  - latence de bout en bout mesurée (`getStats`) : objectif < 150 ms à distance.

### N7 — Le temps hybride
- Bulles et sous-espaces, sortie automatique en forte dilatation (le ×1 en temps propre), fantômes, rattrapage, verrous de causalité.
- **Vérification** : le scénario « Romilly ». Un joueur descend sur Miller 1 h, l'autre reste en orbite et rattrape les 23 ans.

### N8 — Les interactions
- Collisions joueur-joueur, amarrages et assemblages (pilote et passager), transfert de bail, Endurance partagée.
- **Vérification** : amarrage de deux Rangers sur l'Endurance à 50 ms et 2 % de pertes, sans à-coups.

### N9 — Gargantua au complet, finitions
- Joueurs de part et d'autre du trou de ver, l'Endurance analytique ou libre, Mann, Edmunds.
- Finitions de l'interface.

## Risques

- **Régression du solo** : chaque phase repasse les tests existants et un vol solo de référence (décollage, orbite, rentrée), réseau désactivé.
- **Le mode marionnette, l'horloge imposée et l'arbitre du warp dans `controls.ts`** (7 400 lignes, un seul vaisseau supposé) : beaucoup d'écritures de `timeSpeed` à faire passer par `wantWarp`, sans casser le solo.
- **Les autopilotes en attente de vote** : chaque phase doit tolérer un warp plus lent que demandé.
- **Les proxys près du trou noir** : repère local, ombres, sonde de lumière.
- **Le coût sur téléphone** : tier 1, chargement des tuiles et des cartes HD. Un observateur en télescope sur Miller reste du lancer de rayons complet.
- **Safari** : particularités de WebGPU et de WebRTC sur iOS (routage audio, démarrage du son).
- **Voix** :
  - les réseaux mobiles en CGNAT dépendent du TURN (coturn sur le Kimsufi, Cloudflare en secours) ;
  - les appareils dans la même pièce risquent l'écho si la détection du réseau local échoue (réglage manuel en secours).

## Décisions complémentaires (2026-10-02)

- Une baisse de warp est immédiate pour toute la bulle.
- Une salle accueille 8 appareils au maximum.
- Le serveur est sur `samlepirate.org` : un **Kimsufi d'OVH**, avec IP publique. Le TURN de la voix tourne sur la même machine (coturn) ; Cloudflare reste un secours éventuel.
- **Voix par WebRTC** : ajoutée en phase N6. Les phases suivantes sont renumérotées (N7 temps hybride, N8 interactions, N9 Gargantua).
- Relais de la voix : **coturn sur le Kimsufi en principal, TURN Cloudflare en secours**.
- Voix : **activation vocale** et **effet radio** activés par défaut.
- Déploiement : **Portainer Community, accessible depuis Internet**, donc la méthode « la CI pousse » est retenue :
  - image GHCR, puis redéploiement par l'API Portainer, puis Pages ;
  - le jeton `PORTAINER_TOKEN` appartient à un **utilisateur Portainer dédié à la CI** (non administrateur, avec accès à la seule stack réseau), pour que le secret GitHub ne donne pas les clés de tout le serveur.
- **Revue du 2026-10-03** (27 commits depuis `c9f3d88` : vol, rentrée, calculateur, carte GPU) :
  - l'architecture tient ;
  - ajouts : arbitre du warp, rentrée et traînées par instance, réglages de salle, destruction sans retour en arrière, télémétrie décimée, renderer allégé pour la carte ;
  - le chantier vol + carte est terminé, la contrainte de cohabitation tombe.
- Accepté : pendant la rentrée d'un joueur, la bulle reste à ×4 dans l'air. Les autres peuvent quitter la bulle pour accélérer.
- Le travail commence par N0 **quand l'utilisateur donne le feu vert**.
