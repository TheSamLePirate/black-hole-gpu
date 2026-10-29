# Plan — la caméra et les déplacements, AAA

Sur `main`. Objectif : **le meilleur système de caméra et de déplacement possible**, qui marche partout dans le
jeu (Gargantua, trou de ver, système solaire, Terre au ras du sol, cockpit, réseau) sans jamais sauter :

- **voyager vers n'importe quel objet** (planète, lune, ISS, trou de ver, trou noir, vaisseau, avion, bateau,
  joueur réseau) à une vitesse **relativiste**, avec **accélération constante jusqu'à mi-chemin puis décélération
  constante**, en choisissant **la vitesse ou la durée** ; les effets **visuels** (aberration, Doppler,
  projecteur) et **temporels** (horloge propre ≠ horloge du monde) visibles dès que la vitesse l'est ;
- **regarder où l'on veut pendant le voyage** (la tête libre, la trajectoire suit son cours) ;
- **une version cinématique** « comme au cinéma » : montage de plans (coupes) **ou** plan-séquence fluide, avec
  rase-mottes au-dessus des planètes ;
- **la caméra sur n'importe quel appareil** sélectionné (avion de ligne, IA, bateau, vaisseau, joueur réseau) :
  orbite/poursuite, poste de pilotage, tour/trépied — autour de cet appareil, pas du nôtre ;
- **une vitesse de déplacement libre proportionnelle à la distance de la surface** la plus proche (sphère
  d'influence), continue d'un corps à l'autre.

## Décisions (2026-10-29)

| question | réponse |
|---|---|
| qui voyage | **les deux, au choix** dans le panneau de voyage : l'**observateur** (caméra détachée, le vaisseau reste où il est, retour d'une touche) ou **le vaisseau** (il suit la même ligne d'univers, son équipage vieillit du temps propre) |
| l'horloge du monde | **le vrai temps coordonné** : le monde avance de t (les planètes ont bougé à l'arrivée) ; la HUD montre aussi τ, le temps propre du voyageur, et l'écart |
| la cinématique | **les deux** : « montage » (réalisateur automatique, coupes) et « plan-séquence » (un seul mouvement continu) |
| près des corps | **borne automatique par la sphère d'influence** : profil 1 g-retournement-1 g en espace profond, vitesse plafonnée par la distance au corps le plus proche ; relativiste loin, lent près des surfaces |
| vues autour d'un autre appareil | **orbite/poursuite**, **poste de pilotage**, **tour/trépied** (le fly-by ciné reste celui du montage) |
| livraison | ce plan, puis **phase par phase sur `main`** : commit + push + capture par phase, FR+EN, e2e, `bunx biome ci .` avant chaque push |

## Le point de départ (cartographie du 2026-10-29)

Il n'y a **pas d'objet caméra** : la pose est un ensemble de champs de `Settings` (`settings.ts:193-208` : `anchor`,
`distance`, `inclination`, `azimuth`, `whL`, `yaw/pitch/roll`, `vel*`, `motion`, `beta`), reconstruite à chaque appel
par `cameraFrame` (`camera.ts:206`). Notre système solaire passe par `setHomePose`/`homePosition` (`camera.ts:282`,
`:296`) : cartésien → sphérique (ℓ, i°, az°) → Settings, et retour, chaque image.

Ce qui rend la caméra « un peu compliquée » aujourd'hui :

1. **Caméra = vaisseau.** La pose du vaisseau piloté se déduit de la pose caméra et du point de vue
   (`fleet.ts:38` `activePoseNow`, `piloting.ts:737` `reorient`). Le spectateur doit cloner tout `Settings` et faire
   tourner un second `CameraController` (`controller/spectator.ts:71`).
2. **Angles d'Euler et sphériques comme stockage** : asin/atan2 à chaque écriture, cas spéciaux aux pôles, angle
   polaire borné 0,2°–179,8° (`camera.ts:66`, `:85`, `:268`). Perte de précision, blocage de cardan ; le « on a bougé
   ailleurs » se détecte en concaténant des champs en chaîne (`rig.ts:180`, `controls.ts:504`).
3. **Une dizaine de systèmes de mouvement concurrents** dans un même `advance` (`lens.ts:349-371`) : pilote, voyage,
   rig, chute, vol cinématique, inertie, cinématiques, `stepFlight`, focus/suivi, mise à niveau. L'ordre est subtil,
   les remises à zéro de `rig.key` réancrent et sautent.
4. **Deux voyages** : `controller/travel.ts` (log-distance + slerp, 1,2–6 s, notre univers seulement) et
   `frameTarget`/`stepFlight` (`rotation.ts:434`, `:505`, trou noir/étoile/embouchure). Les corps de Gargantua sont
   **téléportés** (`main.ts:2341`), le spectateur placé d'un coup (`main.ts:2241`). Aucun n'est physique ni
   relativiste.
5. **Changements d'ancre** (trou ↔ gorge, `camera.ts:316`, `motion.ts:118-138`) réexprimés, parfois retournés ;
   téléportations rattrapées après coup par `carryCommit`, abandonné au-delà de 50 km (`camrig.ts:96`).
6. **Trois lois de vitesse** (rig 0,8 × h/s, `fly()` ∝ min des distances borné à 1000 M, extérieur max(5 m, 0,2 d))
   et deux plages (molette 0,05–30, curseur 1/16–16).
7. **L'optique disputée** : `lensBase`, `fovTarget`, `targetFov`, `padlockFov`, `padZoomBase`, `camKick`.
8. **Le temps propre** est celui du vaisseau piloté (`controls.ts:453`) ; spectateur et caméra libre n'en ont pas.
9. **Pas ciblables** : le trafic aérien (`controller/traffic.ts`), les bateaux (`controller/seatraffic.ts`), les IA
   (seulement via `focusShip`). La seule « vue depuis un autre » est la marionnette réseau (`netsession.ts:1900`,
   `controls.ts:595`), qui fait de l'autre l'appareil **piloté**.
10. **Le rendu raster de la Terre** ignore la vitesse de l'observateur (pas d'aberration) ; seul `trace.wgsl` booste
    le photon (`:9287-9297`, projecteur g⁴ `:2230`). Les maillages (`ship.wgsl`…) non plus.

Ce qui est bon et se garde : le rendu à origine flottante en double sur CPU (`renderer.ts:2700`), les ressorts et
quaternions de `cine/follow.ts`, le réalisateur `cine/brain.ts`, les points de vue `mounts.ts`, l'aberration CPU de
`targeting.ts:815` (`aberrateRep`), le temps propre intégré dans `controller/motion.ts`.

## Architecture cible

Un module **`src/camera/`**, le seul à écrire la pose vue. `Settings` reste la **sortie** (écrite une fois par image
pour le moteur de rendu, les sauvegardes et le réseau), plus jamais l'état de travail.

```
                 ┌──────────── sujets (subjects.ts) ────────────┐
                 │ corps · ISS · trou de ver · trou noir · flotte │
                 │ trafic · IA · bateaux · joueurs réseau · nous │
                 └───────────────┬───────────────────────────────┘
 entrées (souris, ZQSD,          │ pose(t), vitesse, repère, taille, œil cockpit
 molette, manette, HOTAS,        ▼
 tactile, TARS, e2e)  ──►  comportements (behaviours/*)  ──►  mélangeur (stack.ts)  ──►  CameraPose  ──►  Settings
                           libre · orbite · poursuite ·         priorités, coupes,         (pose.ts)        (adapter.ts)
                           cockpit · trépied · voyage ·         fondus inertiels,           │
                           ciné-montage · ciné-plan             optique unique              └─► τ observateur, β, γ
```

- **`pose.ts` — `CameraPose`** : une **ancre** (id d'un repère : corps inertiel local, corps fixe, gorge, Gargantua)
  + un **décalage en double** (m) dans ce repère + un **quaternion** + une **vitesse** (3-vitesse coordonnée → β, γ)
  + **τ**. Les changements d'ancre se font **par conversion exacte** (même point, même vitesse, même regard), jamais
  par réexpression de sphériques. Les Euler et sphériques ne servent plus qu'à l'adaptateur et aux panneaux.
- **`stack.ts` — le mélangeur** (à la Cinemachine) : chaque comportement produit une pose candidate ; un seul est
  « vivant » ; une transition est **une coupe** ou **un fondu** (position en log-distance relative au sujet,
  orientation en slerp, vitesse conservée à l'entrée pour qu'il n'y ait jamais de cassure de vitesse) ; l'optique
  (focale, zoom, coups) est **une pile unique** au même endroit.
- **`speed.ts` — une seule loi de vitesse** (CAM3).
- **`voyage.ts` — le navigateur relativiste** (CAM4) ; **`voyage-cine.ts`** — montage et plan-séquence (CAM7).
- **`subjects.ts` — tout ce qui se suit** (CAM8).
- **`observer.ts` — l'observateur** : la caméra détachée a **sa propre ligne d'univers** (position, vitesse, τ), le
  vaisseau garde la sienne. Le spectateur actuel (second `CameraController`) disparaît à terme.

Le vaisseau piloté **lit** encore la pose caméra tant que la caméra est montée sur lui (cockpit, extérieur) — on ne
réécrit pas le pilotage dans ce plan ; on inverse seulement la dépendance quand la caméra est **ailleurs**
(observateur, sujet autre, voyage observateur).

## La physique du voyage

Unités géométriques (c = 1) dans le repère barycentrique (ou celui de Gargantua), distances en m dans le code.

**Fusée relativiste à accélération propre constante a**, sur une distance D, retournement à mi-chemin :

- γ à mi-chemin : γₘ = 1 + a·(D/2) ; βₘ = √(1 − 1/γₘ²) ;
- temps propre total : τ = (2/a)·arcosh(γₘ) ; temps coordonné total : t = (2/a)·√(γₘ² − 1) ;
- position/vitesse à τ (phase 1) : x = (cosh(aτ) − 1)/a, β = tanh(aτ), t = sinh(aτ)/a (miroir en phase 2).

**Le joueur choisit** :

| choix | ce qui est résolu |
|---|---|
| **vitesse de pointe** β (0,1 c … 0,999 9 c) | a = 2(γ − 1)/D |
| **durée** — temps propre τ **ou** temps coordonné t | a par dichotomie (t et τ sont monotones en a) |
| **accélération** (en g, avancé) | direct ; plafonnée à β_max si l'on veut une croisière (accélère, croise, freine) |

(Ordre de grandeur : Terre → Mars, 1,5 au, à 0,9 c de pointe : a ≈ 1×10⁵ g, t ≈ 20 min, τ ≈ 14 min. À 1 g le même
voyage prend 3,5 jours et plafonne à 5×10⁻³ c : l'accélération est celle d'un observateur, pas d'un équipage.)

**La borne de la sphère d'influence** : la vitesse réelle le long du chemin est
v(s) = min(v_fusée(s), k · h(s)), où h(s) est la **hauteur au-dessus de la surface** du corps le plus proche
(WGS84 + relief pour la Terre via `heightOverGround`, rayon + DEM pour les autres, horizon pour le trou noir, gorge pour
le trou de ver, coque pour un appareil). Départ : la vitesse croît comme h (montée exponentielle, h(t) = h₀·eᵏᵗ),
puis rejoint le profil fusée ; arrivée : symétrique. Le profil est **précalculé** en table s → (t, τ, β) par
intégration adaptative de dτ = dt/γ, si bien que :

- la lecture est exacte et réversible (pause, accélération du temps, retour arrière de la timeline) ;
- **la cible mobile est interceptée** : le temps d'arrivée t₁ est itéré (point fixe, 3–6 itérations) jusqu'à ce que
  la route vise la cible **où elle sera** ; la dernière jambe se fait dans le repère de la cible (vitesse relative
  ramenée à zéro, on arrive en orbite ou en poursuite, pas en passant) ;
- **la route évite les corps** : droite entre les sorties de SOI, déviée en arcs tangents à 1,2 R si elle en
  traverse un ; vers ou depuis Gargantua, **la gorge est une jambe** (on passe par le trou de ver, on n'est pas
  téléporté).

**Les horloges** : à chaque image le monde avance de Δt (coordonné), le voyageur de Δτ = Δt/γ. L'accélération du
temps existante (`clock.ts`) s'applique aux deux ; par défaut un **« lecture auto »** choisit le facteur pour que le
voyage dure ≈ 20 s au mur (×1 possible, voyage en temps réel). La HUD de voyage montre t, τ, l'écart t − τ, β, γ, a
(g), distance restante, ETA dans les deux temps.

**Les effets visibles** : la caméra écrit β à chaque image (mode `geodesic`, `vel*`), donc le traceur applique déjà
aberration, Doppler et projecteur. Ce plan les rend **cohérents partout** (CAM5) : étoiles, Soleil, planètes
lointaines, étiquettes et réticules (déjà via `aberrateRep`), maillages, et le raster (où la borne SOI garde β petit :
on y vérifie seulement la continuité).

**Regarder pendant le voyage** : la tête est libre (souris, manette, TrackIR/HOTAS) dans le repère **du voyageur** ;
regarder en arrière montre le ciel comprimé et rougi, en avant le ciel bleui concentré. Un bouton « regard route »
recentre sur la vitesse.

## Phases

| phase | contenu | livrable / mesure |
|---|---|---|
| **CAM0** — mesurer avant de toucher | un **capteur de fluidité** (`src/camera/metrics.ts`, exposé `__bh.cam.metrics()`) : saut de position (Δx image vs v·Δt), cassure de vitesse, jerk angulaire, saut de focale, à chaque image ; e2e de référence sur 12 situations (orbite Terre, rase-motte Alpes, cockpit F-35, extérieur A320, voyage Terre→Lune, Terre→Mars, autour de Gargantua, traversée de la gorge, ISS, spectateur, réseau suivi, changement de point de vue) | tableau de base des sauts, captures, `docs/progress/camera-aaa-cam0.md` |
| **CAM1** — `CameraPose` | `src/camera/pose.ts` + `adapter.ts` (pose ⇄ Settings exact, aller-retour testé à 1e-9 relatif) ; ancres et conversions exactes ; le contrôleur écrit la pose, l'adaptateur Settings ; fin des détections « par chaîne » | tests unitaires conversions (pôles, gorge, 1e-3 m à 30 au) ; e2e CAM0 sans régression |
| **CAM2** — le mélangeur | `stack.ts` : comportements, priorités, coupes/fondus avec vitesse conservée, pile optique unique ; migration de `rig.ts` (libre/orbite/suivi/trépied), `rotation.ts` (orbite trou noir/étoile/gorge), `travel.ts` **et** `frameTarget/stepFlight` → **un seul voyage** ; Gargantua n'est plus téléporté | e2e CAM0 : 0 saut hors coupes voulues |
| **CAM3** — la vitesse ∝ surface | `speed.ts` : v = k · h_eff, h_eff = distance à la surface la plus proche **lissée entre SOI** (min doux pondéré par la gravité), WGS84 + relief pour la Terre, appareils proches, horizon/gorge ; une seule plage molette = curseur ; **inertie** (accélération et freinage doux, pas de vitesse qui tombe d'un coup) ; plancher au sol | e2e : de 1 m au-dessus des Alpes à 10 au en une poussée continue, vitesse ∝ h ±10 %, aucune pénétration du sol |
| **CAM4** — le navigateur relativiste | `voyage.ts` : formules fusée, choix vitesse/τ/t/a, borne SOI, table précalculée, interception de cible mobile, évitement des corps, jambe de gorge ; observateur **ou** vaisseau (le vaisseau suit la ligne d'univers, τ = horloge d'équipage, mission en cours → confirmation) ; le monde avance de t | tests unitaires : τ, t, x(τ) à 1e-9 ; interception à < 1 % de la distance de cadrage ; e2e Terre→Mars à 0,9 c : t et τ de la HUD = formule ±0,1 % |
| **CAM5** — les effets relativistes partout | β cohérent dans le traceur, le ciel, le Soleil, les corps lointains, les étiquettes, les maillages (`ship.wgsl`, station) ; continuité raster ↔ traceur ; regard libre pendant le voyage ; HUD de voyage (t, τ, écart, β, γ, a, ETA) FR+EN, unités `unitsFor()` | captures avant/arrière à 0,1 / 0,5 / 0,9 / 0,99 c ; A/B coût : 0 % mesurable à β = 0 |
| **CAM6** — l'interface du voyage | sélectionner une cible **partout** (clic 3D, carte 3D, liste du panneau, Tab, TARS « emmène-moi à… ») ; panneau Voyage : observateur/vaisseau, vitesse ou durée (τ / t), aperçu (a en g, γ max, t, τ), départ/pause/abandon, « retour au vaisseau » ; touches libres (pas sur ZQSD/AE/WX) | e2e entrées réelles (souris CDP) : voyage lancé depuis chaque point d'entrée |
| **CAM7** — la cinématique | **montage** : le réalisateur (`cine/brain.ts` étendu) compose départ, rase-motte (suivi de relief à 150–800 m via `heightOverGround`, côté jour, terminateur), travelling latéral, plan large, survol de la cible, arrivée ; **plan-séquence** : une spline Hermite continue avec regard anticipé, rase-motte au départ et à l'arrivée ; temps compressé, durée réglable (20 s – 3 min) ; validité des plans (pas sous le sol, pas dans un corps, Soleil hors champ ou en contre-jour voulu) | captures de chaque type de plan ; e2e : 0 plan invalide sur 20 voyages aléatoires |
| **CAM8** — la caméra sur tout appareil | `subjects.ts` : trafic (`traffic:<icao24>`), IA et ailiers, bateaux (`sea:<id>`), flotte, ISS, joueurs réseau (`net:<slot>`) ciblables et sélectionnables (clic 3D, radar, carte, liste) ; vues **orbite/poursuite**, **poste de pilotage** (œil par type d'appareil, sinon le nez), **tour/trépied** (posé au sol au WGS84 ou fixe dans l'espace, auto-placé devant la route, repositionné quand le sujet s'éloigne) ; suivre un joueur réseau **sans** en faire l'appareil piloté (la marionnette reste pour le passager) | e2e : chaque type de sujet × chaque vue ; réseau à deux navigateurs sur kerr-mini |
| **CAM9** — aucune cassure | transitions continues : changement d'ancre trou ↔ gorge ↔ chez nous, point de vue ↔ point de vue, sujet ↔ sujet (fondu de voyage court), téléportations du placement (fondu ou coupe franche, jamais un demi-saut) ; fin de `carryCommit` borné à 50 km | e2e CAM0 complet : 0 saut, jerk sous seuil |
| **CAM10** — finition AAA | collisions caméra/sol/bâtiments en poursuite et orbite, regard anticipé, tremblement unifié, manette/HOTAS/tactile, `__bh.cam` (pose, voyage, sujet, vue, métriques) dans `docs/BH-API.md`, `docs/CAMERA.md` FR+EN, raccourcis dans l'écran des commandes | doc + gallery de captures |
| **CAM11** — campagne | campagne e2e partagée Mac / kerr-mini (et kerr-pc), critères P1–P8 ci-dessous, fiche de progrès | `docs/progress/camera-aaa.md` |

**Ordre** : CAM0 → CAM1 → CAM2 → CAM3 → CAM4 → CAM5 → CAM6 → CAM7 → CAM8 → CAM9 → CAM10 → CAM11. CAM8 ne dépend
que de CAM2 et peut avancer plus tôt si l'on veut la « vue depuis l'avion de ligne » avant le voyage.

## Définition de « parfait » (critères d'acceptation)

| # | critère | mesure |
|---|---|---|
| P1 | **Pas de saut** : hors coupe voulue, aucune image où la caméra se déplace de plus de 1,5 × v·Δt + 1 mm | `metrics.ts`, toutes les situations CAM0 |
| P2 | **Pas de cassure de vitesse** à un changement de comportement ou d'ancre (|Δv| / v < 5 % en une image) | idem |
| P3 | **Vitesse ∝ surface** : en vol libre à poussée constante, v/h constant ±10 % de 1 m à 10 au | e2e CAM3 |
| P4 | **Physique exacte** : t et τ d'un voyage = formules fusée ±0,1 % (sans borne SOI) ; écart t − τ affiché exact | unitaires + e2e |
| P5 | **Interception** : à l'arrivée, la caméra est au cadrage voulu de la cible mobile à 1 % près, vitesse relative < 1 % | e2e Lune, Mars, ISS, avion de ligne |
| P6 | **Effets visibles et cohérents** : à β ≥ 0,5 le ciel est aberré/Doppler ; étiquettes et maillages tombent sur leurs objets (< 2 px) | captures + mesure de l'écart étiquette/objet |
| P7 | **Coût nul au repos** : A/B à ±1 % (trace-ab sur vue figée) à β = 0 et en vol F-35 | trace-ab |
| P8 | **Pause et temps respectés** : en pause tout se fige (y compris le voyage), à ×N tout va N fois plus vite, τ et t restent cohérents | e2e |

## Décisions du 2026-10-29 (second tour, questions ouvertes tranchées)

| question | réponse |
|---|---|
| vitesse par défaut | **en fonction du trajet** : la vitesse de pointe proposée croît avec la distance (quelques % de c vers la Lune, ≈ 0,9 c vers Mars, ≈ 0,999 c vers Gargantua) ; lecture auto ≈ 20 s |
| cadrage d'arrivée | **oui** : orbite à 2,2 rayons pour un corps, poursuite pour un appareil, 3 km de l'ISS, distance de sécurité de l'horizon pour Gargantua |
| voyage du vaisseau en mission | **la mission continue** (pas de fin de mission, pas de confirmation bloquante) |
| réseau | **oui** : l'horloge commune avance de t, la dilatation du voyageur est son τ |
| touches | **G** voyage, **⇧G** voyage ciné |
| conduite | **chaque phase s'enchaîne sans demander** ; arrêt seulement pour une question importante, un problème ou une opération destructive ; **vidéos 720p** du résultat à la fin (outil vidéo du jeu, `scripts/jitter-lab.ts` / screencast) |

## Risques

- **CAM1/CAM2 touchent le cœur** (`controls.ts`, 1 684 lignes, ~50 mixins). Repli : l'adaptateur garde Settings comme
  vérité tant qu'un comportement n'est pas migré ; on migre comportement par comportement, e2e CAM0 à chaque pas.
- **Le pilotage lit la caméra** : on ne le réécrit pas ; quand la caméra est montée sur le vaisseau, le comportement
  « monté » reproduit l'existant à l'identique (test de non-régression des vols longs).
- **Précision** à 30 au avec un décalage de 1 m : ancres locales + doubles ; jamais de position absolue en f32.
- **Coût GPU** des effets relativistes : déjà dans le traceur ; maillages et étiquettes aberrés côté CPU (pas de
  nouvelle passe).

## Suivi (2026-10-29)

| phase | état | commit | notes |
|---|---|---|---|
| CAM0 | **fait** | 387be261 | capteur `__bh.cam` (`src/camera/metrics.ts`), e2e `camera-smooth` ; base : 7 défauts / 14 situations (et les voyages de notre système ne bougeaient pas : un Ranger est piloté dans la scène) |
| CAM1–CAM2 | **adapté** | — | pas de réécriture du cœur : `src/camera/` pilote la pose par `setHomePose`/`setHolePose` (Settings reste la sortie) ; les nouveaux comportements (voyage, ciné, sujets) passent avant le rig dans `advance` ; un seul voyage (le relativiste) pour notre système et Gargantua, l'ancien `travel.ts` ne sert plus qu'en repli |
| CAM3 | **fait** | 3d3823bc | `speed.ts` : minimum doux des hauteurs (plus de saut de vitesse quand le plus proche change), une plage ×1/16…×32 (molette = curseur), inertie des touches en orbite |
| CAM4 | **fait** | 3d3823bc | `voyage.ts` / `voyager.ts` : fusée relativiste exacte, choix vitesse/τ/t/accélération, borne SOI, interception, spirales autour des mondes (jamais à travers), lecture variable ~20 s, observateur ou vaisseau (τ d'équipage) |
| CAM5 | **fait** | 3d3823bc | β au traceur (aberration, Doppler, projecteur), regard libre en route, carte de voyage t/τ/écart/β/γ, plus de faux « IMPACT » |
| CAM6 | **fait** | 3d3823bc | G / ⇧G (G = train d'atterrissage en vol, voyage en caméra libre), section Voyage du panneau caméra, `__bh.voyage()`, e2e `camera-voyage` |
| CAM7 | **fait** | 3d3823bc | `cinevoyage.ts` / `skim.ts` : rase-mottes (relief anticipé, côté jour), plan-séquence et montage |
| CAM8 | **fait** | 2fc57c49 | avions de ligne (`trf:`), bateaux (`ais:`), ailiers (`wing:`), joueurs, flotte, ISS ciblables ; Autour / Poursuite / Cockpit / Tour ; trafic dessiné autour de la vue ; e2e `camera-subject` |
| CAM9 | partiel | (ce commit) | retour du spectateur 87° → 0° ; vues du F-35 50° → 0 ; focale à ressort critique (plus de saut au zoom) ; capteur mesuré au temps dessiné ; tour spatiale co-mobile (fly-by) ; restent : Gargantua (sauts vers Miller à re-mesurer), visée de l'ISS à l'arrivée, zoom automatique de la tour |
| CAM10 | partiel | (ce commit) | `scripts/camera-video.ts` : films 720p 30 i/s image par image (jeu figé, pas de 1/30 s) — voyage Mars, ciné Terre→Lune, montage Mars, caméra sur le Ranger ; restent `docs/CAMERA.md` et l'écran des commandes |
| CAM11 | à faire | — | campagne complète Mac + kerr-mini |
