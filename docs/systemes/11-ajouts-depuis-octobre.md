# Ce qui s'est ajouté depuis la première lecture

Les fiches 1 à 9 ont été rédigées le 2026-10-02 à partir d'une lecture complète du code. Depuis, le jeu a
reçu ses plans AAA : l'audit, l'assistance au pilotage, le hub, la météo, les aéroports, le son spatial,
les manettes et HOTAS, le cockpit interactif, la PWA, les voix et la musique, TARS agent. Cette fiche
recense, système par système, **chaque fichier apparu depuis**, avec son rôle et le guide qui le décrit
en détail. Le code fait foi ; l'en-tête de chaque fichier dit ce qu'il fait.

Rédigée le 2026-10-10. TARS a sa propre fiche : [10 · TARS, l'agent du jeu](10-tars-agent.md).

---

## Le contrôleur, découpé

`src/controls.ts` (6 655 lignes au 2 octobre) ne garde plus que la classe `CameraController`, son état et
ses entrées (1 188 lignes). Ses méthodes sont rangées par sujet dans `src/controller/`, chacune
**installée sur son prototype** (`this` reste le contrôleur) : le reste de la fiche 4 s'applique tel quel.

| Fichier | Ce qu'il contient |
|---|---|
| `controller/motion.ts` | Le vol libre et la gravité : les intégrateurs de la caméra et du vaisseau |
| `controller/piloting.ts` | Le pilotage : les commandes, les maintiens, les autopilotes, la rentrée, l'atterrissage |
| `controller/rotation.ts` | Les modes de rotation de la caméra : orbite, regard libre, pointeur, molette, touches |
| `controller/rig.ts` | Le rig de caméra : les points d'attache, les vues du vaisseau |
| `controller/lens.ts` | L'objectif et le télescope |
| `controller/docking.ts` | L'amarrage : les ports, l'approche, le contact |
| `controller/planet.ts` | Le repère d'une planète : le vol autour des mondes de Gargantua |
| `controller/journey.ts` | Le voyage à travers le trou de ver |
| `controller/telemetry.ts` | `FlightInfo` : la vue unique du vol que lisent tous les affichages |
| `controller/spectator.ts` | Le spectateur : une caméra libre loin du vaisseau, qui vole pendant ce temps exactement comme avant |
| `controller/util.ts` | Les clés de pose, les touches de vol par position physique, des aides de repère |

## Le vol et la physique (audit AAA, phase 2)

| Fichier | Rôle |
|---|---|
| `gear.ts`, `gear-mesh.ts` | Le train : des jambes ressort-amortisseur le long de la normale du sol, des pneus qui adhèrent par leur glissement, un antiblocage, une roue avant orientable ; son dessin (jambes, vérins, roues, trappes) |
| `gyro.ts` | Les axes du vaisseau transportés comme des gyroscopes (Fermi–Walker) le long de sa ligne d'univers près du trou |
| `wind.ts` | Le vent et sa turbulence |
| `descent.ts` | Le guidage de la descente propulsée (F7, le Lander après sa rentrée, un monde sans air) jusqu'à l'arrêt au sol |
| `jets.ts` | Quels propulseurs s'allument et combien (pour le son et l'image) |
| `ship-lights.ts` | Les feux du Ranger : navigation, stroboscopes, phares d'atterrissage |
| `frameclock.ts`, `units.ts`, `math/vec3.ts` | L'horloge du vol pour ses caches ; les unités, une seule fois ; les vecteurs, une seule fois |
| `system/ellipsoid.ts`, `system/geopotential.ts` | La Terre en ellipsoïde WGS84 ; l'aplatissement des corps (J2, J3, J4) |
| `system/lambert.ts` | Le problème de Lambert par la méthode d'Izzo (multi-révolutions, sans singularité à 180°) |
| `system/our-coast.ts`, `system/mean-orbit.ts` | Un vaisseau en roue libre de notre côté : sur rails (Kepler, dérive séculaire, déclin dans l'air ténu) aux grands warps, intégré sinon |
| `system/wormhole-flight.ts`, `wormhole-map.ts`, `wormhole-predict.ts` | La dérive de Dneg partagée par le vol et sa prédiction ; la projection sur la carte ; une prédiction qui garde son repère à chaque point |
| `fc/kerr-ops.ts`, `fc/land-ops.ts` | Les opérations de l'ordinateur de vol autour de Gargantua (géodésiques de Kerr) ; le posé sur un site choisi (passages, changement de plan) |

Guides : [AUDIT-AAA-2026-10-03.md](../AUDIT-AAA-2026-10-03.md), [AUDIT-WGS84-ELLIPSOIDE.md](../AUDIT-WGS84-ELLIPSOIDE.md),
[FLIGHTLAB.md](../FLIGHTLAB.md), [CAMPAGNE-AUTOPILOTES-2026-10-07.md](../CAMPAGNE-AUTOPILOTES-2026-10-07.md).

## Le HUD, le hub et l'assistance

| Fichier | Rôle |
|---|---|
| `ui/hud/symbology.ts` | La symbologie conforme : horizon, échelle de tangage, cap, inclinaison, marques orbitales, futur, piste, portes d'amarrage |
| `ui/hud/model.ts` | Le modèle de vue des instruments, partagé par le HUD et les écrans du cockpit |
| `ui/hud/alerts.ts` | Les alertes classées WARNING / CAUTION / ADVISORY, l'alarme maîtresse |
| `ui/hud/declutter.ts` | Ce que le HUD montre à chaque phase du vol (une matrice phase × élément) |
| `ui/hud/graph.ts` | Les graphes des assistants : une grandeur contre une autre, l'optimum, le couloir, le volé, la position |
| `ui/hud/trend.ts` | Les tendances ▲ ▼ des lignes du hub |
| `ui/hud/layout.ts`, `ui/hud/safe.ts` | La place des panneaux et des instruments ; le cadre libre où le HUD peut dessiner |
| `game/phase.ts`, `game/events.ts` | La phase du vol en une valeur ; les événements typés du jeu |
| `game/recorder.ts`, `game/report.ts` | L'enregistreur du vol (CSV) ; le rapport d'un posé ou d'un amarrage, noté sur 20 |
| `ui/tablet.ts`, `ui/telemetry-page.ts` | La tablette (M en vol) : ordinateur, vaisseau, télémétrie, cartes, journal ; la page TÉLÉMÉTRIE |
| `ui/keyhints.ts` | Les trois à cinq touches utiles maintenant, selon la phase |

Guides : [HUD.md](../HUD.md), [PLAN-HUB.md](../PLAN-HUB.md), [PLAN-ASSISTANT.md](../PLAN-ASSISTANT.md).

## La météo et les aéroports

| Fichier | Rôle |
|---|---|
| `weather.ts` | L'état de la météo à un endroit : vent, rafales, turbulence, cisaillement, visibilité, brouillard, trois couches de nuages, précipitations |
| `metar.ts` | Le vrai METAR d'un aérodrome (metar.vatsim.net, sans clé), décodé |
| `eclipse/core.ts`, `eclipse/earth-moon.ts`, `eclipse/moons.ts`, `eclipse/search.ts` | Le calculateur d'éclipses : l'ombre d'un astre sur un autre et les disques vus d'un lieu ; éclipses de Soleil (bande, gamma, saros) et de Lune (Danjon), circonstances locales, transits, phénomènes des satellites, éclipses vues de tout monde ; dans le worker du planificateur |
| `system/refraction.ts`, `system/sky-now.ts` | La réfraction de l'air de la Terre (le modèle du traceur, `airBend` : la colonne d'air de Chapman, ~35′ à l'horizon, selon la température) ; le ciel en chiffres à la caméra (hauteurs vraies et apparentes du Soleil et de la Lune) pour la télémétrie « sky » de TARS |
| `system/day-clouds.ts` | Les nuages réels du jour sur toute la Terre : la mosaïque satellite de GIBS (VIIRS, MODIS) changée en couverture nuageuse sur le GPU (démélangée de la Blue Marble), dans le vert de la carte de nuit |
| `openmeteo.ts`, `realweather.ts` | La vraie météo partout sur la Terre à la date du jeu (Open-Meteo : prévision de J−92 à J+15, archive ERA5 depuis 1940), décodée en couches, visibilité, pluie, orage, vent ; le choix entre METAR (maintenant, près d'une piste), modèle et tirage plausible (hors de portée) |
| `game/mls.ts`, `game/procedures.ts` | Le guidage MLS des pistes ; les cartes d'approche de chaque site (repères, profil, minima, remise de gaz) |
| `ui/weatherpanel.ts`, `ui/weather-map.ts`, `ui/weather-section.ts` | Le panneau Météo ; la météo sur le planisphère (radar, nuages, vent) ; la coupe verticale de l'air |
| `ui/charts-page.ts` | La page CARTES de la tablette : la carte d'approche du site |

La pluie (PLAN-PLUIE) : dans `display.wgsl`, la pluie qui tombe (`rainStreaks` : sept couches, rideaux, voile, cachée derrière
le vaisseau) et l'eau sur le verre (`wetGlass` : gouttelettes, gouttes qui glissent, l'objectif dehors) ; dans `trace.wgsl
earthGround`, le sol mouillé (`P.wx[5]` : humidité, flaques, ronds) ; dans `audio/engine.ts buildRain`, son bruit ; son
horloge `renderer.rainClock`, arrêtée avec le temps ; calculée où est la vue (`rainView` sur le contrôleur de la vue).

Le sol des terrains d'aviation (`game/sites.ts runwayGrade`, et la même fonction dans `trace.wgsl`) : chaque piste a
son niveau (`Site.elev`) ; la piste, ses bouts et son aire y sont nivelés, raccordés au relief par un talus, le
détail dessiné ôté — le CPU (le train) et le GPU (l'image) lisent le même sol. Le marquage de la piste se calcule
avec l'empreinte du pixel le long d'elle et en travers (A7).

Guides : [PLAN-METEO.md](../PLAN-METEO.md), [PLAN-AEROPORTS.md](../PLAN-AEROPORTS.md).

## Le cockpit interactif

| Fichier | Rôle |
|---|---|
| `cockpit/actions.ts` | Ce que fait chaque commande (les mêmes gestionnaires que les touches) |
| `cockpit/input.ts`, `cockpit/pointer.ts`, `cockpit/pick.ts` | Le pointeur sur le tableau : ce qu'il survole, ce qu'il tient (levier, bouton, interrupteur) |
| `cockpit/lights.ts`, `cockpit/placards.ts`, `cockpit/chrono.ts` | L'éclairage de la cabine et des écrans ; les gravures ; le chronomètre |
| `ui/cockpit-tip.ts` | L'info-bulle d'une commande : son nom, son état, sa touche |

Guide : [COCKPIT.md](../COCKPIT.md).

## Les entrées : clavier, manettes, HOTAS, tactile

| Fichier | Rôle |
|---|---|
| `input/keymap.ts`, `input/bindings.ts` | Le clavier en une table (l'aide en est tirée) ; les touches réaffectées par le joueur |
| `input/axes.ts`, `input/devices.ts`, `input/profiles.ts` | Les manettes : calibration, zone morte, courbe, manette des gaz absolue ; chaque appareil lu par son profil ; les HOTAS connus |
| `input/haptics.ts` | Les vibrations |
| `ui/controls-screen.ts`, `ui/pads-screen.ts`, `ui/padnav.ts` | L'écran des commandes ; l'écran des manettes (détection) ; la manette dans les menus |
| `ui/keys.ts`, `ui/wheel.ts`, `ui/pinch.ts` | La pile d'Échap ; la roue radiale (Tab tenu) ; le pincement à deux doigts sur une carte |

Guide : [HOTAS.md](../HOTAS.md).

## Le son, les voix, la musique

| Fichier | Rôle |
|---|---|
| `audio/space.ts` | Où est chaque source par rapport à l'oreille (HRTF, Doppler, retard) |
| `audio/rocket.ts`, `audio/engine-worklet.ts` | Le moteur fusée granulaire, sur le thread audio |
| `audio/voice.ts`, `ui/subtitles.ts` | La file des voix (priorités, péremption) et les voix du système ; les sous-titres |
| `game/callouts.ts`, `game/capcom.ts` | Les annonces de l'atterrissage ; Houston et la tour (délai de la lumière, blackout) |
| `audio/score.ts`, `audio/music.ts` | La partition des grands moments ; sa synthèse (orgue additif, nappes) |
| `audio/g2p.ts`, `audio/formant.ts`, `game/tars.ts` | La voix robot de TARS (phonèmes, formants) ; TARS hors ligne |

Guides : [AUDIO.md](../AUDIO.md), [TARS.md](../TARS.md).

## L'interface du jeu

| Fichier | Rôle |
|---|---|
| `ui/title.ts`, `ui/pause.ts` | L'écran titre ; le menu pause (Échap) |
| `ui/missions.ts`, `game/missions.ts` | Le choix des missions et leurs briefings |
| `ui/photo.ts` | Le mode photo (son bouton « Retour au jeu ») |
| `ui/placepanel.ts`, `ui/timepanel.ts` | Placer le vaisseau ; la date et l'heure de la scène |
| `ui/kit/index.ts` | Le kit de l'interface : les éléments, leurs `data-testid`, leurs noms pour les lecteurs d'écran |
| `i18n.ts`, `i18n/*` | La langue (français ou anglais) ; les textes traduits |
| `game/prefs.ts` | Les préférences du joueur, gardées hors des parties |
| `ui/map3d/gpu.ts`, `ui/map3d/paint.ts`, `ui/map3d/scene.ts`, `shaders/map.wgsl` | La carte sur le GPU : corps en imposteurs texturés et éclairés, orbites en lignes lissées |

Guides : [MAP.md](../MAP.md), [PLAN-CARTE.md](../PLAN-CARTE.md), [comment-jouer.html](../comment-jouer.html).

## La PWA, la robustesse, les mesures

| Fichier | Rôle |
|---|---|
| `pwa.ts`, `sw.ts`, `pwa/rules.ts` | Le manifeste et le Service Worker : l'application servie depuis son cache, jouable hors ligne, les tuiles de la Terre sous un budget |
| `util/swappable.ts` | Une poignée stable sur le renderer, reconstruit sur un nouveau GPU après une perte du périphérique |
| `gpu-diagnostics.ts`, `debug.ts` | Les diagnostics graphiques locaux ; les erreurs gardées en vue |
| `gpu-tables.ts`, `system/bc-encode.ts`, `system/heights-file.ts`, `util/inflate.ts` | Les tables du traceur en un buffer ; la compression BC7/BC5 au chargement ; le format des cartes de hauteur ; les maillages compressés |
| `quality-policy.ts` | La résolution dynamique et sa délégation au gouverneur GPU |
| `util/storage.ts`, `util/async-resource.ts`, `util/visible-timeout.ts`, `util/now.ts` | Le stockage sûr ; une ressource optionnelle bornée ; un délai en temps visible ; « maintenant » fixé par les tests |
| `bench/*`, `automation.ts` | Le Kerr Bench (ses suites, son rapport) ; `window.__bh`, la poignée des tests et des scripts |

Guides : [PERFORMANCE.md](../PERFORMANCE.md), [PLAN-MONDE.md](../PLAN-MONDE.md), [DEPLOY.md](../DEPLOY.md),
[REMOTE-TESTS.md](../REMOTE-TESTS.md), [IPAD-TESTS.md](../IPAD-TESTS.md).

## Le déploiement

Un push sur `main` passe par `.github/workflows/pages.yml` : la vérification (types, Biome, WGSL, tests),
la construction, puis deux déploiements du même artefact — GitHub Pages et le serveur
(https://samlepirate.org, une image nginx publiée sur GHCR, nommée par un commit sur la branche `deploy`
que Portainer relève toutes les 2 minutes). La branche d'essai `test-kimi` va sur Pages seulement, sous
`/test/`. Détails : [DEPLOY.md](../DEPLOY.md).
