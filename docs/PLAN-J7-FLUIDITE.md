# PLAN-J7 — La fluidité, le sol des approches, puis les 40 ms du mini

**État (2026-11-16 05:05 UTC)** : **écrit par la session d'analyse**, à la demande de Sam (16 nov., ~00:00 UTC : la session du rendu attend
ce plan ; J0 à J6 fermés, aucun PLAN-J7). Aucun lot ouvert. Les questions du §4 sont réglées provisoirement selon les recommandations,
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
| **J7-2** | **La météo compilée avant son arrivée.** Le noyau de la météo ajouté aux clés compilées d'avance dès que la météo réelle est demandée (ou dès le lancement en vol si elle est allumée) ; l'ancien noyau gardé à l'écran jusqu'au nouveau prêt ; le fondu de 20 s inchangé | 84–433 ms d'image bloquée → 0 | `parcours-meteo` sans image > 100 ms à l'arrivée de la météo (la sonde de J7-0) ; fondu 20 s gardé ; GRAPHICS-PIPELINE (parcours joueur, compilations) | M |
| **J7-3** | **Le retour par F1 sans blocage.** Sa cause lue par la sonde (clé de noyau, recréation de cible, réinitialisation de la caméra, historique) ; la corriger ou l'anticiper | 317 ms → < 50 | `parcours-camera` sans image > 100 ms au retour ; l'état simulé et les maintiens gardés (assertions existantes) | S–M |
| **J7-4** | **La santé.** La pastille de compilation fermée quand l'image converge (`noteSceneTracer`) ; les deux tests de `gpu-startup` rejoués sur une révision antérieure puis réparés (le jeu ou le test, selon la cause) ; le bouton de la couche météo de la carte cliquable | — | `a320-deck` sans la pastille figée ; `gpu-startup` vert ; `weather-panel` vert | S |
| **J7-5** | **Le repos au sol à la source.** La cause de la vitesse verticale résiduelle de −0,29 m/s après le roulage (l'intégration du roulage soupçonnée, J6-3) ; le repos tenu sans le juge du plan du sol comme seul rempart | — (contact) | `parcours-debarquer` : vitesse verticale au repos < 0,01 m/s, sans glissement ; VOL-AVIONS si le modèle change | S–M |
| **J7-6** | **Les 40 ms du mini** (selon la question 1). D'abord la fiche des plafonds sur le code d'aujourd'hui (J0 de jour, répétée, contre la nuit à 44,8 : l'écart jour/nuit expliqué — chaleur, réseau, version) ; puis seulement les lots dont le plafond dépasse 1 ms **sans changer l'image** ; les seuils p99 et CPU du mini fixés à cette reprise (décision de Sam du 15 nov.) | à lire dans la fiche ; le 15 nov. aucun > 1 ms connu | la fiche écrite et lue à Sam ; chaque lot ouvert avec son plafond ; J0-CONTRAT §2 (seuils) | M–L |
| **J7-R** | **Les retraits.** Chaque levier allumé par un lot de J7 perd son ancien chemin ; seuls les leviers de mesure restent | — | BH-API, GRAPHICS-PIPELINE, E2E-CATALOGUE à jour | S |

**Ordre recommandé** : J7-0 → J7-1 → J7-2 → J7-3 → J7-4 → J7-5 → J7-6 → J7-R. La sonde d'abord, parce qu'elle juge J7-2 et J7-3 ; le sol des
approches ensuite, parce qu'il bloque un parcours de bout en bout (un avion qui ne se pose pas) et que la session des approches l'attend.
J7-4 et J7-5 peuvent se glisser entre deux lots longs.

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
