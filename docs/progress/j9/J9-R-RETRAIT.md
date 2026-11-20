# J9-R — Retrait du chemin proche remplacé et bascule par défaut

20 novembre 2026. Ce lot finalise le plan **J9** ("Les arbres proches en vraie géométrie — AAA work") après la validation intégrale de l'acceptation **J9-A** sur les deux machines du laboratoire. Il active la vraie géométrie 3D d'arbres proches par défaut dans le renderer (`nearTreeGeometryOn = true`), retire l'ancien tracé primaire de rayons des arbres proches dans le raster (`nearTreesRays = false`), et met à jour l'inventaire du pipeline graphique ainsi que les contrats d'automatisation.

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
- **Performances mesurées :**
  - Sol des Maures : **69,1 ms → 54,7 ms** sur `kerr-mini` (−14,4 ms, +26 % de débit), **21,8 ms → 18,7 ms** sur M1 Max (−3,1 ms).
  - Pente de Chamonix : **71,2 ms → 59,1 ms** sur `kerr-mini` (−12,1 ms, +20 % de débit), **76,9 ms → 67,9 ms** sur M1 Max (−9,0 ms).
  - Vol bas à 60 m AGL : neutre sans régression (**59,3 ms → 59,8 ms → 59,2 ms**).
- **Empreinte VRAM :** Strictement bornée à **10 108 464 octets** (9,64 Mo) allouée une seule fois au boot, zéro fuite, capacité 4 096 instances, zéro débordement (`overflow: 0`).
- **Disponibilité PWA :** Asset préchauffé via `noteAsset`, mis en cache immuable par le Service Worker (`cacheFirst`).
- **Stabilité thermique :** 53/53 relevés thermiques Nominal sur `kerr-mini` (GPU médian 1 278 MHz, 5,3 W).
- **Vérifications :** 84/84 shaders WGSL validés, 201 assertions d'intégration réussies, zéro erreur console ou GPU.
