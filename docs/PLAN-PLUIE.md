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
| P2 | **La pluie qui tombe** | des gouttes variées (taille, éclat, longueur selon la vitesse de chute), floues tout près ; éclairées par le ciel et brillantes autour des lumières ; cachées derrière le vaisseau ; des rideaux poussés par le vent, un voile au loin ; mesuré | |
| P3 | **Les gouttes sur le verre** | le pare-brise : gouttelettes fixes, grosses gouttes qui glissent en laissant une traînée, qui remontent et s'étirent dans le vent relatif en vol, chassées à grande vitesse ; chacune une petite lentille (la scène retournée, floue) ; l'objectif en vue extérieure, quelques gouttes légères | |
| P4 | **Le sol mouillé** | dans le traceur, quand il pleut : sol et piste plus sombres et brillants, reflets du ciel et des feux, flaques, ronds d'impact près de la caméra ; mesuré (trace-ab) | |
| P5 | **Le son** | la pluie sur la verrière en cabine, sur la piste et l'herbe dehors, selon l'intensité et la vitesse ; synthétisé | |
| P6 | **Doc, finitions** | `docs/AUDIO.md`, `docs/comment-jouer.html`, la fiche système ; e2e (la pause) ; planche finale | |

Chaque étape : un commit, une planche dans `docs/progress/pluie/`, FR + EN.
