# Plan AÉROPORTS — M5 du plan Monde (8 octobre 2026)

Suite de [`PLAN-MONDE.md`](PLAN-MONDE.md), phase **M5 : les aéroports vivants**. Suivi global : [`AAA-PROGRESS.md`](AAA-PROGRESS.md).

## Décisions du propriétaire (08/10/2026)

- **Le guidage façon navette** : des émetteurs par piste, un azimut (le localizer) et une pente comme le MLS de la navette — les aiguilles suivent la vraie trajectoire du Ranger, la pente raide puis la douce, pas un plan à 3° ; le HUD et l'écran NAV les montrent.
- **Le balisage de nuit complet, à l'OACI** : la rampe d'approche et ses feux à éclats séquentiels (« le lapin »), les feux d'axe et de zone de toucher, les bords jaunes sur la fin, les flashs d'identification de seuil, le phare tournant, les voies de circulation ; allumés la nuit et par mauvaise visibilité.
- **Les procédures d'approche : cartes, HUD et autopilote** : une carte d'approche par site dans la tablette (ses points, ses minima, sa remise de gaz), les points dans le HUD et sur la carte, l'autopilote qui les suit et sait remettre les gaz.
- **Le décor statique d'abord** : hangars, tour, avions et véhicules garés ; le trafic animé plus tard, si le budget GPU le permet.

## État de départ (inventaire du 08/10/2026)

- **Les pistes** (`game/sites.ts`, `trace.wgsl runwayShade`) : sept pistes terrestres et Edmunds, posées dans les deux sens (W4) ; le marquage peint (seuils, axe, bords, point de visée, zone de toucher) ; des feux posés au sol — bords tous les 60 m, seuil vert, fin rouge, le PAPI —, allumés jour et nuit (40 fois plus forts la nuit) ; la manche à air.
- **Le guidage** : l'écran NAV du cockpit montre deux aiguilles calculées depuis la vue de la piste (pas d'émetteurs) ; le HUD, la case de piste, le profil, le PAPI, les portes.
- **L'approche du Ranger** (`controller/computer.ts approach`) : le cylindre d'alignement (la spirale), le point d'entrée en finale à 12 km, la pente raide puis l'arrondi ; pas de remise de gaz.
- **Absents** : rampe d'approche, feux d'axe et de zone de toucher, phare, voies de circulation, numéros de piste, bâtiments, cartes d'approche.

## Étapes

| # | Étape | Contenu | Statut |
|---|---|---|---|
| A1 | **Le balisage OACI** | rampe d'approche (900 m, barrettes, barre transversale à 300 m, éclats séquentiels deux fois par seconde vers le seuil), feux d'axe tous les 15 m (blancs, rouges et blancs alternés sur les 900 derniers m, rouges sur les 300 derniers), zone de toucher (barrettes sur 900 m), bords (jaunes sur les 600 derniers m), flashs de seuil, phare tournant ; aux deux bouts, du sens en service ; leur intensité selon le jour et la visibilité ; mesuré au banc | **fait** (le phare tournant passé en A3, sur la tour) : `trace.wgsl runwayLights` — bords tous les 60 m (jaunes sur les 600 derniers), seuil vert, bout rouge, axe tous les 15 m (blanc ; rouge et blanc sur 900–300 m du bout ; rouge sur les 300 derniers), zone de toucher (barrettes de trois, 9–12 m de l'axe, tous les 30 m jusqu'à 900 m), rampe d'approche ALSF (barrettes de cinq tous les 30 m sur 900 m, barre transversale à 300 m, éclats séquentiels deux fois par seconde), flashs de seuil ; au bout en service (W4) ; **chaque feu étalé sur l'empreinte réelle du pixel** (une ellipse le long d'une vue rasante : des rangées de points au lieu d'une dalle) ; la nuit des milliers de fois la lumière du ciel nocturne, de jour au plus fort par mauvaise visibilité (moins de 3 km : `runways[17]`), en plein jour non calculés ; traceur près d'une piste : de jour inchangé (10,14 → 10,37 ms), de nuit ~+1 ms ; planche `a1-balisage.jpg`. À revoir : les coordonnées de Tanegashima (la piste tombe en mer) |
| A2 | **Les marquages et les voies** | les numéros de piste peints aux deux bouts, les bandes latérales ; une voie de circulation parallèle et ses bretelles (marquage jaune, feux bleus de bord, axe vert), les lignes d'arrêt | à faire |
| A3 | **Le décor statique** | une tour de contrôle, des hangars, des avions et véhicules garés près de chaque piste terrestre (formes simples du traceur, coupées au-delà de quelques km) ; mesuré | à faire |
| A4 | **Le guidage façon navette** | par piste un émetteur d'azimut (au bout opposé) et de site (à côté du point de visée), leur couverture ; les écarts angulaires au profil du Ranger (pente raide, puis douce) ; l'écran NAV et le HUD (échelles, losanges, « AZ / EL » acquis), la case de piste ; FR + EN | à faire |
| A5 | **Les procédures d'approche** | par site (pistes : chaque sens ; pads de Mars, de la Lune, de Titan, de Gargantua) ses points — l'entrée, l'alignement, la finale, les minima — et sa remise de gaz ; une page « Cartes » dans la tablette (vue en plan et profil) ; les points dans le HUD et la carte ; l'autopilote les suit et **remet les gaz** si l'approche n'est pas stabilisée aux minima (moteurs, circuit, nouvelle approche) ; e2e | à faire |
| A6 | **Labo, finitions** | scénarios au labo : approche de nuit, remise de gaz, approche par mauvaise visibilité ; `HUD.md`, i18n, planche finale | à faire |

Chaque étape : un commit, une planche avant/après dans `docs/progress/aeroports/`, FR + EN, mesure avant d'adopter pour tout ce qui touche au traceur.
