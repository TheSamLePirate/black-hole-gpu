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
la perte du device recharge la page ; maillages non compressés (Endurance 19 Mo, ISS 107 Mo, Ranger 54 + 58 Mo) ;
pas de pluie, de visibilité réduite, de vent en altitude, de METAR ; piste sans balisage de nuit ni ILS au
sol ; manette à 4 axes (les axes 4+ ignorés), pas de courbes, pas de HOTAS ; cockpit non cliquable ;
`StereoPanner` seulement (pas de HRTF, pas de Doppler), pas de musique, pas de voix ; **10 storage buffers**
exigés par le noyau (le défaut WebGPU est 8 : une partie d'Android et Safari exclus).

## Phases

| # | Phase | Contenu | Statut |
|---|---|---|---|
| **M1** | PWA et cache | **Service Worker** : l'application en cache-first (coquille, bundle, polices, workers, WASM, textures de base) mis à jour en arrière-plan ; **cache des tuiles** de relief (S3) et d'imagerie (GIBS) par la Cache API avec un budget et une éviction LRU ; **manifest** (icône, couleurs, plein écran) ; préchargement en temps libre de la scène courante ; hors ligne : la dernière scène et ses tuiles. Mesure : rechargement à chaud, lecture hors ligne | fait | `6140d81` |
| **M2** | Robustesse et chargement | **Recréation à chaud du device** perdu (les ressources GPU reconstruites, le vol sauvé d'abord : plus de rechargement) ; **tiering par micro-banc** de 200 ms au premier lancement (au lieu de la chaîne vendor), mémorisé ; **découpage du code** (`import()` : carte 3D, exports vidéo/EXR, outils dev, offline) ; `bun run build` complet (workers et WASM) | **en partie** (branche `test-kimi`, 05/10) : palier mesuré dans les deux sens et retenu, démarrage borné et diagnostiqué, première image sur 2 pipelines ([`ANALYSE-CHARGEMENT-GPU.md`](ANALYSE-CHARGEMENT-GPU.md) §8). Restent la recréation à chaud du device et le découpage (mesuré non rentable : modules câblés au démarrage) |
| **M3** | Téléchargement | **Maillages quantifiés** (positions 16 bits, normales octaédriques) et **meshopt** (ou l'équivalent sans dépendance) pour l'Endurance, l'ISS, le Ranger, le Lander ; **planètes HD en KTX2** (BC7/ASTC transcodés) au lieu de JPEG décodés en rgba8 ; objectif −60 % du poids, mesuré au premier chargement du Kerr Bench | à faire |
| **M4** | Météo | **Pluie et visibilité** (brume, brouillard, gouttes sur la verrière), **couches nuageuses** animées (2–3, base et sommet, couverture), **vent en altitude et cisaillement** (le profil avec l'altitude, la rafale près du sol), **manche à air** et **piste choisie selon le vent** ; **METAR en option** (réseau, clé non requise) pour les sites terrestres ; tempêtes de poussière sur Mars ; tout dans la physique (`wind.ts`, `aero.ts`) et le rendu | à faire |
| **M5** | Aéroports vivants | **Balisage de nuit** des pistes (bord, seuil, axe, PAPI en 3D), marquages, **ILS** au sol (localizer et glide : les aiguilles de l'écran NAV existent — les émetteurs placés par piste), **procédures d'approche** pour les 16 sites ; véhicules et trafic ambiant si le budget le permet | à faire |
| **M6** | Audio spatial | **PannerNode HRTF** (le vaisseau, les propulseurs, la piste, la station), **Doppler**, la cabine entendue **de l'intérieur** (le cockpit : étouffé, la structure qui craque, la pressurisation), **AudioWorklet** pour un moteur granulaire ; mesure au RMS | à faire |
| **M7** | Entrées HOTAS | Axes 4+ lus, **écran de mapping des axes et boutons** (manche, manette des gaz, palonnier), **courbes et zones mortes par axe**, inversion, profils (Xbox, HOTAS, pédales) ; retours haptiques (`rumble()`) sur le moteur, le plasma, le toucher | à faire |
| **M8** | Cockpit interactif | **Picking par pré-passe d'IDs** (une texture d'identifiants des écrans et interrupteurs) : écrans cliquables (onglets, pages), interrupteurs (train, volets, SAS, lumières), éclairage de cabine réglable (la décision « cockpit éclairé » en attente depuis G3) | à faire |
| **M9** | Bindings et compatibilité | **≤ 8 storage buffers** par étage dans le noyau (buffers fusionnés à offsets, tableaux de textures, 2 bind groups) pour Android et Safari ; matrice de compatibilité alimentée par le Kerr Bench ; **upscaler FSR1** (EASU + RCAS après le temporel, gigue de Halton) **à la mesure** — R10 étape 2 avait été écartée : adopté seulement si le PSNR et le temps le justifient | à faire |
| **M10** | Musique, voix et TARS | **Partition adaptative** synthétisée (nappes, orgue additif) qui suit la phase de vol et la gravité du moment, le **tic-tac de Miller** (un battement = un jour sur Terre) ; **voix** (Web Speech, sous-titres) : annonces de finale (« 100… 50… 30… 10 », minimums, sink rate), le contrôle de mission (« Go for TLI », autorisations), **blackout radio** dans le plasma ; **TARS** : un assistant qui commente et répond (touche et champ), **honnêteté et humour réglables** — le texte par OpenRouter `z-ai/glm-5.3-flash`, les **décisions typées par Jev** (parler ou se taire, quel sujet, quel ton, l'alerte à dire d'abord — des questions `noul`/`choice`/`score` posées sur l'état du vol, en parallèle, pour quelques centièmes de centime) ; la **clé OpenRouter saisie dans les réglages** et gardée en local, jamais dans le code ; sans clé, les phrases écrites | à faire |

Ordre : M1 → M2 → M3 (le chargement, le plus visible pour qui arrive), M4 → M5 (le monde), M6 → M7 → M8
(la sensation), M9 (la compatibilité, mesurée), M10 (l'audio et TARS, qui ferme la phase).
