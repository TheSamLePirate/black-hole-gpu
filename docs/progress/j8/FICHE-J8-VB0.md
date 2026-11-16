# Fiche J8-VB0 — les routes de la BD TOPO telles que les tuiles en cache les donnent

Fiche de [PLAN-DETAILS-VOL-BAS-FABLEFLIGHT](../../PLAN-DETAILS-VOL-BAS-FABLEFLIGHT.md), lot VB0 (part « données », session des approches),
rattaché à [PLAN-J8](../../PLAN-J8-BATIMENTS.md) comme J8-VB. La question du plan (§4.2) : « le taux de remplissage de ces champs à Paris et à
Toulon ».

- **Mesuré le 16 novembre 2026** (~18:20 UTC), ce Mac, `bun scripts/j8-vb0-roads.ts` → [`vb0-roads.json`](vb0-roads.json). Aucun
  téléchargement : les tuiles BD TOPO z 15 déjà sur le disque (les données Terre des e2e, `earth-data`, et le cache du recensement J8-0,
  `~/.kerr-cache/bdtopo/15`), leur couche `troncon_de_route`.
- **Où** : Toulon-Hyères (42,9–43,3° N, 5,7–6,4° E), Paris (48,7–49,0° N, 2,1–2,6° E). Un tronçon coupé par deux tuiles compte dans
  chacune, comme les cellules le liront.

| Lieu | Tuiles | Tronçons | Largeur | Voies | Sens | Position (ponts, tunnels) | Urbain, importance, nature, vitesse |
|---|---:|---:|---:|---:|---:|---:|---:|
| Paris | 965 | 230 478 | 76,6 % | 77,2 % | 100 % | 100 % | 100 % |
| Toulon-Hyères | 2 192 | 100 874 | 50,4 % | 51,2 % | 100 % | 100 % | 100 % |

**Par nature de route**, la largeur et les voies sont présentes là où elles servent :

| Nature | Paris (tronçons · largeur · voies) | Toulon-Hyères |
|---|---|---|
| Route à 1 chaussée | 161 206 · 95,6 % · 96,6 % | 46 599 · 98,6 % · 98,7 % |
| Route à 2 chaussées | 12 845 · 100 % · 100 % | 1 891 · 100 % · 100 % |
| Rond-point | 5 148 · 100 % · 100 % | 2 318 · 100 % · 100 % |
| Bretelle | 2 169 · 100 % · 100 % | 242 · 98,8 % · 100 % |
| Type autoroutier | 2 163 · 100 % · 100 % | 444 · 98,9 % · 100 % |
| Sentier, chemin, route empierrée, escalier | 46 942 · 0 % · 0 % | 48 627 · 0 % · 0 % |

- **Les valeurs** : sens « Double sens », « Sens direct », « Sens inverse », « Sans objet » ; position 0 au sol, 1…3 au-dessus (ponts),
  −1…−4 au-dessous (tunnels), « Gué ou radier » ; largeurs surtout de 4 à 6 m (Paris 117 343, Toulon 32 008), jusqu'à 20 m ; voies de
  0 à 10.
- **Ce que ça dit pour VB1** : la cellule « rue » peut lire largeur, voies, sens et position dans la BD TOPO pour toutes les routes
  carrossables (≥ 95,6 % renseignées). L'inférence par classe ne sert qu'aux sentiers, chemins, routes empierrées et escaliers, et hors de
  France (OpenMapTiles, sans largeur ni voies). La restriction de hauteur est rare (Paris 1,3 %, Toulon 11,5 %).
- **Non mesuré** : la qualité des valeurs (une largeur juste ou non) ; d'autres villes ; les tuiles hors des disques.
