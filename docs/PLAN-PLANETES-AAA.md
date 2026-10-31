# Plan — toutes les planètes au niveau de la Terre (AAA, détail maximal, jamais plus lent)

Date : **29 octobre 2026**, sur `main` à `269ae823`.
Statut : **P0 fait** (29 octobre) — budgets, tableau et défauts dans [progress/planetes-aaa/P0.md](progress/planetes-aaa/P0.md). **P1 première partie faite** (30 octobre) — Miller et Mann éclairés sans le Ranger, le raster pour les mondes sans air : [P1.md](progress/planetes-aaa/P1.md).

## 0. La demande

> « La Terre est bien, il faut que les autres planètes soient aussi bien. […] Rends chaque planète parfaite, AAA
> qualité, avec le maximum de détails possibles et best performances. Better sea shader pour la planète avec la
> méga-vague. »

### Décisions (questions du 29 octobre)

| Sujet | Décision |
|---|---|
| Ordre | Gargantua d'abord (Miller, Mann, Edmunds), puis le système solaire |
| Pipeline | **Le raster pour toutes** : le sol triangulé net de la Terre étendu à chaque corps ; le traceur garde l'optique relativiste, l'atmosphère et le lointain |
| Miller | Mer FFT comme sur Terre + **méga-vague ressentie** (hauteur CPU = GPU, front qui déferle, embruns, crash si elle prend le vaisseau) **et** rendu spectaculaire |
| Performance | **Le budget est celui de la Terre aujourd'hui** : aucune planète, dans aucune vue, ne coûte plus que la Terre dans la même vue (mesuré en A/B) ; la Terre elle-même ne ralentit pas |
| Données | Tuiles fines en flux (NASA/USGS) + détail procédural en dessous |
| Vues jugées | Orbite, vol bas et approche, au sol à pied, ciné et voyage |
| Livraison | Seul sur `main`, commit + push + capture par phase, FR + EN |
| e2e | **Ce Mac uniquement** (kerr-mini occupé par un autre agent) |

## 1. Point de départ

- **Terre** : pipeline raster (`system/terrain-raster*.ts`, `terrain-cache.ts`), sa visibilité primaire ombrée par
  `trace.wgsl rasterPrimary`, mer FFT (`sea/fft-gpu.ts`, `shaders/seafft.wgsl`), tuiles IGN/Terrarium, bâtiments,
  forêts, nuages. Le raster n'est autorisé que sur la Terre (`renderer.ts`, `terrainRasterEligible` : `earthSurface`,
  latitude bornée, h < 100 km).
- **Autres corps** : traceur seul. `nearMarch` marche le rayon contre `reliefBase` (blocs × N en temps réel : image
  pixelisée en vol bas), couleur par `planetAlbedo` / `planetShade`.
  - Miller : eau plate + trois trains de crêtes en `pow(sin, 40)` × 1 200 m, **dessinées, pas ressenties**
    (`trace.wgsl reliefBase`, `terrain.ts millerWaves`) ; l'albédo est seulement teinté (pas de Fresnel, pas de vagues
    fines, pas d'écume physique).
  - Mann : fbm + crêtes, albédo neige / glace bleue / roche.
  - Edmunds : plateaux, mesas, dunes.
  - Corps sans air : cratères en 7 tailles (`craterRelief`), cartes globales et HD (`planet-maps.ts`, `hd-maps.ts`),
    LOLA/MOLA déjà là (G4).

## 2. Règles valables pour toutes les phases

1. **Le budget : la Terre d'aujourd'hui.** P0 mesure la Terre à `269ae823` dans chaque vue (orbite, vol bas, à pied,
   ciné) : ce sont les plafonds. Chaque planète est rejouée sur les mêmes vues gelées (`trace-ab`, ±1 %) ; une phase
   où une planète dépasse le plafond de la Terre dans une vue n'est pas poussée tant qu'une optimisation ne l'a pas
   ramenée dessous. Une planète moins chère que la Terre aujourd'hui peut dépenser la différence en détail.
2. **Une seule vérité pour la hauteur.** Tout relief ressenti (contact, train, vague) a sa fonction CPU jumelle
   testée contre la WGSL (tranche de shader, `bun test`).
3. **La Terre ne régresse pas.** Elle reste sur WGS84 et le géoïde (CLAUDE.md) ; la généralisation donne aux autres
   corps leur figure (sphère ou ellipsoïde IAU) sans toucher au chemin terrestre.
4. **Rien n'est supprimé de l'optique** : aberration, décalage, éclipses, réfraction restent dans le traceur.
5. e2e en raster, journalisé, FPS affiché, attente de la compilation du traceur (pas de délai fixe).

## 3. Phases

### P0 — Référence — **fait**, [P0.md](progress/planetes-aaa/P0.md)
- Galerie « avant » : chaque corps × 4 vues (orbite, vol bas 2 km, au sol à pied, plan ciné) — `e2e/planets-baseline`.
- Vues gelées et chiffres GPU (`trace-ab`, `gpuprof`) de **la Terre** dans les 4 vues : le budget à ne jamais
  dépasser, pour toutes les planètes. Les mêmes chiffres par corps : la marge de chacun sous ce budget.
- Inventaire des défauts visibles par corps (tableau dans `docs/progress/planetes-aaa/P0.md`).

### P1 — Raster générique pour tout corps solide (le gros morceau) — **première partie faite**, [P1.md](progress/planetes-aaa/P1.md)
- `terrain-raster-mesh` / `terrain-cache` paramétrés par **le corps** (rayon, figure, `reliefBase` + DEM) au lieu de
  la Terre ; éligibilité par corps dans `renderer.ts`.
- Hauteurs du relief procédural cuites dans le cache (compute pass) : le raster les lit au lieu de marcher.
- `rasterPrimary` ombre avec les matériaux de `planetAlbedo` / `planetShade` (normales du relief cuit, détail fin
  procédural par pixel).
- Ombres : carte d'horizon du relief + ombre solaire raster, comme sur Terre.
- Repli traceur gardé (même gouverneur `rasterFellBack`).
- **Gain attendu** : l'image en vol bas passe de blocs × N à un échantillon par pixel, la marche disparaît → c'est la
  marge qui paiera la qualité des phases suivantes.

### P2 — Miller : la mer — **fait**, [P2.md](progress/planetes-aaa/P2.md)
- Cascades FFT de `seafft` sur Miller (gravité 1,3 g dans la dispersion ; eau « aux genoux » : dispersion en eau peu
  profonde, fond pâle visible à travers l'eau, caustiques).
- Maillage de mer raster, Fresnel, reflet du ciel de Gargantua (disque d'accrétion, lentille), écume par Jacobien
  gardée d'image en image, lumière à travers les crêtes.
- Le traceur garde le lointain (orbite) avec la même mer filtrée.

### P3 — Miller : la méga-vague — **fait**, [P3.md](progress/planetes-aaa/P3.md)
- Nouveau modèle : un **mur solitaire** (profil soliton + lèvre qui déferle) qui remplace les `pow(sin, 40)`, ses
  trains suivant les marées de Gargantua ; hauteur ≈ 1,2 km, CPU = GPU (`terrain.ts`).
- **Ressentie** : l'eau soulève le Ranger posé, le contact suit la surface, la vague qui le prend = crash
  (destruction existante) ; TARS et les annonces préviennent (« ce ne sont pas des montagnes… »).
- **Spectaculaire** : face lisse puis rugueuse, lèvre en déferlement, rideau d'embruns (particules GPU), brume au pied,
  translucidité verte de la crête, grondement spatialisé (audio M6), tremblement caméra.
- e2e « la vague » : posé, la vague arrive, décollage à temps / crash.

### P4 — Mann — **fait**, [P4.md](progress/planetes-aaa/P4.md)
- Glace : glaciers et coulées, crevasses, sastrugis, neige soufflée par le vent, glace bleue translucide.
- **Nuages gelés** du film : bancs de glace suspendus, praticables (contact).
- Ciel froid, lumière rasante, brillance spéculaire de la glace.

### P5 — Edmunds — **fait**, [P5.md](progress/planetes-aaa/P5.md)
- Plateaux, mesas, canyons, dunes vivantes, matériaux roche / sable, ciel et poussière ; site du camp.

### P6 — La Lune — **fait**, [P6.md](progress/planetes-aaa/P6.md) (rochers et traces reportés)
- Tuiles LROC (WAC/NAC) et LOLA en flux ; BRDF de Hapke (pic d'opposition), régolithe au pied, rochers, traces.

### P7 — Mars — **fait**, [P7.md](progress/planetes-aaa/P7.md) (au budget de la Terre ; tourbillons, givre à venir)
- MOLA / HRSC / CTX en flux ; atmosphère poussiéreuse (ciel ocre, couchers bleus), tourbillons, givre polaire.

### P8 — Les autres corps solides
- Mercure (Messenger), Vénus (relief Magellan sous l'atmosphère épaisse : lumière diffuse orange), Titan (brume,
  **mers de méthane** avec la mer FFT de P2), Europe, Io, Ganymède, Callisto, Encelade, Cérès, Phobos, Deimos.
- Décisions (30 octobre) : Titan, puis Vénus, puis les corps sans air ; des tuiles sur le serveur là où un MNT existe
  (Mercure MESSENGER 665 m, Cérès Dawn HAMO, Vénus Magellan 4,6 km) ; Titan et les lunes glacées : leur mosaïque et un
  relief procédural (leurs MNT ne couvrent que des bandes).
- **Titan** :
  - T1 la lumière sous la brume : la diffusion multiple de sa brume (τ ≈ 4), le ciel orange depuis le sol, le disque
    clair depuis l'espace ;
  - T2 ses cartes : la mosaïque ISS de Cassini (4 km, globale) pour la couleur, le radar SAR/HiSAR (351 m) pour le
    détail et le masque de ses mers ;
  - T3 son relief : dunes équatoriales, collines, vallées, marché comme celui de Mars, dessiné par le raster des corps ;
  - T4 ses mers de méthane : Kraken, Ligeia, Punga, les lacs, la mer FFT de P2 (méthane : sombre, vagues de quelques
    centimètres sous un vent faible) ;
  - T5 mesures, e2e, docs.
  - **Fait** (30 octobre) : T1 à T5, T2b (le détail radar en tuiles) et T4b (la mer FFT au méthane) compris —
    [P8.md](progress/planetes-aaa/P8.md).
- **Vénus** :
  - V1 un sol sous les nuages :
    - sa surface solide à son vrai rayon, et non plus le pont de nuages : on s'y pose, on y marche ;
    - son relief par l'altimétrie de Magellan (4,6 km, une carte globale : à cette finesse, des tuiles n'apporteraient
      rien), marché comme celui de Mars ;
    - sa carte de surface tirée de la mosaïque radar de Magellan.
  - V2 ses nuages en couche :
    - entre 48 et 70 km, d'épaisseur optique ~30, très diffusants ;
    - clairs depuis l'espace, une lueur orange depuis le sol, ~2–3 % de la lumière du Soleil en bas ;
    - un CO₂ de 92 bar dessous, qui diffuse cette lumière : l'horizon s'y perd.
  - V3 le détail radar de Magellan (75–225 m) en tuiles d'imagerie, comme celui de Titan.
  - V4 les dalles de basalte des Venera au sol fin ; mesures, e2e, docs.
  - **Fait** (30 octobre) : V1 à V4 — [P8.md](progress/planetes-aaa/P8.md).
- **Les corps sans air** :
  - A1 Mercure : le modèle de MESSENGER (665 m) en carte et en tuiles sur le serveur, le détail de son albédo par sa
    mosaïque à faible incidence (Mercury Trek) ;
  - A2 Cérès : le modèle HAMO de Dawn (137 m) en carte et en tuiles, sa vraie carte (celle du pack était inventée) ;
  - A4 les lunes : leurs cartes vérifiées et recalées sur les mosaïques de l'USGS (Callisto, Pluton, Mimas décalées ;
    Encelade, Rhéa, Phobos, Deimos à vérifier), puis leur relief procédural par type de sol (les rides et le chaos
    d'Europe, les sillons de Ganymède, les plaines volcaniques d'Io, les rayures d'Encelade).
  - **Fait** (30 octobre) : A4 — les sept cartes remises sur les axes du jeu, les cartes fines de Callisto et d'Encelade,
    le sol propre d'Europe, de Ganymède, d'Io et d'Encelade dans leur noyau (`NEAR_KIND 7`) — [P8.md](progress/planetes-aaa/P8.md).
    Au budget de la Terre partout sauf la vue ciné d'Europe (1,9 fois ; 1,5 avant) : une carte d'ombre du Soleil pour les
    corps, en P10.
  - **Fait** (30 octobre) : A1, A2 et l'optimisation de leur relief (A3 ci-dessous dans P8.md : les rayons de ciel, la
    marche des ombres ; Mercure ciné 76 → 43 ms, la Lune ciné 52 → 34) — [P8.md](progress/planetes-aaa/P8.md).

### P9 — Géantes gazeuses et anneaux
- Bandes animées et tempêtes depuis l'orbite (Jupiter KTX existant), anneaux de Saturne détaillés (ombres, effet
  d'opposition, particules de près).
- Décisions (30 octobre) : les vents et une turbulence de près ; le profil fin des anneaux et leurs blocs de glace de
  près ; Jupiter et Saturne d'abord (Uranus et Neptune plus tard : peu de données).
- Étapes :
  - G1 les vents zonaux : chaque bande glisse à sa vitesse mesurée (Jupiter jusqu'à ±150 m/s, Saturne jusqu'à 450 m/s à
    l'équateur), deux cycles fondus (pas d'étirement sans fin) ;
  - G2 la turbulence de près : sous la résolution de la carte, un écoulement procédural qui fait vivre les tourbillons, la
    Grande Tache rouge qui tourne sur elle-même ;
  - G3 le profil fin des anneaux de Saturne (Cassini, ~1 km : annelets, divisions, bords nets) ;
  - G4 leurs sillages et leurs rayons (le côté de l'anneau A plus clair, les spokes de l'anneau B) ;
  - G5 leurs blocs de glace de près, tracés un à un dans une nappe de quelques dizaines de mètres ;
  - G6 les vitrines de Saturne (P0 : Gargantua par le trou de ver, des anneaux par la tranche) et son coût (163 % de la
    Terre en orbite) ;
  - G7 mesures, e2e, docs.
  - **Fait** (30 octobre) : G1 à G5, et les vitrines de G6 — [P9.md](progress/planetes-aaa/P9.md). Le coût de Saturne en
    orbite (59,7 ms, 2,8 fois la Terre : le banc mesurait jusqu'ici une autre scène) : réglé en P10 (21,3 ms).
- **G8 — l'écoulement hybride des géantes** (décidé le 30 octobre ; remplace les tourbillons fBm de G2). Chaque échelle
  reçoit l'outil qui lui convient, et l'aspect reste **une pure fonction du temps** : la même date donne la même image,
  après un saut de date, en partie réseau (horloge commune) et dans l'e2e à un tour d'écart. Une simulation vivante est
  donc écartée comme base : son état dépend de tout le passé et diverge d'un GPU à l'autre.
  - Les trois couches :
    - **grandes échelles** (au-dessus du texel de la carte, ~100 à 200 km) : les vents zonaux de G1, plus des **tourbillons
      nommés analytiques**, placés et réglés sur des mesures — la Grande Tache rouge sur son champ de vitesse mesuré par
      suivi de nuages (Galileo SSI, Hubble OPAL : un anneau rapide à ~150 m/s, un cœur lent), l'Ovale BA, l'hexagone de
      Saturne (onde de Rossby de nombre 6 vers 78° N) et son vortex polaire nord. Une liste courte (quelques dizaines au
      plus) dans les données des corps ou un uniforme, sans nouvelle liaison ;
    - **échelles moyennes et fines** (sous le texel) : une **tuile de turbulence 2D précalculée** en (x, y, t), sur un
      plan β (la rotation qui crée jets et tourbillons), périodique en espace et en temps, sa période égale à
      `GIANT_CYCLE` ou à l'un de ses diviseurs. Elle stocke un **déplacement intégré** (et non une vitesse : pas
      d'étirement ni de pulsation, pas de divergence grâce à une fonction de courant) et un **colorant** qui ajoute un
      contraste réel sous le texel. Cuite sur le GPU au démarrage avec une graine fixe (le précédent : `bakeNoise3d`),
      aucun binaire dans le dépôt (CI Pages : 8 Mo au plus) ; rangée en planche de 16 vignettes de 512 × 256 dans un
      **7ᵉ calque de `mapHi`** (ses 6 calques sont pris : `MAPS_HI`, `planet-maps.ts mapArray`) — aucune liaison de plus,
      aucun palier `maxSampledTexturesPerShaderStage` de plus, ~11 Mo de mémoire GPU avec les mips. Le calque est en
      `rgba8unorm` : 8 bits suffisent pour un déplacement de quelques texels (à vérifier en G8a, sinon le bruit 3D
      allongé en z) ; lu au niveau 0 seulement, car les mips mélangeraient les vignettes ;
    - **renouvellement par échelle** (textures advectées de Neyret) : un cycle à deux phases par échelle, court pour le
      fin, long pour le grand — le détail se renouvelle à son propre rythme, sans étirement, stable en accéléré.
  - Le dosage : l'intensité de la turbulence suit le **cisaillement** de `giantWind` (forte aux flancs des jets, faible au
    cœur des bandes) ; rotation et changement d'échelle de la tuile par bande, pour que sa répétition ne se voie pas ; la
    tuile s'éteint au-dessus du texel (comme le `wd` de G2), et donc jamais depuis l'orbite ; repli sur la lecture sur
    `nrm` aux pôles ; raccord doux entre les tourbillons nommés et la tuile autour d'eux ; mouvement figé au-delà d'un
    facteur de temps où les phases clignoteraient.
  - Étapes :
    - G8a la tuile : simulation 2D vorticité-fonction de courant périodique sur plan β, forçage par jets, intégration du
      déplacement sur la phase, colorant ; test unitaire de déterminisme (même graine, même tuile) et de divergence nulle ;
    - G8b son intégration dans `giantFlow` / `giantAlbedo` à la place des `tfbmF`, multi-échelle, réglée par le
      cisaillement ; un test de tranche WGSL (shader-slice) pour la boucle temporelle sans raccord ;
    - G8c les tourbillons nommés : champ de la Grande Tache réglé sur le profil mesuré, l'Ovale BA, l'hexagone et le
      vortex polaire de Saturne ; leur position suit la dérive mesurée en Système III ;
    - G8d mesures, e2e, docs FR + EN.
  - Critères d'acceptation :
    - **performances** : A/B alterné dans un même Chrome sur kerr-mini contre le commit d'avant G8 (`planets-ab`, deux
      tours) — Jupiter orbite et ciné **au plus au budget de la Terre** (aujourd'hui 21,1 contre 20,7 ms : G8 doit
      ramener Jupiter dessous, la tuile remplaçant 16 `gnoise` par quelques lectures) ; Saturne **pas plus lente**
      qu'avant G8 ; la Terre, la Lune et les autres corps inchangés ; `kernel-budget.test.ts` vert, les noyaux des
      géantes plus petits ; la cuisson au démarrage sous 50 ms, et seulement quand une géante est en vue ;
    - **qualité** : la Grande Tache vue à 25 000 km et une bande vue de près montrent enroulements, filaments et
      instabilités aux flancs des jets, sans motif répété visible, sans étirement ni clignotement ; l'aspect depuis
      l'orbite reste celui de la carte ; captures avant / après dans `progress/planetes-aaa/` ;
    - **justesse** : les vitesses zonales restent celles de G1 (profils de Cassini) ; le sens et la période de rotation
      de la Grande Tache et de l'Ovale BA, la position de l'hexagone suivent les mesures publiées (sources citées dans
      P9.md) ; l'e2e `giants-flow` reste reproductible (deux passes à la même date, écart 0) et ses vues à un tour
      d'écart ne bougent que là où le vent souffle ; même image après un saut de date aller-retour.
  - Hors G8, pour plus tard : des nuages **volumiques** (couches d'ammoniac, de NH₄SH, d'eau) seulement si l'on descend
    dans l'atmosphère d'une géante — la tuile en serait alors le champ porteur ; une simulation vivante globale, relancée
    depuis l'état de la tuile à chaque saut de date, seulement si l'on accepte un jour des géantes non reproductibles.
  - **Fait** (31 octobre) — [P9.md](progress/planetes-aaa/P9.md) : la tuile dans la seconde moitié de la texture de
    bruit 3D (le 7ᵉ calque de `mapHi` est impossible : il est compressé en BC7 ou ASTC), trois échelles, les tourbillons
    nommés, l'hexagone dessiné. Deux défauts de G1–G2 corrigés en chemin : de près, les nuages ne bougeaient pas
    (`otherGround`), et rien ne s'allumait sous le texel de la carte fine. Jupiter 21,2 → 20,5 ms en orbite (la Terre
    20,2), 20,1 → 19,5 de près ; Saturne, la Terre, Mars inchangées ; même date, même image.
- **G9 — le relief des nuages des géantes** (décidé le 31 octobre). Après G8, le mouvement est juste mais l'image reste
  plate : `giantAlbedo` donne une couleur posée sur la figure, `otherGround` l'éclaire par Minnaert (k 0,88) avec la
  normale de la figure (`hdNormal` rend `q` : aucun relief pour les géantes) — depuis P10 l'ellipsoïde à 1 bar
  (`squashOf`, `airPhysicalNormal` : Saturne aplatie de 9,8 %, Jupiter de 6,5 %), plus la sphère. Il manque ce qui fait les images de Juno :
  le relief des sommets de nuages, leurs **ombres au terminateur**, les tours d'orage qui dépassent, la parallaxe en vue
  rasante. Le mouvement, lui, reste en 2D : c'est juste (des vents horizontaux de 100 à 180 m/s contre quelques m/s
  verticaux) ; G9 donne de la hauteur à ce qui bouge déjà.
  - **Les ordres de grandeur, qui fixent où ça se voit** :
    - l'échelle de hauteur vers 1 bar : ~25 km sur Jupiter (165 K, g 24,8), ~50 km sur Saturne (135 K, g 10,4) ; les
      couches : ammoniac vers 0,5–0,7 bar, NH₄SH vers 2 bar, eau vers 5 bar sur Jupiter, plus profondes et sous une brume
      plus épaisse sur Saturne ; les écarts entre zones claires (montantes, plus hautes) et bandes sombres (descendantes,
      plus profondes), et la Grande Tache au-dessus de ses voisines, se comptent en kilomètres à quelques dizaines (les
      valeurs publiées sont reprises et citées en G9a) ;
    - ces hauteurs font 10⁻⁴ à 10⁻³ du rayon : **invisibles à midi depuis l'orbite**, et c'est juste. Mais une ombre a
      pour longueur h / tan(e) : 20 km sous un Soleil à 2° donnent ~570 km d'ombre, lisible depuis 25 000 km. Le relief
      se joue donc au **terminateur** et en **vue rasante** — c'est là, et seulement là, qu'il doit être calculé.
  - **Trois sources de hauteur, chacune à son échelle, toutes advectées comme la couleur** (la hauteur lue au même `uv`
    déplacé que l'albédo : les ombres suivent les nuages, sans « bouillir » d'une phase à l'autre ; même date, même image) :
    - **grande échelle (la carte)** : une carte de hauteur des sommets dérivée d'une mosaïque globale en bande du méthane
      (à 889 nm, les nuages hauts sont clairs), si une telle carte existe avec une licence compatible (Hubble OPAL, à
      vérifier en G9a) ; sinon la luminance de la carte, calibrée sur les écarts publiés entre zones et bandes ;
    - **échelle de la tuile** : la **hauteur géostrophique** — dans un écoulement en équilibre géostrophique, la hauteur
      des surfaces de pression suit la fonction de courant (h = f ψ / g) : les anticyclones sont hauts, les cyclones
      creux, dans les deux hémisphères. La tuile la stocke dans son 4ᵉ canal, aujourd'hui la vorticité, que le shader ne
      lit pas (`giantTileAt` ne prend que `v.xyz`) : **aucune lecture de plus**. Le signe est pris dans le repère de la
      tuile, pour que ses anticyclones soient hauts partout. **Éteinte près de l'équateur** (sous ~±10° de latitude) : f s'y
      annule et l'équilibre géostrophique n'y tient plus — sans cela du bruit, ou une bande plate ;
    - **les tours convectives** (les « pop-up clouds » de JunoCam) : de petits sommets clairs qui dépassent, dans les
      bandes turbulentes, tirés des pics du colorant ; optionnels, gardés seulement s'ils tiennent la comparaison.
  - **L'éclairage** :
    - une normale tirée du gradient de la hauteur (différences finies sur les échelles grande et moyenne, pas la fine),
      qui **incline la normale de l'ellipsoïde** dans `otherGround` (les hauteurs comptées au-dessus de lui, à 1 bar) ;
      Minnaert gardé pour le limbe ;
    - des ombres portées par une marche courte vers le Soleil (3 à 4 pas croissants sur la hauteur advectée), **sur les
      axes écrasés** de la géante (`AIR.ab`, comme son air), puis multipliées par l'ombre des anneaux sur Saturne
      (`ringShadow`, depuis le point, profil de Cassini depuis P10) ;
    - tout ceci **allumé seulement là où ça se voit** : Soleil bas (μ₀ sous ~0,35) ou vue rasante, et empreinte du pixel
      plus petite que l'ombre attendue ; ailleurs le chemin de G8, inchangé. Cette porte **ne ferme pas le terminateur vu
      d'orbite** : à 200 000 km un pixel couvre ~60 km sur Jupiter, une ombre de 20 km sous un Soleil à 2° en fait 570 —
      une bande d'une dizaine de pixels le long du terminateur s'allume aussi depuis l'orbite (voulu : c'est là que le
      relief se lit), son coût compté dans la vue d'orbite ;
    - **la brume du dessus** (approche B de l'analyse) : une nappe haute semi-transparente au-dessus du pont nuageux,
      décalée par la parallaxe en vue rasante, plus épaisse sur Saturne ; elle adoucit le relief au limbe.
  - **Hors G9** : un vrai volume marché (couches d'ammoniac, de NH₄SH, d'eau, comme la passe nuageuse de la Terre), utile
    seulement si l'on descend sous le pont nuageux — aujourd'hui une surface (`otherGround`) : c'est la phase P11.
  - Étapes :
    - G9a les données : les hauteurs publiées (échelles de hauteur, zones et bandes, Grande Tache, pop-up clouds), la
      carte en bande du méthane si elle existe (licence, axes du jeu, Système III), sinon la calibration de la luminance ;
    - G9b la hauteur géostrophique dans la tuile (`giant-tile.ts`), un test de signe (anticyclone haut) et de cohérence
      (ψ et déplacement de la même fenêtre) ;
    - G9c la normale et les ombres dans `otherGround`, leurs portes μ₀ et empreinte. `otherGround` ne sert pas que la vue
      de près : les disques des géantes vus de loin y passent aussi (`earthLookFar`, dans le noyau général et ceux des
      autres mondes). Le code de G9 est donc fermé par la même conjonction que `giantAlbedo` (`NEAR_DETAIL && NEAR_KIND
      != 1, 3, 4, 5, 6, 7`, carte 4 ou 5, horloge qui tourne) et appelé une seule fois ; la Terre ne change pas d'une
      ligne. Les budgets des noyaux sont serrés : en P10, 20 à 90 lignes inlinées de plus ont suffi à dépasser « moon
      main » et « general lut » — `kernel-budget.test.ts` à chaque étape ;
    - G9d la brume du dessus et sa parallaxe ;
    - G9e mesures, e2e, docs FR + EN.
  - Critères d'acceptation :
    - **performances** : A/B alterné sur kerr-mini (deux tours) contre le commit d'avant G9. Jupiter en orbite inchangée
      (±1 % : le relief éteint par ses portes ; si la bande du terminateur entre dans la vue, au plus au budget de la
      Terre, 20,1 ms) ; une **vue de terminateur** nouvelle — le pire cas, toutes les portes ouvertes — au plus au budget
      de la Terre dans la vue équivalente ; Saturne, au budget de la Terre en orbite depuis P10 (21,3 contre 20,1 ms),
      inchangée (±1 %) ; la Terre, la Lune, Mars inchangées ; `kernel-budget.test.ts` vert, la Terre inchangée à la ligne
      près ;
    - **qualité** : au terminateur, à 25 000 et à 5 000 km, des sommets éclairés d'un côté, des ombres longues
      orientées à l'opposé du Soleil, les tours d'orage qui dépassent, la Grande Tache en relief ; comparé côte à côte avec
      des images JunoCam du terminateur (crédit NASA / JPL-Caltech / SwRI / MSSS) dans `progress/planetes-aaa/` ; aucune
      ombre qui saute ou clignote d'une phase à l'autre ; à midi depuis l'orbite, l'image de G8 (pas de relief inventé) ;
    - **justesse** : les hauteurs en kilomètres, aux ordres de grandeur publiés et cités ; un test de tranche WGSL pour
      la longueur d'ombre (h / tan e) et pour le signe géostrophique (anticyclone haut dans les deux hémisphères) ; les
      ombres dans le sens du Soleil réel de la date ; même date, même image (0/255) ; Saturne plus douce que Jupiter
      (échelle de hauteur double, brume plus épaisse) ; le relief posé sur l'ellipsoïde de P10 (la normale géodésique
      inclinée, les cartes planétographiques lues au même `uv` que la hauteur).
  - **Fait en partie** (31 octobre) — [P9.md](progress/planetes-aaa/P9.md) : G9a (les hauteurs publiées ; les zones et
    les bandes tirées des cartes de Hubble OPAL dans la bande du méthane — leurs détails non : d'une autre date que la carte
    couleur), G9b (la hauteur géostrophique dans la tuile, son signe testé), G9c (la pente et les ombres au terminateur).
    Mesures : ±2 % hors du terminateur, ses vues 17,5 et 19,8 ms (la Terre 40). G9d écartée (la brume est déjà dans les
    cartes, des photos). Restent les tours convectives et la comparaison JunoCam.

### P10 — Compensations, campagne, docs
- Optimisations restantes pour tenir « jamais plus lent » partout, campagne e2e complète (ce Mac), `docs/PLANETES.md`
  FR + EN, galerie avant / après.
- La campagne et les docs de P10 couvrent aussi P11 : P11 se fait avant la campagne finale.
- **Saturne — fait** (31 octobre) : sa vue en orbite 58,8 → 21,4 ms (la Terre 20,1), à contre-jour 63,3 → 26,0 — les
  rayons droits dans la région du trou de ver ; Jupiter et Saturne aplaties, au rendu et au vol ; le profil de Cassini à
  toute distance ; ses vues en 2026 — [P10.md](progress/planetes-aaa/P10.md). Ses vues proches des anneaux, intégrées
  parce qu'elles regardent du côté de la bouche : la lentille corrigée par un ajustement aux rayons exacts, 47–73 → 21–40
  ms sur kerr-mini (S4).

### P11 — La descente dans les géantes (décidée le 31 octobre)
Descendre dans Jupiter ou Saturne comme la sonde Galileo : entrer, traverser les couches de nuages, voir les éclairs,
s'enfoncer dans le noir jusqu'à l'écrasement. Après G9, qui en fournit le lointain et les hauteurs.
- **Le constat** : le pont nuageux est une surface (`otherGround`) ; dans `aero.ts`, Jupiter et Saturne **n'ont pas
  d'atmosphère** (seuls Vénus, la Terre, Mars et Titan en ont une) — un vaisseau qui y plonge ne rencontre ni traînée, ni
  échauffement, ni fond. La moitié du travail est donc côté jeu, pas côté rendu.
- **Ce que P10 a posé** :
  - les hauteurs au-dessus des géantes sont sur leur ellipsoïde à 1 bar (`altitudeOver`, `flatteningOf`) : l'air de D1
    s'y branche, pas sur la sphère ; et l'air du traceur (`setAir` : échelles de hauteur 27 et 50 km, le rayon équatorial)
    doit dire la même chose que celui d'`aero.ts` — le même profil des deux côtés, comme pour la Terre ;
  - **Saturne est dans la région de Dneg du trou de ver** (100 ρ, ~5 UA autour de la bouche, 0,7 UA derrière elle) : le
    noyau « dedans » garde le raccourci des rayons droits de P10 (`traceLook`), sinon chaque rayon y refait ~54 pas.
- **Le rendu : la passe nuageuse de la Terre, généralisée** (PLAN-NUAGES N1–N5 : demi-résolution, historique reprojeté
  avec la profondeur des nuages, marche vers le Soleil, ambiante du ciel physique, éclairs ; 0,8 à 3,9 ms mesurés sur la
  Terre), dans un **noyau propre aux géantes « dedans »** (un genre `NEAR_KIND` comme Titan et Vénus) : la Terre ne change
  pas d'une ligne.
  - **Le milieu, sans nouvelle grosse texture** : densité = profil vertical de chaque couche (analytique : ammoniac vers
    0,5–0,7 bar, NH₄SH vers 2 bar, eau vers 5 bar sur Jupiter ; plus profondes sur Saturne — valeurs reprises et citées en
    D0) sous le sommet de G9 × couverture (carte, tuile de G8, colorant) × détail 3D (les bruits Perlin-Worley de la
    première moitié de `noiseTex`, ceux des nuages de la Terre). Tout reste fonction du temps : même date, même volume.
  - **Le proche et le lointain** : le volume marché jusqu'à ~250 km (la portée de la passe de la Terre) ; au-delà — l'horizon
    est à ~1 700 km à 20 km au-dessus du pont —, la surface en relief de G9 vue à travers la brume ; raccord sans couture.
  - **La lumière** : marche vers le Soleil à pas croissants, diffusion multiple en octaves, le ciel de H₂ (Rayleigh) au-dessus
    des ponts ; **l'obscurité qui monte avec la profondeur** selon l'épaisseur optique traversée — juste (Galileo : très peu de
    Soleil à quelques bars) : le spectacle se joue dans les premières couches, les trouées, les ombres des tours sur les
    couches du dessous ; sous Saturne, l'ombre des anneaux (`ringShadow`, depuis le point) et leur lumière (`ringShine`)
    entrent dans la lumière du volume : le jour y est rayé par leurs annelets ;
  - **Les éclairs** dans les tours d'eau (et les éclairs peu profonds observés par Juno), avec le système de N5.
- **Le jeu** :
  - **un air H₂/He dans `aero.ts`**, non isotherme : le profil température–pression mesuré par Galileo (165 K à 1 bar,
    ~420 K vers 22 bar) et les sondages radio pour Saturne ; sa constante (μ ≈ 2,3 g/mol sur Jupiter), son γ ; la traînée,
    l'entrée et l'**échauffement radiatif** (Galileo est entrée à ~47 km/s) ; les **vents** de G1 dans la vitesse relative
    (Galileo les a mesurés croissants en profondeur) ;
  - **l'écrasement**, faute de sol : la coque cède à une pression propre au vaisseau (Galileo a tenu ~22 bar, ~58 min),
    avec la chaleur ; selon les règles de destruction déjà décidées pour l'atmosphère ;
  - **le cockpit et les instruments** : pression et température extérieures, flux thermique, le noir qui monte ; TARS et les
    annonces ; le marcheur reste interdit (« gas ») ;
  - réseau et sauvegardes : rien de neuf (le volume est fonction du temps, l'air une fonction de la position).
- Étapes :
  - D0 les données et références : profils p–T (Galileo, sondages radio de Saturne), niveaux des couches, mesures de lumière
    de la sonde, éclairs (Juno) ; sources citées ;
  - D1 l'air des géantes dans `aero.ts`, les vents, l'échauffement, l'écrasement ; tests unitaires ;
  - D2 le volume dans le noyau des géantes « dedans », son raccord au lointain de G9 ;
  - D3 sa lumière (Soleil, ciel, multiple, obscurité) ;
  - D4 les éclairs ;
  - D5 cockpit, instruments, annonces ;
  - D6 mesures, e2e (dont une entrée rapide), docs FR + EN.
- **En cours** (31 octobre) — [P11.md](progress/planetes-aaa/P11.md) : D0 (les profils de Galileo et de Cassini) et D1a
  (l'air des géantes dans `aero.ts`, l'entrée de Galileo rejouée : 252 g, 228 mesurés) et D1b (cet air donné à Jupiter et
  Saturne, après six groupes de corrections : les hauteurs signées sous 1 bar, « a un sol » plutôt que « a un air », leurs
  vents de G1 au CPU, le rendu inchangé) faits. Restent l'échauffement radiatif et l'écrasement (D1c), D2–D6.
- Critères d'acceptation :
  - **performances** : la vue dans les nuages au plus au budget de la Terre en vol bas dans ses nuages (aujourd'hui ~39 ms
    sur kerr-mini ; Jupiter de près en coûte 19,5 : la marge est là) ; toutes les vues hors de l'air des géantes
    inchangées (±1 %), la Terre inchangée à la ligne près dans ses noyaux ; sous le palier de 25 textures de la passe
    nuageuse, le repli sur la surface de G9, sans erreur ; A/B alterné, deux tours ;
  - **qualité** : la traversée des ponts (le voile d'ammoniac clair, le NH₄SH brun, les tours d'eau), les trouées et leurs
    rayons, les ombres des tours, les éclairs ; **aucune traînée** de l'historique à la vitesse d'entrée (historique qui
    s'efface selon le mouvement) ; aucune couture entre le volume proche et le lointain ;
  - **justesse** : un e2e qui **rejoue l'entrée de Galileo** (vitesse, angle, masse, forme) et retrouve sa décélération
    maximale (~230 g) et sa durée de descente à une tolérance fixée en D0 ; le profil p–T de l'air égal aux mesures ; la
    lumière qui décroît selon l'épaisseur optique ; même date, même image.

## 4. Risques

| Risque | Parade |
|---|---|
| P1 touche le chemin terrestre | corps paramétré mais Terre inchangée, A/B Terre à chaque commit |
| Relativité près de Gargantua (Miller à 0,3 c) incompatible avec un raster en ligne droite | rayons quasi droits à l'échelle du sol local ; le traceur garde le lointain, la jonction est vérifiée en e2e |
| Vague ressentie : désaccord CPU / GPU | fonction jumelle, test de tranche WGSL |
| Tuiles NASA lentes ou indisponibles | cache, repli sur la carte globale, zones hors-ligne |
| Budget « jamais plus lent » | P1 libère la marge ; chaque phase mesurée avant le push |
| G8 : la tuile de turbulence se répète ou dérive de la carte réelle | éteinte au-dessus du texel, tournée par bande, fondu à deux phases (jamais d'advection sans fin) ; e2e à date fixe |
| G9 : un relief inventé ou exagéré (les géantes « en plâtre »), ou des ombres qui bougent avec les phases | hauteurs en km aux ordres publiés, allumées seulement au terminateur et en vue rasante, lues au même uv advecté que la couleur ; comparaison JunoCam |
| P11 : traînées de l'historique à 47 km/s, couture volume / lointain, une descente monotone dans le noir | historique effacé selon le mouvement, e2e d'entrée rapide ; raccord à la surface de G9 ; le spectacle placé dans les premières couches, les trouées et les éclairs |
| G9, P11 : les budgets des noyaux (le code des géantes recopié dans le noyau général et ceux des autres mondes, par `earthLookFar`) | la conjonction de `giantAlbedo`, un appel unique, `kernel-budget.test.ts` à chaque étape |
| P11 : la passe nuageuse généralisée touche la Terre | noyau propre aux géantes « dedans », Terre vérifiée à la ligne près et par A/B |
