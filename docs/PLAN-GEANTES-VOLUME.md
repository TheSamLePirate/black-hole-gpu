# Plan : le volume des géantes, ce qu'on reprend de vr-solar-system

Écrit le 1er novembre 2026, à partir des notes du Claude d'Alex (sessions 4p à 4t, `vr-solar-system/docs/agent/`,
origin/master `88ee5b2`) et de notre code à `f3aa71e5`. V4 et V7 sont décidés (Sam, 1er novembre : voir leurs
sections). **Fait le 1er novembre : V1, V2, V3, V4** (compte rendu : [progress/geantes-volume.md](progress/geantes-volume.md)) ;
V7 en cours ; V5, V6, V8–V10 attendent le go de Sam.

Le contexte : Alex a porté nos nuages des géantes (P11 D2–D5, le fondu `58942157`) sur Quest 3, à 72 images/s. En
chemin, son Claude a trouvé des défauts qu'on partage, et des astuces dont certaines valent chez nous. On ne garde ici
que ce qui sert notre traceur (une image par trame, pas d'historique propre au volume, WebGPU sur Mac, mini et PC).
Notre état est décrit dans [GEANTES-GAZEUSES.md](GEANTES-GAZEUSES.md) (§ 8, 9, 12, 13).

## Les phases, par ordre conseillé

| | Quoi | Pourquoi | Coût prévu | Risque |
|---|---|---|---|---|
| **V1** ✅ | L'éclair cherché une fois par image, au CPU | D4 coûte ~1,5–2 ms par pixel pour un résultat identique partout | moins 1 à 2 ms dedans | faible |
| **V2** ✅ | Le puits de l'œil éclairé | les ponts absents assombrissent encore le Soleil et le ciel dans l'œil | ~0 | faible |
| **V3** ✅ | La ligne sombre à l'horizon dans le fondu | le limbe de la surface G9 apparaît entre deux parts du volume | ~0 | faible |
| **V4** ✅ | Les ponts à leur pression (géopotentiel) | près des pôles, nos ponts sont trop hauts (0,90 au lieu de ~0,75 sur Saturne) | ~0 | moyen (CPU, panneau, tests) — **décidé : oui, portée (b)** |
| **V5** | Les sauts de l'air clair entre les ponts | des anneaux possibles d'en haut, et des pas perdus | gain probable | moyen |
| **V6** | Un bruit bleu pour la gigue du volume | l'IGN laisse des diagonales à faible nombre d'échantillons | ~0 | faible |
| **V7** | Les nuages du volume emportés par le vent | la surface coule, le volume est figé (le vaisseau dérive devant des nuages immobiles) | à mesurer (2 lectures) | élevé — **décidé : oui, (a) mesurée, vent zonal d'abord** |
| **V8** | Les orages sur le blanc de la carte | les enclumes sortent d'une carte qui n'a pas de tache dessous | 1 lecture de carte par échantillon d'orage | moyen |
| **V9** | La couleur des pôles de Saturne, du dessus au dedans | bleu-gris vu de haut, beige dedans : le fondu montre le passage | à voir | à étudier |
| **V10** | Les bruits du volume lus par la surface sous le texel de la carte | la carte est floue entre 1 000 et 250 km | quelques lectures | moyen |

### V1. L'éclair cherché une fois par image

- **Constat.** `giantFlashes` (trace.wgsl ~11180) ne dépend que de l'horloge et de la caméra : chaque pixel refait la
  même recherche (4 flux, jusqu'à 4 essais de `cloudNoise` chacun pendant un éclair), et tient `GF` en registres.
  Le jumeau CPU existe déjà : `system/giant-clouds.ts giantFlashes(m, c, rm, tc)`, égal au shader (test
  `giant-clouds.test.ts`, e2e `giant-lightning`).
- **Faire.** Le renderer appelle le jumeau une fois par image (même horloge `zamo2.z`, même caméra), garde le plus
  brillant, l'écrit dans les paramètres ; le shader ne garde que `giantFlashGlow`. Le slot : `P.wx[6]` est celui de
  l'éclair terrestre (N5), libre près d'une géante, mais derrière `HAS_WX` — vérifier la clé du noyau ; sinon un `vec4`
  libre ailleurs (voir le point du noyau dans PLAN-REFRACTION-HORIZONS, buffers pleins).
- **Mesurer avant.** Le 1,5–2 ms vient de P11 (D3 et D4 mesurés ensemble). A/B kerr-mini, Jupiter et Saturne dedans,
  de nuit avec éclairs et de jour.
- **Tests.** `giant-lightning` (le GPU retrouve l'éclair du jumeau) doit passer tel quel ; `kernel-budget`.

### V2. Le puits de l'œil éclairé

- **Constat.** Dans `giantInside`, la lumière du Soleil au-delà de la marche (`tau`, `tauM`) et celle du ciel (`tz`)
  comptent les ponts au-dessus par leur moyenne (`giantColAbove × cover`), sans l'œil. Dans le puits, où `giantSigma`
  ne met aucun nuage (`cv × eye.x`), ces ponts absents assombrissent encore tout. Déjà noté en § 13 et dans notre note
  du 31 octobre.
- **Faire.** Multiplier la moyenne de chaque pont par `giantEye(m, q).x` au point où la colonne le traverse (vers le
  Soleil : le point de lecture ; pour le ciel : le point lui-même). Un `acos` de plus par échantillon.
- **Contrôle.** Les vues D2 de l'œil de Saturne avant et après ; le mur ne doit pas s'éclairer à tort du côté du Soleil
  (le piège signalé par Alex : la paroi tournée vers le Soleil éclaire le puits).

### V3. La ligne sombre à l'horizon

- **Constat.** Dans `giantInsideW`, un rayon qui passe au-dessus de l'horizon du pont prend la part 1 (d = la hauteur de
  la caméra), son voisin juste dessous rencontre le pont au-delà de `GI_FAR` et prend 0 : entre les deux, le limbe de la
  surface G9 (`otherGround`) fait une ligne sombre (`free-camera.jpg`, 4e et 5e vignettes). Alex a vu la même, bleutée.
- **Faire.** Comme lui : tant que la caméra est à moins de ~50 km au-dessus du sommet du pont, la part revient vers 1
  à l'approche de l'horizon du pont (`H = √(2 R h)`, entière au-delà de 0,95 H). Vérifier que la marche (1 500 km) va
  bien jusque-là à ces hauteurs.
- **Contrôle.** Refaire les vignettes de `scripts/giant-free-video.ts` à 30, 50, 100 km.

### V4. Les ponts à leur pression

- **Constat.** `giantLayer` donne des hauteurs prises dans l'espace aplati : au pôle de Saturne les ponts sont à 0,902
  de leur hauteur équatoriale. Un pont suit une pression, et l'écart entre deux pressions va en 1/g : ~0,75 au pôle de
  Saturne, ~0,86 à celui de Jupiter. Alex l'a adopté (Somigliana entre g_eq et g_pôle, J2 de Juno et Cassini).
- **Décidé par Sam (1er novembre) : oui, portée (b), la formule d'Alex.**
  - **La formule** : celle d'Alex, pour que nos deux projets restent comparables. Le facteur `s(φ) = g_eq / g(φ)`, où
    g(φ) est la gravité normale de Somigliana entre g_eq et g_pôle, avec le J2 de Juno (Jupiter) et de Cassini
    (Saturne). Une hauteur au-dessus de 1 bar devient `h_réelle = s(φ) · h_équatoriale`, φ la latitude du point.
    Valeurs attendues aux pôles : ~0,75 pour Saturne, ~0,86 pour Jupiter (contre 0,902 et ~0,935 aujourd'hui).
  - **La portée (b) : tout ce qui se mesure en hauteur au-dessus de 1 bar.**
    - Le shader : les ponts (`giantLayer`), les brumes (`giantHazeCol`, la brume stratosphérique à +45 km), les orages
      (leur colonne, leur enclume à +25 km), le mur de l'œil, la hauteur d'échelle de l'air dans la marche, le sommet
      du pont dans le fondu (`giantDeckTop`, `giantInsideW`, `giantInsideOn`) et la coquille du volume (`hTop`, `hBot`).
    - Le jumeau CPU (`giant-clouds.ts` : `GIANT_LAYERS`, `giantTop`, `giantDeckAt`, `giantDaylight`, les éclairs).
    - Le profil de l'air (`aero.ts`, `GIANT_AIR`) : la pression, la température et la densité lues à `h / s(φ)`. Ainsi
      le panneau AIR, les annonces (chaque pont, 1, 10, 22 bar), la chaleur de l'entrée et l'écrasement restent cohérents
      avec les nuages à toutes les latitudes.
    - La caméra libre (`rig.ts giantTop`), le stationnaire (`hoverOver`).
  - **Ce qui ne bouge pas** : la surface de 1 bar (l'ellipsoïde de P10), le plancher (`deepShare`, `deepFloorR`), la
    surface vue de haut (G9).
- **Contrôle.**
  - Unitaires : `giant-clouds.test.ts` (le jumeau égal au shader, à plusieurs latitudes dont les pôles),
    `aero-giants.test.ts` (l'équateur inchangé ; aux pôles, chaque pont à la même pression qu'à l'équateur). Un test
    de `s(φ)` contre les valeurs d'Alex.
  - e2e : `giant-descent`, `giant-poles`, `giant-lightning`, `giant-free-camera`.
  - Images : les quatre vues D2 avant/après (l'œil de Saturne descend). Les légendes de D2 changent (« 28 km » au pôle
    de Saturne) ; GEANTES-GAZEUSES.md (§ 8, § 13) à mettre à jour.
  - Coût : ~0 attendu (un facteur par échantillon) ; A/B kerr-mini dedans pour le vérifier.

### V5. Les sauts de l'air clair

- **Constat.** D'en haut, la marche avance de 6 % de la distance dans le clair : à 300 km, des pas de ~18 km pour un pont
  de ~10 km d'épaisseur. Chez Alex, cela faisait des anneaux « touché / manqué » autour du nadir. Chez nous, pas encore
  vu : le chercher d'abord dans une descente (`giant-free-video.ts`, 300 → 30 km).
- **Faire, si on les voit.** Pas besoin d'une grille comme la sienne : les ponts ont un profil connu. Hors de toute bande
  (`prof < 0,02` pour les trois, hors orage et mur), sauter jusqu'à l'entrée de la bande suivante le long du rayon,
  l'air du saut intégré comme celui de l'échantillon. Ses autres conseils de marche, de la même famille : allonger les
  pas du clair pour atteindre la distance maximale, plafonner un saut à 3 km de hauteur au-dessus de l'œil.

### V6. Un bruit bleu pour la gigue du volume

- **Constat.** Notre `RND` est l'IGN de Jimenez décalé du nombre d'or à chaque image (trace.wgsl ~12464). Chez Alex,
  il faisait des hachures diagonales ; chez nous, une image par trame, elles peuvent se voir au grain fort (nuit, éclair).
- **Faire.** Une texture 128² de bruit bleu (void-and-cluster, faite par un script à nous), lue au pixel, décalée du
  nombre d'or par image ; d'abord pour la marche du volume seule. A/B visuel à faible exposition.

### V7. Les nuages du volume emportés par le vent (le plus gros)

- **Constat.** `giantSigma` lit le bruit à une place fixe : dedans, rien ne bouge (ni vent zonal, ni tourbillons), alors
  que la surface coule (G1, G8) et que le vaisseau dérive avec le vent (`giantWindAt`).
- **Décidé par Sam (1er novembre) : oui.**
  - **La méthode : (a), deux phases fondues, mesurée.** Comme la surface (`giantFlow`) : deux lectures du bruit, chacune
    décalée en longitude par le vent de sa latitude sur l'âge de sa phase, fondues sur le cycle de 10 h (`GIANT_CYCLE`).
    Rien ne saute, mais les lectures du bruit doublent.
  - **Si (a) est trop cher, on passe à (b)** : une seule phase, remise à zéro toutes les quelques heures du jeu, le saut
    caché autant que possible. Le seuil « trop cher » à fixer à la mesure : au plus le budget de la Terre en vol bas
    sur le mini (aujourd'hui 25 ms dedans en jeu, la Terre 30).
  - **(c) est écarté** : un décalage cumulé sans fin étire le bruit en filaments de plus en plus fins (le cisaillement
    entre latitudes).
  - **Ce qui bouge : le vent zonal d'abord.** Les tourbillons nommés (la Grande Tache, l'Ovale BA, le cyclone polaire de
    Saturne et la spirale du mur de l'œil) dans un second temps, en phase V7b.
  - **Le temps accéléré : la même règle que la surface.** Le mouvement se fige au-delà de ×1 000 à ×3 000, comme la
    turbulence G8, sinon le bruit s'emmêle.
- **Faire.**
  - V7a : le décalage par le vent dans `giantSigma`, pour toutes ses lectures liées au lieu (le grand bruit, les ponts,
    les orages, l'érosion fine) ; le vent lu une fois par échantillon (`giantWind` à sa latitude). Le mur de l'œil
    garde son repère propre jusqu'à V7b.
  - Le jumeau CPU : le même décalage dans `giant-clouds.ts`, sinon les éclairs et le tonnerre ne tombent plus sur les
    orages qu'on voit.
  - V7b : les tourbillons, par le même chemin que `giantVortex` à la surface.
- **Mesurer.** A/B kerr-mini contre le commit d'avant : Jupiter et Saturne dedans (en jeu et à qualité fixe), la bande
  du fondu (250 et 100 km). Décider (a) ou (b) sur ces chiffres.
- **Contrôle.**
  - Unitaires : le jumeau égal au shader avec le vent.
  - e2e : `giant-lightning` (le GPU retrouve l'éclair du jumeau, à plusieurs heures d'écart) ; une vue dedans comparée
    à un cycle de 10 h d'écart (comme `giants-flow` pour la surface) ; le temps accéléré figé au-delà du seuil.
  - Images : un court film dedans, vaisseau dérivant avec le vent (les nuages presque immobiles) puis tenu contre lui
    (les nuages qui défilent).

### V8. Les orages sur le blanc de la carte

- La porte des orages (`big.g > 0,64`) pourrait tenir compte de la luminosité de la carte au point (les taches blanches
  réelles). Une lecture de carte par échantillon d'orage seulement. À essayer après V7 (la carte coule, le volume doit
  couler avec pour que ça tienne).

### V9. Les pôles de Saturne

- Vu de haut, la carte (Cassini 2016–2017) est bleu-grise au pôle nord ; dedans, la lumière roussie par nos brumes est
  beige. Étudier : la brume de la surface G9 dans la bande du fondu, ou la couleur `GI_TOP` du volume tirée vers la carte.
  Images d'abord, pas de code.

### V10. Le détail entre 1 000 et 250 km

- Entre ~2 000 et 300 km d'altitude, la carte reste floue (texel ~55 km) ; la tuile G8 et les tours G9 n'en comblent
  qu'une partie. Alex lit, sous le texel de la carte, les bruits du volume au sommet du pont (bancs de 80 km, enclumes,
  bourgeons de 4 km), qui modulent la couleur et penchent la normale. Avantage : quand le volume entre en fondu sous
  450 km, il continue des structures déjà visibles. À essayer après V7 (sinon la surface coule et son détail reste figé).

## Ce qu'on ne reprend pas (pour l'instant)

- **Les « puffs » (billboards de PuffySmoke)** : notre traceur n'a pas de passe de sprites, et notre marche suffit au
  détail de près. Guerrilla les a abandonnés pour les mêmes raisons (overdraw, pas d'ombres). À revoir si la caméra libre
  manque de relief de loin.
- **L'historique propre au volume** (entrelacement 4×4, compteur d'échantillons, débruitage pour les yeux) : sans objet,
  nous traçons chaque pixel. Mais son idée « le mouvement d'un historique, c'est sa parallaxe, pas sa rotation » peut
  servir à notre passe temporelle (post.wgsl `temporal`, le flou en vol bas déjà noté) : à garder en tête.
- **Les demi-précisions** : `shader-f16` n'est pas partout en WebGPU, et Alex n'y a gagné que 0,2–0,4 ms.
- **Le préchauffage des pipelines** : nous compilons déjà en asynchrone (`createComputePipelineAsync`, PLAN-LEAN-TRACER-
  KERNELS) ; rien à faire.
- **Les constantes de compilation pour le nombre de lectures** : nos comptes sont déjà des constantes.
