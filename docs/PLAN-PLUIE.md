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
| P6 | **Doc, finitions** | `docs/AUDIO.md`, `docs/comment-jouer.html`, la fiche système ; e2e (la pause) ; planche finale | |

Chaque étape : un commit, une planche dans `docs/progress/pluie/`, FR + EN.
