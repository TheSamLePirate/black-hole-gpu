# Audit du passage à l’ellipsoïde WGS84

Date : 6 octobre 2026. Branche : `test-kimi`, HEAD `699a27c`.
Migration examinée : `393335e354a9c249adcf484fce26cdb06706a397`.

## Corrections et validation — 6 octobre 2026

Les six défauts identifiés ci-dessous sont corrigés dans les modifications locales de `test-kimi`, à partir de `699a27c`. Les sections suivantes conservent le diagnostic initial : leurs exemples décrivent le comportement **avant correction** et leurs numéros de ligne renvoient à cette révision.

| Domaine | Correction réalisée | Vérification |
| --- | --- | --- |
| Carte | Conversion avec le rayon réel du corps et latitude géodésique | Terre, Lune et Mars ; sol et orbite ; pôles et Burgos |
| Altitude du rendu | Hauteur et normale géodésiques communes pour exposition, ombres et seuils | 0 à 400 km, axes caméra tournés ; nuages désactivés à 40 km au pôle |
| Terre sans textures | Identité, forme et atmosphère indépendantes de la disponibilité des images ; matériau de secours | Rendu réel sans cartes au pôle à 0, 40 et 400 km ; zéro erreur GPU |
| Verticales locales | Normale géodésique pour caméras, HUD, atterrissage et guidage ; repères orbitaux radiaux conservés | Caméra au sol et attitude orthonormale, rentrée complète assistée |
| Limbe terrestre | Occultation ellipsoïdale à source finie pour le vaisseau et l’ISS | Solution analytique polaire à 400 km ; parité CPU/GPU ; courbe sphérique préservée |
| Éclairage et atmosphère | Directions, normales, hauteurs et longueurs physiques cohérentes ; Soleil, Lune, mer et nuages | Calculs exécutés sur le GPU, sept latitudes et deux hauteurs |
| Pistes | Origine et déplacements physiques en mètres, surface WGS84 et tangentes géodésiques | Parité CPU/GPU sur les sept pistes, seuils et bords inclus |
| Télémétrie et rentrée | Hauteurs géodésiques aux apsides, recherche de hauteur minimale pour la classification, cible de burn adaptée | Orbites circulaires/inclinées/elliptiques ; scénario de désorbitation puis rentrée assistée |

Les dessins orbitaux utilisent désormais un rayon explicite : ils ne déduisent plus le rayon du corps d’une hauteur géodésique. Les prédictions de franchissement de l’atmosphère et les indications de vol suivent également la figure. L’anticrénelage du disque solaire reste conforme au choix explicite de l’utilisateur.

### Résultats de vérification après correction

- Suite CPU complète : **383 tests réussis, 152 tests E2E ignorés, 35 070 assertions, aucun échec**.
- Nouveaux tests CPU des consommateurs : **10 tests, 552 assertions**, inclus dans la suite complète.
- Tests GPU ciblés (helpers réels WGSL, rendu sans textures et éclipse de Burgos) : **3 tests réussis, 258 assertions**.
- Désorbitation manuelle au signal puis rentrée assistée : **1 test E2E réussi, 6 assertions**, scénario complet en 177 secondes.
- Contrôle visuel supplémentaire de Burgos à 18:29:01 UTC : totalité et horizon visibles, altitude du trépied de **893 m**, aucun message d’erreur GPU ou navigateur. Le halo volontaire du disque solaire est conservé.
- **9 shaders sur 9 compilent**, vérification TypeScript et build réussis. Biome ne rapporte aucune erreur ; ses avertissements existants dans le dépôt restent hors de ce correctif.

Commandes :

```sh
bun test --timeout 180000
E2E=1 bun test tests/e2e/ellipsoid.e2e.test.ts tests/e2e/eclipse-atmosphere.e2e.test.ts
E2E=1 bun test tests/e2e/assist-entry.e2e.test.ts
bun scripts/check-wgsl.ts
bun run typecheck
bunx biome ci .
bun run build
```

### Limites des modèles conservés

La diffusion et les colonnes atmosphériques restent un modèle approché de rendu. Les longueurs et normales physiques ont été corrigées, mais cela ne constitue pas une intégration atmosphérique exacte. La hauteur locale utilisée par le terrain GPU reste celle du modèle de surface existant, proche de la hauteur géodésique (environ 5 cm d’écart à 10 km, 2 m en orbite basse).

L’occultation à source finie utilise une tangente locale au limbe et un disque uniforme ; elle conserve cette approximation pour les petites sources. L’éclairage réfléchi de la Terre sur l’ISS utilise une calotte sphérique comme borne d’intégration, puis intersecte réellement l’ellipsoïde et emploie ses normales. Les apsides demeurent les extrema de distance de l’orbite de Kepler ; leur hauteur affichée est géodésique, et la classification recherche séparément la hauteur minimale sur une orbite liée lorsque nécessaire.

WGS72 reste volontairement utilisé par SGP4. Les autres corps et les mondes de Gargantua restent sphériques. Les validations GPU ont été exécutées sur le GPU Apple disponible ; elles ne constituent pas une validation matérielle sur tous les appareils.

## Diagnostic initial — avant correction

**Le passage à l’ellipsoïde a eu des impacts ailleurs. La migration reste incomplète.**
La géodésie centrale, le placement, les altitudes physiques et les collisions ont été adaptés. Mais plusieurs consommateurs conservent les unités ou les hypothèses de l’ancienne sphère. Deux défauts importants sont reproduits numériquement : les positions sur la carte et les altitudes utilisées par le rendu. D’autres incohérences sont établies par lecture des chemins CPU/GPU.

Lors de la phase initiale, cet audit ne modifiait pas le code de production. L’anticrénelage du disque solaire, conservé volontairement à la demande de l’utilisateur, est exclu des correctifs proposés.

## 1. P1 — Positions et trajectoires terrestres mal projetées sur la carte

**Source : `src/ui/groundtrack.ts:51–56`.**

`onMap()` appelle `cartToGeodetic(1, f, q)`. Or `q`, issu de `toBodyFixed()`, est exprimé en unités géométriques M : le rayon terrestre vaut environ `0.00004319`, pas 1. Le convertisseur interprète donc une position terrestre comme un point très proche du centre d’un ellipsoïde de rayon 1.

La latitude obtenue peut sortir du domaine attendu ; sa reprojection avec `fromLatLon()` retourne alors une direction dont la longitude est inversée.

| Position réelle, hauteur 0 m | Position affichée par le calcul actuel |
| --- | --- |
| 0°, −3,7° | ≈ 0°, 176,3° |
| 28,615°, −3,7° | 0,1770°, 176,3° |
| 42,34°, −3,7° | 0,2489°, 176,3° |
| 45°, −3,7° | 0,2613°, 176,3° |
| 80°, −3,7° | 0,5557°, 176,3° |

Les pôles exacts constituent un cas particulier qui ne révèle pas le défaut. Les autres corps, avec `f = 0`, utilisent directement `unit(q)` et ne sont pas affectés par cette erreur.

**Étendue :** marqueur du vaisseau, historique, trajectoires libres et planifiées, candidats, rentrée, ISS et autres vaisseaux. L’altitude affichée dans la même vue utilise déjà `b.radius` correctement : la bonne altitude ne prouve donc pas que la position cartographique est juste.

**Correction :** passer `solarBody(id)!.radius` au convertisseur, ou normaliser explicitement `q` par ce rayon. Ajouter des tests de l’intégration cartographique, incluant l’équateur, Burgos, les deux hémisphères et une position à 400 km.

## 2. P1 — Le rendu continue à calculer une altitude sphérique

**Sources : `src/renderer.ts:2097`, `1985–1992`, `3591–3600`.**

`near.centre` contient une distance physique en unités du demi-grand axe. Il n’est pas aplati à ce stade. La formule `(length(near.centre) − 1) × EARTH_RM` mesure donc une hauteur au-dessus de la sphère équatoriale, et non au-dessus de l’ellipsoïde.

| Latitude | Altitude géodésique | Altitude utilisée par le rendu |
| --- | ---: | ---: |
| 28,615° | 0 km | −4,873 km |
| 42,34° | 0 km | −9,656 km |
| 45° | 0 km | −10,647 km |
| 90° | 0 km | −21,385 km |
| 45° | 40 km | 29,352 km |
| 90° | 40 km | 18,615 km |

**Conséquences établies par les consommateurs :**

- Les nuages volumétriques et les vagues, activés sous 30 km, restent activés à 40 km aux latitudes élevées.
- Les transitions d’intensité des lumières urbaines et du ciel nocturne interviennent à des hauteurs incorrectes.
- `earthSunlight()` transmet une altitude négative à `sunThroughY()`. Avec un Soleil au zénith et sans éclipse, la transmission calculée au niveau de la mer à 45° vaut 0,479 au lieu de 0,856, soit environ 0,84 stop d’écart pour cette contribution à la mesure d’exposition. Aux pôles, le plancher 0,25 masque une erreur encore plus grande.
- `shadowKeep` utilise également une hauteur et une verticale radiales.

Les chiffres de transmission isolent ce calcul ; ils ne mesurent pas l’exposition finale d’une capture, qui dépend aussi du reste du posemètre.

**Correction :** calculer une fois l’altitude géodésique et la normale physique dans les axes du corps, puis partager ces valeurs entre les consommateurs. Ne pas réutiliser la distance au centre comme altitude.

## 3. P1 — La forme géométrique dépend du chargement des textures

**Sources : `src/shaders/trace.wgsl:3703`, `3803–3804`, `1175–1183`, `5143` ; `src/renderer.ts:2099`, `2193–2194`.**

`isEarth()` exige `earthOn()`, qui teste `P.earth.x`. Le CPU active ce paramètre seulement lorsqu’un niveau de textures terrestres est disponible. `squashOf()` retourne donc 1 tant que ces textures sont absentes, puis `EARTH_AB` après leur chargement. Le CPU conditionne de la même manière l’étirement de `nearCam`.

**Résultat établi dans le code :** avant le chargement, le GPU intersecte une sphère équatoriale ; après, il intersecte l’ellipsoïde. La physique et le placement utilisent déjà l’ellipsoïde. L’écart de surface atteint 21,385 km aux pôles : un observateur physique au sol peut se retrouver à l’intérieur de la sphère temporaire.

Le téléchargement anticipé des images réduit la durée possible du problème sans supprimer cette dépendance. Un téléchargement lent ou un échec reste un cas sensible. L’aspect exact du défaut pendant un échec réseau prolongé n’a pas été reproduit visuellement dans cet audit.

**Correction :** distinguer l’identité géométrique de la Terre de la disponibilité de ses textures. Garder la forme WGS84 dans tous les niveaux de qualité et fournir un matériau de secours. Tester les images retardées, absentes et en erreur, avec un observateur au sol et en orbite polaire.

## 4. P2 — Les caméras au sol conservent une verticale géocentrique

**Sources : `src/system/our-side.ts:333–345`, recherches de `sunEl`/`lookEl` dans `bodyView()` ; `src/controller/piloting.ts:189–214`.**

`bodyGround()` place correctement le vaisseau sur l’ellipsoïde, mais retourne `up = normalize(X − C)`. La normale géodésique existe pourtant déjà dans `figureUp()` et est utilisée ailleurs pour le contact au sol. Le mode tripod conserve aussi une verticale radiale.

Écart mesuré entre la verticale de `bodyGround()` et `figureUp()` : 0,1915° à Burgos, 0,1924° à 45°. Les recherches de longitude correspondant à une élévation solaire ou lunaire utilisent cette même hypothèse sphérique.

**Effet :** nivellement et horizon local légèrement inclinés, élévations et cadrages des presets moins cohérents. Il ne s’agit pas d’un déplacement de 21 km de la caméra : le placement est correct.

**Correction :** utiliser la normale de l’ellipsoïde pour les caméras et les élévations au sol. Garder séparée la convention radiale des repères orbitaux lorsqu’elle est intentionnelle.

## 5. P2 — L’éclairage direct du vaisseau utilise encore un limbe sphérique

**Source : `src/shaders/trace.wgsl:6205–6227`, `keyLight()`.**

La fraction du disque solaire visible est calculée avec `rb = asin(1 / dc)`. L’atténuation atmosphérique suivante utilise bien les axes aplatis, mais ne peut rétablir une lumière déjà supprimée par cette première occultation sphérique.

Exemple analytique d’un observateur à 400 km au-dessus du pôle, sans relief :

- rayon angulaire de la sphère équatoriale : **70,72844°** ;
- rayon angulaire du limbe ellipsoïdal : **70,24762°** ;
- écart : **0,48082°**.

Pour ce cas axial, l’angle correct vaut `atan(a / sqrt(d² − b²))`, avec `d = b + 400 km`. L’écart est significatif par rapport à la taille angulaire du Soleil. Le vaisseau peut rester privé de lumière directe alors que la géométrie ellipsoïdale laisse passer le Soleil. Cette démonstration est analytique ; une capture de ce scénario orbital reste à ajouter.

**Correction :** calculer l’occultation dans la géométrie ellipsoïdale, avec la taille finie de la source. Ce défaut est distinct du choix volontaire d’anticrénelage du disque solaire.

## 6. P2 — Direction lunaire physique utilisée dans les axes aplatis

**Sources : `src/renderer.ts:2157–2171` ; `src/shaders/trace.wgsl:3690–3695`, `3900–3904`, `3935–3940`.**

`P.earth3.xyz` est une direction lunaire physique dans les axes terrestres. `earthMoonlight()` et `earthAir()` la comparent directement à des points, normales et rayons des axes aplatis. Ces produits scalaires mélangent deux espaces.

Le défaut de repère est établi par le code. Son amplitude visuelle n’a pas été mesurée sur une scène nocturne ; il faut éviter de lui attribuer une variation de luminosité chiffrée sans ce test.

**Correction :** définir explicitement l’espace des directions et des normales pour l’éclairage lunaire. Les transformations d’un rayon et d’une normale ne sont pas identiques. Ajouter un cas de Lune proche de l’horizon à moyenne latitude.

## Autres incohérences relevées lors du diagnostic initial

- L’atmosphère est intégrée comme une sphère dans les axes aplatis. `earthAir()` conserve `ds = Δt × AIR.rm` et `h = (r − 1) × AIR.rm`. La longueur physique diffère jusqu’à environ 0,335 % selon la direction. Le traitement exact demanderait aussi une adaptation des colonnes atmosphériques et des normales ; la correction de l’éclipse ne rend pas toute cette intégration physiquement exacte.
- Les pistes sont ancrées de façon cohérente dans les axes aplatis : les déplacements CPU et GPU se compensent au seuil. Il ne faut pas conclure à un grand décalage à partir de leur seul vecteur CPU. Leurs tangentes géodésiques et la métrique de `runwayGrade` à 6 371 km restent des approximations à vérifier sur la longueur entière d’une piste.
- Les valeurs de périapside/apoapside de la télémétrie soustraient toujours le rayon équatorial ; `classify()` et l’estimation initiale du burn de rentrée utilisent un rayon unique. Elles ne représentent pas partout une hauteur géodésique. L’intégration de rentrée utilise cependant bien `env.alt`.
- L’attitude aérodynamique de rentrée reste construite avec une verticale radiale. Son effet sur le guidage doit être mesuré avant de changer cette convention.
- La constante WGS72 du propagateur SGP4 est explicitement documentée dans son fichier et n’est pas un oubli à remplacer automatiquement par WGS84. Les corps autres que la Terre et les mondes de Gargantua restent volontairement sphériques.

## Ce qui a été vérifié favorablement

- Lecture des 27 fichiers touchés par la migration, puis des consommateurs du rayon, des altitudes, des normales et des coordonnées GPU.
- Conversions géodésiques centrale : les tests de retour latitude/longitude/hauteur passent, du sol à la distance lunaire.
- Le terrain CPU et GPU utilisent la hauteur dans les axes aplatis et la latitude géodésique pour les cartes. Les tests de tuiles passent. Le renderer transmet aux tuiles des coordonnées physiques normalisées, pas les coordonnées déjà aplaties de `nearCam`.
- Le placement `bodyFixedOf()` / `groundPointOf()`, les altitudes physiques, le contact au sol et la densité atmosphérique utilisent les helpers adaptés.
- Les collisions du mouvement et de la prédiction utilisent `withinFigure()` ; J2 est appliqué hors de la figure, y compris dans la bande polaire située sous le rayon équatorial.
- Un balayage supplémentaire de 222 positions (latitude tous les 5°, hauteurs −400 m à 36 000 km, longitude 15°, date interne t = 0) donne une erreur maximale d’altitude de 0,348 m pour `altitudeOver()` et de 0,000223 m pour `env.alt`. Les repères polaires utilisés par ces chemins ne sont pas strictement identiques. Ce balayage ne garantit pas ces bornes à toutes les dates.
- Au sol, la hauteur ellipsoïdale dans les axes aplatis du même balayage reste à moins de 2 nanomètres de zéro avant conversion en coordonnées globales. Les tests de contact et de placement complètent ce contrôle local.
- La correction de Burgos reste validée sur le GPU : phase partielle, totalité, absence d’éclipse et équivalence entre les espaces de marche sphérique et WGS84 pour les helpers d’éclipse.

## Validation exécutée lors du diagnostic initial

```sh
bun test tests/ellipsoid.test.ts tests/our-surface.test.ts tests/our-side.test.ts tests/geopotential.test.ts tests/earth-tiles.test.ts tests/place-over.test.ts tests/place-near.test.ts tests/entry.test.ts tests/fleet.test.ts tests/sgp4.test.ts tests/ephemeris.test.ts tests/our-plan.test.ts
E2E=1 bun test tests/e2e/eclipse-atmosphere.e2e.test.ts
bun scripts/check-wgsl.ts
```

Résultats : **49 tests CPU réussis, 4 337 assertions ; 1 test GPU réussi, 15 assertions ; 9 shaders sur 9 compilent sur le GPU Apple.** Aucun échec sur ces vérifications.

Les reproductions chiffrées ont utilisé les fonctions réelles du dépôt et les formules des consommateurs identifiés. Exemple minimal du défaut cartographique :

```ts
const q = bodyFixedOf("earth", 42.34, -3.7, 0);
const g = cartToGeodetic(1, WGS84_F, q); // argument actuel de onMap
const displayedLat = Math.asin(Math.sin(g.lat)) * 180 / Math.PI;
const displayedLon = Math.atan2(
  Math.cos(g.lat) * Math.sin(g.lon),
  Math.cos(g.lat) * Math.cos(g.lon),
) * 180 / Math.PI;
// ≈ 0.2489°, 176.3°, au lieu de 42.34°, -3.7°.
```

Les tests existants valident surtout les helpers et le chargement nominal. Ils ne couvrent pas les contrats erronés de `onMap`, du posemètre ou de l’identité géométrique sans textures. Leur réussite ne permet donc pas de déclarer la migration sans régression, ni de garantir le comportement sur tous les appareils.

## Ordre de correction proposé lors du diagnostic initial (réalisé)

1. Échelle de la carte et tests de positions/trajectoires.
2. Géométrie WGS84 indépendante du chargement et du niveau de qualité des textures.
3. Altitude et normale communes aux consommateurs CPU du rendu.
4. Occultation ellipsoïdale de l’éclairage du vaisseau.
5. Verticales des caméras au sol et repères de l’éclairage lunaire.
6. Tests visuels ciblés : chargement lent/échoué, équateur et pôles, orbite polaire, coucher lunaire, pistes et transitions 15/30/60 km.
