# Plan commun — la Terre raster AAA, la bonne réfraction, les cartes d'horizon du relief

Date : **2 novembre 2026**, relu sur `main` à `824b3a5c`, puis confronté au challenge
[CHALLENGE-PLAN-REFRACTION-HORIZONS.md](CHALLENGE-PLAN-REFRACTION-HORIZONS.md) (§3.9) et à
[CHALLENGE-ANALYSE-TERRE-UNREAL-2026-11-02.md](CHALLENGE-ANALYSE-TERRE-UNREAL-2026-11-02.md) (§3.10) ;
[PLAN-IMAGE-VIPER11.md](PLAN-IMAGE-VIPER11.md) y est fusionné (décision 28). Statut : **lancé le 2 novembre** — M0a fait ([M0a.md](progress/refraction-horizons/M0a.md)), C0 écrit
([C0.md](progress/refraction-horizons/C0.md)) **et en relecture par Sam** (décision 33).

- **Quand** : on commence **dès que les géantes sont finies** (PLAN-GEANTES-VOLUME : V8 et V9 restent), décision 11 du
  §10.
- **Ce qui est fait** : seul le repère de R2 (`efe4369a`, e2e `346a48a8`).
- **D'où vient ce plan** : il réunit quatre chantiers qui touchent les mêmes fonctions, les mêmes vues et les mêmes mesures.
  - **T — la Terre raster** : les escaliers, les triangles, les ombres du relief, la mer, le chargement. Analyse
    détaillée : [ANALYSE-TERRE-RASTER-2026-11-02.md](ANALYSE-TERRE-RASTER-2026-11-02.md), suite de
    [celle du 28/10](ANALYSE-TERRE-RASTER-2026-10-28.md).
  - **H — les cartes d'horizon** des planètes rocheuses (troisième passe du 31 octobre au soir).
  - **R — la réfraction** (troisième passe du 31 octobre au soir).
  - **Q — la qualité Unreal** : la lumière du sol, les villes, le volume, l'air et les nuages, l'image, les photos
    dé-éclairées, le monde habité, la perf qui paie tout ça. Analyse :
    [ANALYSE-TERRE-UNREAL-2026-11-02.md](ANALYSE-TERRE-UNREAL-2026-11-02.md), avec ce que [VIPER 11](PLAN-IMAGE-VIPER11.md) fait de bon
    pour l'image (la chaîne caméra, le ré-éclairage partiel de la photo, les détails, le couvert bas, les nuages amortis).
- **Le but** : qualité AAA **et** performance. Aucune phase ne rend une vue plus lente qu'avant sans que le gain d'image
  soit mesuré et accepté. Une partie des phases (Q1, T4, T9, H3a, H3, Q9) doit faire **gagner** du temps : **Q1, la
  perf, passe avant tout ajout de qualité** ; ses gains sont visés, comptés seulement une fois mesurés (décision 31).
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

> « Analyse encore plus loin : vois-tu des choses à ajouter, modifier, améliorer, implémenter pour augmenter la qualité
> graphique, les performances, le réalisme (photoréalisme) des vues de la Terre ? Je veux vraiment une qualité Unreal
> Engine AAA. » (2 novembre)

> « Mes décisions : fais au mieux, AAA qualité et perf, tout dans le périmètre. Mets à jour avec les meilleures décisions.
> N'exécute pas encore le plan. Enlever les ombres cuites des photos ? Comment on pourrait s'y prendre ? » (2 novembre)

> « Crée un plan md pour inclure ce qui est bon dans viperoneone dans le projet. Ce qui améliore le graphisme. » (31 octobre,
> [PLAN-IMAGE-VIPER11.md](PLAN-IMAGE-VIPER11.md)) — puis, le 2 novembre, après les deux challenges : « Deep analysis et
> update le plan. »

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
| **T6** | les ombres portées du relief en raster (aujourd'hui presque aucune), proches et lointaines | toutes les vues au Soleil bas, la montagne au couchant | ≤ 0,5 ms |
| **T7** | une mer sans moiré ni motif répété, des côtes nettes, plus de terres basses changées en mer | les côtes, l'orbite basse, les couchers sur la mer | < 0,1 ms |
| **T8, T10** | le détail fin 2 à 5 × plus tôt, sans à-coups ; ~200 Mo de GPU rendus | chaque arrivée sur un lieu, le vol bas | réseau ; mémoire en moins |
| **T9** | un sol net et stable au loin en vue rasante (filtrage matériel, mips, aniso 16) | le vol, le téléobjectif | **gain** GPU |
| H (disques lointains, avec H1b) | les ombres longues du terminateur (Copernic, les Apennins, les remparts des cirques), et le relief HD de la Lune, absent aujourd'hui | la Lune au télescope, au trépied, en photo depuis la Terre | 0 hors des pixels du corps HD |
| H (le corps proche) | une portée d'ombre de 2,5–10 km (la carte du Soleil) à ~170–340 km ; les plaines mises dans l'ombre par une chaîne lointaine ; le pôle sud | la Lune, Mercure, Mars et Cérès en orbite, en approche, au sol au Soleil bas | **négatif** : des marches sautées (§2.4) |
| H5 (la Terre, 8 directions) | les ombres des Alpes au couchant au-delà de 10 km, pour tout azimut ; la visibilité du ciel des vallées (Q4) | la montagne au Soleil bas | à mesurer |
| R1–R2 | la hauteur et la forme du Soleil et de la Lune près de l'horizon (0,74 → 0,82), le coucher vu de l'ISS, les prédictions du CPU d'accord avec une table publiée, la Lune éclipsée | le téléobjectif, le planificateur photo, TARS, l'orbite | ≈ 0 |
| R3 | le sol éclairé jusqu'à la disparition du disque (2–3 min de lumière rasante) | **toutes** les vues au couchant, même au grand angle | 0 |
| R4 | le sol lointain relevé, l'horizon d'avion, plus de « trou » au limbe vu d'orbite | le téléobjectif, l'orbite | ≈ 0 |
| R5 | l'auréole de Vénus, l'anneau rouge de la Terre vu de la Lune éclipsée | des vues rares et spectaculaires | 0 hors du limbe |
| R6 | des mirages (Soleil en « vase étrusque », Fata Morgana, le « lac » d'une route chaude) | le téléobjectif à la côte | 0 au GPU hors de la bande de l'horizon |
| **Q1** | des ms rendues (culling, caches, tampons — gains **visés**, mesurés poste par poste), la netteté du vol égale à celle de l'arrêt, des paliers de réglages avec hystérésis | tout, tout le temps | **gain** (à mesurer) |
| **Q2–Q3** | une photo ré-éclairée avec mesure (plus de double ombre au couchant), un ciel qui éclaire selon la pente, des villes avec leurs façades, matériaux, fenêtres la nuit, leurs routes | toute vue basse, les villes de jour et de nuit | ≤ +0,8 ms |
| **Q4** | l'occlusion ambiante, les ombres du décor à toute distance et au Soleil rasant, les reflets du Soleil sur les matériaux connus, le vent proche, des forêts en volume jusqu'à 30 km | le vol bas, la montagne, le couchant | ≤ +2,5 ms (mesuré) |
| **Q5** | une atmosphère physique unique (tables de Hillaire, l'air vrai partout), une météo cohérente et datée, des nuages composés couche par couche, amortis, avec un champ proche et la gloire de l'avion | tous les ciels, l'heure bleue, la météo | gain sur les nuages |
| **Q6** | un upscaler temporel de classe TSR (avant les effets qui scintillent), l'exposition locale, un **profil Caméra** (étalonnage, grain, vignette, exposition et temps de pose de caméra) et un profil Neutre ; le mode GoPro | le vol, le cockpit, le replay | ≈ 0, et l'échelle peut baisser si les scènes le permettent |
| **Q7** | les ombres cuites ôtées des photos (recherche, go/no-go), des scans de détail sous la photo, la piste usée, la neige et les saisons, des orthos ailleurs qu'en France | le sol de près, l'hiver, l'Europe | ≈ 0 par image ; +0,5–1,5 ms en vol bas (détail) |
| **Q8** | le couvert bas (herbe, arbustes, cailloux) près des pistes puis en vol rasant ; la nuit des rues, le trafic, les lignes haute tension, les éoliennes, les vignes ; façades PBR, imposteurs d'arbres, neige qui tombe | le monde habité | au budget, par paliers |

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
- **Le coût avant P1-2 (P8.md, kerr-mini, A3)** — à remesurer en M0b (P1-2 l'a changé) :

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
  - Au Soleil à 2°, un sommet de 5 km porte son ombre à ~84 km sur la Lune sphérique (5 km ≈ d·tan 2° + d²/2R ; les
    140 km de la troisième passe supposaient un sol plat). Aujourd'hui la marche reprise s'arrête à 20 km.
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
     **La carte est une estimation, pas une preuve** (challenge §5.1) : la sortie ne vaut qu'au-delà d'une marge =
     l'erreur d'échantillonnage du secteur + le rayon du Soleil (et l'arrondi `rg16float` du DEM), lue sur la mip 0 ;
     dans la marge, la carte du Soleil et la marche restent.
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
    (−2 à −6 ms sur Mercure ciné) est **à revoir à la baisse** : M0b mesure la part des ombres qui reste (`liteSkip`
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
  - Ce choix peut laisser éclairé le fond d'une vallée masqué par une chaîne lointaine (challenge §5.2) : H1 mesure ce
    biais sur ses cas de test (variation de hauteur du récepteur, changement du bloqueur dominant).
  - Une distance par direction (2 couches de plus, ×2 mémoire) aide sans être exacte (le bloqueur dominant change avec
    la hauteur du récepteur) : décidée en C0 si H3 en dépend, pas après H4.
- **Les directions** : 8 directions, chacune **le maximum de son secteur** (3 rayons à −15°, 0 et +15°). Ce n'est **pas**
  une borne (challenge §5.1) : un pic étroit peut tomber entre deux rayons, et le maximum d'un secteur peut venir d'un
  relief à côté de l'azimut du Soleil. La carte est une **estimation visuelle** ; les décisions (§2.4, sortie 1) prennent
  une marge. Sans ces 3 rayons, à 100 km, deux rayons espacés de 45° laisseraient un trou de ~78 km.
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
  - de D à une portée **dérivée des données** : le dénivelé maximal du corps et sa courbure au Soleil le plus bas pris
    en charge (Δh ≈ d²/2R : Cérès, R ≈ 470 km, 3 km de dénivelé → ≥ 53 km) ; ~0,1 R comme premier ordre ailleurs
    (Lune 174 km, Mars 340 km, Mercure 244 km) ; au pas ×1,25, courbure exacte ;
  - les hauteurs lues en G à la mip dont le texel vaut la moitié du pas ;
  - **validé contre une cuisson de référence** au pas d'un texel et sans mip sur des patchs tests (unitaires de H1,
    ≤ 0,1° d'écart visé).
- **D, le départ de la carte** (révisé après le challenge, §5.3) : **une bande fixe par corps**, `D_cuisson` = 2 texels
  de la carte — pas la sortie de la carte du Soleil, qui varie selon le point, l'azimut, la caméra et la couverture, et
  qu'une carte précuite ne peut pas suivre.
  - À 2048 de large (corrigé : la troisième passe donnait les valeurs de 4096) : Lune **10,7 km**, Mars **20,8 km**,
    Mercure **15,0 km**, Cérès **2,9 km** (à l'équateur ; la latitude et la direction y ajoutent leur anisotropie).
  - À l'ombrage : si la sortie de la carte du Soleil tombe avant `D_cuisson`, une marche courte comble l'intervalle ;
    si elle tombe après, les deux se recouvrent et le min les combine (le relief grossier mesuré depuis le haut du texel
    sous-ombre plutôt qu'il ne double) — le biais est mesuré sur le pilote de H1.
- **L'API de cuisson générique** (décidé dans le plan commun) : `horizon.wgsl` prend une grille de hauteurs quelconque,
  décrite par son treillis (lat/lon ou stéréographique), son pas, son rayon, sa courbure ; pas seulement
  l'équirectangulaire de `hdRelief`. Elle sert alors aussi à la Terre (**H5**, §3.4) sans réécriture.
- **La mip des horizons** : la moyenne des élévations encodées (de loin, une pénombre adoucie). Choisie selon l'empreinte
  du pixel (`pixFoot`), comme leurs 1/22°.
- **Le raccord** : ombre = min(marche ≤ 32 m, carte du Soleil jusqu'à sa sortie, marche courte jusqu'à `D_cuisson` si
  besoin, carte d'horizon au-delà).
  - Le min, pas le produit : un même relief vu par deux parties n'ombre pas deux fois. Pour une source étendue, deux
    bloqueurs qui cachent chacun une moitié du disque donnent encore 0,5 (challenge §5.5) : approximation assumée, son
    erreur mesurée au terminateur et aux pôles.
  - **La mip moyenne n'est pas une visibilité** (challenge §5.4) : la moyenne de V(horizon) n'est pas V(moyenne) ; les
    mips servent au rendu lointain (biais mesuré), jamais aux sorties anticipées.
  - La carte d'horizon part de D, sinon son relief grossier ombre là où la carte du Soleil éclaire.
  - Vue de loin, les reliefs plus petits que D n'ombrent pas : ils sont sous le pixel.
- **Équirectangulaire** :
  - les azimuts sont repérés par l'est et le nord locaux (comme `hdNormal`) ;
  - les pôles sont sur-échantillonnés en longitude ;
  - au pôle exact, l'axe est singulier : c'est la calotte qui y répond.
- **Les tuiles fines** (`moon-tiles`) n'entrent pas dans la carte (globale, au texel du DEM) : la carte du Soleil et la
  marche gardent ce détail.
- **Exclus** : Vénus, les géantes, les petites lunes sans DEM (cartes de normales seules).
- **La Terre n'est plus exclue** : voir §3.4 (T6, puis H5 à 8 directions, décision 17).
- **Noté, hors plan** : la lumière cendrée de la Lune (absente du traceur aujourd'hui) pourrait lire la même carte dans la
  direction de la Terre.

---

## 3. Analyse — la Terre raster (2 novembre)

Résumé de [ANALYSE-TERRE-RASTER-2026-11-02.md](ANALYSE-TERRE-RASTER-2026-11-02.md) (lecture du code, rien lancé ; les
mécanismes, les chiffres et les leviers de confirmation y sont détaillés).

### 3.1 Comment la Terre raster est faite

- **Le cache du relief** (`terrain-cache.ts`) : 8 grilles 257² (129² jusqu'au 3 novembre) au pas de 1,2 / 2,4 / 9,5 / 38 / 153 / 611 / 2 446 m
  (`TERRAIN_CACHE_ROUNDS`), cuites au GPU sur `earthHeightExactG` (les tuiles + le détail procédural). Chaque niveau lit
  les tuiles avec une empreinte d'un demi-pas.
- **Le maillage** (`terrain-raster.ts`) : le patch (niveau 0, ±153 m), puis les anneaux 1 à 6 (jusqu'à ±312 km), chacun
  une grille 257² dont le trou sous le niveau plus fin est retiré, avec une **bande de chevauchement de 4 nœuds**
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
- **Correctif (T6, révisé après le challenge §4.5)** : une portée réglée sur la pente ne suffit pas — avec une seule carte
  de 9,8 m le texel, elle vaut ~390 m au Soleil rasant, et `liteSun` ne marche pas pour la combler. Donc :
  - des **cascades** (±1,5 km à ~1,5 m le texel, ±10 km), en cache, avec les anneaux et leurs hauteurs (géomorphosées
    après T3) — le décor y entre en Q4 (S1) ;
  - les **ombres de contact** en espace écran pour les derniers mètres ;
  - une couverture explicite avec un état « inconnu » (→ H5), la sortie annoncée = ce qui est dessiné.
- **Au-delà de 10 km (H5, décision 17)** : Soleil à 1–2°, les Alpes portent leurs ombres à 50–150 km. Un **horizon à 8
  directions** sur les niveaux 3 à 6 du cache (jusqu'à ±156 km), cuit par `horizon.wgsl` (l'API générique de H1) quand un
  niveau est recuit — pas quand le Soleil tourne ; lu par `liteSun` et `earthTerrainShadow` au-delà de la carte, et par
  Q4 comme visibilité du ciel (l'occlusion des vallées).

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
| R0, R3, H0 | la lumière rasante montre marches, facettes, coutures, moiré de la mer | **M0a d’abord ; T1 et T2 avant les références détaillées (M0b)** |
| R4a | relevé seul, il fait une marche au bord du dernier anneau (k = 0,13 : 1 m à 10 km, 16 m à 39 km, **250 m (5,5′) à 156 km**) | **R4a et R4b ensemble** sur la Terre raster |
| R4b | dans `terrainVs` et la cible de visibilité, là où vont T3 et T5 | après T3 et T5 ; une seule attache conçue pour les deux |
| R6a | les mirages sur l'horizon marin, où la mer est lue trop fin | **T7 avant R6a** |
| H1b, décision 5 | ~70 Mo + 22 à 88 Mo de cartes | **T10 avant H1b** (~200 Mo rendus) |
| H1 | la Terre aura besoin de la même cuisson (H5) | **API de cuisson générique dès H1** |
| H2, T9 | des textures en plus dans les noyaux de la Terre | **un seul décompte** face au palier 29 |

### 3.8 Ce qui manque pour une qualité Unreal (volet Q)

Résumé de [ANALYSE-TERRE-UNREAL-2026-11-02.md](ANALYSE-TERRE-UNREAL-2026-11-02.md) (lecture du code, constats lourds
revérifiés à la main) :

1. **La lumière du sol** : Lambert pur, ciel plat sans occlusion, rebond fixe qui ignore les nuages, aucun reflet du Soleil
   sur la terre ; les photos gardent leurs ombres cuites, et les nôtres s'y ajoutent.
2. **Les villes en raster** : le `buildingLook` (façades, matériaux et couleurs des données, fenêtres allumées) ne tourne que
   dans le traceur ; en raster, des murs beiges et des toits désaturés. Les routes (`scenerySurface`) n'y sont pas.
3. **L'image** : le gouverneur est inerte en raster (échelle clouée à 0,75), RCAS ne passe qu'à pleine taille (net à
   l'arrêt, mou en vol), le TAAU est éteint, pas de vecteurs de mouvement.
4. **L'air** : `AIR_K = 3` (trop mince au sol), diffusion multiple constante, pas de rayons d'ombre du relief ; près de la
   caméra, des nuages de bruit et pas les vrais.
5. **Le lointain** : plus d'ombres du décor au-delà de 750 m, plus d'arbres au-delà de ~2,6 km, la forêt lointaine est
   une couleur ; aucun vent.
6. **La perf** : anneaux du relief, bâtiments et carte d'ombre du relief dessinés en entier à chaque image, tampons et
   copies superflus — des gains à prendre, à mesurer avant de les compter.
7. **Les photos** : la méthode pour en ôter les ombres cuites (L7) est au §9 de l'analyse : correction topographique de
   Sentinel-2 sur le relief de la même tuile ; ombres des orthos rendues par notre propre décor vu du Soleil de la prise
   de vue, affinées par l'image, relevées par le rapport soleil/ombre mesuré ; sur le GPU, une fois par tuile.

### 3.9 Le challenge du 2 novembre — ce qu'il change

[CHALLENGE-PLAN-REFRACTION-HORIZONS.md](CHALLENGE-PLAN-REFRACTION-HORIZONS.md) (une autre session, sur le plan à
`f3d2790b`, avant le volet Q) a été relu point par point et ses affirmations clés revérifiées dans le code. Il a raison
sur l'essentiel : les points les plus fragiles sont les **contrats entre représentations**. Ce qui change :

| Point du challenge | Vérifié | Ce que le plan fait maintenant |
|---|---|---|
| Pas de vrai « avant » (§7.4) | oui : T1, T2, Q1 passaient avant M0b | **M0a** au tout début, **M0b** après T1, T2, Q1 |
| Contrats absents (§3) | — | **C0** : des contrats écrits avant de coder (huit, puis treize avec §3.10) |
| T3 vise le bilinéaire (§4.2) | oui : `terrainPoint` interpole en bilinéaire ; rapports de grille 2 et 4 | la géomorphose vise la surface **triangulée** (barycentrique), coins et phases traités |
| T4 « par paires » (§4.3) | oui | des **générations** publiées ensemble ; le fondu sur le domaine commun |
| T5 en `rg16snorm` (§4.4, §7.3) | oui : seuls timestamps, BC et ASTC sont demandés (`renderer.ts:1978`) | la normale dans la cible `rgba32uint` actuelle (16 o/px, masques d'écriture par canal respectés) : ni texture ni fonctionnalité en plus |
| T6 : la portée sur la pente laisse un trou (§4.5) | oui : 4 × 10 000/2048 × √(1 − 0,05²)/0,05 ≈ **390 m** au Soleil rasant | **cascades** d'ombre (la fine à ~1,5 m le texel) + **ombres de contact** ; une couverture explicite avec un état « inconnu » |
| T7 : une côte est une classe (§4.6) | — | une hiérarchie de sources d'eau et leurs états ; déphasage plutôt que rotation des vagues |
| T8/T9/T10 séparés (§4.7) | oui | une seule architecture (C0-4), livrée ensemble et plus tôt |
| H : 3 rayons ≠ borne, mips ≠ visibilité, D variable (§5.1–5.4) | oui ; D faux (10,7 km pour la Lune à 2048, pas 5,4) | estimation visuelle + marge de décision ; `D_cuisson` fixe ; valeurs corrigées |
| H3a : un maximum mesuré n'est pas une borne (§5.6) | — | borne prudente de toutes les composantes dessinées, sinon H3a abandonné |
| Shackleton (§5.7) | — | **H1c** : les DEM LOLA des sites du pôle sud |
| H1b déplace le sol physique (§5.8) | oui : `requestHd` appelle `groundHeights` (`renderer.ts:1881–1895`) | un mode **rendu seul** qui ne touche pas au sol du CPU |
| Portée et chiffres plats (§5.9) | oui (84 km et non 140 ; Cérès ≥ 53 km) | portée dérivée des données ; test de la sphère nue à −D/2R |
| R3 global casse les éclipses (§6.1) | oui : `nearLight` → `Ls` → `sunSeen` → `sunSeenPhysical` | **deux Soleils** : géométrique et incident local |
| R1 hydrostatique (§6.2) | — | intégration de dP/dh, `pressure_msl`, Ciddor, API étendue |
| Précision en pixels (§6.3–6.4) | oui : au champ de 0,02°, 3″ ≈ 45 px | budgets en pixels par mode (C0-7) ; erreur mesurée sur la lecture finale |
| R4 : tous les consommateurs (§6.6) | oui (`rasterPoint`, `seaScreen`/`seaSSR`, `reprojDir`…) | contrat de projection C0-3 ; le relèvement défait par le calcul |
| R6 : les mirages de terrain (§6.8) | — | R6a coupé en **ciel** et **terrain** ; R6b « plausible », pas prédit |
| Le double éclairage des photos (§8.1) | — | déjà traité : Q7 / L7 |
| Validation par % de pixels, captures fixes (§8.2–8.3) | — | validation par régions et en séquences (§5) |
| Estimations (§11) | — | réestimées après C0 et Q1 ; le total reste une estimation |

Ce que je ne reprends pas tel quel : plusieurs candidats d'horizon par texel et le transport complet des mirages de
terrain — d'abord la version la plus simple qui tient son contrat, mesurée ; la complexité seulement si la mesure
l'exige.

### 3.10 Le challenge « Terre Unreal » et VIPER 11 — ce qui change

[CHALLENGE-ANALYSE-TERRE-UNREAL-2026-11-02.md](CHALLENGE-ANALYSE-TERRE-UNREAL-2026-11-02.md) (une autre session, sur
l'analyse Unreal à `c884ef25`) a été relu et ses constats clés revérifiés dans le code. Il signale aussi
[PLAN-IMAGE-VIPER11.md](PLAN-IMAGE-VIPER11.md) (31 octobre, rien de lancé), qui couvrait les mêmes sujets : il est
**fusionné ici** (décision 28) pour n'avoir qu'un devis et qu'une implémentation.

| Point | Vérifié | Ce que le plan fait maintenant |
|---|---|---|
| Les ombres du décor coupées au Soleil rasant | oui : `treeShadowFrame` rend une carte inactive si `L[2] < 0.03` (~1,7°, `renderer.ts:8240`) ; `liteSun` laisse alors le décor éclairé | T6 (et S1) les gardent au Soleil rasant, volume utile allongé, casters choisis par le volume de lumière |
| C2 change le monde avec l'observateur | oui : `AIR_K` touche à la fois la transmission CPU et l'air GPU | **une atmosphère physique unique** (décision 27, remplace 18) |
| La profondeur `b` est celle du proxy d'arbre | oui (`proxyFs` ; le matériau teste la forme exacte après) | l'occlusion et le contact lisent la profondeur finale du matériau (`moments.y`) : contrat C0-9 |
| B1 sans identité de bâtiment | oui : `meshFs` écrit `vec4(d, 0, d, 3)` | une table triangle → bâtiment et les coordonnées de façade (C0-10) ; risque relevé à moyen |
| Le financement n'est pas acquis | oui : 41–47 − 4–8 = 33–43 ms ; `gpuprof` additionne des passes qui se chevauchent | gains **visés**, mesurés sur la durée totale et ses queues ; décision 31 |
| La reconstruction temporelle trop tard | — | **Q6 avant Q4** ; L4 (reflets) et L5 dans Q4, après Q6 (décision 30) |
| « Net comme le natif à 0,5–0,6 » | oui : 0,5 = ¼ des pixels, ~160 ms d'historique à 25 i/s | promesse retirée ; netteté au premier instant et après accumulation mesurées séparément |
| L4 tiré de WorldCover | oui (11 classes d'occupation, pas des matériaux) | matériaux par la sémantique : bâtiment, route, piste, classe naturelle, inconnu mat |
| L1 compterait deux fois l'orientation | oui (le SH est déjà convolué au cosinus) | plus de ½(1 + up) une fois la normale vraie utilisée |
| L6, C9, L5, C5, C7/C10, F2, F4, I6, P4, P7, P8 | — | reformulés dans leurs phases (moyenne spatiale du rebond ; C9 défini avec `wxVeil` ; L5 en étude bornée ; « météo cohérente et datée » ; composition multicouche avant le halo ; chaîne terrain → sursol → canopée → arbres ; format de la forêt ; optique optionnelle ; clé de cache complète ; P7 à mesurer ; P8 après une reprojection fiable) |
| Une politique photo dès maintenant | — | **le ré-éclairage partiel de VIPER** (`groundRelight`) en Q2, avant tout nouvel ombrage ; le dé-éclairage (L7) reste une recherche (décision 29) |
| Le temps de compilation est de la perf | oui (profils de noyaux, `skyFill`) | une règle au §6 |
| Le périmètre AAA par situation de vue | — | une table au §5 et une erreur projetée admissible (C0-12) |

Déjà réglé par les mises à jour précédentes : H5 n'est plus optionnel, T9 a été avancé, le budget n'est plus 18 ms
(décision 26).

---

## 4. Cohérence avec les systèmes existants — ce que chaque phase modifie

| Système existant | Où | Ce qui change | Phase | Garde-fou |
|---|---|---|---|---|
| L'agrandissement des tuiles | `trace.wgsl tileSample`, `earth-tiles.ts sampleLevel` | une fonction hybride pour la Terre seule (monotone aux falaises et sur relevés, B-spline ailleurs), CPU = GPU ; `monoCubic` et `moonSample` intouchés ; option : pré-filtre au décodage des tuiles Terrarium z13–14 non marquées | T1 | `tests/earth-tiles` (CPU = GPU), contact du train ; e2e `monument-relief` (les falaises gardées) |
| Le marqueur de niveau des anneaux | `terrain-raster.ts ringFs`, `terrain-raster-hint.ts terrainRasterLevelStep`, `rasterHintTol` | le vrai niveau, séparé de la tolérance du traceur | T2 | captures aux coutures ; la tolérance `RHINT_TOL` inchangée |
| Le maillage des anneaux | `terrain-raster.ts terrainVs`, `drawRing`, `RING_OVERLAP` | géomorphose CDLOD sur les 8–16 derniers nœuds, chevauchement 1 nœud ; la même dans `terrainSunVs` | T3 | `TUNE_RASTER_PATHS: 2` ; images au chargement |
| Les cuissons du cache | `terrain-cache.ts encode`, `renderer.ts` (révision) | révision par niveau (empreinte et fenêtre), voisins cuits ensemble, fondu de 0,2–0,3 s | T4 | compteur `builds` en vol ; `rasterRingsInfo` |
| La normale du raster | `rasterNormal`, `earthSlopeFine`, la cible de visibilité (`TERRAIN_RASTER_FORMAT`) | normales lisses par nœud, de la surface géomorphosée, dans le canal `a` de la cible `rgba32uint` (C0-2) ; le détail des tuiles sous 2 km pour toutes les données | T5 | `tune {TUNE_LITE: 16}` ; trace-ab |
| La carte d'ombre du relief de la Terre | `terrain-raster.ts encodeSunShadow`, `renderer.ts` (`SUN_HALF_M`, la table `TABLE_SUN`), `liteSun` | des cascades en cache (relief, puis décor en Q4), les ombres de contact, la couverture explicite | T6 | `TUNE_LITE: 4` (avant/après) ; e2e au couchant en montagne |
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
| L'horizon de la Terre | `horizon.wgsl` (API générique), `liteSun`, `earthTerrainShadow`, l'occlusion de Q4 | sur les niveaux 3–6 du cache, 8 directions | H5 | e2e Alpes au couchant ; vallées |
| Les budgets des noyaux | `scripts/lib/kernel-profiles.ts`, `tests/kernel-budget.json` | + l'entrée `moon shadeLite` ; les budgets relevés sur mesure, jamais d'avance | M0b, chaque phase | `KB_WRITE=1` après la compilation mesurée sous D3D12 (kerr-pc, `d3d12-ab`) |
| Les qualités par appareil | `tier.ts` | la résolution des cartes d'horizon selon `tier.level` (≤ 1 : 1024 ; 2 : 2048 ; 3 : 4096 si M0b/H4 le permettent) | H1 | e2e iPad (`docs/IPAD-TESTS.md`) |
| Les réglages | `settings.ts` | `horizonMaps` (pref, allumé), à côté de `refraction` ; plus tard le profil de mirage forcé (R6a) | H2, R6a | `set_settings` |
| TARS | `ai/game-tools.ts`, `sky-now.ts` | « sky » : la pression, le modèle, le Soleil d'éclairage ; l'état des cartes d'horizon | H4, R1, R3 | `tests/tars-tools` |
| L'API d'automatisation | `automation.ts`, `docs/BH-API.md` | `hdMap.mode`, `horizon` (`body`, `ready`, `bytes`, `bakeMs`), l'état d'air ; pour la Terre : les cuissons par niveau, la validité des tuiles | H1, H1b, R1, T4, T8 | `bun scripts/bh-api.ts` |
| Les vues de mesure | `tests/e2e/lib/planet-views.ts`, e2e de vol bas | les vues de M0a et M0b (§7) | M0a, M0b | `scripts/ab-commit.ts` (A B B A) |
| Le dessin du relief et du décor | `terrain-raster.ts` (blocs cullés), `scenery-raster.ts` (bâtiments cullés, arbres par blocs), la cible de visibilité (rg32 + l'attache de T5), le masque du cockpit en profondeur | Q1 | trace-ab ±1 % ; passe de visibilité mesurée |
| Le gouverneur et la netteté | `main.ts` (l'échelle en raster), `renderer.ts adaptRasterRate`, `display.wgsl` (RCAS après l'agrandissement), `post.wgsl` (copies → ping-pong) | Q1, Q6 | netteté vol = arrêt (mesure) ; cadence tenue |
| La lumière du sol | `shadeLite`, `liteSun`, `liteSky`, `skyIrradiance` (avec la normale), un module de matériaux (classe → rugosité, F0), BRDF de végétation | Q2 | captures à 3 Soleils ; ≤ +0,3 ms |
| Les bâtiments et les routes en raster | `packScenery` (table triangle → bâtiment), `meshFs`/`boxSolidVs` (l'identité), `buildingLook` allégé dans `shadeLite`, `scenerySurface` allégé ou passe de décalques | Q3 | Paris jour/nuit ; ≤ +0,5 ms en ville |
| L'occlusion, les ombres lointaines, les reflets, le vent, la canopée | GTAO (post) sur la profondeur finale, H5 à 8 directions, GGX sur les matériaux connus, `scenery-raster` cascades, `forest.ts` = `forest.wgsl` (vent), couche de canopée cuite avec le relief, la table aérienne (rayons du relief) | Q4 | captures ; ≤ +2,5 ms |
| L'air et les nuages | `earthAir` (tables de Hillaire dans `bodies`), `earth-air.ts` (`AIR_K` à 1 partout), `setAir` (aérosols), une carte des nuages ±250 km dans `bodies`, `wxCloud`/`cloudVolume`, la carte d'ombre des nuages | Q5 | M0b contre photos réelles ; nuages −1 à −3 ms |
| L'image | `post.wgsl` (TSR, vecteurs, exposition locale), `display.wgsl` (optique) | Q6 | netteté en déplacement mesurée au premier instant et après accumulation |
| Les photos et le sol de près | un compute de dé-éclairage à l'arrivée des tuiles (T9), un atlas de matériaux `texture_2d_array`, la neige et les saisons dans `shadeLite`, de nouvelles `NationalSource` | Q7 | §9 de l'analyse (go/no-go chiffré) |
| Le monde habité | lampadaires et trafic tirés d'OSM (worker du décor), lignes HT, éoliennes, vignes ; atlas de façades ; imposteurs | Q8 | au budget |
| Les docs | `PLAN-CIEL.md` (C3), `PLAN-PLANETES-AAA.md` (P8, P10), `WEBGPU-MATERIELS.md`, `E2E-CATALOGUE.md`, `PERFORMANCE.md`, `AAA-PROGRESS.md`, `ANALYSE-TERRE-RASTER-*`, `ANALYSE-TERRE-UNREAL-*`, `TERRE-UNREAL.md` (U3, U4, U10 soldés par Q1, Q4, Q6) | à jour à chaque phase, FR + EN | toutes | — |

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
  sur la Terre, le filtrage de la cascade qui couvre, fondue avec la suivante.
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
- **La lumière d'Unreal** (Q2, Q4, Q7) :
  - aucune surface ne reçoit tout le ciel sans occlusion ; aucune double ombre (photo + temps réel) ;
  - le Soleil se reflète là où il le fait vraiment (routes, toits de zinc, vitres, serres, sol mouillé, eau) ;
  - la végétation a son point chaud et son contre-jour ;
  - la nuit est noire sans Lune, argentée sous la pleine Lune, et les rues sont éclairées par leurs lampadaires.
- **L'image** (Q1, Q6) : la même netteté à l'arrêt et en vol ; aucun fantôme sur ce qui bouge ; une cadence régulière.
- **Le monde vit** (Q4, Q8) : le vent dans les arbres, le trafic sur les routes, les éoliennes qui tournent.
- **Le même monde pour tout observateur** : un point physique reçoit le même éclairage quelle que soit l'altitude de la
  caméra ; aucun anneau de sol autour des proxies, aucune occlusion par une forme invisible.
- **Le périmètre AAA par situation de vue** (challenge Unreal §15) :

  | Situation | Ce qui fait la crédibilité | Ce qui reste économe |
  |---|---|---|
  | À pied, roulage | matériaux métriques, contacts, façades, raccord piste/terrain, couvert bas | atmosphère lointaine, décor sous-pixel |
  | Vol bas | stabilité des routes et des toits, forêts, parallaxe, chargement, ombres | microdétail et animation hors de portée |
  | Croisière | masses, nuages, canopée, silhouettes des villes, perspective aérienne | objets devenus trop petits |
  | Haute altitude, orbite | limbe physique, nuages, terminateur, lumières du globe | matériaux de proximité |
  | Nuit, couchant, couvert | rapports lumineux justes, émissions, lisibilité | effets de caméra qui masqueraient une erreur |

- **Valider comme il faut** (challenge §8.2–8.3) :
  - par **régions** (silhouette, pénombre, Soleil, côte, coutures, terrain non concerné : déplacement de contour, fuite de
    lumière, faux ombrage, scintillement), pas par un pourcentage global de pixels changés ;
  - en **séquences en mouvement** (vol, recentrages, arrivées de tuiles, changements de météo et de corps), pas seulement
    sur des vues convergées ; le taux d'ombrage et la résolution effective publiés ;
  - les références réelles **recalées** (libration, latitude solaire, perspective, résolution, exposition) avant de
    comparer.
- **Pas de régression ailleurs** :
  - la Terre, les géantes et les vues sans corps HD restent à ±1 % en trace-ab, sauf les gains voulus ;
  - les e2e existants restent verts (`refraction-wgs84`, `moon-telescope`, `airless-ground`, `moons-ground`,
    `moon-tiles`, `eclipses`, `planet-detail`, `monument-relief`, `ign-relief`, `raster-fine-relief`, `hlod-cost`,
    `lowflight-governor`, `ortho`, `zones`, `miller-sea`).

## 6. Noyaux et performance

- **L'état** (31 octobre au soir, à relire en M0b) :
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
  4. **La compilation est de la performance** (challenge Unreal §13) : toute nouvelle BRDF, branche, table ou variante
     est jugée aussi sur la taille de la source composée, le nombre de pipelines, la première image et le temps
     d'activation ; les paliers du gouverneur réutilisent des pipelines prêts.
  5. **Le profilage** : `gpuprof` additionne des passes qui peuvent se chevaucher ; les décisions se prennent sur la durée
     totale d'image, le CPU, l'attente GPU et la présentation, avec leurs queues de distribution.
  6. **Le budget de temps** :
     - les planètes : jamais plus lentes que la Terre dans la même vue (P10) ;
     - la Terre : **jamais plus lente qu'avant le plan** sur les vues de M0a/M0b, sauf T6 (≤ 0,5 ms pour des ombres qui
       manquaient) et ce que Sam accepte au vu des images.
- **Le budget des textures** (Q) — le palier de 29 est le plafond à tenir :
  - les tables de Q5 (Hillaire) et la carte des nuages de C5 vont dans le buffer `bodies`, **pas** dans des textures ;
  - L8 (matériaux de détail) et B2 (façades, toits) partagent **un seul** atlas `texture_2d_array` ;
  - T9 ajoute la texture d'imagerie ; H ses deux cartes ;
  - le GTAO, l'exposition locale et le TSR sont dans le post, pas dans le traceur ;
  - T5 n'en ajoute pas (la normale dans la cible de visibilité, C0-2) ;
  - le palier complet actuel est à 27 (`TREE_SHADOW_TEXTURE_LIMIT`) : avec T9 (+1), l'atlas (+1) et H (+2), le palier
    complet passe à **31** (Mac 48, iPad Pro 44 : tenus). Sous 31, les talons tombent dans l'ordre : l'atlas (pas de
    matériaux de détail), puis les cartes d'horizon ; rien ne casse. Le décompte se fait sur les layouts réels par
    stage (C0), pas sur les numéros de liaison.
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
  | Q1 | passes de rendu et post (pas le traceur) ; `rasterLiteTakes` si le masque du cockpit passe en profondeur | presque aucune ; la passe de visibilité mesurée |
  | Q2, Q3 | `shadeLite`, `shadeWater`, `liteSun`, `liteSky`, `buildingLook` allégé, `scenerySurface` allégé | `earth-raster shadeLite`, `shadeWater` |
  | Q4 | `shadeLite` (occlusion, contact), la table aérienne, `forestCandidate` (vent) | `earth-raster shadeLite`, `shade`, `main`, `env` |
  | Q5 | `earthAir`, `cloudVolume`, `wxCloud`, `clouds`, `skyAmbient` | tous les `earth-*`, `general` |
  | Q7 | `shadeLite` (neige, saisons, atlas), compute de dé-éclairage (à part) | `earth-raster shadeLite` |
  | Q9 | `shadeLite` découpé par tuiles, f16 | `earth-raster shadeLite`, post |

- **Le protocole de mesure** :
  - `scripts/ab-commit.ts <rev>` avec `planets-ab` (A B B A, deux tours) pour les planètes ; `scripts/trace-ab.ts` et les
    e2e de vol bas (`lowflight-governor`, `AB_CMD`) pour la Terre ;
  - sur des vues figées, machine froide (l'outil thermique d'abord), onglets du panneau fermés, A/A ±1 % ;
  - en raster, vue cockpit, captures journalisées (pas d'images tracées hors ligne) ;
  - les e2e partagés entre ce Mac et kerr-mini ; une e2e IGN à la fois ; le mini ne se compare qu'à lui-même.

---

## 7. Le plan

Trois volets, une séance de mesure commune. L'ordre est au §8.

### M0a, C0, M0b — mesurer, écrire les contrats, mesurer en détail

| Phase | Contenu | Fichiers | Fait quand |
|---|---|---|---|
| **M0a** | **L'état de départ, avant toute modification** (challenge §7.4) : les vues de M0b prises sur `main` tel qu'il est — temps GPU par passe, intervalles d'image (médiane et queues), résolution effective et taux d'ombrage, mémoire de pic, chargement froid et chaud ; le coût cumulé du plan se mesure contre elle | `docs/progress/refraction-horizons/M0a.md` | Référence enregistrée et rejouable (`ab-commit`) |
| **C0** | **Les contrats, écrits avant de coder** (challenge §3, §11) : **(1) la surface** — la hauteur d'un niveau = ses triangles réels (barycentrique, diagonale fixée), cible de la géomorphose, la même pour la visibilité et les cascades d'ombre ; les **générations** du cache publiées pour tous les niveaux touchés ; **(2) la cible de visibilité** `rgba32uint`, 16 o/px comme aujourd'hui — r distance du sol, g identifiant (arbre, bâtiment pour B1), b distance la plus proche, a marqueur 8 bits + normale octaédrique 2 × 12 bits —, chaque passe gardant son masque d'écriture ; **(3) la projection optique** de R4 — `projectApparent` et son inverse, distances physique, apparente, optique nommées ; matériau, eau, SSR, ombres, nuages, étoiles, reprojection temporelle et objets mobiles sur le même point physique ; **(4) le stockage des tuiles** (T8–T10) — atlas par niveau, marges recopiées à chaque mip, mips limitées, validité par tuile en paires de `u32`, clés source + génération, réponses tardives ignorées, voisinage 4 × 4 de la cubique valide ; **(5) les deux Soleils** (géométrique, incident local) ; **(6) l'horizon** — `D_cuisson`, portée dérivée des données, estimation visuelle et marge de décision, distance par direction oui ou non ; **(7) les budgets de précision en pixels** par mode (grand angle, télé au champ minimal, photo, prédiction) ; **(8) les budgets absolus** par appareil et la mémoire de pic (décision 26) ; **(9) la profondeur de chaque consommateur** — l'image, la reprojection, l'occlusion et le contact lisent la profondeur finale du matériau (`moments.y`), pas celle du proxy d'arbre (`b`) ; **(10) l'identité des bâtiments** dans le maillage (table triangle → bâtiment, coordonnées de façade pour `buildingLook`) ; **(11) la politique photo** — le ré-éclairage partiel par source (`groundRelight`, confiance par source), ce qu'on garde de la lumière de la photo et où ; **(12) l'erreur projetée admissible** par situation de vue (§5) ; **(13) le budget de compilation** (source, pipelines, première image) | `docs/progress/refraction-horizons/C0.md` | Chaque contrat écrit avec ses tests d'acceptation ; relu par Sam |
| **M0b** | **Les références détaillées** (ex-H0 + R0 + la Terre), après T1, T2 et Q1 : l'entrée `moon shadeLite` ajoutée aux profils et son budget mesuré ; relire `origin/master` d'Alex. **Vues** : Mercure ciné Soleil 15°, Lune au terminateur depuis 500 km, Lune au télescope depuis la Terre au premier quartier, Mars au sol au couchant, Cérès ciné, pôle sud lunaire, Europe ciné ; Biarritz 21/06/2026 (Soleil à 0,5° et 2° au télé, la définition de l'aplatissement fixée) ; coucher depuis l'ISS (équateur et > 70° N) ; Lune éclipsée du 07/09/2025 (Danjon) ; les Andes au couchant ; La Hague ; **la Terre raster** : Chamonix bas Soleil bas (relief, coutures, ombres), une pente douce hors d'Europe (SRTM seul), une côte vue de 2 à 10 km, une suite image par image pendant l'arrivée d'un niveau de tuiles, un vol scripté de 2 min (le journal des tuiles, les cuissons). **Mesures** : chaque vue A/A ±1 % ; la part des ombres après P1-2 dans Mercure, Cérès et Europe ciné (`liteSkip` 4 et 8192) ; le taux de déclenchement possible de H3a ; le coût de la cuisson du cache en vol. **Décisions** : S_max par corps (si une borne est prouvable), `reliefAt`, le rayon et la résolution des calottes (78°, 256 × 256 par défaut) | `docs/progress/refraction-horizons/M0b.md`, `kernel-profiles.ts`, `kernel-budget.json`, `planet-views.ts` | Mesures et décisions écrites |

### T — La Terre raster

| Phase | Contenu | Fichiers | Fait quand |
|---|---|---|---|
| **T1** | **Les escaliers** : une fonction d'agrandissement hybride pour la Terre seule — la pente au nœud `mix(m_CatmullRom ou B-spline, m_FritschButland, s)`, `s` montant avec la raideur du texel (\|d\|/texel > ~0,5) ou la marque de relevé (`tileFine`) ; CPU = GPU (`sampleLevel`). **La fonction seule d'abord** (décision 12) ; le pré-filtre au décodage des tuiles Terrarium z13–14 non marquées (3 × 3, ou tramage ±0,5 m puis flou) n'est envisagé que si les captures de T1 montrent encore des marches hors d'Europe, et Sam décide alors. `monoCubic` et `moonSample` intouchés | `trace.wgsl tileSample`, `earth-tiles.ts`, `tests/earth-tiles.test.ts` | Pente douce SRTM au Soleil rasant sans marche ; Monument Valley garde ses falaises (`monument-relief`) ; le contact CPU = GPU ; budgets `earth-*` dans leur marge (sinon relevés en séance D3D12) |
| **T2** | **Le marqueur des coutures** : le vrai niveau du maillage dans la cible, séparé de la tolérance du traceur (`rasterHintTol` inchangée) ; `rasterNormal` voit les 6 coutures | `terrain-raster.ts`, `terrain-raster-hint.ts`, `renderer.terrainRings` | Plus de ligne de fausse pente aux coutures de 76 m, 153 m, 611 m, 2,4 km ; trace-ab 0 |
| **T3** | **La géomorphose** (contrat C0-1) : sur les 8–16 derniers nœuds avant le bord de sa fenêtre, chaque sommet glisse vers la surface **triangulée** du niveau suivant — interpolation barycentrique dans son vrai triangle, même diagonale ; pas le bilinéaire, qui en diffère de (h00 + h11 − h10 − h01)/4 au centre d'une cellule, justement dans les vallées et sur les crêtes ; rapports de grille 2 et 4 (1 ou 3 sommets intermédiaires par arête), les coins, les phases des fenêtres, un niveau indisponible ; les positions 3D comparées, pas seulement les altitudes ; chevauchement ramené à 1 nœud **après** cette garantie ; la même surface dans les cascades d'ombre | `terrain-raster.ts`, `renderer.ts` | Erreur de couture projetée ≤ 0,25 px dans les vues de livraison, recentrages et arrivées de sources compris ; plus aucun triangle qui perce ; la passe de visibilité au même coût (±2 %) |
| **T4** | **Les cuissons cohérentes** (contrat C0-1) : une **génération** par état de sources ; les niveaux touchés (empreinte zf ± 1, fenêtre recoupée) préparés en arrière-plan et **publiés ensemble** ; le fondu de 0,2–0,3 s part de l'état affiché, sur le domaine géographique commun (l'ancien échantillon reprojeté après un recentrage), les mises à jour coalescées ; le contact apparent des arbres, des pistes et des bâtiments gardé pendant le fondu ; l'historique temporel rejeté localement là où la surface a bougé ; `earthDetail` hors des niveaux ≥ 3 si M0b montre qu'il coûte | `terrain-cache.ts`, `terrain-raster.ts`, `renderer.ts` | Cuissons par seconde en vol bas divisées (mesuré) ; aucun saut de forme ni pied flottant au chargement ; le coût de la cuisson en baisse |
| **T5** | **Les normales lisses** : par nœud, de la surface **géomorphosée** (la dérivée du poids de morphose comprise, l'erreur bornée dans la bande), interpolées, écrites dans le canal `a` de la cible `rgba32uint` (C0-2 : octaèdre 2 × 12 bits, ~0,1°) — ni nouvelle texture, ni `rg16snorm` (fonctionnalité WebGPU non demandée) ; `shadeLite` et `shadeWater` les lisent à la place de `rasterNormal` ; le détail des tuiles (`earthSlopeFine` généralisé à toutes les données) sous 2 km, fondu vers la normale du nœud ; la normale géométrique (biais d'ombre) et celle du matériau (éclairage) gardées distinctes. Les silhouettes restent celles du maillage : T5 corrige l'éclairage, pas la géométrie | `terrain-raster.ts`, `scenery-raster.ts` (masques d'écriture), `trace.wgsl`, `terrain-raster-hint.ts` | Plus de facettes (`TUNE_LITE: 16` comme référence) ; trace-ab ±1 % ; 0 o/px de plus |
| **T6** | **Les ombres solaires en cascades** (avec R3 ; décision 23) : un système **unique** pour le relief (ici) et le décor (S1, en Q4) — cascade 0 ±1,5 km (~1,5 m le texel : la portée de biais tombe à ~30 m au Soleil rasant, contre ~390 m avec une seule carte), cascade 1 ±10 km, chacune en cache (redessinée quand le Soleil tourne ou qu'elle bouge) ; les anneaux du relief dessinés avec leur surface géomorphosée (jamais le relèvement de R4b) ; **les ombres de contact** (8–16 pas en espace écran le long du Soleil) pour les derniers mètres ; une **couverture explicite** (fenêtres carrées, décentrées, partielles) avec un état « inconnu », où la carte d'horizon (H5) répond quand elle existe ; `liteSun` lit la cascade la plus fine qui couvre, fondue avec la suivante ; les pixels tracés reprennent leur marche à la vraie sortie ; **au Soleil rasant**, les cascades restent actives (aujourd'hui `treeShadowFrame` coupe les ombres du décor sous ~1,7°), leur volume allongé le long du Soleil, les casters choisis par le volume de lumière, pas par le tronc de la caméra ; la clé de cache complète (hauteurs et génération, géomorphose, couverture, Soleil incident, repère stable au rebase) — ex-P4 | `terrain-raster.ts`, `renderer.ts` (`encodeSunShadow`, `TABLE_SUN`, `treeShadowFrame`), `terrain-raster-hint.ts`, `trace.wgsl liteSun` | Scène de test (talus proche, crête dans la carte, chaîne au-delà) : aucun intervalle laissé éclairé ; Chamonix au Soleil bas : les crêtes ombrent la vallée ; ni acné ni liseré ; ≤ 0,5 ms |
| **T7** | **La mer** : une **hiérarchie des sources d'eau** (OSM > WorldCover classe 80 > relief des tuiles > masque global), chacune avec ses états « absent », « non chargé », « eau », et une couverture sous-pixel — pas de bande semi-transparente ; la mer sur le géoïde, les lacs à leur niveau ; `hG` lu dans les tuiles (`earthH(gq, foot, true)`) ; les vagues filtrées anisotropes en transportant ensemble pente moyenne, moments LEAN, déplacement, Jacobien et écume (dans `shadeWater` et dans `main`, sans le `/√FOOT`), à défaut le LOD sur l'axe long ; la répétition de 1 024 m cassée par un **déphasage** compatible avec le spectre et le vent (une rotation tournerait le vent) ; le SSR fondu de 2 à 6 km vers un reflet de repli de même énergie ; `inlandWater` avec la rugosité non résolue | `trace.wgsl`, `renderer.ts` (sampler) | Côtes nettes contre l'orthophoto, Camargue et polders en terre, aucun saut quand une source arrive ; plus de moiré au couchant ; pas de motif de 2 à 20 km ; le reflet solaire continu en largeur et en énergie ; < 0,1 ms |
| **T8** | **Le chargement** (avec T9 et T10 : une seule architecture, contrat C0-4) : une priorité qui tient compte de l'aire visible, de l'erreur projetée, du mouvement, du coût et de l'ancienneté, et protège les niveaux grossiers de la famine ; des limites séparées sur les requêtes, les décodages et les octets envoyés au GPU par image ; deux files (l'IGN derrière son portillon sans tenir de créneau ; Terrarium et EOX, leur parallélisme **mesuré**, pas figé) ; la validité par tuile (paires de `u32`) et celle du voisinage 4 × 4 de la cubique ; le repli sur la carte globale marqué comme tel (sa provenance et son erreur), plus compté comme une tuile chargée ; les orthos en cache LRU et en anneau préchargé, `ORTHO_SPAN = 8` pour z15–16 ; le décodage en worker ; plus de réécriture des hauteurs à l'arrivée de l'imagerie | `earth-tiles.ts`, un worker de décodage, `trace.wgsl` (le masque dans `earthH`, `earthImagery`) | Le temps jusqu'à une qualité visible définie, divisé par 2 à 5 sur le vol scripté de M0b (cache froid, chaud, réseau dégradé) ; aucune longue tâche (> 50 ms) du fil principal due aux tuiles ; e2e `zones`, `ortho`, `ign-relief` verts |
| **T9** | **L'imagerie filtrée** (contrat C0-4) : les hauteurs en r32float, l'imagerie (tuiles et orthos) dans un atlas `rgba8unorm-srgb` par niveau, **des marges recopiées des voisines à chaque mip**, des mips limitées (jusqu'à ~16 px), un niveau de tuile plus grossier au-delà — **ou**, si le fondu de bord des fenêtres couvre l'empreinte des mips lues, l'option de VIPER (B1) : une couche par fenêtre en adressage `repeat` (l'enroulement du tore gratuit), mips par `mipgen` à l'arrivée, l'absence en alpha 0 filtrée en prémultiplié (la couverture devient le poids de mélange entre niveaux), les orthos sorties de leurs quarts — tranché en C0-4 ; lue par `textureSampleGrad` et un sampler `maxAnisotropy: 16` (un plafond, pas une garantie selon l'appareil) ; une tuile ne publie sa validité qu'avec ses mips et ses marges (jamais les couleurs de l'occupant précédent) ; le canal des lumières nocturnes gardé ; le décompte des textures (§6) | `earth-tiles.ts`, `trace.wgsl` (`earthImageryAniso`, `earthImagery`, `tileTexel`, `orthoImage`), `renderer.ts` (layout), `mips.wgsl` | Sol net et stable au loin (captures rasantes à 1–3 km, en séquence) ; continuité aux bords des tuiles, du tore et des quarts ; le matériau plus rapide (mesuré) ; la source composée valide autour du palier réel |
| **T10** | **La mémoire des tuiles** (dans l'architecture C0-4) : les niveaux à 4 tuiles (z6–10, z15–17) rangés par quarts de couche ; la texture de `veryFar` de 436 à ~235 Mo ; un budget **de pic** (ancienne et nouvelle texture coexistent le temps du travail soumis) en plus du budget résident | `earth-tiles.ts` (`makeTexture`, `params`, `put`), `trace.wgsl tileTexel` | `stats` : ~200 Mo de moins au repos ; le pic mesuré ; images identiques ; e2e iPad |

### H — Les cartes d'horizon

| Phase | Contenu | Fichiers | Fait quand |
|---|---|---|---|
| **H3a** | **La sortie par la pente, seulement avec une borne prouvée** (challenge §5.6) : une borne prudente de toutes les composantes dessinées — le DEM, les tuiles fines, les cratères et le sol procéduraux de `reliefBase`, l'overshoot des reconstructions — avec marge (les rochers ont leur propre ombre, `rockLight`) ; son taux de déclenchement mesuré en M0b. Si la borne est trop haute pour servir, ou improuvable : **H3a abandonné** (pas une approximation à risque) | `trace.wgsl nearShadow`, `renderer.ts` (S_max dans `P`), `hd-maps.ts` | A/B au Soleil haut plus rapide **et** images identiques hors bruit sur toutes les vues (la règle est exacte ou elle n'est pas livrée) |
| **H1** | **La cuisson GPU, API générique — un pilote d'abord** (la Lune) : `src/system/horizon-maps.ts` + `src/shaders/horizon.wgsl`. Entrée : une grille de hauteurs quelconque (treillis, pas, rayon, courbure) — `hdRelief` (G) pour les corps, le cache de la Terre pour H5. Par texel, 8 secteurs × 3 rayons, de `D_cuisson` (2 texels) à une portée dérivée des données, au pas ×1,25, courbure exacte, depuis le haut du texel (§2.5) ; sortie : `texture_2d_array` rgba8unorm de 2 couches en racine signée, mips moyennées pour le rendu seulement. **Les calottes polaires** : au-delà de 78°, stéréographique 256 × 256, 16 secteurs, 4 couches par calotte. Cuisson **ordonnancée selon le temps disponible**, annulée si le corps n'est plus regardé ; le temps jusqu'à une carte utilisable mesuré. **Unitaires** : la sphère nue → l'horizon à −D/2R (convention écrite) ; un bloc de 8 km à la bonne élévation ; un pic étroit entre deux rayons ; un azimut solaire qui traverse une frontière de secteur ; la hauteur du récepteur qui change et le bloqueur dominant avec elle ; la cuisson contre la référence au pas d'un texel ; l'encodage aller-retour ; la calotte (un bloc vu pareil par la calotte et par la carte à 79°, un pic vu dans les 16 directions au pôle exact, aucun NaN) ; une grille lat/lon locale (celle du cache de la Terre) | `horizon-maps.ts`, `horizon.wgsl`, `hd-maps.ts`, `tracer-source.ts`, `renderer.ts`, `tests/horizon-maps.test.ts` | Le pilote mesuré (erreurs de faux éclairage et de fausse ombre séparées, coût) → **porte de décision** (H4 dès le pilote) ; puis Mars, Mercure, Cérès |
| **H1b** | **Le corps HD selon ce qu'on regarde** (après T10), **en mode rendu seul** : le relief du corps regardé ne touche pas `groundHeights` (le sol physique du CPU reste celui du corps proche ou épinglé — `requestHd` le change aujourd'hui) ; priorité `pin` > le corps proche (`dN < hdAt`) > **le corps regardé** (le plus grand à l'écran au-delà de **`reliefAt`**), avec une hystérésis temporelle et angulaire ; le relief seul (DEM, horizons, calottes, couleur de repli 1 × 1, drapeau dans `P.hd2.z` lu par `planetMapAt`) publié **atomiquement** (corps, DEM, horizons, calottes, mode, génération), les cuissons inutiles annulées, la perte de device traitée ; libéré à 2 × le seuil | `renderer.ts` (`requestHd`/`releaseHd`/`groundHeights`), `hd-maps.ts`, `trace.wgsl planetMapAt` | e2e `moon-telescope` étendu (relief HD et ombres du terminateur au plus serré et à ~2° de champ ; mémoire de pic et à-coups mesurés ; le sol du CPU inchangé ; aucune erreur GPU) |
| **H1c** *(décision 25)* | **Shackleton en données régionales** (challenge §5.7) : les DEM LOLA des sites du pôle sud (NASA/GSFC PGDA, 5–20 m) en niveaux de tuiles de la Lune (`moon-tiles.ts`) et dans la calotte sud ; la comparaison aux cartes d'éclairement LOLA (60–240 m) à même échelle, même repère et même hauteur de récepteur ; la permanence d'une ombre jugée sur une période longue, pas sur un jour | `moon-tiles.ts`, `horizon-maps.ts`, un script de préparation (format et taille sous la limite de 8 Mo du CI, ou servis à part) | Le rebord éclairé, le fond jamais, contre LOLA à même échelle ; sinon la promesse limitée à la grande échelle et documentée |
| **H2** | **Les disques lointains** : `horizonSeen(q, Ls, sunR, foot)` (2 lectures, azimut interpolé, smoothstep sur le rayon du Soleil, mip selon l'empreinte) dans `ourSegment`, passé par `rs0` ; pour Mars, dans `otherGround`. Pas de bit. Réglage `horizonMaps` | `trace.wgsl`, `renderer.ts`, `settings.ts` | Captures du terminateur contre une photo réelle à la même colongitude ; le pôle sud lunaire vu d'orbite ; trace-ab : la Terre et les vues sans corps HD inchangées (±1 %) ; budgets remesurés |
| **H3** | *(première partie faite — [H3.md](progress/refraction-horizons/H3.md) : la carte lue, la marche gardée ; reste le gain de coût et Mars)* **Le corps proche** (après P1-2 et le challenge) : `nearShadow` = (1) carte d'horizon au-dessus du Soleil **plus la marge** (§2.4) → 0 ; (2) H3a si sa borne est prouvée ; (3) sinon la marche ≤ 32 m, la carte du Soleil jusqu'à sa sortie, une marche courte jusqu'à `D_cuisson` si la sortie tombe avant, puis la carte d'horizon au-delà — **la marche reprise n'est retirée que là où son remplacement est démontré** ; le min des parties. Mars : la carte au-delà de `D_cuisson`, et au-delà des 25 km de `REL_SH` dans `otherGround` (H2). `keyRelief` sans carte | `trace.wgsl nearShadow`, `shadeNear`, `bodyLite*` | Mercure ciné ≤ la Terre ; Cérès ciné mesuré ; le pôle sud (avec H1c) ; aucune erreur dans les domaines déclarés sûrs ; ailleurs, l'écart mesuré par régions (pénombre, silhouette) |
| **H4** | **Mesures et doc** : A/B sur les vues de M0b ; e2e en raster, vue cockpit, captures ; la planche avant/après (et contre la photo réelle) ; la décision sur la pleine résolution et sur la distance par direction ; TARS ; docs FR + EN | `docs/progress/refraction-horizons/H4.md`, AAA-PROGRESS, `E2E-CATALOGUE.md`, `WEBGPU-MATERIELS.md`, `BH-API.md` | Tableau des coûts, planche, poussé |
| **H5** *(dans le plan — décision 17)* | *(première partie faite — [H5.md](progress/refraction-horizons/H5.md) : niveaux 4–6 — le 3, ±4,9 km, sous les cascades —, cuits du cache, lus par `liteSun` et `earthGround` ; reste la justesse contre la marche tracée, le coût de lecture, Q4)* **L'horizon de la Terre, 8 directions** : sur les niveaux 3 à 6 du cache (4 × 257² nœuds, jusqu'à ±312 km), l'élévation de l'horizon dans 8 secteurs (chacun le maximum de son secteur, encodage en racine signée comme H1), cuite par l'API de H1 quand un niveau est recuit — **pas quand le Soleil tourne** ; lue par `liteSun` et `earthTerrainShadow` au-delà de la carte de T6, en min avec elle (ombres pour tout azimut), **et par Q4 (L2b) comme visibilité du ciel** (l'occlusion des vallées) | `horizon-maps.ts`, `terrain-cache.ts`, `trace.wgsl` | Les Alpes au couchant : les ombres portées à 50–150 km, sans pop au passage de la carte ; les vallées assombries sous le ciel (avec Q4) ; coût mesuré (visé < 0,2 ms et une cuisson de < 1 ms par recuisson) |

### R — La réfraction

| Phase | Contenu | Fichiers | Fait quand |
|---|---|---|---|
| **R3** *(en premier des R, avec T6 ; décision 22)* | **Deux Soleils** (challenge §6.1) : le Soleil **géométrique** reste celui du disque, des éclipses (`sunSeenPhysical`, qui le compare à la Lune physique) et de l'atmosphère ; un Soleil **incident local** — relevé de la courbure au sol sous la caméra, fondu jusqu'à ~10° — éclaire le sol et oriente les cascades d'ombre (T6), celles des nuages, des arbres et des bâtiments, passé à part (une direction de plus dans `P`), **pas** en modifiant `near.light`. Avec la courbure actuelle ; R2 la passe aux tables | `local-patch.ts`, `renderer.ts`, `trace.wgsl` (`liteSun`, `shadeLite`), `sky-now.ts` | e2e au couchant à Biarritz **et à Chamonix** (raster, vue cockpit, captures toutes les 30 s) : la fraction de Soleil visible et le flux décroissent avec cohérence jusqu'à la disparition du disque ou derrière la crête (la durée dépend du lieu et de la date) ; aucune ombre décalée ; une éclipse basse sur l'horizon inchangée ; trace-ab 0 ; TARS « sky » donne la hauteur d'éclairage |
| **R1** | **Le modèle CPU** : `src/system/refraction-layered.ts`. Le profil d'air construit **hydrostatiquement** (dP/dh = −ρg depuis une pression à une altitude de référence ; Open-Meteo donne aussi `pressure_msl`), les conversions altitude météo / MSL / géométrique / géopotentielle explicites (`us76` travaille en géopotentiel) ; l'indice par **Ciddor** (NIST) avec l'humidité ; l'écart de T de la couche limite décroissant sur ~1 km. Bouguer + Simpson sur ces couches ; les tables B_haut, B_limbe (512 périgées resserrés → 2 048 en k régulier, ou une résolution adaptative si l'erreur l'exige), l'atterrissage, le relèvement par distance, `TerrestrialK` ; dans un worker, une fois par air, les changements coalescés et publiés au même état au CPU et au GPU. `refraction.ts` les lit ; `refractDirection` **étendu** (hauteur, état d'air) de façon compatible. Le commentaire faux corrigé. `photo/plans.ts` : l'air standard pour les dates futures, l'air réel pour « maintenant ». **Unitaires** : Bennett ±3 % de 0,5° à 45° ; l'aplatissement 0,81–0,83 ; le limbe contre l'intégrale (≤ 3″ aux coudes) ; l'atterrissage ; la monotonie ; la dispersion d'Edlén contre le calcul spectral près des tangences ; leurs chiffres (66′ rasant, 5,57′ à 20 km depuis 400 km) | `refraction-layered.ts`, `refraction.ts`, `renderer.ts refractivity`, `aero.ts` (export), `openmeteo.ts`, `tests/refraction.test.ts` | Tests verts ; TARS « sky » donne les nouvelles valeurs, la pression et le modèle |
| **R2** | **Le GPU, la Terre** : `TABLE_REFR` dans `gpu-tables.ts`, écrite à chaque changement d'air. `airBend` : test de zone d'abord ; au-dessus de l'air, k par pixel dans B_limbe ; dans l'air, B_haut et 2·B_limbe − B_haut vers le bas ; le repère aplati gardé, son erreur qualifiée en latitude et en azimut (challenge §6.5). `REFR_DELTA` par le facteur d'Edlén. `shadeStars` : même principe. `earthRingLight` : B_limbe et sa dérivée pour le Newton, calibré sur une référence physique de déviation et de transmission — Danjon en contrôle, pas en seul réglage ; une table de la Terre disponible pour l'éclipse même quand la Terre n'est pas le corps proche. **La précision mesurée sur la lecture finale interpolée** (et sa dérivée), contre un oracle indépendant, dans les **budgets en pixels** de C0-7 ; les accès réellement comptés. **R3 passé aux tables** | `trace.wgsl` (`airBend`, `shadeStars`, `earthRingLight`), `renderer.ts`, `gpu-tables.ts`, `tests/gpu-tables.test.ts` | trace-ab neutre (±1 %) ; Soleil couchant 0,82 au télé (dans la définition de M0b) ; coucher de l'ISS écrasé ~1/5 en bas, posé sur le limbe à 70° N comme à l'équateur ; `refraction-wgs84` vert ; l'éclipse dans la fourchette de Danjon ; budgets en pixels tenus par mode |
| **R4** | **Le sol relevé, traceur et rasters ensemble** (après T3 et T5 ; contrat C0-3) : le relèvement (la LUT précise la hauteur de l'œil, celle du récepteur, la définition de d et le sens du rayon), **un raccord continu** au lieu du seuil dur de 0,1′. **R4a** : `earthMarch` et l'intersection d'orbite. **R4b** : `refrLift(d)` à la projection seule (`terrainVs`, jamais `terrainSunVs` ni la cuisson). **Tous les consommateurs** sur le même point physique : `rasterPoint` (le relèvement défait par le calcul depuis la distance, sans stockage), le décor et les ponts, `seaScreen`/`seaSSR`, la reprojection temporelle (`reprojDir` : point physique transformé puis reprojeté avec l'œil et l'air de l'image précédente), les nuages et les étoiles, les objets mobiles (avions, bateaux, trafic, vaisseaux) ; CPU, collisions et WGS84 intouchés | `trace.wgsl`, `post.wgsl`, `terrain-raster*.ts`, `scenery-raster.ts`, `forest-shader.ts`, `runways3d.ts`, `roof-mesh.ts`, les chemins des objets mobiles | D'orbite, plus de trou entre le Soleil réfracté et le globe ; les Alpes à 300 km relevées de ~10′ ; aucune marche au bord du dernier anneau ; aucune couture, arbre flottant, reflet décalé ni traînée temporelle ; le relèvement identique au traceur dans le budget en pixels |
| **R5** | **Vénus et Titan d'orbite** : `airBend` pour le corps proche qui a une table, avec les **réfractivités et dispersions propres** au CO₂ et au N₂/CH₄ (pas celles de l'air terrestre à même densité) ; **leur lentille** (§1.5) pour l'auréole de Vénus et l'anneau rouge de la Terre vu de la Lune éclipsée, intégrant la transmission du même trajet (gaz, aérosols, nuages) et une empreinte de pixel construite explicitement (compute : pas de `fwidth`) ; Titan sous sa brume | `trace.wgsl`, `renderer.ts`, `refraction-layered.ts` | L'arc du Soleil sur le limbe de Vénus, venu d'une couche transparente ; coût nul hors de la bande du limbe |
| **R6a-ciel** *(après T7)* | **Les mirages du ciel, profils forcés** : les profils d'air près du sol (mer chaude, inversion, conduit), illustratifs, choisis dans les réglages et par TARS ; les tables de l'œil tracées en RK4 (r, θ, e) à travers les points de retournement, dans un worker, sous ~2 km, trois couleurs ; au GPU, chaque pixel de ciel lit sa vraie direction (le Soleil en « vase étrusque », la Fata Morgana du ciel) ; l'inverse des étoiles sur la branche de l'image droite, les images secondaires des étoiles ignorées (limite assumée) ; la visée sur une branche nommée et stable | `refraction-layered.ts` (RK4), `trace.wgsl`, `settings.ts`, `ai/game-tools.ts` | Le Soleil en « vase étrusque » au télé, sur une mer sans moiré ; coût GPU nul hors de la bande de l'horizon ; tables sans à-coup |
| **R6a-terrain** | **Les mirages des objets finis** (challenge §6.8) : le « lac » d'une route chaude, la côte et les bateaux dédoublés — le trajet courbe marché dans la bande de l'horizon (état de branche, intersections du sol et du décor le long du rayon courbe, transport), pas une direction finale ; estimé et décidé séparément après R6a-ciel | `trace.wgsl` (une marche courbe dans la bande), `refraction-layered.ts` | Une route chaude à midi, un bateau dédoublé sur un profil forcé ; coût borné à la bande |
| **R6b** | **Les mirages tirés de la météo** : un profil **plausible conditionné par la météo** (T à 2 m, du sol, de la mer par l'API marine — une grille de ~8 km au pas de plusieurs heures —, niveaux 1 000/975/950/925 hPa), jamais présenté comme une observation : l'incertitude affichée dans TARS. **Une recherche d'abord** (radiosondages, mirages publiés), puis un go/no-go | `refraction-weather.ts`, `openmeteo.ts`, `ai/game-tools.ts` | Des cas documentés avec un profil mesuré quand il existe : le phénomène plausible ces jours-là, rare les jours ordinaires ; l'incertitude visible |

### Q — La qualité Unreal

Détail, constats et chiffres : [ANALYSE-TERRE-UNREAL-2026-11-02.md](ANALYSE-TERRE-UNREAL-2026-11-02.md) (les codes P, I, L,
B, F, S, A, D, C, G y renvoient). Chaque phase : A/B sur kerr-mini contre la précédente, captures en raster, vue cockpit ;
**jamais plus lent que le budget fixé à la fin de Q1**, sauf ce que Sam accepte au vu des images. Aucun gain n'est compté
avant d'être mesuré (décision 31). [PLAN-IMAGE-VIPER11.md](PLAN-IMAGE-VIPER11.md) y est fusionné : ses chantiers sont
nommés « VIPER A1… » dans les phases (son relevé de VIPER et ses sources restent dans son document).

| Phase | Contenu | Fichiers | Fait quand |
|---|---|---|---|
| **Q1** | **La perf d'abord**, sans changer l'image : **P1** les anneaux du relief en blocs de 8 × 8 nœuds cullés (bornes prudentes : géomorphose, relief renouvelé, relèvement de R4b ; le culling du Soleil distinct, par le volume de lumière) ; **P2** les bâtiments cullés par bloc (le Hi-Z ensuite, s'il paie sa construction, en Z inversé) ; **P3** le cull des arbres par blocs de 8 × 8 (bornes avec l'envergure des couronnes et le vent) ; **P5** la cible de visibilité en `rgba32uint` selon C0-2 ; **P6** plus de copies plein écran (ping-pong respectant les usages lecture/écriture), l'historique d'albédo coupé quand `rasterDetail` est éteint ; **P7** le cockpit dans la profondeur de la visibilité — une hypothèse à mesurer (le matériau saute déjà les pixels masqués) ; **P12** les petits nettoyages ; **I1** l'affûtage intégré à la reconstruction en sortie (pas le delta RCAS du texel source), budgété, sans halo ; **I4** les **paliers de réglages de VIPER** (D1 : paquets, hystérésis, temps minimal par palier, bannissements), la migration des historiques, les seuils des arbres liés à la qualité de sortie et non à l'échelle interne — l'échelle reste tenue jusqu'à Q6. La carte d'ombre du relief en cache (ex-P4) se fait dans T6, sur la carte corrigée | `terrain-raster.ts`, `scenery-raster.ts`, `renderer.ts`, `main.ts`, `quality-policy.ts`, `post.wgsl`, `display.wgsl` | Gains **mesurés** poste par poste sur la durée totale d'image et ses queues (visé −4 à −8 ms) ; images identiques (trace-ab ±1 %) sauf la netteté d'I1 ; la netteté en vol égale à celle de l'arrêt ; résolution effective et taux d'ombrage publiés |
| **Q2** | **La lumière cohérente** (après T5) : **le ré-éclairage partiel de la photo** (VIPER B2.1, décision 29) — `ndl = mix(max(μ₀, 0), max(n·L, 0), k)`, `k` croissant quand notre Soleil s'éloigne de celui de la prise de vue et quand il baisse, par source (Sentinel ~10 h 30, IGN l'été vers midi), réglage `groundRelight` atteignable par TARS — **avant** tout nouvel ombrage ; **L1** le ciel directionnel (`skyIrradiance` avec la normale lisse, sans le ½(1 + up) en plus ; ciel, sol de l'hémisphère bas et occlusion séparés) ; **L6** le rebond tiré d'une moyenne spatiale grossière de la lumière incidente et de l'albédo du sol (nommé empirique s'il le reste) ; **C9** défini avec `wxVeil` : transmission directe, lumière diffuse des nuages et visibilité du ciel séparées, sans double atténuation ; **la nuit calibrée** (unités de radiance, pré-exposition, réponse de la Lune ; plus de gains selon l'altitude de la caméra) ; les lumières des villes hors des couronnes et des murs | `trace.wgsl` (`shadeLite`, `liteSun`, `liteSky`), `renderer.ts`, `settings.ts`, `ai/game-tools.ts` | Plus de double ombre au couchant (photo + temps réel) ; un même point éclairé pareil quelle que soit l'altitude de la caméra ; captures à 3 Soleils (Paris, Chamonix, Beauce) ; ≤ +0,3 ms |
| **Q3** | **Les villes et les routes** : **B1** l'identité des bâtiments (C0-10 : table triangle → bâtiment, coordonnées de façade) écrite dans la visibilité, un `buildingLook` allégé dans `shadeLite` (murs, fenêtres, couleurs et matériaux BD TOPO / Overture, fenêtres allumées la nuit ; toits par matériau, la lumière de la photo gardée selon la politique de C0-11) ; **B3** les boîtes lointaines orientées sur le bâtiment ; **B4** les routes là où la sémantique est fiable (un `scenerySurface` allégé ou une passe de décalques) ; **A1** les objets des aérodromes du jeu en raster, après avoir vérifié lesquels manquent | `scenery-data.ts` (`packScenery`), `scenery-raster.ts`, `trace.wgsl`, `scenery-worker.ts` | Paris de jour et de nuit : façades haussmanniennes, fenêtres allumées, routes marquées ; ≤ +0,5 ms en ville ; risque moyen |
| **Q4** | **Le volume et les reflets** (après Q6) : **L2a** GTAO demi-résolution sur la **profondeur finale** (C0-9), épaisseur et rayon en mètres, bords du cockpit et du terrain traités, filtré selon le contrat temporel de Q6 ; **L2b** la visibilité du ciel tirée de H5, pondérée par le ciel directionnel (pas un scalaire), séparée du GTAO par une distance (pas de double compte) ; **S1** le décor dans les cascades de T6 (casters statiques et animés séparés) ; **L4** le spéculaire GGX sur les matériaux **connus** (C0-11 : bâtiment, route, piste, classe naturelle ; inconnu mat) — conservation de l'énergie, rugosité minimale, filtrage des normales, Soleil de taille finie, conducteurs et diélectriques distincts, le mouillé en revêtement ; reflets du ciel par `skyMirror` (approximation documentée) et le SSR là où il existe ; **L5** la BRDF de la végétation en **étude bornée** (modèle, paramètres, comportement rasant, raccord au diffus de la photo) ; **F1** le vent **proche** (amplitude bornée dans le culling, déformation précédente pour l'historique, effacé avec la taille projetée) ; **F2** la chaîne terrain nu → sursol IGN / couvert statistique → canopée → arbres (qui donne silhouette, couleur, ombre, occlusion, collision à chaque distance ; substitution progressive) ; **F4** une évolution du format de la forêt (hauteur au-delà de 33,5 m, envergure contre les bornes de la traversée, CPU = GPU) ; **C4** les rayons du relief dans la table aérienne par une lecture de visibilité **volumique** (biais et portée propres), avec jitter et historique | `post.wgsl` (GTAO), `trace.wgsl`, `scenery-raster.ts`, `forest.ts`, `forest.wgsl`, `terrain-cache.ts` | En séquences : vallées et pieds de murs assombris sans halo ; aucun anneau autour des proxies ; reflets stables (pas de points qui pétillent) ; forêts en volume jusqu'à 30 km ; ombres de la ville à 3 km ; ≤ +2,5 ms **mesurées** |
| **Q5** | **L'atmosphère et les nuages** (avec R1, R2) : **C1** les tables de Hillaire migrées par étapes — transmittance, diffusion multiple, ciel, puis raccord avec la table aérienne et `skyAmbient` existantes (remplacer, pas doubler), textures ou buffer `bodies` choisis à la mesure ; **C2** **une atmosphère physique unique** (décision 27 : `AIR_K` à 1 partout ; le rendu d'orbite par des transitions de méthode à sorties raccordées, un réglage artistique du limbe s'il le faut, jamais un air qui change avec l'observateur), réétalonnée contre M0b ; des profils distincts pour Rayleigh, la couche d'ozone, les aérosols ; **C3** les aérosols du jour (source à vérifier) ; **C5** une **météo spatialement cohérente et datée** (grille Open-Meteo multipoint, mosaïque GIBS avec son heure d'acquisition, une confiance) — les nuages individuels restent synthétiques ; **C11** la **composition multicouche** (couches ordonnées ou segments, radiance prémultipliée et transmittance, perspective aérienne par couche) ; **C6** l'auto-ombrage proche et le champ d'ombre large séparés, la carte d'ombre aux pas proportionnels avec jitter ; **C7** le cirrus lié à la météo (le halo de 22°, avec une phase de cristaux, plus tard) ; **C10** la fin du plancher de transmittance et la couverture sous-pixel en demi-résolution ; **VIPER C1** un bruit bleu spatio-temporel pour toutes les gigues ; **VIPER C2** les nuages amortis (un texel sur quatre par image, plus de pas, la vraie marche vers le Soleil) ; **VIPER C3** une passe de champ proche dans les nuages ; **VIPER C4** la gloire et l'ombre de l'avion sur les nuages ; **P8** l'amortissement de l'air et des ombres de nuages après Q6, avec une reprojection volumique et un renouvellement selon l'erreur (réveil sur éclair, météo, mouvement) ; la brume météo corrigée | `trace.wgsl`, `earth-air.ts`, `cloud-pass.ts`, `cloud-shadow.ts`, `weather.ts`, `openmeteo.ts`, `day-clouds.ts`, `gpu-tables.ts`, `post.wgsl` | L'heure bleue et le crépuscule justes ; un même point éclairé pareil quelle que soit l'altitude de l'observateur ; les nuages d'accord avec la météo datée ; les couches lointaines sous leur propre brume ; le Soleil caché derrière un cumulus épais ; nuages −1 à −3 ms |
| **Q6** | **L'image** (avant Q4 ; décision 30) : **I2** un upscaler temporel de classe TSR — l'articulation du temporel natif et du TAAU (pas de filtrages successifs), la visibilité jitterée reconstruite dans le pixel de sortie, la profondeur précédente, l'historique pondéré par la vitesse, un canal de confiance, des masques réactifs (reflets, émissions, eau) ; **I3** les transformations précédentes des objets mobiles, la déformation précédente du vent, la mer, les nuages dans leur propre historique, la reprojection sur le point physique (C0-3) ; **I5** l'exposition locale bornée (amplitude, temps d'adaptation), l'exposition globale gardée en référence ; **I6** le **profil Caméra** de VIPER (décision 32) — A1 l'étalonnage (split-tone + LUT 33³, cockpit neutre), A2 le grain, la vignette, l'aberration chromatique et les rayures de verrière, A3 l'exposition « caméra » mêlée au posemètre incident, A4 le flou de mouvement à temps de pose fixe — et un **profil Neutre** (le Labo, la science, la photo neutre) ; **I7** la cadence réglée sur la présentation ; **I8** le mode caméra « GoPro » hors cockpit (VIPER A5). Puis **I4 complet** : l'échelle n'est abaissée que si les scènes critiques le permettent | `post.wgsl`, `display.wgsl`, `renderer.ts`, `main.ts`, `terrain-raster.ts` (jitter), `settings.ts` | Netteté en déplacement mesurée au premier instant **et** après accumulation ; aucun fantôme sur la mer, les avions, les reflets ; aucune impulsion de flou aux changements de palier ; le cockpit et le paysage lisibles ensemble |
| **Q7** | **Les photos et le sol de près** (après T9 et S1) : **L7** le dé-éclairage des photos, une **recherche** (décision 29) — la méthode du §9 de l'analyse Unreal (L7a topographique, L7b ombres des orthos rendues par notre décor) et la dé-lumination par source de VIPER (B2.2, `S_photo`), une confiance par source, une étude de 2 jours avec go/no-go ; **L8** les **scans de détail de VIPER** (B3 : trois échelles, en rapport d'albédo qui conserve la couleur moyenne de la photo, avec normales, mips et apparition selon l'empreinte ; triplanaire et tuilage stochastique budgétés en lectures) ; **VIPER B4** la piste usée (dalles, joints, gomme, éclats) ; **L9** la neige et les saisons cohérentes sol–arbres–toits–pistes (masque et vieillissement, puis les observations avec leur qualité et leurs trous ; le NDVI seulement depuis un rouge et un proche infrarouge calibrés, G3) ; **G1/G2** chaque source déclarant projection, datum vertical, MNT/MNS, résolution, date, masque de validité et repli | `earth-tiles.ts`, un compute de dé-éclairage, `scenery-raster.ts`, `trace.wgsl`, `national.ts`, `scripts/earth-surface-build.py` | Plus de double ombre (go/no-go de L7) ; le sol de près net en roulage ; +0,5–1,5 ms en vol bas pour le détail, ≈ 0 en altitude |
| **Q8** | **Le monde habité et la nuit** : **VIPER B5** le couvert bas en instances (herbe, arbustes, cailloux) près des aérodromes d'abord, puis en vol rasant partout, par paliers ; **L10** des lampadaires plausibles regroupés le long des routes (pas leur position réelle), avec portée et LOD — jamais une lumière dynamique par fenêtre ; **D1** le trafic routier (phares la nuit), les lignes haute tension et leurs pylônes, les éoliennes qui tournent, les vignes et vergers ; **B2** les façades et toits PBR (l'atlas de L8) ; **F3** les imposteurs seulement si F2 ne couvre pas le besoin ; **C8** la neige qui tombe, les traînées persistantes | `scenery-worker.ts`, `scenery-raster.ts`, `trace.wgsl`, `forest.ts`, `weather.ts`, `contrails.ts`, `grass-layout.ts` | Le roulage et le vol rasant vivants ; Paris la nuit ; le trafic de l'A1 ; les lignes HT et les éoliennes vues du cockpit ; chaque élément au budget, par palier |
| **Q9** | **La perf, seconde passe** : **P9** le classement par tuiles 8 × 8 et le dispatch indirect (les pixels restent mixtes aux lisières et sur l'eau) ; **P10** shader-f16 (fonctionnalité demandée, variantes, repli) pour le post et les couleurs du matériau ; la revue du coût de compilation. Gardés seulement si l'A/B gagne | `trace.wgsl`, `renderer.ts`, `post.wgsl` | Mesurés ; gardés ou retirés |

## 8. Ordre et estimations

**Départ : dès que les géantes sont finies** (PLAN-GEANTES-VOLUME, V8 et V9 ; décision 11). Avant de lancer : relire
`git log`, les notes d'Alex sur `origin/master`, et l'état de `trace.wgsl` (les numéros de ligne de ce plan bougent).

| # | Phases | Pourquoi là |
|---:|---|---|
| 1 | **M0a** | le vrai « avant » |
| 2 | **C0** | les treize contrats écrits avant de coder |
| 3 | **T1, T2** | petites, sans coût ; T1 est une expérience bornée (décision 12) |
| 4 | **Q1** | la perf d'abord, mesurée ; les paliers du gouverneur |
| 5 | **M0b** | les références détaillées, sur l'état corrigé |
| 6 | **R3 + T6** | deux Soleils et les cascades d'ombre, Soleil rasant compris |
| 7 | **T3**, **T4**, **T5** | la Terre sans triangles, ses générations, ses normales |
| 8 | **Q2**, **Q3** | la photo ré-éclairée avec mesure, le ciel selon la pente, les villes |
| 9 | **T10**, **T9**, **T8** | une seule architecture des tuiles (C0-4), avec l'option de VIPER pour l'imagerie |
| 10 | **Q6** | la reconstruction temporelle **avant** les effets qui scintillent (décision 30) |
| 11 | **H3a** (si sa borne est prouvée) ; **H1** (pilote) → porte de décision ; **H1b** ; **H2** ; **H3** ; **H1c** ; **H5** ; **H4** | les cartes d'horizon, validées sur un pilote |
| 12 | **Q4** | le volume et les reflets, sur une image temporellement stable |
| 13 | **T7** | la mer, avant les mirages |
| 14 | **R1**, **R2**, **Q5** | le même air physique pour la réfraction et l'atmosphère |
| 15 | **R4** (R4a + R4b), **R5**, **R6a-ciel**, **R6a-terrain**, **R6b** | selon le contrat de projection de C0-3 |
| 16 | **Q9** | la seconde passe de perf |
| 17 | **Q7** | après T9 et S1 ; L7 en recherche |
| 18 | **Q8** | le monde habité, en dernier, au budget |

**Après C0 et Q1, les estimations sont refaites** sur ce qu'on aura mesuré (le challenge a raison : aucun total n'est
défendable avant un pilote).

| Phase | Effort | Risque | Gain qualité | Effet perf |
|---|---|---|---|---|
| M0a | ½ j | — | — | — |
| C0 | 2–3 j | — (c'est lui qui réduit les risques) | — | — |
| T1 | ½ j | faible (garder les falaises ; CPU = GPU) | **fort** (fin des escaliers) | 0 |
| T2 | ¼ j | faible | moyen | 0 |
| M0b | 1 j | — | — | — |
| T6 | 2–3 j (cascades, contact, couverture) | moyen | **fort** (les ombres du relief, proches comprises) | ≤ +0,5 ms |
| R3 | ½–1 j (deux Soleils) | faible à moyen | **moyen partout** au couchant | 0 |
| H3a | ¼–½ j | faible (S_max à ne pas sous-estimer) | — | ombres → ~0 au Soleil haut |
| T10 | ½–1 j | faible | — | ~200 Mo de GPU rendus |
| H1 | 2,5–3,5 j (API générique, pilote, cas de test) | moyen (cuisson, calottes, référence) | — | ~2–4 ms par image pendant ~0,5 s à l'arrivée d'un corps |
| H1b | 1,5 j (rendu seul, publication atomique) | moyen (mémoire, règle de chargement) |
| H1c | 1,5–2,5 j | moyen (données, taille) | **fort** au pôle sud | chargement | **fort** depuis la Terre | chargement unique |
| H2 | ½ j | faible | **fort** (le terminateur de loin) | ≈ 0 |
| H3 | 1 j | moyen (raccord avec la carte du Soleil) | **fort** (portée ~10 → ~200 km, le pôle sud lunaire) | gain, à mesurer (révisé à la baisse) |
| H4 | ½ j | — | — | — |
| T3 | 1,5–2 j | moyen (T, impairs, carte d'ombre) | **fort** (fin des triangles aux coutures) | ≈ 0 |
| T4 | 1,5–2 j | moyen (le fondu, la révision par niveau) | **fort** au chargement | **gain** (moins de cuissons) |
| T5 | 1–1,5 j | moyen (attache, coutures) | **fort** (fin des facettes) | ≈ 0, +4 o/px |
| T7 | 1,5 j | faible à moyen (masques, LOD) | **fort** sur les côtes | < 0,1 ms |
| R1 | 1,5–2 j (hydrostatique, Ciddor, API) | faible | moyen (prédictions, TARS) | 0 (worker) |
| R2 | 1–1,5 j | moyen (le re-réglage de l'éclipse) | moyen au télé, fort vu d'orbite | ≈ 0 avec le test de zone |
| R4 (a + b) | 3–4 j (tous les consommateurs) | **élevé** (six chemins) | moyen (le limbe d'orbite, le sol lointain au télé) | ≈ 0 |
| R5 | ½–1 j | faible | moyen, rare | 0 hors du limbe |
| R6a-ciel | 2 j | moyen | **fort et unique** | GPU ≈ 0 |
| R6a-terrain | 2–4 j | **élevé** (trajet courbe) | fort | borné à la bande |
| R6b | 2–4 j (recherche comprise) | **élevé** | fort si ça marche | 0 |
| T8 | 2,5–3,5 j | moyen (validité par tuile, worker) | **fort** à chaque arrivée | réseau ; fil principal soulagé |
| T9 | 2,5–3 j | moyen (marges à chaque mip, layout) | **fort** au loin | **gain** du matériau |
| H5 | 1,5–2 j (8 directions) | moyen | fort en montagne au couchant, et les vallées (Q4) | à mesurer |
| Q1 | 4–6 j | faible à moyen | moyen (la netteté du vol) | **−4 à −8 ms visés** |
| Q2 | 3–4 j | faible | **fort** | ≤ +0,3 ms |
| Q3 | 4–6 j (identité des bâtiments) | moyen | **fort** en ville | ≤ +0,5 ms |
| Q4 | 10–14 j (avec L4, L5) | moyen | **fort** | ≤ +2,5 ms |
| Q5 | 12–16 j (avec VIPER C1–C4, C11) | **élevé** (C2 : le réétalonnage ; C2 de VIPER : la reprojection) | **fort** | nuages −1 à −3 ms |
| Q6 | 8–11 j (avec le profil Caméra et le mode GoPro) | moyen (fantômes) | **fort** en vol | ≈ 0, l'échelle peut baisser |
| Q7 | 12–16 j (avec la piste usée) | **élevé** (L7) | **fort** | +0,5–1,5 ms en vol bas |
| Q8 | 14–20 j (avec le couvert bas) | moyen | fort (la vie) | au budget |
| Q9 | 3–5 j | moyen | — | à mesurer |

Total **estimé** ≈ 115–155 jours de travail (T, H, R ≈ 44–54 j avec C0, M0a, H1c et R6a-terrain ; Q ≈ 71–101 j avec VIPER
11) — à refaire après C0 et Q1, avec une part de recherche explicite pour L5, L7, I2 et C5.

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

Les décisions 1 à 10 datent du 31 octobre ; les décisions 11 à 36 du 2 novembre. **Le plan n'est pas lancé.**

1. **L'ordre : les cartes d'horizon d'abord** (H), **puis la réfraction** (R). *Amendé par la décision 8* : R3 passe
   avant. *Dans le plan commun* : M0a, C0, T1, T2, Q1 et M0b avant tout, T6 avec R3.
2. **R4** (le sol relevé) **et R5** (Vénus et Titan) **restent dans ce plan**. *Dans le plan commun* : R4a et R4b ensemble
   sur la Terre raster (§3.7).
3. **Les mirages : R6**, dans ce plan, après R2 : R6a (profils forcés) puis R6b (la météo, après une recherche).
4. **H1b : oui**, pour le télescope et les vues qui grossissent : le relief seul de l'astre regardé, ~70 Mo GPU pour la
   Lune ; le seuil `reliefAt` (décision 7).
5. **Résolution des cartes : la plus élevée qu'on peut se permettre.** 2048 × 1024 par défaut (~22 Mo) ; 4096 × 2048
   (~88 Mo) pour la Lune et Mars si M0b et H4 le permettent (`tier.level` 3), T10 aidant ; 1024 en repli
   (`tier.level` ≤ 1) ; les calottes polaires à 256 × 256 partout (~2,7 Mo).
6. ~~La carte d'ombre du Soleil des corps de P10 reste à faire à côté de H3.~~ **Faite** le 1er novembre (P1-2,
   `f3aa71e5`). H3 garde la marche ≤ 32 m et la carte du Soleil, et remplace la marche reprise au-delà par la carte
   d'horizon (§7).
7. **Le seuil de H1b : `reliefAt`**, propre au relief seul, ~8 × plus tôt que `hdAt` (~3° de champ pour la Lune vue de
   la Terre), sa valeur mesurée en M0b.
8. **R3 en premier** des R, avec la courbure actuelle ; R2 le passe aux tables.
9. **R6 en deux temps** : R6a, puis R6b (une recherche avec un go/no-go).
10. **Le pôle sud lunaire est une vue prioritaire** (Shackleton, Artemis) : deux calottes polaires à 16 directions
    au-delà de 78° pour chaque corps à DEM, validées contre les cartes d'éclairement de LOLA.
11. **(2 novembre) Un plan commun** : la Terre raster AAA (T), les cartes d'horizon (H) et la réfraction (R) ensemble,
    **qualité AAA et performance**. **On le commence dès que les géantes sont finies.**

**Les réponses de Sam aux questions du plan commun (2 novembre)** :

12. **T1 : la fonction hybride seule d'abord.** Le pré-filtre des tuiles SRTM au décodage n'est pas fait d'avance ; il
    ne revient que si les captures de T1 montrent encore des marches (hors d'Europe), et sur décision de Sam.
    *Précisé par le challenge (§4.1)* : T1 est une expérience à résultat conditionnel — une définition mathématique
    exacte (valeurs et dérivées, continuité aux nœuds, borne d'overshoot, rampe conservée), comparée sur plateaux
    quantifiés, falaises et données fines ; un plateau large et plat dans les données le reste. Le tramage aléatoire
    n'est pas un correctif par défaut.
13. ~~**H5 : une option, jugée après T6.**~~ *Remplacée par la décision 17* (H5 dans le plan, à 8 directions).
14. **T8 et T9 restent dans ce plan**, en fin d'ordre (§8) : le chargement et la netteté au loin font partie de la Terre
    « parfaite AAA ».
15. **R4 : R4a attend R4b.** Les deux sont livrés ensemble, jamais R4a seul (pas même limité à l'orbite).

**Sam, le 2 novembre : « fais au mieux, AAA qualité et perf, tout dans le périmètre »** — les décisions 16 à 20 sont prises
sur cette délégation :

16. **Le volet Q entre en entier** (Q1–Q9), dans l'ordre du §8. **La perf passe d'abord** : Q1 avant tout ajout de
    qualité ; à sa fin, le budget en vol sur le mini est fixé (visé ≤ 40 ms), et aucune phase suivante ne le dépasse sans
    que Sam l'accepte au vu des images. *Précisé par la décision 31 : les gains sont visés, pas acquis.*
17. **H5 est dans le plan, étendu à 8 directions** : les ombres du relief au-delà de 10 km pour tout azimut (pas de
    recuisson quand le Soleil tourne) **et** la visibilité du ciel des vallées (Q4, L2b). Un seul calcul pour deux gains.
18. ~~**C2, l'air à sa vraie épaisseur sous ~50 km d'altitude de la caméra, fondu vers ×3 au-dessus.**~~ *Remplacée par
    la décision 27* : un air qui dépend de l'altitude de la caméra change l'éclairage du monde avec l'observateur.
19. **L7, le dé-éclairage des photos : oui**, en recherche (décision 29), par la méthode du §9 de l'analyse Unreal — L7a (le relief, sûr) partout,
    L7b (les ombres des orthos) après une étude de 2 jours avec un go/no-go chiffré (halo < 1 m, bruit des zones
    relevées < 1,5 × celui des zones au soleil, plus aucune double ombre au couchant). Pas de réseau de neurones.
20. **D1, le monde habité : oui** (Q8, en dernier) : trafic, lignes HT, éoliennes, vignes et vergers, lampadaires ; chaque
    élément mesuré au budget.

**Le challenge du 2 novembre** (§3.9), intégré sur la même délégation (« fais au mieux ») :

21. **Mesurer d'abord, écrire les contrats ensuite, coder après** : M0a avant toute modification, C0 avant la première
    phase qui en dépend, M0b après T1, T2 et Q1.
22. **Deux Soleils** : le géométrique pour le disque, les éclipses et l'atmosphère ; l'incident local (réfracté au sol)
    pour l'éclairage du sol et ses cartes d'ombre. `near.light` n'est pas modifié globalement.
23. **Un seul système d'ombres solaires en cascades**, en cache, pour le relief (T6) et le décor (S1), avec les ombres de
    contact et une couverture explicite (« inconnu » → H5).
24. **La cible de visibilité reste à 16 o/px, en `rgba32uint`** : distance, identifiant, distance la plus proche,
    marqueur + normale octaédrique ; le relèvement de R4 se défait par le calcul. Ni nouvelle texture ni fonctionnalité
    WebGPU.
25. **Shackleton en données régionales** (H1c) : les DEM LOLA des sites du pôle sud ; à défaut, la promesse est limitée à
    la grande échelle et documentée.
26. **Les budgets absolus** (**confirmés par Sam le 2 novembre**) : kerr-mini (M1, écran 50 Hz) ≥ 25 i/s en vol
    (≤ 40 ms) ; M1 Max ≥ 40 i/s ; kerr-pc (RTX 5070 Ti) ≥ 60 i/s en 1440p ; iPad Pro ≥ 30 i/s ; mesurés à résolution
    effective et taux d'ombrage publiés, avec une mémoire de pic par palier. « Jamais plus lent que la Terre » reste une
    comparaison, pas un budget.

**Le challenge « Terre Unreal » et la fusion de VIPER 11** (§3.10), sur la même délégation :

27. **Une atmosphère physique unique** : `AIR_K` à 1 partout (le même air pour la diffusion, la transmission CPU et la
    réfraction) ; un point physique est éclairé pareil quelle que soit l'altitude de l'observateur. Le rendu d'orbite passe
    par des transitions de méthode à sorties raccordées ; un réglage artistique du limbe, s'il le faut, est nommé comme tel.
28. **[PLAN-IMAGE-VIPER11.md](PLAN-IMAGE-VIPER11.md) est fusionné ici** : A1–A4 → I6 (profil Caméra), A5 → I8, B1 → T9,
    B2.1 → Q2 (`groundRelight`), B2.2 → Q7 (L7), B3 → L8, B4 → Q7, B5 → Q8, C1–C4 → Q5, D1 → I4 (Q1), D2 → Q9. Son
    document reste l'analyse de VIPER (relevé, sources) ; il n'a plus d'ordre ni de devis propres.
29. **La politique photo** : dès Q2, le ré-éclairage partiel par source (`groundRelight`, avec un réglage pour comparer à la
    photo brute), **avant** tout nouvel ombrage ou reflet ; le dé-éclairage complet (L7) reste une recherche avec son
    go/no-go.
30. **La reconstruction temporelle avant les effets qui scintillent** : Q6 avant Q4 ; L4 (reflets) et L5 dans Q4 ; les
    matériaux de L4 viennent de la sémantique (bâtiment, route, piste, classe naturelle, inconnu mat), jamais d'une
    couleur ni de WorldCover seule.
31. **Aucun gain compté avant d'être mesuré** : sur la durée totale d'image, le CPU, la présentation et leurs queues ; les
    promesses de « financement » et de « netteté native à 0,5–0,6 » sont retirées.
32. **Les sept questions de VIPER 11**, tranchées : (1) un **profil Caméra** — une LUT « footage » ajustée sur des vidéos de
    référence publiques (cockpit en GoPro, vol de ligne), discrète, par défaut dans les vues de vol du jeu ; un **profil
    Neutre** (physique) par défaut au Labo, en science et en photo neutre ; (2) l'exposition qui respire dans le profil
    Caméra seulement, le posemètre incident reste la base ; (3) le grain, léger, dans le profil Caméra ; (4) la photo
    altérée (ré-éclairage, puis dé-éclairage si L7 passe) : oui, avec un réglage pour comparer ; (5) le couvert bas près
    des aérodromes d'abord, puis en vol rasant par paliers ; (6) le mode GoPro hors cockpit, sans HUD par défaut, un HUD
    minimal en option ; (7) le coût d'abord : B1 (T9) avant la chaîne caméra.

**Le mode de travail (Sam, 2 novembre)** :

33. **En continu** : chaque phase se termine par un commit, un push et une planche dans `docs/progress/refraction-horizons/`,
    puis la phase suivante, sans attendre. **On ne s'arrête que sur un problème ou une question.** Les portes de décision
    du plan (pilote H1, go/no-go de L7, P9/P10, pré-filtre SRTM, réétalonnage de C2…) sont tranchées selon leurs critères
    chiffrés et notées dans le journal de la phase ; arrêt seulement si un critère échoue sans solution évidente.
    **Exception : arrêt après C0**, pour que Sam relise les contrats. Le profil Caméra par défaut (décision 32) est
    confirmé.
34. **Les téléchargements** de sources publiques et ouvertes (DEM LOLA, Copernicus GLO-30, orthos nationales, vidéos de
    référence de la LUT…) sont autorisés jusqu'à ~2 Go par source, chacun noté (nom, source, taille, licence) ; au-delà,
    ou si la licence est douteuse, on demande.
35. **Les machines** : ce Mac et kerr-mini pour les e2e et les A/B, kerr-pc pour les compilations D3D12 — disponibles.
    **`main` est à ce plan** : on y travaille directement (toujours sans `git stash`, en relisant `git log` avant chaque
    phase).
36. **Les e2e sont chers : on les utilise au mieux** (Sam, 2 novembre) :
    - **d'abord le moins cher** : tests unitaires, tranches de shader et vérifications CPU = GPU, puis un contrôle rapide
      dans le panneau local ; l'e2e seulement pour ce qu'eux seuls prouvent (l'image, le temps GPU, le mouvement) ;
    - **une suite de vues partagée** : les vues de M0a/M0b forment un seul e2e paramétré, réutilisé par toutes les phases
      (mêmes vues, mêmes tailles, mêmes réglages), au lieu d'un e2e neuf par phase ;
    - **en arrière-plan** : un e2e ou un A/B tourne sur kerr-mini (ou kerr-pc) pendant que la phase suivante se code ici ;
      son résultat est relu avant le push de la phase qu'il valide, et un échec rouvre cette phase ;
    - **groupés** : plusieurs phases voisines qui touchent les mêmes noyaux partagent une même séance A/B et une même
      compilation D3D12 ; la campagne complète seulement aux jalons (fin de T, de H, de Q2–Q3, de Q4, de Q5–Q6, de R) ;
    - **bornés** : chaque e2e a sa durée estimée dans son titre et un plafond ; un vol scripté se coupe en morceaux
      rejouables (sauvegardes) ; jamais deux e2e lourds sur la même machine ;
    - **ciblés** : seuls les e2e existants que la phase peut casser sont relancés (la liste du §5 par sujet), pas toute
      la campagne.
37. **La porte de H1 : l'option (d)** (Sam, 3 novembre, après le pilote — [H1.md](progress/refraction-horizons/H1.md)) : les
    cartes d'horizon gardent par direction **la distance du bloqueur dominant** (2 couches de plus, ~50 Mo pour la Lune avec
    les calottes), et leurs rayons lisent **les hauteurs moyennes** le long des mips, plus les maxima ; à l'ombrage, l'horizon
    est revu depuis la hauteur propre du point. Pilote (CPU) : 5,95 % de faux éclairage et 2,35 % de fausse ombre, contre
    12,7 et 2,65 % depuis le haut du texel. Puis Mars, Mercure et Cérès.

## 11. Questions ouvertes

**Pour Sam** : relire les contrats à la fin de C0 (décision 33). Les budgets de la décision 26 sont confirmés.

**Les contrats de C0** tranchent les questions techniques que le challenge a rouvertes : la surface de raccord et les
générations ; la disposition de la cible de visibilité ; la projection optique et ses consommateurs ; l'architecture
des tuiles ; les deux Soleils ; la représentation de l'horizon (bandes, marge, distance par direction) ; les budgets de
précision en pixels par mode ; la fidélité garantie au télé maximal et autour de Shackleton.

Les contrats 9 à 13 de C0 (profondeur par consommateur, identité des bâtiments, politique photo, erreur projetée,
compilation) s'y ajoutent.

**Restent les décisions prévues pendant le plan**, au vu des mesures :
- le pré-filtre SRTM (après T1, s'il le faut) ;
- le budget en vol fixé à la fin de Q1 ;
- ~~la porte de décision du pilote de H1~~ : tranchée, l'option (d) (décision 37) ;
- H3a gardé seulement si sa borne est prouvée ;
- le réétalonnage de C2 (Q5, contre les photos de M0b) et le rendu du limbe d'orbite ;
- la LUT du profil Caméra (les vidéos de référence retenues) ;
- le go/no-go de L7b (après son étude) ;
- R6a-terrain (après R6a-ciel) et le go/no-go de R6b ;
- P9 et P10 gardés ou retirés (Q9) ;
- Copernicus GLO-30 (G2), les orthos nationales retenues (G1) ;
- la pleine résolution des cartes d'horizon (H4) ;
- les estimations refaites après C0 et Q1.

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
- **2 novembre, plus tard** : les réponses de Sam aux quatre questions (§10, décisions 12 à 15) — T1 la fonction seule
  d'abord ; H5 en option jugée après T6 ; T8 et T9 gardés ici ; R4a attend R4b.
- **2 novembre, plus tard encore** : le volet **Q** (« qualité Unreal », Q1–Q9) après
  [ANALYSE-TERRE-UNREAL-2026-11-02.md](ANALYSE-TERRE-UNREAL-2026-11-02.md) ; Sam : « fais au mieux, tout dans le
  périmètre » → décisions 16 à 20 (Q en entier, la perf d'abord ; H5 dans le plan à 8 directions ; C2 oui ; L7 oui avec sa
  méthode et son go/no-go ; D1 oui) ; §3.8, §4, §5, §6, §7 (Q), §8 (l'ordre, ≈ 87–117 j), §11 mis à jour.
- **2 novembre, nuit** : le challenge [CHALLENGE-PLAN-REFRACTION-HORIZONS.md](CHALLENGE-PLAN-REFRACTION-HORIZONS.md)
  relu point par point, ses affirmations clés revérifiées dans le code (§3.9) et intégré : M0a, C0 et M0b ; T3 sur la
  surface triangulée ; T4 en générations ; T5 dans la cible `rgba32uint` ; T6 en cascades avec ombres de contact ; T7 en
  hiérarchie de sources ; T8–T10 en une architecture, plus tôt ; H : estimation et marge, `D_cuisson` fixe et corrigé
  (Lune 10,7 km à 2048), portée dérivée des données, chiffres sphériques, pilote, H1b en rendu seul, H1c (Shackleton),
  H3a seulement prouvé ; R3 à deux Soleils ; R1 hydrostatique ; R2 en budgets de pixels ; R4 sur tous les consommateurs ;
  R6a coupé en ciel et terrain ; R6b plausible ; validation par régions et en séquences ; décisions 21 à 26 ; §11 rouvert
  sur les contrats de C0 ; estimation ≈ 100–135 j.
- **2 novembre, nuit (suite)** : le challenge
  [CHALLENGE-ANALYSE-TERRE-UNREAL-2026-11-02.md](CHALLENGE-ANALYSE-TERRE-UNREAL-2026-11-02.md) relu et revérifié dans le
  code (§3.10 : ombres du décor coupées sous ~1,7° de Soleil, profondeur du proxy, `meshFs` sans identité, C2 qui change le
  monde avec l'observateur) ; [PLAN-IMAGE-VIPER11.md](PLAN-IMAGE-VIPER11.md) fusionné ; C0 à treize contrats ; Q1–Q9
  réécrits (Q6 avant Q4, la photo ré-éclairée dès Q2, L4 sur la sémantique, l'atmosphère unique, la météo datée, la
  composition multicouche, le profil Caméra, le couvert bas) ; décisions 27 à 32 (18 remplacée) ; estimation ≈ 115–155 j.
- **2 novembre, matin — en cours d'exécution** : M0a et C0 faits ; les sites sur leurs vraies pistes ; **T1** (la cubique
  hybride sur pré-filtre), **T2** (les coutures marquées), **T8a** (une tranche du chargement avancée à la demande de Sam :
  Terrarium d'abord et l'IGN par-dessus en deux passes, fenêtres de 8 tuiles jusqu'au z 14, un halo dans le sens du vol, le
  cache du Service Worker plus rapide, le décor OSM en parallèle) ; deux régressions des planètes en raster corrigées
  (Monument Valley, le z 14 de la Terre) ; **Q1** commencé : les boîtes du décor triées sur le GPU (P2), les ponts en vrais
  maillages (décision de Sam) ; mesuré que P1 ne paie pas et que le matériau du sol ne baisse pas par parties —
  [progress/refraction-horizons/T1-T2-T8a.md](progress/refraction-horizons/T1-T2-T8a.md),
  [progress/refraction-horizons/Q1.md](progress/refraction-horizons/Q1.md).
- **2 novembre, après-midi** : à Hopi Point, les « triangles géants » du raster étaient l'œil sous le relief. Le traceur lisait
  le relief au rayon écrasé d'un point, et non à son pied WGS84 : 6,8 m de glissement au Grand Canyon, 25 m à l'Everest.
  Corrigé dans `geoQ` et au CPU, et le trépied d'une scène tenu à son point. Ensuite **T3** (la géomorphose, l'écart des
  coutures nul par construction, 96 px avant au 95ᵉ centile) et **T5** (les normales lisses dans le canal `a`, 2 × 9 bits ;
  plus de facettes ; visibilité au même coût à Yosemite) —
  [progress/refraction-horizons/T3-T5.md](progress/refraction-horizons/T3-T5.md).
- **2 novembre, soir** : **M0b** mesuré sur kerr-mini (deux tours, 25 vues) — la part des ombres du relief sur les mondes
  à cratères (5 à 14 ms), 16 cuissons par seconde en vol bas ; **H3a abandonné** (aucune borne de pente utile : 66 à 90°
  pour les seuls cratères procéduraux), `reliefAt` = 8 × `hdAt`, les calottes à 78° et 256² gardées —
  [progress/refraction-horizons/M0b.md](progress/refraction-horizons/M0b.md) ; **R3** fait (les deux Soleils) —
  [progress/refraction-horizons/R3.md](progress/refraction-horizons/R3.md) ; **T6** fait (les ombres du relief en deux
  cascades ±1,5 et ±10 km, les ombres de contact, le décor gardé jusqu'à 0,3° ; 2 à 5 % de l'image ombrés au Soleil bas à
  Chamonix, rien à midi ; +0,2 à 0,8 ms sur kerr-mini) — [progress/refraction-horizons/T6.md](progress/refraction-horizons/T6.md).
- **2 novembre, nuit** : **T10** fait — les niveaux à 4 tuiles et les orthophotos rangés par quarts de couche
  (`tileLayout`, `trace.wgsl tileAt`) : la texture « très loin » de 436 à 235 Mo (−192 Mio à la jauge du jeu), le pic
  au changement de portée 369 Mo ; les mêmes images (A/B sur kerr-mini dans le bruit A/A), aucun coût au temps d'image —
  [progress/refraction-horizons/T10.md](progress/refraction-horizons/T10.md).
- **2 novembre, nuit** : **H1** fait (le pilote, la Lune) — la cuisson GPU générique (`horizon-maps.ts`, `horizon.wgsl` :
  treillis lat/lon, fenêtre locale, calottes stéréographiques à 16 directions), ~150 ms de GPU en bandes de ~2 ms, 25 Mo,
  le GPU à un code près du CPU sur 99,9 % des octets ; le pilote : depuis le haut du texel, **12,7 % de faux éclairage**
  (2,65 % de fausse ombre) au-delà de `D_cuisson` ; l'option « distance par direction + moyennes » le divise par deux
  (5,95 / 2,35 %) ; 0,1° contre la référence non tenu (±0,3°) — **porte de décision** posée à Sam —
  [progress/refraction-horizons/H1.md](progress/refraction-horizons/H1.md).
- **2 novembre, nuit** : **T4a** fait — les changements des tuiles triés par l'anneau que chaque niveau du cache dessine
  (visibles : recuits groupés ; cachés sous les niveaux fins : 10 s plus tard), les niveaux dus recuits ensemble, les fenêtres
  posées 24 nœuds en avant du mouvement : **13,3 → 7,3 cuissons par seconde** en vol bas à Chamonix (kerr-mini, A B B A), le
  temps d'image inchangé — [progress/refraction-horizons/T4.md](progress/refraction-horizons/T4.md) ; puis **T4b** (le fondu
  de 250 ms depuis l'état affiché : les sauts de 13 à 35 m du sol lointain étalés, aucun coût mesuré) et le harnais e2e
  corrigé (plus de Chrome orphelin : `bun test` n'exécute pas les gestionnaires de sortie).
- **3 novembre** : Sam tranche la porte de H1 : **l'option (d)** (décision 37). **Q2a** fait — la photo ré-éclairée par source
  (`groundRelight`), le ciel par les harmoniques sur une pente (L1), le rebond par l'albédo moyen (L6), et **l'empreinte des
  pixels sur la pente** (le haut des montagnes lu à un niveau d'imagerie 33 × trop grossier — la remarque de Sam) ; Chamonix à
  midi : les versants plus ombrés deux fois (+4,8 niveaux) ; coût +0,35 ms à Paris, +0,8 ms en montagne (au-dessus du budget) —
  [progress/refraction-horizons/Q2.md](progress/refraction-horizons/Q2.md). **L'indicateur de chargement des données** (demande
  de Sam) : sous la barre du haut, les tuiles du relief et des photos, l'étape du décor, les cartes, les horizons, les échecs
  (`settings.showLoading`, e2e `data-meter`). **Les sommets lointains** (la remarque de Sam : « grands triangles d'environ
  100 m ») : les fenêtres du cache passent de **129² à 257² nœuds** — chaque distance dessinée par un niveau deux fois plus
  fin, les facettes divisées par deux, les crêtes lointaines dessinées (A B B A sur le mini) ; coût du rendu dans le bruit
  (Paris +0,25 ms, Chamonix bimodal 49/58 ms des deux côtés) ; le maillage des pistes accéléré (22 → 9 ms au niveau 0 : les
  cellules que croise un bord seulement, plus de tableau par sommet ; les grilles des anneaux faites une fois par niveau) et
  **préparé à l'avance dans un worker** pour la fenêtre suivante, décidée par le cache avant le bord : en vol stabilisé sur
  piste, plus aucun maillage fait dans l'image, l'image de reconstruction ~27 → ~12 ms (8 ms d'ordinaire) — e2e
  `runway-mesh`, [progress/refraction-horizons/T257.md](progress/refraction-horizons/T257.md).
- **3 novembre, plus tard** : l'analyse « au-dessus de Paris » ([ANALYSE-PARIS-PIPELINE-2026-11-03.md](ANALYSE-PARIS-PIPELINE-2026-11-03.md)) ;
  les bâtiments maillés autour de l'avion et en boîtes orientées, le centre du décor tenu, le décor en deux temps, un budget
  Géoplateforme commun, le worker plus léger ; **la nuit calibrée** (Q2) ; **Q3** première étape — le matériau du tracé sur
  les bâtiments raster ([Q3.md](progress/refraction-horizons/Q3.md)) ; **H1 (d)** sur le GPU — les moyennes le long des rayons,
  le pas du bloqueur dominant ([H1.md](progress/refraction-horizons/H1.md)).
- **3 novembre, matin** : **H1b + H2** — la Lune au télescope depuis la Terre reçoit son relief seul (le DEM, la couleur
  grossière gardée, le sol du CPU intouché ; priorité épinglé > proche > regardé, `reliefAt` = 8 × `hdAt`) et ses cartes
  d'horizon sont lues sur son disque (`horizonLight`, liaisons 42 et 43, `TABLE_HORIZON`, réglage `horizonMaps`) : le relief
  LOLA visible, le terminateur dentelé, les pentes que le relief éclairait jusqu'à ~270 km dans la nuit éteintes ; aucun coût
  mesurable (kerr-mini, ±3 ms). Le premier essai a montré que `ourSegment` ne dessinait jamais le corps HD (toujours le corps
  proche) : H1b devait précéder H2 — [progress/refraction-horizons/H2.md](progress/refraction-horizons/H2.md). Au passage, le
  traceur sans décor mondial recompile (b7780d14).
- **3 novembre, fin de matinée** : **H3** et **H5** (premières parties, [H3.md](progress/refraction-horizons/H3.md),
  [H5.md](progress/refraction-horizons/H5.md)) ; **T9a** — les orthophotos dans leur propre texture filtrée (mips par tuile,
  sRGB, anisotropie 16), sorties de la texture des hauteurs : A/B sur le mini −2 % au matériau raster, images équivalentes,
  −10 Mo — [progress/refraction-horizons/T9.md](progress/refraction-horizons/T9.md). **T9b** — l'imagerie des niveaux z6–14 dans
  les mêmes textures (1024² et 2048²) : −1,1 ms (−4 à −6 %) au matériau raster ; mémoire en transition jusqu'à T9c. **T9c** — la texture du relief à ses hauteurs
  (`r32uint`), les lumières nocturnes dans des couches filtrées : 354 → 274 Mo à la portée « très loin », temps et nuit inchangés. **H4** — le bilan des horizons
  ([H4.md](progress/refraction-horizons/H4.md), [HORIZONS.md](HORIZONS.md)) : leur état dans la télémétrie « sky » de TARS ;
  H1c attend la décision d'hébergement des DEM du pôle sud ; H5 en texture filtrée différé (précision du `rgba16float`). **Q3, suite** — les murs mitoyens aveugles (le drapeau dans
  le dernier bit des arêtes), les fenêtres selon l'usage BD TOPO, le détail effacé par l'empreinte du pixel et la lueur moyenne des
  fenêtres au loin : la ville lointaine éclairée la nuit ; +2 à 3 % au matériau raster ([Q3.md](progress/refraction-horizons/Q3.md)). **T8a** — le décodage et les couleurs des tuiles dans un
  worker (`tile-decode.ts`) : 0 ms sur le fil de la page au lieu de ~1,25 s en 25 s de vol bas, +6 % d'images ; les longues tâches
  restantes ne viennent pas des tuiles ([T8.md](progress/refraction-horizons/T8.md)). **T8b** — la spécialisation WGSL des
  variantes du traceur dans un worker (jusqu'à 174 ms une variante, sur le fil de la page avant) : le temps de longues tâches −37 %.
  **T8c** — le temps CPU de la boucle en distribution (`game.perf().loopCpu`) ; trois recalculs par image retirés (le nivellement
  des pistes limité aux pistes proches, `ellOfR` et les sphères d'influence gardés par instant), une mise en page forcée retirée :
  la pire itération 24–30 → 12–15 ms, le 95ᵉ centile ≈ 7 ms (cible 4) — mesuré sur ce Mac sous pression thermique. **T8d** — le repère
  de l'appareil et ses voisins plus recalculés par chacun de leurs lecteurs (`gravityHome` sans vitesse, `mouthAccel`, `mouth()` figé,
  gardés par point/instant/réglages ; `escapeRadius` sans notre côté ; la boîte du canvas du guidage au roulage lue seulement quand il
  s'affiche) : profil `sfFrame` 856 → 396 ms, mises en page forcées 304 → 23 ms sur 25 s ; A/B (thermique Nominal) p95 4,5 contre
  4,7–5,1 ms, à tuiles inégales — non démontré. Puis à cache chaud et tuiles égales (pression Nominal) : −0,3 ms à la médiane
  et au p95 (4,9/5,0 → 4,6/4,7 ms). **T8e** — les orthophotos z 15–16 en fenêtres de 8 tuiles aux portées lointaines (les
  dernières couches de la texture 2048², +45 Mo GPU) : aucun coût GPU mesurable, **aucun gain visible dans la vue de Paris à
  450 m** (le pied du pixel au-delà de 1,6 km y est plus grossier que z 15 ; un premier « +6 % de netteté » était un artefact de la
  normalisation d'exposition, corrigé en T8f) — mesuré aussi à 2 000 m, regard plongeant : pas de changement non plus. **T8g** : désactivées (`ORTHO_BIG_LEVELS = 0`,
  le mécanisme gardé ; −45 Mo GPU), **décision à confirmer par Sam** (le plan les demandait). **T8h** — la priorité des tuiles : le niveau le plus près d'avoir sa fenêtre
  entière d'abord (un niveau n'est dessiné qu'entier), à égalité le plus fin ; mesuré en rejeu des tuiles à latence fixe
  (`tile-arrival`, `lib/tile-replay.ts`) : à 1 000 ms, le z 14 dessiné 49 → 26 s, le relief IGN entier 51 → 8,7 s, la moyenne
  des niveaux 42,8 → 24,6 s ; à 300 ms, z 14 18 → 9 s, IGN 19 → 3,7 s.
- **3 novembre, matin (suite)** : **H3, première partie** — les ombres du corps proche lisent ses cartes d'horizon
  (`nearHorizon` : la carte vers le Soleil revue depuis la hauteur propre du point, la pénombre du disque plus ce que
  l'horizon balaie sous le pixel ; Soleil sous l'horizon : 0, rien d'autre lu ; sinon le min avec la marche et la carte du
  Soleil ; un fondu de 1,5 s à l'arrivée) ; Mars la lit après le fondu de `REL_SH` (15–25 km), donc aussi depuis l'orbite ;
  **Mercure, Cérès et Mars cuits** (décision 37 ; largeur 2048, le DEM au plus). Mesuré sur le mini : la Lune assombrie de
  1,8 % (terminateur à 500 km), 0,6 % (4 000 km), 0,5 % (pôle sud), Cérès 0,5 %, Mercure 0,09 %, sans éclaircir au-delà du
  bruit ni ajouter de grain ; **ni coût ni gain mesurable**. **La marche lointaine reste** : son retrait au-delà de
  `D_cuisson` rééclairait 0,73 % des pixels (la carte, à −2,2…+1,0° près, manque des bloqueurs) — le gain de coût attend une
  carte prudente (H3a ou le maximum des mips). L'effet sur Mars n'est pas démontré (son terminateur se fond dans le crépuscule
  de sa poussière) — [progress/refraction-horizons/H3.md](progress/refraction-horizons/H3.md).
- **3 novembre, matin (suite)** : **H5, première partie** — l'horizon de la Terre en 8 directions sur les niveaux 4–6 du cache
  (153 m, 611 m, 2,4 km ; le niveau 3 est sous les cascades), cuit sur le GPU depuis les hauteurs du cache quand un niveau est
  recuit (jamais quand le Soleil tourne), rangé dans la table du traceur (aucune liaison), lu par le sol raster et le sol tracé
  au-delà des cascades, revu depuis la hauteur du point (option (d)). Le Valais au couchant : 2,2 % de pixels assombris, rien
  d'éclairci, rien à midi ; lecture +0,4–0,8 ms (au-dessus de la cible), cuisson ~1,5 ms par image pendant 8–10 images par
  niveau. Au passage, les e2e de H3 et H5 tiennent l'exposition automatique au lieu de la couper (le ciel à son échelle
  physique : des étoiles en plein jour) — [progress/refraction-horizons/H5.md](progress/refraction-horizons/H5.md). H1c
  (Shackleton) attend une décision de stockage : le dépôt est à 564 Mo de binaires pour 600.
