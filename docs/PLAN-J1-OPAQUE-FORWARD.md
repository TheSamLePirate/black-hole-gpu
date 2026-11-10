# PLAN-J1 — l'opaque terrestre en forward, domaine pilote

**État (10 novembre 2026, soir)** : plan écrit ; **J1-0 fait pour `Params`** — webgpu-utils 2.1.1 en dépendance de développement (premier choix de CLAUDE.md, évaluation §4 bis), `scripts/gen-layouts.ts` génère `src/gen/params-layout.ts` depuis la structure WGSL, `writeParams` écrit par noms (les ~116 positions et les sommes de `vec4` à la main retirées), test et portillon avant push ; J1-0 reste ouvert pour les contrats de J1-1/J1-2 ; domaine pilote : la portée du patch par défaut (révisable par Sam) ; **J1-2 commencé** — la visibilité a une seconde cible, le mouvement des maillages mobiles du décor (voitures, pales : leur point à l'horloge et par la caméra de l'image d'avant), lue par `temporal` et `taau` (le reste du décor et le sol reprojetés par la caméra et la profondeur, exacts pour le rigide) ; vérifié par relecture (~900–1 000 pixels en mouvement, 4–7 px par image, aucune erreur GPU) ; au zoom (champ 12°), caméra immobile, les voitures laissaient des traînées plus longues avec le mouvement que sans — **corrigé le soir même** : le mouvement de l'image d'avant (copié en fin d'image) donne les **désoccultations** (un pixel qu'un mobile couvrait et ne couvre plus repart sans historique — l'historique du sol tenu avec la caméra immobile n'est pas borné, α 0,1) et une voiture que sa boucle ramène (saut > ¼ d'image) est marquée z 2, sans historique ; observé sur kerr-mini : plus de traînées, l'image proche de celle sans historique ; **allumé par défaut** ; la profondeur gardée et l'identité restent ; **J1-1 commencé** — `src/frame-desc.ts` (id, horloge réelle lue une fois, horloges du vol et de la scène, caméra actuelle et précédente ; testé), construit au début de `renderer.frame()` ; les 17 lectures d'horloge de l'encodage (fondus, fraîcheurs, horloges d'animation) le lisent (`performance.now()` dans `renderer.ts` : 48 → 33) ; J0 inchangé (kerr-mini 60,9 ms, 16,5 images/s). Origine : [stratégie](ANALYSE-STRATEGIE-RENDU-2026-11-03.md) §15 J1,
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

## 5. Risques et questions

- **Le forward en fragment demande au pipeline raster les liaisons du sol** (imagerie, cascades, horizons, ciel) que le traceur porte
  dans son groupe 0, déjà près des limites d'Apple (`maxSampledTexturesPerShaderStage`) : la bibliothèque de J1-3 doit aller avec un
  plan de liaisons propre au forward, pas une copie du groupe du traceur.
- **Coût** : le forward ne promet pas de gain par principe (§7.4) ; J1-4 se juge par A/B de l'image entière sur J0. Le noyau
  `shadeLite` est limité par ses registres sur Apple (ablations de la mer) : un fragment plus court peut y gagner, à mesurer.
- **Questions à Sam** : (1) l'outillage de layout — webgpu-utils comme premier choix (CLAUDE.md), employé à la génération (§4 bis) ;
  (2) l'étendue du domaine pilote — la portée du patch, ou d'abord une bande plus étroite (quelques km) pour un premier A/B.
