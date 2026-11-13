# PLAN-J3 — lumière, ombres et cockpit cohérents

**État (13 novembre 2026, ~16:05 UTC) : plan proposé, à valider par Sam ; mené selon ses recommandations (la ville d'abord, l'ordre du §3) sous la consigne « continue » de Sam — J3-0 mesuré en partie, J3-1 commencé (§10).** Les 5 questions du §8 restent ouvertes. Origine :
[stratégie](ANALYSE-STRATEGIE-RENDU-2026-11-03.md) §15 J3 (« raccorder un état lumineux partagé, cascades et profondeurs des objets ;
préserver les instruments ; attribuer correctement l'air aux distances ; conserver les corrections de réfraction dans leur portée ; ajouter
les matériaux de bâtiments identifiés, le détail de surface et les premiers assets préparés par une chaîne de production reproductible ») et
§24 (décision 1 de Sam, 13 novembre : J3 après l'eau étagée et la classification par tuiles — faites ou closes le 13, [PLAN-MER-WEBGPU §6](PLAN-MER-WEBGPU.md)).
**Sortie de J3** (§15) : *une scène complète de ville ou de montagne crédible de jour, sans réglage compensatoire propre à chaque cadrage.*
L'existant (§2) est relevé dans le code de `main` au 13 novembre (après `a41711f4`) ; **le code fait foi**. Les trois règles de méthode
(CLAUDE.md) s'appliquent : gain maximal écrit avant chaque lot de performance, ancien chemin retiré au lot de retrait suivant, toute sonde
neuve passée par un témoin positif et un A/A nul.

## 1. Ce que J3 doit livrer

- **Un seul état lumineux** par image, possédé par une responsabilité et lu par tous : le sol (raster et traceur), l'appareil et son cockpit,
  le décor, l'eau, les nuages. Aujourd'hui deux chemins (§2.1).
- **Des ombres à un propriétaire par échelle**, sans recouvrement ni trou, que l'appareil reçoit aussi (§2.2).
- **L'air attribué à chaque distance** : l'appareil, ses traînées et les objets lointains reçoivent l'air de leur distance, pas celui de la
  caméra (§2.4).
- **Les instruments préservés** : fraîcheur, lisibilité, coût borné (§2.3).
- **La réfraction gardée dans sa portée** : géométrique (le déplacement des objets) et incidente (la lumière) explicites (§2.5).
- **Les matériaux de bâtiments identifiés**, le détail de surface, et une **chaîne d'assets reproductible** pour les premiers modèles (§2.6, §2.7).

## 2. L'existant (relevé du 13 novembre)

### 2.1 La lumière : deux chemins
- **Le sol** (`trace.wgsl`) : `shadeLiteLight` prend direction et éclairement de `nearLight(k)` (~4820), relève le Soleil par la réfraction
  pour l'éclairage (`incidentSun`, ~4839, table `SUNI_OFF`), puis `liteLight` → `sunThrough`, `liteSun`, `liteSky` (`skyFlat` →
  `skyIrradiance`, les harmoniques du noyau `skyAmbient`, C9), `earthSkyOpen`.
- **L'appareil** (`ship.wgsl`) : son uniforme `S`, la sonde de lumière (`env` → `ship.envBuf` → `envSH`/`envGGX`), et la lumière clé de
  `keyLight()` (`trace.wgsl` ~17272) — la direction **géométrique** de `nearLight`, pas `incidentSun` ; l'éclairement pris **au seul point de la
  caméra** (transmittance `earthLookNoGround` × `cloudShadowAt(nearCam())` × `keyRelief`, une marche de 48 pas).
- **Aucune structure d'état lumineux commune** : `P`, les tables de `bodies` (Soleil, ciel, Soleil incident), et `sh`/`envTex`/`S` de
  l'appareil. Le ciel reflété par la mer reprend `envSpec` de l'appareil.

### 2.2 Les ombres : neuf mécanismes
Cascades du relief `sunDepth` (C6c, 2 × 2048², ±1,5 / ±10 km, bâtiments compris) ; horizons de la Terre (C4, au-delà) ; ombres de contact
(`rasterContactShadow`, 4–24 m, écran) ; arbres et bâtiments `tsmTex` (C6e, ±900 m) ; nuages `csmTex` (C7, 384²) ; carte d'ombre de l'appareil
(4096 × 2048, l'appareil et le porte-avions proche, cache « décision 42 ») ; GTAO (C6d) ; ombres tracées du décor proche (≤ 1,2–2 km) ; autres
mondes (cascade 0). **L'appareil ne reçoit ni le relief, ni les arbres, ni les bâtiments** : un scalaire par image au point de la caméra. La
stratégie demande un propriétaire par échelle sans recouvrement (§7, ~ligne 390) ; les cartes d'horizon ne sont pas validées (~ligne 173).

### 2.3 Le cockpit et les instruments
Masque du cockpit (B3, celui de l'image d'avant) ; l'appareil dans la scène (E12a : carte d'ombre, ombrage MSAA, masque propre, mouvement,
`composeColor`/`composeSurface` vers `hdr` et `sceneDepth` avant le temporel). Écrans : canevas CPU copiés en textures (`ship.ts` ~2582–2655),
rafraîchis depuis `main.ts` (`updateScreens` sur changement ; DU de l'A320 deux par image au plus ; PCD du F-35 toutes les ≥ 66 ms ou au
toucher). Fraîcheur des instruments non mesurée en continu.

### 2.4 L'air
Table aérienne (C10, 96 × 54 × 32, tranches logarithmiques) lue par `liteFinish` et `earthLookSky` (`apRead`), `earthAir` marché sinon.
**L'appareil ne reçoit aucun air** : ni transmittance ni diffusion dans `ship.wgsl`/`composeColor` (seul le relèvement R4b) ; ses pixels entrent
dans `hdr` après l'air du sol. Les traînées : `exp(−d/120 000)` ad hoc (`ship.wgsl` ~1812). L'atténuation de la lumière clé : à la caméra,
pas à la coque.

### 2.5 La réfraction
Courbure `refrBend` (tables R2, nulle au-dessus de 80 km) ; mirage R6a (bande d'horizon) ; relèvement du sol R4 (`refrLiftM`/`sceneryLiftM`,
jamais dans les cartes d'ombre, le cache ni le CPU), le même pour le traceur (R4a), les rasters et l'appareil (R4b) ; Soleil incident R3
(l'éclairage seul) ; autres mondes R5.

### 2.6 Les matériaux de bâtiments et le détail de surface
Toits (`roofs.ts` : tuiles, ardoise, zinc, béton, métal) et murs (pierre, meulière, béton, brique, enduit, bois, verre) de la BD TOPO et
d'Overture, empaquetés par `buildingPacked` ; ombrés par `roofLook` et `liteMaterial` (`bldE` fenêtres de nuit, `bldS`, `bldAO`, verre).
Détail : 5 scans CC0 (herbe, sol, gravier, roche, asphalte) à 3 échelles ; surface régionale Sentinel-2 + WorldCover (pilote) ; imposteurs
d'arbres.

### 2.7 Les assets
KTX2 par basisu (`build-ktx2.ts`, `build-detail-scans.py`, `build-earth-surface.ts`) ; maillages en format binaire maison (`build-airliners.ts`
GLB/OBJ → TRFC ; scripts Blender `build-f35.py`, `build-a320.py`, `build-iss.py` ; `build-ships`, `build-carriers`, `build-ranger`,
`build-lander`, `build-cockpit`) ; **ni meshoptimizer, ni gltfpack, ni glTF Transform** ; sources hors dépôt (`ASSETS.md`). Bâtiments
procéduraux depuis leurs emprises.

## 3. Les lots proposés

Chaque lot de performance écrit d'abord son gain maximal, lu dans une fiche ; chaque lot de qualité dit ce qu'il corrige, avec une image
avant / après au même cadrage. ΔGPU sur J0 (kerr-mini) et sur la scène J3 (J3-0).

| Lot | Contenu | Preuve | Taille |
|---|---|---|---|
| **J3-0** | **La scène J3 et ses instruments** : une scène de jour **ville** (Paris bas, déjà mesurée par `cut-buildings-trees`) ou **montagne** (les Alpes de `motion-quality`) en e2e de référence comme J0 ; l'inventaire des **réglages compensatoires** (exposition, relèvements, `CRAFT_ALPHA`, plafonds propres à un cadrage — **relevé le 13 nov., [fiche](progress/j3/INVENTAIRE-REGLAGES-2026-11-13.md)** ; la référence de ville relevée sur Paris (la recommandation du plan, en attendant la question 1 : [fiche](progress/j3/FICHE-PARIS-2026-11-13.md) — GPU p50 53,2 ms, le décor premier poste −8,4 ms) : six pèsent sur une scène de jour, dont le mélange de la médiane du profil Caméra, un choix de Sam, et `shadowKeep`) ; deux sondes : la cohérence de luminance appareil / sol à cadrages fixes (un même objet gris vu sous des cadrages différents) et l'âge des instruments (**faite le 13 nov., ses témoins passés : [fiche](progress/j3/SONDE-AGE-INSTRUMENTS-2026-11-13.md)** — PCD du F-35 en vol p95 57 ms) ; **l'exposition selon le cadrage mesurée** (même fiche que l'inventaire : profil neutre 0 EV entre cockpit, chase, quarter ; Caméra +0,06 / +0,12 EV, sa respiration voulue) | fiche, témoins positif et A/A des sondes | M |
| **J3-1** | **Un état lumineux unique** : un tampon écrit une fois par image (direction géométrique et incidente, éclairement direct au point demandé, harmoniques du ciel, transmittance des nuages), lu par le sol, l'appareil, le décor, l'eau ; `keyLight` de l'appareil sur le Soleil incident, comme le sol | images à cadrages fixes, sonde de J3-0, ΔGPU | M |
| **J3-2** | **L'air de l'appareil et des traînées** : la table aérienne lue à la distance de la coque (`apRead`) dans `composeColor` ; les traînées à la même loi ; la lumière clé atténuée à la coque | images (l'appareil au loin, une patrouille), ΔGPU | S |
| **J3-3** | **Les ombres, un propriétaire par échelle** : recouvrements et trous mesurés (contact, arbres/bâtiments, cascades, horizons) ; l'appareil reçoit l'ombre du relief et du décor (sa position lue dans les cartes existantes) ; la largeur des ombres d'arbres (PROBLEMES 436–449) | images (vallée au soleil bas, sous un hangar), ΔGPU | M |
| **J3-4** | **Le cockpit et les instruments** : âge des écrans mesuré et borné, leur coût, l'exposition avec le cockpit en vue ; les lampes de cabine la nuit (décision en attente, AAA-PROGRESS) | sonde d'âge, images | S |
| **J3-5** | **Les matériaux de bâtiments identifiés** : toits et murs vers des paramètres physiques (albédo, rugosité, métal, verre réfléchissant le ciel commun de J3-1), détail des façades | images de la scène J3 | M |
| **J3-6** | **La chaîne d'assets reproductible** : meshoptimizer (et glTF Transform si les sources s'y prêtent) dans `scripts/` pour les maillages des appareils — LOD, localité, compression —, les sources et versions écrites dans `ASSETS.md` (§18 : documentation, licence, compatibilité Bun, taille) | build reproductible, tailles, image inchangée | M |
| **J3-7** | **La réfraction dans sa portée** : géométrique et incidente nommées dans l'état lumineux ; chaque lecteur vérifié | tests unitaires, images | S |
| **J3-R** | Retrait des anciens chemins des leviers allumés pendant J3 | suite, J0 | S |

**Ordre recommandé** : J3-0 → J3-1 → J3-2 → J3-3 → J3-5 → J3-4 → J3-7 → J3-6 → J3-R (la lumière commune d'abord : tout le reste la lit).

## 4. La sortie de J3, en mesures

- La scène J3 (J3-0) aux cadrages fixes : aucune différence de réglage entre cadrages (l'inventaire de J3-0 vidé ou justifié) ; la sonde de
  cohérence appareil / sol sous un seuil à fixer sur mesure (A/A et témoin positif d'abord).
- Le coût complet sur kerr-mini et le M1 Max (borné et soutenu, J0-CONTRAT §2) : pas de régression de J0 au-delà du bruit sans un gain d'image
  écrit ; le chemin vers §8 tenu par famille.
- Les instruments : âge médian et 95ᵉ centile mesurés et bornés.

## 5. Contrats à poser

- **C-J3-1 (état lumineux)** : un tampon, son format, ses unités (W m⁻² sr⁻¹, directions dans le repère du corps), sa génération par image ;
  ses lecteurs listés dans GRAPHICS-PIPELINE.
  **Posé sur l'existant (13 nov., état du code de `f368d402`)** — plutôt qu'un tampon neuf (CLAUDE.md : réutiliser ; un nouveau module remplace
  une responsabilité nommée), l'état lumineux d'une image est l'ensemble de ces rangées de `bodyBuf` et de la sonde, écrites par le renderer
  avant les noyaux qui les lisent, régénérées à chaque image où elles valent :

  | Part | Où | Écrite par | Repère, unités | Lue par |
  |---|---|---|---|---|
  | Soleil géométrique (direction, éclairement du disque) | uniforme `P.near4`, sources de `bodies` ; `nearLight(k)` | renderer, chaque image | repère de la caméra ; l'échelle de la scène | 21 appels dans `trace.wgsl` (sol, ciel, eau, nuages, sonde) |
  | **Soleil incident** (R3) | `TABLE_SUN + 5` (`SUNI_OFF`) ; `incidentSun(Lp)` | `renderer.ts` `incidentSun` → `encodeSunShadow`, chaque image du raster de la Terre (w 0 ailleurs) | axes du corps ; w 1 posé | le sol (`shadeLite*`), ses cartes d'ombre, **la lumière de l'appareil** (`keyLight`, J3-1) |
  | Cartes d'ombre du Soleil (cascades, arbres et bâtiments, nuages) | `TABLE_SUN` 0–4, 6–7 ; `TABLE_TSM` ; `TABLE_CSM` + `csmTex` | renderer (`encodeSunShadow`, décor, nuages) | leurs repères propres, orientés par le Soleil incident | le sol ; l'appareil : les nuages seulement, au point de la caméra (`cloudShadowAt`) — J3-3 |
  | Ciel clair (harmoniques d'ordre 2 à 4 altitudes, grille de la mer) | `TABLE_SKY` (`SKY_OFF`) ; `skyIrradiance`, `skyIrradianceSeaUp` | noyau `skyAmbient` → copie dans `bodyBuf` | axes de la Terre ; l'échelle de la scène | le sol (`liteSky`), la mer |
  | Sonde de l'appareil (panorama tracé, ses harmoniques, sa lumière principale) | `ship.envBuf` → `envSH` → `shBuf` → `TABLE_SH` ; `shEnv`, `shIrradiance`, `nearE` | noyau `env` (1 texel sur k × k par image) puis `ship.wgsl` | axes de la sonde (`P.envX…Z`) | l'appareil (`ship.wgsl` : `sh[0..11]`) ; le traceur (`nearE`, 5 appels) ; le ciel que la mer reflète (`envSpec`) |
  | Sonde de cohérence J3-1 | `ship.envBuf` +2…+6 | `keyLight` | — | `renderer.readShipKey`, `readShipSky` (mesure seulement) |

  **Garanties mesurées** (J0, kerr-mini, 13 nov., §10) : la direction du Soleil de l'appareil = celle du sol (≤ 0,0002°) ; sa traversée de l'air
  = celle du sol (≤ 0,2 %) ; la lumière du ciel sur une surface horizontale : sonde exacte à −5…+9 % du ciel clair du sol, ses harmoniques +8…13 %
  au-dessus de la sonde exacte. **Hors du contrat aujourd'hui** : les ombres du relief, des arbres et des bâtiments sur l'appareil (J3-3), l'air
  entre l'appareil et la caméra (J3-2).
- **C-J3-2 (ombres)** : une table des échelles et de leurs propriétaires, leurs portées et leurs fondus.
- **C-J3-3 (air)** : la distance et le repère de chaque lecteur de la table aérienne.

## 6. Bibliothèques (§18)

meshoptimizer pour J3-6 (dans la chaîne d'assets, hors boucle d'image) ; glTF Transform seulement si les sources des appareils sont en glTF
et que l'outillage fonctionne sous Bun ; rien d'autre. Ni l'un ni l'autre n'est installé aujourd'hui.

## 7. Risques

- La lumière commune touche tous les lecteurs : un lot d'images large à revoir (les cadrages fixes de J3-0 servent de garde-fou).
- L'ombre reçue par l'appareil : un coût de lecture par pixel de l'appareil (borné par sa surface à l'écran).
- L'air de l'appareil change son aspect au loin (attendu) et de près (doit rester nul à quelques mètres).
- Le M1 Max mesure mal tant que `coreaudiod` le charge (J0-CONTRAT §2).

## 8. Questions pour Sam

1. **La scène J3** : ville (Paris bas) ou montagne (Alpes) — ou les deux, la ville d'abord ?
2. **L'ordre** proposé (§3) : d'accord ?
3. **L'ombre reçue par l'appareil** (J3-3) : la voulez-vous dans J3 (coût à mesurer), ou plus tard ?
4. **La chaîne d'assets** (J3-6) : meshoptimizer adopté pour les appareils ?
5. **L'exposition la nuit** (PROBLEMES : elle suit la lumière reçue par la caméra, la face nocturne reste noire) : dans J3 ou à part ?

## 9. Non vérifié

Le relevé du §2 vient d'une lecture du code (agent d'exploration, 13 novembre), pas de mesures ; les numéros de ligne sont ceux de ce jour.
Aucun coût de J3 n'est mesuré ; aucun gain n'est promis.

## 10. Avancement

- **J3-0** (13 nov.) : inventaire des réglages compensatoires, sonde de l'âge des instruments (témoins passés), référence de ville sur Paris,
  exposition par cadrage (neutre : aucune dépendance au cadrage ; profil Caméra 0,06–0,12 EV par conception), l'appareil hors du mètre —
  [docs/progress/j3/](progress/j3/).
- **J3-1, premier pas — l'appareil éclairé par le Soleil du sol** (13 nov., ~16:05 UTC). La lumière principale de l'appareil (`trace.wgsl`
  `keyLight`, lue par `ship.wgsl` : son éclairage direct, sa carte d'ombre) prend sur la Terre le **Soleil incident** (R3, la rangée
  `TABLE_SUN + 5` que le sol lit) au lieu du géométrique ; la clé du cache de sa carte d'ombre (`renderer.ts` `shipKeyDir`) le même. Mesuré
  (kerr-mini, J0 à 500 m, `J0_PHASES=keylight`, lecture GPU `renderer.readShipKey`) : de 18:30 à 19:25 UTC, la lumière de l'appareil tourne
  exactement du relèvement du CPU (0,036 → 1,000°, écart ≤ 0,0002°, A/A ≤ 0,0002°) ; son éclairement ×1,00 (18:30), ×1,68 (19:05), **×193**
  (19:15 : le sol encore éclairé, l'appareil presque éteint avant). À contre-jour (vue de trois quarts, 19:05) la différence ne se voit pas.
  **Non mesuré** : ΔGPU (un texel, un fil par image : attendu nul, non vérifié), une vue de face au Soleil bas.
  **L'éclairement : un écart supposé, mesuré nul** (13 nov., ~16:20 UTC). À la lecture du code, le Soleil traversait l'air par deux modèles —
  le sol `sunThrough(h, μ)` (la table de Bruneton), l'appareil la marche de `earthLookNoGround` le long de son rayon. Une sonde les écrit
  côte à côte à chaque image (`keyLight` → `ship.envBuf` +2/+3, `renderer.readShipKey().air`), e2e J0 `J0_PHASES=keyair` (kerr-mini, J0 à
  ~540 m, runs `…-j3-keyair`, `-keyair2`, `-keyair3`) : de 15:30 à 19:15 UTC (transmittance 0,80 → 0,004), **rapport marche / table 0,998
  à 1,002**. Témoins (run 3) : le rapport relu à ≤ 0,1 % (A/A) ; la marche rendue grossière exprès (`TUNE_AIR_N` 4 pour 32) le porte à 1,039
  (15:30) et 1,254 (19:05) (positif). **Rien à changer** : l'appareil garde sa marche (gain maximal nul — un fil par image —, écart de modèle
  invisible). Un levier qui éclairait l'appareil par la table (`TUNE_KEY_AIR`) a été essayé puis retiré : il était le premier `tune` de la
  session, dont les relevés restent à l'heure d'avant (défaut de l'outil trouvé par le témoin positif, [PROBLEMES](PROBLEMES-A-REGLER.md)),
  et il n'avait plus d'utilité.
  **La lumière du ciel : mesurée, un écart au coucher** (13 nov., ~16:35 UTC). Même sonde (`ship.envBuf` +4/+5) : sur une surface horizontale
  à la caméra, la lumière du ciel du sol (`skyIrradiance`, le ciel clair de `skyAmbient`) et celle de l'appareil (les harmoniques de sa sonde,
  le ciel tracé) ; e2e J0 `J0_PHASES=keysky`, nuages ôtés (`earthClouds` 0), deux runs `…-j3-keysky`, `-keysky2` concordants. Rapport
  appareil / sol : **1,05 (12:00), 1,02 (15:30), 1,10 (18:30), 1,12–1,14 (19:05)**. Témoins : relu deux fois, ≤ 2,1 % (A/A — la sonde se
  dessine par parties) ; une couche de nuages (`earthClouds` 0,9) le porte à 1,13 / 1,21, le sol inchangé (positif : le ciel clair du sol ne
  voit pas les nuages, par conception — ses nuages passent par d'autres facteurs). **Lecture** : de jour l'appareil reçoit ce que reçoit le
  sol à quelques % ; au coucher, 10–12 % de plus. **Causes possibles, non vérifiées** : les harmoniques d'ordre 2 de la sonde mêlent à « vers le
  haut » la lueur de l'horizon et le sol éclairé (la mer, son reflet) sous l'horizon abaissé de 500 m ; le ciel clair du sol n'a pas de
  renvoi du sol.
  **Les parts séparées** (13 nov., ~16:40 UTC, run `…-j3-keysky3`) : les texels de la sonde intégrés **exactement** sur l'hémisphère au-dessus
  (`renderer.readShipSky`, cos θ dω, sans harmoniques) : appareil exact / sol **0,96 (12:00), 0,95 (15:30), 0,97 (18:30), 1,05–1,09 (19:05)**.
  Donc **les harmoniques d'ordre 2 ajoutent 8 à 13 %** à ce que la sonde contient pour une surface tournée vers le haut (la part du dessous —
  la mer, le sol — qui fuit dans « le haut ») ; le ciel tracé et le ciel clair du sol restent entre −5 % de jour et +9 % au coucher. A/A de la
  sonde au coucher jusqu'à 4,8 % (le ciel change vite pendant qu'elle se dessine par parties). **Pas de changement fait** : corriger la fuite
  des harmoniques (un fenêtrage des bandes, ou l'éclairement exact haut/bas de la sonde à côté des harmoniques) change l'aspect de tout
  l'appareil — une décision d'image à présenter avec des vues, pas un réglage.
  **Le fenêtrage, mesuré et écarté** (~18:45 UTC, run `…-j3-keysky-window`) : les texels de la sonde projetés sur le CPU (contrôle : la
  projection sans fenêtre = celle du GPU, 1,00 / 0,99), l'éclairement vers le haut sans fenêtre / Hann / Lanczos rapporté à l'exact :
  12:00 1,10 / 1,02 / 1,01 ; 15:30 1,08 / 1,14 / 1,11 ; 18:30 1,13 / **1,47** / 1,40 ; 19:05 1,06 / 1,15 / 1,14. **Le fenêtrage aggrave l'écart dès
  que le Soleil baisse** (il tire vers la moyenne de toute la sphère, la lueur de l'horizon comprise) : ce n'est pas le correctif. Restent :
  plus de bandes (ordre 3, 16 coefficients) ou l'éclairement exact haut / bas de la sonde à côté des harmoniques — à mesurer de même.
  **Reste de J3-1** : l'état lumineux unique (le tampon par image de C-J3-1 : directions, éclairement direct, harmoniques du ciel, nuages),
  ses lecteurs (sol, appareil, décor, eau) branchés dessus ; la sonde de cohérence appareil / sol.
- **J3-2, premier pas — l'appareil à travers l'air de sa distance** (13 nov., ~17:12 UTC). La coque (`ship.wgsl` `fs`) et les traînées
  (`trailFs`) lisent la table aérienne du traceur (`aerialTex`, la même que le sol : `shipAir`, c × T + L × alpha, au-delà de 50 m) ; sa
  portée et l'échelle viennent de `keyLight` (`sh[12]`) ; les traînées perdent leur `exp(−d/120 km)` ad hoc. Interrupteur de comparaison
  `renderer.shipAirAllowed`. **Mesuré** (kerr-mini, J0, `J0_PHASES=keyhaze`, vue « around » de côté, champ resserré) : écart avec / sans
  (p99 du cadre central, 0–255) **10 à 300 m, 33 à 3 km, 59 à 10 km** ; A/A 1,3 — l'appareil lointain prend la brume du sol voisin (vues).
  Coût sur J0 (ablation `shipAir`, cockpit) : 0,25–0,7 ms avant la coupure à 50 m, **≈ 0,2 ms après, au bruit**. **Puis (~17:16 UTC)** :
  les flammes (`plumeFs`) et le halo des feux (`lampFs`) atténués par la transmittance de leur distance (des émissions : pas de diffusion
  ajoutée) ; run `…-j3-keyhaze5` : mesures reproduites, aucune erreur WebGPU, postcombustion allumée — mais la vue (revenue de 10 km) ne
  montre pas la flamme, et les feux n'ont pas été dessinés (de jour) : leur chemin non vérifié à l'exécution. **Puis (~18:01 UTC)** : les
  verrières (`fsJetGlass`, couverture prémultipliée) aussi ; run `…-j3-keyhaze6` : 10 / 33 / 59, A/A 1,3, 0 erreur WebGPU (le pipeline
  principal du verre lié ; ses modes 2 et 3 — verre plat de diagnostic, survol du poste de l'A320 — non dessinés). **Non fait** : la nuit (la part lunaire de la table) ; l'air au-delà de la
  table (au-dessus de l'air, une autre planète). Trois runs du test ont échoué sur la mise en place de la vue avant celui-ci (le montage
  « chase » ignore la distance ; le passage à « around » replace la caméra ; la moyenne noyait l'appareil lointain).
- **J3-3, la mesure des ombres du sol par propriétaire** (13 nov., ~17:26 UTC ; ne dépend pas de la question 3 du §8). e2e J0 `J0_PHASES=shadows`
  (`J0_START` Paris, 18:00 UTC — Soleil ~20° —, monde figé, exposition tenue, raster ombré en entier), les ombres du Soleil au sol séparées par
  `liteSkip` ; par blocs de 8 × 8 pixels. Deux runs concordants (`…-j3-shadows2`, `-shadows3`) : **cascades 10,6–11,1 % de l'image, carte des
  arbres et bâtiments 13,5–13,6 %, les deux 8,4–8,5 %** (≈ 62 % de la carte déjà dans les cascades — les bâtiments y sont deux fois), le contact
  +5,6–6,2 % ; **ombre comptée deux fois : 0,08–0,09 % des blocs, sous le bruit** (A/A 2,3–3,2 % — les arbres, les lueurs). Lecture : le produit
  des deux ne se voit pas (ombres franches : 0 × 0) ; le recouvrement est du travail fait deux fois sous 550–750 m, pas une erreur d'image.
  **Règle 1, lue dans la fiche de Paris** (`…-j3-paris-ref2`, `flight.passes`) : la carte des arbres et bâtiments coûte 1,5–1,7 ms **quand elle
  est dessinée** — 76 images d'un vol de 70 s (≈ 1 200), soit ≈ 0,1 ms par image en moyenne ; sa couche bâtiments n'est pas chronométrée à part.
  Retirer les bâtiments de la carte rendrait au plus ≈ 0,1 ms : **pas un lot de performance** ; le recouvrement reste (aucun défaut d'image
  mesuré). Sa netteté face aux cascades non comparée ; les trous (une référence tracée manque) ; une vallée au Soleil bas (relief + horizons). Un premier run a échoué sur un
  A/A par pixel (8 % de bruit) : mesure passée aux blocs.
- **J3-5, préparation — l'inventaire des matériaux des bâtiments** (13 nov., ~17:32 UTC) :
  [INVENTAIRE-MATERIAUX-BATIMENTS](progress/j3/INVENTAIRE-MATERIAUX-BATIMENTS-2026-11-13.md) — lecture du code (trois points revérifiés) :
  aucun métal (le zinc un gris diffus à F0 0,06, la tôle sans spéculaire), le reflet sur une irradiance plate et non la sonde commune, le
  spéculaire éteint au-delà de ~26 cm le pixel, les tuiles du nord (Y ≈ 0,10) et la brique (≈ 0,145) sombres face aux valeurs mesurées, le verre
  des murs-rideaux à F0 0,10 ; raster et tracé divergent (recalage photo, ambiante, mouillé). Proposé : vues de référence et témoin, albédos et
  métaux physiques, le reflet dans la sonde de J3-1, une fonction pour les deux chemins — **rien de fait**, chaque point à juger en A/B.
  **Essai (~18:16 UTC)** : tuiles × 2,5 et brique × 1,5 sur Lille vue d'en haut — **aucun changement à l'image** (73,31 / 73,05 / 73,27) : de près au
  raster, les toits viennent de l'orthophoto. Les tables ne comptent qu'où la photo ne colore pas (tracé, lointain, étranger) : les vues de
  référence de J3-5 se feront là. Levier retiré.
  **Vues de référence (~18:26 UTC, phase `cityview`)** : Lille (toits de l'orthophoto) et Bruxelles (sans orthophoto nationale : les toits des
  tables, bruns et ternes) — la ville de référence de J3-5 est donc étrangère ; aucune « boîte » dans les deux grilles de `surfaceAt`.
  **Bruxelles avant / essai (~18:32 UTC)** : tuiles × 2,5 et brique × 1,5 → la vue d'en haut +0,7 % (68,85 → 69,31, A/A 0,02) — le recalage du
  raster sur la photo absorbe l'essai ; la clarté des toits à l'étranger est celle de la photo floue. Décision de Sam : les tables, le recalage,
  ou les deux (levier de mesure `TUNE_BLD_*` gardé jusque-là).
  **Quatre variantes (~18:41 UTC, run propre)** : d'en haut 68,84 / tables 69,80 / sans recalage 69,55 / les deux 70,46 (A/A 0,34) — les tuiles
  brun-rouge sombre → terre cuite claire avec les deux ; chacun en rend la moitié. Vues dans la fiche.

