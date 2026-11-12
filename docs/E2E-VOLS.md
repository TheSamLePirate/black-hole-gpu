# Les e2e qui volent — placer, attendre, piloter, et pourquoi ils échouent

Complément de [E2E.md](E2E.md) (le labo, lancer, écrire) et de [BH-API.md](BH-API.md) (chaque membre de `__bh`) pour
tout test qui fait voler un appareil : avion (F-35, A320), vaisseau (Ranger, Lander, Endurance), au sol, en vol, en
orbite. La physique de chaque appareil est dans [VOL-AVIONS.md](VOL-AVIONS.md) et [VOL-VAISSEAUX.md](VOL-VAISSEAUX.md).

Ce document vient d'une analyse de l'historique du projet (6 novembre 2026) : **4 034 lancements d'e2e** relevés dans
330 transcriptions de sessions Claude (26 sept. → 6 nov.), leurs résultats et ce qui a été corrigé ensuite ; les
1 084 messages de Sam ; la mémoire des sessions ; la lecture du harnais (`tests/e2e/lib/`) et des 396 fichiers e2e.
Les chiffres sont ceux de cette analyse, avec ses limites (§1.4).

*Rédigé le 6 novembre 2026, code à `6d11d6b5`. Le code fait foi : un écart constaté se corrige ici.*

---

## 0. En bref — les douze règles

1. **Lancer avec `bun run e2e <nom>`** (le préchargement enregistre télémétrie et rapports), jamais `E2E=1 bun test`
   seul pour un vrai essai. **Garder toute la sortie dans un fichier** et y chercher `(fail)` et le résumé ; jamais
   `| tail` : 677 lancements sont restés sans verdict à cause d'un `tail`/`grep`.
2. **Ce Mac : fenêtre visible** (`~/.kerr-lab/config.json` `{"chrome": "window"}`, Sam, 4 nov.) ; **kerr-mini : plein
   écran**. Tests courts (1–2 min), répartis sur les deux machines ; continuer à travailler pendant qu'ils tournent.
3. **Changer d'appareil d'abord, attendre `__bh.fleet.active`, placer ensuite.** Le premier passage à un avion le
   pose sur une piste et écrase un placement fait trop tôt.
4. **Un placement remet tout à zéro** : manette 0, autopilote et maintiens coupés, réservoirs pleins, volets rentrés,
   train décidé à la première image. Régler carburant, volets, train, poussée et autopilotes **après** le placement.
5. **`flyAt` mesure la hauteur sol une seule fois, sur le relief chargé à l'appel.** Placer, geler, attendre 3 s de
   tuiles calmes, replacer (`tests/e2e/lib/place.ts` `placeLow`).
6. **`jetToggle` bascule, il n'enclenche pas**, et il refuse tant que le jet ne vole pas en mode avion. Le garder
   sous condition (`if (c.jetModes.alt === null)`) ou utiliser `apSet({ ap: true, athr: true, alt, spd })`, après
   quelques pas. Sans autothrottle, un jet placé par `flyAt` plane manette à 0 jusqu'au sol.
7. **Un vol jugé = un seul appel `app.js`** : `freeze(true)`, pas fixes `step(1/30)`, sortie sur `ourLanded` ou
   `airFlight.failure`, plafond en pas. Le gel n'arrête ni le rendu ni le chargement ; `step` ne rend rien.
8. **Attendre une condition, jamais une durée** : `app.settled()`, `app.dataSettled()`, `app.waitProgress()`. Plafonds :
   données 30–60 s, un noyau 90 s, une première compilation à froid 180 s, et un échec qui dit ce qui manque.
9. **Hauteurs : savoir quel datum** — `geoNow().alt`, `status().altKm`, `jetModes.alt` sont au-dessus de la mer ; l'AGL
   se lit avec `__bh.sys.heightOverGround` (tableau dans [BH-API.md](BH-API.md#__bh--the-pages-automation-handle)).
10. **Vue cockpit par défaut**, puis `__bh.refresh()` et `__bh.camera.viewReset()` après chaque placement, changement
    d'appareil ou import, et quelques pas avant de photographier.
11. **Un crash met le jeu en pause** (écran « craft lost ») : il bloque les clics suivants. Le détecter, et
    `__bh.game.pause(false)` avant le vol suivant ; ou `damage: false` quand la casse n'est pas le sujet.
12. **Captures à chaque état jugé**, regardées, montrées à Sam dans T3 ; une bannière remplie (`// Duration:`,
    `// Done when:`) ; `expect(app.cdp.errors).toEqual([])`.

---

## 1. Le constat : ce que dit l'historique

### 1.1 Les chiffres

| | Valeur |
|---|---|
| Lancements d'e2e et de labo relevés | 4 034 (ce Mac 2 877 · kerr-mini 1 127 · kerr-pc 30) |
| Avec verdict | 3 114, dont **68 % réussis** (923 échecs, 83 erreurs, 4 dépassements) |
| Sans verdict | 677 (sortie coupée par `tail`/`grep`) + 99 illisibles |
| Réussite par type | local 71 % · à distance 64 % · flight lab 32 % · A/B 77 % |
| Réussite par période | 1–10 oct. 57 % · 11–20 oct. 54 % · 21–31 oct. 69 % · 1–6 nov. 83 % |
| **Échec par domaine** | **vol / autopilote / atterrissage 56 %** (312/553) · interface, HUD, son, réseau, TARS 51 % · autres 25 % · rendu et décor 18 % |
| Durée d'un e2e local (selon bun) | médiane 43 s, 90ᵉ centile 5,9 min |
| Lancement détaché sur le mini (mur) | médiane 4,6 min, 90ᵉ centile 19 min |
| Temps cumulé (lancements parallèles comptés chacun) | ≈ 210 h, dont 72 h où l'agent attendait, 55 h dans des lancements ratés, 24 h sans verdict |
| Lancements de plus de 10 min | 228 (95 h ; 77 ratés) |
| Relances du même fichier dans la même session | 73 % des lancements |

L'impression de Sam se vérifie : **les tests qui volent échouent trois fois plus que ceux du rendu.** 40 % des échecs
ont une cause « de vol » (train, crash, autopilote, poussée, temps, position).

### 1.2 Les causes d'échec, classées

Sur 1 010 échecs classés par mots-clés (classement juste à environ 65–70 % sur un contrôle manuel de 45 cas : ordre de
grandeur, pas mesure exacte) :

| Cause | Échecs | Exemple réel |
|---|---|---|
| crash, atterrissage | 127 | `Received: "Ranger: the gear collapsed on Earth at 9 m/s"` |
| réseau multijoueur, TARS | 109 | |
| autopilote, guidage | 101 | `waitFor(__bh.camera.pilot.auto === "circularize"): 10000 ms` |
| exception JS (test ou page) | 96 | `ReferenceError: n is not defined` |
| image, pixels, perf | 91 | |
| bouton non cliquable sous un calque | 81 | `[data-testid=topbar-settings] is not clickable: … div#loading.intro` |
| train, contact sol | 72 | `the gear collapsed on Mars at 163 m/s` |
| position, altitude | 62 | `the tripod … held on its ground — Expected < 1 / Received 1410548` |
| page jamais chargée, compilation | 54 | `waitFor(… firstFrameDoneAt > 0 …): 180000 ms, last false` |
| assertion sans libellé | 49 | |
| tuiles, streaming | 32 | `the orthophotos not all in within 90 s: {"pending":246,…}` |
| temps (gel, pause, accélération) | 25 | `the rain … silent paused` (un crash avait mis en pause) |
| budget de taille des shaders | 21 | `shadeLite: 8055 inlined lines, over its budget of 8030` |
| Chrome / DevTools | 18 | `Chrome's DevTools connection closed` |
| poussée | 15 | |
| dérive des vols de référence | 11 | `entry-glide-edwards.alt: 5.50348 vs 5.50505 (≤ 5.5e-9)` |
| IGN 429 | 5 | |

### 1.3 Ce que les échecs étaient vraiment

- **De vrais défauts du jeu trouvés par les tests** (campagne d'autopilotes du 7 oct.,
  [CAMPAGNE-AUTOPILOTES-2026-10-07.md](CAMPAGNE-AUTOPILOTES-2026-10-07.md)) : entrées Ranger 0/4 → 4/4, planés vers la
  piste 2/7 → 7/7, Lander 0/4 → 4/4, rendez-vous ISS réparé. Les corrections du code dominent pour le train (27 des 60
  épisodes) et les crashs (36/92).
- **Des défauts du test** : dans ~40 % des épisodes, seul le test a été modifié avant la relance. Exemples : des
  degrés pris pour des radians (`geoNow()` rend des degrés), un tiret long dans « Paris – Le Bourget » comparé à un
  tiret court, un texte anglais attendu sur une page en français, `airInfo().agl` (n'existe pas), `c.last?.alt`
  (n'existe pas, 9 fichiers), une regex doublement échappée.
- **De l'instable ou de l'environnement** : 31 % des relances sans aucune modification ont réussi. Chromes orphelins et
  chaleur (2 nov.), GPU partagé avec d'autres applications (3 i/s), mini sans internet, IGN 429.
- **Les causes réglées par le seul test** : exception JS (44/75), position (27/49), non cliquable (32/63), son (11/13),
  temps (14/22). **Par simple relance** : tuiles (12/30), chargement et compilation (10/36) — l'environnement.

### 1.4 Limites de cette analyse

Durées murales prises sur les horodatages des transcriptions (attente de permissions comprises) ; heures additionnées
sur des lancements parallèles ; suivis des tâches détachées du mini rapprochés dans la même session seulement ;
modifications faites par des sous-agents ou par Sam comptées comme « simple relance » ; classement des causes par
mots-clés.

---

## 2. Lancer

```bash
bun run e2e landing                       # ici (fenêtre visible), un fichier ; sortie au terminal
bun run e2e landing > remote-results/landing.log 2>&1; grep -nE "\(fail\)|^ *[0-9]+ (pass|fail)|error:" remote-results/landing.log
bun run e2e --each gear landing runway-wind   # un bun test par fichier, tableau final + JSON
bun run e2e --remote --detach --each --name vols gear landing   # sur kerr-mini, plein écran
bun scripts/lab-monitor.ts                # avant : qui tient le Chrome, la chaleur, les orphelins
```

- `E2E=1 bun test …` (1 688 lancements de l'historique) saute le préchargement : **aucune télémétrie, aucun rapport**,
  seulement l'état « live ». À réserver aux sondes.
- Les variables d'un test (`DEMOS=…`) ne passent pas avec `--remote` : les écrire dans la commande de
  `remote.ts run -- E2E=1 DEMOS=… bun test …` ([E2E.md](E2E.md) §3).
- Un fichier qui touche l'IGN à la fois, sur les deux Macs réunis (même IP publique : 429).
- Après une modification de shader : `bun scripts/check-wgsl.ts` avant l'e2e (les tests de budget ne compilent pas).
- Après une modification du test : vérification de types (`bun run typecheck`, ou `bun run check` qui y ajoute Biome et les shaders) avant de lancer.
- Tâche de fond : un titre avec la durée estimée ; jamais d'attente silencieuse de plusieurs minutes.
- Après un échec : relire le message entier, relancer **ce test seul** (`-t "<titre>"`) — l'état fuit d'un test à
  l'autre dans un même fichier —, puis sur l'autre Mac ; classer jeu / test / harnais / environnement.

---

## 3. Le temps

### 3.1 Les commandes

| Appel | Ce qui s'arrête ou avance | Ce qui continue |
|---|---|---|
| `__bh.freeze(true)` | le `sim.step` de la boucle : appareil, autopilotes, mission, personnage, horloges, bande du replay ; le son vivant coupé | le rendu, le streaming des tuiles, les compilations, le réseau, le trafic, la météo |
| `__bh.step(dt)` | une fois l'horloge des images et `sim.step(dt)` ; demande une image (ne la dessine pas) | — **page non gelée : la boucle avance aussi, le vol est intégré deux fois** |
| `__bh.game.pause(on)` | `settings.animate = !on` : le temps de la scène s'arrête, `flyShip` rend la main aussitôt (pas d'autopilote, pas de changement d'appareil) ; `step` n'avance plus l'horloge | le rendu, les compilations, la caméra |
| `__bh.game.warp(x)` | `timeSpeed`, et `animate = true` (**dépause**) ; en air dense, plafonné à ×4 à chaque pas ; les autopilotes ont leurs plafonds | |
| `__bh.setTime(t)` | l'horloge brute [M] ; l'appareil **n'est pas** emporté | |
| `__bh.game.setDate(iso)` / `jumpTo(t)` | l'horloge, l'appareil emporté avec le monde (scènes du système de Gargantua, en vol) ; **le plan de vol est abandonné** | |
| `__bh.setDate(ms)` | le « maintenant » du calendrier (ISS, flotte, placement du Système solaire) | l'horloge de la scène |

La boucle borne son `dt` à 0,1 s : sous 10 i/s le vol avance plus lentement que l'horloge murale. Les sous-pas sont
plafonnés (400 × dt·60, de 1 à 6) ; le pas d'intégration est de 4 ms sur le train, adaptatif en l'air et dans le vide.

### 3.2 Un vol déterministe : un seul appel

```ts
const r = await app.js<{ landed: boolean; fail: string | null; log: string[] }>(`(() => {
  __bh.freeze(true); __bh.settings.wind = 0; __bh.game.glideTo("Edwards");
  const c = __bh.camera;
  for (let i = 0; i < 30 * 170; i++) {           // plafond : 170 s simulées
    __bh.step(1 / 30);
    if (c.ourLanded || c.airFlight.failure) break;
  }
  __bh.freeze(false);
  return { landed: !!c.ourLanded, fail: c.airFlight.failure,
    log: __bh.game.log.events.filter((e) => e.kind === "pilot").map((e) => e.text) };
})()`);
```

(`tests/e2e/landing.e2e.test.ts`.) La boucle de la page tourne entre deux appels `app.js` : un vol découpé en plusieurs
appels n'est plus reproductible. Les vols de référence (`golden`) se comparent ainsi à 1e-9 près. Un atterrissage
complet à Edwards prend ≈ 6 s de mur.

À savoir :
- `step` ne rend pas, et **les tuiles sont demandées par les images rendues, pas par les pas** : un vol pas à pas
  dans un seul appel ne charge aucune tuile nouvelle. Pour un vol jugé, bloquer les tuiles (`tiles: false`) ou les
  avoir toutes avant ; un sol qui change sous l'autopilote change le vol (13 m après 30 s, `rates.e2e.test.ts`).
- Le planificateur tourne dans un worker : son plan arrive entre deux images, pas dans un appel (attendre l'état
  « planifié » avant de juger, `landing.e2e.test.ts` partie désorbitage).
- Juger un contrôleur sur plusieurs graines : `__bh.setTime(t0 + k * 0.37)`.

### 3.3 Quand il faut des images

- Annonces, HUD lu dans le DOM, manette lue une fois par image : par petits paquets de pas avec une image entre
  (`callouts.e2e.test.ts`), ou `requestAnimationFrame` dans un appel `async` (`motion-quality.e2e.test.ts`).
- Filmer image par image : après chaque pas, attendre que `__bh.renderer.completedFrames` ait avancé de ~3, exposition
  tenue (`autoExposureEV`).
- Vol en temps réel par les autopilotes du jeu (une leçon, une mission) : le chien de garde de
  `school-demos.e2e.test.ts` ([E2E.md](E2E.md) §4) — un état lu toutes les 2 s, échec sur une cause (45 s sans
  progrès), état et capture écrits.
- Sam (10 oct.) : les vols destinés à être regardés vont **à vitesse normale**. Pas fixes et tuiles bloquées ont fait
  rendre au flight lab une image toutes les 5 s de vol (5 nov.).

### 3.4 Pièges du temps

- **Geler moteur coupé puis reprendre** : un jet qui tombe (25 oct.).
- **Un saut dans le même tick qu'un dégel ou qu'une date posée** a perdu l'appareil (1 140 K, 293 g : placé avec
  l'horloge d'avant). Laisser passer une image entre la date et le saut (`ortho.e2e.test.ts`).
- **`__bh.setDate` seul** a laissé une partie en 2067 : pour déplacer la scène, `__bh.game.setDate`.
- **`game.setDate` abandonne le plan de vol** : poser la date avant de planifier.
- **Une vue réglée pendant le gel n'est pas appliquée** : quelques pas (ou un dégel bref) avant la capture.
- **Une vue raster gelée ne s'affine jamais** (`lastPhase` reste `realtime` près de la Terre) : pour une image
  convergée, le mode Photo et `lastPhase === "converged"`.
- **L'horloge avance avec le vaisseau** : `sim.step` suit `camera.shipClock()` quand un appareil est piloté.
- **Le harnais force le jour** (`tests/e2e/lib/app.ts`, `DAYLIGHT`) : dans un e2e, `__bh.game.flyAt` et `walk` sur la
  Terre **changent d'abord la date** (fin de matinée solaire locale) s'il y fait nuit ou si le soleil est bas
  (hors 8 h 30–16 h), sauf si le test a posé une date (`game.setDate` ou `__bh.setDate`), dans une salle réseau, ou
  avec `window.__e2eKeepTime`. La scène de l'ISS est mise à un « maintenant » ensoleillé. `orbit`, `land`, `glideTo`
  ne sont pas concernés. `E2E_DAYLIGHT=0` coupe tout cela. Un test de nuit pose sa date ; Sam (21 oct.) : de jour, sauf
  si la nuit est le sujet. Conséquence : un `flyAt` de test peut faire sauter l'horloge (et abandonner un plan).

---

## 4. Attendre

### 4.1 L'échelle de disponibilité

| Étape | Condition | Fournie par |
|---|---|---|
| Page partie, première image | `__bh.renderer.firstFrameDoneAt > 0` et l'écran de chargement levé | `App.boot` / `App.load` (puis `settled(120 s)`) |
| Un appareil piloté | `__bh.camera.piloting` | à ajouter (30–120 s) |
| Le bon appareil | `__bh.fleet.active === "f35"` après `__bh.settings.vessel = "f35"` | à ajouter (30 s) |
| Le sol sous la physique (Ranger à Edwards) | `__bh.relief("earth", 34.905, -117.884) > 100` | à ajouter (60 s) |
| Le noyau de la scène | `__bh.renderer.tracerSettled`, puis `compilesPending === 0` et `compilingNow` vide | `app.settled()` (aussi avant chaque `app.shot()`) |
| Les données du lieu | noyaux + reliefs + orthophotos + décor + cartes fines | `app.dataSettled("…")` |
| Le relief fin, en vol bas | `earthTiles.pending === 0 && earthTiles.finest >= 12`, **tenu 3 s** | `placeLow` |
| L'exposition | `settleExposure()` puis `exposureGap < 0.02` | `app.exposureSettled()` |
| Le cockpit, le pont, l'A320 | `renderer.ship.cabinShown`, `ship.deckMats`, `!!camera.a320Sys`, `a320Maps.albedo.depthOrArrayLayers === 7` | à ajouter |

`app.waitProgress(cond, label, o)` attend tant que quelque chose avance (tuiles, compilations, décor) : échec après
90 s sans progrès (300 s pendant une compilation), 15 min au plus, ce qui manque écrit toutes les 10 s. C'est la forme
à préférer pour toute attente de données.

### 4.2 Pièges des attentes

- **`earthTiles.pending` vaut 0 juste après un saut**, avant que les tuiles soient demandées : exiger 3 s de calme.
- **`variantReady` est vrai au démarrage**, avant toute compilation (la clé vaut alors `FEATURES_ALL`) : attendre
  `tracerSettled`.
- **`earthSettled` ne compte pas les orthophotos** : `dataSettled` les compte.
- **`compilingNow` est traduit** : tester sa longueur, pas son texte. Les 8 fichiers `a320-*` attendent encore le
  texte « Compiling the ray tracer » 240 s, erreur avalée : à remplacer par `app.settled()`.
- **Bouger la vue peut relancer une compilation** (bits de vue de la clé : raster, corps, pistes, météo, éclipses,
  surface, décor, aurores). Après un changement de réglage qui touche le noyau : `app.settled()` (ou
  `kernelsSettled` pour une mesure).
- **Deux pages sur un GPU** (tests `net-*`) : attendre `tracerSettled` sur les deux avant de mesurer quoi que ce soit.
- **Une page ouverte sans `#scene=`** reste sur l'écran titre, qui tient le jeu et ses compilations de fond.
- Une vue convergée et immobile ne soumet plus d'image : `__bh.touch()` avant d'attendre des images.
- `__bh.skyLoading` se résout même si le ciel a échoué.
- Plafonds (Sam, 2 nov.) : données 30–60 s, un noyau 90 s, première compilation à froid 180 s, Jupiter de près ≈ 200 s,
  la Terre sur kerr-pc ≈ 2 min. Jamais 240 s puis 600 s de rien. Jamais `.catch(() => {})` sur une attente (94 cas
  dans les tests actuels) : l'erreur doit dire ce qui manque.
- **Jamais de `Bun.sleep` comme synchronisation** (240 fichiers en ont, 74 de 5 s ou plus) : ce qui marche ici casse
  sur le mini.

---

## 5. Placer un appareil

### 5.1 Ce que fait tout placement

Tous les outils (`flyAt`, `glideTo`, `lineUp`, `land`, `hoverOver`, `orbit`, `near`, `wormhole`, `atStand`, `parkAt`)
passent par `placeAt` ([BH-API.md](BH-API.md), section `__bh.game`) :

- de notre côté, une scène avec le trou de ver est obligatoire (`game:artemis`, `game:interstellar`) ;
- **manette 0, maintien et autopilote coupés, plan effacé** (`setPilot`) ;
- **réservoirs pleins, volets rentrés, modèle d'air et météo remis, crash effacé**, train décidé à la première image
  (sorti au sol, rentré en l'air) sauf `camera.gearInit = true` (`newFlight`) ;
- **ne touche pas** : `freeze`, `settings.animate` (une partie en pause le reste), `timeSpeed`, `shipMount`, `vessel`.

Ensuite : `near`, `hoverOver`, `wormhole` enclenchent le vol stationnaire, `glideTo` l'autopilote d'entrée, `flyAt`
rentre le train.

### 5.2 Changer d'appareil

```ts
await app.js(`(() => { __bh.settings.vessel = "f35"; __bh.settings.flightMode = "plane"; __bh.settings.wind = 0; return 1; })()`);
await app.waitFor(`__bh.fleet.active === "f35"`, 30_000);
```

Le changement se fait **au pas de vol suivant, temps en marche** : page gelée, faire 5 pas (`step(1/30)`) après
l'écriture. Un avion choisi pour la première fois est aligné sur la piste la plus proche (Edwards à défaut), manette
0 ; s'il arrive après votre `flyAt`, l'avion se retrouve au Bourget (6 nov.). Refusé, le réglage revient et la raison
part dans `camera.onPilotMessage`. La scène `game:artemis` démarre avec le **Ranger** : un test a piloté le Ranger par
erreur, s'est écrasé, la scène est revenue en orbite et le test a attendu sans fin (23 oct.).

### 5.3 Un jet en croisière, piloté par ses maintiens

```ts
// F-35 en vol, gelé, holds et autothrottle — f35-challenges.e2e.test.ts
await app.js(`(() => {
  __bh.freeze(true); __bh.game.setDate("2067-06-21T17:30"); __bh.settings.vessel = "f35";
  for (let i = 0; i < 5; i++) __bh.step(1 / 30);          // le changement d'appareil appliqué
  __bh.game.flyAt(34.95, -117.80, 3000, 90, 180);
  for (let i = 0; i < 10; i++) __bh.step(1 / 30);         // en l'air, en mode avion : les maintiens acceptés
  const c = __bh.camera;
  c.apSet({ ap: true, athr: true, alt: Math.round(c.geoNow().alt), spd: 180 });   // alt au-dessus de la mer
  return c.jetModes; })()`);
```

- `apSet` peut être rappelé sans risque ; `jetToggle("ap")` **bascule** (un second appel coupe tout : « broke under
  293 g », 23 oct.). Forme gardée : `if (c.jetModes.alt === null) c.jetToggle("ap"); if (c.jetModes.spd === null) c.jetToggle("athr");`
  — **les bascules d'abord, les consignes après** (consignes posées avant : l'autopilote était coupé).
- Vérifier ce qui est réellement appliqué : `c.pilot.engineNow` (la poussée), pas `c.pilot.throttle` (le levier).
  Écrire `pilot.throttle` pendant que l'autothrottle tient le désenclenche.
- `jetModes.alt` [m au-dessus de la mer], `.hdg` [rad, depuis le nord vrai], `.spd` [m/s vitesse air], `.bankMax`.
- Le maintien de cap s'incline de 30° au plus ; l'autothrottle tape entre 0 et 1 en turbulence (`wind: 0` pour un test
  qui ne porte pas sur le vent).

### 5.4 Un jet bas au-dessus du vrai relief

```ts
import { placeLow } from "./lib/place";
const p = await placeLow(app, [48.815, 2.29, 900, 40, 140]);   // lat, lon, m sol, cap °, m/s
// p = { agl, pitchDeg, bankDeg, finest, reliefIn, mount } ; lève une erreur si l'avion n'est pas à plat à sa hauteur
```

`placeLow` place, gèle, attend `earthTiles.pending === 0 && finest >= 12` pendant 3 s (90 s au plus), replace, fait 3
pas pour appliquer la vue cockpit, puis vérifie inclinaison, assiette et AGL. Sans lui, un `flyAt` sur le relief
grossier a mis le F-35 dans des montagnes, des immeubles, ou à 4 581 m au lieu de 2 439 m (3–4 nov.).

Ensuite, **le protocole de vol stable de Sam** (3 nov., redemandé les 4 et 6 nov.) :
1. tout compilé et chargé (`app.dataSettled`) ;
2. autopilote tenant hauteur et cap, **autothrottle** (p. ex. 140 m/s) ;
3. **train sorti quand on vole bas** — `settings.autoGear = false; c.gearDown = true; c.gearExt = 1; c.gearInit = true`
   — sinon le GCAS ou l'autopilote reprend de la hauteur (le GCAS ne s'arme qu'avec le train rentré) ;
4. 60 images de vol rectiligne pour se stabiliser ;
5. l'état de départ écrit dans le journal du test.

Pour plusieurs cas sur le même départ : placer une fois, attendre, replacer, `__bh.game.snapshot()`, puis
`importSave(json, false)` à chaque cas (`motion-quality.e2e.test.ts`) ; `importSave` remet les modes de
l'autopilote : les réenclencher jusqu'à ce qu'ils tiennent.

### 5.5 L'A320

```ts
await app.js(`(() => { __bh.settings.vessel = "a320"; __bh.settings.a320Start = "cold"; __bh.refresh();
  __bh.game.lineUp("Paris – Le Bourget"); __bh.settings.shipMount = "cockpit"; __bh.refresh(); return 1; })()`);
await app.waitFor("!!__bh.camera.a320Sys", 30_000);
await app.settled();
```

- Démarrages `a320Start` : `"cold"`, `"apu"`, `"ready"`. Au poste : `await __bh.game.atStand("LFPG", "C07")` (réseau
  OSM requis), puis `pushedBack()` ou le tracteur (touche Fin).
- En l'air (`a320-effects`) : `flyAt(48.90, 2.44, 350, 270, 66)`, train `gearDown/gearExt/gearInit`, volets
  `c.airFlight.cfg.flaps = 1` (levier / 4), `c.pilot.throttle = 0.55`.
- **Son autopilote s'enclenche ≥ 5 s après le décollage et ≥ 100 ft** : voler ≥ 6 s en direct avant
  `camera.ilsStart(icao, { runway })`, qui passe la main à son FMGC (unités : nœuds, pieds, degrés).
- En CONF FULL, les becs et volets mettent ~30 s : sinon la protection d'incidence ignore la trajectoire demandée.
- Aucun e2e ne fait voler son autopilote, son FMS ni une approche : ce sont des tests sans page
  (`tests/a320-ap.test.ts`, `tests/a320-approach.test.ts`). Un nouvel e2e d'approche A320 reprendrait la forme de
  `landing.e2e` autour de `c.a320Approach(...)`.
- Un A320 garé est reposé (`seatOnGear`) quand le relief du tarmac arrive en retard.

### 5.6 Le F-35 sur porte-avions et en STOVL

```ts
await app.js(`__bh.camera.carrierSpawn("ford")`);
await app.waitFor(`!!__bh.camera.carrierNow().length`, 10_000);
await app.js(`(() => { const r = __bh.camera.carrierFinal("ford", 3500, 90); __bh.fleet.fuel.f35 = 1800; return r; })()`);
// F-35B : deckLand("ford"), deckTakeoff() / deckTakeoff("vertical") ; F-35C (f35Variant "C", une image après) : catLaunch(0), trapLand("ford")
```

- Poser sur le pont : sonder `carrierLand(kind, { x, z }).startsWith("On")` jusqu'à ce que la carte du pont soit chargée.
- Vol stationnaire : ≤ 17,8 t, d'où `fuel.f35 = 1800` ; décollage court `6125`.
- `f35Variant` s'applique à l'image suivante : le poser avant l'autopilote de porte-avions et laisser passer une image.
- Ces tests sont en temps réel (« démonstrations » pour Sam) ; la physique est jugée par leurs jumeaux sans page
  (`tests/trap.test.ts`, `tests/quals.test.ts`).

### 5.7 Train, sol, décollage

- Train sorti tout de suite : `c.gearDown = true; c.gearExt = 1; c.gearInit = true` et `settings.autoGear = false`.
  Le train met 8 s par sens ; seul `gearExt ≥ 1` porte l'appareil ; à plat ventre (train pas sorti), patins.
- Au sol : `lineUp(nom)` ou `land(corps, lat, lon)`, puis ~90 pas ; vérifier chaque jambe par
  `__bh.sys.gears()[actif].legs` et `__bh.sys.heightOverGround` (`ground-placement.e2e.test.ts`).
- Manette 0 sur toutes les roues = freinage automatique.
- Décollage d'un jet par script : envelopper `c.pilotInput` pour tirer 0,8 au-dessus de 67 m/s, `throttle = 1`,
  `jetToggle("ab")`, attendre `!c.rolling && !c.ourLanded` (`f35-flight-ops.e2e.test.ts`). **U ne décolle pas un
  F-35** : U lance l'autopilote de décollage orbital, refusé sous un rapport poussée/poids de 1,05 (le F-35 est à ~0,59).
- A320 : `c.a320Park = false; c.pilot.throttle = 1`, attendre `geoNow().gs > 45`.

### 5.8 Atterrir et juger

```ts
const td = r.log.find((l) => l.startsWith("Touchdown"));
const sink = Number(td!.match(/· ([-\d.]+) m\/s down/)![1]);
expect(sink).toBeLessThan(2);
expect(r.log.some((l) => /Hard landing|collapsed|tipped/.test(l))).toBe(false);
```

- Verdict au toucher sur le taux de chute `c` = `settings.crashSpeed` (**4,5 m/s par défaut**) : ≤ ⅔c posé, ≤ c dur,
  au-delà écrasé (F-35C : au moins 8 m/s ; `gearForgiving` ×3).
- Lire l'approche dans `entryRun.app` (`along`, `across`), la piste par `runwayView()` (mettre `c.runwayCache = null`
  avant), le message du pilote par `onPilotMessage`, les notes `ilsLast`, `deckLast`, `trapLast`.
- **Un message de perte peut venir d'un changement de sol** (relief qui arrive : le sol a reculé de 275 m, le ressort du
  train a éjecté le jet, « hull burnt through at 92 650 K », 23 oct.) : regarder le saut d'AGL, pas seulement le texte.
- `glideTo` à 80 km (défaut) est le départ fiable ; plus court, l'appareil arrive bas en énergie et remet les gaz.
- Taux de chute de référence des tests : ≤ 1 m/s par vent calme, ≤ 1,8 m/s par vent fort.

### 5.9 Les vaisseaux

| Besoin | Forme | Fichier modèle |
|---|---|---|
| Orbite | `__bh.game.orbit("earth", { peKm: 300, apKm: 420, inc: 20, nu: 165 })` — hauteurs sur la sphère du rayon équatorial | `assist-burn` |
| Désorbitage sous accélération | `orbit(…)`, `warp(1000)`, `setAuto("entry")`, quelques pas, attendre `entryRun.phase !== "plan"` | `landing` |
| Rentrée | `glideTo("Edwards", 700, 55, 4500)` (Mach 14 à 55 km) | `assist-entry` |
| Amarrage | `__bh.setDate(Date.UTC(2026, 9, 1, 12)); __bh.game.preset("Earth: docking to the ISS")`, puis `c.pilot.auto = "none"; c.pilot.setAuto("dock")`, pas jusqu'à `c.docked` | `dock-undock` |
| Vol stationnaire, alunissage | `hoverOver("moon", 0.674, 23.473, 1.2)` puis `setAuto("land")` et pas jusqu'à `ourLanded` | flight lab `tests/flight/scenarios/vertical.ts` |
| Vols de référence exacts | preset + date fixe + `setTime(0)` + N pas | `golden` + `lib/flights.ts` |

- `setAuto`, `setHold` **basculent** : `c.pilot.auto = "none"` avant `setAuto(x)` pour être sûr d'enclencher.
- Les autopilotes s'enchaînent (circularisation → nœud ; amarrage au-delà de 3 km → rendez-vous) et un toucher les
  termine tous sauf le décollage : attendre l'état final, pas `pilot.auto`.
- CIRC se termine de lui-même de notre côté (« Circular: … ») ; près du trou il tient le cercle sans fin (le couper
  soi-même). L'amarrage refuse
  au-delà de ~3 km.
- `hoverOver` remplit les réservoirs : un appareil trop lourd ne tient plus le stationnaire.
- Le guidage doit tourner sur le temps de la simulation ; un test de mission fixe sa date.
- `requestWarp(speed)` prend un multiple ; `settings.timeSpeed` est en M/s.

---

## 6. Caméra et captures

- La vue principale des e2e est **le cockpit** (depuis le 16 oct.) ; les autres montures pour des plans précis.
  Caméra libre seule quand l'appareil ne doit pas être dans l'image (Sam, 4 nov.).
- Après chaque placement, changement d'appareil ou import :
  `__bh.settings.shipMount = "cockpit"; __bh.refresh(); __bh.camera.viewReset();`, quelques pas, puis **relire
  `settings.shipMount`** (`viewReset` peut ramener la vue extérieure). Une nouvelle monture met ~90 images à se poser.
- Pour une image nette : `dof: false`, `motionBlur: 0`, HUD masqué si besoin, `realtimeSubsampling = 1` ;
  `lookProfile: "neutral"` pour une mesure.
- `app.shot()` attend `app.settled()` ; prendre la capture **avant** l'`expect` qu'elle illustre ; écrire sous
  `remote-results/` (jamais `/tmp`).
- Mesures de couleur sur kerr-mini (écran SDR) : l'écran HDR de ce Mac passe par `hdrMap`. Le mini est à 50 Hz.
- Une fenêtre visible ici est plafonnée à 120 Hz : pour mesurer, sans tête (`bench.ts`, `trace-ab.ts` le sont).

---

## 7. Échecs fréquents : symptôme → cause → remède

| Symptôme | Cause | Remède |
|---|---|---|
| Le jet plane jusqu'au sol, manette à 0 | `flyAt` laisse la manette à 0 ; l'autothrottle n'a pas pris (refusé avant le premier pas en mode avion, ou basculé deux fois) | quelques pas après `flyAt`, puis `apSet({ ap: true, athr: true, … })` ; vérifier `jetModes.spd !== null` et `pilot.engineNow > 0` |
| L'autopilote se coupe au second appel | `jetToggle` bascule | forme gardée ou `apSet` |
| Au départ d'un vol (titre › Vol libre), le cockpit regarde le siège (`shipLookPitch` −85) | une scène chargée juste avant (le décor du titre) visait son astre une image plus tard (`main.ts` `aimAt`, asynchrone) et écrasait le regard remis devant par `setMount` | corrigé le 12 nov. 2026 : `aimAt` abandonnée dès qu'une nouvelle visée, un `setMount` ou un `placeShip` la suit (`aimGen`) ; `title-departure` vérifie le regard au lever du voile |
| La vue « cockpit » reste la poursuite sur la capture | la monture choisie alors que l'horloge est gelée depuis le placement (`flyAt` puis `freeze(true)`) n'est pas appliquée, même après trois `__bh.step` (deux essais, `scene-color`, 12 nov. 2026) | choisir la monture horloge en marche (`freeze(false)`, `shipMount`, `refresh()`, `viewReset()`, ~40 images), puis geler ; vérifier sur la capture |
| `jetToggle` sans effet | pas en mode avion (`flightModeNow() !== "plane"`), au sol, ou page en pause | `settings.flightMode = "plane"`, en l'air, quelques pas, `pause(false)` |
| L'avion cabre et monte tout seul en vol bas | GCAS ou autopilote de remontée (train rentré) | train sorti (`gearDown/gearExt/gearInit`, `autoGear = false`) |
| Avion dans une montagne, retourné, ou 2 000 m trop haut | `flyAt` sur le relief grossier | `placeLow` (placer, 3 s de tuiles calmes, replacer) |
| L'avion se retrouve au Bourget, ou sur une piste | le premier changement vers un avion fait `lineUp` après votre placement | attendre `fleet.active` avant de placer |
| Le test pilote le Ranger | `game:artemis` démarre avec le Ranger | `settings.vessel`, puis `fleet.active` |
| Rien ne bouge, `body.paused`, écran « craft lost » | un crash a mis en pause ; ou Échap a ouvert le menu pause ; ou un `.k-modal` retiré à la main | détecter `.craft-lost` / `body.paused` ; `game.pause(false)` ; fermer les écrans par leur bouton ; `damage: false` si la casse n'est pas le sujet |
| « … is not clickable: div#loading … / div.craft-lost / div.k-modal » | un calque (chargement, crash, pause) au-dessus | attendre la fin du chargement ; gérer le crash ; jamais `element.click()` |
| `waitFor(…firstFrameDoneAt…): 180000 ms` | la page n'a jamais dessiné : GPU occupé (autre page, orphelin), mini sans internet, chaleur | `lab-monitor`, `--sweep`, `thermal.ts --all` ; relancer seul |
| Tuiles « toujours en attente » / 429 | IGN partagé entre les deux Macs, ou orthophotos lentes | un test IGN à la fois ; `waitProgress` plutôt qu'un plafond fixe |
| Image noire ou fausse alors que « compilé » | `variantReady` vrai dès le départ ; pastille « Compiling » encore là | `app.settled()` (`tracerSettled` + `compilesPending` + `compilingNow`) |
| Vue A/B : un côté plus sombre | exposition tenue au chargement | `app.exposureSettled()` des deux côtés |
| A/B : B plus rapide | B a chargé moins de tuiles | consigner le nombre de tuiles par côté ; `dataSettled` des deux côtés |
| Vol non reproductible | vol découpé en plusieurs `app.js`, ou page non gelée pendant `step` | un seul appel gelé ; plusieurs graines |
| Vol de référence (`golden`) rouge à 1e-9 | une modification réelle de la physique ou du sol | expliquer, puis réenregistrer (`UPDATE=1`), jamais sans raison |
| Le test passe seul, échoue enchaîné | état laissé par le test précédent (vitesses de rotation, mode, pause) | rendre chaque test indépendant (`newFlight`, placement, `pause(false)`) ; relancer avec `-t` |
| Lecture d'altitude fausse | datum confondu (mer, ellipsoïde, sol, sphère) | tableau des hauteurs de [BH-API.md](BH-API.md) ; AGL = `sys.heightOverGround` |
| `airInfo().agl` toujours `undefined` | ce champ n'existe pas | `sys.heightOverGround` |
| `c.last?.alt` sans effet | `camera.last` n'existe pas | `c.jetFigures()?.h` |
| Élévation du Soleil toujours `null` / −99 | `sys.sunElevation`, `renderer.sunElevationDeg` n'existent pas | `camera.skyInfo().sun.altDeg` (géométrique), `.lightAltDeg` (celle qui éclaire) |
| U ne fait pas décoller le F-35 (avant le 11 nov.) | U lançait le décollage orbital | depuis : le décollage automatique sur piste ; dans un test, la vraie touche (`app.press("KeyU")`) |
| Atterrissage dur ou train cassé à vitesse faible pendant une longue attente | le sol a changé sous l'appareil (tuiles arrivées) | sol chargé avant, tuiles bloquées pour un vol jugé |
| Le stationnaire ne tient pas | `hoverOver` a rempli les réservoirs | baisser `fleet.fuel` après le placement |
| Vue extérieure lointaine sans effet, appareil gelé (`freeze(true)`) | le gel arrête aussi le pas de la caméra (rig) : `camera.outside.dist` n'est pas appliqué | appareil **posé** (`game.land`) simulation en marche, ou en vol ; vérifier la distance (référence des tuiles `earthTiles.lon`/`sinLat` contre `geoNow()`) — J2-2, 12 nov. 2026 |
| Vue « extérieur 1,5 km derrière » en vol à quelques mètres de l'appareil | la distance de la caméra extérieure derrière l'appareil n'est pas tenue en vol (4–23 m mesurés) ; devant (`yaw: 180`) elle l'est | mesurer la distance caméra–appareil dans l'e2e ; pour éloigner la caméra en vol, la mettre devant — `j2-contact-camera` |
| `sys.geodetic()` pris pour la place de la caméra | en pilotage elle rend celle de l'appareil (`homePosition`) | la référence des tuiles (`earthTiles.lon`, `.sinLat`) suit la caméra sur la Terre |
| Une vue réglée n'apparaît pas | réglée pendant le gel | quelques pas, relire la monture |
| Le comportement contredit le code | bundle périmé du serveur de dev (`E2E_URL`), ou membre `__bh` non exporté dans `automation.ts` | e2e sans `E2E_URL` (serveur de production propre) ; vérifier l'export |
| Aucune sortie, aucun verdict | sortie coupée par `tail`/`grep` | journal complet dans un fichier, puis `grep` |
| Une variable sans effet sur `--remote` | seul `E2E=1` est transmis | `remote.ts run -- E2E=1 VAR=… bun test …` |
| Erreur WGSL au chargement | shader modifié non vérifié | `bun scripts/check-wgsl.ts` avant l'e2e |

---

## 8. Écrire un nouvel e2e qui vole

1. **En-tête** : ce qu'il prouve, puis `// Duration: ~N s ici.` et `// Done when: …` en début de ligne (la bannière et
   le catalogue) ; une ligne dans [E2E-CATALOGUE.md](E2E-CATALOGUE.md).
2. `App.boot({ hash: "scene=game:artemis", tiles: false })` si les données du sol ne sont pas le sujet ;
   `tiles: true` si l'image doit montrer le vrai sol (Sam : images chargées pour tout test visuel).
3. `waitFor("__bh.camera.piloting")` ; changer d'appareil et attendre `fleet.active`.
4. Placer ; avec `tiles: true`, `placeLow` ou `flyAt` → gel → `dataSettled` → `flyAt` à nouveau.
5. Après le placement : carburant, volets, train, autopilotes (formes gardées ou `apSet`), vue cockpit + `refresh()` +
   `viewReset()`, quelques pas.
6. Verdict physique : **un appel**, gelé, pas fixes, plafond en pas, sortie sur succès ou `airFlight.failure`, objet
   simple rendu ; assertions côté Bun.
7. Besoin d'images : paquets de pas avec une image entre ; temps réel : chien de garde.
8. Captures aux états jugés, avant les `expect` ; sous `remote-results/<fichier>/`.
9. Entrées réelles pour tout geste du joueur (`app.press`, `app.click`, `app.mouse`) ; jamais Échap pour fermer.
10. Attentes plafonnées qui disent ce qui manque ; aucun `.catch(() => {})`, aucun `Bun.sleep`.
11. `expect(app.cdp.errors).toEqual([])` ; `afterAll` : `app?.close(); stopServer();`.
12. Le faire échouer sans le correctif qu'il protège (un test de régression a déjà passé dans les deux cas).

### Fichiers modèles

| Besoin | Copier | Durée médiane |
|---|---|---|
| Atterrissage, approche (déterministe) | `landing.e2e.test.ts`, `runway-wind` | 33–41 s |
| Train | `gear.e2e.test.ts` | 21–33 s |
| Jet sur ses maintiens, pas à pas | `f35-challenges`, `f35-nav` | — |
| Jet bas sur le vrai relief | `paris-night-flight`, `motion-quality`, `lib/place.ts` | ~3–4 min |
| Au sol, sur la piste | `runway-placement`, `ground-placement` | 15 s |
| Vol à la main, clics cockpit | `cockpit-flight` | 23 s |
| Manette réelle | `hotas-flight` | 21–29 s |
| Vaisseaux, vols de référence | `golden` + `lib/flights.ts`, `rates` | 11–35 s |
| Amarrage | `dock-undock` | 14–16 s |
| Vol long en temps réel | `school-demos` (chien de garde) | selon la démo |
| Annonces lues sur les images | `callouts` | 29–38 s |

À ne pas copier comme modèles : `a320-*` (attente texte 240 s), `jetmodes`, `gcas`, `deckland`, `trap`, `ils`,
`f35-flight-ops`, `assist-dock` — des démonstrations en temps réel pleines de `Bun.sleep` et d'attentes de 150–420 s,
chacune doublée d'un test sans page qui juge la physique.

---

## 9. Défauts connus dans les tests actuels (relevés le 6 nov.)

- ~~`c.jetModes.alt = c.last?.alt ?? …`, `airInfo().agl` (`cockpit-flight`), `__bh.sys.sunElevation?.()`
  (`coast-survey`)~~ — corrigés le 11 nov. : `c.jetFigures()?.h`, `sys.heightOverGround`, `camera.skyInfo().sun.altDeg`
  (aussi `renderer.sunElevationDeg`, absent, dans `earth-horizons` et `sky-open`) ; `cockpit-flight` revolé (23 s au lieu
  du plafond de 200 s), `runway-mesh` (altitude tenue à 5 m près).
- 8 fichiers `a320-*` : attente du texte « Compiling the ray tracer » 240 s, erreur avalée.
- 94 attentes suivies de `.catch(() => {})` ; 275 attentes de 120 s ou plus ; 74 `Bun.sleep` de 5 s ou plus.
- Entrées synthétiques depuis la page : `KeyboardEvent` (`gear`, `cockpit`), `.click()` (≈ 7 fichiers), Échap pour
  fermer un panneau (`f35-nav`).
- 273 fichiers sur 394 n'affirment pas `cdp.errors` ; presque aucun test de vol n'a ses lignes `Duration:` / `Done when:`.
- `f35-challenges`, `f35-nav` écrivent leurs captures dans `/tmp` par défaut.
- Aucun e2e ne fait voler l'autopilote ou l'approche de l'A320, ni un alunissage pas à pas, ni le STOVL de façon
  déterministe.
