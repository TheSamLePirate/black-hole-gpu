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
| Physique | 64 | 64 | 80 |
| Code + tests | 44 | 44 | 75 |
| Technologie | 67 | 67 | 80 |
| UI / UX / HUD | 44 | 44 | 80 |
| Produit / gameplay | 50 | 50 | 80 |
| **Global** | **≈ 54** | **≈ 54** | **≈ 78–80** |

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

## Phase 1 : consolidation (en cours)

Ordre : les filets d'abord (e2e et trajectoires de référence), puis les découpages, chacun vérifié contre ces filets.

| # | Étape | Statut | Commit |
|---|---|---|---|
| 1.1 | **Harnais e2e versionné** `tests/e2e/` (CDP natif, sans dépendance, serveur de production à lui, vrais événements, **hit-test à chaque clic**) : démarrage sans erreur, pile d'Échap avec maintien, toasts, carte au vrai clavier (canvas sous le pointeur), aide « ? », réglages au vrai clic, Kerr Bench. **7 scénarios, 25 s** ; `bun run e2e`. En CI plus tard : SwiftShader n'offre sans doute pas les 10 storage buffers (voir O4) | fait | `511f0c9` |
| 1.2 | **Vols de référence** (`tests/e2e/golden.e2e.test.ts`) : 8 vols au pas fixe (poussée en orbite, maintien rétrograde, planée vers Edwards, amarrage auto ISS, décollage lunaire, poussée près de Gargantua, trou de ver, mer de Miller), état final comparé à 1e-9 près. Pour les rendre **déterministes** : **horloge de frame** (`src/frameclock.ts`) pour les 13 caches et rythmes de vol qui suivaient l'horloge murale (la trajectoire dépendait de la vitesse de la machine), date « maintenant » fixable (`__bh.setDate`), réseau coupé en e2e (éléments ISS et tuiles du jour). Vérifié : pas fixe ≈ temps réel (planée : 23,6 contre 23,1 km au même instant) | fait | `e620390` |
| 1.3 | **Découpage de `controls.ts`** : 9 436 → ~1 000 lignes (la classe : champs, constructeur, accesseurs) ; 224 méthodes réparties en **12 modules de domaine** `src/controller/` (rotation, lens, motion, piloting, computer, fleet, docking, plan, planet, rig, lowthrust, journey) + `util.ts`, installés sur le prototype (fonctions `this: CameraController`, types par augmentation de module). Découpage fait par l'API du compilateur TypeScript (bornes exactes). **Vols de référence identiques, 261 tests et e2e verts** | fait | `515393e` |
| 1.4 | **Découpage de `main.ts`** (2 645 → 2 018 lignes) : **table de raccourcis unique** `src/input/keymap.ts` — les touches sont envoyées par elle et l'aide « ? » est dessinée depuis elle (plus de touche non documentée : I, H, F, P, F2, Échap y figurent) ; couches système → vol → temps → scène, aucune ambiguïté par couche (test) ; `__bh` → `src/automation.ts` ; overlays (verrou, crochets, survol, vaisseau vu de dehors, télescope, courbe critique) → `src/ui/overlay.ts`. La boucle reste pour 1.6. **6 tests clavier, e2e : l'aide contient chaque ligne de la table** | fait | `3f02080` |
| 1.5 | **`interface FlightInfo` explicite** et documentée (`src/controller/telemetry.ts`, 70 champs groupés : lieu et espace-temps, moteur et pilote, carte, plan, monde proche, cible, amarrage et flotte) ; `sim.ts` en prend un `Pick` au lieu d'un type recopié. **Ancien planificateur retiré** : ~490 lignes de `flighthud.ts` (le bouton PLAN ouvre l'onglet MISSION de l'ordinateur de vol depuis des mois) et 54 règles CSS mortes. **−924 lignes** | fait | (ce commit) |
| 1.6 | **Boucle à pas fixe** et interpolation | à faire | |
| 1.7 | `Settings` séparé (préférences / rendu / état) et sauvegarde v2 | à faire | |
| 1.8 | Machine à états des modes de vol | à faire | |
- 1.4 : la table de raccourcis est la source unique (envoi + aide). Changement de comportement voulu : toute touche reconnue fait `preventDefault`. Noté pour U4 : en vue libre, le libellé de la cible passe sous la barre de temps.
- 1.1–1.2 : harnais e2e (7 scénarios) et 8 vols de référence reproductibles. Découverte : 13 caches de vol réglés sur l'horloge murale rendaient le vol dépendant de la machine ; ils suivent désormais une horloge de frame.
