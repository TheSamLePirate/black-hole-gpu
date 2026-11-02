# Challenge du plan réfraction, horizons et Terre raster

**2 novembre 2026 — audit de conception et lecture du code, sans exécution.**

Plan examiné : [PLAN-REFRACTION-HORIZONS.md](PLAN-REFRACTION-HORIZONS.md), état de `main` à
`f3d2790babe46a3e082dd307c31212334763cd4f`. Objectif : **qualité AAA, photoréalisme et performance ensemble**.

## Verdict

**Les problèmes visés sont les bons ; plusieurs solutions proposées ne permettent pas encore de garantir les résultats
annoncés.** Le plan mérite d'être conservé, mais pas lancé tel quel comme un programme de livraison AAA de 29–34 jours.

Ses points les plus fragiles sont les contrats entre représentations : surface fine et surface grossière, relief et
ombre, rayon apparent et point physique, air local et Soleil géométrique, tuile logique et texture filtrée. Un fondu
cache certains changements ; il ne répare pas un contrat incorrect.

Les corrections prioritaires sont :

1. Définir une représentation d'horizon qui distingue **estimation visuelle et borne fiable**. La carte proposée mélange
   des approximations de signes opposés et ne justifie pas la sortie « ombre certaine » de H3.
2. Fermer les intervalles sans ombre de T6 et H3 : le biais de la carte solaire et son domaine de couverture sont des
   parties de l'algorithme, pas de simples réglages.
3. Séparer le Soleil géométrique, utilisé notamment par les éclipses, du Soleil incident local de R3.
4. Étendre R4 à la profondeur, aux intersections, au SSR et à la reprojection temporelle ; ses six chemins de projection
   ne constituent pas tout le travail.
5. Concevoir T8/T9/T10 comme une même architecture de résidence et de filtrage, avec livraison progressive.
6. Adapter les promesses au téléobjectif et aux pôles à la précision réellement disponible dans les tables et les DEM.

**Le risque principal serait de produire des images plus séduisantes, mais incorrectes et instables, tout en déclarant
le plan réussi grâce à quelques captures fixes et à un temps GPU moyen inchangé.**

## 1. Périmètre et degré de certitude

Aucun code source modifié, aucun test, build, typecheck, benchmark, navigateur ou e2e lancé pour cet audit. Le présent
document est le seul livrable ajouté. Les critères de vérification ci-dessous concernent une campagne future.

Le dépôt contenait déjà des modifications de travail dans `renderer.ts`, `trace.wgsl`, `giant-clouds.ts` et des tests
des géantes. Elles ont été laissées intactes. Les constats se rapportent au code lu pendant cette session ; ce n'est
pas un gel des travaux concurrents.

Lecture principale : shaders du traceur et du post-traitement, renderer, cache et raster du terrain, tuiles terrestres,
cartes HD, repères WGS84, réfraction CPU, atmosphères, météo, contrats des ombres et sources des tests concernés. Les
instructions du dépôt et l'analyse Terre du 2 novembre ont été relues. `origin/master` du dépôt voisin a été actualisé ;
la dernière note d'Alex, y compris ses ajouts 4u, a été lue. Ses chiffres Quest restent des résultats de son moteur,
pas des mesures transposables au nôtre.

Dans la suite :

- **Constat** : comportement lisible dans le code ou choix explicite du plan.
- **Démonstration** : conséquence mathématique ou contre-exemple, sans besoin de mesure GPU.
- **Risque** : problème plausible à résoudre ; sa fréquence ou son coût ne sont pas mesurés ici.
- **Proposition** : modification recommandée du plan, à décider avant l'implémentation correspondante.

Les valeurs de performance du plan ne sont pas revalidées par cet audit.

## 2. Ce qui est solide et doit rester

- Le diagnostic des normales de triangle est fondé : `rasterNormal` reconstruit trois points depuis leurs distances,
  puis prend un produit vectoriel. `earthSlopeFine` ne le remplace aujourd'hui que pour certaines données fines.
- Le défaut du marqueur des coutures est réel : `terrainRings` compte le `step` depuis `TERRAIN_CACHE_PATCH_REF = 4`,
  alors que `terrainRasterLevelStep` s'en sert pour différencier les niveaux. T2 doit séparer ces responsabilités.
- La carte solaire terrestre est effectivement sous-alimentée : `TerrainRaster.encodeSunShadow` dessine le seul
  maillage du patch, alors que le renderer annonce une portée de 9,8 km. T6 corrige une perte visuelle majeure.
- Les changements de révision rendent tous les niveaux du cache périmés ; les niveaux sales sont généralement recuits
  un par image. T4 vise donc une vraie source de travail inutile et de désaccord entre niveaux. Nuance : les fenêtres
  déplacées sont déjà toutes recuites dans leur image ; « toujours un niveau par image » serait inexact.
- L'imagerie entière est republiée dans `rg32uint` avec les hauteurs à son arrivée. La séparation T9 et le décodage en
  worker sont des pistes sérieuses de qualité et de fluidité.
- Une table de réfraction partagée CPU/GPU est une bonne direction. L'exponentielle actuelle ne constitue pas une
  référence physique suffisante pour l'orbite et le téléobjectif.
- Garder R4a et R4b ensemble est nécessaire. La géométrie WGS84 et les collisions doivent rester physiques.
- Ne couper que la lumière directe, tenir compte de la taille angulaire du Soleil et garder un repli matériel sont de
  bons invariants.

Ces constats justifient les chantiers. Ils ne valident pas automatiquement leur solution détaillée.

## 3. Les blocages à lever avant les phases concernées

| Priorité | Sujet | Pourquoi le critère actuel ne suffit pas | Décision nécessaire |
|---|---|---|---|
| P0 | H3 : « ombre certaine » | ni les trois rayons d'un secteur ni les mips filtrées ne fournissent une borne fiable dans l'azimut exact | séparer estimation et bornes ; garder un repli dans l'incertitude |
| P0 | H1/H3 : distance D | la sortie de la carte solaire varie par point, direction et couverture ; une cuisson globale unique ne peut pas commencer à cette sortie variable | domaines de distance fixes ou représentation interrogeable par distance |
| P0 | T6 : ombre proche | `SUN_N` agrandit une zone où les bloqueurs sont ignorés ; `liteSun` n'a pas la marche qui la comble | solution explicite aux ombres proches et à l'auto-ombrage |
| P0 | R3 : direction globale | `P.near4` alimente aussi l'atmosphère et la géométrie des éclipses | Soleil géométrique distinct du Soleil incident local |
| P0 | R4 : point physique | le reste du moteur reconstruit encore `rayon × profondeur` ; le déplacement apparent dépend de l'œil | contrat de projection/inversion et de profondeur commun |
| P0 | T3 : surface cible | une interpolation bilinéaire ne coïncide pas avec les triangles grossiers ; les rapports de grille sont 2 et 4 | interpolation sur la vraie triangulation et traitement des sommets intermédiaires |
| P0 | T9 : mips et tore | des mips ordinaires filtrent aussi les voisins physiques qui ne sont pas toujours les voisins géographiques | choisir atlas/array, bordures, validité et générations ensemble |
| P1 | T5 : attache | `rg16snorm` demande une fonctionnalité non activée aujourd'hui ; deux canaux de normale ne contiennent pas aussi une distance arbitraire | format de repli et disposition exacte avant T5 |
| P1 | H : pôle sud AAA | une calotte à plusieurs km par texel ne permet pas la fidélité locale annoncée autour de Shackleton | ajouter une source polaire adaptée ou limiter la promesse |
| P1 | R1/R2 : précision | les erreurs angulaires proposées dépassent de nombreux pixels au grossissement maximal | budgets en pixels et en angle par mode |
| P1 | Ensemble : coût | coûts estimés, débit de chargement, pics mémoire et compilations sont insuffisamment contractualisés | budget complet en régime stable et pendant les transitions |

P0 désigne ici un défaut de conception à résoudre avant de coder la phase, pas un ordre de modification immédiate.

## 4. Terre : le plan doit garantir une surface cohérente

### 4.1 T1 améliore l'interpolation ; il ne peut pas promettre la disparition de toute quantification

**Constat.** `tileSample` et `sampleLevel` utilisent une cubique monotone séparable. Une sécante nulle annule la pente.
Le mécanisme de conservation des plateaux décrit par le plan est correct.

**Limite démontrable.** Sur un plateau quantifié assez large, un voisinage 4 × 4 ne contient que la même hauteur. Toute
reconstruction locale raisonnable préservant un champ constant rendra ce plateau constant. Remplacer ses tangentes par
Catmull–Rom n'invente pas la pente réelle absente des données. Un changement de cubique peut atténuer des marches et des
plis ; « plus aucun escalier » n'est pas un résultat garanti par cette seule opération.

Autre ambiguïté : une B-spline cubique approximante ne se définit pas simplement comme une tangente à substituer dans
une Hermite interpolante. Il faut choisir une fonction complète, avec ses valeurs et ses dérivées. Le mélange doit
aussi rester continu entre cellules et entre axes. Un poids différent pour le même nœud selon la cellule détruirait
la continuité recherchée.

**Proposition compatible avec la décision 12 de Sam :** conserver la fonction hybride seule comme première expérience,
mais en faire un jalon à résultat conditionnel. Exiger une définition mathématique exacte, la conservation d'une rampe,
la continuité aux nœuds, une borne d'overshoot et une comparaison sur plateaux quantifiés, falaises et données fines.
Si le défaut subsiste, constater l'échec du critère et revenir à la décision prévue sur le traitement des données.
Le tramage aléatoire n'est pas une restitution de relief mesuré ; il ne doit pas devenir le correctif par défaut.

CPU et GPU doivent partager reconstruction, sélection des sources, validité et poids de transition. Les tests
`earth-tiles.test.ts` actuels utilisent un GPU simulé : ils ne démontrent pas seuls une égalité numérique avec WGSL.

### 4.2 T3 : viser les triangles grossiers, pas leur interpolation bilinéaire

**Démonstration.** Dans une cellule de hauteurs `h00, h10, h01, h11`, l'interpolation bilinéaire au centre vaut leur
moyenne. Si la diagonale du maillage joint `00` à `11`, la surface des triangles y vaut `(h00 + h11) / 2`.
L'écart vaut donc `(h00 + h11 − h10 − h01) / 4`. Il peut être non nul précisément dans les vallées et sur les crêtes.

Ainsi, « interpoler la hauteur du niveau suivant au même point » ne suffit pas si cela désigne le bilinéaire utilisé
aujourd'hui par `terrainPoint`. Pour une couture réellement fermée, le bord fin doit rejoindre la surface **triangulée**
grossière, dans le même repère. À grande échelle, la courbure WGS84 oblige aussi à vérifier les positions 3D : égaliser
seulement deux altitudes n'égalise pas nécessairement deux surfaces polygonales.

Le code expose un rapport de grille `ratio = 2` entre les premiers niveaux et `ratio = 4` ensuite. Avec le rapport 4,
une arête grossière contient trois sommets fins intermédiaires. « Les sommets impairs au milieu » décrit seulement une
partie du problème. Il faut traiter les phases de grille, les quatre coins, le déplacement indépendant des fenêtres
et les niveaux temporairement indisponibles.

**Proposition :** spécifier l'interpolation barycentrique sur le triangle grossier réel, ou une topologie de raccord
explicitement équivalente. La même fonction de surface, le même état de morphose et la même diagonale servent à la
visibilité et à la carte solaire. La diminution du chevauchement vient après cette garantie.

La référence classique des clipmaps associe transition géométrique et transition des attributs ; elle ne se réduit pas
à un fondu de hauteurs. [GPU Gems 2, chapitre 2, NVIDIA](https://developer.nvidia.com/gpugems/gpugems2/part-i-geometric-complexity/chapter-2-terrain-rendering-using-gpu-based-geometry)

### 4.3 T4 : publier un état cohérent, puis le faire évoluer

Une publication « par paires voisines » est sous-spécifiée : les paires `(n,n+1)` et `(n+1,n+2)` se recouvrent. Si elles
publient des versions différentes de `n+1`, le problème réapparaît au raccord suivant.

Le cache doit identifier une génération de sources et l'ensemble des niveaux affectés. Le maillage, ses normales,
ses ombres et le bord de son voisin doivent lire un état compatible. Une cuisson étalée peut préparer une nouvelle
génération sans la rendre visible partiellement.

Le fondu temporel a deux difficultés supplémentaires :

- Après recentrage, les anciennes et nouvelles fenêtres ne représentent pas les mêmes nœuds. Mélanger les mêmes
  indices de buffer mélangerait deux lieux. Il faut reprojeter les anciens échantillons ou limiter le fondu au domaine
  géographique commun.
- Si des mises à jour arrivent avant la fin du fondu, repartir de l'ancien état initial crée un saut. Il faut définir
  la transition depuis l'état effectivement affiché, la coalescence des mises à jour et la politique d'annulation.

La transition doit aussi préserver le contact apparent des arbres, pistes, bâtiments et objets au sol. Garder les
collisions physiques n'autorise pas le terrain dessiné à traverser visiblement leurs pieds pendant 300 ms.

**Proposition :** un contrat de génération et de domaine partagé, avant de choisir double buffer et durée de fondu.
Décider quelles évolutions des ombres accompagnent la surface affichée. Inclure le déplacement de cette surface dans
la gestion temporelle, ou rejeter localement l'historique devenu faux.

### 4.4 T5 : normales lisses, silhouette et bande passante sont trois problèmes différents

Les normales interpolées supprimeront des facettes d'éclairage. Elles ne corrigeront ni une silhouette polygonale, ni
une géométrie grossière qui masque une vallée. La normale géométrique et la normale de matériau doivent garder des
rôles distincts : biais d'ombre et orientation de surface d'un côté, détail d'éclairage de l'autre.

Les normales doivent provenir de la surface effectivement morphée. Mélanger deux normales déjà normalisées n'est pas
en général la dérivée exacte du mélange de hauteurs : la dérivée du poids de morphose intervient aussi. Le plan doit
au minimum borner l'erreur dans cette bande et assurer des dérivées compatibles aux bords des caches.

**Contrainte vérifiée.** Le format `rg16snorm` du plan dépend de `texture-formats-tier1`. Le renderer ne demande
aujourd'hui que les timestamps et certaines compressions. Prévoir la négociation et un repli tel que `rg16float` ; ne
pas supposer le format universel. [WebGPU, formats](https://www.w3.org/TR/webgpu/#texture-format-caps)

Deux composantes octaédriques occupent déjà les deux canaux. « Conçue aussi pour R4b » n'est pas une disposition de
données : préciser si la distance physique se reconstruit, se stocke ailleurs ou impose une attache plus large.
Les autres producteurs de visibilité, notamment bâtiments et corps, doivent avoir une convention de validité.

Enfin `+4 o/px` est une capacité mémoire, pas un coût de frame nul. À 1080p, une écriture et une lecture complètes de
4 octets représentent environ 16,6 MB par image, avant compression/cache ; à 60 Hz, environ 1 GB/s de trafic théorique.
Le trafic réel dépendra du taux d'ombrage. La mémoire au redimensionnement et les buffers retirés comptent aussi.

### 4.5 T6 : le biais de la carte solaire laisse toujours un trou sans marche proche

**Constat.** `sunShadowFar` ignore un bloqueur dont l'avance est inférieure à `reach`. Avec `SUN_N`, cette portée vaut
au moins une fonction de la taille du texel et de la pente vers le Soleil. Ce mécanisme existe pour que la marche
proche traite ce que la carte ne peut pas distinguer de l'auto-ombrage. `nearShadow` possède cette marche ; `liteSun`
ne la possède pas.

Remplacer les 300 m par `SUN_N` ne crée donc pas les ombres proches manquantes. Avec la carte actuelle de 2048 texels
sur 20 km, un texel mesure environ 9,8 m. Pour un terrain horizontal et un Soleil très bas, le code borne le cosinus
à 0,05 et la formule donne une portée proche d'environ **390 m**. Tout bloqueur ignoré dans cette portée reste absent
de `liteSun`. Sur une pente tournée vers le Soleil, le chiffre change ; le problème de couverture demeure.

**Proposition :** choisir explicitement entre une cascade solaire rapprochée, une courte marche bornée, une autre
représentation des bloqueurs proches ou une combinaison. Un biais adaptatif peut réduire l'acné ; il ne remplace pas
la visibilité qu'il élimine. Les ombres de bâtiments et d'arbres ne couvrent pas tous les talus ni les petits reliefs.

La couverture distante exige aussi une correction : les fenêtres de terrain sont carrées, décentrées par rapport à
la caméra et parfois partielles. Leur intersection avec le volume solaire n'est pas un disque fixe de rayon 9,8 km.
La sortie doit être calculée sur le domaine réellement couvert, avec une convention « inconnu » dans les trous.
Le budget `≤ 0,3 ms` reste un objectif à démontrer avec cette solution complète.

### 4.6 T7 : une côte est une classe et une surface, pas seulement un seuil d'altitude

Lire la hauteur des données plutôt que celle du triangle est une amélioration. Mais si l'eau est uniquement un
matériau appliqué à la surface actuelle, un nouveau masque ne corrige pas à lui seul sa géométrie : il faut assurer
une mer sur le géoïde, des lacs à leur niveau, et un raccord sans eau plaquée sur une pente ou cachée par un triangle.

Il faut une hiérarchie de confiance et de résolution entre OSM, WorldCover, relief et masque global, avec états
« absent », « non chargé » et « eau » distincts. WorldCover classe l'eau permanente ; ce n'est pas une mesure universelle
du rivage instantané ni du niveau d'un lac. Les polders montrent justement pourquoi `hauteur < seuil` ne peut pas
trancher la classe. Conserver les hauteurs MSL et ellipsoïdales aux bonnes frontières.

Le plan doit définir le comportement hors emprise des meilleures données et à leur arrivée. Sinon une côte nette
peut encore se déplacer brutalement lorsque la source change. Prévoir une couverture sous-pixel, pas un mélange
arbitraire de deux classes qui fabrique une bande d'eau semi-transparente.

Pour les vagues, choisir l'axe long est un repli robuste contre le moiré, au prix d'un flou excessif sur l'axe court.
Le filtrage anisotrope explicite est une meilleure cible, mais doit transporter ensemble pente moyenne, moments LEAN,
déplacement, Jacobien et écume. `seaWavesFft` couple déjà ces termes. Un sampler aniso n'élimine pas à lui seul un
aliasing de l'éclairage spéculaire.

Tourner la cascade de 1024 m par cellules fait aussi tourner sa direction de vent. Si l'on tourne les coordonnées,
il faut transformer les vecteurs de déplacement, les pentes et les moments associés. Préférer d'abord une stratégie
de déphasage compatible avec le spectre et le vent. Les raccords spatiaux doivent rester continus pendant l'animation.

Un fondu SSR en distance peut stabiliser l'image ; il doit rejoindre un reflet de repli cohérent. Le contrôle AAA
porte sur la continuité de radiance, la largeur et l'énergie du reflet solaire, pas seulement sur l'absence de motif.

### 4.7 T8/T9/T10 : décider ensemble du stockage, de la résidence et des bordures

T10 compacte des petites fenêtres dans les quarts d'une couche. T9 sépare hauteur et couleur et ajoute des mips.
T8 modifie les unités de publication et agrandit certaines fenêtres d'orthos. Les réaliser comme trois architectures
successives oblige à réécrire les mêmes adresses, paramètres et politiques de validité.

**Deux options plausibles, à départager avant ces phases :**

- Des couches par tuile logique : mips indépendantes et adresses simples, mais bords à alimenter depuis les voisins,
  résidence à gérer et plafond du nombre de couches à respecter.
- Des atlas/clipmaps par niveau : continuité spatiale possible, mais mips conscientes des fenêtres, du tore, des
  quadrants et des générations. Le générateur `mips.wgsl` actuel fait une moyenne ordinaire ; il ne sait rien de ces
  contraintes.

« Mips à l'intérieur de chaque tuile » et sampler sur l'atlas ne suffisent pas. Le filtre anisotrope traverse les
bordures ; un voisin physique peut être une ancienne tuile ou un autre niveau compacté. Aux mips basses, les
empreintes débordent largement. Il faut des bordures cohérentes à chaque mip ou un échantillonnage qui traite ce cas.
Une nouvelle tuile doit publier sa validité avec ses mips et ses bordures, sans réutiliser les couleurs du précédent
occupant de son emplacement.

WebGPU borne le nombre de couches et son filtrage anisotrope dépend de l'implémentation. `maxAnisotropy: 16` est un
plafond demandé, pas une garantie de seize prises identiques sur chaque appareil. [WebGPU, limites](https://www.w3.org/TR/webgpu/#limits),
[samplers](https://www.w3.org/TR/webgpu/#sampler-creation)

**T8 nécessite aussi ces précisions :**

- Une clé de résidence incluant source, génération et tuile, et une protection contre les réponses réseau tardives.
- La validité du **voisinage** de reconstruction : une cubique 4 × 4 ne peut pas lire sans précaution une tuile absente.
  Les normales fines et les bordures d'imagerie ont la même dépendance.
- Des masques entiers : un `f32` numérique ne représente pas exactement tous les entiers de 32 bits. Pour 64 tuiles,
  définir deux mots et leur transport, pas seulement « un masque dans `P.tileL` ».
- Une priorité tenant compte de l'aire visible, de l'erreur projetée, du mouvement, du coût et de l'ancienneté.
  Distance au regard / taille du texel n'est pas, seule, une mesure d'importance à l'écran. Protéger le chargement
  minimal des niveaux grossiers contre la famine.
- Des limites distinctes sur requêtes, décodages et octets envoyés au GPU par image. Déplacer le décodage en worker ne
  réduit pas automatiquement les copies, les uploads ni la contention mémoire.
- Une stratégie après échec : le code actuel finit par remplir depuis la carte globale. Ce repli est signalé comme
  une tuile chargée, mais son erreur peut être très supérieure à celle de ses voisines. Le fondu et la provenance
  doivent le savoir.

Ne pas figer 12–16 requêtes comme un optimum acquis. Mesurer le temps jusqu'à une qualité visible définie, les octets
inutiles et les à-coups avec cache froid, chaud et réseau dégradé. Les orthos ont déjà leur propre limite de requêtes
dans le code : le budget réseau total est supérieur au seul `MAX_INFLIGHT = 8` du relief.

## 5. Horizons : le modèle proposé n'a pas les garanties annoncées

### 5.1 Trois rayons ne sont pas le maximum d'un secteur

Un secteur de 45° échantillonné à −15°, 0°, +15° laisse encore des directions non vues. Un pic étroit peut tomber
entre deux rayons. À l'inverse, le maximum de ces trois rayons peut appartenir à un relief situé à côté du Soleil,
qui ne l'occulte pas dans sa direction exacte. Interpoler deux maxima sectoriels élargit artificiellement des ombres.

La carte peut donc **sous-ombrer et sur-ombrer**. « Prudent » ne dit pas dans quel sens elle borne le phénomène.
Le maximum G des DEM, le filtrage spatial et la hauteur de référence ajoutent d'autres biais de signes différents.

Le DEM est stocké en `rg16float` : l'arrondi de ses maxima doit lui aussi entrer dans une éventuelle marge
conservatrice. La conservation d'un maximum avant conversion ne garantit pas une borne supérieure après arrondi.

Pour déclarer le Soleil entièrement masqué, il faut un horizon suffisamment haut sur **toute l'étendue azimutale du
disque solaire**, et une erreur bornée. Une élévation maximale quelque part dans un secteur ne le prouve pas.

**Proposition :** une estimation suffit pour un rendu lointain approximatif assumé. Une sortie anticipée exacte exige
des bornes adaptées à la question, ou une vérification locale. Réserver le retour immédiat de H3 aux zones prouvées ;
garder la marche ou une lecture plus précise pour l'intervalle d'incertitude.

### 5.2 La hauteur maximale de référence évite un défaut mais en crée un autre

Cuire depuis le haut du texel abaisse l'horizon pour un récepteur situé plus bas. Cela réduit les fausses ombres sur
les crêtes, mais peut laisser éclairé le fond d'une vallée masqué par une chaîne distante. La marche proche et la carte
solaire ne récupèrent pas un bloqueur situé au-delà de leur couverture. C'est précisément le domaine vendu comme gain
principal de H3.

La référence G à mip 1 doit être évaluée par rapport au **récepteur réellement dessiné**, qui ajoute tuiles, cratères
et relief procédural. Elle n'en est pas automatiquement un majorant.

L'option « une distance par direction permet la correction exacte » est également excessive. Si l'on change la
hauteur du récepteur, le bloqueur qui maximise l'angle peut changer : une petite crête proche et une montagne lointaine
ne réagissent pas pareil à `Δh / distance`. Corriger seulement le gagnant initial ne recalcule pas le maximum de tous
les candidats.

**Proposition :** borner la plage de hauteurs acceptable ; conserver plusieurs candidats ou plusieurs références si
nécessaire ; sinon déclarer et mesurer l'approximation. Rendre l'option de distance une décision de conception avant
H1 si H3 en dépend, plutôt qu'un ajout tardif après H4.

### 5.3 D n'est pas un paramètre global de la cuisson

Le plan définit `D = max(sortie de la carte du Soleil, 2 texels)`, puis cuit une carte globale une fois par corps HD.
Or la sortie de la carte solaire dépend du récepteur, de l'azimut solaire, de la position de la caméra, de la taille
du patch et des niveaux résidents. Une carte globale précuite ne peut pas avoir ce départ variable sans stocker
d'information sur la distance des bloqueurs ou sur plusieurs intervalles.

Si D est grand, un intervalle peut manquer lorsque la carte solaire se réduit. S'il est petit, la carte globale peut
réintroduire le relief grossier là où le raster fin devait faire autorité. Prendre `min` ne résout ni l'un ni l'autre.

Le calcul donné pour la Lune mélange aussi les résolutions : avec un rayon d'environ 1737 km, un texel équatorial vaut
environ 5,33 km à 2048 de large ; **deux texels font 10,7 km**, pas 5,4. Les 5,4 km correspondent à deux texels à 4096.
Pour Mars à 2048, deux texels font environ 20,8 km, pas 10,4. La latitude et la direction ajoutent leur anisotropie.
Il faut recalculer le raccord pour tous les paliers.

**Proposition :** des bandes de distance fixes couvrant les configurations autorisées, avec un repli dans les trous,
ou une structure capable d'interroger un horizon à partir d'une distance. Le coût mémoire de cette décision doit
précéder le choix « 8 directions, 2 couches ».

### 5.4 Mip moyenne et filtrage d'un encodage monotone ne préservent pas la visibilité

Pour une visibilité solaire `V`, la quantité utile au pixel est la moyenne de `V(horizon, Soleil)`, et non
`V(moyenne(horizon), Soleil)`. La non-linéarité de l'occultation interdit cette équivalence.

Contre-exemple : une moitié de pixel a un horizon haut et masque le Soleil, l'autre a un horizon bas et le voit
entièrement. La bonne couverture vaut environ une moitié. L'horizon moyen peut pourtant classer les deux moitiés
ensemble comme éclairées ou ombrées selon la hauteur du Soleil.

L'encodage en racine ajoute une autre non-linéarité. Sur la partie positive, décoder une moyenne de racines ne rend
pas la moyenne des valeurs. La monotonie conserve l'ordre de deux échantillons ; elle ne conserve ni leur moyenne
physique, ni un maximum, ni une couverture. Le filtrage matériel reste utilisable, mais son biais doit être assumé.

Un `smoothstep` sur le rayon solaire est une approximation visuelle. Pour un horizon localement droit et un disque
uniforme, la fraction visible suit une aire de segment circulaire, déjà proche du calcul utilisé par
`figureSunShare`. Une silhouette accidentée demande davantage d'information azimutale. Le PCF 3 × 3 terrestre ne donne
pas non plus, par lui-même, la taille physique d'une pénombre : son empreinte suit celle de la carte.

**Proposition :** distinguer les données pour la décision conservatrice et celles pour l'intégration visuelle.
Évaluer une approximation de distribution/couverture, plusieurs prises adaptées au pixel, ou un filtrage d'horizon
dont le biais soit mesuré. Ne pas utiliser les mips moyennes comme preuve d'occultation certaine.

### 5.5 Le min des ombres n'est pas une union physique générale

Pour une source ponctuelle et des visibilités binaires, `min` exprime correctement « bloqué par au moins une partie ».
Pour une source étendue, deux masques de pénombre peuvent couvrir des régions distinctes du Soleil.

Contre-exemple : deux bloqueurs cachent chacun une moitié différente du disque. Chacun rend une visibilité de 0,5 ;
leur `min` vaut encore 0,5, alors que le disque entier est masqué. Le produit ne serait pas correct non plus.

Le min évite certains doubles comptes ; il reste une approximation quand on combine uniquement des fractions
intégrées. Aux raccords, utiliser si possible une même direction échantillonnée sur le disque dans les différents
domaines, ou établir un budget d'erreur pour la combinaison choisie. Cela importe surtout au terminateur et aux pôles.

### 5.6 H3a : un maximum mesuré n'est pas une borne de pente

L'argument des accroissements finis est pertinent pour un champ de hauteurs suffisamment régulier et une borne globale
de sa dérivée dans la métrique adéquate. Le calcul proposé depuis le DEM chargé ne couvre pas automatiquement :

- l'overshoot des reconstructions et leurs transitions ;
- les tuiles plus fines que le DEM ;
- les cratères, arêtes et sols procéduraux ajoutés par `reliefBase` ;
- les variations de LOD, de domaine et de reconstruction.

Les rochers possèdent déjà un chemin d'ombre distinct (`rockLight`) : il faut borner précisément ce que H3a saute,
plutôt que demander un maximum universel de tous les objets. Une borne vraiment globale peut être si élevée qu'elle
ne donne aucun gain aux élévations courantes. Un maximum observé plus bas peut, lui, supprimer des ombres légitimes.

**Proposition :** borne analytique ou structure hiérarchique conservatrice des composantes concernées, avec marge
pour la reconstruction. À défaut, présenter H3a comme une optimisation approximative à risque visuel, pas une règle
exacte validée par quelques A/B. Mesurer son taux réel de déclenchement avant de lui attribuer un gain important.

### 5.7 La calotte règle la singularité ; elle ne fournit pas les données polaires manquantes

La stéréographie et les axes de grille sont de bons choix. Mais rééchantillonner le DEM global à 2–3 km dans une
calotte ne restitue pas les reliefs locaux perdus. Shackleton, ses rebords et les petites zones durablement ombrées
ne peuvent pas recevoir une garantie de fidélité locale avec cette seule source.

Les produits LOLA d'illumination publiés utilisent notamment 240 m et 60 m par pixel et des périodes longues ; des
DEM de sites à 5 m existent avec leurs incertitudes. Une comparaison sur un jour lunaire ne valide pas une ombre
permanente sur un cycle de nutation de 18,6 ans. [NASA, illumination polaire](https://pgda.gsfc.nasa.gov/products/69),
[NASA, DEM de sites polaires](https://pgda.gsfc.nasa.gov/products/78)

**Proposition :** conserver la calotte globale pour les grandes formes et décider d'un niveau régional pour la vue
prioritaire Shackleton. Aligner repère lunaire, hauteur du récepteur, période et résolution de comparaison.
Sans ces données, promettre un éclairage polaire plausible à grande échelle et documenter la limite locale.

### 5.8 H1b : une ressource visuelle distante ne doit pas déplacer le terrain physique

`requestHd` ne charge pas seulement une texture : il appelle `groundHeights`, qui change les échantillonneurs CPU et
peut sélectionner le monde de `moonTiles`. `releaseHd` les retire. Ajouter le corps regardé à cette logique nécessite
une séparation des responsabilités.

En mode relief distant, charger la Lune depuis la Terre doit rester une opération de rendu. La priorité `pin` garde
sa raison d'être, mais empêche aussi le nouveau résultat dans certaines configurations ; l'annoncer explicitement.
La sélection doit avoir une hystérésis temporelle et angulaire pour ne pas alterner les cuissons entre deux corps.

Prévoir une publication atomique du tuple `(corps, DEM, horizons, calottes, mode couleur, génération)`, l'annulation
des cuissons devenues inutiles et le traitement de la perte de device. Un simple booléen `ready` n'évite pas une carte
de l'ancien corps avec les paramètres du nouveau.

### 5.9 La portée et les références analytiques doivent inclure la courbure

La limite `0,1 R` est une heuristique. Une portée garantie doit découler des hauteurs maximales des bloqueurs et
minimales des récepteurs, de la courbure et du Soleil le plus bas pris en charge. Sur une sphère, à Soleil tangent,
la relation de premier ordre `Δh ≈ d² / (2R)` donne déjà le domaine pertinent. Pour Cérès, `R ≈ 470 km` et un
dénivelé hypothétique de 3 km donnent environ 53 km, au-delà des 47 km proposés. Cet exemple n'affirme pas qu'un tel
couple de points existe dans le DEM courant ; il montre pourquoi la portée doit être dérivée de ses données.

L'exemple « sommet de 5 km, Soleil à 2°, ombre à 140 km » utilise une Terre plate. Sur une Lune sphérique, la relation
`5 km ≈ d tan(2°) + d² / (2R)` donne plutôt environ 84 km. Le besoin d'ombres lointaines reste réel, mais les chiffres
de référence doivent utiliser la même géométrie que la cuisson.

Enfin, « sphère nue → horizon plat » doit préciser la valeur attendue : avec un départ à distance D strictement
positive, le premier point de la sphère est sous la tangente, à une élévation d'environ `−D / (2R)`. L'horizon n'est
zéro que si le domaine inclut la limite au contact, ou si l'on définit explicitement une autre convention. Un oracle
analytique mal défini pourrait valider un mauvais signe ou une mauvaise correction de courbure.

## 6. Réfraction : préserver la physique à travers tous les chemins

### 6.1 R3 : modifier `near.light` globalement compromet les éclipses et l'atmosphère

**Constat décisif.** `nearLight` lit `P.near4.xyz`. Dans `shadeLite`, cette direction fournit simultanément `Ls`, `Lp`,
`mu0`, `sunThrough`, `liteSun`, `liteSky` et la finition atmosphérique. `liteSun` appelle `sunSeen`, qui transmet `Ls`
à `sunSeenPhysical` pour comparer le Soleil à la position physique de la Lune. Les tables d'éclipse ne sont pas
déplacées avec une modification arbitraire de `near.light`.

Il ne suffit donc pas que les cartes d'ombre CPU lisent toutes la même direction : une correction globale peut
désaligner le calcul d'occultation Soleil–Lune et changer la diffusion de tout le volume atmosphérique. Le rayon
incident local n'est d'ailleurs pas identique au sol, à 3 km sur une crête et à 10 km dans un nuage.

**Proposition :** conserver une direction solaire géométrique de référence. Définir une direction incidente locale
et une transmission pour le point éclairé. Les éclipses utilisent une géométrie cohérente avec les directions des
deux astres ; les ombres locales utilisent la direction adaptée à leur domaine. Une direction commune sur une zone
bornée peut être une approximation rapide, mais son domaine et son erreur doivent être explicités.

Le critère « sol éclairé jusqu'à disparition du disque » est trop absolu : le relief peut l'occulter, l'extinction
affaiblit le flux, et la visibilité du disque varie selon le récepteur. Vérifier une diminution cohérente du flux et
de la fraction de Soleil visible. Les 2–3 minutes ne sont pas une constante universelle : la vitesse verticale du
Soleil dépend du lieu et de la date. NOAA rappelle aussi la variabilité atmosphérique des heures de coucher.
[NOAA, détails du calcul solaire](https://www.gml.noaa.gov/grad/solcalc/calcdetails.html)

### 6.2 R1 : définir le profil d'air avant de tabuler

Partager les profils d'`aero.ts` évite une duplication, mais `us76` renvoie actuellement `rho` et `T`, avec des couches
en hauteur géopotentielle convertie depuis la hauteur géométrique. Une intégrale optique a besoin de `n(h)` et de son
gradient, avec des interfaces et unités précises.

Ajouter un écart de température décroissant sur 1 km puis multiplier la densité standard par une pression ramenée
à la mer ne garantit pas l'équilibre hydrostatique. Une construction cohérente part d'une pression connue à une
altitude de référence et intègre `dP/dh = −rho g` avec le profil de température et la loi d'état. Préciser le passage
entre altitude météo, MSL/géoïde, altitude géométrique et hauteur géopotentielle. Le modèle standard et les conversions
existantes doivent être réutilisés sans confondre ces coordonnées.

La pression de surface dépend bien de l'élévation de référence ; la distinction du plan est utile. L'API expose
aussi une pression réduite au niveau de la mer, à examiner avant d'inventer une réduction concurrente.
[Open-Meteo, variables](https://open-meteo.com/en/docs)

Pour l'indice terrestre, documenter longueur d'onde, gaz sec/humide et domaine de validité. La température de surface
ne définit pas à elle seule un profil réel de réfraction. Le NIST fournit Ciddor et une version mise à jour d'Edlén
avec pression, température et humidité. [NIST, indice de l'air](https://emtoolbox.nist.gov/Wavelength/Documentation.asp)

R5 doit utiliser des réfractivités et dispersions propres aux gaz de Vénus et Titan. Une même masse volumique ne
donne pas le même indice pour l'air terrestre, le CO₂ ou un mélange N₂/CH₄.

L'API CPU a aussi une limite concrète : `refractDirection` n'accepte aujourd'hui aucune hauteur et appelle
`apparentAltitude` avec `h = 0`. Conserver cette signature sans préciser un contexte supplémentaire ne corrige pas
la visée en montagne ou en altitude. Définir une extension compatible et l'état d'air effectivement utilisé : un
seul scalaire N₀ ne distingue pas deux profils ayant le même indice au sol mais des gradients différents.

### 6.3 Les dimensions de LUT sont une hypothèse, pas une preuve de précision

Une table 64 × 256 est plausible. Il manque néanmoins : altitude zéro, altitudes négatives permises, zénith exact,
interfaces de couche, branche descendante bloquée par le sol, tangence et limite supérieure de l'air. Les nœuds
« 5 m → 86 km » ne décrivent pas tous ces cas. L'invariant de Bouguer suppose une symétrie sphérique et un profil
radial ; les conduits de R6 demandent une gestion de branches distincte.

Raffiner 512 périgées aux interfaces puis rééchantillonner à 2048 valeurs uniformes de k peut perdre la précision
acquise. Le critère de 3″ doit porter sur **la lecture finale interpolée**, dérivée comprise lorsqu'elle est utilisée
par Newton, et pas seulement sur l'intégrale préparatoire. Prévoir une résolution adaptative ou une autre variable
si l'erreur dépasse le budget dans les parties raides.

La promesse « deux lectures et un lerp » est trop générale : une interpolation bilinéaire de `B_haut` stockée dans
un buffer demande quatre valeurs ; une branche descendante lit aussi le limbe. Il faut compter les accès réellement
nécessaires et les conversions de coordonnées. Cela peut rester rapide, mais doit être chiffré correctement.

Le coût worker annoncé est lui aussi une hypothèse. Coalescer les changements d'air, annuler les générations
dépassées, publier le même état au CPU et au GPU et conserver un repli pendant le calcul. Une table déterministe
ne garantit pas un affichage sans saut si l'air change brutalement à la publication.

### 6.4 La précision doit être exprimée en pixels au grossissement utilisé

Le plan accepte selon les phases 3″, 0,1′ ou 0,1°. Ces valeurs répondent à des usages différents et ne sont pas
interchangeables.

Exemple géométrique, **pour un champ vertical de 0,02° et 1080 pixels** : le champ fait 72″, soit environ 0,067″ par
pixel près du centre. Une erreur de 3″ déplace l'image d'environ 45 pixels ; 0,1′ représente environ 90 pixels.
La tolérance `refraction-wgs84` de 0,2′ est utile pour la cohérence au champ du test, pas pour certifier la précision
au champ minimal.

**Proposition :** budget d'erreur projetée par mode : temps réel large, téléobjectif, photo accumulée, prédiction
astronomique. Une cible de départ serait ≤ 0,25 pixel pour les raccords et déplacements visibles, à valider par mode.
Si le coût ou les données ne permettent pas le maximum de grossissement, documenter un domaine de fidélité plutôt
que revendiquer un « 0,82 » universel. L'aplatissement dépend de l'élévation, du profil et de la définition mesurée.

Séparer erreur d'intégration, erreur de LUT, erreur d'interpolation, erreur de repère et incertitude de l'atmosphère.
Comparer au même modèle côté CPU et GPU vérifie leur accord ; cela ne vérifie pas l'accord avec la réalité.

### 6.5 Le repère aplati est une approximation optique à qualifier

L'aplatissement conserve la tangence géométrique et a corrigé un désaccord réel. Il ne rend pas l'atmosphère
ellipsoïdale physiquement équivalente à une atmosphère sphérique : une transformation anisotrope ne conserve ni
les angles ni la métrique des trajectoires optiques. Le plan ne doit pas confondre « horizontale correctement
transformée » et « intégrale de réfraction exacte sur WGS84 ».

**Proposition :** garder le correctif existant comme base, mais comparer latitude et azimut à une référence qui tient
compte de la courbure locale ou du gradient d'indice ellipsoïdal. Un rayon de courbure de section normale dépendant
de l'azimut peut suffire dans un domaine borné ; il faut en établir l'erreur. L'e2e de La Hague vérifie surtout
l'accord CPU/GPU dans sa configuration, pas toutes les géométries d'orbite.

### 6.6 R4 doit spécifier une projection optique réversible

La formule `k d² / 2R` est une approximation de trajet à courbure presque constante. Elle ne remplace pas une solution
générale pour un récepteur élevé, une vue descendante d'orbite ou un trajet traversant des couches très différentes.
La LUT de relèvement doit préciser hauteur de l'œil, hauteur du récepteur, définition de d et sens du rayon.

Le code actuel reconstruit notamment :

- `rasterPoint` par un rayon droit et `tM` ;
- les tests de scènes et de ponts à partir de ce rayon ;
- `seaScreen` par projection perspective droite, puis `seaSSR` compare à la profondeur raster ;
- `post.wgsl reprojDir` avec `P = direction × profondeur`, puis déplacement rigide ;
- l'occlusion des nuages et des étoiles depuis la visibilité et les distances existantes.

Si la visibilité représente une surface relevée mais qu'un de ces consommateurs l'interprète comme un point physique,
les symptômes seront des reflets mal placés, des contours fantômes, des objets flottants, une épaisseur d'air fausse
ou un rejet d'historique permanent. Défaire le relèvement seulement dans `shadeLite` est insuffisant.

**Contrat à écrire avant T5/R4 :**

1. `projectApparent(pointPhysique, œil, air)` définit la projection commune à tous les objets concernés.
2. Son inverse fournit le point physique depuis le pixel et la profondeur stockée, dans le domaine où il est unique.
3. Les distances physiques, apparentes et les longueurs optiques ont des noms et usages distincts.
4. Les cartes d'ombre restent dans leur géométrie d'éclairage ; l'occlusion de caméra utilise sa projection optique.
5. La reprojection transforme le point physique puis le reprojette avec l'œil et l'air de l'image précédente.
6. Le SSR et les intersections des chemins tracés utilisent une convention compatible ou un repli explicite.

Le relèvement doit couvrir aussi les objets mobiles visibles au loin : bateaux, avions, trafic, vaisseaux, selon
leurs chemins réels. Une liste de six shaders statiques n'est pas une preuve d'exhaustivité. Les reflets demandent
un trajet depuis la surface réfléchissante, qui n'est pas celui depuis la caméra.

Le seuil de 0,1′ doit être remplacé ou complété par un seuil projeté et un raccord continu. Un branchement dur peut
faire apparaître d'un coup tout le relèvement au passage du seuil.

### 6.7 R2/R5 : ne pas utiliser Danjon comme unique calibration d'une lentille atmosphérique

`earthRingLight` couple déjà déviation, Newton, extinction et défocalisation. Changer la déviation puis régler
les épaisseurs optiques pour retrouver une catégorie Danjon peut compenser une erreur par une autre. Une classe
visuelle globale ne contraint pas séparément radiance absolue, gradient spatial et couleur.

Il faut une référence physique commune pour déviation, transmission tangentielle et dérivée, puis des observations
indépendantes à exposition et traitement connus lorsque c'est possible. La dispersion multiplicative d'Edlén doit
être comparée au calcul spectral complet dans les zones raides ; l'argument du « second ordre » ne suffit pas près
d'une tangence, d'une forte magnification ou d'un conduit.

Pour Vénus/Titan, une lentille qui déplace seulement l'image du Soleil sans la transmission des gaz, aérosols et
nuages peut dessiner un arc provenant d'une couche opaque. Intégrer la largeur du pixel, le disque solaire, la
magnification et l'extinction du même trajet. Préciser le traitement des dérivées dans les noyaux compute, où une
empreinte doit être construite explicitement au lieu d'invoquer un `fwidth` implicite de fragment.

Enfin le besoin d'une table de la Terre pour une éclipse existe même lorsque la Terre n'est pas le corps proche.
« Une table par air » doit distinguer profil local météo, profil global de limbe et corps actuellement observé.

### 6.8 R6 : une direction finale de rayon ne suffit pas pour les mirages de terrain

Pour une source céleste à l'infini, la direction finale peut suffire à retrouver la radiance du ciel, avec sa
transmission. Pour un objet terrestre à distance finie, il faut savoir où passe le trajet courbe et ce qu'il rencontre.
Un rayon droit orienté suivant la direction de sortie ne suit pas ce trajet.

Rendre le pixel au traceur existant ne lui donne donc pas automatiquement un mirage de route ou une image inversée
du sol. Les retournements nécessitent un état de branche, des intersections compatibles et une intégration du
transport. L'approximation R4 à relèvement unique ne représente pas une projection multivaluée.

Le rendu des étoiles par trois points fixes, actuellement dans `shadeStars`, suppose lui aussi un inverse adapté.
Ignorer les images secondaires pour ces étoiles alors que le Soleil et le ciel se dédoublent doit être une limite
assumée. La visée choisit une branche nommée et stable ; elle ne peut pas prétendre viser toutes les images à la fois.

**Proposition pour R6a :** deux livrables distincts, l'un pour les objets célestes et le ciel, l'autre pour les objets
finis et le terrain. Décrire pour chacun les trajets et les images pris en charge. Ne pas promettre le « lac de route »
avec la seule LUT de direction du ciel.

Pour R6b, les températures à 2 m, du sol et sur quelques niveaux de pression ne déterminent pas les gradients des
premiers centimètres ou mètres. Plusieurs profils très différents peuvent correspondre aux mêmes valeurs. La SST
marine documentée est elle-même issue d'une grille d'environ 8 km avec un pas de plusieurs heures.
[Open-Meteo, données marines](https://open-meteo.com/en/docs/marine-weather-api)

La conclusion est une limite d'inférence : on peut produire un profil **plausible conditionné par la météo**, pas
garantir un mirage documenté au bon jour et son absence les autres jours. Conserver le go/no-go de recherche de R6b,
mais remplacer ce critère binaire par des cas documentés avec profil mesuré quand il existe, et une incertitude
affichée dans TARS. Ne pas présenter un tirage plausible comme une observation.

## 7. Performance : remplacer les promesses de coût nul par des contrats mesurables

### 7.1 Une passe séparée occupe toujours le même GPU

La cuisson H1 représente déjà environ `2048 × 1024 × 8 × 3 × 16`, soit 805 millions de prises de hauteur pour la seule
carte globale de base. À 4096 × 2048, c'est quatre fois plus, avant calottes et mips. Les pas réels dépendent de D.
La fourchette 30–100 ms n'est pas démontrée par ce comptage ; le cache, les mips, les calculs trigonométriques et le
matériel changent radicalement le débit.

Étaler 2–4 ms par image est une charge visible sur un budget de frame serré. Le coût n'est pas annulé par la séparation
du noyau de cuisson. Prévoir une ordonnance adaptative, bornée par le temps disponible, et une réduction/annulation
si le corps n'est plus regardé. Mesurer le temps total jusqu'à une carte utilisable et l'effet sur les images de
transition, pas seulement le rendu une fois la cuisson terminée.

De même, zéro coût hors du limbe signifie au mieux une voie rapide très bon marché. Le test de zone, les registres,
le code compilé et la divergence ont encore un coût potentiel. Les budgets de taille inlinée protègent de certaines
régressions de compilation ; ils ne remplacent ni le temps de compilation ni le temps GPU réel.

### 7.2 T10 finance de la mémoire résidente, pas tous les pics du plan

Le calcul de l'économie est crédible : huit fenêtres 1024² compactées au lieu de huit couches 2048² libèrent environ
201 MB, soit 192 MiB, dans le format de 8 octets actuel. Les 13 couches actuelles totalisent environ 436 MB / 416 MiB.
Le rangement idéal décrit amène sept couches, soit environ 235 MB / 224 MiB, hors autres ressources.

Mais il faut ajouter ensuite :

- les mips de la nouvelle couleur T9, environ un tiers de sa base supplémentaire ;
- les fenêtres d'orthos agrandies de T8 ;
- DEM, horizons et calottes, éventuellement leurs anciennes et nouvelles générations ;
- l'attache T5, les profondeurs et les ressources retirées après redimensionnement ;
- les images décodées, buffers de transfert et caches CPU, qui comptent dans la mémoire partagée des Mac et iPad.

Pendant une migration, ancienne et nouvelle texture peuvent coexister : le code actuel conserve déjà l'ancienne
jusqu'à la fin du travail soumis. T10 ne garantit donc pas à lui seul que H1b et H1 tiennent sur tous les appareils.
Établir un budget résident **et un budget de pic**, avec repli d'allocation et priorité de ressources.

### 7.3 Le décompte des textures oublie T5 et éventuellement R4

Le palier complet actuel atteint 27 textures échantillonnées. H ajoute deux ressources, T9 une, et une nouvelle
attache de normales lue par les kernels en ajoute normalement une autre si elle n'est pas regroupée ou substituée.
Avec un layout commun étendu ainsi, on vise donc potentiellement **31**, pas 29 ou 30. Une attache de profondeur
physique séparée pour R4 peut encore changer le résultat.

Le numéro de liaison 42 n'est pas le nombre de textures ; le nombre de couches d'un array ne l'est pas non plus.
Faire le décompte à partir des layouts par stage, avec samplers, buffers, storage textures et attaches couleur.
Si les layouts sont spécialisés, montrer le décompte par pipeline. Valider les paliers autour de la limite réelle,
et pas seulement 16, 28 et 48 parce qu'ils figurent déjà dans le plan.

### 7.4 M0 doit conserver un vrai « avant »

Mesurer uniquement après T1/T2 empêche d'isoler leur régression éventuelle et d'établir le coût total du plan.
Les escaliers ne rendent pas une mesure de temps GPU invalide ; ils font partie de l'état initial à corriger.

**Proposition :** M0a avant toute modification, puis M0b après T1/T2 pour les références détaillées qui en bénéficient.
Conserver les mêmes vues, tailles, FOV, taux d'ombrage et conditions. Le gouverneur peut masquer une régression de
temps en baissant la qualité : publier aussi résolution effective, fréquence d'ombrage et stabilité de l'image.

Ajouter régime stable, chargement froid, vol, recentrage, changement d'air et changement de corps. Rapporter GPU par
passe, CPU, intervalles de frame et leurs queues de distribution, transferts et mémoire de pic. L'objectif de départ
« aucune phase plus lente » doit être distingué du coût cumulé : plusieurs +0,3 ms ne deviennent pas nuls ensemble.

« Jamais plus lent que la Terre » reste une comparaison utile du projet, mais n'est pas une cible de jouabilité :
une Terre déjà lente n'est pas un budget AAA. Fixer des objectifs absolus par appareil et par mode avec Sam.

## 8. Photoréalisme : les contrôles manquants

### 8.1 L'imagerie actuelle n'est pas automatiquement de l'albédo

Les orthophotos et mosaïques contiennent des ombres, de la lumière et des différences de saison déjà enregistrées.
`orthoColour` effectue un ajustement de luminance/couleur ; `shadeLite` multiplie ensuite le résultat par l'éclairage
du moteur. T6 peut donc ajouter des ombres à celles de la photographie, sans que le lieu ni l'heure correspondent.

Il n'est pas nécessaire d'ouvrir maintenant un chantier complet de dé-éclairage mondial. En revanche, pour annoncer
du photoréalisme, le plan doit inclure des vues de référence où ce double éclairage est visible, une politique
d'albédo par source et des limites assumées. Des mips sRGB correctes améliorent le filtrage ; elles ne retirent pas les
ombres photographiées. Conserver aussi le sens des canaux alpha existants, notamment les lumières nocturnes.

### 8.2 Une silhouette et un terminateur ne se valident pas avec le pourcentage global de pixels changés

Une ombre fausse sur 0,5 % de l'image peut détruire l'intérêt d'un cratère au télescope ; un changement correct de
terminateur peut dépasser 2 %. Séparer les régions attendues : silhouette, pénombre, soleil, côte, coutures, terrain
non concerné. Mesurer déplacement de contour, fuite de lumière, faux ombrage et scintillement sur ces régions.

Une photo à la même colongitude n'a pas nécessairement les mêmes librations, latitude solaire, perspective,
résolution, exposition ni traitement. La référence doit être recalée avec ces paramètres. Sinon on peut régler
l'algorithme pour compenser une différence d'observation.

### 8.3 Une capture après convergence ne valide pas le rendu AAA en mouvement

Les gains doivent survivre aux déplacements, changements de LOD, chargements et réglages météo. Un fondu qui ramollit
tout le paysage peut satisfaire « aucun pop » tout en dégradant la netteté. L'accumulation peut cacher un aliasing
sur une image fixe et le transformer en traînée ou en pétillement en vol.

Le document de livraison doit montrer des séquences et des mesures temporelles, avec fréquence d'ombrage connue.
Le mode photo accumulé et le temps réel doivent partager les mêmes surfaces et conventions optiques ; le nombre
de prises peut varier, pas la géographie des ombres.

## 9. Ordre recommandé, sans remplacer les décisions de Sam

Le départ après les géantes, H avant les grandes phases R, R3 en premier des R, H5 optionnel et R4a/R4b ensemble
restent les décisions du plan. Les changements ci-dessous sont des **propositions d'amendement**, pas des décisions
déjà prises.

1. **M0a et contrats courts de conception.** Capturer l'état initial ; définir surface de raccord, générations,
   stockage des tuiles, projection optique et précision. Aucun besoin d'implémenter R4 ou H pour écrire ces contrats.
2. **T1 et T2, puis M0b.** Garder T1 comme première expérience bornée, avec décision conditionnelle si les marches
   persistent. Le petit correctif de T2 reste prioritaire.
3. **T6 et R3, avec périmètre maîtrisé.** Résoudre la visibilité proche et le Soleil géométrique/local avant livraison.
   Si les géomorphoses arrivent plus tard, partager dès maintenant la fonction de surface que la carte solaire lira.
4. **T10, suivant l'architecture cible de T8/T9.** Libérer la mémoire sans créer un format immédiatement jetable.
5. **H3a seulement avec une borne justifiée ; H1/H1b/H2 sur un cas pilote.** Établir d'abord les erreurs et le coût sur
   un corps, un raccord proche/lointain et le cas polaire. Étendre les résolutions et les corps après cette décision.
6. **H3 après validation des domaines de distance et des bornes.** Ne supprimer la marche reprise que là où son
   remplacement est démontré. H4 doit être une porte de décision dès le cas pilote, pas uniquement la clôture.
7. **T3/T4/T5 comme ensemble de cohérence**, livrable par étapes, avec surface, normales et ombres synchronisées.
   Le contrat R4 doit déjà guider l'attache et les profondeurs.
8. **T7, puis R1/R2, R4, R5 et R6a**, avec les limites et contrats décrits plus haut. La partie terrain de R6a doit
   être estimée séparément de la déformation du ciel.
9. **T8/T9 peuvent être livrés plus tôt** si le cas pilote confirme leur priorité et si leur architecture est prête.
   Les laisser systématiquement après les mirages retarde deux bénéfices visibles dans presque chaque vol.
10. **R6b reste une recherche avec go/no-go. H5 reste soumis au jugement de Sam après T6.**

Les économies de performance doivent financer une enveloppe de qualité explicite. On peut accepter un coût local
pour un gain visible, mais pas le masquer par une baisse automatique de résolution ou de fréquence d'ombrage.

## 10. Critères de sortie proposés pour une campagne future

**Rien de cette campagne n'a été exécuté pendant cet audit.** Les seuils ci-dessous sont des contrats à confirmer,
pas des résultats ni une demande de lancement.

### Terre et données

- Coutures et silhouettes : erreur projetée cible ≤ 0,25 pixel dans les vues de livraison, y compris recentrages,
  rapports de grille 2/4, coins et arrivées de sources. Contrôle géométrique indépendant de la normale lissée.
- Contact : terrain, pistes, pieds des bâtiments et arbres cohérents pendant les transitions ; comparaison à la
  reconstruction physique pertinente, sans prétendre à un LiDAR exact là où seules des données SRTM existent.
- Ombres : scène analytique avec talus proche, crête dans la carte et chaîne au-delà ; aucun intervalle laissé
  implicitement éclairé par le biais ou le raccord. Vérification séparée des pénombres.
- Texture : continuité aux bords des tuiles, du tore et des quadrants, aux mips utilisées en vue rasante ; cas de
  voisins absents et de réponse réseau tardive.
- Eau : classe correcte sur côtes et terres basses de référence, niveau géométrique cohérent, reflet stable lorsque
  sa source entre ou sort de l'écran et lorsque la caméra avance.

### Horizons

- Référence de visibilité indépendante sur les cas analytiques et patchs réels ; distinguer faux éclairage et fausse
  ombre. Une erreur angulaire unique de 0,1° n'est pas suffisante pour toutes les tailles solaires.
- Sorties anticipées : aucune erreur sur les domaines déclarés conservateurs ; ailleurs, marge d'incertitude et repli.
- Variation de hauteur du récepteur et changement du bloqueur dominant ; pic étroit entre rayons ; azimut solaire
  traversant une frontière de secteur ; pixel couvrant simultanément une plaine et une crête.
- Raccords : petite/grande carte solaire, limite de couverture, modes sans carte, changement de corps et calotte.
- Pôles : référence à même échelle, hauteur et période ; ne pas déduire une permanence d'un seul jour simulé.

### Réfraction et chaîne d'image

- Oracle d'intégration indépendant des LUT de production ; comparaison de la lecture finale CPU et GPU à cet oracle.
- Domaine standard, montagne, altitude négative autorisée, tangence d'orbite, équateur et hautes latitudes, plusieurs
  azimuts, changements de profil. Vérifier aussi les dérivées utilisées par les inversions.
- Budget en pixels par FOV et résolution, pour Soleil, Lune, étoiles, visée et labels ; budget physique distinct de
  l'incertitude des conditions réelles.
- Éclipse basse sur l'horizon : pas de désalignement créé par R3 ; R5 borné par une transmission cohérente.
- R4 : mêmes points physiques reconstruits dans matériau, eau, ombres, nuages et temporel ; pas de traînée lors d'un
  déplacement ou d'une transition météo ; objets mobiles soumis à la même projection.
- R6 : branche directe et branches secondaires explicites ; référence de trajet pour les objets finis.

### Performance et livraison

- Même qualité effective pour les comparaisons ; temps GPU par passe et intervalles de frame, médiane et queues,
  résolution/taux d'ombrage enregistrés, comparaisons répétées dont le bruit est connu.
- Rendu stable et transitions budgétés séparément : cuisson, source fine, changement de corps, mémoire, compilation.
- Temps jusqu'à une qualité visible définie et quantité de données chargées ; cache froid/chaud et réseau dégradé.
- Allocation résidente et pic cohérents avec les paliers ; repli explicite sans device perdu ni boucle de tentative.
- TARS et `__bh` exposent génération, source/résolution, statut de cuisson, approximation active et état d'air.
  Cela rend les images et les mesures interprétables.

## 11. Estimations et décisions à rouvrir

Les 29–34 jours ne sont pas défendables comme engagement à ce stade. Cela ne prouve pas un total alternatif : sans
cas pilote ni mesure autorisée, annoncer 45 ou 60 jours serait tout aussi spéculatif.

Les phases les plus sous-spécifiées sont T3/T4/T5, T8/T9/T10, H1/H3 et R4/R6a. Leur estimation doit inclure le travail
sur les consommateurs oubliés, les cas de repli et les transitions, pas seulement le premier shader qui fonctionne.
R5 ne peut pas être qualifié de faible risque sur la seule réutilisation d'une formule de déviation.

À décider avant les phases concernées :

1. Quel niveau de fidélité est garanti au téléobjectif maximal et autour de Shackleton ?
2. Quelle représentation d'horizon permet le raccord en distance et les sorties anticipées réellement sûres ?
3. Quelle convention commune de point physique/profondeur/projection guide T5 et R4 ?
4. Quelle architecture finale unit T8/T9/T10 et quel budget de pic l'autorise ?
5. Quelles cibles absolues de fluidité et de qualité effective sont retenues par appareil et par mode ?
6. R6a livre-t-il d'abord les mirages célestes, puis les mirages de terrain avec un vrai modèle de trajet fini ?

Les décisions déjà prises par Sam ne sont pas annulées. En revanche, le §11 « aucune question ouverte » du plan
devrait être amendé : plusieurs choix mathématiques et de représentation conditionnent encore sa faisabilité AAA.

## 12. Repères de code et références

Les numéros de ligne sont des repères de lecture au moment de l'audit ; les fonctions font foi.

| Sujet | Sources examinées |
|---|---|
| Reconstruction terrestre | `src/shaders/trace.wgsl` : `monoCubic` ~6723, `tileSample` ~7060, `earthSlopeFine` ~7380 ; `src/system/earth-tiles.ts` : `sampleLevel` ~1396, `heightAt` ~1218 |
| Fenêtres et cache | `src/system/terrain-cache-layout.ts` ; `src/system/terrain-cache.ts` : `encode` ~228, publication ~308 ; `src/renderer.ts` : `terrainRings` ~8564 |
| Surface raster | `src/system/terrain-raster.ts` : `terrainPoint` ~32, `terrainVs` ~68, `terrainSunVs` ~81, `drawRing` ~515, `encodeSunShadow` ~584 |
| Carte solaire et portée | `src/system/terrain-raster-hint.ts` : `withSunShadow` ~54, `sunShadowFar` ~70 ; `src/renderer.ts` : `SUN_HALF_M` ~8305, `encodeSunShadow` ~8313 |
| Ombres et lumière | `src/shaders/trace.wgsl` : `nearLight` ~4704, `nearShadow` ~4760, `sunThrough` ~5625, `sunSeenPhysical` ~5649, `earthTerrainShadow` ~7441, `liteSun` ~13071 |
| Relief ajouté | `src/shaders/trace.wgsl` : `reliefMax` ~4165, `craterRelief` ~4252, `reliefBase` ~4433, `airlessRocks` ~4866 |
| HD et effets de bord | `src/system/hd-maps.ts` : `loadHdMap`, DEM ~366 ; `src/renderer.ts` : `releaseHd` ~1828, `groundHeights` ~1840, `requestHd` ~1881, choix HD ~3185 |
| Résidence des tuiles | `src/system/earth-tiles.ts` : constantes ~33, `makeTexture` ~539, `setReach` ~555, `request` ~776, `load` ~838, `put` ~927, `complete` ~981, `params` ~1017 |
| Mer et projection | `src/shaders/trace.wgsl` : `seaWavesFft` ~8205, `seaScreen` ~8580, `seaSSR` ~8650, `shadeWater` ~13674 |
| Profondeur et historique | `src/shaders/trace.wgsl` : `rasterRay` ~13013, `rasterPoint` ~13022, `shadeLite` ~13333 ; `src/shaders/post.wgsl` : `reprojDir` ~653, `temporal` ~711 |
| Réfraction et atmosphère | `src/system/refraction.ts` ; `src/aero.ts` : couches ~88, `us76` ~138 ; `src/openmeteo.ts` : `parseOpenMeteo` ~86 ; `src/shaders/trace.wgsl` : `earthRingLight` ~2268, `airBend` ~10707, `shadeStars` ~14302 |
| Contrats GPU | `src/renderer.ts` : layout ~1220, `requestDevice` ~1975 ; `src/gpu-tables.ts` ; `src/shaders/mips.wgsl` ; `src/bench/vram.ts` |
| Tests lus, non exécutés | `tests/refraction.test.ts`, `tests/earth-tiles.test.ts`, `tests/e2e/refraction-wgs84.e2e.test.ts`, `tests/e2e/moon-telescope.e2e.test.ts` |

Références externes primaires utilisées dans l'analyse :

- [WebGPU : formats et fonctionnalités](https://www.w3.org/TR/webgpu/#texture-format-caps),
  [limites](https://www.w3.org/TR/webgpu/#limits), [samplers](https://www.w3.org/TR/webgpu/#sampler-creation).
- [WGSL : `textureSampleGrad`](https://www.w3.org/TR/WGSL/#texturesamplegrad-builtin).
- [NVIDIA : Terrain Rendering Using GPU-Based Geometry Clipmaps](https://developer.nvidia.com/gpugems/gpugems2/part-i-geometric-complexity/chapter-2-terrain-rendering-using-gpu-based-geometry).
- [NIST : indice de l'air, documentation Ciddor/Edlén](https://emtoolbox.nist.gov/Wavelength/Documentation.asp).
- [NOAA : hypothèses et limites des calculs solaires](https://www.gml.noaa.gov/grad/solcalc/calcdetails.html).
- [NASA/GSFC : Lunar Polar Illumination](https://pgda.gsfc.nasa.gov/products/69),
  [High-Resolution LOLA Topography for Lunar South Pole Sites](https://pgda.gsfc.nasa.gov/products/78).
- [Open-Meteo : API atmosphérique](https://open-meteo.com/en/docs),
  [API marine et résolution des données](https://open-meteo.com/en/docs/marine-weather-api).

**Aucune amélioration de performance ni correction visuelle n'est déclarée acquise dans ce document.** Il définit les
conditions techniques qui permettraient de les revendiquer honnêtement lors de l'implémentation.
