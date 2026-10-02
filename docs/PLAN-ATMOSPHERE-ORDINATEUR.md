# Plan — atmosphère, vol atmosphérique, rentrée, ordinateur de bord

Demande (2026-10-02) : la physique de l'atmosphère des planètes (frottement, chaleur à la sortie et à la
rentrée, toute la logique d'une rentrée et son graphisme), le vol dans l'air avec la portance (comme un
avion, comme une fusée, comme un vaisseau SF intelligent), et un vrai ordinateur de bord (tous les calculs
orbitaux, aligner les orbites, planifier comme un pro) intégré à la carte 3D, de qualité AAA. Tout doit
marcher dans le système solaire et dans celui de Gargantua.

Décisions de l'utilisateur :
- **Endurance** : vaisseau spatial classique, pas fait pour l'air — la physique s'applique quand même (pas
  de bouclier, pas de portance : elle brûle). **Ranger et Lander** : les trois modes de vol.
- **Mode SF** : fly-by-wire physique (limité par la poussée réelle) **et** un réglage « antigravité »
  (gravité et traînée compensées gratuitement).
- **Limites dépassées** (chaleur, charge) : alarmes puis destruction (écran d'échec, reprendre) ; un
  réglage « sans dégâts ».

## État de départ (exploration du 2026-10-02)

- Intégrateurs : `flyHome` (notre côté, Verlet/Yoshida, sous-pas `0.01·tDyn` dans l'air), `stepLocal`
  (landing.ts, RK4 dans le repère tournant des planètes de Gargantua), Kerr `advance()` ailleurs.
- Air : exponentiel `{rho0, H}` par corps (Terre, Mars, Vénus, Titan ; Miller, Mann, Edmunds), traînée
  balistique globale `B = 900 kg/m²` sans attitude ; ni portance, ni Mach, ni chaleur, ni charge.
- Plasma : une lueur de coque (`S.plasma`) à partir de Sutton–Graves ; la coque est encodée `o/(1+lum)`
  et jamais décodée (incandescence plafonnée).
- Pilote : commande en vitesse angulaire (SAS), maintiens, autopilotes (land, takeoff, circularize,
  node, transfer, dock…). Atterrissage : contact = arrêt (crash > 12 m/s), pas de roulage.
- Planification : nœuds P/N/R, planificateurs Kerr (géodésiques) et solaires (Hohmann, Lambert, B-plane,
  retour libre), grille Lambert cachée (porkchop jamais montré), carte 3D Canvas2D (chemins, nœuds,
  timeline). Manquent : opérations orbitales unitaires, angles de phase, inclinaison relative, fenêtres,
  durée de poussée, budget Δv, saisie numérique, rentrée ciblée.

## Phases (chacune : commit, fiche `docs/progress/NNN_*.jpg`, vérification en vol)

### P1 — Le cœur aéro-thermique (`src/aero.ts`, testé)
- Atmosphères par corps : densité, température, vitesse du son, composition (γ, R, constante de
  Sutton–Graves). Terre : US Standard 1976 (0–86 km) puis table jusqu'à 1000 km ; les autres :
  exponentielles avec leur température ; les planètes de Gargantua définies.
- Données aéro par vaisseau (`vessels.ts`) : aires projetées (boîte newtonienne), aile (surface,
  allongement, CLα, décrochage), traînée de frottement, rayon de nez, centre de poussée (stabilité),
  bouclier (direction, cône), limites thermiques (bouclier, coque), capacité thermique, charge maximale.
- Forces : boîte newtonienne modifiée (régime hypersonique) + aile subsonique/supersonique (portance
  linéaire, décrochage, traînée induite), traînée d'onde transsonique ; moments (marge statique,
  amortissement).
- Chaleur : convective (Sutton–Graves), radiative (Tauber–Sutton au-delà de 9 km/s) ; deux nœuds
  thermiques (bouclier, coque) avec rayonnement εσT⁴.

### P2 — La physique en vol
- Les forces aéro (selon l'attitude) dans les deux intégrateurs, au lieu de la traînée balistique.
- Les moments aéro dans le pilote (girouette, amortissement ; le SAS lutte avec son autorité).
- État thermique, facteur de charge, pression dynamique ; alarmes ; destruction (réglage « sans dégâts »),
  écran d'échec, reprise juste avant l'entrée dans l'air.
- Accélération du temps plafonnée dans l'air dense (« physics warp ») ; prédiction avec traînée (le point
  de chute sur la carte).

### P3 — Au sol : roulage
- Toucher des roues avec vitesse horizontale (la vitesse verticale seule compte pour le crash), roulage,
  freins, rotation et décollage par la portance — dans les deux univers.

### P4 — Les trois modes de vol (Ranger, Lander)
- **Fusée** : la poussée selon le nez, les moments aéro, le SAS.
- **Avion** : gouvernes (autorité ∝ pression dynamique), commande de vol électrique (taux de tangage,
  roulis, virage coordonné, protection décrochage), poussée selon le nez, RCS hors de l'air.
- **SF intelligent** : le manche commande la trajectoire (cap, pente, vitesse ; 0 = stationnaire),
  l'ordinateur compense gravité et traînée avec la poussée réelle (vectorisée) ; maintien d'altitude
  sol, évitement du relief ; antigravité en réglage.
- HUD de vol : vecteur vitesse, horizon, α, Mach, q, g, températures, mode.

### P5 — Le graphisme de la rentrée
- Décodage HDR de la coque (incandescence, bloom).
- Gaine de plasma (onde de choc volumique devant le bouclier, couleur selon la chaleur et le gaz),
  traînée ionisée, coque incandescente (corps noir), lueur dans le cockpit, cône de vapeur transsonique,
  traînées de condensation, tremblement de caméra, son (grondement, bang).

### P6 — La rentrée et la sortie pilotées
- Autopilote de rentrée : angle d'attaque tenu, modulation de l'angle de gîte vers le site (prédicteur–
  correcteur, inversions de gîte).
- Désorbitation vers un site d'atterrissage ; phases finales : planeur puis atterrissage (Ranger),
  atterrissage propulsé (Lander) ; montée avec max-Q et chaleur de sortie.

### P7 — L'ordinateur de bord : les calculs
- Opérations : circulariser (Ap, Pe, maintenant), changer Ap/Pe/demi-grand axe, Hohmann, changer
  inclinaison/nœud, aligner sur la cible (AN/DN), orbite résonante, interception (Lambert), affiner
  l'approche, accorder les vitesses, transferts (porkchop visible), retour d'une lune, désorbitation.
- Analyse : éléments complets, angle de phase et d'éjection, inclinaison relative, temps aux AN/DN,
  fenêtres et période synodique, rencontre (Pe, inclinaison, v∞, C3), durée et début de poussée,
  budget Δv (Tsiolkovski).
- Les deux univers : première estimation à deux corps, puis tir sur le vrai prédicteur (n corps ici,
  géodésiques de Kerr là-bas).

### P8 — L'ordinateur de bord : l'interface dans la carte 3D
- Carte plein écran : bibliothèque d'opérations à gauche, inspecteur de nœud à droite (saisie numérique,
  aimantation aux Ap/Pe/AN/DN/CA), bandeau de relation à la cible en haut, timeline et budget Δv en bas,
  porkchop, surimpressions (arc de phase, angle d'éjection, AN/DN relatifs, site d'atterrissage, point
  d'entrée, impact).

### P9 — Finitions
- Performances, tests, README, aide des raccourcis, écrans du cockpit (Mach, chaleur, g, mode).

## Avancement (2026-10-02)

| Phase | État | Commit · fiche |
|---|---|---|
| P1 cœur aéro-thermique | fait, testé (atmosphère standard, finesse, rentrée type navette) | `10be8d6` · 140 |
| P2 la physique en vol | fait (deux univers, ×4 dans l'air, limites, destruction, reprise, prédiction avec traînée) | `c4b5991` · 141 |
| P3 au sol, roulage | fait (toucher, roulage, freins, déporteurs, décollage) | `2de98e4` · 142 |
| P4 trois modes de vol | fait (fusée, avion électrique, ordinateur SF + antigravité, HUD air) | `a6387ca` · 143 |
| P5 graphisme de la rentrée | fait (gaine de plasma, peau incandescente, cockpit, cône de vapeur, tremblement, son) | `f4adff3` · 144 |
| P6 rentrée pilotée | fait (désorbitation planifiée, guidage, plané, atterrissage ; sites) | `a23d345` · 145 |
| P7–P8 ordinateur de bord | fait (opérations, porkchop, analyse, plan éditable ; Terre, Edmunds, Gargantua) | `a23d345`, `ef7f4ff` · 146 |
| P9 finitions | fait : calculs d'entrée dans le worker, écrans du cockpit, documentation | `90b169b`, `7b0dd25` |
| Pistes | fait : ralliement de l'axe, énergie, arrondi ; Kennedy, Edwards, Tanegashima, Edmunds | · 147 |
| Opérations autour de Gargantua | fait : circulariser, Ap, Pe, Hohmann, inclinaison, résonance, plan de la cible sur les géodésiques de Kerr ; poussées longues guidées vers leur objectif | · 148 |

Limites connues :
- les traînées de condensation des moteurs ne sont pas dessinées (le cône de vapeur, oui) ;
- les missions entre corps (onglet MISSION) restent celles du planificateur existant (notre système) ;
