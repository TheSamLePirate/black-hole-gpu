# Plan : aurores et magnétosphères de tout le système solaire

Écrit le 3 novembre 2026, à la demande de Sam (« les aurores et magnétosphères, c'est une bonne idée à intégrer »).
L'idée vient du prochain chantier d'Alex (`vr-solar-system/docs/agent/puffs-bilan-qualite-aurores_2026-11-03-18-27-52.md`).
**Rien n'est commencé chez nous.** Les cinq décisions sont prises (Sam, 3 novembre : § 6). Les sources
des chiffres sont listées à la fin. Les chiffres marqués « ~ » sont des ordres de grandeur tirés des revues, à
vérifier sur la source au moment de coder.

**Mise à jour du 4 novembre** : Alex a réalisé l'essentiel de ce chantier dans vr-solar-system en une soirée (sessions
6a à 6a sexies, `origin/master` `dd54164`). Il en a tiré :
- des champs pour sept corps, dont JRM33 + CON2020 pour Jupiter ;
- des aurores pour tous les corps, l'orage magnétique, STEVE et l'aurore pulsante ;
- la météo spatiale réelle de la NOAA ;
- un cache par direction ;
- le schéma complet.

Sur la demande de Sam (« prends tout ce qu'il y a de bon »), son code, ses données et ses mesures ont été lus.
**Le § 7 recense ce qu'on reprend, phase par phase, avec ses fichiers et ses lignes.** Il recense aussi les défauts
qu'on ne reprend pas. Le § 5 renvoie au § 7.

**Relecture du 5 novembre (toujours d'actualité, rien de commencé chez nous) :**
- **Vérifié dans le code** : ni `magnetic-fields.ts`, ni lecture du Kp NOAA ; `auroraLight` et la constante `AUR_MAG`
  sont inchangés (`trace.wgsl`, appelés seulement par le traceur, réglage `aurora` lu dans `renderer.ts`). Le § 1
  reste exact.
- **Chez Alex** (`origin/master` relu, dernier commit le 4 novembre à 06:45 UTC) : un seul changement d'aurore depuis
  `dd54164`, `964bfec` (session 6c). Le grain des aurores y est réduit en fondant le cache par direction dans le temps.
  Le trou pendant une descente disparaît : la profondeur du côté lointain est plafonnée. Les surimpressions du schéma
  sont cachées derrière les corps (`VRSolarOcclusion.hlsl`). Ces trois points sont à lire avant AM2 et AM7. Son coût
  annoncé, mesuré sur Quest : 18,8 ms au sol à Kp 7, 14,7 ms à 400 km. Ce sont ses chiffres, non transposables ici.
- **Ce que la [recherche de données du 3 novembre](RECHERCHE-DONNEES-SCIENTIFIQUES-AAA-2026-11-03.md) demandait, et
  qui est intégré** : les aurores optiques de Ganymède et de Callisto, JRM33 utile jusqu'aux degrés 13–18 et les
  formats NOAA de 2026 (§ 3, § 7.4).
- **Ce qui manquait, ajouté ici** :
  1. **L'époque de la scène au-delà de 2030.** La partie prédictive d'IGRF-14 et de WMM2025 s'arrête en 2030. Une
     scène en 2067 (l'horloge du jeu peut y aller) prend un **scénario déclaré** : le champ de 2030 figé, ou une dérive
     séculaire extrapolée nommée comme telle. Ce n'est jamais une précision. TARS dit lequel est utilisé (AM0, AM1).
  2. **Deux familles de données séparées** : la géométrie (champ, ovale, empreintes) et l'émission (flux de
     précipitation, espèces, raies, brillance). Un ovale juste ne fixe pas la brillance (recherche, § 2.2 et § 4.4).
     Les tables d'AM0 et d'AM1 les portent séparément.
- **Le raccord à la destination** a bougé depuis le 3 novembre :
  - Q5 a livré les tables d'air partagées (transmittance et diffusion multiple de Hillaire, C1 ; une atmosphère
    unique, C2). L'émission aurorale d'AM2 s'ajoute à ce modèle d'air commun, pour le traceur comme pour le raster,
    au lieu d'un second encodage propre à `trace.wgsl` (§ 4) ;
  - la passe de lignes d'AM7 se teste contre la profondeur finale (C0-9). Avant la bascule de l'opaque terrestre
    (§ 20.5 de l'analyse stratégique), elle lit la profondeur de la visibilité raster par un adaptateur nommé, à
    retirer à la bascule.
- **Conséquence pour l'ordre** : AM0, avec la partie données d'AM1 (Kp, OVATION, leur âge, le scénario d'époque), est
  un lot CPU, en worker et testé, sans dépendance au renderer. Il peut se faire à tout moment sans contredire la
  destination. AM2 et les suivants touchent le rendu : ils se placent après les interfaces de l'air et de la
  profondeur, ou les lisent par des adaptateurs bornés.

**Avancement du 6 novembre 2026 — AM0 fait** (`src/system/magnetic-fields.ts`, `tests/magnetic-fields.test.ts`, 8 tests
verts) :
- harmoniques de Schmidt à tout degré, CON2020 (forme analytique d'Edwards), modèles de Mercure, de la Terre (IGRF-14 2025.0
  au degré 3), de Jupiter (JRM33 au degré 13 et CON2020), de Saturne (Cassini 11), d'Uranus (Q3), de Neptune (O8) et de
  Ganymède ;
- traçage RK4 arrêté sur **la vraie figure** (WGS84, ellipsoïdes à 1 bar), empreintes dans l'hémisphère du dipôle, table
  de l'ovale, pôle du dipôle (la donnée qui remplacera `AUR_MAG`), magnétopause de Shue.
- **Vérifié** : les tests du § 7.1 aux tolérances d'Alex. Une exception : l'ovale terrestre à L = 7 s'étale de 63,1 à
  72,6° de latitude dipolaire centrée (moyenne 67,5°) au lieu de 64–70°. Le test porte sur l'étendue et la moyenne, avec
  la raison écrite.
- **Pas encore fait** :
  - la variation séculaire d'IGRF (à reprendre du fichier NOAA/IAGA, pas de mémoire) ;
  - le scénario d'époque au-delà de 2030 ;
  - le champ crustal de Mars ;
  - Ganymède dans le champ de Jupiter ;
  - le traçage en worker (aucun lecteur ne l'appelle encore : il viendra avec AM1) ;
  - les vecteurs de Hue et al. 2023 pour Io.

**AM1, premier lot (6 novembre)** :
- **l'ovale en heure locale magnétique**, de la loi d'Alex : colatitude 21° + 1,4·Kp à minuit, 12° + 0,49·Kp à midi, sud
  0,5° plus loin ;
- **les arcs** : trois arcs qui s'écartent avec Kp, le secteur de minuit trois fois plus brillant que midi ;
- **les bandes et les raies** : la bande diffuse 1,5° plus près de l'équateur, la bordure bleue de N₂⁺ dans les orages ;
- **le pôle** : un test garde `AUR_MAG` égal au pôle d'AM0 ;
- **le Kp réel de la NOAA** (`src/system/space-weather.ts`, réglage « Aurores de la vraie météo de l'espace », activé)
  dans les 3 h de maintenant, avec un schéma validé : les objets de 2026 et l'ancienne table ; un Kp `null` n'est plus lu
  comme 0.
- **Observé** (e2e `aurora-oval`) : les rideaux à Tromsø vers le sud et au limbe depuis 400 km.
- **Restant :**
  - ~~trop brillant et saturé ; rien depuis 4 000 km~~ : réglé par le premier lot d'AM2 (ci-dessous). Le « rien depuis
    4 000 km » n'était pas un chemin manquant : la caméra y était au soleil (œil adapté au jour) et au pôle de l'ovale ;
  - la carte OVATION, l'orage, STEVE, l'aurore pulsante ;
  - le pôle passé en uniforme (une fois la variation séculaire là).

**AM2, premier lot (6 novembre 2026)** — l'émission en unités physiques, pour la Terre :
- **Les raies, une seule source** : `src/system/aurora-lines.ts` (luminance par kR depuis l'énergie du photon et V(λ) de la
  CIE, teintes depuis CIE 1931 → RVB linéaire) ; `trace.wgsl` AUR_* en est la copie, un test les tient égales. Écart avec
  Alex : N₂⁺ 427,8 nm vaut 2,4·10⁻⁶ cd/m² par kR (V = 0,0097), pas 3,4·10⁻⁶.
- **La brillance** : le kR de colonne de l'arc (la mesure des IBC) 2 × 10^(0,24 Kp) — IBC II à Kp 3, III vers Kp 7 —,
  réparti sur 0,886σ + H km de chaque raie ; L = cd/m² × 10⁻⁵ × |E| (les 100 000 lux de la pleine lumière).
- **Les arcs, des lames minces** le long du champ (18, 13, 22 km), inclinées comme les lignes d'un dipôle à 67°, intégrées
  analytiquement sur chaque pas (14 échantillons + les deux bouts, contre 40). Les nappes d'épaisseur nulle d'Alex (§ 7.5),
  essayées d'abord, ne se voyaient pas d'en haut : un rayon le long du champ ne les traverse presque pas (Sam : « jamais
  devant la Terre »). La bande diffuse : 0,25 du kR de l'arc sur 2°, ce qui dessine l'ovale vu d'en haut.
- **L'œil** : l'exposition commune s'arrête à 1 lux et suit le sol éclairé par la Lune ; l'aurore se voit sur le ciel,
  dessiné sombre — gain (I + I_œil)/(lumière du ciel), le même éclairement que le posemètre (`eyeSkyLight`), 1 de jour,
  ~100 de nuit ; sous ~3·10⁻³ cd/m², la couleur glisse vers le gris-vert des bâtonnets.
- **Trouvé en route** : la bande blanche saturée des fjords la nuit (vue de Tromsø, Lune ou pas) venait de la mer qui
  reflète la sonde de lumière du Ranger, dont le ciel de nuit vaut ~40 fois son sol ; reflet borné à 4 fois le ciel clair
  du modèle de la caméra. L'échelle nocturne de la sonde elle-même reste à comprendre.
- **Observé** (e2e `aurora-oval`, planche `docs/progress/aurora/am2-planche.jpg`) : Tromsø Kp 4, rideaux devant la Terre
  depuis 400 km (Kp 5), l'ovale sur le Canada depuis 4 000 km dans l'ombre (Kp 3, 7).
- **Restant** : la Terre au soleil vue depuis l'espace (l'œil adapté au jour n'y voit pas l'aurore de la face nuit) ; le
  rendu « photo » ; le grain au limbe ; l'aurore générique par corps (AM0 → table, Jupiter en AM3) ; le cache par direction
  et la mesure du coût (non mesuré : temps GPU des e2e seulement, bruités).

**AM3, premier lot (6 novembre 2026)** — Jupiter :
- **L'ovale principal** tracé dans JRM33 + CON2020 depuis 25 R_J (AM0), tabulé autour de son propre centre (le nord, ~71° N
  vers λ 180°, va jusqu'au pôle de rotation ; le sud ~82° S), mis en série de Fourier à 8 harmoniques (écart < 0,03°) :
  `src/system/aurora-bodies.ts`, copie `JUP_*` dans `trace.wgsl` tenue égale par un test. Un tableau constant indexé dans
  la boucle a été essayé d'abord ; sa compilation semblait ne pas finir — c'était en fait le noyau de Jupiter proche, ~200 s
  à froid avec ou sans aurore (`docs/PROBLEMES-A-REGLER.md`).
- **Les émissions** : l'ovale en lame de 1,2°, les émissions polaires en volume, le pied d'Io (calculé au CPU à sa
  longitude System III du moment, `ioFeet`) et sa traîne ; raies H-α et H₂ visible (455 nm) à 245 km au-dessus de 1 bar ;
  les kR d'Alex comme valeurs de départ, pas des mesures.
- **L'œil** : la caméra dans l'ombre de Jupiter adapte l'exposition (`earthSunlight` pour Jupiter) ; au soleil, la
  radiance physique (la distance² en UA). `__bh.viewAt(…, { body })` et `__bh.sys.subsolar(id)` pour placer la vue.
- **Observé** (e2e `aurora-jupiter`) : l'ovale nord, l'émission polaire et le pied d'Io depuis 7 000 km dans l'ombre ;
  l'ovale sud au limbe. **Restant** : Europe, Ganymède, Callisto ; les « dawn storms » ; l'activité propre à Jupiter (le
  réglage commun pour l'instant) ; le grain et la saturation au limbe ; la vue sud parfois noire (problème connu, pas
  l'aurore) ; le coût non mesuré.

**AM4, premier lot (6 novembre 2026)** — Saturne, Uranus, Neptune :
- **Le même code que Jupiter** (`trace.wgsl` auroraGiant) : chaque géante son ovale (AM0 : Cassini 11 pour Saturne — centré
  sur ses pôles, 12–13° — ; Q3 et O8 pour Uranus et Neptune, très décentrés ; série de Fourier, erreur ≤ 2° pour Uranus),
  sa coquille, ses hauteurs de raies, son kR (Alex : 12, 1,5, 0,8 kR), les deux nappes d'Uranus à ±3° ; une structure de
  constantes par corps, choisie une fois par rayon (`giantsWgsl`, tenu égal par un test).
- **Observé** (e2e `aurora-giants`, kerr-mini) : Uranus et Neptune vus de leur ombre, le noyau d'aurore en place — et rien de
  visible : ~1–3 kR de H-α et de H₂ font ~3·10⁻⁵ cd/m², sous 1 % du blanc même pour l'œil adapté. C'est juste : leurs
  aurores sont en UV et en infrarouge ; les montrer relève du rendu « instrument » d'AM8 (décision 1 de Sam).
- **Saturne** : l'œil adapté à son ombre révèle une lumière faible et fausse du traceur (croissants pixellisés, trous dans le
  disque) — consigné dans `docs/PROBLEMES-A-REGLER.md` ; l'adaptation y est coupée, ses aurores restent à leur radiance
  physique, donc non vues de nuit pour l'instant.
- **Restant** : l'ovale de Saturne fixe par rapport au Soleil (minuit 16°, midi 13°), l'empreinte d'Encelade, l'activité
  propre à chaque corps.

**AM6, premier lot (6 novembre 2026)** — Mars et Vénus (`trace.wgsl` auroraRocky) : la raie verte de l'oxygène en volume ;
Mars, l'anneau au-dessus des champs crustaux (50° S, 180° E, rayon 14 + 4 sin(3az + 1) + 2 sin(7az)°, 0,15 kR × 1,6^activité)
et, en tempête (activité ≥ 6), le vert diffuse de toute la face nuit (Persévérance, 2024) ; Vénus, uniforme après une
éjection. L'œil adapté dans l'ombre de Mars. Observé (e2e `aurora-mars`, kerr-mini) : en tempête, l'anneau vert au limbe
de la face nuit ; pas d'artefact révélé. Valeurs de départ d'Alex, pas des mesures.

**AM7, premier lot (6 novembre 2026)** — le schéma :
- **Les lignes** : les coquilles L d'Alex (Terre 1,5–9, Jupiter 1,8–40, Saturne, Uranus, Neptune, Mercure, Ganymède), 8
  longitudes, tracées dans le vrai champ d'AM0 jusqu'à la figure, rééchantillonnées en 160 points (Catmull–Rom) avec
  log |B| en chaque point, en cache par corps (`src/system/magneto-lines.ts` : ~40 ms pour la Terre, ~160 ms pour Jupiter).
  La magnétopause de Shue et l'onde de choc conique (e = 0,81) dessinées par leur silhouette (le profil dans le plan du
  Soleil, en travers de la visée). Première version en grillage et couleurs par coquille : « c'est moche » (Sam) — d'où la
  couleur le long des lignes par log |B| (or près de la planète, orange, magenta, violet au loin), un halo doux sous un
  trait fin, les boucles vues par la tranche effacées, l'arrière plus pâle.
- **Troisième version** (« toujours moche et peu informatif », Sam) : la magnétosphère en couches de lumière, façon NASA
  SVS — passe `fsMagVol` (`overlay.wgsl`) à la taille de l'image tracée, composée sur la sortie : la magnétopause et l'onde
  de choc en coques minces émissives, intégrées exactement sur chaque pas (profil gaussien, distance signée linéaire : un
  erf) — leurs bords s'éclairent en rasance, leurs faces restent pâles, sans crénelage ; les ceintures de radiation en
  volume dans le L du dipôle (interne · protons, chaude ; externe · électrons, bleue), le tore d'Io en rouge ; tout arrêté à
  la profondeur tracée (bloc 2 × 2 : le damier des images tracées un pixel sur deux). Les lignes de champ allégées (une
  longitude sur deux) portent des impulsions qui courent dans le sens du champ. Des étiquettes (FR/EN), désencombrées :
  magnétopause, onde de choc, vent solaire, queue, ceintures, tore. Paramètres des volumes : `VOLUMES` (choix de schéma).
  Coût non mesuré (temps GPU des e2e bruités).
- **Le dessin** : le calque de lignes de la carte du ciel (`chartoverlay.ts`, `overlay.wgsl`) dans un mode « profondeur » :
  chaque bout porte sa distance, le fragment est caché là où le rayon tracé a rencontré plus près (`moments.y`) — la passe
  de lignes avec profondeur du § 4, sans nouveau pipeline d'opaque. Réglage « Schéma de la magnétosphère » (Ciel › Carte du
  ciel), corps proche seulement.
- **Observé** (e2e `magnetosphere-diagram`) : la Terre depuis 60 000 km, Jupiter depuis 1,5 million de km.
- **Le vent solaire réel** (RECHERCHE-DONNEES § 4.2, lot C) : `src/system/solar-wind.ts` lit le produit propagé à 1 h de
  la NOAA (6–7 ko, déjà ramené au nez de l'onde de choc ; son tableau historique et les objets du format 2026), en tire la
  pression dynamique et Bz, et place la magnétopause terrestre par Shue et al. 1998 (onde de choc à 1,3 r0, valeur de
  schéma) ; trois états — réel, ancien, typique — dits sur l'étiquette « Vent solaire » avec ses valeurs. Observé (e2e) : le
  6 novembre 2026 à 05:40 UTC, 309 km/s, 2,3 cm⁻³, Bz −0,8 nT, Pd 0,4 nPa → nez à 13,2 R_E (au lieu de ~10).
- **Restant** : la déformation des lignes par le vent solaire (compression côté jour, queue), les lignes ouvertes, les
  actions TARS ; les corps lointains (au-delà de la portée du corps proche) ; le traçage en worker. **Les particules sont
  abandonnées** (Sam, 6 novembre 2026 : « je veux pas de particules »).

## 1. Ce qu'on a aujourd'hui

- **Une seule aurore, celle de la Terre**, `auroraLight` (`src/shaders/trace.wgsl`, S2 du plan aviation) :
  - un anneau autour du pôle du dipôle (80,8° N, 72,6° O, constante `AUR_MAG`) ;
  - centré à 69° de latitude magnétique moins 1,1° par point de Kp ;
  - plis et rayons procéduraux ;
  - le vert de l'oxygène (557,7 nm) culminant à 110 km, le rouge (630 nm) au-dessus de 200 km ;
  - intégré en 40 pas dans une coquille de 90 à 330 km.
- **Comment on l'active** :
  - par le réglage `aurora` (un Kp choisi à la main, de 0 à 9) ;
  - par les missions et la vue d'exception « Lofoten » (`views.ts`) ;
  - le code n'est compilé que si l'aurore est demandée (bit `HAS_AURORA`, 16384).
- **Aucun champ magnétique** : pas de modèle de champ, pas de lignes de champ, pas de magnétopause.
- **Limites connues de notre aurore terrestre** :
  - **l'anneau est symétrique en heure locale**, alors que le vrai ovale est décalé vers la nuit : environ 75–78°
    de latitude magnétique côté jour et 65–67° côté nuit par temps calme ;
  - pas de bordure basse bleu-violet de l'azote (N₂⁺ 427,8 nm) dans les orages ;
  - Kp jamais pris dans la météo spatiale réelle ;
  - pôle du dipôle figé (le WMM2025 le met à 80,85° N, 72,76° O pour 2025.0 : notre constante est bonne à 0,1° près).

## 2. Ce qu'on vise

1. **Des aurores réalistes partout où elles existent**, vues de l'espace et du sol (ou de dedans les nuages pour les
   géantes) : Terre, Jupiter, Saturne, Uranus, Neptune, Mars, Vénus, et les lunes Io, Europe et Ganymède.
2. **Les magnétosphères en schéma**, à afficher à la demande :
   - lignes de champ, magnétopause et onde de choc ;
   - tore de plasma d'Io, ceintures de radiation ;
   - mouvements des particules (giration, rebond, dérive).
3. **Une seule source de vérité pour les champs**, partagée par l'image, le schéma, les instruments, TARS et les tests.

## 3. Les données, corps par corps

| Corps | Champ (modèle) | Aurore : où, à quelle altitude, de quelle couleur | Visible à l'œil ? |
|---|---|---|---|
| **Terre** | IGRF-14 / WMM2025 ; dipôle incliné de ~9,2° | Ovale à 65–78° de latitude magnétique selon l'heure locale. O 557,7 nm vers 100–120 km, O 630 nm au-dessus de 200 km, N₂⁺ 427,8 nm en bordure basse | Oui |
| **Jupiter** | JRM33 (Juno, degrés utiles jusqu'à ~13–18) + feuillet de courant CON2020. Dipôle ~4,17 G à l'équateur, incliné de ~10° | Ovale principal (rupture de la corotation) ; empreintes d'Io (au moins 3 taches et une traîne), d'Europe et de Ganymède ; émissions polaires. L'ovale nord est très déformé par l'anomalie du champ. Les émissions vont de ~250 km (visible, Galileo) à ~400 km (UV au limbe) au-dessus de 1 bar. Surtout UV (H, H₂) et infrarouge (H₃⁺) | Faible : vue en visible côté nuit par Galileo |
| **Saturne** | Champ axisymétrique, dipôle incliné de moins de 0,01° (Cassini, Grand Finale), décalé vers le nord. Quadripôle et octupôle ~10 % du dipôle à 1 bar | Ovale principal vers 70–80° de latitude, qui oscille avec les « oscillations de période planétaire » (UVIS). UV de H₂ entre ~4 et 40 kR. Rideaux visibles de quelques centaines de km à ~1 500 km au-dessus de 1 bar ; l'ovale de minuit 2–4° plus bas que celui du crépuscule. H-α est la raie la plus forte (Dyudina et al. 2016) | Faible : vue en visible côté nuit (Cassini ISS, 2006). En large bande, de quelques kR à ~100 kR (Jupiter : ~1 000 kR). Cassini la voit **rose en bas, violette vers 1 000–1 500 km, le bord inférieur rouge** (Dyudina et al. 2016) ; la couleur pour l'œil n'est pas mesurée |
| **Uranus** | Dipôle incliné de ~59°, décalé de ~0,3 rayon | Deux bandes autour de chaque pôle magnétique, séparées par un creux sombre (JWST, H₃⁺, janvier 2025 ; Tiranti et al., GRL 2026). Alex les met à ±3° de l'ovale tracé depuis L = 7. Elles tournent avec la planète | Pas vue en visible |
| **Neptune** | Dipôle incliné de ~47°, décalé de ~0,55 rayon | Aurores H₃⁺ aux latitudes moyennes (JWST, publié en mars 2025) ; haute atmosphère froide (~358 K) | Pas vue en visible |
| **Mars** | Pas de champ global ; champs crustaux de l'hémisphère sud | Aurores discrètes au-dessus des champs crustaux (MAVEN IUVS, EMM EMUS) ; aurore diffuse sur tout le globe par les particules solaires. **Le vert à 557,7 nm a été vu du sol par Perseverance en mars 2024** (Science Advances, 2025) | Oui, faible, lors des tempêtes solaires |
| **Vénus** | Pas de champ ; magnétosphère induite | Raie verte de l'oxygène (557,7 nm) côté nuit (Keck, 2001), plus forte après les éjections de masse coronale, vers ~125 km ; le rouge est éteint sous 150 km | Faible |
| **Mercure** | Dipôle faible, décalé vers le nord de ~0,2 rayon | Aurore en **rayons X** : électrons qui frappent la surface (pas d'atmosphère) | Non : seulement en fausses couleurs |
| **Io** | Pas de champ propre ; Io baigne dans le tore | En éclipse (Galileo SSI, 1999) : lueurs bleues de SO₂ au-dessus des volcans (plus de 300 kR), rouge de l'oxygène aux limbes, vert faible côté nuit (sodium ?) | Oui, en éclipse |
| **Europe** | Champ induit (océan) | Oxygène à 630 et 636 nm, vu en éclipse (Keck et Hubble, 2018) ; UV à 130,4 et 135,6 nm | Faible, en éclipse |
| **Ganymède** | Dynamo propre, ~719 nT à l'équateur (Kivelson 2002 : g10 −711,5, g11 46,8, h11 22,9 nT), dans le champ de Jupiter (~100 nT) | Deux ovales d'oxygène vers ±40° (UV 130,4 et 135,6 nm, 200 à 1 000 R) ; leur oscillation a servi à prouver l'océan. **Détection optique** en éclipse (de Kleer et al. 2023) | Faible, en éclipse ; l'UV en vue « instrument » |
| **Callisto** | Champ induit seulement | Aurore optique détectée en éclipse (de Kleer et al. 2023), très faible. Son **empreinte UV sur Jupiter** est observée (Rabia et al. 2025) | Candidat faible, avec son incertitude |
| **Titan, Lune** | — | Rien à rendre (aucune aurore détectée qui vaille une image) | — |

Les grandeurs du schéma (ordres de grandeur, revues de Bagenal et al., à vérifier) :
- **magnétopause côté Soleil** : Terre ~10 R, Jupiter ~50–100 R, Saturne ~20–25 R, Uranus ~18 R, Neptune ~23–26 R,
  Mercure ~1,5 R ;
- **Ganymède** n'a pas d'onde de choc : le plasma de Jupiter y est sous-alfvénique, d'où des « ailes d'Alfvén » ;
- **tore d'Io** à 5,9 R_J, visible en rouge dans les raies du soufre ionisé [S II] (671,6 / 673,1 nm).

## 4. Principes (destination WebGPU AAA)

- **Une responsabilité commune** : un module `src/system/magnetic-fields.ts` possède les champs.
  - Il contient les coefficients de Gauss par corps, le dipôle équivalent, les traçages de lignes et la
    correspondance entre un pied de ligne et une distance.
  - Le shader, le schéma, TARS et les tests le lisent ; aucun ne refait sa propre géométrie de pôles.
  - `AUR_MAG` devient une donnée publiée par ce module, et non plus une constante du shader.
- **Préparer avant la frame** :
  - les lignes de champ, les ovales et les empreintes des lunes sont tracés au CPU, dans un worker, à la date de
    la scène ;
  - le shader ne lit que des tables : latitude de l'ovale par heure locale magnétique, positions des empreintes.
  - **Aucune évaluation d'harmoniques sphériques par pixel.**
- **L'émission aurorale est un terme d'émission de l'air**, rangé avec les modèles d'air partagés (le volet Q5 du plan
  commun). Elle est lue aujourd'hui par le traceur, et demain par la composition de l'air du raster, sans passer par
  un encodage propre à `trace.wgsl`.
- **Le schéma est une passe de lignes testée contre la profondeur finale**.
  - Elle reprend le code de segments d'`overlay.wgsl`, qui ne dessine aujourd'hui que sur le ciel.
  - Elle doit être cachée par une planète ou par un anneau.
  - Elle dépend donc du contrat « profondeur finale » (§7 de l'analyse stratégique).
- **Coût** :
  - le code n'est compilé que là où il sert : un bit par famille, comme `HAS_AURORA` ;
  - le budget est celui du corps (PLAN-PLANETES-AAA : le même que la Terre par vue) ;
  - chaque phase est mesurée en A/B sur ce Mac, sans casque, et les résultats sont montrés en images et en graphiques
    (CLAUDE.md).

## 5. Les phases

| | Quoi | Dépend de | Risque |
|---|---|---|---|
| **AM0** | `magnetic-fields.ts` : modèles (IGRF-14 réduit, JRM33 + CON2020, Saturne de Cassini, dipôles inclinés et décalés d'Uranus, Neptune, Mercure et Ganymède, carte crustale de Mars), traçage de lignes en worker, empreintes. Tests : pôle de la Terre contre WMM2025, empreinte d'Io contre les angles de Juno UVS (Hue et al. 2023), dipôle de Saturne sur l'axe. **Reprise d'Alex : § 7.1** (coefficients, CON2020, traceur, vecteurs de test) | — | faible (données réunies chez Alex) |
| **AM1** | **La Terre refaite** : ovale en heure locale magnétique (de type OVATION), bordure bleue de N₂⁺, arcs rouges dans les grands orages ; **Kp réel** de NOAA SWPC quand la date est « maintenant », avec un repli hors ligne ; `AUR_MAG` venu d'AM0. **Reprise d'Alex : § 7.2–7.4** (ovale jour/nuit, cycle d'orage, STEVE, aurore pulsante, raies et unités, modèle de l'œil, lueur au limbe, OVATION) | AM0 | faible |
| **AM2** | **Une aurore générique par corps** : coquille d'émission, table des espèces et des altitudes, ovale et empreintes lus dans les tables d'AM0 ; la Terre passe par le même code. **Reprise d'Alex : § 7.3 et 7.5** (rideaux par croisement, table par azimut, élimination par rayon, cache par direction) | AM0, AM1 | moyen (coût) |
| **AM3** | **Jupiter** : ovale principal de JRM33 (statistique Juno UVS), empreintes d'Io, d'Europe, de Ganymède et de Callisto avec leurs traînes, émissions polaires, « dawn storms ». Raccord avec le volume des nuages (V1–V11) : l'aurore est au-dessus, vue depuis les ponts. **Reprise d'Alex : § 7.6** | AM2 | moyen |
| **AM4** | **Saturne** (ovale qui oscille, empreinte d'Encelade faible), **Uranus et Neptune** (ovales qui tournent avec un champ incliné). **Reprise d'Alex : § 7.6** | AM2 | faible |
| **AM5** | **Les lunes** : Io (lueurs bleues des panaches, rouge aux limbes) et Europe (rouge de l'oxygène), en éclipse dans l'ombre de Jupiter ; Ganymède (ses deux ovales en UV, une faible lueur visible en éclipse) ; Callisto (candidat très faible). **Reprise d'Alex : § 7.6** | AM2 | moyen |
| **AM6** | **Mars et Vénus** : aurores discrètes au-dessus des champs crustaux, diffuses et vertes dans les tempêtes solaires (Perseverance, 2024) ; la raie verte de Vénus après une éjection, diffuse sur tout le côté nuit (Gray et al. 2025). Un réglage « tempête solaire » commun. **Reprise d'Alex : § 7.6** | AM2 | faible |
| **AM7** | **Le schéma des magnétosphères** : lignes de champ (L-shells), magnétopause et onde de choc (modèle de Shue pour la Terre, mis à l'échelle ailleurs), tore d'Io (aussi en lueur rouge réaliste), ceintures, particules animées (giration, rebond, dérive, au temps accéléré). Passe de lignes avec profondeur, réglage dans les Guides, actions TARS. **Reprise d'Alex : § 7.7** | AM0 | moyen (passe) |
| **AM8** | ~~Fausses couleurs « instrument »~~ — **déplacé** (Sam, 6 novembre 2026) dans [PLAN-CAPTEURS-CAMERA-SECONDAIRE](PLAN-CAPTEURS-CAMERA-SECONDAIRE.md) S6 : les canaux UV (Hubble, Juno) et IR (JWST) de la caméra secondaire et de la seconde vision | AM2–AM6 | — |

Pour chaque phase : tests unitaires des modèles, un e2e court par corps, en headless sur ce Mac. Les captures
avant/après et les coûts sont montrés dans T3, puis une entrée dans `progress-to-destination.md` si la phase
touche un contrat de la destination (l'air partagé, la passe de lignes avec profondeur).

## 6. Décisions de Sam (3 novembre 2026)

1. **Le visible physique par défaut, et une vue « instrument » en fausses couleurs** (AM8 : UV de Hubble et Juno,
   infrarouge de JWST, rayons X de Mercure) : **oui**. Les aurores des géantes sont surtout en UV et en infrarouge ; en
   visible, elles sont faibles et ne se voient que côté nuit : c'est ce que montre le rendu par défaut.
2. **La météo spatiale réelle pour la Terre** (Kp de NOAA SWPC quand la date est « maintenant », repli sur le réglage
   manuel hors ligne) : **oui**.
3. **L'ordre** : **AM0 → AM1 → AM2 → AM3 (Jupiter) → AM7 (le schéma) → AM4 → AM5 → AM6 → AM8**.
4. **Le schéma : tout** — lignes de champ, magnétopause et onde de choc, tore d'Io, ceintures de radiation, particules —,
   avec un réglage par élément.
5. **Le partage avec Alex, dans les deux sens** : on lui envoie nos sources et nos tables d'AM0 (champs, ovales,
   empreintes) ; on lit les siennes, et on reprend ce qu'il fait de mieux (après la décision de Sam, comme toujours).

## 7. Ce qu'on reprend du travail d'Alex

Lu le 4 novembre 2026 dans `vr-solar-system`, `origin/master` `dd54164`, sessions 6a à 6a sexies.

**Les fichiers.** Les références `fichier:ligne` ci-dessous valent pour ce commit. Les chemins sont pris sous
`Assets/VRSolar/` :

| Abréviation | Fichier | Contenu |
|---|---|---|
| **MF** | `Scripts/Sim/MagneticFields.cs` | les champs, le traçage, la magnétopause |
| **AV** | `Scripts/UI/AuroraView.cs` | les aurores par corps |
| **AS** | `Shaders/Aurora.shader` | la marche des rayons |
| **AT** | `Scripts/Runtime/AuroraTable.cs` | la table par azimut |
| **LA** | `Scripts/UI/LiveAurora.cs` | la NOAA en direct |
| **MFV** | `Scripts/UI/MagneticFieldView.cs` | le schéma |
| **ML** | `Shaders/MagneticLines.shader` | les lignes du schéma |
| **MP** | `Shaders/MagneticParticles.shader` | les particules |
| **MC** | `Shaders/MagneticCommon.hlsl` | la déformation par le vent solaire |
| **T** | `Tests/EditMode/MagneticFieldsTests.cs` | les tests |

Ses documents sont `docs/research/auroras.md`, `docs/research/magnetospheres.md` et `docs/modules/Magnetism.txt`.

**Les règles de reprise :**
- **Les coefficients** se reprennent depuis leurs fichiers d'origine, qui sont aussi ceux d'Alex : la NOAA pour
  IGRF-14, `jrm33.dat` de libinternalfield pour JRM33, le paquet `con2020` pour le disque. On vérifie leur licence au
  moment d'AM0.
- **Les algorithmes** sont réécrits en TypeScript et en WGSL d'après son code et les articles, avec le crédit à Alex.
  Sam décide de ce qu'on reprend, et on le dit au Claude d'Alex.
- **Ses temps sont mesurés sur un Quest 3**, dans son moteur. Ils indiquent où est le coût, mais ne prédisent pas le
  nôtre. Chaque reprise se mesure chez nous en A/B.

### 7.1 Les champs (AM0)

**Le cœur.**
- Les harmoniques de Schmidt semi-normalisées, en nT, sont évaluées à tout degré par les récurrences usuelles
  (MF:19–149).
- Le repère est fixé au corps : x vers le méridien origine, y vers 90° E, z vers le pôle nord. Les positions sont en
  rayons du corps, avec un centre décalé optionnel.
- **Le piège d'Uranus** : une empreinte se cherche dans l'hémisphère du dipôle, pas dans l'hémisphère géographique
  (MF:472–485). Le pied « nord » d'Uranus tombe au sud de son équateur.

**Les modèles et leurs coefficients**, recopiables tels quels après vérification sur la source :

| Corps | Modèle et coefficients (nT, (n, m, g, h)) | Rayon de référence | Source |
|---|---|---|---|
| Terre | IGRF-14 2025.0, degré 3 : (1,0,−29350,0) (1,1,−1410,3,4545,5) (2,0,−2556,2,0) (2,1,2950,9,−3133,6) (2,2,1648,7,−814,2) (3,0,1360,9,0) (3,1,−2404,2,−56,9) (3,2,1243,8,237,6) (3,3,453,4,−549,6) | 6 371,2 km | fichier NOAA ; MF:300–303 |
| Jupiter | JRM33 au degré 13 (sa troncature recommandée) + CON2020 | 71 492 km | `jrm33.dat` de libinternalfield ; MF:377–401 |
| Saturne | Cassini 11, zonal au degré 3 : g10 21 140,2, g20 1 581,1, g30 2 260,1 | 60 268 km | MF:325. **Nous** : Cassini 11+ (Cao et al. 2020), voir le rapport de recherche § 5.2 |
| Uranus | Q3 : (1,0,11893) (1,1,11579,−15684) (2,0,−6030) (2,1,−12587,6116) (2,2,196,4759) | 25 559 km | MF:336–337 ; dipôle 0,228 G, 58,6° |
| Neptune | O8 : (1,0,9732) (1,1,3220,−9889) (2,0,7448) (2,1,664,11230) (2,2,4499,−70) (3,0,−6592) (3,1,4098,−3669) (3,2,−3581,1791) (3,3,484,−770) | 24 764 km | MF:347–349 ; dipôle 0,142 G, 46,9° |
| Mercure | dipôle axial g10 −190, décalé de 0,196 R vers le nord | 2 439,7 km | Anderson et al. 2011 ; MF:291 |
| Ganymède | g10 −711,5, g11 46,8, h11 22,9 | 2 634,1 km | Kivelson et al. 2002 ; MF:359 |

Les degrés supérieurs d'Uranus et de Neptune sont « de mémoire, non revérifiés » selon Alex. On les reprend sur la
publication.

**CON2020** (MF:161–237), porté du paquet `con2020` (Wilson et al. 2023, forme analytique) :
- **paramètres** : μ0I/2 = 139,6 nT ; disque de 7,8 à 51,4 R_J ; demi-épaisseur D = 3,6 R_J ; incliné de 9,3° vers
  155,8° E ; courant radial I_ρ = 16,7 MA ;
- **forme** : les équations 9a/9b (petit ρ) et 13a/13b (grand ρ) d'Edwards et al. 2001, raccordées par tanh sur 1 R_J ;
  le disque extérieur soustrait ; B_φ = 2,7975·I_ρ/ρ, réduit par |z|/D dans la nappe ;
- **trois vecteurs de référence** (nT, cartésien System III), tirés du README du paquet, à reprendre comme tests
  (Alex les tient à 5 % près, car le README donne le mode hybride) :
  - (5, 10, 6) R_J → (15,584 ; 36,896 ; 63,045) ;
  - r = 10, θ = 30°, φ = 90° → (3,607 ; 13,451 ; 65,342) ;
  - r = 20, θ = 35°, φ = 95° → (1,649 ; 12,438 ; 29,459).
- **Effet mesuré par Alex** :
  - le pied de l'ovale principal, tracé depuis 25 R_J, recule de 2,6 à 6,6° vers l'équateur ;
  - celui d'Io bouge de moins de 0,5°.
  - Avec le dipôle seul, l'ovale est à 11,5° du pôle magnétique.
- **Une limite** (Rabia et al. 2024, rapport de recherche § 5.1) : au-delà d'environ 15 R_J, JRM33 + KK2005 reproduit
  mieux certaines mesures. L'ovale tracé depuis 25 R_J tombe dans cette zone.

**Le traçage** (MF:430–458) :
- un pas RK4 sur la direction unitaire du champ, long de 2 % de r (1 % pour les empreintes), avec au plus 600 pas
  (1 200 pour les empreintes) ;
- arrêt à la surface (interpolée), au-delà de rMax = 4|p| + 4, ou au nombre de pas maximal.
- **En worker** : chez Alex, 128 lignes d'ovale et 576 empreintes coûtaient 16 à 19 ms par image pendant ~10 s sur le
  fil principal. Il les a passées en `Task.Run`, avec un seul échange de références à la fin (AV:586–656). C'est notre
  principe du § 4, confirmé par la mesure.

**Les tests à reprendre** (T), avec leurs tolérances :

| Test | Attendu |
|---|---|
| Dipôle terrestre | inclinaison 9,2–10,2°, pôle −74 à −71° de longitude, 29 000–30 500 nT |
| Jupiter | dipôle 415 000–422 000 nT, inclinaison 9–11°, \|B\| maximal 1,1–2,2 MnT entre 50 et 90° N |
| Inclinaisons | Uranus 57,5–59,5°, Neptune 46–48° |
| Dipôle aligné, L = 4 | pied à ±60° ± 0,3° |
| Terre, L = 7 | pied à 64–70° de latitude magnétique |
| Pieds d'Io | entre 50 et 80° N et S |
| Disque | le pied de 25 R_J recule de plus de 1,5°, celui d'Io de moins de 1° |
| CON2020 | les trois vecteurs ci-dessus |

On y ajoute nos tests prévus : le pôle WMM2025 et les empreintes de Hue et al. 2023, comparées en latitude et longitude.

**Ce qu'on fait autrement :**
- **La surface d'arrêt** est la vraie figure du corps : WGS84 pour la Terre, l'ellipsoïde à 1 bar pour les géantes.
  Alex s'arrête sur la sphère r = 1 de rayon équatorial, puis étire z dans le shader. À ~65° sur Jupiter, la surface
  réelle est ≈ 3 900 km plus bas. Son erreur est estimée à ≲ 1° sur les pieds, pire sur Saturne (estimation, non
  mesurée).
- **IGRF selon la date de la scène**, avec la variation séculaire. Au-delà de 2030, c'est un scénario déclaré (rapport
  de recherche § 2.2). Alex fige 2025.0.
- **Mars** reçoit un champ crustal ; Alex n'en a pas.
- **Ganymède** est tracée dans son dipôle **plus** le champ de Jupiter (~100 nT). Alex la trace dans son dipôle seul.

### 7.2 La Terre : l'ovale et sa vie (AM1)

**L'ovale jour/nuit** (AV:805–826), autour de l'axe du dipôle :
- colatitude magnétique de minuit = 21° + 1,4·Kp ; de midi = 12° + 0,49·Kp ;
- interpolée en ½(1 + cos az), avec az = 0 au minuit magnétique ;
- l'hémisphère sud décalé de +0,5°.
- Notre anneau symétrique à 69° − 1,1·Kp devient donc 69° − 1,4·Kp à minuit et 78° − 0,49·Kp à midi.
- La littérature d'Alex (`auroras.md` § 1.1, Starkov 1994) donne 1,5 à 2° par point de Kp à minuit, et un centre décalé
  de 3 à 5° vers la nuit. Sa loi est dans cette fourchette.
- **Nous** : l'axe vient de notre champ tracé ou d'AACGM, pas du dipôle centré. Le décalage est de quelques degrés selon
  le secteur (estimation).

**Les arcs :**
- trois arcs décalés de {0 ; −1,2 ; +1,6}° (négatif = vers le pôle), de poids {1 ; 0,45 ; 0,5} ; le troisième
  n'apparaît qu'à partir de Kp 5 ;
- les décalages × (1 + 0,1·Kp), les plis × (1 + 0,15·Kp) ;
- les arcs valent 5 kR × 1,5^Kp ;
- la bande diffuse vaut 0,6 kR × 1,5^Kp, en gaussienne de demi-largeur 1,5°, centrée 1,5° plus près de l'équateur ;
- le gain de secteur : minuit 3 fois plus brillant que midi.

**Les plis : cinq ondes en azimut magnétique** (AS:142–149, AV:900–911) :

| Onde | Nombre par tour | Vitesse (rad/s) | Amplitude | Longueur d'onde sur l'ovale terrestre |
|---|---|---|---|---|
| 1 | 6 | 0,011 | 1 | ~2 280 km |
| 2 | 15 | −0,029 | 0,55 | ~910 km |
| 3 | 37 | 0,07 | 0,28 | ~370 km |
| 4 | 157 | −0,4 | 0,12 | ~87 km |
| 5 | 389 | 0,9 | 0,06 | ~35 km |

- Les amplitudes sont multipliées par 0,5° pour la Terre.
- **Les rayons** : `pow(sat(½ + ½ sin(nφ + 3 sin(0,13nφ + 0,05t) + 0,4t + 2,1k)), 3)`, avec n = 900 pour la Terre et
  un mélange de 0,7.
- **Les taches** : `0,35 + 0,65·sat(½ + ½ sin(3φ + …) + 0,35 sin(11φ − …))`.
- Les rayons d'Alex ne dépendent que de l'azimut, donc ils sont radiaux. **Nous** les orientons le long de B :
  l'inclinaison du champ fait ~77° à ces latitudes.

**Le cycle d'orage** (AV:913–928). Le vrai cycle dure 2 à 3 h ; Alex le comprime en 360 s, et son horloge suit
l'accélération du temps jusqu'à ×30 :

| Phase | Part du cycle | Brillance | Avancée du bombement vers le pôle |
|---|---|---|---|
| croissance | 0–0,45 | 1 → 0,7 | 0 |
| déclenchement | 0,45–0,50 | 0,7 → 6 | 0 → 0,3 |
| expansion | 0,50–0,70 | 6 → 3 | 0,3 → 1 |
| retour | 0,70–1,0 | 3 → 1 | 1 → 0 |

- Le bombement s'étend vers le pôle de reach × (4 + 0,5·Kp)°, sur une largeur en azimut de 0,5 à 1,2 rad.
- **Nous ajoutons** la dérive des arcs vers l'équateur pendant la croissance (50 à 300 m/s selon `auroras.md` § 1.2).
  Son commentaire l'annonce, mais son code ne la fait pas (vérifié, AV:913–921).
- Nous ajoutons aussi la « westward travelling surge ».

**STEVE** (AV:932–953, AS:437–462 ; MacDonald et al. 2018, Gillies et al. 2019) :
- Terre seulement, à partir de Kp 4, dans le retour (0,72 à 0,98 du cycle), avec des fondus de 0,04.
- **Position** : un ruban est-ouest à la colatitude de la bande diffuse + 4° (vers l'équateur), centré à 0,52 rad
  (~2 h) avant minuit, en gaussienne de 0,7 rad.
- **Lumière** : 1,5 kR en luminance équivalente de 557,7, couleur (1,17 ; 0,93 ; 1,23), soit un mauve pâle, gris-blanc
  à l'œil. Un premier essai à 4 kR ressemblait à un néon.
- **Profil** : un continuum en exp(−((h − 200)/45)²), soit 150 à 270 km.
- **Palissade** : exp(−((h − 115)/16)²) × pow(sat(½ + ½ sin(1300φ + 2 sin(37φ + 0,02t))), 6) × 0,8 dans le vert de
  557,7, soit des piquets espacés d'environ 15 km.
- **Taches** : 0,65 + 0,35·sin(9φ + …)·sin(23φ − …).
- **Épaisseur** : 20 km, avec un chemin maximal de 400 km.

**L'aurore pulsante** (AV:954–961, AS:212–227) :
- dans le retour (0,7 à 1,0 du cycle), centrée 0,8 rad après minuit, vers l'aube ;
- des cellules d'environ 1,2° (≈ 130 km), déformées à 0,35 ;
- une période de 3 + 12·hash secondes, allumée environ un tiers du temps ;
- elle module la bande diffuse.

### 7.3 Émission, unités, œil, lueur du ciel (AM1–AM2)

**Les raies** (AV:116–122). On reprend la table, qui suit notre principe d'émission de l'air (§ 4). Pour toutes les
raies, 1 R = 7,96·10⁸ photons m⁻² s⁻¹ sr⁻¹ ; la luminance par kR vaut cela × l'énergie du photon × 683 × V(λ), et
Alex a vérifié 557,7, 630 et 427,8.

| Raie | Teinte linéaire | cd/m² par kR | Pic / σ dessous / H dessus / plancher (km) | Poids |
|---|---|---|---|---|
| O 557,7 | (0,18 ; 1 ; 0,32) | 1,9·10⁻⁴ | 110 / 7 / 24 / 80 | 1 |
| O 630,0 | (1 ; 0,04 ; 0,05) | 4,5·10⁻⁵ | 240 / 50 / 90 / 150 | 0,15 × (1 + 0,25·Kp) |
| N₂⁺ 427,8 | (0,40 ; 0,25 ; 1) | 3,4·10⁻⁶ | 104 / 6 / 18 / 80 | 0,3 |
| N₂ 1P | (1 ; 0,12 ; 0,45) | 5,2·10⁻⁶ | 96 / 3 / 7 / 80 | 0,6 × clamp((Kp − 3)/4) |
| H-α 656,3 | (1 ; 0,1 ; 0,12) | 1,18·10⁻⁵ | selon le corps (Jupiter 245/30/120) | 0,55 |
| H₂ (violet) | (0,55 ; 0,30 ; 1) | 4,9·10⁻⁵ | Jupiter 245/30/150 | 0,45 |

**Les profils :**
- une gaussienne sous le pic, une exponentielle au-dessus, une normalisation de colonne 1/(0,886·σ + H) ;
- pour les rideaux, le pic vaut 1 : leur kR est « vu au travers, au pic ».

**Nos différences :**
- les teintes d'Alex sont choisies à la main ; nous les intégrons depuis les longueurs d'onde vers XYZ puis notre RGB
  linéaire (CIE 1931 ; rapport de recherche § 4.4) ;
- son facteur de vision nocturne (×10⁶ sur la luminance, AV:58–61) compense **son** exposition. Nous passons par notre
  exposition commune, sans facteur propre aux aurores.

**L'œil** (AS:472–477) :
- sous une luminance de 0,004 à 0,06 (dans ses unités), la couleur glisse vers le gris-vert des bâtonnets,
  lum·(0,75 ; 1,05 ; 0,95) ;
- en mode « œil », le rouge est multiplié par 0,4.
- `auroras.md` § 1.5–1.6 donne les repères : la couleur apparaît vers 3·10⁻³ cd/m², le vert est coloré à partir de
  IBC II (~10 kR), le rouge à partir de IBC III.
- **Nous** : en cd/m² réels, raccordé à notre exposition. On reprend aussi ses trois rendus :
  - **œil** : notre défaut, décision 1 ;
  - **photo** : saturé, × 8, raccordé à nos photos à plusieurs expositions de PLAN-CIEL ;
  - **toutes longueurs d'onde** : notre AM8.

**La lueur du ciel au limbe** (sa question du 3 novembre). Vue d'orbite, la couche verte de 557,7 nm au limbe fait
l'aspect « vu depuis l'ISS ». Elle vaut ~250 R vers le zénith, 30 à 50 fois plus vue par la tranche.
- Alex l'obtient en ajoutant 0,25 kR partout dans la coquille aurorale, **avec les raies de l'aurore**. Son vert est
  donc à 110 km ; il garde le violet de N₂⁺ et un rouge qui croît avec Kp.
- **Nous** : une couche de lueur du ciel à part, à ajouter en AM1 :
  - O 557,7 nm en couche mince vers ~97 km, ~250 R ;
  - O 630 nm vers ~250 km, 50 à 100 R ;
  - Na 589 nm et OH à chiffrer sur la source avant de les ajouter.
  - Elle est indépendante de Kp. Le gain de la vue par la tranche vient du chemin (van Rhijn).

### 7.4 La météo spatiale en direct (AM1, décision 2)

**Chez Alex** (LA) :
- les fichiers : `products/noaa-planetary-k-index.json` (la dernière valeur de `"Kp":`) et
  `json/ovation_aurora_latest.json` (`[lon 0–359, lat −90..90, probabilité 0–100]` sur 1°) ;
- toutes les 10 min, avec un délai d'attente de 20 à 30 s, et un nouvel essai à 60 s si la carte échoue ;
- la carte est lue hors du fil principal et refusée si elle a moins de 1 000 points ;
- elle s'applique si l'horloge de la scène est à moins de 3 h de maintenant. Le Kp remplace alors le réglage, et
  toucher au réglage coupe le direct.

**La carte vers l'ovale** (AV:1029–1064) :
- tous les 30 s, ou à chaque nouvelle carte ;
- pour chaque hémisphère, 64 azimuts autour de l'axe du dipôle ;
- pour chacun, la colatitude du pic de probabilité entre 4 et 40° (pas de 0,5°), avec un gain clamp(pic/30 ; 0,05 ; 3) ;
- deux lissages [¼ ½ ¼] ;
- en direct, son orage, STEVE et l'aurore pulsante sont coupés.

**Nous ajoutons :**
- le contrôle de l'âge de la carte (son « Forecast Time ») ;
- un schéma de validation, car la NOAA a changé ses formats en 2026 (avis SCN 26-21, rapport de recherche § 4.2) ;
- un lissage qui n'est pas fait en place, car le sien est légèrement asymétrique ;
- la mention que le gain tiré de la probabilité est un choix, pas une conversion en radiance (§ 4.4 du même rapport).

### 7.5 Le rendu et son coût (AM2)

**Les rideaux sont des nappes d'épaisseur nulle**, des surfaces de colatitude magnétique constante (AS:164–169, 412–432) :
- on cherche le changement de signe de g = colat − (ovale + décalage + plis − bombement) entre deux échantillons ;
- on le place par **interpolation linéaire, sans bissection** ;
- la lumière vaut kR × profil(h) × min(1/|n·d| ; chemin max / épaisseur). Pour la Terre, l'épaisseur vaut 2 km et le
  chemin maximal 60 km, soit un plafond de 30×.

Les rideaux restent nets à toute distance avec **12 à 16 échantillons**, contre nos 40 pas.

**Ses leçons de coût sur le Quest :**
- **La bissection était le premier coût**, par la divergence des vagues GPU. C'est notre leçon V5 : une branche jamais
  prise coûtait déjà +9 % sur Apple.
- Une intégrale par pas en erf, ou un pas de *regula falsi*, coûtait 1,6 à 2,8 ms sans gain visible ; il les a retirés.

**La table par azimut** (AT) :
- 2 048 × 2 texels (une ligne par hémisphère) ; xyz contient la colatitude des trois nappes, w celle de l'ovale ;
- remplie au CPU à chaque image ;
- elle remplace 5 sincos, une exp et un lerp par deux lectures : −3,4 ms chez lui.
- **À ne pas faire** : tabuler aussi les profils d'altitude. C'était +2,4 ms, car la latence des lectures dans une
  longue boucle dépasse les calculs économisés.
- **Nous** : la table est remplie par un petit compute ou dans le worker, puis publiée en buffer. On reprend aussi la
  règle : ne tabuler que ce qui est cher.

**Le bruit du pas de marche :**
- son bruit à gradient entrelacé (IGN) dessinait une grille de points sur les plis repliés, ratés entre deux
  échantillons ; un pas constant dessinait des marches en zigzag ;
- avec un bruit blanc, il reste un grain irrégulier.
- **Nous** : A/B entre le bruit blanc et notre bruit bleu (V6, un canal libre), qui devrait battre les deux. Il reste
  le problème des plis serrés croisés deux fois ; il le note comme ouvert.

**L'élimination** (AV:426–433, 861–881 ; AS:302–321) :
- au plus 3 corps : ceux dont le disque dépasse 0,2°, ou dont on est à moins de 4 rayons ;
- de l'intérieur de la coquille, un hémisphère n'est marché que s'il passe au-dessus de l'horizon de la coquille ;
- rien n'est marché de jour ;
- pour chaque rayon, on ne garde que les hémisphères et les taches qu'il peut rencontrer.
- Sa première version marchait tout le ciel depuis le haut des nuages de Jupiter : 200 ms.
- **Nous** : par rayon, la plus courte distance du rayon à la calotte, pas trois points (voir § 7.8).

**Le cache par direction** (AV:487–554, AS:230–245 et 570–596) :
- une carte octaédrique de 1024² (RGBA16F), marchée depuis la position de l'œil, que la composition lit par la
  direction du pixel, avec un test de profondeur ;
- au-delà de 100 km, il n'y a pas de parallaxe : une marche sert aux deux yeux et à toutes les rotations ;
- de l'intérieur de la coquille, **une bande contiguë sur 4 par image** ; de l'extérieur, toute la carte à chaque
  image, car seuls les texels qui touchent la coquille coûtent ;
- toute la carte est refaite à un changement de réglage ou de corps, ou à un saut d'horloge de plus de 60 s.
- **À éviter** : un texel sur 2 × 2. Ça coûtait autant que la carte entière, avec trois lanes sur quatre au repos.

Ses temps sur le Quest 3, vue Tromsø sous Kp 7 (temps GPU) :

| Étape | ms |
|---|---|
| pleine résolution | 109 |
| ⅓ de résolution, bissection | 40,1 |
| sans bissection | 29,8 |
| + la table par azimut | 26,4 |
| ¼ de résolution, 12 échantillons | 21,9 |
| cache par direction | 19,7–20,0 |
| bruit blanc, version finale | 18,6 |
| sans aurore | 15,2 |

Depuis l'ISS, le cache coûte 15,4 ms, la passe à ¼ de résolution 22,0, et sans aurore 9,95.

**Pour nous**, c'est le candidat principal d'AM2. Il colle à « préparer avant la frame » et au socle raster : l'aurore
devient une émission du ciel indexée par direction, composée avec la profondeur finale. **À vérifier chez nous** :
- l'avion sous la coquille (pas de parallaxe, a priori bon) ;
- la traversée de la coquille en fusée (l'invalidation) ;
- l'accord avec notre accumulation temporelle.

### 7.6 Les autres corps : les réglages d'Alex (AM3–AM6)

Ce sont ses points de départ, à confronter aux sources du § 3. On les reprend comme valeurs initiales, pas comme
mesures.

| Corps | Coquille (km) | Raies | Ovale | Valeurs |
|---|---|---|---|---|
| Jupiter | 120–1 100 au-dessus de 1 bar | H-α et H₂ à 245 km, UV à 250 | tracé depuis L = 25 | arcs 80 kR × 1,1^Kp, nappe de 120 km ; bande de 150 kR et 0,45° ; émissions polaires 60·√activité kR jusqu'à 14° (tourbillons, éclats) ; empreintes Io, Europe, Ganymède, Callisto = {3 ; 0,6 ; 1 ; 0,12} × 80 kR, rayon 0,5°, traîne vers l'est sur 30 largeurs |
| Saturne | 250–2 400 | H-α à 600 km, H₂ à 1 100 km | fixe par rapport au Soleil : minuit 16°, midi 13°, 0,5° par Kp, sud +2° | arcs 12 kR, nappe de 150 km ; Encelade 0,004 × 12 kR |
| Uranus | 200–2 000 | H-α à 500 km, H₂ à 900 km | tracé depuis L = 7 | **deux nappes à ±3°**, 1,5 kR chacune, nappe de 400 km (JWST, Tiranti et al. 2026) |
| Neptune | 200–2 000 | idem | tracé depuis L = 9 | 0,8 kR, plis de 1,2° |
| Mars | 40–260 | O 557,7 à 130 km | tache centrée à 50° S, 180° ; colatitude 14 + 4 sin(3az + 1) + 2 sin(7az)° | arcs 0,15 kR × 1,6^Kp ; lueur globale de 0,08 kR à partir de Kp 6 |
| Vénus | 80–220 | O 557,7 à 105 km | aucun | uniforme 0,05 kR |
| Io | 0–1 000 | bleu SO₂ à 30 km, rouge 630 à 250 km (× 0,08), vert (× 0,004) | aucun | deux taches de 300 kR et 22° aux points sub- et anti-jovien ; uniforme 3 kR |
| Europe | 0–600 | UV seulement | aucun | 0,08 kR |
| Ganymède | 0–500 | UV seulement | tracé depuis L = 1,7 | 0,3 kR |

**Nos différences :**
- **L'activité par corps**, pas le Kp de la Terre partout. Chez Alex, Kp pilote aussi Jupiter (1,1^Kp), Saturne, les
  géantes de glace et Mars. Nous prenons pour la Terre son Kp ; pour Jupiter son activité interne et le vent solaire
  propagé (MMESH, rapport de recherche § 5.1) ; ailleurs, le « réglage tempête solaire » d'AM6.
- **Les empreintes avec leur angle d'avance** et leurs taches multiples (MAW, TEB), d'après Hue et al. 2023. Alex trace
  les pieds depuis la position instantanée de la lune.
- **Saturne plus brillante à l'aube**, comme son ovale principal, pas à minuit (estimation physique, à confirmer sur
  la source).
- **La lueur globale de Mars** près de 60 km dans les tempêtes de particules (SEP). Son propre commentaire le dit ;
  son code la met à 130 km.
- **Ganymède et Callisto** : une faible lueur visible en éclipse (§ 3).

### 7.7 Le schéma des magnétosphères (AM7)

**Les lignes** (MFV:211–346) :
- des coquilles fermées à des L par corps : Terre {1,5 ; 2,2 ; 3 ; 4 ; 5,5 ; 7 ; 9} ; Jupiter {1,8 ; 3 ; 5,9 ; 9,4 ;
  15 ; 26 ; 40} ;
- 6, 8 ou 12 longitudes selon la densité, les coquilles impaires décalées d'un demi-pas ;
- les lignes ouvertes en anneaux à 0,25, 0,55 et 0,85 de la calotte asin(√(1/L)) ;
- 72 tubes de flux d'Io à 5,898 R_J ;
- au plus 160 points par ligne, tracés 3 lignes par image ou en worker.

**La déformation par le vent solaire**, dans le vertex shader (MC:18–38) :
- une compression par tanh dans la magnétopause de Shue au-delà de 0,35·r0 ;
- le côté nuit étiré dans la queue ;
- les lignes ouvertes balayées vers la queue.

C'est du schéma, et il faut l'étiqueter comme tel.

**Les frontières :**
- la magnétopause de Shue, r = r0·(2/(1 + cos θ))^α, avec α = 0,58 pour la Terre ;
- l'onde de choc en conique, excentricité 0,81 (Farris 1991) ;
- la distance au nez ∝ p^(−1/6), et p^(−0,22) pour Jupiter (le disque) ;
- p tiré de Kp par 2,5^((Kp − 2)/2).
- **Nous**, selon le rapport de recherche § 5 : Shue avec la pression dynamique et Bz réels pour la Terre ; Rutala et
  al. 2025 (code MIT) pour Jupiter ; Kanani 2010 et Went 2011 pour Saturne ; KTH22 pour Mercure.

**Le tore d'Io** :
- des anneaux à 5,4, 5,9 et 6,4 R_J, et à (5,9 ; ±0,45) et (5,75 ; ±0,25) ;
- sur un axe aux ⅔ entre l'axe de rotation et le dipôle (l'équateur centrifuge).

**Le dessin** (ML) :
- des rubans en pixels à leur vraie profondeur, d'au moins 1,6 px ; en dessous, ils pâlissent au lieu de s'élargir ;
- une couverture analytique, de l'alpha prémultiplié ;
- des couleurs par intensité (log |B| : violet, magenta, orange, jaune pâle) ou par polarité (sortante rouge,
  entrante bleue) ;
- des impulsions qui courent le long des lignes.
- Ça correspond à notre passe de lignes avec profondeur (§ 4).

**Les particules** (MP) :
- 600, 1 500 ou 3 000, sur les lignes fermées rééchantillonnées en 64 points ;
- leur position est analytique, tirée de l'horloge : rebond (3 à 9 s, ×1,6 pour les ions), giration (rayon exagéré,
  ions ×2,5), dérive autour de l'axe du dipôle (70 à 180 s par tour ; électrons d'un côté, ions de l'autre) ;
- électrons cyan, ions orange ; les protons du vent solaire tenus hors de la magnétopause.
- Les formules réelles (gyrofréquence, rayon de giration, rebond de Schulz et Lanzerotti, dérive) et des valeurs
  calculées sont dans son `magnetospheres.md` § 3.
- **Nous** : afficher l'échelle de temps accélérée (rapport de recherche § 5.6), et faire dépendre la période de rebond
  du point miroir, ce qui n'est pas fait chez lui.

### 7.8 Ce qu'on ne reprend pas : défauts relevés dans son code

Marqués « vérifié » quand le code a été relu ici ; les autres sont des déductions de lecture, non testées.

1. **La table d'ovale tracé est décalée d'un demi-casier** (vérifié). `BuildTable` range l'azimut 2π(k + ½)/64 à
   l'indice k, alors que `OvalAt` le lit comme 2πk/64 (AV:692–701, AS:111–115). L'ovale tracé tourne donc de 2,8° sur
   Jupiter, Uranus, Neptune et Ganymède.
2. **Le commentaire et le code de l'ovale terrestre divergent** (vérifié). Le commentaire dit 67°/77° et 1,6° par Kp ;
   le code fait 69 − 1,4·Kp et 78 − 0,49·Kp. La dérive de la phase de croissance n'est pas codée.
3. **Kp pilote tous les corps** (§ 7.6).
4. **La lueur du ciel reprend les raies de l'aurore** (§ 7.3).
5. **Rien n'est dessiné de jour au-dessus du point de vue.** Depuis une orbite basse au-dessus d'une région éclairée,
   l'ovale nocturne visible au loin disparaît (déduction, AV:870).
6. **Le test par rayon ne regarde que trois points du rayon** (début, milieu, fin) : une longue corde rasante peut
   manquer la calotte (déduction, AS:303–308).
7. **La surface d'arrêt est sphérique, l'étirement aplati** (§ 7.1).
8. **Les rayons sont radiaux** (§ 7.2).
9. **IGRF est figé en 2025** ; il manque l'angle d'avance des empreintes (§ 7.6).
10. **L'âge de la carte OVATION n'est pas contrôlé** (§ 7.4).

Ils sont signalés au Claude d'Alex, comme information.

## 8. Sources

- **Le travail d'Alex** : `vr-solar-system`, `origin/master` `dd54164` ; les fichiers du § 7 ; ses notes
  `docs/agent/puffs-bilan-qualite-aurores_2026-11-03-18-27-52.md` (sections de 20:07 à 22:55 UTC).
- **Les sources qu'il cite et qu'on reprend** :
  - Edwards et al. 2001 (CON2020 analytique) et le paquet `con2020` (Wilson et al. 2023) ;
  - libinternalfield (`jrm33.dat`) ;
  - Kivelson et al. 2002 (Ganymède) ;
  - Anderson et al. 2011 (Mercure) ;
  - Starkov 1994 (l'ovale selon Kp) ;
  - MacDonald et al. 2018 (Sci. Adv. 4, eaaq0030) et Gillies et al. 2019 (STEVE et la palissade) ;
  - Tiranti et al. 2026 (GRL, Uranus par JWST) ;
  - Dyudina et al. 2016 (aurore visible de Saturne, arXiv:1506.00664) ;
  - Shue et al. 1998 et Farris 1991 (frontières).

- Terre : [NOAA, wandering geomagnetic poles (WMM2025)](https://www.ncei.noaa.gov/products/wandering-geomagnetic-poles) ;
  [Kyoto WDC, pôles IGRF-14](https://wdc.kugi.kyoto-u.ac.jp/poles/polesexp.html).
- Jupiter :
  - [Connerney et al. 2022, JRM33](https://ui.adsabs.harvard.edu/abs/2022JGRE..12707055C) ;
  - [Hue et al. 2023, empreintes d'Io, d'Europe et de Ganymède (Juno UVS)](https://arxiv.org/pdf/2304.14949) ;
  - [Bonfond et al. 2015, profil vertical de l'émission principale](https://www.ann-geophys.net/33/1211/2015/) ;
  - [Bonfond et al. 2017, Juno UVS](https://orbi.uliege.be/handle/2268/209568) ;
  - [Ingersoll et al. 1998, aurore visible et empreinte d'Io (Galileo)](https://resolver.caltech.edu/CaltechAUTHORS:20130419-133448345) ;
  - [Magnétosphère de Jupiter (synthèse)](https://en.wikipedia.org/wiki/Magnetosphere_of_Jupiter).
- Saturne :
  - [Cao et al., le champ du Grand Finale](https://arxiv.org/pdf/1911.06952) ;
  - [Dyudina et al., aurore visible de Saturne (Cassini)](https://www.arxiv.org/pdf/1506.00664) ;
  - [PIA11681, l'aurore nord en mouvement](https://photojournal.jpl.nasa.gov/catalog/PIA11681) ;
  - [Bader et al. 2019, l'ovale et les oscillations de période](https://eprints.lancs.ac.uk/id/eprint/130948) ;
  - [Melin et al., campagne H₃⁺ et UV](https://eprints.lancs.ac.uk/id/eprint/75818/1/melin_campagin_r3.pdf).
- Uranus et Neptune :
  - [Melin et al. 2025, H₃⁺ et aurores de Neptune (JWST)](https://researchportal.northumbria.ac.uk/en/publications/discovery-of-h3-and-infrared-aurorae-at-neptune-with-jwst/) ;
  - [Eos, l'aurore de Neptune](https://eos.org/articles/after-30-year-search-scientists-finally-find-an-aurora-on-neptune) ;
  - [Uranus en 3D par JWST (Tiranti et al., GRL 2026)](https://www.livescience.com/space/astronomy/james-webb-telescope-spots-giant-auroras-rolling-through-uranus-atmosphere).
- Mars :
  - [Knutsen et al. 2025, première aurore visible depuis le sol (Science Advances)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12077521/) ;
  - [EMM EMUS, aurores discrètes](https://vivo.colorado.edu/display/pubid_329570) ;
  - [reconnexion et aurores discrètes (MAVEN)](https://deepblue.lib.umich.edu/items/136145d2-9ba2-4f0d-8a33-c451f2c135bd).
- Vénus : [Slanger et al. 2001, la raie verte](https://www.sri.com/publication/ocean-space-pubs/discovery-of-the-atomic-oxygen-green-line-in-the-venus-night-airglow/).
- Mercure : [l'aurore X de Mercure (BepiColombo)](https://www.isas.jaxa.jp/en/topics/003540.html) ;
  [Science News](https://www.sciencenews.org/article/rain-electrons-mercury-xray-auroras).
- Lunes :
  - [Geissler et al. 1999, Io en éclipse (Galileo SSI)](https://experts.arizona.edu/en/publications/galileo-imaging-of-atmospheric-emissions-from-io-2/) ;
  - [de Kleer et Brown, l'aurore optique d'Europe](https://authors.library.caltech.edu/records/x4n1j-16c92) ;
  - [Roth et al., Hubble UV d'Io et d'Europe](https://kups.ub.uni-koeln.de/4894) ;
  - [Saur et al. 2015, les ovales de Ganymède et l'océan](https://deepblue.lib.umich.edu/bitstream/2027.42/111157/1/jgra51618.pdf) ;
  - [Greathouse et al. 2022, Juno UVS et Ganymède](https://orbi.uliege.be/bitstream/2268/297297/1/Greathouse%20et%20al.%20-%202022%20-%20UVS%20Observations%20of%20Ganymede%27s%20Aurora%20During%20Juno%20.pdf).
