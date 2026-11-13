# PLAN-J2 — pages d'imagerie filtrables et reconstruction

**État (13 novembre 2026) : J2 terminé** — J2-0 → J2-8 faits, l'état décidé par Sam le 13 (« ok pour tes recommandations », §9 undecies), la
[fiche J0 de sortie](progress/j0/FICHE-kerr-mini-2026-11-13-sortie.md) et le bilan du §4 au §9 duodecies ; J2-C étudiée (BC7 : 42–44 dB aux orthophotos, 4 × moins de mémoire, ~1,5–6 ms d'encodage par page) — sa réalisation laissée à Sam.
**État d'origine (12 novembre 2026) : plan validé par Sam (ses recommandations, §9) ; J2-0 fait — instruments et [fiche de référence](progress/j2/FICHE-J2-0-2026-11-12.md) ; J2-1 fait — table de pages, tuile de la caméra, mips groupés ([fiche J2-1](progress/j2/FICHE-J2-1-2026-11-12.md), §9 ter) ; J2-2 fait — le sol de contact au monde, quelle que soit la caméra ([fiche J2-2](progress/j2/FICHE-J2-2-2026-11-12.md), §9 quater) ; le lot des pointes du fil principal fait — le travail des tuiles borné à 2 ms par image ([fiche](progress/j2/FICHE-J2-pointes-2026-11-12.md), §9 quinquies) ; J2-3 à lancer.** Rien n'est commencé : aucun code, test, e2e ni bench n'a été lancé pour
l'écrire (session de documentation). L'existant (§2) est relevé dans le code de `main` au 12 novembre (après `4d1201c0`, J1 terminé) ;
**le code fait foi**, les lignes citées sont celles de ce jour. Origine : [stratégie](ANALYSE-STRATEGIE-RENDU-2026-11-03.md) §15 J2
(« séparer hauteurs/couleurs, mips/gouttières, gradients, publication versionnée ; désocclusion et invalidations locales ; puis la
variation de résolution sans pulsation récurrente »), §7.6 (pages de surface), §7.10 et §7.18 (reconstruction), §7.19 (publication),
§20.5 étapes 3 et 5 ; [PLAN-J1](PLAN-J1-OPAQUE-FORWARD.md) (terminé le 12 novembre : ce qu'il laisse, §2.4) ; contrat
[C0-4](progress/refraction-horizons/C0.md) (le stockage des tuiles) et C0-12 (erreur projetée admissible) ; Q6 du
[plan T/Q/H/R](PLAN-REFRACTION-HORIZONS.md). Juge : la scène [J0](J0-CONTRAT.md) (Toulon-Hyères) sur kerr-mini (répartition, ΔGPU) et
sur le M1 Max (palier 1 : 25 ms) ; fiches du 12 novembre : [kerr-mini](progress/j0/FICHE-kerr-mini-2026-11-12.md) (GPU p50 59,5 ms,
16,8 images/s), [M1 Max](progress/j0/FICHE-m1max-2026-11-12.md) (frais 43,9 images/s, p50 24,9 ms, p95 32,6 ; soutenu 33,4/s).

## 1. Ce que J2 doit livrer (stratégie §15)

**Contenu** : les pages d'imagerie filtrables (hauteurs et couleurs séparées, mips, gouttières, gradients), leur **publication
versionnée** ; la **désocclusion** et les **invalidations locales** dans la reconstruction ; puis la **variation de résolution sans
pulsation récurrente**.

**Sortie** : avantage démontré à qualité comparable et en virage ; absence de fuite entre pages ; pas de flou intermittent à chaque
changement d'échelle (traduits en mesures au §4). **Critère de passage** : un coût de frame complet mesuré et un chemin crédible vers le
contrat §8 ; la performance accompagnée de la qualité minimale en mouvement, aucune des deux ne remplaçant l'autre.

**Ce que le code a déjà fait de J2** (à ne pas refaire, CLAUDE.md « une correction déjà intégrée ne doit pas redevenir une tâche ») :
**T9a–T9c** (3 novembre, [fiche T9](progress/refraction-horizons/T9.md)) ont séparé hauteurs et couleurs, donné des mips par tuile et le
filtrage matériel anisotrope à toute l'imagerie de la Terre (z 6–18), les lumières de nuit dans leurs couches — matériau raster −1,2 ms
mesuré ; **Q6** (4 novembre) a allumé la TAAU en mouvement (`taauOn`, Tarifa 39,6 → 44,4 dB) ; **J1-2/J1-5** ont donné la profondeur
gardée, l'identité, le mouvement des mobiles et le rejet (b). Deux diagnostics de la stratégie §5.3 sont donc **périmés** :
« `earthImageryAniso` fait un filtrage manuel des couleurs empaquetées » (le filtrage est matériel depuis T9 ; seule la sélection des
niveaux reste à la main, §2.1) et « `taauOn = false` » (allumé depuis Q6b). Le troisième tient toujours : `main.ts` épingle l'échelle
en vol raster (§2.3). J2 part donc d'une imagerie déjà filtrable ; il lui reste **les bords, la publication, l'invalidation, la
désocclusion et l'échelle**.

## 2. L'existant (relevé du code, 12 novembre)

### 2.1 Le relief et l'imagerie de la Terre : chargement, stockage, filtrage

| Responsabilité | Aujourd'hui (fichier, fonction) | Écart au contrat (§7.6, C0-4) |
|---|---|---|
| Sources et niveaux | `src/system/earth-tiles.ts` (2 884 lignes), classe `EarthTiles` : relief Terrarium z 6–14 (+ IGN, swisstopo, Mapterhorn jusqu'à z 17 par `refine`), imagerie GIBS (≤ z 8), EOX (z 9–14), orthophotos IGN z 15–18 (`requestOrtho`) ; décodage en worker (`tile-decode-worker.ts`) | — |
| Fenêtres | une fenêtre **toroïdale** par niveau (`SPAN` 4 tuiles, 8 aux portées lointaines pour z ≥ 11 : `TILE_REACH`, `levelSpan`), l'adresse `(coin + i) & masque` (`tileAt`, `trace.wgsl:7435`) ; les tuiles quittées écrasées par les entrantes | le contrat C0-4 §2 voulait **8 tuiles pour toute l'imagerie** ; T8e (orthos z 15–16 à 8 tuiles) **reste coupé** (décision 38 de Sam, `ORTHO_BIG_LEVELS = 0`) |
| Hauteurs | texture `earth tiles` **`r32uint`** (les bits du float, la marque de relevé IGN dans le bit de poids faible : `markFine`) là où l'imagerie est filtrée — `rg32uint` (hauteurs + imagerie empaquetée) sur le talon des appareils sous 31 textures ; rangées par couches et quarts de couche (`tileLayout`, T10) ; ~144 Mio à la portée `veryFar` (GRAPHICS-PIPELINE §4.2) ; **pas de mips** ; lecture à la main (cubique B-spline ou monotone selon la pente, `TILE_STEEP`), la même sur le CPU (`heightAt`, `sampleLevel`) | séparées des couleurs : **fait** (T9c). `r32float` du contrat non retenu (le filtrage matériel d'un `r32float` demande la fonction optionnelle `float32-filterable` ; la lecture reste manuelle pour l'accord CPU/GPU) |
| Couleurs | deux `texture_2d_array` **`rgba8unorm`** avec vue **`rgba8unorm-srgb`** (`earth-tiles.ts:1125`, `makeImagery2k:1165`) : la 1024² (19 couches : 4 d'orthos, 9 niveaux z 6–14, 3 de lumières de nuit z 6–8, 3 de lumières des rues z 12–14 ; ~106 Mo mips comprises, calculé : `ORTHO_BYTES`), la 2048² (z 11–14 aux portées lointaines ; ~89 Mo calculé ; bouchon 1 × 1 sinon) ; **une fenêtre = une couche entière**, l'adressage `repeat` fait l'enroulement du tore ; alpha = la couverture (0 : pas d'image) | — |
| Compression | **aucune** pour ces pages (rgba8). Basis/KTX2 (`vendor/basis`, `ktx2.ts`, `ktx-worker.ts`, `scripts/build-ktx2.ts`) sert aux cubes de la Terre (`earth-maps.ts`) et au pilote régional (`earth-surface.ts`) ; l'encodeur GPU BC7/BC5 au chargement (`bc-encode.ts`) aux cartes HD (`hd-maps.ts`) | §18.6 : pages dynamiques non compressées d'abord, compression des pages stables « une possibilité » |
| Mips | **par tuile**, 256² → 16² (`ORTHO_MIPS` 5), faites à l'arrivée par une passe de rendu (`orthoMips`, `earth-tiles.ts:2423`, `ORTHO_MIP_WGSL` : moyenne en lumière linéaire, prémultipliée par la couverture) — « les mips d'une tuile ne lisent jamais sa voisine » ; **une soumission GPU par tuile et par couche** (`queue.submit` dans `orthoMips` ; GRAPHICS-PIPELINE §4.5) | ANALYSE-STREAMING ST5 : « mips regroupés en un encodeur et une soumission par image » |
| Gouttières | **aucune** dans les pages d'imagerie. À l'intérieur d'une fenêtre, le voisin filtré est le vrai voisin géographique (le tore est cohérent). **Au bord de la fenêtre**, le texel d'en face est l'autre bord du tore (ou l'ancien occupant d'un emplacement) : seul le **fondu de bord fixe** le couvre, `smoothstep(2, 48)` texels du niveau de base vers le bord du rectangle valide (`earthImagery`, `earthImageryAniso`) — C0-4 §3 le jugeait suffisant pour la mip 4 (« ≤ 16 px »), **sans compter l'anisotropie 16** qui allonge l'empreinte ; aucune mesure de fuite n'existe | §7.6 : « ne pas simplement activer l'anisotropie sur un atlas sans frontières propres » ; sortie de J2 « absence de fuite entre pages » |
| Le pilote régional | `earth-surface.ts` (Sentinel-2 + WorldCover, **Le Bourget et Cévennes seulement** — pas Toulon) : pages KTX2 1024² **avec gouttières de 2 px** (`SURFACE_GUTTER`), 11 mips, arrivée par page (`loadedAt`), époque (`epoch`) | le seul système à pages avec gouttières du code ; modèle réutilisable |
| Filtrage | échantillonneur `orthophotos` (`renderer.ts:1424`) : trilinéaire, **anisotropie 16**, `repeat` ; lecteurs WGSL générés par `orthoImageryWgsl` (`earth-tiles.ts`, aussi module de bibliothèque J1-3) : `orthoGrad`, `tileImgGrad` (**`textureSampleGrad`** par les gradients du pixel), `orthoAt`, `tileImgAt` (mip par l'empreinte) | — |
| Sélection des niveaux | `earthImagery` (`trace.wgsl:7501`) et `earthImageryAniso` (`:7594`) : **boucle à la main** sur 4 niveaux d'orthos puis 9 niveaux du relief, poids par l'empreinte (`zf`) et par la distance au bord, la couverture comme poids, l'ortho par-dessus ; `TUNE_ANISO` (4) ne sert plus qu'à choisir le niveau par le petit axe de l'empreinte — `duv` et `nf` y sont **calculés et inutilisés** (reliquat d'avant T9) | 13 lectures possibles par pixel ; pas d'erreur visible relevée, coût non isolé |
| Gradients | l'empreinte du pixel (`fx`, `fy` sur la sphère unité) vient du prologue de `shadeLite` (rayon gigué `liteJitter`, `trace.wgsl:15430`), projetée **sur le plan horizontal** (relevé J1-5 : `tn` est nul sur un bâtiment) ; convertie en gradients de texels par les dérivées de la longitude et de la latitude de Mercator | l'empreinte d'un sol en pente ou d'une façade : à vérifier (§9) |
| Publication | à l'arrivée : `putTile` (`earth-tiles.ts:1968`) écrit les hauteurs, `putImagery` (`:2475`) et `putOrtho` (`:2395`) écrivent **directement dans la texture vivante** (`writeTexture`) et soumettent leurs mips ; un niveau n'est lu que dans son **rectangle valide** (`valid`, `setValid`), un rectangle par niveau (pas de validité par tuile : C0-4 §5 et ST9 non faits) ; `gen` (changement de sources) jette les réponses périmées | C0-4 §5–6 : validité par tuile publiée **avec** ses mips, clé source + génération ; §7.6 : « file de publication avec budget d'uploads par frame » |
| Versions | `stamp` (le rectangle d'un niveau change), **`changes`** (`TileChange` : niveau, boîte lon/lat, séquence — `logChange`, `:1022`) lu par le **cache de relief** (`terrain-cache.ts` : il ne recuit que là où le changement se voit — une invalidation locale **existe déjà pour les hauteurs**) ; `imagery` (compteur global : une tuile reçoit son imagerie) ; `arrivals` (`ArrivalLog`, CM0 : demandée → reçue → écrite → dessinée) | aucune génération par page lisible par le renderer |
| Invalidations | `earthTiles.onChange` → **`renderer.invalidate()` global** (`renderer.ts:1817`, `:2994` : `validFrom`, `epoch`, `sampleIndex` remis) ; une arrivée d'imagerie sur une vue convergée → `invalidate()` au plus toutes les 500 ms (`:4291`) ; le décor (`earthScenery.onChange/onContent`) et le pilote régional de même | §7.10 étape 5 : « aucun effacement global quand une petite page arrive » ; l'effet en vol (où le raster est ombré à chaque pixel) **non mesuré** |

### 2.2 La reconstruction temps réel

| Élément | Aujourd'hui | Note |
|---|---|---|
| Rayons tracés (`main`) | ciel, mer lointaine et brume au-delà du patch raster : un rayon par bloc (`BLOCKS` 1, 2, 3, 4, 6, 8 ; `adaptBlock`, `renderer.ts:11944`, au temps de frame mesuré) ; reconstruits par `gatherH` puis `resolve` (`post.wgsl:34`, `:177`) → `hdr` | J0 : bloc 16 relevé dans la fiche (unités de la fiche, à rapprocher de `BLOCKS` — non vérifié) |
| Restes du raster (`shade`) | le noyau des rayons sur les pixels raster que `shadeLite` laisse (ponts, arbres à moins de 80 m, boîtes marquées) à une **cadence** de 1, 2, 4, 8 ou 16 (`rasterRate`, `RASTER_RATES_AUTO` `renderer.ts:355`, `adaptRasterRate` `:12033`), `shadeMark` marquant les pixels laissés pour `resolve` ; sauté (`liteAll`) quand rien ne le demande | « l'ombrage clairsemé 1/8–1/16 » de la stratégie, c'est lui (et `bodyLite` sur les autres corps, plafonné à 1/4) ; **le sol de la Terre est ombré à chaque pixel, chaque image** par `shadeLite` (matériau puis éclairage, `withLiteDeferred`) |
| Temporel natif | `temporal` (`post.wgsl:777`) à la taille interne : reprojection par la caméra et la profondeur (`moments.y`, « closest depth » des pixels frais pour le tracé), clamp de voisinage YCoCg, mobiles par leur mouvement (z 1, z 2 sans historique), l'appareil (w 1) neuf à au moins la moitié de la frame, rejet (b) par identité ; historiques `temporal.hist[2]`, `alb[2]` rgba16f | `temporal` 1,73 ms (kerr-mini, J0 12 nov.) |
| TAAU | `taau` (`post.wgsl:1272`) **à la taille de la toile** quand la cible vivante est plus petite qu'elle (`taauWanted`, `renderer.ts:8034–8070`) ; σ 0,5 px (0,7 sur l'eau), poids natif 0,02 ; historique `taau.hist[2]` à la taille de la toile | `taau` 3,69 ms (J0 12 nov.) ; **deux historiques longs empilés** (natif puis sortie) — ce que §7.18 demande d'éviter |
| Échelle interne | `settings.earthRasterScale` 0,75 ; `main.ts` : en vol raster l'échelle est **épinglée** à `rasterTop()` (`:5526`, `:8957` : « chaque pas rééchantillonnait l'historique… une impulsion de flou toutes les quelques secondes ») ; caméra tenue 0,4 s → échelle 1 (affinage), mouvement 0,15 s → retour à 0,75 (`:8902–8920`) : chaque arrêt et chaque reprise changent l'échelle — **corrigé par la mesure de J2-0 : seulement en mode photo ou hors raster** ; en vol raster, une vue tenue reste en temps réel à 0,75 (`renderer.rasterHold`, vrai hors du mode photo ; `rasterScale` exige `!rasterHold`) ; la résolution dynamique (`dynamicResolution`, profil « game ») ne baisse l'échelle que hors raster ou une fois la cadence raster au plus grossier (`rateDone`) | la sortie « pas de flou intermittent à chaque changement d'échelle » ; I4 de Q6 (« l'échelle n'est abaissée que si les scènes critiques le permettent ») ouvert |

### 2.3 Ce que J1 laisse, que J2 peut lire

- **La profondeur gardée** de la visibilité de la Terre (`depth32float` inversée, `depthStoreOp: "store"`, J1-2) — Terre proche seulement ;
  `sceneDepth` (distance) dans tous les mondes. **Pas de profondeur de l'image d'avant** gardée (seuls l'identité et le mouvement sont
  copiés en fin d'image : `keepMotion`, `renderer.ts:5509`).
- **L'identité** `r32uint` (objet 20 bits | génération 12 bits, `surface-id.ts`) et **`identity, the frame before`** ; **le sol vaut 0** :
  aucune page ni génération du sol n'y est écrite.
- **Le mouvement** `rgba16float` des mobiles (z 1 ; z 2 sans historique ; l'appareil w 1) et `motion, the frame before` (désoccultations
  des mobiles) ; **le mouvement analytique du rigide** derrière `renderer.rigidMotionOn` (`:5618`, éteint, sans lecteur, §8).
- **Le rejet (b)** (`identityKept`, `post.wgsl:665`) : les mobiles rejetés, le décor immobile au poids coupé au quart à l'image d'une
  nouvelle publication du décor (`republishedNow`, `renderer.ts:5571` ; `ID_REPUBLISHED`) — le mécanisme qu'une page de sol publiée
  peut reprendre.
- **`FrameDesc`** (`src/frame-desc.ts`) : la caméra actuelle et précédente, l'horloge de la frame — le lieu naturel d'une table de pages
  figée pour l'image.
- **L'export `renderer.sceneColor`** (radiance linéaire pré-exposée avant l'optique, `taau image` ou `hdr`) : l'instrument des mesures
  de J2 (netteté, fuite, pulsation) sans la courbe d'affichage ni le HUD.

### 2.4 Défauts connus, relevés sans les régler

- **Les points blancs de la mer** ([PROBLEMES-A-REGLER](PROBLEMES-A-REGLER.md), 12 nov.) : 0–24 pixels isolés au-delà du blanc dans la
  couleur de scène, **avec ou sans** l'ombrage clairsemé, le spéculaire du sol, la mer déplacée et le matériau de l'eau — cause inconnue ;
  l'hypothèse « motif de `shade` » est écartée par la mesure. J2-0 peut les localiser (avant/après `temporal` et `taau`), pas les régler.
- **Le plafond de 32 000 bâtiments** et la canopée IGN qui plante des arbres sur les îlots coupés (même fichier) : décor, hors J2 ;
  la requête de canopée refusée (HTTP 400 WMS-R) aussi.
- **ANALYSE-STREAMING** (6 nov.) : cause 5 (« un rectangle de validité par niveau… ni génération par cellule »), ST5 (mips par soumission),
  ST9 (validité par tuile) — J2-1/J2-2 en reprennent la part imagerie et relief (§3) ; le décor (ST3–ST8) reste à son plan.
- **Q6** : « aucune impulsion de flou aux changements de palier », I4 complet, l'articulation du temporel natif et de la TAAU (I2) —
  J2-6 ; Q6t, I6–I8 hors J2.
- **C0-4** : §5 (validité par tuile, publiée avec ses mips ; l'occupant précédent jamais effacé avant d'être prêt), §6 (clé source +
  génération), les fenêtres d'imagerie à 8 tuiles, « mesurer le scintillement en vol » (T9, reste) — non faits.

## 3. Les lots

D'abord **les lots qui ne changent pas l'image en régime** (J2-0 à J2-2 : instruments, publication, hauteurs), puis **ceux qui la
changent** (J2-3 à J2-7), chacun avec **une planche avant/après et un ΔGPU sur J0 sur kerr-mini** (A/B A B B A, `ab-commit`), le palier
remesuré sur le M1 Max refroidi aux étapes (J2-1, J2-6, sortie). Chaque lot qui touche une passe, une cible, une table ou une étape de
chargement met à jour [GRAPHICS-PIPELINE](GRAPHICS-PIPELINE.md) dans le même lot.

| Lot | Contenu | Remplace / retire | Preuve |
|---|---|---|---|
| **J2-0** ✅ (12 nov.) | **Les contrats (§5) et les instruments** : sonde de **fuite** (un mode de diagnostic qui remplit l'extérieur valide de chaque fenêtre et les emplacements non publiés d'une couleur sentinelle, compte ses pixels en vue rasante aux bords de fenêtres et aux distances des mips 2–4) ; sonde de **couture** (bords de tuiles, C0-12) ; courbe de **netteté par image** (énergie du laplacien sur `sceneColor` contre la référence affinée, `motion-quality`) le long d'un vol avec arrêts et reprises (changements d'échelle) ; compteurs de **publication** (octets, soumissions, ms de `put*`/mips par image) ; localisation des points blancs avant/après la reconstruction | — | **fiche de référence J2** sur le code actuel (kerr-mini, M1 Max) : fuite, coutures, creux de netteté, coût de publication **chiffrés** ; revue de Sam |
| **J2-1** ✅ (12 nov.) | **La table de pages de l'imagerie, versionnée** : une **validité par tuile** (bits par niveau, C0-4 §5) et une **génération par page** (clé source + génération, §6) ; écritures et mips **regroupées dans un encodeur par image** sous un budget d'octets et de mips (ST5), publiées à l'image suivante seulement (bit allumé avec ses mips ; l'occupant précédent jamais lu une fois remplacé) ; la table figée dans `FrameDesc` pour l'image ; adressage et filtrage inchangés | la soumission par tuile et par couche (`orthoMips`) ; le rectangle par niveau **pour l'imagerie** ; le compteur global `imagery` | l'image en régime identique (A/B d'images figées en raster, ±1 %) ; `tile-arrival` : temps de couverture non dégradés ; aucune pointe de publication > 2 ms, CPU p95 de J0 ; ΔGPU J0 nul ; une seule soumission de mips par image (compteur) |
| **J2-2** ✅ (12 nov.) | **Les hauteurs dans la même publication** : validité par tuile (ST9), génération ; format inchangé (`r32uint`, lecture manuelle, la même sur le CPU) ; `changes` dérivé de la table ; le **sol de contact** (§19.4) ne change pas | le rectangle par niveau des hauteurs | `heightAt` CPU = GPU (tests unitaires) ; le contact et le train (tests, une recette de `apprendre-avions`) ; A/B d'images figées ; ΔGPU nul |
| **J2-3** ✅ (13 nov., réduit ; levier allumé le même jour) | **Des bords sans fuite** : le fondu de bord **à l'échelle de l'empreinte filtrée** (mip choisie × anisotropie) au lieu de 2–48 texels fixes ; la sélection des niveaux nettoyée (`duv`, `nf`, `TUNE_ANISO` réduit à ce qu'il fait) ; **gouttières** (copie des voisins par mip, comme `SURFACE_GUTTER`) **seulement si** J2-0 montre une fuite à l'intérieur d'une fenêtre | le fondu fixe ; le reliquat de `earthImageryAniso` | sonde de fuite à **0 pixel** ; coutures ≤ 0,25 px (C0-12, vol bas) ; planche rasante aux bords de fenêtres ; ΔGPU J0 |
| **J2-4** (étape A mesurée 13 nov.) | **L'invalidation locale** : le sol écrit dans l'identité **sa page et sa génération** (une plage réservée des objets ; aujourd'hui 0) ; le temporel coupe le poids de l'historique là où la page d'un pixel a changé (le mécanisme du rejet (b), `ID_REPUBLISHED`) ; les arrivées de tuiles et d'imagerie **cessent d'appeler `invalidate()`** | `earthTiles.onChange → invalidate()`, l'invalidation à l'arrivée d'imagerie (`renderer.ts:1817`, `:4291`) ; puis, si la mesure le permet, celles du décor et du pilote régional | séquence d'arrivées en vol : 0 invalidation globale, pop de luminance ≤ 3 % hors des pages changées (C0-12), aucune image ancienne qui traîne sur une page neuve ; planche ; ΔGPU J0 |
| **J2-5** ✅ (13 nov. ; sans gain mesuré, +0,43 ms : retiré en J2-8 le même jour) | **La désocclusion** : la profondeur de l'image d'avant gardée (copiée en fin d'image comme l'identité) ; un test de désocclusion — la profondeur reprojetée comparée à celle de l'image d'avant au point d'historique — en plus du clamp 3 × 3 ; un pixel désoccluse repart de la frame (poids d'historique coupé) ; **le sort de `rigidMotionOn` tranché ici** (un lecteur réel — par exemple la géomorphose, §7.4 — ou son retrait en J2-8) | la reprojection sans test de profondeur pour le rigide | `ghost` et `motion-quality` en virage (silhouettes du relief sur le ciel, bâtiments, appareil) ; planche ; ΔGPU J0 |
| **J2-6** (un seul historique : allumé le 13 nov. ; l'échelle variable : non — l'épingle gardée) | **Une reconstruction, l'échelle variable sans pulsation** : quand la TAAU tourne, le temporel natif sans historique long (ou fondu dans la TAAU : un seul historique, à la sortie, §7.18) ; l'échelle interne changée **par petits pas** sans rééchantillonner l'historique de sortie ; l'arrêt et la reprise sans saut d'échelle (l'affinage à la taille de la sortie) ; puis l'épingle `want = rasterTop()` retirée — la résolution dynamique gouverne aussi le raster, au plancher du profil (§8.1 : 2/3 par axe, 0,5 sur preuve) | l'épingle (`main.ts:8957`), le saut 0,75 ↔ 1 à l'arrêt, le double historique long | courbe de netteté le long du vol de J2-0 : **aucun creux > 3 %** à un changement d'échelle ; `motion-quality` en virage ; J0 : intervalle p95/p99 et ΔGPU ; planche (vol, arrêt, reprise) |
| **J2-7** (Terre : cadence 1 depuis le 13 nov. ; corps : gouverneur gardé) | **Le taux d'ombrage local** (§7.10 : « ajouter ensuite, si utile ») — **à décider sur mesure** : ce que `shade` (restes du raster) et `bodyLite` couvrent et coûtent sur J0 et sur la Lune ; s'ils sont faibles, cadence 1 et `adaptRasterRate` retiré ; sinon une cadence locale (mouvement écran, désocclusion, pixels neufs d'abord) au lieu d'un motif global | `adaptRasterRate` global (si la mesure le permet) | la mesure d'abord (pixels, ms) ; puis planche et ΔGPU |
| **J2-8** ✅ (13 nov. : `rigidMotionOn` et la désocclusion retirés ; fiche J0 de sortie) | **Retraits et sortie** | `rigidMotionOn` et ses pipelines `terrainVsMot`/`terrainFsMot`/`ringFsMot`, les champs `pd/pr/pu/pf` de l'uniforme (s'il est resté sans lecteur) ; les chemins remplacés par J2-1…J2-7 ; les adaptateurs datés | **fiche J0 de sortie** (kerr-mini + M1 Max), les mesures de sortie du §4, GRAPHICS-PIPELINE, BH-API, progress-to-destination |
| *J2-C* (option ; **étudiée le 13 nov.**, [fiche](progress/j2/FICHE-J2-C-2026-11-13.md)) | **La compression des pages stables** : une page résidente depuis N s encodée en BC7 sur le GPU (`bc-encode.ts`, déjà dans le code), sa mip comprise ; une page neuve reste rgba8 ; **aucune nouvelle dépendance** | une part de la mémoire de l'imagerie (~195 Mo rgba8 calculés aux portées lointaines) | mémoire mesurée ; PSNR des orthophotos contre rgba8 ; aucune pointe à l'encodage ; fonction `texture-compression-bc` présente sur les machines du labo — **à décider par Sam après J2-1** |

**Le domaine** : la Terre proche (le patch raster et ses anneaux, l'imagerie z 6–18) et la reconstruction de l'image vivante. Hors J2 :
les autres corps (`moon-tiles.ts`, planètes : J5), l'eau (J4), les nuages et leur historique propre (J4), le décor et son streaming (plan
ST), le mode photo et les rendus hors ligne (ils gardent leur accumulation).

## 4. La sortie de J2, en mesures

| Sortie (stratégie §15) | Mesure | Seuil proposé (à valider) |
|---|---|---|
| **Avantage à qualité comparable, en virage** | `motion-quality` (vol figé pas à pas, `TURN` 30°) sur Toulon-Hyères et les Alpes : netteté (énergie du laplacien / référence) et PSNR **au premier instant** et après accumulation ; GPU de la même séquence | à GPU égal, netteté et PSNR au moins égaux à la fiche de référence J2-0 et meilleurs sur un des deux lieux ; **ou** à qualité égale (netteté ± 0,03, PSNR ± 0,5 dB), GPU plus bas |
| **Absence de fuite entre pages** | sonde de fuite de J2-0 (couleur sentinelle hors validité) en vue rasante, bords de fenêtres et mips 2–4, anisotropie 16 ; coutures de tuiles | **0 pixel** sentinelle ; coutures ≤ 0,25 px et pop ≤ 3 % (C0-12, vol bas) |
| **Pas de flou intermittent aux changements d'échelle** | netteté image par image le long d'un vol scripté avec arrêts, reprises et changements forcés d'échelle (`sceneColor`) | aucun creux > 3 % (le pop admissible de C0-12) à un changement ; aucun creux périodique |
| **Invalidations locales** | séquence d'arrivées de tuiles en vol (cache froid, une seule campagne IGN à la fois) | 0 `invalidate()` global par une tuile ; pop ≤ 3 % hors des pages changées |
| **Coût de frame complet** (critère de passage) | fiche J0 : GPU p50/p95, intervalle p50/p95/p99, CPU p95, mémoire, sur kerr-mini et le M1 Max (frais et soutenu) | publié avec la répartition par passe ; **le chemin vers §8 écrit** : la part « reconstruction et sortie » (enveloppe 2,0 ms ; aujourd'hui `taau` 3,7 + `temporal` 1,7 ms sur kerr-mini) et « publication » (dans les 2,0 ms de visibilité/terrain), ce que J2 en a gagné et ce qui reste |

Le gain n'est pas le seul critère : un lot qui baisse le coût en floutant l'image, ou qui rend l'image plus nette au prix du palier, se
déclare comme tel ; aucun pourcentage « AAA ».

## 5. Les contrats (à valider)

**Page** (§7.6) : l'unité de résidence de l'imagerie reste **la tuile Web Mercator 256²** dans sa fenêtre toroïdale (une couche par
fenêtre, l'adressage `repeat` : le tore cohérent à l'intérieur). Une page porte : sa clé (source, z, x, y), sa **génération** (12 bits,
bouclée), son état (demandée, écrite, publiée), sa couverture (alpha), ses mips. Les hauteurs gardent leur texture et leur lecture
manuelle ; elles partagent la table (validité, génération), pas le format.

**Mips** : par page, 256² → 16², moyennées en lumière linéaire et prémultipliées par la couverture (inchangé) ; au-delà, le niveau plus
grossier de la pyramide. **Une page n'est publiée qu'avec toutes ses mips.**

**Bords et gouttières** : à l'intérieur d'une fenêtre, pas de gouttière (le voisin filtré est le vrai). Au bord d'une fenêtre ou d'un
emplacement non publié, **le poids de la page tombe à 0 avant que l'empreinte filtrée (mip × anisotropie) n'atteigne l'autre côté** :
garantie mesurée par la sonde de fuite. Une gouttière (copie du voisin par mip) n'est ajoutée que si la mesure montre une fuite que le
fondu ne couvre pas.

**Publication versionnée** (§7.19) : les écritures du réseau vont dans un emplacement **non publié** ; la table publiée est figée par
image (`FrameDesc`) ; une page passe à « publiée » à une frontière d'image, avec un budget d'octets et de mips par image ; l'ancien
occupant n'est jamais lu une fois son bit éteint ; une réponse d'une génération périmée est jetée (comme `gen` aujourd'hui).

**Invalidations locales** : un changement de page (arrivée, raffinement IGN sur Terrarium, nuit/jour, retrait) se voit **par pixel**
via l'identité du sol (page + génération) ; le temporel en coupe le poids d'historique localement ; **aucun effacement global** pour une
page. Restent globaux : le changement de corps, de monde, de portée (`setReach`, textures refaites), un saut de caméra.

**Désocclusion** : un pixel dont l'historique pris à la position reprojetée ne montre pas la même surface (profondeur de l'image d'avant
incompatible, ou identité absente pour un mobile — le rejet (b)) repart de la frame. La reprojection du rigide reste par la caméra et la
profondeur, sauf si J2-5 montre un besoin du mouvement analytique.

**Reconstruction** (§7.18) : **un seul historique long** pour l'opaque de l'image vivante (à la taille de la sortie quand la TAAU tourne) ;
l'échelle interne, la gigue et la cadence d'ombrage publiées par image ; un changement d'échelle ne rééchantillonne pas l'historique de
sortie.

## 6. Bibliothèques (§18)

- **Basis/KTX2** (présent : `vendor/basis`, `ktx2.ts`, `ktx-worker.ts`, `build-ktx2.ts`) : pour les assets **préparés hors ligne** ;
  pas pour les pages dynamiques (§18.6 : pas d'encodeur coûteux sur le chemin urgent). Le chemin d'une page stable compressée au jeu
  passe par **`bc-encode.ts`** (BC7 mode 6 sur le GPU, déjà employé par `hd-maps.ts`) : J2-C. **À vérifier** : la fonction
  `texture-compression-bc` sur kerr-mini, le M1 Max et kerr-pc ; la qualité du mode 6 seul sur les orthophotos ; la copie d'une région
  de mip dans un tableau BC7 (alignement 4 × 4 jusqu'à 16²) ; ASTC sur les appareils sans BC.
- **webgpu-utils** (dépendance de développement depuis J1-0, `scripts/gen-layouts.ts`) : étendre le générateur aux nouvelles structures
  (table de pages, uniforme du temporel `TA`) au lieu d'offsets à la main ; à vérifier : `post.wgsl` n'est pas encore couvert.
- **Effect** (§18.3 situe son pilote « pendant J2 », au coordinateur de streaming) : **pas dans les premiers lots** — la publication de
  J2-1 est un travail synchrone de la frame, pas une coordination asynchrone ; à réexaminer avec ST2 (`StreamScheduler`) si l'annulation,
  les erreurs et la contre-pression de l'amont en bénéficient réellement.
- **WebGPU Inspector** (outil de développement, hors bundle) : utile pour vérifier les mips et les bords d'une couche en J2-0 ; non installé.
- Rien d'autre : ni SVT générique (§7.16 : un système paginé simple et déterministe d'abord), ni portage FSR2 dans J2 (§7.18 : chantier
  identifié, pas un paquet ; il reprendrait ces contrats).

## 7. Risques

- **Compilation** : J2-3/J2-4 touchent `earthImagery*` et l'identité du sol, donc les noyaux `shadeLite`/`shadeLiteLight` (re-spécialisés,
  cascade raster) : `kernel-budget` et `check-wgsl` à chaque lot, compilation à froid de l'entrée de J0 remesurée à la sortie (J1-6 :
  sol à 9,2 s après le placement). Les passes `temporal`/`taau` sont petites ; J2-6 peut en changer la structure (une entrée de moins).
- **Mémoire** : la profondeur de l'image d'avant (+~8 Mo à 1920 × 1080 en `r32float`, calculé) ; les emplacements où une page s'écrit
  avant d'être publiée — **à concevoir en J2-1** : réserver quelques emplacements libres par couche plutôt que doubler une fenêtre ;
  d'éventuelles gouttières ; en face, J2-C et le double historique retiré (J2-6 : deux `rgba16f` W × H de moins, ~16 Mo chacun
  calculés).
- **Réseau** : les sondes de chargement à froid (J2-0, J2-4) frappent la Géoplateforme : **une seule campagne IGN lourde à la fois** sur
  les deux Mac (même adresse IP → 429), e2e de 1–2 min ciblés, tuiles bloquées quand la mesure ne porte pas sur elles.
- **Mesure** : le M1 Max bride en quelques minutes (J0 : soutenu 33,4/s) — les A/B sur kerr-mini, le palier sur le M1 Max refroidi ; les
  passes de rendu se chevauchent sur Apple (GP-09) : ΔGPU sur la frame entière, jamais une somme de passes.
- **Sol de contact** : J2-2 touche la publication des hauteurs, donc `heightAt` et le train ; le contact appartient au monde (§19.4),
  la qualité graphique ne doit pas le changer.

## 8. Ce que J1 laisse à retirer pendant J2

**`renderer.rigidMotionOn`** (`renderer.ts:5618`) : le mouvement analytique du sol et du décor immobile (z −1), éteint, **sans lecteur**
(`temporal`, `taau` et le flou de mouvement ne lisent que z > 0,5) ; coût nul éteint, ~+0,8 ms allumé (version antérieure). Propriétaire
J1-2 (`terrain-raster.ts` `buildGround(motion)`, `scenery-raster.ts` `rigidMotion`). **Condition** (PLAN-J1 J1-7) : retiré à la fin de
J2 s'il n'a pas de lecteur, avec ses pipelines `terrainVsMot`/`terrainFsMot`/`ringFsMot` et les champs `pd/pr/pu/pf` ; un lecteur venu
(J2-5), le format `rg16float` du contrat se tranche avec lui. Restent aussi, sans changement : `decodeSurface` (contrôle de l'e2e
`surface-id`, chemin des corps sans identité ; propriétaire J1-2).

## 9. Questions pour Sam

1. **Ce plan et son ordre** (J2-0 → J2-8, les lots sans changement d'image d'abord) — *recommandation* : oui ; J2-0 tout de suite (il
   chiffre la fuite et la pulsation sur le code actuel : une fuite nulle mesurée rendrait J2-3 très court).
2. **Le domaine** : la Terre proche seulement (Lune et planètes à J5) — *recommandation* : oui.
3. **Les fenêtres d'imagerie à 8 tuiles** (C0-4 §2 ; T8e coupé par la décision 38) — *recommandation* : **garder 4** dans J2 ; ne les
   rouvrir qu'avec J2-C (la mémoire) et une vue qui en montre le gain.
4. **La compression BC7 des pages stables** (J2-C) — *recommandation* : une étude mesurée **après J2-1**, pas avant ; pas de nouvelle
   dépendance.
5. **Un seul historique long** (J2-6 : le temporel natif court ou fondu dans la TAAU) — *recommandation* : oui, mesuré par `motion-quality`
   et J0 ; c'est la condition pour faire varier l'échelle sans pulsation.
6. **Le plancher d'échelle en vol** une fois l'épingle retirée — *recommandation* : 2/3 par axe dans le profil qualité (§8.1) ; 0,5
   seulement avec sa preuve de qualité (désocclusion comprise).
7. **L'identité du sol** = page + génération dans le mot `r32uint` existant (une plage d'objets réservée au sol) — *recommandation* : oui
   (pas de nouvelle cible).
8. **`rigidMotionOn`** — *recommandation* : le retirer en J2-8 si J2-5 n'en fait pas un lecteur mesuré.
9. **Le recouvrement avec le plan du streaming** (ST5 pour les mips, ST9 pour la validité par tuile) — *recommandation* : J2-1/J2-2 les
   absorbent pour le sol, ANALYSE-STREAMING le note ; le décor reste au plan ST.
10. **Effect** — *recommandation* : pas dans J2-1 ; réexaminé avec ST2.

**Décision de Sam (12 novembre 2026, ~12:21 UTC) : « Je valide les recommandations »** — les dix réponses ci-dessus valent décision :
le plan et son ordre (J2-0 lancé le même jour) ; la Terre proche seulement ; les fenêtres d'imagerie gardées à 4 ; BC7 étudiée après
J2-1 ; un seul historique long (J2-6) ; plancher d'échelle en vol 2/3 par axe (0,5 seulement avec sa preuve) ; l'identité du sol = page
+ génération dans le mot `r32uint` ; `rigidMotionOn` retiré en J2-8 si J2-5 n'en fait pas un lecteur mesuré ; J2-1/J2-2 absorbent ST5 et
ST9 pour le sol ; pas d'Effect dans J2-1. Les contrats du §5 sont donc validés tels qu'écrits ; chaque lot qui change l'image garde sa
preuve (planche avant/après, ΔGPU sur J0).

## 9 bis. J2-0 fait (12 novembre 2026)

Instruments (éteints par défaut, coût nul éteint ; BH-API, GRAPHICS-PIPELINE F5/E5) : `earthTiles.leakProbe` (+ `probePublished`, témoin
positif `{ control: true }`), `earthTiles.pubProbe`/`pubLog`/`pubStats`, `renderer.sharpProbe`/`sharpLog` (`src/frame-probes.ts` : énergie
du laplacien, points blancs comptés à part), `renderer.stageProbe`/`sceneStages()`, `renderer.invalidations` ; e2e `j2-probes`, mesures
`tests/e2e/lib/j2-probes.ts`, `scripts/j2-fiche.ts`. Chiffres : [fiche J2-0](progress/j2/FICHE-J2-0-2026-11-12.md). Ce qu'ils changent au
plan :

- **Fuite** : 0 pixel imputable aux pages sur deux vues rasantes (témoin positif 0,67–0,71 Mpx) → **J2-3 se réduit** au nettoyage de la
  sélection des niveaux et à la sonde sur plus de vues (vol, virage) ; les gouttières ne sont pas justifiées par la mesure.
- **Échelle** : une pause ne change pas l'échelle en vol raster (§2.2 corrigé) ; un changement **forcé** fait un pic d'énergie de +44 à
  +118 % (l'historique perdu) qui retombe en ~0,3 s → J2-6 garde son objet ; critère proposé : |écart| ≤ 3 % (creux **et** pic).
- **Invalidations** : en mouvement `invalidate()` est appelé à chaque image et ne touche pas l'historique → l'invalidation d'une tuile ne
  coûte rien au vol raster ; J2-4 porte sur les vues tenues/convergées et sur l'invalidation locale du sol (identité).
- **Publication** : 8 % des images du vol au-delà de 2 ms du fil principal sur kerr-mini (max 9,5 ms), jusqu'à 9–11 soumissions de mips par
  image → la cible de J2-1 (une soumission par image, aucune pointe > 2 ms) est chiffrée ; le coût est l'écriture, pas les mips.
- **Points blancs** : nés avant le temporel (image résolue), gardés par lui, étalés par la TAAU ; 113/s sur le M1 Max, 0,23/s sur le mini ;
  cause ouverte (PROBLEMES-A-REGLER).

## 9 ter. J2-1 fait (12 novembre 2026)

**Étape A** (recommandation 4 de la fiche J2-0) : le blocage de page de la première sonde **n'est pas reproduit en jeu** (e2e
`j2-page-camera`, kerr-mini : quatre vues de 15 s en vol de chargement, aucune lecture sans réponse, écart rAF ≤ 80 ms), **mais le trou
existe** : caméra 1,5 km devant l'appareil, 190 images sur 761 avec un niveau publié sans la tuile de la caméra, jusqu'à 1,5 s avec le sol
sous elle en z 14 au lieu de z 17 ; deux causes — le rectangle d'un niveau incomplet grandi autour du centre des chargements, la fenêtre
menée vers le regard dont la caméra sort. **La règle de validité de J2-1 couvre la caméra** (rectangle tenu d'abord autour de sa tuile,
sa tuile chargée la première, fenêtre recentrée à 0,2 tuile du bord) : 0 image trouée après. **L'appareil** : quand la caméra est loin,
sa tuile est hors des fenêtres fines (qui suivent la caméra) — le sol de contact relève du monde (§19.4) et de **J2-2**, pas de la
qualité graphique : relevé, non traité.

**J2-1** (`src/system/earth-pages.ts`, `EarthTiles.publish`, appelé au début de chaque image) : une page par emplacement (clé publiée,
hauteurs publiées, génération 12 bits), écrite et publiée à une frontière d'image sous un budget du fil principal (1,5 ms ; 2 ms en
rattrapage ; au moins une), la plus proche de la caméra d'abord ; **toutes les mips de l'image en une soumission** ; un rectangle ne
grandit que sur des pages publiées ; `heightAt` lit les hauteurs publiées ; `imagery` = la version de la table ; `frameDesc.pages`. Mesuré
(fiche J2-1) : **image inchangée** (A/B figé dans le bruit entre deux captures du même code, luminance à 0,03 %) ; vol J0 sur kerr-mini :
soumissions de mips max 9 → **1**, images > 2 ms du fil principal 79 → **31**, publication dans l'image p95 1,7 / max 2,3 ms, octets
max 6,75 → 2,0 Mio ; **ΔGPU J0 nul** (GPU p50 −0,3 ms, dans l'écart A–A de 0,4 ms ; A B B A). **Écarts au plan** : le GPU lit toujours un rectangle par niveau (dérivé de la table —
format transitoire jusqu'aux bords par page, J2-3) ; « aucune pointe > 2 ms » pas encore tenu (le travail des arrivées hors de l'image :
jusqu'à 5,7 ms) ; `tile-arrival` non relancé ; pas de file d'emplacements libres (inutile : une page est écrite avant toute soumission de
l'image, ou hors du rectangle tant qu'elle n'est pas publiée).

## 9 quater. J2-2 fait (12 novembre 2026)

**La question 1 de J2-1, tranchée par CLAUDE.md** (« la qualité graphique ou le déplacement de la caméra ne doivent pas décider du sol de
contact de l'appareil ») : **le monde tient le sol de contact**. `EarthTiles.groundAt` — le sol de `sys.groundAt`, `heightOverGround`,
du train, des autopilotes, de l'Auto-GCAS — est le sol dessiné (`heightAt`, le CPU = le GPU de J2-1) **là où il tient le niveau de
contact en entier**, sinon les hauteurs de ce niveau autour de l'appareil, que le monde tient (`setAnchors`, appelé par le renderer pour
l'appareil piloté sous 1 500 m) : les mêmes tableaux que les fenêtres et le cache (aucune deuxième copie), chargés par le même
chargeur quand aucune fenêtre ne les veut, la même file IGN en tête. Le niveau de contact (`contactLevel`) : z 17 de l'IGN dans les boîtes
nationales, z 14 ailleurs — ni la caméra ni la qualité. Caméra à bord : exactement le sol dessiné (rien d'autre échantillonné).

**Mesuré** ([fiche J2-2](progress/j2/FICHE-J2-2-2026-11-12.md), kerr-mini, A/B contre J2-1) : F-35B **posé** sur le flanc du Faron,
caméra à 1,5 puis 3 km puis revenue — avant, le sol sous l'avion immobile suit la caméra (z 16 à 3 km ; au retour, z 14 quelques images :
**+0,83 m**, l'avion soulevé de 0,56 m) ; **après, constant au millimètre**, hauteur du train 1,183–1,185 m. En vol sur la Beauce, caméra
1,5 km devant : avant, 37 % des images avec le sol de contact d'un niveau plus grossier (jusqu'à 2 m d'écart sur la plaine) ; **après,
z 17 sur 100 % des images**. `changes` dérivé de la table (toute page publiée dans le rectangle). **Image inchangée** (A/B d'images
figées A B B A, dans le bruit, luminance à 0,05 % — sur le M1 Max : kerr-mini a quitté le réseau) ; `gear`, `landing` verts ;
**ΔGPU J0 non mesuré** (attendu nul : rien de changé au GPU) — à faire au retour du mini. **Écarts au plan** : la preuve
« `heightAt` CPU = GPU » est un test des mots écrits au GPU (les bits des hauteurs lues), pas une lecture du GPU ; le contact et le train
vérifiés par l'e2e `j2-contact-camera` et les vols `gear`/`landing` (pas une recette d'`apprendre-avions` : le contact voulu ne change
pas, seul son indépendance à la caméra) ; les ancres servent l'appareil piloté seulement (les autres appareils au sol — trafic, ailiers —
gardent le sol dessiné). **La question 2** (les pointes du fil principal) : localisée, non bornée — `request()` jusqu'à 7 ms en vol et
14–20 ms au chargement, la publication au-delà de son budget (fiche §4, PROBLEMES-A-REGLER) ; le travail des arrivées ≤ 0,5–1,7 ms.

**Décisions de Sam (12 novembre 2026, ~15:40 UTC)** sur les trois questions de la fiche J2-2 : (1) **ancrer aussi un autre appareil, mais
seulement quand la caméra le suit** (vue sur un appareil : poursuite, autour, tour, à bord), et **seulement après avoir reproduit le saut**
sur un avion de l'IA posé, avec le même e2e que pour le F-35 ; (2) **le seuil de 1 500 m est gardé** ; (3) **le lot des pointes du fil
principal (`request()`, publication) est fait avant J2-3**. **(1) fait le même jour** : saut reproduit sur un A320 de l'IA garé
(+0,10–0,13 m quand la caméra qui le suit passe à 3 km), puis l'appareil suivi par la caméra libre ancré à son tour (`subjectFocus`,
chaque ancre menée par son id) — fiche J2-2 §3 bis. (3) : fait le même jour, §9 quinquies.

## 9 quinquies. Le lot des pointes du fil principal fait (12 novembre 2026)

**La question 2 de J2-2** (décision (3) de Sam : avant J2-3) — le critère de J2-1 « aucune pointe du fil principal > 2 ms due aux
tuiles » en vol J0, [fiche](progress/j2/FICHE-J2-pointes-2026-11-12.md). **Profil** (M1 Max) : la pointe de `request()` n'était pas le
balayage (≤ 0,4 ms en vol) mais **les démarrages groupés** — un `load` ≈ 0,3 ms, ses `fetch` ; 8 d'un coup après un pas de fenêtre 2,1–3,3 ms
— et **le regard du halo** (1,6–2,7 ms) ; au chargement, le balayage répété à chaque arrivée. **Fait** : un budget des tuiles de **2 ms du
fil principal par image** (`FrameBudget`, `earthTiles.frame` : ouvert à la fin de chaque image, la publication prend ce que les démarrages
d'entre deux images ont laissé) ; les démarrages sous ce budget dans leur ordre (l'appareil piloté, la tuile de la caméra, les fenêtres par
anneau, les orthophotos, le halo), jugés sur un coût haut (le 2ᵉ plus cher des 8 derniers), le reste à l'image suivante, un au moins après
3 images sans ; une arrivée qui ne relance `request()` qu'une fois par image ; le halo par tranches de 0,5 ms et mémorisé par niveau
entier ; la publication estimée par octets, sa queue (`complete`, mips) dans son budget ; plus d'allocation par page (hauteurs écrites
sans copie, tampons réutilisés). **Mesuré** (M1 Max, A/B A B B A refroidi avant chaque passage, kerr-mini hors réseau) : voir la fiche §3
(vol J0), §4 (image figée inchangée à RMSE 0,003 ; couverture à froid `tile-arrival` en rejeu équivalente — une régression d'une variante
intermédiaire, 5 × plus lente, trouvée et corrigée). **Écarts au plan** : le critère « aucune pointe > 2 ms » n'est **pas tenu
strictement** (§3 de la fiche : des images à 2,1 ms à la résolution du chronomètre, et de rares pauses dans l'enregistrement d'une
arrivée, hors des chemins bornés) ; la mesure n'est pas faite sur kerr-mini ; les `fetch` restent sur le fil principal.

## 9 sexies. J2-3 fait, réduit (13 novembre 2026)

Sous les recommandations de la [fiche J2-0](progress/j2/FICHE-J2-0-2026-11-12.md) §8 (questions 1 et 5 : J2-3 réduit, sans gouttières ;
les coutures par la géométrie) — **non encore confirmées par Sam** : le changement d'image est derrière un levier **éteint**.
[Fiche J2-3](progress/j2/FICHE-J2-3-2026-11-13.md). **Fait** : la sélection des niveaux nettoyée (`duv`, `nf` retirés ; les dérivées de
l'empreinte une fois pour tous les niveaux ; `TUNE_ANISO` réduit à ce qu'il fait — le choix du niveau) ; **le fondu de bord de l'imagerie
à l'échelle de la lecture filtrée** (`earthTiles.edgeFoot`, `trace.wgsl` `edgeWeight` : 0 tant que la lecture du matériel peut passer le
bord, 1 à 12 texels au-delà ; porté par `P.tiles.w` = 2, sans compilation ; les hauteurs gardent le fondu fixe, J2-2) ; e2e `j2-probes` :
une vue en diagonale des tuiles (`hyeres-diag`), les phases `edge` (A B A figé) et `seams` (coutures par la géométrie : l'inverse de la
profondeur de vue, affine sur un plan, paires entre deux niveaux contre paires d'un même niveau ; la géomorphose éteinte comme témoin
positif). **Mesuré** (M1 Max, kerr-mini hors réseau) : fuite levier allumé **0 pixel imputable** sur trois vues (témoins positifs
0,68–0,74 Mpx) ; l'image ne change qu'en lignes le long des bords de fenêtres (le niveau fin rendu jusqu'à 36–40 texels plus près de son
bord), écart moyen dans la dérive du témoin, aucune couture à l'œil ; GPU dans le bruit à Hyères, non conclu dans les Alpes (le Mac en
pression thermique « Heavy »). **Coutures par la géométrie** (la fissure : les deux côtés prolongés, un pli continu compté 0) : **C0-12 tenu au p95**
— Alpes 0,004 px, vers La Crau 0,18 px, plaine du Gapeau vue plongeante 0,069 px (sa vue rasante, 0,77 px : des crêtes) ; la sortie de J2
pour les coutures est mesurée (phase `seams`). **Reste** : le ΔGPU sur J0 (kerr-mini), la décision d'allumer le levier ; les gouttières non faites (pas de fuite).

## 9 septies. J2-4, étape A : ce que fait aujourd'hui une page republiée (13 novembre 2026)

> **Correction (même jour, ~05:10 UTC) — les mesures de traîne ci-dessous jusqu'à « Où traîne la page » étaient fausses** : une fois le
> témoin positif allumé, `leakProbe(couleur)` ne repeignait que les emplacements **non publiés** — les pages publiées gardaient le vert, la
> « page neuve » n'existait pas (signature magenta −0,262 avant, −0,265 après) ; les 48 % à 66 images, l'historique natif « qui traîne », les
> A/B de `singleHistory` en vue tenue et de `heldFreshBox` mesuraient de la dérive. **La sonde corrigée** (`earthTiles.leakProbe` : témoin
> allumé, une nouvelle couleur repeint aussi les pages publiées — 669 086 pixels changés) : **vue tenue** — l'entrée du temporel montre la
> page dès la 2ᵉ image, l'historique natif suit à ~α 0,1 (le sol porté : 10 % à 2 images, 67 % à 16, 99,5 % à 66), l'image **60 % à 9
> images, 82 % à 22, 96 % à 66** (une traîne d'**~0,5 s**) ; **en mouvement** — 82 % à 3 images, 93 % à 10. **Avec `singleHistory`**
> (J2-6, §9 octies (d)) : vue tenue **72 % à 3 images, 86 % à 10, 92 % à 23** — la TAAU seule traîne encore un peu —, en mouvement 88 % à 3 ;
> bruit d'une vue tenue (deux lectures à 8 images) **0,41 → 0,54 %** (C0-12 : ≤ 1 %). Le texte qui suit est gardé tel qu'écrit.

Mesure avant tout code (e2e `j2-probes`, phase `trail`, M1 Max, `hyeres-low` ; kerr-mini hors réseau) : la sonde de fuite repeint **toutes
les pages publiées** d'imagerie (vert, réglé, puis magenta d'un coup) — une arrivée contrôlée —, la couleur de scène relue 2 à 66 images
après, sans `__bh.touch()` (un toucher est une scène changée : une invalidation globale). **Vue tenue** (horloge gelée, `rasterHeldAlpha`
1/48) : **une seule** invalidation globale (celle de la repeinte, cause `tiles`) et la page neuve **traîne** — après 66 images (~1,1 s) le
pixel moyen n'a fait que **48 %** du chemin, 21 % des pixels repeints au-delà de 90 % ; l'historique tenu (α 1/48, puis celui de la TAAU)
n'est pas coupé par `invalidate()` en raster (J2-0). **C'est le défaut que vise J2-4** (« aucune image ancienne qui traîne sur une page
neuve ») : l'invalidation globale n'y sert à rien en raster, la coupe locale par l'identité du sol (page + génération) l'y remplacerait.
**En vol** : non mesuré (la sonde tient les fenêtres, ses lectures sont prises à des places différentes ; en raster en vol l'historique pèse
au plus 0,7, α ≥ 0,3 : une page neuve y passe en quelques images, par le code). Instruments : `renderer.invalidationsBy` (les
invalidations par cause ; `scene` — caméra, réglage, `touch()` — à part), `trailJs`/`trailSigJs`. **Piège trouvé** : les attentes d'e2e
qui appellent `__bh.touch()` à chaque image invalident la vue à chaque image (124 sur 125 dans la première mesure).

**Étape B — la conception, à trancher (relevé du code, 13 novembre)**. La passe de visibilité du sol (`terrain-raster.ts`) ne lit ni les
paramètres des tuiles (`P.tileL`, les fenêtres d'orthophotos) ni la table des pages : elle ne connaît que la grille du cache de hauteurs
(`terrainSurfaceCache`). Le pixel ne sait donc pas, là où l'identité s'écrit, de quelle page d'imagerie il tient sa couleur. Trois voies :

1. **L'identité du sol écrite par la passe de visibilité** (le contrat validé, décision 7) : lui lier les paramètres des tuiles et une table
   des générations par page (un tampon de ~1 000 mots, réécrit à la publication), calculer au fragment la page la plus fine qui couvre le
   point (comme `earthImageryAniso`, sans la lire), écrire `page | génération` dans une plage d'objets réservée au sol ; `identityKept`
   traite cette plage comme « sol » (pas comme un objet : sinon la coupe des arbres apparus sur le sol ne marche plus), et coupe
   l'historique tenu là où le mot a changé, sur un drapeau « pages publiées cette image ». Coût : un calcul de tuile par pixel du sol, une
   liaison de plus ; un lot de plusieurs jours, sa planche et son ΔGPU.
2. **La page écrite par `shadeLite`** (qui lit déjà l'imagerie et en connaît les poids) dans l'identité : moins de calcul, mais `shadeLite`
   n'ombre qu'une partie des pixels par image en vue tenue (`rasterRate`) et la passe de visibilité efface l'identité à chaque image —
   des mots manquants, des coupes parasites.
3. **Sans identité** : dans la vue tenue, un clamp de l'historique **à l'échelle du bruit** (la boîte 3 × 3 élargie de k écarts-types,
   au lieu de rien) — un changement réel (une page, un arbre, une ombre) passe en une image, le bruit du quart d'ombrage continue de se
   moyenner. Générique (toutes les arrivées, le décor compris), peu de code, mais **hors du contrat** de la décision 7 et sans « où » ni
   « quoi » (pas d'instrument par page).

**Où traîne la page (lu dans `post.wgsl`, 13 nov.)** : en vue tenue, le sol est « porté » (`TA.drift.w` < 0) — le temporel le prend au même
pixel, **sans écrêtage**, à α 0,1 (seul, une page neuve y passerait à 90 % en ~22 images) ; la TAAU garde ensuite **son propre historique
long** (n jusqu'à 1/`rasterHeldAlpha` − 1 = 47), écrêté sur le résultat natif à g σ, et c'est elle que lit l'image (et `sceneColor`). **Corrigé
le même jour par la mesure** : un historique unique (`singleHistory`, J2-6 étape A ci-dessous — le temporel natif court, la TAAU seule
longue) ne change pas cette traîne (48 % à 66 images avec ou sans) ; elle n'est donc pas, ou pas seulement, le double historique : **établi
par étage** (même jour, `J2_STAGES=1` : la signature magenta relue à l'entrée du temporel, dans son historique et dans la TAAU) : en vue
tenue raster la phase reste « realtime » (pas de passation à l'affinage), et **c'est l'historique natif qui traîne** — 6 % du chemin à 3
images, 37 % à 66 —, la TAAU le suivant (11 %, 47 %) ; ni la cadence d'ombrage (1 ou 2 : 51 % contre 48 % à 66 images) ni le posemètre
(exposition fixe) n'y sont pour quelque chose. Le mécanisme : vue tenue, α minimal `rasterHeldAlpha` (1/48) et une boîte d'écrêtage (g σ
du voisinage) **élargie par le bruit de l'ombrage partiel** — la nouvelle page y tient, elle n'est que moyennée, plus lentement encore pour
les pixels reconstruits (leur poids `TA.k.w`). **Essayé et retiré le même jour** : la boîte d'écrêtage
prise sur les seuls échantillons frais à toute cadence partielle (levier `heldFreshBox`, A/B : 33,4 contre 33,6 % du chemin à 66 images pour
l'historique natif, bruit tenu 0,41 → 0,48 %) — **sans effet**, et pour cause : `carryGround` étant vrai, le sol d'une vue tenue prend le
chemin « porté » (α 0,1, **sans écrêtage**), que la boîte ne touche pas ; et ce chemin seul ferait 27 % à 3 images, pas 6–13 % : **le
mécanisme exact reste ouvert** (l'entrée du temporel elle-même — l'ombrage partiel, les pixels reconstruits — à relire en valeurs brutes).
Pour J2-4 : la voie 3 (un écrêtage à l'échelle du bruit) ne suffirait donc pas telle quelle ; une
voie plus simple encore — rendre au temporel tenu son α de vol (`RASTER_LITE_ALPHA`) quelques images après une publication de pages — le
ferait en entier, mais globalement (une bouffée de bruit d'une seconde sur toute l'image tenue).

**Une quatrième voie, mesurée depuis** (sonde corrigée, §9 septies) : `singleHistory` (J2-6) fait déjà passer une page neuve à **72 % dès
3 images** en vue tenue (contre ~0 aujourd'hui ; 82 % en mouvement à 3 images avec ou sans) — le critère « aucune image ancienne qui traîne
sur une page neuve » presque tenu **sans identité ni invalidation locale**, neutre en vol, pour +0,13 point de bruit tenu. *Recommandation
révisée* : allumer `singleHistory` (après son ΔGPU sur kerr-mini), puis remesurer `trail` ; ne coder l'identité du sol (voie 1) que si une
lecture par page devient nécessaire. Les arrivées de tuiles pourront alors cesser d'appeler `invalidate()` (sans effet en raster, J2-0).

*Recommandation (première, gardée)* : **3 d'abord**, mesurée par la phase `trail` (la page neuve à > 90 % en 2–4 images, la convergence tenue C0-12 ≤ 1 %
gardée), puis 1 seulement si une lecture par page devient nécessaire (J2-5, la sélection, les diagnostics). **Question pour Sam.**

## 9 octies (a). J2-5, étape A : la référence avant la désocclusion (13 novembre 2026)

e2e `motion-quality` (M1 Max, `PLACES=alps MODES=taau75q TURN=30`, code 9526be8f — le profil de J0 : TAAU à 0,75) : virage de 30°
mesuré au premier instant et après accumulation contre sa référence affinée — **PSNR 41,6 dB en mouvement, 42,2 dB à l'arrêt ; netteté
0,93 / 0,92** ; `temporal` 0,56 ms, `taau` 1,41 ms (M1 Max en pression « Heavy » : temps indicatifs). La différence avec la référence (×6)
montre le détail du relief un peu adouci partout (le rééchantillonnage) et **une frange claire le long de la crête sur le ciel** — la
traînée de silhouette que vise J2-5. **Prochaine étape** : la profondeur de l'image d'avant gardée (copie de la profondeur conservée du
raster en fin d'image, comme l'identité), le test de désocclusion au point d'historique dans `temporal` et `taau`, derrière un levier ;
la même mesure, plus `ghost` (l'appareil vu de dessus) ; le sort de `rigidMotionOn` tranché avec.

## 9 octies (b). J2-5 fait : la désocclusion, sans gain mesurable (13 novembre 2026)

[Fiche J2-5](progress/j2/FICHE-J2-5-2026-11-13.md). Derrière `renderer.disocclusionOn` (**éteint**) : la profondeur de l'image d'avant gardée
(les `moments` copiés en fin d'image, levier allumé seulement), un pixel plus loin que les quatre profondeurs d'avant autour de son point
d'historique (3 %) repart sans historique (`temporal`, `taau`). Mesuré (M1 Max) : le levier agit (témoin positif), mais **aucun gain** —
Alpes en virage 46,7 contre 47,4 dB (A B A), La Mancha 19,4 contre 19,0 dB ; la frange de la crête est la même (le bord de silhouette de
la TAAU, pas une traîne). **`rigidMotionOn` n'a pas de lecteur → retiré en J2-8** (décision 8). Piège : le 1ᵉʳ mode d'une série
`motion-quality` lit 5–7 dB plus bas (tuiles en attente) — A B A.

## 9 octies (c). J2-8, premier retrait : `rigidMotionOn` (13 novembre 2026)

J2-5 n'en fait pas un lecteur (la désocclusion lit les profondeurs) → **retiré** (décision 8) : `renderer.rigidMotionOn` et `groundPrev`, les
entrées `terrainVsMot`/`terrainFsMot`/`ringFsMot` et les structures `VertexM`/`GroundOutM` (`terrain-raster.ts` : `buildGround()` sans
mouvement, la cible de mouvement laissée aux maillages mobiles), les champs `pd/pr/pu/pf` de l'uniforme du cadre (13 → 9 vec4 :
`TERRAIN_RASTER_UNIFORM_BYTES`), `rigidMotion` du décor (`scenery-raster.ts`, `ident.y` plus écrit), la vérification « rigide » de l'e2e
`surface-id`. Vérifié : tsc, biome, `check-wgsl` 81/81, e2e `surface-id` 1/0 (identité de la passe = celle de l'adaptateur 49/49 ;
visibilité p50 1,33 ms, M1 Max). Aucun changement d'image (le levier était éteint). Reste à J2-8 : les chemins remplacés par J2-1…J2-7,
les adaptateurs datés, la fiche J0 de sortie.

## 9 octies (d). J2-6, étape A : un seul historique long, derrière un levier — premières mesures sans conclusion (13 novembre 2026)

**Fait** (`renderer.singleHistory`, **éteint** ; décision 5 de Sam) : quand la TAAU tourne, le temporel natif garde un historique **court**
(son α minimal relevé à `singleNativeAlpha` = 0,5 ; le sol porté aussi, `TA.m2.w`) et la TAAU seule l'historique **long** (son α minimal
celui qu'avait le natif, passé dans `TU.u.w` — avant, elle lisait le même `TA.k.z`). Aucune compilation nouvelle (81 / 81).
**Mesuré** (M1 Max en pression « Heavy », un passage par côté) : vue tenue (`trail`) — ~~les premières images un peu plus vite, identique
à 66 images~~ (mesure fausse, §9 septies) ; **remesuré avec la sonde corrigée : la page neuve à 72 % dès 3 images contre ~0, 86 % à 10
contre 60 %, le bruit tenu 0,41 → 0,54 %** ; `motion-quality` (Alpes, virage 30°, A B A après une chauffe) — en mouvement **46,9 contre
47,1 / 47,2 dB** (rien de mesurable), à l'arrêt **48,3 contre 49,1 / 49,1 dB** (−0,85 dB), netteté 0,92 contre 0,93 ; vol J0 (`flight`) — à l'arrêt, l'image en mouvement plus proche de l'affinée
(rapport 0,76–0,83 contre 0,30–0,65), mais au changement d'échelle forcé 0,75 → 0,625 un **pic plus fort** (+280 % contre +12 %) et au retour
0,625 → 0,75 un pic moindre (+213 % contre +348 %) ; l'énergie du laplacien compte le bruit (un natif court en ajoute) : **rien de
concluant**. Temps : 28,1 contre 32,9 ms GPU p50, la chauffe (second passage), pas le levier. **À trancher par Sam** : allumer `singleHistory` — la
page neuve en vue tenue trois fois plus vite, pour +0,13 point de bruit tenu (sous le 1 % de C0-12) ; en virage **neutre** (+0,1 dB contre
une référence à pleine échelle — le « −0,85 dB » d'abord écrit était un artefact, §9 octies (e)) ; aucune pulsation mesurée au changement
d'échelle, avec ou sans. *Recommandation* : l'allumer après son ΔGPU sur kerr-mini. **Reste** : J2-6 proprement dit (l'échelle
par petits pas sans rééchantillonner l'historique de sortie, l'arrêt et la reprise sans saut, l'épingle `want = rasterTop()` retirée) et
une mesure qui sépare netteté et bruit (PSNR contre une référence à chaque événement), sur kerr-mini.

## 9 octies (e). J2-6 : la « pulsation » d'un changement d'échelle, mesurée sans le laplacien (13 novembre 2026)

> **Correction (même jour, ~06:20 UTC) — les comparaisons entre échelles par `motion-quality` étaient fausses** : en raster sans résolution
> dynamique, la « référence affinée à pleine échelle » était une **vue tenue à `earthRasterScale` (0,75)**, jamais convergée — 0,75 flatté,
> toute autre échelle pénalisée (d'où « 0,75 seul bien restitué », « −6,6 dB à 2/3 », « −8 dB à 0,625 ») ; et `__bh.forceScale` d'une autre
> échelle que celle du raster faisait recréer les cibles à chaque image (`main.ts` `resize`, corrigé : l'échelle forcée d'abord). **Remesuré,
> référence à pleine échelle** (`motion-quality` corrigé) : PSNR en virage **2/3 : 30,4 ; 0,75 : 32,4–32,6 ; 0,80 : 34,3 dB** (monotone ; plus
> d'effet d'ordre). Les A/B **à échelle égale** (désocclusion, `singleHistory` à 0,75, `+drop` contre 0,625 constant) restent valides en
> relatif, leurs valeurs absolues non. **L'épingle reste** : 2/3 coûte ~2,1 dB pour ~8 % de GPU. **`singleHistory` remesuré** (référence
> corrigée, A B A) : en virage 32,6 contre 32,5 / 32,5 dB (+0,1 dB, à l'arrêt de même) — **neutre** ; le « −0,85 dB à l'arrêt » était
> l'artefact ; un changement 0,75 → 0,625 8 images avant la capture : 29,7 dB avec ou sans — la « pulsation supprimée par l'historique
> unique » (−0,56 dB) l'était aussi. Le texte qui suit est gardé tel qu'écrit.

e2e `j2-probes` phase `pulse` (nouvelle) : vue tenue (plaine du Gapeau), l'échelle forcée 0,75 → 0,625 puis retour (`forceScale`), la couleur de
scène (sortie de la TAAU, taille du canevas) relue 1 à 64 images après et comparée à la vue réglée après le changement (écart moyen |ΔL| / L ;
`devJs`), contre le bruit de la vue tenue. **Aucune pulsation** : l'écart part de celui des deux échelles (3,2 %), tombe à 2,2–2,5 % dès
l'image suivante puis décroît régulièrement — **0,7 % à 64 images** contre un bruit de 0,25–0,38 % — sans jamais dépasser son point de
départ ; une transition d'environ une seconde, pas un creux. `singleHistory` n'y change rien (0,74 contre 0,73 % à 64 images). Le
« pic d'énergie » de J2-0 en vol (+44 à +118 %) est donc **le bruit d'un historique perdu** — le laplacien compte le bruit —, pas un
flou ; le critère de J2-6 (« |écart| ≤ 3 % » à un changement d'échelle) est **tenu en vue tenue** par cette mesure. **En vol** (même jour,
`motion-quality` Alpes, virage 30°, mode `+drop` : 0,625 forcé 8 images avant la capture) : PSNR en mouvement **0,75 constant 46,2 dB,
0,625 constant 37,8 dB, changement 37,2 dB (−0,56 dB : une petite pulsation, l'historique natif perdu), changement avec `singleHistory`
37,8 dB (= l'échelle réglée : aucune pulsation)** — l'historique long à la taille de sortie traverse le changement : **c'est la condition
de J2-6 pour faire varier l'échelle**, et un argument pour allumer `singleHistory` avant de retirer l'épingle `want = rasterTop()`.
Relevé, non analysé : l'écart de 8 dB entre 0,75 et 0,625 constants sur cette vue (`taau625q`).

**L'épingle, essayée levée** (`renderer.rasterScaleFree`, ÉTEINT ; plancher 2/3 par axe, décision 6) : en vol J0 le gouverneur du M1 Max
bridé descend aussitôt à **2/3** (98 échantillons sur 113) — intervalle p95 41,5 → 34,3 ms, GPU p50 28,1 → 24,5 ms, 34,5 → 39,4 images/s —,
mais à 2/3 **le virage perd 6,6 dB** (PSNR en mouvement 40,1 contre 46,6–46,8 dB à 0,75, `singleHistory` des deux côtés ; netteté 0,87 contre
0,93) pour 10 % de GPU (21,1 contre 23,5 ms). **L'image brouillée pour une cadence** (CLAUDE.md : à ne pas faire) : **l'épingle reste**
tant qu'une échelle sous 0,75 ne garde pas l'image (la reconstruction elle-même, ou le plancher relevé) — à remesurer sur kerr-mini (sa
charge n'est pas celle du Mac qui chauffe). Ce que J2-6 livre donc : l'historique unique (sans pulsation au changement d'échelle), pas
encore l'échelle variable.

**Pourquoi l'image perd sous 0,75 — un balayage d'échelles** (`motion-quality`, Alpes, virage 30°, `+s80/+s72/+s70`, M1 Max) : PSNR en
mouvement **0,625 : 37,8 ; 2/3 : 40,1 ; 0,70 : 43,5 ; 0,72 : 45,3 ; 0,75 : 47,3 ; 0,80 : 43,4 dB**. La perte n'est **pas** celle des pixels
(0,80 en a plus que 0,75 et perd 3,8 dB) : **la reconstruction ne restitue bien que le rapport 3/4** — un réglage ou un motif propre à ce
rapport (la gigue de Halton du raster contre la grille de sortie, le noyau de la TAAU `taauSigma` réglé à 0,75 : Q6d) ; **à trouver avant
toute échelle variable** (J2-6) et avant tout plancher (décision 6 : 2/3 ; 0,5 sur preuve). Un défaut de la reconstruction, non de
l'échelle.

## 9 octies. J2-7, étape A : ce que `shade` et `bodyLite` couvrent et coûtent (13 novembre 2026)

e2e `j2-cover` (nouveau ; M1 Max en pression « Heavy » : les temps indicatifs, les **pixels** fiables) : les `moments` de la vue vivante
relus, chaque pixel par sa marque — le matériau raster (`liteFinish`, 1e30 / 4e30 l'eau), le reste du traceur (`shade`, 1e30 × (1 +
albédo)), un pixel laissé par l'ombrage partiel (−3…), le masque du cockpit, le tracé (le ciel) —, à la cadence choisie et à la cadence 1 :

| Vue | Cadence choisie | Matériau | `shade` | Laissés | Tracés | Matériau : choisie / 1 |
|---|---|---|---|---|---|---|
| J0 (cockpit, rade d'Hyères) | 16 | 2,6 % terre + 38 % mer | **0** | 0 | 54 % | `earth lite` 1,8 / 1,8 ms (`earth water` 8,5 / 8,6) |
| Plaine du Gapeau, 300 m | 16 | 44 % | **0** | 0 | 50 % | `earth lite` 4,4 / 4,1 ms, `light` 3,4 / 3,7 |
| Lune, Triesnecker 4 km | 4 | 20 % (+ 61 % laissés) | **0** | 61 % | 19 % | `body lite` **3,7 / 13,9 ms** |

- **Sur la Terre, la cadence d'ombrage ne fait rien** : le matériau terrestre (`shadeLite`) ombre chaque pixel quelle que soit
  `rasterRate`, qui ne gouverne que `shade` — **0 pixel** sur ces vues (`earth shade (raster)` 0,1 ms : la passe tourne à vide).
  `adaptRasterRate` y choisit 16 (le Mac chauffe) sans effet sur l'image ni sur le coût. Selon le plan (« s'ils sont faibles, cadence 1 et
  `adaptRasterRate` retiré ») : **pour la Terre, la cadence 1 et le gouverneur retirés ne changeraient rien de mesurable** — un retrait de code.
- **Sur la Lune, la cadence compte** : `bodyLite` la suit (`min(rate, 4)`) et coûte 3,7 fois moins à 4 qu'à 1 ; la reconstruction des
  pixels laissés y fait l'image. **À garder** (ou une cadence locale, J2-7 suite).
- **Recommandation** : retirer `adaptRasterRate` du chemin de la Terre (sa cadence ne s'applique qu'à `shade`, vide) et le garder pour les
  corps (`bodyLite`) ; la passe `shade` gardée (elle prend les pixels que le matériau refuse — aucun ici, à vérifier sur la ville et les Alpes).
  **Non mesuré** : kerr-mini ; les Alpes, une ville ; les pixels que `shade` prend pendant une compilation (`RASTER_SHADE_LATE`).

**Fait le même jour** (`renderer.earthRateOne`, **allumé** — sans effet mesuré, le plan l'autorise : « s'ils sont faibles, cadence 1 et
`adaptRasterRate` retiré ») : sur la Terre, le matériau tournant, la cadence vaut 1 ; le gouverneur ne mesure plus là (il garde les corps et la
fenêtre de compilation, où `shade` prend les pixels). Vérifié : `j2-cover` (Terre à 1, les mêmes parts de pixels ; Lune à 4), `surface-id`
1/0. Effet de bord voulu : avec la cadence 1, `shadeMark` n'est plus attendu pour que le raster soit prêt. **Reste** de J2-7 : la cadence
locale des corps (si utile), son ΔGPU sur kerr-mini.

## 9 nonies. Les leviers de J2 : un premier ΔGPU sur ce Mac, en attendant kerr-mini (13 novembre 2026)

e2e `j2-dgpu` (nouveau) : la vue de J0 **figée** (cockpit du F-35, 500 m au-dessus de la rade), chaque levier allumé et éteint **six fois en
alternance** (A B B A…, 20 images de mise en place, 60 mesurées) contre la dérive thermique ; M1 Max en pression « Moderate » (GPU 65 →
87 °C pendant la mesure). Δ du GPU p50 (allumé − éteint), moyenne des tours et son erreur type : **`edgeFoot` 0,00 ± 0,15 ms ;
`singleHistory` 0,00 ± 0,17 ; `earthRateOne` +0,42 ± 0,40 ; `disocclusionOn` +0,32 ± 0,22** (sa copie des `moments` comprise) — aucun coût
net établi à 0,2–0,4 ms près. **Ce n'est pas le ΔGPU du plan** (J0 en vol, A B B A entre commits, kerr-mini) : une estimation, vue figée.

**En vol aussi, essayé** (`j0-reference`, ablations nouvelles `singleHistory`, `edgeFoot`, `disocclusion`, `earthRateOff` ; ordre symétrique
base, leviers, base, leviers à rebours, base ; vols de 40 s) : **sans verdict** — le Mac est passé de « Moderate » à « Heavy » pendant la
série, le GPU p50 de base 26,2 → 32,2 → 36,1 ms ; contre les bases interpolées, chaque levier −0,2 à +1,2 ms selon sa moitié de série, dans
la dérive. À refaire **refroidi** (le palier du plan sur le M1 Max) ou sur kerr-mini : `J0_PHASES=ablate J0_ORDER=base,singleHistory,edgeFoot,
disocclusion,earthRateOff,base,…`. **Refroidi, refait** (parti de « Nominal », 57 °C, 9 vols) : le Mac bride **dès le deuxième vol** (GPU
1 296 → 389 MHz, GPU p50 de base 22,7 → 37,3 ms) — écarts des leviers −11 à +36 ms, sans sens. **Le M1 Max ne peut pas donner le ΔGPU en
vol de J0** (déjà relevé le 10 nov. : les ablations sur kerr-mini) ; seule l'estimation alternée de la vue figée (`j2-dgpu`) tient ici.

## 9 decies. Le ΔGPU sur J0 mesuré sur kerr-mini (13 novembre 2026, ~07:30 UTC, le mini revenu)

**Les lots, d'un seul A/B** (`j0-reference` vol, `ab-commit` A B B A, A = 72a16452 — après J2-1 —, B = l'arbre à ca99d014 : J2-2, le lot des
pointes, J2-3, J2-5, le retrait de `rigidMotionOn`, `earthRateOne` allumé ; kerr-mini « Nominal » aux quatre vols) : GPU p50 **A 60,5 / 58,7 ;
B 59,0 / 58,9 ms** (Δ −0,6, dans l'écart A–A de 1,8), GPU p95 A 67,8 / 65,0 ; B 65,3 / 65,0, intervalle p95 80,5 / 80,1 contre 80,2 / 80,0 ms :
**ΔGPU nul** pour l'ensemble. `remote-results/2026-11-13T0628-ab-72a16452`.

**Les leviers en vol** (`j0-reference` ablations, ordre symétrique, 11 vols de 40 s, « Nominal » partout ; Δ contre les bases interpolées,
moyenne des deux moitiés, chacune concordante) : **`singleHistory` −0,04 ms** (p95 −0,8) ; **`edgeFoot` −0,03 ms** (p95 −0,8) ; **désocclusion
+0,43 ms** (+0,42 / +0,44 ; la copie des `moments` et le test) ; **la cadence de la Terre au gouverneur (`earthRateOne` éteint) +0,29 ms** —
`earthRateOne` (allumé) en gagne ~0,3. Intervalle p95 80 ms partout. `remote-results/20261113-072810-j2-levers-j0`.

**Conséquences** : `singleHistory` et `edgeFoot` **sans coût** sur la machine cible — rien ne retient plus leur allumage que la décision de Sam
(recommandée pour les deux) ; la désocclusion **coûte 0,43 ms sans gain mesuré** — à garder éteinte, ou à retirer en J2-8 (recommandation) ;
`earthRateOne` confirmé. **Les pointes du fil principal sur kerr-mini** (le lot des pointes n'y avait pas été mesuré) : publication en vol p95
1,3 / max 2,1 ms, 4 images sur 975 au-delà de 2 ms, 1 soumission par image (J2-0 : p95 2,9 / max 9,5 ms, 79 sur 963) — fiche des pointes,
complément. **La fiche J0 de sortie, provisoire** (séance complète, kerr-mini, f6b4b20f) : [FICHE-kerr-mini-2026-11-13](progress/j0/FICHE-kerr-mini-2026-11-13.md)
— GPU p50 59,0 ms, intervalle p95 80,1 ms, couverture utile à froid 56,8 s (le 12 : 77,3, non attribué) ; à refaire, et sur le M1 Max
refroidi, après les décisions de Sam (`singleHistory`, `edgeFoot`, J2-4, le retrait de la désocclusion).

**Allumés par défaut le même jour** : `renderer.singleHistory` (J2-6 — la décision 5 de Sam, « un seul historique long », validée le 12 nov. ;
ses preuves faites : ΔGPU en vol sur kerr-mini −0,04 ms, PSNR en virage neutre, page neuve 3 × plus vite en vue tenue) et
`earthTiles.edgeFoot` (J2-3 tel que validé ; fuite 0, aucune couture, ΔGPU −0,03 ms). Leviers gardés (éteints : l'état d'avant). Restent
à Sam : la voie de J2-4 (un historique unique en porte l'essentiel), le retrait de la désocclusion (+0,43 ms sans gain), `seaSsrSafe`,
`clearCut`, les villes.

## 9 undecies. Décision de Sam (13 novembre 2026, ~08:15 UTC) : « ok pour tes recommandations »

Les recommandations en attente valent décision :
1. **`singleHistory` et `edgeFoot` allumés par défaut** (fait le même jour, §9 decies).
2. **J2-4 par l'historique unique** : la page neuve en vue tenue passe par lui (72 % à 3 images) ; l'identité du sol par page (voie 1)
   seulement si une lecture par page devient nécessaire ; la phase `trail` remesurée avec les nouveaux défauts.
3. **La désocclusion retirée** (J2-8 : +0,43 ms sans gain mesuré).
4. **`seaSsrSafe` et `clearCut` allumés par défaut** (les points blancs de la mer ; les arbres sur les îlots coupés par le plafond du décor).
5. **La cause de fond des villes sans bâtiments** : garder les bâtiments par leur distance à la trajectoire et à la caméra (non plus au seul
   centre de la scène), avec une avance réglée sur le temps réel de construction de la scène.
6. Les questions de la fiche J2-0 : oui aux trois (J2-3 réduit sans gouttières — fait ; le critère de J2-6 « |écart| ≤ 3 % » — tenu en vue
   tenue, §9 octies (e) ; les coutures par la géométrie — faites, C0-12 tenu).
7. `earthRateOne` (J2-7) gardé allumé ; l'épingle de l'échelle du raster gardée (2/3 : −2,1 dB).

**Faits le même jour** : 1 (§9 decies) ; 3 (la désocclusion retirée, d9b2557b) ; 4 (83a89f7e) ; 5 — `earthScenery.corridor`, le plafond des
bâtiments gardé le long du couloir de l'œil à l'au-delà du centre (Paris, même scène : 0 → 272 points de bâtiment à moins de 1 km de
l'appareil, le worker au même temps ; `docs/progress/decor/corridor-2026-11-13.json`) ; l'avance elle-même était déjà réglée sur le temps
réel de construction (`buildS` = 1,35 × le dernier temps + 3 s) ; 2 — la page neuve passe par l'historique unique (72 % à 3 images).

## 9 duodecies. La sortie de J2 (13 novembre 2026)

**Fiche J0 de sortie** : [kerr-mini](progress/j0/FICHE-kerr-mini-2026-11-13-sortie.md) (5c420e09, l'état décidé) — GPU p50 58,4 ms, intervalle
p95 80,1 ms, couverture utile à froid 56,3 s ; le M1 Max ne peut pas la donner en vol (il bride dès le 2ᵉ vol, §9 nonies). **Les sorties du
§4** : *avantage en virage* — à qualité égale (un seul historique neutre, +0,1 dB), GPU égal : non gagné, rien perdu ; *absence de fuite* —
0 pixel sur quatre vues, coutures C0-12 tenues (fissure p95 0,004–0,18 px) ; *pas de flou aux changements d'échelle* — aucune pulsation
(vue tenue : une transition d'~1 s sans dépassement ; en vol, PSNR identique au changement) ; *invalidations locales* — la page neuve en vue
tenue passe par l'historique unique (72 % à 3 images ; les arrivées appellent encore `invalidate()`, sans effet en raster) ; *coût* — ΔGPU
nul pour l'ensemble, les leviers nuls, `earthRateOne` −0,3 ms. **Retirés** : `rigidMotionOn` et ses pipelines, la désocclusion. **Laissés,
avec leur raison** : l'échelle variable (l'épingle gardée, 2/3 coûte 2,1 dB), la voie 1 de J2-4 (l'identité du sol par page, non nécessaire
à ce jour), J2-C (la compression BC7, à décider par Sam). **Chemin vers §8** : la part « reconstruction et sortie » reste `taau` 3,7 +
`temporal` 1,8 ms sur kerr-mini (enveloppe 2,0) — J2 ne l'a pas réduite ; la publication tient dans ses 2 ms (p95 1,3).

## 9 terdecies. J2-C, l'étude (13 novembre 2026)

[Fiche J2-C](progress/j2/FICHE-J2-C-2026-11-13.md) (décision 4 : « BC7 étudiée après J2-1 ») : `earthTiles.bc7Study()` et l'e2e `j2c-bc7`,
au-dessus de la terre, sur le M1 Max et kerr-mini — `texture-compression-bc` présent sur les deux ; orthophotos **42–44 dB** à la mip 0 (38–45
aux mips), relief 44–50 dB ; une couche 5,6 → 1,4 Mo (la texture 1024² 106 → ~27 Mo) ; l'encodage 20–90 ms la couche, ~1,5–6 ms par page.
**Recommandation (à Sam)** : réalisable (pages stables, une par image sous le budget des tuiles), à faire seulement si une machine cible manque
de mémoire.

## 10. Non vérifié

- **Aucune mesure nouvelle** : les chiffres cités viennent des fiches J0 du 12 novembre, de la fiche T9 et de GRAPHICS-PIPELINE ; les
  tailles mémoire « calculées » le sont depuis les constantes du code (`ORTHO_BYTES`, `IMG_2K_BYTES`), pas mesurées.
- ~~**La fuite entre pages n'a jamais été mesurée**~~ — mesurée par J2-0 : nulle sur deux vues tenues (fiche §2) ; en vol et en virage : non.
- ~~**L'effet en vol des `invalidate()` globaux**~~ — J2-0 : appelé à chaque image en mouvement de toute façon, sans toucher l'historique
  du temporel (compté : 1 467 / 1 469 images ; lu dans le code) ; non mesuré sur une vue convergée.
- **L'empreinte du sol en pente** (projetée sur le plan horizontal dans le prologue de `shadeLite` ?) : relevée pour les bâtiments par
  J1-5, à vérifier pour le relief.
- **Le « bloc 16 » de la fiche J0** contre `BLOCKS` (1–8) dans `renderer.ts` : unités à rapprocher.
- **La fonction `texture-compression-bc`** sur les machines du labo, et sa présence dans Chrome sur Apple Silicon.
- Le coût de la boucle de sélection des niveaux (`earthImageryAniso`, jusqu'à 13 lectures par pixel) : non isolé.
