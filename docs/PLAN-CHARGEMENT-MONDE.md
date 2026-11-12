# Plan — le chargement du monde : des tuiles qui arrivent vite et ne laissent pas de trou

**État (12 novembre 2026) : CM0 fait (mesure du chemin réel, §8) ; CM1–CM3 en cours (décision de Sam du 12 novembre :
CM0 → CM1 → CM2 → CM3). Le reste proposé.** Proposé le 10 novembre. Il vient de l'audit du 10 novembre
([01-chargement-monde.md](audit-2026-11-10/01-chargement-monde.md), constats ST-01 à ST-21) et complète le plan
ST0–ST10 de [ANALYSE-STREAMING-2026-11-06.md](ANALYSE-STREAMING-2026-11-06.md), qu'il ne remplace pas. Le code fait foi.
Aucun gain n'est mesuré : chaque lot porte son critère et sa mesure, à faire avant de l'écrire comme acquis.

**Demande de Sam (10 novembre).** « Il y a encore des problèmes de chargement des tuiles. C'est assez lent. »

## 1. Pourquoi un plan de plus

Le plan ST traite surtout le **décor** (bâtiments, forêts, rues) : cellules, cuisson, cache cuit, pool GPU. Son résumé
dit « le défaut perçu n'est pas le réseau ». C'est établi pour le décor. Pour les **tuiles** (relief et imagerie),
l'audit trouve des causes que le plan ST ne contient pas :

| Cause | Constat | Preuve |
|---|---|---|
| Le relief IGN voyage en float32 brut : 256 Kio par grille, 1 Mio pour le sursol | ST-01 | lu ; 1,08 Go en 130 s mesuré (T8n), soit ≈ 66 Mbit/s calculé |
| En production, le service worker limite toute la Géoplateforme à 25 requêtes/s et 10 simultanées, orthophotos et BD TOPO comprises ; les e2e tournent sans service worker | ST-02 | lu (`src/sw.ts:525-594`) ; étape BD TOPO 12–23 s mesurée (T8o) |
| Une tuile échouée deux fois devient la carte mondiale à 4,9 km, pour de bon | ST-03 | lu (`src/system/earth-tiles.ts:1796-1810`) |
| Sans Terrarium, aucun relief national ; sans la tuile de nuit, aucune imagerie de jour | ST-04, ST-05 | lu |
| Le niveau le plus fin est demandé quelle que soit la vitesse | ST-11 | lu ; effet calculé, non mesuré |
| Rien n'est préchargé pendant le titre et le voile d'entrée | ST-15 | lu (`src/main.ts:9740-9763`) |
| L'imagerie n'a ni plafond ni priorité ; son délai court dès la mise en file | ST-08 | lu |
| Le service worker relit son index à chaque tuile et ne fusionne pas les requêtes identiques | ST-10 | lu ; coût supposé |

## 2. Principes

1. **Mesurer le chemin du joueur.** Avec le service worker, sur une liaison bridée (20 et 50 Mbit/s) et sur la fibre.
   Une mesure sans service worker ne décrit pas la production.
2. **D'abord ne plus laisser de trou, ensuite aller plus vite.** Un trou définitif est pire qu'une attente.
3. **Réduire la demande avant d'augmenter le débit.** Les octets qui ne seront jamais vus sont le premier gain.
4. **Un lot = un petit changement mesuré avant/après**, sur les mêmes vols de référence.
5. **Compatible avec la destination** (stratégie §7.6, §7.19) : données prêtes avant la frame, publication
   versionnée, couverture gardée jusqu'au remplacement. Ces lots préparent ST2 (ordonnanceur) et ST9 (validité par
   tuile) ; ils ne créent pas un second système.

## 3. Vols de référence et mesures

Trois vols, déjà utilisés par les fiches T8 et l'analyse du 6 novembre, à rejouer tels quels :

| Vol | Ce qu'il charge | E2e existant |
|---|---|---|
| Saut à Paris, 900 m, vue tenue | IGN complet : relief, sursol, orthophotos | `tile-arrival` (T8) |
| Approche de JFK de nuit, 93 m/s | Mapterhorn, USGS, Overture, rues de nuit | `lebourget-night-ils` avec `LBN_FIELD` |
| Chamonix, vol bas rapide (≥ 200 m/s) | relief fin en mouvement | à écrire à partir de `tile-arrival` |

Chaque mesure donne, par source : octets, requêtes, échecs, délai demande → dessin (médiane et 95ᵉ centile), temps
jusqu'à 90 % de la vue au niveau voulu, trous restants à 60 s. Trois conditions : sans service worker (le chemin
actuel des e2e), avec service worker, avec service worker et liaison bridée à 20 Mbit/s (DevTools
`Network.emulateNetworkConditions`).

## 4. Les lots

Ordre conseillé : CM0, puis CM1, CM2 et CM3 (petits, indépendants), puis CM4, CM5, CM6, puis les lots ST.

| Lot | Contenu | Constats | Taille | Critère de passage (à mesurer) |
|---|---|---|---|---|
| **CM0 — mesurer le vrai chemin** | Horodatage par tuile (demandée, reçue, décodée, téléversée, dessinée) exposé par `__bh` ; e2e `tile-arrival` avec `sw=1` et liaison bridée ; tableau par source. Termine ST0. | ST-21, ST-02 | S | Les trois vols, trois conditions, chiffres reproductibles à ±10 % |
| **CM1 — plus de trou définitif** | Ne plus publier la carte mondiale comme tuile fine : garder le parent réel et redemander avec un recul borné ; compteur d'échecs remis à zéro au retour du réseau ; relief national demandé même si Terrarium échoue ; imagerie de jour publiée sans attendre la nuit ; échecs non mis en cache | ST-03, ST-04, ST-05, ST-20 | S | Réseau coupé 20 s puis rendu : 0 tuile à 4,9 km sous la caméra après 30 s ; test unitaire de chaque repli |
| **CM2 — le portillon de la Géoplateforme** | Établir d'abord quel service a répondu 429 (journal par service). Puis deux budgets dans le service worker : WMS-R à débit limité, WMTS et TMS à concurrence seule. Pause globale sur 429 gardée. | ST-02 | S | Avec service worker : temps à 90 % de la vue de Paris proche de la mesure sans service worker ; 0 réponse 429 sur les trois vols |
| **CM3 — précharger le départ** | Dès que le mode et le lieu sont choisis (titre, voile d'entrée, voyage G) : fenêtres de tuiles et scène de décor demandées pour la position de départ | ST-15 | S | Première image d'un vol terrestre : part de la vue au niveau voulu à l'ouverture, avant/après |
| **CM4 — moins d'octets de relief** | (a) pas de grille nationale pour le halo ; (b) sursol 512² seulement dans le champ ; (c) niveau le plus fin plafonné par le temps de séjour dans la fenêtre (demi-fenêtre ÷ vitesse, comparé au délai d'arrivée observé) ; (d) fenêtres avancées le long de la trajectoire. Puis recherche documentaire : format plus léger côté IGN, LiDAR HD français chez Mapterhorn — **supposé, à confirmer** dans la documentation officielle. | ST-01, ST-11 | S puis M | Approche de Paris : octets de relief divisés par deux sans perte au 95ᵉ centile de la qualité vue (`tile-arrival`) ; à 20 Mbit/s, le relief sous l'appareil arrive avant le survol |
| **CM5 — imagerie ordonnée** | Plafond de concurrence par hôte, priorité par la vue, délai compté à l'envoi et non à la mise en file | ST-08 | S–M | À 20 Mbit/s : 0 délai d'imagerie expiré en file ; imagerie du centre de vue d'abord |
| **CM6 — service worker plus léger** | Éviction sans relire l'index à chaque tuile ; requêtes identiques en vol fusionnées ; Lune et Mars dans le cache ; assets non retéléchargés à chaque version quand leur contenu n'a pas changé | ST-10, ST-16, ST-17 | S–M | Temps du service worker par tuile en cache (médiane) mesuré avant/après ; mise à jour de version : octets retéléchargés |
| **CM7 — publications GPU bornées** | Une écriture par tuile quand relief mondial, national et sursol arrivent dans la même image ; mips regroupés en une soumission par image ; budget d'octets par image. C'est ST5 pour les tuiles. | ST-06 | M | Aucune image avec plus de N Mo téléversés (N fixé par CM0) ; 95ᵉ centile du temps d'image stable pendant une rafale |
| **CM8 — validité par tuile** | Un niveau dessiné tuile par tuile, plus par rectangle plein. C'est ST9. Touche le shader et le cache du relief : à faire sur l'interface de surface de la destination (§7.4), pas avant. | ST-07 | M–L | Tuiles arrivées et non dessinées : 0 |
| **CM9 — calcul IGN hors du fil principal** | Les relevés et assemblages de grilles en worker. C'est ST9. | ST-09 | M | 95ᵉ centile de la boucle de page pendant une rafale de relief |
| **Décor** | ST3 + ST6 (cellules et cache cuit), puis ST5, ST4, ST7, ST8, ST10, dans l'ordre de l'analyse du 6 novembre. Deux petits correctifs avant : worker gardé au saut, recul court après un échec. | ST-12, ST-13, ST-14 | L | Ceux de l'analyse du 6 novembre |
| **Zones** | ~~Commiter ST1~~ (**fait le 10 novembre**, avec les pistes dans les zones et l'annulation des requêtes d'une scène abandonnée ; `zones-usa-night` vert sur ce Mac) ; ne plus se fier à `navigator.onLine` ; un 404 ne s'épingle pas dans une zone ; les fichiers du jeu gardés pour un premier passage hors ligne (modèles, workers, cartes des corps) | ST-18 | S | e2e `zones-usa-night` vert, suivi par git |
| **Mémoire** | Budget commun des tuiles (≈ 1 Go calculé en `veryFar`, jamais rendu) : réglage joueur et éviction | ST-19 | M | Mémoire des tuiles bornée et affichée |

## 5. Ce que ce plan ne fait pas

- Il ne remplace pas l'ordonnanceur unique (ST2). CM2 et CM5 en sont des morceaux, écrits pour y être repris.
- Il ne décide pas d'Effect (décision D23 de l'audit).
- Il ne promet pas de chiffre. Le seul chiffre connu est le volume mesuré le 6 novembre (T8n).

## 6. Risques

- **Quotas de l'IGN.** CM2 ouvre le débit des orthophotos : si les 429 venaient du WMTS, il faut refermer. D'où la
  première étape de CM2.
- **Qualité.** CM4 retire des demandes : un plafond de niveau mal réglé donne un sol flou en vol lent. Le critère
  porte sur la qualité vue, pas sur les octets seuls.
- **Sol de contact.** CM1 change la hauteur lue sous l'appareil pendant une panne de réseau. À relier au constat AR-01
  de l'audit (le sol de contact dépend des tuiles résidentes) : le service de sol doit dire quelle révision il sert.

## 7. Documents à tenir

Chaque lot met à jour [GRAPHICS-PIPELINE.md](GRAPHICS-PIPELINE.md) §7 (parcours joueur), ce plan (état en tête), le
journal [progress-to-destination.md](../progress-to-destination.md) et, pour un e2e nouveau,
[E2E-CATALOGUE.md](E2E-CATALOGUE.md).

## 8. État des lots

### CM0 — mesurer le vrai chemin : fait (12 novembre 2026)

- **Code.** `src/system/tile-arrivals.ts` (`ArrivalLog`) : chaque tuile horodatée — demandée, reçue (récupérée et décodée),
  écrite au GPU, son imagerie, ses hauteurs nationales, dessinée (son niveau la couvre) — et ses échecs ; exposé par
  `__bh.renderer.earthTiles.arrivals` (`stats()` par source, `list()`, `reset()` ; [BH-API](BH-API.md)). E2e `tile-arrival` :
  `TA_PLACE` (Aubrac, Paris 900 m, Chamonix 300 m), `TA_SW=0|1`, `TA_MBPS` (liaison bridée pour la page **et** son Service
  Worker, `cdp.throttle` dans `tests/e2e/lib/cdp.ts`), `TA_CUT_S` (coupure du réseau, pour CM1), tableau par source (délais,
  octets, refus par hôte et par couche IGN) et une capture par passe. Tests : `tests/tile-arrivals.test.ts`.
- **Mesuré** (ce Mac, MacBook Pro M1 Max, fenêtre visible ; 12 nov. 2026 02:48–03:00 UTC ; code `1b925312` + CM0 ; Paris, F-35
  figé 900 m au-dessus du sol, cap 60°, passe froide sur un profil neuf ; deux passes par condition ; fichiers
  `remote-results/tile-arrival/tile-arrival-base*.json`, non suivis par git) :

| Condition | Vue à 90 % | Vue à 99 % | Qualité moyenne 30 s | z 6–14 entiers (moyenne) | Imagerie demandée → reçue p50 / p95 | Orthophotos demandées → dessinées p50 / p95 | Relief IGN (après Terrarium) p50 / p95 | Mo |
|---|---|---|---|---|---|---|---|---|
| sans Service Worker | 4,9 / 6,1 s | 5,9 / 7,2 s | 0,90 / 0,86 | 10,3 / 11,4 s | 0,24–0,27 / 0,57–0,66 s | 0,7–0,76 / 1,0 s | 7,2–8,4 / 14–19 s | 250 / 190 |
| avec Service Worker | 4,9 / 5,8 s | 6,1 / 6,9 s | 0,91 / 0,89 | 10,5 / 11,0 s | **5,0–5,1 / 7,9–8,3 s** | **4,0–5,1 / 14–15 s** | **22,5–22,9 / 29–30 s** | 250 / 257 |
| avec SW, 20 Mbit/s | 21,1 / 21,8 s | 31,2 / 30,9 s | 0,53 / 0,51 | z 11–14 jamais entiers en 60 s | 1,7 / 2,4 s | 1,1–1,4 / 2,1–2,3 s | 32,6–33,6 / 49–50 s | 120 / 120 |

  Lecture : (1) **le Service Worker ne ralentit pas le relief Terrarium** (dessiné p50 0,28–0,31 s dans les deux cas) **mais
  retarde toute la Géoplateforme** : imagerie des niveaux z 9–14 (WMTS) × 20, orthophotos × 6, relief IGN × 3 — c'est le
  portillon unique de 25 requêtes/s et 10 en vol (ST-02), désormais mesuré. Le critère « vue à 90 % » ne le voit pas : il
  compte les niveaux de relief, pas leur imagerie ni leurs hauteurs nationales. (2) **À 20 Mbit/s la liaison est saturée**
  (≈ 120 Mo en 60 s ≈ 16 Mbit/s) : vue à 90 % en ≈ 21 s, z 11–14 jamais entiers en 60 s, 251 tuiles encore en attente —
  le volume du relief IGN (CM4) est le premier levier sur une liaison lente. (3) Aucune réponse 429 vue par la page dans ces
  passes (le SW en absorbe deux d'affilée : CM2 doit journaliser dans le SW). 83 réponses 502 de RGE ALTI dans une passe sans SW.
- **Reproductibilité** : à 20 Mbit/s, ±2 % entre les deux passes (vue à 90 % 21,1 / 21,8 s) ; sur la fibre, ±12 % (4,9 / 6,1 s
  sans SW) — le critère « ±10 % » du plan n'est **pas** tenu sur la fibre avec deux passes ; le réseau réel varie d'une minute à
  l'autre. Le rejeu (`TA_REPLAY`) reste l'outil des A/B fins.
- **Non fait** : les vols de JFK de nuit et de Chamonix en vol bas rapide (le plan en demandait trois) ; Aubrac non repassé ;
  le temps passé dans le portillon du SW lui-même (CM2) ; la latence d'un succès de cache du SW (CM6).

