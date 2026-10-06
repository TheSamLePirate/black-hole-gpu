# Flight lab — campagne de vols des autopilotes

Le laboratoire de vol fait voler des **scénarios** complets dans la vraie application. Il les observe pendant le vol et mesure la **qualité** du pilotage. Un scénario part d'un état connu : une orbite, un plané, un amarrage, une mission de l'ordinateur de vol, une traversée du trou de ver. Il vole jusqu'à un verdict.

L'objectif est un autopilote de niveau AAA : il doit arriver, et il doit bien voler.

## Lancer

```bash
bun scripts/flightlab.ts list                               # les scénarios, leur durée estimée
bun scripts/flightlab.ts run --tags smoke                   # les 3 vols de contrôle (~1 min)
bun scripts/flightlab.ts run --only 'dock|glide'            # par expression sur l'id ou le titre
bun scripts/flightlab.ts run --shard 1/2                    # la moitié de la campagne, ici
bun scripts/remote.ts run --detach --name lab -- bun scripts/flightlab.ts run --shard 2/2   # l'autre, sur le mini
bun scripts/remote.ts doctor                                # le mini : joignable, internet, écran, bun, veille
```

- **Répartition :** les scénarios sont répartis par durée estimée, du plus long au plus court. La répartition est identique sur chaque machine, donc `1/2` ici et `2/2` là-bas couvrent tout une seule fois.
- **Chrome :** il tourne en headless sur ce Mac et en plein écran sur le mini (le choix habituel de `remote.ts`).

## Piloter pendant le vol

Pendant une campagne, le lanceur écoute sur `127.0.0.1:4711` (option `--port`). La commande `ctl` l'interroge, ici ou sur le mini via SSH avec `--host kerr-mini` :

```bash
bun scripts/flightlab.ts ctl status                         # le scénario en cours, le dernier échantillon complet, les événements
bun scripts/flightlab.ts ctl shot approche --to x.png       # une capture maintenant
bun scripts/flightlab.ts ctl eval '__bh.camera.entryRun?.app'  # une expression évaluée dans la page
bun scripts/flightlab.ts ctl pause | resume | skip | abort  # entre deux tranches de vol
bun scripts/flightlab.ts ctl note "rebond au toucher"       # une note dans le rapport
bun scripts/flightlab.ts ctl --host kerr-mini status        # la même chose sur le mini
```

La sortie affiche aussi une ligne toutes les 10 s (phase, hauteur, vitesse, autopilote, carte du hub), plus chaque message du pilote et chaque changement de phase.

## Ce qu'il écrit

`flight-results/<campagne>/` (ignoré par git) contient :
- `index.html` et `summary.json` pour la campagne entière ;
- un dossier par scénario, `<scénario>/` :

| Fichier | Contenu |
|---|---|
| `telemetry.jsonl` | Un échantillon par seconde de vol simulée (ou de temps réel en vol live) : position, vitesse, orbite, autopilote, carte du hub, entrée (phase, profil, approche), aéro (α, β, Mach, q, g, flux thermique, L/D), attitude, amarrage, warp, ergols. |
| `events.jsonl` | Messages du pilote, journal du jeu, changements de phase, erreurs de la page. |
| `graphs.json` | Les graphes des assistants (optimum, couloir, tracé volé) et la position de l'appareil à chaque échantillon. |
| `shots/` | Une capture à chaque changement de phase (autopilote, carte du hub, phase d'entrée, profil d'approche, amarrage, statut, univers), une à la fin, et celles prises à la demande. |
| `summary.json` | Le verdict, la raison, les mesures du scénario et les mesures de qualité `q_…`. |
| `report.html` | Le rapport graphique (ci-dessous). |

`bun scripts/flightlab.ts report <dossier>` régénère les rapports.

## Les graphiques (`report.html`)

- **Couloirs :** le graphe propre de chaque assistant (entrée, plané, descente, montée, approche, amarrage) avec son optimum, son couloir et le tracé enregistré par le HUD. Les points de l'appareil y sont colorés selon le verdict de l'assistant : dans le couloir ou hors couloir.
- **Approche :** la trace au sol par rapport à l'axe de piste, le profil vertical et le roulage.
- **Amarrage :** la distance au port, l'écart latéral et la vitesse de rapprochement.
- **Télémétrie :** hauteur, vitesse, vitesse verticale, **angle d'attaque α et dérapage β**, inclinaison volée et commandée, assiette, Mach, pression dynamique, facteur de charge, flux thermique, L/D, gaz, ergols, apsides, distance à la cible, warp.

Chaque graphique ne porte qu'une mesure, sans double axe. Il affiche un réticule et une infobulle au survol, et suit le thème clair ou sombre.

## Les mesures de qualité (`q_…`)

Elles sont calculées pour chaque scénario, quel que soit son verdict (`tests/flight/lib/quality.ts`) :
- `q_shipS` : la durée du vol (temps simulé) ;
- `q_gMax`, `q_alphaMaxDeg`, `q_qMaxKPa`, `q_heatMaxKWm2` : les maximums ;
- `q_alphaSwings` : les oscillations d'α de plus de 2° ;
- `q_bankReversals` : les inversions d'inclinaison commandée de plus de 15° ;
- `q_throttleChanges` : le battement des gaz ;
- `q_fuelUsed`, `q_dvSpentMps` : ce qui a été dépensé ;
- `q_corridor_<graphe>_pct` : la part du temps passée dans le couloir de chaque assistant.

## Écrire un scénario

Les scénarios sont dans `tests/flight/scenarios/<famille>.ts`, réunis par `index.ts`. Un scénario :
1. charge une scène (`scene(lab, "…")`, date fixée) ;
2. prépare l'appareil via `__bh` (`lab.js(…)`) ;
3. vole par phases, puis juge le résultat.

Il y a deux façons de voler :
- **`lab.fixed({ until, maxSim, maxWall })`** : pas fixes de 1/30 s, la page gelée. C'est rapide, puisqu'un pas ne fait aucun rendu, et le warp demandé par les autopilotes s'applique. Le vol est découpé en tranches de 5 s pour être observable.
- **`lab.live({ until, maxWall })`** : la boucle d'images de la page, comme un joueur. À utiliser pour le toucher, l'amarrage ou la traversée.

`until` est une expression JS évaluée dans la page sur `T`, le dernier échantillon, et `c`, la caméra. Chaque phase se termine aussi sur un échec commun : appareil perdu, crash annoncé, erreur de la page, état NaN, temps simulé figé.

Le découpage en tranches laisse tourner l'asynchrone de la page entre deux tranches (tuiles, cartes). C'est voulu, puisque c'est ce que vit un joueur. C'est ainsi qu'on a trouvé les tuiles de relief en terrasses, corrigées en `d533c6a`.
