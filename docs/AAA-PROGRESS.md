# Vers l'AAA : suivi d'exécution

Ce fichier suit l'exécution du plan de l'audit [`AUDIT-AAA-2026-10-03.md`](AUDIT-AAA-2026-10-03.md). Il est mis à jour à chaque étape, avec un commit par étape et un push par phase (chaque push déploie GitHub Pages).

**Décisions du propriétaire (03/10/2026) :**
- je travaille seul sur `main` ;
- chaque phase est poussée ;
- ordre : **phase 0 → G0 Kerr Bench → U0 → phase 1 → le reste** ;
- interface en **FR + EN** (i18n).

## Tableau de bord

| Pilier | Départ (audit) | Actuel | Cible AAA |
|---|---:|---:|---:|
| Physique | 64 | 66 | 80 |
| Code + tests | 44 | 62 | 75 |
| Technologie | 67 | 69 | 80 |
| UI / UX / HUD | 44 | 48 | 80 |
| Produit / gameplay | 50 | 51 | 80 |
| **Global** | **≈ 54** | **≈ 59** | **≈ 78–80** |

*Réestimé à la fin de la phase 1 (03/10/2026).* Physique : la force de marée de la bouche (P1) et le vol qui n'hérite plus du précédent. Code + tests : Biome et CI de vérification, `controls.ts` 9 436 → 1 000 lignes en 13 modules, `main.ts` −24 %, table de touches unique, `FlightInfo` et genres de réglages typés, machine de phases, 286 tests unitaires et 24 e2e (vols de référence au bit près, indépendance à la fréquence) — mais l'e2e ne tourne pas encore en CI et `flighthud.ts` fait 3 000 lignes. Technologie : Kerr Bench, validation WGSL headless. UI : les gains rapides U0.

Les notes « actuelles » sont réestimées à la fin de chaque phase, en reprenant les critères de l'audit.

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

## U4 : le HUD par phase (en cours)

| # | Étape | Statut | Commit |
|---|---|---|---|
| U4.1 | **Coût CPU du HUD : 11,6 → 2,7 ms par frame** (mesuré en vol, Artemis, Chrome headless ; profileur CPU par CDP pour trouver où). (1) La mémoïsation des éphémérides ne gardait **qu'un instant** : vidée à chaque autre instant (temps retardé de la lumière, échantillons du futur) → plusieurs instants récents, invalidée quand une éphéméride arrive. (2) Les repères +10/+30/+60 s recalculaient, 10 fois par seconde, la position du corps à chaque point de la trajectoire → mis en cache par trajectoire ; la géométrie de la bouche calculée une fois, pas une fois par point. (3) La mini-carte était dessinée **à chaque frame** : sa caméra, qui suit le vaisseau, n'est jamais au repos → dessin continu seulement pour un mouvement donné par le pointeur, sinon 10 Hz. (4) Sur la carte, la position d'un astre le long d'une trajectoire est exacte toutes les 2 min et interpolée entre (~10 m pour la Terre ; l'ISS et les vaisseaux exacts). Vols de référence inchangés au bit près | fait | `dc0bfaa` |
| U4.2 | **Master caution** (`src/ui/hud/alerts.ts`, pur et testé) : les alertes classées WARNING (rouge — collision, rupture, bouclier ou coque à 95 %, charge à 92 %, décrochage, réservoir vide), CAUTION (ambre — les mêmes limites approchées, réservoir sous 10 %, sous l'orbite des photons ou l'ISCO), ADVISORY (blanc — plasma, ergosphère, posé, temps en pause) ; trois lignes au plus, la plus grave d'abord ; un voyant MASTER WARNING / CAUTION allumé et l'alarme sonore tant qu'il n'est pas acquitté (Entrée, ou clic) ; une alerte qui revient rallume. Entrée sur un bouton focalisé reste au bouton. Tests : 3 unitaires, 1 e2e (réservoir vidé, acquittement) | fait | `cb6a418` |
| U4.3 | **Matrice phase × élément** (`src/ui/hud/declutter.ts`, pur et testé) : chaque étape décide de ce qui a un sens — en orbite ni échelle d'inclinaison ni données air ; en finale ni repères orbitaux, ni futur, ni impact, ni allumage (la piste, le vecteur vitesse, l'air) ; au sol ni repères ni futur ; à l'amarrage ni horizon ni cap ; autour de Gargantua ni horizon ni cap. Les interrupteurs du joueur et la densité (²) restent par-dessus : un élément est dessiné si la phase, l'interrupteur et les données le permettent. Corrigé : la mini-carte n'écrit plus « IMPACT » sous un vaisseau posé | fait | `b9729bd` |
| U4.4 | **Aides de rentrée** : un panneau ENTRY pendant la rentrée guidée (hypersonique, avant la planée) — distance au site et écart de cap (Δψ), gîte commandée et gîte réelle, charge et son maximum, flux thermique et sa tendance sur 30 s (entre son minimum et son maximum), Mach et pression dynamique, pics prévus par le plan (flux, bouclier, g). `entryInfo()` gagne la distance au site et l'écart de cap | fait | `593b760` |
| U4.5 | **Chemin dans le ciel et PAPI** sur la finale : des portes tous les 1,5 km le long du profil d'atterrissage de l'autopilote (`landingProfile`), en magenta (la couleur du guidage), la plus proche la plus vive ; un PAPI de 4 feux sous la boîte de piste — blanc au-dessus du profil, rouge en dessous, deux et deux sur le chemin (l'écart de hauteur vu depuis le toucher : ±0,35°, ±1°). `RunwayView` gagne `papi` et `gates` | fait | (ce commit) |

## Journal

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
