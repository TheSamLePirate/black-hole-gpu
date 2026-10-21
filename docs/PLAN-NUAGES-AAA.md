# Plan — nuages, brouillard, pluie et orage de qualité AAA, au meilleur coût (21 octobre 2026)

Branche `plan-rendu-raster-aaa`. Suite de [PLAN-RENDU-RASTER-AAA.md](PLAN-RENDU-RASTER-AAA.md) (étape 3 : atmosphère et
nuages). Progression : [progress/raster-aaa/NUAGES.md](progress/raster-aaa/NUAGES.md).

## La demande (21/10/2026)

> « Améliore les nuages, best techno possible pour le meilleur rendu au meilleur coût performance (brouillard, pluie et orage
> aussi), illumination et ombres correctes. »

## L'état de départ (inventaire du 21/10/2026)

Quatre représentations, composées par `earthLook` (trace.wgsl) en une seule couverture, une radiance et une distance :

- `cloudVolume` : la couche de la carte (cube : alpha, ou les nuages du jour GIBS), 1,5–4,5 km, 16 échantillons
  quadratiques, une même gigue ; densité = couverture 2D × fBm de bruit haché (jusqu'à 6 octaves) × trois `dnoise`.
- `wxCloud` : jusqu'à trois couches de la météo (préréglages, METAR, Open-Meteo) dans 250 km, 16 échantillons chacune.
- la couche plate de la carte (orbite, loin) et les cirrus (une coquille à 9 km).
- **Lumière** : pas de marche vers le Soleil — l'épaisseur optique solaire est une colonne verticale de la couverture 2D
  (ni ombre entre cumulus, ni cœur sombre) ; deux lobes de Henyey-Greenstein, octaves de diffusion multiple (Wrenninge),
  « powder » ; l'ambiante une couleur constante (ni ciel réel, ni sol renvoyé).
- **Ombres** : au sol, la couverture 2D projetée depuis 6 km (la couche est à 1,5–4,5 km : décalées au Soleil bas) et les
  couches météo en 2D ; **l'avion, les personnages, l'herbe ignorent les couches météo** (la lumière clé et la sonde lisent
  la seule coquille de la carte) ; l'air et le brouillard jamais ombrés (pas de rayons crépusculaires).
- **Brouillard** : une nappe à altitude fixe au-dessus de la mer, éclairée uniformément ; la brume selon la visibilité.
- **Pluie** : traînées en écran, gouttes sur la verrière, sol mouillé, son (PLAN-PLUIE) ; **aucun rideau de pluie dans le
  volume, aucun éclair**, l'orage une couche uniforme épaisse.
- **Coût** : dans le pipeline raster, chaque pixel ombré marche jusqu'à quatre volumes (16 à 48 échantillons) ; pas de
  passe propre aux nuages, ni de saut d'espace vide, ni de reprojection propre (les nuages reprojetés avec la profondeur
  du sol : traînées en parallaxe).

## Les techniques retenues

La référence de l'industrie pour des nuages volumétriques en temps réel qu'on traverse en vol : **Nubis** (Guerrilla —
Schneider, SIGGRAPH 2015, 2017, 2022 ; *Nubis³*, 2023), **Hillaire** (Frostbite 2016 ; ciel et atmosphère 2020), Microsoft
Flight Simulator. Leurs principes, adaptés à ce moteur :

1. **Une passe de nuages à part, à demi-résolution, reprojetée** — le levier de coût. Un seul milieu (carte, couches
   météo et cirrus réunis) marché une fois par pixel de demi-résolution, borné par la profondeur opaque du raster ; sortie :
   lumière diffusée, transmittance et profondeur du nuage ; un historique propre aux nuages, reprojeté avec **leur**
   profondeur ; la gigue en bruit bleu spatio-temporel. Les noyaux d'ombrage lisent ce tampon (remonté en résolution selon
   la profondeur) au lieu de marcher.
2. **Une vraie lumière** — rendue abordable par (1) : une marche vers le Soleil (quelques échantillons en cône, pas
   croissants), la diffusion multiple en octaves, l'effet « powder », **une ambiante physique du ciel partagée** par le sol, le
   décor et les nuages (le ciel clair calculé chaque image par le modèle de l'air, en harmoniques sphériques, à plusieurs
   altitudes — demande du 21/10), la lumière renvoyée par le sol sous les bases.
3. **Une carte de transmittance des nuages vue du Soleil** — une seule source d'ombre pour tout : le sol, les arbres,
   l'avion et la lumière clé, le cockpit, **les rayons crépusculaires** (la table de perspective aérienne la lit par tranche),
   l'ombre lointaine des nuages sur eux-mêmes.
4. **Des formes et des types** : cumulus, stratocumulus, stratus, cumulonimbus (enclume), profils verticaux par type ;
   bruits 3D cuits (Perlin-Worley, détail Worley, distorsion « curl ») à la place du bruit haché ; une évolution lente.
5. **Orage, pluie, brouillard** : rideaux de précipitation dans le volume sous les bases, éclairs (la lumière dans le nuage,
   le ciel et le sol, le tonnerre retardé), brouillard de vallée suivant le relief et ombré, mouillage progressif.

## Étapes (chacune mesurée en vol, image et coût, contre la précédente)

| | Étape | Contenu | Preuve |
|---|---|---|---|
| N0 | **Référence** | scènes météo figées et en mouvement (cumulus, couvert, orage, brouillard ; Tarifa, Alpes) dans les tests de vol ; coût et image actuels | mesures enregistrées |
| N1 | **La passe de nuages** | demi-résolution, un milieu unique, bornée par la profondeur raster, historique et profondeur propres, gigue en bruit bleu ; les noyaux lisent le tampon | coût des nuages divisé, image égale ou meilleure, en mouvement sans traînées |
| N2 | **La lumière** | marche vers le Soleil, ambiante du ciel réel, sol renvoyé | cœurs sombres, liserés argentés, contre-jour ; coût borné |
| N3 | **La carte d'ombres des nuages** | transmittance vue du Soleil ; sol, décor, avion, lumière clé, rayons crépusculaires | ombres au bon endroit au Soleil bas ; l'avion à l'ombre sous un couvert |
| N4 | **Formes et types** | types de nuages, profils, bruits cuits, évolution | cumulus bourgeonnants, stratus, cumulonimbus et enclume |
| N5 | **Orage, pluie, brouillard** | rideaux, éclairs et tonnerre, brouillard de vallée ombré, mouillage progressif | une cellule orageuse lisible au loin, le brouillard dans les vallées |
| N6 | **La mer** (demande du 21/10) | la mer en raster (FFT existantes), son reflet du ciel physique et des nuages, l'écume, la transmission et la couleur de l'eau selon la profondeur, l'état de la mer selon le vent de la météo ; au meilleur coût | une mer crédible au Soleil bas, sous un couvert, par vent fort |

Invariants du dépôt : WGS84 partout, aucun phénomène existant supprimé (éclipses dans les nuages, nuages du jour, METAR),
réglages accessibles à TARS, le chemin tracé gardé comme référence.
