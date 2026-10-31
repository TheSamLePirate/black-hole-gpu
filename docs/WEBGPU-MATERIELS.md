# Les appareils et WebGPU : qui peut jouer, avec quoi, et ce que chacun perd

Date : 31 octobre 2026, sur `main` à `4146b9a8`. Trois sortes de chiffres, toujours signalées :
- **mesuré** : nos propres bancs (Kerr Bench, `docs/bench-result-externes/`, `docs/perf/`) ;
- **sourcé** : le code de Chrome/Dawn, de WebKit, de Firefox/wgpu, et la statistique de web3dsurvey (§6) ;
- **estimé** : une déduction, avec sa méthode ; à confirmer par un banc sur l'appareil.

## 1. En bref

- **Le jeu demande peu à WebGPU pour démarrer** : les limites par défaut de la spécification suffisent (16 textures,
  8 buffers de stockage, textures de 8 192). Tout appareil qui offre WebGPU « core » lance le jeu.
- **Une seule limite décide de la qualité : `maxSampledTexturesPerShaderStage`.** À 27 ou plus, le jeu a tout. À 16, il
  perd **huit fonctions**, dont la plus lourde de conséquences : **le raster de la Terre et des corps proches** (le vol
  bas tracé rayon par rayon, beaucoup plus lent).
- **En pratique, il n'existe que deux cas** : Chrome arrondit ses limites à des paliers fixes depuis début 2026 (16 ou
  48, rien entre les deux) ; Safari donne 44 ; Firefox 96 ou plus. Les paliers intermédiaires du jeu (18 à 26) ne
  servent quasiment jamais.
- **Ceux qui restent à 16** (≈ 23 % des appareils qui ont WebGPU, web3dsurvey) : **ChromeOS** (81 % à 16), **Linux sur
  Intel** (Mesa), **Samsung Internet** (99 % à 16), les vieux iGPU Intel (gen 11 : 62 % à 16), Chrome plus ancien que
  la version 146.
- **Ceux qui n'ont pas WebGPU du tout, ou seulement en mode « compat »** (OpenGL ES) : le jeu ne démarre pas. Android
  avant 12, les GPU Exynos (Xclipse) et PowerVR avant Android 16 sous Chrome, Firefox sur Linux et Android, les
  Snapdragon Windows autres que le X Elite.
- **Le reste, c'est la puissance du GPU** : mesurée de 440 (iPad Pro M1) à 3 805 (NVIDIA Blackwell) au Kerr Score. Le jeu
  s'y adapte seul (son palier d'appareil et sa résolution dynamique).

## 2. Ce que le jeu demande à WebGPU

### 2.1 Le minimum (tout appareil WebGPU l'a)

| Limite | Demandé | Pourquoi | Défaut de la spec |
|---|---|---|---|
| `maxStorageBuffersPerShaderStage` | 8 | le traceur (8 buffers) | 8 |
| `maxSampledTexturesPerShaderStage` | 16 | le traceur et la LUT du champ lointain | 16 |
| `maxTextureDimension2D` | 8 192 | la carte de Jupiter (8 192 × 4 096), la Voie lactée (réduite sinon) | 8 192 |
| `maxComputeInvocationsPerWorkgroup` | 256 | la FFT de la mer (256 × 1), le reste en 8 × 8 ou 16 × 16 | 256 |
| `maxComputeWorkgroupStorageSize` | ~9 Ko | l'éclairage des vaisseaux (9 Ko), la tuile des géantes (6 Ko) | 16 384 |
| `maxStorageBufferBindingSize` | 16 à 64 Mio | le décor (bâtiments, arbres) selon la portée : 16, 36 ou 64 Mio | 128 Mio |

Fonctions WebGPU optionnelles : `texture-compression-bc` ou `-astc` (les cartes HD compressées en BC7 ou en ASTC ;
sans l'une ni l'autre, en RGBA : 4 à 8 fois plus de mémoire, et pas de carte KTX de Jupiter), `timestamp-query`
(le profileur seulement).

### 2.2 L'échelle des textures : ce qui s'allume, palier par palier

Le traceur ajoute ses fonctions dans cet ordre, chacune seulement si l'appareil accepte assez de textures par étage
(`renderer.ts traceLayout`) ; on demande `min(27, l'appareil)`.

| Textures | Fonction allumée | Sans elle (l'appareil sous ce palier) |
|---|---|---|
| 16 | le traceur, la LUT du champ lointain | — (le jeu ne démarre pas en dessous ; la spec garantit 16) |
| 18 | **la surface régionale** (orthophotos et relief fins : IGN, swisstopo, sources nationales) | l'imagerie et le relief mondiaux seulement (Sentinel/ETOPO…), plus flous de près |
| 19 | **la mer en FFT** (la houle par cascades) | la mer analytique, plus simple |
| 21 | **la table de perspective aérienne** | l'air recalculé à chaque pixel : plus lent |
| 22 | **le raster de la Terre et des corps proches** (sa visibilité primaire, la marche du sol qui part de ses distances) | **tout le sol proche tracé rayon par rayon** : le vol bas, l'atterrissage, la marche sur la Lune ou Mars beaucoup plus lents, l'image plus bruitée |
| 23 | **la carte d'ombre du relief** (±10 km) | les ombres du relief par rayons |
| 25 | **la passe des nuages** (demi-résolution, historique reprojeté) | chaque pixel marche jusqu'à quatre volumes de nuages : plus lent, plus de traînées |
| 26 | **la carte d'ombre des nuages** | l'ombre des nuages projetée en 2D |
| 27 | **la carte d'ombre des arbres et des bâtiments** | un rayon vers le Soleil à travers la forêt et les bâtiments à chaque pixel |

Et un buffer : **9 buffers de stockage → le décor** (bâtiments, arbres : `SCENERY_STORAGE_LIMIT`). Sans le 9ᵉ, pas de
bâtiments ni d'arbres 3D. Tous les navigateurs actuels en donnent au moins 9 (§3), sauf le mode compat.

### 2.3 Le palier d'appareil (la résolution)

Indépendamment des limites, `src/tier.ts` devine un palier au démarrage, puis la mesure le corrige (le gouverneur le
monte ou le descend selon la charge du GPU, et s'en souvient une semaine) :

| Palier | Deviné pour | Pixels au plus | Qualité conseillée au Kerr Score |
|---|---|---|---|
| 0 | adaptateur logiciel (SwiftShader, llvmpipe) | 0,5 Mpx | « low » (< 150) |
| 1 | écran tactile, ≤ 4 Go de RAM, Intel | 0,9 Mpx | « medium » (150–399) |
| 2 | Apple (toutes puces), NVIDIA/AMD portables | 2,2 Mpx | « game » (400–799) |
| 3 | NVIDIA/AMD de bureau | 3,5 Mpx | « high » (800–1 499) |
| 4 | (par la mesure seulement) | 6 Mpx | « ultra » (≥ 1 500) |

## 3. Ce que chaque navigateur donne

Chrome et Edge **arrondissent** les limites de l'appareil à des paliers fixes (Dawn `ApplyLimitTiers`, appelé par
Chrome depuis 2026) ; les limites d'un même groupe tombent ensemble au palier inférieur si l'une manque le sien. Le
palier 48 des textures exige aussi ≥ 10 buffers uniformes dynamiques, ≥ 8 de stockage dynamiques, ≥ 8 textures de
stockage dans chaque étage, ≥ 16 échantillonneurs, ≥ 12 buffers uniformes ; il est arrivé dans Dawn le 29 janvier 2026
(Chrome 146 environ ; **estimé**). Avant, Chrome donnait 16.

| Navigateur, plateforme | Textures | Buffers de stockage | Buffer max / liaison | Source |
|---|---|---|---|---|
| Chrome/Edge, macOS (Apple Silicon, Mac Intel) | **48** | **10** | ~4 Gio | **mesuré** (M1 Max) + Dawn Metal : 31 emplacements − 1 − 12 − 8 = 10 |
| Chrome/Edge, Windows D3D12 (NVIDIA, AMD, Intel) | **48** | **16** | 2 Gio | **mesuré** (RTX 5070 Ti, Blackwell) + Dawn D3D12 |
| Chrome, Windows, Qualcomm D3D12 (avant Adreno 8xx) | 48 | 16 | **256 Mio** / 2 Gio | Dawn D3D12 |
| Chrome, Android, Linux, ChromeOS (Vulkan) | 48 si le pilote le permet, sinon **16** | 8 à 16 | souvent **128 Mio** sur Adreno 7xx | Dawn Vulkan + web3dsurvey |
| Safari 26, macOS, iOS, iPadOS (et Chrome iOS : c'est WebKit) | **44** | **44** | ≥ 1 Gio | **mesuré** (iPad Pro M1) + WebKit |
| Firefox, macOS | 96 | **9** | — | wgpu Metal (mode WebGPU strict) |
| Firefox, Windows | très grandes | très grandes | — | wgpu D3D12 |
| Chrome en mode compat (OpenGL ES 3.1) | 16 | 8 (4 en fragment) | 128 Mio | Dawn ; **le jeu ne l'utilise pas** |

La part des appareils WebGPU réels (web3dsurvey, lu le 31 octobre 2026 ; ni taille d'échantillon ni date affichées) :

| | ≥ 27 textures (donc 44 ou 48) | ≥ 9 buffers | BC | ASTC |
|---|---|---|---|---|
| Ensemble | **≈ 91 %** (≥ 44) | 100 % | 88 % | 46 % |
| Windows | 98 % | ≈ 100 % | 99,99 % | 0 % |
| macOS | 98 % | 99 % | 88 % | 96 % |
| iOS | 99 % | ≈ 100 % | 59 % | ≈ 100 % |
| Android | 90 % | ≈ 100 % | 35 % | ≈ 100 % |
| Linux | **62 %** | — | — | — |
| ChromeOS | **19 %** | — | — | — |
| Samsung Internet | **1 %** | — | — | — |

## 4. Le tableau : appareil par appareil

« Fonctions » renvoie à l'échelle du §2.2 : **toutes** = les 27 paliers et le décor ; **base** = le palier 16 seul (sans
surface régionale, mer FFT, table de l'air, raster, ombres du relief, passe des nuages, ombres des nuages et des arbres).
Le Kerr Score : 1 000 = un Apple M1 Max sous Chrome (octobre 2026).

| Appareil | Navigateur | WebGPU | Fonctions | Kerr Score | Qualité, fluidité | Restrictions |
|---|---|---|---|---|---|---|
| **Mac M1 Max** | Chrome 154–155 | oui | toutes | **773–875 mesuré** | « game » à « high » ; 70–110 i/s sur les scènes du banc ; vol bas dans les nuages ~39 ms sur le M1 du mini | 10 buffers (le décor tient) ; chauffe après des heures (−10 %) |
| Mac M1 / M2 / M3 de base (8–10 cœurs GPU) | Chrome, Safari 26 | oui | toutes | **~250–450 estimé** | « medium » à « game » ; 30–60 i/s en scène de banc, la résolution réduite | 8 Go de RAM partagée : prudence avec la portée lointaine du décor (64 Mio) et les cartes HD |
| Mac M-Pro / M-Max récents (M3, M4) | Chrome, Safari 26 | oui | toutes | **~800–2 000 estimé** | « high » à « ultra » | — |
| Mac Intel (Iris, Radeon Pro) | Chrome | oui | toutes (48 / 10) | **~100–400 estimé** | « low » à « game » | GPU lents pour un traceur ; compilation longue |
| Mac | Firefox 147+ | oui | toutes (96 / 9) | — | **non testé** | jamais essayé ici : pilotes et WGSL de wgpu à vérifier |
| **PC NVIDIA Blackwell** (banc externe du 4 octobre) | Chrome 154 | oui | toutes | **3 805 mesuré** | « ultra » ; 85–140 i/s en 1440p | **première image de la Terre ~2 min** (compilation D3D12) |
| **PC ROG, RTX 5070 Ti** (kerr-pc) | Chrome 156 | oui | toutes | **2 632 mesuré** | « ultra » ; 90–145 i/s (l'approche de Gargantua en « auto » : 6,5 i/s) | **~2 min à chaque lancement** : le cache de Chrome n'y garde pas les noyaux de la Terre |
| PC RTX 20/30/40, RX 6000/7000, Arc | Chrome, Edge | oui | toutes (48 / 16) | **~800–6 000 estimé** | « high » à « ultra » | compilation D3D12 longue la première fois |
| **PC portable à deux GPU** (Intel ou AMD intégré + NVIDIA) | Chrome, Edge | oui | toutes | celui de l'**intégré** | souvent « medium » | **Chrome ignore `powerPreference` sous Windows** : il dessine sur l'intégré tant que Windows n'a pas mis Chrome en « Hautes performances » (le jeu le dit, `windowsIntegratedGpu`) |
| PC Intel Iris Xe, Radeon intégré | Chrome, Edge | oui | toutes | **~120–300 estimé** | « low » à « medium », 0,9 Mpx | lent : le palier 1, la résolution basse |
| PC Snapdragon X Elite | Chrome, Edge | oui (pilote ≥ 31.0.117) | toutes ; liaison de buffer 256 Mio peut-être | **~300–500 estimé** | « medium » à « game » | les autres Snapdragon Windows sont bloqués par Chrome ; **non testé** |
| PC | Firefox 141+ | oui | toutes | — | **non testé** | — |
| **iPad Pro M1** | Chrome iOS 154 (WebKit) | oui | toutes (44 / 44) | **440 mesuré** | « game », **~24–30 i/s** sur toutes les scènes | 1,0 Go de mémoire GPU au pic ; **perte du GPU vue 2 fois** pendant une rentrée ; Safari a fermé la page avec des captures |
| iPhone 15 Pro / 16 / 17 (A17 Pro et plus) | Safari 26 | oui | toutes | **~200–350 estimé** | « medium », 0,9 Mpx, ~20–30 i/s | RAM 8 Go : risque de perte du GPU ; chauffe ; compilation longue la première fois |
| iPhone plus anciens (A12–A16) | Safari 26 | oui (A11 minimum) | toutes | **~80–200 estimé** | « low » à « medium » | 4–6 Go de RAM : pertes du GPU probables sur la Terre de près |
| Android haut de gamme (Snapdragon 8 Gen 2/3, 8 Elite ; Tensor/Mali, Dimensity) | Chrome, Android 12+ | oui | toutes dans 90 % des cas | **~150–400 estimé** | « medium », 0,9 Mpx | Adreno 7xx : liaison de buffer souvent **128 Mio** (le décor tient : 64 Mio au plus) ; Mali : 256 invocations (assez) ; chauffe ; **non testé** |
| Android, GPU Exynos (Xclipse) | Chrome | **non** | — | — | **ne démarre pas** | GPU non activés par Chrome |
| Android, PowerVR | Chrome | Android 16+ seulement | — | — | | pilotes « 25.1 » bloqués |
| Android | **Samsung Internet** | oui | **base** (16) | — | médiocre | 99 % à 16 textures : pas de raster |
| Android avant 12, ou GPU OpenGL ES seulement | Chrome | compat seulement | — | — | **ne démarre pas** | le jeu demande WebGPU « core » |
| **Chromebook** | Chrome | oui | **base** dans 81 % des cas | **~80–250 estimé** | « low » ; vol bas très lent | pilote Mesa (Intel surtout) : 16 textures |
| Linux, Intel Gen 12+ | Chrome 144+ | oui | **base** probablement | **~100–300 estimé** | « low » | Linux : 62 % à 48 textures seulement |
| Linux, NVIDIA (pilote ≥ 535.183, Wayland) | Chrome 147+ | oui | toutes | comme sous Windows | | X11 et AMD : derrière un drapeau |
| Linux, Android | Firefox | **non** (Nightly, drapeau) | — | — | | |
| **Meta Quest 3** | Meta Quest Browser | expérimental (WebGPU dans WebXR, 146+) | — | — | **non pris en charge** | la voie native est le projet d'Alex (vr-solar-system, Unity) |
| Adaptateur logiciel (SwiftShader) | Chrome | bloqué en général | base | < 50 | palier 0, 0,5 Mpx | inutilisable |

## 5. Comment les scores sont estimés

Le traceur est limité par le calcul et les registres, pas par la mémoire : son score suit le débit en virgule flottante
du GPU. Nos ancres mesurées, en points de Kerr Score par TFLOPS FP32 (fiche du constructeur) :

| GPU | TFLOPS FP32 | Kerr Score mesuré | Points par TFLOPS |
|---|---|---|---|
| Apple M1 Max (32 cœurs) | ~10,4 | 773–875 | ~75–85 |
| Apple M1 (iPad Pro, 8 cœurs) | ~2,6 | 440 | ~170 |
| RTX 5070 Ti (kerr-pc) et NVIDIA Blackwell externe | ~44 (5070 Ti de bureau) | 2 632–3 805 | ~60–86 |

Estimation : **score ≈ 60 à 170 × TFLOPS**, le haut de la fourchette pour les petites puces (moins de cœurs à
alimenter, meilleur rendement par cœur), le bas pour les grandes, avec **−30 à −50 % sur téléphone** (chauffe et
fréquences basses en jeu soutenu). Les fourchettes du §4 viennent de là ; chacune est à remplacer par un Kerr Bench sur
l'appareil (le banc est dans le jeu, à l'adresse `…/#bench`, un lien à envoyer).

## 6. Autres restrictions à connaître

- **La compilation des noyaux** : sous Windows (D3D12), la première image de la Terre attend ~2 min (kerr-pc), **à chaque
  lancement** (le processus GPU de Chrome, isolé, n'écrit pas le cache du pilote) ; sur Apple, ~19 s à froid (le mini). Chaque scène nouvelle compile ses noyaux.
  `docs/PLAN-LEAN-TRACER-KERNELS.md`.
- **La mémoire** : 1,0 à 2,3 Go de mémoire GPU au pic mesuré (iPad, M1 Max, RTX). Les appareils à 4–6 Go de RAM
  partagée risquent la perte du GPU (« device lost ») ; le jeu sauve alors le vol et propose de recharger.
- **Les textures compressées** : BC sur Windows, Mac et la plupart des Linux ; ASTC sur téléphones et tablettes ; les
  Mac Apple Silicon ont les deux. Sans l'une ni l'autre (rare), les cartes HD en RGBA et sans la carte KTX de Jupiter.
- **Pas de mode compat** : le jeu ne fonctionne pas sur WebGPU « compatibility » (OpenGL ES, D3D11) ; ces appareils
  voient « Aucun adaptateur WebGPU trouvé » (ou « WebGPU n'est pas disponible dans ce navigateur » sans WebGPU du tout).
- **Contexte sûr** : WebGPU exige HTTPS (ou localhost).

## 7. Pistes (non décidées)

- **Le raster au palier 16** : c'est la perte la plus lourde des appareils à 16 (ChromeOS, Linux Intel, Samsung
  Internet). Les paliers 18–21 ne servent presque jamais (Chrome donne 16 ou 48) : faire passer le raster (22) **avant**
  la surface régionale, la mer FFT et la table de l'air, en libérant une liaison ou en regroupant deux textures dans un
  tableau, le rendrait aux appareils à 16. À mesurer.
- **Bancs à faire** : Mac M de base, un PC Intel Iris Xe, un Android haut de gamme, un iPhone récent, un Chromebook,
  Firefox Mac et Windows — pour remplacer les estimations du §4.
- **Le Quest** : hors de portée tant que WebGPU n'y est qu'expérimental ; l'échange avec le projet d'Alex est la voie VR.

## 8. Sources

- WebGPU, limites par défaut : https://gpuweb.github.io/gpuweb/#limits
- Dawn, paliers de limites (`ApplyLimitTiers`) : https://dawn.googlesource.com/dawn/+/refs/heads/main/src/dawn/native/Limits.cpp ;
  le palier 48 (29 janvier 2026) : https://dawn.googlesource.com/dawn/+/a082d8e7cb9118e9df5965e63c4ff64e62e5fd14
- Chrome, paliers activés : https://chromium.googlesource.com/chromium/src/+/refs/heads/main/gpu/command_buffer/service/webgpu_decoder_impl.cc
- Dawn par moteur : Metal https://dawn.googlesource.com/dawn/+/refs/heads/main/src/dawn/native/metal/PhysicalDeviceMTL.mm ;
  D3D12 https://dawn.googlesource.com/dawn/+/refs/heads/main/src/dawn/native/d3d12/PhysicalDeviceD3D12.cpp ;
  Vulkan https://dawn.googlesource.com/dawn/+/refs/heads/main/src/dawn/native/vulkan/PhysicalDeviceVk.cpp
- Chrome, liste de blocage WebGPU : https://chromium.googlesource.com/chromium/src/+/refs/heads/main/gpu/config/webgpu_blocklist_impl.cc ;
  Snapdragon Windows : https://chromium.googlesource.com/chromium/src/+/refs/heads/main/gpu/config/gpu_finch_features.cc
- Chrome, nouveautés WebGPU : https://developer.chrome.com/blog/new-in-webgpu-144 ,
  https://developer.chrome.com/blog/new-in-webgpu-147-148 , https://developer.chrome.com/blog/new-in-webgpu-155-156
- WebKit (Safari 26) : https://github.com/WebKit/WebKit/blob/main/Source/WebGPU/WebGPU/HardwareCapabilities.mm
- Firefox : https://github.com/mozilla-firefox/firefox/blob/main/dom/webgpu/Adapter.cpp ; wgpu Metal :
  https://github.com/gfx-rs/wgpu/blob/trunk/wgpu-hal/src/metal/adapter.rs
- État par navigateur : https://github.com/gpuweb/gpuweb/wiki/Implementation-Status (2 octobre 2026)
- Statistiques réelles : https://web3dsurvey.com/webgpu/limits/maxSampledTexturesPerShaderStage ,
  https://web3dsurvey.com/webgpu/limits/maxStorageBuffersPerShaderStage ,
  https://web3dsurvey.com/webgpu/limits/maxStorageBufferBindingSize ,
  https://web3dsurvey.com/webgpu/features/texture-compression-bc , https://web3dsurvey.com/webgpu/features/texture-compression-astc
- Meta Quest Browser : https://developers.meta.com/vr/release-notes/web/
- Nos mesures : `docs/bench-result-externes/` (M1 Max, iPad Pro M1, RTX 5070 Ti), `docs/perf/bench-rog-5070ti-full/` ;
  le code : `src/renderer.ts` (`traceLayout`, `requestDevice`), `src/tier.ts`, `src/system/*_TEXTURE_LIMIT`.
