# PLAN-J8 — Tous les bâtiments de la vue

**Écrit le 16 novembre 2026 (11:30 UTC) par la session d'analyse, à la demande de Sam.** État : **proposé, prioritaire**. Il passe
avant la suite de J7 (J7-5, J7-6, J7-R) et avant les arbres proches en géométrie, l'ancien candidat J8, qui devient J9.
L'avancement se tient au §8 ; le code fait foi.

> Sam, 16 nov. : « Les buildings, je veux avoir le maximum de buildings dans la vue caméra, pas juste des petits secteurs. […]
> Prépare un plan pour avoir un maximum de bâtiments, quand on l'utilise en PWA, avec le cache et le téléchargement, mais aussi
> dès que c'est possible. […] Au niveau réalisme, c'est ça qui choque le plus en ce moment. »

## 0. Ce que « fait » veut dire

Il y a quatre critères, tous mesurés par un e2e et montrés en captures.

1. **Toute la vue.** Sur la vue de J0 (Toulon-Hyères), chaque bâtiment BD TOPO qui couvre au moins 1 pixel est dessiné comme un
   bâtiment : un volume avec sa hauteur, sa forme de toit et son matériau. Cela vaut de la caméra jusqu'à la limite du pixel,
   environ 15 km pour 10 m et environ 30 km pour 20 m (estimé). Au-delà, le relief des toits mesuré par l'IGN, déjà en place, prend
   le relais sans trou. Le témoin : le nombre de bâtiments dessinés, comparé au recensement des tuiles par anneau de distance.
2. **En vol.** À 140 m/s (J0) puis à 250 m/s, aucun trou devant : les bâtiments à moins de 10 km devant l'appareil sont dessinés
   avant qu'il n'arrive à 5 km d'eux. Le témoin : `parcours-ville`, aujourd'hui « 0 bâtiment devant 5 fois sur 6 ».
3. **Hors ligne, dans une zone téléchargée (PWA).** Après un placement, toute la vue est là en quelques secondes. Le chiffre est
   fixé par la mesure de J8-0. Il n'y a aucune requête réseau et aucun décodage de tuile : les cellules sont déjà préparées.
4. **En ligne, sans zone.** Les cellules arrivent dans l'ordre suivant : vues et proches d'abord, puis sur la trajectoire, puis
   loin. Chacune s'affiche dès qu'elle est prête. La couverture ne recule jamais : une ancienne cellule reste tant que sa
   remplaçante n'est pas publiée.

Le coût GPU est mesuré et montré à Sam avant d'être accepté (§6, question 1). Aucun bâtiment n'est retiré en silence pour tenir
une cadence.

## 1. Pourquoi on en voit si peu aujourd'hui

Source : l'analyse du 16 novembre en lecture seule, sur `fad0da5c`, avec les valeurs principales revérifiées dans le code. Les
mesures citées sont celles des fiches existantes.

| # | Limite | Valeur | Où | Nature |
|---|---|---|---|---|
| 1 | **Le décor est une seule scène refaite en entier, dans un seul worker** | Une scène rapide prend ≈ 12,7 s, une scène complète 24 à 33 s, même avec le cache chaud. Mesuré sur kerr-mini : PROBLEMES l. 382, PLAN-J7 J7-4. | `scenery.ts:265` (un worker, `busy`), `scenery.ts:322` (un seul `writeBuffer`) | architecture |
| 2 | **Le régime rapide en vol** | Au-dessus de 120 m/s : boîte de 2,1 km de rayon, 3 920 bâtiments au plus | `scenery.ts:42` (`QUICK_SHARE` 0,35), `:530` | conséquence de 1 |
| 3 | **Le plafond de bâtiments** | 8 000 × portée², soit 32 000 au repos en « très loin ». À Paris, 32 000 sont gardés et 215 000 à 261 000 coupés (`docs/progress/decor/cut-buildings-trees-2026-11-12.json`). | `scenery-worker.ts:697` | budget fixé le 12/10 pour le traceur (`b0c0065f`), **jamais recalculé pour le raster** (`6340ab5c`) |
| 4 | **Un anneau sans bâtiment** entre le bord de la scène (2,1 à 6 km) et le début des silhouettes lointaines | La fenêtre z 14 couvre 8 tuiles en « très loin » (≈ ±7 km). Les silhouettes ne démarrent qu'à z ≤ 13. | `earth-tiles.ts:68`, `HLOD_Z1` `:664` | choix réglé pour la portée « normale » |
| 5 | **Au-delà, du relief et non des bâtiments** | Hauteur de surface IGN de 14 à 56 m par texel (z 13 à z 11) | `earth-tiles.ts:664-672` | données, correct pour le très loin |

Les murs physiques réels sont ailleurs :

- **La taille du pixel.**
- **La BD TOPO, qui n'existe qu'en tuiles z 15.** Une tuile fait ≈ 0,9 km à 43° N ; il faut la décoder pour connaître ses
  bâtiments.
- **Le débit de la Géoplateforme.** 25 départs/s et 10 en vol, avec des 429 observés (`sw.ts:559-561`).
- **Le budget GPU de kerr-mini**, déjà à ≈ 55 ms pour une cible de 40.

Les limites WebGPU ne bloquent pas :

- `maxStorageBufferBindingSize` vaut 4 Gio − 4 sur Apple.
- Le plafond `SCENERY_RASTER_CAP` vaut 2²⁰ instances par liste, et l'identité de feuille tient sur 20 bits. Ces deux valeurs sont à
  surveiller si une liste dépasse 10⁶.

## 2. Le principe : une couche de bâtiments par cellules, séparée de la scène

On ne refait plus une scène entière pour voir plus loin. Les bâtiments sortent de la scène unique et deviennent une couche
résidente par cellules, comme le prévoit la stratégie au §7.19 : une unité de résidence stable, des enrichissements indépendants,
l'ancienne couverture gardée jusqu'à son remplacement.

- **La cellule est la tuile BD TOPO z 15.** Ailleurs, c'est la tuile de la source (Overture, OSM), ramenée à la même grille.
  - Elle est **préparée une fois** : décodée en enregistrements compacts, au plus 48 octets par bâtiment (centre local, demi-côtés,
    cap, hauteur de gouttière, forme et hauteur du toit, mots de matériau et d'usage, identité stable = cellule + rang).
  - La préparation se fait **dans une réserve de workers**, sans planification de toit ni maillage. Ce travail lourd reste réservé
    au proche.
  - Le résultat est **mis en cache préparé** sous une clé de format versionnée (Cache Storage). Une tuile déjà vue ou téléchargée ne
    se décode plus jamais.
- **Trois représentations selon la distance :**
  1. **Moins de 2 km : le maillage actuel**, avec ses toits par plans, ses parties, ses matériaux et ses ombres. On ne touche pas à
     sa qualité.
  2. **De 2 km à la limite du pixel : une enveloppe en forme de toit**, plat, à deux pans ou à quatre pans d'après
     l'enregistrement. Elle est dessinée par instances depuis une réserve GPU de cellules, triée par le GPU : tri par cellule
     d'abord, puis par bâtiment, avec le champ de vision, la taille projetée d'au moins 1 pixel et le masque de la scène proche
     pour éviter le double dessin. Le dessin est indirect, sans travail CPU par image. Le matériau et l'aspect de nuit (fenêtres)
     passent par `buildingLook`, comme les boîtes d'aujourd'hui.
  3. **Au-delà : le relief des toits IGN (HLOD)**, retiré là où une cellule de bâtiments est résidente, pour ne pas dessiner deux
     fois.
- **La priorité de préparation et de publication** est la même partout, de l'œil au GPU :
  1. dans la vue et proche ;
  2. sur la trajectoire prédite (vitesse, plan de vol : la décision de Sam du 13 nov., « les villes par trajectoire ») ;
  3. une réserve derrière ;
  4. le reste.

  Les files sont bornées en octets et en travail ; la pression se propage vers l'amont (stratégie §7.19).
- **La scène proche ne porte plus que le proche.** Ses bâtiments se limitent à la portée des maillages, soit 2 km. Elle se refait
  donc plus vite, et le régime rapide n'est plus la seule défense en vol.

Ce que le plan réutilise : la BD TOPO et ses attributs (PLAN-BATIMENTS-AAA §3), `buildingLook` et `roofLook`, le tri indirect des
boîtes (`cullBoxes`), le cache de tuiles et les zones du Service Worker, la régulation Géoplateforme, et le relief des toits IGN
pour le très loin.

## 3. Les lots

« Gain » suit la règle 1 de CLAUDE.md. Ce sont des lots de **qualité et de contenu**, pas de performance : leur gain est le nombre
de bâtiments vus, et leur coût GPU se mesure et se déclare.

| Lot | Quoi | Session | Preuve attendue |
|---|---|---|---|
| **J8-0 Mesures** | (a) **Recensement** des bâtiments BD TOPO de la vue J0 par anneau (0–2, 2–5, 5–10, 10–15, 15–30 km), avec nombre de tuiles, octets et bâtiments. (b) **Profil du worker de décor** à chaud, à Toulon et à Paris : quelle part des 12,7 s et des 24 s est du CPU, laquelle est de l'attente réseau, par phase. (c) **Coût GPU par enveloppe** : 32 k, 64 k, 128 k, 256 k et 512 k instances injectées au-dessus de Toulon, en visibilité, ombre et tri, sur kerr-mini et M1 Max, en cadence bornée sur une machine soutenue, avec un témoin positif et un A/A (règle 3). (d) Quel budget bloque à Paris : la mémoire (48 Mio) ou les maillages (16 Mio). (e) `earthScenery.stats()` chaque seconde pendant J0. | (a), (b), (d) : approches · (c), (e) : rendu | une fiche `docs/progress/j8/FICHE-J8-0.md`, ses graphiques dans T3 ; les budgets des lots suivants écrits d'après elle |
| **J8-1 Le trou de 2 à 7 km** (le gain visible le plus rapide) | Les silhouettes lointaines démarrent au bord de la scène et non au bord de la fenêtre z 14, masquées par la boîte de la scène. Il faut revérifier l'ancien piège du cache de relief (+12 ms, ANALYSE-IGN §7). | rendu | captures avant/après de la vue J0 et du vol vers Toulon ; coût mesuré |
| **J8-2 Le contrat de cellule** | Un module pur commun : le format d'enregistrement, l'en-tête (tuile, origine géodésique WGS84, génération, compte), l'identité stable et la version du format. Tests unitaires. Les deux sessions s'y accordent avant J8-3 et J8-4. | rendu (écrit), approches (relit) | `src/system/building-cells.ts` + tests ; BH-API si `__bh` change |
| **J8-3 La préparation des cellules** | Une réserve de workers bornée, le décodage de la BD TOPO z 15 en enregistrements, le cache préparé versionné, la priorité du §2, l'annulation des demandes périmées. Pas de planification de toit. | approches | test : décodage identique au worker actuel sur les mêmes tuiles ; temps par tuile mesuré ; aucune image > 100 ms (sonde J7-0) |
| **J8-4 La couche lointaine** | La réserve GPU de cellules (allocation par blocs, budget en octets déclaré), le tri par le GPU (cellule puis bâtiment, pixel ≥ 1, masque du proche), le dessin indirect des enveloppes, `buildingLook` jour et nuit, le retrait du relief des toits sous les cellules résidentes, un fondu par cellule. Noyaux de tri petits (leçon Apple). | rendu | e2e `batiments-vue` : dessinés / recensés par anneau sur la vue J0 ; captures jour et nuit ; coût par passe ; GRAPHICS-PIPELINE mis à jour |
| **J8-5 La scène proche allégée** | La scène ne porte plus de bâtiments au-delà de 2 km. Les plans de toit et les maillages sont mis en cache par tuile, persistants, pour qu'une scène refaite ne refasse pas ce qui est déjà fait. Le régime rapide est revu. | rendu (`scenery*.ts`), approches (le cache) | `parcours-ville` à 150 puis 250 m/s : bâtiments devant avant 5 km ; durée d'une scène avant/après |
| **J8-6 La PWA** | Une zone téléchargée contient aussi les cellules préparées : hors ligne, aucun décodage. Réglages › Hors ligne donne le compte et la taille. En ligne, la publication est progressive. | approches (`zones.ts`, `sw.ts`, UI FR + EN) | e2e hors ligne : placement dans la zone, réseau coupé, toute la vue en N s ; MENUS / docs à jour |
| **J8-7 Hors de France** | Overture (PMTiles) et OSM dans les mêmes enregistrements, puis la même couche. | approches | captures à Tarifa et Bruxelles ; recensement contre dessinés |
| **J8-8 Le proche en cellules** (décision après J8-5) | Maillages, contacts (`SceneryContact`) et ombres par cellule, avec identité stable. Il n'y a plus de scène refaite pour les bâtiments. Grand lot : il ne s'ouvre que si J8-5 laisse un trou mesuré. | rendu | idem J8-5, sans régime rapide |
| **J8-R Retraits** (règle 2) | Le plafond 8 000 × portée² des bâtiments, les boîtes au-delà de 2 km dans la scène, les budgets rapides des bâtiments, le chemin de silhouettes remplacé : retirés au lot qui suit leur remplacement, avec une date. | les deux | `git grep` vide ; docs |

**Ordre :** J8-0 et J8-1 en parallèle, puis J8-2, puis J8-3 et J8-4 en parallèle, puis J8-5, J8-6, J8-7, J8-8 si nécessaire, et
J8-R. J8-1 se voit tout de suite. J8-4 apporte le gros du gain : « toute la vue ».

## 4. Répartition et règles du checkout partagé

- **La session du rendu (33d89754)** termine et commite J7-8b (la musique, en cours dans l'arbre), puis met en pause le reste de
  J7. Elle possède `scenery.ts`, `scenery-worker.ts`, `scenery-raster.ts`, `scenery-data.ts`, `renderer.ts`, `earth-tiles.ts`, les
  shaders et GRAPHICS-PIPELINE.
- **La session des approches (1feb2f7f)** termine et commite sa mesure GCAS en cours, puis met en pause ses autres lignes ouvertes.
  - Elle travaille dans des **modules nouveaux** : la réserve de workers, le décodage et le cache des cellules.
  - Elle possède aussi `zones.ts`, `sw.ts` et l'UI hors ligne.
  - Elle ne modifie pas les fichiers du rendu. Une API qui lui manque se demande à la session du rendu.
- `bdtopo.ts`, `scenery-sources.ts` et le nouveau `building-cells.ts` sont communs : de petits commits ciblés, avec une annonce
  dans le journal.
- **Tuiles IGN : une seule charge lourde à la fois sur les deux Mac** (même adresse IP, 429). Le recensement J8-0 (a) télécharge
  une fois et garde les tuiles en local hors du dépôt ; les e2e qui ne mesurent pas le réseau rejouent depuis le cache ou une
  zone.
- Les e2e suivent E2E.md et E2E-VOLS : bandeau obligatoire, scénario en cours, règle 13 pour tout vol, attentes bornées, captures
  analysées et montrées dans T3.

## 5. Risques

| Risque | Parade |
|---|---|
| Le coût GPU sur kerr-mini, déjà au-dessus de 40 ms | J8-0 (c) le mesure avant J8-4. Le tri au pixel près et par cellule borne le nombre dessiné. Le chiffre va à Sam (§6, question 1). |
| Un double dessin aux raccords (scène proche, couche lointaine, relief des toits) | Un seul masque par cellule, publié avec la génération de la scène ; des captures de raccord en vol. |
| Des bâtiments qui « poppent » à l'arrivée d'une cellule | Un fondu par cellule ; l'ancienne gardée jusqu'à la publication. |
| Le débit IGN et les 429 | La priorité par la vue ; le cache préparé ; les zones ; une seule charge IGN à la fois. |
| Les conflits du checkout partagé | La propriété des fichiers du §4 ; le contrat J8-2 d'abord. |
| La mémoire | Le budget de la réserve déclaré en octets. Ordre de grandeur : 500 000 × 48 o ≈ 24 Mio, estimé. |

## 6. Questions à Sam (recommandations entre parenthèses ; le plan avance dessus sauf avis contraire)

1. **Le coût GPU de la couche lointaine** : (même contenu sur les deux machines, conformément aux décisions du 15 nov. sans
   compromis d'image ; si J8-0 (c) montre plus de 3 ms sur le mini pour la vue J0, retour à Sam avec les chiffres avant J8-4).
2. **La portée** : (le critère du pixel, ≥ 1 px, plutôt qu'une distance fixe ; le relief des toits au-delà).
3. **La priorité** : (J7 en pause après J7-8b ; les arbres proches en géométrie deviennent J9 ; les lignes ouvertes de la session des
   approches en pause après sa mesure GCAS).
4. **Une préparation côté serveur** (le serveur de Sam, D13) : (pas maintenant ; la préparation dans le client et le cache d'abord,
   à revoir si J8-0 (b) montre que le décodage domine).

## 7. Ce qui reste hors de ce plan

- Les intérieurs et les façades détaillées.
- Les bâtiments 3D texturés (photogrammétrie).
- Les arbres proches en géométrie (J9).
- L'eau et les noyaux de J7-6.

## 8. Avancement

| Lot | État | Commit | Preuve |
|---|---|---|---|
| J8-0 | à faire | | |
| J8-1 | à faire | | |
| J8-2 | à faire | | |
| J8-3 | à faire | | |
| J8-4 | à faire | | |
| J8-5 | à faire | | |
| J8-6 | à faire | | |
| J8-7 | à faire | | |
| J8-8 | à décider après J8-5 | | |
| J8-R | à faire | | |
