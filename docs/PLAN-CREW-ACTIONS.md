# Plan — l'équipage agit (crew/ : tout sauf piloter)

Branche `crew-actions`. Objectif : depuis la console Équipage (`crew/`, téléphone, tablette ou PC), un équipier
commande à bord du pilote qu'il suit tout ce qu'un copilote, un navigateur ou un officier systèmes d'armes
ferait — sans jamais tenir le manche ni la manette des gaz.

## Décisions (2026-10-18)

| question | réponse |
|---|---|
| consentement du pilote | **tout autorisé** : les actions s'exécutent aussitôt, sans validation ; le pilote est informé |
| périmètre | lecture, vues, cibles, **plan de vol** (toujours) + **configuration avion** + **pilote automatique** + **armement F-35** |
| exclu | « monde et session » : accélération du temps, date, météo, téléportation, scènes, sauvegardes, porte-avions, missions |
| TARS | **pas de TARS** : les actions passent par les commandes de la console, jamais par l'agent (ni sa clé) |
| qui agit | **tout membre Équipage** de la salle |

## Audit de faisabilité

**Faisable, sans changement côté serveur.** Les briques existent :

1. **Le transport.** `net.event()` diffuse un événement JSON à toute la salle ; le serveur (`server/rooms.ts`)
   y appose `from` (le numéro de l'émetteur, non falsifiable), refuse au-delà de 16 Ko, limite à 150 messages/s
   par membre. Le pilote connaît le rôle de chaque numéro par la liste des membres (rôle attribué par le
   serveur à l'entrée) : il peut donc vérifier qu'une commande vient d'un membre `instruments`. Pas d'envoi
   ciblé : un champ `to` (le pilote visé) suffit, comme pour les autres événements.
2. **L'exécution.** Les 66 outils du jeu (`src/ai/game-tools.ts`) sont l'API complète du simulateur : schéma
   d'arguments par outil, vérification stricte (`tool-schema.ts` : bornes, valeurs permises, rien d'inconnu),
   résultat court, toasts du jeu. On les appelle **directement** (pas l'agent TARS, pas de modèle) à travers une
   liste blanche par opération. Ce qui est irréversible (téléportation, chargement, date) est hors périmètre ;
   le filet « Avant TARS » n'est donc pas nécessaire.
3. **L'affichage du résultat.** La console reçoit déjà les instruments à 4 Hz : l'effet d'une action
   (train sorti, consigne ALT, point ajouté, verrouillage) s'y voit dans la seconde. Un accusé (`crew-ack`)
   donne en plus le succès ou le refus et son motif.

**Ce qui manque** (petit) :

- une API pour **régler les consignes ALT / CAP / VIT** du pilote automatique (`jetModes.alt/hdg/spd` ne
  sont écrites que par les touches et les modes) : `apSet({ alt?, hdg?, spd? })`, bornée, qui engage AP/A-THR
  si besoin ;
- **déplacer un point** du plan de vol (l'outil sait ajouter, retirer, vider, croisière, direct, NAV) :
  `move(index, lat, lon)` et les contraintes d'un point existant ;
- l'annonce **des capacités** : le pilote publie dans son instantané la liste des actions possibles maintenant
  (selon l'appareil, le mode, le combat en cours) — la console n'affiche que celles-là, et un ancien
  simulateur (sans liste) n'en propose aucune.

**Risques et réponses**

| risque | réponse |
|---|---|
| un équipier pilote quand même (touche, gaz, mode de vol) | liste blanche par opération ; `press_key`, `throttle`, `flightMode`, `set_craft`, `place_ship`, `set_mode` jamais exposés ; test qui le vérifie |
| commande forgée (rôle usurpé, arguments hors bornes) | `from` vient du serveur ; rôle lu dans la liste des membres ; arguments vérifiés par le schéma de l'outil ; texte borné |
| rafales (doigt qui insiste, script) | 4 actions/s par équipier côté pilote, identifiant de commande unique (rejeu ignoré) |
| deux équipiers en même temps / le pilote touche le manche | dernier ordre gagnant ; le manche du pilote coupe LNAV/VNAV comme aujourd'hui ; chaque action annoncée avec son auteur |
| plusieurs pilotes dans la salle | la commande vise le pilote suivi (`to`) ; les autres l'ignorent |
| tir par erreur (tout autorisé, pas de validation) | côté console : **maintenir pour tirer** (0,6 s) — un geste, pas une validation du pilote |
| la latence | ~RTT (10–80 ms) + l'image suivante ; la console montre « en cours » jusqu'à l'accusé, « sans réponse » après 3 s |
| ancien simulateur dans la salle | il ignore l'événement inconnu ; pas de capacités annoncées → la console n'affiche rien d'actionnable |

## Catalogue des actions

Chaque action = une opération d'un outil existant (ou d'une petite API nouvelle), une famille, ses arguments.

**Navigation (toujours)**

- Plan de vol : ajouter un point (lieu cherché, ou toucher sur la carte/ND), l'insérer à un rang, le déplacer
  (glisser), le retirer, contraintes d'altitude et de vitesse, croisière (niveau, vitesse, réserve), vider,
  « direct » vers un point, procédures de départ/arrivée — `flight_plan` add/remove/clear/cruise/direct + `move`.
- Cible : un corps, une station, un appareil (`set_target`) ; infos d'un trafic (`traffic info`).
- Carte/ND/Radar : toucher un point → menu « Direct · Insérer · Cible · Infos ».

**Configuration avion**

- Train, volets (0 / ½ / plein), aérofrein, SAS — `controls` gear/flaps/airBrake/sas (jamais `throttle`).
- Acquitter l'alarme principale — `flight_action acknowledge` ; remise de gaz automatique (`go_around`) :
  c'est l'autopilote qui vole → rangé en **pilote automatique**.

**Pilote automatique** (l'autopilote vole, l'équipier règle comme un copilote sur le MCP)

- Avion : AP, A/THR, consignes ALT/CAP/VIT (`apSet`), LNAV/VNAV (`flight_plan nav`), ILS vers un terrain
  (`approach ils/clear/off`), orbite/attente/suivi de terrain/ravitailleur (`jet_mode`), interception et
  formation sur un trafic (`traffic intercept/join/stop`), remise de gaz.
- Vaisseau : tenues d'attitude (`hold`), autopilotes (`autopilot` : circulariser, orbiter, atterrir…),
  manœuvres de l'ordinateur de vol prévisualisées puis exécutées (`plan_maneuver`, `plan_mission`,
  `manage_plan`).

**Armement F-35** (officier systèmes d'armes)

- Radar (RWS/TWS/STT), désignation et verrouillage depuis le radar de la console, choix d'arme
  (AIM-120, AIM-9X, GBU-32, JSM, canon), tir, leurres — `weapons` status/threats/select/lock/radar/fire/gun/
  countermeasures ; menaces et « bogey dope » affichés.

**Exclu** : manche, gaz, mode de vol (fusée/avion/ordinateur), niveau d'assistance et loi de vol (réglages du
pilote), touches libres, appareil piloté, téléportation, à pied, temps/date/météo, scènes, sauvegardes,
porte-avions, missions, leçons, réglages graphiques/son, caméra/HUD/panneaux du pilote, capture/vidéo, musique.

## Architecture

- **`src/net/crewcmd.ts`** (pur, partagé) : le contrat. `crew-cmd { v:1, id, to, act, args }` et
  `crew-ack { v:1, id, to, ok, msg }` ; le **catalogue** `ACTS` (act → famille, outil, opération, schéma
  d'arguments, appareils/modes où elle vaut) ; `readCrewCmd` (borné, non finis écartés).
- **`src/ui/crew-exec.ts`** (simulateur) : reçoit `crew-cmd` ; vérifie émetteur `instruments`, `to`, débit,
  doublon, act ∈ capacités du moment ; vérifie les arguments par le schéma de l'outil ; exécute via la
  fonction de l'outil ; journal + toast « Ben (équipage) : train sorti » ; répond `crew-ack`.
- **Instantané** : `caps: string[]` (les actions possibles maintenant) et `crew: { last: [qui, quoi, quand] }`
  pour que tous les écrans voient qui a fait quoi.
- **Console** : `src/crew/actions.ts` (envoi, file en attente, accusés, délais) ; les contrôles dans chaque
  vue (ci-dessous) ; un fil d'activité « Bord » dans le panneau Équipage.
- **Contrôleur** : `apSet` (controller/jet.ts), `routeMove` (controller/fplan.ts) — les deux seules API ajoutées
  au simulateur, testées pour elles-mêmes.

## Interface de la console

- **Vol (PFD)** : un **MCP** sous le PFD — AP, A/THR, ALT/CAP/VIT (molette ± au doigt, saisie directe),
  LNAV, VNAV, APP (ILS) ; les consignes s'affichent déjà sur les rubans.
- **Navigation / Carte** : toucher → menu contextuel (Direct, Insérer, Cible, Infos, Intercepter, Rejoindre) ;
  sur la carte, glisser un point du plan le déplace.
- **Plan de vol** : tableau éditable (ajout par recherche, contraintes, suppression, ordre), croisière,
  procédures ; le profil vertical se met à jour à l'accusé.
- **Systèmes** : train, volets, aérofrein, SAS, acquitter — des interrupteurs à l'état réel (lu à 4 Hz).
- **Radar** : toucher un contact → désigner/verrouiller ; barre d'armes (choix, tir maintenu, leurres) ;
  modes radar.
- Partout : état « en cours » sur le contrôle jusqu'à l'accusé ; toast du résultat ; vibration courte au
  téléphone sur un refus.
- **« Pas de TARS »** : le bouton et la boîte TARS de la console sont retirés (à confirmer, voir plus bas).

## Phases (une phase = un commit + des captures)

| phase | contenu | vérification |
|---|---|---|
| A0 | contrat `crewcmd.ts`, catalogue, `crew-exec.ts`, capacités dans l'instantané, accusés, journal pilote | tests unitaires : liste blanche (aucune action de pilotage atteignable), rôle, `to`, débit, doublons, schémas |
| A1 | Configuration : interrupteurs Systèmes, acquitter | e2e : la console sort le train / les volets du vrai simulateur (F-35 en vol), le pilote voit le toast |
| A2 | Navigation : plan éditable (vue Plan), menus carte/ND, glisser un point (`routeMove`), direct, cible | e2e : un point ajouté et déplacé, direct, le LNAV le suit |
| A3 | Pilote automatique avion : MCP (`apSet`), LNAV/VNAV, ILS, orbite/attente/TF, interception/formation, remise de gaz | e2e : ALT 6 000 m réglée depuis le téléphone, l'avion monte ; ILS engagé |
| A4 | Pilote automatique vaisseau : tenues, autopilotes, manœuvres (aperçu → exécution) | e2e : circularisation depuis la console en orbite |
| A5 | Armement : radar, désignation, armes, tir maintenu, leurres, menaces | e2e : en combat, verrouillage et tir d'un AIM-120 depuis la console |
| A6 | Finitions : fil d'activité, conflits entre équipiers, accessibilité (clavier, lecteurs d'écran), doc `docs/CREW.md`, campagne e2e sur kerr-mini | e2e complet téléphone / tablette / PC |

Estimation : A0 ½ journée, A1 ½, A2 1, A3 1, A4 ½, A5 1, A6 ½.

## Points ouverts

1. « Pas de TARS » : retirer aussi le TARS **local** de la console (la boîte de commandes par mots-clés
   d'aujourd'hui), ou seulement ne pas l'utiliser pour agir ?
2. Garder chez le pilote un **interrupteur général** « Actions de l'équipage » (activé par défaut) pour couper
   tout d'un geste — malgré « tout autorisé » ?
3. Le pilote est informé par un toast ; faut-il aussi une **annonce vocale** (la voix de bord dit
   « Train sorti — Ben ») ?
