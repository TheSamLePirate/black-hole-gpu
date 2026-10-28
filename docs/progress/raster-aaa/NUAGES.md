# Nuages AAA — progression

Plan : [PLAN-NUAGES-AAA.md](../../PLAN-NUAGES-AAA.md). M1 Max, Chrome headless, 1600 × 1000, détail high/veryFar, raster ¼.

## N0 — référence (vue figée, rayons neufs à chaque image)

| Scène | tracé ×4 | raster ¼ |
|---|---|---|
| cumulus au-dessus de l'avion (Tarifa, 700 m, « nuageux ») | 18,1 ms · 40,6 dB | 31,3 ms · 38,6 dB |
| cumulus vus de dessus (3 400 m) | 32,0 ms · 47,8 dB | 52,0 ms · 48,2 dB |
| couvert sur les Alpes | 42,9 ms · 39,3 dB | 53,3 ms · 40,9 dB |
| orage (Tarifa, 900 m) | 39,9 ms · 21,9 dB | 101,8 ms · 20,9 dB |

## N1, N1b — la passe de nuages et son historique — fait

- `trace.wgsl clouds` : les nuages le long des rayons marchés une fois par texel de demi-image (un bloc 2 × 2), bornés par la
  surface la plus proche du bloc (visibilité raster) ; sortie : lumière et couverture, distance du nuage, borne, profondeur
  [M]. `earthClouds` factorisé de `earthLook` (identique) ; `CLOUDS_BUFFERED` : `earthLook` prend les nuages du tampon.
- `system/cloud-pass.ts cloudsBuffered` : les pixels (shade, main) lisent les quatre texels autour d'eux, pondérés par la
  ressemblance de leurs bornes (une crête ne donne pas ses nuages au ciel voisin).
- `post.wgsl cloudTemporal` : l'historique propre aux nuages, reprojeté avec **leur** profondeur (la caméra et la dérive de
  la passe temporelle), borné au 3 × 3 courant (lumière prémultipliée, couverture), 15 % de l'image ; recopié comme historique.
- `renderer.cloudPassOn`, `renderer.cloudHistoryOn`, `renderer.cloudPassStats`.
- **Trouvé en route** : l'indicateur de la passe était décidé dans `writeParams` avant que la clé de l'image ait tous ses
  bits — la variante `clouds` jamais trouvée, la passe jamais dessinée ; décidé désormais au moment du dispatch.

Mesure alternée (A, B, A, B — le premier mode de chaque scène mesuré avant la météo prête, écarté) :

| Scène | sans la passe | avec |
|---|---|---|
| cumulus au-dessus | `shade` 19,8 ms | 19,7–21,1 + passe 0,8 ms : pas de gain |
| cumulus vus de dessus | 4,3 + trace 8,5 ms | 2,4–3,4 + 5,2–7,2 + 0,7–1,0 : −2 à −3 ms |
| couvert, Alpes | 8,4 + 7,4 ms | 7,0–7,3 + 6,3–6,5 + 1,6 : ≈ −0,5 ms |
| orage | 21,8 + 7,2 ms | 19,1–19,2 + 5,7–5,8 + 2,0 : ≈ −1,5 ms |

Gain modeste : à l'ombrage ¼, un quart des pixels marchaient déjà leurs nuages, autant que la demi-résolution. Sur vue figée
touchée à chaque image (l'historique ne s'accumule pas), l'image perd 1 à 5 dB (bords adoucis par la demi-résolution). La
valeur de la passe : un historique reprojeté avec la profondeur des nuages (en mouvement), le ciel ombré à la demi-résolution
plutôt qu'à un rayon par bloc 4 × 4, et un budget propre pour la lumière (N2).

En mouvement (virage de 60°, image figée contre la convergée) : sous les cumulus, la passe améliore un peu l'image
(36,5–37,1 dB contre 35,9–36,1) ; au-dessus de la couche, elle la dégrade un peu (41,9–42,2 contre 43,5–43,6 : la
demi-résolution adoucit les sommets qui remplissent l'écran) ; coût égal.

## N2a — la lumière marchée à travers les nuages — fait

- `wxDensity(p, i, cheap)` : la densité d'une couche météo factorisée de `wxCloud` (la version « bon marché » : la couverture
  et une octave de forme — les échantillons de lumière de Nubis, sans le détail fin que l'œil résout).
- `wxLightTau` : la profondeur optique vers le Soleil marchée dans la couche elle-même, 6 échantillons à pas doublés (60 m …
  1,9 km, ≈ 3,8 km), au lieu de la colonne verticale de la couverture : cœurs sombres, flancs à l'ombre, ombre d'une tour sur
  sa voisine. Dans la passe de nuages et le noyau de convergence (la référence) ; les marches par pixel gardent la colonne.
- `TUNE_CLOUD_LIGHT` (0 : la colonne, pour comparer).

Coût de la passe (A/B alterné, lignes valides) : cumulus dessous 0,8 → 2,1 ms, dessus 1,1 → 1,7, couvert 1,8 → 3,9, orage
2,1 → 5,4. Les sommets gagnent leur modelé ; l'ensemble reste gris-beige et plat — l'ambiante constante et les faibles poids de
la diffusion multiple : l'étape suivante (N2b, l'ambiante physique du ciel partagée).

## N2b — l'ambiante physique du ciel, partagée — fait

- Noyau `skyAmbient` (trace.wgsl) : à chaque image, le ciel clair intégré par le modèle de l'air (`earthAir`, le Soleil
  du moment, la météo) sur 64 directions de Fibonacci par hémisphère, à quatre altitudes (0, 2, 5, 10 km), projeté en
  harmoniques sphériques L2 dans le repère local (haut, est, nord) ; 4 groupes de 64, écrits dans une texture 40 × 1 et
  copiés dans la table du traceur (`TABLE_SKY`).
- `skyIrradiance(h, n)` / `skyFlat` / `skyFlatFactor` : l'éclairement du ciel pour une normale et une altitude
  (interpolé entre les niveaux), lu par le sol, la manche à air et les quatre sites de nuages (passe, couches météo, carte,
  cirrus) ; `wxCloud` ajoute la lumière renvoyée par le sol sous les bases. Repli sur l'ancienne constante quand la table
  est vide (orbite, réglage coupé : `renderer.skyAmbientOn`).
- Deux pièges : le pipeline compilé avec les constantes par défaut (toutes les fonctions du trou noir, Kerr compris) ne
  finissait jamais — désormais seules celles de l'air ; et un tampon de stockage de plus dépassait ceux qu'un étage peut
  lier — une texture de stockage à la place. Diagnostic : `tests/e2e/raster-diagnose.e2e.test.ts` (passes, avertissements,
  variantes).

A/B alterné (deuxième paire) : coût dans le bruit (passe de 4 groupes) ; image plus proche de la convergée — Tarifa bas
38,75 → 38,98 dB, sous les cumulus 36,5 → 38,7 dB, Alpes au soir 32,0 → 32,6 dB. Au soir, les ombres de la neige prennent
la teinte chaude du ciel côté Soleil au lieu du bleu constant (bleu −4,5/255, rouge +1,7 en moyenne sur le sol) ; à midi
presque neutre.

## N6a — la mer : hauts-fonds, ressac, reflets — fait

Scènes ajoutées aux tests de vol (`raster-flight`) : `sea-glint` (reflet du Soleil du soir, Atlantique au large de Tarifa),
`sea-coast` (la côte de Tarifa, ses hauts-fonds), `sea-windy`, `sea-overcast`, et des vues de démonstration — `show-porto-fair`
(golfe de Porto, Corse, 17 h Z : le relief, la mer, le Soleil bas — la vue retenue), `show-rock` (le rocher de Gibraltar à
l'aube, reflet et hauts-fonds), `show-strait`, `show-corsica`, `show-musa`, `show-porto`.

- **La profondeur** (`seaDepthAt`) : Terrarium ne porte la bathymétrie (ETOPO1, GEBCO) que jusqu'au niveau z 10 — au-delà,
  SRTM, la mer à 0 (vérifié : −593 m au milieu du détroit à z 10, 0 à z 11–13) ; le relief global la coupe à 0. Lue sur les
  fenêtres z 10, 9, 8 déjà chargées (~120 m le texel), les texels à 0 ou plus écartés (la mer de SRTM, la terre), les niveaux
  mêlés par poids comme `earthH` (sans couture au bord d'une fenêtre). Les eaux intérieures : profondes (leur fond inconnu).
- **La couleur de l'eau** : le fond vu à travers (Beer–Lambert, eau côtière claire : 0,40 / 0,065 / 0,045 m⁻¹ ; chemins
  réfractés, Snell), le sable, la roche et l'herbier en taches ; le bleu profond quand le fond s'enfonce — le turquoise des
  plages de Tarifa.
- **Le ressac** : déferlement limité par la profondeur (γ ≈ 0,78 : sous 1,3 Hs), des bandes d'écume qui arrivent à la
  célérité √(g d) (2√d / (s √g) jusqu'au rivage, la période du système dominant — `seafft[0].w`), la zone interne blanche ;
  leur moyenne là où le pixel ne les résout pas.
- **Les reflets** :
  - le ciel clair réel au loin (`skyMirror` : une grille 8 × 8 de la radiance au niveau de la mer, plus dense à l'horizon,
    cinquième groupe de `skyAmbient`), dans la couleur de la lumière du ciel ici (sous un couvert, son gris) ;
  - le Fresnel moyen sur les pentes non résolues (Bruneton, Neyret & Holzschuch 2010) : la mer rasante n'est plus un miroir,
    plus sombre que le ciel à l'horizon ;
  - la direction réfléchie relevée par la pente moyenne des facettes vues (σ φ(a)/Φ(a)) ;
  - **les reflets en espace écran** (`seaSSR`, noyau `shade` du raster) : 20 pas de 1 m à 8 km projetés dans l'image, contre
    la profondeur raster, bissection, la couleur lue dans l'image en cours (`accum`) là où le raster l'a ombrée (ni le cockpit,
    ni le ciel) ; la facette tirée dans la distribution des pentes non résolues — l'historique en somme le lobe : net par mer
    calme, étiré par vent fort. Les falaises, la côte, les arbres, les montagnes s'y reflètent avec leur parallaxe ; la sonde
    et le ciel au-delà.
- Interrupteurs (`TUNE_GSKIP`) : 512 le ciel physique reflété, 1024 hauts-fonds et ressac, 2048 Fresnel moyen et relèvement,
  4096 les reflets en espace écran ; modes de test `sea`, `nosea`, `norefl`.

A/B alterné (deuxième paire) : coût dans le bruit thermique (+0,7 à +2 ms sur 26–46 ms). Accord avec la convergée — reflets
neufs contre anciens : Porto 35,4 → 37,8 dB, reflet du soir 27,1 → 34,7, vent fort 32,9 → 35,7 ; côte de Tarifa 23,7 → 43,4
(la convergée a les hauts-fonds). Images : `img/vue-porto-soir.jpg`, `img/vue-gibraltar-matin.jpg`,
`img/mer-tarifa-hauts-fonds.jpg`.

Reste pour la mer : l'écume texturée (traînées le long du vent), les reflets des nuages au loin depuis la passe de nuages,
l'ombre des nuages sur l'eau (N3), le sable mouillé au rivage, le bruit du SSR stochastique en mouvement à mesurer.

## N3 — la carte de transmittance des nuages vue du Soleil — fait

- `cloudSigmaAt(p, lod)` : l'extinction des nuages en un point, toutes couches — la couche de la carte comme son volume la
  façonne (`cloudVolume`, sa couverture sans le bruit fin), les trois couches météo (`wxDensity`, bon marché). La première
  densité commune : jusque-là chaque couche avait son ombre à part.
- Noyau `cloudShadow` : une carte orthographique 384² sur ±40 km (~210 m le texel) le long de la lumière, centrée sur le sol
  sous la caméra et calée sur ses texels (pas de scintillement), 40 pas de 300 m à 13 km d'altitude ; chaque texel garde
  (front des nuages le long de la lumière, extinction moyenne, épaisseur optique totale) — une « Beer shadow map »
  (Frostbite, Hillaire 2016) : `T = exp(−min(τ, σ̄ (z_front − z)))`. Son repère dans la table (`TABLE_CSM`) ; lue par
  `cloudShadowAt` (system/cloud-shadow.ts : la transmittance de chacun des quatre texels, puis bilinéaire — pas leurs fronts).
- Une seule source d'ombre :
  - le sol et la mer (`earthGround`) : l'ombre de chaque couche à sa place pour ce Soleil, au lieu des couvertures 2D
    projetées depuis 6 km et du milieu des couches ;
  - le décor (`windsockShade`) : les arbres et les bâtiments à l'ombre d'un nuage, à côté d'autres au soleil (avant : un
    facteur uniforme selon l'altitude) ;
  - l'avion (`keyLight`) : la lumière clé et donc la coque à l'ombre sous un nuage — toutes les couches, météo comprise
    (avant : la seule coquille de la carte) ;
  - **l'air** (`earthAir`, la table de perspective aérienne) : la diffusion simple seulement où le Soleil passe — les rayons
    crépusculaires ; la diffusion multiple laissée au voile des couches. Pas dans l'ambiante du ciel clair (`skyAmbient`).
- Interrupteur `TUNE_GSKIP` 8192, modes `csm`/`nocsm`. Coût : 0,33–0,62 ms (GPU partagé avec un autre agent pendant la
  mesure). Accord avec la convergée : cumulus sur Tarifa 34,5 → 38,8 dB, le détroit à l'aube face au Soleil 21,0 → 23,5 dB
  (le reflet du Soleil coupé par les nuages devant lui, une tache de soleil sur l'eau par une trouée).

## N6b — la mer : écume persistante, sillages, reflets des nuages lointains — fait

- **Écume persistante** (seafft.wgsl, sea/fft-gpu.ts) : un troisième calque par cascade, accumulé d'une image à l'autre
  (`foam = max(foam·e^{−dt/τ}, faite)`, τ 5 / 3 / 1,5 s), faite là où le jacobien de la cascade passe sous son seuil — celui
  de la couverture de Monahan pour ce vent, la bande proportionnelle à son propre écart (une bande fixe la faisait mousser
  partout par vent faible). Le traceur la lit étirée vers l'amont du vent (trois prises) : les traînées que laissent les
  crêtes ; en dentelle étirée sous ~1 m de pied de pixel, sa moyenne au-delà (sans grain).
- **La trace de l'avion sur l'eau** (`seaCraftWake`, `ourWake`) : l'avion volé en premier sillage (longueur négative : un
  appareil ; sa part de poids portée par ses jets vers le bas — le vol stationnaire du F-35B). Le souffle de l'aile descend à
  ε V = 2 C_L V / (π AR) (~14 m/s à 130 m/s, en 1/V) : il touche l'eau derrière (U h / w), une voie ridée que les tourbillons
  élargissent en s'étalant (~1,5 m/s), qui s'efface en ~8 s, des rides qui partent de ses bords ; sous ~1,4 envergure la
  gerbe (queue de coq) ; en stationnaire, un anneau de gerbes en jets radiaux, l'eau blanche au pied du jet, la surface
  ridée, les rides qui courent vers l'extérieur.
- **Les navires** : l'eau aérée de leur sillage turbulent (turquoise pâle, plus durable que l'écume), l'écume en dentelle
  étirée le long de la route.
- **Les nuages lointains reflétés** : le rayon réfléchi rencontré à la hauteur de chaque couche (la carte à 3 km, les couches
  météo à leur milieu), ce point retrouvé dans l'image de la passe de nuages, ses nuages pris s'ils y sont à cette distance
  le long du rayon de la caméra — l'avant-arrière sur le ciel clair ; la sonde voit les nuages depuis l'avion, pas depuis la
  mer à des kilomètres (sa parallaxe fausse au loin). Interrupteur `TUNE_GSKIP` 16384, mode `nocloudrefl`.
- Correctif : `gnoiseI` est signé (±1) — les nouveaux motifs l'avaient pris pour [0, 1] (`noise01`).
- Scènes : `wake-low` (12 m, 130 m/s, vue du nez vers l'arrière, pilote automatique tenant l'altitude), `wake-hover`
  (vue extérieure), `ship-wake` (le Ford à 14 m/s à 1,3 km) ; le harnais laisse désormais une scène choisir sa vue. Vue de
  débogage des sillages : `TUNE_GSKIP` 32768 (écume rouge, ride verte, bulles bleues).

### N6b — la traînée du F-35 à 15 m (test `f35-sea-trail`)

- Le panache du réacteur : son bord, à ~11° plus l'incidence, touche l'eau ~3,7 h derrière la tuyère, sa vitesse sur l'axe
  tombée comme u₀ 6 D / x (~30 m/s à 15 m) — une voie étroite d'embruns arrachés et d'eau brassée, aérée ; au-dessus de ~40 m
  trop faible pour se voir. S'ajoute au souffle de l'aile (plus loin derrière, plus large).
- L'avion pris où il est dessiné (sa sphère dans les axes de la caméra, `ship.shadowBound`) : la vue extérieure n'a plus
  d'écart entre l'œil et l'appareil.
- Test e2e `tests/e2e/f35-sea-trail.e2e.test.ts` : F-35 à 15 m et 150 m/s au-dessus du détroit (horloge arrêtée dix images
  après, à sa hauteur et sa vitesse), vue de passage ; l'image et la vue de débogage des sillages ; vérifie l'état de
  l'avion (> 100 m/s, 5–40 m, pas en stationnaire) et qu'une voie d'eau marquée s'étire dans l'image (> 1500 pixels, > 10 %
  de la largeur) — passé : ~11 000–14 000 pixels sur ~50 % de la largeur.

## N4 — types et formes de nuages — fait

- `wxShape(q, i, hn, w, cheap)` : la densité des couches météo, une seule (avant : copiée dans `wxDensity` et `wxCloud`),
  par type — déduit de la forme de la couche (aucun type n'est donné) : mince et couverte → stratus, stratocumulus,
  nimbostratus (une dalle, la base déchiquetée, le sommet qui ondule) ; épaisse de kilomètres → cumulonimbus (tours sur des
  cellules de ~9 km — un quart du ciel au plus, des trouées —, jusqu'à ~0,85 de la couche, sommets arrondis ; l'enclume en
  haut, plus large, plate, tirée sous le vent par le cisaillement ; le bouclier de pluie bas sous et autour d'elles) ; le
  reste cumulus (dômes, bords rongés par des « billows » — choux-fleurs). Au-dessus de ~7 km : un voile de glace
  (cirrostratus). Évolution lente (le bruit qui monte : une cellule par quart d'heure). Lumière, ombres (N3), passe de
  nuages : la même densité.
- Bruits cuits Perlin-Worley (prévus) : non faits — `noiseTex` n'a qu'un canal de bruit de gradient ; les formes ci-dessus
  s'en servent.
- Scènes : `storm-high` (5,5 km : les tours, leurs flancs, les trouées), `storm-top` (12,5 km).

## N5 — orage, pluie, éclairs, brouillard de vallée, mouillage progressif — fait

- **Rideaux de pluie** (`wxRainShafts`) : sous la couche la plus basse, du sol à sa base, la pluie comme un milieu (~1/km
  d'extinction par forte pluie) — en colonnes sous les tours d'un cumulonimbus, en rideau plus égal sous un nimbostratus —,
  striée par un bruit fin penché sous le vent ; éclairée par le Soleil à travers les nuages (leur carte d'ombres : les rayons
  crépusculaires dans la pluie) et la lumière sous la couche ; fusionnée comme une couche de plus.
- **Arcs-en-ciel** (`rainbowPhase`) : la fonction de phase des gouttes — l'arc primaire à 40,6° (violet) – 42,3° (rouge) de
  l'anti-Soleil, son intérieur plus clair ; le secondaire à 50,3–52,6°, plus pâle, couleurs inversées ; la bande sombre
  d'Alexandre entre eux. Visible là où de la pluie au soleil se trouve à ~42° de l'anti-Soleil (le Soleil derrière, une averse
  devant) ; vue de débogage `TUNE_GSKIP` 262144 (toute la pluie au soleil : les deux arcs entiers — vérifié).
- **La pluie à l'écran** : les traînées radiales en vitesse (un « hyperespace » de lignes) bien plus discrètes — la pluie est
  désormais dans l'air (son voile, ses colonnes, ses arcs).
- **Éclairs** (system/lightning.ts) : des éclairs au hasard (plus fréquents dans le cœur d'un orage : 5–20 s en moyenne), à
  3–25 km, un tiers au sol ; 1 à 4 arcs en retour de 40 ms, le courant continu entre eux. Le traceur : la lueur dans les
  nuages et la pluie (sur ~3 km), la lumière sur le sol, le canal d'un éclair au sol (six segments brisés, cœur et halo),
  atténué par la pluie et les nuages devant lui. `Params.wx[6]`, `wx[7]` (`WX_VEC4S` 6 → 8). `lightning.strike()` pour les
  tests.
- **Tonnerre** (`sound.thunderAt`, `audio.thunder`) : après le vol du son (distance / 343 m/s) — le claquement de près, le
  canal qui roule (une suite de grondements graves sur des secondes), le grondement de fond ; plus doux et plus sourd au loin.
- **Brouillard de vallée** : le sommet du brouillard au-dessus du fond des vallées alentour (le relief le plus bas sur des
  anneaux de 2 à 18 km), non du sol sous la caméra — sur une crête, les vallées noyées de la hauteur de la crête.
- **Mouillage progressif** : le sol trempé en ~5 min de pluie soutenue (plus vite sous une averse), séché en ~30 min après.
- Correctif : `tests/e2e/near-air.e2e.test.ts` (cassé depuis avant cette branche : `AP_N`, `cost`, puis N3) — ses
  substituts complétés ; il passe.
- Scènes : `storm-bolt` + mode `bolt` (un éclair au sol à 2,5 km, tenu à son premier arc), `showers` (averses isolées, Soleil
  bas derrière — l'état météo posé comme le temps réel), `rainbow`, `alps-fog`. Sonde : `tests/e2e/lightning-probe.e2e.test.ts`.

## N7 — les nuages devant les astres et les appareils, des cumulus variés (28 octobre 2026)

Demande : « le soleil est visible derrière les nuages (son halo caché, pas son disque ; la Lune aussi) ; les avions visibles à
travers les nuages ; les nuages : plafond droit, pas assez diversifiés, pas assez réalistes. »

- **Le disque du Soleil, de la Lune, des planètes et les étoiles** (`cloudsDirectT`, `earthLookCompose`, `skyFill`) : ce qui est
  au-delà des nuages était multiplié par leur 1 − α. Or un disque est ~10⁵ fois plus lumineux que le nuage devant lui, et
  1 − α n'y descend jamais assez : la marche s'arrête à 1 %, un cumulus n'a qu'un τ de 5 à 10, la passe de demi-résolution
  mélange ses bords. Le halo (faible) était caché, pas le disque. La lumière directe de ce qui est derrière traverse désormais
  (1 − α)³ (la profondeur optique triplée) : caché derrière un nuage qui paraît opaque, un Soleil pâle derrière un voile mince.
- **Les appareils derrière les nuages** (post.wgsl `occlusion`) : la profondeur d'occultation que testent les appareils, les
  traînées, les panaches, le personnage était celle du sol ou du ciel tracé, sans les nuages. Elle prend désormais la distance
  des nuages de la passe de nuages (après leur historique) là où ils couvrent le pixel à plus de moitié. L'appareil piloté
  n'est pas concerné.
- **Les cumulus** (`wxShape`) : chacun sa croissance (un bruit de 6,4 km : humilis bas et plats à côté de congestus qui montent
  près du haut de la couche, jamais tous coupés à son sommet — le « plafond droit » venait de là), le sommet arrondi par un
  seuil qui monte avec la hauteur (seuls les pics du bruit l'atteignent : dômes bosselés), la base qui ondule de quelques %
  de la couche ; la base des stratus aussi. `wxLayerA` : un ciel épars ou fragmenté en amas et en trouées de dizaines de km,
  la couverture moyenne gardée, un couvert entier. Une première version (le dôme de Nubis, la couverture érodée en sphère)
  donnait des galettes plates vues d'au-dessus : écartée.
- Test `tests/e2e/cloud-occlusion.e2e.test.ts` (raster, cockpit, FPS affichés) : le Soleil visé derrière une couche de
  cumulus à 0,75 (Tarifa, 17 h 30 Z, quatre places) — pixels blancs au centre 44–52 → 0 ; un porte-avions sous un couvert vu
  de 3 km au-dessus (beau temps d'abord : où il est) ; les cumulus d'en dessous, d'au-dessus, au soir, l'orage.

Temps GPU (kerr-mini, 1600 × 1000, même test avant / après) : Soleil 26–29 → 27–30 ms, cumulus dessous 24,9 → 25,4,
dessus 42,5 → 43,7, soir 36,6 → 37,6, orage 53,3 → 55,2 — dans le bruit à +4 % (une lecture de bruit de plus par échantillon
de cumulus). Images : `img/nuages-soleil-avant.jpg` / `-apres`, `img/nuages-navire-avant.jpg` / `-apres` (un navire à
travers le couvert, en bas à droite, avant), `img/nuages-cumulus-avant.jpg` / `-apres`, `img/nuages-dessous-avant.jpg` /
`-apres`.

### N7b — les taches blanches carrées de l'orage (28 octobre 2026)

Dans l'orage, sous la base, des carrés blancs flous dans le ciel ; absents de la référence tracée convergée et sans
l'historique de la passe de nuages (`tests/e2e/storm-blotch.e2e.test.ts`, `STORM_DIAG=1` : la même vue figée, chaque partie
coupée tour à tour, les textures de la passe relues).

- **La cause** : chaque texel, d'une image à l'autre, rencontre soit la base proche et sombre de l'orage, soit — par une
  trouée, la marche clairsemée au loin — le flanc éclairé d'une tour à 60 km (relu : la luminance alterne de 1,6 à 20 ×10⁻⁶,
  la couverture ~1 les deux fois). L'historique moyennait leur lumière mais gardait la distance de l'image en cours (souvent la
  proche) : la lumière lointaine composée comme proche, à travers presque pas d'air — blanche. Sans historique, chaque lumière
  reste avec sa distance ; la référence moyenne les deux vues à travers leur propre air : sombre.
- **Le correctif** (post.wgsl `cloudTemporal`) : la distance du nuage et sa profondeur ont leur historique (`cloudHistB`),
  moyennées comme sa lumière (pondérées par elle). Aussi : l'historique borné par la dispersion du 3 × 3 (moyenne ± 1,25 σ,
  dans ses extrêmes) plutôt que par ses seuls extrêmes ; aucune lumière non finie ni sans couverture prémultipliée ; la couleur
  tenue sous la plus vive des voisines couvertes.
- Images : `img/orage-taches-avant.jpg`, `-apres`, `-reference`.

### Vues de contrôle : coucher de soleil, arc-en-ciel (28 octobre 2026)

`tests/e2e/sky-showcase.e2e.test.ts` (ce Mac, raster, cockpit, FPS affichés, chaque noyau compilé avant la capture) :
- **coucher de soleil** sur le détroit sous des cumulus fragmentés (19 h 05 et 19 h 20 Z, le Soleil à 5,8° et 3,1°, 700 m) : le
  disque caché derrière eux puis vu par une trouée, leurs bords dorés, un rayon de lumière sous la couche — 14 à 23 ms GPU ;
- **averse du soir et arc-en-ciel** (18 h 50 Z, le Soleil à 8,6° derrière, une couche de cumulus bourgeonnants à 2–4,5 km qui
  pleut) : les arcs par morceaux là où un rideau de pluie est au soleil, le rouge dehors, l'intérieur plus clair — 28 à 36 ms.
  Sous un orage à base basse (900 m), le Soleil bas passe dans la couche avant d'atteindre la pluie : elle est à l'ombre, pas
  d'arc — juste ; la vue de débogage (`RAINBOW_DEBUG=1`) montre les deux arcs entiers à leur place.
- Images : `img/vue-sunset-0.jpg`, `vue-sunset-1.jpg`, `vue-rainbow-1.jpg`, `vue-rainbow-3.jpg`.
