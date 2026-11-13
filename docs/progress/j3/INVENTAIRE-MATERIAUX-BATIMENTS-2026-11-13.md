# J3-5 (préparation) — les matériaux des bâtiments tels que le rendu les dessine (13 novembre 2026)

[PLAN-J3](../../PLAN-J3-LUMIERE-COCKPIT.md) J3-5 : « toits et murs vers des paramètres physiques (albédo, rugosité, métal, verre réfléchissant
le ciel commun de J3-1) ». Avant tout changement, ce que le code donne aujourd'hui. **Lecture du code seulement** (agent d'exploration ; trois
points revérifiés à la main : les tuiles du nord `roofs.ts:117`, le recalage sur l'orthophoto `trace.wgsl:10402`, le verre des fenêtres
`trace.wgsl:10246`) ; aucune mesure, rien de changé. Les numéros de ligne sont ceux de `main` au 13 novembre (après `ec6aec40`).

## D'où viennent les valeurs

- Empaquetage : `scenery-data.ts` `buildingPacked` (bits 0–3 le toit, 4–7 le mur, puis étages, plans, forme…).
- Albédos : `roofs.ts` `roofColour` / `wallColour` (l. 111–154), **linéaires** (commentaire l. 108), chaque bâtiment entre deux valeurs selon
  sa graine. Une couleur OSM / Overture (`colour`, `roof_color`) les remplace (`scenery-worker.ts:1463`), convertie de sRGB et resserrée
  (0,05 + 0,55 × …, saturation moitié — `roofs.ts:181`).
- Le facteur d'albédo global du sol (`P.earth2.z` = 0,8) ne touche pas ces tables (seulement les bâtiments maillés U2 sans feuille).

## Le tableau (Y : luminance calculée des valeurs lues)

| Classe | id | Albédo linéaire [Y] | Spéculaire (`WS_S`, F0 de Schlick) | Métal | Où |
|---|---|---|---|---|---|
| Toit tuiles, sud / Méditerranée | 1 | (0,38 0,20 0,12)→(0,32 0,22 0,16) [≈ 0,23] | aucun | non | roofs.ts:116 |
| Toit tuiles, ailleurs | 1 | (0,17 0,088 0,064)→(0,13 0,088 0,07) [≈ 0,10] | aucun | non | roofs.ts:117 |
| Toit ardoise | 2 | (0,065 0,072 0,085)→(0,095 0,098 0,105) [0,07–0,10] | aucun | non | roofs.ts:119 |
| Toit zinc | 3 | (0,27 0,29 0,31)→(0,21 0,23 0,25) [0,23–0,29] | 0,06 × près | non (gris diffus) | roofs.ts:121 ; trace:10265, 10273 |
| Toit béton (terrasse) | 4 | (0,20 0,195 0,18)→(0,11 0,11 0,105) [0,11–0,20] | aucun | non | roofs.ts:124 |
| Toit tôle | 5 | (0,32 0,33 0,34)→(0,20 0,24 0,22) [0,23–0,33] | **aucun** | non | roofs.ts:126 |
| Mur enduit / inconnu | 0, 5, 9 | froid (0,58 0,56 0,50)→(0,46 0,42 0,34) ; chaud (0,60 0,50 0,36)→(0,55 0,38 0,30) [0,41–0,56] | fenêtres seules | non | roofs.ts:148–151 |
| Mur pierre | 1 | (0,50 0,44 0,33)→(0,40 0,37 0,31) [0,37–0,45] | fenêtres seules | non | roofs.ts:137 |
| Mur meulière | 2 | (0,34 0,23 0,13)→(0,28 0,21 0,15) [0,22–0,25] | fenêtres seules | non | roofs.ts:139 |
| Mur béton | 3 | (0,34 0,33 0,31)→(0,26 0,26 0,25) [0,26–0,33] | fenêtres seules | non | roofs.ts:141 |
| Mur brique | 4 | (0,30 0,11 0,065)→(0,24 0,12 0,08) [≈ 0,145] | fenêtres seules | non | roofs.ts:143 |
| Mur bois | 6 | (0,19 0,11 0,055)→(0,12 0,08 0,05) [0,09–0,12] | fenêtres seules | non | roofs.ts:145 |
| Mur-rideau (verre) | 7 | vitres ≈ 0,08 ; meneaux (0,16 0,17 0,18) | **0,10** (vitres) | non | roofs.ts:147 ; trace:10199–10217 |
| Fenêtres (autres murs) | — | (0,035 0,045 0,055) | 0,04 × près | non | trace:10246 |

Modulations par pixel : ×(0,85 + 0,15 bruit) sur tout bâtiment ; toits en pente : rangs ×(0,72…1)(0,85…1,15), patine ×(0,82 + 0,18 bruit),
AO 0,9 ; toits plats : ×(0,85 + 0,25 bruit…) ; murs : AO 0,385–0,55, ×0,78 au loin (les fenêtres sombres), ligne d'étage ×(1 − 0,12…).
Estimation de l'agent (non mesurée) : à l'écran, ≈ ×0,65 sur les toits en pente, ×0,6 sur les murs lointains.

## Ce qui ressort (à confirmer en image avant de changer quoi que ce soit)

- **Aucun métal** : `WS_S` n'est qu'un F0 diélectrique ; le zinc est un gris diffus à F0 0,06 (un métal : F0 ≈ 0,5 et plus, diffus nul) ; la tôle
  n'a pas de spéculaire du tout.
- **Le reflet ne voit pas le ciel commun** : le miroir ajoute `ciel/π × 1,3 × AO` avec une irradiance plate (`skyFlat` tracé, `liteSky` raster) ;
  la direction réfléchie ne sert qu'au reflet du Soleil. Le reflet s'ajoute au diffus entier (pas de 1 − F).
- **Le spéculaire s'éteint au loin** : fenêtres, zinc et lucarnes × « près » — au-delà d'environ 26 cm par pixel (120–260 m), F0 = 0 ; seuls les
  murs-rideaux gardent 0,10.
- **Albédos face aux valeurs mesurées usuelles** : tuiles du nord ≈ 0,10 (usuel 0,25–0,35 : bien trop sombre ; la patine les descend encore
  vers 0,065 à l'écran) ; brique ≈ 0,145 (0,2–0,3 : basse) ; bois 0,09–0,12 (sombre) ; ardoise, enduit, pierre plausibles ; béton des murs
  un peu bas. Le verre des murs-rideaux : F0 0,10 (verre flotté ≈ 0,04) et un diffus de 0,08.
- **La couleur du toit et sa classe peuvent diverger** : la couleur vient du premier plan du bâtiment (`scenery-worker.ts:1464`), la classe de
  chaque partie (`:1495`).
- **Raster et tracé diffèrent** : le raster recale l'albédo du toit sur l'orthophoto (× 0,6–1,5, `trace.wgsl:10402`), le tracé non ; la lumière
  ambiante diffère (`sky × 0,6 × AO` tracé ; `skyOnFace`, renvoi, Lune au raster) ; la pluie et la neige sur les bâtiments au raster seul ; les
  bâtiments en boîtes recevaient au raster le facteur de mouillé du sol (× 0,58) au lieu de celui des bâtiments (× 0,75, `:16030`) —
  **corrigé le 13 nov.** ; A/B sous la pluie à Paris (~17:47 UTC, `…-j3-wetbld-ab2`, A B B A, 19a0fc44 contre le correctif, exposition égale) :
  luminance moyenne A 78,75 / 78,29, B 79,26 / 78,22 — **aucun écart au-delà du bruit, vues semblables** : les bâtiments de ce cadre sont
  vraisemblablement des maillages (qui avaient déjà × 0,75), le cas des boîtes non vu (non vérifié lesquels sont dessinés en boîtes) ;
  possiblement un GGX du sol en plus sur ces boîtes (`:16139`, **non vérifié**).

## Un essai : ce que voit le joueur en France (13 nov., ~18:16 UTC)

Un levier d'essai (non gardé) multipliait dans `buildingLook` l'albédo des tuiles (× 2,5) et de la brique (× 1,5) ; vue d'en haut de Lille
(tuiles et briques), monde figé, exposition tenue, données et décor chargés (kerr-mini, `…-j3-materials2`) : luminance moyenne 73,31 telle
qu'aujourd'hui, **73,05 avec l'essai**, 73,27 de nouveau — **les vues identiques au pixel près**. Les bâtiments vus là ne prennent pas leur
couleur des tables : de près au raster, les toits viennent de l'orthophoto (bâtiments maillés, ou l'albédo recalé sur la photo) ; les murs
comptent peu vus d'en haut. **Les albédos sombres des tables ne pèsent donc, en France, que là où la photo ne colore pas** : le rendu tracé,
le lointain sans maillage, l'étranger (Overture, sans orthophoto nationale). Le levier et sa phase ont été retirés (aucun utilisateur).
Non vérifié : une vue rasante (murs), une ville étrangère, quels bâtiments du cadre étaient maillés.

## Les vues de référence (13 nov., ~18:26 UTC)

Phase J0 `cityview` (kerr-mini ; monde figé, données et décor chargés ; vues de côté à 10° et d'en haut à 35° ; une grille de 24 × 14
`renderer.surfaceAt`) : **Lille** (`…-j3-cityview-lille`) 22 / 55 points de bâtiment, **Bruxelles** (`…-j3-cityview-brussels`) 11 / 29, **aucune
« boîte »** dans les deux. À Lille, les toits proches sont ceux de l'orthophoto IGN ; à **Bruxelles**, sans orthophoto nationale, la photo du sol
est floue et les toits **bruns et ternes** des tables se voient — c'est là (l'étranger, Overture) que les albédos de J3-5 comptent. Les bâtiments
de Bruxelles n'y sont chargés que sur une bande (non expliqué : la couverture d'Overture ou une limite du décor — les deux villes comptent
3 920 bâtiments, une borne possible, non vérifiée).

## Ce que J3-5 en fera (proposé)

1. Des vues de référence **là où les tables comptent** (une ville étrangère sans orthophoto, des murs vus à hauteur d'homme, le tracé) et un
   témoin : un matériau de luminance connue posé dans la scène.
2. Les albédos ramenés aux valeurs mesurées (tuiles du nord, brique, bois), un vrai métal (zinc, tôle : F0 coloré, diffus nul, une rugosité),
   le verre à F0 0,04, le reflet dans la sonde commune de J3-1 plutôt qu'une irradiance plate, sans extinction au loin (une rugosité qui croît
   avec l'empreinte du pixel plutôt qu'un F0 qui tombe à 0).
3. Une seule fonction de matériau pour les deux chemins (raster, tracé), le recalage sur la photo conservé là où il est voulu.
Chaque point se juge sur des vues A/B et son coût ; aucun n'est fait.
