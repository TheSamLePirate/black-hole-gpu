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
| **A2** | Le temps | L'horloge de la barre de transport ouvre un panneau : **maintenant** (date réelle), **début de la scène**, **date choisie** (UTC) ; le vaisseau garde son état **relatif à son corps de référence** (posé : même lieu ; en orbite : même orbite), les autopilotes et le plan replanifiés | à faire |
| **B1** | Caméra libre : découplage | Une pose **caméra** distincte de la pose **vaisseau** : le traceur rend depuis la caméra, le vaisseau (physique, autopilotes, plan) continue de voler et est dessiné là où il est | à faire |
| **B2** | Caméra libre : vol | Portée illimitée (vitesse adaptée à la distance du corps le plus proche), « aller à » chaque corps, retour au vaisseau, carte du vaisseau dans le HUD pendant l'absence (télémétrie, autopilote, alertes) | à faire |
| **C0** | Cadre des assistants | Pour chaque fonction : **AUTO / ASSISTÉ** à tout moment (l'assisté garde le plan et la guidance ; l'auto reprend là où l'on est) ; carte d'assistant (phase, prochaine action et son **compte à rebours**, consignes) ; panneau de **graphe** (HUD + écran cockpit) ; **alertes expliquées** (pourquoi, que faire) | à faire |
| **C1** | Poussées | Nœud, circularisation, Hohmann, inclinaison, rendez-vous, interception, accord des vitesses, poussées FC, transfert : compte à rebours d'allumage, visée, **Δv restant suivi en manuel**, consigne de coupure ; graphe du Δv et de l'orbite visée | à faire |
| **C2** | Décollage et montée | Directeur de vol (programme de tangage, azimut), comptes à rebours (virage gravitationnel, coupure), graphe **altitude / distance** avec le couloir optimum et l'apoapside prédite, max-Q | à faire |
| **C3** | Désorbitation et rentrée | Poussée de désorbitation (C1) ; **couloir de rentrée** (altitude et vitesse / distance, limites de chaleur et de charge, trajectoire prédite) ; directeur d'inclinaison du prédicteur-correcteur, compte à rebours des inversions | à faire |
| **C4** | Approche et atterrissage sur piste | PAPI, portes et glide **aussi en manuel** ; directeur de vol du plané ; graphe **altitude / distance** avec le plan de descente ; compte à rebours de l'arrondi | à faire |
| **C5** | Atterrissage vertical et stationnaire | Graphe **altitude / vitesse verticale** avec la courbe de freinage optimale (couloir), compte à rebours de la poussée, dérive | à faire |
| **C6** | Approche, rendez-vous, orbite de la cible | Graphe **distance / vitesse de rapprochement** avec le couloir de freinage, compte à rebours du freinage, directeur vers le point d'arrêt ; bouton « orbite de la cible » | à faire |
| **C7** | Amarrage | La guidance existante en assisté, bouton au hub, passage auto ↔ manuel, explications | à faire |
| **C8** | Finitions | Alertes expliquées partout, `docs/HUD.md`, aides contextuelles, e2e des passages auto ↔ manuel | à faire |
