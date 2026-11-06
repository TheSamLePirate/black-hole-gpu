# Problèmes à régler

Problèmes constatés, pas encore réglés. Chaque entrée : la date (UTC), ce qui est mesuré ou observé et sa source, la cause
connue ou supposée, la piste. Une entrée réglée est barrée avec le commit qui la règle, pas effacée.

## La compilation du noyau de Jupiter proche : ~200 s à froid

- **Constaté le 6 novembre 2026** (Sam : « 200 s pour Jupiter »), en écrivant l'e2e `aurora-jupiter` (AM3).
- **Mesuré** sur le MacBook Pro M1 Max, Chrome lancé par l'e2e, cache de pipelines vide : la caméra à 7 000 km au-dessus de
  45° N de Jupiter (dans son ombre), le noyau du traceur pour cette vue se compile en **203 s sans les aurores** et **219 s
  avec** (`__bh.renderer.compilesPending` à 0). Sonde e2e jetable, même vue, réglage `aurora` 0 puis 5. Après la compilation
  du traceur, le noyau de la sonde de lumière (« the light probe (auroras) ») en demande encore ~60 s.
- **Ce n'est pas l'aurore** : la variante sans aurore met déjà 203 s. C'est le noyau du détail proche des géantes
  (`NEAR_DETAIL`, la tuile de turbulence, le volume des nuages `giantInside`…), compilé à la première approche.
- **Effet** : à la première approche de Jupiter, l'image attend plus de trois minutes sur ce Mac (plus sur le mini, le PC
  Windows non mesuré). Les e2e de Jupiter doivent attendre jusqu'à 5 min à froid (`aurora-jupiter` le dit dans son bandeau).
- **Piste** : mesurer le temps de compilation par fonction comme pour PLAN-LEAN-TRACER-KERNELS (P0–P10 : la Terre passée de
  134 à 19 s) ; spécialiser le noyau des géantes (ce que la caméra proche n'utilise pas) ; compiler en avance dès que
  Jupiter devient la destination (G, l'Atlas, `near`) — ANALYSE-STRATEGIE §8 « anticiper les compilations ».

## Le ciel de nuit de la sonde de lumière du Ranger, ~40 fois son sol

- **Constaté le 6 novembre 2026** (AM2). La nuit à Tromsø, la mer des fjords dessinait une bande blanche saturée le long de
  l'horizon, avec ou sans Lune. La sonde relue : son ciel ~4·10⁻⁶, son sol ~10⁻⁷ (unités de la scène), alors que la vue
  principale dessine le ciel plus sombre que la neige. Sans le vaisseau, la bande disparaît (moyenne 170 → 4).
- **Raccord provisoire** (a1e34357) : dans `seaShade`, le reflet de la sonde est borné à 4 fois le ciel clair du modèle de la
  caméra.
- **À trouver** : pourquoi le ciel de la sonde est si clair la nuit (échelle du fond de ciel liée à l'exposition ?
  `physicalPoints` des étoiles ?) ; puis retirer la borne.

## L'aurore de la face nuit invisible quand la caméra est au soleil, dans l'espace

- **Constaté le 6 novembre 2026** (AM2) : à 4 000 km au-dessus du Canada, caméra au soleil, l'exposition suit la lumière
  qui tombe sur la caméra (`earthSunlight`), l'œil est adapté au jour, la face nuit et son aurore restent noires.
- **Piste** : une exposition qui tient compte de ce que la vue regarde (le posemètre lit déjà la scène pour la retenue des
  hautes lumières) plutôt que de la seule lumière incidente, hors de l'atmosphère.

## Jupiter vu de près depuis l'hémisphère sud : l'image parfois toute noire

- **Constaté le 6 novembre 2026** (AM3, e2e `aurora-jupiter` et une sonde jetable) : la caméra libre à 7 000–14 000 km
  au-dessus de 50–55° S, regardant vers le sud, l'image est entièrement noire, étoiles comprises (luminance moyenne 0,1 sur
  255), **aurore éteinte comme allumée, de jour comme de nuit** — ce n'est pas l'aurore. Une autre fois, la même vue
  s'affiche (étoiles, limbe, ovale sud). Pas d'erreur GPU (`gpuErrors` 0), temps GPU normal (7–14 ms), une fois 0,5 ms.
- **Piste** : un NaN ou une exposition qui part (le posemètre après la coupe), le chemin des géantes proches
  (`giantInside`, la tuile de turbulence) sur l'hémisphère sud ; relire la luminance du posemètre et les pixels NaN dans
  cette vue.

## Le coût de l'aurore terrestre de près, la nuit : +4,6 ms sur le M1

- **Mesuré le 6 novembre 2026** (e2e `aurora-cost` sur kerr-mini, Nominal, plein écran, ABAB, médiane de 24 lectures) :
  Tromsø, Kp 4, de nuit, regard au sud : 36,2 → 40,8 ms (échelle de rendu 0,75 des deux côtés), ~+12 %. Depuis 400 km :
  +2,1 ms (échelles différentes, à refaire). Le schéma de la magnétosphère : +2,3 ms à échelle 1,00 après passage à la
  demi-résolution (≥ +5,5 ms avant). Jupiter : +0,5 ms.
- **Déjà fait** : 16 évaluations par rayon au lieu de 40 ; aucun noyau d'aurore quand l'œil est adapté à plus de 1 000 lux ;
  les rayons qui restent sous 45° de latitude magnétique sautés (gain de ces deux tris non mesuré).
- **Piste** : le cache par direction d'Alex (§ 7.5 : une carte octaédrique marchée depuis l'œil, une bande par image, lue par
  la composition) — au-delà de ~100 km sans parallaxe ; la marche à ¼ de résolution recomposée.

## Saturne vue de son ombre, l'œil adapté : des artefacts partout

- **Constaté le 6 novembre 2026** (AM4, e2e `aurora-giants` sur kerr-mini) : la caméra à un rayon au-dessus du côté nuit de
  Saturne, dans son ombre, l'exposition adaptée au noir (comme pour Jupiter) : l'image se couvre de croissants pixellisés
  dans tout le ciel et de trous dans le disque. À la lumière du jour, rien de tel : c'est une lumière faible et fausse du
  traceur autour de Saturne (la lumière des anneaux sur la face nuit ? un bruit d'accumulation ?) que le gain révèle.
- **Raccord** : l'œil n'est pas adapté à l'ombre de Saturne (`earthSunlight`) ; ses aurores sont calculées mais à leur
  radiance physique, donc invisibles de nuit. **Piste** : relever cette lumière (sonde de pixels) et la corriger, puis
  rendre l'adaptation à Saturne.

## Le traceur (pipeline « trace ») au large de Big Sur : une nappe sombre plate jusqu'à l'horizon

- **Constaté le 6 novembre 2026** (sonde e2e, vol à 450 m au large de Big Sur, cap 150°, `earthPipeline: "trace"`) : une nappe
  plate et sombre au-dessus de la mer, à droite, jusqu'à l'horizon, avec un trait clair le long de la côte. **Elle est
  identique avec le relief national coupé** (`earthIgnRelief: false`) : elle ne vient pas de Mapterhorn, elle précède le lot D.
  Le raster (le pipeline par défaut) ne la montre pas.
- **Piste** : la profondeur de la mer du traceur (`seaDepthAt`, niveaux z 8–10 de Terrarium) ou sa surface de mer lointaine ;
  sonder les pixels de la nappe (distance, `gq`, profondeur lue).
