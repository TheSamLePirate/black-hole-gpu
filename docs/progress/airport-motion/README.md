# Trafic observé et reconstruction différée — 28 novembre 2026

Observation effective de **14:43:50 à 14:48:50 UTC**, autour de Heathrow (51.4700, −0.4543, rayon 80 km, incluant notamment Gatwick et Farnborough). 21 requêtes espacées de 15 s pendant 300 s, toutes HTTP 200. Source retournée par le relais : **OpenSky Network**. 103 identifiants distincts ; cette source ne renseigne ici ni type, ni immatriculation, ni cap du nez. Les véhicules au sol peuvent figurer dans les résultats : ce n’est pas un décompte certifié d’avions de ligne.

Les positions nouvelles ont un espacement médian de **30 s**, p95 **40 s**, maximum **219 s**. L’âge des positions reçues : médiane **19,2 s**, p95 **161,2 s**, maximum **340,2 s**. 929 occurrences de positions déjà reçues (identifiant et époque identiques à moins de 0,25 s). Un rafraîchissement réseau ne signifie donc pas une nouvelle observation. 11 changements de drapeau sol/air ont été enregistrés : 6 sol → air et 5 air → sol, dans tout ce rayon.

## Défauts isolés dans le lecteur

- `reportAt` refusait d’interpoler au-delà de 30 s, alors que la trajectoire acceptait 120 s. Les propriétés utilisées pour l’attitude ne suivaient donc plus la même époque que la position lors d’une lacune de 40 s.
- Entre un relevé au sol et un relevé en l’air, le lecteur considérait l’intervalle entier comme aérien ; son atténuation de hauteur ne reconstituait pas une phase explicite de roulage.
- Un arrêt déclaré pouvait dériver à cause de la correction de position d’une spline. Le cas SHT18F a produit une pointe de 0,14 m/s dans le replay mathématique malgré des vitesses source nulles.
- La correction spatiale de la spline influençait vitesse et accélération, mais pas le taux de virage transmis à la loi d’inclinaison.

## Corrections

`traffic/observed-motion.ts` reconstruit un décollage **uniquement lorsqu’un futur relevé en l’air est déjà disponible**, sur une même piste et dans des limites conservatrices de durée, de hauteur, de vitesse et d’alignement. Le premier relevé en montée donne une estimation du temps passé en l’air ; avant cela les roues restent au sol. Distance et hauteur utilisent des cubiques monotones, avec vitesses tangentes bornées. Aucun départ n’est inventé à partir d’un avion simplement au parking. Les relevés incompatibles gardent le chemin existant.

Les arrêts déclarés, avec bruit inférieur à 12 m et vitesse ≤ 0,2 m/s, sont ancrés à une observation de leur séquence, sans figer un roulage connu. Les déplacements en taxi continuent de suivre le réseau cartographié lorsque le raccord est possible. Les approches, l’arrondi et la décélération gardent le reconstructeur de piste existant. La courbure corrigée améliore l’attitude sur les trajectoires aériennes ; les champs retardés sont interpolés jusqu’à 120 s.

## Sources et limites

[observations.json](observations.json) conserve trois historiques sélectionnés : SWR46K (départ), BAW93DU (arrivée), SHT18F (arrêt). Attribution du relais conservée ; données observées provenant d’OpenSky Network. Le fichier ne contient pas de type inventé. Dans le test graphique seulement, le modèle **A320** représente SWR46K ; ce choix de représentation ne prouve pas son type réel.

Les 21 réponses brutes et l’analyse intégrale sont conservées localement dans `/tmp/airport-traffic-observation/` (temporaire). Mesures sur cet échantillon de cinq minutes, pas sur une journée ni tous les aéroports. L’instant exact de rotation dans un intervalle sans observation reste une **estimation**, pas une mesure. Le modèle est une reconstruction visuelle contrainte par les observations, pas un nouveau modèle aérodynamique certifié. Les longues pertes de couverture, les pushbacks sans cap du nez et les vitesses de rotation propres à la masse réelle restent incertains. Coût GPU non mesuré.

Tests : `tests/traffic-observed-motion.test.ts` rejoue ces relevés, vérifie le roulage avant la montée, les arrêts, l’interpolation à 40 s et la courbure effective. Les tests de pistes et d’atterrissage existants restent dans la vérification ciblée. Le replay WebGPU fait partie de `airport-experience`.

L’inspection des captures a également corrigé la vitesse verticale de la fiche Airport : elle était projetée sur l’axe haut de l’avion incliné, au lieu de la normale géodésique WGS84. Une montée pouvait ainsi apparaître comme une descente. Le replay vérifie aussi l’affichage positif en montée. L’en-tête de repli reste monté pendant les rafraîchissements, comme le dock caméra, pour conserver les cibles des clics.

Vérification finale : 34 tests ciblés (1 428 assertions), 2 e2e Airport (63 assertions, aucune erreur GPU), TypeScript et Biome passent. [Planche de preuve](index.html), [roulage](roll.png), [montée](climb.png). Coût GPU non mesuré ; la scène de replay a signalé des tuiles relief indisponibles dans la bannière, ce qui interdit d’en déduire une validation exhaustive du terrain de Heathrow.
