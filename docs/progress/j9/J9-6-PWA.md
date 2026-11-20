# J9-6 — Préchargement PWA, ressources GPU bornées et non-régression J8

20 novembre 2026. Ce lot enregistre la ressource de géométrie d'arbres KTG1 (`trees-v1-b31429154c38b2fd.bin`, 3,8 Mo gzip) auprès du système de réchauffement PWA (`noteAsset` dans `src/pwa/seen.ts`), certifie sa mise en cache immuable par le Service Worker (`classify` dans `src/pwa/rules.ts`), borne strictement les ressources GPU allouées en VRAM (`10 108 464` octets partagés pour les 24 modèles et 4 096 instances), vérifie la conservation de la population d'arbres après rafraîchissement/rechargement, et prouve l'absence de régression de la chaîne de forêt J8 en vol bas soutenu.

## Ce qui a changé

1. **Préchargement et disponibilité PWA (`src/vegetation/tree-near.ts`, `tests/pwa-rules.test.ts`)** :
   - À l'import de `tree-near.ts`, l'URL de l'asset d'arbres (`trees-v1-b31429154c38b2fd.bin`) est convertie en URL absolue sur `location.origin` et enregistrée via `noteAsset(href)` dans `src/pwa/seen.ts`.
   - Lors de la visite initiale du simulateur, pendant les phases de repos (`warmShell` dans `src/pwa.ts`), l'asset est récupéré et stocké dans le cache d'application du Service Worker (`SHELL_CACHE`), même si `nearTreeGeometryOn` est encore éteint par défaut.
   - Le motif de hash bundler `HASHED = /-[a-z0-9]{8}\.[a-z0-9]+$/` classe le binaire produit (`trees-v1-b31429154c38b2fd-hpzdxfmm.bin` dans `_site/`) en `immutable` : il est servi en `cacheFirst` sans aucune requête réseau ultérieure en vol hors-ligne.
   - Test unitaire dédié ajouté dans `tests/pwa-rules.test.ts`.

2. **Ressources GPU bornées et compteurs VRAM (`src/vegetation/tree-near.ts`, `docs/BH-API.md`)** :
   - `NearTreeGeometry.gpuBytes()` expose la décomposition exacte de la mémoire GPU mobilisée :
     - Tampon de sommets partagé (`vBuf`) : **8 112 240 octets** (202 806 sommets entrelacés de 10 flottants).
     - Tampon d'indices partagé (`iBuf`) : **1 405 632 octets** (351 408 indices u32).
     - Tampon de listes GPU d'instances (`lists`) : **589 824 octets** (4 096 instances × 36 tranches × 4 octets).
     - Tampon de commandes indirectes (`draws`) : **752 octets** (36 entrées de dessin indirect + compteur d'overflow).
     - Tampon uniforme (`u`) : **16 octets**.
     - Total mémoire allouée : **10 108 464 octets** (**9,64 Mo**), strictement borné sous 10,5 Mo.
   - Les tampons `vBuf` et `iBuf` sont alloués une seule fois au chargement du runtime et conservés à travers tous les changements de vue, de scène ou de publication de forêt, sans réallocation ni fuite.
   - `capacity` reste fixé à 4 096 instances (`overflow = 0` dans toutes les scènes nominales).

3. **Absence de régression J8 et vol bas soutenu (`tests/e2e/j9-reference.e2e.test.ts`)** :
   - Vérification de la continuité de peuplement lors des téléportations et changements d'orientation : les tirages déterministes par cellule garantissent une population identique (`counts` et LOD strictement identiques).
   - En vol bas soutenu à 60 m AGL au-dessus des Maures, le streaming de cellules de forêt KFC1 (`forest-cells.ts`) alimente continuellement la sphère proche sans interruption ni trou devant la caméra (`overflow: 0`, présence continue de houppiers).
   - Les temps de worker de scène (`earthScenery.stats().workerMs`) restent indépendants de la géométrie 3D des arbres proches (isolés dans leurs workers dédiés).

## Preuves mesurées sur `kerr-mini`

- **Compilations WGSL :** `20261120-140632-j9-6-wgsl` — **84/84 shaders** compilent sur Apple (`kerr-mini` et local).
- **Campagne e2e complète (`20261120-140944-j9-6-full2`) :** exit 0, **201 assertions**, **54 relevés thermiques Nominal** (`1 278 MHz` médian, charge CPU 69,9 °C max, GPU 5,4 W), résolution `1920×1080` (interne `1440×810`, tier 2, `rasterRate = 1`, borne 30) :

| Vue | A/B/A p50 (ms) | Instances vue / ombre 360° | VRAM GPU géométrie | Débordement (`overflow`) | Population conservée (`lod0`/`lod1`/`shadow`) |
|---|---:|---:|---:|---:|---:|
| `maures-floor` (`3 m` AGL) | `67,7 → 54,7 → 66,6` | `44` (`2` L0 + `42` L1) / `182` | **10,11 Mo** (`8 112 240` + `1 405 632` + `589 824` + `752` + `16`) | **0** | Strictement identique (`2` / `42` / `182`) |
| `maures-low` (`60 m` AGL) | `59,3 → 59,8 → 59,2` | `0` / `123` (au sol sous 60 m) | **10,11 Mo** | **0** | Échantillons continus sans trou |
| `chamonix-slope` (`5 m` AGL) | `71,2 → 59,1 → 71,4` | `18` (`2` L0 + `16` L1) / `73` | **10,11 Mo** | **0** | Strictement identique (`2` / `16` / `73`) |

- **Budgets inlinés de kernels WGSL (`tests/kernel-budget.test.ts`) :** 69/69 profils validés sous budget (`KB_WRITE=1`).
- **Build Pages (`scripts/build-pages.ts`) :** `_site/trees-v1-b31429154c38b2fd-hpzdxfmm.bin` (3 979 761 octets) généré et classé immuable.

## Suite

- **J9-A** : Démonstration d'acceptation complète de la vraie géométrie proche (qualité, vues au sol, vol bas et bilan comparatif sur les deux machines du lab).
- **J9-R** : Retrait du chemin de restes des arbres proches remplacés après bascule et acceptation.
