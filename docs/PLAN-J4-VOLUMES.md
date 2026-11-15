# PLAN-J4 — l'eau et les volumes à budgets propres

**État (15 novembre 2026, 04:40 UTC) : mené et fermé** sous la consigne « continue le plan » (comme PLAN-J3), chaque réglage provisoire daté
et révisable par Sam — J4-0, J4-6, J4-R faits ; J4-1, J4-3, J4-5 non ouverts (plafonds lus) ; J4-2 et J4-4 essayés et fermés sur preuve ; la
carte d'ombre des arbres corrigée (−2,8 ms sur une forêt). **Sortie du §4 non atteinte** : les enveloppes écrites, aucune tenue (bilan §10). Jalon de la [stratégie](ANALYSE-STRATEGIE-RENDU-2026-11-03.md) §15 J4 :
« porter les lecteurs de FFT et nuages vers les nouveaux contrats ; caches de lumière, limites opaques, mouvements et confiance ; introduire
ensuite les représentations collectives de végétation lointaine et le profil météo lourd ». **Sortie (§15)** : *côte, reflet et traversée de
nuages dans une enveloppe explicite ; pas d'annonce de réussite sur le seul ciel clair.* Ordre (§24, décision 1 de Sam, 13 novembre) : l'eau
étagée et la classification par tuiles **faites** (PLAN-MER §6 : E1 −1,55 ms, E2 −0,5 ms, tuiles −1,15 ms sur terre ; E3 non ouvert, sous
1 ms), J3 **mené** (15 novembre, [PLAN-J3](PLAN-J3-LUMIERE-COCKPIT.md)) → **le reste de J4 : volumes, végétation lointaine** → J5.

Le code fait foi ; l'existant ci-dessous est relevé au 15 novembre (après `f142569f`). Les trois règles de méthode (CLAUDE.md) : gain maximal
écrit avant chaque lot de performance (lu dans une fiche), ancien chemin retiré au lot de retrait suivant, toute sonde neuve passée par un
témoin positif et un A/A nul.

## 1. Ce que J4 doit livrer

- **Le contrat des volumes** (§7.9) : radiance, transmittance, intervalle, mouvement du milieu et confiance ; bornes par la profondeur opaque ;
  une grille d'occupation hiérarchique pour sauter le vide ; un cache de lumière ; un historique des nuages lié au vent.
- **Les lecteurs de la mer** sur le contrat de données de la mer (cascades, moments, écume monde, ciel — M1–M4, faits) dans une passe d'eau qui
  porte sa propre disposition ; la houle côtière en passe séparée (Sam, 11 novembre : « attend J4 »).
- **La végétation lointaine collective** (§23) : forêt moyenne en imposteurs à profondeur fiable, forêt lointaine en tuiles de canopée par
  classe fondues dans le matériau du sol avec leur moyenne exacte.
- **Le profil météo lourd** : une scène de référence (côte, objet au-dessus de l'eau, pluie sur le verre, lumière sous les nuages, visibilité
  du pilote — §13), son enveloppe de coût.

## 2. L'existant (relevé du 15 novembre)

### 2.1 Les nuages

- Passe `clouds (half)` (C11, `trace.wgsl` `clouds`) : demi-résolution, amortie en damier 1 sur 4 (`FLAG_CLOUD_AMORTISED`), bornée par la
  profondeur raster minimale de son bloc 2 × 2 (`terrainRasterDepth`) ; `earthClouds` → `cloudVolume` + `wxCloud` ; sorties `cloudOutA`
  (lumière, couverture), `cloudOutB` (distances, borne). Lecteurs : `cloudsBuffered` / `cloudsAtPixel` (`system/cloud-pass.ts`), la mer (miroir).
- Caches de lumière : `clouds' shadow map` (C7, 384², ±40 km), `clouds' light volume` (C8, 64 × 64 × 24, un quart des bandes par image),
  `sky ambient` (C9) — **trois pipelines tirés du module entier, non spécialisé** (GRAPHICS-PIPELINE).
- Historique `clouds' history` (C12, `post.wgsl` `cloudTemporal`) : reprojeté par la caméra seule à la distance du nuage, borné au voisinage,
  15 % d'image neuve. **Ni vent, ni confiance** (lecture du code, non vérifié en exécution) ; les nuages n'écrivent rien dans le mouvement.
- Coût mesuré : J0, kerr-mini, 13 nov. ([fiche](progress/j0/FICHE-kerr-mini-2026-11-13-sortie.md)) — `clouds (half)` 5,15 ms ; ablation
  « sans nuages » −6,3 ms ; famille « air et nuages » 8,4 ms (mini), 3,8 ms (M1 Max frais) pour une enveloppe de 2,5 ms. Plus ancien (kerr-mini,
  5 nov., Q5) : la passe seule 13,7 ms couvert, **29,8 ms en orage**.
- Ouvert : le repli tracé perd presque tous les nuages (PROBLEMES) ; **la scène de traversée de nuages « à définir avant J4 »** (J0-CONTRAT).

### 2.2 La mer

- Le contrat (`sea/fft-gpu.ts`, C1) : 256² × 17 rgba16f — 4 cascades × 3 couches, l'écume monde, le ciel (couche 16) ; liaisons 33/34 si
  l'appareil prend 19 textures (16–18 : coupées, corrigé le 14 nov.).
- Lecteurs : `trace.wgsl` (`seaTap`, `seaFoamWorld`, `seaWavesFft`, `seaHeightAt`, `seaSurfaceHit`, `seaSkyRadiance`) par `shadeWater` /
  `shadeWaterOpen`, `earthGround`, `earthNear`, `shadeNear` ; hors traceur `sea surface` (C18b, la surface déplacée M5 — **déjà là**, ablation
  −0,7 ms). Tout dans la disposition monolithique du traceur ; la disposition propre de la passe d'eau (PLAN-MER) non construite.
- Coût : famille « eau » 16,2 ms (mini), 5,3 ms (M1 Max) pour une enveloppe de 1,0 ms (J0, 13 nov.) ; la houle côtière +2,0–2,6 ms sur une côte.

### 2.3 La végétation lointaine

- Placement par cellules de 7 m jusqu'à ~6,25 km ; proxies au raster ; au-delà de 200 m les imposteurs hémi-octaédriques (V2c) ; les tuiles
  de canopée dans le matériau du sol au-delà de 1,5–4 km (V1, effet faible — Sam : « je vois pas les différences ») ; au-delà de 6,25 km,
  l'orthophoto seule (et les silhouettes du MNS en France). V3 essayé et retiré (+0,66 ms, invisible).
- Coût : ablation « sans décor » −2,0 ms (mini, 13 nov.).

### 2.4 La météo

- `weather.ts`, `realweather.ts`, `weather-grid.ts`, METAR, éclairs ; `HAS_WX` bit de compilation (fixé par le profil raster de la Terre) ;
  `wxVeil` ; N5 (rideaux de pluie, arcs, éclairs, brouillards, mouillé), W5 (pluie à l'écran, gouttes sur le pare-brise).
- Coûts anciens : cockpit sous orage 59–60 ms (mini) ; ombre lointaine des nuages en orage +2,1 ms. **Aucune scène J0 météo** (J0 : beau temps,
  couverture 0,5).

## 3. Les lots proposés

Chaque lot de performance écrit d'abord son gain maximal, lu dans une fiche ; chaque lot de qualité dit ce qu'il corrige, avec une image avant
/ après au même cadrage. ΔGPU sur J0 (kerr-mini) et sur la scène J4 (J4-0).

| Lot | Contenu | Plafond lu (règle 1) | Preuve | Taille |
|---|---|---|---|---|
| **J4-0** | **Les scènes J4** : la traversée de nuages (J0-CONTRAT : « à définir avant J4 ») et le profil lourd (côte, pluie, sous les nuages — §13) en e2e de référence comme J0 ; leur fiche par famille (nuages, eau, décor, météo) | — | fiche, A/A | M |
| **J4-1** | **Le contrat des nuages** : la confiance et le mouvement du vent dans `cloudTemporal` (l'historique lié au vent, §7.9) ; les nuages dans le mouvement de l'image | qualité (fantômes en vol, traînées sous le vent) | images en mouvement, sonde de stabilité | M |
| **J4-2** | **Le saut du vide** : une grille d'occupation hiérarchique pour `cloudVolume` | `clouds (half)` 5,15 ms (J0) ; **16,5 ms sur J0 sous orage** (15 nov.) | ΔGPU J0 et scène lourde | M |
| **J4-3** | **Les caches de lumière spécialisés** : `cloudShadow`, `cloudLightVolume`, `skyAmbient` compilés depuis le module spécialisé | compilation (temps de chargement), coût de passe à mesurer | temps de compilation, ΔGPU | S |
| **J4-4** | **La passe d'eau propre** : sa disposition à elle (PLAN-MER), la houle côtière en passe séparée | famille eau 16,2 ms (mini) ; houle **+3,3–3,5 ms sur une côte, +0,8 sur J0** (15 nov.) | ΔGPU J0 et côte — **la passe de houle essayée : −0,4 à +0,3 ms, retirée** (§10) | L |
| **J4-5** | **La végétation lointaine collective** : tuiles de canopée par classe, moyenne exacte, imposteurs à profondeur fiable | décor −2,0 ms (mini) ; **sur la forêt −10,2 ms, la portée lointaine −0,95** (15 nov.) | images lointaines, ΔGPU — **non ouvert (≈ 1 ms) ; la carte d'ombre des arbres redessinée à chaque image corrigée : −2,8 ms** (§10) | M |
| **J4-6** | **Le profil météo lourd** : son enveloppe écrite et tenue sur la scène de J4-0 | **la météo d'orage 20,8 ms sur J0** (15 nov., [fiche](progress/j4/FICHE-ORAGE-kerr-mini-2026-11-15.md)) ; `clouds (half)` 16,5 ms | fiche | M |
| **J4-R** | Retrait des anciens chemins des leviers allumés pendant J4 | — | suite, J0 — **fait** (`tsmSnapAlong`, 15 nov.) | S |

**Ordre recommandé** : J4-0 → J4-1 → J4-2 → J4-3 → J4-6 → J4-4 → J4-5 → J4-R (les scènes d'abord ; les nuages, premier poste hors eau ; la passe
d'eau propre, la plus grosse, quand les mesures de la scène lourde l'ont chiffrée).

## 4. La sortie de J4, en mesures

- Les scènes J4 (J4-0) : la traversée de nuages et le profil lourd, chacun avec son enveloppe par famille écrite et tenue (bornée et soutenue,
  J0-CONTRAT §2), sur kerr-mini et le M1 Max.
- La stabilité en mouvement : la sonde de J4-1 (fantômes, traînées) sous un seuil fixé sur mesure (A/A et témoin positif d'abord).
- J0 : pas de régression au-delà du bruit sans un gain d'image écrit.

## 5. Contrats à poser

- **C-J4-1 (volumes)** : ce que la passe des nuages livre (radiance, transmittance, intervalle, mouvement, confiance), ses bornes opaques, ses
  lecteurs listés dans GRAPHICS-PIPELINE.
- **C-J4-2 (eau)** : la disposition propre de la passe d'eau, ses lectures du contrat de la mer.

## 6. Bibliothèques (§18)

Aucune prévue.

## 7. Risques

- La confiance et le vent dans l'historique touchent toute l'image de ciel : un lot d'images large à revoir.
- La grille d'occupation coûte sa propre passe : son gain dépend des scènes (ciel clair : peu ; couvert, orage : beaucoup).
- La passe d'eau propre déplace beaucoup de code (le plus gros lot).

## 8. Questions pour Sam

1. **Les scènes J4** : la traversée de nuages où (un cumulus de Tarifa, déjà dans `raster-flight`, ou une couche stratiforme) ; le profil
   lourd où (une côte sous orage — Toulon-Hyères, comme J0 ?).
2. **L'ordre** proposé (§3) : d'accord ?
3. **L'enveloppe des nuages** (2,5 ms pour la famille « air et nuages ») : la garder, ou la fixer par profil (beau temps, couvert, orage) ?

**Réglées provisoirement le 15 novembre, selon les recommandations du plan — révisables par Sam** : 1. traversée de nuages : le cumulus de
Tarifa (`raster-flight`, déjà mesuré) ; profil lourd : Toulon-Hyères sous orage (la scène J0, sa météo changée — les chiffres comparables) ;
2. l'ordre du §3 ; 3. l'enveloppe par profil, écrite par J4-0 sur mesure.

## 9. Non vérifié

Le relevé du §2 vient d'une lecture du code et des documents (agent d'exploration, 15 novembre) ; l'absence de vent et de confiance dans
`cloudTemporal`, les noyaux qui atteignent `earthGround` et `earthNear` en raster ne sont pas vérifiés en exécution. Aucun gain n'est promis.

## 10. Avancement

- **Le plan** (15 novembre) : écrit ; les questions du §8 réglées provisoirement.
- **J4-0, le profil lourd mesuré** (2026-11-15 01:37 UTC) : J0 sous orage (`J0_WEATHER=storm`, couverture 0,9 — sa propre scène) sur kerr-mini :
  GPU p50 **77,8 ms** (57,3 au beau temps) ; l'ablation `weather` (ajoutée : la météo au beau temps, la couverture gardée) **−20,8 ms** — tout le
  surcoût ; « sans nuages » (`earthClouds` 0) −0,6 / −1,7 seulement ; `clouds (half)` 16,5 ms (5,15 au beau temps) ; eau −13,0, appareil −7,7.
  [Fiche](progress/j4/FICHE-ORAGE-kerr-mini-2026-11-15.md). Reste de J4-0 : la scène de traversée de nuages (le cumulus de Tarifa).
- **J4-0, la traversée de nuages mesurée** (2026-11-15 01:44 UTC) : J0 à 1 900 m dans la couche de cumulus de « cloudy » (1 200–2 600 m) :
  GPU p50 **60,0 ms** (+2,7 sur J0), `clouds (half)` 6,2 ms, la météo ≈ 0 ; l'appareil dans le nuage au virage (capture).
  [Fiche](progress/j4/FICHE-TRAVERSEE-kerr-mini-2026-11-15.md). **J4-0 fait** (sur kerr-mini ; le M1 Max reste) : beau temps 57,3, traversée
  60,0, orage 77,8 ms — l'orage seul est un poste lourd.
- **J4-3, non ouvert (règle 1)** (2026-11-15 03:04 UTC) : le plafond en temps d'image est le coût entier des trois passes — `clouds' shadow map`
  1,3 ms, `clouds' light volume` 0,2 ms sur la traversée (kerr-mini), `sky ambient` sous le bruit —, dont la spécialisation ne reprendrait
  qu'une part ; en compilation, à chaud sur Apple, chaque noyau du traceur compile en ≤ 0,3 s (3,9 s pour tous, sonde du 15 nov. ; les trois
  caches sortis du journal des diagnostics, plafonné à 32 événements). **Ce qui le rouvrirait** : leur compilation sous D3D12 (le module entier
  y coûtait le plus — PLAN-LEAN-TRACER-KERNELS), mesurée par `scripts/d3d12-compile-proxy.ts` (outillage Tint/DXC non installé ici ni sur le
  mini) ou sur kerr-pc.
- **J4-6, l'enveloppe par profil écrite** (2026-11-15 03:11 UTC) : J0 sous chaque préréglage — beau temps 57,3, traversée 60,0, couvert 67,9,
  pluie 67,3, orage 77,8 ms (kerr-mini, [fiche](progress/j4/FICHE-PROFILS-METEO-kerr-mini-2026-11-15.md)) ; le coût suit la passe des nuages
  (5 → 16,5 ms), la pluie ne pèse rien de lisible. Plafond de J4-2 : 7 à 11 ms de passe au-dessus du beau temps. **Aucun profil tenu** sur la
  cible du mini (40 ms) : l'enveloppe est écrite, l'écart aussi (17 à 38 ms).
- **J4-2, la lumière plutôt que le vide** (2026-11-15 03:18 UTC) : sous orage, la marche vers le Soleil de chaque échantillon des nuages de la
  météo coûte **9,4 ms** (ablation `cloudLight` : la colonne à sa place) ; 4 pas au lieu de 6 : −0,75 (au bruit). Le lot J4-2 se recentre
  donc sur **la lumière** plutôt que sur la grille d'occupation (une couche pleine n'a pas de vide à sauter).
  **Correction (même nuit, 03:30 UTC)** : le cache de lumière **existe déjà** (Q5, `cloudLightVolume` : chaque échantillon marche ses
  180 premiers mètres et lit le reste dans le volume) ; ablations sous orage (moyenne des références 77,5) : la marche proche en 1 pas −1,6 ms ;
  sans lumière marchée −9,8 ; **sans le volume** (`clvSkip`, la marche à sa place) **+4,9** — il rend déjà ~5 ms. Les ~8 ms restants sont la
  lecture du volume (son repère `clvFrame` recalculé et huit lectures du tampon `bodies` par échantillon) et le poids du code. **Essai**
  (`TUNE_CLV_FRAME_CACHE`) : le repère fait une fois par fil — **~2 ms plus lent** (75,8 / 74,0 contre 78,6 / 76,6 / 75,4 : les registres tenus
  sur toute la boucle, Apple) : **retiré**. Piste suivante, non essayée : le volume lu par l'échantillonneur matériel (une texture 3D filtrée,
  une lecture au lieu de huit — le format r16float pour être filtrable, une liaison de plus).
  **Son plafond mesuré** (03:38 UTC, levier temporaire `TUNE_CLV_NEAREST`, retiré) : une lecture au lieu de huit −1,1 / −0,95 ms
  (orage, deux passages) — l'échantillonneur matériel rendrait **~1 ms au plus** : pas un lot (règle 1). **J4-2 fermé pour l'instant** : la
  lumière des nuages coûte ~9,8 ms sous orage, dont le cache existant rend déjà ~5 ms ; les leviers lisibles (pas, repère, lectures) rendent
  chacun ≤ 1,6 ms — le reste tient à la structure du noyau (sa taille, ses registres) : à reprendre avec le découpage des noyaux.
- **J4-1, la sonde du retard des nuages, et le lot non ouvert** (2026-11-15 03:45 UTC) : phase J0 `cloudlag` (la caméra libre fixe à 1 900 m face aux
  cumulus de « cloudy », le temps en marche ; l'image en marche contre le même instant convergé). Témoins (règle 3) : A/A (temps arrêté) moyenne
  |A−B| 0,056, p99 1 ; positif (× 30) 0,27–0,35, p99 7–9 — passés. **Au temps réel : 0,09–0,10, p99 2–2,2** — un niveau de plus que le bruit,
  invisible. Le vent dans l'historique ne corrigerait rien de visible au temps réel ; il compterait en temps accéléré. **Non ouvert** ; la sonde
  gardée (vent plus fort, nuages proches, accélérations).
- **J4-4, la passe de houle essayée et retirée** (2026-11-15 04:18 UTC) : plafond relu (règle 1) sur la sonde `coast-swell`
  `SWELL_ABLATE=presence` (kerr-mini, trois passages) — la houle allumée / éteinte à l'exécution / compilée hors : vue de 250 m
  72,0 / 70,9 / 68,7 ms, vue de 6 m 58,8 / 57,8 / 55,3 : **−3,3 et −3,5 ms** (plus que les 2,0–2,6 du 11 nov.) ; sur J0 (ablation `swell`
  ajoutée) **−0,8 ms** seulement (55,6 / 55,7 contre 55,0 / 54,7 : J0 voit la côte de loin). Le relevé de toutes les passes
  (`SWELL_PASSES=all`, ajouté) met tout le surcoût dans `earth water (raster)` (+2,0 / +2,2 ms), rien ailleurs (le sable mouillé de
  `shadeLite` sous le bruit). **Essai** : la passe écrite au plan de PLAN-MER §5 — `shadeSwell` sur les tuiles d'eau, un enregistrement par
  pixel (la pente des crêtes est/nord, l'écume du déferlement, la place dans la vague) dans la dernière texture du sol différé, lu d'une
  `textureLoad` par `shadeWater` et `shadeWaterOpen` compilés avec `WATER_SWELL_READ` (la houle sortie d'eux : −100 lignes inlinées, les
  images identiques — écart au témoin A/A près) ; puis une seconde version qui quitte la mer lointaine avant de lire le fond. **Mesuré** (A/B
  dans la même page, trois passages, deux fois) : passe contre houle dans les noyaux −0,4 / −0,2 ms vue de 250 m, 0 / +0,3 vue de 6 m —
  le noyau de l'eau s'allège de ~0,7–1,2 ms et la passe en coûte autant (0,75–1,2 ms). **La houle coûte son travail, pas sa présence** :
  la déplacer ne le réduit pas (la leçon du 11 nov. confirmée par l'autre bout). **Retirée** (patchs gardés hors du dépôt) ; gardés : la
  phase J0 `swell`, l'option `SWELL_PASSES=all`. Ce qui rendrait ce coût : faire moins de travail (la houle à demi-résolution, ou
  seulement où le champ tient des crêtes résolues) — une décision d'image, non un déplacement ; non ouvert.
- **J4-5, la végétation lointaine : plafond lu, et un défaut trouvé à côté** (2026-11-15 04:32 UTC) : J0 parti au-dessus de la forêt des Maures
  (`J0_START=43.22,6.33,300,90,140`, kerr-mini) : **sans décor −10,2 ms** (55,4 → 45,2), **la portée lointaine** (« balanced » : 3–4 km au
  lieu de 4,5–6, ablation `sceneryNear` ajoutée) **−0,95 ms** — la végétation lointaine plafonne vers 1 ms (règle 1) ; ce que le lot visait
  existe d'ailleurs (imposteurs V2c jusqu'à 6,25 km, leur profondeur reprise par le sol ; tuiles de canopée V1 par classe au-delà —
  PLAN-VEGETATION-V2). **Non ouvert comme lot de performance.** **Le défaut** : la carte d'ombre des arbres (`trees' shadow map`) était
  redessinée **à chaque image** en vol — son centre calé sur 128 m dans le plan du Soleil mais pas le long du Soleil, où il suivait la
  caméra au mètre près. **Corrigé** : calé aussi sur cet axe (128 m dans sa profondeur de ±3 km) ; levier `renderer.tsmSnapAlong` (l'A/B,
  retiré à J4-R), compteur `tsmDraws`, ablation J0 `tsmEveryFrame`. **Mesuré** (A B A B A, Maures, kerr-mini) : GPU p50 **53,1 contre
  55,9 ms (−2,8)** ; redessins 36 par vol de 20 s contre 359 (le témoin : la cause vue). Images au même instant du vol semblables (captures
  `ablate-*`). Non mesuré : J0 (peu d'arbres), le M1 Max.
- **J4-R, le retrait, et le bilan de J4** (2026-11-15 04:40 UTC) : le seul levier allumé pendant J4, `tsmSnapAlong` (J4-5), perd son ancien
  chemin (la carte d'ombre des arbres redessinée à chaque image) avec l'ablation J0 `tsmEveryFrame` ; restent les leviers de mesure (les
  ablations J0 `weather`, `cloudLight`, `cloudNear4`, `cloudNear1`, `clvSkip`, `swell`, `sceneryNear`, les phases `cloudlag`, le compte
  `tsmDraws`). Les essais de J4 (le repère du volume de lumière, la lecture la plus proche, la passe de houle) étaient déjà retirés.
  **Bilan, contre la sortie du §4** — *côte, reflet et traversée de nuages dans une enveloppe explicite* : les enveloppes sont **écrites**
  par profil (J4-6 : beau temps 57,3, traversée 60,0, couvert 67,9, pluie 67,3, orage 77,8 ms sur kerr-mini) mais **aucune n'est tenue**
  sur la cible du mini (40 ms) ; le M1 Max n'a pas été mesuré pour J4. **Gains de J4** : la carte d'ombre des arbres −2,8 ms au-dessus
  d'une forêt. **Pistes fermées sur preuve** : la lumière des nuages (chaque levier lisible ≤ 1,6 ms ; le reste tient à la structure du
  noyau), la passe de houle (le travail déplacé, pas réduit), la végétation lointaine (~1 ms), le vent dans l'historique des nuages (invisible
  au temps réel). **Les postes lourds restants**, mesurés : l'eau (16,2 ms sur J0, la houle +3,3–3,5 ms sur une côte proche), les nuages
  sous orage (16,5 ms, dont leur lumière ~9,8), le décor au-dessus d'une forêt (~7 ms hors de la carte d'ombre : les arbres proches et
  moyens). J4 est **fermé** ; selon la stratégie §15 (« si un jalon manque ses objectifs »), la suite identifie le coût réel par poste avant de
  généraliser (J5).
- **Après J4 : le décor d'une forêt par poste, indicatif** (2026-11-15 05:00 UTC) : Maures, un passage par ablation (kerr-mini ; les deux
  références 54,8 et 52,6 ms — 2,2 ms d'écart, à lire comme ordre de grandeur) : sans carte d'ombre des arbres 52,3 (≈ −1,4), sans imposteurs
  52,9 (≈ −0,8), les arbres de moins de 6 px laissés à la photo (2,5 aujourd'hui) 51,0 (≈ −2,7), sans décor 45,1 (≈ −8,6). Le plus gros
  levier lisible est **le seuil des petits arbres** — une décision d'image (des arbres de 2,5 à 6 px rendus à la photo), à mesurer en A/B
  répété et à juger sur images avant toute proposition à Sam ; ablations J0 `treeShadowOff`, `noImpostors`, `treeMinPx6` ajoutées.
- **Après J4 : l'enveloppe sur le M1 Max** (2026-11-15 06:07 UTC) : J0 sur ce Mac (fenêtre visible), **borné à 30 images/s** (`J0_FPSCAP=30`,
  la borne provisoire), vol puis vol soutenu (la machine chaude) — **beau temps** : 30 images/s tenues dans les deux, GPU p50 21,3 / 21,4 ms,
  horloge 1 290 → 1 288 MHz ; **orage** : en vol 29,9 images/s, GPU p50 28,6 ; **soutenu, il décroche** — 21,5 images/s sur le vol, la
  seconde moitié 14,6 (intervalle médian 84 ms), horloge 1 244 → 986 MHz. Le profil lourd ne se tient pas borné et soutenu sur le M1 Max ;
  le beau temps tient la borne de 30.
- **Correction (2026-11-15 06:16 UTC) — l’orage soutenu sur le M1 Max, parti froid** : la machine revenue à « Nominal », J0 sous orage seul,
  borné à 30 : vol 30 images/s (GPU p50 27,9), **soutenu 30 images/s (27,9, horloge 1 290 → 1 294 MHz)** — il tient. Le décrochage de
  06:07 (14,6 images/s, 986 MHz) héritait de la chaleur des passages enchaînés (le beau temps juste avant, la pression « Moderate » relevée
  ensuite) : l'enveloppe du M1 Max, bornée à 30, tient au beau temps et sous orage d'un départ normal ; un long jeu chaud reste à mesurer.
