# Audit 2026-11-10 — 02. Rendu, pipeline et performance GPU

**Périmètre** : `src/renderer.ts` (11 504 l.), `src/shaders/*.wgsl` (`trace.wgsl` 16 608 l.), modules GPU de `src/system`,
`src/sea`, `ship.ts`, `character-renderer.ts`, `gpuprof.ts`, gouverneurs de `main.ts`, compilation et caches.
**État lu** : `main` à `29d4e5e3`, arbre de travail du 10 novembre 2026 (les numéros de ligne sont ceux de cet arbre).
**Méthode** : lecture seule. Rien n'a été lancé en jeu : ni serveur, ni e2e, ni benchmark. Deux commandes statiques ont
tourné : `bun scripts/pipeline-inventory.ts --check` (passe) et `bun test tests/kernel-budget.test.ts` (61 réussis, 0 échec).

**Niveaux de preuve** utilisés dans chaque constat :

- **lu** : lu dans le code actuel, ligne citée ;
- **mesuré (source)** : chiffre repris d'une fiche du dépôt, avec sa date ; je ne l'ai pas remesuré ;
- **calculé** : arithmétique sur des tailles lues, sans mesure ;
- **supposé** : hypothèse à confirmer en jeu.

---

## 1. Résumé

1. **La destination §7 n'a pas commencé côté code.** Il n'y a ni forward raster, ni surface finale commune, ni description
   de frame. Le « raster » terrestre est une passe de visibilité suivie d'un ombrage différé en compute dans `trace.wgsl`.
   Depuis la décision du 3 novembre, `trace.wgsl` a grossi de 1 787 lignes et `renderer.ts` de 1 200.
2. **En vol terrestre, aucun gouverneur n'agit sur le poste qui coûte.** Le taux de shading ne touche pas `shadeLite`,
   l'échelle est figée à 75 %, le bloc ne règle que le ciel. Les vues chargées restent à 50–65 ms sur kerr-mini.
3. **La compilation reste un risque joueur** : 203 s à froid près de Jupiter, sans anticipation ; ≈ 55 pipelines
   synchrones au démarrage, jamais chronométrés ; aucun cache persistant propre à l'application.
4. **Les encodages provisoires se sont installés** : marqueurs dans la variance (`moments.x`), code de surface dans
   l'alpha de la cible de distance, offsets de `Params` écrits à la main. 62 appels de `trace.wgsl` lisent la cible de
   visibilité.
5. **La doc `GRAPHICS-PIPELINE.md` est vraie sur la structure**, en retard sur les lignes et sur toutes les mesures.

---

## 2. Écart avec la destination §7 (question 1)

### GP-01 — P0 — L'opaque terrestre n'est pas un forward raster ; J1 n'a pas commencé

- **Où** : `src/renderer.ts:6328` (visibilité), `:6555-6594` (`encodeLite`), `src/shaders/trace.wgsl:15198` (`shadeLite`),
  `src/system/terrain-raster.ts:15` (`TERRAIN_RASTER_FORMAT = "rgba32float"`). Aucun dossier `src/render-v2`.
- **Constat** : le sol est rastérisé dans une cible de **distance** `rgba32float` (pas de couleur). Puis un noyau compute
  de `trace.wgsl` ombre chaque pixel en relisant cette cible, les tuiles, le décor et les tables globales. C'est un
  différé en compute, logé dans le fichier du traceur. Les matériaux, l'identité et le mouvement ne sont pas des sorties.
- **Dérive mesurée** : `trace.wgsl` 11 721 lignes le 27/10, 14 821 le 3/11, 16 069 le 5/11, 16 608 aujourd'hui.
  `renderer.ts` : 9 023, 10 304, 11 097, 11 504. Le journal `progress-to-destination.md` ne cite J0/J1 que deux fois, et
  aucun lot de fondation ou de bascule depuis le 5/11 (dernières entrées : nuit, aurores, scène Jupiter).
- **Impact** : chaque lot de qualité ajoute un lecteur à migrer. Le coût de la bascule monte chaque jour.
- **Piste** : geler les ajouts dans `shadeLite` hors correctifs ; ouvrir J1 sur un domaine pilote (GP-A5 plus bas).
- **Preuve** : lu ; tailles mesurées par `git show <commit>:fichier | wc -l` (114945ed, 7a1f668c, 34ae5d3d).

### GP-02 — P1 — Deux opaques complets pour le même domaine : traceur et raster

- **Où** : `src/renderer.ts:11003` (`earthPipelineNow`), `:6515-6547` (`shade`), `:6261-6263`, `main.ts:8962-9004` (bascule
  automatique raster → tracé), `docs/GRAPHICS-PIPELINE.md` §5.1.
- **Constat** : la Terre proche existe en trois ombrages : `main` (tracé), `shade` (noyau « des restes » : ponts, arbres
  proches, marges de boîtes, 26 000 lignes inlinées) et `shadeLite` (matériau). Les autres mondes ont `bodyLite` et
  `bodyLiteAir`. Le mode photo, la marche, la polarisation et l'offline repassent au traceur.
- **Impact** : toute correction de lumière ou de matériau se fait jusqu'à trois fois. Le défaut « nappe sombre à Big Sur »
  n'existe que côté tracé (`docs/PROBLEMES-A-REGLER.md`). `shade` pèse un noyau entier pour quelques pixels.
- **Piste** : donner aux ponts et aux arbres proches une vraie géométrie rastérisée, puis retirer `shade`/`shadeMark`.
- **Preuve** : lu ; taille de `shade` mesurée (GRAPHICS-PIPELINE §5.3, 6/11).

### GP-03 — P1 — Pas de surface finale commune : quatre profondeurs, pas d'identité, pas de mouvement

- **Où** : `src/renderer.ts:2859` (`sceneDepth`, buffer f32 reconstruit par `occlusion`, `post.wgsl:930`),
  `terrain-raster.ts:390/556` (depth32float propre), `ship.ts:2675` (profondeur MSAA propre),
  `character-renderer.ts:817` (profondeur propre) ; `post.wgsl:655` (`reprojDir`).
- **Constat** : il n'existe pas de profondeur opaque partagée. `sceneDepth` est rebâti après coup depuis `moments.y` et
  les nuages. L'identité se limite à l'index d'un arbre (canal g). Il n'y a aucun vecteur de mouvement : la reprojection
  est analytique (caméra + corps rigide). La désocclusion se fait par le seul clamp de voisinage : aucune recherche de
  profondeur ou d'identité précédente dans `post.wgsl` (grep « disocc », « prevDepth » : deux commentaires, aucun test).
- **Impact** : les objets mobiles restent hors historique ; le rejet local de T4 n'est pas fait ; traînées et flou à la
  découverte ne peuvent pas être réglés proprement (§7.10 points 3 à 6).
- **Piste** : première brique de J1 : profondeur finale + identité/génération + pose précédente, lues par le temporel.
- **Preuve** : lu.

### GP-04 — P1 — Marqueurs sémantiques dans la variance et dans l'alpha ; C0-2 non appliqué

- **Où** : `trace.wgsl:8373` (`RASTER_MARK = 1e30`), `:14548-14549`, `:14593` (`RASTER_STALE = -3.0`), `:15219` (masque du
  cockpit : `moments.x` entre −1,5 et −0,5), `:14714` (−3,5 à −2,5) ; 14 tests de ces valeurs dans `post.wgsl` ;
  cible de distance : `a = code·2¹⁸ + normale` (GRAPHICS-PIPELINE §3 C6b).
- **Constat** : `moments.x` porte, selon sa valeur, une variance, une marque raster (avec albédo et eau multipliés
  dedans), une marque « périmé » ou le masque du cockpit. Le contrat C0-2 prévoyait `rgba32uint` typé ; la cible est
  restée `rgba32float` (écart noté au §0.2 du plan, jamais entériné). 62 appels de `trace.wgsl` lisent cette cible.
- **Impact** : c'est exactement ce que §7.4 demande d'éviter. Chaque nouveau lecteur doit connaître les valeurs magiques
  d'un autre noyau. Une erreur de seuil donne une image fausse sans erreur GPU.
- **Piste** : un mot `u32` de drapeaux par pixel (ou la cible `rgba32uint` de C0-2), des accesseurs uniques côté WGSL.
- **Preuve** : lu (grep, 62 occurrences des fonctions `terrainRaster*`).

### GP-05 — P2 — Un seul buffer de tables et un seul groupe 0 pour tous les noyaux

- **Où** : `src/renderer.ts:1772` (`bodyBuf`, `TABLE_VEC4S × 16`), `src/gpu-tables.ts:29-120` (29 tables),
  `renderer.ts:1367-1467` (`traceLayout`).
- **Constat** : bodies, SH, terrain, Soleil, ciel, nuages, géoïde, ortho, anneaux, vent, horizons, eau, rivage, réfraction…
  vivent dans un même buffer de stockage, lié à chaque noyau. C'est le « grand tableau partagé » que §7.2 veut quitter.
- **Impact** : aucun noyau ne déclare ce qu'il lit. Un bâtiment qui arrive touche le même bind group que Kerr.
- **Piste** : à traiter avec J1 (groupes frame / lumière / monde / objets), pas avant.
- **Preuve** : lu.

---

## 3. Gouverneurs, cadence, robustesse (questions 2 et 6)

### GP-06 — P0 — En vol terrestre, aucun gouverneur n'agit sur le poste chargé

- **Où** : `src/renderer.ts:11021-11059` (`adaptRasterRate`), `:6582` (dispatch de `shadeLite` à `W/8 × H/8`, chaque
  frame), `trace.wgsl:15198-15240` (`shadeLite` n'appelle jamais `rasterRate()` ; seuls `shade`, `shadeMark`, `bodyLite`
  le lisent : `:14609`, `:14710`, `:15106`, `:15166`), `main.ts:8892` (`want = rasterTop()` dès que `rasterLiteActive`),
  `main.ts:8962-8973` (bascule vers le tracé).
- **Constat** :
  1. Le taux de shading « auto » ne règle que les restes de `shade`. Le matériau `shadeLite` ombre **tous** les pixels à
     chaque frame, quel que soit le taux.
  2. L'échelle dynamique est volontairement figée à `earthRasterScale` (0,75) tant que `shadeLite` dessine.
  3. Le bloc du traceur ne concerne plus que le ciel (déjà forcé à 16, `renderer.ts:10774-10781`).
  4. La bascule de secours vers le tracé exige `renderScale ≤ 0,5` quand l'échelle dynamique est active
     (`main.ts:8971`). Or l'échelle est tenue à 0,75 : cette bascule ne peut pas se déclencher dans ce cas.
- **Impact** : sur une machine trop lente, la cadence tombe sans qu'aucune qualité ne soit échangée. Mesuré (plan §0.2,
  kerr-mini, 5/11) : cockpit dans l'orage 58,9–60,2 ms, Châteaudun de nuit 53,6 ms, Beauce à 30 m 65–67 ms. Aucune vue de
  vol chargée ne tient le palier de 40 ms.
- **Piste** : §7.14 : un levier par poste. Pour le matériau : paliers d'échelle interne sans pulsation (I4), LOD matériel
  ou taux local validé ; pour les nuages : résolution et portée du volume ; plancher de qualité affiché.
- **Preuve** : lu (les quatre points) ; cadences mesurées (PLAN-REFRACTION-HORIZONS §0.2).

### GP-07 — P1 — Le mode « auto » dispatche `shade` et `shadeMark` à chaque frame, même sans rien à faire

- **Où** : `src/renderer.ts:331` (`RASTER_RATES_AUTO = [2, 4, 8, 16]`), `:6528-6546` (`liteAll` exige `rasterRate === 1`).
- **Constat** : l'économie U6 (« ~0,6 ms sur un M1 », commentaire `:6524-6527`) ne s'applique que si le taux vaut 1. En
  « auto », le taux vaut au moins 2. Donc `earth shade (raster)` puis `shadeMark` (un fil par pixel de l'image) tournent
  à chaque frame, alors que `shadeLite` prend presque tous les pixels.
- **Impact** : une passe plein écran et un noyau de 26 000 lignes gardés en service pour des restes. Coût actuel non
  mesuré dans ce cas précis.
- **Piste** : laisser `liteAll` décider sans regarder le taux ; ou fixer le taux à 1 quand `shadeLite` est actif.
- **Preuve** : lu ; le chiffre de 0,6 ms vient du commentaire du code, je ne l'ai pas retrouvé dans une fiche.

### GP-08 — P1 — Les gouverneurs lisent un intervalle de complétion, pas un temps GPU, et visent 30 ms par défaut

- **Où** : `src/renderer.ts:8956-8962` (`ms = now − max(t0, lastDoneAt)`), `main.ts:8727` (`gpuEma`),
  `renderer.ts:1202-1208` (`frameBudget`), `src/settings.ts:116/127/138/149` (`realtimeBudget: 30` pour low, medium, high,
  ultra), `:183` (16 pour `game` seulement), `:790` (qualité par défaut `"high"`).
- **Constat** : la grandeur pilotée inclut la file d'attente et la latence du rappel (GRAPHICS-PIPELINE §8.1 le dit).
  Avec deux frames en vol, elle oscille « d'un tiers à deux fois la moyenne » (commentaire `:10938`). Et le budget des
  préréglages autres que `game` est 30 ms : le gouverneur vise 33 images/s, pas 60.
- **Impact** : la cible de 60 images/s n'est la consigne d'aucun préréglage sauf `game`. Les décisions de qualité se
  prennent sur un signal bruité.
- **Piste** : nommer la consigne par profil (J0) ; piloter sur la somme des passes de calcul horodatées quand elle
  existe, garder l'intervalle de complétion comme garde-fou.
- **Preuve** : lu. Quel préréglage reçoit réellement un joueur selon le mode : non vérifié.

### GP-09 — P1 — La répartition de la frame n'est pas connue sur Apple

- **Où** : `src/gpuprof.ts:5` (`MAX_PASSES = 64`), `:40` (1 frame sur 8), GRAPHICS-PIPELINE §8.3 et §9.
- **Constat** : les horodatages des passes de **rendu** se chevauchent sur Apple (`display`, `ship: shading (MSAA)`
  affichent 20–45 ms dans une frame de 33–49 ms). Seules les passes de calcul s'attribuent. Le profileur ignore en
  silence les passes au-delà de 64 ; l'inventaire compte 60 libellés plus 9 sites dynamiques (les niveaux du bloom).
  Le CPU n'a qu'une section « render (encode, submit) ».
- **Impact** : on ne sait pas où partent 50–60 ms (cockpit, visibilité, affichage). Aucune optimisation ne peut être
  choisie sur preuve. C'est le groupe 2 du §8.0 du plan, toujours ouvert.
- **Piste** : attribution par ablation (`debugSkipShip`, `liteSkip`, etc.) sur images terminées, scène de référence J0.
- **Preuve** : mesuré (M0b, 2/11, cité par GRAPHICS-PIPELINE §8.3) ; limite de 64 lue. Dépassement réel des 64 : supposé.

### GP-10 — P1 — Image noire près de Jupiter (sud) : les gardes ne couvrent que NaN, pas l'infini

- **Où** : `trace.wgsl:497` (`isNan` : exclut ±Inf), gardes de sortie `:14372`, `:14394`, `:14465`, `:14681`, `:15035`… ;
  `post.wgsl:909` (seule garde NaN/Inf/> 6e4, dans `temporal`) ; `post.wgsl:288-300` (`down`, sans garde) ; cible
  `hdr` en `rgba16float` (`renderer.ts:2876`).
- **Constat** : un échantillon infini passe les gardes des noyaux. Il n'est filtré que si la passe `temporal` tourne
  (vue live, reprojection, historique valide). Sur une vue immobile (phase « converging »), rien ne le filtre : il
  entre dans `accum`, puis dans `hdr`, et la chaîne du bloom peut l'étaler en NaN sur toute l'image.
- **Impact** : compatible avec le symptôme noté (« image entièrement noire, étoiles comprises, pas d'erreur GPU, parfois
  la vue s'affiche »). Ce n'est pas démontré.
- **Piste** : compter les pixels non finis de `hdr` mip 0 et du dernier mip dans cette vue ; ajouter une garde « fini et
  borné » dans `resolve` (une ligne, tous les chemins). Vérifier aussi le posemètre (`readMeter`, `renderer.ts:8703`).
- **Preuve** : gardes lues ; lien avec le défaut **supposé, à confirmer**.

### GP-11 — P2 — Au-delà de 4,19 Mpx internes, le raster s'arrête sans le dire au reste de la frame

- **Où** : `src/system/terrain-raster-frame.ts:18` (`TERRAIN_RASTER_MAX_PIXELS = 4 194 304`), `renderer.ts:10319-10322`
  (`idle("pixel-budget")`), `:4250-4262` (l'éligibilité ne regarde pas la taille), `:6367` (le repli
  `dropRasterPrimary` n'est appelé que si `hint` existe).
- **Constat** : `writeParams` pose le bit « raster primaire » sans connaître la taille. Si la cible dépasse le plafond,
  la visibilité n'est pas dessinée, `hint` vaut `null`, et le bit n'est pas retiré par `dropRasterPrimary`.
- **Impact** : supposé. Un MacBook Pro 16" en plein écran donne 1728 × 1117 px CSS × 1,5 = 2592 × 1676 = 4,34 Mpx à
  l'échelle 1 (la vue tenue). Le sol passerait alors au traceur, ou resterait non dessiné selon le noyau. À confirmer.
- **Piste** : décider l'éligibilité au même endroit que le bit ; plafonner l'échelle tenue sous le budget.
- **Preuve** : chemin lu ; effet à l'écran **supposé** (calcul de la taille, pas d'essai).

### GP-12 — P2 — Une bande d'horizon perdue sur une vue convergée (toujours présent)

- **Où** : `src/renderer.ts:10690-10702` (encodeur créé, `horizonMaps.encode` avance sa bande), `:10858` (retour sans
  soumission quand la vue est convergée et inchangée).
- **Constat** : l'anomalie relevée par GRAPHICS-PIPELINE §9 est encore dans le code. L'encodeur est créé puis abandonné
  à chaque frame convergée.
- **Impact** : pendant le bake des horizons d'un corps, une vue immobile peut sauter des bandes. Non reproduit.
- **Piste** : tester « convergé et inchangé » avant de créer l'encodeur, ou soumettre le prélude seul.
- **Preuve** : lu ; effet supposé.

### GP-13 — P3 — Reprise après perte du device : présente, bornée, non revérifiée ici

- **Où** : `src/renderer.ts:2348-2357`, `:2421-2426`, `:8979-8985` ; `main.ts:572-632` (`recoverGpu`).
- **Constat** : sauvegarde, recréation du renderer, `adopt`, abandon après trois pertes en 60 s. Les erreurs non
  capturées sont comptées, les dix premières affichées. Après une reprise, tous les noyaux recompilent ; sur Windows le
  cache ne garde pas les gros noyaux (GP-17).
- **Impact** : sur D3D12, une perte de device en vol coûte de nouveau des minutes de compilation.
- **Preuve** : lu ; recréation à chaud 357 ms mesurée le 8/10 (PLAN-MONDE, périmée).

---

## 4. Coût CPU par frame (question 2)

### GP-14 — P2 — `writeParams` : environ 1 050 lignes, des effets de bord et des allocations à chaque appel

- **Où** : `src/renderer.ts:3332-4380`. Appels : `:10798` ou `:10829` (frame), `:5319` (sonde planétaire, 16 frames
  toutes les 2 s), `:11282` (offline).
- **Constat** : la fonction décide l'éligibilité du raster, la clé des noyaux, la clé « en avance », les tables, et
  écrit `bodyBuf` en entier (`:3581`) et `paramBuf` en entier (`:4378`). 43 lignes y allouent (tableaux typés, `map`,
  étalements). La sonde planétaire la rejoue une seconde fois dans la même frame.
- **Impact** : pression sur le ramasse-miettes, et surtout une fonction que personne ne peut modifier sans risque. La
  boucle CPU est mesurée à un p95 d'environ 4,6 ms pour une cible de 4 (T8, plan §0.2).
- **Piste** : séparer « décider » (une fois par frame, résultat immuable : l'amorce de la `FrameDescription`) et
  « écrire » ; n'écrire `bodyBuf` que si les corps ont changé.
- **Preuve** : lu ; p95 mesuré (plan §0.2, kerr-mini). Part de `writeParams` dans ces 4,6 ms : non mesurée.

### GP-15 — P2 — `paramBuf` retouché jusqu'à quatre fois pendant l'encodage : toutes les passes voient l'état final

- **Où** : `src/renderer.ts:6404`, `:6428`, `:6460`, `:10999`, `:6319` (`queue.writeBuffer` partiels).
- **Constat** : les écritures de file s'appliquent avant la soumission. Une passe encodée **avant** un de ces patchs lit
  donc quand même la valeur finale (par exemple `clouds` voit le bit des étoiles posé après elle). Le code le sait
  (« written for this submission »), mais l'ordre apparent du source ne dit pas ce que lisent les noyaux.
- **Impact** : piège de maintenance. Un futur patch non additif casserait une passe encodée plus tôt, sans erreur GPU.
- **Piste** : calculer tous les bits avant le premier `writeBuffer` ; un seul envoi de `Params` par soumission.
- **Preuve** : lu.

### GP-16 — P3 — Petites allocations et créations par frame

- **Où et constat** (tous lus) :
  - `renderer.ts:6201` et `:6215` : deux `createBindGroup` par frame en vue cockpit (`encodeCockpitMask`).
  - `renderer.ts:10701` et `:6298` : `prof.table()` trie toutes les passes deux fois par frame pour lire une valeur.
  - `renderer.ts:6475-6477` : `new Uint32Array` puis `writeBuffer` dans `stamps` à chaque frame, même sans astre.
  - `renderer.ts:6336`, `:6341`, `:11000`, `:4503-4531` : petits tableaux typés créés pour chaque écriture.
  - `renderer.ts:2492` : `matchMedia("(dynamic-range: high)")` interrogé à chaque frame.
  - `ship.ts:2716-3017` : vues de texture recréées à chaque passe du vaisseau.
- **Impact** : faible un par un ; ensemble, du travail du ramasse-miettes dans une boucle visée à 4 ms.
- **Piste** : caches par cible, valeur de la passe gardée dans un champ, écriture conditionnelle.
- **Preuve** : lu ; coût non mesuré.

**Lectures GPU → CPU** : aucune n'attend dans la frame. Les 14 `mapAsync` de `renderer.ts` sont soit des outils à la
demande (`await` dans des méthodes de diagnostic), soit des lectures différées (sonde de mer `:8946`, histogramme
`:7731`, sonde planétaire `:5347`, profileur). **Soumissions** : une par frame (`:8942`), plus la sonde planétaire
(`:5341`) et le warp. Lu.

---

## 5. Options coupées et réglages sans effet (question 3)

### GP-17 — P1 — Huit options coupées gardent du code, des bindings et des réglages ; aucune n'a de condition de retrait

État vérifié dans le code actuel :

| Option | État | Ce qui reste | Où |
|---|---|---|---|
| Q4 L2a (GTAO) | coupée (`gtaoOn = false`) | module `gtao.ts` (166 l.), pipeline compilé au démarrage, binding 47 du groupe 0, texture `ao` demi-résolution **allouée par cible**, repli 1×1, section `BEGIN_GTAO` | `renderer.ts:9635`, `:2890`, `:3037`, `:1314` ; `trace.wgsl:8347` |
| Q4 L2b (ciel des vallées) | coupée, **compilée hors du noyau** (`EARTH_SKY_OPEN = false`, bouchon) | source et bascule ; c'est la seule proprement retirée du binaire | `earth-horizons.ts:164`, `:362` ; `renderer.ts:9176` |
| Q4 L4 (spéculaire des matériaux) | coupée par un bit d'exécution (`liteSkip` 67108864) | le code reste **dans** `shadeLite`, testé par pixel | `renderer.ts:9180`, `:3405` |
| Q7 L7b (ombres retirées des orthos) | coupée (`orthoDelight: false`) | `ortho-delight.ts` (423 l.), réglage exposé au joueur | `settings.ts:334`, `:738` ; `ui/schema.ts:2096` |
| Q8 B5 (couvert bas) | coupée (`earthLowCover: false`) | pipelines du couvert dans `character-renderer.ts`, réglage exposé | `settings.ts:354`, `:755` ; `ui/schema.ts:2346` |
| Q6t (rayures de verrière) | coupée (forces à 0) | deux versions : `ship.wgsl` et l'essai écran de `display.wgsl`, « gardé pour comparaison » | `renderer.ts:4553-4554` ; `display.wgsl:173`, `:877` |
| VIPER C2 (nuages amortis) | coupée (`cloudAmortize = false`) | drapeau de frame, branche de dispatch, poids d'historique, mesure du mouvement d'image | `renderer.ts:470`, `:6421`, `:9979-9987` |
| VIPER C3 | coupée selon le plan §0.2 | non retrouvée par nom dans le code : **non vérifié** | — |

- **Impact** : coût de compilation et de lecture ; un binding de texture échantillonnée occupé (la ressource rare du
  groupe 0) ; deux réglages de prototypes dans l'interface du joueur. Le coût exact n'est pas mesuré.
- **Piste** : groupe 4 du §8.0 du plan : trancher L4, Q6t, L7b, B5 ; supprimer L2a et C2 ou écrire leur condition de retour.
- **Preuve** : lu.

### GP-18 — P2 — Le réglage « shading du raster » n'a presque plus d'effet sur la Terre

- **Où** : `src/settings.ts:343` (`earthRasterShading`, préférence du joueur), `trace.wgsl:15198` (voir GP-06).
- **Constat** : le commentaire du réglage promet « un pixel sur deux à un sur seize ». Depuis `shadeLite`, cela ne vaut
  plus que pour les restes de `shade` et pour les autres mondes (plafonné à 4, `renderer.ts:4305`).
- **Impact** : un réglage qui ne fait pas ce qu'il dit ; les coûts publiés par réglage (`ui/settings/costs.ts`) sont à
  revoir pour celui-ci.
- **Preuve** : lu.

### GP-19 — P3 — 45 bits `liteSkip` et 181 usages de `TUNE_*` vivent dans les noyaux de production

- **Où** : `renderer.ts:9162-9171` (liste des bits), `trace.wgsl` (45 tests `liteSkip() &`, 181 occurrences `TUNE_`).
- **Constat** : ce sont des outils de mesure utiles (ablation). Mais les bits `liteSkip` sont des tests d'exécution par
  pixel dans le noyau livré, et trois options produit (L2b, L4, rivage) passent par ce même mot de diagnostic.
- **Piste** : séparer « option produit » (constante de spécialisation) et « ablation de mesure ».
- **Preuve** : lu (comptages par grep).

---

## 6. Compilation (question 4)

### GP-20 — P1 — Jupiter proche : 203 s à froid, aucune anticipation, aucun budget

- **Où** : `docs/PROBLEMES-A-REGLER.md` (6/11) ; `src/renderer.ts:6033` (`prewarmEarthFlight` : la seule
  pré-compilation, depuis le titre, sautée en e2e, `main.ts:9758`) ; `:4347-4351` (`aheadKey` : seulement surface et
  décor) ; `tests/kernel-budget.json` (61 valeurs, aucune pour les géantes).
- **Constat** : mesuré sur M1 Max, cache vide : 203 s sans aurore, 219 s avec, puis environ 60 s pour la sonde `env`.
  Rien ne lance cette compilation quand Jupiter devient la destination (voyage G, Atlas, scène de la galerie).
- **Impact** : plus de trois minutes d'attente à la première approche. La nouvelle scène « aurores de Jupiter » y
  tombe aussi (noté dans le journal du 8/11).
- **Piste** : profil et budget « géante proche » dans `kernel-budget` ; mesure par fonction comme P0–P10 ; compiler dès
  que la destination est connue.
- **Preuve** : mesuré (PROBLEMES-A-REGLER, ce Mac, 6/11) ; absence d'anticipation lue.

### GP-21 — P1 — Le plus gros noyau du vol terrestre est la sonde de lumière du vaisseau

- **Où** : GRAPHICS-PIPELINE §5.3 : profil Terre raster, `env` 57 000 lignes inlinées, `main` 42 000, `discs` 30 000,
  `shade` 26 000, `shadeLite` 8 200. Total 175 000.
- **Constat** : `env` trace une sonde de 256 × 128 texels. Il coûte plus à compiler que le ciel. `shade` (les restes) et
  `discs` (les astres) pèsent ensemble 56 000 lignes. Le matériau qui dessine l'image n'en pèse que 8 200.
- **Impact** : sur kerr-pc, `env` 42 s, `shade` 60 s, `main` 72 s, tout prêt en 208–220 s (28/10, périmé). Les budgets
  `main`, `env`, `discs`, `shade` sont « à leur taille mesurée, sans marge » (§5.3) ; le test passe encore aujourd'hui.
- **Piste** : une sonde qui lit les tables de l'air (ciel ambiant, CSM) au lieu de retracer la scène ; retirer `shade`
  (GP-02) ; c'est aussi un pas vers le `LightingState` de §7.8.
- **Preuve** : tailles mesurées (statique, 6/11) ; temps mesurés, périmés (kernels/BASELINE, 28/10).

### GP-22 — P1 — Environ 55 pipelines synchrones au démarrage, jamais chronométrés ; des pipelines recréés à chaque appel

- **Où** : `ship.ts` (19 sites `create*Pipeline(` synchrones, 0 asynchrone), `character-renderer.ts` (9), `station.ts`
  (3), `endurance.ts` (2), `sea/fft-gpu.ts`, `ui/map3d/gpu.ts` (6 à l'ouverture de la carte) ; `renderer.ts:1719-1722`
  (le commentaire le reconnaît) ; `system/giant-tile.ts:230-244` (module et pipelines créés dans la fonction) ;
  `earth-maps.ts:247`, `hd-maps.ts:294`, `day-clouds.ts:161` (module neuf à chaque chargement).
- **Constat** : aucun de ces sites n'utilise `create*PipelineAsync`. Leur durée n'est journalisée nulle part.
- **Impact** : fil principal bloqué au démarrage (la plus longue tâche avant la première image, 200–380 ms, tombe juste
  après la marque `renderer`, E0/E11) et à l'ouverture de la carte. Lien de cause **supposé**.
- **Piste** : passer en asynchrone, chronométrer, mettre en cache les modules des packers.
- **Preuve** : lu (comptages) ; tâche longue mesurée (title-aaa E0/E11, octobre).

### GP-23 — P2 — Aucun cache de pipelines propre à l'application ; trois tables de l'air sur le module entier

- **Où** : `renderer.ts:6126-6138` (LRU de 4 clés en mémoire), GRAPHICS-PIPELINE §5.2 ; `renderer.ts:9236-9239`,
  `:9318-9321`, `:9400-9403` (`cloudShadow`, `cloudLightVolume`, `skyAmbient` sur `this.traceModule`, non spécialisé).
- **Constat** : entre deux sessions, seul le cache du navigateur sert. Sur Windows il ne garde pas les gros noyaux
  (`main` 80 → 79 s à la relance, 28/10). Les trois tables de l'air compilent contre le source complet du traceur.
- **Impact** : chaque session Windows repaie les compilations. Toute modification de `trace.wgsl` invalide aussi les
  dérivés (warp, cache, raster du terrain, raster des corps).
- **Piste** : programmes racines indépendants pour les tables (§7.12) ; mesurer ce que D3D12 met réellement en cache.
- **Preuve** : lu ; mesure Windows périmée (28/10).

---

## 7. Mémoire GPU (question 5)

### GP-24 — P1 — Toute la cible live est recréée à chaque arrêt et à chaque reprise de la caméra

- **Où** : `main.ts:8844-8857` (vue tenue 0,4 s : échelle 1 ; en mouvement 0,15 s : retour à l'échelle du mouvement),
  `:5481-5487` (même règle sans échelle dynamique), `renderer.ts:3279-3294` (`resize` → `createTarget`), `:2848-2900`.
- **Constat** : `createTarget` alloue par pixel interne : `accum` 16 o, `gather` 16, `stars` 12, `moments` 8,
  `sceneDepth` 4, `stamps` 4, `hdr` rgba16f avec mips, puis à la première frame deux historiques et deux albédos rgba16f,
  six textures de nuages rgba32f en demi-résolution, le TAAU à la taille de la toile. S'y ajoutent la distance
  `rgba32float` + profondeur du raster et le MSAA ×4 du vaisseau. L'ancienne cible n'est détruite qu'après
  `onSubmittedWorkDone` (`:3290`), ce qui est correct mais donne un pic « ancienne + nouvelle ».
- **Ordre de grandeur calculé** : au moins 60 o/px de buffers et environ 100 o/px de textures, soit de l'ordre de
  200–330 Mio à 1920 × 1080 selon ce qui est actif. Non mesuré.
- **Impact** : à chaque pause du regard, des centaines de Mio alloués, tous les bind groups refaits, l'historique
  rééchantillonné (`carryHistory`). Le commentaire `main.ts:8889-8891` décrit le « flou à chaque palier » que cela causait.
- **Piste** : allouer une fois à la taille maximale et rendre dans un sous-rectangle (viewport dynamique) ; c'est aussi
  la condition des paliers I4 sans pulsation.
- **Preuve** : lu ; tailles calculées ; pic mémoire non mesuré (GRAPHICS-PIPELINE §9 point 3 le dit aussi).

### GP-25 — P2 — Décor : une scène entière envoyée d'un bloc sur le fil principal

- **Où** : `src/system/scenery.ts:285-297` (buffer au budget de la portée, 16/36/64 Mio ; `writeBuffer(this.buffer, 0,
  r.buffer)`), `:303` (`new SceneryContact` dans la foulée), `:262`.
- **Constat** : chaque scène remplace toute la précédente par une seule écriture. Le temps est accumulé
  (`this.uploaded`, `:304`) mais pas borné. Le buffer est recréé quand la portée change ; l'ancien est retiré proprement.
- **Impact** : un à-coup possible à chaque nouvelle scène ; pas de résidence par cellule (§7.19). Durée non mesurée ici.
- **Piste** : publication par cellules ou par tranches sous un budget d'octets par frame.
- **Preuve** : lu ; durée de l'envoi non relevée.

### GP-26 — P2 — Tuiles : envois sans budget par frame, une soumission de mips par tuile

- **Où** : `src/system/earth-tiles.ts:1852` (`put`, appelé à l'arrivée), `:2265`, `:2341-2379` (`writeTexture`),
  `:2300-2326` (mips : un bind group par niveau, une soumission par tuile).
- **Constat** : aucun budget d'octets ou de tuiles par frame dans ce fichier (grep « budget », « per frame » : rien
  d'applicable). Le plan §0.2 note déjà « `put` sur le fil principal ».
- **Impact** : rafales d'envois à l'arrivée d'un lot de tuiles ; leur coût GPU tombe dans la frame suivante, sans libellé.
- **Piste** : file de publication à budget (§7.6), mips groupées dans une soumission par frame.
- **Preuve** : lu.

### GP-27 — P3 — Mémoire : une estimation par format, pas une mesure par étape

- **Où** : `src/bench/vram.ts` (jauge), GRAPHICS-PIPELINE §4.3.
- **Constat** : 1 434–1 578 Mio en vue terrestre sur kerr-mini (M0a/M0b, 2/11), pour un plafond visé de 2 Gio. C'est une
  somme par format, pas une lecture du pilote. Aucune mesure par étape du parcours ni du pic de redimensionnement.
- **Preuve** : mesuré (fiches M0a, T10), en partie périmé.

---

## 8. Qualité d'image et cohérence de la lumière (question 7)

### GP-28 — P1 — Lumière : les appareils, le personnage et la station ne partagent ni l'air ni les ombres du sol

- **Où** : `src/shaders/ship.wgsl` (aucune lecture de la table aérienne ni de l'ombre des nuages : grep « aerial »,
  « csm » sans résultat utile ; lumière par `envSpec`/SH, `:629`, `:1272`), `character.wgsl`, `station.wgsl` (idem) ;
  fonctions dupliquées entre `ship.wgsl` et `character.wgsl` : `envAB`, `envUV`, `fromProbe`, `toProbe`, `shBasis`,
  `shadowAt`, `project`, `lightClip`.
- **Constat** : ces objets sont éclairés par la sonde 256 × 128 et leur propre ombre. Ils ne reçoivent pas la
  perspective aérienne entre la caméra et eux. Il n'existe pas d'état de lumière commun (§7.8).
- **Impact** : un avion lointain (trafic, ravitailleur, autre joueur) ne se fond pas dans la brume comme le sol derrière
  lui : **supposé, à confirmer à l'image**. Défaut déjà relevé : le ciel de nuit de la sonde vaut environ 40 fois son
  sol, corrigé par une borne provisoire (`docs/PROBLEMES-A-REGLER.md`, a1e34357).
- **Piste** : J3 : `LightingState` ; d'abord lire la table aérienne dans `ship.wgsl` pour les appareils éloignés.
- **Preuve** : absence lue (grep) ; effet visuel supposé ; écart de la sonde observé (6/11).

### GP-29 — P2 — Reconstruction : deux historiques longs, pas de masque réactif, échelle figée

- **Où** : `post.wgsl:713` (`temporal`), `:1174` (`taau`), `:987` (`cloudTemporal`) ; `main.ts:8889-8892`.
- **Constat** : l'image opaque passe par `temporal` puis `taau` ; les nuages ont leur propre historique. Il n'y a ni
  masque de réactivité (eau, émissions) ni rejet par contenu changé. Le changement d'échelle rééchantillonne
  l'historique : il a fallu figer l'échelle pour supprimer le flou périodique.
- **Impact** : §7.10 et §7.18 non tenus. Le journal note encore « le rendu un peu doux en mouvement » (6/11).
  Q6 a mesuré une image figée stable sous 1 % et le TAAU en mouvement (analyse §21.1) : ce socle existe.
- **Preuve** : lu ; qualité en mouvement actuelle non mesurée.

### GP-30 — P3 — Précision des profondeurs : correcte en raster, hétérogène ailleurs

- **Constat** : le raster du terrain, du décor, du vaisseau et du personnage utilise `depth32float` en Z inversé
  (`terrain-raster.ts:431`, `scenery-raster.ts:830`, `ship.ts:843`, `character-renderer.ts:330`). Mais la profondeur lue
  par les composites est une distance f32 reconstruite (`sceneDepth`), et les cartes d'ombre sont en Z direct.
- **Preuve** : lu. Aucun défaut de précision constaté dans cette lecture.

---

## 9. Maintenabilité (question 8)

### GP-31 — P1 — Les offsets de `Params` sont écrits à la main des deux côtés, sans test de concordance

- **Où** : `trace.wgsl:13` (`struct Params`), `renderer.ts:378-389` (tailles composées à la main), 73 appels
  `set(<nombre>, …)`, 19 accès `f[<n> * 4 + k]`, 20 usages de `MOUTH_LIST_AT + k`, `paramsF[69 * 4 + 3]` (`:6284`),
  `writeBuffer(paramBuf, 17 * 16, …)` (`:6319`), `displayBuf` aux offsets 192, 256… (`:4503-4531`).
- **Constat** : les **tables** de `bodyBuf` sont gardées par `tests/gpu-tables.test.ts`. La structure `Params`, la plus
  modifiée, ne l'est pas : je n'ai trouvé aucun test qui compare `PARAM_VEC4S` ou les index au WGSL. Aucune des
  bibliothèques de §18 (webgpu-utils, TypeGPU, wgsl_reflect) n'est dans `package.json`.
- **Impact** : un champ inséré décale tout ; l'erreur est silencieuse (image fausse, pas d'erreur de validation).
- **Piste** : un test statique qui parse `struct Params` et vérifie tailles et index nommés ; puis webgpu-utils à J1.
- **Preuve** : lu (comptages par grep). Absence de test : recherché dans `tests/`, non exhaustif.

### GP-32 — P2 — Deux monolithes qui grossissent

- **Constat** : `renderer.ts` porte le device, les cibles, les gouverneurs, la cascade de compilation, 38 sites de bind
  groups, 85 `writeBuffer`, la frame et les outils de diagnostic. `trace.wgsl` : 632 fonctions, 15 points d'entrée, 64
  constantes `override`, 14 injections de source. Toute modification de `trace.wgsl` change les sources de cinq dérivés.
- **Impact** : temps de lecture, conflits entre sessions parallèles sur `main`, compilation.
- **Piste** : ne pas découper pour découper (§7.1). Sortir d'abord ce qui a une frontière nette : gouverneurs,
  `writeParams` (décider/écrire), tables de l'air en programmes racines.
- **Preuve** : lu ; croissance mesurée par git (GP-01).

---

## 10. La doc GRAPHICS-PIPELINE est-elle vraie ? (question 9)

### GP-33 — P2 — Vraie sur la structure, en retard sur les lignes et sur toutes les mesures

- `bun scripts/pipeline-inventory.ts --check` **passe** : 60 libellés, 28 fichiers de pipelines, 15 fichiers WGSL nommés.
- L'ordre des passes, les conditions et les lectures/écritures que j'ai recoupés (C2 à C19, D, E9, F4, soumission
  unique) correspondent au code.
- **Écarts** :
  - numéros de ligne décalés : `frame()` 10653 → 10669, `submit()` 8919 → 8935, `createTarget` 2845 → 2848,
    mips d'imagerie `earth-tiles.ts:2185` → `:2326` ;
  - `trace.wgsl` annoncé à 16 541 lignes, 16 608 aujourd'hui ; annexe générée sur `6d11d6b5` ;
  - le fichier a des modifications non commitées (`git status`) ;
  - le document dit lui-même que **toutes** ses mesures de compilation sont périmées et qu'aucune suite de référence
    n'a été relancée (§5.5, §8.4, §10) ;
  - il ne dit pas que le taux de shading n'agit plus sur `shadeLite` (GP-06) ni que `shade` tourne toujours en « auto »
    (GP-07) : la ligne C17 laisse croire que `liteAll` est le cas courant.
- **Le contrôle ne vérifie que des noms.** Il ne voit ni un ordre faux ni une condition fausse.
- **Preuve** : commande lancée ; recoupements lus.

---

## 11. Tableau récapitulatif

| Id | Gravité | Sujet | Preuve |
|---|---|---|---|
| GP-01 | P0 | Pas de forward ni de contrat de surface ; J1 non commencé ; monolithe +1 787 lignes depuis le 3/11 | lu, mesuré (git) |
| GP-06 | P0 | Aucun gouverneur n'agit sur le matériau ; vols à 50–65 ms sur kerr-mini | lu, mesuré (plan §0.2) |
| GP-02 | P1 | Trois ombrages de la Terre proche (`main`, `shade`, `shadeLite`) | lu |
| GP-03 | P1 | Quatre profondeurs, pas d'identité ni de mouvement | lu |
| GP-04 | P1 | Marqueurs dans `moments.x` et l'alpha ; C0-2 non appliqué | lu |
| GP-07 | P1 | `shade` + `shadeMark` dispatchés chaque frame en « auto » | lu |
| GP-08 | P1 | Gouverneurs sur l'intervalle de complétion ; budget 30 ms par défaut | lu |
| GP-09 | P1 | Répartition de la frame inconnue sur Apple | mesuré (M0b), lu |
| GP-10 | P1 | Image noire Jupiter : gardes NaN sans Inf | lu, lien supposé |
| GP-17 | P1 | Huit options coupées encore présentes | lu |
| GP-20 | P1 | Jupiter proche 203 s, sans anticipation ni budget | mesuré (6/11), lu |
| GP-21 | P1 | `env` plus gros noyau du vol ; `shade` + `discs` 56 000 lignes | mesuré (statique) |
| GP-22 | P1 | ≈ 55 pipelines synchrones non chronométrés ; packers recréés | lu |
| GP-24 | P1 | Cible recréée à chaque arrêt/reprise ; 200–330 Mio calculés | lu, calculé |
| GP-28 | P1 | Appareils sans perspective aérienne ni lumière commune | lu, effet supposé |
| GP-31 | P1 | Offsets de `Params` à la main, sans test | lu |
| GP-05 | P2 | Un seul buffer de tables, un seul groupe 0 | lu |
| GP-11 | P2 | Plafond de 4,19 Mpx : raster arrêté sans repli explicite | lu, effet supposé |
| GP-12 | P2 | Bande d'horizon perdue en vue convergée | lu, effet supposé |
| GP-14 | P2 | `writeParams` 1 050 lignes, allocations, `bodyBuf` réécrit | lu |
| GP-15 | P2 | `paramBuf` patché en cours d'encodage | lu |
| GP-18 | P2 | Réglage `earthRasterShading` presque sans effet | lu |
| GP-23 | P2 | Pas de cache persistant ; tables de l'air sur le module entier | lu, mesuré (périmé) |
| GP-25 | P2 | Décor envoyé d'un bloc (jusqu'à 64 Mio) | lu |
| GP-26 | P2 | Tuiles sans budget d'envoi ; une soumission de mips par tuile | lu |
| GP-29 | P2 | Deux historiques longs, pas de masque réactif | lu |
| GP-32 | P2 | Monolithes `renderer.ts` et `trace.wgsl` | lu, mesuré (git) |
| GP-33 | P2 | Doc pipeline : lignes et mesures en retard | commande, lu |
| GP-13 | P3 | Reprise du device présente ; recompilation complète après | lu |
| GP-16 | P3 | Allocations et créations par frame | lu |
| GP-19 | P3 | Bits de diagnostic dans les noyaux livrés | lu |
| GP-27 | P3 | Mémoire estimée, pas mesurée par étape | mesuré (périmé) |
| GP-30 | P3 | Profondeurs hétérogènes hors raster | lu |

---

## 12. Les dix actions les plus rentables

« Certitude » porte sur l'effet attendu. Aucun gain n'est chiffré quand il n'a pas été mesuré.

| # | Action | Sert | Certitude | Coût | Ce qui est mesuré / ce qui ne l'est pas |
|---|---|---|---|---|---|
| A1 | **Scène de vol de référence et fiche J0**, frame répartie par ablation sur images terminées (sol, nuages, cockpit, affichage) | J0, 60 i/s | élevée (c'est une mesure) | 2–3 jours | Rien d'actuel n'est mesuré sur M1 Max ; kerr-mini : 50–65 ms mesurés le 5/11 |
| A2 | **Brancher un gouverneur sur le matériau et les nuages** : cible à taille fixe + viewport dynamique (GP-24), paliers d'échelle sans pulsation, résolution/portée des nuages | 60 i/s | moyenne | 1 semaine | Coût du matériau 12–17 ms et nuages 1,5–16 ms mesurés le 2/11 (périmé) ; gain non mesuré |
| A3 | **Sortir `shade`/`shadeMark` de la frame courante** (GP-07), puis du profil (ponts et arbres proches en géométrie) | 60 i/s, compilation | moyenne | 1 jour, puis 1 semaine | 0,6 ms : commentaire du code ; 26 000 lignes inlinées mesurées ; temps Windows périmé |
| A4 | **Garde « fini et borné » dans `resolve`** et sonde des pixels non finis près de Jupiter (GP-10) | robustesse | moyenne (cause supposée) | 0,5 jour | Défaut observé le 6/11 ; cause non établie |
| A5 | **J1 pilote** : terrain + bâtiments en forward, sortant profondeur finale, identité/génération, pose précédente, couleur ; `sceneDepth` et le temporel lisent ces sorties | J1 | moyenne | 2–4 semaines | Aucun gain mesurable avant d'exister ; à juger sur A1 |
| A6 | **Test statique du layout `Params`** (parse du WGSL contre les index TypeScript), puis webgpu-utils à J1 | J1, fiabilité | élevée | 1 jour | Aucun désalignement constaté ; risque lu |
| A7 | **Compilation de Jupiter** : profil et budget « géante proche », pré-compilation dès que la destination est choisie | expérience | élevée pour l'anticipation, inconnue pour la taille | 2–4 jours | 203 s mesurés (6/11) ; répartition par fonction non mesurée |
| A8 | **Sonde `env` légère** : lire les tables de l'air au lieu de retracer la scène | compilation, J3 | moyenne | 1 semaine | 57 000 lignes mesurées ; 42 s sur kerr-pc (périmé) ; effet sur l'image non évalué |
| A9 | **Pipelines du démarrage en asynchrone et chronométrés** ; modules des packers en cache | première image | moyenne | 2 jours | Tâche longue 200–380 ms mesurée en octobre ; part des pipelines non mesurée |
| A10 | **Trancher et retirer** les options coupées (GP-17) et corriger le réglage `earthRasterShading` (GP-18) | maintenabilité, bindings | élevée | 1–2 jours après décisions de Sam | Coûts de L2a, B5, C2 mesurés dans leurs fiches ; coût de leur présence non mesuré |

Ordre conseillé : A1, puis A4 et A6 (courts, sans regret), puis A2/A3 sur la foi de A1, A7 en parallèle, A5 ensuite.

---

## 13. Mesures qui manquent pour décider

1. La frame de la scène de référence **répartie par poste sur images terminées**, sur M1 Max et kerr-mini, au commit
   courant. C'est la mesure dont tout le reste dépend.
2. Une suite `plan-views` de référence actuelle (les coûts par passe publiés datent du 2/11, avant T9, Q3, Q5, la nuit).
3. `kernel-compile` à froid et à chaud au commit courant : Terre sur kerr-mini et kerr-pc, Jupiter sur les trois machines.
4. Le coût de création des pipelines synchrones du démarrage, un par un.
5. Le coût réel de `shade` + `shadeMark` quand `shadeLite` prend tout (GP-07).
6. Le temps CPU de `writeParams` et de l'encodage par passe ; les octets envoyés par frame (`writeBuffer`,
   `writeTexture`), dont l'envoi du décor et les rafales de tuiles.
7. La mémoire par étape du parcours et le pic d'un redimensionnement (arrêt puis reprise de la caméra).
8. Les pixels non finis (`hdr`, mips du bloom) dans la vue de Jupiter sud, et la valeur du posemètre à cet instant.
9. Le comportement au-dessus de 4,19 Mpx internes (MacBook Pro 16" plein écran, vue tenue).
10. La présentation réelle (images nouvelles livrées, p95/p99) : aucune API dans l'application, seulement
    `jitter-lab` et l'e2e `cadence`.
11. La qualité en mouvement au commit courant (`motion-quality`, `ghost`, `city-flicker`), avant tout changement du
    gouverneur.

---

## 14. Ce qui est solide

- **Une soumission par frame**, deux images en vol au plus, vue convergée sans soumission (`renderer.ts:8942`, `:1189`).
- **Aucune lecture GPU bloquante dans la frame** : toutes les lectures sont différées ou à la demande.
- **Destruction différée** des cibles, textures et buffers après `onSubmittedWorkDone` (`renderer.ts:3290`,
  `scenery.ts:142-148`).
- **Profil de clé Terre-raster** : une seule série de constantes pour le vol bas, pas de recompilation à l'arrivée du
  décor ou de la météo ; ciel d'attente avant `main` ; file de compilation à deux emplacements avec priorité.
- **Garde-fous statiques qui passent aujourd'hui** : `pipeline-inventory --check`, `kernel-budget` (61 valeurs),
  `gpu-tables.test.ts` pour les tables.
- **Reprise après perte du device** écrite de bout en bout, avec sauvegarde et limite de tentatives.
- **Z inversé en `depth32float`** dans toutes les passes raster de la vue.
- **Reprojection analytique** avec profondeur, déplacement de la caméra et mouvement rigide du corps proche.
- **Travail lourd hors frame** : décodage des tuiles, maillages du terrain, décor, spécialisation du WGSL en workers.
- **Outils de mesure nombreux** (`trace-ab`, `ab-commit`, `perf-suite`, ablations `liteSkip`/`TUNE_*`) et une doc de
  pipeline qui distingue mesuré, estimé et périmé.

---

## 15. Non vérifié

- Rien n'a été exécuté en jeu : aucun chiffre de ce rapport n'est une mesure nouvelle, sauf les comptages statiques
  (lignes, occurrences, historique git) et les deux commandes citées en tête.
- VIPER C3 : non retrouvé par nom dans le code.
- `ship.ts` (3 125 l.), `character-renderer.ts`, `body-raster.ts`, `horizon-maps.ts`, `earth-horizons.ts`, `sea/` et
  `src/jitter` n'ont été lus que par extraits ciblés. Le worker de spécialisation n'a pas été relu.
- La méthode `adopt` de la reprise du device et la carte 3D (`ui/map3d/gpu.ts`) n'ont pas été relues en détail.
- Les effets à l'écran de GP-10, GP-11, GP-12 et GP-28 sont des hypothèses tirées du code.
- Quel préréglage de qualité un joueur reçoit selon le mode de jeu (GP-08).
- Le dépassement réel des 64 passes du profileur dans une frame de cockpit (GP-09).
- Console d'équipage (`/crew/`, devices séparés) : hors de cette lecture.
