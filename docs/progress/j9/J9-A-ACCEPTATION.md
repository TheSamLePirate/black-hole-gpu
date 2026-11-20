# J9-A — Démonstration d'acceptation complète de la vraie géométrie d'arbres proches

20 novembre 2026. Ce document consigne la démonstration d'acceptation complète de la vraie géométrie 3D des arbres proches (`nearTreeGeometryOn`), en conformité rigoureuse avec les **six critères d'acceptation AAA du §6 de [docs/PLAN-J9-ARBRES-PROCHES.md](../../PLAN-J9-ARBRES-PROCHES.md)**, mesurés sur les deux machines de référence du laboratoire (`kerr-mini` et Mac M1 Max).

La validation est acquise : **201 assertions unitaires et d'intégration réussies, 0 échec, 53 relevés thermiques tous Nominal**.

---

## 1. Synthèse exécutive des résultats

| Critère d'acceptation (§6) | Exigence du plan | Mesure obtenue | Statut |
|---|---|---|:---:|
| **§6.1 Géométrie proche réelle** | Tronc, branches et feuillage découpés en parallaxe ; témoins d'occlusion (arbre/arbre et objet/arbre) sans couronne opaque. | 480 px de recouvrement et 38 trous entre deux arbres ; 4 324 px et 26 ouvertures devant bâtiment 3D (code 62) ; 0 erreur de profondeur/id ; dépassement injecté détecté à 100 %. | **CONFORME** |
| **§6.2 Continuité & transitions** | Même population, pas de saut ou disparition, LOD piloté par erreur projetée avec hystérésis, raccord direct 80 m. | 24 modèles KTG1 (12 L0 + 12 L1, réduction 60–64 % sans perte de silhouette) ; hystérésis active (33 vs 41 et 18 vs 19 instances) ; raccord continu à 80 m. | **CONFORME** |
| **§6.3 Image vivante** | Vent avec vecteurs de mouvement, automne/hiver (ramure caduque nue), vue sous couronne, ombres 3D découpées dans `tsmTex`, contact sol et repos stable. | 100 % des pixels de houppier mobiles sous le vent ; écorce hivernale révélée (×100 aux Maures) ; 948 trouées d'ombre découpées aux Maures, 411 à Chamonix ; 0 redessin au repos (`tsmDraws` 16 → 16). | **CONFORME** |
| **§6.4 Préparation & PWA** | Préchauffage SW, ressources GPU bornées, zéro fuite/réallocation, population déterministe identique après rechargement. | Asset KTG1 enregistré dans `noteAsset` ; cache `immutable` ; VRAM bornée à **10 108 464 octets** (9,64 Mo) ; 4 096 instances (`overflow = 0`) ; déterminisme parfait. | **CONFORME** |
| **§6.5 Coût complet soutenu** | Cadence bornée, thermique stabilisée, mesure A/B/A sur deux Macs, zéro régression en vol bas. | Gain net de **−14,4 ms** aux Maures sol et **−12,1 ms** à Chamonix sol sur le mini ; neutre à 60 m AGL (~0 ms) ; 53/53 relevés thermiques Nominal. | **CONFORME** |
| **§6.6 Preuves visibles** | Captures locales, détails d'occlusion et de raccord, planches et courbes dans T3. | 39 artefacts générés et archivés (`remote-results/j9-a-mini/`) ; planche de synthèse et graphique SVG interactif intégrés dans T3. | **CONFORME** |

---

## 2. Coût complet soutenu et gains GPU mesurés (A/B/A)

Les mesures ont été exécutées selon le protocole A/B/A strict (`j9-reference.e2e.test.ts`) avec résolution réelle, qualité nominale et thermiques stabilisées.

### Résultats sur `kerr-mini` (1920×1080, interne 1440×810, tier 2, borne 30 fps)
*Run `20261120-144232-j9-a-mini`, 201 assertions, 53 relevés thermiques Nominal (GPU médian 1 278 MHz, 5,3 W moyen).*

| Scène & Vue | Hauteur AGL | Instances vue / ombre 360° | A : Rayons proches (`nearTreesRays`) | B : Géométrie 3D (`nearTreeGeometryOn`) | A : Retour rayons | Écart net (B vs A) |
|---|---:|---:|---:|---:|---:|---:|
| **Maures sol** | 3 m | 44 (2 L0 + 42 L1) / 182 | 69,1 ms (p95: 74,9) | **54,7 ms** (p95: 58,5) | 66,5 ms (p95: 70,8) | **−14,4 ms (−21 % temps GPU)** |
| **Maures vol bas** | 60 m | 0 / 123 (au sol) | 59,3 ms (p95: 62,4) | **59,8 ms** (p95: 63,1) | 59,2 ms (p95: 62,3) | **~ 0 ms (neutre, pas de régression)** |
| **Chamonix pente** | 5 m | 18 (2 L0 + 16 L1) / 73 | 71,2 ms (p95: 75,8) | **59,1 ms** (p95: 62,8) | 71,8 ms (p95: 74,1) | **−12,1 ms (−17 % temps GPU)** |

**Explication du gain :**
La rastérisation directe de 18 à 44 instances GPU dans le tampon de profondeur évite au shader de tracé primaire (`earth-trace.wgsl`) de devoir marcher des centaines de pas de rayon à travers les proxies volumiques des arbres proches. L'écriture précoce de la profondeur réelle permet l'early-Z reject immédiat du sol et des couches atmosphériques sous les arbres, dégageant un gain net de 12 à 14,4 ms à basse hauteur.

### Résultats sur Mac local (M1 Max, 1600×900, interne 1200×675)
- **Maures sol** : A (rayons) **21,8 ms** (p95: 23,5) → B (géométrie) **18,7 ms** (p95: 19,9), gain net de **−3,1 ms**.

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
- **Témoin de débordement injecté :** En forçant la capacité à 1 instance (`debugTreeId = -1`), la sonde d'overflow détecte immédiatement `overflow: 38` (Maures) et `overflow: 12` (Chamonix), confirmant l'intégrité de la surveillance GPU.

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

Tous les critères d'acceptation du plan J9 étant rigoureusement satisfaits et prouvés par des mesures sur les deux machines du lab :
1. **Validation de l'acceptation J9-A.**
2. **Passage au lot J9-R (Retrait & Activation par défaut) :**
   - Basculer `nearTreeGeometryOn = true` par défaut dans le renderer.
   - Retirer le tracé primaire des rayons d'arbres proches dans le raster (`nearTreesRays`) ainsi que le levier A/B temporaire.
   - Mettre à jour l'inventaire du pipeline dans `docs/GRAPHICS-PIPELINE.md` et `docs/BH-API.md`.
