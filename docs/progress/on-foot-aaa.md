# À pied, niveau AAA — suivi des changements et tests à faire

Branche `codex/earth-photorealistic`. Ce fichier suit chaque lot de changements et ce qui reste à
vérifier **en conditions réelles** (les e2e ne tournent pas dans le cloud : à lancer sur les Macs).

Légende : ✅ fait et vérifié ici (unitaires, typecheck, WGSL, validation WebGPU headless) ·
🧪 à vérifier sur les Macs · ⏳ pas commencé.

## Lot 1 — Intégration du personnage (commit `205155e`)

| Changement | État |
|---|---|
| Occulteur du personnage et de l’herbe pour le vaisseau (la coque ne recouvre plus l’astronaute devant elle) | ✅ code · 🧪 visuel |
| Vaisseau vu de l’extérieur caché par le décor tracé (arbres, bâtiments, relief) | ✅ code · 🧪 visuel |
| Ombre du vaisseau au sol conservée à pied / en spectateur | ✅ code · 🧪 visuel |
| Éclairage du personnage et de l’herbe par la sonde du vaisseau (SH, clé, réflexions GGX) | ✅ code · 🧪 visuel sur chaque monde |
| Ombre du vaisseau reçue par l’astronaute, l’herbe et son ombre portée | ✅ code · 🧪 visuel |
| Ombre portée au sol physique (part de la clé), occlusion de contact, plus de coupure à 3,5 m | ✅ code · 🧪 visuel au coucher du soleil |
| Normales lissées du sol de marche | ✅ code · 🧪 visuel (lumière rasante) |
| Saut : buffer 0,15 s, coyote 0,12 s, contrôle aérien, amorti, foulée figée | ✅ unitaires · 🧪 ressenti manette/clavier |
| Collision avec la coque, sorties repoussées hors de la coque | ✅ unitaires · 🧪 avec les vrais maillages (Ranger, Lander) |
| IK des pieds sur les pentes, tabliers, toits | ✅ unitaires (squelette synthétique) · 🧪 sur l’astronaute réel en Cévennes |
| Messages en anglais traduits, touche de saut lue dans les raccourcis | ✅ |

## Lot 2 — Streaming de la Terre (commit `8bb8423`)

| Changement | État |
|---|---|
| `earthScenery.pending` vrai jusqu’au dessin de la scène voulue (téléport) | ✅ unitaires · 🧪 e2e |
| Reconstruction partielle : la scène dessinée est gardée | ✅ unitaires · 🧪 hors ligne |
| Nouvel essai avec attente croissante (décor 30 s→5 min, pages 2 s→1 min, worker KTX 15 s) | ✅ unitaires · 🧪 coupure Wi-Fi réelle |

## Lot 3 — Herbe AAA : le sol vivant (commit `54dea1c`)

| Changement | État |
|---|---|
| Herbe générée entièrement sur GPU à chaque image (réseau fixe, ~180 brins/m², 3 LOD indirects) | ✅ rendu headless · 🧪 perf sur Mac |
| 7 types de végétation selon WorldCover (prairie fleurie, cultures en rangs, roseaux, garrigue, sous-bois, sol nu, mousse), teinte satellite | ✅ unitaires + rendu · 🧪 vrais lieux |
| Exclusions : routes, bâtiments, eau, revêtements (OSM), pistes, sous la coque du vaisseau | ✅ unitaires · 🧪 visuel |
| Vent de la météo en rafales, frémissement, poussée du personnage, traces de pas qui se relèvent | ✅ rendu · 🧪 ressenti |
| Lumière : sonde, translucidité, canopée, ombres arbres/vaisseau/personnage | ✅ rendu · 🧪 sur chaque heure du jour |
| Réglages : densité (part des brins), portée 8–30 m, vent ×0–2 | ✅ |

## Lot 4 — Fusion de `codex/ground-fixes-b42a483` (commit `74b394f`)

| Changement apporté | Adaptation AAA | État |
|---|---|---|
| Scène proche dans le repère physique (décalage optique de 6,5 m supprimé) | L’herbe, les contacts et le décor tracé partagent le même repère | ✅ unitaires · 🧪 visuel (volumes roses) |
| Collisions arbres = rendu (tronc boîte, cinq couronnes), saut arrêté sous tabliers/couronnes | Combiné au buffer de saut et au coyote time | ✅ unitaires · 🧪 |
| Capsule contre les vrais triangles de la coque (BVH) | Ma boîte reste le repli avant lecture du maillage, pour les sorties et l’herbe sous la coque | ✅ unitaires · 🧪 avec Ranger/Lander |
| Profondeur du personnage lue par le vaisseau | Remplacée par l’occulteur pondéré par la couverture (l’herbe écrit sa profondeur : pas de trous dans la coque) ; `ground-details` adapté | ✅ · 🧪 e2e |
| Ombre du vaisseau sur le sol terrestre, carte d’ombre chaque image à pied | Gardé tel quel | 🧪 |
| Streaming anticipé (6 s, 650 m) | Gardé | 🧪 vol à 200 m/s |
| Carte locale (M), planisphères des mondes, volumes roses, sortie sur Mann/Miller/Edmunds | Gardé | 🧪 |

## Tests à faire sur les Macs

### Automatiques

```bash
bun run e2e character-aaa            # ici, headless (~4–8 min)
bun run e2e --remote character-aaa   # kerr-mini, plein écran
bun run e2e grass-aaa                # herbe : densité, coût GPU, types, traces de pas (~6–12 min)
bun run e2e character                # l’ancien fichier : doit toujours passer
bun run e2e --each ground-details ground-planets gargantua-ground scenery-hitboxes place   # tests de la fusion
bun run e2e earth-scenery earth-surface   # non-régression du streaming
bun run e2e --remote --detach landscapes  # paysages d’exception vs leurs photos (~1 h pour les 14)
LANDSCAPES="Matterhorn|Fuji" bun run e2e landscapes   # une partie seulement
```

À relire après la campagne : `remote-results/character-aaa-*.png` et leurs `*-readiness.json`,
`remote-results/character-aaa-light.json` (profondeur d’ombre par monde), `character-aaa-occlusion.json`.
Si un seuil de lumière ou de différence de pixels échoue, ces JSON donnent les valeurs pour le régler.
Herbe : `remote-results/grass-aaa-*.png`, `grass-aaa-cost.json` (coût GPU des passes, image avec/sans),
`grass-aaa-kinds.json` (types trouvés), `grass-aaa-footprints.json`. Les budgets (compute < 2,5 ms, dessin
< 4 ms à 1280×720) sont des cibles : si le mini les dépasse, noter les valeurs avant de régler la densité.

Paysages : ouvrir `remote-results/landscapes/index.html` (chaque capture à côté de sa photo). Pour chacun,
noter ce qui diffère — cadrage (cap/inclinaison), lumière (heure), couleurs du sol, végétation, eau, neige —
dans `docs/progress/landscapes.md` : c’est la liste de travail des chantiers A–C du plan. Une fois validées,
installer les vignettes de galerie : `bun run gallery --scenes "Earth: the Matterhorn from the Riffelsee|…" --update`.

### Manuels (le ressenti, que les tests ne voient pas)

1. **Lune, Ranger posé** : Maj+K, marcher droit sur la coque (arrêt net, jamais dedans), tourner la caméra
   autour : l’astronaute reste devant la coque, la caméra ne rentre pas dans le vaisseau.
2. **Même scène, Lander** : sortir ; vérifier que la sortie est hors de la coque et que l’embarquement
   (Maj+K à moins de 3 m) fonctionne.
3. **Cévennes, pente** : marcher en travers d’une pente : les deux pieds au sol, bassin abaissé, pas de pied
   dans le sol.
4. **Saut** : sauter sur la Lune, réappuyer sur Espace juste avant de toucher le sol (le saut repart),
   marcher au bord d’un talus et sauter juste après l’avoir quitté.
5. **Éclairage** : midi, coucher de soleil, nuit, ciel couvert (`weather` = overcast) : l’astronaute ne doit
   jamais paraître collé sur l’image ; ombre noire sur la Lune, douce sur Terre, absente la nuit.
6. **Forêt** : passer devant le vaisseau derrière des arbres : les arbres le cachent.
7. **Herbe** : marcher dans une prairie des Cévennes à midi puis au coucher du soleil (contre-jour : brins
   lumineux), vent `windy` puis calme, courir et regarder les traces derrière soi, se poser en Ranger dans un
   champ (pas d’herbe dans la coque), traverser une route (bord net mais effiloché), un champ de blé autour du
   Bourget, une zone humide. Régler densité 0,25 et portée 8 m : le framerate doit remonter nettement.
8. **Réseau** : couper le Wi-Fi 2 s en survolant le Bourget à basse altitude puis le rétablir : les pages
   satellite manquantes reviennent seules (≤ 1 min).
