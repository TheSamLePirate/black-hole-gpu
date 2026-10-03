# Plan — les aides au pilotage visuelles du HUD

Demande (2026-10-03) : des aides au pilotage visuelles dans le HUD — l'angle d'attaque visuel, la
position future, tout ce qui peut aider, dans chaque mode ; un HUD de qualité AAA.

Décisions de l'utilisateur :
- **Style** : la palette du jeu (cyan, ambre, vert, rouge du HUD actuel ; traits fins sur un liseré
  sombre), cohérente avec la navball, la bande, la carte.
- **Affichage** : automatique selon le contexte (dans l'air, en orbite, en approche, posé, à
  l'amarrage, près du trou) **et** un interrupteur par aide dans les réglages ; la touche ² garde ses
  densités (complet, minimal, épuré).
- **Position future** : les trois — des repères du vaisseau à +10 / +30 / +60 s (et un quart d'orbite),
  la trajectoire prédite tracée en perspective dans la vue (les deux univers), le point d'impact au sol
  (ou d'entrée dans l'air) avec son compte à rebours.
- **Vues** : toutes ; complète en cabine et en poursuite, allégée dans les vues extérieures (marqueurs
  et repères essentiels).

## État de départ (relevé du 2026-10-03)

- Dans la vue (`canvas.fl-hud`, `FlightHud.drawHud`, chaque image) : le symbole du nez, le vecteur
  vitesse air (dans l'air), les marqueurs prograde / rétrograde, allumage, manœuvre, vitesse relative à
  la cible, le port d'amarrage ; les bandes de vitesse et d'altitude. Le verrouillage de cible
  (`targethud.ts`, sur `#overlay`). Le tube de trajectoire ⇧Y, seulement du côté de Gargantua.
- Absent : horizon, échelle de tangage, cap, roulis dans la vue ; radial, normal, cible dans la vue ;
  angle d'attaque visuel ; glide et piste (les données `entry.app` existent, rien ne les montre) ; point
  d'impact ; allumage d'arrêt ; positions futures dans la vue ; réticule d'amarrage du HUD.

## Phases (chacune : commit, fiche `docs/progress/NNN_*.jpg`, vérification dans le navigateur avec de
## vrais événements)

### H1 — Le socle : la symbologie conforme
- Un module à part (`src/ui/hud/`) : projection, liseré, flèches au bord de l'écran pour ce qui en sort,
  allègement hors cabine et poursuite, les interrupteurs (Réglages › HUD).
- Près d'un astre : l'horizon conforme et l'échelle de tangage (5° / 10°, pointillés sous l'horizon),
  la bande de cap en haut (le nord de l'astre), l'échelle et l'index de roulis.
- Les marqueurs manquants dans la vue : radial ±, normal ±, la cible (sa distance) — au bord de l'écran
  quand ils en sortent.

### H2 — Le vol dans l'air
- L'angle d'attaque : un crochet autour du vecteur vitesse (la plage d'incidence de croisière,
  l'incidence de décrochage), une jauge α → α de décrochage ; la bille de dérapage (β).
- L'énergie : le chevron d'accélération le long du vecteur vitesse (accélère / décélère), la tendance
  de vitesse ; le facteur de charge et sa limite ; le directeur de vol (la commande du calculateur :
  vitesse, pente, cap) ; décrochage, survitesse, charge en alerte.

### H3 — La position future
- Les fantômes du vaisseau à +10 / +30 / +60 s (un quart d'orbite au-delà), datés.
- La trajectoire prédite en perspective dans la vue (les deux univers), graduée en temps.
- Le point d'impact au sol (ou d'entrée dans l'air) et son compte à rebours.

### H4 — L'approche et l'atterrissage
- Sur piste : la piste conforme (son contour, son axe prolongé), les écarts d'alignement et de pente,
  le repère d'arrondi, le point de toucher prédit.
- À la verticale : la croix de stationnaire (la dérive horizontale), la hauteur au-dessus du sol, la
  vitesse verticale, le repère d'allumage d'arrêt (quand allumer pour s'arrêter au sol), le point de
  toucher.

### H5 — Les opérations dans l'espace
- L'allumage : le repère de la manœuvre, son compte à rebours, le Δv restant, l'erreur de visée.
- La cible : l'approche au plus près dans la vue (où, quand, à quelle distance), la vitesse relative à
  annuler.
- L'amarrage : le réticule du HUD (écarts et dérives latéraux, couloir d'approche, distance et vitesse
  de rapprochement).

### H6 — Près de Gargantua
- L'horizon, l'orbite des photons et l'ISCO repérés dans la vue ; dτ/dt, la marée, la vitesse
  d'évasion ; le point de non-retour.

### H7 — Finitions
- Densités, légende et aide, performances, cohérence des couleurs ; README, guide en français.

## Avancement

| Phase | État | Commit · fiche |
|---|---|---|
| H1 socle | fait : horizon et échelle de tangage conformes (champ central, fondu), bande de cap (nez, route, cible), échelle de roulis, radial et normal dans la vue, flèches au bord ; allégé dehors ; interrupteurs | · 158 |
| H2 vol dans l'air | fait : incidence posée sur la symbologie (plage de finesse max., 85 % et décrochage), α chiffré, bille de dérapage, chevron d'énergie, facteur de charge, STALL/AOA, directeur de vol | · 159 |
| H3 position future | à faire | |
| H4 approche et atterrissage | à faire | |
| H5 opérations dans l'espace | à faire | |
| H6 près de Gargantua | à faire | |
| H7 finitions | à faire | |
