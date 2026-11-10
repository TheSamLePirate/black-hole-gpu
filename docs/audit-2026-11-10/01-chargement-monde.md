# Audit 2026-11-10 — 01. Chargement du monde

**Périmètre.** Tuiles de relief et d'imagerie de la Terre, décor, caches, Service Worker, zones hors ligne, voyant
réseau, tuiles des autres mondes, premier chargement. Lecture seule du code à `29d4e5e3` plus les modifications non
commitées de l'arbre de travail (§2). Aucun test, e2e ni mesure lancé pendant cet audit.

**Niveaux de preuve.** « lu » = lu dans le code, ligne citée. « mesuré (doc) » = chiffre repris d'un document daté,
non remesuré ici. « calculé » = arithmétique sur des constantes du code, pas une mesure. « supposé » = à confirmer.

**Gravité.** P0 casse, perd des données ou bloque le joueur. P1 défaut visible ou lenteur majeure. P2 défaut réel,
contournable ou partiel. P3 cosmétique ou dette.

---

## 0. Résumé

1. **Le volume d'octets du relief IGN est le premier suspect de la lenteur, et le plan ST ne le traite pas.** Chaque
   grille arrive en float32 brut : 256 Kio (1 Mio pour le sursol lointain). Une approche de 130 s a téléchargé 1,08 Go
   dont ≈ 800 Mo de grilles IGN (mesuré, T8n). Cela fait ≈ 66 Mbit/s de moyenne (calculé). L'analyse du 6 novembre
   conclut « ce n'est pas le réseau » à partir du seul décor ; pour le relief en France, cette conclusion n'est pas
   établie.
2. **En production, tout `data.geopf.fr` passe par un seul portillon du Service Worker : 25 requêtes/s, 10 en vol.**
   Les orthophotos (WMTS) et la BD TOPO (TMS) y sont comprises, alors que la doc du projet les dit sans limite d'usage.
   Les e2e tournent sans Service Worker par défaut : le chemin mesuré n'est pas celui du joueur.
3. **Une tuile qui échoue deux fois est remplacée par la carte mondiale à 4,9 km et n'est plus redemandée.** Elle
   masque les niveaux réels plus grossiers et sert aussi au contact sol. Le compteur d'échecs n'est jamais remis à zéro.
4. **Deux points de défaillance uniques.** Sans Terrarium (S3), aucun relief national n'est demandé. Sans la tuile de
   nuit GIBS, aucune imagerie de jour z 6–14 n'est publiée.
5. **Chaque tuile est écrite 3 à 4 fois sur le GPU**, avec ses mips refaits à chaque fois (une soumission par tuile et
   par couche), sans borne par image.
6. **Un niveau n'est dessiné que sur un rectangle plein.** Les tuiles arrivées hors de ce rectangle attendent.
7. **Le décor reste monolithique** (scène entière recalculée, un worker, un `writeBuffer` de la scène). ST3–ST6 ne
   sont pas commencés.
8. **ST0 est partiel, ST1 est écrit mais non commité, ST2–ST10 ne sont pas commencés.**

---

## 1. État du plan ST0–ST10 (docs/ANALYSE-STREAMING-2026-11-06.md)

| Lot | État constaté dans le code | Preuve |
|---|---|---|
| ST0 mesurer | Partiel. Phases du décor, secondes du voyant, échecs par source : faits et commités (`91483f0f`, `d11f0171`). Temps avant visibilité par cellule, trous, part de vol à voyant vert en planche : absents. | lu : `scenery-worker.ts:234-239`, `net-activity.ts:35-36` |
| ST1 zones complètes | **Écrit, non commité.** Voir §2. L'e2e `tests/e2e/zones-usa-night.e2e.test.ts` est non suivi par git. ST1b (profil persistant, chaînes testées contre les requêtes réelles du worker) : absent. | `git status`, `git diff` |
| ST2 ordonnanceur | Non commencé. Aucun `StreamScheduler` dans `src/`. | grep |
| ST3 cellules | Non commencé. La scène reste l'unité (`scenery.ts:193-226`). | lu |
| ST4 pool de cuiseurs | Non commencé. Un worker (`scenery.ts:246`). | lu |
| ST5 pool GPU paginé | Non commencé. Un `writeBuffer` par scène (`scenery.ts:297`), une soumission de mips par tuile (`earth-tiles.ts:2326`). | lu |
| ST6 cache cuit persistant | Non commencé. Aucun `COOKER_VERSION`. | grep |
| ST7 prédiction | Non commencé. Avance : 6 s, plafonnée à 650 m (`streaming-focus.ts:13`). | lu |
| ST8 HLOD décor | Non commencé. | — |
| ST9 tuiles raster | Non commencé. Validité par rectangle (`earth-tiles.ts:1938-2003`), décodage FIFO non annulable (`earth-tiles.ts:476-500`), calcul IGN sur le fil principal (`earth-tiles.ts:574-598`, `617-650`). | lu |
| ST10 zones cuites | Non commencé. | — |

Le journal `progress-to-destination.md` ne contient aucune entrée « ST ». L'analyse elle-même
(`docs/ANALYSE-STREAMING-2026-11-06.md`) est un fichier non suivi par git.

**Ce que l'analyse du 6 novembre a manqué** (détaillé plus bas) : le volume d'octets du relief (ST-01), le portillon
unique du SW (ST-02), le repli à 4,9 km (ST-03), les deux points de défaillance uniques (ST-04, ST-05), le délai
d'imagerie compté depuis la mise en file (ST-08), le coût d'éviction du SW (ST-10), l'absence de préchargement au
titre (ST-15), le double téléchargement des assets à chaque version (ST-16), les tuiles Lune/Mars hors cache (ST-17).

---

## 2. Modifications non commitées d'une autre session (décrites, non touchées)

12 fichiers, +137 −44 (`git diff --stat`). C'est le lot ST1 de l'analyse.

- `src/system/zones.ts` : `ZONE_SCHEMA = 2`. Terrarium a sa propre chaîne sous les reliefs nationaux (avant : seulement
  en secours de la grille nationale). Tuiles de rues de nuit z 12–13 ajoutées. Infrastructure Overture (`base.pmtiles`,
  z 13, rayon 15 km) ajoutée. Tailles estimées pour Mapterhorn (200 ko) et l'infrastructure (60 ko) : le commentaire
  dit lui-même « not measured in bulk, an estimate ».
- `src/system/pmtiles.ts` : pseudo-URL `kerr-overture-base:` ; `parseOvertureZoneUrl` rend le thème.
- `src/sw.ts` : deux archives Overture par lot (`buildings`, `base`) ; `servedNetwork` gardé à 64 entrées au lieu de 12.
- `src/system/scenery-sources.ts`, `usa-ground.ts` : `sceneryChains` inclut le sol Mapterhorn des USA et
  l'infrastructure ; `mapterhornGroundTiles` factorisé.
- `src/pwa/rules.ts`, `src/pwa-zones.ts`, `src/ui/settings/offline.ts` : `tileKind` « mapterhorn », `zone.schema`,
  mention « à mettre à jour ».
- `tests/pmtiles.test.ts`, `tests/zones.test.ts`, `docs/GRAPHICS-PIPELINE.md` : suivent.
- `src/system/scenery.ts` : un commentaire.

Remarques de lecture, sans exécution :
- `sceneryChains` pousse `OVERTURE_LIST` deux fois hors de France (`scenery-sources.ts`, bloc `q.overture` puis bloc
  infrastructure). Le dédoublonnage de `zoneChains` (`zones.ts:346-352`) le couvre pour les zones ; le préchargement
  (`scenery.ts:392`), éteint, le demanderait deux fois. P3.
- Tant que ce lot n'est pas commité, une zone téléchargée en production suit encore le schéma 1 : Terrarium manque sous
  les reliefs nationaux hors ligne. Voir ST-18.

---

## 3. Chemin d'une tuile, de la demande à l'écran

### 3.1 Relief

1. **Demande.** `Renderer` appelle `earthTiles.update` à chaque image (`renderer.ts:4064`). Chaque niveau z 6–17 a une
   fenêtre de 4 ou 8 tuiles de côté, centrée vers le regard (`earth-tiles.ts:1381-1415`). La portée par défaut est
   `veryFar` (`settings.ts:752`) : 8 tuiles de z 11 à z 17.
2. **File.** `request()` trie par anneau autour du point d'avance, le plus fin d'abord, puis par distance pondérée par
   le mouvement (`earth-tiles.ts:1511`). Au plus 8 chargements Terrarium (`MAX_INFLIGHT`, `:79`, `:1513`).
3. **Réseau, étape 1.** Terrarium (S3) pour toute tuile, même en France (`:1771`). Fichier partagé, 48 gardés, délai
   15 s (`:514-544`). Au-delà de z 15, le parent z 15 est agrandi en bilinéaire **sur le fil principal** (`:548-570`).
4. **Publication 1.** `put` → `writeTexture` 256² + effacement de l'imagerie de l'emplacement + mips (`:1852-1915`).
5. **Réseau, étape 2.** Si une source nationale couvre la tuile : `refine`, 14 à la fois (`MAX_NATIONAL`, `:82`), file
   re-triée par distance à chaque place libérée (`:1618-1634`), délai 30 s à partir du tour (`:1598`). IGN : LiDAR HD
   dès z 16, RGE ALTI dessous ou en contrôle (`:694-713`). Portillon de la page à 20/s, ouvert à 200/s quand le SW
   contrôle (`:173-183`, `scenery-data.ts:16`) ; le SW applique alors 25/s et 10 en vol (`sw.ts:526-527`).
6. **Publication 2.** `put` avec les hauteurs nationales **et l'imagerie de nouveau** (`:1609-1611`).
7. **Étape 3 (z 11–13, France).** Second passage `refine` pour le sursol : une ou deux grilles, 512² sous z 13
   (`:715-726`, `:610`). **Publication 3.**
8. **Validité.** Le niveau n'est dessiné que sur le plus grand rectangle de tuiles présentes contenant la tuile du point
   d'avance (`:1971-2003`).
9. **Cache du relief.** Chaque changement est journalisé (`logChange`) et le cache de surface re-cuit les anneaux
   touchés (`renderer.ts:6276-6285`).

### 3.2 Imagerie

1. Lancée avec la tuile, **hors plafond** (`earth-tiles.ts:1758-1763`) : jour (ortho nationale, sinon EOX, sinon GIBS),
   nuit (parent z 8 de GIBS, partagé), rues de nuit (OpenFreeMap) (`:2526-2598`).
2. Délai 15 s **armé à l'appel**, pas à l'envoi (`:1752`).
3. Décodage et couleurs dans un worker unique, FIFO (`:452-500`, `tile-decode.ts:184-217`).
4. `put` de nouveau : relief réécrit, imagerie écrite, mips (4 passes de rendu, 4 bind groups, 8 vues, **une
   soumission**) ; une seconde série pour la couche des lumières (z ≤ 8) ou des rues (z ≥ 12, fenêtre 1024²)
   (`:2279-2382`).
5. Orthophotos z 15–18 : chemin séparé, 8 à la fois, 3 nouvelles tentatives à 2/4/8 s (`:2102-2188`).

### 3.3 Où le temps se perd (classement par lecture, non mesuré ici)

| Étape | Risque | Constat |
|---|---|---|
| Octets du relief IGN | très fort sur une liaison < 50 Mbit/s | ST-01 |
| Portillon SW 25/s partagé | fort en France, en production | ST-02 |
| Rectangle de validité | moyen : tuiles présentes non dessinées | ST-07 |
| Délai d'imagerie compté en file | moyen : abandons et reprises | ST-08 |
| Écritures GPU répétées | moyen : régularité de l'image | ST-06 |
| CPU IGN sur le fil principal | moyen : saccades | ST-09 |
| Éviction du SW par tuile | supposé moyen, croît avec le budget | ST-10 |

---

## 4. Constats

### ST-01 — P1 — Le relief IGN voyage en float32 brut : ≈ 800 Mo par approche

- **Où.** `src/system/earth-tiles.ts:139-144` (`FORMAT=image/x-bil;bits=32`), `:610` (512² sous z 13), `:918-924`
  (fenêtres de 8 tuiles z 11–17), `:53-57` (halo de 6 anneaux en `veryFar`), `:1823-1827` (le halo demande aussi les
  grilles nationales).
- **Constat.** Une grille pèse 256 Kio, une grille de sursol z 11–12 pèse 1 Mio. Le serveur ne compresse pas
  (mesuré (doc) : T8.md:497-500). Le SW les stocke compressées à ≈ 15 % (GRAPHICS-PIPELINE.md:434) : le transport
  coûte donc ≈ 6 fois le contenu utile. Session mesurée (doc, T8n) : 1,08 Go en ≈ 130 s, dont LiDAR MNT 276 Mo,
  LiDAR MNS 185, RGE ALTI 179, RGE MNS 116, MNH 51.
- **Impact.** 1,08 Go / 130 s ≈ 8,3 Mo/s ≈ 66 Mbit/s en moyenne (calculé). Sur une liaison de 20 Mbit/s, le même vol
  demanderait plus de trois fois la durée du vol : le relief fin n'arrive jamais à temps. C'est cohérent avec la
  plainte « c'est assez lent ». L'analyse du 6 novembre (§0.1) écarte le réseau à partir du voyant jaune du décor ;
  elle ne mesure pas le débit du relief.
- **Piste.** (a) Mesurer d'abord : débit et octets par source, sur la liaison réelle de Sam, SW actif. (b) Réduire la
  demande : fenêtres z 15–17 à 8 tuiles seulement sous une vitesse donnée ; sursol 512² seulement quand la tuile est
  dans le champ ; pas de grille nationale pour le halo. (c) Chercher un format plus léger côté IGN (entier 16 bits,
  GeoTIFF compressé) : **supposé, à confirmer** dans la doc de la Géoplateforme. (d) Vérifier si Mapterhorn porte le
  LiDAR HD français (tuiles WebP 512², déjà décodées par `terrarium512`) : **supposé, à confirmer** ; le code place
  l'IGN avant Mapterhorn (`:834`).
- **Preuve.** Lu + mesuré (doc T8n, ce Mac, 6/11) + calculé. **Manque au plan ST.**

### ST-02 — P1 — En production, toutes les requêtes Géoplateforme partagent 25 req/s et 10 en vol

- **Où.** `src/sw.ts:525-527`, `:579-594` (`request.url.startsWith(GEOPF)`), `src/pwa/rules.ts:231-237` (classes),
  `src/pwa.ts:52-59` (pas de SW en e2e sans `sw=1`, ni en dev).
- **Constat.** Le portillon du SW couvre les grilles WMS-R **et** les orthophotos WMTS **et** la BD TOPO en TMS. La doc
  du projet dit : WMTS sans limite d'usage, TMS sans limite, WMS-R 40 req/s (ANALYSE-IGN-LIDAR.md:45-46, :491, :687).
  Le commentaire de `earth-tiles.ts:22` dit aussi « no usage limit » pour le WMTS.
- **Impact.** Un saut vers Paris en `veryFar` demande de l'ordre de 1 200 requêtes Géoplateforme (calculé : imagerie
  z 9–14 ≈ 288, orthos z 15–18 = 64, sol z 11–17 = 448 tuiles × 1 à 2 grilles, sursol z 11–13 = 192 × 1 à 2). À
  25/s, il faut au moins ≈ 48 s, quelle que soit la liaison. Les orthophotos (classe 1) passent derrière le sol
  (classe 0) et ne remontent qu'après 1,5 s d'attente. Mesuré (doc, T8o, kerr-mini, SW actif) : étape BD TOPO du décor
  12–23 s.
- **Impact sur les mesures.** Sans SW, la page limite seulement le WMS-R (20/s) et le worker son relevé (12/s) ; les
  orthophotos et la BD TOPO ne sont pas limitées. Les chiffres « vue à 90 % en 8,1 s » (T8j) viennent de ce chemin.
  Seuls T8n et T8o ont une colonne SW.
- **Piste.** Deux budgets : WMS-R (rate limitée, connue) et WMTS/TMS (concurrence seule). Garder la pause globale sur
  429. Mesurer avant/après avec SW. L'origine des 429 cités en `sw.ts:524` (quel service) n'est pas documentée :
  **à confirmer** avant d'ouvrir.
- **Preuve.** Lu + mesuré (doc). **Manque au plan ST** (ST2 garde « les politiques actuelles »).

### ST-03 — P1 — Après deux échecs, la tuile devient la carte mondiale à 4,9 km, pour de bon

- **Où.** `src/system/earth-tiles.ts:1796-1810` (échecs), `:2005-2018` (`fromFallback`), `src/terrain.ts:619-622`
  (`tileFallbackSampler` : carte mondiale, mer ramenée à 0), `:949` (`failures`, jamais vidé : aucun `delete`).
- **Constat.** Deux échecs Terrarium (HTTP, réseau, ou délai de 15 s) → la tuile est remplie depuis la carte ETOPO et
  publiée comme une tuile normale de son niveau. Sa clé occupe l'emplacement : elle n'est plus redemandée tant que la
  fenêtre la contient. Le compteur d'une clé ne redescend jamais, même après un succès : à la visite suivante, un seul
  échec suffit, et l'attente croît de 3 s par échec passé.
- **Impact.** Un niveau fin faux masque les niveaux réels plus grossiers qui étaient justes. En montagne l'écart peut
  être de centaines de mètres. `heightAt` lit les mêmes données (`:2431-2482`) : le contact sol, l'Auto-GCAS et le
  train voient ce faux sol. Une liaison lente (réponses > 15 s) déclenche ce cas sans aucune panne.
- **Piste.** Ne pas publier de repli dans un niveau : laisser l'emplacement vide et marquer la tuile « absente » (le
  rectangle de validité l'exclut déjà). Redemander avec un recul borné tant qu'elle est voulue. Effacer `failures` au
  succès. Test unitaire : deux échecs puis un succès.
- **Preuve.** Lu. Non reproduit en jeu.

### ST-04 — P1 — Sans Terrarium, aucun relief national

- **Où.** `src/system/earth-tiles.ts:1768-1779` (`refineAfter` n'est posé que dans le `try` après le succès de
  Terrarium), `:1823`.
- **Constat.** Si S3 échoue ou traîne, la tuile part en repli (ST-03) et les hauteurs IGN, swisstopo ou Mapterhorn ne
  sont jamais demandées, alors que ces services répondent.
- **Impact.** Une panne ou une lenteur d'un hôte tiers (S3) retire le relief fin de tout le jeu.
- **Piste.** Lancer `refine` aussi après l'échec de Terrarium quand une source nationale couvre la tuile ; `nationalHeights`
  sait déjà combler les trous (`:870-877`).
- **Preuve.** Lu.

### ST-05 — P1 — Sans la tuile de nuit GIBS, aucune imagerie de jour z 6–14

- **Où.** `src/system/earth-tiles.ts:2577` (`Promise.all([day(), get(nightUrl…), mvt])`), `:2494-2507` (`parentBlob`,
  `fetch(url)` **sans délai ni signal**), `:1646-1662` (3 reprises puis abandon).
- **Constat.** L'imagerie d'une tuile n'est produite que si le jour **et** la nuit arrivent. La nuit des niveaux fins est
  un parent z 8 partagé, demandé sans délai : une requête bloquée reste dans `parents` et fait expirer à 15 s toutes
  les tuiles sous ce parent (un carré d'environ 150 km). Après trois reprises, plus rien n'est tenté tant que la tuile
  reste dessinée.
- **Impact.** GIBS lent ou en panne → sol sans photographie à tous les niveaux z 6–14, y compris sur l'ortho IGN, alors
  qu'EOX et l'IGN répondent. Les orthophotos z 15–18 ne sont pas touchées (chemin séparé).
- **Piste.** Publier le jour seul si la nuit manque (lumières à 0), compléter ensuite. Donner un délai à `parentBlob`
  et retirer l'entrée bloquée.
- **Preuve.** Lu. Non reproduit en jeu.

### ST-06 — P2 — Chaque tuile est écrite 3 à 4 fois, ses mips refaits à chaque fois, sans borne par image

- **Où.** `src/system/earth-tiles.ts:1900-1903` (condition de `putImagery`), `:1905-1913` (relief), `:2341-2342`
  (imagerie + mips), `:2353-2354`, `:2379-2380` (couches lumières et rues), `:2299-2326` (un encodeur et un `submit`
  par appel), `:1609-1611` (`refine` republie avec `col`).
- **Constat.** Pour une tuile française z 11–13 : (1) Terrarium → relief + **effacement** de l'imagerie (écriture de
  zéros + mips) ; (2) imagerie → relief + imagerie + mips ; (3) sol IGN → relief + **même imagerie** + mips ;
  (4) sursol → idem. Soit 4 écritures de relief (256 Kio chacune), 4 d'imagerie, 4 à 8 soumissions, 16 à 32 passes de
  rendu. Chaque `put` alloue 2 à 3 tableaux de 256 Kio et parcourt 65 536 texels 2 à 3 fois. Rien ne limite le nombre
  de `put` par image : ils tombent dans la tâche où la réponse arrive.
- **Impact.** Pour une fenêtre de 64 tuiles : ≈ 256 écritures et 256 à 512 soumissions par niveau. Coût CPU de `put`
  mesuré (doc, T8a, avant les mips T9) : ≈ 280 ms sur 25 s, 2,4 ms au plus. Le coût GPU des soumissions de mips n'est
  mesuré nulle part (GRAPHICS-PIPELINE.md:245-248 le dit). Chaque `put` déclenche aussi une re-cuisson du cache du
  relief sur ses anneaux (`:1874`).
- **Piste.** Ne pas réécrire l'imagerie quand `imgKey` est déjà celle de la tuile et que `col` est le même tableau. Ne
  pas effacer l'imagerie au premier `put` quand elle est en vol. File de publication vidée dans la frame, bornée en
  octets, un seul encodeur de mips par image. C'est ST5 (« mips regroupés, `putTile` coalescés »).
- **Preuve.** Lu + mesuré (doc) pour le CPU. Coût GPU : non mesuré.

### ST-07 — P2 — Un niveau n'est dessiné que sur un rectangle : les tuiles arrivées autour attendent

- **Où.** `src/system/earth-tiles.ts:1938-1958`, `:1971-2003`, `:1409-1413`.
- **Constat.** `valid` est le plus grand rectangle plein contenant la tuile du point d'avance. Si cette tuile manque
  (en vol, en échec, en recul de 3 s), `loadedRect` rend `null` et rien de neuf n'est dessiné pour ce niveau. Quand la
  fenêtre avance d'une tuile, la nouvelle colonne (8 tuiles) n'entre dans le rectangle que complète.
- **Impact.** Du détail téléchargé, décodé et en mémoire GPU reste invisible. Le joueur voit le sol s'affiner par blocs,
  plus tard que les données n'arrivent.
- **Piste.** Masque de validité par tuile lu par le shader (une table de bits par niveau). C'est ST9, non commencé.
- **Preuve.** Lu. L'écart de temps entre « arrivée » et « dessinée » n'est pas instrumenté.

### ST-08 — P2 — L'imagerie n'a pas de plafond, et son délai de 15 s court pendant l'attente en file

- **Où.** `src/system/earth-tiles.ts:1750-1763` (minuteur armé avant le `fetch`), `:1758` (aucun plafond), `:1646-1662`
  (reprises 2/4/8 s, puis abandon).
- **Constat.** Les 8 places Terrarium se libèrent vite ; chaque tuile lance aussitôt son imagerie. Après un saut,
  plusieurs centaines de requêtes d'imagerie sont en file en même temps : derrière les 6 connexions par hôte du
  navigateur en HTTP/1.1 (supposé pour certains hôtes), ou derrière le portillon du SW pour l'IGN (ST-02). Celles qui
  attendent plus de 15 s sont annulées, puis redemandées en queue de file. Après trois reprises, la tuile reste sans
  photographie tant qu'elle est dessinée.
- **Impact.** Travail refait, octets perdus pour les requêtes annulées en cours de réponse, et trous d'imagerie
  durables sur une liaison lente. `earthTiles.imageryRetries` (`:1664`) permet de le compter : aucune valeur publiée.
- **Piste.** Compter le délai à partir de l'envoi (ou de l'en-tête reçu). Plafonner l'imagerie par hôte et la trier
  comme le relief. C'est le cœur de ST2.
- **Preuve.** Lu. Fréquence réelle : non mesurée (T8o note « aucune contention mesurée », sur une liaison rapide).

### ST-09 — P2 — Le calcul des grilles IGN se fait sur le fil principal et n'est pas compté

- **Où.** `src/system/earth-tiles.ts:586-597` (balayage NaN de 65 536 à 262 144 valeurs), `:617-650` (`overground`,
  boucle bilinéaire sur 262 144 échantillons en z 11–12), `:548-570` (agrandissement du parent Terrarium, z ≥ 16),
  `:1565-1576` (`coarseGrid` : 256 appels de `heightAt` par tuile z ≥ 16), `:874-877`, `:190-193`.
- **Constat.** `TILE_CPU` ne compte que décodage, couleurs, `put` et worker (`:430-443`). Ces boucles n'y figurent
  pas.
- **Impact.** Plusieurs millisecondes par tuile lointaine, par à-coups, pendant le vol (estimé, non mesuré). T8 signale
  « une ou deux longues tâches de 51–103 ms par vol, cause à chercher ailleurs » (T8.md:40) : ce code est un candidat,
  **supposé**.
- **Piste.** Passer `ignGrid`/`overground`/l'agrandissement dans le worker de décodage (les tableaux se transfèrent).
  D'abord les ajouter à `TILE_CPU`. Inscrit dans ST9.
- **Preuve.** Lu. Coût : estimé.

### ST-10 — P2 — Le SW relit tout son index à chaque tuile venue du réseau, et ne dédoublonne pas

- **Où.** `src/sw.ts:630`, `:671`, `:704-711` (`enforceBudget` → `indexAll()` = `getAll` de tout le magasin, somme, tri
  si dépassement), `src/pwa/rules.ts:94-106`, `sw.ts:598-634` (aucune table des requêtes en vol).
- **Constat.** Dès qu'un passage d'éviction se termine, la tuile réseau suivante en relance un. En vol, c'est donc en
  continu. L'index compte une entrée par tuile gardée : ≈ 10 000 pour 300 Mo, de l'ordre de 100 000 pour le budget de
  3 Go (calculé à ≈ 30 ko par entrée). Toutes les requêtes de tuiles du jeu, même servies du cache, passent par ce même
  fil.
- **Constat lié.** Deux demandes simultanées de la même URL (page et worker du décor : Terrarium, OpenFreeMap) ratent
  toutes deux le cache et partent toutes deux au réseau. L'analyse mesure ces doublons (670 Mo contre 280 avec le
  préchargement, sans SW) mais ne propose pas de les fusionner dans le SW.
- **Impact.** Latence ajoutée à chaque tuile, croissante avec la taille du cache : le joueur qui choisit 3 Go pour
  « aller plus vite » peut ralentir son SW (supposé, à mesurer). Octets doublés.
- **Piste.** Total en mémoire tenu à jour ; éviction seulement au-dessus du budget ; curseur IndexedDB trié par date.
  Table `url → Promise<Response>` pour les requêtes en vol.
- **Preuve.** Lu. Coût : supposé, non mesuré.

### ST-11 — P2 — Aucune limite du niveau demandé selon la vitesse

- **Où.** `src/system/earth-tiles.ts:1358`, `:1372-1375`, `:2063` (niveaux par hauteur et angle du pixel seulement),
  `src/system/streaming-focus.ts:7-14` (avance ≤ 650 m), `earth-tiles.ts:1400-1408` (recentrage à 0,8 tuile).
- **Constat.** À basse hauteur, z 17 et l'ortho z 18 sont demandés quelle que soit la vitesse. Une tuile z 17 fait
  ≈ 200 m à 48° : à 250 m/s la fenêtre z 17 se recentre toutes les ≈ 0,7 s et demande 8 tuiles neuves (calculé), chacune
  une à deux grilles de 256 Kio. `dropUnwanted` annule ensuite ce qui est sorti (`:1437-1469`).
- **Impact.** En vol rapide et bas, le débit et le portillon servent des tuiles qui sortiront avant d'être vues, au
  détriment des niveaux moyens visibles.
- **Piste.** Plafonner le niveau le plus fin par « temps de séjour dans la fenêtre » (demi-fenêtre ÷ vitesse) comparé
  au délai d'arrivée observé. Avancer le centre des fenêtres le long de la trajectoire, pas seulement la priorité.
  ST7 parle de prédiction, pas de ce plafond.
- **Preuve.** Lu + calculé. Effet : non mesuré.

### ST-12 — P2 — Le décor : scène entière, un worker, annulation à gros grain

- **Où.** `src/system/scenery.ts:193-226` (clé de scène), `:246` (un worker), `:297` (`writeBuffer` de toute la scène),
  `:303` (`SceneryContact` construit sur le fil principal), `:236` (3 s entre deux demandes), `:448` (fondu global
  600 ms) ; `src/system/scenery-worker.ts:234-239` (annulation seulement à `phase()`, 12 points : `:370` à `:1682`),
  `:1759-1771` (`onmessage` asynchrone).
- **Constat.** Toujours vrai par rapport à l'analyse. Deux précisions qu'elle ne donne pas : (a) pendant une phase de
  calcul synchrone, le worker ne lit pas le message d'annulation ; (b) une nouvelle demande démarre son `prepare`
  alors que l'ancienne tourne encore jusqu'à sa prochaine phase : les deux se partagent le fil et le réseau.
- **Impact.** Mesuré (doc, analyse §2, ce Mac, 6/11) : scène 20–44 s, refaite toutes les ≈ 40 s sur une approche ;
  voyant jaune 74 s sur 162 s. Budget du buffer : 16 Mio × portée² (`scenery-data.ts:9`, `:19`), 64 Mio à la portée 2.
- **Piste.** ST3 + ST6 (cellules, cache cuit). À court terme : vérifier l'annulation dans les boucles longues (forêt,
  toits, décalques) ; refuser un second `prepare` tant que le premier n'a pas rendu la main.
- **Preuve.** Lu + mesuré (doc).

### ST-13 — P2 — Le worker du décor et ses caches sont détruits à un saut, au-dessus de 12 km, ou au changement de mode

- **Où.** `src/system/scenery.ts:116-118` (`clear()` → `terminate()`), `:181-189` (altitude > 12 000 m, mode `off`,
  loin de la Terre), `:205-207` (scène à plus de 8 km × portée).
- **Constat.** Le correctif `d11f0171` garde le worker au recentrage. `clear()` le tue encore dans les autres cas. Le
  cache réseau (96 ou 192 Mio) et les 80 000 plans de toits partent avec lui (`scenery-worker.ts:115-166`).
- **Impact.** Une montée au-dessus de 12 km puis une descente au même endroit repart à froid. Un aller-retour entre
  deux aéroports aussi.
- **Piste.** Séparer « plus de scène dessinée » de « worker détruit » : envoyer `cancel`, garder le worker.
- **Preuve.** Lu.

### ST-14 — P2 — Un échec du décor attend 30 s à 5 min

- **Où.** `src/system/scenery.ts:262-268`, `:274-280`, `:416-418`.
- **Constat.** Toute erreur de scène, même une seule source manquante sur une scène déjà dessinée, arme un recul de
  30 s doublé à chaque échec, plafonné à 5 min. Le délai par requête du worker est de 25 s (`scenery-worker.ts:215`).
- **Impact.** Une coupure de quelques secondes à l'arrivée laisse le lieu sans arbres ni bâtiments pendant au moins
  30 s.
- **Piste.** Premier recul court (3–5 s) quand rien n'est dessiné ; garder le recul long pour les échecs répétés.
- **Preuve.** Lu.

### ST-15 — P2 — Rien n'est préchargé pour le lieu de départ pendant le titre ou le voile d'entrée

- **Où.** `src/main.ts:9740-9763` (seule la compilation est préparée : `prewarmEarthFlight`), `src/renderer.ts:4026-4064`
  (les tuiles ne démarrent que quand la caméra est près de la Terre). Aucune fonction de préchargement de tuiles
  (grep `prefetchTiles|warmTiles|preloadTiles` : rien).
- **Constat.** Le titre reste ouvert 8 s ou plus ; le voile d'entrée attend le noyau jusqu'à 90 s
  (GRAPHICS-PIPELINE.md:416). Pendant ce temps le réseau des tuiles est inactif, alors que le lieu du mode choisi est
  connu.
- **Impact.** La première image d'un vol terrestre est « ciel d'attente + sol grossier » puis 8 à 40 s d'affinage
  (mesuré (doc), GRAPHICS-PIPELINE.md:428-431).
- **Piste.** Dès le choix du mode : appeler `earthTiles.update` avec la position de départ (les fenêtres acceptent déjà
  un centre arbitraire, cf. `shipFocus`) et demander la scène de décor. **Manque au plan ST.**
- **Preuve.** Lu.

### ST-16 — P2 — À chaque nouvelle version, le cache des assets est vidé puis tout est retéléchargé sans cache HTTP

- **Où.** `src/sw.ts:195-205` (tout cache `kerr-shell:` d'un autre build est supprimé), `:490` (les assets hachés
  « immuables » vivent dans ce cache), `src/pwa.ts:123-142` (`warmShell` : `fetch(u, { cache: "no-store" })` pour chaque
  ressource chargée absente du cache).
- **Constat.** Les textures, éphémérides et sons hachés n'ont pas changé de nom, mais leur cache porte le nom du build.
  Après activation du nouveau SW, `warmShell` les redemande toutes en contournant le cache HTTP.
- **Impact.** `main` est déployé à chaque poussée : chaque joueur retélécharge l'ensemble des assets chargés (dizaines
  de Mo : ciel 3,5 Mo, étoiles 3,4 Mo, JUP365 7,5 Mo, cartes de la Terre, etc. — tailles (doc), total non mesuré),
  en concurrence avec les tuiles du début de session. Hors ligne juste après une mise à jour, les assets non encore
  réchauffés manquent.
- **Piste.** Un cache d'assets hachés sans nom de build (comme `kerr-tiles-v1`), nettoyé par liste. `warmShell` sans
  `no-store` pour les fichiers hachés.
- **Preuve.** Lu. Volume : non mesuré. Déjà signalé « à mesurer » dans GRAPHICS-PIPELINE.md:440-441, sans le lien avec
  `warmShell`.

### ST-17 — P2 — Tuiles de la Lune, de Mars et des autres mondes : hors cache du SW, un seul essai

- **Où.** `src/pwa/rules.ts:22-72` (ni `stream.samlepirate.org/svc`, ni `trek.nasa.gov`, ni `astro.arcgis.com` ne sont
  classés « tile » : ils sont « pass »), `src/system/moon-tiles.ts:40` (`RETRY_MS` 120 s), `:529-534`, `:600-608`
  (un échec → repli publié), `:355` (`missing`, jamais purgé).
- **Constat.** Ces tuiles ne sont ni gardées par le SW ni disponibles hors ligne. Un seul échec ou un délai de 20 s
  publie le repli (carte globale) ; la clé occupe l'emplacement, donc la tuile n'est pas redemandée tant que la fenêtre
  la contient, même après 120 s.
- **Impact.** Chaque visite de la Lune ou de Mars dépend du serveur de Sam et du cache HTTP du navigateur. Un incident
  court laisse un trou jusqu'à ce que la caméra s'éloigne.
- **Piste.** Classer ces hôtes en « tile ». Redemander après `RETRY_MS` même si l'emplacement est occupé par un repli.
- **Preuve.** Lu.

### ST-18 — P2 — Zones hors ligne : écarts restants avec les requêtes réelles

- **Où et constats.**
  1. Le lot ST1 n'est pas commité (§2). En production, `reliefChains` met encore Terrarium en simple secours : hors
     ligne, sous l'IGN, les USA ou Mapterhorn, la tuile échoue à l'étape Terrarium, donc pas de relief national non
     plus (ST-04). Lu dans `git diff` de `src/system/zones.ts`.
  2. `src/main.ts:958` : `held` ne s'applique que si `navigator.onLine` est faux. Sur un Wi-Fi sans Internet,
     `onLine` reste vrai (comportement connu des navigateurs) : le jeu demande des niveaux plus fins que la zone, chaque
     requête échoue deux fois, puis ST-03 publie le repli à 4,9 km **par-dessus** les niveaux que la zone possède.
  3. `src/sw.ts:378-387` : un 404 d'une source est épinglé dans la zone ; `sw.ts:604-610` sert la zone d'abord, même en
     ligne. Le commentaire `:378` dit que le WMTS de l'IGN répond parfois 404 pour une tuile qu'il a (deux essais
     seulement) : ce trou devient permanent jusqu'à la mise à jour de la zone.
  4. Les zones contiennent des octets bruts, pas le décor calculé : hors ligne en zone, chaque scène est recalculée
     (20–44 s, ST-12). ST6/ST10, non commencés.
  5. Les tests comparent `sceneryChains` à une spécification partagée, pas aux requêtes réelles du worker (ST1b, non
     fait). L'infrastructure Overture en est l'exemple : absente des zones jusqu'au 6 novembre.
  6. Lune, Mars, météo, pistes hors `runways/` : hors zone (ST-17 ; par conception pour la météo).
- **Impact.** « 0 tuile au réseau hors ligne » n'est garanti que par un e2e non commité, pour une zone (JFK).
- **Piste.** Commiter ST1 avec son e2e. Décider `held` sur l'échec réel des requêtes (ou sur un sondage du SW) plutôt
  que sur `navigator.onLine`. Ne pas épingler un 404 de WMTS sur deux essais rapprochés.
- **Preuve.** Lu.

### ST-19 — P2 — Mémoire : environ 1 Go pour les tuiles de la Terre au réglage par défaut, jamais rendue

- **Où.** `src/system/earth-tiles.ts:53-57` (`veryFar` : 640 tuiles gardées), `:403-409` (`data`, `col` par
  emplacement), `:1869` (`col` gardé sur tous les niveaux quand un halo existe), `:1213-1234`, `:1290-1301` (`clear()`
  annule `want` et `valid` mais garde `key`, `data`, `col` et `cache`), `:255-259` (textures d'imagerie).
- **Constat (calculé).** Fenêtres : 5 × 16 + 7 × 64 = 528 emplacements × 256 Kio de hauteurs ≈ 132 Mio, + sursol
  z 11–13 ≈ 48 Mio, + imagerie gardée ≈ 132 Mio. Cache hors fenêtre : 640 × 512 à 768 Kio ≈ 320 à 480 Mio. GPU :
  relief 9 couches de 2048² en `r32uint` ≈ 151 Mio (T8.md:403), imagerie 89 + 89 Mio. S'y ajoutent le cache du worker
  du décor (96–192 Mio) et le buffer du décor (jusqu'à 64 Mio).
- **Constat.** Quitter la Terre (`clear()`) ne libère ni les tableaux des emplacements ni le cache. Il n'y a pas de
  comptabilité commune ni de réaction à la pression mémoire.
- **Impact.** Sur une machine de 8 Go ou un iPad, risque de rechargement de l'onglet (supposé). Le doc annonce 320 Mo
  pour le seul cache (GRAPHICS-PIPELINE.md:434-435) ; les fenêtres ne sont pas comptées.
- **Piste.** Mesurer (`performance.measureUserAgentSpecificMemory` ou tas des e2e). Ne garder `col` que pour les
  niveaux du halo. Libérer `data` et le cache quand la Terre n'est plus le corps proche depuis N secondes. Budget
  commun (analyse §8).
- **Preuve.** Lu + calculé. Non mesuré.

### ST-20 — P3 — Petites fuites et caches d'échec

- `src/system/earth-tiles.ts:2511-2520` : `fetchRoads` met en cache un `null` après un échec ; les rues de nuit de
  cette tuile manquent jusqu'à l'éviction (24 entrées). Lu.
- `src/system/earth-tiles.ts:949` (`failures`) et `src/system/moon-tiles.ts:355` (`missing`) : tables jamais purgées.
  Croissance lente. Lu.
- `src/system/earth-tiles.ts:1223-1231` : l'éviction du cache de tuiles relit et découpe les 640 clés à chaque
  insertion une fois plein. Lu ; coût estimé faible.
- `src/system/earth-tiles.ts:514-544`, `:761-780` : les fichiers partagés (Terrarium, Mapterhorn) ne sont pas annulés
  quand tous leurs demandeurs ont abandonné ; `MAX_INFLIGHT` ne compte donc pas ces requêtes orphelines. Choix assumé
  par le commentaire ; le nombre réel de connexions n'est pas borné. Lu.
- Aucune entrée du cache du SW n'a de date de péremption (`sw.ts:611-619`) : une orthophoto mise à jour par l'IGN n'est
  jamais rafraîchie hors « vider le cache ». Lu.
- `src/system/earth-tiles.ts:1809` : un `console.warn` par tuile en repli ; hors ligne hors zone, des centaines. Lu.

### ST-21 — P3 — Le voyant et les mesures ne voient pas le chemin réel

- **Où.** `src/pwa.ts:52-59`, `src/system/net-activity.ts:222` (seul l'en-tête du SW distingue cache et réseau),
  `src/renderer.ts:11150-11159` (`earthSettled` : un booléen).
- **Constat.** Sans SW (e2e par défaut), `cached` reste à 0 et les octets comptés incluent le cache HTTP. Aucune mesure
  n'existe de : temps demande → dessin par tuile, attente dans le portillon du SW, débit par hôte, latence d'un succès
  de cache dans le SW. Le doc T8 mesurait ≈ 35 tuiles/s servies du cache avant le correctif `indexTouch`
  (`sw.ts:94-96`) ; aucune valeur après.
- **Piste.** ST0 à compléter : horodatages par tuile (demandée, octets reçus, décodée, écrite, dessinée), exposés par
  `__bh`, et e2e de référence avec `sw=1`.
- **Preuve.** Lu.

---

## 5. Réponses aux huit questions

1. **Chemin et blocages.** §3. Concurrence : 8 Terrarium, 14 nationales, 8 orthos, imagerie sans plafond, décor
   6/6/4, SW 25/s et 10 en vol sur la Géoplateforme. Annulation : oui pour le relief, les nationales et les orthos
   sorties de fenêtre (`dropUnwanted`, 4 fois/s) ; non pour les fichiers partagés ni le décodage. Reprises : Terrarium
   2 essais puis repli (ST-03) ; grilles IGN 1/2/4 s ; imagerie et orthos 2/4/8 s ; décor 30 s à 5 min. Fil principal :
   ST-06, ST-09, `writeBuffer` et `SceneryContact` du décor (ST-12).
2. **Doublons, inutile, jamais annulé.** Imagerie réécrite à chaque `refine` (ST-06) ; même URL demandée par la page
   et le worker sans fusion (ST-10) ; z 17 demandé à toute vitesse (ST-11) ; grilles nationales pour le halo (ST-01).
   Priorité réelle : anneau autour du point d'avance, le plus fin d'abord — c'est bien ce que la vue regarde ; les
   fenêtres sont centrées vers le regard. Prédiction : 6 s, 650 m au plus. Après un saut : les fenêtres repartent de
   zéro, l'ancien est annulé en ≤ 250 ms, le décor est détruit avec son worker (ST-13).
3. **Caches.** Mémoire : ST-19. SW : cache d'abord, LRU 300 Mo par défaut, index IndexedDB, grilles compressées ;
   réponses opaques et erreurs non gardées (`sw.ts:622`) ; pas de péremption (ST-20) ; éviction coûteuse (ST-10).
   Rien de calculé n'est persistant (cuisson du relief, décor).
4. **Erreurs.** Pas de martèlement constaté : toutes les reprises sont bornées. En revanche des trous durables :
   ST-03, ST-04, ST-05, ST-08, ST-17. Un 429 de la Géoplateforme met tout le portillon en pause (`sw.ts:590-592`).
5. **Décor.** ST-12, ST-13, ST-14.
6. **Zones.** ST-18.
7. **Fuites.** Pas de texture GPU orpheline trouvée : les anciennes textures et buffers sont détruits après
   `onSubmittedWorkDone` (`earth-tiles.ts:1159-1163`, `scenery.ts:142-152`). Mémoire CPU retenue : ST-19, ST-20.
8. **Premier chargement.** ST-15, ST-16. L'ordre mesuré est dans GRAPHICS-PIPELINE §7 ; non remesuré ici.

---

## 6. Les dix gains les plus probables pour « les tuiles chargent plus vite »

| # | Gain | Certitude | Coût | Plan ST |
|---|---|---|---|---|
| 1 | Mesurer avec SW et sur la liaison réelle : octets et délai par hôte, temps demande → dessin par tuile (ST-21). Sans cela, les neuf autres restent des paris. | certaine (c'est un prérequis) | petit | ST0, à compléter |
| 2 | Réduire les octets du relief IGN : pas de grille nationale pour le halo, sursol 512² seulement dans le champ, fenêtres z 15–17 selon la vitesse ; puis format ou source plus légers (ST-01, ST-11). | forte sur liaison < 50 Mbit/s (calculé) ; format léger : à confirmer | petit puis moyen | **manque** |
| 3 | Sortir WMTS et TMS du portillon à 25/s du SW (ST-02). | moyenne (dépend de l'origine des 429) | petit | **manque** |
| 4 | Précharger tuiles et décor du lieu de départ pendant le titre et le voile (ST-15). | forte pour la première image | petit | **manque** |
| 5 | Validité par tuile au lieu du rectangle (ST-07). | forte pour le perçu ; gain non chiffré | moyen à grand (shader, cache du relief) | ST9 |
| 6 | Imagerie sous plafond et priorité, délai compté à l'envoi, jour publié sans attendre la nuit (ST-05, ST-08). | forte sur liaison lente, faible sur fibre | petit à moyen | ST2 (en partie) |
| 7 | Ne plus publier de repli à 4,9 km ; relief national même sans Terrarium ; échecs remis à zéro (ST-03, ST-04). | certaine pour les trous ; pas un gain de vitesse | petit | **manque** |
| 8 | Publications GPU coalescées et bornées par image ; pas de réécriture d'imagerie identique (ST-06). | moyenne (régularité) ; vitesse : faible | moyen | ST5 |
| 9 | SW : éviction sans relire l'index, fusion des requêtes identiques en vol (ST-10). | moyenne, croît avec le budget choisi | petit | **manque** |
| 10 | Décor par cellules avec cache cuit persistant (ST-12), worker gardé (ST-13), recul court (ST-14). | forte pour le décor (mesures du 6/11) ; sans effet sur les tuiles | grand (ST-13, ST-14 : petit) | ST3 + ST6 |

Ordre conseillé : 1, puis 7 et 3 et 4 (petits, indépendants), puis 2, puis 6, puis 5 et 8, puis 10. L'ordre de l'analyse
(ST2 d'abord) reste valable pour l'ordonnanceur, mais il ne réduit ni les octets ni le plafond du SW.

---

## 7. Tableau récapitulatif

| Id | Gravité | Fichier:ligne | Constat | Preuve |
|---|---|---|---|---|
| ST-01 | P1 | `earth-tiles.ts:139-144`, `:610`, `:918-924` | Relief IGN en float32 brut, ≈ 800 Mo par approche | lu + mesuré (doc T8n) + calculé |
| ST-02 | P1 | `sw.ts:525-594` | Portillon SW unique 25/s pour WMS-R, WMTS et TMS ; e2e sans SW | lu + mesuré (doc T8o) |
| ST-03 | P1 | `earth-tiles.ts:1796-1810`, `:2005-2018` | Repli à 4,9 km publié après 2 échecs, non redemandé ; compteur jamais remis à zéro | lu |
| ST-04 | P1 | `earth-tiles.ts:1768-1779` | Pas de relief national si Terrarium échoue | lu |
| ST-05 | P1 | `earth-tiles.ts:2577`, `:2494-2507` | Pas d'imagerie de jour si la nuit GIBS échoue ; parent sans délai | lu |
| ST-06 | P2 | `earth-tiles.ts:1900-1913`, `:2279-2382` | 3–4 écritures par tuile, mips refaits, une soumission par tuile et couche | lu ; GPU non mesuré |
| ST-07 | P2 | `earth-tiles.ts:1938-2003` | Validité par rectangle | lu |
| ST-08 | P2 | `earth-tiles.ts:1750-1763` | Imagerie sans plafond, délai compté en file | lu |
| ST-09 | P2 | `earth-tiles.ts:548-650`, `:1565-1576` | Calcul IGN sur le fil principal, non compté | lu ; coût estimé |
| ST-10 | P2 | `sw.ts:630`, `:704-711` | Index relu à chaque tuile ; pas de fusion des requêtes | lu ; coût supposé |
| ST-11 | P2 | `earth-tiles.ts:1358-1375`, `streaming-focus.ts:7-14` | Aucun plafond de niveau selon la vitesse ; avance 650 m | lu + calculé |
| ST-12 | P2 | `scenery.ts:193-303`, `scenery-worker.ts:234-239` | Décor monolithique, annulation à gros grain | lu + mesuré (doc) |
| ST-13 | P2 | `scenery.ts:116-118`, `:181-207` | Worker du décor tué au saut, > 12 km, changement de mode | lu |
| ST-14 | P2 | `scenery.ts:416-418` | Recul de 30 s à 5 min après un échec du décor | lu |
| ST-15 | P2 | `main.ts:9740-9763` | Aucun préchargement du lieu de départ | lu |
| ST-16 | P2 | `sw.ts:195-205`, `pwa.ts:123-142` | Assets vidés puis retéléchargés sans cache à chaque version | lu ; volume non mesuré |
| ST-17 | P2 | `rules.ts:22-72`, `moon-tiles.ts:529-608` | Lune/Mars hors cache SW, un seul essai | lu |
| ST-18 | P2 | `zones.ts` (diff), `main.ts:958`, `sw.ts:378-387` | Zones : ST1 non commité, `navigator.onLine`, 404 épinglé, décor recalculé | lu |
| ST-19 | P2 | `earth-tiles.ts:53-57`, `:1290-1301` | ≈ 1 Go de tuiles, jamais rendu | lu + calculé |
| ST-20 | P3 | `earth-tiles.ts:2511-2520`, `:949`, `moon-tiles.ts:355` | Échecs mis en cache, tables non purgées, pas de péremption | lu |
| ST-21 | P3 | `pwa.ts:52-59`, `renderer.ts:11150` | Mesures hors du chemin réel ; pas d'horodatage par tuile | lu |

Aucun P0 : rien dans ce domaine ne perd de données du joueur ni ne bloque le jeu. Les P1 sont des lenteurs majeures ou
des sols faux.

---

## 8. Ce qui est solide

- L'ordre de chargement du relief (anneau autour du point d'avance, le plus fin d'abord) et l'annulation des tuiles
  sorties de fenêtre (`earth-tiles.ts:1437-1469`, `:1511`). Mesuré (doc T8j) : vue à 90 % en 8,1 s contre 26–32 s.
- Le relief Terrarium est dessiné tout de suite, le national par-dessus : pas d'attente du plus lent
  (`earth-tiles.ts:1764-1779`).
- Le décodage des images et les couleurs sont hors du fil principal (`tile-decode-worker.ts`).
- Les fichiers Terrarium et Mapterhorn partagés entre tuiles (`earth-tiles.ts:514-544`, `:759-780`). Mesuré (doc T8n) :
  URL Terrarium redemandées 1 228 → 209.
- Le portillon du SW a des classes, un vieillissement et retire les requêtes abandonnées (`sw.ts:537-578`). Aucun 429
  dans les vols mesurés avec SW (doc T8n, T8o).
- Les ressources GPU remplacées sont détruites après la fin du travail soumis ; un refus de texture (mémoire) retombe
  sur 4 tuiles (`earth-tiles.ts:1144-1163`).
- Le changement de source garde l'ancien sol dessiné jusqu'au remplacement (`stale`, `earth-tiles.ts:1326-1342`).
- Les zones : chaînes avec secours, 404 mémorisés, mise à jour qui garde l'ancien en cas d'échec, tuiles partagées entre
  zones (`sw.ts:298-434`, `rules.ts:200-210`).
- Le worker du décor garde ses réponses réseau et ses plans de toits d'une scène à l'autre (`scenery-worker.ts:115-201`).

## 9. Non vérifié

- Aucun chiffre de ce rapport n'a été remesuré. Les « mesuré (doc) » datent des 2–6 novembre, sur ce Mac ou kerr-mini,
  le plus souvent sans Service Worker.
- Le débit réel de la liaison de Sam et le protocole HTTP de chaque hôte (HTTP/1.1 ou 2) : non relevés.
- La limite réelle du WMTS et du TMS de la Géoplateforme, et l'origine des 429 cités dans `sw.ts:524`.
- L'existence d'un format de grille plus léger à l'IGN, et la couverture LiDAR HD de Mapterhorn en France.
- Le coût réel de `enforceBudget`, des soumissions de mips, et des boucles IGN du fil principal.
- La mémoire réelle (tas JS, GPU) en vol.
- `src/system/earth-surface.ts` (surface régionale), `planet-maps.ts`, `ktx-worker.ts`, `scenery-raster.ts` et les
  parties de calcul de `scenery-worker.ts` (lignes 400–1740) n'ont été que survolés.
- La ligne « onglet caché : cartes et tuiles libérées (`renderer.ts:2146`) » de GRAPHICS-PIPELINE §7 : aucun écouteur
  `visibilitychange` trouvé dans `renderer.ts` ni `main.ts` ; le comportement réel n'a pas été établi.
- Le comportement de `Cache.match` face aux en-têtes `Vary` des hôtes tiers (zones et cache LRU).
- Les e2e `zones-usa-night` et les tests unitaires modifiés du lot ST1 n'ont pas été exécutés.
