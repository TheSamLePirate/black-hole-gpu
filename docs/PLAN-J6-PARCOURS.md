# PLAN-J6 — Les parcours complets (stratégie §19.13)

**État (2026-11-15 18:45 UTC)** : **J6-1 et J6-2 faits** — leurs parcours passent ; trois défauts trouvés et corrigés (le décollage
automatique, le décor en vol rapide, l'arrivée de la météo réelle d'un coup). **J6-3 ouvert** : son parcours écrit, bloqué par un défaut
relevé (l'avion glisse après le roulage de l'ILS : on ne peut pas débarquer). Les jalons J0 à J5 ont été menés (PLAN-J1 à PLAN-J5) ; le 15 novembre,
Sam a nommé **~48 ms de GPU sur J0 le palier intermédiaire de kerr-mini** ([J0-CONTRAT](J0-CONTRAT.md) §2) et demandé de reprendre la
suite du plan, lumière et contenu. La stratégie ([ANALYSE-STRATEGIE](ANALYSE-STRATEGIE-RENDU-2026-11-03.md) §19.13) demande que les jalons
« transportent l'expérience en même temps que les passes » : **un parcours n'est terminé ni avec une scène vide, ni avec un état choisi
parce qu'il est favorable au renderer**. Ce plan fait des neuf parcours de référence des tests qui les jouent d'un bout à l'autre et des
lots qui corrigent ce qu'ils trouvent. Le code fait foi.

## 1. Le point de départ : chaque condition testée seule, aucun parcours entier

Inventaire du 15 novembre (lecture de [E2E-CATALOGUE](E2E-CATALOGUE.md) et des en-têtes des tests ; aucun test lancé) :

| Parcours | Déjà couvert (e2e) | Condition jamais vérifiée |
|---|---|---|
| P1. Reprendre un avion au sol | `aircraft-save` (F-35), `saves`, `quickload`, `a320-start`, `a320-services`, `a320-gate`, `gear`, `cockpit`, `fleet-switch` | l'A320 jamais dans une sauvegarde ; l'état rendu contre le niveau de sauvegarde **annoncé** ; le support prêt avant le roulage **après une reprise** |
| P2. Décoller puis virer en ville | `title-departure`, `runway-placement`, `apprendre-avions`, `j2-page-camera` (trous, **mesurés**), `cut-buildings-trees` (sonde), `buildings`, `city-shadows`, `city-flicker`, `traffic-*`, `instruments-age` (en orbite), `j0-reference` (coût, mesuré) | trou sous le regard arrière **asserté** ; le décor proche gardé contre le centre du chargement ; l'âge des instruments dans un virage bas en ville ; rien n'enchaîne décollage, ville, trafic et ombres |
| P3. Approcher sous météo dégradée | `metar`, `weather-panel`, `weather-grid`, `rain`, `rain-glass`, `a320-rain`, `cloud-volume-fade`, `runway-wind`, `approach-auto`, `ils`, `assist-final` | la **même** météo pour la physique et l'image ; une source qui arrive en vol sans rupture ; la priorité des commandes manuelles sous la météo ; la cadence avec la météo |
| P4. Se poser puis débarquer | `landing`, `gear`, `character`, `character-aaa`, `gargantua-ground`, `ground-placement`, `modes` | la physique indépendante du niveau de qualité ; le contact suivi de l'atterrissage à la marche ; la caméra de marche libre d'obstacles ; le pilotage après être remonté |
| P5. S'éloigner en caméra libre | `spectator`, `j2-contact-camera` (mesuré), `ground-camera-warp`, `camera-travel`, `camera-smooth`, `view-pose` | un avion **en vol** gardant son sol (asserté) ; son état simulé avant / après F3 → F1 ; l'ordre des horloges |
| P6. Passer vers l'orbite et observer | `assist-climb`, `apprendre-vaisseaux`, `camera-voyage`, `ellipsoid`, `geoid`, `refraction-wgs84`, `twilight-sky`, `look-profile`, `planets-baseline` | une montée sol → orbite sans saut de datum ni d'origine (assertée) ; la qualité cohérente (mesurée seulement) ; les approximations expliquées au joueur |
| P7. Masquer / reprendre, reconstruire le GPU | `gpu-recovery`, `gpu-recovery-hold`, `gpu-startup`, `hidden-tab`, `fps-truth`, `net-cut` | la perte du GPU **en salle** ; textures, tuiles et cockpit après la recréation ; le contact de la nouvelle génération avant la reprise ; les commandes pendant la reprise |
| P8. Filmer puis revenir au jeu | `photo-video`, `s3-replay`, `multiexposure`, `sky-events`, `modes`, `scene-color`, `export-parity` | la fidélité annoncée contre le fichier ; les systèmes et l'autopilote d'un avion en vol après le mode photo ; les événements pendant une capture |
| P9. Commander TARS pendant une transition | `tars`, `tars-agent`, `tars-eval` (en direct seulement), `tars-aircraft-tools`, `tars-settings-panel`, `tars-room` | TARS **pendant** une transition ; une commande périmée revalidée ou interrompue ; l'annulation selon le point de reprise |

## 2. Les lots

Chaque lot : **un e2e de parcours** qui joue le parcours d'un bout à l'autre, dans le profil principal (raster, cockpit), ses données
attendues avant chaque mesure ([E2E-VOLS](E2E-VOLS.md)), ses conditions **assertées** (une mesure seulement relevée n'est pas une
condition), des captures aux états clés ; puis la correction de ce qu'il trouve. Une sonde nouvelle passe ses témoins (règle 3).

| Lot | Parcours | Contenu | Fini quand |
|---|---|---|---|
| **J6-1** | P2 (lumière, contenu) | décollage d'un aérodrome près d'une ville (Toulon-Hyères → Toulon, ou Orly → Paris), virage bas au-dessus des bâtiments, l'après-midi puis au soleil rasant : trous sous le regard arrière (la mesure de `j2-page-camera` assertée), bâtiments proches présents (`cut-buildings-trees`), ombres, trafic, âge des instruments, coût de la scène | le parcours passe sur kerr-mini et sur ce Mac ; ses défauts corrigés ou écrits dans PROBLEMES |
| **J6-2** | P3 | une approche aux instruments sous pluie et plafond bas : la même météo lue par la physique et par l'image, un METAR qui change en vol, les commandes manuelles reprises, la cadence | idem |
| **J6-3** | P4 | atterrir, rouler, s'arrêter, descendre, marcher autour, remonter, redécoller ; le contact suivi en continu ; deux niveaux de qualité comparés (la physique la même) | idem |
| **J6-4** | P1 | sauvegarder un A320 et un F-35 au parking, moteurs coupés puis en marche ; recharger : l'état rendu selon le niveau annoncé, le support au sol avant le roulage | idem |
| **J6-5** | P5, P8 | en vol : caméra libre loin puis retour, mode photo puis retour — l'état simulé avant / après, le sol de contact gardé, l'autopilote | idem |
| **J6-6** | P7 | la perte du GPU en vol, en solo puis en salle : la reprise, les textures et le contact de la nouvelle génération, les commandes | idem |
| **J6-7** | P9 | TARS pendant un voyage ou une montée : une commande devenue périmée, l'annulation | idem (modèle scripté, sans clé) |
| **J6-8** | P6 | la montée sol → orbite sans saut de datum ni d'origine, l'exposition le long du chemin | idem |

**Ordre recommandé** : J6-1 → J6-2 → J6-3 → J6-4 → J6-5 → J6-6 → J6-7 → J6-8 (la lumière et le contenu d'abord, comme demandé ; puis le
vol de bout en bout ; les transitions ensuite).

## 3. Questions pour Sam

1. **L'ordre** : J6-1 (décoller puis virer en ville) d'abord ?
2. **La ville de J6-1** : Toulon (la scène J0 voisine, la mer et la ville) ou Paris (la ville dense, la référence de J3) ?
3. **Les conditions mesurées aujourd'hui** (trous arrière, décor proche, âge des instruments) : les asserter avec les seuils relevés
   (p. ex. l'âge des instruments p95 < 70 ms, déjà asserté sur J0), ou d'abord les relever sur chaque parcours ?

**Réglées provisoirement (2026-11-15 16:10 UTC), selon les recommandations — révisables par Sam** : l'ordre du §2 ; Toulon pour J6-1 (la
scène J0 connue, la mer et la ville, l'aérodrome) ; les seuils déjà relevés assertés, les autres relevés d'abord.

## 4. Non vérifié

L'inventaire du §1 vient de la lecture du catalogue et des en-têtes : aucun test n'a été relancé pour l'écrire.

## 5. Avancement

- **Plan écrit** (2026-11-15 16:10 UTC).
- **J6-1, le parcours volé ; deux défauts** (2026-11-15 17:02 UTC) : e2e `parcours-ville` — le F-35 décolle de Toulon-Hyères par la vraie
  touche U, vole vers le centre de Toulon à 500 m et 150 m/s (son relèvement repris toutes les 10 s), vire au-dessus de la ville, le
  regard arrière, le cockpit de nouveau ; à chaque image l'âge des écrans, les trous du relief sous la caméra, les blocages, le GPU.
  **Premier défaut, corrigé** : réglé pendant la montée du décollage automatique (cap, altitude, vitesse), le pilote automatique était
  ignoré — l'avion en palier à ~100 m et 210 m/s sur l'axe de la piste, jusqu'aux collines des Maures : les maintiens, engagés pendant
  le roulage, prenaient le manche du décollage pour celui du pilote et, lâchés, tenaient la hauteur du moment. Les choix faits pendant le
  décollage sont désormais **armés** et deviennent ses maintiens à sa fin (`apSet` → `rwyRun.sel`, `jetToggle` y répond sans engager) ;
  e2e `takeoff-armed` (Edwards, pas à pas : sans choix, terrain + 1 500 m / axe / 210 m/s ; armés 2 500 m / 270° / 150 m/s, tenus) ;
  `apprendre-avions` **7/7** revolé. **Second défaut, relevé** : en arrivant sur Toulon, aucun bâtiment ni arbre devant à moins de 5 km —
  le décor, en scènes « rapides » au-delà de 120 m/s, arrive derrière l'avion ([PROBLEMES](PROBLEMES-A-REGLER.md), « Le décor ne suit pas un
  vol rapide ») : relevé, non asserté. **Mesuré** (kerr-mini, trois passages) : en l'air 10,3 s après U ; **aucun trou du relief** sous la
  caméra de tout le vol ; l'âge des écrans p95 **58,2 ms** dans le cockpit (l'extérieur ne les dessine pas : leur âge y grandit, 14,9 s, hors de
  l'assertion) ; le plus long blocage de la page 68–83 ms ; GPU p50 45–57 ms en vol, 64 ms dans la vue extérieure. Suite : le décor en vol
  rapide (le temps de chaque étape du worker, l'ordre bâtiments / forêt, l'avance), puis asserter les bâtiments proches.
- **Le décor en vol rapide, le temps de ses étapes** (2026-11-15 17:18 UTC) : un quatrième passage, `stats().phases` relevé : une scène
  rapide passe 2 à 16 s sur ses tuiles de bâtiments (la « forêt » affichée est l'étape suivante, ~0,5 s) ; ce passage : 71 points de bâtiment
  devant à l'arrivée (0 aux trois autres). La suite : une boîte rapide décalée vers l'avant, mesurée sur plusieurs passages ([PROBLEMES](PROBLEMES-A-REGLER.md)).
- **J6-1 : le décor suit le vol rapide** (2026-11-15 17:40 UTC) : l'avance d'une scène rapide portée de 1,2 à 2,5 fois son rayon
  (`renderer.sceneryQuickLead`) ; deux passages : 36–38 points de bâtiment devant en arrivant sur Toulon (0 à trois passages sur quatre avant),
  83–97 à moins de 2 km dans le regard arrière ; GPU au même niveau. Le parcours asserte désormais les bâtiments devant ; **il passe** (deux
  fois). **J6-1 fait** ; le levier gardé pour les comparaisons. Suite : J6-2 (l'approche sous météo dégradée).
- **J6-2 : l'approche sous météo dégradée ; la météo réelle n'arrive plus d'un coup** (2026-11-15 18:03 UTC) : e2e `parcours-meteo` — le F-35
  au large d'Hyères, l'ILS de Toulon-Hyères engagé (`ilsStart` choisit la 31 et la construit), la météo réelle choisie en approche, son METAR
  servi par la page (pluie, 2 500 m, BKN 600 ft, 250° 18 kt rafales 28) ; puis le manche tenu 1,5 s. **Trouvé** : la source arrivée en vol
  **basculait en une image** — la météo de l'image (brume, couche, pluie) toute en une image, le vent du vol de rien à 20 m/s. **Corrigé** :
  `weather.ts` `weatherHere` — une source qui arrive ou change, la météo réelle déjà choisie, fondue en 20 s (`WEATHER_FADE_S`), une seule
  horloge et une seule transition pour le vol (`piloting`) et l'image (`renderer.weatherParams`), chacun à sa place ; un réglage choisi et un
  placement (`newFlight` → `weatherFadeCut`) restent immédiats. **Mesuré** (kerr-mini) : la plus grande part du changement de l'image en une image
  **1 → 0,03**, le plus grand saut du vent en une image **18,7 → 1,15 m/s** ; la physique et l'image lisent le même état (`camera.weatherReal ===
  renderer.weatherReal`) ; le manche prioritaire (le pilote automatique de l'ILS lâché, ses aiguilles gardées — `ilsRun.manual`) ; GPU p50 ~50
  ms beau temps, 55–83 ms à l'arrivée et sous la pluie (le noyau de la météo compilé à l'arrivée : un blocage de 84 à 433 ms selon le passage —
  relevé). Tests : `weather-fade` 3/3 (unitaires), `metar` 2/2 (il attend la fin du fondu ; son second test daté du 12 août passe désormais par
  l'archive d'Open-Meteo, accepté), `weather-panel` W3 (la base de la couche comparée au sol du bloc — le géoïde, −29 m à Cap Canaveral). Suite :
  J6-3 (se poser puis débarquer) ; la compilation du noyau de la météo à l'arrivée d'une source (le blocage).
- **J6-3 ouvert : se poser puis débarquer — bloqué** (2026-11-15 18:45 UTC) : e2e `parcours-debarquer` (finale directe de 9 km sur la piste
  que l'ILS choisit — le départ de J0 par l'approche planifiée vers la 31 « construite » partait en remise de gaz et ne se posait pas en 300 s :
  donné à la session PLAN-APPROCHES, dont c'est le chantier en cours). **Mesuré** (kerr-mini, cinq passages) : ILS 05, **19,5/20**, toucher à
  640 m et 1,6 m de l'axe, −1,2 m/s, **aucun rebond** ; le sol de contact sous l'appareil le même niveau (z 17) sous deux réglages graphiques
  (`detailReach` normal / veryFar, décor balanced / full ; hauteurs 0,312 / 0,311 m, l'avion ayant glissé entre les deux lectures) ; **puis
  l'avion glisse de 2,7 m en 10 s, freins serrés, sans vent ni lacet** — jamais au repos, la sortie refusée (« Land the vessel before going
  out. ») ([PROBLEMES](PROBLEMES-A-REGLER.md)). Le parcours échoue en le disant. Suite : la cause du glissement (les pneus à l'arrêt, la pente
  de la piste), puis la marche, le retour à bord et le redécollage.
