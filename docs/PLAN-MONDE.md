# Plan : monde et rendu (phase 3 de l'audit), puis l'audio et TARS

Suite du plan de l'audit [`AUDIT-AAA-2026-10-03.md`](AUDIT-AAA-2026-10-03.md) § 7, phase 3 « monde et rendu »,
après les assistants ([`PLAN-ASSISTANT.md`](PLAN-ASSISTANT.md)). Suivi global : [`AAA-PROGRESS.md`](AAA-PROGRESS.md).

**Décisions du propriétaire (05/10/2026)** :
- **la phase 3 d'abord**, la phase 4 (le jeu) ensuite ; pas de carrière pour l'instant ;
- l'**audio et l'IA** (partition adaptative, voix, TARS) **ferment la phase 3**, comme son volet audio ;
- TARS parle par **OpenRouter** : le texte par `z-ai/glm-5.3-flash`, les **décisions typées par Jev**
  (`typesafe/jev`, le modèle « System One » de TypeSafe, servi par OpenRouter sur `/api/alpha/decisions`) ;
  la **clé est saisie par le joueur** dans les réglages et gardée en local — sans clé, TARS parle avec ses
  phrases écrites ;
- pour la phase 4, noté : le préréglage de difficulté par défaut sera **Pilote**.

Comme pour les plans précédents : un commit par étape, une fiche de progrès, une capture (ou une mesure) par
phase visible ; FR + EN ; e2e à vraies entrées ; **mesurer avant d'adopter** (le banc A/B, le Kerr Bench).

## État de départ (inventaire du 05/10/2026)

Déjà fait en G3/G4 ou avant : pistes des sites dans le relief et au rendu, imagerie NASA (GIBS 611 m, VIIRS la
nuit), LOLA/MOLA, océan Cox–Munk et vagues proches, nuages (phase, cirrus, ombres longues), cartes BC7/BC5,
reconstruction (R2, R4, R8), agrandissement Catmull-Rom (R10 étape 1), tiering promu à la mesure (P3).
Écartés à la mesure : la reprojection relativiste (R9), l'atmosphère Hillaire multi-diffusion (O10), les rayons
crépusculaires écran, R10 étape 2 (TAAU à la résolution d'affichage), f16, subgroups.

Manque : **aucun Service Worker** (ni hors ligne, ni cache des tuiles ; 273 Mo sur Pages, un seul bundle) ;
la perte du device recharge la page ; maillages non compressés (Endurance 19 Mo, ISS 107 Mo, Ranger 54 + 58 Mo — *au 08/10, déjà découpés en LOD : voir l'état ci-dessous*) ;
pas de pluie, de visibilité réduite, de vent en altitude, de METAR ; piste sans balisage de nuit ni ILS au
sol ; manette à 4 axes (les axes 4+ ignorés), pas de courbes, pas de HOTAS ; cockpit non cliquable ;
`StereoPanner` seulement (pas de HRTF, pas de Doppler), pas de musique, pas de voix ; **10 storage buffers**
exigés par le noyau (le défaut WebGPU est 8 : une partie d'Android et Safari exclus).

## Phases

| # | Phase | Contenu | Statut |
|---|---|---|---|
| **M1** | PWA et cache | **Service Worker** : l'application en cache-first (coquille, bundle, polices, workers, WASM, textures de base) mis à jour en arrière-plan ; **cache des tuiles** de relief (S3) et d'imagerie (GIBS) par la Cache API avec un budget et une éviction LRU ; **manifest** (icône, couleurs, plein écran) ; préchargement en temps libre de la scène courante ; hors ligne : la dernière scène et ses tuiles. Mesure : rechargement à chaud, lecture hors ligne | fait | `6140d81` |
| **M2** | Robustesse et chargement | **Recréation à chaud du device** perdu (les ressources GPU reconstruites, le vol sauvé d'abord : plus de rechargement) ; **tiering par micro-banc** de 200 ms au premier lancement (au lieu de la chaîne vendor), mémorisé ; **découpage du code** (`import()` : carte 3D, exports vidéo/EXR, outils dev, offline) ; `bun run build` complet (workers et WASM) | **fait** (08/10) : **recréation à chaud du device** — le vol sauvé, un nouveau `Renderer` fait sur un nouveau device et glissé sous la même poignée (`util/swappable.ts` : la page, la simulation et les calques gardent la leur), ce que la page lui avait donné repris (`adopt`), la carte et le globe refaits sur le nouveau device ; 357 ms ici (shaders en cache disque) ; deux pertes par minute rattrapées, la troisième rend la main (rechargement proposé) ; e2e `gpu-recovery` (perte simulée, `__bh.gpu.lose()`). Le reste : palier mesuré dans les deux sens et retenu, démarrage borné et diagnostiqué, première image sur 2 pipelines (`test-kimi`, [`ANALYSE-CHARGEMENT-GPU.md`](ANALYSE-CHARGEMENT-GPU.md) §8) ; build complet (workers, WASM, SW). Écarté : le découpage du code (mesuré non rentable, modules câblés au démarrage) |
| **M3** | Téléchargement | **Maillages quantifiés** (positions 16 bits, normales octaédriques) et **meshopt** (ou l'équivalent sans dépendance) pour l'Endurance, l'ISS, le Ranger, le Lander ; **planètes HD en KTX2** (BC7/ASTC transcodés) au lieu de JPEG décodés en rgba8 ; objectif −60 % du poids, mesuré au premier chargement du Kerr Bench | **en partie (M3a, 08/10)** : mesuré d'abord ce que chaque scène télécharge (Artemis 59 Mo, Lune 63, Gargantua 44) et ce que sa première image attend. Les cibles du plan se sont révélées faibles : les cartes de base sont déjà en KTX2, les reliefs déjà compressés (deltas, plans d'octets, gzip : 100 % au gzip), les JPEG HD déjà compacts (leur mémoire GPU déjà compressée à l'exécution). Le vrai poids était sur le **chemin de la première image** : le préchargement de la Terre (22,7 Mo, toutes scènes) et JUP365 (4,1 Mo, lunes de Jupiter, 2040–2100) passent **après** la première image (sauf une scène à Jupiter ou une sauvegarde : JUP365 avant) — à 20 Mbit/s, une scène à Gargantua : première image **11,1 → 5,5–6,1 s**, 17,2 + 22,7 → 9,5 Mo avant elle ; e2e `first-image-downloads`. **M3b** : les maillages bruts compressés sans perte (gzip au build, `util/inflate.ts` à la lecture, un fichier ancien non compressé accepté) — l'Endurance (ses 4 niveaux), le Ranger, le Lander : **23,0 → 12,2 Mo** (Ranger 1,03 → 0,59 dans presque toutes les scènes, Lander 2,02 → 1,24, Endurance 5,8 → 3,3 et 11,4 → 5,7). Restent l'ISS (9,9 Mo, déjà gzip : seule une quantification, avec perte, la réduirait) et le cockpit (3,1 Mo, déjà gzip). Cibles mesurées au 08/10 : les 89 JPEG/PNG des planètes (Lune 9,3 Mo, Mars 5,9 Mo, cartes normales et de relief de 3–4 Mo), les maillages `endurance-full` 11 Mo, `iss-lod1` 9,9 Mo, `endurance` 5,8 Mo ; la Terre « high » est déjà en KTX2 (≈ 67 Mo, à l'approche seulement) |
| **M4** | Météo | **Pluie et visibilité** (brume, brouillard, gouttes sur la verrière), **couches nuageuses** animées (2–3, base et sommet, couverture), **vent en altitude et cisaillement** (le profil avec l'altitude, la rafale près du sol), **manche à air** et **piste choisie selon le vent** ; **METAR en option** (réseau, clé non requise) pour les sites terrestres ; tempêtes de poussière sur Mars ; tout dans la physique (`wind.ts`, `aero.ts`) et le rendu | **en cours** : [`PLAN-METEO.md`](PLAN-METEO.md), étapes W1–W8, décisions du propriétaire (réglable + METAR VATSIM sans clé, autopilotes soumis, les quatre volets) ; **W1–W7 faits** (modèle, panneau, carte météo, brouillard et couches au rendu, pistes face au vent et manche à air, pluie, poussière de Mars, METAR réel) |
| **M5** | Aéroports vivants | **Balisage de nuit** des pistes (bord, seuil, axe, PAPI en 3D), marquages, **ILS** au sol (localizer et glide : les aiguilles de l'écran NAV existent — les émetteurs placés par piste), **procédures d'approche** pour les 16 sites ; véhicules et trafic ambiant si le budget le permet | à faire |
| **M6** | Audio spatial | **PannerNode HRTF** (le vaisseau, les propulseurs, la piste, la station), **Doppler**, la cabine entendue **de l'intérieur** (le cockpit : étouffé, la structure qui craque, la pressurisation), **AudioWorklet** pour un moteur granulaire ; mesure au RMS | à faire |
| **M7** | Entrées HOTAS | Axes 4+ lus, **écran de mapping des axes et boutons** (manche, manette des gaz, palonnier), **courbes et zones mortes par axe**, inversion, profils (Xbox, HOTAS, pédales) ; retours haptiques (`rumble()`) sur le moteur, le plasma, le toucher | à faire |
| **M8** | Cockpit interactif | **Picking par pré-passe d'IDs** (une texture d'identifiants des écrans et interrupteurs) : écrans cliquables (onglets, pages), interrupteurs (train, volets, SAS, lumières), éclairage de cabine réglable (la décision « cockpit éclairé » en attente depuis G3) | à faire |
| **M9** | Bindings et compatibilité | **≤ 8 storage buffers** par étage dans le noyau (buffers fusionnés à offsets, tableaux de textures, 2 bind groups) pour Android et Safari ; matrice de compatibilité alimentée par le Kerr Bench ; **upscaler FSR1** (EASU + RCAS après le temporel, gigue de Halton) **à la mesure** — R10 étape 2 avait été écartée : adopté seulement si le PSNR et le temps le justifient | **en partie** (08/10) : **8 storage buffers** — les tables en lecture seule du traceur (corps, harmoniques, LUT du corps noir et du synchrotron, chemin de la caméra) dans un seul buffer à offsets fixes (`gpu-tables.ts`, les mêmes que `trace.wgsl` : test unitaire) ; le device demandé à la limite par défaut de WebGPU. Même image (A/B `trace-ab`, 6 scènes : écarts sous le bruit de capture — PSNR 53–71 dB contre 37–57 dB en A/A), même vitesse (−2,0 % et −2,7 % sur 4 passages) ; e2e `gpu-startup` : un adaptateur à 8 démarre et dessine. Restent la matrice de compatibilité et FSR1 |
| **M10** | Musique, voix et TARS | **Partition adaptative** synthétisée (nappes, orgue additif) qui suit la phase de vol et la gravité du moment, le **tic-tac de Miller** (un battement = un jour sur Terre) ; **voix** (Web Speech, sous-titres) : annonces de finale (« 100… 50… 30… 10 », minimums, sink rate), le contrôle de mission (« Go for TLI », autorisations), **blackout radio** dans le plasma ; **TARS** : un assistant qui commente et répond (touche et champ), **honnêteté et humour réglables** — le texte par OpenRouter `z-ai/glm-5.3-flash`, les **décisions typées par Jev** (parler ou se taire, quel sujet, quel ton, l'alerte à dire d'abord — des questions `noul`/`choice`/`score` posées sur l'état du vol, en parallèle, pour quelques centièmes de centime) ; la **clé OpenRouter saisie dans les réglages** et gardée en local, jamais dans le code ; sans clé, les phrases écrites | à faire |

Ordre : M1 → M2 → M3 (le chargement, le plus visible pour qui arrive), M4 → M5 (le monde), M6 → M7 → M8
(la sensation), M9 (la compatibilité, mesurée), M10 (l'audio et TARS, qui ferme la phase).

## État au 08/10/2026

Fait : **M1** (PWA, `6140d81`, et les caches séparés de `/` et `/test/`, `e0d5f7a`) ; **M2** (le chargement
de `test-kimi`, puis le 08/10 la recréation à chaud du device). Depuis, le travail est allé aux autopilotes (campagne 15/20) et au HUD
([`PLAN-HUB.md`](PLAN-HUB.md)) ; aucune phase M3–M10 n'a commencé.

Vérifié dans le code au 08/10 :

| Manque | Où en est le code |
|---|---|
| Perte du device | ~~`renderer.onLost` sauve le vol puis demande de recharger la page~~ → **recréé à chaud** (M2, 08/10) |
| Storage buffers | ~~le noyau exige 10~~ → **8**, la limite par défaut (M9, 08/10) |
| Poids | maillages déjà en LOD (ISS 2 + 9,9 Mo, Endurance 1–11 Mo, Ranger 1 Mo, Lander 2 Mo, cockpit 3,1 Mo) ; restent 89 images de planètes en JPEG/PNG et la quantification (M3) |
| Manette | 4 axes lus (`gamepad.ts`), pas d'écran de mapping ni de courbes (M7) |
| Audio | `audio/engine.ts` sans `PannerNode` HRTF, sans Doppler, sans voix (M6, M10) |

**Le pilier Technologie (79 → 80)** se gagne d'abord par la robustesse et la compatibilité, avant le monde :
1. ~~**M2 : la recréation à chaud du device** et son e2e~~ — **fait le 08/10** (l'audit § 3.2 n° 4 couvert) ;
2. ~~**M9 : ≤ 8 storage buffers**~~ — **fait le 08/10** (même image, même vitesse) ;
3. **M3 : le poids** (planètes en KTX2, maillages quantifiés), mesuré au premier chargement du Kerr Bench.

Puis le monde et la sensation (M4 → M8), et M10 qui ferme la phase. Ordre proposé : **M2 → M9 → M3 → M4 →
M5 → M6 → M7 → M8 → M10** (M9 avancé : la compatibilité vaut plus que la météo pour qui ne peut pas lancer
le jeu).
