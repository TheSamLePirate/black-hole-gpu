# Audit 2026-11-10 — 08. Tests, CI, build, PWA et hygiène

Périmètre : tests unitaires et e2e, CI, build, déploiement (Pages, serveur), PWA (cycle de vie), hygiène du dépôt,
sécurité web, outillage de mesure, dépendances et licences. Lecture seule. État lu : `main` à `29d4e5e3`, copie de
travail avec 12 fichiers modifiés par une autre session (zones hors ligne) et 54 non suivis.

Niveaux de preuve : **lu** (code ou config, fichier:ligne), **mesuré** (commande citée, lancée le 10 nov. sur ce Mac),
**supposé** (à confirmer). Rien n'a été lancé hors `gh run …`, `bun scripts/check-repo-size.ts`,
`bun scripts/pipeline-inventory.ts --check`, `bun scripts/bh-api.ts --check`, grep/wc/du/git.

Chiffres de cadrage (mesurés) :

| Élément | Valeur | Source |
|---|---|---|
| Code `src/` | 285 840 lignes TS (790 fichiers) + 24 108 lignes WGSL | `find … \| wc -l` |
| Tests unitaires | 398 fichiers, ≈ 1 949 `test(`, 44 525 lignes | `ls tests/*.test.ts`, grep |
| E2E | 397 fichiers suivis (+ 34 `zz-*` non suivis), ≈ 732 `test(`, 51 983 lignes avec `lib/` | idem |
| `skip` / `todo` / `only` | 0 ; `test.skipIf` : 4 (unitaires), tous les e2e sous `skipIf(!E2E)` | grep |
| CI, 200 derniers runs Pages sur `main` (4–8 nov.) | 63 réussis (31,5 %), 72 échecs, 65 annulés ; plus longue série rouge : 36 | `gh run list --limit 200 --json …` |
| Durée d'un run vert | 12–15 min (run 42519028059 : 13 min 41) | `gh run list` |
| Binaires suivis | 591,6 Mo sur 600 Mo de budget | `bun scripts/check-repo-size.ts` |
| Site Pages | 881 Mo (docs/DEPLOY.md:42, 6 nov.) pour un plafond CI de 900 Mo | lu |
| Bundle principal (`_site` local du 6 nov., d11f0171) | `index-*.js` 7,42 Mo (2,42 Mo gzip), CSS 0,42 Mo, précache 17 fichiers = 10,0 Mo | `ls -la _site`, `gzip -c \| wc -c` |
| `.git` | 1,0 Go (packs 790 Mo), LFS local 258 Mo, 464 objets LFS = 231,8 Mo | `du`, `git count-objects -vH` |

---

## 1. Constats

### 1.1 CI et déploiement

**QA-01 — P1 — La CI de `main` est rouge deux fois sur trois ; rien n'empêche de pousser du code non vérifié**
- Où : `.github/workflows/pages.yml:170-184` ; `.git/hooks/pre-push` (seul `git lfs pre-push`).
- Constat : sur 200 runs (4–8 nov.), 31,5 % de succès. Série de 36 échecs consécutifs. Trois échecs sondés
  (42197816085, 42173454119, 42155915906) : même étape « Verify and build the exact main revision », même erreur de
  format Biome (`Found 1 error`, ligne `not a date: ${a.from}`) restée de 03:20 à 09:48 UTC le 6 nov. pendant que les
  pushes continuaient. Aucun hook local ne lance `biome ci`, `tsc` ni les tests.
- Impact : la production ne reçoit rien pendant des heures (le garde tient, c'est bien), mais chaque commit de la
  série n'a jamais été testé isolément ; une régression réelle est masquée par le rouge permanent. 65 runs annulés =
  minutes de runner perdues.
- Piste : hook `pre-push` versionné (`core.hooksPath`) lançant `bunx biome ci . && tsc --noEmit` (≈ 20 s) ; règle
  « pas de push sur rouge » ; étape Biome placée avant le typecheck avec message clair.
- Preuve : mesuré (`gh run list`, `gh run view --log-failed`).

**QA-02 — P1 — Aucun e2e en CI ; les e2e ne testent jamais l'artefact déployé**
- Où : `pages.yml:66-80` (typecheck, Biome, taille, WGSL, forêt, `bun test`, build) ; `tests/e2e/lib/app.ts:65-67`
  (lance `bun server.ts` en `NODE_ENV=production`).
- Constat : les 397 e2e sont tous sous `describe.skipIf(!E2E)` ; la CI ne les lance pas. En local, ils tournent contre
  `server.ts` (bundling par route, `precache.json` vide `server.ts:194`, SW sans `__DIRS__`), pas contre `_site/`
  produit par `scripts/build-pages.ts`. Seul `scripts/ipad.ts:27` vise le site publié, à la main.
- Impact : chemins relatifs, précache, portée du SW, relinkage Perl des previews (`pages.yml:397-411`), image nginx :
  tout cela atteint la production sans aucun test navigateur. Un écran noir au démarrage passerait la CI.
- Piste : un e2e de fumée (démarrage + première image + `cdp.errors` vide, SwiftShader) sur `_site/` servi en
  statique, dans le job `main`, ≤ 2 min ; un mode `E2E_SITE=_site` dans `App.boot`.
- Preuve : lu.

**QA-03 — P1 — Deux budgets de taille à moins de 3 % de la panne**
- Où : `scripts/check-repo-size.ts:18-19` ; `pages.yml:415-436` ; docs/DEPLOY.md:42.
- Constat : 591,6 Mo de binaires suivis pour un échec à 600 Mo (marge 8,4 Mo, soit un seul fichier au plafond de 8 Mo).
  Le site assemblé faisait 881 Mo le 6 nov. ; au-delà de 900 Mo avec `/ineptie/`, le job `site` sort en erreur
  (`pages.yml:417-420`) : plus aucun déploiement, y compris de `main`.
- Impact : le prochain lot d'assets bloque la CI ou le déploiement. Le budget « se relève dans le fichier » : il n'y a
  pas de plan au-delà (Pages plafonne à 1 Go).
- Piste : exécuter la sortie prévue en docs/ASSETS.md §« Later: a bucket » (packs adressés par contenu hors Pages) avant
  le prochain lot ; à défaut retirer `/ineptie/` ou `/test/` du site.
- Preuve : mesuré (script) + lu.

**QA-04 — P2 — Une branche de preview bloque la production ; les previews partagent l'origine de la production**
- Où : `pages.yml:349` (`needs.ineptie.outputs.ok == 'yes'` exigé) ; `pages.yml:18` ; `src/ai/openrouter.ts:16`,
  `src/ai/deepgram.ts:9`.
- Constat : si `Ineptie-Version` échoue à sa vérification, `site` ne tourne pas : `main` n'est pas déployé (ni Pages
  ni serveur, `server` dépend de `site`). Par ailleurs `/test/` et `/ineptie/` sont servis sur la même origine
  `thesamlepirate.github.io` que la racine : leur code lit tout le `localStorage` de l'origine, dont
  `kerr.openrouter.key` et `kerr.deepgram.key` (le préfixe de sous-chemin sépare les clés, pas l'accès).
- Impact : disponibilité (une branche annexe gèle la prod) ; confidentialité des clés des joueurs sur Pages.
  samlepirate.org n'est pas concerné (previews retirées de l'image, `pages.yml:515-516`).
- Piste : rendre `ineptie` non bloquant comme `preview` ; publier les previews sur une autre origine (autre dépôt
  Pages) ou ne jamais stocker de clé sur l'origine Pages.
- Preuve : lu.

**QA-05 — P2 — Bun non figé en CI : trois versions pour un même code**
- Où : `pages.yml:60,164,232,303` (`oven-sh/setup-bun@v2` sans version) ; `rooms.yml:583` (1.3.14) ;
  `deploy/Dockerfile.rooms:4` (`oven/bun:1.3-alpine`) ; `package.json` (`"@types/bun": "latest"`, pas de
  `packageManager`).
- Constat : le run 42519028059 a téléchargé Bun 1.4.4 ; ce Mac a 1.3.14 ; le serveur de salons tourne en 1.3.x.
  Le bundle de production est donc construit par un bundler que personne n'utilise en local.
- Impact : régression de bundler ou de `bun test` invisible en local ; build non reproductible.
- Piste : `.bun-version` lu par `setup-bun`, même version dans le Dockerfile ; `@types/bun` figé (le lock le tient à
  1.4.2 mais `latest` saute à la prochaine régénération). Actions épinglées par SHA.
- Preuve : mesuré (log du run) + lu.

**QA-06 — P2 — Pas de retour arrière pour Pages ; celui du serveur est manuel**
- Où : docs/DEPLOY.md:128-131 ; `pages.yml:86-130` (`snapshot` lit les têtes de branches).
- Constat : relancer un ancien run reconstruit la tête actuelle, pas l'ancien commit. Pages n'a donc que
  `git revert` + 13 min de CI. Le serveur a un vrai retour (commit sur `deploy` vers un ancien tag GHCR), manuel,
  jamais répété en test (supposé).
- Piste : `workflow_dispatch` avec un `sha` en entrée (le cache `site-main-<sha>` existe déjà, `pages.yml:141-144`).
- Preuve : lu.

**QA-07 — P2 — Le serveur de salons se déploie depuis une branche secondaire avec trois fichiers de tests**
- Où : `rooms.yml:555` (`branches: [main, reseau]`), `rooms.yml:585`.
- Constat : un push sur `reseau` remplace l'image de production de stream.samlepirate.org. Vérification : 3 fichiers
  (`net-core`, `net-rooms`, `lola-tiles`), ni typecheck ni Biome. `server/traffic.ts` (relais à clés) n'a aucun test
  dans ce job.
- Piste : `main` seul ; ajouter `tsc` et les tests `traffic*`.
- Preuve : lu.

### 1.2 Tests

**QA-08 — P2 — Des e2e qui ne vérifient rien**
- Constat (mesuré par grep sur `tests/e2e/*.e2e.test.ts`, hors `zz-*`) :
  - 19 fichiers sans aucun `expect(` (dont `flight-quality`, `perf-fps`, `perf-suite`, `perf-ab`, `planets-ab`,
    `eclipse-raster`, `moon-telescope`, `kernel-compile`, `compile-time`) ; 65 autres avec un seul.
  - 96 `waitFor(…).catch(() => …)` dans 73 fichiers : le délai expire, le test continue et passe
    (ex. `tests/e2e/flight-quality.e2e.test.ts:83`, 180 s avalées).
  - Membres inexistants, confirmés dans le code : `c.last?.alt` dans 8 fichiers suivis
    (`flight-quality:82`, `raster-motion:101`, `raster-flight:237`, `runway-mesh:66`, `cloud-occlusion:47`,
    `raster-paths:27`, `rain-glass:37`, `raster-shade-ablation:87`) — aucun `last` sur le contrôleur ;
    `airInfo().agl` (`cockpit-flight:60,82`) — champ absent de `src/controller/computer.ts:1218-1280` ;
    `__bh.sys.sunElevation?.(` (`coast-survey:101`) — aucun `sunElevation` dans `src/`.
  - Recherche d'autres cas : tous les identifiants en chaînage optionnel des e2e ont été comparés aux mots de `src/`.
    Seul `sunElevation` manque (et `groundHitAt` dans une sonde `zz-`). Limite : cette méthode ne voit pas un nom qui
    existe ailleurs mais pas sur cet objet (cas de `last`, `agl`).
- Impact : faux verts ; l'étape « jusqu'à 3 km » de `cockpit-flight` attend 200 s pour rien.
- Piste : corriger les 11 lignes (`c.jetFigures()?.h`) ; `waitFor` qui échoue par défaut, variante `waitMaybe`
  explicite ; règle de lint maison : un fichier e2e sans `expect` est une sonde et va dans `scripts/`.
- Preuve : lu + mesuré. Déjà noté dans docs/E2E-VOLS.md:516-530 et docs/PROBLEMES-A-REGLER.md:23-27, non corrigé.

**QA-09 — P2 — Attentes fixes et délais géants**
- Constat (mesuré) : 1 121 attentes fixes `sleep(n)`/`wait(n)` (2 249 s cumulées ; 82 ≥ 5 s ; 29 ≥ 10 s). Pires :
  `boot-debug:22` (60 s), `jetmodes:72` (30 s), `sea-depth-probe:16` (30 s), `world-runway:35`, `hud-runway:47`,
  `a320-services:55` (21 s). 124 attentes conditionnelles > 120 s (`net-formation:78` 900 s ; neuf à 600 s dont
  `kernel-golden:63`, `raster-paths:36`). 584 délais de test > 120 s ; 140 ≥ 600 s ; 24 ≥ 1 800 s
  (`tars-eval:194` 5 000 s ; `planets-ab:71`, `disc-cost:85`, `lowflight-governor:365` 3 600 s).
- Impact : un test bloqué coûte jusqu'à une heure en silence ; contraire à la consigne de Sam (30–60 s, échec parlant).
- Piste : plafond par défaut dans `App.waitFor`, dérogation nommée ; remplacer les sleeps ≥ 5 s par des conditions.
- Preuve : mesuré (grep).

**QA-10 — P2 — Pyramide : les gros fichiers d'orchestration n'ont pas de test direct**
- Constat (mesuré : imports directs et transitifs des 398 tests unitaires) :

| Dossier | Lignes | Importées directement par un test | Atteintes par transitivité |
|---|---|---|---|
| `src/ui` | 61 258 | 39 % | 61 % |
| racine `src/*.ts` | 50 338 | 61 % | 74 % |
| `src/system` | 36 509 | 86 % | 95 % |
| `src/controller` | 30 957 | 27 % | 100 % |
| `src/a320` | 28 160 | 32 % | 100 % |
| `src/game` | 21 625 | 93 % | 100 % |
| `src/crew` | 10 683 | 19 % | 28 % |
| `src/intro` | 774 | 11 % | 11 % |
| `src/net`, `src/ai` | 4 406 / 6 977 | 91 % / 93 % | 99 % / 93 % |
| Total | 285 840 | 55 % | 83 % |

  Jamais importés, même indirectement : `src/main.ts` (10 116 lignes, 0 export), `src/crew/main.ts` (2 321),
  `src/ui/netsession.ts` (2 157), `src/system/scenery-worker.ts` (1 771), `src/ui/fc/computer.ts` (1 232),
  `src/ui/panel.ts` (1 190), `src/ui/netmatch.ts` (1 165), `src/ui/tars-panel.ts` (1 132), `src/ui/netpanel.ts`
  (1 055). `src/renderer.ts` (11 504 lignes) n'est importé que par 2 tests (`halfToFloat`, `interleaveOrder`, un
  `Renderer` factice) ; `src/system/earth-tiles.ts` par 11.
- Impact : la couche qui assemble (boucle de frame, câblage UI, session réseau) n'est couverte que par des e2e
  absents de la CI (QA-02). « Importé » ne veut pas dire « testé » : ces pourcentages sont des plafonds.
- Piste : pas de course à la couverture ; extraire de `main.ts`/`renderer.ts` les décisions pures (ordre des passes,
  gouverneur, transitions) à mesure des lots J0/J1 et les tester là.
- Preuve : mesuré (script d'analyse d'imports, non conservé).

**QA-11 — P3 — Catalogue et durées incomplets ; sondes suivies**
- Constat : 125 des 397 fichiers e2e sont absents de docs/E2E-CATALOGUE.md (qui dit « Every e2e file ») ;
  `tests/e2e/durations.json` connaît 149 fichiers (201 min cumulées, 8 > 300 s) ; l'en-tête de `scripts/e2e.ts:3`
  annonce « every e2e, here (~20 min) », faux. 5 sondes suivies sans assertion (`boot-debug`, `lightning-probe`,
  `probe-coarse`, `sea-depth-probe`, `wake-probe`).
- Preuve : mesuré.

### 1.3 Mesure de performance

**QA-12 — P1 — Aucune régression de performance n'est détectée automatiquement**
- Où : `pages.yml` (aucune étape de mesure) ; `tests/kernel-budget.test.ts` + `tests/kernel-budget.json` ;
  docs/GRAPHICS-PIPELINE.md:480-483 ; `docs/perf/`.
- Constat : les outils existent (`scripts/bench.ts`, `trace-ab.ts`, `ab-commit.ts`, scènes de référence du Kerr
  Bench) mais tout est manuel. En CI, le seul garde lié au coût est la taille des noyaux WGSL (indirect). Deux
  fichiers e2e seulement affirment un seuil de cadence. Les e2e `perf-fps`, `perf-suite`, `perf-ab` n'ont aucun
  `expect`. Dernier rapport ajouté dans `docs/perf/` : 28 oct. (`git log -1 -- docs/perf`). Sur Apple, les
  horodatages des passes de rendu se chevauchent : seules les passes de calcul s'attribuent, le reste par A/B.
- Impact : la destination est 60 images/s par paliers, sans courbe suivie ni alarme. 400 commits depuis le 1er nov.
  sans point de mesure commun.
- Piste : un job planifié sur kerr-mini (pas sur le runner GitHub, sans GPU) : `bench.ts --quick` (≈ 2 min) sur une
  vue figée, résultat versionné (`docs/perf/history.jsonl`), échec au-delà d'un seuil nommé ; le tableau de bord
  l'affiche.
- Preuve : lu + mesuré (grep, git log).

### 1.4 Build

**QA-13 — P2 — Deux définitions du build ; celle de `package.json` est incomplète**
- Où : `package.json` script `build` (une ligne de ≈ 1 500 caractères) ; `scripts/build-pages.ts:10-80` ;
  `src/renderer.ts:4840`, `src/intro/intro.ts:140`, README.md:24.
- Constat : `bun run build` ne produit ni `mirage-worker.js`, ni `intro-worker.js`, ni `net.js`, ni `runways/`,
  ni `precache.json`, ni `version.json`, ni `openrouter.html`, et ne définit ni `__DIRS__` ni `__KERR_SUBPATH__`.
  `server.ts` porte une troisième liste (14 routes `Bun.build` copiées-collées, `server.ts:76-146`).
- Impact : `dist/` donne des 404 sur trois modules ; chaque nouveau worker doit être ajouté à trois endroits.
- Piste : une table unique des points d'entrée (un module TS) lue par `build-pages.ts`, `server.ts` et le script
  `build` ; ou supprimer `build`.
- Preuve : lu.

**QA-14 — P2 — Workers non hachés : page et workers de builds différents pendant un déploiement**
- Où : `scripts/build-pages.ts:14-29` (noms fixes) ; `src/pwa/rules.ts:43` (non haché → `shell`, réseau d'abord) ;
  `src/sw.ts:504-508` (`fetch(request)` avec le cache HTTP) ; `deploy/nginx.conf` (`no-cache`, correct).
- Constat : sur nginx, c'est tenu. Sur GitHub Pages (en-tête `max-age=600` imposé), `index.html` et les 11 workers
  peuvent être servis par le cache HTTP jusqu'à 10 min, indépendamment les uns des autres.
- Impact : bundle neuf + `scenery-worker.js` ancien (ou l'inverse) → messages incompatibles, erreurs rares et non
  reproductibles après un déploiement.
- Piste : hacher les workers (URL injectée par `--define`) ou `?v=<sha>` ; `cache: "no-cache"` dans `networkFirst`.
- Preuve : lu ; l'en-tête de Pages est supposé (non mesuré ici).

**QA-15 — P3 — Bundle monolithique, WGSL non allégé, pas de source maps**
- Constat : un seul `index-*.js` de 7,42 Mo (seul `net.js` est chargé à la demande) ; 1,30 Mo de WGSL dans `src/`,
  dont 0,49 Mo de lignes de commentaire, embarqués tels quels ; aucun `.map` dans `_site/` ; `tsconfig.json`
  n'inclut de `scripts/` que `dashboard`, `e2e.ts`, `bh-api.ts` : `build-pages.ts`, `check-wgsl.ts`, `remote.ts`
  ne sont pas typés en CI.
- Impact : coût d'analyse au démarrage (A320, F-35, crew chargés pour tous), traces de production illisibles.
- Preuve : mesuré (`ls -la _site`, `wc -c`).

### 1.5 PWA

**QA-16 — P2 — Mise à jour du SW : le bouton n'existe pas, le message est trompeur**
- Où : `src/pwa.ts:143-146,167` ; `src/sw.ts:212`.
- Constat : le nouveau worker attend un message `skip-waiting`. Seul `pwa.update()` l'envoie, et aucun code d'interface
  ne l'appelle (grep : aucun appelant hors `src/pwa.ts`). Le toast dit « reload the page to run it » ; or un
  rechargement d'un onglet unique n'active pas un worker en attente (supposé, comportement standard).
- Impact : nouvelle page (réseau d'abord) pilotée par l'ancien SW tant que tous les onglets ne sont pas fermés :
  règles de cache et protocole des zones (`zone-fetch`) en décalage de version.
- Piste : toast avec action « Recharger » → `pwa.update()` ; e2e de mise à jour entre deux builds.
- Preuve : lu ; l'activation est supposée, à confirmer par e2e.

**QA-17 — P3 — Manifeste et iPad**
- Constat : `pwa/manifest.webmanifest` sans `id`, sans `screenshots`, `lang: "en"` seul, `orientation: landscape`.
  docs/IPAD-TESTS.md:123-133 : derniers essais iPad les 4–5 oct. (2 pages perdues sur 5, un `device lost`),
  contre le site publié uniquement ; rien depuis ≈ 1 700 commits. `navigator.storage.persist()` n'est demandé
  qu'à la première zone (`src/pwa-zones.ts:160`).
- Preuve : lu.

### 1.6 Sécurité web

**QA-18 — P2 — Aucun en-tête de sécurité ; clés des joueurs en `localStorage`**
- Où : `deploy/nginx.conf` (ni CSP, ni `X-Content-Type-Options`, ni `Referrer-Policy`, ni `frame-ancestors`) ;
  `index.html` (aucune balise CSP, deux scripts en ligne l. 8 et 29) ; `src/ai/openrouter.ts:16,42`,
  `src/ai/deepgram.ts:9,20`.
- Constat : les clés OpenRouter et Deepgram du joueur sont en clair dans `localStorage`. Sans CSP, toute injection
  de script les exfiltre. Pas de `eval`/`new Function` dans `src/` (grep : 0).
- Piste : CSP stricte côté nginx (`script-src 'self'` + hachage des deux scripts en ligne, `connect-src` listé) ;
  balise `<meta>` pour Pages.
- Preuve : lu.

**QA-19 — P3 — `innerHTML` : 80 usages, risque faible, deux à durcir**
- Constat : 80 occurrences dans `src/` (69 dans `src/ui`, 1 dans `src/crew`, 0 dans `src/net`). La plupart
  interpolent des constantes, des nombres ou des traductions. Chat et pseudos réseau passent par `textContent`
  (`src/ui/netask.ts:17`). Sans échappement : `src/ui/fc/computer.ts:566,687` (`s.name`, `d.name` des sites) et
  `src/ui/weather-map.ts:196-197` (`st.name`). L'origine de ces noms (table du jeu ou données externes/partagées)
  n'a pas été remontée jusqu'au bout.
- Preuve : lu ; origine des noms supposée interne, à confirmer.

**QA-20 — P2 — Serveur de dev : relais à clé ouvert sur le réseau local**
- Où : `server.ts:58-59` (pas de `hostname` : écoute sur toutes les interfaces), `server.ts:23,32-33,227-228`,
  `server.ts:66-73`.
- Constat : en dev, `/__deepgram` relaie vers Deepgram avec la clé de `.env`. Le contrôle d'origine ne s'applique que
  si l'en-tête `Origin` est présent : un client non navigateur du LAN ou de Tailscale l'utilise librement.
  `/__snapshot` accepte un POST sans contrôle d'origine (écriture bornée à `snapshots/`, nom filtré : pas de
  traversée). Les routes `/docs/*`, `/runways/*`, `/earth-surface/*`, `/icons/:file` sont filtrées par motif : pas de
  traversée vue.
- Piste : `hostname: "127.0.0.1"` par défaut, ouverture explicite pour le labo ; exiger `Origin`.
- Preuve : lu.

**QA-21 — P2 — Limite de débit du relais de trafic indexée sur l'IP du proxy**
- Où : `server/main.ts:35` (`srv.requestIP(req)`), `server/traffic.ts:562,566` ; docs/DEPLOY.md:60-62 (Nginx Proxy
  Manager devant).
- Constat : aucun `X-Forwarded-For` lu (grep : 0). Derrière le proxy, tous les joueurs partagent une seule adresse.
- Impact : la limite est globale ; un seul client peut priver les autres de `/traffic/plane` et `/trace`. CORS `*`
  sur ce relais à clés (voulu, noté).
- Preuve : lu ; topologie réseau supposée d'après la doc.

### 1.7 Licences

**QA-22 — P1 — Code et modèle GPL v2 (A320 FlightGear) publiés sans crédit ni licence de dépôt**
- Où : `src/a320/fdm-data.ts:1,7` (« GENERATED … from FlightGear's A320-family (GPL v2) ») ;
  `src/a320/systems/index.ts:4` (« its Nasal ported ») ; `assets/a320/LICENSE` (GPL v2) ; `CREDITS.md` et
  `src/ui/title/credits.ts` : 0 occurrence de « A320 », « FlightGear » ou « GPL » (grep -c) ; aucun `LICENSE` ni
  `NOTICE` à la racine ; dépôt public (`gh repo view` : `PUBLIC`, `licenseInfo: null`).
- Constat : 28 160 lignes de `src/a320`, dont des données générées et du code porté sous GPL v2, sont liées dans le
  même bundle que le reste et distribuées sur deux sites publics. L'écran des crédits ne les cite pas, alors que
  docs/PLAN-A320.md:43-53 le prévoyait.
- Impact : obligation GPL (mention, texte de licence, offre des sources ; l'ensemble lié est vraisemblablement une
  œuvre dérivée, donc à publier sous licence compatible) non remplie de façon visible. À faire valider par
  quelqu'un de compétent : je ne tranche pas le droit.
- Piste : entrée A320 dans `credits.ts` (le test `title-credits` la vérifiera) ; `LICENSE` à la racine ; décision
  explicite de Sam sur la licence du dépôt.
- Preuve : lu + mesuré (grep).

**QA-23 — P2 — Autres licences à clarifier**
- Constat : `CREDITS.md:36` Sentinel-2 cloudless (EOX) en CC BY-NC-SA 4.0 (non commercial, partage à l'identique) ;
  `CREDITS.md:17` astronaute sous « CGTrader licence », dont les fichiers sont dans un dépôt public (LFS) ;
  `CREDITS.md:19` porte-avions, avions de ligne et navires « under their authors' licences », sans les nommer.
- Impact : redistribution publique des fichiers peut-être non permise (CGTrader) ; usage commercial futur fermé (EOX).
- Preuve : lu ; portée juridique non évaluée.

### 1.8 Hygiène du dépôt

**QA-24 — P1 — La référence stratégique n'est pas dans Git**
- Où : `git ls-files docs/ANALYSE-STRATEGIE-RENDU-2026-11-03.md` → vide ; `CLAUDE.md:10` et `docs/README.md:19,102`
  la désignent comme lecture obligatoire. Non suivis aussi : `docs/ANALYSE-STREAMING-2026-11-06.md`,
  `docs/REFONTE-WEBGPU-2026-11-03.html`, `docs/STRATEGIE-WEBGPU-AAA-LIBRAIRIES-2026-11-03.html`.
  (`CLAUDE.md`, `progress-to-destination.md`, `AGENTS.md` sont suivis.)
- Impact : un clone, un worktree (19 existent), kerr-mini ou kerr-pc n'ont pas le document que chaque session doit
  lire ; il n'a ni historique ni sauvegarde. Lien mort sur GitHub.
- Piste : le commiter (décision de Sam s'il doit rester privé : alors le dire dans CLAUDE.md).
- Preuve : mesuré.

**QA-25 — P2 — Fichiers jetables à la racine et sondes non suivies, non ignorés**
- Constat (mesuré, `git status --porcelain`, `du`) : 30 Mo à la racine — `.jsonl` et `session.jsonl` (6,5 Mo chacun,
  transcriptions de sessions), `pi-session-…html` (9 Mo), `crash*.png/jpg`, `falling.*`, `hit-smoke.*`,
  `replay-crash.*` ; 34 `tests/e2e/zz-*` et 2 `scripts/zz-*`. Aucun motif `.gitignore` ne les couvre : un
  `git add -A` les publierait dans un dépôt public (les transcriptions peuvent contenir des données privées ; aucun
  motif de clé trouvé par grep). Les `zz-*.e2e.test.ts` sont ramassés par `bun run e2e` sans nom.
- Autres : `remote-results/` 5,1 Go, `_site/` 606 Mo, `snapshots/` 125 Mo (ignorés) ; 19 worktrees dont 7 détachés
  dans `/private/tmp` ; un objet Git résiduel (`.git/objects/9f/tmp_obj_mwoS3d`) ; `todo.md` et
  `ANALYSE-INTEGRATION.md` (2 oct.) à la racine. `docs/video/wormhole_journey.mp4` : non vu comme modifié ici.
- Piste : ignorer `/*.jsonl`, `/pi-session-*`, `/*.png`, `/*.jpg`, `zz-*` ; exclure `zz-` de `scripts/e2e.ts` ;
  `git worktree prune` et ménage de `remote-results/`.
- Preuve : mesuré.

**QA-26 — P3 — Divers**
- `scripts/check-wgsl.ts:93-96` sort en 0 sans adaptateur WebGPU : si le Chrome du runner perd SwiftShader, la CI
  cesse de vérifier les shaders sans le dire (le run 42519028059 les compile bien : vérifié dans son log).
- Les jobs `preview` et `ineptie` revérifient et reconstruisent leurs branches à chaque push de `main` (6 et 8 min de
  runner) : seul le build de `main` est mis en cache par sha.
- `bun scripts/bh-api.ts --check` démarre un serveur et un Chrome (≈ 10 s) : ce n'est pas un contrôle statique,
  contrairement à `pipeline-inventory.ts --check`. Il n'est pas en CI.

---

## 2. Récapitulatif

| Id | Gravité | Sujet | Preuve |
|---|---|---|---|
| QA-01 | P1 | CI de `main` verte à 31,5 %, série de 36 rouges, pas de hook avant push | mesuré |
| QA-02 | P1 | Aucun e2e en CI ; l'artefact `_site` n'est jamais testé dans un navigateur | lu |
| QA-03 | P1 | Binaires 591,6/600 Mo ; site 881/900 Mo : blocage imminent | mesuré + lu |
| QA-12 | P1 | Pas de détection automatique de régression de performance | lu + mesuré |
| QA-22 | P1 | A320 GPL v2 distribué sans crédit ; pas de LICENSE ; dépôt public | lu + mesuré |
| QA-24 | P1 | La référence stratégique n'est pas suivie par Git | mesuré |
| QA-04 | P2 | Preview `ineptie` bloquante ; previews sur l'origine de la prod (clés lisibles) | lu |
| QA-05 | P2 | Bun non figé (CI 1.4.4, local 1.3.14, salons 1.3.x) | mesuré |
| QA-06 | P2 | Pas de retour arrière Pages | lu |
| QA-07 | P2 | Salons déployés depuis `reseau`, 3 fichiers de tests | lu |
| QA-08 | P2 | E2E sans assertion, attentes avalées, membres inexistants | mesuré |
| QA-09 | P2 | 1 121 attentes fixes ; 140 délais ≥ 600 s | mesuré |
| QA-10 | P2 | `main.ts`, `renderer.ts`, UI réseau, crew sans test direct | mesuré |
| QA-13 | P2 | Script `build` incomplet ; trois listes de workers | lu |
| QA-14 | P2 | Workers non hachés, décalage possible sur Pages | lu + supposé |
| QA-16 | P2 | Mise à jour du SW sans bouton ; page et SW de versions différentes | lu + supposé |
| QA-18 | P2 | Pas de CSP ; clés en `localStorage` | lu |
| QA-20 | P2 | Serveur de dev : relais Deepgram ouvert au LAN | lu |
| QA-21 | P2 | Limite de débit trafic sur l'IP du proxy | lu + supposé |
| QA-23 | P2 | Licences EOX (NC-SA), CGTrader, modèles « fournis » | lu |
| QA-25 | P2 | 30 Mo de fichiers jetables et 36 sondes non ignorés | mesuré |
| QA-11 | P3 | Catalogue e2e (125 absents), durées (149/397) | mesuré |
| QA-15 | P3 | Bundle 7,42 Mo d'un bloc, WGSL commenté, pas de source maps | mesuré |
| QA-17 | P3 | Manifeste minimal ; iPad non retesté depuis le 5 oct. | lu |
| QA-19 | P3 | `innerHTML` : 3 sites sans échappement | lu |
| QA-26 | P3 | `check-wgsl` muet sans adaptateur ; previews rebâties à chaque push | lu |

## 3. Ce qui est solide

- Le garde de déploiement tient : pendant 36 runs rouges, rien de cassé n'a été publié (`pages.yml:349`).
- La CI vérifie beaucoup pour un projet sans e2e : typecheck strict (`noUncheckedIndexedAccess`), Biome, compilation
  réelle des WGSL par Chrome/SwiftShader, traceur des forêts, ≈ 1 950 tests, build complet, taille des binaires.
- Permissions des workflows minimales (`permissions: {}` puis par job), `persist-credentials: false`, images
  taguées par sha et run, branche `deploy` écrite sous verrou de concurrence.
- Aucun secret suivi (`.env` ignoré, grep de motifs de clés : 0) ; les clés serveur ne vont jamais dans une page.
- Serveur de salons : origines filtrées (`server/rooms.ts:94-100,422-423`), tailles de message bornées, TURN à
  secret partagé et quotas.
- SW : caches par portée et par build, purge limitée à sa propre application, précache tolérant aux manques,
  budget de tuiles avec éviction ; règles pures testées (`tests/pwa-rules.test.ts`).
- Zéro `test.only`/`skip`/`todo` ; `bun.lock` présent, `--frozen-lockfile` en CI ; 3 dépendances d'exécution figées.
- Outillage de labo réel : télémétrie par test, tableau de bord, exécution à distance, A/B alternés ;
  docs/E2E-VOLS.md fondé sur 4 034 lancements (68 % de réussite, 83 % début novembre).
- `pipeline-inventory.ts --check` et `bh-api.ts --check` passent (60 libellés ; 194 membres documentés).

## 4. Non vérifié

- Aucun test, e2e, build ni benchmark lancé : les taux de réussite e2e viennent de docs/E2E-VOLS.md, pas d'un run.
- En-têtes réels de GitHub Pages et de samlepirate.org (pas de requête réseau) ; comportement réel de la mise à
  jour du SW ; topologie du proxy devant le serveur de salons.
- Taille actuelle du site (881 Mo lu dans la doc du 6 nov.) ; `_site/` local date de `d11f0171`, pas de HEAD.
- Portée juridique des licences (GPL, CC BY-NC-SA, CGTrader) : constat de fait seulement.
- Origine exacte des noms injectés par `innerHTML` (QA-19) ; contenu des `.jsonl` au-delà d'un grep de clés.
- Portainer, GHCR (visibilité, rétention des tags), réglages de l'environnement `github-pages`.
- Couverture réelle par ligne (aucun `--coverage` lancé) : seuls les imports ont été comptés.
- Workflows des branches `test-kimi`, `Ineptie-Version`, `reseau` (lus sur `main` seulement).
- `docs/video/wormhole_journey.mp4` signalé modifié dans la consigne : non observé dans `git status` ici.
