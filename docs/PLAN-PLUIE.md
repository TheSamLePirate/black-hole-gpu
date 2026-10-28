# Plan PLUIE — une pluie AAA (10 octobre 2026)

Suite de la météo ([`PLAN-METEO.md`](PLAN-METEO.md), W5 : la pluie). Suivi global : [`AAA-PROGRESS.md`](AAA-PROGRESS.md).

## Le constat (10/10/2026)

Signalé par le propriétaire : « la pluie est mal faite, que ce soit en général et les gouttes sur le pare-brise ; elle doit se
mettre en pause quand le temps est en pause ». Captures au Bourget sous le préréglage Pluie (en finale, posé ; poursuite et
cockpit) :

- **En pause, la pluie tombait encore** : son horloge était celle du navigateur (deux images à 1 s d'écart, 127 000 pixels
  différents).
- **Les traînées** : un hachurage fin, régulier et gris sur toute l'image — mêmes gouttes, même éclat, même longueur ; dessinées
  aussi devant le vaisseau quand elles sont derrière lui ; ni profondeur, ni nappes, ni lumière (rien autour des feux de piste).
- **Le pare-brise** : quelques billes sur une grille grossière, à peine visibles ; ni ruissellement, ni traînées, ni petites
  gouttelettes.
- **Le sol** : sec sous la pluie — ni piste mouillée, ni reflets, ni flaques, ni impacts.
- **Le son** : aucun.

## Décisions du propriétaire (10/10/2026)

- **Des gouttes légères sur l'objectif** en vue extérieure (poursuite, aile, autour…), en plus de celles du pare-brise.
- **Le sol mouillé** (piste et sol sombres et brillants, reflets, flaques, ronds d'impact), **le son de pluie**, **les rideaux et
  rafales** (la densité en nappes poussées par le vent, des voiles au loin, plus forts sous l'orage).
- **Performante** : chaque étape mesurée ; le traceur ne paie la pluie que quand il pleut (comme `HAS_WX`).

## Étapes

| # | Étape | Contenu | Statut |
|---|---|---|---|
| P1 | **L'horloge** | la pluie suit le temps du jeu : en pause (et dans les menus), les gouttes restent immobiles, dans l'air et sur le verre ; l'image n'est plus redessinée pour rien | **fait** : `renderer.rainClock`, avancé par la boucle seulement quand le temps tourne (ni pause, ni menu, ni gel des tests) — il remplace l'horloge du navigateur ; l'image figée n'est plus recomposée à chaque image. e2e `rain` (en pause : l'image identique une seconde plus tard ; le temps reparti : l'horloge avance) |
| P2 | **La pluie qui tombe** | des gouttes variées (taille, éclat, longueur selon la vitesse de chute), floues tout près ; éclairées par le ciel et brillantes autour des lumières ; cachées derrière le vaisseau ; des rideaux poussés par le vent, un voile au loin ; mesuré | **fait** : `display.wgsl rainStreaks` — sept couches de 0,9 à 13 m ; chaque goutte sa taille, son éclat, sa chute (les grosses plus vite : traînées plus longues), effilée, plus vive en tête ; tout près, floue (plus large, plus pâle) ; **des rideaux** : la densité en nappes portées par le vent, plus marquées en rafales et sous l'orage (`rainView` donne les rafales) ; **un voile** de pluie lointaine ; éclairées par le ciel au-dessus et **brillantes autour des feux** (le halo du bloom) ; **cachées derrière le vaisseau** (sa distance à la caméra, `rainX`) ; à grande vitesse, plus clairsemées et plus pâles (elles filaient en tunnel). Coût : de l'ordre de 0,05 ms à 1440×900 (quelques centaines d'opérations par pixel, seulement sous la pluie ; le chronomètre GPU de la passe d'affichage n'est pas fiable sur Apple). Planche `p2-pluie.jpg` |
| P3 | **Les gouttes sur le verre** | le pare-brise : gouttelettes fixes, grosses gouttes qui glissent en laissant une traînée, qui remontent et s'étirent dans le vent relatif en vol, chassées à grande vitesse ; chacune une petite lentille (la scène retournée, floue) ; l'objectif en vue extérieure, quelques gouttes légères | **fait** : `display.wgsl wetGlass` — un champ de hauteur d'eau sur le verre (hauteur et pente) en trois couches : **des gouttelettes** qui arrivent, restent et sèchent, **une brume** de toutes petites, **de grosses gouttes qui glissent** par à-coups en zigzag, une traînée perlée derrière elles qui **essuie** les gouttelettes ; à l'arrêt elles descendent, en vol l'air les fait **remonter et s'écarter, étirées**, et balaie le verre au-delà de ~100 m/s ; chacune **une lentille d'eau claire** : la scène voisine retournée, un fin liseré sombre, un reflet net du ciel vers le haut, un peu de lumière à son pied. Dehors, **l'objectif mouillé** : quelques grosses gouttes floues (décision du propriétaire : légères). Planche `p3-verre.jpg` |
| P4 | **Le sol mouillé** | dans le traceur, quand il pleut : sol et piste plus sombres et brillants, reflets du ciel et des feux, flaques, ronds d'impact près de la caméra ; mesuré (trace-ab) | **fait** : `trace.wgsl earthGround`, dans le noyau de la météo (`HAS_WX`) — `P.wx[5]` : l'humidité du sol, la pluie, son horloge ; **le sol et la piste plus sombres** (pores et enrobé remplis d'eau), **un reflet du ciel** selon Fresnel (fort en vue rasante : la piste vue devant, argentée ; l'herbe peu, l'enrobé plus, une flaque un miroir) ; sur la piste, **des flaques** dans ses creux (plus nombreuses quand il pleut fort) et **les ronds des gouttes** qui s'élargissent et s'effacent, vus de près, figés avec le temps. trace-ab sur une courte finale au Bourget sous la pluie : la trace inchangée (12,75 → 12,70 ms). **Trouvé en route** : la pluie était calculée au vaisseau, pas à la vue — en spectateur (F3), la caméra partie en orbite gardait la pluie du Ranger : elle se calcule maintenant au contrôleur de la vue. Planche `p4-sol-mouille.jpg` |
| P5 | **Le son** | la pluie sur la verrière en cabine, sur la piste et l'herbe dehors, selon l'intensité et la vitesse ; synthétisé | **fait** : `audio/engine.ts buildRain` — deux crépitements synthétisés au démarrage (des impacts : une bouffée de bruit, certains qui sonnent comme une goutte sur une peau dure ; épars et denses), en boucle, et le souffle de la pluie. **Dehors** : le souffle large et les gouttes sur le sol ; **en cabine** : la verrière tambourinée (sa résonance), plus dense et plus forte avec la vitesse, le souffle à travers la coque ; **en pause, silence** ; entendue où est la vue. e2e `rain` (en cabine le tambour, dehors le souffle, rien en pause) |
| P6 | **Doc, finitions** | `docs/AUDIO.md`, `docs/comment-jouer.html`, la fiche système ; e2e (la pause) ; planche finale | **fait** : `AUDIO.md` (la source « pluie »), `comment-jouer.html` (la pluie dans Météo &amp; aéroports), la fiche `systemes/11` ; e2e `rain` (la pause, le son) ; planche `p6-final.jpg` |

Chaque étape : un commit, une planche dans `docs/progress/pluie/`, FR + EN.

## P7 — la verrière et la pluie refaites, sans traits de vitesse (28 octobre 2026)

Demande : « enlever les effets de vitesse (traits de vitesse) ; la pluie sur la vitre est nulle (grosses gouttes, peu de
mouvement), pas réaliste ; améliorer la pluie en général ; en vol, prendre en compte la vitesse de l'air ; le test sur ce Mac. »

- **Les traits de vitesse retirés** : `ui/speedfx.ts` ne dessine plus les traînées d'air devant l'œil (le réglage devient
  *Vignettage de vitesse* : les bords assombris ; le voile gris, noir, rouge sous facteur de charge inchangés) ; la pluie
  dans l'air (`display.wgsl rainStreaks`) n'a plus son tunnel de traits radiaux venant de devant — en vol rapide les gouttes
  proches s'effacent (au-delà de ~40 m/s), la pluie est celle de l'air (`trace.wgsl wxRainShafts`) et de la verrière.
- **L'eau sur la verrière** (`glassWater`) : des gouttelettes sur trois échelles (~1, 2 et 4 mm), qui naissent sans cesse et
  sèchent ; au sol ou lent, des gouttes de quelques mm qui coulent par à-coups en zigzag (deux jeux de colonnes), leur
  traînée perlée qui essuie les gouttelettes (avant : des gouttes de 2 à 9 % de l'image, ovales, presque immobiles).
- **En vol, le vent relatif** (`streamLayer`) : l'air balaie les gouttelettes et fait courir l'eau en filets fins (1,5 px au
  moins), une perle en tête, depuis la ligne d'arrêt au pied du pare-brise — sous le point d'où vient le vent relatif
  (`rainV` : le dérapage les incline, l'incidence les monte ou descend) —, vers le haut et l'extérieur ; leur vitesse ~3 % de
  la vitesse air (0,5 à 7 hauteurs d'écran par seconde), plus longs et plus fins plus vite, plus nombreux sous forte pluie.
- Test `tests/e2e/rain-glass.e2e.test.ts` (sur ce Mac, raster, cockpit du F-35, FPS affichés) : arrêté sur la piste du
  Bourget sous la pluie, à 150 m/s, dans l'orage à 220 m/s ; deux images à 0,25 s. Coût : la passe d'affichage
  26,2 → 26,3 ms au sol, 19,4 → 21,5 en croisière, 31,1 → 28,0 dans l'orage (son chronomètre inclut l'attente de l'image :
  aucune différence mesurable). Planches `p7-ground-avant/apres.jpg`, `p7-storm-avant/apres.jpg`, `p7-filets-zoom.jpg`.
- Vu en route, non traité : dans l'orage, des taches blanches carrées dans le ciel (déjà là avant).
