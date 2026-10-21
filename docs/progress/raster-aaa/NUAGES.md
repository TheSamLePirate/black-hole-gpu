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
(la convergée a les hauts-fonds). Images : `img/vue-porto-soir.png`, `img/vue-gibraltar-matin.png`,
`img/mer-tarifa-hauts-fonds.png`.

Reste pour la mer : l'écume texturée (traînées le long du vent), les reflets des nuages au loin depuis la passe de nuages,
l'ombre des nuages sur l'eau (N3), le sable mouillé au rivage, le bruit du SSR stochastique en mouvement à mesurer.
