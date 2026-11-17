# Fiche J8-VB1 — la cellule « rue » au format 2

Fiche de [PLAN-DETAILS-VOL-BAS-FABLEFLIGHT](../../PLAN-DETAILS-VOL-BAS-FABLEFLIGHT.md), lot VB1 (session des approches), rattaché à
[PLAN-J8](../../PLAN-J8-BATIMENTS.md). Le format convenu avec la session du rendu le 16 nov. 2026 (~18:40 UTC) ; ses règles sont dans
l'en-tête de [`street-cells.ts`](../../../src/system/street-cells.ts).

- **Le format (KSC2)** :
  - même clé z 15, même repère que la cellule « bâtiments », cache `kerr-street-v2` ;
  - en-tête de 64 o (`junctionCount`, `placeCount` à 0 en attendant VB4, un compte réservé) ;
  - lampadaire de 12 o, inchangé ;
  - **tronçon de 32 o** pour toutes les routes, sentiers et escaliers compris : largeur, voies, classe, sens, pont et tunnel, niveau,
    vitesse, abscisse, identité de la route ;
  - **jonction de 12 o** : degré 3 et plus, largeur la plus grande, rond-point, niveaux différents.
- **La découpe** : chaque route simplifiée par Douglas-Peucker à 0,3 m, puis coupée en tronçons droits de 250 m au plus, chacun dans la
  cellule de son milieu.
- **Les sources** :
  - en France, `troncon_de_route` de la tuile BD TOPO que le worker lit déjà pour les bâtiments ;
  - ailleurs, OpenMapTiles, avec la largeur et les voies inférées par la classe (drapeau « largeur inférée »).

**Mesuré le 16 novembre 2026**, ce Mac, depuis les données Terre des e2e (aucun téléchargement) :

| Lieu (tuile OpenMapTiles z 14) | Lampadaires | Tronçons | dont largeur de la BD TOPO | Jonctions | Sommets avant → après la simplification | Tronçons par cellule | Préparation |
|---|---:|---:|---:|---:|---:|---|---:|
| Centre de Toulon (8461/6012) | 1 370 | 2 659 | 2 340 | 622 | 4 474 → 4 175 | 965 · 947 · 212 · 535 | 74 ms |
| Paris, le Marais (8299/5636) | 1 519 | 2 097 | 1 611 | 676 | 4 063 → 3 753 | 490 · 467 · 562 · 578 | 93 ms |

- **Dans le jeu** (`j8-street-cells` 1/1, 18:25 UTC) : les quatre cellules du centre de Toulon en 0,5 s, la plus longue image 35 ms ;
  rechargées, toutes du cache.
- **La simplification** ne retire que ~7 % des sommets : la BD TOPO est déjà simplifiée. Les comptes par cellule (200 à 965 tronçons)
  sont à revoir avec la session du rendu si elle les juge trop nombreux.
- **Limites** :
  - l'abscisse est continue dans une tuile, pas d'une tuile à l'autre ;
  - à l'étranger, une route coupée par deux tuiles z 14 a deux identités ;
  - non mesuré : kerr-mini, le coût de dessin (à la session du rendu).

## VB4 — les places du stationnement (la préparation)

Convenu avec la session du rendu (16 nov. ~18:55 et ~19:25 UTC) ; les règles dans l'en-tête de `street-cells.ts`. Une place de 16 o (centre,
cap, sorte, côté, graine de 24 bits, largeur de la chaussée au droit), dans la section réservée de KSC2.

- **Rues** : urbaines, classes tertiaire, locale, service ; ni pont ni tunnel. Chaussée de 5 m et plus : sur la chaussée, à
  `largeur/2 − 1,1 m`, des deux côtés (un seul en sens unique sous 6 m). **Sens unique de 3 à 5 m** : la BD TOPO y donne la largeur
  roulante, sans la file de stationnement. La voiture est alors hors de la chaussée, à `largeur/2 + 1,1 m`, sur la droite, avec le
  drapeau « file supposée ».
- **Exclusions** : à moins de 12 m d'une jonction, à moins de 1 m d'une boîte de bâtiment ; une place de file supposée à moins de 3 m d'un
  autre tronçon. La végétation et les passages piétons ne sont dans aucune des deux sources : non exclus, jamais simulés.
- **Densité** : chaque place est gardée par sa graine (0,6). Au plus 4 000 par cellule, éclaircies uniformément au-delà, avec un drapeau
  dans l'en-tête.

**Mesuré** (16 nov., ce Mac, données du disque, une tuile z 14) :

| Lieu | Places (par cellule) | Sans la file supposée | Part en file supposée | Cellules éclaircies |
|---|---|---|---:|---:|
| Centre de Toulon | 1 176 (295 · 461 · 270 · 150) | 671 (124 · 239 · 270 · 38) | 43 % | 0 |
| Paris, le Marais | 1 707 (337 · 402 · 578 · 390) | 527 (114 · 87 · 224 · 102) | 69 % | 0 |

- **Non vérifié** : la vraisemblance des places sur une image (le dessin est à la session du rendu), la justesse de la « file supposée »
  rue par rue.

## KSC3 — les données de VB2, VB5a, VB6 et VB7 (mode speed, 17 nov. ~09:40 UTC)

Proposé à la session du rendu à ~09:30 UTC et codé sans attendre sa réponse (mode speed, décision de Sam ; répartition du point 13 de
PLAN-J8). Les règles sont dans l'en-tête de [`street-cells.ts`](../../../src/system/street-cells.ts) ; le calcul est dans
[`street-detail-prep.ts`](../../../src/system/street-detail-prep.ts). Le cache passe à `kerr-street-v3`, et le pool efface les caches des formats 1 et 2.

- **VB5a, la lampe passe à 16 o** : le cap de la potence (du pied vers la tête, celui de `lampsAlong`), sa portée (1,2 m) et une variante
  de 0 à 2, tirée d'une graine du pied.
- **VB6, une suite par bout de tronçon (4 o par tronçon)** : d'abord le tronçon suivant de la même route, sinon la branche la plus droite
  que les sens uniques autorisent, au même niveau, jamais en demi-tour. `NEXT_ELSEWHERE` quand la route continue dans une cellule voisine.
- **VB2, une surface par tronçon (4 o)** : lignes de rive, ligne centrale (tiretée ou pleine), lignes de voie, bordure et largeur des
  trottoirs, tirées de la classe, de la largeur, des voies, du sens et de l'urbain.
- **VB7, le mobilier (16 o)** : aux jonctions urbaines de degré 3 et plus, sans pont ni tunnel :
  - une ligne d'arrêt sur les voies entrantes (une ligne de cédez-le-passage à l'entrée d'un rond-point) ;
  - un passage piéton 3 m au-delà ;
  - des feux aux grands carrefours ;
  - des glissières le long des voies rapides hors agglomération et sur les ponts.
  - Le côté de circulation suit `drivesLeft` : Royaume-Uni, Irlande, Japon, Australie, Nouvelle-Zélande. Les autres pays qui roulent à
    gauche ne sont pas encore listés.
- **Tout est inféré** : la BD TOPO et OpenMapTiles ne donnent ni marquages, ni passages piétons, ni feux.

**Mesuré** (tests unitaires, ce Mac, données du disque e2e, une tuile z 14, 17 nov.) :

| Lieu | Suites dans la cellule | Ailleurs | Tronçons avec bordure | Ligne centrale | Lignes d'arrêt | Passages | Feux | Glissières | Préparation de la tuile |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Centre de Toulon | 4 416 / 5 318 | 726 | 2 312 / 2 659 | 146 | 1 102 | 1 424 | 132 | 30 | 96 ms |
| Paris, le Marais | 3 379 / 4 194 | 628 | 1 819 / 2 097 | 107 | 1 057 | 1 458 | 149 | 14 | 92 ms |

- **Non mesuré** : rien n'est encore dessiné (la session du rendu), ni vu dans le jeu, ni passé sur kerr-mini. Le coût de préparation dans
  les workers et la taille des cellules en zone restent à relever au gros e2e. La vraisemblance des passages et des feux n'a pas été
  confrontée à l'orthophoto.

## KSC4 — les ponts, les routes en runs, les bouches de tunnel (J8-RP, mode speed, 17 nov. ~10:35 UTC)

Proposé à la session du rendu à ~10:35 UTC et codé sans attendre sa réponse. Le cache passe à `kerr-street-v4`.

- **RP2** : `roadRuns(buf)` recoud les tronçons d'une même route par leurs suites. En France, ce sont l'axe et la largeur de la BD TOPO.
- **RP4, RP7 : les ponts.**
  - Les tronçons de pont des quatre cellules d'une tuile z 14 sont chaînés en tabliers.
  - Chaque tablier porte son axe, sa largeur (chaussée plus trottoirs ou parapets), son niveau et ce qu'il franchit (eau, routes et voies
    ferrées d'OpenMapTiles), avec son tirant (5,5 m, 6 m au-dessus d'une voie ferrée).
  - Il est confirmé par la BD TOPO (`construction_lineaire` ou `construction_surfacique` « Pont » à 15 m) et marqué ouvert là où la tuile
    le coupe.
  - **Aucune hauteur dans la cellule** : la BD TOPO n'en donne pas. Le tablier se pose au dessin entre le sol de ses deux culées. Les
    piles se calculent avec `bridgePiers` (34 m, 130 m pour un viaduc).
- **RP6** : chaque tronçon sur un pont donne l'indice de son pont (octet 3 de la surface).
- **RP8** : le mobilier compte une sorte de plus, la bouche de tunnel.

**Mesuré** (tests unitaires, données du disque e2e, une tuile z 14 par lieu) :

| Lieu | Ponts | Confirmés BD TOPO | Sur l'eau | Sur une route | Ouverts au bord | Le plus long | Bouches de tunnel |
|---|---:|---:|---:|---:|---:|---:|---:|
| Centre de Toulon | 9 | 9 | 0 | 4 | 1 | 111 m | 6 |
| Paris, le Marais | 7 | 7 | 6 | 4 | 1 | 124 m | 2 |
| Paris, la Seine au pont Alexandre III (8297/5636) | 5 | 5 | 4 | 4 | 0 | 154 m | 10 |

- **Non mesuré** : rien n'est dessiné ni vu en jeu. La taille des cellules au format 4 en zone n'a pas été relevée, ni ce qu'un pont
  coupé par deux tuiles donne au dessin.

## KSC5 — les voies ferrées (J8-RP RP9, mode speed, 17 nov. ~10:39 UTC)

Le cache passe à `kerr-street-v5`.
- **Les sources** : en France, `troncon_de_voie_ferree` de la BD TOPO (nature, nombre de voies, niveau, électrifiée) ; ailleurs, les
  lignes `rail` et `transit` d'OpenMapTiles (une voie, électrification inconnue). Chaque voie devient un tronçon de classe « rail ».
- **La largeur** : 4,5 m entre voies, plus 3 m de ballast. L'électrification passe dans la surface (`SurfaceFlag.Electrified`).
- **Ce qui ne s'applique pas aux voies** : ni jonction, ni place, ni lampadaire, ni mobilier de route (aucune ligne d'arrêt ni passage
  sur une voie), et aucune suite d'une voie vers une route.
- **Ponts et tunnels** : un pont ferroviaire est `BridgeKind.Rail` ; ses bouches de tunnel sont celles d'une route.

**Mesuré** (tests unitaires, une tuile z 14) : centre de Toulon 50 tronçons de voie, dont 43 électrifiés ; le Marais 82, tous
électrifiés ; la Seine au pont Alexandre III 19, tous électrifiés. Le mobilier des routes est inchangé. Non vu en jeu.
