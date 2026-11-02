# La Terre en qualité Unreal Engine 5 — ce qui manque, ce qu'il faut faire (analyse du code, 2026-11-02)

Lecture **du code seulement**, rien lancé. Quatre lectures en profondeur, puis les constats lourds revérifiés à la main :
- le sol et sa lumière ;
- l'air, le ciel et les nuages ;
- le décor (arbres, bâtiments, routes) ;
- le pipeline raster, le gouverneur et le post.

**[V]** = vu dans le code (fichier:ligne). **[P]** = plausible, à confirmer à l'image. Sans marque = proposition.

Les numéros de ligne de `trace.wgsl` et `renderer.ts` bougent (d'autres sessions y travaillent) ; les noms de fonctions font
foi.

Complète [ANALYSE-TERRE-RASTER-2026-11-02.md](ANALYSE-TERRE-RASTER-2026-11-02.md) (escaliers, triangles, ombres du relief,
mer, chargement) et le plan commun [PLAN-REFRACTION-HORIZONS.md](PLAN-REFRACTION-HORIZONS.md) (T1–T10, H, R) : ce qui y
est déjà prévu n'est pas répété, seulement relié.

## En bref

Le raster de la Terre a la bonne architecture (visibilité rastérisée, un matériau par pixel, cartes d'ombre, table
aérienne, nuages en demi-résolution) et de très bonnes données (IGN, Sentinel-2, BD TOPO, LiDAR). Ce qui le sépare
d'Unreal tient en cinq points :

1. **La lumière du sol est celle d'un jeu de 2010** [V] :
   - un Lambert pur, sans spéculaire au Soleil ;
   - un ciel plat (l'irradiance horizontale × ½(1 + n·up)), sans aucune occlusion ambiante ;
   - un rebond à albédo fixe qui ignore les nuages ;
   - la photo garde ses ombres cuites, et on lui ajoute les nôtres.
2. **Les villes perdent tout leur matériau en raster** [V] : le riche `buildingLook` (façades, fenêtres, matériaux et
   couleurs BD TOPO / Overture, fenêtres allumées la nuit) ne tourne que dans le noyau tracé. En raster, les murs sont
   un beige constant à fenêtres sombres, les toits la photo désaturée.
3. **L'image en mouvement n'est ni nette ni pilotée** [V] :
   - le gouverneur est inerte en raster (l'échelle est clouée à 0,75) ;
   - l'image à 0,75 est agrandie sans affûtage (RCAS seulement à pleine taille) ;
   - pas d'upscaler temporel par défaut, pas de vecteurs de mouvement.

   Sur le mini, 41–47 ms pour un budget de 18.
4. **L'air est dessiné trois fois trop épais** (`AIR_K = 3`) et sa diffusion multiple est une constante [V] : brume
   basse trop faible, heure bleue et crépuscule faux, pas de rayons d'ombre des montagnes.
5. **Le lointain est vide de volume** [V] :
   - au-delà de 750 m, plus d'ombres d'arbres ni de bâtiments ;
   - au-delà de ~2,6 km, plus d'arbres ;
   - au-delà de 6 km, plus de décor (sauf les silhouettes IGN cuites dans le relief, en France) ;
   - les forêts lointaines sont une couleur plate.

Les gains de performance identifiés (§6) **paient** l'essentiel des ajouts de qualité.

---

## 1. La lumière du sol (`shadeLite`)

### Ce que fait le code [V]

`G = A/π · (Eg·max(n·L, 0) + sky·½(1 + up) + bounce + E·lune)` (`trace.wgsl` ~13544), avec :

| Terme | Aujourd'hui | Défaut |
|---|---|---|
| Diffus | Lambert | pas de BRDF de végétation (le « point chaud » autour de l'ombre de l'avion, l'effet d'opposition) |
| Spéculaire | aucun au Soleil sur la terre ; un Fresnel « ciel » pour le sol mouillé et les vitres, qui reflète l'**irradiance** et non la radiance réfléchie | pas de reflet du Soleil sur une route, un toit de zinc, une serre, un sol mouillé |
| Ciel | `skyFlat(q)` : l'irradiance du plan horizontal (un SH d'ordre 2 cuit à la caméra) × ½(1 + up) | le SH sait faire mieux (la normale vraie) mais n'est jamais évalué avec elle ; **aucune occlusion** : une vallée encaissée reçoit le ciel entier |
| Occlusion ambiante | **aucune** (pas de SSAO/GTAO, pas d'horizon) | le défaut le plus « non-Unreal » de l'image |
| Rebond | `(Esun·μ0 + ciel)·0,18·½(1 − up)` | albédo fixe 0,18 ; **ignore les nuages** (plein soleil rebondi sous un ciel couvert) |
| Albédo | les photos (Blue Marble, EOX 2021, IGN) recolorées par des ajustements globaux | **pas de « dé-éclairage »** : les ombres d'arbres et de bâtiments, l'estompage du relief des photos restent, et nos ombres temps réel s'y ajoutent (deux fois) |
| Détail sous la photo | `surfaceMaterial` (bruit d'albédo par classe WorldCover) | **éteint par défaut** (`earthSurface: "satellite"`, `settings.ts:720`) et limité à deux régions pilotes : sous ~0,4 m (IGN) ou 10 m (Sentinel), rien |
| Neige, saisons | aucune en raster (le traceur a une ligne de neige fixe) ; la photo est un été 2021 | pas de neige l'hiver, pas d'automne au sol (les arbres, eux, ont leurs saisons) |
| Nuit | lumières VIIRS 2016 (~611 m le texel), gain selon l'altitude de la caméra ; plancher de nuit ≈ pleine Lune | pas de lampadaires, pas de flaques de lumière ; la nuit sans Lune ≈ la nuit de pleine Lune (×2 au lieu de ×100) ; la luminosité du sol change en montant |
| Filtrage | imagerie filtrée **en sRGB** puis décodée | petit biais de couleur ; réglé par T9 |

### Propositions (par effet visible / coût)

| # | Proposition | Effet | Coût estimé | Risque |
|---:|---|---|---|---|
| L1 | **Ciel directionnel** : `skyIrradiance(h, n)` avec la normale vraie (lisse, T5) et les rapports de `skyFlat` | les pentes tournées vers le ciel clair s'éclairent, le relief « sort » | ~20 ALU | faible |
| L2 | **Occlusion du ciel à deux échelles** : (a) GTAO demi-résolution sur la profondeur exacte du raster, appliqué au ciel et au rebond seulement ; (b) la **visibilité du ciel du relief** tirée de la carte d'horizon de la Terre (H5 étendu à 8 directions : ombres pour tout azimut **et** occlusion des vallées) | le « look Unreal » : creux, pieds de murs, sous-bois, vallées assombris | (a) 0,3–0,6 ms ; (b) 1–2 lectures | (a) bord du cockpit, bruit temporel ; (b) faible |
| L3 | **Ombres de contact** : 8–16 pas en espace écran le long du Soleil sur la profondeur raster | les petits reliefs et objets sous le texel des cartes d'ombre | ~0,2 ms | faible |
| L4 | **Spéculaire GGX par matériau** : classe par WorldCover (ou couleur, comme `earthCover`) → rugosité et F0 (asphalte, toits de zinc ou d'ardoise, vitres, serres, sol mouillé avec un lobe solaire) ; reflets du ciel par `skyMirror(reflect)` | les routes et les toits qui brillent au Soleil rasant, les serres et les vitres qui scintillent : très photoréaliste vu d'avion | ~30 ALU | faible |
| L5 | **BRDF de la végétation** (Ross-Li ou RPV, normalisée à 1 au nadir) : le **point chaud** autour du point antisolaire, le côté contre-jour plus sombre | ce que toutes les photos aériennes montrent et que les moteurs oublient | quelques ALU | faible |
| L6 | **Rebond juste** : sous les nuages et la météo, avec l'albédo local (mip grossière) | plus de lumière fantôme sous le couvert | ~0 | faible |
| L7 | **Photos dé-éclairées**, au décodage (worker) : estompage inverse par le MNT et le Soleil de prise de vue (Sentinel-2 ≈ 10 h 30 solaire) ; pour l'IGN, éclaircissement des ombres portées repérées par le MNS / BD TOPO et l'azimut du vol | fin des doubles ombres, un sol qui réagit vraiment à notre Soleil (au couchant, la photo de midi ne trahit plus) | CPU ; 0 GPU | **moyen à élevé** (contrôle qualité) |
| L8 | **Matériaux de détail par classe** (albédo + normale tuilables, tuilage stochastique, triplanaire sur les pentes), fondus de 0 à ~300 m, branchés sur la classe WorldCover des cellules du décor (pas seulement les régions pilotes) | le sol de près cesse d'être une photo floue : herbe, labours, graviers, rocher | 2 textures ; ~0,3 ms | budget de textures (§6) |
| L9 | **Neige et saisons** : la neige et la roche du traceur portées en raster (pente, exposition, jour de l'année) ; puis la neige réelle (couche quotidienne de neige MODIS/VIIRS si GIBS la sert — **à vérifier**, ou NOAA IMS) ; un étalonnage saisonnier par classe (climatologie de NDVI) | l'hiver existe ; les Alpes enneigées selon la date | moyen | moyen |
| L10 | **Nuit physique** : la radiance des villes fixe (l'exposition fait le reste), la nuit sans Lune 50–100 × plus sombre que la pleine Lune, des lampadaires tirés des routes OSM près de la caméra (flaques de lumière orange/blanche), les fenêtres allumées (via B1) | la nuit d'un jeu AAA : des rues, pas une texture orange | moyen | moyen (exposition) |

---

## 2. Les villes et le décor

### Ce que fait le code [V]

- **Bâtiments** : sources riches.
  - En France, BD TOPO : hauteurs, toits et matériaux mesurés, faîtages LiDAR. Ailleurs, Overture.
  - Toits à 5 formes, parapets, cheminées. Maillages à 2 km, boîtes au-delà.
  - Mais **en raster** :
    - les murs sont `(0,5 ; 0,46 ; 0,39)` à ±17 % par îlot de 25 m, avec une grille de fenêtres sombres ;
    - les toits, la photo à 20 % de sa couleur (`trace.wgsl` ~13472–13488) ;
    - aucun matériau, aucune couleur des données, aucune fenêtre allumée la nuit.
  - Les boîtes lointaines sont alignées est/nord, pas sur le bâtiment : jusqu'à ×2 trop larges.
- **Arbres** :
  - 6 espèces, saisons réelles (printemps, automne, branches nues, neige). Hauteurs IGN en France, plafonnées à 33,5 m ;
    couronne ≤ 3,3 m quelle que soit l'espèce.
  - **Aucun vent** (aucune entrée de temps dans `forest.wgsl`).
  - Écartés sous 2,5 px (~2,6 km) ; ombres jusqu'à 750 m ; au-delà, la couleur de la photo.
- **Routes** : `scenerySurface` (chaussées, marquages, rails) n'est appelé que par le sol tracé (`trace.wgsl:9377`) :
  **en raster, les routes ne sont que celles de la photo**.
- **Les objets des aérodromes du jeu** (tour, hangars, avions, manches à air) ne sont testés que dans `earthNear` :
  **[P] invisibles en raster**.
- **Les lumières des villes** s'ajoutent aussi aux couronnes d'arbres et aux murs (pas d'exclusion `isTree`/`mesh`).

### Propositions

| # | Proposition | Effet | Coût | Risque |
|---:|---|---|---|---|
| B1 | **Le matériau des bâtiments en raster** : l'indice du bâtiment écrit dans un canal libre de la cible de visibilité (`meshFs`, `boxSolidVs`), un `buildingLook` allégé appelé par `shadeLite` (murs, fenêtres, couleurs et matériaux des données, vitres au GGX de L4, fenêtres allumées la nuit) ; toits par matériau (tuile, ardoise, zinc) en gardant la lumière de la photo | **le plus gros saut visuel sur les villes**, de jour comme de nuit | une lecture par pixel de bâtiment | faible |
| B2 | **Façades et toits PBR** : petits atlas tuilables par région, matériau et usage (haussmannien, pavillon, tour de verre…), normales des tuiles et ardoises ; débords de toit | les façades de près, au roulage, à basse altitude | 1–2 textures | moyen |
| B3 | **Boîtes lointaines orientées** sur le bâtiment (ou petits prismes simplifiés) | silhouettes justes des villes à 2–6 km | ~0 | faible |
| B4 | **Les routes en raster** : un `scenerySurface` allégé dans `shadeLite` (asphalte en L4, marquages, trottoirs, sol mouillé), ou une passe de « décalques » qui rastérise les routes dans un tampon | les routes nettes, les marquages, l'asphalte qui brille | ~0,2–0,5 ms | moyen |
| F1 | **Le vent** : un balancement par arbre (phase, rafales de la météo), identique dans `forest.ts` (CPU) et le shader | le monde vit ; un moteur AAA ne montre jamais une forêt figée | ~0 | faible à moyen (CPU = GPU) |
| F2 | **La forêt lointaine en canopée** (2,5–30 km) : une couche hauteur de canopée × couverture, ombrée comme une surface rugueuse auto-ombrée (horizon de la canopée, BRDF L5), cuite avec le relief ; le plan Monde vivant A4 l'avait prévue, jamais faite | plus de « moquette verte » au loin : du volume, des lisières, des ombres de massifs | moyen | moyen |
| F3 | **Imposteurs octaédriques** (albédo, normale, profondeur) par espèce et saison au lieu des octaèdres lointains | des arbres justes jusqu'à 2–4 km ; plus d'anneaux autour des couronnes | moyen | moyen |
| F4 | **Couronnes à la taille de l'espèce** (chênes et pins parasols larges), hauteur au-delà de 33,5 m | silhouettes de forêts crédibles | ~0 | faible |
| S1 | **Ombres du décor en cascades** (U3, jamais fait) : 2–3 cascades jusqu'à ~5 km, ou une carte « virtuelle » à pages ; les arbres lointains ombrés par F2 | plus de fondu des ombres à 750 m ; les villes et les forêts ont des ombres à toute distance | +1–2 ms (à récupérer en §6) | moyen |
| A1 | **Les objets des aérodromes en raster** [P] : instances (comme les arbres) ou rendus au noyau tracé | les aérodromes du jeu complets en vol | faible | faible |
| D1 | **Ce qui n'existe pas** : voitures et trafic routier (OSM, densité par classe de route, phares la nuit), mobilier urbain, éoliennes, pylônes et lignes à haute tension, vignes et vergers (classes WorldCover + OSM `landuse`) | le monde habité ; d'avion, les lignes HT et les éoliennes sont des repères majeurs | grand | moyen |

---

## 3. L'air, le ciel, les nuages

### Ce que fait le code [V]

- **L'air** :
  - diffusion simple marchée (Rayleigh, Mie, ozone suivant Rayleigh) ;
  - **diffusion multiple = une constante** (0,8 Rayleigh, 0,3 Mie, `trace.wgsl` ~5867) ;
  - **pas de tables** (ni transmittance, ni diffusion multiple, ni vue du ciel) ;
  - aérosols fixes (τ ≈ 0,03) ;
  - **`AIR_K = 3`** (`earth-air.ts:8`) : les hauteurs d'échelle ×3, la densité au sol ÷3.
- **La table aérienne** : 96 × 54 × 32 tranches, 3 échantillons par tranche, refaite à chaque image. Rayons d'ombre des
  **nuages** oui (±40 km) ; **du relief, non**.
- **Les nuages** :
  - quatre couches réunies : le volume de la carte, jusqu'à 3 couches météo, une coquille de cirrus, une couche plate
    au-dessus de 30 km ;
  - de bonne facture : Perlin-Worley, érosion, deux lobes, octaves de diffusion multiple, « powder », historique ;
  - mais **près de la caméra, leur couverture est du bruit seuillé** sur une couverture scalaire (un point
    Open-Meteo) : les nuages ne sont pas où sont les vrais. La photo satellite du jour ne nourrit que la couche de la
    carte, au-delà de 250 km.
- **Défauts relevés** :
  - le cirrus ignore la météo (il s'affiche sous un ciel « couvert », et fait doublon avec la couche haute
    d'Open-Meteo) ;
  - sous les nuages de la carte, le ciel du sol reste le ciel clair ;
  - un saut à 30 km d'altitude (volume → couche plate à 6 km) ;
  - la carte d'ombre des nuages est marchée en 40 pas uniformes sans jitter (au Soleil bas, des pas de plusieurs km :
    ombres et rayons manqués) ;
  - toutes les couches sont composées à la distance du nuage le plus proche ;
  - la brume météo retranche l'extinction d'un air réel (3,5·10⁻⁵/m) alors que l'air dessiné en a ≈1,2·10⁻⁵ :
    visibilité ~15 % trop longue ;
  - le plancher `Tv < 0,01` existe toujours, atténué par `cloudsDirectT = (1 − α)³`, mais le disque peut encore luire au
    bord des nuages en demi-résolution.
- **Pas de neige qui tombe** (la précipitation est toujours de la pluie) ; traînées de condensation sans persistance
  ni ombre.

### Propositions

| # | Proposition | Effet | Coût | Risque |
|---:|---|---|---|---|
| C1 | **Tables d'atmosphère de Hillaire** (transmittance, diffusion multiple 32², vue du ciel) — celles de l'UE5 « Sky Atmosphere » —, dans le buffer `bodies` comme les autres tables (le palier des textures est plein) | l'heure bleue, le crépuscule, le ciel autour du Soleil juste ; moins d'ALU par échantillon | ~0,05 ms ; gain ALU | faible ; ré-étalonner l'exposition |
| C2 | **L'air à sa vraie épaisseur près du sol** : `AIR_K` de 1 sous ~50 km d'altitude de la caméra, fondu vers 3 au-dessus (le 3 sert la vue d'orbite) | la brume, la perspective aérienne et les couchers physiques ; avec C1 et R1 (la même USSA-76) | ~0 | **élevé** (tous les réglages d'exposition et de couleur) — à faire avec R0/M0 et une planche avant/après |
| C3 | **Aérosols réels** : l'épaisseur optique d'aérosols du jour (CAMS, à vérifier via l'API qualité de l'air d'Open-Meteo) → le Mie de `setAir` | les jours de brume de chaleur, de sable saharien, d'air lavé après la pluie | réseau | moyen |
| C4 | **Rayons d'ombre du relief dans l'air** : `sunShadowFar` (après T6) lu par la table aérienne, jitter + historique de la table, tranches proches plus fines | les rayons de montagne au couchant, l'ombre de la Terre et de ses reliefs dans la brume | 0,3–1 ms | moyen |
| C5 | **Les nuages réels près de la caméra** : une carte 2D couverture × type de ±250 km tirée de la grille Open-Meteo (plusieurs points) et de la mosaïque GIBS du jour, à la place du bruit seuillé | voler vers les vrais cumulus du radar ; la carte et la vue enfin d'accord | moyen | budget de textures |
| C6 | **Auto-ombrage des nuages par la carte d'ombre** (et marche de lumière pour la couche de la carte) ; carte d'ombre aux pas proportionnels + jitter + historique | bases sombres justes, rayons au couchant sans bandes | faible à moyen | faible |
| C7 | **Le cirrus lié à la météo** (couverture, ombre, ciel du sol), halo de 22° | ciel cohérent avec la météo | faible | faible |
| C8 | **Neige qui tombe, traînées persistantes** (humidité en altitude, type de précipitation par la température) | l'hiver et le ciel des couloirs aériens | moyen | moyen |
| C9 | **Le ciel du sol sous les nuages** : le SH du ciel atténué par la couverture locale (la carte d'ombre des nuages lue en ambiant) | les sous-bois et les vallées sous un ciel couvert, gris et justes | ~0 | faible |
| C10 | **Fin du plancher de transmittance** (la marche prolongée en extinction seule, analyse du 28/10 §5 #1) ; le saut à 30 km fondu | Soleil et Lune vraiment cachés ; pas de pop en montée | ~0,1 ms | faible |

---

## 4. L'image : netteté, stabilité, caméra

### Ce que fait le code [V]

- **Le gouverneur est inerte en raster** :
  - l'échelle est clouée à `rasterTop()` = 0,75 (`main.ts:8507`) ;
  - le bloc du ciel est forcé à 16 (`renderer.ts:9050`) ;
  - le taux ne pilote plus que le noyau `shade`, souvent sauté ;
  - le repli et la rétrogradation exigent une échelle de 0,5 qui n'arrive jamais.
  - Résultat : 21–24 i/s pour un budget de 18 ms.
- **L'affûtage** RCAS (0,3) ne passe que si l'image est à la taille du canevas (`display.wgsl` ~686–700). En vol à 0,75,
  l'image est agrandie en Catmull-Rom **sans affûtage** ; à l'arrêt (échelle 1), affûtée. **La netteté saute entre
  l'arrêt et le vol.**
- **Le TAA** : reprojection analytique (pas de vecteurs de mouvement), Catmull-Rom 9 lectures, écrêtage YCoCg ±2σ.
  - Pas de test de profondeur précédente (désocclusion par l'écrêtage seul).
  - La visibilité raster **n'est pas jitterée** (le Halton avait été mesuré moins bon).
  - Le **TAAU** existe mais est éteint.
- **L'exposition** : histogramme, lu au CPU toutes les 4 images ; globale, pas d'exposition locale.
- **Le post** :
  - AgX (« punchy » par défaut) ;
  - halo à 13 lectures ; flare et poussière d'objectif liés (éteints par défaut) ;
  - flou de mouvement de la caméra seule ; profondeur de champ.
  - Pas de grain, de vignettage, d'aberration chromatique.

### Propositions

| # | Proposition | Effet | Coût | Risque |
|---:|---|---|---|---|
| I1 | **RCAS après l'agrandissement** (dans le chemin Catmull-Rom) | la même netteté en vol qu'à l'arrêt, tout de suite | ~0 | nul |
| I2 | **Un upscaler temporel de classe TSR** à la place du TAAU éteint, par défaut : jitter de la visibilité raster (reconstruction dans le pixel de sortie, ce qui corrige la mesure qui l'avait écarté), test de profondeur précédente, poids de l'historique selon la vitesse, canal de confiance, RCAS après | **le plus gros gain de qualité perçue en vol** : 0,5–0,6 d'échelle rendue nette comme du natif ; fin du flou radial en avançant | grand (L) | moyen (fantômes sur la mer qui bouge) |
| I3 | **Vecteurs de mouvement** (rg16f) pour le vaisseau, le trafic, la mer | TAA et flou de mouvement justes sur ce qui bouge | moyen | faible |
| I4 | **Le gouverneur raster (U4)** : l'échelle libre de 0,5 à 1 en mouvement avec I2, des niveaux de qualité du matériau (lectures d'imagerie, eau) au lieu du taux inerte, un plafond automatique à 25 i/s sur un écran à 50 Hz quand le budget ne tient pas | une cadence tenue, régulière | petit | faible |
| I5 | **Exposition locale** (grille bilatérale sur les mips du halo) | l'intérieur du cockpit et le paysage au Soleil lisibles ensemble, comme l'UE5 | ~0,2 ms | faible |
| I6 | **Optique physique légère** : vignettage, grain fin, aberration chromatique discrète, poussière d'objectif indépendante du flare ; halo par convolution d'une PSF (option) | le « rendu caméra » qu'on attend d'un AAA (réglable, éteint au mode scientifique) | ~0,1–0,3 ms | nul |
| I7 | **Cadence de présentation** : le temps de simulation et l'obturateur réglés sur la présentation, pas sur l'encodage CPU | moins de saccades | petit | faible |

---

## 5. Les données (ce qui limite le photoréalisme à la source)

| # | Proposition | Effet | Risque |
|---:|---|---|---|
| G1 | **Imagerie hors de France et de Suisse** : Sentinel-2 à 10 m reste flou sous 2 km ; chercher d'autres orthos nationales ouvertes (Espagne PNOA, Belgique, Pays-Bas PDOK, Danemark, Autriche basemap.at, Allemagne par Land…) par l'interface `NationalSource` (I7) | la qualité IGN dans une bonne partie de l'Europe | licences et CORS à vérifier une à une |
| G2 | **Relief fin hors de France** : swissALTI3D est là ; PNOA-LiDAR, AHN (Pays-Bas), Copernicus GLO-30 (meilleur que SRTM : DSM à 30 m, moins de marches) | le relief net ailleurs, moins de marches (T1) | volume, CORS |
| G3 | **Garder le proche infrarouge** des pages pilotes (aujourd'hui jeté) : le NDVI pour les saisons, la classe végétation/sol et la BRDF L5 | saisons et matériaux à partir de la mesure | faible |

---

## 6. La performance — ce qui paie la qualité

Sur le mini : ~41 ms tenu, ~47 ms en vol (TERRE-UNREAL U10). Dont `earth lite` 13,5 ms, visibilité 4,4 ms, temporel
2,4 ms, carte d'ombre du vaisseau ~5,5 ms, masque du cockpit 1,6 ms.

| # | Proposition | Constat [V] | Gain estimé | Risque |
|---:|---|---|---|---|
| P1 | **Découpage des anneaux du relief en blocs cullés** (8 × 8 nœuds, test du tronc de vue au CPU ou en compute → `drawIndexedIndirect`) ; idem pour la carte d'ombre | patch + 6 anneaux dessinés **entiers** (~210 k triangles, ~116 k sommets lourds), la plupart hors du champ de 60° | −40 à −60 % du travail de sommets de la visibilité | faible |
| P2 | **Culling des bâtiments** (boîtes et maillages, tronc de vue + Hi-Z de la profondeur du relief) | tous dessinés à chaque image | ville : −1 à −2 ms de visibilité | faible à moyen |
| P3 | **Culling hiérarchique des arbres** par blocs 8 × 8 (bornes déjà stockées) | ~3,2 M fils de cull par image | −0,3 à −1 ms | faible |
| P4 | **Carte d'ombre du relief en cache** (redessinée quand le Soleil tourne ou que la fenêtre bouge, comme celle des arbres) | effacée et redessinée à chaque image | jusqu'à −1,3 ms (si la mesure « ombre du relief » est bien elle) | faible |
| P5 | **Cible de visibilité compactée** (rg32 : distance ; identifiant + marqueur) au lieu de rgba32float (r = b pour le sol) | 16 o/px écrits, lus par 6 noyaux | bande passante ÷2 | faible (le canal de B1 et T5 à prévoir) |
| P6 | **Plus de copies plein écran** (historique et flou en ping-pong) ; l'historique d'albédo coupé quand `rasterDetail` est éteint | 2 copies et 8 o/px écrits pour rien à chaque image | −0,3 à −0,8 ms | nul |
| P7 | **Le cockpit dans la profondeur de la visibilité** (pré-passe) | 15–25 % des pixels, sous la verrière opaque, rastérisés pour rien | −0,5 à −1 ms | faible |
| P8 | **Amortir** : carte d'ombre des nuages et table aérienne une image sur 2–4 (avec historique) ; passe nuages en damier ¼ avec la reprojection existante ; pas adaptatifs dans le vide | tout refait à chaque image | −1 à −3 ms selon la météo | moyen (stabilité) |
| P9 | **Classement par tuiles + dispatch indirect** : une petite passe classe les tuiles 8 × 8 (sol, eau, arbre, bâtiment, ciel), chaque noyau ne tourne que sur ses tuiles. La coupe par pixels avait été pire (U10) ; par tuiles, jamais essayée | `shadeLite` limité par ses registres sur Apple | à mesurer (10–25 % du matériau ?) | moyen |
| P10 | **shader-f16** pour le post et les couleurs du matériau (jamais les positions), avec repli | aucune demi-précision aujourd'hui | moins de registres sur Apple | précision |
| P11 | **Imagerie filtrée** (T9) : une lecture matérielle au lieu de 4 × 4 × n | le poste le plus cher du matériau | gros, à mesurer | — |
| P12 | Petits nettoyages : `createBindGroup` par image (mesure de lumière, masque du cockpit), code Halton en double, le gouverneur de taux qui bouge pour rien | bruit CPU/GC | petit | nul |

**Ordre de grandeur** : P1–P8 réunis devraient rendre ~4–8 ms sur le mini (estimation à mesurer) ; P9–P11 davantage.
C'est le budget des ajouts de qualité (S1 +1–2 ms, L2 ~0,5 ms, C4 ~0,5 ms, T6 ~0,3 ms).

---

## 7. Défauts relevés en passant (à corriger quel que soit le plan)

1. Le rebond du sol ignore les nuages et la météo (`shadeLite` ~13542).
2. Les lumières des villes s'ajoutent aux couronnes d'arbres et aux murs la nuit.
3. Le sol est trop clair sous les nuages de la carte (le ciel du sol reste le ciel clair).
4. RCAS seulement quand l'image n'est pas agrandie (I1).
5. Le gouverneur inerte en raster ; le repli et la rétrogradation inatteignables.
6. Brume météo ~15 % trop transparente (l'extinction de l'air réel retranchée d'un air dessiné ÷3).
7. Le cirrus affiché sous un ciel « couvert », en doublon de la couche haute.
8. Les objets des aérodromes du jeu [P] absents en raster.
9. Boîtes lointaines des bâtiments alignées est/nord (trop larges).
10. Nuit sans Lune ≈ nuit de pleine Lune ; luminosité nocturne du sol dépendant de l'altitude de la caméra.
11. `stats().shadowReceiverRangeM` annonce 2000/1200 m, le raster s'arrête à 750 m.
12. [P] Les lumières des villes peuvent disparaître sur des orthos chargées avant les tuiles z9–14 (`earthImageryAniso`
    rend une alpha nulle).
13. Docs périmées : ANALYSE-TERRE-RASTER-2026-10-28 §2 (proxy ico320 et non ico80 ; l'herbe sous 25 m et pas seulement à
    pied), FORETS-BATIMENTS-WORLDWIDE (budgets), PLAN-MONDE-VIVANT (BVH des arbres), NUAGES.md (Perlin-Worley fait).

---

## 8. Ce que je propose d'ajouter au plan commun

Un **volet Q** (« qualité Unreal ») dans [PLAN-REFRACTION-HORIZONS.md](PLAN-REFRACTION-HORIZONS.md), en quatre paquets,
**sur décision de Sam** :

| Paquet | Contenu | Pourquoi ensemble | Effort |
|---|---|---|---|
| **Q1 — la perf d'abord** (avant les ajouts) | P1, P2, P3, P4, P5, P6, P7, I1, I4 | rendre 4–8 ms et la netteté en vol, sans rien changer à l'image ; finance tout le reste | 4–6 j |
| **Q2 — la lumière et les villes** | L1, L4, L5, L6, C9, B1, B3, B4, défauts §7 1–3 et 9–10 | le plus gros saut photoréaliste par jour de travail ; L1 après T5 (normales lisses) | 5–7 j |
| **Q3 — le volume** | L2 (GTAO + horizon, avec H5 étendu à 8 directions), L3, S1, F1, F2, F4, C4 (après T6) | ombres, occlusion et forêts à toute distance | 8–12 j |
| **Q4 — le ciel et l'image** | C1, C2 (avec R1/M0), C5, C6, C7, C10, I2, I3, I5, I6, P8 | l'atmosphère physique et la netteté temporelle de classe TSR | 10–14 j |
| *Plus tard* | L7 (dé-éclairage), L8 (matériaux de détail), L9 (neige, saisons), L10 (nuit), B2, F3, C3, C8, D1, G1–G3, P9–P11 | gros chantiers ou données à vérifier | — |

**Liens avec le plan commun** :
- T5 (normales lisses) avant L1 ;
- T6 avant C4 et S1 ;
- H5 étendu à 8 directions = l'occlusion du ciel de L2 ;
- T9 = P11 (et le filtrage linéaire) ;
- C2 avec R1 (la même USSA-76) et la séance M0 ;
- le canal libre de la visibilité partagé entre T5, R4b et B1 (P5 le prévoit).

> **Révisé après le challenge** [CHALLENGE-ANALYSE-TERRE-UNREAL-2026-11-02.md](CHALLENGE-ANALYSE-TERRE-UNREAL-2026-11-02.md)
> (plan commun, §3.10, décisions 27 à 32) : C2 remplacé par une atmosphère physique unique ; Q6 avant Q4 ; la photo
> ré-éclairée en partie dès Q2 ; L4 sur des matériaux connus ; les gains de §6 visés, pas acquis ; les ombres du décor
> aussi coupées sous ~1,7° de Soleil (`treeShadowFrame`) ; GTAO et contact sur la profondeur finale, pas celle du proxy ;
> [PLAN-IMAGE-VIPER11.md](PLAN-IMAGE-VIPER11.md) fusionné. Le plan fait foi.

**Décision de Sam (2 novembre)** : « fais au mieux, AAA qualité et perf, tout dans le périmètre ». Le volet Q est intégré
au plan commun (phases Q1–Q9, décisions 16 à 20 de son §10), dans l'ordre de son §8 ; rien n'est lancé.

---

## 9. Enlever les ombres cuites des photos (L7) — la méthode

### Le problème

Chaque photo a été prise sous **son** Soleil :
- **IGN BD ORTHO** et SWISSIMAGE (z15–18, 20 cm) : un avion, au printemps ou en été, vers midi (Soleil à 40–65°). Les
  bâtiments et les arbres y portent des ombres nettes vers le nord.
- **Sentinel-2 / EOX** (z9–14, 10 m) : un satellite vers 10 h 30 solaire. Les ombres d'objets y sont sous le pixel,
  mais l'**estompage du relief** (les versants nord plus sombres) et les ombres des montagnes y sont.
- **Blue Marble** (z6–8) : un peu d'estompage, sans importance à cette échelle.

Le moteur ajoute ses propres ombres (relief T6, arbres et bâtiments S1). Le soir, la photo garde donc ses ombres de midi
**et** reçoit celles du couchant. Elle double les ombres là où elles coïncident, et laisse des ombres « fantômes » dans la
mauvaise direction.

Le but est un albédo **dé-éclairé** :

> albédo ≈ photo / (l'éclairage au moment de la prise de vue)

Le moteur y applique ensuite sa propre lumière.

### Le modèle physique

À l'échelle du pixel, une photo vaut :

- au soleil : `I = ρ · (E_soleil · cos i + E_ciel · V)` ;
- à l'ombre : `I = ρ · E_ciel · V`.

Ici ρ est l'albédo, i l'angle d'incidence du Soleil de la prise de vue et V la part de ciel visible.

Le rapport **soleil / ombre** d'un même matériau, `k = 1 + E_soleil·cos i / (E_ciel·V)`, vaut typiquement 3 à 8, et plus
dans le rouge que dans le bleu : l'ombre est éclairée par un ciel bleu. Défaire une ombre revient à multiplier ses
pixels par k, couleur par couleur, avec une transition douce dans la pénombre.

### Trois traitements, un par source

**L7a — Sentinel-2 / EOX : la correction topographique** (méthode classique de la télédétection).
- Hauteurs et imagerie sont **dans le même texel de la même tuile** (la texture `rg32uint`). La normale du relief se lit
  sur place, sans rien charger de plus.
- **Le Soleil de la prise de vue** :
  - l'heure est connue (~10 h 30 solaire) ;
  - l'élévation est **ajustée par tuile** : la régression de la luminance sur cos i pour quelques élévations candidates.
    La bonne est celle qui explique le mieux la luminance par la pente. EOX ne publie pas la date de chaque pixel de sa
    mosaïque.
- **Correction SCS+C** (Soenen 2005), recommandée pour les forêts : `ρ ∝ I · (cos θ·cos α + c) / (cos i + c)`.
  - θ est l'angle du Soleil au zénith, α la pente.
  - c est le rapport ordonnée / pente de la même régression, par classe WorldCover quand elle est chargée, sinon par
    tuile.
- Les **ombres portées des montagnes** (rares dans une mosaïque d'été) : l'horizon dans la direction du Soleil de la prise
  de vue, lu sur le relief de la tuile. Dans l'ombre, multiplier par k.
- Seulement là où la pente compte : les plaines ne changent pas.

**L7b — les orthophotos (IGN, swisstopo) : les ombres des bâtiments et des arbres.**
1. **Le Soleil de la prise de vue.**
   - D'abord la source : l'IGN publie le **graphe de mosaïquage** de la BD ORTHO, la date de prise de vue de chaque pièce
     (date sûre, heure **à vérifier**). Avec la date et l'heure, nos éphémérides donnent le Soleil exact.
   - Sinon, l'estimer sur l'image elle-même : rendre les ombres prédites (point 2) pour une vingtaine de Soleils
     candidats (azimut 120–240°, élévation 30–65°), garder celui dont les ombres recouvrent le mieux les pixels sombres,
     affiner autour.
   - Le résultat est gardé par km² (IndexedDB) : un vol couvre des dizaines de km² sous le même Soleil.
2. **Les ombres prédites, rendues par notre propre décor** :
   - on a déjà, sur le GPU, le moteur des cartes d'ombre des arbres et des bâtiments (`scenery-raster encodeShadow`) ;
   - ses données : bâtiments BD TOPO avec leurs hauteurs et toits, arbres posés sur la canopée LiDAR (MNH), relief IGN ;
   - le même rendu, **vu du Soleil de la prise de vue**, projeté sur la grille de la tuile d'ortho, donne un masque
     d'ombre géométrique.
3. **Le masque affiné par l'image**.
   - La géométrie seule ne suffit pas : les orthos ne sont pas « vraies » (les bâtiments penchent, les toits sont décalés
     de leurs emprises) et la canopée réelle diffère des arbres posés.
   - Un pixel est dans l'ombre s'il est prédit à l'ombre (ou près d'une ombre prédite) **et** sombre et bleuté pour sa
     région (les indices d'ombre classiques : luminance basse, rapport bleu / rouge haut).
   - Le bord suit les contours de l'image (filtre guidé). Le masque devient doux (α de 0 à 1, la pénombre).
   - **Le décor évite les faux positifs** : un toit noir ou un asphalte sombre ne sont jamais prédits à l'ombre, donc pas
     éclaircis.
4. **Le rapport k**, mesuré dans chaque tuile :
   - des paires de pixels de part et d'autre des bords d'ombre (le même matériau au soleil et à l'ombre), la médiane par
     couleur ;
   - borné (2–10) et lissé entre tuiles voisines, pour éviter des sauts de teinte.
5. **Le relèvement** : `I' = I · (1 + (k − 1)·α)` par couleur.
   - Puis un débruitage doux **dans la zone relevée seulement** : ×5 amplifie le bruit et les blocs JPEG des ombres.
   - Rien sur l'eau (OSM, WorldCover).
6. **Selon la distance** :
   - pleinement là où le moteur dessine ses propres ombres d'arbres et de bâtiments (750 m aujourd'hui, ~5 km avec S1) ;
   - en partie au-delà : de loin, les ombres d'une ville font partie de sa couleur moyenne, et leur direction ne se voit
     plus.
7. **Les ajustements de couleur `ORTHO_FIT` et `EOX_FIT` réajustés** après coup : ils visaient les moyennes de photos
   éclairées.

**L7c — un réseau de neurones de suppression d'ombres** (il en existe pour l'imagerie aérienne) : **écarté**.
- Poids de plusieurs dizaines de Mo à charger et à faire tourner dans le navigateur.
- Il invente du contenu dans les ombres profondes.
- Licences variables.
- Il ne sait rien de notre géométrie, alors que nous la connaissons.

### Où et quand le calcul se fait

- **Sur le GPU, une fois par tuile, à son arrivée** : un compute qui écrit l'albédo dé-éclairé dans la texture
  d'imagerie de T9 (rgba8 avec mips).
- Coût estimé : ~0,1–0,3 ms par tuile d'ortho (le rendu du masque + le compute), étalé sur les images ; rien à chaque
  image ensuite ; aucune mémoire de plus ; aucun travail sur le fil principal.
- **Dépendances** :
  - T9, pour une imagerie dans sa propre texture, inscriptible ;
  - le décor chargé, à 6 km autour de la caméra : c'est là que ça compte. Au-delà, L7b s'efface ; L7a, qui n'a besoin
    que du relief, s'applique partout ;
  - S1, pour que nos ombres remplacent celles qu'on efface jusqu'à ~5 km.
- Hors ligne (zones I8) : le même calcul, sur les tuiles servies par le cache.

### Comment on sait que c'est réussi

- **Une même place, deux campagnes IGN** (millésimes à des dates et des heures différentes ; la Géoplateforme sert des
  millésimes historiques, **à vérifier**). Après dé-éclairage, les deux doivent se ressembler bien plus qu'avant, surtout
  dans les ombres. C'est la mesure objective.
- **Synthétique** :
  - notre propre scène rendue à midi sert de « photo » ;
  - on la dé-éclaire, et on compare à l'albédo connu.
- **À l'œil**, Paris et Chamonix au couchant :
  - plus d'ombre de midi sous les ombres du soir ;
  - pas de halo au bord des bâtiments ;
  - pas de « trou » clair au pied des arbres ;
  - pas de bruit dans les zones relevées.

**Premier temps : une étude de 2 jours** (Paris, Chamonix, un relief Sentinel), avant/après sous 3 Soleils. Feu vert si :
- halo < 1 m ;
- bruit des zones relevées < 1,5 × celui des zones au soleil ;
- plus aucune double ombre visible au couchant.

Sinon on garde L7a seul (sûr) et on revoit L7b.
