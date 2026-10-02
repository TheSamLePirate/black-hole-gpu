# Plan — la carte, l'ordinateur de bord, les missions, le hub

Demande (2026-10-02) : les missions entre corps dans l'onglet MISSION ; toute la vue carte améliorée —
le rendu, les orbites, les prédictions, les panneaux qui se chevauchent, le panneau de l'ordinateur de
bord ; les boutons du hub (circulariser, décoller, atterrir…) qui correspondent ; l'interface de la carte
(3D, globe, planisphère) refaite, de qualité AAA ; les images des planètes dans la carte 3D ; la
prédiction du trajet affichée dès qu'un plan est demandé, avant de l'exécuter. Tout parfait.

Décisions de l'utilisateur :
- **Hub** : ses boutons font les **mêmes calculs** que l'ordinateur de bord — une seule logique par
  action (pas un autopilote d'un côté, un planificateur de l'autre).
- **Rendu** : la carte 3D en **vraie 3D GPU** (WebGPU : sphères texturées et éclairées, orbites lissées,
  étiquettes en surcouche).
- **Missions** : dans **les deux univers** (notre système ; Gargantua : le trou, ses mondes, l'étoile, le
  trou de ver), avec l'aperçu du trajet avant l'exécution.
- **Disposition** : carte ouverte, les instruments du HUD **masqués**, une **bande compacte** (vitesse,
  altitude, autopilote, hub réduit) ; ordinateur de bord à gauche, analyse à droite, frise en bas.

## État de départ (relevé du 2026-10-02)

- Carte 3D : Canvas 2D (`ui/map3d/`), corps en disques dégradés, pas de textures ; scènes refaites à
  chaque image ; chemins (libre, plan, coniques), nœuds éditables, frise, étiquettes dé-chevauchées.
- Globe et planisphère (`ui/groundtrack.ts`) : raster CPU (≤ 420 px), cartes 2048×1024 des planètes ;
  les mondes de Gargantua en bandes teintées ; ni sites, ni chemin d'entrée.
- Carte plein écran : l'ordinateur de bord par-dessus (panneaux à 26 px des bords), qui recouvre le pied
  de carte, l'échelle, la barre, le panneau CIBLE ; le navball au centre ; cadrage aveugle aux panneaux ;
  carte vide en densité HUD 1 (mobile).
- Aperçu : l'ordinateur de bord n'affiche qu'un tableau ; « TO THE PLAN » et « EXECUTE » remplacent le plan
  en place ; MISSION et les opérations de Kerr écrasent le plan sans aperçu ; les poussées autour des
  mondes de Gargantua (`fcBurns`) ne sont jamais tracées.
- Missions : deux interfaces (le planificateur du HUD, touche O ; l'onglet MISSION), l'onglet limité à
  notre système et sans aperçu.
- Hub : HOLD POS, CIRC, APPROACH, LAND, TAKE OFF, ENTRY — des autopilotes à bascule (un second appui
  annule), indépendants des opérations de l'ordinateur de bord.

## Phases (chacune : commit, fiche `docs/progress/NNN_*.jpg`, vérification dans le navigateur)

### C1 — La disposition de la carte
- Carte ouverte : le HUD masqué sauf la barre du haut ; une bande compacte en bas (vitesse, altitude, Ap/Pe,
  autopilote engagé, hub réduit aux actions) ; ordinateur de bord à gauche, analyse à droite, repliables ;
  la zone centrale libre pour la carte — sa barre, sa frise, son pied et son cadrage dans cette zone.
- Plus aucun chevauchement à 1280×720 comme à 2560×1440 ; la densité 1 fonctionne ; sélecteurs morts
  retirés.

### C2 — L'aperçu du trajet (avant l'exécution)
- Un plan **candidat** non destructif dans le contrôleur : chaque opération prévisualisée y est prédite
  (notre côté : le prédicteur n-corps du worker ; le trou : `planPath` ; les mondes de Gargantua : leurs
  poussées propagées dans leur repère, ramenées sur la carte), tracé dans un style propre avec ses
  nœuds, ses apsides, son arrivée, ses marques sur la frise, sur le globe et le planisphère.
- « TO THE PLAN » l'adopte, « DISCARD » l'efface, changer d'onglet aussi ; plus d'écrasement silencieux.
- Les plans des mondes de Gargantua et le chemin d'entrée tracés partout (3D, globe, planisphère, sites).

### C3 — Les missions entre corps (onglet MISSION)
- Notre système : la cible choisie dans un arbre des corps (planètes, lunes, l'ISS, le trou de ver), l'arrivée
  (orbite, survol, retour libre), l'altitude d'arrivée et de retour, la fenêtre (attendre la prochaine,
  partir maintenant) ; le résultat prévisualisé : Δv par poussée, dates, durée, trajet sur la carte.
- Gargantua : depuis l'orbite du trou ou d'un monde, vers Miller, Mann, Edmunds, l'étoile (orbite ou
  rendez-vous), le trou de ver ; le trajet de Kerr prévisualisé.
- Le planificateur du HUD (touche O) renvoie vers l'onglet MISSION : une seule interface.

### C4 — Le hub et l'ordinateur de bord : les mêmes calculs
- Chaque bouton du hub est une opération de l'ordinateur de bord, du même code :
  CIRC = « Circulariser maintenant » (en boucle fermée), TAKE OFF = « Mise en orbite » (altitude,
  inclinaison), LAND = « Atterrir ici », ENTRY = « Désorbiter, rentrer, atterrir », APPROACH = « Approche
  et maintien » de la cible, HOLD POS = « Tenir la position ».
- Un appui engage (ne bascule plus) ; le même bouton allumé annule ; les mêmes noms et icônes des deux
  côtés.

### C5 — La carte 3D en WebGPU
- Un rendu GPU partageant le device du traceur : sphères texturées (les cartes des planètes, la Terre
  jour/nuit et ses nuages), éclairées par le Soleil ou l'étoile, limbe d'atmosphère, anneaux de Saturne ;
  le Soleil et l'étoile rayonnants ; Gargantua (horizon, disque d'accrétion, anneau de photons) ; ses
  mondes en textures procédurales (Miller l'océan, Mann la glace, Edmunds les plateaux, comme le traceur).
- Orbites et trajets en lignes GPU lissées (épaisseur en pixels, fondu de profondeur, tirets), positions
  rebasées sur la caméra (float64 → float32) ; étiquettes, cartes et poignées en surcouche Canvas 2D,
  même projection.
- Globe et planisphère GPU : la carte du corps (HD quand chargée), la nuit, le terminateur, les nuages de la
  Terre ; les traces, sites, chemins par-dessus.

### C6 — Finitions AAA
- Étiquettes sans chevauchement, cartes au survol, légende, transitions, typographie et couleurs
  cohérentes ; performances (scènes mises en cache, worker pour les chemins lourds) ; positions des corps
  cohérentes entre scène et étiquettes ; README, aide.

## Avancement

| Phase | État | Commit · fiche |
|---|---|---|
| C1 disposition | fait : HUD masqué, panneaux latéraux repliables, bande compacte, cadrage dans la zone libre, densité 1 | · 150 |
| C2 aperçu du trajet | fait : candidat non destructif, tracé 3D/globe/planisphère/frise, mondes de Gargantua (orbite libre, plan, aperçu), sites | · 151 |
| C3 missions | à faire | |
| C4 hub = ordinateur de bord | à faire | |
| C5 carte WebGPU | à faire | |
| C6 finitions | à faire | |
