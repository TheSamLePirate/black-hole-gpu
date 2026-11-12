# PLAN-J1 — l'opaque terrestre en forward, domaine pilote

**État (10 novembre 2026, soir)** : plan écrit ; **J1-3 commencé** — l'inventaire de ce que l'ombrage du sol lit (§4 ter : la surface seule tient dans un fragment aux limites par défaut, `shadeLite` entier non) ; première famille en module partagé : l'imagerie, `orthoImageryWgsl(groupe, liaisons)` (`earth-tiles.ts`), le traceur composé identique octet pour octet ; **la bibliothèque du sol** : `src/system/wgsl-library.ts` (`wgslClosure`, `wgslLibraryModule`) prend dans le traceur composé la fermeture d'une racine (fonctions, valeurs, structures, ressources liées) — le mécanisme que le cache de relief employait seul (`terrainHeightLibrary`, réécrit dessus : ses shaders identiques octet pour octet) ; les familles du ciel (8 fonctions, `P` + `bodies`), de l'imagerie (8, + 3 ressources) et du soleil (43, 13 ressources) compilent seules dans Chrome (`check-wgsl` 76/76) — `trace.wgsl` reste l'unique source, rien n'est déplacé (32 tests le lisent comme texte) ; **J1-0 fait pour `Params`** — webgpu-utils 2.1.1 en dépendance de développement (premier choix de CLAUDE.md, évaluation §4 bis), `scripts/gen-layouts.ts` génère `src/gen/params-layout.ts` depuis la structure WGSL, `writeParams` écrit par noms (les ~116 positions et les sommes de `vec4` à la main retirées), test et portillon avant push ; J1-0 reste ouvert pour les contrats de J1-1/J1-2 ; domaine pilote : la portée du patch par défaut (révisable par Sam) ; **J1-2 commencé** — la visibilité a une seconde cible, le mouvement des maillages mobiles du décor (voitures, pales : leur point à l'horloge et par la caméra de l'image d'avant), lue par `temporal` et `taau` (le reste du décor et le sol reprojetés par la caméra et la profondeur, exacts pour le rigide) ; vérifié par relecture (~900–1 000 pixels en mouvement, 4–7 px par image, aucune erreur GPU) ; au zoom (champ 12°), caméra immobile, les voitures laissaient des traînées plus longues avec le mouvement que sans — **corrigé le soir même** : le mouvement de l'image d'avant (copié en fin d'image) donne les **désoccultations** (un pixel qu'un mobile couvrait et ne couvre plus repart sans historique — l'historique du sol tenu avec la caméra immobile n'est pas borné, α 0,1) et une voiture que sa boucle ramène (saut > ¼ d'image) est marquée z 2, sans historique ; observé sur kerr-mini : plus de traînées, l'image proche de celle sans historique ; **allumé par défaut** ; la profondeur gardée et l'identité restent ; **J1-1 commencé** — `src/frame-desc.ts` (id, horloge réelle lue une fois, horloges du vol et de la scène, caméra actuelle et précédente ; testé), construit au début de `renderer.frame()` ; les 17 lectures d'horloge de l'encodage (fondus, fraîcheurs, horloges d'animation) le lisent (`performance.now()` dans `renderer.ts` : 48 → 33) ; J0 inchangé (kerr-mini 60,9 ms, 16,5 images/s) ; **suite le 12 novembre** — 8 lectures de plus de l'encodage passent par l'horloge de la frame (vitesse de la caméra au sol, magnétosphère, révision des cascades du Soleil, horloges de scène et d'horizon, bloc de mouvement, image hors ligne : `performance.now()` dans `renderer.ts` 33 → 25, les restes étant des temps de compilation et des rappels de fin GPU, mesures murales voulues) ; **la caméra** : `FrameDesc.view` porte la caméra entière (`cameraFrame` au temps de la frame), seule source pour l'image vivante (`writeParams`, la planification de la sonde de lumière) au lieu de deux recalculs par image. Origine : [stratégie](ANALYSE-STRATEGIE-RENDU-2026-11-03.md) §15 J1,
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
**J1-2, l'identité (12 novembre)** : le mot du contrat (objet 20 bits | génération 12 bits, 0 rien) défini dans
`src/system/surface-id.ts` (`packSurfaceId`, `decodeSurface` : la cible de visibilité telle qu'elle est dessinée — sol et son niveau,
arbre, bâtiment, boîte, pont, éolienne, pylône, nuage, rien —, la génération étant la publication du décor `earthScenery.revision`) ;
premier lecteur, `renderer.surfaceAt(x, y)` (diagnostic et sélection : relu de la cible, rien de dessiné ne change) ; e2e
`surface-id` (Maures : ciel, 14 arbres, 20 sol sur une grille 7 × 7, le même mot relu). **Pas de cible `r32uint` ni de profondeur
gardée encore** : leurs lecteurs qui changent l'image (le rejet de l'historique par identité, l'appareil composé par la profondeur —
J1-5) les créeront ; l'adaptateur `decodeSurface` se retire quand la passe écrira le mot elle-même.

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
