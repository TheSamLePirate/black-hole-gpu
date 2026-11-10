# Audit 2026-11-10 — 03. Architecture, boucle de frame et qualité du code

État lu : `main` au commit `29d4e5e3` (8 novembre 2026), copie de travail avec modifications en cours d'autres sessions.
Méthode : lecture du code, `grep`, trois scripts statiques jetables (graphe d'imports, cohérence réglages/schéma/i18n),
`bunx tsc --noEmit` et `bunx biome lint .` lancés une fois. Aucun serveur, e2e, bench ni `bun test`.
Aucun chiffre de performance n'est mesuré ici : les constats de coût sont « lus dans le code ».

Niveaux de preuve : **lu** = lu dans le code ; **mesuré** = sortie d'outil citée ; **supposé** = déduction à confirmer.

Gravités : P0 = contrat à résoudre avant de généraliser le nouveau renderer (pas un crash reproduit) ; P1 = défaut réel
qui touche le joueur ou bloque la destination ; P2 = dette qui coûte à chaque évolution ; P3 = hygiène.

---

## 1. Boucle de frame

### AR-01 — P0 — Le sol de contact appartient au renderer et suit la caméra, le tier et le chargement
- **Où** : `src/renderer.ts:1945-1948` (installation), `src/renderer.ts:3768-3772` (tier des cartes),
  `src/renderer.ts:4031-4034` (focus des tuiles), `src/system/earth-tiles.ts:2431-2470` (`heightAt`),
  `src/system/earth-tiles.ts:1282-1285` (`setValid` → `stamp++`), `src/main.ts:8598-8602`, `src/controller/motion.ts:1005-1013`,
  `src/quality-policy.ts:46-62`, `src/system/our-surface.ts:157-161`.
- **Constat** : le sol sous l'appareil est `setGroundRelief("earth", earthHeightSampler(map, …, earthTiles.heightAt, runwayGrade))`,
  posé par le renderer quand ses cartes GPU arrivent. Avant cela, il n'y a pas de relief terrestre (`reliefs` vide).
  `heightAt` mélange les niveaux de tuiles **résidents**, pondérés par la distance aux bords des fenêtres ; ces fenêtres sont
  centrées sur `focus = onEarth ? eye : shipLow ? F.c : null` : la **caméra** gagne dès qu'elle est sur Terre, l'appareil
  n'est suivi que si la caméra a quitté la Terre et qu'il est sous 60 km. La portée (`detailReach`), `earthIgnRelief`,
  `earthIgnSilhouettes`, `earthTerrain` et le tier matériel (`earthMapQuality` : carte « med » sur tier ≤ 1) changent donc
  la hauteur de contact. Chaque changement de fenêtre valide incrémente `stamp` ; `main.ts` appelle alors
  `camera.groundChanged()` qui fait `fall(0, …)` : l'appareil posé est **recalé d'un coup** sur le nouveau sol.
  Les tuiles ne sont mises à jour que dans `renderer.frame` : pas d'image (cadence plafonnée, perte GPU), pas de mise à jour du sol.
- **Impact** : l'avion posé saute quand une tuile fine arrive ou quand la fenêtre glisse ; un spectateur éloigné sur Terre
  fait retomber le sol de l'appareil sur un niveau grossier ; deux machines d'une même salle n'ont pas le même sol ;
  un atterrissage n'est pas jugé sur la même piste selon le profil graphique. Un appareil qui roule (pas `ourLanded`) n'est
  pas recalé : son train voit une marche de hauteur (**supposé**, non reproduit).
- **Piste** : un `WorldSurface` côté monde (§19.4) : cache CPU des hauteurs indépendant des textures GPU, noyau de contact
  épinglé autour de l'appareil et du marcheur quelle que soit la caméra, révision portée par l'objet posé (changement = transaction),
  réponse « pas encore prêt » distincte de « mer à 0 ». Le renderer devient lecteur. Premier lot utile : un second foyer de
  tuiles « contact » permanent autour de l'appareil, et la résolution de contact fixée hors réglages graphiques.
- **Preuve** : lu. Le commentaire `quality-policy.ts:49-52` assume le choix (« deliberately »).

### AR-02 — P0 — Aucune politique de temps pour l'onglet masqué, la perte GPU et les trous de frame
- **Où** : `src/main.ts:8401` (`dt = min(0.1, …)`), `src/main.ts:8449` (condition de `sim.step`), `src/main.ts:570-631`
  (`recoverGpu`), `src/main.ts:7946` (seul `pagehide`), absence de `visibilitychange` dans `main.ts` (grep).
- **Constat** : pas variable, borné à 0,1 s. Sous 10 images/s la simulation ralentit sans le dire ; après un onglet masqué,
  tout le temps mural est perdu sans état « reprise ». La condition de `sim.step` est
  `!frozen && !paused && !renderer.offlineActive && !replay.active` : `recovering` n'y figure pas, le vol continue pendant
  la recréation du device, sans image. Aucun traitement de visibilité dans la boucle principale ; les 5 `setInterval` de
  `main.ts` (l. 1102, 1138, 1164, 1237, 7850) continuent en arrière-plan.
- **Impact** : atterrissage possible sans image pendant une reprise GPU ; en salle, l'écart avec l'horloge commune après
  un retour d'onglet n'a pas de chemin explicite (**non vérifié** côté `net/`).
- **Piste** : un état de session unique (jouable / pause / masquée / reconstruction GPU / resynchronisation) qui décide qui
  avance ; `sim.step` conditionné par cet état ; `visibilitychange` traité à un seul endroit.
- **Preuve** : lu. Concorde avec §19.2/§19.8 de l'analyse stratégique, revérifié dans le code du 8 novembre.

### AR-03 — P1 — La frame n'isole pas ses sous-systèmes : une exception avant le rendu fige l'image
- **Où** : `src/main.ts:8394-9700` (`loop`), rendu à `8686`, seul `try` de la boucle à `9070-9075` (`rangerStatus`).
- **Constat** : `requestAnimationFrame(loop)` est appelé en tête, donc la boucle survit, mais environ 60 appels
  (vol, réseau, trafic, HUD à pied, replay, orage…) s'exécutent avant `renderer.frame` sans garde. Une exception
  déterministe dans l'un d'eux se relance à chaque image : plus de rendu, plus de HUD, plus de son, plus d'autosauvegarde
  (tout ce qui suit dans la fonction). Le joueur voit une image figée et un toast « the flight goes on ».
- **Impact** : un bug local devient une panne totale. Précédent réel : le `TypeError` de `heightAt` signalé par Sam le
  4 novembre (`src/system/earth-tiles.ts:2457-2459`, commentaire).
- **Piste** : découper la frame en étapes nommées (entrées → simulation → vue → rendu → présentation UI → tâches lentes),
  chacune dans une garde qui enregistre, désactive l'étape fautive après N échecs et laisse le rendu se faire.
- **Preuve** : lu. Le comportement de limitation de `globalErrorRouter` n'a pas été lu (voir « Non vérifié »).

### AR-04 — P1 — Instruments, cockpit et HUD sont dessinés après la soumission du monde
- **Où** : `src/main.ts:8686` (`renderer.frame`), puis `9104-9124` (écrans cockpit), `9186-9321` (pose et DU A320),
  `9349-9385` (PCD F-35), `9402-9409` (HUD de vol).
- **Constat** : les textures d'instruments et les poses de gouvernes (`renderer.jetPose`, `a320Pose`, `cockpitControls`)
  sont calculées après l'encodage de l'image : elles servent l'image suivante. Le HUD DOM/canvas, lui, est à jour :
  monde et symbologie ont une image d'écart.
- **Impact** : âge d'instrument non borné par contrat (+1 image au mieux, plus avec les périodes 66/100 ms) ; gouvernes en retard d'une image.
- **Piste** : ordre §19.5 : simulation → figer les données de vol → instruments critiques → vue finale → encodage → tâches lentes.
- **Preuve** : lu (ordre des appels).

### AR-05 — P1 — Travail synchrone dans la frame qui peut saccader
Lu dans le code, aucun coût mesuré ici (le profileur `cpuProf` existe : à mesurer avec lui).
- **Autosauvegarde** `src/main.ts:9039-9047` → `src/game/tools.ts:920-981,1091` : toutes les 10 s (défaut,
  `src/settings.ts:929`) et 2 s après tout changement de réglage : `status()`, trois `structuredClone` (flotte, route, vue),
  `JSON.stringify`, `localStorage.setItem` synchrone, sur le thread principal en plein vol.
- **Lectures de layout** : `canvas.getBoundingClientRect()` à `src/main.ts:9325` et `9336` après des écritures de style
  (A320) ; `topBar.fit()` à chaque image (`9052`).
- **Allocations par image** : tri d'un tableau copié (`8410`), `viewOverlay.trafficMarks` reconstruit avec trois
  `unitsFor(settings)` (`8540-8546`), `netSession.tags.map` (`8547`), `r.combatOthers = [...]` (`src/sim.ts`, `applyRender`),
  échantillon de replay avec `Object.fromEntries` et copies (`8633-8662`), `Math.min(...pcdPending.map())` ×4 (`9371-9374`).
- **Prédiction de trajectoire** à chaque image : `sim.applyRender` → `c.predictPath()` (`src/sim.ts:89`).
- **Sondes de diagnostic dans la boucle de production** : `jitterProbe`, `camProbe` (`8730-8809`, 80 lignes).
- **Impact** : pics de temps CPU et pression GC hors du budget de passe GPU ; invisibles dans un compteur « fps » (AR-06).
- **Piste** : autosauvegarde hors frame (`requestIdleCallback`, IndexedDB asynchrone), tableaux réutilisés, lectures de
  layout mises en cache sur `resize`, sondes branchées par un point d'extension.
- **Preuve** : lu.

### AR-06 — P2 — Le compteur de cadence est calculé sur le `dt` tronqué
- **Où** : `src/main.ts:8412-8414`.
- **Constat** : `fps = fpsN / fpsAcc`, `fpsAcc` cumulant le `dt` plafonné à 0,1 s. Un trou de 400 ms compte pour 100 ms.
- **Impact** : la cadence affichée et lue par les e2e est optimiste précisément quand ça saccade.
- **Piste** : horodatages muraux non tronqués ; publier séparément rAF, soumissions, complétions GPU.
- **Preuve** : lu (déjà noté §19.3 ; toujours vrai).

---

## 2. Propriété de l'état

### AR-07 — P0 — `Settings` sert à la fois de préférences, de scène, d'état simulé et de pose de vue
- **Où** : `src/settings.ts:191-611` (388 clés à plat : 219 « pref », 118 « scene », 51 « carried », mesuré par script),
  `src/controller/motion.ts:857-858` (`setHomePose(s, X, fwd, up, V)` ; `s.motion = "geodesic"`),
  `src/main.ts:8689-8696` (`renderer.frame(camera.viewSettings(), …)`), `src/main.ts:8733` (base de vue lue dans `settings.yaw/pitch/roll`).
- **Constat** : la position et la vitesse de l'appareil, la pose de la caméra, le FOV, la date de scène et les réglages
  d'affichage vivent dans le même objet mutable, modifié par la simulation, l'UI, TARS, `__bh`, les scènes et les sauvegardes.
  Le renderer reçoit cet objet comme description de la vue.
- **Impact** : pas d'instantané cohérent « état simulé au tick N » ni de « pose finale » ; interpolation de rendu, sous-pas
  fixes, replay fidèle et seconde caméra (plan capteurs) n'ont pas de point d'appui. Tout lecteur peut voir un état à moitié écrit.
- **Piste** : sans réécrire : extraire d'abord deux structures typées produites une fois par image — `SimState`
  (appareil, temps accepté, génération) et `ViewPose` (œil, base, FOV, viewport réel) — écrites par un seul propriétaire,
  `Settings` ne gardant que préférences et paramètres de scène. Le renderer prend `ViewPose`, plus `Settings` entier.
- **Preuve** : lu ; décompte mesuré par script sur `defaultSettings()` et `SETTING_KIND`.

### AR-08 — P1 — Le temps a plusieurs horloges et plusieurs copies globales
- **Où** : `src/sim.ts:66` (`this.time = camera.shipClock() ?? this.time + dt·timeRate`), `src/sim.ts:53,60,71`
  (`setSceneTime` : copie globale dans `wormhole.ts`), `src/clock.ts:19-22` (`roomPace` global), `src/frameclock.ts`
  (global), `renderer.rainClock`, `renderer.water.clock`, `tape.clock`, `sim.play`.
- **Constat** : l'horloge de scène est celle de l'appareil quand il vole (`shipTime`, en retard sur le warp demandé), sinon
  celle de `Simulation`. La migration vers `frameNow()` est partielle : 12 usages dans `src/controller` contre 41
  `performance.now()` et 5 `Date.now()` (grep), dont de la logique de vol : `motion.ts:1051` (garde de 20 s du rapport
  d'atterrissage), `computer.ts:1307`, `a320ap.ts:42`, `docking.ts:454`, `formation.ts:72`, `wingmen.ts:784`, `traffic.ts:465`.
- **Impact** : un vol pas-à-pas (`__bh.step`, vidéo, e2e) ne rejoue pas le même comportement que le direct pour ces chemins ;
  cause plausible d'e2e de vol instables (**supposé**).
- **Piste** : les quatre domaines de temps du §19.3 ; interdire `performance.now()` dans `controller/` et `game/` par une
  règle de lint, sauf mesure de coût.
- **Preuve** : lu ; décomptes mesurés par grep.

### AR-09 — P1 — Une sauvegarde est une situation, pas un point de reprise
- **Où** : `src/game/tools.ts:920-981` (`snapshot`), `983-995` (`load` → `newFlight`), `src/controller/piloting.ts:166-220`.
- **Constat** : `load` appelle `newFlight()` qui remet à zéro `airFlight`, train, volets, `fleet.fuel`, météo dynamique,
  systèmes A320 (`a320 = null`, `a320Sys = null`), rapport, autopilotes d'amarrage. Le snapshot ne les contient pas.
- **Impact** : reprise après perte GPU, undo TARS et retour de rendu vidéo ne restituent ni pannes, ni configuration, ni
  carburant par réservoir. Le message « Your flight was saved » promet plus que ce qui est restauré.
- **Piste** : inventorier par appareil ; ajouter à `GameSave` v3 un bloc `systems` optionnel sérialisé par chaque module
  (`airFlight`, train, A320) avec sa propre version ; distinguer checkpoint mémoire (complet) et sauvegarde persistante.
- **Preuve** : lu (confirme §19.9).

---

## 3. WGS84 / géoïde

Bilan : la règle est **largement respectée**. `EARTH_RM = WGS84_A` (`src/terrain.ts:443`), les altitudes passent par
`heightOverGround` / `cartToGeodetic`, le géoïde est ajouté dans `earthHeightSampler` (`src/terrain.ts:649`).
Les `6371e3` restants sont des distances de grand cercle, la réfraction ou l'horizon radar 4/3 (admis).

### AR-10 — P3 — Trois altitudes prises comme |p| − rayon
- `src/controller/netcraft.ts:397` : `h` envoyé au réseau = `hypot(p) − radius` pour un appareil en orbite ; lu par
  `src/ui/netsession.ts:1036-1040` (seuil de 100 km). Écart jusqu'à ±11 à 21 km selon la latitude.
- `src/ui/fc/computer.ts:1048` : ligne « Altitude » de l'ordinateur de vol = `len(r) − R` ; ne concorde pas avec l'altimètre.
- `src/camera/cinevoyage.ts:110` : `hIn = len(q) − R` (hauteur d'entrée de voyage).
- **Piste** : `heightOverGround` ou `cartToGeodetic` ; pour apoapside/périapside, écrire la convention dans le libellé.
- **Preuve** : lu ; l'effet visible n'a pas été observé en jeu.

### AR-11 — P3 — Constantes WGS84 redéfinies dans 6 fichiers
- `src/net/bot.ts:13`, `src/eclipse/core.ts:122,141`, `src/eclipse/earth-moon.ts:115`, `src/controller/character.ts`,
  `src/system/geoid-grid.ts`, `src/photo/iss-pass.ts:16` au lieu d'importer `src/system/ellipsoid.ts`. Preuve : mesuré (grep).

---

## 4. God objects et couplage

### AR-12 — P1 — `main()` est une fonction unique de 9 700 lignes
- **Où** : `src/main.ts:413-10116`.
- **Constat** : une seule `async function main()` contient 117 `let` et 255 `const` de premier niveau, 95 fonctions
  imbriquées, la boucle de 1 300 lignes (`8394-9700`) et le gouverneur de résolution (`8811-9018`). 274 modules importés
  (mesuré, graphe d'imports). L'état de session (`paused`, `frozen`, `recovering`, `firstFrame`, `renderScale`, `gpuEma`…)
  est une fermeture non testable et non inspectable.
- **Impact** : tout chantier de la destination (contrat de frame, état de session, gouverneur par poste) passe par ce
  fichier ; deux sessions parallèles s'y marchent dessus ; rien n'y est testable sans navigateur.
- **Piste (découpes utiles à la destination, dans l'ordre)** :
  1. `session.ts` : états et transitions (AR-02), seul à autoriser `sim.step`.
  2. `frame.ts` : l'ordonnanceur d'étapes gardées (AR-03, AR-04).
  3. `governor.ts` : échelle, tier, bascule raster/tracé (`8811-9018`) — déjà à moitié pur grâce à `quality-policy.ts`.
  4. `cockpit-feed.ts` : poses F-35/A320, DU, PCD (`9104-9397`), hors de `main`.
  5. `persistence.ts` : autosauvegarde et préférences hors frame (AR-05, AR-14).
- **Preuve** : mesuré (grep, script).

### AR-13 — P2 — `CameraController` et `Renderer` concentrent l'état ; les modules de `controller/` sont des mixins
- **Où** : `src/controls.ts:1654` (méthodes posées sur le prototype), 65 fichiers de `src/controller/` augmentent l'interface,
  environ 300 champs déclarés dans la classe (grep) ; `src/renderer.ts` : 11 504 lignes, 108 imports ; `src/fleet.ts`
  singleton mutable importé par 69 modules ; `src/system/our-surface.ts` (table `reliefs` globale) par 53.
- **Constat** : le graphe d'imports est propre (4 cycles de 2 fichiers seulement : `earth-tiles`↔`ign-canopy`,
  `geodesic`↔`gyro`, `spectator`↔`controls`, `crew/draw/kerr`↔`orbit`), mais le couplage réel passe par `this` : chaque
  domaine (vol, caméra, amarrage, combat, réseau, marche) lit et écrit les champs des autres. « Controller » est à la fois
  la simulation de l'appareil, la caméra et l'entrée.
- **Impact** : « la simulation possède l'état, la vue possède sa pose » (§19.12) n'a pas de frontière dans le code.
- **Piste** : ne pas éclater la classe ; séparer par composition trois sous-objets possédés (`craft`, `view`, `input`) et
  faire migrer les champs domaine par domaine quand un lot y touche. `renderer.ts` : sortir d'abord la résidence du monde
  (cartes, tuiles, décor : `1900-2000`, `3750-4100`), ce qui sert aussi AR-01.
- **Preuve** : mesuré (script d'imports, grep) ; le nombre de champs est approximatif.

### AR-14 — P3 — Inversions de couche et second exemplaire d'un réglage
- `src/controller/{aerobatics,craftpanel,stovl,copilot,wingmen,course}.ts` importent `ui/unitsys.ts` ;
  `controller/lowthrust.ts` importe `ui/hud/graph.ts` ; `game/tools.ts` importe `ui/gpu-tip.ts` (mesuré, 8 arêtes).
- `src/game/tuning.ts:18-25` : `TUNING` global recopié depuis `settings` à chaque image (`src/main.ts:9037`).
- **Piste** : `unitsys` hors de `ui/` ; lire `settings` directement ou dériver à la modification.

### AR-15 — P3 — `__bh` installé sans condition, avec accès complet
- `src/main.ts:7966`, `src/automation.ts:178,307`. Le handle expose `settings`, `renderer`, `camera`, `sim` mutables en
  production. C'est un choix produit documenté (BH-API) ; il n'existe pas de sous-ensemble « stable » distinct des leviers
  de test (`jitterStep`, `a320GlassSim` injecté par cast à `src/main.ts:9246`). Preuve : lu.

---

## 5. Robustesse

Décomptes mesurés par grep sur `src/**/*.ts` (790 fichiers) :

| Motif | Total | Répartition principale |
|---|---|---|
| `as any` | 7 | controller 2, ui 1, system 1, game 1, ai 1, racine 1 |
| `@ts-ignore` / `@ts-expect-error` | 1 | `system/ktx-worker.ts:4` |
| `as unknown as` | 129 | ui 49, racine 25, a320 19, controller 11, system 8, game 8 |
| `!` non nul (regex approximative) | ≈ 5 900 | system ≈ 1 330, racine ≈ 1 130, ui ≈ 990, controller ≈ 700, a320 ≈ 450, game ≈ 420 |
| `catch {` sans variable | 98 | system 22, racine 21, ai 13, ui 10, net 7 |
| `.catch(() => {})` et équivalents | 42 | ui 11, racine 9, system 8 |
| `void promesse(…)` | 238 | racine 113, ui 52, system 24, crew 15 |
| `addEventListener` / `removeEventListener` | 418 / 24 | ui 294 / 11, crew 57 / 0 |
| `setInterval` / `clearInterval` | 23 / 20 | ui 13 |
| `TODO` / `FIXME` / `HACK` | 0 | (3 faux positifs : texte ECAM « XXX ») |

### AR-16 — P2 — ≈ 5 900 assertions non nulles, règle de lint coupée
- **Où** : `biome.json` (`noNonNullAssertion: off`), `tsconfig.json` (`noUncheckedIndexedAccess: true`).
- **Constat** : l'option stricte d'indexation est neutralisée à la main par `!` partout (`a[k]!`). Le `TypeError` de
  `heightAt` (AR-03) est exactement ce cas : `L.data[slot]` supposé présent.
- **Piste** : ne pas tout réécrire ; vecteurs en tuples typés (`Vec3` au lieu de `number[]`) dans `math/vec3.ts` pour
  supprimer la plupart des `!` numériques, puis réactiver la règle en « warn » sur `system/` et `controller/`.
- **Preuve** : mesuré (regex, ordre de grandeur).

### AR-17 — P2 — Aucune dette marquée dans le code, 238 promesses lancées sans attente
- **Constat** : zéro `TODO/FIXME` : les limites connues vivent dans des commentaires narratifs et des docs datées, non
  cherchables. 238 `void f()` : sur les 113 de la racine, beaucoup ont un `.catch`, pas tous (ex. `src/main.ts:8713`,
  `9930`). Les `catch {}` échantillonnés (≈ 40) sont commentés et intentionnels ; exception : `src/main.ts:3994` traduit
  toute erreur de chargement rapide en « No quick save yet ».
- **Piste** : une convention unique (`// LIMIT(id):` reliée à `docs/PROBLEMES-A-REGLER.md`) ; règle Biome `noFloatingPromises` à l'essai.
- **Preuve** : mesuré (décomptes), lu (échantillon).

### AR-18 — P2 — 418 écouteurs posés, 24 retirés
- **Constat** : la plupart sont posés une fois à la construction (lu sur un échantillon). Le risque est dans les panneaux
  reconstruits à l'ouverture (`ui/title` 44, `ui/settings` 26) et la console `crew` (57 / 0).
- **Preuve** : mesuré (décompte) ; fuite réelle **supposée, à confirmer** par un profil mémoire après 50 ouvertures de menu.

---

## 6. Sauvegardes et reprise

### AR-19 — P1 — Toutes les sauvegardes nommées dans une seule clé ; une corruption les efface en silence
- **Où** : `src/game/save.ts:94-111`, `src/util/storage.ts:39-47`.
- **Constat** : `kerr.saves` est un seul JSON `{nom: sauvegarde}`. `allSlots()` rend `{}` si la clé est illisible ; le
  `put` suivant réécrit la clé avec la seule nouvelle sauvegarde. Chaque `put` relit, re-sérialise et réécrit toutes les
  sauvegardes. Aucun plafond de nombre ni de taille ; le quota de `localStorage` (≈ 5 Mo par origine, partagé avec
  préférences, diagnostics, clés TARS) n'est pas suivi.
- **Impact** : perte de toutes les sauvegardes sur une écriture interrompue ; quota atteint d'autant plus vite que les
  routes et flottes grossissent.
- **Piste** : IndexedDB, une entrée par sauvegarde, écriture asynchrone ; à défaut une clé par emplacement et un index ;
  conserver la valeur brute illisible sous une clé `.corrupt` au lieu de l'écraser.
- **Preuve** : lu.

### AR-20 — P2 — Échec d'autosauvegarde muet ; validation partielle ; préférences sans version
- `src/main.ts:9046` et `7948` : le booléen de `autosaveNow()` est ignoré ; quota plein = plus d'autosauvegarde, sans message
  (le menu pause affiche seulement l'âge de la dernière réussie, `src/ui/pause.ts:231`).
- `src/game/save.ts:154-164` : seuls nombres et booléens sont réparés ; un réglage chaîne (énumération) de valeur inconnue
  passe tel quel. Même chose pour `readPrefs` (`src/game/prefs.ts:32`, comparaison de `typeof`).
- `src/game/prefs.ts` : `kerr.prefs` n'a pas de champ de version ; les migrations sont des `if` ponctuels (`hudJet`, `netShown`).
- Une sauvegarde de version plus récente est refusée (bien) mais l'autosauvegarde suivante l'écrase (**supposé**).
- **Piste** : valider les choix contre `SCHEMA` (les options y sont) ; versionner les préférences ; signaler l'échec une fois.
- **Preuve** : lu.

Points solides ici : `SAVE_VERSION` + `MIGRATIONS` pas à pas, `checkSave` qui refuse plutôt que de charger à moitié,
séparation préférences / situation, stockage encapsulé (`store`), préfixe de clé pour la préversion `/test/`.

---

## 7. Réglages et i18n

Vérifié par script statique (import de `SCHEMA`, `defaultSettings`, `SETTING_KIND`, `FRENCH`) :
- 388 clés dans `defaultSettings`, 388 dans `SETTING_KIND` : aucune différence.
- 372 entrées de schéma, aucune clé en double, aucune clé inconnue, aucun défaut hors bornes ni hors options.
- 16 réglages sans entrée de schéma (dont `quality`, `voyage*`, `subjectView`, `cockpitPages`) : posés par d'autres écrans.
- Aucune clé sans lecteur hors `settings.ts`/`schema.ts` (recherche par mot ; ≈ 40 clés n'ont qu'un seul lecteur).
- Schéma : un seul texte sans français, le nom de groupe « F-35 » (nom propre). Sur 4 190 littéraux `t()`/`tf()`,
  3 sans entrée (`"{0}: {1}/{2}"`, `"…"`, `"F-35"`), légitimes.

### AR-21 — P2 — 388 réglages à plat, 219 préférences : la surface dépasse ce qu'un contrat peut garantir
- **Où** : `src/settings.ts:191-611`, `src/ui/schema.ts:101-5053` (5 000 lignes de déclarations).
- **Constat** : chaque fonctionnalité ajoute ses interrupteurs (`earthIgnRelief`, `earthIgnSilhouettes`, `orthoDelight`,
  `f35*` ×30…). Plusieurs changent des données physiques (AR-01). Une traduction manquante retombe sur l'anglais sans
  signal (`src/i18n.ts:90`) ; seul un test peut le voir.
- **Impact** : combinatoire non testée ; « même identité visuelle, qualité scalable » (§7.20) impossible à tenir avec 219 axes.
- **Piste** : classer chaque réglage : produit / profil de qualité (dérivé) / laboratoire. Sortir les leviers de laboratoire
  du `Settings` joueur. Ajouter au test existant la vérification statique faite ici (défauts dans bornes, français présent).
- **Preuve** : mesuré (script).

---

## 8. Outils, dépôt, dépendances

- **tsc** : `bunx tsc --noEmit` → 0 erreur, 15,8 s mur (22,8 s CPU). Options strictes actives
  (`strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noImplicitReturns`). Mesuré.
- **biome lint** : 1 758 fichiers en 1,2 s, 0 erreur, **107 avertissements, 26 infos**. Sur les 50 affichés :
  `useOptionalChain` 25, `useTemplate` 10, `noUnusedFunctionParameters` 6, `noExplicitAny` 5, `noUnusedVariables` 2 ;
  23 dans `src/controller`. Règles coupées dans `biome.json` : `noNonNullAssertion`, `noAssignInExpressions`,
  `noCommaOperator`, `useIterableCallbackReturn`. Mesuré.

### AR-22 — P1 — Le document stratégique de référence n'est pas dans git
- **Où** : `git status` : `?? docs/ANALYSE-STRATEGIE-RENDU-2026-11-03.md`, `?? docs/ANALYSE-STREAMING-2026-11-06.md` ;
  `git ls-files` ne les rend pas ; `git check-ignore` non plus (ils ne sont pas ignorés).
- **Constat** : `CLAUDE.md` impose de lire ce document en début de chaque session ; `docs/README.md` (2 fois) et
  `progress-to-destination.md` (3 fois) le citent. Il n'existe que sur ce Mac.
- **Impact** : kerr-mini, kerr-pc, la CI, un clone neuf et le Claude d'Alex n'ont pas la référence ; une perte de disque
  emporte la décision du 3 novembre.
- **Piste** : le commiter (décision de Sam : il a peut-être été gardé local volontairement).
- **Preuve** : mesuré (git).

### AR-23 — P2 — 54 fichiers non suivis, dont 36 sondes e2e et 28 Mo de captures à la racine
- **Où** : racine : `crash*.png/jpg`, `falling.*`, `hit-smoke.*`, `replay-crash.*`, `session.jsonl`, `.jsonl`,
  `pi-session-…html` (28 Mo au total, mesuré) ; `tests/e2e/zz-*.e2e.test.ts` (35) ; `scripts/zz-*` (2) ;
  `tests/e2e/zones-usa-night.e2e.test.ts` (vrai test, non suivi).
- **Constat** : `.gitignore` ne couvre aucun de ces motifs. Les `zz-*` sont dans le périmètre de `tsc` (`include: tests`)
  et de Biome : une sonde cassée casse `bun run check` pour toutes les sessions qui partagent la copie de travail.
  `git add -A` par mégarde les publierait.
- **Piste** : `.gitignore` : `/*.png`, `/*.jpg`, `/*.jsonl`, `/.jsonl`, `/pi-session-*.html`, `tests/e2e/zz-*`, `scripts/zz-*` ;
  un dossier `scratch/` ignoré pour les sondes ; décider du sort de `zones-usa-night`.
- **Preuve** : mesuré (git status, du).

### AR-24 — P3 — Dépendances
- `@types/bun: "latest"` (`package.json`) : non épinglé (1.4.2 installé) ; un `bun install` sans lockfile figé peut changer
  les types sous `tsc`. `typescript: "^5"` (5.9.3 installé).
- `zod 4.6.7` (dev) : un seul importeur, `tools/mac-thermal/src/model.ts`, qui n'a pas son propre `package.json`.
- `playwright ^1.63.0` (dev) : **aucun import ni mention** trouvés dans `src`, `scripts`, `tests`, `tools`, docs (grep) ;
  les e2e pilotent Chrome par CDP. Candidat au retrait (à confirmer : usage manuel possible).
- Dépendances de production : 3 (`@mapbox/vector-tile`, `pbf`, `thinking-orbs`), versions exactes. `src/system/earcut.ts`
  est une copie locale (cf. tableau des bibliothèques de `CLAUDE.md`).
- Le script `build` est une ligne de 1 900 caractères enchaînant 12 `bun build` : fragile, à déplacer dans un script.
- Dépôt : 5 498 fichiers suivis, `.git` = 1,0 Go (mesuré).

---

## Tableau récapitulatif

| Id | Gravité | Sujet | Fichier principal | Preuve |
|---|---|---|---|---|
| AR-01 | P0 | Sol de contact possédé par le renderer, dépend de la caméra, du tier, du chargement | `src/renderer.ts:1945`, `4034` | lu |
| AR-02 | P0 | Pas de politique de temps : onglet masqué, perte GPU, trous | `src/main.ts:8401`, `8449` | lu |
| AR-07 | P0 | `Settings` = préférences + scène + état simulé + pose de vue | `src/settings.ts:191`, `src/controller/motion.ts:857` | lu, mesuré |
| AR-03 | P1 | Frame sans isolation : une exception fige l'image | `src/main.ts:8394-8686` | lu |
| AR-04 | P1 | Instruments et poses calculés après le rendu | `src/main.ts:8686`, `9104` | lu |
| AR-05 | P1 | Autosauvegarde, layout et allocations dans la frame | `src/main.ts:9046`, `9325` | lu |
| AR-08 | P1 | Plusieurs horloges, `performance.now()` dans la logique de vol | `src/sim.ts:66`, `src/controller/motion.ts:1051` | lu, mesuré |
| AR-09 | P1 | Sauvegarde = situation, `load` remet les systèmes à zéro | `src/game/tools.ts:995` | lu |
| AR-12 | P1 | `main()` de 9 700 lignes, 372 variables de fermeture | `src/main.ts:413` | mesuré |
| AR-19 | P1 | Toutes les sauvegardes dans une clé, écrasées si illisible | `src/game/save.ts:94` | lu |
| AR-22 | P1 | Document stratégique de référence non commité | `docs/ANALYSE-STRATEGIE-RENDU-2026-11-03.md` | mesuré |
| AR-06 | P2 | Cadence calculée sur `dt` tronqué | `src/main.ts:8412` | lu |
| AR-13 | P2 | `CameraController`/`Renderer` : état partagé par mixins | `src/controls.ts:1654` | mesuré |
| AR-16 | P2 | ≈ 5 900 `!`, règle coupée | `biome.json` | mesuré |
| AR-17 | P2 | Dette non marquée, 238 promesses non attendues | `src/main.ts:8713` | mesuré |
| AR-18 | P2 | 418 écouteurs posés, 24 retirés | `src/ui`, `src/crew` | mesuré, fuite supposée |
| AR-20 | P2 | Échec d'autosauvegarde muet, validation partielle, prefs sans version | `src/main.ts:9046`, `src/game/prefs.ts:32` | lu |
| AR-21 | P2 | 388 réglages à plat, dont des leviers physiques | `src/settings.ts:191` | mesuré |
| AR-23 | P2 | 54 fichiers non suivis, sondes `zz-*` dans `tsc`/Biome | `.gitignore` | mesuré |
| AR-10 | P3 | Trois altitudes en |p| − rayon | `src/controller/netcraft.ts:397` | lu |
| AR-11 | P3 | Constantes WGS84 dupliquées (6 fichiers) | `src/eclipse/core.ts:122` | mesuré |
| AR-14 | P3 | `controller` → `ui`, `TUNING` recopié par image | `src/game/tuning.ts:18` | mesuré |
| AR-15 | P3 | `__bh` complet en production, leviers de test mêlés | `src/automation.ts:307` | lu |
| AR-24 | P3 | `@types/bun: latest`, `playwright` sans usage, `zod` pour un outil | `package.json` | mesuré |

## Ce qui est solide

- `tsc` strict à 0 erreur sur 310 000 lignes ; 7 `as any`, 1 `@ts-ignore`.
- Graphe d'imports sain : 4 petits cycles, `main.ts` importé par personne, `system/` n'importe ni `ui` ni `renderer`.
- `Simulation.step` commun au direct, à `__bh.step` et à la vidéo ; sous-pas de vol bornés (`subCap`), l'horloge de
  l'appareil qui retarde plutôt que d'intégrer un pas trop long ; `dt` jamais négatif.
- Réglages : une table de nature par clé vérifiée par le compilateur, schéma sans doublon ni défaut hors bornes, français complet.
- Sauvegardes : version, migrations, refus d'un fichier corrompu, stockage encapsulé qui ne lève jamais.
- WGS84 et géoïde appliqués presque partout ; `EARTH_RM = WGS84_A`.
- Reprise GPU existante (`swappable`, `adopt`, garde à trois pertes par minute), diagnostics et profileur CPU par section.
- Plafond de cadence compté en rafraîchissements entiers (pas de battement 2/3).

## Non vérifié

- Tout coût réel : durée de l'autosauvegarde, des lectures de layout, du HUD, pression GC (lire `cpuProf` en vol).
- Le saut de l'appareil posé à l'arrivée d'une tuile et la marche sous un appareil qui roule : non reproduits.
- Le comportement en salle après onglet masqué ou perte GPU (`src/net`, `src/ui/netsession.ts` non lus en détail).
- La limitation des toasts d'erreur par `globalErrorRouter` (`src/gpu-diagnostics.ts:144`).
- Les fuites d'écouteurs (décompte seulement).
- `server.ts` et `server/` : parcourus, non audités (routes `/__snapshot`, relais Deepgram).
- `src/renderer.ts` au-delà des zones citées ; `src/ui/schema.ts` hors contrôle par script ; `src/ship.ts`.
- Les chaînes passées à `t()` par variable (tables de données) : seuls les littéraux et le schéma sont contrôlés.
- Le décompte des `!` est une regex : ordre de grandeur, pas un compte exact.
- `bun test`, e2e, `check-wgsl`, `pipeline-inventory --check` : non lancés (hors consigne).
