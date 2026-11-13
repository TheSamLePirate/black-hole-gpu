# J3-0 (préparation) — l'inventaire des réglages compensatoires (13 novembre 2026)

[PLAN-J3](../../PLAN-J3-LUMIERE-COCKPIT.md) J3-0 : la sortie de J3 demande une scène « sans réglage compensatoire propre à chaque cadrage ».
Avant toute mesure, la liste de ce qui, dans le code, ajuste l'image selon le cadrage, le point de vue, la monture ou ce qui est en vue.
**Lecture du code seulement** (agent d'exploration, deux points revérifiés à la main : le mélange de la médiane et `shadowKeep`) ; aucune
mesure ; rien n'est changé. Le plan J3 attend la validation de Sam.

**Le jour sur la Terre** (la scène de J3) : les préréglages de vue de la Terre ne posent **aucun biais d'exposition** (`settings.ts`
`EARTH_VIEW`) ; les biais de `settings.ts` ~1475–1622 sont ceux de la Lune, de Mercure, d'Io, d'Europe, de Titan et de Pluton. La plupart
des ~30 réglages trouvés touchent la nuit, la Lune ou le télescope.

## Ceux qui pèsent sur une scène de jour (ville ou montagne)

| Réglage | Où | Ce qu'il fait | Dépend du cadrage | Nature |
|---|---|---|---|---|
| Mélange de la médiane au profil Caméra (⅓, ±1,5 EV) | `renderer.ts` ~9936 | la vue vers le ciel un peu plus sombre, vers le sol un peu plus claire | **oui, par conception** | **choix de Sam** (décision 32 : l'exposition qui « respire » comme un appareil) — pas une compensation ; J3 dit s'il reste dans la scène de jugement |
| `shadowKeep` | `renderer.ts` 3856 ; `display.wgsl` ~592–607 | défait l'écrasement des ombres du profil AgX « punchy » sous 20–60 km et un Soleil de 4–15° | **oui** (altitude de la caméra, hauteur du Soleil) | compensation d'un rendu tonal |
| Plafonds d'histogramme (0,5 % le plus clair, règle des 2 % dans l'air) | `renderer.ts` ~9926–9954, ~10025–10035 | retiennent l'exposition quand des hautes lumières brûleraient | **oui** (neige, reflet, ciel dans le champ) | garde d'exposition |
| Lumières de cabine rapportées à l'affichage | `ship.wgsl` ~2126–2163 ; `renderer.ts` ~8766 | la cabine éclairée quelle que soit l'exposition de l'extérieur | **oui** (monture cockpit) | compensation : pas d'adaptation propre à la cabine |
| Écrêtage du ciel reflété par la mer (`min(sonde, 4 × ciel clair)`) | `trace.wgsl` ~9581 | le ciel de la sonde borné | en partie (la sonde existe autour de la caméra) | compensation d'un modèle manquant (« l'échelle nocturne de la sonde reste à tracer ») |
| Adaptation des villes (`CITY_ADAPTATION`) | `renderer.ts` ~467, ~9883 | exposition baissée dans une ville éclairée | oui (lieu et hauteur de la caméra) | nuit surtout |

## Les autres (nuit, Lune, télescope, rendu tonal) — résumés

Exposition : base `0,4 / éclairement incident` (physique) ; adaptation de l'œil plancher ~1 lux ; règles de nuit 5 % / 15 % ; Lune éclipsée ;
spot du télescope ; maintien de l'exposition d'une scène figée ; fond « artistique » du ciel suivant l'exposition ; Purkinje. Appareil :
lampes du poste de l'A320, panneaux de l'A320 ×1,5 (textures FlightGear sombres), émissions rapportées à l'affichage, rayures de verrière
(monture cockpit). Ciel : plancher nocturne des nuages, halo des villes, gain de la Lune la nuit, voile des étoiles le jour, aurores. Sol :
`EARTH_NIGHT` (5 × le réel), albédo moyen du sol (« empirique »), lampes de rue. Rendu : le profil Caméra activé en vue de vol, sa courbe,
la réponse Film/ISS.

## Ce que J3-0 en fera (à valider avec le plan)

1. Fixer, avec Sam, ce qui compte comme « compensation » (le mélange de la médiane est un choix de rendu, pas une compensation).
2. Mesurer, à cadrages fixes de la scène J3, l'effet de chacun des six premiers (la sonde de cohérence appareil / sol, témoins d'abord).
3. ~~Un point non tranché : l'appareil entre-t-il dans le mètre d'exposition ?~~ — **mesuré (13 nov. ~15:05 UTC, kerr-mini, phase `framing`,
   `remote-results/…-j3-meter`)** : de trois quarts, l'appareil sur ~un tiers du champ, dessiné puis caché (`debugSkipShip`), profil Caméra
   (celui dont le mètre lit l'image) : **14,638 contre 14,639 EV** — l'appareil **n'entre pas** dans le mètre (sa scène est lue sans lui). La
   mesure par cadrage reproduite (chase +0,051, quarter +0,121 EV ; A/A 0,022 ; témoin +0,999).

## Mesure : l'exposition selon le cadrage (13 novembre 2026, ~15:00 UTC)

J0 (`J0_PHASES=framing`, kerr-mini, `remote-results/…-j3-framing`) : la même scène, la même lumière, vue du cockpit, de derrière (`chase`) et de
trois quarts (`quarter`) ; chaque monture posée l'horloge tournant, puis figée et l'exposition stabilisée ; `renderer.ev(settings)`.

| Profil | cockpit | chase | quarter | A/A (cockpit deux fois) |
|---|---:|---:|---:|---:|
| Caméra (décision 32 : la médiane mêlée) | 14,489 EV | **+0,059** | **+0,120** | 0,020 |
| Neutre | 14,645 EV | **0,000** | **0,000** | 0,000 |

Témoin positif : +1 EV injecté pour la seule `chase`, lu **+1,000**. **Lecture** : au profil neutre, **l'exposition ne dépend pas du cadrage** ;
au profil Caméra, elle respire de 0,06 à 0,12 EV selon ce qui est dans le champ (la conception, bien sous ses ±0,5 EV). Pour le critère de
sortie de J3, l'exposition n'est donc pas un réglage compensatoire propre au cadrage, aux deux profils, sur cette scène. **Non mesuré** :
`shadowKeep` (il dépend de l'altitude, pas de la monture), une scène où ciel et sol se partagent autrement le champ, la nuit.

