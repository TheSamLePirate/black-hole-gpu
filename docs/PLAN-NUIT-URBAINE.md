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

**NU1 + NU2 — la ville vue d'en haut : le fond de carte assombri et ses lampadaires** (décision de Sam, 6 novembre : « on part
sur du AAA, pas sur du damier […] l'idée de prendre les routes et de dessiner des pointillés, c'est pas bon. Utilise les
lampadaires et le fond de carte (assombri) »). Les rues d'OpenStreetMap (tuiles vectorielles OpenFreeMap, couche
`transportation` ; z 12 et z 13 demandées, la z 14 tirée du quart de sa z 13 — 219 ko sur Paris contre 644 ko) cuites dans le
worker de décodage (`src/system/night-roads.ts`) : la chaussée en lueur faible (le fond de carte assombri, chaque classe sa
largeur) et **les lampadaires mêmes du décor proche** (`streetlamps.ts lampsAlong` : espacement par classe, quinconce sur les
grandes rues), chacun une lumière fixe. La lumière VIIRS redistribuée sur ce motif **à moyenne conservée** sur son empreinte
(~600 m, table de sommes), un plancher de 3 % entre les rues. Couches de lumières des niveaux z 12–14 dans la texture filtrée
1024² (`IMG_ROADS0`, +3 couches, ≈ 17 Mo avec leurs mips ; une fenêtre 2048² à demi-résolution), lues par `tileLightsAt` du plus
fin au plus grossier — aucune liaison nouvelle dans les noyaux. Requêtes seulement au crépuscule et la nuit autour de la caméra
(Soleil sous 6°), les tuiles déjà là recuites quand la nuit tombe. Teinte : sodium orangé surtout, LED blanc chaud par un bruit
doux de ~1,5 km, les plus brillantes plus blanches. **Abandonné** : les pointillés procéduraux dans le shader et la teinte par
carrés de 600 m (un damier). Près de la caméra, le décor garde ses vrais lampadaires (têtes et flaques, Q8 L10).

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

NU4 (fait : fenêtres à distance, 6d11d6b5) → NU1+NU2 (en cours) → NU3 → NU5 → NU6 → NU8 → NU7. Chaque lot : e2e `nyc-sunset` (NYC et Paris, de près et
d'avion), planche avant/après face aux photographies, coût GPU mesuré sur kerr-mini, journal `progress-to-destination.md`,
`docs/GRAPHICS-PIPELINE.md` si une texture ou une passe change.
