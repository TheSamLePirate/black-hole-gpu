# Le volume des géantes — ce qu'on a repris de vr-solar-system

1er novembre 2026. Plan : [PLAN-GEANTES-VOLUME.md](../PLAN-GEANTES-VOLUME.md). Les idées viennent des sessions 4p à 4t du
Claude d'Alex (`vr-solar-system/docs/agent/`). Les images sont des vues fixes hors ligne (960 × 600, 16 échantillons par
pixel), prises sur ce Mac ; les temps sont mesurés sur kerr-mini (`planets-ab`, qualité fixe, A B B A deux fois).

## V1 — l'éclair cherché une fois par image (`b614ad5a`)

- **Avant** : chaque pixel refaisait la même recherche (`giantFlashes` : 4 flux, jusqu'à 16 lectures du bruit pendant un
  éclair) et gardait le résultat en registres.
- **Maintenant** : le renderer appelle le jumeau CPU (`system/giant-clouds.ts giantFlashes`) une fois par image et passe
  l'éclair le plus brillant au shader dans `P.wx[6]` (la place de l'éclair terrestre, vide près d'une géante). Le shader
  ne garde que la lueur (`giantFlashGlow`).
- **Coût** : Jupiter dedans 40,3 → 39,4 ms (−2 %), Saturne dedans 39,7 → 38,4 ms (−3 %), de jour. Moins que les
  1,5–2 ms attendus : ce chiffre de P11 mesurait D3 et D4 ensemble.
- **Test** : `giant-lightning` passe sur le mini (le GPU dessine les éclairs là où le jumeau les trouve).

## V2 — le puits de l'œil éclairé (`14e012df`)

![Dans l'œil de Saturne, à 25 et 60 km sous 1 bar : avant | après](geantes-volume/v2.jpg)

- **Avant** : la lumière du Soleil au-delà de la marche et celle du ciel comptaient les ponts au-dessus d'un point par
  leur part moyenne, sans l'œil. Dans le puits, ces ponts absents assombrissaient encore tout.
- **Maintenant** : la part de chaque pont est celle de l'œil là où la colonne vers le Soleil le traverse, et celle du
  ciel au point même. Seulement près du pôle nord (la caméra à moins de ~10°).
- **Effet** : le puits est 2 à 3 % plus clair ; l'exposition automatique en reprend l'essentiel.
- **Coût** : nul. Une première version, avec `giantEye` entier (trois `acos` par échantillon), coûtait +4 % dans l'œil ;
  `giantEyeX` prend l'angle au pôle par son sinus.
- **Reste** : les stries sombres au fond du puits (les ombres des stries du mur, lues en un point) ; pas touchées ici.

## V3 — plus de ligne à l'horizon du pont (`b2037fb3`)

![L'horizon au-dessus du pont : Jupiter à 30, 50 et 100 km au-dessus, Saturne à 50 km — avant | après](geantes-volume/v3.jpg)

- **La cause** : au-dessus du pont, un rayon qui touchait le pont au-delà de 450 km prenait la surface G9. S'il passait
  au-dessus du niveau de 1 bar, il y voyait le limbe de l'air de G9 : une ligne bleutée entre le ciel du volume et son
  pont.
- **La correction d'Alex** (la part revient au volume près de l'horizon du pont, sous ~50 km) **ne suffisait pas** : les
  rayons concernés commencent bien avant 0,75 de l'horizon.
- **Maintenant** : un rayon dont le point tangent passe au-dessus de 1 bar prend la part du ciel (celle de la hauteur de
  la caméra), et la marche du volume va jusqu'à l'horizon du pont.
- **Effet** : la ligne disparaît à 30 et 50 km ; à 100 km le limbe bleu aussi, il reste la bande brune de la brume du
  volume.
- **Coût** : nul dedans (mesuré avec V2).

## V4 — les ponts à leur pression

![Saturne dans l'œil à 25 et 60 km sous 1 bar, puis à 70° N à 30 km sous 1 bar — V3 | V4](geantes-volume/v4.jpg)

- **La règle** (décidée par Sam, la formule d'Alex) : un pont suit une pression, et l'écart entre deux pressions va en
  1/g. Toute hauteur que fixe l'air est celle de l'équateur × s(φ) = g_éq / g(φ), g la gravité normale de Somigliana sur
  l'ellipsoïde de 1 bar, entre g_éq = GM/a² (1 + 3/2 J2) − ω² a et g_pôle = GM/b² (1 − 3 J2 a²/b²), J2 de Juno et de
  Cassini. s vaut 0,859 au pôle de Jupiter et 0,753 à celui de Saturne (avant : 0,935 et 0,902, l'espace aplati seul).
- **Le shader** (`giantLevel`, lu une fois par rayon à la latitude de la caméra, comme Alex) : chaque échantillon prend sa
  hauteur « au niveau » (celle de l'équateur), et les colonnes au-dessus (ponts, brumes) repassent en mètres réels.
  Touchés : les ponts, les brumes, les orages, le mur de l'œil, l'échelle de hauteur de l'air dans la marche, le sommet du
  pont dans le fondu (`giantInsideW`, `giantInsideOn`) et la coquille du volume.
- **Le CPU** : le jumeau (`giantLevelScale`, `giantLevel`, `GIANT_FIGURE`, la hauteur des éclairs), l'air du vol à son
  niveau (`our-surface.ts airLevelOver` : le vol dans `motion.ts`, la traînée), le panneau AIR et les annonces (la hauteur
  affichée reste la vraie), le tonnerre, la caméra libre (`rig.ts` : le sommet des nuages plus bas aux pôles).
- **Ce qui ne bouge pas** : la surface de 1 bar, le plancher, la surface vue de haut (G9), le stationnaire (`hoverOver`
  place à une hauteur réelle au-dessus de 1 bar).
- **Effet** : dans l'œil de Saturne, à 25 km réels sous 1 bar, la caméra est maintenant à −33 km « au niveau » (−28 avant) :
  le pont d'hydrosulfure apparaît en bas de l'image ; à 60 km, il remonte vers l'horizon. À 70° N (s = 0,78) les ponts se
  rapprochent aussi. Près de l’équateur presque rien (à 12° S, s = 0,993).
- **Coût** : nul (Jupiter dedans 39,2 → 39,4 ms, Saturne dans l'œil 38,3 → 38,3 ms).
- **Tests** : `giant-clouds.test.ts` (s(φ) recalculé à partir des masses, rayons, rotations et J2 du jeu ; les constantes
  du shader celles du jumeau ; 0,86 et 0,75 aux pôles), `aero-giants.test.ts` (l'équateur inchangé ; au pôle chaque pont
  à la pression qu'il a à l'équateur) ; sur le mini `giant-descent`, `giant-poles`, `giant-lightning`, `giant-free-camera`.
