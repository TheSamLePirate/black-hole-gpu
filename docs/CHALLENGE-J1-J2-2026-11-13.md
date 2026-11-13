# Challenge de J0–J2 et du travail du 10 au 13 novembre — où est le temps, quoi faire ensuite

**13 novembre 2026, ~07:30 UTC — lecture du code, des commits, des plans et des fiches ; aucun code modifié, aucun test, e2e ni
bench lancé.** `main` à `d9b2557b`. Examinés : la session T3 « Audit 2026-11-10 Priority TODOs » (`33d89754`, 334 tours ; 213 commits
sur `main` depuis le 10), [PLAN-J1](PLAN-J1-OPAQUE-FORWARD.md), [PLAN-J2](PLAN-J2-PAGES-RECONSTRUCTION.md), [J0-CONTRAT](J0-CONTRAT.md) et ses
[fiches](progress/j0/README.md), [PLAN-MER-WEBGPU](PLAN-MER-WEBGPU.md), [les priorités de l'audit](audit-2026-11-10/09-priorites-todo.md),
la [stratégie](ANALYSE-STRATEGIE-RENDU-2026-11-03.md) §8, §15, §20, §22, `src/renderer.ts`.

Chaque chiffre cité est **mesuré par les fiches du dépôt** (source donnée) ; ce que j'en déduis est marqué **calculé** ; mes idées
sont des **hypothèses à prouver**, aucune n'est un gain acquis.

## 1. Verdict

1. **Le travail est honnête et bien outillé, mais il n'a pas rapproché la frame de la cible.** Sur la scène J0, kerr-mini :
   GPU p50 65 ms le 10 novembre au matin, 60,8 le soir (la mer sortie de `shadeLite`), 60,0 le 11 (matériau puis éclairage),
   59,5 le 12, 59,0 le 13 ; l'A/B de tous les lots de J2 : **ΔGPU nul** (journal, 13 nov. 06:45Z). Les 6 ms gagnés viennent de
   la mer et du découpage du sol, pas de J1 ni de J2.
2. **La cause est l'ordre, pas l'exécution.** Sur le M1 Max (le profil principal), la reconstruction et les nuages sont déjà dans
   l'enveloppe du §8.2 ; **l'eau y est à plus de quatre fois la sienne** et ≈ 7 ms de passes de rendu ne sont attribuées à
   personne (§2). J2 a passé deux jours sur la famille qui était dans son budget ; l'eau attend J4, après J3.
3. **Le dépôt contient déjà la piste la plus rentable, mesurée trois fois, jamais traitée comme telle** : sur Apple, un gros
   noyau de calcul paie le code qu'il *contient*, pas celui qu'il exécute (« présence », PLAN-MER §4 : −8,8 ms pour un bloc absent
   de la vue ; PLAN-J1 §4 ter : −11 à −12,5 ms). Et chaque gros noyau est lancé **sur tout l'écran**. La réponse systématique
   (classer l'écran par tuiles, lancer de petits noyaux là où ils servent) n'est dans aucun plan.
4. **Je recommande** : écrire le « chemin vers §8 » que J2 doit à sa sortie, le fonder sur le tableau du §2, et faire passer
   **l'eau et le découpage des noyaux avant J3**. Le détail au §6.

## 2. Où est le temps aujourd'hui

Scène `toulon-hyeres-v1`, 1920 × 1080, échelle 0,75, vol frais. Sources :
[fiche kerr-mini du 13](progress/j0/FICHE-kerr-mini-2026-11-13.md) (`f6b4b20f`, GPU p50 59,0 ms),
[fiche M1 Max du 12](progress/j0/FICHE-m1max-2026-11-12.md) (GPU p50 22,5 ms à 1 296 MHz et 98–100 °C). Seules les passes de
calcul s'attribuent par horodatage sur Apple (GRAPHICS-PIPELINE §8.3) ; l'enveloppe est celle de la stratégie §8.2
(prescriptive, pour 60 Hz).

| Famille (§8.2) | Enveloppe | M1 Max frais | kerr-mini | Ce qui est compté |
|---|---:|---:|---:|---|
| Visibilité, publication | 2,0 | 0,9 * | 2,8 * | `terrain raster visibility` (* passe de rendu : indicatif) |
| Opaque et éclairage, appareils | 4,0 | 3,7 + appareil ? | 10,0 + 3,2 | `earth lite` + `earth lite: light` ; l'appareil par ablation (mini seulement) |
| **Eau** | **1,0** | **≥ 4,3** | **≥ 14,7** | `earth water` (+ `sea fft` 2,0 sur le mini) ; **`sea surface` non attribuable** |
| Air et nuages | 2,5 | 3,0 | 5,4–6,2 | `clouds (half)` + `trace` ; nuages par ablation sur le mini : −6,2 |
| Reconstruction et sortie | 2,0 | ≤ 2,0 | 5,5 | `taau` + `temporal` |
| Ombres, sondes | 1,5 | 2,3 | 2,2 + ? | `terrain from the Sun` + `earth horizons` |
| **Non attribué** (calculé) | — | **≈ 7** | **≈ 12** | GPU p50 moins les passes de calcul et, sur le mini, moins l'appareil et le HUD (ablations) : `sea surface`, `display`, masques ; sur le M1 Max l'appareil et le HUD y restent, faute d'ablation valable |
| **Total mesuré** | 13,0 | **22,5** | **59,0** | `lastGpuMs` p50 |

Ce que ce tableau dit :

- **Sur la machine cible, deux postes décident** : l'eau (≥ 4,3 ms pour 1,0) et le non-attribué (≈ 7 ms, plus que la marge
  entière de 3,67 ms). L'opaque est proche (3,7 pour 4,0), les nuages et la reconstruction y sont.
- **Le mini est un bon témoin** : ses noyaux coûtent 2,6 à 3,1 fois ceux du M1 Max, tous dans le même rapport (calculé sur les
  deux fiches). Un gain mesuré sur le mini vaut donc pour le M1 Max, à ce rapport près.
- **De 22,5 à 16,7 ms il manque 26 %** ; mais le M1 Max est à 100 °C pendant ce vol frais et retombe à 29 ms soutenu
  (865–1 047 MHz). **Tenir 60 images/s veut dire ≈ 12 ms à pleine fréquence** — l'enveloppe de 13 ms du §8.2 était juste, et
  l'écart réel est de l'ordre de la moitié de la frame, pas du quart.
- **L'ablation de l'eau de la fiche J0 est invalide depuis le 12** (`liteSkip` perd ses bits bas) et `sea surface` n'a pas
  d'ablation : la plus grosse famille de la scène de référence est la moins bien mesurée.

## 3. Ce que la session a bien fait

- **J0 existe** : une scène, une fiche reproductible, des ablations sur fréquence stable, le thermique relevé. Avant le 10, rien
  de cela (audit GP-09, QA-12).
- **Elle se corrige par écrit.** Au moins cinq commits de correction depuis le 10, dont trois le 13 (la sonde de traîne de J2-4, les
  comparaisons d'échelle, le PSNR de `singleHistory`) ; les conclusions retirées le sont nommément.
- **Elle retire ce qui ne paie pas** : le pilote forward du sol (+13,6 ms mesurés), celui des bâtiments, `rigidMotionOn`, la
  désocclusion (+0,43 ms sans gain), `heldFreshBox`. C'est la règle §20.7 appliquée.
- **Des gains d'expérience réels, hors cadence** : le sol de contact possédé par le monde (J2-2, audit AR-01), la publication des
  tuiles bornée (pointes p95 2,9 → 1,3 ms, max 9,5 → 2,1 ms sur le mini), les points blancs de la mer expliqués et corrigés, les
  arbres sur les îlots coupés, l'appareil net en virage (J1-5), la couverture utile à froid 77 → 57 s (une seule entrée, non
  attribuée).
- **La décision « différé pour le sol » est la bonne**, et elle est standard : un maillage à ~3 pixels par triangle (131 000
  triangles pour 427 000 pixels, PLAN-J1 §4 ter) s'ombre depuis un tampon de visibilité, pas dans son fragment.

## 4. Ce que je conteste

**C1 — J2 a été ordonné par la stratégie, pas par la fiche.** La fiche J0 du 12 donnait déjà `taau` 1,2 ms et `temporal` < 0,8 ms
sur le M1 Max : la reconstruction était dans son enveloppe avant que J2 ne commence. La désocclusion, l'historique unique,
l'identité du sol par page ne pouvaient pas rendre de temps, et la qualité mesurée n'a pas bougé (`singleHistory` : 32,6 contre
32,5 dB). *Règle proposée* : avant d'ouvrir un lot, écrire son gain maximal possible lu dans la fiche (« ce poste coûte X, je ne
peux pas rendre plus que X ») ; un lot dont le plafond est sous 1 ms se justifie par la qualité ou l'expérience, et se dit tel.

**C2 — « J1 terminé », « J2 en sortie » : les critères de la stratégie ne sont pas tous tenus.** J2 exige à son passage « un coût
de frame complet et **un chemin crédible vers le contrat §8** » (stratégie §15, PLAN-J2 §4 dernière ligne : « le chemin vers §8
écrit »). Ce chemin n'est écrit nulle part. Ne pas fermer J2 sans lui ; le tableau du §2 en est la première page.

**C3 — CLAUDE.md contredit la décision du 12.** La direction permanente dit « **Socle raster forward**, matériaux explicites » ;
Sam a confirmé le 12 « le différé pour le sol » et retiré le forward des bâtiments. Tout l'opaque terrestre est aujourd'hui une
visibilité suivie d'un ombrage en calcul. Chaque session future relira « forward » comme la cible. À réécrire dans CLAUDE.md et
la stratégie §7.4–7.5 (« visibilité raster, ombrage différé en calcul pour le sol dense ; forward pour les grands triangles et
les transparences »), par décision de Sam — je ne l'ai pas touché.

**C4 — Une seule scène juge, et c'est une côte.** La stratégie §15 demandait six scènes à J0 ; le contrat §6 les renvoie « après
J1 ». Conséquences vues : le sol et la reconstruction ont été jugés sur une scène dominée par l'eau ; les deux défauts de ville
(le plafond de 32 000 bâtiments, les arbres sur les îlots) ont été trouvés par hasard le 12 au-dessus de Paris. Il manque au
moins « ville basse » et « montagne en virage », en version légère (GPU p50, une capture, pas la cérémonie complète).

**C5 — L'eau en J4 est trop tard.** L'ordre J3 (lumière, cockpit) puis J4 (eau, volumes) laisse le premier poste hors budget
derrière deux à quatre semaines de travail qui ne le touchent pas. PLAN-MER le renvoie lui-même : « l'allègement général de la
passe d'eau (J4) ».

**C6 — Les leviers s'empilent.** Douze bascules de rendu relevées (`singleHistory`, `edgeFoot`, `seaSsrSafe`, `clearCut`,
`earthRateOne`, `rasterScaleFree`, `seaWaterOpenOn`, `seaCrestsOverLand`, `seaSurfaceOn`, `shoreSwellOn`, `taauOn`, `rasterHold`).
« Allumé par défaut, l'ancien chemin gardé derrière le levier » double le code à maintenir et à compiler. *Règle proposée* :
un levier allumé par décision de Sam perd son ancien chemin au lot de retrait suivant, daté ; restent les leviers de mesure.

**C7 — Trois mesures fausses journalisées en une nuit.** Elles ont été corrigées, mais deux avaient déjà produit une
recommandation à Sam (« −0,85 dB à l'arrêt », « 0,75 seule échelle bien restituée »). *Règle proposée* : une sonde nouvelle
passe un témoin positif (elle voit un défaut injecté) et un témoin négatif (A/A nul) avant que son chiffre n'entre dans un plan.

**C8 — Le M1 Max ne peut pas juger son propre palier.** Il bride dès le deuxième vol. Tant que la cadence n'est pas bornée (§5,
idée 5), le « palier 1 à 25 ms » se lit frais à 100 °C, ce qu'aucun joueur ne garde trois minutes.

**C9 — Le rythme rend la relecture impossible.** 213 commits en trois jours, message médian de 256 caractères (jusqu'à 1 595),
un journal de 4 200 lignes. L'historique est fidèle mais plus personne — ni Sam ni une session neuve — ne peut y trouver
l'état. Il manque une page « état courant » d'un écran, tenue en tête du journal (les entrées restent).

**C10 — Les vagues 3 et 4 de l'audit n'ont pas bougé.** Je ne trouve dans le journal depuis le 10 aucune trace des sauvegardes
(3.3), du réseau RD0–RD1 (3.1), de la politique de temps (4.2), de la séparation de `Settings` (4.3), du budget de performance
automatisé (1.3). Ce sont des contrats du §19 de la destination, et ils ne touchent pas les fichiers du rendu.

## 5. Les idées, par valeur attendue

**Idée 1 — Classer l'écran par tuiles, lancer chaque noyau là où il sert.** *Constat (code)* : `earth lite`, `earth lite: light`,
`earth lite: finishing`, `earth water`, `earth water open` sont cinq `dispatchWorkgroups(⌈largeur/8⌉, ⌈hauteur/8⌉)` plein écran
(`src/renderer.ts:7417–7465`) ; aucun `dispatchWorkgroupsIndirect` dans `src/`. *Constat (mesures)* : une passe plein écran qui
ne fait que sortir coûte 1,5 ms sur le mini (commentaire `renderer.ts:7451`) ; avant PLAN-MER S2, `earth lite` coûtait 37 ms sur
une vue presque toute marine. *Proposition* : une petite passe de calcul lit la visibilité et les marques, écrit par classe (sol,
bâtiment, arbre, rivage, pleine mer, ciel) la liste des tuiles 8 × 8 qui en contiennent et les arguments d'un lancement
indirect ; chaque noyau parcourt sa liste. *Ce que cela ouvre* : des noyaux **spécialisés par classe**, chacun petit — la
réponse générale à la « présence », au lieu d'un découpage au cas par cas (`shadeWaterOpen`, `withLiteDeferred`,
`shadeLiteFinish` en sont déjà trois). *Preuve* : ΔGPU J0 sur le mini ; images identiques (A/B figé ±1 %). *Risque* : les tuiles
mixtes aux frontières (les lancer dans les deux listes) ; une variante de pipeline de plus par classe à compiler (cascade,
`kernel-budget`).

**Idée 2 — Étager l'eau maintenant, comme le sol l'a été.** *Constat* : `earth water` est la première passe de calcul sur les
deux machines ; trois retraits indépendants y rendent chacun ~8,8 ms sur une vue de mer (ombres du Soleil, Fresnel moyenné,
hauts-fonds absents de la vue — PLAN-MER §4) : le noyau est juste au-dessus d'un seuil. *Proposition* : surface (pentes,
écume, profondeur d'eau) → éclairage (Soleil, ciel, corps de l'eau) → reflets (SSR, sonde), trois noyaux et un enregistrement
intermédiaire, le découpage que `withLiteDeferred` a fait pour le sol (forêt 42,1 → 39,5 ms). *Preuve* : la sonde
`sea-compare` et J0 sur le mini. *Préalable* : réparer l'ablation de l'eau de la fiche J0 et en ajouter une pour `sea surface`
(le levier `seaSurfaceOn` existe).

**Idée 3 — Vérifier l'hypothèse « registres » avec les outils d'Apple, puis en faire un budget.** Toute la doctrine des noyaux
(PERFORMANCE.md, PLAN-LEAN, PLAN-MER) repose sur « le noyau est limité par ses registres », déduit d'A/B, jamais observé. À
faire une fois : sortir le MSL que Dawn produit pour `shadeWater` (bascule de diagnostic de Dawn pour l'export des shaders) et
le passer au profileur de shaders d'Xcode ou à Instruments sur le processus GPU de Chrome. D'autres causes donneraient le même
symptôme et d'autres remèdes : l'initialisation à zéro des variables locales qu'impose WGSL, les grandes structures passées par
valeur, les gardes de robustesse. *C'est un domaine où je me fie peu à mes a priori : lire la documentation de Dawn et de Metal
avant d'agir.* Ensuite, un budget suivi comme `kernel-budget` suit la taille : **ms par mégapixel et par noyau** sur le mini,
dans la fiche J0.

**Idée 4 — L'albédo à la résolution de sortie, la lumière à échelle réduite.** *Constat* : contre une référence à pleine
échelle, en virage, le PSNR vaut 30,4 dB à 2/3, 32,5 à 0,75, 34,3 à 0,80 (journal, 13 nov. 05:23Z) : la qualité suit presque
linéairement les pixels, donc ce que l'on perd est du détail de texture (les orthophotos), que la TAAU ne rend pas. Et baisser
l'échelle à 2/3 ne rend que ~8 % de GPU. *Proposition* : le découpage matériau / éclairage existe ; évaluer le **matériau**
(lecture d'imagerie, peu de calcul) à la taille de sortie et l'**éclairage, l'eau, les nuages** à 0,5–0,67, remontés par un
filtre guidé par la profondeur, la normale et l'identité à pleine taille ; l'historique porte l'éclairage, l'albédo est
remultiplié net. C'est la séparation albédo / irradiance des reconstructions modernes. *Preuve* : `motion-quality` à GPU égal.
*Risque* : le matériau coûte plus cher à pleine taille (×1,8 de pixels) ; les ombres nettes et le spéculaire supportent mal
la demi-échelle. Un pilote, pas une certitude.

**Idée 5 — Une cadence régulière, qui laisse le Mac froid.** *Constat* : sur le mini l'intervalle alterne 60 et 80 ms (p50 60,
p95 80, écran à 50 Hz) : une saccade à cadence moyenne égale ; le M1 Max non borné (`fpsCap` 0 par défaut) tourne à 100 % et
bride en trois minutes (frais 43,9 images/s, soutenu 33,4). *Hypothèse à tester, réglages seuls* : bornée à 30 images/s
(`fpsCap`, `main.ts:8654`), la charge du M1 Max tombe vers 70 % ; s'il ne bride plus, « 30 stables » vaut mieux que « 44 puis
33 irréguliers », et le palier se juge enfin dans un état tenable. Ensuite un verrou automatique sur un nombre entier de
rafraîchissements, choisi par le p95 mesuré (40 images/s sur un écran 120 Hz, 25 ou 50 sur le mini). À vérifier aussi, hors
code : le mode d'énergie du Mac et ce qui tourne à côté pendant les mesures.

**Idée 6 — Fermer le non-attribué.** ≈ 7 ms sur le M1 Max, ≈ 12 sur le mini : c'est plus que n'importe quel lot de J1–J2 n'a
rendu. (a) Une **matrice d'ablations qui couvre toute la frame** — aujourd'hui elles totalisent 13,6 ms sur 59 (nuages,
appareil, décor, HUD, ombre) : ajouter `sea surface`, l'eau réparée, le sol, la reconstruction, l'affichage, puis un démontage
cumulé jusqu'à la frame vide, qui donne le plancher. (b) **La fiche J0 sur kerr-pc** : un GPU non tuilé, où les horodatages
des passes de rendu sont probablement attribuables (à vérifier), et le seul point de mesure du public Windows.

**Idée 7 — Rejouer les tuiles depuis le disque pour J0.** `tests/e2e/lib/tile-replay.ts` le fait déjà pour `tile-arrival` ;
ni `j0-reference`, ni `motion-quality`, ni `j2-probes` ne l'emploient. Avec lui : J0 hors réseau (la « référence synthétique
sans réseau » de la stratégie §15), une entrée à froid répétable, et la fin de la règle « un seul e2e IGN à la fois » — que la
session a enfreinte elle-même le 13 (un `surface-id` échoué pendant la séance J0 du mini). Trois machines mesurent alors en
parallèle.

**Idée 8 — Le fil principal.** CPU p95 8,4 ms (mini) et 6,6 ms (M1 Max) pour un seuil de 4 ; le tas JS monte de 552 à 850 Mo en
70 s de vol, soit ~4 Mo/s de déchets (calculé sur la fiche). Le code alloue par image (`u.set([...S.tuC, …])`,
`renderer.ts:7366`). Personne ne possède ce poste. Une sonde « octets alloués par image » et une passe de nettoyage des
allocations de la boucle rendraient des pointes d'intervalle sans toucher au GPU.

## 6. L'ordre que je propose

| # | Lot | Pourquoi d'abord | Taille |
|---|---|---|---|
| 1 | **Fermer J2 par sa page « chemin vers §8 »** (le tableau du §2, tenu à chaque fiche) ; réparer l'ablation de l'eau, ajouter `sea surface` ; `fpsCap` 30 essayé sur le M1 Max | sans code de rendu ; décide tout le reste | S |
| 2 | **J0 hors réseau** (idée 7) et deux scènes légères (ville basse, Alpes en virage) | chaque lot suivant se mesure plus vite et sur trois machines | S–M |
| 3 | **L'eau étagée** (idée 2) | premier poste hors budget, preuve déjà dans le dépôt | M |
| 4 | **La classification par tuiles** (idée 1), d'abord pour l'eau et le ciel, puis le sol | généralise le lot 3 ; prépare J3 et J4 | M–L |
| 5 | **Le non-attribué** (idée 6) et le fil principal (idée 8) | ≈ 7 ms sans propriétaire | M |
| 6 | J3 (lumière, cockpit), avec un budget par noyau dès sa naissance (idée 3) | la richesse sur des noyaux petits | L |
| en parallèle | **Une seconde session sur les vagues 3 et 4 hors rendu** (sauvegardes, réseau RD0–RD1, politique de temps) | aucun fichier commun avec le rendu ; CM0–CM3 ont été délégués ainsi | M chacun |

L'idée 4 (albédo à pleine taille) se pilote après le lot 4 : elle a besoin de noyaux séparés par classe pour rester simple.

## 7. Décisions pour Sam

**Décidé par Sam le 13 novembre 2026 (« oui ») : les points 1 à 4** — consignés dans CLAUDE.md, [J0-CONTRAT](J0-CONTRAT.md) §2 et §11,
la [stratégie](ANALYSE-STRATEGIE-RENDU-2026-11-03.md) §24 ; les vagues 3 et 4 de l'audit confiées à une seconde session. Les points 5
et 6 restent ouverts.

1. **L'eau et le découpage des noyaux avant J3** — recommandé : oui.
2. **Le mini a-t-il une cible ?** 60 images/s à 1080p sur un M1 à 8 cœurs GPU demanderait de diviser la frame par 3,5 ; le §8.1
   prévoit un « profil matériel plus modeste ». Recommandé : nommer pour lui 25 images/s régulières (deux rafraîchissements
   à 50 Hz) comme palier, et garder le 60 pour le M1 Max.
3. **Le palier se juge borné et soutenu**, pas frais à 100 °C — recommandé : oui, après l'essai de l'idée 5.
4. **Réécrire « Socle raster forward » dans CLAUDE.md** selon la décision du 12 (C3).
5. **Les trois règles de méthode** : le plafond de gain écrit avant un lot (C1), le retrait daté de l'ancien chemin d'un levier
   allumé (C6), les deux témoins d'une sonde (C7).
6. **Une page « état courant » en tête du journal** (C9).

## 8. Ce que je n'ai pas vérifié

- Rien n'a été exécuté : aucune des idées n'a de mesure ; les gains attendus ne sont pas chiffrés à dessein.
- Les lignes « non attribué » du §2 sont une soustraction entre `lastGpuMs` et des horodatages moyennés sur une image sur
  quatre ; l'ordre de grandeur tient, pas le dixième de milliseconde. Les deux fiches sont à un jour et un commit d'écart
  (l'A/B des lots entre les deux : nul).
- Je n'ai lu ni `trace.wgsl` en entier (17 395 lignes) ni les 9 700 éléments de la session ; ses premiers et derniers tours,
  le journal et les plans.
- La cause « registres » (idée 3), la fiabilité des horodatages sur kerr-pc (idée 6) et l'effet d'une borne de cadence sur le
  bridage (idée 5) sont des hypothèses.
- La session `33d89754` tournait encore pendant cette lecture (le couloir du plafond des bâtiments, quatre fichiers modifiés
  non commités) : son état a pu avancer depuis `d9b2557b`.
