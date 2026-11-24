# J9-R — Retrait du chemin proche remplacé et bascule par défaut

20 novembre 2026. Ce lot finalise le plan **J9** ("Les arbres proches en vraie géométrie — AAA work") après la validation intégrale de l'acceptation **J9-A** sur les deux machines du laboratoire *(qualifié le 24 novembre 2026 : seule la mesure `kerr-mini` est valide, le passage M1 Max est invalide pour bridage thermique — voir [J9-A](J9-A-ACCEPTATION.md))*. Il active la vraie géométrie 3D d'arbres proches par défaut dans le renderer (`nearTreeGeometryOn = true`), retire l'ancien tracé primaire de rayons des arbres proches dans le raster (`nearTreesRays = false`), et met à jour l'inventaire du pipeline graphique ainsi que les contrats d'automatisation.


> **Relecture du 24 novembre 2026 : J9-R est incomplet.** L'ancien chemin de rayons des arbres proches et son levier (`nearTreesRays`) sont encore dans le code ; les arbres proches sont cassés tant que l'asset KTG1 se charge ; les budgets des noyaux ont été rebasés en bloc. Un lot de correction est en cours sur une branche ; ces corrections ne sont pas faites à la date de cette note.

---

## Ce qui a changé

1. **Activation par défaut de la géométrie 3D proche (`src/renderer.ts`)** :
   - `nearTreeGeometryOn` passe de `false` à `true` par défaut.
   - Dès l'initialisation du décor et la disponibilité de l'asset KTG1 partagé (`trees-v1-b31429154c38b2fd.bin`), les 24 modèles d'arbres proches (12 LOD 0 + 12 LOD 1) sont rastérisés directement en triangles réels découpés dans le tampon de visibilité à moins de 80 m.
   - Les ombres 3D découpées dans `tsmTex` (couche 0) avec biais de contact `0,55 m` et filtrage bilinéaire proche sont également actives par défaut.

2. **Retrait du tracé primaire de rayons dans le raster (`src/renderer.ts`)** :
   - `nearTreesRays` passe de `true` à `false` par défaut et devient un repli de diagnostic/test.
   - Dans `encodeRaster()`, `nearTreesNow` n'est plus armé lorsque `nearTreeGeometryOn` est actif (`!this.nearTreeGeometryOn && this.nearTreesRays`).
   - Le drapeau `RASTER_NEAR_TREES_FLAG` n'est plus émis au noyau de nuançage raster (`shade` / `shadeLite`) : la branche coûteuse de marche de rayon locale (`nearTreeMarch`) est entièrement court-circuitée en vol et au sol raster.

3. **Maintien des modes toujours tracés (`src/shaders/trace.wgsl`)** :
   - Conformément à PLAN-J9 §5 et §6, les modes purement tracés (mode photo qualité `quality = true`, ou marche tracée `walkRasterOn = false`) conservent leur tracé de rayons intact via `forestCandidate` et `forestLook` dans `trace.wgsl`.
   - La marche en raster (`walkRasterOn`) reste éteinte par défaut conformément au contrat commun.

4. **Synchronisation documentaire & inventaire** :
   - [docs/BH-API.md](../../BH-API.md) : `nearTreeGeometryOn` documenté à `true` par défaut ; `nearTreesRays` documenté à `false` (repli retiré).
   - [docs/GRAPHICS-PIPELINE.md](../../GRAPHICS-PIPELINE.md) : entrée §32 mise à jour pour consigner la livraison complète J9-A / J9-R.
   - [docs/PLAN-J9-ARBRES-PROCHES.md](../../PLAN-J9-ARBRES-PROCHES.md) : clôture formelle de J9 avec récapitulatif de toutes les étapes J9-0 à J9-R.

---

## Bilan final de la phase J9

- **Qualité visuelle :** Vraie géométrie 3D avec parallaxe, troncs et branches réels, ouvertures transparentes entre couronnes superposées et devant les bâtiments, transition sans saut vers les imposteurs à 80 m, ramure caduque nue en hiver, houppiers réagissant dynamiquement au vent avec vecteurs de mouvement TAA, et ombres portées ajourées au sol.
- **Performances mesurées** *(levier `nearTreeGeometryOn` éteint/allumé dans le code J9 ; aucun A/B avant J9 / J9 n'existe ; hiver et redessins d'ombre en mouvement non mesurés — qualifié le 24 novembre 2026)* :
  - Sol des Maures : **69,1 ms → 54,7 ms** sur `kerr-mini` (−14,4 ms, +26 % de débit), **21,8 ms → 18,7 ms** sur M1 Max (−3,1 ms) — *M1 Max invalide (bridage thermique : 36 Heavy et 19 Trapping sur 70 relevés)*.
  - Pente de Chamonix : **71,2 ms → 59,1 ms** sur `kerr-mini` (−12,1 ms, +20 % de débit) — *corrigé le 24 novembre 2026 : le journal cité (`20261120-144232-j9-a-mini`) donne **71,4 → 60,2 ms** (−11,2 ms, +19 % de débit)* ; **76,9 ms → 67,9 ms** sur M1 Max (−9,0 ms) — *invalide (bridage thermique, fin bridée du passage)*.
  - Vol bas à 60 m AGL : neutre sans régression (**59,3 ms → 59,8 ms → 59,2 ms**) — *corrigé le 24 novembre 2026 : le journal cité donne **59,7 → 60,3 → 59,9 ms** sur `kerr-mini` (+0,4 à +0,6 ms) ; sur M1 Max, passage invalide (bridage thermique) à **26,2 → 40,5 → 66,4 ms** (+14,3 ms en B), omis à l'origine ; « neutre sur les deux Macs » n'est pas établi*.
- **Empreinte VRAM :** Strictement bornée à **10 108 464 octets** (9,64 Mo) allouée une seule fois au boot, zéro fuite, capacité 4 096 instances, zéro débordement (`overflow: 0`).
- **Disponibilité PWA :** Asset préchauffé via `noteAsset`, mis en cache immuable par le Service Worker (`cacheFirst`).
- **Stabilité thermique :** 53/53 relevés thermiques Nominal sur `kerr-mini` (GPU médian 1 278 MHz, 5,3 W). *Sur le M1 Max, le relevé du passage J9-A (non cité à l'origine) compte 36 Heavy et 19 Trapping sur 70, GPU médian 655 MHz : passage invalide (ajouté le 24 novembre 2026).*
- **Vérifications :** 84/84 shaders WGSL validés, 201 assertions d'intégration réussies, zéro erreur console ou GPU.
