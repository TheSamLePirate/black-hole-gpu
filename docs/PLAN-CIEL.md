# Plan CIEL — la vraie météo, la réfraction, les éclipses, les surimpressions (10 octobre 2026)

Suite de la météo ([`PLAN-METEO.md`](PLAN-METEO.md), [`PLAN-PLUIE.md`](PLAN-PLUIE.md)). Suivi global : [`AAA-PROGRESS.md`](AAA-PROGRESS.md).

## La demande (10/10/2026)

« Vraie météo. Réfraction atmosphérique (éclipse sélénélion). Des photos en surimpression : l'analemme solaire (chaque
jour à la même heure, au même endroit, le même angle de vue — avec un bon réglage pour voir le huit) ; une éclipse (5
moments avant la totalité, la totalité, 5 après, sur la même image). Un calculateur d'éclipses dans le système solaire :
toutes, partielles, totales, lunaires, annulaires… les éclipses des satellites des planètes (Jupiter et les autres). Une
super interface pour le calculateur. Tout disponible pour TARS. Commit et push à chaque étape. Vérifier que la réfraction
marche bien sans trop coûter. Qualité AAA. »

## L'état de départ (inventaire du 10/10/2026)

- **Météo réelle** : seulement le METAR des sept pistes terrestres (`metar.ts`, dans 600 km), toujours celui de
  l'instant présent, quelle que soit la date du jeu ; ailleurs, le beau temps. **Les nuages du globe** : une carte fixe
  (le canal alpha du cube de la Terre).
- **Éclipses au rendu** : l'ombre de la Lune sur la Terre (`P.eclipse`, `sunSeen`, la couronne) ; **aucune ombre d'un
  astre sur un autre** : la Lune reste pleine dans l'ombre de la Terre, les satellites de Jupiter brillent dans la sienne,
  ni leurs ombres sur Jupiter.
- **Réfraction** : aucune (les astres à l'horizon à leur place géométrique).
- **Éphémérides** : DE440 (1990 – 2150 : le Soleil, les planètes, la Lune), JUP365 (les galiléens), les autres satellites
  par leurs éléments. `seenFrom` (le temps de lumière), `diskShare`.
- **Photo** : le mode photo (`ui/photo.ts`) — exposition, champ, profondeur de champ, PNG, rendu hors ligne.

## Décisions du propriétaire (10/10/2026)

- **La vraie météo partout, à la date du jeu** : Open-Meteo (gratuit, sans clé, CORS vérifié le 10/10) en tout point de la
  Terre — sa prévision de J−92 à J+15, l'historique ERA5 depuis 1940 au-delà ; **les nuages réels du jour sur tout le
  globe** (imagerie satellite GIBS) ; hors de portée (2067…) : un tirage plausible. Le METAR reste la mesure près d'une
  piste quand la date du jeu est l'instant présent.
- **Au rendu** : l'horizon réfracté (astres relevés, Soleil aplati — le sélénélion visible), **l'éclipse de Lune rouge**
  (l'anneau d'air de la Terre, le liseré turquoise de l'ozone), **les ombres des satellites** (galiléens éteints dans
  l'ombre de Jupiter, leurs ombres sur lui, Phobos, Titan…), **le rayon vert**.
- **Surimpressions** : l'analemme (cadence réglable, 7 jours par défaut), la séquence d'éclipse (5 + totalité + 5), et
  aussi **le filé d'étoiles**, **le trajet de la Lune** (une nuit, ou ses phases jour après jour), **le passage de l'ISS**.
- **Le calculateur** : éclipses de Soleil et de Lune (toutes formes), **les phénomènes de Jupiter** (éclipses,
  occultations, passages, passages d'ombre), **Saturne, Mars, Neptune** (Titan…, Phobos et Deimos devant le Soleil vus de
  Mars, Triton), **les éclipses vues de n'importe quel astre**, **les transits de Mercure et Vénus**.
- **Tout pour TARS** (CLAUDE.md : agir, lire, montrer, être réveillé, taper), **commit et push à chaque étape**.

## Étapes

| # | Étape | Contenu | Statut |
|---|---|---|---|
| C1 | **La météo réelle partout** | `openmeteo.ts` : en tout point de la Terre, à la date du jeu (prévision J−92…J+15, ERA5 depuis 1940), décodée en un état W1 (couches basse/moyenne/haute, base au point de condensation, visibilité, pluie, orage, brouillard, vent, rafales, température et pression) ; le METAR gardé près d'une piste à l'instant présent ; hors de portée, le tirage ; le panneau dit la source ; TARS | **fait** : `openmeteo.ts` — la requête selon la date du jeu (la prévision de J−90 à J+15, l'archive ERA5 avant ; au-delà rien), un jour d'heures par maille de 0,25°, lues à l'heure du jeu (entre deux heures, le temps entre — par pas de dix minutes, l'image n'est pas refaite à chaque minute) ; décodée : la couche basse à sa base de condensation (125 m par degré d'écart au point de rosée), profonde selon l'énergie de convection (cumulus bourgeonnant, cumulonimbus à l'orage), la moyenne à 3–4,5 km, des cirrus minces, la visibilité (devinée dans l'archive par l'humidité et la pluie), la pluie 0,3 √(mm/h), le brouillard, le vent et ses rafales, la température et la pression (pour la réfraction, C3). `realweather.ts` choisit : le METAR d'une piste à moins de 60 km quand la date du jeu est maintenant, sinon le modèle, hors de portée (2067…) et sur les autres mondes un tirage plausible ; un état posé par un script est gardé. Le panneau dit la source, l'heure, la maille, la température, la pression. TARS : `get_weather` dit la source, **`weather_at`** (lieu, date) lit la météo réelle de n'importe où, `/weatherat`. Vérifié en réseau réel : **Paris le 11/08/1999 à 10 h 20 UTC (l'éclipse) : couvert à 790 m et 3 km, bruine** — ce qu'on sait de ce jour-là ; Burgos le 12/08/2026 à 18 h 30 : clair, 36 °C. Unitaires `openmeteo` (7, réponses réelles enregistrées), `tars-tools` ; e2e `metar` (le modèle, le tirage, le METAR à la date de maintenant). En route : les e2e `metar` et `weather-panel` lisaient le bloc météo à l'ancienne place (la pluie P4 l'a agrandi). Planche `c1-meteo-reelle.jpg` |
| C2 | **Les nuages réels du globe** | l'imagerie GIBS du jour (VIIRS/MODIS) en nuages : la carte du jour moins la Blue Marble, les trous des orbites comblés par la carte fixe ; dans le traceur et sur la carte météo ; mesuré | à faire |
| C3 | **La réfraction** | dans le traceur, la déviation des rayons sortant de l'air de la Terre (la fonction de Chapman : ~35′ à l'horizon, selon la pression et la température du lieu, rasant vu d'orbite le double) : astres relevés, Soleil et Lune aplatis ; les positions apparentes côté CPU (étiquettes, lever/coucher) ; mesuré (trace-ab) | à faire |
| C4 | **Le rayon vert** | la dispersion : chaque couleur réfractée de son angle, le bord haut du Soleil couchant vert (le bleu diffusé) ; visible au téléobjectif | à faire |
| C5 | **Le moteur d'éclipses** | `eclipses/` : la géométrie générale ombre/pénombre sur les éphémérides ; éclipses de Soleil (type, gamma, grandeur, point et durée du maximum, bande de centralité) et de Lune (contacts, grandeurs), circonstances locales, transits, phénomènes des satellites, éclipses vues de tout astre ; validé contre le catalogue de la NASA ; TARS (chercher, lire) | à faire |
| C6 | **Les ombres entre astres au rendu** | la Lune dans l'ombre de la Terre (pénombre, ombre rouge cuivrée, liseré turquoise), les galiléens dans l'ombre de Jupiter, leurs ombres sur lui, Phobos, Titan… ; le sélénélion vérifié à une vraie date ; mesuré | à faire |
| C7 | **Le calculateur** | une page AAA : la frise des éclipses filtrable (astre, type, années), la fiche (schéma, carte de la bande, circonstances locales, animation), « Aller voir » (date, lieu, caméra), « Photo » ; TARS | à faire |
| C8 | **Les surimpressions : l'analemme** | le moteur (expositions hors ligne, fusion en éclaircir, une image de fond) ; l'analemme (heure, cadence, fond) ; TARS | à faire |
| C9 | **La séquence d'éclipse** | 5 avant, la totalité (la couronne), 5 après, de Soleil ou de Lune, depuis le calculateur ou le lieu | à faire |
| C10 | **Filé d'étoiles, Lune, ISS** | le filé d'étoiles sur une nuit, le trajet de la Lune (une nuit, ou ses phases à la même heure), le passage de l'ISS | à faire |
| C11 | **Doc, finitions** | `comment-jouer.html`, la fiche système, `TARS.md`, e2e, planche finale | à faire |

Chaque étape : un commit, poussé, une planche dans `docs/progress/ciel/`, FR + EN, TARS.
