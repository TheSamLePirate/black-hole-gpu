# Plan — la bonne réfraction, et les cartes d'horizon du relief

Date : **31 octobre 2026**, sur `main` à `06ed0498`. Statut : **analyse et plan, rien d'implémenté**. **Volet réfraction (R0–R4) en attente** (31 octobre) : Alex a des
changements non poussés sur la réfraction dans vr-solar-system ; les lire (`docs/agent/` et son code) avant de commencer.

## 0. La demande

> « Prépare un plan pour implémenter la bonne réfraction et les cartes d'horizon pour les ombres du relief vues de loin,
> sur les planètes rocheuses en raster. Avant ça, analyse la faisabilité et le gain en qualité et en perf. »

Origine : l'analyse de `vr-solar-system` (Alesk, portage Quest 3 de ce jeu, cloné dans `~/Documents/DEV/vr-solar-system`).
Leur rapport `docs/reports/2026-10-31_refraction-models_05.md` compare leur modèle au nôtre ; leurs cartes d'horizon sont
dans `docs/modules/Terrain.txt` (FAR CAST SHADOWS, LIGHT EXTRAS) et `Runtime/Terrain/ReliefHorizonJob.cs`.

---

## 1. Analyse — la réfraction

### 1.1 L'existant

- **Un seul modèle**, une formule fermée (`src/system/refraction.ts` et son jumeau `trace.wgsl airBend`) : air
  exponentiel (H = 8,4 km), courbure = (N₀/H) × sin ψ × colonne de Chapman (forme de Schüler), plafond 0,03 rad.
  N₀ = 2,93·10⁻⁴ × 288,15 / (273,15 + T) — la météo réelle donne T.
- **Utilisateurs GPU** : `airBend` (le ciel au-delà de l'air, `REFR_DELTA` pour le rayon vert, C4), `shadeStars`
  (l'inverse, 3 points fixes), `earthRingLight` (la Lune éclipsée : « C3 doublé »).
- **Utilisateurs CPU** : `skychart.ts`, `photo/plans.ts` (heures de coucher, cadrages), `sky-now.ts` (TARS),
  `targeting.ts` et `controller/rig.ts` (`refractDirection` : viser ce qu'on voit).
- **Laissés de côté par C3** (PLAN-CIEL) : le sol éclairé par le Soleil géométrique (2–3 min de lumière rasante en
  moins au couchant), la réfraction terrestre (le sol lointain non relevé).

### 1.2 L'erreur, mesurée

Recalculé ici (script hors projet : USSA-1976 en 7 couches, invariant de Bouguer, Simpson ; nos chiffres par notre
propre `bending()`). En minutes d'arc :

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

- **Le Soleil couchant aplati** (sa dernière demi-largeur) : Bennett 0,814, couches 0,823, **nous 0,742** — trop
  écrasé de 9 %.
- **Vu d'orbite (400 km), rayon rasant à la hauteur tangente** : 2 km → couches 64,4′, nous 54,8′ (−15 %) ; 5 km →
  46,3′ / 38,4′ (−17 %) ; 10 km → 26,4′ / 21,2′ (−20 %). Le coucher vu de l'ISS est donc trop peu écrasé.
- **Depuis une montagne (3 km)**, à +1° : 17,8′ contre 15,4′ (−14 %).
- **La cause** : une seule hauteur d'échelle, et l'angle à la verticale pris à l'œil pour tout le trajet. Près de
  l'horizon, la courbure vient des premiers kilomètres, où l'air réel (gradient −6,5 K/km) n'est pas isotherme. Le
  N₀ de 2,93·10⁻⁴ à 15 °C est en fait la valeur à 0 °C (Edlén à 15 °C, 550 nm : 2,778·10⁻⁴) : il compense
  à l'horizon, d'où le bon 35′ là et l'erreur au-dessus.
- Le commentaire de `refraction.ts` (« Bennett à une fraction de minute au-dessus de 2° ») est faux : ~2′ à 2°.

### 1.3 Ce que ça change à l'image

- **Au grand angle** (60° de champ, 1080 px de haut → 1 px ≈ 3,3′) : l'erreur maximale de ~2′ est **sous le
  pixel**. Invisible en vol normal.
- **Au téléobjectif** (la vignette télé, le trépied et son télescope Y, les photos multi-poses de PLAN-CIEL) : à 2° de
  champ, 1 px ≈ 0,1′ → **15 à 20 px d'écart** sur la hauteur du Soleil ou de la Lune près de l'horizon, et **une
  forme du disque fausse** (0,74 au lieu de 0,82 : se voit au premier coup d'œil sur un coucher au 600 mm).
- **Les prédictions CPU** (heures de coucher du planificateur photo, TARS, carte du ciel) : ~2′ à 1–3° de hauteur, soit
  **8–12 s d'heure** de coucher ou lever à nos latitudes ; la vignette et la prédiction seraient enfin d'accord avec
  une table publiée.
- **La Lune éclipsée** (`earthRingLight`) : la courbure rasante y est « C3 doublé » ; les couches donnent ~15–20 % de
  plus aux hauteurs tangentes qui comptent (2–10 km) → l'ombre plus éclairée au cœur, la couleur de Danjon déplacée.
  À valider sur l'éclipse du 07/09/2025 (C6).
- **Le Soleil d'éclairage** (§1.1) : aujourd'hui le sol s'éteint quand le centre géométrique passe sous l'horizon,
  alors que le disque est encore vu ~35′ au-dessus : **2–3 min de lumière rasante en moins** au couchant, et un
  Soleil visible au-dessus d'un paysage déjà dans l'ombre. Visible au grand angle.
- **La réfraction terrestre** (le sol lointain relevé, k ≈ 0,13–0,17) : un sommet à 100 km relevé de 3,5′, à 300 km de
  ~10′ (3 px au grand angle, énorme au télé) ; la dépression de l'horizon vu d'avion ~8 % plus petite ; le Soleil qui
  se couche derrière une montagne lointaine au bon moment.

### 1.4 Faisabilité et coût

- **Le modèle en couches** : facile, pur CPU. 128 rayons × 200 pas de Simpson par hauteur de caméra : bien sous la
  milliseconde. Une table 2D (≈48 hauteurs de 0 à 1 000 km × 128 directions) construite une fois (worker ou au
  chargement), interpolée à chaque image.
- **Au GPU** : `airBend` lit 128 valeurs pour la hauteur courante (`P` grandit de 32 vec4 — uniforme, sans binding
  nouveau) au lieu de `sqrt`/division/`exp`. **Coût attendu : nul** (C3 avait déjà mesuré +0,3 % pour la formule ;
  une lecture d'uniforme indexée + un lerp coûte autant). À vérifier en trace-ab, le noyau étant limité par ses
  registres.
- **Le Soleil d'éclairage réfracté** : une direction par image, calculée au CPU. Coût nul. Risque : rester cohérent
  avec la carte d'ombre du Soleil (`terrain-raster encodeSunShadow`), les ombres des nuages, des arbres et des
  bâtiments — tous prennent la même direction.
- **La réfraction terrestre** : faisable mais **la plus risquée**. Il faut relever le sol dessiné de k·d²/2R dans
  **tous** les rasters de la Terre (sol, scènes, forêts, pistes 3D, bâtiments), décaler d'autant le test de hauteur de
  `earthMarch`, et défaire ce relèvement quand l'ombrage reconstruit le point depuis la distance du raster. Le CPU
  (collisions, WGS84, hauteurs) ne bouge pas : c'est du dessin seulement. Six chemins doivent rester d'accord, sinon
  arbres flottants ou coutures.
- **Les mirages et conduits** (le point fort de vr-solar-system : tables tracées par profil d'air, RK4, images
  multiples) : hors de ce plan. Il faudrait des profils d'inversion tirés de la météo réelle et des images multiples
  dans le traceur. À rouvrir après R3 si tu le veux.

---

## 2. Analyse — les cartes d'horizon (planètes rocheuses)

### 2.1 L'existant

- **Vue de loin** (`trace.wgsl planetShade` pour les mondes sans air, `otherGround` pour Mars) : la carte HD incline
  la normale (`hdNormal` → `demNormal`), **aucune ombre portée**. Au terminateur, la Lune vue de la Terre ou de
  l'orbite a des cratères éclairés par leur normale seule : plats, sans les longues ombres qui font le terminateur.
- **Vue proche** (le raster des corps, `bodyLite` / `bodyLiteAir` → `nearShadow`) : une marche de 56 pas au plus,
  de 0,5 m (8 m sur Mars) jusqu'à **20 km** sur les mondes sans air, 60 km sur Mars (P8 l'a raccourcie de 60 à 20 km
  pour la perf).
- **Son coût** (P8, mini, Mercure en vue ciné, Soleil à 15°) : **les ombres faisaient 43 des 77 ms** ; ramenées à
  ~17 ms (la vue entière à 43 ms contre 40 pour la Terre : Mercure **au-dessus du budget de la Terre**, Cérès +11 %).
  P8 notait : « la voie suivante pour leurs ombres : une carte d'ombre du Soleil, comme celle de la Terre ».
- **Les données** : `hdRelief` (rg16float, R moyenne, G maximum le long des mips), un seul corps à la fois
  (`P.hd`) : Lune 4096 × 2048 (LOLA, ~2,7 km/texel), Mars 4096 (MOLA, ~5,2 km), Mercure 2048 (~7,5 km), Cérès 2048
  (~1,4 km), Vénus 4096 (sous les nuages : exclue). Le relief plus fin vient des tuiles (`moon-tiles.ts`) et du
  procédural (cratères).

### 2.2 Ce que font les cartes d'horizon (vr-solar-system)

- Par texel, **l'élévation de l'horizon dans 8 directions** (N, NE … NO), en sinus quantifiés sur un octet
  (−0,2…0,8), avec des mips. Le balayage suit le grand cercle de 1 à 8 texels puis ×1,3 jusqu'à 30 texels
  (~320 km sur la Lune), courbure comprise.
- **À l'ombrage : deux lectures de texture**, la direction du Soleil interpolée entre les deux azimuts voisins,
  smoothstep de ±0,006 sur son élévation (un demi-degré, le disque solaire).
- Eux : 24 cellules cube de 128², ~4,2 Mo par corps, cuites au CPU (Burst, 62 ms la cellule). Ils ont aussi des
  horizons par sommet (8 directions) sur leurs patchs fins, pour le proche.

### 2.3 Gain en qualité

- **De loin (le plus gros gain)** : les ombres du relief au terminateur de la Lune, de Mercure, de Mars et de Cérès,
  vues de la Terre (télescope, trépied, photo), d'orbite ou en approche. Copernic, les Apennins, les remparts des
  grands cirques : leurs ombres longues aujourd'hui absentes. Résolution : les reliefs de plus de ~2–3 texels (Lune
  ≥ ~6 km, Mars ≥ ~12 km). C'est **la** vue des astrophotographes, celle que le jeu met en avant (PLAN-CIEL,
  observatoire).
- **De près** : une portée qui passe de **20 km à ~170–300 km**. Au Soleil rasant, un sommet de 5 km porte son
  ombre à 140 km (Soleil à 2°) : aujourd'hui coupée à 20 km. Au sol près du terminateur, des plaines restent
  éclairées alors qu'une chaîne lointaine les met dans l'ombre. La marche garde le détail fin (cratères, rochers)
  dans ses premiers kilomètres.
- **Cohérence loin/près** : la même carte de part et d'autre de la passation, moins de « pop » d'ombre quand le raster
  des corps prend la main.

### 2.4 Gain en perf (estimé, à mesurer)

- **De loin** : +2 lectures de texture et ~20 opérations par pixel du corps HD seulement. Négligeable (< 0,1 ms),
  derrière un bit de variante pour que les autres noyaux ne paient rien (leçon C6 : la boucle des paires coûtait
  6–12 % même sans tourner).
- **De près**, trois économies dans `nearShadow` :
  1. **Ombre lointaine certaine** (l'horizon de la carte au-dessus du Soleil + marge) → 0 sans marcher. Au Soleil
     bas — le cas cher — de grandes zones sautent la marche entière.
  2. **La marche raccourcie** à la portée où la carte prend le relais (~2–3 texels : Lune ~8 km, Mars/Mercure ~16 km).
     Mondes sans air, au-delà de 32 m (×1,6) : ~5 pas sur ~30 en moins (~17 %). Mars (×1,4 depuis 8 m) : ~9 pas sur
     ~26 (~33 %).
  3. **Soleil haut** : au-dessus de l'horizon de la carte et de la pente maximale du relief procédural (~35–40° pour
     des parois de cratères frais), le point est éclairé sans marche. Midi lunaire : la marche disparaît.
- **Estimation** : Mercure ciné (Soleil 15°) ombres 17 → ~11–14 ms, soit **−3 à −6 ms sur 43** — sous le budget de
  la Terre (40). Au Soleil haut : ombres → ~0. Au Soleil rasant : de grandes zones gratuites. Ces chiffres sont des
  estimations à confirmer en trace-ab.
- **Mémoire** : 8 directions × 1 octet × (2048 × 1024) + mips ≈ **22 Mo** pour la Lune ou Mars (à demi-résolution du
  DEM), ~5,5 Mo pour Mercure et Cérès. Un seul corps à la fois, comme `hdRelief`.
- **Cuisson** : au GPU, ~2 M texels × 8 directions × ~24 pas ≈ 400 M lectures → ~30–80 ms au total sur un GPU de Mac.
  **Étalée sur ~16–32 images** (tranches de lignes) à l'arrivée du corps HD : ~2–4 ms par image pendant ~0,5 s. Une
  passe à part (`shaders/horizon.wgsl`), **hors du noyau du traceur** : rien n'y alourdit les registres.

### 2.5 Faisabilité et risques

- **Faisable** : la donnée (`hdRelief`, avec ses maxima en G) et le point d'ombrage (`planetShade`, `otherGround`,
  `nearShadow`) existent. Le code neuf tient dans une passe de cuisson séparée et ~40 lignes dans `trace.wgsl`.
- **Les bindings** : le noyau est proche de `maxSampledTexturesPerShaderStage` (déjà 7 textures conditionnées dans
  `renderer.ts`). Plutôt que d'en ajouter une, **réutiliser une liaison propre à la Terre**, jamais lue sur un monde
  rocheux (ex. `surfaceColour` : `texture_2d_array<f32>`, du même type) : sur un monde rocheux, les cartes d'horizon
  à sa place. À trancher en H0.
- **Équirectangulaire** : les 8 azimuts sont repérés par l'est et le nord locaux (comme `hdNormal`). Pôles
  sur-échantillonnés (sans gravité), axe singulier au pôle exact : un repli. Le pôle sud lunaire (Shackleton, Soleil
  toujours rasant) est **le meilleur cas d'usage** : à soigner.
- **Le raccord marche/carte** : la carte cuite **à partir de la portée de la marche** (pas depuis 1 texel), sinon le
  relief proche est compté deux fois — fin par la marche et grossier par la carte. Ombre = min(marche jusqu'à D,
  carte au-delà de D). Vue de loin, les reliefs plus petits que D (~2–3 texels) n'ombrent pas : ils sont sous le pixel
  depuis la Terre et l'orbite haute ; en orbite basse, le raster des corps et sa marche ont déjà pris la main.
- **Les tuiles fines** (`moon-tiles`) n'entrent pas dans la carte (globale, au texel du DEM) : la marche garde ce
  détail dans ses premiers kilomètres. Cohérent.
- **Exclus** : la Terre (sa carte d'ombre du Soleil ±10 km et `earthTerrainShadow` ; les cartes d'horizon pourraient
  plus tard porter ses ombres au-delà de 10 km — les Alpes au couchant), Vénus (nuages), les géantes, les petites
  lunes sans DEM (cartes de normales seules).
- **Rejeté** : les horizons par sommet de vr-solar-system (leur relief est un maillage CPU en Burst ; le nôtre est
  évalué dans le vertex shader du clipmap, une marche par sommet y coûterait trop).

---

## 3. Le plan

Deux chantiers indépendants (fichiers disjoints sauf `trace.wgsl`, à des fonctions différentes). **Ordre conseillé :
H d'abord** (gain visible au premier coup d'œil, et Mercure repasse sous le budget), puis R1–R3. R4 seulement si tu
le veux après avoir vu R1–R3.

### H — Les cartes d'horizon

| Phase | Contenu | Fichiers | Fait quand |
|---|---|---|---|
| **H0** | Décisions : la liaison réutilisée (§2.5), la résolution par corps, la portée D de la marche, l'encodage (rgba8 sinus −0,25…0,75 ou rgba16float). Vues de référence figées pour trace-ab : Mercure ciné Soleil 15°, Lune au terminateur depuis l'orbite (500 km), Lune au télescope depuis la Terre (premier quartier), Mars au sol au couchant, Cérès ciné, pôle sud lunaire. Mesures « avant » sur le mini (A/A ±1 %, machine froide) | `docs/progress/refraction-horizons/H0.md` | Mesures et décisions écrites |
| **H1** | La cuisson GPU : `src/system/horizon-maps.ts` + `src/shaders/horizon.wgsl`. Entrée `hdRelief` ; par texel × 8 azimuts, le grand cercle de D à ~0,1 R (×1,25, la mip de `hdRelief` selon la distance, courbure exacte), l'élévation maximale. Sortie : `texture_2d_array` 2 couches, mips moyennées. Étalée en tranches sur ~16–32 images à chaque changement de corps HD ; « prête » signalée au renderer. Unitaires : sphère nue → horizon plat, un bloc de 8 km vu à la bonne élévation (comme leur `FarHorizonMapSeesABlockAndNotTheSphere`), un pôle | `horizon-maps.ts`, `horizon.wgsl`, `hd-maps.ts` (le déclencheur), `tests/horizon-maps.test.ts` | Cartes cuites pour Lune, Mars, Mercure, Cérès ; tests verts |
| **H2** | Vue de loin : `horizonSeen(k, q, Ls)` (2 lectures, azimut interpolé, smoothstep sur le rayon angulaire du Soleil vu du corps) multiplié dans `planetShade` (rs) et `otherGround` (Mars). Bit de variante `HAS_HORIZON` (sa place à trouver en H0 : les bits 0–15 sont pris, 16 et au-delà servent à la vue de coût, au tune, à `NEAR_KIND` et au raster ; ou le lier à `NEAR_KIND` des mondes sans air et de Mars), allumé seulement si le corps HD est à l'écran et que sa carte est prête | `trace.wgsl`, `tracer-kernels.ts`, `renderer.ts` | Captures avant/après du terminateur ; trace-ab : Terre et vues sans corps HD inchangées (±1 %) |
| **H3** | Vue proche : `nearShadow` hybride — (1) carte au-dessus du Soleil + marge → 0 sans marche ; (2) Soleil au-dessus de la carte et de la pente procédurale maximale → 1 sans marche ; (3) sinon marche jusqu'à D puis min avec la carte. La portée effective passe de 20 km à la carte entière | `trace.wgsl nearShadow`, `bodyLite*` | Mercure ciné < 40 ms (budget Terre) ; images avant/après identiques hors ombres lointaines nouvelles et pénombres (≤ 1–2 % des pixels) |
| **H4** | Mesures et doc : trace-ab sur les vues H0 (gain/coût par vue), e2e en raster (vue cockpit, captures loggées), planche avant/après, docs FR + EN, TARS si utile (`set_settings`) | `docs/progress/refraction-horizons/H4.md`, AAA-PROGRESS | Tableau des coûts, planche, poussé |

### R — La réfraction

| Phase | Contenu | Fichiers | Fait quand |
|---|---|---|---|
| **R0** | Vues de référence figées : Biarritz 21/06/2026 Soleil à 0,5°/2° au télé, coucher depuis l'ISS, Lune éclipsée 07/09/2025, Andes au couchant (le bench C3). Captures et trace-ab « avant » | `docs/progress/refraction-horizons/R0.md` | Références prises |
| **R1** | Le modèle CPU en couches : `src/system/refraction-layered.ts` — USSA76 en 7 couches, N₀ d'Edlén (2,778·10⁻⁴ à 15 °C, 550 nm) mis à l'échelle par la température **et la pression** de la météo réelle (`openmeteo` les donne), Bouguer + Simpson (s = √(r − r_bas), passage par le périgée vers le bas). Table 2D (hauteur × direction : √μ vers le haut, hauteur tangente vers le bas) construite une fois. `refraction.ts bending/apparentAltitude/refractDirection` lisent la table : **les 5 utilisateurs CPU suivent sans changement d'API**. Le commentaire faux corrigé. Unitaires : Bennett ±3 % de 0 à 45°, aplatissement 0,81–0,83, rasant d'orbite, monotonie, dispersion d'Edlén par canal | `refraction-layered.ts`, `refraction.ts`, `tests/refraction.test.ts` | Tests verts ; TARS « sky » donne les nouvelles valeurs |
| **R2** | Le GPU : `P.refr` (32 vec4 = 128 échantillons) interpolé chaque image pour la hauteur de la caméra ; `airBend` lit la table (même paramétrage) ; `REFR_DELTA` et l'inverse des étoiles inchangés. `earthRingLight` prend la courbure rasante de la table (hors de l'air) au lieu de « C3 doublé » | `trace.wgsl airBend`, `earthRingLight`, `renderer.ts` (la place dans `P`, `refractionParams`) | trace-ab neutre (±1 %) ; Soleil couchant 0,82 au télé ; vignette et prédiction CPU d'accord |
| **R3** | Le Soleil d'éclairage réfracté : la direction de la lumière du sol (`P.near4`, la carte d'ombre du Soleil, nuages, arbres, bâtiments) élevée de la courbure à la hauteur de l'œil, sous un seuil d'élévation. Coût nul | `renderer.ts`, `terrain-raster.ts` (encodeSunShadow) | Au couchant de Biarritz, le sol éclairé jusqu'à la disparition du disque ; aucune ombre décalée |
| **R4** *(optionnel)* | La réfraction terrestre : une fonction WGSL partagée `refrLift(d)` = k·d²/2R (k de la table) appliquée au dessin dans tous les rasters de la Terre, le test de `earthMarch` décalé d'autant, l'ombrage qui reconstruit le point vrai ; CPU, collisions et WGS84 intouchés ; réglage à part | `terrain-raster*.ts`, `scenery-raster.ts`, `forest-shader.ts`, `runways3d.ts`, `roof-mesh.ts`, `trace.wgsl` | Les Alpes depuis 300 km relevées de ~10′, aucune couture ni arbre flottant (e2e dédiés) |

### Estimations

| Phase | Effort | Risque | Gain qualité | Effet perf |
|---|---|---|---|---|
| H1 | 1 j | moyen (cuisson, pôles) | — | ~2–4 ms/image pendant ~0,5 s à l'arrivée d'un corps |
| H2 | ½ j | faible | **fort** (terminateur de loin) | ≈ 0 (bit de variante) |
| H3 | 1 j | moyen (raccord marche/carte) | moyen (portée 20 → ~200 km) | **−3 à −6 ms** Mercure ciné ; ~0 ms d'ombres au Soleil haut |
| H4 | ½ j | — | — | — |
| R1 | ½ j | faible | moyen (prédictions CPU, TARS) | 0 |
| R2 | ½ j | faible | moyen au télé (forme et hauteur du disque, Lune éclipsée) | ≈ 0 |
| R3 | ¼ j | faible | moyen au grand angle (2–3 min de lumière rasante) | 0 |
| R4 | 1½–2 j | **élevé** (6 chemins de dessin) | moyen (sol lointain, horizon d'avion) | ≈ 0 |

### Règles de livraison (habituelles)

- Seul sur `main`, **un commit + push + capture par phase**, réponses en français, docs FR + EN.
- `bunx biome ci .` avant chaque push.
- Mesures en trace-ab sur vues figées (A/A ±1 %), machine froide (outil thermique d'abord), onglets du panneau fermés.
- e2e et A/B en raster, vue cockpit, partagés entre ce Mac et le mini.
- WGS84 : R3 et R4 touchent au dessin seulement, jamais aux positions, hauteurs ou contacts.

## 4. Questions ouvertes (H0)

1. Ordre : H avant R (conseillé), ou R d'abord ?
2. R4 (la réfraction terrestre) dans ce plan, ou plus tard ?
3. Les mirages de vr-solar-system : un plan à part plus tard ?
4. Résolution des cartes : demi-DEM (22 Mo Lune/Mars) ou quart (5,5 Mo, horizons plus doux) ?
