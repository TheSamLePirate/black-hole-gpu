# Plan HUB — hub, télémétrie, graphiques (7 octobre 2026)

Le pilier UI de l'audit AAA est à 77/80 ([`AAA-PROGRESS.md`](AAA-PROGRESS.md)). Ce plan porte sur ce que le joueur regarde quand un autopilote ou un assistant vole :
- la carte du hub ;
- les instruments et bandeaux autour de la bille ;
- les graphiques des assistants ;
- la télémétrie du vol.

Il part d'un relevé à l'écran, fait sur dix états de vol fixes.

## Méthode

- **Dix états de vol de référence** dans `tests/hud/states/` : montée, circularisation, désorbitation, rentrée, plané, finale, roulage, descente lunaire, descente du Lander, amarrage à l'ISS. Ce sont des parties sauvegardées par le labo de vol à côté de ses captures (`LAB_STATES=1 bun scripts/flightlab.ts run …`).
- **`bun scripts/hud-gallery.ts <dossier> --sheet <planche.jpg>`** recharge chaque état dans une page headless, le laisse voler 3 s et le photographie : l'avant et l'après de chaque étape.
- **Test e2e `hud-layout`** : dans chaque état, aucun panneau ni instrument du canevas n'en recouvre un autre.
- **Chaque étape** : un commit, une planche avant/après dans `docs/progress/hub/`, en français et en anglais.

## Décisions du propriétaire (07/10/2026)

- **Télémétrie** : une page TÉLÉMÉTRIE dans la tablette (M), avec les courbes du vol (altitude, vitesse, g, chaleur, Δv…) sur une fenêtre allant d'une minute au vol entier et un export CSV, **et** un RAPPORT DE VOL à la fin d'un atterrissage ou d'un amarrage (toucher, axe, g max, Δv contre le plan, avec une note).
- **Graphe du hub** : la carte garde un petit graphe lisible ; **un clic l'ouvre en grand** (≈ 520 × 300) au-dessus de la vue, avec ses axes complets, une légende et une lecture au survol.

## Relevé initial (avant HB1)

- Le bandeau des données air (620 px de large) traversait la bille et passait sous la carte du hub. Son texte était coupé (« 1. », « FLAPS UP GE »).
- Pendant la rentrée, deux panneaux disaient la même chose : la carte ENTRY du hub et l'ancien encadré ENTRY, ce dernier posé sur le ruban de vitesse.
- Au décollage, le radar de stationnaire passait sous la carte du hub (368 px de haut).
- Les indices de touches recouvraient le bas du ruban de vitesse et sa boîte.
- La carte du vaisseau affichait 408,6 m/s une fois le Lander posé : la vitesse inertielle, c'est-à-dire la rotation de la Terre.
- Sur la mini-carte, l'étiquette d'un nœud débordait du panneau.
- Le graphe du couloir de rentrée n'indiquait pas la position actuelle de façon visible, et ses graduations étaient irrégulières.
- **Sauvegardes** (corrigé avant HB1, `7be5b69`) : la flotte et le site de rentrée n'étaient pas sauvegardés. Une partie rechargée changeait d'engin, de lieu ou de site, et une chute sauvegardée après la poussée de désorbitation replanifiait une désorbitation.

## Étapes

| # | Étape | Contenu | Statut |
|---|---|---|---|
| HB1 | **Mise en page sans chevauchement** | registre `hud/layout.ts` (panneaux mesurés, instruments du canevas placés par `fit`) ; données air en bloc compact à gauche de la bille ; radar de stationnaire et encadré de piste placés hors des panneaux ; ruban de vitesse au-dessus des indices de touches ; l'encadré ENTRY s'efface devant la carte du hub ; e2e `hud-layout` (10 états) | fait |
| HB2 | **La carte du hub** | une seule carte par fonction, la rentrée enrichie de ce que donnait l'encadré (écart de cap, gîte commandée et réelle, charge et son maximum, tendance de la chaleur, pics à venir) ; lignes homogènes (unités, tendances ▲▼, valeurs critiques en couleur) ; hauteur bornée (la carte du décollage : 368 px) ; vitesse affichée juste une fois posé ; débordements (mini-carte, libellés coupés) | **en partie** : la carte ENTRY complète (distance et écart de cap, écoulement, gîte consigne/actuelle, charge et maximum, flux et tendance, pics à venir ; l'encadré supprimé) ; la vitesse sol une fois posé (carte du vaisseau et rubans), plus de données air à l'arrêt ; la ligne « circulaire » de la mini-orbite raccourcie ; l'état du rendu coupé masqué en vol ; une désorbitation attendue reprise au chargement (`entryPlan`). Restent : hauteur bornée, lignes homogènes |
| HB3 | **Les graphiques** | `graph.ts` : graduations rondes et unités, point « vous êtes ici » toujours visible (flèche au bord s'il sort du cadre), trace passée et prédiction, légende ; **clic = grand panneau** (axes complets, lecture au survol) | à faire |
| HB4 | **La télémétrie** | enregistreur du vol (temps simulé, échantillonnage adaptatif) ; page TÉLÉMÉTRIE de la tablette : courbes choisies, fenêtre de 1 min au vol entier, export CSV ; **rapport de vol** à l'atterrissage et à l'amarrage, avec une note | à faire |
| HB5 | **Finitions** | i18n FR/EN, e2e (graphe agrandi, télémétrie, rapport), `HUD.md`, planche finale | à faire |
