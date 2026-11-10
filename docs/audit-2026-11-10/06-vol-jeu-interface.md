# Audit 2026-11-10 — 06. Vol, gameplay et interface

État : audit par lecture du code, le 10 novembre 2026, branche `main` (dernier commit lu : `29d4e5e3`).
Rien n'a été lancé : ni serveur, ni e2e, ni `bun test`. Aucun fichier du code n'a été modifié.

Niveaux de preuve employés :

- **lu** : lu dans le code, aux lignes citées. Le comportement en jeu n'a pas été rejoué.
- **mesuré (source)** : constaté en jeu par une session antérieure, source citée.
- **supposé** : déduit du code, à confirmer en jeu.

Gravités : P0 bloque le jeu ; P1 casse une fonction annoncée ou surprend dangereusement le pilote ; P2 incohérence
visible ; P3 finition, dette, documentation.

---

## 1. Constats

### FX-01 — P1 — Maj et Alt sont à la fois des modificateurs et la manette des gaz

- **Où** : `src/controller/piloting.ts:878-881` (Maj = manette +, Alt = manette −, lus chaque image, sans exclure
  les accords) ; `src/controls.ts:566-577` (toute touche enfoncée entre dans `codes`).
- **Constat** : tenir Maj pour un raccourci (⇧P aérofrein, ⇧V vue précédente, ⇧R recentrer la caméra, ⇧M, ⇧O, ⇧K,
  ⇧L, ⇧Y, ⇧F4, ⇧', ⇧B, ⇧G, ⇧8, ⇧9, ⇧0…) donne aussi `inp.throttle = +1` pendant l'appui. Alt + molette (focale,
  `src/input/keymap.ts:205`) donne `inp.throttle = −1`.
- **Impact** (chaque lecteur de `inp.throttle ≠ 0`) :
  - l'ILS passe en manuel : `src/controller/ils.ts:300` ;
  - l'appontage automatique se coupe : `src/controller/deckland.ts:154`, `:174`, `:193` ; le brin : `src/controller/trap.ts:201` ;
  - la formation et l'interception se coupent : `src/controller/formation.ts:91`, `src/controller/intercept.ts:104` ;
  - **amarré, le vaisseau se désamarre** : `src/controller/piloting.ts:1007` (`inp.throttle > 0`) — par exemple ⇧V ou ⇧K à quai ;
  - l'autothrottle change sa consigne : `src/controller/jet.ts:252` ;
  - sans autopilote, la manette monte de 0,6/s (`src/pilot.ts:795`) : ⇧P au roulage dépasse 5 % en moins de 0,1 s,
    rentre les spoilers sol et coupe le freinage au ralenti (`src/controller/piloting.ts:1357-1358`).
- **Piste** : ne compter Maj/Alt comme manette que si aucune autre touche n'est enfoncée (ou après un délai court sans
  accord) ; ou séparer la manette (↑ ↓ seuls) des modificateurs. Un test unitaire sur `pilotInput` avec `ShiftLeft + KeyP`.
- **Preuve** : lu. Effets en jeu non rejoués.

### FX-02 — P1 — U et F7 sur un avion lancent l'autopilote orbital, qui refuse et coupe les gaz

- **Où** : `src/main.ts:3067-3087` (`pilotAuto`), `src/main.ts:4047` (U et F7 exemptés de la garde `jetOnly`) ;
  `src/controller/lowthrust.ts:672-677` (refus sous poussée/poids 1,05) ; `src/controller/lowthrust.ts:2359-2363`
  (`say` → `setAuto("none")`) ; `src/pilot.ts:402-407` (couper un autopilote met la manette à 0).
- **Constat** : F-35B loin d'un porte-avions, ou A320 partout : U (ou F7) affiche « Autopilot: Take off », puis à
  l'image suivante l'autopilote refuse (« the engine (… g) cannot hold the weight ») et **met la manette à 0**.
  Le F-35C passe par `catLaunch` / `trapLand` (`src/controller/deckland.ts:241`, `:61`), le B par le pont seulement.
- **Impact** : une touche annoncée « décoller / atterrir » coupe les gaz d'un avion au roulage ou en vol (le ralenti du
  F135 n'est pas modélisé : manette 0 = poussée 0, voir FX-16). Le HUD propose LAND et TAKE OFF
  (`src/ui/flighthud.ts:182-183`). `docs/F35.md` dit que U décolle ; `docs/VOL-AVIONS.md` §4.1 dit que F7 loin d'un
  porte-avions vole « un profil droit à 3° » : ce profil n'existe pas dans le chemin lu.
- **Piste** : pour `isAircraft`, soit un vrai décollage/atterrissage (F-35 : rotation puis montée ; atterrissage =
  `ilsStart` sur la piste la plus proche ; A320 : renvoi au FMGC), soit un refus dit avant d'enclencher, sans toucher la
  manette. Corriger les deux docs dans le même lot.
- **Preuve** : lu (chaîne complète). Confirme le point « U ne décolle probablement pas un F-35 » de
  `docs/PROBLEMES-A-REGLER.md`, et l'étend à F7 et à l'A320.

### FX-03 — P1 — Lander posé : `auto === "takeoff"` sans poussée, sans message, sans fin

- **Où** : `src/pilot.ts:513-520` (la poussée n'est donnée qu'une fois le nez sur le vecteur : cos 12° → cos 3°) ;
  `src/controller/lowthrust.ts:717-736` (seul le Ranger a un départ sur son train) ;
  `src/controller/piloting.ts:1285-1291` (`groundUp` réservé à `isPlane`) ;
  `src/controller/motion.ts:225`, `:896`, `:916` (le toucher termine tous les autopilotes **sauf** le décollage).
- **Constat** : posé, le Lander a son nez à l'horizontale ; la boucle de vitesse demande une poussée vers le haut,
  l'alignement vaut ≈ 0, la manette reste à 0, donc l'appareil reste « posé ». Aucun délai, aucun message.
- **Impact** : état zombie. La leçon 10 du cours (`docs/VOL-VAISSEAUX.md`) ne peut pas se voler au Lander depuis le sol.
- **Piste** : départ vertical en poussée vectorisée pour un appareil non `isPlane` (comme `hover` bas,
  `lowthrust.ts:539`), puis la loi de montée ; à défaut, un abandon dit après N secondes sans décoller.
- **Preuve** : mesuré (`docs/PROBLEMES-A-REGLER.md`, constat en jeu du 6 novembre 2026) ; mécanisme lu, toujours présent.

### FX-04 — P2 — Grisés du HUD pour décoller et atterrir rattachés au mauvais `else`

- **Où** : `src/ui/flighthud.ts:2274-2280`.
- **Constat** : `why.takeoff = "Not on the ground"` et `why.land = "No ground near"` sont dans le `else` du test du
  maintien de station. Ils ne s'appliquent que s'il y a un appareil ou la station à moins de 5 km — et alors TAKE OFF
  est grisé **même posé**. Sans appareil proche, rien n'est grisé.
- **Impact** : boutons actifs qui ne peuvent rien faire, ou grisés à tort. Alimente FX-02 et FX-03.
- **Piste** : sortir les deux règles du `else` et conditionner `takeoff` à `!i.landed`.
- **Preuve** : lu. Défaut de `PROBLEMES-A-REGLER` toujours présent.

### FX-05 — P2 — Le bouton LAND du HUD annonce la touche « G »

- **Où** : `src/ui/flighthud.ts:182` ; la touche réelle est F7 (`src/input/keymap.ts:337`), G est le train (`keymap.ts`, ligne « G »).
- **Impact** : le joueur qui suit le HUD sort ou rentre le train au lieu d'atterrir.
- **Piste** : tirer les libellés de touches du HUD de `effectiveBindings()` (une seule source, réassignation comprise).
- **Preuve** : lu.

### FX-06 — P2 — « Tout relâcher » (Retour arrière) ne relâche pas les modes des avions

- **Où** : `src/main.ts:3817-3822`.
- **Constat** : la fonction arrête la mission, le maintien, `pilot.auto` et la cinématique. Elle ne touche ni
  `jetModes` (AP, A/THR), ni NAV, ni ILS, ni formation, ni interception, ni ravitaillement, ni appontage, ni le FMGC de l'A320.
- **Impact** : même touche, promesse différente selon l'appareil. Sur un avion, l'AP continue de voler.
- **Piste** : une action métier unique « rendre la main » par appareil, appelée par la touche, la manette et TARS.
- **Preuve** : lu.

### FX-07 — P2 — A320 à la manette de jeu : disposition générique et maintiens orbitaux non gardés

- **Où** : `src/controller/lens.ts:187-217` (manette F-35 : `f35` seulement ; manette vaisseau : `!isAircraft`) ;
  `src/controller/piloting.ts:902-909` (repli : stick gauche = tangage + **lacet**, gâchettes hautes = roulis) ;
  `src/main.ts:3735-3751` (X / Y → `pilotHold("prograde" / "retrograde")`, A → SAS).
- **Constat** : l'A320 n'a pas de disposition propre. Le stick ne commande pas le roulis. X et Y enclenchent un
  maintien orbital, que le clavier refuse pour un avion (`src/main.ts:4045`, garde `jetOnly`).
- **Impact** : l'A320 est difficilement pilotable à la manette ; une touche engage un mode sans sens pour lui.
- **Piste** : étendre `jetpad.ts` à `isAircraft` (boutons F-35 inopérants masqués) et passer les actions de manette par
  les mêmes gardes que le clavier.
- **Preuve** : lu.

### FX-08 — P2 — V fait défiler des vues propres à l'A320 sur les autres appareils

- **Où** : `src/main.ts:4051-4058` (cycle sur `Object.keys(MOUNTS)`) ; `src/mounts.ts:30-33` (hublot, train, dérive :
  `only: ["a320"]`) ; `src/mounts.ts:108-111` (repli sur la vue poursuite) ; la manette, elle, utilise `mountKeys()` (`src/main.ts:3743-3745`).
- **Constat** : sur Ranger, Lander, Endurance, F-35, trois appuis sur V affichent « Camera: Main gear… » et montrent la
  vue poursuite.
- **Piste** : `mountKeys()` dans l'action `mount`.
- **Preuve** : lu.

### FX-09 — P2 — La sauvegarde ne contient pas l'état des avions ni celui des activités

- **Où** : `src/game/save.ts:23-72` (format) ; `src/game/tools.ts:935-980` (écriture) ; `src/game/tools.ts:995`
  (`newFlight` au chargement) ; `src/controller/piloting.ts:199-200` (`fleet.spent = {}`, `fleet.fuel = {}`).
- **Constat** : absents de la sauvegarde : carburant des avions (`fleet.fuel`), emports (`fleet.payload`), train, volets,
  aérofrein, AP/A/THR, STOVL, ILS en cours, systèmes et FMGC/MCDU de l'A320, pannes armées, consommables et pannes des
  vaisseaux (`fleet.systems`), températures de coque, progression d'une mission aérienne, d'un combat, d'un défi, d'une
  leçon, porte-avions placés. Le plan de vol est gardé, son guidage coupé (`tools.ts:1041-1046`).
- **Impact** : F5 puis F9 en F-35 rend les réservoirs pleins et l'avion train rentré selon l'altitude. F5 en mission
  n'avertit pas que la mission ne sera pas reprise.
- **Piste** : un bloc `aircraft` versionné (v3) ; pour les activités, soit sauver l'état, soit refuser/avertir.
- **Preuve** : lu. Reprise en jeu non rejouée.

### FX-10 — P2 — « Reprendre » de l'écran de perte peut recharger un instantané d'un autre vol

- **Où** : `src/main.ts:7898-7901` (instantané pris à l'entrée dans l'air, à plus de 1 000 m/s :
  `src/controller/piloting.ts:1409`) ; `src/main.ts:7928-7934`.
- **Constat** : `entryPoint` n'est jamais remis à `null` (nouveau placement, changement d'appareil, nouvelle scène).
- **Impact** : après une rentrée en Ranger, un crash en F-35 plus tard propose de reprendre « avant l'entrée » du Ranger.
  Sans rentrée préalable, un avion n'a pas de reprise du tout.
- **Piste** : vider `entryPoint` à chaque `newFlight` ; pour les avions, un instantané glissant (toutes les 30 s en vol stable).
- **Preuve** : lu.

### FX-11 — P2 — A320 : TAT et SAT inversées et fausses en vitesse

- **Où** : `src/a320/du/data.ts:203-204`.
- **Constat** : `tat = T_statique − 273,15` puis `sat = tat / (1 + 0,2 M²)` : la température statique est affichée comme
  TAT, et la « SAT » est une valeur en °C divisée. Il faudrait `TAT = T_statique[K] · (1 + 0,2 M²) − 273,15`, `SAT = T_statique − 273,15`.
- **Impact** : à Mach 0,78 et −56 °C, écart d'environ 26 °C sur la TAT ; SAT affichée ≈ −50 °C au lieu de −56 °C.
- **Preuve** : lu (suppose que `L.air.T` est la température statique du modèle d'air). Défaut de `PROBLEMES-A-REGLER` toujours présent.

### FX-12 — P2 — Touches « collées » : l'ensemble `keys` est indexé par le caractère

- **Où** : `src/controls.ts:566-577` (`keys.add(e.key)` / `keys.delete(e.key)`) ; lecteurs : `src/controller/lens.ts:329-330` (zoom + / −).
- **Constat** : sur AZERTY, « + » se tape avec Maj. Si Maj est relâchée avant la touche, le `keyup` porte « = » : « + »
  reste dans `keys` jusqu'à la perte du focus. Le zoom continue seul.
- **Impact secondaire (supposé)** : en combat, « = » (arme suivante) et « − » (leurres) (`src/input/keymap.ts:299`) zooment
  aussi la vue si la branche `!away` de `lens.ts:327` est active en pilotage.
- **Piste** : lire `codes` (codes physiques) partout ; retirer `keys`.
- **Preuve** : lu ; effet en combat supposé.

### FX-13 — P2 — ⇧M a deux fonctions

- **Où** : `src/input/keymap.ts:292-294` (NAV, par code `KeyM`) ; `src/ui/panel.ts:1171-1174` (panneau des réglages
  sur le caractère m/M avec Maj en vol) ; aide : `keymap.ts:355` et `:491` (« flying: ⇧M » = réglages).
- **Constat** : sur QWERTY les deux écouteurs se déclenchent sur la même touche : NAV bascule et le panneau s'ouvre.
  Sur AZERTY ce sont deux touches physiques, mais l'aide les nomme toutes deux « ⇧M ».
- **Piste** : une seule table (le panneau lit la table de `keymap.ts`) ; déplacer l'un des deux.
- **Preuve** : lu.

### FX-14 — P2 — Changer d'appareil ne remet pas l'état de configuration

- **Où** : `src/controller/fleet.ts:156-244` ; `gearInit` n'est remis que par `newFlight` (`src/controller/piloting.ts:208`).
- **Constat** : `switchVessel` remet `auto`, `hold`, manette, plan. Il garde `gearDown`/`gearExt`, `airBrake`,
  `airFlight.cfg.flaps`, `jetModes`, `nav.on`, `ilsRun`, `groundSpoilers`. Un seul jeu de ces variables sert tous les appareils.
- **Impact (supposé)** : passer d'un Ranger en orbite (train rentré) à un F-35 laissé au sol peut le retrouver train
  rentré, donc sur le ventre au premier roulage (`piloting.ts:1390`).
- **Piste** : un état de configuration par appareil dans `fleet`, ou `gearInit = false` et remise à zéro au changement.
- **Preuve** : lu ; effet supposé.

### FX-15 — P2 — Endurance : la rotation de l'anneau est abandonnée dès qu'un maintien pointe le nez

- **Où** : `src/pilot.ts:726-748` (branche de pointage : `want[2] = 0` ; `spinHold` n'est lu que dans l'autre branche).
- **Impact** : prograde, rétrograde, nœud ou amarrage arrêtent l'anneau sans le dire ; le poids affiché en cabine tombe.
- **Piste** : ajouter `spinHold` au roulis dans la branche de pointage quand `rollAlign` est coupé ; sinon le dire.
- **Preuve** : lu. Défaut de `VOL-VAISSEAUX` §5.6 toujours présent.

### FX-16 — P2 — Limites affichées mais non appliquées (toujours vrai)

- **Où** : `src/f35/engine.ts:30` (`idle: 0.05` défini, jamais lu ailleurs : recherche `\.idle` sans résultat hors A320) ;
  `src/a320/fmgc/fms.ts:27` et `src/a320/mcdu/pages-init.ts:196` (ZFW saisie, jamais portée à la masse) ; aucune
  occurrence de MTOW/MLW dans `src` ; pas de vitesse limite de train ni de volets (recherche sans résultat hors alarmes ECAM).
- **Impact** : manette 0 = poussée 0 sur F-35 (pas de ralenti, donc un plané irréaliste et l'effet de FX-02 aggravé) ;
  un A320 se pilote à toute masse, à toute vitesse, train et volets sortis.
- **Piste** : décision de Sam (jeu ou simulation) ; au minimum lire le ralenti du F135, et dégâts optionnels liés à `settings.damage`.
- **Preuve** : lu.

### FX-17 — P3 — Unités métriques écrites en dur dans les messages

- **Où** : `src/controller/jet.ts:81`, `:91`, `:138`, `:148` ; `src/controller/ils.ts:218-236` ;
  `src/controller/deckland.ts:263` ; `src/controller/trap.ts:358` ; `src/controller/radar.ts:365` ; `src/main.ts:5623` ;
  `src/controller/carriers.ts:120` (nœuds en dur). 84 messages `tf("… {n} m/s|km|m")` dans `src/controller`, `src/game`, `src/main.ts`.
- **Constat** : `unitsFor()` n'est importé que par 4 fichiers de `src/controller`. Avec l'option impériale, le HUD est
  en kt/ft et les messages en m et m/s.
- **Preuve** : lu (comptage par `grep`).

### FX-18 — P3 — Chaînes sans traduction

- **Où** : 17 messages du pilote sans `t()` : `src/controller/motion.ts:193`, `:194`, `:210`, `:214`, `:405`, `:474`,
  `:689`, `:902` ; `src/controller/docking.ts:458`, `:517`, `:666`, `:747`, `:774`, `:828` ;
  `src/controller/planet.ts:140`, `:165` ; `src/controls.ts:777`. Causes de perte en anglais seul :
  `src/flightair.ts:148-153` (texte affiché par l'écran de perte, `src/main.ts:7927`).
- **Preuve** : lu. Non vérifié : une traduction en aval par motif.

### FX-19 — P3 — Fraîcheur des instruments bridée, et une tendance sur l'horloge murale

- **Où** : `src/ui/cockpitscreens.ts:279` (écrans du Ranger : 8 Hz) ; `src/a320/du/display.ts:30` (10 Hz par défaut),
  `src/a320/du/pfd.ts:96` (PFD 20 Hz), `src/a320/du/isis.ts:17` (10 Hz) ; carte du hub 250 ms (`docs/VOL-VAISSEAUX.md` §6) ;
  `src/a320/du/data.ts:193-197` (tendance de vitesse calculée avec `performance.now()`).
- **Impact** : assiette du PFD à 20 Hz et secours à 10 Hz, visibles en roulis rapide ; la flèche de tendance est fausse
  en accélération du temps (×4 dans l'air) et à pas fixes (`__bh.step`).
- **Piste** : PFD/ISIS à chaque image (seules les couches lentes bridées) ; tendance sur le temps simulé.
- **Preuve** : lu. Coût non mesuré.

### FX-20 — P3 — « Sans dégâts » sur l'écran de perte change un réglage de la partie

- **Où** : `src/main.ts:7936-7942` ; `src/settings.ts:2356` (`damage: "carried"`, donc porté par les sauvegardes).
- **Impact** : un clic après un crash désactive toutes les limites pour la suite, sauvegardes comprises. Dit par un toast seulement.
- **Preuve** : lu.

### FX-21 — P3 — Fonctions à moitié finies ou éteintes (relevé)

| Élément | Où | État |
|---|---|---|
| EXPED de l'A320 | `src/a320/fmgc/fmgc.ts:229`, `:305` | ne change que le nom du mode |
| ALT CST | `src/a320/fmgc/fmgc.ts:81`, `:478` | `cstr` jamais renseigné (doc `VOL-AVIONS` §4.2) |
| TARS et l'A320 | `src/ai/game-tools.ts:1191` | seul le choix de l'appareil ; ni FCU, ni MCDU, ni repoussage |
| École de vol | `src/controller/course.ts:432` | F-35 seulement ; rien pour l'A320 |
| Pannes du F-35 | `docs/VOL-AVIONS.md` §4.1 | aucune (G-LOC et dégâts de combat seulement) |
| Préchargement du décor | `src/system/scenery.ts:412` (`prefetchOn = false`) | écrit, éteint (670 Mo contre 280 mesurés, commit `d11f0171`) |
| `EARTH_SKY_OPEN` | `src/system/earth-horizons.ts:164` | éteint en dur (hors de ce domaine) |
| Défense contre un état non fini | `src/controller/motion.ts` (`flyHome`) | la correction 3 de `ERRORS-TO-FIX` E1 n'est pas faite |

Seulement 3 `TODO/FIXME` dans tout `src` : la dette n'est pas marquée dans le code, elle est dans les docs.

### FX-22 — P3 — Documents à corriger

- `docs/ERRORS-TO-FIX.md` E1 : **corrigée** dans le code (`src/pilot.ts:806`, `src/controller/motion.ts:53-56`, `:167`, `:261`).
  L'entrée est marquée corrigée mais garde tout son corps au présent ; à archiver.
- `docs/VOL-AVIONS.md` §4.1 : « F7 loin d'un porte-avions : profil droit à 3° » — contredit par FX-02.
- `docs/F35.md` : « U décolle automatiquement » — faux hors pont.
- `docs/PROBLEMES-A-REGLER.md`, e2e qui lisent des membres inexistants : **toujours présent** —
  `tests/e2e/cockpit-flight.e2e.test.ts:60`, `:82` (`airInfo().agl`), `tests/e2e/coast-survey.e2e.test.ts:101`
  (`sys.sunElevation`), 8 occurrences de `c.last` dans `tests/e2e`.

---

## 2. Vérification des défauts déjà listés

| Source | Défaut | État le 10 novembre |
|---|---|---|
| PROBLEMES | Lander posé ne décolle pas avec U | toujours présent (FX-03) |
| PROBLEMES | U ne décolle pas un F-35 | confirmé par lecture, étendu à F7 et à l'A320, avec coupure des gaz (FX-02) |
| PROBLEMES | Grisés du HUD sur le mauvais `else` | toujours présent (FX-04) |
| PROBLEMES | TAT/SAT de l'A320 | toujours présent (FX-11) |
| PROBLEMES | Limites non appliquées, ZFW, ralenti F135 | toujours présent (FX-16) |
| PROBLEMES | e2e lisant des membres inexistants | toujours présent (FX-22) |
| VOL-VAISSEAUX §5.6 | Anneau ignoré sous maintien | toujours présent (FX-15) |
| VOL-VAISSEAUX §5.6 | Maintiens référés au trou près d'un monde de Gargantua | non vérifié |
| ERRORS-TO-FIX E1 | NaN après coupure du moteur | corrigé (corrections 1 et 2) ; correction 3 non faite |

---

## 3. Touches en double, par mode

| Touche | Mode | Fonction 1 | Fonction 2 | Source |
|---|---|---|---|---|
| Maj (tenue) | vol | manette + | modificateur de 15 raccourcis | `piloting.ts:878`, `keymap.ts` (FX-01) |
| Alt (tenue) | vol | manette − | Alt + molette : focale | `piloting.ts:880`, `keymap.ts:205` |
| ⇧M | vol (QWERTY) | NAV | panneau des réglages | `keymap.ts:294`, `panel.ts:1173` (FX-13) |
| = / − | combat | arme suivante / leurres | zoom de la vue (supposé) | `keymap.ts:299`, `lens.ts:329-330` |
| ↑ ↓ | vol | manette | curseur TDC quand il est tenu (exclu proprement) | `piloting.ts:877` — cohérent |
| Tab | vol | cible suivante | F-35 : verrouillage radar ; ⇧Tab F-35 : interception | `main.ts:5305-5309` — différent par appareil, dit dans l'aide |
| G | hors vol / vol | voyage relativiste | train | `keymap.ts:238`, ligne « G » — couches distinctes, mais le HUD écrit « G » pour LAND (FX-05) |
| U | hors vol / vol | grilles du ciel | décollage | couches distinctes — cohérent |
| Entrée | vol | acquitter l'alarme | combat : tirer | `main.ts:4155` — dit dans l'aide |
| Espace | tous / combat | pause | canon (pause sur Échap) | `main.ts:4190-4193` — dit dans l'aide |

Le test `tests/keymap.test.ts` interdit deux liaisons identiques dans une même couche. Il ne voit ni les touches
tenues (`HELD_DEFAULTS`), ni l'écouteur propre du panneau, ni `keys` : les trois sources des doublons ci-dessus.

---

## 4. Matrice de cohérence appareil × fonction

Légende : oui / partiel / non / inconnu. Source entre parenthèses ; « doc » = dit par la doc, non relu dans le code.

| Fonction | Ranger | Lander | Endurance | F-35B | F-35C | A320 |
|---|---|---|---|---|---|---|
| Décollage auto (U) | oui (`lowthrust.ts:718`) | partiel : non depuis le sol (FX-03) | non, refus dit (`lowthrust.ts:663`) | partiel : pont seulement (`deckland.ts:238`) ; piste : non (FX-02) | partiel : catapulte (`deckland.ts:241`) | non, coupe les gaz (FX-02) |
| Atterrissage auto (F7) | oui, propulsé ; plané par ⇧G (doc) | oui (doc, `descent.ts`) | non, refus dit | partiel : pont ; piste par l'ILS seulement | partiel : brins | partiel : autoland par le FMGC (doc) ; F7 refuse (FX-02) |
| ILS | non (`ils.ts:190`) ; aiguilles de piste en entrée (doc) | non | non | oui (`ils.ts`) | oui | oui (`a320App`, doc) |
| Plan de vol / NAV | plan de mission (nœuds) ; NAV avion inconnu | plan de mission | plan de mission | oui (`fplan.ts:126`) | oui | oui, par le FMGC (`fplan.ts:127`) |
| Maintiens AP / A/THR (') | oui en mode avion (`jet.ts:103`) | non | non | oui | oui | oui, FMGC (`jet.ts:102`) |
| Ravitaillement | inconnu (`controller/refuel.ts`) | inconnu | inconnu | oui, en vol (`jetmodes.ts:103`) | oui | au sol, camion (doc) |
| Combat | radar oui (`radar.ts:359`) ; armes inconnu | non | non | oui | oui | non (cible seulement, doc) |
| Pannes de systèmes | oui (`game/systems.ts`, doc) | oui | oui | non | non | oui, 76 (doc) |
| École | oui, spatiale (`spacecourse.ts`) | oui | partiel (doc, leçon 11) | oui (`course.ts`) | oui | non (`course.ts:432`) |
| Réseau | oui (doc PLAN-RESEAU) | oui (doc) | oui (doc) | oui (doc) | oui (doc) | inconnu |
| TARS | oui, outils communs | oui | oui | oui (`f35`, `jet_mode`, `carrier`) | oui | partiel : aucun outil propre (`game-tools.ts:1191`) |
| Cockpit cliquable | oui (`src/cockpit/pick.ts`) | inconnu | inconnu | oui (`f35/cockpit.ts`, PCD) | oui | oui (`a320/deckpick.ts`) |
| Vue 3ᵉ personne | oui | oui | oui | oui | oui | oui + 3 vues propres (`mounts.ts:30-33`) |
| Manette de jeu | propre (`spacepad.ts`) | propre | propre | propre (`jetpad.ts`) | propre | générique, inadaptée (FX-07) |
| « Tout relâcher » complet | oui | oui | oui | non (FX-06) | non | non |
| Sauvegarde fidèle | oui pour l'orbite et l'entrée (`save.ts`) | oui | oui | non (FX-09) | non | non |

---

## 5. Tableau récapitulatif

| Id | Gravité | Fichier:ligne | Constat | Preuve |
|---|---|---|---|---|
| FX-01 | P1 | `controller/piloting.ts:878` | Maj/Alt modificateurs = manette : coupe ILS, appontage, formation, désamarre | lu |
| FX-02 | P1 | `main.ts:3067`, `controller/lowthrust.ts:672`, `pilot.ts:406` | U/F7 sur avion : autopilote orbital, refus, manette à 0 | lu |
| FX-03 | P1 | `pilot.ts:513`, `controller/motion.ts:225` | Lander posé : décollage zombie | mesuré (PROBLEMES, 6 nov.) + lu |
| FX-04 | P2 | `ui/flighthud.ts:2274` | grisés décoller/atterrir sur le mauvais `else` | lu |
| FX-05 | P2 | `ui/flighthud.ts:182` | LAND annoncé sur « G » (réel : F7) | lu |
| FX-06 | P2 | `main.ts:3817` | Retour arrière ne relâche pas AP/ILS/NAV/FMGC | lu |
| FX-07 | P2 | `controller/lens.ts:187`, `main.ts:3740` | A320 à la manette : générique, maintiens orbitaux | lu |
| FX-08 | P2 | `main.ts:4051` | V passe par les vues de l'A320 sur tout appareil | lu |
| FX-09 | P2 | `game/save.ts:23`, `game/tools.ts:935` | sauvegarde sans état avion ni activités | lu |
| FX-10 | P2 | `main.ts:7898` | « Reprendre » : instantané d'un autre vol | lu |
| FX-11 | P2 | `a320/du/data.ts:203` | TAT/SAT fausses | lu |
| FX-12 | P2 | `controls.ts:571` | touches collées (`keys` par caractère) | lu |
| FX-13 | P2 | `input/keymap.ts:294`, `ui/panel.ts:1173` | ⇧M : NAV et réglages | lu |
| FX-14 | P2 | `controller/fleet.ts:156` | train/volets/modes gardés au changement d'appareil | lu ; effet supposé |
| FX-15 | P2 | `pilot.ts:730` | anneau de l'Endurance arrêté sous maintien | lu |
| FX-16 | P2 | `f35/engine.ts:30`, `a320/fmgc/fms.ts:27` | limites non appliquées, ralenti non lu | lu |
| FX-17 | P3 | `controller/jet.ts:138` | unités en dur dans 84 messages | lu |
| FX-18 | P3 | `controller/motion.ts:193`, `flightair.ts:148` | chaînes non traduites | lu |
| FX-19 | P3 | `ui/cockpitscreens.ts:279`, `a320/du/data.ts:193` | instruments bridés, tendance sur l'horloge murale | lu |
| FX-20 | P3 | `main.ts:7936` | « Sans dégâts » change un réglage porté | lu |
| FX-21 | P3 | voir tableau | fonctions à moitié finies | lu |
| FX-22 | P3 | docs citées | docs à corriger, e2e sans effet | lu |

---

## 6. Ce qui est solide

- Une seule table de touches (`input/keymap.ts`) dessine l'aide et distribue les actions, par code physique pour le vol ;
  réassignation avec échange (`input/bindings.ts`) ; test d'unicité par couche.
- Les refus des autopilotes sont dits (`say`), sauf le cas FX-03.
- E1 (NaN après coupure du moteur) est corrigée à la source et à l'usage.
- Garde `jetOnly` : les fonctions orbitales sont refusées et dites sur un avion au clavier.
- Unités : le HUD et les panneaux passent par `unitsFor()` ; peu d'unités aéronautiques en dur hors commentaires.
- i18n : presque tous les toasts et messages passent par `t()` / `tf()` (10 toasts et 17 messages hors table).
- Datums : pas d'altitude prise sur une sphère dans le vol ; les `6.371e6` restants servent des distances et l'horizon radar.
- La sauvegarde des vaisseaux (flotte, amarrages, plan, entrée en attente, site) est complète et versionnée.

## 7. Non vérifié

- Tout effet en jeu des constats « lu » : aucun n'a été rejoué.
- Stabilité en accélération du temps près du sol (pas de 4 ms, `subCap` 400–2 400 : le temps simulé ralentit-il sans le dire ?).
- Contact sol, verdicts de train, basculement, crash sur les mondes de Gargantua.
- Missions, combat, défis, qualifications : conditions de réussite et remises à zéro (seuls les points d'entrée ont été lus).
- Menus et titre (`src/ui/title`, `docs/MENUS.md`), carte 3D, écrans du cockpit F-35 (PCD) et MCDU : parcours non relus.
- Réglages sans effet : une recherche automatique des 388 clés de `Settings` n'a trouvé aucune clé sans lecteur ; méthode grossière.
- Caméra : confort, transitions, vue cabine sur F-35 et A320.
- HOTAS : profils, reprise du levier, conflits de boutons.
- Maintiens près d'un monde de Gargantua (référence au trou).
- Réseau : cohérence des fonctions entre appareils dans une salle.
- Aucune entrée n'a été ajoutée à `progress-to-destination.md` : cet audit ne livre aucune avancée, et son seul fichier autorisé est celui-ci.
