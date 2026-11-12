# PLAN-J1 — l'opaque terrestre en forward, domaine pilote

**État (12 novembre 2026)** : **J1-5 fait pour l'appareil** (dans la scène avant le temporel, mouvement et identité, +0,9 ms sur J0 —
paragraphe en fin de §4 ter) ; **le rejet de l'historique par identité allumé selon la piste (b) de Sam** (les surfaces mobiles ; le
décor immobile seulement à une nouvelle publication, poids coupé : fin de §4 ter). Historique : (10 novembre, soir) plan écrit ; **J1-3 commencé** — l'inventaire de ce que l'ombrage du sol lit (§4 ter : la surface seule tient dans un fragment aux limites par défaut, `shadeLite` entier non) ; première famille en module partagé : l'imagerie, `orthoImageryWgsl(groupe, liaisons)` (`earth-tiles.ts`), le traceur composé identique octet pour octet ; **la bibliothèque du sol** : `src/system/wgsl-library.ts` (`wgslClosure`, `wgslLibraryModule`) prend dans le traceur composé la fermeture d'une racine (fonctions, valeurs, structures, ressources liées) — le mécanisme que le cache de relief employait seul (`terrainHeightLibrary`, réécrit dessus : ses shaders identiques octet pour octet) ; les familles du ciel (8 fonctions, `P` + `bodies`), de l'imagerie (8, + 3 ressources) et du soleil (43, 13 ressources) compilent seules dans Chrome (`check-wgsl` 76/76) — `trace.wgsl` reste l'unique source, rien n'est déplacé (32 tests le lisent comme texte) ; **J1-0 fait pour `Params`** — webgpu-utils 2.1.1 en dépendance de développement (premier choix de CLAUDE.md, évaluation §4 bis), `scripts/gen-layouts.ts` génère `src/gen/params-layout.ts` depuis la structure WGSL, `writeParams` écrit par noms (les ~116 positions et les sommes de `vec4` à la main retirées), test et portillon avant push ; J1-0 reste ouvert pour les contrats de J1-1/J1-2 ; domaine pilote : la portée du patch par défaut (révisable par Sam) ; **J1-2 commencé** — la visibilité a une seconde cible, le mouvement des maillages mobiles du décor (voitures, pales : leur point à l'horloge et par la caméra de l'image d'avant), lue par `temporal` et `taau` (le reste du décor et le sol reprojetés par la caméra et la profondeur, exacts pour le rigide) ; vérifié par relecture (~900–1 000 pixels en mouvement, 4–7 px par image, aucune erreur GPU) ; au zoom (champ 12°), caméra immobile, les voitures laissaient des traînées plus longues avec le mouvement que sans — **corrigé le soir même** : le mouvement de l'image d'avant (copié en fin d'image) donne les **désoccultations** (un pixel qu'un mobile couvrait et ne couvre plus repart sans historique — l'historique du sol tenu avec la caméra immobile n'est pas borné, α 0,1) et une voiture que sa boucle ramène (saut > ¼ d'image) est marquée z 2, sans historique ; observé sur kerr-mini : plus de traînées, l'image proche de celle sans historique ; **allumé par défaut** ; la profondeur gardée et l'identité restent ; **J1-1 commencé** — `src/frame-desc.ts` (id, horloge réelle lue une fois, horloges du vol et de la scène, caméra actuelle et précédente ; testé), construit au début de `renderer.frame()` ; les 17 lectures d'horloge de l'encodage (fondus, fraîcheurs, horloges d'animation) le lisent (`performance.now()` dans `renderer.ts` : 48 → 33) ; J0 inchangé (kerr-mini 60,9 ms, 16,5 images/s) ; **suite le 12 novembre** — 8 lectures de plus de l'encodage passent par l'horloge de la frame (vitesse de la caméra au sol, magnétosphère, révision des cascades du Soleil, horloges de scène et d'horizon, bloc de mouvement, image hors ligne : `performance.now()` dans `renderer.ts` 33 → 25, les restes étant des temps de compilation et des rappels de fin GPU, mesures murales voulues) ; **la caméra** : `FrameDesc.view` porte la caméra entière (`cameraFrame` au temps de la frame), seule source pour l'image vivante (`writeParams`, la planification de la sonde de lumière) au lieu de deux recalculs par image. Origine : [stratégie](ANALYSE-STRATEGIE-RENDU-2026-11-03.md) §15 J1,
§7.3–7.5 (contrats de frame et de surfaces), §20.5 étapes 2 à 4, §21.4 candidat B ; décision de Sam du 10 novembre : « J1 suit la
mer » ([PLAN-MER-WEBGPU](PLAN-MER-WEBGPU.md) fait, S6 mesuré). Juge : la scène [J0](J0-CONTRAT.md) (Toulon-Hyères), sur kerr-mini
(répartition) et sur le M1 Max (palier). Le code fait foi ; ce plan dit l'ordre et les preuves.

## 1. Ce que J1 doit livrer (stratégie §15)

Une scène opaque verticale dans le nouveau contrat : **terrain + quelques bâtiments + l'appareil**, lumière simple contrôlée, **sans
nuages ni eau** (ils se raccordent par leurs interfaces, pas par J1). Réutiliser le cache du terrain et les maillages. Un forward de
référence qui produit **profondeur finale, identité/génération, mouvement utile et couleur de scène** ; le renderer branché sur une
**description de frame figée** ; un **export** de la couleur complète ; la représentation CPU/GPU des contrats fixée (outillage de
layout, §18). Sortie : visibilité et contacts cohérents, décalage d'origine sans saut, première image sans dépendre des compilations
Kerr ; le snapshot du vol et celui de la vue distincts. **Un seul opaque principal dans le domaine pilote** (pas deux scènes opaques
complètes par image).

## 2. L'existant (relevé du code, 10 novembre)

| Responsabilité | Aujourd'hui | Écart au contrat |
|---|---|---|
| Visibilité | `terrain-raster.ts` « terrain raster visibility » : patch + anneaux + décor (`scenery-raster.ts` dans la même passe) → `rgba32float` (r distance, g instance, b plus proche, a code·2¹⁸ + normale octaédrique 9+9) ; profondeur `depth32float` inversée **jetée** (`depthStoreOp: "discard"`) | pas de profondeur finale gardée ; codes et identités dans des canaux à sens multiples |
| Ombrage opaque | `shadeLite` (`trace.wgsl`, ~544 lignes + `liteFinish`, `liteSun`, `liteSky`…) : un fil par pixel, relit la visibilité, reconnaît ce que d'autres passes ont dessiné (marqueurs dans `moments.x`), lit l'imagerie (`earthImageryAniso`), les surfaces, les ombres (cascades, horizons, contact, décor), le ciel, l'air, les nuages | ombrage universel reconstruit depuis un indice — exactement ce que §7.4 veut quitter |
| Identité | canaux g/a de la visibilité (cellule d'arbre + 1, feuille de bâtiment + 1, étiquettes) | pas d'identité stable entre publications ni de génération |
| Mouvement | aucun tampon ; `temporal`/`taau` (`post.wgsl`) reprojettent par la **caméra seule** + la distance (`moments.y`) | les objets mobiles (l'appareil, les voitures) n'ont pas de mouvement |
| L'appareil | `ship.ts` « ship: shading (MSAA) » **après** `encodeTemporal`, composé par l'affichage | hors couleur de scène et hors historique |
| Description de frame | `renderer.frame(viewSettings, time, …)` + **~40 champs** du renderer posés par `main.ts` ; `writeParams` dérive la caméra, `Math.random()`, ~48 `performance.now()` dans `renderer.ts` | aucune description figée ; l'encodage lit réglages et horloges |
| Coût (J0, kerr-mini, soir) | `earth lite` 12,1 ms (après la sortie de l'eau), image 60,8 ms ; ablations ([fiche](progress/j0/FICHE-kerr-mini-2026-11-10-mer-ablations.md)) : nuages −6,2, appareil −3,7 (à recontrôler), décor −2,6, HUD −1,6, ombre de l'appareil −1,5, matériau de l'eau −0,5 ms | domaine de J1 : `earth lite` (l'eau relève de J4) |

## 3. Les lots

| Lot | Contenu | Remplace / retire | Preuve |
|---|---|---|---|
| **J1-0** | **Les contrats écrits** (ce document §4) : description de frame, sorties de surface (formats), identité, mouvement ; choix de l'outillage de layout (webgpu-utils d'abord, §18 et CLAUDE.md) sur un premier contrat réel | — | revue de Sam ; le premier layout généré et testé |
| **J1-1** | **La description de frame figée** : un objet `FrameDesc` construit une fois par image (temps de simulation, d'animation, delta réel, id de frame ; caméra actuelle **et précédente**, projection, jitter ; origine float64 et sa transformation ; Soleil ; exposition ; qualité effective) ; le renderer le reçoit avec `frame()` ; les lecteurs migrent par familles (caméra et temps d'abord) ; les champs posés par `main.ts` regroupés dedans | les lectures d'horloge et de `Settings` pendant l'encodage, famille par famille | test : un `FrameDesc` rejoué donne la même image (capture identique) ; `grep performance.now` dans l'encodage en baisse mesurée |
| **J1-2** | **Les sorties de surface** de la passe de visibilité : profondeur finale **gardée** (`depth32float`, store), **identité** `r32uint` (objet + génération, 0 = rien), **mouvement** `rg16float` (terrain et décor rigides : position du même point projetée par la caméra précédente ; objets mobiles : leur pose précédente) | les codes sémantiques dans `moments.x` pour les nouveaux lecteurs (adaptateur borné pour les anciens) | `temporal`/`taau` lisent le mouvement : test de reprojection sur une voiture et sur l'appareil ; coût de la passe ΔGPU (ablation) |
| **J1-3** | **La bibliothèque de matériaux** : les fonctions de `shadeLite` utiles au sol (imagerie filtrée, surfaces, `liteSun`, `liteSky`, air) sorties de `trace.wgsl` dans un module WGSL partagé, lisible par le traceur **et** par un fragment raster | le copier-coller futur ; une seule source pour le sol | `check-wgsl` ; tailles inlinées (`kernel-budget`) inchangées pour le traceur |
| **J1-4** | **Le forward du terrain** sur le domaine pilote : le fragment du patch du terrain ombre son pixel (dérivées matérielles, textures filtrées, matériaux explicites) et écrit la couleur de scène ; `shadeLite` ne traite plus ces pixels | `shadeLite` sur le domaine pilote | A/B sur J0 : image (planche, Q6 en mouvement) et ΔGPU ; un seul opaque par pixel |
| **J1-5** | **Les bâtiments et l'appareil dans la scène** : les maillages du décor ombrés en forward avec leur matériau (Q3) ; l'appareil dessiné **avant** le temporel, avec son mouvement et son identité | l'appareil hors historique | capture en virage : l'appareil net, sans traînée ; ΔGPU |
| **J1-6** | **L'export de la couleur complète** (radiance pré-exposée `rgba16float`, avant optique) et la première image sans compilation Kerr | — | un export comparé à l'image ; chemin d'entrée J0 à cache froid mesuré |
| **J1-7** | **Bascule et retrait** sur le domaine pilote : `shadeLite` réduit à son hors-domaine, les adaptateurs datés, les options et compilations sans utilisateur retirées | ce qui n'a plus de lecteur | fiche J0 nouvelle (kerr-mini + M1 Max) ; GRAPHICS-PIPELINE, BH-API |

Le domaine pilote : **le sol de la Terre dans la portée du patch raster**, de jour comme de nuit, sans l'eau (J4) ni les nuages (leurs
passes actuelles se composent par la profondeur finale). Hors domaine, le chemin actuel reste jusqu'à J5.

## 4. Les contrats (J1-0, à valider)

**Frame** (§7.3) : temps séparés (simulation, animation, réel, id) ; caméra actuelle et précédente en float64 côté CPU, différences
vers l'origine locale **avant** float32 ; jitter et taille interne/sortie ; exposition de la frame ; qualité effective par famille. Les
positions et hauteurs restent géodésiques (WGS84, géoïde aux frontières habituelles).

**Surfaces** (§7.4) :

| Sortie | Format | Écrit par | Lu par |
|---|---|---|---|
| profondeur finale | `depth32float` inversée (gardée) | visibilité, forward | air, nuages, eau, SSR, temporel |
| identité + génération | `r32uint` (objet 20 bits + génération 12 bits ; 0 = rien) | visibilité | temporel (rejet), sélection, diagnostic |
| mouvement | `rg16float` (pixels vers l'image précédente) | visibilité (analytique pour le rigide, poses précédentes pour le mobile) | `temporal`, `taau`, flou de mouvement |
| couleur de scène | `rgba16float` radiance linéaire pré-exposée | forward | composition, temporel, export |

Plus de marqueurs sémantiques dans les valeurs de luminance pour les nouveaux lecteurs : ils demandent « surface opaque » ou « limite
de volume » par ces sorties typées. Les anciens lecteurs gardent un adaptateur avec propriétaire et condition de retrait (§20.7).

## 4 bis. L'outillage de layout : l'évaluation (J1-0, 10 novembre au soir)

**Le besoin, mesuré dans notre code** : la structure `Params` du traceur (158 lignes de WGSL) est écrite par `writeParams` en
**~116 écritures positionnelles** (`set(47, …)`, `f[61 * 4 + 2]`, `wat + WAKE_VEC4S * 4`…) ; agrandir `seafft` de 6 à 7 `vec4`
(PLAN-MER-WEBGPU S1) demandait de recaler ces décalages à la main. Les nouveaux contrats de J1 (frame, surfaces, caméra précédente)
en ajouteraient d'autres.

**webgpu-utils** (documentation officielle et registre npm, lus le 10 novembre) : version 2.1.1 (2026-06-04), MIT, **aucune dépendance
d'exécution** (son analyseur dérive de wgsl_reflect, en dépendance de développement), ESM. `makeShaderDataDefinitions(wgsl)` lit les
structures **depuis le WGSL** — le WGSL reste l'autorité, comme le veut §18 — ; `makeStructuredView(def)` donne des vues typées par
champ et `set({ … })` par nom. Non documentés : les constantes `override` (que `trace.wgsl` emploie partout), `f16`, la taille
minifiée, le coût de `set()` par image. **TypeGPU** (0.12.10, MIT, trois dépendances d'exécution) déclare les structures en
TypeScript et produit le WGSL : une seconde autorité pour nos layouts existants, donc pas le premier choix ici.

**Proposition** : webgpu-utils **à la génération, pas à l'exécution** — un script Bun lit `trace.wgsl` et les autres sources, écrit
un module TypeScript des offsets nommés (`PARAMS.seafft`, `PARAMS.earth4.y`…), un test vérifie qu'il est à jour (comme
`pipeline-inventory --check`) ; aucun poids dans le bundle ni analyse au démarrage ; `writeParams` migre vers ces noms par familles.
Premier contrat réel : `Params` (le plus fragile), puis ceux de J1-1/J1-2. **À décider par Sam** : l'adoption de cette dépendance
de développement.

## 4 ter. Ce que l'ombrage du sol lit (J1-3, préalable à J1-4 — 10 novembre, nuit)

`bun scripts/ground-shading-inventory.ts` (statique, depuis le WGSL composé ; profil J0 `earth-raster-wx`) : les ressources que
`shadeLite` et les fonctions qu'il atteint lisent, par famille — ce qu'un fragment forward devrait recevoir pour ombrer le même sol.

| famille | fonctions | textures | stockage (dont écriture) | échantillonneurs | uniformes |
|---|---:|---:|---:|---:|---:|
| imagerie (albédo) | 8 | 2 | 1 (0) | 1 | 1 |
| soleil (ombres : nuages, cascades, horizons, décor, appareil) | 44 | 8 | 2 (0) | 2 | 1 |
| lumière du ciel | 8 | 0 | 1 (0) | 0 | 1 |
| air et nuages devant la surface, écriture | 50 | 7 | 4 (3) | 2 | 1 |
| eau (hors mer ouverte) | 21 | 2 | 2 (0) | 1 | 1 |
| `shadeLite` entier | 249 | **20** | 5 (3) | 5 | 1 |
| **surface seule** (tout sauf `liteFinish`, `liteWater`) | 214 | **15** | 5 (3) | 4 | 1 |

Ce qu'on en tire pour J1-3/J1-4 :

- **`shadeLite` entier ne tient pas dans un fragment aux limites par défaut** (20 textures pour 16 par étage) ; **la surface seule,
  si** : ses 15 textures comptent la cible de visibilité (`terrainDist`), qui devient les données propres du fragment (position,
  normale, identité interpolées) — reste **14** ; ses 3 tampons écrits (`accum`, `moments`, `stamps`) deviennent les cibles de la passe ;
  restent 2 tampons lus (`bodies`, `scenery`), 4 échantillonneurs, l'uniforme `P`. Donc le découpage du forward : **le fragment ombre
  la surface** (imagerie, matériaux et détail, soleil et ombres, ciel, AO) et écrit la radiance de surface + la profondeur finale ;
  **l'air et les nuages devant restent une passe de composition** par la profondeur finale (ce que fait `liteFinish`, sans le
  re-marcher) ; l'eau reste à J4.
- **Le coût de compilation** est le vrai risque : la surface atteint 214 fonctions — un module raster de cette taille rejoindrait la
  cascade de compilation (PLAN-LEAN-TRACER-KERNELS) ; J1-3 doit en faire **un module partagé spécialisé** (les mêmes constantes
  `override` que le noyau de `shadeLite`), pas une copie.
- **L'ordre de J1-3** : sortir d'abord les familles sans écriture et sans marche (imagerie, ciel), puis le soleil (ses 8 textures :
  `csmTex`, `sunShadowMap`, `tsmTex`, `shipShadowMap`, `earthCube`, `earthNight`, `noiseTex`, `terrainDist`) ; le fragment pilote
  les lira par un groupe de liaisons « lumière du sol » commun au traceur — une seule autorité des liaisons (webgpu-utils, J1-0).

**Le coût de compilation mesuré (J1-4, premier risque — 10 novembre, nuit)** : `bun scripts/ground-compile-cost.ts 4` (ce Mac,
M1 Max, Chrome sans interface, commit bdfd2696 ; chaque tour une compilation à froid — l'entrée renommée et une branche vivante sur un
nonce, sans quoi le cache du pilote répond en ~45 ms) : le noyau `shadeLite` du profil J0 **1,26–1,32 s**, la fermeture « surface seule »
(sans `liteFinish` ni `liteWater`, 134 k caractères contre 173 k) **1,10–1,17 s** (−13 %). Un fragment forward portant la surface coûte
donc à froid l'ordre de `shadeLite` ; tant que `shadeLite` reste compilé pour le hors-domaine (jusqu'à J1-7), la transition ajoute
~1,1 s de compilation à froid — à placer hors du chemin bloquant (compilation anticipée, §8 de la stratégie). Mesure d'un module de
calcul ; un fragment (étage, liaisons) reste à mesurer.

**J1-4, première étape : la surface en fonction (10 novembre, nuit)** : le corps de `shadeLite` coupé en trois — le prologue
(le rayon et le point depuis la visibilité, l'eau et ses sorties anticipées), **`liteSurface(…, at: RasterAttr)`** (l'albédo, les
matériaux, le soleil et ses ombres, le ciel, le rebond, la lune, le spéculaire, la pluie, les lumières de la nuit → la radiance de
surface G), l'épilogue (l'eau sur la surface, les vues de mesure, `liteFinish`). Ce que la surface lit de la visibilité est réuni dans
`RasterAttr` (maillage, feuille de bâtiment, étiquette, éolienne, pylône, pont, feu, normale lissée, AO) : pour `shadeLite` il ne
porte que le pixel (`vis`) et chaque attribut est lu par un accesseur (`atLeaf`, `atAO`…) **là où la surface le lit, comme avant** —
la constante se replie à la compilation : aucune lecture avancée, aucun registre de plus ; le fragment forward en donnera les champs.
J0 seul sur kerr-mini : GPU p50 vol 62,4 ms, vue figée 62,3/62,6 (avant : 62,6 ; 62,7/60,6) — inchangé ; e2e `sea-fft` 5/5. Prochaine étape : le pipeline du fragment (le patch redessiné en profondeur égale sur la profondeur gardée de
J1-2, les ressources de la surface à un groupe « lumière du sol », `wgslLibraryModule` sur `liteSurface`).

**J1-4, deuxième étape : le pipeline forward en pilote (10–11 novembre, nuit) — pas encore fonctionnel.** Construit, derrière
`renderer.forwardGround` (éteint) : `liteForwardG` (le prologue de `shadeLite` et `liteSurface` pour un pixel du patch, a = 0 — avec sa
raison — là où `shadeLite` le garde : l'eau, un arbre ou un pont devant, la cabine, une mesure) ; `liteForwardFinish` (l'air et les
nuages, `liteFinish`) ; `shadeLite` saute les pixels finis cette image (`RASTER_FORWARD_FLAG`, `stamps` et `RASTER_MARK`) ;
`system/terrain-forward.ts` (`terrainForwardShader`, `terrainForwardFinishShader`, `TerrainForward`) — les modules tirés du traceur
spécialisé pour la clé (le spécialiseur de la page, toutes fonctions gardées), le fragment visible seul retenu par sa distance (celle
de la visibilité au pixel : ni profondeur gardée ni test d'égalité — la profondeur gardée de J1-2 n'est pas requise à ce stade),
**l'étage de sommets pris au module même de la visibilité** (des sommets identiques par construction), la finition sur la mise en
page du traceur (`mainLayout`), la couleur forward à la place de la LUT lointaine — aucune texture de plus demandée à l'appareil
(+1 dépassait la limite que le renderer demande : la première mise en page refusée). Mesuré sur kerr-mini : pipelines construits
(forward 0,1–1,9 s, finition 0,07–0,8 s), passes `forward ground` 0,85–1,3 ms et finition 0,13 ms, **0 erreur GPU — mais aucun
fragment écrit** (relue : cible vide, même avec un remplissage constant en diagnostic : le dessin ne produit aucun fragment, données
du patch et liaisons vérifiées) ; cause non trouvée. Laissé éteint ; `check-wgsl` 78/78, `kernel-budget` inchangé.

**J1-4, le pilote fonctionne — et coûte (11 novembre, nuit).** La cause des « zéro fragment » : le source spécialisé garde ses 65
`override` avec leur valeur par défaut, les vraies valeurs données à la création des pipelines (`constants`) — les deux pipelines
forward étaient créés sans : `HAS_TERRAIN_RASTER` faux, chaque fragment écarté (raison 1, 434 000 fragments). Corrigé (les constantes
de la clé, filtrées sur les `override` de chaque module). (La vue de 700 m n'avait d'ailleurs pas de patch à l'image : les anneaux
seuls ; la sonde passe à 120 m.) **Mesuré sur kerr-mini** (Toulon, 120 m au-dessus du sol, regard −30°, 1440×810, commit 60f77332+) :
285 500 pixels ombrés par le fragment, l'image identique à l'œil ; **`forward ground` 16,3 ms + finition 1,0 ms, `earth lite` 45,9 →
42,2 ms : +13,6 ms l'image**. Par pixel, le fragment coûte ~4× le calcul. Hypothèse, non mesurée séparément : le patch fait ~131 000
triangles pour ~427 000 pixels (~3 px par triangle) et le matériel ombre par quads 2×2 — l'ombrage forward d'un maillage aussi fin
paie ses bords de triangles. **Conséquence pour J1-4 (à décider par Sam)** : pour le sol dense, la visibilité suivie d'un calcul (ce
que fait `shadeLite`, un « visibility buffer ») reste la voie efficace ; le forward ne paierait qu'avec des triangles de l'ordre de
16 px et plus (un maillage d'ombrage plus grossier que celui de la visibilité), ou pour les maillages à grands triangles (bâtiments,
appareil : J1-5). Le pilote reste éteint (`forwardGround`).

**J1-4, orientation proposée à Sam (11 novembre, nuit) — à décider.** Trois mesures de la nuit (kerr-mini, Toulon, forêt à 120 m) :
(1) le forward du sol coûte +13,6 ms (le fragment ~4× le calcul sur le maillage fin) ; (2) `shadeLite` payait ~16 ms de *présence*
de l'air et des nuages : sortis dans `shadeLiteFinish` (fait, b82fd8b2), 46 → 41 + 3 ms ; (3) il est au bord d'une falaise
d'occupation : les surfaces, le spéculaire ou le détail retirés à la compilation, chacun −11 à −12,5 ms. Proposition : pour le sol
dense, garder la **visibilité suivie d'un ombrage en calcul** (un « visibility buffer ») et le séparer en deux noyaux — **matériau**
(albédo, normales, et par cas : émission des bâtiments / feux de piste / transmission des arbres, verre, humidité, classe, route,
lumières de nuit ; 3 à 4 `rgba32float` empaquetés par cas) puis **éclairage** (soleil et ombres, ciel, rebond, spéculaire, pluie,
lumières) —, `shadeLiteFinish` après ; le forward réservé aux grands triangles (J1-5 : bâtiments, appareil). À décider : cette
orientation à la place du « forward du terrain » de J1-4, avant d'écrire le découpage matériau/éclairage.
**Fait le 11 novembre au matin (cd34f394), comme optimisation du chemin actuel** — la séparation matériau/éclairage sur tous les
pixels (`withLiteDeferred`) : forêt 42,1 → 39,5 ms, **J0 60,0 ms** (61,5) ; le forward reste en pilote éteint.
**Confirmé par Sam le 12 novembre 2026** (« je confirme le différé pour le sol ») : pour le sol dense, la visibilité suivie de
l'ombrage en calcul, matériau puis éclairage (`withLiteDeferred`), remplace le « forward du terrain » de J1-4 ; le forward est réservé
aux maillages à grands triangles (J1-5 : bâtiments, appareil). Le pilote `forwardGround` reste éteint, à retirer à J1-7 s'il n'a
plus d'utilisateur. Ordre donné le même jour : **J1-2 et J1-1 d'abord** (ils avancent sans changer l'image).
**Décision de Sam (12 novembre 2026, plus tard) : J1-5 lancé, changer l'image est accepté** — l'appareil dessiné dans la scène
(avant le temporel, composé par la profondeur gardée, avec son mouvement et son identité : net en virage), puis les lecteurs qui
changent l'image (rejet de l'historique par identité). Chaque lot qui change l'image se prouve par une planche avant/après et un
ΔGPU sur J0.
**J1-2, l'identité (12 novembre)** : le mot du contrat (objet 20 bits | génération 12 bits, 0 rien) défini dans
`src/system/surface-id.ts` (`packSurfaceId`, `decodeSurface` : la cible de visibilité telle qu'elle est dessinée — sol et son niveau,
arbre, bâtiment, boîte, pont, éolienne, pylône, nuage, rien —, la génération étant la publication du décor `earthScenery.revision`) ;
premier lecteur, `renderer.surfaceAt(x, y)` (diagnostic et sélection : relu de la cible, rien de dessiné ne change) ; e2e
`surface-id` (Maures : ciel, 14 arbres, 20 sol sur une grille 7 × 7, le même mot relu). **Puis, le même jour, les sorties
elles-mêmes** : la passe de visibilité de la Terre écrit le mot dans sa troisième cible `r32uint` (`terrain raster identity` : proxies
d'arbres et maillages de bâtiments, le sol 0, boîtes et marques laissées ; la génération par l'uniforme du décor `ident.x`) et **garde
sa profondeur** (`depthStoreOp: "store"`) ; `surfaceAt` relit le mot de la passe et, sur demande, la profondeur ; e2e `surface-id` :
49/49 points identiques au mot de l'adaptateur, profondeur d'un arbre ~2·10⁻⁴ (Z inversé), ciel 0, aucune erreur GPU. Leurs lecteurs
qui changent l'image (rejet de l'historique par identité, appareil composé par la profondeur — J1-5) viendront ensuite ;
`decodeSurface` reste le contrôle de l'e2e et le chemin des corps sans cette passe. **Le mouvement du rigide (même jour)** : le sol (sa caméra précédente
par l'uniforme du terrain, le pas de l'œil en float64 côté CPU) et le décor immobile écrivent leur mouvement analytique dans la cible
de mouvement (xy, **z −1** — l'historique lit xy seulement où z > 0,5 marque un maillage mobile : l'image ne change pas) ; e2e
`surface-id` : arbre immobile ~3·10⁻⁴ px caméra fixe, 4–13 px caméra tournant de 0,3° par image ; **éteint par défaut**
(`renderer.rigidMotionOn`, sans lecteur — J1-5 et le rejet de l'historique l'allumeront) : éteint, **coût nul** mesuré sur kerr-mini
(A/B A B B A, 4,09 contre 4,19 ms) ; allumé ~+0,8 ms (mesuré sur une version antérieure). **Leçon** : passer l'interpolant de mouvement
des proxies et maillages de `vec3` à `vec4` coûtait à lui seul +0,23 ms à la passe — le rigide est marqué z −1 dans un `vec3`. Le format
reste `rgba16float` (`rg16float` du contrat à revoir avec les lecteurs).
**J1-5, l'appareil dans la scène (12 novembre, après la décision de Sam)** : l'appareil (le F-35, et tout engin du même chemin :
Ranger, Lander, A320, trafic, engins au sol) reste dessiné dans sa boîte MSAA ×4 (`ship: shading (MSAA)`, ses matériaux, verres,
cabine inchangés), mais **sur l'image vivante, avant le temporel** : la profondeur d'occultation (`occlusion depth`) passe avant le
temporel, puis `ship: motion` (hors cockpit : ses maillages opaques une fois, la pose de chaque instance à l'image d'avant retrouvée par
sa clé — `writePrevPoses` —, son mouvement en px, sa distance) et `ship: into the scene` (`composeColor`/`composeSurface`) : là où son
image est opaque (alpha 1 et surface de la passe de mouvement), sa couleur entre dans `hdr`, sa distance dans `sceneDepth` (la station,
le marcheur, l'Endurance se cachent derrière lui), les étoiles dessous s'effacent ; son mouvement (w 1 : l'appareil ; z 1, ou z 2 sans
historique depuis le cockpit) dans `terrain raster motion` — ou, sans visibilité de la Terre, la cible du renderer `craft motion` — et
son identité (objet 2²⁰ − 1 − instance, génération `ship.craftGen` : un autre appareil ou une autre monture, une autre génération ;
`surface-id.ts` `craftSurfaceId`) dans `terrain raster identity`. **Composé par `sceneDepth`, pas par la profondeur gardée** : c'est
la profondeur qu'emploie déjà l'ombrage de l'appareil pour cacher les autres engins derrière le décor, elle existe dans tous les mondes
(espace, autres corps, Terre tracée) et vaut la distance de la visibilité aux pixels raster ; la profondeur gardée de J1-2 n'existe que
pour la Terre proche. Le temporel et la TAAU lisent ses pixels comme neufs, entiers, sans gigue, sans albédo du sol, **avec au moins la
moitié de la frame** (`CRAFT_ALPHA` 0,5 : déjà antialiasé par le MSAA ; à 0,9 d'historique il perdait 19 % de netteté mesurée). L'affichage
et le bloom ne composent plus que le reste de son image (ses bords, ses verres : l'image d'un verre sur le ciel derrière ne doit pas
traîner avec le sol) ; le masque `ship: in the scene` garde ce qu'il cache (pluie, rayures, cartes) et l'épargne de la brume de chaleur
et de la profondeur de champ. **Le cockpit reste sans historique** (z 2) : il est sous son propre masque (`underCabin` : l'historique n'y
est jamais lu), ses écrans changent à chaque image ; la passe de mouvement y est sautée. Hors image vivante (rendus hors ligne) ou
`renderer.shipInScene = false` : l'ancien chemin. **Mesuré** (kerr-mini, J0 vol en vue cockpit, A/B A B B A contre fd3ba94c) : GPU p50
57,8 / 57,6 → 58,8 / 58,4 ms (**+0,9 ms**, 17,3 → 17,0 images/s), `ship: into the scene` 0,20 ms (0,47 avant de n'écrire que les pixels
opaques) ; image : planche `docs/progress/j1/j1-5-appareil-dans-la-scene.jpg` (e2e `craft-in-scene`, en virage de 30° : poursuite nette,
sans traînée ; le cockpit identique). **Limites** : la station n'est plus reflétée par les verres (dessinée après) ; le flou de mouvement
(éteint par défaut) lit son mouvement mais ses prises peuvent mêler l'appareil au fond autour ; la photométrie automatique compte
l'appareil vu de dehors (dans le cockpit, le masque l'en exclut déjà) ; pas de gigue de l'appareil (la TAAU ne lui ajoute pas de détail).
**Le rejet de l'historique par identité (12 novembre) — construit, mesuré, laissé éteint : à décider par Sam.** `post.wgsl` `identityKept` :
dans `temporal` et `taau`, un pixel dont le mot d'identité (objet | génération : arbres, bâtiments, l'appareil ; le sol 0) n'est dans aucun
des 3 × 3 autour de l'endroit où son historique est pris, dans l'identité de l'image d'avant (copiée en fin d'image), repart sans
historique — 3 × 3 et non le seul pixel : la couverture gigue des silhouettes garde son historique. Levier `renderer.identityReject`,
compteur `identityRejects()`. **Mesuré** (ce Mac, e2e `identity-reject`, le F-35 à 85–130 m au-dessus de la forêt des Maures, chaque côté
le même instantané volé 4 s) : 2 500–5 000 pixels rejetés par image (temporal ; 4 900–9 200 dans la TAAU), soit 0,2–0,5 % de l'image ;
coût GPU dans le bruit du M1 Max chauffé (cockpit 22,8/24,8 ms sans, 22,8/25,2 avec ; entrelacé). **Image** : planche
`docs/progress/j1/j1-rejet-identite-foret.jpg` — **la forêt proche est plus molle avec le rejet** (vue de poursuite ; le cockpit presque
identique), et aucune traînée n'est visible sans lui. Pourquoi : un pixel rejeté repart de l'image de la frame, que le raster n'ombre
qu'en partie à chaque image (1 sur 8 ou 16 : le reste reconstruit) et que la TAAU agrandit sans son historique à la taille de la toile.
**Laissé éteint** (aucun coût éteint : rien de lié que des 1 × 1, rien copié ; A/B J0 dans le journal). Pistes pour Sam : (a) un rejet
doux — le poids de l'historique coupé (comme un écart hors de la plage, `nPrev × 0,25`) au lieu de l'abandon ; (b) le rejet réservé aux
changements de génération et aux objets mobiles (l'appareil, les voitures), pas aux silhouettes d'arbres ; (c) ne rejeter que là où la
frame est entièrement ombrée (pas `RASTER_STALE`). `rigidMotionOn` reste éteint : aucun lecteur ne l'emploie encore.
**Décision de Sam (12 novembre) : la piste (b) — fait le même jour, allumé par défaut.** `identityKept` ne juge plus que ce que la
reprojection ne tient pas : **les surfaces mobiles** (l'appareil, les voitures : mouvement z 1) — leur mot absent des 3 × 3 de l'image
d'avant, sans historique (un autre objet, une autre monture de l'appareil) ; **le décor immobile garde son historique**, sauf à l'image
où **une nouvelle publication du décor** est dessinée (sa génération a changé : `renderer.republishedNow`, `TA.pFwd.w`) : ce qui
apparaît (un objet là où les 3 × 3 n'en avaient aucun) ou disparaît (rien là où ils n'avaient que des objets) voit **le poids de son
historique coupé au quart** (`ID_REPUBLISHED`), un objet resté objet (renuméroté par la publication) le garde. **Pourquoi coupé et pas
rejeté** (kerr-mini, e2e `identity-reject`, poursuite à 27–42 m au-dessus des Maures) : rejeté, une publication écartait **75 000 à
113 000 pixels d'un coup** (~10 % de l'image), une à deux fois par seconde, et une publication où rien ne change (la révision avancée à
la main) encore 5 000 à 12 000 — des pulsations de forêt molle. **Mesuré ensuite** (kerr-mini, même e2e, 97–150 m) : les surfaces
mobiles ~0 à 270 pixels rejetés par image (l'appareil en poursuite), ~30 000 pixels au poids coupé par publication (6 à 9 publications
en 8 s), 4 500–26 000 à une publication sans changement ; GPU p50 inchangé dans le bruit (cockpit 47,9 / 46,9 sans, 48,9 / 49,4 avec ;
poursuite 56,1 / 55,8 sans, 56,8 / 56,1 avec). **ΔGPU sur J0** (kerr-mini, 12 nov., A/B A B B A, `ab-commit` 2d111b86 — éteint —
contre l'arbre allumé) : vol mesuré 59,9 / 58,3 → 59,2 / 59,1 ms (dans le bruit), vol prolongé 58,0 / 57,2 → 58,1 / 59,1 ms ; par
passe, `taau` 3,48 → 3,67 ms (+0,18), `temporal` 1,70 → 1,72 ms. **Image** : planche `docs/progress/j1/j1-rejet-identite-b.jpg` — la forêt aussi nette
avec que sans, en cockpit comme en poursuite (les deux vues de poursuite ne sont pas au même endroit : le vol rejoué diverge). Compteurs :
`identityRejects()` (de l'image, cumulés, rejetés et coupés), `identRepublished`. Non vérifié : l'image même d'une publication (une
capture ne tombe pas sur elle) ; les voitures en vol (relu seulement — leur mouvement z 1 les fait juger comme l'appareil).
**J1-6, première moitié (12 novembre) : l'export de la couleur complète de l'image vivante, et le chemin d'entrée de J0 mesuré à
froid.** `renderer.sceneColor(settings)` relit, entre deux images, la radiance linéaire pré-exposée de la scène **telle que l'affichage
la reçoit, avant l'optique** (bloom, reflets d'objectif, profondeur de champ, courbe d'affichage, HUD) : l'image de la TAAU (`taau
image`, taille de la toile, COPY_SRC ajouté) là où elle a tourné, sinon `hdr` niveau 0 ; l'appareil dedans (J1-5 : ses pixels opaques ;
ses bords et verres, composés par l'affichage, non) ; `exposure` (2^EV / pré-exposition) la met à l'échelle de l'affichage ;
`sceneColorEXR` en fait un OpenEXR demi-flottant. **Vérifié** (kerr-mini, e2e `scene-color`, scène de J0 gelée, 1920 × 1080) : l'export
fini partout, comparé à la capture affichée sur 48 × 27 blocs — corrélation de rang de Spearman **0,92 (cockpit), 0,93 (poursuite)**
(l'écart : la courbe d'affichage, le bloom, le HUD) ; relu en 0,20–0,24 s ; EXR de 12 Mo ; planche
`docs/progress/j1/j1-6-export-couleur.jpg`. **Le chemin d'entrée de J0 à froid** (e2e `kernel-compile`, nouveau cas `j0`, cache Metal
vidé, profil neuf, kerr-mini) : la file de compilation est **sérielle** — le `main` (20,4 s) et l'`env` (11,4 s) de la scène du titre
d'abord, puis les noyaux raster de la Terre (`shadeLiteFinish`, `shadeLiteLight`, `shadeLite` : 6,8 s) — **le sol à l'écran ~57 s
après le chargement de la page**, avant le `main` Kerr de la Terre (17,5 s) et son `env` (10,6 s) ; tout prêt ~100 s (41
compilations, 83 s) ; relancé (cache chaud) : sol à 1,2 s, tout prêt à 4,8 s. **Lu de près** (les débuts des compilations) : le
titre a fini son `main`/`env` à 47,4 s — la page démarre sur lui ; J0 placé à ~48 s, **son sol paraît 9,2 s après** (~2 s de file, puis
6,8 s de noyaux raster à froid), **avant le `main` et l'`env` Kerr de la Terre** (60,0 → 92,5 s) : la première image de la Terre ne
dépend pas des compilations Kerr de la Terre — la sortie de J1 est tenue pour ce chemin. (Une première lecture, le même jour, disait
le sol attendre les noyaux du titre : faux, corrigé.) Reste hors de J1 : le titre lui-même attend son `main`/`env` à froid (≈ 32 s,
le ciel d'attente devant).
**J1-7, premier retrait (12 novembre) : le pilote du forward du sol.** Le différé confirmé par Sam pour le sol dense, le pilote
`forwardGround` (J1-4, éteint depuis sa mesure du 11 : +13,6 ms) n'avait plus d'utilisateur : retirés `src/system/terrain-forward.ts`
(`TerrainForward`, ses deux pipelines), `TerrainRaster.encodeForward` et sa sonde (`forwardProbe`, ses quatre cibles, la copie de
l'uniforme de visibilité, `vertexModule`), `renderer.forwardGround` / `forwardNow` / `forwardState` / `forwardDebug` et
`encodeForward`, dans le traceur `liteForwardG`, `liteForwardFinish`, `RASTER_FORWARD_FLAG` et le test de `shadeLite` qui sautait
ses pixels (le bit 4096 des paramètres libre), les deux modules de `check-wgsl` (83 → 81). Gardés : `liteSurface`/`RasterAttr` et
`liteFinishAt` (ceux de `shadeLite` et `shadeLiteFinish`), la bibliothèque `wgsl-library.ts` (le cache de relief l'emploie).
`trace.wgsl` 17 440 → 17 369 lignes. **Ce qui reste de J1-7** : le tableau du §3 visait « `shadeLite` réduit à son hors-domaine » —
caduc depuis le différé (le sol dense reste `shadeLite` matériau puis éclairage) ; restent le décodage `decodeSurface` (contrôle de
l'e2e `surface-id`, chemin des corps sans identité : gardé, propriétaire J1-2), `rigidMotionOn` (éteint, sans lecteur : à retirer ou à
brancher avec le format `rg16float`) ; **la fiche J0 nouvelle faite le 12** ([M1 Max](progress/j0/FICHE-m1max-2026-11-12.md) : frais 43,9 images/s, p50 24,9 ms, p95 32,6 ; soutenu 33,4/s — [kerr-mini](progress/j0/FICHE-kerr-mini-2026-11-12.md) : GPU p50 59,5 ms, 16,8/s). **Reste de J1-5** : les bâtiments en forward
avec leur matériau (Q3) — seul l'appareil est fait.

**J1-5, les bâtiments en forward : l'inventaire et le choix (12 novembre).** *Ce qu'un pixel de bâtiment lit aujourd'hui* : la
visibilité le dessine (`scenery-raster.ts` `meshVs`/`meshFs` : code `mesh`, g la feuille + 1, identité r32uint ; les bâtiments lointains
sans triangles en boîtes pleines, `boxSolidVs`), puis `shadeLite` l'ombre **à chaque pixel de l'image interne, chaque image** (un fil
par pixel — la cadence 1/8 ou 1/16 est celle du noyau des rayons `shade`, pas du sol raster ; la TAAU agrandit ensuite) : prologue
(rayon gigué `liteJitter`, distance lue au texel du point gigué, point, lumière, empreinte **sur le plan horizontal** — `tn` est nul sur
un bâtiment —), `liteMaterial` (`rasterBuilding` : `buildingFaceAt` retrouve la face par les arêtes de la feuille, `buildingLook`/
`roofLook` ; la normale de face exacte ; **la normale géométrique `ng` par les distances des voisins** — `rasterNormal`, nulle ou
mêlée aux arêtes —, l'AO GTAO), `liteLight` (soleil, ombres, ciel, rebond, spéculaire, fenêtres), puis `liteFinish` (air, nuages :
`shadeLiteFinish` par `liteOut`). Fermeture statique de la racine du fragment (`liteBuildingG`, profil J0 spécialisé) : **199
fonctions, 16 textures** (`earthCube`, `earthNight`, `earthTiles`, `surfaceColour`, `surfaceCover`, `shipShadowMap`, `noiseTex`,
`orthoTex`, `imgTex2k`, `terrainDist`, `sunShadowMap`, `csmTex`, `detailTex`, `gtaoTex`, `tsmTex`, `impTex`), 5 échantillonneurs,
`P`, `bodies` et `scenery` en lecture — l'air et les nuages (`liteFinishAt` : 78 fonctions, 7 textures dont
3 seulement en commun) n'y sont pas ; module de 115 ko. `rasterBuilding` seul : 15 fonctions, `P` et `scenery`.
*Où le fragment s'insère — choix* : **un second dessin des triangles des bâtiments, après la passe de visibilité, sur sa profondeur
gardée de J1-2 (`depthCompare: "equal"`, profondeur en lecture seule)**, pas dans la passe de visibilité elle-même : (1) l'ombrage
lit la visibilité de l'image (voisins, AO GTAO calculée après elle, distance au point gigué) — impossible pendant qu'elle s'écrit ;
(2) le test d'égalité ne laisse passer que le fragment visible : aucun fragment caché ombré (la visibilité dessine sol, arbres et
boîtes avant les bâtiments, et les bâtiments entre eux sans tri) ; (3) les sommets sont ceux de la visibilité **par construction** —
l'étage de sommets est le module et l'entrée mêmes (`meshVs`), son interface entière consommée par le fragment. La sortie : `liteOut`
(G, distance) en cible de rendu et un masque `r8unorm` ; une petite passe de calcul (`buildings forward: marking`) marque ces pixels
`RASTER_SPLIT` — `shadeLite` les laisse (`RASTER_FORWARD_FLAG`), `shadeLiteFinish` y met l'air et les nuages comme pour les siens :
pas de passe de finition de plus, `accum`/`moments`/`stamps` écrits par le même code ; l'identité et le mouvement (J1-2) et le rejet (b)
non touchés. **Leçon (mesurée)** : le fragment ne doit ni écrire en mémoire ni faire `discard` — avec le marquage écrit par le
fragment dans `moments`, Metal passe le test de profondeur en tardif et chaque fragment caché de la ville est ombré (28 ms le jour,
47 ms la nuit sur Paris, kerr-mini) ; sans écriture mais avec `discard`, encore 8 ms ; sans les deux, 3,1 ms. Un pixel non pris écrit
masque 0 et une surface vide, que `shadeLite` réécrit pour tous les pixels qu'il finit. Les silhouettes restent à `shadeLite` : là où le texel du point gigué n'est pas ce bâtiment, le fragment se retire et le pixel
garde son antialiasing par l'historique. Ce que le fragment change : le point sur le plan du triangle le long du rayon gigué (au lieu
de la distance du texel voisin), la normale géométrique du triangle (dérivées matérielles de son point, au lieu des voisins),
l'empreinte sur le plan du triangle (un mur, un toit) ; le matériau Q3 et la lumière sont le même code (`liteSurface`). Les boîtes
lointaines, ponts, éoliennes, pylônes, voitures restent à `shadeLite`.
**J1-5, les bâtiments en forward : construit, mesuré, laissé éteint — à décider par Sam (12 novembre).** Levier
`renderer.buildingsForward` (éteint), `system/buildings-forward.ts`, trace.wgsl `liteBuildingG`, `scenery-raster.ts` `drawForward`,
compteur `buildingsForwardPixels()`, vues de diagnostic `buildingsForwardDebug` ; e2e `buildings-forward` (kerr-mini, figé, l'exposition
tenue, éteint / allumé / éteint). **Couverture** : 84 % des pixels de bâtiment pris par le fragment (Toulon : 9 860 sur 11 715 ; Paris
6 400 sur 8 000 ; le reste : silhouettes, laissées à `shadeLite`). **Normale** : la normale du triangle d'accord (≤ 25°) avec celle de
`shadeLite` sur les grandes faces, en désaccord sur les petits bâtiments lointains, là où la normale par les voisins est la moins sûre.
**Image** : aucune différence visible — écart moyen allumé/éteint 0,54 (dérive éteint/éteint 0,63) le jour, 0,37 (0,41) la nuit,
sur 255 ; planche `docs/progress/j1/j1-5-batiments-forward.jpg` (Toulon, jour et nuit, recadrages ×3 et différence ×8 : bords de
bâtiments et de fenêtres seulement). **Coût** (passes sur 60 images) : Toulon `buildings forward` 2,5–2,6 ms + marquage 0,04 ms, dont
~1,0 ms de redessin des sommets (les vues sans ombrage) ; Paris 3,1–3,4 ms ; `earth lite` sans gain mesurable (ses pixels de bâtiment
~1 % de l'image, ~17 ns chacun) — par pixel le fragment coûte ~10× le calcul (petits triangles lointains : quads partiels ; registres).
**ΔGPU sur J0** (kerr-mini, A/B A B B A contre 5d04b0c3, phase vol) : éteint, **coût nul** (A 59,4 / 59,1, B 58,8 / 59,2 ms) ; allumé,
**+1,3 ms** (A 59,3 / 59,5, B 60,6 / 60,9 ms ; `buildings forward` 0,80 / 0,78 ms + marquage 0,09). **Pas net, au-delà de ~+1 ms :
laissé éteint.** Compilation à froid du pipeline ~2,5 s sur kerr-mini (hors du chemin bloquant : l'image reste `shadeLite` jusque-là).
**Question à Sam** : (a) garder le pilote éteint et le retirer à J1-7 (le sol et les bâtiments restent au différé, l'appareil seul en
forward) ; (b) le restreindre aux **grands triangles proches** — les bâtiments maillés à moins de quelques centaines de mètres, en
excluant les petits triangles lointains, cause probable du surcoût (non mesuré séparément) — pour un second A/B ; (c) l'allumer quand
même pour le contrat (une surface finale par le forward), au coût mesuré. Recommandation : (b) seulement si un gain d'image est
attendu des façades proches ; sinon (a).

**J1-7, `rigidMotionOn` — gardé éteint, avec son propriétaire et sa condition de retrait (12 novembre).** Relevé : aucun lecteur ne lit
le mouvement analytique du rigide (z −1) — `temporal`, `taau` et le flou de mouvement ne lisent la cible de mouvement que là où z > 0,5
(un maillage mobile, l'appareil) et reprojettent le rigide par la caméra et la profondeur, ce qui est exact pour lui ; ni J1-5 ni le
rejet (b) n'en ont eu besoin. **Propriétaire** : J1-2 (`terrain-raster.ts` `buildGround(motion)`, `scenery-raster.ts` `rigidMotion`).
**Coût** : nul éteint (mesuré, A/B) ; ~+0,8 ms allumé. **Condition de retrait** : sans lecteur à la fin de J2 (pages d'imagerie et
reconstruction, désocclusion — le candidat naturel), retiré avec ses pipelines `terrainVsMot`/`terrainFsMot`/`ringFsMot` et les champs
`pd/pr/pu/pf` de l'uniforme ; un lecteur venu, le format `rg16float` du contrat se tranche avec lui. Pas retiré aujourd'hui : la session
des bâtiments en forward modifie les mêmes fichiers.

**La voie retenue pour J1-3 (10 novembre, nuit)** : ne pas déplacer les fonctions hors de `trace.wgsl` (32 tests et les outils
de noyaux le lisent comme texte ; un déplacement multiplierait les sources), mais **en faire la bibliothèque** : un pipeline raster
prend la fermeture de ses racines dans le traceur **composé et spécialisé** (`wgsl-library.ts`), et déclare les ressources listées à
son propre groupe. Le fragment forward de J1-4 = `wgslLibraryModule(traceur, [familles de la surface], entrées du fragment)`, ses
liaisons « lumière du sol » renumérotées pour l'étage fragment.

## 5. Risques et questions

- **Le forward en fragment demande au pipeline raster les liaisons du sol** (imagerie, cascades, horizons, ciel) que le traceur porte
  dans son groupe 0, déjà près des limites d'Apple (`maxSampledTexturesPerShaderStage`) : la bibliothèque de J1-3 doit aller avec un
  plan de liaisons propre au forward, pas une copie du groupe du traceur.
- **Coût** : le forward ne promet pas de gain par principe (§7.4) ; J1-4 se juge par A/B de l'image entière sur J0. Le noyau
  `shadeLite` est limité par ses registres sur Apple (ablations de la mer) : un fragment plus court peut y gagner, à mesurer.
- **Questions à Sam** : (1) l'outillage de layout — webgpu-utils comme premier choix (CLAUDE.md), employé à la génération (§4 bis) ;
  (2) l'étendue du domaine pilote — la portée du patch, ou d'abord une bande plus étroite (quelques km) pour un premier A/B.
