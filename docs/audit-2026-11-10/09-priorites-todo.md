# Audit 2026-11-10 — 09. Priorités et liste de travail

Ce fichier ordonne le travail qui sort de l'audit ([synthèse](README.md)). Il ne remplace pas le reste à faire
consolidé de tous les plans, qui est au §6 de [07-plans-reste-a-faire.md](07-plans-reste-a-faire.md).

**État au 10 novembre, 09:30 UTC** : la vague 0 est faite sauf 0.4 (l'hébergement des binaires : orientation de Sam, choix
à venir ; **décidé le 12 novembre : le serveur de Sam**, mise en place à faire) — voir la colonne « État » ; le reste n'est pas commencé. **Vagues 3 et 4 relevées le 13 novembre** (colonne « État ») par la session hors rendu ; les lignes laissées à la session du rendu le disent. Les tailles sont grossières : S (moins d'un jour), M (quelques jours), L (une à deux
semaines), XL (plus). Aucun gain n'est promis : chaque lot porte la mesure qui le jugera.

## 1. La règle de tri

1. Ce qui peut **perdre le travail** ou **bloquer la livraison** passe d'abord (heures, pas jours).
2. Ensuite ce qui **décide de tout le reste** : les décisions de Sam et la mesure de référence.
3. Ensuite la plainte du jour : **les tuiles**.
4. Ensuite ce qui **casse l'expérience** d'un joueur aujourd'hui.
5. Ensuite les **fondations** de la destination, puis la bascule.
6. La richesse (nouveaux effets, nouveau contenu) vient après, au budget fixé — c'est l'ordre de la stratégie §20.5,
   que les lots du 3 au 8 novembre ont inversé.

## 2. Décisions que Sam doit prendre

Les 26 décisions en attente sont au §4 du [rapport 07](07-plans-reste-a-faire.md). Celles-ci bloquent le plus :

**Prises par Sam le 10 novembre** ([stratégie §22.4](../ANALYSE-STRATEGIE-RENDU-2026-11-03.md)) : D1 la vague 0 d'abord,
puis J0 ; D2 la scène de référence à Toulon-Hyères (la côte) ; D3 le palier à 25 ms sur M1 Max ; le gel des nouveaux
lecteurs de `shadeLite` et `trace.wgsl` jusqu'à J0, sauf correctif. La ligne 0.2 (ST1) est faite (`5be997b9`).

| # | Décision | Ma recommandation |
|---|---|---|
| D1 | Le prochain jalon | J0 d'abord (contrat d'acceptation, 2–3 jours), puis J1. C'est la recommandation du 5 novembre ; l'audit la confirme. |
| D2 | La scène de vol de référence | Décollage puis virage sur une ville IGN, cockpit, heure et météo fixées. Paris ou Le Bourget : c'est là que le chargement et le matériau coûtent le plus. |
| D3 | Le palier de cadence | Nommer 40 ms sur kerr-mini « palier 1 », mesurer M1 Max, puis fixer le palier suivant sur cette mesure. |
| D4–D5 | Relire C0, budget de Q1 | Une séance d'une heure avec la fiche J0 sous les yeux. |
| D6 | Propriétaires du temps, du sol de contact, de la vue, de l'image | Les nommer dans J0 ; le sol de contact en premier (AR-01). |
| — | Geler les nouveaux lecteurs de `shadeLite` et `trace.wgsl` jusqu'à J0 | Oui, sauf correctif ; sinon chaque ajout porte sa condition de retrait. |
| — | Niveau de défense du réseau : entre amis, ou salles publiques | À dire avant RD3 ([PLAN-RESEAU-DURCISSEMENT](../PLAN-RESEAU-DURCISSEMENT.md) §4). |
| — | Licence du dépôt et crédit de l'A320 (GPL v2) | À faire valider par quelqu'un de compétent ; au minimum le crédit. |
| D8, D7 | Les douze options coupées | Une condition de retrait écrite ou la suppression. |
| D13 | Où héberger les gros binaires | Urgent : 591,6 Mo sur 600. **Décidé (Sam, 12 nov.) : sur son serveur**, pas en release GitHub ([ASSETS.md](../ASSETS.md)) ; 600,0 Mo sur 600 ce jour-là. |

## 3. La liste ordonnée

### Vague 0 — aujourd'hui : ne rien perdre, pouvoir livrer

| # | Travail | Constats | Taille | État |
|---|---|---|---|---|
| 0.1 | Commiter la référence stratégique, l'analyse du streaming, les deux pages HTML, cet audit et les deux plans | QA-24, AR-22, PL-40 | S | fait (`fcddd376` ; les deux pages HTML avec la vague 0) |
| 0.2 | Commiter le lot ST1 (12 fichiers, dans la copie de travail depuis le 6 novembre) après ses tests et son e2e `zones-usa-night` | ST-18, PL-41 | S | fait (`5be997b9`) |
| 0.3 | Un hook avant push : `biome ci`, `tsc`, `check-wgsl`. La CI ne doit plus rougir sur du format. | QA-01 | S | fait : `.githooks/pre-push` + `scripts/pre-push.ts`, sur la révision exacte poussée (worktree temporaire), + `check-repo-size` ; ≈ 25 s ; [DEPLOY.md](../DEPLOY.md) |
| 0.4 | Taille du dépôt et du site : décider où vont les binaires avant le prochain ajout | QA-03, D13 | S + décision | **orientation de Sam (10 nov.)** : samlepirate.org, une release GitHub ou son autre serveur Portainer ; choix « ces prochains jours » ([ASSETS.md](../ASSETS.md)) ; **décidé le 12 nov. : le serveur de Sam** (une release GitHub écartée : pas de CORS) — la mise en place reste à faire |
| 0.5 | Ignorer ou ranger les fichiers jetables (30 Mo, 36 sondes `zz-*`) | QA-25, AR-23 | S | fait : ignorés par git (donc Biome), exclus de `tsc` et de `bun run e2e` sauf par leur nom ; rien d'effacé ; [E2E.md](../E2E.md) §5 |
| 0.6 | Crédit de l'A320 dans `CREDITS.md` et `credits.ts` | QA-22 | S | fait : A320-family (GPL v2) et police ECAM (GPL v3), vérifiés contre `assets/a320/README.md` par `title-credits` ; la licence du dépôt reste à trancher |
| 0.7 | Previews de branches hors de l'origine de la production, ou clés hors `localStorage` partagé | QA-04 | S–M | fait (Sam : une preview ne doit pas pouvoir lire les clés) : `/test/` et `/ineptie/` retirées de l'origine de Pages, environnement `github-pages` limité à `main`, un worker et une page de fermeture (`pwa/retired-preview/`) vérifiés dans Chrome ; une preview ne revient que sur une autre origine ([DEPLOY.md](../DEPLOY.md)) |

### Vague 1 — cette semaine : J0 et la mesure

| # | Travail | Constats | Taille | État |
|---|---|---|---|---|
| 1.1 | **J0** : le contrat d'acceptation, la scène de référence, sa fiche (images terminées, médiane, 95ᵉ et 99ᵉ centiles, mémoire, thermique, qualité) sur M1 Max et kerr-mini | GP-09, PL (D1–D6) | M | écrit et mesuré le 10 nov. : [contrat](../J0-CONTRAT.md), [mesures](../progress/j0/README.md) ; seuils et état soutenu validés par Sam le soir même : **J0 atteint** (palier 1 non atteint) |
| 1.2 | La frame répartie par poste, par ablation sur images terminées (sol, nuages, cockpit, affichage) | GP-09, GP-06 | M | fait sur kerr-mini (fréquence stable) : sol et eau ≈ 53 ms sur 65, nuages 5,8, décor 3,8, appareil < 1 ; le M1 Max bride (ablations non comparables) |
| 1.3 | Un budget de performance automatisé : la scène de référence rejouée avec un seuil, à la main d'abord, en file ensuite | QA-12 | M | — |
| 1.4 | CM0 : le chemin réel des tuiles mesuré (service worker, liaison bridée) | ST-21, ST-02 | S | — |
| 1.5 | Corriger les en-têtes de plan faux, marquer « absorbé » les plans de rendu terrestre remplacés, réconcilier C0-8 et C0-2 avec le code | PL-02 à PL-14 | S | — |

### Vague 2 — les tuiles ([PLAN-CHARGEMENT-MONDE](../PLAN-CHARGEMENT-MONDE.md))

| # | Travail | Constats | Taille |
|---|---|---|---|
| 2.1 | CM1 : plus de trou définitif, plus de dépendance en chaîne | ST-03, ST-04, ST-05 | S |
| 2.2 | CM2 : le portillon de la Géoplateforme séparé par service | ST-02 | S |
| 2.3 | CM3 : précharger le lieu de départ pendant le titre | ST-15 | S |
| 2.4 | CM4 : moins d'octets de relief (halo, sursol, niveau selon la vitesse) | ST-01, ST-11 | S puis M |
| 2.5 | CM5, CM6 : imagerie ordonnée, service worker plus léger | ST-08, ST-10, ST-16, ST-17 | M |
| 2.6 | Décor : worker gardé au saut, recul court (petits) ; puis ST3 + ST6 (cellules et cache cuit) | ST-12, ST-13, ST-14 | S puis L |

### Vague 3 — ce qui casse l'expérience aujourd'hui

À reproduire par un e2e avant de corriger : aucun n'a été rejoué pendant l'audit.

| # | Travail | Constats | Taille | État |
|---|---|---|---|---|
| 3.1 | Réseau RD0 + RD1 : reproduire puis fermer la frontière d'entrée ; isoler la frame des erreurs d'événement | NET-01, NET-06, NET-07, AR-03 | M | **fait (13 nov.)**, reproduit avant (e2e `net-inbound` : `match`, `tel`, `dock` mal formés figeaient l'image, 163 → 0 images ; NaN gardé ; mauvais `match` rejoué) : frontière d'entrée `src/net/inbound.ts`, client, serveur, liens directs, gardes réseau de l'image, version refusée aussitôt ([NETWORK.md](../NETWORK.md)) |
| 3.2 | Réseau RD2 : quotas, débit, identité par jeton | NET-02, NET-03, NET-04 | M | **fait (13 nov.)**, six défauts reproduits avant (`tests/net-server-defence.test.ts`) : salles par adresse et par heure, expiration à 30 jours, seau de messages JSON, mots de passe freinés et salés, identifiant d'appareil jamais publié (identifiant public), rôle gardé à la reprise, TURN aux membres. Reste : relais Deepgram (TA-14), NET-05 (RD4) ; `X-Real-IP` en production non vérifié |
| 3.3 | Sauvegardes : une clé par sauvegarde, jamais d'écrasement silencieux ; l'état des avions, des missions et des combats sauvé ; « Reprendre » sur le bon instantané | AR-19, AR-09, FX-09, FX-10 | M | **fait pour l'essentiel (13 nov.)**, chaque défaut reproduit avant : une clé par sauvegarde, rien écrasé en silence (`736b26a2`) ; « Reprendre » du vol perdu seulement, un avion a ses points ; l'état de l'appareil (carburant, train, volets, freins, maintiens, systèmes des vaisseaux) sauvé, l'activité en cours dite (`f265f467`). Reste : l'état d'une mission ou d'un combat (décision de Sam), les systèmes de l'A320, IndexedDB et l'autosauvegarde hors frame (AR-05) |
| 3.4 | Décollage et atterrissage automatiques cohérents : U et F7 des avions, Lander posé ; un refus se dit et rend la main | FX-02, FX-03 | M | **fait (13 nov.)** : Lander posé (`2e51b40d`), U du F-35 sur piste (`3ae30d6b`), grisés du HUD (`ba4a1fb1`) ; puis, reproduit avant (e2e `aircraft-autokeys` : manette 0,6 → 0), F7 = approche ILS (F-35, A320 par son FMGC), U en l'air refusé et dit, jamais l'autopilote orbital ; LAND annonce F7 ; docs corrigées. Reste : abandon dit du Lander après N s (FX-03) |
| 3.5 | Maj et Alt : modificateur ou manette, pas les deux à la fois | FX-01 | S–M | **fait (13 nov.)**, reproduit avant (`tests/pilot-modifiers.test.ts`) : Maj/Alt la manette seulement seules ou avec les touches de vol, au bout de 0,1 s ; un accord les neutralise jusqu'au relâchement ; e2e `modifier-keys` en vraies touches ; cours revolé |
| 3.6 | TARS : annulation d'un tour, confirmation de `saves delete`, erreurs réseau dites, « annule » hors ligne | TA-01, TA-02, TA-05, TA-08 | M | **fait (13 nov.)**, chacun reproduit par test avant : tour coupé fini (TA-01), `saves delete` confirmé (TA-02), panne dite par sa cause (TA-05), faux ordres hors ligne (TA-08) |
| 3.7 | TARS : outils du pilote automatique des avions et de l'A320, par les mêmes actions que la console d'équipage | TA-03, TA-10 | M | **fait (13 nov.)**, reproduit avant par test : outil `jet_autopilot` (les actions de la console, `controller/jet-ap-acts.ts`), volets au levier (l'A320 en CONF 1) ; et l'AP de l'A320 dans `apSet` (il basculait à chaque demande) réparé ; e2e `tars-aircraft-tools`. Reste : MCDU/FMGC complet par TARS |
| 3.8 | Compilation de Jupiter : anticiper dès que la destination est choisie, puis réduire le noyau | GP-20 | M | session du rendu |
| 3.9 | Garde « fini et borné » dans `resolve`, sonde des pixels non finis (image noire de Jupiter sud) | GP-10 | S | session du rendu |
| 3.10 | Les e2e qui ne vérifient rien : membres inexistants, fichiers sans `expect`, `waitFor` avalés | QA-08 | M | **fait (13 nov.)** : membres inexistants (`3ae30d6b`) ; attentes avalées converties en `app.waitOptional` (93 dans 70 fichiers ; 1 reste chez la session du rendu), 14 mesures sans `expect(` déclarées « no assertion » ; garde `tests/e2e-honesty.test.ts` (échoue sur l'arbre d'avant). Reste : ~23 `.catch(() => {})` hors attentes |

### Vague 4 — les fondations de la destination

| # | Travail | Sert | Constats | Taille | État |
|---|---|---|---|---|---|
| 4.1 | **Le service de sol** : le monde possède le support et sa révision ; l'appareil ne lit plus un échantillonneur installé par le renderer | §19.4, §7.4 | AR-01 | L | fait pour l'essentiel (J2-2, `10b758d3`, [PLAN-J2](../PLAN-J2-PAGES-RECONSTRUCTION.md) §9 quater) — session du rendu |
| 4.2 | **La politique de temps** : onglet masqué, reprise GPU, trous, une seule horloge pour la logique de vol | §19.3 | AR-02, AR-08 | M | fait (13 nov.) : l'horloge de la frame du renderer (J1-1) ; puis, chacun reproduit avant par e2e, le vol tenu pendant la reprise GPU (AR-02), la cadence sur le temps mural (AR-06), 5 décisions de vol sur `frameNow` et un garde `flight-clock` (AR-08). Puis (13 nov., choix de Sam : « ok pour les recommandations ») **l'onglet masqué** (`src/game/out-of-view.ts`) : sauvé en partant ; seul, pause ouverte et dite au retour (combien de temps), rien rattrapé ; en salle rien n'arrête, les autres avertis, la demande d'allure de l'absent non comptée (NET-14), sa scène remise à l'heure de la salle au retour et dit ; pas de réveil de TARS masqué ou en pause (TA-06) ; **le ralentissement sous 10 images/s dit** (toast, « temps NN % » au compteur). **Fait** |
| 4.3 | **Séparer `Settings`** : préférences, scène, état simulé, pose de vue | §19.12 | AR-07, AR-21 | L | en partie (13 nov.) : le classement `SETTING_KIND` (219 pref, 118 scene, 51 carried) existait déjà ; **le garde statique d'AR-21** ajouté (`tests/settings-schema.test.ts` : chaque défaut dans ses bornes, parmi ses options, de son type ; chaque réglage a sa nature ; témoin vu) — aucun écart aujourd'hui (372 contrôles, 388 réglages). AR-07, côté producteur (choix de Sam : « la session du rendu le fait » pour le renderer) : **`ViewPose` et `SimState`** (`src/game/view-pose.ts`) faits une fois par image et figés, `VIEW_POSE_KEYS` seule liste (le spectateur aussi), `__bh.viewPose()` / `__bh.simState()` ; coût 0,01 ms (pire 0,1) ; e2e `view-pose`. **À la session du rendu** : `renderer.frame(viewPose, …)` au lieu de `Settings` entier |
| 4.4 | **Le contrat de surface** : profondeur finale, identité et génération, mouvement, couleur, derrière une interface ; les 62 lecteurs passent par elle | §7.4, C0-2 | GP-03, GP-04 | L | session du rendu |
| 4.5 | **Le layout de `Params` vérifié** par un test (WGSL contre TypeScript), puis `webgpu-utils` à J1 | §18.5 | GP-31 | S | fait (J1-0, `4a37a4b6` : `webgpu-utils`, `src/gen/params-layout.ts`, test et portillon avant push) |
| 4.6 | **Un gouverneur sur le poste chargé** : cible à taille fixe et viewport dynamique, paliers sans pulsation | §7.14 | GP-06, GP-24, GP-08 | L | session du rendu |
| 4.7 | **Trancher et retirer** les options coupées ; sortir `shade` et `shadeMark` de la frame en mode « auto » | §20.7 | GP-17, GP-07, GP-18 | M | session du rendu |
| 4.8 | **Découper `main()`** par responsabilité, en commençant par la boucle d'image (ordre simulation, vue, instruments, rendu) | §19.12 | AR-12, AR-04, AR-05 | L | en cours (13 nov.) : `main()` `main.ts:415-10206`, boucle `8474-9776`. Lot 1 (choix de Sam : le plus petit d'abord) : **la persistance** sortie dans `src/game/persistence.ts` (autosauvegarde, préférences, quand elles s'écrivent : la boucle, `pagehide`, le hors-de-vue) — testée seule (unitaires), e2e `saves-storage`. AR-05, sa part autosauvegarde **mesurée** (e2e `autosave-cost`, sonde témoin +5 ms lu +5,1, A/A 0,00) : 0,3 ms en orbite, 0,8 ms en F-35 (médianes), 1,2 ms au pire, toutes les 10 s — gain plafonné sous 1 ms (règle 1) : **pas sortie de la frame**. Le reste d'AR-05 lu par section (e2e `loop-cpu`, sonde vérifiée) : aucun poste moyen au-dessus de 2 ms ; **la mini-carte du HUD** en orbite, 0,6–0,75 ms en moyenne mais **10–13 ms au pire, dix fois par seconde** (des à-coups) — 75 % dans l'éphéméride (`helioNow`), ~4 000 instants distincts par seconde, 6 réutilisés la seconde suivante : un mémo plus grand n'y peut rien ; premier levier fait (13 nov.) : la trajectoire prédite porte la place de son corps de référence (`OurPath.refPos`, calculée dans le worker), lue par les apsides et le plus proche passage — A/B 2 × 2 passes, dessin de la carte −12 à −20 % (312–322 → 252–285 ms sur 6 s de profil) ; puis **le treillis d'instants** (`ui/map3d/scene.ts` : les places des mondes tous les k·2 min, gardées d'un dessin et d'une trajectoire à l'autre ; le plus proche passage de la carte lu dessus) — A/B 2 × 2 : dessin 256–273 → 103–107 ms sur 6 s, éphéméride 167–177 → 27–28 ms ; **cumulé ≈ −67 % (≈ 5,3 → 1,7 ms par dessin)**, carte et marques identiques à l'image. **En jeu** (e2e `loop-cpu`, sonde vérifiée) : la section de la carte 0,6–0,75 → 0,13–0,22 ms en moyenne, **10–13 → 2,9 ms au pire** ; le HUD entier au pire 11–15 → 6,2–6,5 ms. `drawOurPaths` (~0,3 ms par dessin) sous le seuil d'un lot (règle 1) : laissé. **AR-05 : l'autosauvegarde et la mini-carte fermées par la mesure** ; les lectures de mise en page du cockpit de l'A320 mesurées négligeables (2 ms sur 6 s) ; trouvé en le mesurant : **le rig de l'A320** (`a320/rig.ts rigMatrices`, 1 234 nœuds du poste) allouait 2 à 5 matrices par nœud et par image — réécrit en place, résultats identiques bit à bit, A/B Chrome 2 × 2 profils : 499–526 → 117–120 ms sur 6 s (−77 %), fil principal −8 à −11 % dans le cockpit. Lot 2 : **`src/game/session.ts`** — qui tient le vol (figé, pause, reprise GPU, rendu, replay), une réponse demandée par la boucle (`session.runs`, `session.moving`) au lieu de la même condition recopiée quatre fois ; `__bh.held()` ; comportement inchangé (e2e hidden-tab, gpu-recovery-hold, aircraft-save, fps-truth 6/6). Lot 3 (accord de Sam, par petits lots) : **les étapes gardées** (`src/game/frame.ts`, AR-03) — le vol, à pied, les chiffres du vol, les missions, le trafic, les repères de la vue, le dessin du vol : une exception y coûte l'étape, dite une fois, mise de côté et réessayée toutes les 5 s, jamais l'image (e2e `frame-guard` : 0 → 66–179 images en 2 s, le journal non noyé). Lot 4 : **les étapes d'après le rendu et le reste d'avant** gardées (le replay, le ciel, le voyage, les instruments et le HUD, la musique) — une exception dans les instruments sautait toute la fin de la frame, à chaque image (e2e : 0 → 181 fins de frame en 1,5 s). Restent nus : le gouverneur de résolution (leviers du rendu) et les entrées du renderer. Suivant proposé : l'ordre §19.5 (AR-04, les instruments avant l'encodage) — il change l'ordre du travail GPU : avec la session du rendu |
| 4.9 | **L'ordonnanceur unique** du chargement (ST2), sur les morceaux CM2 et CM5 | §7.19 | ST | L | session du rendu |

### Vague 5 — la bascule

| # | Travail | Constats | Taille |
|---|---|---|---|
| 5.1 | **J1** : l'opaque terrestre en forward sur le domaine pilote (terrain et bâtiments), jugé sur la scène de J0 ; il remplace `shadeLite` dans ce domaine, il ne s'y ajoute pas | GP-01, GP-02 | XL |
| 5.2 | Q6 sur ce contrat : poses précédentes, désocclusions, variation de résolution | GP-29 | L |
| 5.3 | Validité par tuile (CM8, ST9) et publications GPU bornées (CM7, ST5) sur l'interface de surface | ST-06, ST-07 | L |

### Vague 6 — ensuite, au budget

Réseau RD3 à RD6 (droits, état repris, liaison, monde commun) ; TARS allégé (TA-04 : moins d'outils par tour, cache
du prompt) ; écouteurs et promesses (AR-17, AR-18) ; manette et école de l'A320 (FX-07) ; unités et traductions en dur
(FX-17, FX-18) ; mise à jour du service worker (QA-16) ; CSP (QA-18) ; catalogue des e2e (QA-11) ; puis la richesse
des plans ouverts (aurores AM5, nuit urbaine, planètes P10, aviation, A320 A15–A19, capteurs), chacune sur les
interfaces de la vague 4. Pour la mer, le littoral et la végétation, l'ordre et les lots sont précisés par
[l'analyse du 10 novembre](../ANALYSE-MER-LITTORAL-VEGETATION-2026-11-10.md) (M1–M5, L1–L4, V1–V6).

## 4. Ce qu'il ne faut pas faire

- **Ajouter de la richesse dans `shadeLite` et `trace.wgsl` avant J0.** C'est ce qui s'est passé du 3 au 8 novembre.
- **Optimiser sans la répartition de la frame.** Sans la mesure 1.2, un gain sur un poste peut ne rien changer au total
  (stratégie §4.2).
- **Corriger un défaut de comportement lu dans le code sans le reproduire.** L'audit n'a rien rejoué en jeu.
- **Lancer ST3 à ST6 (le décor par cellules) pour répondre à « les tuiles sont lentes ».** Ce chantier sert le décor ;
  les tuiles ont leurs causes propres, moins chères à traiter (vague 2).
- **Écrire J1 à côté de l'existant.** Une nouvelle implémentation remplace une responsabilité nommée (§20.7).

## 5. Ce que l'audit n'a pas couvert

- Aucune mesure nouvelle : cadence, mémoire, compilation, débit réel de la liaison de Sam.
- Aucun défaut de comportement reproduit en jeu.
- La qualité d'image jugée à l'œil (captures) : non faite.
- Le PC Windows (kerr-pc) et l'iPad : aucune vérification ; l'iPad n'a pas été retesté depuis le 5 octobre (QA-17).
- Le projet d'Alex : ses notes récentes portent sur les nuages et les aurores du casque ; rien de neuf sur les tuiles
  ou le réseau à comparer.
- Le droit des licences : signalé, pas tranché.
