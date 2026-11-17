# Plan — Détails en vol bas, référence FableFlight

**16 novembre 2026 — plan demandé par Sam après l'analyse comparative de FableFlight et BH GPU.**
**État : documenté, proposé pour l'implémentation ; aucun lot de code commencé par cette session.**
La demande présente autorise l'écriture du plan. Aucun jeu, test, benchmark ni script du projet n'a été lancé pour
le produire. Les coûts ci-dessous sont des estimations, pas des gains ou surcoûts mesurés.

**Revu le 16 nov. (~18:00 UTC) par la session d'analyse, à la demande de Sam.** Il est rattaché à PLAN-J8 comme groupe
**J8-VB**. Ce qui change :
- **(a) La donnée existe déjà en France.** Les tuiles BD TOPO z 15 que J8-3 télécharge pour les bâtiments portent
  aussi `troncon_de_route` : largeur de chaussée, nombre de voies, sens, position par rapport au sol, urbain, vitesse,
  accès piéton. Elles portent aussi `troncon_hydrographique` (classe de largeur), `construction_lineaire` et
  `equipement_de_transport`. Les voies se lisent donc au lieu de s'inventer, sans aucun téléchargement de plus (§4.2).
- **(b) VB1 part de la cellule « rue » de J8-L,** livrée depuis la première rédaction (661db914, format `KSC1`). Ce
  n'est pas un nouveau contrat (§3, §5).
- **(c) Ce que l'on voit à l'altitude de J8-A** (§5.2).
- **(d) Le coût se juge en cumul avec J8,** dans la vue de Paris où le mini dépasse déjà sa cible (§6.4, une question
  à Sam).
- **(e) La répartition entre les deux sessions et l'ordre dans J8** (§5).
- **(f) La licence de FableFlight** (MIT, §2).

## 1. But et place dans les travaux

Sam constate qu'en vol bas les routes, lampes, voitures et petits détails de FableFlight sont plus convaincants.
Le but est de reprendre les idées de représentation les plus rentables dans BH GPU, en conservant WebGPU,
la simulation, WGS84, le géoïde, les données et les contrats de surfaces existants.

**Premier résultat proposé :** sur un vol urbain bas, voir des chaussées et trottoirs lisibles, des silhouettes de
véhicules variées, du stationnement plausible, et des lampadaires reconnaissables de près ; conserver une ville
continue en mouvement, de jour et de nuit. Le travail vise la qualité et ne prétend pas accélérer le jeu.

Ce plan complète [PLAN-J8-BATIMENTS](PLAN-J8-BATIMENTS.md), en particulier **J8-L** (lampadaires et voitures dans
toute la vue), **J8-A** (démonstration Paris et Toulon-Hyères) et le préchargement PWA. Il ne les remplace pas,
ne change pas leur priorité et ne réserve pas le numéro J9, déjà associé aux arbres proches. Ses lots portent
le préfixe **VB**. Les distances de détail proposées ici ne sont pas de nouvelles limites de visibilité : le
lointain conserve sa représentation et sa lumière, jusqu'à leur limite utile à l'écran.

Références permanentes : [stratégie](ANALYSE-STRATEGIE-RENDU-2026-11-03.md) §§7, 8, 19, 20 et 24 ;
[pipeline](GRAPHICS-PIPELINE.md) ; [contrat J0](J0-CONTRAT.md). La visibilité raster puis les matériaux en calcul
restent le socle du terrain dense. Un éventuel traitement raster spécialisé des routes ne constitue pas une
réouverture du forward terrestre complet.

## 2. Référence FableFlight : dépôt, dossier et code à relire

- Dépôt : [Rolandjg/fableflight](https://github.com/Rolandjg/fableflight).
- Commit étudié : **`c5f30f5dd6099599404d7084b28ca6c3bc9c236f`**.
- Dossier local du dépôt :
  [repo](/Users/olivierveinand/.t3/scratch/2026-11-16-https-github-com-rolandjg-fableflight-16b455f7/repo).
- Chemin complet : `/Users/olivierveinand/.t3/scratch/2026-11-16-https-github-com-rolandjg-fableflight-16b455f7/repo`.
- BH GPU relu pour cette rédaction : **`70939fb2155889e39ef547f6ff74ca0893d6edd6`**, plus les modifications
  présentes dans le dossier. Le checkout est partagé et évolue : vérifier les fonctions avant chaque lot.

Le dossier de scratch peut disparaître. Les liens GitHub figés ci-dessous permettent de retrouver la référence.
Les numéros de ligne sont des repères de cette lecture ; les noms de fonctions permettent de suivre les évolutions.

| Sujet | Source locale FableFlight | Référence figée et idée utile |
|---|---|---|
| Chaussées, voies, trottoirs, réparations, regards, passages piétons | [common.wgsl:788](/Users/olivierveinand/.t3/scratch/2026-11-16-https-github-com-rolandjg-fableflight-16b455f7/repo/src/shaders/common.wgsl:788) | [road_surface](https://github.com/Rolandjg/fableflight/blob/c5f30f5dd6099599404d7084b28ca6c3bc9c236f/src/shaders/common.wgsl#L788) : coordonnées métriques en travers et le long, détail filtré |
| Rubans routiers et raccord au terrain | [roads.wgsl](/Users/olivierveinand/.t3/scratch/2026-11-16-https-github-com-rolandjg-fableflight-16b455f7/repo/src/shaders/roads.wgsl) | [shader](https://github.com/Rolandjg/fableflight/blob/c5f30f5dd6099599404d7084b28ca6c3bc9c236f/src/shaders/roads.wgsl) : traitement des seuls fragments routiers |
| Largeurs, jonctions, ponts, placement du mobilier | [roads.rs:270](/Users/olivierveinand/.t3/scratch/2026-11-16-https-github-com-rolandjg-fableflight-16b455f7/repo/src/roads.rs:270) | [junctions et build](https://github.com/Rolandjg/fableflight/blob/c5f30f5dd6099599404d7084b28ca6c3bc9c236f/src/roads.rs#L270) : relation entre géométrie, marquages et intersections |
| Stationnement et exclusions | [roads.rs:801](/Users/olivierveinand/.t3/scratch/2026-11-16-https-github-com-rolandjg-fableflight-16b455f7/repo/src/roads.rs:801) | [park_cars](https://github.com/Rolandjg/fableflight/blob/c5f30f5dd6099599404d7084b28ca6c3bc9c236f/src/roads.rs#L801) : véhicules sur les bandes latérales, hors croisements et bâtiments |
| Silhouettes de véhicules | [cars.rs:93](/Users/olivierveinand/.t3/scratch/2026-11-16-https-github-com-rolandjg-fableflight-16b455f7/repo/src/cars.rs:93) | [vehicle et build_models](https://github.com/Rolandjg/fableflight/blob/c5f30f5dd6099599404d7084b28ca6c3bc9c236f/src/cars.rs#L93) : capot, habitacle, vitrage, variantes de proportions |
| Peinture, vitrage et feux | [inst.wgsl](/Users/olivierveinand/.t3/scratch/2026-11-16-https-github-com-rolandjg-fableflight-16b455f7/repo/src/shaders/inst.wgsl) | [shader](https://github.com/Rolandjg/fableflight/blob/c5f30f5dd6099599404d7084b28ca6c3bc9c236f/src/shaders/inst.wgsl) : matériaux simples, reflet de ciel et émissions |
| Mât, potence, luminaire et feux de circulation | [roads.rs:358](/Users/olivierveinand/.t3/scratch/2026-11-16-https-github-com-rolandjg-fableflight-16b455f7/repo/src/roads.rs:358) | [lamp_post et signal](https://github.com/Rolandjg/fableflight/blob/c5f30f5dd6099599404d7084b28ca6c3bc9c236f/src/roads.rs#L358) : silhouettes proches reconnaissables |
| Taches de lumière sous les lampes | [common.wgsl:917](/Users/olivierveinand/.t3/scratch/2026-11-16-https-github-com-rolandjg-fableflight-16b455f7/repo/src/shaders/common.wgsl:917) | [lamp_pool](https://github.com/Rolandjg/fableflight/blob/c5f30f5dd6099599404d7084b28ca6c3bc9c236f/src/shaders/common.wgsl#L917) : lumière locale approximée, sans ombre par lampe |
| Aspect des points lumineux | [lights.wgsl](/Users/olivierveinand/.t3/scratch/2026-11-16-https-github-com-rolandjg-fableflight-16b455f7/repo/src/shaders/lights.wgsl) | [shader](https://github.com/Rolandjg/fableflight/blob/c5f30f5dd6099599404d7084b28ca6c3bc9c236f/src/shaders/lights.wgsl) : cœur, halo court, direction et atténuation |
| Animation et filtrage des voitures | [world.rs:732](/Users/olivierveinand/.t3/scratch/2026-11-16-https-github-com-rolandjg-fableflight-16b455f7/repo/src/world.rs:732) | [update_traffic et car_instances](https://github.com/Rolandjg/fableflight/blob/c5f30f5dd6099599404d7084b28ca6c3bc9c236f/src/world.rs#L732) : séparer simulation, sélection et instances |

**Licence : MIT** (`LICENSE` du dépôt, `Cargo.toml`). Un fragment de code repris garde la notice de copyright et de
licence de Rolandjg, dans le fichier et dans les crédits. Une idée reprise ne demande rien, mais la citer reste l'usage.

Reprendre les idées et adapter les représentations. Ne pas transporter le repère sphérique de FableFlight,
ses constantes de profondeur, sa simulation CPU entière ni ses dépendances graphiques dans BH GPU.
Si du code ou des assets sont effectivement réutilisés, conserver les notices et crédits applicables.

## 3. État de BH GPU vérifié en lecture

| Élément présent | Limite pertinente pour ce plan | Fichiers |
|---|---|---|
| Routes analytiques et décalques | Décoloration synthétique masquée sous les orthophotos nationales de jour (`img.o`) ; marquage proche simple ; grilles à 2 m et 8 m par texel | [trace.wgsl](../src/shaders/trace.wgsl), `liteMaterial`, `sceneryGround`, `scenerySurface` ; [scenery-geometry.ts](../src/system/scenery-geometry.ts) |
| Trafic animé sur le GPU | Caisse de 12 triangles + 8 pour les feux ; quatre classes de grands axes ; morceaux de 250 m au plus recommencés en boucle | [traffic.ts](../src/system/traffic.ts), [scenery-worker.ts](../src/system/scenery-worker.ts) |
| Population routière bornée | 1500 voitures au plus, rayon de préparation de 3 km dans le circuit proche lu ; ces valeurs sont un constat, pas un plafond imposé à J8-L | [traffic.ts](../src/system/traffic.ts) |
| Mouvement des voitures dans la visibilité | Les positions précédentes et le rejet d'historique des grands sauts sont déjà calculés ; ne pas rouvrir le diagnostic ancien « pas de vecteurs de mouvement » | [scenery-raster.ts](../src/system/scenery-raster.ts), `meshVertexAt`, `meshVs` |
| Lampadaires et lumière au sol | 4000 au plus, rayon de préparation de 1,5 km ; mât en ruban et tête, sans potence construite ; grille de lumière de 4 m sur ±1024 m | [streetlamps.ts](../src/system/streetlamps.ts), [scenery-data.ts](../src/system/scenery-data.ts) |
| Décor proche préparé dans un worker | Trafic et lampes sont encore assemblés avec la scène ; enrichir leur géométrie ne règle pas le délai de publication ou les secteurs absents | [scenery.ts](../src/system/scenery.ts), [scenery-worker.ts](../src/system/scenery-worker.ts) |
| **Cellule « rue » de J8-L** (661db914, `KSC1`) | Déjà livrée : préparée en workers depuis les routes OpenMapTiles z 14 (`street-prep.ts`), gardée en cache (`kerr-street-v1`), dans les zones et attendue par `flightReady`. Par enregistrement : les lampadaires (pied, hauteur de tête, classe) et les tronçons de grands axes (extrémités, classe, sens, vitesse, graine). Il n'y a **ni largeur, ni nombre de voies, ni abscisse, ni jonction, ni bande de stationnement**. VB1 l'étend (format 2) plutôt que d'en créer une autre. | [street-cells.ts](../src/system/street-cells.ts), [street-prep.ts](../src/system/street-prep.ts) |
| Cellules préparées pour les bâtiments lointains | Réutiliser les principes et la coordination de J8 ; ne pas supposer que tous les contrats routiers existent déjà dans le format bâtiment | [cell-pool.ts](../src/system/cell-pool.ts), [building-cells.ts](../src/system/building-cells.ts), [building-far.ts](../src/system/building-far.ts) |

Les mesures historiques des [lampadaires Q8/L10](progress/refraction-horizons/Q8.md) (5 novembre, protocole strict,
kerr-mini, 2109 lampes) ne distinguaient pas de coût d'image entre scènes comparables. C'est un résultat sur cette
représentation et ce protocole, pas la preuve d'un coût nul aujourd'hui ou d'une extension gratuite à toute la ville.

Le [pilote forward du sol J1](PLAN-J1-OPAQUE-FORWARD.md) a coûté +13,6 ms dans sa scène de mesure du 11 novembre
sur kerr-mini. Cela exclut de présumer un gain en recopiant tout l'ombrage de FableFlight dans un fragment.
Cela ne mesure pas le coût d'un petit traitement spécialisé des marquages routiers.

## 4. Contrats d'intégration

### 4.1 Couverture, qualité et géodésie

- J8 reste propriétaire de la couverture de la vue. La proximité augmente le détail ; elle ne fait pas disparaître
  les routes, véhicules et lumières utiles au loin. Un feu ponctuel peut rester perceptible quand son luminaire
  géométrique est inférieur au pixel : sa visibilité se juge par sa contribution lumineuse, pas seulement sa taille.
- Conserver WGS84, les hauteurs ellipsoïdales et les conversions MSL/géoïde à leurs frontières existantes.
  Les points restent relatifs à une origine locale avant float32. Une couche peinte n'altère pas le sol physique.
- Les trottoirs du premier lot sont un matériau. Toute vraie bordure ou glissière en volume possède une sémantique
  de contact explicite pour la marche ; aucune modification implicite du support de l'appareil.
- Les mêmes réglages produit restent accessibles par les actions existantes, y compris TARS. Un nouveau réglage
  indispensable doit suivre les contrats de réglages et d'actions communs ; éviter une collection de commandes de debug.

### 4.2 Préparation et résidence

- Réutiliser les tuiles vectorielles déjà acquises et la coordination réseau/PWA ; pas de nouvelle source par défaut.
  **Ce que les données contiennent, vérifié le 16 nov.** sur une tuile BD TOPO z 15 de Toulon déjà en cache
  (`~/.kerr-cache/bdtopo/15/16957/12011.pbf`, une seule tuile ; noms de couches et d'attributs lus, valeurs non relevées) :
  - **en France**, dans la tuile même que J8-3 télécharge et décode pour les bâtiments :
    - `troncon_de_route` (64 tronçons sur cette tuile) : `largeur_de_chaussee`, `nombre_de_voies`,
      `sens_de_circulation`, `position_par_rapport_au_sol` (ponts, tunnels), `urbain`, `importance`, `nature`,
      `vitesse_moyenne_vl`, `acces_pieton`, `restriction_de_largeur` et `restriction_de_hauteur` ;
    - `construction_lineaire` (murs, clôtures, glissières selon `nature`) et `equipement_de_transport` ;
    - `troncon_hydrographique.classe_de_largeur`, utile aussi à J8-E.

    Aucun téléchargement de plus : une cellule « rue » se prépare dans la même passe que sa cellule de bâtiments.
  - **hors de France**, les routes d'OpenMapTiles : `class`, `oneway`, `brunnel`, sans largeur ni voies. La largeur et
    les voies s'infèrent par la classe, de façon déterministe, et ne sont pas présentées comme relevées.
  - **reste à mesurer en VB0** : le taux de remplissage de ces champs à Paris et à Toulon. Rien ne dit qu'ils soient
    renseignés partout.

  Le stationnement n'est dans aucune des deux sources. Il reste inféré, de façon déterministe et plausible, sans être
  présenté comme des positions relevées.
- Préparer axes, abscisses curvilignes, largeur, classe, exclusions et graines dans les workers ; calculer une fois
  les index de voisinage et les raccords. Éviter le parcours de toutes les routes dans la boucle CPU d'image.
- Coordonner avec J8-L une publication locale et versionnée, à budgets déclarés. Ne pas créer un deuxième gestionnaire
  indépendant de requêtes ou dépendre d'une nouvelle reconstruction complète de ville pour chaque objet.
- Maillages partagés pour véhicules et mobilier, petits enregistrements par instance, files et uploads bornés.
  Le format des caches préparés inclut une version ; les anciennes données restent affichables jusqu'au remplacement.
- Les zones hors ligne portent les données nécessaires au parcours entier. Une cellule présente sur disque mais
  encore à préparer n'est pas assimilée à un décor prêt à afficher.

### 4.3 Surface, lumière et historique

- Réutiliser lumière, air, profondeur, identité et mouvement du renderer ; pas de seconde atmosphère ni sonde par voiture.
- Les marquages se composent avant la finition atmosphérique et la reconstruction finale, avec une occultation correcte
  par le relief, les bâtiments et les véhicules. Pas de peinture ajoutée arbitrairement sur l'image finale.
- Les corps mobiles et leurs feux conservent pose précédente, identité stable et rejet d'historique aux changements
  de trajet/LOD. Les raccords de cellule ne doivent pas faire changer tous les modèles ou toutes les couleurs.
- Conserver les taches de lumière précalculées. Pas de lumière dynamique et carte d'ombre individuelle par lampadaire.
  Toute extension des ombres existantes se chiffre séparément avant d'entrer dans le budget.
- Contrôler les ressources et la taille des noyaux spécialisés : quelques branches peuvent provoquer une dégradation
  d'occupation. Une fonction supplémentaire courte dans le source ne garantit pas un coût marginal court sur Apple.

## 5. Lots proposés et critères de sortie

| Lot | Travail et référence FableFlight | Critère de sortie à vérifier lors de l'implémentation |
|---|---|---|
| **VB0 — référence et attribution** | Relever l'état courant de J8-L ; figer parcours, résolution, exposition, météo, nombres d'objets et temps par famille. Relire les fonctions du §2. | Comparaisons A/A stables et témoins des sondes ; qualité existante documentée en mouvement ; coût actuel isolé avant toute promesse. |
| **VB1 — données et publication communes** | **Étendre la cellule « rue » de J8-L (`KSC1` → format 2), sans créer un second contrat.** En France, le même décodage que les bâtiments lit `troncon_de_route` : largeur, voies, sens, ponts et tunnels, urbain. Hors de France, ces valeurs s'infèrent par classe à partir d'OpenMapTiles. On ajoute l'abscisse, les jonctions par index spatial à la préparation, les exclusions et les graines. Inspiration `roads.rs`, sans recopier le graphe complet. Même pool, même cache versionné, même zone, même `flightReady`. | Un secteur voisin apparaît sans refaire toute la ville ; pas de recul de couverture ; données préparées utilisables hors ligne ; budgets d'uploads et préparation visibles. |
| **VB2 — chaussée et trottoirs proches** | Ajouter bandes de rive, séparations de voies, bordure/trottoir en matériau et variations d'asphalte. Inspiration `road_surface` et `roads.wgsl`. Comparer un ruban raster léger à des pages locales préparées, choisir une seule voie de production. | Routes lisibles en France sous orthophoto et hors couverture nationale ; absence de double route, scintillement, fuite sur bâtiment ou eau ; filtrage selon empreinte ; coût dans l'enveloppe retenue. |
| **VB3 — silhouettes de véhicules** | Quatre à six silhouettes partagées (compacte/berline, SUV, utilitaire, bus/camion), capot-habitacle, vitrage et peinture. Inspiration `vehicle`, `build_models`, `inst.wgsl`. Conserver animation GPU. | Formes reconnaissables de près, couleurs/identités stables ; pas de duplication de géométrie par véhicule ; LOD continu et coût à population égale. |
| **VB4 — stationnement** | Placer des véhicules latéraux déterministes, hors intersections, bâtiments, végétation et passages piétons. Inspiration `park_cars`. Partager les modèles de VB3. | Rue habitée sans empilements ni multiplication manifeste des voitures photographiées ; instances statiques préparées une fois ; coût et densité affichés. |
| **VB5a — forme des lampadaires** | Potence simple, tête orientée et deux ou trois variantes proches ; garder le ruban lointain. Inspiration `lamp_post`. Coordonner couverture et grille lumineuse avec J8-L. | Bras raccordé au mât, silhouettes stables de jour, continuité de lumière de nuit ; détail proche sans réduction des lampes lointaines. |
| **VB5b — éclat des feux** | Cœur compact, halo court et visibilité directionnelle des phares/feux arrière ; réutiliser bloom et air. Inspiration `lights.wgsl`. | Énergie maîtrisée sous le pixel, occultation et mouvement cohérents ; pas de halos couvrant les rues ; coût mesuré de nuit dense. |
| **VB6 — trafic mieux réparti et continu** | Ajouter des rues tertiaires/mineures adaptées à population totale inchangée pour l'A/B ; courtes polylignes raccordées plutôt que boucle sur un segment. Inspiration `RoadNet`, en gardant poses GPU. | Davantage de rues animées sans hausse cachée des effectifs ; virages corrects, tunnels invisibles, ponts respectés, absence de saut visible au raccord. |
| **VB7 — intersections et mobilier** | Passages piétons/lignes d'arrêt placés aux jonctions, feux et quelques glissières proches. Inspiration `junctions` et `signal`. Index spatial à la préparation, pas comparaison quadratique de toute une ville. | Mobilier correctement placé et visible depuis l'avion ; pas de coût disproportionné de préparation ; variantes régionales et sens de circulation cohérents. |
| **VB8 — validation et retraits** | Juger l'ensemble sur les parcours complets ; retirer chemins remplacés, formats temporaires et compilations devenues inutiles au lot suivant leur bascule. | Captures et vidéo en mouvement, A/B soutenus et hors ligne, coûts par famille et total publiés ; un seul chemin de production par responsabilité. |

**Répartition (comme J8) :** la session des approches prend VB1, la préparation de VB4 (les places) et l'index
des jonctions de VB7. La session du rendu prend VB2, VB3, VB5a, VB5b, le dessin de VB4, VB6 et VB7. VB0 est commun.
**Place dans J8 :**
- **VB0 et VB1 peuvent démarrer tout de suite côté approches.** Ce sont des données. Elles enrichissent J8-L sans
  toucher au rendu, et ne coûtent aucun téléchargement en France.
- **VB2 et la suite viennent après les points de J8-A qui priment côté rendu** : les matériaux de J8-4 (et leur défaut
  de nuit), J8-5, J8-E, puis le dessin de J8-L. Seule exception : un lot qui fait partie du dessin de J8-L
  lui-même, comme la forme proche des voitures et des lampadaires (VB3, VB5a).

**Ordre recommandé :** VB0 → VB1 → VB2 → VB3 → VB4 → VB5a, puis VB5b et VB6 ; VB7 ensuite si le bénéfice reste
visible depuis l'avion. Chaque bascule inclut son retrait au lot suivant ; VB8 rassemble la validation finale.
Le premier ensemble à faible coût est un sous-ensemble de VB2–VB5a, pas l'addition de tous les maxima du §6.

### 5.1 Détails de conception à trancher par les premiers lots

**Routes.** Commencer le détail fin dans les 300–600 m proches, puis l'adapter à sa taille projetée et au regard.
Ce sont des distances de départ pour l'étude, pas des seuils validés. La couche doit pouvoir renforcer un marquage
sous IGN sans repeindre uniformément une chaussée déjà précise. Comparer les décalages OSM/orthophoto, garder
les irrégularités photographiques utiles ; inventer le nombre de voies seulement là où l'inférence est crédible.
Privilégier des triangles routiers suffisamment grands et un matériau court, sans recopier `liteSurface` entier.
Des pages locales peuvent porter le détail déjà préparé ; leur résolution, filtrage, nombre résident et coût mémoire
doivent être explicités avant choix. Ne pas augmenter globalement la résolution de tous les décalques.

**Véhicules.** Point de départ : 40–100 triangles pour les silhouettes courantes proches, géométrie plus riche
seulement pour les véhicules réellement grands à l'écran, et représentation simple au loin. Les phares restent
perceptibles selon leur énergie. Le vitrage peut utiliser le ciel et l'éclairage déjà disponibles ; ni reflet raytracé
ni intérieur complet par voiture. Exemple calculé : 200 véhicules passant de 20 à 100 triangles ajoutent 16 000
triangles à la passe principale, avant ombres et autres passes ; ce nombre n'est pas une durée GPU.

**Stationnement.** Quelques centaines à environ 1500 véhicules préparés sont une hypothèse de premier essai,
pas une densité adoptée. Borner les instances détaillées visibles par leur taille projetée, conserver le reste sous
forme simplifiée. Contrôler les voitures déjà photographiées ; pas de chantier de suppression IA de l'orthophoto.

**Lampadaires.** La potence peut d'abord être un ruban de deux triangles. Pour 4000 lampes toutes enrichies,
cela ajouterait 8000 triangles ; le LOD proche en doit exposer moins. La grille de lumière actuelle est à conserver
ou à publier par pages cohérentes avec J8-L, sans la remplacer par une boucle sur toutes les lampes par pixel.

**Trafic.** L'A/B de répartition conserve les effectifs du témoin pour isoler la qualité ; il ne fixe pas la population
finale de J8-L. Préparer les raccords, abscisses et phases hors frame ; si le travail de pose devient important avec
les nouveaux modèles, étudier son calcul une fois par instance plutôt que le répéter pour chaque sommet.

### 5.2 Ce que l'on voit à l'altitude de J8-A (calculé, non mesuré)

Hypothèses : 1440 pixels de large et un champ horizontal de 60° (une valeur supposée, à remplacer par celle du jeu).
Un pixel couvre alors environ 0,8 mm par mètre de distance, soit 0,4 m à 500 m, 0,8 m à 1 km et 1,6 m à 2 km.

| Objet | 150 m | 500 m (sous l'avion à 500 m) | 1,5 km (devant, en oblique) |
|---|---|---|---|
| Voiture (4,4 m) | ~37 px | ~11 px | ~4 px |
| Voie (3,5 m) | ~29 px | ~9 px | ~3 px |
| Marquage (0,15 m) | ~1,2 px | ~0,4 px : filtré | invisible seul |
| Tête de lampadaire (~1 m) | ~8 px | ~2–3 px | ~1 px, mais visible la nuit par sa lumière |

Conséquence pour J8-A, qui se vole vers 500 m : **VB3 (les voitures), VB5a/VB5b (les lampadaires et les feux) et la
largeur ou les voies de VB2 se voient.** Le détail fin des marquages et des trottoirs de VB2 ne compte qu'à basse
hauteur (50–150 m) : il se juge sur les parcours bas de §7, pas sur J8-A.

## 6. Coûts de performance : estimations à confronter aux mesures

### 6.1 Hypothèses communes

Vol urbain bas, **1440 × 810 pixels internes**, décor chargé, même exposition/météo/caméra, représentation opaque
et historique existants. Modèles regroupés, maillages partagés, détail selon taille projetée. Routes détaillées
occupant typiquement 2–10 % de l'image dans le scénario estimé. Pas de faisceaux volumétriques pour chaque phare,
ni nouvelles cartes d'ombre par objet, ni nouvelle simulation CPU complète du trafic.

Les plages sont des **estimations d'ingénierie, confiance faible à moyenne**, non des mesures ou intervalles
statistiques. La scène dense, le surdessin, la thermique, les ressources du shader et les compilations peuvent
les dépasser. Le coût réel inclut visibilité, matériaux, lumière, historique et éventuelles ombres ; ne pas déduire
des millisecondes d'un simple nombre de triangles ou de la puissance théorique du GPU.

| Ajout isolé dans ce périmètre | M1 Max : Δ GPU estimé [ms/image] | Mac mini M1 : Δ GPU estimé [ms/image] | Condition |
|---|---:|---:|---|
| Routes proches : chaussée, marquages et trottoirs en matériau | 0,2–0,8 | 0,5–2,0 | Traitement local, pas de parcours de toutes les surfaces pour chaque pixel du terrain |
| Véhicules variés, même population mobile | 0,1–0,4 | 0,3–1,0 | Détail proche, modèles partagés, pas de multiplication des passes d'ombre |
| Stationnement modéré | 0,1–0,4 | 0,3–1,0 | Instances statiques, nombre visible borné, LOD |
| Potences et variantes proches des lampadaires | 0,05–0,2 | 0,1–0,5 | Silhouettes proches seulement ; couverture lointaine préservée |
| Profil et direction des feux | 0,05–0,25 | 0,15–0,7 | Petits halos, air/profondeur/bloom existants |

VB6 et VB7 demandent une attribution distincte : la redistribution à effectif constant peut être presque neutre
pour le GPU, mais la continuité des trajets, leurs données et leur préparation ont un coût non chiffré ici.
Ne pas leur attribuer automatiquement le reliquat du budget des autres lots.

**Premier ensemble ciblé** (version limitée des routes, silhouettes, stationnement modéré, potences proches) :

| Coût supplémentaire estimé | M1 Max | Mac mini M1 |
|---|---:|---:|
| GPU par image | **0,5–1,5 ms** | **1,2–4 ms** |
| CPU principal par image, hors préparation | **0,1–0,4 ms** | **0,2–0,8 ms** |
| Mémoire additionnelle | Quelques Mio à environ 20 Mio selon stockage | Même ordre de grandeur |

Cette enveloppe reprend l'estimation de l'analyse initiale. **Ce n'est ni la somme des maxima, ni un budget produit
approuvé, ni une promesse de coût.** Les tâches worker, le réseau, la préparation à froid et les pics d'upload sont
des postes supplémentaires à mesurer. CPU et GPU ne s'additionnent pas directement.
Les règles de revue et seuils déjà décidés pour J8 restent applicables ; cette fourchette ne les relève pas.

### 6.2 Calculs de mémoire et pièges

- BH GPU recopie actuellement les 24 sommets, 20 triangles avec tags et 32 octets de trajet de chaque voiture :
  `24 × 12 + 20 × 16 + 32 = 640 octets`, soit environ **0,92 Mio pour 1500 voitures**, hors structures générales.
  Ne pas multiplier ce stockage en recopiant un modèle enrichi pour chaque instance.
- Le décalque proche actuel couvre 1600 m avec des texels de 2 m : 800². Passer partout à 25 cm ferait 6400²,
  **64 fois plus de texels**, environ 39 Mio pour un seul canal avant mipmaps, au lieu de 0,61 Mio. Une solution
  clairsemée, locale ou analytique est à comparer avant d'agrandir les textures.
- Doubler le rayon d'un halo multiplie sa surface par quatre. Le nombre de feux seul ne borne pas le remplissage.
- Une résolution de sortie ne suffit pas pour comparer les coûts : relever la résolution interne et le nombre
  de pixels routiers/objets touchés. Une estimation à 1440 × 810 ne vaut pas telle quelle en rendu natif 4K.

### 6.3 Ce qu'un surcoût signifie pour la cadence

Exemple **calculé, pas mesuré**, pour une frame limitée par le GPU à 25 ms (40 images/s) : +1 ms → 38,5 images/s ;
+2 ms → 37,0 ; +4 ms → 34,5. À 30 images/s plafonnées, une partie du coût peut entrer dans la marge disponible,
mais elle augmente charge et chaleur. Les 60 images/s du M1 Max et les 25 du mini restent les destinations
respectives du contrat ; ce plan n'entérine aucune baisse de résolution ou suppression de contenu pour les tenir.

### 6.4 Le coût en cumul avec J8 (une question pour Sam)

Mesuré par la session du rendu (kerr-mini, 16 nov. ~17:55 UTC, un seul passage) : la vue de Paris à 12 km et à 500 m
prend déjà **51,9 ms sans la couche lointaine**, au-delà de la cible du mini de 40 ms. La couche J8-4 y ajoute
**+3,5 ms**. Les estimations de ce plan y ajouteraient encore +1,2 à +4 ms sur le mini (§6.1, non mesuré).

**Règle proposée :** chaque lot VB se mesure dans la vue de Paris de J8-A, avec J8-4, J8-L et J8-E allumés. Son coût
s'ajoute au cumul de la ville, plutôt que d'être jugé seul dans une scène vide. Le seuil de 3 ms décidé pour J8-4
s'appliquait à une couche seule. **C'est à Sam de dire s'il fixe une enveloppe pour toute la ville vue d'en bas**
(bâtiments, eau, rues, voitures, lampadaires) sur le mini et sur le M1 Max, ou s'il juge lot par lot. Tant qu'il n'a
pas répondu, un lot qui dépasse 1 ms sur le mini revient vers lui avec ses captures.

## 7. Validation future et critères de livraison

**À exécuter uniquement pendant une future session d'implémentation autorisée. Aucun de ces contrôles n'a été
lancé pour écrire ce plan.** Lire alors [E2E](E2E.md), [E2E-VOLS](E2E-VOLS.md), [THERMAL](THERMAL.md), le contrat
J0 et les consignes des machines avant d'organiser les essais.

1. **Références visuelles :** Paris dense, Toulon-Hyères mixte et une route hors orthophotos nationales.
   Altitudes indicatives : 50, 150 et 500 m AGL ; caméra, focale, exposition, soleil et météo tenus identiques.
   Jour et nuit ; trajectoire réelle et virage, pas seulement une image immobile.
2. **Continuité :** même contenu avant/après, nombre d'objets visibles et préparés par anneau ; aucun quartier
   absent compensé par une meilleure façade ; pas de rupture des routes, couleurs, trafic ou lumières au raccord.
3. **Défauts proches :** intersection, pont/tunnel, stationnement, marche près d'une bordure, pente routière,
   photographie décalée et véhicules déjà photographiés. Aucun objet traversant un bâtiment ou peint sur l'eau.
4. **Mesures :** A/A puis A/B alternés et répétés, après préparation comparable et à résolution interne fixe ;
   GPU total, CPU principal, régularité p95/p99, soumissions et complétions, mémoire, octets transférés, nombre de
   triangles/instances/pixels et compilations. Sur Apple, ne pas additionner naïvement les horodatages des passes
   raster : compléter par des ablations de la frame entière.
5. **Soutenu :** machine à l'état d'un vol prolongé, cadence bornée, qualité et effectifs inchangés. Distinguer le
   coût du détail de celui d'une nouvelle densité. Un effet inférieur au bruit est « non isolé », pas « gratuit ».
6. **Données :** cache froid, cache chaud, puis zone PWA réellement hors ligne ; délai jusqu'au premier détail
   utile, préparation worker, attente de publication et pics d'image suivis séparément. Tester une cellule absente,
   une annulation et le retour dans une cellule déjà préparée.
7. **Livraison :** rapport avec état de preuve, captures et séquence en mouvement, coûts M1 Max et mini, limites
   restantes et décision sur chaque lot ; aucun seuil dépassé accepté tacitement.

Pendant l'implémentation, tenir [GRAPHICS-PIPELINE](GRAPHICS-PIPELINE.md), la carte documentaire et le journal
dans le même lot concerné. Les nouveaux e2e auront leur entrée dans le catalogue ; les réglages/actions exposés
mettront à jour leurs références. Cette rédaction documentaire ne crée aucune passe ni API et n'en régénère pas
l'inventaire.

## 8. État et prochaine étape

| Élément | État au 16 novembre 2026 |
|---|---|
| Analyse comparative, sources FableFlight et état BH GPU | Lecture statique ; références consignées dans ce plan |
| Estimations de coût | Proposées, non mesurées ; périmètre et incertitudes au §6 |
| VB0 à VB8 | Rattachés à PLAN-J8 comme groupe J8-VB. **Décidé par Sam (16 nov., ~18:05 UTC) : portés par la session des approches, VB0–VB1 lancés** ; les lots de dessin se conviennent avec la session du rendu. **VB0 fait** ([FICHE-J8-VB0](progress/j8/FICHE-J8-VB0.md)). **VB1 fait** (16 nov. ~18:30 UTC, [FICHE-J8-VB1](progress/j8/FICHE-J8-VB1.md)) : la cellule « rue » au format 2 (KSC2, convenu avec la session du rendu — tronçons de 32 o pour toutes les routes, la largeur et les voies de la BD TOPO en France, jonctions, une section pour VB4), `kerr-street-v2` ; Toulon 2 659 tronçons et 622 jonctions sur une tuile z 14, Paris (Marais) 2 097 et 676 ; `j8-street-cells` 1/1 dans le jeu. **VB4, la préparation des places, faite** (16 nov. ~19:35 UTC, convenue avec la session du rendu ; même fiche) : places de 16 o dans la section de KSC2, rues urbaines tertiaires, locales et de service, file supposée hors chaussée sur les sens uniques de 3 à 5 m (la BD TOPO y donne la largeur roulante), exclusions jonction, bâtiment, autre tronçon, densité par graine, 4 000 au plus par cellule ; Toulon 1 176 places sur une tuile z 14 (43 % en file supposée), Paris (Marais) 1 707 (69 %) ; le dessin à la session du rendu. **Mode speed (17 nov.) : les données de VB2, VB5a, VB6 et VB7 faites** (~09:40 UTC, session des approches, [FICHE-J8-VB1](progress/j8/FICHE-J8-VB1.md) § KSC3) : la cellule « rue » au format 3 (`kerr-street-v3`) — la potence des lampes (cap, portée, variante), une surface par tronçon (lignes de rive, centrale, de voie ; bordure et trottoirs), les suites des tronçons pour le trafic, le mobilier des jonctions urbaines (lignes d'arrêt ou de cédez-le-passage, passages piétons, feux) et les glissières, tout inféré (`street-detail-prep.ts`) ; Toulon 1 102 lignes, 1 424 passages, 132 feux, 30 glissières sur une tuile z 14 ; tests unitaires seulement, **non mesuré en jeu** ; le dessin au rendu. **VB3 dessiné** (rendu, 11/17 ~09:50 UTC, mode speed) : cinq silhouettes partagées (`src/system/car-shapes.ts` : compacte, berline, SUV, utilitaire, bus ou camion ; caisse peinte, habitacle plus étroit au toit peint, pare-brise, lunette et vitres latérales en verre sombre qui reflète le ciel comme les fenêtres — `CAR_GLASS_BIT` dans le tag, `shadeLite` —, quatre feux), la forme d'une voiture tirée de son index (`carKind` : la même voiture la même forme), `packScenery` qui étiquette chaque voiture selon sa forme ; l'animation GPU inchangée ; la boîte `traffic.ts carMesh` retirée, `traffic.ts` cédé aux approches pour VB6 ; tests unitaires, `check-wgsl` ; **non mesuré, non vu en jeu** (le gros e2e) ; limite : la géométrie reste copiée par voiture dans le tampon du décor (32 sommets, comme la boîte avant ; pas d'instanciation) ; les voitures lointaines de jour restent des boîtes. **VB4 dessiné** (rendu, 11/17 ~09:55 UTC, mode speed) : le worker du décor lit les places des cellules « rue » dans leur cache (900 m autour du centre, les 2 500 plus proches), pose sur chacune une voiture à l'arrêt (vitesse nulle, sur le sol déjà là) de forme `parkedKind` (jamais de bus), feux absents (rien d'allumé la nuit), tournée dans l'autre sens du côté gauche ; `renderer.parkedCarsOn` allumé (hash `parkedCars=0`), `stats().parkedCars` ; tests unitaires ; **non mesuré, non vu en jeu** ; limites : rien n'écarte encore les places de la végétation ni des passages piétons (les données ne le disent pas), une place sans cellule « rue » en cache n'a pas de voiture. **VB5b fait** (rendu, 11/17 ~09:57 UTC, mode speed) : chaque feu de voiture vu le long de son faisceau (`scenery-raster.ts` `meshVs`, `carAhead` : la direction de son morceau de route) — un phare de l'avant seulement, 35 % sur le côté et un cœur dans l'axe (puissance 4), un feu arrière de l'arrière, plus large —, sa part de lumière portée par la fraction du tag que `shadeLite` lit déjà (1 − fraction / 0,45), le quad fermé quand il ne se voit pas ; le halo reste celui du bloom ; aucune donnée nouvelle ; `check-wgsl` ; **non mesuré, non vu de nuit** |
| Données routières BD TOPO | **VB0 mesuré** (session des approches, 16 nov. ~18:20 UTC, [FICHE-J8-VB0](progress/j8/FICHE-J8-VB0.md)) : sur les tuiles en cache, Paris 965 tuiles et 230 478 tronçons, Toulon-Hyères 2 192 et 100 874 ; sens, position (ponts, tunnels), urbain, importance, nature, vitesse renseignés à 100 % ; largeur et voies à 95,6–100 % pour les routes carrossables (1 et 2 chaussées, ronds-points, bretelles, autoroutes), 0 % pour les sentiers, chemins, routes empierrées et escaliers — l'inférence par classe ne sert qu'à eux et hors de France |
| Code, dépendances, runtime, réglages et caches | Aucun changement par cette session |
| Exécutions du projet | Aucune |

**Prochaine étape proposée :** à la reprise d'un travail d'implémentation, rapprocher VB0/VB1 de l'état réellement
livré de J8-L, puis construire une première comparaison des routes proches (VB2) et des silhouettes de voitures
(VB3). La commande d'écriture de ce document ne déclenche ni ces travaux ni leur campagne de mesures.
