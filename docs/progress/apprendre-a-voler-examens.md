# Apprendre à voler — les examens des cours (6 novembre 2026)

Les cours de [VOL-AVIONS.md](../VOL-AVIONS.md) et [VOL-VAISSEAUX.md](../VOL-VAISSEAUX.md) (partie I) et leurs pages
illustrées ([apprendre-avions.html](../apprendre-avions.html), [apprendre-vaisseaux.html](../apprendre-vaisseaux.html))
ont été éprouvés par des **LLM élèves** qui n'avaient le droit de lire que le cours (ni le code, ni les tests, ni les
autres docs), puis corrigés par des **examinateurs** qui, eux, lisaient le code. Aucun vol n'a été lancé (consigne de la
session : ni test ni e2e) : l'épreuve mesure si le cours suffit à écrire la bonne procédure au clavier et le bon script
`__bh`, pas si le vol réussit en jeu.

## La méthode (à refaire quand le cours change)

1. Un élève par cours, lecture limitée aux deux fichiers du cours. Huit tâches pour les avions (décollage du F-35B,
   palier sous autopilote puis virage à la main, vol bas sur Paris, ILS à Edwards, tour de piste, stationnaire et
   appontage du F-35B, vol complet de l'A320, reprise après un crash) ; neuf pour les vaisseaux (rotation arrêtée et
   rétrograde tenu, Hohmann 400 → 800 km, changement de plan, orbite lunaire, rendez-vous et amarrage à l'ISS, rentrée
   et atterrissage du Ranger, alunissage du Lander avec le LPD, décollage lunaire, reprise après une perte). Pour
   chacune : la procédure au clavier (AZERTY compris), un script `__bh` avec ses critères de réussite, et la liste de
   ce que le cours ne dit pas.
2. Un examinateur par cours, avec le code : chaque appel, unité et signe vérifiés (fichier:ligne), chaque lacune
   répondue, les erreurs du cours relevées.
3. Le cours corrigé, puis un **nouvel** élève repasse le même examen.

## Les résultats

| | 1er examen | après correction (2e élève) |
|---|---|---|
| Avions — lacunes relevées | 38 | ~10 groupes, surtout le vol à la main par script (gains du manche) et l'A320 détaillé |
| Avions — notes / confiance | B+ à C (examinateur) | 30 à 70 % selon la tâche (auto-évaluation) |
| Vaisseaux — lacunes relevées | 49 | ~10 groupes, surtout l'amarrage et la finale à la main |
| Vaisseaux — notes / confiance | A− à D (examinateur) | 30 à 75 % |

**Erreurs du cours trouvées et corrigées** (toutes vérifiées dans le code) :
- `ilsLast.touch.vs` est signé (négatif en descente) : le critère « vs < 3 » était toujours vrai.
- L'A/THR de l'A320 est déjà armé au décollage : ⇧' le coupait.
- `P` ne fait que monter les volets.
- `⌫` ne coupe pas les maintiens du jet.
- Le taux de virage annoncé (3°/s) valait 1,6°/s.
- Le tour de piste de l'école est à droite, avec un dernier virage de 900 m de rayon.
- La finale du Ranger est une pente de 12,6° vers un point visé ≈ 3 km avant le seuil, et non 18° et 2 km.
- U sur la Lune vise ≈ 52 km sans objectif.
- La récupération d'un vaisseau par code passe par `spaceRecoverStart()`.
- `game.warp` est remplacé sous autopilote.
- Il fallait préciser la sémantique de `step` sous accélération du temps, le signe des poussées normales et les
  conventions d'unités et de signes.

## La vérification en jeu (même jour, sur autorisation de Sam)

Les recettes des cours, appliquées telles quelles par deux e2e — `tests/e2e/apprendre-avions.e2e.test.ts` (ce Mac,
fenêtre visible) et `tests/e2e/apprendre-vaisseaux.e2e.test.ts` (kerr-mini, plein écran) :

| Fichier | Résultat | Mesures |
|---|---|---|
| apprendre-avions | **6/6** (deux passages complets identiques) | F-35B en l'air en 11 s, vario +35 m/s ; AP : 3 000 m, 270°, 200 m/s exacts ; virage à la main à 2 999–3 000 m ; ILS Edwards 20/20 (470 m, 0,6 m, −0,8 m/s) ; F-35B posé sur le Ford à 0,5 m, 1,2 m/s, « OK » ; A320 : TOGA, AP1, ILS Le Bourget 20/20 ; crash, écran de perte, reprise |
| apprendre-vaisseaux | **8/8** | rotation arrêtée, rétrograde à 0,0° ; Ap 600 km ; CIRC 587 ± 1 km ; plan +10° pour 1 336,7 m/s ; amarrage ISS 0,08 m/s ; Ranger posé à Edwards 0,2 m/s ; Lander posé à 300,2 m du site (LPD +300 m), 0,8 m/s ; Ranger en orbite lunaire 100,0 ± 0,04 km |

**Ce que le vol réel a corrigé** dans les cours :
- le libellé exact des boutons de l'écran de perte ;
- l'inclinaison qui dépasse d'environ 12° après le relâcher ;
- l'alarme train rentré, normale juste après le décollage ;
- le jugement d'une orbite circulaire par `orbit.circular`, et non par Ap − Pe (la Terre est aplatie) ;
- un **défaut du jeu** : le Lander posé ne décolle pas avec U (noté dans PROBLEMES-A-REGLER) — **réglé le 11 novembre 2026** :
  départ vertical sur sa poussée vectorée jusqu'à 200 m ; revolé par l'e2e (leçon 10 : le Lander posé puis le Ranger, 9/9).

Captures : `docs/progress/apprendre/`, et dans les pages.

**Revérifié le 11 novembre 2026** (ce Mac, fenêtre visible) : `apprendre-vaisseaux` **9/9** en 84 s — les huit recettes comme le
6 novembre, plus le décollage lunaire du **Lander posé** (+10 m en 3 s, orbite 100,0 ± 0,04 km, note 20/20). Le premier passage avait
trouvé une **erreur WebGPU** à chaque image sur la Lune (le groupe 1 du matériau laissé lié au `shadeMark` du sol des mondes
raster, régression du jour), corrigée dans le même lot.

**Le 11 novembre 2026 aussi** : `apprendre-avions` **7/7** en 81 s (ce Mac) — les six recettes, plus le **décollage
automatique par U** du F-35B à Edwards (la vraie touche ; en l'air en 10,8 s, assiette 20,1° au plus, l'axe à 0,3°,
maintiens passés, aucun GCAS). Avant, U sur une piste lançait le décollage orbital, refusé (confirmé en vol : « the
engine (0.6 g) cannot hold the weight on Earth ») ; la leçon 3 du cours disait de ne pas compter sur U.

**Le 13 novembre 2026** (audit 3.3, ce Mac) : le cours décrivait l'écran de perte et F5/F9 tels qu'ils étaient ; il dit
maintenant « Reprendre N s plus tôt » (le vol et l'appareil perdus seulement) et ce que F5/F9 rendent d'un avion.
Revérifié par les e2e `resume-point` (2/2 : le point du Ranger refusé au F-35 placé depuis ; le F-35 repris 15 s plus tôt,
à 2 999 m pour 3 000) et `aircraft-save` (1/1 : carburant 2 499 kg, train sorti, volets ½, aérofrein, ALT 3 000 / A/T 160
rendus par F9). Aucune recette du cours n'a changé : `apprendre-avions` et `apprendre-vaisseaux` non relancés.

**Le 13 novembre 2026, suite** (audit 3.4, 3.5) : **Maj et Alt** ne sont la manette que tenues seules ou avec les touches
de vol (au bout de 0,1 s) — tenues pour un raccourci (⇧P, ⇧V, ⇧L…, Alt et la molette) elles ne la touchent plus ; **F7**
loin d'un porte-avions engage l'approche ILS sur la piste la plus proche, **U** en l'air est refusé et dit. Cours (VOL-AVIONS,
VOL-VAISSEAUX, les deux pages) mis à jour ; **revolés** : `apprendre-avions` **7/7**, `apprendre-vaisseaux` **9/9** (ce Mac) ;
e2e `modifier-keys` 2/2 et `aircraft-autokeys` 3/3.

**Le 13 novembre 2026, plus tard** (audit FX-07) : **l'A320 à la manette** a sa disposition (avant : celle d'un vaisseau — pas de
roulis au stick, X/Y les maintiens orbitaux) ; ce que la page du cours disait (« stick gauche tangage et roulis ») devient vrai pour lui.
**Revérifié** par l'e2e `a320-pad` (1/1 : 15° d'inclinaison en 2 s, Menu « AP1 engaged ») et `jetpad` (F-35, 5/5) ; les recettes du
cours, au clavier, inchangées et non revolées.

**Ce qui reste ouvert** :
- Le vol entièrement à la main par script : il faut écrire un régulateur, et le cours ne donne pas les gains.
- L'amarrage manuel à 6 degrés de liberté.
- Le tour de piste et le vol bas à la main, l'aller vers la Lune planifié, la catapulte et les brins du F-35C, le
  démarrage à froid de l'A320, l'Endurance et Gargantua, les pannes : non volés par les e2e.
- Aucun élève humain n'a encore suivi le cours.

Les copies et les rapports (non commités) étaient dans le dossier de travail de la session :
`learner-*.md`, `exam-*.md`, `learner2-*.md`.

## 2026-11-15 — PLAN-APPROCHES AP1 : le choix de l'approche changé, les leçons ILS revolées

Le choix automatique de l'extrémité et de l'approche (le vent, l'aide réelle de nav.dat, une piste trop juste, le sens d'arrivée)
remplace « la plus longue, face au vent ». `apprendre-avions` revolé en entier, ce Mac, fenêtre visible : **7/7**.
- Leçon 7 (Edwards) : l'**ILS 23L** réel (CAT I) choisi, 20/20, toucher à 270 m, 0,5 m de l'axe, −1,9 m/s.
- Leçon 10 (l'A320 du Bourget) : l'**ILS 07** réel choisi (la 09/27, 1 854 m, écartée pour l'A320 : il s'y était posé trop long et
  avait cassé son train lors d'un premier essai), 20/20, toucher à 666 m, 0,7 m de l'axe.
La page `apprendre-avions.html` dit encore « l'approche ILS du Bourget » sans piste : vraie.


## 2026-11-15 — PLAN-APPROCHES AP2 : la jonction planifiée, la leçon 7 revolée

L'ILS ne vole plus droit vers un point initial fixe à 18,5 km : il planifie sa jonction (dans l'axe depuis l'arrière de la
finale, sinon vent arrière à 6 km de son côté puis base ; 300 m sur le relief). La recette du cours ne change pas (`ilsStart`),
son comportement si : `apprendre-avions` revolé **7/7** — leçon 7 (Edwards, 12 km dans l'axe) ILS 23L 20/20, toucher à 270 m,
0,5 m de l'axe ; leçon 10 (A320, Le Bourget) ILS 07 20/20, 666 m. La page et VOL-AVIONS décrivent la jonction (le schéma dit
« jonction 16 km » au lieu de « IAF 18,5 km »). Les départs de loin sont vérifiés par `approach-join` (Nice, 4/4) et sans
navigateur à Edwards (8/8), pas par le cours.

## 2026-11-15 — PLAN-J6 J6-1 : le décollage automatique arme les choix du pilote, la leçon 3 revolée

Le parcours « décoller puis virer en ville » (e2e `parcours-ville`) a trouvé le F-35, après U, en palier à ~100 m et 210 m/s sur l'axe de
la piste, le pilote automatique réglé pendant la montée (cap, altitude, vitesse) ignoré, jusqu'à une colline : les maintiens engagés
pendant le roulage prenaient le manche du décollage pour celui du pilote et, lâchés à sa fin, tenaient la hauteur du moment. Depuis, les
choix faits pendant le décollage sont **armés** et deviennent ses maintiens à sa fin. Revérifié sur kerr-mini : `apprendre-avions` **7/7**
(leçon 3 : en l'air en 10,8 s, assiette 20,1°, axe 0,3°, 2 200 m / 210 m/s tenus) ; `takeoff-armed` 1/1 (2 500 m, 270°, 150 m/s armés à
16 s, tenus — 1 110 m au-dessus du terrain à 70 s, cap 269°). La page dit l'armement.

## 2026-11-15 — PLAN-APPROCHES AP3a : l'A320 sur la jonction, le cours revolé

Le FMGC de l'A320 vole désormais la jonction planifiée (cap et altitude du FCU, APPR armé sur la dernière branche) ; la leçon 10
(VOL-AVIONS, étape 9) le dit. La recette ne change pas : `apprendre-avions` revolé **7/7** — leçon 10 (Le Bourget) ILS 07 20/20,
toucher à 666 m, 0,7 m de l'axe ; leçon 7 (Edwards) ILS 23L 20/20, 270 m. Les départs de loin : `a320-approach-join` (Nice, 4/4).

## 2026-11-15 — PLAN-J6 J6-3 : le repos au sol jugé dans le plan du sol, le cours revolé

Après le roulage d'un ILS, le F-35 n'atteignait jamais le repos (une vitesse verticale résiduelle de −0,29 m/s dans le test 3D) : il glissait
de 0,27 m/s freins serrés et ⇧K refusait la sortie. Le repos se juge désormais dans le plan du sol. Revérifié sur kerr-mini :
`apprendre-avions` **7/7** (leçon 7, l'ILS d'Edwards, jugé sur son toucher), `landing` 5/5, `parcours-debarquer` 1/1 (ILS 05 de Toulon-Hyères
19,5/20, à l'arrêt 0 m en 10 s, sortie, 2,8 m de marche aller-retour, retour à bord, U : en l'air en 10,2 s). Rien ne change aux recettes du
cours.

**15 novembre 2026, soir — PLAN-APPROCHES AP7b (le directeur de vol, la pente publiée).** Le cours gagne le directeur de vol (leçon 7 :
le repère de guidage du HUD en manuel ; leçon 10, étape 9 bis : l'approche de l'A320 à la main sur les barres du FD, l'AP1 coupé n'étant
plus réengagé) et la pente publiée de chaque approche (3° le plus souvent, 4° à Marseille 31R). Revérifié sur ce Mac : `apprendre-avions`
**7/7** (l'ILS 23L d'Edwards ; LFPB 07 de l'A320 : 20/20, toucher à 669 m, 0,7 m de l'axe, −0,67 m/s), `fd-approach` 2/2 (la recette
« à la main sur le directeur » volée par une main scriptée, F-35 et A320, établis à 11,2 km), `crew-approach` 5/5. Les recettes
existantes ne changent pas ; l'étape 9 bis est nouvelle, volée par `fd-approach`.

**15 novembre 2026, soir — PLAN-APPROCHES AP8 (la roue).** Le chemin de la roue change dans le cours (leçon 7, leçon 10 étape 9 ;
apprendre-avions.html) : Tab › **Approche** (au lieu de Navigation › Approche ILS et de sa sous-roue de pistes). Les recettes de vol
ne changent pas ; `apprendre-avions` n'utilise pas la roue. Revérifié : `approach-wheel` 2/2 et `ils-runway` 1/1 (le choix de la
piste à la roue, en français, à Toulon-Hyères), par entrée réelle.

**16 novembre 2026 — l'alarme du train (GPWS mode 4A), la leçon 3 revolée ; la ligne d'horizon du HUD retirée.** La leçon 3 disait
l'alarme « train rentré trop bas » normale juste après le décollage : elle ne sonne plus pendant la montée initiale (`game/gear-warn.ts` :
train rentré, sous 152 m sol et 98 m/s, en descente, hors montée jusqu'à 457 m). Revolé : `apprendre-avions` « leçons 0 et 3 » 1/1 (ce Mac,
fenêtre visible) — à 223 m, +34,8 m/s, train rentré : plus d'alarme (avant : « MASTER WARNING · GEAR UP · TOO LOW », « Too low, gear! »).
La capture `av-l3-montee.jpg` remplacée ; l'« Auto-GCAS: recovered » qu'on y lit était déjà sur l'ancienne (non lié). Le schéma du HUD
(apprendre-avions.html) perd sa ligne d'horizon (retirée du HUD ce jour, Sam). L'Auto-GCAS qui reprenait la main pendant la montée de la leçon 3
(« fly up », « recovered — yours ») : sa prédiction comptait la hauteur de l'instant de l'envol comme une menace ; corrigé le même jour
(`game/gcas.ts` `gcasThreat` : pas de ressource quand le point le plus bas prédit est l'instant présent et que le jet s'en éloigne —
en montée, ou dans la minute qui suit l'envol sans descendre). Revolé sur kerr-mini (2/2, run `20261116-113827-appr-l3`) : la montée
est le pilote seul, +16 m/s à 117 m/s (le +35 m/s d'avant était la ressource du GCAS) ; capture remplacée, cours (tableau des recettes) à jour.

## 2026-11-24 — le ravitaillement en vol écrit pour d97a6ee4 (recette non revolée)

Le commit d97a6ee4 (21 novembre 2026, « fix(aar): stabilize probe-drogue capture, assisted mode cues, and hose-to-pod
alignment ») a changé la loi du ravitaillement en vol (`controller/aar.ts` : PD vertical amorti `kDz` 1,6 s, `wU` 0,55/s,
`vU` 2,5 m/s ; correction fine bornée à ±0,8 m ; visée auto à −2,5 m avec abandon quand la pointe passe le plan du panier ;
la main rendue en assisté au pré-contact, `arrived`) et les repères du HUD (`symbology.ts`, la ligne de l'assisté) sans
toucher au cours. Ce jour : VOL-AVIONS.md (partie I, leçon 9 : un paragraphe « Ravitaillement en vol » nouveau ;
partie II §4.1 : la loi détaillée) et apprendre-avions.html (leçon 9 : un encadré) écrits d'après le code ; le repère
du HUD affiche désormais les touches de manette réglées par le joueur (⇧ et Alt par défaut) au lieu de « SHIFT » / « ALT »
codés en dur.

**Ouvert** : la recette n'a **pas** été revolée. Ni l'e2e `aar` (automatique, contact et plein) ni une recette en
**assisté** (pré-contact atteint, `arrived`, gaz + jusqu'au contact, repère du HUD lu en FR et en EN, avec une touche de
manette remappée) n'ont été lancés après d97a6ee4 ; aucune capture refaite. Le cours ne cite pas de chiffre mesuré pour
le ravitaillement.

## 2026-11-24 — Vaisseaux, leçon 6 bis : points de Lagrange, orbite Halo, JWST (écrite, pas encore revolée)

La leçon 6 bis (VOL-VAISSEAUX partie I, apprendre-vaisseaux.html `#l6b`) et les lignes de la référence (§4.2 `orbit` vers un
point de Lagrange = l'autopilote Halo, `keep` au point et auprès de JWST ; §4.3 les missions HALO/LIBRATION/SURVOL ; §4.4 les
plafonds d'accélération) sont écrites d'après le code (`lagrange.ts`, `lagrange-plan.ts`, `lowthrust.ts`, `stationkeep.ts`,
`ui/fc/computer.ts`) après la revue de 07021ba5 (la phase des orbites Halo corrigée, les boucles L4/L5 refaites, le champ A_z
borné avec un message). **Aucune de ces recettes n'est revolée par un e2e** : `apprendre-vaisseaux.e2e.test.ts` ne les vole
pas ; `lagrange-jwst.e2e.test.ts` (autopilote Halo tenu 10 jours à la date du jour, ≤ 20 km et ≤ 1 m/s) est modifié mais
pas relancé. Les Δv cités viennent des tests unitaires du planificateur (`tests/lagrange.test.ts`), pas d'un vol en jeu.
Capture de la leçon à faire.

## 2026-11-26 — Vaisseaux, leçon 8 : la rentrée guidée et l'approche du Ranger (code changé, recette non revolée)

Le guidage de rentrée s'incline désormais d'abord du côté du site (`EntryGuidance.sided`), et le plané compte son énergie quand il
est passé loin de l'axe ou à court (`controller/computer.ts` approach). VOL-VAISSEAUX (leçon 8, §4.2) et apprendre-vaisseaux.html
(leçon 8) le disent. **Revérifié** : des vols complets de l'orbite à la piste sur kerr-mini (`scripts/live-entry.ts`) — Edwards posé
0,4 m/s et arrêté sur l'axe (il s'écrasait 4 fois sur 4 avant), Le Bourget et Kennedy posés ; le plané au banc sans page
(`tests/entry-glide.test.ts`, 5/5). `apprendre-vaisseaux.e2e.test.ts` relancé sur kerr-mini après le changement : **9/9**, la leçon 8 posée à 0,23 m/s.
**Ouvert** : aucune capture de la leçon refaite pour la page.

