# Q6-ISS — les vraies caméras de l'ISS (en cours : ISS0)

Plan : [PLAN-REFRACTION-HORIZONS.md](../../PLAN-REFRACTION-HORIZONS.md), volet Q6-ISS (décision 39, Sam, 4 novembre). Sources
revérifiées le 4 novembre 2026 ; aucune calibration encore.

## ISS0 — le corpus reproductible (première tranche, le 4 novembre)

### Les sources, revérifiées

| Caméra / famille | Ce que la source établit | Source |
|---|---|---|
| **NASA — externe Harmony** (flux « Live High-Definition Views from the ISS », `ROboUHfPUrU`, en direct depuis le 22 octobre 2026) | « an external camera mounted on the station's **Harmony module** … **looking forward at an angle so that International Docking Adapter 2 is visible** » ; une boucle « Previously Recorded » quand elle n'est pas disponible | description du flux officiel (YouTube @NASA) — l'identifiant cité au plan (`aB1yRz0HhdY`) n'existe plus |
| NASA — « Live Video from the ISS » (`M3HKLzjvKPc`) | l'intérieur quand l'équipage est en service, sinon une caméra extérieure non nommée ; écran bleu aux pertes de signal | description du flux officiel |
| **Sen — SpaceTV-1** (flux 24/7 `fO9e9jnhYK8`, 1080p30 sur YouTube) | trois caméras 4K **à l'extérieur, sur la plateforme Bartolomeo** (fixée au module Columbus — Space.com dit « sur Columbus » : la même chose), « not behind a window » : **Nadir** (droit vers la Terre), **Horizon** (vers le limbe), **Docking** (le long de la structure, le port d'amarrage avant) ; non orientables ; rien sur le champ, la focale ni la cadence | [sen.com/mission/stv-1](https://www.sen.com/mission/stv-1) ; CRS-30, mars 2024 (Space.com) |
| NASA — HDEV (historique) | sur la plateforme externe de Columbus ; actif du 30 avril 2014 au 18 juillet 2019, fin de vie le 22 août 2019 ; la page ne liste pas ses quatre caméras (le rapport final à lire) | [eol.jsc.nasa.gov/esrs/hdev](https://eol.jsc.nasa.gov/esrs/hdev/) |

### HDEV (2014–2019) : ses quatre caméras, selon le rapport final (annexe A)

[Rapport final HDEV, juin 2020](https://eol.jsc.nasa.gov/ESRS/HDEV/files/HDEV-Final-Report_20200715.pdf) : quatre caméras fixes
(ni pan, ni zoom, ni iris), derrière des hublots de quartz fondu, sur la plateforme externe de Columbus (CEPF) ; toutes en 720p
à ~60 images/s ; une caractérisation de la distorsion de chacune faite au sol (Bouguet CCT — ses valeurs ne sont pas publiées
dans le rapport).

| Visée | Caméra | Capteur | Objectif (documenté) | Champ horizontal 16:9 (**dérivé** : capteur 1/3″ nominal, 4,8 mm de large) |
|---|---|---|---|---:|
| **avant** (le vecteur vitesse) | Hitachi HV-HD30 | 1/3″ CMOS × 3 | Fujinon TF4DA-8, 4 mm F/2,2, mise au point à l'infini | ~62° |
| **nadir** | Toshiba IK-HR1S | 1/3″ CMOS | Fujinon TF4DA-8, 4 mm | ~62° |
| **arrière 1** | Panasonic AG-HMC150 | 1/3″ CCD × 3 | Leica Dicomar à 3,9 mm (le plus court du zoom) | ~63° |
| **arrière 2** | Sony FCB-EH4300 | 1/3″ CMOS | intégré, réglé à 4,7 mm | ~54° |

Une famille distincte (plan) : ni les EHDC actuelles, ni SpaceTV-1 ; leurs archives seulement si le corpus en contient.

### Les archives repérées (Sen, mono-caméra d'abord)

Métadonnées lues par `yt-dlp -j` (aucun téléchargement) ; les compilations hebdomadaires de 15 min (« This Week in Orbit »,
« 15 Minutes of Earth From Space ») **mêlent caméras et accélérés** : réservées à l'inventaire, pas à la calibration.

| Vidéo | Date | Durée · format | Caméra probable (à vérifier image par image) | Usage |
|---|---|---|---|---|
| `OjpoaQPp4xM` — Dragon CRS-35 approche (15 oct. 2026) | 2026-10-15 | 234 s · 2160p25 | Docking / Nadir (Dragon 1 km sous la station) | géométrie : un véhicule de taille connue, la structure |
| `ARfNTE-3OPA` — Crew-13, approche et amarrage, 24 min | 2026-10-05 | 1 490 s · 2160p25 | Docking (le port avant) | ISS2 : structure, port, véhicule amarré |
| `eA3wBLdnfIU` — Soyuz MS-29 sous l'ISS (Atlantique, Cap-Vert) | 2026-07-15 | 263 s · 2160p25 | Nadir | ISS2 : côtes (Cap-Vert) + véhicule |
| `sRmsKE-CPu4` — Crew-12 1 km sous l'ISS | 2026-02-14 | 157 s · 2160p25 | Nadir | validation |
| `Q297BuAhqH0` — 90 clips en 30 min | 2026-07-11 | 1 831 s · 2160p30 | mêlées | inventaire seulement |

Les archives n'ont pas d'UTC de prise de vue à la seconde (la date du descriptif seulement) : pour la géométrie fine, préférer
le direct.

### Le direct, horodaté

- **Trouvé** : l'habillage du direct Sen **incruste l'UTC de l'image** (« TIME UTC 03:03:18 » pour une saisie à 03:03:37 —
  **~19 s de retard** du direct), avec le lieu survolé, jour/nuit, la vitesse : chaque image porte son instant. Le jeu propage
  l'ISS par SGP4 sur les derniers éléments CelesTrak (`src/system/iss.ts`, récupérés au lancement) : pour un direct, l'orbite du
  jour même — le meilleur cas de la précaution 1 du plan.
- **Outil** : `scripts/iss-capture.ts` — une image de chaque direct toutes les N secondes pendant M minutes, nommée par l'UTC de
  saisie, un manifeste TSV ; **hors du dépôt** (`~/.kerr-lab/iss-corpus` : les images Sen ne sont pas à redistribuer ; celles de la
  NASA sont du domaine public). Première capture lancée le 4 novembre à 03 h 30 UTC, 60 s × 115 min (au moins un passage de jour).
- **Reste d'ISS0** : identifier la caméra de chaque image Sen (l'habillage ne la nomme pas : nadir / horizon / docking au contenu),
  les coupes et les « Previously Recorded » de la NASA ; choisir les extraits de calibration et ceux réservés à la validation ;
  le rapport final HDEV (ses quatre caméras) ; les droits et crédits notés avant toute image versée au dépôt.

## ISS0 — la première capture classée par caméra (le 5 novembre)

La capture du 4 novembre (`scripts/iss-capture.ts`, une image par minute, 03 h 04 – 06 h 43 UTC, 142 images par source,
`~/.kerr-lab/iss-corpus`, hors du dépôt) a été classée à l'œil sur des planches-contacts. Les heures sont celles de la saisie
(UTC) ; l'incrustation Sen retarde d'environ 19 s.

### Sen (direct `fO9e9jnhYK8`) : au moins quatre vues distinctes

| Vue (identifiée au contenu) | Plages de jour | Plages de nuit / crépuscule | Remarques |
|---|---|---|---|
| **Horizon** : limbe en haut, courbure forte, grand angle | 03:59–04:06, 04:53–04:57, 05:10–05:39, 06:34 | 04:07–04:16, 05:40–05:48 | la vue la plus longue ; terminateur à 04:06 et 05:38 |
| **Nadir** : sol à plat, sans limbe | 04:59–05:04, 05:06–05:09, 06:35–06:43 | — | côtes et nuages nets (Madagascar, l'Afrique à 05:07) |
| **Dragon amarré** : la capsule à gauche, le limbe en bas | 03:21, 04:20, 05:05, 05:26 | idem | plans courts, souvent avec l'étiquette « loss of signal » |
| **Structure et Soleil** : modules en avant-plan, le Soleil qui se lève sur le limbe | 06:22–06:31 | — | reflets, éblouissement, structure en contre-jour |
| Intercalaires | « Switching camera » à 04:15, 04:58, 05:49, 06:20, 06:33 ; studio (entretien) à 05:58 | | |
| Nuit noire | | 03:04, 04:16–04:25, 05:50–06:19 | à peine quelques lumières : peu exploitable |

### NASA (direct `ROboUHfPUrU`) : une seule caméra fixe

Une caméra extérieure fixe regarde vers le bas, le long d'une charge sous housse blanche à sangles noires, avec un radiateur
ou un panneau en bas à gauche. Sa position sur la station n'est pas encore identifiée (ISS1). Elle donne la même
géométrie d'une image à l'autre, ce qui est un bon point pour la calibration.
- **Jour :** 03:21–04:08, 04:53–05:41, 06:26–06:42.
- **Crépuscule** (la structure au soleil, la Terre déjà noire) : 04:09–04:14, 05:42–05:46, 06:21–06:25.
- **Nuit** (bruit, quelques villes) : 04:15–04:26, 05:47–06:20.
- **Pertes de signal** (écran « temporarily suspended ») : 04:19, 04:54, 05:24–05:25, 05:57.

![NASA, la caméra fixe : jour, crépuscule, nuit, perte de signal (domaine public)](Q6/iss0-nasa-classes.jpg)

### Choix provisoire des extraits

| Usage | Sen | NASA |
|---|---|---|
| **Calibration** (ISS2 géométrie, ISS3 réponse) | horizon 05:10–05:30 (limbe net, nuages variés) ; nadir 04:59–05:04 | jour 05:10–05:40 (géométrie fixe, océan et nuages) |
| **Validation** (gardée à part) | horizon 03:59–04:06 (jusqu'au terminateur) ; nadir 06:35–06:43 ; structure et Soleil 06:22–06:31 | jour 06:26–06:42 ; crépuscule 05:42–05:46 |

- **Reste d'ISS0 :**
  - attacher à chaque image Sen l'instant de son incrustation (lecture du texte), pour la géométrie à la seconde ;
  - une capture plus dense (toutes les 5 à 10 s) sur les extraits retenus, pour le mouvement ;
  - les « Previously recorded » de la NASA ;
  - les tolérances de calibration.
- **Puis ISS1 :** situer sur le modèle de la station la caméra fixe de la NASA, à partir de la housse et du radiateur, et les
  vues Sen : horizon, nadir et Dragon.

### ISS0 : l'instant de chaque image Sen, lu dans son incrustation (le 5 novembre)

- **Outil :** `scripts/iss-overlay-ocr.swift` lit les champs « TIME UTC » et « ALTITUDE km » de l'incrustation du direct Sen
  avec la reconnaissance de texte de macOS (Vision), dans le bloc en bas à droite de l'image (1920 × 1080). Chaque valeur
  est rattachée à son étiquette par sa ligne, car la troisième ligne n'affiche pas toujours l'altitude.
- **Résultat sur la capture du 4 novembre** (`~/.kerr-lab/iss-corpus/sen-overlay.tsv`, hors du dépôt) :
  - l'heure est lue sur **141 images sur 142** ;
  - **le direct retarde de 17 s en médiane** sur l'heure de saisie (de 10 à 21 s ; une saisie par minute, sans
    synchronisation à la seconde) ;
  - l'altitude est lue sur 18 images, là où elle est affichée : de 419 à 433 km ;
  - un premier essai qui prenait le nombre de la troisième ligne sans son étiquette donnait 550 à 600 km : c'était un
    autre champ.
- **Usage :** pour la géométrie à la seconde (ISS2), chaque image Sen prend l'instant de son incrustation. Le jeu propage
  l'ISS par SGP4 sur les éléments CelesTrak du jour.
- **Reste d'ISS0 :** une capture plus dense (toutes les 5 à 10 s) sur les extraits retenus ; les tolérances.

## ISS1 — les caméras sur la station : le registre (le 5 novembre)

- **Sources :**
  - **Sen** : les trois caméras 4K de SpaceTV-1 sont fixes, à l'extérieur, sur la plateforme Bartolomeo d'Airbus, posée par
    Canadarm-2 (vol CRS-30, mars 2024) ([sen.com](https://www.sen.com/mission/stv-1),
    [space.com](https://www.space.com/astronomy/earth/live-4k-video-from-space-see-earth-from-the-iss-with-sharp-eyed-sen-cameras)) :
    - la nadir regarde droit vers le bas (environ 240 × 180 km au sol) ;
    - la caméra d'horizon, grand angle, montre parfois la structure ;
    - la caméra d'amarrage regarde le long de la station, vers le véhicule amarré au port avant d'Harmony.
  - **Bartolomeo** : sur la face avant de Columbus, fixée au tourillon avant tribord
    ([eoPortal](https://eoportal.org/satellite-missions/iss-bartolomeo),
    [ESA](https://www.esa.int/ESA_Multimedia/Images/2020/04/Bartolomeo_connected_to_Columbus)).
  - **NASA** : le descriptif du direct parle d'une caméra extérieure sur Harmony, qui regarde vers l'avant en biais, avec
    IDA-2 dans le champ (en-tête de `scripts/iss-capture.ts`).
- **Mesuré dans le modèle de la NASA** (`assets/iss/ISS2.glb`, hors dépôt). Boîtes englobantes des pièces nommées, lues par
  Blender et ramenées au repère de la station comme dans `build-iss.py` (mètres ; x vers l'avant, y à tribord, z vers le
  nadir) :

  | pièce | x | y | z |
  |---|---|---|---|
  | `Columbus_BARTOLOMEO` | 13,25–15,61 | 2,59–8,68 | 4,54–6,45 |
  | `Columbus` | 8,47–13,24 | 1,97–8,68 | 2,61–7,10 |
  | `IDA2` (port avant d'Harmony) | 15,46–16,09 | −0,86–1,06 | 4,73–6,46 |
  | `Node2_Details_EHDC_5` (caméra HD externe 5 d'Harmony) | 12,75–14,14 | 1,70–2,42 | 4,70–5,07 |
  | `Node2_Details_CameraPole` | 12,69–14,20 | 1,16–1,82 | 2,88–3,95 |

- **Lecture :**
  - les caméras Sen sont sur Bartolomeo, à 3 à 9 m à tribord d'IDA-2 et à sa hauteur. La caméra d'amarrage regarde donc
    vers bâbord, à quelques mètres d'un Dragon amarré, ce qui explique la capsule plein cadre dans le corpus ;
  - la caméra du direct NASA est très probablement **EHDC-5** sur Harmony, à 2,5 m d'IDA-2. **Ce n'est pas confirmé** : le
    classement d'ISS0 y voyait surtout une charge sous housse et un radiateur, à rapprocher de ce poste.
- **Fait** (`src/system/iss-cameras.ts`, test `tests/iss-cameras.test.ts`) : un registre des quatre caméras (identifiant,
  flux, descriptif, attache dans le repère de la station et sa source, axe de visée, état « estimation »). Pour la caméra
  d'amarrage, la visée va de Bartolomeo vers IDA-2 ; le test vérifie qu'elle tombe à moins d'un mètre du port que la table
  de la station (`iss.ts`) place à cet endroit.
- **Non établi :**
  - la place exacte de chaque caméra sur Bartolomeo ;
  - les champs de vue ;
  - l'axe de la caméra d'horizon (estimé à 35° sous l'avant, puisque le limbe est en haut de l'image) ;
  - la caméra NASA.
- **Suite, ISS2 :** ajuster attache, axe et champ sur les images horodatées d'ISS0. Le limbe donne le tangage et le roulis,
  les côtes la géométrie au sol (nadir), le véhicule amarré la caméra d'amarrage. L'heure lue dans l'incrustation situe
  l'ISS par SGP4.
