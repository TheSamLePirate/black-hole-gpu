# PLAN-J7 — La fluidité, le sol des approches, puis les 40 ms du mini

**État (2026-11-16 05:45 UTC)** : **écrit par la session d'analyse**, **révisé après la fiche de J7-0** (J7-7 à J7-9 ajoutés, J7-2 et J7-3 rejoués à froid d'abord), à la demande de Sam (16 nov., ~00:00 UTC : la session du rendu attend
ce plan ; J0 à J6 fermés, aucun PLAN-J7). J7-0 fait, J7-1 en cours (§6). Les questions du §4 sont réglées provisoirement selon les recommandations,
révisables par Sam ; J7-0 à J7-5 n'en dépendent pas. Le code fait foi : chaque lot relit l'état du dépôt avant d'appliquer un diagnostic
cité ici.

Destination ([ANALYSE-STRATEGIE](ANALYSE-STRATEGIE-RENDU-2026-11-03.md)) : §19.8 (chargement, perte, reprise : un seul cycle), §19.4 (le sol,
service du monde, avec un contrat de contact), §7.19 (streaming progressif et continuité de service), §8 (la cadence). Les trois règles de
méthode (CLAUDE.md) s'appliquent : le gain maximal lu avant un lot de performance ; l'ancien chemin d'un levier allumé retiré au lot de
retrait ; une sonde neuve passée par ses témoins positif et négatif.

## 1. Le point de départ

**Ce qui est fait.** J0 à J6 menés (PLAN-J1 à PLAN-J6). Les neuf parcours de §19.13 ont chacun leur e2e ; sept défauts corrigés en route.
PLAN-APPROCHES mené (AP0–AP10, AP-R). Décisions de Sam du 15 nov. appliquées : J3-R, le repli tracé retiré sur la Terre, la borne du
M1 Max réessayée à 40 (non tenue, 30 gardé), le plancher du raster sur GPU faible proposé (pas imposé).

**Les chiffres** (kerr-mini, J0 en vol) : ~48 ms de GPU p50 en journée (le palier intermédiaire nommé par Sam, 15 nov.) ; **44,8 ms p50,
49,8 p95** la nuit du 16 nov. (banc de nuit, f2985d54, une seule nuit automatique). La cible du mini reste 40 ms (25 images/s
régulières). Sam a refusé les arbitrages d'image (MSAA 1× de l'appareil, petits arbres, nuages amortis) : **aucune voie sans perte
d'image au-dessus de 1 ms n'était connue le 15 nov.** (PLAN-J5 §5 ; bilan du 15 nov. 14:52 UTC). Les plus gros postes de J0 au beau temps :
les nuages 6,3 ms, l'appareil 5,3 (coque 3,9), l'eau 5,0.

**Ce que J6 et les approches ont relevé sans le corriger** — ce qui gêne le joueur aujourd'hui plus que 5 ms de GPU :

| Relevé | Mesuré | Source |
|---|---|---|
| L'image bloquée à l'arrivée d'une météo réelle : le noyau de la météo compilé à ce moment | **84 à 433 ms** selon le passage | PLAN-J6 J6-2 |
| Le retour à bord par F1 après la caméra libre | **317 ms** bloqués | PLAN-J6 J6-5 |
| Le détail procédural du relief sous la finale d'OIFK 11 : le sol de collision 75 à 205 m au-dessus des données (plates), le FLARE à 4,0–4,6 km du seuil | l'A320 jamais posé | [PROBLEMES](PROBLEMES-A-REGLER.md), OIFK ; demandé par la session des approches |
| Une vitesse verticale résiduelle au sol après le roulage | −0,29 m/s (le symptôme corrigé par J6-3, la cause non) | PLAN-J6 J6-3 |
| La pastille « Compiling the ray tracer for this scene » figée sur une scène convergée | ≥ 60 s | PROBLEMES (cause lue : `noteSceneTracer`, `renderer.ts`) |
| Deux tests de `gpu-startup` (LUT de qualité, noyau adaptatif en échec) | rouges en 30 s, deux passages | PROBLEMES |
| Le bouton de la couche météo de la carte sous la carte | clic réel refusé | PROBLEMES (`weather-panel`) |

Le zonage qui aplanit déjà le détail : `game/sites.ts` `runwayGrade` (la piste, sa largeur + 80 m pour une piste du monde, **3 km avant chaque
seuil** puis fondu sur 300 m) lu par `terrain.ts` `earthHeightSampler` (`flat`) — OIFK rebondit à 4,0–4,6 km, au-delà de cette zone.
L'anticipation des compilations existe déjà (`prewarmKeys`, `prewarmEarthFlight`, `prewarmNear` pour les voyages, `renderer.ts` ~6930–6995) :
la météo n'y passe pas.

## 2. Les lots

| Lot | Contenu | Plafond lu (règle 1) | Fini quand | Taille |
|---|---|---|---|---|
| **J7-0** | **Le relevé des à-coups.** Une sonde des images bloquées (écarts rAF > 50 et > 100 ms, leur cause : compilation, tuile, sauvegarde, GC, changement de vue — par les étapes déjà tracées), passée par ses témoins (positif : une attente injectée de 200 ms vue ; négatif : un vol tenu A/A sans écart), puis jouée sur les e2e de parcours de J6. Une fiche : chaque à-coup, sa durée, sa cause, son parcours | qualité (aucun gain de cadence promis) | la fiche écrite, chaque à-coup > 100 ms attribué | S |
| **J7-1** | **Le sol des approches.** Le détail procédural aplani sous la trouée d'approche de chaque extrémité de piste du monde (pas les données) : de 3 km jusqu'à la FAF de l'approche choisie ou 10 km, en cône (largeur de la piste + 80 m au seuil → ±300 m à 10 km), fondu de 300 m ; **le même zonage pour la collision, le raster et le tracé** (un seul `runwayGrade`, son pendant WGSL). Aucun autre relief changé | — (contact, §19.4) | `approach-sample` A320 posé à OIFK 11 ; le sol de collision = le sol dessiné (la sonde de contact de J6) ; planche avant/après sous une finale en montagne (aucune marche visible) ; `bun scripts/pipeline-inventory.ts --check` | M |
| **J7-2** | **La météo à son arrivée — rejouée à froid d'abord** (révisé le 16 nov. 05:45 après la fiche de J7-0 : aucun écart > 100 ms sur un passage chaud). `parcours-meteo` rejoué le cache de shaders du mini vidé, avec la sonde ; **non reproduit → fermé** (« non reproduit à froid », PLAN-J6 annoté) ; reproduit → le noyau de la météo ajouté aux clés compilées d'avance dès que la météo réelle est demandée, l'ancien gardé jusqu'au nouveau prêt, le fondu de 20 s inchangé | ~0 sur un passage chaud ; 84–433 ms si reproduit à froid | rejoué à froid ; fermé ou aucune image > 100 ms à l'arrivée de la météo | S (M si reproduit) |
| **J7-3** | **Le retour par F1 — rejoué à froid d'abord** (même révision : 83 ms au plus sur la fiche). `parcours-camera` à froid, avec la sonde ; non reproduit → fermé ; reproduit → sa cause corrigée ou anticipée | ~0 sur un passage chaud ; 317 ms si reproduit | rejoué à froid ; fermé ou < 50 ms | S |
| **J7-4** | **La santé.** La pastille de compilation fermée quand l'image converge (`noteSceneTracer`) ; les deux tests de `gpu-startup` rejoués sur une révision antérieure puis réparés (le jeu ou le test, selon la cause) ; le bouton de la couche météo de la carte cliquable ; **`parcours-ville` rouge sur ses bâtiments proches à l'arrivée (0, fiche de J7-0)** : le défaut « le décor ne suit pas un vol rapide » est marqué corrigé (J6-1, 36–38 bâtiments) — un rouge n'est pas une « variance connue » tant qu'il n'est pas expliqué : le rejouer trois fois, attribuer (le jeu ou le test), corriger | — | `a320-deck` sans la pastille figée ; `gpu-startup` vert ; `weather-panel` vert ; `parcours-ville` 3/3 ou sa cause écrite | S |
| **J7-5** | **Le repos au sol à la source.** La cause de la vitesse verticale résiduelle de −0,29 m/s après le roulage (l'intégration du roulage soupçonnée, J6-3) ; le repos tenu sans le juge du plan du sol comme seul rempart | — (contact) | `parcours-debarquer` : vitesse verticale au repos < 0,01 m/s, sans glissement ; VOL-AVIONS si le modèle change | S–M |
| **J7-6** | **Les 40 ms du mini** (selon la question 1). D'abord la fiche des plafonds sur le code d'aujourd'hui (J0 de jour, répétée, contre la nuit à 44,8 : l'écart jour/nuit expliqué — chaleur, réseau, version) ; puis seulement les lots dont le plafond dépasse 1 ms **sans changer l'image** ; les seuils p99 et CPU du mini fixés à cette reprise (décision de Sam du 15 nov.) | à lire dans la fiche ; le 15 nov. aucun > 1 ms connu | la fiche écrite et lue à Sam ; chaque lot ouvert avec son plafond ; J0-CONTRAT §2 (seuils) | M–L |
| **J7-7** | **Le premier noyau de la partie et le changement d'appareil** (ajouté le 16 nov. après J7-0 : le plus gros à-coup, dans chaque parcours). 433–784 ms de thread principal ~1,6 s après la prise en main (« compile started »), ~200 ms à chaque changement d'appareil. D'abord un profil CPU qui dit la part synchrone (création du module, du pipeline, des bind groups) ; puis la sortir du moment où l'image est attendue : faite sous le voile de chargement, avant la prise en main, ou en asynchrone (`create*PipelineAsync`) ; l'appareil compilé dès son choix ou derrière sa transition. Les cas à froid de J7-2/J7-3 mesurés dans la même séance | 433–784 ms par partie, ~200 ms par changement d'appareil | aucune image > 100 ms dans les 5 s après la prise en main ni au changement d'appareil (sonde, trois parcours, à froid et à chaud) ; GRAPHICS-PIPELINE (parcours joueur) | M |
| **J7-8** | **Le début du vol : 150–217 ms de thread principal avec ~300 tuiles d'un coup** (272 → 592 ; quatre parcours). Le budget des tuiles de 2 ms par image (lot « pointes » de J2) existe : trouver ce qui le contourne à cet instant (publication, halo, une file vidée d'un bloc, la mise en route des workers) et l'y ramener | 150–217 ms une fois par vol | aucune image > 100 ms au début du vol sur les quatre parcours ; PROBLEMES « pointes » mis à jour | S–M |
| **J7-9** | **L'arrivée des données après un placement : des images GPU de 150 à 290 ms pendant des secondes** (`parcours-gpu` 97 écarts sur 20 s ; `parcours-camera` 18). D'abord les passes GPU de ces images (le profileur sur la fenêtre de l'arrivée) : envois de tuiles, niveaux du raster refaits, cuisson du cache de relief ; puis un budget GPU de l'arrivée par image (étaler, plafonner les cuissons), la couverture gardée jusqu'au remplacement (CLAUDE.md, « préparer les données avant la frame »). Le chargement d'une sauvegarde (417 puis 184/282 ms) relu dans le même lot : le même mécanisme ou non | jusqu'à ~100 écarts par placement | les passes de ces images écrites dans la fiche ; puis aucune image GPU > 100 ms après un placement sur `parcours-gpu` et `parcours-camera`, l'image finale la même | M–L |
| **J7-R** | **Les retraits.** Chaque levier allumé par un lot de J7 perd son ancien chemin ; seuls les leviers de mesure restent | — | BH-API, GRAPHICS-PIPELINE, E2E-CATALOGUE à jour | S |

**Ordre recommandé (révisé le 16 nov. 05:45 UTC, après la fiche de J7-0)** : J7-0 (fait) → J7-1 (en cours) → **J7-7** → J7-2 et J7-3 à
froid (dans la séance de J7-7, même cache vidé) → **J7-8** → **J7-9** → J7-4 → J7-5 → J7-6 → J7-R. Les à-coups mesurés passent avant ceux qui
ne se reproduisent pas : le premier noyau touche chaque partie ; le début du vol, chaque vol ; l'arrivée des données, chaque placement.
J7-4 et J7-5 peuvent se glisser entre deux lots longs. Hors du plan : `parcours-orbite` compte ses propres tranches de `__bh.step` (~600 ms
d'un bloc) — à exclure de la sonde dans ce test (une ligne de test, pas un lot) ; les pertes du GPU injectées (500–584 ms) sont attendues.

## 3. Ce que J7 ne fait pas

- **Aucun arbitrage d'image** : refusés par Sam le 15 nov. (MSAA, petits arbres, nuages amortis, houle à demi-résolution).
- **Pas le profil lourd** (l'orage à 78 ms sur le mini) : son découpage (J5-1, présence ~2,7 ms) reste rangé tant que l'orage n'est pas une cible.
- **Pas la marche en raster** : elle attend les arbres proches en géométrie (J5-3a : 59 ms des arbres proches dans le noyau des restes à
  pied) — un lot d'assets et de rendu, proposé comme jalon suivant (question 2).
- **Pas la borne du M1 Max** : 40 essayé et non tenu (15 nov.) ; 30 gardé.

## 4. Questions pour Sam

1. **Les 40 ms du mini dans J7 ?** Recommandation : **oui, en dernier (J7-6)**, d'abord comme une fiche des plafonds sur le code d'aujourd'hui,
   puis seulement des lots sans perte d'image au-dessus de 1 ms ; les seuils p99/CPU du mini fixés à ce moment, comme tu l'as décidé. Si la
   fiche ne montre aucun levier, le dire et garder le palier de ~48 ms (la nuit montre 44,8).
2. **Le jalon suivant : les arbres proches en géométrie** (maillages ou cartes à alpha, LOD par la chaîne d'assets — §18 meshoptimizer), qui
   ouvre la marche en raster et allège le noyau des restes ? Recommandation : **oui, comme PLAN-J8 après J7**, écrit à la fermeture de J7.
3. **L'aplanissement sous les trouées (J7-1)** : seul le détail inventé est retiré (pas les données), jusqu'à la FAF ou 10 km, en cône
   jusqu'à ±300 m. Recommandation : **ce réglage**, révisable sur la planche avant/après en montagne. Il prolonge ta décision du 16 nov. (les
   approches jugées sur les données seules) à ce que le joueur touche.

**Réglées provisoirement (2026-11-16 05:05 UTC), selon les recommandations — révisables par Sam.**

## 5. Non vérifié

Ce plan est écrit depuis la lecture du journal, des plans J4–J6, de PROBLEMES-A-REGLER et du code (`terrain.ts` `earthHeightSampler`,
`game/sites.ts` `runwayGrade`, `renderer.ts` `prewarm*`). Aucun test, e2e ni mesure n'a été lancé pour l'écrire. Les plafonds cités viennent
des entrées datées ; les causes des à-coups (compilation de la météo, retour par F1) sont celles relevées par J6, non rétablies ici.

## 6. Avancement

- **Le plan** (2026-11-16 05:05 UTC) : écrit par la session d'analyse ; aucun lot ouvert.
- **J7-0, la sonde et ses témoins** (2026-11-16 05:08 UTC) : `tests/e2e/lib/hitch-probe.ts` — chaque écart rAF > 50 ms et sa cause, lue
  par l'état avant/après (compilation `compileLog`/`compilingNow`, tâche longue du thread principal `longtask`, tas JS en baisse, tuiles,
  journal du jeu, vue, appareil, taille, appareil GPU, temps GPU), jugée 300 ms après et sortie par `console.debug` ; `E2E_HITCH=1` la met dans
  chaque page démarrée (`lib/app.ts`), `remote-results/hitches/<test>.jsonl` (E2E.md). **Témoins passés** (kerr-mini, run
  `20261116-060710-hitch-probe`) : positif — 200 ms injectées vues en un écart de 200 ms, « main thread 200 ms » ; négatif (A/A, vol tenu
  20 s deux fois) — 1 117 et 1 143 images, aucun > 100 ms, 1 et 0 > 50 ms. **J7-0 fait** (05:31 UTC) : [la fiche des à-coups](progress/j7/FICHE-A-COUPS-2026-11-16.md),
  les neuf parcours (run `20261116-060822-j7-hitches`, 12/13 — `parcours-ville` rouge sur ses bâtiments proches, variance connue), chaque
  écart > 100 ms attribué (les « inconnus » par leur contexte : la perte injectée, la suite d'un chargement, le mode photo — la sonde lit
  depuis le mode et le rendu hors ligne —, les tranches de pas du test de l'orbite). **Ce qu'elle dit au plan** : les à-coups de J7-2
  (météo) et J7-3 (F1) **ne se reproduisent pas** sur ce passage (aucun > 100 ms ; 83 ms au plus au retour par F1) — à rejouer à froid
  avant de les ouvrir ; les plus gros vus sont ailleurs : le premier noyau de la scène (433–784 ms de thread principal au début de chaque
  partie) et le changement d'appareil (~200 ms), l'arrivée des données après un placement (images GPU de 150–290 ms des secondes durant),
  le début du vol (150–217 ms), le chargement d'une sauvegarde (417 ms) — proposés à la session d'analyse.
- **J7-1, lecture du code avant de l'ouvrir** (2026-11-16 05:10 UTC, session du rendu ; rien changé) — `runwayGrade().x` (le « flat ») a
  quatre lecteurs qui n'ont pas le même coût, d'où : **le couloir d'approche ne doit pas entrer dans `.x`**, mais dans une composante à part,
  lue seulement là où le détail est ajouté :
  1. `trace.wgsl` `earthHeightExactG` / `earthHeightStepG` : le détail × (1 − flat) — le couloir y entre (et `terrain.ts`
     `earthHeightSampler`, la collision, par `sites.ts` `runwayGrade`).
  2. `earthHeightG` contourne le cache naturel du relief (cuit **sans** pistes, `terrainHeightLibrary(trace)`) là où `.x > 0` : le cache
     porte le détail, donc le contournement doit couvrir aussi le couloir (coût : la hauteur exacte du tracé dans le couloir).
  3. le raster : `vertexGraded` (`.x > 0`) fait passer chaque sommet par la hauteur exacte, sans normale — le chemin lent, à garder à la
     piste ; ses niveaux sont cuits **avec** les pistes (`terrainHeightLibrary(trace, true)`) : le couloir y entre par (1) sans autre code.
  4. **le décor** (`scenery-worker.ts` ~l. 418) pose arbres et bâtiments sur le relief + détail **sans aucun aplanissement de piste** : sous
     un couloir de 10 km, un arbre resterait sur la bosse inventée (+75 à +205 m à OIFK) — il faut lui passer les pistes proches (leur
     repère) et le même calcul, d'où un module pur commun (le calcul de `runwayGrade`, sans l'état de `sites.ts`).
  La portée : `runwaysNear` et les deux `runwayGrade` coupent à `len + 3 400 m` — à porter à `len + 10 000 + fondu`.
- **J7-1 fait** (11/16 06:01 UTC) — `src/game/runway-grade.ts` (pur : `gradeAt`, `approachCut`, `GRADE_REACH`) : le
  calcul du zonage, commun à la collision (`sites.ts` `runwayGrade` → `terrain.ts`), au décor (`scenery-worker.ts` : ses pieds sur le sol
  aplani et nivelé — il ignorait toute pente de piste) et, par son pendant, au WGSL (`trace.wgsl` `runwayGrade` → `vec4f`, `w` la part du
  détail retirée, `approachCut`). Le couloir de chaque extrémité de piste d'un aérodrome réel (drapeau 16 : les sites et les pistes du
  monde) : largeur + 80 m au seuil → ±300 m à 10 km, fondu 300 m (smoothstep) ; la FAF de l'approche choisie non lue (10 km toujours).
  Il n'entre que là où le détail est ajouté : `.x` (le chemin lent des sommets du raster, le cache) inchangé ; le tracé contourne son cache
  naturel où `w > 0`. **Vérifié** : `runway-parity` 5/5 (dont le couloir), 162 tests unitaires, `check-wgsl` 84/84 ; parité GPU du zonage
  (`ellipsoid` 1er test, le couloir compris) ; **A320 posé à OIFK 11** (run `20261116-061434-j71-oifk`) ; planche
  (`j7-approach-ground`, A/B 23ea4135, run `20261116-063833-j71-board2`) : l'axe 3–9,5 km à 3,0 m d'une droite (bosses jusqu'à +194 m
  avant), le fond du couloir 0,1 m, le sol hors du couloir identique (0,0 m) ; **les flancs du couloir** dans une crête inventée de ~200 m :
  jusqu'à 45 m pour 50 m (le fondu de 300 m — q. 3, révisable sur cette planche) ; J0 (A B B A, kerr-mini) : GPU p50 49,6 / 49,3 avant,
  49,3 après — aucun coût vu (un run B sans mesure : le décor bloqué 60 s à l'étape forêt, à surveiller). Le second test d'`ellipsoid`
  expire aussi avant J7-1 (PROBLEMES).
- **J7-7, premier pas** (11/16 06:18 UTC) — profil CPU du rechargement et du changement d'appareil (e2e
  `j7-first-kernel`, kerr-mini, bundle non minifié, runs `…-j77-profile`, `-profile2`, `-profile3`) : **la prise en main n'est pas où la
  sonde la croyait** — `camera.piloting` vrai à 1,0 s, la première image à 2,1 s, **l'écran de chargement levé à 5,2–5,5 s** ; les 263–383 ms
  du premier noyau et les collections de 325–360 Mo tombent **sous l'écran de chargement** (animé par son worker) ; **dans les 5 s après qu'il
  se lève : aucune image > 100 ms**, trois passages (à chaud). **Au changement d'appareil** (Ranger → F-35, avec la mise en place au
  Bourget) : 2 × ~110 ms de `wgslFunctions` (la bibliothèque de hauteurs du raster découpée dans `trace.wgsl` : une recherche par
  fonction depuis le début, quadratique) et ~105 ms de `TriBVH.build` (la coque du F-35) sur le thread principal. **Corrigé** :
  `wgslFunctions` en un passage, en cache par source (`wgsl-library.ts`, parité testée sur les 709 fonctions) ; les arbres des coques
  construits dans un worker (`system/bvh-worker.ts`, `bvh-client.ts` — devenus `cpu-worker.ts`/`cpu-client.ts` —, repli sur place ; `TriBVH.parts`/`fromParts`, parité testée ;
  `server.ts`, `build-pages.ts`). **Mesuré** : au changement, écarts > 100 ms **217, 250, 117, 182 ms → 117, 117, 116 ms** ; les deux
  fonctions absentes du profil. **Reste** : ~116 ms de travail natif au démarrage d'une compilation (la création des modules — compté
  « (program) »), une collection, un `writeTexture` de 67 ms (une couverture d'imagerie) ; le rejeu à froid (J7-2/J7-3 avec), le critère
  sur trois parcours.
- **J7-7, deuxième pas** (11/16 07:43 UTC) — le profil compte aussi le travail natif (`FK_PROGRAM=1`) : au changement
  d'appareil (Ranger → F-35, **avec sa mise en place au Bourget** : la clé de la scène change, ses noyaux recompilés), le spectre de la mer
  recalculé sur le thread principal (`seaCascades`, 44 ms — aussi à chaque nouvel état de la mer : l'arrivée de la météo), la préparation des
  glyphes de l'écran du F-35 (`pcd.warm`, 24 tailles d'un coup, 47 ms). **Corrigé** : un worker de calcul générique (`cpu-worker.ts` —
  les arbres des coques et le spectre de la mer ; `cpu-client.ts`, repli sur place), le spectre toujours calculé là-bas (la mer d'avant
  gardée jusqu'au nouveau ; la première fois, ses vagues quelques images plus tard), `pcd.warm` une taille par tâche. **Mesuré**
  (kerr-mini, à chaud) : au changement, écarts > 100 ms **217/250/117/182 → 183/133 ms** — restent une collection de ~1 Go (les données
  du lieu quitté) et l'arrivée des tuiles, **soit la mise en place : renvoyée à J7-9** ; `sea-fft` 5/5. Le démarrage : aucune image > 100 ms
  dans les 5 s après l'écran de chargement (quatre passages). **Non fait** : à froid, trois parcours (le critère du lot) — après J7-9.
- **J7-2 et J7-3 rejoués à froid** (11/16 07:11 UTC, run `20261116-072108-j7-cold`, cache Metal du mini vidé avant chaque
  passage) : **reproduits** — la météo 499 ms à froid / 350 ms à chaud (une image GPU de 401 ms et une collection de 635 Mo, pas la
  compilation de son noyau), le retour par F1 650 ms à froid (le noyau principal recompilé) / 250 ms à chaud (l'image du retour) ; détail
  dans la [fiche](progress/j7/FICHE-A-COUPS-2026-11-16.md) §4. Leurs lots restent ouverts, leurs causes relues.
- **J7-8, le début du vol** (11/16 09:31 UTC) — profil CPU du placement du F-35 au-dessus de Hyères (e2e
  `j7-first-kernel`, `FK_CASE=flight-start`, kerr-mini, travail natif compté) : **ce ne sont pas les tuiles** (leur arrivée coïncide). Le
  thread principal y fait : **la musique** — son thème lancé à « IN FLIGHT » : la réverbération (`impulseResponse`, ~40 ms) et la synthèse de
  ses notes (`prepareNote`/`rendered`/`partials`, 25–60 ms par note de cuivre, sur ~1,5 s ; le travail en temps libre forcé par
  `timeout: 1000` et une note qui déborde son budget) ; **les images du trafic** (`loadTrafficMaps` : 12 niveaux de MIP par image
  redimensionnés sur le thread principal, `createImageBitmap` 115 ms + copies 35 ms) ; une collection (~100 ms) ; la mer de l'avion (30 ms).
  **Corrigé** : les MIP des images du trafic faits dans le worker de calcul (`cpu-worker.ts` tâche `mips`, `imageMipsOff`), les copies une
  image par tâche ; `traffic-ships` 3/3. **Mesuré** : au début du vol, écarts > 100 ms **183/150 → 182 ms** (un seul, le thread principal
  118 ms : la musique). **Reste** : la synthèse de la musique — un chantier du domaine audio (ses notes rendues dans un worker, la
  réverbération préparée d'avance), proposé à la session d'analyse.
- **J7-3 et J7-2 relus de près** (11/16 09:22 UTC, [fiche §5](progress/j7/FICHE-A-COUPS-2026-11-16.md)) : le retour par F1 ne
  change aucune clé (e2e `j7-f1-return` : à froid aucune image > 100 ms, à chaud une de 116 ms) — les 650 ms de §4 n'étaient pas lui ;
  l'arrivée de la météo (e2e `j7-weather-arrival`) : 399 ms une fois (la nouvelle clé, ~30 pipelines sortis du cache), puis quatre
  passages sans image > 100 ms, la part synchrone des départs ~0 ms ; un rythme des départs essayé, sans effet mesuré, retiré.
  **Intermittents, sans cause unique lue** : à décider avec la session d'analyse (les fermer « non reproduit à cause établie » ou les
  surveiller par la sonde dans les parcours).
- **J7-1, le couloir prolongé à 18,5 km** (décision de Sam, 11/16 ~07:05 UTC, sur la mesure de la session des approches —
  `scripts/approach-detail-beyond.ts`, f0e0a431 : entre 10 et 18,5 km le détail dépasse les données de plus de 300 m pour 4 485 extrémités,
  jusqu'à +700 m sur l'Altiplano) : le cône continué au même évasement (~±460 m à 18,5 km), fondu 300 m ; `runway-grade.ts`
  `APPROACH_FUNNEL.reach` 18 500, `GRADE_REACH` 19 655 ; WGSL de même ; `__bh.sys.groundBareAt` (le sol sans le détail) ; e2e de la
  planche paramétrée (`AG_FIELD`, `AG_RWY`) et jugée sur « sol touché = sol des données » de 3 à 18,2 km. Vérifié (OIFK 11, SLCB 05 : 0,0 m ; +770 m retirés à SLCB), 8b683069.
- **Le plan révisé** (2026-11-16 05:45 UTC, session d'analyse, sur la fiche de J7-0 — [FICHE-A-COUPS](progress/j7/FICHE-A-COUPS-2026-11-16.md)) : J7-2 (météo) et J7-3 (F1) non reproduits à chaud → rejoués à froid d'abord, fermés s'ils ne se reproduisent pas ; trois lots ajoutés sur les à-coups mesurés : **J7-7** le premier noyau de la partie et le changement d'appareil (433–784 ms, ~200 ms), **J7-8** le début du vol (150–217 ms, ~300 tuiles), **J7-9** l'arrivée des données après un placement (images GPU de 150–290 ms, avec le chargement d'une sauvegarde) ; `parcours-ville` rouge mis dans J7-4 (à expliquer, pas « variance ») ; l'ordre révisé au §2.
