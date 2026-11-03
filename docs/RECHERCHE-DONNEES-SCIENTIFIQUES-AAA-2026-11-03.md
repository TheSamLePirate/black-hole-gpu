# Données scientifiques et géographiques pour la destination WebGPU AAA

**Recherche du 3 novembre 2026 — magnétosphères, aurores, Terre entière et système solaire.**

**Statut : analyse et recommandations, aucune intégration.** Ce document est le seul fichier créé pour cette demande. Aucun code, asset, plan existant ou journal n'est modifié ; aucun test, e2e, benchmark, serveur ou navigateur du projet n'est lancé. Aucun jeu de données volumineux n'est téléchargé. Les lectures de documentation et recherches Internet ne constituent pas une validation des fournisseurs en production.

Référence locale relevée : `29a88b9e69a5474a50ae0ce92d33253c3362ce69`, avec des modifications préexistantes dans le répertoire de travail. Certains documents lus contiennent déjà des entrées datées du 4 novembre : leur statut est rapporté comme documentaire, sans en déduire une nouvelle mesure. Les faits externes ci-dessous sont rattachés à leurs sources officielles ou aux publications originales.

**Guide de lecture :** §§1–3 pour les choix et l'audit ; §§4–5 pour AM0–AM8 ; §6 pour les USA ; §§7–9 pour la Terre entière et la géodésie ; §§10–12 pour les autres mondes et la physique ; §§13–15 pour les formats, les priorités et les limites ; §16 pour retrouver les portails.

## 1. Recommandation générale

La meilleure direction est une **bibliothèque de données physiques versionnées**, préparée en amont, qui alimente la simulation, les instruments, TARS et le rendu. Une collection de grandes textures ne suffit pas : elle doit conserver ses unités, son repère, sa date, son incertitude, ses zones sans mesure et ses droits de redistribution.

Les acquisitions les plus utiles sont :

1. **Magnétosphères :** IGRF-14 pour la Terre, JRM33 + CON2020 pour l'intérieur de la magnétosphère jovienne, Cassini 11+ pour Saturne, modèles multipolaires publiés pour Uranus et Neptune. Ajouter les champs externes appropriés ; les seuls champs internes ne produisent pas une magnétosphère réaliste.
2. **Aurores :** observations calibrées Juno UVS, Cassini UVIS, Hubble/JWST et spectres optiques des lunes ; NOAA OVATION pour la morphologie terrestre actuelle. Préparer des profils d'émissivité plutôt que copier les couleurs d'une image de presse.
3. **USA :** orthophotos USDA NAIP, relief USGS 3DEP/S1M et nuages LiDAR classifiés ; NOAA BlueTopo pour les côtes. Le couple image/terrain doit être choisi par emprise et millésime.
4. **Terre entière :** Sentinel-2 et composites WorldCover pour l'image, Copernicus GLO-30 comme socle altimétrique terrestre, meilleurs MNT nationaux au-dessus ; ArcticDEM/REMA pour les pôles, GEBCO 2026 pour le fond océanique. Mapterhorn est un agrégateur intéressant à qualifier, pas une nouvelle mesure homogène de toute la planète.
5. **Système solaire :** compléter les noyaux SPICE déjà utilisés, améliorer d'abord les repères, datums et petits satellites, puis les produits locaux LROC/HiRISE/HRSC, les cartes annuelles OPAL et les profils atmosphériques mesurés.

**Il n'existe pas, parmi les sources établies par cette recherche, un couple mondial ouvert « orthophoto décimétrique + terrain LiDAR métrique » uniforme.** Une couverture mondiale complète et une précision locale exceptionnelle nécessitent plusieurs niveaux de sources. Les zones sans acquisition conservent un repli explicitement moins précis.

## 2. Ce qui existe réellement dans le projet

### 2.1 Lectures et état constaté

| Domaine | État lu dans le dépôt | Conséquence pour les données à intégrer |
|---|---|---|
| Destination | [Analyse stratégique](ANALYSE-STRATEGIE-RENDU-2026-11-03.md), §§1, 7, 8, 19, 20 : migration progressive WebGPU, surfaces forward, modèles partagés, données préparées, 60 images réelles/s comme cible | Produire des données indépendantes du shader et des ressources GPU bornées ; aucune cadence nouvelle démontrée ici |
| Travaux récents | [Journal](../progress-to-destination.md) : T8 déclaré clos, Q6 en cours, changements de reconstruction documentés | Ne pas repartir du diagnostic d'octobre ni attribuer les problèmes de netteté à la seule résolution source |
| Contrats | [C0](progress/refraction-horizons/C0.md), [plan T/Q/H/R](PLAN-REFRACTION-HORIZONS.md), [pipeline Terre](PLAN-PIPELINE-TERRE-AAA.md) | Garder générations de surface, contact, lumière, profondeur et résidence communs |
| Aurore actuelle | `src/shaders/trace.wgsl`, `auroraLight`, `AUR_MAG` : dipôle constant, ovale procédural selon Kp, coquille 90–330 km, vert/rouge | C'est une approximation visuelle terrestre ; aucune archive aurorale multi-planète n'est actuellement consommée par ce chemin |
| Magnétosphères | [Plan AM0–AM8](PLAN-AURORES-MAGNETOSPHERES.md) : indiqué non commencé | La collecte des coefficients et des observations est un vrai préalable ; les phases restent des intentions |
| Géodésie Terre | `ellipsoid.ts`, `geoid.ts`, `geoid-grid.ts` : WGS84, EGM2008 ; grille du géoïde à 15′ | Très bon contrat de base ; sa résolution et les datums nationaux limitent une ambition centimétrique |
| Globe lointain | `earth-maps.ts`, [assets Terre](../assets/earth/README.md) : cubes jour/nuages, nuit, relief ETOPO 2022 réduit depuis 60″ | Repli orbital utile ; agrandir le fichier réduit ne recrée pas les détails du produit d'origine |
| Terre proche | `earth-tiles.ts` : Terrarium AWS, EOX `s2cloudless-2021`, GIBS et VIIRS 2016, IGN et swisstopo | Les sources mondiales et la date des lumières peuvent progresser ; préserver le streaming et le filtrage récemment travaillés |
| Interface nationale | `national.ts` : `id` limité à `ign` et `swisstopo`, hauteurs 256² « au-dessus de la mer », sélection par centre de tuile | L'extension mondiale exigera aussi un contrat de datum, une couverture par pixel et des identifiants de fournisseurs extensibles |
| Sol régional | [WorldCover/Sentinel-2](../assets/earth-surface/README.md), [plan Terre photoréaliste](PLAN-TERRE-PHOTOREALISTE.md) : packs 2021, RGBNIR, classes, KTX2 et manifeste | Réutiliser cette chaîne de préparation et sa traçabilité au lieu de créer un second système d'assets |
| Autres mondes | [Assets HD](../assets/planets-hd/README.md), `moon-tiles.ts`, `server/moon-tiles.ts` : LOLA, MOLA/HRSC 200 m, Mercure 665 m, Cérès 137 m, imagerie Trek/CTX, radar Vénus/Titan | Plusieurs bonnes données existent déjà ; leur fidélité ne se déduit pas de la seule taille des JPEG globaux |
| Géantes | [Plan planètes](PLAN-PLANETES-AAA.md), [volume des géantes](PLAN-GEANTES-VOLUME.md) : travaux déjà livrés, profil et vent partagés ; Jupiter Cassini/Juno 8K | Améliorer la contrainte scientifique et la date des cartes sans présenter une météo historique advectée comme une observation actuelle |
| Orbites | `ephemeris-files.ts`, `solar.ts`, `build-ephemeris.ts` : DE440 refitté 1990–2150, JUP365 refitté 1990–2100 ; modèles approchés ailleurs | Compléter les satellites et les orientations avant de remplacer une éphéméride déjà sérieuse |
| Ciel | [Assets ciel](../assets/sky/README.md) : HYG v4.4 et fond NASA/Gaia DR2 | Gaia DR3 est une amélioration possible ; conserver le traitement des étoiles brillantes et éviter leur double comptage |
| Météo | [Plan météo](PLAN-METEO.md) : état commun, METAR, vent, couches et pluie ; profils partiellement reconstruits | Les observations de surface ne décrivent pas seules les volumes nuageux et les vents en altitude |

La note d'Alex `puffs-bilan-qualite-aurores_2026-11-03-18-27-52.md` a également été lue dans la référence locale `origin/master` du dépôt voisin. Elle confirme son chantier magnétosphères/aurores ; elle n'apporte pas encore un catalogue scientifique à réutiliser. Aucun `fetch`, message ou changement dans son dépôt n'a été effectué ; fraîcheur distante non garantie.

### 2.2 Corrections à conserver avant une future intégration

Les documents existants restent inchangés ; les points suivants sont des corrections ou réserves pour leur prochaine révision autorisée.

- **Callisto possède des aurores optiques détectées ; Ganymède également.** L'article de de Kleer et al. (2023) rapporte les premières détections optiques de ces deux lunes et de nouvelles raies sur Europe. « Ganymède UV seulement » et « Callisto : rien à rendre » ne sont donc pas des conclusions scientifiques valides. Une détection télescopique ne garantit toutefois pas une visibilité à l'œil. [Publication originale, Caltech](https://authors.library.caltech.edu/records/k2ywp-g5y72).
- **JRM33 n'est pas un champ fiable « de degré 33 » par définition.** Le nom renvoie aux 33 orbites de la mission principale ; les coefficients sont bien contraints jusqu'au degré 13, avec de l'information utile jusqu'à 18. [Connerney et al., 2022](https://doi.org/10.1029/2021JE007055).
- **Un ovale magnétique et sa brillance sont deux problèmes différents.** Un champ donne des directions et des connexions ; la précipitation, les espèces, l'énergie des particules et la chimie déterminent les émissions. Les futurs fichiers doivent porter ces deux familles séparément.
- **L'extrapolation de WMM2025/IGRF-14 jusqu'à 2067 n'est pas une prédiction validée.** Le jeu prend 2067 comme époque de scène, alors que les modèles contemporains s'arrêtent à 2030 pour leur partie prédictive. Il faut un scénario déclaré au-delà, pas une précision fictive. [IGRF](https://www.ncei.noaa.gov/products/international-geomagnetic-reference-field), [WMMHR2025](https://www.ncei.noaa.gov/products/world-magnetic-model-high-resolution).
- **Le plan mondial du 23 octobre simplifie excessivement les datums.** `H_national + N_EGM2008` n'est pas une transformation universelle ; la garantie « écart toujours inférieur à 1 m » n'est pas établie. Les hauteurs orthométriques, normales, marégraphiques et ellipsoïdales demandent des opérations distinctes. [NOAA VDatum](https://www.vdatum.noaa.gov/).
- **ArcticDEM/REMA : le datum dépend aussi du canal de livraison.** PGC livre des hauteurs ellipsoïdales ; des services Esri les transforment en EGM2008. L'exception « ne jamais ajouter N » doit donc viser un produit précis. [Guide PGC](https://www.pgc.umn.edu/guides/stereo-derived-elevation-models/pgc-dem-products-arcticdem-rema-and-earthdem/).
- **Mapterhorn n'est pas un remplacement par simple changement d'URL.** Ses tuiles sont des WebP Terrarium 512² ; l'interface nationale actuelle annonce 256². Couverture, quantification, datums et décodage doivent être adaptés et qualifiés. [Accès Mapterhorn](https://mapterhorn.com/data-access/).
- **Le vent solaire NOAA a changé d'API en 2026.** Les anciennes URL `products/solar-wind/mag-*.json` et `plasma-*.json` ne sont plus une bonne base d'intégration. Voir §4.2.

## 3. Ce que « données hyper précises » doit signifier

Pour chaque produit, distinguer :

1. **Pas de grille / GSD** : distance entre échantillons. Une orthophoto à 30 cm ne place pas nécessairement ses objets à 30 cm près.
2. **Résolution effective** : information réellement résolue par le capteur et le traitement ; sur-échantillonner ne l'améliore pas.
3. **Exactitude absolue et relative** : décalage géographique, erreur de hauteur, coutures, précision entre points voisins.
4. **Métrique d'erreur** : RMSE, écart-type, LE90 et CE90 ne sont pas interchangeables sans hypothèses.
5. **Validité spatiale/temporelle** : emprise, trous, date de prise de vue, époque du modèle, saison et qualité locale.
6. **Nature** : mesure, réanalyse, modèle empirique, estimation par apprentissage ou détail procédural.
7. **Réutilisation réelle** : téléchargement, transformation, cache, diffusion au joueur, attribution et coût d'hébergement.

Un même fournisseur peut livrer plusieurs produits de statuts différents. Les fiches ci-dessous sont **vérifiées documentairement** ; ni CORS, ni débit, ni disponibilité d'une tuile réelle, ni coût de conversion ne sont mesurés pendant cette session. Les vérifications réseau anciennes de [DATA-SOURCES-MONDE.md](DATA-SOURCES-MONDE.md) gardent leur date du 23 octobre et ne sont pas renouvelées ici.

## 4. Magnétosphère et aurores terrestres

### 4.1 Champ interne : IGRF-14 d'abord, WMMHR si l'instrumentation le justifie

**IGRF-14** est le premier choix pour AM0 : coefficients de Gauss téléchargeables, historique depuis 1900, évolution séculaire et références géocentriques/géodésiques documentées. Conserver le modèle complet pour le calcul CPU de référence ; choisir ensuite une réduction selon l'erreur acceptable. Un dipôle reste un repli explicitement approximatif. [NOAA/IAGA : coefficients et logiciels](https://www.ncei.noaa.gov/products/international-geomagnetic-reference-field).

**WMMHR2025** est intéressant pour une boussole ou une cartographie fine du champ : noyau aux degrés 1–15 et champ crustal 16–133, validité 2025–2030. Cela n'apporte pas les courants de la magnétosphère externe. Sa résolution annoncée d'environ 300 km ne correspond pas à du détail local métrique. [NOAA : WMMHR](https://www.ncei.noaa.gov/products/world-magnetic-model-high-resolution).

**Décision proposée :** IGRF-14 comme autorité terrestre temporelle ; WMM/WMMHR comme produit distinct d'instrumentation si nécessaire, jamais deux modèles additionnés qui compteraient deux fois le noyau. Distinguer aussi pôle géomagnétique du dipôle et pôle magnétique où le champ est vertical.

### 4.2 Conditions extérieures : NOAA pour maintenant, OMNI/GFZ pour le passé

| Donnée | Source à retenir | Usage et limite |
|---|---|---|
| Kp, ap, Ap, F10.7 historiques | [GFZ : téléchargement et API](https://kp.gfz.de/en/data) | Kp est un indice sur 3 h, disponible depuis 1932 ; distinguer provisoire et définitif. GFZ annonce CC BY 4.0 [sur sa page principale](https://kp.gfz.de/en/) |
| Vent solaire et IMF actuels | [NOAA : Solar Wind](https://swpc-drupal.woc.noaa.gov/products/solar-wind) | Densité, vitesse, température, champ et source satellite ; conserver qualité et âge des données |
| Historique à haute cadence | [NASA OMNI haute résolution](https://omniweb.gsfc.nasa.gov/html/omni_min_data.html) | Séries 1 et 5 min, propagées au nez de l'onde de choc terrestre ; ne pas appliquer une seconde fois le délai L1 → Terre |
| Morphologie aurorale courante | [NOAA OVATION](https://swpc-drupal.woc.noaa.gov/products/aurora-30-minute-forecast) | Prévision empirique globale à court terme ; ni caméra de chaque arc, ni mesure volumétrique |

**Changement de contrat à prendre en compte :** l'avis officiel NOAA SCN 26-21 annonce la suppression des anciens produits RTSW vers le 30 avril 2026. Les remplaçants indiqués sont :

```text
https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json
https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json
https://services.swpc.noaa.gov/json/rtsw/rtsw_ephemerides_1h.json
```

Ils portent notamment `source` et `active` ; les paramètres plasma deviennent `proton_density`, `proton_speed`, `proton_temperature`. L'avis modifie aussi certains JSON d'indices en objets à valeurs numériques. Prévoir validation de schéma et sélection de la source active, plutôt qu'un parseur de tableaux hérité. **Ces URL sont documentées, pas interrogées comme flux pendant cette étude.** [Avis NWS, 2 mars 2026](https://www.weather.gov/media/notification/pdf_2026/scn26-21_Data_Format_Changes_Impacting_SWPC_Products.pdf).

Ne pas utiliser les valeurs « maintenant » pour une scène datée de 2067. Trois états produit sont nécessaires : réel actuel, historique archivé, scénario synthétique. Une interruption du flux doit devenir une donnée périmée ou un scénario de repli lisible, jamais une observation inventée.

### 4.3 Champ externe : la pièce qui manque aux seules harmoniques internes

**T96** est un candidat pragmatique pour une première magnétosphère déformée ; **TS05** permet une réponse d'orage dépendant de l'histoire du forçage, avec davantage d'entrées. Ils décrivent les contributions de systèmes de courants. Leur sortie est un champ en coordonnées GSM ; TS05 demande notamment des intégrales temporelles supplémentaires. Conserver domaine et limites de chaque modèle. [NASA CCMC : famille Tsyganenko](https://ccmc.gsfc.nasa.gov/models/Tsyganenko%20Magnetic%20Field~TS05/).

**Proposition AM0/AM7 :** champ interne + champ externe compatibles, puis intégration des lignes dans un worker. La magnétopause constitue une frontière ; elle ne remplace pas le calcul du champ. L'onde de choc est une autre surface et demande son propre modèle. La forme de Shue peut servir à la magnétopause terrestre ; sa copie mise à l'échelle sur toutes les planètes doit être marquée schématique.

Référence précise pour la frontière terrestre : [Shue et al., 1998, DOI 10.1029/98JA01103](https://doi.org/10.1029/98JA01103). Conserver pression dynamique et IMF Bz avec leurs unités et le domaine de calibration ; ne pas confondre ce modèle de frontière avec un modèle vectoriel de champ.

### 4.4 OVATION et émission visible : garder les bonnes unités

NOAA OVATION s'appuie sur le vent solaire et l'IMF, avec un repli piloté par Kp lorsque les entrées sont indisponibles ; dans ce cas le délai de prévision disparaît. La carte publique et sa probabilité de visibilité ne sont pas des watts par stéradian. Le fichier [OVATION JSON](https://services.swpc.noaa.gov/json/ovation_aurora_latest.json) est un point d'accès à qualifier : vérifier exactement la grandeur et les coordonnées avant conversion.

Pour dépasser l'anneau actuel :

- employer la grille globale pour l'enveloppe, l'asymétrie jour/nuit et les hémisphères ;
- reconstruire le détail fin comme procédural contraint et déterministe, avec cette nature dans le manifeste ;
- préparer des profils verticaux dépendant des espèces, de l'énergie et du flux de précipitation ;
- appliquer extinction, occultation, lumière ambiante et exposition de la scène commune.

**GLOW**, développé au NCAR, constitue une référence de calcul des taux d'émission et des brillances intégrées à partir d'atmosphères et de précipitations. Il est plus adapté à une préparation de tables qu'à la frame WebGPU. Sa licence propre doit être lue avant toute réutilisation logicielle ; « code public » n'est pas synonyme de licence permissive. [NCAR : modèle GLOW](https://www2.hao.ucar.edu/modeling/glow), [documentation originale](https://github.com/NCAR/GLOW/blob/master/Glow.txt).

Pour les couleurs, employer les longueurs d'onde et probabilités de transition d'une référence spectroscopique, puis intégrer vers XYZ/RGB linéaire. [NIST ASD](https://www.nist.gov/pml/atomic-spectra-database) fournit les transitions atomiques ; [CIE 1931 à pas de 1 nm](https://cie.co.at/datatable/cie-1931-colour-matching-functions-2-degree-observer) fournit l'observateur colorimétrique. NIST ne remplace pas une base de bandes moléculaires N₂/H₂/H₃⁺. Une couleur physiquement calculée reste dépendante du mode de vision ou du capteur simulé.

Les maxima à 110 ou 200 km sont des modèles de profils, pas des altitudes universelles fixes. Les arcs rouges d'orage, airglow et phénomènes de type STEVE ne doivent pas être regroupés automatiquement sous le même mécanisme.

## 5. Les autres magnétosphères et aurores : données par corps

### 5.1 Jupiter : le meilleur prochain lot après la Terre

**Champ :** JRM33 pour l'interne, CON2020 pour le feuillet de courant. Le programme communautaire MOP/LASP distribue modèles, unités, repères et traceurs. Le rayon de normalisation est `R_J = 71 492 km`, en System III droit ; certaines interfaces utilisent colatitude et longitude est en radians. Ces conventions doivent accompagner les coefficients. [MOP : code et données communautaires](https://lasp.colorado.edu/mop/missions/juno/community-code/).

**Limite essentielle :** une comparaison des auteurs montre que JRM33+CON2020 convient particulièrement à l'intérieur et aux empreintes des lunes ; au-delà d'environ 15 R_J, une combinaison JRM33+KK2005 reproduit mieux certaines mesures, notamment les effets d'heure locale. Ce n'est pas la preuve qu'un couple unique couvre toute la queue et la frontière externe. [Rabia et al., 2024](https://arxiv.org/abs/2401.10115).

**Observations à acquérir :** produits calibrés Juno UVS et géométrie SPICE, complétés par MAG/JADE/JEDI pour les champs et particules. Les UVS sont des FITS contenant notamment des événements photons horodatés et calibrés, pas simplement des images RGB. Préparer cartes polaires avec temps d'acquisition, réponse instrumentale, couverture et incertitude. [PDS Atmospheres : UVS](https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/JUNO/uvs_new.html), [PDS/PPI : Juno](https://pds-ppi.igpp.ucla.edu/mission/Juno).

Pour les empreintes d'Io, Europe et Ganymède, associer position de la lune, traçage et décalage de propagation/lead angle ; un méridien posé directement sous la lune est insuffisant. Les statistiques d'ovales et les événements transitoires doivent être des produits distincts. Les hauteurs déduites de profils UV ne définissent pas automatiquement la couche visible.

**Licence du logiciel :** le dépôt [PSH](https://github.com/rjwilson-LASP/PSH) est sous GPL-3.0. Il peut servir de référence scientifique, mais le choix de l'embarquer ou d'en dériver un module n'est pas neutre. Examiner séparément droits des coefficients, code choisi et tables produites ; aucun portage n'est effectué ici.

**Frontières joviennes : une source plus récente à intégrer à l'étude AM7.** [Rutala et al. (2025), DOI 10.1029/2025JA033842](https://doi.org/10.1029/2025JA033842), proposent des frontières probabilistes magnétopause/onde de choc contraintes jusqu'à la mission principale Juno. Le modèle décrit notamment aplatissement polaire et asymétrie aube/crépuscule ; il représente des formes moyennes, avec un domaine limité dans la queue. Le code [JovianBoundaries](https://github.com/mjrutala/JovianBoundaries), MIT, fournit `find_Boundary` et des incertitudes ; [archive versionnée](https://doi.org/10.5281/zenodo.14851327). Comparer à [Joy et al. (2002)](https://doi.org/10.1029/2001JA009146) comme référence historique, plutôt que figer « 50–100 R_J » comme une frontière universelle.

Le vent solaire près de Jupiter est une estimation dédiée, pas le JSON terrestre retardé arbitrairement. L'étude référence **MMESH**, avec [données à la cible Jupiter](https://doi.org/10.5281/zenodo.14850361) et [code versionné](https://doi.org/10.5281/zenodo.14851000). Conserver son incertitude de propagation et sa couverture temporelle ; ce n'est pas une observation continue autour de toutes les planètes.

### 5.2 Saturne : champ interne précis, dynamique externe distincte

Retenir **Cassini 11+ de Cao et al. (2020)** avec ses tables et supplément. La publication contraint l'inclinaison à moins de 0,007° et décrit un décalage de l'équateur magnétique vers le nord ; la contrainte est moins bonne dans certaines régions polaires. Conserver les harmoniques utiles plutôt que remplacer le tout par un dipôle décalé décoratif. [Article et supplément, Caltech](https://authors.library.caltech.edu/records/gxeyz-fb531).

Pour l'externe, [Saturn-Mag-Model](https://github.com/NASA-Planetary-Science/Saturn-Mag-Model), sous BSD-3-Clause, est une piste plus adaptée qu'un modèle terrestre redimensionné. Vérifier ce que le modèle inclut déjà avant d'ajouter le champ interne. Pour les aurores : Cassini UVIS et ISS, occultations/profils, campagnes Hubble ; conserver le canal spectral. Les oscillations de période planétaire ne se déduisent pas d'une inclinaison interne quasiment nulle.

**À ne pas figer maintenant :** une altitude unique, un ovale parfaitement circulaire ou une teinte visible extrapolée d'un cliché UV. La morphologie et les profils doivent être choisis à partir d'événements calibrés.

Pour les frontières, étudier les modèles **Kanani et al. (2010)** pour la magnétopause et **Went et al. (2011)** pour l'onde de choc, plutôt qu'un Shue terrestre simplement redimensionné. La [synthèse de Jackman et al. (2019)](https://doi.org/10.1029/2019JA026628) relie ces modèles au catalogue des franchissements sur toute la mission Cassini.

### 5.3 Uranus et Neptune : davantage que des dipôles inclinés

| Corps | Champ à étudier | Données visuelles et limite de connaissance |
|---|---|---|
| Uranus | Modèles Voyager multipolaires, notamment Q3/AH5 selon le cas | Très forte inclinaison et décentrage : le dipôle seul perd la géométrie proche. JWST/NIRSpec apporte des contraintes ionosphériques et aurorales nouvelles |
| Neptune | Modèles Voyager, dont O8 ; comparer les solutions publiées | Les degrés supérieurs ne sont pas tous déterminés de manière unique ; une carte lisse très détaillée ne signifie pas un champ mesuré partout |

Deux ressources scientifiques concrètes permettent de partir des coefficients et des publications : [PlanetMag](https://github.com/NASA-Planetary-Science/PlanetMag), sous Apache-2.0, et [planetMagFields : liste des modèles](https://ankitbarik.github.io/planetMagFields/models.html). Elles sont candidates à la préparation/référence, pas de nouvelles dépendances installées. La documentation de planetMagFields signale d'ailleurs une correction de lecture IGRF-14 avant la version 1.7.0 : figer la version de tout outil de préparation.

Pour Uranus, les observations du **19 janvier 2025**, publiées le **19 février 2026**, proviennent du programme JWST **5073**, NIRSpec IFU, sur 15 h. Elles contraignent la structure verticale et montrent des bandes aurorales ; elles ne constituent pas une texture visible globale. Ce programme est un identifiant d'acquisition concret pour une recherche dans MAST. [Publication de l'équipe ESA/Webb](https://esawebb.org/news/weic2602/).

Pour Neptune, la [détection aurorale JWST publiée en mars 2025](https://science.nasa.gov/asset/webb/neptune-auroras-hubble-and-webb-image/) fournit une référence de localisation en infrarouge, pas une teinte à afficher à l'œil. Extraire les identifiants et calibrations de l'article associé avant de fabriquer une table. Ne pas présenter l'inclinaison issue de Voyager comme une mesure instantanée en 2026 ou 2067.

### 5.4 Mars, Vénus et Mercure

**Mars.** Employer un champ crustal vectoriel, avec son altitude et son domaine, puis des interactions externes. Le modèle Langlais et al. (2019), contraint par MGS/MAVEN, décrit une échelle bien plus grossière que le relief métrique. Une publication Delcourt et al. (2025) exploite davantage de données à basse altitude : comparer archive, validation et disponibilité des sorties avant de qualifier la solution la plus fine. [Langlais et al.](https://doi.org/10.1029/2018JE005854), [Delcourt et al.](https://doi.org/10.1029/2025JE009297).

L'observation visible du 18 mars 2024 par Perseverance est une très bonne scène de référence spectrale et géométrique ; sa détection ne valide pas des rideaux terrestres à tous les endroits. Distinguer aurores discrètes crustales, diffuses et protoniques. [Knutsen et al., article et données associées](https://pmc.ncbi.nlm.nih.gov/articles/PMC12077521/).

**Vénus.** Pas de dynamo globale détectée ; conserver une interaction induite plutôt qu'inventer un dipôle. Une étude de 2025 conclut à une aurore diffuse globale induite par les protons pour la raie verte à 557,7 nm. C'est une meilleure base que la seule détection de 2001 ; elle ne définit pas un ovale polaire terrestre. [Gray et al., 2025](https://doi.org/10.1029/2024JA032851).

**Mercure.** Les modèles MESSENGER publiés, notamment Anderson/Thébault/Wardinski, sont recensés avec références dans [planetMagFields](https://ankitbarik.github.io/planetMagFields/models.html). Pour une magnétosphère externe plus crédible, examiner [le modèle révisé KTH22 et sa validation](https://doi.org/10.1029/2023JA031529). Les précipitations à la surface et émissions X relèvent de la vue instrument ; ne pas dessiner de rideau atmosphérique visible sans source correspondante.

### 5.5 Lunes : champ propre, champ induit et émission ne sont pas synonymes

| Corps | Données et mécanisme à conserver | Conséquence proposée |
|---|---|---|
| Io | Interaction avec le plasma jovien, émissions en éclipse, empreinte sur Jupiter ; géométrie Galileo/Juno | Séparer lueur de la lune, panaches, tore et empreinte jovienne |
| Europe | Émissions optiques/UV et champ induit ; environnement jovien | Pas de dipôle intrinsèque constant présenté comme une dynamo mesurée |
| Ganymède | Champ intrinsèque publié, interaction avec Jupiter, aurores UV **et optiques** | Deux familles d'observations ; ne pas convertir automatiquement l'UV en visible |
| Callisto | Aurore optique détectée, propriétés du plasma encore peu contraintes | Réintégrer comme candidat faible en éclipse, avec incertitude explicite |
| Encelade/Titan | Interactions avec le plasma, panaches/atmosphère ; archives Cassini | Intérêt physique réel même si une aurore visible spectaculaire n'est pas établie |
| Lune | Champs crustaux et interaction avec le vent solaire | Utile aux instruments et scénarios plasma ; aucune obligation d'une aurore visible |

La correction Ganymède/Callisto et les raies doivent partir des tableaux de [de Kleer et al. (2023)](https://doi.org/10.3847/PSJ/acb53c), pas de couleurs d'illustration. Les images de mission et profils peuvent être recherchés dans [OPUS, PDS Ring-Moon Systems](https://opus.pds-rings.seti.org/), qui expose instruments, géométrie, filtres et observations.

**Autre ajout important pour Callisto :** Rabia et al. (2025) publient des observations in situ et à distance de son **empreinte UV sur Jupiter**, phénomène distinct de l'aurore propre à Callisto. [Publication, DOI 10.1038/s41467-025-62520-4](https://doi.org/10.1038/s41467-025-62520-4) ; [données déposées, DOI 10.5281/zenodo.15423510](https://zenodo.org/records/15423510), avec tableaux par figure. Les données sont accessibles au catalogue ; la licence précise du dépôt reste à relever avant redistribution. AM3 ne devrait donc pas limiter durablement le catalogue des empreintes aux trois autres grandes lunes.

### 5.6 Ceintures, particules et tore : un second produit physique

Des lignes de champ ne donnent pas une densité de particules ou une dose. Pour la Terre, [IRENE AE9/AP9/SPM](https://www.vdl.afrl.af.mil/programs/ae9ap9/index.php) constitue une référence de climatologie des électrons, protons et plasma, avec distributions statistiques. Pour Jupiter : Juno JADE/JEDI/Waves et les archives Galileo ; pour Saturne : Cassini MAG/CAPS/MIMI/RPWS.

**Proposition de données dérivées :** grilles de flux par énergie/espèce avec intervalles de validité, distinctes des courbes géométriques du champ. Les animations de giration/rebond/dérive utilisent des modèles de mouvement avec hypothèses explicites. Une visualisation ralentie au temps du joueur doit afficher cette échelle ; elle ne prétend pas suivre en temps réel chaque particule observée. Lignes, ceintures et onde de choc restent des surimpressions pédagogiques, distinctes de la lumière visible.

### 5.7 Livrables de données à préparer pour AM0–AM8

1. Coefficients originaux, publication, normalisation, unités, rayon, époque et licence.
2. Vecteurs de référence issus des auteurs, pour une future vérification indépendante.
3. Tables de lignes/connexions par état physique, avec modèle externe et frontière utilisés.
4. Cartes aurorales par canal, avec masque d'observation et temps d'acquisition.
5. Profils verticaux et tables spectrales ; la morphologie fine reconstruite est étiquetée procédurale.
6. Événements reproductibles : Terre historique, Jupiter à un périjove précis, lunes en éclipse, Mars le 18 mars 2024, Uranus programme 5073.

Ces produits suivent l'ordre AM0 → AM1 → AM2 → AM3 → AM7 décidé dans le plan ; aucune phase n'est déclarée livrée par ce rapport.

## 6. USA : l'ensemble ouvert le plus intéressant pour une grande région AAA

### 6.1 Imagerie : NAIP original, choisi par millésime

**Choix principal : USDA NAIP.** Le catalogue officiel décrit des acquisitions 2025 à **60 cm pour environ la moitié des États et 30 cm pour l'autre moitié**. Depuis 2018, le standard est 60 cm avec option 30 cm ; les anciennes acquisitions peuvent être à 1 ou 2 m. C'est une imagerie aérienne en saison feuillée, avec nuages possibles, pas un instantané uniforme des USA. Les produits RGB/RGBNIR sont dans le domaine public selon la fiche. [Catalogue USDA/Data.gov](https://catalog.data.gov/dataset/national-agriculture-imagery-program-naip-imagery).

**Accès exploitable :** [USGSNAIPImagery ImageServer](https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer) fournit une mosaïque et des champs `Year`, `acquisition_date`, `resolution_value`, `download_url`, `datum`. Son annonce de pixel à 0,3 m ne prouve pas que tous les rasters sources ont cette finesse. Préférer les téléchargements originaux pour une préparation pérenne, avec date et fournisseur par dalle ; le service peut servir à l'exploration et au raccord progressif.

**Point de vigilance :** [The National Map](https://apps.nationalmap.gov/datasets/) indique que **NAIP Plus** mélange NAIP et sources commerciales là où NAIP manque, notamment Alaska et certains territoires. La licence d'un produit fédéral original ne s'étend pas automatiquement à tout fond cartographique affiché. Ne pas aspirer indifféremment `USGSImageryOnly`, NAIP et NAIP Plus en supposant des droits identiques.

Pour le proche urbain : regarder les orthophotos des États/comtés et leurs métadonnées, puis n'admettre que les acquisitions dont les droits d'usage, de transformation et de redistribution sont explicites. Une belle image 7–15 cm locale peut battre NAIP ; elle ne devient pas pour autant une couverture nationale.

### 6.2 Terrain : 3DEP, S1M et LiDAR classifié

| Produit | Intérêt | Précision et limite à retenir |
|---|---|---|
| **3DEP DEM 1 m** par projet | Sol nu précis sur les zones LiDAR | Pas de grille de 1 m ; précision à lire dans le rapport du projet, coutures et dates variables |
| **S1M, seamless 1 m** | Harmonisation de projets dans une mosaïque, COG 10 × 10 km | Production engagée depuis mi-2025, disponibilité progressive ; ne pas annoncer les USA entiers couverts |
| **Nuages LiDAR LAS/LAZ** | Sol, végétation, bâtiments et tabliers de ponts séparables | La classe et le rapport qualité importent autant que la densité de points |
| **3DEP 1/3″** | Repli continu d'environ 10 m | Exactitude variable ; utile hors dalle métrique |
| **Alaska IfSAR 5 m** | Repli officiel là où le LiDAR manque | Autre niveau qualité, autre méthode ; ne pas lui attribuer la précision LiDAR |

Sources : [description officielle des produits 3DEP](https://www.usgs.gov/3d-elevation-program/about-3dep-products-services), [présentation S1M](https://www.usgs.gov/3d-elevation-program/new-product-3d-elevation-program-seamless-1-meter-digital-elevation-model-s1m), [Alaska 5 m](https://catalog.data.gov/dataset/5-meter-alaska-digital-elevation-models-dems-usgs-national-map-3dep-downloadable-data-coll). L'ouverture complète de certaines pages USGS a expiré pendant la recherche ; leurs fiches officielles indexées ont été consultées. Les produits et emprises exacts devront être relus lors de la sélection des dalles.

La spécification USGS donne, pour les surfaces non végétalisées, **RMSE verticale ≤ 10 cm en QL1/QL2**, avec densités minimales respectives de **8 et 2 impulsions/m²**, et cellules minimales de **0,5 et 1 m**. Ce sont des exigences de niveau qualité, **pas la précision garantie de tout produit 3DEP ni sous forêt**. [Lidar Base Specification, tableaux](https://www.usgs.gov/ngp-standards-and-specifications/lidar-base-specification-tables).

La mesure nationale du produit 1/3″ est un autre chiffre : USGS rapporte environ **0,82 m RMSE** pour le CONUS en 2022 et **0,53 m** pour le service dynamique évalué. Ne pas mélanger ces bilans avec les spécifications QL2 des acquisitions locales. [FAQ USGS sur l'exactitude](https://www.usgs.gov/faqs/what-vertical-accuracy-3d-elevation-program-3dep-dems?items_per_page=6&page=1).

**Produits à dériver :** MNT de contact, MNS visuel, hauteur de canopée, objets bâtiments et ponts. Un MNT enlève justement les ponts et bâtiments : il ne peut pas être l'unique support de collision d'un appareil qui roule sur un tablier. Conserver des supports dédiés, raccordés au service du monde prévu par C0.

### 6.3 Côtes, relief sous-marin et eau

**NOAA BlueTopo** est prioritaire pour les zones côtières américaines couvertes. Il distribue relief, incertitude et contributeurs, avec informations sur interpolation et sources. L'accès passe notamment par les GeoTIFF et le catalogue de tuiles sur le bucket NOAA. Le produit est public domain ; sa couverture reste en développement. [FAQ BlueTopo](https://nauticalcharts.noaa.gov/data/bluetopo_faq.html).

Associer 3DEP, produits topo-bathymétriques NOAA et BlueTopo après transformation verticale documentée. Au large ou en absence de couverture, revenir à GEBCO. Ne pas recopier la couleur bleue d'un hillshade comme texture de fond, ni traiter un zéro de profondeur comme une absence de donnée.

### 6.4 USA : datums et préparation

Lire pour chaque dalle le référentiel horizontal, sa réalisation/époque et le datum vertical : NAD83, NAVD88 ou référentiels territoriaux ne se réduisent pas à une étiquette WGS84. Employer les grilles et opérations officielles adaptées ; [VDatum](https://www.vdatum.noaa.gov/) couvre des transformations orthométriques, ellipsoïdales et marégraphiques dans ses domaines. Propager l'incertitude ; sa documentation signale aussi des limitations régionales. Ne pas supposer que l'outil accepte actuellement tous les formats raster en conversion directe.

**Premières régions proposées :** Edwards/Mojave/Death Valley pour le terrain sec et les altitudes négatives ; Kennedy/Floride pour pistes, marais, côte et eau ; une zone des Rocheuses pour pentes/forêts ; Anchorage pour les replis Alaska. Il s'agit de choix d'étude, **pas de dalles déjà vérifiées disponibles aux résolutions maximales**.

## 7. Terre entière : socle mondial et hiérarchie des données

### 7.1 Images : réflectance scientifique avant mosaïque d'affichage

**Socle recommandé : Sentinel-2 L2A et mosaïques officielles CDSE.** Les mosaïques trimestrielles proposent RGB et NIR à 10 m, avec nombre d'observations et NoData. Le traitement par quartile, bande par bande, produit un composite statistique ; ce n'est pas une photographie à une date unique. Employer les bandes et masques, puis préparer une apparence cohérente. Un polygone d'emprise mondial dans STAC ne garantit pas un pixel valide partout. [Documentation CDSE Sentinel-2](https://documentation.dataspace.copernicus.eu/Data/SentinelMissions/Sentinel2.html), [collection STAC](https://browser.stac.dataspace.copernicus.eu/collections/sentinel-2-global-mosaics).

Les [composites annuels WorldCover 2020/2021](https://esa-worldcover.org/en/data-access), déjà proches de la chaîne du dépôt, restent un bon premier socle reproductible. Leurs bandes RGBNIR à 10 m et leur licence CC BY 4.0 facilitent une préparation indépendante d'un fond cartographique commercial. La fraîcheur 2021 doit rester visible dans le manifeste.

**EOX** offre une mosaïque pratique et travaillée ; son usage gratuit est **CC BY-NC-SA 4.0**, et l'usage commercial relève d'une licence EOX spécifique. Deux choix valables pour l'avenir : obtenir une licence adaptée ou produire les tuiles depuis des données Copernicus dont les conditions conviennent. Changer seulement `2021` en `2025` dans une URL ne règle ni la radiométrie ni les droits. [EOX : conditions actuelles](https://cloudless.eox.at/documentation/license).

**Landsat et MODIS/VIIRS** complètent les trous, pôles et échelles lointaines. Une source SAR Sentinel-1 peut renseigner des structures, la glace ou l'eau sous les nuages, mais ne remplace pas une vraie couleur visible.

### 7.2 Relief terrestre : GLO-30 comme base, MNT nationaux au-dessus

**Copernicus GLO-30** : DSM de 1″, environ 30 m à l'équateur, WGS84/EGM2008 ; il inclut végétation et bâti. La fiche annonce une erreur verticale absolue **< 4 m à 90 %** et horizontale **< 6 m à 90 %**, avec limites et qualité locale à consulter. Les acquisitions radar principales datent de 2011–2015, avec sources de comblement plus anciennes. L'instance EEA-10 n'a pas le même accès libre que GLO-30/GLO-90. [Fiche Copernicus DEM et licence](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM).

**Recommandation :** socle de relief mondial conservant masques et qualité ; remplacement local par MNT LiDAR officiels. En forêt, ne pas poser une deuxième canopée haute sur un DSM déjà élevé par les arbres. Les dérivés de type FABDEM restent candidats sous réserve de leurs conditions exactes, sans être présumés redistribuables dans un produit commercial.

**Mapterhorn** peut accélérer cette fédération : Terrarium WebP 512², PMTiles mondiales z0–12 et archives régionales plus fines, extraits et miroirs documentés. Son intérêt est la distribution et la combinaison de sources ouvertes. [Documentation d'accès](https://mapterhorn.com/data-access/), [attributions et inventaire des sources](https://mapterhorn.com/attribution/).

Avant de le promouvoir en source principale, il manque une qualification locale de : provenance par zone, datum réellement conservé, DSM/MNT, trous fins, précision de quantification et raccords. Le chiffre de fournisseurs relevé dans l'étude du 23 octobre n'est pas un engagement de couverture ni un inventaire figé. **Choix proposé :** candidat pour le repli fin mondial et des packs régionaux, avec conservation des meilleures sources nationales directes.

### 7.3 Océans et pôles : indispensable pour « toutes les zones »

**GEBCO 2026**, publié en avril 2026, fournit une grille globale à **15″**, soit environ **460 m nord-sud**, et une grille **TID** décrivant les types de sources. Il existe aussi une version du relief sous la glace. Une cellule de 15″ n'est pas partout une mesure acoustique à cette résolution : une partie du fond est interpolée ou estimée. [GEBCO 2026](https://www.gebco.net/data-products-gridded-bathymetry-data/gebco2026-grid), [codes TID](https://www.gebco.net/gebco-tid-grid).

Les conditions placent le produit en domaine public avec attribution et obligations de ne pas en déformer la provenance ; les données sous-jacentes ne sont pas toutes livrées avec la grille. [Conditions GEBCO](https://www.gebco.net/data-products/gridded-bathymetry/terms-of-use).

**ETOPO 2022** reste un repli cohérent, déjà utilisé : le produit 15″ et ses identifiants de sources sont préférables pour une nouvelle préparation au produit 60″ actuellement réduit. Distinguer surface de glace et substratum. ETOPO est référencé à EGM2008 et documente l'addition de sa grille de géoïde pour obtenir des hauteurs WGS84. [Guide officiel ETOPO](https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2022/docs/1.2%20ETOPO%202022%20User%20Guide.pdf).

**Arctique : ArcticDEM** ; **Antarctique : REMA**. Les produits PGC à 2 m sont des DSM optiques, pas un MNT de sol nu garanti. Les bandes brutes peuvent avoir des défauts de recalage, nuages ou trous ; préférer les mosaïques qualifiées et conserver masques/dates. Les images commerciales ayant permis leur calcul ne deviennent pas libres avec les DEM. Certaines données Alaska postérieures à juin 2022 sont restreintes. [ArcticDEM](https://www.pgc.umn.edu/data/arcticdem/), [REMA](https://www.pgc.umn.edu/data/rema/), [conditions et limites PGC](https://www.pgc.umn.edu/guides/stereo-derived-elevation-models/pgc-dem-products-arcticdem-rema-and-earthdem/).

Le guide PGC présente les DEM ouverts sous **CC BY 4.0**, avec les exceptions d'accès indiquées ; conserver la politique d'attribution et les métadonnées du lot retenu.

Pour l'image antarctique, **LIMA** offre du Landsat historique en couleur à 30 m, pansharpené à 15 m ; la couverture Landsat s'arrête vers 82,5°S et les versions continentales complètent avec MODIS. Les niveaux d'étirement sont des traitements visuels à identifier. [Accès et produits LIMA](https://lima.usgs.gov/access.php), [limite polaire expliquée](https://lima.usgs.gov/).

Pour les mers européennes, **EMODnet DTM 2024** apporte une grille de 1/16′, environ 115 m, des statistiques et des DTMs locaux plus fins. **Ses profondeurs sont référencées à LAT**, pas automatiquement à EGM2008. [Documentation EMODnet](https://emodnet.ec.europa.eu/en/bathymetry).

### 7.4 Aucun trou silencieux aux pôles, à la côte ou à l'antiméridien

Le streaming proche actuel est largement Web Mercator. Sa limite autour de ±85,051° laisse les pôles hors de ce schéma. Préparer des pages polaires ou faces de cube avec adressage propre ; conserver un repli global pour les régions sans donnée fine. Une reprojection forcée dans Mercator n'est pas une solution au pôle.

Un pixel doit pouvoir dire : « observé à cette résolution », « interpolé », « repli », « eau », « glace », « sans donnée ». La côte et les frontières demandent des masques, et non le fournisseur du seul centre de tuile. Conserver les valeurs négatives valides, traversées de 180°, bords/paddings, convention centre de pixel et étendues de grille.

## 8. Couverture géographique : où prendre le meilleur couple image/relief

Ce tableau sépare les produits documentés dans cette recherche des pistes nationales déjà recensées le 23 octobre. **Une région n'est déclarée fine que sur l'emprise de ses acquisitions réellement publiées.** Les liens nationaux sont des points d'entrée de sélection, pas des garanties de disponibilité instantanée.

| Région | Images recommandées | Relief recommandé | Statut, droits et accès |
|---|---|---|---|
| **USA continentaux** | NAIP 30–60 cm selon millésime ; orthos locales si meilleures | 3DEP/S1M 1 m, LiDAR ; 1/3″ en repli | Documenté §§6.1–6.2 ; ne pas confondre NAIP et NAIP Plus |
| **Alaska / territoires USA** | Acquisitions publiques locales, Landsat/Sentinel-2 ; produit commercial éventuel distinct | 3DEP LiDAR/IfSAR 5 m ; ArcticDEM autorisé selon date | Disponibilité et droits à résoudre par zone ; aucune promesse NAIP uniforme |
| **France et outre-mer** | BD ORTHO, millésime par territoire | RGE ALTI, MNT LiDAR HD et MNS quand disponibles | [RGE et Licence Ouverte](https://www.data.gouv.fr/datasets/referentiel-a-grande-echelle-rge) ; déjà intégré en partie, ne pas remplacer par moins fin |
| **Suisse / Liechtenstein** | SWISSIMAGE, 10 cm dans les acquisitions adaptées | swissALTI3D ; distinguer raster original et maillage diffusé | [SWISSIMAGE](https://www.swisstopo.admin.ch/en/orthoimage-swissimage-10), [swissALTI3D](https://www.swisstopo.admin.ch/en/height-model-swissalti3d) ; précision/terrain variable, attribution swisstopo |
| **Espagne / Canaries** | PNOA 15–25 cm selon produit | MDT05/MDT02, puis troisième couverture LiDAR et MDE 0,5 m publié | [Spécifications PNOA](https://pnoa.ign.es/pnoa-lidar/especificaciones-tecnicas), [services IGN](https://www.ign.es/web/es/ign/portal/ide-area-nodo-ide-ign) ; contrôler disponibilité locale et licence du lot |
| **Pays-Bas** | PDOK RGB 8 cm / 25 cm | AHN MNT/MNS, produit et génération à sélectionner | [PDOK : orthophotos et CC BY 4.0](https://www.pdok.nl/-/nu-hoge-resolutie-luchtfoto-2024-bij-pdok) ; distinguer Quick Ortho et ortho définitive ; AHN détaillé dans l'inventaire local |
| **Allemagne / Autriche / Belgique / Luxembourg** | Orthophotos nationales/régionales, souvent décimétriques | DGM/DTM LiDAR nationaux, résolution selon lot | Pistes et URL dans [DATA-SOURCES-MONDE](DATA-SOURCES-MONDE.md), non toutes revérifiées ; licences par Land/région et droits des bâtiments séparés |
| **Norvège** | Sentinel-2 ; orthos uniquement selon droits de licence | DTM1 et nuages de points | [Kartverket](https://www.kartverket.no/api-og-data/terrengdata), [DTM1 officiel](https://data.norge.no/nb/data-services/df1adc4b-7575-351a-b9d4-4891decc8b16/dtm1-atom-feed-tjeneste) ; la disponibilité du terrain n'ouvre pas toutes les photos aériennes |
| **Suède / Finlande / Danemark / Baltique** | Orthos des agences, comptes ou clés selon service | Modèles nationaux de terrain ; LiDAR selon couverture | Suède : [produit Ortofoto](https://geotorget.lantmateriet.se/dokument/projects/ortofoto-nedladdning/released/2025.02/) ; inventaire local pour les autres. Confirmer la licence du produit précis, pas celle d'une autre couche « open data » |
| **Royaume-Uni / Irlande** | Sentinel-2 ; orthos locales dont les droits sont établis | EA LiDAR 1 m en Angleterre ; autres nations selon acquisitions | [DTM officiel Angleterre](https://ckan.publishing.service.gov.uk/dataset/lidar-composite-digital-terrain-model-dtm-1m) ; la fiche consultée ne renseigne pas sa licence : conserver la licence de distribution originale avant import. Ne pas étendre sa couverture à tout le Royaume-Uni |
| **Europe centrale, Balkans, Italie, Portugal** | Orthos des instituts et régions listés dans l'inventaire local | MNT nationaux/LiDAR, puis GLO-30 | Très bons candidats, mais qualification pays/produit encore nécessaire dans cette session |
| **Canada** | Orthos provinciales/municipales ; Sentinel-2 en continuité | HRDEM terrain/surface selon emprise, puis modèles nationaux plus grossiers | [Guide officiel HRDEM](https://download-telecharger.services.geo.ca/pub/elevation/dem_mne/highresolution_hauteresolution/HRDEM_Download_Instructions.pdf) ; pas d'orthophoto métrique nationale libre établie ici |
| **Mexique, Amérique centrale, Caraïbes** | Sentinel-2/Landsat ; orthos locales, dont INEGI à qualifier | GLO-30, MNT nationaux localement ; GEBCO/NOAA/EMODnet selon emprise marine | Un produit sous licence locale doit être qualifié avant d'être inclus dans un pack redistribué |
| **Amérique du Sud** | Sentinel-2 ; acquisitions publiques nationales/locales à sélectionner | GLO-30 ; LiDAR locaux ou terrain commercial si nécessaire | Aucun socle métrique uniforme établi ; conserver le repli global et la provenance par région |
| **Afrique** | Sentinel-2 et composites régionaux Digital Earth Africa | GLO-30 ; relevés LiDAR locaux quand ouverts | [Programme Digital Earth Africa](https://digitalearthafrica.org/) ; le gain principal est souvent la qualité des composites et des masques, pas un nouveau détail métrique mondial |
| **Moyen-Orient / Asie centrale** | Sentinel-2 ; image commerciale pour les lieux prioritaires | GLO-30 ; terrain local ou stéréo commerciale qualifiée | Déserts : attention au contraste faible, aux dunes mobiles et à la date ; droits et disponibilité nationaux non établis pour un lot fin uniforme |
| **Japon** | GSI `seamlessphoto`, source et date variables | DEM1A/5A LiDAR où publiés, autres DEM en repli | [Catalogue GSI officiel](https://maps.gsi.go.jp/help/use.html), [précisions des DEM](https://www.gsi.go.jp/kiban/faq) ; ne pas convertir « z18 » en garantie d'une ortho submétrique partout |
| **Chine / Inde / reste de l'Asie du Sud** | Sentinel-2/Landsat ; acquisitions supplémentaires selon licence | GLO-30 ; produits nationaux ou études locales à qualifier | Cette recherche n'établit pas de jeu national fin redistribuable pour l'ensemble de ces zones ; aucune résolution inventée pour remplir le tableau |
| **Asie du Sud-Est / Indonésie / Philippines** | Sentinel-2 avec composites multi-saison ; sources locales selon droits | GLO-30 ; DEMNAS/LiDAR locaux comme pistes de l'inventaire | Tropiques nuageux : priorité aux masques, trous et saisons ; ne pas qualifier un DSM forestier comme sol nu |
| **Australie** | Orthos des États ; Sentinel-2/DEA pour le socle | ELVIS : MNT/LiDAR disponibles, puis repli national/global | [Geoscience Australia : catalogue et limites](https://www.ga.gov.au/scientific-topics/national-location-information/digital-elevation-data). Le DEM 5 m historique cité ne couvre pas toute l'Australie en LiDAR |
| **Nouvelle-Zélande** | Aerial LINZ, acquisition et GSD par zone | LINZ National 1m DEM/DSM et nuages LiDAR disponibles | [Accès altimétrique LINZ](https://www.linz.govt.nz/products-services/data/types-linz-data/elevation-data/access-elevation-data), [données et licences LDS](https://www.linz.govt.nz/products-services/data/linz-data-service) ; vérifier trous et NZVD2016 |
| **Îles du Pacifique** | Sentinel-2/Landsat ; campagnes locales si disponibles | GLO-30 et relevés insulaires ; bathymétrie GEBCO/régionale | Masques côtiers fins essentiels ; petites îles absentes d'un produit grossier possibles |
| **Groenland / Arctique** | Sentinel-2/Landsat dans les emprises utiles ; mosaïques polaires | ArcticDEM, surface de glace ; géométrie sous-glace séparée | DSM ellipsoïdal PGC ou produit transformé selon accès ; date et licence à conserver |
| **Antarctique** | LIMA/MODIS et observations plus récentes sélectionnées | REMA 2 m, ETOPO/GEBCO de repli | Les images sources commerciales des DEM restent un autre produit ; centre polaire et plateformes flottantes à traiter |
| **Océans / banquise** | Couleur de l'eau, glace et nuages comme couches séparées, pas une ortho du fond | GEBCO 2026 ; BlueTopo/EMODnet et levés locaux | Le relief sous-marin ne définit ni l'état de mer, ni la marée, ni la surface de la banquise |

Le caractère moins détaillé de certaines lignes est volontaire : **l'existence d'un portail n'établit ni une licence de redistribution ni la couverture fine de tout le pays**. Le socle mondial permet de servir ces régions dès maintenant au niveau de précision réellement disponible.

### 8.1 Si l'on accepte des données payantes

Pour les lieux importants sans orthophoto ouverte, **Pléiades Neo** est une option d'acquisition : 30 cm natifs annoncés, précision de localisation de 3,5 m CE90, stéréo/tri-stéréo possibles. Le produit HD15 est un enrichissement visuel, pas une acquisition native à 15 cm. [Airbus : fiche Pléiades Neo](https://space-solutions.airbus.com/imagery/our-optical-and-radar-satellite-imagery/pleiades-neo/).

**WorldDEM Neo** constitue une piste de DSM global à pas d'environ 5 m, distinct d'un MNT LiDAR décimétrique. [Spécification fournisseur du DSM](https://elevation.oneatlas.airbus.com/assets/product-description/WorldDEM_Neo_DSM.pdf). Sélectionner une zone, le niveau de traitement et un contrat explicite pour dérivés, cache, téléchargement hors ligne et diffusion dans le jeu ; pas de prix global extrapolé ici. Une licence de consultation dans un SIG n'autorise pas automatiquement un CDN d'assets accessible aux joueurs.

## 9. Géodésie : le contrat qui conditionne toute la précision

### 9.1 Conversion correcte des hauteurs

Pour un produit réellement référencé au géoïde EGM2008 :

```text
h_ellipsoidal_WGS84 = H_EGM2008 + N_EGM2008
```

Pour un produit national :

```text
coordonnées source + époque + datum vertical
  → opération géodésique officielle et grilles requises
  → coordonnées/hauteur dans le référentiel de calcul du jeu
```

Pour un produit déjà ellipsoïdal, ne pas ajouter un géoïde une seconde fois ; vérifier aussi la réalisation de l'ellipsoïde et l'époque horizontale. Pour une profondeur LAT/MLLW, convertir le datum marégraphique avant de la combiner avec le fond ou la mer du jeu. Référence opérationnelle américaine : [NOAA VDatum et ses incertitudes](https://www.geodesy.noaa.gov/docs/est_uncertainties.html).

### 9.2 Limite actuelle du géoïde et valeurs sous la mer

Le commentaire de `src/system/geoid.ts` annonce, pour la réduction locale 15′, **7 cm RMS et jusqu'à 2,5 m d'écart** par rapport à la grille 5′ utilisée pour la produire. C'est une indication existante dans le code, **non remesurée ici et non une exactitude absolue du géoïde**. Une ambition décimétrique près d'une piste peut nécessiter une page locale plus fine et le modèle vertical national adapté. La [NGA distribue notamment une grille EGM2008 à 2,5′ et les coefficients](https://earth-info.nga.mil/index.php?action=w_egm-main&dir=w_egm).

Exemple concret de contrat à préciser : le commentaire de `national.ts` parle de LHN95 pour le terrain suisse, alors que la fiche du **raster swissALTI3D** annonce **LV95/LN02**. Le raster et le service de maillage ne doivent pas être assimilés sans consulter chacun leur documentation. La même fiche précise que des cellules 0,5 m peuvent être sur-échantillonnées, avec qualité différente entre LiDAR et corrélation stéréo d'altitude. [Fiche swisstopo](https://www.swisstopo.admin.ch/en/height-model-swissalti3d).

La convention actuelle décrite dans les règles du dépôt emploie `max(H, 0) + N` dans certains chemins. Pour une future couverture mondiale rigoureuse, il faudra distinguer **terre émergée à altitude négative**, fond sous-marin et surface d'eau. Écraser tout `H < 0` à zéro effacerait des dépressions réelles. Ce rapport signale cette limite ; il ne change pas le contrat existant.

### 9.3 Séparer les supports

Conserver au minimum : sol nu, surface du bâti/canopée, eau, glace et supports construits. Les DEM hydrologiquement corrigés peuvent avoir des creusements ou aplatissements utiles à l'écoulement qui ne correspondent pas à la surface d'une piste. Un MNT de terrain ne représente pas les façades, surplombs ou tunnels ; le volume proche vient de géométrie et de relevés adaptés.

La précision finale dépend du cumul des erreurs : acquisition, géoréférencement, transformation, quantification, rééchantillonnage et simplification. Ne pas annoncer la meilleure valeur d'une seule étape comme celle de toute la chaîne.

## 10. Autres corps solides : meilleures acquisitions visuelles et topographiques

### 10.1 Priorités par corps

| Corps | Image / matériau | Relief / forme | Ce que cela apporte au projet |
|---|---|---|---|
| **Lune** | Produits LROC calibrés et mosaïques photométriquement normalisées ; NAC locaux avec ortho correspondante | LOLA pour le global/polaire ; **SLDEM2015 512 ppd entre ±60°** ; DTMs locaux | SLDEM atteint environ **59 m à l'équateur**, exactitude verticale typique **3–4 m** ; ses altitudes sont relatives à 1 737 400 m, pas au géoïde terrestre. [USGS](https://www.usgs.gov/media/images/lro-lola-and-kaguya-terrain-camera-dem-merge-60n60s-512ppd), [accès NASA PGDA](https://pgda.gsfc.nasa.gov/products/54) |
| **Mars** | HRSC pour la couleur ; **CTX global 5 m monochrome**, HiRISE local | MOLA/HRSC **200 m déjà servi** ; DTMs HRSC/CTX locaux, HiRISE **1–2 m** | Le CTX du Murray Lab est distribué avec tuiles et cartes de raccords ; HiRISE apporte des ortho/DTM appariés, mais seulement sur des emprises locales. [CTX](https://murray-lab.caltech.edu/CTX/V01/TilePages/), [HiRISE DTM](https://hirise.lpl.arizona.edu/dtm/about.php) |
| **Mercure** | MESSENGER MDIS : mosaïques de réflectance et produits multispectraux selon usage | DEM global USGS **665 m déjà consommé**, MLA/local plus fin selon couverture | Préserver les modèles existants ; chercher le détail proche dans les acquisitions, pas dans une normal map inventée. Références de produits dans [les assets HD](../assets/planets-hd/README.md) et [PDS MESSENGER](https://pds-geosciences.wustl.edu/messenger/) |
| **Vénus** | Magellan SAR pour une vue radar ; spectres et prises de vue de surface pour une reconstruction visible | Altimétrie et stéréo radar, qualité et trous par produit | Le radar révèle rugosité et propriétés diélectriques ; son gris n'est pas l'albédo visible du sol. Le chemin actuel radar doit garder son identité instrumentale |
| **Cérès** | Dawn FC DLR, couleur calibrée et variantes de phase | HAMO **137 m déjà consommé**, LAMO/local à sélectionner | Réutiliser la correction des anciennes textures et le vrai relief déjà faits ; relever repère/sphéroïde dans le label de chaque nouveau produit |
| **Io, Europe, Ganymède, Callisto** | Voyager/Galileo et compléments Juno ; mosaïques USGS avec carte de résolution | Stéréo/photoclinométrie locales ; forme globale et trous explicites | Il n'existe pas de DEM métrique global démontré pour chacune ; le détail sous la résolution d'observation reste une reconstruction |
| **Encelade et lunes de Saturne** | Cassini ISS/VIMS, mosaïques calibrées et observations géométriquement sélectionnées | Produits stéréo/shape models selon lune | Meilleures silhouettes et grands accidents ; conserver la couverture très inégale |
| **Titan** | Cassini VIMS pour certaines fenêtres IR ; SAR pour le radar ; Huygens pour le site de descente | Altimétrie/SARTopo/stéréo Cassini et local Huygens | Une mosaïque radar ne donne pas la couleur à l'œil ; le relief global comporte de grandes zones moins contraintes |
| **Pluton / Charon** | New Horizons MVIC/LORRI avec bande et traitement déclarés | Stéréo du secteur de rencontre, forme globale | La face très résolue et l'hémisphère moins observé ne doivent pas recevoir le même statut scientifique |
| **Phobos / Deimos / astéroïdes** | Images des missions et spectres archivés | **Maillage de forme / DSK**, plutôt que heightfield sphérique imposé | Nécessaire pour silhouette irrégulière, gravité proche et ombres ; [NAIF décrit les noyaux de forme DSK](https://naif.jpl.nasa.gov/naif/data_generic.html) |

Pour Mars, les images HiRISE sont typiquement à 0,25–0,5 m/pixel et permettent des DTMs à pas de 1–2 m, avec précision verticale relative annoncée dans les dizaines de centimètres. **Cela ne signifie pas un géoréférencement absolu décimétrique** ; la page décrit également des artefacts. Les produits RED et IRB ne sont pas interchangeables avec une couleur vraie. [Documentation de l'équipe HiRISE](https://hirise.lpl.arizona.edu/dtm/about.php).

Le CTX global est une excellente source de détails mais ne doit pas être traité comme une mesure du relief : c'est une image, avec éclairage, poussière et raccords. Le producteur autorise l'usage de V01 pour tous usages et fournit les tuiles ; conserver son attribution et les identifiants sources. [Murray Lab : distribution](https://murray-lab.caltech.edu/CTX/V01/TilePages/).

### 10.2 Transformer l'image scientifique en matériau

Un rendu physiquement éclairé a besoin d'une réflectance, pas d'une photographie contenant déjà l'ombre d'un cratère. Pour chaque mosaïque : conserver géométrie solaire, angle d'émission, incidence et phase ; choisir un produit corrigé ou documenter la normalisation photométrique. Les produits en `I/F` ne sont pas automatiquement une couleur sRGB prête à brancher sur un matériau lambertien.

Le relief mesuré porte les formes au-dessus de sa résolution ; en dessous, rochers, poussière, régolithe et fissures peuvent être procéduraux, mais leur taille/distribution doit être contrainte par des sites observés. L'agrandissement par IA ne devient pas un DEM mesuré et ne doit pas modifier le support de contact de référence sans statut distinct.

Conserver les transformations déjà corrigées dans les assets : sens des longitudes, hémisphères, référence des normales, décalage de rayon. Les labels d'origine restent l'autorité des conventions ; une nouvelle carte doit être recalée avant publication.

## 11. Géantes et anneaux : la grande amélioration vient de la date et du spectre

### 11.1 OPAL : des cartes scientifiques annuelles réellement disponibles

**Hubble OPAL**, distribué par MAST, fournit des cartes globales par filtre pour Jupiter, Saturne, Uranus et Neptune. Les produits scientifiques sont en **FITS**, avec aperçus séparés, références et licence **CC BY 4.0**. La page liste notamment des campagnes jusqu'en 2025 selon la planète. [MAST OPAL, DOI 10.17909/T9G593](https://archive.stsci.edu/hlsp/opal).

**Proposition :** utiliser les cartes datées pour la grande échelle et l'évolution saisonnière ; réserver JunoCam/Cassini aux détails et géométries qu'ils contraignent. La taille du fichier, les filtres, la PSF et la couverture fixent le détail utilisable. Une carte composée de plusieurs rotations ne devient pas la météo à un instant.

Les données JWST sont particulièrement utiles pour températures, abondances, brumes et aurores ; elles décrivent des bandes IR. Elles ne justifient pas une nouvelle couleur visible saturée. La carte jovienne Cassini/Juno déjà créditée et licenciée dans le dépôt reste une source artistique/scientifique utile, avec son statut de composite historique.

### 11.2 Profils verticaux et dynamique

**Jupiter : Galileo Probe ASI** est une référence de pression, température, densité et décélération mesurées le 7 décembre 1995 ; la sonde a fourni des données jusqu'à environ 24 bar. Le PDS expose archive et documentation. Cette trajectoire est locale : elle ne mesure pas tous les nuages et toutes les latitudes. [PDS ASI](https://atmos.nmsu.edu/data_and_services/atmospheres_data/Galileo/asi.html).

**Saturne et Titan :** profils Cassini CIRS/occultations, Huygens HASI/DWE pour Titan, produits calibrés avec unités et incertitudes ; **Uranus/Neptune :** radio-occultations Voyager, spectres Hubble/JWST et modèles explicitement identifiés. L'image des ponts nuageux doit rester liée à pression, composition et épaisseur optique ; leur altitude varie avec gravité et latitude.

Des cartes d'images successives contraignent les vents zonaux et l'évolution des taches. Elles ne donnent pas à elles seules un champ tridimensionnel turbulent complet. Les animations sous le texel peuvent être physiquement plausibles et déterministes sans être présentées comme le film observé de la planète.

### 11.3 Anneaux : employer les profils d'opacité

Le PDS Ring-Moon Systems distribue les occultations Cassini **RSS, UVIS et VIMS**, notamment des profils calibrés d'épaisseur optique en fonction du rayon ; les différentes longueurs d'onde sondent des populations et effets différents. [Catalogue des occultations](https://pds-rings.seti.org/ringocc/).

**Dérivés utiles :** opacité radiale par bande, couleur/réflectance, propriétés de diffusion, métadonnées de géométrie et résolution. Une photo frontale donne une référence visuelle ; le profil d'occultation donne une contrainte de transmission. L'anisotropie, les self-gravity wakes, la phase et l'ombre empêchent de résumer tous les anneaux par un alpha peint dans une seule texture.

## 12. Les autres données qui améliorent vraiment la physique

### 12.1 Éphémérides, temps et orientation

**SPICE NAIF reste la référence à consolider.** Les familles sont SPK pour positions/vitesses, PCK pour orientation/constantes, LSK pour secondes intercalaires, FK pour repères, DSK pour formes. Garder le noyau, sa version, sa couverture temporelle et ses centres explicitement enregistrés. [NAIF : noyaux génériques](https://naif.jpl.nasa.gov/naif/data_generic.html), [sélection des noyaux](https://naif.jpl.nasa.gov/naif/kernel_selection.html).

Le projet refitte déjà DE440 et JUP365 : ajouter les satellites de Saturne, Uranus, Neptune et les petits corps dans les scènes où les éléments moyens deviennent limitants. Le meilleur noyau est celui dont la cible, le centre, la couverture et la précision conviennent ; « numéro plus grand » ne suffit pas. DE440/DE441 ont des compromis temporels différents. [JPL : description DE440/DE441](https://ssd.jpl.nasa.gov/doc/de440_de441.html).

Les tolérances de refit déclarées par `scripts/build-ephemeris.ts` sont des tolérances de préparation, pas la précision des observations de mission ni la preuve de toutes les positions en runtime. Une nouvelle ingestion doit conserver un bilan d'erreur et de couverture ; ne pas confondre centre planétaire et barycentre du système.

Pour la Terre, compléter selon le besoin **UT1−UTC, mouvement polaire et corrections d'orientation IERS**, avec données observées ou prédictives. Le jeu doit distinguer UTC, UT1, TT et TDB ; les orientations futures sont des prédictions de portée limitée. [IERS : EOP et bulletins](https://data.iers.org/eop.php).

**Horizons** sert de référence indépendante pour préparer des scènes et comparer une position apparente ou géométrique, avec observateur, échelle de temps et corrections clairement spécifiés. Pas d'appel Horizons à chaque frame. [Manuel JPL Horizons](https://ssd.jpl.nasa.gov/horizons/manual.html).

### 12.2 Gravitation et forme

Utiliser d'abord **GM** et sa source, plutôt que recalculer un produit à partir de masses arrondies. Conserver rayon de référence, aplatissement, J2 et conventions d'harmoniques. [JPL : paramètres physiques et références](https://ssd.jpl.nasa.gov/planets/phys_par.html).

Pour la Terre, les coefficients [EGM2008/NGA](https://earth-info.nga.mil/geograv) sont un autre produit que la seule grille de géoïde déjà chargée. Pour la Lune, les champs **GRAIL GRGM1200A puis GRGM1200B et variantes** possèdent coefficients et incertitudes publiés. La préparation peut les tronquer selon altitude et usage ; un degré 1200 ne doit pas devenir une évaluation systématique de chaque sous-pas. [NASA PGDA : GRGM1200A](https://pgda.gsfc.nasa.gov/products/50), [GRGM1200B et données](https://pgda.gsfc.nasa.gov/products/75).

Pour orbites basses, survols et petits corps, considérer harmoniques, marées et modèle de masse/forme adapté. L'accélération centrifuge d'un repère tournant doit rester distincte de la gravitation pour éviter de la compter deux fois.

### 12.3 Météo terrestre : une vraie structure 3D

**ECMWF IFS Open Data** est un bon candidat global. La documentation consultée annonce, depuis le **20 octobre 2026**, des grilles **0,1°** en plus de **0,25°**, IFS et non AIFS pour ce niveau fin ; la diffusion 0,1° arrive environ deux heures après la 0,25°. GRIB2, licence CC BY 4.0 et archive roulante courte : archiver les états nécessaires aux replays. [ECMWF : description actuelle](https://www.ecmwf.int/en/forecasts/datasets/open-data).

**ERA5** est préférable pour l'historique : champs horaires mondiaux, grille réanalysée 0,25° et 37 niveaux de pression pour le produit standard. C'est une réanalyse avec incertitude, pas une observation locale exhaustive. [ERA5 pressure levels, DOI 10.24381/cds.bd0915c6](https://cds.climate.copernicus.eu/datasets/reanalysis-era5-pressure-levels).

**USA : HRRR** apporte des champs régionaux à **3 km**, actualisés à l'heure, utiles aux scénarios de vol et de convection. Sélectionner cycle et horizon plutôt qu'une capture d'une carte publique. [NOAA HRRR](https://rapidrefresh.noaa.gov/hrrr/).

**Données à extraire :** pression, température, humidité, vent en altitude, hydrométéores si disponibles, nuages et précipitations. Conserver la coordonnée verticale : géopotentiel, pression et altitude géométrique ne sont pas identiques. Les METAR restent des contraintes de surface utiles ; ils ne décrivent ni le sommet de chaque couche ni toute la météo à 600 km autour d'une station.

### 12.4 Atmosphère haute, aérosols et autres planètes

**NRLMSIS 2.1** fournit températures et densités d'espèces pour la haute atmosphère terrestre, pilotées notamment par latitude, heure, F10.7 et activité géomagnétique. C'est pertinent pour traînée orbitale, raccord atmosphère/espace et émissions ; cela ne remplace pas un modèle météo de convection. [NASA CCMC : MSIS 2.1](https://ccmc.gsfc.nasa.gov/models/NRLMSIS~2.1/).

**CAMS** fournit aérosols, ozone et composition. Employer AOD et profils pour contraindre brume, poussière et coloration du ciel, avec portée régionale et masque de confiance ; un AOD de colonne ne définit pas à lui seul la distribution verticale. [CAMS : grandeurs et usage](https://atmosphere.copernicus.eu/global-forecast-plots), [documentation des prévisions](https://confluence.ecmwf.int/pages/viewpage.action?pageId=473853131).

**Mars Climate Database 6.2** est une référence de climatologie issue du modèle LMD : profils et variations saisonnières, pas météo mesurée à toute date. **La page interdit explicitement l'usage commercial sans autorisation spécifique.** Ne pas en faire un pack produit redistribué sous l'étiquette « données gratuites NASA ». [Accès, limites et copyright MCD](https://www-mars.lmd.jussieu.fr/mars/access.html).

Pour Vénus, Titan et les géantes, les archives d'instruments de structure atmosphérique/occultations sont prioritaires. Les atmosphères de référence peuvent fournir un scénario cohérent, avec leur nature de modèle, là où aucune mesure locale complète n'existe.

### 12.5 Spectres, lumière et matériaux

| Donnée | Source | Valeur pour le rendu |
|---|---|---|
| Spectre solaire absolu | [TSIS-1 Hybrid Solar Reference Spectrum, LASP/LISIRD](https://lasp.colorado.edu/lisird/data/tsis1_hsrs/) | Éclairage spectral de référence ; normalisation à la distance héliocentrique et cohérence des canaux scientifiques |
| Raies moléculaires et absorptions | [HITRAN/HAPI](https://www.hitran.org/hapi/), [référence HITRAN2024](https://hitran.org/docs/hitran-papers/) | Préparer sections efficaces/LUT selon température et pression ; compte/clé et conditions à vérifier lors de l'acquisition |
| Indices optiques `n + ik` des glaces et tholins | [NASA Optical Constants Database](https://ocdb.smce.nasa.gov/) | Matériaux de Titan, Pluton, lunes glacées ; conserver température et bande spectrale de chaque mesure |
| Réponse colorimétrique | [CIE 1931](https://cie.co.at/datatable/cie-1931-colour-matching-functions-2-degree-observer) | Passage contrôlé spectre → XYZ → espace de travail ; ce n'est pas une palette choisie par planète |
| Réflectance directionnelle terrestre | [MODIS MCD43A1 v6.1](https://data.nasa.gov/dataset/modis-terraaqua-brdf-albedo-model-parameters-daily-l3-global-500m-v061-53475) | Paramètres BRDF à 500 m pour la grande échelle ; produits quotidiens issus d'une fenêtre de 16 jours et qualité associée |

Le dernier point est particulièrement utile pour le réalisme orbital : la réponse au Soleil et à l'angle de vue est une propriété différente du détail photographique à 20 cm. Un modèle de BRDF mesuré à 500 m peut donc apporter quelque chose qu'une orthophoto très fine n'apporte pas.

### 12.6 Océans, neige, végétation, bâtiments et nuit

- **État de mer :** produits Copernicus Marine de vagues, vent de mer et houles, avec hauteur significative, période et direction. Ils contraignent un spectre statistique ; ils ne mesurent pas la phase de chaque vague à afficher. [Manuel WAVERYS](https://documentation.marine.copernicus.eu/PUM/CMEMS-GLO-PUM-001-032.pdf). Marée, niveau moyen et surcote sont des couches distinctes de la bathymétrie.
- **Occupation du sol :** garder WorldCover comme socle, avec son exactitude globale publiée de **76,7 % pour 2021 v200** ; une classe ne garantit pas la présence d'un arbre individuel. Les différences 2020/2021 incluent un changement d'algorithme. [WorldCover](https://esa-worldcover.org/en/data-access).
- **Canopée :** LiDAR national au proche, produits de hauteur estimée pour le remplissage. GEDI fournit des empreintes d'environ 25 m entre ±51,6°, pas une hauteur mesurée pour chaque pixel mondial à 1 m. [Mission GEDI](https://gedi.umd.edu/mission/technology/).
- **Bâtiments :** Overture apporte emprises, parties et attributs lorsqu'ils existent ; hauteurs manquantes ou estimées à conserver comme telles. Le thème buildings est sous **ODbL**, avec provenance et attribution. [Documentation Overture](https://docs.overturemaps.org/guides/buildings/). Ne pas confondre emprise de toit extraite d'image et emprise au sol précise.
- **Lumières nocturnes :** Black Marble **VNP46A2 collection 2**, grille 15″/environ 500 m, corrige lune et atmosphère ; masques qualité et produits composites permettent une base plus récente que VIIRS 2016. La radiance DNB est large bande, pas une couleur RGB ni un inventaire de lampadaires. [NASA LAADS : VNP46A2](https://ladsweb.modaps.eosdis.nasa.gov/missions-and-measurements/products/VNP46A2).
- **Neige et glace :** ajouter des produits temporels avec date, nuages et confiance, plutôt que repeindre automatiquement tout terrain clair en neige. Ne pas doubler la géométrie de glace d'un DSM par une couche d'épaisseur indépendante non raccordée.

### 12.7 Ciel, petits corps et satellites artificiels

**Gaia DR3** est le choix scientifique disponible pour enrichir astrométrie, mouvements propres, parallaxes et photométrie. Le catalogue doit être réduit par usage et magnitude, avec prise en compte des erreurs et des étoiles très brillantes. [Archive ESA Gaia](https://gea.esac.esa.int/archive/), [documentation DR3](https://gea.esac.esa.int/archive/documentation/GDR3/). À la date de ce rapport, l'ESA annonce DR4 pour décembre 2026 : ne pas la décrire comme déjà intégrée ou disponible. [Calendrier ESA](https://www.esa.int/Science_Exploration/Space_Science/Gaia/%28archive%29/0).

Pour les petits corps : éphémérides Horizons/SPK, formes et paramètres PDS/mission ; conserver covariances et domaine de prédiction si l'orbite est incertaine. Pour les satellites artificiels : éléments orbitaux datés et propagation adaptée ; une orbite propagée longtemps après son époque n'a pas la précision d'une trajectoire reconstruite de mission. Ce sujet mérite un lot distinct plutôt qu'un catalogue géant non entretenu.

## 13. Préparer ces données pour la destination AAA

### 13.1 Un manifeste scientifique commun

Étendre le principe de manifeste déjà employé par `earth-surface` et Jupiter. Schéma proposé, **pas un fichier de données existant** :

```text
Identité : dataset, product_id, version, fournisseur, DOI/URL, hash
Nature : observation | modèle | réanalyse | estimation | procédural
Temps : acquisition_start/end, epoch, valid_from/to, temps de publication
Espace : body, frame, CRS, horizontal_datum, vertical_datum, reference_radius
Conventions : unités, latitude géodésique/planétocentrique, est/ouest, normalisation
Qualité : pas natif, résolution effective, incertitude et métrique, masque, NoData
Traitements : transformation, grilles utilisées, filtrage, réduction, outil/version
Diffusion : licence, attribution, transformations et redistribution autorisées
Runtime : niveaux, bounds, format, taille, budget, produit parent/repli, génération
```

Pour le magnétisme : ajouter modèle interne/externe, état de forçage, normalisation de Schmidt ou autre convention, rayon de référence, valeur de nT/G, GSM/SM/System III. Pour l'image : préciser radiance, réflectance, `I/F`, sRGB ou linéaire. Pour les hauteurs : ne jamais masquer le datum dans le seul nom du fournisseur.

### 13.2 Une chaîne de préparation, plusieurs lecteurs

Séquence proposée : **cataloguer → choisir produit et emprise → conserver original et métadonnées → normaliser les repères → préparer pages/LOD → publier un manifeste immuable → charger selon les budgets communs**.

- Les COG, NetCDF, GRIB, FITS et PDS sont des formats sources ; ne pas imposer leur parsing complet au navigateur à chaque vue.
- Les couleurs peuvent être préparées en KTX2/mips ; les coefficients et champs numériques gardent un format dont l'erreur est bornée.
- Hauteurs et masques catégoriels demandent des filtres différents de la couleur. Ne pas compresser des identifiants ou un DEM avec un encodeur photographique destructif sans erreur quantifiée.
- Prévoir gutters, parent de repli, raccords entre fournisseurs et validité par page/pixel. Le contact conserve le support du monde, indépendamment du LOD graphique choisi.
- Préparer lignes magnétiques, tables spectrales et profils hors frame ; publier leur date et leur génération aux lecteurs.
- Les effets d'air et d'aurore lisent les modèles communs ; les schémas s'occultent contre la profondeur finale.

Cela s'inscrit dans C0 et les chantiers T8/T9/Q5/AM0 ; il ne s'agit pas d'un nouveau renderer ou d'un service de données concurrent proposé en dehors du plan.

### 13.3 Ordres de grandeur de stockage : calculs, pas mesures

Quelques calculs pour borner les ambitions, **sans présumer la taille des fichiers compressés ni la mémoire runtime** :

- Une zone de **100 × 100 km à 1 m** contient `10^10` échantillons : **40 Go décimaux en float32** pour une seule couche de hauteur, avant mips et métadonnées.
- À **30 cm**, la même zone contient environ `1,11 × 10^11` pixels : **333 Go décimaux en RGB8** brut.
- Une carte equirectangulaire **8192 × 4096** sur Terre a un pas équatorial d'environ **4,9 km** ; la même largeur sur Jupiter représente environ **55 km**. Une texture dite « 8K » n'est donc pas un sol détaillé de près.

Ces valeurs sont des calculs géométriques d'échantillonnage. Elles justifient la préparation par région et le streaming ; elles ne sont ni un benchmark, ni une estimation commerciale de stockage/CDN.

### 13.4 Visibilité des limites dans TARS et les instruments

TARS devrait pouvoir décrire, par les mêmes états que l'interface : source sous le joueur, date d'image, résolution native utile, datum/qualité du sol, modèle magnétique, forçage utilisé et canal d'observation. Exemple de réponse future : « Au-dessus de cette région, relief LiDAR 1 m ; l'image est NAIP de telle année ; aurore calculée selon OVATION, détail fin reconstruit. »

Le joueur n'a pas besoin d'un panneau de détails techniques pour voler. En revanche, les vues scientifiques et diagnostics doivent permettre de comprendre ce qui est observé, calculé ou extrapolé, notamment en 2067.

## 14. Ordre d'intégration conseillé, sans lancer les travaux

### 14.1 Les premiers lots de données

| Lot proposé | Produits concrets à préparer | Apport attendu | Raccord au plan / dépendance |
|---|---|---|---|
| **A — Contrat de provenance et datums** | Manifeste enrichi ; inventaire du géoïde ; transformations par source | Éviter erreurs systématiques avant d'ajouter de la finesse | C0-1/C0-4 et fournisseur de sol ; préalable aux nouveaux pays |
| **B — AM0 Terre/Jupiter** | Coefficients IGRF-14, JRM33, CON2020 ; repères et vecteurs de référence | Champ crédible partagé et empreintes calculables | AM0 ; codes/licences et rayon de référence à figer |
| **C — AM1 météo spatiale** | Adaptateur des nouveaux JSON NOAA, GFZ/OMNI historique, grille OVATION | Remplacer le Kp uniquement manuel et l'anneau symétrique | AM1 ; dates, péremption et scénario 2067 explicites |
| **D — Région USA complète** | Une zone NAIP + 3DEP/S1M + LiDAR + métadonnées | Sol et image réellement fins, cohérents et redistribuables | Terrain/imagerie/contact/décor ; choisir les dalles avant toute promesse |
| **E — Socle mondial** | RGBNIR WorldCover/CDSE, GLO-30, qualification Mapterhorn | Améliorer les pays sans source nationale actuelle | Réutiliser les packs existants et la résidence commune |
| **F — Pôles et mer** | REMA/ArcticDEM, LIMA, GEBCO 2026 + TID, BlueTopo local | Couverture complète avec qualité et datums explicites | Adressage polaire, eau/sol/glace séparés |
| **G — AM2/AM3/AM7** | Juno UVS calibré à événements choisis, tables de profils, champ externe et frontières | Jupiter crédible en visible et en instrument, schéma physiquement informé | Profondeur finale et air partagé ; ne pas afficher l'UV en visible |
| **H — Déclinaison aux autres corps** | Cassini 11+, modèles Uranus/Neptune, Callisto/Ganymède optiques, Mars/Vénus | Couvrir les mécanismes réels avec leurs limites | AM4–AM8 ; corriger le catalogue avant de produire les assets |
| **I — Sols planétaires locaux** | SLDEM/LROC, HiRISE apparié, forme de petits corps | Vrais lieux détaillés et silhouettes justes | P6–P8/H et surfaces communes ; préserver les produits déjà intégrés |
| **J — Physique temporelle** | SPK satellites, EOP, météo 3D, atmosphères, anneaux et OPAL | Cohérence du monde à sa date et à son canal | Simulation, éclairage, Q5, instruments et replay |

Les « apports attendus » sont des motivations, pas des gains visuels ou de performance mesurés. Les gros volumes scientifiques restent dans une chaîne d'assets et un stockage approprié ; ne pas importer des téraoctets dans Git.

### 14.2 Ce que je ferais d'abord selon le résultat recherché

**Pour une première Terre plus spectaculaire en vol :** une région USA cohérente, une région alpine déjà bien servie pour comparaison, puis Japon/Nouvelle-Zélande/Espagne. Le choix des fournisseurs dépend de la scène, pas seulement du record de GSD.

**Pour le chantier aurores :** verrouiller coefficients/repères/date, AM1 Terre, puis une scène jovienne observée et les empreintes ; inclure ensuite les nouvelles références optiques de Ganymède/Callisto. La collecte d'une belle vidéo UV sans calibration ne ferme aucune de ces étapes.

**Pour la justesse physique globale :** provenance des constantes, temps/repères, satellites non encore couverts par SPK, datums de surface, atmosphères et illumination mesurée. Ces lots peuvent améliorer la vérité de la scène sans produire une capture immédiatement plus riche.

## 15. Ce qui reste à vérifier avant toute acquisition/injection

Cette liste décrit le travail d'une **future session autorisée** ; rien ci-dessous n'est exécuté ici.

1. Fixer pour chaque lot les `product_id`, versions, emprises et dates exactes, ainsi que le fichier source réellement téléchargeable.
2. Conserver les conditions et crédits du produit choisi ; vérifier séparément la licence du logiciel de préparation et celle des données dérivées.
3. Lire les labels et rapports qualité complets des dalles sélectionnées ; aucune résolution nationale uniforme déduite du nom du service.
4. Vérifier accès, authentification, quotas, HTTP Range, cache et disponibilité ; prévoir une distribution stable des dérivés. Aucune conclusion CORS nouvelle dans ce rapport.
5. Vérifier les conversions de datums et les raccords sur des références indépendantes, en particulier altitude négative, pistes, côte et pôles.
6. Quantifier l'erreur introduite par réduction, compression et simplification ; déterminer le support de contact indépendamment de la qualité graphique.
7. Pour aurores : verrouiller canal spectral, unités, géométrie, profil d'émission et statut observé/reconstruit ; documenter le scénario au-delà des dates couvertes.
8. Seulement lors de l'intégration, et dans le périmètre alors demandé, effectuer les contrôles du projet et les mesures nécessaires. Aucun résultat de ce type n'est revendiqué ici.

### 15.1 Incertitudes encore ouvertes

- Les cartographies fines ne sont pas auditées dalle par dalle sur tous les pays ; les lignes nationales secondaires restent des pistes, avec un repli mondial identifié.
- Les coefficients exacts et vecteurs de référence de tous les modèles AM0 ne sont pas encore réunis dans un paquet versionné ; l'étude identifie leurs dépôts/publications, sans les importer.
- La conversion brillance/profil/couleur de chaque aurore doit être dérivée des produits calibrés ; les altitudes approximatives du plan ne sont pas validées ici comme constantes universelles.
- L'externe d'Uranus/Neptune et les interactions des lunes sont beaucoup moins contraints que le champ terrestre ; une qualité visuelle uniforme ne doit pas masquer cette différence de connaissance.
- Les licences MCD, certains codes de champ et certains portails nationaux excluent une intégration commerciale automatique. Ce sont des critères de sélection, pas des demandes d'autorisation déclenchées par cette étude.
- Aucun budget CPU/GPU/réseau ni gain de cadence n'a été mesuré. Les choix de formats et de degrés de modèles restent des propositions à borner lors de l'intégration.

## 16. Points d'entrée à garder sous la main

Les liens détaillés sont placés au niveau des affirmations et produits concernés. Pour démarrer un lot :

- **Magnétisme Terre :** [NOAA IGRF](https://www.ncei.noaa.gov/products/international-geomagnetic-reference-field), [CCMC](https://ccmc.gsfc.nasa.gov/), [GFZ](https://kp.gfz.de/en/data), [OMNI](https://omniweb.gsfc.nasa.gov/).
- **Magnétisme planétaire :** [MOP/LASP](https://lasp.colorado.edu/mop/missions/juno/community-code/), [PlanetMag](https://github.com/NASA-Planetary-Science/PlanetMag), [PDS/PPI](https://pds-ppi.igpp.ucla.edu/).
- **Aurores et atmosphères :** [PDS Atmospheres](https://pds-atmospheres.nmsu.edu/), [MAST](https://archive.stsci.edu/), [NCAR GLOW](https://www2.hao.ucar.edu/modeling/glow).
- **USA :** [The National Map](https://apps.nationalmap.gov/datasets/), [NAIP GeoHub](https://naip-usdaonline.hub.arcgis.com/), [BlueTopo](https://nauticalcharts.noaa.gov/data/bluetopo_faq.html), [VDatum](https://www.vdatum.noaa.gov/).
- **Terre globale :** [Copernicus Data Space](https://dataspace.copernicus.eu/), [WorldCover](https://esa-worldcover.org/en/data-access), [PGC](https://www.pgc.umn.edu/data/elevation/), [GEBCO](https://www.gebco.net/), [Mapterhorn](https://mapterhorn.com/data-access/).
- **Système solaire :** [NAIF](https://naif.jpl.nasa.gov/naif/data_generic.html), [JPL SSD](https://ssd.jpl.nasa.gov/), [NASA PGDA](https://pgda.gsfc.nasa.gov/), [USGS Astrogeology](https://astrogeology.usgs.gov/), [PDS OPUS](https://opus.pds-rings.seti.org/).

**État de preuve final :** audit statique ciblé du dépôt et recherche documentaire auprès des producteurs/publications ; sélection et ordre d'intégration proposés. Aucune installation, acquisition de masse, modification du système, intégration de données ou exécution de test.
