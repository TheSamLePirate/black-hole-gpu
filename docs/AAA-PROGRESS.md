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
| 0.3 | Physique : **accélération du repère « home »** complète (Saturne tiré par tous les corps, Titan compris, et chute du Soleil autour du barycentre) : l'écart éphéméride / modèle de forces passe de 5,5e-6 à ≈ 5e-7 m/s², et un test le verrouille ; **Δv gratuit** supprimé (poussée au prorata du temps réellement volé, dans les deux intégrateurs). Poussée vérifiée en jeu, à pas fixe (2 g, identique avant et après) | fait | (ce commit) |
| 0.4 | `src/units.ts` (constantes uniques) et `src/math/vec3.ts` ; constantes divergentes corrigées | à faire | |
| 0.5 | Robustesse : `safeStorage`, `assert()` en dev, fin des exceptions avalées à chaque frame, sauvegardes validées | à faire | |
| 0.6 | TypeScript plus strict : `noUncheckedIndexedAccess`, `noUnusedLocals` | à faire | |
| 0.7 | Tests purs : sauvegarde et `#save`, `iss-plan`, `flightair`, symbologie | à faire | |
| 0.8 | Lint/format (Biome) et validation WGSL en CI | à faire (téléchargements à confirmer) | |

## G0 : Kerr Bench

À venir. Spécification : audit §29.

## U0 : quick wins UI

À venir. Détail : audit §17.

## Journal

- **03/10/2026** : audit commité (`7328d0d`) ; démarrage de la phase 0.
- 0.1 `cc6f00d` : CI `verify` avant déploiement, build local cohérent, tests stabilisés.
- 0.2 : la pile d'Échap, testée en vol dans Artemis : maintien prograde, panneau Caméra ouvert, Échap ferme le panneau et le maintien reste ; un second Échap le relâche.
- 0.3 : bug de repère P1 corrigé (10× moins d'écart) ; Δv gratuit P4 corrigé. Leçon : les onglets masqués du volet ralentissent la boucle, donc mesurer la physique avec `__bh.freeze` + `__bh.step`.
