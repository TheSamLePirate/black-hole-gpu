# Revue de la branche `codex/earth-photorealistic` (13 octobre 2026)

Branche comparée à `main` (base `2b8342a`, 11 oct.) : 52 commits, 363 fichiers, +81 089 / −1 470 lignes, dont
environ 50 000 lignes de code. Revue faite pendant la campagne e2e complète, en lecture seule : aucun test,
aucun navigateur, aucune modification de l'arbre testé.

## Méthode et suivi

| Zone | Périmètre | Relecteur | Vérifié à la main |
|---|---|---|---|
| Rendu GPU et sol de la Terre | renderer.ts, trace/forest/character.wgsl, earth-surface, earth-tiles, scenery*, forest, herbe, pierres, character-renderer | agent 1 | H1 `EARTH_SHADOW_POINT`, H2 `TRANSLATION_M`, H3 manche à air |
| Piéton, caméra, contrôleurs | controller/character, camrig, cine/*, spectator, piloting, lens, jet, gpws, modes | agent 2 | — |
| UI et modes | main.ts, topbar, HUD (flight/foot/kind/jet), atlas, carte, skyevents, photo, capture, keymap, CSS | agent 3 | M5 touches à pied (keymap.ts:466-480) |
| Musique et audio | audio/music/*, music.ts, score.ts, musicpanel | agent 4 | H1 rattrapage (engine.ts:242) |
| TARS, données, réglages, serveur | ai/game-tools, game-commands, pois, geocode, settings, schema, i18n, server.ts | agent 5 | `sceneryHitboxes: true`, cache des échecs du géocodeur |
| Tests, scripts, docs, assets, CI | tests/, scripts/, docs/, assets/, .github | agent 6 | dépôt PUBLIC, astronaute poussé sur 2 branches distantes |
| Profondeur herbe/arbres (13 oct., demande utilisateur) | trace.wgsl (moments), post.wgsl, character.wgsl, passes raster | agent 7 | écriture de `moments` (trace.wgsl:7558-7576), test de l'herbe (character.wgsl:487) |
| Ancrage caméra/vaisseau/personnage (13 oct., demande utilisateur) | renderer.ts, scenery.ts, character-renderer, character.wgsl, main.ts | agent 8 | `surfaceFocus` → `earthScenery.update` → `P.scenery[3]` (renderer.ts:2465-2478, scenery.ts:117) ; `main.ts:4810` |

Gravité : **Critique** (à régler avant tout merge ou déjà exposé), **Haute** (bug visible ou coût net),
**Moyenne**, **Basse**. Chaque point indique `fichier:ligne`. Statut : ☐ à faire, ☑ fait.

## Conclusions

1. **Il faut décider vite pour la licence de l'astronaute.** Le modèle CGTrader, qui « n'est pas sous MIT » et ne doit pas être
   redistribué comme modèle ou texture autonome, est committé (23,7 Mo). Il est poussé sur un dépôt **public** et
   copié en fichiers bruts sur le site.
2. **Qualité globale bonne**, et cohérente avec les conventions du projet : commentaires qui expliquent le pourquoi,
   tests unitaires nombreux, CI qui couvre typecheck, biome, WGSL et `bun test`, i18n française complète pour
   `t()`. Aucun problème de sécurité serveur : la regex de `/earth-surface` est stricte, il n'y a ni SSRF ni clé exposée.
3. **Le noyau de rendu, sensible au nombre de registres, a pris du code non gardé.** C'est la piste la plus
   probable pour la régression du Bourget (35 → 44 ms) : manche à air sortie de `HAS_RWY`, `waterMirror`/calme et
   bruit de la mer non gardés par `HAS_SCENERY`, `walkDistance` dans la boucle chaude, imagerie z9–13 jusqu'à
   8 niveaux. Plus le point H2 : la reprojection temporelle est coupée dès 1 mm de translation près du sol, ce qui
   la désactive en vol bas.
4. **Les blocages de 4 s (item 5 de la campagne)** viennent très probablement de la compilation du noyau
   `|8192`, lancée seulement quand les données du décor arrivent. Il faut la précompiler dès la requête et
   garder plus de 2 variantes en cache.
5. **Les transitions entre modes sont le point faible fonctionnel.** On trouve des vues périmées en passant du
   piéton à la caméra libre, une orientation du vaisseau fausse en vue réalisateur après placement ou chargement,
   des restaurations à pied impossibles sur un toit, un pont ou un pont de navire, et Espace/V/C/Y perdus à pied.
6. **Le dépôt et le site grossissent sans garde-fou** : 64 Mo de binaires sans LFS (96 Mo dans l'historique de la
   branche), et un site Pages à environ 900 Mo pour une limite de 1 Go.
7. **La musique** n'a pas de fuite de nœuds, mais elle a un vrai bug de rattrapage : le son coupé puis remis
   fait jouer des centaines de mesures d'un coup. Il n'y a pas de copie de mélodie connue. Le risque restant vient
   des noms des œuvres réelles affichés dans l'interface.
8. **Profondeur (signalé par l'utilisateur) : des troncs « transparents » à l'herbe derrière eux.** En temps
   réel, seul un pixel par bloc reçoit chaque image une profondeur fraîche, et elle n'est jamais reprojetée,
   alors que la couleur l'est. En mouvement, l'herbe, les pierres et le vaisseau se comparent donc à la
   profondeur du sol ou du ciel d'avant, et passent devant les troncs et les bâtiments. Voir § Profondeur.
9. **Ancrage (demande de l'utilisateur : tout par rapport à la caméra).** Ce n'est pas le cas.
   - Le décor OSM et les forêts sont **tracés depuis le centre du vaisseau** dès qu'il vole sous 30 km : les arbres et les
     bâtiments sont décalés du sol de 3,6 m dans le cockpit, 14 m en poursuite, et jusqu'à des kilomètres en
     spectateur. Leurs ombres aussi.
   - Le streaming (tuiles, surface, décor) suit l'altitude et la position du vaisseau.
   - L'herbe et les pierres n'existent qu'autour du personnage.
   - Les cartes d'ombre centrées sur ce qui projette l'ombre (vaisseau, astronaute) sont correctes.

   Voir § Ancrage.

## Plan d'action proposé (ordre)

1. ☐ Astronaute : décision de l'utilisateur. Le sortir de l'historique des branches distantes, le servir depuis
   un stockage privé, et vérifier si la licence permet de servir les fichiers transcodés.
2. ☐ Réglages par défaut : `sceneryHitboxes: false`.
2b. ☐ Ancrage caméra (Z-V1 en premier : le décor tracé depuis le vaisseau est faux dans toutes les vues de vol), puis
   Z-V2 (streaming) et Z-V3 (sol vivant autour de la caméra).
2c. ☐ Profondeur d'occlusion fraîche à pleine résolution pour les passes rasterisées (Z-P1).
3. ☐ Noyau : regarder l'A/B `trace-ab` (Bourget) une garde à la fois (manche à air, `waterMirror`/mer,
   `walkDistance`, niveaux d'imagerie), puis remettre les gardes `HAS_*`.
4. ☐ Variantes : précompiler `|8192`/`|4096`, garder 4 clés en cache, journaliser toutes les compilations.
5. ☐ Reprojection : seuil de translation lié à la parallaxe, et facteur en mètres cohérent avec la masse.
6. ☐ Transitions de mode : piéton → libre, vue réalisateur, restauration à pied, touches à pied.
7. ☐ Musique : sauter les mesures en retard, hystérésis des moments, synthèse des notes hors de la frame.
8. ☐ TARS : `net()` avant les nouveaux téléportages, Nominatim seulement sur Entrée.
9. ☐ Dépôt et site : LFS ou bucket pour les packs, garde de taille du site dans la CI, `check-forest` dans la CI.

---

## Critique

- ☐ **C1. Astronaute commercial dans un dépôt public.** `assets/character/README.md:1-6`,
  `assets/character/*.ktx2`, `astronaut.bin` (23,7 Mo). `gh repo view` confirme que le dépôt est PUBLIC. Les fichiers sont sur
  `origin/codex/earth-photorealistic` et `origin/codex/ground-fixes-b42a483`. Ils sont aussi copiés dans les
  builds Pages et serveur, donc téléchargeables. Le dépôt n'a pas de fichier LICENSE.
  *Correctif* : réécrire l'historique des deux branches distantes avant tout merge, servir le modèle depuis un
  stockage privé (secret CI) ou un sous-module privé, et vérifier ce que la licence achetée permet de servir.

## Rendu GPU et sol

### Haute
- ☐ **R-H1. Ombre du vaisseau sur le sol de la sonde de lumière lue en un point périmé.**
  `trace.wgsl:6055` (`Eg *= shipShadow(EARTH_SHADOW_POINT)`), `:5899`, `:6585` (seule affectation, dans
  `earthNear`). Quand `earthGround` est atteint par `earthLook` (entrée env/sonde `:7740`, corps lointain `:1255`), le
  point vaut zéro, c'est-à-dire la caméra. Conséquence : dans le cockpit au soleil, tout le sol de la sonde reçoit
  l'ombre de la coque à la caméra, et l'ambiance du vaisseau, de l'astronaute et de `characterLight()` devient noire.
  *Correctif* : passer le point touché à `earthGround`, et sauter `shipShadow` dans l'entrée env.
- ☐ **R-H2. Reprojection temporelle coupée pour toute translation supérieure à 1 mm sous 20 km.**
  `renderer.ts:380-381, 3384-3390`. La marche fait environ 23 mm par image, et le vol bas ou le roulage davantage :
  pas d'historique, une copie pleine résolution par image, et la reprojection rigide (R4) qui suit devient du code
  mort dans le régime pour lequel elle a été écrite. `placeOnBody` utilise `M_METRES`, alors que le reste utilise
  `1476.625·massSolar`. *Correctif* : un seuil fondé sur la parallaxe du décor le plus proche, et le même facteur en mètres.
- ☐ **R-H3. `windsockShade` n'est plus retiré par `HAS_RWY`.** `trace.wgsl:6506` : `main` avait
  `if (HAS_RWY && WS.w > 0.5)` (vérifié). Toutes les variantes Terre portent donc `wxVeil`, `sunThrough`, la feuille
  et `sceneryShadow`. *Correctif* : `if ((HAS_RWY || HAS_SCENERY) && WS.w > 0.5)`.

### Moyenne
- ☐ **R-M1.** `waterMirror` et le calme (`trace.wgsl:6108-6110`, `:5521`) ne disparaissent que si le compilateur
  plie `0·x`, ce qui demande fast-math : sinon il reste une marche de 64 pas, une bissection, 3 `earthHeight` et
  `sceneryMirror`. `seaShade` évalue aussi un `gnoise` par pixel de mer même quand le calme vaut 0. *Correctif* : `HAS_SCENERY &&`.
- ☐ **R-M2.** `sceneryShadow` (`trace.wgsl:5783, 4781, 6054`) lance des rayons d'ombre pour les faces tournées
  dos au Soleil : parcours du BVH plus `forestQuery` jusqu'à 640 pas, pour rien. *Correctif* : sortir tôt si `dot(n,L) <= 0`.
- ☐ **R-M3.** Le cache ne garde que 2 clés de variantes (`renderer.ts:3159`), alors que les bits 4096 et 8192 changent
  en cours de jeu (`earthScenery.clear()` tous les 8 km, pages de surface, météo, pistes) : on recompile en boucle,
  plusieurs secondes à chaque fois. *Correctif* : environ 4 clés.
- ☐ **R-M4.** `timedVariant` ne journalise les compilations qu'avant la première image : celle de `|8192` est
  invisible dans les diagnostics.
- ☐ **R-M5.** `earth-tiles.ts:298-317` : l'imagerie qui arrive après les hauteurs refait un `put()` (512 Ko), puis
  `onChange` et `invalidate()`. Avec z9–13, jusqu'à 128 invalidations par remplissage de fenêtre, et une vue fixe
  qui ne finit jamais de converger pendant le chargement.

### Basse
- ☐ `earth-tiles.ts:493, 298` : écouteurs d'abandon jamais retirés (petite fuite par tuile).
- ☐ `scenery.ts:96` détruit l'ancien tampon tout de suite, alors que `clear()` attend `onSubmittedWorkDone` : incohérent.
- ☐ `earth-surface.ts` : 16 pages par région au maximum (`loadedAt`, `P.surface`, masque `valid`) sans assertion.
- ☐ `ground-stones.ts:135` : `packStones()` alloue à chaque image (`character-renderer.ts:331`). `params()` de
  `scenery.ts` et `earth-surface.ts` : un `Float32Array` par image.

### Diagnostics des items 4 et 5 de la campagne
- **Item 4 (Bourget 35 → 44 ms, surface et décor coupés).** Candidats, du plus probable au moins probable :
  1. imagerie de 3 à 8 niveaux (`trace.wgsl:4960`), qui dépend des données EOX z9–13 ;
  2. `waterMirror` et la mer (R-M1) ;
  3. `walkDistance` dans les deux boucles `earthMarch` (`:5224`, `:5242`), plus `walkNormal` ;
  4. `shipShadow` dans `earthGround` ;
  5. la manche à air (R-H3).

  À mesurer avec `trace-ab` en changeant une seule chose par passe. La référence du 11 oct. (`4c74782`) est
  extraite dans le scratchpad de la session.
- **Item 5 (environ 4 s sans image GPU quand le décor arrive).** Le bit 8192 s'allume dans l'image même où le
  décor est envoyé, ce qui lance la cascade `main`/`env`/`lut` (3 compilations d'un noyau d'environ 7 000 lignes).
  L'envoi des données (un seul `writeBuffer` de 16 Mio au plus, des vues `SceneryContact`) n'explique pas le blocage.
  *Pour confirmer* : journaliser toutes les compilations (R-M4), puis précompiler `|8192` au début de la requête du
  décor et voir si le blocage disparaît ou se déplace. *Correctif* : précompilation spéculative, et ne basculer la
  clé qu'une fois la variante prête.

## Profondeur : herbe, arbres, bâtiments (signalé le 13 oct.)

Symptôme : les troncs sont parfois transparents à l'herbe qui est derrière eux.

**Comment c'est fait (vérifié).**
- La profondeur tracée est `moments[idx].y`.
  - C'est la distance le long du rayon, en unités de M (1e9 pour le ciel).
  - Elle est à la même résolution que `hdr`.
  - Elle inclut les troncs, les houppiers et les bâtiments (`worldScenery`, `trace.wgsl:5744-5778`, requête forêt complète et non `anyHit`).
- Les passes rasterisées font le test à la main : `discard` si `moments.y·échelle < |p| − eps`.
  - astronaute : `character.wgsl:113,168`
  - herbe : `:487`
  - pierres : `:581`
  - vaisseau : `ship.wgsl:611`
  - station : `station.wgsl:147`
  - Endurance : `endurance.wgsl:84`

  Le pixel est pris au plus proche, et les deux côtés sont en mètres euclidiens : la comparaison elle-même est
  juste. Le `depth32float` ne départage que les objets rasterisés entre eux, et seule l'herbe LOD 0 y écrit.

### Haute
- ☐ **Z-P1. Profondeur périmée et jamais reprojetée en temps réel** (`trace.wgsl:7558-7568`, vérifié).
  - **Mécanisme :**
    - Un rayon par bloc de 2 à 8 px, avec un décalage tournant (`renderer.ts:4665-4690`) et une gigue gaussienne (`trace.wgsl:7507`).
    - Seul le pixel tracé écrit `moments[idx] = vec2f(0, depth)`. Les autres gardent la profondeur d'il y a 1 à b²−1 images.
    - Pendant ce temps, la couleur est reconstruite (`resolve`, `post.wgsl:163-191`) puis reprojetée (`temporal`).
    - Le passage rasterisé est encodé juste après `encodeTemporal` (`renderer.ts:3652-3654`) : il a la couleur à jour, mais la profondeur périmée.
    - `post.wgsl:613-629` le reconnaît et prend la plus proche des profondeurs fraîches, mais seulement pour sa propre reprojection.
  - **Effet :** en tournant ou en marchant, les pixels que le tronc vient de couvrir gardent la profondeur du sol ou
    du ciel qui était derrière. Une herbe à 14 m devant un sol à 25 m passe le test et se dessine sur le tronc. Le défaut
    est pire avec un bloc de 3–4 et un lacet rapide, et disparaît à l'arrêt : d'où le « parfois ». Même chose sur le
    bord des bâtiments, et pour les pierres, le vaisseau, la station et Endurance.
- ☐ **Z-P2. Image fixe : la profondeur est une moyenne** (`trace.wgsl:7575`,
  `mix(m.y, tr.depth, 1/na)`). Au bord d'un tronc qui se découpe sur le ciel, la moyenne part vers ~5e8 : il reste
  une frange de 1–2 px où l'herbe passe, même caméra immobile.

### Basse
- ☐ La gigue fait alterner les pixels de bord entre la profondeur du tronc et celle du sol, alors que la couleur
  est mélangée : les bords des troncs scintillent.
- ☐ L'herbe des LOD > 0 n'écrit pas dans le `depth32float` (`character-renderer.ts:126, 737-745`), ce qui peut poser
  problème entre les brins et l'astronaute ou les pierres.

**Pour confirmer, sans changer le code :**
1. `realtimeSubsampling: 1` et `temporalBlend: 1` : la transparence doit disparaître en tournant devant un tronc. Avec 4, elle doit empirer.
2. Capture de `moments.y` et de `stamps` sur une ligne qui traverse un tronc à 10–20 m pendant un lacet lent : les
   pixels dont le `stamp` est ancien doivent montrer une profondeur lointaine alors que la couleur est de l'écorce.

**Correctif proposé (non appliqué).**
1. Une profondeur d'occlusion `sceneDepth` à pleine résolution, écrite à chaque image après `temporal`.
   - Pixel frais : sa propre profondeur.
   - Sinon : le **minimum** des échantillons frais du voisinage 3×3, à l'espacement du bloc. C'est la boucle `dn` de
     `post.wgsl:621-629`, à exécuter toujours.
2. En convergence, garder le minimum (l'échantillon opaque le plus proche) au lieu de la moyenne.
3. Lier `sceneDepth` à toutes les passes rasterisées, à la place de `moments.y`, qui reste pour la profondeur de champ.

Coût : l'herbe peut disparaître sur un bloc de large au bord des troncs, ce qui se voit beaucoup moins.
Solution provisoire : un minimum 3×3 dans `grassFs`/`stoneFs`.

## Ancrage : positions et ombres par rapport à la caméra (demande du 13 oct.)

Règle demandée : la position des objets 3D et le calcul de leurs ombres partent de la **caméra**, pas du vaisseau ni
du personnage.

Contexte vérifié :
- En mode vaisseau, `renderer.ts:2116-2121` déplace `near.centre` de l'œil de montage : le terrain est tracé depuis l'œil.
- `main.ts:4810-4811` envoie `renderer.shipFocus` = le vaisseau dès que `camera.piloting` est vrai, y compris en
  spectateur, qui garde `piloting` (`spectator.ts:71-74`).
- La précision n'est pas en cause : `nearCam` est en float64 découpé, le décor en float32 dans un repère local
  (±8 km, ~1 mm), et l'herbe et l'astronaute sont relatifs à la caméra.

| Endroit | Ce qui est ancré | Ancre | Verdict |
|---|---|---|---|
| `renderer.ts:2455-2464` | tuiles : fenêtre, `zNeed`, priorité | vaisseau si sous 60 km et pas à pied, sinon caméra | ✗ |
| `renderer.ts:2465-2471` | surface régionale : seuils de 20/30 km, ordre des pages | vaisseau si sous 30 km | ✗ |
| `renderer.ts:2472-2478`, `scenery.ts:117-124, 257-264` | centre du décor, seuil de 12 km, **origine des rayons `P.scenery[3]`** | vaisseau (`surfaceFocus`, vérifié) | ✗✗ |
| `trace.wgsl:5741-5794` | portée du décor (2,5/3,5 km), houppiers sculptés à 220 m, portée des ombres 1,2/2 km, `SC_DISTANCE` | `P.scenery[3]` | ✗ si c'est le vaisseau |
| `renderer.ts:2489-2502` | patch de marche `TABLE_WALK` (écart œil − origine) | personnage, relatif à la caméra | ✓ |
| `renderer.ts:2169`, `ship.ts:1029-1067` | sphère de la carte d'ombre du vaisseau | ce qui projette, relatif à la caméra | ✓ |
| `renderer.ts:3962-3977` | autres engins qui projettent une ombre | caméra | ✓ |
| `renderer.ts:2836-2868` | sonde de lumière | caméra | ✓ (lumière de la caméra appliquée au loin, mineur) |
| `character.wgsl:76-78` | carte d'ombre solaire de l'astronaute (±3,5 m) | l'astronaute (celui qui projette) | ✓ |
| `character-renderer.ts:395-411` | herbe allumée ou non (`ours`, hauteur > 2 m) | personnage | ✗ |
| `character-renderer.ts:417, 450, 489`, `character.wgsl:343, 386` | grille du sol, réseau des brins, coupe et fondu à 30 m | personnage | ✗ |
| `character.wgsl:345, 429` | éclaircie, largeur, LOD des brins | caméra | ✓ |
| `character-renderer.ts:498`, `character.wgsl:312-316` | grille d'ombrage de l'herbe (64 m) | personnage | ✗ |
| `character-renderer.ts:502`, `character.wgsl:540` | réseau et coupe des pierres | personnage | ✗ |
| `renderer.ts:3868-3873` | l'herbe et les pierres existent-elles ? | seulement avec un marcheur actif | ✗ |
| `character.wgsl:323, 398-403` | empreintes, herbe foulée | personnage | ✓ (c'est lui qui agit) |
| `renderer.ts:2401, 2440` | observateur des éclipses et des ombres de corps | caméra | ✓ |

### Haute
- ☐ **Z-V1. Le décor (arbres, bâtiments) et ses ombres sont tracés depuis le centre du vaisseau.** Vérifié :
  `earthScenery.update(surfaceFocus, …)` avec `surfaceFocus = F.c` sous 30 km, puis
  `scenery.params()` calcule `cam` (l'origine du rayon dans `worldScenery`) à partir de cette position. Le terrain,
  lui, part de l'œil.
  - **Vues du vaisseau :** arbres et bâtiments décalés par rapport au sol de l'écart de montage : environ 3,6 m
    dans le cockpit, 14 m en poursuite, 42 m en vue libre ou réalisateur, des kilomètres en passage ou en plan
    réalisateur. Leurs ombres sur le terrain (`SC_POINT = o + d·tMax`) tombent au mauvais endroit et glissent avec la vue.
  - **Spectateur à 2 km d'un vaisseau en vol bas :** décor décalé de 2 km, objets fantômes ou manquants, ombres fausses.
  - **Correctif :** `P.scenery[3]` vient toujours de la position de caméra du traceur (le `near.centre` déjà corrigé
    de l'œil, l'expression `onEarth` de `renderer.ts:2460`). Le vaisseau ne sert plus que d'indice de préchargement.
- ☐ **Z-V2. Le streaming et les seuils suivent le vaisseau.**
  - Spectateur au sol, vaisseau à 13 km : le décor est vidé (seuil de 12 km).
  - Vaisseau entre 20 et 30 km : la surface régionale est retirée.
  - Plan réalisateur pris du sol : `zNeed` est calculé pour l'altitude du vaisseau, donc le premier plan est grossier.
  - Spectateur parti à 30 km : la fenêtre fine reste sous le vaisseau.
  - Vaisseau posé, spectateur monté à 15 km : le décor reste chargé.

  **Correctif :** `focus` et `surfaceFocus` = la caméra (l'œil). Le vaisseau devient un second point de
  préchargement s'il est à quelques km. Pas de `shipFocus` quand `camera.spectating`. L'avance de streaming se
  calcule sur la vitesse de la caméra.
- ☐ **Z-V3. L'herbe et les pierres appartiennent au marcheur.**
  - Caméra libre, trépied ou photo au sol sans marcheur : aucune herbe, aucune pierre.
  - À pied, télescope (Y) sur un champ à 200 m : pas de brins (coupés à 30 m du marcheur).
  - Saut ou jetpack à plus de 2 m : l'herbe disparaît (`reason "above-ground"`) alors que la caméra est au sol.

  **Correctif :** séparer le « sol vivant » du personnage. Centrer `GrassGround.build`, le réseau des brins (`set(4)`),
  la grille d'ombrage (`set(12)`), les pierres (`set(16)`) et la coupe (`fromWalker`, `stonesGrow`) sur le point
  du sol sous la caméra. Tester la hauteur de la caméra au-dessus du sol. Garder le marcheur pour les empreintes et
  l'herbe foulée. Agrandir la portée selon la taille du pixel au télescope.

### Basse
- ☐ **Z-V4.** La grille d'ombrage de l'herbe (64 m) doit suivre la caméra en même temps que Z-V3.
- ☐ **Z-V5.** La sonde de lumière est à la caméra. Un vaisseau éclairé jusqu'à 20 km (`shipInView`), ou un
  astronaute vu de loin sous les arbres, reçoit donc le ciel de la caméra. C'est acceptable. Option : ciel
  analytique au-delà de quelques centaines de mètres.

**Correct tel quel :** les cartes d'ombre centrées sur ce qui projette l'ombre (vaisseau, astronaute) mais
exprimées par rapport à la caméra, les empreintes, le patch de marche, et l'observateur des éclipses.

## Piéton, caméra, contrôleurs

### Haute
- ☐ **P-H1. Passer du piéton à la caméra libre (F3) coupe vers une vue « suivi du vaisseau » périmée.**
  `character.ts:184-195, 441-450`, `spectator.ts:90-97, 189-201`, `main.ts:3016-3018`. `prepare` lance
  `startSpectator()`, qui fixe `specOff` sur l'œil du vaisseau et démarre `specGlide` à t=0 ; ils n'avancent jamais
  pendant la marche, puis `stop({keepView})` les réutilise. `walkHere` a le même problème. *Correctif* : remettre à zéro
  `spectatorFollow` et `specGlide` dans `stop({keepView})`.
- ☐ **P-H2. Vue réalisateur : le placement et le chargement orientent le vaisseau d'après un plan périmé.**
  `piloting.ts:207-214` (`rigidMount`), `:546` (`mountTarget` renvoie `cineOut`). `placeAt` (`game/tools.ts:224`) et
  le chargement (`tools.ts:623-635` puis `settleMount`) en dépendent, alors que la sauvegarde ne garde pas le plan.
  Résultat : un vaisseau rechargé de quelques dizaines à 180° de travers. *Correctif* : `cine.reset()` dans
  `rigidMount`, et une relation fixe (ou l'attitude enregistrée) pour la vue réalisateur.
- ☐ **P-H3. Restauration à pied impossible sur un toit, un pont, un pont de navire ou le vaisseau.**
  `character.ts:766-783` → `prepare` `:167-179` projette sur le sol sous le point, d'où « sortie bloquée » ou « dans
  l'eau ». De plus `grounded = |height()| < 0.1` (`:776`) ignore les ponts, ce qui déclenche un faux atterrissage et un
  à-coup. *Correctif* : un mode restauration qui teste la capsule au point enregistré, et `standing()`.

### Moyenne
- ☐ **P-M4.** En pause en vue réalisateur (`cine.ts:116-120`, `brain.ts:221-223, 283`, `follow.ts:332-338`), avec
  dt=0 les ressorts sautent et la direction retombe sur le nez : la caméra saute. *Correctif* : renvoyer la dernière pose.
- ☐ **P-M5.** Les plans du réalisateur n'ont aucune garde au sol (`brain.ts:295-306`) : en montée raide, l'œil de la
  poursuite passe sous terre au décollage. *Correctif* : borner avec l'AGL.
- ☐ **P-M6.** Coût de la caméra à pied hors de la Terre : 32 échantillons × `height()`, soit `planetFrame` (avec
  allocation) sur les mondes de Gargantua, plus `contact().at` ; `integrate` recalcule `planetFrame` à chaque
  sous-pas à 120 Hz (`character.ts:679-689, 588-591, 127-131`).
- ☐ **P-M7.** `lens.ts` : un `travel` en cours n'est pas effacé quand on prend les commandes, il reprend plus tard et saute.

### Basse
- ☐ `character.stop()` lâche le spectateur même quand personne ne marche (`newFlight`, `piloting.ts:152`).
- ☐ Les jambes marchent contre un mur : la phase avance avec la vitesse demandée (`character.ts:650`).
- ☐ Travail en double à chaque image : `rigPlace` appelé deux fois sur Gargantua (`:702`, `:712`), les réglages
  copiés deux fois (`spectator.ts:133-137`), `accessDistance()` à chaque image (`main.ts:3129`),
  `freeCameraKeys()` (`bindings.ts:126`).
- ☐ Tests de coque incohérents : les points d'accès utilisent la boîte (`capsuleInHull`, `:288`), la marche le BVH,
  ce qui place la trappe au bout de l'aile sous le ventre du Ranger.
- ☐ La restauration force `animate=true` et le temps réel (`:217-218`).
- ☐ Duplications : axes du vaisseau calculés à 3 endroits, vitesse sol en double. Code mort : `CineBrain.next()`.
  Commentaire orphelin : `brain.ts:155`.

## UI et modes

### Haute
- ☐ **U-H1. Les panneaux supposent une barre du haut sur une seule ligne.** `style.css:2568` (`tb-wrap`, hauteur
  auto, z 30). Les positions sont fixes à 56–66 px : `.fl-target`/`.fl-tel` (1113, 1123), `#hud` (2290), `cam-pop`/`sky-pop`
  (2082, 2414), `.sp-toasts` (2143), onglets de carte (2647-2655), `.fh-compass` (2775), `character-hud` (2769).
  Vers 900 px de large ou en français, la barre passe sur 2 ou 3 lignes et les recouvre. *Correctif* : `fit()` écrit
  `--tb-bottom` et les positions utilisent `calc(var(--tb-bottom) + 8px)`.

### Moyenne
- ☐ **U-M2.** `skyevents.ts:121-126, 170-189` : le calcul n'est jamais annulé, deux balayages ISS de 3 jours
  tournent en parallèle, et l'ancien écrase `this.last`, que TARS lit avec `take()`.
- ☐ **U-M3.** `livecapture.ts:122-157` : une exception dans `at()`/`grab()` laisse le panneau sur « LIVE »
  avec un Stop inopérant, sans Fermer, et le `VideoWriter` n'est jamais fermé. Rien n'empêche non plus de lancer en
  même temps une vidéo du dialogue de rendu ou un rendu hors ligne (`exportRGBA` partagé).
- ☐ **U-M4.** Infos à pied affichées 3 fois (`characterhud.ts:65-70`, `foothud.ts:185-195`, contexte de la barre
  `main.ts:3115-3122`, avec 4 ou 5 décimales selon l'endroit). Deux systèmes de traduction coexistent : `tr({fr,en})` en ligne
  (characterhud, atlas, skyevents, hors de `tests/i18n.test.ts`) et `t()`.
- ☐ **U-M5.** Touches à pied (`keymap.ts:430, 466-480`, vérifié) : Espace saute au lieu de mettre en pause, alors que
  l'infobulle (`transport.ts:70`) dit « tous les modes ». V/C/Y (vue, viser, télescope) ne sont pas dans la
  liste autorisée, contrairement à la règle « dans tous les modes ». À confirmer en jeu.

### Basse
- ☐ L'Atlas ne se ferme pas avec F8 (`atlas.ts:204`, le focus dans le champ fait ignorer la touche par `isTyping`).
- ☐ L'Atlas reste bloqué sur « Recherche… » sous 3 caractères ou sur la Lune (`atlas.ts:271-287`).
- ☐ La barre est remesurée toutes les 500 ms même sans changement, avec jusqu'à 3 mises en page forcées
  (`main.ts:5006`, `topbar.ts:339-385`). *Correctif* : un `ResizeObserver`.
- ☐ La vue HUD « bare » met encore à jour des panneaux cachés (`flighthud.ts:1797`).
- ☐ Le raster 512² de `LocalGroundMap` est construit deux fois (`foothud.ts:92` et le HUD de vol).
- ☐ `aria-label` est copié une seule fois depuis `data-tip` (`main.ts:5547`), puis n'est plus à jour.
- ☐ `renderdialog.ts` (`runVideo`) : `const tf` masque l'import `tf()`.
- ☐ `scenery-hitboxes.ts:58-92` alloue beaucoup à 30 Hz.

## Musique et audio

### Haute
- ☐ **A-H1. Rattrapage en rafale** (`music/engine.ts:242`, vérifié : aucun saut). Son coupé : `Music.update` sort
  avant `pump`, mais le contexte audio tourne toujours (`music.ts:117-119, 151-152`, gain à 0 seulement). Au retour du
  son, environ 150 mesures sont programmées d'un coup, avec des notes dans le passé : gel et grappe de notes très
  forte. Même chose, en plus petit, après une pause de plus de 0,4 s. *Correctif* : sauter les mesures entières
  en retard, et arrêter la piste quand `ensure()` vaut null.

### Moyenne
- ☐ **A-M2.** `engine.ts:221-228` : `cancelScheduledValues(at futur)` efface la montée d'entrée, ce qui donne un silence puis
  un « pop ». *Correctif* : `cancelAndHoldAtTime`.
- ☐ **A-M3.** `score.ts:62-68` : les moments n'ont pas d'hystérésis (passage bas à 400 m et 140 m/s, plasma, finale). Le
  thème bascule sans cesse, et chaque bascule construit une piste complète.
- ☐ **A-M4.** `instruments.ts:407-421, 452-478, 496-530` : les tampons de notes sont synthétisés sur le thread principal
  dans la frame (10 à 30 ms pour une note grave de piano), et le cache n'est jamais vidé (60 à 100 Mo).

### Basse
- ☐ Délai partagé réaccordé brutalement (`engine.ts:215-217`).
- ☐ Code mort : `MusicEngine.solo`, `Music.skip`, `MOMENT_LIST`. Le solo du panneau écrase les sourdines de
  l'utilisateur (`musicpanel.ts:310-314`).
- ☐ Identifiants de thème enregistrés non vérifiés (`music.ts:85-91`).
- ☐ Allocations par image quand le panneau est ouvert (`engine.ts:314, 178`, `musicpanel.ts:489`).
- ☐ **Droits** : aucune mélodie connue n'est transcrite (vérifié contre Star Wars, la Marche impériale, Jurassic Park,
  E.T. et Interstellar). L'interface affiche « D'après {œuvre réelle} » (`musicpanel.ts:265-266, 449`) : à garder en
  commentaire seulement.

## TARS, données, réglages

### Moyenne
- ☐ **T-M1.** Les nouveaux téléportages de TARS sautent la sauvegarde « Avant TARS » : `game-tools.ts:1425` (atlas
  go), `:1451` (sky_events go), `:505` (character start), `:1381` (set_mode foot), `main.ts:3563` (`atlasGo`). Or
  l'en-tête (ligne 12) le promet.
- ☐ **T-M2.** Nominatim sert de repli à la recherche pendant la frappe (`geocode.ts:145`, `atlas.ts:285-305`), ce
  que la politique d'usage d'OSMF interdit. À n'utiliser que sur Entrée ou depuis TARS.
- ☐ **T-M3.** `sceneryHitboxes: true` par défaut (`settings.ts:617`, vérifié) : des contours roses de
  diagnostic pour tous les joueurs à pied.

### Basse
- ☐ Le géocodeur met aussi les échecs en cache pour toute la session (`geocode.ts:156`, vérifié).
- ☐ La limite d'une requête par seconde n'est pas atomique (`geocode.ts:121-124`).
- ☐ Outil `character` (`game-tools.ts:478-524`) : pas d'`act()`, pas d'enum pour `body`, `start` vaut 0°/0° (la mer)
  par défaut, et `orbit` remet `yaw` à 0.
- ☐ Les descriptions des outils sont en retard sur leurs enums (`schedule`, `get_telemetry`).
- ☐ Une sauvegarde est refusée en entier si `character` est mal formé (`save.ts:156-170`).
- ☐ L'imagerie EOX s2cloudless 2021 est sous CC BY-NC-SA (`earth-tiles.ts:50`) : créditée, mais l'usage non commercial
  et le partage à l'identique contraignent. La couche 2016 est sous CC BY.

**Vérifié bon** : `/earth-surface` dans server.ts (regex stricte), pas de SSRF, clés côté serveur, traductions FR
de `t()` complètes, déclencheurs branchés, environ 100 POI contrôlés, décalages horaires des paysages corrects.

## Tests, scripts, docs, dépôt

### Haute
- ☐ **D-H1. 64 Mo de binaires sans LFS** : `assets/earth-surface/v1` 31,9 Mo, `assets/character` 23,7 Mo,
  `docs/img` 6,8 Mo, `docs/perf` 1,0 Mo ; 96 Mo dans l'historique. Les packs sont adressés par contenu, donc
  chaque reconstruction ajoute environ 16 Mo. *Correctif* : LFS, ou une release/un bucket récupéré par
  `build-pages.ts` d'après les hashes de `manifest.json`.
- ☐ **D-H2. Site Pages proche de sa limite d'1 Go** (`pages.yml:166-168` dit « ~2 × 370 Mo », `_site` mesure déjà
  395 Mo au 11 oct.). Avec les packs et l'astronaute, on arrive à environ 900 Mo, et la prochaine région fera
  échouer le déploiement. *Correctif* : une garde `du` dans la CI, ou des assets partagés entre `/` et `/test/`.

### Moyenne
- ☐ **D-M1.** `earth-surface.e2e` « comparable GPU timings » n'affirme rien sur les temps (il ne fait qu'enregistrer)
  et ne pouvait donc pas attraper la régression de 35 à 44 ms.
- ☐ **D-M2.** `ground-details.e2e:38` : l'A/B de l'occulteur passe même quand `correct === missing`.
- ☐ **D-M3.** `scripts/check-forest.ts` (WGSL contre TS au bit près) n'est ni dans la CI ni dans `check`.
- ☐ **D-M4.** character-aaa « devant le vaisseau posé » est rouge (refonte en contre-plongée en cours).
- ☐ **D-M5.** `tests/score.test.ts:43-48` a perdu les bornes de hauteur et de niveau des notes.

### Basse
- ☐ Pas de commentaire d'en-tête : earth-surface, gargantua-ground, ground-planets, scenery-hitboxes (e2e).
- ☐ Absents de BH-API.md : `renderer.earthScenery.contact`, `renderer.streamingState.leadM`,
  `earthSurface.colorView()`, `renderer.encodeCharacter`, `characterRenderer.model`.
- ☐ Les captures `docs/img/earth-*` n'ont pas de crédit OSM/WorldCover/Sentinel-2/EOX.
- ☐ L'aperçu `pages.yml:146` lance `bun test` sans junit. `build-earth-surface.ts:5` dépend d'un Python local et
  d'un basisu non épinglé. `.pi/` n'est pas ignoré.

**Vérifié bon** : la CI couvre typecheck, biome, check-wgsl et `bun test` ; `skipIf(!E2E)` partout ; nettoyage de
headless-gpu ; aucun chemin `/Users` codé en dur ; aucun `.skip` ajouté ; les changements du harnais sont justifiés.
