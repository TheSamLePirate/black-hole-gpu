# Fiche J2 — les pointes du fil principal autour des tuiles (12 novembre 2026)

[PLAN-J2](../../PLAN-J2-PAGES-RECONSTRUCTION.md), le critère de J2-1 « **aucune pointe du fil principal > 2 ms due aux tuiles** » en
vol J0, laissé ouvert par la [fiche J2-2](FICHE-J2-2-2026-11-12.md) §4 (question 2 ; lot décidé par Sam avant J2-3). Sans changer
l'image ni le contact au sol. Machine : **ce Mac (M1 Max, fenêtre visible 1920 × 1080)** — kerr-mini a quitté le réseau pendant la
première mesure et n'est pas revenu. Données : `remote-results/j2-pointes/` (non commitées) ; **aucune image commitée** (budget des
binaires plein) : captures et graphiques montrés dans T3.

## 1. Ce qui coûtait (profil, vol J0 de `j2-probes`, code 51e4b1ee + compteurs)

Les compteurs de J2-2 (`reqMs`, `haloMs`) ont été découpés (`reqScanMs`, `reqLoadMs`, `reqOrthoMs`, `reqMaxMs`, `reqCalls`, `loads`), puis
les démarrages eux-mêmes chronométrés (sondes temporaires, retirées) :

| Ce qui | Mesuré (M1 Max, vol J0, deux vols) |
|---|---|
| **Démarrer un chargement** (`load` : son `fetch` d'imagerie ≈ 0,17 ms, celui de Terrarium ≈ 0,15 ms, le reste négligeable) | ≈ 0,3 ms ; **8 d'un coup après un pas de fenêtre : 2,1–3,3 ms** dans un seul `request()` |
| **Le regard du halo** (ses milliers de candidats : clés, cache, coût, tri — ses démarrages ≤ 0,5 ms) | 1,6–2,7 ms, au plus quatre fois par seconde |
| Les démarrages d'orthophotos (`loadOrtho`) | ≤ 1,1–1,2 ms |
| Le balayage des fenêtres lui-même (clés refaites, tri) | ≤ 0,4 ms en vol ; au chargement 8,3–8,7 ms **par image**, mais en 52–54 appels (un par tuile arrivée) |
| La publication : l'écriture des pages (vidange) / `complete` + mips | 1,1–1,8 ms / ≤ 0,3 ms ; une page « au moins une » ou une moyenne d'estimation trop basse la font déborder (2,2–3,2 ms) |
| Hors de tout chemin du code (une seule tuile, rien d'autre) | quelques 1–2 ms : pauses du ramasse-miettes probables (512 Kio alloués par page publiée) |

**Conclusion** : la pointe de `request()` n'est pas un balayage lourd (J2-2 le supposait) mais **des démarrages groupés** — chaque
`fetch` coûte — et **le halo** ; au chargement s'y ajoute la répétition du balayage à chaque arrivée.

## 2. Ce que le lot change (`src/system/earth-pages.ts`, `src/system/earth-tiles.ts`)

- **Un budget des tuiles par image** (`FrameBudget`, `earthTiles.frame`) : **2 ms du fil principal** (`TILE_FRAME_MS`) pour la publication,
  les démarrages et le regard du halo, ouvert **à la fin de chaque image** (`pubFrame()` : l'intervalle qu'attend l'image suivante —
  les démarrages des arrivées entre deux images, puis sa publication et son `update`), ou à la publication quand aucune image n'a fini
  depuis (une image convergée revient avant), ou après 100 ms sans image (à 33 ms, une image lente de vol — 40–60 ms — rouvrait le
  budget en son milieu : deux fois le travail dans l'image). La publication prend ce qui reste.
- **Les démarrages sous ce budget, dans leur ordre** : le sol de l'appareil piloté (`setAnchors`, avant `update`), les fenêtres (la tuile
  de la caméra d'abord, puis par anneau, le plus fin d'abord — inchangé), les orthophotos, le halo. Un démarrage passe si son **coût haut**
  (`estHi` : **le 2ᵉ plus cher des 8 derniers démarrages**, jamais sous la moyenne) tient dans ce qui reste **moins 0,3 ms**
  (`TILE_START_MARGIN_MS` : le coût réel d'un démarrage dépasse son estimation de 0,1–0,2 ms) ; sinon lui et les suivants
  attendent l'image suivante (`requestLater` si aucune ne vient) ; **un au moins après 3 images sans** (`TILE_STARVE_IMAGES`).
- **Une arrivée ne relance `request()` qu'une fois par image** (`requestSoon` ; la frame le relance à chaque `update`). **Le temps propre
  de `request()`** (son regard sur les fenêtres, les tuiles du cache posées, ≤ 0,4 ms) est pris sur le budget avant que ses démarrages
  soient jugés, et **un `request()` sans place pour un démarrage ne regarde pas** (un refus compté, la suite à l'image suivante).
- **Le halo regardé par tranches de 0,5 ms** (`haloScan` : ses niveaux dans l'ordre, les candidats accumulés, ses chargements démarrés
  une fois tous regardés — même ordre qu'en une fois, chaque candidat revérifié au démarrage), seulement dans une image qui a la place ;
  **un niveau dont l'anneau est entier en mémoire n'est plus regardé** tant que sa fenêtre, l'anneau, le cache (`cacheEpoch`) et les
  sources ne changent pas (`haloWhole`).
- **La publication** : le coût d'une page **estimé par ses octets** (`pages.estOf`, `msPerMiB` — une page de relief vaut trois
  orthophotos), une page qui ne tient pas passée pour une plus légère après elle (la première toujours écrite : la plus proche de la
  caméra), **la queue** (`complete`, mips) prise sur le budget avant la vidange (`pubTailMs`).
- **Plus d'allocation par page** : les hauteurs écrites telles quelles quand rien ne s'y ajoute (les mêmes mots, sans copie de 256 Kio) ;
  imagerie, lumières, hauteurs avec sursol dans un tampon réutilisé (`writeTexture` copie à l'appel) ; la moyenne 2 × 2 des lumières des
  fenêtres 2048² déroulée (elle allouait un tableau par texel). **Mots écrits identiques** (même calcul, même ordre).
- Compteurs ajoutés à `pubLog`/`pubStats` : `reqScanMs`, `reqLoadMs`, `reqOrthoMs`, `reqMaxMs`, `reqCalls`, `loads`, `refused`, `haloLooks`,
  `haloLoads`, `partMaxMs` (la plus longue partie de page écrite), `tailMs`. L'e2e `j2-probes` suit `AB_SIDE`/`AB_RUN` (un dossier par
  passage d'un A/B) et échantillonne `kept`.

## 3. Le vol J0 — A/B (e2e `j2-probes` phase `flight`)

Protocole : `scripts/ab-commit.ts`, A = le code de `main` sans ce lot, **B servi par son propre worktree** (`AB_REV_B`, un commit
détaché de ce lot : une autre session éditait `renderer.ts` dans ce checkout et son rechargement à chaud avait fait échouer deux passages
B servis depuis l'arbre de travail) ; entrelacé A B B A ; **« Nominal » attendu avant chaque passage** (le M1 Max bride en « Heavy »
pendant un vol : un premier A/B sans attente, GPU p50 25 → 40 ms dès le 2ᵉ passage, n'a pas pu départager — §5). Travail des tuiles par
image = `putMs + reqMs` (publication, arrivées, `request()` halo compris), par intervalle entre deux fins d'image.

**Tour final — tour 9** (le code de ce lot ; A = 0cda5113, B = le commit détaché 3986a543 = ce lot ; run
`remote-results/j2-pointes/ab-flight9`) :

| M1 Max, vol J0 (56 s), « Nominal » au départ | A1 | **B2** | **B3** | A4 |
|---|---|---|---|---|
| Images · images/s · GPU p50 | 2 525 · 43,8 · 22,4 ms | 2 530 · 43,7 · 22,4 ms | 2 581 · 44,8 · 21,8 ms | 2 557 · 44,5 · 22,1 ms |
| Travail des tuiles par image p95 / p99 | 1,6 / 2,3 ms | **1,2 / 1,7 ms** | **1,1 / 1,6 ms** | 1,5 / 2,1 ms |
| **Max** | 3,6 ms | **2,2 ms** | **2,3 ms** | 4,5 ms |
| **Images > 2 ms / > 3 ms** | 48 / 2 | **3 / 0** | **3 / 0** | 29 / 4 |
| `request()` max (halo compris) | 2,6 ms | **1,8 ms** | **1,9 ms** | 2,8 ms |
| Publication p95 / max | 1,3 / 2,9 ms | **0,7 / 1,8 ms** | **0,7 / 1,6 ms** | 1,3 / 1,9 ms |
| Arrivées hors publication, max | 0,7 ms | 1,2 ms | 0,2 ms | 0,5 ms |
| Démarrages (tous) ; reportés à l'image suivante | — | 1 079 ; 73 | 1 080 ; 52 | — |
| Tuiles en attente, moyenne (échantillons à 0) | 33,5 (13) | 58,1 (1) | 40,5 (0) | 51,7 (0) |
| **Chargement** (placement → vol) : `request()` max ; images `putMs` > 2 ms | 10,0 ms ; 7 | **1,9 ms ; 2** | **2,1 ms ; 1** | 8,9 ms ; 10 |
| Erreurs GPU | 0 | 0 | 0 | 0 |

- **Aucune image au-delà de 2,3 ms** (contre 3,6–4,5 ms avant, 6,1 ms à un tour précédent) ; **6 images sur 5 111 entre 2,1 et 2,3 ms**
  (contre 77 sur 5 082 au-delà de 2 ms, dont 6 au-delà de 3 ms). Leur forme : une publication de 0,7–1,6 ms puis un à cinq démarrages
  dont le coût réel dépasse l'estimation (2,1–2,3 ms), et une fois 1,2 ms dans l'enregistrement d'une arrivée (`put`, hors budget). Au
  sens strict, **le critère « aucune pointe > 2 ms » est tenu à 0,3 ms près** (0,1 % des images entre 2,1 et 2,3 ms), pas exactement.
- **Le travail n'est pas perdu, il est étalé** : 52–73 démarrages reportés d'une image sur ≈ 1 080 ; les tuiles en attente suivent le
  réseau d'un passage à l'autre (A : 33,5 et 51,7 ; B : 58,1 et 40,5 — au tour 4 un passage B à 130 de moyenne, publication jamais en
  retard, 32 reports : un réseau lent ce passage-là) ; le rejeu `tile-arrival` (§4), réseau hors jeu, montre une couverture équivalente.
- Le halo tourne en tranches (regards et chargements comptés ; certains vols ne le demandent pas : les fenêtres jamais entières) ; avant,
  son regard entier coûtait 1,6–2,7 ms d'un coup.

**Les tours** (même protocole ; A1 / A4 → B2 / B3) — chaque tour a corrigé ce que le précédent laissait :

| Tour | p95 (ms) | max (ms) | > 2 ms | > 3 ms | `request()` max au chargement (ms) | Règle de B, et ce qu'elle laissait |
|---|---|---|---|---|---|---|
| 3 | 1,9 / 1,5 → 1,3 / 1,2 | 6,1 / 3,8 → 2,4 / 2,4 | 83 / 44 → 13 / 3 | 18 / 3 → 0 / 0 | 11,8 / 9,9 → 3,1 / 3,0 | coût moyen (0,3 ms), marge 0,25, réserve 0,5 ; budget ouvert à la publication → un démarrage admis sur la réserve coûtait 0,5–0,7 |
| 4 | 1,6 / 1,6 → 1,1 / 1,2 | 4,0 / 4,0 → 2,2 / 2,2 | 41 / 47 → 3 / 2 | 4 / 3 → 0 / 0 | 9,3 / 12,8 → 2,6 / 2,9 | coût haut (le plus cher récent, −0,01 ms par démarrage) → **couverture à froid 5 × plus lente** (§4) ; budget décalé d'une image |
| 5 | 1,5 / 1,5 → 1,2 / 1,3 | 2,9 / 3,7 → 3,2 / 3,1 | 40 / 37 → 5 / 7 | 0 / 3 → 1 / 1 | 8,3 / 8,8 → 4,1 / 2,6 | budget ouvert en fin d'image ; deux pauses dans `put` (1,7–2,7 ms, hors budget) |
| 6 | 1,8 / 1,6 → 1,1 / 1,2 | 4,0 / 3,8 → 3,1 / 2,3 | 62 / 44 → 14 / 6 | 14 / 6 → 1 / 0 | 10,1 / 12,3 → 2,8 / 4,1 | 2ᵉ plus cher des 8 derniers (couverture revenue) → budget rouvert « au repos » après 33 ms en pleine image lente |
| 7 | 1,5 / 1,5 → 1,2 / 1,2 | 3,6 / 5,1 → 3,6 / 3,2 | 36 / 44 → 10 / 17 | 5 / 12 → 2 / 1 | 9,6 / 13,1 → 2,6 / 3,6 | repos à 100 ms → le regard de `request()` (≤ 0,4 ms) non compté ; une partie de page à 2,8 ms |
| 8 | 1,5 / 1,6 → 1,1 / 1,2 | 4,7 / 3,8 → 2,2 / 2,4 | 35 / 46 → 4 / 13 | 4 / 5 → 0 / 0 | 7,2 / 13,0 → 2,2 / 1,9 | temps de `request()` compté, regard sauté sans place → coût réel > estimation de 0,1–0,2 ms |
| **9** | 1,6 / 1,5 → **1,2 / 1,1** | 3,6 / 4,5 → **2,2 / 2,3** | 48 / 29 → **3 / 3** | 2 / 4 → **0 / 0** | 10,0 / 8,9 → **1,9 / 2,1** | **marge de 0,3 ms sous la limite pour les démarrages (code final)** |

Les tours 1–2 (sans refroidissement, le second bridé en « Heavy » dès B2, deux passages B tués par le rechargement à chaud d'une autre
session) ne départagent rien et ne sont pas repris.

## 4. Ce qui est prouvé inchangé

- **L'image** — A/B d'images figées (e2e `j2-page-camera` phase `still`, la vue de fuite du Gapeau de J2-0, 300 m, 120 images tenues,
  couleur de scène tone-mappée ; A = 0cda5113 ; A B B A ; M1 Max ; appareil à la même place aux quatre passages : 43,119989° N 6,13° E,
  330,91 m) — **code final** (B = 3986a543, `remote-results/j2-page-camera/m1max-pointes3-ab`) et code du tour 5 (B = 0fd42590,
  `…/m1max-pointes2-ab`, même chemin d'écriture) :

  | Paire | RMSE normalisé (final ; tour 5) | PSNR (final ; tour 5) | Luminance moyenne (final) |
  |---|---|---|---|
  | A1 – A4 (même code) | 0,0045 ; 0,0126 | 47,0 ; 38,0 dB | 0,33443 / 0,33430 |
  | B2 – B3 (même code) | 0,0026 ; 0,0033 | 51,8 ; 49,6 dB | 0,33437 / 0,33435 |
  | A1 – B2 / A1 – B3 | **0,0043 / 0,0043** ; 0,0029 / 0,0033 | **47,3 / 47,2** ; 50,7 / 49,7 dB | |
  | A4 – B3 / A4 – B2 | **0,0040 / 0,0040** ; 0,0126 / 0,0125 | 47,9 / 48,0 ; 38,0 / 38,0 dB | |

  **Les écarts A–B sont dans ceux de A–A** ; luminance identique à 0,04 %. Attendu par construction : les mots écrits au GPU sont les
  mêmes (même calcul, même ordre), seul le moment de leur publication change ; la capture attend que rien ne soit en attente.
  **Écart de protocole relevé et corrigé** : le premier A/B (même e2e) comparait deux vues différentes — la phase `still` laissait
  l'appareil voler 40 images avant de le geler, et A et B gelaient à 100 m l'un de l'autre (HUD : LFTH 153° 2,9 km contre 155° 3,0 km,
  reproduit de chaque côté ; RMSE A–B 0,062–0,065 contre 0,047 dans chaque côté, luminance −0,5 %). L'horloge est désormais gelée dès la
  pose et la place de l'appareil écrite (`still.held.at` : 43,119989° N 6,13° E, 330,91 m aux quatre passages). La place atteinte en 40
  images dépend de leur rythme : les A/B d'image de J2-1/J2-2, faits avec l'ancien protocole, n'avaient pas relevé d'écart de place.
- **La couverture à froid** — `tile-arrival` en rejeu (`TA_REPLAY` : les réponses enregistrées, 300 ms de latence fixe, le réseau hors
  jeu ; Aubrac, F-35 à 120 m gelé ; `TA_PROBE=1`). A/B A B B A sur le code du tour 6 (`ta-replay2`), puis le **code final** rejoué deux
  fois sur les mêmes réponses (`ta-replay5`) :

  | Rejeu, M1 Max | A1 | A4 | B2 (tour 6) | B3 (tour 6) | **B final ×2** |
  |---|---|---|---|---|---|
  | Qualité de vue 90 % / 99 % | 3,1 / 5,7 s | 3,5 / 6,1 s | 3,7 / 6,2 s | 3,3 / 5,9 s | **3,1 / 5,7 s ; 3,0 / 5,6 s** |
  | Qualité moyenne sur 30 s | 0,954 | 0,951 | 0,941 | 0,954 | 0,955 ; 0,952 |
  | Niveaux z 6–14 dessinés (moyenne) ; z 14 ; IGN z 15–17 entier | 14,2 ; 18,4 ; 12,3 s | 15,0 ; 19,3 ; 12,7 s | 14,5 ; 18,9 ; 12,3 s | 14,5 ; 18,7 ; 12,5 s | 13,7 ; 17,8 ; 12,2 s — 13,8 ; 17,7 ; 12,1 s |
  | Tout dessiné | 25,0 s | 23,9 s | 24,0 s | 23,7 s | **23,4 s ; 23,4 s** |
  | Pendant ce chargement : `request()` max ; publication+arrivées max ; images `putMs` > 2 ms | 11,9 ; 3,8 ms ; 15 | 15,8 ; 11,6 ms ; 33 | 3,8 ; 4,8 ms ; 4 | 3,3 ; 2,9 ms ; 2 | **2,4 ; 2,1 ms ; 2 — 1,4 ; 2,0 ms ; 0** |
  | Démarrages ou regards reportés | — | — | 139 | 118 | 224 ; 212 |

  **Équivalent** (les écarts A–B sont ceux de A1–A4). **Une régression a été trouvée en chemin, et corrigée** : avec l'estimation haute
  « le plus cher des récents, abaissé de 0,01 ms par démarrage » (tour 4/5 du vol), le rejeu donnait la qualité 90 % à **17,7–17,8 s**
  (contre 3,7–3,9 s) et z 6–14 à 35–40 s : quelques démarrages lents au froid tenaient `estHi` à 0,94 ms (moyenne 0,38) et les chargements
  à un par image — 3 003 refus, 13 démarrages/s. D'où la fenêtre courte (le 2ᵉ plus cher des 8 derniers) : 63–139 refus, couverture
  revenue. Cette régression ne se voyait pas dans le vol J0 (fenêtres déjà chargées, peu de démarrages).
- **Les vols de référence du contact** (E2E-VOLS §8) sur le code final, servi par son worktree : **`gear` 3/3, `landing` 5/5** (M1 Max,
  `remote-results/j2-pointes/flights.log`). Le contact lui-même n'est pas touché (`groundAt`, ancres : inchangés ; leurs chargements
  passent en tête sous le même budget).

## 5. Vérifié / non vérifié

- **Vérifié** : tsc, biome ; `bun test --parallel` **2 212 / 0** (un premier passage sous une charge de 15 avait 5 délais de 5 s dépassés,
  dont `earth-tiles` « detail's reach » : seul, 0,75–0,80 s sur HEAD comme sur ce lot ; les 4 fichiers seuls 33 / 0 ; relancé au calme :
  0 échec) ; `tests/earth-pages.test.ts` (3 tests nouveaux : la vidange par octets, le budget — démarrages, coût haut, repos, famine —,
  les démarrages d'`EarthTiles` sous budget, la tuile de la caméra d'abord) ; `pipeline-inventory --check` puis `--write` ; aucun shader
  changé (pas de check-wgsl) ; e2e : `j2-probes` vol J0 (9 tours A/B, §3), `j2-page-camera` still (3 A/B, §4), `tile-arrival` en rejeu
  (A/B + 3 × 2 passages B), `gear` 3/3, `landing` 5/5 — 0 erreur GPU.
- **Non vérifié** : **kerr-mini** (hors réseau pendant toute la session : la mesure principale demandée y reste à faire, J2-2 y voyait
  `request()` à 7 ms) ; **ΔGPU J0** (rien d'écrit au GPU ne change ; non mesuré — le M1 Max bride) ; la couverture **en réseau réel** à
  froid (le rejeu fixe la latence ; les vols J0 sur le réseau montrent des tuiles en attente dans l'écart d'un passage à l'autre) ;
  `tile-arrival` hors rejeu, sur Paris ou Chamonix (`TA_PLACE`) ; un vol long (> 1 min) ou rapide (Mach) où les fenêtres avancent plus
  vite ; une vue convergée sans images (le budget s'y rouvre toutes les 100 ms : chargé, non mesuré) ; le reste du jeu qui charge des
  tuiles hors `EarthTiles` (décor, bâtiments, Lune/Mars) — hors périmètre ; Windows/D3D12 ; une recette d'`apprendre-avions`.
- **Limites** : le critère « aucune pointe > 2 ms » est tenu à 0,3 ms près (§3) ; les `fetch` restent sur le fil principal ; l'enregistrement
  d'une arrivée (`put`) n'est pas compté dans le budget (≤ 1,2 ms vu une fois au tour final, 1,7–2,7 ms au tour 5 : pauses probables du
  ramasse-miettes) ; une partie de page à 2,8 ms vue une fois (tour 7), sans cause trouvée dans le code.

## 6. Suite

- Le coût restant d'un démarrage est le `fetch` lui-même (≈ 0,15 ms par appel, 2–3 appels par tuile) : les sortir du fil principal (le
  worker de décodage qui irait chercher et décoder lui-même) réduirait le total, pas seulement les pointes — un lot à part s'il le faut.
- La mesure principale sur kerr-mini (plus lent ; J2-2 y voyait `request()` à 7 ms) à son retour, avec le ΔGPU J0 de J2-2.
- J2-3 (des bords sans fuite).

## Complément (13 novembre 2026, ~07:50 UTC) — kerr-mini revenu

e2e `j2-probes` phase `flight` sur kerr-mini (l'arbre à fc844669, « Nominal ») — la publication des tuiles sur le fil principal, vol J0 de 56 s
(975 images) : **p50 0,1 / p95 1,3 / max 2,1 ms, 4 images au-delà de 2 ms, au plus 1 soumission de mips par image** ; au chargement (903
images) p95 1,5 / max 2,9 ms, 10 au-delà de 2 ms. Contre la fiche J2-0 sur la même machine et le même instrument (avant J2-1 et ce lot) :
p95 2,9 / max 9,5 ms, 79 images sur 963 au-delà de 2 ms, jusqu'à 9 soumissions. Le passage « avant » lancé sur le mini le 12 nov.
(`20261112-160905-pointes-avant`) n'a pas été rapatrié (le mini avait quitté le réseau). Le critère « aucune pointe > 2 ms » : tenu à 4
images près en vol (0,4 %). Source : `remote-results/20261113-074622-j2-pointes-mini`.
