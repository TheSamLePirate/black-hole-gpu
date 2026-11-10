# Audit 2026-11-10 — 05. TARS et audio

Périmètre : `src/ai/*`, `src/ui/tars-panel.ts`, `src/game/tools.ts`, `src/audio/*`, le relais Deepgram de
`server.ts`, le câblage dans `src/main.ts` (l. 996–1866, 7397–7800), les tests `tests/tars-*.test.ts` et
`tests/e2e/tars-*.e2e.test.ts`. Lecture seule. Aucun serveur, e2e, test ni appel externe lancé. Le contenu de `.env`
n'a pas été lu (le fichier existe, il est ignoré par Git ; le code attend `OPENROUTER_API_KEY`, `DEEPGRAM_API_KEY`,
`KERR_EAR_RELAY`).

Niveaux de preuve : **lu** = lu dans le code ; **mesuré** = mesuré par un script statique (source donnée) ;
**supposé** = à confirmer.

## 0. Chiffres de cadrage

| Quoi | Valeur | Preuve |
|---|---|---|
| Outils donnés au modèle (mode ACT) | **68** | mesuré : script statique important `gameTools()` avec un hôte factice, 10/11/2026 |
| JSON des 68 outils envoyé à chaque étape | **71 163 caractères** | mesuré, même script (`JSON.stringify(tools.map(toFunction))`) |
| Consigne système (`agentPrompt`) | **6 104 caractères** (en), 6 103 (fr) | mesuré, même script |
| Les plus lourds | `multiple_exposure` 5 152, `mission` 3 867, `carrier` 2 332, `camera` 2 290, `get_telemetry` 2 179 | mesuré |
| Outils à paramètre `action` (plusieurs fonctions en un) | 22 | mesuré |
| Étapes par tour | 24 (`MAX_STEPS`), 8 par sous-agent, 4 sous-agents | lu `src/ai/agent.ts:52`, `src/ai/subagents.ts:30-32` |
| Durée d'un tour | 40 min (`MAX_TURN_MS`), 40 s par appel modèle, `wait` ≤ 900 s | lu `agent.ts:54`, `openrouter.ts:228`, `game-tools.ts:2625` |
| Réponse du modèle | `max_tokens` 600, pas de streaming | lu `openrouter.ts:239` |
| Mémoire | 24 tours, 40 notes de 200 car., résumé 2 400 car. | lu `memory.ts:39-42` |

Ordre de grandeur (supposé, 3,5 à 4 caractères par jeton) : environ 20 000 jetons d'entrée **par étape**, avant
l'état du vol et la mémoire. Un tour de 24 étapes renvoie donc près de 500 000 jetons d'entrée. Aucun cache de
prompt n'est demandé dans la requête (`openrouter.ts:235-243`).

## 1. Couverture : domaines du jeu et outils de TARS

« Même action » = l'outil appelle la fonction que le clavier ou l'UI appelle. « Parallèle » = il écrit l'état
lui-même.

| Domaine | Outil TARS | Chemin |
|---|---|---|
| Autopilotes vaisseau, maintiens | `autopilot`, `hold`, `flight_action` | Même action (`pilotAuto`, `pilotHold`, `autoWhy` — `main.ts:7412-7414`) |
| Commandes (gaz, train, volets, aérofrein) | `controls` | Mixte : train, SAS, roulis par l'action clavier ; **gaz, volets, aérofrein écrits en direct** (TA-10) |
| Pilote auto avion (altitude, cap, vitesse) | **aucun** | `camera.apSet` existe, la console d'équipage l'utilise (`crew-exec.ts:96`), pas TARS (TA-03) |
| A320 : FCU, MCDU, ECAM, autobrake, inverseurs, stand, repoussage | **aucun** | Seulement `set_craft a320` et les bascules `press_key jetSystem:*` (TA-03) |
| F-35 : modes, ILS, porte-avions, ravitaillement | `jet_mode`, `approach`, `carrier`, `f35` | Même action (méthodes du contrôleur) |
| F-35 : pages PCD, HMD | **aucun** | `show_screen` ne connaît que les écrans du Ranger (`game-tools.ts:287-312`) |
| Plan de vol avion | `flight_plan` | Parallèle : `R.wps.splice`, `N.on = …` puis `routeChanged()` (`game-tools.ts:2293-2325`) |
| Ordinateur de vol, missions spatiales | `plan_maneuver`, `plan_mission`, `manage_plan` | Même action (`fc/ops`, `missionPlan`, `fcExecute`) |
| Radar, armes, trafic, patrouille | `weapons`, `traffic`, `flight_lead` | Même action, sauf `wingmen` et `gun` (TA-21) |
| Caméra, vues, modes de jeu | `camera`, `set_mode`, `sky`, `observe`, `atlas` | Même action ; voyage G/⇧G et `__bh.tour` seulement par `press_key` ou pas du tout |
| Date, temps | `time`, `set_date` | Même action (`setWarp`, `playPause`, `tools.setDate`) |
| Météo | `get_weather`, `weather_at` (lecture) | Écriture par `set_settings` seulement |
| Carte | `interface`, `show_screen` | Même action |
| Photo, vidéo, poses multiples | `capture`, `video`, `multiple_exposure`, `interface screenshot` | Même action |
| Réglages | `find_settings`, `set_settings` | **Parallèle** à `panel.set` (TA-09) |
| Sauvegardes, scènes | `saves`, `start_scene` | Même action, **sans la confirmation de l'UI** (TA-02) |
| Missions, école, défis | `mission`, `lesson`, `f35` | Même action |
| Marche à pied | `character` | Même action (mêmes contrôles que ⇧K, dit dans la description) |
| Musique | `music` | Même action |
| Réseau (salon : créer, rejoindre, quitter, flotte, messages) | **aucun** | Seul `show_screen crew_console` ouvre le lien d'équipage (TA-17) |
| Zones hors ligne | **aucun** | (TA-17) |
| Aurores, capteurs / caméra secondaire | pas d'outil dédié | Au mieux `set_settings` ; non vérifié clé par clé |
| Systèmes vaisseau (RCS, anneau…) | `press_key spaceSystem:*` | Bascule, pas d'état visé |

Outils pointant vers du code disparu : **aucun trouvé** (l'hôte `GameHost` est typé ; la compilation TypeScript n'a
pas été lancée ici). Trois lectures passent par `any` et échappent au typage : `graphSource` (`game-tools.ts:3002`,
`hubInfo`, `entryRun`), `skyInfo` (`main.ts:1299`).

## 2. Constats

### P1

**TA-01 — P1 — `src/ai/tars-agent.ts:163-166`, `src/main.ts:1528-1549`**
Constat : un tour coupé par une **nouvelle question** renvoie `null`. Pour `tarsAsk`, `null` veut dire « le modèle a
échoué » : il passe alors la question **coupée** dans `parseOrders` et exécute ses ordres hors ligne, puis dit la
phrase hors ligne. Le commentaire dit pourtant « stopped by a new question: that one answers ».
Impact : « pose-nous à Edwards » puis, pendant le tour, « non, vise Mars » : l'ordre de pose est rejoué par
`runOrders` pendant que le second tour agit. Deux acteurs sur le vaisseau, une réponse parlée en trop.
Piste : distinguer « coupé » de « échec » (un troisième retour), ne jamais lancer le repli hors ligne après une coupure.
Preuve : lu dans le code ; non reproduit en jeu.

**TA-02 — P1 — `src/ai/game-tools.ts:2504-2506`, `src/game/tools.ts:1072-1075`, `src/ui/pause.ts:487-494`**
Constat : `saves delete` efface une sauvegarde tout de suite. Pas de filet « Before TARS » (il ne sert à rien ici),
pas de confirmation. Le menu Pause, lui, demande un second appui. `saves save <nom>` écrase aussi sans le dire.
Impact : une sauvegarde du joueur perdue sur une phrase mal comprise, un réveil automatique ou une injection (TA-11).
La règle « TARS fait tout sans demander » (`game-tools.ts:11`) n'a de filet que pour ce qui se rattrape.
Piste : passer par `propose_plan` (accepter/refuser) pour `delete`, ou une corbeille ; refuser `delete` hors mode ACT
demandé par le pilote (pas dans un réveil).
Preuve : lu dans le code.

**TA-03 — P1 — `src/ai/game-tools.ts` (absence), `src/ui/crew-exec.ts:96-102`, `src/main.ts:4114-4126`, `4395`**
Constat : aucun outil ne règle le pilote automatique d'un avion (altitude, cap, vitesse). `camera.apSet({alt, hdg,
spd, ap, athr})` existe et la console d'équipage s'en sert. TARS n'a que `press_key jetSystem:ap|athr|…`, des
**bascules** sans valeur ni état visé. Pour l'A320 : rien sur le FCU, le MCDU, l'ECAM, l'autobrake, le stand, le
repoussage. La base de connaissances n'a pas de page A320 (`src/ai/knowledge.ts:9-40`).
Impact : « monte à 5 000 m, cap 270 » n'a pas de chemin sûr. L'A320, appareil de niveau AAA, est hors de portée du
copilote. Contraire à CLAUDE.md (« mêmes actions métier »).
Piste : un outil `autopilot_plane` sur `apSet`, `a320Approach`, `atStand`, `pushedBack` ; une page `a320.md`.
Preuve : lu dans le code (`grep` : 0 occurrence de `apSet`, `jetToggle`, `atStand`, `mcdu` dans `game-tools.ts`).

**TA-04 — P1 — `src/ai/agent.ts:95-106`, `src/ai/openrouter.ts:235-243`**
Constat : chaque étape renvoie les 68 outils (71 163 car.) et la consigne (6 104 car.). Pas de sous-ensemble par
appareil ou par mode de jeu, pas de cache de prompt, pas de streaming.
Impact : coût et latence par étape dominés par un texte fixe. La voix attend la fin de chaque appel complet. Avec le
modèle le plus cher de la liste (2 $/M en entrée, `openrouter.ts:26`), environ 0,04 $ par étape (supposé, calcul).
Piste : outils par contexte (avion / vaisseau / à pied / photo), descriptions raccourcies, cache de prompt du
fournisseur, streaming du texte final vers la voix.
Preuve : tailles mesurées (script statique) ; coût supposé, non mesuré.

**TA-05 — P1 — `src/ai/openrouter.ts:253`, `267-269`, `src/ai/tars-agent.ts:169`**
Constat : toute réponse non 2xx (401 clé révoquée, 402 crédit épuisé, 429, 5xx) devient `null`, sans reprise ni
message. Sans action faite, TARS bascule en silence sur ses phrases hors ligne. Avec des actions déjà faites, il dit
« Ça prend trop de temps, je m'arrête là » (`doneWord(…, "time")`), ce qui est faux.
Impact : le joueur ne sait pas pourquoi TARS devient « bête ». Un tour coupé en plein milieu laisse le vaisseau dans
un état partiel, sans le dire.
Piste : renvoyer le code d'erreur, une reprise courte sur 429/5xx, un message clair (clé, crédit, réseau), un mot
« interrompu : fait A et B, pas C ».
Preuve : lu dans le code.

### P2

**TA-06 — P2 — `src/main.ts:1197`, `1343-1347`, `src/ai/budget.ts:28-30`, `src/ai/triggers.ts:216-219`**
Constat : le budget horaire n'est vérifié qu'**au départ** d'un réveil. Le tour qui suit garde 24 étapes et tous les
outils du mode ACT. Les règles `every` et `in` suivent l'horloge murale : elles partent jeu en pause, sur l'écran
titre, onglet caché.
Impact : un seul réveil peut dépasser plusieurs fois le plafond (0,05 $/h par défaut). Un onglet oublié avec une
règle « toutes les 5 min » dépense sans joueur. Un réflexe (« agis si tu sauves la situation ») peut agir seul.
Piste : `maxSteps` court pour les réveils, plafond vérifié à chaque étape, pas de réveil en pause ni onglet caché,
outils d'écriture destructrice retirés des réveils.
Preuve : lu dans le code.

**TA-07 — P2 — `src/ai/memory.ts:115-124`, `src/ai/tars-agent.ts:182-188`**
Constat : `compact` calcule `n` avant d'attendre le résumé (jusqu'à 30 s), puis coupe `turns.slice(n)`. Si un
second tour finit pendant ce temps, un second `compact` part avec son propre `n`. Les deux coupes s'additionnent.
Impact : les tours récents sont jetés sans être résumés (cas 25 puis 26 tours : il ne reste rien).
Piste : un verrou (un seul `compact` à la fois), couper par identité des tours résumés.
Preuve : lu dans le code ; non couvert par `tests/tars-agent.test.ts:155`.

**TA-08 — P2 — `src/ai/offline-orders.ts:43`, `63-65`, `85`**
Constat : faux positifs du mode hors ligne. « annule … » (sauf « autopilot ») → `saves undo`, donc **recharge**
« Before TARS ». « pose-nous sur la Lune » → `autopilot entry, site: "lune"` → erreur « no site ». Le mot « pause »
dans une question met le jeu en pause.
Impact : hors ligne (ou après un échec réseau, TA-05), une phrase banale recharge une partie ou échoue. La parité
avec le mode en ligne est faible : une quinzaine d'intentions, rien pour l'avion (ILS, volets, AP).
Piste : « annule » limité à « annule ça / le dernier » ; un corps céleste après « sur » → `land` ; tests de phrases
négatives.
Preuve : lu dans le code.

**TA-09 — P2 — `src/ai/game-tools.ts:2563-2580`, `1511-1524`, `1565-1568`, `src/ui/panel.ts:261-269`**
Constat : `set_settings`, `sky`, `interface` écrivent `settings[k]` puis appellent `onSettingsChange`. L'UI passe par
`panel.set` : historique annuler/rétablir (`begin`/`commit`), `updateQuality`, dépendances. `panel.setValue` existe
déjà « pour l'extérieur » (`panel.ts:109`).
Impact : un réglage changé par TARS n'entre pas dans l'annulation du panneau ; le préréglage de qualité affiché peut
rester faux. Deux chemins pour la même action.
Piste : `h.changed` remplacé par `panel.setValue(key, value)` pour chaque clé.
Preuve : lu dans le code ; effet sur la persistance supposé, à confirmer.

**TA-10 — P2 — `src/ai/game-tools.ts:1140-1141`, `src/main.ts:4093-4105`**
Constat : `controls flaps` arrondit à 0 / 0,5 / 1 et écrit `cfg.flaps`. Le clavier de l'A320 a cinq crans (0, 1, 2,
3, FULL = `lever/4`) et annonce la configuration. L'aérofrein et les gaz sont aussi écrits en direct.
Impact : TARS (et la console d'équipage, qui passe par le même outil, `crew-exec.ts:66`) ne peut pas demander
CONF 1 ni CONF 3. Pas d'annonce.
Piste : une action métier `setFlaps(cran)` commune au clavier, à l'équipage et à TARS.
Preuve : lu dans le code.

**TA-11 — P2 — `src/ai/game-tools.ts:1833`, `1060-1064`, `531`, `2088`, `src/ai/agent.ts:134`**
Constat : du contenu non maîtrisé entre tel quel dans les résultats d'outils : noms des pilotes du salon et
indicatifs du trafic réel (`traffic`), journal du jeu (`get_log`), résultats OpenStreetMap (`atlas`, `place_ship`),
missions partagées par lien (`mission`). Rien ne le marque comme « donnée, pas consigne ». En mode ACT, TARS agit
sans confirmation.
Impact : une injection par pseudo ou par mission partagée peut viser `saves delete`, `set_settings`, `memory`.
Le pseudo est limité à 24 caractères côté client (`netpanel.ts:205`), ce qui réduit la charge sans l'annuler.
Piste : encadrer ces champs (balise « untrusted »), consigne dédiée, outils destructeurs soumis à acceptation quand
le tour a lu du contenu externe.
Preuve : lu dans le code ; aucune attaque essayée ; limite côté serveur du pseudo non vérifiée.

**TA-12 — P2 — `src/ai/openrouter.ts:239`, `264-266`, `src/ai/game-tools.ts:2061-2065`**
Constat : `max_tokens` vaut 600, raisonnement compris pour certains modèles. `finish_reason` n'est pas lu. L'outil
`mission create` attend un JSON de mission entier dans une chaîne.
Impact : un appel tronqué donne « arguments are not valid JSON » ; le modèle recommence, à 20 000 jetons l'essai.
Piste : lire `finish_reason === "length"`, relever la limite quand un appel d'outil est en cours.
Preuve : lu dans le code ; fréquence non mesurée.

**TA-13 — P2 — `src/main.ts:1742-1753`, `1703-1706`, `src/audio/engine.ts:329-334`, `src/ui/netvoice.ts:292`**
Constat : `sound.duck` n'est appelé que pour la voix d'un autre joueur. Ni TARS, ni les annonces, ni la radio ne
baissent les moteurs et la musique. Appuyer sur F6 pour parler ne coupe pas la voix de TARS et ne baisse rien.
Une voix système (Web Speech) ne passe pas par l'`AudioContext` (`voice.ts:6`) : ni mixage, ni spatialisation.
Impact : TARS inaudible plein gaz ; sur haut-parleurs, le micro reprend moteurs, alarmes et TARS lui-même.
Priorités proches : réponse de TARS et radio des rôles à 2 (`main.ts:1121`, `6115`), aucune voix simultanée.
Piste : duck à `onStart`/`onEnd` de toute ligne, duck fort et coupe de TARS pendant l'écoute.
Preuve : lu dans le code ; niveaux non mesurés.

**TA-14 — P2 — `server.ts:23`, `32-33`, `240-244`**
Constat : le relais Deepgram (clé de `.env`) accepte toute connexion **sans en-tête Origin**. Pas d'authentification,
pas de limite de débit ni de durée ; file d'attente non bornée. Actif en dev et avec `KERR_EAR_RELAY=1`.
Impact : toute machine qui atteint le serveur de dev (réseau local, Tailscale) consomme la clé de Sam en écoute et
en synthèse. En production le relais est coupé : le joueur doit coller sa propre clé ou garder l'oreille du
navigateur.
Piste : exiger un Origin égal à l'hôte, un jeton de session, un plafond de durée et de taille.
Preuve : lu dans le code ; interface d'écoute du serveur non vérifiée.

**TA-15 — P2 — `src/ai/game-tools.ts:491-497`, `2520`**
Constat : le filet est une seule sauvegarde « Before TARS », réécrite à chaque appel à risque. Les échecs de
`tools.save` sont avalés.
Impact : un tour qui téléporte puis change la date ne peut revenir qu'avant la **dernière** action. `undo` ne rend
pas l'état d'avant le tour.
Piste : un filet par tour (pris une fois, au premier appel à risque), une petite pile.
Preuve : lu dans le code.

**TA-16 — P2 — `src/ai/tars-agent.ts:171`, `183`, `src/main.ts:1354`, `src/ai/triggers.ts:250`**
Constat : chaque réveil est rangé en mémoire comme un tour du **pilote**, avec son texte « [Woken by your reflex…] »
(jusqu'à 600 caractères par règle), même quand TARS répond « — ».
Impact : les 24 tours gardés se remplissent de réflexes ; les vraies demandes du pilote partent plus vite au résumé.
Piste : ne pas garder les réveils muets, garder les autres en une ligne.
Preuve : lu dans le code.

**TA-17 — P2 — `src/ai/game-tools.ts` (absence)**
Constat : pas d'outil pour le réseau (salon, flotte, messages), les zones hors ligne, les pages PCD du F-35, les
capteurs. Le voyage de caméra et les systèmes du vaisseau ne passent que par `press_key`.
Impact : « TARS couvre tout le jeu » (docs/TARS.md:155) est faux pour ces domaines.
Piste : les ajouter au fil des chantiers, par les actions métier existantes (`netPanel`, `offlineTab`, `jetPcd`).
Preuve : lu dans le code (`grep` sans résultat).

### P3

**TA-18 — P3 — `src/ai/game-tools.ts:2179`, `2155`, `2225`, `1838-1844`**
Unités mêlées : `carrier status` rend `speedKt` ; les descriptions parlent en NM ; `traffic` rend des textes dans les
unités du joueur quand le reste est en SI ; `flight_plan altM` et `cruise altM` ne disent pas leur datum (mer ou
ellipsoïde). Piste : SI partout, datum nommé. Preuve : lu.

**TA-19 — P3 — `src/ai/tool-schema.ts:7-12`, `src/ai/game-tools.ts:1821-1822`, `1979-1983`, `2162-2168`**
Validation maison (pas de zod) : correcte et testée, mais sans longueur maximale de chaîne ; plusieurs nombres sans
bornes (`maxKm`, `n`, `lat`/`lon` de `jet_mode` et `carrier`, `passes`). `lon` va jusqu'à 360 ici, 180 ailleurs.
Preuve : lu.

**TA-20 — P3 — `src/ai/openrouter.ts:12-27`, `src/settings.ts:984`**
Modèle par défaut codé en dur (`z-ai/glm-5.3-flash`), liste et prix datés du 09/10/2026, décisions sur un point
d'accès « alpha » (`/api/alpha/decisions`). Un modèle retiré donne un échec muet (TA-05). Existence des modèles
**non vérifiée** (aucun appel externe). Piste : lire le catalogue au lancement, repli nommé.

**TA-21 — P3 — `src/ai/game-tools.ts:1806`, `1911-1914`**
`flight_lead wingmen` écrit `c.s.wingmen` sans `h.changed`. `weapons gun` tient la détente par `setTimeout` (temps
réel : ignore la pause et l'arrêt du tour). Preuve : lu.

**TA-22 — P3 — `src/ai/deepgram.ts:216-240`, `src/audio/deepgram-voice.ts:52-89`, `src/ai/listen.ts:52`**
Latence : un `AudioContext` et un `ScriptProcessorNode` (API dépréciée) neufs à chaque écoute ; 280 ms de maintien
avant d'écouter ; jusqu'à 3 s d'attente à la fin ; la voix Aura attend la synthèse **entière** (12 s au plus) avant
de jouer. Aucune latence de bout en bout mesurée dans le dépôt (supposé). Piste : `AudioWorklet` gardé chaud, lecture
en flux.

**TA-23 — P3 — `src/main.ts:1777-1784`**
Voix de TARS : le robot du jeu n'existe qu'en anglais. En français sans Deepgram, c'est la voix système, hors
`AudioContext` : pas de grain, pas de place dans le cockpit. Expérience FR et EN différentes. Preuve : lu.

**TA-24 — P3 — `src/audio/engine.ts:280-284`, `388-391`, `263`, `src/audio/engine-worklet.ts:29`**
Moteur audio : le contexte est suspendu onglet caché (une ligne de TARS dite pendant un `wait` est perdue) ; l'état
« interrupted » de Safari et l'événement `statechange` ne sont pas traités (supposé) ; `busLevels` alloue un
`Float32Array` par appel ; le worklet alloue un petit objet par bloc de 128 échantillons. 103 créations de nœuds dans
`engine.ts` ; nombre de nœuds vivants et coût HRTF **non mesurés**.

**TA-25 — P3 — `src/ai/openrouter.ts:16`, `34-46`, `src/ai/deepgram.ts:9-24`**
Les clés du joueur vivent dans le `localStorage` (jamais dans une sauvegarde ni le bundle : vérifié par lecture).
Tout script de la même origine peut les lire ; l'aperçu `/test/` partage l'origine des Pages (supposé). La mémoire
(nom du pilote, notes) y est en clair, sans date de fin. Piste : le dire dans l'UI, `sessionStorage` en option.

**TA-26 — P3 — `docs/systemes/10-tars-agent.md:24`, `src/ai/game-tools.ts:1190`**
Docs en retard : « 43 outils », 1 444 lignes (le code : 68 outils, 3 050 lignes). La description de `set_craft` cite
trois appareils, son énumération cinq. Preuve : lu.

## 3. Tests

Couvert (lu, non lancé) : schéma et erreurs d'arguments, un tour et ses bornes, mémoire, réveils, budget,
sous-agents (`tests/tars-agent.test.ts`, 8 tests) ; résolution des noms, réglages, ordres hors ligne, commandes « / »,
une vingtaine d'outils sur hôte factice (`tests/tars-tools.test.ts`, 20 tests) ; file des voix, écoute, synthèse,
musique, échantillons ; e2e avec modèle simulé (`tars-agent.e2e`, 12 tests), portée F-35 (`tars-reach.e2e`).
Évaluation réelle : `tars-eval.e2e`, 5 tâches courtes et 2 longues, seulement avec `TARS_LIVE=1` et une clé ; hors CI.

Manque : la coupure par une nouvelle question (TA-01) ; phrases négatives hors ligne (TA-08) ; course de
compaction (TA-07) ; dépassement de budget d'un réveil (TA-06) ; erreurs 401/402/429 (TA-05) ; injection (TA-11) ;
un test « chaque outil d'écriture passe par l'action métier » ; un garde-fou de taille (nombre d'outils, caractères) ;
avion et A320 dans l'évaluation ; chevauchement voix/moteurs, reprise après onglet caché, nombre de nœuds audio.

## 4. Récapitulatif

| Id | Gravité | Sujet | Preuve |
|---|---|---|---|
| TA-01 | P1 | Tour coupé par une nouvelle question : l'ancien ordre rejoué hors ligne | lu |
| TA-02 | P1 | `saves delete` sans confirmation ni filet | lu |
| TA-03 | P1 | Pas d'outil pour le pilote auto avion ni pour l'A320 | lu |
| TA-04 | P1 | 68 outils, 77 000 caractères renvoyés à chaque étape, sans cache ni streaming | mesuré / supposé (coût) |
| TA-05 | P1 | Erreurs réseau, clé, crédit, 429 : muettes, message faux | lu |
| TA-06 | P2 | Budget des réveils dépassable ; réveils en pause et onglet caché | lu |
| TA-07 | P2 | Course dans la compaction de la mémoire | lu |
| TA-08 | P2 | Ordres hors ligne : faux positifs (« annule » recharge une partie) | lu |
| TA-09 | P2 | Réglages : chemin parallèle au panneau | lu |
| TA-10 | P2 | Volets de l'A320 inaccessibles, écritures directes | lu |
| TA-11 | P2 | Injection par contenu de jeu ou de réseau | lu, non essayé |
| TA-12 | P2 | `max_tokens` 600, troncature non détectée | lu |
| TA-13 | P2 | Pas de duck ni de coupe de voix à l'écoute | lu |
| TA-14 | P2 | Relais Deepgram ouvert sans Origin, sans limite | lu |
| TA-15 | P2 | Un seul « Before TARS » par action, pas par tour | lu |
| TA-16 | P2 | Réveils rangés comme tours du pilote | lu |
| TA-17 | P2 | Réseau, zones hors ligne, PCD, capteurs sans outil | lu |
| TA-18 | P3 | Unités et datums mêlés | lu |
| TA-19 | P3 | Schémas : bornes et longueurs manquantes | lu |
| TA-20 | P3 | Modèles codés en dur, non vérifiés | lu / non vérifié |
| TA-21 | P3 | `wingmen` sans notification, `gun` en temps réel | lu |
| TA-22 | P3 | Latence voix et écoute, API dépréciée | lu / supposé |
| TA-23 | P3 | Voix FR et EN différentes | lu |
| TA-24 | P3 | Moteur audio : suspension, allocations, nœuds | lu / supposé |
| TA-25 | P3 | Clés et mémoire en `localStorage` | lu / supposé |
| TA-26 | P3 | Docs en retard | lu |

## 5. Ce qui est solide

- La boucle d'agent est petite et lisible : arguments vérifiés avant tout appel, erreur rendue au modèle, appels en
  ordre, arrêt par signal, bornes d'étapes et de temps (`agent.ts`).
- Les ordres hors ligne, les commandes « / » et la console d'équipage passent par **les mêmes outils**
  (`runOrders`, `gameCall`, `crew-exec.ts` avec une table fermée d'actes).
- Les modes PROPOSER et OBSERVER retirent vraiment les outils d'écriture (`modeTools`) ; les sous-agents ne lisent
  que (`READ_TOOLS`, planificateurs forcés à `execute: false`).
- La clé n'est ni dans le bundle, ni dans les sauvegardes, ni dans les journaux lus ; OAuth PKCE sans serveur.
- Le panneau de TARS n'utilise pas `innerHTML` (aucune occurrence dans `tars-panel.ts` ni `ui/tars/`).
- La file des voix est pure et testée (priorité, durée de vie, répétition). Le synthétiseur du worklet n'alloue pas
  ses tampons dans `process` (`rocket.ts:46-50`).

## 6. Non vérifié

- Aucun appel réel : existence et prix des modèles, comportement de 429, coût et latence par tour.
- Aucun e2e ni test lancé ; la compilation TypeScript non plus.
- Latence voix de bout en bout, niveaux sonores, nombre de nœuds audio vivants, coût HRTF.
- Limite du pseudo côté serveur de salons ; interface réseau du serveur de dev.
- Outils non lus ligne à ligne : `multiple_exposure`, `find_eclipses`, `sky_events`, `video`, `capture`
  (`game-tools.ts:700-1040`, `1600-1720`) ; `tars-panel.ts`, `tars-commands.ts`, `game-commands.ts`, `telemetry.ts`,
  `director.ts`, `music.ts`, `samples.ts` survolés seulement.
- Réglages des aurores et des capteurs accessibles par `set_settings` : non vérifié clé par clé.
