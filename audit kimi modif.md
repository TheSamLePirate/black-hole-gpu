# Audit des modifications Kimi — démarrage WebGPU et qualité adaptative

**Mise à jour après corrections, 5 octobre 2026 : C1 à C7 traités et couverts par des tests de régression. Note réévaluée : 9,1/10.** Les conclusions à 6/10 ci-dessous sont l'audit historique du code avant correction. Le détail actuel figure dans la section « Correctifs appliqués et validation » en fin de document.

Date : **5 octobre 2026**. Branche auditée : **`test-kimi`**, commit final **`64b8833cf4e3dd5eb0283382a517961ba0f2b33b`**. Le code applicatif a été analysé et testé à **`660b18d98a9beb86f7a1df02b9001548d5b16854`** ; le dernier commit, ajouté pendant l'audit, ne change que le script et le bilan A/B, également examinés.

La demande mentionne `kimi-test`, mais cette branche n'existe pas parmi les références locales et distantes disponibles. `test-kimi` est la branche courante et contient le travail concerné. Comparaison avec `main`, commit et base commune **`6d1fd34d1d3658a7e767323cd0a6782527c585e9`** : 15 commits, 23 fichiers modifiés ou ajoutés. Références Git présentes au moment de l'audit ; aucun fetch ni changement de branche.

Périmètre principal : `src/renderer.ts`, `src/main.ts`, `src/tier.ts`, `src/ui/splash.ts`, exposition des modules de shaders, nouveaux tests, `scripts/ab-pages.ts` et bilans dans `docs/ANALYSE-CHARGEMENT-GPU.md` et `docs/perf/ab-pages-2026-10-05.md`. Le déploiement et les autres documents sont traités seulement en complément. Aucun correctif applicatif n'a été effectué pendant cet audit.

## Verdict et note

**Note globale : 6/10.** Le travail améliore utilement l'organisation du démarrage et le chemin normal fonctionne. En revanche, la gestion des échecs de compilation et la politique de qualité présentent des régressions concrètes. **Je déconseille une fusion en l'état avant correction de C1 à C5**, puis vérification de la précision sur les tiers faibles.

| Axe | Poids | Note | Appréciation |
| --- | ---: | ---: | --- |
| Démarrage WebGPU | 30 % | 7,5/10 | Réutilisation des modules, parallélisation et préchargement pertinents ; état d'échec incomplet et compilation optionnelle lancée immédiatement. |
| Adaptation de la qualité | 40 % | 4,5/10 | Bonne intention, mais plafonds imposés aux modes manuels, promotion liée aux pixels et politique Terre contradictoire. |
| Tests et preuve des gains | 20 % | 5,5/10 | Tests existants verts ; nouveaux tests trop limités pour les changements de comportement et les affirmations de performance. |
| Lisibilité et traçabilité | 10 % | 8/10 | Commits ciblés et documentation abondante ; plusieurs descriptions dépassent ce que le code et les mesures établissent. |

Calcul pondéré : 5,95/10, arrondi à 6/10. Il s'agit d'une appréciation technique, pas d'une mesure de vitesse ni d'une certification sur toutes les plateformes.

## Vérifications réalisées

Environnement : macOS arm64, Chrome headless et GPU WebGPU Apple, architecture `metal-3`, champ `device` vide, `timestamp-query` disponible. Bun **1.3.14**, TypeScript **5.9.3**, Biome **2.5.15**. Le niveau initial observé est 2, avec un cap de 2,2 Mpx.

| Vérification | Résultat |
| --- | --- |
| `bun test` | **354 pass, 135 skip, 0 fail**, 34 349 assertions, 97 fichiers. Les E2E sont désactivés dans cette commande. |
| `bun run typecheck` | Réussi. |
| `bun scripts/check-wgsl.ts` | **9/9 shaders compilent** sur l'adapter Apple. |
| `bun run build` | Réussi, bundle applicatif et workers générés. |
| Biome sur les 13 fichiers TypeScript modifiés/ajoutés de la branche | Réussi. |
| `bun run check` au commit final `64b8833` | Réussi : Biome, TypeScript et 9/9 shaders. 52 warnings et 13 infos Biome, aucune erreur. |
| `git diff --check` | Réussi. |
| E2E `reload` | **1 pass, 0 fail**. |
| E2E `title` + `smoke` | **20 pass, 0 fail**, 55 assertions. |
| Probes ciblées | Plafonds manuels, arrêt à 16 spp, ordre d'éviction, politique Terre et échec optionnel reproduits via les méthodes réelles du renderer dans Chrome. |
| Bilan A/B ajouté pendant l'audit | Script lu et quatre JSON bruts locaux examinés ; campagne distante non relancée par cet audit. |

Au début, `bun run check` échouait à l'étape Biome sur **`scripts/ab-pages.ts`**, alors non suivi. Le commit `64b8833`, arrivé pendant l'audit, l'a formaté et ajouté à la branche. **La commande complète repasse au commit final**, avec 52 warnings et 13 infos Biome, aucune erreur, puis TypeScript et 9/9 shaders validés. Ce fichier n'a pas été modifié par l'auditeur.

Limites : pas de passage Safari, Firefox, Windows/D3D12, Android ou iPad ; pas de validation visuelle exhaustive des plafonds d'intégration ; pas de nouvelle campagne A/B contrôlée exécutée par cet audit. Les mesures A/B présentes dans le dépôt sont analysées plus bas. Les probes avec tier forcé vérifient le comportement du code, pas les performances physiques d'un véritable GPU faible.

## Erreurs et régressions

Priorités : **P1** = blocage fonctionnel à corriger avant fusion ; **P2** = régression ou comportement incorrect significatif ; **P3** = amélioration non bloquante.

### C1 — P1 : un échec de LUT désactive aussi la qualité et peut bloquer un export indéfiniment

**Localisation : `src/renderer.ts:692`, `:1079`, `:3664`, `:3952` ; attente des exports dans `src/automation.ts:108`.**

Les trois pipelines optionnels sont publiés dans un unique callback de `Promise.all`. Si une seule compilation échoue, **aucun des trois champs n'est affecté**, même si les autres compilations réussissent. Par exemple, un échec de `lutq` laisse aussi `qualityPipeline` et `lutPipeline` à `null`.

Le code ne distingue ensuite pas « compilation en cours » et « compilation définitivement échouée ». La vue immobile reste sur le chemin realtime ; `offlineFrame()` retourne avant tout travail tant que `qualityPipeline` est nul. Les boucles de rendu/export attendent `done`, sans état terminal d'échec.

**Reproduction effectuée :** interception de `GPUDevice.createComputePipelineAsync` avant navigation et rejet uniquement de `entryPoint === "lut" && QUALITY_PIPELINE === 1`. Le renderer réel démarre ; résultat observé :

```json
{
  "realtimeReady": true,
  "qualityReady": false,
  "lutReady": false,
  "gpuErrors": 0,
  "offlineAfter2s": { "progress": 0, "spp": 0, "done": false }
}
```

Il s'agit d'une injection de panne, pas d'une panne spontanée du GPU de cette machine. Le chemin de panne ainsi exercé ne possède cependant aucune transition permettant de sortir de l'attente. L'erreur est seulement écrite dans la console ; l'export reste à 0 % jusqu'à annulation ou rechargement.

**Correction :** publier indépendamment chaque pipeline réussi ; suivre explicitement les états `pending/ready/failed` ; prévenir l'interface et terminer un export avec une erreur exploitable lorsqu'il ne peut pas continuer. Un échec de LUT doit pouvoir laisser fonctionner la qualité sans LUT. Ne pas imposer l'attente du pipeline adaptatif aux rendus qui peuvent utiliser le kernel non adaptatif.

### C2 — P2 : les plafonds automatiques écrasent également les choix de qualité manuels

**Localisation : `src/renderer.ts:3661`, `:3685`, `:3686`, `:3720`.**

Les plafonds de steps, d'epsilon, de samples et de bruit dépendent uniquement du tier. Ils s'appliquent même avec `dynamicResolution = false` et un subsampling fixe. Choisir Ultra ou régler manuellement une précision supérieure ne permet donc pas de retrouver cette précision sur les tiers 0 à 2.

**Reproduction effectuée :** appel de `frame()` sur une instance dérivée du renderer réel, tier 1, résolution dynamique désactivée, subsampling fixé à 1. L'écriture des paramètres a été interceptée avant dispatch :

| Paramètre | Demandé | Effectivement utilisé |
| --- | ---: | ---: |
| Steps realtime | 1 000 | **250** |
| Epsilon realtime | 0,05 | **0,14** |
| Objectif immobile | 256 spp | **`converged` à 16 spp** |

L'interception vérifie les paramètres et la machine d'état ; elle ne constitue pas une comparaison d'images. Le constat contredit néanmoins le bilan §8 qui affirme qu'« un réglage plus fin du joueur est toujours respecté ». Les réglages affichés ne représentent plus forcément la qualité effective. Le HUD utilise encore `settings.targetSpp` pendant la convergence, puis annonce la convergence complète au plafond réduit.

**Correction :** appliquer ces limites dans un mode de qualité automatique explicitement choisi, préserver les modes manuels et photo, et exposer les valeurs effectives. Si des plafonds universels sont un choix produit volontaire, les présenter comme tels et fournir un moyen explicite de demander la qualité supérieure.

### C3 — P2 : la promotion reste liée au cap de pixels alors que le tier limite désormais la précision

**Localisation : `src/main.ts:2144–2149`, `src/renderer.ts:3607–3614`.**

La promotion exige que `cappedRatio(...)` réduise effectivement le ratio demandé. Cette condition était cohérente pour augmenter un budget de pixels. Elle devient insuffisante lorsque le même tier impose aussi des limites aux steps, à l'epsilon, aux samples et aux textures.

**Cas déterministe :** à 1 920 × 1 080, ratio 1, un tier 2 autorise 2,2 Mpx, au-dessus des 2,0736 Mpx demandés. `capped` vaut faux. Même avec un GPU très rapide, une échelle 1, un bloc 1 et beaucoup de marge pendant des minutes, **aucune promotion ne peut se produire**. Le renderer reste limité à 350 steps et epsilon 0,10. Même problème en petite fenêtre pour un tier faible, avec en plus le plafond de convergence à 16 spp.

Le sous-classement est donc durable dans ces conditions, et une valeur faible persistée peut le prolonger au rechargement. L'élargissement `block <= 4` ne résout pas ce blocage.

**Correction :** dissocier le budget de pixels du niveau de précision, ou autoriser une promotion lorsque les plafonds de précision sont actifs et que la marge mesurée le justifie. Tester explicitement les petites fenêtres et le 1080p à ratio 1.

### C4 — P2 : le suivi d'un vaisseau contourne le plafond des textures Terre

**Localisation : `src/renderer.ts:1962–1968`.**

Le choix caméra plafonne la Terre à `med` pour les tiers 0 et 1. Juste après, `shipFocus` réimpose `high` lorsqu'un vaisseau se trouve à moins de 2 000 km. Le dernier plafond vérifié, `earthCap`, est celui du repli après manque de mémoire ; ce n'est pas le plafond du tier matériel.

**Reproduction ciblée :** tier 1, `earthCap = "high"`, `shipFocus = { body: "earth", altKm: 400 }` ; `writeParams()` demande **`high`**, malgré le tier faible. La méthode réelle a été exercée, avec interception de la demande de textures pour éviter un téléchargement supplémentaire.

Cela invalide l'affirmation « cube Terre `high` non téléchargé sur tier ≤ 1 ». Le cas compte notamment pour le mode spectateur : la boucle renseigne `shipFocus` quand `camera.spectating` est vrai (`src/main.ts:2055`).

**Correction :** arbitrer d'abord les besoins caméra et vaisseau, puis appliquer le plafond matériel final sur le chemin live. Si le relief nécessaire à la physique du vaisseau doit rester précis, séparer ce besoin des textures de couleur et documenter cette exception.

### C5 — P2 : le plafond Terre s'applique aussi aux rendus offline, contrairement au commentaire

**Localisation : `src/renderer.ts:1944–1962`, appel depuis `offlineFrame()` à `:3972`.**

Le commentaire promet « the live view only — exports keep their choice ». La condition réelle est seulement `!o.probe` ; elle ne vérifie ni `t === this.live` ni le contexte offline. Or `offlineFrame()` appelle aussi `writeParams()` sans `probe`.

Sur tier 0 ou 1, un export proche de la Terre sans `shipFocus` reste donc plafonné à `med`, même si sa résolution justifie `high`. Le nombre de samples et l'intégrateur offline utilisent bien leurs options propres ; c'est le choix des cartes Terre qui demeure influencé par le tier.

**Reproduction effectuée :** scène « Earth: low orbit over the Amazon », temps réel de la scène, tier 1, appel de la méthode réelle sur une cible live puis une cible distincte de 2 048 × 2 048, demandes réseau interceptées. Résultat : **live sans shipFocus = `med` ; live avec vaisseau suivi à 400 km = `high` ; cible offline sans shipFocus = `med`**. La cible offline était distincte de `this.live`, ce qui vérifie l'absence du garde de contexte annoncé.

**Correction :** définir explicitement la politique des textures par contexte live/offline et appliquer le plafond automatique au live. Un export peut demander des textures supérieures avec le mécanisme existant de repli mémoire. Tester cette politique avec et sans vaisseau suivi, car C4 peut masquer C5.

### C6 — P2 : le cache décrit comme LRU est en réalité FIFO

**Localisation : `src/renderer.ts:2452–2456`, `:2509–2511`.**

Lire une variante dans une `Map` ne change pas son ordre d'insertion. Aucun accès ne la replace en fin de map. L'éviction supprime donc la variante créée la plus tôt, même si elle vient de servir.

**Reproduction effectuée :** invocation de la méthode réelle `traceVariant`, compilations remplacées par des promesses résolues, séquence A → B → A → C, clés `128 → 129 → 128 → 130`.

```text
Cache observé : B, C  (129, 130)
Cache LRU attendu : A, C  (128, 130)
```

Revenir à A relance une cascade au lieu de réutiliser la variante récemment employée. De plus, une entrée évincée pendant sa compilation continue sa cascade via la closure `slot` : limiter la map à deux clés ne limite pas à deux le nombre de cascades encore actives.

**Correction :** actualiser la récence à l'accès ; avant chaque compilation suivante, vérifier que l'entrée est encore utile ; dédupliquer les compilations en cours et borner leur concurrence. L'API ne fournit pas d'annulation de pipeline promise : éviter surtout de lancer les étapes devenues inutiles.

### C7 — P2 : les « FPS en vol » du nouveau harnais A/B mesurent les callbacks du navigateur

**Localisation : `scripts/ab-pages.ts:111–114`, `:120–128`, `docs/perf/ab-pages-2026-10-05.md`.**

Le script compte ses propres callbacks `requestAnimationFrame` pendant trois secondes. Il ne compte ni les images encodées, ni les soumissions terminées du renderer. Or `Renderer.frame()` peut retourner `null` lorsque deux images sont en vol ; la boucle du navigateur continue alors à tourner. Un compteur rAF peut afficher 60 même si moins d'images nouvelles sont produites.

Le bilan affirme « En vol, rien ne change », « 60 i/s » et « Le plan n'a rien coûté au rendu ». Les mesures ne suffisent pas à établir ces conclusions. Les JSON consultés contiennent des `gpuFrameMs` ponctuels d'environ 10,6 à 25,6 ms, mais aucun débit de frames réellement rendues ni distribution de temps GPU.

De plus, le harnais ne sauvegarde que les **réglages demandés**, pas les steps/epsilon effectivement appliqués. En tier 2, B est plafonné à **350 steps / epsilon 0,10**, alors que les deux rapports affichent **500 / 0,08**. La comparaison n'est donc pas à précision d'intégration égale. Des captures proches sur cette mission ne valident pas les scènes Kerr difficiles ni les tiers 0/1.

**Correction :** compter les frames rendues/terminées sur une durée mesurée, enregistrer les paramètres effectifs, le block, la résolution réelle et leur évolution ; publier médiane/p95 des coûts ; distinguer mesure de performance à qualité égale et mesure du mode automatique. Corriger aussi le log `${data.fps}` qui affiche une propriété absente, même si le JSON final utilise correctement la variable `fps`.

## Améliorations prioritaires du démarrage

### A1 — Les pipelines optionnels sont moins attendus, mais pas réellement différés

`src/renderer.ts:692` appelle immédiatement `mkLut(false)`, `mkLut(true)` et `mkTrace(true)` en construisant `Promise.all`. Dans la probe instrumentée, les cinq demandes générales `main/rt`, `env`, `lut`, `lutq`, `main/q` partent en **environ 2,2 ms**, avant la première image.

Séparer les promesses attendues est utile, mais ne garantit aucune priorité de compilation au cœur realtime. Sur un appareil lent, les compilations optionnelles peuvent encore concurrencer le travail indispensable. Il faut mesurer ce point, pas affirmer que le compilateur n'a plus que deux travaux à effectuer.

**Proposition :** déclencher les compilations optionnelles après la disponibilité du cœur ou après la première image ; limiter la concurrence ; compiler la qualité lorsque la vue immobile ou un export la demande. Comparer ces stratégies par adapter : aucune amélioration chiffrée supplémentaire n'est démontrée ici.

### A2 — La première image attend aussi les 18 pipelines display/post

`Renderer.create()` attend `Promise.all([r.tracerCore, r.auxCompiled])` ; `auxCompiled` contient 18 pipelines, dont les deux formats d'export. Dire que la première image « n'attend plus que 2 compilations de pipelines » (`docs/ANALYSE-CHARGEMENT-GPU.md:642`) n'est donc exact que pour **le sous-ensemble traceur général**.

**Proposition :** conserver l'async display/post, mais séparer les pipelines strictement nécessaires au premier affichage de ceux des exports et des effets désactivés. Préserver une garantie explicite de disponibilité avant chaque premier usage.

### A3 — Le constructeur contient encore de nombreuses créations synchrones

Les renderers ship/endurance/station, le sky builder et l'overlay sont toujours construits au démarrage et utilisent les variantes synchrones de création des pipelines. Le fait que les modèles ne soient dessinés qu'après téléchargement n'annule pas le coût de ces appels dans le constructeur.

La documentation §8 déclare « constructeur non bloquant » et affirme qu'une conversion async des vessels n'apporterait rien à la première image. Ces conclusions demandent un profilage du constructeur et du compilateur sur les appareils ciblés. La [référence officielle WebGPU sur les pipelines async](https://gpuweb.github.io/types/interfaces/GPUDevice.html#createcomputepipelineasync) recommande ces API pour éviter les blocages liés à la compilation ; elle ne garantit pas une priorité automatique entre les demandes.

**Proposition :** instrumenter les durées et les long tasks, puis décider du passage async ou du chargement différé avec un état `ready` couvrant modèles **et** pipelines. Le report de cette conversion peut rester raisonnable, mais son absence de gain n'est pas établie.

### A4 — Libérer et rendre récupérable le préchargement du ciel

`skyPrefetch` (`src/renderer.ts:156–174`) conserve les trois promesses et leurs ArrayBuffers pour toute la durée du module, environ **7 Mio d'assets source** dans ce dépôt. Une promesse rejetée reste également mémorisée : un appel ultérieur ne retente pas le téléchargement.

**Proposition P3 :** retirer les buffers après consommation, évincer les échecs et permettre une nouvelle tentative. L'idempotence pendant le téléchargement doit être conservée. Cette amélioration réduit la rétention CPU ; aucun épuisement mémoire n'a été observé ici.

### A5 — Le bouton « entrer » ne contourne toujours pas la compilation

L'ajout mémorise la demande et la réalise dès `firstImage()`, ce qui est plus clair que l'ancien bouton inaccessible avant l'image. Il ne débloque cependant pas une compilation qui ne termine jamais. C'est une amélioration du parcours utilisateur, **pas un gain de temps de compilation**.

**Proposition P3 :** adapter le libellé avant première image et présenter une issue d'erreur/rechargement lorsque l'attente devient anormale. Ne pas masquer l'écran tant que l'application n'est pas prête.

## Améliorations de la mesure et de l'adaptation

### A6 — Le tier persistant doit être fondé sur des mesures stables et contextualisées

Le nouveau mécanisme mémorise un niveau issu du gouverneur de la scène courante. Il ne réalise pas la calibration de débit de rayons proposée dans le plan. `gpuEma` utilise `lastGpuMs`, qui provient de `queue.onSubmittedWorkDone()` ; les timestamps servent notamment à prédire le coût du traceur dans `adaptBlock`, mais le signal global du tier reste un temps wall-clock.

Le choix peut donc dépendre de la scène, du budget demandé, de la charge machine et des compilations en cours. Les conditions de changement de tier ne vérifient pas `variantReady`, contrairement à ce qui serait souhaitable pour une mesure stabilisée. `scaleMs` garde également des mesures indexées seulement par échelle ; elles ne sont pas vidées après changement de tier, bien que la précision du kernel puisse alors changer.

**Propositions :** attendre la variante et les ressources utiles ; utiliser des mesures fraîches sur une fenêtre stable ; exclure les transitions ; invalider les historiques de coût quand le tier/précision change ; distinguer la capacité matérielle estimée du budget adapté à une scène. Ce sont des risques de mauvaise classification identifiés par lecture, pas des oscillations mesurées pendant cet audit.

### A7 — L'identité et la durée de vie du tier mémorisé sont trop faibles

`adapterId()` assemble `vendor|architecture|device`. Sur cette machine, cela donne **`apple|metal-3|`**, sans identification du modèle. Ces champs peuvent être vides ou grossiers selon le navigateur : voir la [référence officielle GPUAdapterInfo](https://gpuweb.github.io/types/interfaces/GPUAdapterInfo.html).

Le stockage ne contient ni version de politique, ni date, ni confiance. Une classification ancienne est reprise sans revalidation dédiée. Cela est surtout gênant après modification des plafonds, migration de profil ou changement d'adapter insuffisamment distingué.

**Proposition P3 :** versionner le schéma, ajouter une date et une confiance, considérer le niveau mémorisé comme une hypothèse à revalider, et proposer une remise à zéro. Éviter la persistance pour une identité totalement vide. Ajouter `Number.isFinite` à la validation de la valeur avant indexation des tables.

### A8 — Valider la précision des nouveaux plafonds, pas seulement les FPS

Les tables 150/250/350 steps, epsilon 0,18/0,14/0,10, 16 spp et bruit 0,03 ne sont accompagnées d'aucune validation spécifique de leur qualité visuelle ou de leur erreur physique dans les nouveaux tests.

Le shader reste inchangé, mais **ses paramètres d'intégration changent**. Les tests CPU de physique et la compilation WGSL ne garantissent donc pas la conservation de l'ombre, des anneaux, des étoiles lentillées ou des trajectoires près des scènes difficiles. Le mode `MODE_ORDER` colore déjà les rayons qui atteignent leur limite de steps (`trace.wgsl:5820`) et peut aider à diagnostiquer ce cas.

**Proposition :** captures comparatives et mesure d'erreur pour Kerr extrême, bord du disque, wormhole, surfaces proches et champ stellaire ; compter les rayons qui atteignent la limite ; définir des budgets par famille de scène si une table unique dégrade certains cas.

## Ce que les tests et mesures prouvent réellement

Le nouveau test `reload` mesure **navigation → splash levé** dans le même processus Chrome. Il inclut téléchargement, décodage, compilation, UI et délai du splash. Le deuxième passage profite potentiellement des caches HTTP, mémoire, navigateur et driver. Il ne ferme ni ne relance Chrome, ne neutralise pas le cache HTTP et ne mesure pas séparément les pipelines.

**Mesure obtenue pendant l'audit : 24 732 ms → 11 248 ms**, soit environ **54,5 % de moins**. Le contrôle WGSL tournait en parallèle au début de cette vérification ; ces nombres ne constituent pas un benchmark contrôlé et ne sont pas comparables directement aux 4 399/3 280 ms du document initial.

Ce résultat établit qu'un rechargement a été plus rapide dans cette exécution. Il **n'établit pas à lui seul** un hit du cache disque shader, sa taille, la stabilité de toutes ses clés, ni le gain des modifications par rapport à `main`. La tolérance `cold + 2500` peut laisser passer une régression et le test ne vérifie pas `app.cdp.errors`. Les E2E restent désactivés dans la commande `bun test` du workflow Pages.

**Protocole recommandé :** instrumenter disponibilité device, fin constructeur, cœur, pipelines auxiliaires, première soumission GPU terminée, première image et fin splash ; comparer `main` et la branche sur une même scène/qualité effective ; multiplier les runs et publier médiane/p95 ; ajouter un passage après fermeture et relance complète du navigateur avec profil conservé, puis contrôler les caches réseau pour isoler la compilation. Documenter les états batterie, viewport, ratio et tier.

Les quatre nouveaux tests de `tier.test.ts` valident les helpers et la persistance. Ils n'exercent ni le gouverneur dans `main.ts`, ni les plafonds dans `Renderer.frame()`, ni les transitions de compilation. Les tests existants verts constituent une bonne base, mais ne couvrent pas C1 à C6.

### Complément A/B du commit `64b8833`

Les quatre rapports bruts sous `remote-results/2026-10-05T1714-ab-pages/`, `1742`, `1745` et `1747` correspondent aux durées de première frame publiées dans le document. Ces résultats ont été relus, pas régénérés par cet audit.

| Première frame GPU, médiane de 4 runs | A : main | B : test-kimi |
| --- | ---: | ---: |
| Premier chargement | 26 104 ms | 27 186 ms |
| Rechargement | 1 802 ms | 418 ms |

Les rechargements de B vont de 302 à 562 ms ; ceux de A de 527 à 4 502 ms. **C'est un indice utile d'un démarrage à chaud plus rapide et moins variable dans cette campagne**, et la mesure de première soumission terminée est meilleure que le seul splash. Le premier chargement reste trop variable pour attribuer un gain à la branche.

La conclusion causale reste à modérer : le reload se déroule dans le même processus et ajoute le Service Worker ; le harnais ne vérifie pas explicitement le contrôleur actif, la provenance des ressources ou les hits du cache shader. Il ne permet donc pas d'attribuer la différence au seul passage de cinq à deux pipelines attendus. L'affirmation que les mesures locales « froid 4 399 ms → ~3,3 s » prouvent le gain de B à froid est également incorrecte : le §8 du plan présente ces nombres comme **froid contre reload**, pas comme un A/B des deux versions à froid.

Enfin, le polling de première frame se fait toutes les 250 ms : les nombres proches de 300 à 560 ms ne doivent pas être interprétés avec une précision à la milliseconde. Le gain à chaud est plausible et étayé par ces observations, mais les conclusions sur la performance et la qualité en vol doivent être retirées ou remesurées comme indiqué dans C7.

### Tests à ajouter en priorité

| Scénario | Attendu |
| --- | --- |
| LUT qualité rejetée, pipeline qualité réussi | Qualité utilisable sans LUT ; erreur visible ; export finit ou échoue explicitement. |
| Pipeline qualité en retard puis disponible | Première image realtime correcte ; convergence démarre à disponibilité ; aucune progression fictive. |
| Pipeline qualité définitivement rejeté | État terminal d'erreur exploitable, aucun export en attente infinie. |
| Tier 1, mode manuel/Ultra | Précision demandée conservée selon la politique produit explicite. |
| Tier 2, fenêtre 1080p ratio 1, forte marge GPU | Le plafond de précision peut être relevé même sans cap de pixels actif. |
| Démotion puis récupération, timestamps absents | Hystérésis correcte et repli de mesure vérifié. |
| Terre live tier 1, vaisseau suivi à 400 km | Plafond final cohérent pour les textures ; exception physique éventuelle explicite. |
| Terre offline tier 1, sans vaisseau suivi | Qualité des cartes dictée par l'export avec repli mémoire, pas par le plafond live. |
| Variantes A → B → A → C, puis retour A | A reste en cache ; pas de cascade redondante. |
| Changement de tier pendant une scène lourde | Historiques de coût invalidés et qualité effective cohérente. |

## Notes par modification

| Modification / commit | Note | Décision proposée |
| --- | ---: | --- |
| Cœur realtime séparé — `33625d0` | 7/10 | Conserver, corriger la publication des pipelines et les états d'échec. |
| Modules existants et validation parallèle — `d997ec1` | 8,5/10 | Conserver : évite les modules créés une seconde fois et garde les diagnostics. Aucun gain isolé chiffré ici. |
| Préchargement ciel/éphémérides — `2d7b4bc` | 8/10 | Conserver, ajouter libération et reprise après échec du préfetch. |
| Skip avant première image — `33b5d9f` | 7/10 | Conserver, préciser la promesse UX et tester l'attente longue. |
| Variantes par phase et cache — `fd0c732` | 5/10 | Garder le principe par phase ; corriger FIFO et cascades obsolètes. |
| Démotion/persistance/promotion — `8b6d381` | 5,5/10 | Bonne extension, revoir le déclencheur et la fiabilité du niveau conservé. |
| Plafonds de précision et textures — `8119f4e` | 3,5/10 | Revoir avant fusion : modes manuels, promotion, cartes Terre et preuve visuelle. |
| Display/post async — `3e96fbf` | 8/10 | Conserver, retirer du chemin critique les pipelines non nécessaires après mesure. |
| Test reload — `f31ea4d` | 5/10 | Utile comme smoke de chargement ; compléter le protocole et modérer les conclusions sur le cache disque. |
| Harnais et bilan A/B — `64b8833` | 5,5/10 | Meilleure métrique de démarrage et résultats bruts disponibles ; corriger compteur FPS, qualité effective et interprétation causale. |
| Bilan documentaire — `77f3245` et document d'analyse | 6,5/10 | Corriger LRU, choix manuels, exports, constructeur non bloquant et décompte des pipelines attendus. |

Le découpage en commits est un point fort. Les petites modifications exposant les modules en `readonly`, la traduction du nouveau message et le formatage sont cohérents avec l'objectif. Les documents Unity/libration, les catalogues additionnels et les images Yosemite ne contribuent pas directement à l'amélioration WebGPU : les isoler dans une autre proposition faciliterait la revue et l'historique, sans conclure ici sur leur validité scientifique.

## Complément : déploiement Pages

Ce point reste secondaire par rapport au périmètre demandé, mais le risque est concret : **le workflow de `main` disponible dans ce dépôt est encore l'ancien workflow**. Un push sur `main` utilise celui-ci et publie seulement le site racine, sans `/test/`. La préservation des deux sites promise par les commentaires de la branche ne vaut donc pas pour les déploiements de `main` avant intégration du workflow commun.

Autres points à corriger : les checkouts `ref: main`/`ref: test-kimi` du job `site` peuvent construire des commits plus récents que le commit vérifié ; sérialiser seulement `deploy` ne garantit pas la fraîcheur des artefacts construits en parallèle ; `workflow_dispatch` déclenche maintenant la vérification mais les jobs `site`/`deploy` sont exclus par leur condition `event_name == 'push'`.

Épingler les SHA validés, prévoir la politique de fraîcheur et installer le workflow commun sur `main` si `/test/` doit survivre à ses pushes. La [documentation officielle de concurrence GitHub Actions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency) précise que l'ordre dépend de l'entrée dans la file, pas de la date du dispatch du workflow. Aucun déploiement n'a été lancé pendant cet audit.

## Ordre de correction conseillé

1. Corriger C1 : publication indépendante, états d'échec et terminaison des exports.
2. Corriger C2 et C3 ensemble : séparer qualité automatique, choix manuel et budget de pixels.
3. Corriger C4/C5 : centraliser la décision des textures Terre avec un contexte live/offline explicite.
4. Corriger C6 : véritable LRU et gestion des cascades en cours.
5. Corriger C7 et ajouter les tests de transition, puis mesurer démarrage et précision des tiers faibles sur les plateformes cibles.
6. Mettre le bilan documentaire en accord avec les comportements et mesures obtenus.

**Conclusion :** garder les optimisations de structure du démarrage, mais revoir l'adaptation globale avant fusion. Les gains attendus sont crédibles ; leur ampleur et leur absence de dégradation visuelle restent à établir avec un protocole contrôlé. Les tests normaux verts ne compensent pas le blocage reproductible des exports sur échec optionnel ni les plafonds appliqués sans possibilité de récupération dans plusieurs contextes.


## Correctifs appliqués et validation — 2026-10-05

Correctifs locaux sur `test-kimi`, au-dessus de **64b8833cf4e3dd5eb0283382a517961ba0f2b33b**.
L'historique de l'audit est conservé pour permettre la comparaison avant/après. Aucune fusion,
aucun push et aucun déploiement ne sont inclus dans cette validation.

### Résolution des erreurs C1 à C7

| Point | Résultat actuel | Preuve de régression |
| --- | --- | --- |
| C1 — pipelines optionnels / exports | `AsyncResource` publie chaque résultat indépendamment et expose `idle/pending/ready/failed`. Timeout à 180 s, résultat tardif ignoré. La qualité compile sur demande, les LUT après la première completion et seulement si nécessaires. Une erreur termine le job via `OfflineStatus.error`, désactive les exports UI et interrompt les automatismes/vidéos. L'intégrateur non adaptatif ne dépend pas du pipeline adaptatif. | Tests unitaires : rejet indépendant, timeout, lancement unique, panne synchrone/message vide. Chrome : rejet de LUT adaptative avec PNG réussi ; rejet d'intégrateur avec erreur terminale puis PNG non adaptatif réussi. |
| C2 — qualité manuelle | Une politique pure, `quality-policy.ts`, réserve les plafonds au mode **Jeu + résolution dynamique + subsampling auto**. Les paramètres manuels sont préservés ; bruit désactivé reste désactivé. Le HUD emploie l'objectif spp effectif. La qualité effective est accessible via `renderer.effectiveQuality(settings)`. | Tests des cinq tiers et des trois sorties du mode automatique ; interception du vrai `Renderer.frame()` : 1 000 steps / epsilon 0,05 conservés, convergence manuelle continuant au-delà de 16 spp, objectif automatique de 16 spp correctement publié. |
| C3 — promotion | Promotion possible lorsqu'un plafond de précision ou de textures est actif, même sans plafond de pixels. Garde de stabilité : pas de compilation optionnelle/spécialisée ni de cartes Terre en attente. Chaque completion n'est comptée qu'une fois dans l'EMA. Historiques de blocs, échelles, pics et durées de pression remis à zéro après transitions de ressources et changements de tier ; frames déjà soumises exclues de l'adaptation si la génération de timing a changé. | Cas déterministe 1080p / ratio 1 / tier 2, sans cap de pixels ; exclusion des états instables, manuels, réduits, surchargés et en cooldown. |
| C4/C5 — textures Terre | Arbitrage caméra/vaisseau suivi puis plafond final commun. Plafond de tier uniquement en live automatique. Les exports et modes manuels peuvent demander `high`, avec conservation du repli après manque de mémoire. | Politique pure + vrai `writeParams()` sur vue Terre : vaisseau suivi à 400 km en tier 1 → `med`, cible offline de 2 048² → `high`. |
| C6 — variantes | Les lectures touchent la recency du cache. Deux clés conservées. Une seule compilation spécialisée active ; avant chaque étape, la file vérifie que son slot est encore présent. Une compilation WebGPU déjà lancée garde son slot de file jusqu'à sa résolution, car elle n'est pas annulable. | A → B → A → C conserve A et C via la vraie méthode du renderer ; file sérialisée, tâche obsolète non lancée, reprise après rejet. |
| C7 — mesures | Nombre réel de soumissions GPU terminées, durée réellement écoulée, médiane/p95 des durées de completion de file et compteurs navigateur séparés. Qualité effective, taille tracée, block, états de pipeline et révision ajoutés au rapport. Métrique GPU indisponible explicitement sur ancien code sans télémétrie. Les timeouts/erreurs invalident le run ; profil fermé en `finally`, rapport partiel conservé en cas d'échec. Une nouvelle navigation doit changer `performance.timeOrigin`, pour éviter de mesurer l'ancienne page au reload. | Typecheck du script, protocole exécuté contre deux chargements du même serveur local, rapport JSON valide et absence d'erreurs. Ce contrôle valide le harnais ; il ne compare pas deux versions du produit. |

La première image du splash et du bench est maintenant signalée **après completion GPU**.
Une LUT adaptative manquante désactive également son flag de lecture : le traceur ne consomme
pas une LUT non calculée, même si la LUT realtime a déjà réussi.

### Améliorations complémentaires

- **A2 :** pipeline d'export 8 bits différé au premier PNG/RGBA ; rebinding de la cible et vérification
  de sa validité après attente. `rgba16float` reste initialisé pour le canvas HDR ; **17** pipelines
  display/post sont encore attendus au démarrage.
- **A4 :** buffers préchargés du ciel retirés de la map à consommation ; échecs évincés et tentative
  supplémentaire via le chargeur normal. Plus de rétention permanente des téléchargements réussis.
- **A5 :** le bouton avant image annonce une entrée mise en attente, pas un contournement de shader.
  Après 180 s sans image, il propose de recharger explicitement. Traductions françaises ajoutées.
- **A6/A7 :** niveau persistant traité comme indice initial, versionné et expirant après sept jours.
  Ancien schéma, niveau invalide, timestamp futur et identité entièrement vide ignorés.
  `resetRememberedTier()` permet de supprimer cet indice ; le mock `localStorage` est restauré par
  les tests. L'identité Apple reste grossière : elle ne devient pas un identifiant matériel unique.
- **Exports vidéo :** fermeture de l'encodeur et libération des `VideoFrame` même en cas d'échec ;
  nettoyage du job, restauration du débit temporel et du mode caméra de l'automatisme. Le test
  Chrome vérifie ces sorties après une panne d'intégrateur.
- **Pages :** sérialisation de l'ensemble snapshot/vérification/build/déploiement entre branches ;
  SHA résolus et checkout épinglé, vérification des deux révisions réellement assemblées,
  `workflow_dispatch` autorisé, seul un vrai HTTP 404 traité comme branche de test absente.
  `actionlint` valide la définition. Le workflow commun doit encore parvenir sur `main` pour
  protéger les publications déclenchées depuis cette branche : aucun changement de `main` ici.
- **Documentation :** bilan §8 et rapport A/B corrigés : constructeur encore partiellement synchrone,
  comptage des pipelines complet, absence de preuve d'équivalence visuelle et limites de causalité
  cache disque clairement indiqués. Les anciennes mesures sont conservées comme historique.

### Vérifications après corrections

| Vérification | Résultat |
| --- | --- |
| Suite générale `bun test` | **365 pass, 140 skip, 0 fail** ; les tests E2E sont désactivés dans cette commande. |
| Chrome/WebGPU : startup, reload, smoke, title, golden | **33 pass, 0 fail**, dont les huit vols de référence et les quatre nouveaux cas GPU. |
| Après ajout de la garde de navigation | **5 pass, 0 fail** sur startup + reload. |
| `bun run check` | Biome et TypeScript passent ; **9/9 shaders WGSL compilent sur Apple/Metal**. Les 52 warnings / 13 infos Biome préexistants restent présents. |
| `bun run build` | Build de production réussi, dont workers et Service Worker. |
| TypeScript du harnais A/B | Vérification séparée réussie, car `scripts/` n'est pas inclus dans le tsconfig principal. |
| Workflow Pages | `actionlint v1.7.7` réussi ; aucun workflow distant ni déploiement exécuté. |
| Contrôle local du harnais | Deux profils Chrome sur **le même code local** ; qualité effective et dimensions enregistrées, compteurs GPU distincts du navigateur, aucune erreur console/WebGPU. |
| Intégrité Git | `git diff --check` réussi ; branche inchangée, modifications non commitées. |

Le contrôle local du harnais se relance en définissant `AB_MAIN_URL`, `AB_TEST_URL` et `AB_OUT`.
Rapport brut conservé dans [kimi-corrections-validation-2026-10-05.json](docs/perf/kimi-corrections-validation-2026-10-05.json).
Ses valeurs sont des observations de protocole : caches pilote et charge système non contrôlés.
Les durées de completion de file ne sont pas des timestamps GPU purs ; le champ `gpuFrameMs`
du profiler matériel est enregistré séparément. Aucune accélération de la branche déployée n'est
revendiquée à partir de ce contrôle.

### Note réévaluée et limites du 10/10

| Axe | Poids | Note après corrections |
| --- | ---: | ---: |
| Démarrage WebGPU | 30 % | 8,5/10 |
| Adaptation de la qualité | 40 % | 9,5/10 |
| Tests et preuve des gains | 20 % | 9/10 |
| Lisibilité et traçabilité | 10 % | 9,5/10 |

**Note pondérée : 9,1/10.** Les blocages et contradictions C1 à C7 sont corrigés ; les tests
exercent aussi les chemins de panne et les méthodes réelles du renderer. Le 10/10 demandé reste
un objectif, et ne justifie pas une certification non démontrée.

Pour atteindre un verdict multiplateforme de 10/10, il reste des validations que cette machine
ne fournit pas : démarrage et watchdog sous D3D12/DXC Windows, Intel intégré/SwiftShader,
Safari/WebKit, comparaison visuelle ou angulaire des tiers Game faibles sur scènes près de
l'horizon, anneaux, étoiles ponctuelles et terrain. Les golden flights protègent la simulation,
**pas** l'erreur visuelle des géodésiques de chaque tier. Les plafonds de précision Game ne sont
pas présentés comme conservant une image mathématiquement identique.

Les créations synchrones de pipelines dans les constructeurs de vaisseaux/ciel/utilitaires et
la compilation des 17 passes du chemin live restent des candidats de mesure et de refactor
pour A2/A3. Les retirer aveuglément risquerait d'introduire des ressources manquantes à la première
frame HDR ou au premier dessin d'un vaisseau ; leurs gains ne sont pas inventés dans cette note.

Les choix d'erreur et de cleanup ont été vérifiés contre les références primaires :
[GPUDevice / pipelines asynchrones](https://gpuweb.github.io/types/interfaces/GPUDevice.html),
[WebCodecs / ressources et fermeture d'encodeur](https://w3c.github.io/webcodecs/#dom-videoencoder-close),
[GitHub Actions / concurrence](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency),
[GitHub REST / référence de branche](https://docs.github.com/en/rest/git/refs#get-a-reference).


## Complément demandé : préchargement Terre hors scène — 2026-10-05

Le téléchargement de la Terre **commence désormais dès l'obtention du device WebGPU**, avant
la compilation des shaders, même pour une scène Kerr ne contenant pas la Terre. Le préchargement
porte sur le niveau `med` : six faces couleur/nuages KTX2 si le GPU accepte BC7/ASTC, sinon douze
faces JPEG couleur/nuages, puis six faces de nuit, les océans et le relief. Les requêtes demandent
une priorité basse et alimentent le cache HTTP/Service Worker disponible. Aucun décodage ni
allocation GPU Terre ne sont lancés par ce préchargement ; sa fin n'est pas attendue par le splash.

Les demandes concurrentes sont partagées ; seules des promesses sans corps téléchargé restent
en mémoire. Une requête échouée est retirée pour permettre un nouvel essai. Les cartes `high`
restent demandées selon la vue et la politique de qualité ; les règles de résidence en VRAM et
les plafonds live/offline du correctif précédent restent applicables.

Validation spécifique : **1 test unitaire réussi** pour sélection des formats, déduplication et
reprise après erreur ; **5 tests Chrome/WebGPU réussis** dans `gpu-startup.e2e.test.ts`, dont un
nouveau cas vérifiant, en scène Kerr, les requêtes avant première completion GPU, l'absence de
Terre dans la scène et l'absence de textures Terre résidentes. Ce test s'ajoute aux vérifications
historiques présentées plus haut. Le nombre de requêtes est 14 en chemin compressé et 20 en JPEG.

Après ce complément : **366 tests unitaires réussis, 141 ignorés, aucun échec** ;
**34 tests Chrome réussis** sur démarrage, rechargement, smoke, titre et golden flights.
Le nouveau test contrôle également la réussite HTTP des téléchargements. Build de production,
vérification TypeScript/Biome et compilation des neuf shaders WGSL validés localement.
