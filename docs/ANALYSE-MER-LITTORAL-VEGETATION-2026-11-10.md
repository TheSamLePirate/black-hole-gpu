# Mer, littoral, végétation : ce que web-ocean et BakedVoxelLighting nous apprennent

**Analyse datée du 10 novembre 2026**, demandée par Sam : « pour les performances, les détails, les graphismes, la mer et
les vagues », étudier à fond [BakedVoxelLighting](https://github.com/SamG-Coder/BakedVoxelLighting) (SamG-Coder, MIT) et
[web-ocean](https://github.com/Noniv/web-ocean) (Maksymilian Dendura, MIT), et en tirer ce qui donnerait leur qualité et
leurs performances à notre projet. Le code fait foi ; les deux projets ont été lus en entier (clones en lecture seule, rien
de leur outillage exécuté), web-ocean a aussi été **mesuré** sur nos deux machines. Aucune ligne de leur code n'est reprise
à ce jour ; aucune dépendance n'est ajoutée.

**Suite (relevé le 12 novembre ; l'analyse reste datée du 10)** : les reprises de la mer M1–M5 (§5.2) sont devenues les lots
S0–S6 de [PLAN-MER-WEBGPU](PLAN-MER-WEBGPU.md), plus tôt que prévu ici : M1 → S1 (fait), **M5, la surface déplacée → S2, faite
le 10 novembre** (CDLOD courbe, +4,3 ms à 2,4 m sur kerr-mini ; crêtes devant la terre ensuite) — et non à J4 comme l'écrivent le
tableau §5.2 et le §7 —, M3 l'écume en cartes monde → S4 (fait), M2 l'ombrage → S3 (en partie : l'aspect de l'écume à juger
par Sam), M4 la sonde/le cube du ciel → S5 (en partie). Ce qui reste à J4 : la houle côtière hors du noyau de l'eau (+2 à 2,6 ms).

**Ce qui est mesuré** (10 novembre, 1920 × 1080) : web-ocean sur ce M1 Max et sur kerr-mini ; notre mer dans les mêmes vues
sur kerr-mini (§2.3) : **2,6 à 2,8 fois plus chère, nettement moins belle**. **Ce qui ne l'est pas** : tout coût de BakedVoxelLighting (il ne publie aucun temps GPU de sa mer ni de
son terrain, et n'a pas été lancé chez nous) ; tout gain des techniques proposées chez nous — ce sont des propositions,
chacune avec sa mesure de preuve (§7).

## 1. En bref

- **web-ocean est la meilleure référence de mer au large** que nous ayons vue en WebGPU : six cascades FFT à bandes
  disjointes, une vraie surface déplacée (CDLOD, MSAA 4×), le filtrage des pentes par leurs moments (LEAN, terme croisé
  compris), un reflet du Soleil gaussien anisotrope avec masquage de Smith, une écume persistante en cartes monde centrées
  sur la caméra. **Sa qualité n'est pas gratuite** : toute son image (mer, ciel, nuages, post) coûte 10–13 ms sur ce M1 Max
  et **32,5 ms sur kerr-mini** — le même rapport 2,6 que notre scène J0 entre les deux machines. Il n'a ni côte, ni terre, ni
  courbure. **Dans les mêmes vues, notre image de mer coûte 85–93 ms sur le mini (2,6–2,8 fois la sienne)** pour une
  qualité nettement moindre (§2.3).
- **BakedVoxelLighting est une mine pour le littoral et la végétation** d'une carte fixe de 4 km : un champ de houle
  physique précalculé (réfraction par l'eikonale, levée, déferlement, jet de rive de Stockdon, sable mouillé qui sèche),
  des imposteurs ré-éclairables à mips qui conservent la couverture, et surtout **des tuiles de couvert vues du dessus fondues
  dans le terrain**, qui donnent un sol continu de 45 m à plusieurs km. Son éclairage « voxel » (256 m autour de la caméra,
  recuit en 1–6 s) ne tient pas à 140 m/s ; sa carte d'horizons par tuile, si.
- **Chez nous** (état exact au §3) : la mer est un plan plat ombré par pixel (3 cascades, pas de terme croisé, filtrage
  isotrope, écume dans les tuiles FFT qui se répètent) ; la côte n'a ni réfraction de houle, ni jet de rive, ni sable
  mouillé ; la forêt s'arrête à 6,25 km (au-delà, la seule couleur de la photo) et ses arbres sont des formes analytiques
  sans vent ; l'herbe n'existe qu'à moins de 25 m du sol.
- **Ce que nous reprenons**, par ordre de rapport qualité/coût (§5) : (1) les tuiles de couvert et de canopée fondues dans
  le sol, (2) le contrat et le filtrage de la mer de web-ocean (bandes disjointes, LEAN complet, reflet gaussien, écume en
  cartes monde), (3) un champ de houle côtier par tuile publiée, lu par l'eau **et** par le sable, (4) des imposteurs
  ré-éclairables **hémi-octaédriques** pour les arbres de 300 m à 20 km, (5) les horizons de la canopée dans H5, (6) quelques
  règles de streaming qui recoupent ST et CM.
- **Ce que nous ne reprenons pas** : leur moteur (Three.js), le volume voxel centré caméra, les imposteurs à vues
  horizontales seules, le bruit procédural à chaque pixel, une mer plane à y = 0.

## 2. web-ocean

### 2.1 Ce qu'il fait (lu dans `js/wgsl/sim.js`, `ocean.js`, `common.js`, `main.js`)

| Élément | Choix | Où |
|---|---|---|
| Spectre | JONSWAP limité par le fetch + étalement Donelan-Banner ; houle étroite à crêtes longues ; terme capillaire dans la dispersion | `sim.js:51-105` |
| Cascades | **6 × 256²**, 1 103 / 211 / 39,7 / 7,43 / 1,39 / 0,26 m, **bandes de nombres d'onde disjointes** (kMin d'une cascade = kMax de la précédente) ; les deux plus fines atténuées (×0,85, ×0,6) « sinon du papier froissé » | `main.js:39, 427-433` ; `sim.js:107-114` |
| FFT | radix-2 en mémoire de groupe, lignes puis colonnes, toutes les cascades dans une dispatch (z) ; textures rgba16f **déplacement + Jacobien**, **pentes + dérivées**, **moments (sx², sz², sx·sz)** — le terme croisé compris — et leurs mips | `sim.js:130-278` |
| Surface | **maillage CDLOD déplacé** : 17 niveaux, 6,25 cm près de l'œil, 160 km au loin, morphing continu, sélection CPU sans allocation, MSAA 4× | `main.js:309-320, 488-530` ; `ocean.js:63-89` |
| Normales et rugosité | LEAN : covariance = moments − pente² sommés sur les cascades ; rugosité non résolue qui croît de 30 à 500 m ; **anticrénelage spéculaire** par les dérivées écran de la pente | `ocean.js:125-155` |
| Reflet du Soleil | distribution de pentes **gaussienne anisotrope** (la covariance ci-dessus), masquage de Smith, Fresnel, taille du disque solaire | `ocean.js:167-178` |
| Ciel reflété | cube d'environnement **reconstruit une face par image**, mips filtrés par rugosité ; aux angles rasants la normale « visible » est inclinée vers l'observateur | `ocean.js:180-198` ; `main.js:764-775` |
| Corps de l'eau | eau turbide éclairée par l'hémisphère du ciel ; lueur des crêtes à contre-jour | `ocean.js:200-210` |
| Écume | injectée où le **Jacobien total** se replie ; **deux cartes monde toroïdales** (128 m et 1 km, 1024²) centrées sur la caméra, décroissance, dérive sous le vent (advection semi-lagrangienne), stries quand elle vieillit ; texture de bulles procédurale cuite une fois | `sim.js:282-405` ; `ocean.js:212-250` |
| Ciel | Hillaire (transmittance, diffusion multiple, sky-view), deux couches de nuages anticrénelées analytiquement | `sky.js` |
| Post | bloom 8 niveaux, AgX, tramage | `post.js` |
| Hygiène CPU | tableaux préalloués, descripteurs réutilisés : presque rien pour le ramasse-miettes | README |

### 2.2 Mesuré chez nous (10 novembre, 1920 × 1080, sa propre mesure GPU par `timestamp-query`, image entière)

| Machine | Vue basse (2,4 m) | Vue haute (30 m) | Vue rasante | État |
|---|---:|---:|---:|---|
| M1 Max (ce Mac, fenêtre) | 10,0–12,9 ms | 12,0–13,7 ms | 10,2–15,2 ms, une pointe à 32,7 | 1 134 → 865 MHz, « Heavy » au bout de 2 min |
| kerr-mini (M1, plein écran) | 31,5–32,9 ms | 32,7–32,9 ms | — | fréquence stable |

Source : `remote-results/sea-compare/web-ocean-mini.log` et la sonde de ce Mac ; captures `docs/progress/mer-vegetation/`.
**Lecture** : une mer seule, sans terre ni décor, occupe déjà tout le budget de 16,7 ms sur un M1 Max frais et deux fois
le budget sur le mini. Ce n'est pas une mer « bon marché » : c'est une mer **bien filtrée**. Sa leçon est la qualité par
le bon contrat de données (bandes, moments, Jacobien, écume persistante), pas un coût bas.

### 2.3 Notre mer dans les mêmes vues (kerr-mini)

Même machine (kerr-mini, fréquence stable 1 278 MHz), même définition de sortie, caméra libre au large de Hyères
(43,00° N, 6,33° E), Soleil à quelques degrés, profil du joueur (échelle de rendu 0,75), 20 s d'images terminées par vue
(`__bh.viewAt`, sonde `sea-compare`, `remote-results/20261110-141336-sea-compare/`) :

| Vue | Notre image entière (GPU p50 / p95) | images/s | web-ocean, même machine |
|---|---:|---:|---:|
| 30 m, vers le Soleil | **93,2 / 99,3 ms** | 10,7 | 32,8 ms |
| 2,4 m, rasante | **85,0 / 89,6 ms** | 11,7 | — (31,5–32,9 en vue basse) |

**Lecture** : pour une vue de mer, notre image coûte **2,6 à 2,8 fois** celle de web-ocean, à 0,75 de sa résolution et sans
MSAA. La comparaison n'est pas « mer contre mer » — notre image porte aussi l'atmosphère, les nuages, la côte au loin, le
cockpit absent mais ses passes, les noyaux du traceur — ; elle dit ce que coûte **une vue de mer dans notre jeu**. Les
captures (`docs/progress/mer-vegetation/`) montrent l'écart de qualité : chez nous une mer sombre et floue, un reflet du
Soleil en colonne étroite et granuleuse, aucune écume, une traînée bleue d'optique à gauche ; chez lui un reflet large et
filtré, des vagues nettes à toute distance, de l'écume. À vérifier chez nous : des **étoiles visibles** avec le Soleil
au ras de l'horizon.

### 2.4 Ce qui fait sa qualité, et ce qui nous manque

1. **Bandes disjointes sur 6 cascades jusqu'à 26 cm** : de près, les pentes fines existent (le scintillement du Soleil vient
   de là) ; au loin, rien n'est compté deux fois. Nous avons 3 cascades (1 024, 128, 16 m) déjà disjointes, plus une queue
   statistique de Cox-Munk sous 16 m (`src/sea/spectrum.ts:8-15`, `renderer.ts:5245`) : de près, notre surface est lisse
   puis « bruitée » par une rugosité, pas résolue.
2. **LEAN complet** : web-ocean garde sx·sz ; nous stockons sx² et sz² sans le terme croisé (`seafft.wgsl:134-136`) et
   choisissons la mip **isotrope** (`trace.wgsl:9042-9043`) avec un échantillonneur sans anisotropie (`renderer.ts:1247-1253`)
   — d'où le moiré et le pétillement rasant notés au plan T7. web-ocean ajoute la variance de pente **à l'écran**
   (dérivées) : c'est l'anticrénelage spéculaire qui nous manque.
3. **Une vraie surface** : ses crêtes cachent la mer derrière elles, ses vagues bougent la silhouette de l'horizon. La nôtre
   est le maillage du terrain au niveau du géoïde ; les vagues ne changent que la normale (la marche de hauteur
   `seaSurfaceHit` n'existe que dans le traceur, `trace.wgsl:9100-9131`). Vu du cockpit à 2 m, ça se voit ; à 500 m, presque
   pas.
4. **Une écume monde** : notre écume vit dans les tuiles FFT de chaque cascade (`seafft.wgsl:138-145`) — elle se répète
   avec elles et ne dérive pas ; la sienne est attachée au monde, vieillit, dérive et se strie.
5. **Le ciel reflété** : un cube reconstruit une face par image avec mips de rugosité, contre notre empilement ciel
   analytique + sonde du vaisseau (bornée à 4× pour un défaut de nuit) + SSR 20 pas + nuages (`trace.wgsl:9244-9370`). Le
   cube est plus simple, plus stable, et sans le défaut de la sonde.

## 3. Notre état, en face (main à `4c222776`)

Détail et références : rapport de lecture du 10 novembre, résumé ici.

| Domaine | Aujourd'hui | Défauts connus | Coût (kerr-mini, J0) |
|---|---|---|---|
| Mer | FFT 3 cascades + queue Cox-Munk, état de mer Open-Meteo ; surface plane ; `shadeWater`, passe de calcul plein écran qui sort tôt hors de l'eau | moiré et pétillement rasants (mip isotrope), répétition de 1 024 m, SSR sans fondu, sonde de nuit trop claire, eau marquée par une valeur magique dans `moments.x` | `earth water` 12,7 ms + `sea fft` 1,6 ms |
| Côte | masque global + hauteur du maillage + tuiles + polygones OSM ; table de distance à la terre (6,1 et 24 m) ; « lavis » de rive ; bandes de déferlement là où la bathymétrie (~120 m) est sûre | trait de côte en dents de scie qui change au recuit ; pas de réfraction de houle, ni jet de rive, ni sable mouillé ; turquoise des hauts-fonds bloqué faute de bathymétrie côtière | dans `earth water` |
| Arbres | une cellule de 7 m, un arbre au plus, WorldCover + MNH LiDAR IGN, 7 espèces, saisons ; formes analytiques (ellipsoïde/cône), creusées de près par le traceur ; proxys raster ; **jusqu'à 6,25 km, rien au-delà** | pas de vent ; éclairage par heuristique de normale, sans rebond ni occlusion propre ; forêt lointaine = couleur de la photo | décor entier −3,8 ms |
| Herbe | brins GPU jusqu'à 30 m, **seulement à moins de 25 m du sol** ; tapis bas B5 coupé ; scans de détail L8 sur la photo | rien entre 30 m et la photo | non mesurée proprement |
| Lumière | Soleil : 2 cascades de terrain, carte d'ombre arbres/bâtiments ±900 m, H5 (8 directions), ombres de contact ; ciel plat × normale ; rebond grossier ; GTAO et ciel des vallées coupés | les arbres n'ont ni rebond ni occlusion ; les photos gardent leurs ombres | — |

## 4. BakedVoxelLighting

### 4.1 Le littoral physique (`src/ocean/shore-field.js`, `shore-waves.js`, `ocean.js`, `tsl-materials.js:514-541`)

Un **champ précalculé** sur une grille de 4 m (1 001², ~0,2 s au chargement) donne, en chaque point d'eau : la **phase de la
houle** (réfractée autour des caps : eikonale |∇φ| = k(h) résolue par *fast sweeping*, dispersion de Fenton-McKee), sa
**hauteur** (levée H₀√(cg₀/cg), plafonnée au déferlement min(γh, Miche)), une **fraction de déferlement** et un **masque de
jet de rive** (Stockdon 2006 selon la pente de plage, rempli depuis la mer pour que les creux isolés restent secs). La phase
est stockée en **phaseur unitaire** (cos φ, sin φ) : le filtrage ne mélange jamais « phase » et « pas de vague ». À l'image :
crêtes en cosinus avec resserrement horizontal, **front de déferlement** raide sur 13 % de la longueur d'onde, **lame de rive**
qui monte en 12 % du cycle et redescend, niveau = min(front, sol + film de 6–16 cm) — le trait d'eau est le contour où la
lame rencontre le sable, sans dents de scie ; **écume née de la physique** (sur le front et derrière lui, au bord de la
lame), texture « dentelle » advectée vers la plage ; **sable mouillé** (assombri ×0,5, rugosité 0,1, reflet du ciel) qui
sèche en exp(−t/5 s) et reste humide sous la limite du jet de rive. La géométrie des vagues s'efface entre 70 et 620 m ; au-delà,
l'ombrage seul.

**Limites** (les siennes) : une seule houle, une marée fixe, une carte de 4 km, un champ calculé une fois ; pas de
déferlement plongeant, ni courants, ni diffraction ; **aucun coût mesuré**, et par lecture ~100 lectures de texture et ~13 bruits
par pixel d'eau (l'état de vague évalué 3 fois pour les normales).

### 4.2 La végétation (`vegetation*.js`, `impostors.js`, `plant-*.js`, `grass-*.js`, `merged-*.js`)

- **Arbres** : 12 prototypes (4 espèces × 3 âges) et 3 arbustes, maillages de branches et cartes de feuilles ; L0 < 85 m,
  L1 < 190 m (moins de côtés), L2 < 420 m (branches simplifiées + capture du houppier sur 16 vues), L3 au-delà (capture de
  l'arbre sur 8 vues, fusionnée par grappe dans un worker). Pied des arbres **plié sur le relief** dans le vertex shader.
- **Imposteurs ré-éclairables** (`impostors.js:13-216`) : deux passes de capture — albédo non éclairé, **normale monde** + une
  charge utile (transmission des feuilles, mousse) — puis des mips **qui conservent la couverture** (recherche dichotomique
  du seuil alpha par vue, technique de Castaño) : la forêt lointaine ne s'éclaircit pas. **Vues sur l'azimut seulement**
  (aucune vue d'en haut).
- **Herbe** : 12 types dans un atlas ; < 45 m cartes croisées courbées (une dispatch par tuile de 24 m), < 110 m un plant sur
  trois élargi, < 280 m des imposteurs de **parcelles** (8 vues d'un échantillon de 2,8 m) qui s'affaissent, au-delà **la
  canopée cuite dans le terrain**.
- **Tuiles de couvert** (`vegetation.js:987-1180`, `tsl-materials.js:367-447`) — l'idée la plus utile pour nous : pour chaque
  mélange d'habitat, les vraies cartes d'herbe sont capturées **vues du dessus**, 512² sur 4 m, bouclées sans couture, avec
  leurs mips ; la dernière mip est **la couleur moyenne exacte**. Le terrain applique `couvert × clamp(surface/moyenne, 0,35,
  2,4)` et fond la normale de la canopée : de près le détail, au loin la moyenne — la couleur ne saute pas d'un niveau à
  l'autre.
- **Fondus** en trame d'écran complémentaires (14/26/45 m pour les arbres, 12/30/64 m pour l'herbe) ; **un niveau en attente
  ne prend aucun pixel** : son poids reste au niveau résident.
- **Vent** cohérent dans le monde (onde de ~61 m, rafales lentes, frémissement par instance) ; figé dans les imposteurs.
- **Feuilles fines** : transmission à contre-jour enveloppée, bornée et conservant l'énergie.

### 4.3 L'éclairage cuit (`src/shaders/volume.wgsl`, `lighting.js`, `world-light.js`)

Un volume de 96 × 48 × 96 sur 256 × 64 × 256 m autour de la caméra : occupation (terrain, troncs, proxys d'herbe, de
feuilles, de rochers), transport (12 directions × 20 pas : ciel visible, rebond coloré, normale « courbée »), puis lumière
(rayon solaire de 48 m). Recentré tous les 64 m, recuit en **1,2 à 6,4 s**, mis en cache IndexedDB sous une clé SHA-256 des
entrées **et du source des shaders**. Au bord, il se fond dans un **champ mondial** : 256² + **8 tuiles d'horizons** (relief
seul, et relief + canopée), 24 échantillons jusqu'à ~860 m. Visibilité solaire = **min(raster, voxel)**, pas le produit (pas
de double compte).

### 4.4 Performance et streaming (`gpu-upload-queue.js`, `preparation-queue.js`, `docs/*-performance.md`)

Téléversements par pages de 64 Kio, **1 Mio et 1 ms CPU par image en jeu** (4 Mio et 4 ms au chargement), au plus deux images
en vol bornées par `onSubmittedWorkDone` ; file de préparation à priorités réévaluées avec un tour sur huit pour la plus
ancienne ; budget de compilation de 2 ms par étape (pire intervalle 67 → 33 ms) ; **un niveau reste résident tant que son
remplaçant n'est pas complet** ; Basis/KTX2 → BC7 (58,7 → 14,7 Mo). Leurs mesures sont des intervalles de rAF à 1280 × 720,
matériel non nommé ; leurs auteurs disent les à-coups non éliminés.

## 5. Ce que nous reprenons, comment, et où cela s'inscrit

Chaque reprise est une technique réécrite chez nous sur nos contrats (stratégie §7.4–7.8 : surface finale, matériaux
explicites, `LightingState` partagé ; le monde possède ses données). Rien n'est copié.

### 5.1 Végétation et sol — le gain le plus fort pour un simulateur de vol

| # | Reprise | Chez nous | Coût visé | Preuve |
|---|---|---|---|---|
| **V1** | **Tuiles de couvert et de canopée** par classe (WorldCover, classes IGN, tranches de hauteur MNH) : captures vues du dessus de nos brins d'herbe (4 m) et de nos houppiers (32–64 m, qu'eux n'ont pas), couleur + normale + charge utile, mips à couverture conservée, dernière mip = moyenne ; fondues dans le matériau du sol avec le rapport `surface/moyenne` | lecture dans le matériau du sol (aujourd'hui `shadeLite`, demain l'opaque de J1) ; cuisson une fois par classe, à la publication des tuiles | quelques lectures par pixel ; ≤ 0,5 ms | une forêt texturée et une prairie continues de 30 m à 10 km, **sans saut de couleur** au passage arbres → photo (capture A/B, Q6 en mouvement) ; ΔGPU sur J0 |
| **V2** | **Imposteurs ré-éclairables hémi-octaédriques** (8 × 8 vues sur l'hémisphère, pas l'azimut seul) des arbres de 300 m à ~20 km : albédo, normale monde, transmission ; mips à couverture conservée ; indirect draw par niveau ; fondu en trame complémentaire | remplace les octaèdres analytiques lointains et prolonge la forêt au-delà de 6,25 km (aujourd'hui rien) — c'est F2/F3 de Q4/Q8 et la représentation « moyenne » de la stratégie §7.7 | à mesurer ; la passe de visibilité du décor fait 4,6 ms à Tarifa | les forêts en volume jusqu'à 20–30 km (but de Q4) ; aucune couronne qui pivote vue d'avion |
| **V3** | **Les horizons de la canopée** dans H5 : à côté de l'angle d'horizon du relief, celui du relief + canopée (hauteur MNH ou estimée) | cuisson H5 par tuile publiée, déjà là pour le relief | lecture +1 texture | sous-bois et lisières assombris de façon stable à toute vitesse ; Q4 L2b réessayé sur cette base |
| V4 | **Règles de fondu** : trame complémentaire entre niveaux ; un niveau en attente ne prend aucun pixel | contrat de publication (stratégie §7.6, ST) | 0 | aucun trou ni clignotement au passage d'un niveau (e2e de vol) |
| V5 | **Vent** des arbres et de l'herbe proches, cohérent dans le monde, pied fixe, déformation précédente gardée pour l'historique | F1 de Q4 | ≤ 0,3 ms | pas de glissement des pieds, pas de traînées dans le TAAU |
| V6 | Transmission des feuilles fines bornée et conservant l'énergie ; visibilités corrélées par **min**, pas par produit | L5 de Q4, `LightingState` | ~0 | contre-jour sans halo ; pas de double ombre |

### 5.2 Mer au large

| # | Reprise | Chez nous | Coût visé | Preuve |
|---|---|---|---|---|
| **M1** | **Contrat de la mer** sur le modèle de web-ocean : déplacement + Jacobien, pentes + dérivées, **moments avec le terme croisé**, mips ; 4–5 cascades à bandes disjointes jusqu'au décimètre au lieu de 3 + queue statistique | `src/sea/fft-gpu.ts`, `seafft.wgsl` | `sea fft` aujourd'hui 1,6 ms sur le mini : à garder ≤ 2 ms | reflet du Soleil résolu de près, aucun moiré rasant (T7) |
| **M2** | **Filtrage** : covariance LEAN complète + variance de pente à l'écran (anticrénelage spéculaire) ; mip choisie par l'empreinte **anisotrope** ; reflet gaussien anisotrope avec Smith | `seaShade` (`trace.wgsl`) aujourd'hui, la passe d'eau de J4 demain | ≤ coût actuel | captures rasantes au Soleil bas sans pétillement ; pas de mer « sale » au loin |
| **M3** | **Écume monde** : deux cartes toroïdales (≈ 128 m et 1–2 km) centrées sur la caméra, injection par le Jacobien **total**, décroissance, dérive sous le vent, stries | remplace l'écume dans les tuiles FFT (qui se répète) | 2 dispatch 1024² : ≤ 0,3 ms | plus de répétition de 1 024 m dans l'écume ; écume qui suit le vent |
| M4 | **Cube du ciel** reconstruit une face par image, mips de rugosité ; normale « visible » inclinée aux angles rasants | remplace la sonde du vaisseau dans le reflet de la mer (et son défaut de nuit) ; le SSR reste pour les objets | ≤ 0,2 ms | reflet stable de jour et de nuit |
| M5 | **Une surface déplacée** (CDLOD sur le géoïde, courbure comprise) **de près**, au-delà le plan actuel | c'est l'« eau : surface, fond, reflets choisis » de la stratégie §7.5, donc **J4** ; pas avant J1 | à mesurer ; c'est le poste le plus cher de web-ocean | les crêtes masquent la mer vue du cockpit à 2 m |

### 5.3 Littoral

| # | Reprise | Chez nous | Coût visé | Preuve |
|---|---|---|---|---|
| **L1** | **Un champ de houle côtier par tuile publiée** : phaseur de la houle (eikonale, résolution Jacobi/FIM en calcul GPU ou *fast sweeping* dans un worker), hauteur après levée, fraction de déferlement, masque de jet de rive ; RGBA16F, 4–8 m, versionné et clé de la direction/période de houle (Open-Meteo) | produit de tuile du **monde** (pas du renderer), comme la table de distance au rivage qu'il remplace en partie (`earth-shore.ts`) | calcul à la publication, hors image ; lecture 1 texture | crêtes qui tournent autour de Giens, rien dans les lagunes, déferlement sur les hauts-fonds |
| **L2** | **Lame de rive, front de déferlement, écume physique** : les fonctions de `shore-waves.js` réécrites, **pente et jet de rive précalculés dans le champ** (pas 16 lectures de relief par pixel), état évalué une fois par pixel | `shadeWater` puis la passe d'eau de J4 | ≤ +0,5 ms sur une côte | trait d'eau lisse, sans dents de scie (défaut T7 actuel) |
| **L3** | **Sable mouillé** lu par le **sol** dans le même champ : assombri, rugosité basse, reflet du ciel, séchage | matériau du sol (J1) | ~0 | bande humide à la limite du jet de rive, cohérente avec l'eau |
| **L4** | **Bathymétrie** : (a) déjà là, la profondeur des tuiles Terrarium, que notre chaîne ramène à 0 ; (b) un **profil d'équilibre de Dean** h = 0,1·x^(2/3) tiré de la distance au rivage là où la donnée manque (`seasim.ts` fait déjà un plateau à 1,2 %) ; (c) les levés côtiers (Litto3D, HOMONIM) en France | source du monde, avec sa confiance | — | décision de Sam (§8) |

### 5.4 Streaming et préparation (recoupe ST et CM, rien de nouveau à lancer seul)

Crédits de téléversement en octets **et** en ms par image ; au plus deux images de téléversement en vol ; file à priorités
avec équité ; **résident jusqu'au remplacement complet** ; clés de cache = empreinte des entrées **et du source des
shaders** ; budget de compilation par étape. Ce sont les principes de ST2 (ordonnanceur unique), CM5 et C0 ; BVL en donne
des chiffres et une implémentation lisible à citer au moment de ces lots.

## 6. Ce que nous ne reprenons pas

- **Three.js** et ses correctifs (états de shaders, allocations) : coûts d'un moteur que nous n'avons pas.
- **Le volume voxel centré caméra** (256 m, recuit en secondes) : traversé en moins de 3 s à 140 m/s, et inutile à 5 km
  d'altitude. Seul son repli (les horizons par tuile) passe.
- **Les imposteurs à vues azimutales seules** : vu d'avion, de 10 à 90° sous l'horizon, ils s'aplatissent.
- **Le bruit procédural à chaque pixel** (~30 bruits par pixel de sol chez eux) : nous le cuisons en textures ou en champs de
  tuile.
- **Une mer plane à y = 0**, des UV d'atlas sur une carte de 4 km, une écologie procédurale : nous avons le géoïde, des
  données réelles, une planète.
- **Leurs chiffres comme promesses** : aucun n'est mesuré chez nous ; web-ocean, lui, montre qu'une mer bien faite coûte
  cher sur le mini.

## 7. Ordre proposé, et place dans les jalons

La stratégie reste juge : J1 (l'opaque terrestre en forward sur la scène de Toulon-Hyères) **d'abord, sans eau ni nuages**
(§15) ; la mer en J4. Ce que cette analyse change :

1. **J1 accueille V1 et L3** : les tuiles de couvert et le sable mouillé sont des lectures du **matériau du sol** ; les écrire
   une fois dans le nouvel opaque plutôt que dans `shadeLite` évite un second lecteur à retirer (§20.7). Le champ de houle
   (L1) étant un produit de tuile, sa cuisson peut commencer avant J4.
2. **La mer (M1–M4) avance avant J4, sur l'existant**, parce que la scène de référence est une côte et que la mer y coûte
   12,7 ms sur le mini : M1–M3 changent le **contrat de données** de la FFT et le filtrage, que la passe d'eau de J4 lira
   telle quelle ; ce ne sont pas de nouveaux lecteurs de `shadeLite`. M5 (la surface déplacée) reste à J4.
3. **V2 (imposteurs) après J1**, sur son contrat de profondeur : un imposteur sans profondeur fiable n'est pas une surface
   finale (§7.4).
4. **V3 (horizons de canopée)** avec Q4, à la place de L2b.
5. Avant tout cela : **l'ablation de la passe `earth water`** (J0, suite proposée) pour savoir ce que coûtent son SSR, sa
   sonde, son écume et ses bandes de rive.

Corrigé au passage : la synthèse J0 disait « le domaine de J1 est la moitié de la frame : `earth lite` + `earth water` ».
J1 exclut l'eau (§15) ; son domaine est `earth lite` (17,5 ms sur 65 sur le mini), l'eau relève de J4.

Plans mis à jour dans le même lot : [PLAN-REFRACTION-HORIZONS](PLAN-REFRACTION-HORIZONS.md) (T7, Q4, Q8),
[stratégie](ANALYSE-STRATEGIE-RENDU-2026-11-03.md) (§23), [PLAN-MONDE-VIVANT-AAA](PLAN-MONDE-VIVANT-AAA.md) (en tête : ses
chantiers A et B renvoient ici), la [synthèse J0](progress/j0/README.md).

## 8. Décisions de Sam (10 novembre, soir)

1. **La mer d'abord** : « d'abord la mer WebGPU parfaite » — les lots M1–M4 avant J1, sur la passe d'eau existante, puis la
   surface déplacée (M5). Qualité AAA **et** performance : chaque lot est jugé à coût mesuré.
2. **Bathymétrie (a)** : la profondeur Terrarium (déjà chargée, aujourd'hui ramenée à 0) et un profil de Dean d'après la
   distance au rivage là où elle manque ; pas de levés côtiers pour l'instant.
3. **Arbres des imposteurs générés procéduralement**, comme le fait BakedVoxelLighting.

Les questions telles qu'elles étaient posées :

## 8 bis. Questions posées

1. **L'ordre** : la mer (M1–M4) avant J4 sur l'existant, et V1/L3 dans J1 — ou l'ordre de la stratégie inchangé (J1 sans
   eau, toute la mer en J4) ?
2. **La bathymétrie du littoral** : (a) Terrarium + profil de Dean seulement (rien à télécharger de plus), ou (b) en plus les
   levés côtiers Litto3D/HOMONIM pour la France (deux essais déjà rejetés au plan T7 : volume, format, licence à revoir) ?
3. **Les arbres sources des imposteurs** : nos arbres sont des formes analytiques ; des imposteurs crédibles demandent des
   arbres **modélisés** (branches, feuilles) par espèce et par âge. Les générer nous-mêmes (comme BVL le fait, procéduralement),
   ou acheter/reprendre une bibliothèque d'arbres sous licence libre ?

## 9. Sources et limites

- web-ocean, révision `HEAD` du 17 octobre 2026 (2 commits) ; BakedVoxelLighting, `22f3dc4` du 5 novembre 2026 ; tous deux
  sous licence MIT. Lus en entier ; lecture de BakedVoxelLighting faite par un agent, ses références `fichier:ligne`
  vérifiées par échantillon.
- Mesures : web-ocean sur les deux Macs (§2.2), notre mer sur kerr-mini (§2.3) ; e2e et sondes non versionnées (sondes
  `zz-`). BakedVoxelLighting n'a pas été lancé (il cuit le monde au premier passage, plusieurs minutes de GPU sur la machine de
  Sam) : sa qualité est jugée sur son code et ses documents, pas sur une image.
- Les coûts « visés » du §5 sont des objectifs, pas des résultats.
