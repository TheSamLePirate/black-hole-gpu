# Exploration planétaire : implémentation et validation

État du 12 octobre 2026, branche `codex/earth-photorealistic`.
Suite du [plan de conception](PLAN-THIRD-PERSON-PLANETES-HERBE.md).

## Fonctionnement livré

Le personnage possède sa position en mètres dans le repère de la planète. Le vaisseau conserve son
état et sa position pendant l’exploration. **Maj + K** quitte un vaisseau posé et immobile, puis permet
de le rejoindre à moins de 3 m d’un accès. La touche est configurable dans les raccourcis. Un bouton
à l’écran propose la même action ; les sticks et boutons A/Y permettent de marcher, sauter et embarquer
à la manette. Sur écran tactile, des boutons directionnels et de saut complètent le bouton d’embarquement.

Le panneau « Placer le vaisseau » propose le mode « À pied » : il pose le vaisseau au lieu choisi
(latitudes et longitudes, clic sur le globe ou site) et fait aussitôt sortir l'astronaute à côté —
sur tout corps marchable (les géantes gazeuses et le Soleil refusés), des deux univers.
Les touches de déplacement de caméra libre, configurables selon le clavier, commandent la marche
relative à la caméra. Maj fait courir, Espace saute, glisser orbite et la molette change la distance.
Marche : 1,4 m/s ; course : 4 m/s ; intégration physique à 120 Hz, indépendante du débit des images.
La gravité et la normale sont locales : WGS84 sur Terre, surfaces sphériques ailleurs, repère de longueur
propre pour Mann et Edmunds ; Miller utilise son plan de contact marin entre les vagues. Les géantes gazeuses sont refusées. Les sauvegardes conservent
l’exploration et restent compatibles avec les anciennes sauvegardes.

Les contacts proches utilisent le relief et les volumes OSM des bâtiments, ponts et troncs. Les cours
intérieures restent traversables et les ponts distinguent tablier et passage dessous. La caméra réduit
sa distance devant un obstacle. Le vaisseau posé est un obstacle : la boîte de son maillage (train sorti),
placée sur le corps, arrête la marche, la caméra et repousse hors de la coque un accès estimé à l’intérieur.
Les accès restent des points estimés selon le type : pas encore de portes animées.

## Le modèle de false-earth

Il s’agit du véritable astronaute demandé, avec combinaison orange, casque, sac, rig et textures de la
révision `468a0cfd71698400103198a8eb91d5176fe4f59e`. L’utilisateur a confirmé sa licence CGTrader avant
l’import. [Provenance et reconstruction](../assets/character/README.md).

Le moteur conserve son WebGPU natif, sans ajouter Three.js ou React. Un import hors ligne convertit
les modèles glTF/Draco en données natives compressées. Le personnage compte 51 654 sommets,
90 827 triangles et 70 articulations. Les poses repos/marche/course se mélangent sur CPU, puis les
sommets sont déformés sur GPU. Le clip de marche arrière est importé mais n’est pas utilisé ; le
personnage se tourne vers la direction de déplacement.

Les huit textures utilisent albédo, métal, occlusion et normales, avec éclairage HDR, ombrage GGX et
ombres propres et au sol. Une carte d’ombre 512² et un filtre PCF adoucissent l’ombre du personnage.
Les bâtiments et arbres occultent aussi son éclairage direct. L’éclairage ambiant et les reflets du
casque restent approximés : ce n’est pas un éclairage global complet.

## Herbe et contact au sol (première version, remplacée : voir « Le sol vivant » plus bas)

L’herbe s’active uniquement à pied, sur Terre, dans les prairies confirmées par la classe 30 de
WorldCover. Les routes, voies ferrées, bâtiments, eaux et surfaces pavées du décor l’excluent.
Le mode avion, les autres planètes et les zones sans masque exploitable n’exécutent pas sa passe.

Les racines sont déterministes, limitées à 65 536, générées par tranches d’environ 1 ms, puis conservées.
Le GPU élimine les instances hors champ et produit trois commandes de dessin indirect : six segments
près du personnage, deux au-delà de 6 m, un au-delà de 16 m, rayon maximal 28 m. Vent et contact avec
le personnage courbent les brins. Une couverture analytique des pixels et un fondu à distance réduisent
les contours crénelés ; il n’y a pas encore de traces persistantes dans l’herbe ni d’ombres individuelles
de tous les brins.

À hauteur humaine, les différences entre contacts CPU et relief calculé en float32 pouvaient enfouir
le personnage. Un champ de hauteur partagé de 64 m, affiné jusqu’à 65 × 65 échantillons à 1 m, fournit
les mêmes hauteurs à la physique et au shader terrestre. Il est construit progressivement, publié
atomiquement et fondu à la bordure. La table utilise le buffer GPU existant, sans lecture GPU par image.

## Captures : attendre réellement la scène

Une première image ou un compteur à 60 fps ne prouve pas que le paysage est chargé.
`tests/e2e/lib/character-ready.ts` attend explicitement :

- Le shader spécialisé de rendu **et** celui d’éclairage, aucune compilation en attente et aucun chargement HD.
- Le modèle et ses textures, les racines d’herbe et le champ de hauteur affinés entièrement disponibles.
- Sur Terre : les cartes haute résolution, le terrain sans requête en cours ni échec, toutes les pages du pack régional,
  WorldCover et l’imagerie du décor reçus, un statut `ready` pour surface et décor.
- Puis 120 images GPU terminées sans changement des signatures de ressources ; une arrivée de données recommence l’attente.

La capture conserve un JSON `*-readiness.json` à côté du PNG. Un timeout laisse un diagnostic
`*-not-ready.json` et fait échouer le test ; il ne produit pas une capture de réussite incomplète.
Une compilation non sollicitée marquée `idle` n’empêche pas la capture ; les shaders effectivement
utilisés doivent être prêts. Les tests de contrôleur sans réseau n’exportent pas de capture terrestre.

La capture Cévennes vérifiée a reçu **128 tuiles de terrain sans échec**, **16/16 pages satellite**,
WorldCover/OSM et les shaders de rendu et d’éclairage. Les données satellite restent régionales ;
le décor WorldCover/OSM est mondial dans les limites de sa couverture.

## Coûts et limites visuelles

Budgets résidents supplémentaires de l’exploration : mesh environ 5,18 MiB, textures environ 10,67 MiB,
racines 1 MiB, listes GPU 0,75 MiB, carte d’ombre 1 MiB et profondeur 4 octets par pixel. Le champ
partagé utilise environ 16,5 KiB de hauteurs. Le contact CPU réutilise les données du décor, environ
3,70 MiB dans la zone mesurée. Les budgets du décor et des packs satellite s’ajoutent séparément.
Les textures et le mesh restent en cache après embarquement ; les passes de personnage et d’herbe
s’arrêtent, et la texture de profondeur est libérée.

Une mesure après chargement, sur ce Mac, à **960 × 540**, pixelRatio 1, traçage par blocs de 2,
33 440 racines, Cévennes, midi et ciel clair, a donné environ **14,6 ms** de médiane et **18,1 ms**
au 95e percentile des soumissions terminées, avec environ 60 images/s côté navigateur. Ce sont des
mesures de scène complète sur ce matériel et ces réglages, comprenant la fin de soumission ; elles
n’isolent pas le surcoût du personnage et ne garantissent pas 60 fps en 1080p sur tous les GPU.
Les timestamps des différentes passes peuvent recouvrir des travaux et attentes : leur somme
n’est pas une mesure fiable du temps total. Les JSON de performance des nouvelles captures permettent
la comparaison aux mêmes réglages après chargement.

La comparaison supplémentaire, dans exactement la même vue figée et après 150 images par mode,
a mesuré les 120 dernières soumissions de chaque mode :

| Mode | Médiane | 95e percentile |
|---|---:|---:|
| Fond seul, passe d’exploration désactivée pour la mesure | 13,2 ms | 16,7 ms |
| Fond + astronaute et ses ombres, herbe désactivée | 13,7 ms | 16,6 ms |
| Fond + astronaute et 33 440 racines d’herbe | 13,7 ms | 16,6 ms |

Le supplément médian est d’environ 0,5 ms dans ce cas. La différence entre herbe activée et désactivée
n’est pas résolue par cette mesure face à la variabilité ; cela ne signifie pas que son coût est nul.
Ce test change uniquement la passe proche et le réglage d’herbe, sans déplacer la caméra ni recharger
le fond. Les pipelines et données sont déjà prêts. Données : `remote-results/character-ab-performance.json`.
L’encodage natif du personnage/herbe relevait environ 0,1–0,3 ms CPU à l’arrêt ; le mouvement et les
reconstructions des racines/du terrain nécessitent une campagne distincte pour connaître leur pire cas.

Le modèle du personnage est détaillé et l’architecture borne le coût. **Le paysage complet n’atteint
pas encore un rendu photoréaliste AAA à pied** : silhouettes d’arbres analytiques, matériaux proches du
sol et détail métrique du terrain restent les principaux écarts. Le satellite 10 m ne décrit pas les
cailloux, feuilles, façades ou sols à quelques centimètres. Atteindre ce niveau nécessitera des assets
de végétation et matériaux plus riches, des LOD et une validation à la résolution cible ; charger plus
longtemps les mêmes données ne résout pas ces limites.

## Vérification et automatisation

`bun run e2e character` contrôle Terre/Lune/Mars, le vrai modèle, les raccourcis d’embarquement,
le saut et le rechargement d’une sauvegarde, puis l’herbe WorldCover réelle et les captures strictes.
`bun test` couvre l’invariance de mouvement, la gravité, les pôles, les accès, les collisions OSM,
la validation des sauvegardes et les outils TARS. `bun run check` contrôle types, format et compilation
réelle des dix modules WGSL sur le GPU du Mac.

TARS agit avec `character`, `/walk`, `/grass`, les touches configurables et les réglages. Il lit les
groupes `character` et `grass`, affiche `show_screen(character)` et attend `character_grounded`,
`character_on_foot` ou `character_boarded`. Les événements `character` et `grass` exposent les moments
et changements d’état. La console de test utilise `__bh.camera.character` ; voir [BH-API.md](BH-API.md).

Résultats locaux, sur ce Mac (aucune campagne distante) :

| Vérification | Résultat |
|---|---|
| Suite unitaire complète `bun test` | 759 réussis, 359 ignorés, aucun échec |
| Vérifications ciblées après les corrections de sauvegarde et de réglages figés | 36 réussis, aucun échec |
| `bun run e2e character`, dernière exécution | 2 réussis, 26 assertions, 54,5 s, aucune erreur GPU ou console |
| `bun run check` | Passe ; dix modules WGSL compilent sur Apple ; avertissements existants du dépôt |
| `bun run build` | Passe |

Les captures et leurs états de chargement sont dans `remote-results/character-grass*.png` et
`remote-results/character-grass*-readiness.json`. Les réglages modifiés à pied s’appliquent aussi quand
la simulation est figée, sans devoir avancer la physique. La caméra du personnage garde sa position.

## Passe AAA (12 octobre 2026)

Analyse puis corrections, toutes couvertes par des tests unitaires et par
`tests/e2e/character-aaa.e2e.test.ts` (à lancer sur les Macs : `bun run e2e character-aaa`).

| Défaut constaté | Correction |
|---|---|
| Le vaisseau, composité après le personnage, recouvrait l’astronaute placé devant lui (au moment même d’embarquer). | La passe du personnage écrit sa distance (`rg16float`, distance × couverture) ; `ship.wgsl` la lit comme l’occulteur de la station : la coque disparaît derrière l’astronaute et l’herbe. |
| Le vaisseau vu à pied n’était caché par rien du décor tracé (arbres, bâtiments, relief devant lui). | Le vaisseau placé pour une vue extérieure est testé contre la profondeur tracée, comme les autres engins. |
| L’ombre du vaisseau sur le sol disparaissait dès la sortie (spectateur, à pied). | Le traceur lit sa carte d’ombre dès que le vaisseau est dessiné. |
| Éclairage du personnage et de l’herbe ad hoc : transmission `exp(-0,15/élévation)`, ciel constant, même ambiance sur Mars que sur la Lune, nuages ignorés, personnage noir la nuit. | La sonde de lumière du vaisseau (tracée autour de la caméra) tourne à pied : harmoniques sphériques pour l’ambiance, lumière clé (étoile à travers l’atmosphère, horizon, relief), réflexions GGX préfiltrées dans la visière et le métal (split-sum, occlusion spéculaire). Repli sur l’ancienne estimation si la sonde n’est pas fraîche. |
| L’astronaute et l’herbe ne recevaient pas l’ombre du vaisseau. | Lecture de la carte d’ombre du vaisseau (comme `trace.wgsl shipShadow`) pour la peau, l’herbe (au tri GPU) et l’ombre portée au sol. |
| Ombre portée au sol : facteur fixe 0,68, double assombrissement dans l’ombre d’un arbre. | Part physique de la lumière clé (clé·cos / (clé·cos + ciel)) : noire sur la Lune, douce sous le ciel terrestre, nulle la nuit ; pas d’ombre ajoutée là où le décor ou le vaisseau ombrent déjà ; occlusion de contact sous les pieds. |
| Ombre du personnage coupée à 3,5 m par soleil bas. | Un récepteur au-delà de la profondeur de la carte est derrière tous les occulteurs. |
| Sol de marche à facettes (normale bilinéaire discontinue par cellule de 1 m), normale calculée à chaque pas de la marche du rayon. | Normale lissée (pentes aux coins par différences centrées, interpolées), calculée seulement à l’ombrage, fondue au bord de la grille. |
| Saut rigide : rien sans être au sol, contrôle total en l’air, vitesse d’animation incluant la chute, aucune réception. | Buffer de saut 0,15 s, coyote time 0,12 s, contrôle aérien 2,5/s (14/s au sol), vitesse de pas mesurée le long du sol, amorti de réception (ressort amorti, ≤ 15 cm), foulée figée en l’air. |
| Messages de refus en français seulement, touche de saut écrite « Espace » en dur. | Messages anglais traduits par `t()`, touche lue dans les raccourcis. |
| Décor OSM : `pending` faux pendant un téléport (capture d’une place vide), une reconstruction partielle effaçait les arbres, abandon définitif après 2 échecs. | `pending` tant que la scène voulue n’est ni dessinée ni en attente de nouvel essai ; scène dessinée gardée si la reconstruction a des erreurs ; nouvel essai à 30 s doublé jusqu’à 5 min. |
| Pages satellite définitivement en échec après une coupure réseau d’une seconde ; `pending` vrai pour toujours après `dispose`. | Nouvel essai par page à 2 s doublé jusqu’à 1 min ; `dispose` vide les travaux. Le worker KTX n’est plus abandonné pour la session après un échec de chargement. |

Restent hors de cette passe : IK des pieds sur les pentes, portes animées, assets de végétation
photogrammétriques (les arbres restent analytiques).

## Le sol vivant (herbe AAA, 12 octobre 2026)

L’ancienne herbe (racines générées sur CPU par tranches, 65 536 au plus, un seul type, seulement en prairie
WorldCover) est remplacée par une végétation entièrement créée sur GPU à chaque image, d’après l’herbe de
[false-earth](https://github.com/momentchan/false-earth) (MIT) : réseau de points fixe dans le monde, touffes de
Voronoï, brins en courbes de Bézier, inclinaison vers la caméra, LOD indirects. Réécrite en WGSL natif.

| Élément | Comment |
|---|---|
| Réseau | ~750 × 750 points espacés de 7,5 cm autour de l’astronaute (≈ 178 brins/m² en prairie), chaque point décalé par son propre hash : le même brin au même endroit à chaque image. Repère fixe sur le corps pour 1,5 km. |
| Sol | Grille CPU de 1 m (81 × 81, recentrée par pas de 8 m, cellules connues réutilisées, publiée entière) : hauteur, ce qui pousse (classe WorldCover, exclusions OSM routes/bâtiments/eau/revêtements, pistes) et couleur satellite. |
| Végétation | Prairie (fleurs, épillets, brins secs, chaume couché), cultures en rangs avec épis, roseaux avec panicules, garrigue en touffes, sous-bois, sol nu clairsemé, mousse — table unique `grass-layout.ts`. Teinte tirée de l’image satellite. Bords de classes effilochés par un bruit. |
| Distance | Tout jusqu’à 5 m, puis éclairci (18 % à 30 m) et élargi pour garder la couverture ; les brins s’enfoncent sur les 4 derniers mètres (pas de bord). 3 LOD (7, 4, 2 segments), capacités 36 864 / 90 112 / 98 304 (budget calculé et testé). |
| Vie | Rafales du vent de la météo qui voyagent sur le champ, frémissement par brin, poussée autour des jambes, traces de pas persistantes (anneau 128² de 12,5 cm) qui se relèvent en ~9 s. Rien ne pousse sous la coque du vaisseau. |
| Lumière | Sonde partagée (clé, ciel SH, reflets), translucidité (diffuse par la face arrière et lobe vers l’œil), normales arrondies, AO de profondeur, auto-ombrage de la canopée selon la hauteur du soleil, ombres du personnage (carte), des arbres/bâtiments (grille d’ombre 0,5 m calculée une fois par image) et du vaisseau. |
| Coût | Un compute qui rejette d’abord (portée, distance, vue), un compute d’ombre 129², un de traces 128², 3 dessins indirects du plus loin au plus proche (profondeur écrite, bords mélangés). Aucune lecture GPU→CPU dans la boucle (les compteurs sont relus en asynchrone pour les stats). |

Vérifié ici par rendu WebGPU headless (SwiftShader) de scènes synthétiques : prairie, champ, roseaux, garrigue,
contre-jour, vue plongeante, marche. Reste à mesurer sur les Macs : `bun run e2e grass-aaa`.
