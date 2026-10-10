# La musique, les voix et TARS

Le vol se fait entendre de trois façons :
- **les voix** : les annonces de l'appareil, le contrôle de mission et la tour par radio, TARS ;
- **la musique**, aux seuls grands moments ;
- **TARS**, le robot copilote, qu'on interroge avec F6 et qui parle parfois de lui-même.

Tout est synthétisé ou tiré du système : rien à télécharger. TARS peut aussi passer par OpenRouter avec la clé du joueur. Plan : [`PLAN-TARS.md`](PLAN-TARS.md) (M10, T1–T7).

## Les fichiers

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
| `src/ui/tars-panel.ts`, `pwa/openrouter.html` | sa console F6 (emblème, onglets Échange · Agents · Réveils · Mémoire, actions en direct, suivi du hub, proposition, tâches, autocomplétion, modes, poignée) et le lien à OpenRouter ; la page de rappel de la connexion |
| `src/ai/agent.ts`, `src/ai/tool-schema.ts` | TARS agent : la boucle d'un tour (appels, résultats, bornes, arrêt) ; le schéma des outils et la vérification des arguments |
| `src/ai/game-tools.ts`, `src/ai/settings-tools.ts` | ses 49 outils : tout le jeu, montrer, proposer, attendre, réveils, sous-agents, tâches, savoir-faire ; les réglages trouvés par les mots et vérifiés au schéma |
| `src/ai/telemetry.ts` | `get_telemetry` par groupes (attitude, air, commandes, autopilote, hub, rentrée, approche, descente, poussée, amarrage) ; ses canaux échantillonnés pour ses graphes |
| `src/ai/triggers.ts`, `src/ai/budget.ts` | ses réveils : réflexes et règles (événements, toutes les N min, à une heure du jeu) ; le plafond par heure et l'intervalle |
| `src/ai/subagents.ts` | ses sous-agents : jusqu'à 4 copies en parallèle, lecture et calcul seulement |
| `src/ai/commands.ts`, `src/ai/tars-commands.ts` | les 26 commandes « / » de l'agent, les mentions @, les modes, les savoir-faire ; leurs complétions (pur) et leur exécution |
| `src/ai/game-commands.ts` | les 76 commandes de jeu (« /target », « /cockpit », « /teleport »…) exécutées par ses outils sans le modèle ; leurs arguments complétés |
| `src/ui/tars/emblem.ts`, `src/ui/tars/display.ts`, `src/ui/tars/chart.ts` | son emblème animé ; ses cartes sur la vue (graphes en direct, couloir et graphe du hub superposés, fiches) et leur tracé |
| `src/ai/tars-agent.ts`, `src/ai/memory.ts` | sa consigne d'agent, un tour à la fois ; sa mémoire gardée entre les visites |
| `src/ai/offline-orders.ts`, `src/ai/listen.ts` | les ordres compris hors ligne ; le push-to-talk |
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
- **F6 maintenu** (ou le bouton micro de sa console, cliqué pour commencer puis pour finir) l'écoute : la reconnaissance du navigateur s'arrête parfois d'elle-même (Chrome après un temps mort, Safari après sa première phrase) — elle est relancée aussitôt, ce qui a été dit gardé, jusqu'au relâchement ; un micro refusé ou des coupures immédiates répétées arrêtent l'écoute, leur code dit dans la console (`ai/listen.ts`, `tests/listen.test.ts`).
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
- **Ce qu'il fait** : ses 49 outils couvrent tout le jeu.
  - Lire : l'état entier, les sites et pistes, les corps, la météo (et la météo réelle de n'importe quel lieu à n'importe quelle date depuis 1940 : `weather_at`, `/weatherat`), le ciel (télémétrie « sky » : hauteurs vraies et réfractées du Soleil et de la Lune, l'éclipse en cours là où est la caméra — sa phase, la part du Soleil cachée, celle de la Lune dans l'ombre ; il est réveillé à chaque phase : réflexe « éclipse »), les éclipses passées et à venir partout dans le système solaire (`find_eclipses`, `eclipse_local`, `/eclipses`, `/eclipse` ; il y emmène : `go_see_eclipse` ; il en montre la page : écran `eclipses`), les photographies en surimpression (`multiple_exposure`, `/analemma` : l'analemme d'un lieu, ses dates et positions écrites à côté de chaque Soleil ; `/eclipsephoto` : les phases d'une éclipse de Soleil ou de Lune vue d'un lieu, la totalité au milieu, l'heure et la part cachée de chaque disque — dans le ciel du trépied, en bande ou dans l'ombre de la Terre —, ou le transit de Mercure ou de Vénus ; `/startrails` : un filé d'étoiles ; `/moonpath` : le trajet de la Lune sur une nuit, à la même heure chaque jour ou chaque jour lunaire ; `/issphoto` : la traînée de l'ISS), les passages visibles de l'ISS (`iss_passes`, `/isspasses`), les réglages, sauvegardes et scènes, le journal, le dernier rapport, les touches.
  - Piloter : les autopilotes (posé sur un site, décollage vers une orbite, amarrage…), les maintiens, les commandes, la remise de gaz.
  - Naviguer : la cible, le calculateur de vol (planifié puis exécuté), une mission vers un corps ou la station.
  - Le temps et la date, les vues, le ciel, les panneaux et la carte.
  - Téléporter, sauvegarder et charger, lancer une scène.
  - **Tout réglage**, vérifié au schéma ; **toute touche**.
  - **Attendre** l'issue (la fin d'un autopilote, un posé, une orbite autour d'un corps) pendant que le jeu tourne.
- **Sa console** (F6) : son emblème — quatre monolithes animés selon son état (prêt, à l'écoute, réfléchit, agit, parle) —, l'échange, ses actions en direct (◌ en cours, ✓ fait, ✗ refusé ; la ligne entière en info-bulle), la ligne vivante d'une attente, « TARS travaille… (Échap : arrêter) ». Fermée, **sa présence** reste en haut de l'écran tant qu'il agit ou parle. Ce qu'il a lancé (un autopilote, un plan) est **suivi jusqu'au bout**, puis l'issue dite.
- **Il montre** : des graphes (les canaux de l'enregistreur en direct, ou ses propres séries), des fiches de chiffres, et les vrais écrans du jeu (la carte, la tablette, un écran du cockpit, le rapport de vol) ; trois cartes au plus sur la vue, fermées par leur ×.
- **Ordres et propositions** : un ordre (« pose-nous », « vise Mars ») s'exécute sans confirmation ; « propose-moi un plan pour… » donne un plan chiffré, sans rien exécuter, avec ACCEPTER / REFUSER (ou « oui » / « non ») — accepté, il l'exécute.
- **L'arrêter** : Échap, « stop », ou une nouvelle question.
- **Le filet** : avant ce qui ne se défait pas (charger, déplacer, changer la date, une scène), la partie est sauvegardée sous « Before TARS » ; « annule » y revient.
- **Sa mémoire** : la conversation gardée d'une visite à l'autre, dans ce navigateur seulement (jamais dans une sauvegarde, les réglages, un export). 24 échanges mot pour mot, les plus vieux résumés par le modèle ; ses notes (votre nom, vos préférences). Dans le champ F6 : leur nombre et « effacer » ; ou « oublie tout ».
- **Le modèle** : réglage « Modèle de TARS » — GLM-5.3 Flash par défaut (le moins cher), Claude Haiku 5.5, GPT-6 Luna, DeepSeek V4.1 Flash, Gemini 3.8 Flash, Claude Sonnet 5.5. Un vol vers la Lune mené par TARS a coûté 0,0012 $ avec GLM.
- **Hors ligne** (sans clé, sans réseau, ou le réglage coupé) : les ordres courants compris en français et en anglais — poser, décoller, circulariser, amarrer, la cible, le train, le temps, les vues, la carte, sauvegarder, annuler, téléporter en orbite, oublier — exécutés par les mêmes outils ; une question garde ses phrases écrites.

### Phase 2 : le super-agent

- **Il sait tout du vol** (`get_telemetry`) : l'attitude, l'air, les commandes, ce que chaque autopilote commande (l'inclinaison et l'incidence de la rentrée, le profil et le PAPI de l'approche, la poussée en cours), l'étape du hub et ses écarts.
- **Il se réveille** : ses réflexes (fin d'un autopilote, phases de la rentrée, alerte grave, écart, rapport de vol) et les règles qu'on lui demande (« toutes les 10 minutes, vérifie le carburant », « à chaque étape, annonce-la »). Un réveil par événement ; il peut se taire. Réglages : Réflexes et réveils, Budget par heure (0,05 $). Onglet Réveils de sa console : chacun activable.
- **Ses sous-agents** : jusqu'à 4 copies en parallèle, en lecture et en calcul seulement ; seul TARS agit.
- **Il montre** le graphe du hub et le couloir de rentrée en direct, ses propres canaux (inclinaison, incidence…) ; « vue vaisseau » ramène la caméra au vaisseau.
- **Sa console** se déplace par sa poignée ⠿ (en haut à droite ; sa place est gardée, un double clic la remet), s'agrandit, se replie ; ses onglets : Échange, Agents, Réveils, Mémoire.

### Phase 3 : ce qu'ont les grands agents

- **Les commandes « / »**, complétées en tapant (↑ ↓, Tab, Entrée) : /help, /clear, /compact, /model, /mode, /plan, /cost, /budget, /status, /telemetry, /show, /stop, /undo, /retry, /export, /memory, /forget, /agents, /wakes, /reflexes, /voice, /skill, /dock, /login, /key, /logout.
- **Tout le jeu en commandes**, exécutées sans le modèle (sans coût), leurs arguments complétés : /target, /view (et /cockpit, /chase, /shipview…), /autopilot, /land, /entry, /takeoff, /dock, /hold, /throttle, /gear, /flaps, /brake, /sas, /mission, /maneuver, /teleport, /warp, /pause, /date, /map, /panel, /sky, /save, /load, /scene, /set, /quality, /press, /places, /weather… et /tool pour n'importe lequel de ses outils (« /tool place_ship mode=orbit body=mars altKm=300 »).
- **@** complète un corps, un site, un écran, un réglage ; **↑ ↓** rappellent les questions passées.
- **Ses modes** (Maj+Tab, /mode) : Agir (sans confirmation), Proposer (il propose chaque plan avant d'agir), Observer (il lit et montre, n'agit pas).
- **Sa liste de tâches** pour une tâche en plusieurs étapes, cochée en direct.
- **Les savoir-faire** : « /skill save nom » garde la dernière demande ; « /nom » la rejoue ; il peut en créer lui-même.

## Les outils de test (`__bh`)

| Outil | Rôle |
|---|---|
| `__bh.voice` | `say(ligne)`, `said` (ce qui a été dit), `asked` (ce qui a été demandé), `queue`, `stop()` |
| `__bh.capcom` | `blackout` |
| `__bh.music` | `moment`, `notes`, `ticks` |
| `__bh.tarsVoice` | `phonemes`, `synthesize`, `robotVoice` : la voix de TARS rendue hors ligne (sa mesure) |
| `__bh.tars` | `agent.ask(question)`, `agent.last` (ses actions), `agent.lastText`, `memory`, `tools()` |
| `__sound.busLevels()`, `__sound.busSpectrum(bus)` | les niveaux et les spectres des bus (voix, musique…) |

## Les tests

- **Unitaires** :
  - `voice` (la file, la voix choisie) ;
  - `callouts`, `capcom`, `score` ;
  - `tars-voice` (phonèmes, synthèse), `tars` ;
  - `openrouter` (clé, PKCE, échange, appels, coût, alias, rationnement) ;
  - `tars-agent` (arguments, un tour, ses bornes, la mémoire, les réveils, le budget, les sous-agents, les commandes et leurs complétions), `tars-tools` (noms, sites, touches, réglages, ordres hors ligne, télémétrie).
- **e2e** :
  - `voice` (les sous-titres, l'ordre) ;
  - `callouts` (le posé d'Edwards : les hauteurs dans l'ordre, minimums, la tour, l'arrêt des roues) ;
  - `music` (Miller, le tic-tac, le silence) ;
  - `tars-voice` (la voix robot jouée, coupée) ;
  - `tars` (F6, vraie saisie) ;
  - `tars-online` (réseau simulé dans la page) ;
  - `tars-agent` (modèle simulé, 11 cas : un ordre, une erreur corrigée, l'arrêt, la mémoire, la présence, la proposition, les réveils, la console, les commandes « / » et les commandes de jeu sans appel au modèle) ;
  - `tars-agent-live` et `tars-eval` (le vrai OpenRouter, `TARS_LIVE=1` : le banc court ; `TARS_LONG=1` : les longs vols).
- **Mesurer une voix**
  - Whisper (`faster-whisper`, modèle « small ») ;
  - 0,4 s de silence autour de chaque phrase ;
  - un décodage déterministe ;
  - la mesure validée d'abord sur les voix du système.
