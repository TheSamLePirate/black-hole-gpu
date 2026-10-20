# P1a — Première brique du pipeline terrestre : cache GPU de hauteurs

Date : **20 octobre 2026**. Branche : `codex/aaa-terrestrial-renderer`, issue de `a9380bfe`.

Statut : **prototype implémenté, désactivé par défaut ; aucune validation en vol ou de performance**.
Ce lot commence la partie caches de [P1](../../PLAN-PIPELINE-TERRE-AAA.md#p1--terrain-pilote--caches-et-raster).
Il ne remplace pas encore la visibilité par des triangles et ne constitue pas le premier livrable complet de P1.

## Ce que fait ce lot

Le traceur peut réutiliser une surface de hauteurs préparée sur le GPU, au lieu de recalculer toute la source
pour certaines lectures complètes de relief. Le parcours principal conserve son évaluation de hauteur simplifiée
(`earthHeightStepG`) : ce lot ne supprime ni la marche des rayons ni son coût structurel.

- Six fenêtres de 129 × 129 nœuds, sur des grilles angulaires fixes en longitude/latitude géodétiques.
  Espacement méridien approximatif : 9,6 m, 38 m, 153 m, 612 m, 2,45 km et 9,78 km ; l'espacement est/ouest
  diminue avec la latitude. Les hauteurs restent des mètres sur WGS84, en float32, sans conversion float16.
- Une seule fenêtre reconstruite par image temps réel. Recentrage après environ un quart de sa largeur ;
  longitude déroulée au passage de l'antiméridien. Au-delà de 70° de latitude : source de référence.
- Les fonctions de relief et leurs dépendances sont extraites de `trace.wgsl`, comme pour le cache de warp
  existant. La déformation procédurale est évaluée directement pendant la préparation, sans dépendre des
  fenêtres de warp qui suivent la caméra. Aucun second modèle CPU du relief n'est ajouté.
- Le cache contient le relief naturel. Le nivellement des pistes est exclu de la préparation ; toute requête
  touchant sa zone d'influence utilise la fonction de référence, y compris sa transition.
- Lecture bilinéaire, atténuation aux bords et aux deux extrémités de l'intervalle d'empreinte ; la source
  actuelle complète le résultat lorsque le cache ne suffit pas. Les nœuds sont préparés à une empreinte fixe
  par niveau : **l'interpolation n'est pas une équivalence mathématique à la source à toute empreinte**.

Les fenêtres sont invalidées lorsque la version des tuiles change ou les textures sources sont remplacées.
Un changement de caméra recalcule uniquement les fenêtres déplacées. L'horloge météo, les lumières de piste
et les déplacements de la caméra à l'intérieur d'une fenêtre ne constituent pas des versions du relief.

La préparation utilise un tampon temporaire puis copie le niveau dans la table existante, avant la passe
de trace. Le niveau n'est exposé au traceur que dans la soumission contenant cette copie. Une reconstruction
rejette les anciens échantillons et l'historique temporel dans cette même image. Le suivi GPU ne réserve
des timestamps que lorsqu'une passe de préparation est effectivement encodée.

## Périmètre physique et chemins de référence

Le réglage `earthTerrainCache` nécessite le relief réel, la Terre proche, une altitude géodétique inférieure
à 100 km, un rendu physique visible temps réel et un noyau sans intégration Kerr. Il reste inactif pour la marche,
les réglages de tuning scientifiques, les modes diagnostiques de `renderMode`, la radio et la polarisation.
Les noyaux de sondes, de qualité, de LUT et de perspective aérienne
sont compilés sans cette optimisation. La préparation attend également le noyau spécialisé, afin de ne pas
préparer une surface que le noyau général ne lirait pas.

Les calculs des éclipses, de réfraction atmosphérique, de diffusion, d'absorption, de radiance, des nuages,
de la mer et des régions relativistes ne sont pas remplacés. Les collisions et le sol physique CPU ne changent
pas. **Cela ne prouve pas encore une absence de régression visuelle** : une approximation de hauteur peut
modifier une silhouette, une normale, une ombre ou un reflet. La matrice optique de §3.4 du plan reste exigée
avant toute généralisation. Le chemin actuel reste disponible en désactivant le réglage.

## Mémoire, observabilité et accès

La table GPU existante réserve **399 648 octets supplémentaires**, y compris lorsque le réglage est désactivé.
Les anciens offsets de corps, harmoniques, LUT, trajectoire, marche et warp sont conservés. Aucun binding de
lecture supplémentaire n'est ajouté au traceur, qui conserve sa compatibilité avec les limites actuelles.

Après activation et première préparation, les tampons temporaires occupent **66 608 octets** supplémentaires
(hauteurs et uniforme), soit **466 256 octets** au total pour ces données. Ils sont conservés pour réactivation,
puis libérés avec le renderer ou à la perte du device. Ce compte exclut la mémoire interne des compilations,
pipelines et bind groups ; ce n'est pas une mesure de résidence GPU complète.

Le panneau Terre expose « Cache du relief (expérimental) ». Le réglage fait partie du schéma commun utilisé
par TARS. Les diagnostics sont disponibles via `__bh.renderer.terrainCacheStats` et `__bh.game.perf().terrainCache`.
Le profilage dispose d'une passe `terrain surface cache`. Une erreur de compilation du préparateur est
rapportée dans `error` ; les métadonnées restent inactives et le traceur conserve la source de référence.

## Vérifications de ce lot

- Vérification TypeScript : `bun run typecheck`, réussie.
- Format/lint sur les dix fichiers TypeScript modifiés : Biome, réussi.
- Compilation des modules WGSL : `bun scripts/check-wgsl.ts`, **23/23 compilent**, adaptateur identifié
  `apple`, en Chrome headless local, y compris la composition avec cache,
  le préparateur et les variantes sans textures de surface/décor/table atmosphérique.
- Vérification de whitespace : `git diff --check`, réussie.
- L'assertion existante sur la taille des tables GPU est adaptée à la nouvelle réservation ; elle n'est pas exécutée.
- Aucun `bun test`, e2e, vol de mesure, capture comparative ou benchmark de jeu lancé.

La compilation ne vérifie pas l'exécution des passes, les bind groups, la fidélité géométrique, les transitions
temporelles ou les performances. Aucun gain de FPS, de résolution ou de qualité n'est déclaré acquis.

## Travail restant avant activation permanente et terrain raster

1. Mesurer l'erreur verticale et des normales sur une référence synthétique, puis le relief réel : pentes,
   côtes, crêtes, bords de fenêtre, passages d'empreinte, antiméridien et chargements. Définir un seuil d'erreur
   projetée ; adapter le cache ou le rejeter là où il ne le satisfait pas.
2. Évaluer la stabilité en mouvement et les raccords aux pistes, à la marche, aux ombres et aux reflets.
   La lecture bilinéaire et les fondus spatiaux ne garantissent pas à eux seuls l'absence d'artefacts.
3. Comparer le coût total, préparation et renouvellement d'historique compris, à résolution et bloc identiques
   sur le M1 Max. Une quantité de nœuds bornée ne garantit pas un budget en millisecondes.
4. Définir les bornes d'erreur et la sélection des patches, produire normales/bornes, puis raccorder le terrain
   raster à la profondeur, au mouvement et aux appareils existants. Les mesures P0 restent à relever.

Les nuages dédiés, les forêts à 10–20 km et la reconstruction plus fine restent des lots ultérieurs du plan.
Le réglage temps réel ×4 et les valeurs de qualité par défaut ne sont pas changés par ce sous-lot.
