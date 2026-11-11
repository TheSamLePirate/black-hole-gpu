# PLAN-MER-WEBGPU — la mer au niveau de web-ocean, dans notre monde

**État (10 novembre 2026, soir)** : S0, S1, S2 et S4 faits (mesurés, §4) ; S3 en partie (la mer peu profonde sort aussi de `shadeLite`, le SSR seulement près d'une terre, l'écume et les crêtes à contre-jour reprises) ; S5 en partie (la sonde tracée autour de la caméra au-dessus de la mer ; son « défaut » de jour et de nuit **levé** : une erreur de mesure, la sonde égale l'image à 1–4 % de jour, §4) ; Miller ombrée comme la Terre (§4) ; reste S3 (le look de l'écume à juger, les crêtes devant la terre), S5 (les mips de rugosité), S6. Demandes de Sam, le 10 au soir : « d'abord la mer WebGPU parfaite » ; « je veux
le même rendu que web-ocean, mais compatible avec le ciel, les reflets, les bateaux, les traînées d'avion » ; « qualité et
performances AAA ». Origine : [analyse](ANALYSE-MER-LITTORAL-VEGETATION-2026-11-10.md) (lots M1–M5), stratégie §23. Ce plan
passe avant J1 (décision de Sam).

## 1. La cible

- **L'image** : celle de [web-ocean](https://github.com/Noniv/web-ocean) (MIT) — une vraie surface de mer déplacée dont les
  crêtes cachent la mer derrière elles ; des pentes filtrées par leurs moments (LEAN, terme croisé compris) et par l'empreinte
  **anisotrope** du pixel ; un reflet du Soleil gaussien anisotrope avec le masquage de Smith ; un ciel reflété stable avec
  la normale « visible » inclinée aux angles rasants ; une eau turbide éclairée par le ciel et des crêtes qui s'illuminent à
  contre-jour ; une écume née du repli de la surface, attachée au monde, qui vieillit, dérive et se strie ; aucune répétition
  visible.
- **Dans notre monde** : la Terre courbe au niveau du géoïde (WGS84 + EGM2008) ; notre ciel (atmosphère, nuages, nuit), nos
  reflets (SSR du monde, nuages lointains, sonde du vaisseau), nos sillages de bateaux et le souffle des appareils, les
  hauts-fonds, les rouleaux et le lavis de rive, la couleur de l'eau par région (Kd490), le TAAU, la perspective aérienne ;
  de 1 m à 30 km d'altitude ; les lacs et rivières gardent leur rendu.
- **La performance** : la mer ne doit pas coûter plus qu'aujourd'hui, et viser moins. Mesuré le 10 novembre sur kerr-mini,
  une vue de mer à 30 m : image 93,8 ms, dont `earth lite` 37,0 ms (sur des pixels presque tous marins, qu'il devrait
  quitter aussitôt) et `earth water` 34,4 ms ; web-ocean 32,5 ms pour toute son image. Le juge : la scène J0 et les vues de
  mer de la sonde `sea-compare`, sur kerr-mini (fréquence stable) et sur le M1 Max.

## 2. L'architecture

1. **La FFT** (`sea/spectrum.ts`, `sea/fft-gpu.ts`, `shaders/seafft.wgsl`) : 4 cascades de 256² **non commensurables**
   (~1 031 / 173 / 29 / 4,9 m) à bandes disjointes, chacune son décalage d'ancrage calculé en float64 (fin de la
   répétition de 1 024 m) ; par cascade trois couches : (Dx, h, Dz, J), (sx, sz, sx², sz²), (**sx·sz**, écume) ; mips. **Une
   cascade dont l'empreinte du pixel de mer le plus proche couvre la tuile n'est pas calculée** : sa variance (connue du
   spectre) passe dans la rugosité.
2. **La surface** (nouveau, `system/sea-surface.ts`) : un maillage CDLOD centré sur la caméra, dans le plan tangent de
   l'ancre de la mer, déplacé par les cascades dans le vertex shader, courbé sur l'ellipsoïde + géoïde, jusqu'à l'horizon
   (≤ ~400 km) ; rastérisé dans une **cible de visibilité de la mer** (distance, coordonnées lagrangiennes u, c, hauteur)
   avec sa propre profondeur (les crêtes se cachent entre elles). Le terrain gagne là où il est plus proche et n'est pas
   le plan de la mer ; hors du masque des océans, aucun fragment (les terres sous le niveau de la mer restent des terres).
3. **L'ombrage** (`shadeWater`, `seaShade`) : un pixel de la cible est ombré au point **exact** de la surface (plus d'inverse
   approximatif du déplacement) ; l'empreinte vient des pixels voisins (u, c) — un `textureSampleGrad` anisotrope par
   cascade — ; le modèle de web-ocean ; puis nos couches : sonde et ciel, SSR, nuages lointains, sillages, souffle, Kd490,
   hauts-fonds, rouleaux, lavis. `shadeLite` quitte tout pixel de la cible de mer dès son premier test.
4. **Au-delà** de la portée de la surface et pour l'eau intérieure, le chemin actuel (plan au niveau du géoïde, normales par
   pixel) reste ; le passage se fond par la distance.

## 3. Les lots

| Lot | Contenu | Preuve |
|---|---|---|
| **S0** | Mesure de départ : la vue de mer à 30 m et le départ de J0, chaque composante de `seaShade` retirée tour à tour (`TUNE_GSKIP`), les passes de calcul | `remote-results/sea-ablate/` ; tableau §4 |
| **S1** | Le contrat de la FFT : 4 cascades non commensurables + décalages, terme croisé, cascades non calculées quand l'empreinte les couvre ; l'ombrage actuel adapté (covariance complète, glint et Smith) ; `textureSampleGrad` anisotrope | `sea fft` ≤ 2 ms sur kerr-mini ; plus de répétition au km (capture rasante) ; tests du spectre |
| **S2** | La surface : CDLOD courbe déplacé, sa cible, l'intégration à `shadeLite` / `shadeWater` | crêtes qui masquent la mer à 2 m ; `earth lite` sur une vue de mer divisé ; e2e d'image |
| **S3** | L'ombrage de web-ocean dans notre ciel : glint gaussien + Smith à covariance complète, inclinaison rasante, corps et crêtes à contre-jour, anticrénelage spéculaire, nos reflets | A/B contre web-ocean sur les mêmes vues ; pas de pétillement en mouvement (Q6) |
| **S4** | L'écume en cartes monde (2 × 1024², 128 m et ~1,5 km), injection par le Jacobien total, décroissance, dérive, stries ; sillages et souffle y injectent aussi | plus de répétition dans l'écume ; écume qui suit le vent |
| **S5** | Le ciel reflété : la sonde avec ses mips de rugosité (niveau par l'écart des pentes), son défaut de nuit corrigé | reflet stable jour et nuit |
| **S6** | Mesures finales (J0, sea-compare, M1 Max soutenu), docs (GRAPHICS-PIPELINE, BH-API, E2E-CATALOGUE), retrait des voies remplacées | fiche J0 nouvelle |

## 4. Mesures

kerr-mini (M1, 1 278 MHz stable), 1920 × 1080, échelle 0,75, image entière, GPU p50 sur 15 s d'images terminées, sondes
`sea-ablate` et `sea-check` (`remote-results/sea-ablate/`, `remote-results/sea-check/s1`, `s2`), 10 novembre. A/B dans le même
navigateur.

**S0, le départ** : vue de mer à 30 m 93,8 / 83,7 ms (deux passages), dont `earth lite` 37,0 / 32,7 et `earth water`
34,4 / 29,6 ; départ de J0 (côte, 500 m) 77,9 / 77,0 ms. Les cinq options de `seaShade` (SSR, ciel analytique, Fresnel
moyenné, nuages reflétés, hauts-fonds) ensemble ≈ 8–12 ms de `earth water`. Les variantes qui recompilent pendant la mesure
ne sont pas fiables (passes absentes, « sky (waiting) »).

**S1 + la sortie anticipée de `shadeLite`** (A/B `liteSkip` 2³⁰ = l'eau lue tard, comme avant) :

| Vue | Avant (eau lue tard) | Après | `earth lite` | `earth water` | `sea fft` |
|---|---:|---:|---|---:|---:|
| Mer à 30 m, Soleil bas | 96,1 | **68,2 / 71,1** | 35,5 → 10,3 | 37 | 2,2–2,7 |
| Mer à midi, 150 m | 88,7 | **68,3 / 68,4** | 30,1 → 10,1 | 35 | 2,1–2,4 |
| Côte à 500 m (hauts-fonds) | 81,1 | 81,0 / 82,3 | 26 inchangé | 32–33 | 2,3 |
| Rivage (surtout la terre) | 58,6 | 57,3 / 59,2 | 31 inchangé | 4 | 2,2 |

La passe d'eau gagne ~+3 ms (4 cascades, anisotropie, terme croisé). La côte n'y gagne rien : un haut-fond connu (< 60 m) garde
le chemin long, le turquoise lisant la couleur du fond (`under`) — à reprendre.

**S2, la surface maillée** (A/B `seaSurfaceOn`) : à 2,4 m 61,1 → 65,4 ms (+4,3), à 30 m 71,5 → 71,3–72,2, à midi 69,4 → 68,4–70,9,
à 500 m 81,1 → 80,9–81,4 : de 0 à +4 ms. 470–730 nœuds. Les horodatages de la passe `sea surface` (15–33 ms) sont du chevauchement
de passes de rendu (GP-09), pas un coût. Limites de S2 : une crête devant la terre n'est pas dessinée (le masque grossier
laisserait la mer déborder sur les côtes basses et les polders) ; les mesures ont été faites avec `wind: 0` (vagues minuscules :
l'effet visuel n'est pas encore jugé) — les prochaines sondes fixent l'état de mer (`seaOverride`).

**Constats de qualité** (captures `remote-results/sea-check/`) : en caméra libre loin du vaisseau, la mer reflétait la sonde du
vaisseau (un Ranger en orbite) — corrigé (S5, `P.seafft[6].z`) ; un flou fort au premier plan (profondeur de champ d'un
préréglage ?, TAAU à 0,75) — à établir ; une bande sombre et un halo bleu à l'horizon.

**S4, l'écume monde** (A/B `seaFoamWorldOn`, mer imposée : mer du vent 1,0 m / 5,5 s, houle 1,2 m / 10 s ; profondeur de champ
coupée) : 30 m 73,0 → 74,7 ms, midi 72,9 → 74,2 : **+1 à +1,5 ms**. Deux cartes de 256² dans les couches 12–15 de la texture de
la FFT (aucune liaison de plus au traceur) : 128 m et 1 024 m autour de la caméra, toroïdales, injection par le Jacobien de toutes
les cascades calculées, décroissance (5 s), dérive sous le vent (3,5 % de U), fraîcheur des crêtes. Visuellement, avec une vraie
mer et la sonde corrigée, le saut de qualité est net (captures `remote-results/sea-check/s4/`) : mer bleue à midi, vagues nettes
jusqu'à l'horizon, moutonnements ; au couchant à 2,4 m le reflet du Soleil se brise en paillettes sur les formes des vagues.
Reste pour S3 : l'écume en taches douces et un peu beige (ni stries ni dentelle de bulles comme web-ocean), la lumière à travers
les crêtes.

**S5, la sonde autour de la caméra** (A/B `seaProbeOn`, deux passages chacun, mêmes réglages qu'en S4) : en caméra libre au-dessus
de la mer, la sonde de lumière — celle du vaisseau, tracée autour de la caméra — est tracée aussi, et la mer la reflète tant
qu'elle est fraîche (moins d'1 s ; `P.seafft[6].z`) ; sinon le ciel analytique et le miroir des nuages. Coût dans le bruit :
midi 67,9 / 71,3 → 73,0 / 70,7 ms, mer à 30 m 70,5 / 70,4 → 69,8 / 69,6, côte à 500 m 81,2 / 80,1 → 81,5 / 79,6. Au couchant la
mer reflète enfin le ciel orangé au premier plan (elle y était presque noire) ; à midi elle est plus grise, le ciel bas réel
étant brumeux (captures `remote-results/20261110-153942-sea-s5/`).

**S3, la mer peu profonde quitte aussi `shadeLite`** (A/B `liteSkip` 2³⁰ = les deux sorties coupées, deux passages chacun) : un pixel
tout d'eau de mer dont le fond est connu (< 60 m) ne lit plus que l'imagerie — son albédo dans `accum` (`w` = 2), éclairé dans
`shadeWater` par son Soleil et son ciel : il ne sert qu'à décider si la photographie voit un fond (le turquoise de `seaShade`) —, ni
matériau, ni ombres, ni ciel. Côte à 500 m **84,4 / 84,4 → 71,8 / 69,9 ms** (`earth lite` 24,8 → 10,9) ; mer à 30 m 97,6 / 96,5 →
72,9 / 70,7 (la sortie de S2) ; rivage (surtout la terre) 61,1 / 62,7 → 63,5 / 62,1, inchangé. L'image de la côte est la même
(turquoise des hauts-fonds présent, couleur moyenne à 0,2 % ; `remote-results/20261110-154613-sea-shallow/`). Avec ces mesures,
le SSR coupé hors de 8 km d'une terre (`seaAllAround`, une lecture du masque), la transmission des crêtes fines à contre-jour,
l'écume éclairée par un ciel désaturé et les bulles sous elle — non mesurés séparément (pas de levier pour le SSR toujours).

**Miller, la même mer** (demande de Sam, 10 novembre au soir ; e2e `miller-sea`, kerr-mini) :
- **Régression trouvée et corrigée** : la mer de Miller était noire depuis S1 — la cascade de 4,9 m sous 0,5 m d'eau porte
  `tanh(k d)` jusqu'à 82, NaN sur Apple (rapport d'exponentielles) ; toute la FFT de Miller en NaN, `bodyLite` le peint en noir.
  L'argument est borné à 15. Le test passait sur une mer noire : il vérifie maintenant le niveau de l'eau (coins bas, 6–245).
- **L'ombrage de la Terre** : `shadeNear` appelle `seaShade` (`SEA_ALIEN`) — mêmes cascades, LEAN à covariance complète, reflet
  gaussien et Smith, Fresnel moyenné et inclinaison rasante, écume monde, crêtes à contre-jour ; ce qui n'existe que sur Terre
  (ciel analytique, nuages, Kd490, masque des océans, rouleaux, SSR du monde) laissé de côté ; le ciel reflété par la sonde de
  Miller ; le corps de l'eau celui de sa carte (fond pâle sous 0,5 m), avec ses caustiques ; la vague géante par-dessus.
- **Gargantua dans la mer par l'image** (`seaSkySSR`, demande de Sam) : un ciel à l'infini sans marche — la direction réfléchie
  (tirée des pentes, sommée par l'historique) projetée à l'écran, la couleur du ciel lue là. Coût dans le bruit : 61,5 / 60,9 ms
  contre 61,7 / 60,4 sans (`liteSkip` 2³¹). Limite : il ne reflète que ce qui est à l'écran — dans les vues du test, le reflet du
  disque tombe sous le Ranger ou le disque sort du cadre ; la sonde reste en dessous.
- **L'écume** : deux corrections pour toutes les mers — le seuil de l'écume monde pris sur l'écart du Jacobien de toutes les
  cascades qu'elle lit (pas des deux longues seules) et la bande des crêtes à l'échelle de cet écart (inchangée vers 0,15, la
  Terre par force 5) — ; pour Miller seule, 30 % des moutons de Monahan et une écume qui s'efface deux fois plus vite (Sam :
  « trop d'écume sur Miller »).
- **Mesuré pour rien** : couper les cascades d'ombre du relief sur la pleine mer (sans terre à 8 km) — midi 68,1 / 71,1 contre
  70,9 / 71,1, mer à 30 m 72,6 / 71,8 contre 71,3 / 70,6 : retiré.
- **Titan** : la sonde au-dessus de la mer limitée à la Terre (`seaHere.world`) ; `titan-ground` reste aux limites de 300 s de
  ses attentes (un cas échoue d'un passage à l'autre, en compilation), à reprendre hors de ce plan.

**S3, la passe d'eau : où vont ses ~35 ms** (ablations sur kerr-mini, 10 novembre au soir, avec des témoins intercalés — la base
dérive de 1 à 3 ms au fil d'un passage) : à 30 m, base 68,8 ms ; sans `skyMirror` −4,4, sans les ombres du Soleil −8,8 (ce bit ne
recompile pas : un coût d'exécution), sans le Fresnel moyenné −8,8, sans les hauts-fonds −8,9 (absents de la vue : un coût de
**présence** — le noyau est limité par ses registres sur Apple, tout bloc retiré passe un seuil d'occupation) ; les ombres une à une
(nuages, scènerie, relief, horizons, appareil) 0 à 1,4 ms chacune ; le miroir des nuages ~0. D'où :
- **le noyau de la pleine mer** (`shadeWaterOpen` : `shadeWater` compilé avec `WATER_OPEN`, sans le code des côtes et de l'eau
  intérieure ; chaque pixel classé tôt — fond connu à 60 m, rivage à portée du lavis, eau intérieure — et laissé à l'autre noyau ;
  `P.seafft[0].x` = 2 écrit sur les paramètres de l'image quand il tourne ; A/B `seaWaterOpenOn`) : mer à 30 m **67,0 → 64,25 ms**,
  midi **65,8 → 62,85**, côte à 500 m 64,25 → 65,0 (sa classification seule, 1,5 ms, sans pleine mer à ombrer). Images identiques.
- **le ciel reflété filtré par la rugosité** (S5, M4 de l'analyse) : les niveaux GGX de la sonde dans la texture de la FFT (couche
  16, `takeSky` ; aucune liaison de plus), lus au niveau de la rugosité de l'eau au lieu de la sonde brute : le lointain sans
  pétillement, le reflet flou comme la mer est rugueuse ; non mesuré seul (dans la base des mesures ci-dessus).
- `skyIrradiance` à 9 harmoniques × 2 altitudes par pixel remplacé, pour le miroir du ciel, par ses 3 termes verticaux au niveau
  de la mer ; les traînées d'écume des cascades non lues dans la fenêtre de l'écume monde ; non mesurés seuls.
- Mesuré pour rien : couper les ombres du relief sur la pleine mer (sans terre à 8 km) ; exiger « aucune terre à 8 km » pour le
  noyau de pleine mer le laissait sans pixel dans toutes les vues de Hyères.

**S6, la scène J0 après la mer** (kerr-mini, vol seul, deux passages, [fiche](progress/j0/FICHE-kerr-mini-2026-11-10-mer.md)) : GPU
p50 **65,4 / 64,2 → 60,9 / 60,7 ms**, 15,2–15,5 → 16,4 images/s ; `earth lite` 17,5 → 12,1, `earth water` 12,7 → 12,4 + 2,1
(pleine mer), `sea fft` 1,6 → 2,1. La mer de la scène de référence coûte moins et montre plus (4 cascades, surface maillée, écume
monde, ciel filtré). Chemin d'entrée inchangé à cache chaud (12,2 / 16,9 s) ; à froid, sources neuves, 33,3 / 60,8 s — sans point
de comparaison froid du matin. Reste de S6 : le M1 Max soutenu, les ablations J0, le retrait des voies remplacées.
Sur le **M1 Max** frais (un vol, [fiche](progress/j0/FICHE-m1max-2026-11-10-mer.md)) : 36,8 → **42,5 images/s**, intervalle p50 25,1 →
**24,9 ms** (le palier 1 tenu en médiane, pas en p95 33,3 / p99 49,6), GPU p50 26,3 → 23,0 ms. Le vol soutenu (bridage) reste à revoler.

**Le noyau de pleine mer sur la côte** : l'eau intérieure et la mer peu profonde déjà marquée par `shadeLite` quittées avant tout
rayon (kerr-mini, deux passages) : côte à 500 m, sa passe reste à 1,6 ms et l'écart au noyau unique passe de +0,75 à +0,45 ms — dans
le bruit ; ses pixels sont surtout de l'eau profonde près du rivage ou dans la portée du lavis, qui demandent la classification
entière. Mer à 30 m : 66,35 contre 67,65 ms.

**L4, la bathymétrie (option a de Sam : Terrarium + profil de Dean)** (10 novembre au soir) : la distance au rivage cuite par
**inondation de sauts** sur toute la fenêtre des niveaux 3 à 6 du cache de relief (6,1 à 390 m, jusqu'à ±50 km ; avant : une recherche
à 4 nœuds, ~100 m de portée), testée contre la recherche exacte (≥ 97 % des nœuds exacts, un nœud au pire) ; `seaDepthAt` prend le
**profil d'équilibre de Dean** h = 0,1·x^(2/3) là où les tuiles n'ont pas de profondeur (confiance 0,85 ; `liteSkip` 2³¹ l'A/B). Coût
dans le bruit (plage, côte, rivage : ±1,5 ms entre passages). Dans les vues de Hyères, Terrarium porte déjà la profondeur : l'image ne
change pas (moyennes à 1 %). **Au passage, un défaut corrigé** : la mer près de l'Almanarre était piquée de points verts (~950 pixels
dans une vue) — le turquoise des hauts-fonds s'ouvrait sur chaque point blanc de l'orthophoto (vagues, reflets, bateaux du jour de la
prise de vue) ; l'albédo du fond lu sur huit empreintes : 0 point, couleur moyenne inchangée.

**Le noyau de pleine mer seulement s'il y en a** : chaque noyau de l'eau tamponne « pleine mer vue » (avant-dernier mot de `stamps`,
relu avec celui de la mer) ; le noyau de pleine mer n'est envoyé que si l'on en a vu dans les 60 dernières images — le noyau entier
la traite sinon, et la signale. Côte à 500 m (un peu de pleine mer au large : le noyau reste envoyé) 68,5 contre 68,35 ms, neutre ;
mer à 30 m 67,3 contre 70,05. **M1 Max, séance complète** ([fiche](progress/j0/FICHE-m1max-2026-11-10-mer-complet.md)) : vol soutenu
24,9 → 31,4 images/s (≈ +9 % par MHz, le bridage du soir moindre) ; ses ablations faussées par le bridage (jusqu'à 389 MHz).

**S5, le défaut de la sonde mesuré (ouvert)** (kerr-mini, sonde `night-probe`, deux passages identiques à 1 % près) : la radiance de
la sonde dans l'axe de la vue (texels u = v = 0,5, `ship.envBuf`) contre celle de l'image au centre (`accum` / poids, radiance brute —
la pré-exposition n'y est pas : 1 518 de jour, 1,3·10⁸ de nuit) : **de jour la sonde est 3,18–3,19 fois plus lumineuse** (≈ π), de nuit
0,26 (vers le haut) à 0,31–0,37 (l'horizon). Écartés : aucun facteur π dans le noyau `env` ni dans `probeRadiance` ; le dernier
argument d'`earthLook` (`false` pour la sonde) ne touche que les nuages (coupés ici). **Risque** : le reflet du ciel par la sonde
(`seaSkyRadiance`) est plafonné à 4 fois le ciel analytique — un surplus de ~3 de jour passe ; c'est cohérent avec la mer plus pâle
« avec la sonde » à midi (S5). À trouver avant de rendre la sonde seule juge du reflet ; pistes : le chemin du ciel de `main` (noyau
allégé du raster) contre celui d'`env`, le facteur d'un des deux sur la diffusion.

**Correction (même soir) : le facteur ≈ π de la sonde n'est pas établi.** Un troisième passage (`probe-pi`, mêmes vues de jour, avec
et sans la table aérienne, avec et sans sa pré-exposition) donne un rapport de **1,59** — la sonde inchangée (3,7·10⁻⁶), la valeur lue
dans `accum` doublée d'un passage à l'autre ; les leviers de la table n'y changent rien. La mesure — `accum` divisé par son poids, au
centre de l'image — n'est pas une radiance finale fiable du pixel (son poids, l'entrelacement des rayons, le motif du raster). Ce qui
reste : la sonde est plus lumineuse que l'image de jour d'un facteur entre 1,6 et 3,2 selon le passage ; le plafond à 4 fois le ciel
analytique la laisse passer. À reprendre avec une mesure sur l'historique linéaire (divisé par la pré-exposition) ou sur le ciel
analytique au même point.

**S2, les crêtes vues d'une plage proche (la limite levée, 10 novembre, nuit)** : la caméra à 3 m au-dessus de la mer, 150 m de la
plage de l'Almanarre (Giens), force 5 : `seaCrestsOverLand` allumé ou éteint, la ligne de la plage identique — aucune crête sur le
sable. La première tentative a montré un **bloc noir de 120–165 m sur la mer** devant la plage : une tuile z 17 du LiDAR HD
entièrement interpolée sur l'eau (0 à 204 m, sans trou) passait sans contrôle quand les niveaux plus grossiers n'étaient pas encore là
pour la juger — corrigé dans `earth-tiles.ts` (`coarseUnknown` : RGE ALTI demandé), planche `docs/progress/mer/almanarre-lidar-avant-apres.jpg`.

**S5, le défaut de la sonde : levé (10 novembre, nuit).** Remesuré sur l'historique linéaire (le centre de `temporal`, divisé par sa
pré-exposition) : les texels « u = v = 0,5 » lus jusqu'ici sont **les mêmes quelle que soit la vue** (cap 0°/site 40° et cap 90°/site
20° : identiques) — la sonde est rangée sur les axes fixes du monde (`envX/Y/Z` = 1, 0, 0…), pas sur ceux de la caméra ; on comparait
deux directions différentes. Lue dans la direction de la vue (`envUV` de `taPrev.fwd`, 5 × 5 texels) : **de jour, sonde / image =
1,01–1,04** (quatre vues, avec et sans table aérienne et sa pré-exposition) ; au crépuscule près de l'horizon 1,14 ; de nuit 1,19
(site 40°) et 1,36 (site 8° : les 5 × 5 texels, ~7°, moyennent un gradient raide près de l'horizon — non séparé). Le « × π » et le
« 0,26–0,37 de nuit » étaient des artefacts de mesure (mauvais texel, `accum` non rafraîchi — sa lecture au centre restait la même
d'une vue à l'autre). La sonde peut juger le reflet du ciel ; reste, si utile, un écart de 10–35 % au ras de l'horizon la nuit à
mesurer plus finement (un texel, plusieurs sites). Sonde : `probe-hist` (scratchpad de session), kerr-mini, 0 erreur GPU.

**S2, les crêtes devant la terre** (limite de S2 levée) : `seaFs` garde un fragment de la surface devant le sol quand le sol derrière
est plus loin, se tient au-dessus de la borne des vagues (sa hauteur depuis celle de la caméra, la distance et la courbure), et que le
point de la crête est en mer selon les distances au rivage (le masque des niveaux 3 à 6, 6 à 390 m) — ni plage, ni polder, ni champ
bas. A/B `seaCrestsOverLand` (kerr-mini) : devant les falaises sud de Porquerolles à 3 m et 1,7 km, coût 68,9 contre 69,1 ms, la ligne
de la mer au pied de l'île à peine changée (des crêtes de 1 m à cette distance), aucun débordement vu ; la vue « plage basse » visée ne
montrait pas la plage — le cas d'une plage proche reste à voir.


## 5. Le littoral : L1–L3 (lancé le 11 novembre)

Demande de Sam, 11 novembre : « commence Littoral L1/L2 ». Décisions déjà prises le 10 ([analyse §8](ANALYSE-MER-LITTORAL-VEGETATION-2026-11-10.md)) :
la bathymétrie par Terrarium + profil de Dean, rien de plus téléchargé. Référence de technique : le littoral de BakedVoxelLighting
(analyse §4.1), réécrit sur nos contrats — un produit du **monde** sur les fenêtres du cache de relief, lu par l'eau.

**Ajouté le même jour** : le niveau 2 du cache (nœuds de 9,6 m, ±1,2 km) aux distances et au champ — le trait de l'eau peu profonde
devant une plage suivait en marches de ~30 m les cellules du niveau 3 et bougeait à chaque recuisson ; il est continu (planche
`docs/progress/mer/trait-de-cote-niveau2.png`), le déferlement près de la caméra lit des nœuds 4 fois plus fins.

**Correction d'un chiffre répété ici et dans le code** : les niveaux 3 à 6 du cache ont des nœuds de **38, 153, 611 et 2 446 m**
(`TERRAIN_CACHE_ROUNDS` 2²⁰ … 2¹⁴ ; fenêtres de ±4,9, ±19,6, ±78 et ±314 km), pas « 6,1 à 390 m ». Et la grille est
équirectangulaire : ses nœuds sont cos φ plus proches d'est en ouest (0,73 à 43° N). Les distances au rivage comptaient les deux
directions pareil (27 % trop longues d'est en ouest à Hyères) ; corrigé avec L1 (inondation et distance mesurées en mètres vrais).

| Lot | Contenu | Preuve | État |
|---|---|---|---|
| **L1** | **Le champ de houle côtier** (`system/earth-swell.ts`, cuit par `EarthShore` à la suite des distances, table `TABLE_SWELL` en fin de `bodyBuf`) : sur chaque niveau de rivage, la phase φ de la houle dominante — eikonale \|∇φ\| = k(h), k par la dispersion de Fenton & McKee à sa période sur la profondeur de Dean, résolue sur GPU par un schéma de Godunov amont en tuiles de 16² (16 passes locales, 48 envois sur 3 images) — depuis l'onde plane du large sur les bords amont du niveau le plus grossier, les bords d'un niveau plus fin pris dans la phase du niveau au-dessus ; le gain de hauteur : levée √(cg₀/cg) × rotation des crêtes √max(cos(direction locale, direction du large), 0) (Kr d'un fond à isobathes droites près d'une plage ; rien dans l'ombre au-delà de 90°). Clé : direction (5°), période (0,5 s), ancre ; un niveau à la fois, le plus grossier d'abord | tests CPU du schéma (`tests/earth-swell.test.ts` : onde plane exacte au large, crêtes tournées vers la normale d'une plage, lagune non atteinte, ombre d'une île) ; sonde `coast-swell` (Almanarre) | **fait** (11 nov.) |
| **L2** | **Le déferlement lu dans le champ** (`seaShade`, `seaSwellAt`) : crêtes réfractées sur la normale de l'eau là où la houle sent le fond (kh < ~1,2), hauteur levée bornée à 0,6 h, crête pointue près du déferlement ; déferlement où Hs·gain atteint 0,35–0,6 h, front blanc qui traîne vers le large derrière chaque crête, bores saturés plus près ; lavis de rive cadencé par l'arrivée des crêtes (`SEA_SWELL_S`) ; l'ancien chemin (bandes par la profondeur seule) là où le champ n'est pas | sonde `coast-swell` (A/B `shoreSwellOn`) : captures et coût | **fait** (11 nov., à juger sur image) |
| L3 | Le sable mouillé et la lame de rive **sur la terre** : dans le noyau matériau de `shadeLite` (le découpage matériau/éclairage de l'orientation J1-4, déjà en place) — la terre au contact de la mer (distances au rivage positives sur la terre à moins d'un nœud d'un nœud de mer), sous le jet de rive de Stockdon (R2 ≈ 0,078 √(Hs L0), l'état de mer du champ, sinon de la FFT) : assombrie ×0,62 et brillante (`wetS`) ; sous le bord de la lame — montée à chaque période, redescendue au tiers, déphasée le long du rivage par un bruit lent — un film d'eau miroir ; séchée sur 0,5 m au-dessus | sonde `coast-swell` `SWELL_ABLATE=sand` (A/B `shoreSwellAblate` 16) : planche `docs/progress/mer/l3-sable-mouille.jpg` (le sable du premier plan change par plaques) ; **présence nulle** dans le noyau matériau (forêt des Maures, `TUNE_SWELL` 0 contre complet : 54,4 / 54,5 / 53,4 contre 54,2 / 54,1 / 53,9 ms) ; plage 73,5–78,6 ms des deux côtés (bruit) | **fait** (11 nov. ; la lame cadencée par le temps, pas par la phase du champ, qui n'existe pas sur la terre) |

**Limites de L1/L2, connues** : la profondeur du champ est le profil de Dean tiré de la distance (pas les hauts-fonds de Terrarium :
le cache s'arrête au niveau de la mer ; lire les tuiles dans la cuisson est la suite) ; les nœuds du plus fin niveau font 38 m — la zone
de déferlement d'une plage (h < 2 m, < 90 m du bord) tient en deux ou trois nœuds, la phase y est interpolée linéairement (exacte pour
une onde plane) et la profondeur du pixel reste celle de `seaDepthAt` ; une seule houle (la dominante), pas de diffraction ni de
courant ; la houle de la FFT n'est ni tournée ni levée près du bord, le champ s'y ajoute (kh < 1,2) ; le lavis reste sur les pixels de
mer (la lame sur le sable est L3). Coût de la cuisson : ~0,8 ms l'image où elle tourne (passe `earth shore`), trois images par
niveau, au plus une recuisson toutes les 2 s par niveau pour de nouvelles tuiles.

**Coût de la lecture, mesuré (11 nov., kerr-mini, sonde `coast-swell` `SWELL_ABLATE=presence`, trois passages)** : champ allumé /
éteint à l'exécution / lecture compilée hors du noyau (`TUNE_SWELL` 0) — plage 71,7 / 70,3 / 69,1 ms, vue basse 61,7 / 60,4 /
59,7 : **+2,0 à +2,6 ms en tout, dont ~0,7–1,2 ms de simple présence** (la pression sur les registres du noyau de l'eau, comme pour
les hauts-fonds en S3) et ~1,3 ms de travail. Essayé sans gain et annulé : calculer la pente des crêtes aussitôt (un vec3 gardé au
lieu de l'échantillon du champ) et relire le champ dans la zone de déferlement — deux sites de lecture, noyau plus gros, pas plus
rapide. **Le remède** : sortir la houle du noyau de l'eau — une passe propre qui écrit par pixel la pente des crêtes et la phase,
lue d'une seule lecture —, c'est-à-dire la passe d'eau de J4 (stratégie §7.5) ; la cible ≤ +0,5 ms n'est pas tenue avant.

**La passe de houle, son plan (J4, écrit le 11 novembre)** : (1) une passe de calcul `sea swell` avant `earth water`, sur les seuls
pixels d'eau de la visibilité (`moments.x` marqués mer, ou la surface maillée), qui évalue `seaSwellAt`, la pente des crêtes (en 2
composantes du repère est/nord), la phase `swS`, le gain et le drapeau « tenu » et les écrit dans une cible `rgba16float` à la taille de
l'image ; (2) les noyaux de l'eau la lisent d'une lecture — `textureLoad`, aucun filtrage — à la place de la fonction et de ses
lectures de table, la fonction retirée de leur source (le gain de présence mesuré, ~1 ms) ; (3) **la liaison** : les noyaux de l'eau
partagent aujourd'hui le groupe 1 des tables (LUT, perspective) avec tous les noyaux ; y ajouter une texture la compterait partout
(au-delà de 38 sur les appareils qui en ont juste assez) — il faut donc une disposition de groupe 1 propre à l'eau (lecture des
tables + la cible de houle), donc des variantes de pipeline de l'eau à leur propre disposition, comme `shadeLite` a la sienne
(`liteLayout`). Preuve attendue : la sonde `coast-swell` `SWELL_ABLATE=presence` — l'écart allumé / compilé hors ramené sous
+0,5 ms —, les mêmes images.
