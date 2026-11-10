# Audit total du 10 novembre 2026 — synthèse

**Demande de Sam.** Une analyse totale : qualité, performance, code, fonctions, plans en cours et reste à faire, avec
le chargement des tuiles en premier. Écrire les analyses avant de modifier quoi que ce soit. Ne pas glorifier
l'existant. Le but : atteindre la destination (une expérience AAA en WebGPU, 60 images/s —
[ANALYSE-STRATEGIE-RENDU-2026-11-03.md](../ANALYSE-STRATEGIE-RENDU-2026-11-03.md)).

**État du document.** Constat daté, sur `main` à `29d4e5e3` plus la copie de travail. Le code fait foi.

## 1. Méthode et limites

- Huit audits par domaine, en lecture seule, chacun dans son fichier (table ci-dessous). 230 constats au total, chacun
  avec son fichier et sa ligne, sa gravité et son niveau de preuve.
- **Aucun code modifié. Aucun e2e, aucun benchmark, aucune mesure nouvelle.** Lancé : `tsc` (0 erreur, 15,8 s), Biome
  (107 avertissements, 0 erreur), `pipeline-inventory --check` (passe), `kernel-budget` (passe), `bh-api --check`,
  `check-repo-size`, la lecture de l'état de la CI.
- Les chiffres de cadence, de volume et de temps cités viennent des fiches et des journaux du projet, avec leur date.
  Certains sont périmés ; c'est dit là où ils sont cités.
- J'ai relu moi-même dans le code les constats que cette synthèse met en tête (ST-01 à ST-05, AR-01, AR-19, GP-06,
  GP-24, NET-01, NET-02, FX-01). Les autres reposent sur la lecture de l'agent du domaine. **Aucun constat n'a été
  reproduit en jeu** : avant de corriger un défaut de comportement, le reproduire par un e2e.
- Les gravités sont celles des rapports : P0 casse, perd des données ou bloque le joueur (ou la destination) ; P3 est
  cosmétique.

| Rapport | Domaine | Constats |
|---|---|---|
| [01-chargement-monde.md](01-chargement-monde.md) | Tuiles, décor, caches, service worker, zones hors ligne | ST-01 à ST-21 |
| [02-rendu-pipeline.md](02-rendu-pipeline.md) | Renderer, shaders, performance GPU, compilation | GP-01 à GP-33 |
| [03-architecture-code.md](03-architecture-code.md) | Boucle de frame, propriété de l'état, qualité du code | AR-01 à AR-24 |
| [04-reseau-equipage.md](04-reseau-equipage.md) | Multijoueur, serveur de salons, console d'équipage | NET-01 à NET-33 |
| [05-tars-audio.md](05-tars-audio.md) | TARS (agent, outils, voix, mémoire), audio | TA-01 à TA-26 |
| [06-vol-jeu-interface.md](06-vol-jeu-interface.md) | Vol, autopilotes, entrées, HUD, sauvegardes | FX-01 à FX-22 |
| [07-plans-reste-a-faire.md](07-plans-reste-a-faire.md) | Tous les plans, branches, décisions en attente, reste à faire consolidé | PL-01 à PL-45 |
| [08-tests-ci-build.md](08-tests-ci-build.md) | Tests, e2e, CI, build, PWA, licences, hygiène | QA-01 à QA-26 |
| [09-priorites-todo.md](09-priorites-todo.md) | **Les priorités et la liste de travail ordonnée** | — |

Plans écrits à la suite de l'audit : [PLAN-CHARGEMENT-MONDE.md](../PLAN-CHARGEMENT-MONDE.md) et
[PLAN-RESEAU-DURCISSEMENT.md](../PLAN-RESEAU-DURCISSEMENT.md).

## 2. Le verdict en six points

1. **La destination est écrite, pas engagée.** Depuis la décision du 3 novembre : aucun lot de fondation, aucune
   bascule, aucun jalon J0–J5 atteint. Il n'y a ni forward raster, ni surface finale commune, ni contrat de frame
   (GP-01). Pendant ce temps `trace.wgsl` et `renderer.ts` ont pris +3 923 / −784 lignes (`git log --numstat` depuis
   le 3 novembre). Chaque ajout de qualité est un lecteur de plus à migrer. Le risque nommé par la stratégie (§20.9,
   « roadmap purement déclarative ») est en train de se réaliser. J0 (2 à 3 jours) attend une décision de Sam depuis
   le 5 novembre.
2. **La cadence n'est pas pilotée.** En vol terrestre, aucun gouverneur n'agit sur le poste qui coûte : l'échelle est
   tenue à celle du raster (`src/main.ts:8892`), le taux de shading ne touche pas `shadeLite` (GP-06). Les vues de vol
   chargées étaient à 50–67 ms sur kerr-mini le 5 novembre (fiches du plan, §0.2). Il n'existe **aucune mesure récente
   sur M1 Max**, le profil cible, et la répartition de la frame par passe n'est pas connue sur Apple (GP-09). Aucune
   régression de performance n'est détectée automatiquement (QA-12).
3. **Le chargement des tuiles a des causes que le plan actuel ne traite pas.** Le relief IGN voyage en float32 brut
   (≈ 800 Mo sur une approche de 130 s, mesure T8n) ; en production le service worker bride toute la Géoplateforme à
   25 requêtes/s, et les e2e ne passent pas par lui ; une tuile échouée deux fois devient un trou définitif à 4,9 km ;
   rien n'est préchargé pendant le titre. Détail au §3.
4. **Le socle de simulation a trois propriétés sans propriétaire.** Le sol de contact est installé par le renderer et
   dépend des tuiles chargées autour de la caméra (AR-01). Le temps n'a pas de politique pour l'onglet masqué ni la
   reprise GPU (AR-02). `Settings` (388 clés) mêle préférences, scène, état simulé et pose de vue (AR-07). Ce sont
   exactement les responsabilités que la stratégie §19.12 demande de séparer.
5. **Le réseau fonctionne entre amis, il ne résiste pas au reste.** Presque aucun événement reçu n'est validé ; un
   message mal formé lèverait une exception avant le rendu chez tous (NET-01, à confirmer par e2e) ; tout membre peut
   agir sur l'appareil d'un autre ; le serveur public n'a ni quota ni limite de débit (NET-02, NET-03).
6. **La chaîne de livraison est fragile.** La CI de `main` est verte à 31,5 % sur 200 lancements, avec une série de
   36 rouges sur une erreur de format (QA-01). Aucun e2e ne tourne en CI. Les binaires suivis sont à 591,6 Mo sur 600
   et le site à 881 Mo sur 900 (QA-03) : au-delà, plus de déploiement. La référence stratégique que `CLAUDE.md` impose
   de lire n'est pas suivie par git (QA-24, AR-22). L'A320 vient de FlightGear (GPL v2) et n'apparaît ni dans les
   crédits ni dans une licence de dépôt (QA-22) — à faire valider, je ne tranche pas le droit.

## 3. Le chargement des tuiles : pourquoi c'est lent

Rapport complet : [01-chargement-monde.md](01-chargement-monde.md). Plan : [PLAN-CHARGEMENT-MONDE.md](../PLAN-CHARGEMENT-MONDE.md).

L'analyse du 6 novembre ([ANALYSE-STREAMING](../ANALYSE-STREAMING-2026-11-06.md)) conclut « ce n'est pas le réseau,
c'est l'assemblage ». C'est établi pour le **décor**. Pour les **tuiles**, l'audit trouve autre chose :

| Cause | Où | Preuve |
|---|---|---|
| **Volume.** Une grille de relief IGN pèse 256 Kio, 1 Mio pour le sursol lointain ; le halo en demande aussi. Une approche a téléchargé 1,08 Go en 130 s, soit ≈ 66 Mbit/s en moyenne. Sur une liaison plus lente, le relief fin n'arrive pas à temps. | `src/system/earth-tiles.ts:139-144` | lu ; volume mesuré (T8n, 6 nov.) ; débit calculé |
| **Débit bridé en production.** Le service worker fait passer tout `data.geopf.fr` par un portillon de 25 requêtes/s et 10 simultanées. Les orthophotos et la BD TOPO y sont, alors que la doc du projet les dit sans limite. Un saut à Paris demande de l'ordre de 1 200 requêtes : au moins 48 s, quelle que soit la liaison. | `src/sw.ts:525-594` | lu ; nombre de requêtes calculé |
| **Les mesures ne voient pas ce chemin.** Les e2e tournent sans service worker. « Vue à 90 % en 8,1 s » vient de là. | `src/pwa.ts:52-59` | lu |
| **Trous définitifs.** Deux échecs : la tuile devient la carte mondiale à 4,9 km, n'est plus redemandée, et sert au contact sol. | `src/system/earth-tiles.ts:1796-1810` | lu |
| **Dépendances en chaîne.** Sans Terrarium, pas de relief national. Sans la tuile de nuit, pas d'imagerie de jour. | `earth-tiles.ts:1768-1779`, `:2577` | lu |
| **Demandes inutiles.** Le niveau le plus fin est demandé quelle que soit la vitesse ; la prédiction regarde 650 m devant. | `earth-tiles.ts:1358`, `streaming-focus.ts:7-14` | lu ; effet non mesuré |
| **Départ à froid.** Pendant le titre et le voile d'entrée (jusqu'à 90 s), aucune tuile n'est demandée. | `src/main.ts:9740-9763` | lu |
| **Publication.** Chaque tuile est écrite 3 à 4 fois sur le GPU ; un niveau n'est dessiné que sur un rectangle plein, donc des tuiles arrivées restent invisibles. | `earth-tiles.ts:1900-1913`, `:1938-2003` | lu ; coût GPU non mesuré |
| **Décor.** Toujours une scène entière de 13 km refaite d'un bloc par un seul worker : 20–44 s. | `src/system/scenery.ts:193-303` | lu ; mesuré le 6 nov. |

État du plan ST0–ST10 : ST0 partiel, **ST1 écrit mais non commité depuis le 6 novembre** (12 fichiers dans la copie de
travail), ST2 à ST10 non commencés.

**Ce que je recommande** : mesurer d'abord le chemin réel du joueur (avec service worker, liaison bridée), puis trois
petits lots indépendants — plus de trou définitif, le portillon séparé pour les orthophotos, le préchargement du
départ — puis la réduction des octets de relief. L'ordre et les critères sont dans le plan.

## 4. Par domaine : l'essentiel

### 4.1 Rendu et performance ([02](02-rendu-pipeline.md))

- Le « raster » terrestre est une passe de visibilité suivie d'un ombrage différé en compute dans `trace.wgsl` ; trois
  ombrages de la Terre proche coexistent (`main`, `shade`, `shadeLite`) (GP-02) ; quatre profondeurs, pas d'identité
  ni de mouvement par pixel (GP-03).
- Les encodages provisoires se sont installés : marqueurs dans `moments.x` et dans l'alpha de la cible de distance,
  62 lecteurs (GP-04). Le contrat C0-2 dit `rgba32uint`, le code est en `rgba32float`.
- Les offsets de `Params` sont écrits à la main (73 `set(n…)`), sans test de concordance avec le WGSL (GP-31).
- La cible live est recréée à chaque arrêt et reprise de la caméra (GP-24). En mode « auto », `shade` et `shadeMark`
  sont dispatchés à chaque image même quand `shadeLite` prend tout (GP-07).
- Compilation : 203 s à froid près de Jupiter (mesuré le 6 nov.), sans anticipation (GP-20) ; environ 55 pipelines
  synchrones au démarrage, jamais chronométrés (GP-22).
- Huit options coupées gardent leur code et leurs variantes (GP-17) ; douze selon l'audit des plans, dont dix sans
  condition de retrait écrite.
- Solide : une soumission par image, aucune lecture GPU bloquante, destruction différée, reprise après perte du
  device, Z inversé partout, travail lourd en workers.

### 4.2 Architecture et code ([03](03-architecture-code.md))

- `main()` est une fonction de 9 700 lignes avec 372 variables de fermeture (AR-12). Une exception avant
  `renderer.frame` fige l'image à chaque tour (AR-03).
- Les instruments et les poses sont calculés après le rendu (AR-04) ; l'autosauvegarde et du layout tournent dans la
  frame (AR-05).
- Toutes les sauvegardes nommées vivent dans une seule clé `localStorage` ; illisible, elle est écrasée en silence
  (AR-19). `load` appelle `newFlight` : systèmes de l'A320, train, carburant et météo ne sont pas restaurés (AR-09,
  FX-09).
- 418 écouteurs posés pour 24 retirés (AR-18, fuite supposée) ; 238 promesses non attendues (AR-17).
- Solide : `tsc` strict à 0 erreur sur 310 000 lignes, 7 `as any`, graphe d'imports sain, WGS84 et géoïde appliqués
  presque partout (trois altitudes sphériques restantes, AR-10).

### 4.3 Réseau ([04](04-reseau-equipage.md))

Voir le verdict 5 et [PLAN-RESEAU-DURCISSEMENT.md](../PLAN-RESEAU-DURCISSEMENT.md). À ajouter : amarrages, passagers
et scores ne sont jamais rejoués aux arrivants (NET-10) ; pendant une coupure du WebSocket plus rien n'est envoyé,
même en lien direct (NET-11) ; météo, trafic et date sont locaux en salle (NET-26).

### 4.4 TARS et audio ([05](05-tars-audio.md))

- Un tour coupé par une nouvelle question est lu comme un échec du modèle : l'ancien ordre est rejoué hors ligne
  pendant que le nouveau agit (TA-01, lu, non reproduit).
- `saves delete` efface sans confirmation, alors que le menu Pause demande un second appui (TA-02).
- Aucun outil pour le pilote automatique des avions ni pour l'A320 (FCU, MCDU, ECAM), alors que la console d'équipage
  le fait par `camera.apSet` (TA-03). Réseau, zones hors ligne, PCD et capteurs sans outil (TA-17).
- 68 outils et 77 000 caractères renvoyés à chaque étape, jusqu'à 24 étapes par tour, sans cache ni streaming (TA-04).
- Les erreurs 401, 402, 429 et 5xx sont muettes (TA-05).

### 4.5 Vol et interface ([06](06-vol-jeu-interface.md))

- Maj et Alt sont à la fois modificateurs et manette des gaz : un raccourci avec Maj coupe l'ILS, l'appontage, la
  formation (FX-01).
- U et F7 sur le F-35B hors pont et sur l'A320 lancent l'autopilote orbital, qui refuse puis met la manette à 0 (FX-02).
- Le Lander posé reste en `auto === "takeoff"` sans poussée ni message (FX-03, constaté en jeu le 6 novembre).
- La matrice appareil × fonction du rapport (§4) montre où les appareils divergent : « tout relâcher », sauvegarde
  fidèle, manette de l'A320, école de l'A320.

### 4.6 Plans ([07](07-plans-reste-a-faire.md))

- Quatre plans réellement en cours : T/Q/H/R, aurores, nuit urbaine, streaming. Trois ouverts sans activité : planètes
  (P10), aviation (C4, T4, T5), A320 (A15–A19). Deux jamais commencés : capteurs, services serveur.
- 26 décisions attendent Sam (D1 à D26, rapport §4). Six bloquent toute la séquence : le jalon, la scène de
  référence, le palier de cadence, la relecture de C0, le budget de Q1, les propriétaires de temps, sol, vue et image.
- Contradictions : cadence 25/40 « confirmés » (C0-8) contre 60 (stratégie) ; quatre documents décrivent le rendu
  terrestre, dont deux absorbés sans le dire ; PLAN-MONDE-VIVANT impose « tout tracé », contraire au raster par défaut.
- Plusieurs en-têtes de plan sont faux (le plan aurores dit « rien n'est commencé » avec AM0–AM4, AM6 et AM7 commités).

### 4.7 Tests et livraison ([08](08-tests-ci-build.md))

- 19 fichiers e2e sans `expect`, 96 `waitFor` avalés, des membres inexistants lus (`c.last?.alt` dans 8 fichiers)
  (QA-08). 1 121 attentes fixes, 140 délais de 600 s ou plus (QA-09).
- `main.ts`, `renderer.ts`, l'interface réseau et la console d'équipage n'ont pas de test direct (QA-10).
- Les previews de branches partagent l'origine Pages de la production, donc lisent les clés OpenRouter et Deepgram en
  `localStorage` (QA-04). Pas de CSP (QA-18).
- 125 e2e suivis sur 396 absents du catalogue (QA-11).

## 5. Ce qui est solide

Dit une fois, sans emphase : le jeu charge, vole, se joue à plusieurs et se mesure. Le typage est strict et propre.
La simulation a un pas commun au direct, à l'automatisation et à la vidéo. Le renderer ne bloque pas sur le GPU et se
relève d'une perte de device. Le travail lourd est en workers. L'outillage de mesure est riche (`trace-ab`,
`ab-commit`, `perf-suite`, le voyant réseau, le profileur). Les docs distinguent mesuré, estimé et périmé. Le garde de
déploiement a tenu : pendant 36 lancements rouges, rien de cassé n'a été publié.

## 6. La suite

Les priorités, la liste ordonnée et les décisions à prendre sont dans [09-priorites-todo.md](09-priorites-todo.md).
