# Plan F-35 — le chasseur sur Terre (13 octobre 2026)

Un F-35B Lightning II pilotable, le vol « avion sur Terre » du jeu porté au niveau d'un simulateur AAA.
Suivi global : [`AAA-PROGRESS.md`](AAA-PROGRESS.md).

## Décisions du propriétaire (13/10/2026)

- **Le F-35B, avec le STOVL** : le modèle fourni est un F-35A (ses métadonnées). On lui ajoute ce qui fait le B — la tuyère
  pivotante à trois roulements, la soufflante derrière le cockpit et ses trappes, les tuyères de roulis — et le vol qui va
  avec : transition, vol stationnaire, décollage court, atterrissage vertical.
- **Le cockpit complet** : l'intérieur reconstruit autour du siège du modèle, le manche latéral et la manette, **l'écran
  panoramique** du F-35 (50 × 20 cm, deux moitiés tactiles) en pages cliquables comme les écrans du Ranger, et la
  **symbologie du casque** (le F-35 n'a pas de collimateur tête haute : tout est dans le casque).
- **Le jeu autour** : des **plans de vol détaillés** (routes, procédures, carburant), l'interface et les cartes qui vont
  avec, des **défis de vol**, les **effets de vol AAA**, et **l'armement et le combat**.

## Le modèle (inventaire du 13/10/2026)

`assets/airplanes/F-35B Lightning II.glb` (128 Mo, hors du dépôt) : « F-35A Lightning II » de **shangus930** (Sketchfab),
licence **CC BY 4.0** — à créditer comme le Ranger et le Lander.

- 190 000 triangles, 19 maillages, 10 matières PBR (couleur, métal-rugosité, normales), 25 images jusqu'à 4096².
- Axes : le nez vers −y, z en haut ; **unités ≈ 1,87 × le réel** (envergure 20,1 contre 10,7 m) → échelle 0,535.
- **Le train et ses six trappes animés** (un clip de 7,3 s : image 1 rentré, 250 sorti) ; la verrière transparente, la
  vitre du collimateur ; un pilote assis dans le cockpit ; la tuyère est un maillage à part.
- **Les gouvernes ne sont pas séparées** : les stabilisateurs et les dérives sont des pièces détachées du maillage de la
  cellule ; les flaperons, les gouvernes de direction et les becs sont à découper le long de leurs lignes de charnière.

## Étapes

| # | Étape | Contenu | Statut |
|---|---|---|---|
| F1 | **Le modèle dans le jeu** | `scripts/build-f35.py` (Blender) : le repère du vaisseau, l'échelle réelle ; les **pièces mobiles** — gouvernes découpées à leurs charnières (stabilisateurs, gouvernes de direction, flaperons, becs), train et trappes (le clip échantillonné en pistes rigides), roues, verrière, tuyère ; les matières regroupées en deux couches de textures 4096² (cellule ; le reste en atlas), KTX2 (BC7/ASTC sur le GPU) ; `assets/f35/` en LFS ; crédit CC BY | **fait** : `scripts/build-f35.py` (17 s) — 91 000 triangles (le train avant 60 k → 11 k, le casque, la tuyère réduits), **119 pièces** : 2 stabilisateurs entiers, 2 becs de bord d'attaque (pièces du modèle), 2 flaperons et 2 gouvernes de direction **découpés** à leurs charnières (bissections bmesh, le long d'une ligne mesurée sur les bords de fuite), 3 jambes et 6 trappes sur **9 pistes** (le clip échantillonné en 33 instants, une application affine ajustée par moindres carrés : sommets à 1 cm près), 3 roues (leurs axes, leurs rayons), 95 pétales de tuyère, la verrière (charnière avant, 45°), le pilote ; l'occlusion ambiante par sommet (48 rayons) ; « F35B » v1 2,8 Mo. `scripts/build-f35-maps.py` — deux couches d'atlas 4096² (la cellule de l'avion seule ; le reste en cases), couleur, normales, métal-rugosité (2048²), **27 Mo de KTX2** en LFS. Crédit : `assets/f35/README.md`, l'aide du réglage Engin. Planche `f1-modele.jpg` |
| F2 | **Le rendu** | le vaisseau `f35` partout où le code liste les engins ; un matériau PBR texturé (couleur, normales, métal-rugosité) dans `ship.wgsl` ; les pièces mobiles posées par des matrices (uniforme), ombres comprises ; la verrière transparente ; les feux (navigation, anticollision, bandes de formation, phares du train avant) ; le panache d'un réacteur (postcombustion, diamants de choc) | ☐ |
| F3 | **Le vol** | le turbofan F135 (poussée selon la densité et le Mach, postcombustion, temps de réponse, consommation, 6 t de carburant) ; la masse, l'inertie, les coefficients d'un chasseur (portance, décrochage, traînée d'onde) ; **les commandes de vol électriques** du F-35 (facteur de charge commandé, limites d'incidence et de g) ; **les gouvernes visibles** suivant la loi de pilotage ; le train réel (géométrie, freins, roue avant orientable), le décollage et l'atterrissage sur les pistes existantes | ☐ |
| F4 | **Le STOVL** | le mode conversion (un bouton) : la tuyère qui pivote jusqu'à 95°, la soufflante et ses trappes, les tuyères de roulis ; la poussée partagée ; **la loi de vol stationnaire** (le manche commande des vitesses) ; décollage court, atterrissage vertical, aires d'atterrissage | ☐ |
| F5 | **Le cockpit** | l'intérieur (siège, manche latéral, manette, arceau de verrière, le pilote caché en vue intérieure) ; **l'écran panoramique** en pages tactiles (carte tactique, moteur, carburant, commandes de vol avec les gouvernes, navigation, armement, listes de vérification) ; **la symbologie du casque** | ☐ |
| F6 | **Le son** | le réacteur synthétisé (sifflement des étages, souffle, grondement de la postcombustion), la soufflante, le cockpit étouffé, la verrière, le train | ☐ |
| F7 | **Les effets de vol** | cônes de vapeur transsoniques, condensation sur l'aile sous facteur de charge, tourbillons d'extrémité et d'apex, chaleur de la tuyère ; voile gris, noir et rouge, respiration ; tremblements (tremblement d'approche du décrochage, roulage, transsonique) ; caméras cinéma (passage, tour, poursuite) | ☐ |
| F8 | **Plans de vol, interface, cartes** | un plan de vol détaillé (départ, points de route, arrivée, altitudes, vitesses, carburant prévu) édité sur la carte ; le suivi par l'autopilote (latéral et vertical) ; la carte tactique de l'écran ; le carburant de retour (« bingo ») ; le hub d'un vol (aéroport, heure, météo, emport) | ☐ |
| F9 | **Les défis** | portes en basse altitude (le Mach Loop gallois, des vallées), voltige notée, atterrissages notés (piste, vertical), courses chronométrées ; les meilleurs scores gardés | ☐ |
| F10 | **L'armement et le combat** | l'emport (soutes internes, canon), le radar et les cibles, les missiles (navigation proportionnelle), les bombes guidées, les leurres ; des cibles au sol et en vol (des drones, des avions menés par une IA) ; la symbologie de tir | ☐ |
| F11 | **Labo, finitions** | e2e par de vrais événements, mesure du coût GPU, `docs/F35.md` FR + EN, planche finale | ☐ |

Chaque étape : un commit, une planche dans `docs/progress/f35/`, FR + EN.
