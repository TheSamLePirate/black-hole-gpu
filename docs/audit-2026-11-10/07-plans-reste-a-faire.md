# Audit 2026-11-10 — 07. Plans, reste à faire et trajectoire

Audit en lecture seule, fait le 10 novembre 2026 sur `main` à `29d4e5e3` (dernier commit : 8 novembre, 21:13 +0100).
Aucun code modifié, aucun test, e2e, serveur ni benchmark lancé. Sources : les 45 `docs/PLAN-*.md`, l'analyse
stratégique, le journal, `git log`, `git branch`, `git worktree`, `git status`, des `grep` dans `src/`.
Préfixe des constats : **PL-**.

Limites de cet audit :
- Les plans d'octobre terminés (HUD, HUB, CARTE, CIEL, METEO…) sont vérifiés par leur tableau d'état et par la présence
  des modules cités, pas phase par phase.
- Les chiffres de cadence cités viennent des documents. Aucun n'a été remesuré.
- L'analyse stratégique et l'analyse du streaming sont lues dans la copie de travail : elles ne sont pas dans git (PL-40).

---

## 0. Synthèse

1. **La destination est écrite, pas engagée.** Depuis le 3 novembre : 0 lot de fondation au sens du §20.4, 0 lot de
   bascule, 0 jalon J0–J5 atteint. J0 (2–3 jours, « sans regret », §21.4) attend une décision de Sam depuis le 5 novembre.
2. **Le risque « roadmap déclarative » (§20.9, §21.2) s'est aggravé.** Du 3 au 8 novembre, `trace.wgsl` et `renderer.ts`
   ont pris +4 167 / −478 lignes (`git diff --numstat b2048dba HEAD`). Après le constat du 5 novembre : encore
   +830 / −73 lignes sur ces deux fichiers, 59 commits, aucun de fondation.
3. **Quatre plans sont réellement en cours** : T/Q/H/R (PLAN-REFRACTION-HORIZONS), aurores et magnétosphères, nuit
   urbaine, streaming ST0–ST10. Trois plans restent ouverts sans activité récente : planètes (P10), aviation (C4, T4, T5),
   A320 (A15–A19). Deux plans n'ont jamais commencé : capteurs, services serveur.
4. **Gouvernance fragile.** Le document de référence stratégique n'est pas commité. Le lot ST1 (zones hors ligne) est
   déclaré « fait » mais n'existe que dans la copie de travail depuis le 6 novembre. Le journal a manqué au moins quatre
   lots du 6 novembre. 125 e2e suivis sur 396 n'apparaissent pas dans le catalogue.
5. **Aucune activité commitée les 7, 9 et 10 novembre** ; un seul commit le 8.

---

## 1. Tableau de tous les plans

Légende de l'état : **terminé**, **en cours**, **ouvert dormant** (des phases restent, aucun commit récent),
**jamais commencé**, **absorbé** (repris par un autre plan), **abandonné**.

### 1.1 Plans actifs ou ouverts

| Plan (date) | État réel vérifié | Phases restantes | Preuve | Décisions de Sam en attente |
|---|---|---|---|---|
| **PLAN-REFRACTION-HORIZONS** — T/Q/H/R (31 oct., relu le 5 nov.) | **En cours.** En-tête juste au 5 nov., non mis à jour depuis (T8k–o, Q6-ISS, lots D/E faits après) | Voir §0.2 du plan : T4 (historique, contact pendant le fondu), T7 (bathymétrie, marées, vagues), H1c (bloqué), H2/H3, H5 (justesse, coût), R5, R6a-terrain, Q1 (P3, P5, P6, P7, P12, I1, I4), Q3 (B3, A1), Q4 (L5, F1, F2, F4, C4), Q5 (orage ~25 ms), Q6-ISS, Q7 (L7a), Q8 (B2, F3), Q9 (P9, P10) | §0.2, §8.0, §11 ; `git log` 5–6 nov. | C0 jamais relu ; budget de Q1 ; palier de cadence ; pré-filtre SRTM ; L4, Q6t, L7b, B5 ; H1c ; bathymétrie T7 ; G1/G2 ; P9/P10 |
| **PLAN-AURORES-MAGNETOSPHERES** (3 nov.) | **En cours.** **En-tête faux** : ligne 82 dit « Rien n'est commencé chez nous », alors qu'AM0, AM1 et les premiers lots d'AM2, AM3, AM4, AM6, AM7 sont commités | AM2 (aurore générique, cache par direction, rendu photo, coût), AM3 (Europe, Ganymède, Callisto, dawn storms), AM4 (Saturne fixe au Soleil, Encelade), **AM5 non commencé** (lunes), AM6 (suite), AM7 (déformation par le vent, lignes ouvertes, TARS, worker) ; AM8 déplacé vers les capteurs | `09d723bc`, `c06840d8`, `a1e34357`, `c9d2be90`, `dbb8739d`, `5c74fcf5`, `2667345b`, `309fc8c6` ; `src/system/magnetic-fields.ts`, `aurora-bodies.ts`, `magneto-lines.ts` | Ce qu'on reprend d'Alex (§7, l. 316) |
| **PLAN-NUIT-URBAINE** (6 nov.) | **En cours.** §2 dit « NU1+NU2 (en cours) » alors que `df9c782e` les a commités : **état à corriger** | NU3 (voitures au loin), NU5 (exposition ; « l'œil adapté à la ville » fait en partie dans `df9c782e`), NU6 (halo du ciel), NU8 (chargement à moyenne constante), NU7 (monuments) | `6d11d6b5` (NU4), `df9c782e` (NU1+NU2), `src/system/night-roads.ts` | — |
| **ANALYSE-STREAMING** — ST0–ST10 (6 nov.) | **En cours, non commité.** ST0 en partie ; ST1 « fait » **dans la copie de travail seulement** | ST0 (temps avant visibilité, trous), ST1b, **ST2 (ordonnanceur)**, **ST3 (cellules)**, ST4, **ST5 (pool GPU)**, **ST6 (cache cuit)**, ST7, ST8, ST9, ST10 | Fichier non suivi ; `ZONE_SCHEMA` absent de `HEAD`, présent dans `src/system/zones.ts` modifié ; `StreamScheduler` absent de `src/` | Effect ou non pour l'ordonnanceur (§5.2, l. 153) ; ST4 et ST8 « planifiés » |
| **PLAN-PLANETES-AAA** (29 oct.) | **Ouvert dormant** depuis le 1er nov. En-tête juste | P10 : vues au-dessus du budget (Europe ciné 63 ms, Cérès +11 %, Saturne près des anneaux ~40 ms, géantes dedans ~39 ms), campagne e2e finale, `docs/PLANETES.md` FR + EN (absent), galerie ; traces de pas de la Lune | En-tête ; `docs/PLANETES*.md` absent | § P11 : hauteur des ponts près des pôles, lumière du puits de l'œil, bouclier ablatif, format commun des tourbillons, Uranus et Neptune aplaties |
| **PLAN-AVIATION-AAA** (15 oct.) | **Ouvert dormant.** En-tête daté du 18 oct., **périmé** : C5 a avancé le 6 nov. (mode guerre : SA-11, char, camion, bunker en 3D) et T4 en mer est fait | C4 (IA au vrai modèle de vol), C5 (navires en 3D, états de dégât), C6 (en partie), T4 (airways aériennes, rejeux d'une journée passée), T5 (TCAS, annonces, sillage) | `03f42061` (T4 mer), `c40e4c2d`, `6604630a` (C5 sol) | — |
| **PLAN-A320** (22 oct.) | **Ouvert dormant.** Le tableau des étapes ne dit pas ce qui est fait ; l'état est dans AAA-PROGRESS (l. 565–587) | A15 (vols de ligne, ATC), A16 (qualification, pannes, défis), A17 (équipage à deux en réseau), A18 (HOTAS Airbus, TARS, doc), A19 (variantes IAE, neo) | `62f99461` (A14) ; `grep` `DUAL INPUT`, `V2500`, `LEAP` : rien dans `src/a320` | — |
| **PLAN-VAISSEAUX-AAA** (18 oct.) | **Terminé, fusionné** (`vaisseaux-aaa` : 0 commit d'avance sur `main`). Des restes notés dans son tableau | X1 : ascension en deux temps et mission Jupiter ; X4 : couleur du HUD, boule « AAA » ; X6 : tableaux propres au Lander et à l'Endurance, second siège ; N : Endurance de salle avec bail, feux distants, messages vocaux | Tableau de suivi l. 385–409 | — |
| **PLAN-BATIMENTS-AAA** (24 oct.) | **Terminé** (B1–B9). **En-tête périmé** : « Statut : plan et analyse » | Débords de toit, façades en relief (corniches, balcons) | § « Reste à faire », l. 292 | — |
| **PLAN-MONDE** (5 oct.) | **Terminé sauf M3.** Section « État au 08/10 » **fausse** : « aucune phase M3–M10 n'a commencé », alors que M4–M10 sont faits (AAA-PROGRESS l. 401–486) | M3 : maillages quantifiés et meshopt, planètes HD en KTX2 (89 images JPEG/PNG) | PLAN-MONDE l. 39, 51–74 | — |

### 1.2 Plans jamais commencés

| Plan (date) | État réel vérifié | Preuve | Décisions en attente |
|---|---|---|---|
| **PLAN-CAPTEURS-CAMERA-SECONDAIRE** — S0–S9 (6 nov.) | Jamais commencé (dit en tête, vrai) | `src/sensors/` absent | Place et raccourci de la fenêtre ; palettes ; source des températures (§8) |
| **PLAN-SERVICES-SERVEUR-AAA** — SV0–SV6 (v2 datée du 23 oct., fichier créé le 30 oct.) | Jamais commencé (dit en tête, vrai) | `server/` : `main.ts`, `rooms.ts`, `traffic.ts`, `moon-*.ts` seulement | Les six décisions « par défaut » du §3 ; go/no-go de SV4 et SV5 après SV0 |

### 1.3 Plans absorbés

| Plan (date) | Absorbé par | Remarque |
|---|---|---|
| **PLAN-IMAGE-VIPER11** (31 oct.) | PLAN-REFRACTION-HORIZONS (décisions 28, 32) | En-tête juste (« fusionné »). **`docs/README.md` §2.6 le classe « en cours, sans implémentation » : faux.** B3 (L8), B5, C1–C4, A1–A5 (I6, I8) ont été implémentés sous leurs noms Q |
| **PLAN-PIPELINE-TERRE-AAA** — P0–P6 (20 oct.) | PLAN-RENDU-RASTER-AAA, puis T/Q/H/R | **En-tête périmé** : « P1a et P1b désactivés par défaut », alors que le raster est le chemin par défaut depuis le 23 oct. Branche `codex/aaa-terrestrial-renderer` fusionnée (0 d'avance) |
| **PLAN-RENDU-RASTER-AAA** — 4 étapes (20 oct.) | T/Q/H/R : étape 2 → T6/R3, étape 3 → Q5, étape 4 → Q6 | En-tête du 23 oct. : « étape 1 faite ». Ne renvoie pas à T/Q/H/R. Son budget §4 n'est plus la référence (§5 ci-dessous) |
| **PLAN-NUAGES-AAA** — N0–N6 (21 oct.) | Fait, puis prolongé par Q5 | Pas d'état dans le fichier ; l'état est dans PLAN-RENDU-RASTER-AAA et `progress/raster-aaa/NUAGES.md` |
| **PLAN-MONDE-VIVANT-AAA** (12 oct.) | I0–I8 (IGN), Q4/Q7/Q8, aviation M1 (mer FFT) | **Périmé et contradictoire** : décision « arbres tout tracés, pas de maillages rasterisés » ; J1 livré, J2–J6 jamais suivis sous ce nom |
| **PLAN-TERRE-PHOTOREALISTE** (11 oct.) | Sources nationales et raster | Jalon A fait ; les jalons suivants ont été repris ailleurs |
| **PLAN-RENDU-PERF** (16 oct.) | T/Q/H/R Q1, Q9 | Liste « à mesurer » close ou rayée (l. 319–328) |
| **PLAN-THIRD-PERSON-PLANETES-HERBE** (12 oct.) | THIRD-PERSON-IMPLEMENTATION.md | Document de conception ; `src/character-renderer.ts` présent |

### 1.4 Plans terminés (historique des décisions)

Vérifiés par leur tableau d'état (toutes les lignes « fait ») ou par leur en-tête et la présence des modules.

| Plan | Date | Preuve | Reste noté |
|---|---|---|---|
| PLAN-ATMOSPHERE-ORDINATEUR | 2 oct. | 7 phases sur 7 | — |
| PLAN-CARTE | 2 oct. | 8 sur 8 | carte 3D en ellipsoïde (AAA-PROGRESS l. 610) |
| PLAN-HUD | 3 oct. | 7 sur 7 | migration complète de la symbologie (U4.9) |
| PLAN-ASSISTANT | 4 oct. | 13 sur 13 | — |
| PLAN-TROU-DE-VER-CARTE3D | 6 oct. | « P1 à P5 appliqués » | — |
| PLAN-HUB | 7 oct. | 5 sur 5 | — |
| PLAN-METEO, AEROPORTS, AUDIO, HOTAS, COCKPIT, TARS | 8–9 oct. | 9/9, 8/8, 8/8, 6/6, 8/8, 8/8 | cockpit : « atténuer les lampes la nuit », décision en attente (AAA-PROGRESS l. 229) |
| PLAN-TARS-AGENT | 9 oct. | A1–A9, B1–B7 | longs vols du banc réel (`TARS_LONG=1`), GLM comparé à un autre modèle |
| PLAN-CIEL, PLAN-PLUIE | 10 oct. | 12/12 ; P1–P7 | rayon vert repris en R6a |
| PLAN-MODES-AAA | 12 oct. | `src/game/modes.ts`, `src/ui/topbar.ts`, commits M7 `94c67ffe`, M8 `183b86a7` | **aucun tableau d'état dans le plan** |
| PLAN-F35, PLAN-OBSERVATOIRE | 13–14 oct. | F1–F11 ; O0–O6 | e2e `observatory` noté en échec antérieur |
| PLAN-RESEAU | 14 oct. | R0–R8 | nginx-proxy-manager et coturn « à faire par l'utilisateur » (l. 213–215) : état non vérifiable ici |
| PLAN-CREW-ACTIONS, PLAN-PCD-AAA, PLAN-TITRE-AAA | 18 oct. | branche `crew-actions` fusionnée ; « TERMINÉ » ; E0–E11 | — |
| PLAN-RADAR-AAA | 18 oct. | RD0–RD15 faits | 7 questions ouvertes (l. 716–728), non bloquantes |
| PLAN-LEAN-TRACER-KERNELS | 27 oct. | P0–P10 cochés | noyau de Jupiter proche : ~200 s à froid (PROBLEMES-A-REGLER) |
| PLAN-CAMERA-AAA | 29 oct. | CAM0–CAM11 | — |
| PLAN-GEANTES-VOLUME | 1er nov. | « Le plan est fini » (V1–V11) | — |

### 1.5 Plans sans fichier sur `main`

- **PL-01 — PLAN-AEROPORT-AAA** (trafic réel L1–L5, vue Aéroport V1–V5) : le plan et son code n'existent que sur la
  branche `worktree-airliners-runway` (§2). `docs/README.md` ne le mentionne pas.
- **PLAN-ELECTRON** : abandonné, pas de fichier (dit par `docs/README.md` §2.6).

### 1.6 En-têtes faux ou périmés (récapitulatif)

| Constat | Document | Défaut |
|---|---|---|
| PL-02 | PLAN-AURORES-MAGNETOSPHERES l. 82 | « Rien n'est commencé chez nous » : faux depuis le 6 nov. |
| PL-03 | PLAN-NUIT-URBAINE §2 | NU1+NU2 « en cours » : commités (`df9c782e`) |
| PL-04 | PLAN-BATIMENTS-AAA l. 8 | « plan et analyse » : B1–B9 faits |
| PL-05 | PLAN-MONDE l. 51–55 | « aucune phase M3–M10 n'a commencé » : M4–M10 faits |
| PL-06 | PLAN-PIPELINE-TERRE-AAA l. 5 | « désactivés par défaut » : le raster est le défaut |
| PL-07 | PLAN-AVIATION-AAA l. 4–7 | état du 18 oct. ; C5 et T4 ont avancé le 6 nov. |
| PL-08 | PLAN-A320 | aucun état par étape dans le plan |
| PL-09 | PLAN-MODES-AAA, PLAN-NUAGES-AAA | aucun état dans le fichier |
| PL-10 | PLAN-MONDE-VIVANT-AAA | décision « tout tracé » contraire au chemin actuel ; non marqué absorbé |
| PL-11 | docs/README.md §2.6 | VIPER11 classé « en cours » ; ANALYSE-STREAMING absente de la carte |
| PL-12 | RECHERCHE-DONNEES l. 11–17 contre l. 590–606 | le tableau du 5 nov. dit B et C « non commencés » ; la section du 6 nov. dit B fait, C et D en partie. Deux états dans le même document |
| PL-13 | ERRORS-TO-FIX.md | une seule entrée (E1), marquée corrigée le 18 oct. Le fichier est vide de fait ; README le cite encore pour « savoir ce qui est cassé » |
| PL-14 | AAA-PROGRESS.md | notes sur 100 (« ≈ 77,5 ») non réestimées depuis le 8 oct. ; contraires au §20.8 (« éviter un score AAA ») |

---

## 2. Branches et worktrees non fusionnés

Mesuré par `git log main..<branche> --oneline | wc -l`.

### 2.1 Branches avec des commits absents de `main`

| Branche | Avance / retard | Diverge depuis | Contenu | Risque | Recommandation |
|---|---|---|---|---|---|
| **`worktree-airliners-runway`** (worktree `.claude/worktrees/airliners-runway`) | 6 / 482 | 29 oct. (`269ae823`) | Trafic réel : atterrissage reconstitué, arrondi, inverseurs, fumée ; vue Aéroport (réalisateurs) ; 27 fichiers, +2 650 lignes ; `docs/PLAN-AEROPORT-AAA.md` | **Élevé.** Touche `renderer.ts`, `main.ts`, `controller/traffic.ts`, `automation.ts`, tous très modifiés depuis. Chaque jour augmente le coût du rebase | Décision de Sam : rebaser et fusionner cette semaine, ou archiver par un tag et supprimer. Ne pas laisser dormir |
| **`Ineptie-Version-m1`** (aussi sur `origin`) | 2 / 505 | 28 oct. | Reconstruction ×6–×8 (`post.wgsl`), correctifs headless Windows, une revue (`REVIEW-INEPTIE-VERSION-M1-2026-10-31.md`) qui propose de la scinder en deux | Moyen. La revue n'est pas sur `main` ; sa proposition n'a pas de suite | Trancher la proposition de la revue : prendre les correctifs Windows, reprendre ou abandonner le rendu |
| `codex/ineptie-version-pages`, `origin/Ineptie-Version` | 2 / 835 | 17 oct. | Changements de Sam (préflight, mini-jeu d'accueil), publication sous `/ineptie` | Faible (branche de publication) | Garder comme branche de publication ou supprimer |
| `codex/test-kimi-pages` | 1 / 810 | 17 oct. | Un commit `[skip ci]` de publication Pages | Nul | Supprimer |
| `test-kimi` | 2 / 1 131 | 9 oct. | Deux commits (cockpit K3, démarrage) repris sur `main` sous d'autres hachages (PLAN-COCKPIT K1–K7 fait) | Nul | Supprimer après vérification du contenu |
| `origin/test-kimi-backup-2026-10-09` | 5 / 1 129 | 9 oct. | Sauvegarde | Nul | Supprimer |
| `origin/deploy` | 500 / — | — | Branche de déploiement (Portainer) | — | Garder |

### 2.2 Branches entièrement fusionnées (0 commit d'avance)

`vaisseaux-aaa`, `crew-actions`, `f35-hud`, `perf-render`, `merge-perf-render`, `plan-rendu-raster-aaa`, `reseau`,
`terre-pres-ponts`, `codex/aaa-terrestrial-renderer`, `codex/crew-console`, `codex/earth-*`, `codex/ineptie-pages`,
`audit-plan`, `gargantua-system`, `t3/fix-main-ci`, `claude/priceless-mendeleev-0ad3d1`.

- **PL-15** — Ces 16 branches locales sont des doublons de `main`. Elles encombrent `git branch` et font croire à du
  travail en attente. La note de mémoire « vaisseaux-aaa (unmerged) » est périmée : la branche est fusionnée.
- **PL-16** — Dix worktrees leur sont attachés (`bhg-vaisseaux`, `bhg-crew`, `bhg-f35hud`, `bhg-merge`, `bhg-net`,
  `bhg-raster-aaa`, `bh-terre-pres`, `.codex/…/aaa-terrestrial-renderer`, `.t3/…/t3-397beb80`,
  `.claude/worktrees/priceless-mendeleev-0ad3d1`), plus sept worktrees « prunable » dans `/private/tmp`.
  Le worktree `.codex/…/aaa-terrestrial-renderer` a **2 fichiers modifiés non commités** (`src/renderer.ts`,
  `src/settings.ts`) sur une base du 20 octobre : à examiner avant suppression.
- Recommandation : `git worktree prune`, puis supprimer branches et worktrees fusionnés, après accord de Sam.

### 2.3 La copie de travail principale

- **PL-17** — 12 fichiers suivis modifiés et non commités depuis le 6–8 novembre : `src/system/zones.ts`, `src/sw.ts`,
  `src/pwa/rules.ts`, `src/pwa-zones.ts`, `src/system/pmtiles.ts`, `scenery-sources.ts`, `scenery.ts`, `usa-ground.ts`,
  `src/ui/settings/offline.ts`, deux tests, `docs/GRAPHICS-PIPELINE.md` (+137 / −44 lignes). C'est le lot ST1.
  L'e2e `tests/e2e/zones-usa-night.e2e.test.ts` est non suivi.
- **PL-18** — 54 fichiers non suivis, dont 34 e2e jetables `tests/e2e/zz-*`, des captures à la racine (`crash*.png`,
  `falling*.png`…), `session.jsonl`, `.jsonl`, un export `pi-session-…html`.

---

## 3. Jalons J0–J5 et séquence §20.5

### 3.1 État des jalons (§15)

| Jalon | Sortie attendue | État au 10 nov. | Preuve |
|---|---|---|---|
| **J0** — contrat produit et références | Exigences lisibles, scènes de référence figées, contrats §19 (temps, sol, contrôle, instruments, reprise) | **Non fixé.** Aucune scène de référence, aucune fiche, aucun contrat d'acceptation. C0 non relu | §21.2 ; dernière décision du plan : n° 42 (5 nov.) ; aucune mention d'une scène de référence dans le journal |
| **J1** — scène opaque verticale | Forward : profondeur finale, identité, mouvement, couleur ; première image sans compilations Kerr | **Non commencé.** Aucun module forward, aucun contrat de surface dans `src/` | `shadeLite` reste l'ombrage du sol (30 occurrences dans `trace.wgsl`) |
| **J2** — pages filtrables et reconstruction | Hauteurs et couleurs séparées, mips, publication versionnée, désocclusion | **Briques posées sur l'ancien chemin** : T9 (filtrage matériel), T8, Q6 (TAAU, échelle 75 %). Pas de publication versionnée ; validité de T8 réduite à un rectangle | §21.1 ; §0.2 du plan |
| **J3** — lumière, ombres, cockpit | État lumineux partagé | Briques : R3, T6, Q5 C1/C2. Pas de service de lumière ; cockpit ~13 ms | §21.1 ; §8.0 |
| **J4** — eau et volumes à budget | Enveloppe explicite | Non : orage, passe des nuages ~25 ms sur M1 | §0.2 |
| **J5** — généralisation, retrait de l'ancien | Un renderer principal par domaine | Non. Le chemin `earthPipeline: "trace"` vit toujours (et a un défaut ouvert à Big Sur) | PROBLEMES-A-REGLER |

### 3.2 Séquence §20.5

| Étape | Contenu | État |
|---|---|---|
| 1 | Socle commun : cadences réconciliées, propriétaires désignés, scène de vol de référence | **Non fait.** Seule avancée : `GRAPHICS-PIPELINE.md` §2 « Qui possède quoi » **décrit** l'existant (`a33b0799`) ; ce n'est pas un contrat |
| 2 | Interfaces sur les données existantes | **Non fait.** `sources.ts` existe mais « aucun lecteur ne le consulte » (RECHERCHE-DONNEES l. 13) |
| 3 | T9 et données Q3 dans cette direction | **En partie** (T9 a, b, c ; Q3 B1, B4). Restent C0-4, Q3 B3 et A1 |
| 4 | Remplacer l'opaque terrestre (domaine pilote) | **Non commencé** |
| 5 | Q6 sur le nouveau contrat | Q6 livré, mais **sur l'ancien contrat** |
| 6 | Richesse puis généralisation | **Faite avant les étapes 1, 2 et 4** : c'est l'ordre inverse de la séquence |

### 3.3 Ce qui a été livré depuis le 3 novembre, par type de lot (§20.4)

- **Lots de bascule : 0.**
- **Lots de fondation stricts** (une propriété déplacée, servant un chemin concret) : **0**. Les plus proches :
  - T9 (imagerie filtrable, 3–4 nov.) et T257 (maillage en worker) : fondation sur le chemin actuel, mesurée ;
  - AM0 `magnetic-fields.ts` (`09d723bc`) : un modèle commun, une seule source, hors renderer ;
  - `GRAPHICS-PIPELINE.md` et `scripts/pipeline-inventory.ts --check` (`a33b0799`) : outillage de gouvernance ;
  - les USA derrière l'interface des sources nationales (`d43073d4`) : réutilisation d'une interface existante ;
  - ST1 (`ZONE_SCHEMA` 2) : non commité.
- **Lots de qualité, de contenu et de correction : tout le reste** (environ 300 commits du 3 au 8 novembre).

### 3.4 Le risque « roadmap déclarative » depuis le 5 novembre : aggravé

**PL-19.** Les 51 commits des 6 et 8 novembre, classés d'après leur message :

| Famille | Commits | Type |
|---|---:|---|
| Aurores et magnétosphères (AM0–AM7, vent solaire, coût) | 11 | contenu ; AM0 seul est un modèle commun |
| Chargement sur le chemin actuel (T8k–o, voyant réseau, audit, USGS 404, `planCache`) | 11 | qualité et correction |
| Vue missile, vie en mer, mode guerre | 9 | contenu |
| Données USA et Mapterhorn (lots D et E) | 5 | contenu, par une interface existante |
| CI et tests | 5 | maintenance |
| Plans et documentation | 4 | gouvernance |
| Ville de nuit | 3 | qualité |
| Notes pour le Claude d'Alex | 2 | — |
| Scène « aurores de Jupiter » (8 nov.) | 1 | contenu |

Constats :
- Aucun commit ne traite J0, le candidat A recommandé au §21.4.
- Les aurores ajoutent trois familles au vieux traceur : `auroraGiant`, `auroraRocky`, `fsMagVol`. Entre `e98ff1b0`
  (5 nov. au soir) et `HEAD` : `trace.wgsl` +440 / −52, `renderer.ts` +390 / −21, `overlay.wgsl` +182 / −2.
- Deux plans nouveaux ont été ouverts (capteurs S0–S9, streaming ST0–ST10) et un troisième exécuté (nuit urbaine),
  pendant que la décision J0 attend.
- Le §21.4 rangeait les aurores « E » comme compatibles en parallèle. Mais E couvrait AM0 et AM1 (données, CPU). Le
  rendu d'AM2 à AM7 a suivi sans que A ait commencé.
- Point positif : ANALYSE-STREAMING (ST3–ST6 : cellules, cuisson, cache versionné, pool GPU paginé) est un vrai plan
  de fondation pour §7.6 et §7.19. Il n'est ni commité, ni raccordé à J0–J5, ni cité par le plan T/Q/H/R.

### 3.5 Options coupées sans condition de retrait (liste à jour)

Aucune des huit options du §21.2 n'a été tranchée ni retirée depuis le 5 novembre. La liste s'allonge.

| Option | Où | État | Condition de retrait écrite ? |
|---|---|---|---|
| L2a — GTAO | `system/gtao.ts`, `renderer.ts:9626–9633` | coupée (invisible, halos) | non |
| L2b — ciel des vallées | `earthSkyOpen`, `renderer.ts:9173` | coupée | non |
| L4 — spéculaire des matériaux | `renderer.ts:9178` | coupée « until judged » | non — attend Sam |
| L7b — dé-éclairage des orthophotos | `settings.ts:334` `orthoDelight`, `system/ortho-delight.ts` | prototype coupé | non — go/no-go |
| B5 — couvert bas | `settings.ts:354` `earthLowCover` | coupée (+1–2 ms) | non |
| Q6t — rayures de verrière | `renderer.ts:4551` « kept for comparison » | porte de la décision 40 | non — attend Sam |
| VIPER C2 — nuages amortis | `FLAG_CLOUD_AMORTISED`, `renderer.ts:470, 9972` | coupée après mesure | non |
| VIPER C3 | Q5 | écrite et coupée | non |
| T8e — fenêtres d'ortho de 8 tuiles | `ORTHO_SPAN` | désactivée (décision 38) | non |
| **Nouveau** — préchargement du décor | `scenery.ts:412` `prefetchOn = false` (`d11f0171`) | écrit puis éteint (670 Mo contre 280) | non |
| **Nouveau** — œil non adapté à l'ombre de Saturne | `earthSunlight` (AM4) | raccord | oui : corriger la lumière fausse, puis rendre l'adaptation |
| **Nouveau** — reflet de la sonde borné à ×4 | `seaShade` (`a1e34357`) | raccord provisoire | oui : « puis retirer la borne » |

---

## 4. Décisions en attente de Sam (dédoublonnées)

### 4.1 Stratégie et contrats — bloquent le plus de travail

| # | Décision | Sources | Bloque |
|---|---|---|---|
| D1 | **Le prochain jalon** : A (J0) puis B (J1), ou autre | ANALYSE-STRATEGIE §21.4 ; journal 5 nov. 19:39Z | toute la séquence §20.5 |
| D2 | **La scène de vol de référence** : ville, heure, météo | §21.4 ; plan T/Q/H/R §8.0 groupe 1 | J0, attribution du coût, chaque bascule |
| D3 | **Le palier de cadence nommé** et son raccord à 60 i/s | §21.2 ; plan §11 point 2 ; C0-8 | Q1, Q9, acceptation de chaque lot |
| D4 | **Relire C0** et entériner cinq écarts (T5 `rgba32float` 2 × 9 bits ; T9 `r32uint` ; validité T8 en rectangle ; `ORTHO_SPAN` ; tables R2 en tranches) | plan §0.2, §11 point 1 ; C0 l. 5 | J0, fondations |
| D5 | **Le budget en vol de Q1** | plan §11 point 2 ; décision 16 | Q1, groupe 2 du §8.0 |
| D6 | **Les propriétaires** de temps, sol de contact, vue, image | §21.2, §19.14 | J0, J1 |

### 4.2 Options à trancher (garder ou retirer)

| # | Décision | Source |
|---|---|---|
| D7 | L4 (spéculaire), Q6t (rayures, décision 40), L7b (go/no-go), B5 (suite du couvert bas) | plan §11 point 4 |
| D8 | L2a, L2b, VIPER C2 et C3 : une raison et une condition de retrait, sinon suppression | plan §8.0 groupe 4 |
| D9 | Pré-filtre SRTM de T1, actif sans confirmation | plan §11 point 3 ; décision 12 |
| D10 | P9 et P10 (Q9) gardés ou retirés ; réglage artistique du limbe | plan §11 point 7 |
| D11 | Cockpit : atténuer les lampes la nuit | AAA-PROGRESS l. 229 |
| D12 | Limites de vol non appliquées (train, volets, VMO, masse max de l'A320) : choix ou oubli | PROBLEMES-A-REGLER |

### 4.3 Données et hébergement

| # | Décision | Source |
|---|---|---|
| D13 | H1c : où héberger les DEM LOLA (dépôt à 565 Mo sur 600) — **décidé le 12 nov. : le serveur de Sam** ([ASSETS.md](../ASSETS.md)) | plan §0.2, §11 point 5 |
| D14 | T7 : lancer la bathymétrie côtière (HOMONIM, Litto3D) | plan §11 point 6 |
| D15 | G1/G2 : Copernicus GLO-30, orthos nationales retenues | plan §11 point 7 |
| D16 | Terres sous le niveau de la mer (`max(H, 0) + N`), datum de swissALTI3D, avant le lot E | RECHERCHE-DONNEES l. 22–24 |

### 4.4 Plans et branches

| # | Décision | Source |
|---|---|---|
| D17 | `worktree-airliners-runway` : fusionner ou archiver | §2.1 de ce rapport |
| D18 | `Ineptie-Version-m1` : la scinder comme le propose sa revue, ou l'abandonner | commit `110f538b` |
| D19 | Planètes § P11 : hauteur des ponts aux pôles, lumière du puits de l'œil, bouclier ablatif, format commun des tourbillons, Uranus et Neptune aplaties | PLAN-PLANETES-AAA l. 9, 393, 417, 420 |
| D20 | Planètes P10 : traces de pas de la Lune gardées ou abandonnées | PLAN-PLANETES-AAA l. 325 |
| D21 | Capteurs : place et raccourci de la fenêtre, palettes, source des températures | PLAN-CAPTEURS §8 |
| D22 | Services serveur : les six décisions par défaut, dont « appareil de référence : iPad Pro M1 » | PLAN-SERVICES §3 |
| D23 | Streaming : Effect ou non pour l'ordonnanceur ; ST4 et ST8 | ANALYSE-STREAMING §5.2, §7 |
| D24 | Aurores : ce qu'on reprend du travail d'Alex | PLAN-AURORES §7, l. 316 |
| D25 | Radar : 7 questions ouvertes (AWACS, héliports, clic et lock…) | PLAN-RADAR-AAA l. 716–728 |
| D26 | Réseau : nginx-proxy-manager et coturn côté serveur | PLAN-RESEAU l. 213–215 |

---

## 5. Contradictions entre documents

### 5.1 Cibles de cadence et appareil de référence

| Document | Cible | Appareil |
|---|---|---|
| ANALYSE-STRATEGIE §8.1 (3 nov.) — **fait foi** | 60 images réelles/s en 1080p | M1 Max (profil principal) |
| C0-8 (2 nov., « décision 26, confirmés ») | ≥ 25 i/s (≤ 40 ms) mini ; ≥ 40 i/s M1 Max ; ≥ 60 i/s en 1440p kerr-pc ; ≥ 30 i/s iPad | quatre machines |
| PLAN-RENDU-RASTER-AAA §4 | « 30 fps réaliste, 60 plausible, non promis » | M1 Max |
| PLAN-PIPELINE-TERRE-AAA §5.1 | 30 i/s « jalon utile », 60 visé | M1 Max |
| PLAN-MONDE-VIVANT-AAA | 60 fps sur iPad, Mac M1 et Windows | trois machines |
| PLAN-PLANETES-AAA | « jamais plus lent que la Terre » (budget relatif, ~39–43 ms) | kerr-mini |
| PLAN-SERVICES-SERVEUR §3 | — | iPad Pro M1 « référence des mesures » |
| CLAUDE.md | 60 i/s ; 40 i/s M1 Max nommé palier | — |

- **PL-20** — C0-8 dit toujours « confirmés », sans le mot « palier ». Le §20.2 demande de les renommer : non fait dans C0.
- **PL-21** — La mesure se fait sur kerr-mini (M1, écran 50 Hz, qui « ne peut pas prouver 60 Hz », §8.1). Le profil
  principal est le M1 Max, où « aucune mesure récente n'existe » (plan §0.2). **La cible n'est mesurée nulle part.**
- **PL-22** — Écart réel : 50–67 ms en vol chargé sur le mini, contre 16,67 ms. Aucun palier intermédiaire n'est tenu.

### 5.2 Trois enveloppes de budget pour le même profil 60 i/s

| Famille | STRATEGIE §8.2 | RENDU-RASTER §4 | PIPELINE-TERRE §5.2 |
|---|---:|---:|---:|
| Terrain, matériaux, décor | 2,0 + 4,0 | 4,0 | 3,0 + 2,5 |
| Ombres | 1,5 | 1,5 | 1,5 |
| Eau | 1,0 | (dans terrain) | 1,0 |
| Air et nuages | 2,5 | 0,5 + 2,5 | 0,5 + 2,5 |
| Appareils, cockpit | (dans matériaux) | 2,0 | 1,5 |
| Reconstruction, sortie | 2,0 | 2,0 | 1,5 |
| **Total** | **13,0 ms** | **12,5 ms** | **14,0 ms** |

- **PL-23** — Trois tableaux, trois découpages, aucun mesuré. Les deux anciens ne renvoient pas au §8.2.
- **PL-24** — Le cockpit pèse ~13 ms mesurés (plan §8.0). Le §8.2 ne lui donne aucune ligne propre.

### 5.3 Plans qui se recouvrent

- **PL-25 — Quatre documents pour le rendu terrestre** : PLAN-PIPELINE-TERRE-AAA (P0–P6), PLAN-RENDU-RASTER-AAA
  (4 étapes), PLAN-REFRACTION-HORIZONS (T/Q/H/R), ANALYSE-STRATEGIE (J0–J5). Les deux premiers sont absorbés sans le
  dire en tête. Quatre nomenclatures coexistent (P, étape, T/Q/H/R, J), plus ST.
- **PL-26 — Chargement** : T8 est « clos » (plan §0.2), mais T8k–o ont continué le 6 novembre, et ANALYSE-STREAMING
  rouvre le sujet avec ST0–ST10. ST9 reprend « validité par tuile » et « travail CPU des relevés en worker », déjà
  listés comme restes de T8 et de C0-4. Le plan T/Q/H/R ne cite pas ANALYSE-STREAMING.
- **PL-27 — Nuit** : PLAN-NUIT-URBAINE (NU1–NU8) recouvre Q8 L10 (lampadaires), Q8 D1 (trafic routier), Q2 (lumière de
  nuit) et PLAN-AEROPORTS (balisage). NU3 (voitures dans le shader) double le trafic de D1 avec un second mécanisme.
  Le plan le dit en une phrase, sans propriétaire commun de la lumière de nuit.
- **PL-28 — Monde vivant** : PLAN-MONDE-VIVANT-AAA impose « tout tracé, pas de maillages rasterisés ». Le décor actuel
  est en maillages rasterisés. Un agent qui lit ce plan seul repartirait dans la mauvaise direction.
- **PL-29 — Capteurs contre §20.7** : S0 crée une seconde cible de rendu et des variantes de noyau par canal, sur le
  traceur actuel, avant J1. C'est un nouveau lecteur du chemin à migrer. Le plan cite §20 (« pas d'opaque en double »)
  mais ne dit pas s'il attend J1.
- **PL-30 — Aurores contre le principe « passe de lignes avec profondeur »** : AM7 lit `moments.y` pour la
  profondeur. Le §20.2 donne exactement ce canal comme exemple de dépendance à éviter.

### 5.4 Formats et contrats

- **PL-31** — C0-2 fixe `rgba32uint` ; l'implémentation est en `rgba32float`, 2 × 9 bits (plan §0.2). C0 n'est pas
  corrigé. Le contrat écrit est faux depuis le 4 novembre.
- **PL-32** — C0-4 : validité par tuile attendue ; rectangle livré. Même remarque.

### 5.5 Documents périmés qui induisent en erreur

Voir §1.6 (PL-02 à PL-14). Les plus dangereux : PLAN-MONDE-VIVANT-AAA (PL-10), PLAN-PIPELINE-TERRE-AAA (PL-06),
AAA-PROGRESS (PL-14), `docs/README.md` §2.6 (PL-11).

---

## 6. Reste à faire consolidé

Taille : S (≤ 1 jour), M (quelques jours), L (1–2 semaines), XL (plusieurs semaines). **[D n]** : bloqué par la
décision n du §4.

### 6.1 Fondations et rendu

| Reste | Source | Taille | Blocage |
|---|---|---|---|
| J0 : contrat d'acceptation, scène de référence, fiche de mesure | STRATEGIE §15, §21.4 A | M | **[D1, D2, D3]** |
| Relecture de C0, écarts entérinés ou corrigés dans C0 | plan §8.0 groupe 1 | S | **[D4]** |
| Propriétaires de temps, sol, vue, image désignés | §19.14, §21.2 | S | **[D6]** |
| Interfaces : surface et générations, pages d'imagerie et validité, matériaux Q3 hors du noyau, `sources.ts` lu | §20.5 étapes 2–3 ; plan §8.0 groupe 3 | L | [D1] |
| Fin de T4 : rejet local de l'historique, contact pendant le fondu | plan §0.2 | M | — |
| J1 : opaque terrestre forward, domaine pilote | §15, §21.4 B | XL | **[D1]**, après J0 |
| Outil de layouts CPU/WGSL choisi (webgpu-utils ou TypeGPU) | §18.5, J1 | S | à J1 |
| Trancher et retirer les options coupées (12 lignes du §3.5) | plan §8.0 groupe 4 | M | **[D7, D8]** |
| Q3 B3 et A1 (bâtiments) | plan §0.2 | M | — |
| Q4 L5, F1, F2, F4, C4 | plan §0.2 | L | budget **[D5]** |
| Q8 B2, F3 ; Q7 L7a | plan §0.2 | M | — |
| R5 (pâtés de Vénus, anneau rouge, Titan), R6a-terrain | plan §0.2 | L | R6a « plus tard » |
| T7 : turquoise des hauts-fonds, marées, répétition des vagues, écume à 0,2–0,8 ms | plan §0.2 | L | **[D14]** |
| T257 : facettes lointaines (CDLOD « T11 ») | plan §0.2 | L | — |
| H5 : justesse (IoU 0,087), lecture et cuisson au budget ; H2/H3 | plan §0.2 | M | — |
| H1c : pôle sud lunaire | plan §0.2 | M | **[D13]** |
| H1b : décodage du DEM en worker (à-coup 59–79 ms) | plan §0.2 | S | — |
| Nuit : NU3, NU5, NU6, NU8, NU7 | PLAN-NUIT-URBAINE | L | — |
| Capteurs S0–S9 | PLAN-CAPTEURS | XL | [D21] ; à placer par rapport à J1 |
| Bâtiments : débords de toit, façades en relief | PLAN-BATIMENTS l. 292 | M | — |
| Traceur « trace » à Big Sur : nappe sombre | PROBLEMES-A-REGLER | S | — |

### 6.2 Chargement

| Reste | Source | Taille | Blocage |
|---|---|---|---|
| Commiter ST1 et ANALYSE-STREAMING | §2.3 | S | — |
| ST0 complet, ST1b | ANALYSE-STREAMING §7 | S | — |
| ST2 ordonnanceur unique | idem | L | [D23] |
| ST3 cellules + ST6 cache cuit | idem | XL | — |
| ST5 pool GPU paginé | idem | L | — |
| ST7 prédiction, ST9 tuiles raster, ST10 zones cuites | idem | L | — |
| ST4 pool de cuiseurs, ST8 HLOD lointain | idem | L | « planifiés » [D23] |
| Préchargement du décor (`prefetchOn`) : corriger ou retirer | `d11f0171` | S | — |
| Noyau de Jupiter proche : ~200 s à froid ; compilation anticipée | PROBLEMES-A-REGLER | M | — |
| `put` sur le fil principal, boucle CPU p95 4,6 ms (cible 4) | plan §0.2 T8 | M | — |
| M3 : meshopt, maillages quantifiés, planètes en KTX2 | PLAN-MONDE l. 39 ; CLAUDE.md §bibliothèques | M | — |

### 6.3 Performance

| Reste | Source | Taille | Blocage |
|---|---|---|---|
| Frame répartie par passe sur la scène de référence | plan §8.0 groupe 2 ; §21.2 | M | **[D2]** |
| Mesure sur M1 Max, le profil principal | plan §0.2 ; §8.1 | S | [D2] |
| Q1 : P3, P5, P6, P7, P12, I1, I4 (paliers) | plan §0.2 | L | **[D5]**, après l'attribution |
| Nuages dans l'orage (~25 ms sur M1) | plan §0.2 Q5 | L | — |
| Cockpit (~13 ms ; 4–6 i/s dans l'orage sur M1) | journal 5 nov. 21:10Z | L | — |
| R4 : ~+1 ms à réduire | plan §0.2 | S | — |
| Aurore terrestre de près : +4,6 ms ; cache par direction | PROBLEMES-A-REGLER | M | — |
| Coûts jamais mesurés : D1, AM2, AM3, AM7 (volumes) | plan §0.2 ; PLAN-AURORES | S | — |
| Q9 P9 (gain borné à ~1 ms), P10 | plan §0.2 | M | [D10] |
| Deux régimes de Chamonix (48 ou 59 ms) à expliquer | plan §0.2 T6 | S | — |

### 6.4 Contenu du monde et données

| Reste | Source | Taille | Blocage |
|---|---|---|---|
| Lot A : registre de provenance lu par les lecteurs ; dates des pièces BD ORTHO | RECHERCHE-DONNEES l. 13 | M | — |
| Lot C : GFZ/OMNI pour le passé, OVATION | idem l. 594 | M | — |
| Lot D : NAIP 0,6 m pour les zones ; LiDAR | idem l. 598 | M | — |
| Lot E : GLO-30, RGBNIR, qualification Mapterhorn | idem l. 583 | L | [D15, D16] |
| Lots F, H, I, J (pôles et mer, autres corps, sols planétaires, physique temporelle) | idem l. 584–588 | XL | non commencés |
| Lot G : Juno UVS calibré, champ externe | idem l. 596 | M | — |
| Q6-ISS : capture nadir et amarrage, attitude réelle, plans serrés | plan §0.2 | M | — |

### 6.5 Planètes

| Reste | Source | Taille | Blocage |
|---|---|---|---|
| P10 : Europe ciné, Cérès, Saturne près des anneaux, géantes dedans au budget | PLAN-PLANETES l. 316–321 | L | — |
| P10 : campagne e2e finale, `docs/PLANETES.md` FR + EN, galerie | idem | M | — |
| Aurores AM2–AM7 (suites), AM5 | PLAN-AURORES | L | [D24] |
| Saturne dans son ombre : artefacts ; Jupiter sud : image noire | PROBLEMES-A-REGLER | M | — |
| Ciel de nuit de la sonde ~40 × son sol ; aurore invisible caméra au soleil | idem | M | — |
| Traces de pas de la Lune | PLAN-PLANETES P6 | S | [D20] |

### 6.6 Aviation

| Reste | Source | Taille | Blocage |
|---|---|---|---|
| C4 : IA au vrai modèle de vol | PLAN-AVIATION l. 200 | L | — |
| C5 : navires en 3D, états de dégât ; C6 | idem | M | — |
| T4 : airways aériennes, rejeux ; T5 : TCAS, annonces, sillage | idem l. 267–280 | L | — |
| A320 : A15–A19 | PLAN-A320 | XL | — |
| U ne décolle probablement pas un F-35 ; doc F35.md à corriger | PROBLEMES-A-REGLER | S | — |
| TAT/SAT de l'A320 ; grisés du HUD ; limites non appliquées | idem | S | [D12] |
| Trafic réel : atterrissages et vue Aéroport | branche non fusionnée | M | **[D17]** |

### 6.7 Vaisseaux

| Reste | Source | Taille |
|---|---|---|
| Le Lander posé ne décolle pas avec U | PROBLEMES-A-REGLER | S |
| X1 : ascension en deux temps, mission Jupiter ; montée à +10 % de l'optimum ; retour par le trou de ver | PLAN-VAISSEAUX l. 390 ; AAA-PROGRESS l. 594–600 | L |
| X4 : couleur du HUD, boule « AAA » ; X6 : tableaux du Lander et de l'Endurance, second siège | PLAN-VAISSEAUX l. 393, 402 | M |

### 6.8 Réseau et serveur

| Reste | Source | Taille | Blocage |
|---|---|---|---|
| Services SV0–SV6 | PLAN-SERVICES | XL | [D22] |
| Endurance de salle avec bail, feux distants, messages vocaux | PLAN-VAISSEAUX l. 408 | M | — |
| coturn et proxy côté serveur | PLAN-RESEAU l. 213 | S | [D26] |

### 6.9 TARS, audio, UI

| Reste | Source | Taille |
|---|---|---|
| TARS : longs vols du banc réel, comparaison de modèles | AAA-PROGRESS l. 611 | M |
| TARS : actions du schéma des magnétosphères, des capteurs | PLAN-AURORES AM7 ; PLAN-CAPTEURS S8 | S |
| Progression d'une session à l'autre (carrière, objectifs suivis) | AAA-PROGRESS l. 593, 613 | L |
| U4.9 : symbologie migrée ; carte 3D en ellipsoïde | AAA-PROGRESS l. 610 | M |
| Audio : rien d'ouvert dans les plans lus | — | — |

### 6.10 Tests et outillage

| Reste | Source | Taille |
|---|---|---|
| 9 e2e lisent `camera.last`, inexistant : la ligne ne fait rien ; `airInfo().agl` ; `sunElevation` | PROBLEMES-A-REGLER | S |
| 125 e2e suivis absents du catalogue | §7 de ce rapport | M |
| 34 e2e `zz-*` non suivis : trier, supprimer | `git status` | S |
| Horodatages de passes qui se chevauchent sur Apple : pas d'attribution par passe | §21.2 ; GRAPHICS-PIPELINE l. 481 | M |
| Harnais : échecs aléatoires au démarrage sur le mini ; e2e en CI | AAA-PROGRESS l. 601, 753 | M |
| Aucune bibliothèque du §18 adoptée (`package.json` : `@mapbox/vector-tile`, `pbf`, `thinking-orbs`) | CLAUDE.md | — |

### 6.11 Documentation

| Reste | Source | Taille |
|---|---|---|
| Commiter ANALYSE-STRATEGIE, ANALYSE-STREAMING et les deux pages HTML | PL-40 | S |
| Corriger les en-têtes PL-02 à PL-14 | §1.6 | S |
| Carte : ANALYSE-STREAMING, PLAN-AEROPORT-AAA ; reclasser VIPER11 | PL-11 | S |
| C0 : renommer les seuils en paliers, corriger C0-2 et C0-4 | PL-20, PL-31 | S |
| `docs/PLANETES.md`, `docs/CAPTEURS.md` | plans | M |
| Journal : entrées manquantes du 6 novembre, par ajout | PL-36 | S |

---

## 7. Gouvernance

### 7.1 Le journal `progress-to-destination.md`

- **Tenu en volume** : 187 entrées du 3 au 8 novembre (18, 53, 86, 29, 0, 1 par jour). Suivi par git depuis `a33b0799`
  (6 nov.) seulement ; non suivi du 3 au 6.
- **PL-33 — Deux formats d'en-tête** : le format prescrit (`### AAAA-MM-JJ HH:MM UTC`) et, pour la plupart,
  `## AAAA-MM-JJTHH:MMZ`. Les champs prescrits (« Limites », « Suite ») manquent dans des entrées récentes.
- **PL-34 — Ordre non chronologique** : des entrées « 05T02:47Z » suivent « 05T23:50Z » (l. 1041–1048) ; « 06T09:00Z »
  (AM0, AM1) précède « 06T04:05Z » (AM2) (l. 1880–1899).
- **PL-35 — Heures non fiables** : AM0 est commité à 03:20 UTC (`09d723bc`, 04:20 +0100) et journalisé « 09:00Z ».
  Le défaut signalé au §21.3 persiste : la correction du 5 novembre n'a pas changé la pratique.
- **PL-36 — Lots non consignés le 6 novembre** (aucune occurrence des commits ni de leurs mots-clés) :
  `91483f0f` (USGS borné à z 16, `failBy`), `d11f0171` (`planCache`, phases du décor), `4c2fc763` (couleurs USGS),
  `e8617cdc` (carte de la doc, VOL-AVIONS, VOL-VAISSEAUX, E2E-VOLS), l'analyse du streaming et ST1.
- **PL-37** — Le journal consigne des lots de contenu comme avancées vers la destination (mode guerre, vue missile,
  scène de Jupiter) au titre du §19. Aucune entrée ne remplit « dépendance retirée ». Le journal mesure l'activité,
  pas la convergence.
- **PL-38** — Aucune entrée ne signale que J0 attend. Le dernier rappel date du 5 novembre 19:39Z.

### 7.2 Documents obligatoires

| Document | État |
|---|---|
| GRAPHICS-PIPELINE.md | Créé le 6 nov. (`a33b0799`), mis à jour dans les lots suivants. **Modifié non commité** (PL-17). `pipeline-inventory.ts --check` non lancé ici. §8.4 : coûts de référence des passes de calcul seulement ; les passes de rendu ne sont pas attribuables sur Apple |
| BH-API.md | Complété le 6 nov. (`e8617cdc`), dernier commit le 8 nov. Pas de modification en attente. `bh-api.ts --check` non lancé ici |
| E2E-CATALOGUE.md | **PL-39 — Incomplet.** Son en-tête date ses temps du « dernier passage complet (2026-10-09, 58 fichiers) ». 125 des 396 fichiers e2e suivis n'y figurent pas par leur nom : tous les `a320-*` (9), `net-*` (15), la plupart des `f35-*` (13), `raster-*` (9), `perf-*`, `hlod*`, `sea-*`… Vérifié par `grep` du nom de base de chaque fichier |
| VOL-AVIONS, VOL-VAISSEAUX, E2E-VOLS | Créés le 6 nov. Leur propre relecture a relevé des défauts non corrigés (PROBLEMES-A-REGLER) |
| docs/README.md (la carte) | À jour au 6 nov., avec les défauts PL-11 |

### 7.3 Fichiers stratégiques hors git

- **PL-40 — `docs/ANALYSE-STRATEGIE-RENDU-2026-11-03.md` n'est pas suivi** (`git ls-files` : absent ; `git
  check-ignore` : non ignoré). C'est la « référence stratégique permanente » de CLAUDE.md, citée par le journal, la
  carte et cinq plans. 189 ko, modifié le 5 nov. Aucun historique, aucune sauvegarde distante, invisible pour les
  autres machines, les worktrees, la CI et le Claude d'Alex. **Signalé au §21.3 le 5 novembre ; toujours vrai cinq
  jours après**, alors que CLAUDE.md et le journal ont été commités entre-temps.
- **PL-41** — Non suivis aussi : `docs/ANALYSE-STREAMING-2026-11-06.md` (déjà cité par GRAPHICS-PIPELINE),
  `docs/REFONTE-WEBGPU-2026-11-03.html`, `docs/STRATEGIE-WEBGPU-AAA-LIBRAIRIES-2026-11-03.html` (cités par la carte).
- **PL-42** — Tous les liens de `main` vers ces fichiers sont cassés sur GitHub et sur tout autre clone.

### 7.4 Rythme et pilotage

- **PL-43** — 28, 96, 130, 50, 0, 1 commits par jour du 3 au 8 novembre. Le 5 novembre : 130 commits et 86 entrées de
  journal. À ce rythme, un plan de 30 phases se parcourt en trois jours, « surtout par des lots de qualité » (plan
  §8.0). La relecture des contrats par Sam (C0, décision 33) ne suit pas ce rythme : le goulot est la décision, pas
  l'exécution.
- **PL-44** — Chaque demande de Sam ouvre un plan ou des lots immédiats (nuit, capteurs, streaming, mode guerre, vie en
  mer, missiles : six sujets le 6 novembre). Aucun n'est confronté à la séquence §20.5 avant exécution. La règle de
  CLAUDE.md (« chaque session tient compte de la destination ») est satisfaite par une phrase de raccord en tête de
  plan, pas par l'ordre des travaux.
- **PL-45** — Aucune liste unique du reste à faire n'existait. Elle est dispersée entre §0.2 et §11 du plan T/Q/H/R,
  PROBLEMES-A-REGLER, AAA-PROGRESS (l. 589), ANALYSE-STREAMING, RECHERCHE-DONNEES et les tableaux de dix plans. Le §6
  ci-dessus en est une première consolidation, à tenir en un seul endroit.

---

## 8. Recommandations, par ordre

1. **Commiter aujourd'hui** l'analyse stratégique, l'analyse du streaming, les deux pages HTML et le lot ST1 (PL-17,
   PL-40, PL-41).
2. **Obtenir de Sam les décisions D1 à D6** en une séance. Elles tiennent en une page et bloquent toute la séquence.
3. **Geler l'ouverture de nouveaux lecteurs** sur `shadeLite` et `trace.wgsl` tant que J0 n'est pas fixé, ou marquer
   chacun « provisoire » avec sa condition de retrait (§20.6).
4. **Trancher les 12 options coupées** (§3.5) et supprimer celles sans utilisateur.
5. **Décider du sort de `worktree-airliners-runway`** avant que son rebase ne devienne impraticable ; nettoyer les
   16 branches et 17 worktrees inutiles.
6. **Corriger les en-têtes PL-02 à PL-14** et marquer « absorbé » les quatre plans de rendu terrestre remplacés.
7. **Raccorder ST0–ST10 à J0–J5** : ST3–ST6 sont les fondations de J2 ; les inscrire comme telles dans le plan actif.
8. **Mesurer une fois sur M1 Max** la scène de référence, images terminées, pour savoir où se trouve la cible.
9. **Tenir un seul reste à faire** (le §6), et y renvoyer depuis les plans.
10. **Journal** : heure prise par `date -u`, entrées ajoutées en fin de fichier, champ « dépendance retirée » rempli ou
    marqué « aucune ».
