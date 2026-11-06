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
