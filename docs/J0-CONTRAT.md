# J0 — Le contrat d'acceptation et la scène de référence

**Statut (10 novembre 2026)** : contrat **écrit** ; scène de référence **implémentée** (`tests/e2e/lib/j0-scene.ts`,
`tests/e2e/j0-reference.e2e.test.ts`) ; fiches de mesure dans [progress/j0/](progress/j0/) (une par machine et par
commit) — **premières mesures le 10 novembre** sur M1 Max et kerr-mini ([synthèse](progress/j0/README.md)). **Sam a validé
le 10 novembre les seuils du §2 et le jugement sur l'état soutenu : J0 est atteint** (§10) ; le palier 1, lui, ne l'est pas. Le code fait foi ; ce document dit ce qu'on
mesure, comment, et ce qui ferait passer le palier.

Origine : [stratégie](ANALYSE-STRATEGIE-RENDU-2026-11-03.md) §15 J0, §8 (contrat de performance), §19.13–19.14
(parcours et premier ensemble), §22.4 (décisions de Sam du 10 novembre : D1 vague 0 puis J0, D2 Toulon-Hyères, D3
25 ms sur M1 Max, gel) ; [audit du 10 novembre](audit-2026-11-10/09-priorites-todo.md) lignes 1.1 et 1.2.

## 1. Ce que J0 fixe, et ce qu'il ne fait pas

J0 fixe **une scène, une méthode et un palier** : chaque lot de rendu, de chargement ou de contenu qui prétend changer
la cadence ou la qualité se juge sur la même scène, avec la même fiche, sur les mêmes machines. J0 ne rend rien plus
rapide. Il dit où part la frame (§5) et donne le témoin de J1 (l'opaque terrestre en forward, qui remplacera
`shadeLite` dans son domaine).

## 2. Le profil et le palier

| | Valeur | Source |
|---|---|---|
| Machine du palier | MacBook Pro M1 Max (ce Mac) | D3 |
| Second témoin | kerr-mini (Mac mini M1, 16 Go) ; son écran est à 50 Hz ; sa fréquence GPU stable en fait la machine de la répartition par poste (§5). **Sa propre cible depuis le 13 novembre : 25 images/s régulières** (40 ms par image nouvelle, deux rafraîchissements) — pas les 60 images/s, qui restent la cible du M1 Max (le 13 : GPU p50 58,4 ms, intervalle alterné 60 / 80 ms) | D3, §8.1 « profil matériel plus modeste », décision de Sam du 13 nov. |
| Sortie | 1920 × 1080, `devicePixelRatio` 1 | §8.1 profil principal |
| Navigateur | Chrome (version relevée dans la fiche), WebGPU sur Metal | — |
| Réglages | **le profil du joueur tel que livré** (qualité, résolution dynamique, décor, look) ; seuls ceux de la scène sont fixés (§3) | — |
| **Palier 1** | **25 ms par image nouvelle (40 images/s)** | D3 |
| Cible finale | 16,67 ms (60 images réelles/s), image nette en mouvement, contenu complet | §8.1, inchangée |

**Deux états thermiques, mesurés tous les deux.** Le premier passage du 10 novembre l'a montré : sur ce MacBook Pro
(secteur, mode économie coupé), le jeu tient le GPU à 100 % dès la première image ; il atteint 97 °C en une minute, sa
fréquence descend à 76–87 % du maximum pendant le vol mesuré, puis tombe à **30 % (389 MHz) au bout de 2,5 min** et y
reste (pression « Trapping »). Le vol est donc mesuré **frais** (au sortir du chargement) et **soutenu** (le même vol
rejoué après les ablations, la machine chaude), chacun avec sa fréquence GPU relevée. §8.3 demande de tenir le profil
« dans un état thermique stabilisé » : **le palier se juge sur l'état soutenu** — *décision de Sam, 10 novembre*.

**Borné et soutenu** — *décision de Sam, 13 novembre* ([contre-analyse](CHALLENGE-J1-J2-2026-11-13.md) C8, idée 5) : le
palier se juge **la cadence bornée** (`fpsCap`, ou un verrou sur un nombre entier de rafraîchissements) et la machine
soutenue ; un vol frais non borné (le 12 : 22,5 ms de GPU à 98–100 °C) reste relevé comme capacité, il ne valide pas le
palier. **À faire avant la prochaine fiche** : l'essai de la borne sur le M1 Max (bride-t-il encore, borné à 30 puis à
40 images/s ?) ; la valeur de la borne se fixe sur cet essai, non mesuré à ce jour. Sur kerr-mini, la cible de 25 images/s
régulières se lit de la même façon : intervalle p50 et p95 ≤ 40 ms, sans alternance 60 / 80 ms (le p99 et le CPU :
seuils à transposer et à valider avec la première fiche bornée).

**Premier essai de la borne (M1 Max, 13 novembre 2026 ~08:10–08:21 UTC, arbre de a371c946, `J0_FPSCAP=30`,
`remote-results/j0/m1max-cap30`)** : **borné à 30 images/s, le M1 Max bride encore.** Le vol frais tient la borne (30,0 images/s,
intervalle p50 33,3 / p95 42,1 ms, GPU p50 21,4 ms à 1 291 MHz, occupé ~87 %) ; après les ablations, le vol soutenu ne la tient plus :
27,8 images/s, intervalle p95 **58,6 ms**, p99 82,9, GPU p50 29,4 ms — la pression **Heavy**, le GPU **881 MHz** (68 % de son maximum),
occupé 93 %. 30 images/s laissent 33 ms par image à un GPU qui en prend 21 frais : la borne ne suffit pas à le garder hors du bridage
sur ce vol. L'essai à 40 images/s, interrompu (ce Mac encore chaud, la mesure de l'eau étagée passant avant sur le mini), reste à faire
— **non mesuré** ; si 30 bride, 40 bridera aussi, mais le chiffre se mesure. La valeur de la borne n'est pas fixée.

**Le palier 1 est atteint** quand, sur le vol de référence (§3), mesuré deux fois sur le M1 Max dans l'état soutenu,
**les seuils suivants tiennent tous** — *validés par Sam le 10 novembre* (transposés de §8.3, qui les fixe pour
le profil 60 : p95 au budget, p99 à 1,5 fois) :

- intervalle entre images nouvelles : **p50 ≤ 25 ms**, **p95 ≤ 25 ms**, **p99 ≤ 37,5 ms** ;
- épisodes au-delà de 50 ms : comptés et datés ; aucun hors des arrivées de données identifiées ;
- boucle principale (CPU) : **p95 ≤ 4 ms** par itération (§8.3) ;
- qualité effective relevée (échelle de rendu, bloc, taux de shading) **au moins égale** à celle de la fiche de
  référence du 10 novembre : un gain obtenu en baissant la résolution ne compte pas (§8.2) ;
- aucune erreur GPU, aucun crash, le contenu présent (relief fin, imagerie, décor) à l'entrée du vol.

Le palier ne déclare pas la cible 60 atteinte.

## 3. La scène de vol de référence : Toulon-Hyères, la côte (`toulon-hyeres-v1`)

Définie dans `tests/e2e/lib/j0-scene.ts` (une seule source ; changer une valeur, c'est une nouvelle scène et une
nouvelle série de fiches, jamais comparée à l'ancienne comme si c'était la même).

| | Valeur |
|---|---|
| Appareil, vue | F-35, cockpit |
| Départ | 43,06° N, 6,32° E (Rade d'Hyères), 500 m au-dessus de la mer, cap 270°, 140 m/s |
| Pilotage | autopilote (hauteur, cap), autothrottle 140 m/s, train sorti (protocole de vol stable, [E2E-VOLS](E2E-VOLS.md) §5.4) |
| Trajectoire | 25 s le long de la côte vers l'ouest, puis virage à droite vers le cap 340° qui traverse la côte vers La Londe et les Maures ; 70 s en tout, temps réel |
| Date, lumière | 10 juillet 2026, 15:30 UTC (17:30 locales) : soleil bas à l'ouest, reflet sur la mer |
| Météo | « fair », couverture nuageuse dessinée 0,5, vent nul |
| Contenu | mer et FFT, côte, relief (IGN et Terrarium), orthophotos IGN, bâtiments BD TOPO, arbres, nuages épars |
| Fixé pour la reproductibilité | trafic coupé (OpenSky varie), sauvegarde auto coupée, casse coupée |

Elle couvre trois des scènes de §15 à la fois — côte et eau au soleil bas, virage, proximité du sol à 500 m — avec le
chargement réel du réseau. Elle ne couvre ni la ville basse, ni la montagne, ni la traversée de nuages, ni la transition
orbitale, ni Kerr (§6).

## 4. Ce qu'on mesure, et ce que chaque chiffre veut dire

Le vocabulaire suit §8.3 : un compteur de boucle n'est pas une cadence du jeu.

| Mesure | Ce qu'elle est | Ce qu'elle n'est pas |
|---|---|---|
| **Intervalle entre images nouvelles** (p50, p95, p99, max) | à chaque `requestAnimationFrame`, si `renderer.completedFrames` a avancé : le temps depuis l'image nouvelle précédente | la présentation à l'écran (non observable ici) |
| Images nouvelles par seconde | leur nombre sur la durée | les rAF par seconde |
| Épisodes > 33,3 ms (et > 50 ms) | nombre et durée cumulée | — |
| Temps GPU d'une image (`lastGpuMs`) | de la soumission (ou de la complétion précédente) à la complétion (`onSubmittedWorkDone`) : un majorant du travail GPU de l'image | un horodatage de passe |
| Passes GPU (`renderer.prof`) | horodatages, une image sur 4 | **sur Apple, les passes de rendu se chevauchent** (audit GP-09) : seules les passes de calcul s'additionnent ; jamais sommées pour le total |
| Boucle principale (`game.perf().loopCpu`) | temps CPU par itération, p50/p95/p99 sur les 600 dernières | le temps de l'encodage GPU seul |
| Qualité effective | chaque seconde : échelle de rendu, bloc, qualité, tuiles et compilations en attente | une mesure d'image |
| Mémoire | tas JS ; taille résidente des processus du Chrome de test ; empreinte physique du processus GPU (`footprint`, macOS) | la mémoire GPU exacte par ressource (non exposée) |
| Thermique | `scripts/thermal.ts status --json` au départ, au milieu et à la fin de chaque vol, au début et à la fin de chaque ablation (pression, fréquence GPU, température) | — |
| Le chemin d'entrée, à froid | secondes depuis le démarrage : première image, appareil prêt, **image pilotable** (noyau de la scène compilé), **couverture utile** (relief fin, 3 s calme), **détail complet** (imagerie, décor, noyaux) | le parcours du joueur par l'écran titre (la page démarre sur `game:artemis`, puis l'appareil est placé) |

Une fenêtre visible plafonne à la fréquence de l'écran (120 Hz ici, 50 Hz sur kerr-mini) : au-dessus de 8,3 ms par image
ici, elle ne fausse pas les intervalles ; sur le mini, tout intervalle se quantifie par pas de 20 ms. Le profil Chrome est
neuf à chaque lancement : la fiche est celle d'un **premier lancement** (caches vides) ; un second lancement sur profil
gardé est une autre fiche.

## 5. La frame répartie par poste

Sur Apple, les horodatages ne répartissent pas la frame (GP-09). La répartition se fait donc **par ablation, sur des
images terminées** : depuis le même instantané (sauvé après le chargement), le même vol rejoué 20 s en temps réel avec
**un poste retiré à la fois**, entre deux vols de référence (la dérive thermique ou de chargement se lit entre eux). Avant
chaque vol, l'horloge du jeu est arrêtée jusqu'à ce que noyaux, relief, imagerie et décor soient là (le retour au point
de départ les recharge : le premier passage a mesuré ce rechargement). La fréquence GPU de chaque ablation est relevée :
deux ablations ne se comparent qu'à fréquence égale.

| Poste | Retrait |
|---|---|
| Nuages | couverture dessinée 0 |
| Décor | `earthScenery: "off"` (bâtiments, arbres) |
| Eau | `liteSkip` 1 (le matériau de l'eau dans `shadeLite`) |
| Affichages | HUD et panneaux de l'interface masqués |
| Dessin de l'appareil | `renderer.debugSkipShip` : son dessin (cockpit, écrans, coque) sauté ; le masque du cockpit reste, l'image y garde un cockpit ancien et le sol n'y est pas ombré — le coût du dessin, pas celui de la surface qu'il cache |
| Ombre de l'appareil | `ship.debugSkip` « shadow » (sa carte d'ombre seule) |

**Sur quelle machine.** Le M1 Max ne tient pas sa fréquence GPU : en jeu prolongé elle oscille entre 389 et 1 296 MHz
(10 novembre), et deux ablations successives y mesurent la fréquence plutôt que le poste (`scripts/j0-fiche.ts` les marque
⚠). **La répartition par poste se lit sur kerr-mini**, dont la fréquence reste à 1 278 MHz sur toute la séance ; on y lit
ΔGPU et Δ images/s, son écran à 50 Hz quantifiant l'intervalle par pas de 20 ms. Le M1 Max porte le palier (§2), frais et
soutenu.

Le gain d'une ablation dit ce que le poste coûte **dans cette scène**, pas ce qu'un remède rapporterait : les postes ne
s'additionnent pas (le CPU et le GPU se chevauchent, un retrait change parfois le noyau compilé). Le sol (`shadeLite` et
la visibilité raster) n'a pas d'ablation : c'est le reste. Les passes de calcul horodatées complètent la lecture.

## 6. Les autres scènes de l'ensemble (§15)

Seule la scène de référence est un contrat aujourd'hui. Les autres restent mesurées par les e2e existants, sans
fiche J0 :

| Scène de §15 | Approchée aujourd'hui par | Statut |
|---|---|---|
| Ville basse | `paris-night-flight`, `lowflight-governor` (Chamonix) | à définir en scène J0 après J1 |
| Montagne en virage | `raster-flight` alps, `motion-quality` alps | idem |
| Côte et eau au soleil rasant | **la scène de référence** | contrat |
| Traversée de nuages | `cloud-volume-fade`, `raster-flight` tarifa-cumulus | à définir avant J4 |
| Proximité du sol | la scène de référence (500 m) ; `ground-*` au sol | partiel |
| Transition orbitale | `camera-travel`, `wormhole` | à définir |
| Kerr (non-régression) | `scripts/trace-ab.ts`, Kerr Bench | existant, hors J0 |

## 7. Les propriétaires (D6)

| Responsabilité | Aujourd'hui (code) | Propriétaire désigné | Règle jusqu'à J1 |
|---|---|---|---|
| **Sol de contact** (le premier, AR-01) | le renderer installe `setGroundRelief(earthHeightSampler(…, earthTiles.heightAt))` quand ses cartes arrivent (`renderer.ts`) ; le relief suit la caméra, le tier et le chargement | **le monde** : un service de sol qui possède le support et sa révision ; l'appareil le lit, le renderer aussi | aucun nouveau lecteur du sol via le renderer ; la scène de référence n'observe pas de saut de sol (AGL échantillonné chaque seconde dans la fiche) |
| Temps | `Simulation` et l'horloge de l'appareil (`sim.ts`), plusieurs horloges (AR-08), pas de politique d'onglet masqué ni de reprise GPU (AR-02) | **la simulation** : le temps accepté, une horloge pour la logique de vol | pas de nouveau `performance.now()` dans `src/controller` |
| Vue | pose écrite dans `Settings` (AR-07), lue par le renderer comme description de vue | **la vue** : sa pose finale, un instantané par image | pas de nouvelle pose lue dans `Settings` |
| Image | le renderer : ressources GPU, historiques, gouverneur | **le renderer** | inchangé ; le gouverneur doit agir sur le poste chargé (GP-06, vague 4.6) |

Ces désignations nomment la cible ; elles ne sont pas réalisées (vague 4 de l'audit).

## 8. Les contrats du §19 dans la scène de référence

| Contrat | Ce que la fiche relève dès J0 | Ce qui manque |
|---|---|---|
| Temps | le vol en temps réel, la durée réelle de chaque phase | la politique d'onglet masqué, de trou de frame, de reprise (AR-02) |
| Sol de contact | AGL chaque seconde ; l'appareil ne touche pas la mer | un sol indépendant de la caméra et du tier (AR-01) |
| Contrôle | autopilote, autothrottle, virage obtenu (cap final) | la latence commande → image (non mesurée) |
| Instruments | le HUD et le cockpit présents ; leur coût (ablation « affichages ») | l'âge des instruments par image |
| Reprise | — | rien encore : une scène de reprise (perte GPU, onglet masqué) viendra avec la vague 4.2 |

## 9. Procédure

```bash
bun scripts/thermal.ts status                                    # nominal avant de mesurer
J0_MACHINE=m1max bun run e2e j0-reference > remote-results/j0/run-<n>.log 2>&1   # ce Mac, fenêtre visible
bun scripts/remote.ts run -- E2E=1 J0_MACHINE=kerr-mini bun test --preload ./tests/e2e/lib/preload.ts tests/e2e/j0-reference.e2e.test.ts
```

Phases : `J0_PHASES=flight` (le vol seul), `ablate` (les ablations seules) ; `ABLATE_S` la durée d'une ablation.
Sortie : `remote-results/j0/<machine>/j0.json` et les captures. La fiche (`docs/progress/j0/FICHE-<machine>-<date>.md`)
reprend : commit, machine, Chrome, thermique, réglages effectifs, le chemin d'entrée, les statistiques du vol et de
chaque ablation, les passes de calcul, la mémoire, les captures — chaque chiffre avec sa source. Une fiche nouvelle ne
remplace pas l'ancienne : elle s'ajoute, l'ancienne est marquée « périmée » si le commit ou la scène ont changé.

Ce qui rend deux fiches incomparables : une autre version de la scène, une autre machine, un état thermique non nominal,
un profil Chrome gardé contre un profil neuf, des données réseau manquantes (tuiles en échec : consignées dans le
journal de l'e2e).

## 10. Le gel, et ce que J0 débloque

Jusqu'à J0, aucun nouveau lecteur de `shadeLite` ni de `trace.wgsl`, sauf correctif (§22.4). **J0 est atteint** quand
ce contrat est validé par Sam (seuils du §2, scène du §3) et que la fiche du M1 Max et celle de kerr-mini existent au
même commit. Il débloque J1, jugé sur cette scène : l'opaque terrestre en forward remplace `shadeLite` dans son domaine
(terrain et bâtiments), il ne s'y ajoute pas.

## 11. Décisions

**Prises (Sam, 10 novembre)** : les seuils du palier 1 (§2) ; le palier se juge sur l'état thermique **soutenu** (sur ce
M1 Max, l'écart avec l'état frais est d'un facteur ≈ 1,7 à 3 selon l'instant).

**Prises (Sam, 13 novembre)** : le palier se juge **borné et soutenu** (§2) ; kerr-mini a sa propre cible, **25 images/s
régulières** (§2) ; l'eau et le découpage des noyaux passent avant J3 ([stratégie](ANALYSE-STRATEGIE-RENDU-2026-11-03.md) §24).

**Ouvertes** :

- D4–D5 : la relecture de [C0](progress/refraction-horizons/C0.md) et le budget de Q1, avec ce contrat et la première
  fiche sous les yeux.
- L'heure et la météo de la scène (§3) : choisies ici (soleil bas, nuages épars) ; Sam peut en fixer d'autres — ce
  serait `toulon-hyeres-v2`.

**Ablations de l'eau réparées (13 novembre, session du rendu)** : `liteSkip` passe désormais par les bits de son mot (`bitcast`, il perdait ses
bits bas sous un bit 26 levé par défaut) — l'ablation « sans matériau de l'eau » coupe enfin l'eau : **−13,0 ms** sur kerr-mini (58,0 → 45,0) ;
l'ablation `seaSurface` (mer plate) entre dans l'ordre par défaut : −0,7 ms. Les ablations « eau » des fiches d'avant le 13 sont invalides.
