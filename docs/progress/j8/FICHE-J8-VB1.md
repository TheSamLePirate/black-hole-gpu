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
