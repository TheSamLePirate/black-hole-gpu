# Plan commun — la Terre raster AAA, la bonne réfraction, les cartes d'horizon du relief

Date : **2 novembre 2026**, relu sur `main` à `b896c0b2`. Statut : **décidé, pas lancé.**

- **Quand** : on commence **dès que les géantes sont finies** (PLAN-GEANTES-VOLUME : V8 et V9 restent), décision 11 du
  §10.
- **Ce qui est fait** : seul le repère de R2 (`efe4369a`, e2e `346a48a8`).
- **D'où vient ce plan** : il réunit trois chantiers qui touchent les mêmes fonctions, les mêmes vues et les mêmes mesures.
  - **T — la Terre raster** : les escaliers, les triangles, les ombres du relief, la mer, le chargement. Analyse
    détaillée : [ANALYSE-TERRE-RASTER-2026-11-02.md](ANALYSE-TERRE-RASTER-2026-11-02.md), suite de
    [celle du 28/10](ANALYSE-TERRE-RASTER-2026-10-28.md).
  - **H — les cartes d'horizon** des planètes rocheuses (troisième passe du 31 octobre au soir).
  - **R — la réfraction** (troisième passe du 31 octobre au soir).
- **Le but** : qualité AAA **et** performance. Aucune phase ne rend une vue plus lente qu'avant sans que le gain d'image
  soit mesuré et accepté. Une partie des phases (T4, T9, H3a, H3) doit faire **gagner** du temps.
- Le nom du fichier est gardé : les notes de `docs/agent/`, l'e2e `refraction-wgs84` et les autres plans y renvoient.
- Les numéros de ligne cités sont indicatifs (`trace.wgsl` bouge sans cesse) ; les noms de fonctions font foi.

## 0. Les demandes

> « Prépare un plan pour implémenter la bonne réfraction et les cartes d'horizon pour les ombres du relief vues de loin,
> sur les planètes rocheuses en raster. Avant ça, analyse la faisabilité et le gain en qualité et en perf. » (31 octobre)

> « Assure-toi que la vue raster de la Terre soit parfaite AAA, qualité et performance. Qu'elle charge le mieux possible
> les données relief, images, qualité. Vérifie la petite régression : les tuiles de relief créent des escaliers visibles,
> et des triangles visibles pendant le chargement. Analyse aussi l'eau, la mer surtout. » (2 novembre)

> « Mets à jour ces plans pour en faire un plan commun. On le commence dès que les planètes géantes sont finies. AAA
> quality et performances. » (2 novembre)

Origine du volet H et R : l'analyse de `vr-solar-system` (Alesk, portage Quest 3 de ce jeu, cloné dans
`~/Documents/DEV/vr-solar-system`). Leur rapport `docs/reports/2026-10-31_refraction-models_05.md` compare leur modèle au
nôtre. Leurs cartes d'horizon sont dans `docs/modules/Terrain.txt` (FAR CAST SHADOWS, LIGHT EXTRAS) et
`Runtime/Terrain/ReliefHorizonJob.cs`. Leur réponse : `docs/agent/reponse-premier-contact-refraction_2026-10-31-03-45-08.md`.
**À relire sur `origin/master` avant de lancer** (CLAUDE.md : leurs dernières notes `docs/agent/`).

## 0.1 Ce que le plan apporte

| Volet | Gain | Où ça se voit | Coût visé |
|---|---|---|---|
| **T1–T2** | plus d'escaliers dans le relief ; plus de lignes de fausse pente aux coutures | toute la Terre en vol bas et au sol, surtout au Soleil bas | 0 |
| **T3–T5** | plus de triangles visibles (facettes, triangles qui percent aux coutures, sauts au chargement) | toute la Terre raster, en vol | ≈ 0, et moins de recuissons |
| **T6** | les ombres portées du relief en raster (aujourd'hui presque aucune) | toutes les vues au Soleil bas, la montagne au couchant | < 0,3 ms |
| **T7** | une mer sans moiré ni motif répété, des côtes nettes, plus de terres basses changées en mer | les côtes, l'orbite basse, les couchers sur la mer | < 0,1 ms |
| **T8, T10** | le détail fin 2 à 5 × plus tôt, sans à-coups ; ~200 Mo de GPU rendus | chaque arrivée sur un lieu, le vol bas | réseau ; mémoire en moins |
| **T9** | un sol net et stable au loin en vue rasante (filtrage matériel, mips, aniso 16) | le vol, le téléobjectif | **gain** GPU |
| H (disques lointains, avec H1b) | les ombres longues du terminateur (Copernic, les Apennins, les remparts des cirques), et le relief HD de la Lune, absent aujourd'hui | la Lune au télescope, au trépied, en photo depuis la Terre | 0 hors des pixels du corps HD |
| H (le corps proche) | une portée d'ombre de 2,5–10 km (la carte du Soleil) à ~170–340 km ; les plaines mises dans l'ombre par une chaîne lointaine ; le pôle sud | la Lune, Mercure, Mars et Cérès en orbite, en approche, au sol au Soleil bas | **négatif** : des marches sautées (§2.4) |
| H5 (option, la Terre) | les ombres des Alpes au couchant au-delà de 10 km | la montagne au Soleil bas | à mesurer |
| R1–R2 | la hauteur et la forme du Soleil et de la Lune près de l'horizon (0,74 → 0,82), le coucher vu de l'ISS, les prédictions du CPU d'accord avec une table publiée, la Lune éclipsée | le téléobjectif, le planificateur photo, TARS, l'orbite | ≈ 0 |
| R3 | le sol éclairé jusqu'à la disparition du disque (2–3 min de lumière rasante) | **toutes** les vues au couchant, même au grand angle | 0 |
| R4 | le sol lointain relevé, l'horizon d'avion, plus de « trou » au limbe vu d'orbite | le téléobjectif, l'orbite | ≈ 0 |
| R5 | l'auréole de Vénus, l'anneau rouge de la Terre vu de la Lune éclipsée | des vues rares et spectaculaires | 0 hors du limbe |
| R6 | des mirages (Soleil en « vase étrusque », Fata Morgana, le « lac » d'une route chaude) | le téléobjectif à la côte | 0 au GPU hors de la bande de l'horizon |

---

## 1. Analyse — la réfraction

### 1.1 L'existant (vérifié dans le code le 31 octobre au soir)

- **Un seul modèle**, une formule fermée (`src/system/refraction.ts` et son jumeau `trace.wgsl airBend`). L'air y est
  exponentiel (H = 8,4 km). La courbure vaut (N₀/H) × sin ψ × la colonne de Chapman (forme de Schüler), plafonnée à
  0,03 rad. Vers le bas, la corde entière par son point le plus bas, moins la partie derrière l'œil.
- **N₀ ne dépend que de la température** : N₀ = 2,93·10⁻⁴ × 288,15 / (273,15 + T) (`renderer.ts refractivity`, la météo
  réelle ou 15 °C).
  - La pression **est déjà récupérée** (`openmeteo.ts` : `surface_pressure` → `ModelHour.p`), mais elle n'est pas
    utilisée.
  - **Piège** : c'est la pression au point du modèle, à son altitude (`parseOpenMeteo` renvoie `elevation`), pas au niveau
    de la mer. Prise telle quelle pour P₀, elle compterait l'altitude deux fois (à Chamonix, ~10 % de trop peu).
  - Le CPU n'envoie `P.sky` que lorsque la Terre est le corps proche.
- **Le repère (R2, fait)** :
  - `airBend` travaille dans le repère où l'ellipsoïde WGS84 est la sphère unité. `nearCam()` y est déjà ; le regard y est
    aplati (`squashed(toBody(look), EARTH_AB)`) ; le rayon courbé est ramené (`bent.z / EARTH_AB`).
  - L'étirement garde la tangence : l'horizontale de l'œil y est celle de l'ellipsoïde, la verticale est géodésique.
    **Pas de `geoQ`**.
  - Mesuré par l'e2e `refraction-wgs84` au coucher de La Hague (champ de 1,5°) : 0,58′ d'écart avant, 0,06′ après.
- **Les atmosphères existent déjà** dans `aero.ts` : l'USSA-1976 en couches (`LAYERS`, `us76`), Vénus VIRA (Seiff 1985),
  Titan (Yelle + HASI). Ce sont les densités du vol (traînée, échauffement). La réfraction doit lire les mêmes, sans
  doublon.
- **Utilisateurs GPU** :
  - `airBend` : les noyaux de la Terre, et `REFR_DELTA` pour le rayon vert (C4) ;
  - `shadeStars` : l'inverse, 3 points fixes sur `airBend` ;
  - `earthRingLight` : la Lune éclipsée.
- **Le modèle propre de `earthRingLight`** :
  - α(h) = 0,0205 · e^(−h / 8,4 km) (70,5′ au ras du sol, « C3 doublé »), résolu en h par 3 pas de Newton.
  - Ses épaisseurs optiques (Rayleigh × 70,7, poussières, ozone) ont été **réglées avec cette courbure**.
  - Comparé aux couches : 38,9′ contre 46,3′ à 5 km (−16 %), 21,3′ contre 26,4′ à 10 km (−19 %).
- **Utilisateurs CPU** :
  - `skychart.ts` (à la hauteur de la caméra) et `sky-now.ts` (TARS) ;
  - `photo/plans.ts` : **toujours h = 0 et N₀ standard**, `seaRefractivity()`. C'est normal pour prévoir une date future,
    mais aujourd'hui la vignette, qui suit la météo, et la prédiction ne prennent pas le même air ;
  - `targeting.ts` et `controller/rig.ts` (`refractDirection` avec `drawnRefractivity`).
  - Ils demandent d'autres hauteurs que celle de la caméra.
- **Deux mesures de l'aplatissement, à ne pas confondre** :
  - PLAN-CIEL C3 a mesuré **0,79 dans l'image** à Biarritz (centre du Soleil à −0,25°) ;
  - le §1.2 calcule **0,742** sur la dernière demi-largeur du disque.
  - R0 fixe une seule définition, mesurée de la même façon avant et après.
- **Laissés de côté par C3** : le sol éclairé par le Soleil géométrique, la réfraction terrestre (le sol lointain non
  relevé).

### 1.2 L'erreur, mesurée

Recalculé avec un script hors projet (USSA-1976 en 7 couches, invariant de Bouguer, Simpson). Nos chiffres sortent de notre
propre `bending()`. En minutes d'arc :

| Élévation apparente (depuis la mer) | Bennett (15 °C) | Couches USSA76 | Nous | Notre écart |
|---|---|---|---|---|
| 0° | 33,96 | 33,02 | 34,77 | +2 % |
| 0,5° | 28,32 | 27,68 | 26,90 | −5 % |
| 1° | 23,96 | 23,57 | 21,93 | **−8 %** |
| 2° | 17,94 | 17,81 | 16,01 | **−11 %** |
| 3° | 14,13 | 14,07 | 12,61 | **−11 %** |
| 5° | 9,73 | 9,68 | 8,83 | −9 % |
| 10° | 5,31 | 5,24 | 5,02 | −5 % |
| 45° | 0,98 | 0,96 | 1,00 | ok |

- **Le Soleil couchant aplati** (sa dernière demi-largeur) : Bennett 0,814, couches 0,823, **nous 0,742**. Trop écrasé
  de 9 %.
- **Vu d'orbite (400 km), rayon rasant, selon sa hauteur tangente** (couches / nous) :
  - 2 km : 64,4′ / 54,8′ (−15 %) ;
  - 5 km : 46,3′ / 38,4′ (−17 %) ;
  - 10 km : 26,4′ / 21,2′ (−20 %).
  - Le coucher vu de l'ISS est donc trop peu écrasé.
- **Depuis une montagne (3 km)**, à +1° : 17,8′ contre 15,35′ (−14 %).
- **La cause** :
  - une seule hauteur d'échelle, et l'angle à la verticale pris à l'œil pour tout le trajet ;
  - près de l'horizon, la courbure vient des premiers kilomètres, où l'air réel n'est pas isotherme (gradient
    −6,5 K/km) ;
  - le N₀ de 2,93·10⁻⁴ « à 15 °C » est en fait la valeur à 0 °C (Edlén à 15 °C et 550 nm : 2,778·10⁻⁴). Il compense à
    l'horizon, d'où le bon 35′ là et l'erreur au-dessus.
- **Le commentaire de `refraction.ts` est faux** : « Bennett à une fraction de minute au-dessus de 2° », alors que l'écart
  est d'environ 2′ à 2°.

### 1.3 Ce que ça change à l'image

- **Au grand angle** (60° de champ, 1080 px de haut, 1 px ≈ 3,3′) : l'erreur maximale de ~2′ est sous le pixel.
- **Au téléobjectif** (vignette télé, télescope Y du trépied, photos multi-poses ; le télescope descend à 0,02° de
  champ, `TELE_MIN`) : à 2° de champ, 1 px ≈ 0,1′.
  - Cela donne **15 à 20 px d'écart** sur la hauteur du Soleil ou de la Lune près de l'horizon.
  - Et une **forme du disque fausse**, qui se voit au premier coup d'œil au 600 mm.
- **Les prédictions du CPU** : ~2′ à 1–3° de hauteur, soit 8–12 s d'heure de coucher ou de lever à nos latitudes.
- **Ce que la précision ne doit pas viser** : à 0° pile, la réfraction réelle varie de plusieurs minutes d'arc d'un jour à
  l'autre (inversions, gradient au sol). Le gain vérifiable est **entre 0,5° et 10°**, sur la **forme du disque** et **vu
  d'orbite**. À 0°, on vise la cohérence (vignette = prédiction = table publiée dans l'air standard).
- **La Lune éclipsée** : la courbure rasante y est « C3 doublé ». Les couches donnent 15–20 % de plus aux hauteurs
  tangentes qui comptent (2–10 km). L'ombre serait plus claire au cœur et la couleur de Danjon déplacée. Les épaisseurs
  optiques sont donc à **re-régler ensemble** (R2).
- **Le Soleil d'éclairage** : le sol s'éteint quand le centre géométrique passe sous l'horizon, alors que le disque est
  encore vu ~35′ au-dessus. Au couchant, cela fait **2–3 min de lumière rasante en moins** et un Soleil visible au-dessus
  d'un paysage déjà dans l'ombre. Visible au grand angle.
- **La réfraction terrestre** (k ≈ 0,13–0,17) :
  - un sommet à 100 km est relevé de 3,5′, à 300 km de ~10′ ;
  - la dépression de l'horizon vu d'avion est ~8 % plus petite ;
  - vu d'orbite, le globe dessiné s'arrête 2,4–2,7′ sous le Soleil réfracté.

### 1.4 Faisabilité et coût — le modèle retenu

- **L'invariant de Bouguer** (n·r·cos e constant le long du rayon) ramène tout à deux fonctions par air :
  - **B_haut(h, e)** : la courbure d'un rayon qui monte depuis la hauteur h sous l'élévation apparente e ≥ 0, jusqu'au
    vide ;
  - **B_limbe(k)** : celle d'un rayon qui part de son périgée de paramètre d'impact k vers le vide.
  - Un rayon qui descend de l'œil sans toucher le sol vaut **2·B_limbe(k) − B_haut(h, |e|)**. C'est déjà la structure de
    `airBend` aujourd'hui (la corde moins la partie derrière l'œil).
  - Au-dessus de l'air, B_limbe(k) seule suffit, **k par pixel** : le traceur connaît le rayon de l'œil.
- **Les tables, par air** :
  - **B_haut** : 64 hauteurs en log (5 m → 86 km) × 256 élévations, resserrées en u² vers l'horizon. 16 384 valeurs,
    lisses dans les deux sens.
  - **B_limbe** : 512 périgées **resserrés vers le haut de chaque couche** (les coudes de 11, 20, 32, 47, 51 et 71 km :
    < 3″, leur méthode), rééchantillonnés en **2 048 valeurs à k régulier** pour le GPU.
  - **« Où atterrissent les rayons »** : 128 élévations, pour R4.
  - **Le relèvement par distance** : 64 hauteurs × 64 distances, pour R4.
  - Au total ≈ 23 000 nombres, ~92 Ko par air.
- **Une seule table, pas leur cache de bandes de 2 %.** Leur schéma (une table par bande de hauteur visitée, faite à la
  demande dans un worker, la plus proche servant en attendant) répond aux limites d'Unity sur Quest. Chez nous, une table
  2D :
  - est **déterministe** : pas de saut quand une bande arrive pendant une montée, donc des e2e et des A/B reproductibles ;
  - est écrite **une fois par changement d'air** (météo, corps) ;
  - sert le CPU **à toute hauteur** gratuitement.
  - Construction : 16 384 rayons × Simpson 200 ≈ 3,3 M évaluations, ~30–80 ms dans un worker, jamais dans l'image.
- **La dispersion** :
  - une table à 550 nm, multipliée par le facteur d'Edlén (n_λ − 1)/(n_550 − 1) par couleur ;
  - l'écart au calcul exact est du second ordre (B² ≈ 10⁻⁴ en relatif) : à vérifier en R1 contre trois tables ;
  - trois tables seulement là où la correspondance devient non linéaire (R6).
- **L'air de la Terre réelle** :
  - la **pression** ramenée au niveau de la mer (P_mer = p × (P/P₀ de `us76` à l'altitude du modèle)⁻¹) met à l'échelle
    toute la colonne ;
  - l'**écart de température** est celui de la couche limite, à décroître sur ~1 km (le conseil de leur Claude). Le
    reporter sur toute la troposphère en changerait l'échelle de hauteur ;
  - au-dessus, les gradients USSA-1976.
- **La place au GPU** : **une table `TABLE_REFR` dans `src/gpu-tables.ts`**, donc dans le buffer `bodies` (liaison 15,
  lecture seule, lié à tous les noyaux).
  - C'est le chemin de toutes les tables du traceur : anneaux, vents, sommets des géantes, géoïde, orthophotos, carte
    d'ombre du Soleil, cache du relief. `tests/gpu-tables.test.ts` vérifie les décalages contre `trace.wgsl`.
  - **Pas le buffer `catalogue`** : il est remplacé dans `loadSky` par un buffer à la taille exacte du catalogue.
- **Le coût GPU** :
  - `airBend` passe d'une formule fermée à 2 lectures et un lerp. **Test de zone d'abord** au-dessus de l'air (un produit
    scalaire : hors de la bande du limbe, rien) ; leur leçon : +0,38 → +0,08 ms en orbite.
  - Les budgets des noyaux sont au §6.
- **Le Soleil d'éclairage (R3)** :
  - **une seule source** : `near.light` (`local-patch.ts`), écrit dans `P.near4` et lu par le CPU pour la carte d'ombre
    du relief (`terrain-raster encodeSunShadow`), celle des nuages (`cloud-shadow.ts`), celle des arbres et des bâtiments
    (`tree-shadow.ts`, `scenery-raster.ts`) ;
  - le corriger là, une fois, et tout suit : pas d'ombre décalée possible ;
  - la courbure est prise **au sol sous la caméra** (ce qui est éclairé), pas à l'œil ;
  - le disque dessiné reste celui d'`airBend`.
  - **Mais la carte d'ombre du relief de la Terre est presque vide** (§3.4) : R3 se fait avec T6.
- **La réfraction terrestre (R4)** : un relèvement k·d²/2R du sol vu.
  - **R4a**, le globe tracé : un décalage du test de hauteur à l'intersection (`earthMarch`, l'intersection d'orbite).
  - **R4b**, les rasters : relever le sol dans tous les rasters de la Terre (sol, scènes, forêts, pistes 3D, bâtiments),
    et le défaire quand l'ombrage reconstruit le point.
  - **Les deux ensemble** sur la Terre raster (§3.7) : seul, R4a fait une marche au bord du dernier anneau.
- **Les mirages (R6)** : le coût est au CPU (RK4 à travers les points de retournement, dans un worker) et dans le profil
  d'air à déduire. Notre traceur y est mieux placé qu'un raster : un rayon par pixel, les images multiples viennent
  seules.

### 1.5 vr-solar-system : ce qu'on reprend, ce qu'on laisse

Lu chez eux : `Sim/RefractiveAir.cs`, `Sim/AtmosphericRefraction.cs` (`LimbBending`, `Landing`, `BuildAbove`,
`TerrestrialK`, `Table`), `Runtime/RefractionTables.cs`, `Shaders/VRSolarCommon.hlsl` (`GroundLift`), leurs rapports
`_06` et `_07`. Mesuré par eux sur Quest 3 : orbite +0,08 ms, sol 0, 72 fps.

- **Repris** :
  - les couches hydrostatiques à gradient constant, avec n − 1 du gaz mis à l'échelle de la densité ;
  - les périgées resserrés en haut de chaque couche ;
  - la table du limbe en k, et la table de l'atterrissage (le sol vu 3,0′ plus haut, 56 km au-delà du limbe géométrique
    à 400 km) ;
  - `TerrestrialK` : l'horizon dessiné tombe là où finit la réfraction du ciel (~0,17 au niveau de la mer) ;
  - le test de zone, et le relèvement laissé de côté sous 0,1′ ;
  - **leur lentille (R5)** : un rayon qui rase le limbe à la hauteur h est dévié de B(h) et pointe derrière le corps
    f·B(h) plus près du centre. Il est intégré sur l'étendue des hauteurs tangentes du pixel (fwidth au travers du
    limbe), avec le décalage du Soleil en double précision. Il sert à l'auréole de Vénus et à l'anneau rouge de la Terre
    vu de la Lune ;
  - leurs profils de mirage et de conduit (3n–3o), **illustratifs** (réglés pour chaque phénomène, ajustés sur aucune
    mesure) ;
  - leur verticale géodésique dans l'air (nous : le repère aplati, équivalent).
- **Laissé** :
  - le cache de bandes de 2 % (§1.4) ;
  - les tables par hauteur d'œil au-dessus de l'air (k par pixel chez nous) ;
  - trois tables par couleur hors R6 (le facteur d'Edlén) ;
  - leurs horizons par sommet (leur relief est un maillage CPU en Burst ; le nôtre est évalué dans le vertex shader du
    clipmap).
- **Ce qu'on a et pas eux** : la météo réelle, la température **et** la pression du lieu.
- **Leurs limites, à garder en tête** :
  - rien au-delà de 50 000 km ;
  - pas de scintillation au limbe ;
  - Mars, Vénus et Titan d'orbite seulement ;
  - leur halo fixe du Soleil masque la partie faible de l'arc au télé ;
  - leur air dessiné trois fois trop épais déborde l'anneau.

---

## 2. Analyse — les cartes d'horizon (planètes rocheuses)

### 2.1 L'existant (relu le 2 novembre)

Trois chemins dessinent un corps rocheux, et **H ne les touche pas de la même façon** :

1. **Les disques lointains** (`ourSegment` → `planetShade`) : tout corps qui n'est pas le corps proche. Exemples : la Lune
   vue de la Terre, Mercure vue d'ailleurs.
   - La carte HD incline la normale (`hdNormal` → `demNormal`) si le corps est HD.
   - **Aucune ombre portée.** `planetShade` multiplie sa lumière directe par `rs0 × bodyShadow`.
   - Seul appel des disques : dans `ourSegment`. Les autres (`shadePlanet`, `env`, `shadeNear`) sont d'autres chemins.
   - Un disque lointain **avec air** (Mars vue de la Terre) passe par `earthLookFar` → `otherGround`, pas par
     `planetShade`.
2. **Le corps proche** : dans `LOCAL_RANGE` = 300 rayons, même en orbite haute. Le chemin est `shadeNear` → `nearShadow`
   × `planetShade`, dans le traceur (`main`) et dans le raster des corps (`bodyLite` dans `shadeLite`, `NEAR_KIND` 3
   et 7).
   - **La Lune au terminateur vue d'orbite passe donc par `nearShadow`, pas par `planetShade` seul.** C'est H3 qui
     l'améliore, pas H2.
   - **Depuis le 1er novembre** (« P1, seconde partie », `f3aa71e5`), `nearShadow` a trois parties :
     1. la marche jusqu'à 32 m (mondes sans air) ;
     2. **la carte d'ombre du Soleil des corps** (`sunShadowFar`) : le maillage du raster des corps vu du Soleil
        (`body-raster drawSun`, `encodeBodySunShadow`), demi-largeur 2,5 à 10 km selon la hauteur de la caméra, portée
        réglée sur la pente du sol (`SUN_N`) ;
     3. **la marche reprise à la sortie de la carte**, jusqu'à la coquille.
   - Mesuré par `f3aa71e5` : la Lune bas −9 %, ciné −19 % ; Mars bas −14 % ; Mercure bas −20 %, ciné −11 % ; Europe ciné
     73 → 63 ms ; images identiques à la marche (≤ 0,4 %).
   - La marche (au plus 56 pas) sort dès que le rayon quitte la coquille `hmax = reliefMax + demTop(q, portée)`. La
     portée agit donc surtout par la hauteur de cette coquille (le plus haut sommet à portée), pas par le nombre de pas.
     Portées : mondes sans air 20 km ; Mars 60 km.
3. **Mars dans son air** (`earthNear`) :
   - près de la caméra, `REL_SH` = `nearShadow`, fondu de 15 à 25 km ;
   - plus loin, `otherGround` avec `hdNormal` seul. Elle est appelée deux fois : par `earthLook` (Mars proche) et par
     `earthLookFar` (Mars disque lointain) ;
   - la lumière du vaisseau a sa propre marche (`keyRelief`).

- **`hdRelief` a deux formats** :
  - un DEM (rg16float ; R la moyenne, G le maximum le long des mips) pour la Lune, Mars, Mercure, Cérès et Vénus ;
  - une carte de normales pour les autres.
  - Les cartes d'horizon ne concernent que les corps à DEM, **Vénus exclue** (sous ses nuages).
- **Les DEM** : Lune 4096 × 2048 (LOLA, ~2,7 km), Mars 4096 (MOLA, ~5,2 km), Mercure 2048 (~7,5 km), Cérès 2048
  (~1,4 km).
  - Mercure et Cérès sont à 2048 parce que **le CI de Pages refuse tout nouveau binaire de plus de 8 Mo** (P8,
    `build-dem.py`).
  - Conséquence : **une carte d'horizon précalculée hors ligne de plus de 8 Mo est exclue.** La cuisson se fait au GPU.
- **Les cartes HD ne se chargent que pour le corps proche** (`renderer.ts`, la règle `nearMap && dN < hdAt`) :
  - `hdAt = 1 + 1,3·(2π/4096)/pixelAngle` ;
  - une exception, `pin`, garde le corps où est posé le vaisseau ;
  - **depuis la Terre, la Lune n'a jamais ses cartes HD**, même au télescope ;
  - et **`planetMapAt` lit `hdColor` dès que `m == P.hd.x`** : un mode « relief seul » doit le savoir (H1b).
- **Le coût avant P1-2 (P8.md, kerr-mini, A3)** — à remesurer en M0 (P1-2 l'a changé) :

  | Vue | ms | La Terre | Lecture |
  |---|---|---|---|
  | Mercure ciné (au sol, Soleil à 15°) | 43,2 | 39,6–40,4 | +7 %, dont ~17 ms d'ombres (avant P1-2) |
  | Lune ciné (le lever de Terre) | 34,3 | 39,9–40,4 | sous le budget |
  | Cérès ciné | 44,6 | 39,6–40,4 | +11 %, part des ombres non mesurée |
  | Europe ciné | 73,3 → **63** (P1-2) | 39,4 | ×1,6, **sans DEM : hors de portée de H** (H3a seul) |

- **Le raster des corps sans air n'a pas de budget de noyau** : le profil `moon` (`NEAR_KIND` 3) n'a pas d'entrée
  `shadeLite` dans `kernel-profiles.ts` (vérifié le 2 novembre), alors que `moons`, `mars`, `titan` et `venus` en ont une.
- **Les rochers des mondes sans air sont commités** (`b37bdbf6` : `airlessRocks`, `rockLight` dans `shadeNear`, leurs
  propres ombres hors de `nearShadow`). `moon main` est à 71 600.

### 2.2 Ce que font les cartes d'horizon (vr-solar-system)

- **Le contenu** : par texel, l'élévation de l'horizon dans 8 directions (N, NE … NO), en sinus quantifiés sur un octet
  (−0,2…0,8), avec des mips.
- **Le balayage** : le grand cercle de 1 à 8 texels, puis ×1,3 jusqu'à 30 texels (~320 km sur la Lune), courbure comprise.
- **À l'ombrage** : deux lectures, l'azimut du Soleil interpolé entre les deux voisins, un smoothstep de ±0,006 sur
  l'élévation.
- **Le stockage** : 24 cellules cube de 128², ~4,2 Mo par corps, cuites au CPU (Burst, 62 ms la cellule).
- **Le raccord proche / lointain** :
  - les patchs fins ont leurs horizons par sommet en trois portées (≤ 8 espacements, 8–64, 64 espacements → 60 km) ;
  - les patchs grossiers lisent la carte ;
  - les deux ne se rencontrent jamais sur un même sommet : pas de double ombre, **pas de fondu non plus** (une marche
    possible au bord d'une ombre, non testée).
- **La mip** : choisie selon l'empreinte (distance × 1/22°, 1/22° étant un pixel du Quest). Chez nous, l'angle d'un pixel
  (`pixFoot`) fait le même travail.

### 2.3 Gain en qualité

- **Le corps proche (H3)** : en orbite, en approche, au sol au Soleil bas, la portée passe de la marche reprise (20 km) à
  la carte entière.
  - Au Soleil à 2°, un sommet de 5 km porte son ombre à 140 km. Aujourd'hui elle s'arrête à 20 km.
  - Près du terminateur, des plaines restent éclairées alors qu'une chaîne lointaine devrait les mettre dans l'ombre.
  - La marche (0–32 m) et la carte du Soleil (jusqu'à 2,5–10 km) gardent le détail fin (cratères, tuiles de 118 m,
    rochers).
- **Les disques lointains (H2, avec H1b)** : la Lune au télescope, au trépied, en photo depuis la Terre. H1b apporte en même
  temps son relief HD (`hdNormal`), absent aujourd'hui. Résolution : les reliefs de plus de ~2 texels de la carte (Lune
  ≥ ~11 km à 2048 de large). C'est **la** vue des astrophotographes (PLAN-CIEL, l'observatoire).
- **Le pôle sud lunaire** (Shackleton, Artemis), **vue prioritaire (décision 10)** : le Soleil y est toujours rasant et
  tourne sur 360°, le cas le plus exigeant pour la carte. Il a sa calotte à 16 directions (§2.5), comme le pôle nord et
  les pôles de Mercure (les cratères à l'ombre permanente), de Mars et de Cérès.
- **La cohérence** : la même carte de part et d'autre de la passation entre disque et corps proche, donc moins de « pop »
  d'ombre.

### 2.4 Gain en perf (estimé, à mesurer)

- **Les disques lointains** : +2 lectures et ~20 opérations par pixel du corps HD seulement. Négligeable.
- **Le corps proche** : `nearShadow` gagne trois sorties anticipées :
  1. **Ombre lointaine certaine** : l'horizon de la carte dépasse le Soleil plus une marge, donc 0 sans rien lire
     d'autre, ni marche, ni carte du Soleil. Au Soleil bas, le cas cher, de grandes zones sautent tout.
  2. **Soleil plus haut que toute pente possible** : l'élévation d'un point du relief vu d'un autre ne dépasse jamais la
     plus forte pente sur le trajet (le théorème des accroissements finis, la courbure ne fait que l'abaisser). Si le
     Soleil dépasse S_max, la pente maximale du corps (DEM, cratères, houle, sol propre, tuiles, rochers ; mesurée par
     corps), le point est éclairé sans marche.
     - **Cette règle ne demande aucune carte** : elle sert aussi à Europe et aux lunes à sol propre (**H3a**).
     - La carte du Soleil de P1-2 ne la remplace pas : la marche ≤ 32 m et la marche reprise après la sortie tournent
       toujours.
  3. **La marche reprise remplacée par la carte d'horizon** : au-delà de la sortie de la carte du Soleil, plus de marche
     jusqu'à la coquille.
- **L'estimation** (révisée le 2 novembre) :
  - P1-2 a déjà pris une part du gain que la troisième passe attribuait à H3 (Mercure ciné −11 %). L'estimation d'alors
    (−2 à −6 ms sur Mercure ciné) est **à revoir à la baisse** : M0 mesure la part des ombres qui reste (`liteSkip`
    8192 coupe la carte, 4 les ombres), et H3 vise cette part.
  - Au Soleil haut : ombres → ~0 avec (2).
- **La mémoire** : carte de 2048 × 1024, 8 directions × 1 octet, avec mips, ≈ **22 Mo par corps**.
  - C'est la moitié du DEM pour la Lune et Mars, sa pleine résolution pour Mercure et Cérès.
  - À 4096 × 2048 : ~88 Mo.
  - **Les deux calottes polaires** (§2.5) : 2 × 256 × 256 texels × 16 directions, ~2 Mo, ~2,7 Mo avec les mips.
  - Un seul corps à la fois, comme `hdRelief`.
  - **T10 rend ~200 Mo** sur la texture des tuiles de la Terre (§3.6) : plus que H1b et les cartes réunis.
- **La cuisson** : ~2 M texels × 8 directions × 3 rayons par secteur × ~16 pas ≈ 800 M lectures, ~30–100 ms de GPU au
  total. Étalée en tranches de lignes sur ~16–32 images (2–4 ms par image pendant ~0,5 s), dans **une passe à part**
  (`shaders/horizon.wgsl`) : rien n'alourdit le noyau du traceur.

### 2.5 Faisabilité, risques, choix techniques

- **Les liaisons** : deux textures neuves, sur le modèle des ombres des arbres : **liaison 42**,
  `hdHorizon: texture_2d_array<f32>` (la carte), et **liaison 43**, `hdHorizonPole: texture_2d_array<f32>` (les
  calottes) :
  - `HORIZON_TEXTURE_LIMIT = 29` (les deux ensemble, un seul palier) et `withHorizonMaps(trace, supported)` dans
    `src/system/horizon-maps.ts` ;
  - un bloc `// BEGIN_HORIZON … // END_HORIZON` dans `trace.wgsl`, composé dans `tracer-source.ts composeTracer` comme
    `withTreeShadow` ;
  - la limite ajoutée au `Math.max(…)` de la demande au GPU (renderer) ;
  - **sous 29, le bloc reste un talon** qui dit « pas de carte » : les marches d'aujourd'hui, rien de cassé ;
  - les Mac, le M1 Max et NVIDIA en offrent 48, l'iPad Pro 44 ; les appareils à 16 perdent déjà tout au-delà de 18.
  - Des textures 1 × 1 de repli restent liées quand il n'y a pas de carte (comme le repli de `hdColor`).
  - **À compter avec T9** (une texture d'imagerie de plus pour la Terre, §6) : un seul décompte, un seul palier si
    possible.
  - **Écartés** :
    - réutiliser la liaison 29 (`surfaceColour`), parce que dans le cas même de H1b elle sert à la surface régionale de
      la Terre, et qu'il faudrait refaire le groupe de liaisons à chaque corps ;
    - une couche de `mapLo` : taille fixe 1024, format peut-être compressé (KTX), pas de place pour 8 octets par texel
      sans perte.
- **L'encodage** : 2 couches rgba8unorm, une direction par canal, **en racine signée** (s = signe·√|sinus / 0,75|).
  - Un octet linéaire fait des marches de 0,22°. C'est moins que le rayon du Soleil vu de la Lune (0,27°) ou de Mercure
    (0,57–0,87°), **mais plus que vu de Mars (0,16–0,19°) et de Cérès (~0,1°)** : des bandes dans la pénombre.
  - En racine, le pas vaut ~0,07° vers 0,5° d'élévation, là où tout se joue.
  - Le filtrage bilinéaire reste possible (l'encodage est monotone).
- **La hauteur de référence** : l'élévation est mesurée **depuis le point le plus haut du texel et de ses voisins** (G à la
  mip 1).
  - Un point fin (tuiles, cratères) plus haut que la moyenne du texel voit un horizon plus bas. Mesuré depuis la moyenne,
    la carte mettrait à tort les crêtes dans l'ombre au couchant ; l'erreur vaudrait Δh/d, soit ~1,4° pour 200 m à
    8 km, ~3 h de lumière lunaire.
  - Mesuré depuis le haut, la carte ne peut que sous-ombrer, et la carte du Soleil et la marche rattrapent le proche.
  - Option si H4 montre des ombres manquantes : une distance par direction (2 couches de plus, ×2 mémoire), qui permet la
    correction exacte.
- **Les directions** : 8 directions, chacune **le maximum de son secteur** (3 rayons à −15°, 0 et +15°). C'est prudent :
  sans cela, à 100 km, deux rayons espacés de 45° laissent un trou de ~78 km où un pic étroit n'est vu par personne.
- **Les calottes polaires** (décision 10 : le pôle sud lunaire est prioritaire) :
  - au-delà de 78° de latitude, de chaque côté et pour chaque corps à DEM, une grille **azimutale** (stéréographique
    polaire) de 256 × 256 : Lune ~2,8 km par texel (le DEM), Mars ~5,5 km, Mercure ~4 km, Cérès ~0,8 km ;
  - **16 directions**, repérées par les axes de la grille et non par l'est et le nord : aucun axe singulier au pôle ;
  - chacune le maximum de son secteur (3 rayons à −7,5°, 0 et +7,5°), même balayage, même encodage, 4 couches
    rgba8unorm par calotte ;
  - un fondu de 78° à 80° avec la carte équirectangulaire, qui reste partout ;
  - à la lecture : une branche de plus (|latitude| > 78°), deux lectures (les deux directions voisines, au plus deux
    couches).
- **Le balayage** :
  - de D à ~0,1 R (Lune 174 km, Mars 340 km, Mercure 244 km, Cérès 47 km), au pas ×1,25, courbure exacte ;
  - les hauteurs lues en G à la mip dont le texel vaut la moitié du pas ;
  - **validé contre une cuisson de référence** au pas d'un texel et sans mip sur des patchs tests (unitaires de H1,
    ≤ 0,1° d'écart visé).
- **D, le départ de la carte** (révisé le 2 novembre) : D = max(la sortie de la carte du Soleil, 2 texels de la carte
  d'horizon).
  - Lune : 2 texels = 5,4 km, sous les 2,5–10 km de la carte du Soleil.
  - Cérès : 2,8 km.
  - Mars : 10,4 km, au-delà des 10 km de la carte du Soleil : la marche comble l'écart.
- **L'API de cuisson générique** (décidé dans le plan commun) : `horizon.wgsl` prend une grille de hauteurs quelconque,
  décrite par son treillis (lat/lon ou stéréographique), son pas, son rayon, sa courbure ; pas seulement
  l'équirectangulaire de `hdRelief`. Elle sert alors aussi à la Terre (**H5**, §3.4) sans réécriture.
- **La mip des horizons** : la moyenne des élévations encodées (de loin, une pénombre adoucie). Choisie selon l'empreinte
  du pixel (`pixFoot`), comme leurs 1/22°.
- **Le raccord** : ombre = min(marche ≤ 32 m, carte du Soleil jusqu'à sa sortie, carte d'horizon au-delà de D).
  - Le min, pas le produit : un même relief vu par deux parties n'ombre pas deux fois.
  - La carte d'horizon part de D, sinon son relief grossier ombre là où la carte du Soleil éclaire.
  - Vue de loin, les reliefs plus petits que D n'ombrent pas : ils sont sous le pixel.
- **Équirectangulaire** :
  - les azimuts sont repérés par l'est et le nord locaux (comme `hdNormal`) ;
  - les pôles sont sur-échantillonnés en longitude ;
  - au pôle exact, l'axe est singulier : c'est la calotte qui y répond.
- **Les tuiles fines** (`moon-tiles`) n'entrent pas dans la carte (globale, au texel du DEM) : la carte du Soleil et la
  marche gardent ce détail.
- **Exclus** : Vénus, les géantes, les petites lunes sans DEM (cartes de normales seules).
- **La Terre n'est plus exclue** : voir §3.4 (T6, puis H5 en option).
- **Noté, hors plan** : la lumière cendrée de la Lune (absente du traceur aujourd'hui) pourrait lire la même carte dans la
  direction de la Terre.

---

## 3. Analyse — la Terre raster (2 novembre)

Résumé de [ANALYSE-TERRE-RASTER-2026-11-02.md](ANALYSE-TERRE-RASTER-2026-11-02.md) (lecture du code, rien lancé ; les
mécanismes, les chiffres et les leviers de confirmation y sont détaillés).

### 3.1 Comment la Terre raster est faite

- **Le cache du relief** (`terrain-cache.ts`) : 8 grilles 129² au pas de 1,2 / 2,4 / 9,5 / 38 / 153 / 611 / 2 446 m
  (`TERRAIN_CACHE_ROUNDS`), cuites au GPU sur `earthHeightExactG` (les tuiles + le détail procédural). Chaque niveau lit
  les tuiles avec une empreinte d'un demi-pas.
- **Le maillage** (`terrain-raster.ts`) : le patch (niveau 0, ±76 m), puis les anneaux 1 à 6 (jusqu'à ±156 km), chacun
  une grille 129² dont le trou sous le niveau plus fin est retiré, avec une **bande de chevauchement de 4 nœuds**
  (`RING_OVERLAP`). Pas de géomorphose ni de jupes. Le maillage n'écrit que des distances (et un marqueur de niveau dans
  `a`).
- **L'ombrage** (`shadeLite`) reconstruit le point par rayon × distance, puis la normale par les distances des pixels
  voisins (`rasterNormal`), l'imagerie des tuiles et des orthos lue à la main (anisotropie ≤ 4), le Soleil (`liteSun`),
  le ciel, l'air (`liteFinish`). L'eau va à `shadeWater`.

### 3.2 Les escaliers — régression du 22–23 octobre

- **Cause** : `TUNE_TILE_CR = 2` (`831e2f61`, 22/10) agrandit les tuiles par une **cubique monotone de Fritsch–Butland**
  (`monoCubic`, `tileSample`, et `sampleLevel` au CPU). Elle force la pente à 0 dès qu'une sécante est nulle ou change de
  signe.
  - Sur les données arrondies au mètre (SRTM, source de Terrarium sur la plupart du monde), les paliers restent plats et
    chaque marche devient un S : **un escalier de 1 m**.
  - Sur le bruit des données, chaque extremum local devient un petit plat : des **plis alignés sur la grille Mercator**.
- **Pourquoi visible depuis I3** (`0b8b8a7f`, 23/10) : les niveaux 0 et 1 du cache (1,2 et 2,4 m) lisent z14 (6,5 m à
  47°) avec un agrandissement de 2,4 à 3,4 octaves, donc en cubique pleine, et dessinent chaque marche avec 5 nœuds par
  texel. Avant I3, le patch était à 153 m de pas.
- **Où** : hors France et Suisse en permanence ; en France pendant le chargement et à chaque recentrage des fenêtres IGN
  z15–17 (tous les ~170 m en vol bas).
- `moonSample` (la Lune, Mars) utilise la même `monoCubic` pour garder les rebords des cratères : **ne pas la changer**
  pour la Terre (§6).

### 3.3 Les triangles visibles

1. **La normale est celle du maillage** (`rasterNormal`) : chaque triangle est éclairé à plat, des facettes de 1,2 m au sol
   à 153 m au loin. Seul `earthSlopeFine` (relevés IGN/swisstopo, empreinte < 10 m) y échappe.
2. **Les coutures percent** : les niveaux voisins sont cuits avec des empreintes différentes (4 ×), sur des tuiles plus
   grossières, en bilinéaire là où le fin est en cubique. Dans la bande de 4 nœuds, les grands triangles du niveau
   grossier passent devant le fin (vallées) : un anneau de triangles à 76 m, 153 m, 611 m, 2,4 km et 9,8 km.
3. **Régression d'I3, le garde-fou des coutures** : `rasterNormal` s'arrête aux coutures quand le marqueur de niveau
   change, mais `step = max(0, lv − max(level, PATCH_REF = 4))` vaut 0 pour les anneaux 1 à 4. **4 coutures sur 6 ne sont
   plus vues** : lignes de fausse pente.
4. **Au chargement** : la révision du cache est `earthTiles.stamp`, qui change à chaque fenêtre de tuiles recentrée ou
   complétée (environ chaque seconde en vol bas). Les 8 niveaux sont alors recuits **un par image**, depuis des états de
   tuiles différents, sans fondu : les coutures s'écartent, la forme saute. C'est aussi un coût permanent.

### 3.4 Les ombres du relief : presque aucune

- `encodeSunShadow` ne dessine que le **patch** (±76 m) dans une carte de ±10 km ; la table annonce une sortie à 9,8 km
  (le patch d'avant I3).
- `liteSun` (le matériau raster) lit la carte, **ne marche jamais**, et ignore les bloqueurs à moins de 300 m
  (`SUN_NEAR_M`).
- Les pixels tracés marchent jusqu'à 300 m, lisent la carte vide, ne reprennent qu'à 9,8 km.
- **Résultat : en raster, le relief ne porte pratiquement aucune ombre.** C'est la plus grosse perte AAA des vues basses
  au Soleil bas, et **R3 en dépend** : il rallonge la lumière rasante de 2–3 min, et en montagne la vallée resterait
  éclairée derrière la crête.
- **Correctif (T6)** :
  - les anneaux 1 à 4 dans la carte, avec leurs maillages, trous et hauteurs (géomorphosées après T3) ;
  - la sortie annoncée = ce qui est dessiné ;
  - dans `liteSun`, la portée réglée sur la pente (comme `SUN_N` pour les corps) au lieu des 300 m.
- **Au-delà de 10 km (H5, option)** : Soleil à 1–2°, les Alpes portent leurs ombres à 50–150 km. Un **horizon dans
  l'azimut du Soleil** sur les niveaux 4 à 6 du cache (3 × 129² nœuds, ±156 km), cuit par `horizon.wgsl` (l'API générique
  de H1) quand un niveau est recuit ou que le Soleil tourne de plus de ~0,5° ; lu par `liteSun` et `earthTerrainShadow`
  au-delà de la carte.

### 3.5 La mer

- **La côte est l'isoligne 0,5–2 m du maillage** : le masque de mer prend `hG`, la hauteur au point du maillage
  (`rasterPoint`), pas celle des données. Au-delà du patch, c'est la coupe linéaire de triangles de 9,5 à 611 m : une
  côte en dents de scie qui bouge à chaque recuisson. Au-delà de la portée OSM (7 km), seul reste le masque ETOPO
  (4,9 km).
- **Terres basses lues comme mer** : sous un texel ETOPO « mer », toute terre sous 0,5 m devient de l'eau (Camargue,
  polders).
- **Niveau des vagues isotrope** : `footSea = √(|fx|·|fy|)` dans `shadeWater`, `footSea / √FOOT` dans `main` au loin.
  En vue rasante, c'est plusieurs octaves trop fin : moiré, reflet qui pétille, LEAN lu trop fin. Le sampler de la mer
  n'a pas d'anisotropie.
- **La cascade de 1 024 m se répète** ; le SSR n'a pas de fondu en distance ; les rivières lointaines sont un miroir dur
  (analyse du 28/10).

### 3.6 Le chargement et la mémoire

- **Ordre** : niveau par niveau, du grossier au fin, 8 requêtes en tout (`MAX_INFLIGHT`). En `veryFar`, jusqu'à 256 tuiles
  de z11–14 passent avant z15.
- **Quota IGN** attendu dans le créneau de chargement : Terrarium et EOX bloqués derrière. Une tuile z11–13 avec
  silhouettes coûte jusqu'à 4 requêtes WMS-R.
- **Validité** : un niveau n'est dessiné que complet ; la bande neuve d'un recentrage (devant, avec `gaze`) reste aux
  niveaux grossiers jusqu'à sa dernière tuile.
- **Orthos** sans cache ni préchargement ; z18 sur ±210 m seulement.
- **Décodage** sur le fil principal ; la tuile réécrite entière quand son imagerie arrive.
- **Imagerie lue texel par texel** dans `rg32uint`, sans mips, ≤ 4 prises le long de l'axe long : scintillement au loin,
  et le poste le plus cher du matériau.
- **Mémoire** : en `veryFar` (le défaut), la texture des tuiles fait 2048² × 13 couches × 8 o = **436 Mo**. Les 8 niveaux
  à 4 tuiles (z6–10, z15–17) n'occupent qu'un quart de leur couche : **~200 Mo inutilisés**.

### 3.7 Ce que la Terre raster impose à H et R

| Phase | Contrainte | Conséquence dans le plan |
|---|---|---|
| R3 | sans ombres du relief, ses critères ne se jugent pas en montagne | **R3 avec T6** (et T1, T2 avant ses captures) |
| R0, R3, H0 | la lumière rasante montre marches, facettes, coutures, moiré de la mer | **T1 et T2 avant la séance « avant » (M0)** |
| R4a | relevé seul, il fait une marche au bord du dernier anneau (k = 0,13 : 1 m à 10 km, 16 m à 39 km, **250 m (5,5′) à 156 km**) | **R4a et R4b ensemble** sur la Terre raster |
| R4b | dans `terrainVs` et la cible de visibilité, là où vont T3 et T5 | après T3 et T5 ; une seule attache conçue pour les deux |
| R6a | les mirages sur l'horizon marin, où la mer est lue trop fin | **T7 avant R6a** |
| H1b, décision 5 | ~70 Mo + 22 à 88 Mo de cartes | **T10 avant H1b** (~200 Mo rendus) |
| H1 | la Terre aura besoin de la même cuisson (H5) | **API de cuisson générique dès H1** |
| H2, T9 | des textures en plus dans les noyaux de la Terre | **un seul décompte** face au palier 29 |

---

## 4. Cohérence avec les systèmes existants — ce que chaque phase modifie

| Système existant | Où | Ce qui change | Phase | Garde-fou |
|---|---|---|---|---|
| L'agrandissement des tuiles | `trace.wgsl tileSample`, `earth-tiles.ts sampleLevel` | une fonction hybride pour la Terre seule (monotone aux falaises et sur relevés, B-spline ailleurs), CPU = GPU ; `monoCubic` et `moonSample` intouchés ; option : pré-filtre au décodage des tuiles Terrarium z13–14 non marquées | T1 | `tests/earth-tiles` (CPU = GPU), contact du train ; e2e `monument-relief` (les falaises gardées) |
| Le marqueur de niveau des anneaux | `terrain-raster.ts ringFs`, `terrain-raster-hint.ts terrainRasterLevelStep`, `rasterHintTol` | le vrai niveau, séparé de la tolérance du traceur | T2 | captures aux coutures ; la tolérance `RHINT_TOL` inchangée |
| Le maillage des anneaux | `terrain-raster.ts terrainVs`, `drawRing`, `RING_OVERLAP` | géomorphose CDLOD sur les 8–16 derniers nœuds, chevauchement 1 nœud ; la même dans `terrainSunVs` | T3 | `TUNE_RASTER_PATHS: 2` ; images au chargement |
| Les cuissons du cache | `terrain-cache.ts encode`, `renderer.ts` (révision) | révision par niveau (empreinte et fenêtre), voisins cuits ensemble, fondu de 0,2–0,3 s | T4 | compteur `builds` en vol ; `rasterRingsInfo` |
| La normale du raster | `rasterNormal`, `earthSlopeFine`, la cible de visibilité (`TERRAIN_RASTER_FORMAT`) | normales lisses par nœud, interpolées, écrites dans une attache `rg16snorm` ; le détail des tuiles sous 2 km pour toutes les données ; l'attache prévue aussi pour R4b | T5 | `tune {TUNE_LITE: 16}` ; trace-ab |
| La carte d'ombre du relief de la Terre | `terrain-raster.ts encodeSunShadow`, `renderer.ts` (`SUN_HALF_M`, la table `TABLE_SUN`), `liteSun` | les anneaux 1–4 dessinés, la sortie vraie, la portée sur la pente dans `liteSun` | T6 | `TUNE_LITE: 4` (avant/après) ; e2e au couchant en montagne |
| L'eau du raster | `shadeLite` (masque), `shadeWater`, `seaWavesFft`, le sampler de la mer | `hG` des tuiles, WorldCover (classe 80) et OSM entre leurs portées, LOD sur l'axe long (ou `textureSampleGrad` + aniso 16), répétition cassée, SSR fondu | T7 | `TUNE_LITE: 512` ; e2e côtes |
| Le chargement des tuiles | `earth-tiles.ts` (`request`, `load`, `complete`, `pixels`, `requestOrtho`) | priorité par importance, deux files, validité par tuile (masque de bits dans `P.tileL`), orthos en cache, décodage en worker | T8 | `pending`, `finest`, `orthoFinest` en vol scripté ; e2e `zones`, `ortho`, `ign-relief` |
| L'imagerie des tuiles | `earth-tiles.ts` (texture), `earthImageryAniso`, `orthoImage` | une `texture_2d_array<rgba8unorm-srgb>` avec mips par tuile, lue par `textureSampleGrad` + aniso 16 ; les hauteurs en r32float à part | T9 | captures rasantes ; trace-ab ; le palier des textures |
| La mémoire des tuiles | `earth-tiles.ts makeTexture`, `params`, `tileTexel` | les niveaux à 4 tuiles rangés par quarts de couche (comme les orthos) | T10 | `stats` mémoire ; e2e iPad |
| La table du traceur | `src/gpu-tables.ts`, buffer `bodies` | + `TABLE_REFR` (~23 000 valeurs) | R1–R2 | `tests/gpu-tables.test.ts` |
| Le modèle de réfraction | `src/system/refraction.ts` | les tables à la place de la formule fermée ; **API inchangée** (`bending`, `apparentAltitude`, `refractDirection`, `refractionParams`), N₀ remplacé par un état d'air passé de la même façon | R1 | `tests/refraction.test.ts` étendu |
| Les atmosphères | `src/aero.ts` | lues par la réfraction (`us76`, VIRA, Titan) ; une fonction de densité exportée si besoin | R1, R5 | les tests d'`aero` inchangés |
| L'air de la météo | `renderer.ts refractivity`, `openmeteo.ts` | T **et** p, avec p ramenée au niveau de la mer par l'`elevation` du modèle | R1 | e2e météo réelle : N₀ ±3 % selon p |
| `airBend`, `shadeStars`, `REFR_DELTA` | `trace.wgsl` | lisent les tables ; le repère aplati gardé | R2 | e2e `refraction-wgs84` |
| `earthRingLight` | `trace.wgsl` | B_limbe à la place de l'exponentielle, ses épaisseurs optiques **re-réglées** | R2 | e2e `eclipses`, `eclipse-atmosphere`, `eclipse-raster` ; Danjon |
| La lumière du Soleil proche | `local-patch.ts` (`near.light`) → `P.near4`, cartes d'ombre du relief, des nuages, des arbres et des bâtiments | élevée de la courbure au sol sous la caméra | R3 | un seul point de correction ; e2e au couchant |
| Le globe tracé | `trace.wgsl earthMarch`, intersection d'orbite | le test de hauteur décalé du relèvement | R4a | captures au limbe d'orbite ; la couture au dernier anneau |
| Les rasters de la Terre | `terrain-raster*.ts`, `scenery-raster.ts`, `forest-shader.ts`, `runways3d.ts`, `roof-mesh.ts` | `refrLift(d)` partagée, à la projection seule (`terrainVs`, jamais `terrainSunVs` ni la cuisson), défaite par `shadeLite` grâce à l'attache de T5 | R4b | e2e dédiés (coutures, arbres flottants) ; WGS84 : positions, hauteurs et contacts intouchés |
| La réfraction des autres corps | `airBend` (Terre seule, `isEarth`) | Vénus, Titan | R5 | profils `venus`, `titan` |
| Les cartes HD | `hd-maps.ts`, renderer (`requestHd`/`releaseHd`) | un mode **« relief seul »** (DEM + horizons, couleur de repli 1 × 1) ; le corps **regardé** en plus du corps proche | H1b | `__bh` : `hdMap.mode` ; e2e `moon-telescope` |
| Le relief HD dans le noyau | `planetMapAt`, `isHd`, `hasDem` | `planetMapAt` ne lit `hdColor` qu'en mode complet (drapeau dans `P.hd2.z`) | H1b | captures : la couleur grossière gardée |
| La composition du traceur | `tracer-source.ts composeTracer`, limites demandées, `traceLayout` | `withHorizonMaps`, liaisons 42 et 43, `HORIZON_TEXTURE_LIMIT` 29 | H1–H2 | `scripts/check-wgsl.ts`, la source à 16, 28 et 48 textures |
| `nearShadow`, `shadeNear`, `bodyLite`, Mars `REL_SH` | `trace.wgsl` | les sorties (1)(2)(3) (§2.4), la carte d'horizon après la carte du Soleil ; `keyRelief` sans carte | H3a, H3 | A/B `planets-ab` ; images ≤ 1–2 % de pixels changés hors ombres nouvelles |
| Les disques lointains | `ourSegment` | l'ombre de la carte passée par l'argument `rs0` de `planetShade` (**sa signature ne change pas**) | H2 | trace-ab : vues sans corps HD ±1 % |
| Mars au loin | `otherGround` (2 appels) | la carte dans sa lumière directe | H2 | profil `mars` (qui porte aussi les géantes) |
| L'horizon solaire de la Terre | `horizon.wgsl` (API générique), `liteSun`, `earthTerrainShadow` | sur les niveaux 4–6 du cache, dans l'azimut du Soleil | H5 (option) | e2e Alpes au couchant |
| Les budgets des noyaux | `scripts/lib/kernel-profiles.ts`, `tests/kernel-budget.json` | + l'entrée `moon shadeLite` ; les budgets relevés sur mesure, jamais d'avance | M0, chaque phase | `KB_WRITE=1` après la compilation mesurée sous D3D12 (kerr-pc, `d3d12-ab`) |
| Les qualités par appareil | `tier.ts` | la résolution des cartes d'horizon selon `tier.level` (≤ 1 : 1024 ; 2 : 2048 ; 3 : 4096 si M0/H4 le permettent) | H1 | e2e iPad (`docs/IPAD-TESTS.md`) |
| Les réglages | `settings.ts` | `horizonMaps` (pref, allumé), à côté de `refraction` ; plus tard le profil de mirage forcé (R6a) | H2, R6a | `set_settings` |
| TARS | `ai/game-tools.ts`, `sky-now.ts` | « sky » : la pression, le modèle, le Soleil d'éclairage ; l'état des cartes d'horizon | H4, R1, R3 | `tests/tars-tools` |
| L'API d'automatisation | `automation.ts`, `docs/BH-API.md` | `hdMap.mode`, `horizon` (`body`, `ready`, `bytes`, `bakeMs`), l'état d'air ; pour la Terre : les cuissons par niveau, la validité des tuiles | H1, H1b, R1, T4, T8 | `bun scripts/bh-api.ts` |
| Les vues de mesure | `tests/e2e/lib/planet-views.ts`, e2e de vol bas | les vues de M0 (§7) | M0 | `scripts/ab-commit.ts` (A B B A) |
| Les docs | `PLAN-CIEL.md` (C3), `PLAN-PLANETES-AAA.md` (P8, P10), `WEBGPU-MATERIELS.md`, `E2E-CATALOGUE.md`, `PERFORMANCE.md`, `AAA-PROGRESS.md`, `ANALYSE-TERRE-RASTER-*` | à jour à chaque phase, FR + EN | toutes | — |

---

## 5. Exigences AAA (qualité)

- **Aucun « pop »** :
  - la Terre : les recuissons glissent (fondu, T4), les coutures ne se voient pas (T3), le fin arrive tuile par tuile
    (T8) ;
  - la carte d'horizon arrive en fondu (~0,5 s) une fois prête ;
  - la passation disque → corps proche lit la même carte ;
  - le mode « relief seul » → complet ne recharge que la couleur ;
  - aucune couture au bord des calottes polaires (le fondu de 78° à 80° vérifié en capture, Soleil rasant) ;
  - R3 : la lumière d'éclairage rejoint la direction vraie en fondu (~10°), sans saut d'ombre.
- **Aucune trace du maillage ni des données** :
  - ni escalier (T1), ni facette (T5), ni ligne aux coutures (T2, T3), au Soleil rasant comme au zénith ;
  - les côtes à la résolution des données (OSM, WorldCover), pas des triangles (T7) ;
  - pas de moiré ni de motif répété sur la mer (T7), pas de scintillement de l'imagerie au loin (T9).
- **Stabilité temporelle** :
  - la pénombre vient du disque du Soleil, pas du bruit ;
  - la marche garde son départ jittered (`RND`), mais les cartes n'ont pas de jitter ;
  - les tables de réfraction ne changent qu'avec l'air (pas de bande « la plus proche »).
- **La pénombre** : un smoothstep sur le **rayon angulaire du Soleil vu du corps** (comme `bodyShadow`), pas une constante ;
  sur la Terre, le filtrage 3 × 3 de `sunShadowFar` et la portée sur la pente.
- **Seule la lumière directe s'éteint** :
  - la carte multiplie la lumière directe (`rs` dans `planetShade`, `sh` dans `shadeNear`, `Eg` dans `liteSun`) ;
  - jamais le remplissage, le ciel, ni la lumière des anneaux.
- **La réfraction est la même partout** :
  - le disque dessiné, les étiquettes, la visée et TARS lisent les mêmes tables ;
  - l'éclairage (R3) en suit la direction, et les ombres avec lui (T6) ;
  - le relèvement (R4) est le même dans le traceur et les rasters ;
  - l'éclipse est re-réglée avec la nouvelle courbure.
- **Contre la réalité, pas contre nous-mêmes** :
  - Bennett et l'intégrale en couches pour la réfraction ;
  - Danjon pour l'éclipse du 07/09/2025 (la valeur L publiée, relevée en R0) ;
  - **une photo réelle du terminateur** (amateur ou LROC WAC) à la même colongitude solaire pour H2 ;
  - **le pôle sud lunaire** contre les cartes d'éclairement publiées tirées de LOLA (Mazarico et al. 2011) ;
  - **la Terre** contre l'orthophoto (la côte, les ombres d'une vallée au couchant à une date connue) et contre les
    données elles-mêmes (le relief IGN à 0,5 m, sans marche).
- **Pas de régression ailleurs** :
  - la Terre, les géantes et les vues sans corps HD restent à ±1 % en trace-ab, sauf les gains voulus ;
  - les e2e existants restent verts (`refraction-wgs84`, `moon-telescope`, `airless-ground`, `moons-ground`,
    `moon-tiles`, `eclipses`, `planet-detail`, `monument-relief`, `ign-relief`, `raster-fine-relief`, `hlod-cost`,
    `lowflight-governor`, `ortho`, `zones`, `miller-sea`).

## 6. Noyaux et performance

- **L'état** (31 octobre au soir, à relire en M0) :
  - **la taille inlinée** (`tests/kernel-budget.test.ts`, chaque budget = la mesure à sa création + 10 %) : 86 à 100 %
    partout, `moon main` et `general main/lut` à 100 % ;
  - **les buffers de stockage pleins** (8, + le 9ᵉ du décor) : R, H et T n'en ajoutent pas ;
  - **les textures** : de la marge sur ordinateur (48) ; le palier 29 pour H ; **T9 en ajoute une aux noyaux de la Terre**
    (qui compilent aussi H2 : `discs`, `main`) — décompte commun ;
  - **la clé** : un seul bit libre, le 31. **Aucune phase T n'en demande** : il reste à H.
- **Les règles** :
  1. **Un appel unique par noyau** : chaque site d'appel est une copie inlinée.
     - La carte d'horizon se lit dans `ourSegment` (les disques) et dans `nearShadow` ; **pas dans `planetShade`**,
       appelée à 4 endroits.
     - Dans `nearShadow`, appelée à 3 endroits, la lecture est fermée par une constante pour `keyRelief`.
     - Dans `otherGround` (Mars), 2 copies : à mesurer ; si elles coûtent, la lecture passe à l'appelant de
       `earthLookFar` seul.
     - **T1** : la fonction hybride remplace `monoCubic` dans `tileSample` seul, qui est dans chaque `earthH` de chaque
       noyau de la Terre : une seule définition, aucune copie de plus.
  2. **Pas de bit qui va et vient en vol** (la leçon du profil raster de la Terre : chaque bit changé était une
     recompilation de plusieurs minutes sur D3D12) :
     - le code de la carte est compilé dans les noyaux qui peuvent en avoir besoin ; un paramètre dit s'il y a une carte ;
     - si l'A/B montre un coût sans carte > 1 % (la leçon de `HAS_SHADE`), le bit 31 lui est réservé, **jamais dans le
       profil raster de la Terre**.
  3. **Les budgets** : relevés sur mesure, après la compilation mesurée sous Windows (kerr-pc, `d3d12-ab`), pas d'avance.
     **Les mesures D3D12 regroupées** : T1, T5, T7 et R2 touchent les mêmes entrées `earth-*` ; une séance par groupe
     plutôt qu'une par phase quand elles se suivent.
  4. **Le budget de temps** :
     - les planètes : jamais plus lentes que la Terre dans la même vue (P10) ;
     - la Terre : **jamais plus lente qu'avant le plan** sur les vues de M0, sauf T6 (≤ 0,3 ms pour des ombres qui
       manquaient) et ce que Sam accepte au vu des images.
- **Les noyaux et passes touchés, par phase** :

  | Phase | Fonctions | Entrées du budget à remesurer |
  |---|---|---|
  | T1 | `tileSample` (et `sampleLevel` au CPU) | tous les `earth-*` (`main`, `discs`, `shade`, `shadeLite`, `shadeWater`, `env`), `general` |
  | T2 | `ringFs`, `terrainRasterLevelStep` | `earth-raster shade`, `shadeLite`, `shadeWater` (presque rien) |
  | T3, T4 | `terrainVs`, `terrainSunVs` (pipeline à part), `terrain-cache.ts` (CPU, passe de cuisson) | aucune entrée du traceur ; la passe « terrain raster visibility », la cuisson |
  | T5 | `rasterNormal`, `earthSlopeFine`, la cible de visibilité | `earth-raster shadeLite`, `shadeWater` |
  | T6 | `liteSun`, `sunShadowFar`, `encodeSunShadow` | `earth-raster shadeLite`, `shadeWater`, `shade` |
  | T7 | `shadeLite` (masque), `shadeWater`, `seaWavesFft`, `main` (la mer au loin) | `earth-raster shadeLite`, `shadeWater`, `main` |
  | T9 | `earthImageryAniso`, `earthImagery` | tous les `earth-*` (gain attendu en taille comme en temps) |
  | H2 | `ourSegment`, `otherGround` | `game-space main`, `earth-raster main/discs`, `earth-raster-wx main/discs`, `earth-trace main`, `earth-photo main`, `earth-only main`, `eclipse main`, `mars main`, `general main/lut` |
  | H3a, H3 | `nearShadow` | `moon main`, **`moon shadeLite` (neuf)**, `moons main/shadeLite`, `mars main/shadeLite` (géantes comprises), `general main/lut` |
  | H5 | `liteSun`, `earthTerrainShadow` | `earth-raster shadeLite`, `shade`, `main` |
  | R2 | `airBend`, `shadeStars`, `earthRingLight` | tous les `earth-*`, `eclipse main/env`, `general` |
  | R4a | `earthMarch`, l'intersection d'orbite | `earth-trace main`, `earth-raster main`, `earth-only main` |
  | R5 | `airBend` pour Vénus et Titan | `venus main`, `titan main` |
  | R6 | `airBend`, le pixel du raster rendu au traceur | `earth-raster main/shadeLite` (le « lac » n'est **pas** ombré dans `shadeLite`, le pixel est rendu à `main`) |

- **Le protocole de mesure** :
  - `scripts/ab-commit.ts <rev>` avec `planets-ab` (A B B A, deux tours) pour les planètes ; `scripts/trace-ab.ts` et les
    e2e de vol bas (`lowflight-governor`, `AB_CMD`) pour la Terre ;
  - sur des vues figées, machine froide (l'outil thermique d'abord), onglets du panneau fermés, A/A ±1 % ;
  - en raster, vue cockpit, captures journalisées (pas d'images tracées hors ligne) ;
  - les e2e partagés entre ce Mac et kerr-mini ; une e2e IGN à la fois ; le mini ne se compare qu'à lui-même.

---

## 7. Le plan

Trois volets, une séance de mesure commune. L'ordre est au §8.

### M0 — la séance « avant » (commune)

| Phase | Contenu | Fichiers | Fait quand |
|---|---|---|---|
| **M0** | **Préalables** (ex-H0 + R0 + l'« avant » de la Terre), **après T1 et T2** (sinon leurs marches et coutures brouillent tout) : l'entrée `moon shadeLite` ajoutée aux profils et son budget mesuré ; relire `origin/master` d'Alex. **Vues** : Mercure ciné Soleil 15°, Lune au terminateur depuis 500 km, Lune au télescope depuis la Terre au premier quartier, Mars au sol au couchant, Cérès ciné, pôle sud lunaire, Europe ciné ; Biarritz 21/06/2026 (Soleil à 0,5° et 2° au télé, la définition de l'aplatissement fixée) ; coucher depuis l'ISS (équateur et > 70° N) ; Lune éclipsée du 07/09/2025 (Danjon) ; les Andes au couchant ; La Hague ; **la Terre raster** : Chamonix bas Soleil bas (relief, coutures, ombres), une pente douce hors d'Europe (SRTM seul), une côte vue de 2 à 10 km, une suite image par image pendant l'arrivée d'un niveau de tuiles, un vol scripté de 2 min (le journal des tuiles : `pending`, `finest`, `orthoFinest`, les cuissons). **Mesures** : chaque vue A/A ±1 % ; **la part des ombres** après P1-2 dans Mercure, Cérès et Europe ciné (`liteSkip` 4 et 8192) ; le coût de la cuisson du cache en vol. **Décisions** : D par corps (§2.5), S_max par corps, `reliefAt` (~8 × plus tôt que `hdAt`), le rayon et la résolution des calottes polaires (78°, 256 × 256 par défaut) | `docs/progress/refraction-horizons/M0.md`, `kernel-profiles.ts`, `kernel-budget.json`, `planet-views.ts` | Mesures et décisions écrites ; la part des ombres connue par vue |

### T — La Terre raster

| Phase | Contenu | Fichiers | Fait quand |
|---|---|---|---|
| **T1** | **Les escaliers** : une fonction d'agrandissement hybride pour la Terre seule — la pente au nœud `mix(m_CatmullRom ou B-spline, m_FritschButland, s)`, `s` montant avec la raideur du texel (\|d\|/texel > ~0,5) ou la marque de relevé (`tileFine`) ; CPU = GPU (`sampleLevel`). Option si M0 montre encore des marches : un pré-filtre au décodage des tuiles Terrarium z13–14 non marquées (3 × 3, ou tramage ±0,5 m puis flou). `monoCubic` et `moonSample` intouchés | `trace.wgsl tileSample`, `earth-tiles.ts`, `tests/earth-tiles.test.ts` | Pente douce SRTM au Soleil rasant sans marche ; Monument Valley garde ses falaises (`monument-relief`) ; le contact CPU = GPU ; budgets `earth-*` dans leur marge (sinon relevés en séance D3D12) |
| **T2** | **Le marqueur des coutures** : le vrai niveau du maillage dans la cible, séparé de la tolérance du traceur (`rasterHintTol` inchangée) ; `rasterNormal` voit les 6 coutures | `terrain-raster.ts`, `terrain-raster-hint.ts`, `renderer.terrainRings` | Plus de ligne de fausse pente aux coutures de 76 m, 153 m, 611 m, 2,4 km ; trace-ab 0 |
| **T3** | **La géomorphose** : sur les 8–16 derniers nœuds avant le bord de sa fenêtre, chaque sommet glisse vers la hauteur du niveau suivant interpolée au même point (la table a les deux niveaux) ; les sommets impairs sur le milieu des arêtes grossières ; chevauchement ramené à 1 nœud ; la même dans `terrainSunVs` | `terrain-raster.ts`, `renderer.ts` (le niveau suivant passé à chaque anneau) | Plus aucun triangle qui perce, en vol et pendant un chargement (captures image par image) ; la passe de visibilité au même coût (±2 %) |
| **T4** | **Les cuissons cohérentes** : la révision par niveau (les niveaux dont l'empreinte, zf ± 1, lit un niveau de tuiles changé et dont la fenêtre le recoupe) ; les niveaux voisins publiés ensemble ; un fondu de 0,2–0,3 s entre l'ancienne cuisson et la nouvelle (le tampon précédent gardé, l'interpolation dans `terrainVs`) ; `earthDetail` hors des niveaux ≥ 3 (sous-pixel là-bas) si M0 montre qu'il coûte | `terrain-cache.ts`, `terrain-raster.ts`, `renderer.ts` | Cuissons par seconde en vol bas divisées (mesuré) ; aucun saut de forme au chargement ; le coût de la cuisson en baisse |
| **T5** | **Les normales lisses** : par nœud (différences centrées sur la grille du cache, dans `terrainVs` ou cuites), interpolées, écrites dans une attache `rg16snorm` en octaèdre — **conçue aussi pour R4b** (la place du relèvement ou de la distance vraie) ; `shadeLite` et `shadeWater` les lisent à la place de `rasterNormal` ; le détail des tuiles (`earthSlopeFine` généralisé à toutes les données) sous 2 km, lecture ancrée, fondu vers la normale du nœud | `terrain-raster.ts`, `trace.wgsl` (`shadeLite`, `shadeWater`, `rasterNormal`), `terrain-raster-hint.ts` | Plus de facettes (`TUNE_LITE: 16` comme référence) ; trace-ab ±1 % ; +4 o/px |
| **T6** | **Les ombres du relief de la Terre** (avec R3) : les anneaux 1–4 dans la carte d'ombre du Soleil (leurs maillages, trous, hauteurs géomorphosées ; jamais le relèvement de R4b) ; la sortie annoncée = ce qui est dessiné ; dans `liteSun`, la portée sur la pente (`SUN_N`) au lieu des 300 m ; les pixels tracés reprennent la marche à la vraie sortie | `terrain-raster.ts`, `renderer.ts` (`encodeSunShadow`, `TABLE_SUN`), `terrain-raster-hint.ts`, `trace.wgsl liteSun` | Chamonix au Soleil bas : les crêtes ombrent la vallée ; aucune acné ni liseré ; ≤ 0,3 ms ; `TUNE_LITE: 4` montre la différence à toute distance jusqu'à 10 km |
| **T7** | **La mer** : `hG` lu dans les tuiles à l'empreinte du pixel (`earthH(gq, foot, true)`) pour le masque ; WorldCover (classe 80) et OSM entre leurs portées, à la place d'ETOPO pour la côte ; le LOD des vagues sur l'axe long (ou `textureSampleGrad` + sampler aniso 16), dans `shadeWater` et dans `main` (sans le `/√FOOT`) ; la cascade de 1 024 m tournée ou décalée par cellule de 4 km ; le SSR fondu de 2 à 6 km ; `inlandWater` avec la rugosité non résolue | `trace.wgsl`, `renderer.ts` (sampler) | Côtes nettes à toute distance (contre l'orthophoto), Camargue en terre ; plus de moiré au couchant ; pas de motif répété de 2 à 20 km ; < 0,1 ms |
| **T8** | **Le chargement** : priorité par importance à l'écran, tous niveaux confondus (distance au point regardé / taille du texel ; les 2 × 2 tuiles centrales des niveaux fins avant la couronne des grossiers ; les surfaces MNS après le sol nu) ; deux files (l'IGN derrière son portillon sans tenir de créneau ; Terrarium et EOX à 12–16) ; la validité par tuile (masque de bits par niveau, fondu de bord comme une fenêtre) ; les orthos en cache LRU et en anneau préchargé, `ORTHO_SPAN = 8` pour z15–16 ; le décodage en worker ; plus de réécriture des hauteurs à l'arrivée de l'imagerie | `earth-tiles.ts`, un worker de décodage, `trace.wgsl` (le masque dans `earthH`, `earthImagery`) | Le niveau le plus fin sous la caméra 2 à 5 × plus tôt sur le vol scripté de M0 ; aucune longue tâche (> 50 ms) du fil principal due aux tuiles ; e2e `zones`, `ortho`, `ign-relief` verts |
| **T9** | **L'imagerie filtrée** : les hauteurs en r32float, l'imagerie (tuiles et orthos) dans une `texture_2d_array<rgba8unorm-srgb>` avec mips par tuile (`mips.wgsl`), lue par `textureSampleGrad` et un sampler aniso 16 ; le tore des fenêtres gardé (mips dans chaque tuile, fondu de bord) ; le décompte des textures avec H (§6) | `earth-tiles.ts`, `trace.wgsl` (`earthImageryAniso`, `earthImagery`, `tileTexel`, `orthoImage`), `renderer.ts` (layout) | Sol net et stable au loin (captures rasantes à 1–3 km) ; le matériau plus rapide (mesuré) ; la source composée valide à 16, 28 et 48 textures |
| **T10** | **La mémoire des tuiles** : les niveaux à 4 tuiles (z6–10, z15–17) rangés par quarts de couche, comme les orthos ; la texture de `veryFar` de 436 à ~240 Mo | `earth-tiles.ts` (`makeTexture`, `params`, `put`), `trace.wgsl tileTexel` | `stats` : ~200 Mo de moins ; images identiques ; e2e iPad |

### H — Les cartes d'horizon

| Phase | Contenu | Fichiers | Fait quand |
|---|---|---|---|
| **H3a** | **La sortie par la pente** (§2.4, règle 2), sans carte : S_max par corps passé au noyau ; le Soleil au-dessus de S_max → `nearShadow` rend 1 sans marche ni carte du Soleil. Pour tous les mondes sans air, Europe et les lunes à sol propre compris | `trace.wgsl nearShadow`, `renderer.ts` (S_max dans `P`), `hd-maps.ts` (S_max du DEM au chargement) | A/B : Europe, Mercure, la Lune, Cérès ciné et bas au Soleil haut plus rapides ; images identiques hors bruit (la règle est exacte) |
| **H1** | **La cuisson GPU, API générique** : `src/system/horizon-maps.ts` + `src/shaders/horizon.wgsl`. Entrée : une grille de hauteurs quelconque (son treillis, son pas, son rayon, sa courbure) — `hdRelief` (G) pour les corps, plus tard le cache de la Terre (H5). Par texel, 8 secteurs × 3 rayons, de D à ~0,1 R au pas ×1,25, courbure exacte, depuis le haut du texel (§2.5) ; sortie : `texture_2d_array` rgba8unorm de 2 couches en racine signée, mips moyennées ; résolution selon `tier.level`. **Les deux calottes polaires** : au-delà de 78°, grille stéréographique 256 × 256, 16 secteurs × 3 rayons, 4 couches par calotte, cuites dans la même passe. Étalée sur ~16–32 images à chaque changement de corps HD ; « prête » signalée au renderer, avec le fondu. `withHorizonMaps`, les liaisons 42 et 43, le palier 29 ; `__bh.renderer.horizon`. **Unitaires** : sphère nue → horizon plat ; un bloc de 8 km vu à la bonne élévation ; le secteur voit un pic hors des rayons centraux ; la cuisson contre la référence au pas d'un texel (≤ 0,1°) ; l'encodage aller-retour ; la calotte : un bloc vu pareil par la calotte et par la carte à 79°, un pic vu dans les 16 directions au pôle exact, aucun NaN au pôle ; **une grille lat/lon locale** (celle du cache de la Terre) cuite par la même API | `horizon-maps.ts`, `horizon.wgsl`, `hd-maps.ts`, `tracer-source.ts`, `renderer.ts`, `tests/horizon-maps.test.ts` | Cartes et calottes cuites pour la Lune, Mars, Mercure et Cérès ; tests verts ; la source composée valide à 16, 28 et 48 textures |
| **H1b** | **Le corps HD selon ce qu'on regarde** (après T10). Priorité : `pin` > le corps proche (`dN < hdAt`, inchangé) > **le corps regardé**, celui des corps à DEM dans le champ qui est le plus grand à l'écran, au-delà de **`reliefAt`**. Pour lui, le **relief seul** : DEM (~43 Mo avec ses mips, 16 Mo de plus le temps du chargement) + horizons et calottes (~25 Mo), la couleur de repli 1 × 1, le drapeau dans `P.hd2.z` lu par `planetMapAt`. Libéré à 2 × le seuil. En approche, le passage en mode complet ne charge que la couleur | `renderer.ts` (`requestHd`/`releaseHd`), `hd-maps.ts`, `trace.wgsl planetMapAt` | e2e `moon-telescope` étendu (depuis la Beauce, au plus serré et à ~2° de champ : relief HD et ombres du terminateur ; mémoire et à-coups au chargement mesurés ; aucune erreur GPU) |
| **H2** | **Les disques lointains** : `horizonSeen(q, Ls, sunR, foot)` (2 lectures, azimut interpolé, smoothstep sur le rayon du Soleil, mip selon l'empreinte) dans `ourSegment`, passé par `rs0` ; pour Mars, dans `otherGround`. Pas de bit. Réglage `horizonMaps` | `trace.wgsl`, `renderer.ts`, `settings.ts` | Captures du terminateur contre une photo réelle à la même colongitude ; le pôle sud lunaire vu d'orbite ; trace-ab : la Terre et les vues sans corps HD inchangées (±1 %) ; budgets remesurés |
| **H3** | **Le corps proche** (réécrit le 2 novembre, après P1-2) : `nearShadow` = (1) carte d'horizon au-dessus du Soleil + marge → 0 sans rien d'autre ; (2) H3a ; (3) sinon la marche ≤ 32 m et la carte du Soleil jusqu'à sa sortie, puis **la carte d'horizon au-delà de D**, à la place de la marche reprise ; le min des parties. Mars : la carte au-delà de D, et au-delà des 25 km de `REL_SH` dans `otherGround` (H2). `keyRelief` sans carte | `trace.wgsl nearShadow`, `shadeNear`, `bodyLite*` | Mercure ciné ≤ la Terre ; Cérès ciné mesuré ; **le pôle sud lunaire** près de Shackleton sur un jour lunaire accéléré (le rebord éclairé, le fond jamais, contre LOLA) ; images identiques hors ombres lointaines nouvelles et pénombres (≤ 1–2 % des pixels) |
| **H4** | **Mesures et doc** : A/B sur les vues de M0 ; e2e en raster, vue cockpit, captures ; la planche avant/après (et contre la photo réelle) ; la décision sur la pleine résolution et sur la distance par direction ; TARS ; docs FR + EN | `docs/progress/refraction-horizons/H4.md`, AAA-PROGRESS, `E2E-CATALOGUE.md`, `WEBGPU-MATERIELS.md`, `BH-API.md` | Tableau des coûts, planche, poussé |
| **H5** *(option, décision de Sam au vu de T6)* | **L'horizon solaire de la Terre** : sur les niveaux 4 à 6 du cache (3 × 129² nœuds, ±156 km), l'élévation de l'horizon dans l'azimut du Soleil (et ses deux voisins pour l'interpolation), cuite par l'API de H1 quand un niveau est recuit ou que le Soleil tourne de plus de ~0,5° ; lue par `liteSun` et `earthTerrainShadow` au-delà de la carte de T6, en min avec elle | `horizon-maps.ts`, `terrain-cache.ts`, `trace.wgsl` | Les Alpes au couchant : les ombres portées à 50–150 km, sans pop au passage de la carte ; coût mesuré (visé < 0,2 ms et une cuisson de < 1 ms par recuisson) |

### R — La réfraction

| Phase | Contenu | Fichiers | Fait quand |
|---|---|---|---|
| **R3** *(en premier des R, avec T6)* | **Le Soleil d'éclairage réfracté** : `near.light` élevé de la courbure au sol sous la caméra, sous un seuil d'élévation (fondu jusqu'à ~10°). Tout suit d'un coup : `P.near4`, les cartes d'ombre du relief (T6), des nuages, des arbres et des bâtiments. Le disque dessiné reste celui d'`airBend`. Avec la courbure actuelle (`bending` à la hauteur du sol) ; R2 la passe aux tables sans autre changement | `local-patch.ts` ou `renderer.ts` (là où `near.light` est fait), `sky-now.ts` | e2e au couchant à Biarritz **et à Chamonix** (raster, vue cockpit, captures toutes les 30 s autour du coucher) : le sol éclairé jusqu'à la disparition du disque, ou derrière la crête ; aucune ombre décalée (relief, nuages, arbres, bâtiments) ; aucun saut au fondu ; trace-ab 0 ; TARS « sky » donne la hauteur d'éclairage |
| **R1** | **Le modèle CPU** : `src/system/refraction-layered.ts`. Bouguer + Simpson (s = √(r − r_bas)) sur les couches d'`aero.ts` ; n − 1 d'Edlén mis à l'échelle de la densité ; l'air réel (T, p ramenée à la mer, l'écart de T décroissant sur ~1 km) ; les tables B_haut, B_limbe (512 périgées resserrés → 2 048 en k régulier), l'atterrissage, le relèvement par distance, `TerrestrialK` ; faites dans un worker, une fois par air. `refraction.ts` les lit : **les 5 utilisateurs CPU suivent sans changement d'API**. Le commentaire faux corrigé. `photo/plans.ts` garde l'air standard pour les dates futures, et prend l'air réel pour « maintenant ». **Unitaires** : Bennett ±3 % de 0,5° à 45° ; l'aplatissement 0,81–0,83 ; le limbe contre l'intégrale (≤ 3″ aux coudes) ; l'atterrissage (rasant : 0,5° au-delà du limbe à 400 km) ; la monotonie ; la dispersion ; la pression ramenée à la mer ; leurs chiffres (66′ rasant, 5,57′ à 20 km depuis 400 km) | `refraction-layered.ts`, `refraction.ts`, `renderer.ts refractivity`, `aero.ts` (export), `tests/refraction.test.ts` | Tests verts ; TARS « sky » donne les nouvelles valeurs, la pression et le modèle |
| **R2** | **Le GPU, la Terre** : `TABLE_REFR` dans `gpu-tables.ts`, écrite à chaque changement d'air. `airBend` : test de zone d'abord ; au-dessus de l'air, k par pixel dans B_limbe ; dans l'air, B_haut et 2·B_limbe − B_haut vers le bas ; le repère aplati gardé. `REFR_DELTA` par le facteur d'Edlén. `shadeStars` : même principe. `earthRingLight` : B_limbe et sa dérivée pour le Newton, ses épaisseurs optiques **re-réglées** contre Danjon. **R3 passé aux tables** | `trace.wgsl` (`airBend`, `shadeStars`, `earthRingLight`), `renderer.ts`, `gpu-tables.ts`, `tests/gpu-tables.test.ts` | trace-ab neutre (±1 %) au sol et en orbite ; Soleil couchant 0,82 au télé ; coucher de l'ISS écrasé ~1/5 en bas, posé sur le limbe à 70° N comme à l'équateur ; `refraction-wgs84` vert ; l'éclipse dans la fourchette de Danjon ; e2e des éclipses verts |
| **R4** | **Le sol relevé, traceur et rasters ensemble** (après T3 et T5) : le relèvement par distance (k terrestre dans l'air, l'atterrissage au-dessus), laissé de côté sous 0,1′. **R4a** : dans le test de hauteur de `earthMarch` et de l'intersection d'orbite ; l'ombrage reconstruit le point vrai. **R4b** : `refrLift(d)` partagée, à la projection seule (`terrainVs`, jamais `terrainSunVs` ni la cuisson), dans les six chemins ; `shadeLite` défait le relèvement par l'attache de T5 ; CPU, collisions et WGS84 intouchés. Si R4b devait attendre : R4a seulement là où le raster ne dessine pas (orbite, au-delà du dernier anneau, avec un fondu) | `trace.wgsl`, `terrain-raster*.ts`, `scenery-raster.ts`, `forest-shader.ts`, `runways3d.ts`, `roof-mesh.ts` | D'orbite, plus de trou entre le Soleil réfracté et le globe ; les Alpes à 300 km relevées de ~10′ ; **aucune marche au bord du dernier anneau** ; aucune couture ni arbre flottant ; le relèvement identique au traceur à 0,1′ près |
| **R5** | **Vénus et Titan d'orbite** : `airBend` pour le corps proche qui a une table ; **leur lentille** (§1.5) pour l'auréole de Vénus au transit du 11/12/2117 (ou de quatre rayons, le Soleil derrière) et pour l'anneau rouge de la Terre vu de la Lune éclipsée ; Titan sous sa brume | `trace.wgsl`, `renderer.ts`, `refraction-layered.ts` | L'arc du Soleil sur le limbe de Vénus ; coût nul hors de la bande du limbe |
| **R6a** *(après T7)* | **Les mirages, profils forcés** : les profils d'air près du sol (mer chaude, inversion, conduit, route chaude), illustratifs, choisis dans les réglages et par TARS ; les tables de l'œil tracées en RK4 (r, θ, e) à travers les points de retournement, dans un worker, **sous ~2 km seulement**, trois couleurs ; au GPU, chaque pixel lit sa vraie direction ; les rayons retournés vers le haut sous l'horizon rendus au traceur ; l'inverse des étoiles par la table de l'élévation vraie, les images secondaires ignorées ; `apparentAltitude` et la visée sur la branche de l'image droite | `refraction-layered.ts` (RK4), `trace.wgsl`, `settings.ts`, `ai/game-tools.ts` | Le Soleil en « vase étrusque » au télé sur un profil forcé, sur une mer sans moiré ; une route chaude à midi ; coût GPU nul hors de la bande de l'horizon ; tables sans à-coup |
| **R6b** | **Les mirages tirés de la météo** : le profil déduit d'Open-Meteo (T à 2 m, du sol, de la mer par l'API marine, niveaux 1 000/975/950/925 hPa, à ajouter aux requêtes) ; un tirage plausible hors de portée. **Une recherche d'abord** (radiosondages, mirages publiés), puis un go/no-go sur des dates réelles. Option : le sol lointain inversé ; la scintillation | `refraction-weather.ts`, `openmeteo.ts` | Une côte et une date réelles où un mirage est documenté : le phénomène au bon jour, aucun les jours ordinaires |

## 8. Ordre et estimations

**Départ : dès que les géantes sont finies** (PLAN-GEANTES-VOLUME, V8 et V9 ; décision 11). Avant de lancer : relire
`git log`, les notes d'Alex sur `origin/master`, et l'état de `trace.wgsl` (les numéros de ligne de ce plan bougent).

| # | Phases | Pourquoi là |
|---:|---|---|
| 1 | **T1, T2** | petites, sans coût ; sans elles, les captures « avant » mesurent les marches et les coutures |
| 2 | **M0** | une seule séance « avant », sur l'état réel (P1-2 compris) |
| 3 | **R3 + T6** | le premier des R (décision 8), avec les ombres du relief qui le rendent jugeable |
| 4 | **H3a** | petit, sans carte, sert aussi à Europe |
| 5 | **T10**, puis **H1** (API générique), **H1b**, **H2**, **H3**, **H4** | les cartes d'horizon (décision 1), la mémoire d'abord libérée |
| 6 | **T3**, **T4**, **T5** | la Terre sans triangles ; l'attache de T5 prête pour R4b |
| 7 | **T7** | la mer, avant les mirages |
| 8 | **R1**, **R2** | la réfraction en couches (la séance D3D12 regroupée avec T5 et T7 si elles se suivent) |
| 9 | **R4** (R4a + R4b), **R5**, **R6a**, **R6b** | dans l'ordre décidé |
| 10 | **T8**, **T9** | indépendants (`earth-tiles.ts`) : peuvent glisser plus tôt si un créneau se libère ; T9 compté avec H pour les textures |
| — | **H5** | option, au vu de T6 |

| Phase | Effort | Risque | Gain qualité | Effet perf |
|---|---|---|---|---|
| T1 | ½ j | faible (garder les falaises ; CPU = GPU) | **fort** (fin des escaliers) | 0 |
| T2 | ¼ j | faible | moyen | 0 |
| M0 | 1 j | — | — | — |
| T6 | ½–1 j | faible (acné, portée sur la pente) | **fort** (les ombres du relief) | ≤ +0,3 ms |
| R3 | ¼ j | faible | **moyen partout** au couchant | 0 |
| H3a | ¼–½ j | faible (S_max à ne pas sous-estimer) | — | ombres → ~0 au Soleil haut |
| T10 | ½–1 j | faible | — | ~200 Mo de GPU rendus |
| H1 | 2 j (API générique comprise) | moyen (cuisson, calottes, référence) | — | ~2–4 ms par image pendant ~0,5 s à l'arrivée d'un corps |
| H1b | 1 j | moyen (mémoire, règle de chargement) | **fort** depuis la Terre | chargement unique |
| H2 | ½ j | faible | **fort** (le terminateur de loin) | ≈ 0 |
| H3 | 1 j | moyen (raccord avec la carte du Soleil) | **fort** (portée ~10 → ~200 km, le pôle sud lunaire) | gain, à mesurer (révisé à la baisse) |
| H4 | ½ j | — | — | — |
| T3 | 1–1,5 j | moyen (T, impairs, carte d'ombre) | **fort** (fin des triangles aux coutures) | ≈ 0 |
| T4 | 1 j | moyen (le fondu, la révision par niveau) | **fort** au chargement | **gain** (moins de cuissons) |
| T5 | 1–1,5 j | moyen (attache, coutures) | **fort** (fin des facettes) | ≈ 0, +4 o/px |
| T7 | 1,5 j | faible à moyen (masques, LOD) | **fort** sur les côtes | < 0,1 ms |
| R1 | 1–1,5 j | faible | moyen (prédictions, TARS) | 0 (worker) |
| R2 | 1–1,5 j | moyen (le re-réglage de l'éclipse) | moyen au télé, fort vu d'orbite | ≈ 0 avec le test de zone |
| R4 (a + b) | 2–2,5 j | **élevé** (six chemins) | moyen (le limbe d'orbite, le sol lointain au télé) | ≈ 0 |
| R5 | ½–1 j | faible | moyen, rare | 0 hors du limbe |
| R6a | 2 j | moyen | **fort et unique** | GPU ≈ 0 |
| R6b | 2–4 j (recherche comprise) | **élevé** | fort si ça marche | 0 |
| T8 | 2–3 j | moyen (validité par tuile, worker) | **fort** à chaque arrivée | réseau ; fil principal soulagé |
| T9 | 2 j | moyen (mips dans le tore, layout) | **fort** au loin | **gain** du matériau |
| H5 | 1–1,5 j | moyen | fort en montagne au couchant | à mesurer |

Total ≈ 30–36 jours de travail, H5 et R6b compris.

## 9. Règles de livraison (habituelles)

- Seul sur `main` (ou dans un arbre à part si une autre session y travaille), **un commit + push + capture par phase**,
  réponses en français, docs FR + EN.
- **Coordination** : relire `git log` avant chaque phase ; d'autres sessions travaillent dans le même dépôt (ne jamais
  `git stash`, ne commiter que ses propres morceaux, `git log origin/main..` avant de pousser).
- `bunx biome ci .` avant chaque push ; `bun run check && bun test` (les unitaires, sortie entière dans un fichier) ; e2e et
  A/B selon `docs/E2E.md` (une Chrome de test à la fois sur chaque Mac), partagés entre ce Mac et kerr-mini.
- Mesures : §6. Les titres des tâches de vérification portent leur durée estimée.
- **WGS84** (CLAUDE.md) : T et R touchent au dessin seulement. Positions, hauteurs et contacts restent géodésiques ; la
  mer sur le géoïde ; T1 change la forme du relief **des deux côtés** (CPU = GPU), jamais d'un seul.
- TARS atteint chaque nouveauté (réglage ou télémétrie) ; `__bh` et `BH-API.md` suivent.
- Le canal avec vr-solar-system : une note dans `docs/agent/` à la fin de T, de H et de R (ce qu'on a repris, nos mesures,
  nos écarts à leurs choix et pourquoi).

## 10. Décisions (Sam)

Les décisions 1 à 10 datent du 31 octobre ; la 11 du 2 novembre. **Le plan n'est pas lancé.**

1. **L'ordre : les cartes d'horizon d'abord** (H), **puis la réfraction** (R). *Amendé par la décision 8* : R3 passe
   avant. *Dans le plan commun* : T1, T2 et M0 avant tout, T6 avec R3.
2. **R4** (le sol relevé) **et R5** (Vénus et Titan) **restent dans ce plan**. *Dans le plan commun* : R4a et R4b ensemble
   sur la Terre raster (§3.7).
3. **Les mirages : R6**, dans ce plan, après R2 : R6a (profils forcés) puis R6b (la météo, après une recherche).
4. **H1b : oui**, pour le télescope et les vues qui grossissent : le relief seul de l'astre regardé, ~70 Mo GPU pour la
   Lune ; le seuil `reliefAt` (décision 7).
5. **Résolution des cartes : la plus élevée qu'on peut se permettre.** 2048 × 1024 par défaut (~22 Mo) ; 4096 × 2048
   (~88 Mo) pour la Lune et Mars si M0 et H4 le permettent (`tier.level` 3), T10 aidant ; 1024 en repli
   (`tier.level` ≤ 1) ; les calottes polaires à 256 × 256 partout (~2,7 Mo).
6. ~~La carte d'ombre du Soleil des corps de P10 reste à faire à côté de H3.~~ **Faite** le 1er novembre (P1-2,
   `f3aa71e5`). H3 garde la marche ≤ 32 m et la carte du Soleil, et remplace la marche reprise au-delà par la carte
   d'horizon (§7).
7. **Le seuil de H1b : `reliefAt`**, propre au relief seul, ~8 × plus tôt que `hdAt` (~3° de champ pour la Lune vue de
   la Terre), sa valeur mesurée en M0.
8. **R3 en premier** des R, avec la courbure actuelle ; R2 le passe aux tables.
9. **R6 en deux temps** : R6a, puis R6b (une recherche avec un go/no-go).
10. **Le pôle sud lunaire est une vue prioritaire** (Shackleton, Artemis) : deux calottes polaires à 16 directions
    au-delà de 78° pour chaque corps à DEM, validées contre les cartes d'éclairement de LOLA.
11. **(2 novembre) Un plan commun** : la Terre raster AAA (T), les cartes d'horizon (H) et la réfraction (R) ensemble,
    **qualité AAA et performance**. **On le commence dès que les géantes sont finies.**

## 11. Questions ouvertes

Elles se tranchent avant ou pendant M0. Pour chacune, ce que je recommande :

1. **T1, la forme du correctif** : la fonction hybride seule (recommandé d'abord : pas de nouvelle donnée, CPU = GPU), ou
   aussi le pré-filtre des tuiles SRTM au décodage (si M0 montre encore des marches hors d'Europe).
2. **H5 (les ombres de la Terre au-delà de 10 km)** : dans le plan après H4, ou en option jugée au vu de T6 (recommandé :
   option, T6 couvre déjà les vallées jusqu'à 10 km).
3. **T8 et T9** : dans ce plan en fin d'ordre (recommandé : les gains de chargement et de netteté au loin font partie de
   « parfaite AAA »), ou dans un plan à part.
4. **R4, si R4b prend du retard** : attendre R4b pour livrer R4a (recommandé), ou livrer R4a limité à l'orbite et au-delà
   du dernier anneau.

## 12. Historique

- **31 octobre (première passe)** : le plan, sur `main` à `06ed0498`, après l'analyse de vr-solar-system.
- **31 octobre** : le volet R revu après leurs changements 4h, 4i et `b2f5e51` ; les réponses de leur Claude (05:10 UTC)
  intégrées ; R6 ajouté.
- **31 octobre (deuxième passe)** : code relu des deux côtés ; H1b ajouté ; les décisions 1 à 5 ; le repère de R2 fait
  (`efe4369a`, e2e `346a48a8`) ; le point du noyau (`4146b9a8`).
- **31 octobre au soir (troisième passe, sur `0eed0272`)** : chaque affirmation relue dans le code ; les trois chemins des
  corps rocheux, le repère de R2, la pression, les atmosphères d'`aero.ts`, `hdColor`, le bit 31, `moon shadeLite`,
  l'estimation de H3, la mémoire de H1b corrigés ; les tables de réfraction, leur place, la liaison des horizons,
  l'encodage, la hauteur de référence, les secteurs, H3a, R4a/R4b, R6a/R6b changés ; §3–§5 ajoutés ; les décisions 6 à
  10.
- **2 novembre** : l'analyse de la Terre raster
  ([ANALYSE-TERRE-RASTER-2026-11-02.md](ANALYSE-TERRE-RASTER-2026-11-02.md)) et sa lecture croisée avec ce plan.
  - **Corrigé** : la carte d'ombre du Soleil des corps est faite (P1-2) — décision 6 caduque, H3 réécrit, l'estimation de
    H3 revue à la baisse, D redéfini ; les rochers commités ; « la Terre exclue » remplacé (elle n'a presque pas d'ombres
    du relief en raster).
  - **Ajouté** : le volet T (T1–T10), la séance commune M0 (ex-H0 + R0 + la Terre), H5 en option, l'API de cuisson
    générique dans H1, R4a et R4b réunis, l'ordre commun, la décision 11, quatre questions.
  - Le nom du fichier est gardé.
