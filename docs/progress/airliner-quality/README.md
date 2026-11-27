# Avions de ligne : émissions, surfaces et occlusion — 27 novembre 2026

[Galerie interactive](index.html) : chaque représentation isolée, vue trois-quarts humide,
vue arrière avec occultation par la cellule, puis traînées moteur à 11 km.
Les PNG sont des captures du jeu ; aucun effet n'a été ajouté aux images.

Modèles : A320 articulé, CRJ900 FGAddon articulé, Boeing 737-800, 747-400, 777-200ER,
777-300ER, et A320 simple (fallback LOD, affiché ici pour l'A321). La galerie ne prétend
pas que l'A321 ou les autres familles de substitution ont un maillage spécifique.

Le scénario `tests/e2e/airliner-fx.e2e.test.ts` vérifie les sources de condensation,
les segments envoyés au renderer, deux sorties moteur (quatre pour le 747), le train
rentré et une vitesse air >190 m/s avant les captures de croisière. Le METAR est une fixture
saturée (15/15 °C), pas une mesure météorologique du jour. Les poses sont issues de rapports
synthétiques ; ce n'est pas un essai certifiant les performances de vol.

Le test `traffic-trails` utilise les fonctions de shader de production pour la profondeur
instanciée et les rubans : témoin visible (156 pixels), masqué (0), bord coupant le ruban
(78 visibles du côté libre, 0 derrière le bord), sans erreur GPU. Le contrôle des lampes
est indépendant (`traffic-lamps`). Le test mathématique WGS84 réfute l'ancien repère radial.

Changements : repère commun maillages/émissions, profondeur de chaque silhouette articulée
avant les traînées, adresse du gréement A320 préservée, CRJ et Boeing articulés via leurs
arbres FGAddon, normales tournées avec les pièces, LOD par pièce, émissions de volets liées
aux triangles mobiles. Vitrage et chrome distingués et feux CRJ aux points XML.

Limites : la profondeur des effets conserve sa demi-résolution ; une inspection artistique
exhaustive de tous les angles et toutes les conditions n'a pas été faite. Pas d'A/B de coût GPU.
Les canaux de charge, compression et contraintes locked-track non importés ne sont pas reconstitués.
Le fallback Airbus simple est destiné aux petites silhouettes. Les familles sans modèle dédié
restent des substitutions. Aucun nouveau cockpit ou modèle de vol CRJ/Boeing.

## Vérifications finales

99 tests ciblés passent (36 399 assertions). `bun run check` compile 86/86 WGSL sur Apple.
`airliner-fx` complet : 21 captures, 62 assertions ; CRJ repris après correction des groupes
nommés : 43 assertions. `traffic-trails` et `traffic-lamps` : 12 assertions, zéro erreur GPU.
Le contrôle A/A des rubans est identique. `airport-experience` : 41 assertions.
Un lancement groupé a rencontré le délai de 120 s du verrou Chrome dans le beforeAll des
lampes ; la reprise indépendante passe. Aucun gain GPU n’est déduit de ces essais.

## Carlingues et vitrage (reprise rapprochée)

Sept captures supplémentaires `skin-*.png`, vue Aile : garde contre la profondeur non publiée,
triangulation concave des contours AC3D, teinte des vitres CRJ harmonisée.
Deux tests Python de triangulation et 13 tests Bun passent. `AIRLINER_SKIN=1 bun run e2e airliner-fx`
passe : 62 assertions, zéro erreur GPU. Les sept images ont été inspectées, sans trou visible
dans ces vues. Le contrôle global compile 86/86 shaders. Cela ne couvre pas tous les angles possibles.

### Rectification : moteur A320

L’inspection précédente avait manqué les trous des décals de nacelle. Leur rectangle était écrit
intégralement dans la prépasse de profondeur, puis leur alpha était rejeté au dessin. Le matériau
105 est désormais exclu de cette prépasse. Capture a320-engine-before.png conservée,
a320-engine-after.png reprise et inspectée ; le test GPU vérifie ce cas avec le depthVs de production.
