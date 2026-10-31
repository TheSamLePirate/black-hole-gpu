# Plan — la bonne réfraction, et les cartes d'horizon du relief

Date : **31 octobre 2026**, sur `main` à `06ed0498`. Statut : **analyse et plan, rien d'implémenté**. Volet réfraction **revu le 31 octobre** après les changements
d'Alex (vr-solar-system 4h, 4i, `b2f5e51` : le limbe vu d'orbite, le sol relevé, Mars/Vénus/Titan) — §1.5 et le
tableau R réécrit. **Deuxième passe le 31 octobre** (code relu des deux côtés, réponse du Claude d'Alex) : §1.1, §1.5, §2.1–§2.5, H1b ajouté, R0–R2 et R6 corrigés.

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
  N₀ = 2,93·10⁻⁴ × 288,15 / (273,15 + T) : **la température seule** (`renderer.ts refractivity`, la météo réelle
  ou 15 °C), qui met à l'échelle toute la colonne. **La pression n'est pas utilisée**, bien que PLAN-CIEL C1 la
  décode « pour la réfraction ». Le CPU n'envoie les constantes (`P.sky`) que lorsque la Terre est le corps proche.
- **Utilisateurs GPU** : `airBend` (le ciel au-delà de l'air, `REFR_DELTA` pour le rayon vert, C4), `shadeStars`
  (l'inverse, 3 points fixes), `earthRingLight` (la Lune éclipsée). Ce dernier a son propre modèle,
  α(h) = 0,0205 · e^(−h / 8,4 km) (70,5′ au ras du sol, « C3 doublé »), résolu en h par 3 pas de Newton. Comparé
  aux couches : 38,9′ contre 46,3′ à 5 km (−16 %), 21,3′ contre 26,4′ à 10 km (−19 %). Avec plus de courbure, un
  rayon donné passe plus haut, dans un air plus clair : l'ombre serait **plus claire et moins rouge au cœur**. Effet à
  vérifier contre l'échelle de Danjon.
- **Utilisateurs CPU** : `skychart.ts`, `photo/plans.ts` (heures de coucher, cadrages ; **toujours à h = 0**),
  `sky-now.ts` (TARS), `targeting.ts` et `controller/rig.ts` (`refractDirection` : viser ce qu'on voit). Ils
  demandent des hauteurs différentes de celle de la caméra : le CPU a besoin de tables à toute hauteur, pas seulement
  à celle de l'œil.
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
  multiples) : **R6** (ajouté le 31 octobre). Le coût n'est pas au GPU (le shader lit les mêmes tables, tracées dans un
  autre profil) mais au CPU (RK4 à travers les points de retournement, dans un worker) et dans le profil à déduire de
  la météo réelle. Notre traceur y est mieux placé qu'un raster : un rayon par pixel, les images multiples viennent
  seules.

### 1.5 Ce que vr-solar-system a poussé depuis (4h, 4i, `b2f5e51`) et ce qu'on en reprend

Lu dans `~/Documents/DEV/vr-solar-system` : `Sim/RefractiveAir.cs`, `Sim/AtmosphericRefraction.cs` (`LimbBending`,
`Landing`, `BuildAbove`, `TerrestrialK`, `Table`), `Runtime/RefractionTables.cs`, `Shaders/VRSolarCommon.hlsl`
(`GroundLift`), rapports `_06` et `_07`. Mesuré par eux sur Quest 3 : orbite +0,08 ms, sol 0, 72 fps.

- **Des tables séparées au lieu d'une 2D** (remplace notre R2 initial : une table hauteur × direction de 128
  échantillons). *Corrigé le 31 octobre d'après la réponse de leur Claude*
  (`vr-solar-system/docs/agent/reponse-premier-contact-refraction_2026-10-31-03-45-08.md`) :
  - **La table du limbe** : un rayon venu d'au-dessus de l'air ne se courbe que selon son paramètre d'impact
    k = n·r·cos e. **Une table par air et par couleur** (512 hauteurs de périgée, 2 × Simpson 200 chacune), faite une
    fois (26 ms sur Quest, dans un worker). Pour la Terre, leur k est décalé de (6 378,137 − 6 371) km : table faite au
    rayon moyen, sphère dessinée au rayon équatorial.
  - **Eux, au GPU, lisent une bande par élévation**, pas k par pixel. Au-dessus de l'air, une table pour la hauteur
    de l'œil (128 lignes + bande de 1 024 rayons ajustée à la zone qui réfracte, 0,15′ par rayon à 400 km) est
    **remplie au CPU par lectures de `LimbBending(k)`**. Elle est refaite quand le limbe bouge d'un quart de pas
    (~26 m à 400 km, ~200 m à 50 000 km), sans allocation. Ils en gardent deux : le casque et une vue d'observation.
  - **Dans l'air** (œil sous 86 km) : une table par **bande de 2 % de hauteur** (log, échelle de 5 m : ~490 bandes de
    0 à 86 km), faite seulement pour les hauteurs visitées et gardée dans un dictionnaire. Un worker en fait une à la
    fois (~40 ms par couleur sur Quest, 80–150 ms pour trois) ; la plus proche sert en attendant. Chaque table :
    128 lignes par élévation apparente et vraie (u²), bande d'horizon de 1 024 rayons, relèvement du sol par distance
    (256).
  - **Notre option, propre à un traceur : k par pixel au-dessus de l'air.** Le traceur connaît le rayon de l'œil :
    plus aucune table par hauteur en orbite. Mais leurs nœuds sont inégalement espacés (resserrés par couche) : il
    faut soit une recherche dichotomique (9 pas sur 512), soit **la table rééchantillonnée en k régulier** (leur Claude
    propose 2 048 valeurs par couleur, coude de la tropopause à quelques secondes d'arc près — à vérifier en R1).
    Dans l'air, k ne suffit pas (le rayon dépend de la hauteur de l'œil) : on garde leur schéma, une table par bande
    de hauteur.
  - **Les coudes des couches** : chaque frontière (11, 20, 32, 47, 51, 71 km) coude la courbure en fonction de la
    hauteur de périgée ; à pas réguliers (168 m) la tropopause était fausse de 20″. Points **resserrés vers le haut de
    chaque couche** (autant par couche) : < 3″ partout. À reprendre tel quel.
- **L'ellipsoïde** : leur réfraction se fait dans WGS84 étiré en sphère le long du pôle (le repère où leurs shaders
  d'air travaillent déjà). Une sphère décalait la zone réfractée jusqu'à 10′ du limbe dessiné près des pôles.
  **Chez nous, c'est à moitié fait** (vérifié dans le code le 31 octobre) : `EARTH_RM` vaut `WGS84_A` (le rayon
  équatorial, pas le moyen), `nearCam()` est déjà dans le repère aplati, donc la verticale de `airBend`
  (`normalize(nearCam())`) est celle de la sphère étirée. Mais :
  - **au sol**, cette verticale est la direction « paramétrique », pas la normale géodésique (`geoQ`) : jusqu'à
    **~5,8′ d'écart à 45° de latitude**, dans le plan nord-sud. Près de l'horizon, ça fausse la courbure d'environ
    1′ selon l'azimut, autant que l'erreur du modèle qu'on corrige ;
  - **la direction du rayon** (`toBody(look)`) n'est pas aplatie (`squashed`), contrairement à `earthNear` : en
    orbite, la zone du limbe n'est pas tout à fait dans le repère du globe dessiné.

  À corriger en R2 : `geoQ` comme verticale au sol, le rayon aplati au-dessus de l'air.
- **Le sol relevé vu d'orbite** (le « trou » au limbe) : un rayon venu d'en haut, courbé, va plus loin autour de la
  planète ; le rayon rasant atterrit 56 km au-delà du limbe géométrique (0,5°), le sol y est vu 3,0′ plus haut ; à
  400 km le globe dessiné s'arrêtait 2,4–2,7′ sous le Soleil réfracté. Leur table « où atterrissent les rayons »
  (128 élévations, une fois par air) devient, par hauteur d'œil, un relèvement par distance. **Notre R4 s'étend donc
  à l'orbite** ; dans le traceur, ce n'est qu'un décalage du test de hauteur à l'intersection du globe (pas de rayon
  courbe à marcher).
- **Le k terrestre** (`TerrestrialK`) : choisi pour que la dépression de l'horizon dessiné (rayons droits sur une Terre
  aplatie de 1 − k) égale celle de l'horizon réfracté — l'horizon dessiné tombe là où finit la réfraction du ciel
  (~0,17 au niveau de la mer, 0,16 à 1,2 km) ; près de la mer, le gradient de l'air. À reprendre pour R4.
- **Le coût tenu** : un test de zone par pixel (un produit scalaire) saute tout ce qui est hors de la bande du limbe
  (+0,38 → +0,08 ms en orbite) ; le relèvement laissé de côté là où il fait < 0,1′ (`LiftFrom` : tout le disque sauf
  un anneau au limbe).
- **Une atmosphère par corps** (`RefractiveAir` : couches hydrostatiques à gradient constant, n − 1 du gaz en
  laboratoire mis à l'échelle de la densité) : la Terre (USSA76, mêmes chiffres), **Vénus** au-dessus du pont nuageux
  (VIRA dès 70 km, 5,6′ rasant : vu de quatre rayons, le Soleil caché derrière la planète reste un arc sur son limbe —
  l'auréole des transits), **Titan** (Huygens, 1,47 bar : 2° rasant, caché par la brume là où il compte), **Mars**
  (0,5′ : invisible). Chez nous, l'auréole de Vénus au transit (notre calculateur les prévoit, `eclipse/search.ts`
  `transit`) serait un vrai plus.
- **Ce qu'on a et pas eux** : la météo réelle — N₀ à l'échelle de la température **et** de la pression du lieu. Leurs
  profils de mirage et conduits (3n–3o) : repris et tirés de la météo en R6.
- **Leurs limites, à garder en tête** : rien au-delà de 50 000 km (zone < 5′, précision GPU près du nadir) ; pas de
  scintillation au limbe ; Mars/Vénus/Titan d'orbite seulement (pas depuis leur sol : l'horizon de Titan relevé de ~1°).

---

## 2. Analyse — les cartes d'horizon (planètes rocheuses)

### 2.1 L'existant

- **Vue de loin** (`trace.wgsl planetShade` pour les mondes sans air, `otherGround` pour Mars) : la carte HD incline
  la normale (`hdNormal` → `demNormal`), **aucune ombre portée**. Au terminateur, la Lune vue de la Terre ou de
  l'orbite a des cratères éclairés par leur normale seule : plats, sans les longues ombres qui font le terminateur.
- **Mais les cartes HD ne se chargent que pour le corps proche** (vérifié dans `renderer.ts` ~l.3140). La condition
  est `nearMap && dN < hdAt`, où `dN` est la distance au corps proche en ses rayons et
  `hdAt = 1 + 1,3·(2π/4096)/pixelAngle`. Une exception (`pin`) garde les cartes du corps où est posé le vaisseau.
  **Depuis la Terre, le corps proche est la Terre** : la Lune n'a jamais ses cartes HD, même au télescope. Elle est
  alors ombrée par sa carte grossière seule, sans `hdNormal`. **La vue phare annoncée (la Lune au télescope depuis la
  Terre) ne profiterait donc pas de H2 tel quel.** Il faut d'abord H1b (§3).
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
- **Leur raccord** (précisé par leur Claude) : un patch fin (espacement ≤ max(2 km, texel de la carte)) a ses propres
  horizons par sommet en trois portées (proche ≤ 8 espacements, moyenne 8–64, lointaine 64 espacements → 60 km) ;
  un patch grossier lit la carte, qui part d'un texel. Les deux ne se rencontrent jamais sur un même sommet : pas de
  double ombre, mais **pas de fondu non plus**. Un patch fin à côté d'un grossier peut montrer une marche au bord
  d'une ombre (non testé, sur leur liste). Lue par pixel jusqu'à leur session 4a (0,5 ms au point Lune de leur
  propriétaire), la carte est lue par sommet depuis. **Mip choisie selon l'empreinte** : distance × 1/22° / rayon, plus
  aux vues rasantes. À reprendre pour notre lecture par pixel.

### 2.3 Gain en qualité

- **De loin (le plus gros gain)** : les ombres du relief au terminateur de la Lune, de Mercure, de Mars et de Cérès,
  en orbite ou en approche du corps. **Vues de la Terre** (télescope, trépied, photo) : seulement avec H1b, puisque la
  Lune n'y a pas ses cartes HD. H1b y apporte en même temps son relief (`hdNormal`), absent aujourd'hui. Copernic, les Apennins, les remparts des
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
  à sa place. À trancher en H0. Vérifié : la mise en page du noyau est explicite (`renderer.ts traceLayout`) ;
  la liaison 29 (`surfaceColour`) n'y figure que si `maxSampledTexturesPerShaderStage ≥ 18` (`SURFACE_TEXTURE_LIMIT`).
  En dessous, pas de cartes d'horizon : on garde les marches. Le groupe de liaisons est à refaire quand le corps HD
  change. **Avec H1b**, la Lune est HD alors que la Terre est le corps proche : la liaison 29 sert alors à la
  surface régionale de la Terre et ne peut pas porter les horizons de la Lune. Il faut une autre place (une couche de
  plus dans `mapHi`, ou une liaison libérée), à trancher en H0.
- **Un conflit en cours** : `planetShade`, où H2 s'insère, porte en ce moment des changements non commités d'une autre
  session (`TUNE_SAT`, « TEMP Saturn measure »). Attendre qu'ils soient commités ou retirés avant H2.
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
H d'abord** (gain visible au premier coup d'œil, et Mercure repasse sous le budget), puis R1–R3. R4 et R5 seulement si tu
le veux après avoir vu R1–R3 ; R6 (les mirages) après R2, indépendant de R3–R5. H0 et R0 tranchent ensemble la liaison des tables (une seule si possible).

### H — Les cartes d'horizon

| Phase | Contenu | Fichiers | Fait quand |
|---|---|---|---|
| **H0** | Décisions : la liaison réutilisée (§2.5), la résolution par corps, la portée D de la marche, l'encodage (rgba8 sinus −0,25…0,75 ou rgba16float). Vues de référence figées pour trace-ab : Mercure ciné Soleil 15°, Lune au terminateur depuis l'orbite (500 km), Lune au télescope depuis la Terre (premier quartier : la vue « avant » montre l'absence de relief HD, voir H1b), Mars au sol au couchant, Cérès ciné, pôle sud lunaire. Mesures « avant » sur le mini (A/A ±1 %, machine froide) | `docs/progress/refraction-horizons/H0.md` | Mesures et décisions écrites |
| **H1** | La cuisson GPU : `src/system/horizon-maps.ts` + `src/shaders/horizon.wgsl`. Entrée `hdRelief` ; par texel × 8 azimuts, le grand cercle de D à ~0,1 R (×1,25, la mip de `hdRelief` selon la distance, courbure exacte), l'élévation maximale. Sortie : `texture_2d_array` 2 couches, mips moyennées. Étalée en tranches sur ~16–32 images à chaque changement de corps HD ; « prête » signalée au renderer. Unitaires : sphère nue → horizon plat, un bloc de 8 km vu à la bonne élévation (comme leur `FarHorizonMapSeesABlockAndNotTheSphere`), un pôle | `horizon-maps.ts`, `horizon.wgsl`, `hd-maps.ts` (le déclencheur), `tests/horizon-maps.test.ts` | Cartes cuites pour Lune, Mars, Mercure, Cérès ; tests verts |
| **H1b** | **Le corps HD selon ce qu'on regarde**, plus seulement le corps proche. Quand le corps proche n'a pas de jeu HD (la Terre) et qu'un corps en a un (Lune, Mars, Mercure, Cérès) et dépasse le seuil `hdAt` à l'écran (télescope, trépied, photo, téléobjectif), charger **son relief seul** (DEM + cartes d'horizon, sans la carte couleur 8K : environ 32 + 22 Mo pour la Lune), puis le libérer comme aujourd'hui. Trouver une place de liaison pour ses horizons qui ne soit pas la 29, prise par la surface régionale de la Terre (§2.5). À vérifier : `planetAlbedo` lit-il `hdColor` dès que `isHd` ? Si oui, il faut un drapeau « relief seul » qui garde la carte grossière pour la couleur | `renderer.ts` (`requestHd`/`releaseHd`, la règle ~l.3140), `hd-maps.ts` (chargement du relief seul) | La Lune au télescope depuis Paris : relief HD et ombres du terminateur ; mémoire et à-coups mesurés au chargement |
| **H2** | Vue de loin : `horizonSeen(k, q, Ls)` (2 lectures, azimut interpolé, smoothstep sur le rayon angulaire du Soleil vu du corps) multiplié dans `planetShade` (rs) et `otherGround` (Mars). Bit de variante `HAS_HORIZON` (sa place à trouver en H0 : les bits 0–15 sont pris, 16 et au-delà servent à la vue de coût, au tune, à `NEAR_KIND` et au raster ; ou le lier à `NEAR_KIND` des mondes sans air et de Mars), allumé seulement si le corps HD est à l'écran et que sa carte est prête | `trace.wgsl`, `tracer-kernels.ts`, `renderer.ts` | Captures avant/après du terminateur ; trace-ab : Terre et vues sans corps HD inchangées (±1 %) |
| **H3** | Vue proche : `nearShadow` hybride — (1) carte au-dessus du Soleil + marge → 0 sans marche ; (2) Soleil au-dessus de la carte et de la pente procédurale maximale → 1 sans marche ; (3) sinon marche jusqu'à D puis min avec la carte. La portée effective passe de 20 km à la carte entière | `trace.wgsl nearShadow`, `bodyLite*` | Mercure ciné < 40 ms (budget Terre) ; images avant/après identiques hors ombres lointaines nouvelles et pénombres (≤ 1–2 % des pixels) |
| **H4** | Mesures et doc : trace-ab sur les vues H0 (gain/coût par vue), e2e en raster (vue cockpit, captures loggées), planche avant/après, docs FR + EN, TARS si utile (`set_settings`) | `docs/progress/refraction-horizons/H4.md`, AAA-PROGRESS | Tableau des coûts, planche, poussé |

### R — La réfraction

| Phase | Contenu | Fichiers | Fait quand |
|---|---|---|---|
| **R0** | Vues de référence figées : Biarritz 21/06/2026 Soleil à 0,5°/2° au télé, coucher depuis l'ISS (400 km, à l'équateur **et** au-dessus de 70° N : l'ellipsoïde), Lune éclipsée 07/09/2025, Andes au couchant (le bench C3). Captures et trace-ab « avant ». **Décider la place des tables au GPU** : ~1 150 valeurs dans l'air + 3 × 512 au-dessus — trop pour `P`, qui serait réécrit à chaque image. Piste vérifiée : **les ajouter à la fin du buffer `catalogue`**. Il est en lecture seule, déjà lié à tous les noyaux, et `shadeStars` le lit. Aucune liaison de plus ; on écrit seulement la partie qui change (`writeBuffer`) quand la bande de hauteur ou la météo change | `docs/progress/refraction-horizons/R0.md` | Références prises, liaison choisie |
| **R1** | Le modèle CPU : `src/system/refraction-air.ts` — **une atmosphère par corps** (couches hydrostatiques à gradient constant ; Terre USSA76, Vénus VIRA au-dessus du pont, Titan Huygens ; Mars inutile), N₀ d'Edlén (2,778·10⁻⁴ à 15 °C, 550 nm) et sur la Terre **mis à l'échelle par la température et la pression de la météo réelle** (la pression n'est pas utilisée aujourd'hui : `renderer.ts refractivity` ne prend que T). Réponse à donner à leur Claude : sur toute la colonne, ou seulement la couche basse ? `refraction-layered.ts` : Bouguer + Simpson (s = √(r − r_bas)) ; **la table du limbe** par paramètre d'impact (512 périgées **resserrés vers le haut de chaque couche**, × 3 couleurs, une fois par air, dans un worker) ; **la table « où atterrissent les rayons »** (128 élévations en u², une fois par air) ; **les tables dans l'air par bande de 2 % de hauteur** (leur schéma : 128 lignes en u², bande d'horizon de 1 024 rayons, relèvement par distance 256 ; faites à la demande dans un worker, gardées en cache, la plus proche servant en attendant). Le cache sert aussi **les utilisateurs CPU à d'autres hauteurs** que la caméra (`photo/plans.ts` à h = 0) ; **au-dessus de l'air, la table du limbe rééchantillonnée en k régulier** (2 048 valeurs par couleur, à vérifier contre l'intégrale aux coudes) ; `TerrestrialK` (l'horizon dessiné = la fin de la réfraction du ciel). `refraction.ts bending/apparentAltitude/refractDirection` lisent ces tables : **les 5 utilisateurs CPU suivent sans changement d'API**. Le commentaire faux corrigé. Unitaires : Bennett ±3 % de 0 à 45°, aplatissement 0,81–0,83, limbe d'orbite contre l'intégrale (≤ 3″ aux coudes), atterrissage (rasant 0,5° au-delà du limbe à 400 km), monotonie, dispersion d'Edlén, Vénus 5,6′ rasant | `refraction-air.ts`, `refraction-layered.ts`, `refraction.ts`, `tests/refraction.test.ts` | Tests verts ; TARS « sky » donne les nouvelles valeurs ; nos chiffres d'accord avec les leurs (66′ rasant, 5,57′ à 20 km depuis 400 km) |
| **R2** | Le GPU, la Terre : `airBend` : **au sol, la verticale géodésique `geoQ`** (au lieu de la verticale paramétrique de `normalize(nearCam())`, jusqu'à 5,8′ d'écart) ; **au-dessus de l'air, le rayon aplati** (`squashed`, comme `earthNear`) et **k par pixel** dans la table du limbe rééchantillonnée (aucune table par hauteur en orbite, contrairement à eux) ; dans l'air, la table de la bande de hauteur de l'œil (lignes + bande) ; **test de zone** d'abord (hors de la bande du limbe : rien). `REFR_DELTA` (rayon vert) lu dans les tables par couleur ; l'inverse des étoiles inchangé dans son principe. `earthRingLight` (la Lune éclipsée) prend la table du limbe par hauteur de périgée, avec sa dérivée pour le Newton, au lieu de son exponentielle (−16 à −19 % entre 5 et 10 km). Vérifier l'ombre contre Danjon sur l'éclipse du 07/09/2025 : elle sera plus claire au cœur | `trace.wgsl airBend`, `shadeStars`, `earthRingLight`, `renderer.ts` (`refractionParams`, l'envoi des tables) | trace-ab neutre (±1 %) au sol et en orbite ; Soleil couchant 0,82 au télé ; coucher de l'ISS écrasé ~1/5 en bas, posé sur le limbe à 70° N comme à l'équateur ; vignette et prédiction CPU d'accord |
| **R3** | Le Soleil d'éclairage réfracté : la direction de la lumière du sol (`P.near4`, la carte d'ombre du Soleil, nuages, arbres, bâtiments) élevée de la courbure à la hauteur de l'œil, sous un seuil d'élévation. Coût nul | `renderer.ts`, `terrain-raster.ts` (encodeSunShadow) | Au couchant de Biarritz, le sol éclairé jusqu'à la disparition du disque ; aucune ombre décalée |
| **R4** *(optionnel)* | Le sol relevé par la réfraction, **près du sol et vu d'orbite** : une fonction WGSL partagée `refrLift(d)` lisant le relèvement par distance de la table de l'œil (k terrestre dans l'air ; l'atterrissage des rayons au-dessus), **laissée de côté sous 0,1′** ; appliquée au dessin dans tous les rasters de la Terre, au test de hauteur du globe tracé (`earthMarch`, l'intersection d'orbite) et aux nuages ; l'ombrage reconstruit le point vrai ; CPU, collisions et WGS84 intouchés ; réglage à part | `terrain-raster*.ts`, `scenery-raster.ts`, `forest-shader.ts`, `runways3d.ts`, `roof-mesh.ts`, `trace.wgsl` | Les Alpes depuis 300 km relevées de ~10′ ; d'orbite, plus de trou entre le Soleil réfracté et le globe ; aucune couture ni arbre flottant (e2e dédiés) |
| **R5** *(optionnel)* | Vénus et Titan d'orbite : `airBend` pour le corps proche qui a une table (la Terre seule aujourd'hui, `isEarth`) ; l'auréole de Vénus vérifiée au transit du 11/12/2117 (ou vue de quatre rayons, le Soleil derrière) ; Titan sous sa brume | `trace.wgsl`, `renderer.ts`, `refraction-air.ts` | L'arc du Soleil sur le limbe de Vénus ; coût nul hors de la bande du limbe |
| **R6** *(après R2)* | **Les mirages tirés de la météo réelle.** (a) Le profil d'air près du sol déduit d'Open-Meteo au lieu et à l'heure du jeu : température à 2 m, du sol, de la mer (API marine), niveaux 1 000/975/950/925 hPa — mer plus chaude que l'air → couche chaude (mirage inférieur) ; air chaud sur mer froide ou inversion aux bas niveaux → couche froide (élévation, mirage supérieur, Fata Morgana) ; inversion forte et mince → conduit ; route ou sable au soleil → couche chaude de quelques mètres ; sinon l'atmosphère standard. Un tirage plausible hors de portée (comme la météo), un forçage dans les réglages et pour TARS. (b) Les tables de l'œil tracées dans ce profil en RK4 (r, θ, e) à travers les points de retournement (leur `Trace`, 3n), dans un worker ; refaites quand la hauteur ou le profil bougent assez, **seulement sous ~2 km** (au-dessus, R1–R2 seuls). (c) Au GPU, rien de neuf pour le ciel : chaque pixel lit sa vraie direction dans la table, les images multiples (Soleil inversé, « vase étrusque », tranches d'un conduit) viennent seules. Les rayons retournés vers le haut sous l'horizon montrent le ciel (le « lac » sur la mer ou l'asphalte) : dans `shadeLite`, ces pixels du raster remplacés par le ciel de leur direction vraie. (d) Option : le sol lointain inversé ou soulevé (ce qu'Alex n'a pas) — dans la mince bande de l'horizon, la marche du sol le long du rayon courbé à la place du raster. (e) La scintillation par masse d'air et par profil (leur 3o–3q). (f) **L'inverse des étoiles** (`shadeStars` : 3 points fixes sur `airBend`) ne marche plus quand la correspondance n'est pas monotone : utiliser la table par élévation vraie (leur `FromTrue`, l'image droite), les images secondaires d'étoiles ignorées | `refraction-weather.ts`, `refraction-layered.ts` (le traceur RK4), `openmeteo.ts`, `trace.wgsl` (`airBend`, `shadeLite`), réglages, TARS | Côte et date réelles où un mirage est connu (ex. un jour de mer froide et d'air chaud) : le Soleil en « vase étrusque » au télé ; une route chaude à midi ; coût GPU nul hors de la bande de l'horizon, tables dans le worker sans à-coup d'image |

### Estimations

| Phase | Effort | Risque | Gain qualité | Effet perf |
|---|---|---|---|---|
| H1 | 1 j | moyen (cuisson, pôles) | — | ~2–4 ms/image pendant ~0,5 s à l'arrivée d'un corps |
| H1b | ½–1 j | moyen (mémoire, liaison, règle de chargement) | **fort** depuis la Terre (relief et ombres de la Lune au télescope) | chargement unique ; aucun coût par image hors du corps |
| H2 | ½ j | faible | **fort** (terminateur de loin) | ≈ 0 (bit de variante) |
| H3 | 1 j | moyen (raccord marche/carte) | moyen (portée 20 → ~200 km) | **−3 à −6 ms** Mercure ciné ; ~0 ms d'ombres au Soleil haut |
| H4 | ½ j | — | — | — |
| R1 | 1 j | faible (leur méthode, leurs chiffres pour vérifier) | moyen (prédictions CPU, TARS) | 0 ; tables du limbe une fois dans un worker |
| R2 | 1 j | moyen (repère aplati, liaison) | moyen au télé (forme et hauteur du disque, Lune éclipsée) ; fort vu d'orbite (le coucher de l'ISS) | ≈ 0 avec le test de zone (eux : +0,08 ms en orbite) |
| R3 | ¼ j | faible | moyen au grand angle (2–3 min de lumière rasante) | 0 |
| R4 | 2 j | **élevé** (6 chemins de dessin + le globe tracé) | moyen (sol lointain, horizon d'avion, limbe d'orbite) | ≈ 0 (relèvement sauté sous 0,1′) |
| R5 | ½ j | faible | moyen, rare (l'auréole de Vénus) | 0 hors du limbe |
| R6 | 2–3 j (+1 j pour le sol inversé) | moyen (le profil déduit de la météo est la vraie difficulté ; le rendu est le prolongement de R2) | **fort et unique** : des mirages réels au bon lieu et au bon jour | GPU ≈ 0 hors de la bande de l'horizon (eux : 69–72 fps avec chaque profil) ; CPU : 1 024 rayons RK4 par table, dans un worker, sous 2 km |

### Règles de livraison (habituelles)

- Seul sur `main`, **un commit + push + capture par phase**, réponses en français, docs FR + EN.
- `bunx biome ci .` avant chaque push.
- Mesures en trace-ab sur vues figées (A/A ±1 %), machine froide (outil thermique d'abord), onglets du panneau fermés.
- e2e et A/B en raster, vue cockpit, partagés entre ce Mac et le mini.
- WGS84 : R3 et R4 touchent au dessin seulement, jamais aux positions, hauteurs ou contacts.

## 4. Questions ouvertes (H0)

1. Ordre : H avant R (conseillé), ou R d'abord ?
2. R4 (le sol relevé, près du sol et d'orbite) et R5 (Vénus, Titan) dans ce plan, ou plus tard ?
3. ~~Les mirages : un plan à part ?~~ Décidé le 31 octobre : **R6**, dans ce plan, après R2.
5. H1b : charger le relief HD d'un astre regardé depuis la Terre (~55 Mo GPU pour la Lune) — d'accord ?
4. Résolution des cartes : demi-DEM (22 Mo Lune/Mars) ou quart (5,5 Mo, horizons plus doux) ?
