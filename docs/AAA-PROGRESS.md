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
| G0.1 | **Moteur** `src/bench/runner.ts` : 8 scènes de référence, phase A (Game, auto) et phase B (bloc 4, ~1,44 Mpx, Mrays/s), attente de la variante du traceur et des assets, contrôle thermique, balayage des qualités (Complet), détection d'onglet masqué, HUD non dessiné pendant la mesure | fait | (ce commit) |
| G0.2 | **Rapport** `kerr-bench/1` (`src/bench/report.ts`) : système (GPU, limites, navigateur, écran), chargement, scènes, thermique, VRAM, erreurs, Kerr Score, qualité conseillée ; `src/bench/sysinfo.ts`, `src/bench/vram.ts` | fait | (ce commit) |
| G0.3 | **Écran** `…/#bench` (`src/ui/bench.ts`, `bench.css`) : accueil, mesure, résultats, téléchargement, copie, partage, comparaison ; **FR/EN** (`src/i18n.ts`, premier usage) | fait | (ce commit) |
| G0.4 | `scripts/bench.ts` pilote `__bh.bench` (une seule logique de mesure) ; `version.json` (serveur et build) | fait | (ce commit) |
| G0.5 | Référence de score (cette machine, test Standard) et `scripts/bench-merge.ts` | à faire | |

Découvertes en route :
- **`realtimeBlockNow` renvoyait le bloc automatique même en réglage fixe** : les débits de `perf()`, de l'ancien script et du benchmark divisaient par le mauvais bloc. Corrigé (il renvoie le bloc réellement utilisé).
- **Le HUD de vol coûte ≈ 15 ms de CPU par image** en orbite (marqueurs et rubans 7 ms, mini-carte 6,7 ms, pire cas 38 ms), mesuré en Chrome headless : sur un budget de 16,7 ms, c'est le premier frein CPU du jeu. **À traiter en U4 et dans la vague G1.**
- Le volet de navigation intégré se ralentit à 1 image/s quand il n'est pas au premier plan : les mesures de performance se font en Chrome headless.

## U0 : quick wins UI

À venir. Détail : audit §17.

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
