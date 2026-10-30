# PLAN-SERVICES-SERVEUR-AAA — ce que le serveur fait mieux que les clients

**Date : 23 octobre 2026** (v2, réécrite après audit de la v1 du même jour). Base : `main` à `eb7b284d` + le
checkout local (zones hors ligne, sources nationales). Statut : **plan, aucune implémentation**.

La v1 cataloguait quinze capacités dimensionnées pour une infrastructure à grande échelle. Cette version garde ce
qui est **utile, mesurable et gérable** pour le jeu tel qu'il se joue : entre amis, ≤ 4 joueurs et ≤ 8 appareils par
salle, un serveur OVH Kimsufi, des clients M1 / iPad M1 plus rapides que lui par cœur.

## 1. Verdict

Le serveur apporte trois choses que les clients ne peuvent pas se donner seuls :

1. **Un travail fait une fois pour tous** : le réseau au sol d'un aéroport, la préparation des vecteurs du décor.
2. **Une donnée commune à la salle** : la même météo, au même instant, pour tous les équipages ; le même vol rejoué.
3. **Une source fiable à la place d'une source fragile** : Overpass saturé, quotas par IP, données qui changent
   entre deux pages.

Il n'apporte **pas** de calcul plus rapide (les clients le battent), ni de débit meilleur que les CDN publics
(IGN, AWS, EOX, swisstopo servent déjà ortho et relief gratuitement, CORS `*`), ni de GPU. D'où trois règles :

- **Les rasters ne passent jamais par le serveur.** Ortho et relief restent chargés directement chez leur
  fournisseur. Le serveur ne sert que des produits dérivés compacts et des états communs.
- **Rien dans la boucle de vol.** Pilotage, contacts, Auto-GCAS, guidage et prédictions courtes restent locaux.
  Chaque service a un repli : sans lui, le jeu fait exactement ce qu'il fait aujourd'hui.
- **Mesurer avant de construire gros.** Le seul chantier lourd (décor préparé, SV4) n'est lancé que si la mesure
  de SV0 montre un gain réel sur iPad.

## 2. Ce qui est retenu, ce qui ne l'est pas

| Retenu | Phase | Pourquoi |
|---|---|---|
| Réseaux d'aéroports servis | SV1 | Overpass est appelé par chaque client ([airportfetch.ts:13](../src/game/airportfetch.ts)) ; lent, saturé, soumis à une politique d'usage ; le résultat change en années |
| Météo commune de la salle | SV2 | Aujourd'hui chaque page interroge Open-Meteo/METAR seule : deux ailiers peuvent voler dans deux météos différentes |
| Débriefing de salle | SV3 | L'enregistreur et le replay existent ([replay.ts](../src/game/replay.ts)) ; rejouer le vol de tous est un vrai moment de jeu entre amis |
| Catalogues astronomiques précalculés | SV4 | Seulement si la recherche d'éclipses est lente sur iPad (mesure SV0) ; c'est un fichier statique, pas un service |
| Décor préparé, pilote | SV5 | Seulement si SV0 montre que le Worker de décor pèse sur iPad |
| Produits dans les zones hors ligne | SV6 | Le gestionnaire de zones est en cours ([zones.ts](../src/system/zones.ts)) : ses zones doivent emporter aussi les produits serveur |

| Non retenu | Raison | Condition pour y revenir |
|---|---|---|
| Calcul de trajectoires distant | Le client calcule plus vite que le Kimsufi ; [plan-worker.ts](../src/system/plan-worker.ts) est déjà dans un Worker | Un calcul > 10 s sur iPad qu'un précalcul statique ne couvre pas |
| Proxy/cache des rasters (ortho, relief) | Moins de débit et un point de panne de plus que les CDN des fournisseurs | Un fournisseur sans CORS ou sans CDN qu'on veut absolument |
| Fabrication de la géométrie du décor par blocs canoniques | Chantier XL, gain non démontré | SV5 mesuré et insuffisant |
| Atmosphère spatiale simulée (fronts, cellules) | Chantier de simulation, pas de service | Après SV2, comme plan météo séparé |
| État des surfaces et de la mer persistant | Pas de gameplay qui l'exige aujourd'hui | Une mission qui en dépend |
| Fusion tactique de capteurs | Le Link 16 actuel suffit entre amis | Un mode tactique qui exige le brouillard de guerre |
| Campagne persistante, IA d'autorité serveur | Projet de jeu à part entière | Décision produit explicite |
| Rendu serveur, atlas optiques Kerr | Aucun GPU serveur ; les pipelines WebGPU sont liés au device | Matériel dédié et besoin démontré |

## 3. Décisions (par défaut, à changer si tu veux)

| Question | Décision par défaut | Raison |
|---|---|---|
| Où tournent les services ? | **Un conteneur `services` séparé** dans la stack `kerr`, à côté de `rooms` (même image Bun, autre commande) | Un travail lourd ne doit pas retarder les salles ; un seul déploiement à connaître |
| Où sont stockés les produits ? | **Volume `/data/services` du Kimsufi** (SQLite pour l'index, fichiers pour les blobs), servis avec `Cache-Control: immutable` | Volumes faibles à notre échelle ; pas de nouveau fournisseur. Cloudflare R2 seulement si la sortie mesurée dépasse ~50 % du lien |
| Quelle adresse ? | `https://stream.samlepirate.org/svc/v1/…` (même hôte que les salles) | Certificat et NPM déjà en place ; base surchargeable comme `#server=` |
| Le jeu reste-t-il non commercial ? | **Oui** | EOX (CC BY-NC-SA), Open-Meteo gratuit, OpenSky : tous conditionnés au non-commercial |
| Appareil de référence pour les mesures | **iPad Pro M1** (le plus contraint), M1 Max en second | C'est là qu'un gain CPU/mémoire compte |
| Comptes joueurs ? | **Non.** Identité de session actuelle, limites par IP | Pas de besoin à notre échelle |

## 4. Architecture

```text
                 ┌──────────────────── Kimsufi (stack kerr) ────────────────────┐
 clients ──WS──▶ │ rooms   : salles, horloge, événements, relais trafic (existant)│
   │             │ services: /svc/v1/…  aéroports, météo, débriefings, tuiles     │
   │             │           index SQLite + blobs immuables sur /data/services    │
   │             └───────────────────────────────▲────────────────────────────────┘
   │                                             │ acquisitions bornées (gate global
   │                                             │ par fournisseur) : Overpass,
   │                                             │ Open-Meteo, METAR, OpenFreeMap, BD TOPO
   └──direct──▶ IGN, AWS Terrarium, EOX, swisstopo (rasters : inchangé)
```

- `services` est un nouveau point d'entrée `server/services.ts`, déployé par une image `services-…` construite par
  `rooms.yml` (même mécanique que `rooms-…`, chemins `server/` + modules partagés). `rooms` n'est pas redéployé à
  chaque changement des services.
- Les modules métier sont **importés tels quels** depuis `src/` (`airportnet`, `openmeteo`, `metar`, `replay`…),
  sans dossier « shared » dupliqué. Ce qui dépend du DOM ou du navigateur est isolé à la marge.
- Côté client, un seul petit module `src/services.ts` : base d'URL, `fetch` avec timeout court, repli, et l'état
  « service disponible » lu par l'interface et TARS.
- Le canal des salles ne transporte **que des annonces légères** (ex. `weather` : « la salle utilise la cellule X,
  run Y ») ; les données passent par HTTP.

### 4.1 Règles communes à tous les services

- **Entrées bornées et typées** : code OACI `^[A-Z0-9]{3,4}$`, cellule météo calculée par `cellOf`, tuile `z/x/y`
  dans une plage fixe. Aucune URL fournie par le client n'est jamais récupérée.
- **Un seul travail par clé** (« single flight ») : dix demandes identiques = une acquisition.
- **Gate global par fournisseur** côté serveur (le modèle de `RateGate` d'[earth-tiles.ts](../src/system/earth-tiles.ts)),
  en plus d'une limite par IP : les quotas autrefois répartis sur les IP des joueurs sont maintenant sur une seule.
- **Dates conservées** : un produit porte sa date d'acquisition et sa source ; un renouvellement raté ne le rajeunit
  pas. Une réponse vide valide et une panne restent distinguables.
- **Repli client systématique** : service absent ou lent (> 3 s) → chemin actuel, sans message d'erreur bloquant.
- **Disque borné** : budget par famille de produits, éviction LRU des produits régénérables ; les débriefings ont
  leur propre quota.
- **WGS84 partout** ([CLAUDE.md](../CLAUDE.md)) : positions géodésiques, hauteurs sur l'ellipsoïde ; données MSL
  converties à la même frontière qu'aujourd'hui (`earthHeightSampler`, `seaAltitudeOver`), jamais deux fois.

## 5. Puissance serveur

| Charge | Ordre de grandeur (estimation) | Verdict |
|---|---|---|
| Salles + relais de poses de secours | 8 appareils × 30 Hz × ~200 o ≈ 50 Ko/s par salle | Négligeable |
| TURN voix | Opus ~40 kb/s, maillage à 4 : ≈ 1 Mb/s au pire | Négligeable |
| Aéroports (SV1) | 1 requête Overpass + `buildNet` ≈ 1 s CPU par aéroport, **une fois** ; ~20–200 Ko par réseau | Négligeable |
| Météo (SV2) | ~1 acquisition par cellule et par heure de modèle, quelques Ko | Négligeable |
| Débriefings (SV3) | ≤ 5 Mo par vol décimé, quelques vols par soirée | Quelques Go par an |
| Décor préparé (SV5, si lancé) | ~1–3 s CPU par tuile nouvelle (à mesurer en SV0), centaines de tuiles par heure de vol ; 0,2–1 Mo par tuile | 2 cœurs plafonnés suffisent ; c'est le seul poste de débit notable |

**Aucun matériel à acheter.** Le seul poste qui pourrait saturer le lien est SV5 ; il est conditionné à la mesure
et R2 est l'issue prévue. SV0 relève les caractéristiques exactes du Kimsufi pour confirmer ces chiffres.

## 6. Les phases

Ordre : **SV0 → SV1 → SV2 → SV3**, puis **SV4 / SV5** selon les mesures de SV0, puis **SV6**.
Chaque phase : commit + push, `bunx biome ci .`, `bun run check && bun test`, e2e sur kerr-mini en raster, chaînes
FR + EN, unités par `unitsFor()`, une capture de preuve, une fiche dans `docs/progress/services/`.

### SV0 — Mesures et socle

**Mesures** (sans code de production) :

| Mesure | Comment | Sert à décider |
|---|---|---|
| Kimsufi : CPU, RAM, disque, débit montant | `lscpu`, `free -h`, `df -h`, test de débit (par toi : Portainer n'est pas exposé) | Plafonds de concurrence et budget disque |
| Décor sur iPad et M1 Max : temps jusqu'au décor prêt, CPU du Worker, saccades du thread principal pendant l'upload | Paris, Cévennes, Tokyo (comparables au [rapport archivé](perf/earth-scenery-world.json)), à froid puis cache PWA chaud | **Go SV5** si, sur iPad : décor prêt > 4 s à cache chaud, **ou** > 1,5 s de CPU Worker par zone, **ou** une image > 50 ms attribuable au décor |
| Overpass : latence et taux d'échec sur 20 aéroports | Script hors jeu | Justifie SV1 (attendu : oui) |
| Recherche d'éclipses sur iPad | `find_eclipses` sur 100 ans | **Go SV4** si > 1 s |
| Appels météo par session | Compteur dans `OpenMeteoFeed` / `MetarFeed` | Dimensionner le cache SV2 |

**Socle** :
- `server/services.ts` : `GET /svc/v1/health` (file, disque, versions), `GET /svc/v1/capabilities`
  (services actifs et versions de formats), limites par IP, gates par fournisseur, budget disque, journal.
- `deploy/` : image `services-…`, service dans `compose.yml`, volume `/data/services`, location `/svc/` sur NPM
  (réglage NPM : à faire par toi).
- `src/services.ts` côté client + règles PWA dans [rules.ts](../src/pwa/rules.ts) : produits immuables en
  *cache first*, météo en *network first* avec copie datée, rien d'autre de mis en cache par accident.
- Sauvegarde : `VACUUM INTO` quotidien des index SQLite (`rooms` et `services`), 7 copies gardées ; les produits
  régénérables ne sont pas sauvegardés.

**Fin** : `/svc/v1/health` répond en production ; les mesures sont consignées avec leurs décisions go / no-go.

### SV1 — Réseaux d'aéroports servis

- `GET /svc/v1/airports/:icao?lat&lon` → les éléments OSM bruts (`OsmEl[]`) de la boîte actuelle
  (`DLAT`/`DLON`), avec `{ source: "osm", fetched, version }`. Le serveur interroge Overpass une fois (gate global
  ~1 requête / 2 s, deux serveurs, retries), stocke le résultat et le sert ensuite comme produit immuable.
  Renouvellement : tous les 90 jours en tâche de fond, sans bloquer la lecture.
- Client : [airportfetch.ts](../src/game/airportfetch.ts) tente **cache local → service → Overpass → tuiles
  vectorielles** ; `buildNet` reste côté client (rapide) pour garder un seul constructeur.
- Préchauffage : script `scripts/warm-airports.ts` qui parcourt les aéroports de `assets/runways`, lentement
  (des jours s'il le faut), pour que les grands terrains soient prêts avant le premier joueur.
- Interface : la carte au sol affiche la provenance (« réseau OSM du 12/10/2026 ») ; TARS (outils de roulage
  existants) reçoit le même champ.
- e2e `airports-service` : Overpass bloqué → réseau reçu du service et roulage A320 normal ; service coupé →
  chemin actuel ; deux pages → un seul appel Overpass côté serveur.

**Fin** : aucun appel Overpass client sur un aéroport préchauffé ; repli prouvé.

### SV2 — Météo commune de la salle

- `GET /svc/v1/weather/model?cell&day&kind` : la réponse Open-Meteo (prévision, archive, marine) de la cellule
  `cellOf(lat, lon)` pour le jour demandé, mise en cache par **cellule + jour + run** ; parsée par
  `parseOpenMeteo` des deux côtés. `GET /svc/v1/weather/metar/:icao` : METAR mis en cache 5 min, date de mesure
  d'origine conservée.
- Salle : quand `realweather` est actif, tous les clients d'une salle passent par le service ; à date de salle
  égale (horloge commune existante) et lieu égal, **mêmes entrées, même météo**. L'événement léger `weather`
  annonce le run utilisé pour que tous changent d'heure de modèle au même moment.
- Rafales communes (SV2b) : les grandes rafales de [wind.ts](../src/wind.ts) tirées d'un champ déterministe
  indexé par position monde et temps de salle, au lieu de l'état propre à chaque appareil ; la turbulence fine
  reste locale. Une formation voit alors les mêmes rafales au même endroit.
- Interface : panneau météo « commune à la salle · Open-Meteo · run 06 h · il y a 40 min » ; ancien = affiché
  comme ancien. TARS `get_weather` / `weather_at` renvoient `shared`, `source`, `age`.
- e2e `net-weather` : deux pages d'une salle sur la même cellule → mêmes `ModelHour` ; fournisseur coupé → copie
  datée, pas de saut de vent ; SV2b : écart de rafale entre deux ailiers à 40 m ≈ 0.

**Fin** : deux équipages d'une salle ont la même météo macro ; l'âge est visible ; aucune acquisition par image.

### SV3 — Débriefing de salle

- En fin de vol (ou à la demande), chaque client envoie sa bande décimée (`FlightTape`, échantillons + événements
  `EV`) : `POST /svc/v1/rooms/:code/tapes`, ≤ 5 Mo, compressée, idempotente par `(device, flightId)`.
- `GET /svc/v1/rooms/:code/tapes` : liste ; une bande se télécharge à la demande. Conservation : tant que la salle
  existe, au plus 30 jours pour les sessions ; quota par salle. Pas de voix.
- Jeu : le lecteur de replay montre **tous les appareils de la salle** sur le même temps (temps de salle),
  avec les moments forts de chacun (`bestMoments`) et le réalisateur existant ; comparaison plan / volé pour
  chaque pilote.
- TARS : un outil `room_debrief` (liste des vols, moments, faits mesurés) ; il ne déduit pas de causes.
- e2e `net-debrief` : deux pages volent, deux bandes dans la salle, le replay montre les deux appareils alignés.

**Fin** : après une soirée, chacun rejoue le vol de tous depuis le menu de la salle.

### SV4 — Catalogues astronomiques précalculés (si go SV0)

- `scripts/build-eclipses.ts` : éclipses solaires et lunaires 1900–2200 vues de la Terre, avec les mêmes
  éphémérides que le jeu (DE440s), en `assets/eclipses/*.json` servis par Pages : **pas de service serveur**.
- `find_eclipses` lit le catalogue dans son domaine, calcule hors domaine comme aujourd'hui ; les circonstances
  locales (`eclipseLocal`) restent calculées par le client.
- Test unitaire : catalogue = recherche directe sur un échantillon de dates.

### SV5 — Décor préparé, pilote (si go SV0)

Uniquement la **préparation des vecteurs**, pas la géométrie :

- `GET /svc/v1/scenery/:z/:x/:y` (z14) : bâtiments (BD TOPO en France, OSM ailleurs, hauteurs résolues), routes,
  eau, ponts et masques de forêt **déjà fusionnés, découpés à la tuile, simplifiés et dédupliqués**, dans un format
  binaire compact versionné. Le Worker de décor construit toujours la géométrie, les BVH et les contacts.
- Côté serveur, seules les parties pures du Worker sont réutilisées ; le décodage d'images de
  [scenery-worker.ts](../src/system/scenery-worker.ts) (`OffscreenCanvas`, `createImageBitmap`) n'est pas porté :
  les rasters restent côté client.
- Zone pilote : Paris, Cévennes, Tokyo. Mesure A/B sur iPad contre SV0 : temps jusqu'au décor prêt, CPU Worker,
  octets, saccades.
- **Gardé** si le gain est net sur iPad (≥ 30 % sur le temps ou le CPU) ; **retiré** sinon, sans dette laissée.

### SV6 — Produits dans les zones hors ligne

- Le manifeste d'une zone ([zones.ts](../src/system/zones.ts), [pwa-zones.ts](../src/pwa-zones.ts)) inclut les
  réseaux d'aéroports de la zone (SV1) et, si SV5 est gardé, ses tuiles préparées ; estimation de taille, pause,
  reprise et suppression partagées comme pour les rasters.
- La météo n'est **pas** archivée dans une zone (elle est datée et courante).

## 7. Licences et fournisseurs

| Source | Usage serveur | Statut |
|---|---|---|
| OSM via Overpass, OpenFreeMap | Mise en cache et redistribution des dérivés | ODbL : attribution + partage à l'identique des dérivés ; respecter la politique d'usage d'Overpass (gate) |
| BD TOPO (IGN) | Dérivés SV5 | Licence Ouverte 2.0 : libre avec attribution |
| Open-Meteo | Cache commun SV2 | Gratuit en non commercial, limites **par IP** (≈ 10 000 appels/jour) : le cache par cellule doit rester très en dessous ; attribution CC BY 4.0 |
| METAR VATSIM | Cache 5 min | À confirmer avant la mise en production de SV2 |
| OpenSky (relais trafic existant) | Déjà relayé | Conditions de redistribution **à relire** (indépendant de ce plan, mais à régler) |
| EOX, IGN ortho/relief, swisstopo, Terrarium | Aucun : chargés directement par le client | Inchangé |

## 8. Risques

| Risque | Réponse |
|---|---|
| Le service tombe pendant une soirée | Repli client sur le chemin actuel dans chaque phase ; `/health` lu par le panneau réseau |
| Quotas fournisseur concentrés sur l'IP du serveur | Gate global, single flight, cache long (aéroports) ou par run (météo) |
| Disque plein sur le Kimsufi | Budgets par famille, éviction LRU, alerte dans `/health` |
| Deux joueurs avec des versions différentes d'un produit | Version dans chaque produit ; le client lit N et N−1 ; la salle annonce la version météo utilisée |
| SV5 qui grossit en chantier XL | Périmètre figé aux vecteurs ; critère de retrait chiffré |
| Débriefings privés exposés | Accès par code de salle (déjà le secret d'une salle) ; suppression avec la salle |

## 9. Fichiers touchés (prévision)

| Zone | Changement |
|---|---|
| `server/services.ts` (nouveau), `server/main.ts` | Point d'entrée des services ; `rooms` inchangé hormis l'annonce `weather` |
| `deploy/compose.yml`, `deploy/render-compose.sh`, `.github/workflows/rooms.yml` | Image et conteneur `services` |
| `src/services.ts` (nouveau), `src/pwa/rules.ts`, `src/sw.ts` | Client des services, règles de cache |
| `src/game/airportfetch.ts` | SV1 |
| `src/openmeteo.ts`, `src/metar.ts`, `src/realweather.ts`, `src/wind.ts` | SV2 |
| `src/game/replay.ts` et son lecteur, `src/net/*` | SV3 |
| `src/eclipse/*`, `scripts/build-eclipses.ts` | SV4 |
| `src/system/scenery-*.ts` | SV5 |
| `src/system/zones.ts`, `src/pwa-zones.ts` | SV6 |
| `src/ai/game-tools.ts` | Provenance et âge (SV1, SV2), `room_debrief` (SV3) |
| `docs/DEPLOY.md`, `docs/BH-API.md`, `docs/NETWORK.md` | Documentation des routes et du déploiement |
