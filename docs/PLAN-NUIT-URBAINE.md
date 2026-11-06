# Plan — la ville de nuit (vols de nuit, vues de ville)

**Demande de Sam (6 novembre 2026)** : « règle le problème des vols de nuit : luminosité du sol, vitres illuminées, lumière des
routes, voitures, lampadaires de loin (de haut surtout, c'est les formes caractéristiques des villes de nuit) ».

**Références** : `docs/progress/usa/refs/` (New York, deux photographies Wikimedia, EXIF lus) ; e2e `nyc-sunset`
(`NYC_NIGHT`, `NYC_REFS`, `NYC_CITY=paris`, `NYC_SET`, `NYC_SKIP`). Destination : ANALYSE-STRATEGIE §19 (expérience complète :
la nuit fait partie du produit), §7 (le monde possède ses données, le renderer les lit), §8 (budget : rien de nouveau par
pixel sans mesure).

## 0. État constaté (6 novembre 2026, ce Mac et kerr-mini, raster)

| Défaut | Où | Cause établie ou probable |
|---|---|---|
| Ville vue d'en haut : une tache floue orange, sans rues | toutes villes | la lumière des tuiles vient de VIIRS z 8 (~600 m le pixel) agrandi ; les niveaux fins ne portent pas de lumière (`tileLightsAt` ne lit que z ≤ 8) |
| Sol clair et uniforme vu rasant, surtout pendant le chargement | NYC, Paris | la moyenne VIIRS (vue au nadir) étalée telle quelle à l'horizontale — corrigé en partie : `cityCanyon` (rues cachées par ce qui les borde, selon l'angle et la densité) |
| Pelouses vert fluo, allées en néon | Paris | lumière des rues × albédo des photos par canal (×4) — corrigé : luminance, un tiers de la teinte, ×2 au plus |
| Tours éclairées jusqu'au sommet | NYC | flaques des lampadaires appliquées à toute la hauteur des murs — corrigé : décroissance avec la hauteur (`RB_ABOVE`) |
| Tours grises/blanches, sans fenêtres au loin | NYC | en diagnostic (agent) : quelle lumière les éclaire, pourquoi la lueur des fenêtres ne se voit pas |
| Ciel étoilé en pleine ville, sans halo | NYC, Paris | aucun halo de pollution lumineuse dans le ciel |
| Tour Eiffel éteinte | Paris | aucun éclairage de monument |

## 1. Lots

**NU1 — la lumière des routes vue d'en haut (le dessin des villes la nuit).** Les routes d'OpenStreetMap (tuiles vectorielles
OpenFreeMap, couche `transportation`, du même z que la tuile de relief, z 11–14) cuites dans le worker de décodage en un masque
de 256² (largeur et éclat par classe : autoroute, nationale, primaire… de service ; voies ferrées et chemins exclus). La lumière
VIIRS de la tuile redistribuée sur ce masque **à moyenne conservée** sur l'empreinte de VIIRS (~600 m : table de sommes) — un
plancher de 15 % hors des rues (fenêtres, cours, parkings). Une texture de lumières par niveau fin (r8, la mise en page des
fenêtres de relief), lue par `tileLightsAt` du plus fin au plus grossier. Seulement là où la tuile a des lumières (pas de requête
sur la campagne ni la mer). Mesures : requêtes et octets par fenêtre, coût GPU de la lecture, rendu de Paris/NYC/Los Angeles
d'un avion à 3 000 et 10 000 m.

**NU2 — les lampadaires de loin.** Sur les pixels de route, une modulation en points (un lampadaire tous les ~30 m, une maille
jittée en mètres locaux) à moyenne 1, active quand l'empreinte du pixel descend sous ~15 m, fondue au trait au-delà — les
chapelets de points des photos d'avion. Teinte par quartier (sodium orangé / LED blanche), comme `streetLampTint` près.

**NU3 — les voitures.** Sur autoroutes et nationales (une classe portée par le masque), des points mobiles blancs dans un sens,
rouges dans l'autre, densité et vitesse plausibles, animés dans le shader (aucun objet CPU) ; près, les voitures du trafic
existant (Q8 D1) restent.

**NU4 — les façades et les fenêtres** (après le diagnostic de l'agent) : les fenêtres allumées visibles à distance (points
résolus tant que l'empreinte < une travée, moyenne au-delà), les murs à leur vraie luminance de nuit.

**NU5 — l'exposition de nuit.** Une exposition de photographe au-dessus d'une ville (EV fixée par l'EXIF des références pour les
comparaisons ; l'œil du jeu plafonné en ville par le halo) — les sources ressortent, les murs restent sombres.

**NU6 — le halo du ciel.** La luminance artificielle du ciel tirée de la carte de nuit autour de la caméra (zénith, dômes vers les
villes à l'horizon, couleur), calée sur l'atlas de Falchi et al. 2016 ; les étoiles noyées par elle.

**NU7 — les monuments éclairés** (tour Eiffel d'abord) : leur éclairage nocturne réel, une liste courte.

**NU8 — le chargement** : la ville de nuit ne doit pas changer de luminosité quand ses rues arrivent (le lavis de remplacement à
la même moyenne que le rendu final).

## 2. Ordre et preuves

NU4/NU5 (le diagnostic en cours) → NU1 → NU2 → NU3 → NU6 → NU8 → NU7. Chaque lot : e2e `nyc-sunset` (NYC et Paris, de près et
d'avion), planche avant/après face aux photographies, coût GPU mesuré sur kerr-mini, journal `progress-to-destination.md`,
`docs/GRAPHICS-PIPELINE.md` si une texture ou une passe change.
