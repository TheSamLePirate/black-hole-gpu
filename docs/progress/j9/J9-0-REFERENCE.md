# J9-0 — Référence et diagnostic du proche

20 novembre 2026. **En cours** : Chamonix et inventaire établis ; les références vol bas, arbre isolé/superposition et le
coût soutenu sur les deux Macs restent à établir. Aucun gain livré. Code rendu de référence : `935fb201` ; modifications
locales documentaires, script d'inventaire hors frame. Préparation commitée dans `d5a28dea`.

## Chamonix sur kerr-mini

Sonde existante `walk-raster`, run `20261120-100137-j9-0-walk`, exit 0, 150 s. Commande :

```sh
bun scripts/remote.ts run --name j9-0-walk -- env E2E_PROBE=1 WALK_WAYS=false,true,near,false WALK_OUT=remote-results/j9-0-walk bun run e2e walk-raster
```

Thermique : 29 relevés, tous Nominal ; GPU médian 1277 MHz, CPU maximal 68 °C. Le harnais demande 1600 × 900, les captures
produites font 1920 × 1080 (fenêtre plein écran du mini). Les comparaisons suivantes sont celles de ce run, pas une référence
à 1600 × 900 ni une cadence bornée et soutenue.

| Voie | Images de la fenêtre | GPU p50 | p95 |
|---|---:|---:|---:|
| Tracé initial | 87 | 46,0 ms | 50,1 ms |
| Raster avec rayons des arbres proches | 28 | 144,8 ms | 149,0 ms |
| Raster sans rayons proches | 47 | 85,7 ms | 94,3 ms |
| Retour au tracé | 80 | 49,7 ms | 55,0 ms |

Le noyau `earth shade (raster)` rapporte 86,90 puis 21,63 ms dans les fenêtres de profilage distinctes. Plusieurs autres
libellés du profil présentent des durées incompatibles avec une somme de postes : ne pas les sommer ou les utiliser pour
attribuer un budget. La différence GPU totale 59,1 ms est un **diagnostic court avec perte d'image volontaire** ; le retour
au tracé varie de 3,7 ms. Ni répétition A/B indépendante ni test de performance soutenu.

Les captures ont été regardées : les couronnes tracées sont sculptées mais restent massives ; sans les rayons, elles
redeviennent ellipsoïdes et cônes lisses. Le personnage fantôme et le sol strié sont visibles dans les deux voies raster.
La géométrie doit remplacer ce travail, en payant son propre dessin, sans livrer ces formes lisses comme qualité proche.

Planche et graphique : [baseline.html](baseline.html). Captures : [raster](baseline-raster.jpg),
[sans rayons proches](baseline-raster-near.jpg), [tracé](baseline-traced.jpg).
Les PNG originaux et les journaux restent dans `remote-results/20261120-100137-j9-0-walk/`.

## Inventaire des modèles sources

`bun scripts/j9-tree-inventory.ts docs/progress/j9/models-baseline.json` produit les bornes réelles des sommets, indices,
cartes, segments et octets ; le SHA-256 du générateur permet de rattacher l'inventaire à sa source. Seed 1, comme la cuisson.
Douze modèles : 82 320 triangles, 6 684 640 octets bruts partagés (sans buffers intermédiaires, textures, compression ni LOD).
Les feuillus ont 12 368–12 588 triangles ; les palmiers 236. Ces comptes ne sont pas un coût GPU.

La cuisson existante a aussi été exécutée sur kerr-mini : `20261120-100521-j9-0-models`, exit 0, aucune erreur GPU ; 147 ms
rapportées par la cuisson, 14 couches exportées. La couche du feuillu large a été regardée : silhouette et couverture sont
une référence lointaine, pas une preuve de qualité sous la ramure. Source : artefacts et log de ce run.

Vérifications rapides : Biome du script, typecheck, 8 tests modèles/cellules/assemblage passent. Le script ne modifie pas
les modèles ni le runtime. La sonde existante ne vérifie que l'absence d'erreur GPU et tolère certaines attentes de données :
un exit 0 ne suffit pas à déclarer J9-0 complet.

## Surface proche proposée avant J9-3

La visibilité existante contient distance du sol (r), index local de l'arbre (g), distance de surface (b), code/attributs (a).
Ses cibles prennent déjà 28 octets par échantillon (rgba32float, rgba16float, r32uint). Une cible rgba16float supplémentaire
porterait ce total à 36 : vérifier explicitement la limite du device avant toute extension ; éviter ce coût par défaut.

Piste à prototyper : garder g positif et le code d'arbre 0 ; utiliser les 18 bits bas de a (actuellement 0 pour les proxies)
pour la normale octaédrique, écorce/feuille, un ombrage local quantifié et un marqueur géométrie. Le fragment rejette d'abord
le masque du feuillage, puis écrit profondeur réelle et attributs interpolés. Le matériau sait alors lire cette surface
sans refaire `forestCandidate`. Les proxies continuent d'écrire a = 0 ; les bâtiments gardent leurs codes existants.

Ce format n'est **pas encore adopté** : tester la précision des normales et de l'ombrage, les écritures partielles du sol,
les marques des ponts, la classification des lecteurs, le mouvement et les transitions. Une identité locale reste liée à la
révision de scène ; ne pas la présenter comme une identité mondiale stable. Aucun nouveau layout/pipeline dans ce lot.

## Conditions de poursuite

- J9-0 reste ouvert jusqu'aux autres scènes et à une référence exploitable sur M1 Max ; le passage lancé ici sous Heavy
  n'a qu'une valeur fonctionnelle/visuelle, pas de budget de performance.
- Le budget net de J9 sera comparé à image et résolution égales, avec le coût complet de préparation, tri, dessin, matériau,
  ombres et reconstruction. Aucun gain minimal n'est fixé sur une seule fenêtre ; zéro overflow et aucun contenu retiré.
- Les défauts visuels du personnage et du sol restent distincts de J9 ; ne pas activer la marche raster par défaut.

Passage local `remote-results/e2e-reports/20261120-090229-MacBook-Pro-de-olivier/walk-raster/01/summary.json` : exit 0, 43 relevés thermiques tous Heavy. Le harnais a toléré une attente de données à 90 s avant de finir les compilations. Ce passage ne fixe aucun budget M1 Max.
