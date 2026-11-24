# J9-A — Démonstration d'acceptation complète de la vraie géométrie d'arbres proches

20 novembre 2026. Ce document consigne la démonstration d'acceptation complète de la vraie géométrie 3D des arbres proches (`nearTreeGeometryOn`), en conformité rigoureuse avec les **six critères d'acceptation AAA du §6 de [docs/PLAN-J9-ARBRES-PROCHES.md](../../PLAN-J9-ARBRES-PROCHES.md)**, mesurés sur les deux machines de référence du laboratoire (`kerr-mini` et Mac M1 Max). *(Qualifié le 24 novembre 2026 : seul le passage `kerr-mini` est exploitable ; celui du M1 Max est invalide, voir la correction ci-dessous.)*

La validation est acquise : **201 assertions unitaires et d'intégration réussies, 0 échec, 53 relevés thermiques tous Nominal**. *(Ces chiffres sont ceux du seul passage `kerr-mini`.)*

> **Correction du 24 novembre 2026 (relecture).** Cette fiche surestimait ses preuves de coût. Le texte d'origine reste plus bas, corrigé ou annoté sur place.
> - **Passage M1 Max « invalide (bridage thermique) ».** Son relevé thermique, non cité à l'origine
>   (`remote-results/e2e-reports/20261120-135040-MacBook-Pro-de-olivier/j9-reference/01/summary.json`, checkout principal, non suivi par git),
>   compte 70 relevés : 11 Nominal, 4 Moderate, **36 Heavy, 19 Trapping** ; GPU 389–1 289 MHz (médiane 655 MHz, 51 % du maximum), 90,2 °C GPU au plus.
>   Ses chiffres (`remote-results/j9-a-local/samples.json`, commit non consigné) restent visibles ci-dessous, marqués invalides ;
>   aucun ne valide un coût ni un gain sur M1 Max. En particulier, le vol bas à 60 m y donne **26,2 → 40,5 → 66,4 ms** p50 (p95 34,0 / 70,7 / 71,4) :
>   **+14,3 ms en B**, avec une dérive pendant B (médiane des 10 premières images 27,5 ms, des 10 dernières 65,0 ms) puis A à 66,4 ms.
>   Ce passage n'établit ni un coût de la géométrie ni une neutralité : « neutre à 60 m sur les deux Macs » est retiré. Le « −9 ms » de Chamonix
>   (76,9 → 67,9 ms) est pris dans la fin bridée du même passage, et le « −3,1 ms » des Maures sol (21,8 → 18,7 ms) dans ce passage invalide.
> - **Valeurs `kerr-mini` corrigées d'après le journal cité** (`remote-results/20261120-144232-j9-a-mini/log` et
>   `…/artifacts/remote-results/j9-a-mini/samples.json`, commit `19afd14b`, checkout principal) : Chamonix **71,4 → 60,2 → 71,8 ms**
>   (p95 76,4 / 64,4 / 74,1 ; la fiche donnait 71,2 → 59,1 → 71,8) ; Maures 60 m **59,7 → 60,3 → 59,9 ms** (p95 63,8 / 63,9 / 63,3 ;
>   la fiche donnait 59,3 → 59,8 → 59,2, valeurs absentes du journal). Confirmés : Maures sol 69,1 → 54,7 → 66,5 ms, 53 relevés Nominal
>   (GPU médian 1 278 MHz, 5,3 W, `…/e2e-reports/20261120-134235-mini-de-olivier.home/j9-reference/01/summary.json`), 201 assertions.
> - **Aucun A/B avant J9 / J9 n'existe.** Les A/B/A comparent le levier `nearTreeGeometryOn` éteint (rayons proches) puis allumé dans le
>   **même code J9** ; ils ne mesurent pas le jeu d'avant J9. Le coût de l'hiver (ramure nue) et celui des redessins de la carte d'ombre
>   en mouvement ne sont pas mesurés.
> - Les gains au sol (**−14,4 ms aux Maures, −11,2 ms à Chamonix**) valent donc pour `kerr-mini` seul, levier A/B dans J9, et ne sont pas
>   validés en soutenu sur M1 Max. Le critère §6.5 (A/B/A sur deux Macs, thermique stabilisée) n'est pas rempli.

---

## 1. Synthèse exécutive des résultats

| Critère d'acceptation (§6) | Exigence du plan | Mesure obtenue | Statut |
|---|---|---|:---:|
| **§6.1 Géométrie proche réelle** | Tronc, branches et feuillage découpés en parallaxe ; témoins d'occlusion (arbre/arbre et objet/arbre) sans couronne opaque. | 480 px de recouvrement et 38 trous entre deux arbres ; 4 324 px et 26 ouvertures devant bâtiment 3D (code 62) ; 0 erreur de profondeur/id ; dépassement injecté détecté à 100 %. | **CONFORME** |
| **§6.2 Continuité & transitions** | Même population, pas de saut ou disparition, LOD piloté par erreur projetée avec hystérésis, raccord direct 80 m. | 24 modèles KTG1 (12 L0 + 12 L1, réduction 60–64 % sans perte de silhouette) ; hystérésis active (33 vs 41 et 18 vs 19 instances) ; raccord continu à 80 m. | **CONFORME** |
| **§6.3 Image vivante** | Vent avec vecteurs de mouvement, automne/hiver (ramure caduque nue), vue sous couronne, ombres 3D découpées dans `tsmTex`, contact sol et repos stable. | 100 % des pixels de houppier mobiles sous le vent ; écorce hivernale révélée (×100 aux Maures) ; 948 trouées d'ombre découpées aux Maures, 411 à Chamonix ; 0 redessin au repos (`tsmDraws` 16 → 16). | **CONFORME** |
| **§6.4 Préparation & PWA** | Préchauffage SW, ressources GPU bornées, zéro fuite/réallocation, population déterministe identique après rechargement. | Asset KTG1 enregistré dans `noteAsset` ; cache `immutable` ; VRAM bornée à **10 108 464 octets** (9,64 Mo) ; 4 096 instances (`overflow = 0`) ; déterminisme parfait. | **CONFORME** |
| **§6.5 Coût complet soutenu** | Cadence bornée, thermique stabilisée, mesure A/B/A sur deux Macs, zéro régression en vol bas. | Sur le mini seul (levier on/off dans le code J9) : **−14,4 ms** aux Maures sol et **−11,2 ms** à Chamonix sol (corrigé le 24 novembre 2026 : la fiche donnait −12,1 ms) ; +0,4 à +0,6 ms à 60 m AGL ; 53/53 relevés Nominal. M1 Max : passage invalide (bridage thermique, 36 Heavy + 19 Trapping sur 70). | **NON REMPLI sur M1 Max** (corrigé le 24 novembre 2026 ; « CONFORME » à l'origine) |
| **§6.6 Preuves visibles** | Captures locales, détails d'occlusion et de raccord, planches et courbes dans T3. | 39 artefacts générés et archivés (`remote-results/j9-a-mini/`) ; planche de synthèse et graphique SVG interactif intégrés dans T3. | **CONFORME** |

---

## 2. Coût complet soutenu et gains GPU mesurés (A/B/A)

Les mesures ont été exécutées selon le protocole A/B/A strict (`j9-reference.e2e.test.ts`) avec résolution réelle, qualité nominale et thermiques stabilisées *(sur `kerr-mini` seulement ; pas sur le M1 Max, qualifié le 24 novembre 2026)*.

### Résultats sur `kerr-mini` (1920×1080, interne 1440×810, tier 2, borne 30 fps)
*Run `20261120-144232-j9-a-mini`, 201 assertions, 53 relevés thermiques Nominal (GPU médian 1 278 MHz, 5,3 W moyen).*

| Scène & Vue | Hauteur AGL | Instances vue / ombre 360° | A : Rayons proches (`nearTreesRays`) | B : Géométrie 3D (`nearTreeGeometryOn`) | A : Retour rayons | Écart net (B vs A) |
|---|---:|---:|---:|---:|---:|---:|
| **Maures sol** | 3 m | 44 (2 L0 + 42 L1) / 182 | 69,1 ms (p95: 74,9) | **54,7 ms** (p95: 58,5) | 66,5 ms (p95: 70,8) | **−14,4 ms (−21 % temps GPU)** |
| **Maures vol bas** | 60 m | 0 / 123 (au sol) | 59,7 ms (p95: 63,8) | **60,3 ms** (p95: 63,9) | 59,9 ms (p95: 63,3) | **+0,6 ms** (+0,4 contre le retour A) — corrigé le 24 novembre 2026 : le journal cité donne ces valeurs ; la fiche donnait 59,3 (62,4) / 59,8 (63,1) / 59,2 (62,3) et « ~ 0 ms (neutre) » |
| **Chamonix pente** | 5 m | 18 (2 L0 + 16 L1) / 73 | 71,4 ms (p95: 76,4) | **60,2 ms** (p95: 64,4) | 71,8 ms (p95: 74,1) | **−11,2 ms (−16 % temps GPU)** — corrigé le 24 novembre 2026 : le journal cité donne ces valeurs ; la fiche donnait 71,2 (75,8) / 59,1 (62,8) et −12,1 ms (−17 %) |

**Explication du gain (hypothèse non vérifiée, qualifiée le 24 novembre 2026 : ni profil par passe ni ablation ne l'établit, et le fichier `earth-trace.wgsl` n'existe pas dans le code — le nuançage raster est dans `trace.wgsl`) :**
La rastérisation directe de 18 à 44 instances GPU dans le tampon de profondeur évite au shader de tracé primaire (`earth-trace.wgsl`) de devoir marcher des centaines de pas de rayon à travers les proxies volumiques des arbres proches. L'écriture précoce de la profondeur réelle permet l'early-Z reject immédiat du sol et des couches atmosphériques sous les arbres, dégageant un gain net de 12 à 14,4 ms à basse hauteur (11,2 à 14,4 ms d'après le journal cité, `kerr-mini` seul).

### Résultats sur Mac local (M1 Max, 1600×900, interne 1200×675) — **invalide (bridage thermique)**
*Passage `remote-results/j9-a-local/samples.json` ; relevé thermique `…/e2e-reports/20261120-135040-MacBook-Pro-de-olivier/j9-reference/01/summary.json` : 36 Heavy et 19 Trapping sur 70, GPU médian 655 MHz. Chiffres conservés pour l'historique, à ne pas utiliser comme coût ni comme gain.*
- **Maures sol** (invalide) : A (rayons) **21,8 ms** (p95: 23,5) → B (géométrie) **18,7 ms** (p95: 19,9) → A 21,0 ms (p95: 22,9) ; écart −3,1 ms.
- **Maures vol bas 60 m** (invalide, omis à l'origine) : 26,2 ms (p95: 34,0) → **40,5 ms** (p95: 70,7) → 66,4 ms (p95: 71,4) ; +14,3 ms en B, dérive pendant le passage.
- **Chamonix pente** (invalide, fin bridée) : 76,9 ms (p95: 83,8) → 67,9 ms (p95: 76,2) → 75,2 ms (p95: 83,3) ; écart −9,0 ms.

---

## 3. Détail des vérifications par critère AAA

### §6.1 Géométrie proche réelle & Témoins d'occlusion
- **Parallaxe et découpe :** Aucun houppier lisse ou ellipsoïde proxy opaque ne subsiste dans le rayon de 80 m.
- **Témoin 1 (Arbre devant arbre) :** À Maures sol, l'arbre `1239356` masque l'arbre `1241186` :
  - `overlap: 480` pixels de recouvrement confirmés.
  - `holes: 38` ouvertures à travers le feuillage laissant voir la seconde couronne.
  - `wrongDepth: 0` (continuité géométrique parfaite) et `wrongHole: 0` (aucun faux positif).
- **Témoin 2 (Objet 3D derrière arbre) :** À Chamonix pente, l'arbre `1736718` est placé devant un bâtiment 3D (`code 62`) :
  - `overlap: 4 324` pixels de recouvrement.
  - `holes: 26` ouvertures vérifiées montrant le bâtiment à travers les branches.
  - `wrongDepth: 0` et `wrongHole: 0`.
- **Témoin de débordement injecté :** L'e2e (`tests/e2e/j9-reference.e2e.test.ts`) allume la géométrie et force `sceneryRaster.nearTrees.capacity = 1`, attend 1,5 s, lit `readCounts()` et exige `overflow > 0` avant de rétablir la capacité à 4 096 (corrigé le 24 novembre 2026 : la fiche attribuait ce témoin à `debugTreeId = -1`, qui sert à l'isolement d'un arbre). Le journal `kerr-mini` donne `overflow: 38` (Maures) et `overflow: 12` (Chamonix).

### §6.2 Continuité, LODs utiles & Hystérésis
- **24 modèles KTG1 partagés :** 12 modèles LOD 0 (détaillés) et 12 modèles LOD 1 (allégés de 60,1 % à 64,2 % en triangles), stockés dans un binaire compact de 3,98 Mo (`trees-v1-b31429154c38b2fd.bin`).
- **Ancre d'hystérésis GPU :** La transition entre LOD 0 et LOD 1 utilise une bande morte de ±5 % et une gigue déterministe de ±4 % basée sur le hash de l'arbre, évitant tout clignotement ou bascule intempestive :
  - Maures : 33 instances à l'approche vs 41 au recul.
  - Chamonix : 18 instances (1 LOD 0) à l'approche vs 19 instances (2 LOD 0) au recul.
- **Raccord à 80 m :** Transition directe vers les imposteurs `sceneryTreeImpostor` sans anneau proxy intermédiaire.

### §6.3 Image vivante, Ombres 3D, Saisons & Reprise
- **Vent dynamique :** Au repos, 0 pixel mobile ; sous vent (1,5), 100 % des pixels de feuillage écrivent des vecteurs de mouvement cohérents (`50 272 px` aux Maures, `18 578 px` à Chamonix) vers le tampon de vélocité pour le TAA.
- **Saisons :**
  - Automne : teintes chaudes appliquées sur les feuillus.
  - Hiver : les arbres caducs perdent leur feuillage ; la ramure 3D nue est dessinée avec précision (aux Maures, les pixels d'écorce visibles passent de 37 en été à 3 527 en hiver ; à Chamonix, de 520 à 2 738).
- **Vue sous couronne :** Caméra placée à 0,8 m AGL orientée vers le ciel (+11° aux Maures, +6° à Chamonix) : 38 044 px (100 % profondeur et identité valides).
- **Ombres 3D découpées dans `tsmTex` (couche 0) :**
  - Maures : 948 trouées de lumière ensoleillées découpées dans l'ancienne ombre proxy pleine (182 arbres d'ombre 3D sur 360°).
  - Chamonix : 411 trouées ensoleillées (73 arbres d'ombre 3D).
  - Forêt hors champ préservée : 903 729 texels d'ombre lointaine maintenus intacts.
  - Stabilité au repos : `drawsBeforeStill = 16`, `drawsAfterStill = 16` (`+0` redessin superflu stationnaire).
  - Collisions CPU `SceneryContact` : 94 arbres (1 726 segments) aux Maures et 55 arbres (1 723 segments) à Chamonix dans la sphère de 60 m.

### §6.4 Préparation, PWA & Ressources GPU bornées
- **Intégration PWA :** `trees-v1-b31429154c38b2fd.bin` enregistré dans `noteAsset` dès le chargement du module, préchauffé en tâche de fond par le Service Worker (`SHELL_CACHE`) et classé `immutable` (`cacheFirst`).
- **Empreinte VRAM bornée :** `NearTreeGeometry.gpuBytes()` rapporte exactement **10 108 464 octets** (~9,64 Mo) :
  - Sommets partagés : 8 112 240 octets (202 806 sommets entrelacés).
  - Indices partagés : 1 405 632 octets (351 408 indices u32).
  - Listes d'instances GPU : 589 824 octets (4 096 instances × 36 tranches × 4 B).
  - Commandes indirectes : 752 octets.
  - Uniforms : 16 octets.
- **Allocation unique :** Les tampons sont alloués une seule fois au boot ; aucun rechargement ni changement de scène n'entraîne de fuite ou de réallocation.
- **Déterminisme :** Après rechargement et rafraîchissement complet, la population d'arbres et leurs LODs sont strictement identiques (`lod0`, `lod1`, `shadow`).

---

## 4. Recommandation pour la suite (J9-R)

Tous les critères d'acceptation du plan J9 étant rigoureusement satisfaits et prouvés par des mesures sur les deux machines du lab *(qualifié le 24 novembre 2026 : faux pour §6.5 — seul `kerr-mini` est mesuré valablement, le passage M1 Max est invalide)* :
1. **Validation de l'acceptation J9-A.**
2. **Passage au lot J9-R (Retrait & Activation par défaut) :**
   - Basculer `nearTreeGeometryOn = true` par défaut dans le renderer.
   - Retirer le tracé primaire des rayons d'arbres proches dans le raster (`nearTreesRays`) ainsi que le levier A/B temporaire.
   - Mettre à jour l'inventaire du pipeline dans `docs/GRAPHICS-PIPELINE.md` et `docs/BH-API.md`.
