# La documentation du projet — la carte

Ce dossier contient plus de 110 documents et plusieurs sous-dossiers. Cette page dit **où lire quoi selon la
tâche**, la nature de chaque document (manuel du joueur, référence du code, guide de test, plan, analyse, journal)
et **quel document mettre à jour quand le code change**. Elle s'adresse à Sam et aux agents (Claude, Codex…).

Règle générale : **le code fait foi.** Une référence (`BH-API.md`, `GRAPHICS-PIPELINE.md`, les fiches `systemes/`,
`VOL-AVIONS.md`, `VOL-VAISSEAUX.md`) décrit le code à sa date ; un plan décrit une intention à sa date ; une analyse ou un
audit est un constat daté. En cas de désaccord, vérifier dans le code et corriger la référence.

*Mise à jour : 6 novembre 2026.*

---

## 1. Par où commencer, selon la tâche

| Je dois… | Lire d'abord | Puis |
|---|---|---|
| Commencer une session (toute tâche) | [CLAUDE.md](../CLAUDE.md), les dernières entrées de [progress-to-destination.md](../progress-to-destination.md) | [ANALYSE-STRATEGIE-RENDU-2026-11-03.md](ANALYSE-STRATEGIE-RENDU-2026-11-03.md) §1, §20 et la section utile |
| Toucher au rendu, au chargement, à la compilation | [GRAPHICS-PIPELINE.md](GRAPHICS-PIPELINE.md) | [systemes/02-pipeline-rendu.md](systemes/02-pipeline-rendu.md), [PLAN-REFRACTION-HORIZONS.md](PLAN-REFRACTION-HORIZONS.md), [PERFORMANCE.md](PERFORMANCE.md) |
| **Apprendre à piloter** (humain ou LLM) | les cours illustrés [apprendre-avions.html](apprendre-avions.html) et [apprendre-vaisseaux.html](apprendre-vaisseaux.html) | leur texte de référence : la partie I de [VOL-AVIONS.md](VOL-AVIONS.md) et de [VOL-VAISSEAUX.md](VOL-VAISSEAUX.md) |
| Comprendre comment volent les avions (F-35, A320, trafic) et leurs systèmes | [VOL-AVIONS.md](VOL-AVIONS.md) | [F35.md](F35.md) (manuel), [PLAN-A320.md](PLAN-A320.md), [aviation/](aviation/fr/f35.md) |
| Comprendre comment volent les vaisseaux (Ranger, Lander, Endurance) | [VOL-VAISSEAUX.md](VOL-VAISSEAUX.md) | [VAISSEAUX.md](VAISSEAUX.md) (manuel), [systemes/04](systemes/04-vol-commandes-camera.md), [05](systemes/05-pilote-autopilotes-atmosphere.md), [06](systemes/06-planification-trajectoires.md) |
| Écrire ou lancer un e2e | [E2E.md](E2E.md) | [E2E-VOLS.md](E2E-VOLS.md) (vols, temps, attentes, échecs fréquents), [BH-API.md](BH-API.md), [E2E-CATALOGUE.md](E2E-CATALOGUE.md) |
| Piloter la page depuis un test ou la console | [BH-API.md](BH-API.md) | [E2E-VOLS.md](E2E-VOLS.md) §2 (les recettes), [GAME-TOOLS.md](GAME-TOOLS.md) |
| Lancer sur le Mac mini ou le PC | [REMOTE-TESTS.md](REMOTE-TESTS.md) | skill `remote-e2e`, [THERMAL.md](THERMAL.md) |
| Mesurer des performances | [PERFORMANCE.md](PERFORMANCE.md), [GRAPHICS-PIPELINE.md](GRAPHICS-PIPELINE.md) §10 | [THERMAL.md](THERMAL.md), [perf/](perf/audit-plan.md), [benchmark-analyse/](benchmark-analyse/README.md) |
| Campagne d'autopilotes | [FLIGHTLAB.md](FLIGHTLAB.md) | [CAMPAGNE-AUTOPILOTES-2026-10-07.md](CAMPAGNE-AUTOPILOTES-2026-10-07.md) |
| Toucher à la Terre, au relief, aux tuiles | [systemes/03-univers-ephemerides.md](systemes/03-univers-ephemerides.md), CLAUDE.md « The Earth is WGS84 » | [ANALYSE-IGN-LIDAR.md](ANALYSE-IGN-LIDAR.md), [DATA-SOURCES-MONDE.md](DATA-SOURCES-MONDE.md), [FORETS-BATIMENTS-WORLDWIDE.md](FORETS-BATIMENTS-WORLDWIDE.md) |
| Toucher à TARS | [TARS.md](TARS.md), [systemes/10-tars-agent.md](systemes/10-tars-agent.md) | [PLAN-TARS-AGENT.md](PLAN-TARS-AGENT.md) |
| Savoir ce qui est cassé | [PROBLEMES-A-REGLER.md](PROBLEMES-A-REGLER.md) (à jour), [l'audit du 10 nov.](audit-2026-11-10/README.md) (230 constats par domaine, à reproduire avant correction), [ERRORS-TO-FIX.md](ERRORS-TO-FIX.md) (18 oct.) | les sections « Pièges et limites » de `systemes/`, « Limites » de VOL-AVIONS / VOL-VAISSEAUX |
| Déployer | [DEPLOY.md](DEPLOY.md) | [ASSETS.md](ASSETS.md) |
| Échanger avec le projet d'Alex | CLAUDE.md « Projet parallèle », [agent/](agent/) | [UNITY-SOLAR-SYSTEM.md](UNITY-SOLAR-SYSTEM.md) |

---

## 2. Les documents par nature

### 2.1 Règles et pilotage du projet (à la racine)

| Document | Rôle |
|---|---|
| [CLAUDE.md](../CLAUDE.md) | Règles permanentes : destination WebGPU AAA, journal, pipeline, Bun, WGS84, projet d'Alex, résultats montrés dans T3, carte de la doc |
| [AGENTS.md](../AGENTS.md) | Point d'entrée court pour tout agent : où sont les règles, les e2e, `__bh` |
| [README.md](../README.md) | Présentation, installation, liste des fonctions du jeu, liens vers les docs |
| [progress-to-destination.md](../progress-to-destination.md) | Journal obligatoire des avancées vers la destination (une entrée datée par lot) |
| `.claude/skills/e2e-campaign/SKILL.md`, `.claude/skills/remote-e2e/SKILL.md` | Les skills des agents : écrire/lancer des e2e, lancer à distance |

### 2.2 Manuels du joueur (ce que fait le jeu, côté joueur)

Anglais et français (`.fr.md`) quand les deux existent. Ils décrivent les touches, les écrans, les modes ; pas le code.

| Document | Sujet |
|---|---|
| [comment-jouer.html](comment-jouer.html), [decouvrir.html](decouvrir.html), [kerr.html](kerr.html) | Pages publiées avec le site (français, illustrées) |
| [F35.md](F35.md) / [F35.fr.md](F35.fr.md) | Le F-35B et le F-35C : touches, loi de vol, autopilote, radar, armes, porte-avions, école |
| [VAISSEAUX.md](VAISSEAUX.md) / [VAISSEAUX.fr.md](VAISSEAUX.fr.md) | Ranger, Lander, Endurance : assistance, touches, autopilotes, protections, école, missions |
| [CAMERA.md](CAMERA.md) / [CAMERA.fr.md](CAMERA.fr.md) | Caméra libre, voyages, vues autour de tout appareil |
| [MENUS.md](MENUS.md) / [MENUS.fr.md](MENUS.fr.md) | Intro, titre, lancement, pause, réglages |
| [NETWORK.md](NETWORK.md) / [NETWORK.fr.md](NETWORK.fr.md) | Jouer ensemble |
| [RADAR.md](RADAR.md) / [RADAR.fr.md](RADAR.fr.md) | Radar, image tactique, pistes |
| [HUD.md](HUD.md), [COCKPIT.md](COCKPIT.md), [HOTAS.md](HOTAS.md), [MAP.md](MAP.md) | HUD, cockpit interactif, manettes, carte 3D |
| [TARS.md](TARS.md), [AUDIO.md](AUDIO.md), [SOUND.md](SOUND.md) | Voix, musique, TARS ; son spatial et synthèse |
| [CREW.md](CREW.md) | La console équipage (`crew/`), son API `__crew` |
| [GAME-TOOLS.md](GAME-TOOLS.md) | Fenêtre des outils (F2), placement, date, sauvegardes, `__bh.game` |
| [aviation/](aviation/fr/f35.md) (en, fr) | Base de connaissances aviation de TARS (11 pages) |
| [spatial/](spatial/fr/orbits.md) (en, fr) | Base de connaissances spatiale de TARS (orbites, manœuvres, rentrée, rendez-vous, relativité, pannes) |

### 2.3 Références du code (comment ça marche, à garder vraies)

| Document | Sujet | Mise à jour obligatoire quand… |
|---|---|---|
| [GRAPHICS-PIPELINE.md](GRAPHICS-PIPELINE.md) | Chaque passe, cible, profil, compilation, parcours joueur, mesures | une passe, un pipeline, une cible, une table, la cascade ou le chargement change (CLAUDE.md ; `bun scripts/pipeline-inventory.ts --check`) |
| [BH-API.md](BH-API.md) | `__bh`, la poignée d'automatisation : chaque membre, ses unités | un membre de `__bh` est ajouté, retiré ou change de signature (`bh-api.e2e.test.ts`, `bun scripts/bh-api.ts --check`) |
| [VOL-AVIONS.md](VOL-AVIONS.md) | Partie I : le cours de pilotage des avions (12 leçons) ; partie II : modèles de vol, commandes, systèmes, définitions, limites, pilotage depuis `__bh` — version illustrée [apprendre-avions.html](apprendre-avions.html) | un modèle de vol, un système, une limite, un mode d'autopilote ou un outil de placement d'avion change |
| [VOL-VAISSEAUX.md](VOL-VAISSEAUX.md) | Partie I : le cours de pilotage des vaisseaux (14 leçons) ; partie II : physique, commandes, autopilotes, systèmes, limites, pilotage depuis `__bh` — version illustrée [apprendre-vaisseaux.html](apprendre-vaisseaux.html) | idem pour les vaisseaux |
| [systemes/](systemes/README.md) 01–11 | Une fiche par système (traceur, rendu, univers, commandes, pilote, trajectoires, modèles 3D, interface, jeu/audio/build, TARS, ajouts) — rédigées le 2 oct., complétées le 10 oct. | une refonte d'un système : corriger la fiche ou y signaler l'écart |
| [HORIZONS.md](HORIZONS.md), [GEANTES-GAZEUSES.md](GEANTES-GAZEUSES.md), [THIRD-PERSON-IMPLEMENTATION.md](THIRD-PERSON-IMPLEMENTATION.md) | Ombres longues du relief ; nuages et air des géantes ; exploration à pied | le système décrit change |
| [WEBGPU-MATERIELS.md](WEBGPU-MATERIELS.md) | Quels appareils jouent, avec quoi | un palier matériel ou un repli change |
| [DATA-SOURCES-MONDE.md](DATA-SOURCES-MONDE.md), [ASSETS.md](ASSETS.md) | Sources de données du monde ; assets, LFS, taille | une source ou un pack ajouté |
| [DEPLOY.md](DEPLOY.md) | Pages et serveur | la CI ou le déploiement change |

### 2.4 Tester et mesurer

| Document | Sujet |
|---|---|
| [E2E.md](E2E.md) | Le guide des e2e : le labo, lancer, écrire, les règles, la procédure de campagne, le dépannage, le tableau de bord |
| [E2E-VOLS.md](E2E-VOLS.md) | Les e2e qui volent : placer un appareil, temps (gel, pas, pause, accélération), attentes (compilation, tuiles), autopilotes, poussée, train ; les échecs fréquents relevés dans l'historique et leurs causes |
| [E2E-CATALOGUE.md](E2E-CATALOGUE.md) | Chaque fichier e2e : ce qu'il prouve, sa durée |
| [BH-API.md](BH-API.md) | (voir 2.3) |
| [REMOTE-TESTS.md](REMOTE-TESTS.md) | kerr-mini et kerr-pc : `scripts/remote.ts`, files d'attente, résultats |
| [FLIGHTLAB.md](FLIGHTLAB.md) | Campagnes d'autopilotes notées (`scripts/flightlab.ts`) |
| [IPAD-TESTS.md](IPAD-TESTS.md) | L'iPad branché au mini |
| [THERMAL.md](THERMAL.md) | Le service thermique : à vérifier avant toute mesure |
| [PERFORMANCE.md](PERFORMANCE.md) | Analyse de performance (27 sept., complétée), profileurs, Kerr Bench |
| [perf/](perf/audit-plan.md), [benchmark-analyse/](benchmark-analyse/README.md), `bench-result-externes/` | Mesures et analyses de bench datées |

### 2.5 Stratégie et analyses (constats datés)

| Document | Statut |
|---|---|
| [ANALYSE-STRATEGIE-RENDU-2026-11-03.md](ANALYSE-STRATEGIE-RENDU-2026-11-03.md) | **Référence stratégique permanente** (décision de Sam du 3 nov.) ; [REFONTE-WEBGPU-2026-11-03.html](REFONTE-WEBGPU-2026-11-03.html) et [STRATEGIE-WEBGPU-AAA-LIBRAIRIES-2026-11-03.html](STRATEGIE-WEBGPU-AAA-LIBRAIRIES-2026-11-03.html) en sont des présentations |
| `ANALYSE-*.md` (chargement GPU, IGN/LiDAR, Paris, pipeline Terre, Terre photoréaliste, Terre raster 28 oct. et 2 nov., Terre Unreal) | Constats datés ; vérifier dans le code avant d'en reprendre un diagnostic |
| `CHALLENGE-*.md` | Contre-analyses d'une analyse ou d'un plan |
| [RECHERCHE-DONNEES-SCIENTIFIQUES-AAA-2026-11-03.md](RECHERCHE-DONNEES-SCIENTIFIQUES-AAA-2026-11-03.md) | Données scientifiques et géographiques candidates |
| [UNITY-SOLAR-SYSTEM.md](UNITY-SOLAR-SYSTEM.md) | Note pour un portage Unity (référence de pratiques, pas un chantier) |

### 2.6 Plans (`PLAN-*.md`)

Un plan décrit des phases et les décisions de Sam à sa date ; son en-tête ou sa section d'état dit ce qui est fait.
Les plans terminés restent comme historique des décisions. Avant de reprendre une phase, lire l'état en tête du plan et
`git log -- <fichiers du plan>`. Les plans en cours le 6 novembre 2026 : [PLAN-REFRACTION-HORIZONS](PLAN-REFRACTION-HORIZONS.md)
(et [C0](progress/refraction-horizons/C0.md)), [PLAN-NUIT-URBAINE](PLAN-NUIT-URBAINE.md),
[PLAN-AURORES-MAGNETOSPHERES](PLAN-AURORES-MAGNETOSPHERES.md), [PLAN-CAPTEURS-CAMERA-SECONDAIRE](PLAN-CAPTEURS-CAMERA-SECONDAIRE.md)
(rien d'implémenté), [PLAN-PLANETES-AAA](PLAN-PLANETES-AAA.md), [PLAN-AVIATION-AAA](PLAN-AVIATION-AAA.md),
[PLAN-IMAGE-VIPER11](PLAN-IMAGE-VIPER11.md) et [PLAN-SERVICES-SERVEUR-AAA](PLAN-SERVICES-SERVEUR-AAA.md) (plans sans
implémentation). Abandonné : PLAN-ELECTRON (pas de fichier). Les autres sont terminés ou absorbés ; leur état figure en tête.

### 2.7 Suivi, journaux, historique

| Document | Rôle |
|---|---|
| [progress-to-destination.md](../progress-to-destination.md) | Journal de la destination (depuis le 3 nov.) |
| [AAA-PROGRESS.md](AAA-PROGRESS.md) | Suivi d'exécution AAA (oct.) |
| [progress/](progress/) | Une planche de captures par phase de plan (`progress/<plan>/`) |
| [progress/apprendre-a-voler-examens.md](progress/apprendre-a-voler-examens.md) | Les examens des cours de pilotage par des LLM élèves : la méthode (à refaire quand un cours change), les résultats, ce qui reste ouvert |
| [PROBLEMES-A-REGLER.md](PROBLEMES-A-REGLER.md), [ERRORS-TO-FIX.md](ERRORS-TO-FIX.md), [CORRECTIONS-DETAILS-SOL-VOL.md](CORRECTIONS-DETAILS-SOL-VOL.md), [BUG-IAU-RATE-LIBRATION.md](BUG-IAU-RATE-LIBRATION.md) | Problèmes ouverts et corrigés |
| [audit-2026-11-10/](audit-2026-11-10/README.md) | **Audit total du 10 novembre 2026** : la synthèse, huit rapports par domaine (chargement, rendu, architecture, réseau, TARS, vol, plans, tests) et [les priorités](audit-2026-11-10/09-priorites-todo.md) ; constat daté, rien reproduit en jeu |
| [J0-CONTRAT.md](J0-CONTRAT.md), [progress/j0/](progress/j0/) | **J0** : le contrat d'acceptation (profil, palier 25 ms sur M1 Max, scène de référence Toulon-Hyères, mesures, ablations par poste, propriétaires) et ses fiches de mesure ; à relire avant tout lot qui prétend changer la cadence ou la qualité |
| [ANALYSE-MER-LITTORAL-VEGETATION-2026-11-10.md](ANALYSE-MER-LITTORAL-VEGETATION-2026-11-10.md), [progress/mer-vegetation/](progress/mer-vegetation/) | Analyse de web-ocean et BakedVoxelLighting (10 nov.) : ce que nous reprenons pour la mer, le littoral et la végétation, mesures comparées, captures ; plans touchés : PLAN-REFRACTION-HORIZONS §0.4, stratégie §23 |
| [PLAN-MER-WEBGPU.md](PLAN-MER-WEBGPU.md) | **La mer au niveau de web-ocean dans notre monde** (décision de Sam du 10 nov. : avant J1) : lots S0–S6 et le littoral L1–L3 (champ de houle côtier, déferlement), architecture (FFT, surface maillée, ombrage, écume, ciel reflété), mesures |
| [PLAN-VEGETATION-V2.md](PLAN-VEGETATION-V2.md), [progress/vegetation/](progress/vegetation/) | **Les arbres lointains en imposteurs ré-éclairables** (V2 de l'analyse du 10 nov., lancé le 11) : arbres modélisés procéduralement (V2a), cuisson hémi-octaédrique (V2b), dessin et au-delà de 6,25 km (V2c–V2e), contrats des vues |
| [PLAN-J1-OPAQUE-FORWARD.md](PLAN-J1-OPAQUE-FORWARD.md) | **J1, l'opaque terrestre en forward** (stratégie §15, « J1 suit la mer ») — **terminé le 12 nov.** : l'existant relevé dans le code, lots J1-0 à J1-7 (description de frame figée, sorties de surface — profondeur gardée, identité, mouvement —, bibliothèque de matériaux, forward du terrain, appareil dans la scène, export, bascule), contrats et questions à Sam, leçons |
| [PLAN-J2-PAGES-RECONSTRUCTION.md](PLAN-J2-PAGES-RECONSTRUCTION.md) | **J2, pages d'imagerie filtrables et reconstruction** (stratégie §15) — **plan du 12 nov., à valider par Sam** : l'existant relevé (imagerie et relief d'`earth-tiles.ts` après T9, publication, invalidations, `shade`/`temporal`/`taau`/échelle, ce que J1 laisse), lots J2-0 à J2-8 (+ J2-C en option), la sortie en mesures, contrats, bibliothèques, risques, questions |
| [ANALYSE-STREAMING-2026-11-06.md](ANALYSE-STREAMING-2026-11-06.md), [PLAN-CHARGEMENT-MONDE.md](PLAN-CHARGEMENT-MONDE.md) | Le chargement du monde : l'analyse et le plan ST0–ST10 (décor) ; le plan CM0–CM9 (tuiles), proposé le 10 nov. ; CM0 (mesure par tuile, e2e `tile-arrival` avec SW et liaison bridée), CM1 (plus de trou définitif) et CM2 (deux budgets de la Géoplateforme dans le SW) faits le 12 nov. ; CM3 (préchargement du départ) mesuré, en attente d'une décision de Sam |
| [PLAN-RESEAU-DURCISSEMENT.md](PLAN-RESEAU-DURCISSEMENT.md) | Durcir le réseau (RD0–RD7) : validation, droits, reprise, serveur ; proposé le 10 nov., rien d'implémenté |
| `AUDIT-*.md`, `REVIEW-*.md`, [MERGE-PERF-RENDER.md](MERGE-PERF-RENDER.md) | Audits et revues datés |
| [E2E-CAMPAIGN-2026-10-13.md](E2E-CAMPAIGN-2026-10-13.md), [CAMPAGNE-AUTOPILOTES-2026-10-07.md](CAMPAGNE-AUTOPILOTES-2026-10-07.md) | Comptes rendus de campagnes |
| [agent/](agent/) | Notes pour le Claude d'Alex (`<sujet>_<AAAA-MM-JJ-HH-MM-SS>.md`, UTC) |
| [marketing/](marketing/README.md), [video/](video/), [img/](img/) | Matériel de présentation, vidéos, images des docs |

---

## 3. Quel document mettre à jour quand…

| Changement | Documents à mettre à jour dans le même lot |
|---|---|
| Une passe, un pipeline, une cible, une table, la cascade, le chargement | [GRAPHICS-PIPELINE.md](GRAPHICS-PIPELINE.md) (+ `pipeline-inventory.ts --check` puis `--write`) |
| Un membre de `__bh` ajouté, retiré ou modifié | [BH-API.md](BH-API.md) (chemin complet en titre ou ligne de tableau) |
| Un outil de placement, un autopilote, un mode, une limite de vol, une touche de vol | [VOL-AVIONS.md](VOL-AVIONS.md) ou [VOL-VAISSEAUX.md](VOL-VAISSEAUX.md) (le cours et la référence) et sa page illustrée (`apprendre-*.html`) ; le manuel joueur ([F35.md](F35.md), [VAISSEAUX.md](VAISSEAUX.md)) si le joueur le voit ; [E2E-VOLS.md](E2E-VOLS.md) si une recette de test change |
| Une touche ou une commande | le manuel joueur (EN et FR), [HOTAS.md](HOTAS.md) si la manette est concernée |
| Un nouveau fichier e2e | son commentaire d'en-tête (`Duration:`, `Done when:`), une ligne dans [E2E-CATALOGUE.md](E2E-CATALOGUE.md) |
| Le harnais e2e (`tests/e2e/lib`, `scripts/e2e.ts`, `remote.ts`) | [E2E.md](E2E.md), [REMOTE-TESTS.md](REMOTE-TESTS.md), les skills `.claude/skills/*` |
| Une leçon d'e2e (un échec compris) | [E2E-VOLS.md](E2E-VOLS.md) §6 (le tableau des échecs) ou [E2E.md](E2E.md) §7 |
| Une fonction accessible à TARS | [TARS.md](TARS.md), `tests/tars-tools.test.ts` |
| Un problème constaté non corrigé | [PROBLEMES-A-REGLER.md](PROBLEMES-A-REGLER.md) |
| Une avancée vers la destination | [progress-to-destination.md](../progress-to-destination.md) |
| Une phase de plan terminée | l'état en tête du plan, sa planche dans `progress/`, le journal si elle sert la destination |
| Un nouveau document | une ligne dans cette carte |
