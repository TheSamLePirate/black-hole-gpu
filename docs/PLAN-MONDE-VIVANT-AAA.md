# Plan « Monde vivant AAA » — arbres, forêts, eau, vues en vol, paysages d’exception

Branche de départ : `codex/earth-photorealistic` (personnage AAA, herbe GPU, fusion `ground-fixes`).
Suivi d’exécution : [progress/on-foot-aaa.md](progress/on-foot-aaa.md) (un lot par chantier livré).

## Décisions prises (12 octobre 2026)

| Sujet | Décision |
|---|---|
| Arbres | **Tout tracé, amélioré** : rester dans le ray-tracer (ombres, reflets, brouillard cohérents), pas de maillages rasterisés. |
| Cibles 60 fps | **iPad** (doit continuer à passer), **Mac M1** (référence), **Windows avec GPU correct** (qualité haute). |
| Licence | **Non commercial** : les sources CC BY-NC-SA (EOX s2cloudless 2018+) sont permises, avec attribution affichée. |
| Données | **Sources publiques en direct**, lues par le navigateur et mises en cache par le service worker ; pas de stockage de jeux de données chez nous. Une source sans CORS passe par un relais nginx du serveur (cache seulement). |
| Priorité | **Arbres et forêts d’abord**, puis paysages d’exception (cible de validation continue), eau, vues en vol, densité au sol. |

Sources vérifiées le 12 octobre 2026 (en-têtes réels) :

| Source | Accès navigateur | Licence | Usage |
|---|---|---|---|
| EOX Sentinel-2 cloudless 2021 (WMTS, JPEG 256²) | ✅ CORS | CC BY-NC-SA 4.0 | imagerie mondiale 10 m |
| Meta/WRI hauteur de canopée 1 m (COG sur S3, lectures partielles) | ⚠️ pas de CORS → relais nginx | CC BY 4.0 | hauteur et couverture des forêts |
| OpenFreeMap (OSM, déjà utilisé) | ✅ | ODbL | bâtiments (`render_height`, étages), réseaux, eau |
| Tuiles Overture Maps | ❌ bucket public supprimé | — | non retenu (GeoParquet hors navigateur) |
| ESA WorldCover, terrain Terrarium, Copernicus | ✅ (déjà utilisés) | CC BY | classes, relief |

## Principes d’ingénierie (valables pour chaque chantier)

1. **Une source de vérité par donnée** : les tables (espèces, matériaux, budgets) vivent en TypeScript, testées,
   et sont téléversées au GPU (modèle : `grass-layout.ts` → uniform). Jamais de constantes dupliquées WGSL/TS.
2. **Modules purs testés** : la géométrie, l’échantillonnage, les budgets et les formats sont des fonctions pures
   avec tests unitaires (`bun test`). Le GPU ne contient que l’évaluation par pixel/instance.
3. **Budgets explicites** par palier (iPad / M1 / Windows) : ms GPU par passe, octets résidents, requêtes réseau.
   Chaque budget est une constante nommée, vérifiée par un test de budget et mesurée par l’e2e (horodatages GPU).
4. **Zéro allocation par image** dans les chemins chauds ; aucune lecture GPU→CPU synchrone ; toutes les
   lectures (stats, tests) asynchrones et bornées.
5. **Validation GPU sans écran** : le banc headless WebGPU utilisé pour le personnage et l’herbe devient un script
   du dépôt (`bun run check:gpu`) : création de tous les pipelines et bind groups, rendus de scènes synthétiques
   comparés à des références (SSIM), exécutable en CI sur SwiftShader.
6. **Dégradation propre** : chaque source réseau a son repli (cache, niveau inférieur, procédural), un statut
   `pending/ready/degraded` honnête (les captures n’attendent jamais un faux « prêt »), et des nouveaux essais à
   attente croissante.
7. **TARS et `__bh`** atteignent chaque fonction (réglages, états, événements), documentés dans `BH-API.md`.
8. **Attribution** : chaque source affichée dans le crédit à l’écran quand elle est visible.

---

## Chantier A — Arbres et forêts tracés (priorité 1)

État actuel : 16 000 à 32 000 arbres stockés un par un (112 o chacun) dans un BVH de 16 Mio, sur 2 à 3,5 km,
une seule forme (tronc boîte + 5 ellipsoïdes), hauteurs tirées au hasard (12–27 m), couleur satellite.

### A1. Placement procédural sur GPU, sans stockage par arbre
- Remplacer la liste d’arbres par une **grille procédurale** : chaque cellule de 4 m tire ses arbres d’un hash fixe
  dans le monde, filtrés par une carte de densité (couverture forestière) et de hauteur (canopée).
- Le rayon traverse la grille en **DDA** (Amanatides–Woo) et ne teste que les arbres des cellules traversées ;
  plus de BVH d’arbres, plus de limite de nombre. Le BVH reste pour les bâtiments et réseaux.
- Cartes par zone de décor (comme WorldCover aujourd’hui) : densité 0–1, hauteur de canopée, type de feuillage,
  téléversées en textures (quelques Mio).
- Budget : densité réelle (jusqu’à ~600 arbres/ha en forêt dense) sur tout le rayon de décor ; coût borné par le
  nombre de cellules traversées (rayon proche : ~40 cellules max).

### A2. Données de forêt réelles
- **Hauteur de canopée Meta 1 m** (relais nginx + cache) rééchantillonnée à 4 m par le worker de décor → hauteur
  de chaque arbre, trouées, lisières réelles.
- **Type de feuillage** : feuillus / conifères / mixtes depuis la latitude, l’altitude, le climat (Köppen
  simplifié, table testée) et la canopée (hauteur/rugosité) ; palmiers sous les tropiques littoraux.
- **Saisons** : couleur par date et latitude (vert, automne, hiver sans feuilles pour les feuillus, neige sur les
  conifères en altitude l’hiver).

### A3. Formes par espèce (analytiques, tracées)
- Familles : feuillu arrondi (lobes d’ellipsoïdes), conifère (cônes empilés : épicéa, sapin), pin parasol
  (dôme aplati sur tronc nu), peuplier/cyprès (fuseau), bouleau (fin, clair), palmier (stipe + couronne de
  palmes), olivier/garrigue (bas, irrégulier).
- Chaque famille : une fonction d’intersection exacte (cônes, capsules, ellipsoïdes) + paramètres tirés du hash.

### A4. Niveaux de détail tracés
| Distance | Rendu |
|---|---|
| 0–150 m | Couronne **volumique** : marche dans l’enveloppe avec un bruit 3D de feuillage (trouées, ciel au travers), normales de feuilles, translucidité, tronc et branches maîtresses. |
| 150 m–1,5 km | Enveloppe pleine, normale perturbée, auto-ombrage par profondeur dans la couronne. |
| 1,5–30 km | **Couche de canopée** : la forêt devient un relief ajouté au terrain (hauteur de canopée × couverture), rugueux, auto-ombré — la forêt vue d’avion, sans arbres individuels. |
- Transitions par fondu stochastique (pas de cassure), dépendant de la taille du pixel.

### A5. Lumière et vie
- Translucidité des feuilles, AO par profondeur de couronne, spéculaire cireux selon l’espèce.
- Vent : balancement des couronnes (décalage du centre selon le vent de la météo, phase par arbre).
- Ombres douces des arbres sur le sol, l’herbe, le personnage (existant), plus ombre de canopée lointaine.

### A6. Validation
- Unitaires : placement déterministe, densité ↔ carte, budget de cellules, tables d’espèces.
- E2E : forêts des Landes (pins), Vosges (conifères/feuillus), Amazonie (tropicale), parc urbain ; coûts par
  palier ; captures.

---

## Chantier E — Paysages d’exception (cible de validation, en continu)

**Méthode : chaque paysage recrée une vraie photographie** (Wikimedia Commons, licences libres) — la caméra là
où le photographe se tenait (position de la photo), tournée comme lui, à l’instant du déclenchement (EXIF,
fuseau du lieu), à travers le même objectif (focale équivalente 35 mm → champ vertical). La photo est la
référence : `tests/e2e/landscapes.e2e.test.ts` capture chaque scène au même cadre et produit une page où
capture et photo sont côte à côte. Données : `src/system/landscapes.ts` (une table typée, testée par
`tests/landscapes.test.ts`) ; la galerie les range sous « Paysages ».

Direction de vue, par ordre de fiabilité (`headingFrom`) :
1. **landmarks** — les sommets annotés sur la page de la photo à leurs pixels, résolus contre le relief réel
   (Terrarium z13) : cap et inclinaison mesurés (Grand Canyon : trois temples concordent à 1°) ;
2. **exif** — la boussole de l’appareil (vérifiée contre le relèvement du sujet : Cervin 265° vs 264,5°) ;
3. **subject** — le relèvement du sujet, l’inclinaison choisie d’après son angle d’élévation.
Ce que la page ne donne pas (heure, objectif d’un panorama, année hors éphémérides) est marqué `estimated`.

| Paysage | Photo (auteur) | Cap | Moment |
|---|---|---|---|
| Grand Canyon, Hopi Point | Tuxyso — Featured | landmarks 349,7° / −5,2° | 8 sept. 2013 17:55 MST |
| Cervin depuis le Riffelsee | Dirk Beyer — Featured | exif 265° | 11 juin 2005 09:50 CEST |
| Mont Blanc depuis le lac Blanc | Guilhem Vellut | subject | 8 sept. 2021 13:26 CEST |
| Geirangerfjord, Flydalsjuvet | DXR — Quality | subject | 4 juin 2015 (heure estimée) |
| Reine depuis le Reinebringen | Lukas Beck | subject | 21 juil. 2025 16:15 CEST |
| Kirkjufell et sa cascade | Jakub Hałun — Featured | subject | 14 juil. 2024 16:31 UTC |
| Lauterbrunnen, Staubbach | JoachimKohler-HB — Quality | subject | 21 sept. 2019 12:46 CEST |
| Cuernos del Paine | Alfredo Olivares Bueno | subject | 12 avr. 2025 15:59 (UTC−3) |
| Fitz Roy | Fredlyfish4 | subject | 14 déc. 2015 13:12 (UTC−3) |
| Fuji depuis le lac Kawaguchi | DimiTalen | exif 185° | 27 mars 2016 12:16 JST |
| Moraine Lake | WhyDon'tWeZJCDJ | exif 224,5° | 13 juin 2018 19:19 MDT |
| Sossusvlei, Deadvlei | Diego Delso — Featured | subject | 6 août 2018 09:49 |
| Monument Valley, les Mittens | Supercarwaar | subject | 27 juil. 2015 16:30 MDT |
| Mont Moran, Oxbow Bend | Michael Gäbler — Featured | subject | juillet (diapositive 1980 : heure estimée) |

Écartés faute de données fiables : Tre Cime (le panorama regarde le refuge, pas les tours), baie d’Halong
(pas de cap ni d’heure, pitons plus fins que le relief à 30 m), Machu Picchu (géolocalisation à 1,3 km),
Santorin (pas de position), le lever de soleil sur le Cervin (cap EXIF à 40° du sommet).

Chaque écart observé capture/photo devient une tâche des chantiers A–C (`docs/progress/landscapes.md`) ; une
scène n’est « parfaite » qu’une fois validée à l’œil sur Mac.

---

## Chantier B — Eau

### B1. Océan
- Remplacer les 12 trains d’ondes par un **océan FFT (Tessendorf) en 3 cascades** (compute par image, textures
  de déplacement/pente), spectre JONSWAP piloté par le vent de la météo et le fetch.
- Écume par le jacobien (crêtes déferlantes), moutons selon le vent, traînées d’écume persistantes.
- Couleur : diffusion sous la surface (vert-bleu selon la turbidité), **profondeur réelle** (bathymétrie GEBCO
  en tuiles) → lagons turquoise, eaux côtières, Fresnel exact, reflets tracés du ciel, du soleil et du relief.
- **Littoral** : distance à la côte (OSM) → vagues qui ralentissent, déferlent et laissent une bande d’écume ;
  sable mouillé.

### B2. Lacs et rivières
- Polygones OSM → eau plane à **rides** (normales procédurales multi-échelles), sens d’écoulement des rivières
  (direction des `waterway`), vitesse selon la largeur, écume aux rapides.
- **Reflets tracés** (le relief, les arbres, les bâtiments) — un avantage du ray-tracer sur le raster.
- Lacs glaciaires turquoise (couleur satellite comme indice), eaux sombres en forêt.

### B3. Interactions
- Le personnage dans l’eau peu profonde (éclaboussures, ondes), le vaisseau posé sur l’eau (Miller existe).

---

## Chantier C — Vues en vol exceptionnelles

- **C1. Imagerie mondiale** : EOX s2cloudless 2021 en tuiles WMTS (10 m, CORS), streamées autour de l’avion et en
  avant du vol (le streaming anticipé de la fusion), transcodées en KTX2 par le worker ; les packs régionaux
  existants restent pour leurs matériaux. Correction colorimétrique vers l’albédo (la mosaïque est tonemappée).
- **C2. Canopée vue d’avion** : la couche A4 (forêts en relief, rugosité, ombres).
- **C3. Bâtiments** : hauteurs OSM (`render_height`, étages) ; estimation par type et région quand absentes ;
  toits (deux pans, terrasses) selon la région ; façades procédurales ; fenêtres éclairées la nuit.
- **C4. Relief fin** : micro-relief procédural sous le MNT 30 m (érosion, éboulis), matériaux rocher/neige par
  pente et altitude, falaises en projection triplanaire.
- **C5. Atmosphère basse** : brumes de vallée à l’aube, ombres des nuages au sol (existe en partie), poussière.
- **C6. Continuité** : fondus temporels entre niveaux de données (aucun « pop »), cible : aucune tuile visible
  en vol à 250 m/s.

---

## Chantier D — Densité et diversité au sol (à pied)

- **D1. Rochers et cailloux** générés sur GPU comme l’herbe (classes nues, garrigue, montagne), avec contact.
- **D2. Arbustes et buissons** (garrigue, lisières, sous-bois) : volumes tracés proches ou instances GPU.
- **D3. Cultures régionales** : vignes en rangs (Bordeaux, Bourgogne), lavande (Provence), rizières (Asie),
  oliveraies — par région et classe culture (table testée).
- **D4. Sol forestier** : feuilles mortes, branches, fougères ; clairières fleuries.
- **D5. Vie** : nuées d’oiseaux, papillons et insectes à la lumière, sons (vent dans l’herbe, pas sur l’herbe —
  false-earth en fournit sous MIT).

---

## Chantier F — Plateforme et qualité

- **F1. Paliers** (iPad / M1 / Windows) : un profil par palier (densités, distances, LOD, résolutions de cartes),
  choisi par `tier.ts`, modifiable dans les réglages ; budgets testés.
- **F2. `bun run check:gpu`** : le banc headless (pipelines, bind groups, rendus synthétiques + SSIM) dans le dépôt.
- **F3. Campagne e2e par chantier** sur les deux Macs, rapports de coût GPU par passe et par palier.
- **F4. Attribution** : crédit à l’écran par source visible (EOX, Meta/WRI, OSM, ESA, Copernicus).

## Ordre et jalons

| Jalon | Contenu | Critère de sortie |
|---|---|---|
| J1 | F2 (banc GPU : `check:forest` livré), E (14 scènes d’après photos : livré), A1 (grille procédurale : livrée, + A3 espèces, A4 couronnes creusées de près) | densité forestière réelle sans limite de nombre, ≤ 2 ms GPU sur M1 |
| J2 | A2–A3 (données, espèces, saisons) | Landes, Vosges, Amazonie crédibles en captures |
| J3 | A4–A5 (LOD tracés, couche de canopée, vent) | forêts d’avion à 10 km sans arbres individuels, transitions invisibles |
| J4 | B1–B2 (océan FFT, littoral, lacs/rivières, reflets) | Maldives, Geiranger, Fuji validés |
| J5 | C1–C6 (imagerie mondiale, bâtiments, relief fin) | vol à 250 m/s sans tuile visible, n’importe où |
| J6 | D1–D5 (rochers, arbustes, cultures, vie) | Cévennes, Dolomites, Torres del Paine à pied validés |

Chaque jalon : code + unitaires + e2e + captures de référence + mise à jour de `progress/on-foot-aaa.md`.
