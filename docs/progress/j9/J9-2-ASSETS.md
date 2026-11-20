# J9-2 — Géométrie partagée préparée, LOD encore ouverts

20 novembre 2026. Le build Bun produit les douze modèles sans génération ni simplification pendant une frame.
`src/vegetation/tree-assets.ts` définit KTG1 : en-tête versionné, table de modèles (sorte/proportion/LOD, erreur, bornes,
rayon, comptes et offsets), sommets entrelacés de 10 flottants (position, normale, UV, matière, ombrage), indices u32.
La lecture refuse tailles, versions, offsets, indices, bornes ou valeurs non finies invalides et doublons de modèles.

Le manifeste `assets/vegetation/trees-v1.json` porte la révision SHA-256 des sources, le nom du fichier adressé par contenu,
son SHA-256 et ses octets. Le binaire est gzip, placé dans Git LFS selon ASSETS ; les générations antérieures ne sont pas
écrasées. Les données peuvent ensuite être téléversées une fois et instanciées ; elles ne sont pas encore lues par le jeu.
Aucun contrat de disponibilité PWA nouveau dans ce lot.

## Meshoptimizer évalué sur ces arbres

Version npm vérifiée et installée : **1.3.0, MIT**, documentation JS de la version lue :
[API officielle v1.3](https://github.com/zeux/meshoptimizer/blob/v1.3/js/README.md). Bun exécute ses modules JS/WASM après
`ready`. Adoption bornée au build (devDependency) : `reorderMesh(..., true, false)` pour organiser sommets et indices.
Le codec runtime n'importe pas meshoptimizer. Ni simplificateur ni décodeur dans la boucle d'image.

L'essai de simplification ne touche que les branches : cible de 50 %, erreur **relative** 0,002, cartes de feuilles
strictement inchangées. Résultat conservé dans `barkLodStudy` du manifeste : la plupart des modèles restent presque
identiques (plusieurs sans aucun triangle retiré). Seul l'arbuste large baisse sensiblement. L'erreur absolue multiplie
l'erreur relative par l'étendue ; l'attente initiale du test qui les confondait a échoué et a été remplacée par la
vérification exacte du contenu finalement livré, non simplifié.

**Décision : pas de second LOD artificiel dupliquant presque toute la géométrie.** Le fichier livré ne contient que LOD 0 ;
les vrais LOD et leur sélection restent ouverts. Cette étape prépare une responsabilité utile (asset partagé prêt à
charger), pas un gain de GPU attribué à la bibliothèque.

## Preuves et limites

- 6 976 520 octets décompressés, 2 909 376 octets gzip pour le lot courant ; compte et tailles sont des résultats du build,
  pas des temps de chargement ni un gain de performance.
- Les tests comparent exactement chaque triangle et ses attributs à la source après réordonnancement, et injectent versions,
  offsets, indices et NaN invalides ; aller-retour exact des octets et rejet des doublons.
- Deux builds identiques produisent les mêmes octets. Typecheck et Biome passent.
- Reste : LOD utiles, dessin/mesure en jeu, compilation et résidence GPU, PWA. Aucun asset supprimé pour tenir un budget.
