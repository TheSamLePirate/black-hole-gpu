# Plan : tout en manuel assisté, placement, temps, caméra libre

Demande du 04/10/2026 : tout ce que font le flight computer (FC) et le hub doit pouvoir se faire **en
manuel, assisté par le FC** — pour chaque fonction un assistant de vol (UI/UX soignée, HUD visuel,
compte à rebours des actions, graphes avec couloir optimum, alertes expliquées), avec **toujours** le
passage auto ↔ manuel ; dans l'interface, **placer le vaisseau** où l'on veut et **changer l'heure ou la
date** ; une **vraie caméra libre** pendant que le vaisseau continue son vol.

**Décisions du propriétaire (04/10/2026)** :
- ordre : **les outils d'abord** (placement, temps), puis la caméra libre, puis les assistants ;
- placement **toujours accessible** : pendant une mission, il demande confirmation et y met fin ;
- graphes d'assistance dans **un panneau du HUD** (près de la carte du hub, repliable) **et sur les
  écrans du cockpit** ;
- le temps se règle sur **la date réelle actuelle**, **le début de la scène** ou **une date choisie** (UTC).

Interface en FR + EN, langage HUD (kit `src/ui/kit`), e2e avec de vraies entrées. Un commit et une
fiche de progrès par phase, une capture par phase visuelle.

## État de départ (inventaire du 04/10/2026)

- **Autopilotes** (`src/pilot.ts`, `controller/lowthrust.ts`, `piloting.ts`, `plan.ts`, `docking.ts`,
  `computer.ts`) : maintien de position, circularisation, approche, orbite de la cible (sans bouton),
  nœud, poussées FC (Gargantua), transfert à faible poussée (sans déclencheur dans l'UI), atterrissage,
  décollage, amarrage (pas de bouton au hub), rentrée et atterrissage ; 9 maintiens d'attitude.
- **Aides manuelles existantes** : boîte de poussée (nœud : compte à rebours, Δv, visée), atterrissage
  vertical (portée de dérive, V/S, poussée d'arrêt), amarrage (portes, portée). **Liées à l'autopilote** :
  PAPI, portes et glide de piste, boîte de trajectoire de rentrée. **Absentes** : directeur de vol hors
  mode SF, couloir de rentrée, graphes de profil, suivi du Δv restant en manuel, explication des alertes.
- **Placement** : `__bh.game` (`placeAt`, `orbit`, `land`, `orbitOver`, `glideTo`) et l'onglet Place de F2,
  **réservé au mode développeur** ; rien pour le trou de ver.
- **Temps** : la barre de transport règle la vitesse ; l'horloge est en lecture seule ; la date ne se
  règle que dans F2 (développeur).
- **Caméra** : la pose des réglages *est* le centre du vaisseau ; les vues extérieures ne sont qu'un
  décalage de l'œil (la vue libre bornée à 50 km) ; le traceur rend depuis le vaisseau. Quitter le
  vaisseau (⇧K) coupe ses autopilotes (il dérive en Kepler).

## Phases

| # | Phase | Contenu | Statut |
|---|---|---|---|
| **A1** | Placer le vaisseau | Bouton « Placer » dans le HUD (et la roue, la tablette) → panneau : univers (le nôtre, celui de Gargantua), corps (tous, Gargantua, les deux bouches du trou de ver), **en orbite** (altitude, inclinaison ou péri/apo), **au sol** (globe cliquable, sites, lat/lon), **auprès** (à distance d'arrêt, en vol stationnaire), **devant le trou de ver** (de chaque côté) ; confirmation pendant une mission (qui prend fin) | fait |
| **A2** | Le temps | L'horloge de la barre de transport ouvre un panneau : **maintenant** (date réelle), **début de la scène**, **date choisie** (UTC) ; le vaisseau garde son état **relatif à son corps de référence** (posé : même lieu ; en orbite : même orbite), les autopilotes réactifs continuent, un plan fait sur l'ancienne horloge (nœuds, poussées FC, rentrée) est annulé et dit | fait |
| **B1** | Caméra libre : découplage | Une pose **caméra** distincte de la pose **vaisseau** : le traceur rend depuis la caméra, le vaisseau (physique, autopilotes, plan) continue de voler et est dessiné là où il est — un second contrôleur « sans tête » sur ses propres réglages (`src/controller/spectator.ts`), les réglages restant le vaisseau ; le sol du vaisseau (cartes et tuiles de la Terre, cartes LOLA/MOLA) gardé autour de lui pendant l'absence ; F3, V, le menu Vue ; deux façons : **suivre le vaisseau** (par défaut) ou **libre** ; bandeau et marqueur du vaisseau dans le HUD | fait |
| **B2** | Caméra libre : vol | « Aller à » chaque corps depuis le bandeau du spectateur (planètes, ISS, trou de ver, côté Gargantua — la caméra libre autour, le vaisseau continue), la molette règle la distance au vaisseau en mode suivi, ses moteurs se taisent au-delà de 2 km, la photo, le rendu et les prises partent de la vue ; la portée de la caméra libre (1000 M ≈ 990 UA de notre bouche) couvre déjà le système solaire | fait |
| **C0** | Cadre des assistants | **AUTO / ASSISTÉ** pour tous les autopilotes à la fois (F4, bouton de la carte du hub) : en assisté le FC calcule ses commandes — nez, haut, poussée, propulseurs — sans toucher aux commandes ; le **directeur de vol** du HUD les montre (anneau ambre → vert dans les 3°, repère du haut, flèche RCS, flèche au bord hors champ, consignes « tournez », « poussée x % », « coupez ») ; l'auto reprend où l'on est ; **alertes expliquées** (info-bulle, clic : pourquoi, que faire). Le panneau de graphes vient avec ses premières données (C5) | fait |
| **C1** | Poussées | Nœud (et tout ce qui en pose : circularisation, Hohmann, inclinaison, rendez-vous, interception) et poussées FC (côté Gargantua) **en assisté** : le **Δv restant suit la poussée du pilote** — sa part le long de la poussée (à rebours : elle reprend) —, le moteur n'est plus orienté pour lui ; allumée un peu tôt à la main, la poussée commence ; le temps ralentit au **temps réel** pour les dernières secondes avant l'allumage et la poussée dure 20 s au moins ; finie à 0,2 % (ou 10 cm/s) près **une fois le moteur coupé**. Directeur : **compte à rebours** (gros chiffres les 10 dernières secondes), « Δv RESTANT », jauge, « COUPEZ LE MOTEUR » clignotant. Carte du hub : orbite actuelle et **orbite visée** (ce qui reste de la poussée), **graphe Δv restant / temps depuis le nœud** avec l'optimum (poussée centrée sur le nœud) et son **couloir** (±15 % de la durée), la trace volée, le point vert dans le couloir, ambre hors ; repliable ; le même sur l'**écran PLAN du cockpit** (`src/ui/hud/graph.ts`, réutilisé par C2–C6). En assisté, un **maintien d'attitude** (1 : prograde…) garde l'autopilote — c'est la façon de suivre l'anneau ; la mission ne pose plus le sien. Le transfert à faible poussée et l'accord des vitesses (approche) : le directeur de C0, leurs graphes en C6 | fait |
| **C2** | Décollage et montée | Notre univers : la consigne de montée extraite en fonction pure (`climbCmd`, `climbTop`, `launchEast` dans `controller/lowthrust.ts`) et **intégrée en trajectoire optimum** (`climbProfile` : distance au sol, altitude, temps) ; carte du hub : hauteur sur le géoïde, **pente et cap actuels → visés**, q et **max-Q**, **comptes à rebours du virage gravitationnel et de la coupure** (le long du temps de l'optimum, depuis l'altitude atteinte) ; directeur : « PENTE 90° · CAP 090° », « VIRAGE GRAVITATIONNEL DANS … », « MAX-Q … kPa » à son approche, « COUPURE DANS ~… » ; graphe **altitude / distance au sol** : l'optimum, son **couloir** (15 % de la distance, 2 km et un cinquième de l'altitude de part et d'autre), la trace, **l'apoapside prédite et la hauteur visée** en niveaux, le cadre qui suit la montée (2,5 × l'altitude). Graduations sans chevauchement. Le côté Gargantua garde la carte de C0 | fait |
| **C3** | Désorbitation et rentrée | Poussée de désorbitation (C1) ; **couloir de rentrée** (altitude et vitesse / distance, limites de chaleur et de charge, trajectoire prédite) ; directeur d'inclinaison du prédicteur-correcteur, compte à rebours des inversions | à faire |
| **C4** | Approche et atterrissage sur piste | PAPI, portes et glide **aussi en manuel** ; directeur de vol du plané ; graphe **altitude / distance** avec le plan de descente ; compte à rebours de l'arrondi | à faire |
| **C5** | Atterrissage vertical et stationnaire | Graphe **altitude / vitesse verticale** avec la courbe de freinage optimale (couloir), compte à rebours de la poussée, dérive | à faire |
| **C6** | Approche, rendez-vous, orbite de la cible | Graphe **distance / vitesse de rapprochement** avec le couloir de freinage, compte à rebours du freinage, directeur vers le point d'arrêt ; bouton « orbite de la cible » | à faire |
| **C7** | Amarrage | La guidance existante en assisté, bouton au hub, passage auto ↔ manuel, explications | à faire |
| **C8** | Finitions | Alertes expliquées partout, `docs/HUD.md`, aides contextuelles, e2e des passages auto ↔ manuel | à faire |
