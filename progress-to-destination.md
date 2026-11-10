# Progrès vers la destination WebGPU AAA

**Destination permanente : une expérience de jeu/simulation AAA en WebGPU, obtenue progressivement pendant les travaux actuels. Les 60 images réelles/s constituent une cible progressive, avec qualité, contenu, lisibilité et stabilité préservés. Aucune session du projet ne doit ignorer cette destination.**

Références : [consignes permanentes](CLAUDE.md), [analyse stratégique](docs/ANALYSE-STRATEGIE-RENDU-2026-11-03.md), en particulier §1 (décision), §18 (bibliothèques), §19 (expérience) et §20 (migration progressive).

## Règle de tenue

- Lire les dernières entrées au début de chaque session et confronter leur contexte à l’état actuel du dépôt.
- Chaque fois qu’une session avance vers la destination, ajouter une entrée après le lot achevé, au plus tard avant sa conclusion ou la transmission du travail. Une session peut regrouper ses lots dans une entrée en les distinguant clairement.
- Consigner ce qui a réellement changé : code, contenu, contrat, documentation ou dépendance retirée. Relier l’avancée à la destination et aux sections/jalons concernés.
- Distinguer documenté, implémenté, vérifié statiquement, observé et mesuré. Donner les sources disponibles ; préciser ce qui n’a pas été vérifié. Une proposition n’est pas une réalisation, un gain attendu n’est pas un gain mesuré.
- Conserver l’historique et les entrées des autres sessions. Corriger une erreur par un ajout explicite. Ne pas inventer de pourcentage « AAA », de résultat ni de progrès pour remplir le journal.
- Respecter le périmètre et les restrictions de Sam. Une session sans avancée vers la cible indique son absence d’impact ou sa limite dans son compte rendu ; elle reste tenue de connaître et respecter la destination.

## Format d’une entrée

```markdown
### AAAA-MM-JJ HH:MM UTC — Sujet du lot / de la session

- Contribution à la destination : garantie, section ou jalon concerné.
- Réalisé : changements effectifs ; liens vers fichiers et commits disponibles.
- Preuves : état de vérification et sources ; vérifications non effectuées.
- Limites / transitions restantes : ce qui n’est pas encore couvert ou établi.
- Suite : prochaine étape proposée, distincte du travail réalisé.
```

## Journal

### 2026-11-03 05:14 UTC — Initialisation du suivi permanent

- **Contribution à la destination :** rendre durable la convergence WebGPU AAA et son suivi entre sessions, selon l’analyse §20.8. Entrée documentaire d’initialisation.
- **Réalisé :** création de ce journal ; obligation de lecture et de consignation ajoutée dans [CLAUDE.md](CLAUDE.md) et l’[analyse stratégique](docs/ANALYSE-STRATEGIE-RENDU-2026-11-03.md). La règle couvre les progrès techniques et documentaires, avec des paliers acceptés vers 60 images/s.
- **Preuves :** contenu documentaire relu et liens locaux contrôlés par lecture statique. Aucun code du jeu modifié, aucune bibliothèque installée, aucun lancement, test, e2e ou benchmark effectué pour ce lot. Aucun gain de rendu ou de cadence revendiqué.
- **Limites / transitions restantes :** le journal ne reconstitue pas les chantiers antérieurs comme des résultats de cette session. Leur historique et leurs preuves restent dans les commits et documents de progression existants. La présence des consignes ne démontre pas à elle seule une migration du runtime.
- **Suite :** les prochaines sessions consignent ici leurs avancées effectives et les raccordent à la roadmap, en préservant les contrats communs et les travaux utiles déjà réalisés.

### 2026-11-03 06:25 UTC — H3 (première partie) : les ombres longues du corps proche lues sur ses cartes d'horizon

- **Contribution à la destination :** §7.8 (une ombre par échelle, chacune dans son domaine déclaré) — plan T/Q/H/R, phase H3.
- **Réalisé :** `trace.wgsl` `nearHorizon` (la carte vers le Soleil revue depuis la hauteur propre du point, pénombre élargie par ce que l'horizon balaie sous le pixel), appliquée en tête de `nearShadow` (Soleil sous l'horizon : 0) et, pour Mars, après le fondu de `REL_SH` ; fondu de 1,5 s à l'arrivée des cartes (`renderer.ts`) ; Mercure, Cérès et Mars cuits (`horizon-maps.ts`) ; e2e `horizon-near` ; fiche [H3.md](docs/progress/refraction-horizons/H3.md).
- **Preuves :** mesuré sur kerr-mini (Lune 3 vues, Mercure, Cérès, Mars) : assombrissement au terminateur de 0,09 à 1,8 %, rien d'éclairci au-delà du bruit des captures, pas de grain ajouté, aucune erreur GPU ; temps GPU avec/sans dans le bruit (≤ 0,9 ms). Vérifié statiquement : 69/69 shaders, budgets des noyaux, tests unitaires. Non mesuré : le Mac de Sam, le PC, une photo réelle.
- **Limites / transitions restantes :** aucun gain de coût — la marche lointaine reste (son retrait rééclairait 0,73 % des pixels) ; effet sur Mars non démontré ; `otherGround` non branché.
- **Suite :** une carte prudente (H3a ou maximum des mips) pour retirer la marche là où c'est démontré ; une vue de Mars sortie de son crépuscule ; H1c, H4.

### 2026-11-03 07:25 UTC — H5 (première partie) : l'horizon de la Terre en 8 directions

- **Contribution à la destination :** §7.8 (ombres par échelle) — plan T/Q/H/R, phase H5 ; prépare Q4 (visibilité du ciel des vallées).
- **Réalisé :** `src/system/earth-horizons.ts` (cuisson GPU par bandes sur les niveaux 4–6 du cache du relief, publication d'un niveau entier, lecteur injecté avec le cache), `TABLE_EARTH_HORIZON` (aucune liaison ajoutée), `earthHorizonLight` dans `liteSun` et `earthGround` ; e2e `earth-horizons` ; e2e `horizon-near` et `earth-horizons` tenant l'exposition automatique (`autoExposureEV`) au lieu de la couper ; fiche [H5.md](docs/progress/refraction-horizons/H5.md).
- **Preuves :** mesuré sur kerr-mini (Valais et Annecy au couchant, Valais à midi) : 2,2 % / 0,4 % de pixels assombris, éclaircis dans le bruit, rien à midi, aucune erreur GPU ; H3 revérifié vert avec l'exposition tenue. Vérifié statiquement : 70/70 shaders, budgets des noyaux, tests unitaires. Non vérifié : la justesse des ombres contre la marche tracée ou une photo ; le Mac de Sam, le PC.
- **Limites / transitions restantes :** lecture +0,4–0,8 ms (cible < 0,2 ms) ; cuisson ~1,5 ms/image pendant 8–10 images par niveau ; justesse non validée contre une référence.
- **Suite :** validation contre `earthTerrainShadow` sur les mêmes vues ; réduction du coût de lecture ; Q4 (L2b).

### 2026-11-03 07:40 UTC — H5 : lecteur de l'horizon terrestre réécrit (correction, pas de gain de coût)

- **Contribution à la destination :** §7.8 (ombres par échelle, sans double compte entre domaines).
- **Réalisé :** `liteSun` prend le minimum entre cascades et horizon du cache (au lieu de leur produit) ; `earthHorizonSin` mélange les 4 nœuds en grandeurs linéaires puis relit une fois par secteur — commit 66740996, fiche [H5.md](docs/progress/refraction-horizons/H5.md).
- **Preuves :** mesuré sur kerr-mini (e2e `earth-horizons` vert) : effet inchangé ; matériau raster +0,2 à +0,7 ms avec la lecture, comme avant — aucun gain de coût. Vérifié statiquement : 70/70 shaders, budgets, tests unitaires.
- **Limites / transitions restantes :** le coût vient vraisemblablement des lectures dispersées dans le tampon des tables ; cible < 0,2 ms non tenue.
- **Suite :** porter ces horizons dans une texture filtrée par le matériel avec le stockage de T9 (décompte de textures commun).

### 2026-11-03 08:14 UTC — T9a : les orthophotos filtrées par le matériel

- **Contribution à la destination :** §20.5 étape 3 et §7.6 (imagerie filtrable, préparée avant l'image) ; contrat C0-4 (2–4).
- **Réalisé :** texture propre aux orthophotos (vue sRGB, une fenêtre par couche en `repeat`, mips par tuile à l'arrivée, couverture en alpha), lecture `orthoAt`/`orthoGrad` anisotrope 16 ; orthos retirées de la texture `rg32uint` et lecteur `orthoImage` supprimé — commit 1b9b26f4, fiche [T9.md](docs/progress/refraction-horizons/T9.md).
- **Preuves :** mesuré sur kerr-mini (A/B A B B A, Paris 450 m, scène complète) : matériau raster −2 % (−0,37 / −0,55 ms), images équivalentes au bruit près, aucune erreur GPU ; vérifié statiquement : 71/71 shaders, budgets, tests unitaires. Non mesuré : scintillement en mouvement ; Mac de Sam ; PC.
- **Limites / transitions restantes :** niveaux z6–14 encore en imagerie empaquetée et bilinéaire manuel ; hauteurs en `rg32uint` ; orthos sous 30 textures non affichées (pas d'adaptateur).
- **Suite :** T9b (imagerie z6–14 dans la même structure), T9c (hauteurs `r32float`), puis les horizons de H5 en texture filtrée.

### 2026-11-03 08:31 UTC — T9b : l'imagerie z6–14 filtrée par le matériel

- **Contribution à la destination :** §20.5 étape 3, §7.6 ; contrat C0-4 ; le budget du matériau (§8.2).
- **Réalisé :** imagerie des niveaux du relief dans les textures filtrées (1024² partagée avec les orthos, 2048² aux portées lointaines), lecteurs `tileImgAt`/`tileImgGrad`, lumières nocturnes lues à part, talon gardant l'ancien chemin sous 31 textures — commit 01ac2bcb, fiche [T9.md](docs/progress/refraction-horizons/T9.md).
- **Preuves :** mesuré sur kerr-mini (A/B A B B A contre T9a, Paris 450 m, scène complète) : matériau raster −1,1 ms (−6 % devant, −4 % vers le sol), images équivalentes ; vérifié statiquement : 71/71 shaders, budgets, tests unitaires. Non mesuré : scintillement en mouvement ; Mac de Sam ; PC ; iPad (mémoire).
- **Limites / transitions restantes :** imagerie en double (canal g du relief + textures filtrées) : ≈ +140 Mo à la portée « très loin » — transition à fermer par T9c.
- **Suite :** T9c (hauteurs seules en `r32uint`, lumières nocturnes en couches filtrées), puis les horizons de H5 en texture.

### 2026-11-03 08:52 UTC — T9c : relief en hauteurs seules, lumières nocturnes filtrées (fin de T9)

- **Contribution à la destination :** §7.13 (mémoire et bande passante), §7.6, contrat C0-4 (1, 4) ; retrait de l'imagerie en double introduite par la transition T9b.
- **Réalisé :** texture du relief en `r32uint` là où l'imagerie est filtrée, lumières VIIRS z6–8 dans trois couches filtrées, lecture `tileLightsAt` ; textures filtrées réduites à 1 × 1 sans support — commit 951c90eb, fiche [T9.md](docs/progress/refraction-horizons/T9.md).
- **Preuves :** mesuré sur kerr-mini (A/B jour et nuit contre T9b) : matériau raster inchangé à ±0,3 ms, nuit à 12 km identique (luminance 9,83/9,88) ; mémoire 354 → 274 Mo (portée « très loin ») ; vérifié statiquement : 71/71 shaders, budgets, tests. La CI de T9a avait échoué (un faux appareil sans pipeline en test unitaire), corrigée depuis T9b.
- **Limites / transitions restantes :** fenêtres d'imagerie encore liées à celles du relief (C0-4 : toutes à 8 tuiles) ; 4 couches 1024² inutilisées aux portées lointaines ; scintillement en vol non mesuré.
- **Suite :** les horizons de H5 en texture filtrée (coût de lecture), puis Q6 (reconstruction) selon §20.5.

### 2026-11-03 09:06 UTC — H4 : bilan des horizons, état exposé à TARS

- **Contribution à la destination :** §7.8 (ombres par échelle, domaines déclarés) ; §19 (les fonctions produit accessibles à TARS par les mêmes états).
- **Réalisé :** `renderer.horizonStatus` dans la télémétrie « sky » de TARS ; [docs/HORIZONS.md](docs/HORIZONS.md) (EN + FR) ; fiche [H4.md](docs/progress/refraction-horizons/H4.md) et planche — commit 0bcef90d.
- **Preuves :** documentaire et vérifié statiquement (typage, tests TARS 20/20) ; les mesures citées sont celles des fiches H2, H3, H5 (kerr-mini), pas de nouvelle campagne.
- **Limites / transitions restantes :** H1c en attente (hébergement des DEM du pôle sud : décision de Sam) ; coût de lecture de H5 au-dessus de la cible ; justesse non comparée à une photo ni à la marche tracée.
- **Suite :** le reste de Q3 (bâtiments raster), puis T8 et Q6.

### 2026-11-03 09:37 UTC — Q3 (suite) : murs mitoyens aveugles, usage, détail par l'empreinte

- **Contribution à la destination :** §20.5 étape 3 (données de bâtiments préparées pour le matériau : faces aveugles, usage), §7.15 (contenu crédible, stable en mouvement — détail selon l'empreinte).
- **Réalisé :** drapeau de mitoyenneté porté des toits aux arêtes des feuilles (bit de poids faible), bit d'usage « lieu de travail », effacement du détail selon l'empreinte du pixel et moyenne des fenêtres au loin — commit cc754242, fiche [Q3.md](docs/progress/refraction-horizons/Q3.md).
- **Preuves :** mesuré sur kerr-mini (A/B nuit à 300 m, jour à 450 m) : ville lointaine éclairée la nuit, murs lointains un peu plus sombres de jour ; coût +2 à 3 % au matériau raster (deux mesures) ; vérifié statiquement : 71/71 shaders, budgets, tests (dont un test des côtés aveugles).
- **Limites / transitions restantes :** le coût n'est pas compensé ; la médiane de l'orthophoto par toit (C0-11) et la date de construction restent.
- **Suite :** T8 (le chargement, contrat C0-4 : fenêtres d'imagerie à 8 tuiles indépendantes du relief) ou Q6 (reconstruction).

### 2026-11-03 09:52 UTC — T8a : décodage des tuiles en worker

- **Contribution à la destination :** §7.6 / §19.7 (données préparées hors de l'image), §8.3 (fil principal non bloqué à l'arrivée des données), observabilité CPU.
- **Réalisé :** `tile-decode.ts` (fonctions pures, sans allocation par pixel) et `tile-decode-worker.js` ; `earthTiles.cpu` ; e2e `tile-cpu` — commit edf215a7, fiche [T8.md](docs/progress/refraction-horizons/T8.md).
- **Preuves :** mesuré sur kerr-mini (A/B, 25 s de vol bas sur Paris) : décodage + couleurs 0 ms sur le fil de la page (≈ 1,25 s avant), +6 % d'images ; vérifié statiquement (typage, tests d'équivalence des couleurs).
- **Limites / transitions restantes :** `put` encore sur le fil principal (~280 ms/25 s) ; 1–2 longues tâches par vol d'une autre origine ; le reste de T8 (priorités, files, validité par tuile, fenêtres d'imagerie à 8 tuiles).
- **Suite :** identifier la cause des longues tâches restantes (profil du fil principal pendant le vol) ; reste de T8.

### 2026-11-03 10:03 UTC — T8b : spécialisation WGSL des variantes en worker

- **Contribution à la destination :** §8.3 (aucune compilation bloquante en vol), C0-13 (budget de compilation), §7.12 (bibliothèque WGSL et compilation).
- **Réalisé :** `wgsl-specialise-worker.js` ; `mkVariant` asynchrone sur la source spécialisée ; `renderer.specialiseCpu` ; profil CPU attribué aux longues tâches dans l'e2e `tile-cpu` — commit 9b215995, fiche [T8.md](docs/progress/refraction-horizons/T8.md).
- **Preuves :** mesuré sur ce Mac en headless (pression thermique « Heavy » : temps à prendre avec prudence) : temps de longues tâches en vol −37 %, un passage profilé sans aucune ; jusqu'à 174 ms par variante retirés du fil de la page.
- **Limites / transitions restantes :** longues tâches restantes dues à la simulation du vol et à `writeParams` ; la compilation GPU elle-même reste celle du navigateur.
- **Suite :** profiler la simulation (`step`, hauteurs sous le train) et `writeParams` dans les longues tâches.

### 2026-11-03 10:26 UTC — T8c : le budget CPU de la boucle principale mesuré, trois recalculs retirés

- **Contribution à la destination :** §8.3 (budget CPU par image en distribution, ~4 ms visés au 95ᵉ centile), §8 « régularité » (la pire itération), §7 (une responsabilité calculée une fois par instant et partagée par ses lecteurs).
- **Réalisé :** `game.perf().loopCpu` (p50/p95/p99/pire) et profil brut dans l'e2e `tile-cpu` — commit 871e1b8f ; `runwayGrade` limité aux pistes proches, `ellOfR` et les sphères d'influence gardés par instant/éphéméride, la position de l'indicateur de chargement lue dans un `ResizeObserver` — fiche [T8.md](docs/progress/refraction-horizons/T8.md) (section T8c).
- **Preuves :** vérifié statiquement (typage, 71 tests dont la parité de `runwayGrade` sur 8 000 points) ; profil mesuré sur ce Mac : `runwayGrade` 1 313 → 40 ms et `ellOfR` 1 405 → 33 ms sur 25 s, boucle 15,9 → 12,7 s ; A/B sur ce Mac en headless **sous pression thermique « Heavy »** : pire itération 24–30 → 12–15 ms dans tous les passages B, p95 ≈ 7,6 → 7,2 ms à tuiles comparables (−5 %, dans le bruit). Trois passages B à tuiles peu chargées (serveur froid) écartés.
- **Limites / transitions restantes :** cible de 4 ms au p95 non atteinte (≈ 7 ms) ; pas de mesure sur une machine froide ; restent l'encodage du rendu, le HUD canvas, `sceneBodies`, `sfFrame` refait ~10 fois par image, `put` des tuiles.
- **Suite :** le repère de l'appareil calculé une fois par pas de simulation et partagé par ses lecteurs ; le reste de T8 (priorités, fenêtres d'imagerie à 8 tuiles).

### 2026-11-03 13:03 UTC — T8d : le repère de l'appareil et ses voisins plus recalculés par chaque lecteur

- **Contribution à la destination :** §8.3 (budget CPU par image), §7 « une responsabilité commune avant plusieurs lecteurs » (la simulation répond une fois par point et instant ; les lecteurs partagent la réponse, figée), régularité (une mise en page forcée par image retirée).
- **Réalisé :** `gravityHome` sans vitesse (4 dernières réponses), `mouthAccel` (dernier instant), `mouth()` (mêmes réglages et instant, résultat figé) gardés ; `escapeRadius` sans notre côté du système ; le guidage au roulage de l'A320 ne lit la boîte du canvas et `geoNow` que lorsqu'il s'affiche — commit bd6e6e9c, fiche [T8.md](docs/progress/refraction-horizons/T8.md) (section T8d).
- **Preuves :** vérifié statiquement (typage, `tests/frame-memo.test.ts` : mêmes nombres que le calcul neuf ; 178 unitaires ciblés ; e2e `wormhole-map` 3/3) ; profil mesuré sur ce Mac (bundle de développement) : `sfFrame` 856 → 396 ms, `mouth` 329 → 42 ms, `getBoundingClientRect` 304 → 23 ms, ≈ 1,2 s de moins sur 25 s pour les fonctions visées ; A/B A B B A sur ce Mac, thermique Nominal : p95 de la boucle 4,5 (B) contre 4,7–5,1 ms (A), **non démontré** (tuiles chargées de 38 à 420 selon les passages).
- **Limites / transitions restantes :** `gearHeight` sous `sfFrame` toujours recalculé (pas de révision du sol pour le garder exactement) ; `sceneBodies` du rendu, le HUD canvas, l'encodage ; pas de mesure à tuiles égales ; cible de 4 ms au p95 proche (≈ 4,5–5 ms machine froide), non atteinte.
- **Complément (13:25 UTC, commit 6cb449a8) :** `TC_CHROME_PROFILE` dans l'e2e `tile-cpu` (le cache HTTP d'un profil Chrome commun sert les mêmes tuiles à chaque passage) ; second A/B à cache chaud : p95 5,2–5,9 (B) contre 8,0 ms (A, passage le plus chaud) à tuiles égales — tendance seulement, la machine passée en Heavy.
- **Complément (13:55 UTC) :** A/B à cache chaud, pression Nominal tout du long, tuiles égales (472–480) : médiane 3,8/3,9 → 3,5/3,6 ms, p95 4,9/5,0 → 4,6/4,7 ms — **gain mesuré ≈ −0,3 ms (−6 %)** ; cible de 4 ms au p95 non atteinte.
- **Suite :** puis le HUD canvas (textes contournés) ou une révision du sol publiée par le monde (C0) pour partager `gearHeight`.

### 2026-11-03 17:25 UTC — T8e : les orthophotos z 15–16 en fenêtres de 8 tuiles

- **Contribution à la destination :** §19.7 / C0-4 (la couverture photographique utile plus loin devant, sans liaison GPU de plus), §8 (mémoire bornée et comptée par portée), outillage de preuve (A/B indépendants du réseau du jour).
- **Réalisé :** z 15–16 en fenêtres de 8 tuiles aux portées lointaines (6,5 et 3,3 km), dans les dernières couches de la texture 2048² ; côté de fenêtre dans la table des orthos ; zones hors ligne alignées ; `OF_CHROME_PROFILE` dans l'e2e `ortho-filter` — commit aa2aa929, fiche [T8.md](docs/progress/refraction-horizons/T8.md) (section T8e).
- **Preuves :** vérifié statiquement (typage, 100 unitaires) ; mesuré sur ce Mac (A/B à cache chaud, pression Heavy) : aucun coût GPU mesurable au matériau raster ; ~~netteté du sol lointain +6 %~~ **corrigé à 18:05 UTC : artefact** (B multiplié par 1,06 pour ramener l'exposition, son laplacien aussi) — l'exposition réglée avant capture, B identique à A dans cette vue (aucun gain visible mesuré) ; mémoire +45 Mo GPU (calculée, 89 → 134 Mo).
- **Limites / transitions restantes :** gain modeste dans la vue de Paris (bâtiments) ; l'exposition des e2e figés mesurée avant la fin du chargement (B 6 % plus sombre en entier) — à stabiliser avant capture ; le budget mémoire de T10 (~200 Mo rendus) en reprend 45 ; l'IGN a répondu par à-coups toute la soirée (deux campagnes échouées des deux côtés).
- **Suite :** une vue de campagne pour la preuve visuelle ; attendre l'exposition stable dans les e2e figés ; la priorité des tuiles par aire visible et erreur projetée (T8).

### 2026-11-03 19:00 UTC — T8f/T8g : exposition des captures figées réglée ; fenêtres d'ortho de 8 tuiles désactivées sur mesure

- **Contribution à la destination :** §8 (mémoire : 45 Mo GPU rendus, aucune requête réseau sans effet), outillage de preuve (captures A/B comparables : l'exposition à sa lecture ; vues paramétrables), principe « aucun gain sans mesure ».
- **Réalisé :** `renderer.settleExposure()`, `exposureGap`, `app.exposureSettled()` ; `ortho-filter` : exposition réglée avant capture, `OF_AT`/`OF_PITCHES`/`OF_ORTHO_Z` — commit 3812dfa9 ; `ORTHO_BIG_LEVELS = 0` — commit 97015f43 ; fiche [T8.md](docs/progress/refraction-horizons/T8.md) (T8f, T8g).
- **Preuves :** mesuré sur ce Mac : l'exposition réglée, le ciel de B 112,8 → 119,6 (A 119,7) ; T8e ne change l'image de façon mesurable ni à 450 m ni à 2 000 m (écart A/B = écart B/B, netteté identique) ; la correction d'un « +6 % de netteté » publié à tort (artefact de normalisation) ; 100 unitaires, `ortho-filter` identique à A après désactivation.
- **Limites / transitions restantes :** la décision de garder ou non les fenêtres de 8 tuiles revient à Sam (le plan les demandait) ; l'IGN a répondu par à-coups toute la soirée ; les mesures sous pression thermique Heavy.
- **Suite :** la priorité des tuiles par aire visible et erreur projetée (T8) ; `exposureSettled` dans les autres e2e de captures figées.

### 2026-11-03 21:10 UTC — T8h : la priorité des tuiles par complétude des fenêtres ; un rejeu des tuiles pour les A/B

- **Contribution à la destination :** §19.7 / C0-4 et l'objectif de T8 (« le temps jusqu'à une qualité visible définie divisé par 2 à 5 ») ; §8 (preuves reproductibles : un réseau constant pour les A/B de chargement).
- **Réalisé :** `EarthTiles.request` : le niveau le plus près d'avoir sa fenêtre entière d'abord, à égalité le plus fin ; `tests/e2e/tile-arrival.e2e.test.ts` et `tests/e2e/lib/tile-replay.ts` (réponses gardées sur disque, rejouées à latence fixe par le domaine Fetch) — commit ca0132cd, fiche [T8.md](docs/progress/refraction-horizons/T8.md) (T8h).
- **Preuves :** mesuré sur ce Mac (rejeu, A/B A B B A contre 97015f43) : à 1 000 ms, z 14 dessiné 49 → 26 s, relief IGN entier 51 → 8,7 s, moyenne des niveaux 42,8 → 24,6 s ; à 300 ms, z 14 18 → 9 s, IGN 19 → 3,7 s ; dernier niveau inchangé (volume identique). Vol `tile-cpu` (cache chaud, A/B) sans régression visible (tuiles, longues tâches). 25 unitaires.
- **Limites / transitions restantes :** mesuré à l'arrêt (figé) sur l'Aubrac, en rejeu sans limite de débit ; le cache chaud du Service Worker et un vol en mouvement non mesurés pour ce changement ; la priorité ignore encore l'aire visible et l'erreur projetée ; la validité par tuile (fenêtre partielle) reste.
- **Suite :** dessiner une fenêtre partielle (validité par tuile, C0-4) — le niveau visible avant d'être entier ; ou `put` hors du fil de la page.

### 2026-11-03 22:05 UTC — T8i : une fenêtre de relief dessinée avant d'être entière

- **Contribution à la destination :** C0-4 (« la validité par tuile », ici réduite à un rectangle), §19.7 (le sol visible plus tôt à chaque arrivée).
- **Réalisé :** `EarthTiles.complete`/`loadedRect` : le plus grand rectangle de tuiles arrivées autour de la caméra dessiné avant l'entier ; `tile-arrival` relève `firstAt` — commit 0061946e, fiche [T8.md](docs/progress/refraction-horizons/T8.md) (T8i).
- **Preuves :** mesuré sur ce Mac (rejeu à 1 000 ms, A/B contre T8h) : z 14 commencé 26 → 17,7 s, z 11 50 → 42 s, moyenne des niveaux commencés 24,6 → 19,9 s ; vol `tile-cpu` (cache chaud, A/B, Heavy) sans surcoût mesurable ; 22 unitaires.
- **Limites / transitions restantes :** un rectangle, pas un masque par tuile ; l'ordre de T8h (un niveau après l'autre) à réexaminer avec des fenêtres partielles ; pas de mesure de la qualité à l'écran (part des pixels du sol au niveau voulu).
- **Suite :** une mesure de qualité à l'écran pour arbitrer l'ordre des tuiles ; `put` hors du fil de la page.

### 2026-11-03 23:20 UTC — T8j : l'ordre des tuiles jugé sur la qualité de la vue

- **Contribution à la destination :** l'objectif de T8 (§19.7, C0-4 : le temps jusqu'à une qualité visible définie) mesuré à l'écran et non plus par niveaux ; décision de Sam consignée (T8e désactivé).
- **Réalisé :** `tile-arrival` mesure la qualité de la vue (384 rayons, niveau voulu contre dessiné) ; `EarthTiles.request` : niveaux nationaux entiers d'abord, puis anneaux autour du centre des chargements, le plus fin d'abord ; `loadedRect` part du même centre — commit 8e49ac33, fiche [T8.md](docs/progress/refraction-horizons/T8.md) (T8j).
- **Preuves :** mesuré sur ce Mac (rejeu à 1 000 ms, A/B contre T8i) : vue à 90 % 26 → 8,1 s, à 99 % 34 → 11,2 s, qualité moyenne sur 30 s 0,76 → 0,86 ; relief IGN entier inchangé (8 s) ; un vol `tile-cpu` sans écart notable ; 22 unitaires.
- **Limites / transitions restantes :** la mesure ignore la source des hauteurs et l'imagerie ; vue figée ; Service Worker chaud et vol en mouvement non mesurés pour ce changement ; `put` sur le fil principal.
- **Suite :** clore T8 (fiche de synthèse) et passer à Q6 (reconstruction temporelle), comme convenu avec Sam.

### 2026-11-04 00:30 UTC — T8 clos ; Q6a : la mesure de l'image en mouvement

- **Contribution à la destination :** T8 refermé (synthèse en tête de [T8.md](docs/progress/refraction-horizons/T8.md)) ; Q6 / §19 (« la netteté en déplacement mesurée au premier instant et après accumulation ») : un juge reproductible avant de toucher à la reconstruction.
- **Réalisé :** `tests/e2e/motion-quality.e2e.test.ts` (simulation avancée d'un pas fixe par image, état de départ sauvegardé, référence propre à chaque mode, PSNR et netteté dans la verrière, HUD coupé) ; `raster-motion` : `RM_OUT`, mode `native100q` — commit 0b5c65f4, fiche [Q6.md](docs/progress/refraction-horizons/Q6.md).
- **Preuves :** mesuré sur ce Mac (Heavy, réseau lent, références non convergées) à Tarifa : TAAU (éteint) 44,4 dB et netteté 0,95 en mouvement contre 39,6 dB et 0,74 pour le chemin par défaut, ≈ +1,8 ms ; le natif à ¼ est bruité (pas une référence). Les Alpes faussées pour un mode (tuiles en chargement).
- **Limites / transitions restantes :** un lieu propre ; aucune mesure des fantômes ni des changements de palier ; machine chaude ; la mesure d'octobre (« le TAAU ne bat pas le Catmull–Rom ») venait d'un vol en temps réel, à mouvement inégal.
- **Suite :** Q6b — le TAAU en mouvement par défaut, mesuré (netteté, coût, fantômes sur la mer et un avion) ; puis fondre l'historique natif et le TAAU en une seule reconstruction (I2).

### 2026-11-04 01:25 UTC — Q6b : le TAAU en mouvement par défaut

- **Contribution à la destination :** Q6 / I2 (la reconstruction temporelle à la taille de sortie), §8 « la même netteté à l'arrêt et en vol ».
- **Réalisé :** `renderer.taauOn = true` ; `taauWanted(t)` (l'albédo accumulé du sol coupé seulement sous le TAAU) ; `motion-quality` : lieu au-dessus de la mer, cache commun — commit 29a88b9e, fiche [Q6.md](docs/progress/refraction-horizons/Q6.md) (Q6b).
- **Preuves :** mesuré sur ce Mac (Heavy) : netteté en mouvement Tarifa 0,74 → 0,96, Alpes 0,68 → 0,92 de la référence ; mer sans fantôme, vagues rasantes 10 % plus granuleuses ; +0,6 à +4,3 ms.
- **Limites / transitions restantes :** coût mesuré sous pression thermique ; un avion traversant l'image non mesuré ; deux passes temporelles successives (native puis TAAU) au lieu d'une ; le grain des vagues rasantes.
- **Suite :** I2 — une seule reconstruction ; masque réactif de l'eau.

### 2026-11-04 03:40 UTC — Q6c : une mesure de l'image en mouvement reproductible ; la passe TAAU −10 %

- **Contribution à la destination :** §8 (preuves reproductibles, l'état d'entrée tenu), Q6 (coût de la reconstruction).
- **Réalisé :** `motion-quality` : tout chargé et compilé avant le vol, avion stable (pilote automatique réengagé jusqu'à tenir, auto-manette, train sorti, stabilisation), lieu placé après son relief, état de l'avion relevé ; `post.wgsl taau` : traction vers l'image native en une lecture bilinéaire — commit ce1fd019, fiche [Q6.md](docs/progress/refraction-horizons/Q6.md) (Q6c).
- **Preuves :** mesuré sur ce Mac (Heavy) : A/A aux vols identiques (bruit ±0,5 dB, ±0,05 de netteté) ; A/B A B B A : passe TAAU 1,65 → 1,48 ms, image inchangée dans le bruit.
- **Limites / transitions restantes :** références raffinées 90 s, non convergées ; erreur « cannot read properties of null » signalée par Sam non reproduite (smoke 17/17 sans erreur de page) — message complet attendu.
- **Suite :** le grain des vagues rasantes sous le TAAU (masque réactif de l'eau), puis I5 (exposition locale) et I6 (profil Caméra).

### 2026-11-04 05:00 UTC — Q6d : le noyau du TAAU élargi sur l'eau seule

- **Contribution à la destination :** Q6 / I2 (« des masques réactifs (reflets, émissions, eau) ») ; C0 : l'identité du matériau portée jusqu'à la reconstruction.
- **Réalisé :** la marque raster porte l'eau (`rasterMark(a, eau)`, `liteFinish(…, water)`), la passe `taau` prend σ 0,7 sur l'eau, 0,5 ailleurs (`renderer.taauSigmaWater`) — commit 4bcfa5b7, fiche [Q6.md](docs/progress/refraction-horizons/Q6.md) (Q6d).
- **Preuves :** mesuré sur ce Mac : mer lointaine netteté 1,25 → 1,15 de la référence en mouvement, terre inchangée ; 114 unitaires.
- **Limites / transitions restantes :** gain partiel (σ global 0,7 : 1,05) — couverture d'eau sous la moitié et pixels rebâtis non marqués ; références non convergées (PSNR peu fiable entre runs).
- **Suite :** I5 — l'exposition locale bornée.

### 2026-11-04 05:30 UTC — Q6e : l'exposition locale mesurée, pas de besoin établi ; I7 bloqué par la mesure headless

- **Contribution à la destination :** Q6 (I5) décidé sur mesure plutôt que construit par principe.
- **Réalisé :** captures et mesures (cockpit de jour, contre-jour en vue extérieure) ; note Q6e — commit c42b4e09, fiche [Q6.md](docs/progress/refraction-horizons/Q6.md).
- **Preuves :** cockpit 40–46/255 contre 103–117 dehors, rien d'écrasé ; contre-jour : sol 21/255, 0,1 % sous 12.
- **Limites / transitions restantes :** le cockpit à contre-jour non capturé ; I7 (cadence réglée sur la présentation) demande un écran réel — le headless n'a pas de vsync : à faire sur un écran (kerr-mini plein écran ou une fenêtre ici), décision de Sam.
- **Suite :** selon Sam — I7 sur écran réel, ou I6 (profil Caméra), ou I3.

### 2026-11-04 06:10 UTC — Correctif : le plantage signalé par Sam (T8i)

- **Contribution à la destination :** stabilité (« préserver toute l'expérience ») ; un défaut introduit par T8i, corrigé avec un test qui le reproduit.
- **Réalisé :** `heightAt` borne ses lectures au rectangle valide (le cubique dépassait d'un texel dans une case vide) — commit b8c27bcf ; note dans [T8.md](docs/progress/refraction-horizons/T8.md).
- **Preuves :** test de non-régression : 222 erreurs sur 1 224 lectures avant, 0 après ; vol bas pendant le chargement sans erreur de page.
- **Limites / transitions restantes :** la mesure I7 (plafond d'images compté en rafraîchissements) reste à refaire machine froide — son A/B était faussé (thermique Heavy, machine chargée) ; changement retiré de l'arbre en attendant. Correction à faire dans les fiches : les e2e de cette session tournaient en fenêtre (config de ce Mac), pas en headless.

### 2026-11-04 07:00 UTC — Q6f : la cadence (I7) mesurée sur écran

- **Contribution à la destination :** §8 (« distinguer rAF, soumissions, complétions GPU et présentation » ; la régularité), Q6 I7.
- **Réalisé :** `tests/e2e/cadence.e2e.test.ts` (en fenêtre) ; le plafond d'images compté en rafraîchissements entiers (`main.ts`) — commit 5cff7703, fiche [Q6.md](docs/progress/refraction-horizons/Q6.md) (Q6f).
- **Preuves :** kerr-mini plein écran, A/B A B B A : neutre (50 Hz, GPU à ~24 images/s, plafond rarement en prise) ; ce Mac à 120 Hz, mesures isolées : plafond 60 régularité 0,585 → 0,826. Calage automatique sur l'écran écarté sur A/B (pas plus régulier, 31–33 images/s).
- **Limites / transitions restantes :** pas d'A/B propre à 120 Hz ; la présentation mesurée par l'achèvement GPU, pas par l'affichage.
- **Suite :** I6 — le profil Caméra (décision 32).

### 2026-11-04 07:45 UTC — Q6g : le profil Caméra et le profil Neutre (première tranche)

- **Contribution à la destination :** Q6 I6 / décision 32 (l'image du jeu en vol comme une caméra la filme ; la physique intacte au Labo), §19 (l'expérience complète).
- **Réalisé :** `lookProfile` (auto / camera / neutral), `display.wgsl cameraLook` (étalonnage discret, grain, vignette), `renderer.flightView`, réglage et aide FR + EN, e2e `look-profile` — commit 33c31159, fiche [Q6.md](docs/progress/refraction-horizons/Q6.md) (Q6g).
- **Preuves :** mesuré (headless) : luminance −3 %, coins −7,6 %, centre +0,9 % ; `auto` = Caméra en vol ; tests réglages et i18n verts.
- **Limites / transitions restantes :** forme paramétrique, pas encore ajustée sur des vidéos de référence ; A2 (aberration, verrière), A3 (exposition qui respire), A4 (flou de pose), I8 (mode GoPro) restent.
- **Suite :** I6 suite (exposition qui respire, aberration) ou I8 (GoPro).

### 2026-11-04 08:20 UTC — Q6h, Q6i : l'exposition qui respire et l'aberration du profil Caméra

- **Contribution à la destination :** Q6 I6 (A2, A3), décision 32 (2).
- **Réalisé :** Q6h `readMeter` (un tiers d'un posemètre de caméra, ±0,5 EV, Caméra seul) — commit 3f9aa011 ; Q6i aberration latérale dans `display.wgsl` ; fiche [Q6.md](docs/progress/refraction-horizons/Q6.md).
- **Preuves :** `look-profile` (headless) : sol contre ciel −0,38 EV en Caméra, 0 en Neutre ; aucune erreur GPU.
- **Limites / transitions restantes :** la respiration non mesurée dans le temps ; la frange non mesurée ; rayures de verrière, flou de pose, GoPro, LUT ajustée restent.
- **Suite :** I8 — le mode GoPro hors cockpit.
- **Point d'étape Q6 (08:30 UTC)** : faits — Q6a mesure reproductible, Q6b TAAU par défaut (netteté en mouvement ~0,7 → ~0,94),
  Q6c passe TAAU −10 %, Q6d eau, Q6e exposition locale (pas de besoin), Q6f cadence, Q6g profil Caméra/Neutre, Q6h exposition qui
  respire, Q6i aberration ; restent I3 (objets mobiles), I8 (GoPro : un choix coût/netteté du centre à faire par Sam), A4 (flou de
  pose : défaut à décider), la LUT ajustée sur des vidéos de référence (vidéos à choisir), les rayures de verrière, I4 complet.

### 2026-11-04 00:19 UTC — Plan Q6-ISS : caméras NASA et Sen, poses et calibration sur vidéo

- **Contribution à la destination :** Q6 (image et optique), §19.6 (caméra), §20 (contrats de vue réutilisables) ; demande de Sam, avec confirmation que « zen » désigne Sen / SpaceTV-1.
- **Réalisé :** volet Q6-ISS ajouté au [plan actif](docs/PLAN-REFRACTION-HORIZONS.md) : vues NASA identifiées et trois caméras Sen ; lots ISS0–ISS5 pour corpus, supports/POV, calibration géométrique, réponse d'image, accès commun avec TARS et acceptation ; raccord dans l'ordre du plan et décision 39.
- **Preuves :** lecture du code existant (`issAxes`, `subjectcam`, `stationCam`), des plans et des sources primaires NASA/JSC et Sen ; relecture du diff et vérification des espaces par `git diff --check`. Les sources et leurs limites sont dans le volet. Aucun jeu, test, e2e, benchmark, build, téléchargement vidéo ni calibration effectué.
- **Limites / transitions restantes :** documentaire uniquement ; aucun nouveau préréglage implémenté. Poses métriques, attitude réelle, champs et réponses caméra restent à établir sur un corpus horodaté ; les vidéos n'ont pas été analysées image par image. Les URL de live peuvent changer et les paramètres inconnus ne sont pas remplacés par des valeurs arbitraires.
- **Suite :** ISS0 (corpus et séquences de contrôle), puis attaches et calibration géométrique ISS1–ISS2 ; préserver le socle temporel de Q6 et affiner avec Q5/R.


### 2026-11-04 09:40 UTC — Q6j, Q6k : le mode GoPro ; l'étalonnage Caméra ajusté sur deux références

- **Contribution à la destination :** Q6 I8 et I6 A1 (décisions 32, 38) ; l'expérience complète (replay, vues extérieures).
- **Réalisé :** Q6j — `cameraLens` GoPro (`src/lens.ts`, `display.wgsl`, rendu 104,6° × 1,2, bandeau 2,39:1, HUD masqué), e2e `gopro`, `tests/lens.test.ts` — commit 4d0e4e71 ; Q6k — l'étalonnage Caméra ajusté à mi-chemin sur le Typhoon RAF (OGL v3) et le F-35A USAF (domaine public), retenus par Sam — commit 25601440 ; fiches [Q6.md](docs/progress/refraction-horizons/Q6.md), [Q6-references-LUT.md](docs/progress/refraction-horizons/Q6-references-LUT.md).
- **Preuves :** GoPro : marges noires, HUD masqué, coût 0,94–1,14 × (deux passages) ; étalonnage rejoué sur nos images : saturation des ombres 0,093 → 0,066, du ciel 0,243 → 0,175, 99e centile 0,763 → 0,789.
- **Limites / transitions restantes :** HUD minimal du GoPro, rendu limité au bandeau, sélection au pointeur courbée ; une LUT 3D seulement si la forme paramétrique ne suffit pas ; I3 (objets mobiles) ; I4 complet.
- **Suite :** I3, ou la synthèse de Q6.

## 2026-11-04T01:46Z — Q6l : I3, les objets mobiles et l'historique ; l'ombre de l'appareil au sol raster

- **Contribution à la destination :** Q6 I3 (§8 stabilité en mouvement, §7 un modèle de lumière partagé entre le sol tracé et le sol raster) ; l'expérience complète (l'ombre de l'appareil au décollage, en vol bas, à l'atterrissage).
- **Réalisé :** `liteSun` (trace.wgsl) lit la carte d'ombre de l'appareil — elle manquait au sol et à l'eau du pipeline raster, le défaut sur Terre ; `liteSkip` 2097152 ; nouvel e2e `ghost` (monde entier chargé avant chaque mesure, carte des arbres instrumentée) — commit d5619f0a.
- **Preuves (observé/mesuré, ce Mac headless, chaleur Heavy pour les temps) :** l'ombre au même endroit que sur le sol tracé ; aucune traînée derrière elle ni sur la mer (détroit TAAU 40,5 dB, 296 pixels plus sombres ; La Mancha 53) ; les appareils hors de l'historique par construction (lu dans le code). Coût de la lecture non mesuré (dans le bruit sous Heavy).
- **Limites / transitions restantes :** des ombres d'arbres sans arbre en vol sur La Mancha, dans tous les modes (pas l'historique), cause non trouvée ; les nuages dans leur propre historique non mesurés.
- **Suite :** l'enquête sur les ombres sans arbre (carte des arbres et bâtiments), puis la synthèse de Q6.

## 2026-11-04T02:09Z — Q6m : les ombres en peigne au sol en vol (cascades du relief en retard sur les maillages)

- **Contribution à la destination :** §8 stabilité en mouvement et qualité effective ; §7 « une responsabilité commune » — la carte d'ombre du relief dessinée depuis la même géométrie que l'image.
- **Réalisé :** la clé de redessin des cascades du relief (T6, `renderer.sunRevision`) porte les fenêtres du patch et des anneaux ; correction de l'attribution de Q6l (pas les arbres) — commit 7b0fcbd6.
- **Preuves (mesuré, ce Mac headless, Heavy) :** e2e `ghost`, La Mancha, décor complet : taches 0 série sur 6 après, 2 sur 3 en contre-épreuve (`sunWindowsInKey` false), 5 sur 6 avant ; la vue de débogage du décor blanche à leur place ; tests terrain/raster verts.
- **Limites / transitions restantes :** ~+0,05 ms par image estimé (comptes × coût du redessin), non mesuré à froid ni sur kerr-mini ; recuits des hauteurs toujours limités à deux par seconde.
- **Suite :** la synthèse de Q6 ; ce qui reste de Q6 (HUD minimal GoPro, rendu limité au bandeau, sélection courbée, rayures de verrière, option de flou de pose, I4 complet).

## 2026-11-04T02:44Z — Q6n–Q6t : recuits, nuages, flou de pose, GoPro complet, rayures de verrière

- **Contribution à la destination :** §8 stabilité en mouvement et qualité effective ; §19 l'expérience complète (replay/vidéo, vues extérieures, cockpit en caméra) ; décisions 32 et 38.
- **Réalisé :** Q6n les cascades du relief suivent chaque recuit (7473c751) ; Q6o les nuages mesurés, rien à corriger (669a3690) ; la route du sol tracé absente du raster = Q3 B4 (noté) ; Q6p le flou de pose à temps de pose fixe, désactivé par défaut (1cde8beb) ; Q6q le HUD minimal GoPro (a5033d39) ; Q6r le GoPro ne rend que les rangées du bandeau (330f4b5a) ; Q6s la sélection à travers l'objectif (3e5395cd) ; Q6t les rayures de verrière (326a7b00).
- **Preuves (mesuré/observé, ce Mac headless) :** taches de relief 0/5 contre 2/5 (recuits) ; nuages à 1–3 px de leur place en ligne droite et en virage ; flou : netteté 464 → 302 (60 im/s) / 251 (30 im/s) ; GoPro −24 % de pixels à image identique, un passage à 1,03 × ; rayures +0,69 niveau autour du Soleil, rien en Neutre. Nouveaux e2e : motion-blur, canopy-scratches ; ghost étendu (clouds, TURN).
- **Limites / transitions restantes :** coûts du GoPro et des rayures non mesurés en A/B ; la sélection courbée non vérifiée en e2e ; un damier relevé avec le flou actif ; Q3 B4 (routes raster) au plan.
- **Suite :** I4 complet, la synthèse de Q6, puis Q6-ISS et la suite du plan.

### 2026-11-04 03:06 UTC — Arbitrage de qualité : rayures Q6t rouvertes, AAA utile ou retrait

- **Contribution à la destination :** Q6 I6 A2, qualité effective et lisibilité du cockpit ; distinguer une activation technique d'un bénéfice photoréaliste accepté (§19/§20).
- **Réalisé :** retour de Sam inscrit dans le [plan actif](docs/PLAN-REFRACTION-HORIZONS.md), volet Q6t et décision 40 : version AAA sur références et en mouvement, sans gêne ni coût injustifié, sinon retrait ; désactivation par défaut prévue tant que la qualité n'est pas établie. Synthèse et historique Q6t annotés dans [Q6.md](docs/progress/refraction-horizons/Q6.md), sans effacer les mesures antérieures.
- **Preuves :** lecture des commits Q6k–Q6t et ISS0, des fiches et de `canopyScratches` (traits en coordonnées de sortie, cellules de 26 px, modulation par bloom) ; relecture statique et `git diff --check`. Le constat de manque de réalisme est le retour explicite de Sam ; aucune nouvelle mesure ni campagne de comparaison.
- **Limites / transitions restantes :** documentation uniquement : le runtime et `renderer.canopyScratches` ne sont pas modifiés ; aucune désactivation, amélioration ou suppression de l'effet n'est revendiquée. Aucun jeu, test, e2e, build ou benchmark lancé. Le rendu HTML de suivi distingue désormais réalisé, accepté et encore à prouver.
- **Suite :** appliquer l'arbitrage au prochain lot Q6t ; partir du témoin sans rayures, ne conserver qu'un candidat apportant un bénéfice établi, sinon supprimer les ressources et le code devenus inutiles. Préserver I4 et le corpus ISS en cours.
- **Réactualisation documentaire :** le volet Q6-ISS du plan indique désormais ISS0 commencé, la fiche existante et le lien NASA relevé par ISS0 (`ROboUHfPUrU`) ; les objectifs HDEV documentés et leurs champs dérivés restent distincts d'une calibration. Lecture arrêtée à `df7a6133`, sans vérifier l'activité ou la fin de la collecte annoncée.

## 2026-11-04T03:58Z — Q6u (I4 complet), rayures sur le verre (prototype), Q6-ISS ISS0

- **Contribution à la destination :** §8 (qualité effective contre coût, aucune impulsion de flou aux paliers) ; décision 40 (rayures : AAA démontré ou retrait) ; décision 39 (caméras ISS).
- **Réalisé :** Q6u — l'échelle en mouvement tenue à 75 % sur mesure (b111e952) ; motion-quality et ghost au profil Neutre. Rayures : l'essai d'écran désactivé, un prototype physique sur le verre (ship.wgsl canopyScratchLight, désactivé par défaut, 80007086) ; l'analyse (Q6.md). ISS0 : sources revérifiées, HDEV, archives Sen, l'UTC incrusté du direct, scripts/iss-capture.ts (3a7b9bcc, df7a6133).
- **Preuves (mesuré, kerr-mini au frais) :** 62,5 % : GPU −20 à 24 %, Alpes −5,1 dB, Tarifa netteté 0,87 ; 50 % pire. Deux campagnes écartées et dites (rayures actives, grain Caméra). Rayures : observées sur le verre en arcs autour du Soleil ; coût dans le bruit, mouvement et références non établis.
- **Limites / transitions restantes :** la porte des rayures à Sam ; ISS0 à finir (caméra de chaque image, extraits), ISS1–ISS5 ; 60 images/s : à chercher dans le coût des passes, pas l'échelle.
- **Suite :** la suite du plan après Q6 (selon l'ordre du plan), ISS0 à la fin de la capture.

## 2026-11-04T04:53Z — Q4 L2b : la part du ciel des vallées (désactivée, compilée hors des noyaux) ; H5 justesse non concluante

- **Contribution à la destination :** §7 (un modèle de lumière commun : le ciel du sol raster tiré des horizons partagés) ; §8 (le budget des noyaux tenu, aucun gain non mesuré).
- **Réalisé :** earthSkyOpen (ef7a9139) — désactivée par défaut et compilée hors des noyaux (EARTH_SKY_OPEN) ; earth-horizons-truth (29cca5d1) et sky-open (nouveaux e2e).
- **Preuves (mesuré, ce Mac) :** l'image avec/sans dans le bruit (Valais 0,9997–1,0067, plaine 0,9985) pour +0,3–1,25 ms ; deux erreurs trouvées en route (le double compte des pentes ; une dérive de 4 % prise pour un effet) ; H5 contre le traceur : non concluant (le tracé n'est pas une vérité).
- **Limites / transitions restantes :** le damier des versants (plan de la face à l'échelle des nœuds) ; L2a (GTAO) pour l'occlusion proche ; une référence de vérité pour H5 (photo ou calcul MNT hors du jeu).
- **Suite :** Q4 — L2a (GTAO) ou S1 (le décor dans les cascades), selon le plan.

## 2026-11-04T05:33Z — Q4 L2a : le GTAO avant l'ombrage (fondation, désactivé) ; placeLow pour des e2e fiables

- **Contribution à la destination :** §7 (le socle : une occlusion sur la profondeur finale exploitable, le contrat C0-9 amendé — décision 41) ; la qualité des preuves (des e2e qui ne mesurent plus un avion retourné).
- **Réalisé :** system/gtao.ts, rasterAO dans shadeLite, la liaison gardée selon l'appareil ; tests/e2e/lib/place.ts placeLow ; gtao (nouvel e2e) — 4cb4de5c.
- **Preuves (mesuré, ce Mac en fenêtre) :** l'avion à plat (< 0,5°) à sa hauteur ; l'image avec/sans 0,996–1,003 (dans le bruit, ciel couvert compris) ; la passe 0,6–1,3 ms ; halos aux silhouettes observés.
- **Limites / transitions restantes :** halos, vue au sol à mesurer, coût ; désactivé par défaut.
- **Suite :** Q4 : S1 (le décor dans les cascades) ou L4 (le spéculaire des matériaux connus).

## 2026-11-04T05:51Z — Q4 S1 (les ombres de la ville au loin) ; le scintillement mesuré image par image

- **Contribution à la destination :** §7 (le décor dans les ombres communes du relief) ; §8 et C0-12 (stabilité de l'image, mesurée image par image).
- **Réalisé :** S1 — les bâtiments dans les cascades (a5a543dc), une erreur GPU de pipeline corrigée (vue par Sam) ; city-shadows et city-flicker (nouveaux e2e, en fenêtre).
- **Preuves (mesuré, ce Mac) :** la ville à 1–4 km : 1,64 % de pixels assombris (bruit 0,46 %), aucune erreur GPU ; à l'arrêt, scintillement 1,95 % (C0-12 : 1 %) identique avec et sans S1 ; en vol, aucun pic aux redessins.
- **Limites / transitions restantes :** le coût amorti de S1 en vol ; le scintillement figé de base au-dessus de C0-12 (converger à l'arrêt) ; GTAO et L2b désactivés.
- **Suite :** le scintillement figé (le raster qui converge à l'arrêt), puis L4.

## 2026-11-04T06:03Z — le scintillement à l'arrêt sous 1 % (C0-12)

- **Contribution à la destination :** §8 stabilité de l'image (C0-12 : ≤ 1 % sur 30 images figées) tenue sans compilation de plus.
- **Réalisé :** l'historique du raster tenu (caméra immobile, horloge arrêtée) moyenne ~48 images — ea44199e ; city-flicker note la phase du rendu.
- **Preuves (mesuré, ce Mac en fenêtre, pause) :** écart image à image 2,0 → 0,34 niveau ; écart-type relatif 1,7 % → 0,48 % ; à l'œil la même image.
- **Limites / transitions restantes :** la caméra immobile mais l'horloge qui avance (un vol stationnaire, une scène qui vit) garde le tiers et son bruit ; à mesurer à pied et au roulage (les autres lignes de C0-12).
- **Suite :** Q4 L4 (le spéculaire des matériaux connus) ou les restes mesurés de Q4.

## 2026-11-04T06:12Z — Q4 L4 : le spéculaire des matériaux connus (premier jet, désactivé)

- **Contribution à la destination :** §7 (matériaux explicites : le spéculaire là où le matériau est connu, l'inconnu mat — C0-11).
- **Réalisé :** GGX dans shadeLite (piste, classes WorldCover), renderer.groundSpecular faux par défaut ; l4-specular (nouvel e2e) — 1bcd54b4.
- **Preuves (mesuré, ce Mac en fenêtre) :** face au Soleil couchant, Roissy × 1,6–1,8, la Beauce × 1,3 ; observé : un lustre de sol mouillé sur l'aéroport sec.
- **Limites / transitions restantes :** jugement de Sam ; rugosités à régler sur des photos de référence ; la végétation (L5) ; le filtrage des normales.
- **Suite :** selon le jugement de Sam ; sinon les autres lots de Q4 (F1 le vent proche, C4) ou T7 (la mer).

## 2026-11-04T06:40Z — T7 la mer et ses côtes : la tournée des côtes, deux défauts corrigés, l'eau par région

- **Contribution à la destination :** §7 (le monde possède ses supports : le sursol mesuré depuis la mer, l'eau seulement à plat) ; T7 du plan (la mer, les côtes) ; §19 l'expérience (les côtes vues de près).
- **Réalisé :**
  - coast-survey (16 côtes de France et du monde depuis le cockpit), sea-pieces (le chargement filmé au-dessus de la mer), sea-repeat (la mer d'en haut) ;
  - le sursol IGN (I6) mesuré depuis la mer : les buttes « au milieu de la mer » vues par Sam venaient de la profondeur lue comme un sursol ;
  - l'eau OSM posée seulement sur un sol plat (plus de bleu sur les parois des Calanques ni d'arches au pied des falaises de Bonifacio) — ba3626f2 ;
  - en cours : l'eau par région — le Kd490 de l'ESA OC-CCI (2020–2021, 1/12°) dans la table GPU (water-kd*.ts, TABLE_WATER, seaKd490, seaWaterOf).
- **Preuves :**
  - mesuré (sonde e2e, Bonifacio) : 130 points de mer surélevés sur 2 871, jusqu'à 58 m, avant ; 0 après ;
  - observé (captures, ce Mac en fenêtre) : les falaises avant/après ;
  - vérifié (tests) : hlod (7), water-kd (le codage, et les eaux connues de la carte : Pacifique sud < 0,03 m⁻¹, Manche > 0,1, Gironde > 0,3, Rio de la Plata > 0,8), gpu-tables, budgets des kernels.
- **Limites / transitions restantes :**
  - l'eau par région ne vaut que dans le raster proche (SEA_ON) ; le tracé et le lointain gardent l'imagerie ;
  - le modèle de couleur (bbp ∝ Kd490) est un modèle, calé sur l'eau claire d'avant, à juger sur photos ;
  - restent : les marées (estrans du Mont-Saint-Michel, Wadden), les parois rocheuses étirées (imagerie verticale), l'écume au trait de côte, la répétition des vagues.
- **Suite :** mesurer l'eau par région sur la tournée (avant/après), puis l'écume du rivage et les parois.

## 2026-11-04T07:11Z — T7 : les buttes sur la mer (cause trouvée), l'eau par région livrée

- **Contribution à la destination :** §7 (une seule autorité du sol : le sursol seulement sur le sol de l'IGN) ; T7 (l'eau par région, la mer sans relief parasite) ; §18 (une donnée de référence ouverte, ESA OC-CCI, intégrée sans dépendance).
- **Réalisé :** 6d7248bd.
  - Le second passage des tuiles ne calcule plus le sursol sur la mer comblée par Terrarium (surveyOnly) : le MNS de l'IGN y est du bruit (−15 à −99 m, des traînées jusqu'à 110 m).
  - L'eau sur une pente reste de l'eau sous la mer.
  - L'eau par région : Kd490 en table GPU, seaKd490, seaWaterOf.
  - Fiche docs/progress/refraction-horizons/T7.md et planche T7/.
- **Preuves :**
  - observé (ce Mac en fenêtre) : Bonifacio et Étretat sans buttes ni plaques ; la Manche vert-gris, la baie du Mont-Saint-Michel brun-vert, les Calanques bleu profond ;
  - diagnostic : vue « types d'eau » ; sans le relief IGN, les formes disparaissent ; le sol CPU est sans butte à toutes les empreintes ;
  - tests : 96 tests unitaires verts.
- **Limites / transitions restantes :**
  - l'entrée précédente annonçait le sursol « corrigé » : il ne l'était qu'en partie (le premier passage) ; c'est le second qui faisait les buttes vues par Sam ;
  - le coût GPU de l'eau par région n'est pas mesuré ; la couleur est un modèle ;
  - restent : marées, parois rocheuses, écume du rivage, répétition des vagues, sites du monde (en cours).
- **Suite :** les 8 sites du monde, puis l'écume du trait de côte ou les parois selon ce qu'ils montrent.

## 2026-11-04T07:37Z — T7 : le fond marin seulement là où la photo le voit ; les 16 côtes passées

- **Contribution à la destination :** T7 (côtes justes sans bathymétrie fine : une preuve tirée de l'imagerie plutôt qu'une donnée grossière inventant des hauts-fonds) ; §19 (Sydney, Douvres, Mont-Saint-Michel vus de près).
- **Réalisé :** f79d64fa.
  - Le fond de sable gardé seulement là où l'imagerie a un albédo ≥ 0,05–0,12.
  - Les « lacs » OSM au niveau de la mer sur un fond marin restent la mer.
  - seaWaterOf : l'eau et les particules en deux termes.
  - Budget de Vénus +10.
  - Fiche T7.md complétée, planches planche-monde.jpg et planche-fond-photo.jpg.
- **Preuves :**
  - observé (ce Mac en fenêtre, 14 sites repris) : Sydney sans turquoise inventé, Douvres vert-gris, Waikiki gardé, chenaux du Mont-Saint-Michel visibles ;
  - diagnostic Sydney : types d'eau, sans le fond ;
  - mesuré : la bathymétrie Terrarium de la rade à 1–5 m.
  - Tests unitaires verts.
- **Limites / transitions restantes :**
  - le seuil d'albédo est un réglage, à juger ;
  - l'imagerie avec reflet solaire peut faire apparaître un fond ;
  - le coût GPU n'est pas mesuré ;
  - restent marées, parois, écume, répétition des vagues, mâts en treillis.
- **Suite :** selon Sam ; sinon l'écume du trait de côte (la ligne d'eau OSM + le relief) ou les parois rocheuses.

## 2026-11-04T07:45Z — Q3 B4 (premier jet) : les routes d'OpenStreetMap sur le sol raster

- **Contribution à la destination :** §7 (une seule lecture du décor pour le jour et la nuit ; parité du sol raster avec le sol tracé) ; Q3 B4 ; l'écart relevé en Q6l.
- **Réalisé :** sceneryGround dans shadeLite (une lecture par pixel, réutilisée par les rues éclairées la nuit) ; limitée de jour aux empreintes < 12 m et à 4 km ; raster-roads (nouvel e2e) — 963e7a00.
- **Preuves (mesuré, ce Mac en fenêtre, Moderate, prises alternées) :** passe « earth lite » 8,78–8,83 → 9,47 ms (+0,66 ms) ; sans la limite, +1,1 ms. Observé : la route de La Mancha dessinée.
- **Limites / transitions restantes :** +0,66 ms par image en vol bas : la passe de décalques de B4 doit le réduire ; non mesuré la nuit ni en ville dense ; le sol orange de La Mancha (couleur régionale) préexistant, noté.
- **Suite :** la passe de décalques de B4, ou T7 (écume du trait de côte), selon Sam.

## 2026-11-04T07:53Z — Q6 : les recuits mesurés pendant le chargement, les nuages remesurés

- **Contribution à la destination :** §8 (coût et régularité mesurés pendant l'arrivée des tuiles, pas seulement sur un monde chargé) ; C0-12 (les nuages stables en virage).
- **Réalisé :** bakes-loading (nouvel e2e, kerr-mini, l'avion tenu en palier : pilote automatique, manette automatique, train sorti, comme Sam l'a demandé) — 97a78d64 ; ghost clouds remesuré.
- **Preuves (mesuré) :**
  - recuits pendant le chargement, sunBakesEvery 0 / 500 / 0 : 42 / 37 / 49 redessins, 100 / 68 / 79 ms de passe au total en 5 s ; soit +0,07–0,2 ms par image en moyenne pour suivre chaque recuit ;
  - nuages (ce Mac, virage de 40°) : décalages (0,0), (0,0), (−3,+1) px, PSNR 37,09 / 43,39 dB.
- **Limites / transitions restantes :** une seule scène (La Mancha) ; l'assiette de 7,6° est celle du vol à 136 m/s train sorti.
- **Suite :** T7 (la mer : le moiré au couchant, la hiérarchie des sources d'eau).

## 2026-11-04T09:50Z — T7 : les côtes reproduites d'après 12 photos (caméra seule)

- **Contribution à la destination :** §19 (des parcours vérifiables contre le réel : une vue, une heure, une météo) ; la qualité des preuves (des comparaisons photo / rendu) ; une action commune (__bh.viewAt, cameraAt here) plutôt qu'un chemin propre au test.
- **Réalisé :** b29220d3.
  - __bh.viewAt.
  - coast-refs : cap par repère ou par le Soleil, instant par la hauteur du Soleil, horloge gelée, nuages de carte coupés.
  - Fiche T7.md et planche-reproductions-1.jpg.
- **Preuves (observé, ce Mac en fenêtre) :**
  - 7 cadrages sur 12 proches de la photo ;
  - aux couchers, le Soleil à ±1° (le jeu à 3,3°, azimut 300,4° à Belle-Île, comme le calcul NOAA) ;
  - les écarts de rendu listés : eau, parois, formes fines, marée, ciel au couchant, Grain de Sable disparu.
- **Limites / transitions restantes :**
  - 025 et 034 mal placées ;
  - les références sont des photos d'amateurs, sans étalonnage ;
  - les écarts ne sont pas mesurés en chiffres (couleurs, luminance).
- **Suite :** traiter les écarts dans l'ordre que Sam choisira (le Grain de Sable, l'eau claire près des côtes, les parois, le ciel au couchant, la marée).

## 2026-11-04T10:27Z — T7 : la couleur des parois des falaises

- **Contribution à la destination :** §7 (des matériaux explicites : une paroi reconnue et colorée par sa roche, non par l'herbe étirée de son sommet) ; T7 (côtes).
- **Réalisé :**
  - shadeLite relit l'imagerie 2,5–7,5 m vers l'aval sur les pentes de plus de ~55°, en une seule copie inlinée, et garde l'échantillon le plus rocheux, en bancs ;
  - coast-refs gagne CR_AB, la mesure du coût par bit de liteSkip.
- **Preuves :**
  - observé : Étretat (falaise d'Aval) blanche et stratifiée comme sur la photo, Bonifacio en calcaire clair ;
  - mesuré (kerr-mini, nominal) : +0,5 et +0,9 ms sur deux vues de falaises ;
  - le premier jet anisotrope coûtait +65 ms sur une paroi plein cadre (ce Mac) et a été remplacé.
- **Limites / transitions restantes :**
  - parois ombrées ou couvertes sur la photo ;
  - strates synthétiques ;
  - budget de Vénus +30.
- **Suite :** l'eau claire et turquoise près des côtes (Cassis, Bonifacio), le ciel au couchant, la marée.

## 2026-11-04T10:50Z — T7 : l'eau turquoise près des côtes, deux essais rejetés (mesurés)

- **Contribution à la destination :** aucune avancée de rendu ; un résultat négatif documenté, qui évite une fausse piste (l'imagerie comme couleur de l'eau).
- **Réalisé :** coast-refs vérifie désormais la caméra seule (le vaisseau remis par le préréglage de la scène). Les deux essais sur l'eau ont été retirés ; le shader est à l'état de c2b4a7ff.
- **Preuves (mesuré) :** l'albédo de l'orthophoto IGN sur l'eau (Bonifacio 0,014, Cassis 0,025–0,045) ; essai 2 observé : des plaques de tuiles en mer, des bateaux peints, Cassis brun.
- **Limites / transitions restantes :** le turquoise des eaux claires attend une bathymétrie côtière fine (EMODnet, Litto3D), à évaluer.
- **Suite :** les cadrages de Sugiton et d'En-Vau, puis le ciel au couchant ou la marée.

## 2026-11-04T12:22Z — T7 : l'écume du rivage (prototype désactivé) ; shadeWater divisé par deux

- **Contribution à la destination :** §8 (compilations : le noyau de l'eau 12 000 → 5 800 lignes inlinées, une seule lecture du relief) ; T7 (l'écume au pied des côtes, en prototype).
- **Réalisé :** le relief de shadeWater lu à un seul endroit ; la sonde du rivage et son écume derrière renderer.shoreWash (faux) ; coast-refs CR_AB_PASS et la vue nia.
- **Preuves :**
  - mesuré (kerr-mini) : six variantes de la sonde, de +0,2 à +10,7 ms ; retenue : +1,7–3,2 ms ;
  - observé : le pied des falaises trouvé ; Niagara identique avant/après le changement de structure.
- **Limites / transitions restantes :** désactivée pour son coût ; la suite est un masque du rivage préparé par fenêtre.
- **Suite :** le masque du rivage (ou Q3 B4, les décalques), selon Sam.

## 2026-11-04T13:10Z — T7 : l'écume du rivage, préparée sur le cache du relief (activée)

- **Contribution à la destination :** §7 (préparer les données hors de la frame : une distance à la côte calculée au recuit, lue en une fois) ; T7 (l'écume au pied des côtes).
- **Réalisé :**
  - earth-shore.ts (le calcul sur les niveaux 3 et 4, TABLE_SHORE), seaShoreDist ;
  - l'écume dans shadeWater, renderer.shoreWash activé ;
  - tests earth-shore et gpu-tables ;
  - le test H5 réparé (cassé depuis 6d7248bd).
- **Preuves :**
  - observé : le pied des falaises d'Étretat trouvé, aucun faux rivage ;
  - mesuré (kerr-mini) : +0,2 à 0,8 ms de la passe d'eau, contre +1,7 à 3,2 ms pour la sonde par le relief.
- **Limites / transitions restantes :**
  - le coût du calcul n'est pas mesuré ;
  - la résolution est de 6 et 24 m ;
  - l'écume reste discrète par beau temps (elle suit les vagues).
- **Suite :** Q3 B4 (les décalques des routes) ou la bathymétrie côtière.

## 2026-11-04T13:34Z — Q3 B4 : les décalques des surfaces de la carte

- **Contribution à la destination :** §7 et §8 (préparer les données hors de la frame : les surfaces de la carte dessinées une fois par le worker, une lecture par pixel au lieu d'un parcours d'arbre).
- **Réalisé :**
  - rasterDecals et makeDecals (worker), le paquet du décor (+1,3 Mo), sceneryDecal anticrénelé ;
  - le parcours exact limité au très proche et à la nuit ; rien sous l'orthophoto de jour ;
  - tests scenery-decals ; raster-roads RR_AT et l'état du décor ;
  - budget de shadeLite Terre : 7 100 → 7 130 lignes.
- **Preuves (mesuré, ce Mac) :**
  - La Mancha : +0,66 → +0,50 ms ;
  - Paris (orthophoto) : dans le bruit ;
  - quatre variantes mesurées ; les routes visuellement presque identiques.
- **Limites :** gain modeste ; non mesuré en ville sans orthophoto, ni le temps du worker.
- **Suite :** la bathymétrie côtière (T7) ou R1.

## 2026-11-04T13:56Z — T7 : la profondeur relevée de l'IGN pour les hauts-fonds, essai rejeté

- **Contribution à la destination :** aucune avancée de rendu ; un résultat négatif documenté.
- **Constat :** le LiDAR HD de l'IGN porte des profondeurs le long des côtes (Étretat : 43 000 texels négatifs sur 65 000 en z 14).
- **Essai rejeté :**
  - une bande de hauts-fonds aux bords droits (le polygone de couverture), un ressac moucheté à Bonifacio ;
  - fondue, la bande disparaît ;
  - le code est revenu à 818087a3.
- **Suite :** une bathymétrie côtière préparée hors du jeu (HOMONIM / Litto3D), un chantier de données.

## 2026-11-04T13:59Z — R1 (premier lot) : le modèle CPU de l'air en couches

- **Contribution à la destination :** §7 (un seul modèle d'air physique, partagé par la réfraction, l'atmosphère et les prédictions) ; R1 du plan.
- **Réalisé :** refraction-layered.ts (Ciddor, profil hydrostatique, déviation par l'invariant de Bouguer sans singularité, rayon tangent, rayon sous l'horizon, élévation apparente) ; 7 tests ; fiche R1.md.
- **Preuves :** vérifiées par les tests (Ciddor à 10⁻⁷ de NIST ; Bennett ±3 % ; aplatissement 0,820 ; limbe à 20 km 5,558′ pour 5,57′).
- **Limites / transitions restantes :**
  - tables, worker, branchements (refraction.ts, TARS, Open-Meteo, photo/plans) non faits ;
  - le rayon rasant donne 70,7′ pour 66′ dans le plan ;
  - rien au rendu (R2).
- **Suite :** les tables de R1 dans un worker, puis R2.

## 2026-11-04T14:03Z — R1 (deuxième lot) : le modèle en couches dans le rapport « sky » de TARS

- **Contribution à la destination :** §19 (TARS lit le même modèle d'air que les prédictions à venir) ; R1.
- **Réalisé :** layeredReport (profil en cache), sky-now refraction.layered ; un test.
- **Preuves :** test vert (12 tests de réfraction) ; observé dans le jeu (rapport de TARS au Raz : 34,3′ dessiné, 32,6′ en couches).
- **Limites :** pression standard, pas encore la réelle ; le rendu reste sur le modèle exponentiel (R2).
- **Suite :** la pression réelle, les tables dans un worker, R2.

## 2026-11-04T14:08Z — R1 (troisième lot) : l'air réel dans le modèle en couches

- **Contribution à la destination :** R1, un seul état de l'air venu de la météo réelle.
- **Réalisé :** Open-Meteo pressure_msl (interpolé, gardé), airOfModel (pression, température, humidité), skyNow avec l'air réel.
- **Preuves :** tests verts (16) ; observé dans le jeu : « Open-Meteo (pressure_msl…) », 1 020,9 hPa, 10,3 °C, 65 %.
- **Limites :** les METAR ne donnent pas encore leur air (QNH, T, Td) ; tables et worker à faire ; le rendu inchangé (R2).
- **Suite :** l'air des METAR, puis les tables dans un worker.

## 2026-11-04T14:10Z — R1 (quatrième lot) : l'air des METAR

- **Réalisé :** parseMetar (T, Td, QNH) ; l'état météo garde cet air ; le rapport « sky » de TARS l'utilise.
- **Preuves :** test unitaire vert (27 tests météo et réfraction). Dans le jeu au Bourget, la météo est venue d'Open-Meteo (pas de METAR reçu) : le chemin METAR n'est pas observé dans le jeu.
- **Suite :** les tables dans un worker, puis R2.

## 2026-11-04T14:13Z — R1 (cinquième lot) : les tables de réfraction, à 3″ de l'intégrale

- **Contribution à la destination :** §7 (préparer les données hors de la frame : des tables d'air lues par interpolation, prêtes pour le GPU de R2).
- **Réalisé :** buildTables (B_haut, B_limbe, résolution adaptative aux coudes), lectures log-linéaire, Catmull-Rom et monotone ; test de précision.
- **Preuves (mesuré, tests) :** au pire 1,04″ (B_haut) et 1,73″ (B_limbe) contre l'intégrale ; construction en 0,25 s ; 10 tests verts.
- **Limites :** pas de worker ni de lecteur avant R2 ; le CPU reste sur l'ancien modèle tant que le GPU y est.
- **Suite :** R2, les tables dans le GPU (TABLE_REFR) et le CPU branché en même temps.

## 2026-11-04T14:16Z — R2 (premier lot) : le format GPU des tables de réfraction, à 3″ de l'intégrale

- **Contribution à la destination :** §7 (un seul modèle d'air lu par le CPU et le GPU depuis les mêmes nombres) ; R2.
- **Réalisé :**
  - refraction-gpu.ts : tables rééchantillonnées sur grilles régulières, lecture jumelle de celle du shader, point tangent par Bouguer ;
  - tests ; fiche R2.md.
- **Preuves :** mesuré contre l'intégrale : montants 0,95″ et 1,58″ ; plongeants 2,92″ ; orbite moins de 3″ ; construction en 0,68 s.
- **Limites :** rien encore dans le shader ni dans gpu-tables ; pas de contrôle d'image.
- **Suite :** TABLE_REFR et son worker, airBend.

## 2026-11-04T14:24Z — R2 (deuxième lot) : la réfraction du ciel lue dans les tables, au GPU et au CPU

- **Contribution à la destination :** §7 (le même modèle d'air pour l'image et les chiffres) ; R2.
- **Réalisé :**
  - TABLE_REFR ; le constructeur par tranches de 2 ms (pas d'image tenue) ; renderer.airState et stepRefrTable ;
  - airBend sur les tables ; refraction.ts sur les mêmes tables pour l'air dessiné.
- **Preuves :**
  - tests verts (88) ;
  - observé dans le jeu : table publiée, Soleil apparent de TARS 3,607° égal au modèle en couches, coucher du Raz inchangé à l'œil.
- **Limites :** coût GPU non mesuré ; contrôles d'image du plan (Soleil au télé, ISS, éclipse) non faits ; étoiles et éclipse sur l'ancien modèle.
- **Suite :** le Soleil couchant au télé (aplatissement 0,82), puis les étoiles et l'éclipse.

## 2026-11-04T14:25Z — R2 : le Soleil couchant au télé, sur les tables

- **Preuves (observé et mesuré, e2e refraction-wgs84, ce Mac en fenêtre) :** l'image et le CPU s'accordent à 0,126′ (seuil 0,2′) ; aplatissement 0,838 (le bord inférieur à ~0,12° au-dessus de l'horizon).
- **Suite :** les étoiles (shadeStars) et l'anneau de lumière de l'éclipse sur les tables ; le coût GPU.

## 2026-11-04T14:27Z — R2 : le coût GPU des tables de réfraction mesuré, nul

- **Réalisé :** renderer.refrTablesOn (bascule de mesure) ; refr-cost (nouvel e2e).
- **Preuves (mesuré, ce Mac en fenêtre, Moderate, prises alternées) :** trace 0,93–0,98 ms avec les tables, 1,02–1,03 ms sans ; trace (discs) 0,67 ms dans les deux cas.
- **Suite :** les étoiles et l'anneau de lumière de l'éclipse sur les tables.

## 2026-11-04T14:45Z — R2 : la Lune éclipsée sur les tables de l'air en couches

- **Contribution à la destination :** §7 (un seul modèle d'air, partagé par le ciel, les étoiles, l'éclipse et les chiffres CPU) ; R2.
- **Réalisé :**
  - trace.wgsl earthRingLight : Newton et défocalisation sur B_limbe, pente sur ±1 km (refrLimbSlope) ;
  - jumeau CPU (shadows-gpu.ts earthRingY) sur les mêmes tables ;
  - e2e lunar-eclipse-ring ; test unitaire (pente, dénominateur ≥ 1, part de lumière) ;
  - planche R2/eclipse-lune.jpg.
- **Preuves :**
  - mesuré au CPU : cœur de l'ombre 2,49·10⁻⁵ (+42 % contre l'exponentielle), mi-ombre +34 %, bord inchangé ;
  - observé dans le jeu (ce Mac, en fenêtre) : plus d'arcs, pas d'erreur GPU. Écart image avec et sans tables sous le bruit A/A.
  - Essai rejeté : la pente du segment (coude de la tropopause) dessinait des caustiques en arcs blancs.
- **Limites :**
  - Danjon non vérifié (aucune valeur L publiée trouvée pour le 07/09/2025) ;
  - un seul air (celui du lieu de la caméra) pour tout le limbe ; coût GPU de l'anneau non mesuré ;
  - neuf budgets d'inline relevés de 10 à 70 lignes ; coucher de l'ISS pas encore contrôlé.
- **Suite :** le coucher de l'ISS (R2), puis Q5, R4–R6, Q9, Q7, Q8.

## 2026-11-04T16:10Z — R2 : le coucher vu de l'ISS contrôlé ; trois défauts corrigés (vue en orbite, verticale, point tangent)

- **Contribution à la destination :** §7 (le même modèle d'air et la même figure WGS84 pour l'image et le CPU) ; contrôles R2 du plan.
- **Réalisé :**
  - `viewAt` en spectateur (champ de la vue, pose en coupe et rig réinitialisé) ;
  - `bodyView` en altitude sur la normale WGS84 ;
  - `refrBend` : point tangent sur la sphère du repère aplati, caméra à sa distance ; jumeau CPU `gpuBending(…, R, r0)` ;
  - rayon courbé dans la mer : rien d'au-delà de l'air (`REFR_SEA`) ;
  - e2e `iss-sunset` ; planche `R2/iss-coucher.jpg`.
- **Preuves (mesuré, ce Mac en fenêtre) :**
  - 70° N : image et CPU à 0,26′ près sur six pas, aplatissement de 1/5 à 1/12 ;
  - équateur : bas du disque éteint, comme le prévoit le modèle d'air ;
  - `refraction-wgs84` toujours vert (0,124′) ; 125 tests unitaires verts.
- **Limites :**
  - défaut ouvert : extinction rasante trop faible à 70° N (contrôle géométrique 14,2′ visibles contre 6,3′ à l'équateur), effet de latitude, hors des tables ;
  - pas de photo réelle de l'ISS en référence ; coût GPU de `REFR_SEA` non mesuré (une comparaison) ;
  - Danjon toujours ouvert.
- **Suite :** la tranche `earthAir` rasante à 70° N, puis Q5, R4–R6, Q9, Q7 et Q8.

## 2026-11-04T17:05Z — R2 : le coucher vu de l'ISS tenu aux deux latitudes ; le « défaut polaire » était un artefact du test

- **Contribution à la destination :** §7 ; les contrôles de R2 du plan.
- **Réalisé :** `iss-sunset` repose la vue une fois l'horloge gelée ; R2.md corrigé ; planche `R2/iss-coucher.jpg` refaite.
- **Preuves (mesuré, ce Mac en fenêtre) :**
  - l'image suit le CPU à 0,26′ près, à l'équateur et à 70° N, sur six pas (aplatissement de 1/3 à 1/14) ;
  - contrôle géométrique identique aux deux latitudes ;
  - la transmission du shader sondée, identique pixel par pixel, et son jumeau CPU identique à toutes les latitudes ;
  - la caméra du test mesurée à 417,1 km au lieu de 420 avant la correction, à 420,000 après.
- **Correction de l'entrée de 16:10Z :** le « défaut ouvert » de l'extinction rasante près des pôles n'existe pas, c'était cette
  dérive. Les sondes temporaires sont retirées : aucun code de débogage laissé dans `trace.wgsl`.
- **Limites :** pas de photo réelle de l'ISS en référence ; Danjon toujours ouvert.
- **Suite :** Q5, puis R4–R6, Q9, Q7 et Q8.

## 2026-11-04T17:55Z — Q5 C1 (premier lot) : la table de transmittance de l'air, au GPU et au CPU

- **Contribution à la destination :** §7 (un modèle d'air exact et commun à l'image et aux chiffres, base des tables de Hillaire) ; Q5 C1.
- **Réalisé :**
  - `earth-air.ts` : table 256 × 64 (Bruneton), épaisseurs optiques intégrées exactement, construite par tranches ;
  - `TABLE_TLUT` dans le tampon du traceur ;
  - `sunThrough` (shader et posemètre CPU) sur la table pour la Terre ;
  - `renderer.tlutOn` ; tests `earth-air-lut`, e2e `air-tlut-read` et `air-tlut` ; Q5.md.
- **Preuves :**
  - mesuré : Chapman surestimait la transmission du Soleil bas (+9 % à 10°, +35 % à 2°) ; la table est à 0,39 % de
    l'intégrale (T > 1 %) ;
  - GPU = CPU à 10⁻⁴ ;
  - Alpes au couchant : versants −18 % de bleu, −8 % de vert ; coût +0,1 à +0,2 ms, à la limite du bruit.
- **Limites :** air toujours épaissi (C2) ; diffusion multiple et table du ciel à venir ; 17 budgets d'inline relevés ;
  pas mesuré sur mini ni PC.
- **Suite :** C1, la table de diffusion multiple, puis celle du ciel.

## 2026-11-04T18:40Z — Q5 C1 (deuxième lot) : la diffusion multiple de l'air par sa table (Hillaire)

- **Contribution à la destination :** §7 ; Q5 C1 (les tables de Hillaire, étape 2/4).
- **Réalisé :** Ψ_ms calculé au CPU (64 directions, sur la table de transmittance), table 32 × 32 dans le tampon du traceur ;
  `earthAir` ajoute σ_s Ψ_ms au lieu du substitut isotrope (0,8 / 0,3 sous le rayon direct) ; `renderer.msLutOn` ;
  tests unitaires ; `air-tlut-read` étendu ; e2e `air-ms`.
- **Preuves :**
  - GPU = CPU à 0,1 % ;
  - Chamonix : à −4°, ciel bleu-violet au-dessus de la lueur au lieu d'un orangé uniforme ; à 2°, ciel 12 % moins clair et plus
    neutre ; de jour, ~5 % plus sombre et plus bleu ;
  - coût +0,15 ms en moyenne, dans le bruit.
- **Limites :** pas de référence photographique ; `twilightK` à réétalonner avec C2 ; la table aérienne et `skyAmbient`
  gardent leurs approximations.
- **Suite :** C1, la vue du ciel et les raccords (`apRead`, `skyAmbient`).

## 2026-11-04T19:50Z — Q5 C2 (premier lot) : une seule atmosphère physique, le crépuscule sans étalonnage

- **Contribution à la destination :** §7 (décision 27 : un même air pour tous les observateurs) ; Q5 C2.
- **Réalisé :**
  - `AIR_K` 3 → 1 et `twilightK` coupé ;
  - rayon vers le Soleil d'un point au-dessus de l'air pris à son entrée ;
  - tests ; `twilight-sky` passé à TW_ON ; mesure d'`iss-sunset` réservée au disque solaire ;
  - Q5.md, planche `Q5/air-reel.jpg`.
- **Preuves :**
  - modèle CPU contre Patat et al. 2006 (V, zénith, Paranal) : à 0,1–0,8 mag de −6° à −15°, contre 6,3 mag au lieu de 9,5 à
    −15° pour l'air épaissi ;
  - `twilight-sky` vert sans étalonnage (×1,41 / ×2,26 / ×1,11) ;
  - images de Chamonix : jour plus bleu, crépuscule violet au zénith ;
  - ISS toujours à 0,7′ près ; 280 tests unitaires verts.
- **Limites :** l'interrupteur `twilightOn` à retirer ; vues M0b non reprises ; limbe d'orbite non comparé à une photo ;
  crépuscule profond saturé par le posemètre.
- **Suite :** retirer l'étalonnage, reprendre les vues M0b, puis C3 (les aérosols du jour).

## 2026-11-04T21:05Z — Q5 C3 : les aérosols du jour (CAMS par Open-Meteo) dans les tables de l'air ; CI réparée

- **Contribution à la destination :** §7 (l'air dessiné, celui du jour) ; Q5 C3. Et la chaîne CI/déploiement de nouveau verte.
- **Réalisé :**
  - `aerosols.ts` (requête, lecture, flux) ;
  - tables construites pour l'épaisseur du jour et facteur publié au traceur ;
  - crédit CAMS ;
  - tests et e2e `air-aerosols`.
  - CI : le noyau sans décor recompile (68a702f8) ; le test `water-kd` décode sa PNG lui-même (0ca70c05).
- **Preuves :**
  - unitaires verts ; table brumeuse à 1 % de l'intégrale ;
  - e2e : la brume ouvre l'auréole et blanchit l'horizon ;
  - la météo réelle tire τ 0,05 de CAMS depuis le navigateur ;
  - CI verte et déployée sur 0ca70c05.
- **Limites :** une seule épaisseur pour toute la planète (le lieu de la caméra) ; profil des aérosols fixe.
- **Suite :** le comparatif M0b avant/après Q5 (en cours sur kerr-mini), puis le reste de Q5 (C5 la météo datée, C11, C6–C10,
  VIPER, P8).

## 2026-11-04T21:40Z — Q5 : les vues de M0b avant et après l'air réel (A/B sur kerr-mini, un tour)

- **Contribution à la destination :** §7 et §8 (la référence partagée de la décision 36) ; la vérification de C1–C2 sur toutes les vues.
- **Réalisé :** A/B `plan-views` (7c47e6aa contre 8f97e89d) ; planches et chiffres dans `Q5/`.
- **Preuves (observé, un tour) :** de l'orbite, le limbe devient une ligne mince et plus sombre au lieu d'une bande épaisse ;
  au sol, voile plus neutre à Paris, crépuscule plus bleu. Temps d'image identiques sur la plupart des vues.
- **Limites :** un seul tour, sans A/A, arrêté avant la fin du côté B ; l'ISS à +7 ms est à vérifier ; le limbe d'orbite peut
  demander un réglage artistique nommé (décision 27) après comparaison à une photo.
- **Suite :** A B B A sur deux tours ; Q5 C5 (météo datée et cohérente).

## 2026-11-04T22:30Z — Q5 C5 (premier lot) : la météo réelle sur une grille de 5 × 5 points autour de la caméra

- **Contribution à la destination :** §7 et §19 (la météo datée et cohérente dans l'espace) ; Q5 C5.
- **Réalisé :** `weather-grid.ts` (une requête Open-Meteo à 25 points) ; les classes des couches ; `TABLE_WXGRID` ;
  `wxGridCover` dans le shader ; tests et e2e `weather-grid`.
- **Preuves :** unitaires verts ; e2e en Bretagne : grille reçue (couvertures de 0,13 à 1 sur 250 km), ciel différent selon le
  cap (jusqu'à 10 niveaux au nord) ; 71/71 shaders.
- **Limites :** forme des couches et visibilité encore celles de la caméra ; GIBS et confiance à faire ; effet discret dans la
  vue testée (plafond bas couvert).
- **Suite :** C5, la mosaïque datée et la confiance ; puis C11 (la composition par couches).

## 2026-11-04T23:20Z — Q5 C5 (deuxième lot) : les nuages du jour datés par l'heure de passage du satellite

- **Contribution à la destination :** §7 et §19 (la météo datée) ; Q5 C5.
- **Réalisé :** `dayCloudsPair` et `dayMixAt` ; le paquetage mélange les deux jours texel par texel ; cache des mosaïques par
  date et mélange par demi-heure de jeu ; `dayCloudsMixOn` ; test unitaire et e2e `day-clouds-mix`.
- **Preuves :** unitaires verts ; e2e : la paire 1er/2 novembre en place, le limbe change, la clé suit l'horloge ; un défaut de
  cache trouvé et corrigé.
- **Limites :** heure de passage approchée ; pas encore de confiance affichée.
- **Suite :** C11 (la composition des couches) ou le reste de C5 (la confiance), selon la priorité de Sam.

## 2026-11-04T23:45Z — Q5 C5 : la brume de la météo lue au point sur la grille

- **Réalisé :** `wxHazeExt` (la visibilité de la grille, bilinéaire ; l'archive sans visibilité garde celle de la caméra) ;
  `weather-grid.ts` marque −1 la visibilité absente ; tests et e2e étendus.
- **Preuves :** unitaires verts, 71/71 shaders ; e2e Bretagne : visibilités de 6,2 à 50 km sur 250 km, ciel plus clair de 10 à
  18 niveaux au nord et à l'est avec la grille, de 0,5 à 2,6 au sud et à l'ouest.
- **Limites :** le voile des couches et leur forme restent ceux de la caméra.

## 2026-11-05T00:50Z — Q5 : le coût de C1–C2 mesuré en A B B A sur les vues de M0b

- **Preuves (mesuré, kerr-mini, deux tours) :** Chamonix et la côte −2,5 %, Biarritz −0,9 %, ISS nord +2,3 % ; un surcoût net,
  le Soleil bas au télé (+7,3 %, +2,9 ms : le ciel près du Soleil, la table de diffusion multiple lue à chaque pas). Le +7 ms
  du premier passage pour l'ISS était du bruit.
- **Suite :** réduire ce surcoût (P8, ou une vue du ciel limitée au ciel clair) ; le reste de Q5.

## 2026-11-05T01:50Z — Q5 : le surcoût du Soleil bas au télé, repris

- **Preuves (mesuré) :**
  - `air-cost` : les tables ne coûtent pas plus de ~0,1 ms dans la vue ;
  - A/B mini en trois tours : coucher de Biarritz identique ; Soleil 0,5° au télé : A stable vers 39 ms, B bimodal (39 ms ou
    42,8 ms, une mesure sur trois).
- **Limites :** la cause du régime à +3,5 ms n'est pas trouvée.

## 2026-11-05T02:40Z — Q5, VIPER C1 : toutes les gigues sur le bruit bleu

- **Réalisé :** les six derniers tirages IGN passent sur `blueDraws` (z pour le premier pas, w pour l'air) ; la gigue de
  `skyFill`, figée dans le temps, avance maintenant ; `ign` retiré ; e2e `air-grain`.
- **Preuves :** 71/71 shaders ; `air-grain` A B A B : aucune différence au repos (scintillement ≤ 0,05 niveau, grain 0,29–0,33).
- **Limites :** le gain attendu, en mouvement, n'est pas mesuré.
- **Suite :** VIPER C2 (les nuages amortis), C11, C6–C10.

## 2026-11-05T03:40Z — Q5 VIPER C2 (premier lot) : la marche des nuages amortie

- **Contribution à la destination :** §8 (le coût des nuages, le budget de 60 images/s) ; Q5 VIPER C2.
- **Réalisé :** un texel sur quatre marché par image, en damier tournant, le lancement compacté ; reconstruction depuis
  l'historique bornée par les voisins marchés ; bit d'exécution sans historique ; `cloudAmortize` ; e2e `cloud-amortize`.
- **Preuves (mesuré, ce Mac, A B A B) :** passe des nuages 1,49 → 0,53 ms, reconstruction +0,15 ms, soit **−0,8 ms net** ;
  image figée identique (un pointillé trouvé puis corrigé) ; deux défauts trouvés en mesurant (fils inactifs, boîte trop étroite).
- **Limites :** le budget libéré n'est pas encore investi ; traînée en mouvement non mesurée ; kerr-mini non mesuré.

## 2026-11-05T04:30Z — Q5 VIPER C2 (suite) : le drapeau dans les drapeaux de l'image, les échantillons réglables

- **Réalisé :** `FLAG_CLOUD_AMORTISED` dans `P.frame.z` (le bit 30 de `liteSkip` effaçait ses bits bas) ; `cloudSamples`
  (`CLOUD_N`) sous amortissement.
- **Preuves (mesuré, ce Mac) :** amorti 16 éch. 0,57–0,59 ms, amorti 32 éch. 0,79–0,81 ms, chaque texel 16 éch. 1,59–1,60 ms ;
  pas de différence visible à l'arrêt. 16 restent par défaut.
- **Limites :** l'apport de 32 échantillons en mouvement n'est pas mesuré.

## 2026-11-05T05:00Z — Q5 VIPER C2 : mesuré en mouvement, coupé par défaut

- **Preuves (mesuré, `ghost` nuages en virage, deux passages) :** amorti 36,5–36,7 dB contre 38,0–38,2 dB, traînées claires ×1,9,
  GPU −0,7 à −2,2 ms.
- **Décision :** pas de cadence au prix d'une image brouillée ; `cloudAmortize` est coupé par défaut, le code est gardé.
- **Suite :** l'amortissement seulement quand la vue est presque immobile, ou une meilleure reconstruction des texels découverts.

## 2026-11-05T05:40Z — Q5 VIPER C2 : la porte « vue presque immobile » essayée, pas encore propre

- **Réalisé :** `frameMotionPx` (mouvement de l'image par image) et le mode `cloudAmortize = "still"` ; défaut coupé.
- **Preuves (mesuré, sous forte pression thermique) :** en virage, le mode « still » dégrade encore (35,65 contre 37,42 dB).
- **Suite :** journaliser la porte pendant le virage de `ghost` ; trouver d'où vient la dégradation.

## 2026-11-05T07:10Z — Q5 VIPER C2 : référence de `ghost` corrigée, mesures refaites, amortissement coupé (§8 performance, §15 jalon Q5)

- **Réalisé (e88cf224) :** l'e2e `ghost` affine sa référence sans amortissement et journalise la porte (`frameMotionPx`,
  `cloudAmortizedNow`) image par image. `renderer.cloudAmortizeWeight` est réglable sans recompilation. Le défaut reste
  `cloudAmortize = false`.
- **Preuves (mesuré, ce Mac, pression thermique forte : temps ±40 %, PSNR plus stables) :**
  - En virage, l'amortissement coûte ≤ 0,2 dB (37,57–38,2 dB, contre 37,73–38,28 dB pour chaque texel). La dégradation de
    1,6 dB vue plus tôt venait surtout de la référence amortie.
  - Image arrêtée : 40,1–41,8 dB, contre 44,0–44,2 dB.
  - Les poids 0,08, 0,12 et 0,2, et un historique non borné, n'y changent rien.
  - Détail : docs/progress/refraction-horizons/Q5.md.
- **Limites :**
  - La −0,8 ms reste non acquise pour le profil principal.
  - La variante inverse (amortir seulement en mouvement) n'est ni essayée ni mesurée sur kerr-mini.

## 2026-11-05T07:45Z — Q5 C11 (premier lot) : chaque couche de nuages sous son propre air (§7 « l'air partagé », §15 jalon Q5)

- **Contribution :** un modèle d'air partagé appliqué correctement aux couches de nuages, au lieu d'une seule lecture au nuage
  le plus proche ; une seule composition des couches (`cloudsAdd`) au lieu de quatre copies.
- **Réalisé (voir le commit qui suit e88cf224) :**
  - `CloudVol.ta` : la distance de la lumière, pondérée par elle, dans `cloudVolume`, `wxCloud` et `wxRainShafts`.
  - `EarthClouds.ta`, porté par `cloudOutB.w`, `cloudTemporal` et `cloudsBuffered`.
  - `earthLookSky` lit l'air à `ta`.
  - e2e `cloud-layers-air` ; planche `docs/progress/refraction-horizons/Q5/couches-air.jpg`.
- **Preuves (observé et mesuré, ce Mac, figé, exposition verrouillée) :**
  - Couvert à deux couches, vu de 7 000 m, 1° vers le bas : 4,16 % des pixels s'écartent de plus de 4 niveaux, contre 0,63 % de
    bruit, localement à l'horizon.
  - Les autres vues restent dans le bruit.
- **Limites :**
  - Coût non mesuré : l'A/B ne coupe que la lecture.
  - Une seule distance par pixel, pas des segments.
  - Non mesuré sur kerr-mini.
- **Suite :** C6 (auto-ombrage proche et champ d'ombre large séparés).

## 2026-11-05T08:30Z — Q5 C6 : le champ d'ombre large des nuages par la carte d'ombre commune (§7 « responsabilité commune », §15 Q5)

- **Contribution :** la carte d'ombre des nuages, déjà source unique des ombres du sol, de l'air et de l'appareil, éclaire
  aussi les nuages eux-mêmes au-delà de leur marche proche. Elle remplace un voile statistique.
- **Réalisé :**
  - `wxCloud` : marche proche de 3,8 km, puis la carte au bout de la marche.
  - `cloudShadow` : la marche bornée aux couches présentes, avec un jitter fixe par texel.
  - Une référence de mesure (`TUNE_GSKIP` 4194304) et `CLOUD_NEAR_N`.
  - e2e `cloud-shadow-c6` ; planche `docs/progress/refraction-horizons/Q5/ombres-c6.jpg`.
- **Preuves (mesuré, ce Mac, contre la référence) :**
  - Couvert : écart quadratique de 6,6 → 2,75 niveaux.
  - Orage : biais de +10 → −1 niveau.
  - Coût de la passe des nuages : +0,3 à +1,0 ms (pression thermique nominale), jusqu'à +2 ms sous forte pression.
- **Limites :**
  - L'orage reste à 21 niveaux d'écart quadratique de la référence.
  - Le coût va à l'encontre du budget des nuages.
  - Rien n'est mesuré sur kerr-mini.
  - Défauts antérieurs vus dans l'orage : étincelles, rectangle de la carte dans l'air.

## 2026-11-05T09:30Z — Exposition manuelle juste ; Q5 C7, le cirrus de la météo (§19 « l'expérience complète » : photo ; §15 Q5)

- **Réalisé :**
  - 5b3f1266 : en exposition manuelle, le fond du ciel est compensé comme en automatique. C'est la cause des étincelles de
    l'orage : des étoiles à 2¹⁷.
  - C7 (le commit qui suit) : le cirrus suit la couverture haute du modèle (grille, ou heure à la caméra) dans la portée de la
    météo, avec un vec4 de plus en fin de `TABLE_WXGRID`.
  - e2e `cirrus-weather` ; planche `docs/progress/refraction-horizons/Q5/cirrus-meteo.jpg`.
- **Preuves :**
  - Exposition verrouillée contre automatique : 0,48 niveau d'écart (le bruit).
  - `multiexposure.e2e` vert sur kerr-mini.
  - Cirrus : rien à couverture 0, un voile à 0,6 et à 1 (+23 niveaux de luminance du ciel).
- **Limites :**
  - Le cirrus des jours réels sans couche reste climatologique.
  - Ni le halo de 22° ni le coût de C7 ne sont mesurés.

## 2026-11-05T10:20Z — Q5 C10 (premier lot) : le Soleil caché derrière un couvert (§15 Q5 : « le Soleil caché derrière un cumulus épais »)

- **Réalisé :** les 4 rayons d'un petit disque prennent tous les nuages de la passe. Après le premier, ils marchaient les leurs,
  ce qui faisait un carré pâle sur le Soleil derrière un couvert.
  - e2e `sun-behind-deck` (avec assertions) ; planche `docs/progress/refraction-horizons/Q5/soleil-couvert.jpg`.
- **Preuves (mesuré, ce Mac) :** rectangle du disque / pourtour de 1,25–1,30 → 0,98.
- **Limites :**
  - Le pont marché par pixel (reflets, passe coupée) est bien plus clair que celui de la passe : un double éclairage à réunir.
  - Le plancher de transmittance, le saut à 30 km et la couverture sous-pixel restent à faire.

## 2026-11-05T11:00Z — Q5 C10 : le couvert éclairé pareil par la passe et par les rayons qui marchent seuls

- **Réalisé :** le facteur de la colonne dépend de la couverture de la couche (0,4 → 1 pour un couvert).
  - e2e `cloud-light-column`.
- **Preuves (mesuré, ce Mac) :** base du couvert à 1,40 → 0,99 fois la passe ; cumulus inchangés (0,76 / 0,81).
- **Limites :** les cumulus marchés par rayon restent 20 à 25 % plus sombres ; la cause n'est pas trouvée.

## 2026-11-05T11:45Z — Q5 C10 : pas de saut des nuages à 30 km

- **Réalisé :** le volume des nuages de la carte se fond dans la couche plate entre 25 et 35 km (`P.earth4.w` continu,
  `renderer.cloudVolumeFade`).
  - e2e `cloud-volume-fade` ; planche `docs/progress/refraction-horizons/Q5/fondu-30km.jpg`.
- **Preuves (mesuré, ce Mac) :** au passage des 30 km, +4,94 → +0,17 niveau.
- **Limites :**
  - Coût non mesuré dans la bande de 25 à 35 km.
  - Le plancher de transmittance et la couverture sous-pixel restent à faire.

## 2026-11-05T12:40Z — Q5 VIPER C4 (premier lot) : la gloire sur les nuages

- **Réalisé :** `gloryPhase` (Laven, gouttelettes de 10 µm) dans la diffusion simple des nuages.
  - e2e `cloud-glory` (avec assertions) ; planche `docs/progress/refraction-horizons/Q5/gloire.jpg`.
- **Preuves (mesuré, ce Mac) :** la gloire vaut 8,9 niveaux d'écart, contre 1,65 de bruit, au point antisolaire.
- **Limites :**
  - L'ombre de l'avion sur les nuages n'est pas faite.
  - Ni le coût ni une comparaison photo ne sont faits.

## 2026-11-05T13:30Z — Q5 VIPER C4 : l'ombre de l'avion sur les nuages, au cœur de la gloire

- **Réalisé :** `shipCloudShadow` dans la passe des nuages.
  - e2e `cloud-glory` étendu (avec assertions) ; planche `gloire.jpg` refaite.
- **Preuves (mesuré, ce Mac) :** ombre à 53 niveaux contre 2,7 de bruit ; gloire à 11,3 contre 0,5.
- **Limites :**
  - L'ombre ne tombe que sur les couches de la météo.
  - Coût non mesuré ; pas de comparaison photo.

## 2026-11-05T14:30Z — Q5 : VIPER C3 écrit et coupé ; mesures kerr-mini de C6, C10 et C4 (§8 performance)

- **Réalisé :** le champ proche dans les nuages (VIPER C3), coupé par défaut (`TUNE_GSKIP` 536870912).
  - e2e `cloud-near-field`.
  - Les écarts des cumulus marchés par rayon sont expliqués : pas de nuages devant le sol sans la passe, et des flancs non
    éclairés.
- **Preuves (mesuré) :**
  - C3 : +4,7 ms dans une couche sur ce Mac, sans gain visible à l'arrêt.
  - kerr-mini, tous verts : Soleil caché (0,987), ombre de l'avion et gloire visibles, fondu à 30 km (3,38 → 0,04).
  - Champ lointain de C6 : +1,5 à +2,1 ms. La passe des nuages coûte 13,7 à 29,8 ms sur le M1.
- **Limites :**
  - Le coût de la passe des nuages sur M1 est le principal obstacle aux 60 images/s dans les nuages.
  - L'apport de C3 en mouvement n'est pas mesuré.

## 2026-11-05T15:00Z — Q6 / R2 : le contrôle de Danjon par une magnitude mesurée

- **Réalisé :** `tests/eclipse-magnitude.test.ts`. La Lune de l'éclipse du 16/05/2022 calculée par le jeu (−2,19), comparée à
  la mesure (−0,8 ± 0,3, Sky & Telescope).
- **Preuves (vérifié statiquement, calcul CPU) :** le modèle est 1,4 magnitude trop clair. Causes probables : les nuages du
  terminateur et les aérosols, absents du modèle.
- **Limites :** une seule mesure ; pas de recalage (contrôle, pas réglage). La valeur L du 07/09/2025 reste introuvable.

## 2026-11-05T15:40Z — Q5 VIPER C2 : l'amortissement en mouvement seulement, mesuré et non adopté (§8)

- **Réalisé :** le mode `cloudAmortize = "moving"`, coupé par défaut.
- **Preuves (mesuré, kerr-mini) :** −4,1 ms (52 → 47,9 ms), mais −0,97 dB en virage et +44 % de pixels fantômes.
- **Limites :**
  - Un seul passage gardé par mode (dossiers écrasés).
  - Le coût de la passe des nuages sur M1 reste l'obstacle principal.

## 2026-11-05T16:30Z — Q5 : où va le coût de la passe des nuages (§8)

- **Mesuré :**
  - Couper le bruit fin au loin rend la passe plus lente (+0,1 à +0,5 ms) et change l'image : écarté.
  - La marche vers le Soleil fait environ la moitié de la passe (couvert 15,3 → 7,8 ms, orage 35 → 15,3 ms sans elle, sous
    throttling).
- **Suite proposée (non réalisée) :** un volume de transmittance solaire autour de la caméra, lu une fois par échantillon.

## 2026-11-05T17:30Z — Q5 : le volume de lumière des nuages (§8 performance, §7 « préparer avant »)

- **Contribution :** la lumière des nuages est calculée une fois par image dans un volume partagé, au lieu d'une marche par
  échantillon. C'est le principe « une responsabilité commune avant plusieurs lecteurs », appliqué au coût.
- **Réalisé :** `cloudLightVolume`, `clvTau`, `TABLE_CLV`, `renderer.cloudLightVolumeOn` ; e2e `cloud-light-volume`.
- **Preuves (mesuré, kerr-mini) :**
  - orage : −3,3 ms net (passe 31,0 → 26,9 ms, plus 0,8 ms de volume) ;
  - couvert : +0,3 ms ;
  - écart à la référence réduit (5,98 → 3,75 ; 8,46 → 8,19).
- **Limites :**
  - Bord du volume non examiné en mouvement.
  - La passe coûte encore 13 à 27 ms sur M1.

## 2026-11-05T18:10Z — Q5 : un repli pour les nuages devant le sol sans passe des nuages (§19 « l'expérience sur tous les appareils »)

- **Réalisé :** `cloudsFallback` et le stub `cloudsLiteFallback`, compilés seulement sans la passe ; le plafond de test
  `gpuTextures=N` ; e2e `cloud-fallback` (avec assertions).
- **Preuves (observé et mesuré, ce Mac plafonné) :** les cumulus apparaissent devant le sol (bande 138 → 174, dispersion
  14 → 35).
- **Limites :** nappes plates ; coût non mesuré sur un vrai petit appareil.

## 2026-11-05T19:00Z — Q5 P8 (premier lot) : la carte d'ombre des nuages rafraîchie une ligne sur quatre

- **Réalisé :** `CSM_EVERY` et `renderer.csmEvery` ; recalcul complet dès que le repère bouge ; e2e `cloud-shadow-amortise`.
- **Preuves (mesuré) :**
  - ce Mac : 1,62 → 1,11–1,31 ms à l'arrêt ;
  - kerr-mini : aucun gain (3,07–3,24 contre 3,19–3,26 ms) ;
  - image neutre (43 dB, contre 39 dB de bruit).
- **Limites :** sur M1, le coût semble venir du repère recalculé par chaque thread (hypothèse) ; le reste de P8 est à faire.

## 2026-11-05T19:40Z — Q5 P8 : la carte d'ombre par bandes, −2,1 ms à l'arrêt sur M1

- **Réalisé :** le rafraîchissement par bandes de 8 lignes, un groupe de travail entier (avec des lignes isolées, chaque groupe
  SIMD gardait une voie active).
- **Preuves (mesuré, kerr-mini) :** à l'arrêt, 3,16 → 0,99–1,17 ms ; image neutre (49 dB, contre 42 dB de bruit).
- **Limites :** en vol, aucun gain, cause non trouvée (la condition de repère immobile doit échouer).

## 2026-11-05T20:00Z — Q5 P8 : la carte d'ombre amortie aussi en vol (−1,8 à −2,4 ms sur M1)

- **Réalisé :** la comparaison du repère dans le plan de la carte (le centre glisse le long de la lumière en vol).
- **Preuves (mesuré, kerr-mini) :** en vol, 3,42 → 1,04–1,63 ms ; à l'arrêt, 3,21 → 1,05 ms ; image neutre.
- **Limites :**
  - Un seul lieu mesuré.
  - Le réveil sur éclair ou changement de météo n'est pas fait (4 images pour tout rafraîchir).

## 2026-11-05T20:40Z — Q5 P8 : le volume de lumière amorti (−0,7 ms sur M1)

- **Réalisé :** le volume de lumière par bandes, avec une ligne de repère pour savoir quand tout refaire ; `renderer.clvEvery`.
- **Preuves (mesuré, kerr-mini) :** volume 0,94–1,00 → 0,20–0,32 ms ; image neutre.
- **Bilan de la journée (orage, kerr-mini) :** environ 34 ms de nuages → environ 29 ms (passe, volume, carte).
- **Limites :** la passe des nuages reste le gros poste (27 ms) ; la table aérienne n'est pas amortie.

## 2026-11-05T21:10Z — §8 : constat — sur M1, la vue cockpit domine l'image (4–6 images/s dans l'orage)

- **Mesuré (kerr-mini, 1080p, orage, figé) :** 171–234 ms par image avec le F-35 en cockpit, 70 ms sans l'avion. Les passes
  de l'avion (ombrage MSAA, carte d'ombre, masque, affichage) pèsent 100 à 160 ms ; les nuages, environ 28 ms.
- **Non réalisé :** aucune correction. C'est hors du plan en cours, à décider par Sam ; les pistes sont consignées dans Q5.md.
- **Conséquence :** pour les 60 images/s du profil principal, c'est le premier poste, avant les nuages.

## 2026-11-05T21:50Z — R6a-ciel (premier lot) : le traceur CPU des mirages

- **Réalisé :** `src/system/mirage.ts` : profils forcés (mer chaude, inversion), rayons de l'œil en RK4 à travers les points de
  retournement, table de l'œil, images d'un astre. Tests `tests/mirage.test.ts`. Fiche `docs/progress/refraction-horizons/R6.md`.
- **Preuves (vérifié, tests) :**
  - l'air standard rejoint le modèle stratifié (à 0,02° près) ;
  - la mer chaude donne deux images d'un astre à −0,45° (le vase étrusque) ;
  - l'inversion relève l'horizon.
- **Limites :** rien au GPU encore ; pas de worker ; une seule couleur.

## 2026-11-05T22:30Z — R6a-ciel (deuxième lot) : les tables des mirages calculées dans un worker et publiées

- **Réalisé :** trois couleurs, `mirage-worker.ts` (servi et construit), `renderer.mirageProfile` et `updateMirage`, la table
  `TABLE_MIR`. Préparation hors de l'image, conformément au §7.
- **Preuves (vérifié) :** tests unitaires ; e2e `mirage-tables` (publié en 0,9 s pour un œil à 16,8 m au-dessus de la mer).
- **Limites :** rien n'est encore dessiné (la lecture GPU est le lot suivant) ; pas de réglage joueur ni TARS.

## 2026-11-05T23:20Z — R6a-ciel (troisième lot) : les mirages dessinés au GPU

- **Réalisé :** la table de l'œil lue par `airBend` ; pas de sol où le rayon remonte ; la mer raster cède ces pixels au
  traceur ; le Soleil sans rectangle sous un mirage. e2e `mirage-sun`, planche `R6/mirages-soleil.jpg`.
- **Preuves (observé, ce Mac) :** un Soleil étiré (« carré ») sur mer chaude, perdu dans le conduit d'une inversion ; l'air
  ordinaire inchangé.
- **Limites :**
  - Pas de photo de référence ; œil à 2,2 m (l'avion posé).
  - Pointillés des rayons épars ; une couleur.
  - Ni réglage ni TARS.

## 2026-11-05T23:50Z — R6a-ciel (quatrième lot) : les mirages comme réglage du joueur et de TARS

- **Réalisé :** `settings.mirage` dans le menu (Ciel › La Terre), en français, accessible à TARS par `set_settings`. Les
  fonctions produit passent par les mêmes réglages que les autres entrées (§19).
- **Preuves (vérifié) :** les tests des réglages, de l'i18n et de TARS ; l'e2e `mirage-tables` par le réglage.
- **Limites :** une couleur à l'image ; pas de photo de référence.

## 2026-11-05T02:47Z — R6a-ciel : le vase étrusque observé

- **Réalisé :** e2e `mirage-sun` paramétré (hauteur de l'œil, élévation du Soleil), la vue choisie par le calcul de la
  table ; planche `R6/vase-etrusque.jpg`.
- **Preuves (observé, ce Mac) :** l'oméga du vase étrusque sur mer chaude, le Soleil relevé et étagé sous l'inversion, le
  Soleil aplati à l'air ordinaire.
- **Limites :** pas de comparaison chiffrée à une photo ; une couleur.

## 2026-11-05T02:57Z — Q6 : la Lune couchante vue de l'ISS comparée à la photo de Pettit

- **Réalisé :** e2e `iss-moonset` (la caméra libre le long de l'azimut de la Lune, par l'éphéméride du jeu) ; la photo
  ISS006-E-45773 mesurée ; planche `R2/iss-lune-photo.jpg`.
- **Preuves (mesuré) :** photo H/L 0,55, plus large à 0,56 ; jeu 0,555, plus large à 0,57, pour la Lune à −19,42° vraie.
- **Limites :**
  - Le moment exact n'est pas vérifiable (horloge de l'appareil).
  - Couleur trop rouge dans le jeu, à examiner.

## 2026-11-05T02:59Z — Q6 : la couleur de la Lune vue de l'ISS, examinée

- **Mesuré :**
  - le rougissement du haut vers le bas du disque est le même sur la photo et dans le jeu (×1,46 contre ×1,55 sur le rouge,
    ×0,68 contre ×0,70 sur le bleu) ;
  - une seule balance des blancs ramène le jeu sur la photo à 5 % près : le « trop rouge » était la balance de l'appareil.
- **Écart réel restant :** le ciel du limbe à côté de la Lune vaut 17 % de la Lune dans le jeu, contre 3,8 % sur la photo.
  Une piste, non corrigée.

## 2026-11-05T03:02Z — Q6 : le ciel du limbe vu de l'ISS, premières pistes

- **Mesuré :**
  - le point tangent est à l'ombre de la Terre (Soleil à −7,4°, ombre jusqu'à 54 km) ;
  - la diffusion multiple tabulée n'explique pas l'excès de ciel : 0,172 avec la table, 0,234 sans.
- **Réalisé :** e2e `iss-moonset` fiabilisé (tables attendues, prise de chauffe, `MO_STEPS`, `MO_JS`).
- **Limites :** l'excès (17 % contre 3,8 %) n'est pas expliqué ; pistes : aérosols en rétrodiffusion, ozone, intégration le
  long du limbe.

## 2026-11-05T03:05Z — Q6 : la transmission du limbe mesurée dans le jeu, physique

- **Mesuré :** la Lune au ras du limbe vue de l'ISS, T = 0,64 / 0,40 / 0,23 (rouge, vert, bleu), soit τ_vert = 0,92 ≈ US76 à
  environ 16 km de hauteur tangente ; le rapport rouge/vert suit Rayleigh. L'hypothèse d'un trajet trop épais est réfutée :
  la couleur de la photo est sa balance des blancs.
- **Reste :** la lumière diffusée par le limbe, environ 4,5 fois trop forte à côté de la Lune ; il faut un modèle de
  référence.

## 2026-11-05T03:30Z — R6, C10 (Q5) et R4 commencé (§7 architecture, §8 performance ; commit e9343856)

- **R6a-ciel, implémenté :** sous un mirage, chaque couleur prend sa propre direction dans les tables de l'œil. Écart mesuré
  dans les tables : 10–20″ en mer chaude, jusqu'à 369″ sous une inversion à 30 m. À l'image (e2e `mirage-sun`, ce Mac),
  l'effet n'est pas départagé : bloom, HMD et plancher 8 bits du vert le masquent. Le rayon vert reste à mesurer sur une
  lecture HDR.
- **C10, mesuré sur kerr-mini :** la marche prolongée en extinction seule partout coûtait +0,8 à +1,3 ms à la passe des
  nuages (couvert, orage), sans changement à l'image (`sun-behind-deck` 0,982 contre 0,983). Elle est limitée aux rayons à
  moins de 1,4° du Soleil ; ce surcoût restreint n'a pas été remesuré. La couverture sous-pixel a été essayée : effet sous
  le bruit (572 pixels changés contre 3 397 de bruit), retirée.
- **R4, premier lot :** table de relèvement (CPU, worker, `TABLE_LIFT`) et R4a dans la marche du traceur, testés en
  unitaire. Rien n'est relevé à l'image tant que R4b (tous les rasters et lecteurs) n'est pas fait (`liftOn` coupé,
  décision 15).
- **Limites :** aucune image relevée vérifiée ; le coût de R4a est non mesuré (présence du code : +100 à +150 lignes
  inlinées).

## 2026-11-05T03:55Z — R4 : le sol relevé par l'air, implémenté et mesuré, encore coupé ; R5 commencé (§7, §8 ; commits a2ee44a5, f6cdaef7, 5338002a)

- **R4 (contrat C0-3) :** relief raster, décor, appareils et traceur relevés à la projection seule, par une même fonction
  (table + polynôme). `rasterPoint` défait le relèvement.
  - **Mesuré :** le Mont-Blanc à 78 km depuis Lausanne monte de 19 px en raster comme au traceur (table : 19,5–21 px ; bruit
    0 px).
  - Depuis l'ISS, le sol au limbe est relevé de 2,63′, contre 2,7′ par Bouguer : la corde exacte corrige une approximation
    plate qui donnait 0,79′.
  - La côte de Gibraltar en mouvement : aucune traînée ajoutée (`ghost`).
  - **Coût sur M1 : environ +1 ms**, non résolu. `liftOn` reste coupé par défaut (décision 15).
- **R5 :** les airs de Vénus (VIRA) et de Titan (Huygens), avec leurs gaz et leur dispersion, et la déviation au limbe par
  Abel, testés. `planetBend` dévie la bande du limbe vue d'orbite (déviation verte, dispersion des couleurs). Un e2e de
  l'auréole est en cours.
- **Limites :** décor non vérifié en image au téléobjectif ; auréole non encore observée ; rien de tout cela n'est mesuré
  comme gain de qualité perçue.

## 2026-11-05T04:10Z — R5 : l’auréole de Vénus observée (commit 1345031a)

- **Observé** (e2e `venus-aureole`) : au deuxième contact d'un transit, vu de 600 000 km, l'arc de lumière solaire déviée
  par l'air de Vénus apparaît sur le limbe côté Soleil, avec la déviation seulement. Luminance du limbe côté Soleil : 80,7 et
  55,4 avec, contre 40,5 sans ; le limbe opposé ne change pas.
- **Défaut ouvert :** un firefly carré d'environ 6 px sur l'arc ; la couverture du disque à travers la loupe n'est pas
  rendue.
- **Non mesuré :** le coût, nul hors de la bande par construction.

## 2026-11-05T04:20Z — R6b : les mirages d'après la météo, go limité (commits 3839a245, ad4f781a, c7d4ecf6)

- **Recherche :** les modèles (ERA5, GFS) sous-estiment les conduits et ne résolvent pas les couches de mirage ; aucune
  prévision publiée de la forme d'un mirage. Recommandation : un go limité, un profil plausible jamais présenté comme
  observé. La décision finale revient à Sam.
- **Implémenté :** température de la mer (API marine) et T à 950 hPa (prévision) ajoutées aux requêtes existantes ;
  `mirageFromWeather` (profil, force, confiance) ; réglage Mirages « D'après la météo » ; profils forcés dosés ; TARS dit la
  confiance (`get_weather.mirage`).
- **Vérifié :** les tests unitaires (classifieur, réglages, i18n, TARS) ; les deux API acceptent les variables ; un exemple
  réel au large de Biarritz (mer chaude, force 0,2–0,84).
- **Non vérifié :** l'image en jeu avec ce choix ; aucun cas documenté comparé.

## 2026-11-05T04:28Z — Q6 : le limbe vu de l'ISS refermé ; R6a-terrain estimé ; Q9 P10 examiné (commits a974a091, 191516ad, 19c251c7)

- **Q6 :** une intégrale indépendante de diffusion simple, sur le rayon de la photo de Pettit, donne un rapport ciel/Lune de
  0,31 au vert à 16 km, contre 0,17 dans le jeu. Le ciel du jeu n'est pas trop lumineux ; l'écart à la photo (0,038) est hors
  du modèle de ciel. Aucun réglage n'a été fait.
- **R6a-terrain :** méthode, coût borné et quatre lots estimés (3 à 4 jours), à décider par Sam.
- **Q9 P10 (`shader-f16`) :** non entrepris (débordement du f16 près du Soleil dans `taau`, gain attendu sous le bruit).

## 2026-11-05T04:31Z — Q9 P9 : le gain borné par la mesure (commit 02c4e418, §8)

- **Mesuré sur kerr-mini :** le matériau raster suit la part du sol (environ 28 ms pour un écran plein en 1080p) ; les
  groupes vides du ciel coûtent environ 0,7 ms, la passe d'eau sans eau 0,4 à 0,5 ms. P9 rapporterait au plus environ
  1 ms ; il n'est pas construit (liaisons de stockage pleines).
- **Pour les 60 images/s :** le levier est le coût par pixel du matériau, pas le lancement des groupes vides.

## 2026-11-05T05:54Z — Q5 P8 : la passe des nuages −10 % dans l'orage (commits f84e3c4e, et la généralisation ; §8)

- **Mesuré sur kerr-mini (M1) :** les couches de la météo marchées dans l'ordre où le rayon les rencontre, rien derrière une
  couche opaque. Passe des nuages : orage 28 → 25 ms (−2,7 ms), couvert 14 → 12,7 ms (−1,3 ms). Image identique à la précision
  du bruit (PSNR A/B dans celui de deux prises identiques).
- **Reste :** 25 ms dans l'orage sur M1, loin du budget à 60 images/s ; le coût de l'échantillon est la prochaine cible.

## 2026-11-05T06:01Z — Q5 P8 et Q7 L7b (commits b9467aa2, 1a6fd126, 686f0e4a, 9ee29cb2 ; §8, §19)

- **P8 :** les couches de nuages marchées dans l'ordre de rencontre, rien derrière une couche opaque : orage −2,7 ms (−10 %)
  et couvert −1,3 ms sur M1, image identique au bruit près. L'éclairage réutilisé derrière 90 % d'opacité (−0,75 ms) est
  retiré : l'image changeait au-delà du bruit.
- **L7b (étude, décision 19) :** sur 4 tuiles IGN à Versailles, l'image seule prend les ardoises pour des ombres (no-go). Avec
  la porte des ombres prédites par les bâtiments BD TOPO, plus aucun toit n'est touché, le bruit vaut 0,57 et le halo 0,53 m
  (critères tenus). Restent k sous-estimé, la canopée et la double ombre au couchant à vérifier en jeu. Recommandation : go
  pour la suite, à confirmer par Sam.

## 2026-11-05T06:04Z — Q7 L7b : l'étude du dé-éclairage menée à quatre phases (commits a4d4491b à d620bf37 ; §19)

- **Mesuré hors du jeu** (4 tuiles IGN, Versailles) : la porte des ombres prédites par la canopée LiDAR et la BD TOPO retrouve
  le Soleil de la prise de vue (IoU 0,68) et ne touche ni toits ni couronnes. Le k apparié par matériau divise par ~4 l'erreur
  de relèvement par cellule (facteur 1,12). Halo 0,53 m et bruit 0,88 : critères tenus.
- **Recommandation :** go pour un prototype dans le jeu, la décision finale après plusieurs zones et la prise au couchant ;
  décision à Sam. Le test cellule par cellule ne porte que sur 6 cellules.

## 2026-11-05T06:14Z — Q7 : sources déclarées (G1/G2) et piste usée (B4) (commits 05fc3bdb, 7ab6049e ; §19)

- **G1/G2 :** les 14 sources du sol de la Terre déclarent projection, datum vertical, modèle, résolution, date, validité et
  repli (`sources.ts`, testé) ; `overEllipsoid` porte la frontière WGS84 (max(H, 0) + N).
- **B4 :** la piste usée (gomme en stries, réparations, joints, vieillissement), vue au Bourget en e2e. Le coût n'est pas
  mesuré (lecture A/B invalide). Le premier jet ne compilait pas (`patch`, mot réservé de WGSL), comme Sam l'a vu ; c'est
  corrigé.

## 2026-11-05T06:23Z — Q7 L9 : la neige de saison sur le sol proche (commit 5f87c544 ; §19)

- **Implémenté et vu en e2e :** une même neige de saison sur le sol tracé et le sol raster, réglée par la déclinaison du
  Soleil ; la forêt au tiers ; routes et pistes dégagées. Au-dessus d'Annecy le 15 janvier, le relief au-dessus d'environ
  900 m est enneigé ; rien en juillet ni sans la fonction.
- **Limites :** pas de décalage saisonnier ; les toits, les arbres en 3D, l'herbe et les cartes lointaines pas encore
  enneigés ; aucune observation réelle de la neige ; coût non mesuré.

## 2026-11-05T06:34Z — Q8 C8 : la neige qui tombe (commit db5e8551 ; §19, météo)

- **Implémenté et vu en e2e :** sous 1 °C à la caméra, la précipitation tombe en neige (flocons blancs, lents, verrière
  sèche). Température du METAR ou du modèle, sinon une climatologie testée, refroidie avec la hauteur au-dessus du géoïde. À
  Chamonix sous la météo « pluie » : de la neige le 15 janvier, de la pluie le 15 juillet.
- **Limites :** flocons vus en traits (l'avion glissait à 18 m/s) ; climatologie sans continentalité ; le premier lieu de
  l'e2e sans précipitation, cause non trouvée.

## 2026-11-05T06:36Z — Q8 C8 : les traînées persistantes (commit ecc2d7c0)

- **Implémenté et testé :** la vie des traînées de moteur va de 150 s à 30 min selon le cirrus de la météo (signe d'un air
  sursaturé par rapport à la glace). Non vu en image ; le cisaillement par le vent n'est pas modélisé.

## 2026-11-05T07:03Z — Décision 42 : la carte d'ombre de l'avion en cache, et la mesure de cadence corrigée (commit 868cacf6)

- **Contribution (§8 performance, mesure) :** la carte d'ombre de l'avion piloté est gardée tant que la lumière ne tourne pas
  de plus de ~0,3° par rapport à lui. Son repère est attaché à l'avion. Fichiers : `src/ship.ts`, `src/shaders/ship.wgsl`,
  `src/renderer.ts`, e2e `ship-shadow-cache`.
- **Mesuré** (kerr-mini M1, cockpit dans l'orage, sur les images terminées par le GPU) : 60 ms avec ou sans le cache, aucun
  gain de cadence ; image identique. En vol, la clé change à chaque image (turbulence) : le cache ne sert qu'à l'arrêt.
- **Correction importante :** le « cockpit à 4–6 images/s » et le « ×10 de l'orage » venaient de la somme des horodatages des
  passes du profileur. Sur Apple, ces horodatages se chevauchent. Mesuré sur les images terminées : le cockpit coûte ~13 ms
  (45 → 58 ms) et la cadence est de 16 à 17 images/s. Les mesures de cadence doivent compter les images terminées.
- **Reste :** répartir les 60 ms de l'orage sur M1 en retirant les passes une à une (images terminées), au lieu de lire les
  horodatages.

## 2026-11-05T07:13Z — Q7 L7b : le prototype de dé-éclairage des orthophotos dans le jeu (commit e9403b40)

- **Contribution (§7 matériaux explicites, « préparer les données avant la frame ») :** les ombres portées des photos IGN z 17–18
  retirées avant l'upload, dans un worker dédié, d'après le MNH du LiDAR ; la photo d'origine reste affichée jusqu'à son
  remplacement par la version relevée. Fichiers : `src/system/ortho-delight.ts`, `earth-tiles.ts`, `tile-decode.ts`, réglage
  `orthoDelight` (éteint par défaut), e2e `ortho-delight`, `docs/progress/refraction-horizons/Q7.md`.
- **Vérifié :** unitaires (Soleil et k retrouvés sur une scène construite) ; e2e sur ce Mac à Versailles, Paris et Fontainebleau :
  32 tuiles relevées sur 32, 70 à 110 ms par tuile hors du fil de la page, l'image changée bien au-delà du bruit (23–28 dB
  contre 38–43 dB). Observé : rues et cours relevées, toits intacts ; les cours profondes de Paris restent en partie sombres.
- **Non mesuré :** le temps d'image, le halo et le bruit dans le jeu, la double ombre au couchant (le go/no-go final), un
  village.
- **Prochaine étape :** la prise au couchant avec le décor 3D pour le go/no-go final de Sam, puis Q8 VIPER B5 (couvert bas
  près des pistes).

## 2026-11-05T07:21Z — Q7 L7b : la double ombre au couchant (commits 19065b6a, 724fab26)

- **Observé** (e2e `ortho-delight`, ce Mac) : vue de 200 m au couchant, avec le décor 3D, le test n'est pas concluant (le sol est
  caché). Au ras de la pelouse du Champ-de-Mars (40 m, arbres 3D), la double ombre de la photo disparaît une fois relevée ; seules
  restent les ombres du jeu. Une vue seulement ; ni le halo ni le bruit mesurés dans le jeu.
- **Corrigé :** le Soleil de la photo est borné à 28–70° de hauteur (un faux Soleil à 17° avait été accepté à Sceaux).
- **Reste pour le go/no-go final de Sam :** un village, le halo et le bruit mesurés dans le jeu, le coût d'image sur M1.

## 2026-11-05T07:52Z — Q8 VIPER B5, premier palier, et l'herbe des aérodromes (commit 25587cd7)

- **Contribution (§19 l'expérience au roulage et en vol bas ; « une responsabilité commune ») :**
  - **corrigé :** le contour entier d'un aérodrome n'est plus une surface revêtue, et l'herbe des aérodromes revient au gazon,
    aux cailloux et au couvert ;
  - **construit :** un couvert bas en instances, sur une grille de sol commune avec le gazon (`GrassGround` généralisée).
- **Mesuré** (e2e `low-cover`, ce Mac) : +1 à +2 ms, pour un effet presque invisible au roulage et à 40 m. Le réglage reste
  éteint par défaut (prototype) ; aucun gain d'image n'est revendiqué.
- **Non vérifié :** l'effet de la correction de l'aérodrome sur le matériau du sol, hors couvert ; aucune mesure sur M1.
- **Prochaine étape :** Q8 D1 (trafic, lignes HT, éoliennes) ; un palier utile de B5 attend un choix de Sam (anneau proche
  dense, buissons dans le système des arbres, ou laisser la vitesse au détail du sol L8).

## 2026-11-05T07:56Z — Q6-ISS ISS0 classé ; Q8 D1 : la source des lignes HT et des éoliennes (commits 722e1559, f8e6cfcc)

- **ISS0 (documenté, observé) :** la capture du 4 novembre est classée par caméra et par plages UTC. Sen compte quatre vues
  (horizon, nadir, Dragon, structure et Soleil) ; la NASA, une caméra fixe. Les extraits de calibration et de validation sont
  choisis ; la planche NASA est versée au dépôt.
- **D1 (trouvé, vérifié par lecture de trois carreaux) :** le `base.pmtiles` d'Overture, lisible par plages HTTP comme les
  bâtiments Overture, fournit les éoliennes (hauteur, moyeu, rotor), les lignes HT, les pylônes et les poteaux. Conception
  écrite dans Q8.md ; rien n'est encore rendu.
- **Prochaine étape :** les éoliennes dans le décor (maillage par le chemin des bâtiments maillés, rotor orienté au vent),
  puis les pylônes et les câbles.

## 2026-11-05T08:07Z — Q8 D1, premier palier : les éoliennes dans le décor (commits f2f02c03, 81a361d4)

- **Contribution (§7 « socle raster, matériaux explicites », §19 le vol bas) :** les éoliennes réelles (Overture/OSM) sont
  maillées dans le décor, écrites dans la cible de visibilité commune (code 57) et ombrées par `shadeLite` : la même lumière,
  le même air et les mêmes ombres que les bâtiments, sans passe à part. Le crédit ODbL d'Overture s'affiche.
- **Vérifié :** unitaires, tests du décor et du raster, budgets des noyaux (un relevé de 140 lignes) ; e2e `wind-turbines` sur ce
  Mac : 7 éoliennes vues en Beauce à 2–3 km, aucune erreur GPU.
- **Non mesuré :** le coût d'image ; leurs ombres vues de près.
- **Reste :** la rotation face au vent, la portée lointaine (au-delà de 3,5 km), le balisage de nuit, puis les pylônes et les
  câbles.

## 2026-11-05T08:17Z — Q8 D1 : rotors qui tournent, face au vent, jusqu'à 15 km (commits b40dbab6, 4161de3d, 047c157f)

- **Contribution (§7, la surface commune ; §19, le paysage vivant) :** première géométrie animée du décor. Les pales tournent
  selon l'horloge du jeu, figée avec lui, et les têtes font face au vent de la météo, dans `meshVertex` (vue et ombre). Les
  éoliennes vont jusqu'à 15 km (160 au plus), voilées par l'air commun.
- **Vérifié :** unitaires, budgets ; e2e `wind-turbines` (ce Mac) : l'angle des pales change en une seconde ; vent du 322°,
  rotors orientés ; 160 éoliennes sur l'horizon de la Beauce ; aucune erreur GPU.
- **Non mesuré :** le coût d'image ; le fantôme des pales dans l'historique en mouvement (le décor n'a pas de vecteurs de
  mouvement).
- **Reste à D1 :** le balisage de nuit (une liste de feux ponctuels), les pylônes (le treillis), les câbles (la couverture
  sous-pixel), le trafic routier et ses phares, les vignes et les vergers.

## 2026-11-05T08:29Z — Q8 D1 : les pylônes des lignes HT (commit 1a631ac3)

- **Contribution :** les lignes HT sont visibles dans le paysage, toujours dans la surface commune du raster : un treillis ajouré
  près, une silhouette pleine au loin (sans scintillement), en acier galvanisé.
- **Vérifié :** unitaires, budgets ; e2e (ce Mac) près d'une ligne de 225 kV en Beauce : 126 pylônes, treillis visible.
  Corrigé en chemin : la nacelle et les pales des éoliennes étaient codées « pont ».
- **Limites :** les places sont interpolées (les lignes d'Overture z 13 sont simplifiées) ; ni câbles, ni coût mesuré.
- **Suite :** les câbles, le balisage de nuit, le trafic et ses phares, les vignes et les vergers.

## 2026-11-05T08:42Z — Q8 D1 : les câbles HT (commit 1bfd087f)

- **Contribution :** les lignes HT sont complètes (pylônes et câbles). Les fils sous le pixel sont rendus par couverture
  stochastique, que l'historique temporel moyenne : la surface commune garde des traits fins sans scintillement. C'est un
  procédé réutilisable pour d'autres objets fins (haubans, clôtures).
- **Vérifié :** unitaires ; e2e (ce Mac) : 59 portées, traits fins et continus. **Leçon :** une liaison lue au fragment hors de
  sa visibilité invalidait tout le dessin des maillages sans erreur comptée ; il faut juger l'image.
- **Non mesuré :** le coût. **Reste :** le balisage de nuit, le trafic et ses phares, les vignes et les vergers.

## 2026-11-05T08:50Z — Q8 D1 : le balisage de nuit des éoliennes (commit 72e12217)

- **Contribution (§19, la nuit) :** les parcs éoliens ont leurs feux rouges synchronisés la nuit, rendus dans la surface commune
  (marque de visibilité, émission dans `shadeLite`), lisibles de loin.
- **Vérifié :** e2e de nuit (ce Mac). L'intensité a été réglée sur l'image en deux essais (halo, puis blanc brûlé).
- **Reste :** le feu blanc de jour, le trafic routier et ses phares, les vignes et les vergers ; puis Q6 et la suite du plan.

## 2026-11-05T11:27Z — Q8 D1 : le trafic routier ; la scène n'attend plus les données D1 (commit c13f6156)

- **Contribution (§19 le paysage vivant, la nuit ; §8 « préparer les données avant la frame ») :**
  - des voitures sur les grands axes réels, animées dans la surface commune, avec leurs feux de nuit ;
  - les carreaux d'infrastructure (Overture) sont demandés en parallèle dès le début de la préparation du décor. L'étape D1
    passe de 21,6 s à 0,1 s, et la scène est livrée à 54 s au lieu de 75 s à Allaines vu de 60 m (mesuré, une série).
- **Vérifié :** unitaires, budgets ; e2e de nuit : 153 voitures et leurs phares. Une erreur de TDZ, qui faisait perdre les
  routes et les bâtiments d'un carreau, a été trouvée et corrigée avant commit.
- **Non vérifié :** la peinture de jour, le coût d'image. Essai écarté le même jour : le marquage réactif des pales (aucun
  gain mesuré).
- **Reste :** les vignes et les vergers (utiles hors de France), les vecteurs de mouvement de la géométrie animée ; Q6 (ISS0
  en cours chez un agent, ISS1–5, fin d'I2) ; L8, L10.

## 2026-11-05T11:35Z — Q6-ISS ISS0 : la capture dense des caméras de l'ISS, classée et mesurée (commit b6ea49b9)

- **Contribution (§19, la référence réelle des vues ISS ; plan Q6-ISS, ISS0) :** une capture des directs NASA et Sen toutes les
  10 s pendant 30 min (159 + 157 images, hors du dépôt), classée par plages, avec l'instant incrusté de chaque image Sen. Elle
  donne pour la première fois le **mouvement apparent** du sol, qui servira de référence au défilement des vues ISS du jeu.
- **Mesuré (corpus du 5 novembre, outils jetables hors dépôt) :**
  - le direct Sen a 18 s de retard en médiane (de 12 à 21 s) ; l'altitude est lue sur 52 images (de 426,2 à 418,5 km) ;
  - le sol NASA défile à 33 px/s (sur 1280 px), uniformément : la caméra est fixe, proche du nadir, et ce n'est pas la
    caméra IDA-2 annoncée ;
  - dans la vue horizon de Sen, le sol remonte vers le limbe, de 1,4 à 8 px/s selon la hauteur dans l'image ;
  - les deux flux perdent le signal ensemble ; pendant les reprises, l'horloge de Sen continue au rythme du direct (ces
    images sont à exclure de la géométrie).
- **Documenté :** `docs/progress/refraction-horizons/Q6-ISS.md` (section « ISS0 — la capture dense »), planche NASA
  `Q6/iss0-dense-nasa.jpg`. Aucune image Sen dans le dépôt.
- **Non fait :** aucune modification du jeu ; aucune calibration ; le sens « vers l'arrière » de la vue Sen est une
  interprétation à vérifier en ISS1.
- **Reste d'ISS0 :** une capture dense des vues nadir et Dragon de Sen (absentes de ces 30 min) ; un pas de 10 s tenu (saisir
  les deux flux en parallèle) ; les « Previously recorded » de la NASA ; les tolérances. Ensuite ISS1 : situer les caméras sur le
  modèle de la station.

## 2026-11-05T11:40Z — Q6-ISS : ISS1 (registre des caméras) et ISS2 (premier calage) (commits e244378b, d1a0c46f, e2b78ecd)

- **Contribution (§19, les vues ISS fidèles aux directs) :**
  - un registre des caméras des directs dans le repère de la station : Sen sur Bartolomeo (lu dans le modèle de la NASA),
    la NASA probablement sur EHDC-5 d'Harmony ;
  - la caméra d'horizon de Sen calée par le limbe : champ de 95°, axe à 47,5° sous l'horizontale, roulis ≈ 0, résidu de 1 à
    2 px sur 14 images ;
  - le champ de la caméra nadir estimé à 32° d'après l'emprise annoncée par Sen.
- **Reste d'ISS2 :** le lacet, la caméra nadir sur les côtes, la caméra d'amarrage, la caméra NASA ; puis ISS3 à ISS5.

## 2026-11-05T11:57Z — Q7 L8 (VIPER B3) : les scans de détail du sol (commit 34ae5d3d)

- **Contribution (§7 matériaux explicites, §18 Basis/KTX2 consolidé, §19 vol bas et roulage) :**
  - cinq matériaux CC0 dans un tableau KTX2 linéaire, servis par la chaîne Basis existante (aucune dépendance nouvelle) ;
  - ils s'appliquent comme un rapport d'albédo à trois échelles sous la photo, sans en changer la teinte ;
  - les coordonnées monde restent continues quand le repère du décor se recentre.
- **Mesuré :** kerr-mini, +1,4 à +1,7 ms (+2,3 %) ; l'image change nettement (31,7 dB contre 40,6 dB de bruit) ; la luminance
  affichée baisse de 10 % de près (hypothèse non vérifiée : la courbe de rendu des tons). Réglage allumé par défaut.
- **Reste :** le matériau par la classe WorldCover, le tuilage stochastique, l'estompage en mouvement, la neige ; puis L10.

## 2026-11-05T12:02Z — Q7 L8, deuxième lot : le matériau des scans par WorldCover, la répétition cassée (commit 6a8fb1f3)

- **Contribution (§7 matériaux explicites partagés, §19 vol bas, roulage et marche) :**
  - le matériau du détail suit la classe WorldCover quand elle est connue (`surface.cover`), c'est-à-dire la même donnée que
    le reste du décor, et non plus seulement la couleur de la photo ;
  - pas de détail sur la neige ni sur l'eau ;
  - la répétition visible à 4 m est cassée par deux décalages mélangés selon un bruit d'environ 20 m.
- **Mesuré (kerr-mini, e2e `detail-scans`, la Beauce à 30 m, figé) :**
  - temps d'image : 67,5 et 67,4 ms avec le détail, 65,7 ms sans, soit +1,7 à +1,8 ms au total (avant ce lot : +1,4 à
    +1,7 ms) ;
  - écart d'image : 32,0 dB entre avec et sans, contre 45,2 dB entre deux prises identiques ;
  - budgets des noyaux `earth-raster` relevés à 7 960 lignes.
- **Documenté :** `docs/progress/refraction-horizons/Q7.md`, section L8 « Deuxième lot ».
- **Non vérifié :**
  - le scintillement en mouvement (pas d'estompage par `fwidth`, puisque le noyau de calcul n'a pas de dérivées) ;
  - la cause de la baisse de luminance de près (−10 %) ;
  - le rendu sur kerr-pc.
- **Suite :** L8, avec la neige et l'humidité météo sur le détail et une mesure en mouvement ; puis L10 (réverbères). Côté
  Q6-ISS, ISS2 reprend après la capture dense déléguée.

## 2026-11-05T13:45Z — Q8 L10 (lampadaires), premier palier ; Q7 L8 sous la neige de saison

- **Contribution (§7 éclairage partagé et données préparées hors frame, §19 vol bas de nuit, roulage et marche en ville) :**
  - des lampadaires plausibles le long des rues bâties, préparés par le worker (`src/system/streetlamps.ts`) : leur
    géométrie et une grille de lumière de 4 m, sans aucune lumière dynamique par lampe ;
  - la lumière des rues, près de la caméra, éclaire désormais l'albédo du sol au lieu de s'y ajouter en lueur uniforme ;
  - le détail du sol (L8) est coupé sous la neige de saison, et la neige suit la classe WorldCover au lieu de prendre les
    prairies pour des forêts.
- **Mesuré (e2e `street-lamps` et `detail-scans`) :**
  - Châteaudun la nuit, 1 440 lampes : sur kerr-mini, 53,7 / 52,6 ms avec, 54,0 ms sans, soit aucun coût mesurable. Les
    deux scènes ne sont pas strictement identiques (la première encore en rafraîchissement). L'image change nettement :
    18,3 dB entre avec et sans, contre 40,7 dB de bruit ;
  - Les Saisies en janvier : le détail n'est plus visible sous la neige (44,9 dB, contre 45,9 dB de bruit).
- **Incident :** une erreur de compilation WGSL (un paramètre `cover` redéclaré) a d'abord cassé le chargement. Sam l'a
  signalée ; elle est corrigée, et `bun scripts/check-wgsl.ts` (71 shaders sur 71) passe désormais avant chaque e2e.
- **Documenté :** `Q8.md` (section L10), `Q7.md` (section L8, troisième lot), planche `Q8/l10-lamps.jpg`.
- **Non vérifié :**
  - les mâts de jour ;
  - le comportement en mouvement ;
  - kerr-pc ;
  - les taches grises à bords droits dans la neige (des arbres WorldCover, supposés).
- **Suite :** L10 avec la teinte par quartier et les façades ; Q6-ISS ISS2, avec le lacet de l'horizon et une nouvelle
  capture nadir (Sen la diffuse vers 05:00 et 06:35 UTC).

## 2026-11-05T14:10Z — Q6-ISS ISS2, deuxième calage : le défilement du sol (commit 74857885)

- **Contribution (§19, des vues ISS fidèles aux directs ; Q6-ISS ISS2) :**
  - une méthode réutilisable : `scripts/iss-flow-yaw.py` cale le lacet et le champ d'une caméra fixe sur le défilement du
    sol, en modélisant la station en LVLH et le sol comme une sphère ;
  - la caméra horizon de Sen regarde vers l'arrière ;
  - la caméra NASA regarde le nadir, avec un champ de 36°. Ce n'est pas la vue vers IDA-2 que décrit le direct.
- **Mesuré (capture dense du 5 novembre, 9 paires par caméra) :**
  - horizon de Sen : lacet 180,7° (177,3–182,7°), directions à 1,1° près ;
  - NASA : bord droit de l'image vers l'arrière (89,0°), directions à 0,2° près, champ 36° (écart-type 3,6°).
- **Non vérifié :**
  - le sens direct ou miroir de l'horizon ;
  - la rotation de la Terre (non modélisée) ;
  - l'intervalle exact des images (lu dans les noms de fichiers, ±1–2 s, soit environ 10 % sur le champ) ;
  - le support de la caméra NASA (inconnu).
- **Suite :** caméra nadir de Sen (nouvelle capture vers 05:00 ou 06:35 UTC), caméra d'amarrage par le Dragon, puis ISS3.

## 2026-11-05T14:55Z — Q6-ISS ISS4, premier palier : les caméras des directs dans le jeu

- **Contribution (§19.13, parcours complet ; règle CLAUDE.md « mêmes actions métier pour TARS ») :** le joueur, TARS et
  l'API choisissent une caméra des directs de l'ISS par une seule action (`issCameraView`). Elle donne le cadrage natif du
  registre calé en ISS2, se sauvegarde avec la scène (`issView`) et permet de revenir à la vue d'avant, sans toucher à
  l'horloge.
- **Vérifié (e2e `iss-cameras`, ce Mac) :**
  - l'œil est sur l'attache, et la visée comme le haut de l'image sont à moins de 0,01° du registre ;
  - le champ horizontal est de 95° (Sen) et de 36° (NASA) ;
  - TARS produit le même état ; le retour ramène autour de l'ISS.
- **Constat :** l'attache de Sen, au centre de Bartolomeo, met la structure dans le haut de l'image, contrairement au
  direct. Elle reste à caler.
- **Non vérifié :** kerr-mini, kerr-pc ; le coût d'image de la vue (non mesuré) ; la comparaison image contre direct
  (ISS3 et ISS5).

## 2026-11-05T15:30Z — Q6-ISS ISS2, troisième calage : l'attache de l'horizon de Sen

- **Contribution (§19, des vues ISS fidèles aux directs) :** l'attache de la caméra d'horizon de Sen est ajustée sur la
  structure visible au-dessus du limbe, contre le maillage de la station du jeu (`scripts/iss-mount-fit.ts`). Résultat :
  [13,5 ; 12,0 ; 5,5] m, image en miroir, IoU 0,78. L'ancienne attache était noyée dans une pièce (IoU 0).
- **Vérifié :** e2e `iss-cameras` (ce Mac) ; dans le jeu, le limbe et l'espace sont en haut et la structure dans le coin.
- **Limites :** ajustement lâche (2–3 m) ; le jeu dessine la vue sans miroir ; pièces de la station au repos (panneaux et
  radiateurs non orientés comme au moment du direct).

## 2026-11-05T16:00Z — Q6-ISS ISS3, premier palier : la réponse mesurée (commit 17bf5ca0)

- **Contribution (§19, des vues ISS fidèles ; §7, un modèle d'air et d'eau partagé) :** la mesure jeu contre direct au même
  instant (e2e `iss-cameras` avec `ISS_AT`, `scripts/iss-response.py`) fait apparaître un défaut de rendu. Vu de l'orbite,
  l'océan du jeu est trop rouge et gris, et deux fois trop clair en vue oblique.
- **Mesuré :**
  - R/G de l'océan : 0,76–0,78 dans le jeu contre 0,35–0,54 dans le direct ;
  - luminance de l'océan : ×2,27 en vue oblique (Sen), ×1,17 au nadir (NASA) ;
  - contraste nuage / océan : ×0,40 sur la vue Sen.
- **Non fait :** aucun profil de caméra (il masquerait le défaut) ; la cause n'est pas cherchée ; les nuages ne sont pas
  comparés au nadir.

## 2026-11-05T16:25Z — Q6-ISS ISS3, deuxième essai : la cause de l'océan vu de l'orbite cernée

- **Constaté :** l'océan du jeu vu de l'orbite est trop clair et trop rouge. Ni la carte (océan (1, 3, 11)) ni le reflet du
  ciel sur la mer (`TUNE_GSKIP` 18944, aucun changement) n'en sont la cause. L'excès croît avec l'épaisseur d'air (×1,17 au
  nadir, ×2,05–2,27 en oblique), et sa couleur est trop rouge pour une diffusion moléculaire. Hypothèse : la lumière de l'air
  sur le trajet (aérosols ou diffusion multiple).
- **Non fait :** aucune correction du modèle d'air commun, qui sert aussi les ciels vus du sol ; cela demande une mesure sur
  ces vues et une décision de Sam.

## 2026-11-05T17:10Z — Correctif de l'ombre de l'avion ; Q6n refait avec les nuages (commit 7507fcf3)

- **Régression corrigée** (signalée par Sam) : la carte d'ombre de l'avion était dessinée dans le repère de l'avion
  (décision 42, 868cacf6), mais lue dans celui de la caméra par le sol, la station et les nuages. L'ombre au sol était
  tournée et vue de profil. La carte est revenue au repère de la caméra, et la pose de l'avion est entrée dans la clé du
  cache. Vérifié en image (e2e `ghost`, ce Mac).
- **Q6n avec les nuages** (`ghost`, place `manchaclouds`, 3 séries plus 1 sans nuages) : 4 à 6 recuits des hauteurs et 6 à 9
  redessins des cascades pour 60 images, comme sans nuages ; images 3 à 8 ms plus chères avec les nuages (ce Mac).
- **Ouvert** : le bord en peigne des ombres des bosquets, qui diffère entre le mouvement et la référence. Il domine le
  compte des « pixels plus sombres » (20 000 à 70 000) et n'a pas été examiné.
- **Leçon** : un changement de repère d'une carte partagée doit passer chez tous ses lecteurs. Le premier e2e
  (`ship-shadow-cache`) mesurait le coût du cache, pas l'image de l'ombre au sol.

## 2026-11-05T17:40Z — Q3 B4 revérifié : la route sur le sol raster

- e2e `raster-roads` relancé (La Mancha, ce Mac) : la route d'OSM est dessinée sur le sol raster quand la lecture des
  surfaces est active, et absente quand elle est coupée ; coût de la passe « earth lite » +0,98 ms (10,18 → 11,16 ms).
  L'écart signalé en Q6l ne se reproduit pas à cet endroit. Doc : `Q3.md`, « B4 revérifié ».

## 2026-11-05T18:30Z — L10 mesuré strictement ; Q6m, les peignes du relief isolés

- **L10** (kerr-mini, deux scènes reconstruites et chargées) : 53,6 ms sans lampes comme avec, aucun coût mesurable ; +28 % de
  luminance moyenne la nuit.
- **Q6m** : les ombres en peigne au sol sont isolées aux cascades du relief (`liteSkip` 4). Ni la carte des arbres, ni les
  ombres de contact, ni R4, ni les horizons n'en sont la cause. Elles existaient déjà au code de Q6n : Sam les a vues pendant
  la passe de contrôle. Ce n'est donc pas une régression, mais un défaut intermittent non résolu. Une seule image par série ne
  suffit pas pour le mesurer.

## 2026-11-05T19:00Z — Q6m : les peignes du relief comptés sur tout le vol

- La vue de débogage des ombres montre maintenant la visibilité du Soleil par le relief, et l'e2e `ghost` (`GH_COMBS`) compte
  le sol ombré à tort sur tout le vol. Résultat à La Mancha à midi : 8 images sur 12 au-dessus de 5 000 px, jusqu'à 130 000
  (9 % du sol). Les taches apparaissent et disparaissent d'une image à l'autre.
- Le défaut est donc fréquent, pas rare. La cause reste à établir : carte en retard ou relief différent entre la carte et
  l'image.

## 2026-11-05T19:45Z — Q6m résolu : les ombres en peigne du relief (commit b5dce51c)

- **Contribution (§8, stabilité en mouvement ; §19, vol rasant) :** les fausses ombres du relief sur la plaine en vol rasant
  sont supprimées. Les axes des cascades, refaits à chaque image sur la verticale à la caméra, faisaient lire la carte décalée
  de quelques mètres par image (|cam| ≈ 6,4·10⁶ m). Ils sont maintenant gardés avec la direction du Soleil.
- **Mesuré (e2e `ghost GH_COMBS`, La Mancha, ce Mac, chaque image comptée) :** 0 image sur 45 au-dessus de 2 000 pixels
  ombrés à tort, contre 25 sur 45 avant (jusqu'à 159 000), avec le même nombre de redessins (8 pour 45 images), donc sans coût
  ajouté.
- **Non vérifié :** kerr-mini, kerr-pc ; d'autres lieux et heures (Soleil bas, montagne).

## 2026-11-05T20:20Z — Q7 L8 : le détail du sol en mouvement mesuré

- **Scintillement** (`detail-scans DS_FLICKER`, ce Mac) : 0,19 niveau de gris d'écart-type temporel avec le détail, 0,079
  sans. C'est invisible : aucun estompage en mouvement n'est nécessaire à ce stade.
- **En vol** (`ghost`, La Mancha) : l'écart à la référence tient à la texture fine ; à l'œil, ni crénelage ni moirage.
- **Non vérifié :** kerr-mini, sols plus contrastés (roche, asphalte).

## 2026-11-05T21:00Z — Q8 L10, deuxième palier : teintes par quartier et façades

- La nuit, les lampadaires ont une teinte par quartier (sodium orangé ou LED) et éclairent les façades proches, à partir de la
  même grille de lumière : aucune lumière par lampe. Vu à Châteaudun (ce Mac) : luminance moyenne +55 %.
- **Non mesuré :** le coût sur kerr-mini.
- **Limites :** les murs sont éclairés sur toute leur hauteur, et les quartiers sont tirés au hasard.

## 2026-11-05T22:15Z — Q8 D1, neuvième palier : vignes et vergers

- Les polygones de vigne et de verger d'OpenMapTiles sont dessinés en rangs sur la photo, par la grille des décalques et sans
  nouvelle ressource. Vu dans le Douro (ce Mac), 851 polygones dans la scène.
- **Défaut relevé, non corrigé :** le rectangle « France » de l'imagerie traite les régions voisines (nord de l'Espagne, nord
  de l'Italie, Suisse, Belgique, ouest de l'Allemagne) comme couvertes par l'IGN, et y coupe les décalques.
- **Non mesuré :** le coût.

## 2026-11-05T23:00Z — Q6-ISS ISS3 : l'écart de couleur de l'océan était un artefact de mesure

- Les captures de ce Mac passent par la chaîne HDR de son écran (`hdrMap`). Sur kerr-mini (SDR), l'océan du jeu vu de
  l'orbite n'est ni trop rouge ni gris : il est un peu trop bleu, plus sombre et moins contrasté que les directs. Ces écarts
  relèvent de la réponse de caméra. L'hypothèse d'un défaut de l'air est réfutée (A/B aérosols et diffusion multiple).
- **Suite :** le profil par caméra de la vue ISS, ajusté sur ces mesures SDR.

## 2026-11-05T23:45Z — Q6-ISS ISS3 : premier profil par caméra

- **Fait :** chaque caméra ISS a sa réponse (exposition, gains, contraste, saturation), appliquée dans sa vue, et le grade des
  vols n'y est plus appliqué. L'ajustement est fait en SDR sur kerr-mini, au même instant que le direct.
- **Mesuré :** NASA calée (océan à ±2 niveaux sRGB) ; Sen proche (océan ×1,23, nuages ×0,66, écart en partie dû aux nuages du
  jeu, différents de ceux du jour).
- **Non fait :** nuit, terminateur, mouvement (ISS5).

## 2026-11-06T00:15Z — Q6-ISS ISS5, premier palier : mouvement et terminateur

- **Mouvement :** le défilement du sol dans les vues du jeu concorde avec les directs, à 1 % pour la NASA et à 10–20 % par
  bande pour Sen. C'est la vérification indépendante du calage d'ISS2.
- **Terminateur :** avec les éléments du jour, injectés par `__bh.iss.setElements` (la page de test gardait ceux du
  1er octobre), la hauteur du Soleil au-dessus du limbe et l'heure d'entrée dans l'ombre concordent avec un calcul indépendant
  et avec le compte à rebours de Sen.
- **Écart restant :** quelques degrés de cadrage au bord de la vue d'horizon, probablement la distorsion du grand angle.

## 2026-11-06T01:00Z — Q6-ISS ISS5, deuxième palier : la caméra d'horizon recalée par le Soleil

- La trajectoire du Soleil pendant le coucher, comparée à sa direction calculée dans le repère de la station, recale la caméra
  d'horizon de Sen : champ 91°, visée à 45,5°, lacet 179°, image directe et non en miroir. Dans le jeu, la structure et le
  limbe sont maintenant au même endroit que sur le direct ; le Soleil tombe au bord haut, à ~70 px de sa place réelle.
- La distorsion du grand angle est écartée. L'attache est refaite, avec un ajustement lâche.
- **Non fait :** la nuit, le nadir de Sen, la caméra d'amarrage, le coût, l'attitude réelle de la station.

## 2026-11-06T01:45Z — Q6-ISS ISS5 : nuit et coût

- La nuit, Sen garde son exposition de jour (noir, comme le direct) et la NASA montre un plancher de bruit magenta proche de
  celui du direct. Mesuré sur kerr-mini à 11:20 UTC.
- Le coût des vues ISS suit celui de la scène ; non conclu sur une seule série.
- L'ajustement de couleur de jour est à refaire à la vraie position de l'ISS, maintenant que la page reçoit les éléments du
  jour.

## 2026-11-06T02:15Z — Q6-ISS ISS3 : profil de jour recalé à la vraie position

- NASA : océan à quelques niveaux sRGB du direct, balance R/G et B/G identique. Sen : contraste identique (25,7), océan et
  nuages à ×0,81. La teinte de la mer vue en oblique reste plus rouge chez Sen : c'est le rendu de la mer, pas la caméra.

## 2026-11-06T02:30Z — Q6-ISS : coût des vues ISS

- Deux séries identiques sur kerr-mini : les vues ISS (21,3–22,4 ms) ne coûtent rien de plus que la vue autour de la station
  (21–23 ms).
- **Reste de Q6-ISS :** la caméra nadir de Sen et la caméra d'amarrage, qui demandent des captures du direct au bon moment.

## 2026-11-06T03:00Z — Q6-ISS : la caméra nadir de Sen, premier essai

- Avec les images à la minute du 4 novembre, la vue nadir du direct à 05:06:53 voit la côte de Morondava, à environ 100 km
  derrière le point sous l'ISS. Deux explications restent possibles : une visée inclinée vers l'arrière ou une avance de
  l'heure incrustée. La capture dense programmée (6 novembre, 04:45 UTC) départagera.
- Outils : `ISS_EXTRA` et `ISS_TILES` dans l'e2e, et les éléments orbitaux du 4 novembre en fixture, puisque CelesTrak refuse
  les téléchargements répétés.

## 2026-11-06T03:30Z — Q6-ISS ISS2 : la caméra d'amarrage de Sen, premier calage

- Plan large du 4 novembre 03:21 : champ 74°, axe à 15° sous l'horizontale, roulis −7° (limbe à 1,1 px) ; lacet −45°, tiré de
  la position du Dragon. Dans le jeu, l'inclinaison, le roulis et le Soleil concordent.
- **Limites :** le modèle n'a pas de vaisseau amarré ; le zoom des plans serrés n'est pas modélisé ; environ 16° d'écart en
  hauteur restent non expliqués (tangage réel ou hauteur de l'attache).

## 2026-11-05T19:45Z — Q6-ISS : le Dragon amarré, la caméra d'amarrage recalée

- **Contribution (§19, les vues ISS fidèles aux directs) :** une Crew Dragon procédurale à IDA-2, effacée quand le vaisseau
  piloté approche (le port du joueur). L'écart de 16° de la caméra d'amarrage venait de son attache : recalée, elle place le
  Dragon à 6,5° au-dessus de l'axe, contre 6,3° sur le direct.
- **Vérifié :** e2e `iss-cameras` (ce Mac) ; tests unitaires ; 71 shaders compilés.
- **Limites :** forme simplifiée ; occupant fixe ; zoom non modélisé ; une structure de premier plan absente du direct.
- **Reste :** la caméra nadir de Sen, capture programmée le 6 novembre à 04:45 UTC.

## 2026-11-05T20:15Z — Q6-ISS : la vue d'amarrage sans premier plan parasite

- L'attache de la caméra d'amarrage a été recherchée parmi 900 positions, en lançant les rayons contre le maillage de la
  station. Retenue : [14,6 ; 8,5 ; 4,4]. Le bas de l'image est dégagé comme sur le direct, et le Dragon est centré à 8,0°
  au-dessus de l'axe, contre 6,3° sur le direct.

## 2026-11-05T19:39Z — Relecture des plans et point d'étape vers la destination (session documentaire)

- **Contribution à la destination :** §20.2, §20.5 étape 1 et §20.8 (réconcilier les contrats, relier les chantiers à
  la cible, préparer le choix du jalon J0 ou J1). Documentation seulement.
- **Réalisé :**
  - [PLAN-REFRACTION-HORIZONS.md](docs/PLAN-REFRACTION-HORIZONS.md) :
    - l'en-tête corrigé ;
    - **§0.2** : l'état réel de chaque phase et la cadence mesurée ;
    - **§8.0** : le reste réordonné en cinq groupes (contrats, attribution du coût, fondations, trancher et retirer,
      richesse au budget) ;
    - §11 : les questions ouvertes remises à jour ;
    - §12 : l'historique des 4 et 5 novembre.
  - [Analyse stratégique](docs/ANALYSE-STRATEGIE-RENDU-2026-11-03.md), **§21** : ce qui a convergé, ce qui n'a pas
    avancé, la gouvernance des documents, cinq candidats au prochain jalon et une recommandation (A, J0, puis B, J1).
  - [Plan aurores](docs/PLAN-AURORES-MAGNETOSPHERES.md) : la relecture du 5 novembre (rien de commencé, un seul
    changement d'aurore chez Alex, `964bfec`), le scénario d'époque au-delà de 2030, la géométrie et la brillance
    séparées, le raccord aux tables d'air de Q5 et à la profondeur finale.
  - [Recherche de données](docs/RECHERCHE-DONNEES-SCIENTIFIQUES-AAA-2026-11-03.md) : l'état des lots, dont A commencé
    avec `sources.ts` ; restent ouverts `max(H, 0) + N` pour les terres sous le niveau de la mer et le datum de
    swissALTI3D.
- **Preuves :** lecture des fiches `docs/progress/refraction-horizons/*.md` jusqu'à leur fin, de `git log` et du code
  (valeurs par défaut dans `renderer.ts` et `settings.ts`, `auroraLight`, `sources.ts`) ; `origin/master` d'Alex relu
  après un `git fetch`. Aucun code modifié ; aucun test, e2e ni benchmark lancé. Les chiffres de cadence cités viennent
  des fiches, sans nouvelle mesure.
- **Limites / transitions restantes :**
  - aucun lot de fondation ni de bascule n'est encore engagé ;
  - aucune vue de vol chargée ne tient le palier de 40 ms sur kerr-mini, et la répartition de la frame entre ses
    passes n'est pas connue ;
  - ce journal, l'analyse stratégique et l'ajout à `CLAUDE.md` ne sont toujours pas commités ;
  - **correction des entrées précédentes** : les entrées datées « 2026-11-06T00:15Z » à « 03:30Z », et celles du
    5 novembre après 19:39Z, sont postérieures à l'heure de cette entrée. Leurs heures ne sont pas en UTC, ou sont
    erronées. Leur contenu n'est pas remis en cause.
- **Suite :** la décision de Sam sur le prochain jalon (analyse §21.4).

## 2026-11-05T20:20Z — T7 : la terre en mer pendant le chargement ; ILS : la piste choisie (commits 66fb3d8a, cf49259c)

- **Contribution à la destination :**
  - §7.4 (une surface finale exploitable : l'eau décidée sur les données publiées, pas sur un maillage en retard) et §7.19
    (une continuité de service pendant le streaming) ;
  - §19 : les fonctions produit accessibles à TARS par la même action. Le choix de piste de l'ILS sert la roue, TARS et
    `__bh`.
- **Réalisé :**
  - `trace.wgsl` (`shadeLite`) : le test de la mer prend le plus bas de la hauteur du maillage et de celle des données
    (`earthH`). Cette lecture n'a lieu que sur une côte basse, là où le maillage dépasse 0,3 m.
  - `shadeWater` : pas d'écume sur un maillage resté « terre ».
  - `controller/ils.ts` (`ilsRunways`, `pickRunway`, option `runway` d'`ilsStart`), `world/fieldsite.ts`
    (`worldRunwaySites`), la roue (`main.ts`), l'outil `approach` de TARS.
  - e2e `coast-loading`, `coast-cost`, `ils-runway` ; fiche [T7.md](docs/progress/refraction-horizons/T7.md), huitième lot.
- **Preuves :**
  - **observé** : le vol autour de Porquerolles avant et après, planche `T7/terre-en-mer-porquerolles.jpg`. Le diagnostic
    temporaire montrait la mer reconnue par le masque et par les données, mais pas par le maillage ;
  - **mesuré** sur kerr-mini (A B B A, Camargue) : earth lite 22,06 → 22,09 ms, earth water 27,6 → 27,8 ms, dans le bruit ;
  - **vérifié statiquement** : 71/71 shaders, `tsc`, Biome sur les fichiers touchés, 27 tests unitaires de l'ILS ;
  - **e2e** : `ils-runway` vert, en fenêtre sur ce Mac.
  - Non vérifié : le Mac de Sam, le PC, d'autres côtes que Toulon-Hyères et la Camargue.
- **Limites / transitions restantes :**
  - le maillage reste en retard sur les données : l'eau y est dessinée quelques mètres au-dessus de la mer. C'est un
    adaptateur dans le lecteur actuel (`shadeLite`) ;
  - la vraie correction appartient au fournisseur de surface : la publication des générations de T4, et pas de détail
    procédural sur une côte connue seulement en grossier. L'adaptateur sera retiré quand le maillage suivra les données ;
  - 05 et 13 sont tous deux marqués « en service » : la marque vaut par piste (le seuil face au vent de chacune).
- **Suite :** le prochain jalon (analyse §21.4), dont la surface et ses générations (§20.5 étape 2) qui fermerait
  l'adaptateur.

## 2026-11-05T22:20Z — Approches ILS au flight lab (Toulon-Hyères, F-35 et A320) ; le laboratoire attend sur la progression de la page (commits 4b18063f, 2943d111)

- **Contribution à la destination :**
  - §19.13 (parcours complets : approcher, se poser) et §8.3 (des mesures sur des séquences réelles, pas un état figé
    favorable) ;
  - §19 : les fonctions produit par la même action (l'ILS de la roue, de TARS et du laboratoire).
- **Réalisé :**
  - **A320** (`a320Approach`, `controller/a320ap.ts`) : l'ILS sur la piste demandée, des vecteurs, l'altitude en paliers
    sous le glide, la configuration pas à pas, le toucher noté ;
  - **le relief** : la pente de 3° confrontée au relief (`glideClearance`) ;
  - **le niveau de la piste ILS** pris sur la même piste, et non sur une piste croisée ;
  - **le rapport de vol** sur des pistes croisées ;
  - **le flight lab** : `App.waitProgress` (démarrage, compilations, tuiles, décor) au lieu de délais fixes ; `lab.ready` ;
    la télémétrie de l'ILS et du FMGC ; les approches volées en direct avec les tuiles.
- **Preuves :**
  - **mesuré** : 8 approches sur 8 réussies, toutes 20/20 — toucher à 0,3–1,1 m de l'axe, 0,67–0,94 m/s de chute ;
  - cadence médiane pendant le vol : ce Mac 26–38 i/s, kerr-mini 13–22 i/s (l'A320 le plus cher) ;
  - unitaires `a320-approach` (3 cas) et `ils-terrain` (4 cas) verts ; `tsc` et Biome sur les fichiers touchés.
  - Non vérifié : le PC, la météo dégradée, le vent.
- **Limites / transitions restantes :**
  - la marche entre deux pistes croisées, aplanies chacune à son niveau (`runwayGrade`, CPU et `trace.wgsl`) ;
  - le hub affiche « RWY 32 » pour la 31 ;
  - un rappel de TARS « au-dessus du glide » après le toucher ;
  - l'A320 à 13 i/s sur le mini (le coût du cockpit, cf. décision 42).
- **Suite :** la marche au croisement des pistes, puis le prochain jalon (analyse §21.4).

## 2026-11-05T23:40Z — Plus de « mauvais relief » en mer en vol ; le relief fin mesuré en approche (commits 6e4148c0, f4d7af93)

- **Contribution à la destination :**
  - §7.6 et §7.19 (des données prêtes et justes avant d'être dessinées ; aucune représentation fausse pendant le streaming) ;
  - §8.3 (mesurer en séquence réelle, en vol).
- **Réalisé :**
  - **le LiDAR HD** de l'IGN (z 16–17), qui interpole la mer en rampes de 76 à 344 m, est vérifié contre les niveaux plus
    grossiers et remplacé par le RGE ALTI là où ils divergent (`lidarSuspect`, `LIDAR_TRUST_M`) ;
  - pas de sursol au-dessus de la mer ;
  - le test de l'eau lit les données aussi au pied des falaises ;
  - e2e `coast-flight` (en fenêtre, cinq côtes, sonde des hauteurs) et `approach-detail` (le niveau dessiné devant sur une
    finale ILS) ; la qualité « idéale » hors fenêtres.
- **Preuves :**
  - **mesuré** : aux Calanques à froid, 54 points affichés 50 m au-dessus de leur hauteur finale → **0** ;
  - **observé** : plus de plaque ni de boîte noire en mer ;
  - finale ILS 13 de Toulon-Hyères à froid : aucun niveau manquant à 200 m–2 km devant, de 2,4 s au toucher ;
  - unitaires `ign-lidar-sea` et `earth-tiles` ; 71/71 shaders.
  - Non mesuré : le coût des requêtes RGE ALTI ajoutées (tuiles côtières) et de la lecture étendue de `shadeLite`.
- **Limites :**
  - le « relief max trop tard » signalé par Sam n'est pas reproduit (approche, Sainte-Victoire, Chamonix, Dubrovnik) : le
    lieu est à demander ;
  - les premières secondes d'un départ à froid restent grossières (rien n'est encore arrivé) ;
  - l'adaptateur de `shadeLite` (l'eau sur un maillage en retard) reste à retirer quand le maillage suivra les données (T4).
- **Suite :** le lieu ou le moment où Sam voit le relief fin tard.

## 2026-11-06T00:10Z — T8k : le relief le plus fin au bord des collines en approche (commit 6a3cd640)

- **Contribution à la destination :** §7.19 (le détail prêt avant d'être vu, la couverture tenue autour de l'œil) et §19.7
  (précharger ce dont le joueur aura besoin).
- **Réalisé :**
  - les fenêtres IGN z 15–17 passent à 8 tuiles aux portées `far` et `veryFar` (+48 Mio, repli à 4 tuiles) ;
  - le halo est classé par anneau au-delà du bord des fenêtres, le plus fin d'abord ;
  - l'e2e `approach-detail` mesure aussi les points sur le côté.
- **Preuves (mesuré)**, finale ILS 13 de Toulon-Hyères à froid : niveaux manquants sur le côté **0,163 → 0,036**, nuls dès
  38 s au lieu de 69 s ; file vidée à 44 s au lieu de 69 s ; unitaires `earth-tiles` mis à jour (9 couches) et verts.
  Non mesurés : le coût en images, le réseau, l'iPad.
- **Limites :** le sol reste grossier les 2 à 6 premières secondes d'un départ à froid ; seule la finale 13 de LFTH est mesurée.
- **Suite :** l'avis de Sam sur le même vol.

## 2026-11-06T00:20Z — T8l : l'arrivée du relief fin fondue sur 800 ms (commits 50af054c, 4e66dfba)

- **Contribution à la destination :** §7.19 et §7.18 (les transitions de LOD sans saut visible pendant le streaming).
- **Réalisé :**
  - `TerrainCache.FADE_MS` passe de 250 à 800 ms ;
  - l'e2e `approach-detail` part d'un départ prêt (relief, décor, noyaux) et suit le décor.
- **Preuves :**
  - **observé par Sam**, en direct sur ce Mac et sur kerr-mini : « c'est mieux » ;
  - **mesuré** : niveaux manquants sur le côté 0,043 → 0,028 ici et 0,015 → 0,006 sur le mini. Ces écarts tiennent au bruit
    des vols : le fondu ne change pas l'arrivée des données ;
  - les arbres sont là sur la colline dès le départ (environ 1,04 M).
- **Limites :**
  - un décor se reconstruit en 40 à 50 s en vol (près de 4 km en finale) ;
  - hors de la boîte du décor, les niveaux proches restent sans sursol forestier (Q4 F2, non fait).
- **Suite :** le temps de reconstruction du décor en vol.

## 2026-11-06T01:30Z — T8m : le décor se rebâtit plus vite en vol (commit 4e7138f0)

- **Contribution à la destination :** §7.19 et §19.7 (préparer les données avant la frame, garder la couverture utile
  jusqu'à son remplacement), §18 (un cache réseau borné dans le worker de préparation, hors boucle de frame).
- **Réalisé :** worker du décor gardé entre les scènes avec un cache LRU de ses réponses (96/192 Mio) ; scène centrée où
  l'appareil sera (`buildLead`) ; scènes rapides enchaînées en vol rapide. Doc : `docs/progress/refraction-horizons/T8.md` §T8m.
- **Preuves (mesuré, kerr-mini, A/B 4e66dfba) :** finale ILS 13 LFTH à froid, couverture du décor 0,707 → 0,972 (min 0 →
  0,83) ; vol à 220 m/s, 0,57 → 1,00. Unitaires `streaming-focus`/`scenery*`/`forest` verts (58).
- **Non vérifié :** coût en images, mémoire du cache dans la durée, iPad. **Non fait :** forêt simplifiée au-delà de la boîte.
- **Suite :** indicateur de téléchargement et audit de la chaîne téléchargement/cache (demande de Sam).

## 2026-11-06T03:00Z — T8n : voyant du réseau et audit du téléchargement (commits 09652088, ff85ec02)

- **Contribution à la destination :** §7.19 et §19.7 (streaming borné et mesuré), §8 (suivre l'âge et la fraîcheur des
  données critiques), §19.13 (instrumenter un parcours complet : une finale ILS à froid).
- **Réalisé :**
  - voyant réseau en haut à gauche (`ui/net-light.ts`), compteur commun page + workers (`system/net-activity.ts`), réglage
    FR/EN, `__bh.netLight` ;
  - Terrarium partagé en mémoire ; orthophotos redemandées après un échec ;
  - zones hors ligne alignées sur les fenêtres T8k ; test `hlod` aligné sur T7.
- **Preuves (mesuré, ce Mac, 3 vols de la finale ILS 13 LFTH à froid) :**
  - réseau occupé 95–96 % ;
  - blocage 2,6 % → 0,5 % ;
  - Terrarium 2 064 → 1 038 requêtes ;
  - aucun 429 ;
  - relief devant jamais en retard.
  - Unitaires : 75 + 60 verts, dont `zones`/`hlod`, qui échouaient depuis T8k/T7. Doc :
    `docs/progress/refraction-horizons/T8.md` §T8n.
- **Non vérifié :** coût en images du voyant, iPad, kerr-mini. Les variations du décor entre vols ne sont pas attribuées.
- **Suite possible :** annuler les tuiles sorties des fenêtres ; plafonner et redemander l'imagerie des tuiles de relief ;
  porte IGN avec priorité ; paralléliser les phases du décor (BD TOPO à froid, forêt/décalques CPU).

## 2026-11-06T02:30Z — T8o : téléchargement sans gaspillage ni famine (commit 6040466a)

- **Contribution à la destination :** §7.19 et §19.7 (préparer avant la frame, budget fournisseur commun), §18 (une seule
  autorité de débit IGN : le Service Worker, ordonné).
- **Réalisé :**
  - abandon de ce qui est en vol pour une tuile sortie de sa fenêtre ; file IGN par distance actuelle ;
  - imagerie des tuiles redemandée après un échec ;
  - porte IGN du Service Worker par classes, avec vieillissement et abandon ;
  - BD TOPO par 6 en continu.
- **Preuves (mesuré, kerr-mini, A/B ff85ec02) :**
  - décor 0,957 → 0,986, scènes 32–81 s → 24–33 s ;
  - relief devant jamais en retard ; côté 0,013 → 0,025, dans le bruit ;
  - unitaires 115 + 9 verts.
  - Un premier A/B a montré une famine du relevé des forêts. Elle est corrigée et remesurée.
- **Non vérifié :** iPad, hors de France. **Suite :** profiler la forêt et les décalques du décor.

## 2026-11-06T04:30Z — Vue missile et vie en mer (commits 105f58d8, 03f42061)

- **Contribution à la destination :** §19 (expérience complète : combat, mer vivante), §7 (un seul passage de maillages
  pour les objets du monde, matériaux explicites, pas de second opaque), §8 (missiles de 300 à 1 750 triangles).
- **Réalisé :**
  - **Missiles 3D** (AIM-120C, AIM-9X, 9M38, JSM, procéduraux) :
    - gouvernes tournées dans le vertex shader d'après le guidage ;
    - flamme de moteur à poudre HDR ;
    - vue « Sur le missile » ;
    - plan proche corrigé pour un œil loin de l'appareil.
  - **Trafic maritime simulé et déterministe** là où l'AIS est absent :
    - circuits vérifiés en mer ;
    - profondeur lue comme la distance à la terre, faute de bathymétrie ;
    - 12 navires dessinés.
- **Preuves :**
  - **observé** dans les e2e `missile-view` et `sea-life`, en fenêtre sur ce Mac ;
  - unitaires `missile-models`, `seasim` et menus verts.
  - Corrigé en route :
    - enroulement des corps tournés des missiles ;
    - cache de `seaNow` à horloge figée ;
    - MMSI en double.
- **Non mesuré :** le coût GPU propre des missiles et des navires (pas d'A/B).
- **Limites :**
  - les modèles de bateaux restent les procéduraux existants ;
  - les navires ne sont pas dessinés quand la caméra libre est loin de l'appareil piloté (passe des maillages relative à
    l'appareil, à reprendre) ;
  - les petits bateaux sont peu montrés par l'e2e.
- **Suite :** le mode guerre (chars, sites sol-air en 3D, destructions).

## 2026-11-06T07:30Z — Mode guerre : unités au sol, base aérienne, vue d'arme (commits c40e4c2d, 253004ce, 6604630a)

- **Contribution à la destination :**
  - §19 : expérience complète, combat air-sol jouable de bout en bout ;
  - §7 : un seul passage de maillages, matériaux explicites et posés dans le shader (tourelles, bras, ailettes), ombres par
    la carte existante sans nouveau passage ;
  - CLAUDE.md WGS84 : tous les objets du combat placés sur le globe (`globeMap`) et non plus dans le repère plat.
- **Réalisé :**
  - **unités procédurales :** lanceur SA-11, char détaillé avec camouflage, camion, bunker, abris durcis, tour de contrôle,
    cuves, cratères, GBU-32 ;
  - **deux combats :** « Guerre : colonne blindée » et « Guerre : base aérienne » ;
  - **ombres des unités :** seconde moitié de la carte d'ombre ;
  - **coups au sol en 3D :** boule de feu, feu, débris, colonne de fumée ;
  - **vue d'arme :** sur la bombe ou le missile, tour de l'impact, retour à l'avion ;
  - **corrections du JDAM :** fusée de proximité, guidage final.
- **Preuves :**
  - **observé** dans les e2e `war-mode` et `war-airbase`, en fenêtre sur ce Mac, avec les remarques de Sam en direct ;
  - unitaires combat, missions et scénarios verts ;
  - `check-wgsl` 71/71.
  - Corrigé en route :
    - récursion `focusShip` ;
    - unités qui glissaient (repère plat) ;
    - vue au travers de l'avion ;
    - chenilles posées avec la tourelle ;
    - bombe qui traversait le bâtiment.
- **Non mesuré :** le coût GPU propre (pas d'A/B). Les 2 échecs d'`assistlevel` en lot sont préexistants (aussi sur
  origin/main, ils passent seuls).
- **Limites :** les bâtiments réels du décor ne se détruisent pas (pas d'identité stable par bâtiment) ; aucune piste n'est
  coupée comme objectif.
- **Suite :** plan aurores-magnétosphères.

## 2026-11-06T09:00Z — Aurores : AM0 (champs) et AM1 (ovale terrestre, Kp réel) (commits 09d723bc, c06840d8)

- **Contribution à la destination :** §7, « une responsabilité commune avant plusieurs lecteurs » : `magnetic-fields.ts`
  devient la source unique des champs pour l'image, le futur schéma, TARS et les tests ; données préparées hors de la frame
  (tables, pas d'harmoniques par pixel) ; §19, la vraie météo de l'espace.
- **Réalisé :**
  - **AM0 :** modèles de 7 corps, CON2020, traçage arrêté sur la vraie figure ;
  - **AM1 :** ovale en heure locale magnétique, arcs, bande diffuse, N₂⁺, Kp NOAA validé.
- **Preuves :**
  - unitaires : `magnetic-fields` 9/9, `space-weather` 2/2 ;
  - **observé** dans l'e2e `aurora-oval` : rideaux depuis le sol à Tromsø et au limbe depuis 400 km.
- **Non mesuré :** le coût GPU de l'aurore.
- **Limites :**
  - l'aurore est trop brillante (étalonnage à faire en AM2) ;
  - rien depuis 4 000 km (chemin de la Terre lointaine) ;
  - pas de variation séculaire d'IGRF ;
  - pas de worker de traçage tant qu'aucun lecteur ne l'appelle.
- **Suite :** AM2, l'aurore générique par corps et son étalonnage.

## 2026-11-06T04:05Z — AM2 premier lot : aurore terrestre en unités physiques (a1e34357)

- **Contribution à la destination** (§7 « une responsabilité commune avant plusieurs lecteurs », §8 coût, §19 expérience) :
  les raies aurorales ont une seule source CPU (`src/system/aurora-lines.ts`, CIE 1931 / V(λ)) dont le shader est la copie
  testée ; l'émission passe par l'exposition commune (cd/m² → radiance par les 100 000 lux), pas par un facteur propre.
  Marche de 40 → 16 évaluations par rayon, arcs en lames intégrées analytiquement.
- **Changements** : `aurora-lines.ts` + test ; `trace.wgsl` auroraLight (lames, colonnes, œil mésopique, gain d'adaptation
  décodé de bary.w) ; `renderer.ts` eyeSkyLight et gain (I + I_œil)/lumière du ciel ; garde du reflet de la sonde dans
  seaShade (la bande blanche des fjords de nuit) ; e2e aurora-oval avec des vues au-dessus de l'ovale.
- **Preuve** : tests unitaires verts (aurora-lines 5, magnetic-fields 9, space-weather 2) ; 71/71 shaders compilent ;
  **observé** e2e aurora-oval sur ce Mac (fenêtre visible) : Tromsø Kp 4, rideaux devant la Terre à 400 km, ovale sur le
  Canada à 4 000 km ; bande blanche disparue (moyenne 170 → 4 sans sonde, garde vérifiée sur Tromsø). Planche
  `docs/progress/aurora/am2-planche.jpg`.
- **Non mesuré** : le coût GPU (seuls les temps bruités des e2e, Mac en pression thermique Moderate) ; pas d'A/B.
- **Limites / suite** : l'œil adapté au jour (caméra au soleil dans l'espace) ne voit pas l'aurore de la face nuit ; la sonde
  du Ranger a un ciel de nuit ~40 × son sol (cause à trouver, la garde est un raccord provisoire) ; grain au limbe ; rendu
  photo ; aurore générique par corps et Jupiter (AM3) ; cache par direction.

## 2026-11-06T04:45Z — AM3 premier lot : aurores de Jupiter (c9d2be90)

- **Contribution** (§7 une source par responsabilité, §8 anticiper les compilations, §19 expérience) : l'ovale de Jupiter vient
  des champs d'AM0 (une seule source CPU, copie WGSL testée) ; même intégration en lames que la Terre ; l'œil s'adapte dans
  l'ombre de Jupiter. Constat de performance consigné : le noyau de Jupiter proche se compile en ~200 s à froid (sans
  l'aurore : 203 s, avec : 219 s, M1 Max) — `docs/PROBLEMES-A-REGLER.md`, à traiter par spécialisation/compilation anticipée.
- **Changements** : `src/system/aurora-bodies.ts` + test ; `trace.wgsl` auroraJupiter ; `renderer.ts` (activité, pieds
  d'Io, œil dans l'ombre, gain) ; `__bh.viewAt` corps, `__bh.sys.subsolar` ; e2e `aurora-jupiter`.
- **Preuve** : tests unitaires (aurora-bodies 4, aurora-lines 5, magnetic-fields 9, space-weather 2) verts ; 71/71 shaders ;
  **observé** e2e aurora-jupiter (ce Mac, fenêtre visible) : ovale nord, lueur polaire, pied d'Io ; ovale sud au limbe.
  Planche `docs/progress/aurora/am3-jupiter.jpg`.
- **Non mesuré** : coût GPU de l'aurore de Jupiter (pas d'A/B). **Limites** : autres lunes, dawn storms, activité propre ;
  saturation/grain au limbe ; vue sud de Jupiter parfois noire (problème préexistant consigné).

## 2026-11-06T04:54Z — AM7 premier lot : schéma des magnétosphères (2667345b)

- **Contribution** (§4/§7 une passe de lignes avec profondeur partagée, pas de nouvel opaque ; §19 lisibilité) : le calque de
  lignes de la carte du ciel gagne un mode profondeur (chaque bout sa distance, testé contre la profondeur tracée) — réutilisable
  par les orbites et autres guides en 3D ; les lignes viennent du champ d'AM0 (une source).
- **Changements** : `src/system/magneto-lines.ts` + test ; `chartoverlay.ts`/`overlay.wgsl` mode profondeur ;
  `renderer.ts` updateMagneto ; réglage `magnetosphere` (FR) ; e2e `magnetosphere-diagram`.
- **Preuve** : tests verts (magneto-lines, menus, i18n) ; shaders compilent ; **observé** e2e (ce Mac) : Terre depuis
  60 000 km, Jupiter depuis 1,5 Mkm ; deuxième version après « c'est moche » (Sam). Planche `docs/progress/aurora/am7-diagram.jpg`.
- **Non mesuré** : coût CPU par image de la projection (~18 000 segments) et GPU du calque. **Suite** : déformation par le vent
  solaire, lignes ouvertes, tore d'Io, ceintures, particules, actions TARS, corps lointains, traçage en worker.

## 2026-11-06T05:05Z — AM7 deuxième lot : la magnétosphère en couches de lumière (309fc8c6)

- **Contribution** (§4 passes partagées, §8 coût borné, §19 lisibilité) : une passe de volume légère dans le calque de lignes
  (à la taille de l'image tracée, composée sur la sortie, arrêtée à la profondeur tracée) remplace le grillage : coques
  intégrées analytiquement (erf, pas de crénelage), ceintures et tore en volume, étiquettes traduites ; la même passe servira
  aux autres corps (VOLUMES) et aux particules.
- **Preuve** : tests verts (magneto-lines, i18n) ; overlay.wgsl compile ; **observé** e2e (ce Mac) sur 5 vues ; damier corrigé
  (images tracées un pixel sur deux). Planche `docs/progress/aurora/am7-diagram.jpg`.
- **Non mesuré** : coût GPU de la passe de volume (≈ 76 pas par pixel de l'image tracée là où la sphère englobante est
  traversée) — à mesurer en A/B. **Suite** : particules, déformation des lignes par le vent solaire, actions TARS, mesure.

## 2026-11-06T05:27Z — Aurores et magnétosphère : coût mesuré et réduit (d1d04859)

- **Contribution** (§8 coût mesuré, paliers vers 60 images/s) : premier A/B des aurores et du schéma sur kerr-mini (M1,
  Nominal, ABAB, médiane de 24 lectures, e2e `aurora-cost`).
- **Mesuré** : aurore Tromsø Kp 4 de nuit +4,6 ms (36,2 → 40,8 ms, échelle 0,75) ; 400 km Kp 5 +2,1 ms (échelles
  différentes, à refaire) ; schéma de la magnétosphère +2,3 ms à échelle 1,00 après passage à la demi-résolution et 24 pas
  (≥ +5,5 ms avant, échelle tombée de 0,94 à 0,79) ; Jupiter +0,5 ms.
- **Implémenté, gain non mesuré** : aucun noyau d'aurore quand l'œil est adapté à plus de 1 000 lux ; rayons sous 45° de
  latitude magnétique sautés (le Kp réel NOAA allume l'aurore par défaut près du présent).
- **Suite** : le cache par direction pour l'aurore de près (consigné dans `docs/PROBLEMES-A-REGLER.md`) ; mesurer les tris.

## 2026-11-06T05:37Z — AM4 premier lot : aurores de Saturne, Uranus, Neptune (dbb8739d)

- **Contribution** (§7 une responsabilité, plusieurs lecteurs) : un seul code d'aurore pour les quatre géantes, leurs ovales
  tirés des champs d'AM0 par un générateur testé ; l'adaptation de l'œil à l'ombre généralisée (sauf Saturne).
- **Preuve** : tests verts (aurora-bodies 5, aurora-lines, magnetic-fields) ; shaders compilent ; **observé** e2e sur
  kerr-mini : Jupiter inchangé (aurora-jupiter), Uranus et Neptune vus de leur ombre (aurora-giants) — rien de visible,
  physiquement juste (UV/IR).
- **Limites** : Saturne dans son ombre révèle une lumière fausse du traceur (PROBLEMES-A-REGLER.md, adaptation coupée) ;
  ovale de Saturne fixe au Soleil, Encelade, activité par corps à faire ; rendu « instrument » (AM8) à décider par Sam.

## 2026-11-06T05:49Z — Données scientifiques lot C (vent solaire) et plan de la seconde vue (6e684d19, 5e889cac)

- **Lot C de RECHERCHE-DONNEES (§ 4.2)** : le vent solaire réel de la NOAA (produit propagé à 1 h, 6–7 ko, deux formats lus,
  testés sur une copie réelle) place la magnétopause terrestre du schéma (Shue et al. 1998), trois états (réel, ancien,
  typique) dits sur l'étiquette. **Observé** (e2e magnetosphere-diagram, ce Mac) : 309 km/s, 2,3 cm⁻³, Bz −0,8 nT → nez à
  13,2 R_E. Non mesuré : coût (un fetch de 7 ko toutes les 10 min, seulement le schéma ouvert près du présent).
- **Plan** : `docs/PLAN-CAPTEURS-CAMERA-SECONDAIRE.md` (S0–S9) — une seconde cible du renderer, canaux lecteurs des
  sources communes, provenance affichée, budget ≤ 15 % ; AM8 y est déplacé, les particules abandonnées (Sam). Documenté,
  rien d'implémenté.

## 2026-11-06T06:13Z — AM6 (5c74fcf5) ; données lot D, USA premier lot (d43073d4)

- **AM6** : aurores de Mars et de Vénus (raie verte, anneau crustal, tempête), œil adapté dans l'ombre de Mars ; observé
  (e2e aurora-mars, kerr-mini).
- **Lot D (USA)** — contribution à la destination (§7 une interface de source nationale, plusieurs lecteurs ; §8 décodage
  hors du fil principal) : relief Mapterhorn (3DEP 1 m, 512² WebP → z 17, décodé dans le worker de tuiles), imagerie des
  tuiles du National Map (z ≤ 16), contour des 48 États, crédits, cache du Service Worker ; la boîte du traceur réduite aux
  sources proches de la caméra. **Qualifié** : Longs Peak et Whitney à 2 m de leurs repères NAVD88. **Observé** (e2e usa,
  Yosemite, ce Mac) : pente 83° contre 77°, 1,9 m contre 25 m, z 17 contre 14, Half Dome 2 693 m (2 694).
- **Mesuré hors jeu** : NAIP 0,6 m seulement par son serveur d'images, 9–50 s l'image de 1024² (6 en parallèle) ; aucun
  cache de tuiles NAIP (USDA muet, USGS sans tuiles) → imagerie en direct ≈ 2 m, la NAIP pour les zones hors ligne.
- **Non mesuré** : le coût en vol (débit, mémoire) contre la France. **Suite** : ajustement des couleurs USGS → EOX (le
  modèle à 4 paramètres ne suffit pas : courbe plus riche), sol du décor sur le relief 3DEP, Alaska/Hawaï, Mapterhorn pour
  les autres pays où il porte des données nationales (Japon z 16 vérifié), imagerie mondiale fine (aucune source libre
  comparable : à décider).

## 2026-11-06T06:17Z — Lot D (USA) : le décor sur le relief 3DEP (9b4c3f90)

- Arbres et bâtiments des USA posés sur le même relief que le traceur (`usa-ground.ts` MapterhornGround, z 14, décodé dans le
  worker du décor ; zones hors ligne comprises) — une seule source de sol pour le traceur et le décor (§7).
- **Observé** (e2e usa, Yosemite, ce Mac) : 56 requêtes de sol du décor avec les données, 0 sans ; tests zones, national,
  sources, earth-tiles verts. **Non mesuré** : écart pied/sol au sol (la vue de l'e2e est à 2,5 km), coût en vol.

## 2026-11-06T06:23Z — Lot E (monde), relief Mapterhorn (d01e8c7c)

- Le relief de 151 relevés nationaux (Europe, Japon, Nouvelle-Zélande ; 1 m ou mieux pour la plupart) en sources « relief
  seul » derrière la même interface que l'IGN, swisstopo et les USA ; l'imagerie reste mondiale (orthoUrl facultatif ; boîte des
  photographies du traceur séparée de celle du relief). **Observé** (e2e mapterhorn-world, Geiranger) : 68° contre 55°, z 17
  contre 14, Dalsnibba à 6 m de son repère. **Non mesuré** : coût en vol (les trous de couverture demandent des niveaux fins
  remplis par Terrarium agrandi — requêtes de plus sans gain), mémoire.

## 2026-11-06T06:52Z — Le pipeline graphique documenté et vérifiable (GRAPHICS-PIPELINE.md, pipeline-inventory.ts)

- **Contribution** (§7.5 « une liste simple de passes déclarant lectures/écritures, tailles et durée de vie » avant tout
  render graph ; §8 mesure par famille ; §19 parcours complet ; §7.12 compilation) : `docs/GRAPHICS-PIPELINE.md`, référence
  maintenue — les ~45 passes de la frame dans l'ordre (libellé du profileur, programme, condition, lectures → écritures,
  consommateur, famille de budget §8.2), cibles et tables de `bodyBuf`, matrice des profils (tracé, Terre raster, autres
  mondes, convergence, offline), compilation (98 sites de pipeline dont ≈55 synchrones au démarrage, noyaux du traceur,
  cascade, caches, tailles inlinées, temps mesurés avec leur âge), parcours joueur en 19 étapes (chargement, compilation,
  ce qui bloque l'image, mesures et instrumentation par étape), horloges et outils de mesure, angles morts.
- **Outil** : `scripts/pipeline-inventory.ts` (statique, 0,2 s) — inventaire des pipelines, programmes WGSL et points
  d'entrée, libellés du profileur, passes jamais chronométrées (26) ; `--check` échoue si le document ne nomme pas un libellé,
  un fichier de pipelines ou un `.wgsl` du code ; `--write [--sizes]` régénère l'annexe. Règle ajoutée à `CLAUDE.md` :
  chaque session qui touche au pipeline met le document à jour et fait passer `--check`.
- **Preuve** : documenté depuis la lecture du code à `da4e75bd` ; **vérifié statiquement** (`--check` passe, tailles des
  noyaux recalculées par `wgsl-inline-size.ts` le 6/11). **Aucune mesure GPU, aucun test, aucune e2e lancés** (consigne de
  Sam : le Mac est occupé) ; les temps de compilation cités datent du 27–28/10 (périmés : noyaux +5 à +18 % depuis), les
  coûts par passe de M0b (2/11).
- **Relevé en lisant le code (non reproduit)** : une bande du bake des horizons peut être perdue sur une vue convergée
  inchangée (encodeur non soumis, `renderer.ts:10680`/`10842`) ; course probable qui empêche l'intro complète après une
  mise à jour ; cache « shell » du SW vidé à chaque version.
- **Suite** : une suite `plan-views` de référence au commit courant (coûts par passe), `kernel-compile` froid/chaud sur
  kerr-mini et kerr-pc, le coût des ≈55 pipelines synchrones du démarrage, un parcours « titre → Paris → `earthSettled` »
  chronométré par étape ; horodater `earthSettled`/`tracerSettled` et chronométrer les passes non couvertes.

## 2026-11-06T07:18Z — Le sol de contact de la mer : Mapterhorn sans bathymétrie, la cuisson du relief raster bornée au niveau de la mer

- **Contribution** (§7 « une responsabilité commune avant plusieurs lecteurs » : le monde possède le sol, le raster le lit ;
  lot D/E des données) : la mer de Mapterhorn (exactement 0, sans bathymétrie) n'est plus un sol de relevé — trous comblés par
  Terrarium, non marqués, comme le WMS-R de l'IGN en mer (`earth-tiles.ts` mapterhornHeights, `usa-ground.ts` pour le
  décor) ; la cuisson du cache de relief du raster (`terrain-cache.ts`) soustrait la lecture du niveau grossier **au-dessus
  du niveau de la mer**, comme `h` : la bathymétrie de Terrarium n'est plus rajoutée sous un texel de relevé en mer.
- **Défauts corrigés** (Sam, Big Sur) : une nappe grise jusqu'à l'horizon (la mer de Mapterhorn marquée relevé), puis une
  aiguille translucide au large, d'autant plus haute que la mer y est profonde et que seuls les niveaux grossiers sont là
  (« un énorme pic pendant le chargement, puis un pic »). Cause isolée par e2e : présente en raster, absente sans le relief
  national, absente du traceur ; le relief CPU (groundAt, tuiles par niveau) sans valeur aberrante.
- **Preuve** : **observé** (sonde e2e, vol à 450 m au large de Big Sur, ce Mac, fenêtre visible) — l'aiguille disparaît
  (planche `docs/progress/usa/d3-bigsur-needle.jpg`) ; `tests/hlod.test.ts` mis à jour. **Non mesuré** : coût (une lecture
  `max` de plus par nœud cuit, négligeable attendu, non chronométré). **Non vérifié** : la France et la Suisse avec la nouvelle
  borne (le cas côtier y était déjà couvert par le WMS-R en NaN ; aucune e2e côtière française relancée).
- **Restant** : une nappe sombre du traceur au large, antérieure à ce lot (PROBLEMES-A-REGLER.md).

## 2026-11-06T08:21Z — La ville de nuit, premier lot : fenêtres à distance, sol vu rasant, couleurs sous les lampes ; indicateurs de chargement et de compilation

- **Contribution** (§19 expérience complète — la nuit et les vols de nuit ; §7 matériaux explicites partagés par les deux
  pipelines) : plan `docs/PLAN-NUIT-URBAINE.md` (NU1–NU8). Les fenêtres des bâtiments dessinées une à une tant qu'une travée
  couvre plus d'un pixel (`buildingLook` : filtre en boîte sur l'empreinte, moyenne conservée — la lueur moyenne étalée sur tout le
  mur au-delà de 26 cm de pixel faisait des tours blanches ou grises uniformes la nuit) ; les flaques des lampadaires sur les murs
  bornées au pied (`RB_ABOVE`) ; la lumière des villes vue rasante (`cityCanyon`) ; sous les lampes, la luminance des photos et un
  tiers de leur teinte (×2 au plus, au lieu de ×4 par canal : pelouses vert fluo à Paris) ; des fenêtres de nuit aussi sur les
  maillages sans feuille (U2). Indicateurs du coin haut-gauche toujours visibles, interface cachée comprise ; un indicateur de
  compilation (nombre de compilations restantes) à côté de celui du réseau.
- **Preuve** : **observé** (e2e `nyc-sunset` : New York de nuit et deux photographies de référence placées d'après leurs EXIF —
  `docs/progress/usa/refs` —, Paris de nuit ; kerr-mini et ce Mac) — planche `docs/progress/nuit/n0-avant-apres.jpg`. Diagnostic
  des tours par un agent (sondes par terme : aucune lumière sur les murs, la lueur moyenne seule). **Non mesuré** : coût GPU
  (le compteur affiché n'est pas une mesure).
- **Restant** : NU1 (le dessin des rues vu d'avion : les lumières lues à VIIRS z 8 seulement), NU2 lampadaires, NU3 voitures, halo
  du ciel, exposition de nuit, allées du Trocadéro encore trop blanches, tour Eiffel éteinte, la Seine pas chargée en 60 s.

## 2026-11-06T09:38Z — La ville de nuit vue d'avion : le fond de carte assombri et ses lampadaires ; l'œil adapté à la ville ; les pistes sur leurs seuils

- **Contribution** (§7.6/§7.16 préparer les données avant la frame — cuisson en worker, publication dans la texture existante ;
  §19 vols de nuit) : NU1+NU2 (`src/system/night-roads.ts`) — les rues OpenStreetMap (tuiles vectorielles z 12–13, la z 14 tirée
  de sa z 13) cuites en fond de carte assombri et en **lampadaires** (le modèle du décor proche, `lampsAlong`), la lumière VIIRS
  redistribuée dessus à moyenne exacte par tuile, encodage logarithmique (un lampadaire jusqu'à ×100 sa moyenne), couches
  `IMG_ROADS0` (z 12–14) de la texture 1024² lues par `tileLightsAt` ; demandées seulement au crépuscule et la nuit, recuites à la
  tombée de la nuit ; teinte sodium/LED par un bruit doux. **Abandonnés** (Sam) : pointillés procéduraux, teinte en damier.
  NU5 : la lumière de la ville autour de la caméra (`cityLampAt`, tuiles z 10) entre dans l'adaptation de l'œil. NU4 : les tours
  de verre allumées par plateaux de 6 m. Pistes : cap et longueur tirés des deux seuils (`runwayAxis`) — Le Bourget publié 249°
  pour 247,81° réel : l'ILS posait le F-35 à ~60 m de la piste dessinée — ; les 7 terrains du jeu recalés.
- **Preuve** : **observé** — e2e `paris-night-flight` (F-35 à 900 m, virage de 120°, kerr-mini : altitude tenue 950–966 m,
  planche `n1-vol-paris-900.jpg`), `nyc-sunset` (Paris900 en caméra libre, NYC de nuit avant/après adaptation, ce Mac),
  `lebourget-night-ils` (approche ILS 25 de nuit, posé à 1 m de l'axe dessiné, 18,7/20 ; avant : à côté de la piste) ;
  tests unitaires `night-roads`, pistes. **Mesuré hors jeu** : cuisson 5–19 ms par tuile (worker). **Non mesuré** : coût GPU,
  octets réseau d'une fenêtre de nuit (tuiles vectorielles 219–337 ko sur Paris), +17 Mo de texture calculés.
- **Restant** : voitures (NU3), halo du ciel (NU6), monuments (NU7), chargement (NU8), le rendu un peu doux en mouvement, la
  lumière moyenne de la ville encore réglée à la main (`CITY_ADAPTATION`).

## 2026-11-08T19:55Z — Une scène pour les aurores de Jupiter

- **Contribution** (§19 l'expérience complète : un contenu existant rendu atteignable depuis la galerie et par TARS via
  `game.preset`) : la scène `"Jupiter: the auroras from its shadow"` (`src/settings.ts`, fiche `src/ui/schema.ts`, français
  `src/i18n/fr-settings.ts`, image `assets/scenes/jupiter-the-auroras-from-its-shadow.webp`, `src/ui/scene-thumbs.ts`
  régénéré) — la première vue de l'e2e AM3 : caméra libre à 7 149 km au-dessus de 45° N, −165° E, le 21 décembre 2026
  10:01:52 UTC (ce méridien à minuit), cap nord, 22° sous l'horizon, activité 5. Aucun code de rendu changé.
- **Preuve** : **observé** — e2e `aurora-jupiter` (ce Mac, 160 s, réussi), nouvelle étape : la scène appliquée, noyau d'aurore
  présent, œil dans l'ombre (eyeIncident 1e-7), `remote-results/aurora-jupiter/scene.png`. Test unitaire
  (`tests/aurora-bodies.test.ts` : la caméra dans le cylindre d'ombre, point subsolaire à 15° E). **Non mesuré** : coût GPU (le
  compteur affiché n'est pas une mesure).
- **Restant** : la compilation du noyau proche de Jupiter (~200 s à froid) s'applique aussi à la scène.

## 2026-11-10T08:17Z — Audit total du dépôt et deux plans (session documentaire)

- **Contribution à la destination :** §20.5 étape 1 et §20.8 (savoir où en est la convergence, préparer J0) ; §7.6 et
  §7.19 (chargement) ; §19.3, §19.4, §19.12 (propriétaires du temps, du sol de contact, de l'état). Documentation
  seulement : aucune responsabilité n'est livrée par cette session.
- **Réalisé :**
  - [docs/audit-2026-11-10/](docs/audit-2026-11-10/README.md) : une synthèse, huit rapports par domaine (chargement du
    monde, rendu, architecture, réseau, TARS et audio, vol et interface, plans et reste à faire, tests et CI ;
    230 constats avec fichier, ligne, gravité et niveau de preuve) et
    [les priorités](docs/audit-2026-11-10/09-priorites-todo.md).
  - [docs/PLAN-CHARGEMENT-MONDE.md](docs/PLAN-CHARGEMENT-MONDE.md) (CM0–CM9) : les causes de lenteur des tuiles que le
    plan ST0–ST10 ne contient pas (octets du relief IGN, portillon du service worker, trous définitifs, départ à froid).
  - [docs/PLAN-RESEAU-DURCISSEMENT.md](docs/PLAN-RESEAU-DURCISSEMENT.md) (RD0–RD7).
  - La carte [docs/README.md](docs/README.md) : trois lignes ajoutées.
- **Constats pour la destination :** depuis le 3 novembre, aucun lot de fondation ni de bascule, aucun jalon J0–J5 ;
  `trace.wgsl` et `renderer.ts` ont pris +3 923 / −784 lignes (`git log --numstat --since=2026-11-03`). Le sol de
  contact est installé par le renderer (`src/renderer.ts:1945`). En vol terrestre, aucun gouverneur n'agit sur le
  matériau (`src/main.ts:8892`). ST1 est écrit mais non commité ; ST2–ST10 ne sont pas commencés.
- **Preuves :** lecture du code par huit audits en lecture seule ; les constats mis en tête de la synthèse relus dans
  le code. Lancé : `tsc` (0 erreur), Biome (107 avertissements), `pipeline-inventory --check` (passe),
  `kernel-budget` (passe), `bh-api --check`, `check-repo-size`. **Aucun e2e, aucun benchmark, aucune mesure
  nouvelle ; aucun défaut reproduit en jeu.** Les chiffres de cadence et de volume cités viennent des fiches du projet,
  avec leur date.
- **Limites / transitions restantes :** aucun code modifié ; rien de commité par cette session (l'audit, les deux
  plans, la référence stratégique et le lot ST1 ne sont que dans la copie de travail) ; pas de mesure récente sur
  M1 Max ; les plans CM et RD sont des propositions.
- **Suite :** les décisions de Sam (jalon, scène de référence, palier de cadence — priorités §2), puis J0 et la mesure
  du chemin réel des tuiles (CM0).

## 2026-11-10T09:10Z — Les zones hors ligne complètes (ST1) et les plans réconciliés avec l'audit

- **Contribution** (§7.6 et §7.19 : données prêtes, couverture gardée jusqu'au remplacement ; §19 l'expérience complète
  hors ligne ; vague 0.2 de l'[audit](docs/audit-2026-11-10/09-priorites-todo.md)) : le lot ST1 de
  l'[analyse du streaming](docs/ANALYSE-STREAMING-2026-11-06.md), écrit le 6 novembre, terminé et commité. Les zones
  gardent ce que le jeu demande vraiment : Terrarium dans sa propre chaîne sous les reliefs nationaux, les rues de nuit z 12–13,
  l'infrastructure Overture à 15 km, le sol 3DEP des USA, et maintenant **les pistes du monde à 150 km** (`runwayZoneChains`) ;
  `ZONE_SCHEMA` 2 signale « à mettre à jour » une zone plus ancienne. Deux défauts trouvés par le premier vrai passage hors
  ligne, corrigés à la source : une **scène du décor annulée abandonne ses requêtes en vol** (`AbortController` par scène,
  `scenery-worker.ts` — un morceau de ST2 ; la première scène, au Bourget, lisait encore son relevé IGN pendant un vol à JFK)
  et les pistes en échec ne sont plus redemandées à chaque image (recul de 30 s, `world/runways.ts`). Un modèle d'appareil en
  échec réseau est redemandé après 30 s au lieu de rester « en chargement » (`ship.ts`).
- **Documents** : en-têtes et états réconciliés avec l'audit — [plan aurores](docs/PLAN-AURORES-MAGNETOSPHERES.md) (état
  par phase, l'ordre après J0), [plan T/Q/H/R](docs/PLAN-REFRACTION-HORIZONS.md) (§0.2 T7/T8, §0.3 ce que l'audit change),
  [analyse stratégique §22](docs/ANALYSE-STRATEGIE-RENDU-2026-11-03.md) (candidats au jalon mis à jour : V0, J0 et CM0–CM3 en
  parallèle, puis J1), [plan du chargement](docs/PLAN-CHARGEMENT-MONDE.md), `PROBLEMES-A-REGLER`, `GRAPHICS-PIPELINE`,
  `E2E-CATALOGUE`.
- **Preuve** : **observé et mesuré** — e2e `zones-usa-night` **vert** sur ce Mac (fenêtre visible, `remote-results/zones-usa-night/run-2026-11-10e.log`,
  captures `held.png`, `flown.png`) : zone de 1 km sur la finale 13R de JFK, 4 508 chaînes, 234 Mo en 120 s, 0 échec ;
  réseau coupé pour la page et son Service Worker, hors ligne : 8 000 bâtiments, 135 réponses du décor par la zone et 0 hors
  zone, 0 tuile de sol en échec au-dessus de la zone, **0 requête au réseau pendant le vol** (le matin : pistes 135, relief
  36, couvert 16), piste 13R dessinée. Tests unitaires : zones, pmtiles, PWA, pistes, décor (58 verts, dont un nouveau
  sur les pistes des zones) ; `tsc` 0 erreur. **Non mesuré** : coût GPU ou de cadence (aucun, ce lot ne touche pas la frame) ;
  le passage dans la PWA installée de Sam (l'e2e reproduit le même chemin dans le profil Chrome des e2e).
- **Restant** : hors ligne après une seule visite, les fichiers du jeu jamais chargés manquent encore (modèles du trafic,
  `terrain-mesh-worker.js`, cartes des corps) ; l'imagerie GIBS grossière hors du disque est redemandée en boucle hors ligne
  (≈ 320 échecs par minute) ; `zones`, `zones-scenery`, `pwa`, `overture` à convertir à `app.offline`. Le prochain jalon attend
  les décisions D1–D3 de Sam (analyse stratégique §22.3).

## 2026-11-10T09:20Z — Décisions de Sam sur le jalon

- **Contribution** (§20.5 étape 1, §15 J0) : les décisions qui bloquaient J0 depuis le 5 novembre sont prises et écrites
  ([stratégie §22.4](docs/ANALYSE-STRATEGIE-RENDU-2026-11-03.md), [priorités de l'audit §2](docs/audit-2026-11-10/09-priorites-todo.md)) :
  la vague 0 de l'audit d'abord, puis J0 ; la scène de vol de référence à Toulon-Hyères (la côte) ; le palier de cadence à
  25 ms sur M1 Max (la cible finale reste 60 images/s) ; le gel des nouveaux lecteurs de `shadeLite` et `trace.wgsl`
  jusqu'à J0, sauf correctif.
- **Preuve** : documenté. Aucune mesure.
- **Suite** : la vague 0 (hook avant push, hébergement des binaires D13, fichiers jetables, crédit de l'A320, previews) ;
  puis J0 sur la scène de Toulon-Hyères, mesurée sur M1 Max et kerr-mini.

## 2026-11-10T09:30Z — Vague 0 de l'audit : pouvoir livrer sans rougir la CI, rien de jetable publié, l'A320 crédité

- **Contribution** (stratégie §22.4 décision D1 : la vague 0 d'abord ; §20.5 étape « V0 — ne rien perdre, pouvoir
  livrer » ; [priorités de l'audit](docs/audit-2026-11-10/09-priorites-todo.md) 0.1, 0.3, 0.5, 0.6, moitié de 0.7) :
  - **0.3 — un portillon avant push** (QA-01 : la CI de `main` verte à 31,5 %, 36 rouges d'affilée sur du format) :
    `.githooks/pre-push` garde l'envoi LFS puis lance `scripts/pre-push.ts` sur **la révision exacte poussée**,
    extraite seule dans un worktree temporaire (LFS en pointeurs, `node_modules` prêté) — jamais la copie de travail
    partagée, qu'une autre session peut avoir laissée à moitié. `biome ci` d'abord, puis `tsc`, `check-wgsl` et
    `check-repo-size` côte à côte ; la sortie entière de chaque échec. Installé par `bun run hooks` (`core.hooksPath`
    absolu : tous les worktrees le prennent) ; `bun run check:push` à la main ; `KERR_SKIP_CHECKS=1` en urgence.
  - **0.5 — les jetables** (QA-25, AR-23) : captures et transcriptions de la racine, sondes `tests/e2e/zz-*` et
    `scripts/zz-*` ignorées par git (donc par Biome), exclues de `tsc` et de `bun run e2e` sauf nommées. Rien effacé.
  - **0.6 — l'A320 crédité** (QA-22) : l'A320-family de FlightGear (GPL v2) et la police ECAM de FlyByWire (GPL v3)
    dans `src/ui/title/credits.ts` → `CREDITS.md`, vérifiés contre `assets/a320/README.md` par `title-credits`.
  - **0.7, moitié** (QA-04) : `/ineptie/` ne bloque plus le déploiement de `main` (`pages.yml` : échec ou dépassement
    des 900 Mo → laissée de côté avec un avertissement, comme `/test/`).
  - **0.1** : les deux pages HTML du 3 novembre (`REFONTE-WEBGPU`, `STRATEGIE-WEBGPU-AAA-LIBRAIRIES`) commitées.
  - Docs : [DEPLOY.md](docs/DEPLOY.md) (le portillon, la preview non bloquante, l'origine partagée), [E2E.md](docs/E2E.md)
    §5 (la convention `zz-`), priorités de l'audit (colonne « État »).
- **Preuve** : **observé et mesuré** — `bun run check:push` sur `f7e87ab5` : réussi en 24,1 s (worktree 5,9 s, Biome
  1,7 s, `tsc` 16,5 s, `check-wgsl` 71/71 shaders, `check-repo-size` 591,6 Mo) ; un commit sonde mal formaté
  (`git commit-tree`, jamais poussé) refusé en 6,7 s avec le diff de Biome ; l'entrée du hook (stdin de git) refuse ce
  même commit (code 1). Tests : `pre-push` (2), `title-credits` (3) verts ; `tsc` 0 erreur ; `bun run e2e --list`
  ne propose plus aucune sonde. `pages.yml` relu et parsé (YAML) ; **non exécuté** : son effet ne se verra qu'au
  prochain échec de `Ineptie-Version`. Aucun e2e, aucune mesure de rendu (ce lot ne touche pas la frame).
- **Restant** : 0.4 (où vont les binaires, D13 : 591,6 Mo sur 600) et l'autre moitié de 0.7 (previews hors de
  l'origine `thesamlepirate.github.io` — tout dépôt Pages du compte partage cette origine) attendent Sam ; la licence
  du dépôt (QA-22) reste à faire valider. Les branches `test-kimi` et `Ineptie-Version` gardent l'ancienne règle de
  `pages.yml` tant qu'elles ne reprennent pas `main`. Ensuite : J0 sur la scène de Toulon-Hyères.

## 2026-11-10T09:40Z — Les previews hors de l'origine des joueurs (vague 0.7 terminée) ; l'orientation de Sam sur les binaires

- **Contribution** (§19 l'expérience complète : les clés des joueurs ; [priorités de l'audit](docs/audit-2026-11-10/09-priorites-todo.md)
  0.7 et 0.4) : décision de Sam — une preview ne doit pas pouvoir lire les clés des joueurs. Une preview sur Pages
  partage l'origine `thesamlepirate.github.io` (celle de tout site Pages du compte) : aucun cloisonnement possible
  dans le code. Donc : `/test/` et `/ineptie/` retirées de Pages (`pages.yml` : branches vidées, workflow sur `main`
  seul), l'environnement `github-pages` limité à `main` (règles `test-kimi` et `Ineptie-Version` supprimées via l'API :
  leurs anciennes copies du workflow ne peuvent plus déployer), et dans chaque dossier retiré un worker et une page de
  fermeture (`pwa/retired-preview/`) pour les navigateurs qui avaient installé la preview. Une preview ne reviendra que
  sur une autre origine. Binaires (D13) : Sam penche pour samlepirate.org, une release GitHub ou son autre serveur
  Portainer, choix dans les prochains jours ([ASSETS.md](docs/ASSETS.md)).
- **Preuve** : **observé** — Chrome sans tête, sonde de session : un « ancien » worker de preview installé sous
  `/test/` est remplacé par `pwa/retired-preview/sw.js` à sa mise à jour : 0 enregistrement restant, son cache
  `kerr-shell:/test/:…` supprimé, `kerr-shell:/:main` et le cache des tuiles gardés ; la page de fermeture retire
  `test/kerr.openrouter.key` et `test/kerr.deepgram.key`, garde `kerr.openrouter.key` (la racine) et les réglages, puis
  renvoie à la racine. Règles de l'environnement relues après coup : `main` seul. **Non vérifié** : le prochain
  déploiement Pages lui-même (la copie partielle de `main-src` dans le job `site`) ; un navigateur dont l'ancien worker
  est encore actif sert une dernière fois la page en cache avant la mise à jour.
- **Suite** : J0.

## 2026-11-10T10:29Z — J0 : le contrat d'acceptation, la scène de référence de Toulon-Hyères, ses premières mesures

- **Contribution** (§15 J0, §8 contrat de performance, §19.13 parcours, §22.4 D2–D3 ; audit 1.1 et 1.2) : le jalon qui
  bloquait tout le reste a son contrat, sa scène et ses mesures. [docs/J0-CONTRAT.md](docs/J0-CONTRAT.md) : profil
  (1920 × 1080, profil du joueur tel que livré), palier 1 = 25 ms sur M1 Max avec des seuils proposés (p50 et p95 ≤ 25,
  p99 ≤ 37,5, CPU p95 ≤ 4), la scène `toulon-hyeres-v1` (F-35, cockpit, Rade d'Hyères, 500 m, 140 m/s, virage à droite
  sur la côte, 10 juillet 15:30 UTC), les mesures et leur sens (images nouvelles, pas rAF ; GP-09), la répartition par
  ablation, les propriétaires désignés (sol de contact au monde, temps à la simulation, vue, image), les contrats §19
  relevés dès J0. Implémentation : `tests/e2e/lib/j0-scene.ts` (une source), `tests/e2e/j0-reference.e2e.test.ts`
  (chemin d'entrée à froid, vol mesuré, 7 ablations sur le même instantané, vol soutenu, thermique et mémoire),
  `scripts/j0-fiche.ts` (la fiche depuis `j0.json`, ⚠ quand la fréquence GPU rend une ablation incomparable),
  `tests/j0-intervals.test.ts`.
- **Preuve : mesuré** — e2e 3/3 réussis, deux passages sur ce Mac (fenêtre visible) et deux sur kerr-mini (plein écran),
  aucune erreur GPU ; [synthèse](docs/progress/j0/README.md), fiches et JSON dans `docs/progress/j0/`.
  - M1 Max frais : 36,8 images/s, p50 **25,1 ms**, p95 34,2, p99 50,3, CPU p95 6,4. Soutenu : 24,9 images/s, p50 41,5 —
    **le GPU de ce MacBook Pro bride à 30–60 % de sa fréquence en 2,5–4 min de jeu** (97–99 °C), puis oscille. kerr-mini
    (M1, fréquence stable) : 15,2 images/s, p50 60 ms, GPU 65 ms, frais comme soutenu.
  - Répartition (kerr-mini) : nuages −5,8 ms, décor −3,8, HUD −1,4, ombre de l'appareil −0,7, dessin de l'appareil −0,25 (masque gardé),
    matériau de l'eau 0 ; **le reste ≈ 53 ms est le sol et l'eau** (`earth lite` 17,5 + `earth water` 12,7 ms en passes de
    calcul). Les 37–49 ms que les horodatages donnaient à `ship: …`/`display` ne sont que du chevauchement (GP-09 confirmé).
    (`debugSkipShip` saute le dessin mais garde le masque du cockpit : l'image y garde un cockpit ancien, sol non ombré —
    vérifié par une sonde ; l'ablation borne le dessin, pas la surface cachée.)
  - Chemin d'entrée à froid : image pilotable 11 s (M1 Max) / 17–22 s (mini) ; relief fin 61–73 s / pas calme en 90 s ;
    détail complet 64–88 s / 127–142 s. **En vol, les tuiles en attente montent sans redescendre** (→ 192 et 258 en 70 s).
- **Documents** : contrat (nouveau, dans la carte `docs/README.md`), GRAPHICS-PIPELINE §8.2, §8.4 (mesures datées), §9
  (deux constats), priorités de l'audit (1.1, 1.2), stratégie §22.4 (suite), E2E-CATALOGUE.
- **Limites** : J0 n'est **pas atteint** — les seuils et l'état thermique qui juge le palier (frais ou soutenu) attendent
  Sam. Non mesuré : présentation à l'écran, latence commande → image, âge des instruments, caches chauds, écran titre,
  kerr-pc, qualité d'image. Le passage 2 du M1 Max a gardé le HUD éteint après l'ablation « affichages » (corrigé avant le
  passage 2 du mini). Aucun gain de performance n'est revendiqué : rien du rendu n'a changé.
- **Suite** : validation de Sam ; une ablation de la passe `earth water (raster)` (12,7 ms, que `liteSkip` 1 ne coupe pas) ;
  CM0 sur cette scène (le chargement qui ne suit pas) ; puis J1 jugé ici.

## 2026-11-10T11:45Z — Correctif : le déploiement Pages sauté depuis le retrait des previews

- **Constat (mesuré, `gh run view`)** : les runs 42791342827 et 42792793766 (vague 0, retrait des previews) sont verts mais
  leurs jobs `deploy` et `server` ont été **sautés** : avec `preview` et `ineptie` désormais inertes, le `success()`
  implicite de GitHub lit toute la chaîne. La page de fermeture n'était donc pas publiée (`/test/sw.js` servait encore
  l'ancien worker), samlepirate.org n'a rien reçu.
- **Correctif** : `deploy` et `server` testent `needs.site.result == 'success'` sous `!cancelled()` (`pages.yml`) ;
  [DEPLOY.md](docs/DEPLOY.md). **Vérifié** : run de `ed609b00` (le run de `188ae13b`, en attente, a été remplacé par lui) —
  `deploy` et `server` réussis ; `thesamlepirate.github.io/black-hole-gpu/test/sw.js` et `/ineptie/sw.js` servent le
  coupe-circuit, `/test/` la page « Cette preview n'est plus publiée ici ».

## 2026-11-10T13:02Z — J0 atteint : Sam valide les seuils et l'état soutenu

- **Contribution** (§15 J0, §22.4) : Sam valide les seuils du palier 1 (p50 et p95 ≤ 25 ms, p99 ≤ 37,5 ms, CPU p95 ≤ 4 ms)
  et le jugement sur l'état thermique **soutenu**. Avec les fiches des deux machines au même commit, **J0 est atteint**
  ([contrat](docs/J0-CONTRAT.md) §10–11) ; le gel des nouveaux lecteurs de `shadeLite` et `trace.wgsl` tombe. Le palier 1
  n'est pas atteint (M1 Max soutenu 41,5 ms au p50).
- **Preuve** : documenté (décision) ; les mesures sont celles de l'entrée précédente.
- **Suite** : l'analyse demandée par Sam de BakedVoxelLighting et web-ocean (mer, littoral, végétation), puis J1 jugé sur
  la scène de référence.
- **Incident du push** : `node_modules` avait disparu de la copie partagée (cause inconnue, aucune installation en
  cours) ; `bunx tsc` a alors téléchargé un paquet `tsc` 5.0.2 du registre, sans attributs d'import, et le portillon a
  refusé le push à raison. Réinstallé (`bun install --frozen-lockfile`, TypeScript 5.9.3) ; `scripts/pre-push.ts` appelle
  désormais `node_modules/.bin/{biome,tsc}` et refuse avec un message clair s'ils manquent — jamais de code téléchargé dans
  un hook.

## 2026-11-10T13:17Z — Mer, littoral, végétation : l'analyse de web-ocean et BakedVoxelLighting

- **Contribution** (§7.7 représentations par distance, §7.4–7.8 contrats, §19.11 qualité de la végétation et de l'eau,
  jalons J1 et J4) : demandée par Sam, l'étude complète de deux projets MIT —
  [web-ocean](https://github.com/Noniv/web-ocean) (mer FFT WebGPU) et
  [BakedVoxelLighting](https://github.com/SamG-Coder/BakedVoxelLighting) (littoral physique, végétation, éclairage cuit) —
  et ce que nous en reprenons : [docs/ANALYSE-MER-LITTORAL-VEGETATION-2026-11-10.md](docs/ANALYSE-MER-LITTORAL-VEGETATION-2026-11-10.md).
  Lots proposés : M1–M5 (mer : contrat de la FFT, LEAN complet, écume en cartes monde, cube du ciel, surface déplacée en
  J4), L1–L4 (littoral : champ de houle côtier par tuile, lame de rive, sable mouillé, bathymétrie), V1–V6 (végétation :
  tuiles de couvert et de canopée, imposteurs hémi-octaédriques, horizons de canopée, fondus, vent, transmission). Plans mis
  à jour : PLAN-REFRACTION-HORIZONS §0.4 et ses lignes T7, Q4, Q8 ; stratégie §23 ; PLAN-MONDE-VIVANT-AAA (en tête) ;
  GRAPHICS-PIPELINE §8.4 ; vague 6 de l'audit ; carte de la doc. Corrigé : la synthèse J0 donnait l'eau au domaine de J1.
- **Preuve** : lecture complète des deux dépôts (clones en lecture seule ; BakedVoxelLighting lu par un agent, références
  vérifiées par échantillon) ; **mesuré** : web-ocean 10–13 ms par image sur ce M1 Max (≈ 1 100 MHz, puis bridé) et
  32,5 ms sur kerr-mini ; **notre jeu dans les mêmes vues de mer 93,2 et 85,0 ms sur kerr-mini** (p50, échelle 0,75),
  captures dans `docs/progress/mer-vegetation/`. Non mesuré : BakedVoxelLighting (non lancé), tout gain des lots proposés.
- **Limites** : aucune ligne de code changée dans le jeu ; aucune dépendance ajoutée ; les coûts « visés » sont des
  objectifs. Observé en passant, à vérifier : des étoiles visibles avec le Soleil au ras de l'horizon, une traînée bleue
  d'optique dans la vue de mer.
- **Suite** : les décisions de Sam (ordre mer/J1, bathymétrie, arbres sources des imposteurs) ; l'ablation de la passe
  `earth water` ; puis J1.
- **Portillon avant push** : un `check-repo-size` s'est figé 12 minutes (endormi, sans processus fils ; 16 s à la main,
  cause non établie). Chaque vérification a désormais une limite de 240 s (`KERR_CHECK_LIMIT_S`) et son entrée standard
  fermée ; au-delà, elle est arrêtée et le push refusé en disant quoi relancer (testé avec une limite de 1 s).

## 2026-11-10T14:09Z — La mer WebGPU (PLAN-MER-WEBGPU) : S1 le contrat de la FFT, S2 la surface maillée, la pleine mer hors de shadeLite

- **Contribution** (§7.7 l'eau proche et moyenne, §7.4 la surface finale, décision de Sam du 10 novembre « la mer d'abord » ;
  [PLAN-MER-WEBGPU](docs/PLAN-MER-WEBGPU.md)) : la mer passe d'un plan ombré au pixel à une vraie surface, sur le modèle de
  web-ocean et dans notre monde.
  - **S1** : 4 cascades FFT **non commensurables** (1 031 / 173 / 29 / 4,9 m) et leur décalage d'ancrage en float64 (fin de la
    répétition de la mer au kilomètre) ; le **terme croisé des pentes** (LEAN complet : reflet du Soleil gaussien à covariance
    complète, Smith directionnel, lobe du SSR corrélé) ; l'échantillonnage **anisotrope** des cascades sur l'empreinte du
    pixel (`textureSampleGrad`, anisotropie ×8) ; les cascades fines **non calculées** quand l'empreinte du pixel de mer le
    plus proche les couvre, leur variance passée à la rugosité. `P.seafft` passe à 7 vec4.
  - **La pleine mer hors de `shadeLite`** : la classification de l'eau (`liteWater`) lue en tête, la pleine mer profonde
    quitte le noyau avant l'imagerie et l'éclairage du sol.
  - **S2** : la surface maillée — un CDLOD fixé sur la mer (`sea/surface-nodes.ts`, testé), déplacé par les cascades, courbé
    sur la Terre au niveau du géoïde, levé par la réfraction comme le sol ; dessiné par le module du terrain raster dans sa
    cible, gardé sur les pixels de pleine mer et de ciel ; sa distance exacte reportée dans `moments.y`, lue par `shadeWater`
    (inversion du déplacement en deux itérations).
  - **S5 (début)** : la mer ne reflète plus la sonde du vaisseau quand la caméra en est loin (caméra libre) — le ciel calculé au
    point et les nuages lointains à la place.
- **Preuve** : **mesuré** sur kerr-mini, A/B dans le même navigateur (PLAN-MER-WEBGPU §4) : vue de mer à 30 m **96,1 → 68–71 ms**
  (`earth lite` 35,5 → 10,3), à midi 88,7 → 68,3 ; côte à 500 m inchangée (hauts-fonds) ; la surface maillée de 0 à +4 ms.
  Tests : spectre (Hs, bandes), nœuds du CDLOD (aucun recouvrement, réseau fixe, nœud fin sous la caméra) ; `check-wgsl`
  71/71 ; budgets des noyaux relevés de 0,1 à 1,1 % (`tests/kernel-budget.json`).
- **Limites** : l'image n'est pas encore celle de web-ocean — S3 (son ombrage), S4 (l'écume en cartes monde), la suite de S5,
  et un flou fort au premier plan à établir ; les crêtes devant la terre ne sont pas dessinées ; les mesures de S2 ont été
  faites avec des vagues minuscules (`wind: 0`). Non mesuré : M1 Max, la scène J0 complète.

## 2026-11-10T14:23Z — La mer WebGPU : S4, l'écume attachée au monde ; S1–S2 poussés

- **Contribution** (PLAN-MER-WEBGPU S4) : l'écume vit sur la mer, plus dans les tuiles de la FFT qui se répétaient : deux cartes
  monde (128 m et 1 024 m autour de la caméra, toroïdales, dans les couches 12–15 de la texture de la FFT — aucune liaison de plus
  au traceur), nourries par le repli de toute la surface, qui vieillissent, dérivent sous le vent et gardent la fraîcheur des
  crêtes ; lues par `seaWavesFft` sur l'empreinte du pixel ; l'écume par cascade au-delà. Interrupteur `seaFoamWorldOn`.
  Poussé avant : S1–S2 (`22b97bd9`), après les e2e `sea-fft`, `miller-sea`, `titan-ground` (11/11 sur kerr-mini).
- **Correctif d'e2e** (remarque de Sam) : `sea-fft` volait bas au-dessus de la mer sans sortir le train — le GCAS ou
  l'autopilote faisait remonter l'avion ; train sorti et `apSet` à l'altitude de placement (E2E-VOLS §5.4).
- **Preuve** : **mesuré** sur kerr-mini (A/B) : +1 à +1,5 ms ; captures avec une mer imposée (`seaOverride`) : le rendu se
  rapproche nettement de web-ocean (PLAN-MER-WEBGPU §4). `check-wgsl` 71/71, `tsc`.
- **Limites** : l'écume a encore l'aspect de taches douces (S3) ; non mesuré sur M1 Max ; `sea-fft` corrigé non relancé.

## 2026-11-10T14:53Z — La mer WebGPU : les hauts-fonds hors de `shadeLite` (−12 à −14 ms à la côte), le ciel reflété autour de la caméra

- **Contribution** (PLAN-MER-WEBGPU S3, S5 ; stratégie §8 performance, §23) : la côte rejoint la pleine mer — un pixel tout
  d'eau de mer peu profonde quitte `shadeLite` après la seule lecture de l'imagerie (son albédo, éclairé dans `shadeWater`) ; le
  SSR seulement à moins de 8 km d'une terre (`seaAllAround`, une lecture du masque de mer) ; au-dessus de la mer, la sonde de
  lumière est tracée autour d'une caméra libre aussi (`seaProbeOn`) et la mer la reflète tant qu'elle est fraîche — le vrai ciel
  et ses nuages, au lieu du ciel d'une sonde laissée ailleurs ; crêtes fines transmettant la lumière à contre-jour ; écume
  éclairée par un ciel désaturé, bulles sous elle. Fichiers : `src/shaders/trace.wgsl` (`liteWater`/`shadeLite`, `shadeWater`,
  `seaShade`, `seaAllAround`), `src/renderer.ts` (`dispatchEnv`, `seaFftParams`).
- **Preuve** : **mesuré** sur kerr-mini, A/B dans le même navigateur, deux passages (PLAN-MER-WEBGPU §4) : côte à 500 m
  **84,4 / 84,4 → 71,8 / 69,9 ms** (`earth lite` 24,8 → 10,9), même image (couleur moyenne à 0,2 %, turquoise présent) ; mer à
  30 m 97,6 / 96,5 → 72,9 / 70,7 ; rivage inchangé ; la sonde : coût dans le bruit (midi, 30 m, côte), le couchant reflété
  orangé au premier plan au lieu de noir. `check-wgsl` 71/71, `tsc`, tests des budgets, du spectre, des nœuds, des rivages et de
  l'eau (81 pass). Captures `remote-results/20261110-153942-sea-s5/`, `remote-results/20261110-154613-sea-shallow/`.
- **Limites** : la passe d'eau reste ~31–38 ms ; le SSR conditionnel, les crêtes et l'écume ne sont pas mesurés séparément ;
  l'écume garde un aspect de taches à juger contre web-ocean ; les crêtes devant la terre ne sont pas dessinées ; non mesuré sur
  M1 Max ni sur la scène J0 ; e2e `sea-fft` corrigé non relancé. Prochaine étape : la passe d'eau (sonde → retrait du miroir des
  nuages proche et de `skyMirror`), puis S6.

## 2026-11-10T16:07Z — La mer WebGPU : Miller a la mer de la Terre (et n'est plus noire), Gargantua reflété par l'image

- **Contribution** (PLAN-MER-WEBGPU ; stratégie §7 « une responsabilité commune avant plusieurs lecteurs ») : un seul modèle de
  mer pour la Terre et Miller — `shadeNear` appelle le `seaShade` de la Terre en mode `SEA_ALIEN` au lieu de son ombrage propre
  (GGX scalaire) ; le ciel d'un monde à l'infini reflété depuis l'image (`seaSkySSR`, une projection, pas de marche) ; une
  régression de S1 corrigée : `tanh(k d)` en NaN sur Apple pour la cascade de 4,9 m dans l'eau de Miller — sa mer était noire,
  ses e2e verts ; `miller-sea` vérifie désormais le niveau de l'eau. L'écume : seuil de l'écume monde sur l'écart du Jacobien de
  toutes les cascades lues, bande des crêtes à l'échelle de cet écart (toutes les mers) ; Miller à 30 % des moutons de Monahan.
  La sonde au-dessus de la mer limitée à la Terre (Titan). Fichiers : `src/shaders/trace.wgsl`, `src/shaders/seafft.wgsl`,
  `src/renderer.ts`, `tests/e2e/miller-sea.e2e.test.ts`.
- **Preuve** : **observé** sur kerr-mini (`miller-sea`, 3/3, captures `remote-results/*-miller-sea6/`) : mer bleu-vert sombre,
  stries d'écume rares, chemin de lumière ; **mesuré** : le SSR du ciel dans le bruit (61,5 / 60,9 contre 61,7 / 60,4 ms) ; la
  coupure des ombres du relief sur la pleine mer mesurée sans gain et retirée. `check-wgsl` 71/71, `tsc`.
- **Limites** : le SSR ne reflète que le ciel à l'écran (le reflet du disque tombe sous le Ranger dans les vues du test) ; le
  coût de la mer de Miller face à l'ancien ombrage non mesuré (l'ancien était en NaN) ; `titan-ground` aux limites de 300 s de
  ses attentes (un cas échoue selon le passage) ; non mesuré sur M1 Max.

## 2026-11-10T18:10Z — La mer WebGPU : un noyau pour la pleine mer (−3 ms), le ciel reflété filtré par la rugosité

- **Contribution** (PLAN-MER-WEBGPU S3, S5 ; stratégie §8 performance) : la passe d'eau décomposée par ablations avec témoins — son
  coût est surtout celui d'un noyau limité par ses registres sur Apple (tout bloc retiré, même jamais exécuté, en ôte 6 à 9 ms) ;
  d'où **`shadeWaterOpen`**, `shadeWater` compilé sans le code des côtes et de l'eau intérieure pour les pixels de pleine mer, chaque
  noyau laissant à l'autre ses pixels ; et **le ciel reflété filtré par la rugosité** (M4 de l'analyse) : les niveaux GGX de la sonde
  copiés dans la texture de la FFT (aucune liaison de plus), lus au niveau de la rugosité de l'eau. Fichiers : `src/shaders/trace.wgsl`,
  `src/system/tracer-kernels.ts`, `src/renderer.ts`, `src/sea/fft-gpu.ts`, `src/ship.ts`, `scripts/lib/kernel-profiles.ts`,
  `tests/sea-sky-layer.test.ts`, `tests/kernel-budget.test.ts` (l'entrée WGSL par `tracerEntryPoint`).
- **Preuve** : **mesuré** sur kerr-mini, A/B `seaWaterOpenOn`, deux passages (PLAN-MER-WEBGPU §4) : mer à 30 m 67,0 → 64,25 ms, midi
  65,8 → 62,85, côte à 500 m 64,25 → 65,0 ; images identiques (moyennes à 0,1–3 %). Le ciel filtré : **observé**, le lointain sans
  pétillement au couchant. `check-wgsl` 72/72, `tsc`, tests (90 pass) ; budgets des noyaux réécrits (+1 à +2,5 %, la mer de Miller dans
  `shadeNear` de chaque noyau, le nouveau noyau ~5,5 k lignes inlinées).
- **Limites** : la côte paie 1,5 ms la classification du noyau de pleine mer sans rien à y ombrer ; le ciel filtré et les deux
  allègements (éclairement du ciel, traînées) non mesurés seuls ; la compilation d'un noyau de plus (en arrière-plan, après l'image)
  non chronométrée ; non mesuré sur M1 Max ni J0.

## 2026-11-10T17:15Z — J0 après la mer WebGPU : 65 → 61 ms sur kerr-mini

- **Correction** : l'entrée précédente est datée « 18:10Z » par erreur ; elle a été écrite vers 17:00Z.
- **Contribution** (PLAN-MER-WEBGPU S6, J0) : la scène de référence revolée après les lots de la mer — elle coûte moins et montre plus.
  Fiche nouvelle `docs/progress/j0/FICHE-kerr-mini-2026-11-10-mer.md` (vol seul, deux passages) ; celle du matin marquée périmée
  pour le vol, ses ablations gardées.
- **Preuve** : **mesuré**, kerr-mini à 1 278 MHz stables, commit `510bb87f` : GPU p50 65,4 / 64,2 → **60,9 / 60,7 ms**, 15,2–15,5 →
  16,4 images/s ; `earth lite` 17,5 → 12,1 ms, `earth water` 12,7 → 12,4 + 2,1 (pleine mer), `sea fft` 1,6 → 2,1. Chemin d'entrée à
  cache Metal chaud 12,2 / 16,9 s (matin 12,8 / 17) ; à froid, sources neuves, 33,3 / 60,8 s.
- **Limites** : palier de 25 ms toujours loin (intervalle p50 60 ms) ; pas d'ablations ni de vol soutenu ce soir ; M1 Max non revolé ;
  aucun point froid du matin pour juger le chemin d'entrée à froid.

## 2026-11-10T17:35Z — J0 sur M1 Max après la mer : le palier 1 tenu en médiane (frais)

- **Contribution** (J0, palier 1 ; PLAN-MER-WEBGPU S6) : la scène de référence revolée sur le témoin du palier.
- **Preuve** : **mesuré**, M1 Max frais (95,7 °C, Nominal → Moderate), fenêtre visible 1800 × 1169, commit `f0f24c9e`, un vol :
  36,8 → **42,5 images/s**, intervalle p50 25,1 → **24,9 ms** (palier ≤ 25 ✓), p95 33,3 ✗, p99 49,6 ✗ ; GPU p50 26,3 → 23,0 ms ; CPU p95
  6,4 → 5,8 ms (✗ ≤ 4). Fiche `docs/progress/j0/FICHE-m1max-2026-11-10-mer.md`.
- **Limites** : frais seulement — le vol soutenu (le M1 Max bride en 2,5–4 min) non revolé ; régularité et CPU hors palier ; un seul
  passage ; chemin d'entrée à froid non comparable (cache Metal vide ce soir, chaud ce matin).

## 2026-11-10T17:31Z — J1 commence : le plan, et la description de frame figée (premier lot)

- **Contribution** (stratégie §15 J1, §7.3 ; PLAN-J1-OPAQUE-FORWARD) : le plan de J1 écrit depuis le code relevé (visibilité dont la
  profondeur est jetée, `shadeLite` qui reconnaît ce que d'autres ont dessiné, pas d'identité ni de mouvement, l'appareil hors
  historique, pas de description de frame) en lots J1-0 à J1-7 ; J1-1 commencé : `src/frame-desc.ts` — une description de frame
  construite une fois par image (id, horloge réelle, horloges du vol et de la scène, caméra et caméra précédente) — que les 17
  lectures d'horloge de l'encodage lisent désormais (une seule horloge par image pour les fondus, les fraîcheurs et les animations).
- **Preuve** : tests `frame-desc` (3) ; `tsc`, biome ; e2e `sea-fft` 5/5 et J0 (kerr-mini) inchangé : GPU p50 60,9 ms, 16,5 images/s.
- **Limites** : la caméra précédente n'a pas encore de lecteur (le mouvement de J1-2) ; les ~40 champs posés par `main.ts` et les
  lectures de `Settings` pendant l'encodage ne sont pas migrés ; questions de J1-0 à Sam (outillage de layout, étendue du domaine pilote).

## 2026-11-10T18:14Z — La mer WebGPU : la bathymétrie de Dean (L4), le rivage par inondation de sauts, la mer sans points verts

- **Correction d'heure** : l'entrée « 17:35Z » (J0 sur M1 Max) a été écrite vers 17:25Z.
- **Contribution** (PLAN-MER-WEBGPU L4, option a de Sam ; stratégie §7.6 « données prêtes avant la frame ») : la distance au rivage
  devient un produit du monde à grande portée — cuite par inondation de sauts sur toute la fenêtre des niveaux 3 à 6 du cache de relief
  (jusqu'à ±50 km ; avant ~100 m) — et nourrit le profil d'équilibre de Dean là où les tuiles n'ont pas de profondeur ; un défaut de T7
  corrigé : le turquoise des hauts-fonds s'ouvrait sur chaque point blanc de l'orthophoto (points verts sur la mer). Fichiers :
  `src/system/earth-shore.ts`, `earth-shore-layout.ts`, `src/shaders/trace.wgsl` (`seaDepthAt`, `seaShoreDist`, offsets des
  tables), `scripts/check-wgsl.ts` (la cuisson compilée), `tests/earth-shore.test.ts`.
- **Preuve** : **testé** (l'inondation sur le CPU contre la recherche exacte : ≥ 97 % exacts) ; **mesuré** sur kerr-mini : coût dans le
  bruit ; points verts ~950 → 0 dans la vue de l'Almanarre, couleur moyenne inchangée (planche `docs/progress/mer-webgpu/almanarre-points-avant-apres.jpg`) ;
  e2e `coast-loading` et `sea-fft` (6/6), `check-wgsl` 73/73, `tsc`, tests (73 pass).
- **Limites** : dans les vues de Hyères Terrarium porte déjà la profondeur — l'effet de Dean n'y est pas visible ; à juger sur une
  côte sans données (hors de France) ; la cuisson des quatre niveaux non chronométrée seule.

## 2026-11-10T18:30Z — Titan sans faux « page figée », M1 Max soutenu, le noyau de pleine mer conditionnel

- **Contribution** : (1) `titan-ground` fiable — ses attentes de compilation tenaient dans une seule évaluation de 600 s, coupée par
  DevTools à 300 s (« the page hung? ») : sondées par `waitProgress`, 3/3 en 83 + 7 + 7 s au lieu de 253–300 s ; la leçon dans E2E.md §7.
  (2) J0 complet sur le M1 Max (PLAN-MER-WEBGPU S6) : vol frais 40,9 images/s, soutenu 24,9 → 31,4 images/s (≈ +9 % par MHz ; bridage
  moindre ce soir) ; ablations faussées par le bridage. (3) Le noyau de pleine mer envoyé seulement s'il y en a en vue (tampon relu).
- **Preuve** : **mesuré** — e2e `titan-ground` 3/3 sur kerr-mini ; fiche `FICHE-m1max-2026-11-10-mer-complet.md` ; kerr-mini : côte
  neutre (68,5 / 68,35 ms), mer à 30 m −2,75 ms. `check-wgsl` 73/73, `tsc`.
- **Limites** : le soutenu du matin et du soir à des fréquences différentes ; ablations à refaire sur kerr-mini avec le code du soir.

## 2026-11-10T19:03Z — J0 : la répartition par poste après la mer, la sonde mesurée

- **Contribution** (J0 / J1 : où gagner ; PLAN-MER-WEBGPU S5) : les ablations de J0 refaites sur kerr-mini avec le code du soir (fiche
  `FICHE-kerr-mini-2026-11-10-mer-ablations.md`) ; le défaut de la sonde de lumière mesuré pour la première fois (de jour sa radiance
  ≈ π fois celle de l'image dans le même axe, de nuit ~0,3) et consigné, ouvert.
- **Preuve** : **mesuré** (kerr-mini, 1 278 MHz) : contre une base de 62,3 ms (dérive 3,2 ms) — nuages −6,2, appareil −3,7, décor −2,6,
  HUD −1,6, ombre de l'appareil −1,5, eau −0,5 ; sonde `night-probe` deux passages à 1 % près.
- **Limites** : la dérive de la base (±1,6 ms) rend les petits postes incertains ; l'écart de l'appareil à recontrôler ; la cause du
  facteur de la sonde non trouvée.

## 2026-11-10T19:07Z — Correction : le facteur ≈ π de la sonde n'est pas établi

- L'entrée précédente annonçait une sonde ≈ π fois plus lumineuse que l'image de jour. Un troisième passage donne 1,59 : la valeur
  lue dans `accum` a doublé d'un passage à l'autre, la sonde non ; la méthode (`accum` / poids au centre) n'est pas une radiance finale
  fiable. Établi seulement : la sonde est plus lumineuse que l'image de jour (×1,6 à ×3,2 selon le passage). À remesurer autrement
  (PLAN-MER-WEBGPU §4, dernière entrée).

## 2026-11-10T19:18Z — La mer WebGPU : les crêtes devant la terre (limite de S2 levée)

- **Contribution** (PLAN-MER-WEBGPU S2 ; stratégie §7.4 « l'eau a sa propre surface ») : la surface maillée de la mer garde ses crêtes
  devant le sol plus haut que la borne des vagues, là où leur propre point est en mer selon les distances au rivage d'aujourd'hui —
  une seule source pour le masque terre/mer (la cuisson par inondation de sauts), lue aussi par le raster. Fichiers :
  `src/system/terrain-raster.ts` (`seaFs`, `seaShoreR`), `src/renderer.ts` (`seaCrestsOverLand`, la borne des vagues).
- **Preuve** : **mesuré** sur kerr-mini (A/B) : coût dans le bruit (68,9 / 69,1 ms) ; **observé** : devant Porquerolles, changement
  à peine visible à 1,7 km, aucun débordement ; e2e `sea-fft`, `coast-loading` 6/6 ; `check-wgsl`, `tsc`.
- **Limites** : le cas d'une plage proche à basse hauteur non vu (la vue visée la manquait) ; l'effet se juge mieux plus près des
  falaises et par houle forte.

## 2026-11-10T19:30Z — J1-0 : les paramètres du traceur écrits par noms, générés depuis le WGSL

- **Contribution** (stratégie §18 « contrats et layouts CPU/WGSL », PLAN-J1 J1-0) : **webgpu-utils** adopté (2.1.1, MIT, dépendance de
  développement seulement : le premier choix de CLAUDE.md, évalué §4 bis) ; `scripts/gen-layouts.ts` lit la structure `Params` de
  `trace.wgsl` et écrit `src/gen/params-layout.ts` (offsets, étendues, indices de vec4) ; `writeParams` écrit par noms — ~94 positions
  numériques et les sommes de vec4 tenues à la main retirées ; les tailles de blocs du renderer dérivées du WGSL (une seule autorité) ;
  test (à jour, blocs des autres modules à la taille du WGSL) et contrôle dans le portillon avant push. Aucun poids dans le bundle.
- **Preuve** : tests (81 pass), `tsc`, biome ; e2e `sea-fft` 5/5, `miller-sea` 3/3, J0 inchangé (kerr-mini 61,2 ms) — les mêmes
  paramètres qu'avant, par construction et à l'image.
- **Limites** : les autres structures (terrain raster, mer, sonde, nuages…) gardent leurs offsets à la main ; le domaine pilote de J1
  pris par défaut (la portée du patch), révisable par Sam.

## 2026-11-10T19:55Z — J1-2 commence : le mouvement des objets mobiles dans la visibilité

- **Contribution** (stratégie §7.4 « mouvement : vecteur pour objets/déformations », PLAN-J1 J1-2) : la passe de visibilité du raster a
  une seconde cible, `terrain raster motion` (rgba16float) : les maillages mobiles du décor (voitures et leurs feux, pales des
  éoliennes) y écrivent leur mouvement sur l'image depuis l'image d'avant — leur point à l'horloge d'alors, par la caméra d'alors
  (l'uniforme du décor porte la caméra précédente, valide tant que l'origine du décor ne change pas) ; `temporal` et `taau` reprojettent
  ces pixels par lui (les autres par la caméra et la profondeur, exacts pour le rigide). Levier `sceneryRaster.motionOn`. Fichiers :
  `src/system/scenery-raster.ts`, `terrain-raster.ts`, `src/shaders/post.wgsl`, `src/renderer.ts`.
- **Preuve** : relecture sur kerr-mini — ~900–1 000 pixels en mouvement de 4–7 px par image sur Toulon (0 sans le levier), aucune
  erreur GPU ; e2e `sea-fft` 5/5, J0 62,8 ms (60,7–61,2 aux passages précédents : dans l'écart observé, le coût de la cible non mesuré seul).
- **Limites** : l'effet visuel (traînées des voitures) non concluant à 400 m — à juger plus bas, caméra immobile ; le flou de mouvement
  ne lit pas encore la cible ; la profondeur gardée et l'identité stable (le reste de J1-2) à faire ; `raster-motion` (banc) non lancé.

## 2026-11-10T19:59Z — J1-2 : le mouvement des voitures éteint par défaut (régression visible)

- **Constat** : au zoom sur l'autoroute de Toulon (champ 12°, caméra immobile, kerr-mini), les voitures laissent des traînées **plus
  longues** avec le mouvement que sans ; des sauts de 145 px de moyenne apparaissent (les voitures qui rebouclent sur leur tronçon).
  Le vecteur, ou son emploi par l'historique, est encore faux.
- **Fait** : `sceneryRaster.motionOn` **éteint par défaut** — l'image du jeu redevient celle d'avant J1-2 ; le mécanisme reste (cible,
  liaisons, lecture), à reprendre. Pistes : l'horloge d'avant (`pcam.w`) et la fréquence de mise à jour de l'uniforme du décor ; les
  sauts de boucle à marquer « sans historique » (z 2) ; la pondération de l'historique pour un pixel en mouvement.

## 2026-11-10T20:31Z — J1-2 : les traînées des voitures corrigées, le mouvement des objets mobiles allumé

- **Contribution** (stratégie §7.4 « mouvement : vecteur pour objets/déformations », PLAN-J1 J1-2) : la cause des traînées trouvée
  par ablation sur kerr-mini (sans `temporal`/`taau`, aucune traînée ; à toutes les cadences d'ombrage du raster, des traînées) :
  avec la caméra immobile, l'historique du sol est « porté » au même pixel, **non borné** (α 0,1) — l'image d'une voiture qui vient de
  partir y restait une dizaine d'images. Désormais le mouvement de l'image d'avant est copié en fin d'image (`renderer.keepMotion`,
  texture `motion, the frame before`, liaison 50 de `temporal` et `taau`) : un pixel qu'un mobile couvrait et ne couvre plus repart
  **sans historique** (désoccultation) ; une voiture que sa boucle ramène (saut > ¼ d'image) écrit z 2 : sans historique non plus.
  `sceneryRaster.motionOn` **allumé par défaut**. Un premier essai copiait sur la soumission du rendu hors ligne (jamais en temps réel) :
  relu (0 pixel dans la copie), déplacé sur la soumission de l'image temps réel. Fichiers : `src/shaders/post.wgsl`,
  `src/renderer.ts`, `src/system/scenery-raster.ts`.
- **Preuve** : **observé** sur kerr-mini (autoroute de Toulon, champ 12°, caméra immobile, horloge courante) : voitures nettes sans
  traînée, image proche de celle sans historique ; la copie relue (≈ 3 200 pixels de l'image d'avant). e2e `sea-fft` 5/5, J0 2/2
  (vol GPU p50 62,6 ms, 16 images/s — 60,7–62,8 aux passages précédents : dans l'écart observé ; la copie, ~9 Mo par image, non
  mesurée seule). `check-wgsl` 73/73, `tsc`.
- **Caméra en mouvement** (ajout, 20:50Z) : zoom continu 12° → 9° pendant la capture, kerr-mini : avec le mouvement, voitures nettes et pleines ; sans, pâles et traînantes (`docs/progress/j1/j1-2-voitures-zoom-camera.jpg`), 0 erreur GPU.
- **Limites** : éoliennes non revues en image ; le flou de mouvement ne lit pas
  encore la cible ; la profondeur gardée et l'identité stable (reste de J1-2) à faire ; banc `raster-motion` non lancé.

## 2026-11-10T21:10Z — PLAN-MER S5 : le « défaut » de la sonde était une erreur de mesure

- **Contribution** (stratégie §7.4 lumière partagée ; PLAN-MER-WEBGPU S5) : la sonde de lumière, qui sert au reflet du ciel sur la mer
  (couche 16 de la FFT) et à l'éclairage de l'appareil, était réputée 1,6–3,2 fois trop lumineuse de jour et 3–4 fois trop sombre de
  nuit. Remesuré sur l'historique linéaire (`temporal` divisé par sa pré-exposition) : les texels lus jusqu'ici étaient les mêmes
  quelle que soit la vue — la sonde est rangée sur les axes du monde, pas sur ceux de la caméra. Lue dans la direction de la vue :
  **1,01–1,04 de jour** (4 vues), 1,14 au crépuscule, 1,19–1,36 de nuit (le plus fort au ras de l'horizon, 5 × 5 texels sur un gradient
  raide). Aucun code changé : la sonde peut juger le reflet ; la piste « facteur π » est close. `docs/PLAN-MER-WEBGPU.md` §4.
- **Preuve** : **mesuré** sur kerr-mini (sonde e2e `probe-hist`, 7 vues, 0 erreur GPU).
- **Limites** : l'écart de 10–35 % au ras de l'horizon la nuit n'est pas séparé du lissage de la mesure (à refaire sur un texel).

## 2026-11-10T22:10Z — Relief IGN : un faux plateau de 120–165 m sur la mer à Giens corrigé ; crêtes vues d'une plage vérifiées

- **Contribution** (stratégie §7 « le monde possède les supports et révisions du sol » ; zone J0 Toulon-Hyères ; PLAN-MER S2) : en
  vérifiant les crêtes depuis la plage de l'Almanarre, un bloc noir de 120–165 m de haut est apparu sur la mer — et dans le **sol de
  contact** (`sys.groundAt`), pas seulement à l'image. Cause : la Géoplateforme renvoie pour le LiDAR HD sur l'eau du « sans donnée »
  rééchantillonné et un bruit positif (jusqu'à 204 m, relevé sur le WMS-R) ; en z 16 la tuile a des trous, RGE ALTI est demandé et la
  corrige ; en z 17 elle n'en a aucun et n'est contrôlée que si les niveaux grossiers la jugent suspecte — quand ils ne sont pas encore
  là (cellules NaN), elle passait. `ignGround` demande désormais RGE ALTI aussi quand les niveaux grossiers ne peuvent pas juger
  (`coarseUnknown`, moins d'un quart des cellules connues). Fichiers : `src/system/earth-tiles.ts`, `tests/ign-lidar-sea.test.ts`.
- **Preuve** : **observé/relu** sur kerr-mini : avant, sol de contact à 170–214 m sur l'ellipsoïde (mer 48,6) sur ~600 × 500 m ; après,
  48,6 partout, le rivage du tombolo à 6,1254° E (0,2 m) ; planche `docs/progress/mer/almanarre-lidar-avant-apres.jpg`. Test unitaire.
  Crêtes (S2) : depuis 3 m, 150 m de la plage, `seaCrestsOverLand` allumé/éteint, ligne de plage identique.
- **Limites** : des requêtes RGE ALTI en plus au chargement quand les niveaux grossiers manquent (non comptées) ; les tuiles déjà en
  cache disque/zone hors ligne d'avant la correction ne sont pas revues ; les pins vus de près sont presque noirs et en dents de scie
  (look des arbres, lot V2), non traité ici.

## 2026-11-10T22:40Z — J1-3 préparé : ce que l'ombrage du sol lit, et ce qu'un fragment forward peut porter

- **Contribution** (stratégie §7.4 « socle raster forward, matériaux explicites », PLAN-J1 J1-3/J1-4) : `scripts/ground-shading-
  inventory.ts` relève, depuis le WGSL composé (profil J0), les ressources que `shadeLite` lit par famille. `shadeLite` entier :
  20 textures (au-delà des 16 d'un étage aux limites WebGPU par défaut) ; **la surface seule** (sans l'air et les nuages devant, ni
  l'eau) : 14 textures une fois la cible de visibilité devenue les données du fragment, 2 tampons lus, 4 échantillonneurs — **elle tient**.
  D'où le découpage écrit dans le plan (§4 ter) : le fragment forward ombre la surface et écrit radiance + profondeur finale ; l'air et
  les nuages restent une composition par la profondeur ; l'eau à J4 ; le module partagé spécialisé (214 fonctions : la compilation est
  le risque principal), l'imagerie et le ciel d'abord, puis le soleil.
- **Preuve** : **vérifié statiquement** (script, sortie dans le plan). Aucun code de rendu changé.
- **Limites** : le comptage est par nom de ressource dans les fonctions atteintes (une branche morte par spécialisation peut y être
  comptée : majorant) ; la compilation d'un tel module raster non mesurée ; J1-3 lui-même (le module partagé) reste à faire.

## 2026-11-10T22:55Z — J1-3 : la première famille du sol en module partagé (l'imagerie)

- **Contribution** (PLAN-J1 J1-3, bibliothèque de matériaux) : le lecteur de l'imagerie (`orthoAt`, `orthoGrad`, `tileImgAt`,
  `tileImgGrad`, `tileLightsAt` et ses textures) devient `orthoImageryWgsl(groupe, liaisons)` dans `src/system/earth-tiles.ts` : le
  traceur l'injecte avec ses liaisons d'aujourd'hui (groupe 0, 44–46), un fragment raster pourra l'inclure à son groupe — une source.
- **Preuve** : **vérifié statiquement** — le WGSL du traceur composé est identique octet pour octet (970 959 caractères) ; tests
  `ortho` (le module aux deux groupes) et `kernel-budget` (63) ; `tsc`, biome.
- **Limites** : `earthImageryAniso` et les fonctions de placement (`imageryUv`, `tileCoord`, `tilePlace`) restent dans `trace.wgsl` ;
  le ciel et le soleil à suivre ; aucun pipeline raster ne l'inclut encore (J1-4).

## 2026-11-10T23:15Z — J1-3 : la bibliothèque du sol tirée du traceur (une source, trois familles compilées seules)

- **Contribution** (stratégie §7.4 « matériaux explicites », PLAN-J1 J1-3) : `src/system/wgsl-library.ts` — `wgslClosure` (les
  fonctions qu'une racine atteint, les constantes/overrides/variables privées et structures qu'elles lisent, les ressources liées du
  traceur qu'elles emploient) et `wgslLibraryModule` (un module autonome). Généralise le mécanisme que seul le cache de relief avait
  (`terrainHeightLibrary`, réécrit dessus). Voie retenue (plan §4 ter) : `trace.wgsl` reste l'unique source, un pipeline raster en tire
  sa fermeture ; rien n'est déplacé.
- **Preuve** : **vérifié statiquement et compilé** — les shaders du cache de relief et du raster identiques octet pour octet avant/après
  (130 703 caractères) ; les familles ciel (`liteSky` : 8 fonctions, `P` + `bodies`), imagerie (`earthImageryAniso` : 8, + `orthoTex`,
  `orthoSamp`, `imgTex2k`) et soleil (`liteSun` : 43, 13 ressources) compilent seules dans Chrome (`check-wgsl` 76/76) ; test
  `wgsl-library` ; `tsc`, biome.
- **Limites** : aucun pipeline de rendu ne les emploie encore (J1-4 : le fragment forward, la renumérotation de ses liaisons à l'étage
  fragment, le coût de compilation à mesurer) ; les déclarations multi-lignes (`const` sur plusieurs lignes) ne sont pas prises par la
  fermeture — aucune dans ces familles.

## 2026-11-10T23:35Z — J1-4 : le coût de compilation de la surface forward mesuré

- **Contribution** (PLAN-J1 J1-4, premier risque ; stratégie §8 compilation) : `scripts/ground-compile-cost.ts` compile à froid,
  alternés, le noyau `shadeLite` du profil J0 et la fermeture « surface seule » (`wgsl-library.ts`, sans l'air/nuages ni l'eau).
- **Preuve** : **mesuré** sur ce Mac (M1 Max, Chrome sans interface, 4 tours) : `shadeLite` 1,26–1,32 s, surface 1,10–1,17 s (−13 %).
  Piège relevé : un nonce en commentaire ou un simple renommage laisse le cache du pilote répondre (~45 ms) ; une branche vivante sur
  un nonce force la compilation.
- **Limites** : module de calcul, pas encore l'étage fragment ; une seule machine ; la transition (shadeLite + fragment) ajouterait
  ~1,1 s à froid, à anticiper hors du chemin bloquant.

## 2026-11-11T00:20Z — J1-4 : la surface du sol en fonction (`liteSurface`), le coût inchangé

- **Contribution** (PLAN-J1 J1-4, première étape) : le corps de `shadeLite` coupé en prologue (rayon et point depuis la visibilité,
  l'eau et ses sorties), **`liteSurface`** (albédo, matériaux, soleil et ombres, ciel, rebond, lune, spéculaire, pluie, lumières → la
  radiance de surface) et épilogue (eau, mesures, `liteFinish`). Ce que la surface lit de la visibilité passe par `RasterAttr` et des
  accesseurs : en calcul, chaque lecture reste à sa place (la constante se replie) ; le fragment forward en donnera les champs.
  Aussi : `tests/giant-clouds.test.ts` cherchait l'ancienne écriture positionnelle de J1-0 (`PARAMS.wx + 6 * 4` maintenant) — corrigé.
- **Preuve** : `check-wgsl` 76/76, `kernel-budget` 63/63, suite unitaire sur kerr-mini 2 151 pass (5 dépassements de 5 s sous la charge
  de J0, repassés ici 12/12) ; **mesuré** J0 seul sur kerr-mini : GPU p50 vol 62,4 ms, vue figée 62,3/62,6 (avant 62,6 ; 62,7/60,6) ;
  e2e `sea-fft` 5/5. Un premier passage (attributs lus d'emblée) donnait 66 ms pendant la suite unitaire sur la même machine : la
  mesure faussée, la variante remplacée par les accesseurs sans être remesurée seule.
- **Limites** : rien ne dessine encore en forward ; prochaine étape : le pipeline du fragment (patch redessiné en profondeur égale,
  profondeur gardée — reste de J1-2 —, groupe « lumière du sol »).

## 2026-11-11T00:00Z — J1-4 : le pipeline forward du sol construit en pilote, éteint — pas encore fonctionnel

- **Contribution** (PLAN-J1 J1-4 ; stratégie §7.4) : la chaîne forward existe derrière `renderer.forwardGround` (éteint) —
  `liteForwardG` / `liteForwardFinish` (trace.wgsl), `system/terrain-forward.ts` (modules tirés du traceur spécialisé par
  `wgsl-library.ts`, le fragment visible retenu par sa distance, l'étage de sommets du module de la visibilité, la finition sur la mise
  en page du traceur sans texture de plus), `TerrainRaster.encodeForward`, `renderer.encodeForward`, `shadeLite` qui saute les pixels
  finis (`RASTER_FORWARD_FLAG`). `wgsl-library` ignore désormais les commentaires (un mot de commentaire comptait pour une ressource).
- **Preuve** : `check-wgsl` 78/78 (module forward et finition compilés pour J0) ; le pipeline de rendu accepté par Chrome (ce Mac,
  1,2–1,7 s à froid) ; sur kerr-mini : pipelines construits, passes `forward ground` 0,85–1,3 ms et finition 0,13 ms, 0 erreur GPU ;
  **aucun fragment écrit** (cible relue vide, même en diagnostic à remplissage constant) — non résolu. Défaut éteint : chemin par
  défaut inchangé hors le test de saut dans `shadeLite` (non remesuré).
- **Limites / suite** : trouver pourquoi le dessin ne produit pas de fragment (comparer l'uniforme du patch à l'instant du forward, un
  triangle de test, le même pipeline avec la cible de profondeur de la visibilité) ; puis A/B image et coût sur J0. GRAPHICS-PIPELINE
  (C17b), BH-API (`forwardGround`…).

## 2026-11-11T00:45Z — J1-4 : le forward du sol fonctionne, mesuré +13,6 ms — une mesure qui oriente la suite

- **Contribution** (PLAN-J1 J1-4 ; stratégie §7.4/§8) : la cause des « zéro fragment » trouvée par sondes successives (le rejeu du
  pipeline de visibilité, le décompte des codes de maillage, les raisons des rejets) : les pipelines forward étaient créés sans les
  `constants` de la clé — le source spécialisé garde ses `override` à leur défaut (`HAS_TERRAIN_RASTER` faux). Corrigé ; le forward a
  aussi son propre uniforme (copie de la trame de la visibilité) et un diagnostic (`forwardDebug`, `TerrainRaster.forwardProbe`).
- **Preuve** : **mesuré** sur kerr-mini (Toulon, 120 m sur le sol, 1440×810) : 285 500 pixels ombrés par le fragment, image identique à
  l'œil, 0 erreur GPU ; `forward ground` 16,3 ms + finition 1,0 ms contre `earth lite` −3,7 ms : **+13,6 ms l'image**.
- **Ce que ça dit** : sur le maillage fin du patch (~3 px par triangle), l'ombrage par fragment coûte ~4× le calcul par pixel
  (hypothèse : les quads 2×2 aux bords des triangles, non mesurée seule). La visibilité suivie d'un calcul reste la voie efficace pour le
  sol dense ; un forward n'y paierait qu'avec un maillage d'ombrage plus grossier ou pour les grands triangles (bâtiments, appareil —
  J1-5). **Décision de Sam** sur l'orientation de J1-4 ; le pilote reste éteint.

## 2026-11-11T01:40Z — Mesure : `shadeLite` paie ~16 ms de « présence » de l'air et des nuages sur une forêt basse

- **Contribution** (stratégie §8 performance ; J0 / chemin des 60 images/s) : sur Toulon à 120 m au-dessus d'une forêt (kerr-mini,
  1440×810), `earth lite (raster)` coûte ~46 ms. Coupées **à l'exécution** (`liteSkip`), aucune famille n'en retire plus de 2 ms (arbres,
  ombres, surfaces, imagerie, AO, spéculaire, air et nuages : 0–2 ms) ; seul l'arrêt du noyau au début (1024) le ramène à 4 ms. Coupés
  **à la compilation** (`renderer.tune`, `TUNE_LITE` 2048 : l'air et les nuages devant la surface retirés du noyau), deux fois :
  **46,5 → 28,2 ms (−18 ms)**. ~16 ms sont donc le coût de la présence de ce code dans le noyau (registres, occupation), non son travail.
  `sceneryTreeLite` fait 30 % du code inliné, `liteSurface` 50 % (`wgsl-inline-size`).
- **Suite** (en cours) : sortir `liteFinish` de `shadeLite` — le noyau écrit la radiance de surface, une passe `shadeLiteFinish` (la
  finition du forward de J1-4, déjà écrite) met l'air et les nuages. Gain attendu à mesurer (le travail de l'air reste, ~2–5 ms).
- **Limites** : une vue (forêt basse) ; les autres coupes à la compilation (arbres, ombres, surfaces, détail, routes) ont donné
  110–120 ms — des mesures non valides (un autre noyau mesuré pendant la compilation, probablement), non retenues ; « lumière plate » 84 ms,
  anomalie non expliquée.
