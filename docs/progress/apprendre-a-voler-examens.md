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
