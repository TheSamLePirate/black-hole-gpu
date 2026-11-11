# Problèmes à régler

Problèmes constatés, pas encore réglés. Chaque entrée : la date (UTC), ce qui est mesuré ou observé et sa source, la cause
connue ou supposée, la piste. Une entrée réglée est barrée avec le commit qui la règle, pas effacée.

## Le Lander posé ne décolle pas avec U (autopilote de décollage)

- **Constaté en jeu le 6 novembre 2026** (sonde `probe-moon` de la session, e2e `apprendre-vaisseaux`, ce Mac) : le
  Lander posé à Tranquillité (`__bh.game.land("moon", 0.674, 23.473)`), `launchGoal = { altKm: 100 }`,
  `setAuto("takeoff")` : 600 s plus tard, toujours posé, `pilot.auto === "takeoff"`, manette et poussée à 0, aucun
  message. Même chose après un stationnaire (8) demandé posé. Le Ranger, même place, même recette : décolle et monte
  (98 km en 600 s). Le Lander placé en stationnaire à 300 m par `hoverOver` puis U : décolle et monte.
- **Cause supposée** (lecture de `controller/lowthrust.ts`, branche du décollage) : la boucle de vitesse veut pointer
  le nez vers la poussée demandée et coupe le moteur tant qu'il n'y est pas (rampe d'alignement) ; posé, le Lander ne
  tourne pas — le Ranger a son cas particulier (« Airless, its 12° on the gear and the engine lift it at once »).
- **Piste** : un départ vertical du Lander posé (poussée sur son axe de moteurs, comme le cas du Ranger), puis la loi
  de montée ; un e2e qui le vérifie (`apprendre-vaisseaux`, leçon 10, avec le Lander).

## Vol et tests : défauts relevés en lisant le code, non vérifiés en vol

- **Constaté le 6 novembre 2026** par lecture du code (session de documentation : [VOL-AVIONS.md](VOL-AVIONS.md),
  [VOL-VAISSEAUX.md](VOL-VAISSEAUX.md), [E2E-VOLS.md](E2E-VOLS.md) §9). Rien n'a été lancé : chaque point est à confirmer.
- **Des e2e lisent des membres qui n'existent pas** (la ligne ne fait rien, le test passe sans vérifier) :
  `c.jetModes.alt = c.last?.alt ?? …` dans 9 fichiers (`flight-quality`, `raster-motion`, `raster-flight`…) — `camera.last`
  n'existe pas (voulu : `c.jetFigures()?.h`) ; `cockpit-flight.e2e.test.ts` l. 60 et 82 attend `airInfo().agl` (pas de tel
  champ : l'étape « jusqu'à 3 km » court son plafond de 200 s) ; `coast-survey.e2e.test.ts:101` appelle
  `__bh.sys.sunElevation?.()` (inexistant : toujours `null`).
- **U ne décolle probablement pas un F-35** : sur une piste, U lance l'autopilote de décollage orbital
  (`controller/lowthrust.ts`), qui refuse sous un rapport poussée/poids de 1,05 ; le F-35 sec est à ≈ 0,59.
  [F35.md](F35.md) dit que U décolle automatiquement. Piste : un essai en vol, puis un décollage propre aux avions ou la
  doc corrigée.
- **Les grisés du HUD pour décoller et atterrir** (`src/ui/flighthud.ts`, vers la ligne 2274) dépendent d'un `else` qui
  semble rattaché à la condition du maintien de station : ils ne s'appliqueraient qu'avec un appareil à moins de 5 km.
- **Affichage TAT/SAT de l'A320** (`src/a320/du/data.ts`, vers la ligne 203) : une température en °C divisée par
  `1 + 0,2 M²` ; la SAT affichée serait fausse en vitesse.
- **Limites non appliquées** (choix ou oubli à trancher) : aucune vitesse de train, de volets ni VMO n'endommage un avion ;
  aucune masse maximale de l'A320 ; la ZFW du MCDU ne change pas la masse ; le ralenti du F135 n'est pas lu (manette 0 =
  poussée 0).

## La compilation du noyau de Jupiter proche : ~200 s à froid

- **Constaté le 6 novembre 2026** (Sam : « 200 s pour Jupiter »), en écrivant l'e2e `aurora-jupiter` (AM3).
- **Mesuré** sur le MacBook Pro M1 Max, Chrome lancé par l'e2e, cache de pipelines vide : la caméra à 7 000 km au-dessus de
  45° N de Jupiter (dans son ombre), le noyau du traceur pour cette vue se compile en **203 s sans les aurores** et **219 s
  avec** (`__bh.renderer.compilesPending` à 0). Sonde e2e jetable, même vue, réglage `aurora` 0 puis 5. Après la compilation
  du traceur, le noyau de la sonde de lumière (« the light probe (auroras) ») en demande encore ~60 s.
- **Ce n'est pas l'aurore** : la variante sans aurore met déjà 203 s. C'est le noyau du détail proche des géantes
  (`NEAR_DETAIL`, la tuile de turbulence, le volume des nuages `giantInside`…), compilé à la première approche.
- **Effet** : à la première approche de Jupiter, l'image attend plus de trois minutes sur ce Mac (plus sur le mini, le PC
  Windows non mesuré). Les e2e de Jupiter doivent attendre jusqu'à 5 min à froid (`aurora-jupiter` le dit dans son bandeau).
- **Piste** : mesurer le temps de compilation par fonction comme pour PLAN-LEAN-TRACER-KERNELS (P0–P10 : la Terre passée de
  134 à 19 s) ; spécialiser le noyau des géantes (ce que la caméra proche n'utilise pas) ; compiler en avance dès que
  Jupiter devient la destination (G, l'Atlas, `near`) — ANALYSE-STRATEGIE §8 « anticiper les compilations ».

## Le ciel de nuit de la sonde de lumière du Ranger, ~40 fois son sol

- **Constaté le 6 novembre 2026** (AM2). La nuit à Tromsø, la mer des fjords dessinait une bande blanche saturée le long de
  l'horizon, avec ou sans Lune. La sonde relue : son ciel ~4·10⁻⁶, son sol ~10⁻⁷ (unités de la scène), alors que la vue
  principale dessine le ciel plus sombre que la neige. Sans le vaisseau, la bande disparaît (moyenne 170 → 4).
- **Raccord provisoire** (a1e34357) : dans `seaShade`, le reflet de la sonde est borné à 4 fois le ciel clair du modèle de la
  caméra.
- **À trouver** : pourquoi le ciel de la sonde est si clair la nuit (échelle du fond de ciel liée à l'exposition ?
  `physicalPoints` des étoiles ?) ; puis retirer la borne.

## L'aurore de la face nuit invisible quand la caméra est au soleil, dans l'espace

- **Constaté le 6 novembre 2026** (AM2) : à 4 000 km au-dessus du Canada, caméra au soleil, l'exposition suit la lumière
  qui tombe sur la caméra (`earthSunlight`), l'œil est adapté au jour, la face nuit et son aurore restent noires.
- **Piste** : une exposition qui tient compte de ce que la vue regarde (le posemètre lit déjà la scène pour la retenue des
  hautes lumières) plutôt que de la seule lumière incidente, hors de l'atmosphère.

## Jupiter vu de près depuis l'hémisphère sud : l'image parfois toute noire

- **Constaté le 6 novembre 2026** (AM3, e2e `aurora-jupiter` et une sonde jetable) : la caméra libre à 7 000–14 000 km
  au-dessus de 50–55° S, regardant vers le sud, l'image est entièrement noire, étoiles comprises (luminance moyenne 0,1 sur
  255), **aurore éteinte comme allumée, de jour comme de nuit** — ce n'est pas l'aurore. Une autre fois, la même vue
  s'affiche (étoiles, limbe, ovale sud). Pas d'erreur GPU (`gpuErrors` 0), temps GPU normal (7–14 ms), une fois 0,5 ms.
- **Piste** : un NaN ou une exposition qui part (le posemètre après la coupe), le chemin des géantes proches
  (`giantInside`, la tuile de turbulence) sur l'hémisphère sud ; relire la luminance du posemètre et les pixels NaN dans
  cette vue.

## Le coût de l'aurore terrestre de près, la nuit : +4,6 ms sur le M1

- **Mesuré le 6 novembre 2026** (e2e `aurora-cost` sur kerr-mini, Nominal, plein écran, ABAB, médiane de 24 lectures) :
  Tromsø, Kp 4, de nuit, regard au sud : 36,2 → 40,8 ms (échelle de rendu 0,75 des deux côtés), ~+12 %. Depuis 400 km :
  +2,1 ms (échelles différentes, à refaire). Le schéma de la magnétosphère : +2,3 ms à échelle 1,00 après passage à la
  demi-résolution (≥ +5,5 ms avant). Jupiter : +0,5 ms.
- **Déjà fait** : 16 évaluations par rayon au lieu de 40 ; aucun noyau d'aurore quand l'œil est adapté à plus de 1 000 lux ;
  les rayons qui restent sous 45° de latitude magnétique sautés (gain de ces deux tris non mesuré).
- **Piste** : le cache par direction d'Alex (§ 7.5 : une carte octaédrique marchée depuis l'œil, une bande par image, lue par
  la composition) — au-delà de ~100 km sans parallaxe ; la marche à ¼ de résolution recomposée.

## Saturne vue de son ombre, l'œil adapté : des artefacts partout

- **Constaté le 6 novembre 2026** (AM4, e2e `aurora-giants` sur kerr-mini) : la caméra à un rayon au-dessus du côté nuit de
  Saturne, dans son ombre, l'exposition adaptée au noir (comme pour Jupiter) : l'image se couvre de croissants pixellisés
  dans tout le ciel et de trous dans le disque. À la lumière du jour, rien de tel : c'est une lumière faible et fausse du
  traceur autour de Saturne (la lumière des anneaux sur la face nuit ? un bruit d'accumulation ?) que le gain révèle.
- **Raccord** : l'œil n'est pas adapté à l'ombre de Saturne (`earthSunlight`) ; ses aurores sont calculées mais à leur
  radiance physique, donc invisibles de nuit. **Piste** : relever cette lumière (sonde de pixels) et la corriger, puis
  rendre l'adaptation à Saturne.

## Le traceur (pipeline « trace ») au large de Big Sur : une nappe sombre plate jusqu'à l'horizon

- **Constaté le 6 novembre 2026** (sonde e2e, vol à 450 m au large de Big Sur, cap 150°, `earthPipeline: "trace"`) : une nappe
  plate et sombre au-dessus de la mer, à droite, jusqu'à l'horizon, avec un trait clair le long de la côte. **Elle est
  identique avec le relief national coupé** (`earthIgnRelief: false`) : elle ne vient pas de Mapterhorn, elle précède le lot D.
  Le raster (le pipeline par défaut) ne la montre pas.
- **Piste** : la profondeur de la mer du traceur (`seaDepthAt`, niveaux z 8–10 de Terrarium) ou sa surface de mer lointaine ;
  sonder les pixels de la nappe (distance, `gq`, profondeur lue).

## Les e2e « hors ligne » ne coupent pas le réseau du Service Worker

- **Constaté le 10 novembre 2026** (ce Mac, copie de travail sur `fcddd376`), en cherchant pourquoi `zones-usa-night` échouait
  (8 requêtes Overture comptées « réseau » pendant le vol hors ligne).
- **Mesuré** par une sonde e2e jetable (`App.boot({ sw: true })`, puis `Network.emulateNetworkConditions { offline: true }`
  sur la session de la page) : `navigator.onLine` vaut `false`, mais une tuile Terrarium jamais chargée, demandée par la
  page, revient **200, 138 485 octets**, sans en-tête de zone ni de cache. Le Service Worker est une autre cible de Chrome :
  la coupure posée sur la page ne s'applique pas à ses `fetch`.
- **Effet** : `zones`, `zones-scenery`, `zones-usa-night`, `pwa` et `overture` coupent le réseau de cette façon. Leur compte
  « servi par la zone / demandé au réseau » reste juste (il est tenu par le Service Worker), mais ils ne prouvent pas que
  le jeu tient sans réseau : une donnée absente de la zone est servie par le réseau au lieu de manquer.
- **Les 8 requêtes de `zones-usa-night`** : 43 des 45 plages `base.pmtiles` demandées au réseau sont les tuiles z 13 autour
  de 2,54° S, 14,76° E — le point sous l'orbite de départ de la scène `game:artemis`, pas JFK (0 sur 45 autour de JFK ;
  script jetable, `PmTiles.locate`). C'est la première scène du décor : ses requêtes ne sont pas annulées au saut
  (`scenery-worker.ts:915-941`, aucun signal d'annulation par scène) et, le réseau marchant, elles durent assez pour tomber
  dans la fenêtre comptée. La zone de JFK n'a pas de trou. Le test passe ou échoue selon l'instant.
- **Corrigé dans le harnais le 10 novembre** (non commité) : `app.offline(on)` (`tests/e2e/lib/cdp.ts`, `app.ts`) coupe la page
  et les cibles du Service Worker ; sonde : la tuile échoue hors ligne, avant et après un rechargement, et revient en ligne.
  `zones-usa-night` l'utilise, liste les requêtes de la page qui échouent hors ligne et vérifie qu'aucune tuile de sol n'a
  échoué au-dessus de la zone. **Restent à convertir** : `zones`, `zones-scenery`, `pwa`, `overture` (non relancés).
- **Ce que le premier passage réellement hors ligne a montré** (`zones-usa-night`, ce Mac, `run-2026-11-10b.log` et `c.log`) :
  - **Après une seule visite, le monde est noir hors ligne.** Les fichiers du jeu sont gardés à l'usage, et la première visite
    les charge avant que le Service Worker tienne la page : au rechargement hors ligne, 24 cartes de planètes (`*-HASH.jpg`)
    et `basis_transcoder.wasm` échouent, le décor reste « away-from-earth », aucune tuile n'est demandée. Avec une seconde
    visite en ligne avant la coupure, la zone est dessinée (8 000 bâtiments, 135 réponses du décor par la zone, 0 hors zone,
    0 tuile de sol en échec, 0 plage Overture au réseau).
  - ~~**Les pistes manquent hors ligne.**~~ *Réglé le 10 novembre (lot ST1, commit de ce jour) : les zones gardent
    l'index et les tuiles de 5° des pistes à 150 km (`runwayZoneChains`) ; une tuile en échec n'est redemandée qu'après
    30 s (`world/runways.ts`). Revérifié : `zones-usa-night`, la piste 13R dessinée hors ligne.* `runways/v1/t*.json` (servi par le jeu) n'est pas gardé : 445 échecs en une minute
    sur 4 fichiers — demandé en boucle, sans recul. La piste de JFK n'est pas dessinée (capture `held.png`).
  - **Des workers et modèles manquent** (toujours ouvert ; depuis le 10 novembre, un modèle d'appareil en échec réseau
    est signalé par un avertissement et redemandé après 30 s au lieu de rester « en chargement » toute la session —
    `ship.ts` ; il n'est toujours pas gardé hors ligne) : `earth-surface-worker.js`, `terrain-mesh-worker.js`, `sailboat-HASH.bin`,
    `trawler-HASH.bin` échouent hors ligne.
  - ~~**Du relief IGN demandé à JFK**~~ *Réglé le 10 novembre : c'était la première scène du décor, au lieu de départ
    du F-35 (Le Bourget), dont le relevé IGN continuait ses requêtes et ses relances après l'annulation. Chaque scène a
    désormais son `AbortController`, déclenché par l'annulation (`scenery-worker.ts`). Revérifié : `zones-usa-night`,
    0 requête au réseau pendant le vol.* Constat d'origine : 36 grilles `wms-r` et 16 de couvert, autour de 2,44° E, 48,9° N (Le Bourget), pendant
    le vol à New York. Origine non établie.
  - *(10 novembre, après les correctifs : `zones-usa-night` **vert** sur ce Mac, `run-2026-11-10e.log`.)* Le test restait **rouge** sur son dernier critère (rien d'autre que la carte tactique demandé au réseau) : pistes, relief,
    couvert. C'est l'état réel, pas un artefact.
- **Piste** : mettre en cache à l'installation ce qu'il faut pour un premier rechargement hors ligne (cartes des corps,
  transcodeur, workers, pistes), ou le dire au joueur ; un recul sur les pistes en échec ; chercher qui demande Le Bourget.
- **Piste d'origine (faite pour le harnais)** : couper aussi la cible du Service Worker (`Target.setAutoAttach` puis la même commande sur sa session, ou
  `Network.emulateNetworkConditions` au niveau du navigateur) dans `tests/e2e/lib/app.ts`, en une fonction `app.offline()` ;
  puis compter dès le rechargement, et lire `earthTiles.failed`. Annuler les requêtes d'une scène dépassée (ST2). Ajouter la
  leçon à [E2E.md](E2E.md) §7.

## ~~Paris de nuit vu du cockpit : la ville presque noire (300 m et 900 m)~~ — pas une régression (11 nov., même machine)

- **Constaté le 11 novembre 2026** (kerr-mini) : e2e `night-views` (`NV_ONLY=300m` : 48,86° N 2,15° E, cap 95°, 300 m, nuit sans
  lune) — image presque noire, luminance moyenne 0,010, le décor « en cours d'assemblage » au moment de la photo ; e2e
  `paris-night-flight` (900 m) — de face quelques points, de côté en virage des rues orange pâles ; la planche du 6 novembre
  (`docs/progress/nuit/n1-paris-900-vues.jpg`, df9c782e) montrait les rues vives. **Antérieur aux travaux du 11** : A/B
  `ab-commit` contre 7fd26201 (début de session) — identique (0,0102 contre 0,0103, RMSE 0,5 %).
- **Cause** : non cherchée. La planche du 6 a peut-être été faite autrement (caméra libre, exposition) ; ou une régression entre le
  6 et le 10 (exposition de nuit, lumières de la carte, décor).
- **Piste** : rejouer `paris-night-flight` sur df9c782e (A/B `ab-commit`), puis bissection si l'écart se confirme ; comparer
  l'exposition choisie (`renderer` exposure) des deux côtés.
- **Vérifié le 11 novembre (ce Mac, M1 Max)** : `paris-night-flight` sur df9c782e (worktree) et sur l'arbre actuel — luminances
  moyennes de la ville 0,099 / 0,066 / 0,094 / 0,089 contre 0,100 / 0,066 / 0,099 / 0,068 : les mêmes. La planche du 6 a été faite
  sur ce Mac (sortie HDR) ; kerr-mini (SDR) rend la nuit 3 à 4 fois plus sombre en capture — un écart de machine, pas du code.
  (Le banc `ab-commit` ne charge pas le paquet de décor de ce test : « scenery pack », les deux côtés.)
- **Pluie** : l'e2e `rain` (« paused, the rain holds… ») échoue aussi avant et après le 11 (la vue en pause n'atteint pas
  `converged` en 150 s) — même démarche.
