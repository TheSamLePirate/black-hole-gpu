# Étape 1 — visibilité raster et ombrage différé : progression

Plan : [PLAN-RENDU-RASTER-AAA.md](../../PLAN-RENDU-RASTER-AAA.md) §3, étape 1. Branche `plan-rendu-raster-aaa`.
Toutes les mesures : ce Mac (M1 Max, 32 cœurs GPU), Chrome headless, GPU Apple (Metal 3).

## 1a — la portion de terrain en visibilité primaire (`earthPipeline: "raster"`) — fait

Commits `b5c9d8d7`, `e0d6aa67`.

- Le pilote raster de Codex (portion WGS84 de niveau 2, ≈ 20 km) est dessiné avant les rayons. Le noyau `main` laisse les
  pixels qu'il couvre ; le noyau `shade` (trace.wgsl) les ombre **un par pixel** par `earthNear` : le sol retrouvé depuis
  la distance raster (deux lectures et l'affinement d'Illinois, la marche en repli), l'air, les nuages, la mer, le décor —
  sans l'intégrateur relativiste. `gatherH` laisse ces pixels hors de la reconstruction du ciel (pas de halo à l'horizon).
- Réglage `earthPipeline` (`"trace"` par défaut), schéma, français, `docs/BH-API.md` ; `terrainRasterStats.primary`.

### Mesures

**Scène nue** (Kennedy, sans tuiles réseau, ni nuages, ni surface, ni décor ; 1280 × 800 ;
`tests/e2e/raster-primary.e2e.test.ts`) — passes de rayons et image contre le tracé ×1 :

| Mode | ms | PSNR |
|---|---|---|
| tracé ×4 | 5,7–7,0 | 39,6–44,6 dB |
| tracé ×1 | 58–59 | référence |
| raster | ≈ 20 | 48,8–49,3 dB |

**En vol, détail au maximum** (F-35 en cockpit, relief et imagerie réels, surface satellite, décor `high` + `veryFar`,
ombres du décor ; 1600 × 1000 ; la même vue figée, rayons neufs à chaque image ; `tests/e2e/raster-flight.e2e.test.ts`)
— passes de rayons et image contre la même vue convergée :

| Lieu | tracé ×6 | tracé ×4 | raster |
|---|---|---|---|
| Tarifa, bas | 4,6 ms · 28,2 dB | 14,9 ms · 36,1 dB | 81,7 ms · 41,1 dB |
| Tarifa, nuageux | 4,2 ms · 37,1 dB | 11,6 ms · 39,7 dB | 58,9 ms · 39,5 dB |
| Alpes | 4,2 ms · 28,0 dB | 6,9 ms · 30,2 dB | 41,5 ms · 34,3 dB |

L'image raster est la plus proche de la convergée (les arbres un à un), sauf sous les nuages, tracés de la même façon
dans tous les modes. Mais `shade` coûte 35 à 76 ms : chaque pixel fait le travail entier d'un rayon.

**Où va le temps de `shade`** (Tarifa bas, mêmes réglages ; `tests/e2e/raster-shade-ablation.e2e.test.ts`, une partie
retirée à la fois, alternée avec la vue intacte ; base 80–103 ms, bruitée) :

| Partie retirée | gain |
|---|---|
| décor (arbres, bâtiments) | **−39 ms** |
| marche des rayons rasants (`sinG < 0,15` → marche complète) | ≈ −9 ms |
| ombres du relief | ≈ −5 ms |
| nuages | ≈ 0 |
| normale du relief | ≈ 0 (bruit) |

Le décor est le premier poste : chaque pixel parcourt la grille des arbres (DDA par blocs de cellules duales, 640 pas au
plus, couronnes sculptées par sphere tracing dans les 220 m) et l'arbre BVH des bâtiments, puis un rayon d'ombre vers le
Soleil à travers les mêmes structures (500–900 m) pour chaque récepteur à moins de 1,2–2 km.

## 1b — le décor en instances raster — fait (arbres), gain faible

### Principe : la même méthode que pour le sol

Le raster ne remplace pas la géométrie exacte du décor : il **désigne** l'objet vu par chaque pixel. Le noyau `shade`
intersecte alors exactement **ce seul objet** avec les fonctions existantes (couronne en ellipsoïde ou cône, sculptée
par le bruit, tronc ; prisme de bâtiment) et l'ombre comme aujourd'hui (`WS`, `WS_A`, `WS_T`, `SC_POINT`,
`windsockShade`). Le parcours des grilles et de l'arbre BVH disparaît du rayon primaire ; l'aspect reste celui du
traceur.

### Les pièces

1. **Instances d'arbres générées sur le GPU.** Une passe de calcul parcourt le tableau des cellules de la section forêt
   (déjà sur le GPU) dans un rayon `R` autour de la caméra, élimine par blocs 8 × 8 (bornes basse/haute déjà stockées)
   et par le champ de vision, et ajoute chaque arbre retenu à un tampon d'instances avec un compteur atomique et une
   commande de dessin indirect — le motif de l'herbe et des cailloux (`character.wgsl` `grassBlades`, `stonesGrow`).
2. **Instances de bâtiments** : une instance par géométrie (prisme du contour), ses murs et ses toits triangulés une fois
   par le worker à chaque reconstruction de la scène (≈ tous les 556 m).
3. **Proxys conservatifs** : un icosaèdre circonscrit à la couronne (gonflé pour l'englober, sculpture comprise), une
   boîte fine pour le tronc, le prisme du bâtiment. Un proxy un peu trop grand coûte un test exact manqué, jamais un
   objet perdu.
4. **Cibles** : la passe du terrain garde sa distance (le sol que l'indice attend) ; les instances sont dessinées ensuite
   contre sa profondeur (conservée) dans une cible `r32uint` d'identifiant (classe | index) et une distance d'objet
   `r32float`.
5. **`main` et `shade`** : un pixel couvert par le terrain **ou** par un objet est laissé par `main` (les silhouettes
   contre le ciel aussi) ; `shade` teste exactement l'objet désigné à partir de sa distance. Touché : ombrage du décor.
   Manqué (bord de couronne sculptée, proxy plus grand que l'objet) : le parcours actuel reprend **à partir de cette
   distance**, borné par le sol. Pixel de sol : plus aucun parcours du décor en deçà de `R` ; au-delà, le parcours actuel
   sur [`R`, sol] seulement, pour les arbres lointains.
6. **Ombres du décor** : inchangées dans 1b (rayon d'ombre tracé). Leur remplacement par des cascades d'ombres raster
   est l'étape 2 ; les instances de 1b en seront la géométrie.

### Risques connus

- Arbres sous-pixel au loin : le proxy grossi au moins à un pixel, le test exact décide ; au-delà de `R`, le parcours.
- Pieds d'arbres et bases de bâtiments calculés par le worker (Terrarium + détail), pas par le cache du raster : de
  petits écarts de contact, inchangés par 1b.
- Reflets dans l'eau (`sceneryMirror`), ombre de l'herbe, collisions : continuent de lire le tampon du décor.
- Gigue temporelle : la passe raster n'est pas décalée ; `shade` reconstruit le rayon du pixel décalé et le test exact
  tranche.

### Ce qui est livré

- `src/system/scenery-raster.ts` : la passe de calcul `cull` parcourt les cellules de la forêt (≈ 3,1 M à Tarifa en
  `high` + `veryFar`), reconstruit chaque arbre comme `forestCandidate`, élimine hors champ et range les arbres en quatre
  listes (proche/loin × couronne ronde/cône) ; quatre dessins indirects de proxys circonscrits (icosphère de 80 faces et
  tronc au proche, 20 faces au loin, pyramides pour les conifères) dans la passe du terrain, l'identifiant dans le canal g
  de la cible (`rg32float`). Disposition de liaison explicite partagée (une disposition « auto » est propre à son
  pipeline : la soumission entière était refusée, l'image noire).
- `forest.wgsl` : `forestCandidate` (le test d'un arbre, extrait de `forestQuery` sans changement de résultat),
  `forestQueryFrom` (la grille parcourue depuis une distance), `forestCandidateStart`.
- `trace.wgsl` : `worldScenery` teste l'arbre désigné seul ; manqué, la grille est parcourue **depuis cet arbre**
  (rien ne peut être devant : son proxy est le plus proche) ; pixel sans instance : aucun parcours. Vue de diagnostic
  `TUNE_RASTER_PATHS` (rouge touché, bleu manqué, vert aucun, blanc parcours ancien).
- `renderer.sceneryRasterOn` (comparaisons) ; `terrainRasterStats.scenery`. Tests : `tests/scenery-raster-mesh.test.ts`
  (chaque proxy contient sa forme), `tests/e2e/raster-paths.e2e.test.ts`, mode `rasterwalk` de `raster-flight`.

### Mesure (même passage, même vue figée — l'avion figé dès sa mise en place)

| | Tarifa bas | Alpes |
|---|---|---|
| tracé ×4 | 11,2 ms · 34,6 dB | 6,3 ms · 30,3 dB |
| raster, grille parcourue (1a) | 91,1 ms · 42,8 dB | 36,6 ms · 32,0 dB |
| raster, arbres en instances (1b) | 87,0 ms · 42,7 dB | 31,7 ms · 32,1 dB |

Image identique ; **4 à 5 ms gagnés seulement**. Le parcours de la grille n'était pas l'essentiel du coût du décor : c'est
l'**ombrage de chaque pixel d'arbre** — la couronne sculptée par sphere tracing (jusqu'à 28 pas, deux bruits par pas),
sa normale (quatre évaluations du champ), son aspect, et le rayon d'ombre (≈ 12 ms). En forêt dense vue en rasant, le
proxy le plus proche n'est souvent pas la couronne réellement touchée (les couronnes se recouvrent à l'écran) : la
diagnostic montre deux fois plus de « manqués » que de « touchés », mais le parcours depuis l'arbre désigné est court.

### Conclusion pour la suite

Réutiliser les fonctions du traceur pixel par pixel donne l'image de référence, mais à ≈ 55 ns par pixel avec le
détail maximal : dix fois le budget d'un rendu à 60 images/s. Le gain viendra de **matériaux et formes pensés pour le
raster** plutôt que de la visibilité seule : couronnes sculptées en géométrie (le même champ `forestCarve` appliqué aux
sommets) pour supprimer le sphere tracing, ombres en cartes (étape 2), ombrage simplifié des surfaces lointaines.
