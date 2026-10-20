# E9b — Le coût GPU de chaque réglage, la langue sans rechargement (2026-10-20)

[Plan](../../PLAN-TITRE-AAA.md) · [E9](E9.md) · [planche](E9b.jpg) · la mesure brute :
[E9b-settings-cost.json](E9b-settings-cost.json)

Les deux points laissés ouverts par E9.

## Le coût GPU de chaque réglage

**Ce qu'on voit.** Dans les Réglages, l'explication d'un réglage graphique mesuré dit ce qu'il coûte :

- de ●○○○○ à ●●●●● ;
- puis la ligne de la mesure, par exemple « 0,75 × → 1,25 × : +112,8 ms par image (± 1,4), +225 %, vue
  « Reine » » ;
- puis la machine et la date : « Mesuré sur kerr-mini (Apple M1, 8 cœurs GPU), le 2026-10-20, à l'image de
  référence du Kerr Bench ».

Un réglage non mesuré, ou mesuré de façon douteuse, n'affiche aucun coût.

**La mesure** (`scripts/settings-cost.ts`, sur kerr-mini, Chrome sans fenêtre, 41 min) :

- quatre vues figées :
  - les **Cévennes** (le sol photographique, le décor, l'herbe) ;
  - **Reine** (le fjord, la mer, les nuages) ;
  - **l'orbite basse** au-dessus de l'Amazonie (les nuages vus d'en haut) ;
  - **le passage du film près de Gargantua** (les effets d'image) ;
- chaque réglage entre sa valeur légère et sa valeur lourde, appliquées une fois d'abord (noyau compilé, données
  chargées), puis alternées A B B A sur 4 manches ;
- le temps GPU de l'image entière (toutes les passes) et celui du tracé, à l'image fixe du Kerr Bench (~1,44 Mpx,
  sous-échantillonnage 4, horloge tenue).

**Ce qui est publié** (`src/ui/settings/costs.ts`, écrit par le script, pas à la main). Pour chaque réglage, on
garde **la pire vue où l'écart dépasse le bruit**, soit deux erreurs-types sur les répétitions. Là où il ne le
dépasse nulle part, on garde la vue la plus précise, et le coût est dit négligeable.

| réglage | vue | léger → lourd | image | coût |
|---|---|---|---|---|
| échelle de rendu | Reine | 0,75 → 1,25 | 50,2 → 163,1 ms | ●●●●● +225 % |
| reprojection temporelle | Gargantua | non → oui | 84,2 → 117,5 ms (± 7,6) | ●●● +39 % |
| décor (forêts, bâtiments) | Reine | coupé → dense | 90,2 → 113,6 ms | ●●● +26 % |
| ombres du décor | Cévennes | non → oui | 32,1 → 35,1 ms | ● +9 % |
| halo (bloom) | Cévennes | 0 → 0,5 | 33,2 → 35,3 ms | ● +6 % |
| portée du détail | Cévennes | normale → très loin | 35,3 → 37,2 ms | ● +5 % |
| nuages, nuages volumétriques, réfraction, mer (FFT), sol photographique, densité de l'herbe, reflets d'objectif, netteté, flou de mouvement | — | — | — | négligeable (< 3 %) |

**Écartés : trois résultats inexpliqués.**

- Aux Cévennes, couper le **relief**, le **décor** ou l'**herbe** donnait une image 2 à 3 fois plus lourde
  (123, 86 et 81 ms contre 35). Le tracé de rayons, lui, ne changeait pas (24,6 ms des deux côtés pour l'herbe).
- Un second banc sur le même mini, en lisant le temps de chaque passe, **ne l'a pas reproduit** : coupés ou non,
  l'image coûte pareil.
- Le relief et l'herbe ne sont donc pas publiés. Le décor l'est, d'après Reine, où son coût est net et passe
  bien par le tracé (27,8 → 34,9 ms).
- La cause de l'écart du premier banc reste à trouver. Le script écarte désormais toute valeur lourde qui
  ressortirait moins chère au-delà du bruit, et le note en tête de `costs.ts`.

**Pas d'image d'aperçu** dans l'explication : chacune ajouterait des centaines de Ko pour un intérêt faible à
côté du chiffre.

## La langue sans rechargement

Changer de langue ne recharge plus la page, que ce soit par la ligne Langue des Réglages (onglet Interface),
celle de Plus…, ou les boutons FR / EN en pied du titre.

- `setLang` prévient ceux qui écoutent (`onLangChange`) et dit la langue à la page (`<html lang>`).
- **Se redessinent aussitôt** :
  - le titre, sur l'écran ouvert ;
  - la pause et son contexte ;
  - les Réglages ;
  - le Labo, reconstruit sur place en gardant sa recherche (ses infobulles déléguées, posées une seule fois).
- **Suivent au prochain chargement** le HUD et les panneaux du jeu déjà construits : barre du haut, instruments,
  aide des touches. Leurs textes sont posés à la construction, et les reconstruire en direct demanderait de
  toucher chacun d'eux.
  - Une fois le jeu là, un message le dit : « Les menus sont maintenant dans cette langue ; le HUD et les
    panneaux déjà construits suivront au prochain chargement ». L'explication de la ligne Langue le dit aussi.
  - Avant que le jeu ne soit construit (pendant l'intro et le chargement), rien n'est encore figé : tout le jeu
    arrive dans la langue choisie.

## Tests

- **Unitaires** : `tests/settings-costs.test.ts` (2) couvre :
  - l'échelle des points (rien sous 3 %, puis un dixième, un quart, une moitié, l'image entière) ;
  - chaque coût publié : un réglage de l'écran joueur, des valeurs valides, des temps réels, une mesure datée et
    sa machine nommée.
- **e2e `settings`** (7/7), deux tests de plus :
  - le coût de l'échelle de rendu affiché (●●●●●, +112,8 ms, ± 1,4, vue « Reine ») ;
  - la langue passée en français puis rendue à l'anglais par la ligne Langue, **sans changement de
    `performance.timeOrigin`** : le titre devient « Réglages », le Labo « Labo », puis l'inverse.
- `title-more`, `title`, `a11y` et `smoke` (17/17) passent sur ce Mac.
- `bun test` sur le mini : 1 384 réussis, 0 échec.
