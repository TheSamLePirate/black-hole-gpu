# P1c — Première exécution GPU du pilote raster, erreur mesurée, décision de poursuite

Date : **20 octobre 2026**, Chrome headless local, GPU Apple (Metal 3), 960 × 540, bloc 1, une seule machine.
Test : `tests/e2e/terrain-raster.e2e.test.ts` (Kennedy SLF, piste oblique de cap 150°, 16 h UTC le 21 juin 2021).
Données brutes : [terrain-raster.json](data/terrain-raster.json), [terrain-cache-ab.json](data/terrain-cache-ab.json).

## 1. Ce que l'exécution a révélé

**Le pilote n'était jamais éligible dans les scènes Terre du jeu.** La condition `(featureKey & 512) === 0` exigeait un noyau
sans la métrique du trou de ver. Or toutes les scènes Terre (`EARTH_VIEW`) gardent le trou de ver actif à 9 M de la
caméra et `earthOnly` exige que sa zone d'influence (100 ρ) mesure moins d'un pixel : jamais vrai (rapport 0,54 rad
contre 0,0019 rad par pixel). Les passes P1a/P1b, validées seulement à la compilation, ne s'exécutaient donc pas.

Correction (`src/renderer.ts`) : l'inspecteur raster ne dépend plus de cette condition (il dessine sa propre
portion et lit lui-même le cache) ; **l'usage du cache par le tracer la conserve** (noyau avec Kerr/trou de ver
inchangé). Les noyaux optiques/relativistes ne sont pas modifiés.

## 2. Le pilote s'exécute

Sur le GPU : compilation sans erreur, dessin, trois vues (profondeur, normales, écart), maillage conforme
(`conforming: true`, 37 432 triangles au niveau 2, 220 sommets coupés), libération des cibles à la désactivation,
redimensionnement. Le test échoue si l'une de ces conditions ne tient plus.

## 3. Écart entre le raster et la profondeur de la scène tracée

Mesuré sur les **pixels de la capture `difference`** (échelle de couleurs inversée en mètres ; 460 800 pixels, hors
barre d'outils). **Ce n'est pas une erreur verticale bornée** : la référence est la profondeur de la scène (rayons
temps réel, décor, jitter), voir P1b.

| Vue | Niveau | p50 | p90 | p99 | max |
|---|---|---|---|---|---|
| Nadir 900 m | 1 et 2 | 0,21 m | 0,59 m | 1,03 m | 2,2 m |
| Oblique 900 m | 1 et 2 | 0,44 m | 1,55 m | 3,1 m | 6,9 / 7,3 m |
| Oblique 3 km | 2 (cellule 153 m) | 3,1 m | 14,3 m | 37 m | 100 m (saturé) |
| Oblique 3 km | 1 (cellule 38 m) | 1,0 m | 2,7 m | 4,05 m | 11 m |

La grille de niveau 1 reste à moins de 4 m (p99) à 3 km : l'erreur suit la taille de cellule, comme attendu d'un
cache bilinéaire. Un seul niveau étant dessiné, la sélection par erreur projetée reste à faire. Au proche, à
900 m, le raster est déjà à ~1 m du tracé ; rien ne montre à l'image un défaut sur la piste oblique elle-même
(captures dans `remote-results/`, non versionnées).

## 4. Coût

Chaque ligne est un GPU d'une seule machine, 50 images profilées par mesure, bruit de l'ordre de ±5 ms.

- Passe `terrain raster visibility` : 0,9 à 7 ms (médiane ~3 ms) pour 37 000 triangles à 960 × 540. Les temps de
  l'inspecteur (`terrain raster inspector`) suivent celui du tracé (≈ 40 ms) : les timestamps par passe de l'Apple GPU
  se recouvrent, **ils ne donnent pas de coût fiable par passe**.
- Le tracé primaire (`trace`) vaut 30 à 55 ms selon la vue (30 ms à 10 km, 40–53 ms à basse altitude). Le raster est
  donc petit devant le tracé, mais il s'ajoute tant que le tracé n'en profite pas.
- **Cache de hauteurs utilisé par le tracé** (A/B alterné, trois tours, noyau Kerr avec/sans `HAS_TERRAIN_CACHE`,
  médianes de `trace`, ms) : nadir 900 m 46,9–43,0 contre 39,0–41,6 ; oblique 900 m 46,9–46,4 contre 43,6–40,4 ; oblique
  3 km 41,3–43,1 contre 35,8–40,7 ; oblique 10 km 29,7–30,3 contre 29,1–29,4. **Aucun gain, légère perte.**
  Le cache ne remplace que `earthHeightExactG` (le raffinement du croisement) ; les pas de la marche utilisent déjà
  `earthHeightStep`, une texture filtrée par le matériel. Le coût du terrain tracé ne vient donc pas de l'évaluation de
  la hauteur à l'échelle de précision du cache.

## 5. Décision de poursuite (condition de P1)

Le plan demande que « le coût total et la netteté justifient le raster ». Ce n'est **pas établi** :

- le gain structurel espéré (économie d'évaluation) est **réfuté** pour le cache dans la marche existante ;
- la netteté n'est pas encore comparée ; le raster ne remplace aucune intersection primaire ;
- le seul gain plausible est la **visibilité** : fournir à la marche des rayons la distance de la surface et supprimer
  la marche primaire de terrain. Cela exige de modifier le tracé de la scène (noyau d'environ 5 000 lignes), de
  raccorder profondeur, mouvement, décor, mer et nuages, et de décider du comportement hors portion (19,6 km au niveau 2) ;
  l'erreur ci-dessus (jusqu'à 14 m au p90 à 3 km au niveau 2) interdit de substituer la distance raster sans niveaux plus
  fins près de la caméra.

Conséquences : P2–P6 (profondeur partagée, éclairage commun, forêts, nuages, mer) **ne sont pas commencés** : ils
supposent un monde raster qui n'existe pas encore. Le prochain jalon mesurable est un **tracé qui consomme la
distance raster** sur un petit domaine sûr (relief naturel, hors piste, hors mer, hors nuages), avec mesure du temps
de `trace` avant/après à image comparable. En attendant, tout reste désactivé par défaut.

## 6. Addendum — où va le travail du tracé (mesures d'orientation, même jour)

Trois essais faits après la décision du §5, pour savoir si une voie raster-visibilité a un plafond de gain.

**a) Le noyau sans la métrique du trou de ver n'est pas plus rapide.** Idée : le noyau Terre seule (`HAS_KERR` retiré)
pourrait être choisi quand la bouche est hors du champ (cône des rayons intégrés `B = max(4ρ, √(0,26 M/pixel))` vu de la
caméra, soit ~3° ici). Implémenté et vérifié (il se déclenchait aux vues obliques, nadir exclu car la bouche y est dans le
champ). Résultat : `trace` 46–47 ms contre 47–48 (oblique 3 km), 32–34 contre 34–35 (10 km), sans gain à 900 m
(67–77 ms, bruit de compilation). **Abandonné et retiré du code.**

**b) Rétractation : « terrain coupé » et « trou de ver coupé » n'étaient pas des ablations valides.** `earthTerrain=false`
garde la marche avec la carte globale ; `wormhole=false` change de scène (le ciel de Gargantua remplace la Terre : 18 ms
mesurés sur une image noire d'étoiles). Les 18–20 ms de cet essai ne disent rien du coût de la Terre. Ils ne sont dans
aucun chiffre de ce rapport.

**c) Répartition du travail par rayon (vue de coût du jeu, `renderer.costView`).** Pour Kennedy, 960 × 540, nuages 0,3, moyenne
par pixel de chaque compteur (palette de la vue inversée sur une capture sur 1 pixel sur 4 : ±10 %), × poids relatifs du code
(`costHeat`) :

| Vue | Marche du sol | Hauteurs lues | Ombres du relief | Air | Octaves de bruit | Total pondéré (vue « tout ») |
|---|---|---|---|---|---|---|
| Oblique 900 m | 16,5 pas | 77 | 15,7 | 21,7 | 138 | 231 |
| Oblique 3 km | 16,2 | 71 | 14,5 | – | 106 | 222 |
| Oblique 10 km | 15,6 | 33 | 6,1 | – | 37 | 136 |

(Compteur direct, vue 14, mêmes scènes sans nuages : 22 à 24 pas de marche, 49 à 52 lectures de hauteur, 22 pas d'ombre
par pixel à 900 m–3 km.) En pondéré, **les hauteurs lues et les octaves de bruit du relief représentent de l'ordre du tiers
au moitié du travail d'un rayon** (≈ 50 % à 900 m, ≈ 46 % à 3 km, ≈ 32 % à 10 km), la marche et les ombres du sol 7 % chacune
environ. Les poids sont ceux, approximatifs, du code ; ce n'est pas un temps GPU.

**Conséquence pour la décision.** Le plafond d'une visibilité raster qui supprimerait la marche primaire de relief (marche +
hauteurs + octaves) est donc de l'ordre de **30 à 50 % du travail de rayon** sur le terrain, pas davantage : les ombres du relief,
l'air, les nuages, la mer et le décor restent. Ce plafond n'est atteint que si la hauteur raster est assez précise : l'écart du
§3 (14 m au p90 à 3 km avec la cellule de 153 m) impose des niveaux plus fins près de la caméra, donc une fusion multi-niveaux, et
le détail procédural sous la maille du cache (octaves de bruit) doit être rendu par un autre moyen (matériau/normale) — ce
qui est justement le chantier P3. La poursuite reste donc **conditionnelle** ; un essai honnête est un tracé qui prend la
distance raster pour les rayons du sol d'un petit domaine, avec mesure avant/après.
