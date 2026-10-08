# Plan MÉTÉO — M4 du plan Monde (8 octobre 2026)

Suite de [`PLAN-MONDE.md`](PLAN-MONDE.md), phase **M4 : la météo**. Suivi global : [`AAA-PROGRESS.md`](AAA-PROGRESS.md).

## Décisions du propriétaire (08/10/2026)

- **Météo réglable, beau temps par défaut, et la météo réelle parmi les choix** : un panneau Météo propose des préréglages (clair, nuageux, couvert, brouillard, pluie, vent fort), un tirage aléatoire plausible et **« Réelle (METAR) »**.
- **METAR en option, seulement sans clé** : vérifié le 08/10, `metar.vatsim.net` sert le METAR réel avec `access-control-allow-origin: *`, ce que le navigateur accepte. `aviationweather.gov` ne l'accepte pas (pas d'en-tête CORS) ; `api.met.no` exige une identification que le navigateur ne peut pas donner. Sans réseau : le beau temps.
- **Les autopilotes subissent la météo** : vent de travers, cisaillement, brouillard et pluie s'appliquent à eux ; le labo de vol ajoute des scénarios météo et les notes en tiennent compte.
- **Contenu de M4** : brouillard, visibilité et couches nuageuses ; piste face au vent et manche à air ; pluie et gouttes sur la verrière ; tempêtes de poussière sur Mars.
- **Une carte météo** (demandée le 08/10) : la météo vue sur le planisphère de la carte et en coupe dans le panneau (W2b).

## État de départ (inventaire du 08/10/2026)

- **Vent** (`wind.ts`) : 4 niveaux (0, 4, 9, 15 m/s à 10 m), profil en loi de puissance puis courant-jet à 11 km, turbulence de Dryden, rafales en 1 − cos ; sa direction tourne lentement avec le lieu et le jour (`windFrom`), sans lien avec les pistes.
- **Nuages de la Terre** (`trace.wgsl`) : une couche volumétrique fixe de 1 500 à 4 500 m, sa couverture lue dans la carte réelle des nuages (canal alpha du cube), ses ombres longues au terminateur, des cirrus à 9 km ; le réglage `earthClouds` les éteint ou les montre.
- **Pistes** (`game/sites.ts`) : sept pistes terrestres et Edmunds, **un seul sens d'atterrissage** chacune (`rwy`), balisage de bord, seuil, fin et PAPI au rendu.
- **Absents** : brouillard, brume réglable, pluie, METAR, manche à air, choix de la piste selon le vent, poussière sur Mars.

## Étapes

| # | Étape | Contenu | Statut |
|---|---|---|---|
| W1 | **Le modèle météo** | `weather.ts` : un état unique par lieu — vent (direction, force, rafales, cisaillement), visibilité, 0 à 3 couches (base, sommet, couverture, type), pluie, poussière ; préréglages, tirage aléatoire plausible (lieu, saison, graine) ; dans les réglages et les sauvegardes ; la physique (`wind.ts`) lit sa direction et sa force au lieu de `windFrom` près d'un site ; tests unitaires | **fait** : `weather.ts` (préréglages clair, nuageux, couvert, brouillard, pluie, orage, vent fort, poussière ; tirage par cellule de 2° et par jour ; « réelle » en attente de W7), le réglage `weather` (« carried » : gardé d'une scène à l'autre, sauvegardé avec le vol), `wind.ts` lit une `WindSpec` (force, direction fixe ou tournante, rafales, turbulence, cisaillement sur 300 m), la physique du vol et les vagues de la mer suivent la météo ; **« clair » = le vent d'avant à l'identique** ; tests `weather` |
| W2 | **Le panneau Météo** | à côté de Lieu et Temps : préréglages, aléatoire, « Réelle (METAR) » ; ce qui est en vigueur lisible (vent, visibilité, plafond) ; FR + EN ; e2e à vraies entrées | **fait** : `ui/weatherpanel.ts` — bouton Météo du HUD (à côté de Placer) et menu pause ; les 10 choix ; le lieu, vent, rafales, visibilité, plafond, pluie et la **catégorie de vol** colorée comme sur les cartes (VFR, MVFR, IFR, LIFR) ; `weatherPlace()` sur le contrôleur ; e2e `weather-panel` (vrais clics, la sauvegarde porte la météo) ; planche `w2-panneau.jpg` |
| W2b | **La carte météo** (demande du propriétaire, 08/10) | sur le planisphère de la carte (tablette, M), une couche Météo : la couverture nuageuse réelle, le vent en flèches, les zones de pluie, chaque site avec son symbole de station (barbule de vent, visibilité, plafond, catégorie VFR/MVFR/IFR/LIFR en couleur, le METAR en survol) ; dans le panneau Météo, la **coupe verticale du lieu** (brouillard, couches avec base et sommet, vent selon l'altitude) | **en partie** : la coupe verticale faite (`ui/weather-section.ts` : échelle en racine carrée pour donner sa place au sol, brume, brouillard couché, couches avec leur mot FEW/SCT/BKN/OVC et leur base, pluie sous la plus basse, poussière, barbules de vent selon l'altitude). Reste la couche Météo du planisphère |
| W3 | **Brouillard et couches au rendu** | la visibilité comme extinction près du sol (brume, brouillard couché) ; les couches nuageuses de l'état près du lieu (base, sommet, couverture) à la place de la couche fixe, la carte réelle au loin ; mesuré au banc (`trace-ab`) avant d'adopter | à faire |
| W4 | **Les pistes face au vent** | les deux sens de chaque piste ; le sens choisi face au vent (le joueur, l'autopilote de rentrée, le HUD) ; la manche à air au rendu ; vent de travers et cisaillement en finale dans la physique ; le HUD dit vent de face et de travers | à faire |
| W5 | **La pluie** | pluie qui tombe (traînées en écran, selon la vitesse), visibilité réduite, gouttes sur la verrière en vue cockpit qui ruissellent avec la vitesse ; mesuré | à faire |
| W6 | **La poussière sur Mars** | tempête : épaisseur optique de l'air de Mars relevée, ciel orangé opaque, visibilité au sol réduite, la poussière soulevée près du sol ; préréglage propre à Mars | à faire |
| W7 | **Le METAR** | pour les sites terrestres : le METAR de VATSIM (le code OACI de chaque piste), décodé (vent, rafales, visibilité, couches FEW/SCT/BKN/OVC et leur base, RA/DZ/FG/BR/TS) en un état W1 ; mis en cache, sans réseau le beau temps ; tests sur des METAR réels | à faire |
| W8 | **Autopilotes, labo, finitions** | l'atterrissage autopiloté avec vent de travers, cisaillement, brouillard ; scénarios météo au labo de vol et leurs notes ; i18n, `HUD.md`, planche finale | à faire |

Chaque étape : un commit, une planche avant/après dans `docs/progress/meteo/`, FR + EN, mesure avant d'adopter pour tout ce qui touche au traceur.
