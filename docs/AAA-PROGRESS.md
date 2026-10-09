# Vers l'AAA : suivi d'exécution

Ce fichier suit l'exécution du plan de l'audit [`AUDIT-AAA-2026-10-03.md`](AUDIT-AAA-2026-10-03.md). Il est mis à jour à chaque étape, avec un commit par étape et un push par phase (chaque push déploie GitHub Pages).

**Décisions du propriétaire (03/10/2026) :**
- je travaille seul sur `main` (du 05 au 07/10, le travail s'est fait sur la branche `test-kimi`, déployée sous `/test/`, puis fusionnée dans `main` le 07/10 en avance rapide, `229b2f3`) ;
- chaque phase est poussée ;
- ordre : **phase 0 → G0 Kerr Bench → U0 → phase 1 → le reste** ;
- interface en **FR + EN** (i18n).

## Tableau de bord

| Pilier | Départ (audit) | Actuel | Cible AAA |
|---|---:|---:|---:|
| Physique | 64 | 80 | 80 |
| Code + tests | 44 | 76 | 75 |
| Technologie | 67 | 79 | 80 |
| UI / UX / HUD | 44 | 79 | 80 |
| Produit / gameplay | 50 | 72 | 80 |
| **Global** | **≈ 54** | **≈ 77,5** | **≈ 78–80** |

*Réestimé après le plan HUB (08/10/2026).* **UI** (77 → 79) : la carte du hub, la télémétrie, les graphiques et le rapport de vol (section [Plan HUB](#plan-hub--hub-télémétrie-graphiques-rapport-terminé-08102026)) — plus aucun chevauchement dans les 10 états de référence, la carte homogène pour tous les autopilotes (tendances ▲▼, seuils en couleur), le graphe ouvert en grand, une page TÉLÉMÉTRIE avec export CSV. **Produit** (71 → 72) : un vol noté sur 20 à l'atterrissage et à l'amarrage, première brique d'une progression ; la progression elle-même manque toujours. **Code + tests** (76) : 6 e2e de plus (`hud-layout`, `hub-graph`, `hub-card`, `telemetry`, `report`, `saves`) et une galerie d'états fixes (`scripts/hud-gallery.ts`) ; les sauvegardes rechargent exactement le vol (flotte, site, désorbitation attendue, attitude).

*Réestimé après la fusion de `test-kimi` (07/10/2026).* **Physique** (78 → 80, la cible) :
- les rails suivent l'orbite que vole l'intégrateur du vol (10 m d'écart par tour, contre 49 km) ;
- les engins de la flotte tombent comme l'engin piloté, si bien que les rendez-vous avec eux sont exacts ;
- un monde solide pose sur son relief, et non sur sa sphère moyenne ;
- les vitesses de rotation de l'IAU sont corrigées, ainsi que tous les usages du WGS84 ;
- la coque d'un engin en orbite basse ne cuit plus dans la thermosphère ;
- le planificateur vole les poussées finies exactement comme le pilote (une correction de 43 m/s partait à 0,9° de travers).

**Code + tests** (73 → 76, cible dépassée) :
- le **labo de vol** : 84 scénarios volés dans l'application, observés, pilotables, tracés et notés ;
- l'exécuteur distant sur kerr-mini et un Chrome par Mac ;
- 508 tests unitaires ;
- la CI : seul `main` décide de la production, et la prévisualisation est déployée sous `/test/`.

Reste à régler : 1 ou 2 échecs aléatoires au démarrage par suite e2e complète.

**Technologie** (77 → 79) : la première image ne dépend plus que de 2 pipelines (les autres se compilent en arrière-plan), les éphémérides et le ciel se téléchargent pendant la compilation, le palier de qualité monte et descend selon la mesure et est retenu d'une session à l'autre, le démarrage WebGPU est borné et diagnostiqué, et les gros plans de Jupiter utilisent les cartes Cassini/Juno 8K.

**UI** (76 → 77) : le temps du hub et celui du pilote sont distincts, et une orbite quasi circulaire s'affiche par sa hauteur moyenne et son écart.

**Produit** (68 → 71) : les autopilotes sont fiables dans tous les domaines du labo (note de la campagne : **15/20**, voir [`CAMPAGNE-AUTOPILOTES-2026-10-07.md`](CAMPAGNE-AUTOPILOTES-2026-10-07.md)), et une nouvelle scène de jeu s'ajoute : l'amarrage à l'Endurance en rotation.

Il manque toujours la progression et les objectifs suivis.

*Réestimé après G4 (04/10/2026).* Technologie : le vrai sol de la Lune et de Mars (LOLA, MOLA : cratères, ombres, terminateur), l'imagerie de la NASA près de la Terre (611 m le jour, les lumières de VIIRS la nuit), la Terre d'orbite 4 à 6 fois moins chère (O13) ; la reprojection relativiste (R9) mesurée inutile, le PBR du Ranger sans matière (textures génériques). Reste au sol : l'imagerie plus fine que 611 m (vol bas). Code + tests : le vol rejoué déterministe (météo, tuiles), la mesure à rayons égaux corrigée (le gouverneur P2 annulé). *Avant : réestimé après G3 (04/10/2026).* Technologie : les étoiles nettes en mouvement (R8, +3,5 dB), la caméra tenue sans retour aux blocs, 270 Mo de VRAM rendus près d'une lune (BC7/BC5), pistes, océan, nuages et anneaux crédibles ; restent la reprojection relativiste, l'imagerie au sol, le PBR du Ranger (G4). Code + tests : les e2e de nouveau tous verts (déterminisme), la mesure de qualité fiable. *Avant : réestimé après la phase 2 (04/10/2026).* Physique : J2–J4 et dérive séculaire, propergol et masse, poussée selon la pression, atmosphères mesurées (Vénus, Mars, Titan) et thermosphère, corps rigide (tenseur, Euler), train d'atterrissage à ressorts et pneus, aérodynamique par surfaces, vent et turbulence de Dryden, Terre WGS84 (rendu et physique), Lambert d'Izzo, pas symplectique symétrisé, attitude gyroscopique (Fermi–Walker), vols de référence (ISS/SGP4, Apollo 4, Falcon 9). Restent : STS-1 (données), autorité des gouvernes abstraite, moment aéro une fois par image, attitude stockée en angles, pistes non dessinées, géoïde. Code + tests : 392 unitaires (dont les références), goldens ré-enregistrés à chaque changement voulu. *Avant : réestimé après U4 et U5 (03/10/2026).* UI : le langage HUD partout (kit, polices, réglages, galerie, dialogues), écran titre, menu pause, missions briefées, mode photo, tablette, roue radiale, indices de touches, manette dans les menus, Master caution, HUD par phase avec son view-model et son cadre libre, aides de rentrée et d'approche, glyphes distincts ; **toutes les touches remappables**, échelle d'interface, palette Okabe–Ito, réduction des animations, focus visible ; **interface entière en français** ; carte au doigt ; contraste AA vérifié sur le pire fond. Produit : une boucle d'entrée (titre → missions → vol → pause/sauvegarde) existe ; pas encore de progression ni d'objectifs suivis. Technologie : HUD 11,6 → 2,7 ms par frame. Code + tests : 334 unitaires, 58 e2e (fumée, accessibilité, français, tactile, S5 contraste/ratchet/fuites/tailles, titre, manette, préférences, vols de référence, fréquence).


Les notes « actuelles » sont réestimées à la fin de chaque phase, en reprenant les critères de l'audit.

**Décision (04/10/2026)** : des passages du Kerr Bench, seuls les `report.json` sont versionnés ; les captures (`shots/`) restent sur la machine (`.gitignore`).

## Phase 0 : filets de sécurité

| # | Étape | Statut | Commit |
|---|---|---|---|
| 0.1 | Build cohérent (`bun run build` produit ktx-worker et le WASM) ; CI : job `verify` (typecheck + tests + build, rapport junit, cache bun) dont dépend le déploiement, contrôles aussi sur les PR ; tests lents du planificateur à 180 s ; assertions de durée murale désactivées sur la CI ; test tautologique remplacé | fait | `cc6f00d` |
| 0.2 | Bugs de gameplay : **pile d'Échap** (`src/ui/keys.ts`, Caméra, Ciel, aide) : fermer un panneau ne coupe plus le maintien ni l'autopilote ; « ? » (⇧/) ouvre l'aide en QWERTY ; `isTyping` limité aux champs texte (curseurs et cases ne bloquent plus le vol) et focus rendu après un clic sur un curseur ; aides et astuces à jour. **Vérifié dans l'app** (vraies touches) | fait | `9a20bcf` |
| 0.3 | Physique : **accélération du repère « home »** complète (Saturne tiré par tous les corps, Titan compris, et chute du Soleil autour du barycentre) : l'écart éphéméride / modèle de forces passe de 5,5e-6 à ≈ 5e-7 m/s², et un test le verrouille ; **Δv gratuit** supprimé (poussée au prorata du temps réellement volé, dans les deux intégrateurs). Poussée vérifiée en jeu, à pas fixe (2 g, identique avant et après) | fait | `2afc799` |
| 0.4 | **`src/units.ts`** (C_MPS, M_METRES, M_SECONDS, DAY_S, AU_M, DEG, G0) : ~110 littéraux remplacés dans 30 fichiers, et les `492.55` divergents corrigés ; **`src/math/vec3.ts`** : 115 définitions locales identiques remplacées dans 40 fichiers (alias quand le nom était ambigu, sémantique identique) ; assertions de durée murale optionnelles (`PERF=1`) | fait | `a6edd32` |
| 0.5 | Robustesse : **`src/util/storage.ts`** (24 `try/catch` localStorage remplacés) ; **`src/debug.ts`** (`assert` en dev, `caught()` : les erreurs des sections par frame, statut du Ranger, écrans du cockpit, hub, comptées et signalées une fois dans la console et le journal, au lieu d'être avalées) ; **sauvegardes validées** (`checkSave` : temps, modes, sol, plan ; réglage invalide réparé et signalé, sauvegarde corrompue refusée) ; `tests/save.test.ts` | fait | `8123c7f` |
| 0.6 | TypeScript plus strict : **`noUncheckedIndexedAccess`, `noUnusedLocals`, `noImplicitReturns`** activés ; 63 erreurs corrigées (imports et constantes morts, tuples typés `as const`, retours implicites réécrits) | fait | `6288aa7` |
| 0.7 | Tests purs : **sauvegardes** (aller-retour JSON et `#save`, refus, réparation), **`flightair`** (vide, rentrée 70 km, rupture à 20 km avec et sans dégâts, virage de trajectoire), **`iss-plan`** (point de rendez-vous, plan depuis 50 km sous l'ISS, re-visée identique), **symbologie du HUD** via un enregistreur de contexte 2D réutilisable (`tests/helpers/recorder.ts` : cap, échelle de tangage, vue extérieure, aucun NaN, save/restore équilibrés) | fait | `cc0bf00` |
| 0.8 | **Biome** (lint et format, devDependency acceptée) : règles recommandées moins les idiomes délibérés de la maison ; reformatage complet en un commit (`f21f6f0`, ignoré par `git blame`) ; **`scripts/check-wgsl.ts`** : les 9 shaders compilés par le vrai compilateur WebGPU de Chrome headless (une erreur injectée est bien détectée, avec la ligne) ; CI : `biome ci` et `check-wgsl` ; `bun run check` en local | fait | `f2cc386`, `f21f6f0`, `7b90ec6` |

## G0 : Kerr Bench

| # | Étape | Statut | Commit |
|---|---|---|---|
| G0.1 | **Moteur** `src/bench/runner.ts` : 8 scènes de référence, phase A (Game, auto) et phase B (bloc 4, ~1,44 Mpx, Mrays/s), attente de la variante du traceur et des assets, contrôle thermique, balayage des qualités (Complet), détection d'onglet masqué, HUD non dessiné pendant la mesure | fait | `497ba4b` |
| G0.2 | **Rapport** `kerr-bench/1` (`src/bench/report.ts`) : système (GPU, limites, navigateur, écran), chargement, scènes, thermique, VRAM, erreurs, Kerr Score, qualité conseillée ; `src/bench/sysinfo.ts`, `src/bench/vram.ts` | fait | `497ba4b` |
| G0.3 | **Écran** `…/#bench` (`src/ui/bench.ts`, `bench.css`) : accueil, mesure, résultats, téléchargement, copie, partage, comparaison ; **FR/EN** (`src/i18n.ts`, premier usage) | fait | `497ba4b` |
| G0.4 | `scripts/bench.ts` pilote `__bh.bench` (une seule logique de mesure) ; `version.json` (serveur et build) | fait | `497ba4b` |
| G0.5 | **Référence du score** : Apple M1 Max, Chrome, test Standard = 1000 (débits fixes par scène dans `REFERENCE`) ; rapport de référence dans `docs/perf/field/` ; **`scripts/bench-merge.ts`** : tous les rapports reçus en un tableau Markdown et un CSV | fait | `a15a0eb` |
| G0.6 | **Balayage du sous-échantillonnage temps réel** : sur chaque scène, auto (avec la résolution dynamique, comme en jeu) puis 1×, 2×, 3×, 4×, 6×, 8× (pixel ratio du Jeu, pleine échelle) — fps, p50/p95/p99, histogramme des temps d'image, temps GPU par image (moyenne, p50, p95, max) et par passe, Mrays/s, rayons par image et par pixel, blocs choisis par l'auto, échelles de rendu ; l'image convergée (temps, spp). `scripts/bench.ts` écrit `docs/perf/bench-<label>/report.json` et `shots/<scène>/` (une capture en mouvement par réglage, aux pixels du rendu, et l'image fixe) ; le passage Complet de `…/#bench` balaye aussi, avec un tableau des fps par réglage. Premier passage : `bench-2026-10-03-bbe8264-sweep` (Kerr Score 875) | fait | `12a0ebe` |

**Mode d'emploi pour tes amis :** ouvrir `https://thesamlepirate.github.io/black-hole-gpu/#bench`, choisir la durée, Lancer, puis Télécharger le rapport et te l'envoyer. Les rapports reçus vont dans `docs/perf/field/`, puis `bun scripts/bench-merge.ts`.

Découvertes en route :
- **`realtimeBlockNow` renvoyait le bloc automatique même en réglage fixe** : les débits de `perf()`, de l'ancien script et du benchmark divisaient par le mauvais bloc. Corrigé (il renvoie le bloc réellement utilisé).
- **Le HUD de vol coûte ≈ 15 ms de CPU par image** en orbite (marqueurs et rubans 7 ms, mini-carte 6,7 ms, pire cas 38 ms), mesuré en Chrome headless : sur un budget de 16,7 ms, c'est le premier frein CPU du jeu. **À traiter en U4 et dans la vague G1.**
- Le volet de navigation intégré se ralentit à 1 image/s quand il n'est pas au premier plan : les mesures de performance se font en Chrome headless.

## U0 : quick wins UI

| # | Étape | Statut | Commit |
|---|---|---|---|
| U0.1 | **Échap partout** (réglages, F2, rendu, carte plein écran, galerie, en plus de Caméra, Ciel et aide) ; `H` masque toutes les surfaces ; **échelle de z-index** en variables (`--z-hud` … `--z-tip`), galerie au-dessus des popovers, alertes au-dessus des modales ; **file de toasts** (3 empilés, durée selon la longueur, journal) | fait | `2d30a78` |
| U0.2 | **HUD juste** : chevron d'énergie et tendance de vitesse en temps simulé (+10 s) et dans les bonnes unités ; boîte de vitesse dimensionnée (« 7.67 km/s ») ; barre mission en s et m/s ; distances de cible en km et UA ; plus d'« IMPACT » au sol ; verrou de cible masqué en finale (< 20 km d'une piste) ; flèche de bord rétrograde ; encadré de relativité ajusté à son texte ; un seul rythme de clignotement (2 Hz, `src/ui/clock.ts`) ; ombres floues remplacées. Vérifié en headless | fait | `5c33e26` |
| U0.3 | **Moins « site web »** : lien Atlas retiré du HUD, bandeau « Drag to orbit » masqué en vol, fps seulement en dev ; **Craft Lost « signal perdu »** (scanlines, code télémétrie, FR/EN, plus de Helvetica) ; panneaux de vol opaques à ~90 % et **crochets d'angle** ; **police minimale 11 px** dans le DOM (58 déclarations) | fait | `c7aa9d1` |
| U0.4 | Retrait du code mort de l'ancien planificateur (`.fl-plan`, ~350 lignes) | reporté au découpage de `flighthud.ts` (phase 1) | |

## U1 : kit et langage HUD (terminé)

| # | Étape | Statut | Commit |
|---|---|---|---|
| U1.1 | **Polices auto-hébergées** (`src/fonts/`, OFL : Inter, JetBrains Mono, Rajdhani ; sous-ensemble latin seul, que le build de production inline : 146 Ko) à la place du CDN Google ; première frame après leur chargement (1,5 s au plus). **Trouvé** : les étiquettes du ciel écrivaient `var(--hud-font)` dans `ctx.font` — invalide sur un canvas, ignoré, donc en police par défaut 10 px ; les overlays en polices système. Tout passe par `FONT`/`MONO` (hudkit), 11 px au moins | fait | `e0e628b`, `b65b0db` |
| U1.2 | **Kit** `src/ui/kit/` : `el`, `h`, `icon` (registre unique), `button`, `kbd`, `modal` (rôle `dialog`, `aria-modal`, titre lié, focus pris puis rendu, Échap par la pile unique) ; `kit.css` : les tokens du langage HUD (cadre, crochets d'angle, titres ambre en capitales Rajdhani, valeurs en mono, cyan pour l'actionnable). 9 copies locales de `h()` remplacées | fait | `e0e628b` |
| U1.3 | **Réglages refaits dans le langage HUD** : `.glass` (réglages, menu, aide, galerie, barre d'outils, rendu) devient le cadre du kit, quasi opaque (le HUD ne transparaît plus), coins 3–6 px, crochets ; onglets, segments, interrupteurs, curseurs (pouce vertical étroit, piste cyan), champs de valeur, en-têtes de groupe en capitales. L'aide « ? » est une modale du kit | fait | `e0e628b` |
| U1.4 | **Galerie de scènes, rendu offline, panneau Détails** dans le langage HUD (Caméra, Ciel et outils F2 l'étaient déjà). Corrigés : l'infobulle revenait après un clic (le bouton redessiné sous le pointeur) ; le panneau Caméra passait sous la légende de scène. **e2e d'accessibilité** `a11y.e2e.test.ts` (T2 et T8 de l'audit) : chaque contrôle visible nommé — en vol, réglages ouverts, à pied, panneau Caméra (5 curseurs et interrupteurs sans nom corrigés) ; l'aide est un dialogue modal nommé par son titre, le focus dedans ; une grille de 24 × 16 points n'atteint aucune couche invisible. **Harnais** : chaque Chrome headless efface son profil à la fermeture (97 profils, 12 Go, avaient rempli le disque) | fait | `563627e` |

Avant / après : `docs/img/aaa/u1-settings-before.png`, `u1-settings-after.png`, `u1-help.png`, `u1-scenes.png`, `u1-render.png`, `u1-camera.png`.

## U2 : la couche jeu (terminé)

Décisions du propriétaire (03/10) : **Échap = menu pause** (le temps s'arrête), couper l'autopilote, le maintien, la mission passe sur **⌫ Retour arrière** ; **écran titre à chaque lancement** (un lien `#scene=`, `#save=` ou `#bench` va droit à la scène).

| # | Étape | Statut | Commit |
|---|---|---|---|
| U2.1 | **Menu pause** (`src/ui/pause.ts`, FR/EN) : reprendre, sauvegarder sous un nom (ou écraser), charger / supprimer (confirmé), rendre les commandes, réglages, commandes, écran titre ; ↑ ↓ Entrée ; Échap revient d'une sous-page. **⌫** rend les commandes, **F5 / F9** sauvegarde et chargement rapides. e2e : le temps tenu, une sauvegarde faite et listée, F5/F9 | fait | `96b71e6` |
| U2.2 | **Écran titre** (`src/ui/title.ts`) : la dernière partie chargée derrière (Continuer ne fait que lever l'écran), le temps tenu, le HUD masqué ; Continuer, Missions (la galerie filtrée sur le jeu), Explorer, Mode photo (la vue seule), Réglages ; Kerr Bench, langue FR/EN, version. Rouvert depuis la pause, Continuer reprend la partie laissée. **Outils F2 réservés au développement** (build local ou `?dev`) : les sauvegardes du joueur sont dans la pause. e2e : ouverture, temps tenu, Échap n'ouvre pas la pause dessous, ↑ ↓ Entrée, retour depuis la pause | fait | `02c9a8e` |
| U2.3 | **Sélecteur de missions plein écran** (`src/ui/missions.ts`, données `src/game/missions.ts`) : six missions (Artemis II, amarrage ISS, décollage lunaire, Interstellar, approche de Gargantua, le trou de ver en automatique), chacune avec image, briefing, objectifs, touches utiles, difficulté et durée, en FR et EN ; ↑ ↓ choisir, Entrée lancer, Échap revient au titre ; la scène derrière reste figée pendant le choix. Les menus traitent Entrée eux-mêmes (un e2e instable dépendait de l'activation implicite). Test unitaire : chaque mission a sa scène et ses textes dans les deux langues | fait | `7f2e7c5` |
| U2.4 | **Écran de chargement en séquence de démarrage** : le titre comme l'écran titre, le journal des étapes en mono avec statuts `[ OK ]` / `[ .. ]` clignotant / `[FAIL]`, le bouton « Entrer maintenant » du kit (CSS seul : les étapes restent celles de `loading.ts`) | fait | `5e2b734` |

Captures : `docs/img/aaa/u2-title.png`, `u2-pause.png`, `u2-load.png`, `u2-missions.png`, `u2-boot.png`.

## U3 : tablette, roue, indices (terminé)

| # | Étape | Statut | Commit |
|---|---|---|---|
| U3.1 | **Indices de touches contextuels** (`src/ui/keyhints.ts`) : 3 à 5 touches selon la phase (à pied, cinématique, à la main, en maintien, sur autopilote, posé, dans l'air, amarrage, amarré), affichés au changement de phase et effacés après 9 s ; la vraie lettre du clavier pour les touches de position (API Keyboard Layout Map : W sur AZERTY). Réglage *Key hints* (préférence). La phase : qui pilote change désormais à l'instant (seule l'étape, lue sur l'orbite, est lissée). e2e : maintien puis main | fait | `b7a3fbb` |
| U3.2 | **Les menus à la manette** (`src/ui/padnav.ts`) : quand un menu tient le jeu (titre, pause, missions), la croix ou le stick gauche (répétition au maintien) parcourent les entrées, A choisit, B revient ; en jeu, Start ouvre la pause (au lieu des réglages). Les boutons deviennent les touches que les menus comprennent déjà. e2e avec une manette simulée (`navigator.getGamepads` remplacé) : titre, missions, lancement, pause | fait | `540632b` |
| U3.3 | **Roue radiale** (`src/ui/wheel.ts`) : Tab maintenu 0,22 s l'ouvre au centre, la direction du pointeur choisit, relâcher (ou cliquer) fait ; un appui bref reste « cible suivante ». En vol : SAS, prograde, rétrograde, vers la cible, une sous-roue des sept autopilotes, carte, vue, densité du HUD ; à pied : vue, regarder la cible, télescope, cible suivante, piloter, une sous-roue des cinématiques, ciel, photo. Les secteurs engagés sont allumés. e2e : ouverture, choix au pointeur, maintien rétrograde, tape = cible | fait | `a36fba2` |
| U3.4 | **Tablette** (`src/ui/tablet.ts`) : le panneau gauche de la carte (M) devient un appareil à pages — ORDINATEUR (ses ORBIT, TARGET, LAND, MISSION), VAISSEAU (l'état : orbite, cible, pilote — la vue des outils F2 extraite en `rangerView`), CAMÉRA et CIEL (leurs panneaux encastrés par `embed()`, rendus à leur popover quand la carte se ferme), JOURNAL (le journal du jeu, en direct). Les panneaux de l'ordinateur prennent le fond du kit. e2e : pages, encastrement et restitution | fait | `a4fda41` |
| U3.5 | **Mode photo** (`src/ui/photo.ts`) : depuis le titre, la pause ou la roue — l'interface masquée, le temps figé (l'image s'affine) ; une barre : exposition, focale (8 à 2 400 mm, logarithmique), éclat, profondeur de champ, temps, PNG, rendu hors ligne ; H masque la barre, Échap rend la scène comme elle était. e2e : HUD masqué, temps tenu, exposition réglée, restitution | fait | `d284659` |
| U3.6 | **Barre d'outils → dock compact** (choix du propriétaire, plutôt que la suppression de l'audit) : Scènes, Caméra (mode · cible), Ciel, Photo, Aide. Jet, surface liquide, guide d'ombre, son et plein écran passent dans une sous-roue « Scène » (et restent aux touches et dans les réglages) ; rendu et PNG dans le mode photo ; masquer l'interface (H) l'annonce, puisque plus rien à l'écran ne dit comment revenir. 40 e2e verts | fait | `ef38646` |

## U4 : le HUD par phase (terminé)

| # | Étape | Statut | Commit |
|---|---|---|---|
| U4.1 | **Coût CPU du HUD : 11,6 → 2,7 ms par frame** (mesuré en vol, Artemis, Chrome headless ; profileur CPU par CDP pour trouver où). (1) La mémoïsation des éphémérides ne gardait **qu'un instant** : vidée à chaque autre instant (temps retardé de la lumière, échantillons du futur) → plusieurs instants récents, invalidée quand une éphéméride arrive. (2) Les repères +10/+30/+60 s recalculaient, 10 fois par seconde, la position du corps à chaque point de la trajectoire → mis en cache par trajectoire ; la géométrie de la bouche calculée une fois, pas une fois par point. (3) La mini-carte était dessinée **à chaque frame** : sa caméra, qui suit le vaisseau, n'est jamais au repos → dessin continu seulement pour un mouvement donné par le pointeur, sinon 10 Hz. (4) Sur la carte, la position d'un astre le long d'une trajectoire est exacte toutes les 2 min et interpolée entre (~10 m pour la Terre ; l'ISS et les vaisseaux exacts). Vols de référence inchangés au bit près | fait | `dc0bfaa` |
| U4.2 | **Master caution** (`src/ui/hud/alerts.ts`, pur et testé) : les alertes classées WARNING (rouge — collision, rupture, bouclier ou coque à 95 %, charge à 92 %, décrochage, réservoir vide), CAUTION (ambre — les mêmes limites approchées, réservoir sous 10 %, sous l'orbite des photons ou l'ISCO), ADVISORY (blanc — plasma, ergosphère, posé, temps en pause) ; trois lignes au plus, la plus grave d'abord ; un voyant MASTER WARNING / CAUTION allumé et l'alarme sonore tant qu'il n'est pas acquitté (Entrée, ou clic) ; une alerte qui revient rallume. Entrée sur un bouton focalisé reste au bouton. Tests : 3 unitaires, 1 e2e (réservoir vidé, acquittement) | fait | `cb6a418` |
| U4.3 | **Matrice phase × élément** (`src/ui/hud/declutter.ts`, pur et testé) : chaque étape décide de ce qui a un sens — en orbite ni échelle d'inclinaison ni données air ; en finale ni repères orbitaux, ni futur, ni impact, ni allumage (la piste, le vecteur vitesse, l'air) ; au sol ni repères ni futur ; à l'amarrage ni horizon ni cap ; autour de Gargantua ni horizon ni cap. Les interrupteurs du joueur et la densité (²) restent par-dessus : un élément est dessiné si la phase, l'interrupteur et les données le permettent. Corrigé : la mini-carte n'écrit plus « IMPACT » sous un vaisseau posé | fait | `b9729bd` |
| U4.4 | **Aides de rentrée** : un panneau ENTRY pendant la rentrée guidée (hypersonique, avant la planée) — distance au site et écart de cap (Δψ), gîte commandée et gîte réelle, charge et son maximum, flux thermique et sa tendance sur 30 s (entre son minimum et son maximum), Mach et pression dynamique, pics prévus par le plan (flux, bouclier, g). `entryInfo()` gagne la distance au site et l'écart de cap | fait | `593b760` |
| U4.5 | **Chemin dans le ciel et PAPI** sur la finale : des portes tous les 1,5 km le long du profil d'atterrissage de l'autopilote (`landingProfile`), en magenta (la couleur du guidage), la plus proche la plus vive ; un PAPI de 4 feux sous la boîte de piste — blanc au-dessus du profil, rouge en dessous, deux et deux sur le chemin (l'écart de hauteur vu depuis le toucher : ±0,35°, ±1°). `RunwayView` gagne `papi` et `gates` | fait | `233ddf1` |
| U4.6 | **Glyphes distincts, couleur de la cible** : radial et normal avaient les glyphes de prograde/rétrograde (seule la couleur les distinguait — illisible pour un daltonien) → radial : cercle à rayons vers l'extérieur / vers l'intérieur ; normal : triangle pointe en haut / en bas avec trois traits ; sur la vue et sur la bille. La cible passe de l'orange (confondu avec l'ambre du nez) au magenta du guidage | fait | `b45c624` |
| U4.7 | **Navball graduée et chiffrée** : les degrés des lignes de tangage (30, 60) près de la verticale du centre, les points cardinaux (N en ambre) sur l'horizon, le mode des repères (ORB · SRF dans l'air et au sol · TGT relatif à la cible · KERR près du trou), le Δv restant dans le relevé du réservoir | fait | `86e534c` |
| U4.8 | **`safeFrame()`** (`src/ui/hud/safe.ts`) : le cadre libre de la vue mesuré sur la page (sous la barre de mission, au-dessus du hub et de sa bille, hors des rubans ; à pied au-dessus du dock), 4 fois par seconde et à chaque redimensionnement — à la place des marges codées en dur des flèches de bord (120/250 px), du verrou de cible (56/255) et du ruban de cap (mesuré à chaque frame) | fait | `ec15ea9` |
| U4.9 | **View-model du HUD** (`src/ui/hud/model.ts`, pur, testé) : le mode (ORB · SRF · TGT · KERR) et la vitesse affichée avec sa référence, partagés par les rubans, la bille et l'écran PFD du cockpit. **Mode surface automatique** : au sol, la vitesse par rapport au sol ; dans l'air, la vitesse air ; en orbite, par rapport au corps ; en mode cible, par rapport à la cible — posé sur le pas de tir, le HUD n'affiche plus 408 m/s (la rotation de la Terre, défaut n° 24 de l'audit). Le reste du dessin garde ses calculs : la migration complète des 1 350 lignes de symbologie vers le modèle se fera par morceaux | fait | `41c12bf` |

## U5 : commandes, accessibilité, langue (terminé)

| # | Étape | Statut | Commit |
|---|---|---|---|
| U5.1 | **Remappage des touches** (`src/input/bindings.ts`) : chaque liaison de la table et chaque touche tenue (tangage, lacet, roulis, translations, gaz ; les déplacements de la caméra libre) peut recevoir une autre touche, gardée comme préférence ; une touche déjà prise dans le même contexte (en vol, à pied) **s'échange** (rien ne reste sans touche). Lus partout : l'envoi des touches, le contrôleur (touches tenues), les indices de touches. **Écran Commandes** (`src/ui/controls-screen.ts`, depuis la pause) : par groupes, un clic puis une touche, Échap pour annuler, l'échange annoncé, tout réinitialiser, l'aide complète ; les lettres du clavier réel (AZERTY), les chiffres par leurs chiffres. Tests : 3 unitaires (échange, touches tenues, aucune touche en double), 1 e2e (SAS sur V, volé, réinitialisé) | fait | `d4ff7bd` |
| U5.2 | **Accessibilité** (Réglages › Game › Accessibility, préférences) : **échelle de l'interface** 0,8–1,5 (panneaux, menus, dock, indices, panneaux du HUD — pas ses symboles ni la barre de mission), **couleurs des repères Okabe–Ito** (lisibles quelle que soit la vision des couleurs ; les formes distinctes restent), **réduction des animations** (plus de clignotement — alertes, FLARE, décrochage —, ni glissement ni fondu ; le réglage du système est suivi aussi) ; le **focus clavier visible** partout. e2e : échelle, palette, animations coupées puis rétablies | fait | `0a90bad` |
| U5.3 | **L'interface en français** : un dictionnaire clé = l'anglais (`t("…")`, `tf("… {0}")`, `src/i18n/fr-*.ts`, ≈ 2 200 entrées) en plus des paires `tr({ fr, en })` : réglages (sections, groupes, libellés, aides, options, menus), galerie des scènes, aide clavier, HUD de vol et ses panneaux, ordinateur de vol et messages du planificateur, carte, messages et dialogues, noms des astres (Terre, Lune, Saturne…), états du vol (EN ORBITE…), horloge ; `<html lang>` suit la langue ; la recherche des réglages trouve les mots des deux langues. L'API du jeu (`__bh.game.status()`) reste en anglais ; les e2e tournent en anglais (le Chrome du système est français). Tests : tout texte a son français (extraction `scripts/i18n-strings.ts`), mêmes `{n}`, dictionnaires d'accord entre eux, aucun `t` local ne masque celui de l'i18n (`scripts/check-i18n-calls.ts`, l'erreur qui a cassé le statut de vol pendant le travail) ; 1 e2e en français. Captures : `docs/img/aaa/u5-fr-flight.png`, `u5-fr-fc.png`, `u5-fr-title.png` | fait | `f9262e9` |
| U5.4 | **La carte au doigt** (`src/ui/pinch.ts`) : deux doigts écartés ou rapprochés zooment autour de leur milieu, déplacés ensemble ils font défiler la vue (carte 3D ; le globe de la trace au sol zoome et tourne) ; un **appui long** sur un nœud le supprime (le clic droit du tactile) ; sous un doigt, les zones de contact font **44 px** (nœuds, poignées, astres, trajectoire) et, dans la vue carte, ses boutons et la piste du temps aussi. Corrigé en passant : le défilement et le zoom vers le pointeur revenaient aussitôt (la carte se recentrait sur son astre à chaque image) — à la souris aussi ; le décalage est gardé jusqu'au prochain centre ou recadrage. `(pointer: coarse)` lu en direct (audit B5) ; les commandes de vol tactiles s'effacent quand la carte est ouverte. e2e (vrais événements tactiles CDP) : pincement, défilement sans rotation, boutons de 44 px. Capture : `docs/img/aaa/u5-touch-map.png` | fait | `a9bca38` |
| U5.5 | **e2e S5** (`tests/e2e/s5.e2e.test.ts`, audit §16.7) : **T7 contraste** — chaque texte visible mesuré (WCAG AA : 4,5:1, 3:1 en grand) sur le pire fond, le disque brillant, dans 10 états (vol, carte + ordinateur de vol, pause, commandes, à pied, réglages, caméra, ciel, scènes, aide ; `tests/e2e/lib/contrast.ts`) ; **T9 ratchet** des contrôles sans `data-testid` par état (`tests/e2e/golden/testid-ratchet.json`, `RATCHET=update` pour l'abaisser) ; **T4 fuites** — 30 ouvertures des réglages et de la pause, nœuds ≤ +2 % et écouteurs stables ; **T6 tailles et densités** — 1280×720, 2560×1440, 1440×900@2, 390×844@3, 844×390@3 : pas de défilement latéral, canevas plein, barres dans l'écran. Corrigé en conséquence : le gris secondaire de tout le texte relevé à 0,72 (≈ #9AABBD, la palette de l'audit), les pastilles inactives, les horloges, la lecture des gaz sous la navball sur un fond sombre (illisible sur le disque), les lignes de réglages inactives dites `aria-disabled`, les glyphes décoratifs `aria-hidden` ; en fenêtre étroite (≤ 560 px, tactile ou non) la barre du temps tenait hors de l'écran et le bouton Réglages la recouvrait — compacte et bouton rond en haut à droite, comme sur téléphone. Un test smoke intermittent (la roue radiale ouverte par un Tab lent, le pointeur resté sur « rétrograde ») stabilisé. Capture : `docs/img/aaa/u5-phone.png` | fait | `bbe8264` |

## Phase 2 : physique de vol AAA (terminée)

Décisions (03/10/2026) : propergol **actif par défaut hors mode Cinéma** (réservoirs finis, la masse baisse, Isp selon la pression) ; train d'atterrissage **réaliste** (crash vers 3–4 m/s) avec un réglage indulgent et le « sans dégâts » existant ; **vent léger par défaut**, réglable de calme à fort ; **WGS84 dans cette phase**, physique **et** rendu.

| # | Étape | Statut | Commit |
|---|---|---|---|
| 2.1 | **J2/J3/J4** (`src/system/geopotential.ts`, audit P2) : harmoniques zonales de la Terre (EGM2008), de la Lune (GRAIL, sans C22), de Mars, Jupiter, Saturne, Uranus et Neptune, autour du pôle de date — dans la gravité du vol, de l'ISS, de l'amarrage et du prédicteur ; **rails** (accélération du temps) et vaisseaux de la flotte en dérive séculaire (nœud, périgée, anomalie moyenne). Le planificateur suit : l'attente avant une poussée est intégrée (moins de 3 jours : les termes de courte période de J2 font des km en orbite basse, un retour libre ne les tolère pas), au-delà képlérienne avec la dérive séculaire ; la fenêtre vers une autre planète tient compte de la rotation du plan de l'orbite d'attente jusqu'au départ. Tests : forme fermée de Vallado, gradient du potentiel, nœud de l'ISS −5,0°/j, orbite héliosynchrone à 98,2° (+0,9856°/j), rails contre intégration, Artemis II et Mars inchangés ; vols de référence ré-enregistrés (mêmes issues, quelques mètres d'écart) | fait | `0779551` |
| 2.2 | **Propulsion** (`src/engine.ts`, audit P5) : le propergol **compté par défaut** (sauf le moteur Cinéma, sans réservoir) ; la **force** du moteur fixe et la **masse** qui baisse (m/m₀ = e^(−w/vₑ)) : l'accélération croît en vidant les réservoirs, l'assemblage (centre de masse, inertie) suit ; **chaque engin a son réservoir** (un changement d'engin ne refait plus le plein — un nouveau vol si), sauvegardé ; dans l'air, la **pression ambiante** sur la tuyère retranche de la poussée et de l'Isp (F(p) = F_vide − p·Aₑ, `slThrust` par engin : Ranger 0,9, Lander 0,85, Endurance 0,4) et la consommation suit ; le moteur **monte en régime** avec un retard du premier ordre (0,4 / 0,3 / 1,5 s) ; les RCS tirent du même réservoir. Réservoirs par défaut gardés (vₑ = 0,1 c, rapport 20 : le voyage jusqu'à Gargantua) — dans le système solaire la masse n'y baisse que de quelques dix-millièmes par mission. Tests : masse restante, facteur de pression, retard, réservoir par engin ; vols de référence ré-enregistrés (mêmes issues ; une poussée courte livre quelques m/s de moins, le moteur montant en régime) | fait | `321c795` |
| 2.3 | **Atmosphères mesurées** (`src/aero.ts`, audit P3) : Vénus (VIRA jusqu'à 100 km, thermosphère de jour au-dessus), Mars (ajustement NASA Glenn jusqu'à 40 km, profil MCD au-dessus), Titan (Yelle, Huygens, Cassini) — densité et température par l'altitude, interpolées en log ρ, à la place d'exponentielles isothermes fausses de plusieurs ordres de grandeur (Vénus à 130 km : 1,5·10⁻⁷ kg/m³ au lieu de 2·10⁻²) ; la vitesse du son suit la température (Mach juste) ; le haut de l'air de chaque monde recalculé. **Thermosphère** (audit P7) : au-dessus de l'air du vol, la traînée continue sans plancher — l'orbite d'un engin (et celle de l'ISS, son propre coefficient balistique, 130 kg/m²) décroît, sur les rails et pour la flotte comme en intégration (≈ 100 m/jour à 400 km). Tests : densités de référence, décroissance monotone, vitesse du son, sommets de l'air, décroissance de l'ISS rails contre intégration | fait | `7dc8058` |
| 2.4 | **Corps rigide** : un **tenseur d'inertie** par engin (rayons de giration par axe : le Ranger tourne plus vite autour de son nez que bout pour bout, l'Endurance — un anneau — le contraire) et pour un assemblage (chaque pièce tournée sur les axes de l'engin piloté, Steiner) ; le **centre de masse suit le propergol** (entre le centre à vide et le réservoir) ; les roues et propulseurs donnent un **couple** par axe (calé pour qu'un engin seul, plein, tourne exactement comme avant) — plus léger il tourne plus vite, amarré plus lentement ; les **équations d'Euler** : le couplage gyroscopique ω × Iω (sous-pas au point milieu), le moment aérodynamique passé par l'inverse du tenseur. Le sens du terme est vérifié par la conservation du moment cinétique dans l'espace, la rotation appliquée comme la caméra le fait (les axes de l'engin y forment un trièdre indirect ; le test échoue avec l'autre signe). Restent : le moment aérodynamique échantillonné une fois par image, l'attitude de la caméra stockée en lacet/tangage/roulis | fait | `85c3cdc` |
| 2.5 | **Train d'atterrissage** (`src/gear.ts`) : des jambes **ressort-amortisseur** le long de la **normale du terrain** (son relief senti sur 5 m) — un oléopneumatique : raidi en fin de course, la détente freinée deux fois plus fort (pas de rebond), une butée —, des **pneus** à formule magique simplifiée (dérive, pic vers 9°), la résistance au roulement, les **freins** au pic de l'anti-patinage, une **roue avant orientable** (le palonnier : plein braquage au pas, quelques degrés vite ; le roulage automatique le long de la piste) ; le Lander sur quatre patins. Les forces dans l'intégrateur (pas de 4 ms près du sol), le couple autour du centre de masse tournant l'engin dans les sous-pas eux-mêmes. **Verdict au toucher** par la vitesse de descente (réglage : crash à 4,5 m/s, atterrissage dur entre 3 et 4,5 — « train endommagé » —, réglage **train indulgent** ×3) ; **basculement** au-delà de la base du train ; à l'arrêt, posé. Le vol suit : **déporteurs** sortis au toucher et gardés pendant un rebond, les **freins** une fois la roue avant posée (sinon le nez est plaqué), la loi « avion » et le SAS libres en tangage et roulis sur le train (le nez descend seul — la dérotation —) ; le pilote automatique de rentrée **arrondit** à 0,8 m/s + h/2,5 s dans les 15 derniers mètres. Les **pistes** des sites sont nivelées dans le relief physique (le détail procédural retiré de −0,5 à +4,5 km du seuil, raccordé) — le rendu ne dessine pas encore de piste (phase 3, aéroports). `glideTo` compte l'altitude au-dessus du relief ; un engin trouvé loin dans le sol y est reposé sans ressort. Rentrée vers Edwards de bout en bout : toucher à 0,8–1,4 m/s, roue avant posée en 0,6 s, roulage freiné jusqu'à l'arrêt (≈ 56 s). Côté Gargantua (le contact cinématique des planètes de Gargantua) : les nouveaux seuils seulement. Tests : posé à la bonne hauteur sur ses trois roues, butée, freinage, dérive, pneu, verdicts, basculement | fait | `3b8b5f6` |
| 2.6 | **Aérodynamique par surfaces** (`src/aero.ts`) : l'aile en **deux demi-ailes**, chacune à son incidence propre — la vitesse de roulis en relève une et abaisse l'autre (le roulis amorti par l'aile elle-même ; l'amortissement abstrait réduit d'autant), le **dièdre** (Ranger : 3°) fait rouler à l'opposé d'une glissade, une demi-aile décroche seule — ; une **dérive** (le nez ramené dans le vent, le lacet amorti) ; l'**effet de sol** (Wieselsberger : la traînée induite réduite à moins d'une envergure du sol, la portance un peu accrue — le palier d'arrondi) ; la **traînée des gouvernes** braquées ; le **régime raréfié** selon le nombre de Knudsen (de 0,01 à 10 : vers l'écoulement moléculaire libre, Cd ≈ 2,2 sur l'aire vue, peu de portance) et le **flux de chaleur** borné par ½ ρ V³ en air raréfié. Reste abstraite l'autorité des gouvernes côté pilote (le contrôle en couples) — des tables Cx(α, β, M, δ) et des gouvernes réalisées en forces demanderaient de reprendre les lois de pilotage et le guidage de rentrée. Tests : vol symétrique sans roulis, amortissement du roulis, dièdre, girouette, effet de sol, Knudsen et Cd moléculaire, flux borné ; atterrissage complet à Edwards : 0,7 m/s | fait | `018d373` |
| 2.7 | **Vent et turbulence** (`src/wind.ts`) : réglage **calme / léger (défaut) / modéré / fort** (4, 9, 15 m/s à 10 m) ; le **profil** du vent (loi en 1/7 dans la couche limite, un courant-jet ×3 vers 11 km, rien au-delà de 30 km), sa **direction** qui tourne avec le lieu et le jour ; la **turbulence de Dryden** (MIL-HDBK-1797 : intensités et échelles par l'altitude, filtres du premier ordre parcourus à la vitesse de l'engin) ; des **rafales** en 1 − cos (modéré et fort) ; un tirage **déterministe** par vol (le même vol, la même météo). L'aéro vole dans l'air (la vitesse relative au vent) ; le **HUD** affiche le vent (VENT 240°/9). Le pilote automatique de rentrée vole en **crabe** (le nez sur la vitesse air, la trajectoire sol tenue par l'inclinaison, la correction latérale tenue jusqu'à 15 m) et **décrabe** dans les 12 derniers mètres. **Roulage fiabilisé** (2.5 repris) : sur le train, toute la rotation de l'engin intégrée dans les sous-pas (une rotation d'image en bloc enfonçait les jambes raides) ; le nez posé à 3°/s au plus (pas de claquement) ; la roue avant moins accrocheuse (0,35) ; le lacet laissé à la roue avant, les ailes tenues à plat (doucement) ; voie du train portée à 8 m ; l'état du train remis à zéro à chaque vol. Banc d'atterrissage déterministe (un seul appel, le relief chargé d'abord ; le découpage en appels laissait la page faire varier le vol) : **calme 6/6, léger 6/6, modéré 5/6, fort 3/6** (29 nœuds de travers : au-delà des limites). Tests : profil, Dryden, déterminisme, statistiques ; e2e atterrissage à Edwards (calme et vent léger) | fait | `17cefb0` |
| 2.8 | **La Terre en ellipsoïde WGS84** (`src/system/ellipsoid.ts`) : a = 6 378,137 km, aplatissement 1/298,257 — les pôles 21 km plus près du centre que l'équateur (la sphère de 6 371 km était trop haute de 7 km sous l'équateur, trop basse de 14 km aux pôles ; la gravité, elle, avait déjà J2). **Rendu** : sur les axes de la Terre « aplatis » (z × a/b) l'ellipsoïde devient la sphère unité — le rayon y est porté (renormalisé, sa longueur rendue par m), et le relief, les nuages, l'air y sont marchés comme avant, dans le champ proche, le lointain, la sonde de lumière et la lumière principale ; les cartes (couleurs, relief, tuiles, lumières des villes, nuages, neige) lues à la **latitude géodésique**. **Physique** : le sol des trains d'atterrissage est le même au millimètre (hauteur dans l'espace aplati, relief lu à la même direction géodésique), la normale géodésique pour le haut, le sol et les vitesses ; l'**altitude** géodésique exacte (Bowring + Newton) pour l'air, la traînée, le HUD, la rentrée guidée (son environnement porte la figure), la carte au sol (traces en latitude géodésique) ; les sites placés en latitude géodésique ; « dans la Terre » testé contre l'ellipsoïde (à 6 370 km du centre au-dessus d'un pôle, on vole encore) ; la caméra libre et ses planchers suivent le sol réel. La zone nivelée des pistes couvre l'approche (3 km avant le seuil : le bruit procédural, lu désormais à la latitude géodésique, posait une colline de 60 m sous la finale d'Edwards). Pas de géoïde (EGM96 : un téléchargement — le niveau de la mer est l'ellipsoïde, à ±100 m près). Conventions : le périgée et l'apogée restent comptés depuis le rayon équatorial. La carte 3D dessine encore des sphères (0,3 % : invisible à son échelle). Tests : figure, aller-retour géodésique au millimètre jusqu'à la distance de la Lune, hauteur aplatie = géodésique au sol (5 cm à 10 km) ; vols de référence ré-enregistrés (mêmes issues, altitudes géodésiques) ; atterrissage à Edwards : 1,1 m/s. Captures : `docs/img/aaa/p2-wgs84-pole.png` (posé à 89° N, la mer à l'horizon), `p2-wgs84-polar-orbit.png` | fait | `393335e` |
| 2.9 | **Lambert d'Izzo** (`src/system/lambert.ts`, audit P7) : une seule variable sur une seule courbe T(x) pour toutes les géométries, itérations de Householder du troisième ordre, série de Battin près de la parabole ; **toutes les solutions** — l'arc direct et, pour un vol assez long, les paires gauche/droite à N révolutions — ; le **transfert à 180°** (singulier en variables universelles) et le grand arc résolus. Le planificateur, l'ordinateur de vol et le diagramme en côtelette prennent le moins coûteux des arcs (jusqu'à 3 tours : une cible un peu devant se rejoint en faisant des tours plutôt que par une ellipse raide). **Pas symétrisé dans le temps** (audit P6) : le pas de la composition de Yoshida, une fraction du temps de chute, pris à la moyenne de ses deux bouts (le second par la vitesse à laquelle le temps de chute change) — la symplecticité retrouvée : sur 200 tours d'une orbite de transfert (e = 0,73), la dérive de l'énergie passe de 2·10⁻⁵ à 7·10⁻¹⁰, sans aucune évaluation de plus ; dans le prédicteur et dans le vol en vide. Tests : chaque arc retombe sur r₂ (propagation de Kepler, 1e-10), Hohmann à 180°, le grand arc, les paires multi-révolutions, aucune quand le vol est trop court ; dérive d'énergie ; vols de référence inchangés | fait | `47a370e` |
| 2.10 | **Tests de référence** (`tests/reference.test.ts`, audit : « aucune trajectoire de référence ») — la physique du jeu (gravité J2–J4, Lune, Soleil ; air US76 ; Terre WGS84 qui tourne ; poussée dans l'air) face à ce qui a volé : l'**ISS 24 h** après ses éléments, à moins de 5 km de SGP4 (mesuré : 1,6 à 3,2 km, l'erreur propre de SGP4) et 200 m en hauteur ; le **retour d'Apollo 4** (NASA : entrée à 24 974 mph à 76 mi, plongée à 35 mi, rebond à 45 mi) — capsule en point matériel (5,4 t, C_D 1,29, L/D 0,36), portance en haut puis roulée à 75° : plongée à 53,9 km (56,3), rebond à 73,4 km (72,4), 8,5 g ; un **Falcon 9** (étages, poussées, Isp du guide utilisateur SpaceX) qui met ses **22,8 t publiées** en orbite basse (150 × 240 km, 1,2 t d'ergols de reste) et pas 26 t — Max-Q 41 kPa à T+62 s, pertes par gravité 0,86 km/s ; l'**énergie** d'une orbite dans le prédicteur (sur 30 jours, mesuré : le demi-grand axe moyen dérive de 15 m à 400 km, 1,3 m à 1 500 km ; 3 jours dans la suite). **STS-1 laissé de côté** (décision du 04/10/2026) : sans l'état exact à l'interface d'entrée et le profil de traînée de la navette (dans les rapports NASA, des PDF à télécharger), on ne ferait qu'ajuster un modèle | fait (STS-1 écarté) | `13d3807` |
| 2.11 | **Attitude gyroscopique près du trou** (`src/gyro.ts`, transport de Fermi–Walker) : les axes du vaisseau sont portés comme des gyroscopes le long de sa ligne d'univers dans la métrique de Kerr — en chute libre transportés parallèlement (symboles de Christoffel de Boyer–Lindquist, par différences centrées de la métrique ; schéma de Heun sur chaque pas accepté de Dormand–Prince ; triade remise orthonormée), sous poussée tournés par le boost pur de la 4-vitesse — au lieu d'être tenus fixes sur les axes de la carte plate. Un vaisseau qui ne tourne pas **précesse** donc par rapport aux étoiles lointaines : précession géodétique (de Sitter) et entraînement du référentiel (Lense–Thirring). Réglage « Attitude gyroscopique près du trou » (activé ; désactivé : l'attitude reste fixe sur les étoiles). Loin du trou, rien ne change (l'espace plat transporte à l'identique). Tests : sur une orbite circulaire de Schwarzschild à 10 M, un gyroscope radial a tourné de 2π(1 − √(1 − 3M/r)) = 58,8° en un tour (à 10⁻³ rad) ; en Kerr (a = 0,9), orbite inclinée excentrique, poussée alternée : axes unitaires et orthogonaux à la 4-vitesse à 10⁻⁹ ; vol de référence `gargantua-thrust` ré-enregistré (0,0065° de lacet) | fait | (ce commit) |

## G1 : gains purs du traceur (terminée, 04/10/2026)

Mesures : **Kerr Bench** (référence figée de HEAD servie à côté, `.claude/launch.json` « bench-ref ») et, pour le noyau, **`scripts/trace-ab.ts`** — nouveau : vues figées (horloge tenue), bloc 4, ~1,44 Mpx, temps GPU de la passe de tracé par horodatage, médiane sur 150 images, deux builds alternés (réf., nouveau, réf., nouveau) après compilation de leurs variantes. Le Kerr Bench à lui seul varie de **±20 %** sur Miller et Saturne d'un passage à l'autre (son horloge et ses sondes bougent), et sa phase B plafonne à 5,4 Mrays/s (60 images/s) sur les scènes rapides ; `trace-ab` tient **±1 %** sur les scènes lourdes. Référence : `docs/perf/bench-g1-ref/report.json` (Kerr Score 930), fin de vague : `docs/perf/bench-g1-end/report.json` (898, dans le bruit).

| # | Étape | Mesure | Statut | Commit |
|---|---|---|---|---|
| O1 | **LUT du champ lointain seulement au bloc ≤ 2** | tracé + LUT au bloc 4 : disque 53,8 → 43,2 ms, approche de Gargantua 12,5 → 10,5 ms ; mode auto : disque 26,6 → 47,2 fps, Kerr 41,7 → 55,3, trou de ver 46 → 59 | fait | `9d64846` |
| — | **`trace-ab`** (A/B du noyau sur vues figées) | A/A : ±1 % (Miller, Saturne, Lune) | fait | `1b92e0f` |
| R5 | **Netteté RCAS** après le temporel (réglage Rendu › Temps réel › Netteté, 0,3) | 0 ms de tracé ; effet discret, montre un peu la grille d'échantillonnage du bloc 4 en mouvement : réglage bas | fait | `6aaf03c` |
| P3 | **Palier promu à la mesure** (GPU au repos 12 s au plafond de pixels → palier suivant) | inactif dans les conditions du banc (image sous le plafond) | fait | `9074a7a` |
| O5 | k1 reporté (FSAL) dans les pas temps réel | Lune +14 %, autres neutres (aucune évaluation économisée dans les pas RK4 temps réel, deux dérivées vivantes de plus) | écarté | |
| O3 | Arrêt anticipé des rayons capturés (test exact du potentiel radial de Kerr) | +9 à +11 % (disque, Miller, Lune), même là où le test ne tourne pas | écarté | |
| O12 | LOD des octaves de la fumée | neutre (disque +2 %) | écarté | |
| O2 | Sondes : pas de 4 en mouvement, ε×2 et 250 pas | Miller : sondes −4,6 ms mais tracé +4,4 ms (le petit ajout dans le noyau) | écarté | |
| O9 | Nuages : second fbm (éclairage) sauté là où il est jeté | +2 à +6 % sur quatre scènes terrestres | écarté | |
| P1 | Pilotage du bloc et de l'échelle par les horodatages | sur Apple les passes de rendu (vaisseau, ombre, affichage) se chevauchent : leur somme (~40 ms) dépasse l'image (17 ms) — le mode auto prenait des blocs **plus grossiers** (artemis 4 → 8) | écarté | |
| O4, R1, R3, maillages | liaisons fusionnées, transitions sans à-coup, motif STBN, maillages quantifiés | pas un gain de temps (O4 : compatibilité Android ; R1/R3 : qualité ; maillages : téléchargement) — repris avec la vague où ils servent | reporté | |

**Leçon de la vague** : sur ce GPU Apple, le noyau de tracé est limité par ses registres — **tout code ajouté dans la boucle chaude coûte 3 à 15 %, même s'il ne s'exécute pas**, et en retirer ne gagne pas forcément. Les gains viennent d'ailleurs : des passes évitées (O1), des variantes spécialisées (O13, vague G4), des pixels mieux reconstruits (R2, R4, vague G2). Toute modification du noyau passe désormais par `trace-ab`.

## G2 : le rayon moins cher et la reconstruction (terminée, 04/10/2026)

Mesures : `scripts/trace-ab.ts` (passe de tracé, désormais aussi les passes de reconstruction resolve/gather/temporal ; mesure plafonnée en temps : ~1 min par scène et par passage), `scripts/quality.ts` (image temps réel après des rotations calées sur les images, contre la même vue convergée, PSNR), captures A/B (`--shots`). Fin de vague : Kerr Score 788 contre 833 pour la référence mesurée dans la foulée — la machine chauffée après des heures de mesures (930 le matin) ; `docs/perf/bench-g2-end/report.json`, `bench-g2-ref/report.json`.

| # | Étape | Mesure | Statut | Commit |
|---|---|---|---|---|
| O8 | **Relief de la Terre marché sur les hauteurs bon marché** (tuiles bilinéaires, détail deux octaves plus grossier) relevées d'une marge (~9 empreintes + 3 m) ; les hauteurs complètes seulement dans la marge ; 3 regula falsi au lieu de 10 bissections | tracé : Everest −19 %, Himalaya depuis l'orbite −19 %, artemis −15 %, Cévennes −11 %, Yosemite inchangé ; images à 50–53 dB de la référence | fait | `634d2d5` |
| R2 | **Accumulation par confiance** : poids accumulé par pixel (plafond 15) dans l'alpha de l'historique, α = w/(n + w) ; écrêtage vers la moyenne (Salvi) en espace tonemappé (Karis) ; poids réduit au quart hors de la plage | qualité en mouvement : Kerr +0,2 dB, trou de ver +0,3, orbite basse +0,3 (+11 sur un arrêt) ; coût ~0,4 ms (le voisinage pondéré par les échantillons frais, suggéré, coûtait 0,3 ms de plus sans gain mesurable : retiré) | fait | `b996faf`, `0985a29` |
| R4 | **Sol du corps proche reprojeté** par son mouvement rigide (déplacement du centre et rotation entre les images), profondeur la plus proche des échantillons frais | ±0,1 dB en rotation sur place (Amazonie, Lune, Everest), +1 dB Cévennes — son objet, le sol en translation, échappe à `quality.ts` ; recherche de profondeur limitée au mode « sol reprojeté » (elle coûtait ~1 ms partout) ; interrupteur `renderer.reprojectGround` | fait (gain non démontré) | `fefbbc8`, `0985a29` |
| O6 | Pas géodésique fondé sur les dérivées | version complète : Kerr −22 % mais Miller +33 % et une **couture** sur le disque lensé (rayons près de l'axe polaire) ; partie radiale seule : mitigée (disque +5 à +16 %, trou de ver −12 %) | écarté | |
| O7 | Volume du disque échantillonné 4 fois par pas géodésique, pas relâchés | disque +38 %, disque volumétrique et jet +162 % (un échantillon de notre volume coûte presque un pas RK4) | écarté | |
| O11, R6, R11, P4 | comptabilité des corps reportée d'un pas à l'autre ; reconstruction guidée ; contacts du vaisseau sur la profondeur dilatée ; moins de passes de post | O11 reporte des valeurs d'un pas à l'autre comme O5 (écarté en G1 : registres) ; R6 demande de réordonner les passes pour +0,5 dB ; R11 visuel seulement ; P4 : les passes du bloom mesurent 0,2–0,75 ms, sous le plancher de 0,9 ms supposé | reporté | |

Outils : `trace-ab` mesure aussi la reconstruction et s'arrête à 6 s par mesure (`55afbc4`, `2e58c63`) ; les tâches longues portent leur durée estimée dans leur titre.

## G3 : le « look AAA » (terminée, 04/10/2026)

| # | Étape | Mesure | Statut | Commit |
|---|---|---|---|---|
| Pistes | **Pistes dessinées** : revêtement, marquages OACI, feux de bord/seuil/fin, PAPI sur la pente du pilote auto ; la bande nivelée comme le train la ressent | le code coûtait 8–17 % partout dans le noyau : compilé seulement près d'une piste (variante `HAS_RWY`) | fait | `9d8242a` |
| Post | **Nuit de l'œil** (décalage de Purkinje piloté par l'adaptation), **poussière d'objectif** éclairée par l'éblouissement, **flou de mouvement** de la caméra (demi-image, vaisseau net) | flou : 0,09 ms | fait | `c4443ec`, `a1ddea1` |
| Mesure | `quality.ts` ouvrait sur l'écran titre (il couvrait le recadrage et mettait le jeu en pause), et figeait l'image sur la reconstruction brute, pas sur l'historique temporel | **les PSNR en mouvement de G2 (R2, R4) sont à relire** : ils mesuraient en partie le menu et le gather ; l'ordre de grandeur réel en rotation à blocs 4 est ~27 dB | corrigé | `4761d5f`, `833ad21` |
| Passation | **La caméra arrêtée passe son historique à l'affinage** : une image sans entrée (entre deux mouvements de souris) remplaçait l'historique par l'image d'un seul tirage épars — poids accumulé ~0 après un virage, les blocs revenaient ; l'historique est gardé là où l'affinage n'est pas passé, fondu dans les pixels affinés selon leurs échantillons sur 8 passes | poids après 40 images de virage : ~0 → 4,6 ; 1 à 3 images après l'arrêt : +1 à +4 dB | fait | `2a52310`, `798325d` |
| R7 | SVGF-lite (à-trous 2 passes là où n < 4) | 4–5 ms pour un gain nul (±0,4 dB, dans le bruit) | écarté | |
| R8 | **Étoiles du catalogue splattées là où elles tombent** en temps réel : chaque rayon de bloc cherche les étoiles de tout son bloc et dessine celles qui y tombent à leur place sous-pixel (jacobien de l'empreinte, radiance sur l'angle solide lentillé), dans un tampon ajouté par-dessus l'image reprojetée ; près des courbes critiques du trou, les rayons les attrapent comme avant. Les LUT corps noir et synchrotron partagent une liaison (le 10ᵉ tampon de stockage libéré) | Saturne en contre-jour 31,5 → 37,3 dB (le splat seul : +3,5), Kerr 26,8 → 27,5, Interstellar 25,2 → 26,7 ; noyau −1 à +3 % (bruit) | fait | `833ad21` |

| Anneaux | **Anneaux de Saturne** : fonction de phase à deux lobes (blocs de glace en arrière, poussière en avant, plus de poussière dans les anneaux minces), **surtension d'opposition**, **ringshine** sur la nuit de la planète (10 éléments d'anneau, azimuts tirés par rayon) ; l'ombre des anneaux n'atténue plus que la lumière directe | noyau −7 à +4 % (bruit) ; le ringshine physique vaut quelques millièmes du jour (`g3-ringshine-x100.jpg` le montre ×100) | fait | `3df907a` |
| Océan | **Mer de Cox-Munk** (pentes gaussiennes selon le vent : ceintures zonales et systèmes météo ; masquage de Smith), **écume de Monahan** ; **vagues proches** : 12 trains pour le vent du vol (vitesse et direction de `wind.ts`), nombres d'onde entiers sur une ancre kilométrique (exacts en float32), crêtes courbées et groupes par bruit ancré, **LEAN** (les vagues trop courtes passent leur variance au reflet) | préréglages −4,7 à +1,5 % ; au ras de l'eau ≈ +0,4 ms ; `g3-sea.jpg` | fait | `b926e76`, `b06be13` |
| Nuages | **Phase double** (0,8 / −0,2) et **octaves de diffusion multiple** (Wrenninge) dans le volume ; **cirrus** à 9 km (fibres le long des courants-jets, bruit cuit) ; **ombres longues des sommets** au terminateur vu d'orbite | +6 % en vol bas nuageux (0,6–1 ms), neutre d'orbite (bruit haché : 5 ms → bruit cuit) ; `g3-cirrus.jpg` | fait | `6796788` |
| Cartes HD | **Compression BC7 / BC5 sur le GPU au chargement** (`src/system/bc-encode.ts` : BC7 mode 6 par axe principal, BC5 pour les pentes du relief) | 358 → 89 Mo près d'une lune ; image à 45 dB du rgba8 | fait | `f69418e` |
| P2 | ~~**Gouverneur Pareto**~~ : à rayons égaux, bloc 2 à l'échelle 0,5 battrait bloc 4 à l'échelle 1 de 5 à 8 dB en mouvement. **Faux** : le balayage changeait le `pixelRatio` sans redimensionner — toutes les configurations rendaient à la même taille. Remesuré en G4 (vrai redimensionnement) : bloc 4 à pleine échelle ≥ bloc 2 à 0,5 partout (Kerr égal, Saturne −2,6 dB pour le second) | — | annulé en G4 | `c833214` |
| O10 | Atmosphère de Hillaire : la marche de l'air n'est pas le coût (32 → 8 échantillons : rien gagné) ; la table de diffusion multiple (Ψ_ms, calculée sur le GPU par monde) rend le crépuscule plus bleu mais coûte 8 à 11 % en orbite (4 lectures par échantillon dans un noyau limité par ses registres) | écartée (patch gardé) | écarté | |
| Rayons crépusculaires | En espace écran (Mitchell) : sans masque d'occlusion, voile, halo ou carré autour du soleil ; à refaire avec de vraies ombres volumétriques (froxels) | écartés | reporté | |
| Cockpit éclairé | Les écrans comme sources étendues et leurs reflets sur la verrière : effet mesuré négligeable (0,09/255) — les quatre lampes de cabine dominent | décision à prendre : atténuer les lampes la nuit | en attente | |
| display-p3 | Le rendu est en primaires sRGB (les couleurs de corps noir hors gamut écrêtées) : une sortie P3 n'apporterait rien sans élargir les sources | priorité basse | reporté | |
| Déterminisme | Le test e2e « un vol rejoué deux fois » échouait depuis la phase 1 : le pilote gardait les vitesses angulaires du vol précédent (corrigé : `FlightComputer.newFlight`) ; le reste vient du sol en flux (cartes et tuiles) : tolérance de 10 m | 59 e2e verts | fait | `d936a2b` |

![R8 : avant, TAA sans splat, splat, convergée](img/aaa/g3-r8-stars.jpg)

**Leçons de la vague** : la mesure de qualité en mouvement était faussée deux fois (écran titre, puis image de reconstruction brute) — corrigée, les gains de reconstruction se mesurent enfin ; sur Apple, trace-ab doit additionner tracé et sondes (leurs horodatages se chevauchent) ; les étoiles splattées sont le plus gros gain de qualité de la vague (+3,5 dB). *Corrigé en G4 : le « gouverneur Pareto » (+6 à +8 dB) était un artefact de mesure — un `pixelRatio` changé ne redimensionne pas le rendu.*

*Réestimé après le plan des assistants (05/10/2026).* Produit : **tout ce que fait le calculateur de vol se pilote aussi à la main, assisté** (F4) — directeur de vol, comptes à rebours, graphes avec couloir optimum pour la poussée, la montée, la rentrée, la finale, la descente verticale, l'approche et l'amarrage, alertes expliquées ; **placer le vaisseau** n'importe où depuis le HUD, **régler la date** ; une **caméra libre** pendant que le vaisseau vole. Restent : la progression et les objectifs suivis.

## Assistants, placement, temps, caméra libre (terminé, 05/10/2026)

Plan : [`PLAN-ASSISTANT.md`](PLAN-ASSISTANT.md) (décisions du propriétaire, contenu détaillé de chaque phase) ; aides : [`HUD.md`](HUD.md) › *The assistants*.

| # | Étape | Commit |
|---|---|---|
| A1 | Placer le vaisseau depuis le HUD : en orbite, au sol (globe cliquable, sites), auprès de chaque corps, devant chaque bouche du trou de ver ; confirmation pendant une mission | `8c5a638` |
| A2 | La date : maintenant, début de la scène, date choisie, pas ; le vaisseau porté avec le monde, un plan sur l'ancienne horloge annulé | `abb636d` |
| B1–B2 | La caméra libre (spectateur) : un second contrôleur sur ses propres réglages, le vaisseau continue de voler (autopilotes, plan) ; suivre ou libre, « aller à » chaque corps | `6a7ac9e`, `1bf48a4` |
| C0 | AUTO / ASSISTÉ pour tous les autopilotes, le directeur de vol, les alertes expliquées | `a4c9ac9` |
| C1 | Les poussées à la main : Δv suivi le long de la poussée, compte à rebours, coupure, graphe et couloir (module `ui/hud/graph.ts`, aussi sur l'écran PLAN du cockpit) | `4eabf0f` |
| C2 | Le décollage : trajectoire optimale intégrée, couloir, pente et cap visés, max-Q, virage gravitationnel et coupure comptés | `4f85332` |
| C3 | La désorbitation à la main ; le couloir de rentrée (portance, chaleur, charge), la chute prédite, l'inclinaison et ses inversions | `efec543` |
| C4 | La finale à la main : profil figé, PAPI, portes, arrondi compté ; graphe de finale | `71414dc` |
| C5 | La descente verticale : courbe de freinage et couloir, à la main ou assistée | `1ecbc83` |
| C6 | L'approche : courbe de freinage, freinage compté ; bouton « orbite de la cible » | `3bd80d0` |
| C7 | L'amarrage : phases expliquées, profil le long de l'axe, contact compté ; bouton sur l'anneau ; testids de l'anneau (cliquet 51 → 33) | `1f35808` |
| C8 | Finitions : chaque graphe dit ce qu'il montre et, hors couloir, quoi faire ; indices F4/F3 ; `HUD.md` ; e2e des passages AUTO ⇄ ASSISTÉ (5 autopilotes) | (ce commit) |

## G4 : la Terre et la Lune réelles, la reconstruction (terminée, 04/10/2026)

| # | Étape | Mesure | Statut | Commit |
|---|---|---|---|---|
| O13 | **Les rayons qui passent loin de la gorge vont droit**, déviés par sa lentille faible (α ≈ (M/b)(1 + b/√(b² + b_g²)), la masse d'Ellis vue de loin) ; variante du noyau sans Kerr (`override HAS_KERR`) quand le trou est hors champ | Terre d'orbite (Blue Marble) 29,0 → 4,6 ms de tracé, Amazonie 6,9 → 2,7 ms ; Saturne et Kerr inchangés | fait | `a968d88` |
| P2 | **Retour à l'ancien gouverneur** (l'échelle ne baisse qu'une fois les blocs à 4) après le balayage à rayons égaux, vrai redimensionnement (`__bh.forceScale`) — PSNR en rotation, bloc 4 éch. 1 / bloc 3 éch. 0,75 / bloc 2 éch. 0,5 : Kerr 27,7 / 27,6 / 27,6 ; Saturne 37,3 / 36,8 / 34,7 ; Amazonie 34,3 / 27,9 / 27,9. L'échelle pleine quand la caméra est tenue est gardée | — | fait | `331ad10` |
| R10 (1) | Toile à la taille de l'affichage, rendu à l'échelle dynamique, **agrandissement Catmull-Rom** dans la passe d'affichage (au lieu du bilinéaire du navigateur) | neutre (Kerr 27,44 contre 27,53 dB) : la base du TAAU à la résolution d'affichage (étape 2) | fait | `331ad10` |
| Déterminisme (2) | **La météo d'un vol tirée à son premier pas** (sa graine était l'horloge du vaisseau du vol précédent : la même descente rejouée rencontrait d'autres rafales, 300 m d'écart) ; **une tuile de relief en échec redemandée par minuterie** (l'image convergée ne demandait plus rien : la fenêtre restait incomplète) | test « vol rejoué » 148 s instable → 36 s, 3/3 | fait | `bc137cb` |
| R9 | Reprojection relativiste ξ : mesurée avant d'être codée — l'historique actuel (rotation + parallaxe à la profondeur) gagne déjà autant en translation qu'en rotation. PSNR temps réel, sans → avec historique : Kerr à 36 M, rotation 25,0 → 27,9, orbite 25,1 → 27,6, inclinaison 21,3 → 26,4, approche 24,6 → 27,3 ; à r = 8, rotation 19,5 → 24,5, orbite (temps qui court) 19,4 → 24,3, approche 19,3 → 24,3 | marge ≤ 0,3 dB (audit : +3 à +6) | écarté | |
| R10 (2) | TAAU à la résolution d'affichage : l'agrandissement filtré est neutre (étape 1) et l'échelle ne descend plus sous 1 qu'en dernier recours ; l'historique à 2× sur Retina coûterait ×2,6 en post pour les vues tenues, que l'affinage converge déjà | — | reporté | |
| LOLA / MOLA | **Le vrai sol de la Lune et de Mars** : hauteurs LRO LOLA (LDEM_64) et MGS MOLA (MEGDR 64 px/°), domaine public, réduites à 4096 × 2048 (`scripts/build-dem.py`, 9,8 + 8,5 Mo) ; dessinées (B-spline cubique près, mip de l'empreinte loin), éclairées (leurs normales) et foulées (le même échantillonneur sur le CPU, sous les cratères procéduraux) ; marches bornées par des mips du maximum (enjambée au-dessus du plus haut sol à portée) ; remplacent la carte de normales lunaire du pack (décalée d'un texel, relief faible) et la carte de hauteurs de Mars (MOLA en 8 bits) | terminateur d'orbite 2,4 → 4,0 ms, Earthrise +12 %, plaine non ralentie ; `g4-lola-terminator.jpg` | fait | `7d2bdaf` |
| Ranger PBR | Les textures du modèle (CC BY) examinées : un bake Substance générique (gris foncé uniforme, métal partout, bruit tissé, traînées de dilatation) — elles feraient du Ranger un vaisseau sombre, pas celui du film ; le rendu procédural actuel (peinture sous vernis, panneaux, rivets, joints, crasse) est gardé. L'usure des arêtes demanderait un maillage plus fin ou un bake en UV | — | écarté | |
| Imagerie | **NASA GIBS en direct avec les tuiles de relief** (niveaux z 6–8) : la Blue Marble Next Generation le jour, les lumières de VIIRS (2016) la nuit — 611 m, 4 à 8 fois plus fin que les cartes globales ; le tableau des tuiles en rg32uint (hauteur + rgba8), mêlé par empreinte et vers les bords comme les hauteurs, sur les cartes globales sans couture (courbe sRGB exacte) ; les lumières calibrées sur l'échelle de la carte de nuit | Himalaya et Japon : coût inchangé ; orbite basse sur l'Amazonie +1,7 ms ; `g4-gibs.jpg` | fait | `cb515fb` |

![LOLA : le terminateur d'orbite avant (carte de normales du pack) et après (hauteurs mesurées, ombres portées)](img/aaa/g4-lola-terminator.jpg)

![GIBS : l'Himalaya d'orbite et le Japon de nuit, avant (cartes globales) et après (imagerie en tuiles)](img/aaa/g4-gibs.jpg)

**Leçons de la vague** : mesurer avant de coder évite des semaines (R9 : l'historique gagnait déjà autant en translation qu'en rotation) ; une mesure à rayons égaux doit vraiment changer la taille du rendu (le gouverneur P2 reposait sur un artefact) ; le vrai relief coûte surtout par les rayons rasants et la sonde de lumière — les mips du maximum les bornent ; sur Apple, la sonde de lumière se lit dans le temps du tracé ; une comparaison dans la même page qui coupe le relief laisse le vaisseau sur l'autre sol (comparer des builds).

## M1 : PWA et cache (fait, 05/10/2026)

| # | Étape | Statut | Commit |
|---|---|---|---|
| M1.1 | **Service Worker** `src/sw.ts` (les règles pures dans `src/pwa/rules.ts`, testées) : à l'install, la coquille (le `precache.json` du build : la page, son script et styles, les workers, le WASM) ; les actifs hachés **cache-first à jamais** ; la page, `version.json`, docs/ réseau-puis-cache ; **les tuiles de la Terre** (S3, GIBS) cache-first sous un **budget de 300 Mo** — l'index (URL, dernier usage, taille) en IndexedDB puisque la Cache API ne garde pas de dates, éviction LRU jusqu'à 90 % du budget ; les éléments de la station réseau-puis-cache | fait | `6140d81` |
| M1.2 | **La page** `src/pwa.ts` : manifest et icônes déclarés, worker enregistré (pas sur le serveur de dev à rechargement à chaud, pas dans l'e2e sauf `sw=1`, pas sur `#bench` — un chargement à froid est ce qu'il mesure), toast quand un build attend, rechargement dessus, **coquille réchauffée en temps libre** (ce que la page a chargé avant que le worker ne la contrôle), `__bh.pwa` (ready, stats, clearTiles, update) ; `server.ts` et `scripts/build-pages.ts` servent `sw.js` (nommé par le build), le manifest, les icônes, `precache.json` ; `bun run build` complet | fait | `6140d81` |
| M1.3 | **e2e** `tests/e2e/pwa.e2e.test.ts` (à vraies entrées, réseau du monde coupé comme partout sauf demandé) : le worker contrôle la page, la coquille (63 fichiers) et les tuiles mises en cache (224, ~9,8 Mo au cap Canaveral), le manifest servi ; **le réseau coupé : la page se recharge de son cache et la scène joue** (unitaires : les règles et l'éviction) | fait | `6140d81` |

## Branche `test-kimi` : chargement, paliers, démarrage (Kimi, 05/10/2026)

Plan : [`ANALYSE-CHARGEMENT-GPU.md`](ANALYSE-CHARGEMENT-GPU.md) §4, mise en œuvre au §8. Ce travail réalise en partie **M2** du [plan Monde](PLAN-MONDE.md) : le palier mesuré plutôt que deviné, le démarrage robuste. Il reste à faire : la recréation à chaud du device et le découpage du code, mesuré non rentable ici (les modules candidats sont tous câblés au démarrage).

| # | Étape | Commit |
|---|---|---|
| L1 | La **première image sur 2 pipelines** (traceur temps réel et environnement) ; la LUT et le noyau de qualité compilés en arrière-plan | `33625d0` |
| L2 | Shaders validés en parallèle, modules relus au lieu d'être réanalysés | `d997ec1` |
| L3 | Éphémérides et ciel téléchargés pendant la compilation | `2d7b4bc` |
| L4 | Le bouton « Entrer » n'attend plus la première image | `33b5d9f` |
| L5 | Variantes spécialisées du traceur compilées par phase, sous LRU | `fd0c732` |
| L6 | **Palier mesuré dans les deux sens**, retenu par identité d'adaptateur ; le coût de l'intégration suit le palier | `8b6d381`, `8119f4e` |
| L7 | Pipelines d'affichage et de post-traitement compilés en asynchrone | `3e96fbf` |
| L8 | e2e `reload` : le rechargement profite du cache disque des shaders (froid 4,4 s, chaud mesuré) | `f31ea4d` |
| L9 | Démarrage WebGPU borné, politique de qualité GPU, préchargement de la Terre ; **diagnostics** des pannes graphiques | `c963fe7`, `dd5b059` |
| L10 | Vitesses de rotation de l'IAU corrigées ; Jupiter en gros plan (Cassini/Juno 8K, mips HD) | `c78718c`, `9538f33` |
| L11 | Utilisateurs du WGS84 corrigés (éclipses dans l'air, rendu et vol) | `699a27c`, `8b6562c` |
| L12 | Temps du hub et temps du pilote indépendants ; continuité de la carte du trou de ver | `a452eb7`, `ea2590f` |

## Audit de `test-kimi` et corrections (06/10/2026)

Rapport : [`AUDIT-TEST-KIMI-2026-10-06.md`](AUDIT-TEST-KIMI-2026-10-06.md). Sur 23 commits, deux régressions graves :
- **H1** : toute erreur JavaScript après le démarrage tuait l'application ;
- **H2** : l'air des mondes de Gargantua était effondré ou NaN.

Tout est corrigé, avec les 10 points moyens (M1–M10) et les mineurs, chacun avec son commit (§8 du rapport) : `6541c36`, `2037b74`, `e0d5f7a`, `9c40427`, `9e048d8`, `cd727f5`, `ebc9165`, `368b8d4`, `dd43842`, `b3d7b23`… e2e 106/0.

CI : la branche est prévisualisée sous `/test/`. **Seul `main` décide de la production** : une prévisualisation en échec est signalée et laissée de côté. Chaque déploiement garde son propre Service Worker.

## Labo de vol et campagne des autopilotes (06–07/10/2026)

Outil : [`FLIGHTLAB.md`](FLIGHTLAB.md), soit `scripts/flightlab.ts` et `tests/flight/`. Les scénarios volent dans l'application réelle, à pas fixe ou en temps réel. Chacun est observé (télémétrie, captures aux moments clés), pilotable pendant le vol (serveur de contrôle) et noté sur la qualité du vol : taux de chute, axe, couloir, g, oscillations, Δv face à l'optimum. Ils se répartissent entre ce Mac et kerr-mini. Il y en a **84**, avec un rapport HTML par campagne.

Rapport : [`CAMPAGNE-AUTOPILOTES-2026-10-07.md`](CAMPAGNE-AUTOPILOTES-2026-10-07.md). **Note : 15/20.**

| Domaine | Note | Début de campagne → fin |
|---|---|---|
| Amarrage et rendez-vous | 18/20 | ISS en échec → 12/12 amarrages à 0,08–0,09 m/s, cible en rotation comprise ; rendez-vous ISS, Endurance et Lander |
| Rentrée et planés | 17/20 | 0/4 et 2/7 → 4/4 et 7/7, toucher à 0,3–0,7 m/s |
| Lander et descentes | 16/20 | 0/4 → 4/4 sites, 5/5 atterrissages lunaires |
| Missions vers une lune ou une planète | 15/20 | Lune à 23 km ou impact → 100,2–100,7 km ; Mars 293 → 300,4–302,5 km ; **Jupiter échoue** |
| Montées et décollages | 14/20 | 0/2 → 2/2, Δv +47 % → +27–30 % de l'optimum |
| Gargantua et trou de ver | 12/20 | mission automatique réussie ; retour par le trou de ver, Edmunds et Miller non traités |
| Fiabilité des tests | 15/20 | unitaires 508/0 ; e2e : 1 ou 2 échecs aléatoires par suite complète |

Principaux changements de fond :
- **rentrée :** couloir corrigé de la rotation de la Terre, phugoïde amortie ;
- **approche :** spirale gérée sur l'énergie ;
- **descente :** plus de battement entre modes ;
- **montée :** guidage explicite hors de l'air ;
- **rails :** ils volent l'orbite moyenne de l'intégrateur (`9c217b2`) ;
- **rendez-vous :** planifiés sur la physique du vol (`f5a986b`, `89ccf20`) ;
- **amarrage :** une cible qui tourne (`af9b583`) ;
- **missions :** la poussée volée comme elle a été visée, le plan B lissé, un solveur de Levenberg-Marquardt, la boucle fermée (`eedef67`) ;
- **aéro :** la thermosphère ne cuit plus les coques (`6808fc1`).

Nouvelle scène : *Docking to the tumbling Endurance* (à 300 km, 3 tr/min ; amarrage, arrêt de la rotation, puis montée à 400 km).

**Couverture de l'audit (§3.2) :**
- n° 1 (de l'orbite à l'atterrissage) : couvert, par les rentrées et les planés du labo et par l'e2e d'atterrissage ;
- n° 7 (amarrage ISS, missions) : couvert ;
- n° 2 (les scènes chargées sans erreur) : en partie, par `worlds` et `ui-scenes-loading` ;
- n° 4 (perte du device) : couvert le 08/10 par l'e2e `gpu-recovery` (M2).

## Plan HUB : hub, télémétrie, graphiques, rapport (terminé, 08/10/2026)

Plan : [`PLAN-HUB.md`](PLAN-HUB.md), HB1 à HB5, commits `7be5b69` à `6d81d41`, planches dans `docs/progress/hub/`. Méthode : dix états de vol sauvegardés par le labo (`tests/hud/states/`), rechargés et photographiés avant et après chaque étape par `scripts/hud-gallery.ts`.

**Décisions du propriétaire (07/10/2026)** : la télémétrie dans une page de la tablette **et** un rapport de vol noté ; le graphe du hub petit dans la carte, **ouvert en grand d'un clic**.

| Étape | Ce qui a changé |
|---|---|
| HB1 Mise en page | Registre `hud/layout.ts` : les panneaux mesurés, les instruments du canevas placés hors d'eux (`fit`). Données air en bloc compact à gauche de la bille ; plus d'encadré ENTRY en double. e2e `hud-layout` : aucun chevauchement dans les 10 états. |
| HB2 La carte du hub | Une carte ENTRY complète (cap, écoulement, gîte consigne/réelle, charge, flux, pics à venir). Lignes homogènes : tendance ▲▼ calculée par la HUD pour toutes, seuils ambre et rouge (⚠) par autopilote. Hauteur bornée. Vitesse sol une fois posé ; apoapside de la montée au-dessus du sol réel (−4,7 km auparavant). |
| HB3 Les graphiques | Point actuel visible (halo, repères), petit graphe de 96 px cliquable, grand panneau (axes nommés, légende, lecture au survol, Échap). |
| HB4 Télémétrie et rapport | Enregistreur du vol (10 canaux, tout le vol gardé) ; page TÉLÉMÉTRIE (3 courbes, fenêtre 1 min → tout, CSV) ; rapport de vol noté sur 20 (A–F) à l'atterrissage et à l'amarrage, chaque mesure jugée, une ligne au journal. |
| HB5 Finitions | i18n, `HUD.md`, planche finale ; trois défauts du rapport trouvés par la planche et corrigés (une descente verticale jugée sur l'axe d'une piste, le site du vol précédent gardé, la carte restée affichée). |

**Sauvegardes** (corrigées en route) : la flotte, le site de rentrée et la désorbitation attendue sont sauvegardés ; un vol rechargé ne se replace plus selon la vue précédente (un amarrage repartait à 169° de l'axe du port).

**Reste ouvert** : l'atterrissage autopiloté au Bourget a été noté F une fois sur six exécutions de l'e2e `report` (non diagnostiqué ; le test affiche désormais le contenu de la carte en cas d'échec).

## M2 : la perte du GPU rattrapée (terminé, 08/10/2026)

Avant : une perte du device (pilote réinitialisé, mémoire GPU épuisée, onglet en arrière-plan sur mobile) sauvait le vol puis arrêtait le jeu : « rechargez la page ». Maintenant :
- le vol est sauvé, puis un **nouveau `Renderer`** est créé sur un nouveau device et glissé sous la **même poignée** (`util/swappable.ts`, un proxy qui relaie lectures, écritures et appels, les méthodes liées une fois par instance) : la page, la simulation, les calques et l'automatisation gardent la leur ;
- le nouveau reprend ce que la page avait donné à l'ancien (`Renderer.adopt` : rappels, palier mesuré, horloge de l'eau, tableau de bord du cockpit) ; la page lui renvoie le ciel, la carte des étoiles, la taille de l'image ; la carte 3D et le globe refont leur couche GPU sur le nouveau device ; l'ancien est réduit au silence ;
- **357 ms** ici pour revenir (les shaders sont dans le cache disque) ; deux pertes par minute sont rattrapées, une troisième rend la main avec le message d'avant ;
- e2e **`gpu-recovery`** : perte simulée (`__bh.gpu.lose()`, le device détruit, annoncé comme une réinitialisation), deux récupérations, le même vol (altitude, temps), puis l'abandon à la troisième. `rates`, `smoke`, `gpu-startup` inchangés (le proxy ne coûte rien de mesurable).

L'audit § 3.2 n° 4 (perte du device) est **couvert**.

## M9 : 8 storage buffers, la même qualité (08/10/2026)

Le noyau du traceur liait **10** storage buffers par étage et exigeait donc une limite au-dessus du défaut de WebGPU (8) : une partie d'Android et Safari étaient refusés au démarrage. Les trois tables en lecture seule du noyau — les corps (avec les harmoniques de la sonde), les LUT du corps noir et du synchrotron, le chemin de la caméra — sont maintenant **un seul buffer à offsets fixes** (`gpu-tables.ts` ; les corps restent à l'offset 0, leurs 86 lectures inchangées). Le device est demandé à la limite par défaut.

**Même qualité, mesurée** :
- **image** : `trace-ab` sur 6 scènes, les vues de chaque build comparées pixel à pixel — les écarts sont sous le bruit de capture (PSNR 53–71 dB entre les builds, contre 37–57 dB entre deux captures de la même référence) ;
- **vitesse** : −2,0 % (Kerr) et −2,7 % (Ranger) sur 4 passages alternés, les autres scènes à ±1–2 %, dans le bruit ;
- **compatibilité** : e2e `gpu-startup` — un adaptateur à 8 storage buffers démarre, dessine, sans erreur GPU (avant : « le lancer de rayons en demande 10 ») ; suite e2e complète 130/132 (les deux échecs traités : ce test à réécrire, l'atterrissage aléatoire ci-dessous).

Trouvé en route : le relais du renderer de M2 ne respectait pas l'objet par lequel on passait (un objet créé sur la poignée appelait les méthodes du renderer réel) — corrigé, testé. Le test du rapport de la Lander exigeait une note qu'un état moteur coupé à 0,6 m du contact ne peut pas garantir — corrigé.

**Reste ouvert (autopilotes)** : l'atterrissage autopiloté au Bourget, juste après un chargement, rate une fois sur trois environ — posé à 94 m de l'axe, 437 m après le seuil, 3,3 g (contre 0,9 m, 1,2 km et 1,7 g d'habitude). Antérieur à M9 (vu au plan HUB) ; l'e2e `report` affiche la carte en cas d'échec.

## M3a : la première image n'attend plus que ce qu'elle montre (08/10/2026)

Mesuré d'abord, scène par scène, ce qui se télécharge et ce que la première image attend (navigateur headless, liaison bridée à 20 Mbit/s, cache coupé). Les cibles du plan (planètes en KTX2, reliefs) se sont révélées déjà optimisées. Le poids était ailleurs :
- le **préchargement de la Terre** (22,7 Mo : son cube moyen et son relief) partait à la création du device, dans **toutes** les scènes — à Gargantua aussi — et concurrençait le reste malgré sa basse priorité : il part maintenant **3 s après la première image** ;
- **JUP365** (le centre de Jupiter et ses lunes, 4,1 Mo, 2040–2100) était attendu avant toute scène : il ne l'est plus que pour une scène à Jupiter ou une sauvegarde, sinon il arrive 2 s après la première image. Dans la scène principale (tous les corps, datée 2067), ses lunes passent du modèle analytique à JUP365 à ce moment — 4 000 à 17 000 km, invisibles depuis la Terre (< 0,01″) ; le cache des positions est vidé à l'arrivée d'un fichier.

Résultat (scène à Gargantua, 20 Mbit/s) : **première image 11,1 → 5,5–6,1 s**, 9,5 Mo téléchargés avant elle au lieu de 17,2 + 22,7. e2e **`first-image-downloads`** (échoue sur l'ancien code). `smoke`, `worlds`, `reload` inchangés.

**M3b** : les maillages bruts (Endurance et ses 4 niveaux, Ranger, Lander) compressés sans perte, gzip au build, décompressés par le navigateur (`DecompressionStream`, sans dépendance) : **23,0 → 12,2 Mo**, même rendu (planche `docs/progress/monde/m3b-maillages.jpg`) ; test unitaire `inflate`, e2e `dock-undock` et `smoke`. L'ISS et le cockpit l'étaient déjà.

## M4 : la météo (terminée, 08/10/2026)

Plan : [`PLAN-METEO.md`](PLAN-METEO.md), étapes W1 à W8.

- **W1 à W2b (faits)** : le modèle (`weather.ts` : préréglages, tirage en systèmes météo, vent du vol et de la mer), le panneau Météo avec la catégorie de vol et la coupe verticale, la couche Météo du planisphère ; refaits au niveau AAA (planche `w2c-refonte.jpg`).
- **W3 (fait)** : la météo dans l'image du traceur, sous 30 km au-dessus de la Terre.
  - **Brume et brouillard** : la brume selon la visibilité (Koschmieder) ; le brouillard couché, sa profondeur prise exactement sur chaque pas de la marche de l'air (120 m de brouillard sous des pas de centaines de mètres : sinon sauté vers le haut), son sommet qui ondule vu d'au-dessus.
  - **Couches nuageuses** : les couches de l'état (base, sommet, couverture, épaisseur optique) marchées en volume à la place de la couche fixe dans un rayon de 250 km (fondues dans la carte réelle à 450 km) : cumulus épars, ponts nuageux, cumulonimbus ; elles dérivent avec le vent.
  - **Lumière** : leurs ombres au sol ; sous les ponts, la lumière diffuse grise ; l'exposition automatique s'ouvre sous eux.
  - **Coût** : le code météo est compilé seulement quand elle agit (bit `HAS_WX` du noyau). Sans cette spécialisation, sa seule présence coûtait +19 à +21 % même par beau temps. Mesures (`trace-ab`) :
    - beau temps : identique (Yosemite à 56 dB, écarts de temps dans le bruit) ;
    - brouillard : +5 % ;
    - couvert, deux couches : +26 %.
  - **Banc** : `trace-ab` attend désormais que la scène soit chargée (cartes, tuiles) : avant, un A/A sur une scène au sol donnait 8,6 contre 55 ms.
  - **Tests** : unitaires `weather` ; e2e `weather-panel`, qui vérifie que la météo arrive au traceur et que le beau temps l'en retire.
  - Planche `docs/progress/meteo/w3-brouillard-couches.jpg`.

- **W4 (fait)** : les pistes face au vent. Chaque piste se pose dans les deux sens (le seuil lointain exact, le cap retour) ; le sens en service est celui face au vent du lieu (par beau temps, le publié : les vols d'avant les mêmes) — l'autopilote de rentrée, `glideTo`, le HUD (piste, vent au sol, de face et de travers) et le rapport le suivent ; au rendu les feux et le PAPI du sens en service, le marquage aux deux bouts, et **la manche à air** (tendue ou pendante, tournée par le vent). Deux défauts d'autopilote trouvés en route et corrigés : l'arrondi flottait sur une piste en pente (mesuré désormais depuis le sol) ; un toucher doux qui rebondit dans la même image perdait la piste du roulage (arrêt à 14–33 m de l'axe 2 fois sur 3 par vent de face, avant W4 déjà ; 6/6 à 1,5 m depuis). Planche `docs/progress/meteo/w4-pistes-vent.jpg`.

- **W5 (fait)** : la pluie à l'image — traînées sur cinq profondeurs, parallèles à l'arrêt, jaillissant du point de fuite en vol ; dans la cabine, les gouttes sur la verrière (des lentilles qui glissent, chassées vers le haut par l'air en vol) ; sans coût mesurable. Planche `docs/progress/meteo/w5-pluie.jpg`.

- **W6 (fait)** : la tempête de poussière de Mars — l'air dix fois plus chargé (τ ≈ 4), sa lumière diffuse (le ciel ocre et opaque, l'horizon effacé), l'œil qui s'ouvre, les grains au vent ; pas de pluie sur Mars. +0,6 ms en tempête, rien par beau temps. Planche `docs/progress/meteo/w6-poussiere-mars.jpg`.

- **W7 (fait)** : la météo réelle — le METAR de la station la plus proche (metar.vatsim.net, sans clé, CORS ouvert), décodé (vent, rafales, visibilité, couches, pluie, orage, brouillard), en vigueur pour le vol et l'image ; le panneau montre le rapport ; sans réseau, beau temps. Planche `docs/progress/meteo/w7-metar.jpg`.

- **W8 (fait)** : l'autopilote dans la météo, au labo — vent de travers, vent arrière (l'autre bout), brouillard, orage : 4/4 posés en douceur ; la portance et l'aérofrein sur la vitesse air (face au vent, il flottait puis décrochait), la marge de rafales en finale ; le rapport note selon la météo. Planche finale `docs/progress/meteo/w8-final.jpg`.

## M5 : les aéroports vivants (terminée, 08/10/2026)

Plan : [`PLAN-AEROPORTS.md`](PLAN-AEROPORTS.md), étapes A1 à A6.

- **A1 à A3** : le balisage OACI (bords, seuil, axe, zone de toucher, rampe d'approche et ses éclats, flashs, PAPI), allumé la nuit et par mauvaise visibilité, chaque feu étalé sur l'empreinte du pixel ; les numéros de piste, le taxiway et ses feux ; la tour et son phare, les hangars, l'aérogare, les avions garés. Traceur près d'une piste : ~+1 ms.
- **A4** : le guidage façon navette — azimut et élévation (MLS) contre le profil du Ranger, au HUD et sur l'écran NAV.
- **A5** : les procédures d'approche — la page Cartes de la tablette (plan, profil, points, minima), les points au HUD, la remise de gaz de l'autopilote (instable à la DH, ou plein gaz : TOGA) et sa nouvelle approche.
- **A6** : au labo, la nuit, la remise de gaz automatique et commandée, le CAT III de nuit : 4/4, les 18 vols de piste posés. Corrigés : la météo des scénarios écrasée par le vrai METAR, la marche de vitesse à la ressource. Planche finale `docs/progress/aeroports/a6-final.jpg`.

## M6 : l'audio spatial (terminée, 08/10/2026)

Plan : [`PLAN-AUDIO.md`](PLAN-AUDIO.md), étapes S1 à S8 ; référence [`AUDIO.md`](AUDIO.md). Tout reste synthétisé, rien à télécharger.

- **S1** : l'espace sonore (`audio/space.ts`, pur) — le moteur placé à ses tuyères, HRTF au réglage « Casque », le Doppler selon la vitesse du vol, l'absorption de l'air ; **le cockpit et la cabine entendus de l'intérieur** (le défaut de l'audit § 12).
- **S2** : le moteur granulaire dans un AudioWorklet (la turbulence en grains, le crépitement des ondes de Mach dans l'air) : 1,1 % d'un cœur.
- **S3** : chaque grappe RCS à sa place, avec ses vannes ; `jets.ts` partagé avec le rendu des panaches.
- **S4** : la cabine — les modes de la coque, la ventilation, les bips au tableau, les craquements sous la charge et la chaleur, la respiration au-delà de 4 g.
- **S5** : la piste — le crissement de chaque pneu, le roulement, les joints, les freins, le vent au sol.
- **S6** : la station — son bourdonnement, l'amarrage (six loquets), la séparation.
- **S7** : le bang là où le cône de Mach balaie un auditeur immobile, jamais à bord (les secousses transsoniques) ; le plasma de la rentrée.
- **S8** : le mix mesuré dans neuf situations et rééquilibré (plein gaz au cockpit −5 → −14 dB RMS, crêtes −0,5 → −2,3 dB). Planche finale `docs/progress/audio/s8-final.jpg`.

## M7 : les entrées HOTAS (terminée, 08/10/2026)

Plan : [`PLAN-HOTAS.md`](PLAN-HOTAS.md), étapes H1 à H6 ; référence [`HOTAS.md`](HOTAS.md).

- **H1** : le modèle des entrées (`input/axes.ts`, pur) — le modèle d'un périphérique d'après l'identifiant du navigateur, la mise en forme d'un axe (calibration, zone morte, courbe, inversion), le levier absolu et son cran, les affectations lues sur tous les périphériques, la détection ; un HOTAS n'est plus lu comme une manette, ses axes au hasard.
- **H2** : dans le vol — le tangage, le roulis, le lacet (torsion et palonnier sommés), les translations RCS, le regard ; la manette des gaz absolue **reprise comme un fader** ; les boutons sur les actions du clavier ; les freins aux pieds.
- **H3** : douze HOTAS reconnus (Thrustmaster, Saitek/Logitech, VKB, palonniers), un profil générique pour un appareil de vol inconnu.
- **H4** : l'écran « Manettes et HOTAS » — les périphériques en direct, l'affectation par détection, les courbes tracées, la calibration ; rien n'est piloté pendant qu'on règle.
- **H5** : les vibrations — la poussée, le plasma, le roulage, chaque roue, les joints, les bangs, l'amarrage ; un réglage d'intensité.
- **H6** : un vol entier au HOTAS simulé, posé à Edwards (e2e `hotas-flight`). Corrigé : l'approche lit la hauteur au-dessus du seuil, plus la hauteur sol (une bosse de 40 m déclenchait les minima). Planche finale `docs/progress/hotas/h6-final.jpg`.

## M8 : le cockpit interactif (terminée, 09/10/2026)

Plan : [`PLAN-COCKPIT.md`](PLAN-COCKPIT.md), étapes K1 à K7 ; référence [`COCKPIT.md`](COCKPIT.md).

- **K1** : 20 commandes générées sur trois panneaux mesurés de la cabine (leviers, interrupteurs, boutons allumés, un bouton rotatif), leurs inscriptions, leurs poses.
- **K2** : le pointeur — un rayon CPU contre la cabine ; survol et bulle, clic, glissement, molette ; le regard toujours au bouton droit.
- **K3** : les écrans à pages — dix pages pour chacun des huit affichages, leurs onglets sous le pointeur.
- **K4** : le train réel — le Ranger à 1,8 m sur ses roues, le train dessiné ; commandé (G, le levier), son alarme, l'atterrissage sur le ventre, le décollage sur piste.
- **K5** : les phases du vol au tableau (TKOFF, CIRC, APPR), les leviers qui voyagent jusqu'à leur état, le chronomètre sur CLOCKS.
- **K6** : les lumières — la cabine baissée la nuit, rouge en NIGHT, éclairée par ses écrans ; les feux du Ranger sur la coque, leur coût mesuré (deux pièges de 1,3 et 5 ms évités).
- **K7** : un vol mené au tableau par de vrais clics, posé à Edwards, noté A ; en chemin, **le rapport d'atterrissage corrigé** (lu dans le pas du toucher, il notait F un posé parfait une fois sur trois). Planche finale `docs/progress/cockpit/k7-vol-au-tableau.jpg`.

## M10 : la musique, les voix et TARS (terminée, 09/10/2026)

Plan : [`PLAN-TARS.md`](PLAN-TARS.md), étapes T1 à T7 ; référence [`TARS.md`](TARS.md).

- **T1** : les voix — une file par priorité, les voix du système (Web Speech), les sous-titres, la radio autour du contrôle (Quindar, squelch, souffle).
- **T2** : les annonces de l'atterrissage — hauteurs radio, minimums, taux de chute sur l'enveloppe mesurée du plané du Ranger, remontez, les alertes dites.
- **T3** : le contrôle de mission et la tour, lus sur l'état du vol — le délai de la lumière, aucun Houston du côté de Gargantua, le blackout du plasma.
- **T4** : la musique aux seuls grands moments (décision) — orgue additif, nappes, salle ; le tic-tac de Miller (le motif du film, décision).
- **T5a** : la voix robot de TARS — règles de lecture et synthèse par formants, mesurée par Whisper (13 % de mots manqués) ; en français la voix du système (décision, le français maison mesuré à 76–87 %).
- **T5b** : TARS hors ligne — F6, ses réponses tirées du vol en anglais ou en français, son honnêteté et son humour, ses remarques rares.
- **T6** : TARS par OpenRouter — la clé du joueur (OAuth PKCE ou collée), ses réponses par GLM-5.3-flash, ses remarques décidées par Jev, rationnées ; CORS vérifié sur le vrai service (sans clé).
- **T7** : un vol écouté de bout en bout ; corrigé par lui : le décrochage crié sous l'autopilote de rentrée. Planche finale `docs/progress/tars/t7-vol-ecoute.jpg`.

## Ce qui reste pour l'AAA (au 09/10/2026)

Par ordre de gain :

1. **Produit, 72 → 80** : la **progression et les objectifs suivis** (phase 4 de l'audit : carrière, école de pilotage, préréglages de difficulté, musique et voix ; plan Monde M10). C'est le seul pilier encore loin de sa cible. Le rapport de vol noté (HB4) en donne la mesure : garder la meilleure note par mission suffit à amorcer une progression.
2. **Autopilotes, 15 → 18/20** :
   - la mission vers Jupiter ;
   - la montée à +10 % de l'optimum au plus ;
   - des repères de pôle unifiés (pôle de date) ;
   - le retour par le trou de ver et Gargantua (points 9 et 10 du plan des autopilotes) ;
   - le flottement au Bourget ;
   - ~~l'atterrissage au Bourget juste après un chargement : 1 sur 3 à 94 m de l'axe~~ (09/10 : c'était le rapport, lu dans le pas du toucher — corrigé en K7).
3. **Robustesse** : ~~la recréation à chaud du device et son e2e~~ (M2, fait le 08/10). Reste à stabiliser le harnais e2e (échecs aléatoires au démarrage sur le mini).
4. **Technologie, 79 → 80, puis le plan Monde M3–M9** (état mesuré au 08/10 dans [`PLAN-MONDE.md`](PLAN-MONDE.md)) :
   - le poids du téléchargement, mesuré dans le build : la **Terre « high »** en KTX2 (6 faces 4096², ≈ 67 Mo, chargée à l'approche de la Terre), **Jupiter** (32,5 Mo, paliers ≥ 2), les **planètes en JPEG** décodées en rgba8 (89 images, Lune 9,3 Mo, Mars 5,9 Mo) et les reliefs (Terre 10,6, Lune 9,8, Mars 8,5 Mo) ; les maillages sont déjà découpés en LOD (l'ISS 2 + 9,9 Mo, l'Endurance 1–11 Mo) — restent leur quantification et les planètes en KTX2 ;
   - ~~météo~~ (M4 terminée le 08/10 : W1–W8 — modèle, panneau, carte, brouillard et couches au rendu, pistes face au vent et manche à air, pluie, poussière de Mars, METAR réel, autopilotes éprouvés au labo) ;
   - ~~aéroports vivants~~ (M5 terminée le 08/10 : balisage OACI, décor, guidage MLS, cartes d'approche, remise de gaz) ;
   - ~~audio spatial~~ (M6 terminée le 08/10 : HRTF, Doppler, moteur granulaire, cabine, piste, station, bang) ;
   - ~~HOTAS~~ (M7 terminée le 08/10 : tous les périphériques, douze profils, l'écran de réglage, levier absolu, vibrations) ;
   - ~~cockpit interactif~~ (M8 terminée le 09/10 : 20 commandes au pointeur, écrans à pages, train réel commandé, lumières de la cabine et de la coque) ;
   - ~~≤ 8 storage buffers pour Android et Safari~~ (M9, fait le 08/10) ; restent FSR1 et la matrice de compatibilité.
5. **UI, 79 → 80** : la migration complète de la symbologie vers le modèle du HUD (U4.9), et la carte 3D en ellipsoïde. Le hub, la télémétrie et les graphiques sont faits (plan HUB).

## Journal

- **09/10/2026 — M10 terminée (T7) : la phase 3 (plan Monde) est close.** Les voix, les annonces, le contrôle de mission et la tour, la musique aux grands moments, TARS (sa voix robot, hors ligne et par OpenRouter).

  Leçons :
  - **une voix se mesure** : Whisper comme oreille, validé d'abord sur les voix du système ; sans mesure, le français maison aurait été livré inaudible ;
  - **la physique du jeu prime sur le film** quand elle diffère (dτ/dt = 0,85 sur Miller) : le choix d'un hommage se décide, il ne se cache pas ;
  - **écouter un vol entier** trouve ce que les tests de morceaux ne voient pas (le décrochage crié sous autopilote).

- **09/10/2026 — M8 terminée (K7)** : le cockpit interactif — 20 commandes au pointeur sur trois panneaux, les écrans à pages, le train réel commandé et son alarme, les phases du vol au tableau, les lumières de la cabine et les feux de la coque ; un vol mené au tableau par de vrais clics, noté A. Corrigé en chemin : le rapport d'atterrissage (le flake « F une fois sur trois » de `report.e2e`).

  Leçons :
  - **mesurer le coût GPU de chaque ajout**, même minuscule : 7 halos de feux coûtaient 5 ms parce que chaque fragment lisait la profondeur tracée (lue une fois par sommet : 0) ;
  - **un rapport calculé au milieu d'un pas** lit un état à moitié mis à jour : le noter au pas suivant ;
  - **un vol scripté doit vérifier ses propres conditions** : `airInfo().agl` n'existait pas, la condition « sous 3 km » ne se déclenchait jamais et le diagnostic est parti sur une fausse piste.

- **08/10/2026 — M7 terminée (H6)** : les entrées HOTAS — tous les périphériques ensemble, douze profils connus, l'écran « Manettes et HOTAS », la manette des gaz absolue, les vibrations ; un vol entier au HOTAS simulé ; l'approche sur la hauteur au-dessus du seuil.
- **08/10/2026 — M6 terminée (S8)** : l'audio spatial — tout placé, la cabine, la piste, la station, le bang au cône de Mach ; le mix mesuré et rééquilibré.
- **08/10/2026 — M5 terminée (A6)** : les aéroports au labo (nuit, remise de gaz, CAT III : 4/4) ; la météo des scénarios n'est plus écrasée par le METAR réel ; la vitesse en rampe à la ressource.
- **08/10/2026 — M4 terminée (W8)** : l'autopilote posé dans la météo au labo (4/4) ; portance sur la vitesse air, marge de rafales ; notes selon la météo.
- **08/10/2026 — M4 W7** : la météo réelle par le METAR des stations des pistes (sans clé).
- **08/10/2026 — M4 W6** : la tempête de poussière de Mars (τ ≈ 4, lumière diffuse, grains au vent).
- **08/10/2026 — M4 W5** : la pluie — traînées selon le mouvement, gouttes sur la verrière.
- **08/10/2026 — M4 W4** : les pistes face au vent (les deux sens, la manche à air, le vent au HUD) ; l'arrondi mesuré depuis le sol, le roulage gardé après un rebond.
- **08/10/2026 — M4 W3** : brouillard, brume et couches nuageuses de la météo dans l'image, compilés seulement quand elle agit (beau temps inchangé ; couvert +26 %).
- **08/10/2026 — M3b** : maillages compressés sans perte, 23,0 → 12,2 Mo.
- **08/10/2026 — M3a** : la première image n'attend plus la Terre ni les lunes de Jupiter hors de leurs scènes (à 20 Mbit/s, 11,1 → 5,5–6,1 s à Gargantua).

- **08/10/2026 — M9 : 8 storage buffers** (le défaut de WebGPU : Android et Safari admis), même image et même vitesse mesurées (`trace-ab`, A/A pour le bruit) ; le relais de M2 corrigé.

- **08/10/2026 — M2 : la perte du GPU rattrapée** sans rechargement (le renderer refait sous la même poignée, 357 ms ; e2e `gpu-recovery`).

- **08/10/2026 — plan HUB terminé** (HB1–HB5, `7be5b69`…`6d81d41`, poussé) : mise en page sans chevauchement, carte du hub homogène, graphe agrandi, télémétrie et CSV, rapport de vol noté ; sauvegardes fidèles. UI 77 → 79, Produit 71 → 72.

  Leçons :
  - **des états fixes rechargés** (la galerie) valent mieux que des vols rejoués pour juger une interface : avant/après en 2 minutes ;
  - **la planche finale est un test** : elle a montré trois défauts du rapport qu'aucun e2e ne voyait ;
  - **un chargement doit tout remettre** (le point de vue, le site, la carte du rapport) : ce qui n'est pas dans la sauvegarde vient du vol d'avant.

- **07/10/2026 — fusion de `test-kimi` dans `main`** (avance rapide, `229b2f3`, CI vert, site et `/test/` déployés).
  - **Campagne des autopilotes :** note 15/20, détails ci-dessus.
  - **Nouvelle scène :** l'Endurance en rotation.
  - **Missions :** Lune et Mars à l'altitude demandée.
  - **CI :** la planification ISS passe de 1,6 à 0,7 s, les tests du verrou Chrome et des tuiles sont rendus stables sur le serveur de GitHub, et chaque carte de scène a son `data-testid` (cliquet 101 → 22).

  Leçons :
  - **le planificateur et le vol doivent partager le même modèle** de poussée et de propagation : chaque écart s'est payé en dizaines de kilomètres à l'arrivée ;
  - **un scénario doit fixer sa date** : à l'heure de la page, chaque vol est une autre mission ;
  - **un calcul visé par un solveur doit être lisse** : un échantillon qui saute rend la jacobienne inutilisable ;
  - **une scène qui gèle se diagnostique par un profil CPU** pris pendant le gel.
- **06/10/2026** : audit de `test-kimi` et corrections (H1, H2, M1–M10) ; le labo de vol (47 puis 84 scénarios) ; un Chrome par Mac ; la première campagne des autopilotes.
- **05/10/2026** (Kimi, `test-kimi`) : le chargement (première image sur 2 pipelines, compilations en arrière-plan), le palier mesuré dans les deux sens, le démarrage borné, Jupiter 8K, WGS84, IAU, le temps du hub et celui du pilote.

- **M1** (05/10/2026) : la PWA — coquille cache-first, tuiles de la Terre sous budget (LRU, index en IndexedDB), hors ligne la dernière scène joue. Leçon : une assertion e2e qui cherche `index-<hash>.js` ne voit pas le chunk du serveur de dev (`chunk-<hash>.js`) — viser le script principal chargé par la page, pas un nom.

- **G4** (04/10/2026) : O13 (la Terre d'orbite 4–6× moins chère), le gouverneur P2 annulé (artefact de mesure), R10 étape 1, déterminisme du vol rejoué (météo, tuiles), LOLA/MOLA, imagerie GIBS ; écartés à la mesure ou à l'examen : R9, R10 étape 2, PBR du Ranger.

- **G3** (04/10/2026) : pistes, post (Purkinje, poussière d'objectif, flou de mouvement), passation à l'arrêt de la caméra, étoiles splattées (R8), anneaux, océan, nuages, cartes BC7/BC5, gouverneur Pareto (annulé en G4 : artefact de mesure) ; écartés à la mesure : R7, O10, rayons crépusculaires en espace écran ; cockpit éclairé en attente d'une décision. Leçons : mesurer ce qu'on croit mesurer (deux biais de `quality.ts`) ; un actif importé depuis un dossier ignoré par git casse la CI.

- **03/10/2026** : audit commité (`7328d0d`) ; démarrage de la phase 0.
- 0.1 `cc6f00d` : CI `verify` avant déploiement, build local cohérent, tests stabilisés.
- 0.2 : la pile d'Échap, testée en vol dans Artemis : maintien prograde, panneau Caméra ouvert, Échap ferme le panneau et le maintien reste ; un second Échap le relâche.
- 0.3 : bug de repère P1 corrigé (10× moins d'écart) ; Δv gratuit P4 corrigé. Leçon : les onglets masqués du volet ralentissent la boucle, donc mesurer la physique avec `__bh.freeze` + `__bh.step`.
- 0.4 : constantes et vecteurs uniques, avec tests identiques (expects égaux, à part les 3 assertions de durée devenues optionnelles). Leçon : après des éditions en rafale, redémarrer le serveur de dev (bundle HMR périmé).
- 0.5 : stockage sûr, erreurs visibles, sauvegardes validées ; l'autosave existante se recharge (vérifié dans l'app).
- 0.6 : typage strict, 0 erreur ; app vérifiée (poussée, journal sans erreur).
- 0.7 : 4 nouveaux fichiers de tests (16 tests) sur du code jusqu'ici à 0 %.
- 0.8 : lint/format et validation des shaders en CI. **Phase 0 terminée.**
- G0 : Kerr Bench livré (`#bench`), référence M1 Max = 1000, fusion des rapports. Phase Standard de référence : Artemis 49 fps, Gargantua 42, disque 44, Saturne 44, Kerr 57, trou de ver 47, Lune 53, Miller 51 (Game, headless).
- **G2** (04/10/2026) : le relief de la Terre −11 à −19 % (O8) ; la reconstruction un peu meilleure (R2, R4) pour ~0,4 ms ; O6 et O7 écartés (une couture d'image, un volume plus cher que le pas). Mesurer après des heures de bancs : la machine chauffe (Kerr Score 930 → 833 pour le même code).
- **G1** (04/10/2026) : une seule optimisation du noyau sur sept tient la mesure (O1) ; les autres coûtent ou ne changent rien — le noyau est limité par ses registres. Outil : `scripts/trace-ab.ts`. Le volet du navigateur ouvert pendant une mesure la fausse (Kerr Score 767 avec un onglet caché, 930 sans).
- **Phase 2** (03–04/10/2026) : 2.1–2.11 livrés (STS-1 en attente de données). Leçons : un test long doit être découpé et borné (un remplacement global a fait boucler `heightOf` sur lui-même — repéré par un balayage fichier par fichier sous chien de garde) ; dans les boucles chaudes, le pôle de date suffit pour une figure de révolution (l'orientation complète de la Terre, précession-nutation, coûtait 60× plus) ; le bruit procédural relu à la latitude géodésique a posé une colline sous la finale d'Edwards — la zone nivelée couvre maintenant l'approche.
- **04/10/2026, correctif** : les scènes basses des mondes de Gargantua (« Miller : la mer peu profonde », « Mann : les glaciers », « Edmunds : les plaines ») mettaient le Ranger piloté en orbite à 2–3 km, nez en bas, à vitesse orbitale dans l'air : il cassait dès le chargement (300 à 7 700 g). Il y vole désormais en palier, 250 m/s dans l'air (`theirFlightPose`), son attitude passée par la correspondance locale ↔ ZAMO du vol local (sinon 100° d'incidence à Edmunds) ; sans vaisseau, la caméra garde son orbite. Au sol de Miller, le vaisseau posé sur les vagues dessinées tombait d'un mètre sur la mer ressentie (5 m/s : un crash pour le train réaliste) : il est posé sur la surface ressentie. e2e `worlds.e2e.test.ts` (les six scènes, 5 s chacune) ; golden `miller-sea` ré-enregistré (le vaisseau roule au lieu de s'écraser).
- U0 : Échap partout, toasts en pile, HUD juste (unités, temps simulé, fausses alarmes), Craft Lost refait, panneaux encadrés, 11 px minimum. Captures headless : pas de tir, orbite, carte, Craft Lost, réglages.

## Phase 1 : consolidation (terminée)

Ordre : les filets d'abord (e2e et trajectoires de référence), puis les découpages, chacun vérifié contre ces filets.

| # | Étape | Statut | Commit |
|---|---|---|---|
| 1.1 | **Harnais e2e versionné** `tests/e2e/` (CDP natif, sans dépendance, serveur de production à lui, vrais événements, **hit-test à chaque clic**) : démarrage sans erreur, pile d'Échap avec maintien, toasts, carte au vrai clavier (canvas sous le pointeur), aide « ? », réglages au vrai clic, Kerr Bench. **7 scénarios, 25 s** ; `bun run e2e`. En CI plus tard : SwiftShader n'offre sans doute pas les 10 storage buffers (voir O4) | fait | `511f0c9` |
| 1.2 | **Vols de référence** (`tests/e2e/golden.e2e.test.ts`) : 8 vols au pas fixe (poussée en orbite, maintien rétrograde, planée vers Edwards, amarrage auto ISS, décollage lunaire, poussée près de Gargantua, trou de ver, mer de Miller), état final comparé à 1e-9 près. Pour les rendre **déterministes** : **horloge de frame** (`src/frameclock.ts`) pour les 13 caches et rythmes de vol qui suivaient l'horloge murale (la trajectoire dépendait de la vitesse de la machine), date « maintenant » fixable (`__bh.setDate`), réseau coupé en e2e (éléments ISS et tuiles du jour). Vérifié : pas fixe ≈ temps réel (planée : 23,6 contre 23,1 km au même instant) | fait | `e620390` |
| 1.3 | **Découpage de `controls.ts`** : 9 436 → ~1 000 lignes (la classe : champs, constructeur, accesseurs) ; 224 méthodes réparties en **12 modules de domaine** `src/controller/` (rotation, lens, motion, piloting, computer, fleet, docking, plan, planet, rig, lowthrust, journey) + `util.ts`, installés sur le prototype (fonctions `this: CameraController`, types par augmentation de module). Découpage fait par l'API du compilateur TypeScript (bornes exactes). **Vols de référence identiques, 261 tests et e2e verts** | fait | `515393e` |
| 1.4 | **Découpage de `main.ts`** (2 645 → 2 018 lignes) : **table de raccourcis unique** `src/input/keymap.ts` — les touches sont envoyées par elle et l'aide « ? » est dessinée depuis elle (plus de touche non documentée : I, H, F, P, F2, Échap y figurent) ; couches système → vol → temps → scène, aucune ambiguïté par couche (test) ; `__bh` → `src/automation.ts` ; overlays (verrou, crochets, survol, vaisseau vu de dehors, télescope, courbe critique) → `src/ui/overlay.ts`. La boucle reste pour 1.6. **6 tests clavier, e2e : l'aide contient chaque ligne de la table** | fait | `3f02080` |
| 1.5 | **`interface FlightInfo` explicite** et documentée (`src/controller/telemetry.ts`, 70 champs groupés : lieu et espace-temps, moteur et pilote, carte, plan, monde proche, cible, amarrage et flotte) ; `sim.ts` en prend un `Pick` au lieu d'un type recopié. **Ancien planificateur retiré** : ~490 lignes de `flighthud.ts` (le bouton PLAN ouvre l'onglet MISSION de l'ordinateur de vol depuis des mois) et 54 règles CSS mortes. **−924 lignes** | fait | `26ff6bd` |
| 1.6 | **Boucle à pas fixe : mesurée d'abord, reportée.** Les vols de référence rejoués à 30, 60 et 144 pas/s finissent à quelques mètres près (rentrée : 9 m et 0,06 m/s après 30 s ; décollage lunaire : 5 m) — les intégrateurs sous-pas déjà selon la dynamique, la physique ne dépend pas de la fréquence d'images. Une boucle à pas fixe + interpolation (état rendu à interpoler : pose de caméra en 3 repères, vaisseau, flotte) n'apporterait rien de mesurable ; **reportée à la phase réseau** (horodatage des lignes d'univers). **Bug trouvé en mesurant** : un preset, un placement ou une sauvegarde ne remettaient pas à zéro le vol précédent — une seconde planée démarrait en pleine approche, train rentré, aérofreins sortis (6,7 km → 20,9 km d'altitude après 30 s). `camera.newFlight()` : course d'entrée, d'amarrage, de circularisation, aéro (chaleur, train, volets, aérofreins), poussée affichée, traînées, caches des écrans. **Nouveau test e2e** `rates.e2e.test.ts` : 30 Hz ≈ 120 Hz sur 4 vols, et un vol rejoué deux fois finit identique au bit près | fait | `ed8f27d` |
| 1.7 | **`Settings` classé** plutôt que scindé (209 clés, des centaines d'appels) : `SETTING_KIND: Record<keyof Settings, "pref" \| "carried" \| "scene">` — une clé sans genre ne compile pas. Il décide de tout : ce qu'un preset conserve (remplace la liste `KEEP_ON_PRESET` tenue à la main), ce qu'une sauvegarde contient, ce qu'un chargement laisse. **Préférences du joueur** (49 : budget, affichage, son, aides HUD) stockées à part (`kerr.prefs`, reprises d'une autosauvegarde v1) — avant, elles ne survivaient que dans l'autosauvegarde, et les aides HUD revenaient à chaque changement de scène. **Sauvegarde v2** : sans les préférences, chaîne de migrations (`MIGRATIONS[v]`), version future refusée, clés inconnues écartées. Le Kerr Bench part des défauts et n'écrit rien. Tests : 3 unitaires (migration, version, genres), 3 e2e (sauvegarde, scène, rechargement) | fait | `a150d41` |
| 1.8 | **Phase de vol** (`src/game/phase.ts`) : mode (caméra libre, cinématique, rendu, posé, amarré, en vol) × qui pilote (main, maintien, autopilote) × étape (sol, air, entrée, approche, suborbital, orbite, échappement, amarrage, Kerr, gorge) — dérivée à chaque frame, **anti-rebond** d'une seconde pour l'étape (un périapside qui frôle l'air n'est pas une phase), immédiate pour le mode. **Bus d'événements typé** (`src/game/events.ts` : `phase`, `airEntry`, `craftLost`, `pilotMessage`) à la place des rappels un-à-un du contrôleur ; chaque changement de phase est une ligne du journal, et le HUD reçoit la phase (pour U4). Choix : dérivée plutôt que source de vérité — aucun changement de comportement, les drapeaux du contrôleur restent l'état. Tests : 3 unitaires, 1 e2e | fait | `8e87360` |
- U1 : le golden des deux scènes de Gargantua dépendait du temps écoulé depuis le chargement de la page (scènes sans heure propre) — fixé à 0 dans le banc, deux vols ré-enregistrés, les six autres inchangés au bit près.
- Phase 1 close. Reporté de l'audit : le job e2e en CI (SwiftShader : liaisons de stockage, voir O4), l'e2e de chacun des 79 presets et de la perte du GPU.
- 1.7 : les aides HUD revenaient à leurs défauts à chaque scène — elles sont désormais des préférences.
- 1.6 : mesurer avant de réécrire — la boucle à pas fixe n'était pas le problème ; l'état hérité d'un vol à l'autre l'était.
- 1.4 : la table de raccourcis est la source unique (envoi + aide). Changement de comportement voulu : toute touche reconnue fait `preventDefault`. Noté pour U4 : en vue libre, le libellé de la cible passe sous la barre de temps.
- 1.1–1.2 : harnais e2e (7 scénarios) et 8 vols de référence reproductibles. Découverte : 13 caches de vol réglés sur l'horloge murale rendaient le vol dépendant de la machine ; ils suivent désormais une horloge de frame.
