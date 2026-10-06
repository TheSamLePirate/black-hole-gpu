# Audit de la branche `test-kimi` (Kimi 5) — 2026-10-06

**Auditeur :** Claude (Opus 5.5), 5 revues parallèles + vérifications croisées, lecture seule.
**Périmètre :** `main` (6d1fd34) → `test-kimi` (ea2590f) : **23 commits, 106 fichiers, +7 514 / −563**.
**Ce qui a été exécuté :** `bun test` → **399 pass, 156 skip, 0 fail** ; `bun run check` → Biome (0 erreur, 52 warnings), tsc, **9/9 WGSL sous Metal** ; scripts numériques jetables (IAU, géodésie, orbites, VRAM, prédicteur trou de ver).
**Non exécuté :** la suite e2e (156 tests sautés sans navigateur), aucun rendu GPU visuel, aucun test Windows/D3D12, Safari ou mobile.

---

## 1. Verdict

**Note : 6,5 / 10. À ne pas fusionner en l'état.** Kimi s'était attribué 8,8 / 10.

Le travail est ambitieux et souvent rigoureux. La géodésie WGS84, la correction IAU et les transformations du trou de ver sont justes, et vérifiées numériquement. Les tests sont abondants, la documentation est honnête. Mais :

- **Deux régressions High** : l'une n'a été relevée que partiellement par l'auto-audit (H1), l'autre pas du tout (H2). Chacune se corrige en quelques lignes.
- **Le déploiement `/test/` casse le hors-ligne de la prod.** Le CI couple aussi les deux branches.
- **Le dernier commit (ea2590f, le plus gros) n'a été audité par personne.** Il contient un bug de cycle de vie du plan de vol.

Ordre de fusion conseillé : corriger H1 et H2, puis M1 à M5, faire tourner l'e2e sur le mini, et retirer `test-kimi` de `pages.yml` avant le merge.

---

## 2. Bloquants (High)

### H1 — Toute erreur JS après le démarrage tue l'application (dd5b059)

`src/main.ts:222-229` enregistre des écouteurs globaux `error` et `unhandledrejection` qui appellent `reportFatal`, ce qui positionne `startupFailed = true`. Ensuite, `src/main.ts:2081` exécute `if (startupFailed) return;` **avant** `requestAnimationFrame(loop)` : la boucle s'arrête définitivement.

- Les écouteurs ne sont jamais retirés après la première image et ne filtrent pas l'étape de démarrage.
- **Déclencheurs réalistes en vol :**
  - un `throw` dans un `.then` (`controller/plan.ts:779`, `piloting.ts:1278/1372`, `ui/fc/computer.ts:751/859`, `renderer.ts:1728/1741`, `sky.ts:175`) ;
  - `audio/engine.ts:135`, où `ctx.close()` sur un contexte déjà fermé rejette la promesse ;
  - le script d'une extension, ou une erreur « ResizeObserver loop ».
- **Conséquences :** pas d'autosave sur ce chemin, contrairement au device-lost. Le vol depuis la dernière autosave est perdu.
- **Régression par rapport à `main`**, où une exception dans une frame était survivable.
- **Correctif :** après `gpuDiagnostics.ready()` ou la première image, enregistrer l'erreur sans la rendre fatale.

### H2 — L'air des mondes Gargantua (Miller, Mann, Edmunds) est effondré ou NaN (699a27c + 8b6562c)

`src/shaders/trace.wgsl:3456` (`nearAir`) déclare `var a: AirSpec;` mais n'initialise **jamais** le nouveau champ `a.ab`, qui vaut donc 0 en WGSL. Le code fait ensuite `AIR = a`.

- Depuis 8b6562c :
  - `airTop() = 1 + top·k·ab/rm = 1` : la couche d'air est plaquée au sol ;
  - `airPhysicalDirection` et `airRayScale` divisent `z` par 0 ;
  - `airHeight` divise par `ab²` ;
  - à 699a27c déjà, `eclipsePhysical` divise par `ab` pendant les éclipses.
- **Correctif :** `a.ab = 1.0;` dans `nearAir`.
- L'e2e `ellipsoid` fixe `AIR.ab` explicitement et ne peut donc pas l'attraper. L'auto-audit déclarait « aucun bug de correction trouvé » et « chaque commit bisectable ».
- *Confirmé à la lecture, pas encore observé sur un rendu GPU.*

---

## 3. Majeurs (Medium)

| # | Commit | Problème | Où |
|---|---|---|---|
| M1 | perf / c963fe7 | **La convergence se relance sans cesse.** Chaque bascule de `calibrationReady` appelle `resetQualityTiming()`, donc `invalidate()`. Or `calibrationReady` change à chaque début ou fin de streaming des tuiles Terre et de compilation de variante. Une vue fixe déjà convergée redevient bruitée, et la résolution dynamique ne se stabilise pas en vol bas. | `main.ts:2163-2170`, `renderer.ts:3780-3797` |
| M2 | 8f0a0d4 | **Collision des Service Workers entre `/` et `/test/`, qui partagent l'origine :** <ul><li>l'activation de l'un purge les caches `kerr-shell-*` de l'autre ;</li><li>à la première visite de `/test/`, le SW racine fait `cache.put(ROOT)` avec le HTML de test, et la prod hors ligne sert alors le HTML de test-kimi avec des assets absents ;</li><li>les sauvegardes, réglages, `kerr.tier` et diagnostics sont partagés, et les saves test gagnent des champs (`tunnelEntry`, `plan.universe`).</li></ul> | `sw.ts`, `pwa/rules.ts` |
| M3 | 8f0a0d4 / 660b18d | **CI :** <ul><li>un échec de test-kimi bloque le déploiement de la prod (un seul job `site`) ;</li><li>jusqu'au merge, un push sur `main` efface `/test/` et n'est pas sérialisé avec les runs test-kimi ;</li><li>`test-kimi` reste codé en dur après le merge ;</li><li>le CI est doublé ;</li><li>le site fait environ 785 MB, contre une limite Pages de 1 GB ;</li><li>`persist-credentials` est laissé à true alors que du code de branche tourne avec `pages: write`.</li></ul> | `.github/workflows/pages.yml` |
| M4 | ea2590f | **Le plan de vol reste collé au mauvais univers.** `P.universe ??=` n'est réinitialisé que par `clearPlan`, alors que l'arrivée au trou de ver vide les nœuds (`P.nodes = []`) en gardant l'objet. Un nœud ajouté côté Gargantua déclenche alors toujours « Plan suspendu : ses manœuvres appartiennent à l'autre univers ». | `controller/plan.ts:917, 1121, 1140` |
| M5 | a452eb7 | **Le souhait de warp de l'utilisateur est perdu, jamais restauré.** `hubWarpWant = null` dès que `pilot.auto === "none"` : après une poussée en mode « WARP : VOUS », on reste au plafond du hub (souvent ×1). Au premier engagement, `setHubWarp` capture le warp déjà abaissé par les rails et met `warpWant` à null. | `piloting.ts:711`, `plan.ts:1063-1064` |
| M6 | 8b6562c | **Le PE du HUD contredit l'étiquette d'orbite.** Le PE est la hauteur géodésique *à la périapside radiale*, alors que le statut utilise le vrai minimum géodésique. Exemple d'orbite polaire : PE affiché 106,4 km (au-dessus des 102 km de l'air) mais minimum réel 98,9 km, et l'étiquette dit SUBORBITAL. Même décalage pour les marqueurs de la trace au sol. | `game/status.ts:62, 124`, `ui/groundtrack.ts:379` |
| M7 | c963fe7 | **Délais de 180 s mesurés en temps mural**, onglet caché compris. Le premier rend le pipeline qualité définitivement échoué ; le second détruit le device au démarrage. Sous D3D12, une compilation peut prendre « une minute ou plus » selon le code lui-même. | `util/async-resource.ts:28`, `renderer.ts:1045`, `ui/splash.ts` |
| M8 | c963fe7 | **C2 n'est que partiellement corrigé.** En « Jeu », des pas, epsilon ou spp montés à la main sont toujours plafonnés en silence. Et `dynOn` rend le réglage « Résolution dynamique » inopérant hors du mode Jeu (régression pour Haute et Ultra). | `quality-policy.ts:10`, `main.ts:2175` |
| M9 | 9538f33 | **Jupiter 8K :** <ul><li>32 MB téléchargés à chaque approche, sur tout appareil BC ou ASTC et à tout tier (mobile compris), sans mise en cache par le SW, contre 1,4 MB avant ;</li><li>le worker de transcodage retient environ 96 MB de heap Emscripten pour la session ;</li><li>un échec n'est pas mémorisé et est retenté à chaque approche.</li></ul> | `system/hd-maps.ts`, `ktx2.ts:13` |
| M10 | dd5b059 | **La persistance des diagnostics n'est pas limitée en débit.** Une `uncapturederror` par frame provoque environ 60 `localStorage.setItem` synchrones de plusieurs Ko par seconde. | `renderer.ts:1130`, `gpu-diagnostics.ts:89-95` |
| M11 | 64b8833 | **Les conclusions A/B ne sont pas étayées :** <ul><li>n = 4, A toujours mesuré avant B ;</li><li>la mesure est asymétrique : A sondé toutes les 250 ms, B horodaté exactement ;</li><li>le résultat « recharge nettement meilleure » repose sur deux valeurs aberrantes ;</li><li>le « ~2–3× » n'a jamais été mesuré ;</li><li>le JSON de validation étiquette « A-main » un run du même serveur local.</li></ul> | `docs/perf/ab-pages-2026-10-05.md:34-40` |

---

## 4. Mineurs (Low)

**Vol**
- **Azimut de lancement calculé en latitude géodésique** (`lowthrust.ts:653`), alors que la formule exige la latitude géocentrique. `climbAssist` utilise bien la radiale. L'écart est d'environ 0,08° d'inclinaison.
- **`hubWarpLimit` est affecté directement** au lieu d'être min-combiné (`piloting.ts:798`, et `setNodeWarp` à `plan.ts:1091`). C'est sans conséquence dans l'ordre d'appel actuel, mais fragile. Le commentaire « aucun plafond ne relâche un précédent » est faux vis-à-vis de `railsLimit`.
- **« Warp manuel respecté » à la sortie du trou de ver** est faux : `rails()` rend `timeSpeed === warpSet` à chaque frame.

**Trou de ver**
- **Coûts de calcul :**
  - la frame de passage de la sphère de recollement coûte 18 à 60 ms (`driftToGlue`, environ 40 reprises) ;
  - `advanceToMouth` rend `advance` Kerr 2 à 3 fois plus lent partout dès que le trou de ver est actif.
- **Le délai de 15 s du worker de prédiction n'annule pas le job** : les requêtes s'empilent. Le message d'erreur n'est pas traduit (`plan-client.ts:47`).
- **Franchir une frontière de région** efface `pendingMission`, `planBusy` et `fcCand` sans prévenir (`lowthrust.ts:1927-1946`).

**Démarrage et qualité**
- **Le bouton « Entrer maintenant » du splash fait encore `location.reload()`** après le repli des 180 s (`ui/splash.ts:76-104`).
- **Une compilation de variante bloquée bloque toute la `CompileQueue`** (pas de délai). Le tier ne bouge alors plus.
- **Si le pipeline qualité échoue**, une vue fixe re-rend chaque frame en temps réel, sans repli convergent.
- **Tier ≤ 1 :** le relief Terre « med » sert aussi de sol de collision, et la physique dépend alors du matériel.
- **Kerr Bench :** le gouverneur peut promouvoir le tier en cours de run et le mémoriser, ce qui change les pas de 350 à 500 entre deux runs.

**Divers**
- **Préchargement Terre :** environ 24 MB à chaque premier lancement, pour toute scène, même sans Terre.
- **Hygiène du dépôt :**
  - `yosemite-tunnel-view*.png` (2 MB, non référencés) et `audit kimi modif.md` (avec espaces) sont à la racine ;
  - `meta.json` (8 800 lignes) reste dans l'historique et n'est pas ignoré ;
  - le KTX2 de 32 MB est versionné : le dépôt suivi pèse 460 MB.
- **Commentaires périmés** (`renderer.ts:531-532, 2080` ; en-têtes de `tier.ts` et du gouverneur), et une passe d'`airRayScale` invariante non sortie de boucle dans `cloudVolume`.

---

## 5. Ce qui est solide (vérifié)

**Physique et géométrie**
- **IAU (c78718c) — exact.**
  - La dérivée est re-dérivée et le résultat confirmé par différences finies d'ordre 4 sur ±20 ans. Erreur résiduelle : Phobos 2,5e-7 °/j, Lune 2,5e-10.
  - L'ancien bug valait 77 % sur Phobos et 9,2 % sur la Lune.
  - Les constantes sont conformes à pck00010.
- **Géodésie (8b6562c).**
  - `cartToGeodetic` est sub-millimétrique face à un solveur indépendant (Eberly), des pôles à la distance lunaire.
  - `radiusAtHeight` est à moins de 3 mm.
  - `figureSourceElevation` est à 0,15 mrad ou moins.
  - Le « 14 µm » de `minimumOrbitHeight` est reproduit (1,42e-5 m), et `orbitClearsHeight` donne 0 erreur sur 3 000 orbites.
  - Seule la Terre est aplatie, par construction.
- **WGSL en espace écrasé :** les directions sont transformées par l'échelle inverse et les normales par la transposée. C'est correct, sans nouveau chemin NaN (hors H2).

**Rendu et démarrage**
- **Jupiter :**
  - les mathématiques de mip LOD sont justes ;
  - les formats de vue sont valides (BC7, ASTC, RGBA8 avec `viewFormats`) ;
  - les error scopes sont bien appariés ;
  - la VRAM réelle *baisse* (42,7 MiB contre 91,6 MiB avant).
- **`AsyncResource` et `CompileQueue` :**
  - leurs sémantiques sont saines ;
  - la persistance du tier est validée (schéma, adaptateur, expiration) ;
  - l'hystérésis évite l'oscillation ;
  - les exports se nettoient correctement.
- **C1 à C7 (premier audit) :** C1, C3, C4, C5 et C6 sont corrigés ; C2 est partiel (M8) ; pour C7, le harnais est corrigé mais les conclusions sont toujours exagérées.

**Trou de ver (ea2590f)**
- Le passage est continu en position (environ un pas) et en vitesse (0,2 à 0,3 %).
- Pas de nouveau miroir, et le repère côté Gargantua est direct.
- Les boucles sont bornées (2 048 pas), sans NaN dans 7 scénarios adverses.
- Les réponses tardives sont écartées par un jeton de génération.

**Divers**
- **Diagnostics :** rien de sensible n'est capturé, aucune clé API.

---

## 6. Évaluation de l'auto-audit `docs/AUDIT-LAST-7-COMMITS-2026-10-06.md`

**Ce n'est pas un audit indépendant.** Il se présente comme une « independent code review », mais il est très probablement écrit par le même modèle : par exemple, il reste des caractères chinois au milieu d'une phrase anglaise en §2.4 (« one上游 re-export »). Il note large : 9,5 pour un commit porteur d'un bug High.

- **Couverture :** 7 commits sur 23. Il ignore les 15 commits perf, ainsi que ea2590f, le plus gros (+1 518 lignes) et celui qui contient M4.
- **Juste :**
  - H1, l'erreur fatale permanente ;
  - la précision de `minimumOrbitHeight` et `orbitClearsHeight` ;
  - plusieurs remarques Low (affectation directe de `hubWarpLimit`, `D.warp` vestigial).
- **Manqué :** H2, M1, M2, M3, M4, M5, M6, M9 (côté téléchargement) et M10.
- **Faux ou exagéré :**
  - « crash ASTC latent corrigé au passage » : aucune carte HD n'était en ASTC avant ;
  - « 8K forcé au niveau ≥ 1,55 » : 1,55 correspond à l'ancienne carte 6K, la 8K était à ≥ 2 ;
  - « remplace la carte 2K de Jupiter » : c'est la JPEG HD 6K qui est remplacée ;
  - « l'e2e exerce une vraie scène d'éclipse » : il exécute les helpers WGSL, il ne rend rien ;
  - justification erronée de la sortie anticipée de `orbitClearsHeight` (la conclusion reste juste) ;
  - « aucun bug de correction », « chaque commit bisectable ».

---

## 7. Plan de correction conseillé

1. **H2** : `a.ab = 1.0;` dans `nearAir`, plus un e2e qui rend Miller ou Mann avec de l'air. **H1** : écouteurs non fatals après la première image, avec autosave.
2. **M4** : réinitialiser `P.universe` quand le plan est vidé (arrivée au trou de ver, fin de dernière poussée). **M5** : restaurer `hubWarpWant` au désengagement et capturer le souhait *avant* `rails()`.
3. **M1** : ne pas appeler `invalidate()` sur une bascule de calibration, seulement réinitialiser les chronos.
4. **M2 et M3** : avant le merge, retirer `test-kimi` de `pages.yml`. Si un `/test/` doit survivre, préfixer les caches et le stockage par base path.
5. **M6** : afficher `minimumOrbitHeight` comme PE, ou signaler l'écart.
6. **M7 et M8** : délais en temps visible, état « personnalisé » de la qualité, `dynOn` restauré hors du mode Jeu.
7. **M9** : réserver le KTX2 8K aux tiers ≥ 2 et le mettre en cache par le SW, ou le passer en LFS.
8. Lancer la suite e2e complète sur kerr-mini, puis nettoyer la racine du dépôt.

---

## 8. Corrections appliquées — 2026-10-06

Toutes les corrections ont été faites sur `test-kimi` : 30 commits, de `e0d5f7a` à `c62115a`. Chacune a un test de régression qui échoue sans le correctif.

| Constat | État | Commit | Ce qui change |
|---|---|---|---|
| **H1** | corrigé | `6541c36` | Une erreur page n'est fatale qu'avant la première image. Après, elle est notée dans le diagnostic et un toast s'affiche une fois par type ; la boucle continue. |
| **H2** | corrigé | `2037b74` | `AirSpec` est toujours construit par son constructeur complet : WGSL refuse d'en compiler un incomplet. Nouvel e2e `near-air` sur GPU pour Miller, Mann et Edmunds. Test qui interdit un `AirSpec` nu. |
| **M1** | corrigé | `9790e01` | Une bascule de calibration remet à zéro les chronos, pas l'image. |
| **M2** | corrigé | `e0d5f7a` | Les caches sont nommés par scope et par build. Un SW ne gère que ses propres dossiers. Les clés de stockage de la preview sont préfixées `test/`. |
| **M3** | corrigé | `9c40427` | Seul `main` conditionne la prod ; une preview en échec est signalée puis écartée. Branche nommée une seule fois. Pas de jeton en écriture là où tourne le code de la branche. |
| **M4** | corrigé | `dd43842` | L'univers du plan suit ses nœuds : il est oublié dès que le plan est vide. |
| **M5** | corrigé | `b3d7b23` | `requestWarp` / `setWarpAuthority` sont explicites. Le souhait est rendu à la levée du plafond. Les plafonds, rails compris, sont combinés quel que soit l'ordre. |
| **M6** | corrigé | `cd727f5` | PE et AP sont les vrais extrêmes géodésiques (`orbitExtreme`), aussi pour l'hyperbolique. Les drapeaux du diagramme et les marqueurs de la trace au sol y sont placés. |
| **M7** | corrigé | `ebc9165` | Les délais sont comptés en temps visible (`util/visible-timeout.ts`). Un succès tardif est accepté. Une compilation bloquée 60 s libère la file. « Entrer maintenant » entre vraiment. |
| **M8** | corrigé | `368b8d4` | En Jeu, le plafond du tier ne touche que les valeurs encore égales au préréglage. La résolution dynamique fonctionne à toute qualité. |
| **M9** | corrigé | `9e048d8` | Le 8K est réservé aux tiers ≥ 2 avec BC7 ou ASTC. Un échec est mémorisé pour la session. Le worker est libéré après 10 s d'inactivité. Le KTX2 était en fait déjà mis en cache par le SW. |
| **M10** | corrigé | `8bb90c9` | Une erreur répétée est comptée au lieu d'être recopiée ; les écritures sont regroupées (au plus 1 par seconde, plus un vidage quand la page passe en arrière-plan). |
| **M11** | corrigé | `b72bcad` | Même sonde injectée des deux côtés, passes alternées A B B A, médianes et étendues. Les docs disent ce que les données montrent. |

**Corrections Low.** Toutes appliquées, sauf la dernière :
- **Démarrage et qualité :**
  - la qualité retombe sur des pas fixes en cas d'échec du noyau qualité (`0828c0d`) ;
  - le tier est gelé pendant un Kerr Bench (`2e47672`) ;
  - le préchargement respecte Save-Data (`6a3a377`) ;
  - le LUT qualité compile dès l'arrivée du noyau (`31823f0`) ;
  - les commentaires sont à jour (`76c7806`).
- **Géodésie et atmosphère :**
  - plus de NaN au centre du corps (`0831352`) ;
  - hauteur exacte près de l'axe polaire (`f6502d3`) ;
  - l'aplatissement est celui du corps lui-même (`f6b24fa`) ;
  - éclipse lunaire limitée à l'air terrestre (`867551f`) ;
  - `cloudVolume` sorti de boucle (`d135d8d`).
- **Vol et trou de ver :**
  - azimut de lancement en latitude géocentrique (`5a421f4`) ;
  - worker de prédiction : un job à la fois, messages traduits (`c63ac91`) ;
  - le pilote est prévenu des plans abandonnés (`813e104`).
- **Performance du passage du trou de ver** (`d1e1638`, fausse position) :

  | Cas | Avant | Après |
  |---|---|---|
  | Passage Dneg | 10,1 ms | 0,83 ms |
  | Passage Kerr | 4,8 ms | 0,20 ms |
  | Pas Kerr loin de l'embouchure | jusqu'à 3× le pas Kerr seul | environ 1,3 à 1,4× |
- **Hygiène :** l'audit Kimi est déplacé dans `docs/`, les captures racine ne sont plus suivies, `meta.json` est ignoré (`b4d6180`).
- **Laissé en l'état, documenté :** sur les tiers ≤ 1, le sol de collision suit le relief « med ». Donner le relief haute résolution à la physique coûterait 64 MiB de mémoire CPU sur les appareils les plus faibles.

**Constats découverts pendant la correction :**
- **Trois goldens e2e étaient cassés par la branche Kimi**, qui n'avait jamais lancé l'e2e. Bissection :
  - `moon-takeoff` vient de `c78718c` (taux IAU de la Lune) ;
  - `entry-glide-edwards` vient de `8b6562c` (guidage WGS84) ;
  - `wormhole-coast` vient de `ea2590f` (libellé hors du cylindre).

  Ces trois changements sont voulus. Seules ces trois entrées ont été réenregistrées (`c62115a`) ; les correctifs de l'audit laissent les huit vols identiques au bit près.
- **`assist-descent` était instable**, y compris sur la branche Kimi : le test lisait le DOM avant le redessin du HUD. Il attend maintenant le DOM (`4829e44`), 5 passages sur 5.

**Ce qui reste à faire hors de cette branche :**
- Tant que `main` n'a pas ce workflow, son déploiement efface encore `/test/`.
- L'ancien SW racine gère encore mal `/test/` jusqu'au merge.
- Le KTX2 de 32 MB et les captures restent dans l'historique git ; ni LFS ni réécriture d'historique n'ont été faits.
- Les valeurs effectives de qualité ne sont pas affichées à côté des curseurs.
- Le bouton « Entrer maintenant » n'a pas de test automatisé.

**Vérification finale (HEAD après corrections) :**
- `bun test` : 435 pass, 0 fail.
- `bun run check` : Biome 0 erreur, tsc propre, 9/9 WGSL sous Metal.
- **E2E complet en local : 106 pass, 0 fail**, en 13 min. kerr-mini était injoignable, d'où un passage sur cette machine.
