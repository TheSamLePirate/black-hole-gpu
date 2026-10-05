# Implémenter un système solaire à l’échelle dans Unity

Ce document est une spécification d’architecture et d’implémentation destinée à un développeur ou à un LLM. Il décrit comment construire un système solaire conservant les dimensions physiques réelles, avec un vaisseau de quelques mètres, un terrain planétaire accessible et un télescope permettant d’observer les corps éloignés.

Les principes viennent du projet `black-hole-gpu`. Les adaptations proposées pour Unity, notamment le rendu distant en coordonnées projetées, constituent une architecture à implémenter et à valider, pas un portage déjà testé.

## 1. Objectif et périmètre

Construire une simulation dans laquelle :

- les rayons, distances, vitesses et durées correspondent aux valeurs physiques ;
- les planètes et les lunes occupent des positions déterminées par la date ;
- un vaisseau de 10 mètres peut voler et se poser sur Terre ;
- le terrain et le vaisseau restent stables malgré les distances astronomiques ;
- depuis la Terre, une caméra peut suivre Pluton avec un champ de vision réduit ;
- les transitions entre surface, orbite et espace conservent les états physiques ;
- une carte de navigation peut afficher des marqueurs agrandis sans changer la simulation.

Le système solaire ne nécessite pas de trou noir ni de trou de ver. Leur ajout ultérieur demande un rendu et une physique spécifiques.

### Définition de l’échelle

Utiliser les dimensions physiques dans la simulation. Ne pas grossir les planètes pour les rendre visibles et ne pas réduire artificiellement les distances orbitales.

Valeurs de départ :

| Grandeur | Valeur |
| --- | ---: |
| Rayon moyen terrestre | 6 371 000 m |
| Rayon solaire | 695 700 000 m |
| Unité astronomique | 149 597 870 700 m |
| Vitesse de la lumière | 299 792 458 m/s |

Le rayon terrestre moyen sert de référence au prototype sphérique. Un modèle ellipsoïdal et les altitudes géographiques doivent ensuite partager une définition explicite de la surface de référence.

## 2. Règles architecturales obligatoires

1. Les positions et vitesses astronomiques sont des données en double précision indépendantes des `GameObject`.
2. Les `Transform` et `Rigidbody` représentent les objets dans un repère local en mètres.
3. Soustraire les grandes coordonnées et appliquer les rotations en double précision avant de convertir en `float`.
4. Les petits détails proches sont calculés dans un repère local ; les corps lointains utilisent une représentation astronomique dédiée.
5. Un seul système possède l’état dynamique du vaisseau à un instant donné.
6. Un déplacement de l’origine change les coordonnées, pas l’état physique.
7. La carte de navigation ne modifie jamais les dimensions physiques.
8. Le télescope doit avoir un budget d’erreur exprimé en pixels et validé par des mesures.

Une origine flottante protège le voisinage du joueur. Elle ne suffit pas à rendre précise une petite planète située à plusieurs milliards de kilomètres. Le rendu astronomique et la projection au télescope doivent traiter séparément cette situation.

## 3. Choix Unity et unités

Base proposée : Unity 6, C#, Unity Mathematics et HDRP. Fixer les versions du projet avant d’implémenter les appels au pipeline de rendu.

HDRP est une option pratique grâce au rendu relatif à la caméra et aux Custom Pass. Il ne remplace pas le modèle astronomique en double précision. Une autre pipeline est possible si elle propose une intégration équivalente du rendu personnalisé.

Utiliser dans le modèle :

- positions et rayons : mètres ;
- vitesses : mètres par seconde ;
- accélérations : mètres par seconde carrée ;
- temps : secondes en `double` ;
- angles : radians ;
- paramètres gravitationnels : `mu = GM`, en m³/s².

Les meshes et la physique locale utilisent une unité Unity pour un mètre. Les unités relativistes `M` du projet d’origine ne sont pas nécessaires pour cette version solaire.

## 4. Modèle de données

Créer un modèle indépendant de UnityEngine autant que possible :

```csharp
using Unity.Mathematics;

public struct BodyDefinition
{
    public int Id;
    public int ParentId;
    public double RadiusMeters;
    public double Mu;
}

public struct BodyState
{
    public double3 PositionMeters;
    public double3 VelocityMetersPerSecond;

    // Colonnes : axes du corps exprimés dans le repère inertiel.
    public double3x3 BodyToInertial;
}

public struct SpacecraftState
{
    public double3 PositionMeters;
    public double3 VelocityMetersPerSecond;
    public double3x3 BodyToInertial;
    public double MassKg;
}

public interface IEphemerisProvider
{
    BodyState Evaluate(int bodyId, double tdbSeconds);
    bool Covers(int bodyId, double tdbSeconds);
}
```

Séparer les données statiques, l’état évalué à une date, les ressources graphiques et les objets locaux. Les identifiants doivent être stables et les unités explicites.

Ne jamais confondre une position locale Unity et une position astronomique. Sauvegarder la position globale en double ou une position relative à un repère identifié, avec la date et la vitesse nécessaires à sa reconstruction.

## 5. Repères et horloge

### Repère astronomique

Choisir un repère inertiel unique, par exemple barycentrique avec axes écliptiques J2000. Toutes les éphémérides, vitesses et rotations doivent être ramenées à ce repère.

Il est également possible de travailler dans un repère héliocentrique, mais il faut alors traiter son accélération dans la dynamique. Ne pas appliquer silencieusement les équations d’un repère inertiel à un repère accéléré.

Définir une conversion explicite entre les axes astronomiques et les conventions Unity. Vérifier le sens des rotations, les produits vectoriels, les normales et le winding des triangles. Ne pas répartir des permutations d’axes non documentées dans le code.

### Horloge

Maintenir une horloge astronomique en `double` relativement à une époque définie. Distinguer :

- UTC pour l’affichage des dates ;
- TDB pour les éphémérides SPICE ;
- temps de simulation physique ;
- temps/interpolation du rendu.

Convertir UTC vers le temps d’éphémérides avec une routine validée et les données de secondes intercalaires. Une simple différence entre dates UTC ne constitue pas cette conversion.

Ne pas utiliser un temps absolu astronomique en `float` sur le GPU. Transmettre des angles déjà calculés ou un petit temps relatif à une époque proche pour les animations.

## 6. Éphémérides

### Source

Utiliser NASA/JPL DE440 pour les corps couverts, puis des kernels adaptés aux satellites souhaités, comme JUP365 pour les lunes galiléennes.

Les positions des planètes peuvent suivre ces trajectoires prescrites. Il n’est pas nécessaire de recalculer les interactions gravitationnelles entre toutes les planètes pour reproduire ce type de système.

### Préparation hors ligne

Une chaîne de préparation peut lire les kernels SPICE et exporter des fichiers compacts évaluables en C#. Elle doit enregistrer :

```text
version du format
identifiant du corps
identifiant du corps de référence
repère et unités
début et fin de couverture en TDB
durée des intervalles
degré des polynômes
coefficients de position sur les trois axes
précision de stockage
tolérance et erreur mesurée contre les données sources
```

Pour chaque intervalle, ramener le temps à `u` dans `[-1, 1]` et évaluer les polynômes de Chebyshev en double précision. Calculer les vitesses par dérivation, avec le facteur de changement d’échelle du temps.

Conserver les coefficients en double au début. Une compression mixte double/float ne doit être introduite qu’après mesure de son erreur. Vérifier les valeurs et les vitesses aux raccords entre intervalles.

### Centres physiques et barycentres

Le centre d’un système planétaire n’est pas nécessairement le centre de sa planète. Distinguer explicitement le barycentre Terre–Lune et le centre terrestre, ou le barycentre Pluton–Charon et le centre de Pluton.

Utiliser les centres disponibles dans les kernels. Si une correction à partir des satellites est nécessaire, documenter les satellites inclus et l’erreur résiduelle. Éviter les corrections partielles présentées comme exactes.

### Secours

Prévoir un modèle képlérien lorsque les données sont absentes ou hors couverture. Exposer cette situation dans les diagnostics. Ne pas changer silencieusement de modèle au milieu d’une observation précise.

## 7. Bulle locale et origine flottante

Définir une origine `O` en double précision et une matrice orthonormale `Q` dont les colonnes sont les axes locaux exprimés dans le repère astronomique.

```text
positionLocale = transpose(Q) * (positionGlobale - O)
positionGlobale = O + Q * positionLocale
```

Effectuer le premier calcul intégralement en double, puis convertir le résultat local vers Unity :

```csharp
double3 local = math.mul(
    math.transpose(localToInertial),
    globalPosition - globalOrigin
);

transform.position = new UnityEngine.Vector3(
    (float)local.x,
    (float)local.y,
    (float)local.z
);
```

Cette opération est incorrecte pour préserver la précision :

```text
float(positionGlobale) - float(origineGlobale)
```

En vol, recentrer la bulle lorsque le joueur s’éloigne d’un seuil configurable. Pour un prototype demandant des contacts précis, commencer avec une bulle de quelques kilomètres, puis mesurer la précision réelle.

Lors d’un recentrage par translation :

- modifier l’origine globale ;
- déplacer tous les objets locaux de la translation inverse ;
- préserver les vitesses physiques ;
- synchroniser les objets physiques selon le mode de simulation Unity choisi ;
- mettre à jour trails, particules, lignes et caches spatiaux ;
- corriger ou invalider les historiques de reprojection, TAA et motion vectors.

Appliquer la transformation comme une opération coordonnée à une frontière de pas physique. Une rotation ou un changement de vitesse du repère demande aussi une conversion des orientations et vitesses.

## 8. Surface planétaire

### État attaché au corps

Pour un objet posé sur Terre, conserver sa position dans le repère terrestre :

```text
positionGlobale(t) = positionTerre(t) + R_Terre(t) * positionTerrestre
```

Le point suit ainsi la translation et la rotation de la Terre. Le vaisseau ne doit pas glisser parce que le sol est animé indépendamment de son état.

### Terrain local

Construire un repère tangent est/haut/nord autour d’un point de référence terrestre. Dans ce repère, le terrain, les colliders et le vaisseau proche restent exprimés en mètres autour de petites coordonnées.

Conserver la position de référence et les calculs de surface en double. Soustraire l’origine du patch avant de convertir les vertices en float.

### LOD

Utiliser une cube-sphère ou un quadtree sphérique :

- résolution faible pour la planète distante ;
- subdivision selon l’erreur projetée en pixels ;
- haute résolution autour du joueur ;
- colliders uniquement dans le voisinage utile ;
- raccords évitant fissures et changements brutaux.

Le terrain proche et la représentation distante utilisent les mêmes orientations, coordonnées de texture et surface de référence. Un changement de représentation ne doit pas modifier le rayon ou l’altitude.

## 9. Physique du vaisseau

### Vol inertiel

Calculer en double précision :

```text
a(p, t) = somme_i [mu_i * (p_i(t) - p) / |p_i(t) - p|^3]
          + accélérationPropulsion
```

Pour la propulsion, convertir correctement les forces du repère du vaisseau vers le repère de simulation. Mettre à jour la masse si le carburant est simulé.

Choisir un intégrateur adapté : par exemple RK adaptatif avec estimation d’erreur, ou un schéma validé pour le cas visé. Réduire les pas lors des rencontres proches. Ne pas extrapoler la gravitation extérieure à l’intérieur d’une planète : passer à un modèle de contact ou à un modèle intérieur explicite.

Le facteur d’accélération du temps ne doit pas devenir un unique pas démesuré. Définir une politique de sous-pas et limiter le time warp en atmosphère ou pendant les contacts.

### Contacts locaux

Utiliser les Rigidbody et colliders dans la bulle locale pour le train d’atterrissage et les interactions proches.

Définir clairement qui possède l’état :

| Mode | Propriétaire de l’état dynamique |
| --- | --- |
| Vol orbital | Intégrateur astronomique |
| Contacts/atterrissage local | Physique locale, avec reconstruction globale |
| Objet attaché au sol | Coordonnées fixes dans le repère du corps |

Ne pas faire avancer simultanément le même vaisseau avec un intégrateur orbital et un Rigidbody dynamique.

### Conversion des vitesses

Dans un repère dont l’origine a la vitesse `V_O` et qui tourne à la vitesse angulaire `omega`, exprimée dans les axes locaux :

```text
pGlobal = O + Q * pLocal
vGlobal = V_O + Q * (vLocal + cross(omega, pLocal))
```

Si la dynamique est intégrée dans ce repère tournant, inclure l’accélération de l’origine, Coriolis, la force centrifuge et, si nécessaire, le terme d’Euler lié à la variation de `omega`.

Autre option : une bulle inertielle en translation avec un terrain mobile. Elle évite les termes de rotation dans les équations locales, mais impose de gérer la vitesse du sol et des colliders. Choisir une option et la documenter.

## 10. Rendu astronomique distant

Ne pas placer chaque planète distante dans un Transform exprimé en mètres à des coordonnées immenses.

Pour chaque corps visible, produire côté CPU :

```text
position ou direction dans le repère de la caméra
distance physique en double côté CPU
rayon angulaire
orientation visible du corps
direction de son éclairage
texture et paramètres de surface
```

Pour une caméra extérieure à une sphère :

```text
distance = length(positionCorps - positionCamera)
rayonAngulaire = asin(rayonPhysique / distance)
```

Utiliser un rendu dédié intégré à la pipeline : Custom Pass HDRP, compute shader avec composition, ou autre mécanisme équivalent compatible avec les versions retenues.

Pour les petits disques éloignés, une représentation analytique dans le plan de l’image peut reconstruire la normale de surface, appliquer la texture et la phase. L’approximation orthographique du disque est acceptable seulement lorsque son rayon angulaire est petit et son erreur sous le budget fixé. Utiliser un rendu sphérique adapté pour les grands angles et les corps proches.

Éviter une intersection rayon–sphère naïve dont le discriminant soustrait deux énormes valeurs presque égales. Une petite sphère très éloignée peut disparaître à cause de cette annulation numérique.

Les distances physiques restent disponibles pour les occultations. Les profondeurs graphiques choisies pour composer le ciel ne sont pas les distances physiques.

## 11. Télescope et précision angulaire

### Projection CPU en double

Réduire uniquement le champ de vision Unity ne garantit pas la précision du zoom.

Construire les axes `right`, `up` et `forward` de la caméra en double précision. Pour chaque direction apparente normalisée `n` :

```text
x = dot(n, right)
y = dot(n, up)
z = dot(n, forward)

tanV = tan(FOV_vertical / 2)
tanH = aspect * tanV

xNdc = x / (z * tanH)
yNdc = y / (z * tanV)
```

Pour les corps devant la caméra, calculer ces coordonnées en double puis convertir les coordonnées projetées en float. Écarter explicitement les corps derrière la caméra et traiter correctement ceux dont le disque traverse le bord de l’image.

Pour un petit corps proche du centre du champ :

```text
rayonPixels ≈ (hauteurPixels / 2)
              * tan(rayonAngulaire) / tanV
```

Cette formule est une approximation centrale. Pour les corps hors axe ou de grande taille apparente, projeter correctement leur silhouette ; ne pas supposer un cercle de rayon constant partout dans une projection perspective.

Le shader du disque ciblé reçoit les petites coordonnées de l’image et les paramètres de surface. Il ne doit pas reconstruire sa position à partir de grandes coordonnées mondiales arrondies en float.

### Budget de précision

```text
angleParPixel ≈ FOV_vertical_en_radians / hauteurPixels
```

Fixer par exemple une erreur maximale de 0,1 pixel pour le centre suivi. Comparer le rendu à une projection CPU de référence. La limite de zoom dépend de la résolution, des données et des calculs, et doit être mesurée.

Le projet d’origine borne son champ de télescope à 0,02°. Reprendre cette valeur comme point de départ possible, pas comme limite universelle de Unity ni comme preuve de précision suffisante.

Le suivi doit utiliser la même position apparente que le rendu. Une cible instantanée et un corps dessiné avec le retard lumineux peuvent sinon se décentrer.

### Corps non résolus

Si le disque est plus petit qu’un pixel :

- calculer son flux ;
- le filtrer sur une empreinte de pixels ;
- conserver approximativement l’énergie intégrée ;
- effectuer une transition continue vers un disque résolu pendant le zoom.

Ne pas augmenter le rayon physique. Une amplification photographique des points faibles doit être un paramètre de rendu distinct. Des détails de surface ne peuvent pas être prétendus résolus lorsque le disque reste inférieur à un pixel.

## 12. Rotation, lumière et occultations

Utiliser les modèles d’orientation IAU disponibles pour les pôles et les méridiens. Aligner les conventions de longitude et les textures. Les satellites sans modèle détaillé peuvent utiliser une rotation synchrone documentée.

Pour l’éclairage :

- calculer la direction du Soleil relativement au corps ;
- conserver la dépendance de l’irradiance en `1 / distance²` ;
- calculer les phases ;
- dessiner les anneaux dans le plan équatorial ;
- traiter les corps occultants et les éclipses selon le niveau de précision visé ;
- intégrer exposition et tone mapping sans modifier la géométrie.

Composer le fond astronomique derrière le vaisseau et le terrain. Le sol et l’horizon doivent masquer les corps qui se trouvent derrière eux. Entre corps lointains, déterminer les occultations à partir de la géométrie et des distances physiques.

Pour un Soleil de taille finie, une éclipse nécessite une couverture de disque et une pénombre ; une source ponctuelle ne suffit pas à reproduire la même apparence.

## 13. Temps de trajet de la lumière

Pour l’observation distante, résoudre :

```text
tEmission = tObservation
            - length(pCorps(tEmission) - pObservateur(tObservation)) / c
```

Procédure :

1. Initialiser `tEmission` à `tObservation`.
2. Évaluer la position du corps à `tEmission`.
3. Recalculer le temps d’émission avec la distance à l’observateur.
4. Répéter jusqu’à une tolérance cohérente avec le budget angulaire.
5. Évaluer position et rotation visibles à ce temps.

Effectuer les calculs dans un repère inertiel commun. Ajouter séparément l’aberration liée à la vitesse de l’observateur si la précision visée le demande.

Le calcul du retard du centre convient aux corps éloignés. Pour un sol proche, ne pas déplacer tout le terrain au temps retardé du centre de la planète : cela pourrait déplacer le sol sous le joueur. Utiliser les états instantanés pour les collisions et une stratégie spécifique pour l’observation proche.

La lumière incidente sur un corps observé peut aussi nécessiter son propre retard et sa géométrie d’occultation. Documenter les simplifications retenues, surtout pour les éclipses.

## 14. Modules proposés

```text
SolarSystem/
  Data/
    BodyCatalog
    EphemerisAssets
  Simulation/
    AstronomicalClock
    EphemerisProvider
    BodyOrientationProvider
    ReferenceFrameService
    SpacecraftDynamics
  LocalWorld/
    LocalPhysicsBubble
    PlanetSurfaceFrame
    PlanetTerrainStreamer
    SpacecraftContactController
  Rendering/
    AstronomicalRenderPass
    DistantBodyProjection
    PlanetTerrainRenderer
    BodyLighting
    OccultationSolver
  UI/
    TelescopeController
    NavigationMap
    PrecisionDiagnostics
  Validation/
    ReferenceStates
    PrecisionTests
    ScenarioScenes
```

Les calculs astronomiques doivent être testables sans démarrer le rendu. La carte réutilise les états physiques, puis applique ses propres transformations d’affichage.

## 15. Boucle d’exécution

### À chaque pas physique

1. Avancer l’horloge selon les sous-pas autorisés.
2. Évaluer les positions nécessaires à la dynamique.
3. Avancer le vaisseau avec le propriétaire d’état actif.
4. Résoudre les contacts si ce mode est actif.
5. Reconstruire l’état global si la physique locale a avancé.
6. Appliquer les changements de repère nécessaires.

### Avant le rendu

1. Déterminer le temps de rendu et interpoler les états proches.
2. Évaluer les états astronomiques à ce temps.
3. Construire le repère de caméra en double.
4. Évaluer les positions apparentes retardées des corps éloignés.
5. Mettre à jour les meshes locaux et le terrain.
6. Calculer les coordonnées projetées des corps distants en double.
7. Transmettre au GPU les données locales ou projetées.
8. Composer corps distants, terrain, atmosphère, vaisseau et interface.

Ne pas interpoler entre des coordonnées appartenant à deux repères différents sans conversion préalable.

## 16. Ordre d’implémentation

### Étape A — Modèle astronomique minimal

Soleil, Terre et Lune ; dimensions réelles ; horloge ; positions déterministes ; conversions de repères. Un modèle orbital simplifié est acceptable ici s’il est identifié comme tel.

### Étape B — Vaisseau et précision locale

Vaisseau de 10 mètres, état global en double, rendu local, recentrage de l’origine et diagnostics de précision.

### Étape C — Surface terrestre

Patch sphérique simple, repère terrestre, rotation, colliders proches et vaisseau posé. Ajouter ensuite relief et streaming.

### Étape D — Corps éloignés

Ajouter Pluton, son diamètre apparent, son disque ou son flux subpixel et ses occultations par le sol.

### Étape E — Télescope

Suivi, champ variable, projection en double avant transfert GPU, réticule et mesures d’erreur en pixels.

### Étape F — Données astronomiques complètes

Intégrer les éphémérides validées, les orientations et le temps de lumière. Vérifier la couverture et les transitions de modèles.

### Étape G — Qualité visuelle

Atmosphères, textures détaillées, anneaux, éclipses et exposition. Mesurer les coûts avant d’optimiser.

## 17. Critères d’acceptation

Créer une scène déterministe avec un vaisseau de 10 mètres posé sur Terre et Pluton suivie au télescope. Enregistrer la date, le lieu, la résolution, le champ de vision et les paramètres de rendu.

| Vérification | Résultat attendu |
| --- | --- |
| Rayons et distances | Valeurs physiques sans facteurs de grossissement cachés |
| Éphémérides | Écart inférieur à une tolérance documentée contre des états de référence |
| Raccords des éphémérides | Continuité des positions et vitesses dans la tolérance |
| Conversion de repères | Aller-retour de position et vitesse dans le budget numérique |
| Changement d’origine | Aucun changement de l’état global, saut de contact ou saut visible significatif |
| Vaisseau posé | Position terrestre stable pendant la rotation et la translation de la Terre |
| Terrain | Pas de fissure ni changement d’altitude au passage des LOD |
| Taille apparente | Accord avec une projection de référence en double |
| Suivi du télescope | Erreur inférieure au seuil fixé, par exemple 0,1 pixel |
| Corps subpixel | Flux filtré et transition continue vers le disque résolu |
| Occultations | Sol, horizon et corps proches masquent correctement les corps derrière eux |
| Temps accéléré | Erreur orbitale contrôlée et time warp limité pendant les contacts |
| Changements de mode | Position et vitesse physiques conservées entre vol, contacts et attachement |

Tester plusieurs directions de visée : les erreurs peuvent dépendre de l’orientation des axes. Tester plusieurs tailles de fenêtre et des recentrages pendant le suivi. L’erreur numérique du rendu et l’incertitude des éphémérides doivent être rapportées séparément.

Pour une orbite de validation autour d’un corps fixe, comparer la période, le rayon et la dérive d’énergie à une solution analytique. Ce test ne doit pas être remplacé par une simple vérification que le vaisseau reste à l’écran.

## 18. Erreurs fréquentes à éviter

- Placer le système entier dans des Transform en mètres à coordonnées immenses.
- Convertir les positions globales en float avant de soustraire l’origine.
- Penser que HDRP rend la simulation et les contacts double précision.
- Croire qu’une origine flottante résout à elle seule le télescope vers Pluton.
- Recentrer les meshes sans les colliders ou les historiques du rendu.
- Donner un temps absolu astronomique en float aux shaders.
- Confondre centres physiques et barycentres.
- Confondre UTC et TDB.
- Oublier la vitesse de rotation du sol au décollage.
- Intégrer le même vaisseau avec deux systèmes physiques.
- Réduire les distances pour contourner le clipping puis perdre les tailles apparentes.
- Mélanger les profondeurs graphiques et les distances physiques d’occultation.
- Amplifier le diamètre d’une planète subpixel au lieu de filtrer son flux.
- Présenter un zoom illimité comme une garantie de précision.

## 19. Références du projet d’origine

Ces fichiers sont utiles si le dépôt `black-hole-gpu` est disponible au développeur :

| Fichier | Principe à étudier |
| --- | --- |
| `src/system/solar.ts` | Catalogue, unités, positions, rotations et temps de lumière |
| `src/system/de440.ts` | Lecture et évaluation des éphémérides compactes |
| `scripts/build-ephemeris.ts` | Préparation hors ligne des données |
| `src/system/timescale.ts` | Conversions temporelles |
| `src/system/orientation.ts` | Orientations astronomiques |
| `src/system/scene-bodies.ts` | Données des corps et soustraction de l’origine avant stockage float |
| `src/system/local-patch.ts` | Rendu proche dans un repère local |
| `src/system/our-side.ts` | Gravitation du vaisseau |
| `src/system/our-surface.ts` | État et interactions proches d’une surface |
| `src/shaders/trace.wgsl` | Rendu des corps, terrain, éclairage et filtrage subpixel |
| `src/ui/telescope.ts` | Informations et réticule du télescope |

Le repère d’origine du projet est lié au trou de ver et ses unités sont relativistes. Ne pas recopier ces choix sans convertir les équations et données vers les conventions retenues pour Unity.

## 20. Documentation officielle

- [Unity Mathematics : double3](https://docs.unity3d.com/Packages/com.unity.mathematics@1.3/api/Unity.Mathematics.double3.html)
- [Unity : Vector3](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/Vector3.html)
- [Unity : Rigidbody.position](https://docs.unity3d.com/cn/6000.0/ScriptReference/Rigidbody-position.html)
- [HDRP : rendu relatif à la caméra](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/Camera-Relative-Rendering.html)
- [HDRP : Custom Pass](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/Custom-Pass.html)
- [Unity : Compute shaders](https://docs.unity3d.com/6000.0/Documentation/Manual/class-ComputeShader.html)
- [NASA/JPL NAIF : SPK Required Reading](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/spk.html)
- [NASA/JPL NAIF : SPICE Time Subsystem](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/time.html)

Vérifier la documentation correspondant aux versions Unity et HDRP effectivement utilisées. Les conventions et formats des données doivent être vérifiés avant toute intégration.

## 21. Instructions à donner au LLM implémenteur

Implémente cette spécification progressivement. Commence par une tranche fonctionnelle Soleil–Terre–Lune–vaisseau, puis ajoute le terrain et Pluton au télescope. Déclare les unités, repères, limites et versions utilisées. Fournis les scripts, shaders, données minimales, scènes de validation et instructions de lancement nécessaires à une reproduction.

Conserve les états astronomiques en double précision. Calcule en double les coordonnées locales ou projetées avant conversion vers Unity ou le GPU. Sépare explicitement physique orbitale, contacts locaux, terrain proche, rendu distant et carte. Vérifie chaque transition avec des références indépendantes.

Si une donnée ou une fonctionnalité est remplacée par une approximation, indique son domaine de validité et sa tolérance. Ne présente pas des placeholders visuels comme une simulation astronomique validée. Ne garantis pas une absence totale d’erreurs flottantes : mesure l’erreur et borne les usages selon le budget retenu.
