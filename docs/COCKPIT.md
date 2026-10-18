# Le cockpit interactif

Dans le cockpit du Ranger (vue « Cockpit »), le pilote travaille au tableau avec la souris : il survole une commande, la clique, la glisse, la tourne à la molette. Chaque commande fait la même chose que sa touche. Elle suit l'état du vol, même quand une touche, une manette ou l'autopilote l'a changé. Les écrans changent de page sous le pointeur. Le train se commande au levier ; la cabine et la coque ont leurs lumières. Plan : [`PLAN-COCKPIT.md`](PLAN-COCKPIT.md) (M8, K1–K7). Le F-35 a son propre cockpit, un écran tactile panoramique et le casque : voir [plus bas](#le-cockpit-du-f-35).

## Les fichiers

| Fichier | Rôle |
|---|---|
| `src/cockpit/controls.ts` | pur : les trois panneaux (mesurés sur le maillage de la cabine), les 20 commandes, leur géométrie générée (matière 73), la pose de chaque pièce mobile, les boîtes que le pointeur teste |
| `src/cockpit/pick.ts` | ce que touche un rayon dans la cabine : le point, la face, la matière ; sur un écran, son affichage et le point sur lui |
| `src/cockpit/pointer.ts` | `cockpitTarget` : un rayon contre les boîtes des commandes et les faces de la cabine ; le plus proche l'emporte (une commande, un écran, la cabine, ou rien : la vitre) |
| `src/cockpit/input.ts` | `CockpitInput` : survol, clic, glissement, molette ; les crans des leviers ; les onglets des écrans |
| `src/cockpit/actions.ts` | `cockpitAct` : l'action de chaque commande (celle de sa touche) ; `controlTip` : la bulle (nom, état, touche) |
| `src/cockpit/state.ts` | `controlStates` : chaque commande telle que le vol l'a ; `ControlTravel` : la course des pièces mobiles |
| `src/cockpit/chrono.ts` | le chronomètre (un bouton : lancé, arrêté, remis à zéro) |
| `src/cockpit/placards.ts` | la texture des inscriptions (une case par commande) |
| `src/cockpit/lights.ts` | l'éclairage de la cabine : les plafonniers, les écrans comme lumières (groupés, leur couleur moyenne) |
| `src/ship-lights.ts` | les feux du Ranger : navigation, anticollision, atterrissage ; posés sur la coque, leur rythme, leur uniforme |
| `src/gear.ts`, `src/gear-mesh.ts` | le train : sa hauteur par appareil, sa sortie en 8 s, son alarme, le ventre ; ses jambes et ses trappes dessinées |
| `src/ui/cockpitscreens.ts` | les écrans : dix pages pour chacun des huit affichages, leurs onglets, le chronomètre sur CLOCKS |
| `src/shaders/ship.wgsl` | `ctlVs` et la matière 73 (les commandes, leurs lampes, le survol) ; `cabinShade` (plafonniers, nuit, écrans) ; `lampVs`/`lampFs` (le halo des feux) |

## Le pointeur

```
souris ─ ship.cabinRay (la caméra de la dernière image) ─ cockpitTarget ─┬─ une commande → CockpitInput
                                                                       ├─ un écran     → ses onglets, sa page
                                                                       ├─ la cabine    → rien (aucune cible derrière un mur)
                                                                       └─ la vitre     → un clic choisit une cible du ciel, comme avant
```

- **Le survol** éclaire discrètement la pièce que la main prend et ouvre une bulle : « Aérofrein · 50 % · ⇧P ».
- **Le clic** fait l'action de la commande : un cran pour un levier, un interrupteur basculé, un bouton poussé.
- **Le glissement** : un levier suit la main dans sa glissière et se cale dans ses crans ; le bouton CABIN tourne.
- **La molette** : un cran tous les 50 px (un trackpad ne l'emballe pas) ; elle tourne le bouton ou avance un levier.
- **Le bouton droit, ou Maj** : le regard tourne toujours.
- Le sim figé (`__bh.freeze`), le pointeur ne commande rien.

## Les commandes

| Panneau | Commande | Inscription | Effet | Touche |
|---|---|---|---|---|
| A | levier à roue | GEAR | le train sorti ou rentré ; la roue rouge pendant la manœuvre, clignotante avec l'alarme | G |
| A | levier à crans | FLAPS | volets 0 → ½ → plein | P |
| A | levier en T | SPD BRK | l'aérofrein, 0–100 % | ⇧P |
| B | bouton rotatif | CABIN | les plafonniers, 0–100 % | — |
| B | interrupteur | NIGHT | la cabine en rouge | — |
| B | interrupteurs | NAV · STROBE · LAND LT | les feux de navigation, les anticollisions, les phares | — |
| C | boutons | TKOFF · CIRC · APPR | autopilotes : décollage vers l'orbite, circulariser, approche de la cible | U · 9 · 0 |
| C | boutons | PRO · RETRO · TGT | maintiens : prograde, rétrograde, vers la cible | 1 · 2 · 7 |
| C | boutons | ASSIST · ENTRY · LAND | le mode assisté ; autopilotes : rentrée et atterrissage, atterrir | F4 · ⇧G · F7 |
| C | boutons | SAS · CHRONO · AP OFF | la stabilisation ; le chronomètre ; tout autopilote et tout maintien coupés | T · — · — |

- **Les boutons s'allument** tant que leur mode vole. CIRC reste allumé pendant le nœud qu'il a posé, comme le bouton du hub.
- **Les leviers suivent l'état** : le train, les volets, l'aérofrein vont où le vol les a mis, quelle que soit la source (la main, une touche, un HOTAS, l'autopilote). Ils y vont en voyageant au lieu de sauter : le train en ¼ s, les volets en ⅔ s. Tenus par le pointeur, ils suivent la main sans retard.
- Les touches sont celles du keymap : une touche réaffectée change aussi la bulle.

## Les écrans

Dix pages pour chacun des huit affichages : PFD, ORB, NAV, SYS, DCK, PLN, CLK, LOG, APP (l'approche), LDG (l'atterrissage).
- **Les onglets** n'apparaissent que sous le pointeur. Un clic choisit la page ; ce choix est gardé (réglage `cockpitPages`).
- **Un clic sur la page déjà choisie** rend l'écran à sa page à lui, automatique : NAV redevient APPROACH près d'une piste, DOCKING redevient LANDING quand on est bas et lent.
- **Le chronomètre** s'affiche sur CLOCKS à la place de l'heure locale : vert quand il tourne, ambre quand il est arrêté (au dixième).

## Le train

- **G, le levier GEAR ou une manette** : sortie ou rentrée en 8 s, dessinée (jambes, amortisseurs, trappes).
  - Au sol, il est verrouillé sorti.
  - Sous l'autopilote, c'est l'autopilote qui le règle.
- **L'alarme** : train rentré, sous 300 m et sous 150 m/s. L'alerte du HUD affiche « GEAR UP · TOO LOW » et la roue du levier clignote.
- **Posé train rentré** : il atterrit sur le ventre, glisse jusqu'à l'arrêt, et le train reste bloqué.
- **Le réglage « Train automatique »** garde l'ancien comportement : le train sort sous 600 m au-dessus du sol.

## Les lumières

- **La cabine**
  - Le bouton CABIN règle les plafonniers.
  - **La nuit** se lit dans le shader : elle commence quand le vaisseau ne reçoit plus de lumière directe du soleil — soleil couché, éclipsé, ou caché derrière la Terre en orbite. Le shader se sert de la lumière clé du traceur, pas de l'exposition. Les plafonniers baissent alors d'eux-mêmes au tiers.
  - NIGHT les passe en rouge, à 40 %.
- **Les écrans éclairent la cabine**
  - Les 30 écrans, groupés en 7 lumières devant les pilotes, éclairent de la couleur moyenne de leurs affichages (l'image des écrans réduite à 8 Hz).
  - Leur lumière est multipliée par 6, pour un œil habitué à la cabine sombre : CABIN à 0, les écrans l'éclairent seuls.
- **Les feux du Ranger**
  - Ce sont la navigation (rouge à gauche, vert à droite, blanc à l'arrière), les anticollisions blancs aux saumons (double éclat toutes les 1,2 s) et deux phares sous le nez.
  - Ils sont posés sur la coque par des rayons contre son maillage.
  - **Le rendu** : leur verre s'allume sur la coque ; leur halo est dessiné avec les flammes et garde quelques pixels à toute distance. Un phare éblouit vu de son faisceau.
  - **Ce qui les cache** : la coque (un rayon CPU depuis l'œil, arrêté 60 cm avant le feu) et le décor tracé (lu une fois par sommet).
- **Le coût** (GPU de ce Mac, vue figée, médianes de 300 images, A/B alternés)
  - Lumière des écrans : ≈ 0.
  - Verres : ≤ 0,1 ms.
  - Halos : dans le bruit.
  - Deux pièges mesurés : redessiner la profondeur de la coque pour cacher les feux coûtait 1,3 ms ; lire la profondeur tracée dans chaque fragment de halo coûtait 5 ms.

## Le cockpit du F-35

Dans la vue « Cockpit » (ou « Cabine ») du F-35, il n'y a pas de HUD sur une vitre : comme sur le vrai avion,
la symbologie est celle du casque, affichée par-dessus la vue (voir [`HUD.md`](HUD.md), *Flown as a plane*). Le
tableau de bord, c'est un seul écran tactile panoramique. Plan : [`PLAN-F35.md`](PLAN-F35.md) (F5) ; l'avion :
[`F35.md`](F35.md).

| Fichier | Rôle |
|---|---|
| `src/f35/pcd.ts` | pur : l'écran panoramique (PCD), dessiné sur un canvas de 2048 × 768 px, et ce que fait un toucher |
| `src/f35/cockpit.ts` | `pcdData` : ce que l'écran affiche, lu sur le vol à chaque dessin ; `avionicsData` : le bloc « avionique » du casque |
| `src/f35/pose.ts`, `src/f35/model.ts` | les pièces mobiles, dont le manche latéral et la manette des gaz |

### L'écran panoramique (PCD)

- **Il est dessiné dix fois par seconde**, et tout de suite après un toucher. Il se pose sur l'écran du tableau
  de bord (matière 36).
- **Un clic sur l'écran le touche** (`jetPick`, puis `Pcd.touch`) : un toast dit ce qui a changé (« PCD · FUEL »).
  - Le titre d'un portail passe à la page suivante ; les flèches ◀ ▶ à ses deux bouts reculent ou avancent.
  - Sur le TSD, − et + en bas changent la portée : 5, 10, 20, 40, 80 ou 160 (km, ou NM en unités impériales).
- **La bande du haut** : F-35B, l'heure UTC (« Z »), « ICAWS · NO FAULTS » ou les trois alertes les plus graves
  (rouge, jaune), le carburant en kg (jaune sous 20 %).
- **Quatre portails**, chacun une page parmi huit (TSD, FCS, ENG, FUEL au départ) :

| Page | Ce qu'elle montre |
|---|---|
| TSD | la carte tactique, cap en haut : cercles de distance et boussole ; les terrains, leur piste (4,5 km) et leur code OACI ; les zones d'une mission (ambre) et la portée des SAM (rouge) ; la route (la branche active en magenta, « LNAV/VNAV ▸ point », son relèvement, sa distance, son temps, l'écart latéral XTK) ; les pistes du radar et de la liaison en symboles OTAN (ami demi-cercle bleu, hostile losange rouge, neutre carré blanc, inconnu quadrilobe jaune ; la liaison en pointillé, le verrouillage cerclé) ; la trace au sol, le terrain le plus proche, le cap |
| FCS | l'avion vu de dessus, chaque gouverne (stabilisateurs, flaperons, becs, dérives) et son braquage ; G et son pic, l'incidence, Mach |
| ENG | le régime (N2) et la température des gaz en cadrans ; la poussée en kN, le débit en kg/h, la manette ; la soufflante en STOVL |
| FUEL | le total, sa jauge et ses repères JOKER et BINGO (celui du plan de vol, le joker 1 500 kg au-dessus), le débit, l'endurance, le rayon d'action, la masse |
| STOVL | l'avion de profil, la porte de la soufflante, l'angle de la tuyère ; NOZZLE, DOORS (OPEN, TRANSIT, CLOSED), la marge en stationnaire, HOVER · VZ |
| CNI | la navigation : position, altitude, hauteur radar, vitesses (sol, vraie, Mach), vitesse verticale, route, vent ; le terrain le plus proche |
| ADI | l'horizon de secours, la vitesse et l'altitude |
| CKL | la liste du moment (au sol BEFORE TAKEOFF ; en STOVL VERTICAL LANDING ; en vol APPROACH), chaque ligne cochée d'après l'état du vol |

- **La bande du bas**, dans l'encoche de la console centrale : ALT (ou VNAV, magenta), HDG (ou LNAV), A/T,
  CTOL/STOVL/HOVER ; puis THR % (et AB), le train, les volets, l'aérofrein.

### Le manche et la manette

- **Le manche latéral** s'incline sous la main du pilote, quelle que soit la source (clavier, manette, HOTAS) :
  12° vers l'avant ou l'arrière, 10° de côté.
- **La manette des gaz** glisse le long de son rail, de 0 à 100 %.
- La verrière se lève à l'arrêt (au sol, moteur au ralenti).

## Les outils de test (`__bh`)

| Outil | Rôle |
|---|---|
| `__bh.cockpitControlAt(id)` | où est une commande dans la vue (ndc), pour y viser un vrai clic |
| `__bh.cockpitScreenPoint(slot, page)` | un point de la vue sur l'onglet `page` d'un affichage |
| `__bh.cabinPick(x, y)` | ce que montre un pixel de la cabine : point, normale, matière, écran |
| `__bh.camera.cockpit.input` | `hover`, `pressed`, `overTab` : l'état du pointeur |
| `__bh.renderer.cockpitControls` | l'uniforme des poses (4 vec4 par commande : pivot et angle, axe, poussée, lampe et survol) |
| `__bh.renderer.ship.lampCount` | les feux allumés et visibles cette image |

## Les tests

- **Unitaires** :
  - `cockpit-controls` : panneaux, maillage, boîtes, poses ;
  - `cockpit-pick`, `cockpit-input`, `cockpit-pages` ;
  - `cockpit-state` : la course, les boutons des phases ;
  - `cockpit-lights`, `ship-lights` ;
  - `gear`, `gear-mesh`.
- **e2e** (de vrais événements souris par CDP) :
  - `cockpit` (8 tests) : survol et bulle, SAS, volets, aérofrein glissé, molette, interrupteurs, regard, onglets, train, course des volets, CIRC, NIGHT, feux ;
  - `gear` (3 tests) ;
  - **`cockpit-flight`** : le vol mené au tableau. Sur le plané vers Edwards : ENTRY cliqué. Sous 3 km : AP OFF, le levier GEAR, un cran de FLAPS, ENTRY de nouveau. Posé sur ses roues.
