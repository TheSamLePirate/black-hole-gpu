# Pipeline terrestre AAA — progression et validation

Mise à jour : **20 octobre 2026**. État du code : **`86074585`** plus le garde-fou rasant et l'affinement d'Illinois ([P1c](P1c.md), [P1d](P1d.md)).
Branche : `codex/aaa-terrestrial-renderer`, base main `a9380bfe`.

## État réel

Le pilote raster **s'exécute maintenant sur le GPU** (P1c) : compilation, dessin, trois vues, maillage conforme,
libération. Avant cela, il n'était pas éligible dans les scènes Terre (condition sur le noyau Kerr, corrigée pour
l'inspecteur seul). Il reste **désactivé par défaut**. La marche des rayons du rendu principal est toujours présente.

Mesures P1c (une machine, 960 × 540) : écart raster/scène 0,2 à 1 m (p50 à p99) à 900 m, 1 à 4 m à 3 km avec la
cellule de 38 m, jusqu'à 14 m (p90) à 3 km avec celle de 153 m ; **le cache de hauteurs dans le tracé ne fait pas
gagner de temps** (A/B alterné). La condition de poursuite de P1 n'est **pas remplie** : voir
[P1c §5](P1c.md). Aucun gain de cadence ni de netteté n'est démontré ; P2–P6 ne sont pas commencés.

**Option A faite (P1d, expérimental, hors défaut)** : `earthTerrainRasterUse` — le tracé temps réel démarre la recherche du sol depuis la
distance raster, vérifiée par deux lectures du relief complet, avec retour à la marche sinon. Mesuré (un GPU Apple, 960 × 540) :
`trace` −23 à −43 % de 900 m à 4 km, images au plancher de bruit presque partout ; 5–15 % quand la portion (≈ 20 km) ne couvre
plus l'image ; limite connue : les crêtes plus fines que la cellule aux vues rasantes sur relief accidenté.

La référence utilisateur reste le M1 Max, environ 24 images/s en temps réel ×4, avec une image trop
pixellisée (non instrumentée sur cette branche).

## Livré

| Commit | Travail réalisé | Limite actuelle |
|---|---|---|
| `0e5b2e65` | Analyse et plan de migration | Objectifs à valider |
| `bfaa88f9` | Contrat de préservation des phénomènes optiques et physiques | Matrice de non-régression à exécuter |
| `a159802d` | Cache GPU de hauteurs, six fenêtres, repli vers la source existante | Marche primaire conservée ; erreur et coût total non mesurés |
| `05ae7314` | Terrain raster WGS84 ; inspecteur profondeur, normales et différences | Passe ajoutée au rendu actuel, sans remplacement de sa visibilité |
| `fe5f591f` | Création du dossier SQLite en développement dans un worktree neuf | Correction de la cause du démarrage signalée ; lancement utilisateur à confirmer |
| `541838c2` | Nivellement de référence réutilisé aux sommets près des pistes | Interpolation des triangles encore susceptible de traverser les bords |
| `c67f5709` | Raffinement de grille près des seuils et bords des pistes, budget borné | Lignes rectilignes seulement |
| `86074585` | Le tracé part de la distance raster (`earthTerrainRasterUse`), vérifiée, repli sur la marche | Un seul niveau ; crêtes fines aux vues rasantes ; pas de cadence de vol mesurée |
| `70db3c4e` | Cellules coupées le long des contours des pistes (ruban et zone nivelée), toutes orientations ; raccords sans jonction en T ; repli sur la grille au-delà du budget | Vérifié en géométrie CPU seulement ; rendu GPU et hauteur aux sommets coupés non vus |

Détails techniques, budgets et commandes de diagnostic : [P1a](P1a.md) et [P1b](P1b.md).

## Vérifications et tests

Résultats enregistrés lors des étapes précédentes jusqu'à `c67f5709`, non relancés pour ce journal, plus ceux
du maillage conforme (lignes marquées « nouveau »).

| Vérification | Résultat enregistré | Limite |
|---|---|---|
| `bun run typecheck` | Réussi | Ne valide pas l'exécution GPU |
| Biome ciblé | Réussi ; remarques préexistantes hors modifications détaillées dans P1b | Ne valide pas le rendu |
| `bun scripts/check-wgsl.ts` | 24/24 modules/compositions compilent, adaptateur Apple, Chrome headless local | Aucun dessin ; bind groups, précision et coût non validés |
| `git diff --check` | Réussi | Vérification de forme uniquement |
| `bun test ./tests/terrain-raster-mesh.test.ts` (nouveau) | 8/8 ; géométrie CPU : surface, orientation, étanchéité, aucun triangle sur un côté de contour, budget | Pas de GPU ni de jeu ; hauteurs des sommets non testées |
| `bun run typecheck`, Biome ciblé (nouveau) | Réussis sur le maillage, le pilote et le test | Ne valide pas le rendu |
| `tests/e2e/terrain-raster.e2e.test.ts` (nouveau, headless local) | Réussi : pilote compilé, dessiné, conforme, libéré ; écart mesuré sur 3 vues × 2 niveaux | Une machine ; timestamps par passe peu fiables ; écart ≠ erreur bornée |
| A/B cache de hauteurs dans le tracé (nouveau) | Aucun gain ; 3 tours alternés par vue | Mesuré avec la condition Kerr levée pour l'essai, puis rétablie |
| `tests/e2e/terrain-raster-hint.e2e.test.ts` (nouveau) | A/B alterné sur 3 lieux ; −23 à −43 % de `trace` de 900 m à 4 km, images au plancher de bruit sauf crêtes rasantes | Un GPU, charge variable entre séries |
| `bun test`, smoke, bh-api, cost-view, gpu-startup (nouveau) | bun test 1 365 ✓ (packs KTX2 ✗ sans mes changements) ; smoke, bh-api, cost-view ✓ ; gpu-startup 15/16 (échec antérieur) | — |
| Autres e2e | Non lancés | — |
| Vols, captures comparatives, benchmarks | Non lancés | Aucun FPS ni résultat visuel acquis |

L'absence de tests respecte la demande utilisateur. La compilation WGSL est une vérification de modules,
sans lancement du jeu. Une future campagne suivra les règles de [E2E](../../E2E.md).

## Prochaine étape de code

1. Raster de **bornes** (hauteurs max/min par nœud) pour que l'indice encadre le premier zéro à coup sûr, y compris aux vues
   rasantes sur relief accidenté (P1d, limite connue).
2. Plusieurs niveaux (fin sur le coarse, tolérance par niveau) pour couvrir au-delà de 20 km et à haute altitude.
3. Mesure de cadence de vol terminée (P0), puis temporalité (jitter, historique) avec l'indice.

## Validations restant à faire avant la bascule

- [ ] Mesurer une référence reproductible sur M1 Max : scène, résolution interne/sortie, bloc temps réel,
  temps GPU/CPU et mémoire ; distinguer chargement et état résident.
- [ ] Vérifier numériquement WGS84, distances et accord avec le relief/contact existant (écart à la scène mesuré en P1c, pas contre le contact CPU).
- [x] Exécuter le pilote : ressources, bind groups, dessin, redimensionnement et désactivation (P1c, headless local).
- [ ] Comparer pistes obliques, approches et roulage à l'image ; contrôler seuils, transitions et fissures
  (étanchéité du maillage démontrée en CPU, pas en rendu).
- [ ] Valider raccords entre fenêtres/niveaux, sélection par erreur projetée et découvertes en mouvement.
- [~] Intégrer la visibilité raster au rendu final : fait pour la recherche du sol (P1d, −23 à −43 %) ; profondeur partagée, mouvement
  et reconstruction temporelle restent à faire.
- [ ] Vérifier éclipse, réfraction, diffusion, absorption et chemins relativistes selon la matrice du plan.
- [ ] Traiter forêts à longue portée, reconstruction temporelle, nuages et mer selon leurs lots.

Les calculs optiques existants restent dans le chemin actuel. Leur conservation pendant la future
intégration est une exigence à démontrer, pas une validation déjà acquise.

## Lancement manuel

```sh
# (depuis la racine du dépôt)
bun run dev
```

Commande fournie pour l'utilisateur, non exécutée pour ce journal. Le [plan complet](../../PLAN-PIPELINE-TERRE-AAA.md)
reste la référence pour les jalons et leurs preuves attendues.
