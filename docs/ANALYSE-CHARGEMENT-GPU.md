# Analyse — chargement, compilation des shaders, détection du GPU

*2026-10-05 · analyse seule, aucun code modifié · références `fichier:ligne` sur HEAD ·
rév. 2 : vérification croisée de toutes les citations code et sources externes — corrections
intégrées en place, journal détaillé en §7*

Deux questions traitées, complétées d'une vérification :

1. **Comment améliorer le chargement** (temps avant la première image, recompilations, réseau)
   — et **ce qui se passe au rechargement de la page** (§6).
2. **Comment détecter le GPU de l'utilisateur** et **adapter** le chargement, le nombre de
   pipelines compilés et les textures.

---

## 0. Résumé exécutif

Le démarrage actuel est dominé par **une seule chose** : la compilation du noyau `trace.wgsl`
(6 362 lignes), dont **5 pipelines backend attendus avant la première image alors que 2 à 3
suffisent** (rt + env, + lut quand `lutOn` — §2.1-A), plus une passe de validation qui
**re-parse et re-valide les 8 modules, séquentiellement** (front-end Tint, pas une
recompilation backend — §2.1-B). Sur D3D12/Windows le code l'admet
lui-même (`renderer.ts:626`) : *« one takes a minute or more »*.

Le rechargement, lui, est **déjà bien couvert côté réseau** : les shaders voyagent dans le
bundle hashé, précaché par le Service Worker — rien à retélécharger. La seule incertitude est
la **recompilation GPU** au rechargement (cache disque de shaders du navigateur, de taille
limitée — cf. §6), à vérifier par la mesure : le bench enregistre déjà les durées par étape.

Le gros gain n'est donc pas micro-optimiser le WGSL mais **réorganiser l'ordre** :

- attendre **2 pipelines** (rt + env, **+ lut ou un garde** selon la scène) au lieu de 5 →
  gain ~2–3× sur le temps d'attente au splash ;
- valider en `Promise.all` sur les modules existants (ou au build, `check-wgsl.ts` existe
  déjà en CI) → supprime un re-parse front-end redondant (gain **à mesurer**, non chiffré) ;
- démarrer les téléchargements (éphémérides 7 Mo, ciel, cartes) **avant/pendant** la
  compilation GPU au lieu d'après — aujourd'hui `loadEphemerides` (`main.ts:220`) ne démarre
  qu'après le retour de `Renderer.create()`, c'est-à-dire après plusieurs minutes de compile
  sur machine lente.

Côté GPU faible, le projet devine déjà un « tier » (`src/tier.ts`) mais : la détection
repose sur des chaînes vendor fragiles, **la qualité d'intégration (steps/eps/spp) ne
s'adapte jamais au matériel**, et le gate dur « 10 storage buffers ou erreur » (`renderer.ts:959`)
refuse de démarrer là où un repli serait possible. La solution la plus fiable est de
**mesurer** (micro-benchmark ~200 ms + calibrage sur les premières frames — le mécanisme
« measured ↑ » existe déjà, il suffit de le rendre bidirectionnel et de l'appliquer aussi
aux paramètres d'intégration), puis d'adapter une **matrice tier × (pixels, steps, eps,
textures, features)**.

---

## 1. État des lieux — rappel et compléments chiffrés

### 1.1 Chronologie du démarrage

```
main.ts:185   renderer = await Renderer.create(canvas)
  ├─ requestAdapter(high-performance)                renderer.ts:957
  ├─ GATE DUR: maxStorageBuffersPerShaderStage < 10 → throw   :959
  ├─ requestDevice(requiredLimits = maxima adapter)  :963
  ├─ constructeur (synchrone):
  │    8 modules (trace, display, post, ship, endurance, station, chart, noise bake)
  │    + ~40 pipelines SYNC layout:"auto"  :564-761
  │    (post ×15, display ×3, ship ×13, endurance ×2, station ×3,
  │     chart, sky ×2, bakeNoise3d 128³)
  ├─ 5 createComputePipelineAsync du tracer (lut, lutq, rt, q, env)  :650-659
  ├─ VALIDATION: 8 modules recréés + getCompilationInfo, await SÉQUENTIEL  :1043-1056
  └─ await tracerFailure (les 5 pipelines)           :1039
main.ts:220   loading ephemeris (7 Mo) ← ne démarre qu'ICI
main.ts:228   loadSky() ← et ici
main.ts:2352  première frame quand les fonts sont prêtes (au plus tard 1,5 s après le set-up
              — Promise.race(fonts, 1500 ms))
```

Poids du splash (`loading.stage`) : gpu 0,5 · shaders 1 · **pipelines 4** · éphémérides 2 ·
ciel 2 · étoiles 2 · cartes 3 · terre 3 → l'essentiel du baryl est la compilation.

### 1.2 Budget d'assets (dist/, mesuré)

| Type | Taille | Contenu |
|---|---|---|
| `.ktx2` | 100 Mo (35 fichiers) | cartes planètes + cube Terre high (6 faces × ~10 Mo) |
| `.jpg` | 96 Mo (86 fichiers) | Terre med/high (couleur/nuages/relief), réserve BC/ASTC |
| `.bin` | 77 Mo (17 fichiers) | DE440/JUP365, modèles Ranger/Endurance/ISS, DEM Lune |
| bundle JS | 2,1 Mo (1 fichier) | tout le code + **les 9 shaders en texte** (~9917 lignes, ~270 Ko) |
| total dist | **293 Mo** | |

**Note de mesure** : le `dist/` audité contenait **7 bundles hashés** (`index-*.js`, builds
accumulés, ~11 Mo au total) — seul le courant (2,1 Mo) est déployé, `_site` étant reconstruit
de zéro (`rm -rf _site`, `build-pages.ts:5`) ; le précache SW n'hérite donc pas des bundles
périmés. Sans conséquence, mais le « 1 fichier » du tableau ne vaut que pour le build courant.

Les cartes planètes sont déjà **à la demande** (`requestPlanetMaps`, `renderer.ts:813`,
déclenché par la première scène qui en a besoin) — bon point à préserver. La Terre a déjà
deux tiers (`med` 2048², `high` 4096², `system/earth-maps.ts:12-13`) et un **repli mesuré en cas
d'échec** (`earthCap = "med"/"none"`, `renderer.ts:846`) — c'est le meilleur pattern du
projet, à généraliser.

### 1.3 Combien de fois `trace.wgsl` est compilé

| # | Instance | Déclencheur | Bloquant au démarrage |
|---|---|---|---|
| 1 | module `trace` | constructeur `:564` | non |
| 2 | pipeline `lut` (rt) | `:650` | **oui** |
| 3 | pipeline `lutq` | `:651` | **oui** |
| 4 | pipeline `main` quality | `:652` | **oui** |
| 5 | pipeline `main` realtime | `:653` | **oui** (seul réellement nécessaire) |
| 6 | pipeline `env` | `:655-659` | **oui** |
| 7 | module re-créé pour validation | `:1044` | **oui, séquentiel** |
| 8 | module re-créé + pipeline | `precisionProbe` `:3897` | à la demande |
| 9+ | variants `HAS_*` (jusqu'à 5 par clé de features) | `traceVariant` `:2389-2425` | arrière-plan ~10 s/pièce, `variants` Map jamais purgée |

Note de lecture du tableau : les instances 1 et 7 sont des **créations de module** (front-end
Tint : parse + validation, pas de compilation backend) ; la compilation backend a lieu aux
créations de pipelines (instances 2–6, 8, 9+). « Compilé 7 à 8 fois » mêle donc les deux
niveaux — le coût dominant est les 5 pipelines.

Chaque pipeline avec des `constants` différents est une **spécialisation complète** côté
backend (pas un simple ifdef). Mesure de référence publique (Chrome, « GPU Program Caching »,
webcodingcenter.com) : descripteur identique ≈ 1 ms, **même module avec une nouvelle valeur
d'override ≈ 28 ms** (kernel jouet ; le nôtre est ~3 ordres de grandeur plus gros), d'où les
minutes observées sur D3D12.

---

## 2. Améliorer le chargement

### 2.1 Chemin critique de la première image (gains majeurs, ordre décroissant)

**A. N'attendre que les pipelines de la première image.** Aujourd'hui `await tracerFailure`
(`:1039`) couvre `Promise.all` des 5 pipelines. Le chemin realtime utilise `tracePipeline`
(`QUALITY_PIPELINE: 0`) **et** `envPipeline` (dispatché à chaque frame realtime, `:3570`),
**et le LUT quand `lutOn`** (`:2416` — commentaire du code : « every realtime frame » ;
`lutOn` à `:1772` exige `(featureKey & LUT_BLOCKERS) === 0 && farFieldLut && block <= 2` —
masqué par les réglages d'usine (`jet: true`, `settings.ts:467`, et le jet est un LUT
blocker, `:143`) mais atteignable, ex. jet coupé dans une scène sans corps, `farFieldLut`
étant `true` par défaut). Les variantes quality/lutq ne servent que quand la caméra
s'immobilise, et `traceVariant` retombe proprement sur le pipeline général tant que le
variant spécialisé n'est pas prêt (`:2378-2387`) — **mais ce repli ne couvre pas un pipeline
général non encore attendu** (`?? general` vaudrait `undefined` → `setPipeline(undefined)`).
Il faut donc :

- retourner de `create()` dès que `mkTrace(false)` et `env` sont résolus, **et soit** attendre
  `lut` aussi (3 pipelines), **soit** ajouter un garde `lutOn && this.lutPipeline` dans
  `dispatchTrace` (comportement visible : pas de LUT les premières secondes) ;
- garder l'attente des 2–3 autres **hors du chemin critique**, rattachée à
  `loading.done("pipelines")` quand elle arrive, avec le statut affiché (le splash a déjà une
  pilule pour les assets retardés).

Gain attendu : sur une machine où chaque variante coûte T, le temps au splash passe de
~5T+validation à ~2–3T. C'est le **plus gros gain isolé** de tout le plan. Risque : **faible,
pas nul** — le garde LUT (ou le 3e pipeline attendu) est obligatoire.

**B. Ne pas dupliquer la validation.** La boucle `:1043-1056` recrée 8 modules neufs et les
`await` un par un. Précision de coût (correction rév. 2) : `createShaderModule` +
`getCompilationInfo` n'exécutent que le **front-end** (parse + validation Tint des ~9 900
lignes) — pas de compilation backend ; le gain de sa suppression est donc **à mesurer**
(probablement des secondes sur machine lente), et non « un tiers du travail de compile »
comme affirmé en rév. 1. Contrepartie à conserver : c'est cette boucle qui produit des erreurs
**numérotées par ligne**, lisibles par l'utilisateur, sur un driver exotique — la CI
(`check-wgsl.ts`) ne couvre pas les échecs spécifiques à un device. Trois niveaux de
correction, cumulables :

1. *minimum* : `Promise.all` au lieu du `await` séquentiel (le fetch des assets n'a pas ce
   problème, lui) ;
2. *mieux* : réutiliser les modules **existants** (`this.traceModule.getCompilationInfo()` —
   le constructeur les garde déjà) : le front-end n'est pas refait, on ne lit que les messages ;
3. *idéal* : la validation d'erreurs WGSL a déjà lieu **au build/CI** (`scripts/check-wgsl.ts`
   compile les 9 shaders avec le vrai compilateur Chrome headless, cf. `AAA-PROGRESS.md:40`).
   Au runtime, seuls les pipelines async (déjà en error scope `:981`) ont besoin d'un check.
   La boucle runtime peut devenir un simple `popErrorScope` + lecture des messages des modules
   déjà créés.

**C. Démarrer le réseau pendant la compilation.** `loadEphemerides` (7 Mo) et `loadSky` (Gaia +
catalogue) sont démarrés **après** le retour de `create()`. (Rév. 1 mentionnait aussi « le
bundle lui-même » : erreur — le bundle est le préalable de tout le JS, il ne peut pas se
charger après `create()` ; retiré.) Or rien ne
les y oblige : les URLs sont connues avant. Créer les promesses de fetch **avant**
`Renderer.create()` (pattern `loading.track` existe déjà) et les `await` plus tard.
Sur machine lente en compile, ce temps est ~gratuit ; sur fibre, ~0. Idem pour le
`<link rel="preload" fetchpriority="high">` de DE440 et de la carte Gaia dans `index.html`
(les fetch commencent pendant le parse du HTML, avant même le JS).

**D. Skip du splash plus tôt et plus honnête.** `splash.ts` : le bouton skip n'apparaît qu'à
9 s **et** seulement « once something is on screen ». Pendant une compile de 3–5 min,
l'utilisateur n'a ni image ni échappatoire. Un skip « arriver au menu sans image (compilation
en cours) » est défendable : la frame loop tourne déjà, elle n'a besoin que des pipelines
(voir A) — avec un affichage clair du restant.

**E. Premier rendu sans le noyau (optionnel, plus invasif).** Le pipeline `display` est prêt
très tôt. Un « mode attente » (le ciel procédural + texte, encodé par `displayModule` seul,
sans `dispatchTrace`) donnerait une image à <2 s sur toutes les machines, la vraie image
arrivant quand le tracer est compilé. Le code a déjà les briques (procédural sky en repli,
`loadSky` en arrière-plan) — c'est un changement de `frame()` à encadrer, à ne faire qu'après A–D.

### 2.2 Compiler moins

**F. Variants `HAS_*` : compiler moins, purger.** `traceVariant` (`:2389-2425`) lance une
cascade de 5 compiles à chaque changement de `featureKey`, et `this.variants` n'est jamais
vidé. Améliorations sans changer le rendu :

- purger LRU (garder ~2 clés : la courante + FEATURES_ALL) ;
- ne compiler **que** le variant de la phase qui arrive (realtime d'abord, quality seulement
  quand la caméra va s'immobiliser — le hook existe : phase `converging`) ;
- regrouper les features stables : `HAS_RWY`/`HAS_BODIES`/`HAS_KERR` changent rarement en vol ;
  les features de scène (radio, jet, wormhole) aussi. Une clé « grossière » (ex. 2–3 bits de
  poids fort) diviserait le nombre de variantes compilées par 4–8 — mais **pas à coût ~nul**
  (correction rév. 2) : un bit à 1 compile le code de la feature *dedans* (accumulation
  volumétrique, polarisation…), pas seulement une branche uniforme ; il faut que chaque
  chemin soit **aussi** masqué par un drapeau uniforme à l'exécution, ce qui reste à vérifier
  feature par feature. Le compromis (moins de compilations contre un kernel realtime plus
  lourd) doit être mesuré.

**G. Descripteurs stables = cache disque.** Chrome garde des shaders compilés dans un cache
disque GPU. Attention à la source du chiffre (correction rév. 2) : le commentaire de
`gpu/config/gpu_switches.cc` (« 6 Mo par défaut, 2 Mo Android, 128 Ko low-end ») décrit le
**cache de shaders GLES** (périphériques embarqués) ; que le blob cache Dawn/WebGPU partage
exactement ce budget n'est **pas établi** — la couche de cache WebGPU de Chrome est distincte
et son comportement varie selon les révisions. Clé = descripteur **résolu** + code. Deux
conséquences pratiques :

- ne pas faire varier le texte du module entre sessions (commentaires générés, timestamps) —
  aujourd'hui c'est bon (texte statique bundlé) ;
- l'argument « layouts explicites pour la clé de cache » est **retiré** : la clé est calculée
  sur le descripteur résolu, les layouts `auto` sont déterministes à code identique, et
  Chrome 117 a précisément ajouté du caching pour les pipelines `layout: "auto"`
  (« created more efficiently and will use less memory » — blog Chrome, New in WebGPU 117).

À retenir toutefois : **si** les budgets du cache GLES s'appliquent à Dawn, le cache
Android/low-end est minuscule (128 Ko–2 Mo) et ne tiendra pas le noyau ; sur ces machines, la
seule arme sûre est la section 3 (compiler moins). Applicabilité à trancher par la mesure
(§6.4, action #12).

**H. Les 40 pipelines sync → async (+ création différée, voir I).** Un pipeline sync compile
de façon bloquante dans le GPU process. Nuance par rapport au commentaire `:626` (correction
rév. 2) : le risque watchdog y est lié à un kernel de **6 362 lignes** ; `post.wgsl` (710
lignes) et `ship.wgsl` (1 340) sont 5–10× plus petits — le risque pour ces pipelines est le
**jank** du constructeur (la création sync se paie au premier frame), pas le kill du GPU
process. La justification « clé de cache » des layouts explicites est retirée (voir G) ; la
justification qui reste est le passage en `createRenderPipelineAsync` /
`createComputePipelineAsync` et la création différée (I).

**I. Tout ce qui n'est pas visible à l'écran titre → async + différé.** `ship.ts` (13 pipelines),
`station.ts`, `endurance.ts` sont créés dans le constructeur. À vérifier avant de différer
(correction rév. 2) : l'écran titre rend la scène **live** en arrière-plan
(`titleScreen.open()`, `main.ts:2347`) — que le Ranger y soit visible ou non dépend du vol
repris ; un différé peut produire un **pop-in** du vaisseau pour un joueur qui reprend sa
session. `createRenderPipelineAsync` + création paresseuse (à la première frame qui en
a besoin, avec 1–2 frames de grâce) : le constructeur tombe à ~15 pipelines critiques.

### 2.3 Réseau et bundle

**J. Code splitting du bundle 2,1 Mo.** Bun build actuel : un seul fichier. Les candidats
évidents au lazy-loading : `map3d` (126 Ko), `flighthud` (170 Ko), `controller/*` (226 Ko),
le planificateur (déjà un worker séparé, bon modèle). Le WGSL reste dans le bundle (270 Ko,
nécessaire tôt). Gain modeste (le bundle est déjà servi compressé + SW cache) mais gratuit.

**K. Terre : les jpg `high` (4096², ~60 Mo) ne devraient partir que si le tier le justifie.**
Aujourd'hui `requestEarthMaps("high")` est déclenché par la proximité caméra (`:1892-1897`),
ce qui est bien, mais rien ne lie le choix du tier à la **capacité** du GPU (VRAM, limite
`maxTextureDimension2D` — 4096² est sous le min spec 8192, OK, mais le **stockage** 6 faces
BC7 4096² ≈ 96 Mo GPU s'ajoute aux ~224 Mo de buffers de target). Sur tier ≤ 1, plafonner à
`med` dès le départ (voir §3.5) économise le téléchargement *et* la VRAM.

**L. Un seul `.ktx2` par source ? Non — le transcodage à la cible est le bon choix.**
`system/ktx2.ts:35-36` choisit BC7 (desktop) ou ASTC (mobile) selon les features du device, transcodé
en worker : c'est exactement l'« adapter les textures au GPU » demandé, déjà fait. Le point
faible est ailleurs : le **repli sans BC/ASTC** (téléphone/Safari ancien) retombe sur les jpg
décompressés en rgba8 — ×4 en VRAM, à intégrer au budget du tier (voir M).

### 2.4 Ce qui ne vaut pas le coût

- **Compiler dans un worker** (`OffscreenCanvas`/WebGPU en worker) : possible, mais le device
  et ses pipelines ne sont pas partageables entre worker et main thread — il faudrait tout
  déplacer (rendu inclus) ou tout recréer. Coût architectural énorme pour un gain que A–C
  apportent déjà. À ne considérer qu'en dernier recours.
- **Réécrire `trace.wgsl` en plusieurs fichiers compilés séparément** : WGSL n'a pas de
  linkage séparé ; le découpage par `HAS_*` constants (déjà fait) est l'équivalent correct.

---

## 3. Détecter le GPU et adapter le chargement

### 3.1 Ce que la plateforme donne réellement (2026)

| Source | Contenu | Fiabilité / support |
|---|---|---|
| `adapter.info` (attribut sync, ex-`requestAdapterInfo()` déprécié) | `vendor`, `architecture`, `device` (PCI id), `description`, `isFallbackAdapter` | Chrome/Edge : rempli ; **Safari/Firefox : historiquement vides ou partiels, mais WebKit peuple progressivement (PR #12923) — à re-mesurer sur Safari 26**, la spec laisse chaque UA décider. MDN + intent-to-ship Blink |
| `adapter.limits` | `maxStorageBuffersPerShaderStage` (min spec 8), `maxStorageBufferBindingSize` (min spec 128 MiB ; web3dsurvey : ~98 % ≥ 256 MiB, ~15 % ≥ 2 GiB — un vrai signal de génération ; chiffres de la rév. 1 « 100 % ≥ 128 MiB, 93 % ≥ 644 MiB » non retrouvés à la source, « 644 MiB » ne correspondant à aucune valeur usuelle — corrigé), `maxComputeWorkgroupStorageSize`, `maxComputeInvocationsPerWorkgroup`, `maxSampledTexturesPerShaderStage`, `maxBindGroups`, `maxBufferSize` | **le signal le plus portable** — normalisé, toujours renseigné |
| `adapter.features` | `timestamp-query`, `texture-compression-bc/astc`, `float32-filterable`, `subgroups` (Chrome) | normalisé, fiable |
| `navigator.deviceMemory` | RAM approximée à la puissance de 2 (Chrome **63+** — et non 97+ comme écrit en rév. 1 ; **pas** Safari/Firefox) | signal grossier, à ne pas utiliser seul (`tier.ts` le fait déjà avec un défaut 8) |
| `matchMedia("(pointer: coarse)")`, `(dynamic-range: high)` | proxy mobile / écran HDR | fiable |
| `PerformanceNavigationTiming`, devicePixelRatio | compléments | fiable |

Ce qui **n'existe pas** : la VRAM (aucune API), le nom commercial du GPU, un classement de
performance standard. Toute détection « par le nom » (parser `description`) est condamnée :
chaînes vides sur Safari, vendor IDs sans table, GPU inconnus. La seule voie robuste :
**signaux statiques (limits/features) pour le plancher, mesure pour le classement.**

### 3.2 Ce que le code fait déjà (inventaire)

- `guessTier` (`tier.ts:17-35`) : fallback adapter/SwiftShader → tier 0 ; touch ou mem ≤ 4 → 1 ;
  Intel → 1 ; NVIDIA/AMD → 2–3 (mobile/laptop dans la description) ; **Apple et les inconnus → 2**.
- **Promotion mesurée** (`promoted()`, `tier.ts:37-45`) : si le GPU tient le cap de pixels en
  dessous de la moitié du budget pendant 12 s → un tier de plus. Détection par la mesure, déjà
  en place (`main.ts:2135-2145`) — mais **unidirectionnelle** (jamais de démotion) et
  appliquée **seulement au cap de pixels**.
- Plafond de pixels par tier (`CAP = [0.5, 0.9, 2.2, 3.5, 6]` Mpx) + résolution dynamique
  (`adaptBlock`, `renderer.ts:3647`, blocs `[1,2,3,4,6,8]`) : l'adaptation **spatiale** est
  complète et bien faite.
- Textures : tiers Terre + repli sur échec (`earthCap`, `:846`), transcodage BC7/ASTC par
  features (`ktx2.ts:35`), cartes planètes à la demande.
- `requiredLimits` = maxima de l'adapter (`:963-972`) : correct (on ne demande jamais plus
  que ce qui est rapporté).
- **Ce qui manque** : adaptation des paramètres d'intégration (steps/eps/spp — identiques sur
  un M3 Max et un iGPU), gate dur storage buffers sans repli, `powerPreference` inconditionnel,
  pas de démotion, pas de persistance du tier mesuré.

### 3.3 Limites des heuristiques actuelles (à corriger si on les garde)

1. **Apple indistinguable** (M1 base = M1 Max ×4–8 en puissance) — le code le documente
   (`tier.ts:37`). Sur ces machines, seule la mesure tranche.
2. `mem <= 4 → tier 1` (`tier.ts:24`) : faux positif possible (desktop 4 Go avec bon GPU —
   `deviceMemory` est la RAM système, pas la VRAM) et faux négatif (iGPU 8 Go partagés).
3. Chaînes `vendor/architecture` vides (Safari/Firefox) → tout tombe dans le `level = 2`
   par défaut, y compris les iGPU faibles.
4. Le touch → tier 1 pénalise les tablettes haut de gamme (M-series iPad, testées dans
   `remote-results/ipad-*`).

Conclusion : `guessTier` est un **prior** acceptable (il ne sert qu'au premier écran), à
condition que la mesure corrige vite (§3.4) et dans **les deux sens**.

### 3.4 Mesurer plutôt que deviner — calibration en deux temps

**Phase 1 — probe au démarrage (~100–200 ms, pendant que le splash tourne).** Le pattern
consacré (webgpufundamentals « WebGPU Timing », micro-benchmarks type calibration) : un
kernel minimal **représentatif du noyau** (une boucle géodésique courte, mêmes types de
buffers/textures) dispatché sur une petite target (256²), chronométré par `timestamp-query`
**quand il est là** — la feature est **optionnelle** et filtrée à la création du device
(`:966-968`) ; support ~98 % des rapports Android (web3dsurvey), mais le probe doit retomber
sur un chronométrage wall-clock (`onSubmittedWorkDone`) sinon — justement sur la partie du
parc où les features manquent (correction rév. 2). Trois mesures utiles :

1. **débit rayon** (Mrays/s sur le probe) → classe directement le tier ;
2. **temps de `createComputePipelineAsync`** d'un kernel moyen — corrèle avec la vitesse du
   driver/compilateur, donc prédit le coût de compilation du noyau (utile pour choisir
   combien de variants lancer, §3.5) ;
3. **overhead dispatch** (100 dispatchs vides) — disperse les iGPU lents.

Le probe peut tourner **pendant** la compilation des vrais pipelines (autre queue/pass) —
temps masqué, **avec une réserve** (rév. 2) : sur les GPU faibles (justement la cible), un
kernel concurrent se dispute le GPU process avec les compilations et peut fausser les deux
mesures — le « gratuit » doit être vérifié par la mesure. Alternative zéro-code-supplémentaire : **utiliser les 15 premières frames
réelles** — `adaptBlock` tient déjà des médianes par bloc et `prof.traceMs()` donne le temps
de la passe de tracé ; il suffit d'en tirer un Mrays/s et de classer.

**Phase 2 — calibration continue, bidirectionnelle.** Généraliser le mécanisme existant
(`promoted`) en :

- **démotion** : médiane des frame times > budget ×1,5 pendant N s au bloc le plus grossier
  → tier −1 (et non « rester au bloc 8 avec les mêmes steps », l'impasse actuelle) ;
- **promotion** : mécanisme actuel, **à condition de revoir son déclencheur** (rév. 2) — il
  exige `block <= 2` **et** 12 s sous la moitié du budget (`main.ts:2138-2143`) ; sur un GPU
  rapide dans une scène lourde, `adaptBlock` peut rester à bloc 3–4 et la promotion ne se
  déclenche **jamais** (« measured ↑ » silencieusement inerte) ;
- **persistance** : stocker le tier mesuré + l'identité d'adapter (`vendor|architecture|device`)
  dans les prefs (`game/prefs.ts`, il y a déjà `kerr.prefs`) ; au démarrage suivant, si le
  même adapter est détecté, partir du tier mémorisé et non du guess. C'est la pratique
  standard des jeux natifs (autodétection mémorisée) et elle supprime l'erreur d'Apple :
  après une session, l'iPad M1 et le M1 Max sont classés correctement.

### 3.5 Adapter concrètement — la matrice

L'idée directrice : **le tier pilote quatre axes**, pas seulement les pixels.

| Axe | Aujourd'hui | Adapté par tier (proposition) |
|---|---|---|
| **Pixels** (cap Mpx) | `[0.5, 0.9, 2.2, 3.5, 6]` | inchangé, bon |
| **Intégration realtime** (`realtimeSteps`, `realtimeEps`) | fixes par preset (500–1000 pas) | plafond par tier au 1er lancement : tier 0 → 150/0.18 · tier 1 → 250/0.14 · tier 2 → 350/0.10 · tier 3+ → preset. `adaptBlock` ne gère que le bloc ; ces trois clés sont l'équivalent « temporel » manquant |
| **Convergence** (`targetSpp`, `qualitySteps`) | 16–256 spp | tier ≤ 1 : plafonner `targetSpp` (16) et débrayer `noiseThreshold` plus tolérant |
| **Features compilées** (`featureKey` défaut) | FEATURES_ALL au boot | tier ≤ 1 : démarrer sans `HAS_POL`/`HAS_VOL` (les plus coûteuses) — un variant de moins à compiler et un kernel plus rapide ; l'utilisateur qui les active déclenche la compile spécialisée, comme aujourd'hui |
| **Textures** | Terre med/high à la demande | tier ≤ 1 : cap `earth` à `med` dès le départ (économise ~60 Mo réseau + ~96 Mo VRAM) ; sans BC/ASTC (jpg → rgba8, ×4 VRAM) : cap `med` obligatoire et buffers de target sous-dimensionnés |
| **Compilation** | 5 pipelines attendus + variants à la demande | selon le coût de compile mesuré (§3.4-2) : GPU lent → ne précompiler **que** rt+env (A) et différer q/lutq **même en arrière-plan** tant que le realtime tourne |
| **Mémoire** | target ~64 o/px | tier ≤ 1 : alléger `gather`/`stars` (reconstruction) ou réduire le cap pour revenir à ~40 o/px — protège du `device lost` (OOM) sur cartes 2 Go |
| **Adapter** | `powerPreference: "high-performance"` | tier ≤ 1 (ou fallback) : `"low-power"` — sur portable hybride, éviter de réveiller un dGPU faible pour un iGPU correct. **Contrainte d'ordre** (rév. 2) : l'adapter est choisi (`:957`) *avant* `guessTier` — un choix piloté par le tier exige de **re-demander** l'adapter (requestAdapter → mesure → éventuellement nouveau requestAdapter), ce que la séquence §3.6 doit refléter |

**Le gate des 10 storage buffers (`:959-961`) — le vrai blocage « ne marche pas ».**
Le min spec est 8. Un GPU qui rapporte 8 est refusé alors que le repli est mécanique : les
dix bindings storage du tracer (`bindTarget` `:1295-1321` : accum, moments, stamps, stars,
polAcc, pathBuf, envBuf, bodyBuf, catalogue, lutBuf) peuvent être **packed en 6** en
fusionnant les petits à offsets fixes dans un seul buffer (`catalogue` 64 o, `lutBuf`,
`polGridBuf`, `resolveBuf` sont de petits candidats) et en passant les offsets en uniform.
Coût : une passe de refactor des bind groups ; gain : toute la classe de GPU min-spec démarre.

**Textures « nombre de shaders/textures » demandé — résumé :** les shaders se règlent via
`featureKey` + les variants (§3.5), les textures via les tiers Terre/planètes **déjà
construits pour ça** ; il ne manque que le lien tier → tier de texture, et le repli
rgba8 (sans compression) compté dans le budget VRAM.

### 3.6 Séquence de démarrage cible (synthèse)

```
t=0     HTML: preload fetchpriority=high (DE440, Gaia, bundle)
t=0     fetch éphémérides + ciel DÉMARRÉS (avant Renderer.create)
t~50ms  adapter → info/limits/features → tier prior (guessTier enrichi §3.1)
        prefs: tier mémorisé pour cet adapter ? → partir dessus
        (si le tier mémorisé contredit le powerPreference : re-requestAdapter ici, avant le device)
t~100ms device + modules ; probe GPU en parallèle (~200 ms, timestamp-query)
t~0.3s  pipelines critiques (rt + env + display) en async ; validation Promise.all
        sur modules existants ; 40 pipelines restants → async/différés (I)
t~1-3s  PREMIÈRE IMAGE (le probe a fixé le tier → steps/eps/textures adaptés)
t+      q/lutq/lut compilent en arrière-plan ; assets arrivent (déjà en vol depuis t=0)
t+      calibration continue (démotion/promotion) + persistance
```

---

## 4. Plan d'action priorisé

| # | Action | § | Gain | Effort | Risque |
|---|---|---|---|---|---|
| 1 | `create()` n'attend que rt + env (**+ lut, ou garde `lutOn && lutPipeline`**) ; q/lutq en arrière-plan affiché | 2.1-A | **~2–3× sur le splash** | faible | faible (le garde LUT est **obligatoire**) |
| 2 | Validation : `Promise.all` sur modules existants (ou purge au runtime, CI suffit) | 2.1-B | re-parse front-end évité — gain **à mesurer** (non chiffré) | faible | nul (mais perte des erreurs ligne par ligne côté utilisateur si supprimée) |
| 3 | Fetch éphémérides/ciel **avant** `Renderer.create` + `<link rel=preload>` | 2.1-C | masque 7–15 Mo réseau | faible | nul |
| 4 | ~40 pipelines sync → async ; ship/station/endurance différés (vérifier le pop-in du Ranger à l'écran titre) | 2.2-H,I | supprime le jank du constructeur | moyen | faible |
| 5 | Détection : probe (timestamp-query + repli wall-clock) + **démotion** + persistance du tier par adapter + déclencheur de promotion revu | 3.4 | GPU faibles **jouables** ; corrige Apple | moyen | faible |
| 6 | Matrice tier × steps/eps/spp + cap textures med + features allégées au boot | 3.5 | GPU faibles : image correcte au lieu de bloc-8 | moyen | faible (prefs `carried` vs `pref` à trier) |
| 7 | Gate 10 storage buffers → pack en ≤8 avec repli | 3.5 | compatibilité min-spec | élevé | moyen (bind groups) |
| 8 | Purge LRU `variants` + clés de features grossières | 2.2-F | hitches réglages −50–75 % | faible | faible |
| 9 | Splash skip dès que la frame loop tourne | 2.1-D | UX | faible | nul |
| 10 | Mode attente « image sans tracer » (display seul) | 2.1-E | 1re image <2 s partout | élevé | moyen |
| 11 | Code splitting bundle | 2.3-J | −~40 % JS initial | faible | faible |
| 12 | **Mesurer le rechargement** (cold vs reload, `#bench` + e2e) pour confirmer les hits du cache disque de shaders — cf. §6, protocoles A–C | 6 | valide (ou réfute) le §6 ; aucune modification tant que non mesuré | nul (instrumentation existante) | nul |

Séquençage conseillé : **1 → 2 → 3** (une session, gains immédiats), puis **5 → 6**
(l'adaptation GPU), puis 4, 8, 9, 11, et 7/10 selon l'ambition.

## 5. Anti-patterns à éviter (relevés dans les faits établis ci-dessus)

- **Croire aux chaînes vendor** : vides sur Safari/Firefox, non normalisées ailleurs ; ne
  servir que de prior, jamais de décision seule (§3.3).
- **`deviceMemory` ≠ VRAM** : proxy RAM système, arrondi puissance de 2, absent de
  Safari/Firefox ; défaut `8` actuel raisonnable, mais ne pas en déduire la mémoire GPU.
- **Adapter seulement les pixels** : c'est l'impasse actuelle — au bloc 8 avec 500 pas, un
  iGPU rend 0,5 Mpx de kernel lourd. Les steps/eps **doivent** suivre le tier (§3.5).
- **Promotion sans démotion** : un tier trop optimiste reste faux pour toujours.
- **Compter sur le cache disque de shaders pour les machines faibles** : si les budgets du
  cache GLES s'appliquent à Dawn (128 Ko–2 Mo Android/low-end — attribution **à confirmer**,
  §2.2-G), il ne tiendra jamais ce noyau. Sur ces machines, seule la réduction du travail de
  compile marche.
- **Pipelines sync** : compile bloquante dans le GPU process — jank × 40 au constructeur
  (le watchdog ne concerne que les gros kernels, §2.2-H). Pas de lien établi avec la clé de
  cache : Chrome 117 cache justement les pipelines `layout: "auto"`.

---

## 6. Le rechargement — les shaders se recompilent-ils ?

Trois niveaux à distinguer, car les réponses diffèrent : **la source** (le texte WGSL, réseau),
**la compilation** (les pipelines GPU), **l'état GPU** (device, textures, buffers).

### 6.1 La source : déjà garanti, rien à faire

Les 9 fichiers `.wgsl` sont importés statiquement (`with { type: "text" }`, `renderer.ts:1-40`)
et finissent **dans le bundle JS hashé** (`index-*.js`, 2,1 Mo). Au rechargement :

- le Service Worker classe le bundle `immutable` (regex `-[a-z0-9]{8}\.` de `pwa/rules.ts:17`)
  → **cache first, forever**, et il est **précaché à l'installation** (`build-pages.ts:28` :
  tout `js|css|wasm|html|json` sauf `sw.js`) — donc disponible même offline, sans attendre le
  réseau du tout ;
- la fonction `wgsl()` (`renderer.ts:149`) ne fetch jamais au runtime (les sources sont des
  textes, pas des URLs) — vérifié : aucune URL `.wgsl` passée au jeu.

Deux réserves, bénignes :

1. **Dev seulement** : le SW n'est pas enregistré en hot reload (`installPwa({ dev })`,
   `pwa.ts:17-20`) et le serveur Bun ne pose pas de `cache-control` sur le bundle → chaque
   reload re-télécharge les 2,1 Mo en local. Sans conséquence (localhost), mais à savoir
   quand on chronomètre le démarrage en dev : les chiffres ne sont pas représentatifs.
2. Un rebuild change le hash du bundle → nouveau fichier. Mais le **texte WGSL à l'intérieur
   est inchangé** — ce qui compte pour le niveau suivant (§6.2).

**Verdict : côté source, le rechargement ne retélécharge pas les shaders. Garanti.**

### 6.2 La compilation : le cache disque du navigateur, et ses limites

Au rechargement, `Renderer.create()` crée un **nouveau `GPUDevice`** : tout l'état pipeline
est perdu, chaque pipeline doit être recréé. La seule persistance inter-chargements est le
**cache disque de shaders du navigateur** (Dawn/Chrome, cf. §2.2-G) — la compilation d'un
descripteur identique tombe à ~1 ms au lieu de minutes.

**Stabilité des clés de cache (ce qui décide d'un hit ou d'un miss).** La clé = code source +
descripteur (layout, entry point, constants, formats). Inventaire de stabilité, vérifié :

| Pipelines | Source | Descripteur | Clé stable entre sessions ? |
|---|---|---|---|
| Tracer ×5 (`lut, lutq, q, rt, env`) | statique (bundle) | layouts **explicites**, `constants` fixes (`QUALITY_PIPELINE` 0/1) | **oui** |
| ~40 du constructeur (`post`×15, `display`×3, ship×13, …) | statique | `layout: "auto"` — dérivé de la reflection du module, **déterministe** à code identique ; Chrome 117 cache explicitement ces pipelines | oui |
| Variants `HAS_*` | statique | dépend des settings → clés **identiques** pour les mêmes réglages | oui, par configuration |
| `bakeNoise3d`, `bc-encode`, `earth/hd-maps` | gabarits à constantes de build fixes (`NOISE_PERIOD`…) | fixes | oui |

Rien dans le code ne varie la source entre sessions (pas de timestamp ni de métadonnées de
build injectées dans le WGSL) — vérifié sur les cinq gabarits générés.

**Mais trois limites réelles :**

1. **Taille du cache** : 6 Mo par défaut desktop, 2 Mo Android, **128 Ko sur devices
   low-end** — le commentaire de `gpu_switches.cc` décrit le cache de shaders **GLES**
   (correction rév. 2) ; que le blob cache Dawn/WebGPU partage exactement ce budget n'est
   pas établi. Les blobs compilés du noyau (DXIL D3D12 / Metal pour un kernel de 6 362
   lignes) se comptent vraisemblablement en Mo **par variante** — 5 variantes + ~40
   pipelines dépasseraient 6 Mo → **éviction partielle → recompilations partielles au
   rechargement**. C'est une hypothèse plausible mais non mesurée, sur les deux plans
   (budget applicable, taille des blobs) — d'où l'action #12.
2. **Le front-end WGSL : selon la révision** (correction rév. 2) : le cache disque stocke le
   blob backend ; l'historique de Dawn/Chrome inclut des révisions avec un cache de parse
   front-end, et le travail récent clé le blob cache sur le hash du module justement pour
   sauter des allers-retours front-end — l'affirmation de la rév. 1 « parse + validation Tint
   refaits à chaque rechargement » est donc **dépendante de la version**, à ne pas ériger en
   fait. Quoi qu'il en soit, la passe de validation actuelle (`:1043-1056`, 8 modules
   recréés) refait le parse des 8 modules à chaque lancement — c'est un argument de plus
   pour la reco §2.1-B.
3. **Invalidations hors de notre contrôle** : mise à jour du driver GPU ou du navigateur,
   nettoyage des données de navigation, navigation privée (cache session-only),
   changement de GPU. Après l'une de ces causes, recompilation complète — le splash doit
   rester conçu pour ça (il l'est).

**Safari/WebKit** : le MSL généré est compilé par le driver Metal, qui tient son propre cache
persistant — les rechargements sont généralement plus rapides, mais rien n'est documenté ni
garanti. **Firefox** (Dawn aussi chez eux) : même logique que Chrome, cache moins éprouvé.
Conclusion : le gain inter-chargements est **réel sur Chrome/Edge, probable ailleurs,
sans garantie cross-navigateur** — l'architecture doit rester correcte sans cache (elle l'est :
pipelines async + splash).

### 6.3 Ce qui est volontairement refait à chaque session

- Les **variants `HAS_*`** recalculés depuis les settings du joueur — mêmes réglages → mêmes
  clés → cache disque ; réglages différents → recompilation spécialisée, c'est le contrat du
  mécanisme (§2.2-F : purge LRU pour ne pas le laisser grossir).
- `precisionProbe` (`:3897`) : recompilé à l'appel, clé stable → cache au 2e appel.
- L'état GPU (targets, bind groups, textures) : recréé chaque session par nature.

### 6.4 Comment le vérifier (protocoles, sans modifier le code)

L'instrumentation **existe déjà** : `loading` tient `startedAt/doneAt` par étape, et le
rapport du bench les publie (`bench/report.ts:108` : `load.firstImageMs` +
`load.stages[{id, ms}]`, alimentés par `bench/runner.ts:506-507`).

- **A. `#bench` cold vs reload** : charger avec `#bench`, relever `stages.pipelines` (et
  `firstImageMs`) dans le rapport ; recharger, relever encore. Un hit de cache disque se voit
  immédiatement : « Compiling the ray tracer » passe de minutes à ~quelques secondes. Trois
  couples cold/reload pour la marge de bruit.
- **B. Introspection Chrome** : `chrome://gpu` (stats du shader disk cache),
  `chrome://tracing` (catégories `gpu`, `dawn`) pour voir les hits/misses par pipeline.
- **C. e2e automatisé** : l'infrastructure Playwright existe (`tests/e2e`, `scripts/remote.ts`) —
  un cas qui charge, recharge, et asserte que `stages.pipelines(reload) <
stages.pipelines(cold)` verrouillerait la régression dans le temps.

**Verdict d'ensemble** : réseau — garanti sans travail. Compilation — fortement atténuée par
le cache disque sur Chrome/Edge, à confirmer par la mesure (action #12), jamais garantie sur
tous les navigateurs ni contre les invalidations externes. La recommandation §2.1-B
(validation sans modules recréés) **améliore aussi le rechargement** : moins de parse répété.
(L'argument « clés de cache plus sûres » des layouts explicites est retiré — voir §2.2-G.)

---

## 7. Révision 2 (2026-10-05) — vérification croisée

Relecture complète confrontée au code (HEAD) et aux sources primaires. Méthode : chaque
citation `fichier:ligne` vérifiée dans le source ; chaque fait externe confronté à la source
originelle (Chromium/Dawn, MDN, web3dsurvey, blogs Chrome, webcodingcenter.com).

**Confirmé sans réserve** : la chronologie de démarrage et ses poids (`loading.stage`) ; les
5 pipelines attendus + la boucle de validation séquentielle (`:1039-1056`) ; le réseau démarré
après `create()` (`main.ts:185` → `:220`) ; le gate des 10 storage buffers (10 bindings
comptés dans `traceLayout`, `:572-585`) ; le budget d'assets mesuré (293 Mo ; 100/96/77 Mo ;
bundle courant 2,1 Mo) ; les règles du SW et le précache (`pwa/rules.ts:17`,
`build-pages.ts:28`) ; le skip du splash à 9 s conditionné à une image (`ui/splash.ts:70`) ;
la promotion unidirectionnelle (`main.ts:2130-2150`) ; le repli OOM Terre (`:846`) ;
`check-wgsl.ts` en CI ; le chiffre webcodingcenter (mesures exactes : 1,1 ms cache hit /
27,8 ms nouvel override — pipeline **render** jouet, Chrome, une machine).

**Corrigé en place** :

1. §2.1-A — le pipeline **lut** est sur le chemin realtime quand `lutOn` (`:2416`, `:1772`) ;
   le repli « variant → général » ne couvre pas un général non attendu ; risque « nul » →
   « faible » (garde obligatoire). La rév. 1 disait « 1 pipeline » au §0 et « 2 » au §2.1-A ;
   la réalité est 2–3 selon la scène.
2. §2.1-B — la validation recrée des modules : front-end Tint seul, pas une « recompilation » ;
   le gain « −⅓ » n'était pas mesuré → reformulé « à mesurer » ; la boucle fournit aussi les
   erreurs ligne par ligne côté utilisateur (perte à assumer si supprimée).
3. §2.2-G/H — les layouts `auto` ne « fragilisent » pas la clé de cache (descripteur résolu,
   déterministe ; Chrome 117 les cache explicitement) : argument retiré ; le « watchdog » des
   40 petits pipelines est ramené à du jank (leurs sources font 39–1 340 lignes, pas 6 362).
4. §2.2-G/§5/§6.2 — les tailles 6 Mo/2 Mo/128 Ko décrivent le cache **GLES** ; leur
   applicabilité au cache WebGPU de Chrome n'est pas établie ; « front-end jamais caché » est
   version-dépendant.
5. §3.1 — `deviceMemory` : Chrome 63+ (pas 97+) ; `maxStorageBufferBindingSize` : chiffres
   « 100 % ≥ 128 MiB, 93 % ≥ 644 MiB » non retrouvés à la source → remplacés par les chiffres
   web3dsurvey (~98 % ≥ 256 MiB, ~15 % ≥ 2 GiB) ; « Safari/Firefox : chaînes vides » nuancé
   (WebKit peuple progressivement ; à re-mesurer sur Safari 26).
6. §3.4 — `timestamp-query` est optionnel (filtré à `:966-968`) : repli wall-clock prévu ;
   contention probe ↔ compilations sur GPU faible signalée.
7. §3.4 — le déclencheur de promotion (`block <= 2` + 12 s, `main.ts:2138-2143`) peut ne
   jamais tirer sur un GPU rapide dans une scène lourde : « measured ↑ » peut rester inerte ;
   à revoir avec la démotion.
8. §3.5/§3.6 — le `powerPreference` est consommé à `requestAdapter`, **avant** `guessTier` :
   un choix piloté par le tier exige un second `requestAdapter`.
9. §2.1-C — « le bundle lui-même démarré après create() » : erreur (le bundle est le
   préalable de tout le JS) ; retiré.
10. §1.1 — « 3 modules » → 8 ; première frame : fonts **ou** 1,5 s (`Promise.race`).
11. §2.2-F — clés de features grossières : coût runtime pas « ~nul » sans masquage par
    uniformes ; à mesurer.
12. §2.2-I — « l'écran titre n'affiche pas le Ranger » : hypothèse non vérifiée (la scène
    live tourne derrière le titre) ; risque de pop-in signalé.
13. §1.2 — le `dist/` mesuré contenait 7 bundles hashés périmés (~11 Mo) ; sans effet sur le
    déployé (`rm -rf _site`), mais l'audit d'assets devait le mentionner.

**Reste à mesurer (inchangé, et renforcé)** : l'action #12 (cold vs reload, `#bench`) doit
trancher à la fois l'existence des hits du cache disque, la taille réelle des blobs du noyau,
et le budget de cache réellement appliqué à WebGPU sur les plateformes cibles.

---

### Annexes — sources externes consultées

- MDN : `GPUAdapterInfo` (attribut sync `info`, `isFallbackAdapter`), `GPUSupportedLimits`,
  Device Memory API (support Chrome **63+**, absent Safari/Firefox) — developer.mozilla.org.
- Chrome « GPU Program Caching » (design doc) + webcodingcenter.com « Pipeline Caching » :
  descripteur identique ~1,1 ms, override différent ~27,8 ms (pipeline render jouet, Chrome) —
  base du §1.3.
- Blog Chrome « New in WebGPU 117 » : les pipelines `layout: "auto"` bénéficient de mécanismes
  de caching (« created more efficiently and will use less memory ») — §2.2-G/H, §6.2.
- Chromium `gpu/config/gpu_switches.cc` : tailles du **shader disk cache GLES** (6 Mo desktop,
  2 Mo Android, 128 Ko low-end) — applicabilité au blob cache Dawn/WebGPU **non établie** —
  §2.2-G, §5, §6.2.
- web3dsurvey.com (corrigé) : `maxStorageBufferBindingSize` ~98 % ≥ 256 MiB, ~15 % ≥ 2 GiB ;
  `timestamp-query` ~98 % des rapports Android — §3.1, §3.4.
- WebKit PR #12923 : peuplement progressif de `GPUAdapterInfo` — §3.1.
- webgpufundamentals.org « WebGPU Timing » (timestamp-query) ; pattern de calibration
  micro-benchmark + mesure du temps de compile comme proxy — §3.4.
- gpuweb issue #4536 + intent-to-ship Blink : passage de `requestAdapterInfo()` async à
  l'attribut sync `adapter.info` — §3.1.