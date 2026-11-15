# AP10 — la campagne sur toutes les pistes (2026-11-15 23:48 UTC)

Produit par `bun scripts/approach-campaign.ts` — relief : les données seules (la carte mondiale relief-high.bin, ~2 km le texel, sans le détail procédural — décision de Sam du 16 nov.), sans les tuiles fines : un juge grossier, celui du jeu avant l'arrivée des tuiles.

**66914 extrémités**, toutes avec une approche (8270 réelles, 58644 construites) ; pente dégagée 60414, mince 1517, construite écartée « relief » 1316, construite refusée (la pente rencontre le relief) 3586, réelle volée comme publiée malgré la carte du relief 81 ; jonction dont le dernier palier dépasse la pente à 16 km : 1506 ; un point de jonction à moins de 290 m du sol : 0 ; en 121 s.

Terrains où le F-35 peut se poser : 6269, dont 91 sans aucune extrémité volable (toutes refusées par le relief : SLPO, OYSY, PHDH, SCCY, FASB, YNNT, UMDD, 01MT, KHCR, KP-0038, KP-0027, SKSM) ; l'A320 : 3625, dont 35 (SLPO, OYSY, PHDH, UMDD, KHCR, KP-0038, KP-0027, LTAW, LTCB, MHLC, ZUHY, HALL).

| Catégorie | Extrémités | Dégagée | Mince | Écartée (relief) | Refusée | Réelle, relief contredit | Palier au-dessus de la pente | F-35 | A320 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ILS | 3128 | 3001 | 107 | 0 | 0 | 20 | 9 | 3065 | 2515 |
| LOC | 261 | 232 | 22 | 0 | 0 | 7 | 0 | 197 | 78 |
| LDA/SDF/IGS | 20 | 14 | 3 | 0 | 0 | 3 | 0 | 17 | 12 |
| RNAV/VOR/NDB | 4861 | 4678 | 132 | 0 | 0 | 51 | 15 | 2319 | 536 |
| built | 58644 | 52489 | 1253 | 1316 | 3586 | 0 | 1482 | 9425 | 5640 |
| renumbered | 659 | 627 | 21 | 0 | 0 | 11 | 3 | 448 | 352 |
| approx | 38183 | 34168 | 831 | 642 | 2539 | 3 | 828 | 1783 | 959 |
| not paved | 36200 | 32441 | 774 | 634 | 2347 | 4 | 808 | 0 | 0 |
| high (> 1 500 m) | 2489 | 1640 | 119 | 245 | 466 | 19 | 354 | 779 | 511 |
| mountain (+1 000 m within 20 km) | 3269 | 1370 | 131 | 795 | 953 | 20 | 1040 | 993 | 622 |
| short (< 1 500 m) | 50301 | 45192 | 1096 | 947 | 3033 | 33 | 1137 | 0 | 0 |

**Approches réelles que la carte mondiale du relief contredit** (volées comme publiées depuis AP10 — avant, refusées ; le relief grossier près du seuil, un angle de nav.dat douteux) — les 40 pires :

| Terrain | Extrémité | Approche | Dégagement | À |
|---|---|---|---:|---:|
| PHHN | 08 | RNAV (cifp) | -274 m | 18.5 km |
| K6A4 | 24 | RNAV (cifp) | -86 m | 1.0 km |
| LFKF | 23 | ILS (navdat) | -86 m | 1.0 km |
| K6A4 | 06 | RNAV (cifp) | -76 m | 1.0 km |
| ZPLJ | 02 | ILS (navdat) | -72 m | 1.0 km |
| PACX | 02 | RNAV (cifp) | -69 m | 1.0 km |
| KDUB | 29 | RNAV (cifp) | -67 m | 1.0 km |
| PAML | 18 | RNAV (cifp) | -65 m | 1.0 km |
| ESUT | 33 | ILS (navdat) | -65 m | 1.0 km |
| PAKT | 11 | ILS (cifp) | -56 m | 1.0 km |
| KTEX | 09 | LOC (cifp) | -53 m | 1.0 km |
| LZZI | 06 | ILS (navdat) | -49 m | 1.0 km |
| KEGE | 25 | LDA (cifp) | -43 m | 1.0 km |
| CYLW | 16 | ILS (navdat) | -41 m | 1.0 km |
| CYYF | 16 | LOC (navdat) | -40 m | 1.0 km |
| KDSV | 14 | RNAV (cifp) | -37 m | 1.0 km |
| KAXX | 17 | RNAV (cifp) | -36 m | 1.0 km |
| SVMI | 10 | ILS (navdat) | -32 m | 1.0 km |
| KO02 | 25 | RNAV (cifp) | -31 m | 1.0 km |
| KIPT | 09 | RNAV (cifp) | -31 m | 1.0 km |
| K22N | 08 | RNAV (cifp) | -30 m | 1.0 km |
| KLHV | 27R | RNAV (cifp) | -29 m | 1.0 km |
| SELT | 18 | ILS (navdat) | -27 m | 1.0 km |
| KSBS | 32 | RNAV (cifp) | -27 m | 1.0 km |
| K22N | 26 | RNAV (cifp) | -27 m | 1.0 km |
| KN82 | 05 | VOR (cifp) | -26 m | 1.0 km |
| KIPT | 27 | ILS (cifp) | -26 m | 1.0 km |
| KCZG | 03 | RNAV (cifp) | -26 m | 1.0 km |
| K4V0 | 24 | RNAV (cifp) | -25 m | 1.0 km |
| LDSP | 05 | ILS (navdat) | -25 m | 1.0 km |
| KAFO | 34 | RNAV (cifp) | -24 m | 1.0 km |
| KN27 | 23 | RNAV (cifp) | -24 m | 1.0 km |
| KK09 | 04 | RNAV (cifp) | -22 m | 1.0 km |
| KHTF | 18 | RNAV (cifp) | -22 m | 1.0 km |
| KUKI | 15 | LOC (cifp) | -21 m | 1.0 km |
| O60 | 32 | RNAV (cifp) | -21 m | 1.0 km |
| PAHO | 22 | RNAV (cifp) | -21 m | 1.0 km |
| LSZB | 14 | ILS (navdat) | -20 m | 1.0 km |
| KIPT | 12 | RNAV (cifp) | -20 m | 1.0 km |
| KCAG | 25 | RNAV (cifp) | -18 m | 1.0 km |
