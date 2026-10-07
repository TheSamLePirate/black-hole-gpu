# Campagne autopilotes — 7 octobre 2026

**État au 7 octobre 2026, soir : la branche `test-kimi` est fusionnée dans `main` (avance rapide, `229b2f3`) et déployée** (site et `/test/`, CI vert).

Suite de la campagne du 6 octobre : vérification de la branche de Kimi, puis tests des pilotes automatiques, de l'ordinateur de vol et du hub. Le travail s'est fait en une seule voie, avec les vols sur ce Mac (Chrome headless) et les vérifications sur kerr-mini. Chaque défaut trouvé est corrigé avec un test de régression, puis le scénario est revolé. L'objectif fixé : « le meilleur autopilot possible, AAA ».

## Note

Chaque domaine est noté sur 20 selon quatre critères : le taux de réussite des scénarios, la précision à l'arrivée, la robustesse (dates, vent, temps réel, reprise après erreur) et la sobriété en Δv face à l'optimum.

| Domaine | Note | Pourquoi |
|---|---|---|
| Rentrée et planés jusqu'à la piste | **17/20** | 4/4 rentrées et 7/7 planés, avec vent, haute énergie, circuit et finale en temps réel. Toucher à 0,3–0,7 m/s, à 0,1–1,1 m de l'axe. Reste : l'avion flotte au Bourget. |
| Lander et descentes propulsées | **16/20** | 4/4 sites (Kennedy, Jezero, Gale, Titan), 2/2 stationnaires, 5/5 atterrissages lunaires. Titan à 620 m du site, les autres à moins de 1 m. |
| Montées et décollages | **14/20** | 2/2 depuis Kennedy, mais Δv à +27–30 % de l'optimum. Le Lander quitte Mars sur une orbite de 255,5 km pour 250. |
| Amarrage et rendez-vous | **18/20** | 12/12 amarrages à 0,08–0,09 m/s, dont une cible qui tourne à 18°/s. Rendez-vous ISS, Endurance et Lander avec un Δv à 4–8 % du plan. |
| Missions vers une lune ou une planète | **15/20** | Lune à 100,2–100,7 km pour 100, Mars à 300,4–302,5 km pour 300, retour libre réussi. Δv à 0,2 % du plan. **Jupiter échoue.** |
| Gargantua et trou de ver | **12/20** | La mission automatique vers l'étoile compagne réussit. Les points 9 et 10 du plan n'ont pas été traités (retour par le trou de ver, chauffe à Edmunds, décollage de Miller). |
| Fiabilité des tests | **15/20** | Tests unitaires 508/0 et CI vert. Chaque test e2e passe seul, mais chaque suite complète sur le mini a 1 ou 2 échecs aléatoires au démarrage. |
| **Note globale** | **15/20** | **Solide sur l'essentiel, pas encore AAA.** Pour viser 18/20 : réussir Jupiter ; ramener la montée près de l'optimum (+10 % au plus) ; unifier les repères de pôle ; finir le trou de ver et Gargantua ; stabiliser le harnais e2e. |

## Résultats

| Domaine | Au début (6 oct.) | Maintenant |
|---|---|---|
| Rentrées Ranger depuis l'orbite (Edwards, Kourou, Le Bourget 51,6° et 45°) | 0/4 | **4/4** — couloir de rentrée 100 % (62 % avant), 4 inversions d'inclinaison (11–24 avant), toucher 0,3–0,7 m/s à moins de 5 m de l'axe |
| Planés jusqu'à la piste (7 scénarios : haute énergie, vent modéré, circuit, finale courte en temps réel…) | 2/7 | **7/7** — toucher 0,3–0,7 m/s, 0,1–1,1 m de l'axe |
| Lander (Kennedy, Jezero, Gale, Titan) | 0/4 | **4/4** — 0 m, 1 m, 1 m, 620 m du site |
| Lander en stationnaire au-dessus de Kennedy | — | **2/2** |
| Atterrissages lunaires (stationnaire, depuis l'orbite, Tranquility et Shackleton) | — | **5/5** |
| Montées depuis Kennedy (28,5° et 51,6°) | 0/2, Δv +47 %, 987 s | **2/2**, Δv +27–30 %, 560 s, couloir de montée du HUD 99–100 % (21–25 % avant) |
| Amarrages (ISS de 60 m à 2,9 km, décalé, tourné ; Endurance avant et arrière ; Lander ; désamarrage puis réamarrage) | — | **12/12**, contact à 0,08–0,09 m/s |
| Amarrage à l'Endurance en rotation (3 tr/min), arrêt de la rotation, montée à 400 km | — | **réussi** — rotation arrêtée en 443 s, orbite 400 × 402 km |
| Rendez-vous puis amarrage (ISS, Endurance, Lander) | échec ISS (précision latérale) | **3/3** — Δv 69/65, 266/261, 134/129 m/s (volé/prévu) |
| Mission vers une orbite lunaire de 100 km (deux dates) | 102,7 km un jour, 23 km ou impact un autre | **100,2–100,3 et 100,6–100,7 km**, Δv 3 898 pour 3 893 prévus |
| Mission vers une orbite martienne de 300 km | 292,6–294,8 km | **300,4–302,5 km** |
| Retour libre lunaire (Artemis II) | réussi | **réussi** — passage à 7 009 km, périgée 205 km |
| Mission Gargantua automatique (trou de ver, étoile compagne) | — | **réussie** |
| Mission vers Jupiter | jamais volée | **échec** (voir « Reste à traiter ») |
| Tests unitaires | — | **508/0** |
| E2E complet (mini) | 110/0 (matin) | **108/2** — les 2 échecs, aléatoires, passent seuls |

![La désorbitation vers Edwards, replanifiée 1 h 30 avant la poussée](progress/campagne-autopilotes/1-desorbitation-edwards.jpg)

![Finale à Kennedy après une arrivée à 60 km, 28 km d'altitude et 850 m/s : sur l'axe à 2,3 km](progress/campagne-autopilotes/2-finale-kennedy-haute-energie.jpg)

![Le Lander posé sur la piste de Kennedy, sur l'axe, après 6 jours d'attente en orbite et une correction de plan](progress/campagne-autopilotes/3-lander-pose-kennedy.jpg)

## Ce qui a été corrigé

### Rentrée (`entry.ts`, `lowthrust.ts`, `piloting.ts`)
- **Rebond phugoïde** : à 55° d'inclinaison, la ressource remontait de 3 km au-dessus du couloir pendant dix minutes. La montée est maintenant amortie plus fort (0,05 rad par m/s au-dessus de 5 km/s, 0,01 en dessous : plus fort à basse vitesse, le vol devenait sensible à la fréquence d'image). Le rebond tombe à 0,6 km.
- **Couloir du HUD** : sa limite haute (vol plané d'équilibre) ignorait la rotation de la Terre. Vers l'est, la vitesse inertielle est 330 m/s plus grande, donc l'équilibre est 1–2 km plus haut : toutes les rentrées vers l'est semblaient « hors couloir ».
- **Désorbitation de la capsule** : le planificateur propage maintenant avec la propagation même du vol (rails, traînée, Lune, Soleil). Il replanifie au plus tard 1,3 orbite avant la poussée. Si aucun passage n'est à portée, une poussée de correction hors plan a lieu un quart d'orbite avant l'arrivée (0,9 km par m/s, contre 0,34 à la poussée de désorbitation), puis l'heure de poussée est recalculée. Le Lander passe de 86 km à 434 m de Kennedy.

### Approche et atterrissage sur piste (`computer.ts`)
- **Spirale** : le nombre de tours est compté sur l'énergie totale (vitesse plafonnée à 200 m/s, le reste étant dissipé par le frein aérodynamique), et le cercle rétrécit à mesure que l'avion ralentit. Avant, la finale commençait à 135 m/s trop bas et le train cassait.
- **Variation de pente limitée hors finale** (+0,7 g) : 3,8 g à l'entrée de spirale avant.
- **Pas de « finale » au-delà du seuil en altitude** : un vol a suivi l'axe sur 50 km après le bout de piste.
- **Intégrale sur l'erreur de route** dans les 600 derniers mètres : le cisaillement du vent laissait 9 m d'écart.
- **Taux de chute minimal** une fois le point de toucher dépassé : l'avion flottait 12 s puis s'enfonçait à 1,7 m/s.

### Lander et descente propulsée (`descent.ts`, `pilot.ts`)
- Plus de **battement entre les modes** « à plat vectorisé » et « fusée » à 25 m/s, ni de translation basse sous la porte de 40 m : il tombait à 13 m/s.
- **Poussée proportionnelle à l'alignement** (de 60° à 25° d'écart) à l'atterrissage : la poussée coupée pendant le pivotement créait une oscillation d'assiette de 6 s et il tombait.
- Dans une atmosphère dense, **remise plus en amont** du pad (selon la distance de freinage du Lander, ~21 km sur Terre).
- **Titan a un sol** (il était déclaré « gaz » : l'autopilote n'avait rien où se poser).

### Montée (`lowthrust.ts`)
- **Guidage explicite hors de l'air** : temps restant jusqu'à la vitesse orbitale, et accélération verticale linéaire qui amène l'altitude visée avec une vitesse verticale nulle (résolue par dichotomie). Avant, la montée rampait 450 s sous l'orbite (11,3 km/s dépensés).
- **Fin de montée** sur la vitesse horizontale (0,5 %), et non sur sa seule composante est.
- Le profil « optimum » du HUD est maintenant une simulation point-masse de la même loi.

### Harnais du labo de vol
- Télémétrie : écart prédit par le guidage, pente visée et volée, aérofrein, cercle de spirale, piste et roulette au roulage.
- `__bh.sys.nav()` (état de navigation des autopilotes) et `__bh.sys.geodetic()`.
- Distance au pad mesurée même quand l'engin glisse encore.
- Un dossier de campagne réutilisé est vidé scénario par scénario : le juge lisait la télémétrie d'un vol précédent.

## Nouvelle scène : l'Endurance en rotation

« Earth: the Endurance tumbling, 300 km up » (galerie : *Docking to the tumbling Endurance*). L'Endurance tourne à 3 tr/min (18°/s) autour de l'axe de son moyeu, à 300 km (au-dessus de l'air du jeu, qui s'arrête vers 296 km : orbite sur rails, coque froide), avec le Lander amarré au port arrière. Le Ranger, piloté, est à 150 m sur l'axe du port avant.
Il faut d'abord s'amarrer en accordant la rotation (B : amarrage automatique). La capture exige moins de 3°/s de rotation relative. Il faut ensuite arrêter la rotation de l'ensemble avec le SAS (environ 7 min avec les seuls propulseurs du Ranger), puis prendre les commandes de l'Endurance (`[ ]`) et monter à 400 km.
Le scénario `endurance-tumbling-dock` réussit : amarrage à 0,09 m/s, rotation arrêtée en 443 s, transfert de Hohmann de 62 m/s, orbite à 400 × 402 km. Les 12 scénarios d'amarrage réussissent tous (12/12).

![Finale à 10 m du moyeu de l'Endurance en rotation : sur l'axe, ports face à face, rotations accordées](progress/campagne-autopilotes/4-endurance-en-rotation-finale.jpg)

Ce qu'elle a révélé et qui est corrigé :
- **Page figée 5 minutes** au chargement et pendant l'approche. Pour tracer la trajectoire de l'Endurance, la carte l'intégrait pas à pas depuis maintenant pour chaque point du tracé. Sous ~300 km il n'y a pas de rails, car l'engin est dans l'air. La carte utilise maintenant la propagation analytique pour un engin dans l'air. L'intégration exacte reste sur rails, et elle est limitée à 10 min d'avance dans l'air : une date de scène 40 ans plus tard faisait un million de pas par pose.
- **Coque à 890 K à 220 km** (commit `6808fc1`) : la peau rayonnait vers la température du gaz de la thermosphère au lieu de l'espace.
- **Pilote d'amarrage contre une cible qui tourne** :
  - la rotation de la cible est anticipée (sans cela, l'écart de roulis passait 180° et le pilote repartait en arrière) ;
  - le point suivi est celui de l'axe du port en face de l'anneau, et non le point qui tourne (le Ranger restait à 5 m, toute sa poussée prise par la force centripète) ;
  - la vitesse de l'anneau inclut la rotation propre du vaisseau (l'anneau du Ranger est à 1,1 m de son axe de roulis).
- **Capture** : l'ensemble garde la rotation, moyennée par les inerties. Le pilote ne la coupe plus instantanément et le SAS la freine selon l'inertie de l'assemblage.

## Missions vers une lune ou une planète : la visée et l'exécution

Le scénario lunaire partait de l'heure réelle : chaque vol était une autre mission. Il réussissait parfois, arrivait à 23 km pour 100 un autre jour, ou s'écrasait sur la Lune. Un balayage de 12 dates de départ sur 3 jours a isolé trois défauts. Les scénarios lunaires ont maintenant leur propre date de départ, la même à chaque vol.

- **Correction exécutée de travers.** Pendant une poussée finie, le vol convertit l'impulsion du nœud pour suivre le repère orbital qui tourne avec la vitesse (`followDv`). Le planificateur appliquait au contraire les composantes brutes. La visée compensait donc la rotation une fois, et le vol une deuxième fois. Mesure : une correction de 43 m/s volée à 0,886° de la prévue, et un périlune lunaire à 16 km au lieu de 100. Le planificateur exécute maintenant les poussées comme le vol : il reste 0,14°.
- **Visée du départ en échec une fois sur deux.** Le point du plan B était calculé sur l'hyperbole osculatrice du premier échantillon entré dans la sphère de la Lune. Ce point sautait d'un échantillon à l'autre au moindre changement de la poussée, et la jacobienne du solveur n'était que du bruit. Le croisement de la sphère et la plus proche approche sont maintenant interpolés. Autres changements :
  - un départ ~180° avant la Lune ne pilote presque pas le côté de passage (hors du plan de l'orbite lunaire) : on ne le lui demande plus, et la correction à mi-parcours le règle ;
  - le solveur de Newton devient un Levenberg-Marquardt.

  Le périlune prévu dès le plan passe de 789–9 000 km à 102–105 km, et la correction à mi-parcours de 20–330 m/s à 5–7 m/s.
- **Boucle fermée.** Après une correction à mi-parcours, une correction de rattrapage est prévue à mi-chemin du reste du trajet (deux au plus). Elle est visée depuis l'état réel, et abandonnée si inutile. En vol, la visée vers une lune est tenue à 3 km au lieu de 10. Après la capture, si l'orbite s'écarte de plus de 1 % de l'altitude demandée (2 km au moins), un transfert de Hohmann l'y ramène. `planOurOrbit` fait maintenant ce Hohmann dès 1 km d'écart (avant : 1 % du rayon, soit 18 km pour la Lune).

Résultats (scénarios du labo) :

| Mission | Avant | Maintenant |
|---|---|---|
| Lune, 100 km (date du cas difficile) | 16 km (correction 43 m/s) | **100,2–100,3 km**, Δv 3 898 pour 3 893 prévus |
| Lune, 100 km (variante) | 23 km, ou 106 km et +670 m/s | **100,6–100,7 km**, Δv 3 898 pour 3 893 |
| Mars, 300 km | 292,6–294,8 km | **300,4–302,5 km** |
| Retour libre lunaire, rendez-vous ISS / Endurance / Lander, mission Gargantua | réussis | réussis |

Outils ajoutés au harnais : `__bh.sys.predictClosest(id, jours)` donne la plus proche approche prévue par le propagateur du planificateur. `__bh.sys.predictAt(...)` donne l'état prévu après des nœuds, ce qui permet de comparer une poussée volée et la même poussée planifiée. La télémétrie des recalculs indique aussi si la visée a convergé et le passage qu'elle prévoit.

## Intégration continue et performances

- **Rendez-vous ISS planifié en 0,7 s au lieu de 1,6** (`89ccf20`). Le serveur de GitHub dépassait la limite de 2 s du test (2,3 s). L'orientation de la Terre prenait la moitié du temps : ses produits de matrices passaient par `map()`, et le pôle de date n'était gardé qu'à un seul instant, si bien que le planificateur le recalculait sans cesse.
- **`/test/` retiré à chaque déploiement** (`281b356`). La vérification de `test-kimi` échouait sur le serveur de GitHub pour deux raisons. Le test du verrou Chrome attendait la minute de sommeil de ses faux Chrome, qui gardaient sa sortie ouverte. Le test des tuiles de terrain prenait 4,9 s pour une limite de 5 s.
- **Références e2e** (`229b2f3`) :
  - chaque carte de la galerie de scènes a son `data-testid` : le cliquet `s5` passe de 101 contrôles sans identifiant à 22 ;
  - les vols de référence sont réenregistrés après les changements de physique du jour, identiques au bit près sur ce Mac et sur le mini.

## Reste à traiter

- **Jupiter** (`mission-jupiter-orbit`, jamais volée avant cette campagne) : la sonde n'entre pas dans la sphère de Jupiter. Les recalculs ne demandent plus de correction après la première, alors que la trajectoire volée s'éloigne de la cible : le planificateur se croit sur sa visée. Ce n'est pas une régression : la mission échoue aussi avec le code d'avant ces corrections (8 308 m/s dépensés). **Priorité 1.**
- **Montée** : Δv à +27–30 % de l'optimum. Le décollage du Lander depuis Mars donne une orbite de 255,5 km pour 250 (limite 5 km) ; la circularisation laisse 250 × 261 km.
- **Repères de pôle** : le HUD et le décollage mesurent l'inclinaison par rapport au pôle J2000, alors que les sites sont posés dans le repère de date. Pour la Lune (pôle à ~2° du J2000), le Lander ne peut pas viser 1° depuis Tranquility (il obtient 2,66°). Il faut tout unifier sur le pôle de date.
- **Le Bourget** : toucher à 75 m/s, l'avion flotte encore un peu avant le point de toucher.
- **Points 9 et 10 du plan** : le retour par le trou de ver (compromis sur le réservoir) et Gargantua (chauffe à Edmunds, décollage de Miller, orbites à faible poussée).
- **Harnais e2e** : chaque suite complète sur le mini a 1 ou 2 échecs aléatoires, jamais les mêmes, qui passent quand on relance le fichier seul. Cas observés :
  - le panneau de placement qui ne s'ouvre pas en 10 s ;
  - le chargement d'`assist-burn` en plus de 180 s, puis le verrou Chrome encore tenu au test suivant ;
  - plus tôt, la manette (« Start pauses and B resumes »).

## Commits

| Commit | Contenu |
|---|---|
| `c1745b7` | Rentrée : rebond amorti, couloir corrigé, désorbitation de la capsule |
| `c5e6901` | Approche : spirale, intégrale de route, toucher ferme |
| `e0c69ba` | Labo : télémétrie du guidage, `__bh.sys.nav` / `geodetic` |
| `ad3d173` | Descente : plus de battement entre modes |
| `ecd9106` | Montée hors de l'air ; Lander sur Terre, Mars et Titan |
| `3c130e8` | Premier rapport de campagne |
| `aef1ad4` | Labo : recalculs de nœuds dans la télémétrie ; reproduction de la mission lunaire ratée |
| `89ccf20` | Performance : planification ISS 0,7 s (CI) |
| `281b356` | CI : verrou Chrome et tuiles de terrain sur le serveur de GitHub |
| `6808fc1` | Aéro : plus de surchauffe dans la thermosphère |
| `af9b583` | Scène de l'Endurance en rotation ; amarrage à une cible qui tourne ; carte figée |
| `e17e9b2` | Scène : départ à 300 km, objectif 400 km |
| `eedef67` | Missions : poussée volée comme visée, visée qui converge, boucle fermée |
| `229b2f3` | E2E : cartes de scène nommées, vols de référence réenregistrés |

Tous poussés ; `main` = `test-kimi` = `229b2f3`.
