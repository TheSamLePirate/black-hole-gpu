# Le système de Gargantua dans le black-hole simulator : étude de faisabilité et plan

**26 septembre 2026 · v4 (toutes les décisions intégrées) · Sources : `SYSTEME.md`, `results.json` et le code de `black-hole-gpu` (commit `39fd55d`)**

Pendant cette étude, je n'ai rien modifié dans `black-hole-gpu` et je n'ai lancé aucun serveur. J'ai calculé les ordres de grandeur avec des scripts Python jetables, en reprenant les formules de `calculations.py`. **Le plan n'est pas commencé.**

---

## Décisions (v4)

| Sujet | Décision | Conséquence |
|---|---|---|
| Masse de Gargantua | **10⁸ M☉**, a* = 0,998 (rapport) | 1 M = 0,987 UA = 492,55 s ; 1 g = 1,61 × 10⁻⁵ c²/M |
| Miller | **x = 10** (rapport, base), **gravité 1,3 g** (film) | uᵗ = 1,1809 : 1 h sur Miller = 1 h 10 min 51 s lointaines. R = 1,3 R⊕, ≈ 2,2 M⊕ à densité terrestre ; marée toujours 0,58 % de g. Disque tronqué en dedans de l'orbite |
| Mann | x = 40 (rapport, inchangé), 1 g | uᵗ = 1,0394 |
| Bouche du trou de ver | **r = 300 M**, orbite circulaire prograde | Période 0,51 an ; 0,058 c ; Gargantua à 1,7° en sortant du col |
| Col | **Agrandi pour être visible de loin : ρ = 0,05 M ≈ 7,4 millions de km ≈ 10,6 R☉** (§2.5) | Marées survivables pendant la traversée, col tracé directement par le traceur. Vu depuis Miller ou Mann, c'est un point aussi brillant que Jupiter si on ajoute le Soleil côté « notre univers » |
| Étoile d'Edmunds | **Naine K2 à 2 000 UA** (§2.2) | Edmunds à 0,59 UA ; Gargantua fait 15′ dans le ciel d'Edmunds (une demi-Lune) ; voyage de 2 ans au lieu de 23 |
| Moteurs | **Les deux** : « Équipage » (≤ 3 g) et « Cinéma » (moteur hypothétique) | Un planificateur à poussée finie devient nécessaire |
| Atterrissage | **Oui, sur les trois planètes** | Il faut une physique locale de surface, du terrain, des atmosphères et un HUD d'atterrissage |
| Rentrée atmosphérique | **Traînée physique et échauffement visuel** maintenant ; **vrai modèle thermique ensuite** (phase 10) | Le modèle thermique arrive après la mission complète |
| Carburant | **Jauge optionnelle** pour le moteur Équipage (désactivée par défaut) | Équation de fusée relativiste, vitesse d'éjection et masses réglables ; les planificateurs vérifient le budget quand elle est active (phase 4) |
| Saturne | **Oui** : Saturne, ses anneaux et le Soleil de notre côté ; **la mission part près de Saturne** | Phase 8, avant la mission ; des corps et une gravité newtonienne sont à ajouter du côté « notre univers » (§3.9) |
| Proportions du col | **Celles du film** : W = 0,05 ρ, cylindre intérieur 2a = 0,01 ρ | Les valeurs du §2.5 sont définitives |

---

## 0. Verdict

**C'est faisable, sous la forme d'une nouvelle scène, « Système de Gargantua », avec plusieurs systèmes à créer.** Le moteur existant (géodésiques de Kerr, trou de ver Dneg, étoile massive, Ranger piloté, planificateur, light probe) est solide et réutilisable. Les difficultés viennent des échelles et de la durée des vols.

- Le simulateur vit aujourd'hui entre 1 M et environ 500 M. La scène va de **4 × 10⁻⁵ M** (une planète) à **≈ 2 000 M** (l'étoile d'Edmunds). Au sol, pendant un atterrissage, il faut même une précision de l'ordre du mètre, soit 10⁻¹¹ M.
- Le traceur GPU calcule en float32. À 2 026 M, le pas de représentation vaut **18 000 km**, pour une planète de 6 371 km de rayon.
- Le temps de la scène est un float32 sur le GPU : il avance par sauts de 30 s après 16 ans de temps lointain et de 8 min après 150 ans.
- Le warp est plafonné à 200 M/s et l'intégrateur du vaisseau est limité à 2 M par pas.

Les solutions sont classiques : origine flottante, patch local plat, sources ponctuelles lentillées, temps par époque en float64, pas adaptatif, warp « sur rails ». Elles n'ajoutent aucune approximation physique. Les décisions prises (Miller à x = 10, pas de spin quasi extrême) écartent le seul point infaisable, le « 1 h = 7 ans ».

---

## 1. Ce qui existe, ce qui manque

| Élément | Dans le simulateur aujourd'hui | Ce qu'il faut créer |
|---|---|---|
| Gargantua, Kerr, a* = 0,998 | ✅ spin jusqu'à 0,999 ; ISCO, disque Novikov–Thorne, ombre exacte | `massSolar` fixé à 10⁸ dans la scène |
| Disque d'accrétion | ✅ | Disque tronqué à ≈ 7–8 M (les presets actuels vont à 18 M, donc Miller serait *dans* le disque) ; température « anémique » à valider (§3.5) |
| Trou de ver | ✅ Dneg complet, deux univers, traversée pilotable | Bouche **statique** aujourd'hui (`wormhole.ts: mouth()`), col de 0,2 à 20 M dans le panneau. Il faut une bouche **en orbite** à 300 M (0,058 c), un boost de Lorentz au collage et ρ = 0,05 M (étendre la plage de `whRho`). Plus le **Soleil et Saturne** du côté « notre univers », avec leur gravité pour le vaisseau (§3.9) |
| Étoile d'Edmunds | ✅ une « étoile compagnon » | Une seule étoile, **codée en dur** (67 occurrences de `"star"`, `P.star*` dans le shader), orbite ≤ 400 M. À généraliser dans un registre de corps |
| Miller, Mann, Edmunds | ❌ | Orbites, rendu à trois niveaux, éclairage, gravité, cibles, **surfaces, atterrissage** |
| Hiérarchie étoile → Edmunds | ❌ | Éphémérides imbriquées |
| Ranger | ✅ géodésique de Kerr en float64, poussée, SAS, tenues, autopilotes, HUD | Une seule lentille gravitationnelle ; pas ≤ 2 M ; warp ≤ 200 M/s ; pas de physique au sol |
| Planificateur | ✅ Hohmann, alignement de plan, rendez-vous, interception de bouche (impulsifs) | Buts génériques par corps, cible mobile, **poussée finie** (moteur Équipage), approche et atterrissage |
| Carte et HUD | ✅ | Carte multi-échelle, sphères d'influence, horloge Terre, **HUD d'atterrissage** |
| Mission automatique | ✅ trou de ver → orbite → étoile | Nouvelle mission : trou de ver → Miller (atterrissage) → Mann → Edmunds (atterrissage) |

Briques réutilisées sans changement : l'aiming d'images lentillées (`targeting.ts`), le light probe tracé du Ranger, le rendu rastérisé en patch local (le Ranger), les empreintes de rayons des sources ponctuelles, le champ faible d'une masse en mouvement (`starForce`), le planificateur par tir et le réalisateur de caméra de `mission.ts`.

---

## 2. Le système retenu, en unités du simulateur

Unités G = c = M = 1 avec M = 10⁸ M☉ : **1 M = 0,98706 UA = 1,4766 × 10¹¹ m**, **1 M de temps = 492,55 s**, **1 c²/M = 6,09 × 10⁵ m/s² ≈ 62 000 g**.

### 2.1 Objets

| Objet | Position | Rayon (M) | Période lointaine | Wall-clock par tour à ×6 M/s | à ×200 M/s | uᵗ | Vitesse ZAMO |
|---|---:|---:|---:|---:|---:|---:|---:|
| Gargantua | 0 (horizon 1,063 ; ISCO 1,237) | — | — | — | — | — | — |
| Miller (1,3 g) | r = 10 | 5,6 × 10⁻⁵ (8 280 km) | 205 M = 28,0 h | **34 s** | 1 s | 1,1809 | 0,322 c |
| Mann | r = 40 | 4,3 × 10⁻⁵ | 1 596 M = 9,1 j | 4,4 min | 8 s | 1,0394 | 0,160 c |
| Bouche | **r = 300** | ρ = 0,05 (7,4 × 10⁶ km) ; sphère de collage 0,4 | 32 650 M = 0,51 an | 1,5 h | 2,7 min | ≈ 1,005 | 0,058 c |
| Étoile d'Edmunds (K2) | **r = 2 026 (2 000 UA)** | 3,4 × 10⁻³ | 8,9 ans | 26 h | 48 min | ≈ 1,0007 | 0,022 c |
| Edmunds | 0,59 UA = 0,60 M de l'étoile | 4,3 × 10⁻⁵ | 188 j | — | — | — | — |

### 2.2 L'étoile d'Edmunds rapprochée : **K2 à 2 000 UA retenue**

**Contrainte de stabilité.** L'orbite d'Edmunds doit rester bien à l'intérieur de la sphère de Hill de l'étoile, `R_H = A (m★/3M)^(1/3)`. Le rapport utilise la limite empirique `a ≤ 0,4895 R_H` (Domingos et al. 2006). Je garde une **marge ×2 : `a/R_H ≤ 0,25`**.

**Contrainte d'habitabilité.** Edmunds reçoit l'insolation terrestre, donc `a = √(L★/L☉)` UA.

Une étoile moins massive rapproche sa zone habitable (`a ∝ √L`, qui décroît vite) plus vite que sa sphère de Hill ne rétrécit (`∝ m^(1/3)`). **Une naine orange permet donc de placer l'étoile bien plus près de Gargantua.**

| Étoile | m★, L★ | a (Edmunds) | Distance minimale avec marge ×2 | Exemple retenu | a/R_H | Marée de Gargantua ε | Gargantua vu d'Edmunds | Bouche → étoile |
|---|---|---:|---:|---|---:|---:|---:|---|
| G2 (Soleil, rapport) | 1,0 ; 1,0 | 1 UA | 2 700 UA | 2 700 UA | 0,248 | 1,0 % | 11′ | 2,9 ans, Δv 0,030 c |
| **K2 (recommandée)** | **0,78 ; 0,35** | **0,59 UA** | **1 700 UA** | **2 000 UA** | **0,215** | **0,66 %** | **15′** | **2,0 ans, Δv 0,029 c** |
| K5 | 0,70 ; 0,16 | 0,40 UA | 1 200 UA | 1 500 UA | 0,201 | 0,54 % | 21′ | 1,35 an, Δv 0,028 c |
| M0 | 0,57 ; 0,07 | 0,27 UA | 850 UA | 1 000 UA | 0,214 | 0,65 % | 31′ (une Lune) | 0,82 an, Δv 0,024 c |

`ε = 2 (M/m★)(a/A)³` est le rapport entre la marée de Gargantua et l'attraction de l'étoile sur Edmunds (0,02 % dans le rapport).

**Choix retenu : une naine K2 (≈ 4 900 K, lumière légèrement orangée) à 2 000 UA.**
- La marge de stabilité est de 2,3× sous la limite empirique.
- La perturbation de Gargantua reste inférieure à 1 %.
- Dans le ciel d'Edmunds, Gargantua devient une **ombre d'une demi-Lune entourée de son anneau lentillé**, à côté d'un soleil orange de 0,66°. C'est un vrai plan de cinéma, et il découle des vraies échelles.
- Le trajet depuis la bouche prend 2 ans de temps lointain, soit 12 s de wall-clock à ×10⁴ M/s en warp sur rails.

**Validation obligatoire (phase 0).** On reporte l'intégration newtonienne du rapport (§6 de `SYSTEME.md` : velocity Verlet, invariant de Jacobi, trois pas de temps) dans `bun test` avec la configuration retenue, et on l'étend à 10 000 ans. Cette configuration ne sera annoncée « stable » qu'après ce test.

### 2.3 Tailles apparentes

| Depuis | Gargantua (ombre ≈ 9 M) | Disque (r_ext ≈ 8 M) |
|---|---:|---:|
| Miller (10 M) | plusieurs dizaines de degrés, lentillage extrême | grande partie du ciel (arche lentillée) |
| Mann (40 M) | ≈ 13° | ≈ 23° |
| Bouche (300 M) | **1,7°** | 3,1° |
| Edmunds (2 026 M) | **15′** | 27′ |

Hors approche, les planètes sont des points (Miller vue de Mann : 0,6″).

### 2.4 Voyages (Hohmann newtonien, ordre de grandeur)

Le planificateur réel travaille sur les géodésiques de Kerr.

| Trajet | Δv total | Durée lointaine | Wall-clock à ×200 M/s | Poussée à 3 g (Équipage) |
|---|---:|---:|---:|---:|
| Bouche → Miller | 0,167 c | 35 j | 30 s | 20 j ≈ 3 460 M ≈ 17 orbites de Miller : **spirale** |
| Bouche → Mann | 0,082 c | 40 j | 35 s | 9,4 j |
| Mann → Miller | 0,142 c | 2,2 j | 2 s | 17 j |
| Bouche → étoile d'Edmunds (K2) | 0,029 c | 2,0 ans | 10 min (12 s sur rails) | 3,4 j |

Pour atterrir, le rapport poussée / poids doit dépasser 1. Avec le moteur Équipage à 3 g, il vaut 2,3 sur Miller (1,3 g) et 3 sur Mann et Edmunds. Remonter en orbite basse demande environ 10 km/s depuis Miller et 8 km/s depuis les deux autres. Le vrai coût est le Δv relativiste pour changer d'orbite autour de Gargantua, pas celui de la planète.

**Ce que suppose le moteur Équipage.** Un Δv de 0,167 c impose, par l'équation de la fusée relativiste `m₀/m₁ = exp(atanh(Δv/c) · c/v_e)`, un rapport de masse d'environ 8 pour une fusion très optimiste (v_e ≈ 0,08 c) et de 1,18 pour une fusée à photons. Avec une propulsion chimique, c'est impossible. Le moteur Équipage correspond donc déjà à une propulsion avancée, mais qui accélère à des g survivables. Le HUD le dira. **Décision v4 :** une jauge de masse de réaction, optionnelle (phase 4).

### 2.5 Le col agrandi : ρ = 0,05 M

Métrique Dneg avec les proportions du film : W = 0,05 ρ, d'où une masse de lentille `M_w = W / 1,42953`.

La **marée subie par un observateur au repos** au passage du col vient de la courbure spatiale, `R ≈ r''/r`, avec `r''_max = 4/(π² M_w)`. Pour un vaisseau de 10 m, cela donne `Δa ≈ c² × 10 m × 4 / (π² M_w ρ)`. À 0,058 c, le facteur γ² de la traversée ne compte presque pas.

| ρ | En unités courantes | Marée sur 10 m | Vu depuis Miller ou Mann (≈ 260 M) | Vu à 30 M | Soleil vu à travers, depuis ≈ 260 M* | Précision float32 à 300 M |
|---|---|---:|---:|---:|---:|---|
| 1 km (film) | — | **10¹³ m/s², fatal** | invisible | invisible | mag. +32 | origine flottante obligatoire |
| 0,001 M | 150 000 km | 480 m/s² (≈ 50 g, fatal) | point | 0,23′ | mag. +6 | 33 ulps |
| 0,01 M | 1,5 × 10⁶ km | 4,8 m/s² | point | 2,3′ | mag. +1 | 330 ulps |
| **0,05 M (retenu)** | **7,4 × 10⁶ km, 10,6 R☉** | **0,19 m/s²** | **1,3′, point brillant** | **11,5′** | **mag. −2,5 (comme Jupiter)** | **1 600 ulps : traceur direct** |
| 0,1 M | 1,5 × 10⁷ km | 0,05 m/s² | 2,6′ | 23′ | mag. −4 | 3 300 ulps |

\* Estimation grossière : la bouche « de notre côté » est à 9,5 UA du Soleil (près de Saturne, comme dans le film). La lumière solaire qui entre dans le col ressort de l'autre côté, étalée sur environ 2π sr. Cela suppose qu'on ajoute le Soleil comme source à distance finie de notre côté (§6).

**Pourquoi 0,05 M :**
- la traversée est **survivable** (0,02 g de marée), alors qu'un col d'un km aux proportions du film déchiquetterait le vaisseau ;
- le col est **visible de loin** : point brillant depuis Miller ou Mann, bille lentillée de 11′ à 30 M, énorme en approche finale ;
- la sphère de collage (0,4 M) reste loin de tout (≪ 0,3 × 300 M) et le col est représenté par 1 600 ulps, donc **le traceur actuel le gère directement, sans origine flottante**. La phase 1 s'en trouve simplifiée.

**Coût physique honnête :** la quantité de matière exotique croît avec ρ. Son ordre de grandeur `ρc²/2G` vaut environ 2,5 × 10⁶ M☉ d'énergie négative. C'est aussi hypothétique qu'un col d'un km, simplement plus grand ; le rapport (§8) ne valide ni l'un ni l'autre.

Dans le Dneg, g_tt = −1 : la bouche dévie la lumière (2M_w/b, déjà codé dans `mouthForce`) mais **n'attire pas** les corps lents. C'est cohérent avec la « masse extérieure non spécifiée » du rapport, et la bouche reste une particule test.

---

## 3. Les difficultés et leurs solutions

### 3.1 Échelles et float32 : un rendu à trois niveaux

| r (M) | ulp float32 | À comparer à |
|---:|---:|---|
| 10 (Miller) | 141 km | planète de 8 280 km : 59 ulps |
| 40 (Mann) | 563 km | planète : 11 ulps |
| 300 (bouche) | 4 500 km | col de 7,4 × 10⁶ km : 1 600 ulps, sans difficulté |
| 2 026 (étoile K2) | 18 000 km | étoile de 508 000 km : 29 ulps ; Edmunds : 0,4 ulp |

1. **Loin (sous-pixel) : sources ponctuelles lentillées.** On calcule sur CPU, en float64, les images de chaque corps avec l'aiming de `targeting.ts` : image primaire, image secondaire et grossissement (Jacobien des empreintes). On les dessine comme des points filtrés au pixel. Miller qui passe derrière Gargantua donne tout seul un arc ou un anneau d'Einstein. Un corps lointain vu depuis un rayon qui s'échappe se traite comme une étoile du ciel à distance finie.
2. **Moyen : sphères dans le traceur.** On remplace `P.star` par un **tampon de corps** (≤ 8), avec un **limiteur de pas par distance au corps** et des centres transmis en double-single (`hi + lo`).
3. **Près (approche, orbite basse, sol) : patch local plat** en coordonnées **centrées sur la caméra** (origine flottante), comme le Ranger. Le rayon de courbure à Miller (≈ 1,5 × 10¹² m) est 230 000 fois plus grand que la planète. On compose ce patch sur l'image tracée avec un test de profondeur ; Gargantua lentillé reste en arrière-plan. C'est aussi ce niveau qui porte le terrain et l'atmosphère (§3.8).

Pour le **sous-système d'Edmunds** (à 2 000 M), même principe : l'étoile, Edmunds et le Ranger vivent dans le patch local. Gargantua y agit par un potentiel faible (Φ ≈ 5 × 10⁻⁴), donc une accélération uniforme plus une marée. Gargantua lui-même reste tracé par Kerr : les directions sont précises en float32, seules les positions absolues sont dégradées.

### 3.2 Le temps sur le GPU

`P.time.x` contient le temps absolu en float32. Solution : le CPU garde une époque en float64. Le GPU reçoit l'état de chaque corps à l'instant présent et le retard le long du rayon, qui reste petit. Le flot du disque utilise un temps réduit modulo sa période de répétition. On valide avec la sonde de précision existante.

### 3.3 Intégrer et accélérer le vol sur des années

- **Intégrateur adaptatif Dormand–Prince** en float64 pour le vaisseau. Le pas croît comme r^1,5 loin du trou, ce qui donne environ 200 pas par orbite à toute distance et rend `predict()` rapide.
- **Warp sur rails** jusqu'à 10⁴–10⁵ M/s sans poussée. Il redescend automatiquement près d'un corps, d'un nœud, d'une entrée de sphère d'influence ou de l'atmosphère.
- **Warp physique pendant les poussées longues** (moteur Équipage) : on intègre avec la poussée, sans passer sur les rails, avec un plafond plus bas.
- **Sphères d'influence** : dans le repère de l'étoile ou de la planète, on intègre la gravité du corps et le **tenseur de marée de Kerr** de Gargantua, avec la même expression que le §5.1 du rapport. Sphère de Hill de Miller ≈ 41 000 km (5 R, à 1,3 g) ; de Mann ≈ 127 000 km (20 R).
- **Plusieurs lentilles** : `Lens` devient une liste. La superposition de champs linéarisés reste valide (m ≪ M, Φ_planète ≈ 7 × 10⁻¹⁰).

### 3.4 La bouche à 300 M

- **Orbite circulaire de Kerr** à 0,058 c, période 0,51 an. C'est une particule test, comme dans le rapport.
- **Boost de Lorentz** entre le repère de la bouche et celui du trou à la sphère de collage Kerr ↔ Dneg (aberration et Doppler d'environ 6 %). La physique d'un corps en mouvement existe déjà (`starForce`).
- **Col de 0,05 M** (§2.5) : il est tracé comme aujourd'hui, sans origine flottante ; il suffit d'étendre la plage de `whRho` vers le bas. Depuis Miller ou Mann, il est sous-pixel : il devient alors une source lentillée ponctuelle (phase 2), dont l'éclat vient du ciel de notre univers et du Soleil.
- **Planificateur** : interception d'une cible mobile, en combinant le rendez-vous étoile et l'interception de bouche existants.
- **Côté « notre univers »** : aucun changement ; le voyage commence comme dans la mission actuelle.

### 3.5 Le disque, Miller et l'éclairage

- **Disque tronqué à ≈ 7–8 M**, en dedans de Miller (10 M), ce qui respecte l'hypothèse du rapport : aucun disque dense ne croise les orbites.
- **Luminosité** : la contrainte la plus forte vient maintenant d'Edmunds, plus proche. Pour que le disque ajoute moins de 5 % à l'insolation d'Edmunds, sa luminosité **vue depuis l'équateur** doit rester sous environ **2 × 10⁵ L☉**.
  - Un disque mince vu par la tranche rayonne peu dans son plan ; il éclaire surtout par ses images lentillées. La contrainte est donc probablement satisfaite, mais **elle se mesure** : le light probe du Ranger (256 × 128 directions tracées, harmoniques sphériques) placé à Edmunds et à Miller donne l'irradiance exacte.
  - On affichera une ligne « irradiance / température d'équilibre » par planète, comme garde-fou d'habitabilité.
- **Éclairage des planètes et du sol** : un probe par planète, recalculé périodiquement, sert à la fois aux sprites, aux sphères et au rendu de surface.

### 3.6 Les deux moteurs

La trajectoire reste exacte dans les deux cas (accélération propre le long d'une géodésique). Seule la performance du moteur change, et le HUD l'affiche clairement.

| | **Équipage** | **Cinéma** |
|---|---|---|
| Accélération | 0,1–3 g (réglable) | 100–2 000 g, avec le libellé « moteur hypothétique, g-load non survivable » |
| Nature des poussées | Longues : 20 jours pour quitter la bouche vers Miller, en spirale | Quasi impulsives |
| Planificateur | **Nouveau, à poussée finie** (§4) | Planificateur actuel (impulsif) |
| Atterrissage | Oui (T/W jusqu'à 3) | Oui |
| Usage | Jeu sérieux, réalisme complet | Mission automatique, vidéos, exploration rapide |

Le planificateur à poussée finie reste volontairement borné. Il couvre :
- les spirales de montée et de descente autour de Gargantua (loi tangentielle, puis correction finale par tir sur la géodésique poussée) ;
- les changements de plan étalés ;
- la mise en orbite d'une planète ou de l'étoile ;
- la descente propulsée.

Il ne cherche pas l'optimum global : il vise une loi de guidage simple qui converge.

### 3.7 Temps : ce que Miller donnera

À x = 10, **1 h sur Miller correspond à 1 h 10 min 51 s lointaines**. Un tour de Miller dure 23,75 h propres pour 28,04 h lointaines. L'effet reste réel et affichable : un séjour de 3 jours sur Miller coûte 13 h de temps Terre. Il est bien plus modeste que dans le film, ce que les infobulles de la scène expliqueront. Le spin quasi extrême reste hors de portée du traceur : l'horizon, l'ISCO et Miller se confondent en float32 comme en float64.

### 3.8 Atterrissage : les systèmes nouveaux

**Repère et physique locale**
- Dans la sphère d'influence d'une planète, le vaisseau est intégré dans le **repère de la planète**, qui est en chute libre autour de Gargantua. Les forces sont :
  - la gravité de la planète (Newton : **1,3 g sur Miller**, 1 g sur Mann et Edmunds ; bourrelet de marée en option J₂) ;
  - le **tenseur de marée de Kerr** (Miller : 0,057 m/s² en surface dans `results.json` pour R⊕, soit 0,075 m/s² pour R = 1,3 R⊕ ; toujours 0,58 % de g, puisque la densité est la même) ;
  - la **rotation synchrone** de Miller et Mann (période = orbite en temps propre), avec forces de Coriolis et centrifuge ;
  - la **traînée atmosphérique** (atmosphère exponentielle).
- Au sol, le vaisseau est posé : contact des patins, frottement, puis le vaisseau fait corps avec la planète. Il y reste jusqu'à ce que la poussée dépasse le poids.
- **Horloges** : au sol, τ suit l'orbite de la planète (uᵗ) ; le potentiel propre de la planète, 7 × 10⁻¹⁰, est négligeable. L'**horloge Terre** défile pendant qu'on marche sur Miller.
- **Ciel vu du sol** : la caméra prend la 4-vitesse de la planète. Sur Miller (0,32 c par rapport au ZAMO), Gargantua et le ciel sont **fortement aberrés et décalés en fréquence**. Le traceur le fait déjà ; c'est un argument physique et visuel fort.

**Terrain et atmosphère** (dans le patch local, en coordonnées centrées caméra)
- Terrain procédural en **cube-sphère à niveaux de détail** (quadtree), du planétaire au mètre.
  - **Miller** : océan peu profond (le film montre de l'eau jusqu'aux genoux) sur un fond plat, bourrelet de marée statique, **vagues géantes** (§6).
  - **Mann** : glace, reliefs, « nuages gelés ».
  - **Edmunds** : roche et désert, lumière orangée de la K2, Gargantua dans le ciel.
- **Diffusion atmosphérique** (Rayleigh / Mie) éclairée par le probe : le disque lentillé pour Miller et Mann, l'étoile pour Edmunds. Le fond tracé est atténué par la transmittance de l'atmosphère le long du rayon.
- **Rentrée (décision v3)** :
  - *maintenant* : traînée physique (atmosphère exponentielle, coefficient de traînée selon l'attitude) et échauffement **visuel**. La lueur de plasma est pilotée par un indicateur physique simple, `ρ_atm v³`, mais sans conséquence sur le vaisseau ;
  - *ensuite* (phase 10) : un vrai modèle thermique, décrit au §5.

**Pilotage**
- HUD d'atterrissage : altitude radar, vitesse verticale et horizontale par rapport au sol, attitude par rapport à l'horizon local, marge poussée / poids, carburant si on l'ajoute.
- Autopilotes : **descente propulsée** (« suicide burn » puis vol stationnaire), **atterrissage assisté** et **décollage vers l'orbite**, dans le même style que les autopilotes existants (orientation, puis poussée, puis RCS).

### 3.9 Notre côté : le Soleil et Saturne

Aujourd'hui, notre univers ne contient que la métrique Dneg (suivie jusqu'à r = 100 ρ, puis ligne droite) et le ciel à l'infini. Il n'y a pas de gravité.

- **Placement proposé** : la bouche est sur une orbite héliocentrique voisine de celle de Saturne (9,5 UA du Soleil), à **≈ 0,7 UA (10⁸ km) de Saturne**.
  - Le col (Ø 1,5 × 10⁷ km) est **127 fois plus grand que Saturne** (rayon de 58 000 km, anneaux jusqu'à 140 000 km). La composition du film se fait donc par la perspective : vaisseau à environ 10⁶ km de Saturne, qui fait alors ≈ 16° avec ses anneaux, et col derrière, à ≈ 8,5°.
  - Cette orbite n'est pas stable à long terme (seuls les points de Lagrange L4 et L5 le seraient) ; la dérive est négligeable à l'échelle d'une mission. Les infobulles le préciseront.
- **Rendu** :
  - le Soleil est une source à distance finie, en dehors de la région Dneg (9,5 UA > 100 ρ ≈ 4,9 UA) ;
  - Saturne et ses anneaux sont testés dans le **segment Dneg** des rayons, en coordonnées de la bouche. À r ≫ ρ, le Dneg est quasi plat (r ≈ ℓ), et la précision y est bonne ;
  - de près, Saturne passe par le patch local, avec l'ombre de la planète sur les anneaux et les anneaux éclairés par le Soleil.
- **Gravité** : on ajoute le champ newtonien du Soleil et de Saturne pour le vaisseau de notre côté. Il n'agit pas sur la lumière : la déviation par Saturne est de l'ordre de 10⁻⁸ rad. La bouche elle-même n'attire toujours pas les corps (Dneg, g_tt = −1).
- **Départ de la mission** : le vaisseau part à environ 10⁶ km de Saturne, file vers le col (0,7 UA : ≈ 1,4 jour de temps propre à 3 g, accélération puis freinage) et le traverse. La suite ne change pas.

---

## 4. Architecture

Tout vit dans de nouveaux modules. Les scènes existantes gardent leur comportement : l'étoile actuelle devient un cas particulier du registre de corps.

| Module | Rôle |
|---|---|
| `src/system/bodies.ts` | Registre : id, parent, **univers** (côté Gargantua ou côté « notre univers » : Soleil, Saturne), type (trou, planète, étoile, bouche), masse, rayon, orbite (Kerr circulaire ou képlérienne autour du parent), phase initiale (rapport : Miller 2,55 rad, Mann 0,72, étoile 3,90, bouche 5,72, Edmunds 2,20), surface, atmosphère |
| `src/system/ephemeris.ts` | Position et vitesse en float64 avec hiérarchie ; horloges τ par corps |
| `src/system/kerr-orbits.ts` + tests | Port de `calculations.py` (Ω, uᵗ, E, ℓ, κ², ν_θ², marées de Kerr, Hill, Roche). **Les tests reproduisent `results.json`** et l'intégration d'Edmunds, adaptée à la nouvelle étoile |
| `geodesic.ts` (étendu) | Plusieurs lentilles, Dormand–Prince, sphères d'influence, rails |
| `src/system/local-frame.ts` | Dynamique dans le repère d'une planète ou de l'étoile : gravité, marée de Kerr, rotation, traînée, contact au sol |
| `renderer.ts` + `trace.wgsl` | Tampon de corps, limiteur de pas, centres en double-single, époque de temps, bouche mobile (boost au collage), distance de coupure pour le compositing |
| `src/system/sprites.ts` | Images lentillées des corps lointains (aiming CPU amorti : un corps par frame, démarrage à chaud) |
| `src/system/planet-local.ts` + `planet.wgsl` | Patch local : terrain LOD, océan, glace, roche, atmosphère, éclairage par probe |
| `src/system/finite-burn.ts` | Planificateur à poussée finie (moteur Équipage) |
| `src/system/reentry.ts` | Traînée et indicateur d'échauffement (phases 6–7), puis modèle thermique et bouclier (phase 10) |
| `src/system/propellant.ts` | Jauge optionnelle : masses sèche et de réaction, vitesse d'éjection, Δv restant `c · tanh((v_e/c) · ln(m/m_sec))` (rapidité additive) ; vérification du budget par les planificateurs |
| `src/system/our-side.ts` | Corps et gravité du côté « notre univers » : Soleil (source à distance finie), Saturne et anneaux (sphère et anneau dans le segment Dneg du rayon, patch local de près), gravité newtonienne du Soleil et de Saturne pour le vaisseau |
| `targeting.ts`, `maneuver.ts` | Cibles par id de corps ; buts « orbite autour de X », « rendez-vous avec une cible mobile », « atterrir sur X » |
| `flighthud.ts` | Carte multi-échelle (rayon ∝ ln(1 + r/M)) avec zoom par corps, altitude relative au corps dominant, horloge Terre, HUD d'atterrissage, sélecteur de moteur |
| `src/system/mission2.ts` | Mission bouche → Miller (atterrissage) → Mann → Edmunds (atterrissage) |

Coût GPU : quelques tests sphère-segment par pas, seulement près d'un corps ; le patch local coûte un rendu d'objet, comme le Ranger. L'aiming et les sprites tournent sur CPU, de façon amortie.

---

## 5. Plan par phases (non commencé)

Chaque phase est livrable seule, avec `bun test`, une capture et un commit.

| # | Phase | Contenu | Résultat visible | Taille | Dépend de |
|---|---|---|---|---|---|
| 0 | **Modèle et validation** | `bodies`, `ephemeris`, `kerr-orbits` ; tests contre `results.json` (Miller recalculée à 1,3 g) ; intégration d'Edmunds sur 10 000 ans autour de la K2 à 2 000 UA ; marée du col de 0,05 M | Rien à l'écran ; configuration validée par les chiffres | S | — |
| 1 | **Temps et corps génériques** | Époque float64 ; tampon de corps dans le traceur ; limiteur de pas ; bouche en orbite à 300 M avec boost, col de 0,05 M ; disque tronqué ; l'étoile actuelle migre **sans régression** (captures avant / après identiques, sonde de précision) | Scène « Système de Gargantua » : Miller, Mann et la bouche en orbite autour de Gargantua | L | 0 |
| 2 | **Points lentillés** | Sprites avec images secondaires ; étoile d'Edmunds comme source à distance finie ; la bouche comme point brillant ; **le Soleil de notre côté** comme source à distance finie, visible à travers le col | Tout le système visible de partout ; anneaux d'Einstein des planètes ; le col comme un « Jupiter » dans le ciel de Miller | M | 1 |
| 3 | **Vol longue distance** | Plusieurs lentilles, Dormand–Prince, rails, sphères d'influence, cibles génériques, carte multi-échelle, horloge Terre | **Piloter partout (moteur Cinéma, planificateur actuel)** | L | 1 |
| 4 | **Deux moteurs** | Sélecteur Équipage / Cinéma ; planificateur à poussée finie (spirales, plan, insertion) ; warp physique pendant les poussées ; **jauge de carburant optionnelle** (fusée relativiste, budget vérifié par les planificateurs) | Voyages crédibles à 3 g, avec un budget de Δv si la jauge est active | M–L | 3 |
| 5 | **Patch local** | Origine flottante ; planètes et étoile près de la caméra ; compositing avec profondeur ; probes d'éclairage par planète ; garde-fou d'irradiance | Approche et orbite basse des trois planètes | L | 1 (2 conseillé) |
| 6 | **Atterrissage** | Repère local (gravité, marée de Kerr, rotation, traînée), contact, HUD d'atterrissage, autopilotes descente / atterrissage / décollage | **Se poser et redécoller** (sur des sphères encore simples) | L | 3, 5 |
| 7 | **Surfaces et atmosphères** | Terrain LOD ; océan et vagues de Miller ; glace de Mann ; Edmunds ; diffusion atmosphérique ; rentrée **visuelle** (plasma piloté par ρ_atm v³) | Plans « film » au sol | L | 5, 6 |
| 8 | **Saturne et notre côté** | Soleil et Saturne (anneaux, ombre de la planète sur les anneaux, éclairage solaire) dans le segment Dneg des rayons ; patch local de près ; gravité du Soleil et de Saturne pour le vaisseau de notre côté ; point de départ de la mission | Le plan iconique du film : Saturne au premier plan, le col derrière | M–L | 2, 5 |
| 9 | **Mission et vidéo** | Mission automatique complète **depuis Saturne** : départ, col, Miller (atterrissage), Mann, Edmunds (atterrissage) ; légendes, réalisateur de caméra, export vidéo | Le film du système | M | 4, 6, 7, 8 |
| 10 | **Modèle thermique de rentrée** | Flux convectif au point d'arrêt (Sutton–Graves, `q ≈ k √(ρ_atm/R_n) v³`) et radiatif aux grandes vitesses ; bouclier ablatif (masse, épaisseur, température de paroi, marge) ; limites de g et de flux ; corridor de rentrée dans le planificateur et le HUD | La rentrée devient un vrai défi de pilotage | M | 6, 7 |

Jalons :
- **après la phase 3**, tu pilotes dans tout le système (demande initiale remplie) ;
- **après la 6**, tu atterris ;
- **après la 7**, c'est beau au sol ;
- **après la 8**, Saturne et le départ du film sont en place ;
- **après la 9**, la mission est filmée ;
- **la 10** rend la rentrée réaliste.

Les phases 4 et 5 sont indépendantes l'une de l'autre et peuvent se faire dans n'importe quel ordre.

---

## 6. Améliorations cinématiques qui gardent la physique correcte

1. **Sortie du col face à Gargantua** : bouche à 300 M, donc Gargantua fait 1,7° et le disque 3,1°. On cale la phase de la bouche pour que Miller passe en même temps derrière Gargantua : l'arc lentillé apparaît tout seul.
2. **Le col comme repère dans le ciel** : avec ρ = 0,05 M et le Soleil de notre côté, la bouche brille comme Jupiter depuis Miller ou Mann. C'est le « chemin du retour » visible, avec son grossissement lentillé quand elle passe près de Gargantua.
3. **Saturne à travers le col** (phase 8) : vue depuis le côté Gargantua, la sphère montre Saturne et ses anneaux, déformés par la lentille, et un Soleil ponctuel.
4. **L'arche du film vue de Miller** : avec le disque tronqué à 7–8 M, vu par la tranche depuis Miller, ses images lentillées forment l'arche au-dessus et au-dessous de l'ombre. La géométrie est exacte, rien n'est peint.
5. **Horloge Terre dans le HUD** : t∞ face à τ, avec un compteur de « temps perdu » qui défile pendant l'atterrissage sur Miller. À la synchronisation des deux bouches près, comme le précise le §3 du rapport.
6. **Les vagues de Miller selon Thorne** : Miller est en rotation synchrone. Une légère excentricité la fait **osciller** autour de son axe (libration), ce qui soulève des vagues géantes ; c'est l'explication de *The Science of Interstellar*. Le bourrelet de marée statique est de l'ordre de plusieurs dizaines de km (estimation d'équilibre à affiner). L'excentricité devient un paramètre honnête de la scène.
7. **Ciel aberré depuis le sol de Miller** : à 0,32 c, Gargantua et les étoiles sont concentrés vers l'avant du mouvement orbital et décalés vers le bleu. C'est un plan unique, et 100 % physique.
8. **Le ciel d'Edmunds** : un soleil orange de 0,66° et Gargantua de 15′ (ombre et anneau). On règle la phase pour une « éclipse » au lever de l'étoile.
9. **Réalisateur de caméra** (celui de la mission actuelle) : Ranger devant Gargantua pendant la descente vers Miller, rentrée atmosphérique, poser sur l'eau.
10. **Option : l'Endurance** (vaisseau-anneau) pour les plans d'arrimage. Cela demande un modèle 3D sous licence compatible.

---

## 7. Questions

**Aucune question ouverte.** Toutes les décisions sont prises (v4). Un seul réglage par défaut est proposé et reste ajustable sans conséquence sur le plan : la bouche de notre côté à ≈ 0,7 UA de Saturne (§3.9).

---

## 8. Risques

- **Régressions** sur la mission actuelle, les vidéos et la galerie : le passage de `P.star` au tampon de corps touche le shader principal. La phase 1 impose des captures avant / après et la sonde de précision GPU.
- **Coût de l'aiming CPU** (5 corps × 2 images) : il faut l'amortir.
- **Compositing** patch local / traceur : le traceur doit écrire une distance de coupure. C'est nouveau, puisque le Ranger est toujours devant tout.
- **Terrain au mètre** : c'est la phase la plus lourde (7). On la découpe planète par planète, en commençant par Miller.
- **Échelle de notre côté** : le col est 127 fois plus grand que Saturne ; les plans « Saturne et le col » reposent sur la perspective (§3.9). À valider par une capture tôt dans la phase 8.
- **Grand col** : ρ = 0,05 M donne une sphère de 10,6 R☉. On vérifiera en phase 1 que la sphère de collage (0,4 M) et le boost de Lorentz ne laissent pas de couture visible à 0,058 c.
- **Poussée finie** : le périmètre du planificateur Équipage doit rester borné (loi de guidage, puis correction par tir), sans optimisation globale.
- **Honnêteté scientifique** : les limites du rapport s'appliquent. Le trou de ver reste hypothétique, la bouche est une particule test et la stabilité globale n'est pas démontrée. La configuration rapprochée d'Edmunds n'est validée que par le test de la phase 0. Tout cela sera rappelé dans les infobulles de la scène.
