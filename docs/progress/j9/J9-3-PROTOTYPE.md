# J9-3 — Premier dessin dans le monde, non accepté

20 novembre 2026. **Prototype derrière `renderer.nearTreeGeometryOn = false` par défaut.** Les douze modèles KTG1 sont
chargés une fois, puis dessinés par instances indexées, sélectionnées par le GPU dans 80 m. Aucune nouvelle cible de rendu.
[Captures et graphique](geometry-mini.html), [échantillons et compteurs](geometry-mini-samples.json).

Le fragment rejette le masque des cartes avant d'écrire sa profondeur. La visibilité conserve la distance du sol en r,
l'index de grille en g et la distance de surface en b. Sous code 0 : bit 17 de a pour la géométrie, normale octaédrique
2×8 bits, bit 16 pour la feuille ; la fraction du float32 porte l'ombrage local sur 64 niveaux. Le lecteur prend cette
surface, son matériau et sa normale dans la chaîne lumière/air commune, sans marcher la grille ou retester le houppier.

La liste proche est bornée (4 096 instances par modèle) : un dépassement est compté et retourne au tri existant des proxies.
Les arguments sont bornés avant les dessins indirects ; le pied et les paramètres viennent de la forêt publiée. Les buffers
et pipelines restent au renderer, détruits avec le décor. Les axes et hauteurs sont ceux du repère WGS84 existant ; aucun
nouveau placement ou tirage de population. Les modes toujours tracés ne perdent pas leurs arbres.

## Observé sur le mini

Trois vues A/B/A, mêmes dimensions et qualité (sortie 1920×1080, interne 1440×810, ombrage 1/1, borne 30) :

- Maures au sol, format final : **67,7 → 54,0 → 66,3 ms** p50 ; 49 instances de géométrie en B, 0 en A ;
- Maures à 60 m AGL, première version du format : **62,3 → 61,2 → 60,2 ms** ; aucune instance dans 80 m dans ce champ,
  donc aucune attribution de gain à la géométrie ici ;
- Chamonix pente, première version du format : **69,5 → 58,5 → 70,1 ms** ; 19 instances en B.

Sources : `20261120-105255-j9-geometry-aa` (Maures, 30 assertions) et
`20261120-103717-j9-geometry-other-views` (46 assertions), exit 0 ; tous les relevés thermiques sont Nominal.
Les autres vues précèdent l'amélioration de précision du stockage (7 → 8 bits par normale ; 4 → 64 niveaux d'ombrage).
Le premier run `20261120-103247-j9-geometry-try` reste archivé, pas présenté comme le code final.

**L'image change et reste insuffisante** : les feuilles proches sont beaucoup trop claires face à la forêt suivante.
Ni gain à image égale ni budget soutenu validé. La matière et l'ombrage local doivent être étudiés, sans multiplier
arbitrairement une couleur pour masquer le raccord. Les captures ont été regardées et montrées dans T3.

## Vérifications du contrat

- Une lecture simultanée visibilité/profondeur/identité a trouvé 75 600 pixels de géométrie, tous avec profondeur valide
  et identité écrite ; 23 sans distance de sol dans la visibilité. Ce comptage ne valide pas à lui seul l'occlusion entre
  deux arbres ni un parcours contre le ciel.
- Témoin de dépassement injecté : capacité 1, 44 refus aux Maures et 14 à Chamonix ; capacité normale, zéro refus ;
  éteint, zéro instance de géométrie. Le tri des proxies conserve son rôle de repli.
- Témoin de dessin manquant : les instances sont sélectionnées mais `debugSkip = 1` retire leur dessin ; la sonde voit
  zéro pixel de géométrie. Un A/A de deux copies du même état GPU, dans la même soumission, donne un écart nul
  du comptage. Les lectures GPU de diagnostic sont hors des fenêtres de mesure.
- WGSL final : `20261120-104520-j9-geometry-precision`, 84/84 shaders Apple, variantes sans décor comprises. Le premier
  contrôle `20261120-103118-j9-geometry-wgsl` a échoué (79/84) sur leurs stubs manquants, corrigés ensuite.
- Le témoin essayé à pitch +35° (`20261120-104048-j9-geometry-surface`) a échoué sur zéro instance : ce champ ne contient
  aucun arbre dans le domaine proche. L'assertion n'a pas été assouplie ; la sonde a été rejouée dans le champ qui en contient.
- Typecheck, Biome, inventaire pipeline et 18 tests ciblés passent. Références pipeline, BH-API et catalogue tenues.
  Le contrôle BH-API a aussi ouvert sa page locale automatiquement ; aucun chiffre M1 Max n'en est utilisé.

## Suite avant toute bascule

J9-2 reste ouvert pour les LOD utiles. J9-3 reste ouvert pour le complément objet/contre-jour et l'acceptation du
matériau. J9-4 doit traiter le raccord de représentation (la limite à 80 m est brute), les saisons, le vent et le mouvement ;
J9-5 les ombres réellement découpées et le contact ; J9-6 la préparation/PWA et la reprise. La carte d'ombre actuelle reste
celle des proxies ; l'identité locale conserve le contrat existant à 20 bits, sans résoudre ses collisions globales.
La marche en raster n'est pas activée ; aucun ancien chemin n'est retiré avant acceptation.

## Deuxième lot — Occlusion mesurée et portée étudiée

20 novembre, sur `5581f777` avec les modifications de ce lot. [Captures interactives](occlusion-mini.html),
[échantillons](occlusion-mini-samples.json). La portée de diagnostic `J9_REACH` entre dans chaque échantillon ; le prototype
garde **80 m et reste éteint par défaut**. Aucune bascule à 300 m.

L'isolement `debugTreeId` intervient dans le fragment **après le tri** : positif, l'arbre est masqué ; négatif, seul cet
arbre est conservé ; zéro, dessin normal. Les autres arbres sélectionnés ne redeviennent pas des proxies opaques.
Le témoin compare trois copies indépendantes de la visibilité : scène complète, arbre isolé, scène sans cet arbre.
Aux recouvrements, l'identité et la distance doivent correspondre à la surface la plus proche ; dans les ouvertures
encadrées par le premier arbre sur la même ligne, la seconde couronne doit garder son identité et sa distance.
Tolérance de distance : 2 mm ; lectures hors fenêtres chronométrées, ressources GPU et snapshots libérés.

- Premier choix rejeté : `20261120-110941-j9-geometry-occlusion`, arbre dominant au bord inférieur sans seconde géométrie
  recouverte ; zéro recouvrement, assertion conservée. Le choix se fait ensuite sur une ouverture observée dans la vue.
- À 80 m, `20261120-111156-j9-occlusion-selected` passe, 37 assertions : 2 212 recouvrements sans erreur, mais **un seul pixel**
  de seconde couronne dans un trou ; ce témoin trop étroit ne suffit pas à juger la lisibilité.
- Contrôle renforcé dans le champ à 300 m, choix privilégiant une seconde couronne plus éloignée :
  `20261120-111404-j9-occlusion-dense`, **37 assertions**, exit 0 en 90,9 s. Arbre local 1 230 205, seconde couronne 1 230 208 :
  **811 pixels de recouvrement**, **130 pixels dans les ouvertures**, zéro mauvaise identité/distance. A/A du comparateur nul ;
  +1 m injecté dans les distances complètes détecté. Thermique : 17 relevés, tous Nominal ; aucune erreur GPU/console.
  Cela prouve ce couple et ce contrat de surface, pas toute l'acceptation AAA ni les objets derrière les arbres.
- Extension brute à 300 m : `20261120-110620-j9-geometry-reach300`, 30 assertions, 818 instances ;
  **67,3 → 81,4 → 66,2 ms** p50 GPU, même qualité et dimensions que la référence, 16 relevés Nominal.
  Le contrôle renforcé retrouve 81,4 ms. Les LOD utiles sont nécessaires avant toute extension ; l'image reste différente.
- `20261120-110912-j9-occlusion-wgsl` : 84/84 shaders Apple. Typecheck, Biome, inventaire pipeline et les 18 tests ciblés
  passent. Aucun gain à image égale ni performance soutenue revendiqués. Le matériau trop clair reste à résoudre ; la portée
  seule ne fournit pas une solution acceptable au raccord.
