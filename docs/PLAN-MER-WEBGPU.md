# PLAN-MER-WEBGPU — la mer au niveau de web-ocean, dans notre monde

**État (10 novembre 2026, soir)** : S0, S1 et S2 faits (mesurés, §4) ; S5 commencé (la sonde du vaisseau n'est plus reflétée loin de lui) ; S3, S4, S6 à faire. Demandes de Sam, le 10 au soir : « d'abord la mer WebGPU parfaite » ; « je veux
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
