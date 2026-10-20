# La musique, les voix et TARS

Le vol se fait entendre de trois façons :
- **les voix** : les annonces de l'appareil, le contrôle de mission et la tour par radio, TARS ;
- **la musique**, aux seuls grands moments ;
- **TARS**, le robot copilote, qu'on interroge avec F6 et qui parle parfois de lui-même.

Tout est synthétisé ou tiré du système : rien à télécharger. TARS peut aussi passer par OpenRouter avec la clé du joueur. Plan : [`PLAN-TARS.md`](PLAN-TARS.md) (M10, T1–T7).

## Les fichiers

Le sol satellite régional est accessible par `set_settings` (`earthSurface=off|satellite|materials`) et la commande `/surface`, avec complétion. TARS peut afficher le panneau des réglages, lire `get_state.surface` ou `get_telemetry({groups:["surface"]})`, attendre `wait({until:"surface_ready"})` et recevoir un événement `surface` lors d'un changement de région ou de statut. L'attente retourne aussi les erreurs et le repli éventuel : « terminé » ne signifie pas que toutes les pages sont disponibles. Détails et budgets : [PLAN-TERRE-PHOTOREALISTE.md](PLAN-TERRE-PHOTOREALISTE.md).

Le décor mondial (forêts, bâtiments, routes, voies ferrées, eaux et ponts) passe par `set_settings` (`earthScenery=off|balanced|high`) ou `/scenery`, avec complétion. Les ombres sont activables via `earthSceneryShadows` ou `/sceneryshadows true|false`. TARS lit `get_state.scenery`, `get_telemetry({groups:["scenery"]})`, les comptes d'objets et de réseaux, les couches/champs OSM effectivement reçus (`osmLayers`), la portée des ombres, la mémoire, les erreurs et la limitation par budget. `wait({until:"scenery_ready"})` attend le streaming et le fondu : lire le statut retourné, notamment `degraded` ou `unsupported-storage-limit`. L'événement `scenery` le réveille lors d'un changement de centre ou de statut ; le panneau des réglages affiche les options et leurs crédits. [Implémentation, couverture et mesures](FORETS-BATIMENTS-WORLDWIDE.md).

L’exploration à pied passe par `character` (`start`, `disembark`, `board`, `move`, `jump`, `stop`, `orbit`, `status`) et `/walk`.
`start` exige `lat` et `lon` sur un monde solide (`body`, la Terre par défaut) ; `orbit` ne change que le `yaw`/`pitch` donné.
`move` accepte `forward`, `right`, `seconds` (maximum 10) et `run` ; `stop` arrête la marche.
`/grass off|balanced` ou `set_settings(earthGrass)` active l’herbe exclusivement dans les prairies terrestres en vue personnage.
TARS lit `get_state.character`, `get_state.grass` et les groupes de télémétrie `character`/`grass`, y compris mémoire,
coût CPU, racines et chargement du modèle. Il affiche `show_screen(character)`, attend `character_grounded`,
`character_on_foot` ou `character_boarded` et reçoit les événements `character`/`grass`.
Les captures de validation attendent aussi les shaders et toutes les données nécessaires : un streaming arrêté
peut avoir échoué. [Détails, budgets et limites](THIRD-PERSON-IMPLEMENTATION.md).

| Fichier | Rôle |
|---|---|
| `src/audio/voice.ts` | pur pour sa file : qui parle, dans quel ordre (la plus urgente coupe les autres, une même ligne pas deux fois, une ligne périmée abandonnée) ; `Speech` : les voix Web Speech du système, choisies par langue, ou la voix de TARS |
| `src/ui/subtitles.ts` | les sous-titres : la phrase dite et son orateur |
| `src/game/callouts.ts` | pur : les annonces de l'atterrissage (hauteurs radio, minimums, taux de chute, remontez, les alertes dites) |
| `src/game/capcom.ts` | pur : le contrôle de mission et la tour, le délai de la lumière, le blackout du plasma |
| `src/audio/score.ts`, `src/audio/music.ts` | la partition : quel moment, quel morceau (pur) ; sa synthèse (orgue additif, nappes, salle, le tic-tac de Miller) |
| `src/audio/g2p.ts`, `src/audio/formant.ts` | la voix robot de TARS en anglais : le texte en phonèmes, la synthèse par formants |
| `src/game/tars.ts` | pur : TARS hors ligne — ses réponses, son honnêteté et son humour, ses remarques |
| `src/ai/openrouter.ts`, `src/ai/tars-online.ts` | TARS par OpenRouter : la clé, la connexion OAuth (PKCE), les appels GLM et Jev, leur coût ; son caractère pour le modèle, ses remarques décidées par Jev |
| `src/ui/tars-panel.ts`, `pwa/openrouter.html` | sa console F6 (son orbe, onglets Échange · Agents · Réveils · Mémoire, actions en direct, suivi du hub, proposition, tâches, autocomplétion, modes, poignée) et le lien à OpenRouter ; la page de rappel de la connexion |
| `src/ai/agent.ts`, `src/ai/tool-schema.ts` | TARS agent : la boucle d'un tour (appels, résultats, bornes, arrêt) ; le schéma des outils et la vérification des arguments |
| `src/ai/game-tools.ts`, `src/ai/settings-tools.ts` | ses 68 outils : tout le jeu (dont le F-35 : ses vols, l'école de vol, les missions, le trafic, la patrouille, les armes, le porte-avions, l'approche, le plan de vol), montrer, proposer, attendre, réveils, sous-agents, tâches, savoir-faire ; les réglages trouvés par les mots et vérifiés au schéma |
| `src/ai/knowledge.ts`, `docs/aviation/{fr,en}/*.md` | sa base de connaissances aéronautique : onze pages par langue, coupées en sections, cherchées par leurs mots (outil `knowledge`), livrées avec le jeu |
| `src/game/threats.ts`, `src/controller/copilot.ts` | le navigateur en place arrière : les menaces annoncées en combat (missiles, BRAA, SAM, coups, victoires) ; le trafic autour, l'interception et la patrouille sur un avion nommé |
| `src/game/radio.ts` | les rôles de la radio de la patrouille (ailier, AWACS Darkstar, Mother, Paddles) : leur voix, leur nom en sous-titre, partagés avec la salle |
| `src/game/course.ts`, `src/controller/course.ts` | les leçons de l'école de vol : guidée (TARS puis vous), démonstration (TARS vole tout), essai (vous seul) ; chaque étape dite de sa voix |
| `src/ai/telemetry.ts` | `get_telemetry` par groupes (attitude, air, commandes, autopilote, hub, rentrée, approche, descente, poussée, amarrage) ; ses canaux échantillonnés pour ses graphes |
| `src/ai/triggers.ts`, `src/ai/budget.ts` | ses réveils : réflexes et règles (événements, toutes les N min, à une heure du jeu) ; le plafond par heure et l'intervalle |
| `src/ai/subagents.ts` | ses sous-agents : jusqu'à 4 copies en parallèle, lecture et calcul seulement |
| `src/ai/commands.ts`, `src/ai/tars-commands.ts` | les 27 commandes « / » de l'agent, les mentions @, les modes, les savoir-faire ; leurs complétions (pur) et leur exécution |
| `src/ai/game-commands.ts` | les 93 commandes de jeu (« /target », « /cockpit », « /teleport »…) exécutées par ses outils sans le modèle ; leurs arguments complétés |
| `src/ui/tars/orb.ts`, `src/ui/tars/display.ts`, `src/ui/tars/chart.ts` | ses orbes (thinking orbs) ; ses cartes sur la vue (graphes en direct, couloir et graphe du hub superposés, fiches) et leur tracé |
| `src/ai/tars-agent.ts`, `src/ai/memory.ts` | sa consigne d'agent, un tour à la fois ; sa mémoire gardée entre les visites |
| `src/ai/offline-orders.ts`, `src/ai/listen.ts` | les ordres compris hors ligne (dont ceux du leader à sa patrouille) ; le push-to-talk |
| `src/audio/engine.ts` | les bus « voix » et « musique », la radio autour des voix (Quindar, squelch, souffle), le souffle du blackout, la chaîne de la voix de TARS |

## Les voix

- **L'ordre** :
  - 0 : une alarme (« Remontez ! ») ;
  - 1 : une annonce (« Cent ») ;
  - 2 : le contrôle, la tour, une réponse de TARS ;
  - 3 : une remarque.

  Une ligne plus urgente coupe celle qui est dite. Une même ligne n'est pas redite dans les 4 s. Une ligne trop vieille est abandonnée (la hauteur est passée).
- **Les voix du système** (Web Speech) : celles du navigateur et de l'OS, dans la langue de l'interface, les meilleures d'abord, jamais les voix fantaisie de macOS.
  - Elles ne passent pas par l'audio du jeu : la radio est jouée *autour* des lignes du contrôle.
  - Cette radio, c'est le bip Quindar d'Apollo (2525 Hz à l'ouverture, 2475 Hz à la fin), le squelch et un souffle.
- **Sans voix** (réglage Voix coupé, ou une page de test `?e2e=`) : chaque ligne dure son temps de lecture, et les sous-titres gardent leur rythme.
- **Réglages** : Voix, Volume des voix, Sous-titres.

## Les annonces de l'atterrissage

- **Les hauteurs radio en descendant** : 300, 100, 50, 40, 30, 20, 10 m. Chacune une fois, réarmée 20 % au-dessus (une remise de gaz, un rebond).
- **« Minimums »** à la hauteur de décision d'une finale de piste (60 m sur le seuil).
- **« Taux de chute »** au-delà de l'enveloppe du plané raide du Ranger, mesurée sur les posés de l'autopilote :
  - le relevé : 52 m/s de 700 à 300 m, 38 de 200 à 300 m, 26 de 100 à 150 m, 19 de 70 à 100 m, 10 de 50 à 70 m, moins de 4 au-dessous ;
  - l'alerte part à 1,4 fois ces valeurs.
- **« Terrain ! Remontez ! »** à 1,3 fois l'enveloppe, ou le sol à moins de 2,5 s. Jamais dans l'arrondi (sous 30 m).
- **Les alertes graves du HUD**, dites une fois quand elles viennent, pas redites dans les 30 s : le train, le décrochage, le carburant, les températures, la surcharge, l'horizon.

## Le contrôle de mission

Ses répliques sont lues sur l'état du vol, pas sur le texte (traduit) de ses messages :
- le décollage, une bonne orbite, l'évasion ;
- la poussée de désorbitation ;
- la tour en finale : la piste, le vent en nœuds, autorisé à atterrir ;
- l'arrêt des roues, avec un mot selon la note du posé ;
- l'amarrage, la séparation, l'appareil perdu.

Ce qui encadre ces répliques :
- **La lumière** : Houston parle avec le délai de la lumière depuis la Terre (1,3 s depuis la Lune). Au-delà d'une minute du mur, il ne dit rien (Mars).
- **Le côté de Gargantua** : il n'y a pas de Houston de l'autre côté du trou de ver (« on perd votre sig… », puis « c'est vous ? » au retour).
- **Le blackout** :
  - il est averti dès que le plasma commence ;
  - la radio est coupée, avec un souffle, tant qu'il dure (dès ~85 km sur une rentrée orbitale) ;
  - à la sortie, « comment recevez-vous ? », puis ce qui a été dit entre-temps.

## La musique

- **Le silence par défaut** (décision du propriétaire). Un morceau à chaque grand moment, le plus grave d'abord :
  - le trou de ver ;
  - le plasma de la rentrée ;
  - la finale (sous 3 km) ;
  - le décollage (75 s) ;
  - Miller ;
  - Gargantua (à moins de 30 M).
- **Les sons** : un orgue additif (les tirants 16', 8', 4', 2 2/3', 2'), des nappes, la pédale, une grande salle. Les fondus sont longs ; un moment chasse l'autre en fondu enchaîné.
- **Les accords** : des enchaînements en la mineur et relatifs, aucune mélodie citée.
- **Le tic-tac de Miller** : 1,25 s, le motif du film, assumé comme hommage. Sur le Miller du jeu, dτ/dt = 0,85 (la physique réelle de son Gargantua) ; le vrai reste affiché sur l'écran CLOCKS.
- **Le niveau** : −34 dB RMS sur Miller (un morceau doux), sous le moteur (−14 dB plein gaz).
- **Réglages** : Musique, Volume de la musique.

## TARS

- **F6** ouvre son champ. Ses touches restent dedans : taper ne pilote pas. Entrée pose la question, Échap ferme.
- **L'onglet Réglages de sa console** (`ui/tars/settings-tab.ts`) : tous ses réglages au même endroit, les valeurs mêmes du panneau des réglages (posées par lui : son historique, leur sauvegarde) — **son esprit** (OpenRouter, le modèle, les réflexes, le budget, les remarques, l'honnêteté, l'humour), **sa voix** (activée, le volume, les sous-titres ; **ce qui parle** : Deepgram Aura-2, le robot du jeu (anglais), la voix du système ; **la voix Deepgram** en français (Hector, Agathe) et en anglais (41 voix, `audio/aura-voices.ts`) ; **l'effet** : robot (son grain), propre, radio ; la voix du système choisie, son débit et sa hauteur ; **« Essayer sa voix »**, ce qui parle dit dessous), **la radio** (le contrôle de mission et la tour : Deepgram dans la bande de la radio, ou le système ; leur voix), **son oreille** (ce qui entend, la clé Deepgram, le modèle Nova-3 ou Nova-2, la langue — celle du jeu, l'une ou l'autre, les deux mêlées —, sa touche : maintenir pour parler ou appuyer pour commencer et finir, **le micro** choisi, **« Tester l'oreille »** : son niveau et les mots entendus à mesure). Les voix Deepgram (`audio/deepgram-voice.ts`) : la phrase envoyée au WebSocket « speak » de Deepgram (la clé collée, ou le relais `/__deepgram/speak` du serveur de développement), son PCM 24 kHz joué par l'audio du jeu (`engine.ts` : `robotVoice` pour son grain, `plainVoice` propre ou radio 300–3 400 Hz ; sa place à côté du pilote au cockpit), gardée pour la redire ; hors d'atteinte : le robot (anglais) ou la voix du système. Les mots-clés attendus par l'oreille : TARS, Cooper, Gargantua, Miller, Endurance, Ranger, Kerr.
- **F6 maintenu** (ou le bouton micro de sa console, cliqué pour commencer puis pour finir) l'écoute. **Son oreille** (réglage « L'oreille de TARS » : automatique, Deepgram, navigateur) :
  - **Deepgram** (`ai/deepgram.ts`, nova-3, le français, « TARS » en mot-clé) : le micro envoyé en direct (PCM 16 kHz) par un WebSocket, les mots affichés à mesure, la phrase envoyée au relâchement — le même dans tout navigateur. Sa clé : **collée sous le réglage « L'oreille de TARS »** (Réglages › Jeu › TARS) **ou sur la ligne « Oreille » de sa console** (`ui/ear-key.ts` : l'état — la clé …abcd, le relais local, ou le navigateur —, un champ masqué, la clé **essayée avec Deepgram avant d'être gardée** — une connexion ouverte puis refermée —, changer, oublier ; gardée dans ce navigateur seulement), ou par `/deepgram` (`/deepgram off` l'oublie), ou, en développement, `DEEPGRAM_API_KEY` dans `.env` — le serveur `bun server.ts` relaie alors (`/__deepgram`) sans que la clé quitte le serveur (une clé sans le rôle « Member » ne peut pas créer de jeton temporaire : un relais n'en a pas besoin). Le site déployé (nginx statique) n'a pas de relais : sa clé à coller.
  - **Le navigateur** : Chrome (par Google) et Safari (sur l'appareil) ; Arc, Brave, Opera n'ont pas le service (« network ») et Firefox pas de reconnaissance du tout — le dire, et proposer Deepgram. Sa reconnaissance s'arrête parfois d'elle-même : relancée, ce qui a été dit gardé ; trois arrêts sans rien entendre : l'écoute rendue, la raison dite (et sa trace dans la console du navigateur, `__bh.tars.earTrail()`).
  - Tests : `tests/listen.test.ts`, e2e `tars-ear` (le faux micro de Chrome lisant une phrase, le relais, Deepgram : seulement avec une clé dans `.env`).
- **Hors ligne**, ou sans clé, il répond avec ses phrases écrites :
  - **ce qu'il comprend**, en anglais ou en français : où on est, le carburant, la vitesse, la cible, combien de temps, quoi faire, comment ça va, qui il est, une blague, le temps près de Gargantua ;
  - **ses réglages**, dits à voix haute : « honesty 70 », « humour 0 » ;
  - **l'honnêteté** arrondit et adoucit, mais jamais sur un danger (carburant presque épuisé, impact proche : dits tels quels) ;
  - **l'humour** ajoute ses apartés et ses blagues ; à 0, aucun ;
  - **ses répliques** sont celles du jeu, aucune citée du film.
- **Ses remarques spontanées** sont rares : deux minutes entre deux, cinq entre deux du même moment. Elles portent sur :
  - un posé noté A ou F ;
  - le trou de ver, Gargantua, Miller ;
  - le décollage, l'amarrage ;
  - le carburant bas (toujours dit : c'est utile).
- **Sa voix**
  - **En anglais**, une voix robot synthétisée ici :
    - des règles de lecture et une synthèse par formants à la Klatt ;
    - un timbre métallique, placée à son poste dans la cabine ;
    - mesurée par Whisper : 13 % de mots manqués (la voix du système : 4 %).
  - **En français**, la voix du système (décision du propriétaire) : le français maison était mesuré à 76–87 % de mots manqués.
- **Par OpenRouter** (réglage « TARS par OpenRouter »), avec la clé du joueur
  - **La clé** :
    - on l'obtient par « Se connecter avec OpenRouter » (OAuth avec PKCE, sans serveur), ou on la colle ;
    - elle est gardée dans ce navigateur seulement : jamais dans les réglages, une sauvegarde, un export.
  - **Ses réponses** sont écrites par **GLM-5.3-flash**, avec :
    - son caractère, ses réglages, la langue ;
    - les seules données du vol : aucun chiffre inventé, un danger dit tel quel ;
    - ses trois derniers échanges.
  - **Ses remarques** sont décidées par **Jev** (parler ou se taire, le sujet, le ton, posés ensemble), puis écrites par GLM :
    - à chaque moment, plus un regard toutes les 2 min de vol ;
    - au plus une décision par 45 s et une remarque par 2 min.
  - **Le coût** : une phrase coûte ≈ 0,00015 $ (GLM : 0,15 / 0,50 $ le million de jetons ; Jev ne facture que l'entrée). Celui de la session est affiché dans le champ F6.
  - **Une panne, hors ligne, un délai dépassé** (12 s) : il reprend ses phrases écrites.
- **Réglages** : Remarques, Honnêteté (90 %), Humour (75 %), TARS par OpenRouter.

## TARS agent

Plan : [`PLAN-TARS-AGENT.md`](PLAN-TARS-AGENT.md) (A1–A9, B1–B7, C1–C6). Le code, système par système : [`systemes/10-tars-agent.md`](systemes/10-tars-agent.md). Par OpenRouter, TARS **agit** sur tout le jeu, sans jamais demander (décision du propriétaire).

- **Lui parler** : F6 tapé, le champ ; F6 **tenu**, il écoute (le champ en rouge, les mots en direct) et la question part au relâché ; le bouton 🎙 au clic. La reconnaissance est celle du navigateur : Chrome l'envoie aux serveurs de Google, Safari la garde sur l'appareil.
- **Ce qu'il fait** : ses 68 outils couvrent tout le jeu (ceux du F-35 : [phase 4](#phase-4--le-copilote-de-chasse)).
  - Lire : l'état entier, les sites et pistes, les corps, la météo (et la météo réelle de n'importe quel lieu à n'importe quelle date depuis 1940 : `weather_at`, `/weatherat`), le ciel (télémétrie « sky » : hauteurs vraies et réfractées du Soleil et de la Lune, l'éclipse en cours là où est la caméra — sa phase, la part du Soleil cachée, celle de la Lune dans l'ombre ; il est réveillé à chaque phase : réflexe « éclipse »), les éclipses passées et à venir partout dans le système solaire (`find_eclipses`, `eclipse_local`, `/eclipses`, `/eclipse` ; il y emmène : `go_see_eclipse` ; il en montre la page : écran `eclipses`), les photographies en surimpression (`multiple_exposure`, `/analemma` : l'analemme d'un lieu, ses dates et positions écrites à côté de chaque Soleil ; `/eclipsephoto` : les phases d'une éclipse de Soleil ou de Lune vue d'un lieu, la totalité au milieu, l'heure et la part cachée de chaque disque — dans le ciel du trépied, en bande ou dans l'ombre de la Terre —, ou le transit de Mercure ou de Vénus ; `/startrails` : un filé d'étoiles ; `/moonpath` : le trajet de la Lune sur une nuit, à la même heure chaque jour ou chaque jour lunaire ; `/issphoto` : la traînée de l'ISS), les passages visibles de l'ISS (`iss_passes`, `/isspasses`), les réglages, sauvegardes et scènes, le journal, le dernier rapport, les touches.
  - Piloter : les autopilotes (posé sur un site, décollage vers une orbite, amarrage…), les maintiens, les commandes, la remise de gaz.
  - Naviguer : la cible, le calculateur de vol (planifié puis exécuté), une mission vers un corps ou la station.
  - Le temps et la date, les vues, le ciel, les panneaux et la carte.
  - **L'observatoire** (`observe`) : depuis le sol de la Terre, quand voir une planète, une lune, le Soleil, la Lune, l'ISS, une étoile brillante ou le trou de ver (`when` : ses fenêtres sur `days` jours, son meilleur moment, le ciel), le télescope pointé dessus (`look` : maintenant, à son meilleur moment ou à une date), la page ouverte (`open`).
  - **Le replay** (`camera`, `replay`) : les dernières minutes volées rejouées (`open`), la bande-annonce de leurs meilleurs moments (`trailer`), rendue en vidéo (`video`), le retour au vol (`close`) ; sa caméra `replayShot` : `auto` (les plans du réalisateur), `chase`, `orbit`, `flyby`, `cockpit`, `target` (l'objectif sur ce qui a été abattu).
  - **Les vues d'exception** : dans l'outil `mission` (`list`, puis `fly` sur un id `view-…`) — l'éclipse du 12 août 2026 poursuivie, la pleine Lune qui se lève, les aurores des Lofoten, un coucher de soleil sur le porte-avions, les canyons, les fjords, l'Himalaya, la Patagonie, l'Islande, une tempête en mer.
  - Téléporter (`place_ship` : **un lieu par son nom** — `query` : une piste, un site, une destination de l'Atlas, toute adresse ou nom de lieu sur la Terre (OpenStreetMap, WGS84), des coordonnées tapées —, ou `site`, ou corps + lat/lon ; modes `orbit`, `orbit_over`, `ground`, `walk`, `lineup`, `fly` — en vol au-dessus du lieu, `aglM` au-dessus du sol —, `near`, `wormhole`, `glide`, `hover`), sauvegarder et charger, lancer une scène.
  - **Tout réglage**, vérifié au schéma ; **toute touche**.
  - **Attendre** l'issue (la fin d'un autopilote, un posé, une orbite autour d'un corps) pendant que le jeu tourne.
- **Sa console** (F6) : son orbe — un *thinking orb* animé et teinté selon son état (voir « Ses orbes » ci-dessous) —, l'échange, ses actions en direct (un petit orbe en cours, ✓ fait, ✗ refusé ; la ligne entière en info-bulle), la ligne vivante d'une attente (son orbe qui cherche), « TARS travaille… (Échap : arrêter) ». Fermée, **sa présence** reste en haut de l'écran tant qu'il agit ou parle. Ce qu'il a lancé (un autopilote, un plan) est **suivi jusqu'au bout**, puis l'issue dite.
- **Ses orbes** (`src/ui/tars/orb.ts`, 20/10/2026) : toutes ses animations sont des *thinking orbs*
  ([thinking-orbs](https://github.com/Jakubantalik/thinking-orbs), son moteur sans React, dessiné par
  `src/intro/orb.ts` comme l'orbe du chargement), teintés de la couleur de son état. Les siens — la tête de la
  console (40 px), sa présence (20 px), la barre du haut (24 px) et sa poignée (16 px) — suivent ce qu'il fait :
  prêt → *breathing* (un anneau qui respire, lent et pâle, vert) · à l'écoute → *listening* (une onde dans les
  anneaux, rouge ; son allure et sa taille au niveau du micro quand l'oreille est Deepgram) · réfléchit → *solving*
  (cyan) · agit → *connecting* (ambre ; chaque action un sursaut) · parle → *composing* (vert ; au niveau de sa voix
  robot) · problème → un anneau immobile, rouge. Les petits marquent ce qui tourne : l'étape en cours (*working*),
  l'attente (*searching*), un sous-agent (*weaving*), la tâche en cours (*solving*), le bouton micro pendant
  l'écoute (son orbe à l'écoute à la place de 🎙), le « en direct » d'un graphe (*searching*), l'essai de sa voix
  (*composing*) et le test de l'oreille (*listening*, au niveau entendu ; la jauge reste, c'est une mesure). Sous
  40 px, le dessin 20 px du moteur (moins de points, plus gros). Une seule boucle `requestAnimationFrame` pour tous,
  qui ne tourne que si l'un bouge à l'écran (caché, hors écran, onglet caché : rien n'est dessiné) ; au repos
  ~15 images/s ; mouvement réduit : une image fixe (l'état dit par la forme et la couleur). Gardés : les entrées de
  la console et des étapes (`tars-in`, `tars-step` — de la mise en page, pas une activité) et le clignotement du
  verdict du hub (une alarme). e2e `tests/e2e/tars-orbs.e2e.test.ts`, captures `docs/progress/tars-orbs/`.
- **Il montre** : des graphes (les canaux de l'enregistreur en direct, ou ses propres séries), des fiches de chiffres, et les vrais écrans du jeu (la carte, la tablette, un écran du cockpit, le rapport de vol) ; trois cartes au plus sur la vue, fermées par leur ×.
- **Ordres et propositions** : un ordre (« pose-nous », « vise Mars ») s'exécute sans confirmation ; « propose-moi un plan pour… » donne un plan chiffré, sans rien exécuter, avec ACCEPTER / REFUSER (ou « oui » / « non ») — accepté, il l'exécute.
- **L'arrêter** : Échap, « stop », ou une nouvelle question.
- **Le filet** : avant ce qui ne se défait pas (charger, déplacer — `place_ship`, `atlas go`, `sky_events take` go/live, `character start`, `set_mode foot` —, changer la date, une scène), la partie est sauvegardée sous « Before TARS » ; « annule » y revient.
- **Sa mémoire** : la conversation gardée d'une visite à l'autre, dans ce navigateur seulement (jamais dans une sauvegarde, les réglages, un export). 24 échanges mot pour mot, les plus vieux résumés par le modèle ; ses notes (votre nom, vos préférences). Dans le champ F6 : leur nombre et « effacer » ; ou « oublie tout ».
- **Le modèle** : réglage « Modèle de TARS » — GLM-5.3 Flash par défaut (le moins cher), Claude Haiku 5.5, GPT-6 Luna, DeepSeek V4.1 Flash, Gemini 3.8 Flash, Claude Sonnet 5.5. Un vol vers la Lune mené par TARS a coûté 0,0012 $ avec GLM.
- **Hors ligne** (sans clé, sans réseau, ou le réglage coupé) : les ordres courants compris en français et en anglais — poser, décoller, circulariser, amarrer, la cible, le train, le temps, les vues, la carte, sauvegarder, annuler, téléporter en orbite, oublier, et les ordres du leader à sa patrouille (rejoignez, une formation — losange, échelon droite ou gauche, finger four, triangle, ligne de front, colonne, patrouille étalée —, le passage en losange, serrez, écartez, attaquez ma cible, engagez, couvrez-moi, attente ici, retour base, dégagez à gauche ou à droite) — exécutés par les mêmes outils ; une question garde ses phrases écrites.

### Phase 2 : le super-agent

- **Il sait tout du vol** (`get_telemetry`) : l'attitude, l'air, les commandes, ce que chaque autopilote commande (l'inclinaison et l'incidence de la rentrée, le profil et le PAPI de l'approche, la poussée en cours), l'étape du hub et ses écarts.
  Les consignes précisent leur référence : `sfCommand.groundSpeedMs`, `pathDeg`, `trackDeg` sont la vitesse sol, la pente et la route ; l'approche expose `heightOverThresholdM`, `commandedPathDeg`, `groundSpeedMs`, `airspeedMs` et `aimAlongM` (point visé le long de la piste, depuis le seuil). La descente expose `vHorMs` (norme du vecteur), `vVertMs` (positif vers le haut), `sinkMs` (positif vers le bas) et `doi`. L'amarrage expose `closingMs` et `askedClosingMs`, signés dans le même repère tournant du port cible : une valeur négative indique un recul.
- **Il se réveille** : ses réflexes (fin d'un autopilote, phases de la rentrée, alerte grave, écart, rapport de vol) et les règles qu'on lui demande (« toutes les 10 minutes, vérifie le carburant », « à chaque étape, annonce-la »). Un réveil par événement ; il peut se taire. Réglages : Réflexes et réveils, Budget par heure (0,05 $). Onglet Réveils de sa console : chacun activable.
- **Ses sous-agents** : jusqu'à 4 copies en parallèle, en lecture et en calcul seulement ; seul TARS agit.
- **Il montre** le graphe du hub et le couloir de rentrée en direct, ses propres canaux (inclinaison, incidence…) ; « vue vaisseau » ramène la caméra au vaisseau.
- **Sa console** se déplace par sa poignée ⠿ (en haut à droite ; sa place est gardée, un double clic la remet), s'agrandit, se replie ; ses onglets : Échange, Agents, Réveils, Mémoire.

### Phase 3 : ce qu'ont les grands agents

- **Les commandes « / »**, complétées en tapant (↑ ↓, Tab, Entrée) : /help, /clear, /compact, /model, /mode, /plan, /cost, /budget, /status, /telemetry, /show, /stop, /undo, /retry, /export, /memory, /forget, /agents, /wakes, /reflexes, /voice, /skill, /dock, /login, /key, /logout, /deepgram.
- **Tout le jeu en commandes**, exécutées sans le modèle (sans coût), leurs arguments complétés : /target, /view (et /cockpit, /chase, /shipview…), /autopilot, /land, /entry, /takeoff, /dock, /hold, /throttle, /gear, /flaps, /brake, /sas, /mission, /maneuver, /teleport, /warp, /pause, /date, /map, /panel, /sky, /save, /load, /scene, /set, /quality, /press, /places, /weather… et /tool pour n'importe lequel de ses outils (« /tool place_ship mode=orbit body=mars altKm=300 »).
- **@** complète un corps, un site, un écran, un réglage ; **↑ ↓** rappellent les questions passées.
- **Ses modes** (Maj+Tab, /mode) : Agir (sans confirmation), Proposer (il propose chaque plan avant d'agir), Observer (il lit et montre, n'agit pas).
- **Sa liste de tâches** pour une tâche en plusieurs étapes, cochée en direct.
- **Les savoir-faire** : « /skill save nom » garde la dernière demande ; « /nom » la rejoue ; il peut en créer lui-même.

### Phase 4 : le copilote de chasse

Plan : [`PLAN-AVIATION-AAA.md`](PLAN-AVIATION-AAA.md) (I1–I4, S1–S3) ; les fiches : [`progress/aviation/`](progress/aviation/) (I1 à I4, S1 à S3, [ECOLE-RESEAU](progress/aviation/ECOLE-RESEAU.md)). En F-35, TARS est le navigateur en place arrière, l'instructeur et l'ailier. Ses outils :

| Outil | Actions | Ce qu'il fait |
|---|---|---|
| `f35` | `fields`, `prepare`, `challenges`, `fly`, `abort`, `figures`, `figure` | les vols du F-35 : les terrains de départ ; un vol préparé et lancé (`field` : OACI ou nom ; `start` : `runway` aligné, `final` à 15 km, `cruise` à 40 km ; `hour` : celle du terrain ; `weather` ; `fuel` 0,05–1 ; `dest` : un plan de vol vers un terrain d'arrivée) ; les défis (Mach Loop, Rainbow Canyon, le slalom, les atterrissages, la voltige) et les combats avec leurs records et médailles, l'un lancé, abandonné ; les dix figures de voltige, une figure (ou `box` : cinq d'affilée, sur 100) en `watch` (l'autopilote la vole) ou `fly` (le pilote, noté sur 20) |
| `lesson` | `list`, `guided`, `demo`, `try`, `open` | l'école de vol (18 leçons : premier vol, tour de piste, atterrissage, ILS, Case I, patrouille, interception, canon, les dix figures). **`guided`** (par défaut pour « apprends-moi… ») : TARS vole la première partie en disant chaque étape, puis « à vous les commandes », l'instructeur regarde, corrige et débriefe. **`demo`** : TARS vole **toute** la leçon, la part du pilote comprise, avec ses propres mots ; notée d'un toast, sans fenêtre de débriefing ; une démo qui n'avance plus depuis 90 s est abandonnée et le dit. **`try`** : le pilote seul, l'instructeur regardant. Une leçon lancée, TARS dit une phrase et ne touche plus au vol |
| `mission` | `list`, `fly`, `create`, `modify`, `status`, `abort`, `map`, `edit`, `link` | les missions notées sur 20 (celles du jeu, du pilote, les vues d'exception `view-…`) ; une mission composée d'après les mots du pilote (JSON : unités, objectifs `reach`/`destroy`/`escort`/`protect`/`identify`/`land`/`qual`/`show`, déclencheurs, départ, rôles d'équipe, heure, météo), ou modifiée (champs remplacés, unités/objectifs/déclencheurs fusionnés par id, `remove` ; une mission du jeu modifiée devient une copie du pilote) ; la carte de mission, l'éditeur, le lien à partager |
| `traffic` | `list`, `info`, `intercept`, `join`, `stop` | les avions autour (l'image radar du F-35 en vol, sinon le trafic entendu : vrai trafic, joueurs de la salle, ailiers, combat) avec indicatif, type, distance, relèvement, horloge, altitude, aspect ; l'interception volée (la course, la rejointe, l'ombre 300 m derrière à gauche — ne pas toucher aux commandes ensuite) ; **`join`** : sur un joueur de la salle, **son aile**, la formation volée pour nous à la première place libre (ses ailiers IA et les autres joueurs sur son aile comptés ; loin de plus de 20 km, d'abord placé à côté de lui) ; sur un avion de ligne, notre place dans la formation choisie ; sinon son ombre |
| `flight_lead` | `wingmen`, `order`, `status` | la patrouille qu'il mène : 0 à 3 ailiers IA (Deux, Trois, Quatre) ; un ordre dit à la radio — `rejoin`, `shape` (`echelonR`, `echelonL`, `fingertip`, `vic`, `diamond`, `line`, `trail`, `spread`), `tighten`, `loosen`, `attack` (son verrou), `engage`, `cover`, `hold`, `rtb`, `breakL`, `breakR`, `show` (le losange serré d'un passage, la caméra fly-by) ; l'état de la formation |
| `weapons` | `status`, `threats`, `bogey_dope`, `select`, `lock`, `radar`, `fire`, `gun`, `countermeasures` | les armes et le radar : les emports (AIM-120, AIM-9X, GBU-32, JSM, obus, leurres), les dégâts, le mode et le verrou ; l'image tactique (missiles sur nous, hostiles en BRAA, dernières annonces) ; la *bogey dope* demandée à Darkstar ; une arme, un verrou par nom, RWS/TWS/STT ; le tir (il renvoie ce qui reste), une rafale de 0,2 à 3 s, leurres et paillettes — armes actives en combat ou en mission seulement ; il tire quand le pilote l'ordonne |
| `knowledge` | `search`, `read` | sa base aéronautique (`f35`, `basics`, `energy`, `bfm`, `formation`, `carrier`, `ils`, `emergencies`, `radar`, `weapons`, `traffic`) : les sections qui répondent à une question, ou une page entière / une section par un mot de son titre ; en français ou en anglais |
| `jet_mode` | `orbit`, `hold`, `tf`, `tanker`, `off` | les modes de l'autopilote : orbite sur un point, hippodrome d'attente, suivi de terrain (100, 150, 300 m sol), le ravitailleur TEXACO 11 rejoint au pré-contact |
| `approach` | `ils`, `clear`, `off`, `status`, `procedures` | l'ILS volé par l'autopilote jusqu'à l'arrêt, noté sur 20 (attente au point initial possible) ; les procédures de départ et d'arrivée du plan de vol |
| `carrier` | `spawn`, `qual`, `land`, `recover`, `takeoff`, `status`, `clear` | les porte-avions (Ford, Kiev, Implacable) et leurs frégates ; une qualification (jour, nuit, mer forte) ; posé sur le pont ; la récupération (le F-35B à la verticale, le F-35C sur les brins par son cas I, II, III ou en ligne droite) ; le décollage du F-35B |
| `flight_plan` | `show`, `add`, `remove`, `clear`, `cruise`, `direct`, `nav` | le plan de vol (points par code OACI, nom, adresse ou coordonnées, contraintes d'altitude et de vitesse, croisière, réserve), LNAV/VNAV |

- **Les menaces annoncées** (`game/threats.ts`, réglage *Annonces des menaces*, activé par défaut) : en combat il annonce lui-même un missile tiré sur nous (horloge, distance, quoi faire — dégagement, leurres ; un SAM : au travers, paillettes), le même à moins de 3 km, sa fin (leurré, évité), un coup reçu. Les missiles et les coups coupent ce qui se dit ; le reste attend 3 s. Les amis et les neutres ne sont jamais annoncés.
- **Les rôles de la radio** (`game/radio.ts`, réglage *Rôles radio*, activé par défaut) : l'ailier (AILIER), l'AWACS **Darkstar** (les bandits nouveaux par leur BRAA, les groupes, les sites SAM, les victoires, la *bogey dope*), le porte-avions **Mother** et son officier d'appontage **Paddles** parlent chacun de sa voix (Deepgram, ou une autre voix du système), leur nom en sous-titre. TARS ne garde que ce qui est à lui (les missiles sur nous, les coups) ; Paddles coupe les autres. Les annonces qui concernent notre avion partent à la salle (« Ana — Roger ball. ») ; Darkstar n'est pas partagé. Coupé : tout repasse par la voix de la tour et TARS reprend la situation.
- **Sa base de connaissances** (`ai/knowledge.ts`, I1) : pour toute question d'aviation (un chiffre, une procédure, une tactique), il la cherche avant de répondre. Les pages : [`aviation/fr`](aviation/fr/), [`aviation/en`](aviation/en/).

## Les outils de test (`__bh`)

| Outil | Rôle |
|---|---|
| `__bh.voice` | `say(ligne)`, `said` (ce qui a été dit), `asked` (ce qui a été demandé), `queue`, `stop()` |
| `__bh.capcom` | `blackout` |
| `__bh.music` | `moment`, `notes`, `ticks` |
| `__bh.tarsVoice` | `phonemes`, `synthesize`, `robotVoice` : la voix de TARS rendue hors ligne (sa mesure) |
| `__bh.tars` | `agent.ask(question)`, `agent.last` (ses actions), `agent.lastText`, `memory`, `tools()` |
| `__bh.flight.school.state()` | la leçon en cours : l'étape, son temps, ce qu'il en reste, depuis quand elle stagne |
| `__sound.busLevels()`, `__sound.busSpectrum(bus)` | les niveaux et les spectres des bus (voix, musique…) |

## Les tests

- **Unitaires** :
  - `voice` (la file, la voix choisie) ;
  - `callouts`, `capcom`, `score` ;
  - `tars-voice` (phonèmes, synthèse), `tars` ;
  - `openrouter` (clé, PKCE, échange, appels, coût, alias, rationnement) ;
  - `tars-agent` (arguments, un tour, ses bornes, la mémoire, les réveils, le budget, les sous-agents, les commandes et leurs complétions), `tars-tools` (noms, sites, touches, réglages, ordres hors ligne, télémétrie) ;
  - `knowledge` (onze pages par langue, leurs sections parallèles, une question trouvant sa section), `threats` (horloge, BRAA, la veille d'un combat), `radio` (les rôles reconnus, leurs voix, le partage), `course` et `instructor` (les leçons, leurs étapes, la démonstration entière).
- **e2e** :
  - `voice` (les sous-titres, l'ordre) ;
  - `callouts` (le posé d'Edwards : les hauteurs dans l'ordre, minimums, la tour, l'arrêt des roues) ;
  - `music` (Miller, le tic-tac, le silence) ;
  - `tars-voice` (la voix robot jouée, coupée) ;
  - `tars` (F6, vraie saisie) ;
  - `tars-online` (réseau simulé dans la page) ;
  - `tars-agent` (modèle simulé, 11 cas : un ordre, une erreur corrigée, l'arrêt, la mémoire, la présence, la proposition, les réveils, la console, les commandes « / » et les commandes de jeu sans appel au modèle) ;
  - `tars-agent-live` et `tars-eval` (le vrai OpenRouter, `TARS_LIVE=1` : le banc court ; `TARS_LONG=1` : les longs vols) ;
  - `tars-reach` (les vols du F-35, le plan de vol, la musique, les sauvegardes, les pages) ;
  - `copilot` (TARS en direct en combat : le verrou, le tir, les menaces ; le vrai trafic au-dessus de Paris, une interception ; une mission modifiée) et `radio` (deux pages d'une salle : Darkstar, l'ailier, Mother, Paddles, entendus par l'autre) ;
  - `school-demos` (chaque démonstration de l'école lancée par de vrais clics, surveillée toutes les 2 s : échec si elle stagne 45 s, si une étape finit par son temps maximal, si un débriefing, la pause ou « appareil perdu » apparaît ; `DEMOS=landing,circuit` pour un sous-ensemble).
- **Mesurer une voix**
  - Whisper (`faster-whisper`, modèle « small ») ;
  - 0,4 s de silence autour de chaque phrase ;
  - un décodage déterministe ;
  - la mesure validée d'abord sur les voix du système.

La carte au sol est locale, au zoom 18 initial : `/mapzoom 18` ou `interface({mapZoom:18})` ouvre et règle
le planisphère d’un personnage ou d’un vaisseau posé. `get_state.localMap` et `get_telemetry({groups:["map"]})`
exposent coordonnées, zoom, source disponible, déplacement du centre et coût CPU. L’événement `map` suit
l’ouverture et le zoom. Le groupe `streaming` indique l’avance des chargements dans la direction du vol,
bornée à six secondes et 650 m. [Analyse et validation](CORRECTIONS-DETAILS-SOL-VOL.md).

Le planisphère au sol fonctionne sur toutes les surfaces marchables. Le zoom va de 0 à 21 ; les atlas
planétaires disponibles sont réutilisés, et les mondes sans atlas affichent un quadrillage explicite.
L’état `map` indique aussi `radiusM` et `sourceStatus` (`ready`, `loading`, `unavailable`).

Les volumes de collision des arbres et bâtiments se visualisent en rose à pied sur Terre (éteint par défaut) :
`/set sceneryHitboxes true` (désactiver avec `false`), ou `set_settings` avec la même clé.
`find_settings("hitbox")` retrouve l’interrupteur et `get_state.sceneryHitboxes` indique son état.
