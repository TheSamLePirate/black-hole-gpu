# AP10 — la campagne sur toutes les pistes (2026-11-15 22:20 UTC)

Produit par `bun scripts/approach-campaign.ts` — relief : la carte mondiale (relief-high.bin, ~2 km le texel) et le détail procédural du jeu, sans les tuiles fines : un juge grossier, celui du jeu avant l'arrivée des tuiles.

**66914 extrémités**, toutes avec une approche (8270 réelles, 58644 construites) ; pente dégagée 53859, mince 2632, construite écartée « relief » 1219, construite refusée (la pente rencontre le relief) 8559, réelle volée comme publiée malgré la carte du relief 645 ; jonction dont le dernier palier dépasse la pente à 16 km : 3127 ; un point de jonction à moins de 290 m du sol : 0 ; en 2155 s.

Terrains où le F-35 peut se poser : 6269, dont 360 sans aucune extrémité volable (toutes refusées par le relief : ZLLN, SLAL, SLPO, SLSU, SLUY, SCKP, SCPE, OYSY, PHDH, MMTB, SCCY, ZLJC) ; l'A320 : 3625, dont 203 (ZLLN, SLAL, SLPO, SLSU, SLUY, SCKP, OYSY, PHDH, MMTB, ZLJC, FYKT, UMDD).

| Catégorie | Extrémités | Dégagée | Mince | Écartée (relief) | Refusée | Réelle, relief contredit | Palier au-dessus de la pente | F-35 | A320 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ILS | 3128 | 2706 | 235 | 0 | 0 | 187 | 34 | 3065 | 2515 |
| LOC | 261 | 210 | 33 | 0 | 0 | 18 | 3 | 197 | 78 |
| LDA/SDF/IGS | 20 | 10 | 5 | 0 | 0 | 5 | 3 | 17 | 12 |
| RNAV/VOR/NDB | 4861 | 4070 | 356 | 0 | 0 | 435 | 87 | 2319 | 536 |
| built | 58644 | 46863 | 2003 | 1219 | 8559 | 0 | 3000 | 9425 | 5640 |
| renumbered | 659 | 549 | 56 | 0 | 0 | 54 | 12 | 448 | 352 |
| approx | 38183 | 30872 | 1313 | 609 | 5376 | 13 | 1687 | 1783 | 959 |
| not paved | 36200 | 29265 | 1223 | 583 | 5123 | 6 | 1691 | 0 | 0 |
| high (> 1 500 m) | 3374 | 820 | 97 | 164 | 2097 | 196 | 1225 | 1040 | 649 |
| mountain (+1 000 m within 20 km) | 6062 | 1511 | 229 | 869 | 3215 | 238 | 2576 | 1750 | 1128 |
| short (< 1 500 m) | 50301 | 40788 | 1843 | 897 | 6623 | 150 | 2230 | 0 | 0 |

**Approches réelles que la carte mondiale du relief contredit** (volées comme publiées depuis AP10 — avant, refusées ; le relief grossier près du seuil, un angle de nav.dat douteux) — les 40 pires :

| Terrain | Extrémité | Approche | Dégagement | À |
|---|---|---|---:|---:|
| SEQM | 36 | ILS (navdat) | -761 m | 1.8 km |
| ZLLL | 36L | ILS (navdat) | -727 m | 1.0 km |
| KBCE | 21 | RNAV (cifp) | -682 m | 1.8 km |
| KLAR | 03 | RNAV (cifp) | -681 m | 2.5 km |
| KWYS | 01 | ILS (navdat) | -680 m | 3.5 km |
| KGNT | 13 | RNAV (cifp) | -667 m | 1.8 km |
| SECU | 24 | ILS (navdat) | -654 m | 3.8 km |
| KCEZ | 21 | RNAV (cifp) | -650 m | 1.5 km |
| KL35 | 26 | RNAV (cifp) | -636 m | 2.3 km |
| KCOS | 17L | ILS (cifp) | -631 m | 2.5 km |
| KBCE | 03 | RNAV (cifp) | -624 m | 3.3 km |
| K4V0 | 24 | RNAV (cifp) | -621 m | 1.8 km |
| KLAR | 30 | RNAV (cifp) | -608 m | 1.3 km |
| KGNT | 31 | RNAV (cifp) | -602 m | 1.5 km |
| KMMH | 27 | RNAV (cifp) | -596 m | 1.0 km |
| KTEX | 09 | LOC (cifp) | -596 m | 2.5 km |
| MMMX | 05R | ILS (navdat) | -586 m | 1.5 km |
| KCOS | 30 | RNAV (cifp) | -567 m | 2.3 km |
| KAEG | 04 | RNAV (cifp) | -562 m | 1.5 km |
| KJTC | 21 | RNAV (cifp) | -549 m | 2.5 km |
| KCYS | 27 | ILS (cifp) | -548 m | 2.0 km |
| KTVL | 18 | LDA (cifp) | -540 m | 2.8 km |
| KLAR | 21 | RNAV (cifp) | -538 m | 2.5 km |
| KBTM | 15 | ILS (cifp) | -535 m | 2.0 km |
| U55 | 18 | RNAV (cifp) | -529 m | 6.3 km |
| KO02 | 25 | RNAV (cifp) | -528 m | 2.8 km |
| KBIH | 30 | RNAV (cifp) | -524 m | 14.3 km |
| KDRO | 21 | RNAV (cifp) | -523 m | 3.3 km |
| KLVS | 20 | RNAV (cifp) | -521 m | 2.3 km |
| KPNA | 11 | RNAV (cifp) | -519 m | 2.5 km |
| K40U | 25 | RNAV (cifp) | -516 m | 2.5 km |
| KEMM | 16 | RNAV (cifp) | -511 m | 5.5 km |
| KSRR | 24 | ILS (cifp) | -503 m | 1.8 km |
| PHHN | 08 | RNAV (cifp) | -502 m | 18.3 km |
| KALS | 20 | RNAV (cifp) | -500 m | 6.0 km |
| KPSO | 01 | RNAV (cifp) | -500 m | 3.3 km |
| KCYS | 09 | RNAV (cifp) | -499 m | 2.3 km |
| KAPA | 35R | ILS (cifp) | -486 m | 4.8 km |
| KRTN | 02 | RNAV (cifp) | -480 m | 1.8 km |
| K4V0 | 06 | RNAV (cifp) | -479 m | 2.5 km |
