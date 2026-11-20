# J9 — Les arbres proches en vraie géométrie

**Préparé le 20 novembre 2026, à la demande de Sam : « Prépare toi à faire J9 : les arbres proches en vraie géometrie — AAA work ».**
**État : J9 lancé le 20 novembre ; référence J9-0 mini établie ; modèles J9-1 inspectés ; assets partagés et LOD 0/1 J9-2 livrés ; prototype J9-3, raccords/saisons/vent/hystérésis J9-4 et ombres 3D découpées/éclairage/contact J9-5 validés sur le mini. PWA (J9-6) et acceptation/retrait (J9-A/J9-R) restent ouverts. Un commit par phase demandé par Sam.** Lecture du dépôt à `935fb201` ; les modifications déjà présentes
dans le journal et la capture J8 non suivie sont conservées. **Mode : normal**, par défaut selon CLAUDE.md ; le mode speed de J8
ne s'étend pas automatiquement à J9. Ce plan prépare le travail sans fermer J8 ni rouvrir toute la marche en raster.

## 1. Où en sont les plans

- **J1–J3 terminés ; J4 fermé sans atteindre sa sortie ; J5 et J6 fermés**, avec leurs limites consignées. Les décisions d'image de
  Sam restent : ni retrait des petits arbres, ni baisse silencieuse du MSAA ou du contenu pour gagner du temps.
- **J7 en pause** derrière J8 : notamment J7-2 (à-coup de météo encore ouvert), J7-5 (repos au sol), J7-6 (fiche et reprise des 40 ms du mini), J7-R. Ses travaux déjà faits
  ne sont pas à refaire. Le candidat « arbres proches », anciennement appelé J8 dans J7 §4, porte maintenant le numéro **J9**.
- **J8 implémenté en grande partie, validation partielle** : le journal du 17 novembre à 17:30 UTC et la grille VB8 rapportent les
  quatre tracés, jour/nuit, stricts et hors ligne, verts sur kerr-mini ; zéro scène rapide et zéro requête de données en vol,
  recensement plein à 10 km. Le M1 Max reste en échec strict (worker de scène, 19–33 s). Le critère de raccord de luminance n'est
  pas jugé : sa sonde manque de témoin négatif. Des dessins VB/RP restent à examiner ; des changements RP sont postérieurs au
  départ du gros e2e et ne sont pas prouvés par lui. J8-R reste à mener ; RP3 a été explicitement reporté après J8.
- **Végétation V2 réutilisable** : modèles procéduraux, cuisson et lecture d'imposteurs, vent proche. Son en-tête est historique
  (11–12 novembre). J8-8b a depuis ajouté les candidats de forêt en cellules préparées et les a allumés par défaut.

Sources : [journal courant](../progress-to-destination.md), [J7](PLAN-J7-FLUIDITE.md), [J8 §8](PLAN-J8-BATIMENTS.md#8-avancement),
[J5](PLAN-J5-GENERALISATION.md), [V2](PLAN-VEGETATION-V2.md). Ce sont les preuves existantes, pas des mesures refaites ici.

## 2. Ce que J9 doit livrer

De près, un arbre présente un tronc et des branches en volume, des touffes et feuilles découpées dans l'espace, de la parallaxe,
un dessous de couronne lisible et des vides laissant voir **les arbres ou objets derrière**. Les cartes de feuillage sont des
surfaces placées dans la ramure ; un panneau unique tourné vers la caméra ne constitue pas le résultat proche.

L'arbre conserve son pied, sa hauteur, son espèce, sa saison et sa couleur lorsqu'on approche, tourne autour ou traverse un LOD.
La lumière, la transmission bornée, l'air, les ombres et le vent appartiennent au même monde que le sol et les bâtiments.
Le loin reste servi par les imposteurs V2 et la matière de canopée. Une forêt dense ne devient pas une collection de troncs
identiques, de cartes plates visibles ou de houppiers opaques sans ramure.

**Objectif de qualité d'abord.** Le gain éventuel vient du remplacement du tracé des arbres proches, et se mesure sur le coût
complet : tri, sommets, couverture, matériau, lumière, ombres, reconstruction et préparation. Aucun gain n'est établi aujourd'hui.

## 3. Le socle réel et les points d'intégration

| Responsabilité | Existant lu dans le code | Travail J9 |
|---|---|---|
| Modèles | `src/vegetation/tree-model.ts` : `TreeMesh` (positions, normales, UV, écorce/feuille, ombrage local, indices), six sortes × deux proportions ; `treeModel` déterministe | Réutiliser le générateur ; juger et enrichir le contenu proche, préparer LOD et bornes |
| Couverture | `src/vegetation/tree-impostors.ts` : `leafMask`, masque procédural utilisé pour la cuisson | Une définition partagée entre modèle dessiné, cuisson et ombre ; filtrage à l'empreinte |
| Placement | `forest.ts`, `forest-cells.ts`, `forest-assembly.ts` ; candidats KFC1 z 15, grille mondiale de 7 m ; la scène décide encore le pied, l'espèce et la hauteur | Consommer ces arbres, sans nouvelle population ni nouveau tirage au changement de scène |
| Visibilité | `scenery-raster.ts` : `treeOf`, `cull`, listes bornées et dessins indirects ; `proxyVs/proxyFs` dessinent des enveloppes | Sélection géométrie/LOD par arbre, triangles et couverture réelle dans la profondeur finale |
| Matériau | `trace.wgsl` : `sceneryTreeLite` ne teste que l'arbre du proxy ; un trou retombe sur le sol ; imposteurs à partir de 200–300 m | Lire la surface rasterisée du proche sans retester l'enveloppe ni tracer la grille par pixel |
| Champ proche | `renderer.ts` : `nearTreesNow`, `nearTreesRays` ; `trace.wgsl` : `RASTER_NEAR_TREES_M = 80` | Retirer cette responsabilité au noyau des restes pour les arbres effectivement couverts par J9 |
| Vent et ombres | `forest.wgsl` : `forestSwayAt` ; la carte d'ombre est amortie, houppiers proches animés, loin figé | Déformation partagée, mouvement précédent utile ; ombres proches découpées sans redessiner toute la forêt à chaque image |
| Identité | `surfaceId` associe actuellement index local (20 bits) et révision de scène (12 bits) | Ne pas confondre cet index avec une identité mondiale ; prévenir les collisions et invalider l'historique aux changements de publication |

Le budget de listes `CAP` peut tronquer : compter candidats, sélectionnés, dessinés et refusés par LOD. Un overflow n'est jamais
un moyen silencieux de réduire la forêt. Les limites de l'enveloppe de V2 (notamment les palmes, et les grands arbres contenus
dans une demi-cellule) doivent être examinées avant d'étendre les bornes ; agrandir un houppier implique aussi les voisins et
les collisions, dont la marche de grille suppose aujourd'hui une portée d'une demi-cellule.

## 4. Contrats proposés pour l'implémentation

### Données et préparation

- Une seule identité logique : bande/grille mondiale et coordonnées globales, sources et génération explicites. Rotation,
  variante et phase de vent viennent de cette identité, pas de l'ordre d'assemblage. Un LOD ne change ni arbre ni contact.
- Pied et hauteur issus du monde **WGS84**, dans le repère tangent déclaré de la scène/cellule. Réutiliser la conversion du
  sol existante ; ni rayon terrestre moyen ni hauteur MSL prise pour une hauteur ellipsoïdale. Mesurer la dérive entre scènes.
- Modèles et LOD préparés hors de la frame, de préférence au build par Bun ; buffers partagés et instances compactes,
  pas un maillage recopié par arbre. Borner mémoire, préparation et uploads ; garder l'ancienne publication jusqu'à la nouvelle.
- Source, paramètres, version du générateur, masque et LOD forment une révision d'asset. Si un modèle change, sa cuisson
  d'imposteur est invalidée ou régénérée avec lui. La zone PWA doit porter les ressources nécessaires au proche hors ligne.
- J9 ne rend pas les cellules J8 obsolètes par principe : conserver KFC1 si les candidats suffisent. Une nouvelle donnée
  persistante exige un format versionné, la migration/invalidation des caches et les compteurs de `flightReady` correspondants.

### Surface, ombrage et reconstruction

- Tronc opaque ; feuillage découpé avec test de profondeur et écriture de la surface survivante. Un fragment rejeté ne doit
  masquer ni l'arbre derrière ni sa profondeur. Traiter les deux faces des feuilles et la normale sous échelle non uniforme.
- Proposition d'intégration : visibilité et attributs minimaux (normale, UV/matière ou référence permettant leur récupération),
  puis lecteur du matériau proche dans la chaîne matériau/lumière/finition existante. Écrire son layout CPU/WGSL et chiffrer
  les cibles avant le lot J9-3 ; éviter d'ajouter cette logique à tous les noyaux du traceur. Un forward dédié ne serait retenu
  qu'après comparaison complète et avec la même lumière, l'air et les sorties de surface.
- La profondeur finale est celle des triangles conservés ; l'identité, la génération et le mouvement ne sont pas ceux de
  l'enveloppe. Recenser les lecteurs : reconstruction, AO/contact, eau/reflets, export, `surfaceAt` et ombres.
- Le terrain utilise actuellement des cibles de visibilité à un échantillon. Ne pas activer simplement `alphaToCoverageEnabled` :
  WebGPU exige plusieurs échantillons et des attachements compatibles. Commencer par une couverture découpée filtrée,
  vérifiée en mouvement ; si son crénelage impose une autre solution, chiffrer son coût complet et ses résolutions de profondeur
  et d'identité. Le MSAA de l'appareil est une responsabilité distincte.
- LOD piloté par taille/erreur projetée et stabilité, pas par un nombre magique unique de mètres ; hystérésis et raccord
  complémentaire près/loin. Le recouvrement ne double pas l'opacité. Le pied, l'enveloppe et la couverture moyenne restent
  cohérents avec l'imposteur, y compris à contre-jour et en hiver. Les seuils se choisissent en J9-0/J9-4.
- Vent issu de l'horloge acceptée existante ; pied fixe, pose actuelle/précédente, bornes élargies par la déformation maximale.
  Gel, pas, pause, saut de temps ou de caméra invalident/reprennent l'historique selon le contrat commun.
- Les collisions gardent leur propriétaire simulation et leurs exclusions (pistes, routes, bâtiments). J9 ne les remplace pas
  par les triangles de rendu ; tout écart visuel/contact constaté est explicité. Tout réglage produit ajouté reste accessible à
  TARS par les actions métier communes ; les leviers A/B restent des outils de mesure.

### Assets et meshoptimizer

Évaluer meshoptimizer dans la chaîne d'assets, en réutilisant l'[évaluation J3-6](progress/j3/FICHE-J3-6-MESHOPT-2026-11-14.md).
Sa documentation JS expose la simplification pondérée par attributs ; cela ne garantit ni la couverture des feuilles ni la
silhouette d'un arbre. Séparer écorce et cartes, préserver leurs attributs, comparer la simplification des branches et une
réduction structurée des touffes. Ne pas retirer au hasard des feuilles pour atteindre un compte de triangles.

Avant adoption : version npm, licence, API de cette version, Bun/WASM, taille du build et coût de préparation vérifiés.
Rien n'est installé dans cette préparation. Aucun décodeur dans le runtime si seuls les LOD non compressés sont livrés.

Sources officielles lues le 20 novembre 2026 : [WebGPU, multisample state](https://www.w3.org/TR/webgpu/#multisample-state),
[meshoptimizer, API JS](https://github.com/zeux/meshoptimizer/blob/master/js/README.md). Les choix d'intégration ci-dessus sont
des propositions pour notre renderer, pas des garanties de ces bibliothèques.

## 5. Lots et preuves de passage

| Lot | Travail | Preuve attendue avant passage |
|---|---|---|
| **J9-0** | Figer scènes, qualité et coûts sur le code courant ; inventaire des modèles, triangles, couverture et bornes ; contrat des attributs proche | Fiche datée des deux Macs : vol bas des Maures, sous-bois de Chamonix, arbre isolé et deux couronnes superposées ; ablation du poste proche et captures. Fixer les seuils de régression et de coût avant implémentation |
| **J9-1** | Contenu proche : modèles réutilisés puis corrigés, variations déterministes, écorce/feuillage, hiver ; planche des six sortes et deux proportions | Vues du dessus, de côté et du dessous, contre-jour ; ramure et feuilles lisibles à l'échelle du jeu. Bornes réelles et exclusions vérifiées, pas seulement un test de tableaux finis |
| **J9-2** | Chaîne Bun des assets et LOD ; essai meshoptimizer ciblé ; manifest/révision communs avec les imposteurs | Erreur projetée, silhouette et couverture par LOD, mémoire et temps de préparation mesurés ; déterminisme. Aucun travail de simplification dans la frame |
| **J9-3** | Instances GPU depuis la forêt existante ; tri, listes, dessins, surface et matériau proches ; levier A/B temporaire | Les trous montrent la seconde couronne ; profondeur/identité exactes, aucune enveloppe opaque résiduelle ; compteurs d'overflow nuls dans les scènes de référence, coût complet comparé |
| **J9-4** | Raccords LOD ↔ imposteurs, saisons, vent et historique | Approche/recul, rotation rapide et vue du dessous : pas de trou, de double, de saut de teinte ou de traînée. Captures et vidéo des zones de transition |
| **J9-5** | Ombres, lumière commune, contact visuel et reprise | Ombres du feuillage, Soleil rasant, nuit/pluie ; déplacement de scène, pause/pas et saut ; coût et fréquence de mise à jour des cartes. La forêt hors champ continue de porter ses ombres utiles |
| **J9-6** | Préchargement/PWA, publication et ressources GPU bornées ; absence de régression J8 | Même population après rechargement hors ligne ; aucun asset manquant ni donnée réseau ; vol bas soutenu, pas de trou devant. Mesurer à part le worker : la géométrie ne résout pas d'elle-même le retard J8 du M1 Max |
| **J9-A** | Démonstration d'acceptation proche, vol et vues au sol, sur les deux Macs | Tous les critères du §6, planches et courbes montrées dans T3 ; bilan des coûts et limites |
| **J9-R** | Après acceptation de la bascule : retrait au lot suivant du chemin proche remplacé et de son levier | Plus de tracé primaire des arbres raster couverts ; garder le tracé nécessaire aux modes toujours tracés (photo/marche). Références et inventaire pipeline à jour |

Ordre : **J9-0 → J9-1 → J9-2 → J9-3 → J9-4 → J9-5 → J9-6 → J9-A → J9-R**. J9-0 commence par des mesures du proche,
pas par une nouvelle campagne complète J8. Une modification encore active de J8 doit être isolée dans la référence de mesure.

**Plafond historique, pas promesse** : J5-3a rapporte environ 59 ms de restes attribués aux arbres proches à pied à Chamonix
sur kerr-mini (15 novembre). Cela ne s'applique ni à tous les vols ni au code J8 sans nouvelle mesure. Le coût du nouveau dessin
et du sol reste à payer. Un lot sous 1 ms se justifie par sa qualité, sans être vendu comme optimisation de cadence.

## 6. Acceptation AAA et vérification

1. **Géométrie proche réelle.** Tronc, branches et feuillage visibles en parallaxe ; deux arbres superposés et un objet derrière
   servent de témoins d'occlusion. Aucune couronne pleine de substitution dans le domaine déclaré de J9.
2. **Continuité.** Même arbre avant/après assemblage, LOD et rechargement ; mesure pied/sommet et couverture aux raccords.
   Pas de double opacité, de disparition, de saut de teinte ou de variation de densité cachée.
3. **Image vivante.** Sous-bois, hiver, Soleil rasant, nuit et vent fort ; caméra fixe puis mobile, gel et reprise.
   Les nouvelles sondes doivent détecter un défaut injecté et donner un A/A nul avant de fonder un verdict.
4. **Préparation.** Démarrage à froid/chaud, zone hors ligne rechargée, changement de scène et reprise GPU ; compteurs de
   résidence, uploads et refus explicités. La référence J8 de population et de disponibilité reste tenue.
5. **Coût complet soutenu.** Même résolution, qualité et météo en A/B, cadence bornée, thermique stabilisée ; GPU p50/p95/p99,
   temps CPU et images bloquées, mémoire, compilation et chargement. Cibles permanentes : 16,7 ms M1 Max, 40 ms mini ;
   les paliers existants ne deviennent pas ces cibles par rédaction. Aucun seuil de gain J9 n'est inventé avant J9-0.
6. **Preuves visibles.** Captures locales, détails d'occlusion et de raccord, vidéo courte du vol et graphiques dans T3.
   Distinguer implémenté, vérifié statiquement, observé et mesuré pour chaque lot.

Réutiliser les recettes de `forest-impostors`, `forest-wind`, `forest-aaa`, `j8-forest-cells` et la sonde `walk-raster` après
lecture complète de leur code et des guides [E2E](E2E.md)/[E2E-VOLS](E2E-VOLS.md). Les futurs e2e J9 restent ciblés, un Chrome
de test par machine, données prêtes avant vol, conditions réelles de pilotage assertées ; pas de campagne entière par défaut.
Chaque changement de shader passe `check-wgsl`, chaque lot de pipeline tient `GRAPHICS-PIPELINE` et son inventaire ; contrats
`__bh`, TARS et catalogue des tests mis à jour dans les lots qui les changent. Les nouveaux diagnostics n'existent pas encore.

**Marche en raster : évaluation distincte après J9-5.** J5 a aussi mesuré un coût du sol proche et trouvé le personnage fantôme.
Rejouer son témoin si J9 rend la réouverture utile ; ne pas activer `walkRasterOn` par défaut ni déclarer la marche corrigée
sur la seule suppression des rayons des arbres. La marche actuelle garde son chemin tracé tant que son contrat complet échoue.

## 7. Avancement et limites de cette préparation

- **20 novembre 2026 : préparation faite.** Plans, historique récent, pipeline et points d'intégration ci-dessus lus ; sources
  officielles consultées. Plan relié à la carte documentaire, V2 et J7 ; entrée et ligne propres ajoutées au journal.
- Aucun code du jeu changé, aucune dépendance installée, aucun e2e/benchmark ni test de rendu lancé. La qualité des modèles
  proches n'est pas observée dans cette session. Les chiffres historiques ne sont pas remesurés.
- **Premier travail à exécuter : J9-0**, puis la planche J9-1. Les distances, comptes de triangles, variantes, mémoire et coût
  admissible du proche restent à établir sur ces preuves, sans baisser silencieusement le contenu ou les objectifs de Sam.

- **20 novembre, exécution J9-0 :** préparation commitée (`d5a28dea`), inventaire reproductible des douze modèles, sonde de Chamonix et cuisson sur kerr-mini passées. [Référence et limites](progress/j9/J9-0-REFERENCE.md). Le passage M1 Max sous Heavy ne fixe aucun budget. J9-0 reste ouvert pour les autres scènes et les mesures soutenues ; pas de bascule du rendu.

- **20 novembre 09:17 UTC :** référence stricte sur le mini établie (`j9-reference` 50 assertions, A/B/A sur trois vues, Nominal). [Fiche et limites](progress/j9/J9-0-REFERENCE.md) : budget soutenu/M1 Max et témoins isolés reportés à J9-A, pas déclarés validés. Passage au contenu J9-1 sur le mini selon la demande de Sam.

- **20 novembre, J9-1 :** socle de contenu inspecté en géométrie directe (six sortes × deux proportions, trois angles et
  ramure nue), conifères densifiés après la première planche ; masque de feuilles partagé avec V2. [Fiche](progress/j9/J9-1-MODELES.md).
  E2e mini et 84/84 WGSL passent. Le matériau dans le monde, les contacts et le raccord restent aux lots suivants.

- **20 novembre, J9-2 lot assets :** géométrie partagée KTG1 préparée hors frame, manifestes et noms par contenu, réordonnancement
  meshoptimizer au build sans perte de triangles/attributs, codec validé et données Git LFS. [Fiche](progress/j9/J9-2-ASSETS.md).
  L'essai de simplification des branches est conservé mais non livré en second LOD (réduction trop faible dans la plupart
  des cas). **J9-2 reste ouvert pour les LOD utiles** ; le socle permet le prototype J9-3 sans prétendre leur coût maîtrisé.

- **20 novembre, J9-3 premier lot :** le prototype dessine les douze modèles par instances GPU dans le monde, surface et
  profondeur réelles, matériau lu sans marche primaire des arbres couverts ; levier `nearTreeGeometryOn` éteint par défaut.
  [Fiche, captures et mesures](progress/j9/J9-3-PROTOTYPE.md). Trois vues sur le mini ; dernière version aux Maures avec
  profondeur/identité, A/A nul, défaut de dessin et dépassement injectés détectés. 84/84 WGSL et contrôles rapides passent.
  **J9-3 non accepté** : feuillage trop clair, témoins d'occlusion/raccords à compléter ; pas de bascule ni de gain à image égale.

- **20 novembre, J9-3 deuxième lot :** témoin de deux couronnes sur le mini, comparées à leurs dessins isolés ; A/A nul,
  défaut de profondeur injecté détecté. Dans le champ diagnostic à 300 m : 811 pixels de recouvrement et 130 de seconde
  couronne entre les feuilles, sans erreur d'identité/distance ; 37 assertions passent. À 80 m, premier témoin valide mais
  limité à un pixel d'ouverture. [Preuves et limites](progress/j9/J9-3-PROTOTYPE.md#deuxième-lot--occlusion-mesurée-et-portée-étudiée).
  Étendre toute la géométrie pleine à 300 m coûte 81,4 ms sur le mini (818 instances) : **portée normale 80 m conservée**.
  Matériau, objet derrière les arbres, LOD, raccords et J9-4–6/A/R restent ouverts ; prototype toujours éteint par défaut.

- **20 novembre, J9-3 troisième lot :** matériau, gabarit d'enveloppe, rotation déterministe par cellule, volume latéral des
  conifères et témoin bâtiment 3D derrière un arbre proche à 80 m validés sur `kerr-mini` (`20261120-122829-j9-3-full`,
  93 assertions, 43 relevés Nominal ; 84/84 WGSL `20261120-122753-j9-3-wgsl`). À 80 m : A/B/A `67,6 → 54,7 → 66,6 ms` aux
  Maures (432 recouvrements et 19 ouvertures entre arbres sans erreur), `58,0 → 58,0 → 57,6 ms` à 60 m AGL, et
  `69,7 → 57,6 → 69,6 ms` à Chamonix (4 326 recouvrements et 25 ouvertures laissant voir le bâtiment code 62 derrière l'arbre
  `1736718`, sans erreur ; A/A nul et défaut +1 m détecté). [Fiche mise à jour](progress/j9/J9-3-PROTOTYPE.md#troisième-lot--matériau-gabarit-denveloppe-conifères-de-côté-et-témoin-bâtiment-derrière-arbre-à-80-m).
  Prochaines étapes : LOD utiles (J9-2) et raccords/saisons/vent/mouvement (J9-4), puis ombres découpées (J9-5), PWA (J9-6)
  et acceptation/retrait (J9-A/J9-R). Prototype maintenu éteint par défaut jusque-là.

- **20 novembre, J9-2 (LOD utiles) et J9-4 (raccords, saisons, vent et mouvement) :** 24 modèles KTG1 (`trees-v1-b31429154c38b2fd.bin`,
  12 × LOD 0 + 12 × LOD 1, réduction de triangles de **60,1 % à 64,2 %** sur les 12 modèles avec couverture latérale/zénithale conservée à
  mieux que 3,8 %, téléversés dans 2 tampons GPU partagés indexés par `firstIndex`/`baseVertex`), sélection LOD 0 / LOD 1 par erreur
  projetée avec ancre d'hystérésis GPU (`nearDraws.anchor`, bande morte ±5 % + gigue déterministe ±4 %), cuisson d'imposteurs alignée et
  raccord direct à 80 m vers `sceneryTreeImpostor` sans anneau d'enveloppes pleines (`80..200 m`), saisons (automne, ramure 3D nue en hiver
  prolongée par `forestTwigs`), vue sous couronne à 0,8 m AGL et vecteurs de mouvement du vent (`o.mot` nul au repos, actif sous le vent).
  Validés sur `kerr-mini` (`20261120-130901-j9-4-full3`, 129 assertions, 49 relevés thermiques Nominal ; 84/84 WGSL `20261120-125559-j9-4-wgsl`) :
  Maures `67,4 → 53,9 → 66,2 ms` p50 (`2` LOD 0 + `42` LOD 1, hystérésis `33` vs `41`), 60 m AGL `58,7 → 59,3 → 59,0 ms`, Chamonix
  `70,5 → 59,3 → 70,5 ms` p50 (`2` LOD 0 + `16` LOD 1, hystérésis `18` vs `19`). [Fiche J9-2](progress/j9/J9-2-ASSETS.md) et
  [fiche J9-4](progress/j9/J9-4-TRANSITIONS.md). Suite : ombres découpées des arbres proches (J9-5), PWA (J9-6) et acceptation/retrait (J9-A/J9-R).

- **20 novembre, J9-5 (ombres 3D découpées, lumière commune, contact visuel et reprise) :** 12 pipelines `nearTreeShadowVs`/`nearTreeShadowFs`
  (LOD 1, tranches `24..35` de `NearDraws`) alimentées dans `cull` par `nearShadowKeep` avant le test de frustum caméra pour tous les arbres
  dans la sphère proche (`≤ 84 m`, vus ou hors champ), avec repli automatique vers les listes d'ombre proxy en cas de dépassement et maintien
  des ombres de la forêt hors champ au-delà (`903 729` et `1 063 869` texels). Dans `treeShadowAt`, réduction du biais proche à `0,55 m + 1 texel`
  et filtre bilinéaire `2 × 2` (`0,88 m`) fondu vers `3 × 3` entre 55 et 85 m ; ajourage hivernal des houppiers caducs lointains (`kind == 3`).
  Validé sur `kerr-mini` (`20261120-134219-j9-5-full3`, 173 assertions, 53 relevés thermiques Nominal ; 84/84 WGSL `20261120-133411-j9-5-wgsl`) :
  948 trouées ensoleillées découpées dans l'ombre proxy aux Maures (182 arbres d'ombre 3D) et 411 à Chamonix (73 arbres d'ombre 3D), réduction
  d'ombre des feuillus nus en hiver, témoin positif `debugSkip` (`nearOccluded → 0`), `+0` redessin `tsmDraws` au repos/gel, Soleil rasant
  (`05:35 UTC`), crépuscule/pluie (`19:45 UTC`), et alignement des collisions CPU `SceneryContact` (94 et 55 arbres dans 60 m).
  [Fiche J9-5](progress/j9/J9-5-SHADOWS.md). Suite : PWA/hors-ligne et ressources GPU bornées (J9-6), puis acceptation et retrait (J9-A/J9-R).
