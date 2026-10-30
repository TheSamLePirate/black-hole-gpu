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

### P7 — Mars — **en grande partie fait**, [P7.md](progress/planetes-aaa/P7.md) (ciné au-dessus du budget de 10–17 % ; tourbillons, givre à venir)
- MOLA / HRSC / CTX en flux ; atmosphère poussiéreuse (ciel ocre, couchers bleus), tourbillons, givre polaire.

### P8 — Les autres corps solides
- Mercure (Messenger), Vénus (relief Magellan sous l'atmosphère épaisse : lumière diffuse orange), Titan (brume,
  **mers de méthane** avec la mer FFT de P2), Europe, Io, Ganymède, Callisto, Encelade, Cérès, Phobos, Deimos.

### P9 — Géantes gazeuses et anneaux
- Bandes animées et tempêtes depuis l'orbite (Jupiter KTX existant), anneaux de Saturne détaillés (ombres, effet
  d'opposition, particules de près).

### P10 — Compensations, campagne, docs
- Optimisations restantes pour tenir « jamais plus lent » partout, campagne e2e complète (ce Mac), `docs/PLANETES.md`
  FR + EN, galerie avant / après.

## 4. Risques

| Risque | Parade |
|---|---|
| P1 touche le chemin terrestre | corps paramétré mais Terre inchangée, A/B Terre à chaque commit |
| Relativité près de Gargantua (Miller à 0,3 c) incompatible avec un raster en ligne droite | rayons quasi droits à l'échelle du sol local ; le traceur garde le lointain, la jonction est vérifiée en e2e |
| Vague ressentie : désaccord CPU / GPU | fonction jumelle, test de tranche WGSL |
| Tuiles NASA lentes ou indisponibles | cache, repli sur la carte globale, zones hors-ligne |
| Budget « jamais plus lent » | P1 libère la marge ; chaque phase mesurée avant le push |
