# Plan — longueur du trou de ver et continuité de la carte 3D

Date : 2026-10-06. Branche analysée : `test-kimi`, commit `a452eb7`.
Statut : P1 à P5 appliqués ; résultats et limites de validation consignés en fin de document.

## Objectif et décision de dimensionnement

La zone présentée à l'utilisateur comme **l'intérieur du tunnel** doit correspondre à sa longueur
propre dans le modèle actuel :

- rayon de gorge : `rho = whRho` ;
- longueur totale : `L = whLength * rho = 2a` ;
- limites : **`-a <= ell <= +a`** ;
- progression : `(ell + a) / (2a)`, bornée entre 0 et 1 ;
- distance restante vers Gargantua : `max(a - ell, 0)` pendant la traversée ; vers notre système :
  `max(ell + a, 0)`.

« Réelle » signifie ici la longueur définie par les paramètres du modèle Dneg implémenté, pas une
longueur mesurée d'un objet astronomique. `whLength` est un rapport, pas une distance en M.
Les conversions en kilomètres et secondes doivent utiliser la masse courante du trou noir.

**La zone de carte vide doit disparaître.** La longueur physique détermine le badge et la vue locale
de traversée, pas une interdiction d'afficher les données du système.

Ne pas remplacer `rGlue` par `a`, ni `lGlue` par `a` : ce sont des limites de raccordement de la
métrique et du traceur. Elles n'ont ni la même signification ni, pour `rGlue`, la même coordonnée.

## Diagnostic établi

### 1. Une zone de raccordement prise pour le tunnel physique

`wormhole.ts:dneg()` définit déjà `a = 0.5 * whLength * rho`. Le rayon est constant pour
`abs(ell) <= a`, puis la bouche s'évase suivant la fonction `radius()`.

`mouth()` définit indépendamment une sphère de raccordement :
`rGlue = max(min(max(8*rho, rho+12*M_lensing), 0.3*D, 0.8*distanceDisque), 2*rho)`.
`lGlue = ellOfR(w, rGlue)` convertit ce rayon en distance propre longitudinale.

Cette enveloppe laisse l'évasement et la lentille se développer avant le passage à Kerr. Elle ne
décrit pas la longueur du cylindre. L'évasement tend asymptotiquement vers un espace plat : il n'a
pas une seconde « longueur réelle de bouche » finie qu'on pourrait déduire sans critère de tolérance.

Pour les scènes terrestres (`rho=0.05`, `whLength=0.01`, `whLensing=0.05`, masse `1e8 M_solaire`) :

| Grandeur | Valeur |
|---|---:|
| Longueur physique totale `2a` | 0.0005 M |
| Demi-longueur `a` | 0.00025 M |
| Rayon de raccordement `rGlue` | 0.4 M = 8 rho |
| Limite longitudinale `lGlue` | 0.3605267435623243 M |
| Rapport `lGlue/a` | environ 1442 |
| Traversée totale du cylindre à vitesse radiale 0.01 c | 24.63 s de simulation |
| Du centre à la sortie physique à cette vitesse | 12.31 s |
| Du centre à la sortie du raccordement à cette vitesse | environ 4 h 56 |

Ces durées supposent une vitesse radiale constante, sans détour ni accélération ; elles ne sont
pas un ETA universel pour une trajectoire oblique. Dans ce modèle, la longueur totale correspond
à environ 73.8 millions de km : les paramètres actuels ne sont pas les dimensions du film.
Ce plan ne redimensionne pas les scènes ni le rayon `rho`.

Calculs complémentaires effectués : `whLength` = 0.001, 0.01, 1, 10, 20. À paramètres restants
constants, `lGlue-a` reste environ 0.3602767 M. Le supplément actuel dépend essentiellement du
rayon et de la lentille, et domine la longueur des tunnels courts.

### 2. Coupure confirmée dans le navigateur

Contrôle par positions imposées dans une scène terrestre, simulation figée ; il vérifie le contrat
de télémétrie et la mise à jour réelle de l'interface, pas une traversée complète sous autopilote.

| ell | Région actuelle | `FlightInfo.ref` | `FlightInfo.X` | Centre de carte |
|---|---|---|---|---|
| -0.01 M | throat | sun | disponible | Soleil |
| 0 M | throat | null | null | Soleil conservé |
| +0.01 M | throat | null | null | Soleil conservé |
| +lGlue | throat | null | null | Soleil conservé |
| lGlue + 0.001 M | hole | null | disponible | Gargantua |

Aucune erreur JavaScript enregistrée pendant ce contrôle. Log local :
`/tmp/wormhole-map-audit.log`. Les corps Gargantua existent bien dans `theirScene()`.

Chaîne causale :

1. `onOurSide()` cesse d'être vrai à `ell >= 0` ; `ourNav()` ne fournit plus la position solaire.
2. `flightInfo()` ne remplit la position Gargantua qu'en région `hole`.
3. `Map3D.draw2d()` efface la carte puis retourne avant de construire la scène et de synchroniser
   l'interface, tant que la région est `throat` sans navigation solaire.

### 3. Défauts associés et limites de preuve

- **Reproduit :** centre et fil de navigation Soleil conservés dans la zone positive vide.
- **Établi par lecture :** menu ouvert non reconstruit au changement d'univers ; sa reconstruction
  dépend de l'ouverture, de la recherche ou de `setFocus()`.
- **Établi par lecture :** aperçu, lecture temporelle et durée manuelle conservés au changement
  d'univers ; certains caches et requêtes asynchrones ne portent pas d'identité de traversée.
  Un mauvais affichage causé spécifiquement par ces états n'a pas encore été reproduit.
- **Établi par lecture :** `predictPath()` ne produit aucune trajectoire en Dneg positif ; la
  prédiction Kerr est coupée à l'entrée dans `rGlue`. Les plans et prédictions ne possèdent pas
  de représentation commune des segments dans les deux univers et dans le tunnel.
- **Nouveau constat :** `theirScene()` utilise `rGlue` comme rayon visible du corps « trou de ver » ;
  `ourScene()` utilise une constante `0.05`. Les deux bouches ont donc des dimensions cartographiques
  incohérentes entre elles et avec `whRho`.
- **Nouveau constat :** dans le cylindre, `dr/dell = 0`. Une projection cartésienne sur une sphère
  de rayon `rho` ne permet pas de retrouver `ell` et masque la progression longitudinale. Les
  composantes physiques de vitesse ne sont pas la dérivée de cette projection.
- **Nouveau constat :** `game/status.ts` classe encore toute la région Dneg positive « IN THE THROAT ».
  Réparer uniquement la carte laisserait les instruments et phases de vol incohérents.
- **Cas distinct :** certains presets classiques ont `system=none`. Leur carte n'inclut pas les
  planètes du système complet. Ne pas les activer automatiquement pendant un passage.
- La condition qui masque la carte remonte au 27 septembre ; elle précède les corrections de
  l'ellipsoïde et du contrôle du warp.

## Plan d'implémentation

### P1 — Un contrat commun pour la géométrie et l'affichage

Créer une classification pure, réutilisable, à partir de la pose propre `(ell,n)` et des paramètres
du trou de ver. Elle doit distinguer explicitement :

- domaine d'intégration actuel (Dneg ou Kerr), sans en modifier les limites ;
- zone physique : intérieur du cylindre, évasement de notre côté, évasement Gargantua, extérieur ;
- univers de présentation : notre système pour `ell < -a`, Gargantua pour `ell > a`, traversée
  pour `-a <= ell <= a` ;
- longueur, progression et distances longitudinales en unités cohérentes ;
- référentiel de chaque position et vitesse exposée.

À l'intérieur, conserver le contexte d'entrée pour la carte globale et afficher une vue locale
de traversée. En cas de chargement direct dans le cylindre, fournir un contexte déterministe
(signe de `ell`, puis sens longitudinal du mouvement à `ell=0`, puis valeur par défaut documentée).
Le vaisseau arrêté à `ell=0` reste affichable. Le passage de la sortie `+a` ou `-a` déclenche la
transition de carte, indépendamment de `lGlue`. Définir précisément les bornes et les tolérances
numériques relatives aux échelles ; pas de marge fixe en M qui agrandit les tunnels courts.

Fichiers concernés : `wormhole.ts`, contrat de télémétrie, consommateurs de carte/statut.

### P2 — Continuité de position et dimensions de la bouche

Fournir une pose cartographique dédiée plutôt que réutiliser implicitement `X/ref` comme test
d'univers. Auditer les consommateurs de ces champs avant tout changement de leur sémantique :
statut orbital, navball, docking, son, phases, ordinateur, rendu et plans.

Sur la sortie positive encore en Dneg, calculer la projection autour de la bouche avec
`repToHole()`, son centre au bon instant, et les transformations de directions existantes.
Une projection sert à dessiner : elle ne devient pas un état Kerr fictif pour les calculs d'orbite.
Conserver séparément vitesse physique, vitesse de projection et vitesse relative à une cible.
Inclure le mouvement de la bouche et `dr/dell` lorsqu'une dérivée cartographique est nécessaire.

Dans le cylindre, conserver `(ell,n,v_rep)` comme état de référence. Montrer la progression dans
une vue longitudinale locale ou un encart ; ne pas inventer une position cartésienne inversible.
La carte globale reste visible avec un marqueur explicite de traversée à la bouche.

Passer les paramètres de géométrie aux deux constructeurs de scène. Dessiner le rayon de gorge
`rho` des deux côtés ; représenter éventuellement l'enveloppe de raccordement en contour technique
distinct, jamais comme la surface ou le rayon physique. Les zones cliquables minimales restent
définies en pixels, séparées des dimensions du monde. Distinguer rayon de gorge, longueur propre
et zone de lentille dans les cartes au survol.

Fichiers concernés : `controller/telemetry.ts`, `ui/map3d/scene.ts`, `ui/map3d/map3d.ts`.

### P3 — Transition complète de l'interface

Centraliser le changement de contexte de carte. Lors du changement d'univers :

- remettre l'aperçu à « Maintenant », arrêter sa lecture et restaurer une durée automatique ;
- invalider trajectoires prolongées, marques temporelles, survols, poignées et interactions en cours ;
- reconstruire menu ouvert, fil de navigation, centre, légende, unités et actions applicables ;
- remettre le centre et le cadrage en état cohérent avec le système d'arrivée ;
- conserver les préférences indépendantes du référentiel (qualité, langue, choix de vue enregistré).

Les réponses de worker doivent porter un identifiant de génération/contexte incluant univers,
géométrie pertinente et état de départ. Rejeter une réponse tardive de l'ancien contexte sans
la réinjecter dans les caches. Ne pas libérer un verrou d'une nouvelle requête avec la fin d'une
ancienne. Invalider les traces par référentiel explicite plutôt que par un simple saut de distance.

Une cible de l'autre univers peut rester un objectif de mission, mais ses distances et directions
ne doivent pas être calculées comme si elle appartenait à la scène courante. Afficher sa situation
et l'action disponible ; ne pas supprimer silencieusement le plan de vol ni remplacer la cible.

Le badge « Dans le tunnel », les phases, les messages de franchissement et la présentation du
statut utilisent les limites `±a`. Le centre `ell=0` reste un événement distinct de la sortie.
La fin d'une accélération de traversée doit être auditée avec le contrôleur du warp existant :
aucune écriture concurrente ni perte du choix utilisateur ; conserver le plafond de sécurité tant
que la dynamique Dneg l'exige, même après la sortie physique du cylindre.

Fichiers concernés : carte, `ui/flighthud.ts`, `game/status.ts`, `game/phase.ts`,
`controller/piloting.ts`, télémétrie et caches du contrôleur.

### P4 — Prédiction cohérente dans le tunnel et à ses sorties

Créer une prédiction segmentée portant, pour chaque segment, le domaine physique, le référentiel,
des instants explicites et les états nécessaires au raccordement. Aucun trait direct entre deux
univers exprimés dans des coordonnées différentes.

Réutiliser les équations et conversions de vol existantes : navigation solaire, intégration Dneg,
transformations avec la bouche mobile, puis Kerr. Extraire si nécessaire un noyau de propagation
pur partagé entre le vol et le worker ; éviter un deuxième simulateur avec des équations divergentes.
Gérer les deux directions, le demi-tour, les trajectoires obliques qui rebondissent et le vaisseau
arrêté. Le raccord doit respecter position, orientation, vitesse physique et horloge dans les
conventions du modèle courant.

Localiser les événements par sous-pas ou interpolation contrôlée : `-a`, `0`, `+a`, et les frontières
d'intégration existantes. Ne pas supposer qu'une image à fort warp ne franchit qu'une frontière.
Enregistrer les temps réels des échantillons ; ne pas conserver un `dt` uniforme fictif si les
échantillons du raccord deviennent adaptatifs.

Tracer uniquement les segments appartenant au référentiel affiché, avec les entrées/sorties et
la continuation annoncée sur la frise ; l'encart de tunnel porte la partie longitudinale.
L'aperçu doit suivre ces mêmes segments. Les apsides et coniques ne s'appliquent qu'aux segments
compatibles ; aucun calcul Kerr dans le cylindre.

Identifier le référentiel et les préconditions des nœuds/plans. Suspendre avec explication une
commande devenue inapplicable, plutôt que réinterpréter son delta-v dans l'autre univers. Préserver
les missions qui ont explicitement une étape après la traversée. Aucun nouveau solveur d'optimisation
de mission n'est requis pour rétablir la continuité des données et des prédictions.

Worker avec limites de durée et de pas explicites, résultat partiel marqué comme tel, motif de
terminaison lisible et génération de contexte. Une prédiction en attente ou limitée ne doit jamais
masquer les corps ni la position actuelle.

Fichiers concernés : `controller/lowthrust.ts`, `controller/plan.ts`, propagation pure,
`system/plan-worker.ts`, types de chemins, frise et rendu des chemins de la carte.

### P5 — Validation et documentation

Tests purs :

- longueur exacte et classification aux bornes pour `whLength` 0.001, 0.01, 1, 10, 20 ;
- variations de `rho`, largeur de lentille, masse du trou noir et bouche fixe/mobile ;
- tunnel physique indépendant de `rGlue`, continuité des conversions aux raccords, vitesses finies
  et sens conservé à `dr/dell=0` ;
- projection non inversible dans le cylindre traitée explicitement ;
- requêtes tardives, traces et plans d'un autre contexte rejetés ou suspendus correctement ;
- mêmes événements et états à pas fin et à pas grossier, dans les deux directions.

Tests navigateur avec le vrai rendu :

- traversée complète Soleil → Gargantua → Soleil, avec simulation et commandes de vol réelles ;
- positions contrôlées juste avant/après `±a`, `0`, `±lGlue`, carte ouverte puis fermée ;
- vaisseau arrêté dans le cylindre et dans l'évasement positif : carte toujours renseignée ;
- menu ouvert, cible éloignée, aperçu en lecture, plan existant et worker en attente au passage ;
- warp manuel/hub, auto/assisté, fort warp qui saute plusieurs frontières dans un pas ;
- minimap, plein écran, mobile, WebGPU et repli Canvas 2D ;
- presets complets et classiques, chargement/sauvegarde dans le tunnel, réglage de longueur en direct ;
- contrôle des erreurs JavaScript/GPU et comparaison visuelle des deux bouches.

Pour la prédiction, comparer ses états à un vol sans poussée à des instants communs, avec une
tolérance justifiée par convergence des pas et précision des transformations, puis vérifier le
budget CPU/worker. Pas de simple comparaison d'une fonction avec sa propre implémentation.

Vérifications générales : typecheck, tests ciblés de géométrie/vol/missions/carte/warp,
build, lint ; compilation WGSL et comparaisons visuelles si les interfaces du rendu changent.
Actualiser `docs/MAP.md` et l'aide : longueur physique, projection dans le tunnel, limites de
la prédiction et différence entre sortie du tunnel et sortie du domaine Dneg.

## Critères d'acceptation et ordre de livraison

1. **P1 + P2 :** tunnel borné par `±a`, deux bouches dimensionnées avec `rho`, carte renseignée en
   permanence. Pour le preset terrestre, le badge de tunnel couvre exactement 0.0005 M ; la carte
   ne disparaît plus sur les 0.3605 M après le centre comme actuellement.
2. **P3 :** aucun état Soleil résiduel à l'arrivée Gargantua, aucune réponse tardive ou trace mélangée,
   statut et warp cohérents ; choix et plans de l'utilisateur conservés ou suspendus explicitement.
3. **P4 :** trajectoire de traversée et aperçu continus par segments, événements horodatés et
   raccords validés contre le vol dans les deux sens.
4. **P5 :** scénarios navigateur passés, absence d'erreurs, documentation et preuves consignées.

Le défaut ne sera considéré entièrement réglé qu'après ces quatre livraisons. Réduire seulement
le message « Dans le trou de ver » ou forcer `region=hole` ne satisfait pas ces critères.

## Limites à respecter pendant les corrections

Le raccord Dneg/Kerr actuel est une convention du simulateur ; ce plan ne prétend pas démontrer
une solution globale des équations d'Einstein. Ne pas modifier sa géométrie ou la dynamique du vol
pour contourner une restriction de carte. Si un défaut du raccord apparaît dans les tests de
continuité, l'isoler et le documenter avant de changer cette convention.

Conserver les réglages de scènes, les calculs ellipsoïdaux terrestres et le halo solaire demandé.
Le plan couvre l'analyse et les corrections à venir ; il n'autorise pas un commit ou un push.

## Réalisation et preuves — 2026-10-06

### Corrections livrées dans le workspace

- **P1 :** `tunnelState()` centralise les bornes, la longueur propre et la progression ; les deux
  bouches de carte utilisent `rho`. Aucun réglage de preset, rayon de raccord ni shader modifié.
- **P2 :** `wormhole-map.ts` fournit une pose d'affichage séparée de la pose physique. La carte
  garde les corps visibles dans le cylindre et les évasements. La progression intrinsèque apparaît
  dans un encart ; l'univers d'entrée reste mémorisé, y compris dans les sauvegardes v2.
- **P3 :** menus ouverts, aperçu, frise, traces et caches sont réinitialisés au changement de
  contexte. Les réponses worker tardives sont rejetées par génération. Le statut distingue tunnel
  et proximité de la bouche ; la restauration du warp respecte une modification manuelle.
- **P4 :** prédiction libre segmentée Dneg/Kerr, horodatage adaptatif, événements intrinsèques,
  limites explicites de pas et délai worker de 15 s. La carte affiche les échecs et résultats
  partiels. Les nœuds incompatibles sont conservés et suspendus, sans réinterprétation du delta-v.

Les validations ont révélé un dépassement du raccord sortant dans l'intégrateur du vaisseau :
un grand pas Dneg continuait au-delà de `lGlue` avant de passer à Kerr. Le noyau partagé
`wormhole-flight.ts` arrête désormais le pas sur l'événement et restitue son temps réel ; la poussée
est recalculée pour cette durée. Le raccord entrant utilise un arrêt adaptatif à la bouche mobile
puis une recherche de l'événement. Les paramètres et transformations des métriques sont conservés.
`Sim.step()` remet aussi l'horloge de bouche à jour après l'intégration.

### Validation

- Géométrie : longueurs 0.001 / 0.01 / 1 / 10 / 20, rayons variables, bornes exactes et
  positions/vitesses finies au centre et aux raccords.
- Traversée radiale dans les deux sens : entrée/centre/sortie à 0.075 / 0.100 / 0.125 M pour
  le scénario court ; aucune interpolation entre univers.
- Prédiction comparée au vrai `CameraController.fallStep` pendant 80 M : erreur cartésienne
  inférieure à `1e-6 M` pour une bouche fixe ; inférieure à `1e-5 M` avec bouche mobile dans les
  deux directions, à pas 0.025 M et 0.2 M. Ce sont des tolérances numériques de ces scénarios.
- Grand pas Kerr de 100 M : arrêt à la bouche en moins de 2 M. Poussée Dneg bornée par le temps
  réellement écoulé. Trajectoire oblique manquant la gorge : aucun faux événement de traversée.
- Réponse tardive après changement de géométrie rejetée ; manœuvres suspendues dans le cylindre
  et dans l'autre univers sans perdre les nœuds ; sauvegardes anciennes toujours acceptées.
- Navigateur : aller-retour, menu ouvert, aperçu en lecture réinitialisé, arrêt au centre puis
  sauvegarde/rechargement. Carte peuplée dans l'évasement positif avant le raccord Kerr.
- Écran 390 × 844 avec échec injecté des pipelines GPU de la carte : repli Canvas peuplé.
- Régression hub warp auto/assisté : réussie. Aucun échec JavaScript dans ces scénarios navigateur.
- Traversée navigateur complète des raccords Dneg/Kerr sortant puis entrant, avec carte toujours
  peuplée : réussie. Placement en mission puis à la bouche lointaine : deux tests réussis.
- Suite générale : **399 réussites, 0 échec**, 35 221 assertions ; les tests navigateur restent
  désactivés dans cette commande et sont exécutés séparément. Typecheck et build réussis.
- Lint des nouveaux modules et tests : aucun diagnostic. Lint des fichiers existants modifiés :
  aucun échec, 18 avertissements et une information sur du code existant, sans nettoyage hors sujet.
- Le test d'approche lunaire a dépassé son délai de freinage lors d'une première exécution avec
  d'autres contrôles en cours. Il réussit ensuite isolément sur le commit d'origine et sur la
  version corrigée. Aucune régression confirmée ; ce délai reste sensible aux conditions du test.

La documentation de fonctionnement est actualisée dans `docs/MAP.md`. Ces validations n'équivalent
pas à un essai sur tous les GPU physiques ni à une preuve du modèle relativiste global.
